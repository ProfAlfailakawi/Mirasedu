/*
 * يتحقق أن مدخل العرض معروضٌ في كل فرعٍ من فروع شاشة الدخول.
 *
 * السبب واقعةٌ حصلت فعلاً: أُضيف المدخل إلى نموذج الدخول الكامل وحده، وشاشة
 * الدخول في مِراس لها فرعان — الجهاز الذي سجّل بصمةً يرى «البطاقة المختصرة»
 * ولا يرى النموذج إطلاقاً. فكان المدخل غائباً عن كل جهازٍ اعتاد صاحبه الدخول
 * ببصمته، وهو بالضبط الجهاز الذي يُعرض منه المنتج على جهة.
 *
 * والغياب صامت: لا خطأ في البناء ولا في الأنواع، ولا يُكتشف إلا بفتح الشاشة
 * على جهازٍ ذي بصمة. فحصٌ آلي واحد أرخص من تذكّر هذا في كل تعديل قادم.
 */
import fs from 'node:fs';

const FILE = 'App.tsx';
const MARKER = 'showCompactPasskeyLogin ? (';
const ENTRY = 'enterDemo()';

const text = fs.readFileSync(FILE, 'utf8');

function fail(message) {
  console.error(`فشل فحص مدخل العرض: ${message}`);
  process.exit(1);
}

const markerAt = text.indexOf(MARKER);
if (markerAt === -1) {
  // الفحص مربوط باسم الراية عمداً: إن أُعيدت تسميتها يجب أن يتوقف أحدٌ عندها
  // ويعيد توجيه الفحص، لا أن يمرّ الفحص صامتاً على شيء لم يعد موجوداً.
  fail(`لم يُعثر على «${MARKER}» في ${FILE} — أُعيدت تسمية الفرع؟ أعد توجيه هذا الفحص.`);
}

/* اقتطاع الفرع المختصر بمطابقة الأقواس من «(» التي تلي «?» حتى ما يوازنها. */
const openAt = markerAt + MARKER.length - 1;
let depth = 0;
let closeAt = -1;
for (let i = openAt; i < text.length; i += 1) {
  if (text[i] === '(') depth += 1;
  else if (text[i] === ')') {
    depth -= 1;
    if (depth === 0) { closeAt = i; break; }
  }
}
if (closeAt === -1) fail('تعذّر اقتطاع فرع البطاقة المختصرة — أقواس غير متوازنة؟');

const compactBranch = text.slice(openAt, closeAt);
const rest = text.slice(0, openAt) + text.slice(closeAt);

if (!compactBranch.includes(ENTRY)) {
  fail('البطاقة المختصرة (جهاز له بصمة مسجّلة) لا تعرض مدخل العرض — وهي الشاشة التي يراها جهاز العرض المعتاد.');
}
if (!rest.includes(ENTRY)) {
  fail('نموذج الدخول الكامل (جهاز بلا بصمة) لا يعرض مدخل العرض.');
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

console.log('فحص مدخل العرض: المدخل معروض في فرعَي شاشة الدخول، والناقل يركّب نفسه قبل أي التقاط.');
