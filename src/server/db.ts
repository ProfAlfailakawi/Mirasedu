import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
dotenv.config();
import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { CodeLedgerEvent, SignedJoinCodeFields } from "../shared/types";

// Initialize Firebase server-side if exists
let dbFS: any = null;
// حاوية Cloud Storage للملفات الكبيرة (مرفقات التسليم + PDF المحوّل): كتابة واحدة
// متدفقة للملف الخام بدل تقطيع base64 على وثائق Firestore — ملف ٢٤م.ب كان يفشل
// بمهلة (archive-attempt-timeout) عبر Firestore، وعبر Storage يكتمل في ثوانٍ.
let dbBucket: any = null;
export let firestoreQuotaExceeded = false;
export let firestoreQuotaErrorDetail = "";
let firestoreQuotaExceededAt = 0;

export function forceClearQuotaExceeded() {
  firestoreQuotaExceeded = false;
  firestoreQuotaExceededAt = 0;
  firestoreQuotaErrorDetail = "";
  console.log("✅ Firestore quota exceeded flag forcefully cleared by admin/system.");
}

// كانت firestoreQuotaExceeded تبقى true إلى الأبد بعد أول تجاوز للحصة المجانية
// (حتى بعد تجدد الحصة يومياً من جهة Google)، فتعطّل دوام السحابة طوال عمر
// العملية. هذا العداد يعيد فتح المحاولة تلقائياً بعد فترة بدل انتظار إعادة نشر
// الخادم يدوياً.
const FIRESTORE_QUOTA_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
function reopenFirestoreSyncIfQuotaCooldownPassed() {
  if (
    firestoreQuotaExceeded &&
    Date.now() - firestoreQuotaExceededAt > FIRESTORE_QUOTA_RETRY_COOLDOWN_MS
  ) {
    firestoreQuotaExceeded = false;
    firestoreQuotaErrorDetail = "";
  }
}

// أقصر من مهلة الحصة (٦٠ ثانية لا ٥ دقائق): قفل قاعدة البيانات هذا غالبًا سببه
// عطل عابر عند الإقلاع البارد لا تجاوز حصة فعلي، فالتعافي السريع مهم هنا، مع
// إبقائها بعيدة عن الصفر حتى لا تتكرر قراءة Firestore على كل طلب أثناء عطل حقيقي.
const DATABASE_GUARD_RETRY_COOLDOWN_MS = 60 * 1000;

try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const appName = "miras-server";
    const app =
      getApps().find((candidate) => candidate.name === appName) ||
      initializeApp(
        {
          credential: applicationDefault(),
          projectId: config.projectId,
        },
        appName,
      );
    dbFS = getFirestore(app, config.firestoreDatabaseId);
    console.log(
      "🔥 Firebase Admin Firestore initialized successfully on backend server with database:",
      config.firestoreDatabaseId,
    );
    try {
      // حاوية مخصّصة أنشأناها في نفس منطقة Cloud Run (us-central1) — حاوية
      // Firebase الافتراضية (storageBucket في الإعداد) غير موجودة فعلياً في هذا
      // المشروع (404)، لذلك لا نعتمد عليها. قابلة للتجاوز عبر متغير البيئة.
      const bucketName = String(
        process.env.MIRAS_ATTACHMENTS_BUCKET || "miras-files-meras-320eb",
      );
      dbBucket = getStorage(app).bucket(bucketName);
      console.log("🪣 Cloud Storage bucket ready:", bucketName);
    } catch (bucketErr) {
      dbBucket = null;
      console.warn("⚠️ Cloud Storage bucket unavailable:", bucketErr);
    }
  }
} catch (e) {
  console.error("⚠️ Failed to initialize Firebase on backend server:", e);
}

// Ensure data directory exists
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, "db.json");
// تخزين قاعدة مِراس كسجل واحد داخل Firestore يصل بسرعة إلى حد 1MiB لوثيقة
// Firestore الواحدة، وهذا يسبب فشل الحفظ حتى بعد تفعيل الفوترة. لذلك نحفظ
// القاعدة كميتا صغيرة + أجزاء JSON آمنة الحجم تحت نفس المسار.
// (هذا التنسيق القديم يبقى في الكود للقراءة فقط — التوافق مع بيانات قديمة لم
// تُهاجَر بعد. الكتابة الجديدة تستخدم MIRAS_CLOUD_ENTITY_STORAGE_FORMAT دائماً.)
const MIRAS_CLOUD_STORAGE_FORMAT = "chunked-json-v2";
const MIRAS_CLOUD_CHUNK_SIZE = 620_000;
// تخزين كل مفتاح كوثيقة Firestore منفصلة بدل كتلة JSON واحدة تضم قاعدة
// البيانات كاملة. كل حفظة كانت تعيد كتابة كل شيء (الطلاب، السجلات، الرموز...)
// حتى لو تغيّر تسليم واحد فقط — هذا يستهلك حصة Firestore المجانية بسرعة
// ويبطئ الحفظ مع نمو البيانات. الآن: كل مفتاح (students, activityLogs,
// teacherSubmissions...) وثيقة/وثائق منفصلة، ولا تُكتب إلا إذا تغيّر محتواها
// فعلاً منذ آخر مزامنة ناجحة. القراءة والدمج الثلاثي (mergeCloudThreeWay)
// والحارس (databaseGuardLocked) لم يتغيّروا إطلاقاً — يعملون على DatabaseState
// الكاملة المُعاد بناؤها من هذه الوثائق تمامًا كما كانوا يعملون على الكتلة
// الواحدة القديمة، فلا حاجة لتعديل أي استدعاء آخر في هذا الملف أو في server.ts.
const MIRAS_CLOUD_ENTITY_STORAGE_FORMAT = "entity-json-v3";
const MIRAS_CLOUD_ENTITY_KEYS: (keyof DatabaseState)[] = [
  "students",
  "teachers",
  "sections",
  "chapters",
  "questionBank",
  "exercises",
  "exerciseSubmissions",
  "personalizedProjects",
  "quizSubmissions",
  "activityLogs",
  "allowedStudents",
  "otps",
  "joinCodes",
  "retiredJoinCodes",
  "teacherExams",
  "teacherProjects",
  "teacherSubmissions",
  "sebAttempts",
  "examSessions",
  "passwordResetRequests",
  "activationAttempts",
  "notificationTokens",
  "inAppNotifications",
  "passkeyCredentials",
  "bookMetadata",
  "notificationSeenKeys",
  "notificationDispatches",
  "notificationAudit",
  "errorReports",
];

// ⚡ مفاتيح "وثيقة لكل كيان" (perDoc): المصفوفات الساخنة التي كان كل تعديل صغير
// فيها يعيد كتابة المصفوفة كاملة للسحابة. سجلّ نشاط واحد جديد كان يكتب ~مئات
// الكيلوبايت (كل السجلات المجزّأة) — الآن يكتب وثيقة واحدة صغيرة فقط.
// ملاحظة توافق للرجوع للخلف: عند أول تحويل يُحتفَظ بآخر نسخة مجزّأة كما هي
// (لقطة تجميد)، فإن أُرجِع الخادم لنسخة قديمة قرأها بلا أخطاء.
const MIRAS_PERDOC_KEYS = new Set<string>([
  "activityLogs", // كل سجل نشاط = وثيقة (كان كل سجل جديد يعيد كتابة الكل)
  "examSessions", // نبضة كل ٣ث لكل طالب أثناء الاختبار = أسخن مفتاح في النظام
  "inAppNotifications", // تنبيهات الجرس تُضاف باستمرار
  "notificationAudit", // سجل تدقيق الإرسال: كل حدث وثيقة مستقلة خفيفة
  "errorReports", // رادار مِراس: تقارير الأخطاء المجمّعة
]);

const MIRAS_ALLOW_EMPTY_FIRESTORE_INIT =
  String(process.env.MIRAS_ALLOW_EMPTY_FIRESTORE_INIT || "").toLowerCase() === "true";
const MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD =
  String(process.env.MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD || "").toLowerCase() === "true";
// مِراس يعمل بالسحابة كمصدر حقيقة. لا نسمح للبرنامج أن يشتغل من كاش محلي فقط
// عند تعذّر Firestore، لأن هذا بالضبط يجعل الواجهة تظهر كأن البيانات انمسحت
// أو يسمح لنسخة قديمة بالكتابة فوق السحابة عند عودتها. يفعّل فقط في تطوير محلي صريح.
const MIRAS_ALLOW_LOCAL_ONLY_MODE =
  String(process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE || "").toLowerCase() === "true";
const MIRAS_DATABASE_GUARD_CODE = "MIRAS_DATABASE_GUARD_LOCKED";
const MIRAS_DATABASE_GUARD_USER_MESSAGE =
  "النظام في وضع صيانة للبيانات الآن لحماية بيانات مِراس. لن تُعرض بيانات فارغة ولن تُحفظ تغييرات جديدة حتى تكتمل المزامنة.";
const MIRAS_DATABASE_CONTENT_KEYS = [
  "students",
  "sections",
  "chapters",
  "questionBank",
  "exercises",
  "exerciseSubmissions",
  "personalizedProjects",
  "quizSubmissions",
  "activityLogs",
  "allowedStudents",
  "joinCodes",
  "retiredJoinCodes",
  "teacherExams",
  "teacherProjects",
  "teacherSubmissions",
  "sebAttempts",
  "examSessions",
  "passwordResetRequests",
  "activationAttempts",
  "notificationTokens",
  "inAppNotifications",
  "passkeyCredentials",
];

function databaseHasMeaningfulContent(state: any): boolean {
  if (!state || typeof state !== "object") return false;
  return MIRAS_DATABASE_CONTENT_KEYS.some((key) => {
    const value = state[key];
    return Array.isArray(value) && value.length > 0;
  });
}

function readExistingDbFileHasMeaningfulContent(): boolean {
  try {
    if (!fs.existsSync(DB_FILE)) return false;
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    if (!raw.trim()) return false;
    return databaseHasMeaningfulContent(JSON.parse(raw));
  } catch {
    return false;
  }
}

// Helper to remove any undefined fields before saving to Firestore (as it throws on undefined values)
function cleanUndefined(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        cleaned[key] = cleanUndefined(val);
      }
    }
    return cleaned;
  }
  return obj;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (!errInfo.error.includes("RESOURCE_EXHAUSTED") && !errInfo.error.includes("Quota limit exceeded")) {
    throw new Error(JSON.stringify(errInfo));
  } else {
    firestoreQuotaExceeded = true;
    firestoreQuotaErrorDetail = errInfo.error;
    console.warn("⚠️ Firestore quota exceeded, skipped throwing error.");
  }
}

// Structure interfaces
export interface Student {
  id: string; // University ID (numeric string)
  name: string;
  email: string;
  sectionCode: string;
  semester: string;
  passwordHash: string;
  isPaid: boolean;
  isActivated: boolean;
  activationCode?: string;
  devices: string[]; // List of registered device fingerprints (max 2)
  pathwayCode?: string; // e.g. AI-EDU-KW-B2
  learningStyle?: {
    techLevel: string;
    projectType: string;
    prefField: string;
    fears: string;
    workStyle: string;
    targetGrade: string;
    goal: string;
  };
  progress: number; // 0 - 100
  score: number; // points
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  webcamSnapshot?: string; // base64 webcam shot
  signupDate: string;
  lastLoginDate: string;
  activatedCourseCodes?: string[];
  enrollments?: {
    courseCode: string;
    sectionCode?: string;
    courseName?: string;
    teacherEmail?: string;
    isActive: boolean;
    status?: string;
    isOpen?: boolean;
    isSuspended?: boolean;
  }[];
  suspendedEnrollments?: {
    studentId: string;
    courseCode: string;
    sectionCode?: string;
    teacherEmail?: string;
    isSuspended?: boolean;
    suspendedAt?: string;
    suspendedBy?: string;
    suspensionReason?: string;
    reactivatedAt?: string;
    reactivatedBy?: string;
  }[];
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: "teacher";
  isActive: boolean;
}

export interface Section {
  code: string; // TECH-A1, TECH-B2, EDU-2026
  courseName: string;
  semester: string;
  isOpen: boolean;
  ownerEmail?: string; // instructor isolation: each teacher sees only his courses unless admin
}

export interface TextbookChapter {
  id: string;
  title: string;
  subtitle?: string;
  topics: {
    id: string;
    title: string;
    pages: string;
    concepts: string[];
  }[];
  teacherEmail?: string;
}

export interface Question {
  id: string;
  chapterId: string;
  topicId?: string;
  type: "multiple-choice" | "true-false" | "matching" | "ordering" | "short-answer" | "scenario-analysis";
  questionText: string;
  options?: string[]; // for MCQs
  correctAnswer: string | string[] | { [key: string]: string }; // string for MCQ/TF/short, array for ordering, map for matching
  points: number;
  difficulty: "beginner" | "intermediate" | "advanced";
  pathwayCode?: string; // Optional target pathway code
  isApproved: boolean; // Approved by teacher
  isGenerated: boolean; // Generated by Gemini
  teacherEmail?: string;
}

export interface WeeklyExercise {
  id: string;
  chapterId: string;
  title: string;
  type: "scenario" | "tool-selection" | "activity-design" | "critique" | "connection";
  promptText: string;
  dueDate: string;
  isPersonalized: boolean;
}

export interface ExerciseSubmission {
  id: string;
  studentId: string;
  studentName: string;
  studentIdNumber: string;
  sectionCode: string;
  exerciseId: string;
  exerciseTitle: string;
  studentAnswer: string;
  score?: number;
  feedback?: string;
  submittedAt: string;
  watermark: string;
  status?: "submitted" | "returned" | "graded";
  returnedAt?: string;
  returnedByEmail?: string;
  returnNote?: string;
  resubmittedAt?: string;
  submittedLate?: boolean;
}

export interface PersonalizedProject {
  id: string; // unique project reference
  studentId: string;
  studentName: string;
  studentIdNumber: string;
  sectionCode: string;
  pathwayCode: string;
  title: string;
  description: string;
  targetLearner: string;
  technology: string;
  educationalProblem: string;
  productType: string;
  requirements: string[];
  steps: string[];
  rubric: { criterion: string; weight: number; levels: string[] }[];
  dueDate: string;
  closeDate?: string;
  isGenerated: boolean;
  status: "none" | "generated" | "submitted" | "returned" | "graded";
  submissionText?: string;
  submissionFile?: string; // base64 payload
  submissionFileName?: string;
  grade?: number;
  gradeFeedback?: string;
  submittedAt?: string;
  gradedAt?: string;
  returnedAt?: string;
  returnedByEmail?: string;
  returnNote?: string;
  returnExceptionUntil?: string;
  returnExceptionHours?: number | string;
  returnExceptionGrantedAt?: string;
  returnExceptionByEmail?: string;
  resubmittedAt?: string;
  submittedLate?: boolean;
  watermark: string;
}

export interface QuizSubmission {
  id: string;
  studentId: string;
  studentName: string;
  studentIdNumber: string;
  sectionCode: string;
  chapterId: string;
  matchedQuestions: {
    questionId: string;
    questionText: string;
    studentAnswer: any;
    correctAnswer: any;
    isCorrect: boolean;
    pointsEarned: number;
  }[];
  score: number;
  totalPoints: number;
  durationMinutes: number;
  deviceFingerprint: string;
  deviceOS: string;
  deviceBrowser: string;
  ipAddress: string;
  submittedAt: string;
  status?: "submitted" | "returned" | "graded";
  returnedAt?: string;
  returnedByEmail?: string;
  returnNote?: string;
  resubmittedAt?: string;
}

export interface ActivityLog {
  id: string;
  studentId?: string;
  studentName?: string;
  actorEmail?: string;
  teacherEmail?: string;
  sectionCode?: string;
  action: string;
  details: string;
  ip: string;
  userAgent: string;
  os: string;
  browser: string;
  timestamp: string;
  isViolationWarning: boolean;
}

export interface AllowedStudent {
  idNumber: string; // Allowed university ID from Excel/Instructor Upload
  name: string;
  sectionCode: string;
}

export interface JoinCode extends SignedJoinCodeFields {
  code: string;
  semester: string;
  sectionCode: string; // "all" or specific
  status: "active" | "used" | "revoked";
  createdAt?: string;
  updatedAt?: string;
  studentId?: string;
  studentName?: string;
  studentSection?: string;

  usedByStudentId?: string;
  codeJourney?: CodeLedgerEvent[];
  codeReputation?: string;
  codeReputationLabel?: string;
  codeReputationScore?: number;
  activationDeviceServerHash?: string;
  activationFrozenUntil?: string;
  courseCode?: string;
  strictLibraryMode?: boolean;
  batchId?: string;
  batchLabel?: string;
  assignedStudentId?: string;
  assignedStudentName?: string;
  isFreeCode?: boolean;
  ownerEmail?: string;
  createdByEmail?: string;
  activatedAt?: string;
  activationDeviceFingerprint?: string;
  activationDeviceToken?: string;
  replacedBy?: string;
  reissuedFrom?: string;
  leakAttemptCount?: number;
  lastFailedAttemptAt?: string;
  lastFailedAttemptStudentId?: string;
  lastFailedAttemptReason?: string;
}

