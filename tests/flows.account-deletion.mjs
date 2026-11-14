// Account deletion REQUEST flow (Apple 5.1.1(v)) — POST /api/account/deletion-request.
// The request only records { userId, role, requested_at, status: "pending" } and
// signs the caller out; it must never touch an academic record, and the demo
// sandbox must answer without persisting anything.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, makeJar, createReporter, BASE, AA, BB } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / ACCOUNT-DELETION-REQUEST");
const TPW = process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci";
const ADMIN = "ah.alfailakawi@paaet.edu.kw";
const URL_PATH = "/api/account/deletion-request";
const DB_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "db.json");
const MESSAGE = "سنحذف حسابك خلال 30 يومًا، وتُحفَظ السجلات الأكاديمية التي تلتزم المؤسسة بحفظها بصيغة مجهولة الهوية.";
const pw = (id) => `pass${id}`; // the seed's fixture password convention
const wrongPw = `bad-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jarAdmin = makeJar();
const adminLogin = await api("POST", "/api/auth/login", { idNumber: ADMIN, password: TPW }, { deviceToken: "dev-admin", jar: jarAdmin });
check("D0a) admin login", adminLogin.ok && adminLogin.data.role === "admin", `${adminLogin.status}`);
const pending = async () => (await api("GET", "/api/monitor/account-deletion-requests", null, { deviceToken: "dev-admin", jar: jarAdmin })).data.items || [];
check("D0b) no requests exist yet", (await pending()).length === 0);

const sjar = makeJar();
const slogin = await api("POST", "/api/auth/login", { idNumber: "1001", password: pw("1001") }, { jar: sjar, deviceToken: "tok-1001" });
check("D0c) student 1001 login", slogin.ok && slogin.data.success === true, `${slogin.status} ${JSON.stringify(slogin.data).slice(0, 100)}`);
const sHeaders = { authorization: `Bearer ${slogin.data.authToken}` };

// D1/D2 — no or invalid session.
let r = await api("POST", URL_PATH, { userId: "1001", password: pw("1001") }, {});
check("D1) no session -> 401", r.status === 401, `${r.status}`);
r = await api("POST", URL_PATH, { userId: "1001", password: pw("1001") }, { headers: { authorization: "Bearer not-a-real-token" } });
check("D2) invalid session -> 401", r.status === 401, `${r.status}`);

// D3/D4 — another user's id, missing id.
r = await api("POST", URL_PATH, { userId: "2002", password: pw("2002") }, { jar: sjar, deviceToken: "tok-1001", headers: sHeaders });
check("D3) other user's id -> 403", r.status === 403, `${r.status}`);
r = await api("POST", URL_PATH, { password: pw("1001") }, { jar: sjar, deviceToken: "tok-1001", headers: sHeaders });
check("D4) missing userId -> 400", r.status === 400, `${r.status}`);

// D5 — wrong password creates nothing.
r = await api("POST", URL_PATH, { userId: "1001", password: wrongPw }, { jar: sjar, deviceToken: "tok-1001", headers: sHeaders });
check("D5a) wrong password -> 401", r.status === 401, `${r.status}`);
check("D5b) no request recorded", (await pending()).length === 0);

// D6 — success records exactly the caller's request and touches nothing else.
await sleep(600);
const before = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
r = await api("POST", URL_PATH, { userId: "1001", password: pw("1001") }, { jar: sjar, deviceToken: "tok-1001", headers: sHeaders });
check("D6a) correct password -> success with the notice", r.ok && r.data.success === true && r.data.message === MESSAGE, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
let items = await pending();
check("D6b) exactly one pending request for the caller",
  items.length === 1 && items[0].userId === "1001" && items[0].role === "student" && items[0].status === "pending", JSON.stringify(items));
check("D6c) record carries no extra personal payload",
  items.length === 1 && Object.keys(items[0]).sort().join(",") === "id,requested_at,role,status,userId", JSON.stringify(items[0]));
await sleep(600);
const after = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
const changed = Object.keys({ ...before, ...after }).filter((k) =>
  !["accountDeletionRequests", "lastUpdated"].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
check("D6d) no other collection changed (students, submissions, exams, grades...)", changed.length === 0, changed.join(","));

// D7 — repeating the request does not duplicate it.
r = await api("POST", URL_PATH, { userId: "1001", password: pw("1001") }, { jar: sjar, deviceToken: "tok-1001", headers: sHeaders });
check("D7) repeated request is idempotent", r.ok && (await pending()).length === 1, `${r.status}`);

// D8 — teachers: own account only, and only the admin can list requests.
const ajar = makeJar();
const alogin = await api("POST", "/api/auth/login", { idNumber: AA, password: TPW }, { jar: ajar, deviceToken: "dev-aa" });
const aHeaders = { authorization: `Bearer ${alogin.data.authToken}` };
r = await api("POST", URL_PATH, { userId: BB, password: TPW }, { jar: ajar, deviceToken: "dev-aa", headers: aHeaders });
check("D8a) teacher cannot request another account -> 403", r.status === 403, `${r.status}`);
r = await api("POST", URL_PATH, { userId: AA, password: TPW }, { jar: ajar, deviceToken: "dev-aa", headers: aHeaders });
check("D8b) teacher own request succeeds", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
items = await pending();
check("D8c) teacher record has role teacher; two requests in total",
  items.length === 2 && items.some((i) => i.userId === AA && i.role === "teacher"), JSON.stringify(items));
r = await api("GET", "/api/monitor/account-deletion-requests", null, { jar: ajar, deviceToken: "dev-aa", headers: aHeaders });
check("D8d) non-admin cannot list requests -> 403", r.status === 403, `${r.status}`);

// D9 — demo sandbox: answers, signs out, persists nothing.
const hosted = async (method, p, { demo, token, body } = {}) => {
  const headers = { "content-type": "application/json", "user-agent": "Mozilla/5.0 (TestRunner)" };
  if (demo) headers["x-miras-demo"] = demo;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, data };
};
const enter = await hosted("POST", "/api/demo/enter");
const demoId = String(enter.data?.sessionId || "");
const asStudent = await hosted("POST", "/api/demo/role", { demo: demoId, body: { role: "student" } });
const demoStudentId = String(asStudent.data?.student?.id || "");
check("D9a) demo student session issued", !!demoId && !!asStudent.data?.authToken && !!demoStudentId, JSON.stringify(asStudent.data).slice(0, 100));
r = await hosted("POST", URL_PATH, { demo: demoId, token: asStudent.data.authToken, body: { userId: demoStudentId } });
check("D9b) demo request answers success without a password", r.status === 200 && r.data.demo === true, `${r.status} ${JSON.stringify(r.data)}`);
check("D9c) demo request persisted nothing", (await pending()).length === 2);

// D10 — rate limit (last: it exhausts this address's budget).
let limited = false;
for (let i = 0; i < 30 && !limited; i++) {
  limited = (await api("POST", URL_PATH, { userId: "1001", password: "x" }, {})).status === 429;
}
check("D10) rate-limited after repeated requests (429)", limited);
done();
