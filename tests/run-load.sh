#!/usr/bin/env bash
# Safe load test for the hot student-polling path (/api/live/student-state).
# SAFETY (identical guarantees to run-flows.sh — NEVER touches production):
#   1. refuses to run if a server is already listening on the port;
#   2. moves firebase-applet-config.json aside (server runs LOCAL-ONLY);
#   3. backs up data/db.json and restores it afterwards (trap on any exit).
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${MIRAS_TEST_PORT:-3000}"
CFG="firebase-applet-config.json"
CFG_BAK="$CFG.loadtest-bak"
DB="data/db.json"
DB_BAK="$(mktemp)"
SRV_PID=""

restore() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" >/dev/null 2>&1
  [ -f "$CFG_BAK" ] && mv -f "$CFG_BAK" "$CFG"
  [ -f "$DB_BAK" ] && { cp -f "$DB_BAK" "$DB" 2>/dev/null || true; rm -f "$DB_BAK"; }
}
trap restore EXIT INT TERM

if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "✋ A server is already running on port $PORT. Stop it first, then re-run."
  exit 2
fi

[ -e "$CFG_BAK" ] && rm -rf "$CFG_BAK"
[ -f "$CFG" ] && mv "$CFG" "$CFG_BAK"
cp -f "$DB" "$DB_BAK" 2>/dev/null || true

echo "Seeding ${MIRAS_LOAD_STUDENTS:-1000} students..."
MIRAS_LOAD_STUDENTS="${MIRAS_LOAD_STUDENTS:-1000}" node tests/seed-load.cjs

echo "Starting local server (local-only mode)..."
env DISABLE_HMR=true MIRAS_ALLOW_LOCAL_ONLY_MODE=true \
  MIRAS_JOIN_CODE_SIGNING_SECRET="load-test-secret" MIRAS_ROLLCALL_QR_SECRET="load-test-secret" \
  node node_modules/.bin/tsx server.ts > /tmp/miras_loadtest_server.log 2>&1 &
SRV_PID=$!

for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/auth/lookup-student/L0001" 2>/dev/null)" = "200" ] && break
  sleep 1
done

MIRAS_LOAD_STUDENTS="${MIRAS_LOAD_STUDENTS:-1000}" \
MIRAS_LOAD_CONCURRENCY="${MIRAS_LOAD_CONCURRENCY:-200}" \
MIRAS_LOAD_TOTAL="${MIRAS_LOAD_TOTAL:-5000}" \
  node tests/load-test.mjs
code=$?

echo ""
[ "$code" -eq 0 ] && echo "🎉 LOAD TEST PASSED" || echo "⚠️ LOAD TEST flagged issues (see verdict above)"
exit "$code"
