export const MIRAS_LEARNING_AI_BOUNDARY =
  "AI_DRAFT_ONLY_NO_FINAL_GRADE_IDENTITY_MISCONDUCT_OR_PENALTY";

export const MIRAS_LEARNING_DECISION_BOUNDARY_AR =
  "هذه مخرجات مساعدة للتعلم والمراجعة فقط. لا تصدر درجة نهائية، ولا تثبت هوية، ولا تحكم بالغش، ولا تقترح عقوبة. القرار التعليمي الرسمي يبقى للأستاذ أو لمنطق النظام المحدد.";

const STOP_WORDS = new Set([
  "هذا",
  "هذه",
  "ذلك",
  "التي",
  "الذي",
  "على",
  "إلى",
  "الى",
  "عن",
  "من",
  "في",
  "مع",
  "كان",
  "كانت",
  "يكون",
  "فقط",
  "ثم",
  "and",
  "the",
  "for",
  "with",
  "that",
  "this",
]);

const FORBIDDEN_KEYS = new Set([
  "grade",
  "finalGrade",
  "score",
  "penalty",
  "disciplinaryAction",
  "cheatingVerdict",
  "identityVerdict",
  "isCheating",
  "isImpersonation",
]);

export type MirasLearningContext = {
  course?: any;
  assignment?: any;
  materials?: any[];
  submissions?: any[];
  exams?: any[];
  projects?: any[];
  students?: any[];
  question?: string;
  answerText?: string;
  transcript?: string;
  rubric?: any[];
};

export function normalizeLearningText(value: any, max = 3600): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function redactLearningSensitiveText(value: any, max = 3600): string {
  return normalizeLearningText(value, max)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[number]")
    .replace(/\b\d{7,12}\b/g, "[student-id]");
}

export function stripUnsafeLearningDecisionFields<T = any>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsafeLearningDecisionFields(item)) as T;
  }
  const clean: any = {};
  Object.entries(value as any).forEach(([key, entry]) => {
    if (FORBIDDEN_KEYS.has(key)) return;
    clean[key] = stripUnsafeLearningDecisionFields(entry);
  });
  return clean;
}

