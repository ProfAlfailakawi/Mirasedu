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
