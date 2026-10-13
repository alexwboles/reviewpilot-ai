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

echo "== e2e flow 7: new features (CSV export, ask-next, goal, drafts, custom nag window) =="
node -e "
const RP=require('./lib/logic');
// CSV export round-trips through the importer
const csv=RP.customersToCSV([{name:'Ann',email:'ann@x.com',phone:'1'},{name:'Bob',email:'',phone:''}]);
const back=RP.parseCSV(csv);
if(back.length!==2||back[0].name!=='Ann'||back[0].email!=='ann@x.com') throw new Error('csv round-trip: '+csv);
// ask-next: never-asked prioritized, nag-protected excluded
const custs=[{key:'a',name:'Amy'},{key:'b',name:'Ben'},{key:'c',name:'Cat'}];
let asks={}; asks=RP.recordAsk(asks,'a');
const picks=RP.suggestNextAsk(custs,asks,5);
if(picks.length!==2||picks.some(p=>p.key==='a')) throw new Error('ask-next picks wrong');
// goal: 3 recent asks vs goal 5
const gasks={}; ['x','y','z'].forEach(k=>{Object.assign(gasks,RP.recordAsk(gasks,k));});
const g=RP.goalProgress(gasks,5);
if(g.count!==3||g.remaining!==2||g.pct!==60) throw new Error('goal: '+JSON.stringify(g));
// draft log entry keeps tones + metadata
const d=RP.draftLogEntry({review:'Loved it',stars:5,name:'Maya',business:'Acme'},{professional:'P',friendly:'F',witty:'W'});
if(d.stars!==5||d.name!=='Maya'||d.review!=='Loved it'||d.witty!=='W') throw new Error('draft entry');
// custom nag window changes behavior vs default
let n={}; n=RP.recordAsk(n,'w@x.com');
if(!RP.isNag(n,'w@x.com')||!RP.isNag(n,'w@x.com',3)) throw new Error('should nag');
const old={}; old['o@x.com']=new Date(Date.now()-10*24*3600*1000).toISOString();
if(!RP.isNag(old,'o@x.com',30)) throw new Error('10d ago should nag with 30d window');
if(RP.isNag(old,'o@x.com',7)) throw new Error('10d ago should be clear with 7d window');
console.log('flow7 ok');" >/dev/null 2>&1 \
  && ok "CSV export / ask-next / weekly goal / draft log / custom nag window" || bad "flow 7 failed"

echo "== e2e flow 8: review trend + reply accountability + snippets + ask templates =="
node -e "
const RP=require('./lib/logic');
// A month of logged reviews: trend buckets + reply tracking
const revs=[
  {stars:5,text:'Loved it',at:'2026-09-04T12:00:00.000Z',replied:'2026-09-04T14:00:00.000Z'},
  {stars:4,text:'Great',at:'2026-09-18T12:00:00.000Z',replied:null},
  {stars:2,text:'Slow',at:'2026-10-03T12:00:00.000Z',replied:null},
  {stars:5,text:'Best ever',at:'2026-10-09T12:00:00.000Z',replied:'2026-10-09T15:00:00.000Z'}
];
const trend=RP.ratingTrendByMonth(revs);
if(trend.length!==2||trend[0].avg!==4.5||trend[1].avg!==3.5) throw new Error('trend: '+JSON.stringify(trend));
const rr=RP.responseRate(revs);
if(rr.total!==4||rr.replied!==2||rr.pct!==50) throw new Error('response: '+JSON.stringify(rr));
// Snippets: build a small library, copy-ready text preserved verbatim
let sn=RP.addSnippet([],'Recovery close','We take this seriously — please call us so we can make it right.').snippets;
sn=RP.addSnippet(sn,'Thank-you','Thanks for the kind words!').snippets;
if(sn.length!==2||sn[0].text!=='We take this seriously — please call us so we can make it right.') throw new Error('snippets');
// Ask templates: business + link filled, both channels copy-ready
const t=RP.askMessageTemplates('Sunny Side Bakery','http://localhost:$PORT/ask?b=X&u=Y');
if(!t.sms.includes('Sunny Side Bakery')||!t.sms.includes('http://localhost:$PORT/ask')) throw new Error('sms');
if(!t.email.includes('Sunny Side Bakery')||!t.email.includes('http://localhost:$PORT/ask')) throw new Error('email');
console.log('flow8 ok');" >/dev/null 2>&1 \
  && ok "rating trend / reply tracking / snippets / ask templates" || bad "flow 8 failed"

echo "== e2e flow 9: recovery queue + topic insights + backup validation =="
node -e "
const RP=require('./lib/logic');
// Realistic month of logs: two angry reviews, a few happy ones
const revs=[
  {stars:5,text:'The staff were wonderful and the food was incredible.',at:'2026-10-01T12:00:00.000Z',replied:'2026-10-01T13:00:00.000Z'},
  {stars:1,text:'Terrible service, waited an hour, never coming back.',at:'2026-10-03T12:00:00.000Z',replied:'2026-10-03T14:00:00.000Z'},
  {stars:2,text:'Cold food, slow kitchen, overpriced menu.',at:'2026-10-05T12:00:00.000Z',replied:null},
  {stars:5,text:'Best pizza in town, friendly team!',at:'2026-10-09T12:00:00.000Z',replied:'2026-10-09T12:30:00.000Z'}
];
// Owner works the queue: 1-star first, contacts then resolves it
let q=RP.recoveryQueue(revs);
if(q.length!==2||q[0].i!==1||q[1].i!==2) throw new Error('queue order: '+JSON.stringify(q.map(x=>x.i)));
RP.setRecoveryStatus(revs,1,'contacted');
RP.setRecoveryStatus(revs,1,'resolved');
q=RP.recoveryQueue(revs);
if(q.length!==1||q[0].i!==2) throw new Error('queue should hold only the remaining 2-star');
// Topics surface the real problems: service/wait/price show low averages
const topics=RP.reviewTopics(revs);
const svc=topics.find(t=>t.topic==='Service');
if(!svc||svc.avgStars>=3) throw new Error('service avg should be low: '+JSON.stringify(svc));
if(topics[0].mentions<2) throw new Error('top topic needs 2+ mentions');
// A previously-exported backup round-trips through validation
const backup={customers:[{name:'Jo',email:'jo@x.com',phone:'',key:'jo@x.com'}],asks:{},reviews:revs,settings:{},drafts:[],snippets:[]};
if(!RP.validateBackup(backup).ok) throw new Error('exported shape should validate');
console.log('flow9 ok');" >/dev/null 2>&1 \
  && ok "recovery queue workflow / topic insights / backup validation" || bad "flow 9 failed"

# sweep-2 UI wiring present in served page
dash=$(curl -sf "http://localhost:$PORT/")
echo "$dash" | grep -q 'id="topicInsights"' && echo "$dash" | grep -q 'id="recoveryQueue"' && echo "$dash" | grep -q 'id="restoreBtn"' \
  && ok "dashboard serves topic insights + recovery + restore UI" || bad "sweep-2 UI missing from served page"

kill $SRV 2>/dev/null; trap - EXIT; wait $SRV 2>/dev/null

echo ""
echo "e2e: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
