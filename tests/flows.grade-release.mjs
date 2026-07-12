// Grade release / reveal flows (run on a fresh seed).
//
// Real teacher workflow: an auto-graded exam score is withheld from the student
// until the teacher releases it. These lock in that gate end-to-end:
//   1. after submit, the teacher sees the real grade but the student-facing
//      visibleGrade is blank (graded internally, withheld);
//   2. only the owning teacher may release the grades (others get 403);
//   3. releasing reveals visibleGrade (== grade) and marks the row graded;
//   4. the student gets a "grade published" bell notification.
//
// Uses seed exam "exam-lock-1" (no review block → grades start unreleased) and
// question "q-lock-1" (correctAnswer "أ", 1pt) on course S_A1.
import { api, makeJar, createReporter, AA, BB } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / GRADE-RELEASE");

const EXAM = "exam-lock-1";
const Q = "q-lock-1";
const SID = "1001", TOK = "tok-1001";

const examSub = (list) => (list || []).find((s) => s.kind === "exam" && String(s.activityId) === EXAM);
const inboxArr = (r) => (Array.isArray(r.data) ? r.data : (r.data.notifications || r.data.items || []));

// logins
const tjar = makeJar(); const tdev = "gr-teacher-dev";
const tlogin = await api("POST", "/api/auth/login", { idNumber: AA, password: "***REDACTED***" }, { jar: tjar, deviceToken: tdev });
check("GR0a) teacher A (owner) login", tlogin.ok && tlogin.data.role === "teacher", `${tlogin.status}`);
const tbjar = makeJar(); const tbdev = "gr-teacherB-dev";
const tblogin = await api("POST", "/api/auth/login", { idNumber: BB, password: "***REDACTED***" }, { jar: tbjar, deviceToken: tbdev });
check("GR0b) teacher B (non-owner) login", tblogin.ok && tblogin.data.role === "teacher", `${tblogin.status}`);
const sjar = makeJar();
const slogin = await api("POST", "/api/auth/login", { idNumber: SID, password: "pass1001" }, { jar: sjar, deviceToken: TOK });
check("GR0c) student 1001 login", slogin.ok && slogin.data.success === true, `${slogin.status}`);

// student takes the exam (correct answer → score 1).
await api("POST", "/api/exam-lock/acquire", { studentId: SID, examId: EXAM, sessionId: "gr-session", deviceId: TOK, displayMode: "pwa" }, { jar: sjar, deviceToken: TOK });
const submit = await api("POST", "/api/quizzes/submit", { studentId: SID, chapterId: EXAM, answers: { [Q]: "أ" }, startTime: Date.now() - 15000, deviceToken: TOK, examSessionId: "gr-session", displayMode: "pwa" }, { jar: sjar, deviceToken: TOK });
check("GR0d) student submits and is scored 1/1", submit.ok && Number(submit.data.submission?.score) === 1, `${submit.status} ${JSON.stringify(submit.data).slice(0, 140)}`);

// GR1: graded internally, but withheld from the student (visibleGrade blank).
await (async () => {
  const live = await api("GET", `/api/teacher/submissions?studentId=${SID}`, null, { jar: tjar, deviceToken: tdev });
  const row = examSub(live.data.submissions);
  check("GR1a) teacher sees the real grade (1)", !!row && Number(row.grade) === 1, JSON.stringify(row).slice(0, 180));
  check("GR1b) student-facing grade is withheld before release (visibleGrade blank)", !!row && String(row.visibleGrade ?? "") === "", `visibleGrade=${row?.visibleGrade}`);
})();

// GR2: only the owning teacher may release grades.
await (async () => {
  const r = await api("POST", `/api/teacher/exams/${EXAM}/release-grades`, {}, { jar: tbjar, deviceToken: tbdev });
  check("GR2) a non-owner teacher cannot release grades (403)", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);
})();

// GR3: the owner releases grades.
await (async () => {
  const r = await api("POST", `/api/teacher/exams/${EXAM}/release-grades`, {}, { jar: tjar, deviceToken: tdev });
  check("GR3) owner releases grades", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
})();

// GR4: releasing reveals the grade to the student side (visibleGrade == grade).
await (async () => {
  const live = await api("GET", `/api/teacher/submissions?studentId=${SID}`, null, { jar: tjar, deviceToken: tdev });
  const row = examSub(live.data.submissions);
  check("GR4) after release the grade is revealed (visibleGrade == 1)", !!row && Number(row.visibleGrade) === 1, JSON.stringify(row).slice(0, 180));
})();

// GR5: the student gets a "grade published" bell notification.
await (async () => {
  const inbox = await api("GET", `/api/notifications/inbox?userId=${SID}&role=student`, null, { jar: sjar, deviceToken: TOK });
  const arr = inboxArr(inbox);
  const found = arr.some((n) => {
    const type = String(n.type || n.data?.type || "").toLowerCase();
    const text = `${n.title || ""} ${n.body || ""}`;
    return type === "grade_released" || type.includes("grade") || /نشر\s+درجت|درجتك/.test(text);
  });
  check("GR5) student gets a 'grade published' notification", found, JSON.stringify(arr).slice(0, 260));
})();

done();
