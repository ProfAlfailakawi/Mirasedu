// Device-lock regression: a student must be usable from ONE browser/device only.
// Reproduces the owner's report: "the student logged in from Safari + Chrome +
// PWA with no problem." Each of these MUST be rejected once a device is bound.
import { api, makeJar, createReporter } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / DEVICE-LOCK");

const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";

// Seed student 1001 is activated and device-locked to tok-1001 (fingerprint embeds a prior IP).
const S = "1001", PW = "pass1001";

// D1: the ORIGINAL device logs in fine.
let r = await api("POST", "/api/auth/login", { idNumber: S, password: PW }, { deviceToken: "tok-1001", ua: SAFARI_UA });
check("D1) original device (tok-1001 / Safari) logs in", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

// D2: a SECOND browser on the same phone (different device token, Chrome-iOS UA) MUST be blocked.
r = await api("POST", "/api/auth/login", { idNumber: S, password: PW }, { deviceToken: "tok-1001-chrome", ua: CHROME_UA });
check("D2) second browser (Chrome, different token) is BLOCKED", !r.ok, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

// D3: a PWA/third context (yet another token) MUST be blocked.
r = await api("POST", "/api/auth/login", { idNumber: S, password: PW }, { deviceToken: "tok-1001-pwa", ua: SAFARI_UA });
check("D3) third context (PWA, different token) is BLOCKED", !r.ok, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

// D4: the original device STILL works after the blocked attempts (not locked out itself).
r = await api("POST", "/api/auth/login", { idNumber: S, password: PW }, { deviceToken: "tok-1001", ua: SAFARI_UA });
check("D4) original device still works after blocked attempts", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);

// D5: a FRESHLY registered+activated student, then a second device — end to end.
await (async () => {
  const teacherJar = makeJar();
  await api("POST", "/api/auth/login", { idNumber: "aa@test.kw", password: (process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci") }, { jar: teacherJar, deviceToken: "t-dev" });
  await api("POST", "/api/teacher/upload-allowed", { sectionCode: "111", studentsList: [{ idNumber: "5501", name: "طالب قفل", sectionCode: "111" }] }, { jar: teacherJar, deviceToken: "t-dev" });
  const issued = await api("POST", "/api/teacher/join-codes/create", { sectionCode: "111", count: 1, assignedStudentId: "5501", isFreeCode: true }, { jar: teacherJar, deviceToken: "t-dev" });
  const code = issued.data?.created?.[0]?.code;
  await api("POST", "/api/auth/register", { idNumber: "5501", password: "GoodPass9", email: "5501@paaet.edu.kw" }, { deviceToken: "dev-A" });
  const act = await api("POST", "/api/auth/verify-otp", { idNumber: "5501", password: "GoodPass9", email: "5501@paaet.edu.kw", otp: code, deviceToken: "dev-A" }, { deviceToken: "dev-A", ua: SAFARI_UA });
  check("D5a) student activates on device A", act.ok && act.data.success === true, `${act.status} ${JSON.stringify(act.data).slice(0, 150)}`);
  const b = await api("POST", "/api/auth/login", { idNumber: "5501", password: "GoodPass9" }, { deviceToken: "dev-B", ua: CHROME_UA });
  check("D5b) same student on device B is BLOCKED", !b.ok, `got ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
})();

// Rejected login alerts belong to the student, never their course teacher.
const studentJar = makeJar();
await api("POST", "/api/auth/login", { idNumber: S, password: PW }, { jar: studentJar, deviceToken: "tok-1001", ua: SAFARI_UA });
const teacherJar = makeJar();
await api("POST", "/api/auth/login", { idNumber: "aa@test.kw", password: process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci" }, { jar: teacherJar, deviceToken: "t-notice" });
const inbox = (r) => Array.isArray(r.data) ? r.data : (r.data.notifications || r.data.items || []);
const isBlocked = (n) => (n.type || n.data?.type) === "login_blocked";
const studentInbox = await api("GET", `/api/notifications/inbox?userId=${S}&role=student`, null, { jar: studentJar, deviceToken: "tok-1001", ua: SAFARI_UA });
check("D6) rejected login notice reaches the student", studentInbox.ok && inbox(studentInbox).some(isBlocked));
const teacherInbox = await api("GET", "/api/notifications/inbox?userId=aa@test.kw&role=teacher", null, { jar: teacherJar, deviceToken: "t-notice" });
check("D7) rejected student login does not notify the teacher", teacherInbox.ok && !inbox(teacherInbox).some(isBlocked));

// Code-integrity alerts must not fire for students who registered successfully
// and only switch browser/app on their own phone.
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const asBrowser = { "x-miras-display-mode": "browser" };
const asApp = { "x-miras-display-mode": "pwa" };
const integrityAlertsFor = async (name) => {
  const r = await api("GET", "/api/notifications/inbox?userId=aa@test.kw&role=teacher", null, { jar: teacherJar, deviceToken: "t-notice" });
  return inbox(r)
    .filter(n => String(n.type || n.data?.type || "") === "code_integrity")
    .filter(n => n.data?.studentName ? n.data.studentName === name : String(n.body || n.message || "").includes(`للطالب ${name}:`) || String(n.body || n.message || "").startsWith(`${name}:`))
    .map((n) => `${n.title || ""} | ${n.body || n.message || ""}`)
    ;
};
const activateFresh = async (id, name, deviceToken, ua, headers) => {
  await api("POST", "/api/teacher/upload-allowed", { sectionCode: "111", studentsList: [{ idNumber: id, name, sectionCode: "111" }] }, { jar: teacherJar, deviceToken: "t-notice" });
  const issued = await api("POST", "/api/teacher/join-codes/create", { sectionCode: "111", count: 1, assignedStudentId: id, isFreeCode: true }, { jar: teacherJar, deviceToken: "t-notice" });
  const jar = makeJar();
  await api("POST", "/api/auth/register", { idNumber: id, password: "GoodPass9", email: `${id}@paaet.edu.kw` }, { jar, deviceToken, ua, headers });
  const act = await api("POST", "/api/auth/verify-otp", { idNumber: id, password: "GoodPass9", email: `${id}@paaet.edu.kw`, otp: issued.data?.created?.[0]?.code, deviceToken }, { jar, deviceToken, ua, headers });
  return { act, jar };
};

// D8–D11: Android — registered in Chrome, then opens the installed app (same storage => same token).
await (async () => {
  const name = "طالب أندرويد";
  const { act, jar } = await activateFresh("5601", name, "dev-android", ANDROID_UA, asBrowser);
  check("D8a) student activates in the Android browser", act.ok && act.data.success === true, `${act.status} ${JSON.stringify(act.data).slice(0, 150)}`);
  const app = await api("GET", "/api/live/student-state?studentId=5601", null, { jar, deviceToken: "dev-android", ua: ANDROID_UA, headers: asApp });
  const appLogin = await api("POST", "/api/auth/login", { idNumber: "5601", password: "GoodPass9" }, { deviceToken: "dev-android", ua: ANDROID_UA, headers: asApp });
  check("D8b) the installed app on the same phone is still blocked (lock unchanged)", app.status === 409 && appLogin.status === 409, `${app.status} / ${appLogin.status}`);
  const alerts = await integrityAlertsFor(name);
  check("D9) same-phone browser/app switch sends the teacher no code-integrity alert", alerts.length === 0, JSON.stringify(alerts));
  const back = await api("GET", "/api/live/student-state?studentId=5601", null, { jar, deviceToken: "dev-android", ua: ANDROID_UA, headers: asBrowser });
  check("D10) the original browser keeps working", back.ok, `${back.status} ${JSON.stringify(back.data).slice(0, 120)}`);
  const other = await api("POST", "/api/auth/login", { idNumber: "5601", password: "GoodPass9" }, { deviceToken: "dev-android-other", ua: ANDROID_UA, headers: asBrowser });
  const otherAlerts = await integrityAlertsFor(name);
  check("D11) a genuinely different device is blocked AND still alerts the teacher", !other.ok && otherAlerts.length === 1, `${other.status} ${JSON.stringify(otherAlerts)}`);
  check("D11b) browser mismatch notification states evidence without accusing copying or cheating", otherAlerts.length === 1 && /متصفح غير معتمد/.test(otherAlerts[0]) && !/منسوخ|غش/.test(otherAlerts[0]),JSON.stringify(otherAlerts));
})();

// D12: a student on a phone bound to another student — real code, so never a "code trap".
await (async () => {
  const name = "طالب مستعير";
  const { act } = await activateFresh("5602", name, "dev-own-5602", SAFARI_UA, asBrowser);
  check("D12a) student activates on own phone", act.ok && act.data.success === true, `${act.status} ${JSON.stringify(act.data).slice(0, 150)}`);
  const borrowed = await api("POST", "/api/auth/login", { idNumber: "5602", password: "GoodPass9" }, { deviceToken: "tok-1001", ua: SAFARI_UA, headers: asBrowser });
  const alerts = await integrityAlertsFor(name);
  check("D12b) borrowed phone is blocked", !borrowed.ok, `${borrowed.status}`);
  check("D12c) teacher alert names the real reason, not an unissued-code trap",
    alerts.length === 1 && !alerts[0].includes("مصيدة") && alerts[0].includes("جهاز مرتبط بطالب آخر"), JSON.stringify(alerts));
})();

// D13: legacy activation record (token never stored, fingerprint from an older IP).
const spw = (id) => `pass${id}`; // students seed as sha256pw(`pass${id}`)
await (async () => {
  const first = await api("POST", "/api/auth/login", { idNumber: "2002", password: spw("2002") }, { deviceToken: "tok-2002", ua: SAFARI_UA, headers: asBrowser });
  const second = await api("POST", "/api/auth/login", { idNumber: "2002", password: spw("2002") }, { deviceToken: "tok-2002", ua: SAFARI_UA, headers: asBrowser });
  check("D13a) own device logs in on a legacy record after an IP change", first.ok && first.data.success === true, `${first.status} ${JSON.stringify(first.data).slice(0, 150)}`);
  check("D13b) and keeps working on the next login (no self-inflicted lock)", second.ok && second.data.success === true, `${second.status} ${JSON.stringify(second.data).slice(0, 150)}`);
  const alerts = await integrityAlertsFor("طالب آخر");
  check("D13c) no false 'different device fingerprint' alert to the teacher", alerts.length === 0, JSON.stringify(alerts));
})();

// D14: detailed reasons are recorded once, without a generic "third device" log.
await api("POST", "/api/auth/login", { idNumber:"5602",password:"GoodPass9" }, {deviceToken:"tok-1001",ua:SAFARI_UA,headers:asBrowser});
const auditResponse = await api("GET", "/api/teacher/logs", null, {jar:teacherJar,deviceToken:"t-notice"});
const audit = auditResponse.data.logs || [];
check("D14a) audit read succeeds",auditResponse.ok);
check("D14b) no login refusal is labelled as a third device",!audit.some(log=>String(log.details||"").includes("جهاز ثالث")));
const borrowedLogs = audit.filter(log=>String(log.studentId)==="5602" && String(log.details||"").includes("جهاز مرتبط بطالب آخر"));
check("D14c) repeated borrowed-device refusal keeps one detailed audit entry",borrowedLogs.length===1,JSON.stringify(borrowedLogs));
const surfaceLogs = audit.filter(log=>String(log.studentId)==="5601" && log.action==="رفض متصفح/وضع عرض آخر على نفس الجهاز");
check("D14d) same-phone app/browser refusal remains a non-security event",surfaceLogs.length>0 && surfaceLogs.every(log=>log.isViolationWarning===false));
check("D14e) no misleading generic login audit duplicates the validator",!audit.some(log=>log.action==="انتهاك الأجهزة"));

// A student may belong to more than one teacher; account actions use the same
// existing ownership scope as profile management, even for a secondary course.
const secondaryJar = makeJar();
await api("POST", "/api/auth/login", { idNumber: "bb@test.kw", password: process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci" }, { jar: secondaryJar, deviceToken: "t-secondary" });
const unrelatedJar = makeJar();
await api("POST", "/api/auth/login", { idNumber: "dd@test.kw", password: process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci" }, { jar: unrelatedJar, deviceToken: "t-unrelated" });
const deniedReset = await api("POST", "/api/teacher/students/1001/reset-access", { mode: "reset_device" }, { jar: unrelatedJar, deviceToken: "t-unrelated" });
check("D15) unrelated teacher cannot reset a student's device", deniedReset.status === 403);
const secondaryReset = await api("POST", "/api/teacher/students/1001/reset-access", { mode: "reset_device" }, { jar: secondaryJar, deviceToken: "t-secondary" });
check("D16 timing) transfer response reports preparation and durable cloud wait", /prepare;dur=\d/.test(secondaryReset.serverTiming || "") && /cloud;dur=\d/.test(secondaryReset.serverTiming || "") && /total;dur=\d/.test(secondaryReset.serverTiming || ""));
check("D16) secondary-course teacher can request device transfer", secondaryReset.ok && secondaryReset.data.student?.pendingDeviceTransfer === true, `${secondaryReset.status} ${JSON.stringify(secondaryReset.data).slice(0,150)}`);
const oldDevice = await api("GET", "/api/live/student-state?studentId=1001", null, { jar: studentJar, deviceToken: "tok-1001", ua: SAFARI_UA });
check("D17) old background session cannot reclaim the account after transfer", !oldDevice.ok);
const newJar = makeJar();
const newDevice = await api("POST", "/api/auth/login", { idNumber: "1001", password: "pass1001" }, { jar: newJar, deviceToken: "tok-1001-new", ua: CHROME_UA });
check("D18) new device can be approved after authorized transfer", newDevice.ok, `${newDevice.status} ${JSON.stringify(newDevice.data).slice(0,150)}`);

const newHeaders = { authorization: `Bearer ${newDevice.data.authToken || ""}` };
for (let index = 0; index < 3; index++) {
  const live = await api("GET", "/api/live/student-state?studentId=1001", null, { jar: newJar, deviceToken: "tok-1001-new", ua: CHROME_UA, headers: newHeaders });
  check(`D19.${index}) approved new device keeps its session on subsequent live-state requests`, live.ok, `${live.status} ${JSON.stringify(live.data).slice(0,160)}`);
}
const details = await api("GET", "/api/students/1001", null, { jar: newJar, deviceToken: "tok-1001-new", ua: CHROME_UA, headers: newHeaders });
check("D20) new device can load student details immediately after login", details.ok, `${details.status} ${JSON.stringify(details.data).slice(0,160)}`);

done();
