/**
 * Demo data for مِراس.
 *
 * A demo visitor gets a private `LocalDatabase` built from this seed. It never
 * touches `data/db.json` and never reaches Firestore, so a walkthrough can be as
 * destructive as it likes — grade a submission, revoke a join code, suspend an
 * enrolment — without a single real student record moving.
 *
 * The live database starts intentionally empty (curriculum, rosters and codes
 * are user-owned), which is correct for a real institution and useless in front
 * of a prospective one: every screen would be a blank table. This seed fills the
 * whole term instead — four courses, a hundred students, a graded submission
 * pile, an activity log with real violation warnings in it.
 *
 * Everyone below is invented. The IDs are Kuwaiti-university-shaped so the
 * screens read naturally and match no real person.
 */
import type {
  ActivationAttempt,
  ActivityLog,
  AllowedStudent,
  DatabaseState,
  ExerciseSubmission,
  JoinCode,
  PasswordResetRequest,
  Question,
  QuizSubmission,
  Section,
  Student,
  Teacher,
  TextbookChapter,
  WeeklyExercise,
} from "./db";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * day).toISOString();
/* Weekly exercises store a plain calendar day (as live data does), not a timestamp. */
const dayStamp = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

/* Seeded, not random: the same cohort every time, so a screenshot taken for a
 * deck still matches the product next month. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}
const pick = <T>(items: readonly T[], index: number): T => items[index % items.length];

const FIRST = [
  "عبدالله", "دانة", "فهد", "مريم", "ناصر", "شهد", "يوسف", "لولوة",
  "طلال", "نورة", "سلمان", "هيا", "بدر", "العنود", "مشاري", "جنى",
  "راكان", "غلا", "عمر", "حصة", "خالد", "منيرة", "سعود", "وضحى",
  "أحمد", "سارة", "محمد", "ريم", "علي", "فاطمة",
];
const FAMILY = [
  "الفيلكاوي", "العتيبي", "المطيري", "الرشيدي", "العجمي", "الدوسري",
  "الهاجري", "الكندري", "الفضلي", "السبيعي", "البلوشي", "الخالدي",
  "المطوع", "العنزي", "الصالح", "الحربي", "القحطاني", "الشمري",
];

const SEMESTER = "الفصل الأول 2026/2027";
const DEMO_TEACHER_EMAIL = "demo.teacher@miras.test";
const DEMO_TEACHER_NAME = "د. سارة الخالد";

const COURSES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["EDU-TECH-A1", "تقنيات التعليم الحديثة — شعبة A1", true],
  ["EDU-TECH-B2", "تقنيات التعليم الحديثة — شعبة B2", true],
  ["AI-EDU-KW-C1", "الذكاء الاصطناعي في التعليم — شعبة C1", true],
  ["CUR-DSGN-D1", "تصميم المناهج الرقمية — شعبة D1", false],
];

const CHAPTERS: ReadonlyArray<readonly [string, string, ReadonlyArray<readonly [string, string, string[]]>]> = [
  ["الفصل الأول: أسس تقنيات التعليم", "من الوسيلة إلى المنظومة", [
    ["مفهوم تقنيات التعليم", "12 - 24", ["التعريف", "التطور التاريخي", "المجالات"]],
    ["نظريات التعلم والتقنية", "25 - 40", ["السلوكية", "المعرفية", "البنائية"]],
  ]],
  ["الفصل الثاني: تصميم التعلم الرقمي", "نموذج ADDIE تطبيقياً", [
    ["تحليل المتعلمين", "41 - 58", ["الخصائص", "الاحتياجات", "السياق"]],
    ["التصميم والتطوير", "59 - 78", ["الأهداف", "المحتوى", "الأنشطة"]],
    ["التقويم والتحسين", "79 - 95", ["التقويم التكويني", "الختامي", "التغذية الراجعة"]],
  ]],
  ["الفصل الثالث: الذكاء الاصطناعي في الصف", "الأدوات وحدودها", [
    ["أدوات الذكاء التوليدي", "96 - 118", ["الاستخدامات", "المخاطر", "الضوابط"]],
    ["النزاهة الأكاديمية", "119 - 136", ["الانتحال", "الإفصاح", "سياسات الاستخدام"]],
  ]],
  ["الفصل الرابع: التقويم الإلكتروني", "من الاختبار إلى الدليل", [
    ["بنوك الأسئلة", "137 - 154", ["الصياغة", "الصعوبة", "التوزيع"]],
    ["الاختبارات المؤمّنة", "155 - 172", ["بيئة الاختبار", "منع الغش", "سجل المحاولات"]],
  ]],
];

const QUESTION_TEMPLATES: ReadonlyArray<readonly [Question["type"], string, string[], string, Question["difficulty"]]> = [
  ["multiple-choice", "أي مما يلي يمثل أفضل تعريف لتقنيات التعليم كمنظومة؟", ["وسيلة عرض داخل الصف", "منظومة متكاملة من العمليات والموارد", "برنامج حاسوبي تعليمي", "جهاز عرض حديث"], "منظومة متكاملة من العمليات والموارد", "beginner"],
  ["true-false", "نموذج ADDIE يبدأ بمرحلة التصميم قبل التحليل.", ["صح", "خطأ"], "خطأ", "beginner"],
  ["multiple-choice", "في أي مرحلة من ADDIE تُحدَّد خصائص المتعلمين واحتياجاتهم؟", ["التحليل", "التصميم", "التطوير", "التقويم"], "التحليل", "beginner"],
  ["short-answer", "اذكر ضابطين أساسيين لاستخدام أدوات الذكاء التوليدي في التقويم الصفي.", [], "الإفصاح عن الاستخدام، والتحقق البشري من المخرجات", "intermediate"],
  ["multiple-choice", "أي إجراء يقلّل من احتمالية الغش في الاختبارات الإلكترونية؟", ["إطالة مدة الاختبار", "تثبيت ترتيب الأسئلة", "تعشية الأسئلة وتقييد بيئة الاختبار", "رفع درجة النجاح"], "تعشية الأسئلة وتقييد بيئة الاختبار", "intermediate"],
  ["scenario-analysis", "معلمة لاحظت أن نصف الطلاب سلّموا إجابات متطابقة في نشاط مفتوح. ما الإجراء المنهجي الصحيح؟", [], "توثيق الحالة، مقابلة الطلاب، تطبيق سياسة النزاهة المعتمدة قبل أي قرار", "advanced"],
  ["true-false", "التقويم التكويني هدفه إصدار حكم نهائي على أداء المتعلم.", ["صح", "خطأ"], "خطأ", "beginner"],
  ["multiple-choice", "النظرية البنائية ترى أن المتعلم:", ["متلقٍ سلبي للمعلومة", "يبني معرفته من خبراته", "يحفظ ثم يسترجع", "يقلّد نموذج المعلم"], "يبني معرفته من خبراته", "intermediate"],
  ["multiple-choice", "أي ترتيب يمثل مراحل نموذج ADDIE ترتيباً صحيحاً؟", ["التصميم ثم التحليل ثم التطوير ثم التنفيذ ثم التقويم", "التحليل ثم التصميم ثم التطوير ثم التنفيذ ثم التقويم", "التطوير ثم التحليل ثم التصميم ثم التقويم ثم التنفيذ", "التنفيذ ثم التحليل ثم التصميم ثم التطوير ثم التقويم"], "التحليل ثم التصميم ثم التطوير ثم التنفيذ ثم التقويم", "intermediate"],
  ["multiple-choice", "أهم معيار عند اختيار أداة رقمية لنشاط صفي هو:", ["شهرة الأداة", "ملاءمتها للهدف التعليمي", "كلفتها فقط", "حداثة واجهتها"], "ملاءمتها للهدف التعليمي", "beginner"],
  ["short-answer", "ما الفرق بين الوسيلة التعليمية ومنظومة تقنيات التعليم؟", [], "الوسيلة أداة مفردة، والمنظومة تشمل العمليات والموارد والتصميم والتقويم", "intermediate"],
  ["multiple-choice", "الإفصاح عن استخدام الذكاء الاصطناعي في التسليم يُعد:", ["اختيارياً دائماً", "مطلباً للنزاهة الأكاديمية", "دليل ضعف الطالب", "إجراءً إدارياً فقط"], "مطلباً للنزاهة الأكاديمية", "advanced"],
];


type QuestionTemplate = readonly [Question["type"], string, string[], string, Question["difficulty"]];

/*
 * لكل فصلٍ أسئلته: كان القالب نفسه (اثنا عشر سؤالًا) يُكرَّر على الفصول الأربعة،
 * فيخرج اختبارٌ من خمسة عشر سؤالًا وفيه «نموذج ADDIE يبدأ بالتصميم…» ثلاث مرات.
 * وعدد أسئلة كل اختبار يساوي درجته (لكل سؤالٍ درجة واحدة)، فيُطابق مجموع
 * درجات ما يراه الطالب ما كُتب على بطاقة الاختبار.
 */
