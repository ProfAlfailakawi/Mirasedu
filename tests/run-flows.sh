#!/usr/bin/env bash
# Safe regression runner for the Miras student flows.
#
# SAFETY: This NEVER touches production data.
#   1. It refuses to run if a server is already listening on the port (so it can
#      never accidentally hit your live server / production Firestore).
#   2. It moves firebase-applet-config.json aside (server runs LOCAL-ONLY).
#   3. It backs up data/db.json and restores it afterwards.
#   A trap restores everything on any exit (success, failure, or Ctrl-C).
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${MIRAS_TEST_PORT:-3000}"
CFG="firebase-applet-config.json"
CFG_BAK="$CFG.flowtest-bak"
DB="data/db.json"
DB_BAK="$(mktemp)"
SRV_PID=""

restore() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" >/dev/null 2>&1
  [ -f "$CFG_BAK" ] && mv -f "$CFG_BAK" "$CFG"
  [ -f "$DB_BAK" ] && { cp -f "$DB_BAK" "$DB" 2>/dev/null || true; rm -f "$DB_BAK"; }
}
trap restore EXIT INT TERM

# 1) refuse to run against an already-running server (protects production)
if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "✋ A server is already running on port $PORT. Stop it first, then re-run."
  echo "   (This guard prevents the tests from ever hitting your live server.)"
  exit 2
fi

# 2) isolate Firestore (local-only) + 3) back up the local DB
[ -e "$CFG_BAK" ] && rm -rf "$CFG_BAK"
[ -f "$CFG" ] && mv "$CFG" "$CFG_BAK"
cp -f "$DB" "$DB_BAK" 2>/dev/null || true

start_server() {
  if command -v setsid >/dev/null 2>&1; then
    setsid env DISABLE_HMR=true MIRAS_ALLOW_LOCAL_ONLY_MODE=true MIRAS_SESSION_SECRET="flow-test-session-secret" MIRAS_JOIN_CODE_SIGNING_SECRET="flow-test-signing-secret" MIRAS_ROLLCALL_QR_SECRET="flow-test-rollcall-secret" node node_modules/.bin/tsx server.ts > /tmp/miras_flowtest_server.log 2>&1 &
  else
    env DISABLE_HMR=true MIRAS_ALLOW_LOCAL_ONLY_MODE=true MIRAS_SESSION_SECRET="flow-test-session-secret" MIRAS_JOIN_CODE_SIGNING_SECRET="flow-test-signing-secret" MIRAS_ROLLCALL_QR_SECRET="flow-test-rollcall-secret" node node_modules/.bin/tsx server.ts > /tmp/miras_flowtest_server.log 2>&1 &
  fi
  SRV_PID=$!
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/auth/lookup-student/1001" 2>/dev/null)" = "200" ] && return 0
    sleep 1
  done
  echo "❌ server did not become ready; see /tmp/miras_flowtest_server.log"; return 1
}
stop_server() {
  if [ -n "$SRV_PID" ]; then
    kill -TERM -"$SRV_PID" >/dev/null 2>&1 || true
    kill "$SRV_PID" >/dev/null 2>&1 || true
  fi
  SRV_PID=""
  sleep 1
}
overall=0
run_group() { # <label> <test-file>
  stop_server
  node "${2:-tests/seed.cjs}" >/dev/null
  start_server || { overall=1; return; }
  node "$1" || overall=1
}

