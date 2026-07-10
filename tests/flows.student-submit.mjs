// Student self-submission flows (run on a fresh seed).
//
// The student submits their own project/exercise from their own account. This
// path (POST /api/student/submissions) exists because the teacher grade endpoint
// is session-locked, so a student POST there used to fail silently (401) and the
// teacher never saw the work. These lock in its security contract:
//   1. no student session cannot submit (401);
//   2. a student cannot submit for ANOTHER student (blocked, 401);
//   3. only project/exercise kinds are accepted (else 400);
//   4. a valid submission is saved AND the server force-blanks every grade field
//      + neutralizes a "returned" status — a student can never grade themselves;
//   5. the saved work reaches the teacher's unified submissions view.
import { api, makeJar, createReporter, AA, S_A1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / STUDENT-SUBMIT");

const PROJECT_ID = "proj-studentsubmit-flowtest";
const SUB_ID = "sub-studentsubmit-flowtest";
const SID = "1001";
const TOK = "tok-1001"; // matches the seed device fingerprint for student 1001
const RETURNED_STATUS = "معاد للطالب"; // a status only a teacher may set

// teacher A: publish the project the student will submit against, and read back.
const tjar = makeJar();
const tdev = "ss-teacher-dev";
const login = await api("POST", "/api/auth/login", { idNumber: AA, password: "REDACTED" }, { jar: tjar, deviceToken: tdev });
check("S0a) teacher A login", login.ok && login.data.role === "teacher", `${login.status}`);
const proj = await api("POST", "/api/teacher/projects",
  { id: PROJECT_ID, title: "مشروع تسليم الطالب", courseCode: S_A1, status: "published", points: 10 },
  { jar: tjar, deviceToken: tdev });
check("S0b) project published", proj.ok && proj.data.success !== false, `${proj.status} ${JSON.stringify(proj.data).slice(0, 140)}`);

// student 1001 session (device-locked to TOK)
const sjar = makeJar();
const slogin = await api("POST", "/api/auth/login", { idNumber: SID, password: "pass1001" }, { jar: sjar, deviceToken: TOK });
// student login returns success + a student authToken (role lives inside the
// token, not as a top-level field like the teacher response) — the SS4 submit
// below is the real proof the session authenticates as this student.
check("S0c) student 1001 login", slogin.ok && slogin.data.success === true && typeof slogin.data.authToken === "string", `${slogin.status} ${JSON.stringify(slogin.data).slice(0, 120)}`);

const base = (extra = {}) => ({
  id: SUB_ID, kind: "project", activityId: PROJECT_ID, projectId: PROJECT_ID,
  studentId: SID, courseCode: S_A1, answerText: "حل الطالب", ...extra,
});

// SS1: no student session cannot submit.
await (async () => {
  const r = await api("POST", "/api/student/submissions", base(), {});
  check("SS1) unauthenticated student submit rejected (401)", r.status === 401, `${r.status} ${JSON.stringify(r.data)}`);
})();

// SS2: a student cannot submit on behalf of another student.
await (async () => {
  const r = await api("POST", "/api/student/submissions", base({ studentId: "2002" }), { jar: sjar, deviceToken: TOK });
  check("SS2) cannot submit for another student (blocked)", r.status === 401 || r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);
})();

// SS3: unsupported kind is rejected.
await (async () => {
  const r = await api("POST", "/api/student/submissions", base({ kind: "exam" }), { jar: sjar, deviceToken: TOK });
  check("SS3) unsupported kind rejected (400)", r.status === 400, `${r.status} ${JSON.stringify(r.data)}`);
})();

// SS4: a valid submission saves — and every grade field is force-blanked, a
// "returned" status is neutralized (a student can never grade/return themselves).
await (async () => {
  const r = await api("POST", "/api/student/submissions", base({
    grade: "10", score: "10", visibleGrade: "10", teacherGrade: "10",
    finalGrade: "10", teacherGradeOverride: true, gradedAt: "2020-01-01T00:00:00.000Z",
    status: RETURNED_STATUS,
  }), { jar: sjar, deviceToken: TOK });
  const sub = r.data.submission || {};
  check("SS4a) valid student submission saved", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("SS4b) grade force-blanked (student cannot self-grade)", String(sub.grade ?? "") === "" && String(sub.score ?? "") === "" && String(sub.visibleGrade ?? "") === "", JSON.stringify(sub).slice(0, 220));
  check("SS4c) teacherGradeOverride forced false", sub.teacherGradeOverride === false, JSON.stringify(sub).slice(0, 180));
  check("SS4d) student-set 'returned' status neutralized", String(sub.status || "") !== RETURNED_STATUS, `status=${sub.status}`);
  check("SS4e) submission bound to the session student", String(sub.studentId || "") === SID, `studentId=${sub.studentId}`);
})();

// SS5: the student's work reaches the teacher's unified submissions view.
await (async () => {
  const live = await api("GET", `/api/teacher/submissions?studentId=${SID}`, null, { jar: tjar, deviceToken: tdev });
  const row = (live.data.submissions || []).find((s) => String(s.id) === SUB_ID);
  check("SS5a) teacher sees the student's submission", !!row, JSON.stringify(live.data.submissions).slice(0, 200));
  check("SS5b) it carries no student-set grade in the teacher view", !!row && String(row.grade ?? "") === "", JSON.stringify(row).slice(0, 200));
  check("SS5c) the student's answer text is preserved", !!row && String(row.answerText || "").includes("حل الطالب"), JSON.stringify(row).slice(0, 200));
})();

done();
