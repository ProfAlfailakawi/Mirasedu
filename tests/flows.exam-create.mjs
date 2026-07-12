// Teacher exam-creation flows (run on a fresh seed).
//
// Creating an exam is a core teacher mutation. These lock in its contract and,
// crucially, that a NEW exam both appears in the enrolled student's live state
// AND lands in their notification inbox (the original "notifications" concern):
//   1. a valid exam is created and returned;
//   2. it appears in the enrolled student's live state (was absent before);
//   3. the enrolled student gets a "new exam" bell notification;
//   4. missing fields (400) and no teacher session (401) are rejected;
//   5. an exam asking for more questions than exist in the bank is rejected (400)
//      with the available/required counts;
//   6. a teacher cannot publish an exam into another teacher's course.
import { api, makeJar, createReporter, AA, S_A1, S_B1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / EXAM-CREATE");

const EXAM_ID = "exam-create-flowtest";
const CATEGORY = "cat-lock"; // seed question q-lock-1 lives here on course S_A1
const SID = "1001", TOK = "tok-1001"; // student enrolled in S_A1

const examBody = (extra = {}) => ({
  id: EXAM_ID,
  title: "اختبار الإنشاء التجريبي",
  points: 5,
  questionsCount: 1,
  open: new Date(Date.now() - 3600000).toISOString(),
  close: new Date(Date.now() + 86400000).toISOString(),
  courseCode: S_A1,
  selectedCategories: [CATEGORY],
  seb: { enabled: false },
  antiCheat: { timerMinutes: 10 },
  createdBy: AA,
  ...extra,
});
const examsOf = (live) => (live.data?.exams || []).map((e) => String(e.id));
const inboxArr = (r) => (Array.isArray(r.data) ? r.data : (r.data.notifications || r.data.items || []));

// logins
const tjar = makeJar();
const tdev = "ec-teacher-dev";
const tlogin = await api("POST", "/api/auth/login", { idNumber: AA, password: "***REDACTED***" }, { jar: tjar, deviceToken: tdev });
check("E0a) teacher A login", tlogin.ok && tlogin.data.role === "teacher", `${tlogin.status}`);
const sjar = makeJar();
const slogin = await api("POST", "/api/auth/login", { idNumber: SID, password: "pass1001" }, { jar: sjar, deviceToken: TOK });
check("E0b) student 1001 login", slogin.ok && slogin.data.success === true, `${slogin.status}`);

// E0c: sanity — the new exam is not present before creation.
await (async () => {
  const before = await api("GET", `/api/live/student-state?studentId=${SID}`, null, { jar: sjar, deviceToken: TOK });
  check("E0c) new exam absent from student state before creation", !examsOf(before).includes(EXAM_ID), JSON.stringify(examsOf(before)));
})();

// E1: create a valid exam.
await (async () => {
  const r = await api("POST", "/api/teacher/exams", examBody(), { jar: tjar, deviceToken: tdev });
  check("E1a) valid exam created", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("E1b) response returns the saved exam on S_A1", String(r.data.exam?.id) === EXAM_ID && String(r.data.exam?.courseCode).toLowerCase() === S_A1, JSON.stringify(r.data.exam).slice(0, 160));
})();

// E2: it now appears in the enrolled student's live state.
await (async () => {
  const after = await api("GET", `/api/live/student-state?studentId=${SID}`, null, { jar: sjar, deviceToken: TOK });
  check("E2) created exam appears in enrolled student's live state", examsOf(after).includes(EXAM_ID), JSON.stringify(examsOf(after)));
})();

// E3: the enrolled student gets a "new exam" bell notification.
await (async () => {
  const inbox = await api("GET", `/api/notifications/inbox?userId=${SID}&role=student`, null, { jar: sjar, deviceToken: TOK });
  const arr = inboxArr(inbox);
  const found = (arr || []).some((n) => {
    const text = `${n.title || ""} ${n.body || ""}`;
    const type = String(n.type || n.data?.type || "");
    const eid = String(n.examId || n.data?.examId || "");
    return type === "exam_available" || eid === EXAM_ID || /اختبار\s+(جديد|متاح)/.test(text);
  });
  check("E3) enrolled student gets a 'new exam' notification", found, JSON.stringify(arr).slice(0, 260));
})();

// E4: missing required fields is rejected.
await (async () => {
  const r = await api("POST", "/api/teacher/exams", examBody({ id: "exam-create-notitle", title: "" }), { jar: tjar, deviceToken: tdev });
  check("E4) missing title rejected (400)", r.status === 400, `${r.status} ${JSON.stringify(r.data)}`);
})();

// E5: no teacher session cannot create.
await (async () => {
  const r = await api("POST", "/api/teacher/exams", examBody({ id: "exam-create-nosession" }), {});
  check("E5) unauthenticated exam create rejected (401)", r.status === 401, `${r.status} ${JSON.stringify(r.data)}`);
})();

// E6: asking for more questions than exist in the bank is rejected with counts.
await (async () => {
  const r = await api("POST", "/api/teacher/exams", examBody({ id: "exam-create-insufficient", questionsCount: 5 }), { jar: tjar, deviceToken: tdev });
  check("E6) not-enough-questions rejected (400) with available/required counts",
    r.status === 400 && Number(r.data.availableQuestions) === 1 && Number(r.data.requiredQuestions) === 5,
    `${r.status} ${JSON.stringify(r.data)}`);
})();

// E7: a teacher cannot publish an exam into another teacher's course (no owned
// questions match that course) — cross-teacher isolation.
await (async () => {
  const r = await api("POST", "/api/teacher/exams", examBody({ id: "exam-create-crosscourse", courseCode: S_B1 }), { jar: tjar, deviceToken: tdev });
  check("E7) teacher A cannot create an exam in teacher B's course", r.status === 400, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  const bLive = await api("GET", `/api/live/student-state?studentId=${SID}`, null, { jar: sjar, deviceToken: TOK });
  check("E7b) the cross-course exam was not created", !examsOf(bLive).includes("exam-create-crosscourse"), JSON.stringify(examsOf(bLive)));
})();

done();
