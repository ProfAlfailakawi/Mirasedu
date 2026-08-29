import { api, makeJar, createReporter, AA, BB, S_A1, S_B1 } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / LEARNING INTELLIGENCE");

const teacherJar = makeJar();
const teacherBJar = makeJar();
const studentJar = makeJar();

const forbiddenKeys = new Set([
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

function containsForbiddenDecisionField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenDecisionField);
  return Object.entries(value).some(([key, entry]) =>
    forbiddenKeys.has(key) || containsForbiddenDecisionField(entry),
  );
}

let r = await api(
  "POST",
  "/api/auth/login",
  { idNumber: AA, password: "***REDACTED***" },
  { jar: teacherJar, deviceToken: "li-teacher-a" },
);
check("teacher A login", r.ok && r.data.role === "teacher", `${r.status}`);

r = await api(
  "POST",
  "/api/auth/login",
  { idNumber: BB, password: "***REDACTED***" },
  { jar: teacherBJar, deviceToken: "li-teacher-b" },
);
check("teacher B login", r.ok && r.data.role === "teacher", `${r.status}`);

r = await api(
  "POST",
  "/api/auth/login",
  { idNumber: "1001", password: "pass1001" },
  { jar: studentJar, deviceToken: "tok-1001" },
);
check("student login", r.ok && r.data.role === "student", `${r.status}`);

r = await api("POST", "/api/learning-intelligence/student/tutor", {
  courseCode: S_A1,
  question: "كيف أشرح الدمج التقني في موقف صفي؟",
});
check("student tutor requires a student session", r.status === 401, `${r.status} ${JSON.stringify(r.data)}`);

r = await api(
  "POST",
  "/api/learning-intelligence/student/tutor",
  {
    studentId: "2002",
    courseCode: S_A1,
    question: "اشرح لي الواجب.",
  },
  { jar: studentJar, deviceToken: "tok-1001" },
);
check("student tutor cannot run for another student", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);

r = await api(
  "POST",
  "/api/learning-intelligence/student/tutor",
  {
    courseCode: S_A1,
    question: "أفهم التعريف لكن لا أعرف كيف أطبقه في مشروع تعليمي.",
  },
  { jar: studentJar, deviceToken: "tok-1001" },
);
check("student tutor returns adaptive help", r.ok && r.data.mode === "adaptive_tutor" && Array.isArray(r.data.microPlan), `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);
check("student tutor has no final decision fields", !containsForbiddenDecisionField(r.data), JSON.stringify(r.data).slice(0, 220));

r = await api(
  "POST",
  "/api/learning-intelligence/teacher-summary",
  { courseCode: S_A1 },
  { jar: teacherJar, deviceToken: "li-teacher-a" },
);
check("teacher summary returns scoped learning signals", r.ok && r.data.mode === "teacher_learning_summary" && r.data.snapshot, `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);
check("teacher summary has no AI decision fields", !containsForbiddenDecisionField(r.data), JSON.stringify(r.data).slice(0, 220));

r = await api(
  "POST",
  "/api/learning-intelligence/teacher-summary",
  { courseCode: S_A1 },
  { jar: teacherBJar, deviceToken: "li-teacher-b" },
);
check("teacher B cannot summarize teacher A course", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);

await api(
  "POST",
  "/api/teacher/submissions",
  {
    id: "li-sub-1",
    kind: "project",
    activityId: "li-project-1",
    activityTitle: "مشروع دمج التقنية",
    studentId: "1001",
    studentName: "طالب أول",
    courseCode: S_A1,
    answerText: "تعريف فقط بدون تطبيق واضح أو مثال صفي.",
    status: "جاهز للمراجعة",
  },
  { jar: teacherJar, deviceToken: "li-teacher-a" },
);

r = await api(
  "POST",
  "/api/learning-intelligence/rubric-feedback",
  {
    courseCode: S_A1,
    submissionId: "li-sub-1",
    rubric: [{ criterion: "التطبيق العملي", weight: 40 }],
  },
  { jar: teacherJar, deviceToken: "li-teacher-a" },
);
check("rubric feedback is generated as review draft", r.ok && r.data.mode === "rubric_feedback_draft" && Array.isArray(r.data.criteria), `${r.status} ${JSON.stringify(r.data).slice(0, 240)}`);
check("rubric feedback has no grade fields", !containsForbiddenDecisionField(r.data), JSON.stringify(r.data).slice(0, 240));

r = await api(
  "POST",
  "/api/learning-intelligence/course-understanding",
  {
    courseCode: S_A1,
    assignment: { title: "تحليل درس رقمي", promptText: "صمم مثالاً وتبريراً تربوياً." },
    materials: [{ text: "تعلم إلكتروني، تقييم تكويني، تفاعل، تغذية راجعة." }],
  },
  { jar: teacherJar, deviceToken: "li-teacher-a" },
);
check("course/assignment understanding returns checklist", r.ok && r.data.mode.includes("understanding") && Array.isArray(r.data.teacherChecklist), `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);

r = await api(
  "POST",
  "/api/learning-intelligence/viva",
  {
    courseCode: S_A1,
    transcript: "استخدمت مثالاً صفياً لكنني عممت أن كل الأدوات مناسبة دائماً.",
  },
  { jar: studentJar, deviceToken: "tok-1001" },
);
check("viva returns oral follow-up prompts", r.ok && r.data.mode === "voice_viva_learning_check" && Array.isArray(r.data.questions), `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);
check("viva has no identity or cheating verdict", !containsForbiddenDecisionField(r.data), JSON.stringify(r.data).slice(0, 220));

r = await api(
  "POST",
  "/api/learning-intelligence/teacher-summary",
  { courseCode: S_B1 },
  { jar: teacherBJar, deviceToken: "li-teacher-b" },
);
check("own teacher course remains available", r.ok && r.data.mode === "teacher_learning_summary", `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

done();
