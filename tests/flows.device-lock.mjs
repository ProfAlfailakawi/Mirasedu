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
  await api("POST", "/api/auth/login", { idNumber: "aa@test.kw", password: "REDACTED" }, { jar: teacherJar, deviceToken: "t-dev" });
  await api("POST", "/api/teacher/upload-allowed", { sectionCode: "111", studentsList: [{ idNumber: "5501", name: "طالب قفل", sectionCode: "111" }] }, { jar: teacherJar, deviceToken: "t-dev" });
  const issued = await api("POST", "/api/teacher/join-codes/create", { sectionCode: "111", count: 1, assignedStudentId: "5501", isFreeCode: true }, { jar: teacherJar, deviceToken: "t-dev" });
  const code = issued.data?.created?.[0]?.code;
  await api("POST", "/api/auth/register", { idNumber: "5501", password: "GoodPass9", email: "5501@paaet.edu.kw" }, { deviceToken: "dev-A" });
  const act = await api("POST", "/api/auth/verify-otp", { idNumber: "5501", password: "GoodPass9", email: "5501@paaet.edu.kw", otp: code, deviceToken: "dev-A" }, { deviceToken: "dev-A", ua: SAFARI_UA });
  check("D5a) student activates on device A", act.ok && act.data.success === true, `${act.status} ${JSON.stringify(act.data).slice(0, 150)}`);
  const b = await api("POST", "/api/auth/login", { idNumber: "5501", password: "GoodPass9" }, { deviceToken: "dev-B", ua: CHROME_UA });
  check("D5b) same student on device B is BLOCKED", !b.ok, `got ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
})();

done();
