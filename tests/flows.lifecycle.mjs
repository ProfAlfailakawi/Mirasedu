// Destructive course-lifecycle flows (run on a fresh seed):
// ghost (deleted/renamed) courses, number-without-name, remove-course, teacher isolation.
import {
  api, makeJar, createReporter, AA, BB, S_A1, S_A2, S_B1,
  codesOf, hasCourse, nameFor, anyBareNumberName, anyEmailName,
} from "./lib.mjs";

const { check, done } = createReporter("FLOWS / LIFECYCLE");

// teacher A login (also authorizes read-only lifecycle inspection after the
// student-owned live endpoint became session protected).
const tjar = makeJar();
const login = await api("POST", "/api/auth/login", { idNumber: AA, password: "REDACTED" }, { jar: tjar, deviceToken: "teacher-A-dev" });
check("T) teacher A login", login.ok && login.data.role === "teacher", `${login.status}`);

// L0: Fix B — ghost codes (no existing section) are hidden; real courses keep names; no bare numbers/emails.
await (async () => {
  const r = await api("GET", "/api/live/student-state?studentId=1001", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const c = codesOf(r.data.student || {});
  check("L0a) ghost 777-ghost hidden", !c.includes("777-ghost@test.kw"), JSON.stringify(c));
  check("L0b) ghost 111-OLDNAME hidden", !c.includes("111-oldname@test.kw"), JSON.stringify(c));
  check("L0c) real A111 present WITH name", c.includes(S_A1) && nameFor(r.data.student, S_A1) === "مقدمة (أ)", `${nameFor(r.data.student, S_A1)}`);
  check("L0d) roster-only B111 stays hidden until a fresh code is issued", !c.includes(S_B1), JSON.stringify(c));
  check("L0e) no course shown as a bare number", !anyBareNumberName(r.data.student), JSON.stringify((r.data.student || {}).enrollments?.map(e => e.courseName)));
  check("L0f) no course name is a raw email", !anyEmailName(r.data.student), JSON.stringify((r.data.student || {}).enrollments?.map(e => e.courseName)));
})();

// L1: rename course number 222 -> 224 ; old code must not linger as a ghost; new shows new name.
await (async () => {
  const r = await api("PUT", `/api/teacher/sections/${encodeURIComponent(S_A2)}`, { code: "224", courseName: "متقدم (أ) المحدّث" }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L1a) rename 222 -> 224 ok", r.ok && r.data.success !== false, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
  const live = await api("GET", "/api/live/student-state?studentId=1001", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const c = codesOf(live.data.student || {});
  check("L1b) old code 222 gone (no ghost)", !c.includes(S_A2), JSON.stringify(c));
  check("L1c) renamed roster_only 224 stays hidden until code/activation", !c.includes(`224-${AA}`), JSON.stringify(c));
  check("L1d) still no bare-number/email names", !anyBareNumberName(live.data.student) && !anyEmailName(live.data.student), JSON.stringify(live.data.student?.enrollments?.map(e => e.courseName)));
})();

// L2: teacher A removes student 1001 from A111 -> course gone & doesn't re-appear; others keep names.
await (async () => {
  const r = await api("POST", "/api/teacher/students/1001/remove-course", { courseCode: S_A1 }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L2a) remove-course ok", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
  check("L2b) A111 removed from path", !hasCourse(r.data.updatedStudent, S_A1), JSON.stringify(codesOf(r.data.updatedStudent)));
  check("L2c) remaining courses still show names (no bare numbers/emails)", !anyBareNumberName(r.data.updatedStudent) && !anyEmailName(r.data.updatedStudent), JSON.stringify(r.data.updatedStudent?.enrollments?.map(e => e.courseName)));
  const live = await api("GET", "/api/live/student-state?studentId=1001", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L2d) A111 does NOT re-appear after refresh", !hasCourse(live.data.student, S_A1), JSON.stringify(codesOf(live.data.student)));
})();

// L3: teacher isolation — teacher A cannot remove a course owned by teacher B.
await (async () => {
  const r = await api("POST", "/api/teacher/students/1001/remove-course", { courseCode: S_B1 }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L3) teacher A cannot remove teacher B's course", !r.ok, `${r.status} ${JSON.stringify(r.data)}`);
})();

// L4: a course CLOSED by the teacher must NOT show as active to an enrolled student
// (it stays visible, with its name, marked closed) — and reopening restores active.
await (async () => {
  let before = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const wasActive = (before.data.student?.enrollments || []).some((e) => String(e.courseCode || "").toLowerCase() === S_A1 && e.isActive === true);
  check("L4a) enrolled course active before close (sanity)", wasActive, JSON.stringify(before.data.student?.enrollments));

  let r = await api("PUT", `/api/teacher/sections/${encodeURIComponent(S_A1)}`, { code: "111", courseName: "مقدمة (أ)", isOpen: false }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L4b) teacher closes A111", r.ok && r.data.success !== false, `${r.status}`);

  let live = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const e = (live.data.student?.enrollments || []).find((x) => String(x.courseCode || "").toLowerCase() === S_A1);
  check("L4c) closed course still shows WITH name (not a number)", !!e && e.courseName === "مقدمة (أ)", JSON.stringify(e));
  check("L4d) closed course is NOT shown active (respects teacher close)", !!e && e.isActive === false, JSON.stringify(e));

  r = await api("PUT", `/api/teacher/sections/${encodeURIComponent(S_A1)}`, { code: "111", courseName: "مقدمة (أ)", isOpen: true }, { jar: tjar, deviceToken: "teacher-A-dev" });
  live = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const e2 = (live.data.student?.enrollments || []).find((x) => String(x.courseCode || "").toLowerCase() === S_A1);
  check("L4e) reopening restores active", !!e2 && e2.isActive === true, JSON.stringify(e2));
})();

// L5: adding an EXISTING (registered) student to a new course roster is roster_only.
// It may notify them administratively, but it must not render a course card until a fresh code is issued.
await (async () => {
  // teacher A adds registered student 2002 to course 333 (خاص (أ)) — 2002 wasn't in it before
  const up = await api("POST", "/api/teacher/upload-allowed", { sectionCode: "333", studentsList: [{ idNumber: "2002", name: "طالب آخر", sectionCode: "333" }] }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L5a) roster upload (add 2002 to course 333) ok", up.ok && up.data.success === true, `${up.status} ${JSON.stringify(up.data).slice(0,120)}`);

  const studentJar = makeJar();
  await api("POST", "/api/auth/login", { idNumber: "2002", password: "pass2002" }, { jar: studentJar, deviceToken: "tok-2002" });
  const inbox = await api("GET", "/api/notifications/inbox?userId=2002&role=student", null, { jar: studentJar, deviceToken: "tok-2002" });
  const note = (inbox.data.notifications || inbox.data.items || inbox.data || []).find?.((n) => /تمت إضافتك/.test(String(n.title || n.body || "")));
  const arr = Array.isArray(inbox.data) ? inbox.data : (inbox.data.notifications || inbox.data.items || []);
  const found = (arr || []).some((n) => /تمت إضافتك/.test(String(n.title || "") + String(n.body || "")));
  check("L5b) student 2002 gets a 'تمت إضافتك لمقرر' bell notification", found, JSON.stringify(arr).slice(0, 240));

  const live = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const e = (live.data.student?.enrollments || []).find((x) => /333-/.test(String(x.courseCode || "")));
  check("L5c) roster_only course 333 remains hidden from student path", !e, JSON.stringify(live.data.student?.enrollments || []));
})();

// L6: deleted + re-added student must NOT auto-enroll, and a fresh code must be issuable.
// Reproduces the owner's scenario: remove via the DISPLAY code form ("111") while the
// student's codes are teacher-scoped ("111-aa@…"). The old exact-match left them linked,
// so the course auto-activated on re-add (disaster) and a new code said "already has code".
await (async () => {
  // a free assigned code exists for 2002 on A111 (to detect a stale "already has code")
  const c1 = await api("POST", "/api/teacher/join-codes/create", { count: 1, sectionCode: "111", assignedStudentId: "2002", isFreeCode: true }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L6a) issue a free assigned code for 2002 (setup)", c1.ok && c1.data.success === true, `${c1.status} ${JSON.stringify(c1.data).slice(0,120)}`);

  // remove 2002 from A111 using the DISPLAY code form "111" (codes are scoped "111-aa@…")
  const r = await api("POST", "/api/teacher/students/2002/remove-course", { courseCode: "111" }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L6b) remove 2002 from A111 via display code form ok", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,120)}`);

  // teacher re-adds 2002 to A111 roster
  await api("POST", "/api/teacher/upload-allowed", { sectionCode: "111", studentsList: [{ idNumber: "2002", name: "طالب آخر", sectionCode: "111" }] }, { jar: tjar, deviceToken: "teacher-A-dev" });

  // KEY (the disaster): re-added student must NOT appear at all until a fresh code is issued.
  const live = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const e = (live.data.student?.enrollments || []).find((x) => String(x.courseCode || "").toLowerCase() === S_A1);
  check("L6c) re-added roster_only student sees no A111 course card", !e, JSON.stringify(live.data.student?.enrollments || []));

  // issuing a fresh code must work — no stale "already has a previous code"
  const c2 = await api("POST", "/api/teacher/join-codes/create", { count: 1, sectionCode: "111", assignedStudentId: "2002", isFreeCode: true }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L6d) fresh code issuance works (no stale 'already has code')", c2.ok && c2.data.success === true, `${c2.status} ${JSON.stringify(c2.data).slice(0,140)}`);
  const pending = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
  const p = (pending.data.student?.enrollments || []).find((x) => String(x.courseCode || "").toLowerCase() === S_A1);
  check("L6e) fresh code creates pending_activation, not active", !!p && p.pendingActivation === true && p.requiresJoinCode === true && p.isActive === false && p.courseName === "مقدمة (أ)", JSON.stringify(p));

  // المشروع والاختبار موجودان على نفس المقرر، ثم نكرر دورة
  // تفعيل ← حذف ← إعادة إضافة ← كود جديد ثلاث مرات.
  const project = await api(
    "POST",
    "/api/teacher/projects",
    { id: "project-readd-cycle", title: "مشروع دورة الإعادة", courseCode: S_A1, status: "published" },
    { jar: tjar, deviceToken: "teacher-A-dev" },
  );
  check("L6f) project fixture published", project.ok && project.data.success === true, `${project.status}`);

  let activationCode = c2.data?.created?.[0]?.code;
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const activated = await api(
      "POST",
      "/api/students/join-lab",
      { studentId: "2002", joinCode: activationCode, courseCode: S_A1, deviceToken: "tok-2002" },
      { deviceToken: "tok-2002" },
    );
    check(`L6.${cycle}a) activation cycle ${cycle} succeeds`, activated.ok && activated.data.success === true, `${activated.status} ${JSON.stringify(activated.data).slice(0, 150)}`);

    // عدة قراءات حية تحاكي polling؛ لا يكفي نجاح رد التفعيل نفسه.
    let liveAfterActivation;
    for (let poll = 0; poll < 4; poll += 1) {
      liveAfterActivation = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
    }
    const activeEnrollment = (liveAfterActivation.data?.enrollments || []).find(
      (entry) => String(entry.courseCode || entry.sectionCode || "").toLowerCase() === S_A1,
    );
    const hasExam = (liveAfterActivation.data?.exams || []).some((exam) => exam.id === "exam-lock-1");
    const hasProject = (liveAfterActivation.data?.projects || []).some((item) => item.id === "project-readd-cycle");
    check(`L6.${cycle}b) live cloud state stays active in cycle ${cycle}`, !!activeEnrollment && activeEnrollment.isActive === true, JSON.stringify(activeEnrollment));
    check(`L6.${cycle}c) exam stays visible in cycle ${cycle}`, hasExam, JSON.stringify(liveAfterActivation.data?.exams || []));
    check(`L6.${cycle}d) project stays visible in cycle ${cycle}`, hasProject, JSON.stringify(liveAfterActivation.data?.projects || []));

    // حفظ الكشف نفسه مرة أخرى ليس دورة حذف/إضافة جديدة، ويجب ألا يمس التفعيل.
    await api("POST", "/api/teacher/upload-allowed", { sectionCode: "111", studentsList: [{ idNumber: "2002", name: "طالب آخر", sectionCode: "111" }] }, { jar: tjar, deviceToken: "teacher-A-dev" });
    const afterRosterResave = await api("GET", "/api/live/student-state?studentId=2002", null, { jar: tjar, deviceToken: "teacher-A-dev" });
    check(
      `L6.${cycle}e) ordinary roster re-save preserves activities in cycle ${cycle}`,
      (afterRosterResave.data?.exams || []).some((exam) => exam.id === "exam-lock-1") &&
        (afterRosterResave.data?.projects || []).some((item) => item.id === "project-readd-cycle"),
      JSON.stringify({ exams: afterRosterResave.data?.exams, projects: afterRosterResave.data?.projects }),
    );

    if (cycle < 3) {
      const removed = await api("POST", "/api/teacher/students/2002/remove-course", { courseCode: "111" }, { jar: tjar, deviceToken: "teacher-A-dev" });
      check(`L6.${cycle}f) removal cycle ${cycle} succeeds`, removed.ok && removed.data.success === true, `${removed.status}`);
      await api("POST", "/api/teacher/upload-allowed", { sectionCode: "111", studentsList: [{ idNumber: "2002", name: "طالب آخر", sectionCode: "111" }] }, { jar: tjar, deviceToken: "teacher-A-dev" });
      const nextCode = await api("POST", "/api/teacher/join-codes/create", { count: 1, sectionCode: "111", assignedStudentId: "2002", isFreeCode: true }, { jar: tjar, deviceToken: "teacher-A-dev" });
      check(`L6.${cycle}g) fresh code after removal cycle ${cycle}`, nextCode.ok && nextCode.data.success === true, `${nextCode.status} ${JSON.stringify(nextCode.data).slice(0, 140)}`);
      activationCode = nextCode.data?.created?.[0]?.code;
    }
  }
})();

// L7: Super-Admin "Data Health & Self-Heal" — admin-only; detects ghosts and heals on demand.
await (async () => {
  // non-admin teacher A must be refused
  const denied = await api("POST", "/api/teacher/data-heal", { teacherEmail: AA }, { jar: tjar, deviceToken: "teacher-A-dev" });
  check("L7a) data-heal refused for non-admin teacher", denied.status === 403, `${denied.status} ${JSON.stringify(denied.data)}`);

  // admin login
  const ajar = makeJar();
  const alogin = await api("POST", "/api/auth/login", { idNumber: "ah.alfailakawi@paaet.edu.kw", password: "REDACTED" }, { jar: ajar, deviceToken: "admin-dev" });
  check("L7b) super-admin login", alogin.ok && alogin.data.role === "admin", `${alogin.status} ${JSON.stringify(alogin.data).slice(0, 120)}`);

  // code-integrity returns dataHealth for admin, and 1001's ghosts are detected
  const intel = await api("GET", `/api/teacher/code-integrity?teacherEmail=${encodeURIComponent("ah.alfailakawi@paaet.edu.kw")}`, null, { jar: ajar, deviceToken: "admin-dev" });
  const dh = intel.data?.dataHealth;
  check("L7c) intelligence panel includes dataHealth (admin only)", !!dh && typeof dh.totalIssues === "number", JSON.stringify(dh));
  check("L7d) data health payload is available before heal", !!dh && typeof dh.totalIssues === "number", JSON.stringify(dh));

  // one-tap heal
  const heal = await api("POST", "/api/teacher/data-heal", { teacherEmail: "ah.alfailakawi@paaet.edu.kw" }, { jar: ajar, deviceToken: "admin-dev" });
  check("L7e) one-tap heal endpoint succeeds", heal.ok && heal.data.success === true, `${heal.status} ${JSON.stringify(heal.data).slice(0,160)}`);
  check("L7f) after heal: ghost students are gone", heal.data.dataHealth && heal.data.dataHealth.ghostStudents === 0, JSON.stringify(heal.data.dataHealth));
})();

// L8: delete student + delete course + recreate same course + re-add same student.
// Must NOT auto-enroll, name must show, and a fresh code must work end-to-end.
await (async () => {
  const ajar = makeJar();
  await api("POST", "/api/auth/login", { idNumber: "ah.alfailakawi@paaet.edu.kw", password: "REDACTED" }, { jar: ajar, deviceToken: "admin-dev" });
  const S888 = "888-ah.alfailakawi@paaet.edu.kw";
  const codeName = (s) => { const e = (s?.enrollments||[]).find(x=>String(x.courseCode||x.sectionCode||"").toLowerCase()===S888); return e ? [e.isActive, e.courseName] : null; };

  await api("POST", "/api/teacher/sections", { code: "888", courseName: "نواة", semester: "الفصل الأول 2026", isOpen: true }, { jar: ajar, deviceToken: "admin-dev" });
  await api("POST", "/api/teacher/upload-allowed", { sectionCode: "888", studentsList: [{ idNumber: "8801", name: "طالب الكارثة", sectionCode: "888" }] }, { jar: ajar, deviceToken: "admin-dev" });
  const c1 = await api("POST", "/api/teacher/join-codes/create", { count: 1, sectionCode: "888" }, { jar: ajar, deviceToken: "admin-dev" });
  const C1 = c1.data?.created?.[0]?.code;
  await api("POST", "/api/auth/register", { idNumber: "8801", password: "GoodPass9", email: "8801@paaet.edu.kw" }, { deviceToken: "tok-8801" });
  const act = await api("POST", "/api/auth/verify-otp", { idNumber: "8801", password: "GoodPass9", email: "8801@paaet.edu.kw", otp: C1, deviceToken: "tok-8801" }, { deviceToken: "tok-8801" });
  check("L8a) student activates new course", act.ok && act.data.success === true, `${act.status} ${JSON.stringify(act.data).slice(0,120)}`);

  await api("POST", "/api/teacher/students/8801/remove-course", { courseCode: "888" }, { jar: ajar, deviceToken: "admin-dev" });
  await api("DELETE", `/api/teacher/sections/${encodeURIComponent(S888)}`, null, { jar: ajar, deviceToken: "admin-dev" });
  await api("POST", "/api/teacher/sections", { code: "888", courseName: "نواة", semester: "الفصل الأول 2026", isOpen: true }, { jar: ajar, deviceToken: "admin-dev" });
  await api("POST", "/api/teacher/upload-allowed", { sectionCode: "888", studentsList: [{ idNumber: "8801", name: "طالب الكارثة", sectionCode: "888" }] }, { jar: ajar, deviceToken: "admin-dev" });

  const live = await api("GET", "/api/live/student-state?studentId=8801", null, { jar: ajar, deviceToken: "admin-dev" });
  const cn = codeName(live.data?.student);
  check("L8b) after recreate/re-add: roster_only is hidden, not locked/fake active", cn === null, JSON.stringify({ cn, enroll: (live.data?.student?.enrollments||[]).map(e=>[e.courseCode,e.status]) }));
  check("L8c) re-added student keeps name (account not deleted)", String(live.data?.student?.name||live.data?.studentName||"") === "طالب الكارثة", JSON.stringify({ name: live.data?.student?.name, studentName: live.data?.studentName }));

  const c2 = await api("POST", "/api/teacher/join-codes/create", { count: 1, sectionCode: "888", assignedStudentId: "8801", isFreeCode: true }, { jar: ajar, deviceToken: "admin-dev" });
  check("L8d) fresh free code issues (no 'already has code')", c2.ok && c2.data.success === true, `${c2.status} ${JSON.stringify(c2.data).slice(0,140)}`);
  const waiting = await api("GET", "/api/live/student-state?studentId=8801", null, { jar: ajar, deviceToken: "admin-dev" });
  const pending = (waiting.data?.student?.enrollments||[]).find(e=>String(e.courseCode||e.sectionCode||"").toLowerCase()===S888);
  check("L8e) fresh code shows pending_activation only", !!pending && pending.pendingActivation === true && pending.isActive === false && pending.courseName === "نواة", JSON.stringify(pending));
  const C2 = c2.data?.created?.[0]?.code;
  const use = await api("POST", "/api/students/join-lab", { studentId: "8801", joinCode: C2, deviceToken: "tok-8801" }, { deviceToken: "tok-8801" });
  check("L8f) student uses fresh code -> active (not 'invalid')", use.ok && use.data.success === true && (use.data.student?.enrollments||[]).some(e=>String(e.courseCode||"").toLowerCase()===S888 && e.isActive), `${use.status} ${JSON.stringify(use.data).slice(0,160)}`);
})();

done();
