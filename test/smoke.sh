#!/usr/bin/env bash
# ReviewPilot AI — smoke tests (10 checks). Server boots, routes work, API drafts offline.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

PORT=34561
export PORT

echo "== smoke: environment =="
command -v node >/dev/null && ok "node present ($(node --version))" || bad "node missing"

echo "== smoke: shared logic loads =="
node -e "const RP=require('./lib/logic'); if(!RP.draftReplies||!RP.parseCSV||!RP.isNag) throw new Error('missing fns'); console.log('logic ok')" >/dev/null 2>&1 \
  && ok "lib/logic.js loads with expected functions" || bad "lib/logic.js failed to load"

echo "== smoke: server boot =="
node server.js >/tmp/rp-smoke.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 50); do curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 0.2; done

echo "== smoke: routes =="
curl -sf "http://localhost:$PORT/health" | grep -q '"ok":true' \
  && ok "GET /health -> ok:true" || bad "GET /health"

curl -sf "http://localhost:$PORT/" | grep -q "ReviewPilot" \
  && ok "GET / -> dashboard HTML" || bad "GET /"

curl -sf "http://localhost:$PORT/ask?b=Test&u=https://example.com" | grep -q "askBiz" \
  && ok "GET /ask -> ask page" || bad "GET /ask"

curl -sf "http://localhost:$PORT/public/vendor/qrcode.min.js" | grep -q "qrcode" \
  && ok "GET /public/vendor/qrcode.min.js -> QR lib" || bad "QR lib not served"

curl -sf "http://localhost:$PORT/lib/logic.js" | grep -q "draftReplies" \
  && ok "GET /lib/logic.js -> shared logic" || bad "logic.js not served"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/nope")
[ "$CODE" = "404" ] && ok "unknown route -> 404" || bad "unknown route returned $CODE"

echo "== smoke: reply API (no key) =="
RESP=$(curl -sf -X POST "http://localhost:$PORT/api/draft-reply" \
  -H 'Content-Type: application/json' \
  -d '{"review":"Amazing croissants, best in town!","stars":5,"business":"Sunny Bakery","name":"Jo"}')
echo "$RESP" | grep -q '"professional"' && echo "$RESP" | grep -q '"friendly"' && echo "$RESP" | grep -q '"witty"' \
  && ok "POST /api/draft-reply -> 3 tones" || bad "draft-reply missing tones"
echo "$RESP" | grep -qi "sunny bakery" \
  && ok "reply personalizes with business name" || bad "reply missing business name"
echo "$RESP" | grep -q '"enhanced":false' \
  && ok "no API key -> enhanced:false (offline templates)" || bad "enhanced flag wrong"

CFG=$(curl -sf "http://localhost:$PORT/api/config")
echo "$CFG" | grep -q '"openai":false' \
  && ok "GET /api/config -> openai:false without key" || bad "/api/config wrong"

echo "== smoke: new-feature logic =="
node -e "
const RP=require('./lib/logic');
// customersToCSV: header + quoted escaping
const csv=RP.customersToCSV([{name:'Lee, Sarah',email:'sarah@example.com',phone:'555-0101'},{name:'Tom',email:'',phone:''}]);
const lines=csv.split('\n');
if(lines.length!==3||lines[0]!=='name,email,phone') throw new Error('csv header/rows');
if(lines[1]!=='\"Lee, Sarah\",sarah@example.com,555-0101') throw new Error('csv escaping: '+lines[1]);
if(RP.customersToCSV([])!=='name,email,phone') throw new Error('csv empty');
// isNag / nagMessage with custom window: default 14 preserved, custom honored
let asks={};
if(RP.isNag(asks,'a@x.com')) throw new Error('fresh should not nag');
asks=RP.recordAsk(asks,'a@x.com');
if(!RP.isNag(asks,'a@x.com')) throw new Error('just-asked should nag (default 14)');
if(!RP.isNag(asks,'a@x.com',1)) throw new Error('1-day window should still nag right after ask');
if(!RP.isNag(asks,'a@x.com',365)) throw new Error('365-day window should still nag');
const old={}; old['b@x.com']=new Date(Date.now()-20*24*3600*1000).toISOString();
if(!RP.isNag(old,'b@x.com',30)) throw new Error('20d old should nag with 30d window');
if(RP.isNag(old,'b@x.com',14)) throw new Error('20d old should be clear with 14d window');
if(RP.normalizeWindow('abc')!==14) throw new Error('bad window fallback');
if(RP.normalizeWindow(7)!==7) throw new Error('window passthrough');
const msg=RP.nagMessage(asks,'a@x.com',7);
if(!msg||!/wait \d+ more day/.test(msg)) throw new Error('custom-window nag message: '+msg);
const msg30=RP.nagMessage(old,'b@x.com',30);
if(!msg30||!/wait 1\d? more day/.test(msg30)) throw new Error('30d-window nag message: '+msg30);
if(RP.nagMessage(old,'b@x.com',14)!==null) throw new Error('no message expected when clear (14d window)');
// suggestNextAsk: never-asked first, nag-protected excluded
const custs=[{key:'a',name:'A'},{key:'b',name:'B'},{key:'c',name:'C'}];
let ax={}; ax=RP.recordAsk(ax,'a'); // A just asked -> nag-protected
const picks=RP.suggestNextAsk(custs,ax,5);
if(picks.length!==2) throw new Error('expected 2 picks, got '+picks.length);
if(picks.some(p=>p.key==='a')) throw new Error('nag-protected must be excluded');
if(picks[0].key!=='b'&&picks[0].key!=='c') throw new Error('never-asked should come first');
if(RP.suggestNextAsk(custs,ax,1).length!==1) throw new Error('limit honored');
// goalProgress: counts asks in trailing 7 days
const g=RP.goalProgress(ax,4);
if(g.count!==1||g.goal!==4||g.pct!==25||g.remaining!==3) throw new Error('goal math: '+JSON.stringify(g));
const g0=RP.goalProgress({},10);
if(g0.count!==0||g0.pct!==0||g0.remaining!==10) throw new Error('empty goal');
const many={}; for(let i=0;i<12;i++) many['k'+i]=new Date().toISOString();
const g2=RP.goalProgress(many,10);
if(g2.pct!==100||g2.remaining!==0) throw new Error('goal cap: '+JSON.stringify(g2));
// draftLogEntry shape
const d=RP.draftLogEntry({review:'Great!',stars:5,business:'Acme',name:'Jo'},{professional:'P',friendly:'F',witty:'W'});
if(!d.at||d.stars!==5||d.name!=='Jo'||d.professional!=='P'||d.friendly!=='F'||d.witty!=='W') throw new Error('draft entry shape');
console.log('new-feature logic ok');
" >/dev/null 2>&1 \
  && ok "customersToCSV / custom nag window / suggestNextAsk / goalProgress / draftLogEntry" \
  || bad "new-feature logic failed"

# new UI wiring present
for id in askNext goalFill goalText goalBadge weeklyGoal nagDays nagBadge nagSub draftLog exportCsvBtn; do
  grep -q "id=\"$id\"" public/index.html && ok "wired: #$id" || bad "missing #$id"
done
grep -q "goalbar" public/styles.css && grep -q "draft-entry" public/styles.css \
  && ok "goalbar + draft-entry styles" || bad "new styles missing"
grep -q "draftLogEntry\|suggestNextAsk\|goalProgress\|customersToCSV" public/app.js \
  && ok "app.js uses new logic fns" || bad "app.js missing new logic calls"

kill $SRV 2>/dev/null; trap - EXIT; wait $SRV 2>/dev/null

echo ""
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