export interface ActivationAttempt {
  id: string;
  code: string;
  normalizedCode: string;
  studentId?: string;
  studentName?: string;
  sectionCode?: string;
  status: "blocked" | "warning";
  reason: string;
  deviceFingerprint: string;
  deviceToken?: string;
  ip: string;
  userAgent: string;
  timestamp: string;
  // طلب اعتماد جهاز مستخدم سابقاً: حقول اختيارية لا تؤثر على محاولات التفعيل القديمة
  approvalRequestType?: "second_hand_device" | string;
  approvalStatus?: "pending" | "approved" | "rejected" | string;
  approvalRequestedAt?: string;
  approvalResolvedAt?: string;
  approvalResolvedBy?: string;
  targetStudentId?: string;
  targetStudentName?: string;
  targetStudentEmail?: string;
  targetSectionCode?: string;
  targetJoinCode?: string;
  targetTeacherEmail?: string;
  previousStudentId?: string;
  previousStudentName?: string;
  activeConflict?: boolean;
  activeConflictReason?: string;
  deviceApprovalRecommendation?: string;
}

export interface ExamSession {
  id: string;
  studentId: string;
  examId: string;
  sessionId: string;
  deviceId: string;
  userAgent: string;
  displayMode: "pwa" | "browser";
  startedAt: string;
  lastHeartbeatAt: string;
  status: "active" | "finished" | "violated" | "expired";
  courseCode?: string;
  studentName?: string;
  examTitle?: string;
  ip?: string;
  finishedAt?: string;
  finishReason?: string;
  conflictAttempts?: any[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TeacherExam {
  id: string;
  title: string;
  points: number;
  questionsCount: number;
  open: string;
  close: string;
  courseCode: string;
  selectedCategories?: string[];
  seb?: {
    enabled: boolean;
    configName?: string;
    browserExamKey?: string;
    configKey?: string;
  };
  antiCheat?: {
    randomizeQuestions?: boolean;
    randomizeOptions?: boolean;
    questionPoolCount?: number;
    timerMinutes?: number;
    autosave?: boolean;
    lockAttempt?: boolean;
  };
  review?: {
    mode?: "none" | "after_attempt" | "after_close";
    scope?: "all" | "mistakes";
    showGrade?: boolean;
    gradesReleased?: boolean;
    releasedAt?: string;
  };
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PasswordResetRequest {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  studentPhone?: string;
  username?: string;
  sectionCode?: string;
  teacherEmail?: string;
  resetToken: string;
  resetLink: string;
  verificationCode: string;
  status: "new" | "handled" | "expired";
  requestedAt: string;
  expiresAt: string;
  handledAt?: string;
  usedAt?: string;
  lastSentAt?: string;
}

export interface NotificationToken {
  token: string;
  userId: string;
  userName?: string;
  role: "student" | "teacher" | "admin";
  sectionCode?: string;
  teacherEmail?: string;
  deviceToken?: string;
  permission: "granted" | "denied" | "default";
  platform: "web" | "pwa";
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
}

export interface PasskeyCredentialRecord {
  id: string;
  userId: string;
  userName: string;
  role: "student" | "teacher";
  credentialId: string;
  publicKey: number[];
  counter: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  deviceToken?: string;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface DatabaseState {
  lastUpdated?: number;
  students: Student[];
  teachers: Teacher[];
  sections: Section[];
  chapters: TextbookChapter[];
  questionBank: Question[];
  exercises: WeeklyExercise[];
  exerciseSubmissions: ExerciseSubmission[];
  personalizedProjects: PersonalizedProject[];
  quizSubmissions: QuizSubmission[];
  activityLogs: ActivityLog[];
  allowedStudents: AllowedStudent[];
  otps: { email: string; code: string; expiresAt: number }[];
  joinCodes?: JoinCode[];
  retiredJoinCodes?: JoinCode[];
  teacherExams?: TeacherExam[];
  teacherProjects?: any[];
  teacherSubmissions?: any[];
  sebAttempts?: any[];
  examSessions?: ExamSession[];
  passwordResetRequests?: PasswordResetRequest[];
  activationAttempts?: ActivationAttempt[];
  notificationTokens?: NotificationToken[];
  // مفاتيح التنبيهات المقروءة لكل مستخدم (role:userId) — لمزامنة حالة "مقروء" عبر أجهزته.
  notificationSeenKeys?: Record<string, { keys: string[]; updatedAt: string }>;
  // رادار مِراس: تقارير الأخطاء المجمّعة (على غرار Sentry) — للسوبر أدمن فقط.
  errorReports?: any[];
  // تنبيهات داخل التطبيق (الجرس) — محفوظة في قاعدة البيانات حتى لا تضيع عند إعادة تشغيل الخادم.
  inAppNotifications?: any[];
  // حارس إرسال FCM دائم: event + target لا يُرسل مرتين بعد إعادة تشغيل الحاوية.
  notificationDispatches?: Record<string, string>;
  // سجل تشخيص إرسال الإشعارات للسوبر أدمن: حدث واحد مع عدادات التوصيل والمنع.
  notificationAudit?: any[];
  passkeyCredentials?: PasskeyCredentialRecord[];
  bookMetadata?: {
    fileName: string;
    uploadDate: string;
    size: string;
  };
}

// Runtime data must start clean. Only teacher login accounts are retained below;
// curriculum, questions, exercises, sections, students, rosters, and codes are user-owned.
const initialSections: Section[] = [];
const initialChapters: TextbookChapter[] = [];
const initialQuestions: Question[] = [];
const initialWeeklyExercises: WeeklyExercise[] = [];

const initialTeachers: Teacher[] = [
  { id: "Ah.Alfailakawi@paaet.edu.kw", name: "د. أحمد حسين الفيلكاوي", email: "Ah.Alfailakawi@paaet.edu.kw", passwordHash: "sha256:REDACTED", role: "teacher", isActive: true },
  { id: "dr.ahmad.alfailakawi@gmail.com", name: "د. أحمد حسين الفيلكاوي", email: "dr.ahmad.alfailakawi@gmail.com", passwordHash: "sha256:REDACTED", role: "teacher", isActive: true },
  { id: "ada.alenezi@paaet.edu.kw", name: "د. عبدالعزيز دخيل العنزي", email: "ada.alenezi@paaet.edu.kw", passwordHash: "sha256:REDACTED", role: "teacher", isActive: true }
];

const initialStudents: Student[] = [];

const initialAllowedStudents: AllowedStudent[] = [];

const initialJoinCodes: JoinCode[] = [];

const normalizeDbStudentId = (value: any) => String(value ?? "")
  .trim()
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[^0-9]/g, "");

const normalizeDbEmail = (value: any) => String(value ?? "").trim().toLowerCase();

const cloneDbValue = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

const dbValuesEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

function cloudArrayItemKey(item: any, pathParts: string[]): string {
  if (item === null || typeof item !== "object") {
    return `value:${JSON.stringify(item)}`;
  }
  const field = String(pathParts[pathParts.length - 1] || "");
  const value = (...keys: string[]) => {
    for (const key of keys) {
      const found = String(item?.[key] ?? "").trim().toLowerCase();
      if (found) return found;
    }
    return "";
  };
  if (field === "allowedStudents") {
    return `roster:${normalizeDbStudentId(value("idNumber", "id", "studentId"))}|${value("sectionCode", "courseCode", "studentSection")}`;
  }
  if (["enrollments", "suspendedEnrollments"].includes(field)) {
    return `course:${value("courseCode", "sectionCode", "studentSection")}|${value("teacherEmail", "ownerEmail")}`;
  }
  if (["removedCourseLinks", "removedEnrollments", "deletedCourseLinks"].includes(field)) {
    return `removed:${normalizeDbStudentId(value("studentId", "idNumber"))}|${value("courseCode", "sectionCode", "studentSection")}|${value("teacherEmail", "ownerEmail")}`;
  }
  const stable = value(
    "id",
    "code",
    "credentialId",
    "sessionId",
    "token",
    "email",
    "resetToken",
    "submissionId",
  );
  if (stable) return `${field || "record"}:${stable}`;
  return `object:${JSON.stringify(item)}`;
}

/**
 * يطبّق فقط التغييرات التي حدثت محلياً منذ آخر نسخة سحابية فوق أحدث نسخة
 * موجودة في Firestore. بهذه الطريقة لا يستطيع خادم قديم أن يطمس تغييرات خادم
 * أحدث لمجرد أنه حفظ تنبيهاً أو نبضة اختبار بعده.
 */
function mergeCloudThreeWay(base: any, local: any, cloud: any, pathParts: string[] = []): any {
  if (dbValuesEqual(local, base)) return cloneDbValue(cloud);
  if (dbValuesEqual(cloud, base)) return cloneDbValue(local);
  if (local === undefined) return undefined;
  if (cloud === undefined) return cloneDbValue(local);

  if (Array.isArray(local) && Array.isArray(cloud)) {
    const baseArray = Array.isArray(base) ? base : [];
    const baseMap = new Map(baseArray.map((item: any) => [cloudArrayItemKey(item, pathParts), item]));
    const localMap = new Map(local.map((item: any) => [cloudArrayItemKey(item, pathParts), item]));
    const cloudMap = new Map(cloud.map((item: any) => [cloudArrayItemKey(item, pathParts), item]));
    const result: any[] = [];
    const emitted = new Set<string>();

    local.forEach((localItem: any) => {
      const key = cloudArrayItemKey(localItem, pathParts);
      const baseHas = baseMap.has(key);
      const cloudHas = cloudMap.has(key);
      if (baseHas && !cloudHas && dbValuesEqual(localItem, baseMap.get(key))) {
        // حذف سحابي لم يغيّره هذا الخادم: نحترمه ولا نعيد إنشاء السجل.
        emitted.add(key);
        return;
      }
      const merged = mergeCloudThreeWay(
        baseHas ? baseMap.get(key) : undefined,
        localItem,
        cloudHas ? cloudMap.get(key) : undefined,
        [...pathParts, key],
      );
      if (merged !== undefined) result.push(merged);
      emitted.add(key);
    });

    cloud.forEach((cloudItem: any) => {
      const key = cloudArrayItemKey(cloudItem, pathParts);
      if (emitted.has(key)) return;
      // وجود السجل في الأساس واختفاؤه محلياً يعني حذفه محلياً؛ غير ذلك تغيير
      // سحابي جديد يجب الاحتفاظ به.
      if (baseMap.has(key) && !localMap.has(key)) return;
      result.push(cloneDbValue(cloudItem));
      emitted.add(key);
    });
    return result;
  }

  if (
    local &&
    cloud &&
    typeof local === "object" &&
    typeof cloud === "object" &&
    !Array.isArray(local) &&
    !Array.isArray(cloud)
  ) {
    const baseObject = base && typeof base === "object" && !Array.isArray(base) ? base : {};
    const result: any = {};
    const keys = new Set([
      ...Object.keys(baseObject),
      ...Object.keys(local),
      ...Object.keys(cloud),
    ]);
    keys.forEach((key) => {
      const baseHas = Object.prototype.hasOwnProperty.call(baseObject, key);
      const localHas = Object.prototype.hasOwnProperty.call(local, key);
      const cloudHas = Object.prototype.hasOwnProperty.call(cloud, key);
      if (baseHas && !localHas) return;
      if (!localHas && cloudHas) {
        result[key] = cloneDbValue(cloud[key]);
        return;
      }
      const merged = mergeCloudThreeWay(
        baseHas ? baseObject[key] : undefined,
        localHas ? local[key] : undefined,
        cloudHas ? cloud[key] : undefined,
        [...pathParts, key],
      );
      if (merged !== undefined) result[key] = merged;
    });
    return result;
  }

  // تعارض على قيمة مفردة غيّرها الطرفان: الطلب المحلي الجاري هو الأحدث.
  return cloneDbValue(local);
}

export class LocalDatabase {
  private data: DatabaseState;
  private isSyncingFS: boolean = false;
  private lastFSSyncTime: number = 0;
  private syncIntervalMS: number = 10000; // Throttle to 10 seconds for standard saves
  private pendingFSSync: boolean = false;
  private persistTimeout: NodeJS.Timeout | null = null;
  private lastSyncedState: DatabaseState | null = null;
  private mutationVersion: number = 0;
  private cloudUnsubscribe: (() => void) | null = null;
  // آخر بيان معروف بعدد أجزاء كل مفتاح — يُستخدم فقط لو احتجنا لاحقاً نقرأ
  // مفتاحاً واحداً بمعزل عن البقية؛ يُحدَّث من كل قراءة أو كتابة ناجحة.
  private lastEntityManifest: Record<string, { chunkCount: number }> = {};
  public syncPromise: Promise<void> | null = null;
  // ⚡ تجميع وتأجيل الحفظ: انفجار التعديلات داخل الطلب الواحد (حذف مقرر يلمس مئات
  // الطلاب، حذف طالب، إزالة مقرر...) كان ينفّذ كتابة كامل القاعدة على القرص +
  // معاملة Firestore بشكل متزامن لكل تعديل، فيتجمّد الخادم. هذه الأعلام تضمن
  // كتابة محلية واحدة ومزامنة سحابية واحدة لكل دفعة، خارج مسار الاستجابة.
  private dirtyLocal: boolean = false;
  private localSaveTimer: NodeJS.Immediate | null = null;
  private cloudSyncScheduled: boolean = false;
  // نافذة تجميع الكتابة السحابية: كل التعديلات المتتابعة تُدفع في كتابة واحدة بعد
  // توقّف النشاط، فلا تعمل المزامنة الثقيلة أثناء الحذف/إعادة الجلب ويبقى التطبيق فورياً.
  private cloudDebounceMS: number = 250;
  // طابع آخر كتابة دفعناها؛ يسمح للمستمع بتخطّي صدى كتابتنا بثمن رخيص (بدون مقارنة
  // كامل القاعدة عبر JSON.stringify الثقيل) بدل إعادة معالجة كل كتابة.
  private lastWrittenUpdatedAt: number = 0;
  // آخر طابع سحابي طبّقه المستمع على الذاكرة — مع lastWrittenUpdatedAt يشكّلان
  // "آخر حالة سحابية معروفة": إن طابق طابع الميتا أحدهما فالسحابة لم تتغيّر منذ
  // آخر تكامل، فنكتب الفروق مباشرة بلا قراءة القاعدة كاملة (المسار السريع ⚡).
  private lastListenerAppliedStamp: number = 0;
  private databaseGuardLocked: boolean = false;
  private databaseGuardReason: string = "";
  private databaseGuardLockedAt: number = 0;
  private guardRetryInFlight: boolean = false;

  private lockDatabaseGuard(reason: string) {
    this.databaseGuardLocked = true;
    this.databaseGuardLockedAt = Date.now();
    this.databaseGuardReason = reason;
    console.error(`🛑 ${MIRAS_DATABASE_GUARD_CODE}: ${reason}`);
  }

  private unlockDatabaseGuard() {
    if (this.databaseGuardLocked) {
      console.log("✅ Database guard unlocked after receiving a non-empty trusted cloud state.");
    }
    this.databaseGuardLocked = false;
    this.databaseGuardLockedAt = 0;
    this.databaseGuardReason = "";
  }

  // القفل كان يبقى إلى الأبد طوال عمر الحاوية بعد أول فشل عابر (خصوصاً عند
  // الإقلاع البارد لـ Cloud Run: min instances = 0، فأي عطل شبكي لحظي في أول
  // قراءة من Firestore يقفل الحفظ نهائياً حتى تُستبدل الحاوية بأخرى). هنا نعيد
  // محاولة نفس فحص المزامنة الآمن دورياً بدل انتظار إعادة نشر يدوي.
  private async reattemptDatabaseGuardIfCooldownPassed() {
    if (
      !this.databaseGuardLocked ||
      this.guardRetryInFlight ||
      Date.now() - this.databaseGuardLockedAt < DATABASE_GUARD_RETRY_COOLDOWN_MS
    ) {
      return;
    }
    this.guardRetryInFlight = true;
    try {
      await this.syncFromFirestore();
    } catch (err) {
      console.error("⚠️ Database guard retry attempt failed:", err);
    } finally {
      this.guardRetryInFlight = false;
    }
  }

  public isDatabaseGuardLocked(): boolean {
    return this.databaseGuardLocked;
  }

  public getDatabaseGuardStatus() {
    return {
      locked: this.databaseGuardLocked,
      code: this.databaseGuardLocked
        ? MIRAS_DATABASE_GUARD_CODE
        : firestoreQuotaExceeded
          ? "FIRESTORE_QUOTA_EXCEEDED"
          : MIRAS_DATABASE_GUARD_CODE,
      message: firestoreQuotaExceeded
        ? "النظام في وضع صيانة للبيانات الآن. أوقفنا الحفظ مؤقتًا حتى لا تظهر البيانات ثم تختفي."
        : MIRAS_DATABASE_GUARD_USER_MESSAGE,
      reason: this.databaseGuardReason,
      firestoreQuotaExceeded,
      firestoreQuotaErrorDetail,
      allowEmptyInit: MIRAS_ALLOW_EMPTY_FIRESTORE_INIT,
      allowLocalRestore: MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD,
      allowLocalOnlyMode: MIRAS_ALLOW_LOCAL_ONLY_MODE,
      localHasMeaningfulContent: databaseHasMeaningfulContent(this.data),
    };
  }

  public async waitForSync(): Promise<void> {
    this.flushLocalSave();
    await this.reattemptDatabaseGuardIfCooldownPassed();
    if (firestoreQuotaExceeded) {
      const message = `FIRESTORE_QUOTA_EXCEEDED: ${firestoreQuotaErrorDetail || "Firestore quota exceeded"}`;
      console.warn(`⚠️ ${message}`);
      if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
        // في الإنتاج لا يجوز أن نؤكد للمستخدم أن الاختبار/المشروع/المقرر/الطالب
        // انحفظ بينما Firestore يرفض الكتابة. كان الرجوع الصامت إلى الكاش المحلي
        // هو سبب ظهور السجل ثم اختفائه بعد تسجيل الخروج أو تدوير حاوية PWA/الخادم.
        throw new Error(message);
      }
      return;
    }
    if (this.databaseGuardLocked && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
      throw new Error(`Database guard is locked: ${this.databaseGuardReason}`);
    }

    // كانت المهلة ١.٥ ثانية فقط: قصيرة جداً لكتابة قد تمتد لعدة مستندات مجزّأة
    // (chunked-json-v2) على حاوية باردة الإقلاع، فتُظهر خطأ "تعذر التأكيد" لحفظ
    // نجح فعلاً لكنه استغرق أطول قليلاً فقط. Cloud Run نفسه يمهل الطلب ٣٠٠ ثانية،
    // فرفع هذه المهلة الداخلية لا يخاطر بتعليق الطلب.
    const deadline = Date.now() + 6000;
    let syncError: any = null;

    while (Date.now() < deadline) {
      if (this.pendingFSSync && this.persistTimeout) {
        clearTimeout(this.persistTimeout);
        this.persistTimeout = null;
        this.cloudSyncScheduled = false;
      }
      if (this.pendingFSSync && !this.isSyncingFS) {
        this.performCloudSync().catch((err) => {
          syncError = err;
        });
      }
      const activeSync = this.syncPromise;
      if (activeSync) {
        try {
          await Promise.race([
            activeSync,
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 200))
          ]);
        } catch (err: any) {
          if (err?.message !== "timeout") {
            syncError = err;
          }
        }
        continue;
      }
      if (!this.pendingFSSync && !this.isSyncingFS) {
        if (syncError) throw syncError;
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }

    if (syncError) throw syncError;
    if (this.pendingFSSync || this.isSyncingFS) {
      throw new Error("Cloud synchronization timed out (1.5 seconds) and is still pending.");
    }
  }
  private isFirstSync: boolean = true;
  private hasLocalDbFile: boolean = false;
  private loadedEmptyOrInvalidLocalDb: boolean = false;
  private allowEmptyDatabaseWriteOnce: boolean = false;
  public initialSyncPromise: Promise<void>;

  constructor() {
    this.data = this.load();
    this.lastSyncedState = cloneDbValue(this.data);
    this.initialSyncPromise = this.syncFromFirestore();
  }

  private async syncFromFirestore() {
    if (!dbFS) {
      if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
        this.lockDatabaseGuard(
          "Firestore is not initialized. Cloud-only mode refused to run from local data/db.json so the app does not appear wiped or overwrite cloud data later.",
        );
      }
      return;
    }
    try {
      this.isSyncingFS = true;
      let cloudRead: { exists: boolean; state: DatabaseState; raw: any };
      try {
        cloudRead = await this.readCloudDatabaseState();
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, "system/database");
        if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
          this.lockDatabaseGuard(
            "Initial Firestore read failed. Cloud-only mode blocked the runtime instead of serving local/empty cache as the real database.",
          );
        }
        return;
      }
      
