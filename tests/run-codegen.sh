#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${MIRAS_TEST_PORT:-3000}"
CFG="firebase-applet-config.json"; CFG_BAK="$CFG.cgtest-bak"
DB="data/db.json"; DB_BAK="$(mktemp)"; SRV_PID=""
restore(){ [ -n "$SRV_PID" ] && kill "$SRV_PID" >/dev/null 2>&1; [ -f "$CFG_BAK" ] && mv -f "$CFG_BAK" "$CFG"; [ -f "$DB_BAK" ] && { cp -f "$DB_BAK" "$DB" 2>/dev/null||true; rm -f "$DB_BAK"; }; }
trap restore EXIT INT TERM
if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then echo "✋ server already on $PORT"; exit 2; fi
[ -e "$CFG_BAK" ] && rm -rf "$CFG_BAK"; [ -f "$CFG" ] && mv "$CFG" "$CFG_BAK"
cp -f "$DB" "$DB_BAK" 2>/dev/null || true
node tests/seed-load.cjs >/dev/null
env DISABLE_HMR=true MIRAS_ALLOW_LOCAL_ONLY_MODE=true MIRAS_JOIN_CODE_SIGNING_SECRET="cg-secret" MIRAS_ROLLCALL_QR_SECRET="cg-secret" node node_modules/.bin/tsx server.ts > /tmp/miras_cg_server.log 2>&1 &
SRV_PID=$!
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/auth/lookup-student/L0001" 2>/dev/null)" = "200" ] && break; sleep 1; done
MIRAS_CODEGEN_COUNT="${MIRAS_CODEGEN_COUNT:-1000}" node tests/codegen-speed.mjs
exit $?
