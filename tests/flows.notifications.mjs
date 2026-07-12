// Student notification relevance flows (run on a fresh seed).
//
// The owner's original complaint had two halves: important events (new exam)
// weren't arriving, and administrative noise (renaming a course/exam) WAS. These
// lock in both — and guard the 2026-07-08 delivery-gate fix in server.ts:
//   1. publishing a new exam reaches the enrolled student's bell;
//   2. publishing a new project reaches it too (same fix, project side);
//   3. renaming a course takes effect (new name shows in the student's state)
//      yet produces NO bell notification — silent, no admin noise.
import { api, makeJar, createReporter, AA, S_A1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / NOTIFICATIONS");

const EXAM_ID = "exam-notif-flowtest";
const PROJECT_ID = "proj-notif-flowtest";
const NEW_NAME = "مقدمة (أ) — تحديث الاسم";
const SID = "1001", TOK = "tok-1001";

const inboxArr = (r) => (Array.isArray(r.data) ? r.data : (r.data.notifications || r.data.items || []));
const noteType = (n) => String(n.type || n.data?.type || "").toLowerCase();
const noteText = (n) => `${n.title || ""} ${n.body || ""}`;
const enrollmentName = (live, code) => {
  const e = (live.data?.student?.enrollments || live.data?.enrollments || [])
    .find((x) => String(x.courseCode || x.sectionCode || "").toLowerCase() === String(code).toLowerCase());
  return e ? String(e.courseName || "") : "";
};

const examBody = new Date(Date.now() - 3600000).toISOString();
const examClose = new Date(Date.now() + 86400000).toISOString();

// logins
const tjar = makeJar(); const tdev = "notif-teacher-dev";
const tlogin = await api("POST", "/api/auth/login", { idNumber: AA, password: "***REDACTED***" }, { jar: tjar, deviceToken: tdev });
check("N0a) teacher A login", tlogin.ok && tlogin.data.role === "teacher", `${tlogin.status}`);
const sjar = makeJar();
const slogin = await api("POST", "/api/auth/login", { idNumber: SID, password: "pass1001" }, { jar: sjar, deviceToken: TOK });
check("N0b) student 1001 login", slogin.ok && slogin.data.success === true, `${slogin.status}`);

// teacher activity: publish an exam, publish a project, then rename the course.
const exam = await api("POST", "/api/teacher/exams",
  { id: EXAM_ID, title: "اختبار الإشعارات", points: 5, questionsCount: 1, open: examBody, close: examClose, courseCode: S_A1, selectedCategories: ["cat-lock"], seb: { enabled: false }, antiCheat: { timerMinutes: 10 }, createdBy: AA },
  { jar: tjar, deviceToken: tdev });
check("N0c) exam published", exam.ok && exam.data.success === true, `${exam.status} ${JSON.stringify(exam.data).slice(0, 140)}`);

const project = await api("POST", "/api/teacher/projects",
  { id: PROJECT_ID, title: "مشروع الإشعارات", courseCode: S_A1, status: "published", points: 10 },
  { jar: tjar, deviceToken: tdev });
check("N0d) project published", project.ok && project.data.success !== false, `${project.status} ${JSON.stringify(project.data).slice(0, 140)}`);

// rename WITHOUT touching isOpen — a pure administrative rename (must be silent).
const rename = await api("PUT", `/api/teacher/sections/${encodeURIComponent(S_A1)}`,
  { code: "111", courseName: NEW_NAME },
  { jar: tjar, deviceToken: tdev });
check("N0e) course renamed", rename.ok && rename.data.success !== false, `${rename.status} ${JSON.stringify(rename.data).slice(0, 140)}`);

// read the student's bell once, after all the teacher activity.
const inbox = await api("GET", `/api/notifications/inbox?userId=${SID}&role=student`, null, { jar: sjar, deviceToken: TOK });
const arr = inboxArr(inbox);

// N1: new exam reaches the bell (guards the delivery-gate fix).
await (async () => {
  const found = arr.some((n) => noteType(n) === "exam_available" || String(n.examId || n.data?.examId || "") === EXAM_ID || /اختبار\s+(جديد|متاح)/.test(noteText(n)));
  check("N1) new exam reaches the student bell", found, JSON.stringify(arr).slice(0, 260));
})();

// N2: new project reaches the bell (same fix, project side).
await (async () => {
  const found = arr.some((n) => noteType(n) === "project_available" || String(n.projectId || n.data?.projectId || "") === PROJECT_ID || /مشروع\s+جديد/.test(noteText(n)));
  check("N2) new project reaches the student bell", found, JSON.stringify(arr).slice(0, 260));
})();

// N3a: the rename actually took effect for the student (real state change).
await (async () => {
  const live = await api("GET", `/api/live/student-state?studentId=${SID}`, null, { jar: sjar, deviceToken: TOK });
  check("N3a) rename takes effect — student sees the new course name", enrollmentName(live, S_A1) === NEW_NAME, `name=${enrollmentName(live, S_A1)}`);
})();

// N3b: ...yet the rename produced NO bell notification (no administrative noise).
await (async () => {
  const noisy = arr.filter((n) =>
    ["course_updated", "course_renamed", "exam_updated", "exam_renamed", "project_updated", "project_renamed"].includes(noteType(n)) ||
    /تعديل اسم|تغيير اسم|تحديث مقرر|تحديث اختبار|تحديث مشروع|تم تعديل|تم تحديث/.test(noteText(n)));
  check("N3b) renaming a course produces no admin-noise notification", noisy.length === 0, JSON.stringify(noisy).slice(0, 260));
})();

done();
