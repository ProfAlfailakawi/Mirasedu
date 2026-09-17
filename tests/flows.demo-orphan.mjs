/*
 * جلسةُ عرضٍ بلا صندوق — الحال التي تملأ الشاشة بـ401.
 *
 * جلسة المدرّب في `localStorage` فتبقى عبر كل تحميلٍ ونشر، ومعرّف الصندوق في
 * `sessionStorage` فيزول بإغلاق اللسان. فيجتمعان على حالٍ لا تعمل: الهوية
 * حاضرة ولا صندوق ينسبها. ويردّ الخادم كل نداء إلى `/api/teacher/*` بـ401 —
 * ولا مخرج للزائر إلا مسح التخزين بيده.
 *
 * وهذا ما وقع فعلًا: لسانٌ دخل العرض قبل نشر نقل الترويسة بقي مفتوحًا، فبقيت
 * هويته ولم يكن له معرّف قط.
 *
 * وأخطر ما في العلاج أن يتجاوز حدّه: طرحُ جلسةِ مدرّبٍ حقيقي بالخطأ يُخرج صاحبه
 * من حسابه. فأكثر هذه الفحوص عن ما **لا** يُمسّ.
 */

import assert from "node:assert/strict";
import test from "node:test";

/* تخزينٌ وهمي: الاختبار يعمل في Node بلا متصفح. */
function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

const DEMO_ID = `demo_${"a".repeat(64)}`;
const demoSession = JSON.stringify({ email: "demo.teacher@miras.test", authToken: "t", name: "عرض" });
const realSession = JSON.stringify({ email: "teacher@real.example", authToken: "r", name: "مدرّب" });

async function run({ local = {}, session = {} } = {}) {
  globalThis.localStorage = makeStorage(local);
  globalThis.sessionStorage = makeStorage(session);
  /* يُستورد بعد ضبط التخزين، وبمُعرّفٍ فريد حتى لا تُعاد وحدةٌ محفوظة. */
  const mod = await import(`../src/shared/demo-transport.ts?case=${Math.random()}`);
  const discarded = mod.discardOrphanedDemoSession();
  return { discarded, local: globalThis.localStorage._dump(), session: globalThis.sessionStorage._dump() };
}

test("an orphaned demo session is discarded", async () => {
  const r = await run({ local: { miras_teacher_session: demoSession } });
  assert.equal(r.discarded, true);
  assert.equal(r.local.miras_teacher_session, undefined, "بقيت هوية العرض، فستُردّ بـ401 من جديد");
});

test("the real session saved before entering the demo comes back", async () => {
  const r = await run({
    local: { miras_teacher_session: demoSession },
    session: { miras_pre_demo_teacher_session: realSession },
  });
  assert.equal(r.discarded, true);
  assert.equal(r.local.miras_teacher_session, realSession, "لم تُعَد الجلسة الحقيقية");
  assert.equal(r.session.miras_pre_demo_teacher_session, undefined);
});

test("a real teacher's session is never touched", async () => {
  const r = await run({ local: { miras_teacher_session: realSession } });
  assert.equal(r.discarded, false);
  assert.equal(r.local.miras_teacher_session, realSession, "مُسّت جلسة مدرّبٍ حقيقي — وهذا يُخرجه من حسابه");
});

test("a live demo session, with its sandbox, is left alone", async () => {
  const r = await run({
    local: { miras_teacher_session: demoSession },
    session: { miras_demo_session: DEMO_ID },
  });
  assert.equal(r.discarded, false, "طُرحت جلسة عرضٍ قائمة، فيخرج الزائر من عرضه");
  assert.equal(r.local.miras_teacher_session, demoSession);
});

test("nothing stored means nothing to do", async () => {
  const r = await run();
  assert.equal(r.discarded, false);
});

test("unparseable stored content is left as it is", async () => {
  /* ليست جلسةً نعرفها، فلا نحكم عليها ولا نمحوها. */
  const r = await run({ local: { miras_teacher_session: "{not json" } });
  assert.equal(r.discarded, false);
  assert.equal(r.local.miras_teacher_session, "{not json");
});

console.log("\n=== DEMO — جلسة بلا صندوق ===\n  كل الفحوص مرّت");