      if (cloudRead.exists) {
        const cloudState = cloudRead.state;
        const cloudHasContent = databaseHasMeaningfulContent(cloudState);
        const localHasContent = databaseHasMeaningfulContent(this.data);

        if (!cloudHasContent && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
          if (localHasContent && MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
            console.warn(
              "⚠️ Firestore system/database exists but is empty. Restoring cloud from local cache because MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD=true.",
            );
            await this.writeCloudDatabaseState(this.data);
            this.lastSyncedState = cloneDbValue(this.data);
            this.unlockDatabaseGuard();
            return;
          }

          this.lastSyncedState = cloneDbValue(this.data);
          this.lockDatabaseGuard(
            localHasContent
              ? "Firestore system/database exists but has no meaningful records. Refused to pull the empty cloud document over a local cache that contains data. Set MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD=true only if this local cache is the intended backup."
              : "Firestore system/database exists but has no meaningful records, and local data/db.json is empty or invalid. Empty runtime was blocked so the app does not appear wiped or save an empty database.",
          );
          return;
        }

        console.log("☁️ Found persistent database state in cloud Firestore. Cloud is the source of truth.");
        this.data = cloudState;
        this.lastSyncedState = cloneDbValue(this.data);
        // حالة الإقلاع هي السحابة المتكاملة بعينها ⇒ فعّل المسار السريع من أول حفظة.
        this.lastListenerAppliedStamp = Number(cloudState.lastUpdated || 0);
        this.saveState(this.data);
        this.isFirstSync = false;
        this.unlockDatabaseGuard();
        console.log("✨ Cloud database synchronized to the local runtime cache.");
      } else {
        const localHasContent = databaseHasMeaningfulContent(this.data);
        if (!localHasContent && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
          this.lastSyncedState = cloneDbValue(this.data);
          this.lockDatabaseGuard(
            "Firestore system/database is missing and local data/db.json is empty or invalid. Empty cloud initialization was blocked to protect production data. Restore a backup or set MIRAS_ALLOW_EMPTY_FIRESTORE_INIT=true only for a brand-new installation.",
          );
          return;
        }
        if (localHasContent && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
          this.lastSyncedState = cloneDbValue(this.data);
          this.lockDatabaseGuard(
            "Firestore system/database is missing while local cache contains data. Refused to promote local cache automatically because this may be the wrong Firebase project. Set MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD=true only after confirming this local cache is the backup you want to restore.",
          );
          return;
        }
        console.log("🌱 No prior database state found in Firestore. Creating first-time cloud backup...");
        try {
          if (!this.data.lastUpdated || this.data.lastUpdated === 0) {
            this.data.lastUpdated = Date.now();
          }
          await this.writeCloudDatabaseState(this.data);
          this.lastSyncedState = cloneDbValue(this.data);
          this.lastWrittenUpdatedAt = Number(this.data.lastUpdated || 0);
          this.unlockDatabaseGuard();
          console.log("✨ Init cloud backup created successfully.");
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, "system/database");
          if (firestoreQuotaExceeded && !MIRAS_ALLOW_LOCAL_ONLY_MODE) {
            this.lockDatabaseGuard(
              "Initial Firestore write failed because quota is exhausted. Cloud durability is blocked until Firestore quota/billing is fixed.",
            );
          }
        }
      }
    } catch (e) {
      console.error("⚠️ Error synchronizing with cloud Firestore state:", e);
      if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
        this.lockDatabaseGuard(
          `Initial Cloud synchronization failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    } finally {
      this.isSyncingFS = false;
      this.startCloudListener();
    }
  }

  private cloudDatabaseMetaRef() {
    return dbFS.doc("system/database");
  }

  private cloudDatabaseChunkRef(index: number) {
    return dbFS.doc(
      `system/database/chunks/${String(index).padStart(4, "0")}`,
    );
  }

  // كل مفتاح (students, activityLogs...) في مجموعة فرعية خاصة به تحت نفس
  // وثيقة system/database، بدل كتلة chunks العامة الواحدة القديمة. نفس نمط
  // التقسيم لأجزاء آمنة الحجم يُطبَّق هنا أيضاً (لكل مفتاح على حدة) تحسباً لأي
  // مفتاح قد يكبر مستقبلاً فوق حد وثيقة Firestore الواحدة.
  private cloudEntityDocRef(key: string, index = 0) {
    const docId = index ? `${key}__${index}` : key;
    return dbFS.doc("system/database").collection("entities").doc(docId);
  }

  // مجموعة "وثيقة لكل كيان" لمفتاح ساخن (مثل activityLogs).
  private cloudPerDocCollection(key: string) {
    return dbFS.doc("system/database").collection(`perdoc_${key}`);
  }

  // معرّف مستقر للكيان داخل مفتاح perDoc.
  private perDocEntityId(item: any): string {
    return String(item?.id || item?.token || item?.code || "").trim();
  }

  // يكتب فرق مفتاح perDoc: وثيقة لكل كيان متغيّر/جديد وحذف للمزال — بدل إعادة
  // كتابة المصفوفة كاملة. previousItems=null تعني "اكتب الكل" (استعادة/تحويل أول).
  private async writePerDocKeyDiff(
    key: string,
    currentItems: any[],
    previousItems: any[] | null,
    generation: number,
  ): Promise<void> {
    const col = this.cloudPerDocCollection(key);
    const nowIso = new Date().toISOString();
    const currentById = new Map<string, any>();
    for (const item of currentItems || []) {
      const id = this.perDocEntityId(item);
      if (id) currentById.set(id, item);
    }
    const prevById = new Map<string, string>();
    if (previousItems) {
      for (const item of previousItems) {
        const id = this.perDocEntityId(item);
        if (id) prevById.set(id, JSON.stringify(item ?? null));
      }
    }
    let batch = dbFS.batch();
    let ops = 0;
    const flush = async () => {
      if (ops > 0) {
        await batch.commit();
        batch = dbFS.batch();
        ops = 0;
      }
    };
    for (const [id, item] of currentById) {
      const payload = JSON.stringify(item ?? null);
      if (previousItems && prevById.get(id) === payload) continue; // لم يتغيّر
      batch.set(col.doc(id), { d: item, g: generation, u: nowIso });
      ops += 1;
      if (ops >= 400) await flush();
    }
    for (const id of prevById.keys()) {
      if (!currentById.has(id)) {
        batch.delete(col.doc(id));
        ops += 1;
        if (ops >= 400) await flush();
      }
    }
    await flush();
  }

  private isChunkedCloudMeta(raw: any): boolean {
    return String(raw?.storageFormat || "") === MIRAS_CLOUD_STORAGE_FORMAT;
  }

  private isEntityCloudMeta(raw: any): boolean {
    return String(raw?.storageFormat || "") === MIRAS_CLOUD_ENTITY_STORAGE_FORMAT;
  }

  private async cloudStateFromMeta(raw: any): Promise<DatabaseState> {
    if (this.isEntityCloudMeta(raw)) {
      return this.cloudStateFromEntityManifest(raw);
    }
    if (!this.isChunkedCloudMeta(raw)) {
      return this.databaseStateFromCloud(raw as Partial<DatabaseState>);
    }

    const chunkCount = Number(raw?.chunkCount || 0);
    if (!Number.isFinite(chunkCount) || chunkCount < 1 || chunkCount > 250) {
      throw new Error(
        `Invalid chunked Firestore database metadata: chunkCount=${raw?.chunkCount}`,
      );
    }

    const chunkSnaps = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) =>
        this.cloudDatabaseChunkRef(index).get(),
      ),
    );
    const chunks = chunkSnaps.map((snap, index) => {
      if (!snap.exists) {
        throw new Error(`Missing Firestore database chunk ${index + 1}/${chunkCount}`);
      }
      const payload = snap.data()?.payload;
      if (typeof payload !== "string") {
        throw new Error(`Invalid Firestore database chunk payload at index ${index}`);
      }
      return payload;
    });

    try {
      return this.databaseStateFromCloud(JSON.parse(chunks.join("")) as Partial<DatabaseState>);
    } catch (err: any) {
      throw new Error(`Failed to parse chunked Firestore database payload: ${err?.message || String(err)}`);
    }
  }

  // يعيد بناء DatabaseState الكاملة من وثائق الكيانات المنفصلة. أي خلل في مفتاح
  // واحد (وثيقة مفقودة، JSON تالف) يُسقط القراءة كاملة برمي خطأ — نفس سلوك
  // العارض القديم عند تلف كتلة JSON — بدل إرجاع حالة جزئية قد تبدو سليمة
  // وتُحفظ لاحقاً فوق بيانات حقيقية.
  private async cloudStateFromEntityManifest(raw: any): Promise<DatabaseState> {
    const manifest = raw?.entityManifest || {};
    const keys: string[] =
      Array.isArray(raw?.entityKeys) && raw.entityKeys.length
        ? raw.entityKeys
        : (MIRAS_CLOUD_ENTITY_KEYS as string[]);
    this.lastEntityManifest = manifest;
    const entries = await Promise.all(
      keys.map(async (key) => {
        const info = manifest[key];
        // مفتاح perDoc: اقرأ مجموعته (وثيقة لكل كيان) بدل الأجزاء المجمّدة.
        // الترتيب: الأحدث أولاً حسب حقل الكيان الزمني (unshift الأصلي) — سجلات
        // النشاط تحمل timestamp خاصاً بها.
        if ((info as any)?.perDoc) {
          const snap = await this.cloudPerDocCollection(key).get();
          const items = snap.docs
            .map((doc: any) => (doc.data() as any)?.d)
            .filter((item: any) => item != null);
          items.sort((a: any, b: any) => {
            const ta = Date.parse(String(a?.timestamp || a?.createdAt || a?.updatedAt || 0)) || 0;
            const tb = Date.parse(String(b?.timestamp || b?.createdAt || b?.updatedAt || 0)) || 0;
            return tb - ta;
          });
          return [key, items] as const;
        }
        const chunkCount = Math.max(1, Number(info?.chunkCount || 1));
        if (!Number.isFinite(chunkCount) || chunkCount > 250) {
          throw new Error(`Invalid chunk count for entity ${key}: ${info?.chunkCount}`);
        }
        const chunkSnaps = await Promise.all(
          Array.from({ length: chunkCount }, (_, index) =>
            this.cloudEntityDocRef(key, index).get(),
          ),
        );
        const payload = chunkSnaps
          .map((snap, index) => {
            if (!snap.exists) {
              throw new Error(`Missing Firestore chunk ${index + 1}/${chunkCount} for entity ${key}`);
            }
            const chunkPayload = snap.data()?.payload;
            if (typeof chunkPayload !== "string") {
              throw new Error(`Invalid Firestore chunk payload for entity ${key} at index ${index}`);
            }
            return chunkPayload;
          })
          .join("");
        try {
          return [key, payload ? JSON.parse(payload) : null] as const;
        } catch (err: any) {
          throw new Error(`Failed to parse Firestore payload for entity ${key}: ${err?.message || String(err)}`);
        }
      }),
    );
    const partial: Partial<DatabaseState> = { lastUpdated: raw?.lastUpdated };
    entries.forEach(([key, value]) => {
      (partial as any)[key] = value;
    });
    return this.databaseStateFromCloud(partial);
  }

  private async readCloudDatabaseState(): Promise<{ exists: boolean; state: DatabaseState; raw: any }> {
    const snap = await this.cloudDatabaseMetaRef().get();
    if (!snap.exists) {
      return { exists: false, state: this.databaseStateFromCloud({}), raw: null };
    }
    const raw = snap.data() as any;
    return {
      exists: true,
      raw,
      state: await this.cloudStateFromMeta(raw),
    };
  }

  // previousState = آخر حالة معروفة متزامنة فعلاً مع السحابة (this.lastSyncedState
  // عادةً). أي مفتاح لم يتغيّر عنها إطلاقاً لا يُكتب من جديد؛ فحفظة تُعدّل
  // تسليماً واحداً فقط تكتب وثيقة teacherSubmissions دون أن تمسّ students أو
  // activityLogs أو joinCodes وغيرها. previousState=null (أو undefined) تعني
  // "اكتب كل شيء" — تُستخدم فقط في الاستعادة/أول نسخة سحابية حين لا معنى للمقارنة.
  private async writeCloudDatabaseState(
    state: DatabaseState,
    previousState?: DatabaseState | null,
  ): Promise<void> {
    if (!dbFS) return;
    const cleaned = cleanUndefined(state) as DatabaseState;
    const generation = Number(cleaned.lastUpdated || Date.now());
    const writes: Promise<any>[] = [];
    const mergedManifest: Record<string, { chunkCount: number }> = {
      ...this.lastEntityManifest,
    };
    const nowIso = new Date().toISOString();

    for (const key of MIRAS_CLOUD_ENTITY_KEYS) {
      const value = (cleaned as any)[key] ?? null;
      const unchanged =
        previousState != null &&
        mergedManifest[key] &&
        dbValuesEqual(value, (previousState as any)[key] ?? null);
      if (unchanged) continue;

      // ⚡ مفاتيح perDoc: فرق على مستوى الكيان (وثيقة لكل سجل) بدل إعادة كتابة
      // المصفوفة كاملة. أول تحويل يكتب كل الكيانات ويجمّد النسخة المجزّأة القديمة
      // كما هي (توافق رجوع)، وما بعده يكتب المتغيّر فقط.
      if (MIRAS_PERDOC_KEYS.has(key as string) && Array.isArray(value)) {
        const alreadyPerDoc = !!(mergedManifest as any)[key]?.perDoc;
        const previousItems =
          alreadyPerDoc && previousState != null
            ? (((previousState as any)[key] as any[]) ?? [])
            : null;
        if (previousItems === null && alreadyPerDoc) {
          // استعادة كاملة فوق مجموعة perDoc قائمة: نظّف الوثائق الشاردة أولاً
          // (listDocuments لا يقرأ المحتوى — رخيص) حتى لا تبقى كيانات محذوفة.
          try {
            const existingRefs = await this.cloudPerDocCollection(
              key as string,
            ).listDocuments();
            const keepIds = new Set(
              value
                .map((item: any) => this.perDocEntityId(item))
                .filter(Boolean),
            );
            let cleanupBatch = dbFS.batch();
            let cleanupOps = 0;
            for (const ref of existingRefs) {
              if (!keepIds.has(ref.id)) {
                cleanupBatch.delete(ref);
                cleanupOps += 1;
                if (cleanupOps >= 400) {
                  await cleanupBatch.commit();
                  cleanupBatch = dbFS.batch();
                  cleanupOps = 0;
                }
              }
            }
            if (cleanupOps > 0) await cleanupBatch.commit();
          } catch {}
        }
        writes.push(
          this.writePerDocKeyDiff(
            key as string,
            value,
            previousItems,
            generation,
          ),
        );
        (mergedManifest as any)[key] = {
          // نُبقي chunkCount القديم كما هو (لقطة التجميد المتوافقة مع الرجوع).
          chunkCount: Number((mergedManifest as any)[key]?.chunkCount || 1),
          perDoc: true,
          count: value.length,
        };
        continue;
      }

      const payload = JSON.stringify(value);
      const chunks: string[] = [];
      for (let i = 0; i < payload.length; i += MIRAS_CLOUD_CHUNK_SIZE) {
        chunks.push(payload.slice(i, i + MIRAS_CLOUD_CHUNK_SIZE));
      }
      if (!chunks.length) chunks.push("null");

      chunks.forEach((chunkPayload, index) => {
        writes.push(
          this.cloudEntityDocRef(key, index).set({
            generation,
            index,
            chunkCount: chunks.length,
            payload: chunkPayload,
            updatedAt: nowIso,
          }),
        );
      });
      mergedManifest[key] = { chunkCount: chunks.length };
    }

    await Promise.all(writes);

    await this.cloudDatabaseMetaRef().set({
      storageFormat: MIRAS_CLOUD_ENTITY_STORAGE_FORMAT,
      entityKeys: MIRAS_CLOUD_ENTITY_KEYS,
      entityManifest: mergedManifest,
      lastUpdated: generation,
      updatedAt: nowIso,
      contentCounts: MIRAS_DATABASE_CONTENT_KEYS.reduce((acc: Record<string, number>, key) => {
        const value = (cleaned as any)?.[key];
        acc[key] = Array.isArray(value) ? value.length : 0;
        return acc;
      }, {}),
    });
    this.lastEntityManifest = mergedManifest;
  }

  private databaseStateFromCloud(cloudData: Partial<DatabaseState>): DatabaseState {
    return {
      lastUpdated: cloudData.lastUpdated || Date.now(),
      students: cloudData.students || [],
      teachers: cloudData.teachers || initialTeachers,
      sections: Array.isArray(cloudData.sections) ? cloudData.sections : [],
      chapters: Array.isArray(cloudData.chapters) ? cloudData.chapters : [],
      questionBank: Array.isArray(cloudData.questionBank) ? cloudData.questionBank : [],
      exercises: Array.isArray(cloudData.exercises) ? cloudData.exercises : [],
      exerciseSubmissions: cloudData.exerciseSubmissions || [],
      personalizedProjects: cloudData.personalizedProjects || [],
      quizSubmissions: cloudData.quizSubmissions || [],
      activityLogs: cloudData.activityLogs || [],
      allowedStudents: cloudData.allowedStudents || [],
      otps: cloudData.otps || [],
      joinCodes: cloudData.joinCodes || [],
      retiredJoinCodes: (cloudData as any).retiredJoinCodes || [],
      teacherExams: cloudData.teacherExams || [],
      teacherProjects: cloudData.teacherProjects || [],
      teacherSubmissions: cloudData.teacherSubmissions || [],
      sebAttempts: cloudData.sebAttempts || [],
      examSessions: (cloudData as any).examSessions || [],
      passwordResetRequests: cloudData.passwordResetRequests || [],
      activationAttempts: cloudData.activationAttempts || [],
      notificationTokens: cloudData.notificationTokens || [],
      inAppNotifications: (cloudData as any).inAppNotifications || [],
      notificationDispatches: (cloudData as any).notificationDispatches || {},
      notificationAudit: (cloudData as any).notificationAudit || [],
      passkeyCredentials: (cloudData as any).passkeyCredentials || [],
      bookMetadata: cloudData.bookMetadata,
      // كانت مفقودة من المزامنة السحابية كلياً — فحالة "مقروء" تضيع مع كل تدوير حاوية.
      notificationSeenKeys: (cloudData as any).notificationSeenKeys || {},
      errorReports: (cloudData as any).errorReports || [],
    };
  }

  private startCloudListener() {
    if (!dbFS || this.cloudUnsubscribe) return;
    this.cloudUnsubscribe = this.cloudDatabaseMetaRef().onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) {
          if (!MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
            this.lockDatabaseGuard(
              "Firestore system/database disappeared while the server was running. Ignored the missing snapshot to avoid replacing the runtime with an empty database.",
            );
          }
          return;
        }
        const raw = snapshot.data() as any;
        // تخطٍّ رخيص لصدى كتابتنا نفسها (الحالة الشائعة): إن لم تكن لدينا تغييرات
        // معلّقة وكان طابع المستند هو طابع آخر كتابة دفعناها، فلا داعي لإعادة بناء
        // القاعدة ومقارنتها عبر JSON.stringify الثقيل على كل كتابة.
        if (
          !this.pendingFSSync &&
          Number(raw?.lastUpdated || 0) === this.lastWrittenUpdatedAt
        ) {
          return;
        }
        void (async () => {
        const incoming = await this.cloudStateFromMeta(raw);
        const incomingHasContent = databaseHasMeaningfulContent(incoming);
        const currentHasContent = databaseHasMeaningfulContent(this.data);
        if (!incomingHasContent && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
          if (currentHasContent && MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
            this.pendingFSSync = true;
            this.scheduleCloudSync(false);
            return;
          }
          this.lockDatabaseGuard(
            currentHasContent
              ? "Firestore listener received an empty database snapshot. The local runtime still has data, so the empty snapshot was ignored to prevent data loss."
              : "Firestore listener received an empty database snapshot and the local runtime has no data. The empty state was blocked instead of being saved as the app database.",
          );
          return;
        }
        this.unlockDatabaseGuard();
        if (dbValuesEqual(incoming, this.lastSyncedState)) return;

        const incomingStamp = Number(incoming?.lastUpdated || raw?.lastUpdated || 0);
        const localStamp = Number(this.data?.lastUpdated || 0);
        if (!this.pendingFSSync && !this.isSyncingFS && incomingStamp && localStamp && incomingStamp < localStamp) {
          // لقطة سحابية أقدم وصلت متأخرة من مستمع Firestore أو من نسخة تشغيل أخرى.
          // لا نسمح لها بإسقاط سجل محلي أحدث (مثل اختبار/مشروع تم إنشاؤه الآن)،
          // بل نعيد جدولة رفع النسخة الأحدث حتى تبقى السحابة هي الحقيقة ولا تختفي السجلات.
          this.pendingFSSync = true;
          this.scheduleCloudSync(false);
          return;
        }

        if (this.pendingFSSync) {
          // توجد تغييرات محلية لم تُرفع بعد: نضعها فوق أحدث نسخة سحابية ثم
          // نترك دورة الحفظ ترفع الناتج، بدلاً من إسقاط أحد الطرفين.
          this.data = mergeCloudThreeWay(
            this.lastSyncedState || {},
            this.data,
            incoming,
          ) as DatabaseState;
          this.lastSyncedState = cloneDbValue(incoming);
        } else {
          this.data = incoming;
          this.lastSyncedState = cloneDbValue(incoming);
        }
        this.lastListenerAppliedStamp = incomingStamp;
        this.scheduleLocalSave();
        })().catch((error) => {
          console.error("⚠️ Firestore chunked live synchronization failed:", error);
          if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
            this.lockDatabaseGuard(
              `Firestore chunked listener failed: ${error?.message || String(error)}`
            );
          }
        });
      },
      (error) => {
        console.error("⚠️ Firestore live synchronization listener failed:", error);
      },
    );
  }

  private load(): DatabaseState {
    if (fs.existsSync(DB_FILE)) {
      try {
        const fileContent = fs.readFileSync(DB_FILE, "utf-8");
        if (!fileContent.trim()) {
          this.loadedEmptyOrInvalidLocalDb = true;
          throw new Error("empty-db-file");
        }
        const parsed = JSON.parse(fileContent);
        this.hasLocalDbFile = true;
        return {
          lastUpdated: parsed.lastUpdated || 0,
          students: parsed.students || [],
          teachers: parsed.teachers || initialTeachers,
          sections: Array.isArray(parsed.sections) ? parsed.sections : [],
          chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
          questionBank: Array.isArray(parsed.questionBank) ? parsed.questionBank : [],
          exercises: Array.isArray(parsed.exercises) ? parsed.exercises : [],
          exerciseSubmissions: parsed.exerciseSubmissions || [],
          personalizedProjects: parsed.personalizedProjects || [],
          quizSubmissions: parsed.quizSubmissions || [],
          activityLogs: parsed.activityLogs || [],
          allowedStudents: parsed.allowedStudents || [],
          otps: parsed.otps || [],
          joinCodes: parsed.joinCodes || [],
          retiredJoinCodes: parsed.retiredJoinCodes || [],
          teacherExams: parsed.teacherExams || [],
          teacherProjects: parsed.teacherProjects || [],
          teacherSubmissions: parsed.teacherSubmissions || [],
          sebAttempts: parsed.sebAttempts || [],
          examSessions: parsed.examSessions || [],
          passwordResetRequests: parsed.passwordResetRequests || [],
          activationAttempts: parsed.activationAttempts || [],
          notificationTokens: parsed.notificationTokens || [],
          inAppNotifications: parsed.inAppNotifications || [],
          notificationDispatches: parsed.notificationDispatches || {},
          notificationAudit: parsed.notificationAudit || [],
          passkeyCredentials: parsed.passkeyCredentials || [],
          bookMetadata: parsed.bookMetadata,
          notificationSeenKeys: parsed.notificationSeenKeys || {},
          errorReports: parsed.errorReports || []
        };
      } catch (e) {
        this.loadedEmptyOrInvalidLocalDb = true;
        if ((e as Error)?.message !== "empty-db-file") {
          console.error("Failed to parse database file. A clean runtime state will be used without being promoted to Firestore automatically.", e);
        } else {
          console.warn("⚠️ data/db.json is empty. Using a clean runtime state only; cloud initialization from this empty file is blocked.");
        }
      }
    }

    const defaultState: DatabaseState = {
      lastUpdated: 0, // Set to 0 so cloud backup is always preferred initially
      students: [],
      teachers: initialTeachers,
      sections: [],
      chapters: [],
      questionBank: [],
      exercises: [],
      exerciseSubmissions: [],
      personalizedProjects: [],
      quizSubmissions: [],
      activityLogs: [],
      allowedStudents: [],
      otps: [],
      joinCodes: [],
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
      notificationDispatches: {},
      notificationAudit: [],
      passkeyCredentials: []
    };
    // لا نكتب الحالة الفارغة على db.json عند الإقلاع. هذا الملف cache تشغيل فقط،
    // وكتابته فارغاً ثم رفعه للسحابة كان سبب مسح البيانات بعد التطوير/النشر.
    return defaultState;
  }

  private saveState(state: DatabaseState) {
    try {
      const nextHasContent = databaseHasMeaningfulContent(state);
      const existingHasContent = readExistingDbFileHasMeaningfulContent();
      if (!nextHasContent && existingHasContent && !this.allowEmptyDatabaseWriteOnce) {
        console.error(
          "🛑 Blocked writing an empty runtime database over a non-empty data/db.json cache. This prevents accidental data loss during development or deployment.",
        );
        return;
      }
      // ملف القرص مجرد cache تشغيل (المصدر السحابي هو الحقيقة)؛ نتخلى عن التنسيق
      // المُجمّل لأنه يضاعف زمن التسلسل وحجم الكتابة على قاعدة بحجم عدة ميغابايت.
      fs.writeFileSync(DB_FILE, JSON.stringify(state), "utf-8");
    } catch (e) {
      console.error("Failed to write to database file", e);
    } finally {
      this.allowEmptyDatabaseWriteOnce = false;
    }
  }

  // كتابة محلية مؤجَّلة ومُجمَّعة: أول تعديل في الدورة يجدول كتابة واحدة عبر
  // setImmediate، وكل تعديل لاحق في نفس الدورة يكتفي برفع علم dirty. النتيجة:
  // كتابة قرص واحدة لكل دفعة بدل N كتابات متزامنة تجمّد حلقة الأحداث.
  private scheduleLocalSave() {
    this.dirtyLocal = true;
    if (this.localSaveTimer) return;
    this.localSaveTimer = setImmediate(() => {
      this.localSaveTimer = null;
      this.flushLocalSave();
    });
  }

  // تفريغ متزامن فوري لأي حالة مؤجَّلة (يُستخدم قبل المزامنة وعند إيقاف الخادم).
  public flushLocalSave() {
    if (!this.dirtyLocal) return;
    this.dirtyLocal = false;
    if (this.localSaveTimer) {
      clearImmediate(this.localSaveTimer);
      this.localSaveTimer = null;
    }
    this.saveState(this.data);
  }

  // عدّاد يتزايد مع كل تعديل فعلي (أي persist())؛ يُستخدم كمفتاح تخزين مؤقت
  // خفيف للمسارات الساخنة (مثل /api/live/student-state) حتى لا تُعاد نفس
  // الحسابات الثقيلة لكل استطلاع (polling) من العميل بينما لا شيء تغيّر فعلياً.
  public getMutationVersion(): number {
    return this.mutationVersion;
  }

  public async persist(immediate: boolean = true) {
    await this.reattemptDatabaseGuardIfCooldownPassed();
    if (this.databaseGuardLocked && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
      console.error(
        `🛑 ${MIRAS_DATABASE_GUARD_CODE}: blocked persist while database guard is locked. ${this.databaseGuardReason}`,
      );
      return;
    }
    reopenFirestoreSyncIfQuotaCooldownPassed();
    this.mutationVersion += 1;
    this.data.lastUpdated = Math.max(
      Date.now(),
      Number(this.data.lastUpdated || 0) + 1,
    );

    // ⚡ حفظ محلي مؤجَّل ومُجمَّع بدل كتابة كامل القاعدة على القرص بشكل متزامن عند
    // كل تعديل. عملية مثل حذف مقرر تعدّل مئات الطلاب داخل حلقة واحدة؛ سابقاً كانت
    // تنفّذ مئات عمليات writeFileSync الحاجبة داخل مسار الطلب فيتجمّد. الآن: كتابة
    // واحدة بعد انتهاء الدفعة وخارج مسار الاستجابة.
    this.scheduleLocalSave();

    if (dbFS && !firestoreQuotaExceeded) {
      this.pendingFSSync = true;
      // ⚡ معاملة Firestore واحدة مُجمَّعة لكل دفعة (بدل N معاملات على نفس المستند).
      this.scheduleCloudSync(immediate);
    }
  }

  // يجدول كتابة سحابية واحدة لكل نافذة تجميع. كتابة واحدة معلّقة تكفي لأنها ستلتقط
  // أحدث this.data وقت التنفيذ، فلا نعيد الضبط مع كل تعديل (تفادياً للتجويع) ولا
  // نشغّل العمل الثقيل أثناء الطلب نفسه. كتلة finally في performCloudSync تعيد
  // الجدولة تلقائياً إن بقيت تغييرات معلّقة بعد الكتابة.
  private scheduleCloudSync(immediate: boolean) {
    if (!dbFS || firestoreQuotaExceeded) return;
    if (this.isSyncingFS || this.cloudSyncScheduled || this.persistTimeout) return;

    const sinceLast = Date.now() - this.lastFSSyncTime;
    // الحفظ غير الفوري (سجلات/نبضات) يحترم نافذة الـ10ث؛ والفوري يُجمَّع خلال نافذة
    // قصيرة (1.2ث) تكفي لانتهاء الحذف وإعادة الجلب قبل أن تبدأ الكتابة في الخلفية.
    const delay = immediate
      ? 0
      : Math.max(this.cloudDebounceMS, this.syncIntervalMS - sinceLast);

    this.cloudSyncScheduled = true;
    this.persistTimeout = setTimeout(() => {
      this.persistTimeout = null;
      this.cloudSyncScheduled = false;
      this.performCloudSync().catch(console.error);
    }, delay);
  }

  // ادفع التغييرات المعلّقة إلى السحابة فوراً وفي الخلفية (بلا انتظار وبلا حجب).
  // يُستدعى بعد إرسال الرد مباشرة (res 'finish') ليبقى الزمن بين التعديل ودوام
  // السحابة أقل ما يمكن، دون أن يدفع المستخدم ثمن دورة سحابية في كل عملية.
  public flushCloudSoon() {
    if (!dbFS || firestoreQuotaExceeded || !this.pendingFSSync) return;
    if (this.isSyncingFS || this.cloudSyncScheduled) return; // جارية/مجدولة بالفعل
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
      this.persistTimeout = null;
    }
    this.cloudSyncScheduled = true;
    setImmediate(() => {
      this.cloudSyncScheduled = false;
      this.performCloudSync().catch(console.error);
    });
  }

  // حفظ سحابي آمن ضد تعدد نسخ التشغيل: نقرأ أحدث نسخة من Firestore داخل
  // transaction ثم ندمج التغييرات المحلية فوقها بدلاً من setDoc أعمى. السبب الجذري
  // لاختفاء سجلات مثل الاختبارات/المشاريع بعد ثوانٍ أن نسخة تشغيل أخرى قد تكتب
  // حالة قديمة فوق السحابة فتسقط السجل الجديد. الدمج الثلاثي يحافظ على إنشاءات
  // كل النسخ، ويحترم الحذف الصريح عندما يكون السجل موجوداً في الأساس ثم حُذف محلياً.
  private async performCloudSync() {
    if (!this.pendingFSSync || firestoreQuotaExceeded || !dbFS) return;
    if (this.isSyncingFS) return; // كتابة جارية؛ كتلة finally ستعيد الجدولة

    let resolver!: () => void;
    let rejecter!: (err: any) => void;
    this.syncPromise = new Promise((resolve, reject) => {
      resolver = resolve;
      rejecter = reject;
    });
    this.pendingFSSync = false;
    this.isSyncingFS = true;
    this.lastFSSyncTime = Date.now();
    const versionAtStart = this.mutationVersion;
    const baseAtStart = cloneDbValue(this.lastSyncedState || this.data || {});
    const localAtStart = cleanUndefined(cloneDbValue(this.data)) as DatabaseState;

    try {
      let committedPayload: DatabaseState | null = null;

      // ⚡ المسار السريع: كانت كل حفظة تقرأ القاعدة كاملة من السحابة (كل مفاتيح
      // الكيانات وأجزائها) لمجرّد الدمج الثلاثي — أكبر كلفة زمن/حصة في النظام
      // كله. الآن نقرأ وثيقة الميتا الصغيرة وحدها: إن طابق طابعها آخر كتابة لنا
      // أو آخر لقطة طبّقها المستمع، فالسحابة لم تتغيّر منذ آخر تكامل و
      // lastSyncedState يمثّلها تماماً — نكتب الفروق مباشرة بلا قراءة ولا دمج.
      // أي وضع آخر (تغيير خارجي، ميتا قديمة بلا عدّادات، صيغة v2) يسقط تلقائياً
      // للمسار الكامل القديم بنفس ضماناته حرفياً.
      const metaSnap = await this.cloudDatabaseMetaRef().get();
      const metaRaw = metaSnap.exists ? (metaSnap.data() as any) : null;
      const localHasContent = databaseHasMeaningfulContent(localAtStart);
      const metaCounts = metaRaw?.contentCounts;
      const metaCloudHasContent =
        metaCounts && typeof metaCounts === "object"
          ? Object.values(metaCounts).some((n: any) => Number(n) > 0)
          : null;
      const metaStamp = Number(metaRaw?.lastUpdated || 0);
      const cloudUnchangedSinceLastIntegration =
        !!metaRaw &&
        metaStamp > 0 &&
        (metaStamp === this.lastWrittenUpdatedAt ||
          metaStamp === this.lastListenerAppliedStamp);

      let cloudRead: { exists: boolean; state: DatabaseState | null };
      if (
        metaRaw &&
        metaCloudHasContent === true &&
        localHasContent &&
        cloudUnchangedSinceLastIntegration &&
        this.isEntityCloudMeta(metaRaw)
      ) {
        cloudRead = { exists: true, state: null }; // state=null ⇒ مسار سريع
      } else {
        const fullRead = await this.readCloudDatabaseState();
        cloudRead = { exists: fullRead.exists, state: fullRead.state };
      }
      const cloudState =
        cloudRead.state ?? this.databaseStateFromCloud({});
      const cloudHasContent =
        cloudRead.state === null
          ? true
          : databaseHasMeaningfulContent(cloudState);

      if (cloudRead.state === null) {
        // ⚡ المسار السريع: فروق مباشرة ضد آخر حالة متزامنة (= السحابة الفعلية).
        committedPayload = cleanUndefined(localAtStart) as DatabaseState;
        committedPayload.lastUpdated = Math.max(
          Date.now(),
          Number(localAtStart.lastUpdated || 0),
        );
        await this.writeCloudDatabaseState(
          committedPayload,
          baseAtStart as DatabaseState,
        );
        this.unlockDatabaseGuard();
      } else if (!cloudHasContent && !localHasContent && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
        this.lockDatabaseGuard(
          cloudRead.exists
            ? "Blocked writing an empty runtime over an existing but empty Firestore system/database document."
            : "Blocked empty write to missing Firestore system/database. Restore backup or explicitly enable empty initialization for a new installation.",
        );
        committedPayload = null;
      } else if (!cloudHasContent && localAtStart && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
        this.lockDatabaseGuard(
          cloudRead.exists
            ? "Blocked local cache from overwriting an existing empty Firestore database document without explicit restore approval."
            : "Blocked local cache from creating a missing Firestore database document without explicit restore approval.",
        );
        committedPayload = null;
      } else if (!cloudHasContent && localHasContent && MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
        committedPayload = cleanUndefined(localAtStart) as DatabaseState;
        await this.writeCloudDatabaseState(committedPayload);
        this.unlockDatabaseGuard();
      } else if (!localHasContent && cloudHasContent) {
        committedPayload = cloudState;
        this.unlockDatabaseGuard();
      } else {
        const merged = mergeCloudThreeWay(
          baseAtStart,
          localAtStart,
          cloudState,
        ) as DatabaseState;
        merged.lastUpdated = Math.max(
          Date.now(),
          Number(merged.lastUpdated || 0),
          Number(localAtStart.lastUpdated || 0),
          Number(cloudState.lastUpdated || 0),
        );
        committedPayload = cleanUndefined(merged) as DatabaseState;
        // baseAtStart = آخر حالة كانت متزامنة فعلاً قبل هذه الدورة؛ مقارنة الناتج
        // المدموج بها هي ما يسمح بكتابة المفاتيح المتغيّرة فقط (مثال: تسليم واحد)
        // بدل قاعدة البيانات كاملة في كل مزامنة.
        await this.writeCloudDatabaseState(committedPayload, baseAtStart as DatabaseState);
        this.unlockDatabaseGuard();
      }

      if (committedPayload) {
        const committedState = this.databaseStateFromCloud(committedPayload);
        const mutationsArrivedDuringSync =
          this.mutationVersion !== versionAtStart;
        // لا تستبدل الذاكرة بنتيجة الرفع إذا وصلت تعديلات محلية أثناء انتظاره.
        // كان الاستبدال القديم يسقط آخر تعديل (مثل مرفق ثانٍ أو مشروع نُشر
        // خلال رفع سابق)، ثم تبدو البيانات صحيحة لحظياً وتختفي بعد المزامنة.
        this.data = mutationsArrivedDuringSync
          ? (mergeCloudThreeWay(
              baseAtStart,
              this.data,
              committedState,
            ) as DatabaseState)
          : committedState;
        this.lastWrittenUpdatedAt = Number(
          committedState?.lastUpdated || 0,
        );
        this.lastSyncedState = cloneDbValue(committedState);
        this.scheduleLocalSave();
      }
      if (resolver) resolver();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      this.pendingFSSync = true; // أعد المحاولة في نافذة لاحقة
      if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("Quota limit exceeded")) {
        firestoreQuotaExceeded = true;
        firestoreQuotaExceededAt = Date.now();
        firestoreQuotaErrorDetail = errMsg;
        console.warn("⚠️ Firestore quota exceeded - Firebase sync is now suspended for this session.");
      } else {
        console.error("⚠️ Cloud Firestore sync transaction failed:", errMsg);
      }
      if (rejecter) rejecter(err);
      throw err;
    } finally {
      this.isSyncingFS = false;
      this.syncPromise = null;
      // طرأ تعديل أثناء الكتابة؟ ادفعه في نافذة تجميع تالية.
      if (this.mutationVersion !== versionAtStart) this.pendingFSSync = true;
      if (
        this.pendingFSSync &&
        !this.persistTimeout &&
        !this.cloudSyncScheduled &&
        !firestoreQuotaExceeded
      ) {
        this.scheduleCloudSync(false);
      }
    }
  }

  // Getters
  public async createSubmissionAttachmentResumableUpload(record: {
    fileId: string;
    originalName: string;
    mimeType: string;
    size: number;
    origin: string;
  }): Promise<string | null> {
    if (!dbBucket) return null;
    const fileId = String(record?.fileId || "").trim();
    if (!fileId) return null;
    try {
      const [uri] = await dbBucket
        .file(`submission-attachments/${fileId}`)
        .createResumableUpload({
          origin: String(record.origin || ""),
          metadata: {
            contentType: String(record.mimeType || "application/octet-stream"),
            metadata: {
              originalName: String(record.originalName || "attachment"),
              storedName: fileId,
              size: String(Number(record.size || 0)),
            },
          },
        });
      return String(uri || "") || null;
    } catch (error) {
      console.warn(
        "⚠️ Could not create resumable attachment upload:",
        (error as any)?.message || error,
      );
      return null;
    }
  }

  public async confirmSubmissionAttachmentResumableUpload(record: {
    fileId: string;
    expectedSize: number;
  }): Promise<{ size: number; mimeType: string; originalName: string } | null> {
    if (!dbBucket) return null;
    const fileId = String(record?.fileId || "").trim();
    if (!fileId) return null;
    try {
      const gcsFile = dbBucket.file(`submission-attachments/${fileId}`);
      const [exists] = await gcsFile.exists();
      if (!exists) return null;
      const [metadata] = await gcsFile.getMetadata();
      const size = Number((metadata as any)?.size || 0);
      const expectedSize = Number(record.expectedSize || 0);
      if (!size || (expectedSize > 0 && size !== expectedSize)) return null;
      const custom = (metadata as any)?.metadata || {};
      return {
        size,
        mimeType: String(
          (metadata as any)?.contentType || "application/octet-stream",
        ),
        originalName: String(custom.originalName || "attachment"),
      };
    } catch (error) {
      console.warn(
        "⚠️ Could not confirm resumable attachment upload:",
        (error as any)?.message || error,
      );
      return null;
    }
  }

  public async saveSubmissionAttachmentArchive(record: {
    fileId: string;
    originalName?: string;
    mimeType?: string;
    size?: number;
    storedName?: string;
    base64?: string;
    // مسار ملف على القرص: يتيح البثّ المباشر قرص→Cloud Storage بلا أي نسخة في
    // الذاكرة. جذر "رفع ٢١م.ب يفشل": الملف كان يتنسّخ ~٦ مرات في الذاكرة (بافر
    // الرفع + القرص + نص base64 ٢٧م.ب + أرشيف JSON محلي + Buffer جديد) فتنفجر
    // ذاكرة الحاوية ويقتلها Cloud Run (سجل OOM حرفي: "using too much memory and
    // was terminated") — يرى الطالب 503 رغم أن الحفظ السحابي أكمل ونجح بعدها.
    filePath?: string;
  }): Promise<boolean> {
    const fileId = String(record?.fileId || "").trim();
    let base64 = String(record?.base64 || "");
    const srcPath = String(record?.filePath || "");
    if (!fileId || (!base64 && !srcPath)) return false;

    // أرشيف محلي خفيف بجانب قاعدة البيانات: يفيد في التشغيل المحلي أو الخادم
    // ذي قرص دائم، ولا يعتمد عليه وحده في الإنتاج. حين يصلنا مسار قرص (ملفات
    // كبيرة) لا نبني نصّ base64 ضخماً — الملف الخام محفوظ أصلاً في uploads/.
    if (base64) {
      try {
        const archiveDir = path.join(DATA_DIR, "submission-attachment-archive");
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
        fs.writeFileSync(
          path.join(archiveDir, `${fileId}.json`),
          JSON.stringify({
            fileId,
            originalName: record.originalName || "attachment",
            mimeType: record.mimeType || "application/octet-stream",
            size: Number(record.size || 0),
            storedName: record.storedName || "",
            base64,
            updatedAt: new Date().toISOString(),
          }),
        );
      } catch (err) {
        console.warn("⚠️ Failed to write local submission attachment archive:", err);
      }
    }

    // في بيئات Firebase/Cloud Run قد يختفي ملف data/uploads بعد تدوير الحاوية.
    // لذلك نحفظ نسخة سحابية مجزأة خارج وثيقة database الرئيسية حتى لا نصطدم
    // بحد حجم وثيقة Firestore عند رفع PDF/Word كبير.
    //
    // جذر مشكلة اختفاء المرفقات (خصوصاً PDF/Word) بعد دقائق: هذه الدالة كانت
    // تُرجع true (نجاح) حتى عندما تفشل كتابة النسخة السحابية فعلياً — فيظهر
    // الرفع "ناجحاً" بينما الملف موجود فقط على قرص الحاوية المؤقت، ويختفي
    // بصمت تامة عند أول إعادة تدوير للحاوية (قد تحدث خلال نصف ساعة إلى ساعة).
    // الصور كانت تنجو لأنها غالباً تحت حد التضمين المباشر داخل سجل التسليم
    // نفسه (المُزامَن بشكل متكرر وموثوق)، بعكس أي ملف أكبر كان يعتمد فقط على
    // هذا المسار الذي يفشل بصمت بلا أي إعادة محاولة.
    // المسار الصاروخي: Cloud Storage — رفع الملف الخام بكتابة واحدة (ثوانٍ لملف
    // ٢٤م.ب) بدل عشرات وثائق base64 على Firestore التي كانت تنتهي بمهلة وفشل.
    // Firestore يبقى احتياطاً كاملاً إن تعذّر Storage لأي سبب.
    if (dbBucket) {
      try {
        const sizeBytes = Number(record.size || 0) ||
          (srcPath ? (() => { try { return fs.statSync(srcPath).size; } catch { return 0; } })() : Math.round(base64.length * 0.75));
        const gcsMeta = {
          contentType: record.mimeType || "application/octet-stream",
          metadata: {
            metadata: {
              originalName: record.originalName || "attachment",
              storedName: record.storedName || "",
              size: String(sizeBytes),
            },
          },
        };
        await Promise.race([
          srcPath
            ? // بثّ مباشر من القرص (bucket.upload يبثّ بمقاطع صغيرة): ذروة الذاكرة
              // شبه صفرية مهما كبر الملف — لا base64 ولا Buffer كامل إطلاقاً.
              dbBucket.upload(srcPath, {
                destination: `submission-attachments/${fileId}`,
                // رفع مباشر بطلب واحد حتى ٣٢م.ب (حدّنا ٥٠م.ب): البروتوكول
                // القابل للاستئناف يضيف رحلات HTTP إضافية تبطئ الملفات المتوسطة.
                resumable: sizeBytes > 32 * 1024 * 1024,
                ...gcsMeta,
              })
            : dbBucket
                .file(`submission-attachments/${fileId}`)
                .save(Buffer.from(base64, "base64"), {
                  resumable: base64.length > 10 * 1024 * 1024,
                  ...gcsMeta,
                }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("gcs-save-timeout")), 45_000),
          ),
        ]);
        console.log(
          `🪣 attachment ${fileId} ${srcPath ? "streamed" : "saved"} to Cloud Storage (${Math.round(sizeBytes / 1024)}KB)`,
        );
        return true;
      } catch (gcsErr: any) {
        console.warn(
          "⚠️ Cloud Storage attachment save failed, falling back to Firestore:",
          gcsErr?.message || gcsErr,
        );
      }
    }

    if (!dbFS) return true;
    // احتياط Firestore يحتاج base64: نبنيه هنا فقط (مسار نادر — Storage تعطّل
    // وFirestore متاح) حتى لا يدفع المسار السعيد كلفة الذاكرة أبداً.
    if (!base64 && srcPath) {
      try {
        base64 = fs.readFileSync(srcPath).toString("base64");
      } catch (readErr) {
        console.warn("⚠️ Could not read attachment file for Firestore fallback:", readErr);
        return false;
      }
    }
    if (firestoreQuotaExceeded) return false; // لا فائدة من محاولة محكوم عليها بالفشل؛ صدق فوري بدل انتظار عبثي
    const chunkSize = 700_000;
    const chunks: string[] = [];
    for (let i = 0; i < base64.length; i += chunkSize) {
      chunks.push(base64.slice(i, i + chunkSize));
    }
    const retryDelaysMs = [0, 500, 1500];
    let lastErr: any = null;
    // سقف زمني لكل محاولة كاملة: التزام gRPC معلّق قد يبقى دقيقة كاملة قبل أن
    // يفشل، و٣ محاولات كانت تتراكم لأكثر من ٤ دقائق من "الدوران" قبل ظهور الخطأ
    // للطالب. الآن أي محاولة تتجاوز ٢٥ث تُعدّ فاشلة فوراً وننتقل للتالية — فإما
    // نجاح سريع أو فشل سريع وواضح، لا انتظار عبثي.
    const withAttemptTimeout = <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error("archive-attempt-timeout")), 25_000),
        ),
      ]);
    for (const delay of retryDelaysMs) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await withAttemptTimeout(
          (async () => {
            await dbFS.doc(`submissionAttachments/${fileId}`).set(cleanUndefined({
              fileId,
              originalName: record.originalName || "attachment",
              mimeType: record.mimeType || "application/octet-stream",
              size: Number(record.size || 0),
              storedName: record.storedName || "",
              chunkCount: chunks.length,
              chunkSize,
              updatedAt: new Date().toISOString(),
            }));
            // كتابة الأجزاء عبر دفعات Firestore: نُبقي كل دفعة ≤ ~٢.٨م.ب (٤ أجزاء)
            // بعيداً تماماً عن حدود gRPC/الطلب (~٤م.ب رسالة، ١٠م.ب طلب) — الدفعات
            // الأكبر (٨.٥م.ب سابقاً) كانت ترتد بأخطاء بطيئة فيتكرر الفشل ويطول
            // الدوران. ملف ٢٤م.ب ≈ ١٢ التزاماً متتابعاً سريعاً (ثوانٍ قليلة).
            let batch = dbFS.batch();
            let batchBytes = 0;
            let batchCount = 0;
            for (let index = 0; index < chunks.length; index += 1) {
              const data = chunks[index];
              if (
                batchCount >= 400 ||
                (batchBytes + data.length > 2_800_000 && batchCount > 0)
              ) {
                await batch.commit();
                batch = dbFS.batch();
                batchBytes = 0;
                batchCount = 0;
              }
              batch.set(
                dbFS.doc(`submissionAttachments/${fileId}/chunks/${index}`),
                { index, data },
              );
              batchBytes += data.length;
              batchCount += 1;
            }
            if (batchCount > 0) await batch.commit();
          })(),
        );
        return true;
      } catch (err) {
        lastErr = err;
      }
    }
    console.warn(
      "⚠️ Failed to write cloud submission attachment archive after retries:",
      lastErr?.message || lastErr,
    );
    return false;
  }

  public async getSubmissionAttachmentArchive(fileIdValue: string): Promise<{
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  } | null> {
    const fileId = String(fileIdValue || "").trim();
    if (!fileId) return null;

    try {
      const archivePath = path.join(DATA_DIR, "submission-attachment-archive", `${fileId}.json`);
      if (fs.existsSync(archivePath)) {
        const parsed = JSON.parse(fs.readFileSync(archivePath, "utf-8"));
        const base64 = String(parsed?.base64 || "");
        if (base64) {
          return {
            buffer: Buffer.from(base64, "base64"),
            originalName: String(parsed?.originalName || parsed?.storedName || "attachment"),
            mimeType: String(parsed?.mimeType || "application/octet-stream"),
          };
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to read local submission attachment archive:", err);
    }

    // Cloud Storage (المسار الأساسي للملفات الجديدة) قبل احتياط Firestore المجزّأ.
    if (dbBucket) {
      try {
        const gcsFile = dbBucket.file(`submission-attachments/${fileId}`);
        const [exists] = await gcsFile.exists();
        if (exists) {
          const [buffer] = await gcsFile.download();
          const [meta] = await gcsFile.getMetadata().catch(() => [{} as any]);
          const custom = (meta as any)?.metadata || {};
          return {
            buffer,
            originalName: String(custom.originalName || "attachment"),
            mimeType: String(
              (meta as any)?.contentType || "application/octet-stream",
            ),
          };
        }
      } catch (err) {
        console.warn("⚠️ Failed to read Cloud Storage attachment:", err);
      }
    }

    if (!dbFS) return null;
    try {
      const metaSnap = await dbFS.doc(`submissionAttachments/${fileId}`).get();
      if (!metaSnap.exists) return null;
      const meta = metaSnap.data() as any;
      const chunkCount = Math.max(0, Number(meta?.chunkCount || 0));
      if (!chunkCount) return null;
      const chunkSnaps = await Promise.all(
        Array.from({ length: chunkCount }, (_, index) =>
          dbFS.doc(`submissionAttachments/${fileId}/chunks/${index}`).get(),
        ),
      );
      const base64 = chunkSnaps
        .map((snap) => (snap.exists ? String((snap.data() as any)?.data || "") : ""))
        .join("");
      if (!base64) return null;
      return {
        buffer: Buffer.from(base64, "base64"),
        originalName: String(meta?.originalName || meta?.storedName || "attachment"),
        mimeType: String(meta?.mimeType || "application/octet-stream"),
      };
    } catch (err) {
      console.warn("⚠️ Failed to read cloud submission attachment archive:", err);
      return null;
    }
  }

  // ── كاش PDF الدائم للمستندات المحوّلة (طبقة L2) ────────────────────────────
  // جذر بطء عرض المستندات (فوق ٤٥ث مع ١٠٠ طالب): كان كل فتح لملف
  // PowerPoint/Word يعيد تحويله عبر LibreOffice، وكاش التحويل في /tmp إفيميرال
  // يُمحى مع كل تدوير حاوية Cloud Run ولا يُشارَك بين النسخ — فيُعاد التحويل
  // شبه كل مرة. هنا نخزّن ناتج التحويل (PDF) مرة واحدة بشكل دائم في Firestore
  // (نفس آلية التجزئة المستخدمة للمرفقات، بمجموعة منفصلة)، مع نسخة L1 محلية في
  // مجلد مؤقّت للقراءات المتكررة داخل النسخة نفسها. فيصبح كل عرض لاحق (من أي
  // معلم/أي نسخة حاوية/بعد أي تدوير) تقديماً فورياً لـ PDF جاهز بلا تحويل.
  private convertedPdfCacheDir(): string {
    return path.join(os.tmpdir(), "miras-converted-pdf-cache");
  }

  public async saveConvertedPdfArchive(
    fileIdValue: string,
    pdfBuffer: Buffer,
  ): Promise<boolean> {
    const fileId = String(fileIdValue || "").trim();
    if (!fileId || !pdfBuffer?.length) return false;

    // نسخة L1 محلية سريعة (مجلد مؤقّت قابل للكتابة على Cloud Run والمحلي معاً).
    try {
      const dir = this.convertedPdfCacheDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${fileId}.pdf`), pdfBuffer);
    } catch (err) {
      console.warn("⚠️ Failed to write local converted-pdf cache:", err);
    }

    if (!dbFS) return true;
    if (firestoreQuotaExceeded) return false;
    // المسار الصاروخي: Cloud Storage — كتابة واحدة للـPDF الخام (معاينة المعلم
    // للملفات الكبيرة تصبح ثوانيَ). Firestore يبقى احتياطاً كاملاً.
    if (dbBucket) {
      try {
        await Promise.race([
          dbBucket.file(`converted-pdfs/${fileId}.pdf`).save(pdfBuffer, {
            resumable: pdfBuffer.length > 8 * 1024 * 1024,
            contentType: "application/pdf",
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("gcs-pdf-timeout")), 30_000),
          ),
        ]);
        return true;
      } catch (gcsErr: any) {
        console.warn(
          "⚠️ Cloud Storage converted-pdf save failed, falling back to Firestore:",
          gcsErr?.message || gcsErr,
        );
      }
    }
    const base64 = pdfBuffer.toString("base64");
    const chunkSize = 650_000;
    const chunks: string[] = [];
    for (let i = 0; i < base64.length; i += chunkSize) {
      chunks.push(base64.slice(i, i + chunkSize));
    }
    try {
      await dbFS.doc(`submissionAttachmentPdfs/${fileId}`).set(cleanUndefined({
        fileId,
        chunkCount: chunks.length,
        chunkSize,
        size: pdfBuffer.length,
        updatedAt: new Date().toISOString(),
      }));
      await Promise.all(
        chunks.map((data, index) =>
          dbFS.doc(`submissionAttachmentPdfs/${fileId}/chunks/${index}`).set({
            index,
            data,
          }),
        ),
      );
      return true;
    } catch (err) {
      console.warn(
        "⚠️ Failed to write cloud converted-pdf cache:",
        (err as any)?.message || err,
      );
      return false;
    }
  }

  public async getConvertedPdfArchive(
    fileIdValue: string,
  ): Promise<Buffer | null> {
    const fileId = String(fileIdValue || "").trim();
    if (!fileId) return null;

    // L1: نسخة محلية في هذه النسخة الحاوية (فورية بلا أي شبكة).
    try {
      const localPath = path.join(this.convertedPdfCacheDir(), `${fileId}.pdf`);
      if (fs.existsSync(localPath)) {
        const buf = fs.readFileSync(localPath);
        if (buf?.length) return buf;
      }
    } catch (err) {
      console.warn("⚠️ Failed to read local converted-pdf cache:", err);
    }

    // L2: نسخة Cloud Storage (الأساسية للملفات الجديدة — تنزيل واحد سريع).
    if (dbBucket) {
      try {
        const gcsFile = dbBucket.file(`converted-pdfs/${fileId}.pdf`);
        const [exists] = await gcsFile.exists();
        if (exists) {
          const [buf] = await gcsFile.download();
          if (buf?.length) {
            // ادفأ الكاش المحلي لهذه النسخة حتى تكون الفتحات التالية فورية.
            try {
              fs.writeFileSync(
                path.join(this.convertedPdfCacheDir(), `${fileId}.pdf`),
                buf,
              );
            } catch {}
            return buf;
          }
        }
      } catch (err) {
        console.warn("⚠️ Failed to read Cloud Storage converted-pdf:", err);
      }
    }

    // L3: نسخة Firestore الدائمة (احتياط للملفات القديمة المخزّنة مجزّأة).
    if (!dbFS) return null;
    try {
      const metaSnap = await dbFS
        .doc(`submissionAttachmentPdfs/${fileId}`)
        .get();
      if (!metaSnap.exists) return null;
      const meta = metaSnap.data() as any;
      const chunkCount = Math.max(0, Number(meta?.chunkCount || 0));
      if (!chunkCount) return null;
      const chunkSnaps = await Promise.all(
        Array.from({ length: chunkCount }, (_, index) =>
          dbFS.doc(`submissionAttachmentPdfs/${fileId}/chunks/${index}`).get(),
        ),
      );
      const base64 = chunkSnaps
        .map((snap) =>
          snap.exists ? String((snap.data() as any)?.data || "") : "",
        )
        .join("");
      if (!base64) return null;
      const buf = Buffer.from(base64, "base64");
      // نحفظ نسخة L1 محلية حتى تكون القراءات التالية على هذه الحاوية فورية.
      try {
        const dir = this.convertedPdfCacheDir();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${fileId}.pdf`), buf);
      } catch {}
      return buf;
    } catch (err) {
      console.warn(
        "⚠️ Failed to read cloud converted-pdf cache:",
        (err as any)?.message || err,
      );
      return null;
    }
  }

  public getStudents(): Student[] { return this.data.students; }
  public getTeachers(): Teacher[] { 
    if (!this.data.teachers) this.data.teachers = [...initialTeachers];
    else {
      let isDirty = false;
      // Ensure initial teachers and hardcoded keys are present/updated
      for (const it of initialTeachers) {
        const existing = this.data.teachers.find(t => t.id.toLowerCase() === it.id.toLowerCase() || t.email.toLowerCase() === it.email.toLowerCase());
        if (!existing) {
          this.data.teachers.push(it);
          isDirty = true;
        } else {
          // لا نعيد كلمة مرور الأستاذ للقيمة المبدئية في كل قراءة. كان هذا
          // ينسخ الهاش الثابت فوق أي كلمة مرور صحيحة مخزنة في السحابة، فتظهر
          // رسالة "بيانات الأستاذ غير صحيحة" رغم أن المدخلات صحيحة.
          if (!existing.passwordHash && it.passwordHash) {
            existing.passwordHash = it.passwordHash;
            isDirty = true;
          }
          if (existing.name !== it.name) {
            existing.name = it.name;
            isDirty = true;
          }
        }
      }
      if (isDirty) this.persist(false);
    }
    return this.data.teachers; 
  }
  public getSections(): Section[] { return this.data.sections; }
  public getChapters(): TextbookChapter[] { return this.data.chapters; }
  public getQuestionBank(): Question[] { return this.data.questionBank; }
  public getExercises(): WeeklyExercise[] { return this.data.exercises; }
  public getExerciseSubmissions(): ExerciseSubmission[] { return this.data.exerciseSubmissions; }
  public getPersonalizedProjects(): PersonalizedProject[] { return this.data.personalizedProjects; }
  public getQuizSubmissions(): QuizSubmission[] { return this.data.quizSubmissions; }
  public getActivityLogs(): ActivityLog[] { return this.data.activityLogs; }
  public getAllowedStudents(): AllowedStudent[] { return this.data.allowedStudents; }
  public getOtps() { return this.data.otps; }
  public getBookMetadata() { return this.data.bookMetadata; }
  public getActivationAttempts(): ActivationAttempt[] {
    if (!this.data.activationAttempts) this.data.activationAttempts = [];
    return this.data.activationAttempts;
  }
  public getNotificationTokens(): NotificationToken[] {
    if (!this.data.notificationTokens) this.data.notificationTokens = [];
    return this.data.notificationTokens;
  }
  public getPasskeyCredentials(): PasskeyCredentialRecord[] {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    return this.data.passkeyCredentials;
  }
  public upsertPasskeyCredential(record: PasskeyCredentialRecord) {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    const idx = this.data.passkeyCredentials.findIndex(item => item.credentialId === record.credentialId);
    if (idx === -1) this.data.passkeyCredentials.unshift(record);
    else this.data.passkeyCredentials[idx] = { ...this.data.passkeyCredentials[idx], ...record, updatedAt: new Date().toISOString() };
    this.persist();
  }
  public updatePasskeyCredential(credentialId: string, patch: Partial<PasskeyCredentialRecord>) {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    const idx = this.data.passkeyCredentials.findIndex(item => item.credentialId === credentialId);
    if (idx !== -1) {
      this.data.passkeyCredentials[idx] = { ...this.data.passkeyCredentials[idx], ...patch, updatedAt: new Date().toISOString() };
      this.persist();
    }
  }
  public deletePasskeyCredential(credentialId: string): boolean {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    const before = this.data.passkeyCredentials.length;
    this.data.passkeyCredentials = this.data.passkeyCredentials.filter(item => item.credentialId !== credentialId);
    const changed = this.data.passkeyCredentials.length !== before;
    if (changed) this.persist();
    return changed;
  }
  public getTeacherExams(): TeacherExam[] {
    if (!this.data.teacherExams) this.data.teacherExams = [];
    return this.data.teacherExams;
  }
  public getTeacherProjects(): any[] {
    if (!this.data.teacherProjects) this.data.teacherProjects = [];
    return this.data.teacherProjects;
  }
  public getTeacherSubmissions(): any[] {
    if (!this.data.teacherSubmissions) this.data.teacherSubmissions = [];
    return this.data.teacherSubmissions;
  }
  public getSebAttempts(): any[] {
    if (!this.data.sebAttempts) this.data.sebAttempts = [];
    return this.data.sebAttempts;
  }
  public getExamSessions(): ExamSession[] {
    if (!this.data.examSessions) this.data.examSessions = [];
    return this.data.examSessions;
  }
  public getPasswordResetRequests(): PasswordResetRequest[] {
    if (!this.data.passwordResetRequests) this.data.passwordResetRequests = [];
    const now = Date.now();
    let changed = false;
    this.data.passwordResetRequests = this.data.passwordResetRequests.map((req) => {
      if (req.status === "new" && new Date(req.expiresAt).getTime() <= now) {
        changed = true;
        return { ...req, status: "expired" };
      }
      return req;
    });
    if (changed) this.persist();
    return this.data.passwordResetRequests;
  }
  public getJoinCodes(): JoinCode[] {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    return this.data.joinCodes;
  }

  public getRetiredJoinCodes(): JoinCode[] {
    if (!this.data.retiredJoinCodes) this.data.retiredJoinCodes = [];
    return this.data.retiredJoinCodes;
  }

  public archiveJoinCodeRecord(item: any, reason = "course_closed", actorEmail = "system"): boolean {
    if (!item || typeof item !== "object") return false;
    if (!this.data.retiredJoinCodes) this.data.retiredJoinCodes = [];
    const key = String(item?.code || "").trim().toUpperCase();
    if (!key) return false;
    const now = new Date().toISOString();
    const archiveMap = new Map<string, JoinCode>();
    this.data.retiredJoinCodes.forEach((existing: any) => {
      const existingKey = String(existing?.code || "").trim().toUpperCase();
      if (existingKey) archiveMap.set(existingKey, existing);
    });
    const archivedItem = {
      ...item,
      status: String(item?.status || "").toLowerCase() === "active" ? "retired" : (item?.status || "retired"),
      retiredAt: item?.retiredAt || now,
      retiredReason: item?.retiredReason || reason,
      retiredByEmail: item?.retiredByEmail || actorEmail,
      archivedAt: item?.archivedAt || now,
    } as JoinCode;
    const isNew = !archiveMap.has(key);
    archiveMap.set(key, { ...(archiveMap.get(key) || {}), ...archivedItem });
    this.data.retiredJoinCodes = Array.from(archiveMap.values());
    return isNew;
  }

  public archiveJoinCodes(reason = "course_closed", actorEmail = "system"): number {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    let archived = 0;
    this.data.joinCodes.forEach((item: any) => {
      if (this.archiveJoinCodeRecord(item, reason, actorEmail)) archived += 1;
    });
    return archived;
  }

  public exportStateSnapshot(): DatabaseState {
    return JSON.parse(JSON.stringify(this.data));
  }

  public mergeBackupData(data: any = {}) {
    const summary: Record<string, number> = {};
    const normalizeKey = (value: any) => String(value ?? "").trim().toLowerCase();
    const stableKey = (item: any, keys: string[], fallbackPrefix: string, index: number) => {
      for (const key of keys) {
        const value = normalizeKey(item?.[key]);
        if (value) return value;
      }
      return `${fallbackPrefix}-${Date.now()}-${index}`;
    };
    const mergeArray = <T extends Record<string, any>>(
      target: T[],
      incoming: any,
      keys: string[],
      label: string,
    ): T[] => {
      if (!Array.isArray(incoming)) return target;
      const map = new Map<string, T>();
      target.forEach((item: T, index: number) => map.set(stableKey(item, keys, label, index), item));
      incoming.filter((item: any) => item && typeof item === "object").forEach((item: T, index: number) => {
        const key = stableKey(item, keys, label, index);
        map.set(key, { ...(map.get(key) || {}), ...item });
      });
      summary[label] = incoming.length;
      return Array.from(map.values());
    };

    this.data.sections = mergeArray(this.data.sections, data.teacherSections || data.sections, ["code"], "teacherSections") as Section[];
    this.data.students = mergeArray(this.data.students, data.teacherStudents || data.students, ["id", "idNumber", "studentId"], "teacherStudents") as Student[];
    this.data.allowedStudents = mergeArray(this.data.allowedStudents, data.allowedStudentsRows || data.allowedStudents, ["idNumber", "id", "studentId"], "allowedStudents") as AllowedStudent[];
    this.data.questionBank = mergeArray(this.data.questionBank, data.teacherQuestions || data.questionBank, ["id"], "teacherQuestions") as Question[];
    this.data.teacherExams = mergeArray(this.getTeacherExams(), data.teacherCreatedExams || data.teacherExams, ["id"], "teacherCreatedExams") as TeacherExam[];
    this.data.teacherProjects = mergeArray(this.getTeacherProjects(), data.teacherProjects, ["id"], "teacherProjects");
    this.data.teacherSubmissions = mergeArray(this.getTeacherSubmissions(), data.teacherSubmissions, ["id", "submissionId"], "teacherSubmissions");
    this.data.examSessions = mergeArray(this.getExamSessions(), data.examSessions, ["id", "sessionId"], "examSessions") as ExamSession[];
    this.data.joinCodes = mergeArray(this.getJoinCodes(), data.joinCodesList || data.joinCodes, ["code"], "joinCodesList") as JoinCode[];
    this.data.retiredJoinCodes = mergeArray(this.getRetiredJoinCodes(), data.retiredJoinCodes || data.archivedJoinCodes || data.codeArchive, ["code"], "retiredJoinCodes") as JoinCode[];
    this.data.activityLogs = mergeArray(this.data.activityLogs, data.systemLogs || data.activityLogs, ["id", "timestamp"], "systemLogs") as ActivityLog[];
    this.data.passwordResetRequests = mergeArray(this.getPasswordResetRequests(), data.passwordResetRequestsState || data.passwordResetRequests, ["id"], "passwordResetRequestsState") as PasswordResetRequest[];
    this.persist();
    return summary;
  }

  public addJoinCode(jc: JoinCode) {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    this.data.joinCodes.push(jc);
    this.persist();
  }

  public updateJoinCode(code: string, updated: Partial<JoinCode>) {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    const idx = this.data.joinCodes.findIndex(j => j.code.toUpperCase() === code.toUpperCase());
    if (idx !== -1) {
      this.data.joinCodes[idx] = { ...this.data.joinCodes[idx], ...updated };
      this.persist();
    }
  }



  public compareAndUseJoinCode(code: string, patch: Partial<JoinCode>) {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    const idx = this.data.joinCodes.findIndex(j => String(j.code || "").toUpperCase() === String(code || "").toUpperCase());
    if (idx === -1) return { ok: false, reason: "not_found", current: null as any };
    const current = this.data.joinCodes[idx] as any;
    if (String(current.status || "active").toLowerCase() !== "active") {
      return { ok: false, reason: "not_active", current };
    }
    this.data.joinCodes[idx] = { ...current, ...patch, status: "used" as any };
    this.persist();
    return { ok: true, current: this.data.joinCodes[idx] };
  }

  public deleteJoinCode(code: string, reason = "manual_code_delete", actorEmail = "system") {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    const normalizedCode = String(code || "").toUpperCase();
    const found = this.data.joinCodes.find(j => String(j.code || "").toUpperCase() === normalizedCode);
    if (found) this.archiveJoinCodeRecord(found, reason, actorEmail);
    this.data.joinCodes = this.data.joinCodes.filter(j => String(j.code || "").toUpperCase() !== normalizedCode);
    this.persist();
  }

  public upsertTeacherExam(exam: TeacherExam) {
    if (!this.data.teacherExams) this.data.teacherExams = [];
    const idx = this.data.teacherExams.findIndex(e => e.id === exam.id);
    if (idx === -1) this.data.teacherExams.unshift(exam);
    else this.data.teacherExams[idx] = { ...this.data.teacherExams[idx], ...exam };
    this.persist();
  }

  public deleteTeacherExam(id: string) {
    if (!this.data.teacherExams) this.data.teacherExams = [];
    this.data.teacherExams = this.data.teacherExams.filter(e => e.id !== id);
    this.persist();
  }

  public setTeacherExams(exams: TeacherExam[]) {
    this.data.teacherExams = exams;
    this.persist();
  }

  public upsertTeacherProject(project: any) {
    if (!this.data.teacherProjects) this.data.teacherProjects = [];
    const idx = this.data.teacherProjects.findIndex(p => p.id === project.id);
    if (idx === -1) this.data.teacherProjects.unshift(project);
    else this.data.teacherProjects[idx] = { ...this.data.teacherProjects[idx], ...project };
    this.persist();
  }

  public deleteTeacherProject(id: string) {
    if (!this.data.teacherProjects) this.data.teacherProjects = [];
    this.data.teacherProjects = this.data.teacherProjects.filter(p => p.id !== id);
    this.persist();
  }

  public upsertTeacherSubmission(sub: any) {
    if (!this.data.teacherSubmissions) this.data.teacherSubmissions = [];
    const idx = this.data.teacherSubmissions.findIndex(s => s.id === sub.id);
    if (idx === -1) this.data.teacherSubmissions.unshift(sub);
    else this.data.teacherSubmissions[idx] = { ...this.data.teacherSubmissions[idx], ...sub };
    this.persist();
  }

  public removeTeacherSubmissionsFor(kind: string, activityId: string) {
    if (!this.data.teacherSubmissions) this.data.teacherSubmissions = [];
    const beforeLen = this.data.teacherSubmissions.length;
    this.data.teacherSubmissions = this.data.teacherSubmissions.filter(s => !(s.kind === kind && String(s.activityId) === String(activityId)));
    if (this.data.teacherSubmissions.length !== beforeLen) this.persist();
  }

  public removeQuizSubmissionsForChapter(chapterId: string) {
    if (!this.data.quizSubmissions) this.data.quizSubmissions = [];
    const beforeLen = this.data.quizSubmissions.length;
    this.data.quizSubmissions = this.data.quizSubmissions.filter(s => String(s.chapterId) !== String(chapterId));
    if (this.data.quizSubmissions.length !== beforeLen) this.persist();
  }

  public setSebAttempts(attempts: any[]) {
    this.data.sebAttempts = attempts;
    this.persist();
  }

  public upsertExamSession(session: ExamSession) {
    if (!this.data.examSessions) this.data.examSessions = [];
    const idx = this.data.examSessions.findIndex(
      item => item.id === session.id || item.sessionId === session.sessionId,
    );
    if (idx !== -1) {
      const currentStatus = String(this.data.examSessions[idx]?.status || "");
      const incomingStatus = String(session?.status || "");
      const terminalStatuses = new Set(["finished", "violated", "expired"]);
      // قد تكون نبضة heartbeat قرأت الجلسة وهي active ثم تصل عملية المخالفة
      // وتحفظ violated قبل اكتمال حفظ النبضة. لا نسمح لتلك النسخة القديمة
      // بإحياء جلسة نهائية؛ الإرجاع الرسمي ينشئ sessionId جديداً.
      if (terminalStatuses.has(currentStatus) && incomingStatus === "active") {
        return;
      }
    }
    const saved = { ...session, updatedAt: new Date().toISOString() };
    if (idx === -1) this.data.examSessions.unshift(saved);
    else this.data.examSessions[idx] = { ...this.data.examSessions[idx], ...saved };
    if (this.data.examSessions.length > 500) this.data.examSessions.length = 500;
    this.persist();
  }

  public addPasswordResetRequest(req: PasswordResetRequest) {
    if (!this.data.passwordResetRequests) this.data.passwordResetRequests = [];
    this.data.passwordResetRequests.unshift(req);
    this.persist();
  }

  public updatePasswordResetRequest(id: string, updated: Partial<PasswordResetRequest>) {
    if (!this.data.passwordResetRequests) this.data.passwordResetRequests = [];
    const index = this.data.passwordResetRequests.findIndex(req => req.id === id);
    if (index !== -1) {
      this.data.passwordResetRequests[index] = { ...this.data.passwordResetRequests[index], ...updated };
      this.persist();
    }
  }

  public deletePasswordResetRequest(id: string) {
    if (!this.data.passwordResetRequests) this.data.passwordResetRequests = [];
    this.data.passwordResetRequests = this.data.passwordResetRequests.filter(req => req.id !== id);
    this.persist();
  }

  public addActivationAttempt(attempt: ActivationAttempt) {
    if (!this.data.activationAttempts) this.data.activationAttempts = [];
    this.data.activationAttempts.unshift(attempt);
    if (this.data.activationAttempts.length > 1200) this.data.activationAttempts.length = 1200;
    this.persist();
  }

  public updateActivationAttempt(id: string, updated: Partial<ActivationAttempt> & Record<string, any>) {
    if (!this.data.activationAttempts) this.data.activationAttempts = [];
    const idx = this.data.activationAttempts.findIndex((attempt: any) => String(attempt.id || "") === String(id || ""));
    if (idx !== -1) {
      this.data.activationAttempts[idx] = { ...this.data.activationAttempts[idx], ...updated } as ActivationAttempt;
      this.persist();
    }
  }

  public upsertNotificationToken(token: NotificationToken) {
    if (!this.data.notificationTokens) this.data.notificationTokens = [];
    this.data.notificationTokens = this.data.notificationTokens.filter(existing => existing.token !== token.token);
    this.data.notificationTokens.unshift(token);
    this.persist();
  }

  public disableNotificationToken(token: string, userId?: string) {
    if (!this.data.notificationTokens) this.data.notificationTokens = [];
    const updatedAt = new Date().toISOString();
    this.data.notificationTokens = this.data.notificationTokens.map(item => {
      if (item.token === token && (!userId || item.userId === userId)) {
        return { ...item, disabledAt: updatedAt, updatedAt };
      }
      return item;
    });
    this.persist();
  }

  // ── رادار مِراس: تقارير الأخطاء المجمّعة ────────────────────────────────────
  public getErrorReports(): any[] {
    if (!this.data.errorReports) this.data.errorReports = [];
    return this.data.errorReports;
  }
  // تجميع على غرار Sentry: نفس التوقيع (signature) لخطأ نشط ⇒ زيادة العدّاد
  // وتحديث آخر ظهور وسياقه، بدل إغراق القائمة بمئات النسخ من نفس الخطأ.
  public recordErrorReport(report: {
    signature: string;
    message: string;
    stack?: string;
    source?: string;
    url?: string;
    role?: string;
    userId?: string;
    browser?: string;
    displayMode?: string;
    bundle?: string;
  }): void {
    if (!this.data.errorReports) this.data.errorReports = [];
    const nowIso = new Date().toISOString();
    const existing = this.data.errorReports.find(
      (item: any) =>
        String(item.signature) === report.signature && !item.resolvedAt,
    );
    if (existing) {
      existing.count = Number(existing.count || 1) + 1;
      existing.lastSeenAt = nowIso;
      existing.updatedAt = nowIso;
      if (report.url) existing.url = report.url;
      if (report.userId) existing.userId = report.userId;
      if (report.role) existing.role = report.role;
      if (report.browser) existing.browser = report.browser;
      if (report.displayMode) existing.displayMode = report.displayMode;
    } else {
      this.data.errorReports.unshift({
        id: "err-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        signature: report.signature,
        message: report.message,
        stack: report.stack || "",
        source: report.source || "client",
        url: report.url || "",
        role: report.role || "",
        userId: report.userId || "",
        browser: report.browser || "",
        displayMode: report.displayMode || "",
        bundle: report.bundle || "",
        count: 1,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        updatedAt: nowIso,
        resolvedAt: "",
      });
      // سقف ٣٠٠ تقرير: نُسقط المحلولة الأقدم أولاً ثم الأقدم مطلقاً.
      if (this.data.errorReports.length > 300) {
        const resolvedIdx = [...this.data.errorReports]
          .map((item: any, idx: number) => ({ item, idx }))
          .filter((x: any) => x.item.resolvedAt)
          .pop()?.idx;
        if (resolvedIdx !== undefined) this.data.errorReports.splice(resolvedIdx, 1);
        else this.data.errorReports.pop();
      }
    }
    this.persist(false);
  }
  public resolveErrorReport(id: string, by: string): boolean {
    const item = (this.data.errorReports || []).find(
      (r: any) => String(r.id) === String(id),
    );
    if (!item) return false;
    item.resolvedAt = new Date().toISOString();
    item.resolvedBy = by;
    item.updatedAt = item.resolvedAt;
    this.persist(false);
    return true;
  }
  public clearResolvedErrorReports(): number {
    const before = (this.data.errorReports || []).length;
    this.data.errorReports = (this.data.errorReports || []).filter(
      (r: any) => !r.resolvedAt,
    );
    const removed = before - this.data.errorReports.length;
    if (removed > 0) this.persist(false);
    return removed;
  }

  // Setters/Prunes
  public setBookMetadata(meta: any | undefined) {
    this.data.bookMetadata = meta;
    this.persist();
  }

  public setChapters(chapters: TextbookChapter[]) {
    this.data.chapters = chapters;
    this.persist();
  }

  public setQuestionBank(questionBank: Question[]) {
    this.data.questionBank = questionBank;
    this.persist();
  }

  public addAllowedStudent(student: AllowedStudent) {
    const nextId = normalizeDbStudentId(student.idNumber);
    const nextSection = String(student.sectionCode || "").trim().toLowerCase();
    const idx = this.data.allowedStudents.findIndex(s =>
      normalizeDbStudentId(s.idNumber) === nextId &&
      String(s.sectionCode || "").trim().toLowerCase() === nextSection
    );
    if (idx === -1) {
      this.data.allowedStudents.push(student);
    } else {
      this.data.allowedStudents[idx] = student;
    }
    this.persist();
  }

  public clearAllowedStudentsBySection(sectionCode: string) {
    this.data.allowedStudents = this.data.allowedStudents.filter(s => s.sectionCode !== sectionCode);
    this.persist();
  }

  public clearAllAllowedStudents() {
    this.data.allowedStudents = [];
    this.persist();
  }

  public addSection(section: Section) {
    this.data.sections.push(section);
    this.persist();
  }

  public updateSection(code: string, updated: Partial<Section>) {
    const sec = this.data.sections.find(s => s.code === code);
    if (sec) {
      Object.assign(sec, updated);
      this.persist();
    }
  }

  public deleteSection(code: string) {
    this.data.sections = this.data.sections.filter(s => s.code.toUpperCase() !== String(code).toUpperCase());
    this.persist();
  }

  public addQuestion(question: Question) {
    this.data.questionBank.push(question);
    this.persist();
  }

  public updateQuestion(id: string, updated: Partial<Question>) {
    const index = this.data.questionBank.findIndex(q => q.id === id);
    if (index !== -1) {
      this.data.questionBank[index] = { ...this.data.questionBank[index], ...updated } as Question;
      this.persist();
    }
  }

  public deleteQuestion(id: string) {
    this.data.questionBank = this.data.questionBank.filter(q => q.id !== id);
    this.persist();
  }

  public addStudent(student: Student) {
    const nextId = normalizeDbStudentId(student.id);
    const nextEmail = normalizeDbEmail(student.email);
    const duplicateId = this.data.students.find(s => normalizeDbStudentId(s.id) === nextId);
    if (duplicateId) {
      throw new Error("DUPLICATE_STUDENT_ID");
    }
    const duplicateEmail = nextEmail ? this.data.students.find(s => normalizeDbEmail(s.email) === nextEmail) : null;
    if (duplicateEmail) {
      throw new Error("DUPLICATE_STUDENT_EMAIL");
    }
    this.data.students.push(student);
    this.persist();
  }

  public updateStudent(id: string, updated: Partial<Student>) {
    const index = this.data.students.findIndex(s => s.id === id);
    if (index !== -1) {
      this.data.students[index] = { ...this.data.students[index], ...updated } as Student;
      this.persist();
    }
  }

  public deleteStudentDataCompletely(studentId: string) {
    const nextId = normalizeDbStudentId(studentId);
    if (!nextId) return;

    // 1. Delete student
    this.data.students = this.data.students.filter(s => normalizeDbStudentId(s.id) !== nextId);

    // 2. Reset associated join codes
    this.data.joinCodes.forEach((jc: any) => {
      const codeStudentId = normalizeDbStudentId(jc.studentId || jc.usedByStudentId || jc.assignedStudentId || "");
      if (codeStudentId === nextId) {
        jc.status = "active";
        jc.studentId = "";
        jc.usedByStudentId = "";
        jc.studentName = "";
        jc.studentSection = "";
        jc.activatedAt = "";
        jc.activationDeviceToken = "";
        jc.activationDeviceFingerprint = "";
        jc.activationDeviceServerHash = "";
        jc.activationIp = "";
        jc.watermark = "";
        jc.isFreeCode = false;
        jc.pendingDeviceTransfer = false;
      }
    });

    // 3. Delete activity logs for this student
    this.data.activityLogs = this.data.activityLogs.filter(log => normalizeDbStudentId(log.studentId || "") !== nextId);

    this.persist();
  }

  public addOtp(email: string, code: string) {
    // Expires in 10 minutes
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.data.otps = this.data.otps.filter(o => o.email !== email); // remove old ones
    this.data.otps.push({ email, code, expiresAt });
    this.persist();
  }

  public verifyOtp(email: string, code: string): boolean {
    const otpIndex = this.data.otps.findIndex(o => o.email === email && o.code === code && o.expiresAt > Date.now());
    if (otpIndex !== -1) {
      this.data.otps.splice(otpIndex, 1); // delete on success
      this.persist();
      return true;
    }
    return false;
  }

  public addWeeklyExercise(exercise: WeeklyExercise) {
    this.data.exercises.push(exercise);
    this.persist();
  }

  public addExerciseSubmission(sub: ExerciseSubmission) {
    this.data.exerciseSubmissions.push(sub);
    this.persist();
  }

  public updateExerciseSubmission(id: string, updated: Partial<ExerciseSubmission>) {
    const index = this.data.exerciseSubmissions.findIndex(s => s.id === id);
    if (index !== -1) {
      this.data.exerciseSubmissions[index] = { ...this.data.exerciseSubmissions[index], ...updated } as ExerciseSubmission;
      this.persist();
    }
  }

  public addPersonalizedProject(proj: PersonalizedProject) {
    // Delete existing project of same user if not submitted to allow regeneration
    this.data.personalizedProjects = this.data.personalizedProjects.filter(p => !(p.studentId === proj.studentId && p.status === "none"));
    this.data.personalizedProjects.push(proj);
    this.persist();
  }

  public updatePersonalizedProject(id: string, updated: Partial<PersonalizedProject>) {
    const index = this.data.personalizedProjects.findIndex(p => p.id === id);
    if (index !== -1) {
      this.data.personalizedProjects[index] = { ...this.data.personalizedProjects[index], ...updated } as PersonalizedProject;
      this.persist();
    }
  }

  public addQuizSubmission(sub: QuizSubmission) {
    this.data.quizSubmissions.push(sub);
    this.persist();
  }

  public updateQuizSubmission(id: string, updated: Partial<QuizSubmission>) {
    const index = this.data.quizSubmissions.findIndex(s => s.id === id);
    if (index !== -1) {
      this.data.quizSubmissions[index] = { ...this.data.quizSubmissions[index], ...updated } as QuizSubmission;
      this.persist();
    }
  }

  public addActivityLog(log: Omit<ActivityLog, "id" | "timestamp">) {
    const id = "log-" + Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toISOString();
    this.data.activityLogs.unshift({ id, timestamp, ...log });
    // Keep last 1000 logs
    if (this.data.activityLogs.length > 1000) {
      this.data.activityLogs.pop();
    }
    this.persist(false);
  }

  public getInAppNotifications(): any[] {
    if (!this.data.inAppNotifications) this.data.inAppNotifications = [];
    return this.data.inAppNotifications;
  }
  // مفاتيح التنبيهات المقروءة لكل مستخدم — تُخزَّن على الخادم لتتزامن حالة "مقروء"
  // بين أجهزة المعلم/الطالب (هاتف↔كمبيوتر) بدل بقائها محلية على كل جهاز.
  public getNotificationSeenKeys(userKey: string): string[] {
    if (!this.data.notificationSeenKeys) this.data.notificationSeenKeys = {};
    const entry = (this.data.notificationSeenKeys as any)[String(userKey || "")];
    return entry && Array.isArray(entry.keys) ? entry.keys : [];
  }
  public saveNotificationSeenKeys(userKey: string, keys: string[]): void {
    if (!this.data.notificationSeenKeys) this.data.notificationSeenKeys = {};
    const uk = String(userKey || "");
    if (!uk) return;
    const capped = Array.from(
      new Set((keys || []).map((k) => String(k || "")).filter(Boolean)),
    ).slice(-400);
    (this.data.notificationSeenKeys as any)[uk] = {
      keys: capped,
      updatedAt: new Date().toISOString(),
    };
    this.persist(false);
  }
  public addInAppNotification(item: any): void {
    if (!this.data.inAppNotifications) this.data.inAppNotifications = [];
    this.data.inAppNotifications.unshift(item);
    // سقف محافظ (200) لأن كامل قاعدة البيانات تُحفظ في مستند Firestore واحد بحد 1MB.
    if (this.data.inAppNotifications.length > 200) {
      this.data.inAppNotifications.length = 200;
    }
    this.persist(false);
  }

  public getNotificationDispatches(): Record<string, string> {
    if (!this.data.notificationDispatches) this.data.notificationDispatches = {};
    return this.data.notificationDispatches;
  }

  public rememberNotificationDispatch(key: string): void {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) return;
    const now = Date.now();
    const dispatches = this.getNotificationDispatches();
    Object.entries(dispatches).forEach(([oldKey, value]) => {
      const at = new Date(value || 0).getTime();
      if (!Number.isFinite(at) || now - at > 7 * 24 * 60 * 60 * 1000)
        delete dispatches[oldKey];
    });
    dispatches[cleanKey] = new Date(now).toISOString();
    const keys = Object.keys(dispatches);
    if (keys.length > 2500) {
      keys
        .sort((a, b) =>
          String(dispatches[a] || "").localeCompare(String(dispatches[b] || "")),
        )
        .slice(0, keys.length - 2500)
        .forEach((oldKey) => delete dispatches[oldKey]);
    }
    this.persist(false);
  }

  public getNotificationAudit(): any[] {
    if (!this.data.notificationAudit) this.data.notificationAudit = [];
    return this.data.notificationAudit;
  }

  public updateNotificationAudit(
    eventIdValue: string,
    patch: Record<string, any> = {},
    increments: Record<string, number> = {},
  ): void {
    const eventId = String(eventIdValue || "").trim();
    if (!eventId) return;
    const audit = this.getNotificationAudit();
    const existingIndex = audit.findIndex(
      (item: any) => String(item?.id || "") === eventId,
    );
    const previous = existingIndex >= 0 ? audit[existingIndex] : { id: eventId };
    const next: any = {
      ...previous,
      ...patch,
      id: eventId,
      firstSeenAt: previous?.firstSeenAt || patch?.firstSeenAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    Object.entries(increments || {}).forEach(([key, value]) => {
      next[key] = Math.max(
        0,
        Number(previous?.[key] || 0) + Number(value || 0),
      );
    });
    if (existingIndex >= 0) audit.splice(existingIndex, 1);
    audit.unshift(next);
    if (audit.length > 300) audit.length = 300;
    this.persist(false);
  }


  public cleanseTeacherStudentData(studentIds: string[] = [], teacherEmail = "") {
    const owner = String(teacherEmail || "").trim().toLowerCase();
    const normalizeId = (value: any) => normalizeDbStudentId(value);
    const normalizeEmail = (value: any) => normalizeDbEmail(value);
    const ownedCodes = new Set<string>();
    const addCode = (value: any) => {
      const code = String(value || "").trim();
      if (code) ownedCodes.add(code.toLowerCase());
    };
    const ownerFromCode = (code: any) => {
      const raw = String(code || "").trim();
      const match = raw.match(/__([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})$/i);
      return normalizeEmail(match?.[1] || "");
    };
    const recordOwner = (record: any) =>
      normalizeEmail(
        record?.teacherEmail ||
          record?.ownerEmail ||
          record?.createdByEmail ||
          record?.actorEmail ||
          ownerFromCode(record?.courseCode || record?.sectionCode || record?.studentSection || record?.code),
      );
    const codeBelongsToTeacher = (code: any) => {
      const normalized = String(code || "").trim().toLowerCase();
      if (!normalized) return false;
      if (ownedCodes.has(normalized)) return true;
      return ownerFromCode(code) === owner;
    };
    const recordBelongsToTeacher = (record: any) => {
      if (!record) return false;
      const recOwner = recordOwner(record);
      if (recOwner && recOwner === owner) return true;
      return [record.courseCode, record.sectionCode, record.studentSection, record.code].some(codeBelongsToTeacher);
    };

    this.data.sections.forEach((section: any) => {
      if (recordOwner(section) === owner) addCode(section.code);
    });
    this.data.allowedStudents.forEach((row: any) => {
      if (recordOwner(row) === owner) addCode(row.sectionCode || row.studentSection || row.courseCode);
    });
    (this.data.joinCodes || []).forEach((jc: any) => {
      if (recordOwner(jc) === owner) addCode(jc.sectionCode || jc.studentSection || jc.courseCode);
    });
    (this.data.teacherExams || []).forEach((exam: any) => {
      if (recordBelongsToTeacher(exam)) addCode(exam.courseCode || exam.sectionCode || exam.studentSection);
    });
    (this.data.teacherProjects || []).forEach((project: any) => {
      if (recordBelongsToTeacher(project)) addCode(project.courseCode || project.sectionCode || project.studentSection);
    });

    const explicitStudentIds = new Set((studentIds || []).map(normalizeId).filter(Boolean));
    const affectedStudentIds = new Set<string>(explicitStudentIds);
    const studentCourseCodes = (student: any) => {
      const codes: string[] = [];
      const add = (value: any) => {
        const code = String(value || "").trim();
        if (code && !codes.some((old) => old.toLowerCase() === code.toLowerCase())) codes.push(code);
      };
      add(student?.sectionCode);
      add(student?.studentSection);
      (Array.isArray(student?.activatedCourseCodes) ? student.activatedCourseCodes : []).forEach(add);
      (Array.isArray(student?.enrollments) ? student.enrollments : []).forEach((entry: any) =>
        add(entry?.courseCode || entry?.sectionCode || entry?.studentSection),
      );
      return codes;
    };

    this.data.students.forEach((student: any) => {
      const sid = normalizeId(student?.id);
      if (!sid) return;
      if (studentCourseCodes(student).some(codeBelongsToTeacher)) affectedStudentIds.add(sid);
    });
    this.data.allowedStudents.forEach((row: any) => {
      if (recordBelongsToTeacher(row)) {
        const sid = normalizeId(row.idNumber || row.id || row.studentId);
        if (sid) affectedStudentIds.add(sid);
      }
    });

    const removeFrom = (key: keyof DatabaseState, predicate: (item: any) => boolean) => {
      const list = Array.isArray((this.data as any)[key]) ? (this.data as any)[key] : [];
      const before = list.length;
      (this.data as any)[key] = list.filter((item: any) => !predicate(item));
      return before - (this.data as any)[key].length;
    };

    const ownedChapterIds = new Set(
      (this.data.chapters || [])
        .filter((chapter: any) => recordBelongsToTeacher(chapter))
        .map((chapter: any) => String(chapter.id || ""))
        .filter(Boolean),
    );

    const beforeStudents = this.data.students.length;
    let trimmedStudents = 0;
    this.data.students = this.data.students
      .map((student: any) => {
        const sid = normalizeId(student?.id);
        if (!affectedStudentIds.has(sid)) return student;
        const codes = studentCourseCodes(student);
        const remainingCodes = codes.filter((code) => !codeBelongsToTeacher(code));
        if (!remainingCodes.length) return null;
        trimmedStudents += 1;
        const remainingEnrollments = Array.isArray(student.enrollments)
          ? student.enrollments.filter((entry: any) => !codeBelongsToTeacher(entry?.courseCode || entry?.sectionCode || entry?.studentSection))
          : [];
        const remainingActivated = Array.isArray(student.activatedCourseCodes)
          ? student.activatedCourseCodes.filter((code: any) => !codeBelongsToTeacher(code))
          : [];
        const nextPrimary = remainingCodes[0] || "";
        return {
          ...student,
          sectionCode: nextPrimary,
          studentSection: nextPrimary,
          activatedCourseCodes: remainingActivated,
          enrollments: remainingEnrollments,
          courseVisibilitySyncedAt: new Date().toISOString(),
        };
      })
      .filter(Boolean) as any;
    const removedStudents = beforeStudents - this.data.students.length;

    const studentAndTeacherRecord = (item: any) => {
      const sid = normalizeId(item?.studentId || item?.studentIdNumber || item?.idNumber || item?.id || item?.linkedStudentId);
      return (sid && affectedStudentIds.has(sid) && recordBelongsToTeacher(item)) || recordBelongsToTeacher(item);
    };

    let removedOperations = 0;
    const removedSections = removeFrom('sections', recordBelongsToTeacher);
    const removedChapters = removeFrom('chapters', (item: any) => recordBelongsToTeacher(item) || ownedChapterIds.has(String(item?.id || "")));
    const removedQuestions = removeFrom('questionBank', (item: any) => recordBelongsToTeacher(item) || ownedChapterIds.has(String(item?.chapterId || "")));
    const removedExercises = removeFrom('exercises', (item: any) => recordBelongsToTeacher(item) || ownedChapterIds.has(String(item?.chapterId || "")));
    const removedTeacherExams = removeFrom('teacherExams', recordBelongsToTeacher);
    const removedTeacherProjects = removeFrom('teacherProjects', recordBelongsToTeacher);

    removedOperations += removeFrom('exerciseSubmissions', studentAndTeacherRecord);
    removedOperations += removeFrom('quizSubmissions', studentAndTeacherRecord);
    removedOperations += removeFrom('personalizedProjects', studentAndTeacherRecord);
    removedOperations += removeFrom('teacherSubmissions', studentAndTeacherRecord);
    removedOperations += removeFrom('sebAttempts', studentAndTeacherRecord);
    removedOperations += removeFrom('activationAttempts', studentAndTeacherRecord);
    removedOperations += removeFrom('passwordResetRequests', (item: any) => {
      const sid = normalizeId(item?.studentId || item?.idNumber);
      return !!sid && affectedStudentIds.has(sid);
    });
    removedOperations += removeFrom('activityLogs', (item: any) => {
      const sid = normalizeId(item?.studentId || item?.studentIdNumber || item?.idNumber);
      return (sid && affectedStudentIds.has(sid) && recordBelongsToTeacher(item)) || recordBelongsToTeacher(item);
    });
    const removedRosterRows = removeFrom('allowedStudents', recordBelongsToTeacher);
    removedOperations += removedRosterRows;
    removedOperations += removeFrom('inAppNotifications', (item: any) => {
      const sid = normalizeId(item?.studentId || item?.data?.studentId || item?.userId || item?.data?.userId);
      return (sid && affectedStudentIds.has(sid) && (recordBelongsToTeacher(item) || codeBelongsToTeacher(item?.sectionCode || item?.data?.courseCode))) || recordBelongsToTeacher(item);
    });
    removedOperations += removeFrom('notificationTokens', (item: any) => {
      const sid = normalizeId(item?.userId);
      return item?.role === 'student' && sid && affectedStudentIds.has(sid) && codeBelongsToTeacher(item?.sectionCode);
    });

    const preservedJoinCodes = Array.isArray(this.data.joinCodes) ? this.data.joinCodes.length : 0;
    this.persist();
    return {
      removedStudents,
      trimmedStudents,
      removedOperations,
      removedRosterRows,
      removedSections,
      removedChapters,
      removedQuestions,
      removedExercises,
      removedTeacherExams,
      removedTeacherProjects,
      affectedStudents: affectedStudentIds.size,
      preservedJoinCodes,
      ownedCourseCodes: Array.from(ownedCodes),
    };
  }

  public customReset(actorEmail = "system") {
    this.archiveJoinCodes("course_closed_custom_reset", actorEmail);
    this.data.students = [];
    this.data.exerciseSubmissions = [];
    this.data.quizSubmissions = [];
    this.data.personalizedProjects = [];
    this.data.activityLogs = [];
    this.data.otps = [];
    this.data.passwordResetRequests = [];
    this.data.activationAttempts = [];
    this.data.notificationTokens = [];
    this.data.examSessions = [];
    
    this.data.joinCodes = [];
    
    this.allowEmptyDatabaseWriteOnce = true;
    this.persist();
  }

  public fullReset(actorEmail = "system") {
    this.allowEmptyDatabaseWriteOnce = true;
    this.archiveJoinCodes("course_closed_full_reset", actorEmail);
    const preservedRetiredJoinCodes = this.getRetiredJoinCodes();
    this.data.students = [];
    this.data.teachers = JSON.parse(JSON.stringify(initialTeachers));
    this.data.sections = [];
    this.data.chapters = [];
    this.data.questionBank = [];
    this.data.exercises = [];
    this.data.exerciseSubmissions = [];
    this.data.personalizedProjects = [];
    this.data.quizSubmissions = [];
    this.data.activityLogs = [];
    this.data.allowedStudents = [];
    this.data.otps = [];
    this.data.joinCodes = [];
    this.data.retiredJoinCodes = preservedRetiredJoinCodes;
    this.data.teacherExams = [];
    this.data.teacherProjects = [];
    this.data.teacherSubmissions = [];
    this.data.sebAttempts = [];
    this.data.examSessions = [];
    this.data.passwordResetRequests = [];
    this.data.activationAttempts = [];
    this.data.notificationTokens = [];
    this.data.inAppNotifications = [];
    this.data.passkeyCredentials = (this.data.passkeyCredentials || []).filter(
      (item: any) => String(item?.role || "") === "teacher",
    );
    this.data.bookMetadata = undefined;
    
    this.allowEmptyDatabaseWriteOnce = true;
    this.persist();
  }
}

export const dbInstance = new LocalDatabase();

// عند إيقاف الخادم: بما أن الكتابة المحلية صارت مؤجَّلة، نضمن تفريغ آخر دفعة بشكل
// متزامن حتى لا نفقد أي تعديل، ثم نمنح Firestore فرصة قصيرة لاستلام آخر مزامنة.
let shuttingDownDb = false;
process.on("exit", () => {
  try {
    dbInstance.flushLocalSave();
  } catch {}
});
const gracefulDbShutdown = (signal: NodeJS.Signals) => {
  if (shuttingDownDb) return;
  shuttingDownDb = true;
  try {
    dbInstance.flushLocalSave();
  } catch {}
  const finish = () => process.exit(0);
  // سقف 3 ثوانٍ حتى لا يتعلّق الإيقاف عند تعطل الشبكة.
  const timer = setTimeout(finish, 3000);
  Promise.resolve(dbInstance.waitForSync())
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      finish();
    });
};
process.on("SIGINT", () => gracefulDbShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulDbShutdown("SIGTERM"));
