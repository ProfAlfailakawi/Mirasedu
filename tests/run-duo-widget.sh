#!/usr/bin/env bash
# حارس ركن الودجت (iPhone Duo): يشغّل خادمًا محليًا معزولًا (بيئة تجريبية، بلا firebase-applet-config.json)
# ثم tests/duo-widget-corner.mjs بـPlaywright WebKit. محلي فقط: لا يُربط بـCI (تثبيت WebKit غير مدعوم
# على ubuntu-latest الحالي). قبل أول تشغيل:  npx playwright install webkit
#   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:duo-widget
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${DUO_WIDGET_PORT:-3412}"
export MIRAS_TEST_BASE="http://localhost:$PORT"
CFG="firebase-applet-config.json"; CFG_BAK="$CFG.duowidget-bak"
DB="data/db.json"; DB_BAK="$(mktemp)"; SRV_PID=""
restore() {
  [ -n "$SRV_PID" ] && { kill -TERM -"$SRV_PID" >/dev/null 2>&1; kill "$SRV_PID" >/dev/null 2>&1; }
  [ -f "$CFG_BAK" ] && mv -f "$CFG_BAK" "$CFG"
  [ -f "$DB_BAK" ] && { cp -f "$DB_BAK" "$DB" 2>/dev/null || true; rm -f "$DB_BAK"; }
}
trap restore EXIT INT TERM
if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then echo "✋ خادم يعمل على المنفذ $PORT؛ أوقفه أو اضبط DUO_WIDGET_PORT"; exit 2; fi
[ -f "$CFG" ] && mv "$CFG" "$CFG_BAK"
cp -f "$DB" "$DB_BAK" 2>/dev/null || true
node tests/seed.cjs >/dev/null
setsid env DISABLE_HMR=true MIRAS_ALLOW_LOCAL_ONLY_MODE=true MIRAS_TEST_PORT="$PORT" MIRAS_SESSION_SECRET=duo-widget MIRAS_JOIN_CODE_SIGNING_SECRET=duo-widget MIRAS_ROLLCALL_QR_SECRET=duo-widget node node_modules/.bin/tsx server.ts > /tmp/miras_duowidget_server.log 2>&1 &
SRV_PID=$!
for _ in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/auth/lookup-student/1001")" = 200 ] && break; sleep 1; done
node tests/duo-widget-corner.mjs
