// Student record scope: GET /api/students/:id (and its session-status /
// snapshot siblings) let ANY teacher session through the global middleware,
// so a teacher who does not teach the student must be refused by the handler.
// The record a student or owning teacher receives must never carry the
// password hash (legacy rows are unsalted sha256, i.e. crackable offline).
// Fixtures: tests/seed.cjs — student 1001 is on course S_A1 owned by AA; BB
// does not teach 1001.
import { api, makeJar, createReporter, AA, BB } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / STUDENT RECORD SCOPE");
const spw = (id) => `pass${id}`;
const TPW = process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci";

const jar1001 = makeJar();
const login = await api("POST", "/api/auth/login", { idNumber: "1001", password: spw("1001") }, { deviceToken: "tok-1001", jar: jar1001 });
check("S0) student 1001 logs in", login.ok, `${login.status}`);
check("S1) login response carries no password hash",
  login.ok && login.data.student && !("passwordHash" in login.data.student),
  JSON.stringify(Object.keys(login.data.student || {})).slice(0, 200));
const jarAA = makeJar();
await api("POST", "/api/auth/login", { idNumber: AA, password: TPW }, { deviceToken: "dev-aa", jar: jarAA });
const jarBB = makeJar();
await api("POST", "/api/auth/login", { idNumber: BB, password: TPW }, { deviceToken: "dev-bb", jar: jarBB });

let r = await api("GET", "/api/students/1001", null, { deviceToken: "tok-1001", jar: jar1001 });
check("S2) student 1001 reads own record (200)", r.ok && r.data.student?.id === "1001", `${r.status}`);
check("S3) own record carries no password hash", r.ok && !("passwordHash" in (r.data.student || {})),
  JSON.stringify(Object.keys(r.data.student || {})).slice(0, 200));

r = await api("GET", "/api/students/1001", null, { deviceToken: "dev-aa", jar: jarAA });
check("S4) owning teacher AA reads 1001 (200)", r.ok && r.data.student?.id === "1001", `${r.status}`);
check("S5) teacher view carries no password hash", r.ok && !("passwordHash" in (r.data.student || {})), "");

r = await api("GET", "/api/students/1001", null, { deviceToken: "dev-bb", jar: jarBB });
check("S6) non-owner teacher BB CANNOT read 1001's record (403)", r.status === 403,
  `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

r = await api("GET", "/api/students/1001/session-status", null, { deviceToken: "dev-bb", jar: jarBB });
check("S7) non-owner teacher BB CANNOT read 1001's session status (403)", r.status === 403,
  `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

r = await api("POST", "/api/students/1001/snapshot", { snapshot: "data:image/png;base64,AAAA", purpose: "x" }, { deviceToken: "dev-bb", jar: jarBB });
check("S8) non-owner teacher BB CANNOT overwrite 1001's webcam snapshot (403)", r.status === 403,
  `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

r = await api("GET", "/api/students/1001/session-status", null, { deviceToken: "tok-1001", jar: jar1001 });
check("S9) student keeps own session status (200)", r.ok && r.data.blocked === false, `${r.status}`);

// Exam list scope: exam-lock-1 lives on S_A1 (owned by AA). Other teachers'
// exam titles, schedules and course codes must not reach BB.
r = await api("GET", "/api/teacher/exams", null, { deviceToken: "dev-aa", jar: jarAA });
check("E1) owner AA still lists exam-lock-1", r.ok && (r.data.exams || []).some((e) => e.id === "exam-lock-1"), `${r.status}`);
r = await api("GET", "/api/teacher/exams", null, { deviceToken: "dev-bb", jar: jarBB });
check("E2) non-owner BB does NOT list AA's exam-lock-1", r.ok && !(r.data.exams || []).some((e) => e.id === "exam-lock-1"),
  `${r.status} ${JSON.stringify((r.data.exams || []).map((e) => e.id))}`);
r = await api("GET", "/api/teacher/workspace", null, { deviceToken: "dev-bb", jar: jarBB });
check("E3) BB's workspace does NOT carry AA's exam", r.ok && !(r.data.exams || []).some((e) => e.id === "exam-lock-1"),
  `${r.status} ${JSON.stringify((r.data.exams || []).map((e) => e.id))}`);
r = await api("GET", "/api/teacher/workspace", null, { deviceToken: "dev-aa", jar: jarAA });
check("E4) AA's workspace still carries exam-lock-1", r.ok && (r.data.exams || []).some((e) => e.id === "exam-lock-1"), `${r.status}`);

done();
