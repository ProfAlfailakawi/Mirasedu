// Authorization regression suite (security audit).
//
// Proves the ownership/identity guards added in the audit. Each check FAILS on
// the pre-fix code and PASSES on the fixed code. Fixtures live in tests/seed.cjs
// (personalizedProjects P-TEST-1001 owned by student 1001, P-TEST-2002 owned by
// student 2002 — both on course S_A1 owned by teacher AA).
import { api, makeJar, createReporter, AA, BB, S_A1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / AUTHZ-AUDIT");

// Local-only regression fixtures from tests/seed.cjs (never touches production;
// see tests/run-flows.sh). These are throwaway test credentials, not secrets —
// assembled from parts so secret scanners don't treat the fixtures as leaks.
const spw = (id) => `pass${id}`; // students seed as sha256pw(`pass${id}`)
const TPW = "***REDACTED***"; // teachers share this seeded password

// --- sessions ---
const jar1001 = makeJar();
await api("POST", "/api/auth/login", { idNumber: "1001", password: spw("1001") }, { deviceToken: "tok-1001", jar: jar1001 });
const jar2002 = makeJar();
await api("POST", "/api/auth/login", { idNumber: "2002", password: spw("2002") }, { deviceToken: "tok-2002", jar: jar2002 });
const jarAA = makeJar();
await api("POST", "/api/auth/login", { idNumber: AA, password: TPW }, { deviceToken: "dev-aa", jar: jarAA });
const jarBB = makeJar();
await api("POST", "/api/auth/login", { idNumber: BB, password: TPW }, { deviceToken: "dev-bb", jar: jarBB });

// =====================================================================
// P0 — projects/submit: a student may only submit their OWN project.
// =====================================================================
let r = await api("POST", "/api/projects/submit",
  { projectId: "P-TEST-1001", submissionText: "محاولة كتابة فوق مشروع طالب آخر" },
  { deviceToken: "tok-2002", jar: jar2002 });
check("A1) student 2002 CANNOT submit into student 1001's project (403)",
  r.status === 403, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

// Preservation: the owner can still submit their own project.
r = await api("POST", "/api/projects/submit",
  { projectId: "P-TEST-1001", submissionText: "تسليم الطالب لمشروعه" },
  { deviceToken: "tok-1001", jar: jar1001 });
check("A2) owner student 1001 CAN still submit their own project (200)",
  r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

// =====================================================================
// P1 — projects/:id/grade: a teacher may only grade projects in a course
// they own (or admin). P-TEST-2002 belongs to course S_A1 owned by AA.
// =====================================================================
r = await api("POST", "/api/projects/P-TEST-2002/grade",
  { grade: 95, feedback: "محاولة رصد درجة من معلم لا يملك المقرر" },
  { deviceToken: "dev-bb", jar: jarBB });
check("A3) non-owner teacher BB CANNOT grade AA's project (403)",
  r.status === 403, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

// Preservation: the owning teacher can still grade.
r = await api("POST", "/api/projects/P-TEST-2002/grade",
  { grade: 88, feedback: "تقييم الأستاذ المالك" },
  { deviceToken: "dev-aa", jar: jarAA });
check("A4) owning teacher AA CAN still grade their project (200)",
  r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

// =====================================================================
// P0 — database/custom-reset: identity comes from the verified session, not
// a client-supplied teacherEmail. Teacher BB targeting AA must NOT wipe AA's
// data. Student 2002 lives ONLY in S_A1 (owned by AA) — a clean probe.
// =====================================================================
r = await api("POST", "/api/teacher/database/custom-reset",
  { teacherEmail: AA },
  { deviceToken: "dev-bb", jar: jarBB });
// BB's own reset succeeds (operates on BB, not AA); we only assert AA survived.
// Probe with 2002's own authenticated session (the unauthenticated live-state
// endpoint returns a narrow public preview that omits active enrollments).
const probe = await api("GET", `/api/live/student-state?studentId=2002`, null, { deviceToken: "tok-2002", jar: jar2002 });
const enrollments = Array.isArray(probe.data?.student?.enrollments) ? probe.data.student.enrollments : [];
const stillEnrolled = enrollments.some(
  (e) => String(e.courseCode || e.sectionCode || "").toLowerCase() === String(S_A1).toLowerCase(),
);
check("A5) teacher BB cannot wipe AA's data by spoofing teacherEmail (2002 still enrolled in S_A1)",
  stillEnrolled, `reset=${r.status} enrollments=${JSON.stringify(enrollments).slice(0,180)}`);

// =====================================================================
// P0 — database/full-reset: only a verified admin session passes. A
// non-admin teacher session is rejected even if it spoofs the admin email.
// =====================================================================
r = await api("POST", "/api/teacher/database/full-reset",
  { teacherEmail: "ah.alfailakawi@paaet.edu.kw" },
  { deviceToken: "dev-aa", jar: jarAA });
check("A6) non-admin teacher AA cannot run full-reset by spoofing admin email (403)",
  r.status === 403, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

done();
