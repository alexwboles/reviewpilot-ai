#!/usr/bin/env bash
# ReviewPilot AI — end-to-end flows (6 flows). Exercises real user journeys.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

PORT=34562
export PORT
node server.js >/tmp/rp-e2e.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 50); do curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 0.2; done

echo "== e2e flow 1: review-request link generation =="
ASKURL=$(node -e "
const RP=require('./lib/logic');
const u=RP.buildAskUrl('http://localhost:$PORT','Sunny Side Bakery','https://g.page/r/abc123');
if(!u) throw new Error('null url');
console.log(u);")
echo "$ASKURL" | grep -q "/ask?b=Sunny%20Side%20Bakery&u=" \
  && ok "buildAskUrl encodes business + review URL" || bad "buildAskUrl: $ASKURL"
PAGE=$(curl -sf "$ASKURL")
echo "$PAGE" | grep -q 'id="askBtn"' \
  && ok "ask page serves with review CTA button" || bad "ask page missing CTA"
echo "$PAGE" | grep -q "URLSearchParams" \
  && ok "ask page reads ?b= and ?u= params client-side" || bad "ask page param script missing"

echo "== e2e flow 2: happy-customer reply (5 stars) =="
R5=$(curl -sf -X POST "http://localhost:$PORT/api/draft-reply" \
  -H 'Content-Type: application/json' \
  -d '{"review":"The staff were wonderful and the food was incredible.","stars":5,"business":"Sunny Side Bakery","name":"Maya"}')
for TONE in professional friendly witty; do
  LEN=$(echo "$R5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).tones['$TONE'];console.log(t&&t.length>40?'ok':'short')})")
  [ "$LEN" = "ok" ] && ok "5-star $TONE tone is substantive" || bad "5-star $TONE tone too short"
done
echo "$R5" | grep -qi "maya" \
  && ok "5-star reply greets reviewer by name" || bad "reviewer name missing"

echo "== e2e flow 3: angry-customer recovery (1 star) =="
R1=$(curl -sf -X POST "http://localhost:$PORT/api/draft-reply" \
  -H 'Content-Type: application/json' \
  -d '{"review":"Terrible service, waited an hour, never coming back.","stars":1,"business":"Sunny Side Bakery"}')
echo "$R1" | grep -qi "sorry" \
  && ok "1-star reply leads with apology" || bad "1-star reply lacks apology"
echo "$R1" | grep -qi "blushing\|five stars" \
  && bad "1-star reply wrongly celebratory" || ok "1-star reply is not celebratory"
echo "$R1" | grep -qi "reach out\|contact\|call us\|message" \
  && ok "1-star reply takes conversation offline" || bad "1-star reply missing offline CTA"

echo "== e2e flow 4: anti-nag (14-day rule) =="
node -e "
const RP=require('./lib/logic');
let asks={};
// fresh customer: not nag
if(RP.isNag(asks,'a@x.com')) throw new Error('fresh should not nag');
// just asked: nag
asks=RP.recordAsk(asks,'a@x.com');
if(!RP.isNag(asks,'a@x.com')) throw new Error('just-asked should nag');
const msg=RP.nagMessage(asks,'a@x.com');
if(!msg||!/wait \d+ more day/.test(msg)) throw new Error('bad nag message: '+msg);
// asked 15 days ago: clear
const old=new Date(Date.now()-15*24*3600*1000).toISOString();
asks['b@x.com']=old;
if(RP.isNag(asks,'b@x.com')) throw new Error('15-day-old ask should be clear');
if(RP.nagMessage(asks,'b@x.com')!==null) throw new Error('no message expected when clear');
console.log('anti-nag ok');" >/dev/null 2>&1 \
  && ok "anti-nag: nag within 14d, clear after, message correct" || bad "anti-nag logic failed"

echo "== e2e flow 5: CSV import =="
node -e "
const RP=require('./lib/logic');
const csv='name,email,phone\n\"Lee, Sarah\",sarah@example.com,555-0101\nTom Baker,tom@example.com,\nNo Contact,,';
const rows=RP.parseCSV(csv);
if(rows.length!==3) throw new Error('expected 3 rows, got '+rows.length);
if(rows[0].name!=='Lee, Sarah'||rows[0].email!=='sarah@example.com') throw new Error('quoted comma parse failed');
if(rows[1].phone!=='') throw new Error('empty phone should be empty string');
if(rows[2].key!=='no contact') throw new Error('fallback key should be name, got '+rows[2].key);
const empty=RP.parseCSV('name,email,phone\n');
if(empty.length!==0) throw new Error('header-only csv should give 0 rows');
console.log('csv ok');" >/dev/null 2>&1 \
  && ok "CSV: quoted commas, empty fields, header-only handled" || bad "CSV parse failed"

echo "== e2e flow 6: dashboard stats =="
node -e "
const RP=require('./lib/logic');
const now=new Date().toISOString();
const stats=RP.computeStats({
  customers:[{key:'a'},{key:'b'},{key:'c'},{key:'d'}],
  asks:{a:now,b:now},
  reviews:[{stars:5},{stars:4},{stars:5}]
});
if(stats.totalCustomers!==4) throw new Error('customers');
if(stats.askedCount!==2) throw new Error('askedCount');
if(stats.askRate!==50) throw new Error('askRate '+stats.askRate);
if(stats.asksLast7Days!==2) throw new Error('asksLast7Days');
if(stats.totalReviews!==3) throw new Error('totalReviews');
if(stats.avgRating!=='4.7') throw new Error('avgRating '+stats.avgRating);
const zero=RP.computeStats({});
if(zero.askRate!==0||zero.avgRating!==null) throw new Error('empty stats');
console.log('stats ok');" >/dev/null 2>&1 \
  && ok "dashboard stats math correct (incl. empty state)" || bad "stats math failed"

kill $SRV 2>/dev/null; trap - EXIT; wait $SRV 2>/dev/null

echo ""
echo "e2e: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
