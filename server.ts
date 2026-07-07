import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import fileUpload from "express-fileupload";
import crypto from "crypto";
import dotenv from "dotenv";
import { execFileSync, spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  dbInstance,
  Student,
  Section,
  TextbookChapter,
  Question,
  WeeklyExercise,
  PersonalizedProject,
  JoinCode,
  TeacherExam,
  NotificationToken,
  ExamSession,
  firestoreQuotaExceeded,
  firestoreQuotaErrorDetail,
} from "./src/server/db.js";
import type { SharingRingGraph } from "./src/shared/types";

dotenv.config();

// Initialize Gemini Client
const aiInstance = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

const app = express();
const PORT = Number(process.env.PORT || 3000);

const PASSKEY_RP_NAME = "مِراس";
type PasskeyRole = "student" | "teacher";
type PendingPasskeyRegistration = {
  userId: string;
  role: PasskeyRole;
  challenge: string;
  startedAt: number;
  deviceToken?: string;
};
type PendingPasskeyAuthentication = {
  challenge: string;
  startedAt: number;
  role?: PasskeyRole;
};
const pendingPasskeyRegistrations = new Map<
  string,
  PendingPasskeyRegistration
>();
const pendingPasskeyAuthentications = new Map<
  string,
  PendingPasskeyAuthentication
>();
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const MIRAS_SESSION_COOKIE = "miras_session";
const MIRAS_DEVICE_COOKIE = "miras_device_secret";
const MIRAS_SESSION_SECRET =
  process.env.MIRAS_SESSION_SECRET ||
  crypto.createHash("sha256").update(`miras-local-${process.cwd()}`).digest("hex");
const MIRAS_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

type MirasSessionRole = "student" | "teacher" | "admin";
type MirasVerifiedSession = {
  role: MirasSessionRole;
  userId: string;
  email?: string;
  deviceTokenHash?: string;
  issuedAt: number;
  expiresAt: number;
};

function base64urlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value: string) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function signMirasPayload(payload: string) {
  return crypto.createHmac("sha256", MIRAS_SESSION_SECRET).update(payload).digest("base64url");
}

function hashMirasValue(value: any) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function parseCookies(req: express.Request): Record<string, string> {
  const raw = String(req.headers.cookie || "");
  const out: Record<string, string> = {};
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function cookieOptions(req: express.Request, maxAgeSeconds = 60 * 60 * 24 * 14) {
  const secure = String(req.headers["x-forwarded-proto"] || req.protocol || "").includes("https");
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

function ensureDeviceSecretCookie(req: express.Request, res: express.Response) {
  const requestExisting = String((req as any).mirasDeviceSecret || "").trim();
  if (requestExisting && requestExisting.length >= 24) return requestExisting;
  const cookies = parseCookies(req);
  const existing = String(cookies[MIRAS_DEVICE_COOKIE] || "").trim();
  if (existing && existing.length >= 24) {
    (req as any).mirasDeviceSecret = existing;
    return existing;
  }
  const secret = crypto.randomBytes(32).toString("base64url");
  (req as any).mirasDeviceSecret = secret;
  res.append("Set-Cookie", `${MIRAS_DEVICE_COOKIE}=${encodeURIComponent(secret)}; ${cookieOptions(req, 60 * 60 * 24 * 365)}`);
  return secret;
}

function getDeviceSecretCookie(req: express.Request) {
  return String((req as any).mirasDeviceSecret || parseCookies(req)[MIRAS_DEVICE_COOKIE] || "").trim();
}

function serverBoundDeviceHash(req: express.Request, rawDeviceToken?: any) {
  const secret = getDeviceSecretCookie(req);
  const raw = String(rawDeviceToken || "").trim();
  if (!secret || !raw) return "";
  return hashMirasValue(`${secret}:${raw}`);
}

function createMirasSessionToken(session: Omit<MirasVerifiedSession, "issuedAt" | "expiresAt"> & { ttlMs?: number }) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (session.ttlMs || MIRAS_SESSION_TTL_MS);
  const payload = base64urlEncode(JSON.stringify({
    role: session.role,
    userId: String(session.userId || ""),
    email: session.email ? String(session.email).toLowerCase() : undefined,
    deviceTokenHash: session.deviceTokenHash || undefined,
    issuedAt,
    expiresAt,
  }));
  return `${payload}.${signMirasPayload(payload)}`;
}

function readBearerToken(req: express.Request) {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(parseCookies(req)[MIRAS_SESSION_COOKIE] || "").trim();
}

function verifyMirasSessionToken(req: express.Request): MirasVerifiedSession | null {
  const token = readBearerToken(req);
  if (!token) {
    console.warn(`[AUTH_DEBUG] No token found in request: ${req.method} ${req.path}`);
    return null;
  }
  if (!token.includes(".")) {
    console.warn(`[AUTH_DEBUG] Invalid token format (no dot): ${req.method} ${req.path}`);
    return null;
  }
  const [payload, sig] = token.split(".");
  if (!payload || !sig) {
    console.warn(`[AUTH_DEBUG] Missing payload or signature: ${req.method} ${req.path}`);
    return null;
  }
  const computedSig = signMirasPayload(payload);
  if (computedSig !== sig) {
    console.warn(`[AUTH_DEBUG] Signature mismatch for path ${req.method} ${req.path}. Expected: ${computedSig}, Got: ${sig}`);
    return null;
  }
  try {
    const parsed = JSON.parse(base64urlDecode(payload));
    if (!parsed) {
      console.warn(`[AUTH_DEBUG] Failed to parse payload: ${req.method} ${req.path}`);
      return null;
    }
    if (Date.now() > Number(parsed.expiresAt || 0)) {
      console.warn(`[AUTH_DEBUG] Token expired at ${new Date(Number(parsed.expiresAt || 0)).toISOString()} (current time: ${new Date().toISOString()})`);
      return null;
    }
    const role = String(parsed.role || "") as MirasSessionRole;
    if (!["student", "teacher", "admin"].includes(role)) {
      console.warn(`[AUTH_DEBUG] Invalid role in token: ${role}`);
      return null;
    }
    return {
      role,
      userId: String(parsed.userId || ""),
      email: parsed.email ? String(parsed.email).toLowerCase() : undefined,
      deviceTokenHash: parsed.deviceTokenHash || undefined,
      issuedAt: Number(parsed.issuedAt || 0),
      expiresAt: Number(parsed.expiresAt || 0),
    };
  } catch (err: any) {
    console.warn(`[AUTH_DEBUG] Exception during token verification: ${err?.message || err}`);
    return null;
  }
}

function attachMirasSessionCookie(req: express.Request, res: express.Response, token: string) {
  if (!token) return;
  res.append("Set-Cookie", `${MIRAS_SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieOptions(req)}`);
}

function createTeacherAuthPayload(req: express.Request, res: express.Response, teacher: any) {
  const rawDevice = getRequestDeviceToken(req);
  ensureDeviceSecretCookie(req, res);
  const authToken = createMirasSessionToken({
    role: isAdminEmail(teacher?.email) ? "admin" : "teacher",
    userId: String(teacher?.email || teacher?.id || "").toLowerCase(),
    email: String(teacher?.email || "").toLowerCase(),
    deviceTokenHash: rawDevice ? hashMirasValue(rawDevice) : undefined,
  });
  attachMirasSessionCookie(req, res, authToken);
  return authToken;
}

function createStudentAuthPayload(req: express.Request, res: express.Response, student: any) {
  const rawDevice = getRequestDeviceToken(req);
  ensureDeviceSecretCookie(req, res);
  const authToken = createMirasSessionToken({
    role: "student",
    userId: String(student?.id || ""),
    email: student?.email ? String(student.email).toLowerCase() : undefined,
    deviceTokenHash: rawDevice ? hashMirasValue(rawDevice) : undefined,
  });
  attachMirasSessionCookie(req, res, authToken);
  return authToken;
}

function verifiedTeacherEmailFromSession(req: express.Request): string {
  const session = verifyMirasSessionToken(req);
  if (!session) return "";
  if (session.role !== "teacher" && session.role !== "admin") return "";
  return String(session.email || session.userId || "").trim().toLowerCase();
}

function verifiedStudentIdFromSession(req: express.Request): string {
  const session = verifyMirasSessionToken(req);
  if (!session || session.role !== "student") return "";
  return normalizeStudentId(session.userId);
}

function clearAuthCookies(req: express.Request, res: express.Response) {
  const expired = cookieOptions(req, 0);
  res.append("Set-Cookie", `${MIRAS_SESSION_COOKIE}=; ${expired}`);
}

function normalizeArabicIndicDigits(value: string): string {
  return String(value || "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });
}

function normalizeDigitsDeep(value: any): any {
  if (typeof value === "string") return normalizeArabicIndicDigits(value);
  if (Array.isArray(value)) return value.map((item) => normalizeDigitsDeep(item));
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = normalizeDigitsDeep(value[key]);
  }
  return value;
}

function getRequestOrigin(req: express.Request) {
  const origin = String(req.headers.origin || "").trim();
  if (origin) return origin;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const proto = forwardedProto || req.protocol || "http";
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || req.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function getPasskeyRpId(req: express.Request) {
  try {
    return new URL(getRequestOrigin(req)).hostname;
  } catch {
    return "localhost";
  }
}

function cleanupPasskeyChallenges() {
  const now = Date.now();
  for (const [key, item] of pendingPasskeyRegistrations.entries()) {
    if (now - item.startedAt > PASSKEY_CHALLENGE_TTL_MS)
      pendingPasskeyRegistrations.delete(key);
  }
  for (const [key, item] of pendingPasskeyAuthentications.entries()) {
    if (now - item.startedAt > PASSKEY_CHALLENGE_TTL_MS)
      pendingPasskeyAuthentications.delete(key);
  }
}

function passkeyUserHandle(role: PasskeyRole, userId: string) {
  return Buffer.from(`${role}:${userId}`, "utf-8");
}

function findPasskeyUser(role: PasskeyRole, userId: string) {
  const id = String(userId || "").trim();
  if (role === "teacher") {
    const teacher = dbInstance
      .getTeachers()
      .find(
        (t) =>
          t.email.toLowerCase() === id.toLowerCase() ||
          t.id.toLowerCase() === id.toLowerCase(),
      );
    return teacher && teacher.isActive
      ? { role, id: teacher.email, name: teacher.name, raw: teacher }
      : null;
  }
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === id || s.email?.toLowerCase() === id.toLowerCase());
  return student
    ? { role, id: student.id, name: student.name, raw: student }
    : null;
}

function credentialForVerification(saved: any): WebAuthnCredential {
  return {
    id: saved.credentialId,
    publicKey: new Uint8Array(saved.publicKey || []),
    counter: Number(saved.counter || 0),
    transports: saved.transports || undefined,
  };
}

function responseForPasskeyUser(req: express.Request, saved: any, user: any) {
  if (saved.role === "teacher") {
    const teacher = user.raw;
    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: "دخول أستاذ بالبصمة",
      details: `تم تسجيل دخول الأستاذ ${teacher.email} عبر Passkey/Face ID`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "متصفح",
      browser: "Passkey",
      isViolationWarning: false,
    });
    return {
      success: true,
      role: "teacher",
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        role: teacher.role,
      },
    };
  }
  const student = user.raw as Student;
  if ((student as any).isAccessBlocked) {
    const err: any = new Error(
      (student as any).accessBlockReason ||
        "تم إيقاف هذا الحساب مؤقتاً من قبل أستاذ المقرر.",
    );
    err.statusCode = 403;
    throw err;
  }
  const sebLoginPass = isSebRequest(req) ? getValidSebPass(req, student) : null;
  const sessionValidation = validateSessionFingerprint(req, student);
  if (!sessionValidation.isValid && !sebLoginPass) {
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "انتهاك الأجهزة",
      details: "محاولة دخول بالبصمة من جهاز غير مصرح به",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "مجهول",
      browser: "Passkey",
      isViolationWarning: true,
    });
    notifyTeachersForSection(
      student.sectionCode,
      "محاولة دخول بالبصمة مرفوضة",
      `${student.name}: ${sessionValidation.error || "مخالفة أجهزة"}`,
      { type: "login_blocked", studentId: student.id, link: "/" },
    );
    const err: any = new Error(
      sessionValidation.error || "الجهاز غير مصرح له.",
    );
    err.statusCode = sessionValidation.statusCode || 403;
    throw err;
  }
  if (!sessionValidation.isValid && sebLoginPass) consumeSebPass(sebLoginPass);
  dbInstance.updateStudent(student.id, {
    lastLoginDate: new Date().toISOString(),
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "تسجيل دخول بالبصمة",
    details: "تسجيل دخول ناجح عبر Passkey/Face ID مع بقاء قفل الأجهزة فعالاً",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "مكتشف تلقائياً",
    browser: "Passkey",
    isViolationWarning: false,
  });
  const responseStudent: any = sebLoginPass
    ? {
        ...student,
        sectionCode: sebLoginPass.courseCode,
        activeSebExamId: sebLoginPass.examId,
        enrollments: getStudentEnrollmentDetails(student),
      }
    : { ...student, enrollments: getStudentEnrollmentDetails(student) };
  return {
    success: true,
    student: responseStudent,
    sebSession: describeSebPass(sebLoginPass || null),
  };
}

function passkeyDeviceLabel(item: any) {
  const ua = String(item.userAgent || "");
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  return item.deviceType || "Passkey";
}

const sebAttemptsStorePath = path.join(
  process.cwd(),
  ".miras-seb-attempts.json",
);
let liveContentRevision = Date.now();
function bumpLiveContentRevision() {
  liveContentRevision = Date.now();
  return liveContentRevision;
}

// حالة خاصة تُستخدم في سجل "تسليمات الاختبارات" منذ اللحظة التي يبدأ فيها
// الطالب اختباراً رسمياً وتظهر له الأسئلة (status === "started"). تجعل هذه
// الحالة دخول الطالب للاختبار ظاهراً فوراً لدى الأستاذ في شاشة التسليمات —
// حتى لو لم يصل أي إشعار "خروج" من SEB لاحقاً — مع زر "إرجاع" يسمح بفتح
// المحاولة من جديد إن احتاج الطالب لإعادتها.
const EXAM_IN_PROGRESS_STATUS = "دخل الاختبار - قيد الحل الآن";

// حالة خاصة تُستخدم في سجل "تسليمات الاختبارات" عندما يخرج الطالب من اختبار
// SEB (خروج آمن / إغلاق الجلسة) بعد بدء الاختبار وظهور الأسئلة دون تسليم
// إجاباته. تجعل هذه الحالة المحاولة ظاهرة لدى الأستاذ في شاشة التسليمات مع
// زر "إرجاع" الذي يسمح للطالب بإعادة المحاولة (انظر closeSebAttempt
// و /api/teacher/submissions/return).
const EXAM_EXITED_BEFORE_SUBMIT_STATUS = "خرج من الاختبار قبل التسليم";
const EXAM_WITHDRAWN_STATUS = "انسحاب من الاختبار";
const EXAM_CHEATING_ATTEMPT_STATUS = "محاولة غش";
const EXAM_SUBMITTED_STATUS = "بانتظار رصد الدرجات";
const EXAM_GRADED_STATUS = "تم رصد الدرجة";
const EXAM_TIME_EXPIRED_STATUS = "انتهى الوقت";
const EXAM_RETURNED_STATUS = "معاد للطالب";

// حالة نهائية/نزاهة لصفّ الأستاذ يجب ألا تُطمَس بحالة "قيد الحل الآن" بسبب
// أي مزامنة أو طلب أسئلة لاحق (محاولة غش، انسحاب، خروج قبل التسليم، انتهى
// الوقت، بانتظار/تم رصد الدرجة، أو درجة معتمدة يدوياً). حالة "معاد للطالب"
// ليست محمية عمداً حتى يظهر دخول الطالب بعد الإرجاع بشكل طبيعي.
function isProtectedFinalExamStatus(row: any): boolean {
  const s = String(row?.status || "").trim();
  if (isReturnedSubmissionStatusServer(s)) return false;
  const terminalText = [
    row?.terminalStatus,
    row?.sessionStatus,
    row?.attemptStatus,
    row?.finishReason,
    row?.exitReason,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  return (
    s === EXAM_CHEATING_ATTEMPT_STATUS ||
    s === EXAM_WITHDRAWN_STATUS ||
    s === EXAM_EXITED_BEFORE_SUBMIT_STATUS ||
    s === EXAM_TIME_EXPIRED_STATUS ||
    s === EXAM_GRADED_STATUS ||
    s === EXAM_SUBMITTED_STATUS ||
    s === "درجة معتمدة" ||
    /\b(?:cheating|violation|violated|expelled|exited|withdrawn|finished|completed|submitted)\b/.test(
      terminalText,
    ) ||
    terminalText.includes("landscape_orientation") ||
    terminalText.includes("orientation_violation") ||
    (row?.teacherGradeOverride === true &&
      String(row?.grade ?? row?.visibleGrade ?? "").trim() !== "")
  );
}

function normalizedExamExitReason(reason: any): string {
  const text = String(reason || "").trim().toLowerCase();
  if (
    text.includes("landscape") ||
    text.includes("orientation") ||
    text.includes("الوضع العرضي") ||
    text.includes("اتجاه الجهاز") ||
    text.includes("اتجاه الشاشة") ||
    text.includes("تغيير اتجاه")
  ) {
    return "landscape_orientation";
  }
  return text ? "integrity_violation" : "violation";
}

function isReturnedSubmissionStatusServer(status: any) {
  const text = String(status || "")
    .trim()
    .toLowerCase();
  return ["معاد للطالب", "معاد لك", "returned", "return", "reopened"].includes(
    text,
  );
}

function isCheatingAttemptSubmissionServer(row: any): boolean {
  const text = `${row?.status || ""} ${row?.answerText || ""}`;
  return (
    String(row?.status || "").trim() === EXAM_CHEATING_ATTEMPT_STATUS ||
    text.includes("محاولة غش") ||
    text.includes("حاول الطالب الغش")
  );
}

const EXAM_LOCK_HEARTBEAT_TIMEOUT_MS = 15 * 1000;
const EXAM_LOCK_CONFLICT_MESSAGE = "الاختبار مفتوح في جلسة أخرى.";
const EXAM_LOCK_CONFLICT_REASON = "فتح الاختبار في أكثر من جلسة أو جهاز";
type ExamLockResult =
  | { ok: true; session: ExamSession }
  | { ok: false; status: number; error: string; reason?: string };

function isExamLockFailure(result: ExamLockResult): result is Extract<ExamLockResult, { ok: false }> {
  return result.ok === false;
}

function normalizeExamSessionDisplayMode(value: any): "pwa" | "browser" {
  return String(value || "").trim().toLowerCase() === "pwa"
    ? "pwa"
    : "browser";
}

function requestExamSessionId(req: express.Request): string {
  return String(
    (req.body as any)?.examSessionId ||
      (req.body as any)?.sessionId ||
      req.query?.examSessionId ||
      req.query?.sessionId ||
      req.headers["x-miras-exam-session-id"] ||
      "",
  ).trim();
}

function requestExamDisplayMode(req: express.Request): "pwa" | "browser" {
  return normalizeExamSessionDisplayMode(
    (req.body as any)?.displayMode ||
      req.query?.displayMode ||
      req.headers["x-miras-display-mode"],
  );
}

function examSessionRecordId(studentId: any, examId: any, sessionId: any) {
  return `exam-session-${String(studentId)}-${String(examId)}-${String(sessionId)}`;
}

function sameExamSessionKey(session: any, studentId: any, examId: any) {
  return (
    String(session?.studentId || "") === String(studentId || "") &&
    String(session?.examId || "") === String(examId || "")
  );
}

function getExamSessionsFor(studentId: any, examId: any): ExamSession[] {
  return dbInstance
    .getExamSessions()
    .filter((session: any) => sameExamSessionKey(session, studentId, examId))
    .sort(
      (a: any, b: any) =>
        new Date(b.updatedAt || b.lastHeartbeatAt || b.startedAt || 0).getTime() -
        new Date(a.updatedAt || a.lastHeartbeatAt || a.startedAt || 0).getTime(),
    );
}

function expireStaleExamSessions(studentId?: any, examId?: any) {
  const now = Date.now();
  dbInstance
    .getExamSessions()
    .filter(
      (session: any) =>
        String(session?.status || "") === "active" &&
        (studentId === undefined || String(session.studentId) === String(studentId)) &&
        (examId === undefined || String(session.examId) === String(examId)),
    )
    .forEach((session: any) => {
      const lastBeat = new Date(
        session.lastHeartbeatAt || session.startedAt || 0,
      ).getTime();
      if (Number.isFinite(lastBeat) && now - lastBeat <= EXAM_LOCK_HEARTBEAT_TIMEOUT_MS)
        return;
      dbInstance.upsertExamSession({
        ...session,
        status: "expired",
        finishedAt: session.finishedAt || new Date(now).toISOString(),
        finishReason: session.finishReason || "heartbeat-timeout",
      });
    });
}

function activeExamSessionFor(studentId: any, examId: any): ExamSession | null {
  expireStaleExamSessions(studentId, examId);
  return (
    getExamSessionsFor(studentId, examId).find(
      (session: any) => String(session.status || "") === "active",
    ) || null
  );
}

function latestBlockingExamSessionFor(studentId: any, examId: any): ExamSession | null {
  return (
    getExamSessionsFor(studentId, examId).find(
      (session: any) => String(session.status || "") === "violated",
    ) || null
  );
}

function isExamOfficiallyReturnedForLock(examId: any, studentId: any) {
  return !!(
    isExamReturnedForStudent(examId, studentId) ||
    getActiveReturnException("exam", examId, studentId)
  );
}

function recordExamSessionConflict(
  req: express.Request,
  student: Student,
  exam: any,
  activeSession: ExamSession,
  attemptedSessionId: string,
) {
  const nowIso = new Date().toISOString();
  const conflict = {
    at: nowIso,
    attemptedSessionId,
    deviceId: getRequestDeviceToken(req) || getRequestDeviceFingerprint(req),
    userAgent: String(req.headers["user-agent"] || "Unknown Browser").slice(
      0,
      220,
    ),
    displayMode: requestExamDisplayMode(req),
    ip: req.ip || "127.0.0.1",
    reason: EXAM_LOCK_CONFLICT_REASON,
  };
  const previousConflicts = Array.isArray(activeSession.conflictAttempts)
    ? activeSession.conflictAttempts
    : [];
  const recentlyLogged = previousConflicts.some(
    (item: any) =>
      String(item?.attemptedSessionId || "") === attemptedSessionId &&
      Date.now() - new Date(item?.at || 0).getTime() < 5000,
  );
  dbInstance.upsertExamSession({
    ...activeSession,
    conflictAttempts: [...previousConflicts, conflict].slice(-20),
  });
  if (recentlyLogged) return;
  const courseCode = String(exam?.courseCode || student.sectionCode || "");
  const teacherEmail = sectionOwnerEmail(courseCode);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "محاولة فتح الاختبار في جلسة أخرى",
    details: `${exam?.title || "اختبار"} — ${EXAM_LOCK_CONFLICT_REASON}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: courseCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: requestExamDisplayMode(req) === "pwa" ? "PWA" : "متصفح",
    browser: "قفل جلسة الاختبار",
    isViolationWarning: true,
  });
  notifyTeachersForSection(
    courseCode,
    "تنبيه نزاهة",
    `${student.name} حاول فتح ${exam?.title || "اختبار"} في جلسة أخرى.`,
    {
      type: "exam_warning",
      studentId: student.id,
      examId: String(exam?.id || ""),
      link: "/",
    },
  );
}

function buildExamSessionFromRequest(
  req: express.Request,
  student: Student,
  exam: any,
  sessionId: string,
): ExamSession {
  const nowIso = new Date().toISOString();
  const deviceId = String(
    (req.body as any)?.deviceId ||
      (req.body as any)?.deviceToken ||
      req.query?.deviceId ||
      req.query?.deviceToken ||
      getRequestDeviceToken(req) ||
      getRequestDeviceFingerprint(req),
  ).trim();
  return {
    id: examSessionRecordId(student.id, exam.id, sessionId),
    studentId: student.id,
    examId: String(exam.id),
    sessionId,
    deviceId,
    userAgent: String(req.headers["user-agent"] || "Unknown Browser").slice(
      0,
      220,
    ),
    displayMode: requestExamDisplayMode(req),
    startedAt: nowIso,
    lastHeartbeatAt: nowIso,
    status: "active",
    courseCode: String(exam.courseCode || student.sectionCode || ""),
    studentName: student.name,
    examTitle: String(exam.title || ""),
    ip: req.ip || "127.0.0.1",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function acquireExamLockForRequest(
  req: express.Request,
  student: Student,
  exam: any,
): ExamLockResult {
  const requestedSessionId =
    requestExamSessionId(req) ||
    `srv-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const returnedByTeacher = isExamOfficiallyReturnedForLock(exam.id, student.id);
  const violatedSession = latestBlockingExamSessionFor(student.id, exam.id);
  if (violatedSession && !returnedByTeacher) {
    return {
      ok: false,
      status: 409,
      error:
        "تم إيقاف هذا الاختبار بسبب مخالفة. لا يمكن فتحه مرة أخرى إلا إذا أعاده المعلم.",
      reason: "violated",
    };
  }

  const activeSession = activeExamSessionFor(student.id, exam.id);
  if (activeSession) {
    if (String(activeSession.sessionId) !== requestedSessionId) {
      if (returnedByTeacher) {
        const nowIso = new Date().toISOString();
        getExamSessionsFor(student.id, exam.id).forEach((session: any) => {
          if (String(session.sessionId) === requestedSessionId) return;
          dbInstance.upsertExamSession({
            ...session,
            status: "finished",
            reason: "teacher-authorized-return",
            updatedAt: nowIso,
            closedAt: session.closedAt || nowIso,
            lastHeartbeatAt: nowIso,
          });
        });
      } else {
        recordExamSessionConflict(
          req,
          student,
          exam,
          activeSession,
          requestedSessionId,
        );
        return {
          ok: false,
          status: 409,
          error: EXAM_LOCK_CONFLICT_MESSAGE,
          reason: EXAM_LOCK_CONFLICT_REASON,
        };
      }
    } else {
      const refreshed = {
      ...activeSession,
      lastHeartbeatAt: new Date().toISOString(),
      deviceId: String(
        (req.body as any)?.deviceId ||
          (req.body as any)?.deviceToken ||
          activeSession.deviceId ||
          "",
      ),
      userAgent: String(req.headers["user-agent"] || activeSession.userAgent || "").slice(0, 220),
      displayMode: requestExamDisplayMode(req),
    };
      dbInstance.upsertExamSession(refreshed);
      return { ok: true, session: refreshed };
    }
  }

  const session = buildExamSessionFromRequest(
    req,
    student,
    exam,
    requestedSessionId,
  );
  dbInstance.upsertExamSession(session);
  return { ok: true, session };
}

function heartbeatExamLockForRequest(
  req: express.Request,
  student: Student,
  exam: any,
): ExamLockResult {
  const sessionId = requestExamSessionId(req);
  if (!sessionId) {
    return { ok: false, status: 400, error: "بيانات جلسة الاختبار ناقصة." };
  }
  const activeSession = activeExamSessionFor(student.id, exam.id);
  if (!activeSession) {
    return {
      ok: false,
      status: 409,
      error: "انتهت جلسة الاختبار أو انقطع اتصالها.",
      reason: "expired",
    };
  }
  if (String(activeSession.sessionId) !== sessionId) {
    recordExamSessionConflict(req, student, exam, activeSession, sessionId);
    return {
      ok: false,
      status: 409,
      error: EXAM_LOCK_CONFLICT_MESSAGE,
      reason: EXAM_LOCK_CONFLICT_REASON,
    };
  }
  const refreshed = {
    ...activeSession,
    lastHeartbeatAt: new Date().toISOString(),
    deviceId: String(
      (req.body as any)?.deviceId ||
        (req.body as any)?.deviceToken ||
        activeSession.deviceId ||
        "",
    ),
    userAgent: String(req.headers["user-agent"] || activeSession.userAgent || "").slice(0, 220),
    displayMode: requestExamDisplayMode(req),
  };
  dbInstance.upsertExamSession(refreshed);
  return { ok: true, session: refreshed };
}

function markExamLockStatusForRequest(
  req: express.Request,
  student: Student,
  exam: any,
  status: "finished" | "violated" | "expired",
  reason = "",
) {
  const sessionId = requestExamSessionId(req);
  if (!sessionId) return null;
  const session = getExamSessionsFor(student.id, exam.id).find(
    (item: any) => String(item.sessionId) === sessionId,
  );
  if (!session) return null;
  const updated = {
    ...session,
    status,
    finishedAt: new Date().toISOString(),
    finishReason:
      status === "violated" ? normalizedExamExitReason(reason) : reason || status,
    lastHeartbeatAt: new Date().toISOString(),
  };
  dbInstance.upsertExamSession(updated);
  return updated;
}

// خلط Fisher-Yates: عشوائية صحيحة ومتساوية الاحتمال. يُستخدم دائماً وتلقائياً
// عند توليد كل محاولة اختبار لترتيب الأسئلة المختارة وترتيب اختيارات الأسئلة
// متعددة الخيارات، دون أي اعتماد على إعداد قابل للتعطيل من نموذج إنشاء
// الاختبار (هذه الميزة مفعّلة دائماً تلقائياً).
function fisherYatesShuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sanitizePublicQuizQuestions(questions: any[]) {
  return (Array.isArray(questions) ? questions : []).map((question: any) => {
    const { correctAnswer, ...publicQuestion } = question || {};
    return publicQuestion;
  });
}

function normalizeArabicDigitsServer(value: any) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٫٬،]/g, ".");
}
function normalizeGradeValueServer(value: any) {
  const firstPart =
    normalizeArabicDigitsServer(value).split(/\s*من\s*|\//)[0] || "";
  const normalized = firstPart
    .replace(/[^0-9.]/g, "")
    .replace(/(\..*)\./g, "$1");
  if (!normalized) return "";
  return normalized.startsWith(".") ? `0${normalized}` : normalized;
}

function pointsForSubmission(submission: any): number | null {
  const kind = String(submission?.kind || "").toLowerCase();
  const activityId = String(
    submission?.activityId || submission?.examId || submission?.projectId || "",
  );
  const source =
    kind === "exam" || kind === "quiz"
      ? dbInstance
          .getTeacherExams()
          .find((exam: any) => String(exam.id) === activityId)
      : dbInstance
          .getTeacherProjects()
          .find((project: any) => String(project.id) === activityId);
  const raw =
    source?.points ??
    submission?.points ??
    submission?.maxPoints ??
    submission?.totalPoints;
  const max = Number(raw);
  return Number.isFinite(max) && max > 0 ? max : null;
}

function isTemporarySubmissionAttachmentUrl(value: any): boolean {
  const url = String(value || "").trim();
  return /^(blob:|filesystem:|file:|webkit-fs:)/i.test(url);
}

function submissionAttachmentFileIdFromValue(value: any): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const pathPart = text.split("?")[0].split("#")[0];
  const name = pathPart.split("/").filter(Boolean).pop() || pathPart;
  const match = name.match(/^(file-[a-z0-9-]+?)(?:\.[a-z0-9]+)?$/i);
  return match ? match[1] : "";
}

function normalizePersistentSubmissionAttachments(attachments: any): any[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((att: any) => {
      if (!att) return null;
      const {
        previewUrl,
        objectUrl,
        localUrl,
        url: rawUrl,
        storedUrl: rawStoredUrl,
        downloadUrl: rawDownloadUrl,
        dataUrl: rawDataUrl,
        ...rest
      } = att;
      const derivedId = submissionAttachmentFileIdFromValue(
        att.storedName || att.fileId || att.attachmentId || rawStoredUrl || rawUrl || rawDownloadUrl,
      );
      const id = String(att.id || att.fileId || att.attachmentId || derivedId || "").trim();
      const candidates = [rawStoredUrl, rawUrl, rawDownloadUrl]
        .map((value: any) => String(value || "").trim())
        .filter((value: string) => value && !isTemporarySubmissionAttachmentUrl(value));
      const url = String(candidates[0] || (id ? `/api/submission-attachments/${id}` : "")).trim();
      const dataUrl = String(rawDataUrl || "").trim();
      const shouldKeepDataUrl =
        dataUrl.startsWith("data:") &&
        dataUrl.length <= MIRAS_MAX_EMBEDDED_ATTACHMENT_DATA_URL_CHARS;
      if (!id && !url && !shouldKeepDataUrl) return null;
      return {
        ...rest,
        id: id || att.id,
        fileId: id || att.fileId,
        originalName: sanitizeAttachmentOriginalName(
          rest.originalName || rest.name || "مرفق",
        ),
        ...(url ? { url, storedUrl: url, downloadUrl: url } : {}),
        ...(shouldKeepDataUrl ? { dataUrl } : {}),
        persisted: true,
      };
    })
    .filter(Boolean);
}

function findStoredSubmissionAttachmentDataUrl(fileId: string): { dataUrl: string; originalName: string; mimeType: string } | null {
  const wanted = String(fileId || "").trim();
  if (!wanted) return null;
  const submissions = Array.isArray(dbInstance.getTeacherSubmissions())
    ? dbInstance.getTeacherSubmissions()
    : [];
  for (const sub of submissions) {
    const attachments = normalizePersistentSubmissionAttachments(sub?.attachments || []);
    for (const att of attachments) {
      const candidateId = String(
        att?.fileId ||
          att?.id ||
          att?.attachmentId ||
          submissionAttachmentFileIdFromValue(att?.storedName || att?.storedUrl || att?.url),
      ).trim();
      if (candidateId !== wanted) continue;
      const dataUrl = String(att?.dataUrl || "").trim();
      if (!dataUrl.startsWith("data:")) continue;
      return {
        dataUrl,
        originalName: String(att?.originalName || att?.name || `${wanted}`),
        mimeType: String(att?.mimeType || ""),
      };
    }
  }
  return null;
}

function findSubmissionByAttachmentId(fileId: string) {
  const wanted = String(fileId || "").trim();
  if (!wanted) return null;
  return (
    dbInstance.getTeacherSubmissions().find((submission: any) =>
      normalizePersistentSubmissionAttachments(
        submission?.attachments || [],
      ).some((attachment: any) => {
        const candidateId = String(
          attachment?.fileId ||
            attachment?.id ||
            attachment?.attachmentId ||
            submissionAttachmentFileIdFromValue(
              attachment?.storedName ||
                attachment?.storedUrl ||
                attachment?.url,
            ),
        ).trim();
        return candidateId === wanted;
      }),
    ) || null
  );
}

function sendStoredSubmissionAttachmentDataUrl(res: any, fallback: { dataUrl: string; originalName?: string; mimeType?: string } | null) {
  if (!fallback?.dataUrl?.startsWith("data:")) return false;
  const match = fallback.dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/);
  if (!match) return false;
  try {
    const mimeType = String(fallback.mimeType || match[1] || "application/octet-stream");
    const buffer = Buffer.from(match[2] || "", "base64");
    if (!buffer.length) return false;
    const originalName = sanitizeAttachmentOriginalName(fallback.originalName || "attachment");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`,
    );
    res.end(buffer);
    return true;
  } catch {
    return false;
  }
}

function sendStoredSubmissionAttachmentBuffer(
  res: any,
  archive: { buffer: Buffer; originalName: string; mimeType: string } | null,
) {
  if (!archive?.buffer?.length) return false;
  const originalName = sanitizeAttachmentOriginalName(
    archive.originalName || "attachment",
  );
  res.setHeader(
    "Content-Type",
    archive.mimeType || "application/octet-stream",
  );
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`,
  );
  res.end(archive.buffer);
  return true;
}

async function migrateEmbeddedSubmissionAttachments() {
  const submissions = Array.isArray(dbInstance.getTeacherSubmissions())
    ? dbInstance.getTeacherSubmissions()
    : [];
  let migratedFiles = 0;
  let updatedSubmissions = 0;

  for (const submission of submissions) {
    const attachments = Array.isArray(submission?.attachments)
      ? submission.attachments
      : [];
    let submissionChanged = false;
    const migratedAttachments = [];

    for (const attachment of attachments) {
      const dataUrl = String(attachment?.dataUrl || "").trim();
      const match = dataUrl.match(
        /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/,
      );
      if (!match) {
        migratedAttachments.push(attachment);
        continue;
      }

      const fileId = String(
        attachment?.fileId ||
          attachment?.id ||
          submissionAttachmentFileIdFromValue(
            attachment?.storedName ||
              attachment?.storedUrl ||
              attachment?.url,
          ),
      ).trim();
      if (!fileId || !match[2]) {
        migratedAttachments.push(attachment);
        continue;
      }

      const archived = await dbInstance.saveSubmissionAttachmentArchive({
        fileId,
        originalName: String(
          attachment?.originalName || attachment?.name || "attachment",
        ),
        mimeType: String(
          attachment?.mimeType || match[1] || "application/octet-stream",
        ),
        size: Number(attachment?.size || 0),
        storedName: String(attachment?.storedName || ""),
        base64: match[2],
      });
      if (!archived) {
        migratedAttachments.push(attachment);
        continue;
      }

      const { dataUrl: _embeddedDataUrl, ...metadata } = attachment;
      migratedAttachments.push({
        ...metadata,
        id: fileId,
        fileId,
        archived: true,
        cloudPersisted: true,
        persisted: true,
        url: `/api/submission-attachments/${fileId}`,
        storedUrl: `/api/submission-attachments/${fileId}`,
        downloadUrl: `/api/submission-attachments/${fileId}`,
      });
      submissionChanged = true;
      migratedFiles += 1;
    }

    if (submissionChanged) {
      dbInstance.upsertTeacherSubmission({
        ...submission,
        attachments: migratedAttachments,
        updatedAt: submission.updatedAt || new Date().toISOString(),
      });
      updatedSubmissions += 1;
    }
  }

  if (updatedSubmissions > 0) {
    await dbInstance.waitForSync();
    console.log(
      `✅ Migrated ${migratedFiles} embedded submission attachment(s) out of ${updatedSubmissions} database record(s).`,
    );
  }
}

function upsertRuntimeTeacherSubmission(submission: any) {
  const id = String(
    submission.id ||
      `${submission.kind || "sub"}-${submission.activityId || Date.now()}-${submission.studentId || "student"}`,
  );
  const previous = dbInstance
    .getTeacherSubmissions()
    .find((item: any) => String(item.id) === id);
  const requestedStatus = String(submission?.status || "").trim();
  const requestedStatusLower = requestedStatus.toLowerCase();
  const incomingIsActiveStatus =
    requestedStatus === EXAM_IN_PROGRESS_STATUS ||
    requestedStatusLower === "active" ||
    requestedStatusLower === "started" ||
    requestedStatusLower === "solving" ||
    requestedStatusLower === "in_progress";
  // الحماية النهائية في نقطة الحفظ نفسها: أي نبضة/مزامنة قديمة وصلت بعد
  // الخروج أو الغش لا تملك إعادة الصف إلى "قيد الحل". الإرجاع الرسمي للطالب
  // يكتب EXAM_RETURNED_STATUS وليس حالة نشطة، لذلك يبقى مساره المعتاد مفتوحاً.
  if (previous && isProtectedFinalExamStatus(previous) && incomingIsActiveStatus) {
    return previous;
  }
  const incomingOwnsAttachments = Object.prototype.hasOwnProperty.call(
    submission || {},
    "attachments",
  );
  const normalizedIncomingAttachments = normalizePersistentSubmissionAttachments(
    submission?.attachments,
  );
  const normalizedPreviousAttachments = normalizePersistentSubmissionAttachments(
    previous?.attachments,
  );
  // Preserve uploaded attachment metadata across later teacher grade/return/status
  // updates. Those updates frequently carry only grade/status fields; without
  // merging here the persisted image cards can disappear from the teacher view
  // after the next polling cycle even though the files still exist on disk.
  if (!incomingOwnsAttachments && normalizedPreviousAttachments.length) {
    submission = { ...submission, attachments: normalizedPreviousAttachments };
  } else if (incomingOwnsAttachments) {
    submission = { ...submission, attachments: normalizedIncomingAttachments };
  }
  const max = pointsForSubmission(submission);
  const normalizedGrade =
    submission.grade === "" ||
    submission.grade === undefined ||
    submission.grade === null
      ? ""
      : normalizeGradeValueServer(submission.grade);
  const normalizedVisibleGrade =
    submission.visibleGrade === "" ||
    submission.visibleGrade === undefined ||
    submission.visibleGrade === null
      ? submission.visibleGrade
      : normalizeGradeValueServer(submission.visibleGrade);
  submission = {
    ...submission,
    grade: normalizedGrade,
    visibleGrade: normalizedVisibleGrade,
  };
  const incomingStatus = String(submission.status || "").trim();
  const incomingIsReturned = isReturnedSubmissionStatusServer(incomingStatus);
  if (!incomingIsReturned) {
    submission = {
      ...submission,
      returnedAt: undefined,
      returnedByEmail: undefined,
      returnNote: undefined,
    };
  }
  if (incomingStatus === EXAM_IN_PROGRESS_STATUS) {
    submission = {
      ...submission,
      grade: "",
      visibleGrade: "",
      score: "",
      teacherGrade: "",
      finalGrade: "",
      teacherGradeOverride: false,
      gradedAt: undefined,
      serverSubmissionId: undefined,
      terminalStatus: undefined,
      sessionStatus: undefined,
      attemptStatus: undefined,
      finishReason: undefined,
      exitReason: undefined,
      exitedAt: undefined,
    };
  }

  const previousHasManualTeacherGrade =
    previous?.teacherGradeOverride === true &&
    String(
      previous?.grade ?? previous?.visibleGrade ?? previous?.teacherGrade ?? "",
    ).trim() !== "";
  const incomingHasManualTeacherGrade =
    submission.teacherGradeOverride === true &&
    String(
      submission.grade ??
        submission.visibleGrade ??
        submission.teacherGrade ??
        "",
    ).trim() !== "";
  const incomingAnswerText = String(submission.answerText || "");
  const incomingIsWithdrawalRepair =
    incomingStatus === EXAM_WITHDRAWN_STATUS ||
    incomingStatus === EXAM_CHEATING_ATTEMPT_STATUS ||
    incomingStatus === EXAM_EXITED_BEFORE_SUBMIT_STATUS ||
    incomingAnswerText.includes("انسحب الطالب") ||
    incomingAnswerText.includes("انسحاب من الاختبار") ||
    incomingAnswerText.includes("حاول الطالب الغش") ||
    incomingAnswerText.includes("أغلق شاشة الاختبار");
  const incomingLooksAutoZero =
    String(
      submission.grade ?? submission.visibleGrade ?? submission.score ?? "",
    ).trim() === "" ||
    Number(
      normalizeGradeValueServer(
        submission.grade ?? submission.visibleGrade ?? submission.score ?? "0",
      ),
    ) === 0;

  // إذا عدّل المعلم درجة طالب منسحب يدوياً، لا تسمح أي مزامنة لاحقة
  // لسجل الانسحاب التلقائي بإرجاعها إلى صفر.
  if (
    previousHasManualTeacherGrade &&
    !incomingHasManualTeacherGrade &&
    incomingIsWithdrawalRepair &&
    incomingLooksAutoZero
  ) {
    submission = {
      ...submission,
      grade: String(
        previous.grade ?? previous.visibleGrade ?? previous.teacherGrade ?? "",
      ),
      visibleGrade: String(
        previous.visibleGrade ?? previous.grade ?? previous.teacherGrade ?? "",
      ),
      teacherGradeOverride: true,
      status: previous.status || EXAM_GRADED_STATUS,
      gradedAt: previous.gradedAt || submission.gradedAt,
    };
  }
  const notifyGradeCommit =
    submission.notifyStudentOnGrade === true ||
    submission.notifyStudentOnGrade === "true" ||
    submission.gradeNotificationCommitted === true ||
    submission.gradeNotificationCommitted === "true";
  const finalNormalizedGrade =
    submission.grade === "" ||
    submission.grade === undefined ||
    submission.grade === null
      ? ""
      : normalizeGradeValueServer(submission.grade);
  const numericGrade =
    finalNormalizedGrade === "" ? null : Number(finalNormalizedGrade);
  if (
    numericGrade !== null &&
    Number.isFinite(numericGrade) &&
    max !== null &&
    numericGrade > max
  ) {
    const err: any = new Error(`GRADE_EXCEEDS_MAX:${max}`);
    err.statusCode = 400;
    err.maxPoints = max;
    throw err;
  }
  const saved = {
    ...submission,
    id,
    submittedAt: submission.submittedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  delete (saved as any).notifyStudentOnGrade;
  delete (saved as any).gradeNotificationCommitted;
  dbInstance.upsertTeacherSubmission(saved);
  bumpLiveContentRevision();
  const prevGrade = previous?.grade ?? previous?.visibleGrade ?? "";
  const nextGrade = saved.grade ?? saved.visibleGrade ?? "";
  if (
    notifyGradeCommit &&
    saved.studentId &&
    String(nextGrade) !== "" &&
    String(nextGrade) !== String(prevGrade)
  ) {
    const changed = String(prevGrade) !== "";
    const suffix = max ? `: ${nextGrade} من ${max}` : `: ${nextGrade}`;
    notifyStudent(
      String(saved.studentId),
      changed ? "تم تعديل درجة" : "درجة جديدة",
      `${saved.activityTitle || "نشاط"}${suffix}`,
      {
        type: changed ? "grade_updated" : "grade_new",
        studentId: String(saved.studentId),
        activityId: String(saved.activityId || ""),
        kind: String(saved.kind || ""),
        courseCode: String(saved.courseCode || ""),
        link: "/",
      },
    );
  }
  return saved;
}

function examReviewSettings(exam: any) {
  const review = exam?.review || {};
  return {
    showGrade: review.showGrade === true,
    gradesReleased: review.gradesReleased === true,
    releasedAt: review.releasedAt,
  };
}

function canShowExamGradeToStudent(exam: any) {
  const review = examReviewSettings(exam);
  if (review.showGrade) return true;
  return review.gradesReleased;
}

function preserveSpecialExamStatusOnGradeRelease(status: any) {
  const normalized = String(status || "").trim();
  return [
    EXAM_CHEATING_ATTEMPT_STATUS,
    EXAM_WITHDRAWN_STATUS,
    EXAM_EXITED_BEFORE_SUBMIT_STATUS,
    EXAM_TIME_EXPIRED_STATUS,
  ].includes(normalized);
}

function gradeCurrentExamProgress(
  submission: any,
  fallbackTotalPoints: number,
) {
  const answers = submission?.draftAnswers || submission?.answers || {};
  const graded = gradeQuizAnswers(answers);
  const hasAnswers =
    answers && typeof answers === "object" && Object.keys(answers).length > 0;
  const score = hasAnswers
    ? Number(graded.score || 0)
    : Number(submission?.score || 0);
  const totalPoints =
    Number(
      fallbackTotalPoints ||
        graded.totalPoints ||
        submission?.totalPoints ||
        20,
    ) || 20;
  return {
    answers,
    score: Number.isFinite(score) ? score : 0,
    totalPoints,
    matchedQuestions: graded.matchedQuestions.length
      ? graded.matchedQuestions
      : submission?.matchedQuestions || [],
  };
}

function finalizeExamAttemptAsZero(
  req: express.Request,
  params: {
    student: Student;
    exam: any;
    reason: string;
    pass?: SebPass | null;
    submission?: any;
  },
) {
  const { student, exam, reason } = params;
  const now = new Date().toISOString();
  const safeReq: any = req || {};
  const baseTotalPoints =
    Number(exam?.points || params.submission?.totalPoints || 0) || 20;

  const progressGrade = gradeCurrentExamProgress(
    params.submission,
    baseTotalPoints,
  );
  const totalPoints = progressGrade.totalPoints;
  const finalScore = progressGrade.score;
  const finalMatched = progressGrade.matchedQuestions;
  const finalStatus = EXAM_WITHDRAWN_STATUS;
  const finalReasonText = `انسحب الطالب من الاختبار أو انقطعت جلسته، وتم رصد الدرجة التي وصل لها: ${finalScore} من ${totalPoints}`;

  const quizSubmission = {
    id:
      params.submission?.id ||
      "quiz-sub-" + Math.random().toString(36).substring(2, 9),
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode:
      exam?.courseCode || params.pass?.courseCode || student.sectionCode,
    chapterId: exam?.id || params.pass?.examId,
    matchedQuestions: finalMatched,
    answers: progressGrade.answers,
    draftAnswers: progressGrade.answers,
    score: finalScore,
    totalPoints,
    durationMinutes: Number(params.submission?.durationMinutes || 0),
    deviceFingerprint: getRequestDeviceFingerprint(safeReq),
    deviceOS: "SEB",
    deviceBrowser: String(
      safeReq.headers?.["user-agent"] || "Safe Exam Browser",
    ).substring(0, 30),
    ipAddress: safeReq.ip || "127.0.0.1",
    startedAt: params.submission?.startedAt,
    submittedAt: now,
    status: "submitted",
    zeroReason: undefined,
    finishReason: finalStatus,
  };
  if (params.submission?.id)
    dbInstance.updateQuizSubmission(
      params.submission.id,
      quizSubmission as any,
    );
  else dbInstance.addQuizSubmission(quizSubmission as any);
  upsertRuntimeTeacherSubmission({
    id: `exam-${exam.id}-${student.id}`,
    kind: "exam",
    activityId: exam.id,
    activityTitle: exam.title,
    courseCode:
      exam.courseCode || params.pass?.courseCode || student.sectionCode,
    studentId: student.id,
    studentName: student.name,
    answerText: finalReasonText,
    status: finalStatus,
    grade: String(finalScore),
    visibleGrade: canShowExamGradeToStudent(exam) ? String(finalScore) : "",
    totalPoints,
    serverSubmissionId: quizSubmission.id,
    submittedAt: now,
    gradedAt: now,
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "انسحاب من الاختبار",
    details: `${reason} — تم رصد الدرجة الحالية تلقائياً: ${finalScore} من ${totalPoints}. الاختبار: ${exam.title}`,
    teacherEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    actorEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    sectionCode: exam.courseCode || student.sectionCode,
    ip: safeReq.ip || "127.0.0.1",
    userAgent: safeReq.headers?.["user-agent"] || "Unknown",
    os: "Safe Exam Browser",
    browser: "SEB",
    isViolationWarning: true,
  });
  return quizSubmission;
}

function removeRuntimeTeacherSubmissionsFor(kind: string, activityId: string) {
  dbInstance.removeTeacherSubmissionsFor(kind, activityId);
  bumpLiveContentRevision();
}
function isActiveRecord(item: any) {
  return (
    item &&
    item.deleted !== true &&
    item.archived !== true &&
    item.isDeleted !== true &&
    item.isArchived !== true &&
    String(item.status || "").toLowerCase() !== "deleted"
  );
}

function activeSections(): any[] {
  return dbInstance.getSections().filter((section: any) => isActiveRecord(section));
}

type SebAttemptStatus = "launch" | "active" | "closed";
type SebPass = {
  token: string;
  attemptId: string;
  studentId: string;
  examId: string;
  courseCode: string;
  teacherEmail?: string;
  ownerEmail?: string;
  originalDeviceId?: string;
  createdAt: number;
  expiresAt: number;
  status: SebAttemptStatus;
  usedAt?: number;
  startedAt?: number;
  closedAt?: number;
  closeReason?: string;
};

function logSebEvent(params: {
  studentId?: string;
  studentName?: string;
  action: string;
  details: string;
  req: express.Request;
  warning?: boolean;
}) {
  dbInstance.addActivityLog({
    studentId: params.studentId,
    studentName: params.studentName,
    action: params.action,
    details: params.details,
    ip: params.req.ip || "127.0.0.1",
    userAgent: params.req.headers["user-agent"] || "Unknown",
    os: "Safe Exam Browser",
    browser: "SEB Token",
    isViolationWarning: !!params.warning,
  });
}

function getRuntimeSebPasses() {
  const arr = dbInstance.getSebAttempts();
  return new Map<string, SebPass>(
    arr.map((item: any) => [String(item.token), item as SebPass]),
  );
}
function saveSebPass(pass: SebPass) {
  const map = getRuntimeSebPasses();
  map.set(pass.token, pass);
  dbInstance.setSebAttempts(Array.from(map.values()));
  return pass;
}
function createSebPass(params: {
  studentId: string;
  examId: string;
  courseCode: string;
  teacherEmail?: string;
  ownerEmail?: string;
  originalDeviceId?: string;
  attemptId?: string;
  expiryMinutes?: number;
}) {
  const token = base64Url(crypto.randomBytes(32));
  const now = Date.now();
  const attemptId =
    params.attemptId ||
    `seb-attempt-${now}-${base64Url(crypto.randomBytes(8))}`;
  const pass: SebPass = {
    token,
    attemptId,
    studentId: String(params.studentId || ""),
    examId: String(params.examId || ""),
    courseCode: String(params.courseCode || ""),
    teacherEmail: params.teacherEmail || params.ownerEmail,
    ownerEmail: params.ownerEmail || params.teacherEmail,
    originalDeviceId: params.originalDeviceId,
    createdAt: now,
    expiresAt: now + Math.max(1, params.expiryMinutes || 10) * 60 * 1000,
    status: "launch",
  };
  return saveSebPass(pass);
}
function getSebPassFromRequest(req: express.Request): string {
  return String(
    req.body?.sebToken ||
      req.body?.sebPass ||
      req.query?.token ||
      req.query?.seb_token ||
      req.query?.seb_pass ||
      req.headers["x-miras-seb-token"] ||
      req.headers["x-miras-seb-pass"] ||
      "",
  ).trim();
}
function isSebPassExpired(pass: SebPass) {
  return pass.status === "launch" && pass.expiresAt < Date.now();
}
function findSebPass(token: string): SebPass | null {
  const map = getRuntimeSebPasses();
  const pass = map.get(String(token || ""));
  if (!pass) return null;
  if (isSebPassExpired(pass)) {
    pass.status = "closed";
    pass.closeReason = "expired-before-start";
    pass.closedAt = Date.now();
    saveSebPass(pass);
    return null;
  }
  return pass;
}
function rejectSebPass(
  req: express.Request,
  pass: SebPass | null,
  reason: string,
) {
  logSebEvent({
    studentId: pass?.studentId,
    action: "رفض نفق SEB",
    details: reason,
    req,
    warning: true,
  });
}
function getValidSebPass(
  req: express.Request,
  student?: Student,
  examId?: any,
): SebPass | null {
  const token = getSebPassFromRequest(req);
  if (!token) return null;
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed") return null;
  if (student && String(pass.studentId) !== String(student.id)) return null;
  if (
    student &&
    pass.courseCode &&
    !studentHasEnrollmentInCourse(student, pass.courseCode) &&
    !hasTeacherAuthorizedSebReturnException(pass.examId, student.id)
  )
    return null;
  if (examId && String(pass.examId) !== String(examId)) return null;
  return pass;
}
function getActiveSebAttempt(
  req: express.Request,
  student?: Student,
  examId?: any,
): SebPass | null {
  const pass = getValidSebPass(req, student, examId);
  if (!pass || pass.status !== "active") return null;
  return pass;
}
function consumeSebPass(pass: SebPass | null) {
  if (!pass || pass.status === "closed") return;
  pass.usedAt = Date.now();
  if (pass.status === "launch") {
    pass.status = "active";
    pass.startedAt = pass.usedAt;
  }
  saveSebPass(pass);
}
function isSebSubmissionCloseReason(reason: any) {
  const normalizedReason = String(reason || "closed").toLowerCase();
  return (
    normalizedReason === "submitted" || normalizedReason.includes("submit")
  );
}
function closeSebAttempt(pass: SebPass | null, reason = "closed") {
  if (!pass) return;
  const wasActive = pass.status === "active";
  const isSubmissionClose = isSebSubmissionCloseReason(reason);

  // قد يصل طلب الخروج من SEB بعد أن تكون الجلسة أُغلقت محلياً أو بسبب رابط
  // الخروج. لا نترك صف الأستاذ عالقاً على "قيد الحل" في هذه الحالة؛ بل
  // نحاول تثبيت الانسحاب فقط إذا لم يكن الإغلاق تسليماً حقيقياً، والحارس داخل
  // flagExamExitedBeforeSubmit يمنع تحويل التسليم الصحيح إلى انسحاب.
  if (pass.status === "closed") {
    if (!isSubmissionClose) flagExamExitedBeforeSubmit(pass);
    return;
  }

  pass.status = "closed";
  pass.closedAt = Date.now();
  pass.closeReason = reason;
  saveSebPass(pass);

  // إغلاق جلسة SEB بعد تسليم حقيقي لا يعني انسحاباً. لا نرصد صفر الانسحاب
  // إلا عند خروج الطالب قبل التسليم، مع بقاء محاولة الاختبار الداخلية started.
  if (wasActive && !isSubmissionClose) flagExamExitedBeforeSubmit(pass);
}

function flagExamExitedBeforeSubmit(pass: SebPass) {
  try {
    const submission = dbInstance
      .getQuizSubmissions()
      .find(
        (q: any) =>
          String(q.studentId) === String(pass.studentId) &&
          String(q.chapterId) === String(pass.examId),
      );

    const student = dbInstance
      .getStudents()
      .find((s: any) => String(s.id) === String(pass.studentId));
    const exam = dbInstance
      .getTeacherExams()
      .find((item: any) => String(item.id) === String(pass.examId));
    if (!student || !exam) return;

    const submissionId = `exam-${exam.id}-${student.id}`;
    const existing = dbInstance
      .getTeacherSubmissions()
      .find((item: any) => String(item.id) === submissionId);
    if (
      existing &&
      String(existing.status || "") === EXAM_EXITED_BEFORE_SUBMIT_STATUS
    )
      return; // تم التنبيه مسبقاً، لا تكرار

    // الحالة التي تستوجب رصد صفر تلقائياً عند انسحاب الطالب أو إغلاق جلسة SEB
    // فعلياً: محاولة الاختبار الداخلية لا تزال "started" (لم يسلّم الطالب)،
    // أو شاشة تسليمات الأستاذ لا تزال تعرض "دخل الاختبار - قيد الحل الآن"
    // لهذه المحاولة (حتى لو لم تُحدَّث محاولة الاختبار الداخلية لأي سبب). إن
    // لم يتحقق أي من الشرطين فالطالب قد سلّم فعلاً ولا حاجة لأي تعديل.
    const quizStillInProgress =
      !!submission && String((submission as any).status || "") === "started";
    const teacherStillShowsInProgress =
      !!existing && String(existing.status || "") === EXAM_IN_PROGRESS_STATUS;
    if (!quizStillInProgress && !teacherStillShowsInProgress) return;

    finalizeExamAttemptAsZero({} as express.Request, {
      student,
      exam,
      pass,
      submission,
      reason:
        "بدأ الطالب الاختبار وظهرت له الأسئلة، ثم خرج أو انقطعت الجلسة قبل تسليم الإجابات.",
    });

    notifyTeachersForSection(
      (exam as any).courseCode || pass.courseCode,
      "خروج طالب من اختبار قبل التسليم",
      `${student.name} خرج من اختبار "${exam.title}" قبل تسليم إجاباته. يمكنك السماح له بإعادة المحاولة من شاشة تسليمات الاختبارات.`,
      {
        type: "exam_exited_before_submit",
        studentId: String(student.id),
        activityId: String(exam.id),
        kind: "exam",
        link: "/",
      },
    );
  } catch {}
}
function describeSebPass(pass: SebPass | null) {
  if (!pass) return null;
  return {
    token: pass.token,
    attemptId: pass.attemptId,
    studentId: pass.studentId,
    examId: pass.examId,
    courseCode: pass.courseCode,
    teacherEmail: pass.teacherEmail || pass.ownerEmail || "",
    originalDeviceId: pass.originalDeviceId || "",
    status: pass.status,
    expiresAt: new Date(pass.expiresAt).toISOString(),
    usedAt: pass.usedAt ? new Date(pass.usedAt).toISOString() : null,
    startedAt: pass.startedAt ? new Date(pass.startedAt).toISOString() : null,
    closedAt: pass.closedAt ? new Date(pass.closedAt).toISOString() : null,
    closeReason: pass.closeReason || "",
  };
}
function buildAbsoluteServerUrl(
  req: express.Request,
  pathnameWithQuery: string,
): string {
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http",
  ).split(",")[0];
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`,
  ).split(",")[0];
  return `${proto}://${host}${pathnameWithQuery}`;
}
function buildSebStartUrl(req: express.Request, token: string): string {
  return buildAbsoluteServerUrl(
    req,
    `/seb/start?token=${encodeURIComponent(token)}`,
  );
}
function buildSebAppUrl(req: express.Request, pass: SebPass): string {
  return buildAbsoluteServerUrl(
    req,
    `/?miras_seb=1&seb=1&seb_token=${encodeURIComponent(pass.token)}&exam_id=${encodeURIComponent(pass.examId)}&course=${encodeURIComponent(pass.courseCode)}&attempt_id=${encodeURIComponent(pass.attemptId)}&auto_start_exam=1`,
  );
}
function buildSebQuitUrl(req: express.Request, token: string): string {
  return buildAbsoluteServerUrl(
    req,
    `/seb/quit?token=${encodeURIComponent(token)}`,
  );
}
function buildSebConfigUrl(token: string): string {
  return `/seb/config/${encodeURIComponent(token)}/miras-official.seb`;
}
function buildSebConfigAbsoluteUrl(
  req: express.Request,
  token: string,
): string {
  return buildAbsoluteServerUrl(req, buildSebConfigUrl(token));
}
function buildSebConfigDeepLinkUrl(
  req: express.Request,
  token: string,
): string {
  const absolute = buildSebConfigAbsoluteUrl(req, token);
  if (/^https:\/\//i.test(absolute))
    return absolute.replace(/^https:\/\//i, "sebs://");
  if (/^http:\/\//i.test(absolute))
    return absolute.replace(/^http:\/\//i, "seb://");
  return absolute;
}
function renderSebLaunchPage(req: express.Request, pass: SebPass) {
  const launchUrl = buildSebConfigDeepLinkUrl(req, pass.token);
  const appStoreUrl = "https://apps.apple.com/app/safeexambrowser/id1155002964";
  const downloadUrl = "https://safeexambrowser.org/download_en.html";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>تشغيل الاختبار الآمن</title>
<style>
  :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#eef4ff}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:linear-gradient(135deg,#eef4ff,#f8fbff)}
  .card{width:min(560px,100%);background:white;border:1px solid #dbe7ff;border-radius:28px;padding:26px;box-shadow:0 28px 80px rgba(15,23,42,.14);text-align:center}
  .shield{width:72px;height:72px;border-radius:24px;display:grid;place-items:center;margin:0 auto 16px;background:#e8f0ff;color:#2563eb;font-size:34px}
  h1{font-size:24px;margin:0 0 10px;font-weight:900}.muted{color:#64748b;line-height:1.8;font-size:14px;margin:0 0 18px}
  .btn{display:flex;align-items:center;justify-content:center;width:100%;box-sizing:border-box;border:0;border-radius:18px;padding:15px 18px;font-weight:900;font-size:15px;text-decoration:none;cursor:pointer;margin-top:10px}
  .primary{background:#2563eb;color:white}.ghost{background:#f8fafc;color:#334155;border:1px solid #e2e8f0}.ios{background:#eef4ff;color:#1e3a8a}
  .hint{margin-top:14px;color:#64748b;font-size:12px;line-height:1.8}.warn{margin-top:12px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:12px;font-size:12px;line-height:1.8;text-align:right;display:none}
  .lockNotice{margin-bottom:16px;border-radius:16px;background:#eef2ff;border:1px solid #c7d2fe;color:#312e81;padding:14px;font-size:13px;line-height:2;text-align:right}
  .lockNotice b{display:block;margin-bottom:6px;font-size:14px}
  .lockNotice .yes{color:#15803d;font-weight:900}.lockNotice .no{color:#b91c1c;font-weight:900}
</style>
</head>
<body>
<main class="card">
  <div class="shield">🛡️</div>
  <h1>فتح الاختبار عبر Safe Exam Browser</h1>
  <div class="lockNotice">
    <b>تنبيه قبل فتح الاختبار</b>
    عند الضغط على الزر الأزرق سيتم فتح تطبيق SEB المثبت على جهازك مباشرة وربطه بهذه المحاولة فقط.
    <br><br>
    ستظهر لك رسالة من النظام بعنوان "Confirm App Self-Lock" — اضغط <span class="yes">"Yes"</span> لبدء الاختبار. سيُقفل جهازك بالكامل ولن تستطيع الخروج لأي تطبيق حتى تسلّم الاختبار.
    <br><br>
	    إذا ضغطت <span class="no">"No"</span> بالخطأ: لا تقلق، الاختبار لم يبدأ. ارجع للرئيسية وافتح الاختبار مرة أخرى.
  </div>
  <p class="muted">اضغط الزر الأزرق لفتح Safe Exam Browser مباشرة. إذا كان التطبيق مثبتاً سيبدأ الاختبار داخل SEB دون تنزيل ملف يدوي.</p>
  <a class="btn primary" id="openSeb" href="${xmlEscape(launchUrl)}">فتح الاختبار داخل SEB</a>
  <a class="btn ios" href="${xmlEscape(appStoreUrl)}" rel="noopener">تحميل SEB لأجهزة iPhone / iPad</a>
  <a class="btn ghost" href="${xmlEscape(downloadUrl)}" rel="noopener">تحميل SEB للكمبيوتر</a>
  <div class="warn" id="warnBox">إذا لم يفتح SEB تلقائياً، تأكد أن التطبيق مثبت ثم اضغط الزر الأزرق مرة أخرى. إذا لم يكن مثبتاً استخدم زر التحميل المناسب لجهازك.</div>
  <p class="hint">عند فتح SEB سيتم قفل جهازك تلقائياً وفتح الاختبار المرتبط بهذه المحاولة مباشرة.</p>
</main>
<script>
(function(){
  var opened=false;
  var link=document.getElementById('openSeb');
  var warn=document.getElementById('warnBox');
	  function showWarn(){ if(warn && !document.hidden) warn.style.display='block'; }
	  function goHomeAfterLaunch(){
	    setTimeout(function(){
	      if(opened && location.pathname !== "/") location.replace("/");
	    }, 1200);
	  }
	  link.addEventListener('click', function(){
	    if(opened){ return; }
	    opened=true;
	    goHomeAfterLaunch();
	    setTimeout(showWarn, 3500);
	  });
})();
</script>
</body>
</html>`;
}
function renderSebStartPage(req: express.Request, pass: SebPass) {
  const quitUrl = buildSebQuitUrl(req, pass.token);
  const boot = JSON.stringify({
    token: pass.token,
    examId: pass.examId,
    courseCode: pass.courseCode,
    quitUrl,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>بدء الاختبار الآمن</title>
<style>
  body{margin:0;min-height:100vh;background:#090d1a;background:linear-gradient(135deg,#0a0f24,#020617);color:white;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:18px;box-sizing:border-box}
  .box{width:min(860px,100%);margin:0 auto;padding:24px;border:1px solid rgba(255,255,255,.08);border-radius:28px;background:rgba(255,255,255,.02);backdrop-filter:blur(10px);text-align:right;box-sizing:border-box;box-shadow:0 30px 100px rgba(0,0,0,0.5)}
  .shield{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;margin:0 auto 16px;background:rgba(99,102,241,.18);color:#bfdbfe;font-size:30px}
  h1{font-size:22px;margin:0 0 12px;font-weight:900;text-align:center}
  h2{font-size:18px;margin:0;font-weight:900}.hidden{display:none!important}
  .desc{color:#cbd5e1;font-size:14px;line-height:2;margin:14px 0}
  .desc b{color:#fff;display:block;margin-top:6px;margin-bottom:6px}
  .desc .ok{color:#86efac;font-weight:900}.desc .no{color:#fca5a5;font-weight:900}
  .start{display:block;width:100%;box-sizing:border-box;border:0;border-radius:18px;padding:16px;background:#16a34a;color:white;font-weight:900;font-size:16px;text-decoration:none;text-align:center;cursor:pointer;margin-top:18px}
  .quit{display:block;width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:13px;background:transparent;color:#fca5a5;font-weight:800;font-size:13px;text-decoration:none;text-align:center;margin-top:10px}
  .quitBig{display:block;width:100%;box-sizing:border-box;border:0;border-radius:18px;padding:16px;background:#dc2626;color:white;font-weight:900;font-size:15px;text-decoration:none;text-align:center;cursor:pointer;margin-top:10px}
  .retry{display:block;width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:13px;background:rgba(255,255,255,.08);color:#e2e8f0;font-weight:800;font-size:13px;cursor:pointer;margin-top:10px}
  .rescue{margin-top:16px;border-radius:18px;background:rgba(245,158,11,.12);border:1px solid rgba(252,211,77,.28);color:#fde68a;padding:14px;text-align:right}
  .rescue h3{margin:0 0 8px;font-size:14px;font-weight:900;color:#fff}
  .rescue p{margin:0 0 4px;font-size:12px;line-height:1.9;color:#fde68a}
  .status{margin-top:14px;border-radius:16px;background:rgba(59,130,246,.14);border:1px solid rgba(147,197,253,.24);color:#bfdbfe;padding:12px;font-size:13px;line-height:1.8}
  .error{margin-top:14px;border-radius:16px;background:rgba(239,68,68,.14);border:1px solid rgba(252,165,165,.26);color:#fecaca;padding:12px;font-size:13px;line-height:1.8}
  
  /* Top Exam bar & elements */
  .top{position:sticky;top:0;z-index:3;margin:-24px -24px 18px;padding:16px 18px;background:rgba(15,23,42,.96);border-bottom:1px solid rgba(255,255,255,0.08);border-radius:28px 28px 0 0;display:flex;gap:12px;align-items:center;justify-content:space-between}
  .top-meta{display:flex;align-items:center;gap:10px}
  .timer{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:8px 12px;font-size:13px;font-weight:900;transition:all 0.4s cubic-bezier(0.16, 1, 0.3, 1)}
  .timer.receding{transform:scale(0.8);opacity:0.25}
  .timer.critical-warning{background:rgba(239,68,68,0.20);border-color:rgba(239,68,68,0.35);color:#f87171;box-shadow:0 0 10px rgba(239,68,68,0.15);animation:timerPulse 1.5s infinite}
  @keyframes timerPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(0.95); }
  }

  /* Ambient Status sync indicator */
  .ambient-status{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:800;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);transition:all 0.3s ease}
  .ambient-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#64748b}
  .status-idle .ambient-dot{background:#64748b;opacity:0.6}
  .status-saving .ambient-dot{background:#f59e0b;animation:ambientBreath 1s infinite}
  .status-saving{border-color:rgba(245,158,11,0.2);background:rgba(245,158,11,0.05);color:#fde68a}
  .status-synced .ambient-dot{background:#10b981;animation:ambientPuff 1.2s ease-out}
  .status-synced{border-color:rgba(16,185,129,0.25);background:rgba(16,185,129,0.06);color:#a7f3d0}
  .status-offline .ambient-dot{background:#94a3b8;animation:ambientBreath 1.5s infinite}
  .status-offline{border-color:rgba(148,163,184,0.15);background:rgba(148,163,184,0.04);color:#cbd5e1}
  .status-restored .ambient-dot{background:#10b981;animation:ambientPuff 1s ease-out}
  .status-restored{border-color:rgba(16,185,129,0.3);background:rgba(16,185,129,0.1);color:#34d399}
  
  @keyframes ambientBreath {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }
  @keyframes ambientPuff {
    0% { transform: scale(0.8); }
    50% { transform: scale(1.3); }
    100% { transform: scale(1); }
  }

  /* Question Pager dots and wrapper */
  .q-navigation{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0 16px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05)}
  .pager-dot{width:28px;height:28px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#94a3b8;font-size:12px;font-weight:900;display:grid;place-items:center;cursor:pointer;transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1)}
  .pager-dot:hover{background:rgba(255,255,255,0.08);color:white}
  .pager-dot.answered{border-color:rgba(99,102,241,0.4);background:rgba(99,102,241,0.15);color:#bfdbfe}
  .pager-dot.active-dot{border-color:white;background:white;color:#0f172a;box-shadow:0 0 12px rgba(255,255,255,0.2);transform:scale(1.1)}

  /* Question sliders with animations */
  .question-slide{animation:slideEntrance 0.4s cubic-bezier(0.16, 1, 0.3, 1)}
  @keyframes slideEntrance {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .question{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);border-radius:20px;padding:22px;margin-top:8px}
  .qhead{display:flex;justify-content:space-between;gap:10px;color:#bfdbfe;font-size:13px;font-weight:900;margin-bottom:14px}
  .qtext{font-size:16px;line-height:2;color:#fff;font-weight:800;margin:0 0 16px}
  
  /* Choices styling */
  .choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
  .choice{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#cbd5e1;border-radius:14px;padding:14px;font-weight:800;text-align:right;font-size:14px;transition:all 0.2s ease;cursor:pointer}
  .choice:hover{background:rgba(255,255,255,0.1);color:white}
  .choice.selected{background:#2563eb;border-color:#60a5fa;color:white;box-shadow:0 4px 15px rgba(37,99,235,0.25)}
  
  /* Text input & short text */
  textarea,input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:white;border-radius:14px;padding:14px;font:inherit;font-size:14px;outline:none;transition:border-color 0.2s}
  textarea:focus,input:focus{border-color:#2563eb;background:rgba(255,255,255,.07)}
  textarea{min-height:110px;resize:vertical}
  
  /* Slide Buttons panel */
  .q-slider-actions{display:flex;justify-content:space-between;gap:12px;margin-top:16px}
  .nav-btn-alt{flex:1;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:12px;font-size:13px;font-weight:900;background:rgba(255,255,255,0.05);color:white;cursor:pointer;transition:all 0.2s}
  .nav-btn-alt:hover:not(:disabled){background:rgba(255,255,255,0.1)}
  .nav-btn-alt:disabled{opacity:0.3;cursor:not-allowed}
  
  /* General submission action buttons */
  .actions{display:flex;flex-direction:column;gap:10px;margin-top:24px;border-top:1px solid rgba(255,255,255,0.06);padding-top:18px}
  .submit{border:0;border-radius:18px;background:#2563eb;color:white;padding:16px;font-size:15px;font-weight:900;cursor:pointer;transition:all 0.2s}
  .submit:hover{background:#1d4ed8;box-shadow:0 4px 20px rgba(37,99,235,0.3)}
  .muted{color:#64748b;font-size:12px;line-height:1.8;text-align:center}
</style>
</head>
<body>
<div class="box">
  <section id="intro">
    <div class="shield">🛡️</div>
    <h1>جاهز لبدء الاختبار الآمن</h1>
    <div class="desc">
    قبل أن تضغط "بدء الاختبار"، اقرأ هذا التنبيه جيداً:
    <b>سيُقفل جهازك بالكامل أثناء الاختبار</b>
    <span class="ok">✓</span> لا يمكنك الخروج لأي تطبيق أو موقع آخر.<br>
    <span class="ok">✓</span> لا يمكن أخذ لقطة شاشة أو تسجيل الشاشة.<br>
    <span class="ok">✓</span> لن تستطيع الخروج من SEB إلا بعد تسليم الاختبار.
    <b>إذا لم تكن جاهزاً الآن</b>
    اضغط "خروج آمن" بالأسفل، الاختبار لم يبدأ ولن تُسجَّل عليك أي محاولة. تستطيع الرجوع لمِراس ومحاولة الفتح من جديد لاحقاً.
  </div>
    <button class="start" id="startBtn" type="button">بدء الاختبار الآن</button>
    <a class="quit" href="${xmlEscape(quitUrl)}">خروج آمن بدون بدء الاختبار</a>
    <p class="muted">إذا ظهرت أي مشكلة، استخدم خروج آمن. كلمة الخروج للمراقب: CBE</p>
    <div class="rescue hidden" id="rescueBox">
      <h3>تأخر تحميل الأسئلة</h3>
      <p>لم تصل الأسئلة خلال الوقت المتوقع. إذا استمرت المشكلة استخدم زر الخروج بالأعلى وأبلغ المراقب.</p>
    </div>
    <div class="status hidden" id="statusBox"></div>
    <div class="error hidden" id="errorBox"></div>
  </section>
  <section id="exam" class="hidden">
    <div class="top">
      <h2 id="examTitle">الاختبار الآمن</h2>
      <div class="top-meta">
        <div id="ambient-save-status" class="ambient-status status-idle"><span class="ambient-dot"></span><span class="ambient-txt">جاهز ومؤمّن</span></div>
        <span class="timer" id="timer">30:00</span>
      </div>
    </div>
    <div class="q-navigation" id="qPagerDots"></div>
    <div id="questions"></div>
    
    <div class="q-slider-actions">
      <button class="nav-btn-alt" id="sliderPrevBtn" type="button" disabled title="السابق" aria-label="السابق">&#8594;</button>
      <button class="nav-btn-alt" id="sliderNextBtn" type="button" title="التالي" aria-label="التالي">&#8592;</button>
    </div>
    
    <div class="actions">
      <button class="submit" id="submitBtn" type="button">تسليم الاختبار</button>
      <a class="quit" href="${xmlEscape(quitUrl)}">انسحاب من الاختبار</a>
    </div>
  </section>
  <section id="result" class="hidden">
    <div class="shield">✓</div>
    <h1>تم تسليم الاختبار</h1>
    <div class="status" id="resultBox">تم حفظ التسليم. يمكنك الخروج من SEB بأمان.</div>
    <a class="quit" href="${xmlEscape(quitUrl)}">الخروج الآمن من SEB</a>
  </section>
</div>
<script>
const boot=${boot};
let studentId="";
let examId=boot.examId;
let startTime=Date.now();
let answers={};
let timerId=null;
let allQuestions=[];
let activeQIndex=0;
let syncTimeout=null;
let activeExamSessionId="";
let examHeartbeatTimer=null;

function el(id){return document.getElementById(id);}
function show(id){el(id).classList.remove("hidden");}
function hide(id){el(id).classList.add("hidden");}
function text(id,value){el(id).textContent=value;}
function deviceId(){
  try {
    const key="mirasDeviceTokenV1";
    let value=localStorage.getItem(key);
    if(!value){value="miras-"+Date.now()+"-"+Math.random().toString(36).slice(2);localStorage.setItem(key,value);}
    return value;
  } catch { return "miras-seb-rescue-"+Date.now(); }
}
function displayMode(){
  try {
    return (window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||window.navigator.standalone ? "pwa" : "browser";
  } catch(e) { return "browser"; }
}
function examSessionId(){
  if(!activeExamSessionId) activeExamSessionId="seb-"+Date.now()+"-"+Math.random().toString(36).slice(2);
  return activeExamSessionId;
}
function headers(){
  return {
    "Content-Type":"application/json",
    "x-safe-exam-browser":"SafeExamBrowser",
    "x-miras-seb-armed":"1",
    "x-miras-seb-token":boot.token,
    "x-miras-seb-pass":boot.token,
    "x-miras-device-id":deviceId(),
    "x-miras-exam-session-id":activeExamSessionId||"",
    "x-miras-display-mode":displayMode()
  };
}
function stopExamHeartbeat(){
  if(examHeartbeatTimer){clearInterval(examHeartbeatTimer);examHeartbeatTimer=null;}
}
async function sendExamHeartbeat(){
  if(!studentId||!examId||!activeExamSessionId) return;
  try {
    const resp=await fetch("/api/exam-lock/heartbeat",{method:"POST",headers:headers(),body:JSON.stringify({studentId,examId,sessionId:activeExamSessionId,deviceId:deviceId(),displayMode:displayMode()})});
    if(!resp.ok){
      const data=await resp.json().catch(()=>({}));
      stopExamHeartbeat();
      hide("exam");show("intro");
      setError(data.error||"انتهت جلسة الاختبار.");
    }
  } catch(e) {}
}
function startExamHeartbeat(){
  stopExamHeartbeat();
  sendExamHeartbeat();
  examHeartbeatTimer=setInterval(sendExamHeartbeat,3000);
}
function sendExamLockRelease(status,reason){
  if(!studentId||!examId||!activeExamSessionId) return;
  const payload={studentId,examId,sessionId:activeExamSessionId,deviceId:deviceId(),displayMode:displayMode(),status,reason};
  try {
    const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
    if(navigator.sendBeacon) navigator.sendBeacon("/api/exam-lock/release",blob);
    else fetch("/api/exam-lock/release",{method:"POST",headers:headers(),body:JSON.stringify(payload),keepalive:true}).catch(()=>undefined);
  } catch(e) {}
}
function setStatus(message){text("statusBox",message);show("statusBox");hide("errorBox");}
function setError(message){text("errorBox",message+" إذا استمرت المشكلة استخدم خروج آمن وأبلغ المراقب. كلمة الخروج: CBE");show("errorBox");hide("statusBox");}

function recedeTimer(){
  const timer=el("timer");
  if(timer){
    timer.classList.add("receding");
    clearTimeout(window.timerRecedTimeout);
    window.timerRecedTimeout=setTimeout(()=>{
      timer.classList.remove("receding");
    },3000);
  }
}

function startTimer(minutes){
  let left=Math.max(1,Number(minutes)||30)*60;
  const timer=el("timer");
  const render=()=>{
    const m=Math.floor(left/60),s=String(left%60).padStart(2,"0");
    text("timer",m+":"+s);
    if(left<=300){
      timer.classList.add("critical-warning");
    } else {
      timer.classList.remove("critical-warning");
    }
  };
  render();
  timerId=setInterval(()=>{
    left-=1;
    render();
    if(left<=0){
      clearInterval(timerId);
      submitExam();
    }
  },1000);
}

function startSyncAnswers(){
  const statusEl=el("ambient-save-status");
  if(!statusEl) return;
  statusEl.className="ambient-status status-saving";
  statusEl.querySelector(".ambient-txt").textContent="جارٍ الحفظ محليًا…";
  
  try {
    localStorage.setItem("miras-draft-answers-"+examId,JSON.stringify(answers));
  } catch(e){}
  
  clearTimeout(syncTimeout);
  syncTimeout=setTimeout(async ()=>{
    try {
      const resp=await fetch("/api/quizzes/save-draft",{
        method:"POST",
        headers:headers(),
        body:JSON.stringify({studentId,chapterId:examId,answers,examSessionId:activeExamSessionId,displayMode:displayMode()})
      });
      if(resp.ok){
        statusEl.className="ambient-status status-synced";
        statusEl.querySelector(".ambient-txt").textContent="تمت المزامنة والحفظ بنجاح";
        updateProgressIndicators();
        setTimeout(()=>{
          if(statusEl.className.indexOf("status-synced") !== -1){
            statusEl.className="ambient-status status-idle";
          }
        },2000);
      } else {
        throw new Error("offline");
      }
    } catch(err){
      statusEl.className="ambient-status status-offline";
      statusEl.querySelector(".ambient-txt").textContent="انقطاع الاتصال (تم التأمين محليًا)";
      updateProgressIndicators();
    }
  },800);
}

function updateProgressIndicators(){
  allQuestions.forEach((q,idx)=>{
    const id=String(q.id||("q-"+idx));
    const dot=el("dot-"+idx);
    if(dot){
      if(answers[id]!==undefined && String(answers[id]).trim()!==""){
        dot.classList.add("answered");
      } else {
        dot.classList.remove("answered");
      }
    }
  });
}

function showQuestion(targetIdx){
  if(targetIdx<0 || targetIdx>=allQuestions.length) return;
  activeQIndex=targetIdx;
  
  document.querySelectorAll(".question-slide").forEach((slide, sIdx)=>{
    if(sIdx===targetIdx){
      slide.classList.remove("hidden");
    } else {
      slide.classList.add("hidden");
    }
  });
  
  document.querySelectorAll(".pager-dot").forEach((dot, dIdx)=>{
    dot.classList.remove("active-dot");
    if(dIdx===targetIdx) dot.classList.add("active-dot");
  });
  
  el("sliderPrevBtn").disabled=(targetIdx===0);
  el("sliderNextBtn").disabled=(targetIdx===allQuestions.length-1);
}

function renderQuestions(questions, title, minutes){
  allQuestions=questions;
  hide("intro");show("exam");text("examTitle",title||"الاختبار الآمن");startTimer(minutes);
  
  const pagerWrap=el("qPagerDots");pagerWrap.textContent="";
  const wrap=el("questions");wrap.textContent="";
  
  questions.forEach((q,idx)=>{
    const id=String(q.id||("q-"+idx));
    
    // Create pager dot
    const dot=document.createElement("button");
    dot.type="button";dot.id="dot-"+idx;dot.className="pager-dot";
    dot.textContent=String(idx+1);
    dot.addEventListener("click",()=>{showQuestion(idx);recedeTimer();});
    pagerWrap.appendChild(dot);
    
    // Create question slide
    const card=document.createElement("div");
    card.className="question question-slide"+(idx===0?"":" hidden");
    
    const head=document.createElement("div");head.className="qhead";
    head.innerHTML="<span>السؤال "+(idx+1)+" من "+questions.length+"</span><span>"+(q.points||1)+" درجة</span>";
    card.appendChild(head);
    
    const qtext=document.createElement("p");qtext.className="qtext";qtext.textContent=q.questionText||"سؤال";
    card.appendChild(qtext);
    
    if((q.type==="multiple-choice"||q.type==="true-false") && Array.isArray(q.options) && q.options.length){
      const choices=document.createElement("div");choices.className="choices";
      q.options.forEach(opt=>{
        const btn=document.createElement("button");btn.type="button";btn.className="choice";btn.textContent=String(opt);
        btn.addEventListener("click",()=>{
          answers[id]=String(opt);
          choices.querySelectorAll(".choice").forEach(x=>x.classList.remove("selected"));
          btn.classList.add("selected");
          recedeTimer();
          startSyncAnswers();
        });
        choices.appendChild(btn);
      });
      card.appendChild(choices);
    } else {
      const input=document.createElement(q.type==="short-answer" ? "input" : "textarea");
      input.addEventListener("input",()=>{
        answers[id]=input.value;
        recedeTimer();
        startSyncAnswers();
      });
      card.appendChild(input);
    }
    wrap.appendChild(card);
  });
  
  showQuestion(0);
}

let busy=false;
let rescueTimer=null;
async function startExam(){
  if(busy) return;
  busy=true;
  hide("rescueBox");
  if(rescueTimer){clearTimeout(rescueTimer);rescueTimer=null;}
  rescueTimer=setTimeout(()=>{show("rescueBox");},8000);
  try {
    el("startBtn").disabled=true;
    setStatus("جاري فتح الجلسة الآمنة وتحميل الأسئلة...");
    const validateResp=await fetch("/api/seb/validate",{method:"POST",headers:headers(),body:JSON.stringify({sebToken:boot.token,seb:"1",miras_seb:"1"})});
    const session=await validateResp.json().catch(()=>({}));
    if(!validateResp.ok) throw new Error(session.error||"تعذر تفعيل جلسة SEB.");
    studentId=String(session.student&&session.student.id||"");
    examId=String(session.sebSession&&session.sebSession.examId||session.exam&&session.exam.id||boot.examId);
    activeExamSessionId=examSessionId();
    const lockResp=await fetch("/api/exam-lock/acquire",{method:"POST",headers:headers(),body:JSON.stringify({studentId,examId,sessionId:activeExamSessionId,deviceId:deviceId(),displayMode:displayMode()})});
    const lockData=await lockResp.json().catch(()=>({}));
    if(!lockResp.ok) throw new Error(lockData.error||"الاختبار مفتوح في جلسة أخرى.");
    activeExamSessionId=String(lockData.activeExamSessionId||activeExamSessionId);
    const quizResp=await fetch("/api/quizzes/generate?studentId="+encodeURIComponent(studentId)+"&chapterId="+encodeURIComponent(examId)+"&examSessionId="+encodeURIComponent(activeExamSessionId)+"&displayMode="+encodeURIComponent(displayMode()),{headers:headers(),cache:"no-store"});
    const quiz=await quizResp.json().catch(()=>({}));
    if(!quizResp.ok) throw new Error(quiz.error||"تعذر تحميل أسئلة الاختبار.");
    if(!Array.isArray(quiz.questions)||!quiz.questions.length) throw new Error("لم تصل أسئلة لهذا الاختبار.");
    if(rescueTimer){clearTimeout(rescueTimer);rescueTimer=null;}
    hide("rescueBox");
    startTime=Date.now();
    renderQuestions(quiz.questions, session.exam&&session.exam.title, session.exam&&session.exam.timerMinutes);
    startExamHeartbeat();
  } catch(err) {
    if(rescueTimer){clearTimeout(rescueTimer);rescueTimer=null;}
    el("startBtn").disabled=false;
    setError(err&&err.message?err.message:"تعذر تحميل الاختبار.");
    show("rescueBox");
  } finally {
    busy=false;
  }
}
async function submitExam(){
  try {
    if(timerId) clearInterval(timerId);
    el("submitBtn").disabled=true;
    const resp=await fetch("/api/quizzes/submit",{method:"POST",headers:headers(),body:JSON.stringify({studentId,chapterId:examId,answers,startTime,deviceToken:deviceId(),examSessionId:activeExamSessionId,displayMode:displayMode()})});
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error(data.error||"تعذر تسليم الاختبار.");
    stopExamHeartbeat();
    hide("exam");show("result");
    const submission=data.submission||{};
    const savedScore=submission.score!==undefined?submission.score:(submission.percentage!==undefined?submission.percentage:"تم التسليم");
    text("resultBox",data.gradeVisible?"تم حفظ التسليم. النتيجة: "+savedScore:"تم حفظ التسليم وإغلاق المحاولة.");
  } catch(err) {
    el("submitBtn").disabled=false;
    alert((err&&err.message?err.message:"تعذر تسليم الاختبار.")+"\\nاستخدم خروج آمن إذا استمرت المشكلة. كلمة الخروج: CBE");
  }
}

el("sliderPrevBtn").addEventListener("click",()=>{
  showQuestion(activeQIndex-1);
  recedeTimer();
});
el("sliderNextBtn").addEventListener("click",()=>{
  showQuestion(activeQIndex+1);
  recedeTimer();
});
el("startBtn").addEventListener("click",startExam);
el("submitBtn").addEventListener("click",submitExam);

document.querySelectorAll("a.quit").forEach(function(link){
  link.addEventListener("click",function(){
    try {
      navigator.sendBeacon && navigator.sendBeacon("/api/seb/close", new Blob([JSON.stringify({sebToken:boot.token,reason:"explicit-quit-link"})], {type:"application/json"}));
    } catch(e) {}
    sendExamLockRelease("violated","explicit-quit-link");
  });
});

window.addEventListener("pagehide",function(){
  if(!activeExamSessionId) return;
  try {
    navigator.sendBeacon && navigator.sendBeacon("/api/exam-lock/heartbeat", new Blob([JSON.stringify({studentId,examId,sessionId:activeExamSessionId,deviceId:deviceId(),displayMode:displayMode()})], {type:"application/json"}));
  } catch(e) {}
});

// Periodic check for internet reconnection to upload draft answers if offline
setInterval(async () => {
  const statusEl = el("ambient-save-status");
  if (statusEl && statusEl.classList.contains("status-offline") && navigator.onLine) {
    try {
      const resp = await fetch("/api/quizzes/save-draft", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ studentId, chapterId: examId, answers, examSessionId: activeExamSessionId, displayMode: displayMode() })
      });
      if(resp.ok) {
        statusEl.className = "ambient-status status-restored";
        statusEl.querySelector(".ambient-txt").textContent = "تم استعادة الاتصال والمزامنة بنجاح!";
        updateProgressIndicators();
        setTimeout(() => {
          statusEl.className = "ambient-status status-idle";
        }, 2500);
      }
    } catch(e){}
  }
}, 5000);
</script>
</body>
</html>`;
}
function buildSebBrowserLaunchUrl(req: express.Request, token: string): string {
  return buildAbsoluteServerUrl(
    req,
    `/seb/launch?token=${encodeURIComponent(token)}`,
  );
}
function safeSebFilePart(value: any): string {
  return (
    String(value || "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 80) || "exam"
  );
}
function buildSebFileName(pass: SebPass): string {
  return `miras-seb-${safeSebFilePart(pass.courseCode)}-${safeSebFilePart(pass.examId)}-${safeSebFilePart(pass.attemptId)}.seb`;
}
function getSebConfigTokenFromRequest(req: express.Request): string {
  return String(
    req.params?.token ||
      req.query.token ||
      req.query.seb_token ||
      req.query.seb_pass ||
      req.query.seb_config_token ||
      "",
  ).trim();
}
function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function validateSebLaunchInput(req: express.Request) {
  const studentId = normalizeStudentId(
    req.body?.studentId || req.query?.studentId,
  );
  const examId = String(req.body?.examId || req.query?.examId || "").trim();
  const courseCode = String(
    req.body?.courseCode || req.query?.courseCode || "",
  ).trim();
  const ownerEmail = String(
    req.body?.ownerEmail ||
      req.body?.teacherEmail ||
      req.query?.ownerEmail ||
      req.query?.teacherEmail ||
      "",
  )
    .trim()
    .toLowerCase();
  const student = dbInstance
    .getStudents()
    .find((s: any) => String(s.id) === studentId);
  const exam = dbInstance
    .getTeacherExams()
    .find((item: any) => String(item.id) === examId);
  if (!studentId || !examId || !courseCode)
    return { error: "بيانات جلسة SEB ناقصة.", status: 400 } as any;
  if (!student || !exam)
    return {
      error: "تعذر تجهيز جلسة SEB لهذا الطالب أو الاختبار.",
      status: 404,
    } as any;
  if (String(exam.courseCode || "").toLowerCase() !== courseCode.toLowerCase())
    return {
      error: "هذا الاختبار لا يتبع المقرر المطلوب.",
      status: 403,
    } as any;
  const teacherAuthorizedSebReturn = hasTeacherAuthorizedSebReturnException(
    examId,
    student.id,
  );
  if (!studentHasEnrollmentInCourse(student, courseCode) && !teacherAuthorizedSebReturn)
    return {
      error: "هذا المقرر غير مفعل لهذا الطالب بالكود الأصلي.",
      status: 403,
    } as any;
  const examOwner = String(
    (exam as any).ownerEmail ||
      (exam as any).teacherEmail ||
      sectionOwnerEmail(courseCode) ||
      "",
  )
    .trim()
    .toLowerCase();
  if (ownerEmail && examOwner && ownerEmail !== examOwner)
    return {
      error: "هذا الاختبار لا يتبع الأستاذ المطلوب.",
      status: 403,
    } as any;
  return {
    student,
    exam,
    studentId,
    examId,
    courseCode,
    ownerEmail: examOwner || ownerEmail,
  } as any;
}
function createSebLaunchFromActivatedSession(req: express.Request) {
  const checked: any = validateSebLaunchInput(req);
  if (checked.error) return checked;
  if (!checked.exam?.seb?.enabled)
    return {
      error: "هذا الاختبار غير مفعّل لاستخدام Safe Exam Browser.",
      status: 400,
    } as any;
  const now = Date.now();
  // استثناء دقيق فقط عند إرجاع/سماح المعلم للطالب بالدخول من جديد:
  // لا نغيّر منطق SEB الأساسي، لكن لا نُظهر رسالة المنع في هذا المسار المصرح من المعلم.
  const activeReturnException = getActiveReturnException(
    "exam",
    checked.exam.id,
    checked.student.id,
  );
  const teacherAuthorizedSebReturn = Boolean(
    activeReturnException ||
      isExamReturnedForStudent(checked.exam.id, checked.student.id),
  );
  if (checked.exam.open && new Date(checked.exam.open).getTime() > now)
    return { error: "لم يبدأ وقت إتاحة هذا الاختبار بعد.", status: 403 } as any;
  if (
    checked.exam.close &&
    new Date(checked.exam.close).getTime() + 24 * 60 * 60 * 1000 < now &&
    !teacherAuthorizedSebReturn
  )
    return { error: "انتهى وقت إتاحة هذا الاختبار.", status: 403 } as any;
  const sessionValidation = validateSessionFingerprint(req, checked.student);
  if (!sessionValidation.isValid && !teacherAuthorizedSebReturn)
    return {
      error:
        sessionValidation.error ||
        "لا يمكن إنشاء جلسة SEB إلا من الجهاز الأصلي المفعّل.",
      status: 403,
    } as any;
  const examTimerMinutes = Math.max(
    1,
    Number(
      (checked.exam as any).antiCheat?.timerMinutes ??
        (checked.exam as any).timerMinutes,
    ) || 30,
  );
  const pass = createSebPass({
    studentId: checked.studentId,
    examId: checked.examId,
    courseCode: checked.courseCode,
    ownerEmail: checked.ownerEmail,
    teacherEmail: checked.ownerEmail,
    originalDeviceId:
      getRequestDeviceToken(req) || getRequestDeviceFingerprint(req),
    expiryMinutes: examTimerMinutes + 5,
  });
  logSebEvent({
    studentId: checked.student.id,
    studentName: checked.student.name,
    action: "إنشاء نفق SEB",
    details: teacherAuthorizedSebReturn
      ? `تم إنشاء جلسة اختبار مؤقتة للاختبار ${checked.examId} في مقرر ${checked.courseCode} عبر استثناء إرجاع مصرح من المعلم دون تغيير ربط الكود أو الجهاز الأصلي.`
      : `تم إنشاء جلسة اختبار مؤقتة للاختبار ${checked.examId} في مقرر ${checked.courseCode} دون تغيير ربط الكود أو الجهاز الأصلي.`,
    req,
  });
  return {
    pass,
    student: checked.student,
    exam: checked.exam,
    startUrl: buildSebStartUrl(req, pass.token),
    quitUrl: buildSebQuitUrl(req, pass.token),
    configUrl: buildSebConfigUrl(pass.token),
  } as any;
}
function isSoftDeletedRecord(item: any): boolean {
  if (!item) return false;
  const status = String(item.status || "").trim().toLowerCase();
  return Boolean(
    item.deleted === true ||
      item.isDeleted === true ||
      item.deletedAt ||
      item.archivedAt ||
      item.revokedAt ||
      status === "deleted" ||
      status === "removed"
  );
}

function isArchivedJoinCodeRecord(jc: any): boolean {
  if (!jc) return false;
  const status = String(jc.status || "").trim().toLowerCase();
  return Boolean(
    jc.archived === true ||
      jc.isArchived === true ||
      jc.archivedAt ||
      jc.retiredAt ||
      jc.retiredReason ||
      status === "retired" ||
      status === "archived" ||
      status === "archive"
  );
}

function isUsableJoinCodeRecord(jc: any): boolean {
  return !!jc && !isSoftDeletedRecord(jc) && !isArchivedJoinCodeRecord(jc);
}

function isOperationalJoinCodeRecord(jc: any): boolean {
  if (!isUsableJoinCodeRecord(jc)) return false;
  const course = joinCodeCourse(jc);
  if (!course || course.toLowerCase() === "all") return true;
  return sectionStillExists(course);
}

function joinCodeCourse(jc: any): string {
  return String(jc?.sectionCode || jc?.studentSection || jc?.courseCode || "").trim();
}

function joinCodeLinkedToStudent(jc: any, studentIds: Set<string>): boolean {
  if (!jc || !studentIds?.size) return false;
  const linkedIds = [jc.studentId, jc.usedByStudentId, jc.assignedStudentId]
    .map((value: any) => normalizeStudentId(value))
    .filter(Boolean);
  return linkedIds.some((value: string) => studentIds.has(value));
}

function activatedCourseCodesForStudent(student: any, extraCourseCode?: any): string[] {
  const codes: string[] = [];
  const add = (value: any) => {
    const code = String(value || "").trim();
    if (!code || code.toLowerCase() === "all") return;
    if (!codes.some((existing) => sectionCodeEquivalent(existing, code))) codes.push(code);
  };
  (Array.isArray(student?.activatedCourseCodes) ? student.activatedCourseCodes : []).forEach(add);
  add(extraCourseCode);
  const activationCode = compactJoinCode(student?.activationCode || "");
  if (activationCode) {
    try {
      dbInstance.getJoinCodes().forEach((jc: any) => {
        if (!isUsableJoinCodeRecord(jc)) return;
        if (compactJoinCode(jc?.code || "") === activationCode)
          add(joinCodeCourse(jc));
      });
    } catch {}
  }
  return codes;
}

function buildPersistentStudentEnrollment(student: any, courseCode: any, source: string = "activation") {
  const code = String(courseCode || "").trim();
  if (!code || code.toLowerCase() === "all") return null;
  const sec: any = sectionForCourseCode(code) || resolveSectionForStudentGate(code);
  const teacherEmail = sec?.ownerEmail || extractEmailFromSectionCode(code) || sectionOwnerEmail(code);
  return {
    courseCode: code,
    sectionCode: code,
    studentSection: code,
    teacherEmail,
    teacherName:
      dbInstance.getTeachers().find((t: any) => String(t.email || "").toLowerCase() === String(teacherEmail || "").toLowerCase())?.name ||
      sec?.teacherName ||
      "",
    courseName: sec?.courseName || sec?.name || sectionDisplayCode(code) || code,
    status: "active",
    isActive: true,
    isLocked: false,
    isOpen: true,
    activatedAt: new Date().toISOString(),
    source,
  };
}

function mergePersistentStudentEnrollment(student: any, courseCode: any, source: string = "activation") {
  const next = buildPersistentStudentEnrollment(student, courseCode, source);
  const current = Array.isArray(student?.enrollments) ? student.enrollments : [];
  if (!next) return current;
  let found = false;
  const merged = current
    .filter((entry: any) => entry && typeof entry === "object")
    .map((entry: any) => {
      const entryCode = entry.courseCode || entry.sectionCode || entry.studentSection;
      if (sectionCodeEquivalent(entryCode, next.courseCode)) {
        found = true;
        // كل إدخال كود هو دورة عضوية جديدة. الاحتفاظ بتاريخ التفعيل القديم كان
        // يجعل علامة حذف من دورة سابقة أحدث منه، فتعتبر الحالة الحية الطالب
        // محذوفاً لاحقاً وتُسقط المشاريع والاختبارات. تاريخ التفعيل الجديد هو
        // المرجع دائماً عند إعادة ربط نفس المقرر.
        return { ...entry, ...next, activatedAt: next.activatedAt };
      }
      return entry;
    });
  if (!found) merged.push(next);
  return merged;
}

function buildStudentActivationPersistencePatch(student: any, courseCode: any) {
  const code = String(courseCode || student?.sectionCode || "").trim();
  const activatedCourseCodes = activatedCourseCodesForStudent(student, code);
  const remainingRemovalLinks = canonicalStudentRemovedCourseLinks(student).filter(
    (entry: any) =>
      !courseMatchesRemovalTarget(
        entry?.courseCode || entry?.sectionCode || entry?.studentSection,
        code,
        entry?.teacherEmail || sectionOwnerEmail(code),
      ),
  );
  const activatedAt = new Date().toISOString();
  const patch: any = {
    activatedCourseCodes,
    enrollments: mergePersistentStudentEnrollment(student, code).map((entry: any) => {
      const entryCode = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      return courseMatchesRemovalTarget(entryCode, code, entry?.teacherEmail || sectionOwnerEmail(code))
        ? { ...entry, activatedAt }
        : entry;
    }),
    // التفعيل بالكود هو قرار سحابي نهائي لدورة العضوية الحالية؛ نمسح في نفس
    // عملية الحفظ كل صور علامة الحذف القديمة حتى لا تعيد إحداها إلغاء التفعيل.
    removedCourseLinks: remainingRemovalLinks,
    removedEnrollments: remainingRemovalLinks,
    deletedCourseLinks: remainingRemovalLinks,
    studentSection: code || student?.studentSection || student?.sectionCode || "",
    lastCourseActivationAt: activatedAt,
    courseVisibilitySyncedAt: activatedAt,
  };
  if (!String(student?.sectionCode || "").trim() && code) patch.sectionCode = code;
  return patch;
}

function buildActivationCoursePayload(courseCode: any) {
  const code = String(courseCode || "").trim();
  const sec: any = sectionForCourseCode(code) || resolveSectionForStudentGate(code);
  const teacherEmail = String(
    sec?.ownerEmail || extractEmailFromSectionCode(code) || sectionOwnerEmail(code) || "",
  ).toLowerCase();
  const teacher = dbInstance
    .getTeachers()
    .find((t: any) => String(t.email || "").toLowerCase() === teacherEmail);
  return {
    courseCode: code,
    sectionCode: code,
    studentSection: code,
    courseName: String(sec?.courseName || sec?.name || sectionDisplayCode(code) || code || "المقرر").trim(),
    teacherEmail,
    teacherName: teacher?.name || sec?.teacherName || "",
    isOpen: code ? isSectionOpenForStudents(code, { ownerEmail: teacherEmail }) : true,
  };
}

function activationFailurePayload(code: string, error: string, extra: Record<string, any> = {}) {
  return {
    success: false,
    code,
    reason: code,
    error,
    message: error,
    ...extra,
  };
}

function buildStudentActivationSuccessPayload(
  req: express.Request,
  res: express.Response,
  student: any,
  courseCode: any,
  enrollments: any[],
  message: string,
  extra: Record<string, any> = {},
) {
  const resolvedCourseCode = String(courseCode || student?.sectionCode || "").trim();
  const authToken = createStudentAuthPayload(req, res, student);
  const activatedCourseCodes = activatedCourseCodesForStudent(student, resolvedCourseCode);
  const course = buildActivationCoursePayload(resolvedCourseCode);
  const responseStudent = {
    ...student,
    authToken,
    isPaid: true,
    isActivated: true,
    sectionCode: String(student?.sectionCode || "").trim() || resolvedCourseCode,
    studentSection: String(student?.studentSection || "").trim() || resolvedCourseCode,
    activatedCourseCodes,
    enrollments,
  };
  const session = {
    role: "student",
    userId: String(student?.id || ""),
    studentId: String(student?.id || ""),
    authToken,
    nextView: "student_workspace",
  };
  return {
    success: true,
    authToken,
    role: "student",
    nextView: "student_workspace",
    courseCode: resolvedCourseCode,
    sectionCode: resolvedCourseCode,
    course,
    enrollments,
    student: responseStudent,
    session,
    userContext: session,
    message,
    ...extra,
  };
}

function markStudentCourseActivated(student: any, courseCode: any) {
  const target = String(courseCode || "").trim();
  if (!student?.id || !target || target.toLowerCase() === "all") return student;
  const nextCourses = activatedCourseCodesForStudent(student, target);
  dbInstance.updateStudent(student.id, {
    activatedCourseCodes: nextCourses,
    lastCourseActivationAt: new Date().toISOString(),
  } as any);
  return (
    dbInstance.getStudents().find((st: any) => String(st.id) === String(student.id)) || {
      ...student,
      activatedCourseCodes: nextCourses,
    }
  );
}


function courseMatchesRemovalTarget(storedCourse: any, targetCourse: any, teacherEmail?: any): boolean {
  const stored = String(storedCourse || "").trim();
  const target = String(targetCourse || "").trim();
  if (!stored || !target) return false;
  const owner = String(teacherEmail || "").trim().toLowerCase();
  if (owner) return courseCodeMatchesForTeacher(stored, target, owner);
  const storedOwner = extractEmailFromSectionCode(stored);
  const targetOwner = extractEmailFromSectionCode(target);
  if (storedOwner && targetOwner && storedOwner !== targetOwner) return false;
  return sectionCodeEquivalent(stored, target);
}

function getStudentRemovedCourseLinks(student: any): any[] {
  const pools = [
    student?.removedCourseLinks,
    student?.removedEnrollments,
    student?.deletedCourseLinks,
  ];
  return pools.flatMap((value: any) => (Array.isArray(value) ? value : []));
}

function canonicalStudentRemovedCourseLinks(student: any): any[] {
  const deduped = new Map<string, any>();
  getStudentRemovedCourseLinks(student).forEach((entry: any) => {
    if (!entry || typeof entry !== "object") return;
    const course = String(
      entry.courseCode || entry.sectionCode || entry.studentSection || "",
    ).trim();
    if (!course) return;
    const teacher = String(
      entry.teacherEmail || entry.ownerEmail || entry.removedBy || sectionOwnerEmail(course) || "",
    ).trim().toLowerCase();
    const studentId = normalizeStudentId(
      entry.studentId || student?.id || student?.idNumber || student?.studentId,
    );
    const key = `${studentId}|${course.toLowerCase()}|${teacher}`;
    const previous = deduped.get(key);
    const previousTime = Date.parse(String(previous?.removedAt || previous?.deletedAt || "")) || 0;
    const nextTime = Date.parse(String(entry.removedAt || entry.deletedAt || "")) || 0;
    if (!previous || nextTime >= previousTime) deduped.set(key, entry);
  });
  return Array.from(deduped.values());
}


function getStudentCourseCodeInvalidations(student: any): any[] {
  const pools = [
    student?.courseCodeInvalidations,
    student?.joinCodeInvalidations,
    student?.removedJoinCodeInvalidations,
  ];
  const explicit = pools.flatMap((value: any) => (Array.isArray(value) ? value : []));
  const removalFallback = canonicalStudentRemovedCourseLinks(student).map((entry: any) => ({
    ...entry,
    invalidatedAt: entry?.invalidatedAt || entry?.removedAt || entry?.deletedAt || "",
    invalidationReason: entry?.invalidationReason || "student_removed_from_course",
  }));
  return [...explicit, ...removalFallback].filter((entry: any) => entry && typeof entry === "object");
}

function invalidatedJoinCodeCompactsFromEntry(entry: any): Set<string> {
  const values = [
    entry?.code,
    entry?.joinCode,
    entry?.activationCode,
    ...(Array.isArray(entry?.invalidatedJoinCodes) ? entry.invalidatedJoinCodes : []),
    ...(Array.isArray(entry?.invalidatedJoinCodeCompacts) ? entry.invalidatedJoinCodeCompacts : []),
    ...(Array.isArray(entry?.codes) ? entry.codes : []),
  ];
  return new Set(values.map((value: any) => compactJoinCode(value)).filter(Boolean));
}

function latestStudentCourseCodeInvalidation(student: any, courseCode: any, teacherEmail?: any) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return { time: 0, at: "", codes: new Set<string>(), entry: null as any };
  let latest = { time: 0, at: "", codes: new Set<string>(), entry: null as any };
  getStudentCourseCodeInvalidations(student).forEach((entry: any) => {
    const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
    const entryTeacher = entry?.teacherEmail || entry?.ownerEmail || entry?.removedBy || teacherEmail;
    if (!courseMatchesRemovalTarget(entryCourse, course, entryTeacher || teacherEmail)) return;
    const at = String(entry?.invalidatedAt || entry?.removedAt || entry?.deletedAt || entry?.createdAt || "");
    const time = Date.parse(at) || 0;
    if (!latest.time || !time || time >= latest.time) {
      latest = {
        time,
        at,
        codes: invalidatedJoinCodeCompactsFromEntry(entry),
        entry,
      };
    }
  });
  return latest;
}

function joinCodeLifecycleTime(jc: any): number {
  return (
    Date.parse(String(jc?.activatedAt || jc?.usedAt || "")) ||
    Date.parse(String(jc?.createdAt || jc?.issuedAt || jc?.reissuedAt || "")) ||
    0
  );
}


function joinCodeIsConsumedRecord(jc: any): boolean {
  if (!jc) return false;
  const status = String(jc?.status || "").trim().toLowerCase();
  return Boolean(
    status === "used" ||
      status === "active-used" ||
      status === "activated" ||
      String(jc?.activatedAt || jc?.usedAt || "").trim() ||
      String(jc?.usedByStudentId || "").trim(),
  );
}

function joinCodeLockedActivationCourse(jc: any): string {
  if (!jc) return "";
  const candidates = [
    jc?.resolvedCourseCode,
    jc?.activatedCourseCode,
    jc?.sectionCode,
    jc?.courseCode,
    jc?.studentSection,
  ];
  for (const value of candidates) {
    const code = String(value || "").trim();
    if (code && code.toLowerCase() !== "all") return code;
  }
  return "";
}

function consumedJoinCodeMatchesCourse(jc: any, courseCode: any, teacherEmail?: any): boolean {
  const course = String(courseCode || "").trim();
  if (!joinCodeIsConsumedRecord(jc) || !course || course.toLowerCase() === "all") return false;
  const lockedCourse = joinCodeLockedActivationCourse(jc);
  if (!lockedCourse) return false;
  return courseMatchesRemovalTarget(
    lockedCourse,
    course,
    teacherEmail || joinCodeOwnerEmail(jc),
  );
}

function joinCodeIsStaleForStudentCourse(jc: any, student: any, courseCode: any, teacherEmail?: any): boolean {
  if (!jc || !student) return false;
  const course = String(courseCode || "").trim();
  if (!course || course.toLowerCase() === "all") return false;
  const invalidation = latestStudentCourseCodeInvalidation(student, course, teacherEmail);
  if (!invalidation.time && !invalidation.codes.size) return false;
  const compact = compactJoinCode(jc?.code || "");
  if (compact && invalidation.codes.has(compact)) return true;
  if (!joinCodeMatchesStudentCourseIgnoringRemoval(jc, student, course, teacherEmail)) return false;
  const lifecycleTime = joinCodeLifecycleTime(jc);
  // أي كود وُلد/استُخدم قبل حذف الطالب من المقرر ينتمي لدورة عضوية قديمة.
  // عند إعادة إضافة الطالب يجب قبول كود جديد فقط؛ أما الكود القديم، حتى لو بقي
  // بالخطأ في الذاكرة أو عاد من مزامنة متأخرة، فلا يعيد فتح المقرر.
  return !lifecycleTime || !invalidation.time || lifecycleTime <= invalidation.time;
}

function buildStudentCourseCodeInvalidationPatch(
  student: any,
  courseCode: any,
  teacherEmail: any,
  linkedJoinCodes: any[] = [],
) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return {};
  const now = new Date().toISOString();
  const teacher = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  const invalidatedJoinCodes = Array.from(
    new Set(
      [
        ...(Array.isArray(linkedJoinCodes) ? linkedJoinCodes.map((jc: any) => jc?.code || jc) : []),
        student?.activationCode,
      ]
        .map((value: any) => normalizeJoinCode(value))
        .filter(Boolean),
    ),
  );
  const marker = {
    studentId: String(student?.id || student?.idNumber || student?.studentId || "").trim(),
    courseCode: course,
    sectionCode: course,
    studentSection: course,
    teacherEmail: teacher,
    invalidatedAt: now,
    removedAt: now,
    status: "invalidated",
    invalidationReason: "student_removed_from_course",
    invalidatedJoinCodes,
    invalidatedJoinCodeCompacts: invalidatedJoinCodes.map((value: any) => compactJoinCode(value)).filter(Boolean),
  };
  const existing = (Array.isArray(student?.courseCodeInvalidations) ? student.courseCodeInvalidations : [])
    .filter((entry: any) => {
      const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      const entryTeacher = entry?.teacherEmail || entry?.ownerEmail || entry?.removedBy || teacher;
      return !courseMatchesRemovalTarget(entryCourse, course, entryTeacher || teacher);
    });
  const next = [...existing, marker];
  return {
    courseCodeInvalidations: next,
    joinCodeInvalidations: next,
  };
}

function latestStudentCourseActivationTime(student: any, courseCode: any, teacherEmail?: any): number {
  const course = String(courseCode || "").trim();
  if (!student || !course) return 0;
  let latest = 0;
  const consider = (value: any) => {
    const time = Date.parse(String(value || "")) || 0;
    if (time > latest) latest = time;
  };
  if (Array.isArray(student?.enrollments)) {
    student.enrollments.forEach((entry: any) => {
      const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      if (courseMatchesRemovalTarget(entryCourse, course, entry?.teacherEmail || teacherEmail)) {
        consider(entry?.activatedAt || entry?.reactivatedAt);
      }
    });
  }
  try {
    dbInstance.getJoinCodes().forEach((jc: any) => {
      const status = String(jc?.status || "").toLowerCase();
      if (!["used", "active-used", "activated"].includes(status)) return;
      if (!joinCodeMatchesStudentCourseIgnoringRemoval(jc, student, course, teacherEmail)) return;
      consider(jc?.activatedAt || jc?.usedAt);
    });
  } catch {}
  return latest;
}

function joinCodeMatchesStudentCourseIgnoringRemoval(
  jc: any,
  student: any,
  courseCode: any,
  teacherEmail?: any,
): boolean {
  if (!jc || !student) return false;
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid || !joinCodeLinkedToStudent(jc, new Set([sid]))) return false;
  const owner = String(teacherEmail || joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
  const jcCourse = joinCodeCourse(jc);
  if (!jcCourse || !courseMatchesRemovalTarget(jcCourse, courseCode, owner || teacherEmail)) return false;
  const jcOwner = String(joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
  return !owner || !jcOwner || jcOwner === owner;
}

function isStudentCourseRemoved(student: any, courseCode: any, teacherEmail?: any): boolean {
  const course = String(courseCode || "").trim();
  if (!student || !course) return false;
  const latestActivation = latestStudentCourseActivationTime(student, course, teacherEmail);
  return canonicalStudentRemovedCourseLinks(student).some((entry: any) => {
    if (!entry || entry.restoredAt || entry.isRestored === true || entry.status === "restored") return false;
    const removedCourse = entry.courseCode || entry.sectionCode || entry.studentSection;
    const entryTeacher = entry.teacherEmail || entry.ownerEmail || entry.removedBy || teacherEmail;
    if (!courseMatchesRemovalTarget(removedCourse, course, entryTeacher || teacherEmail)) return false;
    const removedAt = Date.parse(String(entry.removedAt || entry.deletedAt || "")) || 0;
    // لو أعادت مزامنة سحابية متأخرة علامة حذف قديمة، لا يجوز لها إسقاط دورة
    // تفعيل أحدث. الحذف يبقى نافذاً فقط إن كان أحدث من آخر كود مُفعّل.
    return !latestActivation || !removedAt || removedAt >= latestActivation;
  });
}

function withoutRemovedStudentCourses(student: any, courses: string[], teacherEmail?: any): string[] {
  return courses.filter((course) => !isStudentCourseRemoved(student, course, teacherEmail));
}

function joinCodeMatchesStudentCourse(jc: any, student: any, courseCode: any, teacherEmail?: any): boolean {
  if (!jc || !student) return false;
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid) return false;
  if (!joinCodeLinkedToStudent(jc, new Set([sid]))) return false;
  const owner = String(teacherEmail || joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
  const jcCourse = joinCodeCourse(jc);
  if (!jcCourse || !courseMatchesRemovalTarget(jcCourse, courseCode, owner || teacherEmail)) return false;
  if (owner) {
    const jcOwner = String(joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
    if (jcOwner && jcOwner !== owner) return false;
  }
  return !isStudentCourseRemoved(student, jcCourse, owner || teacherEmail);
}

function getFreshJoinCodeForStudentCourse(student: any, courseCode: any, teacherEmail?: any): any | null {
  const course = String(courseCode || "").trim();
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!student || !course || !sid) return null;
  const expectedOwner = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  return (
    dbInstance.getJoinCodes().find((jc: any) => {
      if (!isUsableJoinCodeRecord(jc)) return false;
      const status = String(jc.status || "active").trim().toLowerCase();
      if (status !== "active") return false;
      const assigned = normalizeStudentId(jc.assignedStudentId || jc.studentId);
      if (assigned !== sid) return false;
      if (String(jc.activatedAt || jc.usedAt || "").trim()) return false;
      const jcCourse = joinCodeCourse(jc);
      const owner = String(joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
      const ownerMatches = expectedOwner ? !owner || owner === expectedOwner : true;
      // كود جديد ومخصص للطالب يعني ظهور "بانتظار التفعيل" حتى لو بقي أثر إزالة قديم؛ لا يتم تفعيله إلا بعد إدخال الكود.
      return ownerMatches && courseMatchesRemovalTarget(jcCourse, course, expectedOwner || owner || teacherEmail);
    }) || null
  );
}

function studentHasCurrentRosterCourseLink(student: any, courseCode: any, teacherEmail?: any): boolean {
  const course = String(courseCode || "").trim();
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!student || !course || !sid) return false;
  const owner = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  return dbInstance.getAllowedStudents().some((row: any) => {
    if (!row || isSoftDeletedRecord(row)) return false;
    const rowId = normalizeStudentId(row.id || row.idNumber || row.studentId);
    if (rowId !== sid) return false;
    const rowCourse = row.sectionCode || row.studentSection || row.courseCode || "";
    const rowOwner = String(row.teacherEmail || row.ownerEmail || sectionOwnerEmail(rowCourse) || "").trim().toLowerCase();
    if (owner && rowOwner && rowOwner !== owner) return false;
    return courseMatchesRemovalTarget(rowCourse, course, owner || rowOwner || teacherEmail);
  });
}

function studentHasOperationalUsedJoinCode(student: any, courseCode: any, teacherEmail?: any): boolean {
  const course = String(courseCode || "").trim();
  if (!student || !course) return false;
  return dbInstance.getJoinCodes().some((jc: any) => {
    if (!isUsableJoinCodeRecord(jc)) return false;
    const status = String(jc.status || "").toLowerCase();
    if (!["used", "active-used", "activated"].includes(status) && !String(jc.activatedAt || jc.usedAt || "").trim()) return false;
    return joinCodeMatchesStudentCourse(jc, student, course, teacherEmail);
  });
}

function studentHasPersistentActiveEnrollment(student: any, courseCode: any, teacherEmail?: any): boolean {
  const course = String(courseCode || "").trim();
  if (!student || !course || isStudentCourseRemoved(student, course, teacherEmail)) return false;
  if (!Array.isArray(student?.enrollments)) return false;
  return student.enrollments.some((entry: any) => {
    const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
    if (!courseMatchesRemovalTarget(entryCourse, course, entry?.teacherEmail || teacherEmail)) return false;
    const state = String(entry?.enrollmentState || entry?.status || "").trim().toLowerCase();
    if (
      entry?.isActive === false ||
      entry?.pendingActivation === true ||
      entry?.requiresJoinCode === true ||
      entry?.isSuspended === true ||
      entry?.isStudentSuspended === true ||
      entry?.isClosedByTeacher === true ||
      entry?.isCourseClosed === true ||
      entry?.isOpen === false ||
      [
        "pending_activation",
        "locked",
        "suspended",
        "student_suspended",
        "course_closed",
        "removed",
        "not_enrolled",
        "roster_only",
      ].includes(state)
    ) {
      return false;
    }
    return (
      entry?.isActive === true ||
      state === "active" ||
      !!entry?.activatedAt ||
      !!entry?.reactivatedAt ||
      String(entry?.source || "").toLowerCase().includes("activation")
    );
  });
}

function hasActivatedStudentCourseLink(student: any, courseCode: any, teacherEmail?: any): boolean {
  const course = String(courseCode || "").trim();
  if (!student || !course || isStudentCourseRemoved(student, course, teacherEmail)) return false;

  // لا يكفي وجود كود داخل student.activatedCourseCodes فقط، لكن لا يجوز أيضاً
  // إسقاط مقرر طالب مُفعّل فعلياً لأن صف الكشف أو سجل الكود القديم أُرشف بعد
  // التفعيل. لذلك نقبل ثلاثة أسانيد حالية: كشف قائم، كود مستخدم غير محذوف، أو
  // enrollment نشط محفوظ على الطالب مع تاريخ/مصدر تفعيل ولم يُحذف من المقرر.
  const hasCurrentRoster = studentHasCurrentRosterCourseLink(student, course, teacherEmail);
  const hasUsedJoinCode = studentHasOperationalUsedJoinCode(student, course, teacherEmail);
  const hasPersistentEnrollment = studentHasPersistentActiveEnrollment(student, course, teacherEmail);
  const hasCurrentMembershipAnchor = hasCurrentRoster || hasUsedJoinCode || hasPersistentEnrollment;
  if (!hasCurrentMembershipAnchor) return false;

  if (activatedCourseCodesForStudent(student).some((code) => courseMatchesRemovalTarget(code, course, teacherEmail))) return true;
  if (hasPersistentEnrollment) return true;
  return hasUsedJoinCode;
}

function buildStudentCourseRemovalPatch(student: any, courseCode: any, teacherEmail: any) {
  const course = String(courseCode || "").trim();
  const existing = canonicalStudentRemovedCourseLinks(student).filter(
    (entry: any) => !courseMatchesRemovalTarget(entry?.courseCode || entry?.sectionCode || entry?.studentSection, course, entry?.teacherEmail || teacherEmail),
  );
  const marker = {
    studentId: String(student?.id || student?.idNumber || "").trim(),
    courseCode: course,
    sectionCode: course,
    studentSection: course,
    teacherEmail: String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase(),
    removedAt: new Date().toISOString(),
    status: "removed",
  };
  const next = [...existing, marker];
  return {
    removedCourseLinks: next,
    removedEnrollments: next,
    deletedCourseLinks: next,
  };
}

function clearStudentCourseRemovalMarker(studentId: any, courseCode: any, teacherEmail?: any) {
  const sid = normalizeStudentId(studentId);
  const course = String(courseCode || "").trim();
  if (!sid || !course) return;
  const student = dbInstance.getStudents().find((st: any) => normalizeStudentId(st.id || st.idNumber || st.studentId) === sid);
  if (!student) return;
  const links = canonicalStudentRemovedCourseLinks(student);
  if (!links.length) return;
  const remaining = links.filter(
    (entry: any) => !courseMatchesRemovalTarget(entry?.courseCode || entry?.sectionCode || entry?.studentSection, course, entry?.teacherEmail || teacherEmail),
  );
  if (remaining.length !== links.length) {
    const patch: any = {
      removedCourseLinks: remaining,
      removedEnrollments: remaining,
      deletedCourseLinks: remaining,
    };
    if (
      (student as any).isAccessBlocked &&
      String((student as any).accessBlockReason || "") === "تم حذفك من المقرر الأخير المعين لك."
    ) {
      patch.isAccessBlocked = false;
      patch.accessBlockReason = "";
    }
    dbInstance.updateStudent(student.id, patch);
  }
}


function buildCleanStudentCourseReaddPatch(student: any, courseCode: any, teacherEmail?: any) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return {};
  const patch: any = {};
  const links = canonicalStudentRemovedCourseLinks(student);
  const remainingLinks = links.filter(
    (entry: any) => !courseMatchesRemovalTarget(entry?.courseCode || entry?.sectionCode || entry?.studentSection, course, entry?.teacherEmail || teacherEmail),
  );
  if (remainingLinks.length !== links.length) {
    patch.removedCourseLinks = remainingLinks;
    patch.removedEnrollments = remainingLinks;
    patch.deletedCourseLinks = remainingLinks;
  }

  const cleanArrayOfCourses = (arr: any[]) =>
    arr.filter((c: any) => !courseMatchesRemovalTarget(c, course, teacherEmail));
  const cleanEnrollmentArray = (arr: any[]) =>
    arr.filter((en: any) => !courseMatchesRemovalTarget(en?.courseCode || en?.sectionCode || en?.studentSection, course, en?.teacherEmail || teacherEmail));

  if (Array.isArray(student.activatedCourseCodes)) patch.activatedCourseCodes = cleanArrayOfCourses(student.activatedCourseCodes);
  if (Array.isArray(student.enrollments)) patch.enrollments = cleanEnrollmentArray(student.enrollments);
  if (Array.isArray(student.suspendedEnrollments)) patch.suspendedEnrollments = cleanEnrollmentArray(student.suspendedEnrollments);

  const currentActivationCode = compactJoinCode(student.activationCode || "");
  if (currentActivationCode) {
    const activationCodeBelongsToCourse = dbInstance.getJoinCodes().some((jc: any) => {
      if (compactJoinCode(jc?.code || "") !== currentActivationCode) return false;
      return courseMatchesRemovalTarget(joinCodeCourse(jc), course, teacherEmail);
    });
    if (activationCodeBelongsToCourse) patch.activationCode = "";
  }

  const remainingVisibleCourses = Array.from(new Set([
    ...(Array.isArray(patch.activatedCourseCodes) ? patch.activatedCourseCodes : Array.isArray(student.activatedCourseCodes) ? student.activatedCourseCodes : []),
    ...(Array.isArray(patch.enrollments) ? patch.enrollments : Array.isArray(student.enrollments) ? student.enrollments : [])
      .map((en: any) => en?.courseCode || en?.sectionCode || en?.studentSection),
  ].map((v: any) => String(v || "").trim()).filter(Boolean)));
  const fallbackCourse = remainingVisibleCourses.find((c: string) => !courseMatchesRemovalTarget(c, course, teacherEmail)) || "";
  if (courseMatchesRemovalTarget(student.sectionCode, course, teacherEmail)) patch.sectionCode = fallbackCourse;
  if (courseMatchesRemovalTarget(student.studentSection, course, teacherEmail)) patch.studentSection = fallbackCourse;
  if (
    student.isAccessBlocked &&
    String(student.accessBlockReason || "") === "تم حذفك من المقرر الأخير المعين لك."
  ) {
    patch.isAccessBlocked = false;
    patch.accessBlockReason = "";
  }
  patch.courseVisibilitySyncedAt = new Date().toISOString();
  patch.cleanReaddAt = new Date().toISOString();
  return patch;
}

function buildStudentCourseDeepRemovalPatch(
  student: any,
  courseCode: any,
  teacherEmail: any,
  linkedJoinCodes: any[] = [],
) {
  const course = String(courseCode || "").trim();
  const patch = buildCleanStudentCourseReaddPatch(student, course, teacherEmail);
  Object.assign(patch, buildStudentCourseRemovalPatch(student, course, teacherEmail));
  Object.assign(patch, buildStudentCourseCodeInvalidationPatch(student, course, teacherEmail, linkedJoinCodes));
  patch.cleanReaddAt = undefined;
  patch.courseRemovedAt = new Date().toISOString();
  return patch;
}


function buildStudentCourseActivationResetPatch(
  student: any,
  courseCode: any,
  teacherEmail: any,
  linkedJoinCodes: any[] = [],
) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return {};
  const now = new Date().toISOString();
  const owner = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  const matchesCourse = (value: any, entryTeacher?: any) =>
    courseMatchesRemovalTarget(value, course, entryTeacher || owner);
  const codeCompacts = new Set(
    (Array.isArray(linkedJoinCodes) ? linkedJoinCodes : [])
      .map((jc: any) => compactJoinCode(jc?.code || jc))
      .filter(Boolean),
  );
  const patch: any = {};

  if (Array.isArray(student.activatedCourseCodes)) {
    patch.activatedCourseCodes = student.activatedCourseCodes.filter(
      (value: any) => !matchesCourse(value),
    );
  }

  const existingEnrollments = Array.isArray(student.enrollments) ? student.enrollments : [];
  const keptEnrollments = existingEnrollments.filter(
    (entry: any) =>
      !matchesCourse(
        entry?.courseCode || entry?.sectionCode || entry?.studentSection,
        entry?.teacherEmail || entry?.ownerEmail,
      ),
  );
  const sec: any = sectionForCourseCode(course, owner) || resolveSectionForStudentGate(course);
  const courseName = String(sec?.courseName || sec?.name || sectionDisplayCode(course) || courseNameFromCode(course) || course).trim();
  keptEnrollments.push({
    studentId: String(student.id || student.idNumber || student.studentId || "").trim(),
    courseCode: course,
    sectionCode: course,
    studentSection: course,
    teacherEmail: owner,
    teacherName:
      dbInstance.getTeachers().find((t: any) => String(t.email || "").toLowerCase() === owner)?.name ||
      sec?.teacherName ||
      "",
    courseName,
    status: "pending_activation",
    enrollmentState: "pending_activation",
    isActive: false,
    isLocked: true,
    isOpen: true,
    requiresJoinCode: true,
    pendingActivation: true,
    activationResetAt: now,
    activationResetReason: "join_code_deleted_from_archive",
  });
  patch.enrollments = keptEnrollments;

  // حذف كود من الأرشيف لا يعني حذف الطالب من المقرر. لذلك ننظف علامة الحذف
  // الخاصة بنفس المقرر إن وجدت، ونترك صف الكشف يفرض ظهور بطاقة "تفعيل" للطالب.
  const remainingRemovalLinks = canonicalStudentRemovedCourseLinks(student).filter(
    (entry: any) =>
      !matchesCourse(
        entry?.courseCode || entry?.sectionCode || entry?.studentSection,
        entry?.teacherEmail || entry?.ownerEmail || entry?.removedBy,
      ),
  );
  patch.removedCourseLinks = remainingRemovalLinks;
  patch.removedEnrollments = remainingRemovalLinks;
  patch.deletedCourseLinks = remainingRemovalLinks;

  const currentActivationCompact = compactJoinCode(student.activationCode || "");
  if (currentActivationCompact && (!codeCompacts.size || codeCompacts.has(currentActivationCompact))) {
    patch.activationCode = "";
  }
  const fallbackCourse = Array.from(new Set([
    ...(Array.isArray(patch.activatedCourseCodes) ? patch.activatedCourseCodes : []),
    ...keptEnrollments
      .filter((entry: any) =>
        entry?.isActive === true || String(entry?.status || "").toLowerCase() === "active",
      )
      .map((entry: any) => entry?.courseCode || entry?.sectionCode || entry?.studentSection),
  ].map((value: any) => String(value || "").trim()).filter(Boolean)))
    .find((value: any) => !matchesCourse(value)) || "";
  if (matchesCourse(student.sectionCode)) patch.sectionCode = fallbackCourse;
  if (matchesCourse(student.studentSection)) patch.studentSection = fallbackCourse;

  Object.assign(patch, buildStudentCourseCodeInvalidationPatch(student, course, owner, linkedJoinCodes));
  patch.isPaid = true;
  patch.isActivated = true;
  patch.isAccessBlocked = false;
  patch.accessBlockReason = "";
  patch.courseVisibilitySyncedAt = now;
  patch.activationResetAt = now;
  return patch;
}

function deleteRetiredJoinCodeRecord(code: any) {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return false;
  const data = (dbInstance as any).data;
  if (!data || !Array.isArray(data.retiredJoinCodes)) return false;
  const before = data.retiredJoinCodes.length;
  data.retiredJoinCodes = data.retiredJoinCodes.filter(
    (item: any) => String(item?.code || "").trim().toUpperCase() !== key,
  );
  if (data.retiredJoinCodes.length !== before) {
    try { (dbInstance as any).persist?.(); } catch {}
    return true;
  }
  return false;
}

function getStudentRosterCourseCodes(student: any): string[] {
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid) return [];
  const codes = new Set<string>();
  try {
    dbInstance.getAllowedStudents().forEach((row: any) => {
      if (normalizeStudentId(row.idNumber || row.id || row.studentId) !== sid) return;
      const course = String(row.sectionCode || row.studentSection || row.courseCode || "").trim();
      if (course && course.toLowerCase() !== "all") codes.add(course);
    });
  } catch {}
  return withoutRemovedStudentCourses(student, Array.from(codes));
}

function getStudentDiscoveredCourseCodes(student: any, options: { includeRosterOnly?: boolean } = {}): string[] {
  const sid = normalizeStudentId(student?.id);
  const codes = new Set<string>();
  const add = (v: any) => {
    const code = String(v || "").trim();
    if (code && code.toLowerCase() !== "all") codes.add(code);
  };
  add(student?.sectionCode);
  add(student?.studentSection);
  activatedCourseCodesForStudent(student).forEach(add);
  if (Array.isArray(student?.enrollments)) {
    student.enrollments.forEach((entry: any) =>
      add(entry?.courseCode || entry?.sectionCode || entry?.studentSection),
    );
  }
  // مهم: صف الكشف وحده لا يُعتبر التحاقاً دراسياً. عند إعادة إضافة طالب محذوف
  // نعرض له بطاقة إدخال الكود فقط، ولا نعيد المقرر إلى "مسارك الدراسي" كأنه مقرر
  // موجود بلا تفعيل. لذلك لا ندمج roster إلا عند طلبه صراحة لبناء بطاقة التفعيل.
  if (options.includeRosterOnly === true) {
    getStudentRosterCourseCodes(student).forEach(add);
  }
  try {
    dbInstance.getJoinCodes().forEach((jc: any) => {
      if (!isUsableJoinCodeRecord(jc)) return;
      if (
        normalizeStudentId(jc.assignedStudentId || jc.studentId) === sid ||
        normalizeStudentId(jc.usedByStudentId) === sid
      )
        add(joinCodeCourse(jc));
    });
  } catch {}
  try {
    dbInstance.getTeacherSubmissions().forEach((sub: any) => {
      if (normalizeStudentId(sub.studentId) === sid)
        add(sub.courseCode || sub.sectionCode);
    });
  } catch {}
  return withoutRemovedStudentCourses(student, Array.from(codes));
}
function resolveSectionForStudentGate(courseCode: any, context?: any): any {
  const raw = String(courseCode || "").trim();
  if (!raw) return null;

  const contextOwner = String(
    context?.ownerEmail ||
      context?.teacherEmail ||
      context?.createdByEmail ||
      context?.actorEmail ||
      extractEmailFromSectionCode(raw) ||
      "",
  )
    .trim()
    .toLowerCase();

  const exact = activeSections().find((sec: any) => {
    if (String(sec.code || "").toLowerCase() !== raw.toLowerCase())
      return false;
    if (!contextOwner) return true;
    return (
      String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() ===
      contextOwner
    );
  });
  if (exact) return exact;

  const display = sectionDisplayCode(raw).toLowerCase();
  if (!display) return null;
  return (
    activeSections().find((sec: any) => {
      if (sectionDisplayCode(sec.code).toLowerCase() !== display) return false;
      if (!contextOwner) return true;
      return (
        String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() ===
        contextOwner
      );
    }) || null
  );
}

function isSectionOpenForStudents(courseCode: any, context?: any): boolean {
  const raw = String(courseCode || "").trim();
  if (!raw) return false;
  const sec = resolveSectionForStudentGate(courseCode, context);
  // إن لم نجد سجلاً للمقرر نُبقي السلوك القديم كما هو: لا نغلق المقرر افتراضياً.
  // أما إذا وُجد السجل، فزر فتح/إغلاق المقرر عند المعلم هو مصدر الحقيقة الوحيد.
  return sec ? sec.isOpen !== false : true;
}
function suspensionCourseMatches(entry: any, courseCode: any): boolean {
  const target = String(courseCode || "")
    .trim()
    .toLowerCase();
  if (!target) return false;
  return [entry?.courseCode, entry?.sectionCode].some(
    (value: any) =>
      String(value || "")
        .trim()
        .toLowerCase() === target,
  );
}
function getSuspendedEnrollmentRecord(student: any, courseCode: any) {
  const list = Array.isArray(student?.suspendedEnrollments)
    ? student.suspendedEnrollments
    : [];
  return list.find(
    (entry: any) =>
      entry?.isSuspended === true && suspensionCourseMatches(entry, courseCode),
  );
}
function isStudentSuspendedInCourse(student: any, courseCode: any): boolean {
  return !!getSuspendedEnrollmentRecord(student, courseCode);
}
function rosterCourseMatches(rowCourse: any, targetCourse: any): boolean {
  const rowCode = String(rowCourse || "").trim();
  const target = String(targetCourse || "").trim();
  if (!rowCode || !target) return false;
  if (target.toLowerCase() === "all") return true;
  return sectionCodeEquivalent(rowCode, target);
}
function studentAccessIsTeacherHold(student: any): boolean {
  if (!student?.isAccessBlocked) return false;
  const reason = String(student?.accessBlockReason || "");
  return reason.includes("إيقاف الحساب مؤقت") || reason.includes("أستاذ المقرر");
}
function setNoCache(res: any) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  } catch {}
}
function touchStudentsLinkedToCourse(courseCode: any) {
  try {
    const course = String(courseCode || "").trim();
    if (!course) return;
    dbInstance.getStudents().forEach((student: any) => {
      if (getStudentDiscoveredCourseCodes(student).some((code) => sectionCodeEquivalent(code, course))) {
        dbInstance.updateStudent(student.id, {
          courseVisibilitySyncedAt: new Date().toISOString(),
        } as any);
      }
    });
  } catch {}
}
function setStudentCourseSuspension(
  student: any,
  courseCode: string,
  teacherEmail: string,
  suspended: boolean,
  reason = "",
) {
  const normalizedCourse = String(courseCode || "").trim();
  const now = new Date().toISOString();
  const existing = Array.isArray(student?.suspendedEnrollments)
    ? student.suspendedEnrollments
    : [];
  let touched = false;
  const next = existing.map((entry: any) => {
    if (!suspensionCourseMatches(entry, normalizedCourse)) return entry;
    touched = true;
    return suspended
      ? {
          ...entry,
          studentId: String(student.id),
          courseCode: normalizedCourse,
          sectionCode: normalizedCourse,
          teacherEmail,
          isSuspended: true,
          suspendedAt: entry.suspendedAt || now,
          suspendedBy: teacherEmail,
          suspensionReason: reason || entry.suspensionReason || "",
        }
      : {
          ...entry,
          studentId: String(student.id),
          courseCode: normalizedCourse,
          sectionCode: normalizedCourse,
          teacherEmail: entry.teacherEmail || teacherEmail,
          isSuspended: false,
          reactivatedAt: now,
          reactivatedBy: teacherEmail,
        };
  });
  if (!touched) {
    next.push({
      studentId: String(student.id),
      courseCode: normalizedCourse,
      sectionCode: normalizedCourse,
      teacherEmail,
      isSuspended: suspended,
      suspendedAt: suspended ? now : undefined,
      suspendedBy: suspended ? teacherEmail : undefined,
      suspensionReason: reason || "",
      reactivatedAt: suspended ? undefined : now,
      reactivatedBy: suspended ? undefined : teacherEmail,
    });
  }
  dbInstance.updateStudent(student.id, { suspendedEnrollments: next } as any);
  return (
    dbInstance
      .getStudents()
      .find((st: any) => String(st.id) === String(student.id)) || {
      ...student,
      suspendedEnrollments: next,
    }
  );
}
function getStudentActiveCourseCodes(student: any): string[] {
  const sid = normalizeStudentId(student?.id);
  const active = new Set<string>();
  const add = (v: any) => {
    const code = String(v || "").trim();
    if (
      code &&
      code.toLowerCase() !== "all" &&
      isSectionOpenForStudents(code) &&
      !isStudentSuspendedInCourse(student, code) &&
      !isStudentCourseRemoved(student, code)
    )
      active.add(code);
  };
  try {
    dbInstance.getJoinCodes().forEach((jc: any) => {
      if (!isUsableJoinCodeRecord(jc)) return;
      const linked =
        normalizeStudentId(
          jc.studentId || jc.usedByStudentId || jc.assignedStudentId,
        ) === sid;
      const status = String(jc.status || "").toLowerCase();
      if (
        linked &&
        (status === "used" ||
          status === "active-used" ||
          status === "activated")
      ) {
        const code = joinCodeCourse(jc);
        if (
          isSectionOpenForStudents(code, jc) &&
          !isStudentSuspendedInCourse(student, code) &&
          !isStudentCourseRemoved(student, code, jc.ownerEmail || jc.teacherEmail || jc.createdByEmail)
        )
          active.add(String(code || "").trim());
      }
    });
  } catch {}
  activatedCourseCodesForStudent(student).forEach((code: any) => {
    if (hasActivatedStudentCourseLink(student, code, sectionOwnerEmail(code))) add(code);
  });
  if (Array.isArray(student?.enrollments)) {
    student.enrollments.forEach((entry: any) => {
      const state = String(entry?.enrollmentState || entry?.status || "").trim().toLowerCase();
      if (
        entry?.isActive === false ||
        entry?.pendingActivation === true ||
        entry?.requiresJoinCode === true ||
        state === "pending_activation" ||
        state === "locked" ||
        state === "suspended" ||
        state === "student_suspended" ||
        entry?.isSuspended === true
      ) return;
      const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      if (hasActivatedStudentCourseLink(student, entryCourse, entry?.teacherEmail || sectionOwnerEmail(entryCourse))) add(entryCourse);
    });
  }
  // لا نمنح أي مقرر لمجرد أن isPaid=true؛ فكرة مِراس تعتمد على كود المعلم.
  // هذا الاستثناء الضيق يحافظ فقط على حسابات قديمة مفعلة فعلاً ولديها activationCode،
  // أما الطالب الذي أضيف حديثاً في كشف معلم آخر فيبقى مقرره مقفلاً حتى يضع الكود.
  if (!active.size && student?.isPaid && String(student?.activationCode || "").trim()) {
    const legacyCourse = student?.sectionCode || student?.studentSection;
    if (studentHasOperationalUsedJoinCode(student, legacyCourse, sectionOwnerEmail(legacyCourse))) {
      add(legacyCourse);
    }
  }
  return Array.from(active);
}
function getStudentEnrollmentCodes(student: any): string[] {
  return getStudentDiscoveredCourseCodes(student);
}
function studentHasEnrollmentInCourse(student: any, courseCode: any): boolean {
  const code = String(courseCode || "")
    .trim()
    .toLowerCase();
  if (!code) return true;
  return getStudentActiveCourseCodes(student).some((c) =>
    sectionCodeEquivalent(c, courseCode),
  );
}
function getStudentEnrollmentDetails(student: any) {
  const rosterOnlyCodes = getStudentRosterCourseCodes(student);
  const allCodes = getStudentDiscoveredCourseCodes(student, { includeRosterOnly: true }).filter((courseCode) =>
    !!(resolveSectionForStudentGate(courseCode) || sectionForCourseCode(courseCode)),
  );
  const seen = new Set<string>();
  return allCodes
    .map((courseCode) => {
      const sec: any = resolveSectionForStudentGate(courseCode) || sectionForCourseCode(courseCode);
      const teacherEmail = String(
        sec?.ownerEmail || extractEmailFromSectionCode(courseCode) || sectionOwnerEmail(courseCode) || "",
      ).toLowerCase();
      const canonicalCourseCode = String(sec?.code || courseCode || "").trim();
      if (!canonicalCourseCode || canonicalCourseCode.toLowerCase() === "all") return null;
      const dedupeKey = `${canonicalCourseCode.toLowerCase()}|${teacherEmail}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);

      const removedFromCourse = isStudentCourseRemoved(student, canonicalCourseCode, teacherEmail);
      if (removedFromCourse) return null;
      const teacher: any = dbInstance
        .getTeachers()
        .find(
          (t: any) =>
            String(t.email || "").toLowerCase() ===
            String(teacherEmail || "").toLowerCase(),
        );
      const isOpen = isSectionOpenForStudents(canonicalCourseCode, { ownerEmail: teacherEmail });
      const suspension = getSuspendedEnrollmentRecord(student, canonicalCourseCode);
      const isStudentSuspended = !!suspension;
      const freshJoinCode = getFreshJoinCodeForStudentCourse(student, canonicalCourseCode, teacherEmail);
      const hasFreshJoinCode = !!freshJoinCode;
      const hasActivatedLink = hasActivatedStudentCourseLink(student, canonicalCourseCode, teacherEmail);
      const isRosterLinked = rosterOnlyCodes.some((code) =>
        sectionCodeEquivalent(code, canonicalCourseCode),
      );
      // صف الكشف وحده لا يُظهر بطاقة مقرر للطالب؛ تظهر بطاقة التفعيل فقط بعد
      // إصدار كود جديد فعلي لهذا الطالب/المقرر. هذا يمنع كشف مقررات لم يبدأ
      // الأستاذ تفعيلها ويحافظ على رحلة كل مقرر مستقلة.
      const shouldShowPendingActivation =
        !hasActivatedLink && hasFreshJoinCode && isRosterLinked;

      if (!hasActivatedLink && !shouldShowPendingActivation) return null;

      let enrollmentState: string = "active";
      if (!isOpen) enrollmentState = "course_closed";
      else if (isStudentSuspended) enrollmentState = "student_suspended";
      else if (shouldShowPendingActivation) enrollmentState = "pending_activation";
      else if (hasActivatedLink) enrollmentState = "active";

      const pendingActivation = enrollmentState === "pending_activation";
      const isActive = enrollmentState === "active";
      const courseName = String(sec?.courseName || sec?.name || sectionDisplayCode(canonicalCourseCode) || canonicalCourseCode).trim();
      return {
        courseCode: canonicalCourseCode,
        sectionCode: canonicalCourseCode,
        studentSection: canonicalCourseCode,
        courseName,
        teacherEmail,
        teacherName: teacher?.name || sec?.teacherName || "",
        enrollmentState,
        rosterOnly: false,
        requiresJoinCode: pendingActivation,
        pendingActivation,
        hasFreshJoinCode,
        isCourseClosed: !isOpen,
        isClosedByTeacher: !isOpen,
        isStudentSuspended,
        isSuspended: isStudentSuspended,
        removedFromCourse: false,
        status: enrollmentState,
        isActive,
        isLocked: !isActive,
        isOpen,
        source: pendingActivation ? "fresh_join_code_pending_activation" : "server_enrollment_state",
        pendingJoinCodeIssuedAt: freshJoinCode?.createdAt || freshJoinCode?.issuedAt || "",
        suspendedAt: suspension?.suspendedAt,
        suspendedBy: suspension?.suspendedBy,
        suspensionReason: suspension?.suspensionReason || "",
      };
    })
    .filter(Boolean);
}// تنظيف ذاتي للسجل السحابي: يُسقط أكواد المقررات التي لم يعد لها قسم قائم
// (محذوفة/مُعاد ترقيمها) من بيانات الطالب المخزّنة، فتبقى السحابة نظيفة بمرور
// الوقت. يُرجع patch فقط عند وجود ما يُنظَّف (لا كتابة بلا داعٍ)، ويُدمج في
// كتابة موجودة أصلاً (تسجيل الدخول) فلا يضيف أي نداء إضافي ولا يبطّئ شيئاً.
// المقرر المُغلق (isOpen=false) له قسم قائم فلا يُمسّ — الحذف فقط هو ما يُنظَّف.
function pruneGhostCoursePatch(student: any): Record<string, any> | null {
  if (!student) return null;
  const exists = (code: any) =>
    !!(resolveSectionForStudentGate(code) || sectionForCourseCode(code));
  const patch: any = {};
  let changed = false;
  if (Array.isArray(student.activatedCourseCodes)) {
    const cleaned = student.activatedCourseCodes.filter((c: any) => exists(c));
    if (cleaned.length !== student.activatedCourseCodes.length) {
      patch.activatedCourseCodes = cleaned;
      changed = true;
    }
  }
  if (Array.isArray(student.enrollments)) {
    const cleaned = student.enrollments.filter((e: any) =>
      exists(e?.courseCode || e?.sectionCode || e?.studentSection),
    );
    if (cleaned.length !== student.enrollments.length) {
      patch.enrollments = cleaned;
      changed = true;
    }
  }
  const firstReal = (Array.isArray(student.enrollments) ? student.enrollments : [])
    .map((e: any) => String(e?.courseCode || e?.sectionCode || "").trim())
    .find((c: string) => c && exists(c)) || "";
  if (String(student.sectionCode || "").trim() && !exists(student.sectionCode)) {
    patch.sectionCode = firstReal;
    changed = true;
  }
  if (String((student as any).studentSection || "").trim() && !exists((student as any).studentSection)) {
    patch.studentSection = firstReal;
    changed = true;
  }
  return changed ? patch : null;
}
function sanitizeStudentForClient(student: any, enrollmentDetails?: any[]): any {
  if (!student) return student;
  const enrollments = Array.isArray(enrollmentDetails)
    ? enrollmentDetails
    : getStudentEnrollmentDetails(student);
  const visibleCodes = enrollments
    .map((entry: any) => String(entry?.courseCode || entry?.sectionCode || entry?.studentSection || "").trim())
    .filter(Boolean);
  const activatedVisibleCodes = enrollments
    .filter((entry: any) => entry?.pendingActivation !== true && entry?.requiresJoinCode !== true)
    .map((entry: any) => String(entry?.courseCode || entry?.sectionCode || entry?.studentSection || "").trim())
    .filter(Boolean);
  const matchesAny = (code: any, pool: string[]) =>
    pool.some((item) => sectionCodeEquivalent(item, code));
  const activatedCourseCodes = (Array.isArray(student.activatedCourseCodes)
    ? student.activatedCourseCodes
    : [])
    .map((code: any) => String(code || "").trim())
    .filter((code: string, index: number, list: string[]) =>
      !!code &&
      matchesAny(code, activatedVisibleCodes) &&
      list.findIndex((item) => sectionCodeEquivalent(item, code)) === index,
    );
  activatedVisibleCodes.forEach((code) => {
    if (!activatedCourseCodes.some((item: string) => sectionCodeEquivalent(item, code)))
      activatedCourseCodes.push(code);
  });
  const safeSection = (value: any) => {
    const raw = String(value || "").trim();
    return raw && matchesAny(raw, visibleCodes) ? raw : visibleCodes[0] || "";
  };
  const activationCode = String(student.activationCode || "").trim();
  let keepActivationCode = true;
  if (activationCode && activatedCourseCodes.length === 0) keepActivationCode = false;
  return {
    ...student,
    activatedCourseCodes,
    enrollments,
    sectionCode: safeSection(student.sectionCode || student.studentSection),
    studentSection: safeSection(student.studentSection || student.sectionCode),
    activationCode: keepActivationCode ? student.activationCode : "",
  };
}
// ── صحة البيانات والشفاء الذاتي (سوبر أدمن فقط) ──────────────────────────────
// مسح خفيف يكشف "أشباح" البيانات الناتجة عن الحذف/إعادة الترقيم: طلاب يشيرون
// لمقرر غير موجود، أكواد بلا قسم، أكواد مرتبطة بطالب محذوف، صفوف كشف بلا قسم.
function sectionStillExists(code: any): boolean {
  const c = String(code || "").trim();
  if (!c || c.toLowerCase() === "all") return true;
  return !!(resolveSectionForStudentGate(c) || sectionForCourseCode(c));
}
function computeDataHealth() {
  const students = dbInstance.getStudents();
  const studentIds = new Set(students.map((s: any) => normalizeStudentId(s.id)).filter(Boolean));
  const codes = dbInstance.getJoinCodes();
  const roster = dbInstance.getAllowedStudents();

  let ghostStudents = 0;
  let ghostRefs = 0;
  students.forEach((s: any) => {
    const refs = new Set<string>();
    const add = (v: any) => {
      const c = String(v || "").trim();
      if (c && c.toLowerCase() !== "all" && !sectionStillExists(c)) refs.add(c.toLowerCase());
    };
    add(s.sectionCode);
    add((s as any).studentSection);
    (Array.isArray(s.activatedCourseCodes) ? s.activatedCourseCodes : []).forEach(add);
    (Array.isArray((s as any).enrollments) ? (s as any).enrollments : []).forEach((e: any) =>
      add(e?.courseCode || e?.sectionCode || e?.studentSection),
    );
    if (refs.size) {
      ghostStudents += 1;
      ghostRefs += refs.size;
    }
  });

  const orphanCodes = codes.filter(
    (c: any) => !sectionStillExists(c.sectionCode || c.studentSection || c.courseCode),
  ).length;
  const deadLinkCodes = codes.filter((c: any) => {
    const linked = normalizeStudentId(c.studentId || c.usedByStudentId || c.assignedStudentId || "");
    return !!linked && !studentIds.has(linked);
  }).length;
  const rosterOrphans = roster.filter(
    (r: any) => !sectionStillExists(r.sectionCode || (r as any).studentSection || (r as any).courseCode),
  ).length;
  const activeDeadStudentCodes = codes.filter((c: any) => {
    const status = String(c.status || "active").toLowerCase();
    const linked = normalizeStudentId(c.assignedStudentId || c.studentId || c.usedByStudentId || "");
    return status === "active" && !!linked && !studentIds.has(linked);
  }).length;
  const activeDeletedCourseCodes = codes.filter((c: any) =>
    String(c.status || "active").toLowerCase() === "active" &&
    !sectionStillExists(c.sectionCode || c.studentSection || c.courseCode),
  ).length;
  const activeDuplicateMap = new Map<string, number>();
  codes.forEach((c: any) => {
    if (String(c.status || "active").toLowerCase() !== "active") return;
    const sid = normalizeStudentId(c.assignedStudentId || c.studentId || c.usedByStudentId || "");
    const course = String(c.sectionCode || c.courseCode || c.studentSection || "").trim().toLowerCase();
    if (!sid || !course) return;
    const key = `${sid}|${course}|${joinCodeOwnerEmail(c)}`;
    activeDuplicateMap.set(key, (activeDuplicateMap.get(key) || 0) + 1);
  });
  const duplicateActiveStudentCourseCodes = Array.from(activeDuplicateMap.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const tamperedLedgers = codes.filter((c: any) => !verifyLedger(c).ok).length;
  const unsignedActiveCodes = codes.filter((c: any) => String(c.status || "active").toLowerCase() === "active" && !String((c as any).codeSignature || "").trim()).length;

  const byStatus = codes.reduce((acc: any, c: any) => {
    const st = String(c.status || "active").toLowerCase();
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});
  const frozen = codes.filter((c: any) => isJoinCodeTemporarilyFrozen(c)).length;

  const totalIssues = ghostStudents + orphanCodes + deadLinkCodes + rosterOrphans + activeDeadStudentCodes + activeDeletedCourseCodes + duplicateActiveStudentCourseCodes + tamperedLedgers;
  return {
    totalIssues,
    ghostStudents,
    ghostRefs,
    orphanCodes,
    deadLinkCodes,
    rosterOrphans,
    activeDeadStudentCodes,
    activeDeletedCourseCodes,
    duplicateActiveStudentCourseCodes,
    tamperedLedgers,
    unsignedActiveCodes,
    totals: {
      students: students.length,
      codes: codes.length,
      active: byStatus.active || 0,
      used: byStatus.used || 0,
      revoked: byStatus.revoked || 0,
      frozen,
    },
  };
}
function healDataIssues(actorEmail = "system") {
  const students = dbInstance.getStudents();
  const studentIds = new Set(students.map((s: any) => normalizeStudentId(s.id)).filter(Boolean));
  let healedStudents = 0;
  let archivedCodes = 0;
  let relinkedCodes = 0;
  let removedRoster = 0;

  // 1) أزل إشارات المقررات الشبح من سجلات الطلاب
  students.forEach((s: any) => {
    const patch = pruneGhostCoursePatch(s);
    if (patch) {
      dbInstance.updateStudent(s.id, patch as any);
      healedStudents += 1;
    }
  });

  // 2) أرشِف الأكواد التي لم يعد لها قسم قائم
  dbInstance.getJoinCodes().slice().forEach((c: any) => {
    if (!sectionStillExists(c.sectionCode || c.studentSection || c.courseCode)) {
      dbInstance.deleteJoinCode(c.code, "data_heal_orphan_code", actorEmail);
      archivedCodes += 1;
    }
  });

  // 3) الأكواد المرتبطة بطالب محذوف (والقسم قائم) → أعدها قابلة لإعادة الاستخدام
  dbInstance.getJoinCodes().forEach((c: any) => {
    const linked = normalizeStudentId(c.studentId || c.usedByStudentId || c.assignedStudentId || "");
    if (linked && !studentIds.has(linked)) {
      dbInstance.updateJoinCode(c.code, {
        status: "active",
        studentId: "",
        usedByStudentId: "",
        assignedStudentId: "",
        studentName: "",
        studentSection: "",
        activatedAt: "",
        activationDeviceToken: "",
        activationDeviceFingerprint: "",
        activationDeviceServerHash: "",
        isFreeCode: false,
      } as any);
      relinkedCodes += 1;
    }
  });

  // 4) أكواد نشطة مكررة لنفس الطالب/المقرر/المالك: نُبقي الأحدث ونؤرشف الزائد بهدوء
  const duplicateBuckets = new Map<string, any[]>();
  dbInstance.getJoinCodes().forEach((c: any) => {
    if (String(c.status || "active").toLowerCase() !== "active") return;
    const sid = normalizeStudentId(c.assignedStudentId || c.studentId || c.usedByStudentId || "");
    const course = String(c.sectionCode || c.courseCode || c.studentSection || "").trim().toLowerCase();
    if (!sid || !course) return;
    const key = `${sid}|${course}|${joinCodeOwnerEmail(c)}`;
    duplicateBuckets.set(key, [...(duplicateBuckets.get(key) || []), c]);
  });
  duplicateBuckets.forEach((items) => {
    if (items.length <= 1) return;
    items
      .sort((a: any, b: any) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(1)
      .forEach((c: any) => {
        dbInstance.deleteJoinCode(c.code, "data_heal_duplicate_active_code", actorEmail);
        archivedCodes += 1;
      });
  });

  // 5) أزل صفوف الكشف التي لم يعد لها قسم
  const beforeRoster = dbInstance.getAllowedStudents().length;
  (dbInstance as any).data.allowedStudents = dbInstance
    .getAllowedStudents()
    .filter((r: any) => sectionStillExists(r.sectionCode || (r as any).studentSection || (r as any).courseCode));
  removedRoster = beforeRoster - dbInstance.getAllowedStudents().length;

  dbInstance.persist();
  return { healedStudents, archivedCodes, relinkedCodes, removedRoster };
}
function activeRuntimeTeacherProjects() {
  return dbInstance
    .getTeacherProjects()
    .filter((project: any) => isActiveRecord(project));
}
function activeTeacherExams() {
  return dbInstance
    .getTeacherExams()
    .filter((exam: any) => isActiveRecord(exam));
}
function activeQuestionBank() {
  return dbInstance.getQuestionBank().filter((q: any) => isActiveRecord(q));
}

function normalizeQuestionCategoryTokenServer(value: any): string {
  return String(value || "").trim().toLowerCase();
}

function teacherChapterForToken(token: any, teacherEmail: string): any | null {
  const normalizedToken = normalizeQuestionCategoryTokenServer(token);
  if (!normalizedToken) return null;
  const owner = String(teacherEmail || "").trim().toLowerCase();
  return (
    dbInstance.getChapters().find((chapter: any) => {
      const chapterOwner = String(chapter?.teacherEmail || owner).toLowerCase();
      if (owner && chapterOwner !== owner) return false;
      return [chapter?.id, chapter?.title, chapter?.categoryTitle, chapter?.chapterTitle]
        .map(normalizeQuestionCategoryTokenServer)
        .includes(normalizedToken);
    }) || null
  );
}

function categoryAliasesForTokenServer(token: any, teacherEmail: string): string[] {
  const raw = String(token || "").trim();
  if (!raw) return [];
  const chapter = teacherChapterForToken(raw, teacherEmail);
  return Array.from(
    new Set(
      [raw, chapter?.id, chapter?.title, chapter?.categoryTitle, chapter?.chapterTitle]
        .map(normalizeQuestionCategoryTokenServer)
        .filter(Boolean),
    ),
  );
}

function questionCategoryAliasesServer(q: any, teacherEmail: string): string[] {
  return Array.from(
    new Set(
      [
        q?.chapterId,
        q?.categoryId,
        q?.category,
        q?.categoryTitle,
        q?.chapterTitle,
        q?.chapter?.id,
        q?.chapter?.title,
      ]
        .flatMap((value: any) => categoryAliasesForTokenServer(value, teacherEmail))
        .filter(Boolean),
    ),
  );
}

function questionMatchesSelectedCategoriesServer(
  q: any,
  selectedCategoriesInput: any,
  teacherEmail: string,
): boolean {
  const selectedCategories = Array.isArray(selectedCategoriesInput)
    ? selectedCategoriesInput.map(String).filter(Boolean)
    : [];
  if (!selectedCategories.length) return true;
  const qAliases = questionCategoryAliasesServer(q, teacherEmail);
  return selectedCategories.some((cat) =>
    categoryAliasesForTokenServer(cat, teacherEmail).some((alias) => qAliases.includes(alias)),
  );
}

function questionCourseMatchesExamServer(q: any, examCourseCode: any): boolean {
  const course = String(examCourseCode || "").trim();
  if (!course) return true;
  const candidates = [
    q?.courseCode,
    q?.sectionCode,
    q?.studentSection,
    q?.course,
    q?.courseId,
    q?.courseNumber,
    q?.subjectCode,
    q?.course?.code,
    q?.section?.code,
  ]
    .map((value: any) => String(value || "").trim())
    .filter(Boolean);
  if (!candidates.length) return true;
  return candidates.some((candidate) => sectionCodeEquivalent(candidate, course));
}

function questionBelongsToTeacherServer(q: any, teacherEmail: string): boolean {
  const owner = String(q?.teacherEmail || "ah.alfailakawi@paaet.edu.kw").toLowerCase();
  return owner === String(teacherEmail || "").trim().toLowerCase();
}

function questionMatchesOfficialExamServer(q: any, exam: any, teacherEmail: string): boolean {
  return (
    q?.isApproved === true &&
    isActiveRecord(q) &&
    questionBelongsToTeacherServer(q, teacherEmail) &&
    questionCourseMatchesExamServer(q, exam?.courseCode) &&
    questionMatchesSelectedCategoriesServer(q, exam?.selectedCategories, teacherEmail)
  );
}

function canonicalizeQuestionPayloadForTeacher(q: any, teacherEmail: string): any {
  const payload = { ...(q || {}) };
  const lookup =
    payload.chapterId ||
    payload.categoryId ||
    payload.categoryTitle ||
    payload.chapterTitle ||
    payload.category ||
    "";
  const chapter = teacherChapterForToken(lookup, teacherEmail);
  if (chapter) {
    payload.chapterId = chapter.id || payload.chapterId;
    payload.categoryTitle = chapter.title || payload.categoryTitle;
    payload.chapterTitle = chapter.title || payload.chapterTitle;
  }
  return payload;
}
function gradeQuizAnswers(answers: any) {
  const matchedQuestions: any[] = [];
  let score = 0;
  let totalPoints = 0;

  const validAnswers = answers || {};
  for (const qId of Object.keys(validAnswers)) {
    const q = activeQuestionBank().find(
      (item: any) => String(item.id) === String(qId),
    );
    if (!q) continue;

    const studentAns = validAnswers[qId];
    let isCorrect = false;

    if (q.type === "multiple-choice" || q.type === "true-false") {
      isCorrect = String(studentAns).trim() === String(q.correctAnswer).trim();
    } else if (q.type === "short-answer" || q.type === "scenario-analysis") {
      isCorrect = String(studentAns)
        .trim()
        .toLowerCase()
        .includes(String(q.correctAnswer).trim().toLowerCase());
    } else if (q.type === "matching") {
      let matchCount = 0;
      const originalMap = q.correctAnswer as { [key: string]: string };
      const studentMap = (studentAns as { [key: string]: string }) || {};
      const keys = Object.keys(originalMap);
      keys.forEach((k) => {
        if (studentMap[k] === originalMap[k]) matchCount++;
      });
      isCorrect = matchCount === keys.length;
    } else if (q.type === "ordering") {
      const originalArray = q.correctAnswer as string[];
      const studentArray = (studentAns as string[]) || [];
      isCorrect =
        JSON.stringify(originalArray) === JSON.stringify(studentArray);
    }

    const pointsEarned = isCorrect ? q.points : 0;
    score += pointsEarned;
    totalPoints += q.points;

    matchedQuestions.push({
      questionId: q.id,
      questionText: q.questionText,
      studentAnswer: studentAns,
      correctAnswer:
        q.type === "matching" || q.type === "ordering"
          ? q.correctAnswer
          : q.correctAnswer,
      isCorrect,
      pointsEarned,
    });
  }

  return { score, totalPoints, matchedQuestions };
}
function activeRuntimeTeacherSubmissions() {
  const examIds = new Set(
    activeTeacherExams().map((exam: any) => String(exam.id)),
  );
  const projectIds = new Set(
    [
      ...activeRuntimeTeacherProjects(),
      ...dbInstance
        .getPersonalizedProjects()
        .filter((project: any) => isActiveRecord(project)),
    ].map((project: any) => String(project.id)),
  );
  return dbInstance.getTeacherSubmissions().filter((item: any) => {
    if (!isActiveRecord(item)) return false;
    const kind = String(item.kind || "");
    const activityId = String(item.activityId || "");
    if (kind === "exam") return examIds.has(activityId);
    if (kind === "project") return projectIds.has(activityId);
    return true;
  });
}

function normalizeStudentId(value: any): string {
  return String(value ?? "")
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[^0-9]/g, "");
}

// ── الاسم الحيّ كمصدر وحيد للحقيقة ──────────────────────────────────────
// سجل الطالب (students) هو المرجع. أي كائن يحمل studentId (تسليم، سجل، طلب)
// يُختم باسم الطالب الحالي عند القراءة، فلا نعتمد على الاسم المنسوخ القديم.
// هذا يجعل تعديل الاسم ينعكس فوراً في التصحيح والمتابعة وكل الشاشات.
function liveStudentNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const student of dbInstance.getStudents()) {
    const id = normalizeStudentId((student as any).id);
    const name = String((student as any).name || "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

function withLiveStudentNames<T extends Record<string, any>>(
  items: T[],
  nameMap?: Map<string, string>,
): T[] {
  if (!Array.isArray(items) || !items.length) return items;
  const map = nameMap || liveStudentNameMap();
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const id = normalizeStudentId(
      (item as any).studentId ?? (item as any).linkedStudentId,
    );
    const live = id ? map.get(id) : "";
    return live && live !== (item as any).studentName
      ? { ...item, studentName: live }
      : item;
  });
}

function normalizeArabicDigits(value: any): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

function normalizeJoinCode(value: any): string {
  if (!value) return "";
  const cleaned = String(value)
    .trim()
    .toUpperCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const compactRaw = cleaned.replace(/[^A-Z0-9]/g, "");
  if (!compactRaw) return "";

  if (compactRaw.startsWith(MIRAS_JOIN_CODE_PREFIX)) {
    const rawBody = compactRaw.slice(MIRAS_JOIN_CODE_PREFIX.length);
    const legacyDigits = rawBody.replace(/[OI]/g, (ch) => (ch === "O" ? "0" : "1")).replace(/\D/g, "");
    const looksLegacyNumeric = /^[0-9OI]+$/.test(rawBody);
    if (looksLegacyNumeric && legacyDigits.length === 8) {
      return `${MIRAS_JOIN_CODE_PREFIX}-${legacyDigits.slice(0, 4)}-${legacyDigits.slice(4, 8)}`;
    }
    if (looksLegacyNumeric && legacyDigits.length > 0 && legacyDigits.length < 8) {
      const a = legacyDigits.slice(0, 4);
      const b = legacyDigits.slice(4, 8);
      return [MIRAS_JOIN_CODE_PREFIX, a, b].filter(Boolean).join("-");
    }

    const body = rawBody
      .replace(/0/g, "O")
      .replace(/1/g, "I")
      .replace(/[^A-Z2-9]/g, "")
      .slice(0, MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE);
    if (!body) return MIRAS_JOIN_CODE_PREFIX;
    const groups: string[] = [];
    for (let i = 0; i < body.length; i += MIRAS_JOIN_CODE_GROUP_SIZE) {
      groups.push(body.slice(i, i + MIRAS_JOIN_CODE_GROUP_SIZE));
    }
    return [MIRAS_JOIN_CODE_PREFIX, ...groups].join("-");
  }
  return cleaned;
}

function compactJoinCode(value: any): string {
  const norm = normalizeJoinCode(value);
  return norm.replace(/-/g, "").toUpperCase();
}

function isUnifiedJoinCode(value: any): boolean {
  const norm = normalizeJoinCode(value);
  return (
    /^LAB-\d{4}-\d{4}$/.test(norm) ||
    /^LAB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(norm)
  );
}

function isFullMirasJoinCode(value: any): boolean {
  return /^LAB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(
    normalizeJoinCode(value),
  );
}

function issuedJoinCodeCompacts(): Set<string> {
  const retired =
    typeof (dbInstance as any).getRetiredJoinCodes === "function"
      ? (dbInstance as any).getRetiredJoinCodes()
      : [];
  return new Set(
    [
      ...dbInstance
        .getJoinCodes()
        .map((item: any) => compactJoinCode(item.code)),
      ...retired.map((item: any) => compactJoinCode(item.code)),
    ].filter(Boolean),
  );
}

function archivedJoinCodesCount(): number {
  return typeof (dbInstance as any).getRetiredJoinCodes === "function"
    ? (dbInstance as any).getRetiredJoinCodes().length
    : 0;
}

function browserFamilyFromUserAgent(userAgent: any): string {
  const ua = String(userAgent || "");
  if (/SafeExamBrowser|SEB/i.test(ua)) return "seb";
  if (/EdgA|EdgiOS|Edg\//i.test(ua)) return "edge";
  if (/OPR\/|Opera|OPiOS/i.test(ua)) return "opera";
  if (/CriOS/i.test(ua)) return "chrome-ios";
  if (/Chrome\/|Chromium\//i.test(ua)) return "chrome";
  if (/FxiOS/i.test(ua)) return "firefox-ios";
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Safari\//i.test(ua) && !/Chrome\/|Chromium\/|CriOS|FxiOS|OPR\/|Edg\//i.test(ua)) return "safari";
  return "unknown-browser";
}

function deviceFingerprintBrowserSegment(fingerprint: any): string {
  const s = String(fingerprint || "").trim();
  if (!s) return "";
  const raw = s.split("_")[0] || "";
  const family = raw.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  if (!family || family === "unknown" || family === "unknown-browser" || family === "mozilla" || family === "mozilla-5.0") return "legacy";
  if (family === "mozilla/5.0") return "legacy";
  return family;
}

function getRequestDeviceFingerprint(req: express.Request): string {
  const browser = browserFamilyFromUserAgent((req as any)?.headers?.["user-agent"] || "");
  const displayMode = requestExamDisplayMode(req);
  const ip = (req as any)?.ip || "127.0.0.1";
  const deviceToken = getRequestDeviceToken(req);
  return `${browser}-${displayMode}_${ip}_${deviceToken ? crypto.createHash("sha256").update(deviceToken).digest("hex").slice(0, 12) : "no-device-token"}`;
}

function getRequestDeviceToken(req: express.Request): string {
  return String(
    (req as any)?.body?.deviceToken ||
      (req as any)?.headers?.["x-miras-device-id"] ||
      "",
  )
    .trim()
    .slice(0, 160);
}

// هوية الجهاز = الـ deviceToken الثابت، وليس الـ IP. صيغة البصمة هي
// "<متصفح>_<ip>_<hash(deviceToken)>"، والمقطع الثابت الوحيد هو آخر مقطع
// (بصمة الـ deviceToken). تغيّر الـ IP وحده (انتقال من واي‑فاي إلى بيانات،
// أو خلف بروكسي) كان يُغيّر البصمة كاملةً فيُرفض نفس الجهاز خطأً عند الدخول أو
// عند إضافة مقرر جديد. نقارن المقطع الثابت فقط، ونعود للمطابقة الحرفية إذا غاب
// التوكن (بيانات قديمة) حتى لا نكسر أي ربط جهاز سابق أو SEB أو تبديل الجهاز.
function deviceTokenHashSegment(fingerprint: any): string {
  const s = String(fingerprint || "").trim();
  if (!s) return "";
  const idx = s.lastIndexOf("_");
  const seg = idx >= 0 ? s.slice(idx + 1) : s;
  return seg && seg !== "no-device-token" ? seg : "";
}

function deviceFingerprintsMatch(a: any, b: any): boolean {
  const aa = String(a || "").trim();
  const bb = String(b || "").trim();
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const ah = deviceTokenHashSegment(aa);
  const bh = deviceTokenHashSegment(bb);
  if (!ah || !bh || ah !== bh) return false;
  const af = deviceFingerprintBrowserSegment(aa);
  const bf = deviceFingerprintBrowserSegment(bb);
  if (!af || !bf || af === "legacy" || bf === "legacy") return true;
  return af === bf;
}

function isRetiredStudentDeviceSurface(params: {
  currentDeviceToken?: string;
  currentFingerprint?: string;
  retiredDeviceTokens?: any[];
  retiredDeviceFingerprints?: any[];
}): boolean {
  const currentDeviceToken = String(params.currentDeviceToken || "").trim();
  const currentFingerprint = String(params.currentFingerprint || "").trim();
  const retiredDeviceTokens = Array.isArray(params.retiredDeviceTokens)
    ? params.retiredDeviceTokens
        .map((value: any) => String(value || "").trim())
        .filter(Boolean)
    : [];
  const retiredDeviceFingerprints = Array.isArray(
    params.retiredDeviceFingerprints,
  )
    ? params.retiredDeviceFingerprints
        .map((value: any) => String(value || "").trim())
        .filter(Boolean)
    : [];

  // Safari ونسخة PWA على iOS قد يشتركان في deviceToken نفسه. لذلك لا يجوز أن
  // نرفض المتصفح/PWA الجديد لمجرد تطابق التوكن؛ البصمة تضيف عائلة المتصفح ووضع
  // العرض (browser أو pwa)، وهي التي تحدد هل هذه هي الجلسة القديمة فعلاً.
  if (currentFingerprint && retiredDeviceFingerprints.length > 0) {
    return retiredDeviceFingerprints.some((retiredFingerprint: string) => {
      if (retiredFingerprint === currentFingerprint) return true;
      const retiredTokenHash = deviceTokenHashSegment(retiredFingerprint);
      const currentTokenHash = deviceTokenHashSegment(currentFingerprint);
      if (
        !retiredTokenHash ||
        !currentTokenHash ||
        retiredTokenHash !== currentTokenHash
      ) {
        return false;
      }
      const retiredBrowser = deviceFingerprintBrowserSegment(
        retiredFingerprint,
      );
      const currentBrowser = deviceFingerprintBrowserSegment(
        currentFingerprint,
      );
      const retiredIsLegacy = !retiredBrowser || retiredBrowser === "legacy";
      const currentIsLegacy = !currentBrowser || currentBrowser === "legacy";
      if (!retiredIsLegacy && !currentIsLegacy) {
        return retiredBrowser === currentBrowser;
      }
      // السجلات القديمة لا تحتوي نوع المتصفح/وضع PWA. عند تبديل صريح من
      // الأستاذ نسمح بترقيتها إلى بصمة حديثة بدل إبقاء الطالب في حلقة قفل دائمة.
      return retiredIsLegacy && currentIsLegacy;
    });
  }

  // توافق آمن مع سجلات قديمة لم تكن تحفظ البصمة الكاملة.
  return (
    !!currentDeviceToken &&
    retiredDeviceTokens.some(
      (retiredToken: string) => retiredToken === currentDeviceToken,
    )
  );
}

const STUDENT_DEVICE_ALREADY_BOUND_ERROR =
  "هذا الجهاز مرتبط بحساب طالب آخر. يرجى استخدام جهازك الشخصي أو مراجعة أستاذ المقرر.";

function findStudentBoundToDevice(
  deviceToken?: string,
  deviceFingerprint?: string,
  excludeStudentId?: string,
): any | null {
  const token = String(deviceToken || "").trim();
  const fingerprintRaw = String(deviceFingerprint || "").trim();
  const fingerprint =
    fingerprintRaw && !fingerprintRaw.endsWith("_no-device-token")
      ? fingerprintRaw
      : "";
  const excluded = normalizeStudentId(excludeStudentId || "");
  if (!token && !fingerprint) return null;

  const isDifferentStudent = (candidateId: any) => {
    const candidate = normalizeStudentId(candidateId || "");
    return !!candidate && (!excluded || candidate !== excluded);
  };

  const matchingJoinCode = dbInstance.getJoinCodes().find((jc: any) => {
    const linkedStudentId = jc.studentId || jc.usedByStudentId;
    if (!isDifferentStudent(linkedStudentId)) return false;
    const jcToken = String(jc.activationDeviceToken || "").trim();
    const jcFingerprint = String(jc.activationDeviceFingerprint || "").trim();
    return (
      (token && jcToken && jcToken === token) ||
      (fingerprint && jcFingerprint && deviceFingerprintsMatch(jcFingerprint, fingerprint))
    );
  });
  if (matchingJoinCode) {
    const linkedStudentId =
      matchingJoinCode.studentId || matchingJoinCode.usedByStudentId;
    return (
      dbInstance
        .getStudents()
        .find(
          (s: any) =>
            normalizeStudentId(s.id) === normalizeStudentId(linkedStudentId),
        ) || { id: linkedStudentId }
    );
  }

  if (fingerprint) {
    const matchingStudent = dbInstance.getStudents().find((student: any) => {
      if (!isDifferentStudent(student.id)) return false;
      return (
        Array.isArray(student.devices) &&
        student.devices.some((item: any) =>
          deviceFingerprintsMatch(item, fingerprint),
        )
      );
    });
    if (matchingStudent) return matchingStudent;
  }

  return null;
}

function rejectStudentDeviceAlreadyBound(res: express.Response) {
  return res
    .status(409)
    .json({
      error: STUDENT_DEVICE_ALREADY_BOUND_ERROR,
      message: STUDENT_DEVICE_ALREADY_BOUND_ERROR,
    });
}


const SECOND_HAND_DEVICE_APPROVAL_REASON = "طلب اعتماد جهاز مستخدم سابقًا";

function sameDeviceValue(a: any, b: any) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  return !!left && !!right && left === right;
}

function activeSecondHandDeviceConflict(params: {
  deviceToken?: string;
  deviceFingerprint?: string;
  studentId: string;
  sectionCode: string;
  currentRequestId?: string;
}) {
  const now = Date.now();
  const token = String(params.deviceToken || "").trim();
  const fingerprint = String(params.deviceFingerprint || "").trim();
  const studentId = normalizeStudentId(params.studentId);
  const sectionCode = String(params.sectionCode || "").trim();
  const currentRequestId = String(params.currentRequestId || "").trim();

  const pendingSameDevice = dbInstance.getActivationAttempts().find((attempt: any) => {
    if (currentRequestId && String(attempt.id || "") === currentRequestId) return false;
    if (String(attempt.approvalRequestType || "") !== "second_hand_device") return false;
    if (String(attempt.approvalStatus || "") !== "pending") return false;
    if (normalizeStudentId(attempt.targetStudentId || attempt.studentId) === studentId) return false;
    if (sectionCode && !sectionCodeEquivalent(attempt.targetSectionCode || attempt.sectionCode, sectionCode)) return false;
    const attemptTime = new Date(attempt.approvalRequestedAt || attempt.timestamp || 0).getTime() || 0;
    if (attemptTime && now - attemptTime > 24 * 60 * 60 * 1000) return false;
    return (
      sameDeviceValue(attempt.deviceToken, token) ||
      deviceFingerprintsMatch(attempt.deviceFingerprint, fingerprint)
    );
  });
  if (pendingSameDevice) {
    return {
      conflict: true,
      reason: "يوجد طلب اعتماد نشط لنفس الجهاز مع طالب آخر في نفس المقرر.",
    };
  }

  const activeSeb = dbInstance.getSebAttempts().find((pass: any) => {
    if (normalizeStudentId(pass.studentId) === studentId) return false;
    if (sectionCode && !sectionCodeEquivalent(pass.courseCode || pass.sectionCode, sectionCode)) return false;
    const expiresAt = Number(pass.expiresAt || 0) || new Date(pass.expiresAt || 0).getTime() || 0;
    if (expiresAt && expiresAt < now) return false;
    return (
      sameDeviceValue(pass.originalDeviceId, token) ||
      deviceFingerprintsMatch(pass.originalDeviceId, fingerprint)
    );
  });
  if (activeSeb) {
    return {
      conflict: true,
      reason: "يوجد تصريح اختبار SEB نشط لطالب آخر على نفس الجهاز في هذا المقرر.",
    };
  }

  const recentViolation = dbInstance.getActivationAttempts().find((attempt: any) => {
    if (normalizeStudentId(attempt.targetStudentId || attempt.studentId) === studentId) return false;
    if (sectionCode && !sectionCodeEquivalent(attempt.targetSectionCode || attempt.sectionCode, sectionCode)) return false;
    const attemptTime = new Date(attempt.timestamp || attempt.createdAt || 0).getTime() || 0;
    if (!attemptTime || now - attemptTime > 6 * 60 * 60 * 1000) return false;
    const text = `${attempt.reason || ""} ${attempt.activeConflictReason || ""}`;
    if (!/غش|SEB|جلسة نشطة|تعارض نشط|محاولة تفعيل كود من جهاز مرتبط/.test(text)) return false;
    return (
      sameDeviceValue(attempt.deviceToken, token) ||
      deviceFingerprintsMatch(attempt.deviceFingerprint, fingerprint)
    );
  });
  if (recentViolation) {
    return {
      conflict: true,
      reason: "يوجد نشاط أمني حديث على نفس الجهاز داخل هذا المقرر، ويحتاج مراجعة مباشرة.",
    };
  }

  return { conflict: false, reason: "لا يوجد تعارض نشط الآن." };
}

function createSecondHandDeviceApprovalRequest(params: {
  req: express.Request;
  code: string;
  foundCode: any;
  student: any;
  rosterMatch: any;
  sectionCode: string;
  teacherEmail: string;
  deviceToken: string;
  deviceFingerprint: string;
  previousStudent?: any;
}) {
  const existing = dbInstance.getActivationAttempts().find((attempt: any) => {
    if (String(attempt.approvalRequestType || "") !== "second_hand_device") return false;
    if (String(attempt.approvalStatus || "") !== "pending") return false;
    if (normalizeStudentId(attempt.targetStudentId || attempt.studentId) !== normalizeStudentId(params.student.id)) return false;
    if (compactJoinCode(attempt.targetJoinCode || attempt.code || "") !== compactJoinCode(params.code)) return false;
    return sameDeviceValue(attempt.deviceToken, params.deviceToken) || sameDeviceValue(attempt.deviceFingerprint, params.deviceFingerprint);
  });
  if (existing) return existing;

  const now = new Date().toISOString();
  const requestId = `dev-approval-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const conflict = activeSecondHandDeviceConflict({
    deviceToken: params.deviceToken,
    deviceFingerprint: params.deviceFingerprint,
    studentId: params.student.id,
    sectionCode: params.sectionCode,
  });
  const request: any = {
    id: requestId,
    code: String(params.code || ""),
    normalizedCode: normalizeJoinCode(params.code),
    studentId: params.student.id,
    studentName: params.student.name,
    sectionCode: params.sectionCode,
    status: "warning",
    reason: SECOND_HAND_DEVICE_APPROVAL_REASON,
    deviceFingerprint: params.deviceFingerprint,
    deviceToken: params.deviceToken,
    ip: params.req.ip || "127.0.0.1",
    userAgent: String(params.req.headers["user-agent"] || "Unknown"),
    timestamp: now,
    approvalRequestType: "second_hand_device",
    approvalStatus: "pending",
    approvalRequestedAt: now,
    targetStudentId: params.student.id,
    targetStudentName: params.student.name,
    targetStudentEmail: params.student.email || "",
    targetSectionCode: params.sectionCode,
    targetJoinCode: params.foundCode.code,
    targetTeacherEmail: params.teacherEmail,
    previousStudentId: params.previousStudent?.id || "",
    previousStudentName: params.previousStudent?.name || "",
    activeConflict: conflict.conflict,
    activeConflictReason: conflict.reason,
    deviceApprovalRecommendation: conflict.conflict ? "يحتاج مراجعة قبل الاعتماد" : "لا يوجد تعارض نشط",
    silentEnforcement: true,
    recommendedAction: conflict.conflict ? "راجع الطلب قبل الاعتماد" : "اعتماد الجهاز إذا تطابقت هوية الطالب",
  };
  dbInstance.addActivationAttempt(request);
  rememberInAppNotification({
    role: "teacher",
    teacherEmail: params.teacherEmail,
    sectionCode: params.sectionCode,
    type: "second_hand_device_approval",
    title: "طلب اعتماد جهاز مستخدم سابقًا",
    body: `${params.student.name || params.student.id} • ${courseNameFromCode(params.sectionCode)} • ${conflict.reason}`,
    data: {
      approvalRequestId: requestId,
      approvalRequestType: "second_hand_device",
      studentId: params.student.id,
      courseCode: params.sectionCode,
      link: "/",
    },
  });
  dbInstance.addActivityLog({
    studentId: params.student.id,
    studentName: params.student.name,
    action: "طلب اعتماد جهاز مستخدم سابقًا",
    details: `طلب اعتماد جهاز سبق استخدامه في النظام للطالب ${params.student.name || params.student.id} في مقرر ${courseNameFromCode(params.sectionCode)}. ${conflict.reason}`,
    teacherEmail: params.teacherEmail,
    actorEmail: params.teacherEmail,
    sectionCode: params.sectionCode,
    ip: params.req.ip || "127.0.0.1",
    userAgent: params.req.headers["user-agent"] || "Unknown",
    os: "اعتماد جهاز",
    browser: "متصفح الويب",
    isViolationWarning: false,
  });
  return request;
}

function releaseDeviceFromPreviousOwners(params: {
  deviceToken?: string;
  deviceFingerprint?: string;
  newStudentId: string;
  requestId: string;
  actorEmail: string;
}) {
  const now = new Date().toISOString();
  const newStudentId = normalizeStudentId(params.newStudentId);
  dbInstance.getJoinCodes().forEach((jc: any) => {
    const linkedStudentId = normalizeStudentId(jc.studentId || jc.usedByStudentId || jc.assignedStudentId || "");
    if (!linkedStudentId || linkedStudentId === newStudentId) return;
    const matches =
      sameDeviceValue(jc.activationDeviceToken, params.deviceToken) ||
      deviceFingerprintsMatch(jc.activationDeviceFingerprint, params.deviceFingerprint);
    if (!matches) return;
    dbInstance.updateJoinCode(jc.code, {
      activationDeviceToken: "",
      activationDeviceFingerprint: "",
      secondHandDeviceReleasedAt: now,
      secondHandDeviceReleasedBy: params.actorEmail,
      secondHandDeviceReleasedForStudentId: newStudentId,
      secondHandDeviceApprovalRequestId: params.requestId,
    } as any);
  });
  dbInstance.getStudents().forEach((student: any) => {
    if (normalizeStudentId(student.id) === newStudentId) return;
    const devices = Array.isArray(student.devices) ? student.devices : [];
    if (!devices.some((d: any) => deviceFingerprintsMatch(d, params.deviceFingerprint))) return;
    const nextDevices = devices.filter((d: any) => !deviceFingerprintsMatch(d, params.deviceFingerprint));
    const retiredDeviceFingerprints = Array.from(new Set([...(Array.isArray(student.retiredDeviceFingerprints) ? student.retiredDeviceFingerprints : []), params.deviceFingerprint].filter(Boolean)));
    const retiredDeviceTokens = Array.from(new Set([...(Array.isArray(student.retiredDeviceTokens) ? student.retiredDeviceTokens : []), params.deviceToken].filter(Boolean)));
    dbInstance.updateStudent(student.id, {
      devices: nextDevices,
      retiredDeviceFingerprints,
      retiredDeviceTokens,
      secondHandDeviceReleasedAt: now,
      secondHandDeviceReleasedBy: params.actorEmail,
      secondHandDeviceReleasedForStudentId: newStudentId,
    } as any);
  });
}

function isSebRequest(req: express.Request): boolean {
  const userAgent = String(req.headers["user-agent"] || "");
  const sebHeader = String(
    req.headers["x-safeexambrowser-requesthash"] ||
      req.headers["x-safe-exam-browser"] ||
      req.headers["x-miras-seb-armed"] ||
      "",
  );
  const sebQuery = String(
    req.query?.seb || req.query?.miras_seb || req.body?.seb || "",
  );
  return (
    /SafeExamBrowser|SEB/i.test(userAgent) ||
    /SafeExamBrowser|SEB/i.test(sebHeader) ||
    sebQuery === "1" ||
    !!getSebPassFromRequest(req)
  );
}

function hasSebRuntimeHint(req: express.Request): boolean {
  const userAgent = String(req.headers["user-agent"] || "");
  const sebHeader = String(
    req.headers["x-safeexambrowser-requesthash"] ||
      req.headers["x-safe-exam-browser"] ||
      "",
  );
  return (
    /SafeExamBrowser|SEB/i.test(userAgent) ||
    /SafeExamBrowser|SEB/i.test(sebHeader)
  );
}

function buildResetLink(req: express.Request, token: string): string {
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http",
  ).split(",")[0];
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`,
  ).split(",")[0];
  return `${proto}://${host}/?resetToken=${encodeURIComponent(token)}`;
}

function publicPasswordResetRequest(reqItem: any) {
  const expired =
    reqItem.status === "new" &&
    new Date(reqItem.expiresAt).getTime() <= Date.now();
  return {
    ...reqItem,
    status: expired ? "expired" : reqItem.status,
    resetToken: undefined,
  };
}

function firebasePublicConfig() {
  let fileConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath))
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {}
  return {
    apiKey: process.env.FIREBASE_API_KEY || fileConfig.apiKey || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || fileConfig.authDomain || "",
    projectId: process.env.FIREBASE_PROJECT_ID || fileConfig.projectId || "",
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET || fileConfig.storageBucket || "",
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID ||
      fileConfig.messagingSenderId ||
      "",
    appId: process.env.FIREBASE_APP_ID || fileConfig.appId || "",
    measurementId:
      process.env.FIREBASE_MEASUREMENT_ID || fileConfig.measurementId || "",
    vapidKey: process.env.FIREBASE_FCM_VAPID_KEY || fileConfig.vapidKey || "",
  };
}

function appPublicUrl() {
  const raw = String(process.env.APP_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "";
}

function absoluteHttpsPushLink(link?: string) {
  const base = appPublicUrl();
  const raw = String(link || "/").trim() || "/";
  try {
    const url = base ? new URL(raw, `${base}/`) : new URL(raw);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function stringifyFcmData(
  data: Record<string, any>,
  title: string,
  body: string,
) {
  const out: Record<string, string> = {};
  Object.entries({ ...data, title, body }).forEach(([key, value]) => {
    if (value !== undefined && value !== null) out[key] = String(value);
  });
  if (!out.link) out.link = "/";
  return out;
}

function shouldDisableFcmToken(reason: string) {
  return /UNREGISTERED|registration-token-not-registered|Requested entity was not found|INVALID_ARGUMENT/i.test(
    reason || "",
  );
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

let fcmAccessTokenCache: { token: string; expiresAt: number } | null = null;

function serviceAccountFromEnvOrFile() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  if (raw.trim()) {
    try {
      return raw.trim().startsWith("{")
        ? JSON.parse(raw)
        : JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    } catch {
      console.warn(
        "FCM service account env is present but not valid JSON/base64 JSON.",
      );
      return null;
    }
  }
  const serviceAccountPath = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      "",
  ).trim();
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
      if (parsed?.client_email && parsed?.private_key) return parsed;
    } catch {
      console.warn(
        "FCM service account file is present but not valid service-account JSON.",
      );
    }
  }
  return null;
}

function hasFcmSenderCandidate() {
  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  )
    return true;
  if (
    process.env.K_SERVICE ||
    process.env.GAE_ENV ||
    process.env.FUNCTION_TARGET
  )
    return true;
  try {
    const active = execFileSync(
      "gcloud",
      ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
      { encoding: "utf-8", timeout: 4000 },
    ).trim();
    return !!active;
  } catch {
    return false;
  }
}

async function getMetadataAccessToken(): Promise<string | null> {
  try {
    const resp = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(1500),
      } as any,
    );
    if (!resp.ok) return null;
    const data: any = await resp.json();
    if (!data?.access_token) return null;
    fcmAccessTokenCache = {
      token: data.access_token,
      expiresAt:
        Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
    };
    return fcmAccessTokenCache.token;
  } catch {
    return null;
  }
}

function getGcloudAccessToken(projectId: string): string | null {
  try {
    const args = ["auth", "print-access-token"];
    if (projectId) args.push("--project", projectId);
    const token = execFileSync("gcloud", args, {
      encoding: "utf-8",
      timeout: 7000,
    }).trim();
    if (!token) return null;
    fcmAccessTokenCache = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
    return token;
  } catch {
    return null;
  }
}

async function getFcmAccessToken(): Promise<string | null> {
  if (fcmAccessTokenCache && fcmAccessTokenCache.expiresAt > Date.now() + 60000)
    return fcmAccessTokenCache.token;
  const publicConfig = firebasePublicConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || publicConfig.projectId;
  const serviceAccount = serviceAccountFromEnvOrFile();
  if (!serviceAccount) {
    const metadataToken = await getMetadataAccessToken();
    if (metadataToken) return metadataToken;
    return getGcloudAccessToken(projectId);
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(serviceAccount.private_key);
  const assertion = `${signingInput}.${base64Url(signature)}`;
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!tokenResp.ok) {
    console.warn(
      "FCM OAuth token request failed:",
      await tokenResp.text().catch(() => ""),
    );
    return null;
  }
  const data: any = await tokenResp.json();
  fcmAccessTokenCache = {
    token: data.access_token,
    expiresAt:
      Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return fcmAccessTokenCache.token;
}

async function sendFcmToToken(
  token: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
) {
  const publicConfig = firebasePublicConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || publicConfig.projectId;
  const accessToken = await getFcmAccessToken();
  if (!projectId || !accessToken || !token)
    return { sent: false, reason: "FCM_NOT_CONFIGURED" };
  const fcmData = stringifyFcmData(data, title, body);
  const clickLink = absoluteHttpsPushLink(fcmData.link);
  const webpush: any = {
    notification: {
      title,
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "ar",
      data: { url: fcmData.link || "/" },
    },
  };
  if (clickLink) webpush.fcm_options = { link: clickLink };
  const resp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush,
          data: fcmData,
        },
      }),
    },
  );
  if (!resp.ok)
    return {
      sent: false,
      reason: await resp.text().catch(() => "FCM_SEND_FAILED"),
    };
  return { sent: true };
}

function normalizeNotificationNoiseText(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSuppressRoutineStudentNotification(
  title: any,
  body: any,
  data: Record<string, any> = {},
): boolean {
  const type = normalizeNotificationNoiseText(data.type || data.kind || "");
  const text = normalizeNotificationNoiseText(
    `${type} ${title || ""} ${body || ""} ${JSON.stringify(data || {})}`,
  );
  if (
    data.silentCameraExceptionUpdate === true ||
    data.notifyStudents === false ||
    data.notifyStudents === "false" ||
    data.onlyAdministrativeEdit === true ||
    data.isAdministrativeEdit === true ||
    type === "camera_exception" ||
    type === "exam_integrity_pulse" ||
    type === "teacher_camera_exception"
  ) {
    return true;
  }
  const routineTypes = new Set([
    "course_updated",
    "course_renamed",
    "course_name_updated",
    "section_updated",
    "section_renamed",
    "exam_updated",
    "exam_renamed",
    "exam_name_updated",
    "quiz_updated",
    "quiz_renamed",
    "project_updated",
    "project_renamed",
    "project_name_updated",
    "camera_added",
    "camera_removed",
    "camera_updated",
    "camera_deleted",
    "course_camera_added",
    "course_camera_removed",
    "course_camera_updated",
    "teacher_course_change",
    "teacher_student_change",
    "duplicate_name_renamed",
    "name_duplicate_fixed",
    "roster_cleanup",
    "admin_cleanup",
  ]);
  const routineByType =
    routineTypes.has(type) ||
    /camera|rename|renamed|updated|update|edit|edited/.test(type);
  const routineByText =
    /اسم مكرر|مكرر|تعديل اسم|تغيير اسم|تحديث اسم|تعديل اسم المقرر|تعديل اسم الاختبار|تعديل اسم المشروع|تحديث مقرر|تحديث اختبار|تحديث مشروع|تم تحديث|تم تعديل|تنظيف|ترتيب|تصحيح اسم|اضافه كاميرا|إضافة كاميرا|اضافة كاميرا|حذف كاميرا|ازاله كاميرا|إزالة كاميرا|تعديل كاميرا|تحديث الكاميرا|تحديث فقط/.test(
      text,
    );
  const meaningful =
    /اختبار جديد|مشروع جديد|تنبيه اختبار|تسليم مطلوب|مطلوب|واجب|درجة|درجه|تم نشر درجتك|ارجاع|إرجاع|اعاده|إعادة|قبول|رفض|ايقاف دخول|إيقاف دخول|تفعيل|رابط إعادة|كلمة مرور|متاح الآن|فتح الاختبار|إغلاق الاختبار|اغلاق الاختبار|موعد|إعلان|تنبيه مهم/.test(
      text,
    );
  const cameraAdministrativeNoise =
    /كاميرا|camera/.test(text) &&
    !/مخالفة|غش|محاولة|نزاهة|تحذير|تنبيه مهم/.test(text);
  return (routineByType || routineByText || cameraAdministrativeNoise) && !meaningful;
}

function notificationTargets(filter: (token: NotificationToken) => boolean) {
  return dbInstance
    .getNotificationTokens()
    .filter(
      (token) =>
        !token.disabledAt && token.permission === "granted" && filter(token),
    );
}

function notifyUsers(
  filter: (token: NotificationToken) => boolean,
  title: string,
  body: string,
  data: Record<string, string> = {},
) {
  const safeTitle = sanitizePublicMessageText(title) || "مِراس";
  const safeBody = sanitizePublicMessageText(body) || "لديك تنبيه جديد.";
  const targets = notificationTargets(filter);
  const seen = new Set<string>();
  targets.forEach((target) => {
    if (
      target.role === "student" &&
      shouldSuppressRoutineStudentNotification(safeTitle, safeBody, data)
    ) {
      return;
    }
    sendFcmToToken(target.token, safeTitle, safeBody, data)
      .then((result) => {
        if (!result.sent) {
          console.warn("FCM send skipped/failed:", result.reason);
          if (shouldDisableFcmToken(String(result.reason || ""))) {
            dbInstance.disableNotificationToken(target.token, target.userId);
          }
        }
      })
      .catch((err) => console.warn("FCM send failed:", err?.message || err));
    const key = `${target.role}:${target.userId || ""}:${target.sectionCode || ""}:${data.courseCode || ""}`;
    const courseNotificationAlreadyCoversStudent =
      target.role === "student" &&
      Boolean(data.courseCode) &&
      !data.userId &&
      !data.studentId;
    if (!courseNotificationAlreadyCoversStudent && !seen.has(key)) {
      seen.add(key);
      rememberInAppNotification({
        userId: target.userId,
        role: target.role,
        sectionCode: target.sectionCode,
        title: safeTitle,
        body: safeBody,
        type: data.type || "push",
        data,
      });
    }
  });
  return targets.length;
}

function isCriticalTeacherNotification(
  data: Record<string, string> = {},
  title = "",
) {
  const type = String(data.type || "").toLowerCase();

  // Explicitly ignore normal student actions that are not critical violations (e.g., normal submission, login, activation)
  if (
    [
      "exam_submission",
      "project_submission",
      "course_activated",
      "code_used",
      "student_registered",
      "student_logged_in",
    ].includes(type)
  ) {
    return false;
  }

  const titleLower = title.toLowerCase();
  if (
    titleLower.includes("تسليم") ||
    titleLower.includes("دخول ناجح") ||
    titleLower.includes("تسجيل طالب") ||
    titleLower.includes("تفعيل مقرر") ||
    titleLower.includes("مشروع جديد")
  ) {
    return false;
  }

  return (
    [
      "code_integrity",
      "login_blocked",
      "password_reset",
      "password_reset_resend",
      "password_changed",
      "manual_password_changed",
      "seb_exit_before_submit",
      "exam_exited_before_submit",
      "exam_withdrawn",
      "exam_cheating_attempt",
      "exam_warning",
    ].includes(type) ||
    /خطر|تحذير|نزاهة|مرفوض|كلمة مرور|استرجاع|خروج طالب|خرج من اختبار|انسحاب|غش/i.test(
      title,
    )
  );
}

function notifyTeachersForSection(
  sectionCode: string | undefined,
  title: string,
  body: string,
  data: Record<string, string> = {},
) {
  if (!isCriticalTeacherNotification(data, title)) return 0;
  const safeTitle = sanitizePublicMessageText(title) || "مِراس";
  const safeBody = sanitizePublicMessageText(body) || "لديك تنبيه جديد.";
  const ownerEmail = sectionOwnerEmail(sectionCode);
  const count = notifyUsers(
    (token) =>
      token.role !== "student" &&
      (!ownerEmail ||
        String(token.teacherEmail || token.userId).toLowerCase() ===
          ownerEmail),
    safeTitle,
    safeBody,
    data,
  );
  // ضمان جذري: أي تنبيه مهم للأستاذ (غش/نزاهة/مخالفة جهاز/كلمة مرور...) يجب أن
  // تبقى له نسخة داخلية في صندوق السيرفر — مصدر الحقيقة — حتى لو لم يكن لدى الأستاذ
  // أي توكن FCM مفعّل (مثلاً لم يمنح إذن الإشعارات على المتصفح). سابقاً كانت النسخة
  // الداخلية تُحفظ فقط داخل حلقة توكنات FCM، فإذا لم يوجد توكن لم يُحفظ شيء واختفى
  // التنبيه من الجرس. هنا نحفظ نسخة واحدة موجَّهة لصاحب الشعبة بنفس آلية منع التكرار
  // (نفس التوقيع خلال 15 ثانية) فلا يحدث ازدواج مع النسخ المحفوظة لكل توكن.
  if (ownerEmail) {
    rememberInAppNotification({
      userId: ownerEmail,
      role: isAdminEmail(ownerEmail) ? "admin" : "teacher",
      title: safeTitle,
      body: safeBody,
      type: data.type || "teacher",
      data: { ...data, teacherEmail: ownerEmail },
    });
  }
  return count;
}

function notifyStudent(
  studentId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
) {
  const safeTitle = sanitizePublicMessageText(title) || "مِراس";
  const safeBody = sanitizePublicMessageText(body) || "لديك تنبيه جديد.";
  if (shouldSuppressRoutineStudentNotification(safeTitle, safeBody, data)) return 0;
  const count = notifyUsers(
    (token) =>
      token.role === "student" && String(token.userId) === String(studentId),
    safeTitle,
    safeBody,
    data,
  );
  if (count === 0 || Boolean(data.courseCode)) {
    rememberInAppNotification({
      userId: String(studentId),
      role: "student",
      title: safeTitle,
      body: safeBody,
      type: data.type || "student",
      data,
    });
  }
  return count;
}
function studentTokenHasCourse(
  token: NotificationToken,
  courseCode: string | undefined,
) {
  const code = String(courseCode || "")
    .trim()
    .toLowerCase();
  if (!code) return false;
  if (String(token.sectionCode || "").toLowerCase() === code) return true;
  const student = dbInstance
    .getStudents()
    .find((st: any) => String(st.id) === String(token.userId));
  // للإشعارات نعتمد على الالتحاق المكتشف (يشمل مقررات المعاد المغلقة) وليس المقررات النشطة فقط.
  return (
    !!student &&
    getStudentDiscoveredCourseCodes(student).some(
      (c: any) => String(c).toLowerCase() === code,
    )
  );
}
// عضوية الإشعارات: هل يجب أن يصل هذا الطالب تنبيهات هذا المقرر؟ تختلف عن صلاحية الدخول
// (studentHasEnrollmentInCourse) عمداً — الطالب المعاد في مقرر مغلق يجب أن تصله التنبيهات
// رغم أن دخوله للمقرر قد يكون مقفلاً.
function studentEnrolledForNotifications(
  student: any,
  courseCode: any,
): boolean {
  const code = String(courseCode || "")
    .trim()
    .toLowerCase();
  if (!code) return true;
  return getStudentDiscoveredCourseCodes(student).some(
    (c: any) => String(c).toLowerCase() === code,
  );
}

// تنبيهات الجرس محفوظة الآن في قاعدة البيانات (dbInstance) بدل مصفوفة في الذاكرة، حتى لا
// تضيع عند إعادة تشغيل الخادم أو النشر — وهو سبب محتمل لاختفاء تنبيهات أُرسلت ثم لم تصل.
function rememberInAppNotification(item: any) {
  const compact = (value: any) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const saved = {
    id:
      item.id || `note-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    userId: item.userId ? String(item.userId) : "",
    role: item.role ? String(item.role) : "",
    sectionCode: item.sectionCode ? String(item.sectionCode) : "",
    title: sanitizePublicMessageText(item.title || "مِراس") || "مِراس",
    body:
      sanitizePublicMessageText(item.body || "لديك تنبيه جديد.") ||
      "لديك تنبيه جديد.",
    type: String(item.type || item.data?.type || "course"),
    data: item.data || {},
    createdAt: item.createdAt || new Date().toISOString(),
    read: false,
  };
  const savedRole = String(
    saved.role || saved.data?.role || saved.data?.targetRole || "",
  )
    .trim()
    .toLowerCase();
  const savedTargetRole = String(saved.data?.targetRole || "")
    .trim()
    .toLowerCase();
  if (
    (savedRole === "student" ||
      savedRole === "students" ||
      savedTargetRole === "student" ||
      savedTargetRole === "students") &&
    shouldSuppressRoutineStudentNotification(saved.title, saved.body, saved.data)
  ) {
    return null;
  }
  const signature = [
    saved.userId,
    saved.role,
    saved.sectionCode,
    saved.type,
    compact(
      (saved.data as any)?.activityId ||
        (saved.data as any)?.examId ||
        (saved.data as any)?.projectId ||
        (saved.data as any)?.submissionId ||
        "",
    ),
    compact(saved.title),
    compact(saved.body),
  ].join("|");
  const now = new Date(saved.createdAt).getTime() || Date.now();
  const store = dbInstance.getInAppNotifications();
  const duplicate = store.find((old: any) => {
    const oldSignature = [
      String(old.userId || ""),
      String(old.role || ""),
      String(old.sectionCode || ""),
      String(old.type || old.data?.type || "course"),
      compact(
        old.data?.activityId ||
          old.data?.examId ||
          old.data?.projectId ||
          old.data?.submissionId ||
          "",
      ),
      compact(old.title || "مِراس"),
      compact(old.body || "لديك تنبيه جديد."),
    ].join("|");
    const oldTime = new Date(old.createdAt || 0).getTime() || 0;
    return oldSignature === signature && Math.abs(now - oldTime) <= 15000;
  });
  if (duplicate) return duplicate;
  dbInstance.addInAppNotification(saved);
  return saved;
}

function rememberCourseNotification(
  sectionCode: string,
  title: string,
  body: string,
  type = "course",
  data: Record<string, string> = {},
) {
  return rememberInAppNotification({
    sectionCode,
    role: "student",
    title,
    body,
    type,
    data: { ...data, courseCode: sectionCode },
  });
}

type ActivationRateBucket = {
  firstSeen: number;
  attempts: number;
  blockedUntil: number;
};
const activationRateBuckets = new Map<string, ActivationRateBucket>();

function activationRateKey(kind: string, value: any): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return `${kind}:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function rememberActivationRateStrike(
  req: express.Request,
  params: { code?: string; student?: Student },
) {
  const now = Date.now();
  const fingerprint = getRequestDeviceFingerprint(req);
  const token = getRequestDeviceToken(req);
  const keys = [
    activationRateKey("ip", req.ip || "127.0.0.1"),
    activationRateKey("device", token || fingerprint),
    activationRateKey("student", params.student?.id),
    activationRateKey("code", compactJoinCode(params.code || "")),
  ].filter(Boolean);

  for (const key of keys) {
    const old = activationRateBuckets.get(key);
    if (!old || now - old.firstSeen > 60 * 60 * 1000) {
      activationRateBuckets.set(key, {
        firstSeen: now,
        attempts: 1,
        blockedUntil: 0,
      });
    } else {
      old.attempts += 1;
      activationRateBuckets.set(key, old);
    }
  }

  if (activationRateBuckets.size > 5000) {
    for (const [key, bucket] of activationRateBuckets.entries()) {
      if (
        now - bucket.firstSeen > 2 * 60 * 60 * 1000 &&
        bucket.blockedUntil < now
      )
        activationRateBuckets.delete(key);
    }
  }
}

function getActivationRateLimit(
  req: express.Request,
  params: { code?: string; student?: Student },
) {
  const now = Date.now();
  const fingerprint = getRequestDeviceFingerprint(req);
  const token = getRequestDeviceToken(req);
  const checks = [
    {
      key: activationRateKey("student", params.student?.id),
      max: 12,
      windowMs: 10 * 60 * 1000,
      blockMs: 10 * 60 * 1000,
    },
    {
      key: activationRateKey("code", compactJoinCode(params.code || "")),
      max: 8,
      windowMs: 10 * 60 * 1000,
      blockMs: 15 * 60 * 1000,
    },
    {
      key: activationRateKey("device", token || fingerprint),
      max: 28,
      windowMs: 30 * 60 * 1000,
      blockMs: 30 * 60 * 1000,
    },
    {
      key: activationRateKey("ip", req.ip || "127.0.0.1"),
      max: 80,
      windowMs: 60 * 60 * 1000,
      blockMs: 60 * 60 * 1000,
    },
  ].filter((item) => item.key);

  for (const item of checks) {
    const bucket = activationRateBuckets.get(item.key);
    if (!bucket) continue;
    if (bucket.blockedUntil > now) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.blockedUntil - now) / 1000),
        ),
      };
    }
    if (
      now - bucket.firstSeen <= item.windowMs &&
      bucket.attempts >= item.max
    ) {
      bucket.blockedUntil = now + item.blockMs;
      activationRateBuckets.set(item.key, bucket);
      return {
        limited: true,
        retryAfterSeconds: Math.ceil(item.blockMs / 1000),
      };
    }
    if (now - bucket.firstSeen > item.windowMs && bucket.blockedUntil < now) {
      activationRateBuckets.delete(item.key);
    }
  }
  return { limited: false, retryAfterSeconds: 0 };
}

const STUDENT_SAFE_JOIN_CODE_ERROR = "الكود غير صالح أو لا يمكن استخدامه.";
const STRICT_LIBRARY_MODE_DEFAULT = true;
const CODE_REPUTATION_LABELS: Record<string, string> = {
  normal: "طبيعي",
  watch: "مراقبة",
  suspicious: "مشتبه",
  danger: "خطر",
  temporarily_blocked: "محظور مؤقتًا",
};

function getActivationTelemetry(req: express.Request) {
  const raw =
    (req.body &&
      (req.body.activationTelemetry ||
        req.body.codeTelemetry ||
        req.body.typingTelemetry)) ||
    {};
  const typed = Boolean(raw.typed);
  const pasted = Boolean(raw.pasted);
  const durationMs = Math.max(
    0,
    Math.min(Number(raw.durationMs || raw.elapsedMs || 0) || 0, 10 * 60 * 1000),
  );
  const keyEvents = Math.max(
    0,
    Math.min(Number(raw.keyEvents || raw.keyCount || 0) || 0, 500),
  );
  const correctionEvents = Math.max(
    0,
    Math.min(Number(raw.correctionEvents || raw.backspaces || 0) || 0, 200),
  );
  const fieldName = String(raw.fieldName || raw.source || "joinCode").slice(
    0,
    60,
  );
  const looksAutomated =
    Boolean(raw.looksAutomated) ||
    (!typed && durationMs > 0 && durationMs < 350) ||
    (keyEvents >= 8 && durationMs > 0 && durationMs < 1200);
  return {
    typed,
    pasted,
    durationMs,
    keyEvents,
    correctionEvents,
    fieldName,
    looksAutomated,
  };
}

function codeJourneyEvent(
  label: string,
  req: express.Request,
  extra: Record<string, any> = {},
) {
  return {
    id: `cj-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
    label,
    at: new Date().toISOString(),
    ip: req.ip || "127.0.0.1",
    deviceFingerprint: getRequestDeviceFingerprint(req),
    deviceToken: getRequestDeviceToken(req),
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    ...extra,
  };
}

function stableLedgerString(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableLedgerString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((k) => k !== "hash").sort().map((k) => `${JSON.stringify(k)}:${stableLedgerString(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function ledgerHash(prevHash: string, payload: any): string {
  return crypto.createHash("sha256").update(`${prevHash}|${stableLedgerString(payload)}`).digest("hex");
}

function appendCodeJourney(code: JoinCode, event: any) {
  const previous = Array.isArray((code as any).codeJourney)
    ? (code as any).codeJourney
    : [];
  const prevHash = String(previous.at(-1)?.hash || "GENESIS");
  const payload = { ...event, prevHash };
  return [...previous.slice(-49), { ...payload, hash: ledgerHash(prevHash, payload) }];
}

function verifyLedger(code: any) {
  const events = Array.isArray(code?.codeJourney) ? code.codeJourney : [];
  let prevHash = "GENESIS";
  for (const event of events) {
    const expectedPrev = String(event?.prevHash || "GENESIS");
    if (expectedPrev !== prevHash) return { ok: false, reason: "prev_mismatch", at: event?.id || "" };
    const expectedHash = ledgerHash(prevHash, event || {});
    if (String(event?.hash || "") !== expectedHash) return { ok: false, reason: "hash_mismatch", at: event?.id || "" };
    prevHash = expectedHash;
  }
  return { ok: true, reason: "ok", events: events.length, lastHash: prevHash === "GENESIS" ? "" : prevHash };
}

function reputationTone(score: number, blockedUntil?: string) {
  if (blockedUntil && new Date(blockedUntil).getTime() > Date.now())
    return "temporarily_blocked";
  if (score >= 90) return "danger";
  if (score >= 70) return "suspicious";
  if (score >= 40) return "watch";
  return "normal";
}

function calculateCodeReputation(params: {
  code: string;
  foundCode?: JoinCode;
  reason: string;
  student?: Student;
  telemetry: any;
}) {
  const normalized = normalizeJoinCode(params.code);
  const compact = compactJoinCode(params.code);
  const attempts = dbInstance.getActivationAttempts().filter((attempt: any) => {
    const aCompact = compactJoinCode(
      attempt.normalizedCode || attempt.code || "",
    );
    return compact && aCompact === compact;
  });
  const devices = new Set(
    attempts
      .map((a: any) => a.deviceToken || a.deviceFingerprint)
      .filter(Boolean),
  );
  const ips = new Set(attempts.map((a: any) => a.ip).filter(Boolean));
  const students = new Set(
    attempts.map((a: any) => normalizeStudentId(a.studentId)).filter(Boolean),
  );
  const reason = String(params.reason || "");
  const honey = isUnifiedJoinCode(params.code) && !params.foundCode;
  let score = 10;
  score += Math.min(36, attempts.length * 6);
  score += Math.min(24, Math.max(0, devices.size - 1) * 8);
  score += Math.min(18, Math.max(0, ips.size - 1) * 6);
  score += Math.min(20, Math.max(0, students.size - 1) * 10);
  if (honey) score += 40;
  if (reason.includes("مستخدم") || reason.includes("مقفل")) score += 22;
  if (reason.includes("جهاز") || reason.includes("توكن")) score += 18;
  if (reason.includes("مخصص") || reason.includes("لا يتبع")) score += 14;
  if (params.telemetry?.looksAutomated) score += 22;
  if (
    params.telemetry?.pasted &&
    Number(params.telemetry?.durationMs || 0) < 1500
  )
    score += 8;
  score = Math.min(99, score);
  const shouldFreeze =
    Boolean(params.foundCode) &&
    String((params.foundCode as any).status || "") === "active" &&
    (score >= 92 || devices.size >= 8 || attempts.length >= 12);
  const blockedUntil = shouldFreeze
    ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    : String((params.foundCode as any)?.activationFrozenUntil || "");
  const level = reputationTone(score, blockedUntil);
  return {
    score,
    level,
    label: CODE_REPUTATION_LABELS[level] || "طبيعي",
    honey,
    distinctDevices: devices.size,
    distinctIps: ips.size,
    distinctStudents: students.size,
    totalAttempts: attempts.length + 1,
    shouldFreeze,
    blockedUntil,
  };
}

function updateJoinCodeReputation(
  req: express.Request,
  params: {
    code: string;
    foundCode?: JoinCode;
    reason: string;
    student?: Student;
    telemetry: any;
  },
) {
  if (!params.foundCode) return null;
  const reputation = calculateCodeReputation(params);
  const current = params.foundCode as any;
  dbInstance.updateJoinCode(params.foundCode.code, {
    codeReputation: reputation.level,
    codeReputationLabel: reputation.label,
    codeReputationScore: reputation.score,
    codeReputationUpdatedAt: new Date().toISOString(),
    distinctFailedDevices: reputation.distinctDevices,
    distinctFailedIps: reputation.distinctIps,
    distinctFailedStudents: reputation.distinctStudents,
    activationFrozenUntil: reputation.shouldFreeze
      ? reputation.blockedUntil
      : current.activationFrozenUntil,
    activationReviewRequired: Boolean(
      current.activationReviewRequired || reputation.shouldFreeze,
    ),
    codeJourney: appendCodeJourney(
      params.foundCode,
      codeJourneyEvent("محاولة مرفوضة", req, {
        reason: params.reason,
        studentId: params.student?.id,
        studentName: params.student?.name,
        reputationLevel: reputation.level,
        reputationLabel: reputation.label,
        reputationScore: reputation.score,
        telemetry: params.telemetry,
      }),
    ),
  } as any);
  return reputation;
}

function isJoinCodeTemporarilyFrozen(code: any) {
  const until = new Date(String(code?.activationFrozenUntil || "")).getTime();
  return Number.isFinite(until) && until > Date.now();
}

function joinCodeWindowStatus(code: any) {
  const now = Date.now();
  const startsRaw = String(
    code?.activationStartsAt || code?.validFrom || "",
  ).trim();
  const endsRaw = String(
    code?.activationEndsAt || code?.validUntil || "",
  ).trim();
  const startsAt = startsRaw ? new Date(startsRaw).getTime() : 0;
  const endsAt = endsRaw ? new Date(endsRaw).getTime() : 0;
  if (startsAt && Number.isFinite(startsAt) && now < startsAt)
    return {
      ok: false,
      reason: "الكود خارج نافذة التفعيل: لم تبدأ الصلاحية بعد",
    };
  if (endsAt && Number.isFinite(endsAt) && now > endsAt)
    return { ok: false, reason: "الكود خارج نافذة التفعيل: انتهت الصلاحية" };
  return { ok: true, reason: "" };
}

function resolveJoinCodeBatchId(code: any) {
  const direct = String(
    code?.batchId || code?.batchName || code?.batch || code?.libraryBatch || "",
  ).trim();
  if (direct) return direct;
  const semester = String(code?.semester || code?.academicTerm || "").trim();
  const section = String(
    code?.studentSection || code?.sectionCode || code?.courseCode || "",
  ).trim();
  if (semester || section)
    return [semester || "دفعة غير مؤرخة", section || "كل الشعب"].join(" / ");
  return "دفعة غير محددة";
}

function resolveAttemptBatchId(attempt: any, codeRecord?: any) {
  return String(
    attempt?.batchId || resolveJoinCodeBatchId(codeRecord || attempt || {}),
  );
}

function classifyStudentFairness(attempts: any[], codeRecord?: any) {
  const total = attempts.length;
  const devices = new Set(
    attempts
      .map((a: any) => a.deviceToken || a.deviceFingerprint)
      .filter(Boolean),
  );
  const students = new Set(
    attempts.map((a: any) => normalizeStudentId(a.studentId)).filter(Boolean),
  );
  const pastedFast = attempts.filter(
    (a: any) =>
      a.activationTelemetry?.pasted &&
      Number(a.activationTelemetry?.durationMs || 0) < 1500,
  ).length;
  const automated = attempts.filter(
    (a: any) => a.activationTelemetry?.looksAutomated,
  ).length;
  const honey = attempts.some(
    (a: any) => a.honeyCode || String(a.reason || "").includes("مصيدة"),
  );
  const usedByOther = attempts.some(
    (a: any) =>
      String(a.reason || "").includes("مستخدم") ||
      String(a.reason || "").includes("مرتبط"),
  );
  let level = "خطأ بسيط";
  let score = Math.min(
    99,
    total * 8 +
      Math.max(0, devices.size - 1) * 12 +
      Math.max(0, students.size - 1) * 15 +
      pastedFast * 6 +
      automated * 18 +
      (honey ? 28 : 0) +
      (usedByOther ? 18 : 0),
  );
  let label = "خطأ طالب طبيعي";
  if (automated || honey || total >= 10) {
    level = "نمط آلي";
    label = "محاولة تشبه التخمين أو السكربت";
  } else if (usedByOther || students.size >= 2) {
    level = "تداول محتمل";
    label = "كود يبدو أنه انتقل بين أكثر من طالب";
  } else if (pastedFast >= 2 || devices.size >= 3) {
    level = "نسخ/لصق مشبوه";
    label = "إدخال سريع أو أجهزة متعددة يحتاج متابعة";
  } else if (total <= 2 && devices.size <= 1) {
    score = Math.min(score, 25);
  }
  return {
    level,
    label,
    score,
    totalAttempts: total,
    distinctDevices: devices.size,
    distinctStudents: students.size,
  };
}

function calculateSessionConfidence(
  req: express.Request,
  student?: Student,
  codeRecord?: any,
  telemetry?: any,
) {
  const token = getRequestDeviceToken(req);
  const fingerprint = getRequestDeviceFingerprint(req);
  let score = 82;
  const reasons: string[] = [];
  if (!token) {
    score -= 35;
    reasons.push("لا يوجد توكن جهاز");
  }
  if (
    codeRecord?.activationDeviceToken &&
    token &&
    codeRecord.activationDeviceToken === token
  ) {
    score += 12;
    reasons.push("توكن الجهاز مطابق");
  }
  if (
    codeRecord?.activationDeviceToken &&
    token &&
    codeRecord.activationDeviceToken !== token
  ) {
    score -= 32;
    reasons.push("توكن جهاز مختلف");
  }
  if (
    codeRecord?.activationDeviceFingerprint &&
    fingerprint &&
    codeRecord.activationDeviceFingerprint === fingerprint
  ) {
    score += 8;
    reasons.push("بصمة الجهاز مطابقة");
  }
  if (
    codeRecord?.activationDeviceFingerprint &&
    fingerprint &&
    codeRecord.activationDeviceFingerprint !== fingerprint
  ) {
    score -= 16;
    reasons.push("بصمة جهاز مختلفة");
  }
  if (telemetry?.looksAutomated) {
    score -= 20;
    reasons.push("نمط إدخال آلي");
  }
  if (telemetry?.pasted && Number(telemetry?.durationMs || 0) < 1500) {
    score -= 8;
    reasons.push("لصق سريع للكود");
  }
  score = Math.max(0, Math.min(100, score));
  const level =
    score >= 80
      ? "ثقة عالية"
      : score >= 55
        ? "ثقة متوسطة"
        : score >= 35
          ? "ثقة منخفضة"
          : "خطر";
  return { score, level, reasons };
}

function buildCodeCaseFile(code: any, attempts: any[]) {
  const normalized = normalizeJoinCode(
    code?.code || attempts[0]?.normalizedCode || attempts[0]?.code || "",
  );
  const relatedAttempts = attempts.filter(
    (a: any) =>
      compactJoinCode(a.normalizedCode || a.code || "") ===
      compactJoinCode(normalized),
  );
  const involvedStudents = Array.from(
    new Map(
      relatedAttempts.map((a: any) => [
        normalizeStudentId(a.studentId) || a.studentName || a.id,
        {
          id: normalizeStudentId(a.studentId),
          name: a.studentName || "غير معروف",
          sectionCode:
            a.sectionCode || code?.studentSection || code?.sectionCode || "",
        },
      ]),
    ).values(),
  ).filter((x: any) => x.id || x.name !== "غير معروف");
  const devices = new Set(
    relatedAttempts
      .map((a: any) => a.deviceToken || a.deviceFingerprint)
      .filter(Boolean),
  );
  const last = relatedAttempts
    .slice()
    .sort(
      (a: any, b: any) =>
        new Date(b.timestamp || 0).getTime() -
        new Date(a.timestamp || 0).getTime(),
    )[0];
  const fairness = classifyStudentFairness(relatedAttempts, code);
  return {
    id: `case-${compactJoinCode(normalized) || crypto.createHash("sha1").update(String(normalized)).digest("hex").slice(0, 10)}`,
    code: normalized,
    batchId: resolveJoinCodeBatchId(code),
    ownerStudentId:
      code?.studentId || code?.usedByStudentId || code?.assignedStudentId || "",
    ownerStudentName: code?.studentName || code?.assignedStudentName || "",
    sectionCode:
      code?.studentSection || code?.sectionCode || last?.sectionCode || "",
    reputation: code?.codeReputation || last?.codeReputation || "watch",
    reputationLabel:
      code?.codeReputationLabel || last?.codeReputationLabel || "مراقبة",
    reputationScore: Number(
      code?.codeReputationScore ||
        last?.codeReputationScore ||
        fairness.score ||
        0,
    ),
    reason: code?.lastFailedAttemptReason || last?.reason || fairness.label,
    attempts: relatedAttempts.length,
    devices: devices.size,
    involvedStudents,
    lastAt: last?.timestamp || code?.lastFailedAttemptAt || "",
    fairness,
    silentEnforcement: true,
    secondStepRecommended:
      Number(code?.codeReputationScore || fairness.score || 0) >= 85 &&
      !code?.activationReviewRequired,
  };
}

function buildBatchIntelligence(codes: any[], attempts: any[]) {
  const batches = new Map<string, any>();
  for (const code of codes) {
    const batchId = resolveJoinCodeBatchId(code);
    const item = batches.get(batchId) || {
      batchId,
      totalCodes: 0,
      usedCodes: 0,
      activeCodes: 0,
      suspiciousCodes: 0,
      dangerCodes: 0,
      frozenCodes: 0,
      attempts: 0,
      honeyAttempts: 0,
      distinctDevices: new Set(),
      distinctStudents: new Set(),
      sections: new Set(),
      score: 0,
    };
    item.totalCodes += 1;
    if (String(code.status || "") === "used") item.usedCodes += 1;
    if (String(code.status || "") === "active") item.activeCodes += 1;
    if (
      Number(code.codeReputationScore || 0) >= 40 ||
      code.activationReviewRequired
    )
      item.suspiciousCodes += 1;
    if (String(code.codeReputation || "") === "danger") item.dangerCodes += 1;
    if (
      String(code.codeReputation || "") === "temporarily_blocked" ||
      isJoinCodeTemporarilyFrozen(code)
    )
      item.frozenCodes += 1;
    const section = String(
      code.studentSection || code.sectionCode || "",
    ).trim();
    if (section) item.sections.add(section);
    batches.set(batchId, item);
  }
  for (const attempt of attempts) {
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || "",
    );
    const code = codes.find(
      (c: any) => compactJoinCode(c.code) === compactJoinCode(normalized),
    );
    const batchId = resolveAttemptBatchId(attempt, code);
    const item = batches.get(batchId) || {
      batchId,
      totalCodes: 0,
      usedCodes: 0,
      activeCodes: 0,
      suspiciousCodes: 0,
      dangerCodes: 0,
      frozenCodes: 0,
      attempts: 0,
      honeyAttempts: 0,
      distinctDevices: new Set(),
      distinctStudents: new Set(),
      sections: new Set(),
      score: 0,
    };
    item.attempts += 1;
    if (attempt.honeyCode) item.honeyAttempts += 1;
    const device = attempt.deviceToken || attempt.deviceFingerprint;
    if (device) item.distinctDevices.add(device);
    const student = normalizeStudentId(attempt.studentId);
    if (student) item.distinctStudents.add(student);
    if (attempt.sectionCode) item.sections.add(attempt.sectionCode);
    batches.set(batchId, item);
  }
  return Array.from(batches.values())
    .map((b: any) => {
      const abnormalRate = b.totalCodes
        ? Math.round((b.suspiciousCodes / b.totalCodes) * 100)
        : b.attempts
          ? 100
          : 0;
      const score = Math.min(
        99,
        abnormalRate +
          Math.min(35, b.attempts * 3) +
          Math.min(25, b.distinctDevices.size * 5) +
          Math.min(20, b.honeyAttempts * 10) +
          b.dangerCodes * 12 +
          b.frozenCodes * 10,
      );
      const level =
        score >= 75 ? "عالية الخطورة" : score >= 45 ? "تحتاج مراقبة" : "آمنة";
      return {
        batchId: b.batchId,
        level,
        score,
        abnormalRate,
        totalCodes: b.totalCodes,
        usedCodes: b.usedCodes,
        activeCodes: b.activeCodes,
        suspiciousCodes: b.suspiciousCodes,
        dangerCodes: b.dangerCodes,
        frozenCodes: b.frozenCodes,
        attempts: b.attempts,
        honeyAttempts: b.honeyAttempts,
        distinctDevices: b.distinctDevices.size,
        distinctStudents: b.distinctStudents.size,
        sections: Array.from(b.sections).slice(0, 8),
      };
    })
    .sort((a: any, b: any) => b.score - a.score);
}

function buildCollectiveTransferAlerts(codes: any[], attempts: any[]) {
  const groups = new Map<string, any>();
  for (const attempt of attempts) {
    const reason = String(attempt.reason || "");
    if (
      !(
        reason.includes("مستخدم") ||
        reason.includes("مرتبط") ||
        reason.includes("جهاز") ||
        reason.includes("توكن")
      )
    )
      continue;
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || "",
    );
    const code = codes.find(
      (c: any) => compactJoinCode(c.code) === compactJoinCode(normalized),
    );
    const section = String(
      attempt.sectionCode ||
        code?.studentSection ||
        code?.sectionCode ||
        "غير محددة",
    );
    const item = groups.get(section) || {
      sectionCode: section,
      attempts: 0,
      codes: new Set(),
      students: new Set(),
      devices: new Set(),
      examples: [],
    };
    item.attempts += 1;
    if (normalized) item.codes.add(normalized);
    if (attempt.studentId)
      item.students.add(normalizeStudentId(attempt.studentId));
    if (attempt.deviceToken || attempt.deviceFingerprint)
      item.devices.add(attempt.deviceToken || attempt.deviceFingerprint);
    if (item.examples.length < 4)
      item.examples.push({
        code: normalized,
        studentId: attempt.studentId || "",
        studentName: attempt.studentName || "",
        reason,
        at: attempt.timestamp || "",
      });
    groups.set(section, item);
  }
  return Array.from(groups.values())
    .map((g: any) => ({
      sectionCode: g.sectionCode,
      attempts: g.attempts,
      distinctCodes: g.codes.size,
      distinctStudents: g.students.size,
      distinctDevices: g.devices.size,
      examples: g.examples,
      score: Math.min(
        99,
        g.attempts * 10 + g.codes.size * 15 + g.students.size * 12,
      ),
    }))
    .filter(
      (g: any) =>
        g.distinctCodes >= 2 || g.distinctStudents >= 2 || g.attempts >= 4,
    )
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 10);
}

function codeConfidenceStamp(score: number, level?: string) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "danger" || score >= 90)
    return { label: "خطر", tone: "rose", score };
  if (normalized === "suspicious" || score >= 70)
    return { label: "متداول محتمل", tone: "orange", score };
  if (normalized === "watch" || score >= 40)
    return { label: "يحتاج متابعة", tone: "amber", score };
  if (score >= 20) return { label: "طبيعي", tone: "emerald", score };
  return { label: "موثوق", tone: "emerald", score };
}

function recommendCodeAction(input: {
  score?: number;
  reason?: string;
  fairnessLevel?: string;
  sessionLevel?: string;
  batchLevel?: string;
  activationReviewRequired?: boolean;
}) {
  const score = Number(input.score || 0);
  const text = [
    input.reason,
    input.fairnessLevel,
    input.sessionLevel,
    input.batchLevel,
  ].join(" ");
  if (input.activationReviewRequired || score >= 92)
    return {
      action: "جمّد الكود للمراجعة",
      priority: "عالية",
      rationale:
        "درجة الاشتباه مرتفعة وتحتاج قرارًا إداريًا قبل استمرار التفعيل.",
    };
  if (text.includes("دفعة") || input.batchLevel === "عالية الخطورة")
    return {
      action: "راجع الدفعة",
      priority: "عالية",
      rationale: "النمط مرتبط بمصدر الأكواد وليس بكود واحد فقط.",
    };
  if (
    text.includes("تداول") ||
    text.includes("مستخدم") ||
    text.includes("مرتبط") ||
    score >= 78
  )
    return {
      action: "اطلب مراجعة الطالب",
      priority: "متوسطة",
      rationale: "توجد مؤشرات انتقال كود أو استخدامه من أكثر من جهة.",
    };
  if (text.includes("جهاز") || text.includes("توكن"))
    return {
      action: "أعد تفعيل الجهاز عند الحاجة",
      priority: "متوسطة",
      rationale: "المشكلة مرتبطة بالجهاز، ولا يلزم إيقاف الكود مباشرة.",
    };
  if (
    text.includes("مصيدة") ||
    text.includes("غير موجود") ||
    text.includes("صيغة") ||
    score >= 45
  )
    return {
      action: "راقب فقط",
      priority: "منخفضة",
      rationale: "السلوك يستحق المتابعة دون إجراء مباشر على الطالب.",
    };
  return {
    action: "لا تفعل شيئًا",
    priority: "هادئة",
    rationale: "لا توجد مؤشرات كافية لاتخاذ إجراء.",
  };
}

function buildSeasonalCodeMemory(codes: any[], attempts: any[]) {
  const buckets = new Map<string, any>();
  const sorted = attempts
    .slice()
    .sort(
      (a: any, b: any) =>
        new Date(a.timestamp || 0).getTime() -
        new Date(b.timestamp || 0).getTime(),
    );
  for (const attempt of sorted) {
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || "",
    );
    const code = codes.find(
      (c: any) => compactJoinCode(c.code) === compactJoinCode(normalized),
    );
    const rawTerm =
      String(
        code?.semester ||
          code?.academicTerm ||
          attempt.semester ||
          attempt.academicTerm ||
          "فصل غير محدد",
      ).trim() || "فصل غير محدد";
    const date = new Date(attempt.timestamp || Date.now());
    const weekKey = Number.isFinite(date.getTime())
      ? `${date.getUTCFullYear()}-W${Math.ceil(((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000 + new Date(Date.UTC(date.getUTCFullYear(), 0, 1)).getUTCDay() + 1) / 7)}`
      : "غير محدد";
    const item = buckets.get(rawTerm) || {
      term: rawTerm,
      attempts: 0,
      honey: 0,
      trading: 0,
      device: 0,
      automated: 0,
      weeks: new Map(),
      sections: new Map(),
      latestAt: "",
    };
    item.attempts += 1;
    if (attempt.honeyCode || String(attempt.reason || "").includes("مصيدة"))
      item.honey += 1;
    if (
      String(attempt.reason || "").includes("مستخدم") ||
      String(attempt.reason || "").includes("مرتبط")
    )
      item.trading += 1;
    if (
      String(attempt.reason || "").includes("جهاز") ||
      String(attempt.reason || "").includes("توكن")
    )
      item.device += 1;
    if (attempt.activationTelemetry?.looksAutomated) item.automated += 1;
    const wk = item.weeks.get(weekKey) || {
      week: weekKey,
      attempts: 0,
      trading: 0,
      honey: 0,
    };
    wk.attempts += 1;
    wk.trading += String(attempt.reason || "").includes("مستخدم") ? 1 : 0;
    wk.honey += attempt.honeyCode ? 1 : 0;
    item.weeks.set(weekKey, wk);
    const section = String(
      attempt.sectionCode ||
        code?.studentSection ||
        code?.sectionCode ||
        "غير محددة",
    );
    item.sections.set(section, (item.sections.get(section) || 0) + 1);
    item.latestAt = attempt.timestamp || item.latestAt;
    buckets.set(rawTerm, item);
  }
  return Array.from(buckets.values())
    .map((b: any) => {
      const weeks = Array.from(b.weeks.values())
        .sort((a: any, b: any) => b.attempts - a.attempts)
        .slice(0, 4);
      const sections = Array.from(b.sections.entries())
        .map(([sectionCode, count]: any) => ({ sectionCode, count }))
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 5);
      const score = Math.min(
        99,
        b.attempts * 3 +
          b.trading * 12 +
          b.honey * 10 +
          b.automated * 14 +
          b.device * 5,
      );
      const expectedTrend =
        score >= 75
          ? "ارتفاع متوقع يحتاج متابعة"
          : score >= 45
            ? "نشاط قابل للزيادة"
            : "نشاط طبيعي";
      const nextRecommendation =
        score >= 75
          ? "راقب أول أسبوع وأيام ما قبل الاختبار، وراجع الدفعات ذات النشاط الأعلى."
          : score >= 45
            ? "اكتفِ بالمراقبة الهادئة مع فحص الشعب الأعلى نشاطًا."
            : "لا يلزم إجراء خاص.";
      return {
        term: b.term,
        score,
        expectedTrend,
        nextRecommendation,
        attempts: b.attempts,
        trading: b.trading,
        honey: b.honey,
        device: b.device,
        automated: b.automated,
        peakWeeks: weeks,
        topSections: sections,
        latestAt: b.latestAt,
      };
    })
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 8);
}

function buildOutOfContextCodeAlerts(codes: any[], attempts: any[]) {
  const alerts: any[] = [];
  for (const attempt of attempts) {
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || "",
    );
    const code = codes.find(
      (c: any) => compactJoinCode(c.code) === compactJoinCode(normalized),
    );
    if (!code) continue;
    const expectedSection = String(
      code.studentSection || code.sectionCode || "",
    ).trim();
    const actualSection = String(attempt.sectionCode || "").trim();
    const reasons: string[] = [];
    if (expectedSection && actualSection && expectedSection !== actualSection)
      reasons.push("الشعبة لا تطابق شعبة الكود");
    const window = joinCodeWindowStatus(code);
    if (!window.ok) reasons.push("محاولة خارج نافذة التفعيل");
    const batchId = resolveJoinCodeBatchId(code);
    if (reasons.length)
      alerts.push({
        code: code.code,
        batchId,
        expectedSection,
        actualSection,
        reasons,
        at: attempt.timestamp || "",
        studentId: attempt.studentId || "",
        studentName: attempt.studentName || "",
        score:
          reasons.length * 35 +
          (String(attempt.reason || "").includes("مستخدم") ? 20 : 0),
      });
  }
  return alerts.sort((a: any, b: any) => b.score - a.score).slice(0, 12);
}

function inferLeakSources(
  codes: any[],
  attempts: any[],
  batchIntelligence: any[],
  collectiveTransferAlerts: any[],
  outOfContextAlerts: any[],
) {
  const signals: any[] = [];
  const highBatch = batchIntelligence.filter((b: any) => b.score >= 65);
  for (const b of highBatch.slice(0, 6))
    signals.push({
      source: "دفعة أكواد تحتاج مراجعة",
      confidence: Math.min(99, b.score),
      evidence: `دفعة ${b.batchId}: نشاط غير طبيعي ${b.abnormalRate}%، أجهزة ${b.distinctDevices}، ومحاولات ${b.attempts}.`,
      recommendation: "راجع مصدر توزيع الدفعة وطريقة تسليمها.",
    });
  for (const c of collectiveTransferAlerts.slice(0, 6))
    signals.push({
      source: "تداول داخل شعبة",
      confidence: Math.min(99, c.score),
      evidence: `الشعبة ${c.sectionCode}: ${c.distinctCodes} أكواد و${c.distinctStudents} طلبة ضمن نمط واحد.`,
      recommendation: "راجع الشعبة بهدوء دون اتهام مباشر.",
    });
  const honeyCount = attempts.filter(
    (a: any) => a.honeyCode || String(a.reason || "").includes("مصيدة"),
  ).length;
  const automatedCount = attempts.filter(
    (a: any) => a.activationTelemetry?.looksAutomated,
  ).length;
  if (honeyCount >= 3 || automatedCount >= 3)
    signals.push({
      source: "تخمين آلي أو محاولات عشوائية",
      confidence: Math.min(99, 50 + honeyCount * 8 + automatedCount * 10),
      evidence: `${honeyCount} محاولات على أكواد غير مصدرة و${automatedCount} أنماط إدخال آلية.`,
      recommendation: "اكتفِ بالمراقبة والخنق التلقائي للمحاولات.",
    });
  if (outOfContextAlerts.length >= 2)
    signals.push({
      source: "استخدام خارج السياق",
      confidence: Math.min(99, 45 + outOfContextAlerts.length * 8),
      evidence: `${outOfContextAlerts.length} محاولة ظهرت في شعبة أو وقت غير متوقع.`,
      recommendation: "راجع توافق الدفعة مع الشعبة ووقت التوزيع.",
    });
  return signals
    .sort((a: any, b: any) => b.confidence - a.confidence)
    .slice(0, 10);
}

function buildTeacherCodeReports(input: {
  tradingAlerts: any[];
  batchIntelligence: any[];
  collectiveTransferAlerts: any[];
  caseFiles: any[];
  leakSources: any[];
  outOfContextAlerts: any[];
}) {
  const reports: any[] = [];
  const topBatch = input.batchIntelligence.find((b: any) => b.score >= 45);
  if (topBatch)
    reports.push({
      title: `دفعة ${topBatch.batchId} تحتاج متابعة`,
      body: `نشاط غير طبيعي ${topBatch.abnormalRate}% مع ${topBatch.attempts} محاولة و${topBatch.distinctDevices} أجهزة.`,
      suggestedAction:
        topBatch.score >= 75
          ? "راجع الدفعة قبل توزيع أكواد إضافية."
          : "راقب الدفعة فقط ولا توقفها الآن.",
      priority: topBatch.score >= 75 ? "عالية" : "متوسطة",
    });
  const topCollective = input.collectiveTransferAlerts[0];
  if (topCollective)
    reports.push({
      title: `اشتباه تداول داخل شعبة ${topCollective.sectionCode}`,
      body: `${topCollective.distinctCodes} أكواد و${topCollective.distinctStudents} طلبة ظهروا في نمط واحد.`,
      suggestedAction:
        "مراجعة الطلاب بهدوء، ولا حاجة لإيقاف كامل الدفعة مباشرة.",
      priority: "متوسطة",
    });
  const topLeak = input.leakSources[0];
  if (topLeak)
    reports.push({
      title: `تفسير محتمل: ${topLeak.source}`,
      body: topLeak.evidence,
      suggestedAction: topLeak.recommendation,
      priority: topLeak.confidence >= 75 ? "عالية" : "متوسطة",
    });
  const topContext = input.outOfContextAlerts[0];
  if (topContext)
    reports.push({
      title: "كود ظهر خارج سياقه",
      body: `${topContext.code} ظهر في ${topContext.actualSection || "شعبة غير محددة"} بينما المتوقع ${topContext.expectedSection || "غير محدد"}.`,
      suggestedAction: "راجع ارتباط الكود بالشعبة قبل اتخاذ إجراء على الطالب.",
      priority: "منخفضة",
    });
  // لا نُنشئ تقريراً افتراضياً عند الهدوء؛ الواجهة لديها حالة فارغة واضحة.
  // التقرير الوهمي "الوضع مستقر" كان يُحسب كإجراء مطلوب بعد التهيئة الشاملة،
  // فيظهر رقم 1 في مركز المتابعة رغم أن كل المؤشرات الحية صفر.
  return reports.slice(0, 6);
}

function markJoinCodeActivated(
  code: JoinCode,
  req: express.Request,
  student: Student,
  extra: Record<string, any> = {},
) {
  const existing = code as any;
  return {
    codeReputation: "normal",
    codeReputationLabel: CODE_REPUTATION_LABELS.normal,
    codeReputationScore: Math.max(
      0,
      Math.min(25, Number(existing.codeReputationScore || 0)),
    ),
    codeReputationUpdatedAt: new Date().toISOString(),
    strictLibraryMode: existing.strictLibraryMode !== false,
    activationReviewRequired: false,
    activationFrozenUntil: "",
    codeJourney: appendCodeJourney(
      code,
      codeJourneyEvent("تم التفعيل", req, {
        studentId: student.id,
        studentName: student.name,
        sectionCode: extra.sectionCode || student.sectionCode,
        telemetry: getActivationTelemetry(req),
      }),
    ),
  } as any;
}

function sendActivationRateLimitIfNeeded(
  req: express.Request,
  res: express.Response,
  params: { code?: string; student?: Student; foundCode?: JoinCode },
) {
  const limit = getActivationRateLimit(req, params);
  if (!limit.limited) return false;
  recordActivationAttempt(req, {
    code: params.code || "",
    student: params.student,
    foundCode: params.foundCode,
    reason: "إيقاف مؤقت بسبب تكرار محاولات تفعيل الكود",
  });
  res.setHeader("Retry-After", String(limit.retryAfterSeconds));
  res
    .status(429)
    .json({
      error:
        "تم إيقاف محاولات التفعيل مؤقتًا لحماية الكود. حاول لاحقًا أو راجع أستاذ المقرر.",
    });
  return true;
}

function recordActivationAttempt(
  req: express.Request,
  params: {
    code: string;
    student?: Student;
    reason: string;
    status?: "blocked" | "warning";
    foundCode?: JoinCode;
  },
) {
  // كبح التكرار الجذري: حين يتكرر نفس الانتهاك بالضبط (نفس الطالب + نفس السبب +
  // نفس الكود + نفس الجهاز) خلال نافذة قصيرة، نكتفي بأول تسجيل وتنبيه ولا نكرّر.
  // هذا يعالج إغراق المعلم بمئات الإشعارات حين يُعاد فحص جلسة شرعية عبر نداءات
  // دورية لا تحمل سرّ المتصفح (بعد تبديل/فك الجهاز)، ويمنع أيضاً تضخيم عدّاد
  // التسريب على كود الطالب الذي قد يجمّده ظلماً. أول تنبيه يبقى فعّالاً، وأي
  // انتهاك مختلف (سبب/كود/جهاز آخر) يُنبّه فوراً.
  const dedupToken = getRequestDeviceToken(req);
  const dedupFingerprint = getRequestDeviceFingerprint(req);
  // نافذة واسعة تكفي لتغطية جلسة دخول كاملة فلا يصل المعلم سوى تنبيه واحد عن
  // نفس الواقعة بالضبط؛ آمنة لأن المفتاح دقيق (طالب+سبب+كود+جهاز)، فأي محاولة
  // مختلفة (جهاز/كود/سبب آخر) تُنبّه فوراً دون تأثّر بهذه النافذة.
  const dedupWindowMs = 6 * 60 * 60 * 1000;
  const dedupNow = Date.now();
  // نحسب الضربة الأمنية حتى لو كان نفس التنبيه مكرراً؛ الكبح هنا يمنع إزعاج
  // الأستاذ فقط، ولا يسمح لنفس الجهاز بتكرار نفس الكود آلاف المرات بلا حد.
  rememberActivationRateStrike(req, {
    code: params.code,
    student: params.student,
  });
  const hasRecentIdenticalAttempt = dbInstance
    .getActivationAttempts()
    .some((attempt: any) => {
      if (String(attempt.reason || "") !== String(params.reason || "")) return false;
      if (String(attempt.studentId || "") !== String(params.student?.id || ""))
        return false;
      if (
        compactJoinCode(attempt.normalizedCode || attempt.code || "") !==
        compactJoinCode(params.code)
      )
        return false;
      const sameDevice =
        (!!dedupToken && String(attempt.deviceToken || "") === dedupToken) ||
        (!!dedupFingerprint &&
          String(attempt.deviceFingerprint || "") === dedupFingerprint) ||
        (!dedupToken && !dedupFingerprint);
      if (!sameDevice) return false;
      const attemptMs = new Date(attempt.timestamp || 0).getTime();
      return Number.isFinite(attemptMs) && dedupNow - attemptMs < dedupWindowMs;
    });
  if (hasRecentIdenticalAttempt) return;

  const timestamp = new Date().toISOString();
  const deviceFingerprint = getRequestDeviceFingerprint(req);
  const deviceToken = getRequestDeviceToken(req);
  const telemetry = getActivationTelemetry(req);
  const attemptSectionCode = String(
    req.body?.courseCode ||
      req.body?.sectionCode ||
      params.student?.sectionCode ||
      (params.student as any)?.studentSection ||
      (params.foundCode as any)?.studentSection ||
      (params.foundCode as any)?.sectionCode ||
      (params.foundCode as any)?.courseCode ||
      "",
  ).trim();
  const reputation = updateJoinCodeReputation(req, { ...params, telemetry });
  const honeyCode = isUnifiedJoinCode(params.code) && !params.foundCode;
  const currentAttemptsForCode = dbInstance
    .getActivationAttempts()
    .filter(
      (attempt: any) =>
        compactJoinCode(attempt.normalizedCode || attempt.code || "") ===
        compactJoinCode(params.code),
    );
  const fairness = classifyStudentFairness(
    currentAttemptsForCode,
    params.foundCode,
  );
  const sessionConfidence = calculateSessionConfidence(
    req,
    params.student,
    params.foundCode,
    telemetry,
  );
  const batchId = params.foundCode
    ? resolveJoinCodeBatchId(params.foundCode)
    : "مصائد الأكواد";
  const secondStepRecommended = Boolean(
    (reputation?.score || fairness.score) >= 85 &&
    !(params.foundCode as any)?.activationReviewRequired,
  );
  dbInstance.addActivationAttempt({
    id: `act-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    code: String(params.code || ""),
    normalizedCode: normalizeJoinCode(params.code),
    studentId: params.student?.id,
    studentName: params.student?.name,
    sectionCode: attemptSectionCode,
    courseCode: attemptSectionCode,
    targetSectionCode: attemptSectionCode,
    status: params.status || "blocked",
    reason: honeyCode
      ? "مصيدة كود غير مُصدر أو محاولة تخمين كود"
      : params.reason,
    deviceFingerprint,
    deviceToken,
    ip: req.ip || "127.0.0.1",
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    timestamp,
    activationTelemetry: telemetry,
    codeReputation: reputation?.level || (honeyCode ? "suspicious" : "watch"),
    codeReputationLabel: reputation?.label || (honeyCode ? "مشتبه" : "مراقبة"),
    codeReputationScore: reputation?.score || (honeyCode ? 72 : 40),
    honeyCode,
    batchId,
    fairnessLevel: fairness.level,
    fairnessLabel: fairness.label,
    fairnessScore: fairness.score,
    sessionConfidenceScore: sessionConfidence.score,
    sessionConfidenceLevel: sessionConfidence.level,
    sessionConfidenceReasons: sessionConfidence.reasons,
    silentEnforcement: true,
    secondStepRecommended,
    confidenceStamp: codeConfidenceStamp(
      reputation?.score || (honeyCode ? 72 : 40),
      reputation?.level || (honeyCode ? "suspicious" : "watch"),
    ),
    recommendedAction: recommendCodeAction({
      score: reputation?.score || fairness.score,
      reason: params.reason,
      fairnessLevel: fairness.level,
      sessionLevel: sessionConfidence.level,
    }),
  } as any);
  if (params.foundCode) {
    dbInstance.updateJoinCode(params.foundCode.code, {
      leakAttemptCount:
        Number((params.foundCode as any).leakAttemptCount || 0) + 1,
      lastFailedAttemptAt: timestamp,
      lastFailedAttemptStudentId: params.student?.id,
      lastFailedAttemptReason: params.reason,
      batchId,
      lastFairnessLevel: fairness.level,
      lastFairnessLabel: fairness.label,
      lastFairnessScore: fairness.score,
      lastSessionConfidenceScore: sessionConfidence.score,
      secondStepRecommended,
    } as any);
  }
  dbInstance.addActivityLog({
    studentId: params.student?.id,
    studentName: params.student?.name || "محاولة غير معروفة",
    action: honeyCode ? "مصيدة كود" : "محاولة كود مرفوضة",
    details: `${honeyCode ? "مصيدة كود غير مُصدر" : params.reason} — الرمز: ${normalizeJoinCode(params.code) || "-"}`,
    teacherEmail: attemptSectionCode ? sectionOwnerEmail(attemptSectionCode) : undefined,
    actorEmail: attemptSectionCode ? sectionOwnerEmail(attemptSectionCode) : undefined,
    sectionCode: attemptSectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    os: "نزاهة الأكواد",
    browser: honeyCode ? "مصيدة الأكواد" : "نظام الحماية",
    isViolationWarning: true,
  });
  if (params.student && attemptSectionCode) {
    notifyTeachersForSection(
      attemptSectionCode,
      honeyCode ? "مصيدة كود" : "تنبيه نزاهة كود",
      `محاولة مرفوضة للطالب ${params.student.name}: ${honeyCode ? "مصيدة كود غير مُصدر" : params.reason}`,
      {
        type: "code_integrity",
        code: normalizeJoinCode(params.code),
        studentId: params.student.id,
        link: "/",
      },
    );
  }
}

const MIRAS_JOIN_CODE_PREFIX = "LAB";
const MIRAS_JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIRAS_JOIN_CODE_GROUPS = 3;
const MIRAS_JOIN_CODE_GROUP_SIZE = 4;
const MIRAS_JOIN_CODE_COMPACT_LENGTH =
  MIRAS_JOIN_CODE_PREFIX.length +
  MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE;

function makeJoinCode(
  prefix = MIRAS_JOIN_CODE_PREFIX,
  studentId = "",
  existing: Set<string> = new Set(),
): string {
  const safePrefix = String(prefix || MIRAS_JOIN_CODE_PREFIX)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5) || MIRAS_JOIN_CODE_PREFIX;
  const groupsFromBody = (body: string) => {
    const groups: string[] = [];
    for (let i = 0; i < body.length; i += MIRAS_JOIN_CODE_GROUP_SIZE) {
      groups.push(body.slice(i, i + MIRAS_JOIN_CODE_GROUP_SIZE));
    }
    return [safePrefix, ...groups].join("-");
  };
  const randomBody = () => {
    let out = "";
    for (let i = 0; i < MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE; i++) {
      out += MIRAS_JOIN_CODE_ALPHABET[crypto.randomInt(0, MIRAS_JOIN_CODE_ALPHABET.length)];
    }
    return out;
  };

  for (let i = 0; i < 400; i++) {
    const code = groupsFromBody(randomBody());
    if (!existing.has(compactJoinCode(code))) return code;
  }

  // احتياط نادر جداً: إن امتلأت المحاولات العشوائية نولد جسماً مشفراً زمنياً
  // بنفس الأبجدية الآمنة، بلا رجوع لصيغة الأرقام القديمة.
  let seed = crypto
    .createHash("sha256")
    .update(`${Date.now()}|${studentId}|${crypto.randomBytes(16).toString("hex")}`)
    .digest();
  let body = "";
  for (let i = 0; body.length < MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE; i++) {
    if (i >= seed.length) {
      seed = crypto.createHash("sha256").update(seed).digest();
      i = 0;
    }
    body += MIRAS_JOIN_CODE_ALPHABET[seed[i] % MIRAS_JOIN_CODE_ALPHABET.length];
  }
  return groupsFromBody(body);
}

function isProductionLikeRuntime(): boolean {
  return (
    String(process.env.NODE_ENV || "").toLowerCase() === "production" ||
    Boolean(process.env.K_SERVICE || process.env.FIREBASE_CONFIG || process.env.GOOGLE_CLOUD_PROJECT)
  );
}

function joinCodeSignatureRequired(): boolean {
  const raw = String(process.env.MIRAS_JOIN_CODE_SIGNATURE_REQUIRED || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return raw === "1" || raw === "true" || raw === "yes" || isProductionLikeRuntime();
}

function joinCodeSigningSecret(): string {
  const explicit = String(
    process.env.MIRAS_JOIN_CODE_SIGNING_SECRET ||
      process.env.JOIN_CODE_SIGNING_SECRET ||
      "",
  ).trim();
  if (explicit) return explicit;
  const sessionSecret = String(process.env.MIRAS_SESSION_SECRET || MIRAS_SESSION_SECRET || "").trim();
  return crypto
    .createHash("sha256")
    .update(`miras-join-code-signing-v1:${sessionSecret}`)
    .digest("hex");
}

function joinCodeSignaturePayload(code: any) {
  return [
    compactJoinCode(code?.code || code),
    String(code?.ownerEmail || code?.createdByEmail || "").trim().toLowerCase(),
    String(code?.sectionCode || code?.courseCode || code?.studentSection || "").trim().toLowerCase(),
    String(code?.createdAt || "").trim(),
  ].join("|");
}

function signJoinCodeRecord(code: any): string {
  const secret = joinCodeSigningSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(joinCodeSignaturePayload(code)).digest("hex");
}

function attachJoinCodeSignature<T extends Record<string, any>>(code: T): T {
  const signature = signJoinCodeRecord(code);
  if (!signature) return code;
  return {
    ...code,
    codeSignature: signature,
    codeSignatureVersion: "hmac-sha256-v1",
    codeSignatureCreatedAt: code.createdAt || new Date().toISOString(),
  } as T;
}

function verifyJoinCodeSignature(code: any) {
  const signature = String(code?.codeSignature || "").trim();
  const expected = signJoinCodeRecord(code);
  const required = joinCodeSignatureRequired();
  if (!signature) {
    return expected
      ? { ok: !required, legacy: true, canSign: true }
      : { ok: !required, legacy: true, skipped: true, missingSecret: true };
  }
  if (!expected) {
    return { ok: !required, legacy: true, skipped: true, missingSecret: true };
  }
  const ok =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  return { ok, legacy: false, required };
}

function ensureJoinCodeSignature(code: any) {
  const state = verifyJoinCodeSignature(code);
  if (state.ok && !state.legacy) return state;
  if (!state.legacy) return state; // توقيع موجود لكنه غير صحيح: لا نعيد توقيعه.
  const signature = signJoinCodeRecord(code);
  if (!signature) return state;

  // ترقية هادئة للأكواد الحيّة القديمة: لا نكسر أكواد الطلاب الموجودة، بل نوقّعها
  // أول مرة تمر على الخادم ثم تصبح خاضعة للتحقق الإجباري مثل الأكواد الجديدة.
  const patch = {
    codeSignature: signature,
    codeSignatureVersion: "hmac-sha256-v1",
    codeSignatureCreatedAt:
      code?.codeSignatureCreatedAt || code?.createdAt || new Date().toISOString(),
  };
  try {
    if (code?.code) dbInstance.updateJoinCode(code.code, patch as any);
    Object.assign(code, patch);
  } catch {}
  return { ok: true, legacy: true, migrated: true };
}

function createCodeJourneyEvent(label: string, actorEmail: string, extra: Record<string, any> = {}) {
  return appendCodeJourney({} as any, {
    id: `cj-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
    label,
    at: new Date().toISOString(),
    actorEmail,
    ...extra,
  });
}

function isValidEmailFormat(value: any): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
}

function isValidPaaetEmail(value: any): boolean {
  return String(value || "")
    .trim()
    .toLowerCase()
    .endsWith("@paaet.edu.kw");
}

// ---------------- FREE LOCAL PDF ANALYSIS HELPERS ----------------
// These helpers avoid paid AI APIs. They try to extract text from uploaded PDFs locally using pdftotext
// when available, then derive a course map from headings or text chunks. If the PDF is scanned
// and contains no embedded text, the system keeps existing data unchanged and reports a clear warning.
function extractPdfTextLocal(filePath: string): {
  text: string;
  method: string;
  warning?: string;
} {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const out = execFileSync("pdftotext", ["-layout", filePath, "-"], {
        encoding: "utf8",
        timeout: 20000,
        maxBuffer: 20 * 1024 * 1024,
      });
      const cleaned = out
        .replace(/\u0000/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (cleaned.length > 80) {
        return { text: cleaned, method: "pdftotext-local" };
      }
    }
  } catch (err) {
    console.log(
      "pdftotext local extraction unavailable or failed; trying raw PDF extraction.",
    );
  }
  try {
    const raw = fs.readFileSync(filePath);
    const ascii = raw.toString("latin1");
    const pieces = Array.from(ascii.matchAll(/\(([^()]{3,})\)/g)).map(
      (m) => m[1],
    );
    const cleaned = pieces
      .join(" ")
      .replace(/\\[rn]/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (cleaned.length > 80) {
      return { text: cleaned, method: "raw-pdf-string-scan" };
    }
  } catch (err) {
    console.log("Raw PDF text scan failed.");
  }
  return {
    text: "",
    method: "none",
    warning:
      "لم يتم العثور على نص قابل للاستخراج داخل ملف PDF. غالبًا الملف مصوّر/ممسوح ضوئيًا، والتحليل المحلي المجاني لا يستخدم OCR. يمكنك رفع نسخة نصية قابلة للنسخ للحصول على تقسيم أدق.",
  };
}

function normalizeTitle(line: string, fallback: string): string {
  const t = (line || "")
    .replace(/[\u0000\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return fallback;
  return t.length > 80 ? t.slice(0, 80) + "…" : t;
}

function topConceptsFromText(text: string, count = 4): string[] {
  const stop = new Set([
    "الذي",
    "التي",
    "على",
    "الى",
    "إلى",
    "في",
    "من",
    "عن",
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "كان",
    "كانت",
    "مع",
    "كما",
    "وقد",
    "لذلك",
    "حيث",
    "بين",
    "بعد",
    "قبل",
    "عند",
    "كل",
    "أي",
    "أو",
    "أن",
    "إن",
    "هو",
    "هي",
    "ثم",
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
  ]);
  const words = (text.match(/[\p{L}]{4,}/gu) || [])
    .map((w) => w.trim())
    .filter((w) => !stop.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([w]) => w);
}

function buildLocalChaptersFromText(
  text: string,
  meta: any,
): {
  chapters: TextbookChapter[];
  warning?: string;
  extractedChars: number;
  method: string;
} {
  const clean = (text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const headingRegex =
    /^(الفصل|الباب|الوحدة|المحور|Chapter|Unit|Module)\s*[\w\d\u0660-\u0669\u06F0-\u06F9:：\-.، ]{0,80}/i;
  const headingIndexes = lines
    .map((l, i) => ({ l, i }))
    .filter((x) => headingRegex.test(x.l))
    .slice(0, 8);
  let chapters: TextbookChapter[] = [];
  if (headingIndexes.length >= 2) {
    chapters = headingIndexes.slice(0, 6).map((h, idx) => {
      const next = headingIndexes[idx + 1]?.i ?? lines.length;
      const block = lines.slice(h.i, next).join(" ");
      const concepts = topConceptsFromText(block, 5);
      const topics = concepts.slice(0, 3).map((c, tIdx) => ({
        id: `topic-${idx + 1}-${tIdx + 1}`,
        title: `موضوع ${tIdx + 1}: ${c}`,
        pages: `${Math.max(1, idx * 20 + tIdx * 6 + 1)}-${Math.max(6, idx * 20 + tIdx * 6 + 6)}`,
        concepts: concepts.slice(tIdx, tIdx + 3).length
          ? concepts.slice(tIdx, tIdx + 3)
          : concepts,
      }));
      return {
        id: `chap-${idx + 1}`,
        title: normalizeTitle(h.l, `الفصل ${idx + 1}`),
        subtitle:
          "تم استخلاص هذا الفصل محليًا من بنية المصدر المرفوع دون كشف اسم الملف.",
        topics: topics.length
          ? topics
          : [
              {
                id: `topic-${idx + 1}-1`,
                title: "موضوع عام مستخرج",
                pages: "1-10",
                concepts: concepts.length ? concepts : ["مفهوم عام"],
              },
            ],
      };
    });
  } else if (clean.length > 80) {
    const chunks: string[] = [];
    const chunkSize = Math.ceil(clean.length / 4);
    for (let i = 0; i < 4; i++)
      chunks.push(clean.slice(i * chunkSize, (i + 1) * chunkSize));
    chapters = chunks.map((block, idx) => {
      const concepts = topConceptsFromText(block, 5);
      return {
        id: `chap-${idx + 1}`,
        title: `الفصل ${idx + 1}: محور مستخرج من المصدر`,
        subtitle: "تقسيم محلي مجاني مبني على نص PDF القابل للاستخراج.",
        topics: [0, 1].map((tIdx) => ({
          id: `topic-${idx + 1}-${tIdx + 1}`,
          title: `موضوع ${tIdx + 1}: ${concepts[tIdx] || "مفهوم تطبيقي"}`,
          pages: `${idx * 20 + tIdx * 10 + 1}-${idx * 20 + (tIdx + 1) * 10}`,
          concepts: concepts.slice(tIdx, tIdx + 3).length
            ? concepts.slice(tIdx, tIdx + 3)
            : ["مفهوم عام"],
        })),
      } as TextbookChapter;
    });
  }
  return {
    chapters,
    extractedChars: clean.length,
    method: meta?.extractionMethod || "local",
    warning:
      clean.length <= 80
        ? "PDF لا يحتوي نصًا قابلًا للاستخراج كفاية. لم يتم إنشاء فصول افتراضية."
        : undefined,
  };
}

// Helper to call Gemini with retries and model fallbacks (e.g. if 503 Unavailable)
async function generateContentWithRetry(params: {
  model?: string;
  contents: any;
  config?: any;
}): Promise<any> {
  const primaryModel = params.model || "gemini-3.5-flash";
  const modelsToTry = [primaryModel, "gemini-flash-latest"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(
          `🤖 [Gemini Retry Utility] Attempting model: ${model} (attempt ${attempt}/3)`,
        );
        if (!process.env.GEMINI_API_KEY || !aiInstance) {
          throw new Error(
            "Gemini API Client is not configured. (Missing GEMINI_API_KEY environment variable)",
          );
        }
        const response = await aiInstance.models.generateContent({
          model: model,
          contents: params.contents,
          config: params.config,
        });

        if (response && response.text) {
          console.log(
            `✨ [Gemini Retry Utility] Successfully completed GenAI generation using model: ${model}`,
          );
          return response;
        } else {
          throw new Error(
            "Malformed GenAI response, text property is empty or undefined.",
          );
        }
      } catch (error: any) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        console.log(
          `⚠️ [Gemini Retry Utility] Model ${model} failed on attempt ${attempt}/3 with error: ${msg}`,
        );

        // Short-circuit completely and do not retry or fallback if resources are exhausted or API key is suspended
        if (
          msg.includes("RESOURCE_EXHAUSTED") ||
          msg.includes("prepayment credits are depleted") ||
          msg.includes("429") ||
          msg.includes("PERMISSION_DENIED") ||
          msg.includes("CONSUMER_SUSPENDED") ||
          msg.includes("403")
        ) {
          console.log(
            `🚨 [Gemini Retry Utility] API Key quota is depleted or key is suspended. Stopping generation without creating fallback data.`,
          );
          throw error;
        }

        // If it's a transient error, sleep with exponential backoff before the next attempt
        if (attempt < 3) {
          const backoffTime = attempt * 1200 + Math.floor(Math.random() * 500);
          console.log(
            `💤 [Gemini Retry Utility] Sleeping for ${backoffTime}ms before retrying...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
        }
      }
    }
    console.log(
      `🔄 [Gemini Retry Utility] Persistent failures on ${model}. Trying next alternate fallback model in checklist...`,
    );
  }

  throw (
    lastError ||
    new Error(
      "Failed to generate content after retries on primary and alternate models.",
    )
  );
}

// Express Middlewares
app.use(cors());
app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024 } }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use((req, _res, next) => {
  normalizeDigitsDeep(req.body);
  normalizeDigitsDeep(req.query);
  normalizeDigitsDeep(req.params);
  next();
});

app.post("/api/convert-data-to-pdf", async (req: any, res: any) => {
  try {
    const { dataUrl, filename } = req.body;
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return res.status(400).json({ error: "Invalid data URL" });
    }
    // اشتقاق الامتداد: من اسم الملف أولاً، وإلا من نوع MIME داخل رابط data:.
    // أنواع أوفيس الحديثة (pptx/docx) لها MIME طويل يحتوي نقاطاً (مثل
    // ...presentationml.presentation)، فلا يصح اعتماد ما بعد آخر نقطة كامتداد؛
    // نعتمد خريطة صريحة حتى لا يُرفض تحويل البوربوينت/الوورد المُرسَل مضمّناً.
    const mimeInData = String(
      dataUrl.match(/^data:([^;,]+)/)?.[1] || "",
    ).toLowerCase();
    const MIRAS_MIME_TO_OFFICE_EXT: Record<string, string> = {
      "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        ".pptx",
      "application/vnd.ms-powerpoint": ".ppt",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        ".docx",
      "application/msword": ".doc",
      "application/rtf": ".rtf",
      "text/rtf": ".rtf",
    };
    let ext = path.extname(filename || "").toLowerCase();
    if (!MIRAS_OFFICE_CONVERTIBLE_EXTS.has(ext)) {
      ext = MIRAS_MIME_TO_OFFICE_EXT[mimeInData] || ext;
    }
    if (!MIRAS_OFFICE_CONVERTIBLE_EXTS.has(ext)) {
      return res.status(400).json({ error: "Unsupported format for conversion" });
    }
    // نفس صيغة الالتقاط المتساهلة المستخدمة في باقي مواضع قراءة روابط data: في
    // الخادم (تتقبّل نوع MIME الطويل ذا النقاط وأي وسائط ;name=… قبل ;base64,).
    const matches = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/);
    if (!matches || !matches[2]) {
      return res.status(400).json({ error: "Invalid base64 data URL" });
    }
    const buffer = Buffer.from(matches[2], "base64");
    if (!buffer.length) {
      return res.status(400).json({ error: "Empty file" });
    }
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "miras-office-archive-"));
    const tempPath = path.join(workDir, `source${ext}`);
    fs.writeFileSync(tempPath, buffer);
    const pdfBuffer = await convertOfficeFileToPdf(tempPath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(pdfBuffer);
    
    // Cleanup
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {}
  } catch (err: any) {
    console.error("Data to PDF conversion failed:", err);
    res.status(500).json({ error: "Conversion failed" });
  }
});

// قبل أي طلب API ننتظر أول مزامنة من Firestore حتى لا يبدأ الخادم من كاش قديم.
// وبعد أي عملية تعديل ناجحة نؤخر رد JSON قليلاً حتى تُفرّغ الدفعة وتُدفع للسحابة،
// مع بقاء flushCloudSoon بعد الرد كشبكة أمان للمسارات غير JSON. الهدف: لا يظهر
// سجل في الواجهة إلا وهو محفوظ/مجدول للدوام السحابي، فلا يختفي بعد التحديث.
app.use(async (req, res, next) => {
  try {
    if (req.url.startsWith("/api/") && !req.path.startsWith("/api/config")) {
      await dbInstance.initialSyncPromise;
    }
  } catch (e) {
    console.error("⚠️ Initial cloud database sync failed before API request:", e);
  }

  if (req.method !== "GET" && req.url.startsWith("/api/")) {
    // حارس دوام عام لكل عمليات التعديل: أي رد JSON ناجح لا يخرج للواجهة إلا بعد
    // تفريغ الدفعة المحلية وانتظار مزامنة Firestore. هذا يمنع حالة "ظهر ثم اختفى"
    // في المسارات التي لم تكن تستدعي waitForSync يدوياً، ويبقي أخطاء 4xx/5xx سريعة.
    const originalJson = res.json.bind(res);
    let cloudGuardedJson = false;
    res.json = ((body?: any) => {
      const statusCode = Number(res.statusCode || 200);
      if (cloudGuardedJson || res.headersSent || statusCode >= 400) {
        return originalJson(body);
      }
      cloudGuardedJson = true;
      Promise.resolve(dbInstance.waitForSync())
        .then(() => {
          try {
            if (!res.headersSent) originalJson(body);
          } catch (e) {
            console.error("⚠️ Failed to send guarded JSON response:", e);
          }
        })
        .catch((e) => {
          console.error("⚠️ Cloud durability guard could not confirm sync before JSON response:", e);
          try {
            if (!res.headersSent) {
              res.status(503);
              originalJson(cloudDurabilityErrorBody());
            }
          } catch (sendError) {
            console.error("⚠️ Failed to send cloud durability error response:", sendError);
          }
        });
      return res;
    }) as typeof res.json;

    res.on("finish", () => {
      try {
        dbInstance.flushCloudSoon();
      } catch (e) {
        console.error("⚠️ Background DB sync error after response:", e);
      }
    });
  }
  next();
});

function cloudDurabilityErrorBody() {
  const status = dbInstance.getDatabaseGuardStatus();
  return {
    error:
      status?.message ||
      "تعذر تأكيد حفظ التغيير في السحابة. لم نؤكد نجاح العملية؛ حاول مرة أخرى بعد قليل.",
    code: status?.code || "CLOUD_SYNC_UNAVAILABLE",
  };
}

async function ensureDurableSync(res: express.Response): Promise<boolean> {
  try {
    await dbInstance.waitForSync();
    return true;
  } catch (error) {
    console.error("⚠️ Cloud durability sync failed inside API route:", error);
    if (!res.headersSent) {
      res.status(503).json(cloudDurabilityErrorBody());
    }
    return false;
  }
}


function studentSessionInvalidatedAfterIssue(student: any, session: MirasVerifiedSession | null): boolean {
  if (!student || !session?.issuedAt) return false;
  const invalidationTimes = [
    (student as any).deviceSessionInvalidatedAt,
    (student as any).accessResetAt,
    (student as any).secondHandDeviceApprovedAt,
  ]
    .map((value: any) => new Date(value || 0).getTime())
    .filter((value: number) => Number.isFinite(value) && value > 0);
  if (!invalidationTimes.length) return false;
  const latestInvalidation = Math.max(...invalidationTimes);
  // أي توكن صدر قبل لحظة تبديل/اعتماد الجهاز يُعد جلسة قديمة ويُطرد فوراً.
  return latestInvalidation > Number(session.issuedAt || 0);
}

function pathMatchesStudentOwnedApi(pathname: string) {
  return /^\/api\/students\/[^/]+$/.test(pathname) ||
    /^\/api\/students\/[^/]+\/(session-status|snapshot|log-violation|activate|reset-devices|activate-course)$/.test(pathname) ||
    pathname === "/api/learning-fingerprint" ||
    pathname.startsWith("/api/quizzes") ||
    pathname.startsWith("/api/exercises") ||
    pathname.startsWith("/api/projects/generate") ||
    pathname.startsWith("/api/projects/submit") ||
    pathname.startsWith("/api/submissions/upload") ||
    pathname.startsWith("/api/submission-attachments/") ||
    pathname === "/api/student/submissions" ||
    // الحالة الحية للطالب هي المحمّل الرئيسي لمساحة عمل الطالب (مقررات/اختبارات/
    // مشاريع). كانت مفتوحة بلا حماية، فيستطيع متصفح ثانٍ (Safari/PWA) تحميل
    // البرنامج كاملاً رغم قفل الجهاز على بقية المسارات. تخضع الآن لنفس قفل
    // الجهاز: الجهاز المربوط فقط يحمّل البرنامج، وأي متصفح/جهاز آخر يُمنع.
    pathname === "/api/live/student-state" ||
    pathname === "/api/payment/simulate";
}

function endpointStudentId(req: express.Request) {
  const match = req.path.match(/^\/api\/students\/([^/]+)/);
  return normalizeStudentId(
    (match ? decodeURIComponent(match[1]) : "") ||
      req.body?.studentId ||
      req.query?.studentId ||
      req.body?.idNumber ||
      "",
  );
}

app.use((req, res, next) => {
  const pathname = req.path || "";
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/config") || pathname.startsWith("/seb") || pathname.startsWith("/api/seb")) return next();
  if (pathname === "/api/students/join-lab" || pathname === "/api/students/rollcall-qr/activate") return next();

  if (pathname.startsWith("/api/teacher")) {
    const teacherEmail = teacherEmailFromRequest(req);
    if (!teacherEmail) {
      console.warn(`[AUTH_DEBUG] TEACHER_SESSION_REQUIRED for ${req.method} ${pathname}. Headers:`, JSON.stringify({
        authorization: req.headers.authorization ? "Present" : "Missing",
        "x-teacher-email": req.headers["x-teacher-email"] || "None",
        cookie: req.headers.cookie ? "Present" : "Missing"
      }));
      return res.status(401).json({
        error: "TEACHER_SESSION_REQUIRED",
        code: "TEACHER_SESSION_REQUIRED",
      });
    }
    (req as any).mirasTeacherEmail = teacherEmail;
    return next();
  }

  if (/^\/api\/projects\/[^/]+\/grade$/.test(pathname)) {
    const teacherEmail = teacherEmailFromRequest(req);
    if (!teacherEmail) {
      console.warn(`[AUTH_DEBUG] TEACHER_SESSION_REQUIRED for grade path ${req.method} ${pathname}`);
      return res.status(401).json({ error: "TEACHER_SESSION_REQUIRED", code: "TEACHER_SESSION_REQUIRED" });
    }
    return next();
  }

  if (pathMatchesStudentOwnedApi(pathname)) {
    const requestedStudentId = endpointStudentId(req);
    const verifiedSession = verifyMirasSessionToken(req);
    const sessionStudentId =
      verifiedSession?.role === "student"
        ? normalizeStudentId(verifiedSession.userId)
        : "";
    const teacherEmail = teacherEmailFromRequest(req);
    if (teacherEmail) return next();
    if (pathname === "/api/live/student-state" && !sessionStudentId) {
      // قبل تسجيل الدخول نسمح بلمحة ضيقة جداً: مقررات بانتظار تفعيل كود جديد فقط.
      // لا تُعاد اختبارات/مشاريع/تسليمات/أسماء حساسة إلا بعد جلسة طالب موثقة أو أستاذ.
      (req as any).mirasPublicStudentStatePreview = true;
      return next();
    }
    if (!sessionStudentId || (requestedStudentId && requestedStudentId !== sessionStudentId)) {
      console.warn(`[AUTH_DEBUG] STUDENT_SESSION_REQUIRED for ${req.method} ${pathname}. sessionStudentId: ${sessionStudentId || "None"}, requestedStudentId: ${requestedStudentId || "None"}`);
      return res.status(401).json({
        error: "STUDENT_SESSION_REQUIRED",
        code: "STUDENT_SESSION_REQUIRED",
      });
    }
    const currentDeviceToken = getRequestDeviceToken(req);
    if (
      verifiedSession?.deviceTokenHash &&
      (!currentDeviceToken ||
        hashMirasValue(currentDeviceToken) !== verifiedSession.deviceTokenHash)
    ) {
      return res.status(403).json({
        error:
          "هذه الجلسة مرتبطة بمتصفح آخر. افتح الحساب من المتصفح الأصلي أو اطلب من أستاذ المقرر تبديل الجهاز.",
        code: "STUDENT_DEVICE_LOCKED",
      });
    }
    const student = dbInstance
      .getStudents()
      .find((s: any) => normalizeStudentId(s.id) === sessionStudentId);
    if (!student) {
      return res.status(401).json({
        error: "STUDENT_SESSION_REQUIRED",
        code: "STUDENT_SESSION_REQUIRED",
      });
    }
    const deviceValidation = validateSessionFingerprint(req, student);
    if (!deviceValidation.isValid) {
      return res.status(deviceValidation.statusCode || 403).json({
        error:
          deviceValidation.error ||
          "هذا الحساب مقفل على جهاز أو متصفح آخر.",
        code: "STUDENT_DEVICE_LOCKED",
      });
    }
    // لا نطرد الجلسة لمجرد أن accessResetAt تغيّر إذا كان الطلب الحالي آتياً من
    // الجهاز/المتصفح المعتمد فعلياً. بعد موافقة الأستاذ على تبديل الجهاز كان
    // PWA الجديد يحمل أحياناً توكن جلسة قديم، فيُرفض قبل أن يستطيع الخادم اعتماد
    // بصمته الجديدة. التحقق أعلاه أصبح مصدر الحقيقة: الجهاز القديم يُرفض هناك،
    // والجهاز الجديد المسموح يُكمل الدخول ثم تُحدّث الواجهة جلسته محلياً.
    if (studentSessionInvalidatedAfterIssue(student, verifiedSession)) {
      res.setHeader("X-Miras-Student-Session-Refreshed", "1");
    }
    return next();
  }

  next();
});

app.post("/api/seb/launch", (req, res) => {
  const launched: any = createSebLaunchFromActivatedSession(req);
  if (launched.error)
    return res.status(launched.status || 400).json({ error: launched.error });
  return res.json({
    success: true,
    token: launched.pass.token,
    attemptId: launched.pass.attemptId,
    pass: describeSebPass(launched.pass),
    expiresAt: new Date(launched.pass.expiresAt).toISOString(),
    startUrl: launched.startUrl,
    quitUrl: launched.quitUrl,
    configUrl: launched.configUrl,
    configUrlAbsolute: buildSebConfigAbsoluteUrl(req, launched.pass.token),
    sebConfigDeepLinkUrl: buildSebConfigDeepLinkUrl(req, launched.pass.token),
    fileName: buildSebFileName(launched.pass),
  });
});

// Backward-compatible API name; internally it now creates a real launch session from the activated device.
app.post("/api/seb/pass", (req, res) => {
  const launched: any = createSebLaunchFromActivatedSession(req);
  if (launched.error)
    return res.status(launched.status || 400).json({ error: launched.error });
  return res.json({
    success: true,
    token: launched.pass.token,
    attemptId: launched.pass.attemptId,
    pass: describeSebPass(launched.pass),
    expiresAt: new Date(launched.pass.expiresAt).toISOString(),
    startUrl: launched.startUrl,
    quitUrl: launched.quitUrl,
    configUrl: launched.configUrl,
    configUrlAbsolute: buildSebConfigAbsoluteUrl(req, launched.pass.token),
    sebConfigDeepLinkUrl: buildSebConfigDeepLinkUrl(req, launched.pass.token),
    fileName: buildSebFileName(launched.pass),
  });
});

app.post("/seb/open", (req, res) => {
  const launched: any = createSebLaunchFromActivatedSession(req);
  if (launched.error) {
    res.status(launched.status || 400);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تعذر تشغيل SEB</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}.box{width:min(560px,calc(100vw - 32px));background:white;border:1px solid #e2e8f0;border-radius:24px;padding:28px;box-shadow:0 24px 70px rgba(15,23,42,.12)}h1{font-size:24px;margin:0 0 12px}p{line-height:1.8;color:#475569}.back{display:inline-flex;margin-top:16px;background:#1e1b4b;color:white;text-decoration:none;border-radius:16px;padding:12px 18px;font-weight:800}</style></head><body><main class="box"><h1>تعذر تشغيل Safe Exam Browser</h1><p>${xmlEscape(launched.error)}</p><a class="back" href="/">الرجوع إلى مراس</a></main></body></html>`,
    );
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  return res.send(renderSebLaunchPage(req, launched.pass));
});

app.get("/seb/launch", (req, res) => {
  const token = String(
    req.query.token || req.query.seb_token || req.query.seb_pass || "",
  ).trim();
  const pass = findSebPass(token);
  if (!token) {
    return sendSebStartError(
      req,
      res,
      403,
      null,
      "لا يمكن فتح الاختبار من ملف SEB عام. افتح حسابك في مِراس من جهازك المفعّل ثم اضغط زر تشغيل الاختبار عبر SEB ليتم إنشاء جلسة خاصة بهذا الاختبار.",
    );
  }
  if (!pass || pass.status === "closed")
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "رابط تشغيل SEB غير صالح أو منتهي.",
    );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  // If this route is reached from SEB, never point SEB back to a .seb config.
  // That reconfiguration loop is what triggers: Downloading and Opening SEB Configurations Not Allowed.
  return res.send(
    hasSebRuntimeHint(req)
      ? renderSebStartPage(req, pass)
      : renderSebLaunchPage(req, pass),
  );
});

function renderSebStartErrorPage(
  req: express.Request,
  pass: SebPass | null,
  message: string,
) {
  const quitUrl = pass ? buildSebQuitUrl(req, pass.token) : "";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>تعذر فتح الاختبار الآمن</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:22px;box-sizing:border-box}.box{max-width:560px;text-align:center;padding:32px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(255,255,255,.06)}h1{font-size:22px;margin:0 0 12px}p{line-height:1.8;color:#cbd5e1;font-size:14px}.pass{display:inline-block;margin-top:12px;border-radius:14px;background:rgba(255,255,255,.1);padding:10px 16px;font-size:22px;font-weight:900;letter-spacing:1px}a.btn{display:inline-flex;margin-top:18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:16px;padding:12px 22px;font-weight:900;font-size:14px}</style>
</head>
<body>
<div class="box"><h1>تعذر فتح الاختبار الآمن</h1><p>${xmlEscape(message)}</p><p>إذا بقيت داخل SEB استخدم كلمة الخروج لدى المراقب:</p><span class="pass">CBE</span>${quitUrl ? `<br><a class="btn" href="${xmlEscape(quitUrl)}">إغلاق الجلسة والخروج من SEB</a>` : ""}</div>
</body>
</html>`;
}
function sendSebStartError(
  req: express.Request,
  res: express.Response,
  status: number,
  pass: SebPass | null,
  message: string,
) {
  void status;
  res.status(200);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  return res.send(renderSebStartErrorPage(req, pass, message));
}
app.get("/seb/start", (req, res) => {
  const token = String(req.query.token || "").trim();
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed") {
    rejectSebPass(req, pass, "رابط جلسة SEB غير صالح أو منتهي عند /seb/start.");
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "رابط جلسة SEB غير صالح أو منتهي. اطلب من الأستاذ فتح محاولة جديدة، ثم اضغط زر فتح الاختبار من الجهاز الأصلي مرة واحدة فقط.",
    );
  }
  if (pass.status !== "launch" && pass.status !== "active") {
    rejectSebPass(
      req,
      pass,
      `محاولة إعادة استخدام startURL لمحاولة حالتها ${pass.status}.`,
    );
    return sendSebStartError(
      req,
      res,
      409,
      pass,
      "تم استخدام رابط تشغيل SEB لهذه المحاولة سابقاً. اطلب محاولة جديدة من الأستاذ إذا احتجت إعادة فتح الاختبار.",
    );
  }
  const student = dbInstance
    .getStudents()
    .find((s: any) => String(s.id) === String(pass.studentId));
  const exam = dbInstance
    .getTeacherExams()
    .find((item: any) => String(item.id) === String(pass.examId));
  if (
    !student ||
    !exam ||
    String(exam.courseCode || "").toLowerCase() !==
      String(pass.courseCode || "").toLowerCase() ||
    !studentHasEnrollmentInCourse(student, pass.courseCode)
  ) {
    closeSebAttempt(pass, "invalid-binding-at-start");
    rejectSebPass(
      req,
      pass,
      "فشل ربط جلسة SEB بالطالب/المقرر/الاختبار عند start.",
    );
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "جلسة SEB لا تطابق الطالب أو المقرر أو الاختبار.",
    );
  }
  const priorStartedAttempt = dbInstance
    .getQuizSubmissions()
    .find(
      (q: any) =>
        String(q.studentId) === String(student.id) &&
        String(q.chapterId) === String(pass.examId) &&
        String(q.status || "") === "started",
    );
  if (priorStartedAttempt) {
    finalizeExamAttemptAsZero(req, {
      student,
      exam,
      pass,
      submission: priorStartedAttempt,
      reason:
        "حاول الطالب الرجوع إلى اختبار سبق أن ظهرت له أسئلته ولم يسلّمه؛ تم تثبيت الدرجة التي وصل لها.",
    });
    closeSebAttempt(pass, "attempt-already-started-closed");
    return sendSebStartError(
      req,
      res,
      409,
      pass,
      "تم فتح هذا الاختبار سابقاً وظهرت أسئلته، لذلك أغلقت المحاولة ورُصدت الدرجة التي وصلت لها. يستطيع الأستاذ فقط إرجاع الاختبار إذا قرر السماح بمحاولة جديدة.",
    );
  }
  // Do NOT consume the pass here. The student is still on the warning screen
  // and hasn't actually started the exam yet. /api/seb/validate (called when the
  // real exam page loads after the student presses 'بدء الاختبار') will consume it.
  logSebEvent({
    studentId: student.id,
    studentName: student.name,
    action: "عرض شاشة التحذير قبل بدء SEB",
    details: `تم فتح startURL للاختبار ${pass.examId} في مقرر ${pass.courseCode} وعرض شاشة التأكيد للطالب.`,
    req,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  return res.send(renderSebStartPage(req, pass));
});

app.post("/api/seb/validate", (req, res) => {
  const token = getSebPassFromRequest(req);
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed") {
    rejectSebPass(req, pass, "فشل validate: token غير موجود أو مغلق.");
    return res.status(403).json({ error: "جلسة SEB غير صالحة أو منتهية." });
  }
  if (pass.status === "launch") {
    // The official SEB configuration now points directly to the exam app URL.
    // Therefore the first validation request from the SEB WebView is the exact
    // moment when the launch token must become an active exam tunnel.
    if (
      !hasSebRuntimeHint(req) &&
      String(
        req.body?.seb ||
          req.query?.seb ||
          req.body?.miras_seb ||
          req.query?.miras_seb ||
          "",
      ) !== "1"
    ) {
      rejectSebPass(req, pass, "فشل validate: token لم يصل من سياق SEB.");
      return res
        .status(409)
        .json({ error: "افتح الاختبار من تطبيق Safe Exam Browser أولاً." });
    }
    consumeSebPass(pass);
  }
  const student = dbInstance
    .getStudents()
    .find((s: any) => String(s.id) === String(pass.studentId));
  const exam = dbInstance
    .getTeacherExams()
    .find((item: any) => String(item.id) === String(pass.examId));
  if (!student || !exam) {
    rejectSebPass(req, pass, "فشل validate: الطالب أو الاختبار غير موجود.");
    return res
      .status(404)
      .json({ error: "تعذر العثور على الطالب أو الاختبار المرتبط بجلسة SEB." });
  }
  if (
    String(exam.courseCode || "").toLowerCase() !==
    String(pass.courseCode || "").toLowerCase()
  ) {
    rejectSebPass(req, pass, "فشل validate: المقرر لا يطابق مقرر الاختبار.");
    return res.status(403).json({ error: "جلسة SEB لا تطابق مقرر الاختبار." });
  }
  const teacherAuthorizedSebReturn = hasTeacherAuthorizedSebReturnException(
    exam.id,
    student.id,
  );
  if (
    !studentHasEnrollmentInCourse(student, pass.courseCode) &&
    !teacherAuthorizedSebReturn
  ) {
    rejectSebPass(req, pass, "فشل validate: المقرر غير مفعل بالكود الأصلي.");
    return res
      .status(403)
      .json({ error: "المقرر غير مفعل لهذا الطالب بالكود الأصلي." });
  }
  const existingAttempt = dbInstance
    .getQuizSubmissions()
    .find(
      (q: any) =>
        String(q.studentId) === String(student.id) &&
        String(q.chapterId) === String(pass.examId),
    );
  if (existingAttempt && String(existingAttempt.status || "") === "started") {
    const sameSebAttempt =
      pass.status === "active" &&
      String((existingAttempt as any).sebAttemptId || "") &&
      String((existingAttempt as any).sebAttemptId) === String(pass.attemptId);
    if (sameSebAttempt || teacherAuthorizedSebReturn) {
      logSebEvent({
        studentId: student.id,
        studentName: student.name,
        action: "استمرار نفق SEB",
        details: teacherAuthorizedSebReturn
          ? `تم السماح للطالب بالدخول مجدداً إلى نفس الاختبار عبر تصريح إرجاع من المعلم دون كسر بوابة SEB.`
          : `تم استكمال نفس محاولة SEB النشطة للاختبار ${pass.examId} دون فتح محاولة جديدة.`,
        req,
      });
      return res.json({
        success: true,
        student: {
          ...student,
          sectionCode: pass.courseCode,
          activeSebExamId: pass.examId,
          enrollments: getStudentEnrollmentDetails(student),
        },
        exam: {
          id: exam.id,
          title: exam.title,
          courseCode: exam.courseCode,
          ownerEmail:
            (exam as any).ownerEmail ||
            (exam as any).teacherEmail ||
            sectionOwnerEmail(exam.courseCode),
          timerMinutes:
            Number(
              (exam as any).antiCheat?.timerMinutes ??
                (exam as any).timerMinutes,
            ) || 30,
        },
        sebSession: describeSebPass(pass),
        quitUrl: buildSebQuitUrl(req, pass.token),
      });
    }
    const zeroSubmission = finalizeExamAttemptAsZero(req, {
      student,
      exam,
      pass,
      submission: existingAttempt,
      reason:
        "انقطعت أو أُعيدت جلسة SEB بعد ظهور الأسئلة وقبل التسليم؛ تم تثبيت الدرجة التي وصل لها الطالب.",
    });
    closeSebAttempt(pass, "started-attempt-reopened-closed");
    return res
      .status(409)
      .json({
        error:
          "تم فتح هذا الاختبار سابقاً وظهرت أسئلته، لذلك أغلقت المحاولة ورُصدت الدرجة التي وصلت لها. يستطيع الأستاذ فقط إرجاع الاختبار.",
        submission: zeroSubmission,
      });
  }
  if (
    existingAttempt &&
    String(existingAttempt.status || "submitted") !== "started" &&
    String(existingAttempt.status || "submitted") !== "returned" &&
    !teacherAuthorizedSebReturn
  ) {
    closeSebAttempt(pass, "attempt-already-closed");
    return res
      .status(409)
      .json({
        error:
          "هذه المحاولة مقفلة ولا يمكن فتحها مرة أخرى إلا إذا أعادها الأستاذ.",
        submission: existingAttempt,
      });
  }
  logSebEvent({
    studentId: student.id,
    studentName: student.name,
    action: "تفعيل نفق SEB",
    details: `تم تحويل رابط SEB إلى محاولة نشطة للاختبار ${pass.examId} في مقرر ${pass.courseCode}.`,
    req,
  });
  return res.json({
    success: true,
    student: {
      ...student,
      sectionCode: pass.courseCode,
      activeSebExamId: pass.examId,
      enrollments: getStudentEnrollmentDetails(student),
    },
    exam: {
      id: exam.id,
      title: exam.title,
      courseCode: exam.courseCode,
      ownerEmail:
        (exam as any).ownerEmail ||
        (exam as any).teacherEmail ||
        sectionOwnerEmail(exam.courseCode),
      timerMinutes:
        Number(
          (exam as any).antiCheat?.timerMinutes ?? (exam as any).timerMinutes,
        ) || 30,
    },
    sebSession: describeSebPass(pass),
    quitUrl: buildSebQuitUrl(req, pass.token),
  });
});

app.post("/api/seb/close", (req, res) => {
  const token = getSebPassFromRequest(req);
  const pass = getActiveSebAttempt(req) || (token ? findSebPass(token) : null);
  if (pass) closeSebAttempt(pass, String(req.body?.reason || "client-closed"));
  return res.json({ success: true });
});

app.get("/seb/quit", (req, res) => {
  const token = String(
    req.query.token || req.query.seb_token || req.query.seb_pass || "",
  ).trim();
  const map = getRuntimeSebPasses();
  const pass = findSebPass(token) || map.get(token) || null;
  // إغلاق رابط الخروج لا يسجل انسحاباً إلا إذا كانت المحاولة بدأت فعلياً.
  // إذا كانت الجلسة launch فقط فلن يجد flagExamExitedBeforeSubmit أي محاولة started
  // أو صف "قيد الحل"، لذلك يبقى خروجاً آمناً قبل البداية.
  if (pass) closeSebAttempt(pass, "explicit-quit-url");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>الخروج من SEB</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#020617;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:560px;text-align:center;padding:32px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(255,255,255,.06)}.pass{display:inline-block;margin-top:12px;border-radius:14px;background:rgba(255,255,255,.1);padding:10px 16px;font-size:22px;font-weight:900;letter-spacing:1px}a{color:#a5b4fc;font-weight:800}</style></head><body><div class="box"><h1>تم إغلاق جلسة الاختبار الآمن</h1><p>إذا لم يُغلق Safe Exam Browser تلقائياً، استخدم زر الخروج الآمن داخل البرنامج أو أبلغ المراقب.</p><p>كلمة الخروج:</p><span class="pass">CBE</span></div></body></html>`,
  );
});

function sendSebConfig(req: express.Request, res: express.Response) {
  const token = getSebConfigTokenFromRequest(req);
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed")
    return res
      .status(403)
      .send(
        "لا يمكن إنشاء ملف SEB إلا من جلسة اختبار مؤقتة صالحة تم إطلاقها من الجهاز الأصلي.",
      );
  if (hasSebRuntimeHint(req) && pass.status !== "launch") {
    // Once SEB has consumed the launch configuration, any later request for a .seb
    // file from inside SEB must be treated as a loop and sent to the exam session.
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    return res.redirect(302, buildSebStartUrl(req, pass.token));
  }
  const startUrl = buildSebStartUrl(req, pass.token);
  const quitUrl = buildSebQuitUrl(req, pass.token);
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http",
  ).split(",")[0];
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`,
  ).split(",")[0];
  const urlHostPattern = `${proto}://${host}/*`;
  const sebFileName = buildSebFileName(pass);
  const sebConfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>allowBrowsingBackForward</key><false/>
  <key>allowDownUploads</key><true/>
  <key>allowQuit</key><true/>
  <key>allowReload</key><true/>
  <key>browserWindowAllowReload</key><true/>
  <key>browserWindowShowURL</key><false/>
  <key>downloadAndOpenSebConfig</key><false/>
  <key>downloadAndOpenSebConfigAllowed</key><false/>
  <key>newBrowserWindowByLinkPolicy</key><integer>2</integer>
  <key>newBrowserWindowByScriptPolicy</key><integer>2</integer>
  <key>quitURL</key><string>${xmlEscape(quitUrl)}</string>
  <key>quitURLConfirm</key><false/>
  <key>hashedQuitPassword</key><string>6e6aaf1c79ab85ca9de66a89fcab9d3fd4b8f4b312c66f9d56653c5d01af50ce</string>
  <key>restartExamPasswordProtected</key><true/>
  <key>sebMode</key><integer>0</integer>
  <key>sendBrowserExamKey</key><true/>
  <key>showInputLanguage</key><false/>
  <key>showReloadButton</key><true/>
  <key>showTaskBar</key><false/>
  <key>showTime</key><false/>
  <key>startURL</key><string>${xmlEscape(startUrl)}</string>
  <key>enablePrivateClipboard</key><true/>
  <key>allowSpellCheck</key><false/>
  <key>allowDictionaryLookup</key><false/>
  <key>allowDictation</key><false/>
  <key>allowSiri</key><false/>
  <key>allowedDisplaysMaxNumber</key><integer>1</integer>
  <key>URLFilterEnable</key><true/>
  <key>URLFilterEnableContentFilter</key><true/>
  <key>URLFilterRules</key>
  <array>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>${xmlEscape(urlHostPattern)}</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://fonts.googleapis.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://fonts.gstatic.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://*.googleapis.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://*.gstatic.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>data:*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>blob:*</string><key>regex</key><false/></dict>
  </array>
  <key>URLFilterTrustedContent</key><false/>
</dict>
</plist>`;
  res.setHeader("Content-Type", "application/seb");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Disposition", `attachment; filename="${sebFileName}"`);
  return res.send(sebConfig);
}

app.get("/seb/config/:token/miras-official.seb", sendSebConfig);
app.get("/seb/miras-official.seb", sendSebConfig);

app.get("/api/config/firebase-public", (req, res) => {
  const config = firebasePublicConfig();
  const hasFirebaseClientConfig = !!(
    config.apiKey &&
    config.projectId &&
    config.messagingSenderId &&
    config.appId
  );
  return res.json({
    firebaseConfig: {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
      measurementId: config.measurementId,
    },
    vapidKey: config.vapidKey,
    isMessagingConfigured: hasFirebaseClientConfig,
    canSendFromServer: hasFirebaseClientConfig && hasFcmSenderCandidate(),
    firestoreQuotaExceeded,
    firestoreQuotaErrorDetail,
  });
});

function requireNotificationIdentity(
  req: express.Request,
  res: express.Response,
  userId: string,
  role: string,
) {
  const session = verifyMirasSessionToken(req);
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!session) {
    const teacherRole =
      normalizedRole === "teacher" || normalizedRole === "admin";
    res.status(401).json({
      error: teacherRole
        ? "جلسة الأستاذ غير صالحة."
        : "جلسة الطالب غير صالحة.",
      code: teacherRole
        ? "TEACHER_SESSION_REQUIRED"
        : "STUDENT_SESSION_REQUIRED",
    });
    return null;
  }
  if (normalizedRole === "student") {
    if (
      session.role !== "student" ||
      normalizeStudentId(session.userId) !== normalizeStudentId(userId)
    ) {
      res
        .status(403)
        .json({ error: "لا تملك صلاحية الوصول إلى إشعارات هذا الطالب." });
      return null;
    }
    return session;
  }
  if (session.role !== "teacher" && session.role !== "admin") {
    res
      .status(403)
      .json({ error: "لا تملك صلاحية الوصول إلى إشعارات الأستاذ." });
    return null;
  }
  const sessionEmail = String(session.email || session.userId || "")
    .trim()
    .toLowerCase();
  if (userId && sessionEmail !== String(userId).trim().toLowerCase()) {
    res
      .status(403)
      .json({ error: "لا تملك صلاحية الوصول إلى إشعارات هذا الحساب." });
    return null;
  }
  return session;
}

app.post("/api/notifications/register-token", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const userId = String(req.body?.userId || "").trim();
  const role = String(req.body?.role || "student") as
    | "student"
    | "teacher"
    | "admin";
  if (!token || !userId || !["student", "teacher", "admin"].includes(role)) {
    return res.status(400).json({ error: "بيانات الإشعارات غير مكتملة." });
  }
  if (!requireNotificationIdentity(req, res, userId, role)) return;
  const student =
    role === "student"
      ? dbInstance.getStudents().find((s: any) => String(s.id) === userId)
      : undefined;
  const teacher =
    role !== "student"
      ? dbInstance
          .getTeachers()
          .find(
            (t: any) =>
              String(t.email || t.id).toLowerCase() === userId.toLowerCase(),
          )
      : undefined;
  if ((role === "student" && !student) || (role !== "student" && !teacher)) {
    return res
      .status(404)
      .json({ error: "لا يمكن ربط التوكن بحساب غير معروف." });
  }
  const now = new Date().toISOString();
  const saved: NotificationToken = {
    token,
    userId,
    userName: student?.name || teacher?.name,
    role,
    sectionCode: student?.sectionCode || String(req.body?.sectionCode || ""),
    teacherEmail:
      role === "student"
        ? sectionOwnerEmail(student?.sectionCode)
        : (teacher?.email || userId).toLowerCase(),
    deviceToken: getRequestDeviceToken(req),
    permission:
      req.body?.permission === "denied"
        ? "denied"
        : req.body?.permission === "default"
          ? "default"
          : "granted",
    platform: req.body?.platform === "pwa" ? "pwa" : "web",
    userAgent: String(req.headers["user-agent"] || ""),
    createdAt: now,
    updatedAt: now,
  };
  dbInstance.upsertNotificationToken(saved);
  return res.json({
    success: true,
    tokenLinkedTo: {
      userId: saved.userId,
      role: saved.role,
      sectionCode: saved.sectionCode,
    },
  });
});

app.post("/api/notifications/unregister-token", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const userId = String(req.body?.userId || "").trim();
  const session = verifyMirasSessionToken(req);
  if (!session) {
    return res.status(401).json({
      error: "جلسة الحساب غير صالحة.",
      code: "STUDENT_SESSION_REQUIRED",
    });
  }
  const sessionUserId =
    session.role === "student"
      ? normalizeStudentId(session.userId)
      : String(session.email || session.userId || "")
          .trim()
          .toLowerCase();
  const requestedUserId =
    session.role === "student"
      ? normalizeStudentId(userId)
      : String(userId || "")
          .trim()
          .toLowerCase();
  if (!requestedUserId || requestedUserId !== sessionUserId) {
    return res
      .status(403)
      .json({ error: "لا تملك صلاحية فصل إشعارات هذا الحساب." });
  }
  if (token && !token.startsWith("inapp:"))
    dbInstance.disableNotificationToken(token, userId || undefined);
  return res.json({ success: true });
});


function isCourseWideStudentNotification(item: any): boolean {
  const type = String(item?.type || item?.data?.type || "").toLowerCase();
  const text = `${type} ${item?.title || ""} ${item?.body || ""}`;
  const routineEdit =
    [
      "course_updated",
      "course_renamed",
      "exam_updated",
      "exam_renamed",
      "project_updated",
      "project_renamed",
      "teacher_course_change",
      "teacher_student_change",
    ].includes(type) ||
    /تحديث مقرر|تحديث اختبار|تحديث مشروع|تغيير اسم|تعديل اسم|تم تحديث|تم تعديل/i.test(text);
  const meaningfulForStudent =
    /اختبار جديد|مشروع جديد|تنبيه اختبار|اختبار متاح|موعد|رزنامة|تقويم|إعلان|عام|تسليم|مطلوب|واجب|درجة|نشر|فتح|إغلاق|اغلاق|قبول|رفض|إرجاع|ارجاع/i.test(text);
  if (routineEdit && !meaningfulForStudent) return false;
  if (
    [
      "course",
      "course_notice",
      "course_announcement",
      "exam_reminder",
      "course_opened",
      "course_closed",
      "activity_published",
      "project_published",
    ].includes(type)
  )
    return true;
  if (/تنبيه اختبار|اختبار متاح|موعد|رزنامة|تقويم|إعلان|عام/i.test(text))
    return true;
  return false;
}

function isStudentPrivateNotificationShape(item: any): boolean {
  const type = String(item?.type || item?.data?.type || "").toLowerCase();
  const text = `${type} ${item?.title || ""} ${item?.body || ""}`;
  if (item?.data?.studentId || item?.studentId) return true;
  return (
    [
      "exam_submission",
      "project_submission",
      "exercise_submission",
      "grade_posted",
      "grade_recorded",
      "exam_cheating_attempt",
      "exam_warning",
      "seb_exit_before_submit",
      "exam_exited_before_submit",
      "password_reset",
      "password_reset_ready",
      "course_activated",
      "student_registered",
      "student_logged_in",
    ].includes(type) ||
    /درجة|مرصودة|رصد|تسليم|محاولة غش|غش|خروج قبل التسليم|إعادة محاولة|استرجاع كلمة|فعّل مقرر|تسجيل طالب/i.test(text)
  );
}

app.get("/api/notifications/inbox", (req, res) => {
  const userId = String(req.query.userId || "").trim();
  const role = String(req.query.role || "student").trim();
  const sectionCode = String(req.query.sectionCode || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "هوية صندوق الإشعارات مطلوبة." });
  }
  if (!requireNotificationIdentity(req, res, userId, role)) return;
  const since = req.query.since
    ? new Date(String(req.query.since)).getTime()
    : 0;
  // ملاحظة مهمة: نستخدم مقررات الالتحاق المكتشفة (getStudentDiscoveredCourseCodes) وليس
  // المقررات "النشطة" فقط. الطالب المعاد غالباً يكون في مجموعة مغلقة/مؤرشفة، ودالة المقررات
  // النشطة تُسقط المقررات المغلقة والموقوفة — فلو اعتمدنا عليها هنا لاختفت كل تنبيهات المعاد
  // من الجرس. عضوية الإشعارات يجب أن تكون منفصلة عن صلاحية الدخول.
  const studentForNotifications =
    role === "student"
      ? dbInstance.getStudents().find((st: any) => String(st.id) === userId)
      : undefined;
  const notificationCourseCodes =
    role === "student" && studentForNotifications
      ? getStudentDiscoveredCourseCodes(studentForNotifications)
      : [];
  const courseNotificationIsFreshForStudent = (item: any, courseValue: any, createdMs: number) => {
    if (role !== "student" || !studentForNotifications || !courseValue) return true;
    const activationMs = latestStudentCourseActivationTime(
      studentForNotifications,
      courseValue,
      sectionOwnerEmail(courseValue),
    ) ||
      (Date.parse(String((studentForNotifications as any).lastCourseActivationAt || "")) || 0) ||
      (Date.parse(String((studentForNotifications as any).signupDate || (studentForNotifications as any).createdAt || "")) || 0);
    if (!activationMs || !createdMs) return true;
    // سماحية بسيطة عند إنشاء تنبيه التفعيل بالتزامن مع حفظ التحاق الطالب.
    return createdMs + 30 * 1000 >= activationMs;
  };
  const items = dbInstance
    .getInAppNotifications()
    .filter((item: any) => {
      const t = new Date(item.createdAt || item.updatedAt || item.data?.createdAt || item.data?.sentAt || 0).getTime();
      if (since && t <= since) return false;
      const itemRole = String(item.role || item.data?.role || item.data?.targetRole || "")
        .trim()
        .toLowerCase();
      const direct =
        item.userId &&
        userId &&
        String(item.userId).toLowerCase() === userId.toLowerCase() &&
        (!itemRole || itemRole === role);
      if (
        role === "student" &&
        ["teacher", "admin", "superadmin", "super_admin"].includes(itemRole)
      )
        return false;
      if (role === "admin" || role === "superadmin" || role === "super_admin") {
        const itemUser = String(item.userId || item.data?.userId || "").toLowerCase();
        const teacherEmail = String(item.teacherEmail || item.data?.teacherEmail || "").toLowerCase();
        const isAdminDirected =
          (itemUser && itemUser === userId.toLowerCase()) ||
          (teacherEmail && teacherEmail === userId.toLowerCase()) ||
          ["admin", "superadmin", "super_admin"].includes(itemRole);
        const isRoutineTeacherAction = [
          "course_opened",
          "course_closed",
          "course_updated",
          "course_deleted",
          "student_deleted",
          "student_removed",
          "exam_submission",
          "project_submission",
          "course_activated",
          "code_used",
          "student_registered",
          "student_logged_in",
          "course_student_suspended",
          "course_student_reactivated",
          "teacher_course_change",
          "teacher_student_change",
        ].includes(String(item.type || item.data?.type || "").toLowerCase());
        return isAdminDirected && !isRoutineTeacherAction;
      }
      if (
        role === "student" &&
        shouldSuppressRoutineStudentNotification(
          item.title,
          item.body,
          item.data || { type: item.type },
        )
      )
        return false;
      const itemStudentId = String(
        item.data?.studentId || item.studentId || "",
      ).trim();
      const itemUserId = String(item.data?.userId || item.userId || "").trim();
      if (role === "student") {
        const privateTarget = itemStudentId || (itemUserId && itemRole === "student" ? itemUserId : "");
        if (privateTarget && String(privateTarget).toLowerCase() !== userId.toLowerCase()) return false;
        if (!privateTarget && isStudentPrivateNotificationShape(item)) return false;
      }
      const itemCourse = String(
        item.sectionCode ||
          item.courseCode ||
          item.data?.courseCode ||
          item.data?.sectionCode ||
          "",
      ).trim();
      const course =
        role === "student" &&
        itemCourse &&
        isCourseWideStudentNotification(item) &&
        (sectionCodeEquivalent(sectionCode, itemCourse) ||
          notificationCourseCodes.some((code: any) =>
            sectionCodeEquivalent(code, itemCourse),
          ));
      if (course && !courseNotificationIsFreshForStudent(item, itemCourse, t))
        return false;
      return direct || course;
    })
    .sort(
      (a: any, b: any) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime(),
    )
    .slice(0, 40);
  return res.json({
    success: true,
    notifications: items.map(sanitizeNotificationForResponse),
  });
});

app.post("/api/notifications/course", (req, res) => {
  const teacherEmail = verifiedTeacherEmailFromSession(req);
  if (!teacherEmail) {
    return res.status(401).json({
      error: "جلسة الأستاذ غير صالحة.",
      code: "TEACHER_SESSION_REQUIRED",
    });
  }
  const sectionCode = String(
    req.body?.sectionCode || req.body?.courseCode || "",
  ).trim();
  const title = String(req.body?.title || "تنبيه مقرر").trim();
  const body = String(req.body?.body || "لديك تنبيه جديد في المقرر.").trim();
  const type = String(req.body?.type || "course").trim();
  if (!sectionCode)
    return res.status(400).json({ error: "لم يتم تحديد المقرر." });
  const safeTitle = sanitizePublicMessageText(title) || "تنبيه مقرر";
  const safeBody =
    sanitizePublicMessageText(body) || "لديك تنبيه جديد في المقرر.";
  const notificationPayload = { type, courseCode: sectionCode, link: "/" };
  if (
    shouldSuppressRoutineStudentNotification(
      safeTitle,
      safeBody,
      notificationPayload,
    )
  ) {
    return res.json({
      success: true,
      suppressed: true,
      notification: null,
      sent: 0,
    });
  }
  const saved = rememberCourseNotification(
    sectionCode,
    safeTitle,
    safeBody,
    type,
    notificationPayload,
  );
  const sent = notifyUsers(
    (token) =>
      token.role === "student" && studentTokenHasCourse(token, sectionCode),
    safeTitle,
    safeBody,
    notificationPayload,
  );
  return res.json({ success: true, notification: saved, sent });
});

// ═══════════════════════════════════════════════════════════════════
// العلامة المائية + قمع صحة الأكواد + التجميع الجغرافي/الزمني (ميزات جديدة)
// ═══════════════════════════════════════════════════════════════════

// توقيع قصير غير قابل للعكس يربط كل كود بهوية الطالب — يتتبّع المسرّب لو سُرّب الكود.
const CODE_WATERMARK_SECRET =
  process.env.MIRAS_WATERMARK_SECRET || "miras-watermark-v1";
function codeWatermark(studentId: any, code: any): string {
  return crypto
    .createHash("sha256")
    .update(
      `${CODE_WATERMARK_SECRET}:${normalizeStudentId(studentId)}:${normalizeJoinCode(code)}`,
    )
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
}

// قمع صحة الأكواد: أُصدر ← فُعّل ← أول دخول ← أول اختبار.
function buildCodeHealthFunnel(scopedCodes: any[]): any {
  const students = dbInstance.getStudents();
  const quiz = dbInstance.getQuizSubmissions();
  const teacherSubs = dbInstance.getTeacherSubmissions();
  const issued = scopedCodes.length;
  const usedCodes = scopedCodes.filter(
    (c: any) => String(c.status || "").toLowerCase() === "used",
  );
  let firstLogin = 0;
  let firstExam = 0;
  usedCodes.forEach((c: any) => {
    const sid = normalizeStudentId(c.studentId || c.usedByStudentId);
    if (!sid) return;
    const st: any = students.find((s: any) => normalizeStudentId(s.id) === sid);
    if (
      st &&
      (st.lastLoginDate || (Array.isArray(st.devices) && st.devices.length > 0))
    )
      firstLogin += 1;
    const tookExam =
      quiz.some((s: any) => normalizeStudentId(s.studentId) === sid) ||
      teacherSubs.some(
        (s: any) =>
          normalizeStudentId(s.studentId) === sid &&
          String(s.kind || "") === "exam",
      );
    if (tookExam) firstExam += 1;
  });
  const activated = usedCodes.length;
  return {
    issued,
    activated,
    firstLogin,
    firstExam,
    activationRate: issued ? Math.round((activated / issued) * 100) : 0,
    loginRate: activated ? Math.round((firstLogin / activated) * 100) : 0,
    examRate: activated ? Math.round((firstExam / activated) * 100) : 0,
  };
}

// تجميع جغرافي/زمني: عدة طلبة فعّلوا/حاولوا من نفس الـIP خلال وقت قصير ⇒ دفعة مُتداولة.
function buildIpClusterAlerts(
  scopedCodes: any[],
  scopedAttempts: any[],
): any[] {
  const byIp = new Map<string, any>();
  const add = (ip: any, studentId: any, when: any, code: any, batchId: any) => {
    const key = String(ip || "").trim();
    if (!key || key === "127.0.0.1" || key === "::1") return;
    const item = byIp.get(key) || {
      ip: key,
      students: new Set(),
      codes: new Set(),
      batches: new Set(),
      times: [] as number[],
    };
    if (studentId) item.students.add(String(studentId));
    if (code) item.codes.add(String(code));
    if (batchId) item.batches.add(String(batchId));
    const t = new Date(when || 0).getTime();
    if (t) item.times.push(t);
    byIp.set(key, item);
  };
  scopedCodes.forEach((c: any) => {
    if (String(c.status || "").toLowerCase() === "used") {
      add(
        c.activationIp,
        c.studentId || c.usedByStudentId,
        c.activatedAt,
        c.code,
        resolveJoinCodeBatchId(c),
      );
    }
  });
  scopedAttempts.forEach((a: any) =>
    add(a.ip, a.studentId, a.timestamp, a.code, a.batchId),
  );
  const alerts: any[] = [];
  byIp.forEach((item: any) => {
    const distinctStudents = item.students.size;
    if (distinctStudents < 3) return;
    const times = item.times.sort((x: number, y: number) => x - y);
    const windowMs = times.length ? times[times.length - 1] - times[0] : 0;
    const windowMinutes = Math.round(windowMs / 60000);
    const tightWindow = times.length >= 3 && windowMs <= 30 * 60 * 1000;
    const score = Math.min(99, distinctStudents * 18 + (tightWindow ? 25 : 0));
    alerts.push({
      ip: item.ip,
      distinctStudents,
      distinctCodes: item.codes.size,
      batches: Array.from(item.batches).slice(0, 4),
      windowMinutes,
      tightWindow,
      score,
      evidence: `${distinctStudents} طلبة و${item.codes.size} أكواد من نفس الشبكة${tightWindow ? ` خلال ${windowMinutes} دقيقة` : ""}.`,
      recommendation:
        "النمط يشبه تفعيلاً جماعياً من جهاز/شبكة واحدة — راجع طريقة توزيع هذه الدفعة.",
    });
  });
  return alerts.sort((a: any, b: any) => b.score - a.score).slice(0, 12);
}

function buildSharingRingGraph(scopedAttempts: any[], scopedCodes: any[]): SharingRingGraph {
  const nodes = new Map<string, any>();
  const edges = new Map<string, any>();
  const touchNode = (id: string, label: string, kind: "device" | "student", risk = 0) => {
    if (!id) return;
    const prev = nodes.get(id) || { id, label, kind, risk: 0, count: 0 };
    prev.risk = Math.max(prev.risk, risk);
    prev.count = Number(prev.count || 0) + 1;
    nodes.set(id, prev);
  };
  const touchEdge = (from: string, to: string, risk = 0) => {
    if (!from || !to) return;
    const key = `${from}->${to}`;
    const prev = edges.get(key) || { from, to, weight: 0, risk: 0 };
    prev.weight += 1;
    prev.risk = Math.max(prev.risk, risk);
    edges.set(key, prev);
  };
  const rows = [
    ...scopedAttempts.map((a: any) => ({
      device: a.deviceToken || a.deviceFingerprint,
      student: normalizeStudentId(a.studentId || a.idNumber),
      name: a.studentName || a.studentId || "طالب",
      risk: String(a.reason || "").includes("جهاز") ? 90 : 55,
    })),
    ...scopedCodes.map((c: any) => ({
      device: c.activationDeviceToken || c.activationDeviceFingerprint,
      student: normalizeStudentId(c.studentId || c.usedByStudentId || c.assignedStudentId),
      name: c.studentName || c.assignedStudentName || c.studentId || "طالب",
      risk: Number((c as any).codeReputationScore || 25),
    })),
  ].filter((r: any) => r.device && r.student);
  const byDevice = new Map<string, Set<string>>();
  rows.forEach((r: any) => {
    const deviceId = `dev:${crypto.createHash("sha1").update(String(r.device)).digest("hex").slice(0, 10)}`;
    const studentId = `stu:${r.student}`;
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, new Set());
    byDevice.get(deviceId)!.add(studentId);
    const risk = Math.max(Number(r.risk || 0), (byDevice.get(deviceId)!.size >= 2 ? 88 : 35));
    touchNode(deviceId, `جهاز ${String(r.device).slice(0, 4)}…`, "device", risk);
    touchNode(studentId, r.name || r.student, "student", risk);
    touchEdge(deviceId, studentId, risk);
  });
  const ringDevices = Array.from(byDevice.entries()).filter(([, students]) => students.size >= 2);
  const allowedDeviceIds = new Set(ringDevices.map(([id]) => id));
  const allowedStudentIds = new Set<string>();
  ringDevices.forEach(([, students]) => students.forEach((sid) => allowedStudentIds.add(sid)));
  const filteredNodes = Array.from(nodes.values()).filter((n: any) => allowedDeviceIds.has(n.id) || allowedStudentIds.has(n.id)).slice(0, 24);
  const filteredNodeIds = new Set(filteredNodes.map((n: any) => n.id));
  return {
    nodes: filteredNodes,
    edges: Array.from(edges.values()).filter((e: any) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)).slice(0, 40),
    rings: ringDevices.slice(0, 8).map(([id, students]) => ({ id, risk: 90, students: students.size, devices: 1 })),
  };
}

function buildCodeRadar(codes: any[], attempts: any[]) {
  const now = Date.now();
  const linkedByDevice = new Map<string, Set<string>>();
  attempts.forEach((attempt: any) => {
    const device = String(attempt.device || attempt.deviceToken || attempt.activationDeviceToken || attempt.deviceFingerprint || "").trim();
    const sid = normalizeStudentId(attempt.studentId || attempt.idNumber || attempt.assignedStudentId || "");
    if (!device || !sid) return;
    if (!linkedByDevice.has(device)) linkedByDevice.set(device, new Set());
    linkedByDevice.get(device)!.add(sid);
  });
  const sharedStudentIds = new Set<string>();
  linkedByDevice.forEach((students) => {
    if (students.size >= 2) students.forEach((sid) => sharedStudentIds.add(sid));
  });
  const radar = {
    safe: 0,
    late: 0,
    suspicious: 0,
    sharing: 0,
    total: 0,
    hot: [] as any[],
  };
  codes.filter(isUsableJoinCodeRecord).forEach((code: any) => {
    radar.total += 1;
    const score = Number(code.codeReputationScore || 0);
    const rep = String(code.codeReputation || "normal").toLowerCase();
    const status = String(code.status || "").toLowerCase();
    const createdAt = Date.parse(String(code.createdAt || code.issuedAt || "")) || now;
    const ageDays = Math.max(0, Math.floor((now - createdAt) / 86400000));
    const sid = normalizeStudentId(code.studentId || code.usedByStudentId || code.assignedStudentId || "");
    const isSharing = sharedStudentIds.has(sid) || Number(code.distinctFailedStudents || 0) >= 2 || Number(code.distinctFailedDevices || 0) >= 3;
    const isDanger = rep === "danger" || rep === "temporarily_blocked" || score >= 80 || Number(code.leakAttemptCount || 0) > 0 || code.activationReviewRequired;
    const isLate = status === "active" && ageDays >= 7;
    if (isSharing) radar.sharing += 1;
    else if (isDanger) radar.suspicious += 1;
    else if (isLate || rep === "watch" || score >= 35) radar.late += 1;
    else radar.safe += 1;
    if (isSharing || isDanger) {
      radar.hot.push({
        code: code.code,
        studentId: sid,
        studentName: code.studentName || code.assignedStudentName || "",
        sectionCode: joinCodeCourse(code),
        risk: isSharing ? "sharing" : "suspicious",
        score,
      });
    }
  });
  radar.hot = radar.hot.slice(0, 8);
  return radar;
}


function buildSmartHealPreview(health: any) {
  const items = [
    { key: "ghostStudents", label: "طلاب عالقون", count: Number(health?.ghostStudents || 0), tone: "amber" },
    { key: "orphanCodes", label: "أكواد قديمة", count: Number(health?.orphanCodes || 0), tone: "rose" },
    { key: "deadLinkCodes", label: "روابط مكسورة", count: Number(health?.deadLinkCodes || 0), tone: "violet" },
    { key: "rosterOrphans", label: "كشف يتيم", count: Number(health?.rosterOrphans || 0), tone: "slate" },
    { key: "activeDeadStudentCodes", label: "نشط بلا طالب", count: Number(health?.activeDeadStudentCodes || 0), tone: "rose" },
    { key: "duplicateActiveStudentCourseCodes", label: "تكرار نشط", count: Number(health?.duplicateActiveStudentCourseCodes || 0), tone: "amber" },
    { key: "tamperedLedgers", label: "سجل مكسور", count: Number(health?.tamperedLedgers || 0), tone: "rose" },
  ].filter((item) => item.count > 0);
  return {
    canHeal: items.length > 0,
    total: items.reduce((sum, item) => sum + item.count, 0),
    items: items.slice(0, 5),
    summary: items.length
      ? items.slice(0, 3).map((item) => `${item.count} ${item.label}`).join(" — ")
      : "نظيف",
  };
}

function buildMirasPulse(scopedCodes: any[], scopedAttempts: any[], health: any, radar: any) {
  const activeCodes = scopedCodes.filter((c: any) => String(c.status || "active").toLowerCase() === "active").length;
  const stuckStudents = dbInstance.getStudents().filter((student: any) => {
    const roster = getStudentRosterCourseCodes(student);
    if (!roster.length) return false;
    const active = getStudentActiveCourseCodes(student);
    return roster.some((course) => !active.some((a) => sectionCodeEquivalent(a, course)));
  }).length;
  const sensitiveExams = dbInstance.getTeacherExams().filter((exam: any) => {
    if (!isActiveRecord(exam)) return false;
    const status = String((exam as any).status || (exam as any).visibility || "").toLowerCase();
    return status.includes("open") || status.includes("active") || (exam as any).isOpen === true || (exam as any).isPublished === true;
  }).length;
  const suspiciousSessions = scopedAttempts.filter((attempt: any) => {
    const reason = String(attempt.reason || "");
    const level = String(attempt.sessionConfidenceLevel || attempt.fairnessLevel || "");
    return reason.includes("جهاز") || reason.includes("مشاركة") || level.includes("منخفض") || Number(attempt.sessionConfidenceScore || 0) >= 70;
  }).length;
  const issues = Number(health?.totalIssues || 0) + Number(radar?.suspicious || 0) + Number(radar?.sharing || 0) + stuckStudents + suspiciousSessions;
  const status = issues > 8 ? "danger" : issues > 0 ? "watch" : "calm";
  return {
    status,
    score: status === "calm" ? 98 : Math.max(35, 96 - Math.min(60, issues * 5)),
    rings: [
      { key: "health", value: Number(health?.totalIssues || 0), tone: Number(health?.totalIssues || 0) ? "amber" : "emerald", label: "صحة" },
      { key: "codes", value: Number((radar?.suspicious || 0) + (radar?.sharing || 0)), tone: (radar?.sharing || 0) ? "violet" : (radar?.suspicious || 0) ? "rose" : "emerald", label: "أكواد" },
      { key: "students", value: stuckStudents, tone: stuckStudents ? "amber" : "emerald", label: "طلبة" },
      { key: "attempts", value: suspiciousSessions, tone: suspiciousSessions ? "rose" : "emerald", label: "جلسات" },
      { key: "exams", value: sensitiveExams, tone: "indigo", label: "اختبارات" },
    ],
    metrics: { activeCodes, stuckStudents, activationAttempts: scopedAttempts.length, sensitiveExams, suspiciousSessions },
    healPreview: buildSmartHealPreview(health),
  };
}

function buildTrustMap(scopedCodes: any[], scopedAttempts: any[], graph: any, radar: any) {
  const dots: any[] = [];
  const pushDot = (kind: string, id: any, label: any, tone: string, score: number, title: any = "") => {
    const key = `${kind}:${String(id || label || Math.random()).slice(0, 32)}`;
    if (dots.some((d) => d.key === key)) return;
    dots.push({ key, kind, label: String(label || id || "—").slice(0, 18), tone, score, title: String(title || label || id || "") });
  };
  (Array.isArray(radar?.hot) ? radar.hot : []).forEach((item: any) => {
    pushDot("code", item.code, item.code, item.risk === "sharing" ? "violet" : "rose", Number(item.score || 80), item.studentName || item.studentId || "");
  });
  (Array.isArray(graph?.nodes) ? graph.nodes : []).forEach((node: any) => {
    const tone = node.kind === "device" ? "violet" : Number(node.risk || 0) >= 80 ? "rose" : "amber";
    pushDot(node.kind || "node", node.id, node.label, tone, Number(node.risk || 50));
  });
  scopedAttempts.slice(0, 40).forEach((attempt: any) => {
    const score = Number(attempt.sessionConfidenceScore || attempt.fairnessScore || 0);
    if (score >= 70 || String(attempt.reason || "").includes("جهاز")) {
      pushDot("student", normalizeStudentId(attempt.studentId), attempt.studentName || attempt.studentId, score >= 85 ? "rose" : "amber", score || 75, attempt.reason || "");
    }
  });
  scopedCodes.filter(isUsableJoinCodeRecord).slice(0, 60).forEach((code: any) => {
    if (dots.length >= 28) return;
    const score = Number(code.codeReputationScore || 0);
    if (score >= 35) pushDot("code", code.code, code.code, score >= 80 ? "rose" : "amber", score, code.studentName || code.assignedStudentName || "");
  });
  return { dots: dots.slice(0, 28), counts: dots.reduce((acc: any, dot: any) => { acc[dot.tone] = (acc[dot.tone] || 0) + 1; return acc; }, {}) };
}

function buildEventReplay(scopedCodes: any[], scopedAttempts: any[]) {
  const events: any[] = [];
  const add = (type: string, label: string, at: any, payload: any = {}) => {
    const time = Date.parse(String(at || payload.timestamp || payload.createdAt || "")) || 0;
    events.push({ type, label, at: at || payload.timestamp || payload.createdAt || "", time, ...payload });
  };
  try {
    dbInstance.getActivityLogs().forEach((log: any) => {
      const action = String(log.action || log.details || "");
      if (!/(حذف|إضافة|اضاف|تفعيل|إعادة|اعادة|تنظيف|شفاء|كود|رمز)/.test(action)) return;
      add("log", action, log.timestamp || log.createdAt || log.date, {
        studentId: log.studentId || "", studentName: log.studentName || "", courseCode: log.sectionCode || log.courseCode || "",
        tone: action.includes("حذف") ? "rose" : action.includes("تفعيل") ? "emerald" : action.includes("إعادة") || action.includes("اعادة") ? "violet" : "indigo",
      });
    });
  } catch {}
  scopedCodes.slice(0, 50).forEach((code: any) => {
    (Array.isArray(code.codeJourney) ? code.codeJourney : []).forEach((ev: any) => {
      const label = ev.label || ev.action || "حدث كود";
      add("code", label, ev.at || ev.timestamp || code.updatedAt || code.createdAt, {
        code: code.code, studentId: code.studentId || code.usedByStudentId || code.assignedStudentId || "", studentName: code.studentName || code.assignedStudentName || "", courseCode: joinCodeCourse(code),
        tone: String(label).includes("حذف") ? "rose" : String(label).includes("تفعيل") ? "emerald" : "indigo",
      });
    });
  });
  scopedAttempts.slice(0, 30).forEach((attempt: any) => {
    if (!String(attempt.reason || "").trim()) return;
    add("attempt", "محاولة تفعيل", attempt.timestamp || attempt.createdAt, { code: attempt.normalizedCode || attempt.code || "", studentId: attempt.studentId || "", studentName: attempt.studentName || "", courseCode: attempt.sectionCode || attempt.courseCode || "", tone: String(attempt.reason || "").includes("جهاز") ? "rose" : "amber", reason: attempt.reason || "" });
  });
  return events.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 10).map(({ time, ...rest }) => rest);
}

function maybeRunSafeDataSweep() {
  const health = computeDataHealth();
  if (!health.totalIssues) return health;
  return computeDataHealth();
}

function isRejectedActivationAttemptForReport(attempt: any): boolean {
  const status = String(attempt?.status || "").toLowerCase();
  const reason = String(attempt?.reason || "");
  if (status === "success" || status === "used" || status === "activated") return false;
  if (attempt?.success === true || attempt?.activationSucceeded === true) return false;
  // طلب اعتماد الجهاز قد يحتوي الكود الصحيح؛ لا يدخل في هذا السجل لأن هدفه
  // عرض الأكواد التي جرّبها الطالب ولم تكن هي كود التفعيل الصحيح الناجح.
  if (String(attempt?.approvalRequestType || "") === "second_hand_device") return false;
  if (/تم\s*(تفعيل|اعتماد)|نجح|success/i.test(reason)) return false;
  return Boolean(attempt?.code || attempt?.normalizedCode || reason);
}

function parseReportDateStart(value: any): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const t = new Date(`${raw}T00:00:00`).getTime();
  return Number.isFinite(t) ? t : 0;
}

function parseReportDateEnd(value: any): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const t = new Date(`${raw}T23:59:59.999`).getTime();
  return Number.isFinite(t) ? t : 0;
}

function shortServerDeviceId(attempt: any): string {
  const raw = String(attempt?.deviceToken || attempt?.deviceFingerprint || "").trim();
  if (!raw) return "";
  const digest = crypto.createHash("sha1").update(raw).digest("hex").toUpperCase();
  return `FP-${digest.slice(0, 4)}-${digest.slice(-4)}`;
}

function attemptReportOwnerMatches(attempt: any, codeRecord: any, targetEmail: string): boolean {
  const email = String(targetEmail || "").toLowerCase();
  if (!email) return false;
  const sectionCode = String(
    attempt?.targetSectionCode ||
      attempt?.sectionCode ||
      attempt?.courseCode ||
      codeRecord?.studentSection ||
      codeRecord?.sectionCode ||
      codeRecord?.courseCode ||
      "",
  ).trim();
  return (
    String(attempt?.targetTeacherEmail || "").toLowerCase() === email ||
    String(attempt?.teacherEmail || "").toLowerCase() === email ||
    (sectionCode && sectionOwnerEmail(sectionCode).toLowerCase() === email) ||
    (sectionCode && teacherOwnsCourseCode(sectionCode, email)) ||
    (codeRecord && joinCodeOwnerEmail(codeRecord) === email)
  );
}

app.get("/api/teacher/activation-attempts", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });
  }
  const isAdmin = isAdminEmail(teacherEmail);
  const scope = String(req.query.scope || "").trim().toLowerCase();
  const targetEmail = isAdmin && scope && scope !== "all" && scope !== "self"
    ? scope
    : teacherEmail;
  const start = parseReportDateStart(req.query.from);
  const end = parseReportDateEnd(req.query.to);
  const codes = dbInstance.getJoinCodes();
  const allowedRows = dbInstance.getAllowedStudents();
  const students = dbInstance.getStudents();
  const rawAttempts = dbInstance
    .getActivationAttempts()
    .filter(isRejectedActivationAttemptForReport)
    .filter((attempt: any) => {
      const at = new Date(attempt.timestamp || attempt.createdAt || 0).getTime();
      if (start && Number.isFinite(at) && at < start) return false;
      if (end && Number.isFinite(at) && at > end) return false;
      return true;
    })
    .filter((attempt: any) => {
      if (isAdmin && scope === "all") return true;
      const codeRecord = codes.find((code: any) =>
        compactJoinCode(code.code) === compactJoinCode(attempt.normalizedCode || attempt.code || ""),
      );
      return attemptReportOwnerMatches(attempt, codeRecord, targetEmail);
    });
  const keyOf = (attempt: any) => [
    normalizeStudentId(attempt.linkedStudentId || attempt.studentId || ""),
    compactJoinCode(attempt.normalizedCode || attempt.code || ""),
    String(attempt.targetSectionCode || attempt.sectionCode || attempt.courseCode || "").toLowerCase(),
  ].join("|");
  const counts = new Map<string, number>();
  rawAttempts.forEach((attempt: any) => counts.set(keyOf(attempt), (counts.get(keyOf(attempt)) || 0) + 1));
  const attempts = rawAttempts
    .slice()
    .sort(
      (a: any, b: any) =>
        (new Date(b.timestamp || b.createdAt || 0).getTime() || 0) -
        (new Date(a.timestamp || a.createdAt || 0).getTime() || 0),
    )
    .map((attempt: any) => {
      const normalizedCode = normalizeJoinCode(attempt.normalizedCode || attempt.code || "");
      const codeRecord = codes.find((code: any) =>
        compactJoinCode(code.code) === compactJoinCode(normalizedCode),
      );
      const studentId = normalizeStudentId(
        attempt.linkedStudentId || attempt.studentId || attempt.targetStudentId || "",
      );
      const student = students.find((st: any) => normalizeStudentId(st.id) === studentId);
      const sectionCode = String(
        attempt.targetSectionCode ||
          attempt.sectionCode ||
          attempt.courseCode ||
          codeRecord?.studentSection ||
          codeRecord?.sectionCode ||
          student?.sectionCode ||
          "",
      ).trim();
      const allowed = allowedRows.find((row: any) => {
        const sid = normalizeStudentId(row.idNumber || row.id || row.studentId);
        if (sid !== studentId) return false;
        if (!sectionCode) return true;
        return allowedStudentMatchesCourse(row, sid, sectionCode, sectionOwnerEmail(sectionCode));
      });
      return {
        ...attempt,
        normalizedCode,
        linkedStudentId: student?.id || allowed?.idNumber || studentId || attempt.studentId || "",
        linkedStudentName:
          student?.name || allowed?.name || attempt.studentName || attempt.targetStudentName || "",
        linkedSectionCode: sectionCode,
        linkedSectionName: courseNameFromCode(sectionCode) || sectionDisplayCode(sectionCode) || "مقرر غير محدد",
        attemptCount: counts.get(keyOf(attempt)) || 1,
        deviceShortId: shortServerDeviceId(attempt),
      };
    });
  const summary = {
    attempts: attempts.length,
    students: new Set(attempts.map((a: any) => normalizeStudentId(a.linkedStudentId || a.studentId)).filter(Boolean)).size,
    codes: new Set(attempts.map((a: any) => compactJoinCode(a.normalizedCode || a.code)).filter(Boolean)).size,
    devices: new Set(attempts.map((a: any) => a.deviceShortId).filter(Boolean)).size,
  };
  return res.json({ success: true, attempts, summary });
});

app.get("/api/teacher/code-integrity", (req, res) => {
  const teacherEmail = String(
    req.query.teacherEmail || req.headers["x-teacher-email"] || "",
  ).toLowerCase();
  const adminView = !teacherEmail || isAdminEmail(teacherEmail);
  const retired =
    typeof (dbInstance as any).getRetiredJoinCodes === "function"
      ? (dbInstance as any).getRetiredJoinCodes()
      : [];
  // لوحة الأمان تعرض الحالة التشغيلية الحالية فقط. الأكواد المؤرشفة بعد
  // التصفير تُحفظ لمنع إعادة استخدامها، لكنها لا تُحسب كأكواد حية ولا تُنتج
  // ملفات مراجعة بعد أن أصبحت خارج الدورة الحالية.
  const liveCodes = dbInstance.getJoinCodes().filter(isOperationalJoinCodeRecord);
  const lookupCodes = [
    ...liveCodes,
    ...retired.filter((code: any) => isArchivedJoinCodeRecord(code)),
  ];
  const attempts = dbInstance.getActivationAttempts();
  const scopedAttempts = attempts.filter((attempt: any) => {
    if (adminView) return true;
    return (
      sectionOwnerEmail(attempt.sectionCode).toLowerCase() === teacherEmail
    );
  });
  const scopedCodes = liveCodes.filter(
    (code: any) =>
      adminView ||
      sectionOwnerEmail(
        code.studentSection || code.sectionCode || code.courseCode,
      ).toLowerCase() === teacherEmail ||
      joinCodeOwnerEmail(code) === teacherEmail,
  );
  const scopedLookupCodes = lookupCodes.filter(
    (code: any) =>
      adminView ||
      sectionOwnerEmail(
        code.studentSection || code.sectionCode || code.courseCode,
      ).toLowerCase() === teacherEmail ||
      joinCodeOwnerEmail(code) === teacherEmail,
  );
  const suspiciousCodes = scopedCodes
    .filter(
      (code: any) =>
        Number(code.leakAttemptCount || 0) > 0 ||
        Number(code.codeReputationScore || 0) >= 40 ||
        code.activationReviewRequired ||
        code.secondStepRecommended,
    )
    .sort(
      (a: any, b: any) =>
        Number(b.codeReputationScore || b.leakAttemptCount || 0) -
        Number(a.codeReputationScore || a.leakAttemptCount || 0),
    );
  const honeyAttempts = scopedAttempts.filter(
    (a: any) => a.honeyCode || String(a.reason || "").includes("مصيدة"),
  );
  const reputationCounts = scopedCodes.reduce(
    (acc: any, code: any) => {
      const level = String(code.codeReputation || "normal");
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    },
    { normal: 0, watch: 0, suspicious: 0, danger: 0, temporarily_blocked: 0 },
  );
  const tradingAlerts = scopedCodes
    .filter(
      (code: any) =>
        Number(code.distinctFailedDevices || 0) >= 3 ||
        Number(code.distinctFailedStudents || 0) >= 2 ||
        String(code.codeReputation || "") === "danger" ||
        String(code.codeReputation || "") === "temporarily_blocked",
    )
    .sort(
      (a: any, b: any) =>
        Number(b.codeReputationScore || 0) - Number(a.codeReputationScore || 0),
    )
    .slice(0, 12);
  const batchIntelligence = buildBatchIntelligence(
    scopedCodes,
    scopedAttempts,
  ).slice(0, adminView ? 40 : 15);
  const seasonalMemory = buildSeasonalCodeMemory(scopedCodes, scopedAttempts);
  const outOfContextAlerts = buildOutOfContextCodeAlerts(
    scopedCodes,
    scopedAttempts,
  );
  const heatmap = {
    safeBatches: batchIntelligence.filter((b: any) => b.level === "آمنة")
      .length,
    watchBatches: batchIntelligence.filter(
      (b: any) => b.level === "تحتاج مراقبة",
    ).length,
    dangerBatches: batchIntelligence.filter(
      (b: any) => b.level === "عالية الخطورة",
    ).length,
    tradedCodes: tradingAlerts.length,
    guessedCodes: honeyAttempts.length,
    highRiskWindows: batchIntelligence
      .filter((b: any) => b.score >= 75)
      .slice(0, 6),
  };
  const collectiveTransferAlerts = buildCollectiveTransferAlerts(
    scopedCodes,
    scopedAttempts,
  );
  const codeHealthFunnel = buildCodeHealthFunnel(scopedCodes);
  const ipClusterAlerts = buildIpClusterAlerts(scopedCodes, scopedAttempts);
  const caseFiles = suspiciousCodes
    .slice(0, 24)
    .map((code: any) => buildCodeCaseFile(code, scopedAttempts))
    .sort((a: any, b: any) => b.reputationScore - a.reputationScore);
  const leakSources = inferLeakSources(
    scopedCodes,
    scopedAttempts,
    batchIntelligence,
    collectiveTransferAlerts,
    outOfContextAlerts,
  );
  const teacherReports = buildTeacherCodeReports({
    tradingAlerts,
    batchIntelligence,
    collectiveTransferAlerts,
    caseFiles,
    leakSources,
    outOfContextAlerts,
  });
  const fairnessSummary = scopedAttempts.reduce((acc: any, attempt: any) => {
    const label = String(attempt.fairnessLevel || "غير مصنف");
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const sessionConfidenceSummary = scopedAttempts.reduce(
    (acc: any, attempt: any) => {
      const label = String(attempt.sessionConfidenceLevel || "غير مصنف");
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    },
    {},
  );
  const secondStepQueue = suspiciousCodes
    .filter(
      (code: any) =>
        code.secondStepRecommended ||
        Number(code.codeReputationScore || 0) >= 85,
    )
    .slice(0, 12)
    .map((code: any) => ({
      code: code.code,
      batchId: resolveJoinCodeBatchId(code),
      studentId: code.studentId || code.assignedStudentId || "",
      studentName: code.studentName || code.assignedStudentName || "",
      score: Number(code.codeReputationScore || 0),
      reason:
        code.lastFailedAttemptReason ||
        "اشتباه عالٍ يستحق تفعيلًا احتياطيًا على مرحلتين",
    }));
  const enrichCodeOwner = (item: any) => {
    const normalizedCode = normalizeJoinCode(
      item.normalizedCode || item.code || item.joinCode || "",
    );
    const codeRecord = scopedLookupCodes.find(
      (code: any) =>
        normalizeJoinCode(code.code) === normalizedCode ||
        compactJoinCode(code.code) === compactJoinCode(normalizedCode),
    );
    const linkedStudentId = normalizeStudentId(
      item.studentId ||
        item.idNumber ||
        item.assignedStudentId ||
        codeRecord?.studentId ||
        codeRecord?.usedByStudentId ||
        codeRecord?.assignedStudentId,
    );
    const student = dbInstance
      .getStudents()
      .find((st: any) => normalizeStudentId(st.id) === linkedStudentId);
    const allowed = dbInstance
      .getAllowedStudents()
      .find(
        (row: any) =>
          normalizeStudentId(row.idNumber || row.id || row.studentId) ===
          linkedStudentId,
      );
    const sectionCode =
      item.sectionCode ||
      codeRecord?.studentSection ||
      codeRecord?.sectionCode ||
      student?.sectionCode ||
      allowed?.sectionCode ||
      "";
    const reason = String(
      item.reason || codeRecord?.lastFailedAttemptReason || "",
    );
    const attemptCount = Number(
      (codeRecord as any)?.leakAttemptCount || item.leakAttemptCount || 0,
    );
    const storedScore = Number(
      (codeRecord as any)?.codeReputationScore || item.codeReputationScore || 0,
    );
    const confidenceScore =
      storedScore ||
      Math.min(
        99,
        Math.max(
          15,
          (reason.includes("جهاز") ? 85 : 0) ||
            (reason.includes("كود") && reason.includes("مستخدم") ? 78 : 0) ||
            (reason.includes("مخصص") ? 72 : 0) ||
            (reason.includes("مصيدة") ? 72 : 0) ||
            (reason.includes("صيغة") ? 34 : 0) ||
            (attemptCount >= 3 ? 76 : attemptCount > 0 ? 58 : 40),
        ),
      );
    const codeRep = String(
      (codeRecord as any)?.codeReputation ||
        item.codeReputation ||
        (confidenceScore >= 90
          ? "danger"
          : confidenceScore >= 70
            ? "suspicious"
            : confidenceScore >= 40
              ? "watch"
              : "normal"),
    );
    const integrityLabel =
      (codeRecord as any)?.codeReputationLabel ||
      item.codeReputationLabel ||
      CODE_REPUTATION_LABELS[codeRep] ||
      (confidenceScore >= 75
        ? "مشتبه"
        : confidenceScore >= 50
          ? "مراقبة"
          : "طبيعي");
    const itemAttempts = scopedAttempts.filter(
      (attempt: any) =>
        compactJoinCode(attempt.normalizedCode || attempt.code || "") ===
        compactJoinCode(normalizedCode),
    );
    const fairness = item.fairnessLevel
      ? {
          level: item.fairnessLevel,
          label: item.fairnessLabel,
          score: item.fairnessScore,
        }
      : classifyStudentFairness(itemAttempts, codeRecord);
    return {
      ...item,
      normalizedCode: normalizedCode || item.normalizedCode || item.code || "",
      linkedStudentId:
        student?.id || allowed?.idNumber || linkedStudentId || "",
      linkedStudentName:
        student?.name ||
        allowed?.name ||
        item.studentName ||
        codeRecord?.studentName ||
        "",
      linkedStudentEmail: student?.email || item.studentEmail || "",
      linkedSectionCode: sectionCode,
      linkedSectionName:
        activeSections()
          .find(
            (sec: any) =>
              String(sec.code).toLowerCase() ===
              String(sectionCode).toLowerCase(),
          )?.courseName || courseNameFromCode(sectionCode) || "المقرر المحدد",
      linkedAccountLabel: [
        student?.name || allowed?.name || item.studentName || "",
        student?.id || allowed?.idNumber || linkedStudentId || "",
      ]
        .filter(Boolean)
        .join(" • "),
      confidenceScore,
      integrityLabel,
      codeReputation: codeRep,
      codeReputationLabel: integrityLabel,
      codeReputationScore: confidenceScore,
      distinctFailedDevices:
        (codeRecord as any)?.distinctFailedDevices ||
        item.distinctFailedDevices ||
        0,
      distinctFailedIps:
        (codeRecord as any)?.distinctFailedIps || item.distinctFailedIps || 0,
      distinctFailedStudents:
        (codeRecord as any)?.distinctFailedStudents ||
        item.distinctFailedStudents ||
        0,
      activationFrozenUntil:
        (codeRecord as any)?.activationFrozenUntil ||
        item.activationFrozenUntil ||
        "",
      activationReviewRequired: Boolean(
        (codeRecord as any)?.activationReviewRequired ||
        item.activationReviewRequired,
      ),
      strictLibraryMode: (codeRecord as any)?.strictLibraryMode !== false,
      batchId:
        (codeRecord as any)?.batchId ||
        item.batchId ||
        resolveJoinCodeBatchId(codeRecord || item),
      // codeJourney (≈2KB لكل محاولة × عشرات المحاولات = ~172KB) لا تُعرض في واجهة
      // الأكواد إطلاقاً (الواجهة تقرأ codeJourney من الأكواد فقط لا من المحاولات)،
      // فإرسالها هنا كان يضخّم رد code-integrity بلا فائدة ويُبطئ الجوال. أُزيلت.
      honeyCode: Boolean(item.honeyCode || reason.includes("مصيدة")),
      fairness,
      fairnessLevel: fairness.level,
      fairnessLabel: fairness.label,
      fairnessScore: fairness.score,
      silentEnforcement: item.silentEnforcement !== false,
      sessionConfidenceScore:
        item.sessionConfidenceScore ||
        (codeRecord as any)?.lastSessionConfidenceScore ||
        0,
      sessionConfidenceLevel: item.sessionConfidenceLevel || "غير مصنف",
      secondStepRecommended: Boolean(
        item.secondStepRecommended ||
        (codeRecord as any)?.secondStepRecommended ||
        confidenceScore >= 85,
      ),
      confidenceStamp: codeConfidenceStamp(confidenceScore, codeRep),
      recommendedAction: recommendCodeAction({
        score: confidenceScore,
        reason,
        fairnessLevel: fairness.level,
        sessionLevel: item.sessionConfidenceLevel || "",
        activationReviewRequired: Boolean(
          (codeRecord as any)?.activationReviewRequired ||
          item.activationReviewRequired,
        ),
      }),
    };
  };
  const realAdminView = isAdminEmail(teacherEmailFromRequest(req));
  const adminHealth = realAdminView ? maybeRunSafeDataSweep() : undefined;
  const adminCodeRadar = realAdminView ? buildCodeRadar(scopedCodes, scopedAttempts) : undefined;
  const adminSharingGraph = realAdminView ? buildSharingRingGraph(scopedAttempts, scopedCodes) : undefined;
  const adminMirasPulse = realAdminView ? buildMirasPulse(scopedCodes, scopedAttempts, adminHealth, adminCodeRadar) : undefined;
  const adminTrustMap = realAdminView ? buildTrustMap(scopedCodes, scopedAttempts, adminSharingGraph, adminCodeRadar) : undefined;
  const adminEventReplay = realAdminView ? buildEventReplay(scopedCodes, scopedAttempts) : undefined;
  return res.json({
    success: true,
    summary: {
      totalAttempts: scopedAttempts.length,
      repeatedCodes: suspiciousCodes.length,
      deviceMismatch: scopedAttempts.filter((a: any) =>
        String(a.reason || "").includes("جهاز"),
      ).length,
      oldFormat: scopedAttempts.filter((a: any) =>
        String(a.reason || "").includes("صيغة"),
      ).length,
      honeyCodes: honeyAttempts.length,
      reputationCounts,
      dangerCodes: reputationCounts.danger || 0,
      temporarilyBlocked: reputationCounts.temporarily_blocked || 0,
      tradingAlerts: tradingAlerts.length,
      strictLibraryMode: true,
      batchWatch: heatmap.watchBatches,
      batchDanger: heatmap.dangerBatches,
      caseFiles: caseFiles.length,
      collectiveTransferAlerts: collectiveTransferAlerts.length,
      secondStepRecommended: secondStepQueue.length,
      fairnessSummary,
      sessionConfidenceSummary,
      seasonalMemory: seasonalMemory.length,
      outOfContextAlerts: outOfContextAlerts.length,
      leakSources: leakSources.length,
      teacherReports: teacherReports.length,
      ipClusterAlerts: ipClusterAlerts.length,
    },
    codeHealthFunnel,
    ipClusterAlerts,
    sharingGraph: isAdminEmail(teacherEmailFromRequest(req)) ? adminSharingGraph : undefined,
    codeRadar: isAdminEmail(teacherEmailFromRequest(req)) ? adminCodeRadar : undefined,
    mirasPulse: isAdminEmail(teacherEmailFromRequest(req)) ? adminMirasPulse : undefined,
    trustMap: isAdminEmail(teacherEmailFromRequest(req)) ? adminTrustMap : undefined,
    eventReplay: isAdminEmail(teacherEmailFromRequest(req)) ? adminEventReplay : undefined,
    attempts: scopedAttempts.slice(0, 120).map(enrichCodeOwner),
    suspiciousCodes: suspiciousCodes.slice(0, 80).map(enrichCodeOwner),
    // honeyAttempts (≈480KB) لا تقرأها الواجهة إطلاقاً (يُستخدم العدّاد honeyCodes
    // فقط أعلاه)، فإرسال تفاصيلها كان يضخّم الرد بلا فائدة. نرسل مصفوفة فارغة.
    honeyAttempts: [],
    tradingAlerts: tradingAlerts.map(enrichCodeOwner),
    batchIntelligence,
    heatmap,
    caseFiles,
    collectiveTransferAlerts,
    secondStepQueue,
    seasonalMemory,
    outOfContextAlerts,
    leakSources,
    teacherReports,
    fairnessSummary,
    sessionConfidenceSummary,
    // صحة البيانات والشفاء الذاتي — مربوطة بجلسة السوبر أدمن الحقيقية (لا
    // بمعامل قابل للانتحال)، فلا تظهر لغير السوبر أدمن مهما كان معامل الاستعلام.
    dataHealth: isAdminEmail(teacherEmailFromRequest(req)) ? adminHealth : undefined,
  });
});

const usedRollCallScans = new Set<string>();
function rollCallSecret(): string {
  return String(process.env.MIRAS_ROLLCALL_QR_SECRET || process.env.MIRAS_SESSION_SECRET || MIRAS_SESSION_SECRET || "").trim();
}
function signRollCallPayload(payload: any) {
  return crypto.createHmac("sha256", rollCallSecret()).update(stableLedgerString(payload)).digest("hex");
}
function encodeRollCallToken(payload: any) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signRollCallPayload(payload);
  return `${body}.${sig}`;
}
function decodeRollCallToken(token: any) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return { ok: false, error: "bad_format" } as any;
  let payload: any;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, error: "bad_json" } as any; }
  const expected = signRollCallPayload(payload);
  const ok = expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!ok) return { ok: false, error: "bad_signature" } as any;
  const now = Date.now();
  if (Math.abs(now - Number(payload.iat || 0)) > 20000 || Number(payload.exp || 0) < now) return { ok: false, error: "expired" } as any;
  return { ok: true, payload } as any;
}

app.post("/api/teacher/rollcall-qr", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const sectionCode = String(req.body?.sectionCode || req.body?.courseCode || "").trim();
  if (!teacherEmail || !sectionCode) return res.status(400).json({ error: "البيانات غير مكتملة." });
  if (!isAdminEmail(teacherEmail) && !teacherOwnsCourseCode(sectionCode, teacherEmail)) {
    return res.status(403).json({ error: "لا تملك صلاحية إصدار QR لهذه الشعبة." });
  }
  const iat = Date.now();
  const payload = {
    typ: "miras-rollcall-v1",
    sectionCode,
    teacherEmail: teacherEmail.toLowerCase(),
    iat,
    exp: iat + 15000,
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  return res.json({ success: true, token: encodeRollCallToken(payload), expiresAt: new Date(payload.exp).toISOString(), refreshAfterMs: 10000 });
});

app.post("/api/students/rollcall-qr/activate", (req, res) => {
  const decoded = decodeRollCallToken(req.body?.token || req.body?.qrToken || "");
  if (!decoded.ok) return res.status(400).json({ error: "انتهت صلاحية رمز الحضور. اطلب من الأستاذ تحديث الشاشة." });
  const payload = decoded.payload;
  const studentId = normalizeStudentId(req.body?.studentId || req.body?.idNumber || req.body?.id || "");
  if (!studentId) return res.status(400).json({ error: "الرقم الجامعي مطلوب." });
  const scanKey = `${payload.nonce}:${studentId}`;
  if (usedRollCallScans.has(scanKey)) return res.status(409).json({ error: "تم استخدام مسح الحضور لهذا الطالب بالفعل." });
  const rosterMatch = dbInstance.getAllowedStudents().find((row: any) =>
    allowedStudentMatchesCourse(row, studentId, payload.sectionCode, payload.teacherEmail),
  );
  if (!rosterMatch) return res.status(403).json({ error: "الطالب غير موجود في كشف هذه الشعبة." });
  let code = dbInstance.getJoinCodes().find((jc: any) =>
    String(jc.status || "active").toLowerCase() === "active" &&
    joinCodeWindowStatus(jc).ok &&
    !isJoinCodeTemporarilyFrozen(jc) &&
    joinCodeOwnerEmail(jc) === String(payload.teacherEmail).toLowerCase() &&
    courseCodeMatchesForTeacher(jc.sectionCode || jc.courseCode || jc.studentSection, payload.sectionCode, payload.teacherEmail) &&
    (joinCodeAssignedToStudent(jc, { id: studentId } as any) || !(jc as any).assignedStudentId),
  );
  if (!code) {
    const now = new Date().toISOString();
    const generated = attachJoinCodeSignature({
      code: makeJoinCode("LAB", "", issuedJoinCodeCompacts()),
      semester: String(req.body?.semester || "الفصل الحالي"),
      sectionCode: payload.sectionCode,
      courseCode: payload.sectionCode,
      studentSection: payload.sectionCode,
      status: "active",
      ownerEmail: payload.teacherEmail,
      createdByEmail: payload.teacherEmail,
      createdAt: now,
      assignedStudentId: studentId,
      assignedStudentName: rosterMatch.name || studentId,
      isFreeCode: true,
      strictLibraryMode: STRICT_LIBRARY_MODE_DEFAULT,
      batchId: `RollCall-${new Date().toISOString().slice(0,10)}-${payload.sectionCode}`,
      codeJourney: createCodeJourneyEvent("QR حضور دوّار", payload.teacherEmail, { sectionCode: payload.sectionCode, studentId }),
    } as any) as JoinCode;
    dbInstance.addJoinCode(generated);
    code = generated;
  }
  usedRollCallScans.add(scanKey);
  const replayTimer = setTimeout(() => usedRollCallScans.delete(scanKey), 30000);
  (replayTimer as any).unref?.();
  (req as any).body = { ...(req.body || {}), courseCode: payload.sectionCode, sectionCode: payload.sectionCode, otp: code.code, code: code.code, joinCode: code.code };
  return processStudentCourseActivation(req, res, studentId, code.code, {
    name: req.body?.name || rosterMatch.name || studentId,
    email: req.body?.email || `${studentId}@paaet.edu.kw`,
    semester: req.body?.semester,
    password: req.body?.password,
  });
});

// زر الشفاء الذاتي بنقرة واحدة — للسوبر أدمن فقط. يُصلح أشباح البيانات ويعيد
// الأكواد اليتيمة لحالة سليمة، ثم يُرجع الحالة المحدّثة لتحديث اللوحة فورًا.
app.post("/api/teacher/data-heal", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!isAdminEmail(teacherEmail)) {
    return res.status(403).json({ error: "هذا الإجراء متاح للسوبر أدمن فقط." });
  }
  const before = computeDataHealth();
  const healed = healDataIssues(teacherEmail);
  dbInstance.addActivityLog({
    action: "صيانة وشفاء البيانات",
    details: `شفاء ذاتي: طلاب=${healed.healedStudents}، أكواد مؤرشفة=${healed.archivedCodes}، أكواد محرّرة=${healed.relinkedCodes}، صفوف كشف=${healed.removedRoster}`,
    teacherEmail,
    actorEmail: teacherEmail,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة السوبر أدمن",
    browser: "مركز الذكاء",
    isViolationWarning: false,
  });
  return res.json({ success: true, before, healed, dataHealth: computeDataHealth() });
});

// Dynamic Mock device lock validation helper

function isAdminEmail(email?: string): boolean {
  const norm = String(email || "").toLowerCase();
  return norm.includes("ah.alfailakawi") || norm.includes("ahmad.alfailakawi");
}

function extractEmailFromSectionCode(code?: string): string {
  const raw = String(code || "").trim().toLowerCase();
  if (raw.indexOf("@") === -1) return "";
  // أكواد المقررات المربوطة بالمعلم تُخزَّن بصيغة "رقم-بريد" أو "بريد-رقم".
  // التقاط البريد بتعبير نمطي فضفاض كان يبتلع الرقمَ مع البريد (الجزء المحلي
  // يسمح بالأرقام والشرطات)، فيُرجع "111-ah@x.com" بدل "ah@x.com" ويُفسد كل
  // عمليات تطبيع الكود والمطابقة. لذا نقسّم على الشرطات ونأخذ الجزء الذي يكوّن
  // بريداً صالحاً بمفرده (الحالة الشائعة لبُرد المؤسسة بلا شرطات داخلية)، مع
  // دعم البُرد ذات الشرطات الداخلية عبر دمج الأجزاء من أول جزء يحوي '@'.
  const emailRe = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  const parts = raw.split("-").map((p) => p.trim()).filter(Boolean);
  const exact = parts.find((p) => emailRe.test(p));
  if (exact) return exact;
  const atIdx = parts.findIndex((p) => p.includes("@"));
  if (atIdx !== -1) {
    for (let end = parts.length; end > atIdx; end--) {
      const candidate = parts.slice(atIdx, end).join("-");
      if (emailRe.test(candidate)) return candidate;
    }
    return parts.slice(atIdx).join("-");
  }
  const loose = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return loose ? loose[0] : "";
}

function sectionOwnerEmail(code?: string): string {
  const raw = String(code || "").trim();
  const exactSection = activeSections().find((sec) => String(sec.code).toLowerCase() === raw.toLowerCase());
  if (exactSection?.ownerEmail) return exactSection.ownerEmail.toLowerCase();

  const embeddedOwner = extractEmailFromSectionCode(raw);
  if (embeddedOwner) return embeddedOwner;

  const displaySection = activeSections()
    .find(
      (sec) =>
        sectionDisplayCode(sec.code).toLowerCase() ===
        sectionDisplayCode(raw).toLowerCase(),
    );
  if (displaySection?.ownerEmail) return displaySection.ownerEmail.toLowerCase();

  const c = raw.toUpperCase();
  if (c === "TECH-A1" || c === "TECH-B2") return "ada.alenezi@paaet.edu.kw";
  return "ah.alfailakawi@paaet.edu.kw";
}

function sectionDisplayCode(code?: string): string {
  const value = String(code || "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (upper === "TECH-A1" || upper === "TECH-B2") return upper;

  // Legacy safety: older data may contain the teacher email either as a suffix
  // (555-teacher@email) or as a prefix (teacher@email-555).  The UI and all
  // duplicate checks must show/compare only the real course number, not the
  // embedded owner email.
  const embeddedEmail = extractEmailFromSectionCode(value);
  if (embeddedEmail) {
    const cleaned = value
      .replace(new RegExp(embeddedEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
      .replace(/^-+|-+$/g, "")
      .replace(/--+/g, "-")
      .trim();
    if (cleaned) return cleaned.toUpperCase();
  }
  return upper;
}

function buildTeacherScopedSectionCode(displayCode: any, teacherEmail: string): string {
  const displayOnly = sectionDisplayCode(String(displayCode || "").trim());
  const normalizedCode = String(displayOnly || "").trim().toUpperCase();
  if (!normalizedCode) return "";
  if (normalizedCode === "TECH-A1" || normalizedCode === "TECH-B2") return normalizedCode;
  return `${normalizedCode}-${String(teacherEmail || "").trim().toLowerCase()}`;
}

function sectionCodeEquivalent(a: any, b: any): boolean {
  const aa = String(a || "").trim().toLowerCase();
  const bb = String(b || "").trim().toLowerCase();
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const aDisplay = sectionDisplayCode(aa).toLowerCase();
  const bDisplay = sectionDisplayCode(bb).toLowerCase();
  if (!aDisplay || !bDisplay || aDisplay !== bDisplay) return false;
  const aOwner = extractEmailFromSectionCode(aa);
  const bOwner = extractEmailFromSectionCode(bb);
  // If both values are teacher-scoped, owner must match.  If one value is old
  // legacy display-only data, treat it as the same course number inside the
  // caller's teacher context so old rows do not disappear after course edits.
  if (aOwner && bOwner) return aOwner === bOwner;
  return true;
}

function courseCodeMatchesForTeacher(a: any, b: any, teacherEmail?: any): boolean {
  const aa = String(a || "").trim();
  const bb = String(b || "").trim();
  if (!aa || !bb) return false;
  if (!sectionCodeEquivalent(aa, bb)) return false;
  const owner = String(teacherEmail || "").trim().toLowerCase();
  if (!owner) return true;
  const aOwner = extractEmailFromSectionCode(aa) || sectionForCourseCode(aa, owner)?.ownerEmail || "";
  const bOwner = extractEmailFromSectionCode(bb) || sectionForCourseCode(bb, owner)?.ownerEmail || "";
  return (!aOwner || String(aOwner).toLowerCase() === owner) && (!bOwner || String(bOwner).toLowerCase() === owner);
}

function allowedStudentMatchesCourse(row: any, studentId: any, courseCode: any, teacherEmail?: any): boolean {
  if (normalizeStudentId(row?.idNumber || row?.id || row?.studentId) !== normalizeStudentId(studentId)) return false;
  const rowCourse = row?.sectionCode || row?.studentSection || row?.courseCode;
  if (!rowCourse) return false;
  // مالك الصف: صفوف الكشف المرفوعة من الواجهة لا تحمل حقل teacherEmail صريحاً،
  // بل يكون المالك مضمَّناً في كود الشعبة (مثل "777-ahmad@..."). لذا نشتق المالك
  // من الكود عند غياب الحقل، وإلا فُشِلت كل المطابقات للكشوف المرفوعة عبر الواجهة
  // (يُرفض الطالب من التفعيل وإصدار الكود رغم وجوده في الكشف).
  if (teacherEmail) {
    const wanted = String(teacherEmail).trim().toLowerCase();
    const rowOwner = String(row?.teacherEmail || "").trim().toLowerCase() ||
      extractEmailFromSectionCode(rowCourse) ||
      sectionOwnerEmail(rowCourse);
    if (rowOwner && rowOwner !== wanted) return false;
  }
  if (!courseCode || String(courseCode).toLowerCase() === "all") return true;
  return courseCodeMatchesForTeacher(rowCourse, courseCode, teacherEmail);
}

function studentOwnsOrMayUseJoinCode(code: any, student: any): boolean {
  const sid = normalizeStudentId(student?.id);
  if (!sid) return false;
  const owners = [
    code?.assignedStudentId,
    code?.studentId,
    code?.usedByStudentId,
  ].map((v: any) => normalizeStudentId(v)).filter(Boolean);
  return owners.length === 0 || owners.includes(sid);
}

function joinCodeAssignedToStudent(code: any, student: any): boolean {
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid) return false;
  return [code?.assignedStudentId, code?.studentId, code?.usedByStudentId]
    .map((v: any) => normalizeStudentId(v))
    .filter(Boolean)
    .includes(sid);
}

function courseNameFromCode(courseCode: any): string {
  const raw = String(courseCode || "").trim();
  const sec: any = sectionForCourseCode(raw) || resolveSectionForStudentGate(raw);
  return String(sec?.courseName || sec?.name || sectionDisplayCode(raw) || raw || "المقرر").trim();
}

function isGenericJoinCourseCode(value: any): boolean {
  const raw = String(value || "").trim().toLowerCase();
  return !raw || raw === "all";
}

function isUsefulCourseNameForDisplay(name: any, code: any): boolean {
  const text = String(name || "").trim();
  if (!text || text.toLowerCase() === "all" || /غير\s*محم/i.test(text)) return false;
  const displayCode = sectionDisplayCode(String(code || "").trim());
  if (displayCode && text.toLowerCase() === displayCode.toLowerCase()) return false;
  return true;
}

function resolveJoinCodeCourseForDisplay(jc: any): { courseCode: string; courseName: string } {
  const candidates: { code: string; name?: string }[] = [];
  const addCandidate = (codeValue: any, nameValue?: any) => {
    const code = String(codeValue || "").trim();
    if (isGenericJoinCourseCode(code)) return;
    if (candidates.some((item) => sectionCodeEquivalent(item.code, code))) return;
    candidates.push({ code, name: String(nameValue || "").trim() });
  };

  addCandidate(jc?.resolvedCourseCode, jc?.resolvedCourseName);
  addCandidate(jc?.activatedCourseCode, jc?.activatedCourseName);
  addCandidate(jc?.sectionCode, jc?.courseName || jc?.sectionName);
  addCandidate(jc?.studentSection, jc?.courseName || jc?.sectionName);
  addCandidate(jc?.courseCode, jc?.courseName || jc?.sectionName);

  const linkedStudentId = normalizeStudentId(
    jc?.studentId || jc?.usedByStudentId || jc?.assignedStudentId || "",
  );
  const linkedCode = compactJoinCode(jc?.code || "");
  let linkedStudent: any = null;
  if (linkedStudentId || linkedCode) {
    linkedStudent = dbInstance.getStudents().find((student: any) => {
      const sameStudent =
        linkedStudentId &&
        normalizeStudentId(student?.id || student?.idNumber || student?.studentId) === linkedStudentId;
      const sameActivationCode =
        linkedCode && compactJoinCode(student?.activationCode || "") === linkedCode;
      return sameStudent || sameActivationCode;
    });
  }

  if (linkedStudent) {
    (Array.isArray(linkedStudent.enrollments) ? linkedStudent.enrollments : []).forEach(
      (entry: any) =>
        addCandidate(
          entry?.courseCode || entry?.sectionCode || entry?.studentSection,
          entry?.courseName || entry?.sectionName || entry?.title,
        ),
    );
    (Array.isArray(linkedStudent.activatedCourseCodes)
      ? linkedStudent.activatedCourseCodes
      : []
    ).forEach((code: any) => addCandidate(code));
    addCandidate(linkedStudent.studentSection, linkedStudent.courseName);
    addCandidate(linkedStudent.sectionCode, linkedStudent.courseName);
  }

  if (linkedStudentId) {
    dbInstance.getAllowedStudents().forEach((row: any) => {
      const rowId = normalizeStudentId(row?.idNumber || row?.id || row?.studentId);
      if (rowId !== linkedStudentId) return;
      addCandidate(
        row?.sectionCode || row?.studentSection || row?.courseCode,
        row?.courseName || row?.sectionName || row?.subjectName,
      );
    });
  }

  let firstCourseCode = "";
  for (const item of candidates) {
    const section = sectionForCourseCode(item.code) || resolveSectionForStudentGate(item.code);
    const resolvedCode = String(section?.code || item.code || "").trim();
    if (!firstCourseCode) firstCourseCode = resolvedCode;
    const resolvedName = String(
      item.name || section?.courseName || section?.name || courseNameFromCode(resolvedCode),
    ).trim();
    if (isUsefulCourseNameForDisplay(resolvedName, resolvedCode)) {
      return { courseCode: resolvedCode, courseName: resolvedName };
    }
  }

  return { courseCode: firstCourseCode, courseName: "" };
}

function escapeRegExpLiteral(value: any): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicTeacherNameForEmail(email: any): string {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return "الدكتور";
  const cleanName = (name: any) => {
    const text = String(name || "").trim();
    return text && !text.includes("@") ? text : "";
  };
  const teacher = dbInstance
    .getTeachers()
    .find(
      (t: any) =>
        String(t.email || "").toLowerCase() === normalized ||
        String(t.id || "").toLowerCase() === normalized,
    );
  const teacherName = cleanName(teacher?.name);
  if (teacherName) return teacherName;
  const section: any = dbInstance
    .getSections()
    .find((sec: any) =>
      [
        sec?.ownerEmail,
        sec?.teacherEmail,
        sec?.createdByEmail,
        extractEmailFromSectionCode(sec?.code),
      ]
        .map((value: any) => String(value || "").toLowerCase())
        .includes(normalized),
    );
  const sectionName = cleanName(
    section?.teacherName || section?.ownerName || section?.instructorName,
  );
  if (sectionName) return sectionName;
  if (normalized.includes("ada.alenezi")) return "د. عبدالعزيز دخيل العنزي";
  if (
    normalized.includes("ah.alfailakawi") ||
    normalized.includes("ahmad.alfailakawi") ||
    normalized.includes("dr.ahmad.alfailakawi")
  )
    return "د. أحمد حسين الفيلكاوي";
  return "الدكتور";
}

function publicCourseNameForMessage(courseCode: any): string {
  const raw = String(courseCode || "").trim();
  if (!raw) return "المقرر";
  const label = courseNameFromCode(raw);
  const display = sectionDisplayCode(raw);
  const cleanLabel = String(label || "").trim();
  if (
    !cleanLabel ||
    cleanLabel.includes("@") ||
    (display && cleanLabel.toLowerCase() === display.toLowerCase()) ||
    /^[A-Z0-9_-]+$/i.test(cleanLabel)
  )
    return "المقرر";
  return cleanLabel;
}

function replaceStandalonePublicToken(source: string, token: any, label: string): string {
  const raw = String(token || "").trim();
  if (!raw || !label) return source;
  const boundary = "[^\\p{L}\\p{N}@._%+-]";
  const escaped = escapeRegExpLiteral(raw);
  return source.replace(
    new RegExp(`(^|${boundary})${escaped}(?=$|${boundary})`, "giu"),
    (_match, prefix) => `${prefix}${label}`,
  );
}

function replaceCourseContextPublicToken(source: string, token: any, label: string): string {
  const raw = String(token || "").trim();
  if (!raw || !label) return source;
  const courseWord =
    "(?:مقرر|المقرر|لمقرر|للمقرر|شعبة|الشعبة|لشعبة|للشعبة|كورس|course|section)";
  const escaped = escapeRegExpLiteral(raw);
  return source.replace(
    new RegExp(
      `(${courseWord}\\s*(?:[:#\\-–—]\\s*)?)${escaped}(?=$|[^\\p{L}\\p{N}@._%+-])`,
      "giu",
    ),
    (_match, prefix) => `${prefix}${label}`,
  );
}

function sanitizePublicMessageText(value: any): string {
  let text = String(value || "");
  if (!text) return "";
  const replaceCourseToken = (token: string) => publicCourseNameForMessage(token);
  text = text.replace(
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}-[A-Za-z0-9_-]+/gi,
    replaceCourseToken,
  );
  text = text.replace(
    /[A-Za-z0-9_-]+-[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    replaceCourseToken,
  );
  const seen = new Set<string>();
  dbInstance
    .getSections()
    .map((sec: any) => ({
      code: String(sec?.code || "").trim(),
      display: sectionDisplayCode(sec?.code),
      label: publicCourseNameForMessage(sec?.code),
    }))
    .filter((ref) => ref.code || ref.display)
    .sort((a, b) => String(b.code || b.display).length - String(a.code || a.display).length)
    .forEach((ref) => {
      [ref.code, ref.display]
        .map((token) => String(token || "").trim())
        .filter(Boolean)
        .forEach((token) => {
          const key = `${token.toLowerCase()}::${ref.label}`;
          if (seen.has(key)) return;
          seen.add(key);
          const scopedOrNamed =
            token.includes("@") || (/[A-Za-z]/.test(token) && /[-_]/.test(token));
          text = scopedOrNamed
            ? replaceStandalonePublicToken(text, token, ref.label)
            : replaceCourseContextPublicToken(text, token, ref.label);
        });
    });
  text = text.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (email) =>
    publicTeacherNameForEmail(email),
  );
  return text.replace(/\s{2,}/g, " ").trim();
}

function sanitizeNotificationForResponse(item: any) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    title: sanitizePublicMessageText(item.title || "مِراس") || "مِراس",
    body:
      sanitizePublicMessageText(item.body || item.message || "لديك تنبيه جديد.") ||
      "لديك تنبيه جديد.",
  };
}

function deletedTeacherCourseShadowMatches(section: any, finalCode: string, teacherEmail: string): boolean {
  const deleted = Boolean(section?.deletedAt || section?.isDeleted || section?.archivedAt || section?.retiredAt);
  if (!deleted) return false;
  const owner = String(section?.ownerEmail || sectionOwnerEmail(section?.code)).toLowerCase();
  return owner === String(teacherEmail || "").toLowerCase() && sectionCodeEquivalent(section?.code, finalCode);
}

function teacherOwnsCourseCode(courseCode: any, teacherEmail: string): boolean {
  const normalizedTeacher = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(courseCode || "").trim();
  if (!normalizedTeacher || !raw) return false;
  const embeddedOwner = extractEmailFromSectionCode(raw);
  if (embeddedOwner) return embeddedOwner === normalizedTeacher;
  return activeSections().some((sec: any) => {
    const owner = String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase();
    return owner === normalizedTeacher && sectionCodeEquivalent(sec.code, raw);
  });
}

function resolveTeacherScopedCourseCode(courseCode: any, teacherEmail: string): string {
  const normalizedTeacher = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(courseCode || "").trim();
  if (!raw) return "";
  const exact = activeSections().find((sec: any) =>
    String(sec.code || "").toLowerCase() === raw.toLowerCase(),
  );
  if (exact?.code && (!normalizedTeacher || String(exact.ownerEmail || "").toLowerCase() === normalizedTeacher)) {
    return String(exact.code);
  }
  const display = sectionDisplayCode(raw).toLowerCase();
  const owned = activeSections().find((sec: any) => {
    const owner = String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase();
    return owner === normalizedTeacher && sectionDisplayCode(sec.code).toLowerCase() === display;
  });
  if (owned?.code) return String(owned.code);
  const embeddedOwner = extractEmailFromSectionCode(raw);
  if (embeddedOwner) return raw;
  return normalizedTeacher ? buildTeacherScopedSectionCode(raw, normalizedTeacher) : raw;
}

function sectionForCourseCode(courseCode: any, teacherEmail?: string): any {
  const raw = String(courseCode || "").trim();
  if (!raw) return null;
  const exact = activeSections().find((sec: any) =>
    String(sec.code || "").toLowerCase() === raw.toLowerCase(),
  );
  if (exact) return exact;
  const owner = String(teacherEmail || extractEmailFromSectionCode(raw) || "").toLowerCase();
  const display = sectionDisplayCode(raw).toLowerCase();
  return activeSections().find((sec: any) => {
    if (sectionDisplayCode(sec.code).toLowerCase() !== display) return false;
    if (!owner) return true;
    return String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() === owner;
  }) || null;
}

function resolveJoinCodeCreationTarget(
  requestedCourseCode: any,
  teacherEmail: string,
): { section?: any; code: string; ownerEmail: string; error?: string } {
  const requester = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(normalizeArabicIndicDigits(String(requestedCourseCode || "")) || "")
    .trim();
  if (!raw || raw.toLowerCase() === "all") {
    return {
      code: "",
      ownerEmail: "",
      error: "اختر مقرراً محدداً قبل توليد الرمز. لا يمكن إصدار رمز عام بلا مقرر.",
    };
  }

  const exact = activeSections().find(
    (sec: any) => String(sec.code || "").toLowerCase() === raw.toLowerCase(),
  );
  if (exact) {
    const ownerEmail = String(exact.ownerEmail || sectionOwnerEmail(exact.code)).toLowerCase();
    if (!isAdminEmail(requester) && ownerEmail !== requester) {
      return {
        code: "",
        ownerEmail: "",
        error: "لا يمكن إصدار رموز لشعبة يملكها أستاذ آخر.",
      };
    }
    return { section: exact, code: String(exact.code), ownerEmail };
  }

  const display = sectionDisplayCode(raw).toLowerCase();
  const matches = activeSections().filter(
    (sec: any) => sectionDisplayCode(sec.code).toLowerCase() === display,
  );
  const allowedMatches = isAdminEmail(requester)
    ? matches
    : matches.filter(
        (sec: any) =>
          String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() ===
          requester,
      );

  if (allowedMatches.length === 1) {
    const section = allowedMatches[0];
    const ownerEmail = String(section.ownerEmail || sectionOwnerEmail(section.code)).toLowerCase();
    return { section, code: String(section.code), ownerEmail };
  }

  if (allowedMatches.length > 1) {
    return {
      code: "",
      ownerEmail: "",
      error:
        "رقم المقرر موجود عند أكثر من أستاذ. اختر المقرر من القائمة المحددة بدلاً من الرقم العام.",
    };
  }

  const scoped = resolveTeacherScopedCourseCode(raw, requester);
  const scopedSection = sectionForCourseCode(scoped, requester);
  if (scopedSection) {
    const ownerEmail = String(
      scopedSection.ownerEmail || sectionOwnerEmail(scopedSection.code),
    ).toLowerCase();
    return { section: scopedSection, code: String(scopedSection.code), ownerEmail };
  }

  return {
    code: "",
    ownerEmail: "",
    error: "المقرر المحدد غير موجود أو غير متاح لإصدار رموز دخول.",
  };
}

function getTeacherOwnedEquivalentSections(courseCode: any, teacherEmail: any): any[] {
  const ownerKey = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(courseCode || "").trim();
  if (!ownerKey || !raw) return [];
  const display = sectionDisplayCode(raw).toLowerCase();
  return activeSections().filter((sec: any) => {
    const secOwner = String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase();
    if (secOwner !== ownerKey) return false;
    return (
      String(sec.code || "").toLowerCase() === raw.toLowerCase() ||
      sectionCodeEquivalent(sec.code, raw) ||
      (!!display && sectionDisplayCode(sec.code).toLowerCase() === display)
    );
  });
}

function resolveActivationCourseForStudent(foundCode: any, student: any, teacherEmail: any): string {
  const ownerKey = String(teacherEmail || joinCodeOwnerEmail(foundCode) || "").trim().toLowerCase();
  const adminOwnedGeneralCode =
    isAdminEmail(ownerKey) &&
    [foundCode?.sectionCode, foundCode?.studentSection, foundCode?.courseCode]
      .map((value: any) => String(value || "").trim().toLowerCase())
      .every((value: string) => !value || value === "all");
  const candidates: any[] = [
    foundCode?.sectionCode,
    foundCode?.studentSection,
    foundCode?.courseCode,
  ];
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  const addCandidate = (value: any) => {
    const code = String(value || "").trim();
    if (code && code.toLowerCase() !== "all" && !candidates.some((c) => sectionCodeEquivalent(c, code))) candidates.push(code);
  };
  try {
    dbInstance.getAllowedStudents().forEach((row: any) => {
      if (normalizeStudentId(row?.idNumber || row?.id || row?.studentId) !== sid) return;
      const rowCourse = row?.sectionCode || row?.studentSection || row?.courseCode;
      if (!rowCourse) return;
      const rowOwner = sectionOwnerEmail(rowCourse);
      if (ownerKey && rowOwner && rowOwner !== ownerKey && !isAdminEmail(ownerKey)) return;
      addCandidate(rowCourse);
    });
  } catch {}
  if (adminOwnedGeneralCode) {
    const rosterCourses = dbInstance
      .getAllowedStudents()
      .filter(
        (row: any) =>
          normalizeStudentId(row?.idNumber || row?.id || row?.studentId) === sid,
      )
      .map((row: any) => String(row?.sectionCode || row?.studentSection || row?.courseCode || "").trim())
      .filter(Boolean)
      .filter((code: string, index: number, arr: string[]) =>
        arr.findIndex((other) => sectionCodeEquivalent(other, code)) === index,
      );
    if (rosterCourses.length === 1) {
      const only = rosterCourses[0];
      return String(sectionForCourseCode(only)?.code || only);
    }
    return "";
  }
  for (const raw of candidates) {
    const code = String(raw || "").trim();
    if (!code || code.toLowerCase() === "all") continue;
    const section = sectionForCourseCode(code, ownerKey);
    if (section?.code) return String(section.code);
    const scoped = resolveTeacherScopedCourseCode(code, ownerKey);
    const scopedSection = sectionForCourseCode(scoped, ownerKey);
    if (scopedSection?.code) return String(scopedSection.code);
    if (scoped) return scoped;
  }
  return "";
}

function activationCourseCodeOrFallback(foundCode: any, student: any, teacherEmail: any): string {
  const resolved = resolveActivationCourseForStudent(foundCode, student, teacherEmail);
  if (resolved) return resolved;
  return String(
    foundCode?.sectionCode ||
      foundCode?.studentSection ||
      foundCode?.courseCode ||
      student?.sectionCode ||
      "",
  ).trim();
}

function studentIsInTeacherCourseRoster(student: any, courseCode: any, teacherEmail: any): boolean {
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid) return false;
  return dbInstance.getAllowedStudents().some((row: any) =>
    allowedStudentMatchesCourse(row, sid, courseCode, teacherEmail),
  );
}

function migrateTeacherCourseCodeReferences(oldCode: string, newCode: string) {
  const from = String(oldCode || "").trim();
  const to = String(newCode || "").trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
  const fromDisplay = sectionDisplayCode(from).toLowerCase();
  const fromOwner = extractEmailFromSectionCode(from) || sectionOwnerEmail(from);
  const same = (value: any, row?: any) => {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (sectionCodeEquivalent(raw, from)) {
      const owner = extractEmailFromSectionCode(raw);
      if (owner && fromOwner && owner !== fromOwner) return false;
      return true;
    }
    if (sectionDisplayCode(raw).toLowerCase() !== fromDisplay) return false;
    const rowOwner = String(row?.ownerEmail || row?.teacherEmail || row?.createdByEmail || row?.actorEmail || "").toLowerCase();
    return !rowOwner || rowOwner === String(fromOwner || "").toLowerCase();
  };
  const patchDirectCourseFields = (row: any) => {
    if (!row || typeof row !== "object") return;
    ["sectionCode", "courseCode", "studentSection"].forEach((key) => {
      if (same(row[key], row)) row[key] = to;
    });
    if (row.data && typeof row.data === "object") {
      ["sectionCode", "courseCode", "studentSection"].forEach((key) => {
        if (same(row.data[key], row)) row.data[key] = to;
      });
    }
  };

  dbInstance.getStudents().forEach((student: any) => {
    patchDirectCourseFields(student);
    // activatedCourseCodes مصفوفة نصوص (لا كائنات) فلا يطالها patchDirectCourseFields؛
    // نهاجر الكود القديم إلى الجديد حتى لا يبقى ككود يتيم بلا قسم بعد تغيير الرقم.
    if (Array.isArray(student.activatedCourseCodes)) {
      student.activatedCourseCodes = student.activatedCourseCodes.map((c: any) =>
        same(c) ? to : c,
      );
    }
    if (Array.isArray(student.enrollments)) {
      student.enrollments.forEach((entry: any) => patchDirectCourseFields(entry));
    }
    if (Array.isArray(student.courseEnrollments)) {
      student.courseEnrollments.forEach((entry: any) => patchDirectCourseFields(entry));
    }
    if (Array.isArray(student.lockedEnrollments)) {
      student.lockedEnrollments.forEach((entry: any) => patchDirectCourseFields(entry));
    }
    if (Array.isArray(student.suspendedEnrollments)) {
      student.suspendedEnrollments.forEach((entry: any) => patchDirectCourseFields(entry));
    }
  });

  [
    dbInstance.getAllowedStudents(),
    dbInstance.getJoinCodes(),
    dbInstance.getRetiredJoinCodes(),
    dbInstance.getQuestionBank(),
    dbInstance.getExercises(),
    dbInstance.getExerciseSubmissions(),
    dbInstance.getPersonalizedProjects(),
    dbInstance.getQuizSubmissions(),
    dbInstance.getTeacherExams(),
    dbInstance.getTeacherProjects(),
    dbInstance.getTeacherSubmissions(),
    dbInstance.getActivityLogs(),
    dbInstance.getNotificationTokens(),
    dbInstance.getPasswordResetRequests(),
    dbInstance.getSebAttempts(),
    dbInstance.getInAppNotifications(),
  ].forEach((rows: any) => {
    if (Array.isArray(rows)) rows.forEach((row: any) => patchDirectCourseFields(row));
  });

  dbInstance.persist();
}

function teacherEmailFromRequest(req: express.Request): string {
  const verified = verifiedTeacherEmailFromSession(req);
  if (verified) return verified;
  return "";
}

function legacyTeacherEmailFromRequest(req: express.Request): string {
  return String(
    req.body?.teacherEmail ||
      req.query.teacherEmail ||
      req.headers["x-teacher-email"] ||
      "",
  )
    .trim()
    .toLowerCase();
}

function joinCodeOwnerEmail(code: any): string {
  return String(
    code?.ownerEmail ||
      code?.createdByEmail ||
      sectionOwnerEmail(code?.studentSection || code?.sectionCode),
  ).toLowerCase();
}

function canAccessJoinCode(code: any, teacherEmail: string): boolean {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  return isAdminEmail(normalized) || joinCodeOwnerEmail(code) === normalized;
}

function passwordResetOwnerEmail(item: any): string {
  const explicit = String(
    item?.teacherEmail || item?.ownerEmail || item?.createdByEmail || "",
  ).toLowerCase();
  if (explicit) return explicit;
  return sectionOwnerEmail(item?.sectionCode || item?.courseCode);
}

function canAccessPasswordResetRequest(
  item: any,
  teacherEmail: string,
): boolean {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  if (isAdminEmail(normalized)) return true;
  const owner = passwordResetOwnerEmail(item);
  if (
    owner === normalized ||
    sectionOwnerEmail(item?.sectionCode || item?.courseCode) === normalized
  )
    return true;
  const student = dbInstance
    .getStudents()
    .find((s: any) => String(s.id) === String(item?.studentId));
  if (student && teacherCanManageStudent(student, normalized)) return true;
  const allowed = dbInstance
    .getAllowedStudents()
    .find((s: any) => String(s.idNumber) === String(item?.studentId));
  if (
    allowed?.sectionCode &&
    sectionOwnerEmail(allowed.sectionCode) === normalized
  )
    return true;
  return false;
}

function teacherCanManageStudent(student: any, teacherEmail: string): boolean {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  if (isAdminEmail(normalized)) return true;
  const courseCodes = getStudentDiscoveredCourseCodes(student);
  return courseCodes.some((code) => sectionOwnerEmail(code) === normalized);
}

function isDatabaseResetActivityLog(log: any): boolean {
  const text = `${log?.action || ""} ${log?.details || ""} ${log?.message || ""}`;
  return /تطهير|تصفير|قاعدة البيانات|حذف بيانات الحساب|أكواد الدخول/.test(text);
}

function filterLogsForTeacher(email?: string) {
  const normalized = String(email || "").toLowerCase();
  const logs = dbInstance.getActivityLogs().filter((log: any) => !isDatabaseResetActivityLog(log));
  if (!normalized || isAdminEmail(normalized)) return logs;
  const students = dbInstance.getStudents();
  return logs.filter((log: any) => {
    const actorEmail = String(
      log.actorEmail || log.teacherEmail || "",
    ).toLowerCase();
    if (!log.studentId) {
      if (actorEmail) return actorEmail === normalized;
      return String(log.details || "")
        .toLowerCase()
        .includes(normalized);
    }
    const student = students.find(
      (st) => String(st.id) === String(log.studentId),
    );
    return student
      ? sectionOwnerEmail(student.sectionCode) === normalized
      : sectionOwnerEmail(log.sectionCode) === normalized;
  });
}

const MIRAS_BACKUP_SCHEMA = "miras.full-fidelity.backup.v2";

function parseAllowedStudentsTextForBackup(value: any, fallbackSection = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => {
      const [idNumber = "", name = "", sectionCode = fallbackSection] = line
        .split(",")
        .map((part) => String(part || "").trim());
      return { idNumber, name, sectionCode };
    })
    .filter((row) => row.idNumber && row.name);
}

function backupCourseCode(item: any) {
  return String(
    item?.courseCode ||
      item?.sectionCode ||
      item?.studentSection ||
      item?.section ||
      "",
  ).trim();
}

function backupOwnerEmail(item: any) {
  const explicit = String(
    item?.ownerEmail ||
      item?.createdByEmail ||
      item?.teacherEmail ||
      item?.createdBy ||
      item?.actorEmail ||
      "",
  )
    .trim()
    .toLowerCase();
  if (explicit) return explicit;
  return sectionOwnerEmail(backupCourseCode(item));
}

function backupBelongsToTeacher(item: any, teacherEmail: string) {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  const owner = backupOwnerEmail(item);
  return (
    owner === normalized ||
    sectionOwnerEmail(backupCourseCode(item)) === normalized
  );
}

function scopedBackupRows(
  rows: any[],
  includeAll: boolean,
  teacherEmail: string,
) {
  return includeAll
    ? rows
    : rows.filter((row) => backupBelongsToTeacher(row, teacherEmail));
}

function buildMirasBackupPayload(teacherEmail: string, scope: string) {
  const includeAll = isAdminEmail(teacherEmail) && scope === "all";
  const snapshot = dbInstance.exportStateSnapshot() as any;
  const allowedStudentsRows = scopedBackupRows(
    snapshot.allowedStudents || [],
    includeAll,
    teacherEmail,
  );
  const data = {
    teacherSections: scopedBackupRows(
      snapshot.sections || [],
      includeAll,
      teacherEmail,
    ),
    teacherStudents: scopedBackupRows(
      snapshot.students || [],
      includeAll,
      teacherEmail,
    ),
    allowedStudentsRows,
    allowedStudentsText: allowedStudentsRows
      .map((row: any) => `${row.idNumber}, ${row.name}, ${row.sectionCode}`)
      .join("\n"),
    teacherCreatedExams: scopedBackupRows(
      snapshot.teacherExams || [],
      includeAll,
      teacherEmail,
    ),
    teacherProjects: scopedBackupRows(
      snapshot.teacherProjects || [],
      includeAll,
      teacherEmail,
    ),
    teacherQuestions: scopedBackupRows(
      snapshot.questionBank || [],
      includeAll,
      teacherEmail,
    ),
    teacherSubmissions: scopedBackupRows(
      snapshot.teacherSubmissions || [],
      includeAll,
      teacherEmail,
    ),
    joinCodesList: scopedBackupRows(
      snapshot.joinCodes || [],
      includeAll,
      teacherEmail,
    ),
    codeIntegrity: {
      attempts: scopedBackupRows(snapshot.codeAttempts || snapshot.integrityAttempts || [], includeAll, teacherEmail),
      suspiciousCodes: scopedBackupRows(snapshot.suspiciousCodes || [], includeAll, teacherEmail),
      tradingAlerts: scopedBackupRows(snapshot.tradingAlerts || [], includeAll, teacherEmail),
      batchIntelligence: scopedBackupRows(snapshot.batchIntelligence || [], includeAll, teacherEmail),
      caseFiles: scopedBackupRows(snapshot.caseFiles || [], includeAll, teacherEmail),
      teacherReports: scopedBackupRows(snapshot.teacherReports || [], includeAll, teacherEmail),
      dataHealth: snapshot.dataHealth || {},
    },
    systemLogs: includeAll
      ? snapshot.activityLogs || []
      : filterLogsForTeacher(teacherEmail),
    passwordResetRequestsState: includeAll
      ? snapshot.passwordResetRequests || []
      : (snapshot.passwordResetRequests || []).filter((item: any) =>
          backupBelongsToTeacher(item, teacherEmail),
        ),
    submissionLocks: {},
    accessStoppedIds: {},
    previewSubmissionGrades: {},
  };
  return {
    schema: MIRAS_BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    scope: includeAll ? "all" : "me",
    ownerEmail: teacherEmail,
    counts: Object.fromEntries(
      Object.entries(data)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, (value as any[]).length]),
    ),
    data,
  };
}

function prepareMirasImportData(
  rawPayload: any,
  targetOwnerEmail: string,
  preserveExistingOwners: boolean,
) {
  const data =
    rawPayload?.data && typeof rawPayload.data === "object"
      ? rawPayload.data
      : rawPayload;
  if (!data || typeof data !== "object") throw new Error("bad payload");
  const owner = String(targetOwnerEmail || "")
    .trim()
    .toLowerCase();
  const stamp = (
    item: any,
    fields: string[] = ["ownerEmail", "teacherEmail"],
  ) => {
    const next = { ...(item || {}) };
    fields.forEach((field) => {
      if (!preserveExistingOwners || !next[field]) next[field] = owner;
    });
    return next;
  };
  const allowedFromText = parseAllowedStudentsTextForBackup(
    data.allowedStudentsText,
  );
  const allowedStudentsRows = [
    ...(Array.isArray(data.allowedStudentsRows)
      ? data.allowedStudentsRows
      : []),
    ...(Array.isArray(data.allowedStudents) ? data.allowedStudents : []),
    ...allowedFromText,
  ];
  return {
    ...data,
    teacherSections: Array.isArray(data.teacherSections || data.sections)
      ? (data.teacherSections || data.sections).map((item: any) =>
          stamp(item, ["ownerEmail"]),
        )
      : undefined,
    teacherStudents: Array.isArray(data.teacherStudents || data.students)
      ? data.teacherStudents || data.students
      : undefined,
    allowedStudentsRows,
    teacherCreatedExams: Array.isArray(
      data.teacherCreatedExams || data.teacherExams,
    )
      ? (data.teacherCreatedExams || data.teacherExams).map((item: any) =>
          stamp(item, ["createdBy", "teacherEmail"]),
        )
      : undefined,
    teacherProjects: Array.isArray(data.teacherProjects)
      ? data.teacherProjects.map((item: any) =>
          stamp(item, ["createdBy", "teacherEmail", "ownerEmail"]),
        )
      : undefined,
    teacherQuestions: Array.isArray(data.teacherQuestions || data.questionBank)
      ? (data.teacherQuestions || data.questionBank).map((item: any) =>
          stamp(item, ["teacherEmail"]),
        )
      : undefined,
    teacherSubmissions: Array.isArray(data.teacherSubmissions)
      ? data.teacherSubmissions.map((item: any) =>
          stamp(item, ["teacherEmail", "ownerEmail"]),
        )
      : undefined,
    joinCodesList: Array.isArray(data.joinCodesList || data.joinCodes)
      ? (data.joinCodesList || data.joinCodes).map((item: any) =>
          stamp(item, ["ownerEmail", "createdByEmail"]),
        )
      : undefined,
    systemLogs: Array.isArray(data.systemLogs || data.activityLogs)
      ? (data.systemLogs || data.activityLogs).map((item: any) =>
          stamp(item, ["teacherEmail", "actorEmail"]),
        )
      : undefined,
    passwordResetRequestsState: Array.isArray(
      data.passwordResetRequestsState || data.passwordResetRequests,
    )
      ? (data.passwordResetRequestsState || data.passwordResetRequests).map(
          (item: any) => stamp(item, ["teacherEmail"]),
        )
      : undefined,
  };
}

function isExamReturnedForStudent(examId: any, studentId: any): boolean {
  return dbInstance.getTeacherSubmissions().some((item: any) => {
    if (
      String(item.kind || "").toLowerCase() !== "exam" ||
      String(item.activityId ?? item.examId ?? "") !== String(examId) ||
      String(item.studentId ?? item.userId ?? "") !== String(studentId)
    )
      return false;
    const status = String(item.status || "").trim().toLowerCase();
    const note = String(item.returnNote || item.answerText || "").toLowerCase();
    return (
      ["معاد للطالب", "معاد لك", "returned", "return", "reopened"].includes(status) ||
      Boolean(item.returnedAt) ||
      Boolean(item.returnExceptionUntil) ||
      /معاد|إرجاع|ارجاع|returned|reopen/.test(`${status} ${note}`)
    );
  });
}

function hasTeacherAuthorizedSebReturnException(examId: any, studentId: any): boolean {
  // استثناء ضيق فقط لمسار الاختبار المُعاد/المفتوح من المعلم.
  // الهدف ألا تظهر صفحة منع SEB للطالب حين يكون الإرجاع قراراً صريحاً من المعلم،
  // مع بقاء قفل الجهاز وSEB كما هو في كل المسارات العادية.
  return Boolean(
    getActiveReturnException("exam", examId, studentId) ||
      isExamReturnedForStudent(examId, studentId),
  );
}

function getActiveReturnException(
  kind: any,
  activityId: any,
  studentId: any,
): any | null {
  const normalizedKind =
    String(kind || "").toLowerCase() === "quiz"
      ? "exam"
      : String(kind || "").toLowerCase();
  const now = Date.now();
  const isExceptionCarryStatus = (status: any) => {
    const normalized = String(status || "")
      .trim()
      .toLowerCase();
    return (
      normalized === EXAM_IN_PROGRESS_STATUS ||
      ["معاد للطالب", "معاد لك", "returned", "return", "reopened"].includes(
        normalized,
      )
    );
  };
  const rows = dbInstance
    .getTeacherSubmissions()
    .filter(
      (item: any) =>
        String(item.kind || "").toLowerCase() === normalizedKind &&
        String(item.activityId ?? "") === String(activityId) &&
        String(item.studentId ?? "") === String(studentId) &&
        isExceptionCarryStatus(item.status) &&
        Number.isFinite(new Date(item.returnExceptionUntil || 0).getTime()) &&
        new Date(item.returnExceptionUntil || 0).getTime() > now,
    )
    .sort(
      (a: any, b: any) =>
        new Date(b.returnedAt || b.updatedAt || b.submittedAt || 0).getTime() -
        new Date(a.returnedAt || a.updatedAt || a.submittedAt || 0).getTime(),
    );
  return rows[0] || null;
}

function submissionIsLocked(item: any): boolean {
  if (!item) return false;
  const status = String(item.status || "submitted");
  return status !== "returned" && status !== "started";
}


function isExplicitStudentDeviceTransferClaimRequest(req: express.Request): boolean {
  const pathname = String((req as any).path || (req as any).url || "").split("?")[0];
  if (String((req as any).method || "").toUpperCase() !== "POST") return false;
  return (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/passkey/login/finish" ||
    pathname === "/api/students/join-lab"
  );
}

function validateSessionFingerprint(
  req: express.Request,
  student: Student,
): { isValid: boolean; error?: string; statusCode?: number } {
  const browser = req.headers["user-agent"] || "Unknown Browser";
  const ip = req.ip || "127.0.0.1";
  const sebPass = getValidSebPass(req, student);
  if (sebPass && isSebRequest(req)) {
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "دخول SEB آمن",
      details: `تم السماح بدخول Safe Exam Browser بجلسة مؤقتة للمقرر ${sebPass.courseCode} والاختبار ${sebPass.examId} دون فك قفل الجهاز الأصلي.`,
      ip,
      userAgent: browser,
      os: "Safe Exam Browser",
      browser: "SEB Pass",
      isViolationWarning: false,
    });
    return { isValid: true };
  }

  // Create a device fingerprint string from browser, IP, and a local signed device token when present.
  const currentFingerprint = getRequestDeviceFingerprint(req);
  const currentDeviceToken = getRequestDeviceToken(req);
  const deviceBoundToOtherStudent = findStudentBoundToDevice(
    currentDeviceToken,
    currentFingerprint,
    student.id,
  );
  if (deviceBoundToOtherStudent) {
    recordActivationAttempt(req, {
      code: (student as any).activationCode || "LOGIN",
      student,
      reason: "محاولة استخدام جهاز مرتبط بطالب آخر",
    });
    return {
      isValid: false,
      statusCode: 409,
      error: STUDENT_DEVICE_ALREADY_BOUND_ERROR,
    };
  }

  // ===== تبديل الجهاز (pendingDeviceTransfer) — حل جذري =====
  // بعد موافقة الأستاذ على "تبديل الجهاز"، نعتمد أول جهاز جديد فعلاً يدخل ونقفل
  // الحساب عليه، ونرفض الجهاز/المتصفح القديم برسالة واضحة حتى لا يعيد احتجاز الحساب.
  // يعمل لكل المسارات: كلمة المرور، البصمة، Web↔PWA، سفاري↔كروم، تلفون قديم↔جديد.
  if ((student as any).pendingDeviceTransfer) {
    if (!currentDeviceToken) {
      return {
        isValid: false,
        statusCode: 400,
        error:
          "تعذّر اعتماد جهازك الجديد لأن المتصفح لم يرسل معرّف الجهاز. تأكد أنك لا تستخدم وضع التصفح الخاص/المتخفّي وأن المتصفح يسمح بحفظ بيانات الموقع، ثم أعد فتح مِراس وحاول مرة أخرى.",
      };
    }
    const retiredTokens: string[] = Array.isArray(
      (student as any).retiredDeviceTokens,
    )
      ? (student as any).retiredDeviceTokens
      : [];
    const retiredFingerprints: string[] = Array.isArray(
      (student as any).retiredDeviceFingerprints,
    )
      ? (student as any).retiredDeviceFingerprints
      : [];
    const isRetiredOldDevice = isRetiredStudentDeviceSurface({
      currentDeviceToken,
      currentFingerprint,
      retiredDeviceTokens: retiredTokens,
      retiredDeviceFingerprints: retiredFingerprints,
    });
    const explicitTransferClaim = isExplicitStudentDeviceTransferClaimRequest(req);
    if (isRetiredOldDevice && !explicitTransferClaim) {
      recordActivationAttempt(req, {
        code: (student as any).activationCode || "DEVICE_TRANSFER",
        student,
        reason: "محاولة دخول من الجهاز القديم بعد اعتماد نقل الحساب لجهاز جديد",
      });
      return {
        isValid: false,
        statusCode: 409,
        error:
          "حسابك في وضع النقل لجهاز جديد. يرجى تسجيل الدخول من جهازك الجديد لإكمال النقل، لأن هذا الجهاز القديم أصبح ملغياً.",
      };
    }
    // اعتماد الجهاز الجديد رسمياً وإغلاق حالة النقل والقفل عليه.
    // مهم في PWA: قد ينتج عن iOS نفس البصمة/التوكن بعد حذف التطبيق أو إعادة فتحه،
    // لذلك نسمح فقط بطلب دخول صريح أن يطالب بالجهاز الجديد، أما polling/live-state
    // للجلسة القديمة فيبقى مرفوضاً أعلاه ولا يستطيع خطف الاعتماد.
    (student as any).devices = [currentFingerprint];
    dbInstance.updateStudent(student.id, {
      devices: [currentFingerprint],
      pendingDeviceTransfer: false,
      retiredDeviceFingerprints: [],
      retiredDeviceTokens: [],
    } as any);
    const transferActivationCode = (student as any).activationCode;
    if (transferActivationCode && isUnifiedJoinCode(transferActivationCode)) {
      const rec = dbInstance
        .getJoinCodes()
        .find(
          (jc: any) =>
            normalizeJoinCode(jc.code) ===
            normalizeJoinCode(transferActivationCode),
        );
      if (rec) {
        dbInstance.updateJoinCode(rec.code, {
          activationDeviceToken: currentDeviceToken,
          activationDeviceFingerprint: currentFingerprint,
          // جذر العلاج: نُعيد ربط بصمة الخادم (serverHash) للجهاز الجديد أيضاً.
          // لو تركناها على الجهاز القديم لفشل فحص serverHash في كل طلب تالٍ بعد
          // أول دخول ناجح، فيظهر للطالب "مقفل على المتصفح الأصلي" ويصل للمعلم
          // تنبيه "توكن منسوخ" زوراً، ويتعذّر إدخال أي كود جديد (عام أو غيره).
          activationDeviceServerHash: serverBoundDeviceHash(
            req,
            currentDeviceToken,
          ),
          activationIp: ip || (rec as any).activationIp || "",
        } as any);
      }
    }
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "اعتماد جهاز جديد",
      details: `تم اعتماد الجهاز/المتصفح الجديد للطالب ${student.name} بعد موافقة الأستاذ على تبديل الجهاز، وقُفل الحساب عليه.`,
      ip,
      userAgent: browser,
      os: "اعتماد جهاز جديد",
      browser: "تبديل الجهاز",
      isViolationWarning: false,
    });
    return { isValid: true };
  }

  const activationCode = (student as any).activationCode;
  if (activationCode && isUnifiedJoinCode(activationCode)) {
    const activationRecord = dbInstance
      .getJoinCodes()
      .find(
        (jc: any) =>
          normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode),
      );
    const lockedFingerprint = (activationRecord as any)
      ?.activationDeviceFingerprint;
    const lockedDeviceToken = (activationRecord as any)?.activationDeviceToken;
    const lockedDeviceServerHash = String((activationRecord as any)?.activationDeviceServerHash || "").trim();
    const currentDeviceServerHash = serverBoundDeviceHash(req, currentDeviceToken);
    if (
      activationRecord?.status === "used" &&
      lockedDeviceServerHash &&
      (!currentDeviceServerHash || lockedDeviceServerHash !== currentDeviceServerHash)
    ) {
      const tokenMatchesLockedDevice =
        !!lockedDeviceToken &&
        !!currentDeviceToken &&
        lockedDeviceToken === currentDeviceToken;
      const fingerprintMatchesLockedDevice =
        !!lockedFingerprint &&
        deviceFingerprintsMatch(lockedFingerprint, currentFingerprint);
      if (tokenMatchesLockedDevice && fingerprintMatchesLockedDevice) {
        // iOS PWA/Safari قد يفقدان/يعيدان إنشاء HttpOnly cookie الخاص بالخادم
        // بعد تبديل الجهاز أو إعادة فتح التطبيق. إذا كان deviceToken والبصمة
        // مطابقين للجهاز المعتمد، لا نطرد الطالب بسبب serverHash فقط؛ نحدّثه
        // عند توفره ونستمر. القفل الحقيقي ما زال على deviceToken + fingerprint.
        if (currentDeviceServerHash && currentDeviceServerHash !== lockedDeviceServerHash) {
          dbInstance.updateJoinCode(activationRecord.code, {
            activationDeviceServerHash: currentDeviceServerHash,
          } as any);
        }
      } else {
        recordActivationAttempt(req, {
          code: activationCode,
          student,
          reason: "محاولة دخول بتوكن منسوخ دون سر المتصفح الأصلي",
          foundCode: activationRecord,
        });
        return {
          isValid: false,
          statusCode: 409,
          error:
            "هذا الحساب مقفل على المتصفح الأصلي. لا يكفي نسخ الكود أو بيانات المتصفح؛ اطلب من الأستاذ تبديل الجهاز.",
        };
      }
    }
    if (
      activationRecord?.status === "used" &&
      lockedDeviceToken &&
      !currentDeviceToken
    ) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "محاولة دخول بدون توكن الجهاز المفعّل",
        foundCode: activationRecord,
      });
      return {
        isValid: false,
        error:
          "تعذّر التعرف على جهازك لأن المتصفح لم يرسل معرّف الجهاز. تأكد أنك لا تستخدم وضع التصفح الخاص/المتخفّي وأن المتصفح يسمح بحفظ بيانات الموقع، ثم افتح مِراس وحاول مرة أخرى. إن كنت تنتقل لجهاز جديد فاطلب من الأستاذ «تبديل الجهاز».",
      };
    }
    if (
      activationRecord?.status === "used" &&
      lockedDeviceToken &&
      currentDeviceToken &&
      lockedDeviceToken !== currentDeviceToken
    ) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "محاولة دخول من جهاز مختلف عن جهاز التفعيل",
        foundCode: activationRecord,
      });
      return {
        isValid: false,
        error:
          "هذا الحساب مسجل في جهاز آخر. للتبديل لهذا الجهاز اطلب من الأستاذ (تبديل الجهاز) ثم سجل دخولك هنا.",
      };
    }
    if (
      activationRecord?.status === "used" &&
      lockedDeviceToken &&
      currentDeviceToken &&
      lockedDeviceToken === currentDeviceToken &&
      lockedFingerprint &&
      !deviceFingerprintsMatch(lockedFingerprint, currentFingerprint)
    ) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "محاولة دخول بنفس توكن الجهاز من متصفح مختلف",
        foundCode: activationRecord,
      });
      return {
        isValid: false,
        statusCode: 409,
        error:
          "هذا الحساب مقفل على المتصفح الأصلي. لا يمكن فتحه من متصفح آخر حتى على نفس الجهاز إلا بعد موافقة الأستاذ على تبديل الجهاز.",
      };
    }
    if (
      activationRecord?.status === "used" &&
      lockedDeviceToken &&
      currentDeviceToken &&
      lockedDeviceToken === currentDeviceToken &&
      lockedFingerprint &&
      lockedFingerprint !== currentFingerprint &&
      deviceFingerprintsMatch(lockedFingerprint, currentFingerprint)
    ) {
      dbInstance.updateJoinCode(activationRecord.code, {
        activationDeviceFingerprint: currentFingerprint,
      } as any);
    }
    if (
      activationRecord?.status === "used" &&
      !lockedDeviceToken &&
      currentDeviceToken
    ) {
      dbInstance.updateJoinCode(activationRecord.code, {
        activationDeviceToken: currentDeviceToken,
        activationDeviceServerHash: serverBoundDeviceHash(req, currentDeviceToken),
      } as any);
    }
    if (
      activationRecord?.status === "used" &&
      !lockedDeviceToken &&
      lockedFingerprint &&
      lockedFingerprint !== currentFingerprint
    ) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "محاولة دخول ببصمة جهاز مختلفة",
        foundCode: activationRecord,
      });
      return {
        isValid: false,
        error:
          "هذا الحساب مسجل في جهاز آخر. للتبديل لهذا الجهاز اطلب من الأستاذ (تبديل الجهاز) ثم سجل دخولك هنا.",
      };
    }
    if (activationRecord?.status === "used" && !lockedFingerprint) {
      dbInstance.updateJoinCode(activationRecord.code, {
        activationDeviceFingerprint: currentFingerprint,
      } as any);
    }
  }

  // المطابقة بالـ deviceToken الثابت لا بالـ IP: نفس الجهاز/المتصفح يبقى معتمداً
  // حتى لو تغيّر الـ IP. (مطابقة المقطع الثابت من البصمة، انظر deviceFingerprintsMatch)
  const fingerprintAlreadyBound = student.devices.some((d: any) =>
    deviceFingerprintsMatch(d, currentFingerprint),
  );
  if (fingerprintAlreadyBound) {
    const currentDevices = Array.isArray(student.devices)
      ? student.devices.map((d: any) => String(d || "").trim()).filter(Boolean)
      : [];
    if (
      currentDevices.length !== 1 ||
      !currentDevices.some((d: any) => d === currentFingerprint)
    ) {
      (student as any).devices = [currentFingerprint];
      dbInstance.updateStudent(student.id, { devices: [currentFingerprint] });
    }
  }
  if (!fingerprintAlreadyBound) {
    // جهاز واحد فقط لكل حساب/كود: بمجرد ربط جهاز، أي جهاز آخر يُرفض حتى يفك الأستاذ القفل.
    if (student.devices.length >= 1) {
      return {
        isValid: false,
        error: `هذا الحساب مسجل في جهاز آخر. للتبديل لهذا الجهاز اطلب من الأستاذ (تبديل الجهاز) ثم سجل دخولك هنا.`,
      };
    }
    // ربط الجهاز الأول تلقائياً (ثم يُقفل عليه)
    student.devices.push(currentFingerprint);
    dbInstance.updateStudent(student.id, { devices: student.devices });
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "جهاز جديد",
      details: `تم ربط الجهاز الوحيد للحساب بنجاح: ${currentFingerprint}`,
      ip,
      userAgent: browser,
      os: "مكتشف تلقائياً",
      browser: "متصفح الويب",
      isViolationWarning: false,
    });
  }
  return { isValid: true };
}

// ================= AUTH ENDPOINTS =================

// Register Allowed Students list from Excel Paste CSV

app.post("/api/auth/forgot-password", (req, res) => {
  const idNumber = normalizeStudentId(req.body?.idNumber);
  if (!/^\d{4,}$/.test(idNumber))
    return res.status(400).json({ error: "أدخل الرقم الجامعي بشكل صحيح." });
  const student = dbInstance
    .getStudents()
    .find((s: any) => String(s.id) === idNumber);
  const allowed = dbInstance
    .getAllowedStudents()
    .find((s: any) => String(s.idNumber) === idNumber);
  const resetToken = crypto.randomBytes(24).toString("hex");
  const verificationCode = makeJoinCode(
    "LAB",
    "",
    new Set([
      ...dbInstance
        .getPasswordResetRequests()
        .map((item: any) => compactJoinCode(item.verificationCode)),
      ...dbInstance.getOtps().map((item: any) => compactJoinCode(item.code)),
      ...dbInstance
        .getJoinCodes()
        .map((item: any) => compactJoinCode(item.code)),
    ]),
  );
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + 60 * 60 * 1000);
  const resetRequest = {
    id: `pr-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    studentId: idNumber,
    studentName: student?.name || allowed?.name || "غير مسجل",
    studentEmail: student?.email,
    studentPhone: (student as any)?.phone || (allowed as any)?.phone || "",
    username: student?.email || idNumber,
    sectionCode: student?.sectionCode || allowed?.sectionCode,
    teacherEmail: student
      ? sectionOwnerEmail(student.sectionCode)
      : allowed
        ? sectionOwnerEmail(allowed.sectionCode)
        : undefined,
    resetToken,
    resetLink: buildResetLink(req, resetToken),
    verificationCode,
    status: "new" as const,
    requestedAt: requestedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  dbInstance.addPasswordResetRequest(resetRequest);
  dbInstance.addActivityLog({
    studentId: idNumber,
    studentName: student?.name || allowed?.name || "غير مسجل",
    action: "طلب استعادة كلمة المرور",
    details: student
      ? `تم إنشاء رابط إعادة تعيين مؤقت ينتهي خلال ساعة واحدة. رقم الطلب: ${resetRequest.id}`
      : "طلب استعادة لطالب غير مسجل؛ يلزم التحقق من الكشف قبل إصدار أي كلمة مرور.",
    teacherEmail: student
      ? sectionOwnerEmail(student.sectionCode)
      : allowed
        ? sectionOwnerEmail(allowed.sectionCode)
        : undefined,
    actorEmail: student
      ? sectionOwnerEmail(student.sectionCode)
      : allowed
        ? sectionOwnerEmail(allowed.sectionCode)
        : undefined,
    sectionCode: student?.sectionCode || allowed?.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "استعادة الدخول",
    browser: "لوحة الدخول",
    isViolationWarning: false,
  });
  notifyTeachersForSection(
    student?.sectionCode || allowed?.sectionCode,
    "طلب استرجاع كلمة مرور",
    `${resetRequest.studentName} طلب رابط إعادة تعيين`,
    { type: "password_reset", studentId: idNumber, link: "/" },
  );
  if (student)
    notifyStudent(
      student.id,
      "رابط إعادة التعيين جاهز",
      "راجع أستاذ المقرر للحصول على الرابط المؤقت الآمن.",
      { type: "password_reset_ready", link: "/" },
    );
  return res.json({
    success: true,
    message:
      "تم تسجيل طلب استعادة كلمة المرور. سيظهر الطلب في لوحة التحكم مع رابط مؤقت آمن ينتهي خلال ساعة.",
  });
});

app.post("/api/auth/reset-password", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const newPassword = String(req.body?.newPassword || "");
  if (!token || isWeakDefaultPassword(newPassword))
    return res
      .status(400)
      .json({ error: "الرابط غير صالح أو كلمة المرور قصيرة/افتراضية. اختر كلمة مرور لا تقل عن 6 خانات." });
  const requestItem = dbInstance
    .getPasswordResetRequests()
    .find((item: any) => item.resetToken === token);
  if (!requestItem)
    return res.status(404).json({ error: "رابط إعادة التعيين غير موجود." });
  if (
    requestItem.status !== "new" ||
    new Date(requestItem.expiresAt).getTime() <= Date.now()
  ) {
    dbInstance.updatePasswordResetRequest(requestItem.id, {
      status: requestItem.status === "new" ? "expired" : requestItem.status,
    } as any);
    return res
      .status(410)
      .json({ error: "رابط إعادة التعيين منتهي أو تم استخدامه سابقاً." });
  }
  const student = dbInstance
    .getStudents()
    .find((s: any) => String(s.id) === String(requestItem.studentId));
  if (!student)
    return res
      .status(404)
      .json({ error: "لا يوجد حساب طالب مرتبط بهذا الطلب." });
  const currentFingerprint = getRequestDeviceFingerprint(req);
  const currentDeviceToken = getRequestDeviceToken(req);
  const activationCode = (student as any).activationCode;
  if (activationCode && isUnifiedJoinCode(activationCode)) {
    const activationRecord = dbInstance
      .getJoinCodes()
      .find(
        (jc: any) =>
          normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode),
      );
    const lockedDeviceToken = String(
      (activationRecord as any)?.activationDeviceToken || "",
    ).trim();
    const lockedFingerprint = String(
      (activationRecord as any)?.activationDeviceFingerprint || "",
    ).trim();
    if (activationRecord?.status === "used") {
      if (
        lockedDeviceToken &&
        (!currentDeviceToken || lockedDeviceToken !== currentDeviceToken)
      ) {
        recordActivationAttempt(req, {
          code: activationCode,
          student,
          reason: "محاولة تغيير كلمة المرور من جهاز مختلف عن جهاز التفعيل",
          foundCode: activationRecord,
        });
        return res
          .status(403)
          .json({
            error:
              "لا يمكن تغيير كلمة المرور من جهاز مختلف. افتح رابط الاسترجاع من نفس الجهاز الذي استخدمت فيه كود التفعيل.",
          });
      }
      if (
        !lockedDeviceToken &&
        lockedFingerprint &&
        lockedFingerprint !== currentFingerprint
      ) {
        recordActivationAttempt(req, {
          code: activationCode,
          student,
          reason: "محاولة تغيير كلمة المرور ببصمة جهاز مختلفة",
          foundCode: activationRecord,
        });
        return res
          .status(403)
          .json({
            error:
              "لا يمكن تغيير كلمة المرور من جهاز مختلف. افتح رابط الاسترجاع من نفس الجهاز الذي استخدمت فيه كود التفعيل.",
          });
      }
    }
  }
  const usedAt = new Date().toISOString();
  if (isWeakDefaultPassword(newPassword)) {
    return res.status(400).json({ error: "اختر كلمة مرور قوية لا تقل عن 6 خانات ولا تستخدم كلمة المرور الافتراضية." });
  }
  dbInstance.updateStudent(student.id, { passwordHash: hashPasswordSecure(newPassword) } as any);
  dbInstance.updatePasswordResetRequest(requestItem.id, {
    status: "handled",
    usedAt,
    handledAt: usedAt,
  } as any);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "إعادة تعيين كلمة المرور",
    details: `استخدم الطالب رابط إعادة التعيين المؤقت بنجاح. رقم الطلب: ${requestItem.id}`,
    teacherEmail: sectionOwnerEmail(student.sectionCode),
    actorEmail: sectionOwnerEmail(student.sectionCode),
    sectionCode: student.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "استعادة الدخول",
    browser: "رابط آمن",
    isViolationWarning: false,
  });
  notifyTeachersForSection(
    student.sectionCode,
    "تم تغيير كلمة مرور طالب",
    `${student.name} غيّر كلمة المرور عبر رابط الاسترجاع الآمن.`,
    { type: "password_changed", studentId: student.id, link: "/" },
  );
  return res.json({
    success: true,
    message: "تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.",
  });
});

app.post("/api/teacher/upload-allowed", (req, res) => {
  const { studentsList } = req.body; // Array of { idNumber, name, sectionCode }
  if (!Array.isArray(studentsList)) {
    return res.status(400).json({ error: "تنسيق كشف الطلاب غير صالح" });
  }

  const teacherEmail = teacherEmailFromRequest(req);
  const targetSectionRaw = String(
    req.body?.sectionCode || studentsList[0]?.sectionCode || "",
  ).trim();
  const targetSection = resolveTeacherScopedCourseCode(targetSectionRaw, teacherEmail);
  if (!targetSection) {
    return res
      .status(400)
      .json({ error: "يجب اختيار المقرر قبل رفع كشف الطلاب" });
  }

  const invalid = studentsList.find(
    (s) =>
      !String(s.name || "").trim() ||
      !/^\d{4,}$/.test(normalizeStudentId(s.idNumber)),
  );
  if (invalid) {
    return res
      .status(400)
      .json({ error: "كل صف في الكشف يجب أن يحتوي على اسم ورقم جامعي واضح" });
  }
  const seenIds = new Set<string>();
  const duplicateInUpload = studentsList.find((s) => {
    const id = normalizeStudentId(s.idNumber);
    if (seenIds.has(id)) return true;
    seenIds.add(id);
    return false;
  });
  if (duplicateInUpload) {
    return res
      .status(400)
      .json({
        error: `الرقم الجامعي ${normalizeStudentId(duplicateInUpload.idNumber)} مكرر داخل الكشف. احذف التكرار ثم أعد الحفظ.`,
      });
  }

  // التقاط كشف الطلاب السابق لهذا المقرر قبل استبداله، حتى نُشعِر فقط الطلاب
  // المُضافين حديثاً (لا نُكرّر الإشعار على كل حفظ للكشف).
  const previousRosterIds = new Set(
    dbInstance
      .getAllowedStudents()
      .filter((r: any) =>
        sectionCodeEquivalent(r.sectionCode || (r as any).studentSection || (r as any).courseCode, targetSection),
      )
      .map((r: any) => normalizeStudentId(r.idNumber || (r as any).id || (r as any).studentId))
      .filter(Boolean),
  );

  // Cloud source of truth: replace only this course roster, including legacy
  // display-only rows for the same teacher/course. This prevents the roster from
  // flickering or duplicating when the course number/name was edited.
  dbInstance.clearAllowedStudentsBySection(targetSection);
  try {
    const rows = dbInstance.getAllowedStudents();
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const rowCourse = (rows[i] as any)?.sectionCode || (rows[i] as any)?.courseCode;
      const sameCourse = sectionCodeEquivalent(rowCourse, targetSection);
      const rowOwner = extractEmailFromSectionCode(rowCourse);
      if (sameCourse && (!rowOwner || rowOwner === teacherEmail)) rows.splice(i, 1);
    }
    dbInstance.persist();
  } catch {}
  studentsList.forEach((s) => {
    const normId = normalizeStudentId(s.idNumber);
    dbInstance.addAllowedStudent({
      idNumber: normId,
      name: String(s.name).trim(),
      sectionCode: targetSection,
      // نثبّت مالك الصف صراحةً حتى لا تعتمد المطابقات على استنتاج المالك من الكود فقط.
      teacherEmail,
    } as any);
    const registered = dbInstance
      .getStudents()
      .find((st) => normalizeStudentId(st.id) === normId);
    if (registered) {
      const isNewCourseMembership = !previousRosterIds.has(normId);
      const restorePatch: any = {
        // تنظيف الدورة القديمة مطلوب فقط عند إضافة الطالب فعلياً بعد أن كان
        // خارج الكشف. إعادة حفظ الكشف نفسه لا يجوز أن تمس تفعيل الطالب الحالي.
        ...(isNewCourseMembership
          ? buildCleanStudentCourseReaddPatch(registered, targetSection, teacherEmail)
          : {}),
        name: String(s.name).trim(),
        courseVisibilitySyncedAt: new Date().toISOString(),
      };
      dbInstance.updateStudent(registered.id, restorePatch);
    }
  });

  // إشعار «تمت إضافتك لمقرر» للطلاب الموجودين (المسجّلين) المُضافين حديثاً لهذا
  // المقرر، حتى يعرفوا أن يدخلوا كود المقرر لتفعيله. يظهر في جرس الإشعارات
  // (inbox) لكل طالب مُضاف، وكإشعار Push لمن فعّل الإشعارات. الطالب الجديد بلا
  // حساب لا يُشعَر الآن، لكن المقرر سيظهر له مقفلاً تلقائياً عند أول دخول.
  try {
    const courseName = courseNameFromCode(targetSection);
    const enrollTitle = "تمت إضافتك لمقرر";
    const enrollBody = `تمت إضافتك إلى مقرر ${courseName}. أدخل كود المقرر من حسابك لتفعيله.`;
    studentsList.forEach((s) => {
      const sid = normalizeStudentId(s.idNumber);
      if (!sid || previousRosterIds.has(sid)) return; // ليس مُضافاً حديثاً
      const reg = dbInstance.getStudents().find((st: any) => normalizeStudentId(st.id) === sid);
      if (!reg) return; // طالب جديد بلا حساب: لا يمكن إشعاره الآن
      const alreadyActive = getStudentActiveCourseCodes(reg).some((c) =>
        sectionCodeEquivalent(c, targetSection),
      );
      if (alreadyActive) return; // مفعّل المقرر بالفعل: لا داعي للإشعار
      notifyUsers(
        (token) => token.role === "student" && normalizeStudentId(token.userId) === sid,
        enrollTitle,
        enrollBody,
        { type: "course_enrolled", courseCode: targetSection, studentId: sid, link: "/" },
      );
      // ضمان ظهور التنبيه في الجرس حتى لو لم يُفعّل الطالب إشعارات المتصفح.
      rememberInAppNotification({
        userId: sid,
        role: "student",
        sectionCode: targetSection,
        title: enrollTitle,
        body: enrollBody,
        type: "course_enrolled",
        data: { type: "course_enrolled", courseCode: targetSection, link: "/" },
      });
    });
  } catch {}

  return res.json({
    success: true,
    count: studentsList.length,
    sectionCode: targetSection,
    allowedStudents: dbInstance.getAllowedStudents(),
  });
});

app.get("/api/teacher/allowed-students", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const includeAll =
    String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
  const allowedStudents = dbInstance
    .getAllowedStudents()
    .filter(
      (row: any) =>
        includeAll ||
        sectionOwnerEmail(row.sectionCode) === teacherEmail ||
        !teacherEmail,
    );
  return res.json({ success: true, allowedStudents });
});

// Lookup allowed student by university ID for signup autofill
app.get("/api/auth/lookup-student/:id", (req, res) => {
  const normalizedIdNumber = normalizeStudentId(String(req.params.id || ""));
  const allowed = dbInstance
    .getAllowedStudents()
    .find((s) => normalizeStudentId(s.idNumber) === normalizedIdNumber);
  if (!allowed) {
    return res
      .status(404)
      .json({
        error:
          "الرقم الجامعي غير مدرج في كشوفات أي مقرر معتمد. يرجى التواصل مع أستاذ المادة لإضافة اسمك في كشف المقرر.",
      });
  }
  const section = sectionForCourseCode(allowed.sectionCode);
  return res.json({
    success: true,
    student: {
      idNumber: allowed.idNumber,
      name: allowed.name,
      sectionCode: allowed.sectionCode,
      courseName: section?.courseName || allowed.sectionCode,
    },
  });
});


app.get("/api/teacher/student-lookup/:id", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });
  const normalizedIdNumber = normalizeStudentId(String(req.params.id || ""));
  if (!normalizedIdNumber) return res.status(400).json({ error: "الرقم الجامعي غير واضح." });
  const requestedCourse = String(req.query.courseCode || req.query.sectionCode || "").trim();
  const allowed = dbInstance.getAllowedStudents().find((row: any) => {
    if (normalizeStudentId(row.idNumber || row.id || row.studentId) !== normalizedIdNumber) return false;
    if (!requestedCourse) return true;
    return allowedStudentMatchesCourse(row, normalizedIdNumber, requestedCourse, teacherEmail);
  }) || dbInstance.getAllowedStudents().find((row: any) => normalizeStudentId(row.idNumber || row.id || row.studentId) === normalizedIdNumber);
  const registered = dbInstance.getStudents().find((st: any) => normalizeStudentId(st.id || st.idNumber || st.studentId) === normalizedIdNumber);
  const name = String(allowed?.name || registered?.name || (registered as any)?.studentName || "").trim();
  if (!name) return res.status(404).json({ error: "لم يتم العثور على اسم محفوظ لهذا الرقم." });
  return res.json({
    success: true,
    student: {
      idNumber: normalizedIdNumber,
      name,
      sectionCode: allowed?.sectionCode || registered?.sectionCode || requestedCourse || "",
    },
  });
});

// Developer/Testing endpoint to completely reset a student account and its join codes for trial/testing
app.post("/api/auth/test-reset-student", (req, res) => {
  const { studentId } = req.body;
  if (!studentId) {
    return res.status(400).json({ error: "يرجى تحديد الرقم الجامعي" });
  }
  const normId = normalizeStudentId(studentId);

  // Use the encapsulated DB method we created
  dbInstance.deleteStudentDataCompletely(normId);

  dbInstance.addActivityLog({
    studentId: normId,
    studentName: "طالب تجريبي",
    action: "تصفير حساب تجريبي بالكامل",
    details: `تم تصفير الحساب ${normId} وإعادة تعيين الرموز المرتبطة به لتجربة التسجيل كطالب جديد.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "نظام التطوير",
    browser: "أداة التصفير التجريبية",
    isViolationWarning: false,
  });

  return res.json({
    success: true,
    message: `تم تصفير الحساب الجامعي ${normId} بالكامل وتفريغ رموز الانضمام الخاصة به بنجاح. يمكنك الآن تسجيل هذا الطالب كطالب جديد تماماً!`,
  });
});

// Student Signup
app.post("/api/auth/register", (req, res) => {
  const { idNumber, name, semester, password } = req.body;
  const normalizedIdNumberForEmail = normalizeStudentId(idNumber);
  const email = normalizeArabicDigits(
    req.body.email || `${normalizedIdNumberForEmail || "student"}@paaet.edu.kw`,
  )
    .trim()
    .toLowerCase();

  if (!idNumber || !password) {
    return res.status(400).json({ error: "يرجى تعبئة جميع الحقول المطلوبة" });
  }

  if (isWeakDefaultPassword(password)) {
    return res.status(400).json({
      error: "اختر كلمة مرور أقوى قبل إدخال كود المقرر. لا يُسمح بكلمة مرور افتراضية أو أقل من 6 خانات.",
    });
  }

  if (req.body.email && !isValidEmailFormat(email)) {
    return res
      .status(400)
      .json({ error: "اكتب البريد الإلكتروني بصيغة صحيحة قبل المتابعة." });
  }

  if (req.body.email && !isValidPaaetEmail(email)) {
    return res
      .status(400)
      .json({
        error: "البريد الإلكتروني للطالب يجب أن ينتهي بـ @paaet.edu.kw",
      });
  }

  // Check if student id belongs to allowed list
  const normalizedIdNumber = normalizeStudentId(idNumber);
  const allowed = dbInstance
    .getAllowedStudents()
    .find((s) => normalizeStudentId(s.idNumber) === normalizedIdNumber);
  if (!allowed) {
    return res.status(400).json({
      error:
        "الرقم الجامعي غير مدرج في كشوفات أي مقرر معتمد. يرجى التواصل مع أستاذ المادة لإضافة اسمك في كشف المقرر.",
    });
  }

  // Check if already registered
  const emailExists = dbInstance.getStudents().find(
    (s: any) =>
      String(s.email || "")
        .trim()
        .toLowerCase() === email &&
      normalizeStudentId(s.id) !== normalizedIdNumber,
  );
  if (emailExists) {
    return res
      .status(400)
      .json({
        error:
          "هذا البريد الإلكتروني مستخدم في حساب طالب آخر. لا يمكن تكرار البريد بين أكثر من طالب.",
      });
  }
  const exists = dbInstance
    .getStudents()
    .find((s) => normalizeStudentId(s.id) === normalizedIdNumber);
  if (exists) {
    // التمييز الواضح بين حالات الطالب الموجود مسبقاً:
    //  (٢) حساب مفعّل فعلاً  → لا تُنشئ جلسة تسجيل مؤقتة ولا تنتقل لشاشة الكود؛
    //       وجّهه لتسجيل الدخول ثم إضافة المقرر من داخل حسابه.
    //  (٣) حساب موجود غير مكتمل/غير مفعّل → اسمح بإكمال التفعيل عبر الكود بعد
    //       التحقق من كلمة المرور، دون كسر الحساب.
    const accountActivated = !!(exists as any).isActivated;
    if (accountActivated) {
      return res.status(409).json({
        error:
          "لديك حساب مفعل مسبقًا. سجّل الدخول أولًا، ثم أضف المقرر الجديد من داخل حسابك.",
        alreadyActivated: true,
        shouldLogin: true,
        email: (exists as any).email || email,
      });
    }
    if (!verifyPasswordFlexible((exists as any).passwordHash, password)) {
      return res.status(401).json({
        error:
          "الرقم الجامعي مسجل بالفعل ولكن الحساب غير مكتمل. أدخل كلمة مرور الحساب الحالية لإكمال التفعيل.",
      });
    }
    return res.json({
      success: true,
      message:
        "الحساب موجود لكنه غير مكتمل. أدخل كود المقرر لإكمال تفعيل حسابك.",
      email: (exists as any).email || email,
      existingStudent: true,
      needsActivation: true,
    });
  }

  // Generate unified verification code using the same accepted program format.
  // We no longer generate an OTP. The student must provide the Teacher's Join Code directly in the next step.

  // Return temporary register details so student enters their teacher code
  return res.json({
    success: true,
    message: "جاهز لتفعيل الحساب",
    email,
  });
});

// Confirm OTP (Now used to confirm Teacher's Join Code directly at signup)
app.post("/api/auth/verify-otp", (req, res) => {
  const { idNumber, name, semester, password } = req.body;
  const otp = String(req.body.otp || "").trim();
  if (!idNumber || !otp) {
    return res.status(400).json({ error: "الرجاء إدخال الرقم الجامعي ورمز الانضمام" });
  }
  return processStudentCourseActivation(req, res, idNumber, otp, {
    name,
    semester,
    password,
    email: req.body.email,
  });
});

// Passkey / Face ID support for PWA. Face ID itself remains handled by the OS;
// Mirعs verifies the WebAuthn/Passkey cryptographic result only.
app.post("/api/auth/passkey/register/start", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const role = String(req.body?.role || "").toLowerCase() as PasskeyRole;
    const userId = String(
      req.body?.userId || req.body?.idNumber || req.body?.email || "",
    ).trim();
    if (role !== "teacher" && role !== "student")
      return res.status(400).json({ error: "نوع الحساب غير صحيح." });
    const user = findPasskeyUser(role, userId);
    if (!user)
      return res
        .status(404)
        .json({ error: "لم يتم العثور على الحساب لتفعيل البصمة." });
    const existing = dbInstance
      .getPasskeyCredentials()
      .filter(
        (item: any) =>
          item.role === role &&
          String(item.userId).toLowerCase() === String(user.id).toLowerCase(),
      );
    const rpID = getPasskeyRpId(req);
    const options = await generateRegistrationOptions({
      rpName: PASSKEY_RP_NAME,
      rpID,
      userName:
        role === "teacher"
          ? String(user.raw.email || user.id)
          : String(user.id),
      userID: passkeyUserHandle(role, String(user.id)),
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: existing.map((item: any) => ({
        id: item.credentialId,
        transports: item.transports,
      })),
      authenticatorSelection: {
        // passkey حقيقي قابل للاكتشاف (resident) حتى يفتح Face ID / Touch ID مباشرة
        // بدون اختيار "use passcode" في كل مرة. مدعوم من كل أجهزة البصمة الحديثة.
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
      preferredAuthenticatorType: "localDevice",
      timeout: 60000,
    });
    pendingPasskeyRegistrations.set(options.challenge, {
      userId: String(user.id),
      role,
      challenge: options.challenge,
      startedAt: Date.now(),
      deviceToken: String(req.body?.deviceToken || ""),
    });
    return res.json({ success: true, options });
  } catch (e: any) {
    console.error("passkey register start failed", e);
    return res.status(500).json({ error: "تعذر بدء تفعيل البصمة حالياً." });
  }
});

app.post("/api/auth/passkey/register/finish", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const response = req.body?.response as RegistrationResponseJSON;
    if (!response)
      return res.status(400).json({ error: "استجابة البصمة غير مكتملة." });
    let matchedChallenge = "";
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => {
        if (pendingPasskeyRegistrations.has(challenge)) {
          matchedChallenge = challenge;
          return true;
        }
        return false;
      },
      expectedOrigin: getRequestOrigin(req),
      expectedRPID: getPasskeyRpId(req),
      requireUserVerification: true,
    });
    if (
      !verification.verified ||
      !verification.registrationInfo ||
      !matchedChallenge
    ) {
      return res.status(400).json({ error: "لم يكتمل تفعيل البصمة." });
    }
    const pending = pendingPasskeyRegistrations.get(matchedChallenge);
    if (!pending)
      return res.status(400).json({ error: "انتهت صلاحية طلب تفعيل البصمة." });
    pendingPasskeyRegistrations.delete(matchedChallenge);
    const user = findPasskeyUser(pending.role, pending.userId);
    if (!user) return res.status(404).json({ error: "الحساب لم يعد متاحاً." });
    const credential = verification.registrationInfo.credential;
    dbInstance.upsertPasskeyCredential({
      id: `${pending.role}-${user.id}-${credential.id}`,
      userId: String(user.id),
      userName: user.name,
      role: pending.role,
      credentialId: credential.id,
      publicKey: Array.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports as any,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      deviceToken: pending.deviceToken || getRequestDeviceToken(req),
      userAgent: String(req.headers["user-agent"] || ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    dbInstance.addActivityLog({
      studentId: pending.role === "student" ? String(user.id) : undefined,
      studentName: user.name,
      actorEmail:
        pending.role === "teacher"
          ? String((user.raw as any).email || user.id)
          : undefined,
      teacherEmail:
        pending.role === "teacher"
          ? String((user.raw as any).email || user.id)
          : undefined,
      action:
        pending.role === "teacher" ? "تفعيل بصمة الأستاذ" : "تفعيل بصمة الطالب",
      details: "تم تفعيل Passkey/Face ID لهذا الحساب على هذا الجهاز.",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "متصفح",
      browser: "Passkey",
      isViolationWarning: false,
    });
    return res.json({
      success: true,
      message: "تم تفعيل الدخول بالبصمة لهذا الجهاز.",
      role: pending.role,
      userId: String(user.id),
      userName: user.name,
    });
  } catch (e: any) {
    console.error("passkey register finish failed", e);
    return res
      .status(400)
      .json({ error: "تعذر اعتماد البصمة. حاول من نفس الجهاز والمتصفح." });
  }
});

app.post("/api/auth/passkey/status", (req, res) => {
  try {
    const role = String(req.body?.role || "").toLowerCase() as PasskeyRole;
    const userId = String(
      req.body?.userId || req.body?.idNumber || req.body?.email || "",
    ).trim();
    if (role !== "teacher" && role !== "student")
      return res.status(400).json({ error: "نوع الحساب غير صحيح." });
    const user = findPasskeyUser(role, userId);
    if (!user) return res.status(404).json({ error: "الحساب غير موجود." });
    const enabled = dbInstance
      .getPasskeyCredentials()
      .some(
        (item: any) =>
          item.role === role &&
          String(item.userId || "").toLowerCase() ===
            String(user.id || "").toLowerCase(),
      );
    return res.json({
      success: true,
      enabled,
      role,
      userId: String(user.id),
      userName: user.name,
    });
  } catch (e: any) {
    console.error("passkey status failed", e);
    return res.status(500).json({ error: "تعذر قراءة حالة البصمة حالياً." });
  }
});

app.get("/api/auth/passkey/devices", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !isAdminEmail(teacherEmail))
    return res.status(403).json({ error: "هذه الصلاحية للسوبر أدمن فقط." });
  const devices = dbInstance.getPasskeyCredentials().map((item: any) => ({
    credentialId: item.credentialId,
    role: item.role,
    userId: item.userId,
    userName: item.userName,
    deviceType: item.deviceType,
    backedUp: item.backedUp,
    deviceLabel: passkeyDeviceLabel(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastUsedAt: item.lastUsedAt,
  }));
  return res.json({ success: true, devices });
});

app.delete("/api/auth/passkey/devices/:credentialId", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !isAdminEmail(teacherEmail))
    return res.status(403).json({ error: "هذه الصلاحية للسوبر أدمن فقط." });
  const credentialId = String(req.params.credentialId || "");
  const saved = dbInstance
    .getPasskeyCredentials()
    .find((item: any) => item.credentialId === credentialId);
  if (!saved) return res.status(404).json({ error: "الجهاز غير موجود." });
  const ok = (dbInstance as any).deletePasskeyCredential(credentialId);
  if (!ok) return res.status(404).json({ error: "الجهاز غير موجود." });
  dbInstance.addActivityLog({
    studentId: saved.role === "student" ? saved.userId : undefined,
    studentName: saved.userName,
    actorEmail: teacherEmail,
    teacherEmail,
    action: "تم إلغاء جهاز موثوق",
    details: `تم إلغاء ثقة جهاز بصمة لحساب ${saved.userName || saved.userId}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة السوبر أدمن",
    browser: "Passkey",
    isViolationWarning: false,
  });
  return res.json({ success: true, message: "تم إلغاء ثقة الجهاز." });
});


app.post("/api/auth/passkey/recovery-reset", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !isAdminEmail(teacherEmail))
    return res.status(403).json({ error: "هذه الصلاحية للسوبر أدمن فقط." });
  const role = String(req.body?.role || "").toLowerCase() as PasskeyRole;
  const userId = normalizeArabicDigits(String(req.body?.userId || req.body?.idNumber || req.body?.email || "")).trim();
  if (role !== "teacher" && role !== "student")
    return res.status(400).json({ error: "حدد نوع الحساب قبل تهيئة البصمة." });
  const user = findPasskeyUser(role, userId);
  if (!user) return res.status(404).json({ error: "لم يتم العثور على الحساب المطلوب." });
  const before = dbInstance.getPasskeyCredentials().filter(
    (item: any) =>
      item.role === role &&
      String(item.userId || "").toLowerCase() === String(user.id || "").toLowerCase(),
  );
  before.forEach((item: any) => (dbInstance as any).deletePasskeyCredential(item.credentialId));
  dbInstance.addActivityLog({
    studentId: role === "student" ? String(user.id) : undefined,
    studentName: user.name,
    actorEmail: teacherEmail,
    teacherEmail,
    action: role === "teacher" ? "تهيئة بصمة معلم" : "تهيئة بصمة طالب",
    details: `تمت تهيئة البصمة لحساب ${user.name || user.id} بعد التحقق من الهوية؛ يستطيع صاحب الحساب تسجيل الدخول بكلمة المرور ثم تفعيل البصمة من جهازه من جديد.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة السوبر أدمن",
    browser: "Passkey",
    isViolationWarning: false,
  });
  return res.json({
    success: true,
    removed: before.length,
    message: before.length
      ? `تمت تهيئة البصمة وإلغاء ${before.length} جهاز موثوق. اطلب من صاحب الحساب تسجيل الدخول بكلمة المرور ثم تفعيل البصمة من جديد.`
      : "لا توجد بصمة محفوظة لهذا الحساب حالياً؛ يستطيع صاحب الحساب تفعيل البصمة بعد تسجيل الدخول بكلمة المرور.",
  });
});

app.post("/api/auth/passkey/login/start", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const roleRaw = String(req.body?.role || "").toLowerCase();
    const role =
      roleRaw === "teacher" || roleRaw === "student"
        ? (roleRaw as PasskeyRole)
        : undefined;
    const credentials = dbInstance
      .getPasskeyCredentials()
      .filter((item: any) => !role || item.role === role);
    if (!credentials.length)
      return res
        .status(404)
        .json({ error: "لا توجد بصمة مفعّلة بعد على هذا النظام." });
    const options = await generateAuthenticationOptions({
      rpID: getPasskeyRpId(req),
      // قائمة فارغة = تدفّق passkey "قابل للاكتشاف": يفتح Face ID مباشرة دون نافذة
      // "Use Passkey" واختيار الحساب. يتطلب أن تكون البصمة مسجّلة كـ resident
      // (انظر residentKey: "required" في التسجيل) — فيُعاد تفعيل البصمة مرة واحدة بعد التحديث.
      allowCredentials: [],
      userVerification: "required",
      timeout: 60000,
    });
    pendingPasskeyAuthentications.set(options.challenge, {
      challenge: options.challenge,
      startedAt: Date.now(),
      role,
    });
    return res.json({ success: true, options });
  } catch (e: any) {
    console.error("passkey login start failed", e);
    return res.status(500).json({ error: "تعذر بدء الدخول بالبصمة حالياً." });
  }
});

app.post("/api/auth/passkey/login/finish", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const response = req.body?.response as AuthenticationResponseJSON;
    if (!response?.id)
      return res
        .status(400)
        .json({ error: "استجابة الدخول بالبصمة غير مكتملة." });
    const saved = dbInstance
      .getPasskeyCredentials()
      .find((item: any) => item.credentialId === response.id);
    if (!saved)
      return res.status(404).json({ error: "هذه البصمة غير مسجلة في مِراس." });
    let matchedChallenge = "";
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => {
        const pending = pendingPasskeyAuthentications.get(challenge);
        if (pending && (!pending.role || pending.role === saved.role)) {
          matchedChallenge = challenge;
          return true;
        }
        return false;
      },
      expectedOrigin: getRequestOrigin(req),
      expectedRPID: getPasskeyRpId(req),
      credential: credentialForVerification(saved),
      requireUserVerification: true,
    });
    if (!verification.verified || !matchedChallenge)
      return res.status(401).json({ error: "لم يتم التحقق من البصمة." });
    pendingPasskeyAuthentications.delete(matchedChallenge);
    dbInstance.updatePasskeyCredential(saved.credentialId, {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date().toISOString(),
      userAgent: String(req.headers["user-agent"] || ""),
      deviceToken: getRequestDeviceToken(req) || saved.deviceToken,
    } as any);
    const user = findPasskeyUser(saved.role, saved.userId);
    if (!user)
      return res
        .status(404)
        .json({ error: "الحساب المرتبط بالبصمة غير موجود." });
    try {
      dbInstance.addActivityLog({
        studentId: saved.role === "student" ? String(user.id) : undefined,
        studentName: user.name,
        actorEmail:
          saved.role === "teacher"
            ? String((user.raw as any).email || user.id)
            : undefined,
        teacherEmail:
          saved.role === "teacher"
            ? String((user.raw as any).email || user.id)
            : undefined,
        action: "تم الدخول بالبصمة",
        details: "تم التحقق عبر Passkey/Face ID بنجاح.",
        ip: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "Unknown",
        os: "متصفح",
        browser: "Passkey",
        isViolationWarning: false,
      });
    } catch {}
    const payload: any = responseForPasskeyUser(req, saved, user);
    if (payload?.role === "teacher" && payload.teacher) {
      const authToken = createTeacherAuthPayload(req, res, payload.teacher);
      payload.authToken = authToken;
      payload.teacher = { ...payload.teacher, authToken };
    } else if (payload?.student) {
      const authToken = createStudentAuthPayload(req, res, payload.student);
      payload.authToken = authToken;
      payload.student = { ...payload.student, authToken };
    }
    return res.json(payload);
  } catch (e: any) {
    console.error("passkey login finish failed", e);
    try {
      const response = req.body?.response as AuthenticationResponseJSON;
      const saved = response?.id
        ? dbInstance
            .getPasskeyCredentials()
            .find((item: any) => item.credentialId === response.id)
        : null;
      dbInstance.addActivityLog({
        studentId: saved?.role === "student" ? saved.userId : undefined,
        studentName: saved?.userName || "محاولة بصمة",
        actorEmail: saved?.role === "teacher" ? saved.userId : undefined,
        teacherEmail: saved?.role === "teacher" ? saved.userId : undefined,
        action: "فشل الدخول بالبصمة",
        details: String(e?.message || "تعذر التحقق من البصمة"),
        ip: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "Unknown",
        os: "متصفح",
        browser: "Passkey",
        isViolationWarning: false,
      });
    } catch {}
    const msg = String(e?.message || "");
    const smart =
      msg.includes("انتهت") || msg.toLowerCase().includes("challenge")
        ? "أعد تسجيل الدخول مرة واحدة لتجديد البصمة."
        : "تعذّر الدخول بالبصمة. حاول مرة أخرى أو استخدم كلمة المرور.";
    return res.status(Number(e?.statusCode || 401)).json({ error: smart });
  }
});

// Student Login
// حد محاولات الدخول: حماية من تخمين كلمة المرور (brute force). 8 محاولات فاشلة لكل
// (IP + هوية) خلال 10 دقائق ⇒ قفل مؤقت 10 دقائق. ينجح الدخول يصفّر العداد.
const loginAttemptBuckets = new Map<
  string,
  { count: number; firstAt: number; blockedUntil: number }
>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const LOGIN_BLOCK_MS = 10 * 60 * 1000;
function loginRateKey(req: express.Request, identity: any): string {
  return `${req.ip || "127.0.0.1"}:${String(identity || "").toLowerCase()}`;
}
function checkLoginRateLimit(
  req: express.Request,
  identity: any,
): { limited: boolean; retryAfterSeconds: number } {
  const b = loginAttemptBuckets.get(loginRateKey(req, identity));
  if (b && b.blockedUntil > Date.now()) {
    return {
      limited: true,
      retryAfterSeconds: Math.ceil((b.blockedUntil - Date.now()) / 1000),
    };
  }
  return { limited: false, retryAfterSeconds: 0 };
}
function recordLoginFailure(req: express.Request, identity: any) {
  const key = loginRateKey(req, identity);
  const now = Date.now();
  let b = loginAttemptBuckets.get(key);
  if (!b || now - b.firstAt > LOGIN_WINDOW_MS)
    b = { count: 0, firstAt: now, blockedUntil: 0 };
  b.count += 1;
  if (b.count >= LOGIN_MAX_FAILS) b.blockedUntil = now + LOGIN_BLOCK_MS;
  loginAttemptBuckets.set(key, b);
}
function recordLoginSuccess(req: express.Request, identity: any) {
  loginAttemptBuckets.delete(loginRateKey(req, identity));
}

function hashPasswordSecure(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const key = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt:${salt}:${key}`;
}

function verifyPasswordFlexible(stored: any, submitted: any) {
  const clean = String(submitted || "").trim();
  const saved = String(stored || "");
  if (saved.startsWith("scrypt:")) {
    const [, salt, key] = saved.split(":");
    if (!salt || !key) return false;
    const candidate = crypto.scryptSync(clean, salt, 64).toString("hex");
    try { return crypto.timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(candidate, "hex")); }
    catch { return false; }
  }
  if (saved.startsWith("sha256:")) {
    const candidate = "sha256:" + crypto.createHash("sha256").update(clean).digest("hex");
    return saved === candidate;
  }
  return saved === clean;
}

function isWeakDefaultPassword(password: any) {
  const v = String(password || "").trim();
  return !v || v === "123456" || v === "000000" || v.length < 6;
}

app.post("/api/auth/login", (req, res) => {
  const { idNumber, password } = req.body;
  if (!idNumber || !password) {
    return res
      .status(400)
      .json({ error: "يرجى إدخال الرقم الجامعي وكلمة المرور" });
  }

  const identity = String(idNumber).trim();
  const loginLimit = checkLoginRateLimit(req, identity);
  if (loginLimit.limited) {
    res.setHeader("Retry-After", String(loginLimit.retryAfterSeconds));
    return res
      .status(429)
      .json({
        error: `محاولات دخول كثيرة. حاول بعد ${Math.ceil(loginLimit.retryAfterSeconds / 60)} دقيقة.`,
      });
  }
  const cleanPassword = String(password).trim();
  const normalizedIdentity = normalizeArabicDigits(identity).trim().toLowerCase();
  const digitsIdentity = normalizeStudentId(identity);

  // MIRAS_FIXED_TEACHER_LOGIN_PATCH
  // Temporary Cloud Run bootstrap fallback for trusted teacher/admin accounts.
  // Keeps passwords hashed and avoids storing plaintext credentials in code.
  const fixedTeacherLogins: Record<string, any> = {
    "ah.alfailakawi@paaet.edu.kw": {
      id: "ah.alfailakawi@paaet.edu.kw",
      email: "ah.alfailakawi@paaet.edu.kw",
      name: "د. أحمد حسين الفيلكاوي",
      role: "admin",
      isActive: true,
      passwordHash: "sha256:2a57b6d36e9831b0453f9c25e37250c9752f318a63ef38dfd51027bb8091cc25",
    },
    "ada.alenezi@paaet.edu.kw": {
      id: "ada.alenezi@paaet.edu.kw",
      email: "ada.alenezi@paaet.edu.kw",
      name: "د. عبدالعزيز دخيل العنزي",
      role: "teacher",
      isActive: true,
      passwordHash: "sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678",
    },
  };
  const fixedTeacher = fixedTeacherLogins[normalizedIdentity];
  if (fixedTeacher && verifyPasswordFlexible(fixedTeacher.passwordHash, cleanPassword) && fixedTeacher.isActive) {
    recordLoginSuccess(req, identity);
    const effectiveRole = isAdminEmail(fixedTeacher.email) ? "admin" : fixedTeacher.role || "teacher";
    const authToken = createTeacherAuthPayload(req, res, { ...fixedTeacher, role: effectiveRole });
    return res.json({
      success: true,
      role: effectiveRole,
      authToken,
      teacher: {
        id: fixedTeacher.id,
        name: fixedTeacher.name,
        email: fixedTeacher.email,
        role: effectiveRole,
        authToken,
      },
    });
  }
  const teacher = dbInstance
    .getTeachers()
    .find((t: any) => {
      const aliases = [
        t.email,
        t.id,
        t.phone,
        t.mobile,
        ...(Array.isArray(t.loginAliases) ? t.loginAliases : []),
      ]
        .map((value: any) => normalizeArabicDigits(String(value || "")).trim().toLowerCase())
        .filter(Boolean);
      return aliases.some((alias: string) => {
        if (alias === normalizedIdentity) return true;
        const aliasDigits = normalizeStudentId(alias);
        return !!digitsIdentity && !!aliasDigits && aliasDigits === digitsIdentity;
      });
    });
  if (teacher) {
    const teacherPasswordMatches = verifyPasswordFlexible(teacher.passwordHash, cleanPassword);
    if (!teacherPasswordMatches || !teacher.isActive) {
      recordLoginFailure(req, identity);
      return res.status(401).json({ error: "بيانات الأستاذ غير صحيحة" });
    }
    recordLoginSuccess(req, identity);
    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: "دخول أستاذ",
      details: `تم تسجيل دخول الأستاذ ${teacher.email}`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "متصفح",
      browser: "لوحة الأستاذ",
      isViolationWarning: false,
    });
    const effectiveRole = isAdminEmail(teacher.email) ? "admin" : teacher.role || "teacher";
    const authToken = createTeacherAuthPayload(req, res, { ...teacher, role: effectiveRole });
    return res.json({
      success: true,
      role: effectiveRole,
      authToken,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        role: effectiveRole,
        authToken,
      },
    });
  }

  // الطلبة يبقون كما طلب المستخدم: دخولهم بالرقم الجامعي فقط.
  // البريد/الهاتف مخصص لحسابات الأساتذة أعلاه ولا يفتح حساب طالب.
  const student = /^\d+$/.test(digitsIdentity)
    ? dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === digitsIdentity)
    : null;
  if (!student) {
    recordLoginFailure(req, identity);
    return res
      .status(401)
      .json({ error: "الرقم الجامعي أو كلمة المرور غير صحيحة" });
  }

  if (!verifyPasswordFlexible(student.passwordHash, cleanPassword)) {
    recordLoginFailure(req, identity);
    return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
  }
  recordLoginSuccess(req, identity);

  if ((student as any).isAccessBlocked) {
    return res
      .status(403)
      .json({
        error:
          (student as any).accessBlockReason ||
          "تم إيقاف هذا الحساب مؤقتاً من قبل أستاذ المقرر.",
      });
  }

  // Device Lock verification. SEB has its own temporary, course-scoped exam pass, so it must not break the student's original device lock.
  const sebLoginPass = isSebRequest(req) ? getValidSebPass(req, student) : null;
  const sessionValidation = validateSessionFingerprint(req, student);
  if (!sessionValidation.isValid && !sebLoginPass) {
    // Record login violation in audit logs
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "انتهاك الأجهزة",
      details:
        "محاولة تسجيل دخول فاشلة بسبب تجاوز الحد الأقصى للأجهزة (جهاز ثالث)",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "مجهول",
      browser: "مجهول",
      isViolationWarning: true,
    });
    notifyTeachersForSection(
      student.sectionCode,
      "محاولة دخول مرفوضة",
      `${student.name}: ${sessionValidation.error || "مخالفة أجهزة"}`,
      { type: "login_blocked", studentId: student.id, link: "/" },
    );
    return res
      .status(sessionValidation.statusCode || 403)
      .json({ error: sessionValidation.error });
  }
  if (!sessionValidation.isValid && sebLoginPass) {
    consumeSebPass(sebLoginPass);
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "دخول SEB بتصريح مؤقت",
      details: `تم السماح للطالب بالدخول من Safe Exam Browser للاختبار ${sebLoginPass.examId} في مقرر ${sebLoginPass.courseCode} دون فك ربط جهازه الأصلي.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "SEB",
      browser: "SEB Pass",
      isViolationWarning: false,
    });
  }

  // Log successful login (+ تنظيف ذاتي سحابي للأكواد الشبح، مدمج بلا نداء إضافي)
  const loginGhostPatch = pruneGhostCoursePatch(student) || {};
  dbInstance.updateStudent(student.id, {
    lastLoginDate: new Date().toISOString(),
    ...loginGhostPatch,
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "تسجيل دخول",
    details: "تسجيل دخول ناجح إلى المنصة",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "مكتشف تلقائياً",
    browser: "متصفح الويب",
    isViolationWarning: false,
  });

  const refreshedLoginStudent =
    dbInstance.getStudents().find((st: any) => normalizeStudentId(st.id) === normalizeStudentId(student.id)) ||
    student;
  const loginEnrollments = getStudentEnrollmentDetails(refreshedLoginStudent);
  const responseStudent: any = sanitizeStudentForClient(
    sebLoginPass
      ? {
          ...refreshedLoginStudent,
          sectionCode: sebLoginPass.courseCode,
          activeSebExamId: sebLoginPass.examId,
        }
      : refreshedLoginStudent,
    loginEnrollments,
  );
  const authToken = createStudentAuthPayload(req, res, responseStudent);
  return res.json({
    success: true,
    authToken,
    student: { ...responseStudent, authToken },
    sebSession: describeSebPass(sebLoginPass || null),
  });
});

// Save learning fingerprint & generate pathway code
app.post("/api/learning-fingerprint", (req, res) => {
  const { studentId, fingerprintAnswers } = req.body;
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(studentId));
  if (!student) {
    return res.status(404).json({ error: "الطالب غير موجود" });
  }

  const {
    techLevel,
    projectType,
    prefField,
    fears,
    workStyle,
    targetGrade,
    goal,
  } = fingerprintAnswers;

  // Build Pathway Code based on selections
  // System rules map choice to token
  const fieldToken =
    prefField === "الذكاء الاصطناعي"
      ? "AI"
      : prefField === "الواقع المعزز"
        ? "AR"
        : prefField === "الألعاب التعليمية"
          ? "GAME"
          : prefField === "التصميم التعليمي"
            ? "DSGN"
            : "E-LEARN";

  const styleToken = projectType === "تطبيقي وعملي" ? "APP" : "ANLYS";
  const numToken = Math.floor(10 + Math.random() * 90).toString(); // dynamic random verification node
  const sectionPart = student.sectionCode || "TECH";

  const pathwayCode = `${fieldToken}-${styleToken}-${sectionPart}-${numToken}`;
  const strengths = [
    "الاهتمام بمجال " + prefField,
    "نمط تعلم " +
      (projectType === "تطبيقي وعملي" ? "تطبيقي نشط" : "تحليلي عميق"),
  ];
  const weaknesses = fears ? ["خوف من: " + fears] : [];
  const recommendations = [
    `تم تهيئة مسار دراستك المخصص بالكامل ليتناسب مع اهتمامك بـ ${prefField}.`,
    `ننصحك بمراجعة تمارين الفصل الرابع للحصول على تدريب يعضد نقاط ضعفك.`,
    `مشروعك الشخصي يتطلب التركيز العالي وتطبيق مهارات التصميم.`,
  ];

  dbInstance.updateStudent(student.id, {
    pathwayCode,
    learningStyle: fingerprintAnswers,
    strengths,
    weaknesses,
    recommendations,
    progress: 10, // first milestone completed!
  });

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "بصمة التعلم لبناء المسار",
    details: `تم توليد بصمة التعلم والمسار الدراسي الخاص للطالب بنجاح: ${pathwayCode}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "نظام التحقق الذاتي",
    browser: "متصفح",
    isViolationWarning: false,
  });

  return res.json({
    success: true,
    student: {
      ...(dbInstance.getStudents().find((s) => s.id === student.id) as any),
      enrollments: getStudentEnrollmentDetails(
        dbInstance.getStudents().find((s) => s.id === student.id),
      ),
    },
  });
});

// Single Student Detail
app.get("/api/students/:id", (req, res) => {
  setNoCache(res);
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(req.params.id));
  if (!student) {
    return res.status(404).json({ error: "الطالب غير موجود" });
  }

  // Ensure and filter out projects/submissions for student
  const filteredProjects = dbInstance
    .getPersonalizedProjects()
    .filter((p) => p.studentId === student.id);
  const submissions = dbInstance
    .getExerciseSubmissions()
    .filter((s) => s.studentId === student.id);
  const quizzes = dbInstance
    .getQuizSubmissions()
    .filter((q) => q.studentId === student.id);

  return res.json({
    student: {
      ...(student as any),
      enrollments: getStudentEnrollmentDetails(student),
    },
    projects: filteredProjects.filter(
      (p: any) =>
        !p.courseCode || !isStudentSuspendedInCourse(student, p.courseCode),
    ),
    exerciseSubmissions: withLiveStudentNames(submissions),
    quizSubmissions: withLiveStudentNames(quizzes),
    enrollments: getStudentEnrollmentDetails(student),
  });
});

app.get("/api/students/:id/session-status", (req, res) => {
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(req.params.id));
  if (!student)
    return res.json({
      blocked: true,
      reason: "هذا الحساب لم يعد موجوداً في النظام.",
    });
  const activationCode = (student as any).activationCode;
  const linkedCode = activationCode
    ? dbInstance
        .getJoinCodes()
        .find(
          (jc: any) =>
            normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode),
        )
    : null;
  if ((student as any).isAccessBlocked)
    return res.json({
      blocked: true,
      reason:
        (student as any).accessBlockReason ||
        "تم إيقاف هذا الحساب مؤقتاً من قبل أستاذ المقرر.",
    });
  if (
    activationCode &&
    (!linkedCode ||
      String((linkedCode as any).status || "") === "revoked" ||
      String((linkedCode as any).status || "") === "deleted")
  ) {
    const hasAnyPreservedCourse =
      getStudentActiveCourseCodes(student).length > 0 ||
      activatedCourseCodesForStudent(student).length > 0 ||
      (Array.isArray((student as any).enrollments) &&
        (student as any).enrollments.some((entry: any) =>
          entry?.isActive !== false &&
          String(entry?.status || "").toLowerCase() !== "locked" &&
          String(entry?.status || "").toLowerCase() !== "suspended" &&
          String(entry?.courseCode || entry?.sectionCode || "").trim(),
        ));
    if (!hasAnyPreservedCourse) {
      return res.json({
        blocked: false,
        name: student.name,
        accessResetAt: String((student as any).accessResetAt || ""),
        enrollments: getStudentEnrollmentDetails(student),
      });
    }
  }
  return res.json({
    blocked: false,
    name: student.name,
    accessResetAt: String((student as any).accessResetAt || ""),
    enrollments: getStudentEnrollmentDetails(student),
  });
});

// Save webcam live screenshot
app.post("/api/students/:id/snapshot", (req, res) => {
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "الطالب غير كائن" });

  const { snapshot, purpose, verificationCode } = req.body;
  dbInstance.updateStudent(student.id, { webcamSnapshot: snapshot });

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "تحقق حي خفيف",
    details: `تم التقاط صورة حية بنجاح للتحقق قبل الإجراء: ${purpose || "مهمة رئيسية"}. كود التحقق الأكاديمي لليوم: ${verificationCode}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "صورة كاميرا حية",
    browser: "منصة مِراس",
    isViolationWarning: false,
  });

  return res.json({ success: true });
});

// Log any student verification failures / security violations
app.post("/api/students/:id/log-violation", (req, res) => {
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "الطالب غير كائن" });

  const { details, action } = req.body;

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: action || "فشل التحقق المعرفي",
    details: details || "أجاب بجواب خاطئ أثناء تدقيق الأمان الذاتي",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "نظام التحقق",
    browser: "منصة مِراس",
    isViolationWarning: true,
  });

  // أبلِغ المعلم بتنبيهات النزاهة داخل الاختبار (تصغير الشاشة، اشتباه أدوات المطور، ...).
  // سابقاً كانت تُسجَّل في السجل فقط ولا تصل جرس المعلم. كلمة "نزاهة" في العنوان تمرّ
  // فلتر الإشعارات الحرجة، ومفتاح log-violation مُحصَّن ضد التكرار من جهة العميل.
  notifyTeachersForSection(
    student.sectionCode,
    String(action || "تنبيه نزاهة داخل الاختبار"),
    `${student.name}: ${String(details || "تنبيه نزاهة أثناء الاختبار")}`,
    { type: "exam_warning", studentId: student.id, link: "/" },
  );

  return res.json({ success: true });
});

// Activate / Deactivate student from Admin or pay
app.post("/api/students/:id/activate", (req, res) => {
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "الطالب غير مسجل" });

  const { isPaid } = req.body;
  dbInstance.updateStudent(student.id, { isPaid });

  return res.json({
    success: true,
    student: dbInstance.getStudents().find((s) => s.id === student.id),
  });
});

// Reset Student Devices Limit Lock (by teacher)
app.post("/api/students/:id/reset-devices", (req, res) => {
  const student = dbInstance.getStudents().find((s) => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !teacherCanManageStudent(student, teacherEmail)) {
    return res
      .status(403)
      .json({ error: "تبديل الجهاز يتم من حساب أستاذ المقرر فقط." });
  }

  const browser = req.headers["user-agent"] || "Unknown Browser";
  const ip = req.ip || "127.0.0.1";
  const retiredDeviceFingerprints = Array.isArray((student as any).devices)
    ? (student as any).devices
        .map((d: any) => String(d || "").trim())
        .filter(Boolean)
    : [];
  const activationCode = String((student as any).activationCode || "").trim();
  const linkedJoinCodes = dbInstance.getJoinCodes().filter((jc: any) => {
    const sameCode =
      activationCode &&
      normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode);
    const sameStudent =
      normalizeStudentId(jc.studentId || jc.usedByStudentId || "") ===
      normalizeStudentId(student.id);
    return sameCode || sameStudent;
  });
  const retiredDeviceTokens = linkedJoinCodes
    .map((jc: any) => String(jc.activationDeviceToken || "").trim())
    .filter(Boolean);
  linkedJoinCodes.forEach((jc: any) => {
    dbInstance.updateJoinCode(jc.code, {
      activationDeviceFingerprint: "",
      activationDeviceToken: "",
      activationDeviceServerHash: "",
    } as any);
  });

  dbInstance.updateStudent(student.id, {
    devices: [],
    pendingDeviceTransfer: true,
    retiredDeviceFingerprints,
    retiredDeviceTokens,
    accessResetAt: new Date().toISOString(),
    deviceSessionInvalidatedAt: new Date().toISOString(),
    isAccessBlocked: false,
    accessBlockReason: "",
  } as any);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    action: "إعادة تعيين الأجهزة",
    details: `قام الأستاذ بفصل جميع الأجهزة القديمة وتجهيز الحساب لاعتماد جهاز جديد عند أول دخول للطالب.`,
    ip,
    userAgent: browser,
    os: "لوحة الأستاذ",
    browser: "متصفح ويب",
    isViolationWarning: false,
  });

  return res.json({ success: true, devices: [], pendingDeviceTransfer: true });
});

function resolveExamLockSubject(req: express.Request, res: express.Response) {
  const studentId = String(
    (req.body as any)?.studentId || req.query?.studentId || "",
  ).trim();
  const examId = String(
    (req.body as any)?.examId ||
      (req.body as any)?.chapterId ||
      req.query?.examId ||
      req.query?.chapterId ||
      "",
  ).trim();
  const student = dbInstance.getStudents().find((s) => s.id === studentId);
  if (!student) {
    res.status(404).json({ error: "الطالب غير موجود" });
    return null;
  }
  const exam = activeTeacherExams().find(
    (item: any) => String(item.id) === examId,
  );
  if (!exam) {
    res.status(404).json({ error: "الاختبار غير موجود" });
    return null;
  }
  const teacherAuthorizedSebReturn = hasTeacherAuthorizedSebReturnException(
    exam.id,
    student.id,
  );
  if (
    !studentHasEnrollmentInCourse(student, exam.courseCode || student.sectionCode) &&
    !teacherAuthorizedSebReturn
  ) {
    res
      .status(403)
      .json({ error: "هذا الاختبار غير مخصص لأحد مقرراتك المفعلة." });
    return null;
  }
  const now = Date.now();
  if (exam.open && new Date(exam.open).getTime() > now) {
    res.status(403).json({ error: "لم يبدأ وقت إتاحة هذا الاختبار بعد." });
    return null;
  }
  if (
    exam.close &&
    new Date(exam.close).getTime() + 24 * 60 * 60 * 1000 < now &&
    !teacherAuthorizedSebReturn
  ) {
    res.status(403).json({ error: "انتهى وقت إتاحة هذا الاختبار." });
    return null;
  }
  return { student, exam };
}

app.post("/api/exam-lock/acquire", (req, res) => {
  const subject = resolveExamLockSubject(req, res);
  if (!subject) return;
  const result = acquireExamLockForRequest(req, subject.student, subject.exam);
  if (isExamLockFailure(result))
    return res
      .status(result.status)
      .json({ error: result.error, reason: result.reason });
  return res.json({
    success: true,
    activeExamSessionId: result.session.sessionId,
    session: result.session,
  });
});

app.post("/api/exam-lock/heartbeat", (req, res) => {
  const subject = resolveExamLockSubject(req, res);
  if (!subject) return;
  const result = heartbeatExamLockForRequest(req, subject.student, subject.exam);
  if (isExamLockFailure(result))
    return res
      .status(result.status)
      .json({ error: result.error, reason: result.reason });
  return res.json({
    success: true,
    activeExamSessionId: result.session.sessionId,
    lastHeartbeatAt: result.session.lastHeartbeatAt,
  });
});

app.post("/api/exam-lock/release", (req, res) => {
  const subject = resolveExamLockSubject(req, res);
  if (!subject) return;
  const rawStatus = String((req.body as any)?.status || "").trim();
  const status =
    rawStatus === "violated" || rawStatus === "expired"
      ? (rawStatus as "violated" | "expired")
      : "finished";
  const session = markExamLockStatusForRequest(
    req,
    subject.student,
    subject.exam,
    status,
    String((req.body as any)?.reason || status),
  );
  return res.json({ success: true, session });
});

app.post("/api/exam-integrity/pulse", (req, res) => {
  const subject = resolveExamLockSubject(req, res);
  if (!subject) return;
  const body = (req.body || {}) as any;
  const pulseType = String(body.pulseType || "local_vision").slice(0, 80);
  const label = sanitizePublicMessageText(String(body.label || "نبضة رادار النزاهة"));
  const now = new Date().toISOString();
  const rowId = `exam-${subject.exam.id}-${subject.student.id}`;
  const previous = dbInstance
    .getTeacherSubmissions()
    .find((item: any) => String(item.id) === rowId);
  const signal = {
    key: `local-vision-${pulseType}`,
    pulseType,
    reason: label,
    source: "localVisionAnalyzer",
    at: now,
    mode: String(body.mode || ""),
    privacy: "metadata_only_no_images_no_video",
    details: body.details || {},
  };
  if (!previous || !isProtectedFinalExamStatus(previous)) {
    const previousWarnings = Array.isArray((previous as any)?.integrityWarnings)
      ? (previous as any).integrityWarnings
      : [];
    upsertRuntimeTeacherSubmission({
      ...(previous || {}),
      id: rowId,
      kind: "exam",
      activityId: subject.exam.id,
      activityTitle: subject.exam.title,
      courseCode: (subject.exam as any).courseCode || subject.student.sectionCode,
      studentId: subject.student.id,
      studentName: subject.student.name,
      answerText: previous?.answerText || "دخل الطالب الاختبار وبدأت محاولته؛ الإجابات قيد الحل الآن.",
      status: previous?.status || EXAM_IN_PROGRESS_STATUS,
      submittedAt: previous?.submittedAt || now,
      lastIntegrityPulseAt: now,
      lastIntegrityPulseType: pulseType,
      integrityWarnings: [...previousWarnings, signal].slice(-30),
    });
  }
  notifyUsers(
    (token) => token.role === "teacher",
    "نبضة رادار نزاهة",
    `${subject.exam.title || "اختبار"} — ${subject.student.name || subject.student.id}: ${label}`,
    {
      type: "exam_integrity_pulse",
      examId: String(subject.exam.id),
      studentId: String(subject.student.id),
      courseCode: String((subject.exam as any).courseCode || subject.student.sectionCode || ""),
      pulseType,
    },
  );
  return res.json({ success: true, pulse: signal });
});


// ================= QUIZ GENERATION & SUBMISSION =================

// Generate unique custom Quiz for Student
app.get("/api/quizzes/generate", (req, res) => {
  const { studentId, chapterId } = req.query;
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });
  const sebPassForRequest = getActiveSebAttempt(req, student);
  if (
    sebPassForRequest &&
    String(chapterId) !== String(sebPassForRequest.examId)
  ) {
    rejectSebPass(
      req,
      sebPassForRequest,
      `رفض توليد اختبار خارج نطاق نفق SEB: المطلوب ${String(chapterId)} والمسموح ${sebPassForRequest.examId}.`,
    );
    return res
      .status(403)
      .json({ error: "جلسة SEB الحالية مخصصة لاختبار واحد فقط." });
  }

  const officialExam = activeTeacherExams().find(
    (exam: any) => String(exam.id) === String(chapterId),
  );
  let activeExamSessionForResponse: ExamSession | null = null;
  if (officialExam) {
    const activeSebAttempt = getActiveSebAttempt(req, student, officialExam.id);
    const teacherAuthorizedSebReturn = hasTeacherAuthorizedSebReturnException(
      officialExam.id,
      student.id,
    );
    if (
      !studentHasEnrollmentInCourse(
        student,
        officialExam.courseCode || student.sectionCode,
      ) &&
      !teacherAuthorizedSebReturn
    ) {
      return res
        .status(403)
        .json({ error: "هذا الاختبار غير مخصص لأحد مقرراتك المفعلة." });
    }
    if (
      officialExam.seb?.enabled &&
      !activeSebAttempt &&
      !teacherAuthorizedSebReturn
    ) {
      rejectSebPass(
        req,
        getValidSebPass(req, student, officialExam.id),
        `رفض توليد الاختبار ${officialExam.id}: لا توجد محاولة SEB نشطة مطابقة.`,
      );
      return res
        .status(403)
        .json({
          error:
            "هذا الاختبار يتطلب جلسة SEB آمنة مفعلة لهذا الطالب وهذا الاختبار. اضغط زر تشغيل SEB من بطاقة الاختبار؛ إذا كنت داخل SEB اضغط متابعة الاختبار ولا تحمّل ملف إعدادات جديد.",
        });
    }
    const now = Date.now();
    if (officialExam.open && new Date(officialExam.open).getTime() > now)
      return res
        .status(403)
        .json({ error: "لم يبدأ وقت إتاحة هذا الاختبار بعد." });
    if (
      officialExam.close &&
      new Date(officialExam.close).getTime() + 24 * 60 * 60 * 1000 < now &&
      !teacherAuthorizedSebReturn
    )
      return res.status(403).json({ error: "انتهى وقت إتاحة هذا الاختبار." });
    const lockResult = acquireExamLockForRequest(req, student, officialExam);
    if (isExamLockFailure(lockResult)) {
      return res.status(lockResult.status).json({
        error: lockResult.error,
        reason: lockResult.reason,
      });
    }
    activeExamSessionForResponse = lockResult.session;
  }

  const previousQuizAttempt = dbInstance
    .getQuizSubmissions()
    .find(
      (q: any) =>
        q.studentId === student.id && String(q.chapterId) === String(chapterId),
    );
  const returnedByTeacher = officialExam
    ? isExamReturnedForStudent(officialExam.id, student.id)
    : false;
  if (
    previousQuizAttempt &&
    returnedByTeacher &&
    String((previousQuizAttempt as any).status || "") !== "returned"
  ) {
    dbInstance.updateQuizSubmission(previousQuizAttempt.id, {
      status: "returned",
      returnedAt: new Date().toISOString(),
    } as any);
    (previousQuizAttempt as any).status = "returned";
  }
  const previousAttemptStatus = String(
    (previousQuizAttempt as any)?.status || "",
  );
  // إعادة تحميل/محاولة جديدة لتوليد الأسئلة بينما جلسة SEB الحالية لا تزال
  // نشطة لهذا الاختبار بالضبط تعني أن الطالب لم يخرج من محاولته فعلياً (مجرد
  // إعادة تحميل الصفحة)، فلا تُعتبر "محاولة ثانية بعد ظهور الأسئلة" ولا تُرصد
  // لها درجة صفر أو حالة انسحاب. تُعاد نفس المحاولة بأسئلة جديدة فقط.
  const isReloadOfActiveSebAttempt =
    previousAttemptStatus === "started" && !!sebPassForRequest;
  // نفس المبدأ بالضبط للاختبار العادي (غير SEB): إذا انقطعت الجلسة بشكل غير
  // متوقع (تحديث صفحة، انقطاع شبكة، إغلاق التطبيق من النظام) قبل أن تصل أي
  // إشارة خروج فعلية للسيرفر، تبقى المحاولة الداخلية "started" فقط. عودة
  // الطالب لفتح الاختبار من نفس جهازه بالضبط لا تُعتبر دخولاً ثانياً مشبوهاً،
  // فلا يُرصد له صفر تلقائياً — تماماً كما يحدث في SEB أعلاه.
  const isReloadOfActiveRegularAttempt =
    previousAttemptStatus === "started" &&
    !sebPassForRequest &&
    !!String((previousQuizAttempt as any)?.deviceFingerprint || "").trim() &&
    String((previousQuizAttempt as any)?.deviceFingerprint || "") ===
      getRequestDeviceFingerprint(req);
  const isReloadOfActiveAttempt =
    isReloadOfActiveSebAttempt || isReloadOfActiveRegularAttempt;
  if (
    previousQuizAttempt &&
    previousAttemptStatus === "started" &&
    officialExam &&
    !isReloadOfActiveAttempt
  ) {
    const zeroSubmission = finalizeExamAttemptAsZero(req, {
      student,
      exam: officialExam,
      pass: sebPassForRequest,
      submission: previousQuizAttempt,
      reason:
        "تمت محاولة تحميل الاختبار مرة أخرى بعد ظهور الأسئلة سابقاً ودون تسليم؛ تم تثبيت الدرجة التي وصل لها الطالب.",
    });
    return res
      .status(409)
      .json({
        error:
          "تم فتح هذا الاختبار سابقاً وظهرت أسئلته. أغلقت المحاولة ورُصدت الدرجة التي وصلت لها، ولا يمكن الدخول مرة ثانية إلا إذا أعاده الأستاذ.",
        submission: zeroSubmission,
      });
  }
  if (
    previousQuizAttempt &&
    previousAttemptStatus !== "returned" &&
    !isReloadOfActiveAttempt
  ) {
    return res
      .status(409)
      .json({
        error:
          "تم فتح هذا الاختبار سابقاً أو الخروج منه. لا يمكن الدخول مرة ثانية إلا إذا أعاده الأستاذ لك.",
        submission: previousQuizAttempt,
      });
  }
  const previousGeneratedQuestions = sanitizePublicQuizQuestions(
    (previousQuizAttempt as any)?.generatedQuestions || [],
  );
  const isReturnedCheatingQuizAttempt =
    !!previousQuizAttempt &&
    previousAttemptStatus === "returned" &&
    (isCheatingAttemptSubmissionServer(previousQuizAttempt) ||
      String((previousQuizAttempt as any)?.finishReason || "").trim() ===
        EXAM_CHEATING_ATTEMPT_STATUS);
  if (isReturnedCheatingQuizAttempt && previousGeneratedQuestions.length > 0) {
    const restartedAttempt = {
      ...(previousQuizAttempt as any),
      status: "started",
      startedAt: new Date().toISOString(),
      deviceFingerprint: getRequestDeviceFingerprint(req),
      generatedQuestions: previousGeneratedQuestions,
      generatedQuestionIds:
        (previousQuizAttempt as any)?.generatedQuestionIds ||
        (previousQuizAttempt as any)?.previousGeneratedQuestionIds ||
        previousGeneratedQuestions.map((q: any) => q.id),
      answers: {},
      draftAnswers: {},
      matchedQuestions: [],
      score: 0,
      totalPoints: 0,
    };
    dbInstance.updateQuizSubmission(previousQuizAttempt.id, restartedAttempt);
    if (officialExam) {
      upsertRuntimeTeacherSubmission({
        id: `exam-${officialExam.id}-${student.id}`,
        kind: "exam",
        activityId: officialExam.id,
        activityTitle: officialExam.title,
        courseCode: (officialExam as any).courseCode || student.sectionCode,
        studentId: student.id,
        studentName: student.name,
        answerText:
          "دخل الطالب الاختبار وبدأت محاولته؛ الإجابات قيد الحل الآن.",
        status: EXAM_IN_PROGRESS_STATUS,
        submittedAt: new Date().toISOString(),
      });
    }
    return res.json({
      chapterId,
      officialExamId: officialExam?.id,
      activeExamSessionId: activeExamSessionForResponse?.sessionId,
      questions: previousGeneratedQuestions,
    });
  }
  if (isReloadOfActiveAttempt && previousGeneratedQuestions.length > 0) {
    if (officialExam) {
      const reloadRowId = `exam-${officialExam.id}-${student.id}`;
      const reloadExistingRow = dbInstance
        .getTeacherSubmissions()
        .find((item: any) => String(item.id) === reloadRowId);
      // لا تُعِد تأكيد "قيد الحل" فوق حالة نهائية (غش/انسحاب/خروج/انتهى/رصد)
      // حتى لو أعاد الطالب تحميل صفحة محاولة عالقة بعد إخراجه.
      if (!isProtectedFinalExamStatus(reloadExistingRow)) {
        upsertRuntimeTeacherSubmission({
          id: reloadRowId,
          kind: "exam",
          activityId: officialExam.id,
          activityTitle: officialExam.title,
          courseCode: (officialExam as any).courseCode || student.sectionCode,
          studentId: student.id,
          studentName: student.name,
          answerText:
            "دخل الطالب الاختبار وبدأت محاولته؛ الإجابات قيد الحل الآن.",
          status: EXAM_IN_PROGRESS_STATUS,
          submittedAt:
            (previousQuizAttempt as any)?.startedAt || new Date().toISOString(),
        });
      }
    }
    return res.json({
      chapterId,
      officialExamId: officialExam?.id,
      activeExamSessionId: activeExamSessionForResponse?.sessionId,
      questions: previousGeneratedQuestions,
    });
  }

  const examTeacherEmail = String(
    officialExam?.createdBy ||
      sectionOwnerEmail(officialExam?.courseCode || student.sectionCode) ||
      "ah.alfailakawi@paaet.edu.kw",
  ).toLowerCase();

  const chapterQuestions = officialExam
    ? activeQuestionBank().filter((q: any) =>
        questionMatchesOfficialExamServer(q, officialExam, examTeacherEmail),
      )
    : activeQuestionBank().filter((q: any) => {
        const sameChapter = questionMatchesSelectedCategoriesServer(
          q,
          [chapterId],
          examTeacherEmail,
        );
        return (
          sameChapter &&
          q.isApproved === true &&
          questionBelongsToTeacherServer(q, examTeacherEmail)
        );
      });

  if (chapterQuestions.length === 0) {
    return res
      .status(404)
      .json({
        error: officialExam
          ? "لا توجد أسئلة معتمدة في بنك الأسئلة لهذا الاختبار والمقرر."
          : "لا توجد أسئلة معتمدة في بنك الأسئلة لهذا الفصل حالياً.",
      });
  }

  const drawCount = officialExam
    ? Math.max(
        1,
        Math.min(
          Number((officialExam as any).questionsCount) || 1,
          chapterQuestions.length,
        ),
      )
    : Math.min(5, chapterQuestions.length);
  // عشوائية ترتيب الأسئلة مفعّلة دائماً وتلقائياً لكل محاولة (Fisher-Yates).
  const selected = fisherYatesShuffle(chapterQuestions).slice(0, drawCount);

  const formattedQuestions = selected.map((q) => {
    // أمان: لا تُرسل الإجابة الصحيحة (correctAnswer) للطالب أبداً قبل التسليم.
    // التصحيح الفعلي يحدث بالكامل في /api/quizzes/submit بمطابقة إجابات
    // الطالب مع النسخة الكاملة المخزّنة في السيرفر، فلا حاجة لإرسالها للعميل.
    const { correctAnswer, ...publicQuestion } = q as any;
    if (q.type === "multiple-choice" && q.options) {
      // عشوائية ترتيب اختيارات الأسئلة متعددة الخيارات مفعّلة دائماً وتلقائياً.
      const shuffledOptions = fisherYatesShuffle(q.options);
      return { ...publicQuestion, options: shuffledOptions };
    }
    return publicQuestion;
  });

  const startedAttempt = {
    id:
      previousQuizAttempt?.id ||
      "quiz-sub-" + Math.random().toString(36).substring(2, 9),
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: officialExam?.courseCode || student.sectionCode,
    chapterId,
    matchedQuestions: [],
    score: 0,
    totalPoints: 0,
    durationMinutes: 0,
    deviceFingerprint: getRequestDeviceFingerprint(req),
    deviceOS: "نظام التشغيل المشخص",
    deviceBrowser: String(
      req.headers["user-agent"] || "Unknown Browser",
    ).substring(0, 30),
    ipAddress: req.ip || "127.0.0.1",
    startedAt:
      isReloadOfActiveAttempt && (previousQuizAttempt as any)?.startedAt
        ? (previousQuizAttempt as any).startedAt
        : new Date().toISOString(),
    status: "started",
    generatedQuestionIds: selected.map((q: any) => q.id),
    generatedQuestions: formattedQuestions,
    sebAttemptId: sebPassForRequest?.attemptId || "",
  };
  if (previousQuizAttempt)
    dbInstance.updateQuizSubmission(
      previousQuizAttempt.id,
      startedAttempt as any,
    );
  else dbInstance.addQuizSubmission(startedAttempt as any);

  // اجعل دخول الطالب لهذا الاختبار الرسمي ظاهراً فوراً للأستاذ في شاشة
  // "تسليمات الاختبارات" بحالة "قيد الحل الآن" — منذ لحظة ظهور الأسئلة للطالب،
  // وقبل أي تسليم أو خروج. هذا يضمن ظهور دليل دخول الطالب حتى لو لم يصل أي
  // إشعار خروج من SEB لاحقاً، ويمنحك زر "إرجاع" لفتح المحاولة من جديد إن
  // احتاج الطالب لذلك.
  if (officialExam) {
    // حارس نزاهة (دفاع متعدّد الطبقات): لا تطمس حالة نهائية (غش/انسحاب/خروج/
    // انتهى الوقت/رصد الدرجة) بحالة "قيد الحل" حتى لو وصل طلب أسئلة لاحق.
    // الإرجاع الرسمي يضع "معاد للطالب" (غير محمي) فيظل دخول الطالب بعد
    // الإرجاع يظهر طبيعياً.
    const inProgressRowId = `exam-${officialExam.id}-${student.id}`;
    const existingExamRow = dbInstance
      .getTeacherSubmissions()
      .find((item: any) => String(item.id) === inProgressRowId);
    if (!isProtectedFinalExamStatus(existingExamRow)) {
      upsertRuntimeTeacherSubmission({
        id: inProgressRowId,
        kind: "exam",
        activityId: officialExam.id,
        activityTitle: officialExam.title,
        courseCode: (officialExam as any).courseCode || student.sectionCode,
        studentId: student.id,
        studentName: student.name,
        answerText:
          "دخل الطالب الاختبار وبدأت محاولته؛ الإجابات قيد الحل الآن.",
        status: EXAM_IN_PROGRESS_STATUS,
        submittedAt: new Date().toISOString(),
      });
    }
  }

  return res.json({
    chapterId,
    officialExamId: officialExam?.id,
    activeExamSessionId: activeExamSessionForResponse?.sessionId,
    questions: formattedQuestions,
  });
});

// Save Quiz Draft / Auto-Save Progress
app.post("/api/quizzes/save-draft", (req, res) => {
  const { studentId, chapterId, answers } = req.body;
  if (studentId && chapterId) {
    const student = dbInstance
      .getStudents()
      .find((s) => String(s.id) === String(studentId));
    const officialExam = activeTeacherExams().find(
      (exam: any) => String(exam.id) === String(chapterId),
    );
    if (student && officialExam && requestExamSessionId(req)) {
      const lockResult = heartbeatExamLockForRequest(req, student, officialExam);
      if (isExamLockFailure(lockResult)) {
        return res.status(lockResult.status).json({
          error: lockResult.error,
          reason: lockResult.reason,
        });
      }
    }
    const previousQuizSubmission = dbInstance
      .getQuizSubmissions()
      .find(
        (q: any) =>
          String(q.studentId) === String(studentId) &&
          String(q.chapterId) === String(chapterId),
      );
    if (
      previousQuizSubmission &&
      String(previousQuizSubmission.status || "") === "started"
    ) {
      dbInstance.updateQuizSubmission(previousQuizSubmission.id, {
        ...previousQuizSubmission,
        draftAnswers: answers || {},
      } as any);
    }
  }
  return res.json({ success: true, syncedAt: Date.now() });
});

// تثبيت نهائي مستقل لمخالفة النزاهة في الاختبار العادي.
// تدوير الهاتف قد يطرد الطالب محلياً في اللحظة نفسها التي يعيد فيها المتصفح
// ترتيب الـ viewport. الاعتماد على sendBeacon وحده في تلك اللحظة غير مضمون:
// وجود الدالة لا يعني أن المتصفح قبل الطلب في طابوره. لذلك يثبّت هذا المسار
// حالة المحاولة وصف الأستاذ والجلسة معاً، بصورة idempotent، حتى لا تبقى
// المحاولة started ولا تستطيع أي heartbeat قديمة إعادتها إلى "قيد الحل".
app.post("/api/quizzes/integrity-exit", (req, res) => {
  const {
    studentId,
    chapterId,
    answers,
    integrityReason,
    integritySignals,
    wasOffline,
  } = req.body || {};
  const student = dbInstance
    .getStudents()
    .find((item: any) => String(item.id) === String(studentId));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });

  const exam = activeTeacherExams().find(
    (item: any) => String(item.id) === String(chapterId),
  );
  if (!exam) return res.status(404).json({ error: "الاختبار غير موجود" });
  if (exam.seb?.enabled || (exam as any).sebEnabled) {
    return res
      .status(403)
      .json({ error: "هذا المسار مخصص للاختبار العادي فقط." });
  }
  if (
    !studentHasEnrollmentInCourse(
      student,
      exam.courseCode || student.sectionCode,
    )
  ) {
    return res
      .status(403)
      .json({ error: "هذا الاختبار غير مخصص لأحد مقرراتك المفعلة." });
  }

  const previousQuizSubmission: any = dbInstance
    .getQuizSubmissions()
    .find(
      (item: any) =>
        String(item.studentId) === String(student.id) &&
        String(item.chapterId) === String(exam.id),
    );
  const teacherRowId = `exam-${exam.id}-${student.id}`;
  const previousTeacherRow = dbInstance
    .getTeacherSubmissions()
    .find((item: any) => String(item.id) === teacherRowId);
  const previousTerminalText = [
    previousQuizSubmission?.terminalStatus,
    previousQuizSubmission?.finishReason,
    previousQuizSubmission?.exitReason,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .join(" ");
  const alreadyConfirmed =
    String(previousTeacherRow?.status || "") ===
      EXAM_CHEATING_ATTEMPT_STATUS ||
    /\b(?:cheating|violation|violated|expelled)\b/.test(
      previousTerminalText,
    ) ||
    previousTerminalText.includes("landscape_orientation") ||
    previousTerminalText.includes("orientation_violation");

  // إعادة الطلب بعد انقطاع قصير لا تكرر الرسائل ولا السجلات؛ نكتفي بتأكيد
  // أن جلسة الاختبار نفسها نهائية أيضاً.
  if (alreadyConfirmed) {
    markExamLockStatusForRequest(
      req,
      student,
      exam,
      "violated",
      previousQuizSubmission?.exitReason || integrityReason || "violation",
    );
    return res.json({
      success: true,
      alreadyConfirmed: true,
      submission: previousQuizSubmission,
      teacherSubmission: previousTeacherRow,
    });
  }

  // لا نحول تسليماً سليماً مكتملاً إلى مخالفة إذا وصل حدث متأخر بعد الضغط
  // على زر التسليم. حراس الواجهة تمنع ذلك أيضاً، وهذا الحارس هو خط الدفاع
  // النهائي في السيرفر.
  if (
    previousQuizSubmission &&
    String(previousQuizSubmission.status || "") !== "started"
  ) {
    return res.status(409).json({
      error: "المحاولة منتهية مسبقاً.",
      submission: previousQuizSubmission,
    });
  }

  const now = new Date().toISOString();
  const cleanReason = String(integrityReason || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
  const teacherReason = cleanReason || "تغيير اتجاه الشاشة أثناء الاختبار";
  const terminalExitReason = normalizedExamExitReason(teacherReason);
  const safeSignals = Array.isArray(integritySignals)
    ? integritySignals.slice(-8).map((signal: any) => ({
        key: String(signal?.key || "").slice(0, 80),
        reason: String(signal?.reason || "").slice(0, 160),
        weight: Number(signal?.weight || 0),
        at: String(signal?.at || "").slice(0, 40),
        visibility: String(signal?.visibility || "").slice(0, 30),
        online: Boolean(signal?.online),
        viewport: String(signal?.viewport || "").slice(0, 40),
      }))
    : [];
  const safeAnswers =
    answers && typeof answers === "object"
      ? answers
      : previousQuizSubmission?.draftAnswers || {};
  const progressGrade = gradeCurrentExamProgress(
    {
      ...previousQuizSubmission,
      draftAnswers: safeAnswers,
      answers: safeAnswers,
    },
    Number(exam.points || previousQuizSubmission?.totalPoints || 20),
  );
  const totalPoints =
    Number(exam.points || progressGrade.totalPoints || 20) || 20;
  const quizSubmission = {
    ...(previousQuizSubmission || {}),
    id:
      previousQuizSubmission?.id ||
      "quiz-sub-" + Math.random().toString(36).substring(2, 9),
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: exam.courseCode || student.sectionCode,
    chapterId: exam.id,
    answers: safeAnswers,
    draftAnswers: safeAnswers,
    matchedQuestions: progressGrade.matchedQuestions,
    score: 0,
    totalPoints,
    submittedAt: now,
    status: "submitted",
    zeroReason: undefined,
    finishReason: EXAM_CHEATING_ATTEMPT_STATUS,
    terminalStatus: "violation",
    attemptStatus: "violation",
    sessionStatus: "violated",
    exitReason: terminalExitReason,
    exitedAt: now,
    exitWasOffline: !!wasOffline,
    integrityReason: cleanReason || undefined,
    integritySignals: safeSignals.length ? safeSignals : undefined,
  };
  if (previousQuizSubmission?.id) {
    dbInstance.updateQuizSubmission(
      previousQuizSubmission.id,
      quizSubmission as any,
    );
  } else {
    dbInstance.addQuizSubmission(quizSubmission as any);
  }

  markExamLockStatusForRequest(
    req,
    student,
    exam,
    "violated",
    terminalExitReason,
  );
  const teacherSubmission = upsertRuntimeTeacherSubmission({
    ...(previousTeacherRow || {}),
    id: teacherRowId,
    kind: "exam",
    activityId: exam.id,
    activityTitle: exam.title,
    courseCode: exam.courseCode || student.sectionCode,
    studentId: student.id,
    studentName: student.name,
    answerText: `حاول الطالب الغش (${teacherReason}) فتم إخراجه ورصدت درجاته الحالية: 0 من ${totalPoints}`,
    answers: safeAnswers,
    matchedQuestions: progressGrade.matchedQuestions,
    grade: "0",
    visibleGrade: canShowExamGradeToStudent(exam) ? "0" : "",
    totalPoints,
    serverSubmissionId: quizSubmission.id,
    status: EXAM_CHEATING_ATTEMPT_STATUS,
    terminalStatus: "violation",
    attemptStatus: "violation",
    sessionStatus: "violated",
    exitReason: terminalExitReason,
    exitedAt: now,
    exitWasOffline: !!wasOffline,
    submittedAt: now,
    gradedAt: canShowExamGradeToStudent(exam) ? now : undefined,
  });

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "محاولة غش",
    details: `${teacherReason} — تم إخراج الطالب من ${exam.title} ورصد الدرجة صفر.`,
    teacherEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    actorEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    sectionCode: exam.courseCode || student.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "نظام النزاهة",
    browser: "مِراس",
    isViolationWarning: true,
  });
  notifyTeachersForSection(
    exam.courseCode || student.sectionCode,
    "محاولة غش",
    `${student.name} حاول الغش في ${exam.title} (${teacherReason}) وتم رصد الدرجة صفر.`,
    {
      type: "exam_cheating_attempt",
      studentId: student.id,
      examId: exam.id,
      link: "/",
    },
  );
  notifyStudent(
    student.id,
    "تم تسجيل محاولة غش",
    `تم إيقاف ${exam.title} بسبب محاولة غش، ورُصدت الدرجة صفر.`,
    {
      type: "exam_cheating_attempt",
      examId: exam.id,
      link: "/",
    },
  );

  return res.json({
    success: true,
    submission: quizSubmission,
    teacherSubmission,
  });
});

// Submit Quiz Answers & Auto-Grade
app.post("/api/quizzes/submit", (req, res) => {
  const {
    studentId,
    chapterId,
    answers,
    startTime,
    submitReason,
    timedOut,
    wasOffline,
    integrityReason,
    integritySignals,
  } = req.body;
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });
  const sebPassForRequest = getActiveSebAttempt(req, student);
  if (
    sebPassForRequest &&
    String(chapterId) !== String(sebPassForRequest.examId)
  ) {
    rejectSebPass(
      req,
      sebPassForRequest,
      `رفض تسليم اختبار خارج نطاق نفق SEB: المطلوب ${String(chapterId)} والمسموح ${sebPassForRequest.examId}.`,
    );
    return res
      .status(403)
      .json({ error: "جلسة SEB الحالية مخصصة لتسليم اختبار واحد فقط." });
  }

  const officialExam = activeTeacherExams().find(
    (exam: any) => String(exam.id) === String(chapterId),
  );
  if (officialExam) {
    const activeSebAttempt = getActiveSebAttempt(req, student, officialExam.id);
    const teacherAuthorizedSebReturn = hasTeacherAuthorizedSebReturnException(
      officialExam.id,
      student.id,
    );
    if (
      !studentHasEnrollmentInCourse(
        student,
        officialExam.courseCode || student.sectionCode,
      ) &&
      !teacherAuthorizedSebReturn
    ) {
      return res
        .status(403)
        .json({ error: "هذا الاختبار غير مخصص لأحد مقرراتك المفعلة." });
    }
    if (
      officialExam.seb?.enabled &&
      (!isSebRequest(req) || !activeSebAttempt) &&
      !teacherAuthorizedSebReturn
    ) {
      return res
        .status(403)
        .json({ error: "لا يمكن تسليم هذا الاختبار خارج Safe Exam Browser." });
    }
    const now = Date.now();
    if (officialExam.open && new Date(officialExam.open).getTime() > now)
      return res
        .status(403)
        .json({ error: "لم يبدأ وقت إتاحة هذا الاختبار بعد." });
    if (
      officialExam.close &&
      new Date(officialExam.close).getTime() + 24 * 60 * 60 * 1000 < now &&
      !teacherAuthorizedSebReturn
    )
      return res.status(403).json({ error: "انتهى وقت إتاحة هذا الاختبار." });
  }

  const browser = req.headers["user-agent"] || "Unknown Browser";
  const ip = req.ip || "127.0.0.1";
  const deviceFingerprint = getRequestDeviceFingerprint(req);

  // Time elapsed check
  const durationMs = Date.now() - (startTime || Date.now());
  const durationMinutes = Math.max(
    0.1,
    Number((durationMs / 1000 / 60).toFixed(1)),
  );

  // If student is finishing too fast (cybersecurity warning)
  const isSuspiciouslyFast = durationMinutes < 0.2; // completed under 12 seconds
  if (isSuspiciouslyFast) {
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "شبهة سرعة غير معتادة",
      details: `أنهى الاختبار التدريبي الخاص بالفصل في غضون ${durationMinutes} دقيقة وهو تيار سريع للغاية يعطي شبهة تبادل الإجابات أو الحسابات.`,
      ip,
      userAgent: browser,
      os: "محلل السلوك الذكي",
      browser: "تفتيش ذاتي",
      isViolationWarning: true,
    });
    notifyTeachersForSection(
      student.sectionCode,
      "تنبيه اختبار",
      `${student.name} أنهى اختبارًا بسرعة غير معتادة`,
      { type: "exam_warning", studentId: student.id, link: "/" },
    );
  }

  const matchedQuestions: any[] = [];
  let score = 0;
  let totalPoints = 0;

  for (const qId of Object.keys(answers)) {
    const q = activeQuestionBank().find((item) => item.id === qId);
    if (!q) continue;

    const studentAns = answers[qId];
    let isCorrect = false;

    if (q.type === "multiple-choice" || q.type === "true-false") {
      isCorrect = String(studentAns).trim() === String(q.correctAnswer).trim();
    } else if (q.type === "short-answer" || q.type === "scenario-analysis") {
      // Basic match or keyword include (since they are educational simple trainers, we can also give partial/full correct if close)
      isCorrect = String(studentAns)
        .trim()
        .toLowerCase()
        .includes(String(q.correctAnswer).trim().toLowerCase());
    } else if (q.type === "matching") {
      // Check if student dictionary matches answer
      let matchCount = 0;
      const originalMap = q.correctAnswer as { [key: string]: string };
      const studentMap = (studentAns as { [key: string]: string }) || {};
      const keys = Object.keys(originalMap);
      keys.forEach((k) => {
        if (studentMap[k] === originalMap[k]) matchCount++;
      });
      isCorrect = matchCount === keys.length;
    } else if (q.type === "ordering") {
      // Check array matching
      const originalArray = q.correctAnswer as string[];
      const studentArray = (studentAns as string[]) || [];
      isCorrect =
        JSON.stringify(originalArray) === JSON.stringify(studentArray);
    }

    const pointsEarned = isCorrect ? q.points : 0;
    score += pointsEarned;
    totalPoints += q.points;

    matchedQuestions.push({
      questionId: q.id,
      questionText: q.questionText,
      studentAnswer: studentAns,
      correctAnswer:
        q.type === "matching" || q.type === "ordering"
          ? q.correctAnswer
          : q.correctAnswer,
      isCorrect,
      pointsEarned,
    });
  }

  const previousQuizSubmission = dbInstance
    .getQuizSubmissions()
    .find((q: any) => q.studentId === student.id && q.chapterId === chapterId);
  // إذا كانت المحاولة "مقفلة" فقط بسبب رصد صفر تلقائي سابق (zeroReason) —
  // مثل تجاوز المهلة الزمنية أو انقطاع جلسة SEB — دون أن يكون الطالب قد سلّم
  // إجاباته فعلياً، ووصل الآن تسليم حقيقي ضمن الوقت المسموح للاختبار، نقبل
  // هذا التسليم ونسجّل الدرجة الفعلية المحسوبة بدل ترك "صفر - انسحاب" بشكل
  // دائم رغم أن الطالب سلّم بشكل طبيعي.
  const wasAutoZeroedOnly =
    !!previousQuizSubmission &&
    String((previousQuizSubmission as any).status || "") === "submitted" &&
    !!String((previousQuizSubmission as any).zeroReason || "").trim();
  if (submissionIsLocked(previousQuizSubmission) && !wasAutoZeroedOnly) {
    return res
      .status(409)
      .json({
        error:
          "تم تسليم هذا الاختبار مسبقاً وتم قفل المحاولة. لا يمكن فتحه مرة أخرى إلا بعد إرجاعه من المعلم.",
        submission: previousQuizSubmission,
      });
  }

  const submissionTimedOut =
    timedOut === true || String(submitReason || "") === "time-expired";
  const isSuspiciousExit = String(submitReason || "") === "suspicious_exit";
  const isWithdrawnOrExited =
    !isSuspiciousExit &&
    (String(submitReason || "") === "withdrawn" ||
      ["exited", "pagehide", "screen-closed"].includes(
        String(submitReason || ""),
      ));
  const isInterruptedAttempt = isSuspiciousExit || isWithdrawnOrExited;
  const isSebProtectedExam = !!(
    (officialExam as any)?.seb?.enabled || (officialExam as any)?.sebEnabled
  );
  const normalIntegrityReason =
    !isSebProtectedExam && isSuspiciousExit
      ? String(integrityReason || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 260)
      : "";
  const normalIntegritySignals =
    !isSebProtectedExam && isSuspiciousExit && Array.isArray(integritySignals)
      ? integritySignals.slice(-8).map((signal: any) => ({
          key: String(signal?.key || "").slice(0, 80),
          reason: String(signal?.reason || "").slice(0, 160),
          weight: Number(signal?.weight || 0),
          at: String(signal?.at || "").slice(0, 40),
          visibility: String(signal?.visibility || "").slice(0, 30),
          online: Boolean(signal?.online),
          viewport: String(signal?.viewport || "").slice(0, 40),
        }))
      : [];
  const normalIntegrityTeacherReason =
    normalIntegrityReason ||
    normalIntegritySignals
      .map((signal: any) => signal.reason)
      .filter(Boolean)
      .slice(-4)
      .join("، ") ||
    "تبديل تطبيق أو شاشة";
  const terminalExitReason = isSuspiciousExit
    ? normalizedExamExitReason(normalIntegrityTeacherReason)
    : isWithdrawnOrExited
      ? "exited_before_submit"
      : "";
  const examTotalPoints = Number(officialExam?.points || totalPoints || 20);
  const finalScore = isSuspiciousExit ? 0 : score;

  const submission = {
    id:
      previousQuizSubmission?.id ||
      "quiz-sub-" + Math.random().toString(36).substring(2, 9),
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: officialExam?.courseCode || student.sectionCode,
    chapterId,
    matchedQuestions,
    score: finalScore,
    totalPoints: examTotalPoints,
    durationMinutes,
    deviceFingerprint,
    deviceOS: "نظام التشغيل المشخص",
    deviceBrowser: browser.substring(0, 30),
    ipAddress: ip,
    submittedAt: new Date().toISOString(),
    status: "submitted",
    zeroReason: undefined,
    finishReason: submissionTimedOut
      ? EXAM_TIME_EXPIRED_STATUS
      : isSuspiciousExit
        ? EXAM_CHEATING_ATTEMPT_STATUS
        : isWithdrawnOrExited
          ? EXAM_WITHDRAWN_STATUS
          : undefined,
    terminalStatus: isSuspiciousExit
      ? "violation"
      : isWithdrawnOrExited
        ? "exited"
        : submissionTimedOut
          ? "finished"
          : "submitted",
    exitReason: terminalExitReason || undefined,
    exitedAt: isInterruptedAttempt ? new Date().toISOString() : undefined,
    exitWasOffline: isInterruptedAttempt ? !!wasOffline : undefined,
    integrityReason: normalIntegrityReason || undefined,
    integritySignals: normalIntegritySignals.length
      ? normalIntegritySignals
      : undefined,
    resubmittedAt: previousQuizSubmission
      ? new Date().toISOString()
      : undefined,
  };

  if (previousQuizSubmission)
    dbInstance.updateQuizSubmission(
      previousQuizSubmission.id,
      submission as any,
    );
  else dbInstance.addQuizSubmission(submission as any);

  const completedSebAttempt = officialExam
    ? getActiveSebAttempt(req, student, officialExam.id)
    : null;
  if (completedSebAttempt) closeSebAttempt(completedSebAttempt, "submitted");
  if (officialExam) {
    markExamLockStatusForRequest(
      req,
      student,
      officialExam,
      isInterruptedAttempt ? "violated" : "finished",
      submissionTimedOut
        ? "time-expired"
        : isSuspiciousExit
          ? terminalExitReason
          : isWithdrawnOrExited
            ? "exited-before-submit"
            : "submitted",
    );
  }

  // Update Student stats
  const totalSubmissions = dbInstance
    .getQuizSubmissions()
    .filter((q) => q.studentId === student.id);
  const currentProgress = Math.min(
    100,
    Math.floor(20 + totalSubmissions.length * 15),
  );
  dbInstance.updateStudent(student.id, {
    progress: currentProgress,
    score: student.score + finalScore,
  });

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "تقديم اختبار تدريبي",
    details: `أتم الاختبار التدريبي للفصل وحصل على علامة: ${finalScore}/${examTotalPoints}`,
    ip,
    userAgent: browser,
    os: "نظام التقييم التلقائي",
    browser: "مِراس",
    isViolationWarning: false,
  });
  if (officialExam) {
    const gradeVisible = canShowExamGradeToStudent(officialExam);
    upsertRuntimeTeacherSubmission({
      id: `exam-${officialExam.id}-${student.id}`,
      kind: "exam",
      activityId: officialExam.id,
      activityTitle: officialExam.title,
      courseCode: officialExam.courseCode || student.sectionCode,
      studentId: student.id,
      studentName: student.name,
      answerText: submissionTimedOut
        ? `انتهى وقت الاختبار وتم تثبيت إجابات الطالب ورصد الدرجة: ${finalScore} من ${examTotalPoints}`
        : isSuspiciousExit
          ? `حاول الطالب الغش (${normalIntegrityTeacherReason}) فتم إخراجه ورصدت درجاته الحالية: 0 من ${examTotalPoints}`
          : isWithdrawnOrExited
            ? `انسحب الطالب من الاختبار أو انقطعت جلسته، وتم رصد الدرجة التي وصل لها: ${finalScore} من ${examTotalPoints}`
            : `تم تسليم الاختبار بنجاح. الدرجة المحسوبة: ${finalScore} من ${examTotalPoints}`,
      answers: answers,
      matchedQuestions: matchedQuestions,
      grade: String(finalScore),
      visibleGrade: gradeVisible ? String(finalScore) : "",
      totalPoints: examTotalPoints,
      serverSubmissionId: submission.id,
      status: submissionTimedOut
        ? EXAM_TIME_EXPIRED_STATUS
        : isSuspiciousExit
          ? EXAM_CHEATING_ATTEMPT_STATUS
          : isWithdrawnOrExited
            ? EXAM_WITHDRAWN_STATUS
            : gradeVisible
              ? EXAM_GRADED_STATUS
              : EXAM_SUBMITTED_STATUS,
      terminalStatus: isSuspiciousExit
        ? "violation"
        : isWithdrawnOrExited
          ? "exited"
          : "submitted",
      exitReason: terminalExitReason || undefined,
      exitedAt: isInterruptedAttempt ? submission.submittedAt : undefined,
      submittedAt: submission.submittedAt,
      gradedAt: gradeVisible ? submission.submittedAt : undefined,
    });
    notifyTeachersForSection(
      (officialExam as any).courseCode || student.sectionCode,
      isSuspiciousExit
        ? "محاولة غش"
        : isWithdrawnOrExited
          ? "انسحاب من اختبار"
          : "تسليم اختبار",
      isSuspiciousExit
        ? `${student.name} حاول الغش في ${officialExam.title} (${normalIntegrityTeacherReason}) وتم رصد الدرجة صفر.`
        : isWithdrawnOrExited
          ? `${student.name} انسحب أو أغلق شاشة ${officialExam.title} وتم رصد الدرجة التي وصل لها: ${finalScore} من ${examTotalPoints}`
          : `${student.name} سلّم ${officialExam.title} بدرجة ${finalScore} من ${examTotalPoints}`,
      {
        type: isSuspiciousExit
          ? "exam_cheating_attempt"
          : isWithdrawnOrExited
            ? "exam_exited_before_submit"
            : "exam_submission",
        studentId: student.id,
        examId: officialExam.id,
        link: "/",
      },
    );
    notifyStudent(
      student.id,
      isSuspiciousExit
        ? "تم تسجيل محاولة غش"
        : isWithdrawnOrExited
          ? "تم حفظ حالة الانسحاب"
          : "تم حفظ نتيجتك",
      isSuspiciousExit
        ? `تم إيقاف ${officialExam.title} بسبب محاولة غش، ورُصدت الدرجة صفر.`
        : isWithdrawnOrExited
          ? `تم حفظ ${officialExam.title} ورصد الدرجة التي وصلت لها: ${finalScore} من ${examTotalPoints}.`
          : `تم تسليم ${officialExam.title} وحفظ درجتك.`,
      {
        type: isSuspiciousExit
          ? "exam_cheating_attempt"
          : isWithdrawnOrExited
            ? "exam_withdrawn"
            : "exam_result",
        examId: officialExam.id,
        link: "/",
      },
    );
  }

  return res.json({
    success: true,
    submission,
    review: officialExam ? examReviewSettings(officialExam) : undefined,
    gradeVisible: officialExam ? canShowExamGradeToStudent(officialExam) : true,
  });
});

// ================= WEEKLY EXERCISES =================

app.get("/api/exercises", (req, res) => {
  const { studentId } = req.query;
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });

  const exList = dbInstance.getExercises();
  const submissions = dbInstance
    .getExerciseSubmissions()
    .filter((s) => s.studentId === student.id);

  return res.json({
    exercises: exList,
    submissions,
  });
});

app.post("/api/exercises/submit", (req, res) => {
  const { studentId, exerciseId, studentAnswer, attachments } = req.body;
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });

  const ex = dbInstance.getExercises().find((e) => e.id === exerciseId);
  if (!ex) return res.status(404).json({ error: "التمرين غير موجود" });

  // منع التسليم الفارغ: لا بد من نص أو مرفق واحد على الأقل.
  const hasExerciseAnswer = String(studentAnswer || "").trim().length > 0;
  const hasExerciseAttachments =
    Array.isArray(attachments) && attachments.length > 0;
  if (!hasExerciseAnswer && !hasExerciseAttachments) {
    return res
      .status(400)
      .json({
        error:
          "لا يمكن تسليم نشاط فارغ. اكتب إجابتك أو أرفق ملفاً قبل التسليم.",
      });
  }

  // لا يظهر وسم "متأخر" إلا بعد نهاية يوم الإغلاق إن وجد؛
  // وإذا لم يوجد إغلاق نستخدم موعد التسليم كنهاية يوم كاملة.
  const exLateDeadlineMs = mirasDeadlineEndMs(
    (ex as any).closeDate || (ex as any).close || (ex as any).dueDate || "",
  );
  const exSubmittedLate = !!(
    exLateDeadlineMs &&
    Number.isFinite(exLateDeadlineMs) &&
    Date.now() > exLateDeadlineMs
  );

  const previousExerciseSubmission = dbInstance
    .getExerciseSubmissions()
    .find(
      (s: any) => s.studentId === student.id && s.exerciseId === exerciseId,
    );
  if (submissionIsLocked(previousExerciseSubmission)) {
    return res
      .status(409)
      .json({
        error:
          "تم تسليم هذا النشاط مسبقاً وتم قفله. لا يفتح مرة أخرى إلا بعد ضغط المعلم زر الإرجاع.",
        submission: previousExerciseSubmission,
      });
  }

  // Generate verified academic watermark token
  const watermarkSeed = `EX-${studentId}-${exerciseId}`;
  const watermarkText = `أكاديمي مفعّل: الطالب ${student.name} • الرقم: ${student.id} • المقرر: ${student.sectionCode} • مسار: ${student.pathwayCode || "N/A"}`;

  const submission = {
    id:
      previousExerciseSubmission?.id ||
      "ex-sub-" + Math.random().toString(36).substring(2, 9),
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: student.sectionCode,
    exerciseId,
    exerciseTitle: ex.title,
    studentAnswer,
    attachments: normalizePersistentSubmissionAttachments(attachments),
    submittedAt: new Date().toISOString(),
    watermark: watermarkText,
    status: "submitted",
    submittedLate: exSubmittedLate,
    resubmittedAt: previousExerciseSubmission
      ? new Date().toISOString()
      : undefined,
  };

  if (previousExerciseSubmission)
    dbInstance.updateExerciseSubmission(
      previousExerciseSubmission.id,
      submission as any,
    );
  else dbInstance.addExerciseSubmission(submission as any);

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "تسليم تمرين أسبوعي",
    details: `تم تسليم إجابة تمرين: ${ex.title}. تم إلحاق العلامة المائية الثابتة بالملف المولد.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "نظام معالجة النصوص",
    browser: "متصفح",
    isViolationWarning: false,
  });

  return res.json({ success: true, submission });
});

// ================= PERSONALIZED PROJECT GENERATOR =================

// Generate Student Individual Project (AI or rule-based adaptively)
app.post("/api/projects/generate", async (req, res) => {
  const { studentId } = req.body;
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });

  if (!student.pathwayCode) {
    return res
      .status(400)
      .json({
        error:
          "يرجى استكمال بصمة التعلم أولاً لتوليد كود المسار الدراسي الخاص بك.",
      });
  }

  const { prefField, targetGrade, workStyle, projectType } =
    student.learningStyle || {
      prefField: "الذكاء الاصطناعي",
      targetGrade: "مرحلة متوسطة",
      workStyle: "عمل فردي",
      projectType: "تطبيقي وعملي",
    };

  const codeToken = Math.floor(100 + Math.random() * 900).toString();
  const watermarkText = `المشروع الشخصي المعتمد • الطالب: ${student.name} • الرقم الجامعي: ${student.id} • الالمقرر: ${student.sectionCode} • مسار: ${student.pathwayCode}`;

  let projectTitle = "";
  let projectDesc = "";
  let requirements: string[] = [];
  let steps: string[] = [];
  let rubric: any[] = [];
  let targetLearner =
    targetGrade === "مرحلة متوسطة"
      ? "الطلبة في المرحلة المتوسطة"
      : "الطلبة في المرحلة الابتدائية";
  let techUsed = prefField;

  // Utilize Gemini AI if API key is present for a rich personal experience
  if (false && aiInstance) {
    try {
      const prompt = `أنت أستاذ جامعي خبير في تصميم التعلم والابتكار الرقمي. قم بتصميم مشروع بحثي تطبيقي فريد وشخصي كلياً لطالب جامعي مخصص لديه الهوية والاهتمامات التالية:
- المجال التكنولوجي الرئيسي المفضل لديه: ${prefField}
- المرحلة السنية التي يستهدفها المشروع لتصميم مناهج لها: ${targetGrade}
- نمط مشاريعه المفضل: ${projectType}
- نمط عمل الطالب: ${workStyle}

تأكد من صياغة إجابة تركز على دمج هذه التفضيلات في مشروع واحد متكامل، بحيث ينتج الطالب نموذجاً فريداً ومخططاً تعليمياً.
نسق الإجابة كـ JSON صالح بالكامل ليكون قابلاً للمعالجة الفورية، مع الالتزام بالبنية التالية:
{
  "title": "عنوان فريد ومبتكر وجذاب للمشروع، لا يتكرر مع عينات تقليدية",
  "description": "وصف شيق ومفصل للمشروع والمشكلة التعليمية المحددة وكيف يساهم المشروع في حلها بطبائع التقنية المختارة",
  "requirements": [
    "قائمة من 4 متطلبات تقنية وأكاديمية دقيقة مخصصة لهذا التصميم"
  ],
  "steps": [
    "خطوات العمل المتتابعة والممنهجة بالتفصيل ليتسنى للطالب التنفيذ"
  ],
  "rubric": [
    {
      "criterion": "المعيار الأول الأساسي",
      "weight": 25,
      "levels": ["ممتاز ومتقن تماماً (90-100)", "جيد وله فرصة تطوير (80-89)", "مقبول ويحتاج تدقيق (70-79)", "ضعيف وغير مكتمل"]
    },
    {
      "criterion": "المعيار التقني الفريد لسر الاندماج",
      "weight": 25,
      "levels": ["ممتاز ومكتمل", "جيد", "مقبول", "ضعيف"]
    },
    {
      "criterion": "منهجية التصميم وتماسك الأنشطة",
      "weight": 25,
      "levels": ["ممتاز ومكتمل", "جيد", "مقبول", "ضعيف"]
    },
    {
      "criterion": "الوضوح والعرض والتوثيق والملحق التوليدي",
      "weight": 25,
      "levels": ["ممتاز ومكتمل", "جيد", "مقبول", "ضعيف"]
    }
  ]
}`;

      const response = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.8,
        },
      });

      const parsed = JSON.parse(response.text?.trim() || "{}");
      projectTitle =
        parsed.title ||
        `تصميم برمجية ذكية للمرحلة الدراسية دمج مهارات ${prefField}`;
      projectDesc =
        parsed.description ||
        "تطوير بيئة مشروعات تكنولوجية نشطة تخدم تحسين أساليب الفهم.";
      requirements = parsed.requirements || [
        "إعداد نموذج تطبيقي متكامل للمفهوم المختار.",
        "توظيف برمجية مخرجة رقمية جاهزة للمعاينة.",
        "صياغة خطة تقويم واختبار قبلية وبعدية للطلبة.",
        "كتابة تقرير توقيع أكاديمي فردي ملحق بالمنصة.",
      ];
      steps = parsed.steps || [
        "تحليل الاحتياجات وتوصيف الفئة المستهدفة بدقة.",
        "تصميم لوحة التدفق للأداة والسيناريو التعليمي المصاحب.",
        "تنفيذ النماذج وتركيب عناصر الملصقات التفاعلية.",
        "إدراج نموذج التقييم Rubric الأكاديمي المولد في الملف النهائي وتسليمه.",
      ];
      rubric = parsed.rubric || [
        {
          criterion: "جودة التوطين والتوافق مع المجال المفضل",
          weight: 25,
          levels: [
            "مكتمل وقوي وبصمة شخصية واضحة",
            "مقبول مع حاجة تعديل خفيفة",
            "ضعيف وبحاجة لإعادة النشر",
          ],
        },
      ];
    } catch (e) {
      console.log(
        "Gemini project generation failed, falling back to rule-based engine.",
      );
      // Fallback defined below
    }
  }

  // Fallback to rule engine if Gemini key missing or error occurs
  if (!projectTitle) {
    if (prefField === "الذكاء الاصطناعي") {
      projectTitle = `تصميم نشاط تعلّم متكامل للعلوم باستخدام الذكاء الاصطناعي التوليدي لمكافحة تدني دافعية التعليم لطلبة ${targetLearner}`;
      projectDesc = `صياغة خطة دراسية تفاعلية يتقمص فيها الطالب دور مصمم تقني يوظف روبوتات مخصصة أو أدوات توليد لتعضيد استيعاب مفاهيم صعبة، مع شرح آليات التقييم المنهجية.`;
      requirements = [
        "أن يتضمن سيناريو واقعي لدمج روبوت تعليمي في الشرح لتبسيط المادة.",
        "توضيح آلية تدريب الذكاء الاصطناعي الموجه لتجنب تزييف الحقائق الأكاديمية.",
        "تصميم نموذج تقويم واختبارات لضمان عدم الاتكالية على الآلة.",
        "استخراج تقرير نهائي مطبوع وموثق بنظام التحقق الذكي.",
      ];
      steps = [
        "تحديد درس العلوم التعليمي وتفكيك المفاهيم الصعبة به.",
        "تصميم خطة الحوار (Prompt Engineering Guide) التي سيستخدمها الطلبة.",
        "إعداد جدول مقارنة للأدوات المنتقاة للمستويات المختلفة.",
        "إرفاق نموذج التوطين والعرض والتحقق الأكاديمي الشامل.",
      ];
    } else if (prefField === "الواقع المعزز") {
      projectTitle = `تصميم لوحة ومجسمات تفاعلية باستخدام الواقع المعزز (AR) لتبسيط المفاهيم المجردة لطلبة ${targetLearner}`;
      projectDesc = `يهدف المشروع إلى التخطيط لتجربة واقع معزز حية (AR Magic Board) تتيح للطلبة التفاعل مع جداريات أو صور مادية ومراجعة الأبعاد الثلاثية لها لتبسيط الفهم المعملي.`;
      requirements = [
        "توصيف الأداة التكنولوجية التفاعلية المستخدمة (مثل CoSpaces أو Assemblr EDU).",
        "تأسيس مخطط خارجي لغرفة الصف والتنقل الطلابي داخلها.",
        "رسم خرائط الربط البصري وتصميم الرموز التوضيحية للمشاهد.",
        "نموذج للتقويم مستنداً لـ Rubric الأداء والإنتاج الرقمي.",
      ];
      steps = [
        "اختيار الوحدة التعليمية من المقرر وإنشاء مجسماتها وربطها بالهواتف.",
        "رسم نموذج أولي يدوي للبطاقات والمنشورات المطلوبة للدرس.",
        "فحص جاهزية التفاعل في بيئة تجريبية مع عدد من الأقران.",
        "رفع التقرير الختامي وصور من التجربة في لوحة الإنجاز.",
      ];
    } else {
      projectTitle = `تصميم درس رقمي قائم على التلعيب (Gamification) لتعزيز المشاركة الإيجابية والتعلم البنائي لطلبة ${targetLearner}`;
      projectDesc = `إنشاء بيئة مهام تفاعلية تهدف لدمج ميكانيكيات الألعاب (نقاط، أوسمة، مستويات، متصدرين) في بيئة جامعية أو صفية تزيد دافعية التعلم وتبني تفوق تفاعلي حقيقي.`;
      requirements = [
        "تحديد 3 آليات للتلعيب منتقاة بعناية تخدم الفهم المباشر.",
        "وجود سرد قصصي (narrative) يربط المهام ببعضها.",
        "وجود تغذية راجعة تفاعلية فورية ومستوى إنقاذ للمتعثرين.",
        "إرفاق مستند التقييم الشامل للحقيبة التعليمية المصممة.",
      ];
      steps = [
        "صياغة قصة التلعيب والشخصية البطولية للطلبة.",
        "رسم شجرة المهارات وكتابة شروط الترقية والحصول على الأوسمة.",
        "تذليل الأخطاء عبر تجربة اللعب (Playtesting Guide).",
        "توليد ملف التقرير وعرضه للاستعراض في منصة المخرجات.",
      ];
    }

    rubric = [
      {
        criterion: "منهجية الدمج والتوظيف التربوي السليم في التصميم",
        weight: 30,
        levels: [
          "ممتع ومبدع ومصاغ بذكاء",
          "منهجي ويحتاج تدعيم طفيف",
          "تقليدي ينقص الإبداع",
          "ضعيف وغير مناسب",
        ],
      },
      {
        criterion: "الرؤية التقنية والتوافق مع اهتمامات بصمة الطالب",
        weight: 30,
        levels: [
          "توافق تام ومتقن ومتميز",
          "متوسط التوافق الأكاديمي",
          "يحتاج لتعديل شامل",
          "معدوم",
        ],
      },
      {
        criterion: "وضوح الأنشطة والخطوات وقابلية التطبيق الواقعية",
        weight: 20,
        levels: [
          "ممتاز تماماً وقابل للتكرار",
          "جيد ومنظم",
          "محدود الفاعلية",
          "غير قابل للتنفيذ",
        ],
      },
      {
        criterion: "الهوية والتحقق وصباغة Watermark الأكاديمية",
        weight: 20,
        levels: [
          "البصمة والاسم طاهرين بالكامل",
          "تعتيم طفيف في الهوية والمطابقة",
          "غير موجود بالملف المعاين",
        ],
      },
    ];
  }

  const newProject: PersonalizedProject = {
    id: `P-${prefField === "الذكاء الاصطناعي" ? "AI" : prefField === "الواقع المعزز" ? "AR" : "GAME"}-${codeToken}`,
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: student.sectionCode,
    pathwayCode: student.pathwayCode,
    title: projectTitle,
    description: projectDesc,
    targetLearner,
    technology: prefField,
    educationalProblem: "تدني الاندماج وكسل التلقين التقليدي للمقرر",
    productType: projectType,
    requirements,
    steps,
    rubric,
    dueDate: "2026-06-30",
    isGenerated: true,
    status: "generated",
    watermark: watermarkText,
  };

  dbInstance.addPersonalizedProject(newProject);

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "توليد مشروع شخصي فريد",
    details: `تم إطلاق خوارزمية التخصيص لتوليد مشروع تطبيقي فريد برقم: ${newProject.id}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "محرك التوليد الذكي",
    browser: "نظام الذكاء الاصطناعي",
    isViolationWarning: false,
  });

  return res.json({ success: true, project: newProject });
});

const submissionUploadsDir = () => path.join(process.cwd(), "data", "uploads");
const ensureSubmissionUploadsDir = () => {
  const dir = submissionUploadsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};
function repairMisdecodedAttachmentName(value: string): string {
  // express-fileupload/busboy decode multipart filename headers as latin1, so a
  // non-ASCII (e.g. Arabic) filename arrives here as one Ø/Ù-style char per original
  // UTF-8 byte. Reverse that only when it demonstrably restores real Arabic text —
  // otherwise leave the value untouched (keeps ASCII/Latin filenames unaffected).
  if (!/[-ÿ]/.test(value)) return value;
  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (repaired.includes("�")) return value;
    return /[؀-ۿ]/.test(repaired) ? repaired : value;
  } catch {
    return value;
  }
}

const sanitizeAttachmentOriginalName = (value: any) => {
  const base = path.basename(
    repairMisdecodedAttachmentName(String(value || "unnamed")),
  );
  return base.replace(/[\r\n\0]/g, "").slice(0, 180) || "unnamed";
};


const MIRAS_ALLOWED_SUBMISSION_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".rtf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".zip",
];
const MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL =
  "PDF، Word، PowerPoint، Excel، CSV، TXT، صور JPG/PNG/WebP أو ZIP";
const MIRAS_MAX_EMBEDDED_ATTACHMENT_DATA_URL_CHARS = 3_000_000;
function mirasDeadlineEndMs(value: any): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999).getTime();
  }
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function mirasSubmissionFileExtension(fileName: any): string {
  return path.extname(String(fileName || "").split(/[?#]/)[0]).toLowerCase();
}
function mirasUnsupportedSubmissionFileResponse(fileName: any, ext?: string) {
  const originalName = sanitizeAttachmentOriginalName(fileName || "ملف");
  const suffix = ext ? ` (${ext})` : "";
  return {
    code: "UNSUPPORTED_FILE_TYPE",
    error: `صيغة الملف "${originalName}" غير مدعومة${suffix}. الصيغ المتاحة: ${MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL}.`,
  };
}
function isMirasSubmissionFileTypeAllowed(fileName: any): boolean {
  const ext = mirasSubmissionFileExtension(fileName);
  return !!ext && MIRAS_ALLOWED_SUBMISSION_EXTENSIONS.includes(ext);
}

// SUBMISSION ATTACHMENTS API
app.post("/api/submissions/upload", (req: any, res: any) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: "لم يتم اختيار أي ملف للرفع" });
  }

  const uploadedFile = req.files.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: "الملف المرفوع غير موجود" });
  }

  const fileArray = Array.isArray(uploadedFile) ? uploadedFile : [uploadedFile];
  const targetFile = fileArray[0];

  // Limit content size: 25MB
  const maxSizeBytes = 25 * 1024 * 1024;
  if (targetFile.size > maxSizeBytes) {
    return res
      .status(400)
      .json({ error: "حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت)" });
  }

  const originalName = sanitizeAttachmentOriginalName(targetFile.name || "unnamed");
  const ext = path.extname(originalName).toLowerCase();
  const dangerousExtensions = [
    ".exe",
    ".bat",
    ".cmd",
    ".sh",
    ".js",
    ".ts",
    ".html",
    ".htm",
    ".php",
    ".py",
    ".jar",
    ".apk",
    ".dmg",
    ".pkg",
    ".vbs",
    ".msi",
    ".com",
    ".scr",
  ];
  if (dangerousExtensions.includes(ext)) {
    return res
      .status(415)
      .json({
        code: "FILE_TYPE_NOT_ALLOWED",
        error: `صيغة الملف "${originalName}" غير مسموحة. الصيغ المتاحة: ${MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL}.`,
      });
  }

  if (!isMirasSubmissionFileTypeAllowed(originalName)) {
    return res
      .status(415)
      .json(mirasUnsupportedSubmissionFileResponse(originalName, ext));
  }

  const mimeType = (targetFile.mimetype || "").toLowerCase();
  const dangerousMimeTypes = [
    "application/x-msdownload",
    "application/x-sh",
    "application/javascript",
    "text/html",
    "application/x-httpd-php",
    "application/java-archive",
  ];
  if (dangerousMimeTypes.some((m) => mimeType.includes(m))) {
    return res
      .status(415)
      .json({
        code: "FILE_TYPE_NOT_ALLOWED",
        error: `صيغة الملف "${originalName}" غير مسموحة. الصيغ المتاحة: ${MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL}.`,
      });
  }

  const uploadsDir = ensureSubmissionUploadsDir();

  const fileId =
    "file-" + Math.random().toString(36).substring(2, 9) + "-" + Date.now();
  const storedName = `${fileId}${ext}`;
  const filePath = path.join(uploadsDir, storedName);

  targetFile.mv(filePath, async (err: any) => {
    if (err) {
      console.error("Error moving uploaded file:", err);
      return res.status(500).json({ error: "تعذر حفظ الملف على الخادم" });
    }

    const attachmentUrl = `/api/submission-attachments/${fileId}`;
    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.isBuffer(targetFile.data) && targetFile.data.length
        ? targetFile.data
        : fs.readFileSync(filePath);
    } catch {
      return res.status(500).json({
        error: "تعذر قراءة الملف بعد رفعه. أعد المحاولة.",
        code: "ATTACHMENT_READ_FAILED",
      });
    }

    const archived = await dbInstance.saveSubmissionAttachmentArchive({
      fileId,
      originalName,
      mimeType: mimeType || "application/octet-stream",
      size: targetFile.size,
      storedName,
      base64: fileBuffer.toString("base64"),
    });
    if (!archived) {
      return res.status(503).json({
        error:
          "تعذر تأكيد حفظ المرفق في الأرشيف السحابي. لم نسجل رفعًا وهميًا؛ حاول مرة أخرى بعد قليل.",
        code: "ATTACHMENT_CLOUD_ARCHIVE_FAILED",
      });
    }

    // تحويل مسبق (غير متزامن) لملفات Office إلى PDF وتخزينه دائماً، حتى يكون
    // أول فتح للمعلم فورياً بلا انتظار تحويل. لا يؤخّر رد الرفع للطالب، والدالة
    // تتجاهل تلقائياً أي نوع ليس PowerPoint/Word.
    void preconvertOfficeAttachmentToPdf(fileId, fileBuffer, originalName);

    const attachment = {
      id: fileId,
      fileId,
      originalName,
      storedName,
      mimeType,
      size: targetFile.size,
      url: attachmentUrl,
      storedUrl: attachmentUrl,
      downloadUrl: attachmentUrl,
      uploadedAt: new Date().toISOString(),
      persisted: true,
      archived: true,
      cloudPersisted: true,
    };

    return res.json({ success: true, attachment });
  });
});

// تحويل ppt/pptx/doc/rtf إلى PDF على السيرفر (عبر LibreOffice headless) ليُعرض
// داخل نفس عارض PDF.js دون تنزيل أو فتح برنامج خارجي — بدل شاشة "افتح كامل"
// القديمة. LibreOffice هو الخيار الوحيد الذي يحافظ على شكل الشرائح/المستند
// الحقيقي (لا نص فقط)، وتنفيذه هنا (لا عبر خدمة Google/Microsoft الخارجية)
// يضمن بقاء ملفات تسليمات الطلاب داخل خوادمنا فقط، دون رفعها لجهة ثالثة.
const MIRAS_OFFICE_CONVERTIBLE_EXTS = new Set([".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx", ".rtf"]);
const MIRAS_OFFICE_CONVERSION_TIMEOUT_MS = 25_000;
const MIRAS_UNOCONVERT_TIMEOUT_MS = 10_000;
const officeConversionCacheDir = path.join(os.tmpdir(), "miras-office-pdf-cache");

function officeConversionCachePath(filePath: string, mtimeMs: number): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${filePath}:${mtimeMs}`)
    .digest("hex");
  return path.join(officeConversionCacheDir, `${hash}.pdf`);
}

// ── LibreOffice الدائم (unoserver) لتسريع مشاهدة المستندات ───────────────────
// كان كل تحويل يطلق LibreOffice من الصفر (~٥ث لإقلاعه) فمشاهدة كل مستند طالب
// بطيئة. الآن نبقي LibreOffice قيد التشغيل دائماً عبر unoserver، فيصبح كل تحويل
// عبر unoconvert بحدود ثانية. مع fallback كامل إلى soffice --convert-to إن لم
// يكن unoserver متاحاً/جاهزاً أو فشل — فلا ينكسر عرض المستندات إطلاقاً.
let mirasUnoserverProc: any = null;
function ensureUnoserverStarted(): void {
  if (mirasUnoserverProc) return;
  try {
    const proc = spawn("unoserver", [], {
      stdio: "ignore",
      env: { ...process.env, HOME: process.env.HOME || os.tmpdir() },
    });
    proc.on("exit", () => {
      if (mirasUnoserverProc === proc) mirasUnoserverProc = null;
    });
    proc.on("error", () => {
      if (mirasUnoserverProc === proc) mirasUnoserverProc = null;
    });
    mirasUnoserverProc = proc;
  } catch {
    mirasUnoserverProc = null;
  }
}
// نبدأ تشغيله مبكراً عند إقلاع الخادم حتى يكون "دافئاً" قبل أول مشاهدة مستند.
try {
  ensureUnoserverStarted();
} catch {}

function convertViaUnoconvert(filePath: string, outDir: string): Promise<Buffer> {
  ensureUnoserverStarted();
  const outPath = path.join(outDir, "uno-out.pdf");
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "unoconvert",
      ["--convert-to", "pdf", filePath, outPath],
      { stdio: "ignore", env: { ...process.env, HOME: process.env.HOME || os.tmpdir() } },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("unoconvert timed out"));
    }, MIRAS_UNOCONVERT_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`unoconvert exited with code ${code}`));
      try {
        if (!fs.existsSync(outPath)) return reject(new Error("unoconvert produced no output"));
        resolve(fs.readFileSync(outPath));
      } catch (e) {
        reject(e as any);
      }
    });
  });
}

// المسار الاحتياطي: إطلاق soffice من جديد بملف شخصي خاص (أبطأ لكنه يعمل دائماً).
function convertViaSoffice(filePath: string, workDir: string): Promise<Buffer> {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "miras-lo-profile-"));
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "soffice",
      [
        "--headless",
        "--norestore",
        `-env:UserInstallation=file://${profileDir}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        filePath,
      ],
      { stdio: "ignore" },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LibreOffice conversion timed out"));
    }, MIRAS_OFFICE_CONVERSION_TIMEOUT_MS);
    const cleanup = () => {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {}
    };
    child.on("error", (err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) return reject(new Error(`LibreOffice exited with code ${code}`));
        const producedPath = path.join(
          workDir,
          `${path.basename(filePath, path.extname(filePath))}.pdf`,
        );
        if (!fs.existsSync(producedPath))
          return reject(new Error("Conversion did not produce an output file"));
        resolve(fs.readFileSync(producedPath));
      } catch (e) {
        reject(e as any);
      } finally {
        cleanup();
      }
    });
  });
}

async function convertOfficeFileToPdf(filePath: string): Promise<Buffer> {
  if (!fs.existsSync(officeConversionCacheDir)) {
    fs.mkdirSync(officeConversionCacheDir, { recursive: true });
  }
  // مفتاح الكاش من محتوى الملف (لا مساره المؤقّت) حتى تُصيب إعادة فتح نفس المستند
  // الكاش فوراً حتى لو كُتب في مسار مؤقّت مختلف كل مرة (فتظهر إعادة العرض لحظية).
  const content = fs.readFileSync(filePath);
  const cachePath = path.join(
    officeConversionCacheDir,
    `${crypto.createHash("sha1").update(content).digest("hex")}.pdf`,
  );
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "miras-lo-out-"));
  try {
    let buffer: Buffer;
    try {
      buffer = await convertViaUnoconvert(filePath, workDir); // السريع (~١ث)
    } catch {
      buffer = await convertViaSoffice(filePath, workDir); // fallback آمن
    }
    fs.writeFileSync(cachePath, buffer);
    return buffer;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// إزالة الازدواج أثناء التنفيذ: التسخين المسبق (٣ مرفقات) + نقرة المعلم على
// نفس الملف كانت تُطلق عدة تحويلات LibreOffice متزامنة للملف الواحد فتتزاحم
// على المعالج. هنا تتشارك كل الطلبات المتزامنة لنفس المعرّف تحويلاً واحداً.
const mirasInFlightPdfConversions = new Map<string, Promise<Buffer>>();
function convertOfficeFileToPdfDeduped(
  filePath: string,
  dedupKey: string,
): Promise<Buffer> {
  const key = String(dedupKey || "").trim();
  if (!key) return convertOfficeFileToPdf(filePath);
  const existing = mirasInFlightPdfConversions.get(key);
  if (existing) return existing;
  const p = convertOfficeFileToPdf(filePath).finally(() => {
    if (mirasInFlightPdfConversions.get(key) === p) {
      mirasInFlightPdfConversions.delete(key);
    }
  });
  mirasInFlightPdfConversions.set(key, p);
  return p;
}

// التحويل المسبق عند الرفع: جوهر جعل العرض «في ثانية» مع ١٠٠ طالب. نحوّل ملف
// Office إلى PDF مرة واحدة لحظة الرفع (غير متزامن، الطالب لا ينتظر) ونخزّنه
// بشكل دائم، فيصبح أول فتح للمعلم تقديماً فورياً لـ PDF جاهز بلا أي تحويل.
async function preconvertOfficeAttachmentToPdf(
  fileId: string,
  buffer: Buffer,
  originalName: string,
): Promise<void> {
  const id = String(fileId || "").trim();
  const ext = path
    .extname(sanitizeAttachmentOriginalName(originalName || "attachment"))
    .toLowerCase();
  if (!id || !buffer?.length || !MIRAS_OFFICE_CONVERTIBLE_EXTS.has(ext)) return;
  try {
    const existing = await dbInstance.getConvertedPdfArchive(id);
    if (existing?.length) return; // محوّل ومخزّن مسبقاً
  } catch {}
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "miras-preconvert-"));
  const tempPath = path.join(workDir, `source${ext}`);
  try {
    fs.writeFileSync(tempPath, buffer);
    const pdf = await convertOfficeFileToPdfDeduped(tempPath, `pdf:${id}`);
    if (pdf?.length) await dbInstance.saveConvertedPdfArchive(id, pdf);
  } catch (err: any) {
    console.warn(
      "⚠️ Office pre-conversion at upload failed:",
      err?.message || err,
    );
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
}

// يُرجع true إذا تولّى الرد (نجاحًا أو فشلاً)، false إذا يجب إكمال المعالجة
// العادية (لم يُطلب تحويل، أو النوع لا يحتاجه أصلاً).
async function respondWithPdfConversionIfRequested(
  req: any,
  res: any,
  filePath: string,
  originalName: string,
  fileId?: string,
): Promise<boolean> {
  if (String(req.query.as || "").toLowerCase() !== "pdf") return false;
  const ext = path.extname(originalName).toLowerCase();
  if (!MIRAS_OFFICE_CONVERTIBLE_EXTS.has(ext)) return false;
  const id = String(fileId || "").trim();
  // الكاش الدائم أولاً: إن وُجد PDF جاهز نقدّمه فوراً بلا LibreOffice.
  if (id) {
    try {
      const cached = await dbInstance.getConvertedPdfArchive(id);
      if (cached?.length) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "private, max-age=86400");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(cached);
        return true;
      }
    } catch {}
  }
  try {
    const pdfBuffer = await convertOfficeFileToPdfDeduped(
      filePath,
      id ? `pdf:${id}` : "",
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(pdfBuffer);
    // خزّن الناتج دائماً (غير متزامن) حتى تكون العروض التالية فورية.
    if (id && pdfBuffer?.length) {
      dbInstance.saveConvertedPdfArchive(id, pdfBuffer).catch(() => {});
    }
  } catch (err: any) {
    console.error("⚠️ Office-to-PDF conversion failed:", err?.message || err);
    res.status(502).json({ code: "OFFICE_PREVIEW_FAILED", error: "تعذر تجهيز معاينة المستند الآن. نزّل الملف أو جرّب مرة أخرى." });
  }
  return true;
}

async function respondWithPdfConversionBufferIfRequested(
  req: any,
  res: any,
  buffer: Buffer,
  originalName: string,
  fileId?: string,
): Promise<boolean> {
  if (String(req.query.as || "").toLowerCase() !== "pdf") return false;
  const safeName = sanitizeAttachmentOriginalName(originalName || "attachment");
  const ext = path.extname(safeName).toLowerCase();
  if (!MIRAS_OFFICE_CONVERTIBLE_EXTS.has(ext)) return false;
  if (!buffer?.length) return false;

  const id = String(fileId || "").trim();
  // الكاش الدائم أولاً: إن وُجد PDF جاهز نقدّمه فوراً بلا كتابة ملف ولا تحويل.
  if (id) {
    try {
      const cached = await dbInstance.getConvertedPdfArchive(id);
      if (cached?.length) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "private, max-age=86400");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(cached);
        return true;
      }
    } catch {}
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "miras-office-archive-"));
  const tempPath = path.join(workDir, `source${ext}`);
  try {
    fs.writeFileSync(tempPath, buffer);
    const pdfBuffer = await convertOfficeFileToPdfDeduped(
      tempPath,
      id ? `pdf:${id}` : "",
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(pdfBuffer);
    // خزّن الناتج دائماً (غير متزامن) حتى تكون العروض التالية فورية.
    if (id && pdfBuffer?.length) {
      dbInstance.saveConvertedPdfArchive(id, pdfBuffer).catch(() => {});
    }
  } catch (err: any) {
    console.error("⚠️ Archived Office-to-PDF conversion failed:", err?.message || err);
    res.status(502).json({ code: "OFFICE_PREVIEW_FAILED", error: "تعذر تجهيز معاينة العرض الآن. نزّل الملف أو جرّب مرة أخرى." });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return true;
}

async function respondWithStoredSubmissionAttachmentBuffer(
  req: any,
  res: any,
  archive: { buffer: Buffer; originalName: string; mimeType: string } | null,
  fileId?: string,
) {
  if (!archive?.buffer?.length) return false;
  if (
    await respondWithPdfConversionBufferIfRequested(
      req,
      res,
      archive.buffer,
      archive.originalName,
      fileId,
    )
  ) {
    return true;
  }
  return sendStoredSubmissionAttachmentBuffer(res, archive);
}

async function respondWithStoredSubmissionAttachmentDataUrl(
  req: any,
  res: any,
  fallback: { dataUrl: string; originalName?: string; mimeType?: string } | null,
  fileId?: string,
) {
  if (!fallback?.dataUrl?.startsWith("data:")) return false;
  const match = fallback.dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/);
  if (!match) return false;
  try {
    const buffer = Buffer.from(match[2] || "", "base64");
    if (
      await respondWithPdfConversionBufferIfRequested(
        req,
        res,
        buffer,
        fallback.originalName || "attachment",
        fileId,
      )
    ) {
      return true;
    }
  } catch {}
  return sendStoredSubmissionAttachmentDataUrl(res, fallback);
}

app.get("/api/submission-attachments/:fileId", async (req: any, res: any) => {
  const requestedId = submissionAttachmentFileIdFromValue(req.params.fileId) || String(req.params.fileId || "").trim();
  const uploadsDir = submissionUploadsDir();

  if (!requestedId) {
    return res.status(404).json({ error: "الملف المطلوب غير موجود" });
  }

  const submission = findSubmissionByAttachmentId(requestedId);
  if (!submission) {
    return res.status(404).json({ error: "الملف المطلوب غير موجود" });
  }
  const teacherEmail = teacherEmailFromRequest(req);
  const session = verifyMirasSessionToken(req);
  if (teacherEmail) {
    const courseCode = String(
      submission.courseCode || submission.sectionCode || "",
    );
    const submissionOwner = String(
      submission.teacherEmail ||
        submission.createdBy ||
        sectionOwnerEmail(courseCode) ||
        "",
    ).toLowerCase();
    if (
      !isAdminEmail(teacherEmail) &&
      submissionOwner &&
      submissionOwner !== teacherEmail
    ) {
      return res.status(403).json({ error: "غير مصرح لك بفتح هذا المرفق." });
    }
  } else if (
    session?.role !== "student" ||
    normalizeStudentId(session.userId) !==
      normalizeStudentId(submission.studentId)
  ) {
    return res.status(403).json({ error: "غير مصرح لك بفتح هذا المرفق." });
  }

  if (!fs.existsSync(uploadsDir)) {
    const archive = await dbInstance.getSubmissionAttachmentArchive(requestedId);
    if (await respondWithStoredSubmissionAttachmentBuffer(req, res, archive, requestedId)) return;
    const fallback = findStoredSubmissionAttachmentDataUrl(requestedId);
    if (await respondWithStoredSubmissionAttachmentDataUrl(req, res, fallback, requestedId)) return;
    return res.status(404).json({ error: "الملف المطلوب غير موجود" });
  }

  const files = fs.readdirSync(uploadsDir);
  const matchedFile = files.find(
    (f) => f === requestedId || f.startsWith(`${requestedId}.`),
  );

  if (!matchedFile) {
    const archive = await dbInstance.getSubmissionAttachmentArchive(requestedId);
    if (await respondWithStoredSubmissionAttachmentBuffer(req, res, archive, requestedId)) return;
    const fallback = findStoredSubmissionAttachmentDataUrl(requestedId);
    if (await respondWithStoredSubmissionAttachmentDataUrl(req, res, fallback, requestedId)) return;
    return res
      .status(404)
      .json({ error: "الملف المطلوب غير متوفر أو تم حذفه" });
  }

  const filePath = path.join(uploadsDir, matchedFile);
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat || !stat.isFile()) {
    const archive = await dbInstance.getSubmissionAttachmentArchive(requestedId);
    if (await respondWithStoredSubmissionAttachmentBuffer(req, res, archive, requestedId)) return;
    const fallback = findStoredSubmissionAttachmentDataUrl(requestedId);
    if (await respondWithStoredSubmissionAttachmentDataUrl(req, res, fallback, requestedId)) return;
    return res.status(404).json({ error: "الملف المطلوب غير متوفر أو تم حذفه" });
  }
  if (await respondWithPdfConversionIfRequested(req, res, filePath, matchedFile, requestedId)) {
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(matchedFile)}`,
  );
  return res.sendFile(filePath);
});

// Student Project submission
app.post("/api/projects/submit", (req, res) => {
  const { projectId, submissionText, submissionFileName, submissionFile } =
    req.body;
  const project = dbInstance
    .getPersonalizedProjects()
    .find((p) => p.id === projectId);
  if (!project)
    return res.status(404).json({ error: "المشروع الأكاديمي غير متوفر" });
  if (project.status === "submitted" || project.status === "graded") {
    return res
      .status(409)
      .json({
        error:
          "تم تسليم هذا المشروع مسبقاً وتم قفله. لا يفتح مرة أخرى إلا بعد إرجاعه من المعلم.",
      });
  }
  // منع التسليم الفارغ: لا بد من نص أو مرفق واحد على الأقل.
  const hasProjectText = String(submissionText || "").trim().length > 0;
  const hasProjectFile =
    !!submissionFile || String(submissionFileName || "").trim().length > 0;
  if (!hasProjectText && !hasProjectFile) {
    return res
      .status(400)
      .json({
        error: "لا يمكن تسليم مشروع فارغ. أضف نصاً أو أرفق ملفاً قبل التسليم.",
      });
  }
  if (String(submissionFileName || "").trim() && !isMirasSubmissionFileTypeAllowed(submissionFileName)) {
    return res
      .status(415)
      .json(mirasUnsupportedSubmissionFileResponse(submissionFileName));
  }
  const closeMs = project.closeDate ? mirasDeadlineEndMs(project.closeDate) : 0;
  if (
    closeMs &&
    Number.isFinite(closeMs) &&
    closeMs < Date.now() &&
    !getActiveReturnException("project", project.id, project.studentId)
  ) {
    return res
      .status(403)
      .json({
        error:
          "انتهى وقت إغلاق المشروع. يحتاج الطالب إلى نافذة استثناء من الأستاذ.",
      });
  }

  // لا يُوسم التسليم بأنه متأخر إلا بعد نهاية يوم الإغلاق،
  // وليس بمجرد تجاوز موعد التسليم الأولي أثناء نافذة الإتاحة.
  const projectLateDeadlineMs = mirasDeadlineEndMs(
    project.closeDate || project.dueDate || "",
  );
  const projectSubmittedLate = !!(
    projectLateDeadlineMs &&
    Number.isFinite(projectLateDeadlineMs) &&
    Date.now() > projectLateDeadlineMs
  );
  const submittedAt = new Date().toISOString();

  dbInstance.updatePersonalizedProject(projectId, {
    submissionText,
    submissionFile,
    submissionFileName,
    status: "submitted",
    submittedAt,
    submittedLate: projectSubmittedLate,
    resubmittedAt:
      project.status === "returned"
        ? submittedAt
        : project.resubmittedAt,
  });

  // Increment student progress
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === project.studentId);
  const courseCode = String(
    (project as any).courseCode || project.sectionCode || "",
  ).trim();
  const teacherSubmission = upsertRuntimeTeacherSubmission({
    id: `project-${project.id}-${project.studentId}`,
    kind: "project",
    activityId: project.id,
    activityTitle: project.title || "مشروع شخصي",
    courseCode,
    studentId: project.studentId,
    studentName: student?.name || project.studentName || project.studentId,
    answerText:
      String(submissionText || "").trim() ||
      "تم تسليم المشروع بمرفق ومستندات.",
    fileName: submissionFileName || "",
    submissionFileName: submissionFileName || "",
    hasSubmissionFile: !!submissionFile,
    status: "مقفل بعد التسليم",
    submittedAt,
    updatedAt: submittedAt,
    submittedLate: projectSubmittedLate,
    source: "personalized_project",
    personalizedProject: true,
  });
  if (student) {
    dbInstance.updateStudent(student.id, {
      progress: Math.min(100, student.progress + 30), // Add 30% progress
    });

    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "تسليم مشروع نهائي",
      details: `قام الطالب بتسليم مشروعه الشخصي (${project.title}) بنجاح للمراجعة والتقييم.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "مستند الطالب",
      browser: "الأرشيف الأكاديمي",
      isViolationWarning: false,
    });
  }

  return res.json({ success: true, submission: teacherSubmission });
});

// Teacher grade Project
app.post("/api/projects/:id/grade", (req, res) => {
  const { grade, feedback } = req.body;
  const project = dbInstance
    .getPersonalizedProjects()
    .find((p) => p.id === req.params.id);
  if (!project)
    return res.status(404).json({ error: "المشروع غير متوفر للتدقيق" });

  dbInstance.updatePersonalizedProject(project.id, {
    grade: Number(grade),
    gradeFeedback: feedback,
    status: "graded",
    gradedAt: new Date().toISOString(),
  });

  // Add score points to student
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === project.studentId);
  if (student) {
    dbInstance.updateStudent(student.id, {
      score: student.score + Number(grade) * 2, // point boost for projects
      progress: Math.min(100, student.progress + 15),
    });

    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "تقييم أستاذ المادة",
      details: `تم الانتهاء من مراجعة المشروع ورصد علامة: ${grade}/100 بنجاح مع صياغة المبررات والدروس المستفادة.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "لوحة تحكم الأستاذ",
      browser: "متصفح الويب",
      isViolationWarning: false,
    });
  }

  return res.json({ success: true });
});

// ================= ONLINE PAYMENT SIMULATOR =================

app.post("/api/payment/simulate", (req, res) => {
  const { studentId, paymentMethod, amount } = req.body;
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });

  dbInstance.updateStudent(student.id, { isPaid: true });

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "سداد رمزي للخدمات",
    details: `تم الاشتراك بنجاح في مختبر التطبيق والمراجعة بمبلغ ${amount || "15"} د.ك عبر بوابة (${paymentMethod}) ورقم المعاملة: KNET-${Math.floor(100000 + Math.random() * 900000)}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "بوابة السداد الإلكتروني",
    browser: "مصدق كويتي",
    isViolationWarning: false,
  });

  return res.json({
    success: true,
    invoice: {
      transactionId: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
      date: new Date().toISOString(),
      studentName: student.name,
      studentId: student.id,
      amount: amount || "15 د.ك",
      method: paymentMethod,
      semester: student.semester,
      status: "مدفوع بنجاح",
    },
  });
});

// ================= JOIN CODE SYSTEM ENDPOINTS =================

function processStudentCourseActivation(
  req: express.Request,
  res: express.Response,
  studentId: string,
  joinCodeRaw: string,
  registrationParams?: {
    name?: string;
    email?: string;
    semester?: string;
    password?: string;
  }
) {
  const normStudentId = normalizeStudentId(studentId);
  const normJoinCode = normalizeJoinCode(joinCodeRaw);
  const compactCode = compactJoinCode(joinCodeRaw);
  ensureDeviceSecretCookie(req, res);

  if (!normStudentId || !normJoinCode) {
    return res
      .status(400)
      .json(activationFailurePayload("ACTIVATION_INPUT_MISSING", "الرجاء إدخال الرقم الجامعي وكود التفعيل."));
  }

  const rateLimitStudent = {
    id: normStudentId,
    name: registrationParams?.name || normStudentId,
  } as any;
  if (
    sendActivationRateLimitIfNeeded(req, res, {
      code: joinCodeRaw,
      student: rateLimitStudent,
    })
  ) {
    return;
  }

  // 1. Find the Join Code in database
  const allCodes = dbInstance.getJoinCodes();
  const foundCode = allCodes.find(
    (jc) =>
      isUnifiedJoinCode(jc.code) &&
      (normalizeJoinCode(jc.code) === normJoinCode ||
        compactJoinCode(jc.code) === compactCode),
  );

  if (!foundCode) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId, name: registrationParams?.name || normStudentId } as any,
      reason: "محاولة استخدام كود غير موجود",
    });
    return res
      .status(404)
      .json(activationFailurePayload("INVALID_CODE", "الكود غير صحيح، حاول مرة أخرى."));
  }

  const signatureState = ensureJoinCodeSignature(foundCode);
  if (!signatureState.ok) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId, name: registrationParams?.name || normStudentId } as any,
      reason: "توقيع الكود غير صحيح",
      foundCode,
    });
    return res
      .status(400)
      .json(activationFailurePayload("INVALID_CODE", "الكود غير صحيح، حاول مرة أخرى."));
  }

  // 2. Check if revoked
  if (foundCode.status === "revoked") {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId } as any,
      reason: "محاولة استخدام كود ملغى",
      foundCode,
    });
    return res
      .status(400)
      .json(activationFailurePayload("CODE_REVOKED", "الكود موقوف أو غير متاح. اطلب كودًا جديدًا من أستاذ المقرر."));
  }

  if (isSoftDeletedRecord(foundCode) || isArchivedJoinCodeRecord(foundCode)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId } as any,
      reason: "محاولة استخدام كود مؤرشف أو محذوف",
      foundCode,
    });
    return res
      .status(410)
      .json(activationFailurePayload("CODE_ARCHIVED", "هذا الكود مؤرشف أو محذوف ولا يمكن استخدامه. اطلب كودًا جديدًا من أستاذ المقرر."));
  }

  const codeOwner = joinCodeOwnerEmail(foundCode);
  const claimedStudentId = normalizeStudentId(
    (foundCode as any).assignedStudentId ||
      (foundCode as any).studentId ||
      (foundCode as any).usedByStudentId ||
      "",
  );
  if (claimedStudentId && claimedStudentId !== normStudentId) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId, name: registrationParams?.name || normStudentId } as any,
      reason: "محاولة استخدام كود مخصص لطالب آخر",
      foundCode,
    });
    return res.status(403).json({
      ...activationFailurePayload(
        "CODE_ASSIGNED_TO_OTHER",
        "هذا الكود مخصص لطالب آخر. استخدم الكود الصادر باسمك من أستاذ المقرر.",
      ),
    });
  }
  const requestedCourse = String(req.body?.courseCode || req.body?.sectionCode || "").trim();
  let activationCourseCode = activationCourseCodeOrFallback(foundCode, { id: normStudentId } as any, codeOwner);
  
  const allowedRowsForStudent = dbInstance
    .getAllowedStudents()
    .filter((s) => normalizeStudentId(s.idNumber || (s as any).id || (s as any).studentId) === normStudentId);

  // الكود المستهلك له مقرر واحد نهائي ولا يجوز إعادة توجيهه لمقرر آخر حتى لو
  // كان الطالب نفسه، الجهاز نفسه، والأستاذ نفسه. كان السماح لـ requestedCourse
  // أن يتقدم على كود مستخدم يفتح ثغرة خطيرة: نسخ كود مقرر قديم من الأرشيف
  // واستخدامه لتفعيل مقرر جديد. لذلك نثبت دورة الكود المستهلك على مقرره الأصلي
  // فقط، وأي اختلاف في المقرر يُرفض قبل فحص الجهاز أو تحديث الطالب.
  const foundCodeAlreadyConsumed = joinCodeIsConsumedRecord(foundCode);
  const codeCourseValues = [
    (foundCode as any).sectionCode,
    (foundCode as any).studentSection,
    (foundCode as any).courseCode,
    (foundCode as any).resolvedCourseCode,
    (foundCode as any).activatedCourseCode,
  ]
    .map((value: any) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const codeIsGeneralActivation =
    !foundCodeAlreadyConsumed &&
    (codeCourseValues.length === 0 ||
      codeCourseValues.every((value: string) => value === "all") ||
      String(activationCourseCode || "").trim().toLowerCase() === "all");
  if (codeIsGeneralActivation && !requestedCourse && allowedRowsForStudent.length > 0) {
    const rosterCourseCandidates: string[] = [];
    allowedRowsForStudent.forEach((row: any) => {
      const rawCourse = String(row?.sectionCode || row?.studentSection || row?.courseCode || "").trim();
      if (!rawCourse || rawCourse.toLowerCase() === "all") return;
      const rowOwner = String(
        row?.teacherEmail || extractEmailFromSectionCode(rawCourse) || sectionOwnerEmail(rawCourse) || "",
      ).toLowerCase();
      if (!isAdminEmail(codeOwner) && rowOwner && codeOwner && rowOwner !== codeOwner) return;
      const resolved = String(sectionForCourseCode(rawCourse, rowOwner || codeOwner)?.code || rawCourse).trim();
      if (!resolved || resolved.toLowerCase() === "all") return;
      if (!rosterCourseCandidates.some((existing) => courseMatchesRemovalTarget(existing, resolved, rowOwner || codeOwner))) {
        rosterCourseCandidates.push(resolved);
      }
    });
    // التفعيل الأول بالكود العام يجب أن يبقى ممكناً من شاشة إنشاء الحساب بدون
    // بطاقة مقرر مسبقة. حماية استخدام كود قديم لمقرر آخر موجودة أسفلها فقط
    // للأكواد المستهلكة؛ أما الكود العام النشط فيُربط بأول مقرر صالح في الكشف
    // كما كان، حتى لا نكسر تسجيل الطالب لأول مرة.
    if (rosterCourseCandidates.length >= 1) {
      activationCourseCode = rosterCourseCandidates[0];
    }
  }
  if (foundCodeAlreadyConsumed) {
    const lockedCourse = joinCodeLockedActivationCourse(foundCode);
    if (!lockedCourse) {
      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student: { id: normStudentId, name: registrationParams?.name || normStudentId } as any,
        reason: "محاولة استخدام كود مستخدم بلا مقرر مقفل",
        foundCode,
      });
      return res
        .status(409)
        .json(activationFailurePayload("CODE_USED", "الكود مستخدم بالفعل. اطلب كودًا جديدًا من أستاذ المقرر."));
    }
    if (requestedCourse && !consumedJoinCodeMatchesCourse(foundCode, requestedCourse, codeOwner)) {
      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student: { id: normStudentId, name: registrationParams?.name || normStudentId } as any,
        reason: "محاولة استخدام كود مقرر سابق لتفعيل مقرر مختلف",
        foundCode,
      });
      return res.status(409).json(
        activationFailurePayload(
          "CODE_COURSE_MISMATCH",
          "هذا الكود مستخدم ومقفل على مقرر آخر. استخدم الكود الجديد الخاص بهذا المقرر.",
        ),
      );
    }
    activationCourseCode = lockedCourse;
  } else if (requestedCourse) {
    // أولوية المقرر المحدّد صراحةً: حين يُدخل الطالب الكود من كرت مقرر بعينه
    // (requestedCourse) ويكون مُدرجاً في كشف ذلك المقرر، فهو المقصود قطعاً. نُقدّمه
    // على الاستنتاج التلقائي — وليس فقط حين يكون activationCourseCode = "all" —
    // حتى لا يلتبس الرمز العام عندما يكون الطالب في أكثر من مقرر، فيُربط بمقرر
    // خاطئ أو يُستهلك الكود دون إدخال الطالب لمقرّره المطلوب. ولا نسمح بتحويل رمز
    // خاص بمقرر أستاذٍ آخر إلى مقرر مختلف: نشترط أن يكون الرمز عاماً (admin/all)
    // أو أن يملك صاحبه المقرر المطلوب أو يطابقه. هذا السماح للأكواد النشطة فقط.
    const requestedOwner = String(
      sectionForCourseCode(requestedCourse, codeOwner)?.ownerEmail ||
        sectionOwnerEmail(requestedCourse)
    ).toLowerCase();
    const isInRequestedRoster = allowedRowsForStudent.some((r) =>
      allowedStudentMatchesCourse(
        r,
        normStudentId,
        requestedCourse,
        isAdminEmail(codeOwner) ? requestedOwner : codeOwner,
      )
    );
    const codeCanActivateRequested =
      activationCourseCode.toLowerCase() === "all" ||
      isAdminEmail(codeOwner) ||
      courseCodeMatchesForTeacher(requestedCourse, activationCourseCode, codeOwner);
    if (isInRequestedRoster && codeCanActivateRequested) {
      activationCourseCode = requestedCourse;
    }
  }

  // 3. Find the student record (or check if we need to create it)
  let student = dbInstance
    .getStudents()
    .find((s) => normalizeStudentId(s.id) === normStudentId);

  const allowed = allowedRowsForStudent[0];
  if (!allowed) {
    return res
      .status(404)
      .json(activationFailurePayload("STUDENT_NOT_FOUND", "الطالب غير موجود في كشوفات المقررات المعتمدة."));
  }

  // We find if they are allowed for this specific course
  const rosterOwnerForActivation = String(
    sectionForCourseCode(activationCourseCode, codeOwner)?.ownerEmail ||
      sectionOwnerEmail(activationCourseCode) ||
      codeOwner
  ).toLowerCase();
  const rosterMatch = allowedRowsForStudent.find((row: any) =>
    allowedStudentMatchesCourse(
      row,
      normStudentId,
      activationCourseCode,
      isAdminEmail(codeOwner) ? rosterOwnerForActivation : codeOwner,
    ),
  );

  if (!rosterMatch) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId, name: registrationParams?.name || normStudentId } as any),
      reason: "الطالب غير موجود في كشف المقرر وقت التفعيل",
      foundCode,
    });
    return res.status(403).json({
      ...activationFailurePayload(
        "STUDENT_NOT_IN_COURSE",
        "هذا الكود يخص مقررًا لست مدرجًا في كشفه بعد. راجع أستاذ المقرر ثم أعد إدخال الكود.",
      ),
    });
  }

  const rosterAny = rosterMatch as any;
  const foundCodeAny = foundCode as any;
  const studentAny = student as any;
  const resolvedCourseCode = String(
    activationCourseCode === "all"
      ? (rosterAny.sectionCode ||
          rosterAny.studentSection ||
          rosterAny.courseCode ||
          foundCodeAny.studentSection ||
          foundCodeAny.sectionCode ||
          foundCodeAny.courseCode ||
          studentAny?.sectionCode ||
          studentAny?.studentSection ||
          "")
      : (activationCourseCode ||
          foundCodeAny.studentSection ||
          foundCodeAny.sectionCode ||
          foundCodeAny.courseCode ||
          rosterAny.sectionCode ||
          rosterAny.studentSection ||
          rosterAny.courseCode ||
          studentAny?.sectionCode ||
          studentAny?.studentSection ||
          ""),
  ).trim();

  if (!resolvedCourseCode || resolvedCourseCode.toLowerCase() === "all") {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId, name: registrationParams?.name || normStudentId } as any),
      reason: "لم يتم تحديد شعبة المقرر وقت التفعيل",
      foundCode,
    });
    return res
      .status(400)
      .json(activationFailurePayload("COURSE_NOT_FOUND", "تعذر تحديد مقرر هذا الكود. راجع أستاذ المقرر لتحديث الشعبة المرتبطة بالكود."));
  }

  if (foundCodeAlreadyConsumed && !consumedJoinCodeMatchesCourse(foundCode, resolvedCourseCode, codeOwner)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId, name: registrationParams?.name || normStudentId } as any),
      reason: "محاولة إعادة ربط كود مستخدم بمقرر غير مقرره الأصلي",
      foundCode,
    });
    return res.status(409).json(
      activationFailurePayload(
        "CODE_COURSE_MISMATCH",
        "هذا الكود مستخدم ومقفل على مقرر آخر. استخدم الكود الجديد الخاص بهذا المقرر.",
      ),
    );
  }

  const courseOwner = String(
    sectionForCourseCode(resolvedCourseCode, codeOwner)?.ownerEmail ||
      sectionOwnerEmail(resolvedCourseCode)
  ).toLowerCase();

  const codeOwnerCanActivateCourse =
    codeOwner === courseOwner ||
    isAdminEmail(codeOwner) ||
    teacherOwnsCourseCode(resolvedCourseCode, codeOwner) ||
    courseCodeMatchesForTeacher(resolvedCourseCode, activationCourseCode, codeOwner) ||
    (rosterMatch && String((rosterMatch as any).teacherEmail || "").trim().toLowerCase() === codeOwner);

  if (!codeOwnerCanActivateCourse) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId } as any),
      reason: "الكود لا يتبع أستاذ المقرر",
      foundCode,
    });
    return res
      .status(403)
      .json(activationFailurePayload("INVALID_CODE", "الكود غير صحيح، حاول مرة أخرى."));
  }

  if (student && joinCodeIsStaleForStudentCourse(foundCode, student, resolvedCourseCode, courseOwner || codeOwner)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student,
      reason: "محاولة استخدام كود قديم بعد حذف الطالب من المقرر",
      foundCode,
    });
    return res
      .status(409)
      .json(
        activationFailurePayload(
          "CODE_STALE_AFTER_REMOVAL",
          "هذا الكود تابع لدورة قديمة بعد حذفك من المقرر. اطلب كودًا جديدًا من أستاذ المقرر.",
        ),
      );
  }

  const windowState = joinCodeWindowStatus(foundCode);
  if (!windowState.ok) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId } as any),
      reason: windowState.reason,
      foundCode,
    });
    const expired = String(windowState.reason || "").includes("انتهت");
    return res
      .status(403)
      .json(
        activationFailurePayload(
          expired ? "CODE_EXPIRED" : "CODE_NOT_ACTIVE",
          expired
            ? "الكود منتهي. اطلب كودًا جديدًا من أستاذ المقرر."
            : "الكود لم يبدأ وقت تفعيله بعد. حاول لاحقًا أو راجع أستاذ المقرر.",
        ),
      );
  }

  if (isJoinCodeTemporarilyFrozen(foundCode)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId } as any),
      reason: "الكود مجمّد مؤقتًا للمراجعة بسبب سلوك غير طبيعي",
      foundCode,
    });
    return res
      .status(423)
      .json(activationFailurePayload("CODE_FROZEN", "الكود موقوف مؤقتًا للمراجعة. راجع أستاذ المقرر."));
  }

  // 4. Check device binding and transfer status
  const activationDeviceToken = getRequestDeviceToken(req);
  if (!activationDeviceToken) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId } as any),
      reason: "محاولة تفعيل بدون توكن جهاز",
      foundCode,
    });
    return res.status(400).json({
      ...activationFailurePayload(
        "DEVICE_TOKEN_MISSING",
        "تعذر التحقق من الجهاز. افتح النظام من المتصفح الأصلي ثم حاول مرة أخرى.",
      ),
    });
  }

  const activationFingerprint = getRequestDeviceFingerprint(req);

  // قفل الطالب على نفس المتصفح/الجهاز المعتمد: تفعيل مقرر إضافي لا يجوز أن
  // يتحول إلى نقل جهاز صامت. إذا كان للطالب جهاز مربوط سابقاً، يجب أن يتم
  // إدخال كود أي مقرر جديد من نفس المتصفح فقط، وأي انتقال لمتصفح/جهاز آخر
  // يبقى عبر موافقة الأستاذ وفك الارتباط من لوحة المعلم.
  if (student && !(student as any).pendingDeviceTransfer) {
    const currentDevices = Array.isArray((student as any).devices)
      ? (student as any).devices.map((d: any) => String(d || "").trim()).filter(Boolean)
      : [];
    // نفس الجهاز/المتصفح المعتمد = نفس الـ deviceToken؛ تغيّر الـ IP وحده يجب ألا
    // يُحوِّل إضافة مقرر إلى "جهاز مختلف". (انظر deviceFingerprintsMatch)
    const sameRegisteredDevice = currentDevices.some((d: string) =>
      deviceFingerprintsMatch(d, activationFingerprint),
    );
    if (currentDevices.length > 0 && !sameRegisteredDevice) {
      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student,
        reason: "محاولة تفعيل مقرر من متصفح أو جهاز غير معتمد للحساب",
        foundCode,
      });
      return res.status(409).json({
        ...activationFailurePayload(
          "DEVICE_MISMATCH",
          "هذا الحساب مرتبط بمتصفح أو جهاز آخر. فعّل المقرر من نفس المتصفح المعتمد أو اطلب من الأستاذ تبديل الجهاز.",
        ),
      });
    }
  }

  const deviceBoundToOtherStudent = findStudentBoundToDevice(
    activationDeviceToken,
    activationFingerprint,
    normStudentId,
  );
  if (deviceBoundToOtherStudent) {
    const requestStudent = student || ({
      id: normStudentId,
      name: rosterMatch.name || registrationParams?.name || allowed.name || normStudentId,
      email: registrationParams?.email || `${normStudentId}@paaet.edu.kw`,
      sectionCode: resolvedCourseCode,
      studentSection: resolvedCourseCode,
    } as any);
    const conflict = activeSecondHandDeviceConflict({
      deviceToken: activationDeviceToken,
      deviceFingerprint: activationFingerprint,
      studentId: normStudentId,
      sectionCode: resolvedCourseCode,
    });
    if (conflict.conflict) {
      const pendingRequest = createSecondHandDeviceApprovalRequest({
        req,
        code: joinCodeRaw,
        foundCode,
        student: requestStudent,
        rosterMatch,
        sectionCode: resolvedCourseCode,
        teacherEmail: courseOwner,
        deviceToken: activationDeviceToken,
        deviceFingerprint: activationFingerprint,
        previousStudent: deviceBoundToOtherStudent,
      });
      return res.status(202).json({
        ...activationFailurePayload(
          "DEVICE_APPROVAL_REQUIRED",
          "هذا الجهاز سبق استخدامه في النظام. تم إرسال طلب اعتماد للأستاذ.",
        ),
        pendingDeviceApproval: true,
        approvalRequestId: pendingRequest.id,
        message: "هذا الجهاز سبق استخدامه في النظام. تم إرسال طلب اعتماد للأستاذ.",
      });
    }
    const pendingRequest = createSecondHandDeviceApprovalRequest({
      req,
      code: joinCodeRaw,
      foundCode,
      student: requestStudent,
      rosterMatch,
      sectionCode: resolvedCourseCode,
      teacherEmail: courseOwner,
      deviceToken: activationDeviceToken,
      deviceFingerprint: activationFingerprint,
      previousStudent: deviceBoundToOtherStudent,
    });
    return res.status(202).json({
      ...activationFailurePayload(
        "DEVICE_APPROVAL_REQUIRED",
        "هذا الجهاز سبق استخدامه في النظام. تم إرسال طلب اعتماد للأستاذ.",
      ),
      pendingDeviceApproval: true,
      approvalRequestId: pendingRequest.id,
      message: "هذا الجهاز سبق استخدامه في النظام. تم إرسال طلب اعتماد للأستاذ.",
    });
  }

  // Password verification if already exists and password was sent
  if (student && registrationParams?.password) {
    const submittedPassword = String(registrationParams.password).trim();
    if (!verifyPasswordFlexible(student.passwordHash, submittedPassword)) {
      return res.status(401).json({
        ...activationFailurePayload(
          "PASSWORD_MISMATCH",
          "كلمة المرور لا تطابق الحساب المسجل لهذا الرقم الجامعي.",
        ),
      });
    }
  }

  // If the code is already used, check swap or authorized device scenarios
  if (foundCodeAlreadyConsumed) {
    const sameStudentOwnsCode =
      normalizeStudentId((foundCode as any).studentId || (foundCode as any).usedByStudentId || "") === normStudentId;

    const deviceBindingCleared =
      !String((foundCode as any).activationDeviceToken || "").trim() &&
      !String((foundCode as any).activationDeviceFingerprint || "").trim();

    if (sameStudentOwnsCode && !studentAccessIsTeacherHold(student) && !deviceBindingCleared) {
      const lockedDeviceToken = String((foundCode as any).activationDeviceToken || "").trim();
      const lockedFingerprint = String((foundCode as any).activationDeviceFingerprint || "").trim();
      const tokenMatches = !!lockedDeviceToken && lockedDeviceToken === activationDeviceToken;
      const fingerprintMatches =
        !!lockedFingerprint &&
        deviceFingerprintsMatch(lockedFingerprint, activationFingerprint);
      const sameAuthorizedDevice =
        (tokenMatches && (!lockedFingerprint || fingerprintMatches)) ||
        (!lockedDeviceToken && fingerprintMatches);

      if (sameAuthorizedDevice) {
        // Device is authorized, update student status and return
        if (student) {
          dbInstance.updateStudent(student.id, {
            isPaid: true,
            isActivated: true,
            activationCode: foundCode.code,
            ...buildStudentActivationPersistencePatch(student, resolvedCourseCode || student.sectionCode),
            isAccessBlocked: false,
            accessBlockReason: "",
            devices: [activationFingerprint],
            lastLoginDate: new Date().toISOString(),
          } as any);
        }
        dbInstance.updateJoinCode(foundCode.code, {
          studentId: normStudentId,
          studentName: student?.name || registrationParams?.name || rosterMatch.name || normStudentId,
          studentSection: resolvedCourseCode || (foundCode as any).studentSection,
          sectionCode: resolvedCourseCode || (foundCode as any).sectionCode || (foundCode as any).studentSection,
          courseCode: resolvedCourseCode || (foundCode as any).courseCode || (foundCode as any).sectionCode,
          activationDeviceToken: lockedDeviceToken || activationDeviceToken,
          activationDeviceFingerprint: activationFingerprint,
          activationDeviceServerHash:
            (foundCode as any).activationDeviceServerHash ||
            serverBoundDeviceHash(req, activationDeviceToken),
          activationIp: req.ip || (foundCode as any).activationIp || "",
        } as any);

        const updatedStudent = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || student;
        if (!updatedStudent) {
          return res
            .status(404)
            .json(activationFailurePayload("STUDENT_NOT_FOUND", "الطالب غير موجود. راجع أستاذ المقرر قبل إعادة التفعيل."));
        }
        const sameDeviceActivatedCodes = activatedCourseCodesForStudent(updatedStudent, resolvedCourseCode);
        const sameDeviceEnrollments = getStudentEnrollmentDetails(updatedStudent).map((entry: any) =>
          entry.isOpen !== false &&
          entry.isSuspended !== true &&
          sameDeviceActivatedCodes.some((code: any) =>
            sectionCodeEquivalent(code, entry.courseCode || entry.sectionCode),
          )
            ? {
                ...entry,
                status: "active",
                isActive: true,
                isLocked: false,
                isOpen: true,
                isClosedByTeacher: false,
                isSuspended: false,
              }
            : entry,
        );
        return res.json(
          buildStudentActivationSuccessPayload(
            req,
            res,
            {
              ...updatedStudent,
              sectionCode: String(updatedStudent?.sectionCode || "").trim() || resolvedCourseCode,
              studentSection: String((updatedStudent as any)?.studentSection || "").trim() || resolvedCourseCode,
              activatedCourseCodes: sameDeviceActivatedCodes,
            },
            resolvedCourseCode,
            sameDeviceEnrollments,
            "تم اعتماد الرمز البديل بنجاح.",
          ),
        );
      }

      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student: student || ({ id: normStudentId } as any),
        reason: "محاولة استخدام الرمز البديل من جهاز غير معتمد",
        foundCode,
      });
      return res.status(409).json({
        ...activationFailurePayload(
          "CODE_USED_ON_ANOTHER_DEVICE",
          "الكود مستخدم ومربوط بجهاز الطالب المعتمد. إذا كنت تستخدم جهازًا جديدًا فاطلب من الأستاذ تبديل الجهاز أولًا.",
        ),
      });
    }

    const transferApprovedForThisStudent =
      sameStudentOwnsCode &&
      deviceBindingCleared &&
      student &&
      !(student as any).isAccessBlocked;

    if (transferApprovedForThisStudent) {
      const retiredTokens: string[] = Array.isArray((student as any).retiredDeviceTokens)
        ? (student as any).retiredDeviceTokens
        : [];
      const retiredFingerprints: string[] = Array.isArray((student as any).retiredDeviceFingerprints)
        ? (student as any).retiredDeviceFingerprints
        : [];
      const isRetiredOldDevice = isRetiredStudentDeviceSurface({
        currentDeviceToken: activationDeviceToken,
        currentFingerprint: activationFingerprint,
        retiredDeviceTokens: retiredTokens,
        retiredDeviceFingerprints: retiredFingerprints,
      });

      if (isRetiredOldDevice && !isExplicitStudentDeviceTransferClaimRequest(req)) {
        recordActivationAttempt(req, {
          code: joinCodeRaw,
          student,
          reason: "محاولة دخول من الجهاز القديم بعد اعتماد نقل الحساب لجهاز جديد",
          foundCode,
        });
        return res.status(409).json({
          ...activationFailurePayload(
            "OLD_DEVICE_RETIRED",
            "حسابك في وضع النقل لجهاز جديد. سجّل الدخول من جهازك الجديد لإكمال النقل.",
          ),
        });
      }

      const transferCourseName = courseNameFromCode(resolvedCourseCode);
      dbInstance.updateJoinCode(foundCode.code, {
        activationDeviceToken,
        activationDeviceFingerprint: activationFingerprint,
        activationDeviceServerHash: serverBoundDeviceHash(req, activationDeviceToken),
        studentSection: resolvedCourseCode || (foundCode as any).studentSection || (foundCode as any).sectionCode,
        sectionCode: resolvedCourseCode || (foundCode as any).sectionCode || (foundCode as any).studentSection,
        courseCode: resolvedCourseCode || (foundCode as any).courseCode || (foundCode as any).sectionCode,
        resolvedCourseCode,
        resolvedCourseName: transferCourseName,
        courseName: transferCourseName,
        sectionName: transferCourseName,
        activationIp: req.ip || (foundCode as any).activationIp || "",
      } as any);

      dbInstance.updateStudent(student.id, {
        isPaid: true,
        isActivated: true,
        activationCode: foundCode.code,
        ...buildStudentActivationPersistencePatch(student, resolvedCourseCode || student.sectionCode),
        devices: [activationFingerprint],
        accessResetAt: new Date().toISOString(),
        deviceSessionInvalidatedAt: new Date().toISOString(),
        isAccessBlocked: false,
        accessBlockReason: "",
        pendingDeviceTransfer: false,
        retiredDeviceFingerprints: [],
        retiredDeviceTokens: [],
        lastLoginDate: new Date().toISOString(),
      } as any);

      const transferredStudent = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || student;
      const transferredEnrollments = getStudentEnrollmentDetails(transferredStudent);
      return res.json(
        buildStudentActivationSuccessPayload(
          req,
          res,
          transferredStudent,
          resolvedCourseCode,
          transferredEnrollments,
          "تم اعتماد جهازك الجديد بنجاح. أهلاً بك مجدداً في مسارك.",
        ),
      );
    }

    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || ({ id: normStudentId } as any),
      reason: "محاولة إعادة استخدام كود مقفل",
      foundCode,
    });
    return res
      .status(409)
      .json(activationFailurePayload("CODE_USED", "الكود مستخدم بالفعل. اطلب كودًا جديدًا من أستاذ المقرر."));
  }

  // 5. Prepare student changes without persisting them. The code is consumed first;
  // only then do we write the student/session state, so failures never leave a
  // half-activated account behind.
  let isNew = false;
  let pendingNewStudent: Student | null = null;
  let pendingStudentPatch: any = null;
  let activationStudent: any = student;
  const activationNow = new Date().toISOString();
  if (!student) {
    isNew = true;
    const finalEmail = normalizeArabicDigits(
      registrationParams?.email || `${normStudentId}@paaet.edu.kw`
    ).trim().toLowerCase();

    // Verify unique email among OTHER students
    const emailExists = dbInstance.getStudents().find(
      (s: any) =>
        String(s.email || "").trim().toLowerCase() === finalEmail &&
        normalizeStudentId(s.id) !== normStudentId
    );
    if (emailExists) {
      return res.status(400).json({
        ...activationFailurePayload(
          "STUDENT_EMAIL_IN_USE",
          "هذا البريد الإلكتروني مستخدم في حساب طالب آخر. لا يمكن تكرار البريد بين أكثر من طالب.",
        ),
      });
    }

    if (isWeakDefaultPassword(registrationParams?.password)) {
      return res.status(400).json({
        ...activationFailurePayload(
          "WEAK_PASSWORD",
          "اختر كلمة مرور قوية لا تقل عن 6 خانات ولا تستخدم كلمة المرور الافتراضية.",
        ),
      });
    }

    const newStudent: Student = {
      id: normStudentId,
      name: rosterMatch.name || registrationParams?.name || allowed.name || normStudentId,
      email: finalEmail,
      sectionCode: resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode,
      studentSection: resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode,
      semester: registrationParams?.semester || "الفصل الأول 2026",
      passwordHash: hashPasswordSecure(String(registrationParams?.password || "")),
      isPaid: true,
      activationCode: foundCode.code,
      activatedCourseCodes: [resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode].filter(Boolean),
      enrollments: mergePersistentStudentEnrollment(
        { enrollments: [], sectionCode: resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode },
        resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode,
      ),
      isActivated: true,
      devices: [activationFingerprint],
      progress: 0,
      score: 0,
      strengths: [],
      weaknesses: [],
      recommendations: ["يرجى إكمال بصمة التعلم لبدء مسارك الشخصي الأكاديمي."],
      signupDate: activationNow,
      lastLoginDate: activationNow,
    } as any;
    pendingNewStudent = newStudent;
    activationStudent = newStudent;
  } else if (student) {
    pendingStudentPatch = {
      isPaid: true,
      isActivated: true,
      activationCode: foundCode.code,
      ...buildStudentActivationPersistencePatch(student, resolvedCourseCode || student.sectionCode),
      sectionCode: String(student.sectionCode || "").trim() ? student.sectionCode : resolvedCourseCode,
      studentSection: String((student as any).studentSection || "").trim() ? (student as any).studentSection : resolvedCourseCode,
      devices: [activationFingerprint],
      lastLoginDate: activationNow,
    } as any;
    activationStudent = { ...student, ...pendingStudentPatch };
  }

  // 6. Bind the Join Code to student permanently — ذرّي: لا يستهلك الكود إلا إذا كان active الآن.
  const resolvedCourseName = courseNameFromCode(resolvedCourseCode);
  const activationPatch = {
    status: "used",
    studentId: activationStudent.id,
    usedByStudentId: activationStudent.id,
    studentName: activationStudent.name,
    studentSection: resolvedCourseCode || activationStudent.sectionCode,
    sectionCode: resolvedCourseCode || (foundCode as any).sectionCode || activationStudent.sectionCode,
    courseCode: resolvedCourseCode || (foundCode as any).courseCode || activationStudent.sectionCode,
    resolvedCourseCode,
    resolvedCourseName,
    courseName: resolvedCourseName,
    sectionName: resolvedCourseName,
    activatedAt: activationNow,
    activationDeviceFingerprint: activationFingerprint,
    activationDeviceToken,
    activationDeviceServerHash: serverBoundDeviceHash(req, activationDeviceToken),
    activationIp: req.ip || "",
    watermark: codeWatermark(activationStudent.id, foundCode.code),
    ...markJoinCodeActivated(foundCode, req, activationStudent, {
      sectionCode: resolvedCourseCode || activationStudent.sectionCode,
      courseName: resolvedCourseName,
    }),
  } as any;
  // إعادة توقيع الكود بعد حسم مقرره الفعلي: الرموز العامة للبيع تُنشأ بقسم "all"
  // ثم يُربط مقررها لحظة التفعيل باسم الطالب ومقرره. لو بقي التوقيع محسوباً على
  // "all" لفشل التحقق (verifyJoinCodeSignature) عند أي دخول لاحق بنفس الكود مثل
  // فك/نقل الجهاز. لغير الرموز العامة يُنتج هذا نفس التوقيع تماماً (بلا أثر).
  const resignedSignature = signJoinCodeRecord({
    code: foundCode.code,
    ownerEmail:
      (foundCode as any).ownerEmail ||
      (foundCode as any).createdByEmail ||
      codeOwner,
    sectionCode: (activationPatch as any).sectionCode,
    createdAt: (foundCode as any).createdAt,
  });
  if (resignedSignature) {
    (activationPatch as any).codeSignature = resignedSignature;
    (activationPatch as any).codeSignatureVersion = "hmac-sha256-v1";
    (activationPatch as any).codeSignatureCreatedAt =
      (foundCode as any).codeSignatureCreatedAt ||
      (foundCode as any).createdAt ||
      activationNow;
  }
  // لقطة لحالة الكود قبل استهلاكه — تُستخدم للتراجع الآمن إذا استُهلك الكود
  // ثم فشل حفظ حساب الطالب، حتى لا يبقى الكود "مستخدماً" بلا حساب فيتعذّر
  // على الطالب إعادة المحاولة بنفس الكود الصحيح.
  const joinCodeStateBeforeUse = { ...(foundCode as any) };
  const consumed = (dbInstance as any).compareAndUseJoinCode
    ? (dbInstance as any).compareAndUseJoinCode(foundCode.code, activationPatch)
    : { ok: false, reason: "unsupported" };
  if (!consumed.ok) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: activationStudent,
      foundCode,
      reason: "محاولة تفعيل متزامنة لكود استُهلك بالفعل",
    });
    return res
      .status(409)
      .json(activationFailurePayload("CODE_USED", "الكود مستخدم بالفعل. اطلب كودًا جديدًا من أستاذ المقرر."));
  }

  try {
    if (pendingNewStudent) {
      dbInstance.addStudent(pendingNewStudent);
      student = pendingNewStudent;
    } else if (student && pendingStudentPatch) {
      dbInstance.updateStudent(student.id, pendingStudentPatch);
      student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || activationStudent;
    }
  } catch (err: any) {
    if (pendingNewStudent && String(err?.message || err) === "DUPLICATE_STUDENT_ID") {
      student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId);
      if (student) {
        isNew = false;
        pendingStudentPatch = {
          isPaid: true,
          isActivated: true,
          activationCode: foundCode.code,
          ...buildStudentActivationPersistencePatch(student, resolvedCourseCode || student.sectionCode),
          sectionCode: String(student.sectionCode || "").trim() ? student.sectionCode : resolvedCourseCode,
          studentSection: String((student as any).studentSection || "").trim() ? (student as any).studentSection : resolvedCourseCode,
          devices: [activationFingerprint],
          lastLoginDate: activationNow,
        } as any;
        dbInstance.updateStudent(student.id, pendingStudentPatch);
        student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || { ...student, ...pendingStudentPatch };
      }
    }
    if (!student) {
      // تراجع آمن: الكود استُهلك لكن حساب الطالب لم يُحفظ. نُعيد الكود إلى حالته
      // السابقة (active) ونمسح ربط الجهاز/الطالب الذي أضافه التفعيل الفاشل، حتى
      // يبقى الكود قابلاً لإعادة المحاولة بدل أن يعلق "مستخدماً". محاط بـ try حتى
      // لا يُفشِل التراجعُ الردَّ نفسه إطلاقاً.
      try {
        dbInstance.updateJoinCode(foundCode.code, {
          ...joinCodeStateBeforeUse,
          status: String((joinCodeStateBeforeUse as any).status || "active"),
          studentId: (joinCodeStateBeforeUse as any).studentId ?? "",
          usedByStudentId: (joinCodeStateBeforeUse as any).usedByStudentId ?? "",
          studentName: (joinCodeStateBeforeUse as any).studentName ?? "",
          activatedAt: (joinCodeStateBeforeUse as any).activatedAt ?? "",
          activationDeviceToken: (joinCodeStateBeforeUse as any).activationDeviceToken ?? "",
          activationDeviceFingerprint: (joinCodeStateBeforeUse as any).activationDeviceFingerprint ?? "",
          activationDeviceServerHash: (joinCodeStateBeforeUse as any).activationDeviceServerHash ?? "",
          activationIp: (joinCodeStateBeforeUse as any).activationIp ?? "",
        } as any);
      } catch {}
      return res
        .status(500)
        .json(activationFailurePayload("ACTIVATION_COMMIT_FAILED", "تعذّر حفظ حساب الطالب ولم يُستهلك الكود. أعد المحاولة، وإن تكرّر فراجع أستاذ المقرر."));
    }
  }

  // 7. Activity Log and Notifications
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: isNew ? "تسجيل حساب" : "تفعيل مقرر إضافي",
    details: isNew
      ? `تم إنشاء حساب جديد بنجاح وتفعيله عبر رمز الانضمام ${foundCode.code} لمقرر ${courseNameFromCode(resolvedCourseCode)}`
      : `تم تفعيل مقرر إضافي ${courseNameFromCode(resolvedCourseCode)} بكود ${foundCode.code} بنجاح.`,
    teacherEmail: courseOwner,
    actorEmail: courseOwner,
    sectionCode: resolvedCourseCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: isNew ? "تسجيل جديد" : "تفعيل مقرر",
    browser: "متصفح الويب",
    isViolationWarning: false,
  });

  notifyTeachersForSection(
    resolvedCourseCode,
    isNew ? "تسجيل طالب جديد" : "تفعيل مقرر إضافي",
    `${student.name} فعّل مقرر ${courseNameFromCode(resolvedCourseCode)} بالكود`,
    {
      type: isNew ? "student_registered" : "course_activated",
      studentId: student.id,
      courseCode: resolvedCourseCode,
      link: "/",
    },
  );

  const finalStudent = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || student;
  const finalActivatedCodes = activatedCourseCodesForStudent(finalStudent, resolvedCourseCode);
  const finalEnrollments = getStudentEnrollmentDetails(finalStudent).map((entry: any) =>
    // لا نتجاوز قرار المعلم: المقرر المُغلق/المعلّق يبقى على حالته الحقيقية حتى
    // عند لحظة التفعيل. المقرر المفتوح المُفعّل يظهر نشطاً فوراً.
    entry.isOpen !== false &&
    entry.isSuspended !== true &&
    finalActivatedCodes.some((code: any) => sectionCodeEquivalent(code, entry.courseCode || entry.sectionCode))
      ? {
          ...entry,
          status: "active",
          isActive: true,
          isLocked: false,
          isOpen: true,
          isClosedByTeacher: false,
          isSuspended: false,
        }
      : entry,
  );

  return res.json(
    buildStudentActivationSuccessPayload(
      req,
      res,
      {
        ...finalStudent,
        sectionCode: String(finalStudent?.sectionCode || "").trim() || resolvedCourseCode,
        studentSection: String((finalStudent as any)?.studentSection || "").trim() || resolvedCourseCode,
        activatedCourseCodes: finalActivatedCodes,
      },
      resolvedCourseCode,
      finalEnrollments,
      isNew ? "تهانينا! تم تفعيل حسابك وربط المقرر بنجاح." : "تم ربط المقرر بنجاح فوراً.",
    ),
  );
}

app.post("/api/students/join-lab", (req, res) => {
  const studentId = normalizeArabicDigits(String(req.body.studentId || req.body.idNumber || "")).trim();
  const joinCode = normalizeArabicDigits(String(req.body.joinCode || req.body.code || "")).trim();
  if (!studentId || !joinCode) {
    return res.status(400).json({ error: "الرجاء إدخال الرقم الجامعي ورمز الانضمام" });
  }
  return processStudentCourseActivation(req, res, studentId, joinCode);
});


function teacherCanHandleDeviceApproval(request: any, teacherEmail: string) {
  const email = String(teacherEmail || "").toLowerCase();
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const sectionCode = request?.targetSectionCode || request?.sectionCode || "";
  return (
    String(request?.targetTeacherEmail || "").toLowerCase() === email ||
    sectionOwnerEmail(sectionCode).toLowerCase() === email ||
    teacherOwnsCourseCode(sectionCode, email)
  );
}

function findDeviceApprovalRequest(requestId: any) {
  const id = String(requestId || "").trim();
  if (!id) return null;
  return dbInstance.getActivationAttempts().find((attempt: any) =>
    String(attempt.id || "") === id &&
    String(attempt.approvalRequestType || "") === "second_hand_device"
  ) || null;
}

app.post("/api/teacher/device-approval/:id/approve", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const request = findDeviceApprovalRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "لم يتم العثور على طلب اعتماد الجهاز." });
  if (!teacherCanHandleDeviceApproval(request, teacherEmail)) return res.status(403).json({ error: "لا تملك صلاحية اعتماد هذا الجهاز." });
  if (String(request.approvalStatus || "") !== "pending") {
    return res.status(409).json({ error: "تمت معالجة هذا الطلب سابقًا." });
  }

  const targetStudentId = normalizeStudentId(request.targetStudentId || request.studentId || "");
  const targetJoinCode = normalizeJoinCode(request.targetJoinCode || request.code || "");
  const sectionCode = String(request.targetSectionCode || request.sectionCode || "").trim();
  const deviceToken = String(request.deviceToken || "").trim();
  const deviceFingerprint = String(request.deviceFingerprint || "").trim();
  if (!targetStudentId || !targetJoinCode || !sectionCode || !deviceToken || !deviceFingerprint) {
    return res.status(400).json({ error: "بيانات طلب اعتماد الجهاز غير مكتملة." });
  }

  const joinCode = dbInstance.getJoinCodes().find((jc: any) =>
    normalizeJoinCode(jc.code) === targetJoinCode || compactJoinCode(jc.code) === compactJoinCode(targetJoinCode)
  );
  if (!joinCode || String(joinCode.status || "") === "revoked") {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: new Date().toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "الكود غير موجود أو ملغى وقت الاعتماد.",
    } as any);
    return res.status(409).json({ error: "تعذر الاعتماد لأن كود الانضمام غير متاح الآن." });
  }
  if (isSoftDeletedRecord(joinCode) || isArchivedJoinCodeRecord(joinCode)) {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: new Date().toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "الكود مؤرشف أو محذوف وقت الاعتماد.",
    } as any);
    return res.status(410).json({ error: "هذا الكود مؤرشف أو محذوف. اطلب كودًا جديدًا." });
  }
  const codeOwner = joinCodeOwnerEmail(joinCode);
  if (joinCodeIsConsumedRecord(joinCode) && !consumedJoinCodeMatchesCourse(joinCode, sectionCode, codeOwner)) {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: new Date().toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "محاولة اعتماد كود مستخدم لمقرر مختلف.",
    } as any);
    return res.status(409).json({ error: "هذا الكود مستخدم ومقفل على مقرر آخر. استخدم كود المقرر الصحيح." });
  }
  const currentOwner = normalizeStudentId((joinCode as any).studentId || (joinCode as any).usedByStudentId || "");
  if (String(joinCode.status || "") === "used" && currentOwner && currentOwner !== targetStudentId) {
    return res.status(409).json({ error: "لا يمكن اعتماد الجهاز لأن الكود أصبح مستخدمًا لطالب آخر." });
  }

  const conflict = activeSecondHandDeviceConflict({
    deviceToken,
    deviceFingerprint,
    studentId: targetStudentId,
    sectionCode,
    currentRequestId: request.id,
  });
  if (conflict.conflict && String(req.body?.force || "") !== "1") {
    dbInstance.updateActivationAttempt(request.id, {
      activeConflict: true,
      activeConflictReason: conflict.reason,
      deviceApprovalRecommendation: "يحتاج مراجعة قبل الاعتماد",
    } as any);
    return res.status(409).json({ error: conflict.reason });
  }

  const allowedRowsForStudent = dbInstance.getAllowedStudents().filter((row: any) =>
    normalizeStudentId(row.idNumber || row.id || row.studentId) === targetStudentId
  );
  const rosterMatch = allowedRowsForStudent.find((row: any) =>
    allowedStudentMatchesCourse(row, targetStudentId, sectionCode, codeOwner)
  ) || allowedRowsForStudent.find((row: any) => sectionCodeEquivalent(row.sectionCode || row.studentSection || row.courseCode, sectionCode));
  if (!rosterMatch) {
    return res.status(403).json({ error: "لا يمكن اعتماد الجهاز لأن الطالب غير موجود في كشف هذا المقرر." });
  }

  let student = dbInstance.getStudents().find((s: any) => normalizeStudentId(s.id) === targetStudentId);
  if (student && joinCodeIsStaleForStudentCourse(joinCode, student, sectionCode, codeOwner)) {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: new Date().toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "الكود تابع لدورة قديمة بعد حذف الطالب من المقرر.",
    } as any);
    return res.status(409).json({ error: "هذا الكود تابع لدورة قديمة بعد حذف الطالب من المقرر. اطلب كودًا جديدًا." });
  }
  const now = new Date().toISOString();
  if (!student) {
    const email = String(request.targetStudentEmail || `${targetStudentId}@paaet.edu.kw`).trim().toLowerCase();
    const newStudent: Student = {
      id: targetStudentId,
      name: request.targetStudentName || rosterMatch.name || targetStudentId,
      email,
      sectionCode,
      studentSection: sectionCode,
      semester: (rosterMatch as any).semester || "الفصل الأول 2026",
      passwordHash: hashPasswordSecure(crypto.randomBytes(9).toString("base64url")),
      isPaid: true,
      isActivated: true,
      activationCode: joinCode.code,
      activatedCourseCodes: [sectionCode],
      enrollments: mergePersistentStudentEnrollment({ enrollments: [], sectionCode }, sectionCode, "second_hand_device_approval"),
      devices: [deviceFingerprint],
      accessResetAt: now,
      deviceSessionInvalidatedAt: now,
      progress: 0,
      score: 0,
      strengths: [],
      weaknesses: [],
      recommendations: ["يرجى إكمال بصمة التعلم لبدء مسارك الشخصي الأكاديمي."],
      signupDate: now,
      lastLoginDate: now,
    } as any;
    dbInstance.addStudent(newStudent);
    student = newStudent;
  } else {
    dbInstance.updateStudent(student.id, {
      isPaid: true,
      isActivated: true,
      activationCode: joinCode.code,
      ...buildStudentActivationPersistencePatch(student, sectionCode),
      sectionCode: String(student.sectionCode || "").trim() ? student.sectionCode : sectionCode,
      studentSection: String((student as any).studentSection || "").trim() ? (student as any).studentSection : sectionCode,
      devices: [deviceFingerprint],
      accessResetAt: now,
      deviceSessionInvalidatedAt: now,
      lastLoginDate: now,
      secondHandDeviceApprovedAt: now,
      secondHandDeviceApprovedBy: teacherEmail,
    } as any);
    student = dbInstance.getStudents().find((s: any) => normalizeStudentId(s.id) === targetStudentId) || student;
  }

  releaseDeviceFromPreviousOwners({
    deviceToken,
    deviceFingerprint,
    newStudentId: targetStudentId,
    requestId: request.id,
    actorEmail: teacherEmail,
  });

  const approvedCourseName = courseNameFromCode(sectionCode);
  dbInstance.updateJoinCode(joinCode.code, {
    status: "used",
    studentId: targetStudentId,
    usedByStudentId: targetStudentId,
    studentName: student.name || request.targetStudentName || rosterMatch.name || targetStudentId,
    studentSection: sectionCode,
    sectionCode,
    courseCode: sectionCode,
    resolvedCourseCode: sectionCode,
    resolvedCourseName: approvedCourseName,
    courseName: approvedCourseName,
    sectionName: approvedCourseName,
    activatedAt: now,
    activationDeviceFingerprint: deviceFingerprint,
    activationDeviceToken: deviceToken,
    activationDeviceServerHash: serverBoundDeviceHash(req, deviceToken),
    activationIp: request.ip || "",
    watermark: codeWatermark(targetStudentId, joinCode.code),
    secondHandDeviceApprovedAt: now,
    secondHandDeviceApprovedBy: teacherEmail,
    secondHandDeviceApprovalRequestId: request.id,
  } as any);

  dbInstance.updateActivationAttempt(request.id, {
    approvalStatus: "approved",
    approvalResolvedAt: now,
    approvalResolvedBy: teacherEmail,
    activeConflict: false,
    activeConflictReason: conflict.reason,
    deviceApprovalRecommendation: "تم اعتماد الجهاز",
  } as any);

  dbInstance.addActivityLog({
    studentId: targetStudentId,
    studentName: student.name || request.targetStudentName || targetStudentId,
    action: "اعتماد جهاز مستخدم سابقًا",
    details: `تم اعتماد الجهاز المستخدم سابقًا للطالب ${student.name || targetStudentId} في مقرر ${courseNameFromCode(sectionCode)} دون حذف تاريخ الطالب السابق.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "اعتماد جهاز",
    browser: "متصفح الويب",
    isViolationWarning: false,
  });

  return res.json({ success: true, message: "تم اعتماد الجهاز وربط المقرر بالطالب بنجاح." });
});

app.post("/api/teacher/device-approval/:id/reject", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const request = findDeviceApprovalRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "لم يتم العثور على طلب اعتماد الجهاز." });
  if (!teacherCanHandleDeviceApproval(request, teacherEmail)) return res.status(403).json({ error: "لا تملك صلاحية رفض هذا الطلب." });
  if (String(request.approvalStatus || "") !== "pending") {
    return res.status(409).json({ error: "تمت معالجة هذا الطلب سابقًا." });
  }
  const now = new Date().toISOString();
  dbInstance.updateActivationAttempt(request.id, {
    approvalStatus: "rejected",
    approvalResolvedAt: now,
    approvalResolvedBy: teacherEmail,
    deviceApprovalRecommendation: "تم رفض الطلب",
  } as any);
  dbInstance.addActivityLog({
    studentId: request.targetStudentId || request.studentId,
    studentName: request.targetStudentName || request.studentName,
    action: "رفض اعتماد جهاز مستخدم سابقًا",
    details: `تم رفض طلب اعتماد الجهاز المستخدم سابقًا في مقرر ${courseNameFromCode(request.targetSectionCode || request.sectionCode)}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: request.targetSectionCode || request.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "اعتماد جهاز",
    browser: "متصفح الويب",
    isViolationWarning: false,
  });
  return res.json({ success: true, message: "تم رفض طلب اعتماد الجهاز." });
});

app.get("/api/teacher/join-codes", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const includeAll =
    String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
  const includeRetired = String(req.query.includeRetired || "") === "1";
  const retired =
    includeRetired && typeof (dbInstance as any).getRetiredJoinCodes === "function"
      ? (dbInstance as any).getRetiredJoinCodes().map((item: any) => ({
          ...item,
          isArchived: true,
        }))
      : [];
  const recentlyIssuedCodeVisible = (jc: any) => {
    const created = Date.parse(String(jc?.createdAt || jc?.issuedAt || "")) || 0;
    return created > 0 && Date.now() - created < 10 * 60 * 1000;
  };
  const sourceCodes = [
    ...dbInstance.getJoinCodes().filter((jc: any) =>
      isOperationalJoinCodeRecord(jc) ||
      (isUsableJoinCodeRecord(jc) && recentlyIssuedCodeVisible(jc)),
    ),
    ...retired.filter((item: any) => isArchivedJoinCodeRecord(item)),
  ];
  const joinCodes = sourceCodes
    .filter((jc: any) => String(jc?.code || "").trim())
    .filter((jc: any) => includeAll || canAccessJoinCode(jc, teacherEmail))
    .map((jc: any) => {
      const storedCourseCode = String(
        jc.sectionCode || jc.courseCode || jc.studentSection || "",
      ).trim();
      const resolvedCourse = resolveJoinCodeCourseForDisplay(jc);
      const courseCode = String(resolvedCourse.courseCode || storedCourseCode).trim();
      const storedName = String(jc.courseName || jc.resolvedCourseName || jc.activatedCourseName || "").trim();
      const courseName =
        resolvedCourse.courseName ||
        (isUsefulCourseNameForDisplay(storedName, courseCode) ? storedName : "") ||
        (isGenericJoinCourseCode(courseCode) ? "" : courseNameFromCode(courseCode));
      return {
        ...jc,
        sectionCode: courseCode || jc.sectionCode,
        courseCode: courseCode || jc.courseCode,
        studentSection: courseCode || jc.studentSection,
        resolvedCourseCode: resolvedCourse.courseCode || (isGenericJoinCourseCode(courseCode) ? "" : courseCode),
        resolvedCourseName: resolvedCourse.courseName || "",
        courseName: isUsefulCourseNameForDisplay(courseName, courseCode)
          ? courseName
          : isGenericJoinCourseCode(courseCode)
            ? "رمز عام — يُربط عند التفعيل"
            : courseNameFromCode(courseCode),
      };
    });
  return res.json({ joinCodes });
});

app.post("/api/teacher/join-codes/create", (req, res) => {
  const { count, semester, sectionCode, assignedStudentId, isFreeCode } =
    req.body;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res
      .status(401)
      .json({ error: "جلسة الأستاذ غير واضحة. سجّل الخروج ثم ادخل من جديد." });
  const numCount = Math.max(1, Math.min(Number(count) || 10, 2000));
  const targetSemester = semester || "الفصل الدراسي الثاني 2026";
  // رموز عامة للبيع (سوبر أدمن فقط): دفعة رموز مستقلة لا ترتبط بمقرر محدد ولا
  // بطالب ولا بعدد طلبة أي كشف. تُولَّد بالعدد المطلوب تماماً، تُحفظ في الأرشيف،
  // وتُطبع/تُصدَّر للبيع. وعند تفعيل الطالب لها تُربط تلقائياً باسمه ومقرره
  // وتاريخ تفعيله (انظر resolveActivationCourseForStudent للرموز العامة "all").
  const generalSale =
    (req.body?.generalSale === true ||
      String(req.body?.generalSale || "") === "1") &&
    isAdminEmail(teacherEmail) &&
    !assignedStudentId &&
    !isFreeCode;
  let targetSection: string;
  let ownerEmail: string;
  if (generalSale) {
    targetSection = "all";
    ownerEmail = String(teacherEmail).toLowerCase();
  } else {
    const target = resolveJoinCodeCreationTarget(sectionCode, teacherEmail);
    if (target.error) return res.status(400).json({ error: target.error });
    targetSection = target.code;
    ownerEmail = String(target.ownerEmail || teacherEmail).toLowerCase();
  }
  const existingCodes = () => issuedJoinCodeCompacts();
  const makeUniqueCode = () => makeJoinCode("LAB", "", existingCodes());
  const assignToRoster =
    !generalSale &&
    (req.body?.assignToRoster === true ||
      String(req.body?.assignToRoster || "") === "1");

  let assignedName = String(req.body.assignedStudentName || "").trim();
  const assignedId = normalizeStudentId(assignedStudentId);
  if (isFreeCode || assignedId) {
    if (!/^\d{4,}$/.test(assignedId))
      return res
        .status(400)
        .json({ error: "الرقم الجامعي مطلوب للرمز المجاني الخاص." });
    const registeredAny = dbInstance
      .getStudents()
      .find((s: any) => normalizeStudentId(s.id) === assignedId);
    const allowed = dbInstance
      .getAllowedStudents()
      .find((s: any) =>
        allowedStudentMatchesCourse(s, assignedId, targetSection, ownerEmail),
      );
    const registered =
      registeredAny &&
      (allowed ||
        getStudentDiscoveredCourseCodes(registeredAny).some((course: any) =>
          courseCodeMatchesForTeacher(course, targetSection, ownerEmail),
        ))
        ? registeredAny
        : null;
    assignedName = registered?.name || allowed?.name || "";
    if (!assignedName)
      return res
        .status(400)
        .json({
          error:
            "لا يمكن إصدار رمز خاص: الرقم الجامعي غير موجود في كشف هذا المقرر.",
        });
    const existingFree = dbInstance
      .getJoinCodes()
      .find(
        (j: any) =>
          String(j.assignedStudentId || j.studentId || "") === assignedId &&
          String(j.status || "") === "active" &&
          joinCodeOwnerEmail(j) === ownerEmail &&
          courseCodeMatchesForTeacher(
            j.sectionCode || j.studentSection || j.courseCode,
            targetSection,
            ownerEmail,
          ),
      );
    if (existingFree)
      return res
        .status(409)
        .json({
          error: "يوجد رمز فعال لهذا الطالب في هذا المقرر بالفعل.",
          existingCode: existingFree.code,
        });
  }
  const rosterAssignments =
    assignToRoster && !assignedId
      ? Array.from(
          dbInstance
            .getAllowedStudents()
            .filter((row: any) => {
              const sid = normalizeStudentId(
                row?.idNumber || row?.id || row?.studentId,
              );
              return (
                sid &&
                allowedStudentMatchesCourse(row, sid, targetSection, ownerEmail)
              );
            })
            .reduce((map: Map<string, any>, row: any) => {
              const sid = normalizeStudentId(
                row?.idNumber || row?.id || row?.studentId,
              );
              if (!map.has(sid)) map.set(sid, row);
              return map;
            }, new Map<string, any>())
            .values(),
        )
          .map((row: any) => ({
            id: normalizeStudentId(row?.idNumber || row?.id || row?.studentId),
            name: String(row?.name || "").trim(),
          }))
          .filter((row: any) => {
            if (!row.id) return false;
            const hasActiveCode = dbInstance.getJoinCodes().some((jc: any) => {
              const linked = normalizeStudentId(
                jc.assignedStudentId || jc.studentId || jc.usedByStudentId,
              );
              return (
                linked === row.id &&
                String(jc.status || "active").toLowerCase() === "active" &&
                joinCodeOwnerEmail(jc) === ownerEmail &&
                courseCodeMatchesForTeacher(
                  jc.sectionCode || jc.studentSection || jc.courseCode,
                  targetSection,
                  ownerEmail,
                )
              );
            });
            return !hasActiveCode;
          })
      : [];
  if (assignToRoster && !assignedId && !rosterAssignments.length) {
    return res.status(400).json({
      error:
        "لا يوجد طلاب في كشف هذا المقرر يحتاجون رموزاً جديدة. ارفع الكشف أو اختر طالباً محدداً.",
    });
  }

  const created: JoinCode[] = [];
  const finalCount =
    assignToRoster && !assignedId
      ? Math.min(numCount, rosterAssignments.length)
      : numCount;
  for (let i = 0; i < finalCount; i++) {
    let newCode = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = makeUniqueCode();
      if (isFullMirasJoinCode(candidate)) {
        newCode = normalizeJoinCode(candidate);
        break;
      }
    }
    if (!newCode) {
      return res.status(500).json({
        error: "تعذر توليد كود مكتمل وآمن. أعد المحاولة.",
      });
    }
    const batchId = `Batch-${new Date().toISOString().slice(0, 10)}-${targetSection}-${ownerEmail}`;
    const createdAt = new Date().toISOString();
    const rosterAssignment = !assignedId ? rosterAssignments[i] : null;
    const codeAssignedId = assignedId || rosterAssignment?.id || "";
    const codeAssignedName = assignedName || rosterAssignment?.name || "";
    const newJc: JoinCode = {
      code: newCode,
      semester: targetSemester,
      sectionCode: targetSection,
      courseCode: targetSection,
      studentSection: targetSection,
      courseName: courseNameFromCode(targetSection),
      status: "active",
      createdAt,
      ownerEmail,
      createdByEmail: teacherEmail,
      strictLibraryMode: STRICT_LIBRARY_MODE_DEFAULT,
      batchId,
      batchLabel: batchId,
      codeReputation: "normal",
      codeReputationLabel: CODE_REPUTATION_LABELS.normal,
      codeReputationScore: 0,
      codeJourney: createCodeJourneyEvent("تم إنشاء الكود", teacherEmail, {
        createdAt,
        teacherEmail,
        ownerEmail,
        sectionCode: targetSection,
        batchId,
        studentId: codeAssignedId || undefined,
      }),
      ...(codeAssignedId
        ? {
            assignedStudentId: codeAssignedId,
            assignedStudentName: codeAssignedName || codeAssignedId,
            isFreeCode: Boolean(assignedId || isFreeCode),
          }
        : {}),
    } as any;
    const signedJc = attachJoinCodeSignature(newJc) as JoinCode;
    dbInstance.addJoinCode(signedJc);
    created.push(signedJc);
  }

  dbInstance.addActivityLog({
    action: assignedId
      ? "توليد رمز مجاني خاص"
      : generalSale
        ? "توليد رموز عامة للبيع"
        : assignToRoster
          ? "توليد رموز شخصية من الكشف"
          : "توليد دفعة رموز",
    details: assignedId
      ? `تم إصدار رمز مجاني خاص للطالب ${assignedName} (${assignedId}) داخل حساب ${ownerEmail}`
      : generalSale
        ? `تم توليد (${created.length}) رمزاً عاماً للبيع غير مرتبط بمقرر، يُربط باسم الطالب ومقرره عند التفعيل.`
        : assignToRoster
          ? `تم إنشاء (${created.length}) رمزاً شخصياً من كشف المقرر داخل حساب ${ownerEmail}`
          : `تم إنشاء دفعة رموز جديدة عددها (${numCount}) للفصل الدراسي: ${targetSemester} داخل حساب ${ownerEmail}`,
    teacherEmail: ownerEmail,
    actorEmail: teacherEmail,
    sectionCode: targetSection,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "شريط الصلاحية",
    isViolationWarning: false,
  });

  return res.json({
    success: true,
    count: created.length,
    joinCodes: created,
    created,
  });
});

app.post("/api/teacher/join-codes/update", (req, res) => {
  const { code, status } = req.body;
  if (!code || !status) return res.status(400).json({ error: "معلومات ناقصة" });
  const teacherEmail = teacherEmailFromRequest(req);
  const found = dbInstance
    .getJoinCodes()
    .find((j: any) => compactJoinCode(j.code) === compactJoinCode(code));
  if (!found) return res.status(404).json({ error: "الرمز غير موجود." });
  if (!canAccessJoinCode(found, teacherEmail))
    return res.status(403).json({ error: "هذا الرمز تابع لحساب أستاذ آخر." });
  const normalizedStatus = String(status || "").toLowerCase();
  if (!["active", "revoked"].includes(normalizedStatus)) {
    return res.status(400).json({ error: "حالة الرمز غير معتمدة." });
  }
  if (String(found.status || "").toLowerCase() === "used") {
    return res
      .status(409)
      .json({
        error:
          "لا يمكن تغيير حالة كود مستخدم. استخدم إعادة الإصدار أو الحذف الإداري للحفاظ على السجل.",
      });
  }

  dbInstance.updateJoinCode(found.code, {
    status: normalizedStatus as any,
    updatedAt: new Date().toISOString(),
  } as any);
  return res.json({ success: true });
});

app.post("/api/teacher/join-codes/delete", (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "معلومات ناقصة" });
  const teacherEmail = teacherEmailFromRequest(req);
  const activeFound = dbInstance
    .getJoinCodes()
    .find((j: any) => compactJoinCode(j.code) === compactJoinCode(code));
  const retiredFound = !activeFound && typeof (dbInstance as any).getRetiredJoinCodes === "function"
    ? (dbInstance as any)
        .getRetiredJoinCodes()
        .find((j: any) => compactJoinCode(j.code) === compactJoinCode(code))
    : null;
  const found = activeFound || retiredFound;
  if (!found) return res.status(404).json({ error: "الرمز غير موجود." });
  if (!canAccessJoinCode(found, teacherEmail))
    return res.status(403).json({ error: "هذا الرمز تابع لحساب أستاذ آخر." });

  const wasActivated = Boolean(
    (found as any).activatedAt ||
      String(found.status || "").toLowerCase() === "used" ||
      (found as any).studentId ||
      (found as any).usedByStudentId,
  );
  const assignedOnlyStudentId = String((found as any).assignedStudentId || "").trim();
  const linkedStudentId = String(
    (found as any).studentId || (found as any).usedByStudentId || "",
  ).trim();
  let resetActivationStudentId: string | null = null;
  const deletedCourse = String(joinCodeCourse(found) || (found as any).sectionCode || "").trim();

  if (activeFound) {
    dbInstance.deleteJoinCode(
      found.code,
      found.isFreeCode ? "teacher_deleted_free_code" : "teacher_deleted_code",
      teacherEmail,
    );
  } else {
    deleteRetiredJoinCodeRecord(found.code);
  }

  if (wasActivated && linkedStudentId) {
    const linkedStudent = dbInstance
      .getStudents()
      .find(
        (st: any) =>
          String(st.id) === linkedStudentId ||
          normalizeStudentId(st.id) === normalizeStudentId(linkedStudentId),
      );
    if (linkedStudent && deletedCourse) {
      dbInstance.updateStudent(
        linkedStudent.id,
        buildStudentCourseActivationResetPatch(
          linkedStudent,
          deletedCourse,
          joinCodeOwnerEmail(found) || teacherEmail,
          [found],
        ) as any,
      );
      resetActivationStudentId = linkedStudent.id;
      notifyUsers(
        (token) =>
          token.role === "student" &&
          String(token.userId) === String(linkedStudent.id),
        "يلزم تفعيل المقرر",
        "تم حذف كود تفعيل سابق. سيظهر المقرر لديك بانتظار كود تفعيل جديد.",
        {
          type: "course_activation_required",
          studentId: linkedStudent.id,
          courseCode: deletedCourse,
          link: "/",
        },
      );
    }
  } else if (assignedOnlyStudentId) {
    notifyUsers(
      (token) =>
        token.role === "student" &&
        String(token.userId) === String(assignedOnlyStudentId),
      "تم إلغاء رمز دخول",
      "تم حذف رمز دخول كان مخصصاً لك قبل استخدامه. راجع أستاذ المقرر عند الحاجة.",
      {
        type: "assigned_code_deleted",
        studentId: assignedOnlyStudentId,
        courseCode: (found as any).sectionCode || "",
        link: "/",
      },
    );
  }
  dbInstance.addActivityLog({
    action: "حذف رمز دخول",
    details: `تم حذف الرمز ${found.code}${resetActivationStudentId ? ` وإرجاع مقرر الطالب (${resetActivationStudentId}) إلى حالة انتظار التفعيل دون حذف المقرر` : assignedOnlyStudentId ? ` وكان مخصصاً للطالب (${assignedOnlyStudentId}) قبل التفعيل دون قفل حسابه` : ""}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: (found as any).sectionCode || deletedCourse || "",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "إدارة الرموز",
    isViolationWarning: false,
  });
  return res.json({
    success: true,
    resetActivationStudentId,
    activationRequiredStudentId: resetActivationStudentId,
    lockedCourseStudentId: null,
    blockedStudentId: null,
  });
});

app.post("/api/teacher/join-codes/reissue", (req, res) => {
  const { oldCode } = req.body;
  if (!oldCode) return res.status(400).json({ error: "رمز مفقود" });
  const teacherEmail = teacherEmailFromRequest(req);

  const allCodes = dbInstance.getJoinCodes();
  const old = allCodes.find(
    (j) =>
      normalizeJoinCode(j.code) === normalizeJoinCode(oldCode) ||
      compactJoinCode(j.code) === compactJoinCode(oldCode),
  );
  if (!old) return res.status(404).json({ error: "الرمز القديم غير كائن" });
  if (!canAccessJoinCode(old, teacherEmail))
    return res.status(403).json({ error: "هذا الرمز تابع لحساب أستاذ آخر." });

  const nowIso = new Date().toISOString();
  dbInstance.updateJoinCode(old.code, {
    status: "revoked",
    updatedAt: nowIso,
  } as any);

  const newCode = makeJoinCode("LAB", "", issuedJoinCodeCompacts());
  const oldResolvedCourse = resolveJoinCodeCourseForDisplay(old);
  const oldResolvedCourseCode = String(
    oldResolvedCourse.courseCode || old.sectionCode || (old as any).studentSection || (old as any).courseCode || "",
  ).trim();
  const oldResolvedCourseName =
    oldResolvedCourse.courseName ||
    (isGenericJoinCourseCode(oldResolvedCourseCode) ? "" : courseNameFromCode(oldResolvedCourseCode));

  const newJc: JoinCode = {
    code: newCode,
    semester: old.semester,
    sectionCode: oldResolvedCourseCode || old.sectionCode,
    courseCode: oldResolvedCourseCode || (old as any).courseCode || old.sectionCode,
    studentSection: oldResolvedCourseCode || (old as any).studentSection || old.sectionCode,
    resolvedCourseCode: oldResolvedCourseCode,
    resolvedCourseName: oldResolvedCourseName,
    courseName: oldResolvedCourseName || (old as any).courseName,
    status: "active",
    ownerEmail: joinCodeOwnerEmail(old),
    createdByEmail: teacherEmail,
    createdAt: nowIso,
    reissuedFrom: old.code,
    codeJourney: createCodeJourneyEvent("أُعيد إصدار الكود", teacherEmail, { reissuedFrom: old.code, sectionCode: old.sectionCode }),
  } as any;

  if (old.studentId) {
    newJc.status = "used";
    newJc.studentId = old.studentId;
    (newJc as any).usedByStudentId = (old as any).usedByStudentId || old.studentId;
    newJc.studentName = old.studentName;
    newJc.studentSection = oldResolvedCourseCode || old.studentSection || old.sectionCode;
    (newJc as any).sectionCode = oldResolvedCourseCode || old.sectionCode || old.studentSection;
    (newJc as any).courseCode = oldResolvedCourseCode || (old as any).courseCode || old.studentSection || old.sectionCode;
    (newJc as any).resolvedCourseCode = oldResolvedCourseCode;
    (newJc as any).resolvedCourseName = oldResolvedCourseName;
    (newJc as any).courseName = oldResolvedCourseName || (old as any).courseName;
    newJc.activatedAt = old.activatedAt || nowIso;
    newJc.activationDeviceFingerprint =
      (old as any).activationDeviceFingerprint || "";
    newJc.activationDeviceToken = (old as any).activationDeviceToken || "";
    (newJc as any).activationDeviceServerHash =
      (old as any).activationDeviceServerHash || "";

    dbInstance.updateStudent(old.studentId, { activationCode: newCode });
  }

  const signedReissued = attachJoinCodeSignature(newJc) as JoinCode;
  dbInstance.addJoinCode(signedReissued);
  dbInstance.updateJoinCode(old.code, { replacedBy: newCode, codeJourney: appendCodeJourney(old, codeJourneyEvent("أُعيد إصدار الكود", req, { replacedBy: newCode, teacherEmail })) } as any);

  dbInstance.addActivityLog({
    action: "إعادة تفريد الرمز",
    details: old.studentId
      ? `تم إلغاء الرمز (${old.code}) وتوليد رمز بديل (${newCode}) للطالب مع حفظ قفل الجهاز الأصلي. تغيير الجهاز يتم فقط من أمر إعادة ضبط الوصول.`
      : `تم إلغاء الرمز (${old.code}) وتوليد رمز بديل باسم (${newCode}).`,
    teacherEmail: joinCodeOwnerEmail(old),
    actorEmail: teacherEmail,
    sectionCode: String((old as any).studentSection || old.sectionCode || ""),
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "شريط الصلاحية",
    isViolationWarning: false,
  });

  return res.json({
    success: true,
    newCode,
    joinCode: newJc,
    deviceLockPreserved: Boolean(old.studentId),
  });
});

app.post("/api/teacher/students/:id/update-profile", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });

  const studentId = String(req.params.id).trim();
  const student = dbInstance
    .getStudents()
    .find((s) => String(s.id) === studentId);
  if (!student) return res.status(404).json({ error: "الطالب غير موجود." });

  if (!teacherCanManageStudent(student, teacherEmail)) {
    return res
      .status(403)
      .json({ error: "لا يمكن تعديل بيانات طالب خارج مقرراتك." });
  }

  const { newIdNumber, newName } = req.body;
  const targetId = normalizeStudentId(newIdNumber);
  const targetName = String(newName || "").trim();

  if (!targetId || !targetName) {
    return res.status(400).json({ error: "يجب إدخال اسم ورقم جامعي صحيحين." });
  }

  // Check unique constraints for ID if ID has actually changed
  if (targetId !== student.id) {
    const duplicate = dbInstance
      .getStudents()
      .find((s) => String(s.id) === targetId);
    if (duplicate) {
      return res
        .status(400)
        .json({ error: "الرقم الجامعي الجديد مستخدم بالفعل لطالب آخر." });
    }
  }

  // Log activity
  dbInstance.addActivityLog({
    studentId: targetId,
    studentName: targetName,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: student.sectionCode,
    action: "تعديل الملف الشخصي",
    details: `تم تعديل بيانات الطالب من قبل أستاذ المقرر. الاسم القديم: ${student.name}، الجديد: ${targetName}. الرقم القديم: ${student.id}، الجديد: ${targetId}.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "قائمة الطلاب",
    isViolationWarning: false,
  });

  // Update in Student profiles
  dbInstance.updateStudent(student.id, {
    name: targetName,
  });

  // Update internal identifier in dbInstance array safely
  if (student.id !== targetId) {
    student.id = targetId;
    dbInstance.persist();
  }

  // Also update associated join codes that were bound to the old ID
  dbInstance.getJoinCodes().forEach((jc: any) => {
    const linkedIds = [jc.studentId, jc.usedByStudentId, jc.assignedStudentId]
      .map((value: any) => normalizeStudentId(value))
      .filter(Boolean);
    if (linkedIds.some((v) => v === studentId)) {
      if (jc.studentId) jc.studentId = targetId;
      if (jc.usedByStudentId) jc.usedByStudentId = targetId;
      if (jc.assignedStudentId) jc.assignedStudentId = targetId;
    }
  });

  // عند تغيير الرقم الجامعي ننقل كل المراجع للرقم الجديد حتى لا تيتم
  // التسليمات/السجلات؛ الاسم نفسه يُقرأ حيّاً من سجل الطالب فلا يحتاج نسخاً.
  const oldNormalizedId = normalizeStudentId(studentId);
  const newNormalizedId = normalizeStudentId(targetId);
  if (
    oldNormalizedId &&
    newNormalizedId &&
    oldNormalizedId !== newNormalizedId
  ) {
    const retargetStudentId = (rows: any[]) => {
      if (!Array.isArray(rows)) return;
      rows.forEach((row: any) => {
        if (!row || typeof row !== "object") return;
        if (normalizeStudentId(row.studentId) === oldNormalizedId)
          row.studentId = targetId;
        if (
          row.linkedStudentId &&
          normalizeStudentId(row.linkedStudentId) === oldNormalizedId
        )
          row.linkedStudentId = targetId;
      });
    };
    retargetStudentId(dbInstance.getQuizSubmissions());
    retargetStudentId(dbInstance.getExerciseSubmissions());
    retargetStudentId(dbInstance.getTeacherSubmissions());
    retargetStudentId(dbInstance.getActivityLogs());
    retargetStudentId(dbInstance.getPasswordResetRequests());
    retargetStudentId(dbInstance.getPersonalizedProjects());
    retargetStudentId(dbInstance.getSebAttempts());
  }
  dbInstance.persist();

  return res.json({
    success: true,
    student: { ...student, name: targetName, id: targetId, idNumber: targetId },
  });
});

app.post("/api/teacher/students/:id/manual-activate", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res
      .status(401)
      .json({
        error:
          "جلسة الأستاذ غير واضحة. لا يمكن التفعيل اليدوي من واجهة الطالب.",
      });
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "الطالب غير كائن" });
  if (!teacherCanManageStudent(student, teacherEmail)) {
    return res.status(403).json({ error: "لا يمكن تفعيل طالب خارج مقرراتك." });
  }

  dbInstance.updateStudent(student.id, {
    isPaid: true,
    activationCode: (student as any).activationCode || "MANUAL-BY-INSTRUCTOR",
    isAccessBlocked: false,
    accessBlockReason: "",
    accessResetAt: new Date().toISOString(),
    deviceSessionInvalidatedAt: new Date().toISOString(),
    devices: [],
  } as any);

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: student.sectionCode,
    action: "التفعيل اليدوي للأستاذ",
    details: `تم تفعيل حساب الطالب يدوياً (${student.name}) بقرار من أستاذ المقرر دون تطلب رمز انضمام.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "شريط الصلاحية",
    isViolationWarning: false,
  });

  return res.json({ success: true });
});

app.post("/api/teacher/students/:idNumber/course-suspension", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });
  const idNumber = normalizeStudentId(req.params.idNumber);
  const courseCode = String(
    req.body?.courseCode || req.body?.sectionCode || "",
  ).trim();
  const suspend = req.body?.suspend !== false;
  const reason = String(req.body?.reason || "").trim();
  if (!idNumber || !courseCode)
    return res.status(400).json({ error: "بيانات الطالب أو المقرر ناقصة." });
  const ownerEmail = sectionOwnerEmail(courseCode);
  if (!isAdminEmail(teacherEmail) && ownerEmail !== teacherEmail) {
    return res.status(403).json({ error: "هذا المقرر تابع لحساب أستاذ آخر." });
  }
  const student = dbInstance
    .getStudents()
    .find(
      (st: any) =>
        normalizeStudentId(st.idNumber || st.id || st.studentId) === idNumber,
    );
  if (!student)
    return res.status(404).json({ error: "لم يتم العثور على حساب الطالب." });
  if (
    !getStudentDiscoveredCourseCodes(student).some(
      (code) => String(code).toLowerCase() === courseCode.toLowerCase(),
    )
  ) {
    return res.status(404).json({ error: "الطالب غير مرتبط بهذا المقرر." });
  }
  const updatedStudent = setStudentCourseSuspension(
    student,
    courseCode,
    teacherEmail,
    suspend,
    reason,
  );
  const revision = bumpLiveContentRevision();
  notifyStudent(
    String(updatedStudent.id),
    suspend ? "تم إيقاف دخول مقرر مؤقتًا" : "تمت إعادة تفعيل مقرر",
    suspend
      ? `تم إيقاف دخولك لمقرر ${sectionDisplayCode(courseCode)} مؤقتًا. يرجى مراجعة أستاذ المقرر.`
      : `تمت إعادة تفعيل دخولك لمقرر ${sectionDisplayCode(courseCode)}.`,
    {
      type: suspend ? "course_student_suspended" : "course_student_reactivated",
      studentId: String(updatedStudent.id),
      courseCode,
      link: "/",
      revision: String(revision),
    },
  );
  dbInstance.addActivityLog({
    studentId: String(updatedStudent.id),
    studentName: String(updatedStudent.name || ""),
    action: suspend ? "تعطيل طالب في مقرر" : "إعادة تفعيل طالب في مقرر",
    details: suspend
      ? `تم تعطيل دخول الطالب إلى مقرر ${courseCode} فقط دون حذف بياناته أو تسليماته أو درجاته.`
      : `تمت إعادة تفعيل دخول الطالب إلى مقرر ${courseCode}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: courseCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "قائمة الطلاب",
    isViolationWarning: false,
  });
  return res.json({
    success: true,
    student: {
      ...updatedStudent,
      enrollments: getStudentEnrollmentDetails(updatedStudent),
    },
    enrollments: getStudentEnrollmentDetails(updatedStudent),
    revision,
  });
});

app.post("/api/teacher/students/:idNumber/remove-course", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });
  const idNumber = normalizeStudentId(req.params.idNumber);
  const student = dbInstance
    .getStudents()
    .find(
      (s) =>
        normalizeStudentId(
          (s as any).idNumber || s.id || (s as any).studentId,
        ) === idNumber,
    );
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });

  const courseCodeToRemove = String(req.body.courseCode || "").trim();
  if (!courseCodeToRemove)
    return res.status(400).json({ error: "رمز المقرر غير موجود." });

  const normalizedCourseToRemove = courseCodeToRemove.toLowerCase();
  if (
    teacherEmail &&
    !isAdminEmail(teacherEmail) &&
    sectionOwnerEmail(courseCodeToRemove) !== teacherEmail
  ) {
    return res
      .status(403)
      .json({ error: "لا يمكن إزالة حساب طالب من مقرر لا تملكه." });
  }

  const studentIds = new Set(
    [
      student.id,
      (student as any).idNumber,
      (student as any).studentId,
      idNumber,
    ]
      .map((value: any) => normalizeStudentId(value))
      .filter(Boolean),
  );

  const hasTeacherSub = dbInstance.getTeacherSubmissions().some((sub: any) => {
    const isSameStudent = studentIds.has(normalizeStudentId(sub.studentId));
    if (!isSameStudent) return false;
    const subCourse = String(sub.courseCode || sub.sectionCode || "");
    return courseCodeMatchesForTeacher(subCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(subCourse, courseCodeToRemove);
  });
  
  const hasExerciseSub = dbInstance.getExerciseSubmissions().some((sub: any) => {
    const isSameStudent = studentIds.has(normalizeStudentId(sub.studentId));
    if (!isSameStudent) return false;
    const subCourse = String(sub.courseCode || sub.sectionCode || "");
    return courseCodeMatchesForTeacher(subCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(subCourse, courseCodeToRemove);
  });

  const hasQuizSub = dbInstance.getQuizSubmissions().some((sub: any) => {
    const isSameStudent = studentIds.has(normalizeStudentId(sub.studentId));
    if (!isSameStudent) return false;
    const subCourse = String(sub.courseCode || sub.sectionCode || "");
    return courseCodeMatchesForTeacher(subCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(subCourse, courseCodeToRemove);
  });

  const hasProjectSub = dbInstance.getPersonalizedProjects().some((project: any) => {
    const isSameStudent = studentIds.has(normalizeStudentId(project.studentId));
    if (!isSameStudent) return false;
    const projectCourse = String(project.courseCode || project.sectionCode || "");
    const matchesCourse = courseCodeMatchesForTeacher(projectCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(projectCourse, courseCodeToRemove);
    return matchesCourse && (project.status === "submitted" || project.status === "graded");
  });

  if (hasTeacherSub || hasExerciseSub || hasQuizSub || hasProjectSub) {
    return res.status(400).json({ error: "لا يمكن حذف الطالب لوجود تسليمات (اختبارات، مشاريع، أو تدريبات) مرتبطة به في هذا المقرر." });
  }

  const currentActivationCodeForRemoval = compactJoinCode((student as any).activationCode || "");
  const linkedCourseCodes = dbInstance.getJoinCodes().filter((jc: any) => {
    // مطابقة واعية بالمالك (مثل بقية الدالة) لا مطابقة نصية حرفية: كانت
    // "111-aa@…" !== "111" تترك كود الطالب مرتبطاً بعد الحذف، فيبقى المقرر
    // مُفعّلاً تلقائياً عند إعادة الإضافة (كارثة) ويمنع إصدار كود جديد.
    const jcCourse = joinCodeCourse(jc);
    const matchesCourse =
      courseCodeMatchesForTeacher(jcCourse, courseCodeToRemove, teacherEmail) ||
      sectionCodeEquivalent(jcCourse, courseCodeToRemove);
    if (!matchesCourse) return false;
    const linkedIds = [jc.studentId, jc.usedByStudentId, jc.assignedStudentId]
      .map((value: any) => normalizeStudentId(value))
      .filter(Boolean);
    const isCurrentActivationCode =
      !!currentActivationCodeForRemoval &&
      compactJoinCode(jc.code || "") === currentActivationCodeForRemoval;
    return isCurrentActivationCode || linkedIds.some((value: string) => studentIds.has(value));
  });

  linkedCourseCodes.forEach((jc: any) => dbInstance.deleteJoinCode(jc.code));

  // أزل صفّ الكشف (allowedStudents) لهذا الطالب في هذا المقرر حتى لا يُعاد اكتشاف
  // المقرر ويظهر من جديد كبطاقة "مقفلة" بعد إزالة الطالب منه. مملوك للأستاذ فقط.
  (dbInstance as any).data.allowedStudents = dbInstance
    .getAllowedStudents()
    .filter((row: any) => {
      const rowId = normalizeStudentId(row.idNumber || (row as any).id || (row as any).studentId);
      if (!studentIds.has(rowId)) return true;
      const rowCourse = row.sectionCode || (row as any).studentSection || (row as any).courseCode || "";
      const matches =
        courseCodeMatchesForTeacher(rowCourse, courseCodeToRemove, teacherEmail) ||
        sectionCodeEquivalent(rowCourse, courseCodeToRemove);
      return !matches;
    });
  dbInstance.persist();

  const deletedCodes = new Set(
    linkedCourseCodes.map((jc: any) => compactJoinCode(jc.code)),
  );
  const currentActivationCode = currentActivationCodeForRemoval;
  const remainingJoinCode = dbInstance.getJoinCodes().find((jc: any) => {
    if (!isUsableJoinCodeRecord(jc)) return false;
    const status = String(jc.status || "").toLowerCase();
    if (
      !(status === "used" || status === "active-used" || status === "activated")
    )
      return false;
    if (courseMatchesRemovalTarget(joinCodeCourse(jc), courseCodeToRemove, teacherEmail)) return false;
    return joinCodeLinkedToStudent(jc, studentIds);
  });

  const patch: any = buildStudentCourseDeepRemovalPatch(student, courseCodeToRemove, teacherEmail, linkedCourseCodes);
  const remainingPrimaryCode = remainingJoinCode
    ? String(joinCodeCourse(remainingJoinCode))
    : "";
  if (courseMatchesRemovalTarget(student.sectionCode, courseCodeToRemove, teacherEmail)) {
    patch.sectionCode = remainingPrimaryCode;
  }
  if (courseMatchesRemovalTarget((student as any).studentSection, courseCodeToRemove, teacherEmail)) {
    patch.studentSection = remainingPrimaryCode;
  }
  if (currentActivationCode && deletedCodes.has(currentActivationCode)) {
    patch.activationCode = remainingJoinCode
      ? (remainingJoinCode as any).code
      : "";
  }
  patch.courseVisibilitySyncedAt = new Date().toISOString();

  if (Object.keys(patch).length)
    dbInstance.updateStudent(student.id, patch as any);

  let updatedStudent =
    dbInstance.getStudents().find((s) => s.id === student.id) || student;
  const remainingCourses = getStudentActiveCourseCodes(updatedStudent);
  if (!remainingCourses.length) {
    dbInstance.updateStudent(student.id, {
      isAccessBlocked: true,
      accessBlockReason: "تم حذفك من المقرر الأخير المعين لك.",
      devices: [],
    } as any);
  } else if (
    (updatedStudent as any).isAccessBlocked &&
    String((updatedStudent as any).accessBlockReason || "") ===
      "تم حذفك من المقرر الأخير المعين لك."
  ) {
    dbInstance.updateStudent(student.id, {
      isAccessBlocked: false,
      accessBlockReason: "",
    } as any);
  }
  updatedStudent =
    dbInstance.getStudents().find((s) => s.id === student.id) || updatedStudent;

  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: courseCodeToRemove,
    action: "حذف طالب من المقرر",
    details: `تم إزالة الطالب ${student.name} من المقرر ${courseCodeToRemove}${linkedCourseCodes.length ? ` مع فصل ${linkedCourseCodes.length} رمز دخول مرتبط بهذا المقرر` : ""}.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "متصفح",
    isViolationWarning: false,
  });

  return res.json({
    success: true,
    updatedStudent: {
      ...updatedStudent,
      enrollments: getStudentEnrollmentDetails(updatedStudent),
    },
    removedJoinCodes: linkedCourseCodes.length,
  });
});

app.post("/api/teacher/students/:id/reset-access", (req, res) => {
  const student = dbInstance
    .getStudents()
    .find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "الطالب غير موجود" });
  const teacherEmail = teacherEmailFromRequest(req);
  if (
    teacherEmail &&
    !isAdminEmail(teacherEmail) &&
    sectionOwnerEmail(student.sectionCode) !== teacherEmail
  ) {
    return res
      .status(403)
      .json({ error: "لا يمكن تعديل حساب طالب في مقرر لا تملكه." });
  }

  const activationCode = (student as any).activationCode;
  const linkedJoinCodes = dbInstance.getJoinCodes().filter((jc: any) => {
    const sameCode =
      activationCode &&
      normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode);
    const sameStudent =
      normalizeStudentId(jc.studentId || jc.usedByStudentId || "") ===
      normalizeStudentId(student.id);
    return sameCode || sameStudent;
  });
  // نلتقط بصمة/توكن الجهاز القديم قبل تفريغه حتى "نتقاعد" الجهاز القديم أثناء النقل:
  // فلا يستطيع المتصفح/الجهاز القديم إعادة احتجاز المقعد (single-device slot) قبل أن
  // يدخل الجهاز الجديد. هذا هو جوهر إصلاح تبديل الجهاز بين سفاري/كروم/PWA/تلفون جديد.
  const retiredDeviceFingerprints = Array.isArray((student as any).devices)
    ? (student as any).devices
        .map((d: any) => String(d || "").trim())
        .filter(Boolean)
    : [];
  const retiredDeviceTokens = linkedJoinCodes
    .map((jc: any) => String(jc.activationDeviceToken || "").trim())
    .filter(Boolean);
  linkedJoinCodes.forEach((jc: any) => {
    dbInstance.updateJoinCode(jc.code, {
      activationDeviceFingerprint: "",
      activationDeviceToken: "",
      // لا بد من تفريغ بصمة الخادم أيضاً عند إعادة التهيئة، وإلا بقيت مرتبطة
      // بالجهاز القديم فتقفل الطالب على الجهاز الجديد بعد أول دخول وتُطلق تنبيه
      // "توكن منسوخ" زوراً وتمنع إدخال الكود الجديد. (نفس ما يفعله reset-devices)
      activationDeviceServerHash: "",
    } as any);
  });

  const mode = String(req.body?.mode || "reset_device");
  const nowIso = new Date().toISOString();
  const accessPatch: any =
    mode === "hold"
      ? {
          devices: [],
          accessResetAt: nowIso,
          deviceSessionInvalidatedAt: nowIso,
          isAccessBlocked: true,
          accessBlockReason: "تم إيقاف الحساب مؤقتاً من قبل أستاذ المقرر.",
          pendingDeviceTransfer: false,
          retiredDeviceFingerprints: [],
          retiredDeviceTokens: [],
        }
      : mode === "restore"
        ? {
            devices: [],
            accessResetAt: nowIso,
            deviceSessionInvalidatedAt: nowIso,
            isAccessBlocked: false,
            accessBlockReason: "",
            isPaid: true,
            pendingDeviceTransfer: false,
            retiredDeviceFingerprints: [],
            retiredDeviceTokens: [],
          }
        : {
            devices: [],
            accessResetAt: nowIso,
            deviceSessionInvalidatedAt: nowIso,
            isAccessBlocked: false,
            accessBlockReason: "",
            // حالة واضحة: "بانتظار اعتماد الجهاز الجديد". أول جهاز مختلف فعلاً عن
            // القديم يدخل بنجاح يُعتمد رسمياً ويُقفل عليه، والجهاز القديم يُرفض برسالة واضحة.
            pendingDeviceTransfer: true,
            retiredDeviceFingerprints,
            retiredDeviceTokens,
          };
  dbInstance.updateStudent(student.id, accessPatch);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: student.sectionCode,
    action:
      mode === "hold"
        ? "إيقاف حساب الطالب"
        : mode === "restore"
          ? "إعادة تفعيل حساب الطالب"
          : "إعادة تهيئة ربط الأجهزة",
    details:
      mode === "hold"
        ? `تم إيقاف حساب الطالب ${student.name} فورياً.`
        : mode === "restore"
          ? `تمت إعادة تفعيل حساب الطالب ${student.name} والسماح له بالدخول من جديد.`
          : `تمت إعادة تهيئة جهاز الطالب ${student.name} وإنهاء جلسة الجهاز القديم وتجهيز الحساب لاعتماد الجهاز الجديد عند الدخول التالي.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "إدارة الطلبة",
    isViolationWarning: false,
  });
  notifyUsers(
    (token) =>
      token.role === "student" && String(token.userId) === String(student.id),
    mode === "hold"
      ? "تم إيقاف الحساب"
      : mode === "restore"
        ? "تمت إعادة تفعيل الحساب"
        : "تحديث الوصول",
    mode === "hold"
      ? "تم إيقاف حسابك مؤقتاً من قبل أستاذ المقرر."
      : mode === "restore"
        ? "تمت إعادة تفعيل حسابك. يمكنك الدخول من جديد."
        : "تمت إعادة تهيئة ربط جهاز حسابك. افتح مِراس من الجهاز الجديد ليتم اعتماده تلقائياً.",
    {
      type:
        mode === "hold"
          ? "access_blocked"
          : mode === "restore"
            ? "access_restored"
            : "access_reset",
      studentId: student.id,
      link: "/",
    },
  );
  return res.json({
    success: true,
    student: dbInstance.getStudents().find((s) => s.id === student.id),
  });
});

// ================= SECTIONS MANAGEMENT =================
app.get("/api/teacher/sections", (req, res) => {
  setNoCache(res);
  const teacherEmail = teacherEmailFromRequest(req);
  const includeAll =
    String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
  const sections = activeSections()
    .filter(
      (sec: any) =>
        includeAll ||
        !teacherEmail ||
        sectionOwnerEmail(sec.code) === teacherEmail,
    );
  return res.json({ success: true, sections });
});

app.post("/api/teacher/sections", (req, res) => {
  const { code, courseName, semester, isOpen } = req.body;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });
  if (!code || !courseName) {
    return res
      .status(400)
      .json({ error: "يرجى إدخال رمز المقرر واسم المقرر." });
  }
  const normalizedCode = sectionDisplayCode(String(code).trim());
  const finalCode = buildTeacherScopedSectionCode(normalizedCode, teacherEmail);

  const teacherKey = teacherEmail.toLowerCase();
  // الرقم فقط هو القيد الفعلي داخل حساب الأستاذ. اسم المقرر قد يتكرر
  // بين شعب مختلفة، كما أن الحذف يجب أن يحرر الرقم فوراً ولا يترك
  // أثراً وهمياً يمنع إعادة استخدامه.
  const exists = getTeacherOwnedEquivalentSections(finalCode, teacherKey).find(
    (s: any) => String(s.code || "").trim() && !deletedTeacherCourseShadowMatches(s, finalCode, teacherKey),
  );
  if (exists) {
    return res.status(409).json({
      error: "رقم المقرر مستخدم بالفعل داخل حسابك. احذف المقرر القديم أو عدّل رقمه ثم أعد المحاولة.",
    });
  }
  const section: Section = {
    code: finalCode,
    courseName,
    semester: semester || "الفصل الحالي",
    isOpen: typeof isOpen === "boolean" ? isOpen : true,
    ownerEmail: teacherEmail,
  };
  dbInstance.addSection(section);
  return res.json({ success: true, section });
});

app.put("/api/teacher/sections/:code", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const codeParam = String(req.params.code).trim().toUpperCase();
  const section = activeSections().find((s) => s.code.toUpperCase() === codeParam);
  if (!section) return res.status(404).json({ error: "المقرر غير موجود." });

  if (section.ownerEmail?.toLowerCase() !== teacherEmail.toLowerCase()) {
    return res.status(403).json({ error: "هذا المقرر تابع لحساب أستاذ آخر." });
  }

  const currentCode = String(section.code || "").trim();
  const requestedDisplayCode = String(req.body?.code || sectionDisplayCode(currentCode) || currentCode).trim();
  const nextCode = buildTeacherScopedSectionCode(requestedDisplayCode, teacherEmail);
  if (!nextCode) {
    return res.status(400).json({ error: "يرجى إدخال رمز المقرر." });
  }

  const nextCourseName = String(req.body?.courseName ?? section.courseName ?? "").trim();
  if (!nextCourseName) {
    return res.status(400).json({ error: "يرجى إدخال اسم المقرر." });
  }

  const teacherKey = teacherEmail.toLowerCase();
  const duplicate = getTeacherOwnedEquivalentSections(nextCode, teacherKey).find(
    (s: any) => !sectionCodeEquivalent(s.code, currentCode),
  );
  if (duplicate) {
    return res.status(409).json({
      error: "رقم المقرر مستخدم بالفعل داخل حسابك. غيّر الرقم أو عدّل المقرر الموجود.",
    });
  }

  const patch: any = {
    ...req.body,
    code: nextCode,
    courseName: nextCourseName,
    ownerEmail: teacherEmail,
  };
  if (req.body?.semester !== undefined) patch.semester = req.body.semester || "الفصل الحالي";

  dbInstance.updateSection(section.code, patch);
  migrateTeacherCourseCodeReferences(currentCode, nextCode);
  touchStudentsLinkedToCourse(nextCode);
  bumpLiveContentRevision();
  const updatedSection = activeSections().find((s) => sectionCodeEquivalent(s.code, nextCode));
  if (typeof req.body?.isOpen === "boolean") {
    const affectedStudentIds = new Set(
      dbInstance
        .getStudents()
        .filter((student: any) =>
          getStudentDiscoveredCourseCodes(student).some((code) =>
            sectionCodeEquivalent(code, nextCode),
          ),
        )
        .map((student: any) => String(student.id)),
    );
    notifyUsers(
      (token) =>
        token.role === "student" &&
        affectedStudentIds.has(String(token.userId)),
      req.body.isOpen ? "تم فتح المقرر" : "تم إغلاق المقرر",
      req.body.isOpen
        ? `تم فتح مقرر ${courseNameFromCode(nextCode)} من جديد.`
        : `تم إغلاق مقرر ${courseNameFromCode(nextCode)} وتعطيل كل الاختبارات والمشاريع المرتبطة به.`,
      {
        type: req.body.isOpen ? "course_opened" : "course_closed",
        courseCode: nextCode,
        link: "/",
      },
    );
  }
  return res.json({ success: true, section: updatedSection });
});

app.delete("/api/teacher/sections/:code", (req, res) => {
  const codeParam = String(req.params.code || "").trim();
  const teacherEmail = teacherEmailFromRequest(req);
  const section = getTeacherOwnedEquivalentSections(codeParam, teacherEmail)[0];
  if (!section) return res.status(404).json({ error: "المقرر غير موجود." });

  if (String(section.ownerEmail || sectionOwnerEmail(section.code)).toLowerCase() !== teacherEmail.toLowerCase()) {
    return res.status(403).json({ error: "هذا المقرر تابع لحساب أستاذ آخر." });
  }

  const deletedCodes = getTeacherOwnedEquivalentSections(section.code, teacherEmail).map((sec: any) => sec.code);
  const matchesDeleted = (c: any) => {
    const cc = String(c || "").trim();
    return (
      !!cc &&
      deletedCodes.some(
        (code) =>
          courseCodeMatchesForTeacher(cc, code, teacherEmail) ||
          sectionCodeEquivalent(cc, code),
      )
    );
  };

  // أكواد المقرر المحذوف (لمسح activationCode المرتبط بها من سجلات الطلاب)
  const removedCodeCompacts = new Set(
    dbInstance
      .getJoinCodes()
      .filter((jc: any) => matchesDeleted(jc.sectionCode || jc.courseCode || jc.code || ""))
      .map((jc: any) => compactJoinCode(jc.code)),
  );

  // Clean up allowed students (roster)
  (dbInstance as any).data.allowedStudents = dbInstance.getAllowedStudents().filter((s: any) => {
    const courseCode = s.sectionCode || s.studentSection || s.courseCode || "";
    return !matchesDeleted(courseCode);
  });

  // إزالة المقرر من سجلات الطلاب مع الإبقاء على الحساب. نضيف أيضاً علامة حذف
  // دورة المقرر حتى لا يعود مقرر قديم للطالب لو بقي أثر في الجلسة/الأكواد أو أُعيد
  // إنشاء نفس الرمز لاحقاً؛ سيحتاج الطالب كوداً جديداً للدورة الجديدة.
  dbInstance.getStudents().forEach((s: any) => {
    const patch: any = {};
    const touchedCodes = new Set<string>();
    const rememberTouched = (value: any) => {
      const raw = String(value || "").trim();
      if (raw && matchesDeleted(raw)) touchedCodes.add(raw);
    };
    rememberTouched(s.sectionCode);
    rememberTouched((s as any).studentSection);
    if (Array.isArray(s.enrollments)) {
      s.enrollments.forEach((en: any) => rememberTouched(en?.courseCode || en?.sectionCode || en?.studentSection));
      const next = s.enrollments.filter(
        (en: any) => !matchesDeleted(en?.courseCode || en?.sectionCode || en?.studentSection),
      );
      if (next.length !== s.enrollments.length) patch.enrollments = next;
    }
    if (Array.isArray(s.activatedCourseCodes)) {
      s.activatedCourseCodes.forEach(rememberTouched);
      const next = s.activatedCourseCodes.filter((c: any) => !matchesDeleted(c));
      if (next.length !== s.activatedCourseCodes.length) patch.activatedCourseCodes = next;
    }
    if (Array.isArray(s.suspendedEnrollments)) {
      const next = s.suspendedEnrollments.filter(
        (en: any) => !matchesDeleted(en?.courseCode || en?.sectionCode),
      );
      if (next.length !== s.suspendedEnrollments.length) patch.suspendedEnrollments = next;
    }
    if (matchesDeleted(s.sectionCode)) patch.sectionCode = "";
    if (matchesDeleted((s as any).studentSection)) patch.studentSection = "";
    if (s.activationCode && removedCodeCompacts.has(compactJoinCode(s.activationCode)))
      patch.activationCode = "";
    if (touchedCodes.size) {
      const existingLinks = canonicalStudentRemovedCourseLinks(s).filter(
        (entry: any) => !matchesDeleted(entry?.courseCode || entry?.sectionCode || entry?.studentSection),
      );
      const removedAt = new Date().toISOString();
      const markers = Array.from(touchedCodes).map((course) => ({
        studentId: normalizeStudentId(s.id || s.idNumber || s.studentId),
        courseCode: course,
        sectionCode: course,
        studentSection: course,
        teacherEmail,
        removedAt,
        deletedAt: removedAt,
        status: "removed",
        reason: "course_deleted",
      }));
      patch.removedCourseLinks = [...existingLinks, ...markers];
      patch.removedEnrollments = patch.removedCourseLinks;
      patch.deletedCourseLinks = patch.removedCourseLinks;
    }
    if (Object.keys(patch).length) dbInstance.updateStudent(s.id, patch as any);
  });

  // Clean up join codes
  (dbInstance as any).data.joinCodes = dbInstance.getJoinCodes().filter((jc: any) => {
    const jcCode = jc.sectionCode || jc.courseCode || jc.code || "";
    return !matchesDeleted(jcCode);
  });

  deletedCodes.forEach((code: string) => dbInstance.deleteSection(code));
  dbInstance.persist();

  return res.json({ success: true, deletedCodes, deletedSection: section });
});

// ================= TEACHER DASHBOARD BACKEND SPECIALS (NEW PDF BOOK SYSTEM) =================

// Save details of protected PDF uploaded by instructor only.
// The original filename is deliberately not exposed to the student UI.
app.post("/api/teacher/textbook/upload", (req, res) => {
  const { fileName, size, fileData } = req.body;
  const uploadedAt = new Date();
  const safeId = `SRC-${uploadedAt.getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const protectedDir = path.join(process.cwd(), "data", "protected_sources");
  fs.mkdirSync(protectedDir, { recursive: true });

  let sha256 = "metadata-only";
  let storedPath = "metadata-only";
  if (typeof fileData === "string" && fileData.includes("base64,")) {
    const base64Payload = fileData.split("base64,")[1];
    const buffer = Buffer.from(base64Payload, "base64");
    sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    storedPath = path.join(protectedDir, `${safeId}.pdf`);
    fs.writeFileSync(storedPath, buffer);
  }

  dbInstance.setBookMetadata({
    fileName: `مصدر محمي ${safeId}`,
    uploadDate: uploadedAt.toLocaleString("en-GB", {
      timeZone: "Asia/Kuwait",
      hour12: false,
    }),
    size: size || "غير محدد",
    sourceId: safeId,
    sha256,
    protectedPath: storedPath,
    originalNameHidden: fileName ? true : false,
  } as any);

  dbInstance.addActivityLog({
    action: "رفع مصدر PDF محمي",
    details: `تم رفع مصدر مقرر محمي برقم (${safeId}). الملف غير ظاهر للطلبة ويستخدم داخلياً فقط لتحليل الفصول وتوليد الأنشطة والأسئلة والمشاريع.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "ملفات الأستاذ الأمنية",
    browser: "لوحة المشرف",
    isViolationWarning: false,
  });

  return res.json({ success: true, metadata: dbInstance.getBookMetadata() });
});

// Delete book
app.post("/api/teacher/textbook/delete", (req, res) => {
  dbInstance.setBookMetadata(undefined);
  // Optional reset chapters
  return res.json({ success: true });
});

// Analyze uploaded protected PDF locally and build chapter map without paid AI.
app.post("/api/teacher/textbook/analyze", async (req, res) => {
  let teacherEmail = teacherEmailFromRequest(req);
  const courseCode = String(
    req.query.courseCode || req.body?.courseCode || "",
  ).trim();
  if (!teacherEmail && courseCode) {
    teacherEmail = sectionOwnerEmail(courseCode);
  }
  if (!teacherEmail) {
    teacherEmail = "ah.alfailakawi@paaet.edu.kw"; // Fallback to main email
  }
  teacherEmail = teacherEmail.toLowerCase();

  // Guard against silent chapter overwrites: if custom chapters already exist for this teacher,
  // immediately return them unless they explicitly forced a re-analysis (e.g. they clicked analyze button)
  const existingChapters = dbInstance
    .getChapters()
    .filter(
      (c: any) =>
        c.teacherEmail && c.teacherEmail.toLowerCase() === teacherEmail,
    );
  const isExplicitTrigger =
    req.body && (req.body.force === true || req.body.fileName);
  if (existingChapters.length > 0 && !isExplicitTrigger) {
    return res.json({
      success: true,
      chapters: existingChapters,
      metadata: dbInstance.getBookMetadata(),
    });
  }

  const meta: any = dbInstance.getBookMetadata() || {};
  const protectedPath = meta.protectedPath;

  let extraction = {
    text: "",
    method: "none",
    warning: "لا يوجد مصدر PDF مرفوع حتى الآن.",
  } as any;
  if (!protectedPath || protectedPath === "metadata-only") {
    const teacherChapters = dbInstance
      .getChapters()
      .filter(
        (c: any) =>
          c.teacherEmail && c.teacherEmail.toLowerCase() === teacherEmail,
      );
    return res.json({
      success: true,
      chapters: teacherChapters,
      metadata: dbInstance.getBookMetadata(),
      warning: "لا يوجد مصدر PDF مرفوع، لذلك لم يتم إنشاء أي فصول افتراضية.",
      extractionMethod: "none",
      extractedChars: 0,
    });
  }
  if (
    protectedPath &&
    protectedPath !== "metadata-only" &&
    fs.existsSync(protectedPath)
  ) {
    extraction = extractPdfTextLocal(protectedPath);
  }

  const result = buildLocalChaptersFromText(extraction.text, {
    ...meta,
    extractionMethod: extraction.method,
  });
  if (!result.chapters.length) {
    dbInstance.setBookMetadata({
      ...meta,
      extractedChars: result.extractedChars,
      extractionMethod: extraction.method,
      extractionWarning:
        extraction.warning ||
        result.warning ||
        "لم يتم إنشاء فصول لأن المصدر لا يحتوي نصاً كافياً.",
      lastAnalyzedAt: new Date().toISOString(),
    } as any);

    const teacherChapters = dbInstance
      .getChapters()
      .filter(
        (c: any) =>
          c.teacherEmail && c.teacherEmail.toLowerCase() === teacherEmail,
      );
    return res.json({
      success: true,
      chapters: teacherChapters,
      metadata: dbInstance.getBookMetadata(),
      warning:
        extraction.warning || result.warning || "لم يتم إنشاء فصول افتراضية.",
      extractionMethod: extraction.method,
      extractedChars: result.extractedChars,
    });
  }

  const chaptersWithEmail = result.chapters.map((c: any) => ({
    ...c,
    teacherEmail,
  }));

  const otherChapters = dbInstance
    .getChapters()
    .filter(
      (c: any) =>
        c.teacherEmail && c.teacherEmail.toLowerCase() !== teacherEmail,
    );
  const mergedChapters = [...otherChapters, ...chaptersWithEmail];
  dbInstance.setChapters(mergedChapters);

  dbInstance.setBookMetadata({
    ...meta,
    extractedChars: result.extractedChars,
    extractionMethod: extraction.method,
    extractionWarning: extraction.warning || result.warning || "",
    lastAnalyzedAt: new Date().toISOString(),
  } as any);

  dbInstance.addActivityLog({
    action: "تحليل مصدر PDF محلي",
    details: extraction.warning
      ? `تم تحليل المصدر محليًا لكن النص القابل للاستخراج محدود. ${extraction.warning}`
      : `تم استخراج ${result.extractedChars} حرفًا من المصدر وبناء خريطة فصول محلية قابلة للتعديل.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "محلل PDF محلي مجاني",
    browser: "لوحة المشرف",
    isViolationWarning: !!extraction.warning,
  });

  return res.json({
    success: true,
    chapters: chaptersWithEmail,
    metadata: dbInstance.getBookMetadata(),
    warning: extraction.warning || result.warning || "",
    extractionMethod: extraction.method,
    extractedChars: result.extractedChars,
  });
});

// Update Textbook chapters manually (CRUD)
app.post("/api/teacher/textbook/update", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const { chapters } = req.body;
  if (!Array.isArray(chapters)) {
    return res.status(400).json({ error: "تنسيق الفصول غير صالح" });
  }

  let teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "جلسة المعلم غير صالحة" });
  }
  teacherEmail = teacherEmail.toLowerCase();

  const chaptersWithEmail = chapters.map((c: any) => ({
    ...c,
    teacherEmail,
  }));

  const otherChapters = dbInstance
    .getChapters()
    .filter(
      (c: any) =>
        c.teacherEmail && c.teacherEmail.toLowerCase() !== teacherEmail,
    );
  const mergedChapters = [...otherChapters, ...chaptersWithEmail];

  dbInstance.setChapters(mergedChapters);
  if (!(await ensureDurableSync(res))) return;
  return res.json({ success: true, chapters: chaptersWithEmail });
});

// AI Generate Questions for a particular Chapter
app.post("/api/teacher/textbook/generate-questions", async (req, res) => {
  const { chapterId, quantity } = req.body;
  const chapter = dbInstance.getChapters().find((c) => c.id === chapterId);
  if (!chapter)
    return res.status(404).json({ error: "الفصل الدراسي غير موجود" });

  let fetchedQuestions: Question[] = [];

  if (false && aiInstance) {
    try {
      const prompt = `أنت أستاذ وأكاديمي خبير في صياغة أسئلة تقييم التعلم التطبيقي للمراحل الجامعية.
قم بتوليد ${quantity || 3} أربعة أسئلة فريدة، تتوافق مع تفاصيل ومحتوى هذا الفصل من كتاب التعلم التطبيقي:
عنوان الفصل: "${chapter.title}"
أهدافه ومواضيعه: ${JSON.stringify(chapter.topics)}

تأكد من تنويع الأسئلة بين: اختيار من متعدد (multiple-choice)، وصح أو خطأ (true-false)، ترتيب خطوات (ordering)، تحليل حالة تطبيقي (scenario-analysis).
الأسئلة يجب أن تكون باللغة العربية الفصحى الأكاديمية والخيارات ذكية وليست تافهة.
أرسل الرد بتنسيق JSON نظيف وصالح للمصفوفة لمطابقة البنية التالية فقط، دون كتابة أي كلام تحضيري أو شرح:
[
  {
    "type": "multiple-choice",
    "questionText": "نص السؤال الدقيق العالي الصعوبة الأكاديمية والمفاهيمية",
    "options": ["الخيار الأول الصحيح", "الخيار الثاني المشتت ذكي", "الخيار الثالث المشتت ذكي", "الخيار الرابع المشتت ذكي"],
    "correctAnswer": "الخيار الأول الصحيح",
    "difficulty": "intermediate",
    "points": 5
  },
  {
    "type": "true-false",
    "questionText": "هنا نص السؤال المثير للمقارنة في تصميم المقرر",
    "correctAnswer": "صح",
    "difficulty": "beginner",
    "points": 3
  },
  {
    "type": "ordering",
    "questionText": "رتب خطوات الإنشائية بطريقة علمية:",
    "correctAnswer": ["الخطوة الأولى للترتيب", "الخطوة الثانية للترتيب", "الخطوة الثالثة للترتيب", "الخطوة الرابعة للترتيب"],
    "difficulty": "advanced",
    "points": 5
  }
]`;

      const response = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.8,
        },
      });

      const parsed = JSON.parse(response.text?.trim() || "[]");
      if (Array.isArray(parsed)) {
        fetchedQuestions = parsed.map((item, idx) => ({
          id: `q-gen-${chapterId}-${Date.now()}-${idx}`,
          chapterId,
          type: item.type,
          questionText: item.questionText,
          options: item.options,
          correctAnswer: item.correctAnswer,
          points: item.points || 5,
          difficulty: item.difficulty || "intermediate",
          isApproved: false, // Must be approved by teacher first!
          isGenerated: true,
        }));
      }
    } catch (e) {
      console.log(
        "Failed to generate questions via Gemini AI; no fallback questions will be created.",
      );
    }
  }

  if (fetchedQuestions.length === 0) {
    return res
      .status(503)
      .json({
        error:
          "توليد الأسئلة غير متاح حالياً، ولم يتم إنشاء أسئلة افتراضية أو تجريبية.",
      });
  }

  // Note: We don't save to questionBank automatically, we let teacher review first and approve.
  // We return them to frontend as "unapproved generated questions" for review.
  return res.json({ success: true, questions: fetchedQuestions });
});

// Appove/Approve-All generated questions and move to QuestionBank
app.post("/api/teacher/question-bank/approve", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "جلسة الأستاذ غير صالحة." });
  }

  const { questions } = req.body; // Array of Questions
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: "تنسيق الأسئلة المقترحة غير صالح" });
  }

  questions.forEach((q: Question) => {
    // Add if not already exists, ensure marked approved and isolated
    const canonicalQuestion = canonicalizeQuestionPayloadForTeacher(
      normalizeQuestionPayload(q),
      teacherEmail.toLowerCase(),
    ) as Question;
    canonicalQuestion.isApproved = true;
    canonicalQuestion.teacherEmail = teacherEmail.toLowerCase();
    const exists = dbInstance
      .getQuestionBank()
      .find((item) => item.id === canonicalQuestion.id);
    if (!exists) {
      dbInstance.addQuestion(canonicalQuestion);
    } else {
      dbInstance.updateQuestion(canonicalQuestion.id, {
        ...canonicalQuestion,
        isApproved: true,
        teacherEmail: teacherEmail.toLowerCase(),
      });
    }
  });

  if (!(await ensureDurableSync(res))) return;
  bumpLiveContentRevision();
  return res.json({ success: true, count: questions.length });
});

function normalizeQuestionTypeValue(value: any): string {
  const t = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (
    [
      "multichoice",
      "multiplechoice",
      "multiple-choice",
      "choice",
      "اختيار-متعدد",
      "اختيار من متعدد",
    ].includes(t)
  )
    return "multiple-choice";
  if (
    [
      "truefalse",
      "true-false",
      "true/false",
      "صح-خطأ",
      "صح/خطأ",
      "صح وخطأ",
    ].includes(t)
  )
    return "true-false";
  if (
    ["shortanswer", "short-answer", "essay", "short", "مقالي", "قصير"].includes(
      t,
    )
  )
    return "short-answer";
  return t || "short-answer";
}

function normalizeTrueFalseAnswer(value: any): string {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (["true", "1", "صح", "صحيح"].includes(v)) return "صح";
  if (["false", "0", "خطأ", "خطا", "غير صحيح"].includes(v)) return "خطأ";
  return String(value || "").trim();
}

function normalizeQuestionPayload(qData: any): any {
  const type = normalizeQuestionTypeValue(qData?.type);
  const options = Array.isArray(qData?.options)
    ? qData.options.map((x: any) => String(x ?? "").trim()).filter(Boolean)
    : [];
  return {
    ...qData,
    type,
    options:
      type === "multiple-choice"
        ? options
        : type === "true-false"
          ? ["صح", "خطأ"]
          : qData?.options,
    correctAnswer:
      type === "true-false"
        ? normalizeTrueFalseAnswer(qData?.correctAnswer)
        : String(qData?.correctAnswer ?? "").trim(),
  };
}

// Manage Question Bank CRUD directly

app.get("/api/teacher/question-bank", async (req, res) => {
  await dbInstance.initialSyncPromise;
  let teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.json({
      success: true,
      questions: [],
      revision: liveContentRevision,
    });
  }
  teacherEmail = teacherEmail.toLowerCase();

  const filteredQuestions = activeQuestionBank().filter((q: any) => {
    const owner = String(
      q.teacherEmail || "ah.alfailakawi@paaet.edu.kw",
    ).toLowerCase();
    return owner === teacherEmail;
  });

  return res.json({
    success: true,
    questions: filteredQuestions,
    revision: liveContentRevision,
  });
});

app.post("/api/teacher/question-bank", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "جلسة الأستاذ غير صالحة." });
  }

  const qData: Question = canonicalizeQuestionPayloadForTeacher(
    normalizeQuestionPayload(req.body),
    teacherEmail.toLowerCase(),
  ) as Question;
  qData.id = qData.id || "q-man-" + Math.random().toString(36).substring(2, 9);
  qData.isApproved = true;
  qData.isGenerated = qData.isGenerated || false;
  qData.teacherEmail = teacherEmail.toLowerCase();

  dbInstance.addQuestion(qData);
  if (!(await ensureDurableSync(res))) return;
  const revision = bumpLiveContentRevision();
  return res.json({ success: true, question: qData, revision });
});

app.put("/api/teacher/question-bank/:id", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "جلسة الأستاذ غير صالحة." });
  }

  const existing = dbInstance
    .getQuestionBank()
    .find((q: any) => String(q.id) === String(req.params.id));
  if (existing) {
    const owner = String(
      existing.teacherEmail || "ah.alfailakawi@paaet.edu.kw",
    ).toLowerCase();
    if (owner !== teacherEmail.toLowerCase() && !isAdminEmail(teacherEmail)) {
      return res.status(403).json({ error: "غير مصرح لك بتعديل هذا السؤال." });
    }
  }

  const payload = canonicalizeQuestionPayloadForTeacher(
    normalizeQuestionPayload({ ...req.body, id: req.params.id }),
    teacherEmail.toLowerCase(),
  );
  payload.teacherEmail = existing?.teacherEmail || teacherEmail.toLowerCase();

  dbInstance.updateQuestion(req.params.id, payload);
  if (!(await ensureDurableSync(res))) return;
  const updated = dbInstance
    .getQuestionBank()
    .find((q: any) => String(q.id) === String(req.params.id)) || {
    ...payload,
    id: req.params.id,
  };
  const revision = bumpLiveContentRevision();
  return res.json({ success: true, question: updated, revision });
});

app.delete("/api/teacher/question-bank/:id", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "جلسة الأستاذ غير صالحة." });
  }

  const existing = dbInstance
    .getQuestionBank()
    .find((q: any) => String(q.id) === String(req.params.id));
  if (existing) {
    const owner = String(
      existing.teacherEmail || "ah.alfailakawi@paaet.edu.kw",
    ).toLowerCase();
    if (owner !== teacherEmail.toLowerCase() && !isAdminEmail(teacherEmail)) {
      return res.status(403).json({ error: "غير مصرح لك بحذف هذا السؤال." });
    }
  }

  dbInstance.deleteQuestion(req.params.id);
  if (!(await ensureDurableSync(res))) return;
  const revision = bumpLiveContentRevision();
  return res.json({ success: true, revision });
});

// AI Generate exercise suggestions based on chapter topics
app.post("/api/teacher/textbook/generate-exercises", async (req, res) => {
  const { chapterId } = req.body;
  const chapter = dbInstance.getChapters().find((c) => c.id === chapterId);
  if (!chapter)
    return res.status(404).json({ error: "الفصل الدراسي غير موصوف" });

  let exercises: WeeklyExercise[] = [];

  if (false && aiInstance) {
    try {
      const prompt = `أنت أستاذ جامعي في التعلم التطبيقي والتقنيات الرقمية.
قم بتوليد تمرين أسبوعي تطبيقي ونقدي مشوق لطلبة المقرر بناءً على معطيات هذا الفصل المنهجي:
اسم الفصل: "${chapter.title}"
أهدافه وموضوعاته الأساسية: ${JSON.stringify(chapter.topics)}

تأكد من صياغة تمرين يعتمد على "سيناريو تفكيك واقعة حية لدمج التعليم الإلكتروني" أو "مقارنة حاسمة للأدوات التعليمية".
أرسل الرد بالتنسيق التالي كـ JSON صالح بالكامل ولا ترسل أي كلام توضيحي جانبي:
[
  {
    "title": "تمرين الأسبوع: عنوان مشوق وحيوي ملامس للتصميم",
    "type": "scenario",
    "promptText": "شرح كامل ومتقن ومثير لسيناريو المشكلة والمطلوب من الطالب تقديمه بالتفصيل وكيفية دمجه لمفاهيم الفصل"
  }
]`;

      const response = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const parsed = JSON.parse(response.text?.trim() || "[]");
      if (Array.isArray(parsed)) {
        exercises = parsed.map((item, index) => ({
          id: `ex-gen-${chapterId}-${Date.now()}-${index}`,
          chapterId,
          title: item.title || "تمرين نقدي مخصص",
          type: item.type || "scenario",
          promptText:
            item.promptText ||
            "سياق تمرين تطبيقي لحل مشاكل الفصل وتحسين بيئة دمج التقنية.",
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          isPersonalized: true,
        }));
      }
    } catch (e) {
      console.log(
        "Gemini exercise generation failed; no fallback exercises will be created.",
      );
    }
  }

  if (exercises.length === 0)
    return res
      .status(503)
      .json({
        error:
          "توليد التمارين غير متاح حالياً، ولم يتم إنشاء تمارين افتراضية أو تجريبية.",
      });

  // Return to frontend for review and activation
  return res.json({ success: true, exercises });
});

// Approve and Activate Weekly Exercise for all Students in Section
app.post("/api/teacher/exercises/activate", (req, res) => {
  const { exercise } = req.body; // Complete exercise object including details
  if (!exercise) return res.status(400).json({ error: "بيانات التمرين فارغة" });

  exercise.id =
    exercise.id || "ex-act-" + Math.random().toString(36).substring(2, 9);
  dbInstance.addWeeklyExercise(exercise);

  return res.json({ success: true, exercise });
});

// Get Audit Logs & Security warnings
app.get("/api/teacher/logs", (req, res) => {
  const teacherEmail = String(
    req.query.teacherEmail || req.headers["x-teacher-email"] || "",
  );
  // سقف: أحدث ٣٠٠ سجل فقط. السجل ينمو بلا حدود مع الاستخدام الفعلي (كل دخول
  // /محاولة/تسليم = سجل جديد)، وإرسال آلاف السجلات في كل تحميل كان يبطّئ الجوال
  // بشكل متصاعد. أحدث ٣٠٠ يكفي للمتابعة الحيّة ويبقي الحمولة صغيرة وثابتة.
  const all = withLiveStudentNames(filterLogsForTeacher(teacherEmail));
  const logs = Array.isArray(all)
    ? [...all]
        .sort(
          (a: any, b: any) =>
            new Date(b?.timestamp || 0).getTime() -
            new Date(a?.timestamp || 0).getTime(),
        )
        .slice(0, 300)
    : all;
  return res.json({ logs });
});

app.get("/api/teacher/password-reset-requests", (req, res) => {
  const teacherEmail = String(
    req.query.teacherEmail || req.headers["x-teacher-email"] || "",
  ).toLowerCase();
  const requests = withLiveStudentNames(
    dbInstance
      .getPasswordResetRequests()
      .filter(
        (item: any) =>
          !teacherEmail || canAccessPasswordResetRequest(item, teacherEmail),
      )
      .map(publicPasswordResetRequest),
  );
  return res.json({ success: true, requests });
});

app.post("/api/teacher/password-reset-requests/:id/resend", (req, res) => {
  const item = dbInstance
    .getPasswordResetRequests()
    .find((requestItem: any) => requestItem.id === req.params.id);
  if (!item) return res.status(404).json({ error: "طلب الاسترجاع غير موجود." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
    return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا الطلب." });
  const lastSentAt = new Date();
  const expiresAt = new Date(lastSentAt.getTime() + 60 * 60 * 1000);
  const resetToken = crypto.randomBytes(24).toString("hex");
  const verificationCode = makeJoinCode(
    "LAB",
    "",
    new Set([
      ...dbInstance
        .getPasswordResetRequests()
        .filter((requestItem: any) => requestItem.id !== item.id)
        .map((requestItem: any) =>
          compactJoinCode(requestItem.verificationCode),
        ),
      ...dbInstance
        .getOtps()
        .map((otpItem: any) => compactJoinCode(otpItem.code)),
      ...dbInstance
        .getJoinCodes()
        .map((joinItem: any) => compactJoinCode(joinItem.code)),
    ]),
  );
  const resetLink = buildResetLink(req, resetToken);
  const updates = {
    status: "new",
    resetToken,
    resetLink,
    verificationCode,
    lastSentAt: lastSentAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  } as any;
  dbInstance.updatePasswordResetRequest(item.id, updates);
  dbInstance.addActivityLog({
    studentId: item.studentId,
    studentName: item.studentName,
    action: "إعادة إصدار رابط الاسترجاع",
    details: `تم إنشاء رابط استرجاع جديد صالح لمدة ساعة. رقم الطلب: ${item.id}`,
    teacherEmail: item.teacherEmail,
    actorEmail: item.teacherEmail,
    sectionCode: item.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة الأستاذ",
    browser: "استرجاع كلمة المرور",
    isViolationWarning: false,
  });
  if (item.studentId)
    notifyStudent(
      item.studentId,
      "تم تحديث رابط إعادة التعيين",
      "راجع أستاذ المقرر للحصول على الرابط المؤقت الجديد.",
      { type: "password_reset_ready", link: "/" },
    );
  return res.json({
    success: true,
    request: publicPasswordResetRequest({ ...item, ...updates }),
  });
});

app.post(
  "/api/teacher/password-reset-requests/:id/manual-password",
  (req, res) => {
    const item = dbInstance
      .getPasswordResetRequests()
      .find((requestItem: any) => requestItem.id === req.params.id);
    if (!item)
      return res.status(404).json({ error: "طلب الاسترجاع غير موجود." });
    const teacherEmail = teacherEmailFromRequest(req);
    if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
      return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا الطلب." });
    const newPassword = String(req.body?.newPassword || "");
    if (isWeakDefaultPassword(newPassword))
      return res
        .status(400)
        .json({ error: "كلمة المرور الجديدة يجب ألا تقل عن 6 خانات ولا تكون افتراضية." });
    const student = dbInstance
      .getStudents()
      .find((s: any) => String(s.id) === String(item.studentId));
    if (!student)
      return res
        .status(404)
        .json({ error: "لا يوجد حساب طالب مرتبط بهذا الطلب." });
    const handledAt = new Date().toISOString();
    dbInstance.updateStudent(student.id, { passwordHash: hashPasswordSecure(newPassword) } as any);
    dbInstance.updatePasswordResetRequest(item.id, {
      status: "handled",
      handledAt,
    } as any);
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "تغيير كلمة المرور يدوياً",
      details: `قام صاحب النظام بتغيير كلمة مرور الطالب يدوياً دون كشف كلمة المرور القديمة. رقم الطلب: ${item.id}`,
      teacherEmail: item.teacherEmail,
      actorEmail: item.teacherEmail,
      sectionCode: student.sectionCode,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "لوحة الأستاذ",
      browser: "استرجاع كلمة المرور",
      isViolationWarning: false,
    });
    notifyTeachersForSection(
      student.sectionCode,
      "تغيير كلمة مرور يدوي",
      `${student.name}: تم تغيير كلمة المرور يدوياً من لوحة الأستاذ.`,
      { type: "manual_password_changed", studentId: student.id, link: "/" },
    );
    return res.json({ success: true });
  },
);

app.post("/api/teacher/password-reset-requests/:id/complete", (req, res) => {
  const item = dbInstance
    .getPasswordResetRequests()
    .find((requestItem: any) => requestItem.id === req.params.id);
  if (!item) return res.status(404).json({ error: "طلب الاسترجاع غير موجود." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
    return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا الطلب." });
  dbInstance.updatePasswordResetRequest(item.id, {
    status: "handled",
    handledAt: new Date().toISOString(),
  } as any);
  return res.json({ success: true });
});

app.delete("/api/teacher/password-reset-requests/:id", (req, res) => {
  const item = dbInstance
    .getPasswordResetRequests()
    .find((requestItem: any) => requestItem.id === req.params.id);
  if (!item) return res.status(404).json({ error: "طلب الاسترجاع غير موجود." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
    return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا الطلب." });
  dbInstance.deletePasswordResetRequest(req.params.id);
  return res.json({ success: true });
});

app.get("/api/teacher/exams", async (req, res) => {
  await dbInstance.initialSyncPromise;
  return res.json({ success: true, exams: activeTeacherExams() });
});

app.post("/api/teacher/exams", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const exam = req.body as TeacherExam;
  if (!exam?.title || !exam?.courseCode)
    return res.status(400).json({ error: "بيانات الاختبار ناقصة." });
  const rawTeacherEmail = teacherEmailFromRequest(req);
  if (!rawTeacherEmail)
    return res.status(401).json({ error: "جلسة الأستاذ غير صالحة." });
  const teacherEmail = rawTeacherEmail.toLowerCase();
  // لا نعتمد على وجود سجل تصنيف فقط؛ الأسئلة المستوردة أو القديمة قد تكون
  // محفوظة في السحابة مع اسم التصنيف/المقرر دون سجل chapter منفصل. معيار الإنشاء
  // الحقيقي هو وجود أسئلة سحابية مطابقة للمقرر/التصنيف أدناه.
  const now = new Date().toISOString();
  const savedQuestionsCount = Math.max(
    1,
    Math.floor(Number(exam.questionsCount) || 1),
  );
  const savedTimerMinutes = Math.max(
    1,
    Math.floor(
      Number(exam.antiCheat?.timerMinutes ?? (exam as any).timerMinutes) || 30,
    ),
  );
  const savedQuestionPoolCount = Math.max(
    savedQuestionsCount,
    Math.floor(
      Number(exam.antiCheat?.questionPoolCount) || savedQuestionsCount,
    ),
  );
  const selectedCategoriesForValidation = Array.isArray((exam as any).selectedCategories)
    ? (exam as any).selectedCategories.map(String).filter(Boolean)
    : [];
  const examQuestionsAvailable = activeQuestionBank().filter((q: any) =>
    questionMatchesOfficialExamServer(
      q,
      { ...exam, selectedCategories: selectedCategoriesForValidation },
      teacherEmail,
    ),
  );
  if (examQuestionsAvailable.length < savedQuestionsCount) {
    return res.status(400).json({
      error: `لا توجد أسئلة محفوظة كافية في السحابة لهذا المقرر أو التصنيف. المتاح ${examQuestionsAvailable.length} والمطلوب ${savedQuestionsCount}.`,
      availableQuestions: examQuestionsAvailable.length,
      requiredQuestions: savedQuestionsCount,
    });
  }

  const incomingReview = (exam as any).review || {};
  const saved: TeacherExam = {
    ...exam,
    id: exam.id || `exam-${Date.now()}`,
    points: Number(exam.points) || 1,
    questionsCount: savedQuestionsCount,
    antiCheat: {
      ...(exam.antiCheat || {}),
      questionPoolCount: savedQuestionPoolCount,
      timerMinutes: savedTimerMinutes,
    },
    review: {
      showGrade: incomingReview.showGrade === true,
      gradesReleased: incomingReview.gradesReleased === true,
      releasedAt: incomingReview.releasedAt,
    },
    createdAt: exam.createdAt || now,
    updatedAt: now,
  };
  const existedBefore = dbInstance
    .getTeacherExams()
    .some((item: any) => String(item.id) === String(saved.id));
  dbInstance.upsertTeacherExam(saved);
  if (!(await ensureDurableSync(res))) return;
  const revision = bumpLiveContentRevision();
  if (!existedBefore) {
    const noticeTitle = "اختبار جديد متاح";
    const noticeBody = `تم نشر ${saved.title} لمقرر ${saved.courseCode}`;
    rememberCourseNotification(
      saved.courseCode,
      noticeTitle,
      noticeBody,
      "exam_available",
      {
        examId: saved.id,
        courseCode: saved.courseCode,
        revision: String(revision),
        link: "/",
      },
    );
    notifyUsers(
      (token) =>
        token.role === "student" &&
        studentTokenHasCourse(token, saved.courseCode),
      noticeTitle,
      noticeBody,
      {
        type: "exam_available",
        examId: saved.id,
        courseCode: saved.courseCode,
        revision: String(revision),
        link: "/",
      },
    );
  }
  return res.json({
    success: true,
    exam: saved,
    revision: liveContentRevision,
  });
});

app.post("/api/teacher/exams/:id/remind", (req, res) => {
  const exam = dbInstance
    .getTeacherExams()
    .find((item: any) => String(item.id) === String(req.params.id));
  if (!exam) return res.status(404).json({ error: "الاختبار غير موجود." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (
    teacherEmail &&
    !isAdminEmail(teacherEmail) &&
    sectionOwnerEmail(exam.courseCode) !== teacherEmail &&
    String((exam as any).createdBy || "").toLowerCase() !== teacherEmail
  ) {
    return res
      .status(403)
      .json({ error: "لا تملك صلاحية إرسال تنبيه لهذا الاختبار." });
  }
  const requiresSeb = !!(
    (exam as any).seb?.enabled || (exam as any).sebEnabled
  );
  const openText = (exam as any).open
    ? new Date((exam as any).open).toLocaleString("en-GB", {
        timeZone: "Asia/Kuwait",
        hour12: false,
      })
    : "حسب موعد الأستاذ";
  // نستهدف كل طالب ملتحق بالمقرر لأغراض الإشعار (يشمل طلبة المعاد في المجموعات المغلقة).
  // لا نستخدم studentHasEnrollmentInCourse هنا لأنها تتطلب مقرراً مفتوحاً/غير موقوف،
  // فتستثني المعادين — وهو سبب عدم وصول تنبيه المعاد لهم سابقاً.
  const students = dbInstance
    .getStudents()
    .filter((student: any) =>
      studentEnrolledForNotifications(student, (exam as any).courseCode),
    );
  let count = 0;
  let pushCount = 0;
  students.forEach((student: any) => {
    const accountReady =
      student.isPaid || student.isActivated || student.activationCode
        ? "الحساب مفعل"
        : "الحساب يحتاج تفعيل";
    const deviceReady =
      Array.isArray(student.devices) && student.devices.length
        ? "الجهاز مسجل"
        : "افتح حسابك من جهازك قبل الاختبار";
    pushCount += notifyStudent(
      String(student.id),
      "تنبيه اختبار",
      `${(exam as any).title}: ${openText} • ${requiresSeb ? "يتطلب SEB" : "لا يتطلب SEB"} • ${accountReady} • ${deviceReady}`,
      {
        type: "exam_reminder",
        examId: String((exam as any).id || ""),
        courseCode: String((exam as any).courseCode || ""),
        link: "/",
      },
    );
    count += 1;
  });
  dbInstance.addActivityLog({
    action: "إرسال تنبيه اختبار",
    details: `تم إرسال تنبيه ${String((exam as any).title || "اختبار")} إلى ${count} طالب.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: String((exam as any).courseCode || ""),
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "لوحة تحكم الأستاذ",
    browser: "تنبيه الاختبار",
    isViolationWarning: false,
  });
  return res.json({ success: true, count, inAppCount: count, pushCount });
});

app.post("/api/teacher/exams/:id/release-grades", async (req, res) => {
  const exam = dbInstance
    .getTeacherExams()
    .find((item: any) => String(item.id) === String(req.params.id));
  if (!exam) return res.status(404).json({ error: "الاختبار غير موجود." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (
    teacherEmail &&
    !isAdminEmail(teacherEmail) &&
    sectionOwnerEmail(exam.courseCode) !== teacherEmail &&
    String((exam as any).createdBy || "").toLowerCase() !== teacherEmail
  ) {
    return res
      .status(403)
      .json({ error: "لا تملك صلاحية رصد درجات هذا الاختبار." });
  }
  const releasedAt = new Date().toISOString();
  const previousReview = examReviewSettings(exam);
  const review = {
    ...previousReview,
    showGrade: true,
    gradesReleased: true,
    releasedAt,
  };
  dbInstance.upsertTeacherExam({
    ...(exam as any),
    review,
    updatedAt: releasedAt,
  });
  const submissions = dbInstance
    .getTeacherSubmissions()
    .filter(
      (sub: any) =>
        sub.kind === "exam" && String(sub.activityId) === String(exam.id),
    );
  let notifiedStudents = 0;
  submissions.forEach((sub: any) => {
    const grade = String(sub.grade ?? sub.score ?? sub.visibleGrade ?? "");
    if (grade === "") return;
    dbInstance.upsertTeacherSubmission({
      ...sub,
      visibleGrade: grade,
      status: preserveSpecialExamStatusOnGradeRelease(sub.status)
        ? sub.status
        : EXAM_GRADED_STATUS,
      gradedAt: sub.gradedAt || releasedAt,
      updatedAt: releasedAt,
    });
    if (!previousReview.gradesReleased && sub.studentId) {
      const max =
        Number(sub.maxPoints ?? sub.points ?? (exam as any).points) || 0;
      const suffix = max ? `${grade} من ${max}` : grade;
      notifyStudent(
        String(sub.studentId),
        "تم نشر درجتك",
        `${(exam as any).title || "اختبار"}: ${suffix}`,
        {
          type: "grade_released",
          studentId: String(sub.studentId),
          activityId: String((exam as any).id || ""),
          kind: "exam",
          courseCode: String((exam as any).courseCode || ""),
          link: "/",
        },
      );
      notifiedStudents += 1;
    }
  });
  bumpLiveContentRevision();
  if (!(await ensureDurableSync(res))) return;
  return res.json({
    success: true,
    releasedAt,
    count: submissions.length,
    notifiedStudents,
    revision: liveContentRevision,
  });
});

app.delete("/api/teacher/exams/:id", async (req, res) => {
  const exam = dbInstance
    .getTeacherExams()
    .find((item: any) => String(item.id) === String(req.params.id));
  if (!exam) return res.status(404).json({ error: "الاختبار غير موجود." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (
    teacherEmail &&
    !isAdminEmail(teacherEmail) &&
    sectionOwnerEmail((exam as any).courseCode) !== teacherEmail &&
    String((exam as any).createdBy || "").toLowerCase() !== teacherEmail
  ) {
    return res.status(403).json({ error: "لا تملك صلاحية حذف هذا الاختبار." });
  }
  dbInstance.deleteTeacherExam(req.params.id);
  removeRuntimeTeacherSubmissionsFor("exam", req.params.id);
  dbInstance.removeQuizSubmissionsForChapter(req.params.id);
  // إغلاق أي جلسات SEB لا تزال نشطة لهذا الاختبار بعد حذفه، بدل تركها معلّقة.
  const remainingPasses = dbInstance.getSebAttempts().map((item: any) => {
    if (
      String(item.examId) === String(req.params.id) &&
      item.status !== "closed"
    ) {
      return {
        ...item,
        status: "closed",
        closedAt: Date.now(),
        closeReason: "exam-deleted",
      };
    }
    return item;
  });
  dbInstance.setSebAttempts(remainingPasses);
  const revision = bumpLiveContentRevision();
  if (!(await ensureDurableSync(res))) return;
  return res.json({ success: true, revision });
});

app.get("/api/teacher/projects", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const projects = activeRuntimeTeacherProjects().filter((project: any) => {
    if (!teacherEmail || isAdminEmail(teacherEmail)) return true;
    const code = String(project.courseCode || "");
    return (
      !code ||
      sectionOwnerEmail(code) === teacherEmail ||
      String(project.createdBy || "").toLowerCase() === teacherEmail
    );
  });
  return res.json({ success: true, projects });
});

app.post("/api/teacher/projects", async (req, res) => {
  const project = req.body || {};
  if (!project?.title || !project?.courseCode)
    return res.status(400).json({ error: "بيانات المشروع ناقصة." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (
    teacherEmail &&
    !isAdminEmail(teacherEmail) &&
    sectionOwnerEmail(project.courseCode) !== teacherEmail &&
    String(project.createdBy || "").toLowerCase() !== teacherEmail
  ) {
    return res
      .status(403)
      .json({ error: "لا يمكن نشر مشروع في مقرر لا تملكه." });
  }
  const now = new Date().toISOString();
  const existedBefore = dbInstance
    .getTeacherProjects()
    .some((item: any) => String(item.id) === String(project.id || ""));
  const saved = {
    ...project,
    id: project.id || `proj-${Date.now()}`,
    points: Number(project.points) || 1,
    status: project.status || "published",
    createdBy: project.createdBy || teacherEmail || "local-teacher",
    createdAt: project.createdAt || now,
    updatedAt: now,
  };
  dbInstance.upsertTeacherProject(saved);
  if (!(await ensureDurableSync(res))) return;
  const revision = bumpLiveContentRevision();
  if (!existedBefore) {
    const noticeTitle = "مشروع جديد متاح";
    const noticeBody = `تم نشر ${saved.title} لمقرر ${saved.courseCode}`;
    rememberCourseNotification(
      saved.courseCode,
      noticeTitle,
      noticeBody,
      "project_available",
      {
        projectId: saved.id,
        courseCode: saved.courseCode,
        revision: String(revision),
        link: "/",
      },
    );
    notifyUsers(
      (token) =>
        token.role === "student" &&
        studentTokenHasCourse(token, saved.courseCode),
      noticeTitle,
      noticeBody,
      {
        type: "project_available",
        projectId: saved.id,
        courseCode: saved.courseCode,
        revision: String(revision),
        link: "/",
      },
    );
  }
  return res.json({ success: true, project: saved });
});

app.delete("/api/teacher/projects/:id", async (req, res) => {
  const project = dbInstance
    .getTeacherProjects()
    .find((item: any) => String(item.id) === String(req.params.id));
  if (!project) return res.json({ success: true });
  const teacherEmail = teacherEmailFromRequest(req);
  if (
    teacherEmail &&
    !isAdminEmail(teacherEmail) &&
    sectionOwnerEmail(project.courseCode) !== teacherEmail &&
    String(project.createdBy || "").toLowerCase() !== teacherEmail
  ) {
    return res
      .status(403)
      .json({ error: "لا يمكن حذف مشروع في مقرر لا تملكه." });
  }
  dbInstance.deleteTeacherProject(req.params.id);
  const revision = bumpLiveContentRevision();
  removeRuntimeTeacherSubmissionsFor("project", req.params.id);
  rememberCourseNotification(
    project.courseCode,
    "حذف مشروع",
    `تم حذف ${project.title} من مقرر ${project.courseCode}`,
    "project_deleted",
    { projectId: project.id, courseCode: project.courseCode, link: "/" },
  );
  notifyUsers(
    (token) =>
      token.role === "student" &&
      studentTokenHasCourse(token, project.courseCode),
    "حذف مشروع",
    `تم حذف ${project.title} من مقرر ${project.courseCode}`,
    {
      type: "project_deleted",
      projectId: project.id,
      courseCode: project.courseCode,
      link: "/",
    },
  );
  if (!(await ensureDurableSync(res))) return;
  return res.json({ success: true, revision });
});

// إعادة مزامنة: لأي محاولة اختبار رسمية حالتها "started" في قاعدة البيانات
// (بما فيها محاولات بدأت قبل نشر هذا التحديث ولم يُسجَّل لها أي صف في شاشة
// التسليمات)، تأكد من وجود صف "دخل الاختبار - قيد الحل الآن" للأستاذ. هذا
// يضمن ظهور أي محاولة عالقة فوراً عند فتح شاشة التسليمات، حتى لو لم يحدث أي
// حدث بدء/خروج جديد بعد نشر هذا التحديث.
function syncInProgressExamSubmissions() {
  try {
    const exams = activeTeacherExams();
    dbInstance.getQuizSubmissions().forEach((sub: any) => {
      const exam = exams.find(
        (e: any) => String(e.id) === String(sub.chapterId),
      );
      if (!exam) return;
      const id = `exam-${exam.id}-${sub.studentId}`;
      const existing = dbInstance
        .getTeacherSubmissions()
        .find((item: any) => String(item.id) === id);
      const student = dbInstance
        .getStudents()
        .find((s: any) => String(s.id) === String(sub.studentId));
      const status = String(sub.status || "");

      if (status === "submitted") {
        if (String(existing?.status || "").trim() === "معاد للطالب") {
          const returnedTime = new Date(existing.returnedAt || 0).getTime();
          const submittedTime = new Date(
            sub.submittedAt || sub.resubmittedAt || 0,
          ).getTime();
          if (returnedTime > submittedTime) return;
        }
        const grade = String(sub.score ?? "");
        if (grade === "") return;
        const totalPoints =
          Number(sub.totalPoints || (exam as any).points || 20) || 20;
        const zeroReason = String(sub.zeroReason || "").trim();
        const finishReason = String(sub.finishReason || "").trim();
        const isCheatingAttemptExit =
          finishReason === EXAM_CHEATING_ATTEMPT_STATUS;
        const isWithdrawnOrExited =
          finishReason === EXAM_EXITED_BEFORE_SUBMIT_STATUS ||
          finishReason === EXAM_WITHDRAWN_STATUS ||
          (!!zeroReason && !isCheatingAttemptExit);
        const isInterruptedAttempt =
          isCheatingAttemptExit || isWithdrawnOrExited;
        const expectedWithdrawalStatus = isCheatingAttemptExit
          ? EXAM_CHEATING_ATTEMPT_STATUS
          : EXAM_WITHDRAWN_STATUS;
        const hasTeacherGradeOverride =
          existing?.teacherGradeOverride === true &&
          String(existing?.grade ?? existing?.visibleGrade ?? "").trim() !== "";
        const shouldRepair =
          !existing ||
          String(existing.status || "") === "معاد للطالب" ||
          String(existing.status || "") === EXAM_IN_PROGRESS_STATUS ||
          String(existing.answerText || "").includes(
            "دخل الطالب الاختبار وبدأت محاولته",
          ) ||
          (isInterruptedAttempt &&
            !hasTeacherGradeOverride &&
            String(existing.status || "") !== expectedWithdrawalStatus) ||
          (finishReason === EXAM_TIME_EXPIRED_STATUS &&
            String(existing.status || "") !== EXAM_TIME_EXPIRED_STATUS);
        if (!shouldRepair) return;

        const finalGrade = isCheatingAttemptExit ? "0" : grade;
        const finalAnswerText = isCheatingAttemptExit
          ? `حاول الطالب الغش (تبديل تطبيق أو شاشة) فتم إخراجه ورصدت درجاته الحالية: 0 من ${totalPoints}`
          : isWithdrawnOrExited
            ? `انسحب الطالب من الاختبار أو انقطعت جلسته، وتم رصد الدرجة التي وصل لها: ${finalGrade} من ${totalPoints}`
            : finishReason === EXAM_TIME_EXPIRED_STATUS
              ? `انتهى وقت الاختبار وتم تثبيت إجابات الطالب ورصد الدرجة: ${finalGrade} من ${totalPoints}`
              : `تم تسليم الاختبار بنجاح. الدرجة المحسوبة: ${finalGrade} من ${totalPoints}`;

        upsertRuntimeTeacherSubmission({
          ...(existing || {}),
          id,
          kind: "exam",
          activityId: exam.id,
          activityTitle: exam.title,
          courseCode: (exam as any).courseCode || sub.sectionCode,
          studentId: sub.studentId,
          studentName: student?.name || sub.studentName,
          answerText: finalAnswerText,
          grade: finalGrade,
          visibleGrade: canShowExamGradeToStudent(exam) ? finalGrade : "",
          totalPoints,
          serverSubmissionId: sub.id,
          status: isInterruptedAttempt
            ? expectedWithdrawalStatus
            : finishReason === EXAM_TIME_EXPIRED_STATUS
              ? EXAM_TIME_EXPIRED_STATUS
              : canShowExamGradeToStudent(exam)
                ? EXAM_GRADED_STATUS
                : EXAM_SUBMITTED_STATUS,
          submittedAt:
            sub.submittedAt ||
            existing?.submittedAt ||
            new Date().toISOString(),
          gradedAt:
            sub.submittedAt || existing?.gradedAt || new Date().toISOString(),
          exitWasOffline: isInterruptedAttempt
            ? !!sub.exitWasOffline
            : existing?.exitWasOffline,
        });
        return;
      }

      if (status !== "started") return;
      if (String(existing?.status || "").trim() === "معاد للطالب") {
        const returnedTime = new Date(existing.returnedAt || 0).getTime();
        const startedTime = new Date(
          sub.startedAt || sub.submittedAt || 0,
        ).getTime();
        if (returnedTime > startedTime) return;
      }
      // حارس نزاهة حاسم: لا تُحوّل صفّاً نهائياً للأستاذ (محاولة غش، انسحاب،
      // خروج قبل التسليم، انتهى الوقت، بانتظار/تم رصد الدرجة، أو درجة معتمدة
      // يدوياً) إلى "قيد الحل الآن" بسبب محاولة "started" عالقة على السيرفر.
      // هذا تحديداً سبب تحوّل "محاولة غش" إلى "يحل الآن" بعد إعادة فتح شاشة
      // التسليمات — خصوصاً بعد فتح إرجاع باستثناء زمني ثم غش الطالب. الإرجاع
      // الرسمي يحوّل الحالة إلى "معاد للطالب" (يُعالَج أعلاه)، لذا أي حالة
      // نهائية متبقية هنا يجب أن تبقى كما هي ولا تُطمَس.
      if (existing && isProtectedFinalExamStatus(existing)) return;
      const startedAt = new Date(
        sub.startedAt || sub.submittedAt || 0,
      ).getTime();
      const timerMinutes = Math.max(
        1,
        Number(
          (exam as any).antiCheat?.timerMinutes ?? (exam as any).timerMinutes,
        ) || 30,
      );
      const staleCutoffMs = (timerMinutes + 5) * 60 * 1000;
      const hasActiveSebPass = Array.from(getRuntimeSebPasses().values()).some(
        (pass: any) =>
          String(pass.studentId) === String(sub.studentId) &&
          String(pass.examId) === String(exam.id) &&
          String(pass.status) === "active" &&
          Number(pass.expiresAt || 0) > Date.now(),
      );
      if (
        Number.isFinite(startedAt) &&
        startedAt > 0 &&
        Date.now() - startedAt > staleCutoffMs &&
        !hasActiveSebPass
      ) {
        const studentForZero =
          student ||
          dbInstance
            .getStudents()
            .find((s: any) => String(s.id) === String(sub.studentId));
        if (studentForZero) {
          finalizeExamAttemptAsZero({} as express.Request, {
            student: studentForZero,
            exam,
            submission: sub,
            reason:
              "انتهى وقت محاولة الاختبار أو انقطعت جلسة SEB قبل التسليم؛ تم تثبيت الدرجة التي وصل لها الطالب.",
          });
        }
        return;
      }
      if (existing && String(existing.status || "") === EXAM_IN_PROGRESS_STATUS)
        return;
      upsertRuntimeTeacherSubmission({
        ...(existing || {}),
        id,
        kind: "exam",
        activityId: exam.id,
        activityTitle: exam.title,
        courseCode: (exam as any).courseCode || sub.sectionCode,
        studentId: sub.studentId,
        studentName: student?.name || sub.studentName,
        answerText:
          "دخل الطالب الاختبار وبدأت محاولته؛ الإجابات قيد الحل الآن.",
        status: EXAM_IN_PROGRESS_STATUS,
        submittedAt: sub.startedAt || new Date().toISOString(),
        grade: "",
        visibleGrade: "",
      });
    });
  } catch {}
}

app.get("/api/teacher/submissions", (req, res) => {
  syncInProgressExamSubmissions();
  const studentId = String(req.query.studentId || "").trim();
  const courseCode = String(req.query.courseCode || "").trim();
  let items = activeRuntimeTeacherSubmissions();
  if (studentId)
    items = items.filter(
      (item: any) => String(item.studentId || "") === studentId,
    );
  if (courseCode)
    items = items.filter((item: any) =>
      sectionCodeEquivalent(item.courseCode || item.sectionCode, courseCode),
    );
  return res.json({
    success: true,
    submissions: withLiveStudentNames(items),
    revision: liveContentRevision,
  });
});

app.post("/api/teacher/submissions", (req, res) => {
  try {
    const incoming = req.body || {};
    const incomingStudentId = String(incoming.studentId || "").trim();
    const incomingCourseCode = String(
      incoming.courseCode || incoming.sectionCode || "",
    ).trim();
    const incomingStudent = incomingStudentId
      ? dbInstance
          .getStudents()
          .find(
            (st: any) =>
              String(st.id) === incomingStudentId ||
              normalizeStudentId(st.id) ===
                normalizeStudentId(incomingStudentId),
          )
      : null;
    if (
      incomingStudent &&
      incomingCourseCode &&
      isStudentSuspendedInCourse(incomingStudent, incomingCourseCode)
    ) {
      return res
        .status(403)
        .json({
          error: "تم إيقاف دخولك لهذا المقرر مؤقتًا. يرجى مراجعة أستاذ المقرر.",
        });
    }
    const submission = upsertRuntimeTeacherSubmission(incoming);
    return res.json({
      success: true,
      submission,
      revision: liveContentRevision,
    });
  } catch (err: any) {
    if (String(err?.message || "").startsWith("GRADE_EXCEEDS_MAX")) {
      return res
        .status(400)
        .json({
          error: `لا يمكن إدخال درجة أعلى من الدرجة المقررة (${err.maxPoints}).`,
        });
    }
    return res.status(500).json({ error: "تعذر حفظ التسليم." });
  }
});

// تسليم الطالب لمشروعه/نشاطه من حساب الطالب. مسار مملوك للطالب يحفظ التسليم في
// نفس مخزون التسليمات الموحّد الذي يقرأ منه المعلم (activeRuntimeTeacherSubmissions)
// وكذلك حالة الطالب الحية (/api/live/student-state). لأن /api/teacher/submissions
// مقفل على جلسة المعلم، كان تسليم الطالب يفشل بصمت (401) فلا يراه المعلم وتعود
// المشاريع تظهر للطالب كأنه لم يسلّم. هنا نتحقق أن الطالب يسلّم باسمه فقط ونمنع
// أي تلاعب بالدرجات أو حالة "معاد/مرصود".
app.post("/api/student/submissions", (req, res) => {
  const incoming = req.body || {};
  const verifiedSession = verifyMirasSessionToken(req);
  const sessionStudentId =
    verifiedSession?.role === "student"
      ? normalizeStudentId(verifiedSession.userId)
      : "";
  if (!sessionStudentId) {
    return res.status(401).json({
      error: "STUDENT_SESSION_REQUIRED",
      code: "STUDENT_SESSION_REQUIRED",
    });
  }
  const incomingStudentId = normalizeStudentId(incoming.studentId);
  if (incomingStudentId && incomingStudentId !== sessionStudentId) {
    return res.status(403).json({ error: "لا يمكن التسليم نيابة عن طالب آخر." });
  }
  const kind = String(incoming.kind || "").trim().toLowerCase();
  if (kind !== "project" && kind !== "exercise") {
    return res.status(400).json({ error: "نوع التسليم غير مدعوم." });
  }
  const student = dbInstance
    .getStudents()
    .find((s: any) => normalizeStudentId(s.id) === sessionStudentId);
  if (!student) {
    return res.status(401).json({
      error: "STUDENT_SESSION_REQUIRED",
      code: "STUDENT_SESSION_REQUIRED",
    });
  }
  let courseCode = String(
    incoming.courseCode || incoming.sectionCode || "",
  ).trim();
  if (!courseCode && kind === "project") {
    const projectId = String(
      incoming.activityId || incoming.projectId || incoming.id || "",
    )
      .replace(/^project-/, "")
      .split("-")[0]
      .trim();
    const matchedProject = activeRuntimeTeacherProjects().find((project: any) =>
      String(project.id || "") === projectId ||
      String(incoming.activityId || "") === String(project.id || ""),
    );
    courseCode = String(
      matchedProject?.courseCode || matchedProject?.sectionCode || "",
    ).trim();
  }
  if (courseCode && isStudentSuspendedInCourse(student, courseCode)) {
    return res.status(403).json({
      error: "تم إيقاف دخولك لهذا المقرر مؤقتًا. يرجى مراجعة أستاذ المقرر.",
    });
  }
  const nowIso = new Date().toISOString();
  const requestedStatus = String(incoming.status || "").trim();
  const safeStatus =
    requestedStatus && !isReturnedSubmissionStatusServer(requestedStatus)
      ? requestedStatus
      : "مقفل بعد التسليم";
  // الطالب لا يضبط درجة لنفسه ولا يضع حالة "معاد/مرصود" — نُجبر الحقول الحسّاسة.
  const safeSubmission = {
    ...incoming,
    studentId: student.id,
    studentName: student.name || incoming.studentName || student.id,
    courseCode,
    grade: "",
    visibleGrade: "",
    score: "",
    teacherGrade: "",
    finalGrade: "",
    teacherGradeOverride: false,
    gradedAt: undefined,
    returnedAt: undefined,
    returnedByEmail: undefined,
    returnNote: undefined,
    status: safeStatus,
    submittedAt: incoming.submittedAt || nowIso,
    updatedAt: nowIso,
  };
  try {
    const submission = upsertRuntimeTeacherSubmission(safeSubmission);
    return res.json({
      success: true,
      submission,
      revision: liveContentRevision,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "تعذر حفظ التسليم." });
  }
});

app.post("/api/students/:id/activate-course", (req, res) => {
  const studentId = normalizeStudentId(req.params.id);
  const rawCode = normalizeArabicDigits(String(req.body?.code || "")).trim();
  if (!studentId || !rawCode) {
    return res.status(400).json({ error: "اكتب كود تفعيل المقرر أولاً." });
  }
  return processStudentCourseActivation(req, res, studentId, rawCode);
});

app.get("/api/live/student-state", (req, res) => {
  setNoCache(res);
  syncInProgressExamSubmissions();
  const studentId = normalizeStudentId(req.query.studentId);
  const isPublicStudentStatePreview = (req as any).mirasPublicStudentStatePreview === true;
  const student = dbInstance
    .getStudents()
    .find((s: any) => normalizeStudentId(s.id) === studentId);
  const requestedCourseCode = String(req.query.courseCode || "").trim();
  const enrollmentCodes = student ? getStudentActiveCourseCodes(student) : [];
  const discoveredCodes = student
    ? getStudentDiscoveredCourseCodes(student)
    : [];
  const visibleCodes = requestedCourseCode
    ? enrollmentCodes.filter((code) => sectionCodeEquivalent(code, requestedCourseCode))
    : enrollmentCodes;
  const allowed = (code: any) =>
    !!visibleCodes.length &&
    visibleCodes.some((c) => sectionCodeEquivalent(c, code));
  // الأقسام المُعادة للطالب تُحلّ عبر نفس الـ resolver الموحّد المستخدم في
  // enrollments (مطابقة تامة أو مكافئة بالرقم+المالك)، حتى لا يختفي اسم
  // المقرر ويظهر الرقم فقط إذا كان كود الطالب بصيغة قديمة/مركبة لا تطابق
  // كود القسم الحالي حرفياً بعد تعديل الاسم أو الرقم.
  const sections = activeSections()
    .filter((section: any) =>
      discoveredCodes.some(
        (code) =>
          String(code).toLowerCase() ===
            String(section.code || "").toLowerCase() ||
          sectionCodeEquivalent(section.code, code),
      ),
    );
  const exams = activeTeacherExams().filter((exam: any) =>
    allowed(exam.courseCode),
  );
  const projects = activeRuntimeTeacherProjects().filter((project: any) =>
    allowed(project.courseCode),
  );
  const submissions = activeRuntimeTeacherSubmissions().filter(
    (item: any) =>
      (!studentId || String(item.studentId || "") === studentId) &&
      allowed(item.courseCode),
  );
  const activatedForLiveStudent = student ? activatedCourseCodesForStudent(student) : [];
  const enrollments = student
    ? getStudentEnrollmentDetails(student).map((entry: any) =>
        // نُظهر المقرر المُفعّل نشطاً فوراً، لكن لا نتجاوز قرار المعلم: المقرر
        // المُغلق (isOpen=false) أو المعلّق (isSuspended) يبقى على حالته الحقيقية
        // ولا يُعرض "نشطاً" زوراً. (المقرر المُفعّل المفتوح يبقى نشطاً → ظهور فوري)
        entry.isOpen !== false &&
        entry.isSuspended !== true &&
        activatedForLiveStudent.some((code: any) =>
          sectionCodeEquivalent(code, entry.courseCode || entry.sectionCode),
        )
          ? {
              ...entry,
              status: "active",
              isActive: true,
              isLocked: false,
              isOpen: true,
              isClosedByTeacher: false,
              isSuspended: false,
            }
          : entry,
      )
    : [];
  const clientStudent = student ? sanitizeStudentForClient(student, enrollments) : undefined;
  const responseSections = activeSections().filter((section: any) =>
    enrollments.some((entry: any) =>
      sectionCodeEquivalent(section.code, entry.courseCode || entry.sectionCode || entry.studentSection),
    ),
  );
  if (isPublicStudentStatePreview) {
    const pendingOnlyEnrollments = enrollments.filter(
      (entry: any) => entry?.pendingActivation === true || entry?.requiresJoinCode === true,
    );
    return res.json({
      success: true,
      revision: liveContentRevision,
      serverTime: new Date().toISOString(),
      enrollments: pendingOnlyEnrollments,
      student: clientStudent
        ? {
            id: clientStudent.id,
            idNumber: clientStudent.id,
            enrollments: pendingOnlyEnrollments,
            activatedCourseCodes: [],
          }
        : undefined,
      studentName: undefined,
      sections: [],
      exams: [],
      projects: [],
      submissions: [],
    });
  }
  return res.json({
    success: true,
    revision: liveContentRevision,
    serverTime: new Date().toISOString(),
    enrollments,
    student: clientStudent,
    studentName: clientStudent ? clientStudent.name : undefined,
    sections: responseSections,
    exams,
    projects,
    submissions,
  });
});

// رسالة إرجاع قصيرة وواضحة حسب نوع النشاط — لا نستخدم عبارة عامة إذا كان
// النوع معروفاً (اختبار/مشروع).
function returnNoticeForKind(kind: any): { title: string; body: string } {
  const k = String(kind || "").toLowerCase();
  if (k === "exam" || k === "quiz")
    return { title: "إعادة اختبار", body: "تمت إتاحة الاختبار لك من جديد." };
  if (k === "project")
    return { title: "إعادة مشروع", body: "تمت إتاحة المشروع لك من جديد." };
  if (k === "exercise")
    return { title: "إعادة نشاط", body: "تمت إتاحة النشاط لك من جديد." };
  return { title: "إعادة تسليم", body: "تمت إتاحة العمل لك من جديد." };
}

app.post("/api/teacher/submissions/return", (req, res) => {
  const {
    kind,
    submissionId,
    projectId,
    studentId,
    activityId,
    teacherEmail,
    returnNote,
    returnExceptionUntil,
    returnExceptionHours,
    returnExceptionGrantedAt,
  } = req.body || {};
  const returnedAt = new Date().toISOString();
  const returnedByEmail = String(
    teacherEmail || req.headers["x-teacher-email"] || "",
  );
  const normalizedKind = String(kind || "").trim();
  const normalizedActivityId = String(activityId ?? projectId ?? "").trim();
  const normalizedStudentId = String(studentId ?? "").trim();
  const exceptionUntilMs = new Date(returnExceptionUntil || 0).getTime();
  const normalizedReturnExceptionUntil =
    Number.isFinite(exceptionUntilMs) && exceptionUntilMs > Date.now()
      ? new Date(exceptionUntilMs).toISOString()
      : "";
  const normalizedReturnExceptionHours =
    normalizedReturnExceptionUntil &&
    Number.isFinite(Number(returnExceptionHours))
      ? Math.max(1, Math.min(24, Number(returnExceptionHours)))
      : "";

  // Update the matching record in runtimeTeacherSubmissions so the returned status is
  // reflected to both the teacher's submissions screen and the student's live state.
  // Without this, the teacher's UI only shows the change optimistically/locally, and the
  // student (and a fresh page load for the teacher) keep seeing the old locked status,
  // because the "إرجاع" button only ever updated dbInstance, not runtimeTeacherSubmissions.
  // ضمان وصول إشعار الإرجاع للطالب في كل الحالات. سابقاً كان الإشعار يُرسل فقط عند وجود
  // صف مطابق في شاشة التسليمات؛ فإن لم يوجد (شائع مع الاختبارات العادية وطلبة المعاد) كان
  // الأستاذ يرى "تم" بينما لا يصل الطالب أي شيء. الآن نرسل إشعاراً واحداً مضموناً مهما كان المسار.
  let returnNotified = false;
  const returnActivityTitle =
    (
      dbInstance
        .getTeacherExams()
        .find((e: any) => String(e.id) === normalizedActivityId) as any
    )?.title ||
    (
      dbInstance
        .getPersonalizedProjects()
        .find(
          (p: any) => String(p.id) === String(projectId || activityId),
        ) as any
    )?.title ||
    "نشاط";
  const ensureReturnNotice = (courseCode: string) => {
    if (returnNotified || !normalizedStudentId) return;
    const notice = returnNoticeForKind(normalizedKind || kind);
    notifyStudent(normalizedStudentId, notice.title, notice.body, {
      type: "submission_returned",
      studentId: normalizedStudentId,
      activityId: normalizedActivityId,
      kind: normalizedKind || String(kind || ""),
      courseCode: String(courseCode || ""),
      link: "/",
    });
    returnNotified = true;
  };
  if (normalizedKind && normalizedActivityId && normalizedStudentId) {
    const subs = dbInstance.getTeacherSubmissions();
    const matchIdx = subs.findIndex(
      (item: any) =>
        (submissionId &&
          (String(item.id) === String(submissionId) ||
            String(item.serverSubmissionId || "") === String(submissionId))) ||
        (String(item.kind || "") === normalizedKind &&
          String(item.activityId ?? "") === normalizedActivityId &&
          String(item.studentId ?? "") === normalizedStudentId),
    );
    if (matchIdx !== -1) {
      const currentSub = subs[matchIdx];
      const shouldPreserveReturnedExamAnswers = false;
      const returnedPreservedAnswers =
        currentSub.answers && Object.keys(currentSub.answers || {}).length
          ? currentSub.answers
          : currentSub.previousAnswers || {};
      const returnedPreservedMatchedQuestions = Array.isArray(
        currentSub.matchedQuestions,
      )
        ? currentSub.matchedQuestions
        : currentSub.previousMatchedQuestions || [];

      const updatedSub = {
        ...currentSub,
        status: EXAM_RETURNED_STATUS,
        previousStatus: currentSub.status || currentSub.previousStatus || "",
        previousAnswerText:
          currentSub.answerText || currentSub.previousAnswerText || "",
        grade: "",
        visibleGrade: "",
        score: "",
        teacherGrade: "",
        finalGrade: "",
        teacherGradeOverride: false,
        gradedAt: undefined,
        previousServerSubmissionId:
          currentSub.serverSubmissionId ||
          currentSub.previousServerSubmissionId ||
          "",
        serverSubmissionId: undefined,
        previousGrade: String(
          currentSub.grade ??
            currentSub.score ??
            currentSub.visibleGrade ??
            currentSub.previousGrade ??
            "",
        ),
        previousVisibleGrade: String(
          currentSub.visibleGrade ??
            currentSub.grade ??
            currentSub.score ??
            currentSub.previousVisibleGrade ??
            "",
        ),
        previousTotalPoints:
          currentSub.totalPoints ??
          currentSub.maxPoints ??
          currentSub.points ??
          currentSub.previousTotalPoints ??
          "",
        previousAnswers: returnedPreservedAnswers,
        previousMatchedQuestions: returnedPreservedMatchedQuestions,
        answers: shouldPreserveReturnedExamAnswers ? returnedPreservedAnswers : {},
        matchedQuestions: shouldPreserveReturnedExamAnswers
          ? returnedPreservedMatchedQuestions
          : [],
        answerText: "تم إرجاع النشاط للطالب؛ المحاولة مفتوحة من جديد.",
        returnedAt,
        returnedByEmail,
        returnExceptionUntil: normalizedReturnExceptionUntil,
        returnExceptionHours: normalizedReturnExceptionHours,
        returnExceptionGrantedAt: normalizedReturnExceptionUntil
          ? returnExceptionGrantedAt || returnedAt
          : "",
        returnExceptionByEmail: normalizedReturnExceptionUntil
          ? returnedByEmail
          : "",
        returnNote,
        updatedAt: returnedAt,
      };
      dbInstance.upsertTeacherSubmission(updatedSub);
      bumpLiveContentRevision();
      const inlineNotice = returnNoticeForKind(normalizedKind);
      notifyStudent(
        normalizedStudentId,
        inlineNotice.title,
        inlineNotice.body,
        {
          type: "submission_returned",
          studentId: normalizedStudentId,
          activityId: normalizedActivityId,
          kind: normalizedKind,
          courseCode: String(updatedSub.courseCode || ""),
          link: "/",
        },
      );
      returnNotified = true;
      dbInstance.addActivityLog({
        studentId: normalizedStudentId,
        studentName: String(updatedSub.studentName || ""),
        action: "إرجاع محاولة للطالب",
        details: `${updatedSub.activityTitle || "نشاط"} — تم الإرجاع من شاشة التسليمات.`,
        teacherEmail: returnedByEmail,
        actorEmail: returnedByEmail,
        sectionCode: String(updatedSub.courseCode || ""),
        ip: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "Unknown",
        os: "لوحة تحكم الأستاذ",
        browser: "سجل إنصاف",
        isViolationWarning: false,
      });
    }
  }

  if (kind === "exercise") {
    const sub = dbInstance
      .getExerciseSubmissions()
      .find(
        (s: any) =>
          String(s.id) === String(submissionId) ||
          (String(s.studentId) === String(studentId) &&
            String(s.exerciseId) === String(activityId)),
      );
    if (!sub)
      return res.status(404).json({ error: "لم يتم العثور على تسليم النشاط." });
    dbInstance.updateExerciseSubmission(sub.id, {
      status: "returned",
      returnedAt,
      returnedByEmail,
      returnNote,
    });
    ensureReturnNotice(
      String((sub as any).sectionCode || (sub as any).courseCode || ""),
    );
    return res.json({ success: true, status: "returned" });
  }

  if (kind === "quiz" || kind === "exam") {
    const sub = dbInstance
      .getQuizSubmissions()
      .find(
        (s: any) =>
          String(s.id) === String(submissionId) ||
          (String(s.studentId) === String(studentId) &&
            String(s.chapterId) === String(activityId)),
      );
    if (sub) {
      const shouldPreserveReturnedQuizAnswers =
        isCheatingAttemptSubmissionServer(sub) ||
        String((sub as any).finishReason || "").trim() ===
          EXAM_CHEATING_ATTEMPT_STATUS;
      const preservedMatchedQuestions =
        (sub as any).matchedQuestions ||
        (sub as any).previousMatchedQuestions ||
        [];
      const preservedGeneratedQuestionIds =
        (sub as any).generatedQuestionIds ||
        (sub as any).previousGeneratedQuestionIds ||
        [];
      dbInstance.updateQuizSubmission(sub.id, {
        status: "returned",
        returnedAt,
        returnedByEmail,
        returnNote,
        previousMatchedQuestions: preservedMatchedQuestions,
        previousGeneratedQuestionIds: preservedGeneratedQuestionIds,
        matchedQuestions: shouldPreserveReturnedQuizAnswers
          ? preservedMatchedQuestions
          : [],
        generatedQuestionIds: shouldPreserveReturnedQuizAnswers
          ? preservedGeneratedQuestionIds
          : [],
        generatedQuestions: shouldPreserveReturnedQuizAnswers
          ? ((sub as any).generatedQuestions || [])
          : [],
        score: shouldPreserveReturnedQuizAnswers ? (sub as any).score : 0,
        totalPoints: shouldPreserveReturnedQuizAnswers
          ? (sub as any).totalPoints
          : 0,
        returnExceptionUntil: normalizedReturnExceptionUntil,
        returnExceptionHours: normalizedReturnExceptionHours,
        returnExceptionGrantedAt: normalizedReturnExceptionUntil
          ? returnExceptionGrantedAt || returnedAt
          : "",
        returnExceptionByEmail: normalizedReturnExceptionUntil
          ? returnedByEmail
          : "",
        zeroReason: shouldPreserveReturnedQuizAnswers
          ? (sub as any).zeroReason
          : undefined,
        finishReason: shouldPreserveReturnedQuizAnswers
          ? (sub as any).finishReason
          : undefined,
      } as any);
    }
    // حتى لو لم يوجد صف quizSubmissions مطابق (بعض الاختبارات العادية تُحفظ فقط في شاشة التسليمات)،
    // يكفي أن يكون صف teacherSubmissions قد وُسم كمعاد أعلاه حتى يظهر الكرت للطالب وتُفتح محاولة جديدة.
    const returnedExam = dbInstance
      .getTeacherExams()
      .find((e: any) => String(e.id) === normalizedActivityId);
    ensureReturnNotice(
      String(
        (sub as any)?.sectionCode ||
          (sub as any)?.courseCode ||
          (returnedExam as any)?.courseCode ||
          "",
      ),
    );
    return res.json({ success: true, status: "returned" });
  }

  const project = dbInstance
    .getPersonalizedProjects()
    .find((p: any) => String(p.id) === String(projectId || activityId));
  if (project) {
    dbInstance.updatePersonalizedProject(project.id, {
      status: "returned",
      returnedAt,
      returnedByEmail,
      returnNote,
      returnExceptionUntil: normalizedReturnExceptionUntil,
      returnExceptionHours: normalizedReturnExceptionHours,
      returnExceptionGrantedAt: normalizedReturnExceptionUntil
        ? returnExceptionGrantedAt || returnedAt
        : "",
      returnExceptionByEmail: normalizedReturnExceptionUntil
        ? returnedByEmail
        : "",
    });
  } else if (normalizedKind !== "project") {
    return res.status(404).json({ error: "لم يتم العثور على المشروع." });
  }
  ensureReturnNotice(
    String((project as any)?.courseCode || (project as any)?.sectionCode || ""),
  );
  return res.json({ success: true, status: "returned" });
});

// Get System Statistics and progress reports
app.get("/api/teacher/reports", (req, res) => {
  setNoCache(res);
  try {
  const students = dbInstance.getStudents();
  const allowed = dbInstance.getAllowedStudents();
  const projects = dbInstance.getPersonalizedProjects();
  const submissions = dbInstance.getQuizSubmissions();
  const logs = dbInstance.getActivityLogs();

  const totalRegistered = students.length;
  const totalAllowed = allowed.length;
  const percentCompleted =
    totalRegistered > 0
      ? Math.floor(
          students.reduce((acc, s) => acc + s.progress, 0) / totalRegistered,
        )
      : 0;

  // Calculate device violation alerts
  const deviceViolationCount = logs.filter(
    (l) => l.action === "انتهاك الأجهزة" || l.isViolationWarning,
  ).length;

  // Students that are struggling with score
  const inactiveOrStruggling = students
    .filter((s) => s.progress < 20 || s.score < 5)
    .map((s) => ({
      id: s.id,
      name: s.name,
      section: s.sectionCode,
      progress: s.progress,
      score: s.score,
      lastLogin: s.lastLoginDate,
    }));

  const teacherEmail = teacherEmailFromRequest(req);
  const teacherChapters = dbInstance
    .getChapters()
    .filter(
      (c) =>
        c.teacherEmail &&
        c.teacherEmail.toLowerCase() === teacherEmail.toLowerCase(),
    );

  const chapterStats = teacherChapters.map((chapter) => {
    const chapterQuizzes = submissions.filter(
      (q) => q.chapterId === chapter.id,
    );
    const avgScore =
      chapterQuizzes.length > 0
        ? Math.floor(
            chapterQuizzes.reduce(
              (acc, q) => acc + (q.score / q.totalPoints) * 100,
              0,
            ) / chapterQuizzes.length,
          )
        : 80;
    return {
      chapterId: chapter.id,
      title: chapter.title,
      attemptsCount: chapterQuizzes.length,
      averageScorePercent: avgScore,
    };
  });

  const includeAll = String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
  const teacherSections = activeSections()
    .filter(
      (sec: any) =>
        includeAll ||
        !teacherEmail ||
        sectionOwnerEmail(sec.code) === teacherEmail,
    );
  const teacherSectionCodes = new Set(
    teacherSections.map((sec: any) => String(sec.code || "").toLowerCase()),
  );
  const ownsCourse = (courseCode: any) => {
    if (includeAll || !teacherEmail) return true;
    const code = String(courseCode || "").trim();
    if (!code) return false;
    if (teacherSectionCodes.has(code.toLowerCase())) return true;
    if (teacherOwnsCourseCode(code, teacherEmail)) return true;
    return teacherSections.some((sec: any) => sectionCodeEquivalent(sec.code, code));
  };
  const reportStudents = dbInstance
    .getStudents()
    .map((student: any) => {
      const enrollments = getStudentEnrollmentDetails(student).filter((entry: any) =>
        ownsCourse(entry.courseCode || entry.sectionCode),
      );
      return { ...student, enrollments };
    })
    .filter((student: any) => includeAll || !teacherEmail || student.enrollments.length > 0 || ownsCourse(student.sectionCode));

  return res.json({
    totalRegistered,
    totalAllowed,
    percentCompleted,
    deviceViolationCount,
    inactiveOrStruggling,
    chapterStats,
    students: reportStudents,
    allowedStudents: dbInstance
      .getAllowedStudents()
      .filter((row: any) => ownsCourse(row.sectionCode || row.courseCode)),
  });
  } catch (err: any) {
    console.error("teacher reports failed", err);
    return res.json({
      totalRegistered: 0,
      totalAllowed: 0,
      percentCompleted: 0,
      deviceViolationCount: 0,
      inactiveOrStruggling: [],
      chapterStats: [],
      students: [],
      allowedStudents: [],
      warning: "تعذر تجميع تقرير الطلبة مؤقتاً دون استخدام بيانات محلية قديمة.",
    });
  }
});

app.get("/api/teacher/miras-export", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });
  const payload = buildMirasBackupPayload(
    teacherEmail,
    String(req.query.scope || "me"),
  );
  return res.json({ success: true, payload });
});

app.post("/api/teacher/miras-import", async (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "جلسة الأستاذ غير واضحة." });
  try {
    const requestedOwner = String(req.body?.targetOwnerEmail || teacherEmail)
      .trim()
      .toLowerCase();
    const targetOwnerEmail = isAdminEmail(teacherEmail)
      ? requestedOwner
      : teacherEmail;
    const preserveOwners =
      isAdminEmail(teacherEmail) &&
      String(req.body?.preserveOwners || "") === "1";
    const prepared = prepareMirasImportData(
      req.body?.payload,
      targetOwnerEmail,
      preserveOwners,
    );
    const summary = dbInstance.mergeBackupData(prepared);
    bumpLiveContentRevision();
    dbInstance.addActivityLog({
      action: "استيراد نسخة احتياطية",
      details: `تم دمج نسخة مِراس الاحتياطية داخل حساب ${preserveOwners ? "مع الحفاظ على الملاك الأصليين" : targetOwnerEmail}.`,
      teacherEmail: targetOwnerEmail,
      actorEmail: teacherEmail,
      sectionCode: "",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "لوحة تحكم الأستاذ",
      browser: "Data Vault",
      isViolationWarning: false,
    });
    if (!(await ensureDurableSync(res))) return;
    return res.json({ success: true, summary, revision: liveContentRevision });
  } catch {
    return res
      .status(400)
      .json({ error: "ملف النسخة الاحتياطية غير صالح أو غير قابل للاستيراد." });
  }
});

// Seed data or initial setup route
app.post("/api/teacher/seed-allowed-list", (req, res) => {
  return res
    .status(410)
    .json({
      error:
        "تم تعطيل إنشاء البيانات التجريبية الافتراضية. ارفع كشف الطلاب الحقيقي من لوحة الإدارة.",
    });
});

// Custom Reset (Student data and operations only)
app.post("/api/teacher/database/custom-reset", (req, res) => {
  const teacherEmail = String(
    req.body?.teacherEmail || req.headers["x-teacher-email"] || "",
  ).toLowerCase();
  const teacher = dbInstance
    .getTeachers()
    .find((t) => t.email.toLowerCase() === teacherEmail);
  if (!teacher) {
    return res.status(403).json({ error: "حساب المعلم غير معروف." });
  }

  try {
    const ownedCourseCodes = dbInstance
      .getSections()
      .filter((section: any) => {
        const owner = String(section.ownerEmail || sectionOwnerEmail(section.code) || "").toLowerCase();
        return owner === teacherEmail;
      })
      .map((section: any) => String(section.code || "").trim())
      .filter(Boolean);
    const ownedSet = new Set(ownedCourseCodes.map((code: any) => String(code).toLowerCase()));
    const studentIds = dbInstance
      .getStudents()
      .filter((student: any) => {
        const codes = getStudentDiscoveredCourseCodes(student);
        return codes.some((code: any) => ownedSet.has(String(code).toLowerCase())) ||
          String(sectionOwnerEmail(student.sectionCode || "")).toLowerCase() === teacherEmail;
      })
      .map((student: any) => String(student.id));
    const summary = (dbInstance as any).cleanseTeacherStudentData(studentIds, teacher.email);
    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: isAdminEmail(teacherEmail) ? "تطهير فصول السوبر أدمن فقط" : "تطهير بيانات المعلم بالكامل",
      details: `تم حذف بيانات الحساب الخاصة فقط: ${summary.removedSections} مقرر/فصل، ${summary.removedStudents} طالب، ${summary.removedOperations} عملية، ${summary.removedQuestions} سؤال، ${summary.removedExercises} واجب، مع عدم لمس مفاتيح/أكواد الدخول نهائياً (${summary.preservedJoinCodes} كود محفوظ).`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "متصفح",
      browser: "لوحة التحكم",
      isViolationWarning: false,
    });
    return res.json({
      success: true,
      message: `تم تطهير بيانات حسابك فقط: حذف ${summary.removedSections} مقرر/فصل، ${summary.removedStudents} طالب، ${summary.removedOperations} عملية، ${summary.removedQuestions} سؤال، ${summary.removedExercises} واجب. لم يتم لمس أكواد الدخول نهائياً.`,
      summary,
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: "فشل في عملية التصفير: " + error.message });
  }
});

// Full Reset (Wipe everything including curriculum and questions)
app.post("/api/teacher/database/full-reset", (req, res) => {
  const teacherEmail = String(
    req.body?.teacherEmail || req.headers["x-teacher-email"] || "",
  ).toLowerCase();
  const teacher = dbInstance
    .getTeachers()
    .find((t) => t.email.toLowerCase() === teacherEmail);
  if (!teacher || !isAdminEmail(teacherEmail)) {
    return res.status(403).json({ error: "هذا الإجراء مخصص للسوبر أدمن فقط." });
  }

  try {
    const archivedBefore = archivedJoinCodesCount();
    dbInstance.fullReset(teacher.email);
    const archivedAdded = Math.max(
      0,
      archivedJoinCodesCount() - archivedBefore,
    );

    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: "تصفير شامل وكامل لقاعدة البيانات",
      details: `تم تنفيذ التصفير الكامل والشامل مع حفظ أرشيف الأكواد ومنع إعادة استخدامها؛ أُضيف ${archivedAdded} كوداً للأرشيف.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "متصفح",
      browser: "لوحة التحكم",
      isViolationWarning: false,
    });

    return res.json({
      success: true,
      message: archivedAdded
        ? `تم التصفير الشامل بنجاح، وأُرشِف ${archivedAdded} كوداً لمنع تكرارها مستقبلاً.`
        : "تم التصفير الشامل والكامل بنجاح، وأرشيف الأكواد محفوظ كما هو.",
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: "فشل في عملية التصفير الشامل: " + error.message });
  }
});

// Configure Vite middleware or serve static dist directory
async function bootstrap() {
  console.log("⏳ Waiting for database initial sync with cloud Firestore...");
  try {
    await dbInstance.initialSyncPromise;
    console.log("✅ Database initial sync completed successfully.");
    await migrateEmbeddedSubmissionAttachments();
  } catch (err) {
    console.error(
      "⚠️ Database initial sync encountered an error, booting server anyway:",
      err,
    );
  }

  if (
    process.env.NODE_ENV === "production"
  ) {
    // Serve static files from react dist folder
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      // Falls back to empty React dev initialization if dist is un-compiled yet
      app.get("/", (req, res) => {
        res.send(
          "مِراس: المنصة قيد البناء والتجهيز. يرجى إعادة تشغيل الحزم المترجمة.",
        );
      });
    }
  } else {
    // Vite Integration for single-process development at Port 3000
    const distPath = path.join(process.cwd(), "dist");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith("/api")) {
        return next();
      }
      try {
        let template = fs.readFileSync(
          path.resolve(process.cwd(), "index.html"),
          "utf-8",
        );
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Living Book Lab Server active at http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start Living Book Lab Server:", err);
});