const CHAPTER_QUESTION_TEMPLATES: ReadonlyArray<ReadonlyArray<QuestionTemplate>> = [
  QUESTION_TEMPLATES as ReadonlyArray<QuestionTemplate>,
  [
    ["multiple-choice", "أول خطوة في تصميم وحدة تعليمية رقمية هي:", ["اختيار الأداة", "تحليل المتعلمين والاحتياج التعليمي", "إعداد الاختبار النهائي", "تصوير المحتوى"], "تحليل المتعلمين والاحتياج التعليمي", "beginner"],
    ["true-false", "الأهداف السلوكية الجيدة قابلة للقياس والملاحظة.", ["صح", "خطأ"], "صح", "beginner"],
    ["multiple-choice", "أي صياغة تمثل هدفًا سلوكيًا سليمًا؟", ["أن يفهم الطالب الدرس", "أن يعدّد الطالب ثلاثة معايير لاختيار الوسيلة", "أن يتعلم الطالب بمتعة", "أن يهتم الطالب بالمادة"], "أن يعدّد الطالب ثلاثة معايير لاختيار الوسيلة", "intermediate"],
    ["short-answer", "اذكر عنصرين من عناصر تحليل السياق التعليمي قبل التصميم.", [], "بيئة التعلم المتاحة، والأجهزة والاتصال المتوفران للمتعلمين", "intermediate"],
    ["multiple-choice", "تُستخدم التغذية الراجعة في التقويم التكويني من أجل:", ["حجب الدرجة", "توجيه المتعلم نحو التحسين أثناء التعلم", "ترتيب الطلاب", "إنهاء الوحدة"], "توجيه المتعلم نحو التحسين أثناء التعلم", "beginner"],
    ["true-false", "تحديد الوسائط المناسبة يسبق تحديد الأهداف في نموذج ADDIE.", ["صح", "خطأ"], "خطأ", "intermediate"],
    ["scenario-analysis", "وحدة رقمية أُنجزت بإتقان فشل طلابها في اختبارها الختامي. كيف تحلّل السبب منهجيًا؟", [], "مراجعة مواءمة الأهداف مع الأنشطة والاختبار، ثم تحليل بيانات الأداء لتحديد موضع الفجوة", "advanced"],
    ["multiple-choice", "التقويم الختامي يُجرى عادةً:", ["قبل بدء الوحدة", "أثناء كل نشاط", "في نهاية الوحدة أو المقرر", "دون درجات"], "في نهاية الوحدة أو المقرر", "beginner"],
    ["multiple-choice", "أي ترتيب يمثل خطوات إعداد نشاط تعليمي رقمي؟", ["التجريب ثم تحديد الهدف ثم التصميم ثم التحسين", "تحديد الهدف ثم اختيار المحتوى ثم تصميم النشاط ثم التجريب ثم التحسين", "تصميم النشاط ثم تحديد الهدف ثم التحسين ثم التجريب", "اختيار المحتوى ثم التحسين ثم تحديد الهدف ثم التجريب"], "تحديد الهدف ثم اختيار المحتوى ثم تصميم النشاط ثم التجريب ثم التحسين", "intermediate"],
    ["multiple-choice", "أي نشاط يحقق مستوى التطبيق في تصنيف بلوم؟", ["نسخ تعريف", "حل مسألة جديدة بتوظيف قاعدة مدروسة", "تذكّر تاريخ حدث", "ترديد مصطلح"], "حل مسألة جديدة بتوظيف قاعدة مدروسة", "intermediate"],
    ["short-answer", "لماذا يُفضَّل تجريب النشاط على عيّنة صغيرة قبل التعميم؟", [], "لكشف مشكلات الوضوح والزمن والأدوات وتعديلها قبل التطبيق الواسع", "intermediate"],
    ["true-false", "تجميع المحتوى في شريحة واحدة طويلة يقلل العبء المعرفي.", ["صح", "خطأ"], "خطأ", "beginner"],
  ],
  [
    ["multiple-choice", "أي مما يلي استخدام مناسب لأدوات الذكاء التوليدي في التحضير؟", ["تسليم مخرجاتها كما هي دون مراجعة", "توليد مسوّدة أمثلة ثم مراجعتها وتعديلها", "تقديم إجابات الطلاب بدلًا عنهم", "إخفاء مصدر المحتوى"], "توليد مسوّدة أمثلة ثم مراجعتها وتعديلها", "beginner"],
    ["true-false", "مخرجات الذكاء التوليدي صحيحة دائمًا ولا تحتاج تحققًا.", ["صح", "خطأ"], "خطأ", "beginner"],
    ["short-answer", "اذكر خطرين محتملين عند الاعتماد على الذكاء التوليدي في إعداد المحتوى.", [], "معلومات غير دقيقة أو مختلقة، وانحياز في المخرجات", "intermediate"],
    ["multiple-choice", "الانتحال الأكاديمي يعني:", ["الاستعانة بمصدر مع توثيقه", "نسب عمل الغير إلى النفس دون إشارة إليه", "تلخيص النص بأسلوب الطالب مع المصدر", "مراجعة عمل زميل بإذنه"], "نسب عمل الغير إلى النفس دون إشارة إليه", "beginner"],
    ["multiple-choice", "أفضل صيغة للإفصاح عن استخدام أداة ذكاء اصطناعي في تسليم هي:", ["عدم ذكرها", "ذكر الأداة وغرض استخدامها وحدود الاعتماد عليها", "ذكرها في آخر سطر بلا تفصيل", "إخفاؤها داخل الملف"], "ذكر الأداة وغرض استخدامها وحدود الاعتماد عليها", "intermediate"],
    ["scenario-analysis", "طالب سلّم تحليلًا متقنًا لا يشبه مستواه السابق ولم يفصح عن أي أداة. ما التصرف المنهجي؟", [], "مناقشته في مضمون العمل أولًا، وطلب مسودّاته، ثم تطبيق سياسة النزاهة المعتمدة", "advanced"],
    ["true-false", "وجود سياسة مكتوبة لاستخدام الأدوات الذكية يساعد في توحيد توقعات الطلاب.", ["صح", "خطأ"], "صح", "beginner"],
    ["multiple-choice", "ما الترتيب السليم للتحقق من معلومة ولّدتها أداة ذكاء اصطناعي؟", ["نشرها ثم مطابقتها بالمصادر", "تحديد الادعاءات القابلة للتحقق ثم مطابقتها بمصادر موثوقة ثم تعديل النص وتوثيق المصادر", "توثيق المصادر ثم قراءة المخرج", "الاكتفاء بقراءة المخرج وتسليمه"], "تحديد الادعاءات القابلة للتحقق ثم مطابقتها بمصادر موثوقة ثم تعديل النص وتوثيق المصادر", "intermediate"],
    ["multiple-choice", "أي ضابط يحمي خصوصية الطلاب عند استخدام أداة سحابية؟", ["رفع قوائم الأسماء الكاملة", "عدم إدخال بيانات تعريفية للطلاب في الأداة", "مشاركة كلمات المرور", "تعطيل سياسة الخصوصية"], "عدم إدخال بيانات تعريفية للطلاب في الأداة", "intermediate"],
    ["short-answer", "عرّف الإفصاح عن الاستخدام في سياق النزاهة الأكاديمية.", [], "إعلان صريح بأدوات المساعدة المستخدمة وكيفية توظيفها في العمل المسلَّم", "intermediate"],
    ["multiple-choice", "المعلم الذي يطلب نسخ المسودات مع التسليم يهدف إلى:", ["إرهاق الطلاب", "إثبات مسار الإنجاز وتعزيز الشفافية", "رفع الدرجات", "تقليل الواجبات"], "إثبات مسار الإنجاز وتعزيز الشفافية", "intermediate"],
    ["true-false", "الاقتباس المباشر يحتاج توثيقًا حتى لو كان قصيرًا.", ["صح", "خطأ"], "صح", "beginner"],
  ],
  [
    ["multiple-choice", "السؤال الجيد في بنك الأسئلة يتميز بأنه:", ["غامض الصياغة", "واضح ويقيس هدفًا محددًا", "يحتمل أكثر من إجابة صحيحة", "طويل بلا حاجة"], "واضح ويقيس هدفًا محددًا", "beginner"],
    ["true-false", "توزيع الأسئلة على مستويات صعوبة مختلفة يحسّن قدرة الاختبار على التمييز.", ["صح", "خطأ"], "صح", "beginner"],
    ["multiple-choice", "المموّهات في أسئلة الاختيار من متعدد ينبغي أن تكون:", ["خاطئة بوضوح ساخر", "معقولة وجذّابة لمن لم يتقن الفكرة", "صحيحة جزئيًا دائمًا", "أقصر من الإجابة الصحيحة"], "معقولة وجذّابة لمن لم يتقن الفكرة", "intermediate"],
    ["short-answer", "اذكر ميزتين لتعشية ترتيب أسئلة الاختبار الإلكتروني.", [], "تقليل التنسيق بين الطلاب، وصعوبة نقل الإجابات بالترتيب", "intermediate"],
    ["multiple-choice", "سجل المحاولات في الاختبار المؤمَّن يفيد في:", ["تجميل الواجهة", "توثيق زمن الدخول والتسليم وأي إخلال بالقواعد", "رفع الدرجات", "إخفاء الأخطاء"], "توثيق زمن الدخول والتسليم وأي إخلال بالقواعد", "intermediate"],
    ["scenario-analysis", "اختبار إلكتروني تجاوز نصف طلابه الدرجة الكاملة في عشر دقائق. كيف تفحص جودته؟", [], "مراجعة صعوبة الأسئلة وتمييزها وتسرّب النموذج، ثم تحليل أزمنة الحل وسجل المحاولات", "advanced"],
    ["true-false", "رصد الدرجات قبل مراجعة الإجابات المقالية يضمن العدالة.", ["صح", "خطأ"], "خطأ", "intermediate"],
    ["multiple-choice", "ما الترتيب الصحيح لدورة الاختبار الإلكتروني؟", ["التسليم ثم إعداد الأسئلة ثم النشر ثم الرصد", "إعداد الأسئلة ثم نشر الاختبار ثم التسليم ثم الرصد ثم اعتماد الدرجات", "نشر الاختبار ثم اعتماد الدرجات ثم إعداد الأسئلة", "الرصد ثم النشر ثم التسليم ثم إعداد الأسئلة"], "إعداد الأسئلة ثم نشر الاختبار ثم التسليم ثم الرصد ثم اعتماد الدرجات", "intermediate"],
    ["multiple-choice", "أفضل توقيت لإتاحة مراجعة الإجابات للطلاب في الاختبارات الرسمية:", ["أثناء الاختبار", "بعد إغلاق الاختبار واعتماد الدرجات", "قبل فتحه", "لا تُتاح أبدًا"], "بعد إغلاق الاختبار واعتماد الدرجات", "intermediate"],
    ["short-answer", "ما الغرض من الدليل التقييمي (Rubric) في تصحيح الأسئلة المقالية؟", [], "توحيد معايير الحكم وتوضيح مستويات الأداء للطالب والمصحّح", "intermediate"],
    ["multiple-choice", "ما الذي يحدّه تقييد بيئة الاختبار؟", ["قدرة الطالب على الحل", "فرص الاستعانة بمصادر غير مسموحة أثناء الاختبار", "عدد الأسئلة", "زمن الاختبار الرسمي"], "فرص الاستعانة بمصادر غير مسموحة أثناء الاختبار", "intermediate"],
    ["true-false", "تكرار السؤال نفسه ضمن الاختبار الواحد لا يؤثر في صدقه.", ["صح", "خطأ"], "خطأ", "beginner"],
  ],
];

