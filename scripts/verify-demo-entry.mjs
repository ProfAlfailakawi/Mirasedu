/*
 * يتحقق أن مدخل العرض لمراجع آبل سليم، بلا زرٍّ ظاهر.
 *
 * لا يُعرض زرّ للعرض في الواجهة (قرار المالك). يدخل المراجع بكتابة الرقم الجامعي
 * المحجوز في خانة الدخول (src/shared/review-demo-entry.ts) فتفتح الواجهة الصندوق
 * المعزول. وإن سقط هذا المسار صامتاً لا يستطيع المراجع الدخول فيُرفض التحديث (2.1)،
 * ولا يُكتشف ذلك في بناءٍ ولا نوعٍ ولا اختبارٍ محلي — فهذا فحصٌ آلي يحميه.
 */
import fs from 'node:fs';

const FILE = 'App.tsx';

const text = fs.readFileSync(FILE, 'utf8');

function fail(message) {
  console.error(`فشل فحص مدخل العرض: ${message}`);
  process.exit(1);
}

const identifyAt = text.indexOf('const handleLoginIdentify = async () => {');
if (identifyAt === -1) {
  fail('لم يُعثر على handleLoginIdentify في App.tsx — أُعيدت تسميته؟ أعد توجيه هذا الفحص.');
}
const identifyBody = text.slice(identifyAt, identifyAt + 2500);
const guardAt = identifyBody.indexOf('isReviewDemoEntryNumber(identity)');
const fetchAt = identifyBody.indexOf('/api/auth/identify/');
if (guardAt === -1 || !identifyBody.includes('enterDemo()')) {
  fail('handleLoginIdentify لا يفتح الصندوق التجريبي عند الرقم المحجوز — لن يستطيع مراجع آبل الدخول.');
}
if (fetchAt !== -1 && guardAt > fetchAt) {
  fail('فحص الرقم المحجوز يأتي بعد استعلام الكشف الحقيقي — يجب أن يسبقه.');
}
if (text.includes('جرّب العرض التجريبي')) {
  fail('عاد زرّ «جرّب العرض التجريبي» إلى الواجهة — قرار المالك ألا يظهر أي زر للعرض.');
}

/* الخادم يرفض تسجيل الرقم المحجوز طالباً حقيقياً. */
const server = fs.readFileSync('server.ts', 'utf8');
const db = fs.readFileSync('src/server/db.ts', 'utf8');
if (!server.includes('REVIEW_DEMO_STUDENT_ID') || !db.includes('REVIEW_DEMO_STUDENT_ID')) {
  fail('حارس الرقم المحجوز غائب عن الخادم أو عن db.addAllowedStudent — قد يُسجَّل طالبٌ حقيقي بهذا الرقم.');
}

/*
 * ثم: ناقل الصندوق مركَّب قبل أي طلب.
 *
 * `installDemoTransport()` سطرٌ واحد في `main.tsx` يجعل كل نداء إلى `/api/`
 * يحمل معرّف صندوقه في ترويسة. وبدونه لا يصل الصندوق إلى الخادم عبر Firebase
 * Hosting إطلاقاً — يحذف الكعكات — فيُقذف الزائر إلى شاشة الدخول فور دخوله.
 *
 * وحذفُه لا يكسر بناءً ولا نوعاً ولا اختباراً محلياً: محلياً تصل الكعكة فيعمل
 * كل شيء. لا يظهر العطب إلا على النشر الحيّ، وهو أسوأ موضعٍ يظهر فيه.
 */
const ENTRYPOINT = 'src/main.tsx';
const INSTALL = 'installDemoTransport()';

const entrypoint = fs.readFileSync(ENTRYPOINT, 'utf8');
if (!entrypoint.includes(INSTALL)) {
  fail(
    `${ENTRYPOINT} لا يستدعي ${INSTALL} — بدونه لا يصل معرّف الصندوق إلى الخادم عبر Hosting، ` +
      'فيخرج الزائر من العرض فور دخوله.',
  );
}

/*
 * ثم: الناقل يركّب نفسه عند تقييم وحدته — لا في نقطة الدخول وحدها.
 *
 * `App.tsx` يلتقط `window.fetch` في ثابتٍ على مستوى الوحدة ويظلّل الاسم `fetch`
 * لكل الملف. ووحدات ES تُقيَّم توابعُها قبل مستورديها، فوحدة `App.tsx` تُقيَّم
 * قبل جسم `main.tsx` كله — وتركيبٌ يُنادى هناك يأتي بعد فوات الالتقاط، فتخرج
 * كل نداءات `App.tsx` بلا ترويسة الصندوق ويُردّ كلُّ شيء بـ401. رُئي على النشر
 * الحيّ نصًّا. الضمانة الوحيدة أن تركّب الوحدة نفسها عند تقييمها.
 */
const TRANSPORT = 'src/shared/demo-transport.ts';
const transport = fs.readFileSync(TRANSPORT, 'utf8');
if (!/^installDemoTransport\(\);/m.test(transport)) {
  fail(
    `${TRANSPORT} لا يركّب نفسه عند تقييم الوحدة — فيلتقط App.tsx نسخة fetch ` +
      'قبل التركيب، وتخرج نداءاته كلها بلا ترويسة الصندوق (401 على كل شيء).',
  );
}

/*
 * ثم: للعرض دوران — معلّم وطالب.
 *
 * شاشة المعلّم وحدها نصفُ مِراس: التسليم والاختبار والتفعيل وقفل الجهاز لا
 * يُرى شيءٌ منها إلا من حساب طالب. وسقوطُ زرّ الدور لا يكسر بناءً ولا نوعاً
 * ولا اختباراً — يبقى العرض عاملاً، وينقص نصفه صامتاً. ولا يُكتشف إلا بأن
 * يُعرض المنتج على جهةٍ فلا يُرى الطرف الآخر منه.
 */
for (const label of ['عرض شاشة المعلّم', 'عرض شاشة الطالب']) {
  if (!text.includes(label)) {
    fail(`شريط البيئة التجريبية لا يعرض «${label}» — نصف المنتج لا يُرى بلا تبديل الدور.`);
  }
}

console.log('فحص مدخل العرض: الرقم المحجوز يفتح الصندوق ولا زرّ ظاهر، والخادم يحميه، والناقل يركّب نفسه، والدوران معروضان.');
