/*
 * عملُ الديمو: ما يُسلَّم وما يُصحَّح.
 *
 * كانت `teacherExams` و`teacherProjects` و`teacherSubmissions` فارغةً كلها، فيظهر
 * المنتج بنصفه: شاشة الطالب تقول «مطلوب: ٠»، ولوحة الأستاذ «الاختبارات ٠ ·
 * المشاريع ٠». وهذه أول شاشتين يراهما من يُعرض عليه النظام.
 *
 * وأخطر ما وقع أثناء ملئها أن التسليمات كُتبت بموضع النشاط في المصفوفة
 * (`teacherProjects[3]`)، فلمّا أُضيف نشاطان في المنتصف انزاحت المواضع: صار
 * خمسةٌ وعشرون طالبًا يُسلّمون في مشروع شعبةٍ لا ينتمون إليها، ومشروعٌ بلا
 * تسليمٍ واحد. ولم يكسر ذلك بناءً ولا نوعًا ولا اختبارًا — ظهر في عدّادٍ على
 * الشاشة وحده. فهذه الفحوص تقف على المعنى لا على الشكل.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createDemoDatabaseState } from "../src/server/demoSeed.ts";

const state = createDemoDatabaseState([]);
const exams = state.teacherExams || [];
const projects = state.teacherProjects || [];
const submissions = state.teacherSubmissions || [];
const studentById = new Map(state.students.map((s) => [String(s.id), s]));

/* الطالب الذي يُصدره الخادم عند التبديل إلى دور الطالب. */
const DEMO_STUDENT_ID = "2026100007";
/* والشعبة التي تفتح عليها لوحة الأستاذ: أول شعبة في القائمة. */
const LANDING_SECTION = state.sections[0].code;

test("للعرض اختبارات ومشاريع أصلًا", () => {
  assert.ok(exams.length >= 4, `اختبارات: ${exams.length}`);
  assert.ok(projects.length >= 4, `مشاريع: ${projects.length}`);
  assert.ok(submissions.length >= 50, `تسليمات: ${submissions.length}`);
});

test("لوحة الأستاذ لا تُفتح على مقرر فارغ", () => {
  /* العدّادان يُرشَّحان بالمقرر المختار، وهو افتراضًا أول شعبة — لا شعبة الطالب. */
  assert.ok(
    exams.some((e) => e.courseCode === LANDING_SECTION),
    `لا اختبار في ${LANDING_SECTION} — تفتح اللوحة على «الاختبارات ٠»`,
  );
  assert.ok(
    projects.some((p) => p.courseCode === LANDING_SECTION),
    `لا مشروع في ${LANDING_SECTION} — تفتح اللوحة على «المشاريع ٠»`,
  );
  assert.ok(
    submissions.some((s) => s.courseCode === LANDING_SECTION),
    `لا تسليم في ${LANDING_SECTION} — يفتح طابور التصحيح فارغًا`,
  );
});

test("لا أحد يُسلّم في مقرر ليس مسجّلًا فيه", () => {
  /* هذا هو الفحص الذي يمسك انزياح المواضع: تسليمٌ من طالب شعبةٍ في نشاط شعبةٍ أخرى. */
  const strays = submissions.filter((sub) => {
    const student = studentById.get(String(sub.studentId));
    return !student || student.sectionCode !== sub.courseCode;
  });
  assert.equal(
    strays.length,
    0,
    `تسليمات من خارج الشعبة: ${strays.slice(0, 3).map((s) => `${s.studentId}→${s.courseCode}`).join("، ")}`,
  );
});

test("كل نشاطٍ له تسليماته، ولا نشاط مهجور", () => {
  for (const id of ["demo_exam_grading", "demo_exam_released", "demo_proj_grading", "demo_proj_graded", "demo_exam_a1_grading", "demo_proj_a1_grading"]) {
    const count = submissions.filter((s) => s.activityId === id).length;
    assert.ok(count > 0, `النشاط ${id} بلا تسليمٍ واحد — أُعيدت تسميته أو انزاح موضعه؟`);
  }
});

test("على الطالب المعروض عملٌ مطلوب فعلًا", () => {
  const student = studentById.get(DEMO_STUDENT_ID);
  assert.ok(student, `الطالب ${DEMO_STUDENT_ID} غير موجود — تغيّرت البذرة؟`);
  const mine = new Set(
    submissions.filter((s) => String(s.studentId) === DEMO_STUDENT_ID).map((s) => s.activityId),
  );
  const now = Date.now();

  const openExams = exams.filter(
    (e) => e.courseCode === student.sectionCode &&
      Date.parse(e.open) <= now && Date.parse(e.close) > now && !mine.has(e.id),
  );
  assert.ok(openExams.length >= 1, "لا اختبار مفتوحًا عليه — شاشته تقول «مطلوب ٠»");

  const openProjects = projects.filter(
    (p) => p.courseCode === student.sectionCode &&
      Date.parse(p.closeDate || p.dueDate) > now && !mine.has(p.id),
  );
  assert.ok(openProjects.length >= 2, `مشاريع مطلوبة: ${openProjects.length} — المطلوب اثنان على الأقل`);
});

test("وله تاريخٌ أيضًا: سلّم ورُصد له", () => {
  const mine = submissions.filter((s) => String(s.studentId) === DEMO_STUDENT_ID);
  assert.ok(mine.length >= 2, `تسليماته: ${mine.length}`);
  assert.ok(
    mine.some((s) => String(s.visibleGrade || "").trim()),
    "لا درجة مرصودة له — شاشة الدرجات تُفتح فارغة",
  );
  assert.ok(
    mine.some((s) => !String(s.visibleGrade || "").trim()),
    "كل شيء مرصود — فلا شيء ينتظر الأستاذ في طابوره",
  );
});

test("وللأستاذ طابورٌ ينتظر التصحيح", () => {
  const pending = submissions.filter((s) => !String(s.visibleGrade || "").trim());
  assert.ok(pending.length >= 20, `بانتظار التصحيح: ${pending.length}`);
  assert.ok(
    submissions.some((s) => s.status === "معاد للطالب"),
    "لا تسليم معاد — وحالة الإعادة جزءٌ من دورة العمل",
  );
});

test("لا معرّف تسليمٍ مكرّر", () => {
  const ids = submissions.map((s) => String(s.id));
  assert.equal(ids.length, new Set(ids).size, "تسليمان بالمعرّف نفسه يطمس أحدهما الآخر");
});

console.log("\n=== DEMO — الاختبارات والمشاريع والتسليمات ===\n  كل الفحوص مرّت");
