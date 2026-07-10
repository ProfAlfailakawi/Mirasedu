// Teacher grade-save persistence flows (run on a fresh seed).
//
// Locks in the fix for the silent grade-loss bug (App.tsx saveTeacherSubmission
// used to swallow a failed save and keep a false "saved" state). These check the
// server contract the client relies on:
//   1. saving a grade persists it and the response echoes the saved value;
//   2. the grade round-trips on a fresh read (no "saved then gone");
//   3. re-grading upserts the SAME row (no duplicate submissions);
//   4. an over-max grade is rejected with a real 4xx (so the client can show a
//      truthful error instead of a false success) and the stored grade is intact;
//   5. the grade endpoint is teacher-session gated — an unauthenticated save
//      cannot silently "succeed".
import { api, makeJar, createReporter, AA, S_A1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / GRADING");

const PROJECT_ID = "proj-grade-flowtest";
const SUB_ID = "sub-grade-flowtest";
const STUDENT_ID = "1001";
const MAX_POINTS = 10;
const dev = "grade-teacher-dev";

const gradeOf = (list, id) => {
  const row = (list || []).find((s) => String(s.id) === id);
  return row ? String(row.grade ?? row.visibleGrade ?? "") : null;
};
const gradeSubmission = (grade) => ({
  id: SUB_ID,
  kind: "project",
  activityId: PROJECT_ID,
  projectId: PROJECT_ID,
  studentId: STUDENT_ID,
  courseCode: S_A1,
  grade,
  status: "graded",
});

// teacher A login — grade endpoints are teacher-session gated.
const tjar = makeJar();
const login = await api("POST", "/api/auth/login", { idNumber: AA, password: "A97852900" }, { jar: tjar, deviceToken: dev });
check("G0a) teacher A login", login.ok && login.data.role === "teacher", `${login.status}`);

// a published project (points=10) so the graded submission targets a real active
// activity and the server derives max=10 from it.
const proj = await api("POST", "/api/teacher/projects",
  { id: PROJECT_ID, title: "مشروع اختبار حفظ الدرجة", courseCode: S_A1, status: "published", points: MAX_POINTS },
  { jar: tjar, deviceToken: dev });
check("G0b) grade-test project published", proj.ok && proj.data.success !== false, `${proj.status} ${JSON.stringify(proj.data).slice(0, 140)}`);

// G1: saving a grade persists it and the response echoes the saved value.
await (async () => {
  const r = await api("POST", "/api/teacher/submissions", gradeSubmission("7"), { jar: tjar, deviceToken: dev });
  check("G1a) grade save returns success", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("G1b) response echoes the saved grade", Number(r.data.submission?.grade) === 7, JSON.stringify(r.data.submission).slice(0, 180));

  const live = await api("GET", `/api/teacher/submissions?studentId=${STUDENT_ID}`, null, { jar: tjar, deviceToken: dev });
  check("G1c) grade persists on read-back (round-trip, no 'saved then gone')", Number(gradeOf(live.data.submissions, SUB_ID)) === 7, JSON.stringify(live.data.submissions).slice(0, 200));
})();

// G2: re-grading the SAME submission upserts in place — new value wins, no duplicate row.
await (async () => {
  const r = await api("POST", "/api/teacher/submissions", gradeSubmission("9"), { jar: tjar, deviceToken: dev });
  check("G2a) re-grade returns success", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);

  const live = await api("GET", `/api/teacher/submissions?studentId=${STUDENT_ID}`, null, { jar: tjar, deviceToken: dev });
  const rows = (live.data.submissions || []).filter((s) => String(s.id) === SUB_ID);
  check("G2b) updated grade persists", Number(gradeOf(live.data.submissions, SUB_ID)) === 9, JSON.stringify(live.data.submissions).slice(0, 200));
  check("G2c) re-grade did not duplicate the submission", rows.length === 1, `count=${rows.length}`);
})();

// G3: an over-max grade is rejected with a real 4xx (this is what lets the client
// surface a truthful error instead of a false "saved"); the stored grade is intact.
await (async () => {
  const r = await api("POST", "/api/teacher/submissions", gradeSubmission(String(MAX_POINTS + 5)), { jar: tjar, deviceToken: dev });
  check("G3a) over-max grade rejected with 400", r.status === 400 && !!r.data.error, `${r.status} ${JSON.stringify(r.data)}`);

  const live = await api("GET", `/api/teacher/submissions?studentId=${STUDENT_ID}`, null, { jar: tjar, deviceToken: dev });
  check("G3b) rejected write left the prior grade intact", Number(gradeOf(live.data.submissions, SUB_ID)) === 9, JSON.stringify(live.data.submissions).slice(0, 200));
})();

// G4: the grade endpoint is teacher-session gated — no session cannot save.
await (async () => {
  const r = await api("POST", "/api/teacher/submissions", gradeSubmission("3"), {});
  check("G4a) unauthenticated grade save is rejected (401)", r.status === 401, `${r.status} ${JSON.stringify(r.data)}`);

  const live = await api("GET", `/api/teacher/submissions?studentId=${STUDENT_ID}`, null, { jar: tjar, deviceToken: dev });
  check("G4b) unauthenticated attempt did not change the grade", Number(gradeOf(live.data.submissions, SUB_ID)) === 9, JSON.stringify(live.data.submissions).slice(0, 200));
})();

done();
