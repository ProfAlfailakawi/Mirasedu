# مِراس على iPhone Duo: قبول الجولة النهائية (14 نوفمبر 2026)

هذه الجولة بنت على جولة [#295](https://github.com/ProfAlfailakawi/Mirasedu/pull/295) وتقريرها [IPHONE-DUO-ADAPTIVE-QUALITY.md](IPHONE-DUO-ADAPTIVE-QUALITY.md). مشكلتها الوحيدة: **الشاشة الداخلية في وضع الكتاب كانت تبدو صفحة iPad ممدودة**؛ عمود واحد يقطعه خط الطي، وأزرار وحقول ونصوص تقع على المنتصف.

النطاق عرضٌ فقط، في ملف واحد هو طبقة الـDuo الموجودة: [src/design/miras-duo-layouts.css](../src/design/miras-duo-layouts.css) (الأقسام ٧ و٨ و٩). لم يتغير `App.tsx` ولا الخادم ولا المصادقة ولا Firestore ولا الاختبارات ولا المؤقت ولا قفل الإجابة ولا الدرجات ولا بيانات الطلبة ولا منطق الدخول ولا ملفات النشر ولا CI. كل شيء CSS خالص (media queries)، فلا يُعاد تركيب أي مكوّن عند تغيّر المقاس.

رموز الحالة: `PASS` مقيس ومراجَع بالصورة، `PARTIAL` يعمل وبقيت ملاحظة، `FAIL` خلل باقٍ، `BLOCKED` يمنعه قيد (حدود المهمة أو جهاز)، `NOT_TESTED` لم يُختبر.

## 1. التصميم: الكتاب المفتوح

**متى:** عرض 640–1000px وارتفاع 540–960px (الشاشة الداخلية 669×867 طوليًا و951×585 عرضيًا). خارج ذلك لا يتغير شيء: iPad 768×1024 (أطول من 960) والهاتف والمطوي والارتفاع القصير. المتغير `--duo-book: 1` يُعلن الوضع لأداة القياس.

**الكعب:** شريط بعرض 32px في المنتصف، ظل طيّ متدرج وخط شعري (فاتح وداكن)، `pointer-events: none`. الخلفية متصلة من الحافة إلى الحافة. Safari لا يعلن المفصل، فالكعب يُرسم على منتصف الشاشة، وهو موضع مفصل الـDuo. قاعدة `horizontal-viewport-segments` من الجولة السابقة (٦-ج) باقية تحسينًا اختياريًا.

**أدوار الصفحتين (RTL: اليمنى أولًا):**

| الشاشة | الصفحة اليمنى (المهمة) | الصفحة اليسرى (السياق) |
|---|---|---|
| الدخول بكل فروعه (المعرّف، كلمة المرور، حساب جديد، المعلّم، الخطأ) | بطاقة النموذج | اللوح النيلي بعلامة مِراس، صفحة كاملة |
| ترويسة المعلّم | العنوان واسم الحساب | الأدوات الخمس |
| شريط الأقسام (علويًا عند 951، سفليًا عند 669) | المقررات، الطلبة، الأسئلة | التسليمات، الأكواد (والكعب فارغ بينهما) |
| مبدّل المقرر | القائمة المنسدلة | فراغ هادئ |
| رئيسية المعلّم | بطاقات الأرقام الست (عمود عند 669، عمودان عند 951) | طلبات استعادة كلمة المرور ونبض الاختبار |
| المقررات، التسليمات، الأكواد (الصحة)، الطلبة، بنك الأسئلة، المشاريع | البطاقة الأولى من كل زوج | الثانية؛ الفاصل بينهما هو الكعب +16px |
| الطلبة | «رفع من Excel» | «إضافة طالب يدويًا» والبحث في الكشف |
| بنك الأسئلة | التصنيفات | البحث وزر «سؤال جديد» |
| الأكواد ← الصحة | حقل التحقق، إحصاءان، البحث | زر التحقق، الإحصاء الثالث، التصفية |
| الأكواد ← الأجهزة | تغيير كلمة المرور | الحسابات والأجهزة |
| الأكواد ← تفعيل | العنوان والعدّادات والقائمة | البحث |
| مقرر جديد / سؤال جديد | الحقول الأولى | بقية الحقول والأزرار |
| رئيسية الطالب | «الاختبارات» ثم «مسارك الدراسي» | «المشاريع» ثم «آخر تسليم» |
| النوافذ (تنبيه مهم، السجل الزمني، تثبيت التطبيق، البصمة) | النافذة نفسها، والستارة تغطي الكتاب | — |
| لوحة التنبيهات (المعلّم والطالب) | — | تنسدل تحت الجرس |
| الرسائل العائمة (خطأ/نجاح) | الرسالة | — |

**الحاسوب المحمول (E):** عند ≥921×≤480 (951×350) ينزل شريط أقسام المعلّم من الترويسة إلى شريط ثابت نحيف أسفل الشاشة، ويُحجز له 76px أسفل المحتوى فلا يغطي آخره. عند 600×350 يبقى الـrail الجانبي من الجولة السابقة: المقاس نفسه هو المطوي عرضيًا (B)، والـrail يترك الارتفاع كله للمحتوى.

**المطوي (A و B):** شاشة واحدة بمهمة واحدة، كما صُقلت في الجولات السابقة. الجديد هنا: ترويسة الطالب صف واحد في الارتفاع القصير بين 520 و599px (كانت صفين تأكلان ربع 368px)، و«المتاح الآن» بطاقتان متجاورتان.

**الاختبار الجاري:** خارج النطاق عمدًا (حدود المهمة: لا مساس بالاختبارات). لا يُرسم الكعب فوقه، ولا تتغير طريقته. تغيير المقاس أثناء الاختبار يقفله مؤقتًا (`getNormalExamViewportIssue`) وهذا سلوك نزاهة مقصود.

## 2. جرد الشاشات (من الكود)

مصدر الجرد: `currentView` و`teacherTab` و`codesSubTab` و`studentTab` و`practiceSubTab` في `App.tsx`، ونوافذ `fixed inset-0` واللوحات المنبثقة.

| المجموعة | العنصر في الكود | الشاشة في التدقيق | الوصول |
|---|---|---|---|
| الدخول | `signup` / `loginStep=identify` | `login-identify` | مباشر |
| | `loginStep=password` (طالب) | `login-student-password` | قاعدة محلية مبذورة: الرقم 1001 |
| | حساب جديد | `login-student-signup` | الرقم 1100 (في الكشف وغير مسجّل) |
| | خطأ: غير مدرج | `login-error-not-in-roster` | الرقم 9999 |
| | دخول المعلّم | `login-teacher-password` | `aa@test.kw` |
| | `otp` | — | BLOCKED: يحتاج رمزًا يُرسل خارج الخادم المحلي |
| | `payment` | — | BLOCKED: لا حساب غير مدفوع في البيئة التجريبية |
| | `student_device_locked` | — | BLOCKED: يحتاج جهازًا ثانيًا مسجّلًا |
| | `fingerprint` / `section` | — | NOT_TESTED: لا مسار إليهما في البيئة التجريبية دون تسجيل بصمة حقيقية |
| المعلّم | جولة التعريف (أول دخول) | `teacher-tour` | تجريبي |
| | `home` | `teacher-home` | تجريبي |
| | `sections` (المقررات) | `teacher-courses`، `teacher-courses-new-form` | تجريبي |
| | `students` | `teacher-students`، `teacher-students-edit` | تجريبي |
| | `questions` (بنك الأسئلة، الاختبارات، المشاريع) | `teacher-questions`، `-new-form`، `-exams`، `-projects` | تجريبي |
| | `submissions` | `teacher-submissions`، `-empty` (بحث بلا نتيجة)، `-detail` (التصحيح) | تجريبي |
| | `codes` ← health / devices / generate / manual | `teacher-codes-health`، `-devices`، `-generate`، `-manual` | تجريبي |
| | `codes` ← archive / attempts / scope | — | NOT_TESTED: ليست في شريط الأقسام الفرعي للمعلّم التجريبي |
| | `analytics` (المتابعة) | — | BLOCKED: للمشرف فقط (`isAdminTeacher`) |
| | `textbook` | — | لا مسار إليه في الواجهة |
| | لوحة التنبيهات | `teacher-notifications` | تجريبي |
| | حالة الاتصال (اسم الحساب) | `teacher-account-status` | تجريبي |
| | تفعيل البصمة | `teacher-passkey` | تجريبي (WebKit لا يدعمها، فتظهر رسالة) |
| | الرادار، البحث السريع، رموز QR | — | BLOCKED: للمشرف أو تحتاج كاميرا |
| الطالب | نافذة «تنبيه مهم» عند الدخول | `student-alert-dialog` | تجريبي |
| | `overview` | `student-home` | تجريبي |
| | `practice` (الاختبارات) | `student-exams` | تجريبي |
| | `project` | `student-projects` | تجريبي |
| | السجل الزمني | `student-timeline` | تجريبي |
| | المواعيد والتنبيهات | `student-calendar-alerts` | تجريبي |
| | تثبيت التطبيق | `student-install` | تجريبي |
| | البصمة | `student-passkey` | تجريبي |
| | اختبار جارٍ | `student-exam-running` | تجريبي؛ خارج النطاق |
| | الأجهزة والمرآة | — | NOT_TESTED: لم أجد زرًا ظاهرًا لهما في البيئة التجريبية |

## 3. مصفوفة الوضعيات A–J

**الوضعيات:** A مطوي طولي (382×580، 385×571، 320×568)، B مطوي عرضي (594×368)، C كتاب طولي (669×867)، D كتاب عرضي (951×585)، E حاسوب محمول (951×350، 600×350)، F داخلي قصير (669×520، 600×480)، G لوح/مكتب (768×1024، 1024×768، 1280×800، 1440×900)، H هاتف (360×640، 390×844، 844×390)، I تسلسل حيّ، J ضغط إتاحة. عمود Split يجمع العروض 320 و470 و620 بالارتفاعات 350 و600 و900.

**قاعدة الحكم (آلية من التقرير):** `FAIL` إذا تقاطع عنصر أو نص مع منطقة الكعب في وضع الكتاب، أو ظهر تمرير أفقي. `PARTIAL` إذا خرج عنصر عن الشاشة أو وُجد هدف لمس أصغر من 44px (العدد بين القوسين). وإلا `PASS`. الأرقام في [iphone-duo-final/duo-final-report.json](iphone-duo-final/duo-final-report.json) لكل حالة على حدة، ومعها أسماء العناصر.

| الشاشة | A | B | C | D | E | F | G | H | Split 320/470/620 | I | J |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `login-identify` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `login-student-password` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `login-student-signup` | PASS | PASS | PASS | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PASS | PARTIAL (لمس 4) | PARTIAL (لمس 1) | PASS | NOT_TESTED | NOT_TESTED |
| `login-error-not-in-roster` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `login-teacher-password` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-tour` | PARTIAL (لمس 15) | PARTIAL (لمس 5) | PARTIAL (لمس 4) | PARTIAL (لمس 4) | PARTIAL (لمس 9) | PARTIAL (لمس 9) | PARTIAL (لمس 16) | PARTIAL (لمس 14) | PARTIAL (لمس 45) | NOT_TESTED | NOT_TESTED |
| `teacher-home` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | PASS |
| `teacher-courses` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL (لمس 5) | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-courses-new-form` | PASS | PASS | PASS | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PASS | PARTIAL (لمس 4) | PARTIAL (لمس 6) | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-students` | PASS | PASS | PASS | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PASS | PARTIAL (لمس 4) | PARTIAL (لمس 1) | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-students-edit` | PASS | PASS | PASS | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PASS | PARTIAL (لمس 4) | PARTIAL (لمس 1) | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-questions` | PARTIAL (لمس 3) | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PARTIAL (لمس 2) | PARTIAL (لمس 2) | PARTIAL (لمس 4) | PARTIAL (لمس 3) | PARTIAL (لمس 9) | NOT_TESTED | NOT_TESTED |
| `teacher-questions-new-form` | PARTIAL (لمس 24) | PARTIAL (لمس 8) | PARTIAL (لمس 8) | PARTIAL (لمس 8) | PARTIAL (لمس 16) | PARTIAL (لمس 16) | PARTIAL (لمس 32) | PARTIAL (لمس 24) | PARTIAL (لمس 72) | NOT_TESTED | NOT_TESTED |
| `teacher-questions-exams` | PARTIAL (لمس 6) | PARTIAL (لمس 2) | PARTIAL (لمس 2) | PARTIAL (لمس 3) | PARTIAL (لمس 5) | PARTIAL (لمس 4) | PARTIAL (لمس 12) | PARTIAL (لمس 7) | PARTIAL (لمس 18) | NOT_TESTED | NOT_TESTED |
| `teacher-questions-projects` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-submissions` | PASS | PASS | PASS | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PASS | PARTIAL (لمس 4) | PARTIAL (لمس 6) | PASS | PASS | NOT_TESTED |
| `teacher-submissions-empty` | PARTIAL (لمس 3) | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PARTIAL (لمس 2) | PARTIAL (لمس 3) | PARTIAL (لمس 2) | PARTIAL (لمس 8) | PARTIAL (لمس 9) | PARTIAL (لمس 9) | NOT_TESTED | NOT_TESTED |
| `teacher-submissions-detail` | PARTIAL (لمس 186) ⟵ حدّ الدرجات | PARTIAL (لمس 62) ⟵ حدّ الدرجات | FAIL (كعب 45) ⟵ حدّ الدرجات | FAIL (كعب 22) ⟵ حدّ الدرجات | PARTIAL (قص 20) ⟵ حدّ الدرجات | PARTIAL (لمس 124) ⟵ حدّ الدرجات | PARTIAL (قص 40) ⟵ حدّ الدرجات | PARTIAL (قص 20) ⟵ حدّ الدرجات | PARTIAL (لمس 558) ⟵ حدّ الدرجات | NOT_TESTED | NOT_TESTED |
| `teacher-codes-health` | PARTIAL (لمس 3) | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PARTIAL (لمس 2) | PARTIAL (لمس 2) | PARTIAL (لمس 4) | PARTIAL (لمس 3) | PARTIAL (لمس 9) | NOT_TESTED | NOT_TESTED |
| `teacher-codes-devices` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-codes-generate` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-codes-manual` | PARTIAL (قص 1) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL (قص 3) | NOT_TESTED | NOT_TESTED |
| `teacher-account-status` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-passkey` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `teacher-notifications` | PASS | PASS | PASS | PARTIAL (لمس 3) | PARTIAL (لمس 3) | PASS | PARTIAL (لمس 12) | PARTIAL (لمس 3) | PASS | PASS | NOT_TESTED |
| `student-alert-dialog` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `student-home` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `student-exams` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `student-projects` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `student-timeline` | PASS | PASS | PASS | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PASS | PARTIAL (لمس 4) | PARTIAL (لمس 1) | PASS | NOT_TESTED | NOT_TESTED |
| `student-calendar-alerts` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `student-install` | PASS | PASS | PASS | PARTIAL (لمس 1) | PARTIAL (لمس 1) | PASS | PARTIAL (لمس 4) | PARTIAL (لمس 1) | PASS | NOT_TESTED | NOT_TESTED |
| `student-passkey` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED |
| `student-exam-running` | BLOCKED (نزاهة) | BLOCKED (نزاهة) | FAIL (كعب 78) — خارج النطاق | BLOCKED (نزاهة) | BLOCKED (نزاهة) | BLOCKED (نزاهة) | BLOCKED (نزاهة) | BLOCKED (نزاهة) | BLOCKED (نزاهة) | BLOCKED | BLOCKED |

**قراءة المصفوفة:**

- **منطقة الكعب: صفر** في كل الشاشات في C وD، عدا شاشتين خارج حدود المهمة: التصحيح (`teacher-submissions-detail`، يمس الدرجات) والاختبار الجاري.
- **التمرير الأفقي: صفر** في كل الحالات (33 شاشة × 26 مقاسًا، والاختبار الجاري بمقاس واحد: 859 قياسًا).
- **أهداف اللمس الصغيرة** (`PARTIAL (لمس n)`) كلها سابقة لهذه الجولة. أكثرها في جولة التعريف (نقاط التقدم)، ونموذج «سؤال جديد»، وأزرار التبديل الصغيرة في بنك الأسئلة والأكواد. أسماء العناصر ومقاساتها في التقرير JSON. لم أعدّلها لأن تكبيرها يغيّر كثافة النماذج على الهاتف أيضًا؛ هي في P2.
- **`teacher-codes-manual` عند 320px**: شريط العدّادات قابل للتمرير أفقيًا بتصميمه، فيقع «0 موقوف» خارج الشاشة حتى يُمرَّر. سابق للجولة (P2).
- **`teacher-submissions-detail`**: أزرار «إرجاع النشاط للطالب» خارج الشاشة يسارًا في G وH وE وD. ليست من هذه الجولة: تظهر أيضًا عند 768×1024 و1024×768 حيث لا تنطبق أي قاعدة جديدة. شاشة التصحيح تمس الدرجات، فتركتها (P1).

**I تسلسل حيّ** (صفحة واحدة دون إعادة تحميل، تبويب التسليمات وفي حقل البحث نص مكتوب، ثم لوحة التنبيهات مفتوحة):

| المقاس | النص في الحقل | التركيز | التبويب | تمرير أفقي |
|---|---|---|---|---|
| 951×585 ← 669×867 ← 470×700 ← 382×580 ← 594×368 ← 951×350 ← 951×585 | بقي «مشروع» في كل خطوة | بقي في الحقل | بقي «التسليمات» | 0 |
| لوحة التنبيهات مفتوحة عبر 669×867 ← 382×580 ← 951×585 | — | — | بقيت مفتوحة (1 قبل، 1 بعد) | 0 |

لا وسائط ولا مؤقت في شاشات المعلّم؛ مؤقت الاختبار لم يُختبر عبر تغيير المقاس لأن تغيير المقاس يقفل الاختبار عمدًا.

**J ضغط الإتاحة** (رئيسية المعلّم عند 669×867 و951×585 و382×580):

| الحالة | النتيجة |
|---|---|
| نص 200% | لا تمرير أفقي. عنصر واحد يخرج عن الشاشة عند 669 وثلاثة عند 382، ونص واحد يمس الكعب عند 951. PARTIAL |
| الوضع الداكن | 0 في كل المقاييس، والكعب له ألوان داكنة. PASS |
| لوحة المفاتيح (تقصير الارتفاع إلى 350 مع حقل مركّز) | الحقل المركّز ظاهر في 669 و951 و382، ولا تمرير. PASS (محاكاة) |
| حواف أمان غير متماثلة (47px يسار، 12px يمين) | 0 في كل المقاييس. PASS (محاكاة بحشوة؛ Playwright لا يعطي `env(safe-area-inset-*)` قيمًا) |
| تقليل الحركة | كل التدقيق أُجري بـ`reducedMotion: reduce`. القواعد الجديدة لا تضيف حركة. PASS |

**المفصل الحقيقي:** `NOT_TESTED`. WebKit لا يحاكي Viewport Segments. التخطيط لا يعتمد على المفصل، والكعب في المنتصف حيث يقع مفصل الـDuo.

## 4. قبل وبعد

| الحالة | قبل (`origin/main`) | بعد |
|---|---|---|
| الدخول 669×867 | ![](iphone-duo-final/before-login-669x867.jpg) | ![](iphone-duo-final/after-login-identify-669x867.jpg) |
| الدخول 951×585 | ![](iphone-duo-final/before-login-951x585.jpg) | ![](iphone-duo-final/after-login-identify-951x585.jpg) |
| رئيسية المعلّم 669×867 | ![](iphone-duo-final/before-teacher-home-669x867.jpg) | ![](iphone-duo-final/after-teacher-home-669x867.jpg) |
| رئيسية المعلّم 951×585 | ![](iphone-duo-final/before-teacher-home-951x585.jpg) | ![](iphone-duo-final/after-teacher-home-951x585.jpg) |
| رئيسية الطالب 669×867 | ![](iphone-duo-final/before-student-home-669x867.jpg) | ![](iphone-duo-final/after-student-home-669x867.jpg) |
| رئيسية الطالب 951×585 | ![](iphone-duo-final/before-student-home-951x585.jpg) | ![](iphone-duo-final/after-student-home-951x585.jpg) |

بعد فقط: [الطلبة 669×867](iphone-duo-final/after-teacher-students-669x867.jpg)، [الأكواد ← الأجهزة 951×585](iphone-duo-final/after-teacher-codes-devices-951x585.jpg)، [لوحة التنبيهات 669×867](iphone-duo-final/after-teacher-notifications-669x867.jpg)، [الحاسوب المحمول 951×350](iphone-duo-final/after-teacher-home-951x350.jpg)، [الطالب مطويًا عرضيًا 594×368](iphone-duo-final/after-student-home-594x368.jpg).

## 5. ما بقي

| الأولوية | البند |
|---|---|
| P0 | لا شيء معروف |
| P1 | شاشة التصحيح (`teacher-submissions-detail`) تعبر الكعب في C وD، وأزرار «إرجاع النشاط للطالب» خارج الشاشة في عدة مقاسات (سابق). تحتاج قرارًا لأنها تمس الدرجات |
| P1 | الاختبار الجاري عمود واحد على الشاشة الداخلية الطولية، والعرضية يقفلها منطق النزاهة. خارج النطاق، وقرار المالك |
| P2 | أهداف لمس سابقة أصغر من 44px: نقاط جولة التعريف، وأزرار في «سؤال جديد» وبنك الأسئلة والأكواد (القائمة في التقرير JSON) |
| P2 | نص 200%: عنصر يخرج عن الشاشة عند 669 وثلاثة عند 382، ونص يمس الكعب عند 951 |
| P2 | نموذج «مقرر جديد» عند 951: الحقلان مكدّسان على اليمنى والصفحة اليسرى فارغة إلا من الأزرار |
| P2 | `codes` ← archive / attempts / scope و`analytics` لم تُفحص (غير ظاهرة للمعلّم التجريبي) |

## 6. كيف يُعاد القياس

```bash
# خادم محلي معزول: مجلد ظل بلا firebase-applet-config.json، وقاعدة مبذورة
npm ci && npm run build
mkdir -p /tmp/duo-shadow/data && cd /tmp/duo-shadow
for f in /path/to/Mirasedu/*; do [ "$(basename $f)" != firebase-applet-config.json ] && ln -s "$f" .; done
#   (اربط dist وnode_modules أيضًا، وانسخ data/db.json الناتج من: node tests/seed.cjs)
NODE_ENV=production PORT=5140 MIRAS_ALLOW_LOCAL_ONLY_MODE=true \
  MIRAS_SESSION_SECRET=... MIRAS_JOIN_CODE_SIGNING_SECRET=... MIRAS_ROLLCALL_QR_SECRET=... \
  node dist/server.cjs

# التدقيق (Playwright WebKit؛ يحجب كل طلب خارج الخادم المحلي)
NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node docs/iphone-duo-final/duo-final-audit.cjs http://localhost:5140 report.json shots/ after
# DUO_ONLY=teacher-codes,student-home يقصر التشغيل على شاشات بعينها
```

مسار الطالب التجريبي يمر بـ`/api/demo/enter`، وحدّه 20 دخولًا كل 15 دقيقة لكل عنوان. التشغيل الكامل يستهلك 7 دخولات ويأخذ نحو 15 دقيقة.

## 7. الاختبارات

| الأمر | النتيجة |
|---|---|
| `npm run lint` (`tsc --noEmit`) | PASS محليًا |
| `npm run build` (يشمل `verify:pwa` و`verify:demo-entry`) | PASS محليًا |
| `npm run test:flows` | لم يُشغَّل محليًا (الجهاز مشترك مع جلسات أخرى، والتعديل CSS فقط). يشغّله `PR Verification` على GitHub |

## 8. قائمة المالك على الجهاز الحقيقي

1. افتح الـDuo كالكتاب طوليًا، وادخل بالبيئة التجريبية: هل يقع خط الكعب على المفصل تمامًا؟ إن انحرف، فاذكر عرض النافذة الذي يعلنه Safari.
2. في رئيسية المعلّم: الأرقام يمينًا والتنبيهات يسارًا، ولا شيء يقع على المفصل؟
3. شريط الأقسام السفلي (669): ثلاثة يمينًا واثنان يسارًا، وكلها في متناول الإبهامين؟
4. افتح الجرس: هل تنسدل اللوحة على الصفحة اليسرى تحته؟
5. ادخل كطالب: النافذة «تنبيه مهم» على الصفحة اليمنى؟
6. لُفّ الجهاز عرضيًا (951×585)، ثم ثبّت لوحة لتقصير الارتفاع إلى نحو 350: هل ينزل شريط الأقسام إلى الأسفل ولا يغطي آخر المحتوى؟
7. أغلق الجهاز (الشاشة الخارجية): عمود واحد دون كعب.
8. اكتب في بحث التسليمات ثم افتح الجهاز وأغلقه: هل يبقى النص والتبويب؟
