// Per-student project deadline extension (run on a fresh seed).
//
// After a project's close date the server refuses submissions. A teacher can
// grant ONE student a private extension: that student alone can submit until the
// given time, the submission is flagged late AND "by extension", other students
// never see who has an extension, and a stale project save cannot wipe the list.
import { api, makeJar, createReporter, AA, BB, S_A1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / PROJECT-EXTENSION");

const PID = "proj-extension-flowtest";
const PID2 = "proj-extension-flowtest-2";
const SID = "1001";
const TOK = "tok-1001";
const closedProject = (id) => ({
  id, title: "مشروع مغلق", courseCode: S_A1, status: "published", points: 10,
  dueDate: "2020-01-01", closeDate: "2020-01-02",
});
const hoursFromNow = (h) => new Date(Date.now() + h * 3600000).toISOString();

const tjar = makeJar(); const tdev = "ext-teacher-dev";
const login = await api("POST", "/api/auth/login", { idNumber: AA, password: (process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci") }, { jar: tjar, deviceToken: tdev });
check("E0a) teacher A login", login.ok && login.data.role === "teacher", `${login.status}`);
const otherJar = makeJar(); const odev = "ext-other-dev";
const otherLogin = await api("POST", "/api/auth/login", { idNumber: BB, password: (process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci") }, { jar: otherJar, deviceToken: odev });
check("E0b) teacher B login", otherLogin.ok, `${otherLogin.status}`);
for (const id of [PID, PID2]) {
  const p = await api("POST", "/api/teacher/projects", closedProject(id), { jar: tjar, deviceToken: tdev });
  check(`E0c) closed project ${id} published`, p.ok && p.data.success !== false, `${p.status} ${JSON.stringify(p.data).slice(0, 120)}`);
}
const sjar = makeJar();
const slogin = await api("POST", "/api/auth/login", { idNumber: SID, password: "pass1001" }, { jar: sjar, deviceToken: TOK });
check("E0d) student 1001 login", slogin.ok && slogin.data.success === true, `${slogin.status}`);
const submit = (id, extra = {}) => api("POST", "/api/student/submissions", {
  id: `project-${id}-${SID}`, kind: "project", activityId: id, projectId: id, studentId: SID,
  courseCode: S_A1, answerText: "حل متأخر", ...extra,
}, { jar: sjar, deviceToken: TOK });
const grant = (id, body, jar = tjar, dev = tdev) =>
  api("POST", `/api/teacher/projects/${id}/extensions`, body, { jar, deviceToken: dev });

// E1: closed project, no extension → rejected.
await (async () => {
  const r = await submit(PID);
  check("E1) submit after close without extension is rejected (403)", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);
})();

// E2: validation and ownership.
await (async () => {
  const past = await grant(PID, { studentIds: [SID], until: hoursFromNow(-1) });
  check("E2a) past until rejected (400)", past.status === 400, `${past.status}`);
  const none = await grant(PID, { studentIds: [], until: hoursFromNow(5) });
  check("E2b) no students rejected (400)", none.status === 400, `${none.status}`);
  const far = await grant(PID, { studentIds: [SID], until: hoursFromNow(24 * 90) });
  check("E2c) more than 60 days rejected (400)", far.status === 400, `${far.status}`);
  const stranger = await grant(PID, { studentIds: ["9999999"], until: hoursFromNow(5) });
  check("E2d) student outside the course rejected (400)", stranger.status === 400, `${stranger.status}`);
  const foreign = await grant(PID, { studentIds: [SID], until: hoursFromNow(5) }, otherJar, odev);
  check("E2e) a teacher who does not own the course cannot grant (403)", foreign.status === 403, `${foreign.status}`);
})();

// E3: grant → only that student can submit, flagged late + by extension.
await (async () => {
  const g = await grant(PID, { studentIds: [SID], until: hoursFromNow(5), note: "عذر مرضي" });
  check("E3a) extension granted", g.ok && g.data.granted === 1, `${g.status} ${JSON.stringify(g.data).slice(0, 160)}`);
  const state = await api("GET", `/api/live/student-state?studentId=${SID}`, null, { jar: sjar, deviceToken: TOK });
  const proj = (state.data.projects || []).find((p) => String(p.id) === PID);
  check("E3b) student sees own extension (myExtensionUntil)", !!proj && Date.parse(proj.myExtensionUntil) > Date.now(), JSON.stringify(proj).slice(0, 220));
  check("E3c) student never receives the extensions list", !!proj && proj.studentExtensions === undefined, JSON.stringify(proj).slice(0, 220));
  const r = await submit(PID);
  const sub = r.data.submission || {};
  check("E3d) extended student can submit after close", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("E3e) submission flagged late", sub.submittedLate === true, JSON.stringify(sub).slice(0, 200));
  check("E3f) submission flagged lateByExtension", sub.lateByExtension === true, JSON.stringify(sub).slice(0, 200));
})();

// E4: a stale project save by the teacher cannot wipe the extensions.
await (async () => {
  const resave = await api("POST", "/api/teacher/projects", { ...closedProject(PID), title: "مشروع مغلق (معدّل)" }, { jar: tjar, deviceToken: tdev });
  const list = await api("GET", "/api/teacher/projects", null, { jar: tjar, deviceToken: tdev });
  const proj = (list.data.projects || []).find((p) => String(p.id) === PID);
  check("E4) re-saving the project keeps its extensions", resave.ok && Array.isArray(proj?.studentExtensions) && proj.studentExtensions.length === 1, JSON.stringify(proj).slice(0, 240));
})();

// E5: revoke → the student is rejected again.
await (async () => {
  const g = await grant(PID2, { studentIds: [SID], until: hoursFromNow(5) });
  check("E5a) second extension granted", g.ok, `${g.status}`);
  const del = await api("DELETE", `/api/teacher/projects/${PID2}/extensions/${SID}`, null, { jar: tjar, deviceToken: tdev });
  check("E5b) extension revoked", del.ok && del.data.removed === 1, `${del.status} ${JSON.stringify(del.data).slice(0, 120)}`);
  const r = await submit(PID2);
  check("E5c) revoked student is rejected again (403)", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);
})();

// E6: a resubmission after the teacher returned the work is never "late".
await (async () => {
  const ret = await api("POST", "/api/teacher/submissions/return", {
    kind: "project", submissionId: `project-${PID}-${SID}`, activityId: PID, projectId: PID,
    studentId: SID, returnNote: "تصحيح خطأ",
  }, { jar: tjar, deviceToken: tdev });
  check("E6a) teacher returned the submission", ret.ok, `${ret.status} ${JSON.stringify(ret.data).slice(0, 160)}`);
  const r = await submit(PID, { answerText: "حل بعد الإرجاع" });
  const sub = r.data.submission || {};
  check("E6b) student can resubmit after return", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("E6c) resubmission is NOT flagged late", sub.submittedLate === false, JSON.stringify(sub).slice(0, 220));
  check("E6d) resubmission is NOT flagged lateByExtension", !sub.lateByExtension, JSON.stringify(sub).slice(0, 220));
  check("E6e) resubmission is flagged resubmittedAfterReturn", sub.resubmittedAfterReturn === true, JSON.stringify(sub).slice(0, 220));
  const retry = await submit(PID, { answerText: "حل بعد الإرجاع" });
  const rsub = retry.data.submission || {};
  check("E6f) an idempotent retry keeps the resubmitted-after-return state (still not late)", retry.ok && rsub.submittedLate === false && !rsub.lateByExtension && rsub.resubmittedAfterReturn === true, `${retry.status} ${JSON.stringify(rsub).slice(0, 220)}`);
})();

// E7: a student who tries to submit after closing is recorded for the teacher only.
await (async () => {
  const list = await api("GET", "/api/teacher/projects", null, { jar: tjar, deviceToken: tdev });
  const proj = (list.data.projects || []).find((p) => String(p.id) === PID2);
  const entry = (proj?.lateAttempts || []).find((a) => String(a.studentId) === SID);
  check("E7a) the rejected late attempt is recorded on the project for the teacher", !!entry && entry.count >= 1 && !!entry.studentName, JSON.stringify(proj?.lateAttempts).slice(0, 200));
  const state = await api("GET", `/api/live/student-state?studentId=${SID}`, null, { jar: sjar, deviceToken: TOK });
  const sproj = (state.data.projects || []).find((p) => String(p.id) === PID2);
  check("E7b) students never receive the late-attempts list", !!sproj && sproj.lateAttempts === undefined, JSON.stringify(sproj).slice(0, 200));
  const again = await submit(PID2);
  const list2 = await api("GET", "/api/teacher/projects", null, { jar: tjar, deviceToken: tdev });
  const entry2 = ((list2.data.projects || []).find((p) => String(p.id) === PID2)?.lateAttempts || []).find((a) => String(a.studentId) === SID);
  check("E7c) an immediate retry does not rewrite the record", again.status === 403 && entry2?.count === entry?.count, `${again.status} ${entry?.count} -> ${entry2?.count}`);
  const resave = await api("POST", "/api/teacher/projects", { ...closedProject(PID2), title: "مشروع مغلق 2 (معدّل)" }, { jar: tjar, deviceToken: tdev });
  const list3 = await api("GET", "/api/teacher/projects", null, { jar: tjar, deviceToken: tdev });
  const kept = (list3.data.projects || []).find((p) => String(p.id) === PID2);
  check("E7d) re-saving the project keeps the recorded attempts", resave.ok && Array.isArray(kept?.lateAttempts) && kept.lateAttempts.length === 1, JSON.stringify(kept?.lateAttempts).slice(0, 200));
})();

done();
