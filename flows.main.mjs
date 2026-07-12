// Non-destructive flows: new registration, existing student, device/IP,
// multi-teacher new-student journey (A+B+C+D), free single-course codes, transfer.
import {
  api, makeJar, createReporter, AA, BB, CC, DD,
  S_A1, S_A2, S_B1, S_C1, S_D1,
  hasCourse, codesOf, nameFor, ownerFor, isActive, isLocked, anyBareNumberName, anyEmailName,
} from "./lib.mjs";

const { check, done } = createReporter("FLOWS / MAIN");

// ---------------- NEW REGISTRATION ----------------
await (async () => {
  let r = await api("POST", "/api/auth/register", { idNumber: "9999", password: "GoodPass9", email: "9999@paaet.edu.kw" }, { deviceToken: "tok-9999" });
  check("2) new + ID not in any roster -> reject", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

  const reg = await api("POST", "/api/auth/register", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw" }, { deviceToken: "tok-1002" });
  check("reg 1002 (new, in roster) -> ready for code", reg.ok && reg.data.success === true, `${reg.status} ${JSON.stringify(reg.data)}`);

  r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-0000-0000", deviceToken: "tok-1002" }, { deviceToken: "tok-1002" });
  check("3) new + wrong code -> reject", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

  r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-1111-0003", deviceToken: "tok-1002" }, { deviceToken: "tok-1002" });
  check("4) new + code not for his roster -> reject", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

  r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-9999-0009", deviceToken: "tok-1002" }, { deviceToken: "tok-1002" });
  check("5) new + revoked code -> reject", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

  r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-8888-0008", deviceToken: "tok-1002" }, { deviceToken: "tok-1002" });
  check("6) new + expired code -> reject", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

  r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-1111-0002" }, {});
  check("7) new + no deviceToken -> reject", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

  r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-1111-0002", deviceToken: "tok-1001" }, { deviceToken: "tok-1001" });
  check("25) new + device bound to another student -> reject/approval", !r.ok || r.data.pendingDeviceApproval === true, `${r.status} ${JSON.stringify(r.data)}`);

  // roster row WITHOUT teacherEmail (UI-uploaded; owner only in the scoped section code)
  // must still match for activation (owner derived from the section code).
  {
    await api("POST", "/api/auth/register", { idNumber: "7007", password: "GoodPass9", email: "7007@paaet.edu.kw" }, { deviceToken: "tok-7007" });
    const r7 = await api("POST", "/api/auth/verify-otp", { idNumber: "7007", password: "GoodPass9", email: "7007@paaet.edu.kw", otp: "LAB-7007-0001", deviceToken: "tok-7007" }, { deviceToken: "tok-7007" });
    check("0) roster row without teacherEmail still activates (owner from section code)", r7.ok && r7.data.success === true && hasCourse(r7.data.student, S_A1), `${r7.status} ${JSON.stringify(r7.data).slice(0,160)}`);
  }

  r = await api("POST", "/api/auth/verify-otp", { idNumber: "1002", password: "GoodPass9", email: "1002@paaet.edu.kw", otp: "LAB-1111-0002", deviceToken: "tok-1002" }, { deviceToken: "tok-1002" });
  check("1) new + roster + valid code -> success", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("1b/27) course shows immediately (no logout)", hasCourse(r.data.student, S_A1), `codes=${JSON.stringify(codesOf(r.data.student))}`);
  check("30) name shown (not email)", !anyEmailName(r.data.student), JSON.stringify((r.data.student || {}).enrollments));
})();

// ---------------- EXISTING STUDENT (1001) ----------------
const jar1001 = makeJar();
await (async () => {
  let r = await api("POST", "/api/auth/register", { idNumber: "1001", password: "pass1001", email: "1001@paaet.edu.kw" }, { deviceToken: "tok-1001" });
  check("8) existing activated tries register -> blocked", !r.ok && !r.data.success && !r.data.existingStudent, `${r.status} ${JSON.stringify(r.data)}`);
  check("8b) block message guides to login", /سجّل الدخول|سجل الدخول|تسجيل الدخول/.test(String(r.data.error || "")), JSON.stringify(r.data));

  r = await api("POST", "/api/auth/login", { idNumber: "1001", password: "WRONG" }, { deviceToken: "tok-1001" });
  check("10) existing + wrong password -> reject", !r.ok, `${r.status}`);

  r = await api("POST", "/api/auth/login", { idNumber: "1001", password: "pass1001" }, { deviceToken: "tok-1001", jar: jar1001 });
  check("9/23) login same device, changed IP -> success", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);

  // self-heal: login prunes ghost (deleted/renamed) course codes from the stored cloud record
  {
    const live = await api("GET", "/api/live/student-state?studentId=1001", null, {});
    const codes = (((live.data.student || {}).activatedCourseCodes) || []).map((c) => String(c).toLowerCase());
    check("HEAL) login self-heals cloud: ghost codes pruned from activatedCourseCodes",
      !codes.includes("777-ghost@test.kw") && !codes.includes("111-oldname@test.kw"), JSON.stringify(codes));
  }

  r = await api("POST", "/api/students/1001/activate-course", { code: "LAB-2222-0002", deviceToken: "tok-1001" }, { deviceToken: "tok-1001", jar: jar1001 });
  check("11/12) add same-teacher course A222 -> success", r.ok && r.data.success === true && hasCourse(r.data.student, S_A2), `${r.status} ${JSON.stringify(codesOf(r.data.student))}`);
  check("28) prior course A111 NOT dropped", hasCourse(r.data.student, S_A1), JSON.stringify(codesOf(r.data.student)));

  r = await api("POST", "/api/students/1001/activate-course", { code: "LAB-1111-0003", deviceToken: "tok-1001" }, { deviceToken: "tok-1001", jar: jar1001 });
  check("13) add OTHER-teacher course B111 (in roster) -> success", r.ok && r.data.success === true && hasCourse(r.data.student, S_B1), `${r.status} ${JSON.stringify(codesOf(r.data.student))}`);
  check("22) A111,A222,B111 present & separate", [S_A1, S_A2, S_B1].every((c) => hasCourse(r.data.student, c)), JSON.stringify(codesOf(r.data.student)));
  check("20/21) B111 owned by teacher B, A111 by teacher A", ownerFor(r.data.student, S_B1) === BB && ownerFor(r.data.student, S_A1) === AA, `B=${ownerFor(r.data.student, S_B1)} A=${ownerFor(r.data.student, S_A1)}`);

  r = await api("POST", "/api/students/1001/activate-course", { code: "LAB-4444-0004", deviceToken: "tok-1001" }, { deviceToken: "tok-1001", jar: jar1001 });
  check("14) add code for course not in roster -> reject (actionable msg)", !r.ok && /راجع أستاذ المقرر/.test(String(r.data.error || "")), `${r.status} ${JSON.stringify(r.data)}`);

  r = await api("POST", "/api/students/1001/activate-course", { code: "LAB-7777-0007", deviceToken: "tok-1001" }, { deviceToken: "tok-1001", jar: jar1001 });
  check("15) other student's used code -> reject", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);

  r = await api("POST", "/api/students/1001/activate-course", { code: "LAB-1111-0001", deviceToken: "tok-1001" }, { deviceToken: "tok-1001", jar: jar1001 });
  check("16) re-enter own used code same device -> handled (ok, course kept)", r.ok && hasCourse(r.data.student, S_A1), `${r.status}`);

  r = await api("POST", "/api/students/1001/activate-course", { code: "LAB-2222-0002", deviceToken: "tok-OTHER" }, { deviceToken: "tok-OTHER" });
  check("17/24) different device -> reject/approval", !r.ok || r.data.pendingDeviceApproval === true, `${r.status} ${JSON.stringify(r.data)}`);
})();

// ---------------- MULTI-TEACHER NEW-STUDENT JOURNEY (Q2): A + B + C + D ----------------
await (async () => {
  // Step 1: brand-new 1100 registers + activates the platform with teacher A's code.
  await api("POST", "/api/auth/register", { idNumber: "1100", password: "GoodPass9", email: "1100@paaet.edu.kw" }, { deviceToken: "tok-1100" });
  let r = await api("POST", "/api/auth/verify-otp", { idNumber: "1100", password: "GoodPass9", email: "1100@paaet.edu.kw", otp: "LAB-1100-0001", deviceToken: "tok-1100" }, { deviceToken: "tok-1100" });
  check("J1) new multi-roster student activates platform with first code -> success", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,140)}`);
  check("J2) course A active right away", isActive(r.data.student, S_A1), JSON.stringify(r.data.student?.enrollments));
  // Step 2: roster-only courses do not appear until each course has a fresh code/activation.
  check("J3) only activated A appears after first code", hasCourse(r.data.student, S_A1) && !hasCourse(r.data.student, S_B1) && !hasCourse(r.data.student, S_C1) && !hasCourse(r.data.student, S_D1), JSON.stringify(codesOf(r.data.student)));
  check("J4) no fake locked roster-only cards for B/C/D", !isLocked(r.data.student, S_B1) && !isLocked(r.data.student, S_C1) && !isLocked(r.data.student, S_D1), JSON.stringify(r.data.student?.enrollments?.map(e=>[e.courseCode,e.status])));
  check("J5) visible course keeps name + correct owner",
    nameFor(r.data.student, S_A1) === "مقدمة (أ)" && ownerFor(r.data.student, S_A1) === AA, JSON.stringify(r.data.student?.enrollments));
  check("J6) no bare numbers / no emails in path", !anyBareNumberName(r.data.student) && !anyEmailName(r.data.student), JSON.stringify(r.data.student?.enrollments?.map(e=>e.courseName)));

  // Step 3: he adds teacher B's course with B's code -> B becomes active, A stays active, C/D still hidden roster_only.
  r = await api("POST", "/api/students/join-lab", { studentId: "1100", joinCode: "LAB-1100-0002", deviceToken: "tok-1100" }, { deviceToken: "tok-1100" });
  check("J7) add second course (teacher B) by its code -> success", r.ok && r.data.success === true && isActive(r.data.student, S_B1), `${r.status} ${JSON.stringify(codesOf(r.data.student))}`);
  check("J8) A still active, C/D still hidden roster_only", isActive(r.data.student, S_A1) && !hasCourse(r.data.student, S_C1) && !hasCourse(r.data.student, S_D1), JSON.stringify(r.data.student?.enrollments?.map(e=>[e.courseCode,e.status])));
})();

// ---------------- FREE (single-course) CODES + TRANSFER ----------------
await (async () => {
  // free code tied to ONE course (A222), used by an eligible NEW student 1005 (only in A222 roster)
  await api("POST", "/api/auth/register", { idNumber: "1005", password: "GoodPass9", email: "1005@paaet.edu.kw" }, { deviceToken: "tok-1005" });
  let r = await api("POST", "/api/auth/verify-otp", { idNumber: "1005", password: "GoodPass9", email: "1005@paaet.edu.kw", otp: "LAB-3333-0003", deviceToken: "tok-1005" }, { deviceToken: "tok-1005" });
  check("F1) single-course FREE code opens its one course (A222)", r.ok && r.data.success === true && hasCourse(r.data.student, S_A2), `${r.status} ${JSON.stringify(codesOf(r.data.student))}`);

  // free single-course code for course C used by the MULTI-course student 1100 -> opens C only (no "first roster" ambiguity)
  r = await api("POST", "/api/students/join-lab", { studentId: "1100", joinCode: "LAB-1100-0009", deviceToken: "tok-1100" }, { deviceToken: "tok-1100" });
  check("F2) FREE code opens its OWN course (C) for a multi-course student, not the first roster", r.ok && r.data.success === true && isActive(r.data.student, S_C1), `${r.status} ${JSON.stringify(codesOf(r.data.student))}`);

  // device transfer: new device adopted, old retired device rejected
  const jarNew = makeJar();
  r = await api("POST", "/api/auth/login", { idNumber: "3003", password: "pass3003" }, { deviceToken: "tok-3003-new", jar: jarNew });
  check("26a) transfer: new device adopted -> success", r.ok && r.data.success === true, `${r.status}`);
  r = await api("POST", "/api/auth/login", { idNumber: "3003", password: "pass3003" }, { deviceToken: "tok-3003-old" });
  check("26b) transfer: old retired device -> rejected", !r.ok, `${r.status}`);
})();

// ---------------- PROJECT SUBMISSIONS ----------------
await (async () => {
  const generated = await api("POST", "/api/projects/generate", { studentId: "1001" }, { deviceToken: "tok-1001", jar: jar1001 });
  const project = generated.data?.project;
  check("P1) student personalized project generated", generated.ok && !!project?.id, `${generated.status} ${JSON.stringify(generated.data).slice(0, 160)}`);

  const submitted = await api("POST", "/api/projects/submit", {
    projectId: project?.id,
    submissionText: "رابط المشروع النهائي",
    submissionFileName: "project-final.pdf",
    submissionFile: "data:application/pdf;base64,JVBERi0xLjQK",
  }, { deviceToken: "tok-1001", jar: jar1001 });
  check("P2) project submit creates teacher submission row", submitted.ok && submitted.data?.submission?.source === "personalized_project", `${submitted.status} ${JSON.stringify(submitted.data).slice(0, 180)}`);

  const submissionCourse = submitted.data?.submission?.courseCode || project?.sectionCode || S_A1;
  const teacherJar = makeJar();
  await api("POST", "/api/auth/login", { idNumber: "ahmad.alfailakawi@test.kw", password: "***REDACTED***" }, { jar: teacherJar, deviceToken: "admin-project-check" });
  const teacherRows = await api("GET", `/api/teacher/submissions?courseCode=${encodeURIComponent(submissionCourse)}`, null, { jar: teacherJar, deviceToken: "admin-project-check" });
  const row = (teacherRows.data?.submissions || []).find((item) =>
    item.kind === "project" &&
    String(item.activityId) === String(project?.id) &&
    String(item.studentId) === "1001"
  );
  check("P3) teacher sees submitted project in submissions", !!row && row.status === "مقفل بعد التسليم", JSON.stringify((teacherRows.data?.submissions || []).map((item) => [item.kind, item.activityId, item.studentId, item.status])).slice(0, 260));
})();

done();
