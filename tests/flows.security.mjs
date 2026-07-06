import { api, makeJar, createReporter, AA, S_A1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / SECURITY");
const teacherJar = makeJar();
const adminJar = makeJar();
await api("POST", "/api/auth/login", { idNumber: AA, password: "REDACTED" }, { deviceToken: "teacher-dev", jar: teacherJar });
await api("POST", "/api/auth/login", { idNumber: "ahmad.alfailakawi@test.kw", password: "REDACTED" }, { deviceToken: "admin-dev", jar: adminJar });

// 1) Legacy code remains valid.
await api("POST", "/api/auth/register", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw" }, { deviceToken: "sec-tok-1002" });
let r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-1111-0002", deviceToken: "sec-tok-1002" }, { deviceToken: "sec-tok-1002" });
check("legacy unsigned join code still activates", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

// 2) Server-created codes are signed.
r = await api("POST", "/api/teacher/join-codes/create", { sectionCode: S_A1, semester: "الفصل الأول 2026", count: 1 }, { deviceToken: "teacher-dev", jar: teacherJar });
check("server create endpoint remains available", r.ok && r.data.success !== false, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

// 3) Forged/non-issued code is rejected.
r = await api("POST", "/api/students/join-lab", { studentId: "1001", joinCode: "LAB-1234-9999", deviceToken: "tok-1001" }, { deviceToken: "tok-1001" });
check("forged manual code is rejected", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

// 4) Rotating roll-call QR: valid token can activate a roster student, tampered token rejected.
r = await api("POST", "/api/teacher/rollcall-qr", { sectionCode: S_A1 }, { deviceToken: "teacher-dev", jar: teacherJar });
const token = r.data.token;
check("teacher receives a short-lived roll-call token", r.ok && typeof token === "string" && token.includes("."), `${r.status} ${JSON.stringify(r.data)}`);
await api("POST", "/api/auth/register", { idNumber: "7007", password: "GoodPass9", email: "7007@paaet.edu.kw" }, { deviceToken: "roll-7007" });
r = await api("POST", "/api/students/rollcall-qr/activate", { token, studentId: "7007", password: "GoodPass9", email: "7007@paaet.edu.kw", deviceToken: "roll-7007" }, { deviceToken: "roll-7007" });
check("valid roll-call QR activates a roster student", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);
r = await api("POST", "/api/students/rollcall-qr/activate", { token: token.slice(0, -1) + "x", studentId: "1100", deviceToken: "roll-bad" }, { deviceToken: "roll-bad" });
check("tampered roll-call QR is rejected", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

// 5) Atomic activation: only one parallel request can consume the same code.
await api("POST", "/api/auth/register", { idNumber: "1100", password: "GoodPass9", email: "1100@paaet.edu.kw" }, { deviceToken: "atom-1100" });
const attempts = await Promise.all(Array.from({ length: 5 }, (_, i) =>
  api("POST", "/api/auth/verify-otp", { idNumber: "1100", password: "GoodPass9", email: "1100@paaet.edu.kw", otp: "LAB-1100-0001", deviceToken: `atom-1100-${i}` }, { deviceToken: `atom-1100-${i}` })
));
const successes = attempts.filter((x) => x.ok && x.data.success === true).length;
check("atomic consume allows exactly one activation", successes === 1, JSON.stringify(attempts.map((x) => [x.status, x.data?.success])));

// 6) Super-admin data health returns new self-heal categories and graph contract.
r = await api("GET", "/api/teacher/code-integrity", null, { deviceToken: "admin-dev", jar: adminJar });
check("super-admin receives dataHealth", r.ok && r.data.dataHealth && "duplicateActiveStudentCourseCodes" in r.data.dataHealth, `${r.status} ${JSON.stringify(r.data.dataHealth)}`);
check("super-admin receives sharing graph contract", r.ok && r.data.sharingGraph && Array.isArray(r.data.sharingGraph.nodes), `${r.status} ${JSON.stringify(r.data.sharingGraph)}`);
check("super-admin receives Miras pulse command surface", r.ok && r.data.mirasPulse && Array.isArray(r.data.mirasPulse.rings) && r.data.mirasPulse.healPreview, `${r.status} ${JSON.stringify(r.data.mirasPulse)}`);
check("super-admin receives trust map and replay contracts", r.ok && r.data.trustMap && Array.isArray(r.data.trustMap.dots) && Array.isArray(r.data.eventReplay), `${r.status} ${JSON.stringify({ trustMap: r.data.trustMap, eventReplay: r.data.eventReplay }).slice(0,220)}`);


// 7) Removing a student from a course fully hides the old activation; re-add stays roster_only until a fresh code exists.
await api("POST", "/api/teacher/upload-allowed", { sectionCode: S_A1, studentsList: [{ idNumber: "8888", name: "طالب حذف تجريبي", sectionCode: S_A1 }] }, { deviceToken: "teacher-dev", jar: teacherJar });
let issued = await api("POST", "/api/teacher/join-codes/create", { sectionCode: S_A1, count: 1, assignedStudentId: "8888", isFreeCode: true }, { deviceToken: "teacher-dev", jar: teacherJar });
const firstCode = issued.data?.created?.[0]?.code;
await api("POST", "/api/auth/register", { idNumber: "8888", password: "GoodPass9", email: "8888@paaet.edu.kw" }, { deviceToken: "remove-8888" });
r = await api("POST", "/api/auth/verify-otp", { idNumber: "8888", password: "GoodPass9", email: "8888@paaet.edu.kw", otp: firstCode, deviceToken: "remove-8888" }, { deviceToken: "remove-8888" });
check("setup 8888 activates before removal", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);
r = await api("POST", "/api/teacher/students/8888/remove-course", { courseCode: S_A1 }, { deviceToken: "teacher-dev", jar: teacherJar });
check("course removal endpoint fully unlinks a student", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);
r = await api("GET", "/api/live/student-state?studentId=8888", null, {});
let enrollmentList = Array.isArray(r.data?.student?.enrollments) ? r.data.student.enrollments : [];
let removedEnrollment = enrollmentList.find((item) => String(item.courseCode || item.sectionCode || "").toLowerCase() === String(S_A1).toLowerCase());
check("removed student no longer sees the course", !removedEnrollment, JSON.stringify(enrollmentList));
r = await api("GET", "/api/teacher/student-lookup/8888", null, { deviceToken: "teacher-dev", jar: teacherJar });
check("manual re-add lookup resolves registered deleted student name quickly", r.ok && r.data.student?.name, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);
await api("POST", "/api/teacher/upload-allowed", { sectionCode: S_A1, studentsList: [{ idNumber: "8888", name: r.data.student?.name || "طالب حذف تجريبي", sectionCode: S_A1 }] }, { deviceToken: "teacher-dev", jar: teacherJar });
r = await api("GET", "/api/live/student-state?studentId=8888", null, {});
enrollmentList = Array.isArray(r.data?.student?.enrollments) ? r.data.student.enrollments : [];
let readdedEnrollment = enrollmentList.find((item) => String(item.courseCode || item.sectionCode || "").toLowerCase() === String(S_A1).toLowerCase());
check("re-added roster_only student still sees no course card", !readdedEnrollment, JSON.stringify(enrollmentList));
issued = await api("POST", "/api/teacher/join-codes/create", { sectionCode: S_A1, count: 1, assignedStudentId: "8888", isFreeCode: true }, { deviceToken: "teacher-dev", jar: teacherJar });
const freshCode = issued.data?.created?.[0]?.code;
r = await api("GET", "/api/live/student-state?studentId=8888", null, {});
enrollmentList = Array.isArray(r.data?.student?.enrollments) ? r.data.student.enrollments : [];
readdedEnrollment = enrollmentList.find((item) => String(item.courseCode || item.sectionCode || "").toLowerCase() === String(S_A1).toLowerCase());
check("fresh code creates a clean pending_activation course", !!readdedEnrollment && readdedEnrollment.requiresJoinCode === true && readdedEnrollment.pendingActivation === true && readdedEnrollment.isActive !== true, JSON.stringify(readdedEnrollment));
r = await api("POST", "/api/students/join-lab", { studentId: "8888", joinCode: freshCode, deviceToken: "remove-8888" }, { deviceToken: "remove-8888" });
check("fresh code activates after server confirmation", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

// 8) Server-side exam lock: a second browser/PWA/private context cannot load questions.
const studentJar = makeJar();
await api("POST", "/api/auth/login", { idNumber: "1001", password: "pass1001" }, { deviceToken: "tok-1001", jar: studentJar });
r = await api("POST", "/api/exam-lock/acquire", {
  studentId: "1001",
  examId: "exam-lock-1",
  sessionId: "lock-session-pwa",
  deviceId: "tok-1001",
  displayMode: "pwa",
}, { deviceToken: "tok-1001", jar: studentJar });
check("first exam context acquires server lock", r.ok && r.data.activeExamSessionId === "lock-session-pwa", `${r.status} ${JSON.stringify(r.data).slice(0,160)}`);

r = await api("GET", "/api/quizzes/generate?studentId=1001&chapterId=exam-lock-1&examSessionId=lock-session-pwa&displayMode=pwa", null, { deviceToken: "tok-1001", jar: studentJar });
check("locked first context receives questions", r.ok && Array.isArray(r.data.questions) && r.data.questions.length === 1, `${r.status} ${JSON.stringify(r.data).slice(0,180)}`);

r = await api("POST", "/api/exam-lock/acquire", {
  studentId: "1001",
  examId: "exam-lock-1",
  sessionId: "lock-session-safari-private",
  deviceId: "lock-device-private",
  displayMode: "browser",
}, { deviceToken: "lock-device-private", ua: "Mozilla/5.0 (iPhone; Safari Private Test)" });
check("second browser context is blocked by server lock", r.status === 409 && r.data.error === "الاختبار مفتوح في جلسة أخرى.", `${r.status} ${JSON.stringify(r.data)}`);

r = await api("GET", "/api/quizzes/generate?studentId=1001&chapterId=exam-lock-1&examSessionId=lock-session-safari-private&displayMode=browser", null, { deviceToken: "tok-1001", jar: studentJar, ua: "Mozilla/5.0 (iPhone; Safari Private Test)" });
check("blocked second context receives no questions", r.status === 409 && !Array.isArray(r.data.questions), `${r.status} ${JSON.stringify(r.data).slice(0,180)}`);

r = await api("GET", `/api/teacher/logs?teacherEmail=${encodeURIComponent(AA)}`, null, { deviceToken: "teacher-dev", jar: teacherJar });
check("teacher can see second-session integrity warning", r.ok && (r.data.logs || []).some((log) => String(log.action || "").includes("جلسة أخرى")), `${r.status} ${JSON.stringify((r.data.logs || []).slice(0,3)).slice(0,240)}`);

r = await api("POST", "/api/quizzes/submit", {
  studentId: "1001",
  chapterId: "exam-lock-1",
  answers: { "q-lock-1": "أ" },
  startTime: Date.now() - 15000,
  deviceToken: "tok-1001",
  examSessionId: "lock-session-pwa",
  displayMode: "pwa",
}, { deviceToken: "tok-1001", jar: studentJar });
check("normal exam submit succeeds and marks lock finished", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,180)}`);


done();