run_group tests/flows.main.mjs
run_group tests/flows.lifecycle.mjs
run_group tests/flows.security.mjs
run_group tests/flows.general-codes.mjs tests/seed-general-codes.cjs
run_group tests/flows.code-lifecycle.mjs tests/seed-code-lifecycle.cjs
run_group tests/flows.code-archive.mjs tests/seed-code-lifecycle.cjs
run_group tests/flows.code-scan.mjs tests/seed-code-lifecycle.cjs
run_group tests/flows.typed-lookalike.mjs
run_group tests/flows.code-scan-orphan-lookalike.mjs tests/seed-orphan-code.cjs
run_group tests/flows.code-scan-retired-states.mjs tests/seed-retired-code-states.cjs
run_group tests/flows.learning-intelligence.mjs
run_group tests/flows.grading.mjs
run_group tests/flows.student-submit.mjs
run_group tests/flows.quiz-grading.mjs
run_group tests/flows.exam-create.mjs
run_group tests/flows.notifications.mjs
run_group tests/flows.teacher-notifications.mjs tests/seed-notification-scope.cjs
run_group tests/flows.password-resets.mjs
run_group tests/flows.grade-release.mjs
run_group tests/flows.device-lock.mjs tests/seed-device-lock.cjs
run_group tests/flows.device-transfer-lookup.mjs tests/seed-device-lookup.cjs
run_group tests/flows.device-transfer.mjs
run_group tests/flows.passkey-enroll.mjs
run_group tests/flows.public-device-login.mjs
run_group tests/flows.cloud-workspace.mjs
run_group tests/flows.audit-scope.mjs tests/seed-audit-scope.cjs
run_group tests/flows.authz-audit.mjs
run_group tests/flows.demo-hosting.mjs
run_group tests/flows.login-ip-limit.mjs
run_group tests/flows.login-identify.mjs tests/seed-login-identify.cjs
node node_modules/.bin/tsx --test tests/general-code-reset.test.mjs || overall=1
node node_modules/.bin/tsx tests/flows.arabic-text.mjs || overall=1
node node_modules/.bin/tsx --test tests/device-audit.test.ts || overall=1
node node_modules/.bin/tsx --test tests/device-review-notifications.test.ts || overall=1
node node_modules/.bin/tsx --test tests/teacher-account-scope.test.ts || overall=1
node node_modules/.bin/tsx --test tests/device-transfer-copy.test.ts || overall=1
node node_modules/.bin/tsx --test tests/old-safari-regex.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/student-lock-signal.test.ts || overall=1
node node_modules/.bin/tsx --test tests/atomic-cloud-write.test.ts || overall=1
node node_modules/.bin/tsx --test tests/record-chunks.test.ts || overall=1
node node_modules/.bin/tsx --test tests/record-chunk-sync.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/login-ip-limit.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/join-code-activated.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/cloud-mutation-barrier.test.ts || overall=1
node node_modules/.bin/tsx --test tests/cloud-request-latency.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/enrollment-read-latency.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/response-cloud-barrier.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/cloud-sync-listener.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/login-cloud-loaders.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/login-reveal-timing.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/cloud-data-ready.test.ts || overall=1
node node_modules/.bin/tsx --test tests/journey-reveal.test.ts || overall=1
node node_modules/.bin/tsx --test tests/journey-reveal-render.test.tsx || overall=1
node node_modules/.bin/tsx --test tests/cloud-readiness-probe.test.ts || overall=1
node node_modules/.bin/tsx --test tests/password-reset-routing.test.ts || overall=1
node node_modules/.bin/tsx --test tests/home-password-reset-requests.test.ts || overall=1
node node_modules/.bin/tsx --test tests/password-reset-retention.test.ts || overall=1
node node_modules/.bin/tsx --test tests/teacher-notification-scope.test.ts || overall=1
node node_modules/.bin/tsx --test tests/notification-identity.test.ts || overall=1
node node_modules/.bin/tsx --test tests/teacher-notification-delivery.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/teacher-notification-feed.test.mjs || overall=1
node node_modules/.bin/tsx --test tests/course-activation-count.test.ts || overall=1
node node_modules/.bin/tsx --test tests/flows.demo-orphan.mjs || overall=1
node node_modules/.bin/tsx --test tests/flows.demo-coursework.mjs || overall=1
node node_modules/.bin/tsx --test tests/flows.demo-screens.mjs || overall=1
stop_server

echo ""
if [ "$overall" -eq 0 ]; then echo "🎉 ALL FLOW GROUPS PASSED"; else echo "❌ SOME FLOW CHECKS FAILED (see above)"; fi
exit "$overall"