export function extractLearningConcepts(values: any[], limit = 10): string[] {
  const counts = new Map<string, number>();
  values
    .map((value) => redactLearningSensitiveText(value, 1200).toLowerCase())
    .join(" ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

export function detectLearningMisconceptions(context: MirasLearningContext) {
  const answer = redactLearningSensitiveText(context.answerText || context.question || "", 2200);
  const sourceConcepts = extractLearningConcepts(
    [
      context.course?.courseName,
      context.course?.title,
      context.assignment?.title,
      context.assignment?.description,
      context.assignment?.promptText,
      ...(context.materials || []).map((item) => item?.text || item?.title || item),
      ...(context.rubric || []).map((item) => item?.criterion || item?.description || item),
    ],
    12,
  );
  const loweredAnswer = answer.toLowerCase();
  const missingConcepts = sourceConcepts.filter(
    (concept) => !loweredAnswer.includes(String(concept).toLowerCase()),
  );
  const flags: any[] = [];
  if (answer.length < 90) {
    flags.push({
      type: "thin-evidence",
      label: "الدليل محدود",
      hint: "الإجابة قصيرة؛ اطلب مثالاً أو تطبيقاً صغيراً قبل الحكم على الفهم.",
    });
  }
  if (/حفظ|نسخ|تعريف فقط|بدون تطبيق/.test(answer)) {
    flags.push({
      type: "procedural-only",
      label: "ميل للحفظ دون تطبيق",
      hint: "حوّل المفهوم إلى خطوة عملية أو موقف صفي.",
    });
  }
  if (/كل|دائما|دائمًا|مستحيل|أكيد|100%|نهائ/.test(answer)) {
    flags.push({
      type: "overgeneralization",
      label: "تعميم زائد",
      hint: "اطلب شرطاً أو حالة استثناء حتى يصبح الاستدلال أدق.",
    });
  }
  if (missingConcepts.length) {
    flags.push({
      type: "missing-course-concepts",
      label: "مفاهيم محورية غائبة",
      concepts: missingConcepts.slice(0, 5),
      hint: "اربط التغذية الراجعة بهذه المفاهيم دون تحويلها إلى خصم آلي.",
    });
  }
  return {
    flags,
    missingConcepts: missingConcepts.slice(0, 8),
    confidence: flags.length >= 2 ? "medium" : flags.length ? "low" : "none",
    requiresHumanReview: true,
    decisionBoundary: MIRAS_LEARNING_DECISION_BOUNDARY_AR,
  };
}

export function buildRubricFeedbackDraft(context: MirasLearningContext) {
  const answer = redactLearningSensitiveText(context.answerText || "", 2800);
  const rubric = Array.isArray(context.rubric) && context.rubric.length
    ? context.rubric
    : [
        { criterion: "الفهم المفاهيمي", weight: 30 },
        { criterion: "التطبيق العملي", weight: 30 },
        { criterion: "الاستدلال والتوثيق", weight: 25 },
        { criterion: "وضوح العرض", weight: 15 },
      ];
  const concepts = extractLearningConcepts([answer], 8);
  const misconceptionScan = detectLearningMisconceptions(context);
  const criteria = rubric.slice(0, 8).map((item: any) => {
    const criterion = normalizeLearningText(item?.criterion || item?.title || "معيار", 120);
    return {
      criterion,
      weight: Number(item?.weight || item?.points || 0) || undefined,
      feedback:
        answer.length < 90
          ? "اطلب من الطالب توسيع الدليل قبل اعتماد مستوى الأداء."
          : `مسودة مراجعة: اربط ${criterion} بدليل محدد من العمل، ثم اطلب تحسيناً واحداً قابلاً للتنفيذ.`,
      evidenceHints: concepts.slice(0, 4),
      suggestedNextStep: "أعد الصياغة كتغذية راجعة وصفية ولا تعتمدها كدرجة إلا بعد مراجعة الأستاذ.",
    };
  });
  return stripUnsafeLearningDecisionFields({
    success: true,
    mode: "rubric_feedback_draft",
    criteria,
    misconceptionScan,
    praise: concepts.length
      ? `يوجد أساس يمكن البناء عليه في: ${concepts.slice(0, 3).join("، ")}.`
      : "ابدأ بتحديد مثال واحد واضح من عمل الطالب.",
    nextRevisionPrompt:
      "حسّن العمل بإضافة مثال تطبيقي، تبرير تربوي، ودليل من المقرر لكل ادعاء رئيسي.",
    requiresHumanReview: true,
    decisionBoundary: MIRAS_LEARNING_DECISION_BOUNDARY_AR,
    safety: MIRAS_LEARNING_AI_BOUNDARY,
  });
}

export function buildAdaptiveTutorDraft(context: MirasLearningContext) {
  const question = redactLearningSensitiveText(context.question || "", 1200);
  const courseName = normalizeLearningText(
    context.course?.courseName || context.course?.title || "المقرر",
    160,
  );
  const concepts = extractLearningConcepts(
    [
      courseName,
      question,
      context.assignment?.title,
      context.assignment?.promptText,
      ...(context.submissions || []).map((item) => item?.answerText || item?.activityTitle),
    ],
    8,
  );
  const misconceptionScan = detectLearningMisconceptions({
    ...context,
    answerText: context.answerText || question,
  });
  return stripUnsafeLearningDecisionFields({
    success: true,
    mode: "adaptive_tutor",
    courseName,
    reply: question
      ? `لنحلها خطوة خطوة في ${courseName}: ابدأ بتحديد الفكرة الأساسية، ثم اربطها بمثال من القاعة، ثم اكتب سبب اختيارك.`
      : `اختر سؤالاً أو جزءاً من الواجب في ${courseName} وسأحوّله إلى خطوات صغيرة للمذاكرة.`,
    microPlan: [
      "اكتب ما تعرفه في ثلاث جمل قصيرة.",
      "ضع مثالاً واحداً من مشروعك أو اختبارك.",
      "قارن إجابتك بمفهومين من المقرر.",
      "اختم بسؤال واحد تريد التأكد منه.",
    ],
    practicePrompt: concepts.length
      ? `اشرح العلاقة بين ${concepts.slice(0, 2).join(" و ")} في مثال تعليمي واقعي.`
      : "اشرح المفهوم بكلماتك ثم أعطني مثالاً من الصف.",
    misconceptionScan,
    requiresHumanReview: false,
    decisionBoundary: MIRAS_LEARNING_DECISION_BOUNDARY_AR,
    safety: MIRAS_LEARNING_AI_BOUNDARY,
  });
}

export function buildCourseUnderstandingDraft(context: MirasLearningContext) {
  const title = normalizeLearningText(
    context.assignment?.title || context.course?.courseName || context.course?.title || "مهمة تعليمية",
    180,
  );
  const concepts = extractLearningConcepts(
    [
      title,
      context.assignment?.description,
      context.assignment?.promptText,
      ...(context.materials || []).map((item) => item?.text || item?.name || item?.title || item),
    ],
    12,
  );
  return stripUnsafeLearningDecisionFields({
    success: true,
    mode: "multimodal_course_assignment_understanding",
    title,
    learningGoals: concepts.slice(0, 5).map((concept) => `فهم وتطبيق: ${concept}`),
    expectedEvidence: [
      "شرح الفكرة بصوت الطالب/أسلوبه.",
      "مثال تطبيقي من سياق تعليمي واضح.",
      "تبرير اختيار الأداة أو الاستراتيجية.",
      "تأمل قصير يذكر حدود الحل.",
    ],
    studentFriendlyBrief:
      "المطلوب ليس نصاً طويلاً فقط؛ المطلوب أن تظهر فهمك من خلال مثال، قرار تصميم، وتبرير.",
    teacherChecklist: [
      "هل يوجد دليل من المقرر؟",
      "هل المثال قابل للتطبيق؟",
      "هل يميز الطالب بين الوصف والتبرير؟",
      "هل يحتاج الطالب Viva قصيرة قبل اعتماد التغذية الراجعة؟",
    ],
    requiresHumanReview: true,
    decisionBoundary: MIRAS_LEARNING_DECISION_BOUNDARY_AR,
    safety: MIRAS_LEARNING_AI_BOUNDARY,
  });
}

export function buildVivaDraft(context: MirasLearningContext) {
  const transcript = redactLearningSensitiveText(context.transcript || "", 2400);
  const concepts = extractLearningConcepts(
    [context.assignment?.title, context.assignment?.promptText, transcript, context.answerText],
    8,
  );
  const misconceptionScan = detectLearningMisconceptions({
    ...context,
    answerText: transcript || context.answerText,
  });
  return stripUnsafeLearningDecisionFields({
    success: true,
    mode: "voice_viva_learning_check",
    questions: [
      "اشرح الفكرة الأساسية في دقيقة واحدة.",
      "اذكر مثالاً طبقته أو تستطيع تطبيقه في الصف.",
      "ما القرار الذي غيرته بعد المراجعة؟ ولماذا؟",
      concepts[0] ? `كيف يرتبط مفهوم ${concepts[0]} بعملك؟` : "ما أكثر نقطة تحتاج تأكد؟",
    ],
    transcriptReview: transcript
      ? "تم تحليل النص المنطوق كدليل فهم أولي، وليس كتحقق هوية أو درجة."
      : "يمكن تسجيل الصوت في المتصفح وتحويله إلى نص قبل إرساله كمسودة Viva.",
    misconceptionScan,
    followUp:
      misconceptionScan.flags.length > 0
        ? "اسأل سؤال متابعة واحداً عن الدليل أو الاستثناء قبل اعتماد المراجعة."
        : "اطلب مثالاً جديداً للتأكد من ثبات الفهم.",
    requiresHumanReview: true,
    decisionBoundary: MIRAS_LEARNING_DECISION_BOUNDARY_AR,
    safety: MIRAS_LEARNING_AI_BOUNDARY,
  });
}

export function buildTeacherLearningSummary(context: MirasLearningContext) {
  const students = Array.isArray(context.students) ? context.students : [];
  const submissions = Array.isArray(context.submissions) ? context.submissions : [];
  const exams = Array.isArray(context.exams) ? context.exams : [];
  const projects = Array.isArray(context.projects) ? context.projects : [];
  const submitted = submissions.filter((item) => String(item?.submittedAt || "").trim());
  const needsReview = submissions.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    return !String(item?.grade ?? item?.visibleGrade ?? "").trim() || /returned|معاد|جاهز|review|قيد/.test(status);
  });
  const commonConcepts = extractLearningConcepts(
    submissions.map((item) => `${item?.activityTitle || ""} ${item?.answerText || ""}`),
    8,
  );
  return stripUnsafeLearningDecisionFields({
    success: true,
    mode: "teacher_learning_summary",
    snapshot: {
      students: students.length,
      submissions: submissions.length,
      submitted: submitted.length,
      exams: exams.length,
      projects: projects.length,
      needsReview: needsReview.length,
    },
    usefulSignals: [
      needsReview.length
        ? `${needsReview.length} تسليم يحتاج مراجعة وصفية أو قرار أستاذ.`
        : "لا توجد كتلة مراجعة كبيرة ظاهرة الآن.",
      commonConcepts.length
        ? `أكثر مفاهيم ظاهرة في التسليمات: ${commonConcepts.slice(0, 5).join("، ")}.`
        : "لا توجد نصوص تسليم كافية لاستخراج مفاهيم مشتركة.",
    ],
    suggestedTeacherActions: [
      "ابدأ بثلاثة أعمال تحتاج تغذية راجعة وصفية لا درجة آلية.",
      "استخدم Viva قصيرة للحالات التي يظهر فيها فهم غير مكتمل.",
      "انشر الدرجات فقط من مسار الرصد/النشر المحدد بعد مراجعة بشرية.",
    ],
    reviewQueue: needsReview.slice(0, 8).map((item) => ({
      id: item?.id,
      kind: item?.kind,
      studentId: item?.studentId,
      studentName: item?.studentName,
      activityTitle: item?.activityTitle,
      courseCode: item?.courseCode || item?.sectionCode,
      reason: "يحتاج مراجعة أو تغذية راجعة وصفية.",
    })),
    requiresHumanReview: true,
    decisionBoundary: MIRAS_LEARNING_DECISION_BOUNDARY_AR,
    safety: MIRAS_LEARNING_AI_BOUNDARY,
  });
}
