#!/usr/bin/env bash
set -euo pipefail
: "${API_URL:?}" "${PAIRING_CODE:?}"
curl -fsS "$API_URL/health"; echo
TOKEN=$(curl -fsS -X POST "$API_URL/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$PAIRING_CODE\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
H="Authorization: Bearer $TOKEN"
TODAY=$(curl -fsS "$API_URL/v1/today" -H "$H")
echo "$TODAY" | node -pe 'const t=JSON.parse(require("fs").readFileSync(0)); `${t.className} · ${t.theme} · ${t.deck.drills.length} drills`'
CLASS=$(echo "$TODAY" | node -pe 'JSON.parse(require("fs").readFileSync(0)).classId')
SID=$(curl -fsS -X POST "$API_URL/v1/sessions" -H "$H" -H 'Content-Type: application/json' -d "{\"classId\":\"$CLASS\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).sessionId')
time curl -fsS -X POST "$API_URL/v1/utterance" -H "$H" -F sessionId="$SID" -F mode=note -F text="Priya, guard drops on the jab again, great energy though"; echo
curl -fsS "$API_URL/v1/agents/feed" -H "$H" | node -pe 'JSON.parse(require("fs").readFileSync(0)).slice(0,5).map(r=>r.agent+": "+r.summary).join("\n")'
