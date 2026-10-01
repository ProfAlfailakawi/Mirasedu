/*
 * كل شاشةٍ في العرض تُفتح على بيانات — لا على «٠» سببه نقصٌ في البذرة.
 *
 * رُئي في المتصفح قبل هذا: بنك الأسئلة فارغ (معرّفات الفصول `demo_ch_N` بينما
 * اللوحة تفتح مُرشَّحةً على `chap-1`)، وقمع صحة الأكواد «فُعِّلت ٠»، وسجل
 * المحاولات ولوحة أمان الأكواد وطلبات الاسترجاع فارغة، وبطاقات الأكواد كلها
 * «صيغة تحتاج إعادة إصدار» و«اسم الدكتور غير محمّل».
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createDemoDatabaseState } from "../src/server/demoSeed.ts";

const state = createDemoDatabaseState([]);
const OWNER = "demo.teacher@miras.test";
const FULL_CODE = /^LAB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

test("كل مجموعة تقرأها شاشةٌ في العرض غير فارغة", () => {
  for (const key of ["students", "sections", "chapters", "questionBank", "exercises", "exerciseSubmissions", "quizSubmissions", "activityLogs", "allowedStudents", "joinCodes", "teacherExams", "teacherProjects", "teacherSubmissions", "activationAttempts", "passwordResetRequests"]) {
    assert.ok((state[key] || []).length > 0, `${key} فارغة`);
  }
});

test("بنك الأسئلة يفتح على فئته الافتراضية chap-1", () => {
  assert.ok(state.chapters.some((c) => c.id === "chap-1"));
  assert.ok(state.questionBank.some((q) => q.chapterId === "chap-1"));
  const ids = new Set(state.chapters.map((c) => c.id));
  for (const q of state.questionBank) assert.ok(ids.has(q.chapterId), `سؤال ${q.id} في فصل غير موجود`);
});

test("الأكواد بصيغة التطبيق، ومالكها معروف، والمفعَّل منها مربوط بطالب", () => {
  const studentIds = new Set(state.students.map((s) => s.id));
  for (const c of state.joinCodes) {
    assert.match(c.code, FULL_CODE);
    assert.equal(c.ownerEmail, OWNER);
    if (c.status === "used") assert.ok(studentIds.has(c.usedByStudentId), `${c.code} مستخدم بلا طالب`);
  }
  assert.equal(new Set(state.joinCodes.map((c) => c.code)).size, state.joinCodes.length, "أكواد مكررة");
  assert.ok(state.joinCodes.some((c) => c.status === "used"));
  assert.ok(state.joinCodes.some((c) => c.status === "active"));
  assert.ok(state.joinCodes.some((c) => c.status === "revoked"));
  assert.ok(state.joinCodes.some((c) => Number(c.leakAttemptCount || 0) > 0), "لا حالات في لوحة الأمان");
  for (const s of state.sections) assert.ok(s.teacherName, `${s.code} بلا اسم أستاذ`);
});

test("محاولات التفعيل وطلبات الاسترجاع لطلبةٍ حقيقيين في البذرة وحديثة", () => {
  const byId = new Map(state.students.map((s) => [s.id, s]));
  const monthAgo = Date.now() - 30 * 86_400_000;
  for (const a of state.activationAttempts) {
    assert.ok(byId.get(a.studentId)?.sectionCode === a.sectionCode);
    assert.ok(new Date(a.timestamp).getTime() > monthAgo, "محاولة خارج نطاق السجل الافتراضي");
  }
  for (const r of state.passwordResetRequests) assert.equal(byId.get(r.studentId)?.name, r.studentName);
  assert.ok(state.passwordResetRequests.some((r) => r.status === "new"));
  /* الخادم يبني رابط «نسخ الرابط» من هذا الرمز عند العرض — فلا طلب جديد بلا رمز. */
  for (const r of state.passwordResetRequests.filter((x) => x.status === "new"))
    assert.match(String(r.resetToken || ""), /^demo-reset-token-\d+$/, `${r.id} بلا رمز`);
  assert.equal(new Set(state.passwordResetRequests.map((r) => r.resetToken)).size, state.passwordResetRequests.length, "رموز مكررة");
});

test("لا شيء في البذرة يخرج عن نطاق العرض", () => {
  for (const s of state.students) assert.ok(s.email.endsWith("@demo.miras.test"));
  for (const c of state.joinCodes) assert.equal(c.createdByEmail, OWNER);
});

test("أسئلة الاختبار لا تتكرر، وعدد أسئلة كل اختبار يساوي درجته، ولا سؤال بلا حقل إدخال", () => {
  const texts = state.questionBank.map((q) => q.questionText);
  assert.equal(new Set(texts).size, texts.length, "سؤال مكرَّر في البنك");
  for (const q of state.questionBank) {
    assert.notEqual(q.type, "ordering", `سؤال ترتيب ${q.id}: واجهة الطالب لا تعرض له حقل إدخال`);
    assert.equal(q.points, 1, `${q.id}: درجة السؤال تخالف قاعدة سؤال = درجة`);
  }
  for (const exam of state.teacherExams) assert.equal(exam.questionsCount, exam.points, `${exam.id}: عدد الأسئلة لا يساوي الدرجة`);
});

test("أسماء الطلبة فريدة، والطالب المعروض بلا جهازٍ مربوط، وفي الأرشيف رموزٌ جاهزة للتصدير", () => {
  assert.equal(new Set(state.students.map((s) => s.name)).size, state.students.length, "اسم طالب مكرر");
  const shown = state.students.find((s) => s.id === "2026100007");
  assert.deepEqual(shown?.devices, [], "الطالب المعروض مربوط بجهازٍ مصطنع فيُقفل خارج حسابه بعد إعادة التعيين");
  const printable = state.joinCodes.filter((c) => c.status === "active" && !c.assignedStudentId && !c.printedAt);
  assert.ok(printable.length >= 5, "لا رموز جاهزة للتصدير للمطبعة");
});

test("إنذار التعثر المبكر لا يشمل أغلب الشعبة: غير المرصود بلا درجة صفرية", () => {
  for (const sub of state.teacherSubmissions) {
    if (!sub.visibleGrade) assert.equal(sub.grade, undefined, `${sub.id}: درجة فارغة تُقرأ صفرًا`);
  }
});

test("رموز المقررات لا تشترك في أي جزء بين الشرطات: الواجهة تدمج المقررات المتشاركة في الأجزاء", () => {
  const parts = state.sections.map((s) => String(s.code).split("-").map((p) => p.trim().toLowerCase()));
  for (let i = 0; i < parts.length; i += 1)
    for (let j = i + 1; j < parts.length; j += 1)
      assert.equal(parts[i].some((p) => parts[j].includes(p)), false, `${state.sections[i].code} و${state.sections[j].code} تُعدّان مقررًا واحدًا في الواجهة`);
});
