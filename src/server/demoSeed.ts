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
  ActivityLog,
  AllowedStudent,
  DatabaseState,
  ExerciseSubmission,
  JoinCode,
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
  ["ordering", "رتّب مراحل نموذج ADDIE ترتيباً صحيحاً.", ["التحليل", "التصميم", "التطوير", "التنفيذ", "التقويم"], ["التحليل", "التصميم", "التطوير", "التنفيذ", "التقويم"] as unknown as string, "intermediate"],
  ["multiple-choice", "أهم معيار عند اختيار أداة رقمية لنشاط صفي هو:", ["شهرة الأداة", "ملاءمتها للهدف التعليمي", "كلفتها فقط", "حداثة واجهتها"], "ملاءمتها للهدف التعليمي", "beginner"],
  ["short-answer", "ما الفرق بين الوسيلة التعليمية ومنظومة تقنيات التعليم؟", [], "الوسيلة أداة مفردة، والمنظومة تشمل العمليات والموارد والتصميم والتقويم", "intermediate"],
  ["multiple-choice", "الإفصاح عن استخدام الذكاء الاصطناعي في التسليم يُعد:", ["اختيارياً دائماً", "مطلباً للنزاهة الأكاديمية", "دليل ضعف الطالب", "إجراءً إدارياً فقط"], "مطلباً للنزاهة الأكاديمية", "advanced"],
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
  }));

  const teachers: Teacher[] = [
    ...liveTeachers,
    {
      id: "demo_teacher_1",
      name: "د. سارة الخالد (بيئة تجريبية)",
      email: "demo.teacher@miras.test",
      // No usable credential: a demo instructor is reached by entering the
      // demo, never by signing in, so there is nothing here to guess.
      passwordHash: "",
      role: "teacher",
      isActive: true,
    },
  ];

  const chapters: TextbookChapter[] = CHAPTERS.map(([title, subtitle, topics], index) => ({
    id: `demo_ch_${index + 1}`,
    title,
    subtitle,
    topics: topics.map(([topicTitle, pages, concepts], t) => ({
      id: `demo_ch_${index + 1}_t${t + 1}`,
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
    QUESTION_TEMPLATES.forEach(([type, questionText, options, correctAnswer, difficulty], q) => {
      const index = chapterIndex * QUESTION_TEMPLATES.length + q;
      questionBank.push({
        id: `demo_q_${index + 1}`,
        chapterId: chapter.id,
        topicId: chapter.topics[q % chapter.topics.length].id,
        type,
        questionText,
        options: options.length ? [...options] : undefined,
        correctAnswer: correctAnswer as Question["correctAnswer"],
        points: difficulty === "advanced" ? 5 : difficulty === "intermediate" ? 3 : 2,
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
        dueDate: index % 2 === 0 ? ago(14 - index) : ahead(3 + index),
        isPersonalized: index % 4 === 0,
      });
    });
  });

  const students: Student[] = [];
  const allowedStudents: AllowedStudent[] = [];
  const count = 100;
  for (let index = 0; index < count; index += 1) {
    const name = `${pick(FIRST, index)} ${pick(FAMILY, index * 3)}`;
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
      score: Math.floor(progress * (0.6 + random() * 0.5)),
      strengths: [pick(["التحليل", "التصميم التعليمي", "العرض والتقديم", "العمل الجماعي"], index)],
      weaknesses: [pick(["التوثيق", "إدارة الوقت", "الربط بالنظرية", "الدقة في المصطلحات"], index + 1)],
      recommendations: ["راجع الفصل الثاني", "أكمل النشاط الأسبوعي المتأخر"],
      signupDate: ago(120 - (index % 100)),
      lastLoginDate: ago(index % 14),
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

  const joinCodes: JoinCode[] = sections.map((section, index) => ({
    code: `MIRAS-${section.code}-${String(1000 + index * 37)}`,
    courseCode: section.code,
    sectionCode: section.code,
    courseName: section.courseName,
    teacherEmail: "demo.teacher@miras.test",
    status: index === 3 ? "revoked" : "active",
    createdAt: ago(60 - index * 5),
    expiresAt: ahead(30),
    maxUses: 60,
    usedCount: 12 + index * 6,
  }) as unknown as JoinCode);

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
    teacherExams: [],
    teacherProjects: [],
    teacherSubmissions: [],
    sebAttempts: [],
    examSessions: [],
    passwordResetRequests: [],
    activationAttempts: [],
    notificationTokens: [],
    inAppNotifications: [],
    passkeyCredentials: [],
  };
}