const EXERCISE_TEMPLATES: ReadonlyArray<readonly [WeeklyExercise["type"], string, string]> = [
  ["scenario", "تحليل موقف صفي", "أمامك موقف صفي لمعلمة أدخلت أداة رقمية دون تحليل احتياج. حلّل الموقف واقترح بديلاً منهجياً."],
  ["tool-selection", "اختيار أداة رقمية", "اختر أداة رقمية مناسبة لدرس في الرياضيات للصف السادس، وبرّر اختيارك بمعايير واضحة."],
  ["activity-design", "تصميم نشاط تعلّم", "صمّم نشاطاً تفاعلياً مدته ٢٠ دقيقة يحقق هدفاً معرفياً محدداً، مع أداة تقويم مرافقة."],
  ["critique", "نقد مورد تعليمي", "اختر مورداً تعليمياً رقمياً جاهزاً وانقده وفق معايير التصميم التعليمي."],
  ["connection", "الربط بين النظرية والتطبيق", "اربط بين إحدى نظريات التعلم وممارسة صفية واقعية عايشتها أو لاحظتها."],
];

const ACTIONS: ReadonlyArray<readonly [string, string, boolean]> = [
  ["LOGIN", "تسجيل دخول ناجح", false],
  ["QUIZ_START", "بدء اختبار الفصل", false],
  ["QUIZ_SUBMIT", "تسليم اختبار الفصل", false],
  ["EXERCISE_SUBMIT", "تسليم نشاط أسبوعي", false],
  ["DEVICE_REGISTERED", "تسجيل جهاز جديد", false],
  ["TAB_SWITCH", "خروج من نافذة الاختبار أثناء المحاولة", true],
  ["PASTE_BLOCKED", "محاولة لصق نص داخل بيئة الاختبار", true],
  ["THIRD_DEVICE_BLOCKED", "محاولة دخول من جهاز ثالث — مرفوضة", true],
  ["JOIN_CODE_REDEEMED", "استخدام رمز انضمام", false],
  ["ENROLLMENT_SUSPENDED", "تعليق تسجيل طالب", false],
  ["GRADE_RELEASED", "اعتماد ورصد درجة", false],
];

