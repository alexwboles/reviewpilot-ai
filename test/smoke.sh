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

kill $SRV 2>/dev/null; trap - EXIT; wait $SRV 2>/dev/null

echo ""
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