const RETURN_NOTES = [
  "الإجابة عامة جداً — ارجع إلى معايير التصميم في الفصل الثاني.",
  "الملف المرفوع غير مقروء. أعد الرفع بصيغة PDF.",
  "لم تُذكر المصادر. أضف التوثيق ثم أعد التسليم.",
];

const FEEDBACK = [
  "تحليل واضح ومسند بالمراجع. أحسنت.",
  "فكرة جيدة، لكن الربط بالنظرية يحتاج تعميقاً.",
  "تصميم النشاط عملي وقابل للتطبيق مباشرة.",
  "التبرير ضعيف مقابل المعايير المطلوبة.",
];

/**
 * A fresh demo database. Called when a sandbox is created and again on reset.
 *
 * `teachers` is the one collection carried over from the live seed: the demo
 * instructor has to be able to sign in with the same code paths as a real one,
 * so the demo does not quietly become a different product.
 */
export function createDemoDatabaseState(liveTeachers: Teacher[]): DatabaseState {
  const random = makeRandom(0x6d72);

  const sections: Section[] = COURSES.map(([code, courseName, isOpen]) => ({
    code,
    courseName,
    semester: SEMESTER,
    isOpen,
    ownerEmail: "demo.teacher@miras.test",
    /* بلا اسمٍ هنا تقرأ بطاقات الأكواد «اسم الدكتور غير محمّل». */
    teacherName: DEMO_TEACHER_NAME,
  }) as Section);

  const teachers: Teacher[] = [
    ...liveTeachers,
    {
      id: "demo_teacher_1",
      name: `${DEMO_TEACHER_NAME} (بيئة تجريبية)`,
      email: "demo.teacher@miras.test",
      // No usable credential: a demo instructor is reached by entering the
      // demo, never by signing in, so there is nothing here to guess.
      passwordHash: "",
      role: "teacher",
      isActive: true,
    },
  ];

  const chapters: TextbookChapter[] = CHAPTERS.map(([title, subtitle, topics], index) => ({
    /*
     * `chap-N` لا `demo_ch_N`: هذه صيغة الخادم نفسها لفصول المصدر، وبنك الأسئلة
     * في لوحة المعلّم يفتح مُرشَّحًا على `chap-1` افتراضيًا. بمعرّفٍ آخر كان البنك
     * يفتح فارغًا تمامًا مع أن فيه ثمانيةً وأربعين سؤالًا.
     */
    id: `chap-${index + 1}`,
    title,
    subtitle,
    topics: topics.map(([topicTitle, pages, concepts], t) => ({
      id: `chap-${index + 1}-t${t + 1}`,
      title: topicTitle,
      pages,
      concepts: [...concepts],
    })),
    teacherEmail: "demo.teacher@miras.test",
  }));

  // A bank big enough that generating a quiz actually has something to choose
  // from, with a few still pending approval so the review queue is not empty.
  const questionBank: Question[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    CHAPTER_QUESTION_TEMPLATES[chapterIndex].forEach(([type, questionText, options, correctAnswer, difficulty], q) => {
      const index = chapterIndex * CHAPTER_QUESTION_TEMPLATES[0].length + q;
      questionBank.push({
        id: `demo_q_${index + 1}`,
        chapterId: chapter.id,
        topicId: chapter.topics[q % chapter.topics.length].id,
        type,
        questionText,
        options: options.length ? [...options] : undefined,
        correctAnswer: correctAnswer as Question["correctAnswer"],
        points: 1,
        difficulty,
        isApproved: index % 9 !== 0,
        isGenerated: index % 3 === 0,
        teacherEmail: "demo.teacher@miras.test",
      });
    });
  });

  const exercises: WeeklyExercise[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    EXERCISE_TEMPLATES.forEach(([type, title, promptText], e) => {
      const index = chapterIndex * EXERCISE_TEMPLATES.length + e;
      exercises.push({
        id: `demo_ex_${index + 1}`,
        chapterId: chapter.id,
        title: `${title} — ${chapter.title.split(":")[0]}`,
        type,
        promptText,
        // A mix of past and upcoming deadlines, so late submissions are real.
        dueDate: index % 2 === 0 ? dayStamp(-(14 - index)) : dayStamp(3 + index),
        isPersonalized: index % 4 === 0,
      });
    });
  });

  const students: Student[] = [];
  const allowedStudents: AllowedStudent[] = [];
  const count = 100;
  const usedStudentNames = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    /* لا اسمان متطابقان: ثلاثون اسمًا أول وثمانية عشر لقبًا كانت تُكرّر الاسم
       الكامل نفسه لأكثر من طالب، فيظهر في كشف الدرجات والتصدير صفّان متطابقان. */
    let nameShift = 0;
    let name = `${pick(FIRST, index)} ${pick(FAMILY, index * 3)}`;
    while (usedStudentNames.has(name)) {
      nameShift += 1;
      name = `${pick(FIRST, index)} ${pick(FAMILY, index * 3 + nameShift)}`;
    }
    usedStudentNames.add(name);
    const idNumber = String(2026100000 + index * 7);
    const section = pick(sections, index);
    const progress = Math.floor(random() * 101);
    students.push({
      id: idNumber,
      name,
      email: `student${index + 1}@demo.miras.test`,
      sectionCode: section.code,
      semester: SEMESTER,
      passwordHash: "",
      isPaid: index % 8 !== 0,
      isActivated: index % 11 !== 0,
      devices: index % 5 === 0 ? [`dev_${index}_a`, `dev_${index}_b`] : [`dev_${index}_a`],
      pathwayCode: pick(["AI-EDU-KW-B2", "EDU-TECH-A1", "CUR-DSGN-D1"], index),
      progress,
      /* درجةٌ مئوية: الغالبية بين ٧٥ و٩٨٪ وعُشر الشعبة فقط متعثّر. كانت تنزل إلى
         الأربعينات فيُعدّ أغلب الشعبة متعثرًا في «إنذار التعثر المبكر». */
      score: index % 10 === 3 ? 48 + Math.floor(random() * 22) : Math.min(98, 75 + Math.floor(progress * 0.2 + random() * 4)),
      strengths: [pick(["التحليل", "التصميم التعليمي", "العرض والتقديم", "العمل الجماعي"], index)],
      weaknesses: [pick(["التوثيق", "إدارة الوقت", "الربط بالنظرية", "الدقة في المصطلحات"], index + 1)],
      recommendations: ["راجع الفصل الثاني", "أكمل النشاط الأسبوعي المتأخر"],
      signupDate: ago(120 - (index % 100)),
      /* معظم الطلبة دخلوا خلال الأيام الخمسة الماضية، وقلّةٌ فقط غابت أسبوعًا
         فأكثر — فيخرج «إنذار التعثر المبكر» بحالاتٍ قليلة لا بكل الشعبة. */
      lastLoginDate: index % 9 === 4 ? ago(8 + (index % 6)) : ago(index % 5),
      activatedCourseCodes: [section.code],
      enrollments: [
        { courseCode: section.code, sectionCode: section.code, courseName: section.courseName, teacherEmail: "demo.teacher@miras.test", isActive: index % 13 !== 0, status: index % 13 === 0 ? "suspended" : "active", isOpen: section.isOpen, isSuspended: index % 13 === 0 },
      ],
    });
    allowedStudents.push({ idNumber, name, sectionCode: section.code });
  }

  // Submissions: a grading pile with every state represented, including
  // returned work and late arrivals. A queue of nothing-but-graded would hide
  // the review workflow entirely.
  const exerciseSubmissions: ExerciseSubmission[] = [];
  const quizSubmissions: QuizSubmission[] = [];
  students.forEach((student, s) => {
    const submissionCount = 1 + (s % 4);
    for (let n = 0; n < submissionCount; n += 1) {
      const index = s * 4 + n;
      const exercise = pick(exercises, index);
      const state = index % 7 === 0 ? "returned" : index % 3 === 0 ? "submitted" : "graded";
      exerciseSubmissions.push({
        id: `demo_sub_${index + 1}`,
        studentId: student.id,
        studentName: student.name,
        studentIdNumber: student.id,
        sectionCode: student.sectionCode,
        exerciseId: exercise.id,
        exerciseTitle: exercise.title,
        studentAnswer: "إجابة تجريبية تعرض بنية التسليم وطريقة عرضها على المعلّم في لوحة التصحيح.",
        score: state === "graded" ? Math.round(6 + random() * 4) : undefined,
        feedback: state === "graded" ? pick(FEEDBACK, index) : undefined,
        submittedAt: ago(Math.max(0, 18 - (index % 18))),
        watermark: `MIRAS-DEMO-${student.id}-${index}`,
        status: state,
        returnedAt: state === "returned" ? ago(2) : undefined,
        returnedByEmail: state === "returned" ? "demo.teacher@miras.test" : undefined,
        returnNote: state === "returned" ? pick(RETURN_NOTES, index) : undefined,
        submittedLate: index % 9 === 0,
      });
    }

    if (s % 2 === 0) {
      const chapter = pick(chapters, s);
      const chapterQuestions = questionBank.filter(q => q.chapterId === chapter.id && q.isApproved).slice(0, 8);
      const matched = chapterQuestions.map((question, q) => {
        const isCorrect = (s + q) % 4 !== 0;
        return {
          questionId: question.id,
          questionText: question.questionText,
          studentAnswer: isCorrect ? question.correctAnswer : "إجابة غير صحيحة",
          correctAnswer: question.correctAnswer,
          isCorrect,
          pointsEarned: isCorrect ? question.points : 0,
        };
      });
      const totalPoints = chapterQuestions.reduce((sum, q) => sum + q.points, 0);
      quizSubmissions.push({
        id: `demo_quiz_${s + 1}`,
        studentId: student.id,
        studentName: student.name,
        studentIdNumber: student.id,
        sectionCode: student.sectionCode,
        chapterId: chapter.id,
        matchedQuestions: matched,
        score: matched.reduce((sum, m) => sum + m.pointsEarned, 0),
        totalPoints,
        durationMinutes: 12 + Math.floor(random() * 30),
        deviceFingerprint: student.devices[0],
        deviceOS: pick(["Windows 11", "macOS 15", "iOS 19", "Android 16"], s),
        deviceBrowser: pick(["Chrome", "Safari", "Edge", "Firefox"], s),
        ipAddress: `10.0.${s % 255}.${(s * 7) % 255}`,
        submittedAt: ago(Math.max(0, 16 - (s % 16))),
        status: s % 5 === 0 ? "submitted" : "graded",
      });
    }
  });

  // The activity log is مِراس's integrity evidence. It has to contain real
  // violation warnings, not just clean logins, or the feature reads as decorative.
  const activityLogs: ActivityLog[] = Array.from({ length: 260 }, (_, index) => {
    const student = pick(students, index * 3);
    const [action, details, isViolationWarning] = pick(ACTIONS, index);
    return {
      id: `demo_log_${index + 1}`,
      studentId: student.id,
      studentName: student.name,
      actorEmail: index % 11 === 0 ? "demo.teacher@miras.test" : undefined,
      teacherEmail: "demo.teacher@miras.test",
      sectionCode: student.sectionCode,
      action,
      details,
      ip: `10.0.${index % 255}.${(index * 13) % 255}`,
      userAgent: "Mozilla/5.0 (demo)",
      os: pick(["Windows 11", "macOS 15", "iOS 19", "Android 16"], index),
      browser: pick(["Chrome", "Safari", "Edge", "Firefox"], index),
      timestamp: ago(Math.floor(index / 12)),
      isViolationWarning,
    };
  });

  /*
   * الاختبارات والمشاريع — طرفا العمل في مِراس.
   *
   * كانت `teacherExams` و`teacherProjects` و`teacherSubmissions` فارغةً كلها،
   * فيظهر المنتج بنصفه: لوحةٌ فيها طلبة ودرجات، ولا شيء يُسلَّم ولا شيء يُصحَّح.
   * وشاشة الطالب تقول «مطلوب: ٠» — وهي أول ما ينظر إليه من يُعرض عليه النظام.
   *
   * والتوزيع مقصود لا عشوائي، وكله في شعبة الطالب المعروض (`EDU-TECH-B2`):
   *   • اختبارٌ مفتوح الآن ولم يدخله      → «مطلوب» على شاشته
   *   • مشروعان لم يُسلَّما بعد ومهلتهما قادمة → «مطلوب» كذلك
   *   • اختبارٌ أُغلق وسلّمه وينتظر الرصد   → صفٌّ في طابور الأستاذ
   *   • مشروعٌ سلّمه هو وأربعون غيره        → طابورُ تصحيحٍ حقيقي لا صفٌّ واحد
   *   • اختبارٌ أُغلق ورُصد وأُعلنت درجته    → تاريخٌ مكتمل لا شاشةٌ بلا ماضٍ
   */
  const DEMO_SECTION = "EDU-TECH-B2";
  /*
   * والشعبة الأولى تُملأ كذلك، ولها سببٌ دقيق: لوحة الأستاذ تختار مقررها
   * افتراضيًا بأول شعبة في القائمة (`visibleTeacherSections[0]`) لا بشعبة
   * الطالب المعروض. فلو كان العمل كله في شعبة الطالب وحدها لفتح الأستاذ لوحته
   * على «الاختبارات ٠ · المشاريع ٠» — وهي أول شاشة تُعرض على جهة. رُئي فعلًا
   * في المتصفح قبل أن تُملأ.
   */
  const LANDING_SECTION = "EDU-TECH-A1";
  const demoSectionStudents = students.filter((st) => st.sectionCode === DEMO_SECTION);
  const landingSectionStudents = students.filter((st) => st.sectionCode === LANDING_SECTION);

  const teacherExams = [
    {
      id: "demo_exam_open",
      title: "اختبار الفصل الثاني — أنماط التعلّم والوسائط",
      points: 20,
      questionsCount: 20,
      /* مفتوحٌ الآن: فُتح أمس ويُغلق بعد أربعة أيام. */
      open: ago(1),
      close: ahead(4),
      courseCode: DEMO_SECTION,
      antiCheat: { randomizeQuestions: true, randomizeOptions: true, timerMinutes: 45, autosave: true },
      review: { mode: "after_close" as const, scope: "mistakes" as const, showGrade: true, gradesReleased: false },
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(9),
    },
    {
      id: "demo_exam_grading",
      title: "اختبار قصير — تصميم الأنشطة الرقمية",
      points: 10,
      questionsCount: 10,
      /* أُغلق قبل ثلاثة أيام، وتسليماته تنتظر الرصد. */
      open: ago(10),
      close: ago(3),
      courseCode: DEMO_SECTION,
      antiCheat: { randomizeQuestions: true, timerMinutes: 20, autosave: true },
      review: { mode: "after_close" as const, scope: "all" as const, showGrade: true, gradesReleased: false },
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(18),
    },
    {
      id: "demo_exam_released",
      title: "اختبار الفصل الأول — أسس تقنيات التعليم",
      points: 25,
      questionsCount: 25,
      open: ago(34),
      close: ago(28),
      courseCode: DEMO_SECTION,
      antiCheat: { randomizeQuestions: true, randomizeOptions: true, timerMinutes: 60, autosave: true },
      review: { mode: "after_close" as const, scope: "all" as const, showGrade: true, gradesReleased: true, releasedAt: ago(26) },
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(45),
    },
    {
      id: "demo_exam_a1_grading",
      title: "اختبار منتصف الفصل — الوسائط وأثرها التعليمي",
      points: 20,
      questionsCount: 20,
      open: ago(9),
      close: ago(2),
      courseCode: LANDING_SECTION,
      antiCheat: { randomizeQuestions: true, randomizeOptions: true, timerMinutes: 45, autosave: true },
      review: { mode: "after_close" as const, scope: "mistakes" as const, showGrade: true, gradesReleased: false },
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(20),
    },
    {
      id: "demo_exam_a1_open",
      title: "اختبار قصير — معايير اختيار الوسيلة",
      points: 10,
      questionsCount: 10,
      open: ago(1),
      close: ahead(3),
      courseCode: LANDING_SECTION,
      antiCheat: { randomizeQuestions: true, timerMinutes: 20, autosave: true },
      review: { mode: "after_close" as const, scope: "all" as const, showGrade: true, gradesReleased: false },
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(6),
    },
    {
      id: "demo_exam_upcoming",
      title: "اختبار تطبيقات الذكاء الاصطناعي في الصف",
      points: 15,
      questionsCount: 15,
      /* لم يُفتح بعد: يظهر على شاشة الطالب كقادمٍ لا كمطلوبٍ الآن. */
      open: ahead(5),
      close: ahead(8),
      courseCode: "AI-EDU-KW-C1",
      antiCheat: { randomizeQuestions: true, timerMinutes: 30, autosave: true },
      review: { mode: "after_close" as const, scope: "mistakes" as const, showGrade: true, gradesReleased: false },
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(4),
    },
  ];

  const teacherProjects = [
    {
      id: "demo_proj_due_soon",
      title: "تصميم وحدة تعليمية رقمية قصيرة",
      description:
        "صمّم وحدة تعليمية لا تتجاوز ثلاث حصص لموضوعٍ من الفصل الثاني، موضّحًا الأهداف السلوكية والوسائط المستخدمة وأداة التقويم. سلّم ملفًا واحدًا يتضمّن خطة الوحدة وعيّنة من النشاط.",
      courseCode: DEMO_SECTION,
      points: 15,
      dueDate: ahead(6),
      closeDate: ahead(8),
      status: "published",
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(8),
      updatedAt: ago(8),
    },
    {
      id: "demo_proj_due_later",
      title: "تحليل أداة تعليمية رقمية ونقدها",
      description:
        "اختر أداةً تعليمية رقمية مستخدمة فعليًا في مدرسة، وحلّلها من حيث الأثر التعليمي وسهولة الاستخدام وملاءمتها للمرحلة، ثم اقترح بديلًا أو تحسينًا مدعومًا بمرجعين.",
      courseCode: DEMO_SECTION,
      points: 20,
      dueDate: ahead(12),
      closeDate: ahead(14),
      status: "published",
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(3),
      updatedAt: ago(3),
    },
    {
      id: "demo_proj_grading",
      title: "تحليل موقف صفّي — توظيف الوسائط",
      description:
        "اعرض موقفًا صفيًّا واجهته أو لاحظته، وبيّن كيف وُظِّفت فيه الوسائط، وما البديل الذي كنت ستختاره ولماذا.",
      courseCode: DEMO_SECTION,
      points: 10,
      dueDate: ago(5),
      closeDate: ago(3),
      status: "published",
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(20),
      updatedAt: ago(20),
    },
    {
      id: "demo_proj_a1_grading",
      title: "ملف إنجاز: وسيلة تعليمية من تصميمك",
      description:
        "صمّم وسيلة تعليمية واحدة ونفّذها، ووثّق خطوات التصميم والتجريب مع صور للمنتج، وبيّن ما الذي عدّلته بعد التجريب ولماذا.",
      courseCode: LANDING_SECTION,
      points: 20,
      dueDate: ago(4),
      closeDate: ago(2),
      status: "published",
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(22),
      updatedAt: ago(22),
    },
    {
      id: "demo_proj_a1_open",
      title: "مقارنة بين منصّتين تعليميتين",
      description:
        "قارن بين منصّتين تعليميتين من حيث إدارة المحتوى والتقويم وتقارير المتابعة، ثم أوصِ بإحداهما لمدرسةٍ محدّدة مع تبرير الاختيار.",
      courseCode: LANDING_SECTION,
      points: 15,
      dueDate: ahead(9),
      closeDate: ahead(11),
      status: "published",
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(2),
      updatedAt: ago(2),
    },
    {
      id: "demo_proj_graded",
      title: "خريطة مفاهيم لأسس تقنيات التعليم",
      description:
        "ابنِ خريطة مفاهيم تربط مفاهيم الفصل الأول، مع شرحٍ موجز لكل علاقة بين مفهومين.",
      courseCode: DEMO_SECTION,
      points: 10,
      dueDate: ago(30),
      closeDate: ago(28),
      status: "published",
      createdBy: "demo.teacher@miras.test",
      createdAt: ago(44),
      updatedAt: ago(44),
    },
  ];

  /*
   * التسليمات.
   *
   * الطالب المعروض (`MIRAS_DEMO_STUDENT_ID` في الخادم) لا يُسلَّم عنه في
   * `demo_exam_open` ولا في المشروعين القادمين — وهذا هو «المطلوب» على شاشته،
   * وحذفُه يعيد الشاشة إلى «مطلوب: ٠» الذي بدأنا منه.
   */
  const SUBMITTED_STATUS = "مقفل بعد التسليم";
  const teacherSubmissions: any[] = [];

  const pushSubmission = (
    activity: { id: string; title: string; points: number; courseCode: string },
    kind: "exam" | "project",
    student: Student,
    index: number,
    options: { graded?: boolean; returned?: boolean; submittedAt: string },
  ) => {
    const grade = options.graded
      ? Math.max(4, Math.round(activity.points * (0.72 + (index % 9) * 0.03)))
      : "";
    teacherSubmissions.push({
      id: `${kind}-${activity.id}-${student.id}`,
      kind,
      activityId: activity.id,
      activityTitle: activity.title,
      courseCode: activity.courseCode,
      studentId: student.id,
      studentName: student.name,
      studentIdNumber: student.id,
      answerText:
        kind === "project"
          ? "أرفقتُ خطة العمل والتحليل في ملفٍ واحد، مع المراجع في آخره."
          : "أُجيبت أسئلة الاختبار داخل المنصّة.",
      attachments: [],
      status: options.returned ? "معاد للطالب" : SUBMITTED_STATUS,
      /* غير المرصود بلا حقل درجة: السلسلة الفارغة تُقرأ صفرًا في «إنذار التعثر
         المبكر» فيُعدّ كل مسلِّمٍ ينتظر الرصد متعثرًا بدرجة ٠٪. */
      grade: options.graded ? String(grade) : undefined,
      visibleGrade: options.graded ? String(grade) : "",
      points: activity.points,
      submittedAt: options.submittedAt,
      updatedAt: options.submittedAt,
      gradedAt: options.graded ? ago(2) : undefined,
      gradedBy: options.graded ? "demo.teacher@miras.test" : undefined,
      returnedAt: options.returned ? ago(1) : undefined,
      returnedByEmail: options.returned ? "demo.teacher@miras.test" : undefined,
      returnNote: options.returned
        ? "المطلوب تحليلٌ لا وصف. أعد الجزء الثاني موضّحًا سبب اختيارك للوسيلة."
        : undefined,
      submittedLate: index % 11 === 0,
    });
  };

  /*
   * والنشاط يُطلب باسمه لا بموضعه في المصفوفة.
   *
   * كان هنا `teacherExams[1]` و`teacherProjects[3]`، فلمّا أُضيف نشاطان في
   * المنتصف انزاحت المواضع: كتب «المشروع القديم المرصود» تسليماته في مشروع
   * شعبةٍ أخرى — خمسةٌ وعشرون طالبًا من شعبةٍ لا ينتمون إليها، ومشروعٌ بلا
   * تسليمٍ واحد. ولم يُكسر بناءٌ ولا نوع، وإنما ظهر الخلل في عدّادٍ على الشاشة.
   * فالبحث بالمعرّف يجعل الترتيب بلا أثر، ويسقط صراحةً إن أُعيدت التسمية.
   */
  const examById = (id: string) => {
    const found = teacherExams.find((exam) => exam.id === id);
    if (!found) throw new Error(`demo seed: اختبارٌ غير معروف: ${id}`);
    return found;
  };
  const projectById = (id: string) => {
    const found = teacherProjects.find((project) => project.id === id);
    if (!found) throw new Error(`demo seed: مشروعٌ غير معروف: ${id}`);
    return found;
  };

  /* اختبارٌ أُغلق: أغلب الشعبة سلّمت وتنتظر الرصد — وهذا طابور الأستاذ. */
  demoSectionStudents.forEach((student, index) => {
    if (index % 7 === 6) return; // بعضهم لم يدخل الاختبار: الواقع ليس مكتملًا دائمًا
    /* الشرط لا يبدأ من الصفر عمدًا: الطالب المعروض أوّل شعبته، فكل شرطٍ
       صيغته `index % n === 0` يصدق عليه — فتُرصد تسليماته كلها، ولا يبقى له
       شيءٌ في طابور الأستاذ. أمسكه فحصُ «كل شيء مرصود» قبل أن يُرى. */
    pushSubmission(examById("demo_exam_grading"), "exam", student, index, {
      submittedAt: ago(4 + (index % 3)),
      graded: index % 5 === 2,
    });
  });

  /* واختبارٌ رُصد وأُعلنت درجاته: تاريخٌ مكتمل. */
  demoSectionStudents.forEach((student, index) => {
    if (index % 9 === 8) return;
    pushSubmission(examById("demo_exam_released"), "exam", student, index, {
      submittedAt: ago(29),
      graded: true,
    });
  });

  /* ومشروعٌ أُغلقت مهلته: تسليماتٌ تنتظر التصحيح، وفيها واحدٌ أُعيد لصاحبه. */
  demoSectionStudents.forEach((student, index) => {
    if (index % 6 === 5) return;
    pushSubmission(projectById("demo_proj_grading"), "project", student, index, {
      submittedAt: ago(6 + (index % 2)),
      graded: index % 8 === 3,
      returned: index % 13 === 5,
    });
  });

  /* ومشروعٌ قديم رُصد كاملًا. */
  demoSectionStudents.forEach((student, index) => {
    pushSubmission(projectById("demo_proj_graded"), "project", student, index, {
      submittedAt: ago(31),
      graded: true,
    });
  });

  /* وطابورٌ للشعبة التي تفتح عليها لوحة الأستاذ، وإلا فتحها على جدولٍ فارغ. */
  const landingExamGrading = examById("demo_exam_a1_grading");
  const landingProjectGrading = projectById("demo_proj_a1_grading");
  landingSectionStudents.forEach((student, index) => {
    if (index % 8 === 7) return;
    pushSubmission(landingExamGrading, "exam", student, index, {
      submittedAt: ago(3 + (index % 2)),
      graded: index % 6 === 0,
    });
  });
  landingSectionStudents.forEach((student, index) => {
    if (index % 5 === 4) return;
    pushSubmission(landingProjectGrading, "project", student, index, {
      submittedAt: ago(5 + (index % 3)),
      graded: index % 7 === 0,
      returned: index % 12 === 4,
    });
  });

  /*
   * رموز الانضمام — كما يُصدرها الخادم فعلًا.
   *
   * كانت أربعة رموزٍ بصيغة `MIRAS-…` لا يعرفها التطبيق، بلا بريد مالك ولا
   * طالب: فتظهر كلها «صيغة تحتاج إعادة إصدار» و«اسم الدكتور غير محمّل»، وقمع
   * صحة الأكواد «فُعِّلت ٠ · أول دخول ٠ · أول اختبار ٠»، ولوحة أمان الأكواد
   * وسجل المحاولات فارغين. الآن: رمزٌ شخصي لكل طالب في الكشف بصيغة
   * `LAB-XXXX-XXXX-XXXX`، المفعَّل منها مربوطٌ بصاحبه وتاريخ تفعيله، وبعضها
   * تحت المراقبة لمحاولات تسريب — وهو ما تعرضه لوحة الأمان.
   *
   * مولّدٌ مستقل عن `random` أعلاه عمدًا: استدعاءٌ إضافي هناك يغيّر كل الدرجات
   * والتقدم المحسوب بعده.
   */
  const codeRandom = makeRandom(0x10ab);
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const issued = new Set<string>();
  const makeCode = () => {
    for (;;) {
      let body = "";
      for (let i = 0; i < 12; i += 1) body += CODE_ALPHABET[Math.floor(codeRandom() * CODE_ALPHABET.length)];
      const code = `LAB-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
      if (!issued.has(code)) { issued.add(code); return code; }
    }
  };
  const sectionByCode = new Map(sections.map((section) => [section.code, section]));
  const batchFor = (sectionCode: string) => `Batch-${ago(58).slice(0, 10)}-${sectionCode}-${DEMO_TEACHER_EMAIL}`;
  const journey = (label: string, at: string, extra: Record<string, unknown> = {}) => ({
    id: `cj-demo-${issued.size}-${label.length}`,
    label,
    at,
    actorEmail: DEMO_TEACHER_EMAIL,
    ...extra,
  });

  const joinCodes: JoinCode[] = [];
  const codeByStudent = new Map<string, string>();
  students.forEach((student, index) => {
    const section = sectionByCode.get(student.sectionCode)!;
    const createdAt = ago(58 - (index % 4));
    const code = makeCode();
    codeByStudent.set(student.id, code);
    const base: any = {
      code,
      semester: SEMESTER,
      sectionCode: section.code,
      courseCode: section.code,
      studentSection: section.code,
      courseName: section.courseName,
      createdAt,
      ownerEmail: DEMO_TEACHER_EMAIL,
      createdByEmail: DEMO_TEACHER_EMAIL,
      batchId: batchFor(section.code),
      batchLabel: batchFor(section.code),
      assignedStudentId: student.id,
      assignedStudentName: student.name,
      codeReputation: "normal",
      codeReputationLabel: "طبيعي",
      codeReputationScore: 0,
      printedAt: index % 3 === 0 ? ago(55) : undefined,
      codeJourney: [journey("تم إنشاء الكود", createdAt, { sectionCode: section.code, studentId: student.id })],
    };
    if (student.isActivated) {
      const activatedAt = student.signupDate || ago(40);
      Object.assign(base, {
        status: "used",
        studentId: student.id,
        studentName: student.name,
        usedByStudentId: student.id,
        activatedAt,
        activationDeviceFingerprint: student.devices[0],
        codeJourney: [...base.codeJourney, journey("تم تفعيل الكود", activatedAt, { studentId: student.id })],
      });
    } else {
      base.status = "active";
    }
    /* رموزٌ حاول غيرُ أصحابها استخدامها: هي ملفات المراجعة في لوحة الأمان. */
    if (index % 17 === 3) {
      Object.assign(base, {
        leakAttemptCount: 2 + (index % 3),
        codeReputation: index % 2 ? "suspicious" : "watch",
        codeReputationLabel: index % 2 ? "مشتبه" : "مراقبة",
        codeReputationScore: index % 2 ? 62 : 44,
        lastFailedAttemptAt: ago(index % 6),
        lastFailedAttemptReason: "الرمز مخصّص لطالبٍ آخر في الكشف",
      });
    }
    joinCodes.push(base as JoinCode);
  });
  /*
   * رموزٌ جاهزة غير مربوطة بطالبٍ ولم تُطبع بعد.
   *
   * زرّ «تصدير رموز جاهزة للطباعة» يأخذ هذه الرموز تحديدًا: الجاهزة بلا طالبٍ
   * وبلا ختم طباعة. وبدونها يقرأ الأرشيف «جاهز للتصدير: ٠» ويُرجع الزرّ رسالة
   * «لا توجد أكواد جديدة للتصدير» أمام الزائر.
   */
  [sections[0], sections[0], sections[0], sections[0], sections[1], sections[1], sections[1], sections[1]].forEach(
    (section, i) => {
      const createdAt = ago(6 - (i % 3));
      joinCodes.push({
        code: makeCode(),
        semester: SEMESTER,
        sectionCode: section.code,
        courseCode: section.code,
        studentSection: section.code,
        courseName: section.courseName,
        status: "active",
        createdAt,
        ownerEmail: DEMO_TEACHER_EMAIL,
        createdByEmail: DEMO_TEACHER_EMAIL,
        batchId: batchFor(section.code),
        batchLabel: batchFor(section.code),
        codeReputation: "normal",
        codeReputationLabel: "طبيعي",
        codeReputationScore: 0,
        codeJourney: [journey("تم إنشاء الكود", createdAt, { sectionCode: section.code })],
      } as any as JoinCode);
    },
  );
  /* ورموزٌ أُلغيت في المقرر المغلق — الأرشيف لا يعرض حالةً واحدة فقط. */
  for (let i = 0; i < 3; i += 1) {
    const section = sections[3];
    joinCodes.push({
      code: makeCode(),
      semester: SEMESTER,
      sectionCode: section.code,
      courseCode: section.code,
      studentSection: section.code,
      courseName: section.courseName,
      status: "revoked",
      createdAt: ago(50),
      updatedAt: ago(20 - i),
      ownerEmail: DEMO_TEACHER_EMAIL,
      createdByEmail: DEMO_TEACHER_EMAIL,
      batchId: batchFor(section.code),
      batchLabel: batchFor(section.code),
      codeReputation: "normal",
      codeReputationLabel: "طبيعي",
      codeReputationScore: 0,
    } as any as JoinCode);
  }

  /*
   * محاولات التفعيل المرفوضة: سجل «المحاولات» ولوحة أمان الأكواد. كلها في
   * الأيام الأخيرة حتى تقع داخل نطاق التاريخ الافتراضي للسجل (آخر ثلاثين يومًا).
   */
  const ATTEMPT_REASONS = [
    "الرمز مخصّص لطالبٍ آخر في الكشف",
    "رمز غير صحيح — لا يطابق أي رمز صادر",
    "الرقم الجامعي غير موجود في كشف هذا المقرر",
    "الرمز مستخدم سابقًا على جهازٍ آخر",
    "الرمز ملغى من الأستاذ",
  ];
  const activationAttempts: ActivationAttempt[] = Array.from({ length: 18 }, (_, index) => {
    const student = pick(students, index * 5 + 2);
    const victim = pick(students, index * 5 + 9);
    const reason = pick(ATTEMPT_REASONS, index);
    const code = reason.includes("غير صحيح")
      ? makeCode() // صيغةٌ صحيحة لم تُصدر لأحد: تخمين
      : codeByStudent.get(victim.id) || "";
    return {
      id: `demo_attempt_${index + 1}`,
      code,
      normalizedCode: code,
      studentId: student.id,
      studentName: student.name,
      sectionCode: student.sectionCode,
      teacherEmail: DEMO_TEACHER_EMAIL,
      status: index % 3 === 0 ? "warning" : "blocked",
      reason,
      deviceFingerprint: `dev_${index}_x`,
      ip: `10.0.${(index * 3) % 255}.${(index * 11) % 255}`,
      userAgent: "Mozilla/5.0 (demo)",
      timestamp: ago(index % 12),
    } as any as ActivationAttempt;
  });

  /* طلبات استرجاع كلمة المرور: «الحسابات والأجهزة» في المتابعة. */
  const passwordResetRequests: PasswordResetRequest[] = [4, 12, 23].map((studentIndex, i) => {
    const student = students[studentIndex];
    return {
      id: `demo_reset_${i + 1}`,
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      sectionCode: student.sectionCode,
      teacherEmail: DEMO_TEACHER_EMAIL,
      resetToken: `demo-reset-token-${i + 1}`,
      resetLink: "",
      verificationCode: makeCode(),
      status: i === 2 ? "handled" : "new",
      requestedAt: ago(i),
      expiresAt: ahead(1),
      handledAt: i === 2 ? ago(1) : undefined,
    };
  });

  /*
   * الطالب المعروض يُبذر بلا جهازٍ مربوط.
   *
   * كل طالبٍ في البذرة مربوطٌ بجهازٍ مصطنع (`dev_N_a`)، وقاعدة «جهاز واحد لكل
   * حساب» ترفض متصفّح الزائر بعدها: «هذا الحساب مفتوح على جهاز آخر». وتبديل
   * الدور يفكّ الربط، لكن «إعادة تعيين البيانات» وإعادة بناء الصندوق بعد
   * انتهاء مدته كانتا تُعيدان البذرة فتُقفلان الطالب خارج حسابه. وبلا جهازٍ هنا
   * يرتبط جهاز الزائر ارتباطاً أول، وهو المسار الطبيعي لأي طالبٍ جديد.
   * (محاولات التفعيل وأكواد البذرة أُخذ جهازها من الطالب قبل هذه النقطة.)
   */
  const DEMO_STUDENT_ID = "2026100007";
  for (const st of students) {
    if (st.id === DEMO_STUDENT_ID) st.devices = [];
  }

  return {
    lastUpdated: Date.now(),
    students,
    teachers,
    sections,
    chapters,
    questionBank,
    exercises,
    exerciseSubmissions,
    personalizedProjects: [],
    quizSubmissions,
    activityLogs,
    allowedStudents,
    otps: [],
    joinCodes,
    retiredJoinCodes: [],
    teacherExams,
    teacherProjects,
    teacherSubmissions,
    sebAttempts: [],
    examSessions: [],
    passwordResetRequests,
    activationAttempts,
    notificationTokens: [],
    inAppNotifications: [],
    passkeyCredentials: [],
  };
}
