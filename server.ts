import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import fileUpload from "express-fileupload";
import crypto from "crypto";
import dotenv from "dotenv";
import QRCode from "qrcode";
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
  getRuntimeAuthChallenge,
  setRuntimeAuthChallenge,
  deleteRuntimeAuthChallenge,
  mutateRuntimeAuthChallenge,
  cleanupRuntimeAuthChallenges,
} from "./src/server/db.js";
import type { SharingRingGraph } from "./src/shared/types";
import {
  buildAdaptiveTutorDraft,
  buildCourseUnderstandingDraft,
  buildRubricFeedbackDraft,
  buildTeacherLearningSummary,
  buildVivaDraft,
  MIRAS_LEARNING_DECISION_BOUNDARY_AR,
  stripUnsafeLearningDecisionFields,
} from "./src/features/learning-intelligence/core.js";

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
const PORT = 3000;

const PASSKEY_RP_NAME = "Ù…ÙØ±Ø§Ø³";
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

type PublicDeviceLoginStatus = "pending" | "approved" | "delivered";
type PendingPublicDeviceLogin = {
  id: string;
  teacherEmail: string;
  teacherName: string;
  appOrigin: string;
  desktopSecretHash: string;
  approvalSecretHash: string;
  desktopDeviceHash: string;
  desktopLabel: string;
  pairingCode: string;
  startedAt: number;
  expiresAt: number;
  status: PublicDeviceLoginStatus;
  approvedAt?: number;
  approvedCredentialId?: string;
  deliveredAt?: number;
  sessionIssuedAt?: number;
  sessionExpiresAt?: number;
  approvalChallenge?: string;
  approvalChallengeStartedAt?: number;
  purgeAt: number;
};
const publicDeviceStartBuckets = new Map<
  string,
  { count: number; windowStartedAt: number }
>();
const PUBLIC_DEVICE_LOGIN_TTL_MS = 2 * 60 * 1000;
const PUBLIC_DEVICE_DELIVERY_GRACE_MS = 45 * 1000;
const PUBLIC_DEVICE_START_WINDOW_MS = 5 * 60 * 1000;
const PUBLIC_DEVICE_START_MAX = 8;
const PUBLIC_DEVICE_TEACHER_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const PUBLIC_DEVICE_ADMIN_SESSION_TTL_MS = 60 * 60 * 1000;
const MIRAS_PUBLIC_LOGIN_DEFAULT_ORIGINS = new Set([
  "https://mirasedu.web.app",
  "https://mirasedu.firebaseapp.com",
  "https://meras-320eb.web.app",
  "https://meras-320eb.firebaseapp.com",
]);

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
  publicDeviceSession?: boolean;
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

function transientCookieOptions(req: express.Request) {
  const secure = String(
    req.headers["x-forwarded-proto"] || req.protocol || "",
  ).includes("https");
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
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

function createMirasSessionToken(session: Omit<MirasVerifiedSession, "issuedAt" | "expiresAt"> & { ttlMs?: number; issuedAt?: number }) {
  const issuedAt = Number(session.issuedAt || 0) || Date.now();
  const expiresAt = issuedAt + (session.ttlMs || MIRAS_SESSION_TTL_MS);
  const payload = base64urlEncode(JSON.stringify({
    role: session.role,
    userId: String(session.userId || ""),
    email: session.email ? String(session.email).toLowerCase() : undefined,
    deviceTokenHash: session.deviceTokenHash || undefined,
    publicDeviceSession: session.publicDeviceSession === true || undefined,
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

function verifyMirasSessionTokenValue(
  tokenValue: any,
  context = "session token",
): MirasVerifiedSession | null {
  const token = String(tokenValue || "").trim();
  if (!token) return null;
  if (!token.includes(".")) {
    console.warn(`[AUTH_DEBUG] Invalid token format (no dot): ${context}`);
    return null;
  }
  const [payload, sig] = token.split(".");
  if (!payload || !sig) {
    console.warn(`[AUTH_DEBUG] Missing payload or signature: ${context}`);
    return null;
  }
  const computedSig = signMirasPayload(payload);
  if (computedSig !== sig) {
    console.warn(`[AUTH_DEBUG] Signature mismatch for ${context}. Expected: ${computedSig}, Got: ${sig}`);
    return null;
  }
  try {
    const parsed = JSON.parse(base64urlDecode(payload));
    if (!parsed) {
      console.warn(`[AUTH_DEBUG] Failed to parse payload: ${context}`);
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
      publicDeviceSession: parsed.publicDeviceSession === true,
      issuedAt: Number(parsed.issuedAt || 0),
      expiresAt: Number(parsed.expiresAt || 0),
    };
  } catch (err: any) {
    console.warn(`[AUTH_DEBUG] Exception during token verification: ${err?.message || err}`);
    return null;
  }
}

function verifyMirasSessionToken(req: express.Request): MirasVerifiedSession | null {
  const token = readBearerToken(req);
  if (!token) {
    console.warn(`[AUTH_DEBUG] No token found in request: ${req.method} ${req.path}`);
    return null;
  }
  const session = verifyMirasSessionTokenValue(
    token,
    `${req.method} ${req.path}`,
  );
  if (!session) return null;
  if (session.publicDeviceSession) {
    const currentDeviceToken = getRequestDeviceToken(req);
    if (
      !currentDeviceToken ||
      !session.deviceTokenHash ||
      hashMirasValue(currentDeviceToken) !== session.deviceTokenHash
    )
      return null;
  }
  return session;
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

function buildPublicDeviceTeacherAuthPayload(
  req: express.Request,
  teacher: any,
  sessionIssuedAt?: number,
) {
  const rawDevice = getRequestDeviceToken(req);
  const ttlMs = isAdminEmail(teacher?.email)
    ? PUBLIC_DEVICE_ADMIN_SESSION_TTL_MS
    : PUBLIC_DEVICE_TEACHER_SESSION_TTL_MS;
  const authToken = createMirasSessionToken({
    role: isAdminEmail(teacher?.email) ? "admin" : "teacher",
    userId: String(teacher?.email || teacher?.id || "").toLowerCase(),
    email: String(teacher?.email || "").toLowerCase(),
    deviceTokenHash: rawDevice ? hashMirasValue(rawDevice) : undefined,
    publicDeviceSession: true,
    ttlMs,
    issuedAt: sessionIssuedAt,
  });
  const verified = verifyMirasSessionTokenValue(
    authToken,
    "public device teacher session",
  );
  return { authToken, expiresAt: verified?.expiresAt || Date.now() + ttlMs };
}

function attachPublicDeviceTeacherCookie(
  req: express.Request,
  res: express.Response,
  authToken: string,
) {
  res.append(
    "Set-Cookie",
    `${MIRAS_SESSION_COOKIE}=${encodeURIComponent(authToken)}; ${transientCookieOptions(req)}`,
  );
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

function verifySebLaunchStudentSession(req: express.Request): MirasVerifiedSession | null {
  const headerOrCookieToken = readBearerToken(req);
  if (headerOrCookieToken) {
    return verifyMirasSessionTokenValue(
      headerOrCookieToken,
      `${req.method} ${req.path}`,
    );
  }
  const bodyToken = String(
    (req.body as any)?.authToken ||
      (req.body as any)?.mirasAuthToken ||
      "",
  ).trim();
  if (!bodyToken) return null;
  return verifyMirasSessionTokenValue(
    bodyToken,
    `${req.method} ${req.path} SEB launch body token`,
  );
}

function hasValidStudentSebLaunchSessionForDevice(
  req: express.Request,
  student: Student,
): boolean {
  const session = verifySebLaunchStudentSession(req);
  if (!session || session.role !== "student") return false;
  if (normalizeStudentId(session.userId) !== normalizeStudentId(student.id))
    return false;
  const currentDeviceToken = getRequestDeviceToken(req);
  const currentFingerprint = getRequestDeviceFingerprint(req);
  if (findStudentBoundToDevice(currentDeviceToken, currentFingerprint, student.id))
    return false;
  if (session.deviceTokenHash) {
    return (
      !!currentDeviceToken &&
      hashMirasValue(currentDeviceToken) === session.deviceTokenHash
    );
  }
  const registeredDevices = Array.isArray((student as any).devices)
    ? (student as any).devices
    : [];
  return registeredDevices.some((device: any) =>
    deviceFingerprintsMatch(device, currentFingerprint),
  );
}

function clearAuthCookies(req: express.Request, res: express.Response) {
  const expired = cookieOptions(req, 0);
  res.append("Set-Cookie", `${MIRAS_SESSION_COOKIE}=; ${expired}`);
}

function normalizeArabicIndicDigits(value: string): string {
  return String(value || "").replace(/[Ù -Ù©Û°-Û¹]/g, (ch) => {
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

function publicLoginAllowedOrigins() {
  const configured = String(process.env.MIRAS_PUBLIC_LOGIN_ORIGINS || "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...MIRAS_PUBLIC_LOGIN_DEFAULT_ORIGINS, ...configured]);
}

function publicLoginAppOrigin(req: express.Request) {
  const requestOrigin = String(req.headers.origin || "")
    .trim()
    .replace(/\/$/, "");
  try {
    const parsed = new URL(requestOrigin);
    const isLocal =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (isLocal || publicLoginAllowedOrigins().has(parsed.origin))
      return parsed.origin;
  } catch {}

  const configuredOrigin = String(process.env.MIRAS_PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (configuredOrigin) {
    try {
      const parsed = new URL(configuredOrigin);
      if (parsed.protocol === "https:") return parsed.origin;
    } catch {}
  }
  return "";
}

function publicLoginDesktopLabel(req: express.Request) {
  const ua = String(req.headers["user-agent"] || "");
  const browser = /Edg\//i.test(ua)
    ? "Microsoft Edge"
    : /Firefox\//i.test(ua)
      ? "Firefox"
      : /Chrome\//i.test(ua) && !/Edg\//i.test(ua)
        ? "Chrome"
        : /Safari\//i.test(ua) && !/Chrome\//i.test(ua)
          ? "Safari"
          : "Ù…ØªØµÙØ­";
  const system = /Windows/i.test(ua)
    ? "Windows"
    : /Macintosh|Mac OS X/i.test(ua)
      ? "macOS"
      : /Linux/i.test(ua)
        ? "Linux"
        : /iPad/i.test(ua)
          ? "iPad"
          : "ÙƒÙ…Ø¨ÙŠÙˆØªØ±";
  return `${browser} Ø¹Ù„Ù‰ ${system}`;
}

function publicLoginSecretMatches(rawSecret: any, expectedHash: string) {
  const actual = Buffer.from(hashMirasValue(rawSecret), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return (
    actual.length === expected.length &&
    actual.length > 0 &&
    crypto.timingSafeEqual(actual, expected)
  );
}

function parsePublicLoginApprovalToken(value: any) {
  const raw = String(value || "").trim();
  const separator = raw.indexOf(".");
  if (separator <= 0) return null;
  const requestId = raw.slice(0, separator);
  const approvalSecret = raw.slice(separator + 1);
  if (
    !/^[A-Za-z0-9_-]{20,}$/.test(requestId) ||
    !/^[A-Za-z0-9_-]{32,}$/.test(approvalSecret)
  )
    return null;
  return { requestId, approvalSecret };
}

async function cleanupPublicDeviceLogins() {
  const now = Date.now();
  await cleanupRuntimeAuthChallenges(now);
  for (const [key, bucket] of publicDeviceStartBuckets.entries()) {
    if (now - bucket.windowStartedAt > PUBLIC_DEVICE_START_WINDOW_MS)
      publicDeviceStartBuckets.delete(key);
  }
}

function consumePublicDeviceStartLimit(req: express.Request, email: string) {
  const now = Date.now();
  const key = `${req.ip || "127.0.0.1"}:${String(email || "").toLowerCase()}`;
  let bucket = publicDeviceStartBuckets.get(key);
  if (!bucket || now - bucket.windowStartedAt > PUBLIC_DEVICE_START_WINDOW_MS)
    bucket = { count: 0, windowStartedAt: now };
  bucket.count += 1;
  publicDeviceStartBuckets.set(key, bucket);
  return bucket.count <= PUBLIC_DEVICE_START_MAX;
}

function findPublicLoginTeacher(email: any) {
  const normalized = String(email || "").trim().toLowerCase();
  const user = findPasskeyUser("teacher", normalized);
  if (!user) return null;
  const credentials = dbInstance
    .getPasskeyCredentials()
    .filter(
      (item: any) =>
        item.role === "teacher" &&
        String(item.userId || "").trim().toLowerCase() ===
          String(user.id || "").trim().toLowerCase(),
    );
  return credentials.length ? { user, credentials } : null;
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
      action: "Ø¯Ø®ÙˆÙ„ Ø£Ø³ØªØ§Ø° Ø¨Ø§Ù„Ø¨ØµÙ…Ø©",
      details: `ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„ Ø§Ù„Ø£Ø³ØªØ§Ø° ${teacher.email} Ø¹Ø¨Ø± Passkey/Face ID`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "Ù…ØªØµÙØ­",
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
        "ØªÙ… Ø¥ÙŠÙ‚Ø§Ù Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨ Ù…Ø¤Ù‚ØªØ§Ù‹ Ù…Ù† Ù‚Ø¨Ù„ Ø£Ø³ØªØ§Ø° Ø§Ù„Ù…Ù‚Ø±Ø±.",
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
      action: "Ø§Ù†ØªÙ‡Ø§Ùƒ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø©",
      details: "Ù…Ø­Ø§ÙˆÙ„Ø© Ø¯Ø®ÙˆÙ„ Ø¨Ø§Ù„Ø¨ØµÙ…Ø© Ù…Ù† Ø¬Ù‡Ø§Ø² ØºÙŠØ± Ù…ØµØ±Ø­ Ø¨Ù‡",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "Ù…Ø¬Ù‡ÙˆÙ„",
      browser: "Passkey",
      isViolationWarning: true,
    });
    notifyTeachersForSection(
      student.sectionCode,
      "Ù…Ø­Ø§ÙˆÙ„Ø© Ø¯Ø®ÙˆÙ„ Ø¨Ø§Ù„Ø¨ØµÙ…Ø© Ù…Ø±ÙÙˆØ¶Ø©",
      `${student.name}: ${sessionValidation.error || "Ù…Ø®Ø§Ù„ÙØ© Ø£Ø¬Ù‡Ø²Ø©"}`,
      { type: "login_blocked", studentId: student.id, link: "/" },
    );
    const err: any = new Error(
      sessionValidation.error || "Ø§Ù„Ø¬Ù‡Ø§Ø² ØºÙŠØ± Ù…ØµØ±Ø­ Ù„Ù‡.",
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
    action: "ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„ Ø¨Ø§Ù„Ø¨ØµÙ…Ø©",
    details: "ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„ Ù†Ø§Ø¬Ø­ Ø¹Ø¨Ø± Passkey/Face ID Ù…Ø¹ Ø¨Ù‚Ø§Ø¡ Ù‚ÙÙ„ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø© ÙØ¹Ø§Ù„Ø§Ù‹",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "Ù…ÙƒØªØ´Ù ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹",
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

// Ø­Ø§Ù„Ø© Ø®Ø§ØµØ© ØªÙØ³ØªØ®Ø¯Ù… ÙÙŠ Ø³Ø¬Ù„ "ØªØ³Ù„ÙŠÙ…Ø§Øª Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª" Ù…Ù†Ø° Ø§Ù„Ù„Ø­Ø¸Ø© Ø§Ù„ØªÙŠ ÙŠØ¨Ø¯Ø£ ÙÙŠÙ‡Ø§
// Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ø®ØªØ¨Ø§Ø±Ø§Ù‹ Ø±Ø³Ù…ÙŠØ§Ù‹ ÙˆØªØ¸Ù‡Ø± Ù„Ù‡ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© (status === "started"). ØªØ¬Ø¹Ù„ Ù‡Ø°Ù‡
// Ø§Ù„Ø­Ø§Ù„Ø© Ø¯Ø®ÙˆÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¸Ø§Ù‡Ø±Ø§Ù‹ ÙÙˆØ±Ø§Ù‹ Ù„Ø¯Ù‰ Ø§Ù„Ø£Ø³ØªØ§Ø° ÙÙŠ Ø´Ø§Ø´Ø© Ø§Ù„ØªØ³Ù„ÙŠÙ…Ø§Øª â€”
// Ø­ØªÙ‰ Ù„Ùˆ Ù„Ù… ÙŠØµÙ„ Ø£ÙŠ Ø¥Ø´Ø¹Ø§Ø± "Ø®Ø±ÙˆØ¬" Ù…Ù† SEB Ù„Ø§Ø­Ù‚Ø§Ù‹ â€” Ù…Ø¹ Ø²Ø± "Ø¥Ø±Ø¬Ø§Ø¹" ÙŠØ³Ù…Ø­ Ø¨ÙØªØ­
// Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ù† Ø¬Ø¯ÙŠØ¯ Ø¥Ù† Ø§Ø­ØªØ§Ø¬ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù„Ø¥Ø¹Ø§Ø¯ØªÙ‡Ø§.
const EXAM_IN_PROGRESS_STATUS = "Ø¯Ø®Ù„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± - Ù‚ÙŠØ¯ Ø§Ù„Ø­Ù„ Ø§Ù„Ø¢Ù†";

// Ø­Ø§Ù„Ø© Ø®Ø§ØµØ© ØªÙØ³ØªØ®Ø¯Ù… ÙÙŠ Ø³Ø¬Ù„ "ØªØ³Ù„ÙŠÙ…Ø§Øª Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª" Ø¹Ù†Ø¯Ù…Ø§ ÙŠØ®Ø±Ø¬ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ù† Ø§Ø®ØªØ¨Ø§Ø±
// SEB (Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù† / Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ø¬Ù„Ø³Ø©) Ø¨Ø¹Ø¯ Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙˆØ¸Ù‡ÙˆØ± Ø§Ù„Ø£Ø³Ø¦Ù„Ø© Ø¯ÙˆÙ† ØªØ³Ù„ÙŠÙ…
// Ø¥Ø¬Ø§Ø¨Ø§ØªÙ‡. ØªØ¬Ø¹Ù„ Ù‡Ø°Ù‡ Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø¸Ø§Ù‡Ø±Ø© Ù„Ø¯Ù‰ Ø§Ù„Ø£Ø³ØªØ§Ø° ÙÙŠ Ø´Ø§Ø´Ø© Ø§Ù„ØªØ³Ù„ÙŠÙ…Ø§Øª Ù…Ø¹
// Ø²Ø± "Ø¥Ø±Ø¬Ø§Ø¹" Ø§Ù„Ø°ÙŠ ÙŠØ³Ù…Ø­ Ù„Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© (Ø§Ù†Ø¸Ø± closeSebAttempt
// Ùˆ /api/teacher/submissions/return).
const EXAM_EXITED_BEFORE_SUBMIT_STATUS = "Ø®Ø±Ø¬ Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù‚Ø¨Ù„ Ø§Ù„ØªØ³Ù„ÙŠÙ…";
const EXAM_WITHDRAWN_STATUS = "Ø§Ù†Ø³Ø­Ø§Ø¨ Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±";
const EXAM_CHEATING_ATTEMPT_STATUS = "Ù…Ø­Ø§ÙˆÙ„Ø© ØºØ´";
const EXAM_SUBMITTED_STATUS = "Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø±ØµØ¯ Ø§Ù„Ø¯Ø±Ø¬Ø§Øª";
const EXAM_GRADED_STATUS = "ØªÙ… Ø±ØµØ¯ Ø§Ù„Ø¯Ø±Ø¬Ø©";
const EXAM_TIME_EXPIRED_STATUS = "Ø§Ù†ØªÙ‡Ù‰ Ø§Ù„ÙˆÙ‚Øª";
const EXAM_RETURNED_STATUS = "Ù…Ø¹Ø§Ø¯ Ù„Ù„Ø·Ø§Ù„Ø¨";

// Ø­Ø§Ù„Ø© Ù†Ù‡Ø§Ø¦ÙŠØ©/Ù†Ø²Ø§Ù‡Ø© Ù„ØµÙÙ‘ Ø§Ù„Ø£Ø³ØªØ§Ø° ÙŠØ¬Ø¨ Ø£Ù„Ø§ ØªÙØ·Ù…ÙØ³ Ø¨Ø­Ø§Ù„Ø© "Ù‚ÙŠØ¯ Ø§Ù„Ø­Ù„ Ø§Ù„Ø¢Ù†" Ø¨Ø³Ø¨Ø¨
// Ø£ÙŠ Ù…Ø²Ø§Ù…Ù†Ø© Ø£Ùˆ Ø·Ù„Ø¨ Ø£Ø³Ø¦Ù„Ø© Ù„Ø§Ø­Ù‚ (Ù…Ø­Ø§ÙˆÙ„Ø© ØºØ´ØŒ Ø§Ù†Ø³Ø­Ø§Ø¨ØŒ Ø®Ø±ÙˆØ¬ Ù‚Ø¨Ù„ Ø§Ù„ØªØ³Ù„ÙŠÙ…ØŒ Ø§Ù†ØªÙ‡Ù‰
// Ø§Ù„ÙˆÙ‚ØªØŒ Ø¨Ø§Ù†ØªØ¸Ø§Ø±/ØªÙ… Ø±ØµØ¯ Ø§Ù„Ø¯Ø±Ø¬Ø©ØŒ Ø£Ùˆ Ø¯Ø±Ø¬Ø© Ù…Ø¹ØªÙ…Ø¯Ø© ÙŠØ¯ÙˆÙŠØ§Ù‹). Ø­Ø§Ù„Ø© "Ù…Ø¹Ø§Ø¯ Ù„Ù„Ø·Ø§Ù„Ø¨"
// Ù„ÙŠØ³Øª Ù…Ø­Ù…ÙŠØ© Ø¹Ù…Ø¯Ø§Ù‹ Ø­ØªÙ‰ ÙŠØ¸Ù‡Ø± Ø¯Ø®ÙˆÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø¹Ø¯ Ø§Ù„Ø¥Ø±Ø¬Ø§Ø¹ Ø¨Ø´ÙƒÙ„ Ø·Ø¨ÙŠØ¹ÙŠ.
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
    s === "Ø¯Ø±Ø¬Ø© Ù…Ø¹ØªÙ…Ø¯Ø©" ||
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
    text.includes("Ø§Ù„ÙˆØ¶Ø¹ Ø§Ù„Ø¹Ø±Ø¶ÙŠ") ||
    text.includes("Ø§ØªØ¬Ø§Ù‡ Ø§Ù„Ø¬Ù‡Ø§Ø²") ||
    text.includes("Ø§ØªØ¬Ø§Ù‡ Ø§Ù„Ø´Ø§Ø´Ø©") ||
    text.includes("ØªØºÙŠÙŠØ± Ø§ØªØ¬Ø§Ù‡")
  ) {
    return "landscape_orientation";
  }
  return text ? "integrity_violation" : "violation";
}

function isReturnedSubmissionStatusServer(status: any) {
  const text = String(status || "")
    .trim()
    .toLowerCase();
  return ["Ù…Ø¹Ø§Ø¯ Ù„Ù„Ø·Ø§Ù„Ø¨", "Ù…Ø¹Ø§Ø¯ Ù„Ùƒ", "returned", "return", "reopened"].includes(
    text,
  );
}

function isCheatingAttemptSubmissionServer(row: any): boolean {
  const text = `${row?.status || ""} ${row?.answerText || ""}`;
  return (
    String(row?.status || "").trim() === EXAM_CHEATING_ATTEMPT_STATUS ||
    text.includes("Ù…Ø­Ø§ÙˆÙ„Ø© ØºØ´") ||
    text.includes("Ø­Ø§ÙˆÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„ØºØ´")
  );
}

const EXAM_LOCK_HEARTBEAT_TIMEOUT_MS = 15 * 1000;
const EXAM_LOCK_CONFLICT_MESSAGE = "Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù…ÙØªÙˆØ­ ÙÙŠ Ø¬Ù„Ø³Ø© Ø£Ø®Ø±Ù‰.";
const EXAM_LOCK_CONFLICT_REASON = "ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙÙŠ Ø£ÙƒØ«Ø± Ù…Ù† Ø¬Ù„Ø³Ø© Ø£Ùˆ Ø¬Ù‡Ø§Ø²";
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
    action: "Ù…Ø­Ø§ÙˆÙ„Ø© ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙÙŠ Ø¬Ù„Ø³Ø© Ø£Ø®Ø±Ù‰",
    details: `${exam?.title || "Ø§Ø®ØªØ¨Ø§Ø±"} â€” ${EXAM_LOCK_CONFLICT_REASON}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: courseCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: requestExamDisplayMode(req) === "pwa" ? "PWA" : "Ù…ØªØµÙØ­",
    browser: "Ù‚ÙÙ„ Ø¬Ù„Ø³Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±",
    isViolationWarning: true,
  });
  notifyTeachersForSection(
    courseCode,
    "ØªÙ†Ø¨ÙŠÙ‡ Ù†Ø²Ø§Ù‡Ø©",
    `${student.name} Ø­Ø§ÙˆÙ„ ÙØªØ­ ${exam?.title || "Ø§Ø®ØªØ¨Ø§Ø±"} ÙÙŠ Ø¬Ù„Ø³Ø© Ø£Ø®Ø±Ù‰.`,
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
        "ØªÙ… Ø¥ÙŠÙ‚Ø§Ù Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¨Ø³Ø¨Ø¨ Ù…Ø®Ø§Ù„ÙØ©. Ù„Ø§ ÙŠÙ…ÙƒÙ† ÙØªØ­Ù‡ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰ Ø¥Ù„Ø§ Ø¥Ø°Ø§ Ø£Ø¹Ø§Ø¯Ù‡ Ø§Ù„Ù…Ø¹Ù„Ù….",
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
        const incomingDeviceId = String(
          (req.body as any)?.deviceId ||
            (req.body as any)?.deviceToken ||
            "",
        ).trim();
        const activeSessionDeviceId = String(activeSession.deviceId || "").trim();
        if (incomingDeviceId && activeSessionDeviceId && incomingDeviceId === activeSessionDeviceId) {
          const refreshed = {
            ...activeSession,
            lastHeartbeatAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            userAgent: String(req.headers["user-agent"] || activeSession.userAgent || "").slice(0, 220),
            displayMode: requestExamDisplayMode(req),
          };
          dbInstance.upsertExamSession(refreshed);
          return { ok: true, session: refreshed };
        }

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
    return { ok: false, status: 400, error: "Ø¨ÙŠØ§Ù†Ø§Øª Ø¬Ù„Ø³Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù†Ø§Ù‚ØµØ©." };
  }
  const activeSession = activeExamSessionFor(student.id, exam.id);
  if (!activeSession) {
    return {
      ok: false,
      status: 409,
      error: "Ø§Ù†ØªÙ‡Øª Ø¬Ù„Ø³Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø£Ùˆ Ø§Ù†Ù‚Ø·Ø¹ Ø§ØªØµØ§Ù„Ù‡Ø§.",
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

function closeActiveExamLocksForFreshSebLaunch(
  studentId: any,
  examId: any,
  reason = "fresh-seb-launch",
) {
  const nowIso = new Date().toISOString();
  getExamSessionsFor(studentId, examId).forEach((session: any) => {
    if (String(session?.status || "") !== "active") return;
    dbInstance.upsertExamSession({
      ...session,
      status: "finished",
      finishedAt: session.finishedAt || nowIso,
      closedAt: session.closedAt || nowIso,
      finishReason: reason,
      closeReason: reason,
      lastHeartbeatAt: nowIso,
      updatedAt: nowIso,
    });
  });
}

// Ø®Ù„Ø· Fisher-Yates: Ø¹Ø´ÙˆØ§Ø¦ÙŠØ© ØµØ­ÙŠØ­Ø© ÙˆÙ…ØªØ³Ø§ÙˆÙŠØ© Ø§Ù„Ø§Ø­ØªÙ…Ø§Ù„. ÙŠÙØ³ØªØ®Ø¯Ù… Ø¯Ø§Ø¦Ù…Ø§Ù‹ ÙˆØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹
// Ø¹Ù†Ø¯ ØªÙˆÙ„ÙŠØ¯ ÙƒÙ„ Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ø®ØªØ¨Ø§Ø± Ù„ØªØ±ØªÙŠØ¨ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© Ø§Ù„Ù…Ø®ØªØ§Ø±Ø© ÙˆØªØ±ØªÙŠØ¨ Ø§Ø®ØªÙŠØ§Ø±Ø§Øª Ø§Ù„Ø£Ø³Ø¦Ù„Ø©
// Ù…ØªØ¹Ø¯Ø¯Ø© Ø§Ù„Ø®ÙŠØ§Ø±Ø§ØªØŒ Ø¯ÙˆÙ† Ø£ÙŠ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¹Ù„Ù‰ Ø¥Ø¹Ø¯Ø§Ø¯ Ù‚Ø§Ø¨Ù„ Ù„Ù„ØªØ¹Ø·ÙŠÙ„ Ù…Ù† Ù†Ù…ÙˆØ°Ø¬ Ø¥Ù†Ø´Ø§Ø¡
// Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± (Ù‡Ø°Ù‡ Ø§Ù„Ù…ÙŠØ²Ø© Ù…ÙØ¹Ù‘Ù„Ø© Ø¯Ø§Ø¦Ù…Ø§Ù‹ ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹).
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
    .replace(/[Ù -Ù©]/g, (d) => String("Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©".indexOf(d)))
    .replace(/[Û°-Û¹]/g, (d) => String("Û°Û±Û²Û³Û´ÛµÛ¶Û·Û¸Û¹".indexOf(d)))
    .replace(/[Ù«Ù¬ØŒ]/g, ".");
}
function normalizeGradeValueServer(value: any) {
  const firstPart =
    normalizeArabicDigitsServer(value).split(/\s*Ù…Ù†\s*|\//)[0] || "";
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
          rest.originalName || rest.name || "Ù…Ø±ÙÙ‚",
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
      `âœ… Migrated ${migratedFiles} embedded submission attachment(s) out of ${updatedSubmissions} database record(s).`,
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
  // Ø§Ù„Ø­Ù…Ø§ÙŠØ© Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØ© ÙÙŠ Ù†Ù‚Ø·Ø© Ø§Ù„Ø­ÙØ¸ Ù†ÙØ³Ù‡Ø§: Ø£ÙŠ Ù†Ø¨Ø¶Ø©/Ù…Ø²Ø§Ù…Ù†Ø© Ù‚Ø¯ÙŠÙ…Ø© ÙˆØµÙ„Øª Ø¨Ø¹Ø¯
  // Ø§Ù„Ø®Ø±ÙˆØ¬ Ø£Ùˆ Ø§Ù„ØºØ´ Ù„Ø§ ØªÙ…Ù„Ùƒ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØµÙ Ø¥Ù„Ù‰ "Ù‚ÙŠØ¯ Ø§Ù„Ø­Ù„". Ø§Ù„Ø¥Ø±Ø¬Ø§Ø¹ Ø§Ù„Ø±Ø³Ù…ÙŠ Ù„Ù„Ø·Ø§Ù„Ø¨
  // ÙŠÙƒØªØ¨ EXAM_RETURNED_STATUS ÙˆÙ„ÙŠØ³ Ø­Ø§Ù„Ø© Ù†Ø´Ø·Ø©ØŒ Ù„Ø°Ù„Ùƒ ÙŠØ¨Ù‚Ù‰ Ù…Ø³Ø§Ø±Ù‡ Ø§Ù„Ù…Ø¹ØªØ§Ø¯ Ù…ÙØªÙˆØ­Ø§Ù‹.
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
      returnExceptionUntil: undefined,
      returnExceptionHours: undefined,
      returnExceptionGrantedAt: undefined,
      returnExceptionByEmail: undefined,
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
    incomingAnswerText.includes("Ø§Ù†Ø³Ø­Ø¨ Ø§Ù„Ø·Ø§Ù„Ø¨") ||
    incomingAnswerText.includes("Ø§Ù†Ø³Ø­Ø§Ø¨ Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±") ||
    incomingAnswerText.includes("Ø­Ø§ÙˆÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„ØºØ´") ||
    incomingAnswerText.includes("Ø£ØºÙ„Ù‚ Ø´Ø§Ø´Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±");
  const incomingLooksAutoZero =
    String(
      submission.grade ?? submission.visibleGrade ?? submission.score ?? "",
    ).trim() === "" ||
    Number(
      normalizeGradeValueServer(
        submission.grade ?? submission.visibleGrade ?? submission.score ?? "0",
      ),
    ) === 0;

  // Ø¥Ø°Ø§ Ø¹Ø¯Ù‘Ù„ Ø§Ù„Ù…Ø¹Ù„Ù… Ø¯Ø±Ø¬Ø© Ø·Ø§Ù„Ø¨ Ù…Ù†Ø³Ø­Ø¨ ÙŠØ¯ÙˆÙŠØ§Ù‹ØŒ Ù„Ø§ ØªØ³Ù…Ø­ Ø£ÙŠ Ù…Ø²Ø§Ù…Ù†Ø© Ù„Ø§Ø­Ù‚Ø©
  // Ù„Ø³Ø¬Ù„ Ø§Ù„Ø§Ù†Ø³Ø­Ø§Ø¨ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ Ø¨Ø¥Ø±Ø¬Ø§Ø¹Ù‡Ø§ Ø¥Ù„Ù‰ ØµÙØ±.
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
    const suffix = max ? `: ${nextGrade} Ù…Ù† ${max}` : `: ${nextGrade}`;
    notifyStudent(
      String(saved.studentId),
      changed ? "ØªÙ… ØªØ¹Ø¯ÙŠÙ„ Ø¯Ø±Ø¬Ø©" : "Ø¯Ø±Ø¬Ø© Ø¬Ø¯ÙŠØ¯Ø©",
      `${saved.activityTitle || "Ù†Ø´Ø§Ø·"}${suffix}`,
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
  const finalReasonText = `Ø§Ù†Ø³Ø­Ø¨ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø£Ùˆ Ø§Ù†Ù‚Ø·Ø¹Øª Ø¬Ù„Ø³ØªÙ‡ØŒ ÙˆØªÙ… Ø±ØµØ¯ Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„ØªÙŠ ÙˆØµÙ„ Ù„Ù‡Ø§: ${finalScore} Ù…Ù† ${totalPoints}`;

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
    action: "Ø§Ù†Ø³Ø­Ø§Ø¨ Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±",
    details: `${reason} â€” ØªÙ… Ø±ØµØ¯ Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ø­Ø§Ù„ÙŠØ© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹: ${finalScore} Ù…Ù† ${totalPoints}. Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±: ${exam.title}`,
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
    action: "Ø±ÙØ¶ Ù†ÙÙ‚ SEB",
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
  if (!hasActualSebRuntimeHint(req)) return null;
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
function closePendingSebLaunchesForFreshAttempt(
  studentId: any,
  examId: any,
  reason = "superseded-by-fresh-seb-launch",
) {
  const now = Date.now();
  getRuntimeSebPasses().forEach((pass) => {
    if (String(pass.studentId) !== String(studentId)) return;
    if (String(pass.examId) !== String(examId)) return;
    if (pass.status !== "launch") return;
    pass.status = "closed";
    pass.closedAt = now;
    pass.closeReason = reason;
    saveSebPass(pass);
  });
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

  // Ù‚Ø¯ ÙŠØµÙ„ Ø·Ù„Ø¨ Ø§Ù„Ø®Ø±ÙˆØ¬ Ù…Ù† SEB Ø¨Ø¹Ø¯ Ø£Ù† ØªÙƒÙˆÙ† Ø§Ù„Ø¬Ù„Ø³Ø© Ø£ÙØºÙ„Ù‚Øª Ù…Ø­Ù„ÙŠØ§Ù‹ Ø£Ùˆ Ø¨Ø³Ø¨Ø¨ Ø±Ø§Ø¨Ø·
  // Ø§Ù„Ø®Ø±ÙˆØ¬. Ù„Ø§ Ù†ØªØ±Ùƒ ØµÙ Ø§Ù„Ø£Ø³ØªØ§Ø° Ø¹Ø§Ù„Ù‚Ø§Ù‹ Ø¹Ù„Ù‰ "Ù‚ÙŠØ¯ Ø§Ù„Ø­Ù„" ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ø­Ø§Ù„Ø©Ø› Ø¨Ù„
  // Ù†Ø­Ø§ÙˆÙ„ ØªØ«Ø¨ÙŠØª Ø§Ù„Ø§Ù†Ø³Ø­Ø§Ø¨ ÙÙ‚Ø· Ø¥Ø°Ø§ Ù„Ù… ÙŠÙƒÙ† Ø§Ù„Ø¥ØºÙ„Ø§Ù‚ ØªØ³Ù„ÙŠÙ…Ø§Ù‹ Ø­Ù‚ÙŠÙ‚ÙŠØ§Ù‹ØŒ ÙˆØ§Ù„Ø­Ø§Ø±Ø³ Ø¯Ø§Ø®Ù„
  // flagExamExitedBeforeSubmit ÙŠÙ…Ù†Ø¹ ØªØ­ÙˆÙŠÙ„ Ø§Ù„ØªØ³Ù„ÙŠÙ… Ø§Ù„ØµØ­ÙŠØ­ Ø¥Ù„Ù‰ Ø§Ù†Ø³Ø­Ø§Ø¨.
  if (pass.status === "closed") {
    if (!isSubmissionClose) flagExamExitedBeforeSubmit(pass);
    return;
  }

  pass.status = "closed";
  pass.closedAt = Date.now();
  pass.closeReason = reason;
  saveSebPass(pass);

  // Ø¥ØºÙ„Ø§Ù‚ Ø¬Ù„Ø³Ø© SEB Ø¨Ø¹Ø¯ ØªØ³Ù„ÙŠÙ… Ø­Ù‚ÙŠÙ‚ÙŠ Ù„Ø§ ÙŠØ¹Ù†ÙŠ Ø§Ù†Ø³Ø­Ø§Ø¨Ø§Ù‹. Ù„Ø§ Ù†Ø±ØµØ¯ ØµÙØ± Ø§Ù„Ø§Ù†Ø³Ø­Ø§Ø¨
  // Ø¥Ù„Ø§ Ø¹Ù†Ø¯ Ø®Ø±ÙˆØ¬ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù‚Ø¨Ù„ Ø§Ù„ØªØ³Ù„ÙŠÙ…ØŒ Ù…Ø¹ Ø¨Ù‚Ø§Ø¡ Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠØ© started.
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
      return; // ØªÙ… Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡ Ù…Ø³Ø¨Ù‚Ø§Ù‹ØŒ Ù„Ø§ ØªÙƒØ±Ø§Ø±

    // Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„ØªÙŠ ØªØ³ØªÙˆØ¬Ø¨ Ø±ØµØ¯ ØµÙØ± ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø¹Ù†Ø¯ Ø§Ù†Ø³Ø­Ø§Ø¨ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø£Ùˆ Ø¥ØºÙ„Ø§Ù‚ Ø¬Ù„Ø³Ø© SEB
    // ÙØ¹Ù„ÙŠØ§Ù‹: Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠØ© Ù„Ø§ ØªØ²Ø§Ù„ "started" (Ù„Ù… ÙŠØ³Ù„Ù‘Ù… Ø§Ù„Ø·Ø§Ù„Ø¨)ØŒ
    // Ø£Ùˆ Ø´Ø§Ø´Ø© ØªØ³Ù„ÙŠÙ…Ø§Øª Ø§Ù„Ø£Ø³ØªØ§Ø° Ù„Ø§ ØªØ²Ø§Ù„ ØªØ¹Ø±Ø¶ "Ø¯Ø®Ù„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± - Ù‚ÙŠØ¯ Ø§Ù„Ø­Ù„ Ø§Ù„Ø¢Ù†"
    // Ù„Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© (Ø­ØªÙ‰ Ù„Ùˆ Ù„Ù… ØªÙØ­Ø¯ÙÙ‘Ø« Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠØ© Ù„Ø£ÙŠ Ø³Ø¨Ø¨). Ø¥Ù†
    // Ù„Ù… ÙŠØªØ­Ù‚Ù‚ Ø£ÙŠ Ù…Ù† Ø§Ù„Ø´Ø±Ø·ÙŠÙ† ÙØ§Ù„Ø·Ø§Ù„Ø¨ Ù‚Ø¯ Ø³Ù„Ù‘Ù… ÙØ¹Ù„Ø§Ù‹ ÙˆÙ„Ø§ Ø­Ø§Ø¬Ø© Ù„Ø£ÙŠ ØªØ¹Ø¯ÙŠÙ„.
    const quizStillInProgress =
      !!submission && String((submission as any).status || "") === "started";
    const teacherStillShowsInProgress =
      !!existing && String(existing.status || "") === EXAM_IN_PROGRESS_STATUS;
    // ØµÙ Ø£Ø³ØªØ§Ø° Ø¨Ø­Ø§Ù„Ø© ÙØ§Ø±ØºØ© = ÙŠØ¸Ù‡Ø± "Ø¨Ø§Ù†ØªØ¸Ø§Ø±" Ù„Ù„Ù…Ø¹Ù„Ù… Ø±ØºÙ… Ø£Ù† Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù†Ø³Ø­Ø¨ ÙØ¹Ù„Ø§Ù‹ â€” Ù†Ø¹ØªØ¨Ø±Ù‡
    // Ù…ÙØªÙˆØ­Ø§Ù‹ Ø£ÙŠØ¶Ø§Ù‹ ÙÙ†Ø«Ø¨Ù‘Øª Ø¹Ù„ÙŠÙ‡ Ø§Ù„Ø§Ù†Ø³Ø­Ø§Ø¨ (Ù…Ù†Ø³Ø­Ø¨) Ø¨Ø¯Ù„ ØªØ±ÙƒÙ‡ "Ø¨Ø§Ù†ØªØ¸Ø§Ø±". Ù„Ø§ Ù†Ù…Ø³Ù‘ Ø§Ù„Ø­Ø§Ù„Ø§Øª
    // Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØ© (Ù…Ø³Ù„ÙÙ‘Ù…/Ù…Ø±ØµÙˆØ¯/ØºØ´/Ù…Ù†Ø³Ø­Ø¨/Ø®Ø±Ø¬) ÙˆÙ„Ø§ "Ù…Ø¹Ø§Ø¯ Ù„Ù„Ø·Ø§Ù„Ø¨" Ù„Ø£Ù†Ù‡Ø§ Ù„ÙŠØ³Øª ÙØ§Ø±ØºØ©.
    const teacherRowEmptyStatus =
      !!existing && String(existing.status || "").trim() === "";
    if (
      !quizStillInProgress &&
      !teacherStillShowsInProgress &&
      !teacherRowEmptyStatus
    )
      return;

    finalizeExamAttemptAsZero({} as express.Request, {
      student,
      exam,
      pass,
      submission,
      reason:
        "Ø¨Ø¯Ø£ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙˆØ¸Ù‡Ø±Øª Ù„Ù‡ Ø§Ù„Ø£Ø³Ø¦Ù„Ø©ØŒ Ø«Ù… Ø®Ø±Ø¬ Ø£Ùˆ Ø§Ù†Ù‚Ø·Ø¹Øª Ø§Ù„Ø¬Ù„Ø³Ø© Ù‚Ø¨Ù„ ØªØ³Ù„ÙŠÙ… Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø§Øª.",
    });

    notifyTeachersForSection(
      (exam as any).courseCode || pass.courseCode,
      "Ø®Ø±ÙˆØ¬ Ø·Ø§Ù„Ø¨ Ù…Ù† Ø§Ø®ØªØ¨Ø§Ø± Ù‚Ø¨Ù„ Ø§Ù„ØªØ³Ù„ÙŠÙ…",
      `${student.name} Ø®Ø±Ø¬ Ù…Ù† Ø§Ø®ØªØ¨Ø§Ø± "${exam.title}" Ù‚Ø¨Ù„ ØªØ³Ù„ÙŠÙ… Ø¥Ø¬Ø§Ø¨Ø§ØªÙ‡. ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„Ø³Ù…Ø§Ø­ Ù„Ù‡ Ø¨Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ù† Ø´Ø§Ø´Ø© ØªØ³Ù„ÙŠÙ…Ø§Øª Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª.`,
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
<title>ØªØ´ØºÙŠÙ„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†</title>
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
  <div class="shield">ğŸ›¡ï¸</div>
  <h1>ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¹Ø¨Ø± Safe Exam Browser</h1>
  <div class="lockNotice">
    <b>ØªÙ†Ø¨ÙŠÙ‡ Ù‚Ø¨Ù„ ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±</b>
    Ø¹Ù†Ø¯ Ø§Ù„Ø¶ØºØ· Ø¹Ù„Ù‰ Ø§Ù„Ø²Ø± Ø§Ù„Ø£Ø²Ø±Ù‚ Ø³ÙŠØªÙ… ÙØªØ­ ØªØ·Ø¨ÙŠÙ‚ SEB Ø§Ù„Ù…Ø«Ø¨Øª Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø²Ùƒ Ù…Ø¨Ø§Ø´Ø±Ø© ÙˆØ±Ø¨Ø·Ù‡ Ø¨Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© ÙÙ‚Ø·.
    <br><br>
    Ø³ØªØ¸Ù‡Ø± Ù„Ùƒ Ø±Ø³Ø§Ù„Ø© Ù…Ù† Ø§Ù„Ù†Ø¸Ø§Ù… Ø¨Ø¹Ù†ÙˆØ§Ù† "Confirm App Self-Lock" â€” Ø§Ø¶ØºØ· <span class="yes">"Yes"</span> Ù„Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±. Ø³ÙŠÙÙ‚ÙÙ„ Ø¬Ù‡Ø§Ø²Ùƒ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ ÙˆÙ„Ù† ØªØ³ØªØ·ÙŠØ¹ Ø§Ù„Ø®Ø±ÙˆØ¬ Ù„Ø£ÙŠ ØªØ·Ø¨ÙŠÙ‚ Ø­ØªÙ‰ ØªØ³Ù„Ù‘Ù… Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.
    <br><br>
	    Ø¥Ø°Ø§ Ø¶ØºØ·Øª <span class="no">"No"</span> Ø¨Ø§Ù„Ø®Ø·Ø£: Ù„Ø§ ØªÙ‚Ù„Ù‚ØŒ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù„Ù… ÙŠØ¨Ø¯Ø£. Ø§Ø±Ø¬Ø¹ Ù„Ù„Ø±Ø¦ÙŠØ³ÙŠØ© ÙˆØ§ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.
  </div>
  <p class="muted">Ø§Ø¶ØºØ· Ø§Ù„Ø²Ø± Ø§Ù„Ø£Ø²Ø±Ù‚ Ù„ÙØªØ­ Safe Exam Browser Ù…Ø¨Ø§Ø´Ø±Ø©. Ø¥Ø°Ø§ ÙƒØ§Ù† Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…Ø«Ø¨ØªØ§Ù‹ Ø³ÙŠØ¨Ø¯Ø£ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¯Ø§Ø®Ù„ SEB Ø¯ÙˆÙ† ØªÙ†Ø²ÙŠÙ„ Ù…Ù„Ù ÙŠØ¯ÙˆÙŠ.</p>
  <a class="btn primary" id="openSeb" href="${xmlEscape(launchUrl)}">ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¯Ø§Ø®Ù„ SEB</a>
  <a class="btn ios" href="${xmlEscape(appStoreUrl)}" rel="noopener">ØªØ­Ù…ÙŠÙ„ SEB Ù„Ø£Ø¬Ù‡Ø²Ø© iPhone / iPad</a>
  <a class="btn ghost" href="${xmlEscape(downloadUrl)}" rel="noopener">ØªØ­Ù…ÙŠÙ„ SEB Ù„Ù„ÙƒÙ…Ø¨ÙŠÙˆØªØ±</a>
  <div class="warn" id="warnBox">Ø¥Ø°Ø§ Ù„Ù… ÙŠÙØªØ­ SEB ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ØŒ ØªØ£ÙƒØ¯ Ø£Ù† Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…Ø«Ø¨Øª Ø«Ù… Ø§Ø¶ØºØ· Ø§Ù„Ø²Ø± Ø§Ù„Ø£Ø²Ø±Ù‚ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰. Ø¥Ø°Ø§ Ù„Ù… ÙŠÙƒÙ† Ù…Ø«Ø¨ØªØ§Ù‹ Ø§Ø³ØªØ®Ø¯Ù… Ø²Ø± Ø§Ù„ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ù…Ù†Ø§Ø³Ø¨ Ù„Ø¬Ù‡Ø§Ø²Ùƒ.</div>
  <p class="hint">Ø¹Ù†Ø¯ ÙØªØ­ SEB Ø³ÙŠØªÙ… Ù‚ÙÙ„ Ø¬Ù‡Ø§Ø²Ùƒ ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ ÙˆÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ù…Ø±ØªØ¨Ø· Ø¨Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø¨Ø§Ø´Ø±Ø©.</p>
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
// Ø¥Ø¹Ø¯Ø§Ø¯ ÙƒØ§Ù…ÙŠØ±Ø§ SEB Ù„Ù„ØªÙ…Ù‡ÙŠØ¯: ÙŠÙ‚Ø±Ø£ Ø³ÙŠØ§Ø³Ø© Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙˆÙŠÙ‚Ø±Ù‘Ø± Ù‡Ù„ ÙŠØ¬Ø¨ ØªØ´ØºÙŠÙ„
// Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¯Ø§Ø®Ù„ ØµÙØ­Ø© SEB Ø§Ù„Ù…ÙÙ‚Ø¯ÙÙ‘Ù…Ø© Ù…Ù† Ø§Ù„Ø®Ø§Ø¯Ù… (React Ù„Ø§ ÙŠØ¹Ù…Ù„ Ù‡Ù†Ø§Ùƒ).
// Ø¢Ù…Ù† ØªÙ…Ø§Ù…Ø§Ù‹: Ø£ÙŠ Ø®Ø·Ø£ â‡’ enabled=false ÙÙ„Ø§ ÙŠØªØ¹Ø·Ù‘Ù„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.

// Ù†Ù…ÙˆØ°Ø¬ BlazeFace Ù…Ø¶Ù…ÙÙ‘Ù† ÙÙŠ ØµÙØ­Ø© SEB: ÙÙ„ØªØ± Ù…Ø­ØªÙˆÙ‰ SEB ÙŠÙ…Ù†Ø¹ Ø¬Ù„Ø¨ Ù…Ù„Ù Ø§Ù„Ø£ÙˆØ²Ø§Ù†
// (Ø¨Ø·Ø§Ù‚Ø© Ø§Ù„Ø±Ø§Ø¯Ø§Ø± Ù…Ù† Ø¬Ù‡Ø§Ø² Ø§Ù„Ø·Ø§Ù„Ø¨: tf=true blazeface=true model=false) â€” Ø§Ù„ØªØ¶Ù…ÙŠÙ†
// ÙŠÙ„ØºÙŠ Ø§Ù„Ø¬Ù„Ø¨ Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹. ÙŠÙÙ‚Ø±Ø£ Ù…Ù† Ø§Ù„Ù‚Ø±Øµ Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø© ÙˆÙŠÙÙƒØ§Ø´ (~Ù¥Ù©Ù©Ùƒ.Ø¨ Ù†Øµ).
let mirasSebBlazeInlineTag: string | null = null;
function sebBlazeInlineModelTag(): string {
  if (mirasSebBlazeInlineTag !== null) return mirasSebBlazeInlineTag;
  try {
    const dir = path.join(process.cwd(), "public", "vendor", "blazeface-model");
    const topology = fs.readFileSync(path.join(dir, "model.json"), "utf8");
    const weights = fs.readFileSync(path.join(dir, "group1-shard1of1.bin"));
    mirasSebBlazeInlineTag =
      '<script>window.__MIRAS_BLAZE={t:' +
      topology +
      ',w:"' +
      weights.toString("base64") +
      '"};</script>';
  } catch (err) {
    console.warn("âš ï¸ SEB inline blaze model unavailable:", (err as any)?.message);
    mirasSebBlazeInlineTag = "";
  }
  return mirasSebBlazeInlineTag;
}

// Ù…Ø·Ø§Ø¨Ù‚Ø© Ø­Ø±ÙÙŠØ© Ù„Ù…Ù†Ø·Ù‚ Ø§Ù„Ø¹Ù…ÙŠÙ„ (mirasTruthyFlag + mirasExamUsesCamera): Ø§Ù„ÙƒØ´Ù Ø§Ù„Ø®Ø§Ù…
// Ø§Ù„Ø³Ø§Ø¨Ù‚ ÙƒØ§Ù† ÙŠÙÙˆÙ‘Øª ØµÙŠØº Ø§Ù„Ø­ÙØ¸ Ø§Ù„ÙØ¹Ù„ÙŠØ© ("Ù†Ø¹Ù…"/"1"/cameraEnabled/localVisionEnabled/
// ÙˆØ¬ÙˆØ¯ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø±Ø¤ÙŠØ© Ø£ØµÙ„Ø§Ù‹) ÙØªÙØªØ®Ø·Ù‰ ÙƒØ§Ù…ÙŠØ±Ø§ SEB Ø¨ØµÙ…Øª Ø±ØºÙ… Ø£Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¹Ø§Ø¯ÙŠ ÙŠØ´ØºÙ‘Ù„Ù‡Ø§.
function sebTruthyFlag(value: any): boolean {
  return (
    value === true ||
    value === 1 ||
    String(value || "").trim().toLowerCase() === "true" ||
    String(value || "").trim() === "1" ||
    ["Ù†Ø¹Ù…", "Ù…ÙØ¹Ù„", "Ù…ÙØ¹Ù‘Ù„", "ØªØ´ØºÙŠÙ„", "ÙŠØ¹Ù…Ù„"].includes(String(value || "").trim())
  );
}
function sebExamCameraBootConfig(
  exam: any,
  studentId: any,
): { enabled: boolean; mode: string; policy: string } {
  try {
    if (!exam) return { enabled: false, mode: "off", policy: "notify" };
    const lv = exam.antiCheat?.localVision || exam.localVision || {};
    const rawMode = String(lv?.mode || exam?.localVisionMode || "")
      .trim()
      .toLowerCase();
    if (rawMode === "off" || rawMode === "Ø¥ÙŠÙ‚Ø§Ù" || rawMode === "Ø§ÙŠÙ‚Ø§Ù")
      return { enabled: false, mode: "off", policy: "notify" };
    const directFlags = [
      lv?.enabled,
      lv?.cameraEnabled,
      lv?.requiresCamera,
      lv?.cameraRequired,
      lv?.useCamera,
      exam?.localVisionEnabled,
      exam?.cameraEnabled,
      exam?.requiresCamera,
      exam?.cameraRequired,
      exam?.useCamera,
      exam?.antiCheat?.localVisionEnabled,
      exam?.antiCheat?.cameraEnabled,
      exam?.antiCheat?.requiresCamera,
      exam?.antiCheat?.cameraRequired,
    ];
    const hasLocalVisionConfig =
      lv &&
      typeof lv === "object" &&
      Object.keys(lv).some((key) =>
        [
          "cameraFailurePolicy",
          "cameraExceptions",
          "cameraExceptionsText",
          "gazeAwaySeconds",
          "softLockThreshold",
          "teacherEscalationThreshold",
        ].includes(String(key)),
      );
    const usesCamera = directFlags.some(sebTruthyFlag) || !!hasLocalVisionConfig;
    const mode = ["off", "respectful", "strict"].includes(rawMode)
      ? rawMode
      : "strict";
    if (!usesCamera || mode === "off")
      return { enabled: false, mode: "off", policy: "notify" };
    const exceptions = Array.isArray(lv.cameraExceptions)
      ? lv.cameraExceptions
      : [];
    const exempt = exceptions
      .map((x: any) => String(x || "").trim().toLowerCase())
      .includes(String(studentId || "").trim().toLowerCase());
    if (exempt) return { enabled: false, mode, policy: "notify" };
    const policy = String(lv.cameraFailurePolicy || "block_start");
    return { enabled: true, mode, policy };
  } catch {
    return { enabled: false, mode: "off", policy: "notify" };
  }
}
function renderSebStartPage(req: express.Request, pass: SebPass) {
  const quitUrl = buildSebQuitUrl(req, pass.token);
  const sebExamForCamera: any = activeTeacherExams().find(
    (e: any) => String(e.id) === String(pass.examId),
  );
  const sebCameraCfg = sebExamCameraBootConfig(sebExamForCamera, pass.studentId);
  const boot = JSON.stringify({
    token: pass.token,
    camera: sebCameraCfg,
    examId: pass.examId,
    courseCode: pass.courseCode,
    quitUrl,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†</title>
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
<!-- ÙƒØ´Ù Ø§Ù„ÙˆØ¬Ù‡ Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ Ø¯Ø§Ø®Ù„ SEB (BlazeFace): Ù…Ø³ØªØ¶Ø§Ù Ø°Ø§ØªÙŠØ§Ù‹ Ø¹Ù„Ù‰ mirasedu.web.app.
     Ù…Ù‡Ù…: blazeface UMD ÙŠÙ„ØªÙ‚Ø· window.tf Ù„Ø­Ø¸Ø© ØªÙ†ÙÙŠØ° Ø§Ù„Ù…Ù„ÙØ› async ÙƒØ§Ù† ÙŠØ³Ù…Ø­ Ù„Ù‡ Ø£Ù†
     ÙŠÙÙ†ÙÙÙ‘Ø° Ø£ÙˆÙ„Ø§Ù‹ ÙÙŠ Ø¨Ø¹Ø¶ Ø¬Ù„Ø³Ø§Øª WKWebView ÙÙŠØ¨Ù‚Ù‰ Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ model=false Ø±ØºÙ… Ø¸Ù‡ÙˆØ±
     Ø§Ù„Ù…ÙƒØªØ¨ØªÙŠÙ† Ù„Ø§Ø­Ù‚Ø§Ù‹. defer ÙŠØ­Ø§ÙØ¸ Ø¹Ù„Ù‰ Ø§Ù„ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ù…ØªÙˆØ§Ø²ÙŠ ÙˆØ§Ù„ØªÙ†ÙÙŠØ° Ø¨Ø§Ù„ØªØ±ØªÙŠØ¨ Ø§Ù„Ø­Ø±ÙÙŠ. -->
${sebBlazeInlineModelTag()}
<script defer src="/vendor/tf.min.js"></script>
<script defer src="/vendor/blazeface.min.js"></script>
</head>
<body>
<div class="box">
  <section id="intro">
    <div class="shield">ğŸ›¡ï¸</div>
    <h1>Ø¬Ø§Ù‡Ø² Ù„Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†</h1>
    <div class="desc">
    Ù‚Ø¨Ù„ Ø£Ù† ØªØ¶ØºØ· "Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±"ØŒ Ø§Ù‚Ø±Ø£ Ù‡Ø°Ø§ Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡ Ø¬ÙŠØ¯Ø§Ù‹:
    <b>Ø³ÙŠÙÙ‚ÙÙ„ Ø¬Ù‡Ø§Ø²Ùƒ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±</b>
    <span class="ok">âœ“</span> Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„Ø®Ø±ÙˆØ¬ Ù„Ø£ÙŠ ØªØ·Ø¨ÙŠÙ‚ Ø£Ùˆ Ù…ÙˆÙ‚Ø¹ Ø¢Ø®Ø±.<br>
    <span class="ok">âœ“</span> Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ø®Ø° Ù„Ù‚Ø·Ø© Ø´Ø§Ø´Ø© Ø£Ùˆ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø´Ø§Ø´Ø©.<br>
    <span class="ok">âœ“</span> Ù„Ù† ØªØ³ØªØ·ÙŠØ¹ Ø§Ù„Ø®Ø±ÙˆØ¬ Ù…Ù† SEB Ø¥Ù„Ø§ Ø¨Ø¹Ø¯ ØªØ³Ù„ÙŠÙ… Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.
    <b>Ø¥Ø°Ø§ Ù„Ù… ØªÙƒÙ† Ø¬Ø§Ù‡Ø²Ø§Ù‹ Ø§Ù„Ø¢Ù†</b>
    Ø§Ø¶ØºØ· "Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù†" Ø¨Ø§Ù„Ø£Ø³ÙÙ„ØŒ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù„Ù… ÙŠØ¨Ø¯Ø£ ÙˆÙ„Ù† ØªÙØ³Ø¬ÙÙ‘Ù„ Ø¹Ù„ÙŠÙƒ Ø£ÙŠ Ù…Ø­Ø§ÙˆÙ„Ø©. ØªØ³ØªØ·ÙŠØ¹ Ø§Ù„Ø±Ø¬ÙˆØ¹ Ù„Ù…ÙØ±Ø§Ø³ ÙˆÙ…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„ÙØªØ­ Ù…Ù† Ø¬Ø¯ÙŠØ¯ Ù„Ø§Ø­Ù‚Ø§Ù‹.
  </div>
    <button class="start" id="startBtn" type="button">Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù†</button>
    <a class="quit" href="${xmlEscape(quitUrl)}">Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù† Ø¨Ø¯ÙˆÙ† Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±</a>
    <p class="muted">Ø¥Ø°Ø§ Ø¸Ù‡Ø±Øª Ø£ÙŠ Ù…Ø´ÙƒÙ„Ø©ØŒ Ø§Ø³ØªØ®Ø¯Ù… Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù†. ÙƒÙ„Ù…Ø© Ø§Ù„Ø®Ø±ÙˆØ¬ Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨: Miras</p>
    <div class="rescue hidden" id="rescueBox">
      <h3>ØªØ£Ø®Ø± ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø£Ø³Ø¦Ù„Ø©</h3>
      <p>Ù„Ù… ØªØµÙ„ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© Ø®Ù„Ø§Ù„ Ø§Ù„ÙˆÙ‚Øª Ø§Ù„Ù…ØªÙˆÙ‚Ø¹. Ø¥Ø°Ø§ Ø§Ø³ØªÙ…Ø±Øª Ø§Ù„Ù…Ø´ÙƒÙ„Ø© Ø§Ø³ØªØ®Ø¯Ù… Ø²Ø± Ø§Ù„Ø®Ø±ÙˆØ¬ Ø¨Ø§Ù„Ø£Ø¹Ù„Ù‰ ÙˆØ£Ø¨Ù„Øº Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨.</p>
    </div>
    <div class="status hidden" id="statusBox"></div>
    <div class="error hidden" id="errorBox"></div>
  </section>
  <section id="exam" class="hidden">
    <div class="top">
      <h2 id="examTitle">Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†</h2>
      <div class="top-meta">
        <div id="ambient-save-status" class="ambient-status status-idle"><span class="ambient-dot"></span><span class="ambient-txt">Ø¬Ø§Ù‡Ø² ÙˆÙ…Ø¤Ù…Ù‘Ù†</span></div>
        <span class="timer" id="timer">30:00</span>
      </div>
    </div>
    <div class="q-navigation" id="qPagerDots"></div>
    <div id="questions"></div>
    
    <div class="q-slider-actions">
      <button class="nav-btn-alt" id="sliderPrevBtn" type="button" disabled title="Ø§Ù„Ø³Ø§Ø¨Ù‚" aria-label="Ø§Ù„Ø³Ø§Ø¨Ù‚">&#8594;</button>
      <button class="nav-btn-alt" id="sliderNextBtn" type="button" title="Ø§Ù„ØªØ§Ù„ÙŠ" aria-label="Ø§Ù„ØªØ§Ù„ÙŠ">&#8592;</button>
    </div>
    
    <div class="actions">
      <button class="submit" id="submitBtn" type="button">ØªØ³Ù„ÙŠÙ… Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±</button>
      <!-- Ø¨Ù‚Ø±Ø§Ø± Ø§Ù„Ù…Ø§Ù„Ùƒ: Ø£ÙØ²ÙŠÙ„ Ø²Ø± Â«Ø§Ù†Ø³Ø­Ø§Ø¨ Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±Â» Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹ â€” Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¨Ø¹Ø¯
           Ø¨Ø¯Ø¦Ù‡ ÙŠÙ†ØªÙ‡ÙŠ Ø¨Ø§Ù„ØªØ³Ù„ÙŠÙ… ÙÙ‚Ø· (ÙƒØ§Ù† Ø§Ù„Ø§Ù†Ø³Ø­Ø§Ø¨ ÙŠØªØ±Ùƒ Ø¨Ø·Ø§Ù‚Ø© "Ø¨Ø§Ù†ØªØ¸Ø§Ø±" Ù…Ø¶Ù„Ù„Ø©
           Ø¹Ù†Ø¯ Ø§Ù„Ù…Ø¹Ù„Ù…). Â«Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù† Ø¨Ø¯ÙˆÙ† Ø¨Ø¯Ø¡Â» Ù‚Ø¨Ù„ Ø§Ù„Ø¨Ø¯Ø¡ ÙˆÂ«Ø§Ù„Ø®Ø±ÙˆØ¬ Ø§Ù„Ø¢Ù…Ù†Â» Ø¨Ø¹Ø¯
           Ø§Ù„ØªØ³Ù„ÙŠÙ… Ø¨Ø§Ù‚ÙŠØ§Ù† ÙƒÙ…Ø§ Ù‡Ù…Ø§. -->
    </div>
  </section>
  <!-- Ø²Ø± Ø§Ù„Ø·ÙˆØ§Ø±Ø¦: Ù…Ø®ÙÙŠ Ø§ÙØªØ±Ø§Ø¶ÙŠØ§Ù‹ â€” Ø¨Ù‚Ø±Ø§Ø± Ø§Ù„Ù…Ø§Ù„Ùƒ ÙŠØ¸Ù‡Ø± ÙÙ‚Ø· ÙÙŠ Ø§Ù„Ø­Ø§Ù„Ø§Øª Ø§Ù„ØªÙŠ Ù„Ø§
       Ù…Ø®Ø±Ø¬ ÙÙŠÙ‡Ø§ (ØµÙØ­Ø© Ø¨ÙŠØ¶Ø§Ø¡/Ø¹Ø·Ù„)Ø› Ø§Ù„Ø´Ø§Ø´Ø§Øª Ø§Ù„Ø·Ø¨ÙŠØ¹ÙŠØ© ÙÙŠÙ‡Ø§ ØªØ³Ù„ÙŠÙ…/Ø®Ø±ÙˆØ¬ Ø£ØµÙ„Ø§Ù‹. -->
  <a id="sebGlobalQuit" href="${xmlEscape(quitUrl)}" style="display:none;position:fixed;bottom:10px;right:10px;z-index:2147483000;background:rgba(15,23,42,.55);color:#fca5a5;font-weight:800;font-size:11px;padding:6px 12px;border-radius:999px;text-decoration:none;border:1px solid rgba(252,165,165,.35);backdrop-filter:blur(6px)">Ø®Ø±ÙˆØ¬ Ø·ÙˆØ§Ø±Ø¦</a>
  <section id="result" class="hidden">
    <div class="shield">âœ“</div>
    <h1>ØªÙ… ØªØ³Ù„ÙŠÙ… Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±</h1>
    <div class="status" id="resultBox">ØªÙ… Ø­ÙØ¸ Ø§Ù„ØªØ³Ù„ÙŠÙ…. ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„Ø®Ø±ÙˆØ¬ Ù…Ù† SEB Ø¨Ø£Ù…Ø§Ù†.</div>
    <a class="quit" href="${xmlEscape(quitUrl)}">Ø§Ù„Ø®Ø±ÙˆØ¬ Ø§Ù„Ø¢Ù…Ù† Ù…Ù† SEB</a>
  </section>
</div>
<script>
const boot=${boot};
// Ù…ØµÙŠØ¯Ø© Ø§Ù„ØµÙØ­Ø© Ø§Ù„Ø¨ÙŠØ¶Ø§Ø¡ (Ø¹Ø·Ù„ Ù†Ø§Ø¯Ø± Ø¨Ø¹Ø¯ "Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±"): Ù„Ùˆ Ø§Ø®ØªÙØª ÙƒÙ„ Ø§Ù„Ø£Ù‚Ø³Ø§Ù…
// Ù†ÙØ¸Ù‡Ø± Ø±Ø³Ø§Ù„Ø© ÙˆØ§Ø¶Ø­Ø© (ÙˆØ²Ø± Ø§Ù„Ø·ÙˆØ§Ø±Ø¦ Ø§Ù„Ø¯Ø§Ø¦Ù… Ù…ÙˆØ¬ÙˆØ¯ Ø¯Ø§Ø¦Ù…Ø§Ù‹) ÙˆÙ†Ø¨Ù„Ù‘Øº Ø§Ù„Ø±Ø§Ø¯Ø§Ø± Ø¨Ø§Ù„Ø³Ø¨Ø¨.
var sebWhiteReported=0;
setInterval(function(){
  try{
    var anyVisible=["intro","exam","result"].some(function(id){var el=document.getElementById(id);return el&&!el.classList.contains("hidden");});
    var gq=document.getElementById("sebGlobalQuit");
    if(gq)gq.style.display=anyVisible?"none":"inline-block";
    if(!anyVisible){
      var eb=document.getElementById("errorBox");
      if(eb&&eb.classList.contains("hidden")){
        eb.textContent="Ø­Ø¯Ø« Ø®Ù„Ù„ ÙÙŠ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±. Ø§Ø¶ØºØ· Ø²Ø± (Ø®Ø±ÙˆØ¬ Ø·ÙˆØ§Ø±Ø¦) Ø£Ø³ÙÙ„ Ø§Ù„Ø´Ø§Ø´Ø© Ø«Ù… Ø£Ø¹Ø¯ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ù† Ù…ÙØ±Ø§Ø³.";
        eb.classList.remove("hidden");
      }
      if(!sebWhiteReported){sebWhiteReported=1;
        try{fetch("/api/monitor/report",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({message:"SEB white-screen: ÙƒÙ„ Ø§Ù„Ø£Ù‚Ø³Ø§Ù… Ù…Ø®ÙÙŠØ© Ø¨Ø¹Ø¯ Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±",stack:"UA: "+String(navigator.userAgent||"").slice(0,140),url:"/seb/start#white",source:"seb",role:"student",userId:String((boot&&boot.examId)||"")})}).catch(function(){});}catch(e){}
      }
    }
  }catch(e){}
},4000);
// Ø±Ø§Ø¯Ø§Ø± Ù…ÙØ±Ø§Ø³: Ø£Ø®Ø·Ø§Ø¡ ØµÙØ­Ø© SEB ÙƒØ§Ù†Øª ØºÙŠØ± Ù…Ø±Ø¦ÙŠØ© Ù„Ø£ÙŠ Ø£Ø­Ø¯ â€” Ø§Ù„Ø¢Ù† ØªÙØ¨Ù„ÙÙ‘Øº ÙÙˆØ±Ø§Ù‹.
(function(){var sent=0;window.addEventListener("error",function(e){try{if(sent>=5)return;sent++;fetch("/api/monitor/report",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({message:String(e.message||"seb error").slice(0,300),stack:String((e.error&&e.error.stack)||"").slice(0,1500),url:"/seb/start",source:"seb"})}).catch(function(){});}catch(x){}});window.addEventListener("unhandledrejection",function(e){try{if(sent>=5)return;sent++;var r=e.reason||{};fetch("/api/monitor/report",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({message:String(r.message||r||"seb rejection").slice(0,300),stack:String(r.stack||"").slice(0,1500),url:"/seb/start",source:"seb"})}).catch(function(){});}catch(x){}});})();
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
let examFinished=false;

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
  if(examFinished||!studentId||!examId||!activeExamSessionId) return;
  try {
    const resp=await fetch("/api/exam-lock/heartbeat",{method:"POST",headers:headers(),body:JSON.stringify({studentId,examId,sessionId:activeExamSessionId,deviceId:deviceId(),displayMode:displayMode()})});
    // Ø¨Ø¹Ø¯ Ø§Ù„ØªØ³Ù„ÙŠÙ… ØªÙØºÙ„Ù‚ Ø§Ù„Ø¬Ù„Ø³Ø© Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø§Ø¯Ù…ØŒ ÙÙ‚Ø¯ ÙŠØ±Ø¬Ø¹ Ù†Ø¨Ø¶ ÙƒØ§Ù† Ù‚ÙŠØ¯ Ø§Ù„Ø·Ø±ÙŠÙ‚ Ø¨Ø®Ø·Ø£.
    // Ø¥Ø°Ø§ ÙƒØ§Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù‚Ø¯ Ø³ÙÙ„Ù‘Ù… ÙØ¹Ù„Ø§Ù‹ Ù†ØªØ¬Ø§Ù‡Ù„Ù‡ ØªÙ…Ø§Ù…Ø§Ù‹ Ø­ØªÙ‰ Ù„Ø§ ØªØ¸Ù‡Ø± Ø´Ø§Ø´Ø© Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©
    // ÙˆØ±Ø³Ø§Ù„Ø© "Ø§Ù†ØªÙ‡Øª Ø¬Ù„Ø³Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±" ÙÙˆÙ‚ Ø´Ø§Ø´Ø© "ØªÙ… Ø§Ù„ØªØ³Ù„ÙŠÙ…" ÙˆØªÙØ±Ø¨Ùƒ Ø§Ù„Ø·Ø§Ù„Ø¨.
    if(!resp.ok){
      if(examFinished) return;
      const data=await resp.json().catch(()=>({}));
      stopExamHeartbeat();
      hide("exam");show("intro");
      setError(data.error||"Ø§Ù†ØªÙ‡Øª Ø¬Ù„Ø³Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.");
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
function setError(message){text("errorBox",message+" Ø¥Ø°Ø§ Ø§Ø³ØªÙ…Ø±Øª Ø§Ù„Ù…Ø´ÙƒÙ„Ø© Ø§Ø³ØªØ®Ø¯Ù… Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù† ÙˆØ£Ø¨Ù„Øº Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨. ÙƒÙ„Ù…Ø© Ø§Ù„Ø®Ø±ÙˆØ¬: Miras");show("errorBox");hide("statusBox");}

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
  statusEl.querySelector(".ambient-txt").textContent="Ø¬Ø§Ø±Ù Ø§Ù„Ø­ÙØ¸ Ù…Ø­Ù„ÙŠÙ‹Ø§â€¦";
  
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
        statusEl.querySelector(".ambient-txt").textContent="ØªÙ…Øª Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© ÙˆØ§Ù„Ø­ÙØ¸ Ø¨Ù†Ø¬Ø§Ø­";
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
      statusEl.querySelector(".ambient-txt").textContent="Ø§Ù†Ù‚Ø·Ø§Ø¹ Ø§Ù„Ø§ØªØµØ§Ù„ (ØªÙ… Ø§Ù„ØªØ£Ù…ÙŠÙ† Ù…Ø­Ù„ÙŠÙ‹Ø§)";
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
  hide("intro");show("exam");text("examTitle",title||"Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†");startTimer(minutes);
  
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
    head.innerHTML="<span>Ø§Ù„Ø³Ø¤Ø§Ù„ "+(idx+1)+" Ù…Ù† "+questions.length+"</span><span>"+(q.points||1)+" Ø¯Ø±Ø¬Ø©</span>";
    card.appendChild(head);
    
    const qtext=document.createElement("p");qtext.className="qtext";qtext.textContent=q.questionText||"Ø³Ø¤Ø§Ù„";
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

// â”€â”€ Ù…Ø±Ø§Ù‚Ø¨Ø© Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ø¯Ø§Ø®Ù„ SEB (Ø¨Ù„Ø§ React) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ØµÙØ­Ø© SEB Ù…ÙÙ‚Ø¯ÙÙ‘Ù…Ø© Ù…Ù† Ø§Ù„Ø®Ø§Ø¯Ù… ÙÙ„Ø§ ÙŠØ¹Ù…Ù„ ÙÙŠÙ‡Ø§ ÙƒÙˆØ¯ Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© ÙÙŠ React. Ù‡Ù†Ø§ Ù†ÙØ´ØºÙ‘Ù„
// Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„ØªÙŠ ØªØªØ·Ù„Ø¨Ù‡Ø§ØŒ Ù†Ø¹Ø±Ø¶ Ù…Ø¹Ø§ÙŠÙ†Ø© ØµØºÙŠØ±Ø©ØŒ ÙˆÙ†Ø±Ø³Ù„ Ù†Ø¨Ø¶Ø§Øª Ø§Ù„Ù†Ø²Ø§Ù‡Ø© Ù„Ù†ÙØ³
// Ù†Ù‚Ø·Ø© /api/exam-integrity/pulse. ÙƒØ´Ù Ø¨Ù„Ø§ FaceDetector: Ø¸Ù„Ø§Ù…/ØªØºØ·ÙŠØ©ØŒ ÙˆØ§Ù†Ø­Ø±Ø§Ù Ù…Ø±ÙƒØ²
// Ø§Ù„Ø¥Ø¶Ø§Ø¡Ø© Ø§Ù„Ø£ÙÙ‚ÙŠ (Ø§Ù„ØªÙØ§Øª Ø§Ù„Ø±Ø£Ø³/Ø§Ù„Ø®Ø±ÙˆØ¬ Ù…Ù† Ø§Ù„Ø¥Ø·Ø§Ø±). ÙƒÙ„ Ø´ÙŠØ¡ Ø¯Ø§Ø®Ù„ try ÙÙ„Ø§ ÙŠØ¹Ø·Ù‘Ù„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.
var sebCamStream=null,sebCamVideo=null,sebCamCanvas=null,sebCamCtx=null,sebCamTimer=null;
var sebCamPreviewStream=null,sebCamWatchdogTimer=null,sebCamWatchdogBusy=false;
var sebCamLastPreviewTime=-1,sebCamLastAnalysisTime=-1,sebCamStallSince=0,sebCamAnalysisStallSince=0,sebCamTrackMutedSince=0,sebCamLastRecoveryAt=0;
var sebBlazeModel=null,sebBlazeBusy=false,sebBlazeTried=false,sebBlazeCanvas=null,sebBlazeCtx=null,sebBlazeLastTryAt=0;
var sebBlazeReportedErrors={};
function sebBlazeReportError(stage,err){
  try{
    var name=String((err&&err.name)||"Error"),message=String((err&&err.message)||err||"unknown");
    var key=String(stage||"unknown")+"|"+name+"|"+message;
    if(sebBlazeReportedErrors[key])return;sebBlazeReportedErrors[key]=1;
    try{if(err&&typeof err==="object")err.__mirasBlazeReported=true;}catch(x){}
    sebRadarReport("SEB blaze "+String(stage||"unknown")+" failed: "+name+(message?" â€” "+message:""),name);
  }catch(e){}
}
function sebBlazeStage(stage,promise){
  return Promise.resolve(promise).catch(function(e){sebBlazeReportError(stage,e);throw e;});
}
function sebBlazeLoadInlineModel(){
  var mb=window.__MIRAS_BLAZE;
  if(!mb||!mb.t||!mb.w)throw new Error("inline BlazeFace model is unavailable");
  var bin=atob(mb.w),len=bin.length,arr=new Uint8Array(len);
  for(var bi=0;bi<len;bi++)arr[bi]=bin.charCodeAt(bi);
  var manifest=mb.t.weightsManifest;
  if(!Array.isArray(manifest)||!manifest[0]||!Array.isArray(manifest[0].weights))throw new Error("inline BlazeFace manifest is invalid");
  var handler={load:function(){return Promise.resolve({
    modelTopology:mb.t.modelTopology,
    weightSpecs:manifest[0].weights,
    weightData:arr.buffer,
    format:mb.t.format,generatedBy:mb.t.generatedBy,convertedBy:mb.t.convertedBy});}};
  return window.blazeface.load({maxFaces:3,modelUrl:handler});
}
// ØªØ³Ø®ÙŠÙ† Ø§Ù„Ù…Ø­Ø±Ùƒ: Ø£ÙˆÙ„ Ø§Ø³ØªØ¯Ù„Ø§Ù„ ÙŠØ¬Ù…Ù‘Ø¹ Ù†ÙˆÙ‰ Ø§Ù„Ø­Ø³Ø§Ø¨ (ÙŠØ£Ø®Ø° Ù¡-Ù£Ø«) â€” Ù†Ù†ÙØ°Ù‡ Ø¹Ù„Ù‰ Ù„ÙˆØ­Ø©
// ÙØ§Ø±ØºØ© ÙÙˆØ± Ø§Ù„ØªØ­Ù…ÙŠÙ„ØŒ ÙÙŠØµÙŠØ± Ø£ÙˆÙ„ ÙØ­Øµ Ø­Ù‚ÙŠÙ‚ÙŠ Ù„ÙˆØ¬Ù‡ Ø§Ù„Ø·Ø§Ù„Ø¨ ÙÙˆØ±ÙŠØ§Ù‹.
function sebBlazeWarmup(m){
  try{
    var wc=document.createElement("canvas");wc.width=160;wc.height=120;
    wc.getContext("2d").fillRect(0,0,160,120);
    Promise.resolve(m.estimateFaces(wc,false)).catch(function(e){sebBlazeReportError("warmup",e);});
  }catch(e){sebBlazeReportError("warmup-sync",e);}
}
// ØªØ­Ù…ÙŠÙ„ Ù†Ù…ÙˆØ°Ø¬ BlazeFace (ÙƒØ´Ù Ø§Ù„ÙˆØ¬Ù‡ Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ) Ø¯Ø§Ø®Ù„ SEB Ø¨Ù„Ø§ Ø­Ø¬Ø¨: Ù†Ù†ØªØ¸Ø± ØªÙˆÙÙ‘Ø±
// window.tf Ùˆ window.blazeface (Ù…ÙØ­Ù…ÙÙ‘Ù„ÙŠÙ† Ø¨Ø§Ù„ØªØ±ØªÙŠØ¨ Ø¹Ø¨Ø± defer Ù…Ù† /vendor)ØŒ Ø«Ù… Ø§Ù„Ù†Ù…ÙˆØ°Ø¬.
// Ø£ÙŠ ÙØ´Ù„ ÙŠÙØ¨Ù‚ÙŠ sebBlazeModel=null ÙÙŠØªØ±Ø§Ø¬Ø¹ Ø§Ù„ØªØ­Ù„ÙŠÙ„ Ù„ÙƒØ´Ù Ø§Ù„Ø­Ø±ÙƒØ© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ.
function sebTryLoadBlaze(){
  try{
    if(sebBlazeTried||sebBlazeModel)return;
    if(!window.tf||!window.blazeface)return;
    if(Date.now()-sebBlazeLastTryAt<2500)return;
    sebBlazeLastTryAt=Date.now();
    sebBlazeTried=true;
    var tfReady;
    try{tfReady=window.tf.ready?window.tf.ready():Promise.resolve();}
    catch(e){sebBlazeReportError("tf-ready-sync",e);throw e;}
    sebBlazeStage("tf-ready",tfReady).then(function(){
      // Ø­ØªÙ…ÙŠØ© Ø¯Ø§Ø®Ù„ SEB (Ø¨Ø·Ø§Ù‚Ø§Øª Ø§Ù„Ø±Ø§Ø¯Ø§Ø±: model=false ÙŠØ¸Ù‡Ø± ÙˆÙŠØ®ØªÙÙŠ Ø¨ÙŠÙ† Ø§Ù„Ø¬Ù„Ø³Ø§Øª â€”
      // ØªÙ‡ÙŠØ¦Ø© Ø±Ø³ÙˆÙ…ÙŠØ§Øª WebView Ù…ØªÙ‚Ù„Ø¨Ø©): Ù†Ù„Ø²Ù… Ø®Ù„ÙÙŠØ© CPU Ø§Ù„Ù…Ø¶Ù…ÙˆÙ†Ø©. Ù…Ø¹ Ù†Ù…ÙˆØ°Ø¬ ØµØºÙŠØ±
      // ÙˆÙ„ÙˆØ­Ø© ÙØ­Øµ Ù¡Ù¦Ù Ã—Ù¡Ù¢Ù  Ø§Ù„Ø§Ø³ØªØ¯Ù„Ø§Ù„ ~Ù¥Ù -Ù¡Ù¥Ù Ù…Ù„Ù„ÙŠ â€” Ø£Ø³Ø±Ø¹ Ù…Ù† Ù†Ø¨Ø¶ØªÙ†Ø§ Ø¨ÙƒØ«ÙŠØ±.
      // (Ù‡Ø°Ø§ Ø¯Ø§Ø®Ù„ ØµÙØ­Ø© SEB ÙÙ‚Ø· â€” Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¹Ø§Ø¯ÙŠ Ù„Ø§ ÙŠÙ…Ø³Ù‘Ù‡ Ù‡Ø°Ø§ Ø§Ù„Ù…Ù„Ù Ø£ØµÙ„Ø§Ù‹.)
      if(!window.tf.setBackend)return;
      var backendPromise;
      try{backendPromise=window.tf.setBackend("cpu");}
      catch(e){sebBlazeReportError("tf-backend-sync",e);throw e;}
      return sebBlazeStage("tf-backend",backendPromise).then(function(ok){
        if(ok===false){var backendError=new Error("tf.setBackend(cpu) returned false");sebBlazeReportError("tf-backend-result",backendError);throw backendError;}
        var readyAfterBackend=window.tf.ready?window.tf.ready():undefined;
        return sebBlazeStage("tf-ready-after-backend",readyAfterBackend);
      });
    }).then(function(){
      // ğŸ¯ Ø¬Ø°Ø± "model=false" (Ø¨Ø·Ø§Ù‚Ø© Ø§Ù„Ø±Ø§Ø¯Ø§Ø± Ù…Ù† Ø¬Ù‡Ø§Ø² Ø§Ù„Ø·Ø§Ù„Ø¨): ÙÙ„ØªØ± Ù…Ø­ØªÙˆÙ‰ SEB
      // ÙŠÙ…Ù†Ø¹ Ø¬Ù„Ø¨ Ù…Ù„Ù Ø£ÙˆØ²Ø§Ù† Ø§Ù„Ù†Ù…ÙˆØ°Ø¬. Ø§Ù„Ø­Ù„ Ø§Ù„Ù‚Ø§Ø·Ø¹: Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ù…Ø¶Ù…ÙÙ‘Ù† ÙƒØ§Ù…Ù„Ø§Ù‹ ÙÙŠ
      // Ø§Ù„ØµÙØ­Ø© (window.__MIRAS_BLAZE) ÙˆÙŠÙØ­Ù…ÙÙ‘Ù„ Ù…Ù† Ø§Ù„Ø°Ø§ÙƒØ±Ø© â€” ØµÙØ± Ø¬Ù„Ø¨ØŒ ØµÙØ± ÙÙ„ØªØ±.
      try{return sebBlazeStage("model-load",sebBlazeLoadInlineModel());}
      catch(e){sebBlazeReportError("model-inline-sync",e);throw e;}
    }).then(function(m){
      if(!m||typeof m.estimateFaces!=="function"){
        var invalidModelError=new Error("BlazeFace returned an invalid model");
        sebBlazeReportError("model-validate",invalidModelError);throw invalidModelError;
      }
      sebBlazeModel=m;sebBlazeWarmup(m);
    }).catch(function(e){
      // ÙƒÙ„ ÙØ´Ù„ ÙŠØµÙ„ Ø§Ù„Ø¢Ù† Ø¨Ø§Ø³Ù…Ù‡ ÙˆÙ†ØµÙ‡ Ø§Ù„Ø­Ø±ÙÙŠ Ø¥Ù„Ù‰ Ø§Ù„Ø±Ø§Ø¯Ø§Ø±. Ù†Ø¹ÙŠØ¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø¨Ø¹Ø¯ Ù…Ù‡Ù„Ø©
      // Ù‚ØµÙŠØ±Ø©ØŒ Ù„ÙƒÙ† Ù…Ù† Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ù…Ø¶Ù…Ù‘Ù† Ù†ÙØ³Ù‡ ÙÙ‚Ø·Ø› Ù„Ø§ Ù†Ø¹ÙˆØ¯ Ø¥Ù„Ù‰ Ø¬Ù„Ø¨ .bin Ø§Ù„Ù…Ø­Ø¬ÙˆØ¨.
      if(!(e&&e.__mirasBlazeReported))sebBlazeReportError("pipeline",e);
      sebBlazeModel=null;sebBlazeTried=false;
    });
  }catch(e){if(!(e&&e.__mirasBlazeReported))sebBlazeReportError("load-sync",e);sebBlazeTried=false;}
}
function sebBlazeMode2(){return (boot.camera&&boot.camera.mode)||"strict";}
async function sebBlazeDetect(){
  if(sebBlazeBusy||!sebBlazeModel||!sebCamVideo||sebCamVideo.readyState<2)return;
  sebBlazeBusy=true;
  var preds=[];
  try{
    // Ù†Ø³Ø®Ø© Ù…ØµØºÙ‘Ø±Ø© Ù¡Ù¦Ù Ã—Ù¡Ù¢Ù  Ù„Ù„ÙØ­Øµ: Ø¯Ù‚Ø© ÙƒØ§ÙÙŠØ© ØªÙ…Ø§Ù…Ø§Ù‹ Ù„ÙƒØ´Ù Ø§Ù„ÙˆØ¬Ù‡/Ø§Ù„Ø£Ù†ÙØŒ ÙˆØ£Ø³Ø±Ø¹
    // Ø£Ø¶Ø¹Ø§ÙØ§Ù‹ Ù…Ù† Ù…Ø¹Ø§Ù„Ø¬Ø© Ø¥Ø·Ø§Ø± Ø§Ù„ÙÙŠØ¯ÙŠÙˆ Ø§Ù„ÙƒØ§Ù…Ù„ (Ø®ØµÙˆØµØ§Ù‹ Ø¹Ù„Ù‰ Ø®Ù„ÙÙŠØ© CPU Ø¯Ø§Ø®Ù„ SEB).
    if(!sebBlazeCanvas){sebBlazeCanvas=document.createElement("canvas");sebBlazeCanvas.width=160;sebBlazeCanvas.height=120;sebBlazeCtx=sebBlazeCanvas.getContext("2d");}
    sebBlazeCtx.drawImage(sebCamVideo,0,0,160,120);
    preds=await sebBlazeModel.estimateFaces(sebBlazeCanvas,false);
  }catch(e){sebBlazeReportError("estimate",e);preds=[];}
  sebBlazeBusy=false;
  if(!Array.isArray(preds))preds=[];
  var fc=preds.length;
  if(fc===0){sebCamCounters.face_missing=(sebCamCounters.face_missing||0)+1;
    if(sebCamCounters.face_missing>=2){sebSendVisionPulse("face_missing",{engine:"blazeface"});sebCamEngage("face_missing","Ø£Ø¹Ø¯ ÙˆØ¬Ù‡Ùƒ Ù„Ù„ÙƒØ§Ù…ÙŠØ±Ø§.");}
  }else{sebCamCounters.face_missing=0;}
  if(fc>1){sebCamCounters.multiple_faces=(sebCamCounters.multiple_faces||0)+1;
    if(sebCamCounters.multiple_faces>=2){sebSendVisionPulse("multiple_faces",{faceCount:fc,engine:"blazeface"});sebCamEngage("multiple_faces","Ø®Ù„Ù‘Ùƒ ÙˆØ­Ø¯Ùƒ Ø£Ù…Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.");}
  }else{sebCamCounters.multiple_faces=0;}
  if(fc===1){
    var p=preds[0],tl=p.topLeft,br=p.bottomRight;
    var x0=Array.isArray(tl)?Number(tl[0]):Number((tl&&tl[0])||0);
    var x1=Array.isArray(br)?Number(br[0]):Number((br&&br[0])||0);
    var boxW=Math.max(1,x1-x0),boxC=(x0+x1)/2,fr=boxC/160;
    var nose=Array.isArray(p.landmarks)?p.landmarks[2]:null;
    var noseX=nose?(Array.isArray(nose)?Number(nose[0]):Number(nose.x||boxC)):boxC;
    var noseOff=Math.abs((noseX-boxC)/boxW);
    var m=sebBlazeMode2();var edge=m==="strict"?0.25:0.18;var nl=m==="strict"?0.18:0.28;
    if(fr<edge||fr>1-edge||noseOff>nl){sebCamCounters.attn=(sebCamCounters.attn||0)+1;
      if(sebCamCounters.attn>=2){sebSendVisionPulse("attention_away",{ratio:Number(fr.toFixed(3)),noseOffset:Number(noseOff.toFixed(3)),engine:"blazeface"});sebCamEngage("attention_away","Ø§Ø±Ø¬Ø¹ Ø¨Ù†Ø¸Ø±Ùƒ Ù„Ù„Ø´Ø§Ø´Ø©.");}
    }else{sebCamCounters.attn=0;}
  }
  sebCamMaybeRecover();
}
var sebCamCounters={},sebCamLastPulse={},sebCamAttnBase=null,sebCamLocked=false,sebCamClearSince=0;
function sebCamMode(){return (boot.camera&&boot.camera.mode)||"strict";}
function sebSendVisionPulse(pulseType,details){
  try{
    var now=Date.now();if(now-(sebCamLastPulse[pulseType]||0)<3500)return;sebCamLastPulse[pulseType]=now;
    fetch("/api/exam-integrity/pulse",{method:"POST",headers:headers(),keepalive:true,body:JSON.stringify({
      studentId:studentId,examId:examId,sessionId:activeExamSessionId,pulseType:pulseType,label:pulseType,
      details:details||{},mode:sebCamMode(),privacy:"metadata_only_no_frames",source:"seb"})}).catch(function(){});
  }catch(e){}
}
function sebCamGuidance(pulseType){
  var map={
    face_missing:{title:"Ø£Ø¹Ø¯ ÙˆØ¬Ù‡Ùƒ Ù„Ù„ÙƒØ§Ù…ÙŠØ±Ø§",detail:"Ø¶Ø¹ ÙˆØ¬Ù‡Ùƒ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ ÙÙŠ Ù…Ù†ØªØµÙ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©ØŒ ÙˆØ§Ø¬Ø¹Ù„ Ø§Ù„Ø¹ÙŠÙ†ÙŠÙ† ÙˆØ§Ø¶Ø­ØªÙŠÙ† Ø£Ù…Ø§Ù… Ø§Ù„Ø´Ø§Ø´Ø©."},
    attention_away:{title:"Ø§Ø±Ø¬Ø¹ Ø¨Ù†Ø¸Ø±Ùƒ Ù„Ù„Ø´Ø§Ø´Ø©",detail:"ÙˆØ¬Ù‘Ù‡ ÙˆØ¬Ù‡Ùƒ ÙˆÙ†Ø¸Ø±Ùƒ Ø¥Ù„Ù‰ Ù…Ù†ØªØµÙ Ø§Ù„Ø´Ø§Ø´Ø© ÙˆØ«Ø¨Ù‘Øª ÙˆØ¶Ø¹Ùƒ Ù„Ø­Ø¸Ø§Øª Ù‚Ù„ÙŠÙ„Ø©."},
    multiple_faces:{title:"Ø´Ø®Øµ ÙˆØ§Ø­Ø¯ Ø£Ù…Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§",detail:"ØªØ£ÙƒØ¯ Ø£Ù† Ù„Ø§ ÙŠØ¸Ù‡Ø± Ø´Ø®Øµ Ø¢Ø®Ø± Ø¯Ø§Ø®Ù„ Ø¥Ø·Ø§Ø± Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±."},
    camera_blocked:{title:"ÙˆØ¶Ù‘Ø­ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§",detail:"Ø£Ø²Ù„ ÙŠØ¯Ùƒ Ø£Ùˆ Ø£ÙŠ ØºØ·Ø§Ø¡ Ø¹Ù† Ø§Ù„Ø¹Ø¯Ø³Ø©ØŒ ÙˆØªØ£ÙƒØ¯ Ù…Ù† ÙˆØ¬ÙˆØ¯ Ø¥Ø¶Ø§Ø¡Ø© ÙƒØ§ÙÙŠØ© Ù„Ø¸Ù‡ÙˆØ± ÙˆØ¬Ù‡Ùƒ."}
  };
  return map[pulseType]||{title:"Ù„Ø­Ø¸Ø© ØªØ­Ù‚Ù‚",detail:"Ø£Ø¹Ø¯ ÙˆØ¬Ù‡Ùƒ ÙˆØ§Ù„Ø¬Ù‡Ø§Ø² Ù„Ù„ÙˆØ¶Ø¹ Ø§Ù„Ø·Ø¨ÙŠØ¹ÙŠ Ø£Ù…Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§."};
}
function sebCamOverlayShow(msg,pulseType,recoverSeconds){
  try{
    var o=document.getElementById("sebCamWarn");
    if(!o){
      o=document.createElement("div");o.id="sebCamWarn";o.setAttribute("role","alert");o.setAttribute("aria-live","assertive");
      o.style.cssText="position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,.88);font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:18px;box-sizing:border-box;backdrop-filter:blur(12px)";
      var card=document.createElement("div");card.style.cssText="width:min(420px,100%);border:1px solid rgba(255,255,255,.16);border-radius:26px;background:#fff;color:#0f172a;padding:22px;box-sizing:border-box;box-shadow:0 30px 90px rgba(0,0,0,.42)";
      var icon=document.createElement("div");icon.textContent="â—‰";icon.style.cssText="width:56px;height:56px;border-radius:18px;display:grid;place-items:center;margin:0 auto 12px;background:#ecfdf5;color:#047857;font-size:26px;font-weight:900";
      var title=document.createElement("h3");title.id="sebCamWarnTitle";title.style.cssText="margin:0;text-align:center;font-size:19px;font-weight:900";
      var body=document.createElement("p");body.id="sebCamWarnBody";body.style.cssText="margin:10px 0 0;text-align:center;font-size:14px;font-weight:900;line-height:2;color:#334155";
      var detail=document.createElement("p");detail.id="sebCamWarnDetail";detail.style.cssText="margin:7px 0 0;text-align:center;font-size:12px;font-weight:700;line-height:1.9;color:#64748b";
      var status=document.createElement("div");status.id="sebCamWarnStatus";status.style.cssText="margin-top:14px;border:1px solid #d1fae5;border-radius:16px;background:#ecfdf5;color:#047857;padding:11px;font-size:11px;font-weight:900;line-height:1.8";
      var privacy=document.createElement("p");privacy.textContent="Ø§Ù„ÙˆÙ‚Øª Ù…Ø³ØªÙ…Ø±ØŒ ÙˆØ§Ù„ØªØ­Ù„ÙŠÙ„ Ù…Ø­Ù„ÙŠ Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø²Ùƒ ÙˆÙ„Ø§ ØªÙØ±ÙØ¹ Ø£ÙŠ ØµÙˆØ±Ø©.";privacy.style.cssText="margin:10px 0 0;text-align:center;font-size:10px;font-weight:700;line-height:1.7;color:#94a3b8";
      card.appendChild(icon);card.appendChild(title);card.appendChild(body);card.appendChild(detail);card.appendChild(status);card.appendChild(privacy);o.appendChild(card);document.body.appendChild(o);
    }
    if(!msg){o.style.display="none";return;}
    var guide=sebCamGuidance(pulseType),titleEl=document.getElementById("sebCamWarnTitle"),bodyEl=document.getElementById("sebCamWarnBody"),detailEl=document.getElementById("sebCamWarnDetail"),statusEl=document.getElementById("sebCamWarnStatus");
    if(titleEl)titleEl.textContent="Ù„Ø­Ø¸Ø© ØªØ­Ù‚Ù‚";
    if(bodyEl)bodyEl.textContent=msg||guide.title;
    if(detailEl)detailEl.textContent=guide.detail;
    if(statusEl)statusEl.textContent=recoverSeconds>0?"Ø§Ù„ÙˆØ¶Ø¹ Ø³Ù„ÙŠÙ… Ø§Ù„Ø¢Ù† â€” ØªØ¹ÙˆØ¯ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© Ø®Ù„Ø§Ù„ "+recoverSeconds+" Ø«":"Ø³ØªØ¹ÙˆØ¯ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø¨Ø¹Ø¯ Ø«Ø¨Ø§Øª ÙˆØ¶Ø¹Ùƒ Ø£Ù…Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.";
    o.style.display="flex";
  }catch(e){}
}
// âš ï¸ Ø¨Ø·Ù„Ø¨ Ø§Ù„Ù…Ø§Ù„Ùƒ Ø§Ù„ØµØ±ÙŠØ­ (Ù© ÙŠÙˆÙ„ÙŠÙˆ Ù„ÙŠÙ„Ø§Ù‹): Ù‡Ø°Ù‡ Ù‡ÙŠ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø£ØµÙ„ÙŠØ© Ø§Ù„Ø­Ø±ÙÙŠØ© Ù„Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© â€”
// Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© Ø§Ù„ØµØºÙŠØ±Ø© Ø§Ù„Ø«Ø§Ø¨ØªØ© Ø¨Ø£Ø³ÙÙ„ ÙŠØ³Ø§Ø± Ø§Ù„Ø´Ø§Ø´Ø©. Ø¬Ø±Ù‘Ø¨Ù†Ø§ Ø´Ø§Ø´Ø© ØªØ£ÙƒÙŠØ¯ ÙƒØ¨ÙŠØ±Ø© Ø«Ù… Ø¥Ø®ÙØ§Ø¡
// ÙÙƒØ³Ø±Øª Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© Ù…Ø±ØªÙŠÙ† Ø¹Ù„Ù‰ iOSØ› Ø§Ù„Ù…Ø§Ù„Ùƒ Ø·Ù„Ø¨ Ø§Ù„Ø¹ÙˆØ¯Ø© Ù„Ù‡Ø°Ø§ Ø§Ù„ÙƒÙˆØ¯ Ø¨Ø§Ù„Ø¶Ø¨Ø· ("ÙƒØ§Ù†
// Ø§Ø­ØªØ±Ø§ÙÙŠ Ø¬Ø¯Ø§ Ø¬Ø¯Ø§ Ø¬Ø¯Ø§"). Ù„Ø§ ØªÙØ¹ÙØ¯ Ø¨Ù†Ø§Ø¡ Ø´Ø§Ø´Ø© Ø§Ù„Ø§Ù†ØªØ±Ùˆ.
function sebCamShowPreview(stream){
  try{
    var v=document.getElementById("sebCamPrev");
    if(!v){v=document.createElement("video");v.id="sebCamPrev";v.muted=true;v.playsInline=true;v.setAttribute("playsinline","");
      v.style.cssText="position:fixed;bottom:14px;left:14px;width:104px;height:78px;border-radius:14px;object-fit:cover;z-index:99998;border:2px solid rgba(99,102,241,.75);box-shadow:0 8px 24px rgba(0,0,0,.5);background:#000";
      document.body.appendChild(v);}
    sebCamPreviewStream=stream;
    sebCamLastPreviewTime=-1;
    v.srcObject=stream;
    v.onloadedmetadata=function(){try{v.play&&v.play().catch(function(){});}catch(e){}};
    v.onstalled=function(){sebCamStallSince=sebCamStallSince||Date.now();};
    v.onwaiting=function(){sebCamStallSince=sebCamStallSince||Date.now();};
    v.onplaying=function(){sebCamStallSince=0;};
    v.play&&v.play().catch(function(){});
  }catch(e){}
}
function sebCamStopPreviewStream(){
  try{
    if(sebCamPreviewStream&&sebCamPreviewStream.getTracks)
      sebCamPreviewStream.getTracks().forEach(function(t){try{t.stop();}catch(e){}});
  }catch(e){}
  sebCamPreviewStream=null;
}
function sebCamRestartPreview(reason){
  try{
    if(!sebCamStream||!sebCamStream.clone)return false;
    var nextPreview=sebCamStream.clone();
    sebCamStopPreviewStream();
    sebCamShowPreview(nextPreview);
    sebCamLastRecoveryAt=Date.now();
    sebCamStallSince=0;
    sebRadarReport("SEB camera preview recovered: "+String(reason||"stalled"),"preview-stall");
    return true;
  }catch(e){return false;}
}
function sebCamRestartStream(reason){
  try{
    if(sebCamWatchdogBusy||!sebCamStream)return;
    if(Date.now()-sebCamLastRecoveryAt<7000)return;
    sebCamWatchdogBusy=true;
    sebCamLastRecoveryAt=Date.now();
    sebRadarReport("SEB camera stream recovered: "+String(reason||"stalled"),"stream-stall");
    try{if(sebCamVideo){sebCamVideo.pause();sebCamVideo.srcObject=null;}}catch(e){}
    sebCamStopPreviewStream();
    try{sebCamStream.getTracks().forEach(function(t){t.stop();});}catch(e){}
    sebCamStream=null;sebCamVideo=null;sebCamCanvas=null;sebCamCtx=null;
    if(sebCamTimer){clearInterval(sebCamTimer);sebCamTimer=null;}
    window.setTimeout(function(){
      sebCamWatchdogBusy=false;
      try{ensureSebCamera();}catch(e){}
    },250);
  }catch(e){sebCamWatchdogBusy=false;}
}
function sebCamWatchdog(){
  try{
    if(!sebCamStream||!sebCamVideo||sebCamWatchdogBusy)return;
    var now=Date.now();
    var track=sebCamStream.getVideoTracks&&sebCamStream.getVideoTracks()[0];
    if(track&&track.readyState!=="live"){
      sebCamRestartStream("track-"+String(track.readyState||"ended"));
      return;
    }
    if(track&&track.muted){
      sebCamTrackMutedSince=sebCamTrackMutedSince||now;
    }else{
      sebCamTrackMutedSince=0;
    }
    var preview=document.getElementById("sebCamPrev");
    var previewTime=preview?Number(preview.currentTime):-1;
    var analysisTime=Number(sebCamVideo.currentTime);
    if(preview&&preview.readyState>=2&&preview.paused){try{preview.play().catch(function(){});}catch(e){}}
    if(preview&&preview.readyState>=2&&Number.isFinite(previewTime)&&previewTime>0){
      if(sebCamLastPreviewTime>=0&&previewTime<=sebCamLastPreviewTime+0.01){
        if(!sebCamStallSince)sebCamStallSince=now;
      }else{sebCamStallSince=0;}
      sebCamLastPreviewTime=previewTime;
    }
    var analysisStalled=false;
    if(sebCamVideo.readyState>=2&&Number.isFinite(analysisTime)&&analysisTime>0){
      analysisStalled=sebCamLastAnalysisTime>=0&&analysisTime<=sebCamLastAnalysisTime+0.01;
      if(analysisStalled)sebCamAnalysisStallSince=sebCamAnalysisStallSince||now;
      else sebCamAnalysisStallSince=0;
      sebCamLastAnalysisTime=analysisTime;
    }
    if(sebCamStallSince&&now-sebCamStallSince>=3500){
      if(!sebCamRestartPreview("stalled"))sebCamRestartStream("preview-stalled");
      return;
    }
    if(sebCamAnalysisStallSince&&now-sebCamAnalysisStallSince>=3500){
      sebCamRestartStream("analysis-stalled");
      return;
    }
    if(sebCamTrackMutedSince&&now-sebCamTrackMutedSince>=3500){
      sebCamRestartStream("track-muted");
    }
  }catch(e){}
}
function sebCamEngage(pulseType,msg){
  try{sebCamLocked=true;sebCamClearSince=0;sebCamOverlayShow(msg||"Ø£Ø¹Ø¯ ÙˆØ¶Ø¹Ùƒ Ø§Ù„Ø·Ø¨ÙŠØ¹ÙŠ Ø£Ù…Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.",pulseType||"");}catch(e){}
}
function sebCamMaybeRecover(){
  try{
    if(!sebCamLocked)return;
    var hasConcern=(sebCamCounters.blocked||0)>0||(sebCamCounters.attn||0)>0||(sebCamCounters.face_missing||0)>0||(sebCamCounters.multiple_faces||0)>0;
    if(hasConcern){sebCamClearSince=0;return;}
    var now=Date.now();if(!sebCamClearSince)sebCamClearSince=now;
    var remaining=Math.max(0,2000-(now-sebCamClearSince)),seconds=Math.ceil(remaining/1000);
    if(remaining>0){
      var statusEl=document.getElementById("sebCamWarnStatus");
      if(statusEl)statusEl.textContent="Ø§Ù„ÙˆØ¶Ø¹ Ø³Ù„ÙŠÙ… Ø§Ù„Ø¢Ù† â€” ØªØ¹ÙˆØ¯ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© Ø®Ù„Ø§Ù„ "+seconds+" Ø«";
      return;
    }
    sebCamLocked=false;sebCamClearSince=0;sebCamOverlayShow("");sebSendVisionPulse("recovered",{engine:sebBlazeModel?"blazeface":"fallback"});
  }catch(e){}
}
function sebCamFallbackMotion(img,W,H,avg){
  try{
    var yS=Math.floor(H*0.12),yE=Math.floor(H*0.96),wx=0,wy=0,tot=0;
    for(var py=yS;py<yE;py++){for(var px=0;px<W;px++){var idx=(py*W+px)*4;var lum=img[idx]+img[idx+1]+img[idx+2];wx+=lum*px;wy+=lum*py;tot+=lum;}}
    if(tot>0&&avg>=12){
      var cx=wx/tot/Math.max(1,W-1),cy=wy/tot/Math.max(1,H-1);
      if(!sebCamAttnBase){sebCamAttnBase={x:cx,y:cy,r:1};}
      else if(sebCamAttnBase.r<4){sebCamAttnBase={x:(sebCamAttnBase.x+cx)/2,y:(sebCamAttnBase.y+cy)/2,r:sebCamAttnBase.r+1};}
      else{var drift=Math.max(Math.abs(cx-sebCamAttnBase.x),Math.abs(cy-sebCamAttnBase.y)),lim=sebCamMode()==="strict"?0.16:0.22;
        if(drift>lim){sebCamCounters.attn=(sebCamCounters.attn||0)+1;
          if(sebCamCounters.attn>=2){sebSendVisionPulse("attention_away",{drift:Number(drift.toFixed(3)),fallback:true});sebCamEngage("attention_away","Ø§Ø±Ø¬Ø¹ Ø¨Ù†Ø¸Ø±Ùƒ Ù„Ù„Ø´Ø§Ø´Ø©.");}
        }else{sebCamCounters.attn=0;sebCamAttnBase={x:sebCamAttnBase.x*0.92+cx*0.08,y:sebCamAttnBase.y*0.92+cy*0.08,r:sebCamAttnBase.r};}
      }
    }
  }catch(e){}
}
function sebCamAnalyze(){
  try{
    if(!sebCamVideo||!sebCamCtx||sebCamVideo.readyState<2)return;
    var W=sebCamCanvas.width,H=sebCamCanvas.height;sebCamCtx.drawImage(sebCamVideo,0,0,W,H);
    var img=sebCamCtx.getImageData(0,0,W,H).data,light=0,n=0;
    for(var i=0;i<img.length;i+=16){light+=(img[i]+img[i+1]+img[i+2])/3;n++;}
    var avg=light/Math.max(1,n);
    if(avg<12){sebCamCounters.blocked=(sebCamCounters.blocked||0)+1;
      if(sebCamCounters.blocked>=4){sebSendVisionPulse("camera_blocked",{avgLight:Math.round(avg)});sebCamEngage("camera_blocked","ÙˆØ¶Ù‘Ø­ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ â€” ØªØ£ÙƒØ¯ Ø£Ù†Ù‡Ø§ ØºÙŠØ± Ù…ØºØ·Ù‘Ø§Ø©.");}
    }else sebCamCounters.blocked=0;
    sebTryLoadBlaze();
    if(sebBlazeModel){
      // ÙƒØ´Ù ÙˆØ¬Ù‡ Ø­Ù‚ÙŠÙ‚ÙŠ Ø¬Ø§Ù‡Ø²: Ù†Ø³ØªØ®Ø¯Ù…Ù‡ (Ù„Ø§ ÙˆØ¬Ù‡/ØªØ¹Ø¯Ø¯ ÙˆØ¬ÙˆÙ‡/Ø§Ù„ØªÙØ§Øª Ø¨Ø§Ù„Ø£Ù†Ù) ÙˆÙ†ØªØ®Ø·Ù‘Ù‰
      // ÙƒØ´Ù Ø§Ù„Ø­Ø±ÙƒØ© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ ØªÙ…Ø§Ù…Ø§Ù‹. âš ï¸ Ù„Ø§ ØªØ¶Ù Ø¨ÙˆØ§Ø¨Ø§Øª/ØªØ´ØºÙŠÙ„Ø§Ù‹ Ù…Ø²Ø¯ÙˆØ¬Ø§Ù‹ Ù‡Ù†Ø§ â€”
      // Ø¬ÙØ±ÙÙ‘Ø¨ ÙˆØ³Ø¨Ù‘Ø¨ Ø§Ø¶Ø·Ø±Ø§Ø¨Ø§Ù‹ Ø¹Ù„Ù‰ Ø£Ø¬Ù‡Ø²Ø© Ø§Ù„Ø·Ù„Ø¨Ø© (Ù© ÙŠÙˆÙ„ÙŠÙˆ Ù„ÙŠÙ„Ø§Ù‹).
      sebBlazeDetect();
    }else{
      sebCamFallbackMotion(img,W,H,avg);
      sebCamMaybeRecover();
    }
  }catch(e){}
}
var sebCamAutoRetryTimer=null,sebCamAutoRetryCount=0,sebRadarSent=0,sebCamDiagSent=0;
// Ø¨ØµÙ…Ø© Ø¬Ù‡Ø§Ø² Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¯Ø§Ø®Ù„ SEB: Ù†Ø­ØªØ§Ø¬Ù‡Ø§ Ù„Ù†Ø¹Ø±Ù Ø¨Ù†Ø§Ø¡ WebKit/Ø¥ØµØ¯Ø§Ø± SEB Ø§Ù„ÙØ¹Ù„ÙŠ â€” Ù‡Ø°Ø§
// Ø§Ù„Ù…Ø¹Ø·Ù‰ Ø§Ù„ÙˆØ­ÙŠØ¯ Ø§Ù„Ø°ÙŠ Ø¹Ø¬Ø²Ù†Ø§ Ø¹Ù† Ø±Ø¤ÙŠØªÙ‡ Ø·ÙˆØ§Ù„ Ù…Ø­Ø§ÙˆÙ„Ø§Øª Ø¥ØµÙ„Ø§Ø­ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.
function sebUaTag(){try{return String(navigator.userAgent||"").replace(/\s+/g," ").slice(0,140);}catch(e){return "?";}}
// Ù…Ø¬Ø³Ù‘ Ø±Ø§Ø¯Ø§Ø± Ù…Ø®ØµÙ‘Øµ Ù„Ø£Ø¹Ø·Ø§Ù„ ÙƒØ§Ù…ÙŠØ±Ø§ SEB (Ø­Ø§Ù„Ø© Ù…Ø¹Ø§Ù„Ø¬Ø© Ù„Ø§ ÙŠÙ„ØªÙ‚Ø·Ù‡Ø§ onerror).
function sebRadarReport(message,errName){
  try{
    if(sebRadarSent>=6)return;sebRadarSent++;
    fetch("/api/monitor/report",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({message:String(message||"").slice(0,300),stack:"errorName: "+String(errName||"?")+" | UA: "+sebUaTag(),url:"/seb/start#camera",source:"seb",role:"student",userId:String(studentId||boot.examId||"")})}).catch(function(){});
  }catch(e){}
}
// Ù…Ø¬Ø³Ù‘ ØªØ´Ø®ÙŠØµÙŠ Ø¯ÙˆØ±Ø©-Ø­ÙŠØ§Ø© (Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø©/Ø¬Ù„Ø³Ø©): ÙŠØ«Ø¨Øª ÙÙŠ Ø§Ù„Ø±Ø§Ø¯Ø§Ø± Ø£Ù† Ù…Ø³Ø§Ø± Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ø¨Ø¯Ø£
// ÙØ¹Ù„Ø§Ù‹ Ø¹Ù„Ù‰ Ø§Ù„Ø¬Ù‡Ø§Ø² Ù…Ø¹ Ø¨ØµÙ…Ø© Ø§Ù„Ù…ØªØµÙØ­ ÙˆØªÙˆÙÙ‘Ø± getUserMedia â€” Ø­ØªÙ‰ Ù„Ùˆ Ù†Ø¬Ø­Øª Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ø£Ùˆ
// Ù„Ù… ÙŠÙØ±Ù…Ù Ø®Ø·Ø£ Ø¥Ø·Ù„Ø§Ù‚Ø§Ù‹. Ø¨Ù‡Ø°Ø§ ØªÙØµØ¨Ø­ ØªØ¬Ø±Ø¨Ø© Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù‚Ø§Ø¯Ù…Ø© ØªØ´Ø®ÙŠØµØ§Ù‹ Ù‚Ø§Ø·Ø¹Ø§Ù‹ Ù„Ø§ ØªØ®Ù…ÙŠÙ†Ø§Ù‹.
function sebCamDiag(stage){
  try{
    var hasGUM=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
    fetch("/api/monitor/report",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({message:"SEB camera lifecycle: "+String(stage||"?")+" | getUserMedia="+hasGUM+" | policy="+((boot.camera&&boot.camera.policy)||"?")+" | mode="+((boot.camera&&boot.camera.mode)||"?"),stack:"UA: "+sebUaTag(),url:"/seb/start#camera-diag",source:"seb",role:"student",userId:String(studentId||boot.examId||"")})}).catch(function(){});
  }catch(e){}
}
function sebCamShowBlockOverlay(errName){
  // Ø­Ø§Ø¬Ø¨ Ø¯Ø§Ø¦Ù… Ø¹Ù†Ø¯ ÙØ±Ø¶ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ (block_start) ÙˆØ±ÙØ¶Ù‡Ø§: ÙŠØºØ·Ù‘ÙŠ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø­ØªÙ‰ ÙŠÙØ³Ù…Ø­
  // Ø¨Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§. ÙÙŠÙ‡: Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ© ÙƒÙ„ Ù¨Ø« (ÙƒÙ…Ø§ ÙƒØ§Ù† ÙŠØªÙØ¹Ù‘Ù„ ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹)ØŒ ÙˆØ²Ø± ÙŠØ¯ÙˆÙŠØŒ
  // ÙˆÂ«Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù†Â» Ø­ØªÙ‰ Ù„Ø§ ÙŠØªÙˆÙ‡Ù‘Ù‚ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ù„Ø§ Ù…Ø®Ø±Ø¬. Ù„Ø§ ÙŠØ±Ù…ÙŠ Ø®Ø·Ø£ ÙˆÙ„Ø§ ÙŠÙˆÙ‚Ù ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø£Ø³Ø¦Ù„Ø©.
  try{
    var o=document.getElementById("sebCamBlock");
    if(!o){
      o=document.createElement("div");o.id="sebCamBlock";
      o.style.cssText="position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(2,6,23,.97);color:#fff;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:28px;line-height:2";
      var msg=document.createElement("div");msg.id="sebCamBlockMsg";msg.style.cssText="font-weight:900;font-size:19px;max-width:520px";
      msg.textContent="Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙŠØªØ·Ù„Ø¨ ØªØ´ØºÙŠÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§. Ø§Ø³Ù…Ø­ Ø¨Ø§Ù„ÙˆØµÙˆÙ„ Ù„Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ù„Ù„Ù…ØªØ§Ø¨Ø¹Ø© â€” Ø³Ù†Ø¹ÙŠØ¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹.";
      var btn=document.createElement("button");btn.textContent="Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø© ØªØ´ØºÙŠÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§";
      btn.style.cssText="border:0;border-radius:16px;padding:14px 22px;background:#16a34a;color:#fff;font-weight:900;font-size:15px;cursor:pointer";
      btn.onclick=function(){ensureSebCamera();};
      var quit=document.createElement("a");quit.textContent="Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù† Ù…Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±";
      quit.href=boot.quitUrl||"#";
      quit.style.cssText="display:block;border:1px solid rgba(255,255,255,.25);border-radius:16px;padding:12px 22px;color:#fca5a5;font-weight:800;font-size:14px;text-decoration:none;margin-top:4px";
      o.appendChild(msg);o.appendChild(btn);o.appendChild(quit);document.body.appendChild(o);
    }
    o.style.display="flex";
    // Ø±Ø³Ø§Ù„Ø© Ù…ÙˆØ¬Ù‘Ù‡Ø©: NotAllowedError Ø¹Ù„Ù‰ iOS ÙŠØ¹Ù†ÙŠ ØºØ§Ù„Ø¨Ø§Ù‹ Ø£Ù† ØªØ·Ø¨ÙŠÙ‚ SEB Ù†ÙØ³Ù‡ Ù…Ø­Ø±ÙˆÙ…
    // Ù…Ù† Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ ÙÙŠ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù†Ø¸Ø§Ù… â€” Ù†Ø±Ø´Ø¯ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù„Ù„Ù…ÙƒØ§Ù† Ø§Ù„ØµØ­ÙŠØ­ Ø¨Ø¯Ù„ ØªØ±ÙƒÙ‡ ÙŠØ­Ø§ÙˆÙ„ Ø¹Ø¨Ø«Ø§Ù‹.
    try{
      var msgEl=document.getElementById("sebCamBlockMsg");
      if(msgEl&&/NotAllowed|Permission|Security/i.test(String(errName||""))){
        msgEl.textContent="Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ù…Ø­Ø¬ÙˆØ¨Ø© Ø¹Ù† ØªØ·Ø¨ÙŠÙ‚ SEB Ù†ÙØ³Ù‡. Ø§ÙØªØ­ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø¬Ù‡Ø§Ø² â† SEB â† ÙØ¹Ù‘Ù„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ØŒ Ø«Ù… Ø§Ø±Ø¬Ø¹ Ù‡Ù†Ø§ â€” Ø³Ù†ÙƒÙ…Ù„ ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹.";
      }
    }catch(e){}
    // Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ© (Ø­ØªÙ‰ Ù¡Ù¥ Ù…Ø±Ø©): ÙŠÙƒÙÙŠ Ø£Ù† ÙŠØ¶ØºØ· Ø§Ù„Ø·Ø§Ù„Ø¨ "Ø³Ù…Ø§Ø­" ÙÙŠ Ù†Ø§ÙØ°Ø© Ø§Ù„Ù†Ø¸Ø§Ù…
    // ÙØªÙ„ØªÙ‚Ø·Ù‡Ø§ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„ØªØ§Ù„ÙŠØ© ÙˆÙŠØ®ØªÙÙŠ Ø§Ù„Ø­Ø§Ø¬Ø¨ ÙˆØ­Ø¯Ù‡ Ø¨Ù„Ø§ Ø£ÙŠ Ø¶ØºØ·Ø© Ø²Ø±.
    if(!sebCamAutoRetryTimer){
      sebCamAutoRetryCount=0;
      sebCamAutoRetryTimer=setInterval(function(){
        sebCamAutoRetryCount+=1;
        if(sebCamStream||sebCamAutoRetryCount>15){clearInterval(sebCamAutoRetryTimer);sebCamAutoRetryTimer=null;return;}
        ensureSebCamera();
      },8000);
    }
  }catch(e){}
}
function sebCamHideBlockOverlay(){try{var o=document.getElementById("sebCamBlock");if(o)o.style.display="none";}catch(e){}}
async function ensureSebCamera(){
  // Ø¢Ù…Ù†Ø© ØªÙ…Ø§Ù…Ø§Ù‹: Ù„Ø§ ØªØ±Ù…ÙŠ Ø£Ø¨Ø¯Ø§Ù‹ ÙˆÙ„Ø§ ØªÙØ¹Ù„Ù‘Ù‚ (Ù…Ù‡Ù„Ø© Ø¹Ù„Ù‰ getUserMedia)ØŒ ÙÙ„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù†
  // ØªØªØ³Ø¨Ù‘Ø¨ ÙÙŠ ÙØ´Ù„ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø£Ø³Ø¦Ù„Ø©. Ø§Ù„ÙØ±Ø¶ Ø¹Ø¨Ø± Ø­Ø§Ø¬Ø¨ Ø¨ØµØ±ÙŠ Ù„Ø§ Ø¹Ø¨Ø± Ø¥ÙŠÙ‚Ø§Ù Ø§Ù„Ù…Ø³Ø§Ø±.
  try{
    if(!boot.camera||!boot.camera.enabled)return;
    var blockStart=boot.camera.policy==="block_start";
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      sebSendVisionPulse("camera_unavailable",{reason:"no-getUserMedia"});
      sebRadarReport("SEB camera: getUserMedia API ØºÙŠØ± Ù…ØªÙˆÙØ±Ø© Ø£ØµÙ„Ø§Ù‹ ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„Ù€WebView","no-mediaDevices");
      if(blockStart)sebCamShowBlockOverlay();
      return;
    }
    var stream;
    // Ù…Ù‡Ù…: Ù„Ø§ Ù†Ø±Ù…ÙŠ ÙˆØ¹Ø¯ getUserMedia Ø§Ù„Ø£ØµÙ„ÙŠ Ø¹Ù†Ø¯ Ø§Ù†ØªÙ‡Ø§Ø¡ Ø§Ù„Ù…Ù‡Ù„Ø©. Ù†Ø§ÙØ°Ø© Ø¥Ø°Ù† iOS Ù‚Ø¯
    // ØªØ¨Ù‚Ù‰ Ù…ÙØªÙˆØ­Ø© Ø£ÙƒØ«Ø± Ù…Ù† Ù¢Ù Ø«Ø› Ø¥Ù† ÙˆØ§ÙÙ‚ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…ØªØ£Ø®Ø±Ø§Ù‹ Ù†ØªØ¨Ù†Ù‘Ù‰ Ø§Ù„Ø¨Ø«Ù‘ Ø§Ù„Ù…Ù…Ù†ÙˆØ­ ÙÙˆØ±Ø§Ù‹
    // ÙˆÙ†Ø®ÙÙŠ Ø§Ù„Ø­Ø§Ø¬Ø¨ (ÙƒØ§Ù† Ø§Ù„Ø±ÙØ¶ Ø¨Ø¹Ø¯ Ø§Ù„Ù…Ù‡Ù„Ø© ÙŠÙ‡Ù…Ù„ Ø§Ù„Ø¨Ø«Ù‘ ÙÙŠØ¹Ù„Ù‚ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø®Ù„Ù Ø§Ù„Ø­Ø§Ø¬Ø¨).
    // Ø³ÙÙ„Ù‘Ù… Ù‚ÙŠÙˆØ¯ Ù…ØªØ¯Ø±Ù‘Ø¬ (ÙƒÙ…Ø§ ÙÙŠ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¹Ø§Ø¯ÙŠ): Ø¨Ø¹Ø¶ Ø¨ÙÙ†Ù‰ WebKit Ø¯Ø§Ø®Ù„ SEB ØªØ±ÙØ¶
    // facingMode Ø£Ùˆ Ø£Ø¨Ø¹Ø§Ø¯Ø§Ù‹ Ù…Ø­Ø¯Ù‘Ø¯Ø© Ø¹Ù„Ù‰ Ø£Ø¬Ù‡Ø²Ø© Ø³Ø·Ø­ Ø§Ù„Ù…ÙƒØªØ¨ ÙÙŠÙØ´Ù„ Ø§Ù„Ø·Ù„Ø¨ ÙƒÙ„ÙŠØ§Ù‹Ø› Ù†Ø¬Ø±Ù‘Ø¨
    // Ø§Ù„Ø£Ø¯Ù‚Ù‘ Ø«Ù… Ø§Ù„Ø£Ø¨Ø³Ø· Ø­ØªÙ‰ {video:true}. Ø±ÙØ¶ Ø§Ù„Ø¥Ø°Ù† (NotAllowed) ÙŠÙˆÙ‚Ù Ø§Ù„Ø³ÙÙ‘Ù„Ù‘Ù… ÙÙˆØ±Ø§Ù‹
    // (Ù„Ø§ ÙØ§Ø¦Ø¯Ø© Ù…Ù† Ù‚ÙŠÙˆØ¯ Ø£Ø®Ø±Ù‰) ÙÙŠØµÙ„ Ø§Ù„Ø­Ø§Ø¬Ø¨/Ø§Ù„Ø±Ø§Ø¯Ø§Ø± Ø¨Ø§Ù„Ø³Ø¨Ø¨ Ø§Ù„ØµØ­ÙŠØ­ Ø¨Ù„Ø§ Ø§Ù†ØªØ¸Ø§Ø± Ø¹Ø¨Ø«ÙŠ.
    function sebOpenCam(){
      var attempts=[
        {video:{facingMode:"user",width:{ideal:320},height:{ideal:240}},audio:false},
        {video:{facingMode:"user"},audio:false},
        {video:true,audio:false}
      ];
      var i=0;
      function tryNext(){
        if(i>=attempts.length)return Promise.reject(new Error("camera-unavailable"));
        var c=attempts[i++];
        return navigator.mediaDevices.getUserMedia(c).catch(function(err){
          var n=String((err&&err.name)||"");
          if(/NotAllowed|Security|Permission/i.test(n))throw err;
          if(i<attempts.length)sebCamDiag("constraint-retry:"+n);
          return tryNext();
        });
      }
      return tryNext();
    }
    var gumPromise=sebOpenCam();
    gumPromise.then(function(lateStream){
      if(!sebCamStream&&lateStream){sebCamAdoptStream(lateStream);}
      else if(sebCamStream&&lateStream&&sebCamStream!==lateStream){try{lateStream.getTracks().forEach(function(t){t.stop();});}catch(e){}}
    }).catch(function(){});
    try{
      stream=await Promise.race([
        gumPromise,
        new Promise(function(_,rej){setTimeout(function(){rej(new Error("camera-timeout"));},20000);})
      ]);
    }catch(err){
      var en=String((err&&err.name)||"camera-error"),em=String((err&&err.message)||"");
      sebSendVisionPulse("camera_denied",{errorName:en});
      // Ù…Ø¬Ø³Ù‘ Ø§Ù„Ø±Ø§Ø¯Ø§Ø±: ÙØ´Ù„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ ÙƒØ§Ù† "Ù…Ø¹Ø§Ù„Ø¬Ø§Ù‹ Ø¨ØµÙ…Øª" ÙÙ„Ø§ ÙŠØ¸Ù‡Ø± ÙÙŠ Ø§Ù„Ø±Ø§Ø¯Ø§Ø± â€”
      // Ø§Ù„Ø¢Ù† ÙŠØµÙ„ ØªÙ‚Ø±ÙŠØ± Ø¨Ø§Ø³Ù… Ø§Ù„Ø®Ø·Ø£ Ø§Ù„Ø­Ø±ÙÙŠ (NotAllowedError/timeout/NotFound...)
      // ÙÙŠÙØ¹Ø±Ù Ø§Ù„Ø³Ø¨Ø¨ Ø§Ù„ÙØ¹Ù„ÙŠ Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø² Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¯ÙˆÙ† ØªØ®Ù…ÙŠÙ†.
      sebRadarReport("SEB camera failed: "+en+(em?" â€” "+em:""),en);
      if(blockStart)sebCamShowBlockOverlay(en);
      return;
    }
    sebCamAdoptStream(stream);
  }catch(e){}
}
function sebCamAdoptStream(stream){
  try{
    if(!stream||sebCamStream)return;
    sebCamHideBlockOverlay();
    if(sebCamAutoRetryTimer){clearInterval(sebCamAutoRetryTimer);sebCamAutoRetryTimer=null;}
    sebCamStream=stream;
    sebCamLastPreviewTime=-1;sebCamLastAnalysisTime=-1;sebCamStallSince=0;sebCamAnalysisStallSince=0;sebCamTrackMutedSince=0;
    var prevStream=stream;try{if(stream.clone)prevStream=stream.clone();}catch(e){}
    sebCamShowPreview(prevStream);
    // ÙÙŠØ¯ÙŠÙˆ Ø§Ù„ØªØ­Ù„ÙŠÙ„: Ø¹Ù†ØµØ± Ù…Ø³ØªÙ‚Ù„ Ù„Ø§ ÙŠÙØ¯Ø±Ø¬ ÙÙŠ Ø§Ù„ØµÙØ­Ø© Ø£Ø¨Ø¯Ø§Ù‹ â€” Ù‡Ø°Ù‡ Ù‡ÙŠ Ø§Ù„Ù…Ø¹Ù…Ø§Ø±ÙŠØ©
    // Ø§Ù„Ø£ØµÙ„ÙŠØ© Ø§Ù„Ù…Ø«Ø¨ØªØ© (Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© "Ø§Ù„Ø§Ø­ØªØ±Ø§ÙÙŠØ© Ø¬Ø¯Ø§Ù‹" Ø§Ù„ØªÙŠ Ø´Ù‡Ø¯Ù‡Ø§ Ø§Ù„Ù…Ø§Ù„Ùƒ). iOS ÙŠÙˆØ§ØµÙ„
    // ÙÙƒÙ‘ Ø¥Ø·Ø§Ø±Ø§Øª ÙÙŠØ¯ÙŠÙˆ Ù„Ù… ÙŠÙØ¯Ø±Ø¬ Ù‚Ø·ØŒ Ø¨ÙŠÙ†Ù…Ø§ ÙŠÙˆÙ‚Ù ÙÙŠØ¯ÙŠÙˆ Ø£ÙØ¯Ø±Ø¬ Ø«Ù… Ø£ÙØ²ÙŠÙ„/ØµÙØºÙ‘Ø± â€” ÙˆÙ‡Ø°Ø§
    // Ù…Ø§ Ù‚ØªÙ„ Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© Ø¨ØµÙ…Øª ÙÙŠ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„ØªÙŠÙ† Ø§Ù„Ø³Ø§Ø¨Ù‚ØªÙŠÙ†. Ù„Ø§ ØªØ¹ÙØ¯ Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø¹Ù†ØµØ± Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.
    sebCamVideo=document.createElement("video");sebCamVideo.muted=true;sebCamVideo.playsInline=true;sebCamVideo.setAttribute("playsinline","");sebCamVideo.srcObject=stream;try{sebCamVideo.play();}catch(e){}
    sebCamCanvas=document.createElement("canvas");sebCamCanvas.width=48;sebCamCanvas.height=36;sebCamCtx=sebCamCanvas.getContext("2d");
    sebSendVisionPulse("camera_active",{});
    // Ø£Ø®Ø·Ø§Ø¡ Ø§Ù„Ù…Ø­Ø±Ùƒ ØªÙØ±Ø³Ù„ Ø§Ù„Ø¢Ù† Ù…Ù† Ø§Ù„Ù…Ø±Ø­Ù„Ø© Ø§Ù„ØªÙŠ ÙØ´Ù„Øª Ù†ÙØ³Ù‡Ø§ ÙˆØ¨Ù†Øµ Ø§Ù„Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ø§Ù„Ø­Ø±ÙÙŠØ›
    // Ù„Ø§ Ù†Ø±Ø³Ù„ Ø¨Ø·Ø§Ù‚Ø© model=false Ø¹Ø§Ù…Ø© Ø¨Ø¹Ø¯ Ù¡Ù¥Ø« Ù„Ø£Ù†Ù‡Ø§ ÙƒØ§Ù†Øª ØªØ®ÙÙŠ Ø§Ù„Ø³Ø¨Ø¨ Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ.
    // Ù†Ø¨Ø¶Ø© Ø£Ø³Ø±Ø¹ (Ù¦Ù¥Ù Ù…Ù„Ù„ÙŠ): Ù…Ø¹ Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ù…Ø¶Ù…ÙÙ‘Ù† Ø§Ù„Ø´ØºØ§Ù„ØŒ Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡ ÙŠØµÙ„ Ø®Ù„Ø§Ù„ ~Ù¡.Ù£Ø« Ø¨Ø¯Ù„
    // ~Ù¡.Ù¨Ø«. Ø­Ø§Ø±Ø³ busy ÙŠØ­Ù…ÙŠ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø© Ø§Ù„Ø¨Ø·ÙŠØ¦Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ (ØªØ®Ø·ÙŠ Ø§Ù„Ù†Ø¨Ø¶Ø© Ù„Ø§ ØªÙƒØ¯ÙŠØ³Ù‡Ø§).
    if(sebCamTimer)clearInterval(sebCamTimer);sebCamTimer=setInterval(sebCamAnalyze,650);
    if(sebCamWatchdogTimer)clearInterval(sebCamWatchdogTimer);
    sebCamWatchdogTimer=setInterval(sebCamWatchdog,1200);
  }catch(e){}
}
function stopSebCamera(){try{if(sebCamTimer)clearInterval(sebCamTimer);if(sebCamWatchdogTimer)clearInterval(sebCamWatchdogTimer);sebCamWatchdogTimer=null;if(sebCamAutoRetryTimer){clearInterval(sebCamAutoRetryTimer);sebCamAutoRetryTimer=null;}if(sebCamVideo){try{sebCamVideo.pause();sebCamVideo.srcObject=null;}catch(e){}}if(sebCamStream)sebCamStream.getTracks().forEach(function(t){t.stop();});
  // Ù†Ø³Ø®Ø© Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© (clone) Ù„Ù‡Ø§ Ù…Ø³Ø§Ø±Ø§ØªÙ‡Ø§ Ø§Ù„Ù…Ø³ØªÙ‚Ù„Ø© â€” Ø£Ø·ÙØ¦Ù‡Ø§ Ø£ÙŠØ¶Ø§Ù‹
  sebCamStopPreviewStream();
  try{var pv=document.getElementById("sebCamPrev");if(pv){pv.pause();pv.srcObject=null;}}catch(e){}
  sebCamStream=null;sebCamVideo=null;sebCamCanvas=null;sebCamCtx=null;
  sebCamOverlayShow("");}catch(e){}}

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
    setStatus("Ø¬Ø§Ø±ÙŠ ÙØªØ­ Ø§Ù„Ø¬Ù„Ø³Ø© Ø§Ù„Ø¢Ù…Ù†Ø© ÙˆØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø£Ø³Ø¦Ù„Ø©...");
    const validateResp=await fetch("/api/seb/validate",{method:"POST",headers:headers(),body:JSON.stringify({sebToken:boot.token,seb:"1",miras_seb:"1"})});
    const session=await validateResp.json().catch(()=>({}));
    if(!validateResp.ok) throw new Error(session.error||"ØªØ¹Ø°Ø± ØªÙØ¹ÙŠÙ„ Ø¬Ù„Ø³Ø© SEB.");
    studentId=String(session.student&&session.student.id||"");
    examId=String(session.sebSession&&session.sebSession.examId||session.exam&&session.exam.id||boot.examId);
    activeExamSessionId=examSessionId();
    const lockResp=await fetch("/api/exam-lock/acquire",{method:"POST",headers:headers(),body:JSON.stringify({studentId,examId,sessionId:activeExamSessionId,deviceId:deviceId(),displayMode:displayMode()})});
    const lockData=await lockResp.json().catch(()=>({}));
    if(!lockResp.ok) throw new Error(lockData.error||"Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù…ÙØªÙˆØ­ ÙÙŠ Ø¬Ù„Ø³Ø© Ø£Ø®Ø±Ù‰.");
    activeExamSessionId=String(lockData.activeExamSessionId||activeExamSessionId);
    var genUrl="/api/quizzes/generate?studentId="+encodeURIComponent(studentId)+"&chapterId="+encodeURIComponent(examId)+"&examSessionId="+encodeURIComponent(activeExamSessionId)+"&displayMode="+encodeURIComponent(displayMode());
    var quizResp=await fetch(genUrl,{headers:headers(),cache:"no-store"});
    var quiz=await quizResp.json().catch(()=>({}));
    // Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø© ÙˆØ§Ø­Ø¯Ø© Ø¹Ù†Ø¯ ÙØ´Ù„ Ø§Ù„Ø¬Ù„Ø³Ø© Ø§Ù„Ù…ØªÙ‚Ø·Ù‘Ø¹ (STUDENT_SESSION_REQUIRED "Ø£Ø­ÙŠØ§Ù†Ø§Ù‹
    // ÙŠØ·Ù„Ø¨ Ø§Ù„Ø¯Ø®ÙˆÙ„"): Ù†Ø¹ÙŠØ¯ ØªÙØ¹ÙŠÙ„ Ù†ÙÙ‚ SEB (validate) Ø«Ù… Ù†Ø·Ù„Ø¨ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© Ù…Ø¬Ø¯Ø¯Ø§Ù‹. ØºØ§Ù„Ø¨Ø§Ù‹
    // ÙŠÙ†Ø¬Ø­ ÙÙˆØ±Ø§Ù‹ ÙÙŠ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© Ø¨Ø¯Ù„ Ø·Ø±Ø¯ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù„Ø´Ø§Ø´Ø© Ø§Ù„Ø¯Ø®ÙˆÙ„.
    if(quizResp.status===401 && quiz && (String(quiz.code||"")==="STUDENT_SESSION_REQUIRED" || String(quiz.error||"").indexOf("STUDENT_SESSION_REQUIRED")>=0)){
      setStatus("Ø¬Ø§Ø±ÙŠ Ø¥Ø¹Ø§Ø¯Ø© ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¬Ù„Ø³Ø© Ø§Ù„Ø¢Ù…Ù†Ø©...");
      try{ await fetch("/api/seb/validate",{method:"POST",headers:headers(),body:JSON.stringify({sebToken:boot.token,seb:"1",miras_seb:"1"})}); }catch(e){}
      await new Promise(function(r){setTimeout(r,700);});
      quizResp=await fetch(genUrl,{headers:headers(),cache:"no-store"});
      quiz=await quizResp.json().catch(()=>({}));
    }
    if(!quizResp.ok) throw new Error(quiz.error||"ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø£Ø³Ø¦Ù„Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.");
    if(!Array.isArray(quiz.questions)||!quiz.questions.length) throw new Error("Ù„Ù… ØªØµÙ„ Ø£Ø³Ø¦Ù„Ø© Ù„Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.");
    if(rescueTimer){clearTimeout(rescueTimer);rescueTimer=null;}
    hide("rescueBox");
    startTime=Date.now();
    renderQuestions(quiz.questions, session.exam&&session.exam.title, session.exam&&session.exam.timerMinutes);
    startExamHeartbeat();
    // Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ ØªÙØ´ØºÙÙ‘Ù„ Ø¨Ø¹Ø¯ Ø¸Ù‡ÙˆØ± Ø§Ù„Ø£Ø³Ø¦Ù„Ø©ØŒ ÙˆØ¨Ù„Ø§ awaitØŒ ÙÙ„Ø§ ØªØªØ¹Ø§Ø±Ø¶ Ù…Ø¹ Ù…Ø³Ø§Ø± Ø§Ù„Ø¬Ù„Ø³Ø© ÙˆÙ„Ø§
    // ØªÙ…Ù†Ø¹ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø£Ø³Ø¦Ù„Ø© Ø¥Ø·Ù„Ø§Ù‚Ø§Ù‹. Ø§Ù„ÙØ±Ø¶ (block_start) Ø¹Ø¨Ø± Ø­Ø§Ø¬Ø¨ Ø¨ØµØ±ÙŠ Ø¯Ø§Ø®Ù„ ensureSebCamera.
    ensureSebCamera();
  } catch(err) {
    if(rescueTimer){clearTimeout(rescueTimer);rescueTimer=null;}
    el("startBtn").disabled=false;
    setError(err&&err.message?err.message:"ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.");
    show("rescueBox");
  } finally {
    busy=false;
  }
}
async function submitExam(){
  try {
    if(timerId) clearInterval(timerId);
    // Ù†ÙØ¹Ù„Ù† Ø£Ù† Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙÙŠ Ø·ÙˆØ± Ø§Ù„ØªØ³Ù„ÙŠÙ… ÙˆÙ†ÙˆÙ‚Ù Ø§Ù„Ù†Ø¨Ø¶ ÙÙˆØ±Ø§Ù‹ Ù‚Ø¨Ù„ Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ø·Ù„Ø¨. Ù‡ÙƒØ°Ø§
    // Ù„Ø§ ÙŠÙØªØ­ Ø£ÙŠ Ù†Ø¨Ø¶ Ù„Ø§Ø­Ù‚ (Ø§Ù„Ø¬Ù„Ø³Ø© ØªÙØºÙ„Ù‚ Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø§Ø¯Ù… Ø¨Ø¹Ø¯ Ø§Ù„ØªØ³Ù„ÙŠÙ…) Ø´Ø§Ø´Ø© Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©
    // Ø£Ùˆ Ø±Ø³Ø§Ù„Ø© "Ø§Ù†ØªÙ‡Øª Ø¬Ù„Ø³Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±" ÙÙˆÙ‚ Ø´Ø§Ø´Ø© "ØªÙ… Ø§Ù„ØªØ³Ù„ÙŠÙ…" ÙÙŠØ±Ø¨Ùƒ Ø§Ù„Ø·Ø§Ù„Ø¨.
    examFinished=true;
    stopExamHeartbeat();
    el("submitBtn").disabled=true;
    const resp=await fetch("/api/quizzes/submit",{method:"POST",headers:headers(),body:JSON.stringify({studentId,chapterId:examId,answers,startTime,deviceToken:deviceId(),examSessionId:activeExamSessionId,displayMode:displayMode()})});
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error(data.error||"ØªØ¹Ø°Ø± ØªØ³Ù„ÙŠÙ… Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.");
    stopExamHeartbeat();
    try{stopSebCamera();}catch(e){}
    // Ø¨Ù‚Ø±Ø§Ø± Ø§Ù„Ù…Ø§Ù„Ùƒ: Ø²Ø± Ø§Ù„ØªØ³Ù„ÙŠÙ… = ØªØ³Ù„ÙŠÙ… + Ø®Ø±ÙˆØ¬ Ù…Ø¨Ø§Ø´Ø± Ù…Ù† SEB. Ù„Ø§ Ø´Ø§Ø´Ø© ÙˆØ³ÙŠØ·Ø©
    // "ØªÙ… Ø§Ù„ØªØ³Ù„ÙŠÙ…/Ø§Ù„Ø®Ø±ÙˆØ¬ Ø§Ù„Ø¢Ù…Ù†" â€” Ø§Ù„ØªØ³Ù„ÙŠÙ… Ø§Ù†Ø­ÙØ¸ (Ø§Ù„Ø±Ø¯ 200) ÙˆØ§Ù„Ø®Ø±ÙˆØ¬ ÙÙˆØ±ÙŠ.
    if(boot.quitUrl){
      hide("intro");hide("exam");
      location.replace(boot.quitUrl);
      return;
    }
    // Ø§Ø­ØªÙŠØ§Ø· ÙÙ‚Ø· Ø¥Ù† ØºØ§Ø¨ Ø±Ø§Ø¨Ø· Ø§Ù„Ø®Ø±ÙˆØ¬: Ø§Ù„Ø´Ø§Ø´Ø© Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø© ÙƒÙŠ Ù„Ø§ ÙŠØ¹Ù„Ù‚ Ø§Ù„Ø·Ø§Ù„Ø¨.
    hide("intro");hide("exam");show("result");
    const submission=data.submission||{};
    const savedScore=submission.score!==undefined?submission.score:(submission.percentage!==undefined?submission.percentage:"ØªÙ… Ø§Ù„ØªØ³Ù„ÙŠÙ…");
    text("resultBox",data.gradeVisible?"ØªÙ… Ø­ÙØ¸ Ø§Ù„ØªØ³Ù„ÙŠÙ…. Ø§Ù„Ù†ØªÙŠØ¬Ø©: "+savedScore:"ØªÙ… Ø­ÙØ¸ Ø§Ù„ØªØ³Ù„ÙŠÙ… ÙˆØ¥ØºÙ„Ø§Ù‚ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©.");
  } catch(err) {
    // ÙØ´Ù„ Ø§Ù„ØªØ³Ù„ÙŠÙ… (Ø§Ù†Ù‚Ø·Ø§Ø¹ Ø´Ø¨ÙƒØ©/Ø®Ø·Ø£ Ø®Ø§Ø¯Ù…): Ø§Ù„Ø¬Ù„Ø³Ø© Ù…Ø§ Ø²Ø§Ù„Øª Ù‚Ø§Ø¦Ù…Ø©ØŒ ÙÙ†ÙØ¹ÙŠØ¯ ØªÙØ¹ÙŠÙ„
    // Ø§Ù„Ù†Ø¨Ø¶ ÙˆØ§Ù„Ø²Ø± Ù„ÙŠÙØ¹ÙŠØ¯ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©ØŒ Ø¯ÙˆÙ† Ø¥Ø¸Ù‡Ø§Ø± Ø£ÙŠ Ø´Ø§Ø´Ø© Ù†Ù‡Ø§ÙŠØ© Ù…Ø±Ø¨ÙƒØ©.
    examFinished=false;
    el("submitBtn").disabled=false;
    startExamHeartbeat();
    alert((err&&err.message?err.message:"ØªØ¹Ø°Ø± ØªØ³Ù„ÙŠÙ… Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.")+"\\nØ§Ø³ØªØ®Ø¯Ù… Ø®Ø±ÙˆØ¬ Ø¢Ù…Ù† Ø¥Ø°Ø§ Ø§Ø³ØªÙ…Ø±Øª Ø§Ù„Ù…Ø´ÙƒÙ„Ø©. ÙƒÙ„Ù…Ø© Ø§Ù„Ø®Ø±ÙˆØ¬: Miras");
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
        statusEl.querySelector(".ambient-txt").textContent = "ØªÙ… Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ø§ØªØµØ§Ù„ ÙˆØ§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ø¨Ù†Ø¬Ø§Ø­!";
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
    return { error: "Ø¨ÙŠØ§Ù†Ø§Øª Ø¬Ù„Ø³Ø© SEB Ù†Ø§Ù‚ØµØ©.", status: 400 } as any;
  if (!student || !exam)
    return {
      error: "ØªØ¹Ø°Ø± ØªØ¬Ù‡ÙŠØ² Ø¬Ù„Ø³Ø© SEB Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø£Ùˆ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.",
      status: 404,
    } as any;
  if (String(exam.courseCode || "").toLowerCase() !== courseCode.toLowerCase())
    return {
      error: "Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù„Ø§ ÙŠØªØ¨Ø¹ Ø§Ù„Ù…Ù‚Ø±Ø± Ø§Ù„Ù…Ø·Ù„ÙˆØ¨.",
      status: 403,
    } as any;
  const teacherAuthorizedSebReturn = hasTeacherAuthorizedSebReturnException(
    examId,
    student.id,
  );
  if (!studentHasEnrollmentInCourse(student, courseCode) && !teacherAuthorizedSebReturn)
    return {
      error: "Ù‡Ø°Ø§ Ø§Ù„Ù…Ù‚Ø±Ø± ØºÙŠØ± Ù…ÙØ¹Ù„ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„Ø£ØµÙ„ÙŠ.",
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
      error: "Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù„Ø§ ÙŠØªØ¨Ø¹ Ø§Ù„Ø£Ø³ØªØ§Ø° Ø§Ù„Ù…Ø·Ù„ÙˆØ¨.",
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
  if (!examRequiresSeb(checked.exam))
    return {
      error: "Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ØºÙŠØ± Ù…ÙØ¹Ù‘Ù„ Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù… Safe Exam Browser.",
      status: 400,
    } as any;
  const now = Date.now();
  // Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ø¯Ù‚ÙŠÙ‚ ÙÙ‚Ø· Ø¹Ù†Ø¯ Ø¥Ø±Ø¬Ø§Ø¹/Ø³Ù…Ø§Ø­ Ø§Ù„Ù…Ø¹Ù„Ù… Ù„Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ù† Ø¬Ø¯ÙŠØ¯:
  // Ù„Ø§ Ù†ØºÙŠÙ‘Ø± Ù…Ù†Ø·Ù‚ SEB Ø§Ù„Ø£Ø³Ø§Ø³ÙŠØŒ Ù„ÙƒÙ† Ù„Ø§ Ù†ÙØ¸Ù‡Ø± Ø±Ø³Ø§Ù„Ø© Ø§Ù„Ù…Ù†Ø¹ ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„Ù…Ø³Ø§Ø± Ø§Ù„Ù…ØµØ±Ø­ Ù…Ù† Ø§Ù„Ù…Ø¹Ù„Ù….
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
    return { error: "Ù„Ù… ÙŠØ¨Ø¯Ø£ ÙˆÙ‚Øª Ø¥ØªØ§Ø­Ø© Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¨Ø¹Ø¯.", status: 403 } as any;
  if (
    checked.exam.close &&
    new Date(checked.exam.close).getTime() + 24 * 60 * 60 * 1000 < now &&
    !teacherAuthorizedSebReturn
  )
    return { error: "Ø§Ù†ØªÙ‡Ù‰ ÙˆÙ‚Øª Ø¥ØªØ§Ø­Ø© Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.", status: 403 } as any;
  const sessionValidation = validateSessionFingerprint(req, checked.student);
  const hasLaunchSessionForSameStudent =
    hasValidStudentSebLaunchSessionForDevice(req, checked.student);
  if (
    !sessionValidation.isValid &&
    !teacherAuthorizedSebReturn &&
    !hasLaunchSessionForSameStudent
  )
    return {
      error:
        sessionValidation.error ||
        "Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥Ù†Ø´Ø§Ø¡ Ø¬Ù„Ø³Ø© SEB Ø¥Ù„Ø§ Ù…Ù† Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø£ØµÙ„ÙŠ Ø§Ù„Ù…ÙØ¹Ù‘Ù„.",
      status: 403,
    } as any;
  const examTimerMinutes = Math.max(
    1,
    Number(
      (checked.exam as any).antiCheat?.timerMinutes ??
        (checked.exam as any).timerMinutes,
    ) || 30,
  );
  closePendingSebLaunchesForFreshAttempt(
    checked.studentId,
    checked.examId,
    "superseded-by-fresh-seb-launch",
  );
  closeActiveExamLocksForFreshSebLaunch(
    checked.studentId,
    checked.examId,
    teacherAuthorizedSebReturn
      ? "teacher-authorized-seb-relaunch"
      : "fresh-seb-launch",
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
    action: "Ø¥Ù†Ø´Ø§Ø¡ Ù†ÙÙ‚ SEB",
    details: teacherAuthorizedSebReturn
      ? `ØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø¬Ù„Ø³Ø© Ø§Ø®ØªØ¨Ø§Ø± Ù…Ø¤Ù‚ØªØ© Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø± ${checked.examId} ÙÙŠ Ù…Ù‚Ø±Ø± ${checked.courseCode} Ø¹Ø¨Ø± Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ø¥Ø±Ø¬Ø§Ø¹ Ù…ØµØ±Ø­ Ù…Ù† Ø§Ù„Ù…Ø¹Ù„Ù… Ø¯ÙˆÙ† ØªØºÙŠÙŠØ± Ø±Ø¨Ø· Ø§Ù„ÙƒÙˆØ¯ Ø£Ùˆ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø£ØµÙ„ÙŠ.`
      : `ØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø¬Ù„Ø³Ø© Ø§Ø®ØªØ¨Ø§Ø± Ù…Ø¤Ù‚ØªØ© Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø± ${checked.examId} ÙÙŠ Ù…Ù‚Ø±Ø± ${checked.courseCode} Ø¯ÙˆÙ† ØªØºÙŠÙŠØ± Ø±Ø¨Ø· Ø§Ù„ÙƒÙˆØ¯ Ø£Ùˆ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø£ØµÙ„ÙŠ.`,
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
        // ÙƒÙ„ Ø¥Ø¯Ø®Ø§Ù„ ÙƒÙˆØ¯ Ù‡Ùˆ Ø¯ÙˆØ±Ø© Ø¹Ø¶ÙˆÙŠØ© Ø¬Ø¯ÙŠØ¯Ø©. Ø§Ù„Ø§Ø­ØªÙØ§Ø¸ Ø¨ØªØ§Ø±ÙŠØ® Ø§Ù„ØªÙØ¹ÙŠÙ„ Ø§Ù„Ù‚Ø¯ÙŠÙ… ÙƒØ§Ù†
        // ÙŠØ¬Ø¹Ù„ Ø¹Ù„Ø§Ù…Ø© Ø­Ø°Ù Ù…Ù† Ø¯ÙˆØ±Ø© Ø³Ø§Ø¨Ù‚Ø© Ø£Ø­Ø¯Ø« Ù…Ù†Ù‡ØŒ ÙØªØ¹ØªØ¨Ø± Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø­ÙŠØ© Ø§Ù„Ø·Ø§Ù„Ø¨
        // Ù…Ø­Ø°ÙˆÙØ§Ù‹ Ù„Ø§Ø­Ù‚Ø§Ù‹ ÙˆØªÙØ³Ù‚Ø· Ø§Ù„Ù…Ø´Ø§Ø±ÙŠØ¹ ÙˆØ§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª. ØªØ§Ø±ÙŠØ® Ø§Ù„ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ù‡Ùˆ
        // Ø§Ù„Ù…Ø±Ø¬Ø¹ Ø¯Ø§Ø¦Ù…Ø§Ù‹ Ø¹Ù†Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø±Ø¨Ø· Ù†ÙØ³ Ø§Ù„Ù…Ù‚Ø±Ø±.
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
    // Ø§Ù„ØªÙØ¹ÙŠÙ„ Ø¨Ø§Ù„ÙƒÙˆØ¯ Ù‡Ùˆ Ù‚Ø±Ø§Ø± Ø³Ø­Ø§Ø¨ÙŠ Ù†Ù‡Ø§Ø¦ÙŠ Ù„Ø¯ÙˆØ±Ø© Ø§Ù„Ø¹Ø¶ÙˆÙŠØ© Ø§Ù„Ø­Ø§Ù„ÙŠØ©Ø› Ù†Ù…Ø³Ø­ ÙÙŠ Ù†ÙØ³
    // Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ø­ÙØ¸ ÙƒÙ„ ØµÙˆØ± Ø¹Ù„Ø§Ù…Ø© Ø§Ù„Ø­Ø°Ù Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø© Ø­ØªÙ‰ Ù„Ø§ ØªØ¹ÙŠØ¯ Ø¥Ø­Ø¯Ø§Ù‡Ø§ Ø¥Ù„ØºØ§Ø¡ Ø§Ù„ØªÙØ¹ÙŠÙ„.
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
    courseName: String(sec?.courseName || sec?.name || sectionDisplayCode(code) || code || "Ø§Ù„Ù…Ù‚Ø±Ø±").trim(),
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
  // Ø£ÙŠ ÙƒÙˆØ¯ ÙˆÙÙ„Ø¯/Ø§Ø³ØªÙØ®Ø¯Ù… Ù‚Ø¨Ù„ Ø­Ø°Ù Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ù† Ø§Ù„Ù…Ù‚Ø±Ø± ÙŠÙ†ØªÙ…ÙŠ Ù„Ø¯ÙˆØ±Ø© Ø¹Ø¶ÙˆÙŠØ© Ù‚Ø¯ÙŠÙ…Ø©.
  // Ø¹Ù†Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ø·Ø§Ù„Ø¨ ÙŠØ¬Ø¨ Ù‚Ø¨ÙˆÙ„ ÙƒÙˆØ¯ Ø¬Ø¯ÙŠØ¯ ÙÙ‚Ø·Ø› Ø£Ù…Ø§ Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„Ù‚Ø¯ÙŠÙ…ØŒ Ø­ØªÙ‰ Ù„Ùˆ Ø¨Ù‚ÙŠ
  // Ø¨Ø§Ù„Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ø°Ø§ÙƒØ±Ø© Ø£Ùˆ Ø¹Ø§Ø¯ Ù…Ù† Ù…Ø²Ø§Ù…Ù†Ø© Ù…ØªØ£Ø®Ø±Ø©ØŒ ÙÙ„Ø§ ÙŠØ¹ÙŠØ¯ ÙØªØ­ Ø§Ù„Ù…Ù‚Ø±Ø±.
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
    // Ù„Ùˆ Ø£Ø¹Ø§Ø¯Øª Ù…Ø²Ø§Ù…Ù†Ø© Ø³Ø­Ø§Ø¨ÙŠØ© Ù…ØªØ£Ø®Ø±Ø© Ø¹Ù„Ø§Ù…Ø© Ø­Ø°Ù Ù‚Ø¯ÙŠÙ…Ø©ØŒ Ù„Ø§ ÙŠØ¬ÙˆØ² Ù„Ù‡Ø§ Ø¥Ø³Ù‚Ø§Ø· Ø¯ÙˆØ±Ø©
    // ØªÙØ¹ÙŠÙ„ Ø£Ø­Ø¯Ø«. Ø§Ù„Ø­Ø°Ù ÙŠØ¨Ù‚Ù‰ Ù†Ø§ÙØ°Ø§Ù‹ ÙÙ‚Ø· Ø¥Ù† ÙƒØ§Ù† Ø£Ø­Ø¯Ø« Ù…Ù† Ø¢Ø®Ø± ÙƒÙˆØ¯ Ù…ÙÙØ¹Ù‘Ù„.
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
      // ÙƒÙˆØ¯ Ø¬Ø¯ÙŠØ¯ ÙˆÙ…Ø®ØµØµ Ù„Ù„Ø·Ø§Ù„Ø¨ ÙŠØ¹Ù†ÙŠ Ø¸Ù‡ÙˆØ± "Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„ØªÙØ¹ÙŠÙ„" Ø­ØªÙ‰ Ù„Ùˆ Ø¨Ù‚ÙŠ Ø£Ø«Ø± Ø¥Ø²Ø§Ù„Ø© Ù‚Ø¯ÙŠÙ…Ø› Ù„Ø§ ÙŠØªÙ… ØªÙØ¹ÙŠÙ„Ù‡ Ø¥Ù„Ø§ Ø¨Ø¹Ø¯ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„ÙƒÙˆØ¯.
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

  // Ù„Ø§ ÙŠÙƒÙÙŠ ÙˆØ¬ÙˆØ¯ ÙƒÙˆØ¯ Ø¯Ø§Ø®Ù„ student.activatedCourseCodes ÙÙ‚Ø·ØŒ Ù„ÙƒÙ† Ù„Ø§ ÙŠØ¬ÙˆØ² Ø£ÙŠØ¶Ø§Ù‹
  // Ø¥Ø³Ù‚Ø§Ø· Ù…Ù‚Ø±Ø± Ø·Ø§Ù„Ø¨ Ù…ÙÙØ¹Ù‘Ù„ ÙØ¹Ù„ÙŠØ§Ù‹ Ù„Ø£Ù† ØµÙ Ø§Ù„ÙƒØ´Ù Ø£Ùˆ Ø³Ø¬Ù„ Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„Ù‚Ø¯ÙŠÙ… Ø£ÙØ±Ø´Ù Ø¨Ø¹Ø¯
  // Ø§Ù„ØªÙØ¹ÙŠÙ„. Ù„Ø°Ù„Ùƒ Ù†Ù‚Ø¨Ù„ Ø«Ù„Ø§Ø«Ø© Ø£Ø³Ø§Ù†ÙŠØ¯ Ø­Ø§Ù„ÙŠØ©: ÙƒØ´Ù Ù‚Ø§Ø¦Ù…ØŒ ÙƒÙˆØ¯ Ù…Ø³ØªØ®Ø¯Ù… ØºÙŠØ± Ù…Ø­Ø°ÙˆÙØŒ Ø£Ùˆ
  // enrollment Ù†Ø´Ø· Ù…Ø­ÙÙˆØ¸ Ø¹Ù„Ù‰ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ø¹ ØªØ§Ø±ÙŠØ®/Ù…ØµØ¯Ø± ØªÙØ¹ÙŠÙ„ ÙˆÙ„Ù… ÙŠÙØ­Ø°Ù Ù…Ù† Ø§Ù„Ù…Ù‚Ø±Ø±.
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
      String((student as any).accessBlockReason || "") === "ØªÙ… Ø­Ø°ÙÙƒ Ù…Ù† Ø§Ù„Ù…Ù‚Ø±Ø± Ø§Ù„Ø£Ø®ÙŠØ± Ø§Ù„Ù…Ø¹ÙŠÙ† Ù„Ùƒ."
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
    String(student.accessBlockReason || "") === "ØªÙ… Ø­Ø°ÙÙƒ Ù…Ù† Ø§Ù„Ù…Ù‚Ø±Ø± Ø§Ù„Ø£Ø®ÙŠØ± Ø§Ù„Ù…Ø¹ÙŠÙ† Ù„Ùƒ."
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

  // Ø­Ø°Ù ÙƒÙˆØ¯ Ù…Ù† Ø§Ù„Ø£Ø±Ø´ÙŠÙ Ù„Ø§ ÙŠØ¹Ù†ÙŠ Ø­Ø°Ù Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ù† Ø§Ù„Ù…Ù‚Ø±Ø±. Ù„Ø°Ù„Ùƒ Ù†Ù†Ø¸Ù Ø¹Ù„Ø§Ù…Ø© Ø§Ù„Ø­Ø°Ù
  // Ø§Ù„Ø®Ø§ØµØ© Ø¨Ù†ÙØ³ Ø§Ù„Ù…Ù‚Ø±Ø± Ø¥Ù† ÙˆØ¬Ø¯ØªØŒ ÙˆÙ†ØªØ±Ùƒ ØµÙ Ø§Ù„ÙƒØ´Ù ÙŠÙØ±Ø¶ Ø¸Ù‡ÙˆØ± Ø¨Ø·Ø§Ù‚Ø© "ØªÙØ¹ÙŠÙ„" Ù„Ù„Ø·Ø§Ù„Ø¨.
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
  // Ù…Ù‡Ù…: ØµÙ Ø§Ù„ÙƒØ´Ù ÙˆØ­Ø¯Ù‡ Ù„Ø§ ÙŠÙØ¹ØªØ¨Ø± Ø§Ù„ØªØ­Ø§Ù‚Ø§Ù‹ Ø¯Ø±Ø§Ø³ÙŠØ§Ù‹. Ø¹Ù†Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø¥Ø¶Ø§ÙØ© Ø·Ø§Ù„Ø¨ Ù…Ø­Ø°ÙˆÙ
  // Ù†Ø¹Ø±Ø¶ Ù„Ù‡ Ø¨Ø·Ø§Ù‚Ø© Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„ÙƒÙˆØ¯ ÙÙ‚Ø·ØŒ ÙˆÙ„Ø§ Ù†Ø¹ÙŠØ¯ Ø§Ù„Ù…Ù‚Ø±Ø± Ø¥Ù„Ù‰ "Ù…Ø³Ø§Ø±Ùƒ Ø§Ù„Ø¯Ø±Ø§Ø³ÙŠ" ÙƒØ£Ù†Ù‡ Ù…Ù‚Ø±Ø±
  // Ù…ÙˆØ¬ÙˆØ¯ Ø¨Ù„Ø§ ØªÙØ¹ÙŠÙ„. Ù„Ø°Ù„Ùƒ Ù„Ø§ Ù†Ø¯Ù…Ø¬ roster Ø¥Ù„Ø§ Ø¹Ù†Ø¯ Ø·Ù„Ø¨Ù‡ ØµØ±Ø§Ø­Ø© Ù„Ø¨Ù†Ø§Ø¡ Ø¨Ø·Ø§Ù‚Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„.
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
  // Ø¥Ù† Ù„Ù… Ù†Ø¬Ø¯ Ø³Ø¬Ù„Ø§Ù‹ Ù„Ù„Ù…Ù‚Ø±Ø± Ù†ÙØ¨Ù‚ÙŠ Ø§Ù„Ø³Ù„ÙˆÙƒ Ø§Ù„Ù‚Ø¯ÙŠÙ… ÙƒÙ…Ø§ Ù‡Ùˆ: Ù„Ø§ Ù†ØºÙ„Ù‚ Ø§Ù„Ù…Ù‚Ø±Ø± Ø§ÙØªØ±Ø§Ø¶ÙŠØ§Ù‹.
  // Ø£Ù…Ø§ Ø¥Ø°Ø§ ÙˆÙØ¬Ø¯ Ø§Ù„Ø³Ø¬Ù„ØŒ ÙØ²Ø± ÙØªØ­/Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ù…Ù‚Ø±Ø± Ø¹Ù†Ø¯ Ø§Ù„Ù…Ø¹Ù„Ù… Ù‡Ùˆ Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø© Ø§Ù„ÙˆØ­ÙŠØ¯.
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
  return reason.includes("Ø¥ÙŠÙ‚Ø§Ù Ø§Ù„Ø­Ø³Ø§Ø¨ Ù…Ø¤Ù‚Øª") || reason.includes("Ø£Ø³ØªØ§Ø° Ø§Ù„Ù…Ù‚Ø±Ø±");
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
  // Ù„Ø§ Ù†Ù…Ù†Ø­ Ø£ÙŠ Ù…Ù‚Ø±Ø± Ù„Ù…Ø¬Ø±Ø¯ Ø£Ù† isPaid=trueØ› ÙÙƒØ±Ø© Ù…ÙØ±Ø§Ø³ ØªØ¹ØªÙ…Ø¯ Ø¹Ù„Ù‰ ÙƒÙˆØ¯ Ø§Ù„Ù…Ø¹Ù„Ù….
  // Ù‡Ø°Ø§ Ø§Ù„Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ø§Ù„Ø¶ÙŠÙ‚ ÙŠØ­Ø§ÙØ¸ ÙÙ‚Ø· Ø¹Ù„Ù‰ Ø­Ø³Ø§Ø¨Ø§Øª Ù‚Ø¯ÙŠÙ…Ø© Ù…ÙØ¹Ù„Ø© ÙØ¹Ù„Ø§Ù‹ ÙˆÙ„Ø¯ÙŠÙ‡Ø§ activationCodeØŒ
  // Ø£Ù…Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø°ÙŠ Ø£Ø¶ÙŠÙ Ø­Ø¯ÙŠØ«Ø§Ù‹ ÙÙŠ ÙƒØ´Ù Ù…Ø¹Ù„Ù… Ø¢Ø®Ø± ÙÙŠØ¨Ù‚Ù‰ Ù…Ù‚Ø±Ø±Ù‡ Ù…Ù‚ÙÙ„Ø§Ù‹ Ø­ØªÙ‰ ÙŠØ¶Ø¹ Ø§Ù„ÙƒÙˆØ¯.
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
      // ØµÙ Ø§Ù„ÙƒØ´Ù ÙˆØ­Ø¯Ù‡ Ù„Ø§ ÙŠÙØ¸Ù‡Ø± Ø¨Ø·Ø§Ù‚Ø© Ù…Ù‚Ø±Ø± Ù„Ù„Ø·Ø§Ù„Ø¨Ø› ØªØ¸Ù‡Ø± Ø¨Ø·Ø§Ù‚Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„ ÙÙ‚Ø· Ø¨Ø¹Ø¯
      // Ø¥ØµØ¯Ø§Ø± ÙƒÙˆØ¯ Ø¬Ø¯ÙŠØ¯ ÙØ¹Ù„ÙŠ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨/Ø§Ù„Ù…Ù‚Ø±Ø±. Ù‡Ø°Ø§ ÙŠÙ…Ù†Ø¹ ÙƒØ´Ù Ù…Ù‚Ø±Ø±Ø§Øª Ù„Ù… ÙŠØ¨Ø¯Ø£
      // Ø§Ù„Ø£Ø³ØªØ§Ø° ØªÙØ¹ÙŠÙ„Ù‡Ø§ ÙˆÙŠØ­Ø§ÙØ¸ Ø¹Ù„Ù‰ Ø±Ø­Ù„Ø© ÙƒÙ„ Ù…Ù‚Ø±Ø± Ù…Ø³ØªÙ‚Ù„Ø©.
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
}// ØªÙ†Ø¸ÙŠÙ Ø°Ø§ØªÙŠ Ù„Ù„Ø³Ø¬Ù„ Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠ: ÙŠÙØ³Ù‚Ø· Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ù…Ù‚Ø±Ø±Ø§Øª Ø§Ù„ØªÙŠ Ù„Ù… ÙŠØ¹Ø¯ Ù„Ù‡Ø§ Ù‚Ø³Ù… Ù‚Ø§Ø¦Ù…
// (Ù…Ø­Ø°ÙˆÙØ©/Ù…ÙØ¹Ø§Ø¯ ØªØ±Ù‚ÙŠÙ…Ù‡Ø§) Ù…Ù† Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù…Ø®Ø²Ù‘Ù†Ø©ØŒ ÙØªØ¨Ù‚Ù‰ Ø§Ù„Ø³Ø­Ø§Ø¨Ø© Ù†Ø¸ÙŠÙØ© Ø¨Ù…Ø±ÙˆØ±
// Ø§Ù„ÙˆÙ‚Øª. ÙŠÙØ±Ø¬Ø¹ patch ÙÙ‚Ø· Ø¹Ù†Ø¯ ÙˆØ¬ÙˆØ¯ Ù…Ø§ ÙŠÙÙ†Ø¸ÙÙ‘Ù (Ù„Ø§ ÙƒØªØ§Ø¨Ø© Ø¨Ù„Ø§ Ø¯Ø§Ø¹Ù)ØŒ ÙˆÙŠÙØ¯Ù…Ø¬ ÙÙŠ
// ÙƒØªØ§Ø¨Ø© Ù…ÙˆØ¬ÙˆØ¯Ø© Ø£ØµÙ„Ø§Ù‹ (ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„) ÙÙ„Ø§ ÙŠØ¶ÙŠÙ Ø£ÙŠ Ù†Ø¯Ø§Ø¡ Ø¥Ø¶Ø§ÙÙŠ ÙˆÙ„Ø§ ÙŠØ¨Ø·Ù‘Ø¦ Ø´ÙŠØ¦Ø§Ù‹.
// Ø§Ù„Ù…Ù‚Ø±Ø± Ø§Ù„Ù…ÙØºÙ„Ù‚ (isOpen=false) Ù„Ù‡ Ù‚Ø³Ù… Ù‚Ø§Ø¦Ù… ÙÙ„Ø§ ÙŠÙÙ…Ø³Ù‘ â€” Ø§Ù„Ø­Ø°Ù ÙÙ‚Ø· Ù‡Ùˆ Ù…Ø§ ÙŠÙÙ†Ø¸ÙÙ‘Ù.
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
// â”€â”€ ØµØ­Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ÙˆØ§Ù„Ø´ÙØ§Ø¡ Ø§Ù„Ø°Ø§ØªÙŠ (Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù† ÙÙ‚Ø·) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Ù…Ø³Ø­ Ø®ÙÙŠÙ ÙŠÙƒØ´Ù "Ø£Ø´Ø¨Ø§Ø­" Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù†Ø§ØªØ¬Ø© Ø¹Ù† Ø§Ù„Ø­Ø°Ù/Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ±Ù‚ÙŠÙ…: Ø·Ù„Ø§Ø¨ ÙŠØ´ÙŠØ±ÙˆÙ†
// Ù„Ù…Ù‚Ø±Ø± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ØŒ Ø£ÙƒÙˆØ§Ø¯ Ø¨Ù„Ø§ Ù‚Ø³Ù…ØŒ Ø£ÙƒÙˆØ§Ø¯ Ù…Ø±ØªØ¨Ø·Ø© Ø¨Ø·Ø§Ù„Ø¨ Ù…Ø­Ø°ÙˆÙØŒ ØµÙÙˆÙ ÙƒØ´Ù Ø¨Ù„Ø§ Ù‚Ø³Ù….
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

  // 1) Ø£Ø²Ù„ Ø¥Ø´Ø§Ø±Ø§Øª Ø§Ù„Ù…Ù‚Ø±Ø±Ø§Øª Ø§Ù„Ø´Ø¨Ø­ Ù…Ù† Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ø·Ù„Ø§Ø¨
  students.forEach((s: any) => {
    const patch = pruneGhostCoursePatch(s);
    if (patch) {
      dbInstance.updateStudent(s.id, patch as any);
      healedStudents += 1;
    }
  });

  // 2) Ø£Ø±Ø´ÙÙ Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„ØªÙŠ Ù„Ù… ÙŠØ¹Ø¯ Ù„Ù‡Ø§ Ù‚Ø³Ù… Ù‚Ø§Ø¦Ù…
  dbInstance.getJoinCodes().slice().forEach((c: any) => {
    if (!sectionStillExists(c.sectionCode || c.studentSection || c.courseCode)) {
      dbInstance.deleteJoinCode(c.code, "data_heal_orphan_code", actorEmail);
      archivedCodes += 1;
    }
  });

  // 3) Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ù…Ø±ØªØ¨Ø·Ø© Ø¨Ø·Ø§Ù„Ø¨ Ù…Ø­Ø°ÙˆÙ (ÙˆØ§Ù„Ù‚Ø³Ù… Ù‚Ø§Ø¦Ù…) â†’ Ø£Ø¹Ø¯Ù‡Ø§ Ù‚Ø§Ø¨Ù„Ø© Ù„Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù…
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

  // 4) Ø£ÙƒÙˆØ§Ø¯ Ù†Ø´Ø·Ø© Ù…ÙƒØ±Ø±Ø© Ù„Ù†ÙØ³ Ø§Ù„Ø·Ø§Ù„Ø¨/Ø§Ù„Ù…Ù‚Ø±Ø±/Ø§Ù„Ù…Ø§Ù„Ùƒ: Ù†ÙØ¨Ù‚ÙŠ Ø§Ù„Ø£Ø­Ø¯Ø« ÙˆÙ†Ø¤Ø±Ø´Ù Ø§Ù„Ø²Ø§Ø¦Ø¯ Ø¨Ù‡Ø¯ÙˆØ¡
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

  // 5) Ø£Ø²Ù„ ØµÙÙˆÙ Ø§Ù„ÙƒØ´Ù Ø§Ù„ØªÙŠ Ù„Ù… ÙŠØ¹Ø¯ Ù„Ù‡Ø§ Ù‚Ø³Ù…
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
  const nowMs = Date.now();
  return dbInstance
    .getTeacherSubmissions()
    .filter((item: any) => {
      if (!isActiveRecord(item)) return false;
      const kind = String(item.kind || "");
      const activityId = String(item.activityId || "");
      if (kind === "exam") return examIds.has(activityId);
      if (kind === "project") return projectIds.has(activityId);
      return true;
    })
    .map((item: any) => {
      // "Ù…Ù†Ù‚Ø·Ø¹ Ù„Ø§ ÙŠØ­Ù„Ù‘": Ø¥Ù† ØªÙˆÙ‚Ù‘ÙØª Ù†Ø¨Ø¶Ø© Ø¬Ù„Ø³Ø© Ø§Ù„Ø·Ø§Ù„Ø¨ Ø£ÙƒØ«Ø± Ù…Ù† Ù¤Ù¥Ø« Ù†ÙØ¹Ù„Ù‘Ù…
      // liveStale=true ÙÙŠØ¹Ø±Ø¶ Ø§Ù„Ù†Ø¨Ø¶ "ØºÙŠØ± Ù…ØªØµÙ„" Ø¨Ø¯Ù„ "ÙŠØ­Ù„Ù‘ Ø§Ù„Ø¢Ù†" Ù„Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø°ÙŠ Ø®Ø±Ø¬
      // ÙØ¹Ù„Ø§Ù‹. Ø¹Ø±Ø¶ÙŒ ÙÙ‚Ø· â€” Ù„Ø§ Ù†ØºÙŠÙ‘Ø± Ø­Ø§Ù„Ø© Ø§Ù„ØªØ³Ù„ÙŠÙ… (ØªØ¨Ù‚Ù‰ ÙƒÙ…Ø§ Ù‡ÙŠ) ÙÙ„Ø§ ÙŠÙÙ‚ÙÙ„ Ù…Ù† ÙŠÙ†Ù‚Ø·Ø¹
      // Ø§ØªØµØ§Ù„Ù‡ Ù„Ø­Ø¸ÙŠØ§Ù‹ ÙˆÙŠØ¹ÙˆØ¯Ø› Ø­ÙŠÙ† ÙŠØ¹ÙˆØ¯ ØªØªØ¬Ø¯Ù‘Ø¯ Ø§Ù„Ù†Ø¨Ø¶Ø© ÙˆÙŠØ¹ÙˆØ¯ "ÙŠØ­Ù„Ù‘". Ù†Ø­Ø³Ø¨Ù‡Ø§ Ù„ÙƒÙ„
      // ØªØ³Ù„ÙŠÙ…Ø§Øª Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ÙˆÙ„ÙŠØ³ Ù„Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø­Ø±ÙÙŠØ© "Ù‚ÙŠØ¯ Ø§Ù„Ø­Ù„" ÙÙ‚Ø·ØŒ Ù„Ø£Ù† Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© ØªØ¹Ø¯Ù‘
      // ØµÙŠØºØ§Ù‹ ÙƒØ«ÙŠØ±Ø© ÙƒÙ€"Ù‚ÙŠØ¯ Ø­Ù„" (Ù†ØµÙˆØµ/Ø­Ø§Ù„Ø§Øª Ù…Ø®ØªÙ„ÙØ©)ØŒ ÙˆØ³Ø§Ø¨Ù‚Ø§Ù‹ ÙƒØ§Ù†Øª ØªÙ„Ùƒ Ø§Ù„ØµÙŠØº Ù„Ø§
      // ØªÙØ¹Ù„ÙÙ‘Ù… ÙØªØ¨Ù‚Ù‰ Ø®Ø¶Ø±Ø§Ø¡ "ÙŠØ­Ù„Ù‘" Ø±ØºÙ… Ø§Ù†Ù‚Ø·Ø§Ø¹ Ø§Ù„Ø·Ø§Ù„Ø¨ â€” ÙˆÙ‡Ùˆ Ø¬ÙˆÙ‡Ø± Ø§Ù„Ø®Ù„Ù„. ÙˆÙ„Ø§ Ø£Ø«Ø±
      // Ù„Ù‡Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø­Ø§Ù„Ø§Øª Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØ© (Ù…ÙƒØªÙ…Ù„/ØºØ´/Ø§Ù†Ø³Ø­Ø§Ø¨/Ø¥Ø±Ø¬Ø§Ø¹) Ù„Ø£Ù† Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ù„Ø§ ØªÙØ­ØµÙ‡Ø§
      // Ø¥Ù„Ø§ ÙÙŠ Ù…Ø³Ø§Ø± "ÙŠØ­Ù„Ù‘ Ø§Ù„Ø¢Ù†".
      if (String(item.kind || "") !== "exam") return item;
      const sessions = getExamSessionsFor(item.studentId, item.activityId);
      let beat = 0;
      for (const s of sessions as any[]) {
        const t = new Date(
          s.lastHeartbeatAt || s.updatedAt || s.startedAt || 0,
        ).getTime();
        if (Number.isFinite(t) && t > beat) beat = t;
      }
      // Ø§Ù„Ø¹Ù…ÙŠÙ„ ÙŠÙ†Ø¨Ø¶ ÙƒÙ„ Ù£Ø« ÙˆØªÙ†ØªÙ‡ÙŠ ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ø¬Ù„Ø³Ø© Ø¹Ù†Ø¯ Ù¡Ù¥Ø«Ø› ÙØ¹ØªØ¨Ø© Ù¢Ù Ø« ØªØ¹Ù†ÙŠ "Ù…Ù†Ù‚Ø·Ø¹"
      // Ø®Ù„Ø§Ù„ Ù¢Ù Ø« Ù…Ù† Ø®Ø±ÙˆØ¬/Ø§Ù†Ø³Ø­Ø§Ø¨ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø¯Ù„ Ù¤Ù¥Ø«. Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø°ÙŠ ÙŠØ­Ù„Ù‘ ÙØ¹Ù„Ø§Ù‹ ÙŠÙ†Ø¨Ø¶ ÙƒÙ„
      // Ù£Ø« ÙÙ„Ø§ ÙŠÙØ¹Ù„ÙÙ‘Ù… Ø£Ø¨Ø¯Ø§Ù‹ (Ù¦+ Ù†Ø¨Ø¶Ø§Øª Ø¶Ù…Ù† Ø§Ù„Ù†Ø§ÙØ°Ø©ØŒ Ø¢Ù…Ù† Ø¶Ø¯ Ø§Ù†Ù‚Ø·Ø§Ø¹Ø§Øª Ø§Ù„Ø´Ø¨ÙƒØ© Ø§Ù„Ù„Ø­Ø¸ÙŠØ©).
      return { ...item, liveStale: !beat || nowMs - beat > 20000 };
    });
}

function normalizeStudentId(value: any): string {
  return String(value ?? "")
    .trim()
    .replace(/[Ù -Ù©]/g, (d) => String("Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©".indexOf(d)))
    .replace(/[Û°-Û¹]/g, (d) => String("Û°Û±Û²Û³Û´ÛµÛ¶Û·Û¸Û¹".indexOf(d)))
    .replace(/[^0-9]/g, "");
}

// â”€â”€ Ø§Ù„Ø§Ø³Ù… Ø§Ù„Ø­ÙŠÙ‘ ÙƒÙ…ØµØ¯Ø± ÙˆØ­ÙŠØ¯ Ù„Ù„Ø­Ù‚ÙŠÙ‚Ø© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Ø³Ø¬Ù„ Ø§Ù„Ø·Ø§Ù„Ø¨ (students) Ù‡Ùˆ Ø§Ù„Ù…Ø±Ø¬Ø¹. Ø£ÙŠ ÙƒØ§Ø¦Ù† ÙŠØ­Ù…Ù„ studentId (ØªØ³Ù„ÙŠÙ…ØŒ Ø³Ø¬Ù„ØŒ Ø·Ù„Ø¨)
// ÙŠÙØ®ØªÙ… Ø¨Ø§Ø³Ù… Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø­Ø§Ù„ÙŠ Ø¹Ù†Ø¯ Ø§Ù„Ù‚Ø±Ø§Ø¡Ø©ØŒ ÙÙ„Ø§ Ù†Ø¹ØªÙ…Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø§Ø³Ù… Ø§Ù„Ù…Ù†Ø³ÙˆØ® Ø§Ù„Ù‚Ø¯ÙŠÙ….
// Ù‡Ø°Ø§ ÙŠØ¬Ø¹Ù„ ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø§Ø³Ù… ÙŠÙ†Ø¹ÙƒØ³ ÙÙˆØ±Ø§Ù‹ ÙÙŠ Ø§Ù„ØªØµØ­ÙŠØ­ ÙˆØ§Ù„Ù…ØªØ§Ø¨Ø¹Ø© ÙˆÙƒÙ„ Ø§Ù„Ø´Ø§Ø´Ø§Øª.
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
    .replace(/[Ù -Ù©]/g, (d) => String("Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©".indexOf(d)))
    .replace(/[Û°-Û¹]/g, (d) => String("Û°Û±Û²Û³Û´ÛµÛ¶Û·Û¸Û¹".indexOf(d)));
}

function normalizeJoinCode(value: any): string {
  if (!value) return "";
  const cleaned = String(value)
    .trim()
    .toUpperCase()
    .replace(/[Ù -Ù©]/g, (d) => String("Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©".indexOf(d)))
    .replace(/[Û°-Û¹]/g, (d) => String("Û°Û±Û²Û³Û´ÛµÛ¶Û·Û¸Û¹".indexOf(d)));
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
  // Ø£ÙŠ Ø¹Ø§Ø¦Ù„Ø© ØºÙŠØ± Ù…Ø¹Ø±ÙÙ‘ÙØ© (unknown/mozilla Ø¨Ø£ÙŠ Ù„Ø§Ø­Ù‚Ø© ÙˆØ¶Ø¹ Ø¹Ø±Ø¶ Ù…Ø«Ù„ unknown-browser-browser)
  // ØªÙØ¹Ø§Ù…Ù„ legacy: Ù„Ø§ Ù†ÙØ±Ø¶ Ù‚ÙÙ„ Ø§Ù„Ø³Ø·Ø­ Ø¹Ù„Ù‰ Ù…ØªØµÙØ­ Ù„Ø§ Ù†Ø³ØªØ·ÙŠØ¹ ØªÙ…ÙŠÙŠØ² Ù‡ÙˆÙŠØªÙ‡ Ø£ØµÙ„Ø§Ù‹.
  if (!family || family.startsWith("unknown") || family.startsWith("mozilla"))
    return "legacy";
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

// Ù‡ÙˆÙŠØ© Ø§Ù„Ø¬Ù‡Ø§Ø² = Ø§Ù„Ù€ deviceToken Ø§Ù„Ø«Ø§Ø¨ØªØŒ ÙˆÙ„ÙŠØ³ Ø§Ù„Ù€ IP. ØµÙŠØºØ© Ø§Ù„Ø¨ØµÙ…Ø© Ù‡ÙŠ
// "<Ù…ØªØµÙØ­>_<ip>_<hash(deviceToken)>"ØŒ ÙˆØ§Ù„Ù…Ù‚Ø·Ø¹ Ø§Ù„Ø«Ø§Ø¨Øª Ø§Ù„ÙˆØ­ÙŠØ¯ Ù‡Ùˆ Ø¢Ø®Ø± Ù…Ù‚Ø·Ø¹
// (Ø¨ØµÙ…Ø© Ø§Ù„Ù€ deviceToken). ØªØºÙŠÙ‘Ø± Ø§Ù„Ù€ IP ÙˆØ­Ø¯Ù‡ (Ø§Ù†ØªÙ‚Ø§Ù„ Ù…Ù† ÙˆØ§ÙŠâ€‘ÙØ§ÙŠ Ø¥Ù„Ù‰ Ø¨ÙŠØ§Ù†Ø§ØªØŒ
// Ø£Ùˆ Ø®Ù„Ù Ø¨Ø±ÙˆÙƒØ³ÙŠ) ÙƒØ§Ù† ÙŠÙØºÙŠÙ‘Ø± Ø§Ù„Ø¨ØµÙ…Ø© ÙƒØ§Ù…Ù„Ø©Ù‹ ÙÙŠÙØ±ÙØ¶ Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø®Ø·Ø£Ù‹ Ø¹Ù†Ø¯ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø£Ùˆ
// Ø¹Ù†Ø¯ Ø¥Ø¶Ø§ÙØ© Ù…Ù‚Ø±Ø± Ø¬Ø¯ÙŠØ¯. Ù†Ù‚Ø§Ø±Ù† Ø§Ù„Ù…Ù‚Ø·Ø¹ Ø§Ù„Ø«Ø§Ø¨Øª ÙÙ‚Ø·ØŒ ÙˆÙ†Ø¹ÙˆØ¯ Ù„Ù„Ù…Ø·Ø§Ø¨Ù‚Ø© Ø§Ù„Ø­Ø±ÙÙŠØ© Ø¥Ø°Ø§ ØºØ§Ø¨
// Ø§Ù„ØªÙˆÙƒÙ† (Ø¨ÙŠØ§Ù†Ø§Øª Ù‚Ø¯ÙŠÙ…Ø©) Ø­ØªÙ‰ Ù„Ø§ Ù†ÙƒØ³Ø± Ø£ÙŠ Ø±Ø¨Ø· Ø¬Ù‡Ø§Ø² Ø³Ø§Ø¨Ù‚ Ø£Ùˆ SEB Ø£Ùˆ ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„Ø¬Ù‡Ø§Ø².
function deviceTokenHashSegment(fingerprint: any): string {
  const s = String(fingerprint || "").trim();
  if (!s) return "";
  const idx = s.lastIndexOf("_");
  const seg = idx >= 0 ? s.slice(idx + 1) : s;
  return seg && seg !== "no-device-token" ? seg : "";
}

// Ø³Ø·Ø­ Ø§Ù„Ø·Ù„Ø¨ Ù„ÙØ­Øµ Ø§Ù„Ù‚ÙÙ„ Ø§Ù„ØµØ§Ø±Ù… (Ø³ÙØ§Ø±ÙŠâ†”PWA): Ø¹Ø§Ø¦Ù„Ø© Ø§Ù„Ù…ØªØµÙØ­ + ÙˆØ¶Ø¹ Ø§Ù„Ø¹Ø±Ø¶ Ù…Ù† ØªØ±ÙˆÙŠØ³Ø©
// Ø§Ù„Ø¹Ù…ÙŠÙ„ ÙÙ‚Ø· (x-miras-display-mode Ø§Ù„ØªÙŠ ÙŠØ±Ø³Ù„Ù‡Ø§ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…Ø¹ ÙƒÙ„ Ø·Ù„Ø¨). Ù„Ø§ Ù†Ø³ØªØ®Ø¯Ù…
// displayMode Ù…Ù† Ø¬Ø³Ù…/Ø§Ø³ØªØ¹Ù„Ø§Ù… Ø§Ù„Ø·Ù„Ø¨ Ù„Ø£Ù†Ù‡ Ù…Ø¹Ø·Ù‰ Ù†Ø¸Ø§Ù… Ù‚ÙÙ„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± (Ø³ÙŠØ§Ù‚ Ø§Ù„Ø¬Ù„Ø³Ø©) Ù„Ø§
// Ù‡ÙˆÙŠØ© Ø§Ù„Ù…ØªØµÙØ­ â€” ÙˆØ§Ø³ØªØ®Ø¯Ø§Ù…Ù‡ ÙƒØ³Ø·Ø­ Ø£Ù…Ù†ÙŠ ÙƒØ§Ù† ÙŠØ­Ø¬Ø¨ Ø·Ù„Ø¨Ø§Øª Ø§Ø®ØªØ¨Ø§Ø± Ø´Ø±Ø¹ÙŠØ© Ø¯Ø§Ø®Ù„ Ù†ÙØ³ Ø§Ù„Ø¬Ù„Ø³Ø©.
function strictRequestSurfaceSegment(req: express.Request): string {
  const family = browserFamilyFromUserAgent(
    String((req as any)?.headers?.["user-agent"] || ""),
  );
  const mode = normalizeExamSessionDisplayMode(
    (req as any)?.headers?.["x-miras-display-mode"],
  );
  return deviceFingerprintBrowserSegment(`${family}-${mode}_x_x`);
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
  if (af === bf) return true;
  const withoutDisplayMode = (value: string) =>
    value.replace(/-(?:browser|pwa)$/i, "");
  return withoutDisplayMode(af) === withoutDisplayMode(bf);
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

  // Safari ÙˆÙ†Ø³Ø®Ø© PWA Ø¹Ù„Ù‰ iOS Ù‚Ø¯ ÙŠØ´ØªØ±ÙƒØ§Ù† ÙÙŠ deviceToken Ù†ÙØ³Ù‡. Ù„Ø°Ù„Ùƒ Ù„Ø§ ÙŠØ¬ÙˆØ² Ø£Ù†
  // Ù†Ø±ÙØ¶ Ø§Ù„Ù…ØªØµÙØ­/PWA Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ù„Ù…Ø¬Ø±Ø¯ ØªØ·Ø§Ø¨Ù‚ Ø§Ù„ØªÙˆÙƒÙ†Ø› Ø§Ù„Ø¨ØµÙ…Ø© ØªØ¶ÙŠÙ Ø¹Ø§Ø¦Ù„Ø© Ø§Ù„Ù…ØªØµÙØ­ ÙˆÙˆØ¶Ø¹
  // Ø§Ù„Ø¹Ø±Ø¶ (browser Ø£Ùˆ pwa)ØŒ ÙˆÙ‡ÙŠ Ø§Ù„ØªÙŠ ØªØ­Ø¯Ø¯ Ù‡Ù„ Ù‡Ø°Ù‡ Ù‡ÙŠ Ø§Ù„Ø¬Ù„Ø³Ø© Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø© ÙØ¹Ù„Ø§Ù‹.
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
      // Ø§Ù„Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø© Ù„Ø§ ØªØ­ØªÙˆÙŠ Ù†ÙˆØ¹ Ø§Ù„Ù…ØªØµÙØ­/ÙˆØ¶Ø¹ PWA. Ø¹Ù†Ø¯ ØªØ¨Ø¯ÙŠÙ„ ØµØ±ÙŠØ­ Ù…Ù†
      // Ø§Ù„Ø£Ø³ØªØ§Ø° Ù†Ø³Ù…Ø­ Ø¨ØªØ±Ù‚ÙŠØªÙ‡Ø§ Ø¥Ù„Ù‰ Ø¨ØµÙ…Ø© Ø­Ø¯ÙŠØ«Ø© Ø¨Ø¯Ù„ Ø¥Ø¨Ù‚Ø§Ø¡ Ø§Ù„Ø·Ø§Ù„Ø¨ ÙÙŠ Ø­Ù„Ù‚Ø© Ù‚ÙÙ„ Ø¯Ø§Ø¦Ù…Ø©.
      return retiredIsLegacy && currentIsLegacy;
    });
  }

  // ØªÙˆØ§ÙÙ‚ Ø¢Ù…Ù† Ù…Ø¹ Ø³Ø¬Ù„Ø§Øª Ù‚Ø¯ÙŠÙ…Ø© Ù„Ù… ØªÙƒÙ† ØªØ­ÙØ¸ Ø§Ù„Ø¨ØµÙ…Ø© Ø§Ù„ÙƒØ§Ù…Ù„Ø©.
  return (
    !!currentDeviceToken &&
    retiredDeviceTokens.some(
      (retiredToken: string) => retiredToken === currentDeviceToken,
    )
  );
}

const STUDENT_DEVICE_ALREADY_BOUND_ERROR =
  "Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø² Ù…Ø±ØªØ¨Ø· Ø¨Ø­Ø³Ø§Ø¨ Ø·Ø§Ù„Ø¨ Ø¢Ø®Ø±. Ø§Ø³ØªØ®Ø¯Ù… Ø¬Ù‡Ø§Ø²Ùƒ Ø§Ù„Ø´Ø®ØµÙŠ Ø£Ùˆ Ø§Ø·Ù„Ø¨ Ù…Ù† Ø£Ø³ØªØ§Ø° Ø§Ù„Ù…Ù‚Ø±Ø± Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¬Ù‡Ø§Ø² Ø¬Ø¯ÙŠØ¯.";

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


const SECOND_HAND_DEVICE_APPROVAL_REASON = "Ø·Ù„Ø¨ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¬Ù‡Ø§Ø² Ù…Ø³ØªØ®Ø¯Ù… Ø³Ø§Ø¨Ù‚Ù‹Ø§";

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
      reason: "ÙŠÙˆØ¬Ø¯ Ø·Ù„Ø¨ Ø§Ø¹ØªÙ…Ø§Ø¯ Ù†Ø´Ø· Ù„Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø² Ù…Ø¹ Ø·Ø§Ù„Ø¨ Ø¢Ø®Ø± ÙÙŠ Ù†ÙØ³ Ø§Ù„Ù…Ù‚Ø±Ø±.",
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
      reason: "ÙŠÙˆØ¬Ø¯ ØªØµØ±ÙŠØ­ Ø§Ø®ØªØ¨Ø§Ø± SEB Ù†Ø´Ø· Ù„Ø·Ø§Ù„Ø¨ Ø¢Ø®Ø± Ø¹Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø² ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„Ù…Ù‚Ø±Ø±.",
    };
  }

  const recentViolation = dbInstance.getActivationAttempts().find((attempt: any) => {
    if (normalizeStudentId(attempt.targetStudentId || attempt.studentId) === studentId) return false;
    if (sectionCode && !sectionCodeEquivalent(attempt.targetSectionCode || attempt.sectionCode, sectionCode)) return false;
    const attemptTime = new Date(attempt.timestamp || attempt.createdAt || 0).getTime() || 0;
    if (!attemptTime || now - attemptTime > 6 * 60 * 60 * 1000) return false;
    const text = `${attempt.reason || ""} ${attempt.activeConflictReason || ""}`;
    if (!/ØºØ´|SEB|Ø¬Ù„Ø³Ø© Ù†Ø´Ø·Ø©|ØªØ¹Ø§Ø±Ø¶ Ù†Ø´Ø·|Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙØ¹ÙŠÙ„ ÙƒÙˆØ¯ Ù…Ù† Ø¬Ù‡Ø§Ø² Ù…Ø±ØªØ¨Ø·/.test(text)) return false;
    return (
      sameDeviceValue(attempt.deviceToken, token) ||
      deviceFingerprintsMatch(attempt.deviceFingerprint, fingerprint)
    );
  });
  if (recentViolation) {
    return {
      conflict: true,
      reason: "ÙŠÙˆØ¬Ø¯ Ù†Ø´Ø§Ø· Ø£Ù…Ù†ÙŠ Ø­Ø¯ÙŠØ« Ø¹Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø¯Ø§Ø®Ù„ Ù‡Ø°Ø§ Ø§Ù„Ù…Ù‚Ø±Ø±ØŒ ÙˆÙŠØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø© Ù…Ø¨Ø§Ø´Ø±Ø©.",
    };
  }

  return { conflict: false, reason: "Ù„Ø§ ÙŠÙˆØ¬Ø¯ ØªØ¹Ø§Ø±Ø¶ Ù†Ø´Ø· Ø§Ù„Ø¢Ù†." };
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
    deviceApprovalRecommendation: conflict.conflict ? "ÙŠØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø© Ù‚Ø¨Ù„ Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯" : "Ù„Ø§ ÙŠÙˆØ¬Ø¯ ØªØ¹Ø§Ø±Ø¶ Ù†Ø´Ø·",
    silentEnforcement: true,
    recommendedAction: conflict.conflict ? "Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø·Ù„Ø¨ Ù‚Ø¨Ù„ Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯" : "Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø¥Ø°Ø§ ØªØ·Ø§Ø¨Ù‚Øª Ù‡ÙˆÙŠØ© Ø§Ù„Ø·Ø§Ù„Ø¨",
  };
  dbInstance.addActivationAttempt(request);
  rememberInAppNotification({
    role: "teacher",
    teacherEmail: params.teacherEmail,
    sectionCode: params.sectionCode,
    type: "second_hand_device_approval",
    title: "Ø·Ù„Ø¨ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¬Ù‡Ø§Ø² Ù…Ø³ØªØ®Ø¯Ù… Ø³Ø§Ø¨Ù‚Ù‹Ø§",
    body: `${params.student.name || params.student.id} â€¢ ${courseNameFromCode(params.sectionCode)} â€¢ ${conflict.reason}`,
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
    action: "Ø·Ù„Ø¨ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¬Ù‡Ø§Ø² Ù…Ø³ØªØ®Ø¯Ù… Ø³Ø§Ø¨Ù‚Ù‹Ø§",
    details: `Ø·Ù„Ø¨ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¬Ù‡Ø§Ø² Ø³Ø¨Ù‚ Ø§Ø³ØªØ®Ø¯Ø§Ù…Ù‡ ÙÙŠ Ø§Ù„Ù†Ø¸Ø§Ù… Ù„Ù„Ø·Ø§Ù„Ø¨ ${params.student.name || params.student.id} ÙÙŠ Ù…Ù‚Ø±Ø± ${courseNameFromCode(params.sectionCode)}. ${conflict.reason}`,
    teacherEmail: params.teacherEmail,
    actorEmail: params.teacherEmail,
    sectionCode: params.sectionCode,
    ip: params.req.ip || "127.0.0.1",
    userAgent: params.req.headers["user-agent"] || "Unknown",
    os: "Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¬Ù‡Ø§Ø²",
    browser: "Ù…ØªØµÙØ­ Ø§Ù„ÙˆÙŠØ¨",
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

function examRequiresSeb(exam: any): boolean {
  return !!(exam?.seb?.enabled || exam?.sebEnabled);
}

function hasActualSebRuntimeHint(req: express.Request): boolean {
  const userAgent = String(req.headers["user-agent"] || "");
  const explicitSebHeader = !!String(req.headers["x-miras-seb-armed"] || "").trim();
  const sebRequestHash = !!String(req.headers["x-safeexambrowser-requesthash"] || "").trim();
  if (/SafeExamBrowser|SEB/i.test(userAgent) || sebRequestHash || explicitSebHeader) return true;

  // Ø¨Ø¹Ø¶ Ø¥ØµØ¯Ø§Ø±Ø§Øª SEB/Ø£Ù†Ø¸Ù…Ø© iOS Ù„Ø§ ØªÙØ¸Ù‡Ø± SafeExamBrowser ÙÙŠ userAgent ÙˆÙ„Ø§ ØªØ±Ø³Ù„
  // requestHashØŒ ÙØªÙØ´Ù„ Ø£ÙˆÙ„ Ø®Ø·ÙˆØ© validate Ø±ØºÙ… Ø£Ù† Ø§Ù„Ø±Ø§Ø¨Ø· Ù„Ø§ ÙŠØ­Ù…Ù„ Ø¥Ù„Ø§ ØªÙˆÙƒÙ† SEB
  // Ø§Ù„Ù…Ø¤Ù‚Øª Ø§Ù„ØµØ§Ø¯Ø± Ù…Ù† Ø§Ù„Ø®Ø§Ø¯Ù…. Ù†Ù‚Ø¨Ù„ Ù‡Ø°Ù‡ Ø§Ù„Ø¹Ù„Ø§Ù…Ø© ÙÙŠ Ù…Ø³Ø§Ø± Ø§Ù„ØªØ­Ù‚Ù‚ ÙÙ‚Ø·ØŒ ÙˆØ¨Ø¹Ø¯Ù‡Ø§ ØªÙÙØ¹ÙÙ‘Ù„
  // Ø§Ù„Ø¬Ù„Ø³Ø© ÙˆØªÙØ±Ø³Ù„ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© x-miras-seb-armed ÙÙŠ Ø¨Ù‚ÙŠØ© Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±. Ù‡Ø°Ø§ Ù„Ø§ ÙŠÙØªØ­
  // ØªØ¬Ø§ÙˆØ²Ù‹Ø§ Ø¹Ø§Ù…Ù‹Ø§ Ù„Ø£Ù† Ø§Ù„ØªÙˆÙƒÙ† Ù†ÙØ³Ù‡ Ù„Ø§Ø²Ù… ÙŠÙƒÙˆÙ† Ù…ÙˆØ¬ÙˆØ¯Ù‹Ø§ ÙˆØµØ§Ù„Ø­Ù‹Ø§ ÙˆÙ…Ø·Ø§Ø¨Ù‚Ù‹Ø§ Ù„Ù„Ø·Ø§Ù„Ø¨/Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.
  if (req.path === "/api/seb/validate") {
    return !!(
      getSebPassFromRequest(req) &&
      (String((req.body as any)?.seb || "") === "1" ||
        String((req.body as any)?.miras_seb || "") === "1")
    );
  }
  return false;
}

function isSebRequest(req: express.Request): boolean {
  return hasActualSebRuntimeHint(req) && !!getSebPassFromRequest(req);
}

function hasSebRuntimeHint(req: express.Request): boolean {
  return hasActualSebRuntimeHint(req);
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

// ØªØµÙ†ÙŠÙ ÙØ´Ù„ FCM: Ø§Ù„ØªÙ…ÙŠÙŠØ² Ø­Ø§Ø³Ù… â€” ÙƒØ§Ù† Ø§Ù„ÙƒÙˆØ¯ ÙŠØ¹Ø¯Ù… Ø§Ù„ØªÙˆÙƒÙ† Ø¹Ù„Ù‰ INVALID_ARGUMENT
// Ø£ÙŠØ¶Ø§Ù‹ØŒ ÙˆÙ‡Ùˆ Ø®Ø·Ø£ Ø¹Ø§Ø¨Ø± Ø´Ø§Ø¦Ø¹ Ø£Ø«Ù†Ø§Ø¡ Ø§Ù†ØªÙ‚Ø§Ù„ Service Worker Ø¹Ù„Ù‰ iOS PWA (ÙƒÙ„ Ù†Ø´Ø± SW
// Ø¬Ø¯ÙŠØ¯ ÙŠØ¨Ø·Ù„ Ø§Ø´ØªØ±Ø§Ùƒ Ø§Ù„Ø¯ÙØ¹ Ù„Ø«ÙˆØ§Ù†Ù). ÙØ£Ø¹Ø¯Ù… Ø§Ù„Ù†Ø´Ø±Ù Ø§Ù„Ù…ØªÙƒØ±Ø±Ù (v58â†’v61) ÙƒÙ„ ØªÙˆÙƒÙ†Ø§Øª
// Ø§Ù„Ø·Ø§Ù„Ø¨ ÙÙ„Ù… ÙŠØµÙ„ Ø£ÙŠ Ø¨Ø§Ù†Ø±. Ø§Ù„Ø¢Ù†:
//   dead      = Ù…ÙŠØª Ù…Ø¤ÙƒØ¯ (UNREGISTERED) â‡’ Ø¹Ø·Ù‘Ù„ ÙÙˆØ±Ø§Ù‹
//   invalid   = INVALID_ARGUMENT â‡’ Ø¹Ø·Ù‘Ù„ ÙÙ‚Ø· Ø¥Ù† ÙƒØ§Ù† Ø§Ù„ØªÙˆÙƒÙ† Ù‚Ø¯ÙŠÙ…Ø§Ù‹ (Ù„ÙŠØ³ Ø·Ø§Ø²Ø¬Ø§Ù‹)
//   transient = Ø®Ø·Ø£ Ù…Ø¤Ù‚Øª (Ø´Ø¨ÙƒØ©/ÙƒÙˆØªØ§) â‡’ Ù„Ø§ ØªØ¹Ø·Ù‘Ù„ Ø£Ø¨Ø¯Ø§Ù‹
function fcmFailureClass(reason: string): "dead" | "invalid" | "transient" {
  const r = String(reason || "");
  if (/UNREGISTERED|registration-token-not-registered|Requested entity was not found|NOT_FOUND/i.test(r))
    return "dead";
  if (/INVALID_ARGUMENT|invalid-argument|invalid registration/i.test(r))
    return "invalid";
  return "transient";
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
  // Data-only Ù‡Ùˆ Ø§Ù„Ù…Ø³Ø§Ø± Ø§Ù„ÙˆØ­ÙŠØ¯ Ù„Ù„Ø¹Ø±Ø¶: Ø­ÙŠÙ† Ù†Ø±Ø³Ù„ notification + webpush.notification
  // ØªØ¹Ø±Ø¶ Firebase Ø§Ù„Ø¨Ø§Ù†Ø± ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ØŒ Ø«Ù… ÙƒØ§Ù† Ø§Ù„Ù€SW ÙŠØ¹Ø±Ø¶Ù‡ ÙŠØ¯ÙˆÙŠØ§Ù‹ Ù…Ø±Ø© Ø«Ø§Ù†ÙŠØ©. Ù†Ø±Ø³Ù„ Ø­Ø¯Ø«Ø§Ù‹
  // ÙˆØ§Ø­Ø¯Ø§Ù‹ ÙŠØ­Ù…Ù„ Ø§Ù„Ù†Øµ Ø¯Ø§Ø®Ù„ dataØŒ ÙˆØ§Ù„Ù€SW ÙŠÙ‚Ø±Ø± Ø§Ù„Ø¹Ø±Ø¶/Ø§Ù„ÙƒØªÙ… ÙˆÙŠØ·Ø¨Ù‘Ù‚ Ù…Ù†Ø¹ Ø§Ù„ØªÙƒØ±Ø§Ø±.
  const webpush: any = {
    headers: {
      Urgency: "high",
      TTL: "86400",
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
    .replace(/[ÙÙ‹ÙÙŒÙÙÙ’Ù‘Ù€]/g, "")
    .replace(/[Ø¥Ø£Ø¢Ø§]/g, "Ø§")
    .replace(/Ù‰/g, "ÙŠ")
    .replace(/Ø©/g, "Ù‡")
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
  // Ø¥Ø´Ø§Ø±Ø§Øª Ø¥Ø¯Ø§Ø±ÙŠØ© ØµØ±ÙŠØ­Ø© Ø¹Ù†Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ â†’ Ù…ÙƒØªÙˆÙ…Ø© Ø¯Ø§Ø¦Ù…Ø§Ù‹ Ø¹Ù† Ø§Ù„Ø·Ø§Ù„Ø¨.
  if (
    data.silentCameraExceptionUpdate === true ||
    data.notifyStudents === false ||
    data.notifyStudents === "false" ||
    data.onlyAdministrativeEdit === true ||
    data.isAdministrativeEdit === true ||
    data.silent === true ||
    data.silent === "true" ||
    type === "camera_exception" ||
    type === "exam_integrity_pulse" ||
    type === "teacher_camera_exception"
  ) {
    return true;
  }

  // âš¡ allowlist (Ø³Ù…Ø§Ø­ ØµØ±ÙŠØ­ØŒ default-deny): Ù„Ø§ ÙŠØµÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¥Ù„Ø§ Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ù…Ù‡Ù…Ø©
  // Ø§Ù„ØªÙŠ ØªØ®ØµÙ‘Ù‡ Ø£Ùˆ ØªØªØ·Ù„Ø¨ Ø¹Ù„Ù…Ù‡/ØªØµØ±Ù‘ÙÙ‡. Ø£ÙŠ Ø´ÙŠØ¡ Ø¢Ø®Ø± (ØªØ¹Ø¯ÙŠÙ„ Ø£Ø³Ù…Ø§Ø¡ØŒ ÙƒØ§Ù…ÙŠØ±Ø§ØŒ ØªØ­Ø¯ÙŠØ«Ø§Øª
  // Ø¥Ø¯Ø§Ø±ÙŠØ©ØŒ ØªÙ†Ø¸ÙŠÙâ€¦) ÙŠÙÙƒØªÙ… Ø§ÙØªØ±Ø§Ø¶ÙŠØ§Ù‹ â€” ÙÙ„Ø§ ØªØªØ³Ø±Ù‘Ø¨ Ø§Ù„Ø£Ø­Ø¯Ø§Ø« Ø§Ù„Ø¥Ø¯Ø§Ø±ÙŠØ© Ø­ØªÙ‰ Ù„Ùˆ ÙƒØ§Ù†
  // Ù†ÙˆØ¹Ù‡Ø§ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ. ÙŠØ¨Ù‚Ù‰ ØªÙ…Ø±ÙŠØ± Ø£ÙŠ Ø¥Ø´Ø¹Ø§Ø± Ø­Ù…Ù„Ù‡ Ø§Ù„Ù…Ø¹Ù„Ù… ØµØ±Ø§Ø­Ø©Ù‹ ÙƒÙ…Ù‡Ù… Ø¹Ø¨Ø± Ø§Ù„Ø£Ø¹Ù„Ø§Ù….
  const importantTypes = new Set([
    "exam_new", "new_exam", "exam_available", "exam_open", "exam_published",
    "project_new", "new_project", "project_available", "project_published",
    "assignment_due", "submission_due", "deadline", "deadline_soon", "due_soon",
    "exam_cancelled", "exam_canceled", "project_cancelled", "project_canceled",
    "activity_cancelled", "calendar_event_deleted",
    "attempt_reopened", "attempt_opened", "exam_returned", "quiz_returned",
    "project_returned", "submission_returned", "returned",
    "grade_published", "grade", "grade_updated", "result_published", "result",
    "submission_accepted", "submission_rejected",
    "request_accepted", "request_rejected",
    "password_reset", "password_reset_approved", "account_security",
    "security_action", "device_approved", "device_change",
    "teacher_announcement", "important_alert", "action_required",
    "calendar_event", "reminder",
  ]);
  const importantByType =
    importantTypes.has(type) ||
    /new_(exam|quiz|project)|(exam|quiz|project)_new|due|deadline|cancel|return|reopen|grade|result|accept|reject|password|security|announcement|reminder|action_required/.test(
      type,
    );
  const importantByText =
    /Ø§Ø®ØªØ¨Ø§Ø± Ø¬Ø¯ÙŠØ¯|Ù…Ø´Ø±ÙˆØ¹ Ø¬Ø¯ÙŠØ¯|ÙˆØ§Ø¬Ø¨ Ø¬Ø¯ÙŠØ¯|ØªØ³Ù„ÙŠÙ… Ù…Ø·Ù„ÙˆØ¨|Ù…Ø·Ù„ÙˆØ¨ Ù…Ù†Ùƒ|Ø¯Ø±Ø¬Ø©|Ø¯Ø±Ø¬Ù‡|Ù†Ø´Ø± Ø¯Ø±Ø¬Øª|Ù†ØªÙŠØ¬ØªÙƒ|Ø§Ø±Ø¬Ø§Ø¹|Ø¥Ø±Ø¬Ø§Ø¹|Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­|Ø§Ø¹Ø§Ø¯Ù‡ ÙØªØ­|ÙØªØ­ Ù…Ø­Ø§ÙˆÙ„Ø©|ÙØªØ­ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©|Ù‚Ø¨ÙˆÙ„|Ø±ÙØ¶|Ø¥Ù„ØºØ§Ø¡ Ø§Ø®ØªØ¨Ø§Ø±|Ø§Ù„ØºØ§Ø¡ Ø§Ø®ØªØ¨Ø§Ø±|Ø¥Ù„ØºØ§Ø¡ Ù…Ø´Ø±ÙˆØ¹|Ø§Ù„ØºØ§Ø¡ Ù…Ø´Ø±ÙˆØ¹|ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ±|Ø§Ø³ØªØ±Ø¬Ø§Ø¹|Ø§Ø³ØªØ±Ø¯Ø§Ø¯|Ù…ÙˆØ¹Ø¯|Ø§Ù‚ØªØ±Ø§Ø¨ Ù…ÙˆØ¹Ø¯|Ù‚Ø±Ø¨ Ù…ÙˆØ¹Ø¯|Ù…ØªØ§Ø­ Ø§Ù„Ø¢Ù†|ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±|Ø¥Ø¹Ù„Ø§Ù†|ØªÙ†Ø¨ÙŠÙ‡ Ù…Ù‡Ù…|Ù…Ø®Ø§Ù„ÙØ©|ØªØ­Ø°ÙŠØ± Ù…Ù‡Ù…/.test(
      text,
    );
  const explicitImportant =
    (data.notifyStudents === true || data.notifyStudents === "true") &&
    (data.important === true ||
      data.important === "true" ||
      data.containsActionRequired === true ||
      data.containsActionRequired === "true" ||
      data.actionRequired === true ||
      data.actionRequired === "true");

  const isImportantForStudent =
    importantByType || importantByText || explicitImportant;

  // âœ¨ Ø§Ù„Ø£Ù‡Ù… ÙŠÙ…Ø±Ù‘ Ø¯Ø§Ø¦Ù…Ø§Ù‹ (Ø´Ø¨ÙƒØ© Ø£Ù…Ø§Ù† ØªÙ…Ù†Ø¹ Ø­Ø¬Ø¨ Ø§Ø®ØªØ¨Ø§Ø± Ø¬Ø¯ÙŠØ¯/Ø¯Ø±Ø¬Ø©/Ø¥Ø±Ø¬Ø§Ø¹/ØªÙ†Ø¨ÙŠÙ‡ Ø¨Ø§Ù„Ø®Ø·Ø£).
  if (isImportantForStudent) return false;

  // Ù†Ø­Ø¬Ø¨ ÙÙ‚Ø· Ø§Ù„Ø¶Ø¬ÙŠØ¬ Ø§Ù„Ø¥Ø¯Ø§Ø±ÙŠ Ø§Ù„Ù…Ø¹Ø±ÙˆÙ (ØªØ¹Ø¯ÙŠÙ„ Ø£Ø³Ù…Ø§Ø¡ØŒ ÙƒØ§Ù…ÙŠØ±Ø§ØŒ ØªÙ†Ø¸ÙŠÙØŒ ØªØ­Ø¯ÙŠØ« Ø¥Ø¯Ø§Ø±ÙŠ)Ø›
  // ÙˆÙƒÙ„ Ù…Ø§ Ø¹Ø¯Ø§Ù‡ ÙŠÙØ³Ù…Ø­ Ø¨Ù‡ Ø§ÙØªØ±Ø§Ø¶ÙŠØ§Ù‹ Ø­ØªÙ‰ Ù„Ø§ Ù†ÙØ³Ù‚Ø· Ø¥Ø´Ø¹Ø§Ø±Ø§Ù‹ Ù…Ù‡Ù…Ø§Ù‹ Ù„Ù„Ø·Ø§Ù„Ø¨ Ø¹Ù† Ø·Ø±ÙŠÙ‚ Ø§Ù„Ø®Ø·Ø£.
  const adminNoise =
    /rename|renamed|update|updated|edit|edited|camera|cleanup|reorder|dedup|duplicate|admin/.test(
      type,
    ) ||
    /ØªØ¹Ø¯ÙŠÙ„ Ø§Ø³Ù…|ØªØºÙŠÙŠØ± Ø§Ø³Ù…|ØªØ­Ø¯ÙŠØ« Ø§Ø³Ù…|Ø§Ø¹Ø§Ø¯Ù‡ ØªØ³Ù…ÙŠÙ‡|Ø§Ø³Ù… Ù…ÙƒØ±Ø±|Ù…ÙƒØ±Ø±|ØªØµØ­ÙŠØ­ Ø§Ø³Ù…|ØªÙ†Ø¸ÙŠÙ|ØªØ±ØªÙŠØ¨|ØªØ­Ø¯ÙŠØ« Ù…Ù‚Ø±Ø±|ØªØ­Ø¯ÙŠØ« Ø§Ø®ØªØ¨Ø§Ø±|ØªØ­Ø¯ÙŠØ« Ù…Ø´Ø±ÙˆØ¹|ØªØ­Ø¯ÙŠØ« Ø§Ø¯Ø§Ø±ÙŠ|ØªÙ… ØªØ­Ø¯ÙŠØ«|ØªÙ… ØªØ¹Ø¯ÙŠÙ„|Ø§Ø¶Ø§ÙÙ‡ ÙƒØ§Ù…ÙŠØ±Ø§|Ø­Ø°Ù ÙƒØ§Ù…ÙŠØ±Ø§|Ø§Ø²Ø§Ù„Ù‡ ÙƒØ§Ù…ÙŠØ±Ø§|ØªØ¹Ø¯ÙŠÙ„ ÙƒØ§Ù…ÙŠØ±Ø§|ØªØ­Ø¯ÙŠØ« Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§|Ø§Ø¹Ø¯Ø§Ø¯ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§/.test(
      text,
    ) ||
    (/ÙƒØ§Ù…ÙŠØ±Ø§|camera/.test(text) && !/ØºØ´|Ù†Ø²Ø§Ù‡Ù‡|Ù…Ø®Ø§Ù„ÙÙ‡|ØªØ­Ø°ÙŠØ±|ØªÙ†Ø¨ÙŠÙ‡ Ù…Ù‡Ù…/.test(text));
  return adminNoise;
}

function notificationTargets(filter: (token: NotificationToken) => boolean) {
  return dbInstance
    .getNotificationTokens()
    .filter(
      (token) =>
        !token.disabledAt && token.permission === "granted" && filter(token),
    );
}

function notificationEventId(
  title: string,
  body: string,
  data: Record<string, any> = {},
  scope = "",
) {
  const supplied = String(data.notificationId || data.eventId || "").trim();
  if (supplied) return supplied.slice(0, 120);
  // Ù†ÙØ³ Ø§Ù„Ø­Ø¯Ø« Ø§Ù„Ø°ÙŠ ÙŠÙ…Ø± Ù…Ù† Ù…Ø³Ø§Ø±ÙŠÙ† Ù…ØªÙ‚Ø§Ø±Ø¨ÙŠÙ† ÙŠØ£Ø®Ø° Ø§Ù„Ù…Ø¹Ø±Ù‘Ù Ù†ÙØ³Ù‡Ø› ÙˆØ¨Ø¹Ø¯ Ø¯Ù‚ÙŠÙ‚Ø© ÙŠÙ…ÙƒÙ†
  // Ù„Ø­Ø¯Ø« Ø­Ù‚ÙŠÙ‚ÙŠ Ø¬Ø¯ÙŠØ¯ Ø¨Ø§Ù„Ù†Øµ Ù†ÙØ³Ù‡ Ø£Ù† ÙŠØµÙ„ Ø¨ØµÙˆØ±Ø© Ø·Ø¨ÙŠØ¹ÙŠØ©.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const raw = [
    scope,
    data.type || "",
    data.activityId || data.examId || data.projectId || data.submissionId || "",
    data.courseCode || data.sectionCode || "",
    title,
    body,
    minuteBucket,
  ].join("|");
  return `miras-${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 28)}`;
}

// Ø­Ø§Ø±Ø³ Ø¯Ø§Ø¦Ù… Ù„Ù„Ø¥Ø±Ø³Ø§Ù„: Ù…Ù†Ø¹ Ø§Ù„ØªÙƒØ±Ø§Ø± ÙÙŠ Ø§Ù„Ø°Ø§ÙƒØ±Ø© ÙˆØ­Ø¯Ù‡ ÙŠØ¶ÙŠØ¹ Ø¹Ù†Ø¯ ØªØ¯ÙˆÙŠØ± Cloud RunØŒ
// ÙƒÙ…Ø§ Ø£Ù† Ù…Ø³Ø§Ø±ÙŠÙ† Ù…ØªØ²Ø§Ù…Ù†ÙŠÙ† ÙŠØ³ØªØ·ÙŠØ¹Ø§Ù† ÙƒÙ„ÙŠÙ‡Ù…Ø§ Ø¥Ø±Ø³Ø§Ù„ FCM Ù‚Ø¨Ù„ Ø£Ù† ÙŠÙ„Ø§Ø­Ø¸ Ø§Ù„Ø¢Ø®Ø± Ø§Ù„Ø³Ø¬Ù„.
// Ù†Ø³ØªØ®Ø¯Ù… claim Ø³Ø±ÙŠØ¹Ø§Ù‹ Ø¯Ø§Ø®Ù„ Ø§Ù„Ø¹Ù…Ù„ÙŠØ©ØŒ Ø«Ù… Ù†Ø³Ø¬Ù„ Ø§Ù„Ù†Ø¬Ø§Ø­ ÙÙŠ Firestore Ø¹Ø¨Ø± dbInstance
// Ø­ØªÙ‰ ÙŠØ¨Ù‚Ù‰ event + target Ù…Ø±Ù‘Ø© ÙˆØ§Ø­Ø¯Ø© Ø¨Ø¹Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ´ØºÙŠÙ„ Ø£ÙŠØ¶Ø§Ù‹.
const mirasNotificationDispatchClaims = new Set<string>();
const mirasNotificationAuditPending = new Map<
  string,
  { patch: Record<string, any>; increments: Record<string, number> }
>();
let mirasNotificationAuditFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushNotificationAuditPending() {
  if (mirasNotificationAuditFlushTimer) {
    clearTimeout(mirasNotificationAuditFlushTimer);
    mirasNotificationAuditFlushTimer = null;
  }
  const pending = Array.from(mirasNotificationAuditPending.entries());
  mirasNotificationAuditPending.clear();
  pending.forEach(([eventId, entry]) => {
    dbInstance.updateNotificationAudit(eventId, entry.patch, entry.increments);
  });
}

function queueNotificationAudit(
  eventIdValue: string,
  patch: Record<string, any> = {},
  increments: Record<string, number> = {},
) {
  const eventId = String(eventIdValue || "").trim();
  if (!eventId) return;
  const current = mirasNotificationAuditPending.get(eventId) || {
    patch: {},
    increments: {},
  };
  current.patch = { ...current.patch, ...patch };
  Object.entries(increments).forEach(([key, value]) => {
    current.increments[key] =
      Number(current.increments[key] || 0) + Number(value || 0);
  });
  mirasNotificationAuditPending.set(eventId, current);
  if (!mirasNotificationAuditFlushTimer) {
    mirasNotificationAuditFlushTimer = setTimeout(
      flushNotificationAuditPending,
      600,
    );
  }
}

function notificationDispatchKey(target: any, eventData: Record<string, string>) {
  const targetIdentity = String(
    target?.role === "student"
      ? target?.userId || ""
      : target?.deviceToken || target?.token || target?.userId || "",
  );
  const targetHash = crypto
    .createHash("sha256")
    .update(targetIdentity)
    .digest("hex")
    .slice(0, 20);
  return [
    String(target?.role || ""),
    String(target?.userId || ""),
    targetHash,
    String(eventData.notificationId || ""),
  ].join(":");
}
function claimNotificationDispatch(key: string) {
  if (!key || mirasNotificationDispatchClaims.has(key)) return false;
  if (dbInstance.getNotificationDispatches()[key]) return false;
  mirasNotificationDispatchClaims.add(key);
  return true;
}
function completeNotificationDispatch(key: string) {
  if (!key) return;
  mirasNotificationDispatchClaims.delete(key);
  dbInstance.rememberNotificationDispatch(key);
}
function releaseNotificationDispatch(key: string) {
  if (key) mirasNotificationDispatchClaims.delete(key);
}

function notifyUsers(
  filter: (token: NotificationToken) => boolean,
  title: string,
  body: string,
  data: Record<string, string> = {},
) {
  const safeTitle = sanitizePublicMessageText(title) || "Ù…ÙØ±Ø§Ø³";
  const safeBody = sanitizePublicMessageText(body) || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯.";
  const eventData: Record<string, string> = {
    ...data,
    notificationId: notificationEventId(safeTitle, safeBody, data),
    sentAt: String(data.sentAt || new Date().toISOString()),
  };
  const allTargets = notificationTargets(filter);
  // Ø¥Ø²Ø§Ù„Ø© ØªÙƒØ±Ø§Ø± Ø§Ù„Ø¯ÙØ¹ Ù„ÙƒÙ„ Ø¬Ù‡Ø§Ø²: Ù‚Ø¯ ÙŠØªØ±Ø§ÙƒÙ… Ù„Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„ÙˆØ§Ø­Ø¯ Ø¹Ø¯Ø© ØªÙˆÙƒÙ†Ø§Øª FCM (ØªØªØ¬Ø¯Ù‘Ø¯ Ø¯ÙˆÙ†
  // Ø­Ø°Ù Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø©)ØŒ ÙÙŠØµÙ„ Ù†ÙØ³ Ø§Ù„Ø¥Ø´Ø¹Ø§Ø± Ù£ Ù…Ø±Ø§Øª Ù„Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø² (Ø´ÙƒÙˆÙ‰ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…). Ù†ÙØ¨Ù‚ÙŠ Ø£Ø­Ø¯Ø«
  // ØªÙˆÙƒÙ† Ù„ÙƒÙ„ deviceToken (Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„ÙØ¹Ù„ÙŠ Ø§Ù„Ø«Ø§Ø¨Øª Ø¹Ø¨Ø± ØªØ¬Ø¯ÙŠØ¯ FCM) ÙÙ‚Ø·ØŒ Ù…Ø¹ Ø§Ù„Ø­ÙØ§Ø¸ Ø¹Ù„Ù‰
  // Ø§Ù„ØªÙˆØµÙŠÙ„ Ù„Ø£Ø¬Ù‡Ø²Ø© Ø­Ù‚ÙŠÙ‚ÙŠØ© Ù…Ø®ØªÙ„ÙØ© (Ø§Ù„ØªÙˆÙƒÙ†Ø§Øª Ø¨Ù„Ø§ deviceToken ØªØ¨Ù‚Ù‰ ÙƒÙ…Ø§ Ù‡ÙŠ).
  const targets = (() => {
    const byDevice = new Map<string, any>();
    const rest: any[] = [];
    for (const t of allTargets) {
      const dk = String((t as any).deviceToken || "").trim();
      if (!dk) {
        rest.push(t);
        continue;
      }
      const existing = byDevice.get(dk);
      if (
        !existing ||
        new Date((t as any).updatedAt || 0).getTime() >
          new Date((existing as any).updatedAt || 0).getTime()
      ) {
        byDevice.set(dk, t);
      }
    }
    const deduped = [...byDevice.values(), ...rest];
    // Ù‚Ù†Ø§Ø© Ø¯ÙØ¹ ÙˆØ§Ø­Ø¯Ø© Ù„ÙƒÙ„ Ù‡ÙˆÙŠØ©ØŒ Ù„ÙƒÙ„ Ø§Ù„Ø£Ø¯ÙˆØ§Ø±. Ø§Ø®ØªÙ„Ø§Ù Ø­Ø§Ù„Ø© Ø£Ø­Ø±Ù Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø£Ø³ØªØ§Ø°
    // (Ah... Ù…Ù‚Ø§Ø¨Ù„ ah...) ÙƒØ§Ù† ÙŠÙØ¹Ø§Ù…Ù„ Ø­Ø³Ø§Ø¨Ø§Ù‹ Ø«Ø§Ù†ÙŠØ§Ù‹ØŒ ÙˆSafari/PWA Ø¹Ù„Ù‰ Ø§Ù„Ù‡Ø§ØªÙ Ù†ÙØ³Ù‡
    // ÙƒØ§Ù†Ø§ ÙŠØ¹Ø±Ø¶Ø§Ù† Ø¨Ø§Ù†Ø±ÙŠÙ†. Ù†Ø®ØªØ§Ø± Ø£Ø­Ø¯Ø« ØªÙˆÙƒÙ†ØŒ ÙˆÙŠØ¨Ù‚Ù‰ Ø¬Ø±Ø³ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…ØªØ§Ø­Ø§Ù‹ Ø¨ÙƒÙ„ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø©.
    const byIdentity = new Map<string, any>();
    for (const t of deduped) {
      const role = String((t as any).role || "").toLowerCase();
      const uid =
        role === "student"
          ? normalizeStudentId((t as any).userId)
          : String((t as any).userId || (t as any).teacherEmail || "")
              .trim()
              .toLowerCase();
      const identityKey = `${role}:${uid || String((t as any).token || "")}`;
      const existingIdentity = byIdentity.get(identityKey);
      if (
        !existingIdentity ||
        new Date((t as any).updatedAt || 0).getTime() >
          new Date((existingIdentity as any).updatedAt || 0).getTime()
      ) {
        byIdentity.set(identityKey, t);
      }
    }
    return [...byIdentity.values()];
  })();
  const seen = new Set<string>();
  queueNotificationAudit(
    eventData.notificationId,
    {
      title: safeTitle,
      body: safeBody,
      type: String(eventData.type || "push"),
      activityId: String(
        eventData.activityId ||
          eventData.examId ||
          eventData.projectId ||
          eventData.submissionId ||
          "",
      ),
      courseCode: String(eventData.courseCode || eventData.sectionCode || ""),
      firstSeenAt: eventData.sentAt,
      lastSeenAt: eventData.sentAt,
    },
    { calls: 1, targets: targets.length },
  );
  targets.forEach((target) => {
    if (
      target.role === "student" &&
      shouldSuppressRoutineStudentNotification(safeTitle, safeBody, eventData)
    ) {
      queueNotificationAudit(eventData.notificationId, {}, { suppressed: 1 });
      return;
    }
    const dispatchKey = notificationDispatchKey(target, eventData);
    if (!claimNotificationDispatch(dispatchKey)) {
      queueNotificationAudit(
        eventData.notificationId,
        {},
        { duplicatesBlocked: 1 },
      );
      return;
    }
    queueNotificationAudit(eventData.notificationId, {}, { queued: 1 });
    try {
      sendFcmToToken(target.token, safeTitle, safeBody, eventData)
      .then((result) => {
        if (result.sent) {
          completeNotificationDispatch(dispatchKey);
          queueNotificationAudit(eventData.notificationId, {}, { sent: 1 });
        }
        else {
          releaseNotificationDispatch(dispatchKey);
          queueNotificationAudit(
            eventData.notificationId,
            { lastError: String(result.reason || "ØªØ¹Ø°Ø± Ø§Ù„Ø¥Ø±Ø³Ø§Ù„").slice(0, 180) },
            { failed: 1 },
          );
          console.warn("FCM send skipped/failed:", result.reason);
          const failClass = fcmFailureClass(String(result.reason || ""));
          if (failClass === "dead") {
            // Ù…ÙŠØª Ù…Ø¤ÙƒØ¯: Ø¹Ø·Ù‘Ù„ ÙÙˆØ±Ø§Ù‹.
            dbInstance.disableNotificationToken(target.token, target.userId);
          } else if (failClass === "invalid") {
            // INVALID_ARGUMENT: Ù†Ø¬Ù†Ù‘Ø¨ Ø§Ù„ØªÙˆÙƒÙ† Ø§Ù„Ø·Ø§Ø²Ø¬ (Ø§Ø´ØªØ±Ø§Ùƒ Ø¯ÙØ¹ ÙÙŠ Ø·ÙˆØ± Ø§Ù„Ø§Ù†ØªÙ‚Ø§Ù„
            // Ø¨Ø¹Ø¯ Ù†Ø´Ø± SW). Ù†Ø¹Ø·Ù‘Ù„ ÙÙ‚Ø· ØªÙˆÙƒÙ†Ø§Ù‹ Ù‚Ø¯ÙŠÙ…Ø§Ù‹ (>Ù¡Ù¥Ø¯) Ù„Ù… ÙŠØ¹ÙØ¯ ÙŠØ¹Ù…Ù„ ÙØ¹Ù„Ø§Ù‹.
            const ageMs =
              Date.now() - new Date(target.updatedAt || 0).getTime();
            if (Number.isFinite(ageMs) && ageMs > 15 * 60 * 1000) {
              dbInstance.disableNotificationToken(target.token, target.userId);
            }
          }
          // transient: Ù„Ø§ Ù†Ø¹Ø·Ù‘Ù„ â€” Ø§Ù„Ø´Ø¨ÙƒØ©/Ø§Ù„ÙƒÙˆØªØ§ ØªØªØ¹Ø§ÙÙ‰ ÙˆØ§Ù„ØªÙˆÙƒÙ† Ø³Ù„ÙŠÙ….
        }
      })
      .catch((err) => {
        releaseNotificationDispatch(dispatchKey);
        queueNotificationAudit(
          eventData.notificationId,
          { lastError: String(err?.message || err || "ØªØ¹Ø°Ø± Ø§Ù„Ø¥Ø±Ø³Ø§Ù„").slice(0, 180) },
          { failed: 1 },
        );
        console.warn("FCM send failed:", err?.message || err);
      });
    } catch (err: any) {
      releaseNotificationDispatch(dispatchKey);
      queueNotificationAudit(
        eventData.notificationId,
        { lastError: String(err?.message || err || "ØªØ¹Ø°Ø± Ø§Ù„Ø¥Ø±Ø³Ø§Ù„").slice(0, 180) },
        { failed: 1 },
      );
      console.warn("FCM dispatch failed:", err?.message || err);
    }
    const key = `${target.role}:${target.userId || ""}:${target.sectionCode || ""}:${eventData.courseCode || ""}`;
    const courseNotificationAlreadyCoversStudent =
      target.role === "student" &&
      Boolean(eventData.courseCode) &&
      !eventData.userId &&
      !eventData.studentId;
    if (!courseNotificationAlreadyCoversStudent && !seen.has(key)) {
      seen.add(key);
      const stored = rememberInAppNotification({
        userId: target.userId,
        role: target.role,
        sectionCode: target.sectionCode,
        title: safeTitle,
        body: safeBody,
        type: eventData.type || "push",
        data: eventData,
      });
      if (stored)
        queueNotificationAudit(eventData.notificationId, {}, { bellStored: 1 });
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
    titleLower.includes("ØªØ³Ù„ÙŠÙ…") ||
    titleLower.includes("Ø¯Ø®ÙˆÙ„ Ù†Ø§Ø¬Ø­") ||
    titleLower.includes("ØªØ³Ø¬ÙŠÙ„ Ø·Ø§Ù„Ø¨") ||
    titleLower.includes("ØªÙØ¹ÙŠÙ„ Ù…Ù‚Ø±Ø±") ||
    titleLower.includes("Ù…Ø´Ø±ÙˆØ¹ Ø¬Ø¯ÙŠØ¯")
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
    /Ø®Ø·Ø±|ØªØ­Ø°ÙŠØ±|Ù†Ø²Ø§Ù‡Ø©|Ù…Ø±ÙÙˆØ¶|ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ±|Ø§Ø³ØªØ±Ø¬Ø§Ø¹|Ø®Ø±ÙˆØ¬ Ø·Ø§Ù„Ø¨|Ø®Ø±Ø¬ Ù…Ù† Ø§Ø®ØªØ¨Ø§Ø±|Ø§Ù†Ø³Ø­Ø§Ø¨|ØºØ´/i.test(
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
  const safeTitle = sanitizePublicMessageText(title) || "Ù…ÙØ±Ø§Ø³";
  const safeBody = sanitizePublicMessageText(body) || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯.";
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
  // Ø¶Ù…Ø§Ù† Ø¬Ø°Ø±ÙŠ: Ø£ÙŠ ØªÙ†Ø¨ÙŠÙ‡ Ù…Ù‡Ù… Ù„Ù„Ø£Ø³ØªØ§Ø° (ØºØ´/Ù†Ø²Ø§Ù‡Ø©/Ù…Ø®Ø§Ù„ÙØ© Ø¬Ù‡Ø§Ø²/ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ±...) ÙŠØ¬Ø¨ Ø£Ù†
  // ØªØ¨Ù‚Ù‰ Ù„Ù‡ Ù†Ø³Ø®Ø© Ø¯Ø§Ø®Ù„ÙŠØ© ÙÙŠ ØµÙ†Ø¯ÙˆÙ‚ Ø§Ù„Ø³ÙŠØ±ÙØ± â€” Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø© â€” Ø­ØªÙ‰ Ù„Ùˆ Ù„Ù… ÙŠÙƒÙ† Ù„Ø¯Ù‰ Ø§Ù„Ø£Ø³ØªØ§Ø°
  // Ø£ÙŠ ØªÙˆÙƒÙ† FCM Ù…ÙØ¹Ù‘Ù„ (Ù…Ø«Ù„Ø§Ù‹ Ù„Ù… ÙŠÙ…Ù†Ø­ Ø¥Ø°Ù† Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø¹Ù„Ù‰ Ø§Ù„Ù…ØªØµÙØ­). Ø³Ø§Ø¨Ù‚Ø§Ù‹ ÙƒØ§Ù†Øª Ø§Ù„Ù†Ø³Ø®Ø©
  // Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠØ© ØªÙØ­ÙØ¸ ÙÙ‚Ø· Ø¯Ø§Ø®Ù„ Ø­Ù„Ù‚Ø© ØªÙˆÙƒÙ†Ø§Øª FCMØŒ ÙØ¥Ø°Ø§ Ù„Ù… ÙŠÙˆØ¬Ø¯ ØªÙˆÙƒÙ† Ù„Ù… ÙŠÙØ­ÙØ¸ Ø´ÙŠØ¡ ÙˆØ§Ø®ØªÙÙ‰
  // Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡ Ù…Ù† Ø§Ù„Ø¬Ø±Ø³. Ù‡Ù†Ø§ Ù†Ø­ÙØ¸ Ù†Ø³Ø®Ø© ÙˆØ§Ø­Ø¯Ø© Ù…ÙˆØ¬ÙÙ‘Ù‡Ø© Ù„ØµØ§Ø­Ø¨ Ø§Ù„Ø´Ø¹Ø¨Ø© Ø¨Ù†ÙØ³ Ø¢Ù„ÙŠØ© Ù…Ù†Ø¹ Ø§Ù„ØªÙƒØ±Ø§Ø±
  // (Ù†ÙØ³ Ø§Ù„ØªÙˆÙ‚ÙŠØ¹ Ø®Ù„Ø§Ù„ 15 Ø«Ø§Ù†ÙŠØ©) ÙÙ„Ø§ ÙŠØ­Ø¯Ø« Ø§Ø²Ø¯ÙˆØ§Ø¬ Ù…Ø¹ Ø§Ù„Ù†Ø³Ø® Ø§Ù„Ù…Ø­ÙÙˆØ¸Ø© Ù„ÙƒÙ„ ØªÙˆÙƒÙ†.
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

// Ø­Ø§Ø±Ø³ ØªÙƒØ±Ø§Ø± Ø§Ù„Ø¯ÙØ¹Ø§Øª: ÙƒØ§Ø¨ØªØ´Ø± Ø§Ù„Ù…Ø§Ù„Ùƒ (Ù£ Ø¨Ø§Ù†Ø±Ø§Øª "Ø¥Ø¹Ø§Ø¯Ø© Ø§Ø®ØªØ¨Ø§Ø±" Ø¨Ù†ÙØ³ Ø§Ù„Ø¯Ù‚ÙŠÙ‚Ø© Ù…Ù‚Ø§Ø¨Ù„
// ÙˆØ§Ø­Ø¯Ø© Ù„Ù„Ù…Ø´Ø±ÙˆØ¹) ÙƒØ´Ù Ø£Ù† Ù…Ø³Ø§Ø± Ø§Ù„Ø¥Ø±Ø¬Ø§Ø¹ Ù‚Ø¯ ÙŠØ³ØªØ¯Ø¹ÙŠ notifyStudent Ø¹Ø¯Ø© Ù…Ø±Ø§Øª (ØµÙÙˆÙ
// Ù‚Ø¯ÙŠÙ…Ø© Ù…ØªØ¹Ø¯Ø¯Ø© Ù„Ù†ÙØ³ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±). Ø­Ø§Ø±Ø³ Ø§Ù„Ø³Ø¬Ù„ ÙƒØ§Ù† ÙŠÙ…Ù†Ø¹ ØªÙƒØ±Ø§Ø± Ø§Ù„Ø¬Ø±Ø³ ÙÙ‚Ø· â€” Ù‡Ø°Ø§ ÙŠÙ…Ù†Ø¹
// ØªÙƒØ±Ø§Ø± Ø¯ÙØ¹Ø© Ø§Ù„Ø¬ÙˆØ§Ù„ Ù†ÙØ³Ù‡Ø§: Ù†ÙØ³ (Ø·Ø§Ù„Ø¨+Ø¹Ù†ÙˆØ§Ù†+Ù†Øµ+Ù†ÙˆØ¹+Ù†Ø´Ø§Ø·) Ø®Ù„Ø§Ù„ Ù¡Ù¢Ø« = Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø©.
const mirasRecentStudentPush = new Map<string, number>();
function notifyStudent(
  studentId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
) {
  const safeTitle = sanitizePublicMessageText(title) || "Ù…ÙØ±Ø§Ø³";
  const safeBody = sanitizePublicMessageText(body) || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯.";
  const eventData: Record<string, string> = {
    ...data,
    userId: String(studentId),
    studentId: String(studentId),
    targetRole: "student",
    notificationId: notificationEventId(
      safeTitle,
      safeBody,
      data,
      `student:${String(studentId).toLowerCase()}`,
    ),
  };
  try {
    const pushKey = [
      String(studentId).toLowerCase(),
      safeTitle,
      safeBody,
      String(eventData.type || ""),
      String(eventData.activityId || eventData.examId || ""),
    ].join("|");
    const nowMs = Date.now();
    for (const [k, at] of mirasRecentStudentPush) {
      if (nowMs - at > 12_000) mirasRecentStudentPush.delete(k);
    }
    const prev = mirasRecentStudentPush.get(pushKey);
    if (prev && nowMs - prev < 12_000) return 0;
    mirasRecentStudentPush.set(pushKey, nowMs);
  } catch {}
  if (shouldSuppressRoutineStudentNotification(safeTitle, safeBody, eventData)) return 0;
  const count = notifyUsers(
    (token) =>
      token.role === "student" && String(token.userId) === String(studentId),
    safeTitle,
    safeBody,
    eventData,
  );
  // Ø¬Ø°Ø± "Ø§Ù„Ø¥Ø´Ø¹Ø§Ø± ÙŠØ¸Ù‡Ø± Ù…Ø±ØªÙŠÙ†" (Ø¥Ø¹Ø§Ø¯Ø© Ø§Ø®ØªØ¨Ø§Ø±/Ù…Ø´Ø±ÙˆØ¹â€¦): notifyUsers ØªÙƒØªØ¨ Ù†Ø³Ø®Ø© ØµÙ†Ø¯ÙˆÙ‚
  // Ù„ÙƒÙ„ Ø·Ø§Ù„Ø¨ Ù…Ø³ØªÙ‡Ø¯Ù (Ø­ÙŠÙ† ØªØ­Ù…Ù„ data Ù…Ø¹Ø±Ù‘ÙÙ‡)ØŒ ÙˆÙƒØ§Ù† Ø§Ù„Ø´Ø±Ø· Ù‡Ù†Ø§ `|| courseCode` ÙŠÙƒØªØ¨
  // Ù†Ø³Ø®Ø© Ø«Ø§Ù†ÙŠØ© Ø¯Ø§Ø¦Ù…Ø§Ù‹ Ù„Ø£Ù† courseCode Ù…ÙˆØ¬ÙˆØ¯ ØºØ§Ù„Ø¨Ø§Ù‹ â†’ Ø³Ø¬Ù„Ø§Ù† Ø¨Ù†ÙØ³ Ø§Ù„Ù…ÙŠÙ„ÙŠ-Ø«Ø§Ù†ÙŠØ©
  // (Ù¦Ù + Ø²ÙˆØ¬Ø§Ù‹ Ù…ÙƒØ±Ø±Ø§Ù‹ ÙÙŠ Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø©). Ø§Ù„Ø¢Ù† Ù†ÙƒØªØ¨ Ø§Ù„Ø§Ø­ØªÙŠØ§Ø· ÙÙ‚Ø· Ø­ÙŠÙ† Ù„Ù… ØªÙƒØªØ¨ notifyUsers
  // ÙØ¹Ù„Ø§Ù‹: Ù„Ø§ Ø£Ø¬Ù‡Ø²Ø© Ù…Ø³Ø¬Ù„Ø©ØŒ Ø£Ùˆ ØªØ®Ø·Ù‘Øª Ø§Ù„ÙƒØªØ§Ø¨Ø© (Ø¥Ø´Ø¹Ø§Ø± Ù…Ù‚Ø±Ø± Ø¹Ø§Ù… Ø¨Ù„Ø§ Ù…Ø¹Ø±Ù‘Ù Ø·Ø§Ù„Ø¨).
  const notifyUsersSkippedInApp =
    Boolean(eventData.courseCode) && !eventData.userId && !eventData.studentId;
  if (count === 0 || notifyUsersSkippedInApp) {
    const stored = rememberInAppNotification({
      userId: String(studentId),
      role: "student",
      title: safeTitle,
      body: safeBody,
      type: eventData.type || "student",
      data: eventData,
    });
    if (stored)
      queueNotificationAudit(eventData.notificationId, {}, { bellStored: 1 });
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
  // Ù„Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù†Ø¹ØªÙ…Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø§Ù„ØªØ­Ø§Ù‚ Ø§Ù„Ù…ÙƒØªØ´Ù (ÙŠØ´Ù…Ù„ Ù…Ù‚Ø±Ø±Ø§Øª Ø§Ù„Ù…Ø¹Ø§Ø¯ Ø§Ù„Ù…ØºÙ„Ù‚Ø©) ÙˆÙ„ÙŠØ³ Ø§Ù„Ù…Ù‚Ø±Ø±Ø§Øª Ø§Ù„Ù†Ø´Ø·Ø© ÙÙ‚Ø·.
  return (
    !!student &&
    getStudentDiscoveredCourseCodes(student).some(
      (c: any) => String(c).toLowerCase() === code,
    )
  );
}
// Ø¹Ø¶ÙˆÙŠØ© Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª: Ù‡Ù„ ÙŠØ¬Ø¨ Ø£Ù† ÙŠØµÙ„ Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ ØªÙ†Ø¨ÙŠÙ‡Ø§Øª Ù‡Ø°Ø§ Ø§Ù„Ù…Ù‚Ø±Ø±ØŸ ØªØ®ØªÙ„Ù Ø¹Ù† ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ø¯Ø®ÙˆÙ„
// (studentHasEnrollmentInCourse) Ø¹Ù…Ø¯Ø§Ù‹ â€” Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù…Ø¹Ø§Ø¯ ÙÙŠ Ù…Ù‚Ø±Ø± Ù…ØºÙ„Ù‚ ÙŠØ¬Ø¨ Ø£Ù† ØªØµÙ„Ù‡ Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡Ø§Øª
// Ø±ØºÙ… Ø£Ù† Ø¯Ø®ÙˆÙ„Ù‡ Ù„Ù„Ù…Ù‚Ø±Ø± Ù‚Ø¯ ÙŠÙƒÙˆÙ† Ù…Ù‚ÙÙ„Ø§Ù‹.
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

// ØªÙ†Ø¨ÙŠÙ‡Ø§Øª Ø§Ù„Ø¬Ø±Ø³ Ù…Ø­ÙÙˆØ¸Ø© Ø§Ù„Ø¢Ù† ÙÙŠ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª (dbInstance) Ø¨Ø¯Ù„ Ù…ØµÙÙˆÙØ© ÙÙŠ Ø§Ù„Ø°Ø§ÙƒØ±Ø©ØŒ Ø­ØªÙ‰ Ù„Ø§
// ØªØ¶ÙŠØ¹ Ø¹Ù†Ø¯ Ø¥Ø¹Ø§Ø¯Ø© ØªØ´ØºÙŠÙ„ Ø§Ù„Ø®Ø§Ø¯Ù… Ø£Ùˆ Ø§Ù„Ù†Ø´Ø± â€” ÙˆÙ‡Ùˆ Ø³Ø¨Ø¨ Ù…Ø­ØªÙ…Ù„ Ù„Ø§Ø®ØªÙØ§Ø¡ ØªÙ†Ø¨ÙŠÙ‡Ø§Øª Ø£ÙØ±Ø³Ù„Øª Ø«Ù… Ù„Ù… ØªØµÙ„.
// Ø­Ø§Ø±Ø³ ØªÙƒØ±Ø§Ø± Ø¹Ø§Ù…: Ø£ÙŠ Ù…Ø³Ø§Ø±ÙŠÙ† ÙŠÙƒØªØ¨Ø§Ù† Ù†ÙØ³ Ø§Ù„Ø¥Ø´Ø¹Ø§Ø± Ù„Ù†ÙØ³ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø®Ù„Ø§Ù„ Ù¡Ù¥ Ø«Ø§Ù†ÙŠØ©
// (ÙƒÙ…Ø§ Ø­Ø¯Ø« Ù…Ø¹ "Ø¥Ø¹Ø§Ø¯Ø© Ø§Ø®ØªØ¨Ø§Ø±" â€” Ø³Ø¬Ù„Ø§Ù† Ø¨Ù†ÙØ³ Ø§Ù„Ù…ÙŠÙ„ÙŠ-Ø«Ø§Ù†ÙŠØ©) ÙŠÙ…Ø±Ù‘ Ù…Ù†Ù‡Ù…Ø§ ÙˆØ§Ø­Ø¯ ÙÙ‚Ø·.
const mirasRecentInAppKeys = new Map<string, number>();
function rememberInAppNotification(item: any) {
  const compact = (value: any) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  try {
    const dupKey = [
      String(item.userId || "").toLowerCase(),
      String(item.role || "").toLowerCase(),
      compact(item.title),
      compact(item.body),
      String(item.type || item.data?.type || ""),
      String(item.data?.activityId || item.data?.examId || ""),
    ].join("|");
    const nowMs = Date.now();
    for (const [k, at] of mirasRecentInAppKeys) {
      if (nowMs - at > 15_000) mirasRecentInAppKeys.delete(k);
    }
    const prev = mirasRecentInAppKeys.get(dupKey);
    if (prev && nowMs - prev < 15_000) return;
    mirasRecentInAppKeys.set(dupKey, nowMs);
  } catch {}
  const saved = {
    id:
      item.id || `note-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    userId: item.userId ? String(item.userId) : "",
    role: item.role ? String(item.role) : "",
    sectionCode: item.sectionCode ? String(item.sectionCode) : "",
    title: sanitizePublicMessageText(item.title || "Ù…ÙØ±Ø§Ø³") || "Ù…ÙØ±Ø§Ø³",
    body:
      sanitizePublicMessageText(item.body || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯.") ||
      "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯.",
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
      compact(old.title || "Ù…ÙØ±Ø§Ø³"),
      compact(old.body || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯."),
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

const STUDENT_SAFE_JOIN_CODE_ERROR = "Ø§Ù„ÙƒÙˆØ¯ ØºÙŠØ± ØµØ§Ù„Ø­ Ø£Ùˆ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ø³ØªØ®Ø¯Ø§Ù…Ù‡.";
const STRICT_LIBRARY_MODE_DEFAULT = true;
const CODE_REPUTATION_LABELS: Record<string, string> = {
  normal: "Ø·Ø¨ÙŠØ¹ÙŠ",
  watch: "Ù…Ø±Ø§Ù‚Ø¨Ø©",
  suspicious: "Ù…Ø´ØªØ¨Ù‡",
  danger: "Ø®Ø·Ø±",
  temporarily_blocked: "Ù…Ø­Ø¸ÙˆØ± Ù…Ø¤Ù‚ØªÙ‹Ø§",
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
  if (reason.includes("Ù…Ø³ØªØ®Ø¯Ù…") || reason.includes("Ù…Ù‚ÙÙ„")) score += 22;
  if (reason.includes("Ø¬Ù‡Ø§Ø²") || reason.includes("ØªÙˆÙƒÙ†")) score += 18;
  if (reason.includes("Ù…Ø®ØµØµ") || reason.includes("Ù„Ø§ ÙŠØªØ¨Ø¹")) score += 14;
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
    label: CODE_REPUTATION_LABELS[level] || "Ø·Ø¨ÙŠØ¹ÙŠ",
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
      codeJourneyEvent("Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø±ÙÙˆØ¶Ø©", req, {
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
      reason: "Ø§Ù„ÙƒÙˆØ¯ Ø®Ø§Ø±Ø¬ Ù†Ø§ÙØ°Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„: Ù„Ù… ØªØ¨Ø¯Ø£ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ© Ø¨Ø¹Ø¯",
    };
  if (endsAt && Number.isFinite(endsAt) && now > endsAt)
    return { ok: false, reason: "Ø§Ù„ÙƒÙˆØ¯ Ø®Ø§Ø±Ø¬ Ù†Ø§ÙØ°Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„: Ø§Ù†ØªÙ‡Øª Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©" };
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
    return [semester || "Ø¯ÙØ¹Ø© ØºÙŠØ± Ù…Ø¤Ø±Ø®Ø©", section || "ÙƒÙ„ Ø§Ù„Ø´Ø¹Ø¨"].join(" / ");
  return "Ø¯ÙØ¹Ø© ØºÙŠØ± Ù…Ø­Ø¯Ø¯Ø©";
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
    (a: any) => a.honeyCode || String(a.reason || "").includes("Ù…ØµÙŠØ¯Ø©"),
  );
  const usedByOther = attempts.some(
    (a: any) =>
      String(a.reason || "").includes("Ù…Ø³ØªØ®Ø¯Ù…") ||
      String(a.reason || "").includes("Ù…Ø±ØªØ¨Ø·"),
  );
  let level = "Ø®Ø·Ø£ Ø¨Ø³ÙŠØ·";
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
  let label = "Ø®Ø·Ø£ Ø·Ø§Ù„Ø¨ Ø·Ø¨ÙŠØ¹ÙŠ";
  if (automated || honey || total >= 10) {
    level = "Ù†Ù…Ø· Ø¢Ù„ÙŠ";
    label = "Ù…Ø­Ø§ÙˆÙ„Ø© ØªØ´Ø¨Ù‡ Ø§Ù„ØªØ®Ù…ÙŠÙ† Ø£Ùˆ Ø§Ù„Ø³ÙƒØ±Ø¨Øª";
  } else if (usedByOther || students.size >= 2) {
    level = "ØªØ¯Ø§ÙˆÙ„ Ù…Ø­ØªÙ…Ù„";
    label = "ÙƒÙˆØ¯ ÙŠØ¨Ø¯Ùˆ Ø£Ù†Ù‡ Ø§Ù†ØªÙ‚Ù„ Ø¨ÙŠÙ† Ø£ÙƒØ«Ø± Ù…Ù† Ø·Ø§Ù„Ø¨";
  } else if (pastedFast >= 2 || devices.size >= 3) {
    level = "Ù†Ø³Ø®/Ù„ØµÙ‚ Ù…Ø´Ø¨ÙˆÙ‡";
    label = "Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø±ÙŠØ¹ Ø£Ùˆ Ø£Ø¬Ù‡Ø²Ø© Ù…ØªØ¹Ø¯Ø¯Ø© ÙŠØ­ØªØ§Ø¬ Ù…ØªØ§Ø¨Ø¹Ø©";
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
    reasons.push("Ù„Ø§ ÙŠÙˆØ¬Ø¯ ØªÙˆÙƒÙ† Ø¬Ù‡Ø§Ø²");
  }
  if (
    codeRecord?.activationDeviceToken &&
    token &&
    codeRecord.activationDeviceToken === token
  ) {
    score += 12;
    reasons.push("ØªÙˆÙƒÙ† Ø§Ù„Ø¬Ù‡Ø§Ø² Ù…Ø·Ø§Ø¨Ù‚");
  }
  if (
    codeRecord?.activationDeviceToken &&
    token &&
    codeRecord.activationDeviceToken !== token
  ) {
    score -= 32;
    reasons.push("ØªÙˆÙƒÙ† Ø¬Ù‡Ø§Ø² Ù…Ø®ØªÙ„Ù");
  }
  if (
    codeRecord?.activationDeviceFingerprint &&
    fingerprint &&
    codeRecord.activationDeviceFingerprint === fingerprint
  ) {
    score += 8;
    reasons.push("Ø¨ØµÙ…Ø© Ø§Ù„Ø¬Ù‡Ø§Ø² Ù…Ø·Ø§Ø¨Ù‚Ø©");
  }
  if (
    codeRecord?.activationDeviceFingerprint &&
    fingerprint &&
    codeRecord.activationDeviceFingerprint !== fingerprint
  ) {
    score -= 16;
    reasons.push("Ø¨ØµÙ…Ø© Ø¬Ù‡Ø§Ø² Ù…Ø®ØªÙ„ÙØ©");
  }
  if (telemetry?.looksAutomated) {
    score -= 20;
    reasons.push("Ù†Ù…Ø· Ø¥Ø¯Ø®Ø§Ù„ Ø¢Ù„ÙŠ");
  }
  if (telemetry?.pasted && Number(telemetry?.durationMs || 0) < 1500) {
    score -= 8;
    reasons.push("Ù„ØµÙ‚ Ø³Ø±ÙŠØ¹ Ù„Ù„ÙƒÙˆØ¯");
  }
  score = Math.max(0, Math.min(100, score));
  const level =
    score >= 80
      ? "Ø«Ù‚Ø© Ø¹Ø§Ù„ÙŠØ©"
      : score >= 55
        ? "Ø«Ù‚Ø© Ù…ØªÙˆØ³Ø·Ø©"
        : score >= 35
          ? "Ø«Ù‚Ø© Ù…Ù†Ø®ÙØ¶Ø©"
          : "Ø®Ø·Ø±";
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
          name: a.studentName || "ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ",
          sectionCode:
            a.sectionCode || code?.studentSection || code?.sectionCode || "",
        },
      ]),
    ).values(),
  ).filter((x: any) => x.id || x.name !== "ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ");
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
      code?.codeReputationLabel || last?.codeReputationLabel || "Ù…Ø±Ø§Ù‚Ø¨Ø©",
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
        score >= 75 ? "Ø¹Ø§Ù„ÙŠØ© Ø§Ù„Ø®Ø·ÙˆØ±Ø©" : score >= 45 ? "ØªØ­ØªØ§Ø¬ Ù…Ø±Ø§Ù‚Ø¨Ø©" : "Ø¢Ù…Ù†Ø©";
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
        reason.includes("Ù…Ø³ØªØ®Ø¯Ù…") ||
        reason.includes("Ù…Ø±ØªØ¨Ø·") ||
        reason.includes("Ø¬Ù‡Ø§Ø²") ||
        reason.includes("ØªÙˆÙƒÙ†")
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
        "ØºÙŠØ± Ù…Ø­Ø¯Ø¯Ø©",
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
    return { label: "Ø®Ø·Ø±", tone: "rose", score };
  if (normalized === "suspicious" || score >= 70)
    return { label: "Ù…ØªØ¯Ø§ÙˆÙ„ Ù…Ø­ØªÙ…Ù„", tone: "orange", score };
  if (normalized === "watch" || score >= 40)
    return { label: "ÙŠØ­ØªØ§Ø¬ Ù…ØªØ§Ø¨Ø¹Ø©", tone: "amber", score };
  if (score >= 20) return { label: "Ø·Ø¨ÙŠØ¹ÙŠ", tone: "emerald", score };
  return { label: "Ù…ÙˆØ«ÙˆÙ‚", tone: "emerald", score };
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
      action: "Ø¬Ù…Ù‘Ø¯ Ø§Ù„ÙƒÙˆØ¯ Ù„Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©",
      priority: "Ø¹Ø§Ù„ÙŠØ©",
      rationale:
        "Ø¯Ø±Ø¬Ø© Ø§Ù„Ø§Ø´ØªØ¨Ø§Ù‡ Ù…Ø±ØªÙØ¹Ø© ÙˆØªØ­ØªØ§Ø¬ Ù‚Ø±Ø§Ø±Ù‹Ø§ Ø¥Ø¯Ø§Ø±ÙŠÙ‹Ø§ Ù‚Ø¨Ù„ Ø§Ø³ØªÙ…Ø±Ø§Ø± Ø§Ù„ØªÙØ¹ÙŠÙ„.",
    };
  if (text.includes("Ø¯ÙØ¹Ø©") || input.batchLevel === "Ø¹Ø§Ù„ÙŠØ© Ø§Ù„Ø®Ø·ÙˆØ±Ø©")
    return {
      action: "Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø¯ÙØ¹Ø©",
      priority: "Ø¹Ø§Ù„ÙŠØ©",
      rationale: "Ø§Ù„Ù†Ù…Ø· Ù…Ø±ØªØ¨Ø· Ø¨Ù…ØµØ¯Ø± Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ ÙˆÙ„ÙŠØ³ Ø¨ÙƒÙˆØ¯ ÙˆØ§Ø­Ø¯ ÙÙ‚Ø·.",
    };
  if (
    text.includes("ØªØ¯Ø§ÙˆÙ„") ||
    text.includes("Ù…Ø³ØªØ®Ø¯Ù…") ||
    text.includes("Ù…Ø±ØªØ¨Ø·") ||
    score >= 78
  )
    return {
      action: "Ø§Ø·Ù„Ø¨ Ù…Ø±Ø§Ø¬Ø¹Ø© Ø§Ù„Ø·Ø§Ù„Ø¨",
      priority: "Ù…ØªÙˆØ³Ø·Ø©",
      rationale: "ØªÙˆØ¬Ø¯ Ù…Ø¤Ø´Ø±Ø§Øª Ø§Ù†ØªÙ‚Ø§Ù„ ÙƒÙˆØ¯ Ø£Ùˆ Ø§Ø³ØªØ®Ø¯Ø§Ù…Ù‡ Ù…Ù† Ø£ÙƒØ«Ø± Ù…Ù† Ø¬Ù‡Ø©.",
    };
  if (text.includes("Ø¬Ù‡Ø§Ø²") || text.includes("ØªÙˆÙƒÙ†"))
    return {
      action: "Ø£Ø¹Ø¯ ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø¹Ù†Ø¯ Ø§Ù„Ø­Ø§Ø¬Ø©",
      priority: "Ù…ØªÙˆØ³Ø·Ø©",
      rationale: "Ø§Ù„Ù…Ø´ÙƒÙ„Ø© Ù…Ø±ØªØ¨Ø·Ø© Ø¨Ø§Ù„Ø¬Ù‡Ø§Ø²ØŒ ÙˆÙ„Ø§ ÙŠÙ„Ø²Ù… Ø¥ÙŠÙ‚Ø§Ù Ø§Ù„ÙƒÙˆØ¯ Ù…Ø¨Ø§Ø´Ø±Ø©.",
    };
  if (
    text.includes("Ù…ØµÙŠØ¯Ø©") ||
    text.includes("ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯") ||
    text.includes("ØµÙŠØºØ©") ||
    score >= 45
  )
    return {
      action: "Ø±Ø§Ù‚Ø¨ ÙÙ‚Ø·",
      priority: "Ù…Ù†Ø®ÙØ¶Ø©",
      rationale: "Ø§Ù„Ø³Ù„ÙˆÙƒ ÙŠØ³ØªØ­Ù‚ Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø© Ø¯ÙˆÙ† Ø¥Ø¬Ø±Ø§Ø¡ Ù…Ø¨Ø§Ø´Ø± Ø¹Ù„Ù‰ Ø§Ù„Ø·Ø§Ù„Ø¨.",
    };
  return {
    action: "Ù„Ø§ ØªÙØ¹Ù„ Ø´ÙŠØ¦Ù‹Ø§",
    priority: "Ù‡Ø§Ø¯Ø¦Ø©",
    rationale: "Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ø¤Ø´Ø±Ø§Øª ÙƒØ§ÙÙŠØ© Ù„Ø§ØªØ®Ø§Ø° Ø¥Ø¬Ø±Ø§Ø¡.",
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
          "ÙØµÙ„ ØºÙŠØ± Ù…Ø­Ø¯Ø¯",
      ).trim() || "ÙØµÙ„ ØºÙŠØ± Ù…Ø­Ø¯Ø¯";
    const date = new Date(attempt.timestamp || Date.now());
    const weekKey = Number.isFinite(date.getTime())
      ? `${date.getUTCFullYear()}-W${Math.ceil(((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000 + new Date(Date.UTC(date.getUTCFullYear(), 0, 1)).getUTCDay() + 1) / 7)}`
      : "ØºÙŠØ± Ù…Ø­Ø¯Ø¯";
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
    if (attempt.honeyCode || String(attempt.reason || "").includes("Ù…ØµÙŠØ¯Ø©"))
      item.honey += 1;
    if (
      String(attempt.reason || "").includes("Ù…Ø³ØªØ®Ø¯Ù…") ||
      String(attempt.reason || "").includes("Ù…Ø±ØªØ¨Ø·")
    )
      item.trading += 1;
    if (
      String(attempt.reason || "").includes("Ø¬Ù‡Ø§Ø²") ||
      String(attempt.reason || "").includes("ØªÙˆÙƒÙ†")
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
    wk.trading += String(attempt.reason || "").includes("Ù…Ø³ØªØ®Ø¯Ù…") ? 1 : 0;
    wk.honey += attempt.honeyCode ? 1 : 0;
    item.weeks.set(weekKey, wk);
    const section = String(
      attempt.sectionCode ||
        code?.studentSection ||
        code?.sectionCode ||
        "ØºÙŠØ± Ù…Ø­Ø¯Ø¯Ø©",
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
          ? "Ø§Ø±ØªÙØ§Ø¹ Ù…ØªÙˆÙ‚Ø¹ ÙŠØ­ØªØ§Ø¬ Ù…ØªØ§Ø¨Ø¹Ø©"
          : score >= 45
            ? "Ù†Ø´Ø§Ø· Ù‚Ø§Ø¨Ù„ Ù„Ù„Ø²ÙŠØ§Ø¯Ø©"
            : "Ù†Ø´Ø§Ø· Ø·Ø¨ÙŠØ¹ÙŠ";
      const nextRecommendation =
        score >= 75
          ? "Ø±Ø§Ù‚Ø¨ Ø£ÙˆÙ„ Ø£Ø³Ø¨ÙˆØ¹ ÙˆØ£ÙŠØ§Ù… Ù…Ø§ Ù‚Ø¨Ù„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±ØŒ ÙˆØ±Ø§Ø¬Ø¹ Ø§Ù„Ø¯ÙØ¹Ø§Øª Ø°Ø§Øª Ø§Ù„Ù†Ø´Ø§Ø· Ø§Ù„Ø£Ø¹Ù„Ù‰."
          : score >= 45
            ? "Ø§ÙƒØªÙÙ Ø¨Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© Ø§Ù„Ù‡Ø§Ø¯Ø¦Ø© Ù…Ø¹ ÙØ­Øµ Ø§Ù„Ø´Ø¹Ø¨ Ø§Ù„Ø£Ø¹Ù„Ù‰ Ù†Ø´Ø§Ø·Ù‹Ø§."
            : "Ù„Ø§ ÙŠÙ„Ø²Ù… Ø¥Ø¬Ø±Ø§Ø¡ Ø®Ø§Øµ.";
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
      reasons.push("Ø§Ù„Ø´Ø¹Ø¨Ø© Ù„Ø§ ØªØ·Ø§Ø¨Ù‚ Ø´Ø¹Ø¨Ø© Ø§Ù„ÙƒÙˆØ¯");
    const window = joinCodeWindowStatus(code);
    if (!window.ok) reasons.push("Ù…Ø­Ø§ÙˆÙ„Ø© Ø®Ø§Ø±Ø¬ Ù†Ø§ÙØ°Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„");
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
          (String(attempt.reason || "").includes("Ù…Ø³ØªØ®Ø¯Ù…") ? 20 : 0),
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
      source: "Ø¯ÙØ¹Ø© Ø£ÙƒÙˆØ§Ø¯ ØªØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø©",
      confidence: Math.min(99, b.score),
      evidence: `Ø¯ÙØ¹Ø© ${b.batchId}: Ù†Ø´Ø§Ø· ØºÙŠØ± Ø·Ø¨ÙŠØ¹ÙŠ ${b.abnormalRate}%ØŒ Ø£Ø¬Ù‡Ø²Ø© ${b.distinctDevices}ØŒ ÙˆÙ…Ø­Ø§ÙˆÙ„Ø§Øª ${b.attempts}.`,
      recommendation: "Ø±Ø§Ø¬Ø¹ Ù…ØµØ¯Ø± ØªÙˆØ²ÙŠØ¹ Ø§Ù„Ø¯ÙØ¹Ø© ÙˆØ·Ø±ÙŠÙ‚Ø© ØªØ³Ù„ÙŠÙ…Ù‡Ø§.",
    });
  for (const c of collectiveTransferAlerts.slice(0, 6))
    signals.push({
      source: "ØªØ¯Ø§ÙˆÙ„ Ø¯Ø§Ø®Ù„ Ø´Ø¹Ø¨Ø©",
      confidence: Math.min(99, c.score),
      evidence: `Ø§Ù„Ø´Ø¹Ø¨Ø© ${c.sectionCode}: ${c.distinctCodes} Ø£ÙƒÙˆØ§Ø¯ Ùˆ${c.distinctStudents} Ø·Ù„Ø¨Ø© Ø¶Ù…Ù† Ù†Ù…Ø· ÙˆØ§Ø­Ø¯.`,
      recommendation: "Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø´Ø¹Ø¨Ø© Ø¨Ù‡Ø¯ÙˆØ¡ Ø¯ÙˆÙ† Ø§ØªÙ‡Ø§Ù… Ù…Ø¨Ø§Ø´Ø±.",
    });
  const honeyCount = attempts.filter(
    (a: any) => a.honeyCode || String(a.reason || "").includes("Ù…ØµÙŠØ¯Ø©"),
  ).length;
  const automatedCount = attempts.filter(
    (a: any) => a.activationTelemetry?.looksAutomated,
  ).length;
  if (honeyCount >= 3 || automatedCount >= 3)
    signals.push({
      source: "ØªØ®Ù…ÙŠÙ† Ø¢Ù„ÙŠ Ø£Ùˆ Ù…Ø­Ø§ÙˆÙ„Ø§Øª Ø¹Ø´ÙˆØ§Ø¦ÙŠØ©",
      confidence: Math.min(99, 50 + honeyCount * 8 + automatedCount * 10),
      evidence: `${honeyCount} Ù…Ø­Ø§ÙˆÙ„Ø§Øª Ø¹Ù„Ù‰ Ø£ÙƒÙˆØ§Ø¯ ØºÙŠØ± Ù…ØµØ¯Ø±Ø© Ùˆ${automatedCount} Ø£Ù†Ù…Ø§Ø· Ø¥Ø¯Ø®Ø§Ù„ Ø¢Ù„ÙŠØ©.`,
      recommendation: "Ø§ÙƒØªÙÙ Ø¨Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© ÙˆØ§Ù„Ø®Ù†Ù‚ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ Ù„Ù„Ù…Ø­Ø§ÙˆÙ„Ø§Øª.",
    });
  if (outOfContextAlerts.length >= 2)
    signals.push({
      source: "Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø®Ø§Ø±Ø¬ Ø§Ù„Ø³ÙŠØ§Ù‚",
      confidence: Math.min(99, 45 + outOfContextAlerts.length * 8),
      evidence: `${outOfContextAlerts.length} Ù…Ø­Ø§ÙˆÙ„Ø© Ø¸Ù‡Ø±Øª ÙÙŠ Ø´Ø¹Ø¨Ø© Ø£Ùˆ ÙˆÙ‚Øª ØºÙŠØ± Ù…ØªÙˆÙ‚Ø¹.`,
      recommendation: "Ø±Ø§Ø¬Ø¹ ØªÙˆØ§ÙÙ‚ Ø§Ù„Ø¯ÙØ¹Ø© Ù…Ø¹ Ø§Ù„Ø´Ø¹Ø¨Ø© ÙˆÙˆÙ‚Øª Ø§Ù„ØªÙˆØ²ÙŠØ¹.",
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
      title: `Ø¯ÙØ¹Ø© ${topBatch.batchId} ØªØ­ØªØ§Ø¬ Ù…ØªØ§Ø¨Ø¹Ø©`,
      body: `Ù†Ø´Ø§Ø· ØºÙŠØ± Ø·Ø¨ÙŠØ¹ÙŠ ${topBatch.abnormalRate}% Ù…Ø¹ ${topBatch.attempts} Ù…Ø­Ø§ÙˆÙ„Ø© Ùˆ${topBatch.distinctDevices} Ø£Ø¬Ù‡Ø²Ø©.`,
      suggestedAction:
        topBatch.score >= 75
          ? "Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø¯ÙØ¹Ø© Ù‚Ø¨Ù„ ØªÙˆØ²ÙŠØ¹ Ø£ÙƒÙˆØ§Ø¯ Ø¥Ø¶Ø§ÙÙŠØ©."
          : "Ø±Ø§Ù‚Ø¨ Ø§Ù„Ø¯ÙØ¹Ø© ÙÙ‚Ø· ÙˆÙ„Ø§ ØªÙˆÙ‚ÙÙ‡Ø§ Ø§Ù„Ø¢Ù†.",
      priority: topBatch.score >= 75 ? "Ø¹Ø§Ù„ÙŠØ©" : "Ù…ØªÙˆØ³Ø·Ø©",
    });
  const topCollective = input.collectiveTransferAlerts[0];
  if (topCollective)
    reports.push({
      title: `Ø§Ø´ØªØ¨Ø§Ù‡ ØªØ¯Ø§ÙˆÙ„ Ø¯Ø§Ø®Ù„ Ø´Ø¹Ø¨Ø© ${topCollective.sectionCode}`,
      body: `${topCollective.distinctCodes} Ø£ÙƒÙˆØ§Ø¯ Ùˆ${topCollective.distinctStudents} Ø·Ù„Ø¨Ø© Ø¸Ù‡Ø±ÙˆØ§ ÙÙŠ Ù†Ù…Ø· ÙˆØ§Ø­Ø¯.`,
      suggestedAction:
        "Ù…Ø±Ø§Ø¬Ø¹Ø© Ø§Ù„Ø·Ù„Ø§Ø¨ Ø¨Ù‡Ø¯ÙˆØ¡ØŒ ÙˆÙ„Ø§ Ø­Ø§Ø¬Ø© Ù„Ø¥ÙŠÙ‚Ø§Ù ÙƒØ§Ù…Ù„ Ø§Ù„Ø¯ÙØ¹Ø© Ù…Ø¨Ø§Ø´Ø±Ø©.",
      priority: "Ù…ØªÙˆØ³Ø·Ø©",
    });
  const topLeak = input.leakSources[0];
  if (topLeak)
    reports.push({
      title: `ØªÙØ³ÙŠØ± Ù…Ø­ØªÙ…Ù„: ${topLeak.source}`,
      body: topLeak.evidence,
      suggestedAction: topLeak.recommendation,
      priority: topLeak.confidence >= 75 ? "Ø¹Ø§Ù„ÙŠØ©" : "Ù…ØªÙˆØ³Ø·Ø©",
    });
  const topContext = input.outOfContextAlerts[0];
  if (topContext)
    reports.push({
      title: "ÙƒÙˆØ¯ Ø¸Ù‡Ø± Ø®Ø§Ø±Ø¬ Ø³ÙŠØ§Ù‚Ù‡",
      body: `${topContext.code} Ø¸Ù‡Ø± ÙÙŠ ${topContext.actualSection || "Ø´Ø¹Ø¨Ø© ØºÙŠØ± Ù…Ø­Ø¯Ø¯Ø©"} Ø¨ÙŠÙ†Ù…Ø§ Ø§Ù„Ù…ØªÙˆÙ‚Ø¹ ${topContext.expectedSection || "ØºÙŠØ± Ù…Ø­Ø¯Ø¯"}.`,
      suggestedAction: "Ø±Ø§Ø¬Ø¹ Ø§Ø±ØªØ¨Ø§Ø· Ø§Ù„ÙƒÙˆØ¯ Ø¨Ø§Ù„Ø´Ø¹Ø¨Ø© Ù‚Ø¨Ù„ Ø§ØªØ®Ø§Ø° Ø¥Ø¬Ø±Ø§Ø¡ Ø¹Ù„Ù‰ Ø§Ù„Ø·Ø§Ù„Ø¨.",
      priority: "Ù…Ù†Ø®ÙØ¶Ø©",
    });
  // Ù„Ø§ Ù†ÙÙ†Ø´Ø¦ ØªÙ‚Ø±ÙŠØ±Ø§Ù‹ Ø§ÙØªØ±Ø§Ø¶ÙŠØ§Ù‹ Ø¹Ù†Ø¯ Ø§Ù„Ù‡Ø¯ÙˆØ¡Ø› Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ù„Ø¯ÙŠÙ‡Ø§ Ø­Ø§Ù„Ø© ÙØ§Ø±ØºØ© ÙˆØ§Ø¶Ø­Ø©.
  // Ø§Ù„ØªÙ‚Ø±ÙŠØ± Ø§Ù„ÙˆÙ‡Ù…ÙŠ "Ø§Ù„ÙˆØ¶Ø¹ Ù…Ø³ØªÙ‚Ø±" ÙƒØ§Ù† ÙŠÙØ­Ø³Ø¨ ÙƒØ¥Ø¬Ø±Ø§Ø¡ Ù…Ø·Ù„ÙˆØ¨ Ø¨Ø¹Ø¯ Ø§Ù„ØªÙ‡ÙŠØ¦Ø© Ø§Ù„Ø´Ø§Ù…Ù„Ø©ØŒ
  // ÙÙŠØ¸Ù‡Ø± Ø±Ù‚Ù… 1 ÙÙŠ Ù…Ø±ÙƒØ² Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø© Ø±ØºÙ… Ø£Ù† ÙƒÙ„ Ø§Ù„Ù…Ø¤Ø´Ø±Ø§Øª Ø§Ù„Ø­ÙŠØ© ØµÙØ±.
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
      codeJourneyEvent("ØªÙ… Ø§Ù„ØªÙØ¹ÙŠÙ„", req, {
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
    reason: "Ø¥ÙŠÙ‚Ø§Ù Ù…Ø¤Ù‚Øª Ø¨Ø³Ø¨Ø¨ ØªÙƒØ±Ø§Ø± Ù…Ø­Ø§ÙˆÙ„Ø§Øª ØªÙØ¹ÙŠÙ„ Ø§Ù„ÙƒÙˆØ¯",
  });
  res.setHeader("Retry-After", String(limit.retryAfterSeconds));
  res
    .status(429)
    .json({
      error:
        "ØªÙ… Ø¥ÙŠÙ‚Ø§Ù Ù…Ø­Ø§ÙˆÙ„Ø§Øª Ø§Ù„ØªÙØ¹ÙŠÙ„ Ù…Ø¤Ù‚ØªÙ‹Ø§ Ù„Ø­Ù…Ø§ÙŠØ© Ø§Ù„ÙƒÙˆØ¯. Ø­Ø§ÙˆÙ„ Ù„Ø§Ø­Ù‚Ù‹Ø§ Ø£Ùˆ Ø±Ø§Ø¬Ø¹ Ø£Ø³ØªØ§Ø° Ø§Ù„Ù…Ù‚Ø±Ø±.",
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
  // ÙƒØ¨Ø­ Ø§Ù„ØªÙƒØ±Ø§Ø± Ø§Ù„Ø¬Ø°Ø±ÙŠ: Ø­ÙŠÙ† ÙŠØªÙƒØ±Ø± Ù†ÙØ³ Ø§Ù„Ø§Ù†ØªÙ‡Ø§Ùƒ Ø¨Ø§Ù„Ø¶Ø¨Ø· (Ù†ÙØ³ Ø§Ù„Ø·Ø§Ù„Ø¨ + Ù†ÙØ³ Ø§Ù„Ø³Ø¨Ø¨ +
  // Ù†ÙØ³ Ø§Ù„ÙƒÙˆØ¯ + Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø²) Ø®Ù„Ø§Ù„ Ù†Ø§ÙØ°Ø© Ù‚ØµÙŠØ±Ø©ØŒ Ù†ÙƒØªÙÙŠ Ø¨Ø£ÙˆÙ„ ØªØ³Ø¬ÙŠÙ„ ÙˆØªÙ†Ø¨ÙŠÙ‡ ÙˆÙ„Ø§ Ù†ÙƒØ±Ù‘Ø±.
  // Ù‡Ø°Ø§ ÙŠØ¹Ø§Ù„Ø¬ Ø¥ØºØ±Ø§Ù‚ Ø§Ù„Ù…Ø¹Ù„Ù… Ø¨Ù…Ø¦Ø§Øª Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø­ÙŠÙ† ÙŠÙØ¹Ø§Ø¯ ÙØ­Øµ Ø¬Ù„Ø³Ø© Ø´Ø±Ø¹ÙŠØ© Ø¹Ø¨Ø± Ù†Ø¯Ø§Ø¡Ø§Øª
  // Ø¯ÙˆØ±ÙŠØ© Ù„Ø§ ØªØ­Ù…Ù„ Ø³Ø±Ù‘ Ø§Ù„Ù…ØªØµÙØ­ (Ø¨Ø¹Ø¯ ØªØ¨Ø¯ÙŠÙ„/ÙÙƒ Ø§Ù„Ø¬Ù‡Ø§Ø²)ØŒ ÙˆÙŠÙ…Ù†Ø¹ Ø£ÙŠØ¶Ø§Ù‹ ØªØ¶Ø®ÙŠÙ… Ø¹Ø¯Ù‘Ø§Ø¯
  // Ø§Ù„ØªØ³Ø±ÙŠØ¨ Ø¹Ù„Ù‰ ÙƒÙˆØ¯ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø°ÙŠ Ù‚Ø¯ ÙŠØ¬Ù…Ù‘Ø¯Ù‡ Ø¸Ù„Ù…Ø§Ù‹. Ø£ÙˆÙ„ ØªÙ†Ø¨ÙŠÙ‡ ÙŠØ¨Ù‚Ù‰ ÙØ¹Ù‘Ø§Ù„Ø§Ù‹ØŒ ÙˆØ£ÙŠ
  // Ø§Ù†ØªÙ‡Ø§Ùƒ Ù…Ø®ØªÙ„Ù (Ø³Ø¨Ø¨/ÙƒÙˆØ¯/Ø¬Ù‡Ø§Ø² Ø¢Ø®Ø±) ÙŠÙÙ†Ø¨Ù‘Ù‡ ÙÙˆØ±Ø§Ù‹.
  const dedupToken = getRequestDeviceToken(req);
  const dedupFingerprint = getRequestDeviceFingerprint(req);
  // Ù†Ø§ÙØ°Ø© ÙˆØ§Ø³Ø¹Ø© ØªÙƒÙÙŠ Ù„ØªØºØ·ÙŠØ© Ø¬Ù„Ø³Ø© Ø¯Ø®ÙˆÙ„ ÙƒØ§Ù…Ù„Ø© ÙÙ„Ø§ ÙŠØµÙ„ Ø§Ù„Ù…Ø¹Ù„Ù… Ø³ÙˆÙ‰ ØªÙ†Ø¨ÙŠÙ‡ ÙˆØ§Ø­Ø¯ Ø¹Ù†
  // Ù†ÙØ³ Ø§Ù„ÙˆØ§Ù‚Ø¹Ø© Ø¨Ø§Ù„Ø¶Ø¨Ø·Ø› Ø¢Ù…Ù†Ø© Ù„Ø£Ù† Ø§Ù„Ù…ÙØªØ§Ø­ Ø¯Ù‚ÙŠÙ‚ (Ø·Ø§Ù„Ø¨+Ø³Ø¨Ø¨+ÙƒÙˆØ¯+Ø¬Ù‡Ø§Ø²)ØŒ ÙØ£ÙŠ Ù…Ø­Ø§ÙˆÙ„Ø©
  // Ù…Ø®ØªÙ„ÙØ© (Ø¬Ù‡Ø§Ø²/ÙƒÙˆØ¯/Ø³Ø¨Ø¨ Ø¢Ø®Ø±) ØªÙÙ†Ø¨Ù‘Ù‡ ÙÙˆØ±Ø§Ù‹ Ø¯ÙˆÙ† ØªØ£Ø«Ù‘Ø± Ø¨Ù‡Ø°Ù‡ Ø§Ù„Ù†Ø§ÙØ°Ø©.
  const dedupWindowMs = 6 * 60 * 60 * 1000;
  const dedupNow = Date.now();
  // Ù†Ø­Ø³Ø¨ Ø§Ù„Ø¶Ø±Ø¨Ø© Ø§Ù„Ø£Ù…Ù†ÙŠØ© Ø­ØªÙ‰ Ù„Ùˆ ÙƒØ§Ù† Ù†ÙØ³ Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡ Ù…ÙƒØ±Ø±Ø§Ù‹Ø› Ø§Ù„ÙƒØ¨Ø­ Ù‡Ù†Ø§ ÙŠÙ…Ù†Ø¹ Ø¥Ø²Ø¹Ø§Ø¬
  // Ø§Ù„Ø£Ø³ØªØ§Ø° ÙÙ‚Ø·ØŒ ÙˆÙ„Ø§ ÙŠØ³Ù…Ø­ Ù„Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø¨ØªÙƒØ±Ø§Ø± Ù†ÙØ³ Ø§Ù„ÙƒÙˆØ¯ Ø¢Ù„Ø§Ù Ø§Ù„Ù…Ø±Ø§Øª Ø¨Ù„Ø§ Ø­Ø¯.
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
    : "Ù…ØµØ§Ø¦Ø¯ Ø§Ù„Ø£ÙƒÙˆØ§Ø¯";
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
      ? "Ù…ØµÙŠØ¯Ø© ÙƒÙˆØ¯ ØºÙŠØ± Ù…ÙØµØ¯Ø± Ø£Ùˆ Ù…Ø­Ø§ÙˆÙ„Ø© ØªØ®Ù…ÙŠÙ† ÙƒÙˆØ¯"
      : params.reason,
    deviceFingerprint,
    deviceToken,
    ip: req.ip || "127.0.0.1",
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    timestamp,
    activationTelemetry: telemetry,
    codeReputation: reputation?.level || (honeyCode ? "suspicious" : "watch"),
    codeReputationLabel: reputation?.label || (honeyCode ? "Ù…Ø´ØªØ¨Ù‡" : "Ù…Ø±Ø§Ù‚Ø¨Ø©"),
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
    studentName: params.student?.name || "Ù…Ø­Ø§ÙˆÙ„Ø© ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙØ©",
    action: honeyCode ? "Ù…ØµÙŠØ¯Ø© ÙƒÙˆØ¯" : "Ù…Ø­Ø§ÙˆÙ„Ø© ÙƒÙˆØ¯ Ù…Ø±ÙÙˆØ¶Ø©",
    details: `${honeyCode ? "Ù…ØµÙŠØ¯Ø© ÙƒÙˆØ¯ ØºÙŠØ± Ù…ÙØµØ¯Ø±" : params.reason} â€” Ø§Ù„Ø±Ù…Ø²: ${normalizeJoinCode(params.code) || "-"}`,
    teacherEmail: attemptSectionCode ? sectionOwnerEmail(attemptSectionCode) : undefined,
    actorEmail: attemptSectionCode ? sectionOwnerEmail(attemptSectionCode) : undefined,
    sectionCode: attemptSectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    os: "Ù†Ø²Ø§Ù‡Ø© Ø§Ù„Ø£ÙƒÙˆØ§Ø¯",
    browser: honeyCode ? "Ù…ØµÙŠØ¯Ø© Ø§Ù„Ø£ÙƒÙˆØ§Ø¯" : "Ù†Ø¸Ø§Ù… Ø§Ù„Ø­Ù…Ø§ÙŠØ©",
    isViolationWarning: true,
  });
  if (params.student && attemptSectionCode) {
    notifyTeachersForSection(
      attemptSectionCode,
      honeyCode ? "Ù…ØµÙŠØ¯Ø© ÙƒÙˆØ¯" : "ØªÙ†Ø¨ÙŠÙ‡ Ù†Ø²Ø§Ù‡Ø© ÙƒÙˆØ¯",
      `Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø±ÙÙˆØ¶Ø© Ù„Ù„Ø·Ø§Ù„Ø¨ ${params.student.name}: ${honeyCode ? "Ù…ØµÙŠØ¯Ø© ÙƒÙˆØ¯ ØºÙŠØ± Ù…ÙØµØ¯Ø±" : params.reason}`,
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

  // Ø§Ø­ØªÙŠØ§Ø· Ù†Ø§Ø¯Ø± Ø¬Ø¯Ø§Ù‹: Ø¥Ù† Ø§Ù…ØªÙ„Ø£Øª Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø§Øª Ø§Ù„Ø¹Ø´ÙˆØ§Ø¦ÙŠØ© Ù†ÙˆÙ„Ø¯ Ø¬Ø³Ù…Ø§Ù‹ Ù…Ø´ÙØ±Ø§Ù‹ Ø²Ù…Ù†ÙŠØ§Ù‹
  // Ø¨Ù†ÙØ³ Ø§Ù„Ø£Ø¨Ø¬Ø¯ÙŠØ© Ø§Ù„Ø¢Ù…Ù†Ø©ØŒ Ø¨Ù„Ø§ Ø±Ø¬ÙˆØ¹ Ù„ØµÙŠØºØ© Ø§Ù„Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø©.
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
  if (!state.legacy) return state; // ØªÙˆÙ‚ÙŠØ¹ Ù…ÙˆØ¬ÙˆØ¯ Ù„ÙƒÙ†Ù‡ ØºÙŠØ± ØµØ­ÙŠØ­: Ù„Ø§ Ù†Ø¹ÙŠØ¯ ØªÙˆÙ‚ÙŠØ¹Ù‡.
  const signature = signJoinCodeRecord(code);
  if (!signature) return state;

  // ØªØ±Ù‚ÙŠØ© Ù‡Ø§Ø¯Ø¦Ø© Ù„Ù„Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ø­ÙŠÙ‘Ø© Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø©: Ù„Ø§ Ù†ÙƒØ³Ø± Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯Ø©ØŒ Ø¨Ù„ Ù†ÙˆÙ‚Ù‘Ø¹Ù‡Ø§
  // Ø£ÙˆÙ„ Ù…Ø±Ø© ØªÙ…Ø± Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø§Ø¯Ù… Ø«Ù… ØªØµØ¨Ø­ Ø®Ø§Ø¶Ø¹Ø© Ù„Ù„ØªØ­Ù‚Ù‚ Ø§Ù„Ø¥Ø¬Ø¨Ø§Ø±ÙŠ Ù…Ø«Ù„ Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©.
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
      "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ù†Øµ Ù‚Ø§Ø¨Ù„ Ù„Ù„Ø§Ø³ØªØ®Ø±Ø§Ø¬ Ø¯Ø§Ø®Ù„ Ù…Ù„Ù PDF. ØºØ§Ù„Ø¨Ù‹Ø§ Ø§Ù„Ù…Ù„Ù Ù…ØµÙˆÙ‘Ø±/Ù…Ù…Ø³ÙˆØ­ Ø¶ÙˆØ¦ÙŠÙ‹Ø§ØŒ ÙˆØ§Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ø­Ù„ÙŠ Ø§Ù„Ù…Ø¬Ø§Ù†ÙŠ Ù„Ø§ ÙŠØ³ØªØ®Ø¯Ù… OCR. ÙŠÙ…ÙƒÙ†Ùƒ Ø±ÙØ¹ Ù†Ø³Ø®Ø© Ù†ØµÙŠØ© Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„Ù†Ø³Ø® Ù„Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ ØªÙ‚Ø³ÙŠÙ… Ø£Ø¯Ù‚.",
  };
}

function normalizeTitle(line: string, fallback: string): string {
  const t = (line || "")
    .replace(/[\u0000\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return fallback;
  return t.length > 80 ? t.slice(0, 80) + "â€¦" : t;
}

function topConceptsFromText(text: string, count = 4): string[] {
  const stop = new Set([
    "Ø§Ù„Ø°ÙŠ",
    "Ø§Ù„ØªÙŠ",
    "Ø¹Ù„Ù‰",
    "Ø§Ù„Ù‰",
    "Ø¥Ù„Ù‰",
    "ÙÙŠ",
    "Ù…Ù†",
    "Ø¹Ù†",
    "Ù‡Ø°Ø§",
    "Ù‡Ø°Ù‡",
    "Ø°Ù„Ùƒ",
    "ØªÙ„Ùƒ",
    "ÙƒØ§Ù†",
    "ÙƒØ§Ù†Øª",
    "Ù…Ø¹",
    "ÙƒÙ…Ø§",
    "ÙˆÙ‚Ø¯",
    "Ù„Ø°Ù„Ùƒ",
    "Ø­ÙŠØ«",
    "Ø¨ÙŠÙ†",
    "Ø¨Ø¹Ø¯",
    "Ù‚Ø¨Ù„",
    "Ø¹Ù†Ø¯",
    "ÙƒÙ„",
    "Ø£ÙŠ",
    "Ø£Ùˆ",
    "Ø£Ù†",
    "Ø¥Ù†",
    "Ù‡Ùˆ",
    "Ù‡ÙŠ",
    "Ø«Ù…",
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
    /^(Ø§Ù„ÙØµÙ„|Ø§Ù„Ø¨Ø§Ø¨|Ø§Ù„ÙˆØ­Ø¯Ø©|Ø§Ù„Ù…Ø­ÙˆØ±|Chapter|Unit|Module)\s*[\w\d\u0660-\u0669\u06F0-\u06F9:ï¼š\-.ØŒ ]{0,80}/i;
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
        title: `Ù…ÙˆØ¶ÙˆØ¹ ${tIdx + 1}: ${c}`,
        pages: `${Math.max(1, idx * 20 + tIdx * 6 + 1)}-${Math.max(6, idx * 20 + tIdx * 6 + 6)}`,
        concepts: concepts.slice(tIdx, tIdx + 3).length
          ? concepts.slice(tIdx, tIdx + 3)
          : concepts,
      }));
      return {
        id: `chap-${idx + 1}`,
        title: normalizeTitle(h.l, `Ø§Ù„ÙØµÙ„ ${idx + 1}`),
        subtitle:
          "ØªÙ… Ø§Ø³ØªØ®Ù„Ø§Øµ Ù‡Ø°Ø§ Ø§Ù„ÙØµÙ„ Ù…Ø­Ù„ÙŠÙ‹Ø§ Ù…Ù† Ø¨Ù†ÙŠØ© Ø§Ù„Ù…ØµØ¯Ø± Ø§Ù„Ù…Ø±ÙÙˆØ¹ Ø¯ÙˆÙ† ÙƒØ´Ù Ø§Ø³Ù… Ø§Ù„Ù…Ù„Ù.",
        topics: topics.length
          ? topics
          : [
              {
                id: `topic-${idx + 1}-1`,
                title: "Ù…ÙˆØ¶ÙˆØ¹ Ø¹Ø§Ù… Ù…Ø³ØªØ®Ø±Ø¬",
                pages: "1-10",
                concepts: concepts.length ? concepts : ["Ù…ÙÙ‡ÙˆÙ… Ø¹Ø§Ù…"],
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
        title: `Ø§Ù„ÙØµÙ„ ${idx + 1}: Ù…Ø­ÙˆØ± Ù…Ø³ØªØ®Ø±Ø¬ Ù…Ù† Ø§Ù„Ù…ØµØ¯Ø±`,
        subtitle: "ØªÙ‚Ø³ÙŠÙ… Ù…Ø­Ù„ÙŠ Ù…Ø¬Ø§Ù†ÙŠ Ù…Ø¨Ù†ÙŠ Ø¹Ù„Ù‰ Ù†Øµ PDF Ø§Ù„Ù‚Ø§Ø¨Ù„ Ù„Ù„Ø§Ø³ØªØ®Ø±Ø§Ø¬.",
        topics: [0, 1].map((tIdx) => ({
          id: `topic-${idx + 1}-${tIdx + 1}`,
          title: `Ù…ÙˆØ¶ÙˆØ¹ ${tIdx + 1}: ${concepts[tIdx] || "Ù…ÙÙ‡ÙˆÙ… ØªØ·Ø¨ÙŠÙ‚ÙŠ"}`,
          pages: `${idx * 20 + tIdx * 10 + 1}-${idx * 20 + (tIdx + 1) * 10}`,
          concepts: concepts.slice(tIdx, tIdx + 3).length
            ? concepts.slice(tIdx, tIdx + 3)
            : ["Ù…ÙÙ‡ÙˆÙ… Ø¹Ø§Ù…"],
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
        ? "PDF Ù„Ø§ ÙŠØ­ØªÙˆÙŠ Ù†ØµÙ‹Ø§ Ù‚Ø§Ø¨Ù„Ù‹Ø§ Ù„Ù„Ø§Ø³ØªØ®Ø±Ø§Ø¬ ÙƒÙØ§ÙŠØ©. Ù„Ù… ÙŠØªÙ… Ø¥Ù†Ø´Ø§Ø¡ ÙØµÙˆÙ„ Ø§ÙØªØ±Ø§Ø¶ÙŠØ©."
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
          `ğŸ¤– [Gemini Retry Utility] Attempting model: ${model} (attempt ${attempt}/3)`,
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
            `âœ¨ [Gemini Retry Utility] Successfully completed GenAI generation using model: ${model}`,
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
          `âš ï¸ [Gemini Retry Utility] Model ${model} failed on attempt ${attempt}/3 with error: ${msg}`,
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
            `ğŸš¨ [Gemini Retry Utility] API Key quota is depleted or key is suspended. Stopping generation without creating fallback data.`,
          );
          throw error;
        }

        // If it's a transient error, sleep with exponential backoff before the next attempt
        if (attempt < 3) {
          const backoffTime = attempt * 1200 + Math.floor(Math.random() * 500);
          console.log(
            `ğŸ’¤ [Gemini Retry Utility] Sleeping for ${backoffTime}ms before retrying...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
        }
      }
    }
    console.log(
      `ğŸ”„ [Gemini Retry Utility] Persistent failures on ${model}. Trying next alternate fallback model in checklist...`,
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
// useTempFiles: Ø§Ù„Ù…Ù„Ù Ø§Ù„Ù…Ø±ÙÙˆØ¹ ÙŠØªØ¯ÙÙ‚ Ø¥Ù„Ù‰ Ù‚Ø±Øµ Ù…Ø¤Ù‚Øª Ø¨Ø¯Ù„ Ø§Ù„Ø°Ø§ÙƒØ±Ø©. ÙƒØ§Ù† Ù…Ù„Ù Ù¢Ù¡Ù….Ø¨
// ÙŠÙØ­Ù…ÙÙ‘Ù„ ÙƒØ§Ù…Ù„Ø§Ù‹ ÙÙŠ RAM (targetFile.data) Ø«Ù… ÙŠØªÙ†Ø³Ù‘Ø® Ø¹Ø¯Ø© Ù…Ø±Ø§Øª Ø¹Ø¨Ø± Ù…Ø³Ø§Ø± Ø§Ù„Ø£Ø±Ø´ÙØ©
// Ø­ØªÙ‰ ØªÙ†ÙØ¬Ø± Ø°Ø§ÙƒØ±Ø© Ø§Ù„Ø­Ø§ÙˆÙŠØ© ÙˆÙŠÙ‚ØªÙ„Ù‡Ø§ Cloud Run (OOM Ù…ÙˆØ«Ù‘Ù‚ ÙÙŠ Ø§Ù„Ø³Ø¬Ù„Ø§Øª) ÙÙŠØµÙ„
// Ù„Ù„Ø·Ø§Ù„Ø¨ 503 "ØªØ¹Ø°Ø±" Ø±ØºÙ… Ù†Ø¬Ø§Ø­ Ø§Ù„Ø±ÙØ¹ ÙØ¹Ù„ÙŠØ§Ù‹.
app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: "/tmp/miras-uploads",
    createParentPath: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
// â•â•â• Ø´Ø¨ÙƒØ© Ø§Ù„ØµÙŠØ¯ Ø§Ù„Ù†ÙˆÙˆÙŠØ© â€” Ø·Ø¨Ù‚Ø© Ø§Ù„Ø®Ø§Ø¯Ù… ğŸ›°ï¸ â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// (Ø£) ÙƒÙ„ Ø§Ø³ØªØ¬Ø§Ø¨Ø© 5xx ØªØµÙŠØ± Ø¨Ø·Ø§Ù‚Ø© Ø±Ø§Ø¯Ø§Ø± Ø­ØªÙ‰ Ù„Ùˆ Ø¹ÙˆÙ„Ø¬Øª Ø¨Ø£Ø¯Ø¨ Ø¯Ø§Ø®Ù„ Ø§Ù„Ù…Ø³Ø§Ø± (ÙƒØ§Ù†Øª
// ØºÙŠØ± Ù…Ø±Ø¦ÙŠØ©: ÙˆØ³ÙŠØ· Ø§Ù„Ø£Ø®Ø·Ø§Ø¡ ÙŠÙ„ØªÙ‚Ø· Ø§Ù„Ù…Ø±Ù…ÙŠÙ‘ ÙÙ‚Ø·) + Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ø²Ø§Ø­ÙØ© ÙÙˆÙ‚ Ù¡Ù¢Ø«.
const mirasRadar5xxSeen = new Map<string, number>();
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    try {
      const path = String(req.path || "");
      if (path.startsWith("/api/monitor")) return;
      const status = Number(res.statusCode || 0);
      const tookMs = Date.now() - startedAt;
      const onceKey = (k: string) => {
        const now = Date.now();
        const prev = mirasRadar5xxSeen.get(k);
        if (prev && now - prev < 120_000) return false;
        mirasRadar5xxSeen.set(k, now);
        if (mirasRadar5xxSeen.size > 200) mirasRadar5xxSeen.clear();
        return true;
      };
      if (status >= 500 && onceKey(`5xx|${status}|${req.method}|${path}`)) {
        mirasRecordServerError(
          `HTTP ${status} Ø¹Ù„Ù‰ ${req.method} ${path}`,
          `Ø§Ù„Ù…Ø¯Ø©: ${tookMs}ms`,
          path,
        );
      } else if (
        tookMs > 12_000 &&
        !path.includes("/submissions/upload") &&
        onceKey(`slow|${req.method}|${path}`)
      ) {
        mirasRecordServerError(
          `Ø·Ù„Ø¨ Ø²Ø§Ø­Ù: ${req.method} ${path} Ø§Ø³ØªØºØ±Ù‚ ${(tookMs / 1000).toFixed(1)}Ø«`,
          `status=${status}`,
          path,
        );
      }
    } catch {}
  });
  next();
});
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
    // Ø§Ø´ØªÙ‚Ø§Ù‚ Ø§Ù„Ø§Ù…ØªØ¯Ø§Ø¯: Ù…Ù† Ø§Ø³Ù… Ø§Ù„Ù…Ù„Ù Ø£ÙˆÙ„Ø§Ù‹ØŒ ÙˆØ¥Ù„Ø§ Ù…Ù† Ù†ÙˆØ¹ MIME Ø¯Ø§Ø®Ù„ Ø±Ø§Ø¨Ø· data:.
    // Ø£Ù†ÙˆØ§Ø¹ Ø£ÙˆÙÙŠØ³ Ø§Ù„Ø­Ø¯ÙŠØ«Ø© (pptx/docx) Ù„Ù‡Ø§ MIME Ø·ÙˆÙŠÙ„ ÙŠØ­ØªÙˆÙŠ Ù†Ù‚Ø§Ø·Ø§Ù‹ (Ù…Ø«Ù„
    // ...presentationml.presentation)ØŒ ÙÙ„Ø§ ÙŠØµØ­ Ø§Ø¹ØªÙ…Ø§Ø¯ Ù…Ø§ Ø¨Ø¹Ø¯ Ø¢Ø®Ø± Ù†Ù‚Ø·Ø© ÙƒØ§Ù…ØªØ¯Ø§Ø¯Ø›
    // Ù†Ø¹ØªÙ…Ø¯ Ø®Ø±ÙŠØ·Ø© ØµØ±ÙŠØ­Ø© Ø­ØªÙ‰ Ù„Ø§ ÙŠÙØ±ÙØ¶ ØªØ­ÙˆÙŠÙ„ Ø§Ù„Ø¨ÙˆØ±Ø¨ÙˆÙŠÙ†Øª/Ø§Ù„ÙˆÙˆØ±Ø¯ Ø§Ù„Ù…ÙØ±Ø³ÙÙ„ Ù…Ø¶Ù…Ù‘Ù†Ø§Ù‹.
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
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        ".xlsx",
      "application/vnd.ms-excel": ".xls",
    };
    let ext = path.extname(filename || "").toLowerCase();
    if (!MIRAS_OFFICE_CONVERTIBLE_EXTS.has(ext)) {
      ext = MIRAS_MIME_TO_OFFICE_EXT[mimeInData] || ext;
    }
    if (!MIRAS_OFFICE_CONVERTIBLE_EXTS.has(ext)) {
      return res.status(400).json({ error: "Unsupported format for conversion" });
    }
    // Ù†ÙØ³ ØµÙŠØºØ© Ø§Ù„Ø§Ù„ØªÙ‚Ø§Ø· Ø§Ù„Ù…ØªØ³Ø§Ù‡Ù„Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…Ø© ÙÙŠ Ø¨Ø§Ù‚ÙŠ Ù…ÙˆØ§Ø¶Ø¹ Ù‚Ø±Ø§Ø¡Ø© Ø±ÙˆØ§Ø¨Ø· data: ÙÙŠ
    // Ø§Ù„Ø®Ø§Ø¯Ù… (ØªØªÙ‚Ø¨Ù‘Ù„ Ù†ÙˆØ¹ MIME Ø§Ù„Ø·ÙˆÙŠÙ„ Ø°Ø§ Ø§Ù„Ù†Ù‚Ø§Ø· ÙˆØ£ÙŠ ÙˆØ³Ø§Ø¦Ø· ;name=â€¦ Ù‚Ø¨Ù„ ;base64,).
    const matches = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/);
    if (!matches || !matches[2]) {
      return res.status(400).json({ error: "Invalid base64 data URL" });
    }
    const buffer = Buffer.from(matches[2], "base64");
    if (!buffer.length) {
      return res.status(400).json({ error: "Empty file" });
    }
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "miras-office-archive-"));
    try {
      const tempPath = path.join(workDir, `source${ext}`);
      fs.writeFileSync(tempPath, buffer);
      const conversionKey = crypto
        .createHash("sha1")
        .update(buffer)
        .digest("hex");
      const pdfBuffer = await convertOfficeFileToPdfDeduped(
        tempPath,
        `data:${conversionKey}`,
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(pdfBuffer);
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch (e) {}
    }
  } catch (err: any) {
    console.error("Data to PDF conversion failed:", err);
    res.status(502).json({
      code: "OFFICE_PREVIEW_FAILED",
      error: "ØªØ¹Ø°Ø± ØªØ¬Ù‡ÙŠØ² Ù…Ø¹Ø§ÙŠÙ†Ø© Ø§Ù„Ù…Ø³ØªÙ†Ø¯ Ø§Ù„Ø¢Ù†. Ø£Ø¹Ø¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø¨Ø¹Ø¯ Ù‚Ù„ÙŠÙ„.",
    });
  }
});

// Ù‚Ø¨Ù„ Ø£ÙŠ Ø·Ù„Ø¨ API Ù†Ù†ØªØ¸Ø± Ø£ÙˆÙ„ Ù…Ø²Ø§Ù…Ù†Ø© Ù…Ù† Firestore Ø­ØªÙ‰ Ù„Ø§ ÙŠØ¨Ø¯Ø£ Ø§Ù„Ø®Ø§Ø¯Ù… Ù…Ù† ÙƒØ§Ø´ Ù‚Ø¯ÙŠÙ….
// ÙˆØ¨Ø¹Ø¯ Ø£ÙŠ Ø¹Ù…Ù„ÙŠØ© ØªØ¹Ø¯ÙŠÙ„ Ù†Ø§Ø¬Ø­Ø© Ù†Ø¤Ø®Ø± Ø±Ø¯ JSON Ù‚Ù„ÙŠÙ„Ø§Ù‹ Ø­ØªÙ‰ ØªÙÙØ±Ù‘Øº Ø§Ù„Ø¯ÙØ¹Ø© ÙˆØªÙØ¯ÙØ¹ Ù„Ù„Ø³Ø­Ø§Ø¨Ø©ØŒ
// Ù…Ø¹ Ø¨Ù‚Ø§Ø¡ flushCloudSoon Ø¨Ø¹Ø¯ Ø§Ù„Ø±Ø¯ ÙƒØ´Ø¨ÙƒØ© Ø£Ù…Ø§Ù† Ù„Ù„Ù…Ø³Ø§Ø±Ø§Øª ØºÙŠØ± JSON. Ø§Ù„Ù‡Ø¯Ù: Ù„Ø§ ÙŠØ¸Ù‡Ø±
// Ø³Ø¬Ù„ ÙÙŠ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ø¥Ù„Ø§ ÙˆÙ‡Ùˆ Ù…Ø­ÙÙˆØ¸/Ù…Ø¬Ø¯ÙˆÙ„ Ù„Ù„Ø¯ÙˆØ§Ù… Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØŒ ÙÙ„Ø§ ÙŠØ®ØªÙÙŠ Ø¨Ø¹Ø¯ Ø§Ù„ØªØ­Ø¯ÙŠØ«.
app.use(async (req, res, next) => {
  try {
    if (req.url.startsWith("/api/") && !req.path.startsWith("/api/config")) {
      await dbInstance.initialSyncPromise;
    }
  } catch (e) {
    console.error("âš ï¸ Initial cloud database sync failed before API request:", e);
  }

  if (req.method !== "GET" && req.url.startsWith("/api/")) {
    // Ø­Ø§Ø±Ø³ Ø¯ÙˆØ§Ù… Ø¹Ø§Ù… Ù„ÙƒÙ„ Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„ØªØ¹Ø¯ÙŠÙ„: Ø£ÙŠ Ø±Ø¯ JSON Ù†Ø§Ø¬Ø­ Ù„Ø§ ÙŠØ®Ø±Ø¬ Ù„Ù„ÙˆØ§Ø¬Ù‡Ø© Ø¥Ù„Ø§ Ø¨Ø¹Ø¯
    // ØªÙØ±ÙŠØº Ø§Ù„Ø¯ÙØ¹Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ© ÙˆØ§Ù†ØªØ¸Ø§Ø± Ù…Ø²Ø§Ù…Ù†Ø© Firestore. Ù‡Ø°Ø§ ÙŠÙ…Ù†Ø¹ Ø­Ø§Ù„Ø© "Ø¸Ù‡Ø± Ø«Ù… Ø§Ø®ØªÙÙ‰"
    // ÙÙŠ Ø§Ù„Ù…Ø³Ø§Ø±Ø§Øª Ø§Ù„ØªÙŠ Ù„Ù… ØªÙƒÙ† ØªØ³ØªØ¯Ø¹ÙŠ waitForSync ÙŠØ¯ÙˆÙŠØ§Ù‹ØŒ ÙˆÙŠØ¨Ù‚ÙŠ Ø£Ø®Ø·Ø§Ø¡ 4xx/5xx Ø³Ø±ÙŠØ¹Ø©.
    const originalJson = res.json.bind(res);
    // Ù…Ø³Ø§Ø±Ø§Øª Ù…ØªØ³Ø§Ù‡Ù„Ø©: Ø¹Ù…Ù„ÙŠØ§ØªÙ‡Ø§ ØªÙÙƒØªØ¨ Ù…Ø­Ù„ÙŠØ§Ù‹ ÙˆØªÙØ²Ø§Ù…ÙÙ† Ø¨Ø§Ù„Ø®Ù„ÙÙŠØ©ØŒ ÙˆÙ„Ø§ ØªØ­ØªØ§Ø¬ ØªØ£ÙƒÙŠØ¯
    // Firestore Ø§Ù„ÙÙˆØ±ÙŠ. ÙƒØ§Ù† ØªØ£Ø®Ù‘Ø± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© ÙŠØ­ÙˆÙ‘Ù„ Ù†Ø¬Ø§Ø­Ù‡Ø§ Ø¥Ù„Ù‰ 503 â€” ÙƒÙ…Ø§ Ø¸Ù‡Ø± ÙÙŠ
    // Â«Ù†Ø³ÙŠØª ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±Â» (Ø±ØµØ¯Ù‡ Ø§Ù„Ø±Ø§Ø¯Ø§Ø±). Ø§Ù„Ø¢Ù† Ù†Ø±Ø¯Ù‘ Ù†Ø¬Ø§Ø­Ù‡Ø§ ÙƒÙ…Ø§ Ù‡Ùˆ ÙˆÙ†ØªØ±Ùƒ Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø©
    // ØªÙƒØªÙ…Ù„ Ø®Ù„ÙÙŠØ§Ù‹ (flushCloudSoon Ø¹Ù„Ù‰ finish).
    const durabilityLenient =
      /^\/api\/auth\/forgot-password|^\/api\/monitor|^\/api\/notifications\/register-token/.test(
        req.path || "",
      );
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
            console.error("âš ï¸ Failed to send guarded JSON response:", e);
          }
        })
        .catch((e) => {
          console.error("âš ï¸ Cloud durability guard could not confirm sync before JSON response:", e);
          try {
            if (!res.headersSent) {
              if (durabilityLenient) {
                // Ù†Ø¬Ø§Ø­ ÙØ¹Ù„ÙŠ ÙƒÙØªØ¨ Ù…Ø­Ù„ÙŠØ§Ù‹Ø› Ù„Ø§ Ù†Ø­ÙˆÙ‘Ù„Ù‡ Ø¥Ù„Ù‰ 503.
                originalJson(body);
              } else {
                res.status(503);
                originalJson(cloudDurabilityErrorBody());
              }
            }
          } catch (sendError) {
            console.error("âš ï¸ Failed to send cloud durability error response:", sendError);
          }
        });
      return res;
    }) as typeof res.json;

    res.on("finish", () => {
      try {
        dbInstance.flushCloudSoon();
      } catch (e) {
        console.error("âš ï¸ Background DB sync error after response:", e);
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
      "ØªØ¹Ø°Ø± ØªØ£ÙƒÙŠØ¯ Ø­ÙØ¸ Ø§Ù„ØªØºÙŠÙŠØ± ÙÙŠ Ø§Ù„Ø³Ø­Ø§Ø¨Ø©. Ù„Ù… Ù†Ø¤ÙƒØ¯ Ù†Ø¬Ø§Ø­ Ø§Ù„Ø¹Ù…Ù„ÙŠØ©Ø› Ø­Ø§ÙˆÙ„ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰ Ø¨Ø¹Ø¯ Ù‚Ù„ÙŠÙ„.",
    code: status?.code || "CLOUD_SYNC_UNAVAILABLE",
  };
}

async function ensureDurableSync(res: express.Response): Promise<boolean> {
  try {
    await dbInstance.waitForSync();
    return true;
  } catch (error) {
    console.error("âš ï¸ Cloud durability sync failed inside API route:", error);
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
  // Ø£ÙŠ ØªÙˆÙƒÙ† ØµØ¯Ø± Ù‚Ø¨Ù„ Ù„Ø­Ø¸Ø© ØªØ¨Ø¯ÙŠÙ„/Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ø¬Ù‡Ø§Ø² ÙŠÙØ¹Ø¯ Ø¬Ù„Ø³Ø© Ù‚Ø¯ÙŠÙ…Ø© ÙˆÙŠÙØ·Ø±Ø¯ ÙÙˆØ±Ø§Ù‹.
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
    // Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø­ÙŠØ© Ù„Ù„Ø·Ø§Ù„Ø¨ Ù‡ÙŠ Ø§Ù„Ù…Ø­Ù…Ù‘Ù„ Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ Ù„Ù…Ø³Ø§Ø­Ø© Ø¹Ù…Ù„ Ø§Ù„Ø·Ø§Ù„Ø¨ (Ù…Ù‚Ø±Ø±Ø§Øª/Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª/
    // Ù…Ø´Ø§Ø±ÙŠØ¹). ÙƒØ§Ù†Øª Ù…ÙØªÙˆØ­Ø© Ø¨Ù„Ø§ Ø­Ù…Ø§ÙŠØ©ØŒ ÙÙŠØ³ØªØ·ÙŠØ¹ Ù…ØªØµÙØ­ Ø«Ø§Ù†Ù (Safari/PWA) ØªØ­Ù…ÙŠÙ„
    // Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬ ÙƒØ§Ù…Ù„Ø§Ù‹ Ø±ØºÙ… Ù‚ÙÙ„ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø¹Ù„Ù‰ Ø¨Ù‚ÙŠØ© Ø§Ù„Ù…Ø³Ø§Ø±Ø§Øª. ØªØ®Ø¶Ø¹ Ø§Ù„Ø¢Ù† Ù„Ù†ÙØ³ Ù‚ÙÙ„
    // Ø§Ù„Ø¬Ù‡Ø§Ø²: Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ù…Ø±Ø¨ÙˆØ· ÙÙ‚Ø· ÙŠØ­Ù…Ù‘Ù„ Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬ØŒ ÙˆØ£ÙŠ Ù…ØªØµÙØ­/Ø¬Ù‡Ø§Ø² Ø¢Ø®Ø± ÙŠÙÙ…Ù†Ø¹.
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
      // Ù‚Ø¨Ù„ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù†Ø³Ù…Ø­ Ø¨Ù„Ù…Ø­Ø© Ø¶ÙŠÙ‚Ø© Ø¬Ø¯Ø§Ù‹: Ù…Ù‚Ø±Ø±Ø§Øª Ø¨Ø§Ù†ØªØ¸Ø§Ø± ØªÙØ¹ÙŠÙ„ ÙƒÙˆØ¯ Ø¬Ø¯ÙŠØ¯ ÙÙ‚Ø·.
      // Ù„Ø§ ØªÙØ¹Ø§Ø¯ Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª/Ù…Ø´Ø§Ø±ÙŠØ¹/ØªØ³Ù„ÙŠÙ…Ø§Øª/Ø£Ø³Ù…Ø§Ø¡ Ø­Ø³Ø§Ø³Ø© Ø¥Ù„Ø§ Ø¨Ø¹Ø¯ Ø¬Ù„Ø³Ø© Ø·Ø§Ù„Ø¨ Ù…ÙˆØ«Ù‚Ø© Ø£Ùˆ Ø£Ø³ØªØ§Ø°.
      (req as any).mirasPublicStudentStatePreview = true;
      return next();
    }
    // Ø¬Ù„Ø³Ø© SEB Ø§Ù„Ù…Ø¤Ù‚ØªØ©: ÙƒØ§Ù† Ù‡Ø°Ø§ Ø§Ù„Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ù…Ø­ØµÙˆØ±Ù‹Ø§ Ø¨Ù…Ø³Ø§Ø±Ø§Øª /api/quizzes ÙÙ‚Ø·ØŒ ÙÙƒØ§Ù†
    // Ø§Ù„Ø·Ø§Ù„Ø¨ ÙŠØ¯Ø®Ù„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù† (SEB ÙŠÙØªØ­ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ ÙÙŠ Ù…ØªØµÙØ­/ØªØ®Ø²ÙŠÙ† Ù…Ù†ÙØµÙ„ Ø¨Ù„Ø§ ÙƒÙˆÙƒÙŠ
    // Ø§Ù„Ø¬Ù„Ø³Ø© Ø§Ù„Ø¹Ø§Ø¯ÙŠØ©) Ø«Ù… ØªÙØ±ÙØ¶ Ø£ÙˆÙ„ Ø·Ù„Ø¨Ø§Øª ØªØ­Ù…ÙŠÙ„ Ø­Ø§Ù„ØªÙ‡ (session-status/live-state
    // ÙˆØºÙŠØ±Ù‡Ø§) Ø¨Ø®Ø·Ø£ STUDENT_SESSION_REQUIRED Ù‚Ø¨Ù„ Ø§Ù„ÙˆØµÙˆÙ„ Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø£ØµÙ„Ø§Ù‹. Ø§Ù„ØªØµØ±ÙŠØ­ Ù‡Ù†Ø§
    // Ù…Ø§ Ø²Ø§Ù„ Ø¶ÙŠÙ‚Ù‹Ø§ ØªÙ…Ø§Ù…Ù‹Ø§ ÙƒØ³Ø§Ø¨Ù‚Ù‡: ÙŠØªØ·Ù„Ø¨ ØªÙˆÙƒÙ† SEB ØµØ§Ù„Ø­Ù‹Ø§ ØºÙŠØ± Ù…Ù†ØªÙ‡Ù (getValidSebPass)
    // ØµØ§Ø¯Ø±Ù‹Ø§ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ ØªØ­Ø¯ÙŠØ¯Ù‹Ø§ ÙˆØªÙ… Ø§Ù„ØªØ­Ù‚Ù‚ Ø£Ù†Ù‡ ÙØ¹Ù„ÙŠÙ‹Ø§ Ù…Ù† Ø¨ÙŠØ¦Ø© SEB
    // (hasActualSebRuntimeHint) â€” ÙÙ‚Ø· Ø§ØªØ³Ø¹ Ù†Ø·Ø§Ù‚Ù‡ Ù„ÙŠØºØ·ÙŠ ÙƒÙ„ Ù…Ø³Ø§Ø±Ø§Øª Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø©
    // Ø£Ø«Ù†Ø§Ø¡ Ø¬Ù„Ø³Ø© SEBØŒ Ù„Ø§ Ù…Ø³Ø§Ø±Ø§Øª Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª ÙÙ‚Ø·ØŒ Ø¯ÙˆÙ† Ø£Ù† ÙŠØµØ¨Ø­ ØªØ¬Ø§ÙˆØ²Ù‹Ø§ Ø¹Ø§Ù…Ù‹Ø§.
    if (!sessionStudentId && requestedStudentId) {
      const sebStudent = dbInstance
        .getStudents()
        .find((s: any) => normalizeStudentId(s.id) === requestedStudentId);
      const sebPass = sebStudent ? getValidSebPass(req, sebStudent) : null;
      if (sebPass && normalizeStudentId(sebPass.studentId) === requestedStudentId) {
        (req as any).mirasSebPass = sebPass;
        return next();
      }
    }
    if (!sessionStudentId || (requestedStudentId && requestedStudentId !== sessionStudentId)) {
      console.warn(`[AUTH_DEBUG] STUDENT_SESSION_REQUIRED for ${req.method} ${pathname}. sessionStudentId: ${sessionStudentId || "None"}, requestedStudentId: ${requestedStudentId || "None"}`);
      return res.status(401).json({
        error: "STUDENT_SESSION_REQUIRED",
        code: "STUDENT_SESSION_REQUIRED",
      });
    }
    if (requestedStudentId && pathname.startsWith("/api/quizzes")) {
      const sebStudent = dbInstance
        .getStudents()
        .find((s: any) => normalizeStudentId(s.id) === requestedStudentId);
      const sebPass = sebStudent ? getValidSebPass(req, sebStudent) : null;
      if (sebPass && String(sebPass.studentId) === String(sebStudent?.id)) {
        return next();
      }
    }
    const currentDeviceToken = getRequestDeviceToken(req);
    if (
      verifiedSession?.deviceTokenHash &&
      (!currentDeviceToken ||
        hashMirasValue(currentDeviceToken) !== verifiedSession.deviceTokenHash)
    ) {
      return res.status(403).json({
        error:
          "Ù‡Ø°Ù‡ Ø§Ù„Ø¬Ù„Ø³Ø© Ù…Ø±ØªØ¨Ø·Ø© Ø¨Ù…ØªØµÙØ­ Ø¢Ø®Ø±. Ø§ÙØªØ­ Ø§Ù„Ø­Ø³Ø§Ø¨ Ù…Ù† Ø§Ù„Ù…ØªØµÙØ­ Ø§Ù„Ø£ØµÙ„ÙŠ Ø£Ùˆ Ø§Ø·Ù„Ø¨ Ù…Ù† Ø£Ø³ØªØ§Ø° Ø§Ù„Ù…Ù‚Ø±Ø± ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„Ø¬Ù‡Ø§Ø².",
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
    // strictLoginSurface Ù‡Ù†Ø§ Ø£ÙŠØ¶Ø§Ù‹ (Ù„Ø§ Ø¹Ù†Ø¯ Ø§Ù„Ø¯Ø®ÙˆÙ„ ÙÙ‚Ø·): PWA Ø¨Ø¬Ù„Ø³Ø©/ØªÙˆÙƒÙ† Ù…Ø­ÙÙˆØ¸ Ù…Ù†
    // Ù‚Ø¨Ù„ Ù„Ø§ ÙŠÙ…Ø±Ù‘ Ø¹Ø¨Ø± /api/auth/login Ø¥Ø·Ù„Ø§Ù‚Ø§Ù‹ â€” ÙŠÙØªØ­ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ ÙˆØªØ¹Ù…Ù„ Ø¬Ù„Ø³ØªÙ‡ Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø©
    // Ù…Ø¨Ø§Ø´Ø±Ø©ØŒ ÙÙƒØ§Ù† Ø§Ù„Ø·Ø§Ù„Ø¨ ÙŠØ³ØªØ®Ø¯Ù… Ø³ÙØ§Ø±ÙŠ + PWA Ù…Ø¹Ø§Ù‹ Ø±ØºÙ… Ù‚ÙÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ (Ø§Ù„Ø«ØºØ±Ø© Ø§Ù„ØªÙŠ
    // Ø£Ø«Ø¨ØªÙ‡Ø§ Ø§Ù„Ù…Ø§Ù„Ùƒ). Ø§Ù„Ø¢Ù† ÙƒÙ„ Ø·Ù„Ø¨ Ø¨Ø¬Ù„Ø³Ø© Ø·Ø§Ù„Ø¨ ÙŠÙÙØ­Øµ Ø³Ø·Ø­Ù‡: Ù…ØªØµÙØ­/ÙˆØ¶Ø¹ Ù…Ø®ØªÙ„Ù Ø¹Ù†
    // Ø§Ù„Ù…ØªØµÙØ­ Ø§Ù„Ù…Ø±Ø¨ÙˆØ· = Ù¤Ù Ù© ÙØªÙ…ÙˆØª Ø§Ù„Ø¬Ù„Ø³Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© ÙÙˆØ±Ø§Ù‹. Ø¬Ù„Ø³Ø§Øª SEB ØªÙØ³ØªØ«Ù†Ù‰ Ø£Ø¹Ù„Ø§Ù‡
    // (ØªÙØ±Ø¬ÙØ¹ valid Ù‚Ø¨Ù„ Ù‡Ø°Ø§ Ø§Ù„ÙØ­Øµ Ø¯Ø§Ø®Ù„ validateSessionFingerprint).
    const deviceValidation = validateSessionFingerprint(req, student, {
      strictLoginSurface: true,
    });
    if (!deviceValidation.isValid) {
      return res.status(deviceValidation.statusCode || 403).json({
        error:
          deviceValidation.error ||
          "Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨ Ù…Ù‚ÙÙ„ Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø² Ø£Ùˆ Ù…ØªØµÙØ­ Ø¢Ø®Ø±.",
        code: "STUDENT_DEVICE_LOCKED",
      });
    }
    // Ù„Ø§ Ù†Ø·Ø±Ø¯ Ø§Ù„Ø¬Ù„Ø³Ø© Ù„Ù…Ø¬Ø±Ø¯ Ø£Ù† accessResetAt ØªØºÙŠÙ‘Ø± Ø¥Ø°Ø§ ÙƒØ§Ù† Ø§Ù„Ø·Ù„Ø¨ Ø§Ù„Ø­Ø§Ù„ÙŠ Ø¢ØªÙŠØ§Ù‹ Ù…Ù†
    // Ø§Ù„Ø¬Ù‡Ø§Ø²/Ø§Ù„Ù…ØªØµÙØ­ Ø§Ù„Ù…Ø¹ØªÙ…Ø¯ ÙØ¹Ù„ÙŠØ§Ù‹. Ø¨Ø¹Ø¯ Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ø£Ø³ØªØ§Ø° Ø¹Ù„Ù‰ ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„Ø¬Ù‡Ø§Ø² ÙƒØ§Ù†
    // PWA Ø§Ù„Ø¬Ø¯ÙŠØ¯ ÙŠØ­Ù…Ù„ Ø£Ø­ÙŠØ§Ù†Ø§Ù‹ ØªÙˆÙƒÙ† Ø¬Ù„Ø³Ø© Ù‚Ø¯ÙŠÙ…ØŒ ÙÙŠÙØ±ÙØ¶ Ù‚Ø¨Ù„ Ø£Ù† ÙŠØ³ØªØ·ÙŠØ¹ Ø§Ù„Ø®Ø§Ø¯Ù… Ø§Ø¹ØªÙ…Ø§Ø¯
    // Ø¨ØµÙ…ØªÙ‡ Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©. Ø§Ù„ØªØ­Ù‚Ù‚ Ø£Ø¹Ù„Ø§Ù‡ Ø£ØµØ¨Ø­ Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø©: Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ù‚Ø¯ÙŠÙ… ÙŠÙØ±ÙØ¶ Ù‡Ù†Ø§ÙƒØŒ
    // ÙˆØ§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ø§Ù„Ù…Ø³Ù…ÙˆØ­ ÙŠÙÙƒÙ…Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø«Ù… ØªÙØ­Ø¯Ù‘Ø« Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ø¬Ù„Ø³ØªÙ‡ Ù…Ø­Ù„ÙŠØ§Ù‹.
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
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ØªØ¹Ø°Ø± ØªØ´ØºÙŠÙ„ SEB</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}.box{width:min(560px,calc(100vw - 32px));background:white;border:1px solid #e2e8f0;border-radius:24px;padding:28px;box-shadow:0 24px 70px rgba(15,23,42,.12)}h1{font-size:24px;margin:0 0 12px}p{line-height:1.8;color:#475569}.back{display:inline-flex;margin-top:16px;background:#1e1b4b;color:white;text-decoration:none;border-radius:16px;padding:12px 18px;font-weight:800}</style></head><body><main class="box"><h1>ØªØ¹Ø°Ø± ØªØ´ØºÙŠÙ„ Safe Exam Browser</h1><p>${xmlEscape(launched.error)}</p><a class="back" href="/">Ø§Ù„Ø±Ø¬ÙˆØ¹ Ø¥Ù„Ù‰ Ù…Ø±Ø§Ø³</a></main></body></html>`,
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
      "Ù„Ø§ ÙŠÙ…ÙƒÙ† ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù…Ù† Ù…Ù„Ù SEB Ø¹Ø§Ù…. Ø§ÙØªØ­ Ø­Ø³Ø§Ø¨Ùƒ ÙÙŠ Ù…ÙØ±Ø§Ø³ Ù…Ù† Ø¬Ù‡Ø§Ø²Ùƒ Ø§Ù„Ù…ÙØ¹Ù‘Ù„ Ø«Ù… Ø§Ø¶ØºØ· Ø²Ø± ØªØ´ØºÙŠÙ„ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¹Ø¨Ø± SEB Ù„ÙŠØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø¬Ù„Ø³Ø© Ø®Ø§ØµØ© Ø¨Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.",
    );
  }
  if (!pass || pass.status === "closed")
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "Ø±Ø§Ø¨Ø· ØªØ´ØºÙŠÙ„ SEB ØºÙŠØ± ØµØ§Ù„Ø­ Ø£Ùˆ Ù…Ù†ØªÙ‡ÙŠ.",
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
<title>ØªØ¹Ø°Ø± ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:22px;box-sizing:border-box}.box{max-width:560px;text-align:center;padding:32px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(255,255,255,.06)}h1{font-size:22px;margin:0 0 12px}p{line-height:1.8;color:#cbd5e1;font-size:14px}.pass{display:inline-block;margin-top:12px;border-radius:14px;background:rgba(255,255,255,.1);padding:10px 16px;font-size:22px;font-weight:900;letter-spacing:1px}a.btn{display:inline-flex;margin-top:18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:16px;padding:12px 22px;font-weight:900;font-size:14px}</style>
</head>
<body>
<div class="box"><h1>ØªØ¹Ø°Ø± ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†</h1><p>${xmlEscape(message)}</p><p>Ø¥Ø°Ø§ Ø¨Ù‚ÙŠØª Ø¯Ø§Ø®Ù„ SEB Ø§Ø³ØªØ®Ø¯Ù… ÙƒÙ„Ù…Ø© Ø§Ù„Ø®Ø±ÙˆØ¬ Ù„Ø¯Ù‰ Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨:</p><span class="pass">Miras</span>${quitUrl ? `<br><a class="btn" href="${xmlEscape(quitUrl)}">Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ø¬Ù„Ø³Ø© ÙˆØ§Ù„Ø®Ø±ÙˆØ¬ Ù…Ù† SEB</a>` : ""}</div>
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
    rejectSebPass(req, pass, "Ø±Ø§Ø¨Ø· Ø¬Ù„Ø³Ø© SEB ØºÙŠØ± ØµØ§Ù„Ø­ Ø£Ùˆ Ù…Ù†ØªÙ‡ÙŠ Ø¹Ù†Ø¯ /seb/start.");
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "Ø±Ø§Ø¨Ø· Ø¬Ù„Ø³Ø© SEB ØºÙŠØ± ØµØ§Ù„Ø­ Ø£Ùˆ Ù…Ù†ØªÙ‡ÙŠ. Ø§Ø·Ù„Ø¨ Ù…Ù† Ø§Ù„Ø£Ø³ØªØ§Ø° ÙØªØ­ Ù…Ø­Ø§ÙˆÙ„Ø© Ø¬Ø¯ÙŠØ¯Ø©ØŒ Ø«Ù… Ø§Ø¶ØºØ· Ø²Ø± ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù…Ù† Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø£ØµÙ„ÙŠ Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø© ÙÙ‚Ø·.",
    );
  }
  if (pass.status !== "launch" && pass.status !== "active") {
    rejectSebPass(
      req,
      pass,
      `Ù…Ø­Ø§ÙˆÙ„Ø© Ø¥Ø¹Ø§Ø¯Ø© Ø§Ø³ØªØ®Ø¯Ø§Ù… startURL Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø­Ø§Ù„ØªÙ‡Ø§ ${pass.status}.`,
    );
    return sendSebStartError(
      req,
      res,
      409,
      pass,
      "ØªÙ… Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø±Ø§Ø¨Ø· ØªØ´ØºÙŠÙ„ SEB Ù„Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø³Ø§Ø¨Ù‚Ø§Ù‹. Ø§Ø·Ù„Ø¨ Ù…Ø­Ø§ÙˆÙ„Ø© Ø¬Ø¯ÙŠØ¯Ø© Ù…Ù† Ø§Ù„Ø£Ø³ØªØ§Ø° Ø¥Ø°Ø§ Ø§Ø­ØªØ¬Øª Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.",
    );
  }
  const student = dbInstance
    .getStudents()
    .find((s: any) => String(s.id) === String(pass.studentId));
  const exam = dbInstance
    .getTeacherExams()
    .find((item: any) => String(item.id) === String(pass.examId));
  const teacherAuthorizedSebReturn = student
    ? hasTeacherAuthorizedSebReturnException(pass.examId, student.id)
    : false;
  if (
    !student ||
    !exam ||
    String(exam.courseCode || "").toLowerCase() !==
      String(pass.courseCode || "").toLowerCase() ||
    (!studentHasEnrollmentInCourse(student, pass.courseCode) &&
      !teacherAuthorizedSebReturn)
  ) {
    closeSebAttempt(pass, "invalid-binding-at-start");
    rejectSebPass(
      req,
      pass,
      "ÙØ´Ù„ Ø±Ø¨Ø· Ø¬Ù„Ø³Ø© SEB Ø¨Ø§Ù„Ø·Ø§Ù„Ø¨/Ø§Ù„Ù…Ù‚Ø±Ø±/Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¹Ù†Ø¯ start.",
    );
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "Ø¬Ù„Ø³Ø© SEB Ù„Ø§ ØªØ·Ø§Ø¨Ù‚ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø£Ùˆ Ø§Ù„Ù…Ù‚Ø±Ø± Ø£Ùˆ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.",
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
        "Ø­Ø§ÙˆÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø±Ø¬ÙˆØ¹ Ø¥Ù„Ù‰ Ø§Ø®ØªØ¨Ø§Ø± Ø³Ø¨Ù‚ Ø£Ù† Ø¸Ù‡Ø±Øª Ù„Ù‡ Ø£Ø³Ø¦Ù„ØªÙ‡ ÙˆÙ„Ù… ÙŠØ³Ù„Ù‘Ù…Ù‡Ø› ØªÙ… ØªØ«Ø¨ÙŠØª Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„ØªÙŠ ÙˆØµÙ„ Ù„Ù‡Ø§.",
    });
    closeSebAttempt(pass, "attempt-already-started-closed");
    return sendSebStartError(
      req,
      res,
      409,
      pass,
      "ØªÙ… ÙØªØ­ Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø³Ø§Ø¨Ù‚Ø§Ù‹ ÙˆØ¸Ù‡Ø±Øª Ø£Ø³Ø¦Ù„ØªÙ‡ØŒ Ù„Ø°Ù„Ùƒ Ø£ØºÙ„Ù‚Øª Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© ÙˆØ±ÙØµØ¯Øª Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„ØªÙŠ ÙˆØµÙ„Øª Ù„Ù‡Ø§. ÙŠØ³ØªØ·ÙŠØ¹ Ø§Ù„Ø£Ø³ØªØ§Ø° ÙÙ‚Ø· Ø¥Ø±Ø¬Ø§Ø¹ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¥Ø°Ø§ Ù‚Ø±Ø± Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ù…Ø­Ø§ÙˆÙ„Ø© Ø¬Ø¯ÙŠØ¯Ø©.",
    );
  }
  // Do NOT consume the pass here. The student is still on the warning screen
  // and hasn't actually started the exam yet. /api/seb/validate (called when the
  // real exam page loads after the student presses 'Ø¨Ø¯Ø¡ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±') will consume it.
  logSebEvent({
    studentId: student.id,
    studentName: student.name,
    action: "Ø¹Ø±Ø¶ Ø´Ø§Ø´Ø© Ø§Ù„ØªØ­Ø°ÙŠØ± Ù‚Ø¨Ù„ Ø¨Ø¯Ø¡ SEB",
    details: `ØªÙ… ÙØªØ­ startURL Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø± ${pass.examId} ÙÙŠ Ù…Ù‚Ø±Ø± ${pass.courseCode} ÙˆØ¹Ø±Ø¶ Ø´Ø§Ø´Ø© Ø§Ù„ØªØ£ÙƒÙŠØ¯ Ù„Ù„Ø·Ø§Ù„Ø¨.`,
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
    rejectSebPass(req, pass, "ÙØ´Ù„ validate: token ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ Ø£Ùˆ Ù…ØºÙ„Ù‚.");
    return res.status(403).json({ error: "Ø¬Ù„Ø³Ø© SEB ØºÙŠØ± ØµØ§Ù„Ø­Ø© Ø£Ùˆ Ù…Ù†ØªÙ‡ÙŠØ©." });
  }
  if (pass.status === "launch") {
    // The official SEB configuration now points directly to the exam app URL.
    // Therefore the first validation request from the SEB WebView is the exact
    // moment when the launch token must become an active exam tunnel.
    if (!hasActualSebRuntimeHint(req)) {
      rejectSebPass(req, pass, "ÙØ´Ù„ validate: token Ù„Ù… ÙŠØµÙ„ Ù…Ù† Ø³ÙŠØ§Ù‚ SEB.");
      return res
        .status(409)
        .json({ error: "Ø§ÙØªØ­ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ù…Ù† ØªØ·Ø¨ÙŠÙ‚ Safe Exam Browser Ø£ÙˆÙ„Ø§Ù‹." });
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
    rejectSebPass(req, pass, "ÙØ´Ù„ validate: Ø§Ù„Ø·Ø§Ù„Ø¨ Ø£Ùˆ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.");
    return res
      .status(404)
      .json({ error: "ØªØ¹Ø°Ø± Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø£Ùˆ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ù…Ø±ØªØ¨Ø· Ø¨Ø¬Ù„Ø³Ø© SEB." });
  }
  if (
    String(exam.courseCode || "").toLowerCase() !==
    String(pass.courseCode || "").toLowerCase()
  ) {
    rejectSebPass(req, pass, "ÙØ´Ù„ validate: Ø§Ù„Ù…Ù‚Ø±Ø± Ù„Ø§ ÙŠØ·Ø§Ø¨Ù‚ Ù…Ù‚Ø±Ø± Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.");
    return res.status(403).json({ error: "Ø¬Ù„Ø³Ø© SEB Ù„Ø§ ØªØ·Ø§Ø¨Ù‚ Ù…Ù‚Ø±Ø± Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±." });
  }
  const teacherAuthorizedSebReturn = hasTeacherAuthorizedSebReturnException(
    exam.id,
    student.id,
  );
  if (
    !studentHasEnrollmentInCourse(student, pass.courseCode) &&
    !teacherAuthorizedSebReturn
  ) {
    rejectSebPass(req, pass, "ÙØ´Ù„ validate: Ø§Ù„Ù…Ù‚Ø±Ø± ØºÙŠØ± Ù…ÙØ¹Ù„ Ø¨Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„Ø£ØµÙ„ÙŠ.");
    return res
      .status(403)
      .json({ error: "Ø§Ù„Ù…Ù‚Ø±Ø± ØºÙŠØ± Ù…ÙØ¹Ù„ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„Ø£ØµÙ„ÙŠ." });
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
        action: "Ø§Ø³ØªÙ…Ø±Ø§Ø± Ù†ÙÙ‚ SEB",
        details: teacherAuthorizedSebReturn
          ? `ØªÙ… Ø§Ù„Ø³Ù…Ø§Ø­ Ù„Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ø§Ù‹ Ø¥Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø¹Ø¨Ø± ØªØµØ±ÙŠØ­ Ø¥Ø±Ø¬Ø§Ø¹ Ù…Ù† Ø§Ù„Ù…Ø¹Ù„Ù… Ø¯ÙˆÙ† ÙƒØ³Ø± Ø¨ÙˆØ§Ø¨Ø© SEB.`
          : `ØªÙ… Ø§Ø³ØªÙƒÙ…Ø§Ù„ Ù†ÙØ³ Ù…Ø­Ø§ÙˆÙ„Ø© SEB Ø§Ù„Ù†Ø´Ø·Ø© Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø± ${pass.examId} Ø¯ÙˆÙ† ÙØªØ­ Ù…Ø­Ø§ÙˆÙ„Ø© Ø¬Ø¯ÙŠØ¯Ø©.`,
        req,
      });
      return res.json({
        success: true,
        student: {
          ...student,
          authToken: createStudentAuthPayload(req, res, student),
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
        "Ø§Ù†Ù‚Ø·Ø¹Øª Ø£Ùˆ Ø£ÙØ¹ÙŠØ¯Øª Ø¬Ù„Ø³Ø© SEB Ø¨Ø¹Ø¯ Ø¸Ù‡ÙˆØ± Ø§Ù„Ø£Ø³Ø¦Ù„Ø© ÙˆÙ‚Ø¨Ù„ Ø§Ù„ØªØ³Ù„ÙŠÙ…Ø› ØªÙ… ØªØ«Ø¨ÙŠØª Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„ØªÙŠ ÙˆØµÙ„ Ù„Ù‡Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨.",
    });
    closeSebAttempt(pass, "started-attempt-reopened-closed");
    return res
      .status(409)
      .json({
        error:
          "ØªÙ… ÙØªØ­ Ù‡Ø°Ø§ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø³Ø§Ø¨Ù‚Ø§Ù‹ ÙˆØ¸Ù‡Ø±Øª Ø£Ø³Ø¦Ù„ØªÙ‡ØŒ Ù„Ø°Ù„Ùƒ Ø£ØºÙ„Ù‚Øª Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© ÙˆØ±ÙØµØ¯Øª Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„ØªÙŠ ÙˆØµÙ„Øª Ù„Ù‡Ø§. ÙŠØ³ØªØ·ÙŠØ¹ Ø§Ù„Ø£Ø³ØªØ§Ø° ÙÙ‚Ø· Ø¥Ø±Ø¬Ø§Ø¹ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±.",
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
          "Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ù‚ÙÙ„Ø© ÙˆÙ„Ø§ ÙŠÙ…ÙƒÙ† ÙØªØ­Ù‡Ø§ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰ Ø¥Ù„Ø§ Ø¥Ø°Ø§ Ø£Ø¹Ø§Ø¯Ù‡Ø§ Ø§Ù„Ø£Ø³ØªØ§Ø°.",
        submission: existingAttempt,
      });
  }
  logSebEvent({
    studentId: student.id,
    studentName: student.name,
    action: "ØªÙØ¹ÙŠÙ„ Ù†ÙÙ‚ SEB",
    details: `ØªÙ… ØªØ­ÙˆÙŠÙ„ Ø±Ø§Ø¨Ø· SEB Ø¥Ù„Ù‰ Ù…Ø­Ø§ÙˆÙ„Ø© Ù†Ø´Ø·Ø© Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø± ${pass.examId} ÙÙŠ Ù…Ù‚Ø±Ø± ${pass.courseCode}.`,
    req,
  });
  return res.json({
    success: true,
    student: {
      ...student,
      authToken: createStudentAuthPayload(req, res, student),
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
  // Ø¥ØºÙ„Ø§Ù‚ Ø±Ø§Ø¨Ø· Ø§Ù„Ø®Ø±ÙˆØ¬ Ù„Ø§ ÙŠØ³Ø¬Ù„ Ø§Ù†Ø³Ø­Ø§Ø¨Ø§Ù‹ Ø¥Ù„Ø§ Ø¥Ø°Ø§ ÙƒØ§Ù†Øª Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø¨Ø¯Ø£Øª ÙØ¹Ù„ÙŠØ§Ù‹.
  // Ø¥Ø°Ø§ ÙƒØ§Ù†Øª Ø§Ù„Ø¬Ù„Ø³Ø© launch ÙÙ‚Ø· ÙÙ„Ù† ÙŠØ¬Ø¯ flagExamExitedBeforeSubmit Ø£ÙŠ Ù…Ø­Ø§ÙˆÙ„Ø© started
  // Ø£Ùˆ ØµÙ "Ù‚ÙŠØ¯ Ø§Ù„Ø­Ù„"ØŒ Ù„Ø°Ù„Ùƒ ÙŠØ¨Ù‚Ù‰ Ø®Ø±ÙˆØ¬Ø§Ù‹ Ø¢Ù…Ù†Ø§Ù‹ Ù‚Ø¨Ù„ Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©.
  if (pass) closeSebAttempt(pass, "explicit-quit-url");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Ø§Ù„Ø®Ø±ÙˆØ¬ Ù…Ù† SEB</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#020617;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:560px;text-align:center;padding:32px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(255,255,255,.06)}.pass{display:inline-block;margin-top:12px;border-radius:14px;background:rgba(255,255,255,.1);padding:10px 16px;font-size:22px;font-weight:900;letter-spacing:1px}a{color:#a5b4fc;font-weight:800}</style></head><body><div class="box"><h1>ØªÙ… Ø¥ØºÙ„Ø§Ù‚ Ø¬Ù„Ø³Ø© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø¢Ù…Ù†</h1><p>Ø¥Ø°Ø§ Ù„Ù… ÙŠÙØºÙ„Ù‚ Safe Exam Browser ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ØŒ Ø§Ø³ØªØ®Ø¯Ù… Ø²Ø± Ø§Ù„Ø®Ø±ÙˆØ¬ Ø§Ù„Ø¢Ù…Ù† Ø¯Ø§Ø®Ù„ Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬ Ø£Ùˆ Ø£Ø¨Ù„Øº Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨.</p><p>ÙƒÙ„Ù…Ø© Ø§Ù„Ø®Ø±ÙˆØ¬:</p><span class="pass">Miras</span></div></body></html>`,
  );
});

function sendSebConfig(req: express.Request, res: express.Response) {
  const token = getSebConfigTokenFromRequest(req);
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed")
    return res
      .status(403)
      .send(
        "Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥Ù†Ø´Ø§Ø¡ Ù…Ù„Ù SEB Ø¥Ù„Ø§ Ù…Ù† Ø¬Ù„Ø³Ø© Ø§Ø®ØªØ¨Ø§Ø± Ù…Ø¤Ù‚ØªØ© ØµØ§Ù„Ø­Ø© ØªÙ… Ø¥Ø·Ù„Ø§Ù‚Ù‡Ø§ Ù…Ù† Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø£ØµÙ„ÙŠ.",
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
  <key>hashedQuitPassword</key><string>1528bd95aeb38eeb741061e63d8d9f89d993e03381f0e64090d7f81851d53f1e</string>
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
  <key>browserMediaCaptureCamera</key><true/>
  <key>browserMediaCaptureMicrophone</key><false/>
  <key>browserMediaCaptureScreen</key><false/>
  <key>URLFilterEnable</key><true/>
  <key>URLFilterEnableContentFilter</key><true/>
  <key>URLFilterRules</key>
  <array>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>${xmlEscape(urlHostPattern)}</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://fonts.googleapis.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://fonts.gstatic.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://*.googleapis.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://*.gstatic.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://*.firebaseapp.com/*</string><key>regex</key><false/></dict>
    <dict><key>active</key><true/><key>action</key><integer>1</integer><key>expression</key><string>https://*.firebaseio.com/*</string><key>regex</key><false/></dict>
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
        ? "Ø¬Ù„Ø³Ø© Ø§Ù„Ø£Ø³ØªØ§Ø° ØºÙŠØ± ØµØ§Ù„Ø­Ø©."
        : "Ø¬Ù„Ø³Ø© Ø§Ù„Ø·Ø§Ù„Ø¨ ØºÙŠØ± ØµØ§Ù„Ø­Ø©.",
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
        .json({ error: "Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨." });
      return null;
    }
    return session;
  }
  if (session.role !== "teacher" && session.role !== "admin") {
    res
      .status(403)
      .json({ error: "Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ø£Ø³ØªØ§Ø°." });
    return null;
  }
  const sessionEmail = String(session.email || session.userId || "")
    .trim()
    .toLowerCase();
  if (userId && sessionEmail !== String(userId).trim().toLowerCase()) {
    res
      .status(403)
      .json({ error: "Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨." });
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
    return res.status(400).json({ error: "Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª ØºÙŠØ± Ù…ÙƒØªÙ…Ù„Ø©." });
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
      .json({ error: "Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø±Ø¨Ø· Ø§Ù„ØªÙˆÙƒÙ† Ø¨Ø­Ø³Ø§Ø¨ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ." });
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
  // Ù‚Ù†Ø§Ø© Ø¯ÙØ¹ ÙˆØ§Ø­Ø¯Ø© Ù„ÙƒÙ„ Ø­Ø³Ø§Ø¨: Ø¬Ø±Ø³ Ù…ÙØ±Ø§Ø³ Ù†ÙØ³Ù‡ Ù…ØªØ²Ø§Ù…Ù† Ø¹Ù„Ù‰ ÙƒÙ„ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø©ØŒ Ø£Ù…Ø§ Ø¨Ø§Ù†Ø±
  // Ø§Ù„Ù†Ø¸Ø§Ù… ÙÙŠØ®Ø±Ø¬ Ø¥Ù„Ù‰ Ø£Ø­Ø¯Ø« Ø¬Ù‡Ø§Ø²/ØªØ«Ø¨ÙŠØª ÙÙ‚Ø·. Ø¥Ø¨Ù‚Ø§Ø¡ Safari ÙˆPWA Ø£Ùˆ Ø§Ø®ØªÙ„Ø§Ù Ø­Ø§Ù„Ø© Ø£Ø­Ø±Ù
  // Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø£Ø³ØªØ§Ø° ÙƒØªÙˆÙƒÙÙ†ÙŠÙ† Ù†Ø´Ø·ÙŠÙ† ÙƒØ§Ù† ÙŠØµÙ†Ø¹ Ø¨Ø§Ù†Ø±ÙŠÙ† Ù…ØªØ·Ø§Ø¨Ù‚ÙŠÙ† Ù„Ù„Ø­Ø¯Ø« Ù†ÙØ³Ù‡.
  try {
    const savedIdentity =
      saved.role === "student"
        ? normalizeStudentId(saved.userId)
        : String(saved.userId || saved.teacherEmail || "")
            .trim()
            .toLowerCase();
    dbInstance
      .getNotificationTokens()
      .filter((t: any) => {
        const tokenIdentity =
          String(t.role || "") === "student"
            ? normalizeStudentId(t.userId)
            : String(t.userId || t.teacherEmail || "")
                .trim()
                .toLowerCase();
        return (
          !t.disabledAt &&
          String(t.role || "") === String(saved.role || "") &&
          tokenIdentity === savedIdentity &&
          String(t.token) !== token
        );
      })
      .forEach((t: any) =>
        dbInstance.disableNotificationToken(t.token, t.userId),
      );
  } catch {}
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
      error: "Ø¬Ù„Ø³Ø© Ø§Ù„Ø­Ø³Ø§Ø¨ ØºÙŠØ± ØµØ§Ù„Ø­Ø©.",
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
      .json({ error: "Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© ÙØµÙ„ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨." });
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
    /ØªØ­Ø¯ÙŠØ« Ù…Ù‚Ø±Ø±|ØªØ­Ø¯ÙŠØ« Ø§Ø®ØªØ¨Ø§Ø±|ØªØ­Ø¯ÙŠØ« Ù…Ø´Ø±ÙˆØ¹|ØªØºÙŠÙŠØ± Ø§Ø³Ù…|ØªØ¹Ø¯ÙŠÙ„ Ø§Ø³Ù…|ØªÙ… ØªØ­Ø¯ÙŠØ«|ØªÙ… ØªØ¹Ø¯ÙŠÙ„/i.test(text);
  const meaningfulForStudent =
    /Ø§Ø®ØªØ¨Ø§Ø± Ø¬Ø¯ÙŠØ¯|Ù…Ø´Ø±ÙˆØ¹ Ø¬Ø¯ÙŠØ¯|ØªÙ†Ø¨ÙŠÙ‡ Ø§Ø®ØªØ¨Ø§Ø±|Ø§Ø®ØªØ¨Ø§Ø± Ù…ØªØ§Ø­|Ù…ÙˆØ¹Ø¯|Ø±Ø²Ù†Ø§Ù…Ø©|ØªÙ‚ÙˆÙŠÙ…|Ø¥Ø¹Ù„Ø§Ù†|Ø¹Ø§Ù…|ØªØ³Ù„ÙŠÙ…|Ù…Ø·Ù„ÙˆØ¨|ÙˆØ§Ø¬Ø¨|Ø¯Ø±Ø¬Ø©|Ù†Ø´Ø±|ÙØªØ­|Ø¥ØºÙ„Ø§Ù‚|Ø§ØºÙ„Ø§Ù‚|Ù‚Ø¨ÙˆÙ„|Ø±ÙØ¶|Ø¥Ø±Ø¬Ø§Ø¹|Ø§Ø±Ø¬Ø§Ø¹/i.test(text);
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
      // Ø£Ø­Ø¯Ø§Ø« Ù…Ù‚Ø±Ø± Ù…Ù‡Ù…Ù‘Ø© Ù„Ù„Ø·Ø§Ù„Ø¨ ÙƒØ§Ù† Ø§Ù„Ø®Ø§Ø¯Ù… ÙŠÙÙ†Ø´Ø¦Ù‡Ø§ (Ø§Ø®ØªØ¨Ø§Ø±/Ù…Ø´Ø±ÙˆØ¹ Ø¬Ø¯ÙŠØ¯ØŒ Ù…ÙˆØ¹Ø¯ØŒ
      // Ø¥Ù„ØºØ§Ø¡) Ù„ÙƒÙ†Ù‡Ø§ Ù„Ø§ ØªØµÙ„ Ø§Ù„Ø¬Ø±Ø³ Ù„Ø£Ù† Ù†ÙˆØ¹Ù‡Ø§ Ù„Ù… ÙŠÙƒÙ† Ù…ÙØ¯Ø±Ø¬Ø§Ù‹ Ù‡Ù†Ø§ â€” ØªØ¹Ø§Ø±Ø¶ Ù…Ø¹ Ù‚Ø§Ø¦Ù…Ø©
      // importantTypes ÙÙŠ shouldSuppressRoutineStudentNotification Ø§Ù„ØªÙŠ ØªØ¹ØªØ¨Ø±Ù‡Ø§
      // Ù…Ù‡Ù…Ù‘Ø©. Ù…Ø«Ø§Ù„ Ø«Ø§Ø¨Øª: "Ø§Ø®ØªØ¨Ø§Ø± Ø¬Ø¯ÙŠØ¯ Ù…ØªØ§Ø­" (Ø§Ù„Ù†ÙˆØ¹ exam_available) ÙƒØ§Ù† ÙŠØ³Ù‚Ø· Ù„Ø£Ù†
      // Ø§Ù„Ù†ÙˆØ¹ ØºÙŠØ± Ù…ÙØ¯Ø±Ø¬ ÙˆØ§Ù„Ù†Øµ Ù„Ø§ ÙŠØ·Ø§Ø¨Ù‚ "Ø§Ø®ØªØ¨Ø§Ø± Ù…ØªØ§Ø­" (ØªÙØµÙ„ Ø¨ÙŠÙ†Ù‡Ù…Ø§ ÙƒÙ„Ù…Ø© "Ø¬Ø¯ÙŠØ¯").
      // Ø¥Ø¶Ø§ÙØªÙ‡Ø§ ØªÙØµÙ„Ø­ Ø§Ù„ÙˆØµÙˆÙ„ Ø¯ÙˆÙ† ÙØªØ­ Ø¨Ø§Ø¨ Ø§Ù„Ø¶Ø¬ÙŠØ¬ Ø§Ù„Ø¥Ø¯Ø§Ø±ÙŠ: ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø£Ø³Ù…Ø§Ø¡/Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§
      // ÙŠØ¨Ù‚Ù‰ Ù…ÙƒØªÙˆÙ…Ø§Ù‹ Ø¹Ø¨Ø± ÙØ­Øµ routineEdit Ø£Ø¹Ù„Ø§Ù‡ ÙˆÙ‚ÙˆØ§Ø¦Ù… Ø§Ù„ÙƒØªÙ… Ø§Ù„Ø£Ø®Ø±Ù‰.
      "exam_available",
      "exam_new",
      "new_exam",
      "exam_open",
      "exam_published",
      "project_available",
      "project_new",
      "new_project",
      "assignment_due",
      "submission_due",
      "deadline",
      "deadline_soon",
      "due_soon",
      "exam_cancelled",
      "exam_canceled",
      "project_cancelled",
      "project_canceled",
      "activity_cancelled",
      "calendar_event_deleted",
    ].includes(type)
  )
    return true;
  if (/ØªÙ†Ø¨ÙŠÙ‡ Ø§Ø®ØªØ¨Ø§Ø±|Ø§Ø®ØªØ¨Ø§Ø±\s+(Ø¬Ø¯ÙŠØ¯|Ù…ØªØ§Ø­)|Ù…Ø´Ø±ÙˆØ¹\s+Ø¬Ø¯ÙŠØ¯|Ù…ÙˆØ¹Ø¯|Ø±Ø²Ù†Ø§Ù…Ø©|ØªÙ‚ÙˆÙŠÙ…|Ø¥Ø¹Ù„Ø§Ù†|Ø¹Ø§Ù…/i.test(text))
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
    /Ø¯Ø±Ø¬Ø©|Ù…Ø±ØµÙˆØ¯Ø©|Ø±ØµØ¯|ØªØ³Ù„ÙŠÙ…|Ù…Ø­Ø§ÙˆÙ„Ø© ØºØ´|ØºØ´|Ø®Ø±ÙˆØ¬ Ù‚Ø¨Ù„ Ø§Ù„ØªØ³Ù„ÙŠÙ…|Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø©|Ø§Ø³ØªØ±Ø¬Ø§Ø¹ ÙƒÙ„Ù…Ø©|ÙØ¹Ù‘Ù„ Ù…Ù‚Ø±Ø±|ØªØ³Ø¬ÙŠÙ„ Ø·Ø§Ù„Ø¨/i.test(text)
  );
}

// Ù…Ø²Ø§Ù…Ù†Ø© Ø­Ø§Ù„Ø© "Ù…Ù‚Ø±ÙˆØ¡" Ø¹Ø¨Ø± Ø§Ù„Ø£Ø¬Ù‡Ø²Ø©: ÙŠØ®Ø²Ù‘Ù† Ø§Ù„Ø®Ø§Ø¯Ù… Ù…ÙØ§ØªÙŠØ­ Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡Ø§Øª Ø§Ù„Ù…Ù‚Ø±ÙˆØ¡Ø© Ù„ÙƒÙ„
// Ù…Ø³ØªØ®Ø¯Ù… ÙØªØªØ·Ø§Ø¨Ù‚ Ø¨ÙŠÙ† Ø§Ù„Ù‡Ø§ØªÙ ÙˆØ§Ù„ÙƒÙ…Ø¨ÙŠÙˆØªØ± (Ø´ÙƒÙˆÙ‰ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…: Ù‚Ø±Ø£ØªÙ‡Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ù‡Ø§ØªÙ ÙØ±Ø¬Ø¹Øª
// ØºÙŠØ± Ù…Ù‚Ø±ÙˆØ¡Ø© Ø¹Ù„Ù‰ Ø§Ù„ÙƒÙ…Ø¨ÙŠÙˆØªØ±).
function notificationSeenUserKey(role: string, userId: string) {
  return `${String(role || "").toLowerCase()}:${String(userId || "").toLowerCase()}`;
}
app.get("/api/notifications/seen", (req, res) => {
  const userId = String(req.query.userId || "").trim();
  const role = String(req.query.role || "").trim();
  if (!userId || !role)
    return res.status(400).json({ error: "Ø¨ÙŠØ§Ù†Ø§Øª ØµÙ†Ø¯ÙˆÙ‚ Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù†Ø§Ù‚ØµØ©." });
  if (!requireNotificationIdentity(req, res, userId, role)) return;
  return res.json({
    success: true,
    seenKeys: dbInstance.getNotificationSeenKeys(
      notificationSeenUserKey(role, userId),
    ),
  });
});
app.post("/api/notifications/mark-seen", (req, res) => {
  const userId = String(req.body?.userId || "").trim();
  const role = String(req.body?.role || "").trim();
  const keys = Array.isArray(req.body?.keys)
    ? req.body.keys.map((k: any) => String(k || "")).filter(Boolean).slice(0, 400)
    : [];
  if (!userId || !role)
    return res.status(400).json({ error: "Ø¨ÙŠØ§Ù†Ø§Øª ØµÙ†Ø¯ÙˆÙ‚ Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù†Ø§Ù‚ØµØ©." });
  if (!requireNotificationIdentity(req, res, userId, role)) return;
  const uk = notificationSeenUserKey(role, userId);
  const merged = Array.from(
    new Set([...dbInstance.getNotificationSeenKeys(uk), ...keys]),
  );
  dbInstance.saveNotificationSeenKeys(uk, merged);
  return res.json({ success: true, seenKeys: dbInstance.getNotificationSeenKeys(uk) });
});
// â•â•â• Ø±Ø§Ø¯Ø§Ø± Ù…ÙØ±Ø§Ø³ ğŸ›°ï¸ â€” Ù…Ø±Ø§Ù‚Ø¨Ø© Ø§Ù„Ø£Ø®Ø·Ø§Ø¡ Ø§Ù„Ù…Ø¯Ù…Ø¬Ø© â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ÙŠÙ„ØªÙ‚Ø· Ø£Ø®Ø·Ø§Ø¡ Ù…ØªØµÙØ­Ø§Øª Ø§Ù„Ø·Ù„Ø¨Ø©/Ø§Ù„Ù…Ø¹Ù„Ù… ÙˆSEB ÙˆØ§Ù„Ø®Ø§Ø¯Ù… ÙÙˆØ± Ø­Ø¯ÙˆØ«Ù‡Ø§ ÙˆÙŠØ¬Ù…Ù‘Ø¹Ù‡Ø§ Ø¨ØªÙˆÙ‚ÙŠØ¹
// (Ù†ÙØ³ Ø§Ù„Ø®Ø·Ø£ Ù…Ù‡Ù…Ø§ ØªÙƒØ±Ø± = Ø¨Ø·Ø§Ù‚Ø© ÙˆØ§Ø­Ø¯Ø© Ø¨Ø¹Ø¯Ù‘Ø§Ø¯) Ù„ÙŠØ±Ø§Ù‡Ø§ Ø§Ù„Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù† Ù‚Ø¨Ù„ Ø£Ù† ÙŠØ´ØªÙƒÙŠ Ø£Ø­Ø¯.
const mirasRadarRateBuckets = new Map<string, { count: number; windowStart: number }>();
function mirasRadarRateOk(ip: string): boolean {
  const now = Date.now();
  const bucket = mirasRadarRateBuckets.get(ip) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > 60 * 60 * 1000) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  mirasRadarRateBuckets.set(ip, bucket);
  if (mirasRadarRateBuckets.size > 3000) mirasRadarRateBuckets.clear();
  return bucket.count <= 40;
}
// ØªÙˆÙ‚ÙŠØ¹ Ø§Ù„ØªØ¬Ù…ÙŠØ¹: Ø§Ù„Ø±Ø³Ø§Ù„Ø© Ù…ÙØ·Ø¨ÙÙ‘Ø¹Ø© (Ø§Ù„Ø£Ø±Ù‚Ø§Ù… ÙˆØ§Ù„Ù‡Ø§Ø´Ø§Øª ØªÙØ³ØªØ¨Ø¯Ù„) + Ø£ÙˆÙ„ Ø³Ø·Ø± Ù…ÙƒØ¯Ù‘Ø³ØŒ
// ÙØªØªØ¬Ù…Ø¹ "Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ø³Ø·Ø± 120" Ùˆ"Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ø³Ø·Ø± 573" Ù„Ù†ÙØ³ Ø§Ù„Ø¹Ù„Ø© ÙÙŠ Ø¨Ø·Ø§Ù‚Ø© ÙˆØ§Ø­Ø¯Ø©.
function mirasErrorSignature(source: string, message: string, stack: string): string {
  const norm = (value: string) =>
    String(value || "")
      .replace(/https?:\/\/[^\s)]+/g, "<url>")
      .replace(/index-[\w-]+\.js/g, "<bundle>")
      .replace(/\d+/g, "#")
      .slice(0, 220);
  const topStack = String(stack || "").split("\n").slice(0, 2).join(" | ");
  return crypto
    .createHash("sha1")
    .update(`${source}|${norm(message)}|${norm(topStack)}`)
    .digest("hex")
    .slice(0, 20);
}
// (Ø¨) Ø§Ø¹ØªØ±Ø§Ø¶ console.error: Ù…Ø¦Ø§Øª ÙƒØªÙ„ catch ØªØ¨ØªÙ„Ø¹ Ø£Ø®Ø·Ø§Ø¡ Ø­Ø±Ø¬Ø© ÙˆØªÙƒØªÙÙŠ Ø¨Ø³Ø·Ø±
// console â€” Ø§Ù„Ø¢Ù† ÙƒÙ„ ÙˆØ§Ø­Ø¯Ø© Ø¨Ø·Ø§Ù‚Ø© Ø±Ø§Ø¯Ø§Ø± (Ø¨Ø­Ø§Ø±Ø³ ØªÙƒØ±Ø§Ø± Ù¥ Ø¯Ù‚Ø§Ø¦Ù‚ ÙˆØ­Ø§Ø±Ø³ Ø§Ø±ØªØ¯Ø§Ø¯ ØµØ§Ø±Ù…).
const mirasConsoleSeen = new Map<string, number>();
let mirasConsoleReporting = false;
const mirasOrigConsoleError = console.error.bind(console);
console.error = (...args: any[]) => {
  mirasOrigConsoleError(...args);
  try {
    if (mirasConsoleReporting) return;
    const first = String(args[0] ?? "").slice(0, 160);
    if (!first || first.includes("monitor/report")) return;
    const now = Date.now();
    const prev = mirasConsoleSeen.get(first);
    if (prev && now - prev < 300_000) return;
    mirasConsoleSeen.set(first, now);
    if (mirasConsoleSeen.size > 300) mirasConsoleSeen.clear();
    mirasConsoleReporting = true;
    mirasRecordServerError(
      `console.error: ${first}`,
      args.slice(1).map((a) => String((a as any)?.message || (a as any)?.stack || a)).join(" | ").slice(0, 1200),
      "console",
    );
  } catch {} finally {
    mirasConsoleReporting = false;
  }
};
// (Ø¬) Ø¥Ù†Ø°Ø§Ø± Ø¶ØºØ· Ø§Ù„Ø°Ø§ÙƒØ±Ø© Ø§Ù„Ù…Ø¨ÙƒØ± (Ø¹Ø´Ù†Ø§ OOM Ø­Ù‚ÙŠÙ‚ÙŠØ§Ù‹): ÙÙˆÙ‚ Ù¡.Ù¦GiB Ù…Ù† Ø³Ù‚Ù 2GiB
// = Ø¨Ø·Ø§Ù‚Ø© ØªØ­Ø°ÙŠØ± Ù‚Ø¨Ù„ Ø£Ù† ÙŠÙ‚ØªÙ„ Cloud Run Ø§Ù„Ø­Ø§ÙˆÙŠØ© â€” Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø© Ù„ÙƒÙ„ Ø¥Ù‚Ù„Ø§Ø¹.
let mirasMemoryWarned = false;
setInterval(() => {
  try {
    const rss = process.memoryUsage().rss;
    if (!mirasMemoryWarned && rss > 1_600_000_000) {
      mirasMemoryWarned = true;
      mirasRecordServerError(
        `Ø¶ØºØ· Ø°Ø§ÙƒØ±Ø©: ${Math.round(rss / 1048576)}MiB Ù…Ù† Ø³Ù‚Ù 2048MiB â€” Ø®Ø·Ø± OOM`,
        "",
        "memory",
      );
    }
  } catch {}
}, 60_000).unref?.();

function mirasRecordServerError(message: string, stack: string, context = "server") {
  try {
    dbInstance.recordErrorReport({
      signature: mirasErrorSignature("server", message, stack),
      message: String(message || "server error").slice(0, 300),
      stack: String(stack || "").slice(0, 1500),
      source: "server",
      url: context,
    });
  } catch {}
}
app.post("/api/monitor/report", (req, res) => {
  const ip = String(req.ip || "0.0.0.0");
  if (!mirasRadarRateOk(ip)) return res.status(429).json({ ok: false });
  const message = String(req.body?.message || "").slice(0, 300).trim();
  if (!message) return res.status(400).json({ ok: false });
  const stack = String(req.body?.stack || "").slice(0, 1500);
  const source = ["client", "seb", "seb-app", "server", "sw"].includes(String(req.body?.source))
    ? String(req.body.source)
    : "client";
  dbInstance.recordErrorReport({
    signature: mirasErrorSignature(source, message, stack),
    message,
    stack,
    source,
    url: String(req.body?.url || "").slice(0, 200),
    role: String(req.body?.role || "").slice(0, 20),
    userId: String(req.body?.userId || "").slice(0, 60),
    browser: browserFamilyFromUserAgent(req.headers["user-agent"] || ""),
    displayMode: String(req.headers["x-miras-display-mode"] || req.body?.displayMode || "").slice(0, 12),
    bundle: String(req.body?.bundle || "").slice(0, 30),
  });
  return res.json({ ok: true });
});
function mirasRadarAdminGate(req: express.Request, res: express.Response): boolean {
  const email = teacherEmailFromRequest(req);
  if (!email || !isAdminEmail(email)) {
    res.status(403).json({ error: "Ù‡Ø°Ù‡ Ø§Ù„Ù„ÙˆØ­Ø© Ù„Ù„Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù† ÙÙ‚Ø·." });
    return false;
  }
  return true;
}
app.get("/api/monitor/errors", (req, res) => {
  if (!mirasRadarAdminGate(req, res)) return;
  const items = dbInstance
    .getErrorReports()
    .slice()
    .sort(
      (a: any, b: any) =>
        new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime(),
    );
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const active = items.filter((r: any) => !r.resolvedAt);
  return res.json({
    success: true,
    items,
    stats: {
      active: active.length,
      resolved: items.length - active.length,
      last24h: active.filter((r: any) => new Date(r.lastSeenAt || 0).getTime() > dayAgo).length,
      server: active.filter((r: any) => r.source === "server").length,
      client: active.filter((r: any) => r.source === "client").length,
      seb: active.filter((r: any) => String(r.source).startsWith("seb")).length,
      totalHits: active.reduce((sum: number, r: any) => sum + Number(r.count || 1), 0),
    },
  });
});
app.get("/api/monitor/notification-audit", (req, res) => {
  if (!mirasRadarAdminGate(req, res)) return;
  flushNotificationAuditPending();
  const items = dbInstance
    .getNotificationAudit()
    .slice()
    .sort(
      (a: any, b: any) =>
        new Date(b.updatedAt || b.lastSeenAt || 0).getTime() -
        new Date(a.updatedAt || a.lastSeenAt || 0).getTime(),
    )
    .slice(0, 200);
  const activeTokens = dbInstance
    .getNotificationTokens()
    .filter(
      (token: any) =>
        !token?.disabledAt && String(token?.permission || "") === "granted",
    );
  const sent = items.reduce(
    (sum: number, item: any) => sum + Number(item?.sent || 0),
    0,
  );
  const failed = items.reduce(
    (sum: number, item: any) => sum + Number(item?.failed || 0),
    0,
  );
  return res.json({
    success: true,
    items,
    stats: {
      events: items.length,
      sent,
      failed,
      duplicatesBlocked: items.reduce(
        (sum: number, item: any) =>
          sum + Number(item?.duplicatesBlocked || 0),
        0,
      ),
      bellStored: items.reduce(
        (sum: number, item: any) => sum + Number(item?.bellStored || 0),
        0,
      ),
      activeTokens: activeTokens.length,
      activeStudents: new Set(
        activeTokens
          .filter((token: any) => String(token?.role || "") === "student")
          .map((token: any) => String(token?.userId || ""))
          .filter(Boolean),
      ).size,
      successRate:
        sent + failed > 0 ? Math.round((sent / (sent + failed)) * 100) : 100,
    },
  });
});
app.post("/api/monitor/errors/:id/resolve", (req, res) => {
  if (!mirasRadarAdminGate(req, res)) return;
  const ok = dbInstance.resolveErrorReport(
    String(req.params.id),
    teacherEmailFromRequest(req) || "admin",
  );
  return ok ? res.json({ success: true }) : res.status(404).json({ error: "Ø§Ù„ØªÙ‚Ø±ÙŠØ± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯." });
});
app.post("/api/monitor/errors/clear-resolved", (req, res) => {
  if (!mirasRadarAdminGate(req, res)) return;
  return res.json({ success: true, removed: dbInstance.clearResolvedErrorReports() });
});
// Ø§Ù„ØªÙ‚Ø§Ø· Ø£Ø¹Ø·Ø§Ù„ Ø§Ù„Ø®Ø§Ø¯Ù… Ù†ÙØ³Ù‡Ø§: ØªØ³Ø¬ÙŠÙ„ Ø«Ù… Ø§Ù„Ø­ÙØ§Ø¸ Ø¹Ù„Ù‰ Ø³Ù„ÙˆÙƒ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ´ØºÙŠÙ„ Ø§Ù„Ø£ØµÙ„ÙŠ.
process.on("unhandledRejection", (reason: any) => {
  console.error("âš ï¸ Unhandled rejection:", reason?.message || reason);
  mirasRecordServerError(
    `Unhandled rejection: ${reason?.message || String(reason)}`,
    String(reason?.stack || ""),
  );
});
process.on("uncaughtException", (err: any) => {
  console.error("ğŸ’¥ Uncaught exception:", err?.message || err);
  mirasRecordServerError(
    `Uncaught exception: ${err?.message || String(err)}`,
    String(err?.stack || ""),
  );
  // Ù…Ù‡Ù„Ø© Ù‚ØµÙŠØ±Ø© Ù„ØªÙØ±ÙŠØº Ø§Ù„Ø­ÙØ¸ Ø§Ù„Ù…Ø­Ù„ÙŠ Ø«Ù… Ø§Ù„Ø®Ø±ÙˆØ¬ (Cloud Run ÙŠØ¹ÙŠØ¯ Ø§Ù„ØªØ´ØºÙŠÙ„) â€” Ù†ÙØ³
  // Ø³Ù„ÙˆÙƒ Ø§Ù„Ø§Ù†Ù‡ÙŠØ§Ø± Ø§Ù„Ø£ØµÙ„ÙŠ Ù„ÙƒÙ† Ù…Ø¹ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ø±Ø§Ø¯Ø§Ø± Ø£ÙˆÙ„Ø§Ù‹.
  setTimeout(() => process.exit(1), 900);
});

app.get("/api/notifications/inbox", (req, res) => {
  const userId = String(req.query.userId || "").trim();
  const role = String(req.query.role || "student").trim();
  const sectionCode = String(req.query.sectionCode || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "Ù‡ÙˆÙŠØ© ØµÙ†Ø¯ÙˆÙ‚ Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù…Ø·Ù„ÙˆØ¨Ø©." });
  }
  if (!requireNotificationIdentity(req, res, userId, role)) return;
  const since = req.query.since
    ? new Date(String(req.query.since)).getTime()
    : 0;
  // Ù…Ù„Ø§Ø­Ø¸Ø© Ù…Ù‡Ù…Ø©: Ù†Ø³ØªØ®Ø¯Ù… Ù…Ù‚Ø±Ø±Ø§Øª Ø§Ù„Ø§Ù„ØªØ­Ø§Ù‚ Ø§Ù„Ù…ÙƒØªØ´ÙØ© (getStudentDiscoveredCourseCodes) ÙˆÙ„ÙŠØ³
  // Ø§Ù„Ù…Ù‚Ø±Ø±Ø§Øª "Ø§Ù„Ù†Ø´Ø·Ø©" ÙÙ‚Ø·. Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù…Ø¹Ø§Ø¯ ØºØ§Ù„Ø¨Ø§Ù‹ ÙŠÙƒÙˆÙ† ÙÙŠ Ù…Ø¬Ù…ÙˆØ¹Ø© Ù…ØºÙ„Ù‚Ø©/Ù…Ø¤Ø±Ø´ÙØ©ØŒ ÙˆØ¯Ø§Ù„Ø© Ø§Ù„Ù…Ù‚Ø±Ø±Ø§Øª
  // Ø§Ù„Ù†Ø´Ø·Ø© ØªÙØ³Ù‚Ø· Ø§Ù„Ù…Ù‚Ø±Ø±Ø§Øª Ø§Ù„Ù…ØºÙ„Ù‚Ø© ÙˆØ§Ù„Ù…ÙˆÙ‚ÙˆÙØ© â€” ÙÙ„Ùˆ Ø§Ø¹ØªÙ…Ø¯Ù†Ø§ Ø¹Ù„ÙŠÙ‡Ø§ Ù‡Ù†Ø§ Ù„Ø§Ø®ØªÙØª ÙƒÙ„ ØªÙ†Ø¨ÙŠÙ‡Ø§Øª Ø§Ù„Ù…Ø¹Ø§Ø¯
  // Ù…Ù† Ø§Ù„Ø¬Ø±Ø³. Ø¹Ø¶ÙˆÙŠØ© Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª ÙŠØ¬Ø¨ Ø£Ù† ØªÙƒÙˆÙ† Ù…Ù†ÙØµÙ„Ø© Ø¹Ù† ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ø¯Ø®ÙˆÙ„.
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
    // Ø³Ù…Ø§Ø­ÙŠØ© Ø¨Ø³ÙŠØ·Ø© Ø¹Ù†Ø¯ Ø¥Ù†Ø´Ø§Ø¡ ØªÙ†Ø¨ÙŠÙ‡ Ø§Ù„ØªÙØ¹ÙŠÙ„ Ø¨Ø§Ù„ØªØ²Ø§Ù…Ù† Ù…Ø¹ Ø­ÙØ¸ Ø§Ù„ØªØ­Ø§Ù‚ Ø§Ù„Ø·Ø§Ù„Ø¨.
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
      error: "Ø¬Ù„Ø³Ø© Ø§Ù„Ø£Ø³ØªØ§Ø° ØºÙŠØ± ØµØ§Ù„Ø­Ø©.",
      code: "TEACHER_SESSION_REQUIRED",
    });
  }
  const sectionCode = String(
    req.body?.sectionCode || req.body?.courseCode || "",
  ).trim();
  const title = String(req.body?.title || "ØªÙ†Ø¨ÙŠÙ‡ Ù…Ù‚Ø±Ø±").trim();
  const body = String(req.body?.body || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯ ÙÙŠ Ø§Ù„Ù…Ù‚Ø±Ø±.").trim();
  const type = String(req.body?.type || "course").trim();
  if (!sectionCode)
    return res.status(400).json({ error: "Ù„Ù… ÙŠØªÙ… ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…Ù‚Ø±Ø±." });
  const safeTitle = sanitizePublicMessageText(title) || "ØªÙ†Ø¨ÙŠÙ‡ Ù…Ù‚Ø±Ø±";
  const safeBody =
    sanitizePublicMessageText(body) || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯ ÙÙŠ Ø§Ù„Ù…Ù‚Ø±Ø±.";
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Ø§Ù„Ø¹Ù„Ø§Ù…Ø© Ø§Ù„Ù…Ø§Ø¦ÙŠØ© + Ù‚Ù…Ø¹ ØµØ­Ø© Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ + Ø§Ù„ØªØ¬Ù…ÙŠØ¹ Ø§Ù„Ø¬ØºØ±Ø§ÙÙŠ/Ø§Ù„Ø²Ù…Ù†ÙŠ (Ù…ÙŠØ²Ø§Øª Ø¬Ø¯ÙŠØ¯Ø©)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// ØªÙˆÙ‚ÙŠØ¹ Ù‚ØµÙŠØ± ØºÙŠØ± Ù‚Ø§Ø¨Ù„ Ù„Ù„Ø¹ÙƒØ³ ÙŠØ±Ø¨Ø· ÙƒÙ„ ÙƒÙˆØ¯ Ø¨Ù‡ÙˆÙŠØ© Ø§Ù„Ø·Ø§Ù„Ø¨ â€” ÙŠØªØªØ¨Ù‘Ø¹ Ø§Ù„Ù…Ø³Ø±Ù‘Ø¨ Ù„Ùˆ Ø³ÙØ±Ù‘Ø¨ Ø§Ù„ÙƒÙˆØ¯.
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

// Ù‚Ù…Ø¹ ØµØ­Ø© Ø§Ù„Ø£ÙƒÙˆØ§Ø¯: Ø£ÙØµØ¯Ø± â† ÙÙØ¹Ù‘Ù„ â† Ø£ÙˆÙ„ Ø¯Ø®ÙˆÙ„ â† Ø£ÙˆÙ„ Ø§Ø®ØªØ¨Ø§Ø±.
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

// ØªØ¬Ù…ÙŠØ¹ Ø¬ØºØ±Ø§ÙÙŠ/Ø²Ù…Ù†ÙŠ: Ø¹Ø¯Ø© Ø·Ù„Ø¨Ø© ÙØ¹Ù‘Ù„ÙˆØ§/Ø­Ø§ÙˆÙ„ÙˆØ§ Ù…Ù† Ù†ÙØ³ Ø§Ù„Ù€IP Ø®Ù„Ø§Ù„ ÙˆÙ‚Øª Ù‚ØµÙŠØ± â‡’ Ø¯ÙØ¹Ø© Ù…ÙØªØ¯Ø§ÙˆÙ„Ø©.
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
      evidence: `${distinctStudents} Ø·Ù„Ø¨Ø© Ùˆ${item.codes.size} Ø£ÙƒÙˆØ§Ø¯ Ù…Ù† Ù†ÙØ³ Ø§Ù„Ø´Ø¨ÙƒØ©${tightWindow ? ` Ø®Ù„Ø§Ù„ ${windowMinutes} Ø¯Ù‚ÙŠÙ‚Ø©` : ""}.`,
      recommendation:
        "Ø§Ù„Ù†Ù…Ø· ÙŠØ´Ø¨Ù‡ ØªÙØ¹ÙŠÙ„Ø§Ù‹ Ø¬Ù…Ø§Ø¹ÙŠØ§Ù‹ Ù…Ù† Ø¬Ù‡Ø§Ø²/Ø´Ø¨ÙƒØ© ÙˆØ§Ø­Ø¯Ø© â€” Ø±Ø§Ø¬Ø¹ Ø·Ø±ÙŠÙ‚Ø© ØªÙˆØ²ÙŠØ¹ Ù‡Ø°Ù‡ Ø§Ù„Ø¯ÙØ¹Ø©.",
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
      name: a.studentName || a.studentId || "Ø·Ø§Ù„Ø¨",
      risk: String(a.reason || "").includes("Ø¬Ù‡Ø§Ø²") ? 90 : 55,
    })),
    ...scopedCodes.map((c: any) => ({
      device: c.activationDeviceToken || c.activationDeviceFingerprint,
      student: normalizeStudentId(c.studentId || c.usedByStudentId || c.assignedStudentId),
      name: c.studentName || c.assignedStudentName || c.studentId || "Ø·Ø§Ù„Ø¨",
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
    touchNode(deviceId, `Ø¬Ù‡Ø§Ø² ${String(r.device).slice(0, 4)}â€¦`, "device", risk);
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
    { key: "ghostStudents", label: "Ø·Ù„Ø§Ø¨ Ø¹Ø§Ù„Ù‚ÙˆÙ†", count: Number(health?.ghostStudents || 0), tone: "amber" },
    { key: "orphanCodes", label: "Ø£ÙƒÙˆØ§Ø¯ Ù‚Ø¯ÙŠÙ…Ø©", count: Number(health?.orphanCodes || 0), tone: "rose" },
    { key: "deadLinkCodes", label: "Ø±ÙˆØ§Ø¨Ø· Ù…ÙƒØ³ÙˆØ±Ø©", count: Number(health?.deadLinkCodes || 0), tone: "violet" },
    { key: "rosterOrphans", label: "ÙƒØ´Ù ÙŠØªÙŠÙ…", count: Number(health?.rosterOrphans || 0), tone: "slate" },
    { key: "activeDeadStudentCodes", label: "Ù†Ø´Ø· Ø¨Ù„Ø§ Ø·Ø§Ù„Ø¨", count: Number(health?.activeDeadStudentCodes || 0), tone: "rose" },
    { key: "duplicateActiveStudentCourseCodes", label: "ØªÙƒØ±Ø§Ø± Ù†Ø´Ø·", count: Number(health?.duplicateActiveStudentCourseCodes || 0), tone: "amber" },
    { key: "tamperedLedgers", label: "Ø³Ø¬Ù„ Ù…ÙƒØ³ÙˆØ±", count: Number(health?.tamperedLedgers || 0), tone: "rose" },
  ].filter((item) => item.count > 0);
  return {
    canHeal: items.length > 0,
    total: items.reduce((sum, item) => sum + item.count, 0),
    items: items.slice(0, 5),
    summary: items.length
      ? items.slice(0, 3).map((item) => `${item.count} ${item.label}`).join(" â€” ")
      : "Ù†Ø¸ÙŠÙ",
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
    return reason.includes("Ø¬Ù‡Ø§Ø²") || reason.includes("Ù…Ø´Ø§Ø±ÙƒØ©") || level.includes("Ù…Ù†Ø®ÙØ¶") || Number(attempt.sessionConfidenceScore || 0) >= 70;
  }).length;
  const issues = Number(health?.totalIssues || 0) + Number(radar?.suspicious || 0) + Number(radar?.sharing || 0) + stuckStudents + suspiciousSessions;
  const status = issues > 8 ? "danger" : issues > 0 ? "watch" : "calm";
  return {
    status,
    score: status === "calm" ? 98 : Math.max(35, 96 - Math.min(60, issues * 5)),
    rings: [
      { key: "health", value: Number(health?.totalIssues || 0), tone: Number(health?.totalIssues || 0) ? "amber" : "emerald", label: "ØµØ­Ø©" },
      { key: "codes", value: Number((radar?.suspicious || 0) + (radar?.sharing || 0)), tone: (radar?.sharing || 0) ? "violet" : (radar?.suspicious || 0) ? "rose" : "emerald", label: "Ø£ÙƒÙˆØ§Ø¯" },
      { key: "students", value: stuckStudents, tone: stuckStudents ? "amber" : "emerald", label: "Ø·Ù„Ø¨Ø©" },
      { key: "attempts", value: suspiciousSessions, tone: suspiciousSessions ? "rose" : "emerald", label: "Ø¬Ù„Ø³Ø§Øª" },
      { key: "exams", value: sensitiveExams, tone: "indigo", label: "Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª" },
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
    dots.push({ key, kind, label: String(label || id || "â€”").slice(0, 18), tone, score, title: String(title || label || id || "") });
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
    if (score >= 70 || String(attempt.reason || "").includes("Ø¬Ù‡Ø§Ø²")) {
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
      if (!/(Ø­Ø°Ù|Ø¥Ø¶Ø§ÙØ©|Ø§Ø¶Ø§Ù|ØªÙØ¹ÙŠÙ„|Ø¥Ø¹Ø§Ø¯Ø©|Ø§Ø¹Ø§Ø¯Ø©|ØªÙ†Ø¸ÙŠÙ|Ø´ÙØ§Ø¡|ÙƒÙˆØ¯|Ø±Ù…Ø²)/.test(action)) return;
      add("log", action, log.timestamp || log.createdAt || log.date, {
        studentId: log.studentId || "", studentName: log.studentName || "", courseCode: log.sectionCode || log.courseCode || "",
        tone: action.includes("Ø­Ø°Ù") ? "rose" : action.includes("ØªÙØ¹ÙŠÙ„") ? "emerald" : action.includes("Ø¥Ø¹Ø§Ø¯Ø©") || action.includes("Ø§Ø¹Ø§Ø¯Ø©") ? "violet" : "indigo",
      });
    });
  } catch {}
  scopedCodes.slice(0, 50).forEach((code: any) => {
    (Array.isArray(code.codeJourney) ? code.codeJourney : []).forEach((ev: any) => {
      const label = ev.label || ev.action || "Ø­Ø¯Ø« ÙƒÙˆØ¯";
      add("code", label, ev.at || ev.timestamp || code.updatedAt || code.createdAt, {
        code: code.code, studentId: code.studentId || code.usedByStudentId || code.assignedStudentId || "", studentName: code.studentName || code.assignedStudentName || "", courseCode: joinCodeCourse(code),
        tone: String(label).includes("Ø­Ø°Ù") ? "rose" : String(label).includes("ØªÙØ¹ÙŠÙ„") ? "emerald" : "indigo",
      });
    });
  });
  scopedAttempts.slice(0, 30).forEach((attempt: any) => {
    if (!String(attempt.reason || "").trim()) return;
    add("attempt", "Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙØ¹ÙŠÙ„", attempt.timestamp || attempt.createdAt, { code: attempt.normalizedCode || attempt.code || "", studentId: attempt.studentId || "", studentName: attempt.studentName || "", courseCode: attempt.sectionCode || attempt.courseCode || "", tone: String(attempt.reason || "").includes("Ø¬Ù‡Ø§Ø²") ? "rose" : "amber", reason: attempt.reason || "" });
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
  // Ø·Ù„Ø¨ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ø¬Ù‡Ø§Ø² Ù‚Ø¯ ÙŠØ­ØªÙˆÙŠ Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„ØµØ­ÙŠØ­Ø› Ù„Ø§ ÙŠØ¯Ø®Ù„ ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„Ø³Ø¬Ù„ Ù„Ø£Ù† Ù‡Ø¯ÙÙ‡
  // Ø¹Ø±Ø¶ Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„ØªÙŠ Ø¬Ø±Ù‘Ø¨Ù‡Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ ÙˆÙ„Ù… ØªÙƒÙ† Ù‡ÙŠ ÙƒÙˆØ¯ Ø§Ù„ØªÙØ¹ÙŠÙ„ Ø§Ù„ØµØ­ÙŠØ­ Ø§Ù„Ù†Ø§Ø¬Ø­.
  if (String(attempt?.approvalRequestType || "") === "second_hand_device") return false;
  if (/ØªÙ…\s*(ØªÙØ¹ÙŠÙ„|Ø§Ø¹ØªÙ…Ø§Ø¯)|Ù†Ø¬Ø­|success/i.test(reason)) return false;
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
    return res.status(401).json({ error: "Ø¬Ù„Ø³Ø© Ø§Ù„Ø£Ø³ØªØ§Ø° ØºÙŠØ± ÙˆØ§Ø¶Ø­Ø©." });
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
        linkedSectionName: courseNameFromCode(sectionCode) || sectionDisplayCode(sectionCode) || "Ù…Ù‚Ø±Ø± ØºÙŠØ± Ù…Ø­Ø¯Ø¯",
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
  // Ù„ÙˆØ­Ø© Ø§Ù„Ø£Ù…Ø§Ù† ØªØ¹Ø±Ø¶ Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„ØªØ´ØºÙŠÙ„ÙŠØ© Ø§Ù„Ø­Ø§Ù„ÙŠØ© ÙÙ‚Ø·. Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ù…Ø¤Ø±Ø´ÙØ© Ø¨Ø¹Ø¯
  // Ø§Ù„ØªØµÙÙŠØ± ØªÙØ­ÙØ¸ Ù„Ù…Ù†Ø¹ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ø³ØªØ®Ø¯Ø§Ù…Ù‡Ø§ØŒ Ù„ÙƒÙ†Ù‡Ø§ Ù„Ø§ ØªÙØ­Ø³Ø¨ ÙƒØ£ÙƒÙˆØ§Ø¯ Ø­ÙŠØ© ÙˆÙ„Ø§ ØªÙÙ†ØªØ¬
  // Ù…Ù„ÙØ§Øª Ù…Ø±Ø§Ø¬Ø¹Ø© Ø¨Ø¹Ø¯ Ø£Ù† Ø£ØµØ¨Ø­Øª Ø®Ø§Ø±Ø¬ Ø§Ù„Ø¯ÙˆØ±Ø© Ø§Ù„Ø­Ø§Ù„ÙŠØ©.
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
    (a: any) => a.honeyCode || String(a.reason || "").includes("Ù…ØµÙŠØ¯Ø©"),
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
    safeBatches: batchIntelligence.filter((b: any) => b.level === "Ø¢Ù…Ù†Ø©")
      .length,
    watchBatches: batchIntelligence.filter(
      (b: any) => b.level === "ØªØ­ØªØ§Ø¬ Ù…Ø±Ø§Ù‚Ø¨Ø©",
    ).length,
    dangerBatches: batchIntelligence.filter(
      (b: any) => b.level === "Ø¹Ø§Ù„ÙŠØ© Ø§Ù„Ø®Ø·ÙˆØ±Ø©",
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
    const label = String(attempt.fairnessLevel || "ØºÙŠØ± Ù…ØµÙ†Ù");
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const sessionConfidenceSummary = scopedAttempts.reduce(
    (acc: any, attempt: any) => {
      const label = String(attempt.sessionConfidenceLevel || "ØºÙŠØ± Ù…ØµÙ†Ù");
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
        "Ø§Ø´ØªØ¨Ø§Ù‡ Ø¹Ø§Ù„Ù ÙŠØ³ØªØ­Ù‚ ØªÙØ¹ÙŠÙ„Ù‹Ø§ Ø§Ø­ØªÙŠØ§Ø·ÙŠÙ‹Ø§ Ø¹Ù„Ù‰ Ù…Ø±Ø­Ù„ØªÙŠÙ†",
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
          (reason.includes("Ø¬Ù‡Ø§Ø²") ? 85 : 0) ||
            (reason.includes("ÙƒÙˆØ¯") && reason.includes("Ù…Ø³ØªØ®Ø¯Ù…") ? 78 : 0) ||
            (reason.includes("Ù…Ø®ØµØµ") ? 72 : 0) ||
            (reason.includes("Ù…ØµÙŠØ¯Ø©") ? 72 : 0) ||
            (reason.includes("ØµÙŠØºØ©") ? 34 : 0) ||
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
        ? "Ù…Ø´ØªØ¨Ù‡"
        : confidenceScore >= 50
          ? "Ù…Ø±Ø§Ù‚Ø¨Ø©"
          : "Ø·Ø¨ÙŠØ¹ÙŠ");
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
          )?.courseName || courseNameFromCode(sectionCode) || "Ø§Ù„Ù…Ù‚Ø±Ø± Ø§Ù„Ù…Ø­Ø¯Ø¯",
      linkedAccountLabel: [
        student?.name || allowed?.name || item.studentName || "",
        student?.id || allowed?.idNumber || linkedStudentId || "",
      ]
        .filter(Boolean)
        .join(" â€¢ "),
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
      // codeJourney (â‰ˆ2KB Ù„ÙƒÙ„ Ù…Ø­Ø§ÙˆÙ„Ø© Ã— Ø¹Ø´Ø±Ø§Øª Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø§Øª = ~172KB) Ù„Ø§ ØªÙØ¹Ø±Ø¶ ÙÙŠ ÙˆØ§Ø¬Ù‡Ø©
      // Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ Ø¥Ø·Ù„Ø§Ù‚Ø§Ù‹ (Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© ØªÙ‚Ø±Ø£ codeJourney Ù…Ù† Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ ÙÙ‚Ø· Ù„Ø§ Ù…Ù† Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø§Øª)ØŒ
      // ÙØ¥Ø±Ø³Ø§Ù„Ù‡Ø§ Ù‡Ù†Ø§ ÙƒØ§Ù† ÙŠØ¶Ø®Ù‘Ù… Ø±Ø¯ code-integrity Ø¨Ù„Ø§ ÙØ§Ø¦Ø¯Ø© ÙˆÙŠÙØ¨Ø·Ø¦ Ø§Ù„Ø¬ÙˆØ§Ù„. Ø£ÙØ²ÙŠÙ„Øª.
      honeyCode: Boolean(item.honeyCode || reason.includes("Ù…ØµÙŠØ¯Ø©")),
      fairness,
      fairnessLevel: fairness.level,
      fairnessLabel: fairness.label,
      fairnessScore: fairness.score,
      silentEnforcement: item.silentEnforcement !== false,
      sessionConfidenceScore:
        item.sessionConfidenceScore ||
        (codeRecord as any)?.lastSessionConfidenceScore ||
        0,
      sessionConfidenceLevel: item.sessionConfidenceLevel || "ØºÙŠØ± Ù…ØµÙ†Ù",
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
        String(a.reason || "").includes("Ø¬Ù‡Ø§Ø²"),
      ).length,
      oldFormat: scopedAttempts.filter((a: any) =>
        String(a.reason || "").includes("ØµÙŠØºØ©"),
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
    // honeyAttempts (â‰ˆ480KB) Ù„Ø§ ØªÙ‚Ø±Ø£Ù‡Ø§ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ø¥Ø·Ù„Ø§Ù‚Ø§Ù‹ (ÙŠÙØ³ØªØ®Ø¯Ù… Ø§Ù„Ø¹Ø¯Ù‘Ø§Ø¯ honeyCodes
    // ÙÙ‚Ø· Ø£Ø¹Ù„Ø§Ù‡)ØŒ ÙØ¥Ø±Ø³Ø§Ù„ ØªÙØ§ØµÙŠÙ„Ù‡Ø§ ÙƒØ§Ù† ÙŠØ¶Ø®Ù‘Ù… Ø§Ù„Ø±Ø¯ Ø¨Ù„Ø§ ÙØ§Ø¦Ø¯Ø©. Ù†Ø±Ø³Ù„ Ù…ØµÙÙˆÙØ© ÙØ§Ø±ØºØ©.
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
    // ØµØ­Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ÙˆØ§Ù„Ø´ÙØ§Ø¡ Ø§Ù„Ø°Ø§ØªÙŠ â€” Ù…Ø±Ø¨ÙˆØ·Ø© Ø¨Ø¬Ù„Ø³Ø© Ø§Ù„Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù† Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠØ© (Ù„Ø§
    // Ø¨Ù…Ø¹Ø§Ù…Ù„ Ù‚Ø§Ø¨Ù„ Ù„Ù„Ø§Ù†ØªØ­Ø§Ù„)ØŒ ÙÙ„Ø§ ØªØ¸Ù‡Ø± Ù„ØºÙŠØ± Ø§Ù„Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù† Ù…Ù‡Ù…Ø§ ÙƒØ§Ù† Ù…Ø¹Ø§Ù…Ù„ Ø§Ù„Ø§Ø³ØªØ¹Ù„Ø§Ù….
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
  if (!teacherEmail || !sectionCode) return res.status(400).json({ error: "Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ØºÙŠØ± Ù…ÙƒØªÙ…Ù„Ø©." });
  if (!isAdminEmail(teacherEmail) && !teacherOwnsCourseCode(sectionCode, teacherEmail)) {
    return res.status(403).json({ error: "Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© Ø¥ØµØ¯Ø§Ø± QR Ù„Ù‡Ø°Ù‡ Ø§Ù„Ø´Ø¹Ø¨Ø©." });
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
  if (!decoded.ok) return res.status(400).json({ error: "Ø§Ù†ØªÙ‡Øª ØµÙ„Ø§Ø­ÙŠØ© Ø±Ù…Ø² Ø§Ù„Ø­Ø¶ÙˆØ±. Ø§Ø·Ù„Ø¨ Ù…Ù† Ø§Ù„Ø£Ø³ØªØ§Ø° ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø´Ø§Ø´Ø©." });
  const payload = decoded.payload;
  const studentId = normalizeStudentId(req.body?.studentId || req.body?.idNumber || req.body?.id || "");
  if (!studentId) return res.status(400).json({ error: "Ø§Ù„Ø±Ù‚Ù… Ø§Ù„Ø¬Ø§Ù…Ø¹ÙŠ Ù…Ø·Ù„ÙˆØ¨." });
  const scanKey = `${payload.nonce}:${studentId}`;
  if (usedRollCallScans.has(scanKey)) return res.status(409).json({ error: "ØªÙ… Ø§Ø³ØªØ®Ø¯Ø§Ù… Ù…Ø³Ø­ Ø§Ù„Ø­Ø¶ÙˆØ± Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø§Ù„ÙØ¹Ù„." });
  const rosterMatch = dbInstance.getAllowedStudents().find((row: any) =>
    allowedStudentMatchesCourse(row, studentId, payload.sectionCode, payload.teacherEmail),
  );
  if (!rosterMatch) return res.status(403).json({ error: "Ø§Ù„Ø·Ø§Ù„Ø¨ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ ÙÙŠ ÙƒØ´Ù Ù‡Ø°Ù‡ Ø§Ù„Ø´Ø¹Ø¨Ø©." });
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
      semester: String(req.body?.semester || "Ø§Ù„ÙØµÙ„ Ø§Ù„Ø­Ø§Ù„ÙŠ"),
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
      codeJourney: createCodeJourneyEvent("QR Ø­Ø¶ÙˆØ± Ø¯ÙˆÙ‘Ø§Ø±", payload.teacherEmail, { sectionCode: payload.sectionCode, studentId }),
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

// Ø²Ø± Ø§Ù„Ø´ÙØ§Ø¡ Ø§Ù„Ø°Ø§ØªÙŠ Ø¨Ù†Ù‚Ø±Ø© ÙˆØ§Ø­Ø¯Ø© â€” Ù„Ù„Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù† ÙÙ‚Ø·. ÙŠÙØµÙ„Ø­ Ø£Ø´Ø¨Ø§Ø­ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ÙˆÙŠØ¹ÙŠØ¯
// Ø§Ù„Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„ÙŠØªÙŠÙ…Ø© Ù„Ø­Ø§Ù„Ø© Ø³Ù„ÙŠÙ…Ø©ØŒ Ø«Ù… ÙŠÙØ±Ø¬Ø¹ Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ù…Ø­Ø¯Ù‘Ø«Ø© Ù„ØªØ­Ø¯ÙŠØ« Ø§Ù„Ù„ÙˆØ­Ø© ÙÙˆØ±Ù‹Ø§.
app.post("/api/teacher/data-heal", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!isAdminEmail(teacherEmail)) {
    return res.status(403).json({ error: "Ù‡Ø°Ø§ Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡ Ù…ØªØ§Ø­ Ù„Ù„Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù† ÙÙ‚Ø·." });
  }
  const before = computeDataHealth();
  const healed = healDataIssues(teacherEmail);
  dbInstance.addActivityLog({
    action: "ØµÙŠØ§Ù†Ø© ÙˆØ´ÙØ§Ø¡ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª",
    details: `Ø´ÙØ§Ø¡ Ø°Ø§ØªÙŠ: Ø·Ù„Ø§Ø¨=${healed.healedStudents}ØŒ Ø£ÙƒÙˆØ§Ø¯ Ù…Ø¤Ø±Ø´ÙØ©=${healed.archivedCodes}ØŒ Ø£ÙƒÙˆØ§Ø¯ Ù…Ø­Ø±Ù‘Ø±Ø©=${healed.relinkedCodes}ØŒ ØµÙÙˆÙ ÙƒØ´Ù=${healed.removedRoster}`,
    teacherEmail,
    actorEmail: teacherEmail,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "Ù„ÙˆØ­Ø© Ø§Ù„Ø³ÙˆØ¨Ø± Ø£Ø¯Ù…Ù†",
    browser: "Ù…Ø±ÙƒØ² Ø§Ù„Ø°ÙƒØ§Ø¡",
    isViolationWarning: false,
  });
  return res.json({ success: true, before, healed, dataHealth: computeDataHealth() });
});

// Dynamic Mock device lock validation helper

// Ù‚Ø§Ø¦Ù…Ø© Ø¨Ø±ÙŠØ¯ Ø§Ù„Ù…Ø´Ø±ÙÙŠÙ† (Ø§Ù„Ø³ÙˆØ¨Ø±-Ø£Ø¯Ù…Ù†) â€” Ù…Ø·Ø§Ø¨Ù‚Ø© ØªØ§Ù…Ù‘Ø© Ù„Ø§ "Ø§Ø­ØªÙˆØ§Ø¡".
// Ø£Ù…Ù† (CWE-697): Ø§Ø³ØªØ®Ø¯Ø§Ù… includes ÙƒØ§Ù† ÙŠÙ…Ù†Ø­ ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ù…Ø´Ø±Ù Ù„Ø£ÙŠ Ø¨Ø±ÙŠØ¯ ÙŠØ­ØªÙˆÙŠ Ù‡Ø°Ù‡
// Ø§Ù„Ø³Ù„Ø³Ù„Ø© (Ù…Ø«Ù„ ahmad.alfailakawi.attacker@gmail.com)ØŒ ÙˆØ¨Ù…Ø§ Ø£Ù† Ø£Ø­Ø¯ Ø¨Ø±ÙŠØ¯ÙÙŠ Ø§Ù„Ù…Ø´Ø±Ù
// Ø¹Ù„Ù‰ gmail (Ù„Ø§ ÙŠÙ‚ØªØµØ± Ø¹Ù„Ù‰ Ù†Ø·Ø§Ù‚ Ø§Ù„Ù…Ø¤Ø³Ø³Ø©)ØŒ ÙƒØ§Ù† Ø¨Ø¥Ù…ÙƒØ§Ù† Ø­Ø³Ø§Ø¨ Ù…Ø¹Ù„Ù… Ù…Ø³Ø¬ÙÙ‘Ù„ Ø¨Ø¨Ø±ÙŠØ¯
// Ù…ØªØ´Ø§Ø¨Ù‡ Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ù…Ø´Ø±Ù ÙƒØ§Ù…Ù„Ø©. Ø§Ù„Ù…Ø·Ø§Ø¨Ù‚Ø© Ø§Ù„ØªØ§Ù…Ù‘Ø© ØªÙØºÙ„Ù‚ Ù‡Ø°Ø§ Ø§Ù„ØªØµØ¹ÙŠØ¯.
const MIRAS_ADMIN_EMAILS = new Set<string>([
  "ah.alfailakawi@paaet.edu.kw",
  "dr.ahmad.alfailakawi@gmail.com",
]);
function isAdminEmail(email?: string): boolean {
  return MIRAS_ADMIN_EMAILS.has(String(email || "").trim().toLowerCase());
}

function extractEmailFromSectionCode(code?: string): string {
  const raw = String(code || "").trim().toLowerCase();
  if (raw.indexOf("@") === -1) return "";
  // Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ù…Ù‚Ø±Ø±Ø§Øª Ø§Ù„Ù…Ø±Ø¨ÙˆØ·Ø© Ø¨Ø§Ù„Ù…Ø¹Ù„Ù… ØªÙØ®Ø²ÙÙ‘Ù† Ø¨ØµÙŠØºØ© "Ø±Ù‚Ù…-Ø¨Ø±ÙŠØ¯" Ø£Ùˆ "Ø¨Ø±ÙŠØ¯-Ø±Ù‚Ù…".
  // Ø§Ù„ØªÙ‚Ø§Ø· Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø¨ØªØ¹Ø¨ÙŠØ± Ù†Ù…Ø·ÙŠ ÙØ¶ÙØ§Ø¶ ÙƒØ§Ù† ÙŠØ¨ØªÙ„Ø¹ Ø§Ù„Ø±Ù‚Ù…Ù Ù…Ø¹ Ø§Ù„Ø¨Ø±ÙŠØ¯ (Ø§Ù„Ø¬Ø²Ø¡ Ø§Ù„Ù…Ø­Ù„ÙŠ
  // ÙŠØ³Ù…Ø­ Ø¨Ø§Ù„Ø£Ø±Ù‚Ø§Ù… ÙˆØ§Ù„Ø´Ø±Ø·Ø§Øª)ØŒ ÙÙŠÙØ±Ø¬Ø¹ "111-ah@x.com" Ø¨Ø¯Ù„ "ah@x.com" ÙˆÙŠÙÙØ³Ø¯ ÙƒÙ„
  // Ø¹Ù…Ù„ÙŠØ§Øª ØªØ·Ø¨ÙŠØ¹ Ø§Ù„ÙƒÙˆØ¯ ÙˆØ§Ù„Ù…Ø·Ø§Ø¨Ù‚Ø©. Ù„Ø°Ø§ Ù†Ù‚Ø³Ù‘Ù… Ø¹Ù„Ù‰ Ø§Ù„Ø´Ø±Ø·Ø§Øª ÙˆÙ†Ø£Ø®Ø° Ø§Ù„Ø¬Ø²Ø¡ Ø§Ù„Ø°ÙŠ ÙŠÙƒÙˆÙ‘Ù†
  // Ø¨Ø±ÙŠØ¯Ø§Ù‹ ØµØ§Ù„Ø­Ø§Ù‹ Ø¨Ù…ÙØ±Ø¯Ù‡ (Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø´Ø§Ø¦Ø¹Ø© Ù„Ø¨ÙØ±Ø¯ Ø§Ù„Ù…Ø¤Ø³Ø³Ø© Ø¨Ù„Ø§ Ø´Ø±Ø·Ø§Øª Ø¯Ø§Ø®Ù„ÙŠØ©)ØŒ Ù…Ø¹
  // Ø¯Ø¹Ù… Ø§Ù„Ø¨ÙØ±Ø¯ Ø°Ø§Øª Ø§Ù„Ø´Ø±Ø·Ø§Øª Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠØ© Ø¹Ø¨Ø± Ø¯Ù…Ø¬ Ø§Ù„Ø£Ø¬Ø²Ø§Ø¡ Ù…Ù† Ø£ÙˆÙ„ Ø¬Ø²Ø¡ ÙŠØ­ÙˆÙŠ '@'.
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
  // Ù…Ø§Ù„Ùƒ Ø§Ù„ØµÙ: ØµÙÙˆÙ Ø§Ù„ÙƒØ´Ù Ø§Ù„Ù…Ø±ÙÙˆØ¹Ø© Ù…Ù† Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ù„Ø§ ØªØ­Ù…Ù„ Ø­Ù‚Ù„ teacherEmail ØµØ±ÙŠØ­Ø§Ù‹ØŒ
  // Ø¨Ù„ ÙŠÙƒÙˆÙ† Ø§Ù„Ù…Ø§Ù„Ùƒ Ù…Ø¶Ù…ÙÙ‘Ù†Ø§Ù‹ ÙÙŠ ÙƒÙˆØ¯ Ø§Ù„Ø´Ø¹Ø¨Ø© (Ù…Ø«Ù„ "777-ahmad@..."). Ù„Ø°Ø§ Ù†Ø´ØªÙ‚ Ø§Ù„Ù…Ø§Ù„Ùƒ
  // Ù…Ù† Ø§Ù„ÙƒÙˆØ¯ Ø¹Ù†Ø¯ ØºÙŠØ§Ø¨ Ø§Ù„Ø­Ù‚Ù„ØŒ ÙˆØ¥Ù„Ø§ ÙÙØ´ÙÙ„Øª ÙƒÙ„ Ø§Ù„Ù…Ø·Ø§Ø¨Ù‚Ø§Øª Ù„Ù„ÙƒØ´ÙˆÙ Ø§Ù„Ù…Ø±ÙÙˆØ¹Ø© Ø¹Ø¨Ø± Ø§Ù„ÙˆØ§Ø¬Ù‡Ø©
  // (ÙŠÙØ±ÙØ¶ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ù† Ø§Ù„ØªÙØ¹ÙŠÙ„ ÙˆØ¥ØµØ¯Ø§Ø± Ø§Ù„ÙƒÙˆØ¯ Ø±ØºÙ… ÙˆØ¬ÙˆØ¯Ù‡ ÙÙŠ Ø§Ù„ÙƒØ´Ù).
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
  return String(sec?.courseName || sec?.name || sectionDisplayCode(raw) || raw || "Ø§Ù„Ù…Ù‚Ø±Ø±").trim();
}

function isGenericJoinCourseCode(value: any): boolean {
  const raw = String(value || "").trim().toLowerCase();
  return !raw || raw === "all";
}

function isUsefulCourseNameForDisplay(name: any, code: any): boolean {
  const text = String(name || "").trim();
  if (!text || text.toLowerCase() === "all" || /ØºÙŠØ±\s*Ù…Ø­Ù…/i.test(text)) return false;
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
  if (!normalized) return "Ø§Ù„Ø¯ÙƒØªÙˆØ±";
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
  if (normalized.includes("ada.alenezi")) return "Ø¯. Ø¹Ø¨Ø¯Ø§Ù„Ø¹Ø²ÙŠØ² Ø¯Ø®ÙŠÙ„ Ø§Ù„Ø¹Ù†Ø²ÙŠ";
  if (
    normalized.includes("ah.alfailakawi") ||
    normalized.includes("ahmad.alfailakawi") ||
    normalized.includes("dr.ahmad.alfailakawi")
  )
    return "Ø¯. Ø£Ø­Ù…Ø¯ Ø­Ø³ÙŠÙ† Ø§Ù„ÙÙŠÙ„ÙƒØ§ÙˆÙŠ";
  return "Ø§Ù„Ø¯ÙƒØªÙˆØ±";
}

function publicCourseNameForMessage(courseCode: any): string {
  const raw = String(courseCode || "").trim();
  if (!raw) return "Ø§Ù„Ù…Ù‚Ø±Ø±";
  const label = courseNameFromCode(raw);
  const display = sectionDisplayCode(raw);
  const cleanLabel = String(label || "").trim();
  if (
    !cleanLabel ||
    cleanLabel.includes("@") ||
    (display && cleanLabel.toLowerCase() === display.toLowerCase()) ||
    /^[A-Z0-9_-]+$/i.test(cleanLabel)
  )
    return "Ø§Ù„Ù…Ù‚Ø±Ø±";
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
    "(?:Ù…Ù‚Ø±Ø±|Ø§Ù„Ù…Ù‚Ø±Ø±|Ù„Ù…Ù‚Ø±Ø±|Ù„Ù„Ù…Ù‚Ø±Ø±|Ø´Ø¹Ø¨Ø©|Ø§Ù„Ø´Ø¹Ø¨Ø©|Ù„Ø´Ø¹Ø¨Ø©|Ù„Ù„Ø´Ø¹Ø¨Ø©|ÙƒÙˆØ±Ø³|course|section)";
  const escaped = escapeRegExpLiteral(raw);
  return source.replace(
    new RegExp(
      `(${courseWord}\\s*(?:[:#\\-â€“â€”]\\s*)?)${escaped}(?=$|[^\\p{L}\\p{N}@._%+-])`,
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
    title: sanitizePublicMessageText(item.title || "Ù…ÙØ±Ø§Ø³") || "Ù…ÙØ±Ø§Ø³",
    body:
      sanitizePublicMessageText(item.body || item.message || "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯.") ||
      "Ù„Ø¯ÙŠÙƒ ØªÙ†Ø¨ÙŠÙ‡ Ø¬Ø¯ÙŠØ¯.",
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
      error: "Ø§Ø®ØªØ± Ù…Ù‚Ø±Ø±Ø§Ù‹ Ù…Ø­Ø¯Ø¯Ø§Ù‹ Ù‚Ø¨Ù„ ØªÙˆÙ„ÙŠØ¯ Ø§Ù„Ø±Ù…Ø². Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥ØµØ¯Ø§Ø± Ø±Ù…Ø² Ø¹Ø§Ù… Ø¨Ù„Ø§ Ù…Ù‚Ø±Ø±.",
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
        error: "Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥ØµØ¯Ø§Ø± Ø±Ù…ÙˆØ² Ù„Ø´Ø¹Ø¨Ø© ÙŠÙ…Ù„ÙƒÙ‡Ø§ Ø£Ø³ØªØ§Ø° Ø¢Ø®Ø±.",
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
        "Ø±Ù‚Ù… Ø§Ù„Ù…Ù‚Ø±Ø± Ù…ÙˆØ¬ÙˆØ¯ Ø¹Ù†Ø¯ Ø£ÙƒØ«Ø± Ù…Ù† Ø£Ø³ØªØ§Ø°. Ø§Ø®ØªØ± Ø§Ù„Ù…Ù‚Ø±Ø± Ù…Ù† Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…Ø­Ø¯Ø¯Ø© Ø¨Ø¯Ù„Ø§Ù‹ Ù…Ù† Ø§Ù„Ø±Ù‚Ù… Ø§Ù„Ø¹Ø§Ù….",
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
    error: "Ø§Ù„Ù…Ù‚Ø±Ø± Ø§Ù„Ù…Ø­Ø¯Ø¯ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ Ø£Ùˆ ØºÙŠØ± Ù…ØªØ§Ø­ Ù„Ø¥ØµØ¯Ø§Ø± Ø±Ù…ÙˆØ² Ø¯Ø®ÙˆÙ„.",
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
    // activatedCourseCodes Ù…ØµÙÙˆÙØ© Ù†ØµÙˆØµ (Ù„Ø§ ÙƒØ§Ø¦Ù†Ø§Øª) ÙÙ„Ø§ ÙŠØ·Ø§Ù„Ù‡Ø§ patchDirectCourseFieldsØ›
    // Ù†Ù‡Ø§Ø¬Ø± Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„Ù‚Ø¯ÙŠÙ… Ø¥Ù„Ù‰ Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ø­ØªÙ‰ Ù„Ø§ ÙŠØ¨Ù‚Ù‰ ÙƒÙƒÙˆØ¯ ÙŠØªÙŠÙ… Ø¨Ù„Ø§ Ù‚Ø³Ù… Ø¨Ø¹Ø¯ ØªØºÙŠÙŠØ± Ø§Ù„Ø±Ù‚Ù….
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
  return /ØªØ·Ù‡ÙŠØ±|ØªØµÙÙŠØ±|Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª|Ø­Ø°Ù Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨|Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ø¯Ø®ÙˆÙ„/.test(text);
}

// ØªÙ†Ø¨ÙŠÙ‡Ø§Øª "Ø±ÙØ¶ Ù†ÙÙ‚ SEB â€¦ Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ø­Ø§ÙˆÙ„Ø© SEB Ù†Ø´Ø·Ø© Ù…Ø·Ø§Ø¨Ù‚Ø©" Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø©: ÙƒØ§Ù†Øª ØªÙØ³Ø¬ÙÙ‘Ù„
// Ø®Ø·Ø£Ù‹ Ù„Ø­Ø§Ù„Ø© Ø­Ù…ÙŠØ¯Ø© (ØªÙˆÙ‚Ù‘Ù Ù…ØµØ¯Ø±Ù‡Ø§ Ù„Ø§Ø­Ù‚Ø§Ù‹)ØŒ Ù„ÙƒÙ†Ù‡Ø§ Ø¨Ù‚ÙŠØª ÙÙŠ Ø§Ù„Ø³Ø¬Ù„ ÙˆØªÙØºØ±Ù‚ Ù„ÙˆØ­Ø© ØªÙ†Ø¨ÙŠÙ‡Ø§Øª
// Ø§Ù„Ù…Ø¹Ù„Ù… ÙÙŠ ÙƒÙ„ Ø¬Ù„Ø³Ø©. Ù†Ø³ØªØ¨Ø¹Ø¯Ù‡Ø§ Ù…Ù† ÙƒÙ„ Ø¹Ø±Ø¶ØŒ ÙˆÙŠØ·Ù‡Ù‘Ø±Ù‡Ø§ Ø§Ù„Ø¥Ù‚Ù„Ø§Ø¹ Ù…Ù† Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø© Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹.
function isObsoleteSebNoiseLog(log: any): boolean {
  const details = String(log?.details || "");
  return (
    details.includes("Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ø­Ø§ÙˆÙ„Ø© SEB Ù†Ø´Ø·Ø© Ù…Ø·Ø§Ø¨Ù‚Ø©") ||
    (String(log?.action || "").includes("Ø±ÙØ¶ Ù†ÙÙ‚ SEB") &&
      details.includes("Ø±ÙØ¶ ØªÙˆÙ„ÙŠØ¯ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±"))
  );
}
function filterLogsForTeacher(email?: string) {
  const normalized = String(email || "").toLowerCase();
  const logs = dbInstance
    .getActivityLogs()
    .filter(
      (log: any) => !isDatabaseResetActivityLog(log) && !isObsoleteSebNoiseLog(log),
    );
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
  const teacherReturned = dbInstance.getTeacherSubmissions().some((item: any) => {
    if (
      String(item.kind || "").toLowerCase() !== "exam" ||
      String(item.activityId ?? item.examId ?? "") !== String(examId) ||
      String(item.studentId ?? item.userId ?? "") !== String(studentId)
    )
      return false;
    const status = String(item.status || "").trim().toLowerCase();
    const note = String(item.returnNote || item.answerText || "").toLowerCase();
    return (
      ["Ù…Ø¹Ø§Ø¯ Ù„Ù„Ø·Ø§Ù„Ø¨", "Ù…Ø¹Ø§Ø¯ Ù„Ùƒ", "returned", "return", "reopened"].includes(status) ||
      Boolean(item.returnedAt) ||
      Boolean(item.returnExceptionUntil) ||
      /Ù…Ø¹Ø§Ø¯|Ø¥Ø±Ø¬Ø§Ø¹|Ø§Ø±Ø¬Ø§Ø¹|returned|reopen/.test(`${status} ${note}`)
    );
  });
  if (teacherReturned) return true;

  return dbInstance.getQuizSubmissions().some((item: any) => {
    if (
      String(item.chapterId) !== String(examId) ||
      String(item.studentId) !== String(studentId)
    )
      return false;
    const status = String(item.status || "").trim().toLowerCase();
    return ["Ù…Ø¹Ø§Ø¯ Ù„Ù„Ø·Ø§Ù„Ø¨", "Ù…Ø¹Ø§Ø¯ Ù„Ùƒ", "returned", "return", "reopened"].includes(status) || Boolean(item.returnedAt);
  });
}

function hasTeacherAuthorizedSebReturnException(examId: any, studentId: any): boolean {
  // Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ø¶ÙŠÙ‚ ÙÙ‚Ø· Ù„Ù…Ø³Ø§Ø± Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ù…ÙØ¹Ø§Ø¯/Ø§Ù„Ù…ÙØªÙˆØ­ Ù…Ù† Ø§Ù„Ù…Ø¹Ù„Ù….
  // Ø§Ù„Ù‡Ø¯Ù Ø£Ù„Ø§ ØªØ¸Ù‡Ø± ØµÙØ­Ø© Ù…Ù†Ø¹ SEB Ù„Ù„Ø·Ø§Ù„Ø¨ Ø­ÙŠÙ† ÙŠÙƒÙˆÙ† Ø§Ù„Ø¥Ø±Ø¬Ø§Ø¹ Ù‚Ø±Ø§Ø±Ø§Ù‹ ØµØ±ÙŠØ­Ø§Ù‹ Ù…Ù† Ø§Ù„Ù…Ø¹Ù„Ù…ØŒ
  // Ù…Ø¹ Ø¨Ù‚Ø§Ø¡ Ù‚ÙÙ„ Ø§Ù„Ø¬Ù‡Ø§Ø² ÙˆSEB ÙƒÙ…Ø§ Ù‡Ùˆ ÙÙŠ ÙƒÙ„ Ø§Ù„Ù…Ø³Ø§Ø±Ø§Øª Ø§Ù„Ø¹Ø§Ø¯ÙŠØ©.
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
      ["Ù…Ø¹Ø§Ø¯ Ù„Ù„Ø·Ø§Ù„Ø¨", "Ù…Ø¹Ø§Ø¯ Ù„Ùƒ", "returned", "return", "reopened"].includes(
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
  opts?: { strictLoginSurface?: boolean },
): { isValid: boolean; error?: string; statusCode?: number } {
  const browser = req.headers["user-agent"] || "Unknown Browser";
  const ip = req.ip || "127.0.0.1";
  const sebPass = getValidSebPass(req, student);
  if (sebPass && isSebRequest(req)) {
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "Ø¯Ø®ÙˆÙ„ SEB Ø¢Ù…Ù†",
      details: `ØªÙ… Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ø¯Ø®ÙˆÙ„ Safe Exam Browser Ø¨Ø¬Ù„Ø³Ø© Ù…Ø¤Ù‚ØªØ© Ù„Ù„Ù…Ù‚Ø±Ø± ${sebPass.courseCode} ÙˆØ§Ù„Ø§Ø®ØªØ¨Ø§Ø± ${sebPass.examId} Ø¯ÙˆÙ† ÙÙƒ Ù‚ÙÙ„ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø£ØµÙ„ÙŠ.`,
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
      reason: "Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø¬Ù‡Ø§Ø² Ù…Ø±ØªØ¨Ø· Ø¨Ø·Ø§Ù„Ø¨ Ø¢Ø®Ø±",
    });xœì½[wT×•(ü®_±©öÈ©êH%á±‹`Z€ì¨ƒ–pÜ}7lUm¡
¥ªrU	¬î˜äë´{ô[¿|	ÇÈ`"ß>oı+¤×ü’3/ë2×eïª’€8éá@í½öºÎ5ï—‰şô²ÁZ¯\™HèO³ÿ“´ÕlÔ’å´ÕÏ&ÕÓş ¬õwY-yuæı8ëõ:½Z²xöİs§Î;1÷“ùãsçfO.ÌÍø—sÇN¿{êÄ¹¹……ÓüÁÆaøkcşoz:9‚’­û;wïîŞHv6woì<Ü½½³¹óERîfíF³}áDv©YÏÎöÒv9ëU’?ıò?“GØúáÎv¶wïr?Ü%tõtçq²{s÷tvu÷ÚÎîõŞÎ—0ĞæÎ’§»7v?NJ9ã–v~ìŞ‚^¶voBO;÷vïĞXjV0(|ƒC\ÅàË_%ø{çshMoí^ƒao¨Ù`¿`äÍû<î]èæ×Ôf~uçgèiü£ní|ïÑ;XÎñ&®l{‚æ\İÎ7Ğ5¬îÌôã§‚yJ“ƒ·ğæJS³¨òÄ¨áMœñİëj``l²ÿmÕ|OèWÛ0ä6L:»„wğó½léO·şóÌ{³øêK˜õ&<Ú½Ÿ@+x¾=\Å5'z5Ğ@o$Î¨¹œ”ËıÁZ#k’´Ÿ¤íõJ5çøJñ‹õµ^¾P-:³vÅ ±ÓyPíÃõŒ}Ám~&1Owş°ûÉÎ6n0CÈ&î¶:¿İëê85ˆ ØÁ¢½SÅx pšx 7¡£íİOv¯: PÅkq6‘ ğôLŒ?‡n"|³ó”?“ ¯7w¾¶Àô9lş'pM }l:wa7ñÓûp«®îüşÏ6BTk8¼k0O8ËÏïñ%»
<Â»öï5_âàƒ;¼®m„{0›íİ«%½±„àÿ×;íş ÏªÙËt‚ıœHÎıı’#Él¯—®W›}ú»¬z E}/à Ï£UÔGGúF5®%ïp8œİ[0§¬×…©ö=GÙ×x3•_æÌ·Ù_à/N·ÔG0Ióp‘{ç‹k½å´•õ-	/Ô¤ûF?i/š¿‘5÷D£-İíŒì±¢¹´ì£n«Yo468ŞJ›«´º9õÆYÓl!ûp-ëÊ½ìCÕ'âÈf}ï{Éè@¹Ô;½Æl}Ğ¼”šöì`­v©ïIrê„T‚MÍwˆu’_ü"))²yvaöÔâ[s%‰ècû —¥ıN»–”ğÒòeÃ{†ˆïºâ–byTä)Ó‹¾ˆfİp‰•ü^¡3{ƒÕşíÉ¾QˆdÕå]e¬¥±œšhdnUF¨Š|hÉº»1ù˜úS x7ñ¡
I5ãpøìˆó7öŞÎ×ˆAqœ;ßıUÖ#Î@Ò¿W3/"7¹3Ü‰O¡gä9®%tö74}Vs‡§„ˆa7ªzHèç6RÜT Ø5"Æ°o€èSÀö·’æéE‡«€Ë%¡Ÿfûx7QÁĞ# …W5ùy‚TçüRó|Š+CN…ˆr=f7à»x¼·å!>í	öûÇ´À[
ÜÒ&:ƒ»0Ê&·¸Ÿ»gH¤îáÆ&İN«eºÕ¼”M!fv
ôñ€”Î1Ò„¡—û°‰CÆ ÷Éíşí„nñ[HŸ ;• ¡{¢÷Cœ.ï€„lú€¼Şq«ƒÏuV»­l5fğU;»œœ€%•+ÕAg~ñô"¤²ºš¥yø4m×³êZ·Í^ÔÓ¨6Q©©Ô¢3Ñ åÆ¼{^€àßÿ ^Ø×i¦H¹ŸfµØâ'iŸ~ÕJûƒ“Í6n^AË}R±£˜u1ø‘a8ŞÒ›œ€æ4ûï¶›ËÍ¬ñ&=Ìi[±dHó'u˜=qƒL«²î¬_®ØçËÍv£,pnùgõM;9ò¦xœ$íNoğùÏ33§ŸÕ«HÕ*	K\EMs¦oq¿!#¸1°ŠŠ $ ›n¡!MAZ=ˆ ¬ZCûH€l­€ãQH„ÅO¾ï„vÖyşFË`ÛˆĞC-k¼{¹Ÿõ.e½¥ı•ŠFG1üş"ìSu‡Oî ©ÛFŒŒ(	‰¶ù4
Å°¯P ã¿óubç H-‰‚
oÑ§ÿŸÂöŞÒ•Plh+Ê
¡Ï_3úü#Œ¾ÍËÒØI˜>öÅ%¤D«„øõ.ş›ú@	ÿß›ÃŒŠ4ç6
fŠ4!‘¢rgçóRTEVØ;–¸ïJñíSœ;Sû{¼ò;$È©}/#ı"ªÛŒÔ|{÷v¥Z ;‹f/kj_uÖÚ
Íáã²s]StCj%¶óİZÒì"‰×"‚|æéeIğ“^Ó,É†O6Òó·ÍÁ: K#!(<7ß¨%‚”¸/O¥«™}İ†_¹ã¤€wŠÏ!§ÙÈi³ôá<6ÎgšbŠÁÛ	0|éŠœ×Æú¢uÃÖµİß0lÇ>Õóz=Í®ş×ÀÈì…ÍR¯s~é7şèû£>­å+³ÌÈıŸ4;-‚‰÷Ò^šC»5K¯zËÈzk™ĞÚ1ÉI÷@ÿÉ§#P½4NíüH‹¾8Ùóˆ^É+&x‘×iœ¸9\C«S¿èÈ¶¸aÁJÔÎi=@µ€8…´QÔyØ+}’×ŸÅiĞ©b0Çè[|NH8Õ^sµììƒöœñâH”$ìˆŞÏrXÕÈi­²JçX‚ë×(üi¦0¾hóŞS5ºËùø Œ“ó²ÏÇp!ï¤ƒúJÖ?)úL,£uà@xÜf’ø:Üù>+ş$<èy-[ÀmvÒÅè@, îÊÁG“ŞËásw
Jñl%‹	<Š» 
O/¦Ëi¯ib$Q:­êø˜`.¾´úÛäGƒA÷t»µ[Ô¹ØÌ„ÚU‹¦ŠÑ“£i¹9ÇŞ—œ=ùºŠ-P±{æÔ‡Éâ¿æ7åÈğû	éT®¡¸ò›¤„&{k<6‘£{Ì“"³Bìşş»ïq ¼ïü~òÖõÉÎg»·e?…7¸l “W‘bóÇ—4àv5‘:"Ÿ4ËkÈ•¡$vÓrr½ß—‡my3„¼ë
 ’÷
ïkü*WI#_2ñQNDL)æs¦&y¿€}Ó¬¾Ê€‹áFÔRj=¥KÊä r¨€$dÉá5àè·Ù9Ğ2€ãŞyS+¶#ĞIæk%ô’Íd‹Z@£)]®©j+lÉ[x>ç/” B8 ´¿èîàšÁS–Ğ¬¦WğªqÜR•@Œñ„Ó#7Zä‘½±´èyĞ9®~œö‡ Ğ¨3yù&Ùv?Ù½!¶m8Üƒ^|ˆ‘0?š¯è²
ì¿ZëâæX†E"Ë	©A¶X)°•g%HÈ>{şû³œûóßÿ7G“ÿîM~p™ß™‹æØ[ğÔ>g? 64¸ê®-ºpwÿ,.ÓÉ†tƒÕbv®¿C˜«2ÿd!~F­CVÎ´Šº<ºŞK¼Ÿ·ñÆäÛ“4úš0HÕg.á´¼ÊúxĞ‹†ÿ1–ÿ7øš1Ã0¿†6%xù × VFx•éÊ\1Ó¹!ô‘´æºÃ?>§Õoj. =BÍb éÍr‹pÍlw_/P[m ıæÎï‘Ñ­SÌ®FhAO‡Ç$è“¤‰­Ü@•;ß$e-Ü¤1îÃ¨¾‹|§]*	¹Ô|‚¿JJàGb´@v.ĞØÕH8™Ësy_¥‹eœJlBU+œo2ìL¬ºÿLïûSôb}ñ2Z=ĞÓùhjµÙKûSf¿ÛJ×§VQ1SF·‘¶:íìO·ÿ£{9%Û#ŠR9UHÕkÜ†4Ñ á¿‚áŸâ½aidyy³z†	icüNø‘áŒ~ÃòÄ‚OŞ›t—PB³¢‘àÃn%!Ğ[ÄSu´hßiöWQR4’ìî øÛ‡o¡(£æÈAÔ/ôA÷ïÙbvampû(¥J(7³Â$b+1Š‰g¨<Ôõ(ÖÏA H96ˆë})Ÿ“şÀ{-Â”ZÙ…´¾^r_Ö‹^ª/ëıp	•ò3Ô×ì‹|ÆõşQ…FùÀşpÄB1‚£¯$ú3qËú¦F¹åœ;§½zÏ¬ã_r8EEâ?±‚›¤Dè•Q,¤íV»É"îptäÁ•-Q™*£¼[·È¿ókÅÀûÌƒÃ|ÄÅ¼ï“º[¾oô‹ıİJïÒíCÙ³Gã²§àÙß	©‹‡JÏpí#XãÇ·§æ™^øN>ğınàzëªŠm;ş&›íE6sÍE–„æ“ï"ÒqaS³ñQLT' BbÂ€>¡#ZÒÛ"3R4Ü$oÅMíØ§ µ|ÊO+U-,){‡6ç“;üÈ¡< FWÜÆKQKHï¶ERSŸf?¥5îõ”d£ÈüË e}Åş9l;ºïºPòÊ›§+Ì=h%Y”•¸Ê¶ÅJ 	GÍ‚nÀïp_xObıóéŸÛZo÷dçvø™—ª]tw	Mv~³òİ#´4ª2a%Û¯Éå¶º"D[ÖĞñIÒˆø¥À1Û0Äò•’{i,7´Û)ÁØ´T/ZéÎ‘‹'t”ËÂq9&[ù– m~ÃEW^®hÉ"]†1ä82lõÉ†åJ^¾%ş¹”¢)Ü4Œ÷)ˆ™ïP©ö;«Y¹Ü0Y/H:(UÑ(Ÿğûa:‰ğŠ8>ÅpÛEŒV²sCÉÊ¡°{à@ƒv«È©úQ½X9Ó]g»T.xT#ºÏ•½›àF	8yúíùS‰,ß<'$…zÚd¸"l]¶j9‰¨T¤İéÙè¾[ò²ó™-#SÇÖ3’ò¢Æ<M¤C:H$h÷—:şŒt‘[Jk«›ÍŸ©åŞ[×Âc¼åµÁæî¯Ô$´:—½U¿…ÅhËPBéÓjÒ­>Ñbæf85|Hf¤?B9ø	¥¹À‡e¶—£±N–P¯ƒTHû:şÃã©h—·œ‘=" ¥˜~SæÍÑÆŠù“_M»÷P¤ò¿ªT—›­AÖ+ëtZYÚÖıÙ@2!%¹S«¶²ö…;K´¬^«€4¤ @ŞŞS˜Ä¨áÅAñ%R”oÈñ‘¸æc4¦uÕ*´VaŒi6ñ×ˆl[¸ˆ[_RòFö„Á[˜…NJ×ë¿ñ¤©šcôADà›p~{–UÑŞçÿ¢³óyF3½ıA(‘roß"ßy43q V™Æ±F
cÛa0ö·º»Ö_)çº²³>ë¶öóœ}¶GvÓÎÙV4â[lã%<?ª?ª%/]	·kc|ïi$Û +_!ÓâaÄuÚ¸GÙıñ§¢ò]§"ëdòO2ûîÙ%s§Nœ9=êìbØ€>[È.4û€¬“ÙV«s9k$
LúI«‰„­×YMæ>ªg­äL
í’ã‹?™˜H»İj·Ó”KÓi·9®V¦—;½ÁT7í÷/OZšL˜íAÑ,¿
 nœZ[]‚!…Ãó¢†!ü¨ºÔi¬­êv†Ö˜ş×Ÿ6®¼:¹ñÒtu€±¶¦_µE=¤ÄÔ•_™©T¬jùŠÆ-ÀÀ©l
@ÛpÕnj©u“BAî"ò#×¯	¤UKê$xšŠŞáè®7P¹†³cx¹PÍ>,İ¾…*GtuÑÔQ3 o¸ÆÃi÷îzo½;èT{i»ÑY=¶;]~ùUTı•V²JâãKY¯¹Ü¬KıÕô¢Õ ÑìJ'g) ×á"b¸˜Êï««P­Vs¢ÌÎ( ¢°=%Æ:gÄ˜4Aö±‹¯wV»€[Ì,ğmÕŸjÅhsÁqÌÓƒ.1rÏõüŞœ¥Dæö2È–ÔgHûÄoÚÙGİ&œ´û^|†ó;ÛÖª’|?94“ü=ÿßÁ¸E¬¨C€T¾ÀGç»½©—®`§Õvçr¹²¿"°ôJ JB¢aÔyá‘£DEóTwÅ>(qD•áJN/s«@LD7şvZœYé´#ÒòÑj_P8”¾Ÿá+İHCÚî„i$lã­.«kxÅSg‘â9>ÈÒúJÖs—eYxn~úr[51ô_td9t5ŒÍXªM¬ìØ×PQ¦X ‹ZÄï“ÍöE ­kÍßiümÈ…j®àÜ¿²ú¤¿68.á)lêD×ä7™Ûš+Q³ÿÛcç2B1”T–W£~2OÏâ-o¥}ˆÙ5 ±<êSÃsù ¥x0«@.”ÄÙØ×»¬Ãø?¤“àL À3}ıUH_‘G{ª=Âo«‰¤É4odÜäÖ=Û8o@6oq"¬Àİôıç=ÈÅ\³B°wÈÜÁ´ÑÖõ5*P± ‚9yÛô–iÉwü&4t¾³“Û'lvéªW9ZµtğåTgà2V=¶ZA;ëõßGÛXo*Å¥èÃwÛvµÕg:VRÂ•´a¨f‚×'!$ŞªÓgî²İ4—×Ï2õßêôye‰ÆØïjl“ô4`5ÃóŞ5HhÃø
ŞvEÈ¯$ƒõ.œcIKç¨_	b$¤¥i`²İ–jÌPÃ{£…XWºòf):Aåé®Pqú·Eô*ôu‚¶u…Û:ÖüˆqwÜH;£PFuôæwˆN¬25gOÎ‘Ò§l‚Ú!Ò°Ã°FY,XäÖ«ğ ¹fVDXZ¸ÖNªè‰ªƒì-VºfÂs^G)˜õ^Ø}øv¨ÌÅü¼Aşø_T²¤}E°(F‘n+Iò‹ H”¿BóØ·ò5÷`ÄQÓm³ÿ^–^<‘-§k-#¬”Å—€ªå!§êG¾¸ê@S2´Œ#<*«@ì‘x}MJÊ®s•®ÿæÎ7ğI,;Io‡¨@GjpÊ&t¥?”P&
¨ğä`Å\Íƒl—T‹7%¯ºb‰9Ryu`"pi×Å ùbÿ«¡Ø?^Ğ|lÄCT¦šå…µ\;YíØP¥¯öE+jl¸ËŠ²~x$±âÒ„UTº»nÓv/óíhŞ82×#f®G“O©QJbM£Yjòá÷`>üßwöº`ü@j*ƒòû&kßíD¥íº¶C‰¯„fì¹èd,£hWÅ£C¢
®÷«yÛ£-wPë™X­¥æ]É{aKez‘*mÂÉŞ}Œø-I.ˆ	üsŒñ?b&ÒÚ ÿszî}ø·|ãçkpwY›j>n‚©wˆeAˆeˆØóˆAAlÜİÒ¬‰H˜=ƒƒd	fF^Ó°?ŠgÊÌÖê»’»ô{Ÿñm{m¶øËÅa¯TäcÁê?w‰Äb8öuØóº«6pÓaº}Ù†Îˆ	ıø…Ù€"TK\¥O:@ÚÙÎª³Ÿv«6b@[œ;£0uÅXn¼ßyÈÃÑ÷o@ú¼T{0!@¤;4½#ç­*Ñ(èÑèV p\#“èƒbÉC§ÄtcÈãğGî‰<’aÑ4®%NXÿ×‹_ÌànfÎv¸¬ò~x£Ú^IÛI£Â2É#ÕÔZÛÇy¦xöu(C,öV§W÷¢S>/Á[±³ZW;‚˜æ¨ZŒy?Wq,7Y›š<UíHÚÏˆuŒïb
Îï¬Óip±3¦¨Têª íÚ[­ Äê*½L{Úù/)¨å¬,´v¹zÌ:\½x'snPT—9¶¯`?<Jk_/tÛÊ‰¨W¼U¬sSWcz­Ûê¤)¥].P»]ÑĞ?‰.#@^´úŒÜŸÉÉ0é,£ïŠÑùB‘—ÂúÄE©ïq‰Î¥Â´ÑÊ¢cPÃ¦5ieš¥V¡(°¬Jş|«×	R¾«ÒjxeéeOÖ²šEO/úşÌÁ{´Bı¥3í}¿Óº”©;¸Xït3`°ÖzıŒÓæzÓ›t–%”›²]¸ï£+0a“²æ™¤»;&/ƒÑ­+3z >TädšíKèeliÛ„P_îQş€Qïƒ©Q/Sß½(â$|i\?\5¡}m{i¯niˆT[¨²”?¢°†»Öá=hBUôÏ:2íª:.uY–µç)B¹áüKN¼)A«±†e
€}™o¿KØ ºßå¾ˆéĞ.^qç®¾ëÔ¥Ì<<•*pXåfÃ†w ^<¬h'· V[8ÊH1;¦½‡S1,µvIÍ÷{éJd¥ÁìÊ7r DĞ'³²öEãÃ&å¼L}OMéÒˆÚ(Œ²0á‘p?µ—DGKm‘oâ“8úã#Ò©ºî²ÁÍd:yŸT±ØĞæQÁtÔ_a.w¸¦)«dB„
@KÌ4}•y¸Gäãùû½²ô}QèÉMõ)vÍKW!ìğLyĞ"ÇË¢¼ÉwİHßµşB}øf´ÕÆıéHGH~ìå^¨ÈyîÃ5[[Lå#írÏ¨@ÕÅÑˆÚ}Y7zÒEèV…¨'EÎbvFQJlŞ0ÍF|RóÚBe­÷–ã“<Şê¬5’>L¶!E‡+:XA^´ÛÂô%LY9Xi¢;®'éÑ9Lº®·Ö0¿ÂARÜ›ˆ£Ï÷L–;=ø>Kúˆ¦5#Â}U“³Ø10¹§b3îœT¹G—º˜!K '}ñçå•¬Mß¨™µi{¦‰\†İÈÍAÖ¨º¢Sv çAÇ±uÍÒºç„woĞ[wĞ ­Iª¤£ĞÆè—^ne€;‘†Ã‡Ú•~*9x¾y$™Á¿§Ïz3SxT½ã·ï7?°
Ü $ıø;İâ)˜~s ^ìƒía‚$$A?ÙGƒÈP†‰Z´ıÚŞœ081ï}€º3XŒíøˆËŸ!ÁMì#dåæ$ìštÏgÒIˆÄFR§€İ+ØÌ¥u öAÿ1r‡Wp~T’ç‰æ4º£¿©©¾5`B‡ÑŒŒñ¸—‚¦s(ºLb|* ZŠdS±¶_‹d‚‚lÑÊUIDÆ,ZŞ½©­â,P†á<yèSá†ó
+Òd1ÉĞ¹UåùEíÚêÌ.ë1÷è¨¹Ïüy“œÊ¬Qg¾!ø;ïšıS™‚Øw2<®ş
îG’"æÆéY¸Ó:½ìB!uãS«Šöò‘£¤9*;Ö•¹‰DŞİ÷­%º«e~cY¼Êá%D‚uîà{&’Ú™æIÛÖ‡©Ù¡ Q©ÇJÊMTYª:6hOÿ‚û'¢”?Jƒéi€8èûºk³îV«Õrt»…îó({”Gº¥–[/dä±‰!uö0=ŒåÉA¢Û ‘*k„+˜(*ó“f¿¹Ôl5ë‹ë ¡¤°ËÓ¼zADZJ»Ò8H ’!f†h>
3P’BÙ Å%çÔßÿ_UÎ@ğˆÖ‚8·²ºĞ*úŸU†rxš½tøAQğ’w9)Ê,FÔ¡Hz"tßÂ+ËÑîm*Ò¥Jƒpˆ†ç{¬$b*ˆlK*&ÎZÜõ:¸öÂu±gÖ0#õÖß«$®‘ªˆ6%WîãŞNèğUSM…ø#3ıošş\à_›ğq¹rá¡…K7Y‚ù2ûe¸eUª…áu¿b~ ¡µní¼v¯ÓjmZøi©ÎJá—Ç:D}çcbn@Š V«éŠÚF51=Q¹ÉÀhŠ¾¹0sş°ÔLPzÃ,Ûjfºã$¡/^+à.&¤µ@¸ÉDØ\&z\LKıÙ+”íë7îä¡gz¦]x6;\óbÛíÅ@ÔÎR{%EÆ'jnüÈê®úˆút6‰úâX=W˜’‹t&àÆMç’ÛÛÇ1ìD@Õ‚I’Ê’h¶Ôâïöd	ŸvlÃS¡Uádì¡À‘rIDNŒ›£ÒŞœˆ¢µWÑˆ·Ì>3úm¾Nç¸){­Là3‘æ;¢òvöAæbÿ  _Y-¯d´]a‹ şİ:"ÖÁ¶
´«yMn©™‡^¶JÜÂ|{¶Û=…'¡ÂI„–‡÷²æî#GÍÆdÚrXlÀ¬¸ıµøY ş·=‘¼ó0€Hk{<¸ÈA™ t_øÇlC¢EÊÁ¡,¼FL_‘íJ]‰¸6L`¬ĞÈ3^¨.§ôœŠ¼†÷¢äg…FSSi]…ß0´ï­WEÖ7óÍ>Xb7·ÙÆj³Í6Ã@ÿî„€šxÜñBAI‡£åêPƒåLĞmaÒ„sf jËÏ„2\ÜæÁQ°Zs¾€ANv:×º&&Vû.­'km@Ù ½Ö“ù¤Bé7/´±íÚ ›ĞòÀƒüÉ[ÔéZ³È¸e°oc¾0lYœ7í¥«}¥kÓ™ƒöÖ›K½½èŞpÂÖ¦£†Aîû«zêp!•òã6îê1Iª ˆw()é–Š§²¬šV/Èz»L,ÜT6~”†ù’Â.Õ¶½.†½êq‘Q/0hcšú×[0¡Å"›Æ²ó*Ğ«YïG£îÑ}»á€ZêÔoe»F¦¦ÛY–Ù8.hÕß)7®0üzÃA¹98W­jŠï×{5&Öe“¤D”QğÁĞ,ËğJ¸Q°©dÂCèÙŞ{šxäNì75ìr©Ä#3´å×laeR¤šçÙ949ÇĞXƒ)ä%é‡}‰Y.€ØHÛÿÖÿ²Ö
r,ØVctƒFô~DlŒêK‡T‰/ş'7tÒßíˆI}íÌ{Ù­ıìQ9(Ô¤îYˆd7gr6Œp¤µYó €5ˆs¶¶Ï„>LØ<¬[Ä|'Qo7bì’BT\Ê.&yüLy9ø›¨…ôÒÑ67ôY‰
BQD{ÜÓà•‹E„»¿K€I;‘]ÊZ.Ğ³ğ	šÜ²v£ÛAgæA‡ÒY`ık4ô¡d’6.­“ü ×HšÀùı¾!oeeì5ÓÖô€ûŒÆâ»)4¢Úpg¥ù†ë©4áFôÌG¸¤"Dmù•-¥¬yœŸ`&tÇ(´ ™iî»phËÌÚõ´Û_k¥pDÉ‰cÉj6Xé4’ËYRïeøpÂQ#72<Õñ	$›S±¶‰‰±œG¥uÊq-Y}åzJãw7ÈK@¢:»a™Ğ'Ñ^kZĞ"qÓø)úù D'›"óûeÌ76¨ºHÌYUĞM¶M(Ï:¶¢„†l¿ ùÀ3ãˆªë`Z¾:L{c<G?NÊI¸is<!÷éíĞ‡óé¤Ì¬={lò‡ºwƒ»Œ+cñE]iğÈÜƒÇÜ¢êww¾Mœ#CÕ’R1©-¡búüò\$•&RúJ:ÑuÚ1Û¯6é¿_8ïãAu½’EDsšã¢©ĞUr5cg
íŒà¯<Îõ­á³#è%’*ó[ÏöÒ¥fıDó h×Ñ&µ9/ü Â¡˜5vŞø‡nšfƒjÖX«^¼L;¨d]¦Ñêß“@¯zÇÓ>%1ÒøY2ºÆı~¯¸İ‚Ï‘*7Ñ¥=«®YkX…›"¬òã$ºcILHÉº0TÄeœ×Ç"3‰.31}T…YÉäÿûô"%Tî=.rw3 Ÿ”úB½4`²y•¦%:„‹A9S{w‘„i`æ=…7î>PtöSÂ\êSŒÿW¤²¸qY¯ûö\·Èü©2tEgvY5¶çyê%ç®gW–™wBmôôıİ_&Îå
TÌ@_Éêqš	Ş}	Ø·ö…>rkZ¾Ã€cKÄÏ6›İsU{»Œæ˜şò•\9ç¯l_Bp‰ÀÜGğ8ôaó¥CBÄÓ«3N†H€ f6UbûãÓ©êË§e›8äim±œı_X©ÿ”lCñ–•ìØè„ûÛl¶n<¢uv†¹Ïl,–ZıÌØºU_ùêÍ,<Ts÷p‡^ÀÌÙuë›|“‚[LòVÒc™5=bæNgÓ‘¾Ö#…÷T%…¨éî“òîï*Â¹ÂZqÙdK&õäO·şÃ„ş†²™ıŞ–”l¡
5£,eúQ³ }¥ı±ˆ
ïü—™	ı¡Ù~Z‰ñàòîv}µ<'ã,®½nWÅ’ï¹KÖ;d“š\§-¿1mŸèmÁ­`LÂ•t?åúzŠÂQKEQY>vs×«$‘T-¾„®?\+¦ö¥'ÈjŠJC ‚œ‰8  Êº6÷Í{«÷ó¿RR;DàÊ·ıùA]Àë†Åİ_ílV[À9erÁÁ¦ñ=à»\œí:åœıu÷+]pRÃ?ı•ÎZ«AUBüW‡2úÛi0¶H)ÌÅV³Jù×5ëûVúYjee¿?LkE˜Jñá@ò)³Î÷ç¸k$œ»[ÿû·Äõ*
yfO„UşŠŠ<ç\#ë}ŒÕQ±:Hô¥w róy(/.æV'– nöÆjÁ¢VlÊ…µ³¬Ñ·‰Ü—2oë¬¢i²™»y;kg=¸hÆ\2NQR-&k}ÔPšPÀY1K·×¹ĞKWQóK•û{/ê– w<ïİyÚNNŸ=ƒa	™a£W×(¥s©Ù`ŠÂû_ıSÄ$¤Xm4{Y}ĞZOš‘ĞÎ>ÂôEY·ªæ¿ lÙj·ÓK{–;Óš¯¤ß1CÂYÂ!š=mw 5îI[S²:î +fô–	PBµŒ-q¥èmR …  õ/Ç;íåfoÏ&)Ÿê\¦yVAó‹Â#IÊƒ ÕÜ0²›êºÏGw‡9èªø4nÄp”!ĞlÜ¤x¨¤û­Ô% Ô;â¥æMj´ÕàpÌGl{¶fó&ÅnÁ
tkÆ0›G¿ô
Ø©yÊ("6]ÌÖ“éä-Rš?7 7k@ö…3ïÍVÍ‹æ Ÿµ–Ñc,m¶û:ÏzšàE=½xû{§ÙÛyÚWH%ãH¤÷²¥Y ö´Œ_.é®4ë¸ÎµÖ€â£ªQÀêògF58ÇÖC;FÚ_o×# &wÑİ}­«>¾Òn˜ªï¦€bßÂ0½!=×ÀåÈ_€ÊUŸĞFöÅÎrA)Û©j ÌÊn6÷©óÒHÑ)ÉÂnäAeŸj­bÅLc$ Uõ‹2AÒ¹nX5ŠDjgĞ£“&8©6EÌû >	'eÅİĞÙ&–n˜åQÒ~‡UgA‘òğ+Ñ„8/€FS/Ã­m‚"Í”İ‚5ã\Ú§•şá”ğVĞCÍÔîET ª6@YÓmÍ¯ÖëÂM&?b¿]®+á´êt¡œ^N›C×¹ FÔinc²^—[gf<÷/çÎœ;5ûÎÜ¤y=BÿçKÍ‚­w¯†c±GuöÒËöfè•‹Ö5Wä¨ó'jI×‚ç‡) õ>s¾;ÁÑ˜¼Bjá”i ™•vå,»¶;íÌ²‘3¡ ˜š²XyÁÒcé ®n`>N¸pí>bë¾jfXnÚ,‘)ö¼æieÊÒèDT©İIˆÁ¹‹ÿ%.qŸëİPZæ¯PGÔÛoRGY‰R<iª1œí¬ÕWğŸpÛî“>`{ç’
İ!FJ¤A@{Íùµ’Öá±(¹yZI«ø”Š™9.Ìõ…6í™d[Œ8PàÒøq¶Ç†6}Jû)üœùÑ‚lç
‰?Lt¼góg€òUbóK Xd©­ ¤ÿÑíeË€ì²Æ¬üXX«SO[œPÍ|9h®f5èôĞü‘ì?t–µ1ÈX_{q“dƒ²ºóÕº&’6Ešv Ï¹Xt}Ô¿Í×µ$ìP‹nH¾9àËfxÕ/E¼ZH‘~^ÇŠ»È¡®´³¹>İåLİ>îkª¡)—ô•0’- 8ì&{•gáàŠ|½M¼tê(ñyË8YJŒØì¦tÍÍpI@Š›ı•gÉ&e€ZÚä0'x$ıX"	Têù?.>åøšñãñ•dá!™¤ü›íğIÇ ñUrTk˜ea–dåˆÀšæ±8[’%yêEô]À©b$ıôGj»]I€²ßÊ¬†IlA¦éaÑ.ğã£«2á½î€÷èµœî5I1fSİòâüÆgÀF˜ƒ*1¾ L‹R7›¨¾: HÕ)Ê"9ó¾'öq¾½Üíüc®ºPÍáUØ·¼,€pCÀš:s8²¢ÓGb²’}Vß{‹ØŠfƒ¯É~ğˆÚ*ııĞuÍ˜ı§ò&](#¨n«Ì†é_92Ãˆ^‰ïÏ‚ÂS6ŠlQü¾D«&ÂÓpY0ÍB wàD$ÃDC1Aä/¨¡Cˆ\6–ƒRd•+CéDZ¾¡tØ°Õ!‡ÊÑZÎFk‚-ËZâlØµ¥V³Nœ§Ãœ"eÑÔ40S!ËzZ‰Vê™áUï*ZÙÇJ_ê1ÄüŒz4'Ì7º—¥³É¾Û½cê‹(ƒ¢wÔãKòó‚Ë³RNn‚ÉÉ÷u+UÄ¥ƒÑÂå94~„¦^*‰±ÊZJ ò4ú–¶ñ<#CÑÊf”4t+±Hh4Rc¨JÁt˜®I(¯Ğ†Çê•;q›(%µ‚fn:IáTªs/šï–›ÖâëÛm”G*EU¤Ü·-öYìºg¿PS—T‡¾FÊªUŒWxt¶©p]#è}‡»u÷3Ø´|¼¾WZ±/ÁˆE"ÉH+ÊFpg3rÒ¦r
ÚÔÎ#š3Itæíü¤Ñè:áÄ=!Iñ£ÆŒ0™Õß4Èò^¸ÁüJ66éFºÔÊÏ T¤ ¦üK?CõoŠ°Rq’ß©ÛıÆS…ÃÔÆÄ?/ß¨RûUÀvsç·FÙ¨†¨`¼Øi7T•ğçàI&Íü8ùüÒO¯„7È‹Î>"…BÒõ~IİÛdÆVy}('™O©«¢û±{R ïv%‘­7<s}lÄˆù†ØuæÕ)yR  ×OZ°²½^rn|2]ÊZÆ¤pÂ>£%*è»^ÿV“´\:ÏRÿæ×­´?x·/ŞÛlÌ-‡€,]o X	íù0<]“Gğ?¢å¢]²®â˜¶òNy)ÏŸ;—tä|sç‚¥OÄ»™4èXôĞÔÕÈ¥‡Êx3gÚÅ†¡'ÔsÄ'Ø¹øŒg7NÜœ¸„Ê¯+¯:õLS‹DdÅƒ0½GøDD÷q¥à;ß²‹‰-˜«ü¸Úk9}â›Ï vE!!5ˆ@?wÚw,Ö¼ñ‚òœ²˜şbó\al„º
CqŸ/z…;èW^2‡|CK½s)ë­Oéú­ÿ3pã³u<A'JŒ°'¹§âû…'ğŒ¨YÇêÜ“˜Ô£ƒª(‰£ébÊõñD ± ±\eÜÀ>oŠKÙr§—ÆëIo˜¨(T$!*öĞ2x6¡Ç‹Açò\—.íMgZ¤1İ+=ÊÕ#¨5´å&ÁÌM­AxÚC—|¡í)~\¢e–%T¤&oÔz¥ZYTÂôœO8hõk²÷Ü÷€</Ôä~4CÅ#äØê’gœqôÖ{Ñv"GEĞËV&d«[&3İ*ì¼S·ıèpğ¸#èöKWœN6bì‹PÕ¹é<^èsWkÓ•l)ˆñ!Ç™»¤’¢ª^3?¡ƒ²sJÔåoÁ#Ô ×QCh‹s®S)h–#tî+êÌÁt”H¼ĞÈØ¨Ö2Û°ÀöÁÌX«ÀÒq‹r$¦pdRHĞé§ÔŠ±Õ=Ù¿Çmëh9fÉGçæÔ­yŞ¦Âë-êo:Ä×sÔr¢gšãUÊ„Š!ïGğ<†{÷	­S,åz9–j¡W£te4z·(:ñÆ¹&PÂl4İr>2·Ğ“	é#îL{b¨Lğ×•W¤ƒatìş¸¾ûKãÁh-“£Ça„ïF‘UÖ ƒJò§_ş'×Òü§ƒ)Àr´lZÍ#NãÒev³ÔN–aî8¿¾ÿTóİ©Ñ˜¡nûöU´ÈâHøõ;˜÷ê€ÈdàÅ{º§?Äÿğ¨0¹bÃ™|lóJÌÛËB'ÅBµá(DbTÕ¡^}µé˜ÒXwìF¡@)	Á"9´”.gwøw2´|ùı2ã‡ıL<3‹ıô|ƒ6 ºçí¦7V÷A•yÌyï{pX%å_»§@éãõVÇÁùe¿=ºˆæú††ŞE&GT&aÌç0IVŠ}$£u‘]ƒˆc”Ë³!©3rmkSéŠ'MLC}Êöì¸æ8Îå{ÈYµø ê¦V¨3³·iÒÑw?ë ´˜æL¥ÉË'¡ã¥†£¸ßjÜÁın˜^Ü/	Fx¿íÙÿ-ê—çˆ÷g™ŠgÆÉ§ü²:çD'qŠÊâ{Ó‰}¢£¡rûğ•Ë÷–+ò—ê1'²:Èr†Ø¦ëXT—øÒÔ…£G’›•áâ*«Æü!úª×UõÌ/U†H’}w(c½ŠƒG~†¿1Ù~oš˜êç²;óo¿‘ÎFp$¹‚õ»¼Ç“bNzã2ØNwµêê_.S¸İÛÖ£S.xëQcë‰
Lê»=KGyˆ¿>#yÂçÛ¥h!4G;Ï†0õªÑŞX{¡”j¯µZzº{¡+G÷b5	ËùQÇ(Fyo
ãA)JvÂ©#Åğ©8tcŸ}Ä¸ñ«bßİêW4`DiÃi+„«kŸYªü5Ó€Õş«ãõ6¨ä
Ê«¨Ñ*]øN×“é—EŒS‰8I|ë¨†E[#D‰¼{G)7p‘<Ô~írÊ`‘×Úâ&ªS¶œãPã85³zñ¦½C#-%İ”‰òâû<›ÊqsùNeâ/ÿğ&;JÕ6“ş{¨Àë›”™î¥fEí!ÌÔ‰7‰1V:NÅ!lBë?¨,ğ>˜ Âo\(hŞ¿<›¶7ñ,tB:bg<¦šÔ)HlC5!ËÑ–.!j3KâŠ`ÊŸì<¥¥“nv‡*6^£ô©êŸÒ9©Œe*¡ìİOvÿÍ0yX(Ñ)ä„yªD·»qØø¨™½G)÷î©`6aİ!½êíœ)5ÅÓtz	°MÊÅ5£~)ÙàG„Ê¥ãˆ §wÚÀŠğA©İ™¢º™%ëmÀ#P–´ÙnW(*¿’¨	´t"Çƒ@'PÌ9ÒkC9m„fšÌô¿¾ÿ¯?íÿÃßÿõ÷O«ê/MW1ƒÎ>›£”Í™_aÃHÄ´Û xD5Ô™s>ÃLdãemXA¦Õ©4¤rIÅù¢Gáİr™GrÕ©>UTyå¶Mû‘$èW
%h6®XE¡¢}Û¤Y}¢õŒÛ”Îõ®2Áæ`ÉĞ™_à¦{Yî 3 Õy0 v‡Ú¤R5ûbON5¿x Èh'Têö¯`'¾f4B(Õ÷>	f!,mm5“²ˆ y²¹Ú0XºYœĞ\È ú¦f—9a{é•™™’"«~9/‹¤õÌ»E9C‹Tä±‰MæT§º4kÂD,\ğˆê%?V¦¾kÃ #àEÄ!WpqĞé
§ÊÉÑT‰Œ|‰%m‚§ºnı“ƒ‡FŠ¨‰ì“æí^iÏ'«„ÿÄPqMS;õ˜Pq wİËÛ+L\	[µ½Óì¥˜|-+‡Ë÷:´«äÈÁª½´İè¬[^~ùU¼êÖ––àFzu­×rYA5ÄbòĞ ŞÏ+/Ğ ³^çRÚÚwGİ´‰ï‰³28Çél¾=(DCf‚ÿ?SqY[mn„­½ÑAgu› *ÔÂ¶ş~ræİc'çŸ;1÷“ùãsçN~{şÔ¹³gO{g1¶NÜç_ºba£úÒw6ÎÇ¾}·×â/Ø˜ş»U<ö)EæH?òÒ•¬¹{Ş]˜Ç´„6Hegw€{Xw…»gRöO¸‘°ëôbádYÌÁj¾/7ƒ•ZòÊ¡k™öÈŠñ²±Xàí9Şéõ8çÑI¬Ç—éİõN¯×•¤‘ö°èßÍ,üÁËi	ƒ^XÁ4=·LL}Ğ˜ëÍg”À'¾¢p=†ÿ›M»‰AÕ+–¤‰®TÃ0i}VÙ..^ÏZÎíäÑ‘ €è‡n“Š7¢EŞ*c‰ç	ñÂ1‰KØá…Šïh¸ó)ñ˜£í®õ.dhÚğ>Qz(†4 ikmt5@µ1Í”íA©#ŞKØ\pÚÎŞû[°­™Q°3îöò$«òaÎùL_
ôltpÊŠ“ã‹€-‡…ü¾6JÈïò4œÿ\äÔ4bôLÎ	ù,¸r“:ï&ƒŞM{}R4Ò?Î8,ºÅ©‚Áuqmˆ­tWZ[y4)—µVü6å$Y@;I*ìñŸ‡A:IRC)3ş¨ÅÚÔ=jÊö@$|T=B;I5E_Ùyª«b<!kG³´8yShîµE
:XèL’“œ'„ÿªVü^½%¥„Ö@±†Â8E;*!áfGüp¤İVZÏÊÓ?~iz’ª3 ³Ş®<±¯(ğDËrŞEQöÙu'¨ÆTñ¾¡±{ÑğoDüH£Ug¤ ÒÎv¡.³¡«¹Œ.ªÙõ-Ç	]ÂŠ½V TéŒB¢ı¸U¢ ò[Á¡WW ƒ:œGàİÇ,Št>}9.÷ëP¨¼v5Æ[Êo˜M^]`Ôä©¶Ô¦W*××€/m*È~r2äZ²Ôé •8L	ĞÖ’úê‡}(&qßÄ4Ù¡ßÖ;ì“Ã½€‹]§%ã¨ÎDóD½“nCgª¯¬ôë3DÅæñŞZ’#úR7Ën¥ÒğÙUêÎGÜÖÍì™Ğî×œ–	Z7y¾“Îc=½ã#x•æ|±hMC”ßnØf]ê™ã×G°ùÂ0¥7Èp¾XíO„¹5Œì~^Gpr‘ó)ÁLÖÊş,8e}ÊÏY®¼‘ (mÛ×›7ÎuëıËg÷éğ×ÃaK‡†¿1Şc¼÷Ãx‹^£	®ĞXgh€Ã&–‰‹Õ”‘ïlê&İşøfOœ;õöœR²æ€¢„ÀÀƒs¸mÓs4–Üç¾bÌªŠóTù¹i«Üx4é‚'vGŒpAŠ«ˆ”eğÆ81¯äà"±*ò-k‰ïîû”Å4'j^Öû¨ Ç¢ò\£ò`<ÏÿßG:q×ÿÑÅÄ?[$Àœşmnç1ï#ïo¡À¨›,haï‚£ıXÖ3÷@Š,Z´YÌ—8¨ñİ<=iÒ’Šˆ0¡#ø§PvMìÄJ©S
&r+ş‰JšÆÎ¡©$ßZ ”O…ˆÌÚJu5ıHnw,1&¨F'æNÎÿdná_Î½½0?ßY”_Vb3;Ş“iŞ"-’Ö¦›?Ó¬#J{¾p’“\Ÿ®Hw¯ûdşÂ‰¼€=Á°€ïntLĞw}Šãí~Â7Ëô‰qÎº
å+ó6é06UMßMò‡|í«!<TÙÇª,œh³¾™¸T–lTÏÛÑ_„W±uçÿîÅÉtòOÏÀÇx,½”£ˆòön¨Bª`¯£Š©áp ôó!ñTÅÖ`O1ÊÅŠO‡0£ÏHÅD_Du\Ls—Ãs?[Q<—-c_ÙM•¯³²x5ßGwÙä\ĞÏZïúB…iNÌË ĞeT¤p’léGûÕÎNıïtêç3Soœ›úàÊË3“Ílh§Z3‘Êxf¬(Õš…Ù¨ĞFS™yz²‘tdyj†Q´]®‡§‡¶:­Ê0ÍÀ3Ø¯M#k5zcÂï}¯X“6’æBĞ]Å‚ò÷’ªU#G^¼‘Ã•i¡³æ>İ4õ™F½5ÕËá>ŒRŒœ†v<'£öëU¾ş*Ü•Ò‹³H¥èÿ‘!;ÿ@cT°À¥j£I ŞpŒç"ªÓh‰Ìz†ô¸ªfäz@ê­¿0)]ˆ!¿ Yã"ì•”ô÷3Üˆw¡Oğ°<¹6§ÎÌù¤Ù’Şä‘ó^_~)%X«]‘ÿÏ£BÁv¢îyüG‰œšwÈ¨:"t˜F<2İŒ¦mˆœZDùĞ¹QKE6¯Ñµ¸Ô»
5#ŞÊ½nİ8[[>`vJ5ñİğ<•DZ¾9LÆ¯Œ»•À'•ŞÆ×éà¶EÖè#^9Œ³œ`Hƒhå5|'6$´ŸAnZ•œxĞz}„œüÂìÂÓK/«(7*ù¨·Ó³'Ş™?unqnqqşô)iÑjŞgçfÿhnÁûäp0·±”e¹} l¨¬è÷×”N¢s9ÚbN`F€²ïóŞxM5I´p<éá’‘‘ŒB‹C+µqxl`²
BC6X]åÎ‰Yñ‘6òÄ[7uO¡¨ÍÜHŠÖ±×®BŞå¥†š>Í+Tñ+Şıáóçş#ƒkìõÂÚç¬âñ°fä(‹;¡°Ş˜/Ìdã&Á:´YZk¶EÒ‹X)Vl°Õ39ƒûWÊÈ”*LGÆ<Şé\lf‘á0ˆú'OÜæıpzVaHËËJs)[àtğ#‘£p/±•‹¯Yñ¼Çò!\$Æ™¢qWÕkªå¬R—»Tá¼Å^¤ nü#™ó¡H-Srüèöj6JÈ€E¤¾sÓ1e¬‹¶¯3Wÿ\°ø‘–?Â¸MæÆß·¥8õ?iNØ+W]9^ØŠ[?j4W¼W†»â…æb§°Ôó`©£½¤õ7-e¾–2–•õ; wTc¦èiºá•pşÁâ87',z´3¦–q¾Éi¸£µx=•ñÀI‰Æ2ÍëÛşOŒ6OöD¥ÏJè@(È#VéF›ÊR§oxZ ÕBEeS:gUß½ËùR"‰åËK½µAx½WÏ*Õäu¿{J`ı§UEUàœGyşˆ:ş»‚áğğ#98#câÿtû?Œù–ÆA§™0ÕÜ#/ÙÍ]Œ·9k0(¸Ï	¥°!ÛÁ [í­Õ/f%ÑæûNÚıáÒhÒ Á¿®°EY+'ËÍ^0+,µ:T` ³%tSoâİçá8ªù½ùS'N¿â‹øûäşS»íŞ™ıçsoÍÎŸÄv¯»¯<}üÇñ–×ÚdÀåµ-€Ìğãl!‡âGZúU¥gL(·vs°Î–²šZ­‚T‚.¯í©µ—®h?8ÕI4‘=HoØ9¸×/Ôã44Xdv‰;¿É	
0iáGT¡AG˜ô0‡¥p üÑi7úvóE£%Ø«ÈqSş[«ìÎTLÎ–%Ô-Uå!'o
]TÅEq™éºñ´ÁŒÉA¤óYö™r™¦cÖîŒ‰„ìg†c›rl¤üLœ	£`:”·€¡Xëe#A‹ØZ4s	àMlâá‰"¦R.:èŞfÎYB0cÚRU]A8ïf1ùX¢d~êÚÎLŠÛ¹<é]×ŞÌ%®ò|.–9yõìÍ#şÅ¬ø qDéEÜ[J‹Œ,®Ï‹ƒ©TòNd‘Qúè'G¥í-†ò	;Tê¢‰ã2LàA¢«~j$‰,[9‰&’‰&V²J•\Ôw}ú{¸=]/K¤³ïÒ@“É¡WƒN<ÏıÔ°Z\k€Ø	Faäc—Å¾¨zaoµ²šK­¬ÌQFŒc€†.Á¨ßrÚÚa™>Ó0dó\×fİãìl68-v`¢Àšş{ÍÁJ¹¤ÖQªTÎõ}½°¬k»ßm-ÕJ’»¤sÁôÑxoôşˆ¤Ùj5p^MôªŠ­uÈÎ+öZ :Îš-¦ËÙÜ‡ki«|l¹^u¹×YeXç&ùÂLF¿®Öym˜1s—Aï6ò·p%}ùµCÁÊ›6pWÕÄ9Ï(òº8Sv<ãí¨TÍÈŸË-PóRgÅ-õ(j-ˆj9€Ùì¿—¥OdËéZk áS\9/Y¨ò.‹ B5îKøê+£¾üÊ«°.ñd†şğ›ÛçM/‡·m¶J^ItA»ÉÄÌmCÄ"D.ßĞM+î	±õÖQÁ¸ó½„>Eö¸H¥Ò»¦3Ù=Do5,	’PJ»‹µ«Y’áoÌ¦ë©‡w¶‡ØÊq2;!]$›‡ù¬ª¸İˆ‚tUj:âë€ÜW†i0¥•»¡¾¾ô¼/&ŞúúÎg´é2ç£ª¤òÒËĞÍø™C3•âä)ÑáëÎ§OÂAÀúv„W <S–±1oÏ0^«ÑIn"5¥ æ±îuâÙ²8Ş	ªgóÎüÂìâ¹·æÿyî„11‡pföìñq£³@±;½PêñVg­‘€”‹,î ÈmÚEÄ×ÂúÍ(^!+ÙGÂ£”rÓ¤“LÒ:±)ı*÷÷ã,ëöÍìM‡o =%é¥N EBv¿ÛJ›íVd±'è“UÍÒ—›e¥„å˜Æ¸\[µJéJ5m¡*½˜^nşC7M³A5k¬U/^.YEb“¬MÖ’õ†#µed	=TF¡$û˜¢^H|eocL¾	ŒP{×S¼*%¯Õ&“÷næûXòÎrŠ!MP^N_ûÁÒ¡Æ+‡²7^åàÒÌ«¯½²üFıå×²W~ğòk3õ7~ğÚËË¯|==ôJ¶üÊëåÆkg^şÁÒÒë3o¬C;íÜ7©¶°‘Âb³vöó!û—×.Ø¼aåÎ=¥È\›¿àd6x÷MÖÒ§ qîñ‡ÙÃş|-küàlæµC‡ÕÓ¥×¦¯½r°şÚÒ—a[ß8øú+‡f^}ãõWë?Èêic&[~m9}£1óú¡7^~½qè¯ËıÛ8…]ráñAùıW| ±³ó19l¤lV•«›t1Wûpë²H?Æÿ{tc4C†Fåù4FŒ¤æNÃT£sm{J1O9Ôeï“1½şŞ¢îG±³[8Ûš.äë¸õ"ØØqq‹€X›^?R…]ìÕ^Øì$6‚Î®Õ2†š­÷Í<ş¬Î>ªİ•N;“V;KM¹8àòl¯—®#üâßeà^HúäáÒÜ'	VN3Ñ)Ø(¿Ê%t ²K(¬©Lm½úÈ.ÉñÒªá1Öùé=ÕæTûÕ¬\¦_ZÆõê*!. ÷Ä:‡Ã[n#q¼ˆ8×@„G“æßx, doğÀéææ~bLşZ5nøN¯œ„y])Å=L:ïF@yB<Íé¥€A>LrtTF5JPÉÀ¨½mÒlå©°ó5y<Úy`´Ma$ì<<şÇ‰şD°M¤r5–Y±¨‰æ1¶;³VC¡İ ';¹“™ÜîÒKWœÑ6Ó>4gÏñ7y9ımÈ[E8\æØ›Ñéê Ÿ¤5|	é —†Æ ÚÏ(¨î“r²Øc½ĞÑÎtnú5.nŠ¾ç›2şSús!‚šôİÛxî(TV;FèÜİy<íÄ´AëÏ‡|-ª‚»ØFWÀjdóº-şs>qëü­Sı[å¢©V3ı¯?m˜¬ñ.âgxÔ«t¯H×·G¾¡ïÒ[K’úTs+$(Ü¯ÍË¢r59¥|FÄØŠƒ¹Ş
¹gC&rÊ^ç¡u~SÓÂ
éÛW]Ë?îBF¢MjµzY¦ˆ]üàÛ3FĞÄùî$âÈüL’`°Ôµ¥ğµë'm’©£FhoS4u¼ÊnÒÖ˜:–˜sğéµm?o…Åìİœ„¹¸±ÂÉâÜ1T›$ÈV%JZE3‰F¥^?›ê×;İ¬‘d¥«$ĞN&ıNBa¤~ qÊÒ‹É`%Ó7öAW”b"mYŸúEq³³%:?„-";‹Ù’2øpyÁ£èĞñôË„7ØJÕÓ÷ÏŞK… ”áœ6®osÉØ¥'€eÊ‹érÚkşéÖyo¶Â@ÀFş•—&!¿ ˜aCª•ŸÈ0_´ö³ók^Sö½‰ùIî£—%â½kèŒp×øñ(ï¢îÁT°dŸ±ìotO'ĞÇUL¡O¸€ã’åv’í—ÎLr‰hß°·€Èz]àøÎVêXrêu©zËi]h2,/} 	®ı –]«¾[°#Ê“İº.iî•oéZ£I
åşxì$%%P(ËRe·š•zíñš:ê[yÇnê Ü{´«_ˆ‚Pš_4WÖ+†á…÷œì—ğßı„kÃa~¡o¶Š‘½Gj>Ö¥vÔğIÙ†Fí>«”^ßù¼TnÄøÎğeŒÕ³¾ † Š£¥ù·:¨§<2î©UûüXÆl{;.‹;Á-ÂûaëüKWä‘oÔ€}¡•°¶®lö¹JÉ@ü‰>~Ëå_Ië]ÔõàS6ğÒd&­f“ÒO—<¿ó\êNÏ¯ø”çÌ˜·0K$‡ßÖØeUµF4ÎušŒ)ñíûŠêÓF7	P#± MÌ•ì¸P†£?âÛ¥8KÍò:YĞŠ›Ì!m;Æ°ÎŸltl;»M€d7¢Š„p¾±aêfáõ1íÄ“$»Ï.•uËåP7]æ¶F?_£«iõE‰˜°©‘;[³O˜Ô<,^‹`Ëk-…îËßÈöÈğ'ÈàÀO`b¿Ä‹*
…ÿ€¼có|›ôhç×xÔñ İ%©á¹¶ıÍŸß¾[™pì’ocN«3dP?’t{kíŒ§ã çeÃDÀî\!ıy…E‰ey½¾1m
×E€fÃ2§`¬“;)KN‡]¤‚k4ä‰²·‰R'+«ÜFÈêŒÈËPd¤€»7PãÛ!à¹GàTT{½ŠsC9?’¶jæ%Y‡,ïë)Á®
{Ö¾ÄË€œW2%Sh©ÓÇwQ±rQæ
ár`¤Ëè[}®“©yÖö¹v¯Ój­âĞE¯:±ÏOğ‰–£k¶]…N½ÑÅ|ûi»9°“*}¼ÕÄÀ“˜Ma†£~¬èÀ2ŠKĞ÷Z’ƒ+eû”Ô#@Šæßzß0¶íu\-~šÜĞßK|*öfÌŠ¼ŞVÆı•yÿBÅú+¯¯®fÈv“J(Ynf­ŠVuÚùş4*;úèkƒ×6$,‘Û	d2üPwGòÖm½œ®“]RR²¨KKz59í—{ö kÃ°ƒf«…~W}İ]gy99¯º8Âm–%³İnuĞÿ¢2¤¹'	`ÌÔ–9&ñp°Ò‘ÒtÖ]ëe­õ]•ôõ•D’>\-›0ö…d)[IA@èU™qbS«®h«°›«!ëk8¾Â@è‰SĞxRƒ²‰–idız¯¹ewÈôjla¼ÌS˜?ú¬#FÁ<	Z¬J¾g’÷ƒ˜<XÁc@çßÅH;%¾-t62”`R7Ûî_œøùª³ˆeÍb1~$5d¨#|e<úÔà!úZ°‘&7%#æGJF\’¸s ü*ÅÇ×íu~Wá,0æúA¶üŞş¹›«"ä.wzëZ»:H{°ô·{©Æ2:)uºÁé.¼}Õn-Ç0*˜">OâÌ±¨X#¶Ÿµ§õ'Ô…î²Õ¤·Ö°^M» âÔ}à> NXK=LXawì°¶Ã5F¯3«³Iìè×;Oˆ.?İ½«#ó&¥Ùy¦é„T×P‹ 2k€ˆó…­w‹,Èò·±yÜSÕZïëÀ)TH`
«»À|½=ûÎœ|ï)6ÆXÜ:”ßR‡'ß>å>Hš›:97»pª$(xÏY£n#jÔ-Òõ î}â°,X¢õŸ9ƒÒì©“ÿ²XnUk«º?ròZnu:½òÁ™äûü›]Ë•äï“7f„ëhå0BBcØ1DìÔÊMÛFœ`57@g¨VrL&.éìÜñÉå*ô¢ê×äkjc
å`½ôË?õÂ¸ª›Ş¾yEZë9ŸÔ&Æ“~ë&i¾H“q#A‡RïŞ•voaZİDæMl£Î­<Öy¸ï0<ùIIÕe~D`r¥‡§@×¸Ööv!—³ôbĞ;™r	@Ÿï—ˆ¯¥dv·j4{zõ™ê%kTï En³¨l÷BÛw±ÖÕï¹€#Ly›«0(5’1ˆ¨tèzu“Ë)ß%1ßW*B±»øùıİ_‚iöÕ¤ü;[{‹4á×ù¶‰;J:(’r·…ÇÊ‘º+šc²|õ“…Se!ÜÂ©#³Ìv¾Aİä-bµá¿V «Ú	Ü„cØ¦ƒòŠ—âªd$ü4»ÎNTìQE”	åBRÇJi´qÒÖRdøAú2™¸ŠÏS$–Ğ-‚İ5ï À^<“Š®9ğ`Ğ…ñrg&ñªS¼E²Úœ?è´3€¥Õ.F"4X1ãEÈzNá¡-“C	6ı–!#p})Ğ@øT¿Œ‘éíìDëÈéà¥Ü4ÅI=¥Å¬mî<B•œ8+­i{²ä­?2ö’1¿L^YQ R!GÌö[vU+öªÕòH¦KÃ˜	©Q›šŒ¤mj…R¢!©{Z©ƒ´6ö	„-$ğÀÄ
c´sÂZ@™®5Q¸ŸNu(~´¬BŸ1{‹ÕM{é*™_‹;4×îƒTD¢;o%µf^úÓzC‚J_Js‚‡Äo²ÆõA|/ÎÀUé´Ù…K·´ûB.cå.íL·j°ÖbßÅ¤¢ãÍ}”õêMÀlC8}#÷áZóç?Ïr†ú'xY0Ì‡4Ì‡EÃä_ÜØ-õÌ»cß9#Ûcä,Èæ§^ˆá¢ÂÊºBuBÎeÍ¾~q­©T²Æ|›UŸzøÉD~¤&£şÊÂÃ«%—›ƒ•“¨ˆ±„¨_p ¾ıĞ=œïÔêñö²uÉäã’ie÷˜2ù`ó„ë†G|,â8(Ë’>‹.^æIãàäFÔ†®*Z¬iŸ›KWiºIŒq$æ¼ [ud³SU_¹h”£a•ŞÍì4©•-o8(ÿY=Và$±ÚSİ´¬¢vÅS®š×îÔD¶ø˜_ÏP?‘=Ÿv<ïçêbÍù†…° ²[”ˆ“63SĞ^ïôzTºvWf9¯—]ê Åt¯ßsH/'ÇrİwWÒşl{ıª"Œâ]‚ÆŞ]v±=nğE%:ğÍdÆNOm…î¾@ƒµ+yÄ¿õÜÄƒóÈ®"óª5TşÚğÏŞzì^Ğ‹£Æ•˜R@r!ÅX-ÕÚÙh¯ŒåTvî}õÑ×ô§°—zé¾=å‡	øwXúZGaAzUçå"3÷ÖIM¯];cÆi„¼µ0ÅØkx_nÕLÇx›NöÈ2$¶»õÖ[WŞšö½ıÑp­O¿œ-ÕÓÕSK%ız/ËÚı•ÎÀ×œ»4¾v±ÑwºïG>¸NæÍ[%×$y%Ñë›Dã	lB6é¨ézøºÿÑt&j·Õ 53Ô‹TWYü²+ŸS¨âÕ½ÉîZ9õ5:ˆ¢fBå34ÚÖ:˜¼^Šâ·ŸBÔRü–¼›Ê=¡©Œ ™˜¿$öF5!o„Ç­Á=:¯Ç¬®¦1Ó7úV¿tÅ? ß0»¡4¨¼©¶&¢Ù`>ò
ÿÎj›ı¨8
21¡'Ú•õtôßËì3ŒQÑ}L»ñ>Æ)°_xç[S¦é_ëÅWĞ?©.‹wÉ_ÈõT#Ó¹ŠáM czáİõ/­ú}~ul:ºO"
ıu„O0ëè½Ï´rrKÇÆëk†jñ[1Mİ‹ÖîóIZÖûÀ²3Á§ßz¥	ï“… •ä·nƒÉP@î›˜9L­Z™œã”Ë<«ç7á¿;¿NèÔ=Íî¡'šíë "úø5ê7*:Úƒ„;~Åhå¶ßÚı9
ı¹+!“iÛA
Ô	aİ/EVmàBÉ.­$ú{º{‹ÔÌ·Ø¸±½û	O½¦Ñ¼ 1úWd“F„G˜ƒÖŒø˜‚K(8(ì7dÁeÜJÈî¡ÈËuêl[”~z g„¶‰¸=Å®¬¹¬
™ˆ[eO:å„5³óqU;·.Ş»¸nAÿšVŸWô¯9w™¡xd—×ñ)Å¬’¸QĞâ—Áß˜7'¡ˆ´¤ÓKºéz!uĞŸÿ¥†›|©ÂĞìŸI›a¢™™>ıõ^û²È#')B0<¤Ÿp>ŠO)/­k_¥Já£È7PYUÇÕò²÷ŸíûV',™â/aºòç[pdˆŒ™óˆ0>¶ßIÛé&nı”~£Ä@É”º÷‰¾á¦Y”*·®Šï‹k¥t¬aÄHÑ\ïCI¹và^À$‰sÒì?Àêˆ"LÍCt:
ôtbŞ{«ï¤ ë2ª‘·«èÈëWºKéµ¨róex§aNB7ÖÌempg„×˜Z„ÒÖÑÒ¡7"OÊÕ¯yªÆıkw{ƒº.¼IÌ÷°–!ØøpÕ8¶¾(Ÿ*Ud~7ÙJdB[5z-1£Ã®Ş=rËÁ÷Î`Â‚ÜiuÎ0q»n±¬ ¤bY"¼ÁªËŞ ‡Ø©”Æ?.[˜ÔŸ’¸W€7L|AtæEÉõT¥ÓÑúlYŸ4TaóQ—o•²ÉqZh5£^Úî/#ãoib.Æˆ¼æC*ÛŠc2³û|[‡óP¯Õ3^8zÀÀê ·ÑÙÄç'a†ÕX#ùÜ·Jaô)1ü9òî)Ğíó„îYõI17ƒä÷µ›ÔCR™<õºQñ¤¬åáB•[ûv×Æği3œ[úÒDî©"&°ô;_™ áS5Z¢@€UôOJ¨…É¢qcÇDaß'StY,×'’¾ö;­Kzô#«·¸¶„¶îœÄ¯=Ã>eÏîJÈ×ÉL÷´J“«^ÃôQ×ãkƒ¶'!& ‰k0|ÕÎš„Â&õ•´X¶³ñ;¯"æMw¯ì®uõÎwƒyœ®0mİp6Z›•u²„3eŞùæ [è >4Á66:Ä®Ÿ³©aÙËb6ÙI§‡ş7ãN©¢ÜÙÜ÷sÕ³®Õ+àÄ}üª~»–\}\@­ı%t ¡ş\Ó[DuaŒ”ò2aí²cÉÒšİf›VäJâÏÂiµ«-SßyPá0b)¹qßh/:€Ä¨\&«æi…‘5W3ªÇ
_F(R-Tùg`jÁ{ˆ‚¹Ğ·*bù Éİ J,Z¼ sÜ|­5÷º WrßO^~UçÑ7Éô“ÒæŒ{ØE«ßQÑõÜ>êÒ‹×lR¿;@Ì9Ş}¾™Bg:­¸œX‘f€		‰y”É£`”Èo´ôïDÖ­Q²p5¬îê­NOÈí“zÌªYŠ~@JÓì›ïMì¿âû¢x·[©_9÷Oµ¡_“ÆÑH=åŸê0FV1ÊÆ)kµazTŞX¦–Æd:ËmøxEv%K{ƒ¥,-4ÿ>Ã5ÿíx‹¥¤7‹+;Í½÷£{/¹µÿÂntzyQÕN4Z•kéøÂÌwÀÇj;D'¶K°ƒ”ÿNWöSG|lÀĞòÛ°Š à``—š+]jça1«iï¢ÙêS@±@UrÎgç!ŒfK°ÇÜÙªvtSí+†‡*tèÉÂfx¾€åéîZë…	­ñˆàö)¯€vÎ·íhN¥÷›Wís„!€ó´uîRWğÔo\U™L^Ÿ‘Z:,·&Â¶¹„Õ;°Gé`œ?”å Üš¬¹·€Ú~Ã›dnÚöÌŒ¥Š“[ü²ªÓ6ˆ‹Ò¹LòÑy:…—®Hø NuC<²ü«@ z-ÇÓ[qÊQgo”c†Ë4Ay+›07•Îâ}1[¯%çiç§xç§ĞQD‹¶™ZÍÃˆµeKßõ©®sÆèê'ÔÓ,´şs“):•gW)^ÕªUÍjñæ¥´Ó+­fƒ#­ÏuÚ­õsíÎ¹æ*vÿu©ÙÈ:¾öƒúfÁ+6_4Á³Ùsv?Óë`yÖxÓvªg’£Ûy•&ôc¥GˆhËÍ æş›û©?²5'ƒÖacƒÜXı$kİ~ÖÓeß 1~è¼/wS«1»#Á†~`ŠJ§«®æAê.²ı&g›8sZğ™nhÅ®ZR–ÍÌ²=ÁÌ»6‘$IR\2¯‘RËyÍœü; w–j:ëM;ZµOÙÀüØš©¼ïË2 &“øƒUÑl'Lºõ_Ö-KgŒDçm‹¤»şİî-›ÏNµ“²„wîŸgß9‡•N¿½0·¸xnñììÙwMefSÅfÖY”x¬ê-é7™×àw¯½W':lp–ÌæŠ  ó àÑ¿<“
#} ğıÔ+¦ú•ÉèÄÎïö1%6ëA(¨œpı‹³±÷àf§¢}ò­sA ·|ÜÒU`ƒòà…(±€èÑM°¤ñ2P»#}ÌNS´[µÉTö[‘H^ÀJäx-#AkòsÙ¾.£çãëÁÁÆè|}YÓÊp;h8?âÿIşéİùÿ¼=wjnaöìüéSÉ÷’Åw½3OõÚÃæÔÉÛ:EÅZ»	ü^R_ë:«	SQ˜™RzÑ5*ngZ'¸5_…ÕZj¯Rg>‡@>«¼|!†ú>§±l3§å™Õ9kTq27k¥£¬{P*µ ³uìQ¯—é¥tÆ2D¢—!”ê¤&
"Eé ıâ<:ôí|ã;Ú©ÏÉåê!âÜ§k”•şZœ;V³.eh£¸o=“ìB6D1mì#Îš]‘‰D7ß?á!y¨=àrl¹¡ˆtâ'%#Uêô	×&ks=:ËËÍz“Ù¤Ö¸¢€AÕLB±İ+ƒ1°p` ~Ón±A¤–ˆçªr-2í"¼IÎÖeâR^G€âIgñÖğıŒ•Ş‰?Œ‡èÍ
¢Z«ÁU#Ó‘Ëpª7ĞÖ¡Xy*+ıÀç¨8ß0›ˆ`‰7kÃô=àÁ,¯>ĞØe¡Ÿ¦JÓ‡.l”ØVø´îş
-¡7iÜeïÒÛèX“ìáƒ\äÃi Ù¿T^kÎ²óÀNÁTóF+(* w?¡lˆpÈàûØ¤Î ÿ~•”u.rÂıŒÛtI`™bî)ûş£_-&á6i¹1™¿N—fßb“CÅ)lÁ*¾%O*XT…x,^+ïÁ6N©ªK½!’Şı?»ÿÿî=ZÌé6•Öü³ªi,&Â¹A*ÜWÖ)ØC{ıo°A ªğ2o²C¯JˆÇ˜P~¾G; ˜+éùRPR¥M¶FWÙ£˜0‹	Î‡8A—dûRBÉ·±Ô1Ç~¨-ú’²SPn”ûĞ€ÎÚO!^µÓ({ƒXòÀNèY²Eyõ?®á¹?æŠOØ7:Ø«iéÑ†.È¡×<îæ§˜!£<		˜ß‘ÜãI>j)Z`™B 	|‹‘4_àö8p§ü°í­4]º¨#ßÌÒ Ğà¼oûÅœÏÊ"'K0¤!.ÉYÚ^Lr#Ğ•`o£uNg¥D¢^1ÆAìfh±½W¢œju¶™6ˆäTwÙ*b%mÁb!—;ˆ`Ä¨¸³¿÷øF-÷£¸eY®q’[Øxùò‡aHp~º¼nŠÉü°*d‹\æÓÉŒÉ{î‘¶¾œ<Mj4á“\PEä´ÏËIÿpú¶f‹÷šÛ,u'Âù¸ÂS9öm<Òü Gªs%!F.„î™Ä†^…Vae;Ÿt yW>Ç+/IFY–\ë¡?Vú¦­¡#¸¦.#  {á8ç=â€™i—­S.q,nIO9²ı›!Q¾ÅLG‘ğ¦ÂŒPƒuƒç ùÀ„˜”<\¾áÜ[kDõTn¹ªLM+>gaWqBƒ™^Š¹Ç›êô¸`3Ta
d#wTˆCPk >è)ÍpÛOwéÿo© WÊô±óGdòt”Ù´’»‚Î¶ãQ3QìåèzˆİàøÛŠwÕL2‘•»ªç³Éùà®Úğ-1¯ûò¼Ä±ššAÊ÷¾¿aÆÜÓË¾<i“^Æà‘Ò`¥kN8¨ë#—3dÊîœqÉ}Ge¥ÃIÈ,"2Ü5<64˜ï	Šj`0„.¾"¶–?›ĞÅ>HÄØyJQxh7>KôISêpM¿bş”˜AèçiQ|‘@‹	:±b{P\;¯ŞÛ½k î+RÌ<@æé{˜fŸ« à”ñôqdÅØF–3ºQ}kB.z´b¦™¢•½6BŒrxPºBê´Dæ{÷¬üë İeYpÔ·“ĞFŞa¡Ò^¹jÄ¾tÔ{¹Ä¹œ‹”Uõ,’Ã!3LÈÇT¯Ê‡î…ìÂZ+ííÂ©iäæÍˆÚQk"¼Ñ]„1d~_"x5ÏÀŞ„'ÅwÊİ¢,cïò¨ÜÂÇà(öôä¬`ÂÏJóó¬×±§¦xìM}4ÛÿßĞŠcË)8š(ÖÊ™³BŠ†‚\ı­ÍÊU‹mG^j"J6äZéBÒå^gF6÷İ|<„<yÅwT5Ô)pŞ_´ªŠŒŸQÑÊ-›Zò¡ÉAÉiD¿fïùÛš¼k'z'µQ¡²xH%x!Ts&…Óry
oq°0í­Ä¬ØªÏı-¡Ÿ­éâ–Æ|5dáxD\{ï×¢ŠŞM@[·ôw¶>Ç@|ÊèUÑ¸{ŠŞ¶GEqR¼—Àä¶+mìëºÜ÷7îÏtÂÌ;q¦SEiQŸ	Gü<Îƒiy‡RpÃı:Ëº©6ş5ş	Ñ†Êâèúaoæí(2Á…°O@ÜKåQ>åã+YŠÉşXQº½!ñ ~ÊÍ¾E77Çd±5U’ OYáÊÙÅÎ$o“ÄÖÒÉ„ÿhnöìü©·ÏÍ=;÷Î™³ÊCAøƒmpÁùG(²‘¹äîS7«iˆ¹ÄDÖæû\2)^ôFŠEÓqlNüß0ŞA‚V­`r¿šoˆ"nc3|+óò;7¯—‚³¤(O«ØI>”nì…›peÃìn/]ÖI­åóUª8-7NG7ÂáÕ;½¬–ÌèßƒÎ mé4)…—zºqx_:ôrÁV¹7¢+{li7CO«Ä©ï­{¡E›1¯.×¯+ÇØxv9íÏ.Ï·Ëa$sÜIòŠCª¨PGÍñärHŞŸÁwËb’!Z¯Ö0Üâ×,gú3zMı™<ÿğú^}¾×{‘
ø¨ïyqGF].?•'6Kòïœ¦8Ê‚çÁ;äjt1§Šø,('l®+/5Ù×Î¹¢§¢mÏ¬BØıw®çzÊ<NJ’BãåŸÓÆâ[ÄZ³¥¶¼óíÎWÓR56­¾ik?™f5CÅÎ ÚnqIÏ;†«ó®š«”’È¼¸hÂ5¡öû”4‘›¨9ÑFLòo*pÚDRÆÀ¶ÊCÖn÷¤xÇª#âÕ±0ë3Æ­C±ëHø5ÃşÙpìXÖÅ³Îä‡Z zÖcvz¶Z£è¿.Dm„¼gİÔ=Ò¨âN›+Ë5­[–PAééËmÕAÙûdx°®
OWªi“,¦ÓËÍè¦i6¨fµêÅË:`\æë)¦ÔşKá0bäã}Õ¥í‹"LÌ&©Z¾C,iÿ´èQÉbº¦áÉ`?mµ	ú»6êÊix•°8of‹TÎ$08^ŸĞüÄıøPŞ¡÷À~ û³·ïÌm0w@ö-'ç$Mşc*ºİ^çRÆf]Ê®à6Ñ[¨º}¡¶£±ºÙá`OÃY©H[|PĞŒ>3‚æÕbLWüç(:j0¿ƒ¦¥D¨)ã$j*•±é.å~µõ»M»\ûŸö>ÕéĞÅÀµg=°N1¢m–›»¿²¸:@  Æ]>ŞY#GèÈ•£Šc«éGZZ â—Í¶¥Sk«Kx¢”Ò`:‘Êàthmüìû×ÑLáµÉ¼¯©øéÎWä`û{ídµ*NM å®“ë“İ:3âïµæN`ËÑg’‘*¿…½©ëÜ¯XËM_]sÒÏcj°¸²¶¼ÜÊÀxæ$Î\ÆœP_¥¦†Pâ¼@E”ÿ““›Ö¿ººp—ê+õ¯q_ƒ;Ùéõ [–ö+^‘¥{ÄLĞ^ˆÌÇFÇ^5£ócÕ­ãh-_~õ2„y'€¹.G¦|âH«i9g<c!¼©K"_ı¹Nµ£ÆÑ?Ñ‰õÌÏi®Û¦gÁÔÆsäÌ²;À§¸‡ô9y(âŞˆÄ68ÁÙÄIT„u•Ş“>±›Œ?¬LùºÕµÖ ÙmeS\Ş‘ŒÔV;]†é[ìˆ—zeSçl!óÏn¤oÇ¹ZbPÀÏ`Ş8İÕ°¹v1š2˜üÁ~éî*¶Éï{#"œ»¬8u£
KBÔD"Ì)2‚‚ıAøœ*ù¥m‘ÆWU0ú«Ï¿^LŞ¨8ÙUöØÊ|É¨7ò½,<&{Ç=xìq¾ŠÏUğÅÔ{µ%z§Ù^dâù^•µüáéÅHeí_ªî6•,É¯é´U’gNÆÌù¨\ÖÄ±Æ6QtÍîl£Áeû
rG[­¶–²óu0#ŠI†fê¼å}0Lû•£›j¿}‚Õ/Ç´í!uÓÀ¬­ôª0·k>ZMõ[ë,f"c¦‡!Úæ|àÄ‡8(„7X84fXÅMpçíÁ¦ï¦â›2››ï“gG$ß}Š|’†Wä6¹õSÉ¦;úŸ7\û‘?•Î›Ç/	Ã¹!b|XB
®[¾êËèJe€éÌÑÒüÉI_²ÆãæuLº+,úÊLª4fUmZ…i|ÃÎMfŒÇ\Ó5g3¥:M;åE|Ÿî¨è4k‘eovÜ˜Gl¹e›ù]Z-URı‚b>%SûæÎÓ’ë¾äZè9%¸Îé÷éî-
è ú0°ó²ÜNä«_Uœ
eHIºË0ÈUrÓ€ÍxÂVè­Šaw`xÄ”˜‚=ÓÎà´lrWzMÇ¡RR%÷¤ØMC×…• Äçá2£æÜ‚ÀÏJ$}m²3—Ùâ’qŞÃƒÂöº+ X¹°DÊÔœ‘éËÛDä„‡ù%-ï¤Øí3ªôëtåZQÄ
Yr“ëÉ‡hÉGÖ‘{ó•“
ôÆŞ+{´ĞyƒÿÍ÷?É·‘Ÿ`ŞcaGÓïî_»ûá0&(HEñğ'Ğ¸L'³kƒÎ=ÖPíg2r14š"›üØò“Ú¼$øÇ;kÃ:€÷áÒß#7–>MïÅÓëør?"Ù‹«ß[ ôŞC ø^½@ØÏO÷ÏÓO|s§¸4<™[AèÒXÁK{_!€i„¦<3L’ä8¯F(—TòŒÙd*jÑš£†-ÅBÂsi†Q]Å›yCß0ƒ¨9æqüeÄ 2lˆœ³âíìºn?q˜$OtÆnèPnÉÀ ÑÚ:Ìp¾ãtğ£pÓµì&W-ÙDş¹¨ÂcÍâ/¿˜ĞèåfTÕ()uµJPFºXõ²‚w`nû¦ubuP-ƒ«?°®Ã[Ìd>%’Iõçô+ò­f"UÔ»¿L.5³ËİNoPÕë)ÀQ“ú1HÄíÆ1À†XrÈhÓŒP;wİ˜ådQ:º³{«6A²ç1A†…æY;¡K2ß·Pÿ2Î³š}ÙY•$ì
ó<La¼¸IN¯Û2š>‹Ï¿¸¬’‘ÅDÍ0ûNòµ.W×l€h,h{€ÏµìÀ"Å¦Lè u9 ºt¢ÌÔ—$Q
w”@>ODúvµÅü)P Â0Ô}Ê!eœ À–„R¡fÆ¢R+À›ÏOàZpw)Êµd	èBòı¤›^ÈV`åğOL2·Ôl7Ø«}!›àP"Ú)4~KóŞÖ*`#}³Ë2	YOYCL'M< É£4¼ü€_J™ë BŠ( õßŸ`ÅNI ‚ş$“2	‡xù°:¢¼ëtì÷•O3lì[˜8bĞée®ÍîéØ7x²…|+ìÛ\Œ´öèó5N!m	k¬ï´—›½U:ra'Ù½'ä~­7i(F	£uèğ¿Pù&$â0§³}@¡{rrˆ ÿxR¼öpªSµµs°³³•ñ´ûCV9N&mRş¾‰VõÑ=".ÑU+GUÀ
ñ+§îyAPóp‘J©¦—S4Ã·šmÎû/øM¦!ûÊÏ4\4}±)›&¤—Æ3É.ŸŸ¬G$šc#ešåf¡‘öSÀ)‚óe™"&G9½QÔQO£Šån¶«}-;¾ù{K£“è¿(‚6°*êşÈ4¼ „ĞBÆšàWpÖòÃ8kí&Ùë”ùš°,_ænËYóıóÊø*gX‰M ·Šª/Jiy$y"_J8Z¨Æ‹"Éq^[RÜñ¿m÷/ì3—ÒÖZ&WFÜ×‰KmÎÏ:Ív¹””Ä‚JÊ)ÀcÏãh(í(€)ŠcÑö×éŸ.•Öê*„å¦ğæ/tºê_du³V+kT~º4«óM'Ñ“Qp§{5©6ÛõÖÖ#+µÒv£_O»Ù9tŞj¸Jğ¨_‹oÎÙÃÖì£•õ^&‡”jd `s…ñ&rùf›-uê"ÔÚ·(İTæ–»Re(,ïQx å"I´áçq•j&İT,zZYiğA¸Oç£ÊÉĞPáH·	€ÿ›éë[|vU0eF  l÷|÷yio©®L®Ø^c:BZÈ
úÏacîaÖ)v÷ ùiç«	í îçp nJÖûg%í/zNL²ëö¬!ò-»Ÿ†dÌUE’ñS*Xµ÷ù*' ×éh3)İQäï¨˜E2äÎyçœz¿;_ÁëßºQ¶úf—™Ê(MkùgÚ—~2z©m”zàLİ#Ì7€â¤1ïé“2>ôé N÷D†ßî~Š!ı·P`ÑY®Lx ^ª¨d'y‡‘T¶7%rˆ, š½>‘5ÖºÙ3¤îçêW«Yº((!f6bDT¼ ô«á ä¯7£¡*çï}O*n¦ä@?L¾63qßä|:â¾Í‹KuWŸ²×"LA,&Xi%gÛúÑm›»b‘º8m«/Ña2qüãkÆÊgï:Õ.ÕKR‚İ0Š	òW#ğ‹;ÿ•vÚğ–MvŞN«¶r¬»¨ğØùF[)q‡ü#Òç<¼Úƒ›6äËõ¿mÕ	“‘`(sCi\Ñ”ğ¤¥±ÿ/('lÄyh‰öÌ@=üAŠ-rs¤w¬,q¥®Íç*		âQJ´ àò§ğSğÃ*GNçç:}&T}S«~îp‘Ê~)Ô˜ØOBÈGÆIá6»t<Q
IvS˜°é%….8tÚÔ0ZÀï…ÒğtñÔ&Ò¸%EğÀİƒ|"Tšà/uô¿HF?"hrá¨5êXŸUİ#Å®‘ªùRíeİVZÏÊÓ?íúÂd‚R ¿ayÿm|™_>4çôxrt.(O>|¬ŒWš;•«À°˜Õåå@Ì{ÏYô Êû6KÙWegZ2ùvºœ)}VPuÂWxéÚÌşshÿõ
Ë\œpİÊ”Â
GÕA´(MÍVá™–Çd…k¡ÑV9ï»“-À|zğüörÖ¼°2¨i/~ı-?&ò/cAotğªüÄò_Á§öUĞÅ+²‹Nµ‡µDU6ßósg,¶•DFâESİ¨Ä*^ãñ+Û—bŞµxtÓî,›'ÄŠw(m¿-¥¤^ªßy7øhUZÙ|ÅhWy¼İK©êöüûøZ¯¤ÁX{
0ÆyŠ)‘kØ+r ï”åO±œ]òúÅ©çª6¬s06{yÆê2Õ ö#Ò-ÿeûıĞ77óù‰)DY¹%î.ö—ç>Ô¨ëjnuĞ|èX¡3¹{ şû!æêµãA¤9(ë¸¬_+²ŠY†tQêµv#[L¢Ö%µjµBM”šŠ£±«…Üf*³ÈDŞ+"ï½™ªeokšfÛxKÇGïÛK-9pÀµÄFœšOŠ½}ñ©ZMÒF³wÔ!˜ŞŞF½²İ‹4jBÔÂ)|æ¼«xho°v0hè©íÉ²\ã”¹“ByàÜÿ   ÿÿì½kw[×• ø]¿â
íI1	RrìÄpd6-Q6Id‘”´¢’ âRD	h ¥R±Wô4‹ÉTÊ³úÃL×‡‰£8¢(É²lË¶<kV¯Uõ'ÈUßêôü„9ûuÎ>ç€åØUqªlğŞsÏsŸı~xç?ë,'åa¶<'5âSÚñ éyjmzšõ¨ÔŞ”>vğ=(ÃêTÚkr7ÈhïR›:/xÄ!ÍÏ/]óøÁµÚ‘AÍ¥ò#`65É¥ö˜ı{·„Yµ	dÎ"©éÔa-I“E÷†&‘70g4Ê„LV#}›ÏW›³‹­U T|2×’¬ÉdHƒ!@U`0ƒf1Æ×AÄûñËç9şûÄ q¢ƒG€úo7Èh!–$•‘ŒÆù:h]”Ê©{¿	x§*a
`øaY¿óá=°‰LÕE£Òİ}_³×$H8ˆšz)¼ÓUÑâ•H‚ÁpDÉ.°µO]í™kª/÷ÿ‚³q1«{ÆŸµ:aĞ[¦´Ú‰p3Ç6PÉğ«zç]¹8\Î)±H{@uß˜& ›¥ué"àƒ­?¸”Æ@r-ñq1 _Ôéø0ÃÈëˆ}aK"]NÌ†çµ¨ls=<ğ¥>œGé’Ä „K¦ã1YX:MÛ)w^ßMûuAÒ‘Šş?wßøÚAÚfóşz°AÛ› ;bÏDï{Ô²å¦ıÜûNín3ì¢´Öx½]3Œ °u«§qt¬™úäZx8×¥¿ÛOG)ÔBıM04İ>­6µÂÜ`=Îˆãê?ş¿T¼ûW¼s¡‹ÿA*Şå¬X,°ßâw©^÷—êuû[½¢q]6ÊU“Ù¢vû°\?#´»p¹û ØfÖÈXÖQÒdÖú—r[ÿ!Êm)¬Ë2óƒ'ÆpÜˆ=Gâòk“­üpd€RĞ
{œ¤êr'­,¿äº•|#^“á¤h¹1˜“ç£‘ù˜’•˜ü|Xfé£¨F¡1§ºşãõ+i­x¨Tr°™øä‚åÊêÖ5›5&İV+Y¨šç¯šú\Ïp„(¨•ÜÎvfW:ËîZ+ÆÕãUdÂiÿÔLôğ0Ş|ki¹‘B$(ÚÉ¡Ã Ó¶šµÎ	*û‹è`£ˆ>ÂRß`e«‡À+Põ†'è›å°ô3„ßÇV¼ÕÚ	ğfÙ‘tYïñ-r /ˆ‡  ¼§’pŠr¦‘ûÀ7Û_¢GÖK×‚\_-,Óˆcä—À©”p¶„Îëßlß#ÎÇ<8¡Ä­Šfõ8Ìº…5lÿG”û–m:éú²üR
¾ò†tvK\! »'û€ìî9õ :jÂZ¾H 1ÀOÛª—¦À…xöÖ$½x‚«Šéñ„vY5;l×|ç7€Ñ6{ÁİËkXË÷ª0”ÄNcgˆ$³úYÃw9Şh@†bÊh´2OFågâ„Çæ9”B/²¥r²fHO2Eµß/¥W;E'K>;ú¾e†3‰)ÅgY`öSGÖ÷}?3ƒaFL_F´_IqĞ8»xô3æÛ³ô-¬¢Ş9J©Í §ÕÒ³ıöÌ^fĞ®~ 5Œ¤;÷ÅÏqH‘çª¨`]/[7a†<áÌ:†Úv‡iu™iuæÓfµ]o™÷ÕÆÕN½Sğ2­½UíÔçéøstæ”V[íZÂîİ†Ê˜_iÒ]L¯&UsúimeoRµ‘tê€ÍUª¿İJVSP'fZÉEsšÉ²¡P†¥Y€ÒÚ¼.˜=±m‘c””;ı­ıøİcë˜Ş{Cƒ0€û‹»÷ËÛ¹£@¨¡­ÀZ1Cµ}•¯S‡!N”I)ß3IX9*Áå,¶ëA›²
üF0o°Ñ]KÎ K™ÚÏÊÉÀ<u£ö²g%ç§áz‚;kúĞ7XMÒÆÆÃ‹²¹øw‹—‚²*ùèÌ¥³¸©ªó¨¤6æå—mÌ½K `Do¡é'ƒmÏC4P¶s±
P‰sôPĞI*~,´…gÎFOA¾ÎA¾)QÍ—È:íşılvêT™ÚUô&D¨#h¡G¶²Â‰ä{2Q…¢)ffnÌ1³:vL©pÒùˆ÷½Òèÿå#ö[FŸ!E)/¯t-³õ¾M²VÁTjCÁs2m¾_Ö¼@Eı9d@Ë½Ò!º´`b?Kp_¼>Õ»Jøn(<Jy 7P³}ƒßv÷æ'ªëUÙVå†À·N•ôÆñôş”*—£8–-ËÌÌ+z_Š:ı½ÈâU´Õ¡’¢s_Áòí¤>äò–hgVb|àb1\ˆ²pª`¤Öç¡¡ã8lÛEb;ki#»ù¡iö6¨^Jş¾ìrÌé‚<u¨-‰Hò6›'ÌÆ²j3…¾ïP@ï†w•:d3”q‘g	¹·£ËÖÛCû³"aøÔcÚİ'†³.ğùSV3ÎyV°…;y/8]*ê7”ª.Ø@Ù;UñÓfs¡«Õ/ š_Z›j6®î.(ÏË-^¤˜X ë/Õ»4d¤7›~¡M/äœ:à-c„ä¼p%¨ÈšYû¨Ê6€¾Lûf‹é‘.qæ~‡õÙ(ÕÜ…°–!Wf³¥78E6uÙ6 $oR™-¿l…$÷é”ºöOÉùnOxKeµò >N¯,×Û|–UQ€Ÿ…âRózêØÎa®İÙ{õî"äÃnNµ'ĞKC ?3”dë7ÚªôXp›g
äb$Â‚DÁïÎ|;M›ÃÈ×
g³l#4«ùöŠÓAQ»½²ì%Î¬+’f–îmrzÁæÖcûÈÁƒl‰%¢ƒTeÆÊF¶¹ĞH1Yj~³	jtÀs8#çùÉ 2ÀF8s}Ãeö ˜ßàÜ`~È8aàÁá9
…Ü…Xÿşİ¬ğœ{	x¾ €]†ì)0`_Bvğœá.@ €iÎoaEYìâ0ê‰£°(|Ğß|–*-Ö$á°ÖT•ŒÜ7“‹W/Pø. ºêàÄ#rØM¿ĞšèUË¸éµoŠÁ€öR1¾>w!5rtz}7¢÷ë‘xš7†k?	¤‹0ÈÆ¸Î°Ğò,+ö2Xa,5ƒ£øFŒìöÉ3ÿı+x©æ‡œL]Q{ŸñO­„§Ì¾Œ¾B_Û’~üœ‰åYÁŞ?9¼èöw‘ûôùÃ²üŸ½Oè§;7yrâÜÄ/¦'g&±®½Q9´Ü~›ããk›õºÎª›÷&çŞ963şŞ©ğû$ô”Ízç²ÊeøÀ ³±è¥ ¦Ÿ»yümµşQxX½İ‘#‘Î79Ê<åBMvÃBŸæœµ«s¶“LàH}ëB'~¬œ´§×“Df¦g®—¾RqôêúÎÙ»xïk¶jUÌJ(aŸ¢W:¡t­,QÔˆD«XŠdíÂKS¤Ôî½œ˜v7W‘ù#£•È¤¡z4Ò·§§—Öó%ğJÂñ³œ«á‚ànÛ+Ÿ=²f1æ Vø*‹#<üÒ©*T6LœÒ°Ï)å¢)/ùÀiã„}F‘u;DW)Vw©}åJz}T¯:`B_%ìÕ:iH]²C£%ˆ­V»xxÔğMáD%jí‡É¡W#`æöŠ·6ÔIDN%œ“ÇµXÖ‡óíÅ{@Î\JUx*O‰L¤ƒ>¨§‹hdÅ«òĞRÊPÊa“dV’—®¹å¯û\6.J¸£<¿‡l$fŞàÕáŸVs¾·Ğ4L»ØˆŞş¡ôó.[AVƒÜÈŸHvïËì¡y¬Â . Ãøöæúœ.D*¨¯'æ=qË¨x×E,9§}WÏğ‹i
€[ÇBy>(â L±—½_Q‹ùóŒüœ·&’ÍH¬X±x†©g0M2LANåßöû¡k¿!im(Õï®O…Öu>´DüGÍ²`÷•#¦$e;t>T»dëò<ëq–m(ó²nl«ÎòÃB=ä5ùL…„"tÇãD;Q—%···hÚ÷"$ÌıDTèEo§÷ÊvğöÌø±ì*ä{l2{ú­““f¦Ç‚b)Š¼q¡w!<#øF¹Ã=ˆ±²
D”—ñ­Iü3ï2`» ÎmPÇç,ÿÓë$³Q»9Qm£¬«|.ı“Î‰Ö)0ÍÁc;³,ÅÚ ä¬Èç.¶%;[E§İİş“êÛÌSñ‰$©™®øÄg…ñ4‹İ‘g|"‡Ù¨5'Ht÷ªé¥—Bß‚'¶t7×«6Õ³x–Ä«æı
"WÏñ7Ì›±ê}‹ûÇúîêVo‘ÏÌõí¯ıÊKJx¹İ7Èo ÙÚ¹9ĞíÎF çÀİóD"ïæëÕä^Íş·Š:ìæ^–ƒ‹rŠ¹Sá³¢i˜]/ÿùïœs…ˆ^´6y*ì×-êQ®­g¸(vÁRëmBqxğj6íÂt9=CĞ5én@Ñ=ñs'Hèù‘ğŸä½‰‰ŸŸø¥aê&fNÎNÌf›ÀxtHÁKáèé•´=_ï¤Á
»Ùàï÷WÒö÷8úû€3×¨wüyÃ”'d[tòÊN?µ£|ÕCõ(«î¡zÌ[{Vvº~Í¿ ñ€ız€Ôº’Ÿ|¿=ßŞ!È•c˜&äÍV÷ûŞÃE/˜à©R1ƒT¦êvJMÙÕô ŞÖƒØïô˜ ºßR–[ßá”İJÁCõ)¥»IáÆw€?%V‡€`/ªSÌˆµÎ¼¼ò²nv©„Àc¿Š+»ßLTjDİ•r[ñİ›`¡g¦ú;è79;IğæŒ7€Kçèà.ù±Ğw‘ÿ*‘A½Ö¢rª¾-JQŒÜ?Ém:BpüTÏ\êcGê"	›¥Ú¯9ØÏÍ
.Ér!p ¥¬ÆDhØ¦Û.ø²t7¸ØVyØş'c]¼Í9“>Õ€P!+¸eÆ{ rmbgµ37³ƒsåphÕ˜¹ÚM¥ÕX†1Âv©Ş®väÉD³v²cs18,}`dE§ÃğEø°¶bÛ’ÒI¡ûôÊ¬Hê0åò˜™;ƒ’ãŠâãõ¦á‚Ša;›•@…
¿™éí€„ğúQYâ²"¤ªît”WÏ „NÙ!¶ Ï)v«»uvVƒxÚçjws«¹x Şeª–ŞÇ•{^Ó*S¹õ®îçIİ•øõ~;m¦m€ÁËi»¾POkIuŞ°‹Kõùdµ

±jûRÒm]J›œ??ŸM1èüÄ/œáf­8îuû!×‚Ğç›S¼AÌ)SÅ‡;·*¾Š=ÔüÛ¯ÿÀ…Ìß®$ÙÈ¾•\ú½RXQC)â¥-W»‹«Õ«¢ì*œ/À:"ìZG¸ì	Îpé•ï¼+\®/¼¨ò·M”©-l>o‡Ù­8çÊé´İ1Ì§yê6MXxïÚíÌB_ÅÄ>Ni©+!êîé«“… >úç÷×‰ =ü4cõÏ6ıv²-öî»-Çç[qpü«â~ï"¦^‡Ø¤¬›@h-~ê¾ê¢‚ÊVˆ”%‘$›opÍ?qDn‹ÀÛÄ£Q<aª[\ëÙŞÚ~\¶/>#×Q½åÌ~w°îìÓˆÇÁ6×jÔã &rf
(;é­„˜˜™:5~bò¿NK¦g¦~6qt.y{âÔÄÌøÜÔLL%¡)œ¸ıL6kØj+ÕT§‡ç¤8>	Ağí•F:|¡
ÙXªµê2ø‹5®–Bqw™>êŒ\ä¼[…"Ğ»Rs|ï¥Yİµ&™û,AÍµ‡”0Œç7±:Ì-*|ÛjA…QºK…€	»¥*²AÔ'Ë¶j§Õ¥Şƒ¢+~n•›QqHNÓ Î…ãõ´QJºÕ¶9!T±%«-Ãu¯º—0ÌA|ñK¢²Y”®
6Åğ{‡’©_9…O‘?²Bn…C©$'jtAŸ@J^Åô>7GéÒÎØÂÏ ï$Xjî±êQM°(R¦?²­×<gLP3NQ\ÙÈgíĞèhÈá$?L^UŒN©“(ÎêPÌì™ÔPùªKY.‘ócÇ2ôVúp	c½{Èioä1’ûÅL2	é d†˜ER˜‡zq,íÌ{ÏÛ”¢9&É"à§ié¦ËyïÚ+ÚõùXr‚Ÿ ’ ‚9À…æ•ågiÀ¦ëÂÑê;ş3ómeÀo™d>Jjw¦›Î/î $bïh³NwëÀW°däæÄ`yƒµÆ§'!2W™:€v!yM51;´˜,ú‰YN î&T¸DDÈéêŒê‚¢×uÛWí%¶ÕNÈó;a$[ğİA$°Û$Kµî©)ç?Fk”S;{!ïl”æMõ½¾1P2óu¯®òuôy|ËuÂºâ‚>-	pÓÕ	sÚ#q¢İàb„x]>Àyù-Y‹ød–ó}H¨œÔ“ ¼YÇÄ ?Á£şÜdEó3×ÌùšëÖ›Ï%S€µ–m°Öc³ç¸ZÎ²]8W·€pM³‡Ê¸¦®Œj¸M*€/0›ÓÆ>ëÓD-VU1‘–EÓ†ìPõ;Q¶bQ½{ÛßPõ3ÇœB<?äJ`}ëcØ]ÔTˆOÜNeÁh‹‹Ü«EÛ$¦·	ÄPgö[„3àĞ^ÜœïÛd>Å“ü…)Ö‚ ´|…“00£¤¿5ø@§'ü²[Šƒ_cb³Træ&™g•`/”Æ]c7-Ågbà±²×ÑXk  ì¶·…€DbµMîüà 8h…{]@f¿@Dó‚ù}ƒLÇt5ŸfóSòQ¹¥…’.UŠ!Ò|áŞâEç_äXÃ‰-Ô%h×1S*Œ¶ŞëX^õìbì“q+8Pz —Úç“è”‡ßc,èÉÖ@IE7Ä ½(şU¯ˆ¥ÑU€û
İjşd-fşwtßŸ Ê{"‹ÑTÌ¬æÌâñÈÁù6W’K~D5üˆ"Ø}¹#(ÆSÁP*¹NØëçÎàdç,ÎÉ¥›€*Ş‚-‘àn»H¹-\Æ¦­¸ŠWû6j›Z)¯ØSr‰€CÜBÜó÷”äÃs{İÂœÈÛŸºÙ¶ÓbR0goø!>|«Üp4à®óLº‹ÜÇçŠ•+P¨³ùöğ«öY#5b®<ÈoãÒ># Æ}Nò†úÈ¯®Y 3¼ß¢¤(Op«ñ¬Ö‘Œ2:ü“×±1rL›8;|ùzˆ~út`IñÇ£Ã?¦ÖÛ_â=¸ÛkE®ÿX Rßl‚|kjÄzÅ—œpŸ8“ÇH¤îuËìíöøk×kdUYb´N'cø¦>( 5ƒÿg>nõ:$¢E7±Ï˜|) ÿ÷€q—¨> cœØºà¿osEp0wîX8Ã.›ÀŸWW«õn"òşÑVt”àš2“ÖO	°K†Ío˜}¸ˆçğ+åW‡ÕÎ¢ÒÖÏÓ×T	¢Ãô›…úÅŠr£Iì$NBPIdÕååF’ñ€ü¬úÇÚ¥e˜ä
–+ÿÄ½[Ó­Ï«VÛÄ?c>1ü«(ã–»F“|… Iº¶V°éÙ|1ÆE’†Ì)¼±úƒcp7Í…¼-€é=	kg88+£®¿MÅÚ?@ºèZ3çƒ™‘NLÑT=½‚BdÈ–ÿ‰HŠp&E£
-ø&Ö@	f˜°¨‰—Ø†ä°¶ÊD5I†fè=…Lqj’P‚Ä ÇŠı
x{ÅÄñ–â°ë¢3aÖf¤^Î¯{§ƒÍÙçŒEø‰5Mu_s^ÀÊÜ÷{Uë'¼O¦“uAi^ğ
Z¦…Ğ£AÌ‚…Hˆ^çh÷¶
Úˆã1ßØ:l°%‰‰•‰Ã;¢½´ÌunSó!ŸàN†şdy"	­GVšòë>$n{·ö)m-Q£?9&ÉŠ#’ ëF¸…ŠÜÂ°4K“qÿ’€
+…}Îl%è¬×3ìŸŒı'»Âó'¬F¢PIƒ ùöÿ”©)îèSäåDä£ŠÇt şó­~èÁ°mŠ›A–H>Åm¥(×
§EW¥•×>çƒÈùç¥®ıí°ÆÈ–ŞQñˆuWÎø+¼õŠØİcïf‘=©WäCƒKÒGíà"x5'‚Kï0 nİV²dÏPaèŞ#Å+¸>,£†Ó|„€‹øì™¤Sù¶ 4üZ3n›öSét¥xD’O¼ÏFhÓYIå9‰i‹iÉÓ«´i¹Ñºè²VX³Ãè^H4 ö…j½‘Ö†ÀÑ€L§ªó`ÉÖJş´y±ŞLLXº62’7Ÿá'l‡K.¤ÖªåÄ~n›qÏÜ'(Œxj jBó†™C«M*î¤5?¿Ò–äå5•³µèiá¶û¨„KJ‘ì©5İµ.Œ>$e‘O/ğÍ:ËÆây³mcTóçaãĞ¥û¾NhP2åñÙ3Íè>§m+(s¼Ya–Êx|ƒ‡‹H¿èÑ‡U91í1¨`c`ßn[	”œ“¾4<Á&bDñNò¿«Ç"N*;®ô0h@Ì¿÷d“¼@êFîè©yº©”_ O”lÿtÃê`a-;”Ïç0šlQJL3%ÎSé“D^7Hïw‹/·jO¡£
ØÓDq¡›¸ùÖ—‘A–á€Í°+»¯Â¸‚56L}@#>„tìĞÅg¸-D€Ì#1¸¡%=(­f®r:ú[°¨B|iƒ,éNñ²”#ävn…ÃÊ%ãZ„•Ñ”ì6²x¤İÁ¹=@ş%ÌòùGoØÍÛÙèÁÓ<r[éæ|nÙÎ‰Ï;qài®£ÆHÕ™±ğÍ†aŠäí²\V:§uä‹Ó¤<Ÿ@TŠYy“·Wê`ZÜ-.‚–u	T8Â$*ü
™Ò!P<vÕ²OJÿƒá¶±üíçx“7T€äæ2>ÁÍ¸aoÁ—õáeyÀÜ€£3'ªR_Gh†\dg.ûlû³©…°›¨zÎŸ‚Ó4>’‰è°Iq|¦CğàhOH/¹{j€(ı±u©p¦İ-ÜBL€P‡mS¸g˜µ1jÀïÃÄ““Õ‹†5|«Um×J€f¶wié$à|{?Dğ{"°ƒâ©P˜{"ä¬£äÔ3éè.
A÷Ä×õâ•"}€.³áV^×š[6×D|ÅÊÛûLf¡Zék¯%ìÚås>Úš]®Î§Züx§“.]h´“‰c§K!j¸Kw;ó­òD„è¼[<şSb<E©zÃÚRÈ\Æ|†á^q³ü‘ +3#İ?ñî!ğÏMmD„ğsOğRæ®41­Áø…ãÇ¾°êp‚Œ¢*„\îˆéäÖÎ¯}ñWñ‘,õc´ÅØªµbÏ#ùRjR¼à3LKş6/™¿ÑU›YÈ×iÿÄ<pŒƒøşzl÷5z¼KlR‚Œã:çbAÃ=–*­ÊĞL ‡R˜˜k

6Gæï>0 O­Ú"ÃÌÅˆæ‡Âæ…!-È3$ğÖGHöÅĞş`uÀÚZMÔğ'*^„‚
ŞºN „ı9QÃgyè |.¤A&Ó‹ÇŸl!İ¬øvu©¾ÀÊÆ’°¯°wŸ9Ôzmv’dÊ³B§*¾;›È¿ı‰.ó®Ù||JCàFLº‡X«â¸WÜLhÿÕŒô]¤ÄÀ†1e‡Àúi@á›ùpÅ Ğƒ-ŒE¯ÀR=ÖjnE‚§¨T¹Ïü)1ZQˆTıd‘ÄUlï-Oe™µ[æî-D0’ãö˜ <hüŞğT›
¤ÿ‹@“¸ÃÎbTë1€ÙSô0(6¡ä8Ö•à;dëqIŞ—|íúÜ24àSš–"—„gí¾DWéèĞÙÎ÷SÁÔ Ñès™8‹cb—pe´›x.ŠˆY\Q¦ì©lÔgç$[ÜÆûá%åKæT=L¼¾b±³‡úThàˆwî«“Ùf]kX‰úJVö—jo9$ËZWé²è^ñ
‰ü§Z_z	=^j$
â”àrš«9İ¨^íB’+dÄI´.PSëÄn£¸ˆÂçxü°Ö/Å'‚ÁÁçÜBY¤KF«>”#sºB­)ÌÚõ%9Má×õÚ‚Å#Ü&U.ëE¬”íìÙnı¢8|eTÅ1GÔ†b1{&å'(ƒ¿ÈB·§®SKÈtQh é+Rún+·t$8frÃ›k|³ßÁóÚT-­Ñêã›ÏŒİ5ÍWqUmàÃäù›²šh/›¯F"N@[Şù' ‹ÏÂÍßf×¹$˜oVV¾t'Åô›UºŒ¶2ã<CöëööyG,¿<'1Œñ;L^vÏÚz¤mÂn%<îlx*g«ÆÁ*ìÎ‘¼’xd!~7ñú?	 Ğz: Ü}ííFÂ‰lïXŸbEy‚~zƒ1Åıco ¼øÛ‰Ö J$Ç@+Ş³Ñ[Y ÙÛ–ŠLD:â’ˆôã+¼/`áyk…˜ }u5ªPöY¨îÂJAy›j}Òcabì±ÇgÇîfºÊ•dšİ@!å»D	¨X¯äüô°²;¦Ÿ?ÙñIÈ¸:°’?™Á$­oŸœ(@põ³–d7öh0åãìZ©‡ÔªK±aZ:‘øk¯h†Ÿ?Ó‚?Jç›­FëâUµ•ˆæêšc»ĞH—È‡ı±õÚV^?Äß|îœPo!gwÇ	eÆ°B0ƒ”™©Œıä•{§Ä„9f\6ÛğvCŠiàÕS °™æáÑÃ¯¾6üÊ¨®‘à•š—QDbÕÄ!EbÕz…¸­EÂ®"@^t—àÛÌèêø6§«³^Éìº•­õ1){€n|B
d¬¦è
ñÅOƒ5RÔ/Q	/u›¢“¾ÈĞ, /OÄËËMZ0L,¬gè8²/[Ë‚-İş¸®0Töôr£U­uÕ!ÑCƒ— EP!Ót\_­KCI¡VíVÁSk…>#ovVÚ*¾0Ò«‹»ªáÓØ\!¯ƒ…^ït;³W›óEóI©”˜gK—ÌOy4”\3Û &[#¹Òê9.ˆ÷È´1Ë~ãÀÂJ¡Ú<_®ÖÛ'ëZ
øºæÂXá:/W+©Äj”l5ÎkdTN¯@`Bgx¡ŞHiF.¬t.´®&Ô[B%i«m¨ãÑHáJ%_d	ÇÚ<4”tZI•:l¶šÃã³G''“bZ¾XNÆÛÕõù’ûÚHåfeÓK;….ZÍ4ù—ÿsä_ş¯á)Í/VÛaËbR¿§çÿ$¹`„²r2cx†vJÆV»PĞæj²º˜6“:”H_‚ã0cš‡faİ–ù”öiğDp2s% []3Õºé«‘V/cÚ7,Yiv[++4)^JARÆEœ€ÛÅtL³êÂÖ=*•å˜GÎüó¯‡ÿå)ƒIP²!qø'œ§‹ä'@8Gô{kÅtÚ./´[Kô¹OÚê‚
e*¬t~"r0²ôàjnş×ÿü‘±-4œÙşõğ¿Ú¹J%ÃØùTÜwâ-áÅİ¹·Öìe¬6ë]ƒì0NñqPÂb¸”ôî*ÃúÈ˜¿a£‹<^OHçm¡ót·Ò„ok…’ËUÎS†~]¥¬3¿jÿªù«Ñ³X.Ë«òô“Ñ’×Ş<YãÉÉ™ñÙsã'NL½YG!ÿèììäÔ©s¿˜›8¿fYX/”—kä—^®µæİ¯+üsy¹ë~ÉÃ+û%ç;—ùW÷Š|ÓîJç³|ÑşJåçrS~­¦–ùçÅº|ó·uxvö~«:>5sr|nöÜ‰ñ·&N §caúØñíß&ïµÚ5óŸi¨uŒßÌWæÓ†ùïÑÙwÍ¿ç~1:NÒAÿlúí‘éSo¼—^˜&uåœ.øÃŸÿÅ¹‰“oMƒ¬¯ãssãGß99qjîÜ±ñ¹ñs§gNœ;úÎøìî+çFGGáÿBŒdXQÀ…€U×®®ºŒ@|2•š†ö.©¤@®dDÜVWdíü~xçş¿~:ü¯ÏºŠó‹ªt±f„è‹P'µLìx·8ª®56xóH2zeôµ×F!,Ÿü”Ÿ¼n§Ä+À·ÃÜ<§Ÿ…L?½úY~¸Å<B^SÁ”€*mªí(c¾åâÈ_U»ö£µÒ0ü÷°ûïK#voå{?Kü™¡äêP²4”Ô ”PÚxS±ù¸DÕUCÔùçRÉLÿı³fŞ~e(yõuúÿ×_½AÏ@¹È¡·GeÛ½[UğÏ#Ì›C= "å¾°ŞñZ ¦½8nhÊÄ•®á: —Pâf	fÕæñ?bÖT¨O¾²…Ù–õ®Â±ÿtv¤tfôlP’<;Ó†çY†ÒniÍŸÙ;iûƒÄjİ1Ë\¨+Õò±}oràÏ›dë‚—³na¡¹Ì€v%ç!ó­ù¹V:oë–ñ¦ì`„òéS³§§§§f 'ôñÉçæ~9=!5…(œ¹¾qúhê/]ÓÓ_+¸ĞtT?‚æìşK×hVke1o€Bó+úÁÕó˜†N×(	Ãšw"õÎÉ,ˆ€Ø7Şh˜C¬e€äU²SÇ@ÍAš†åƒáCƒ  qÙ0ß HA*×4qè{báíÿ÷ÿ_'l¹tvr“ZÌ¨ÎOƒã†	Aàêã)cî¡í´™7AÀr–"TgÜÓ9ºAÜq·9³èı’Uø;¿ß¹]Fc²8gRm¸guø_¢!í>w¢ÀdçOˆèw~¿ı )²…fFJ0`|Hà°8—M48Áéf"“ìÄb1ø•h¬‰ÿo;Ad$T'øçG#u=¦ú=gì_¦—g4’'µïi¸ƒU’·¿ §ŸAvUÃ´ÂTÈ%Jr!=C}ÿ-´šG[A-FÈCkyr´ÑZ©%3+M,­TÀG§…ŞÑ±q;’jx—=’zúÄÔø±sğÕ¹©™É·'‘{ô;›v‹ÈE-v»ËÊÈÂsZ[~¦\]f–&óv’jÌ·–‚V©i5üÊáQÓE¼Õ ÛÓÙ’b8 Læ*ŞUû¶ÚHĞQñªÌ…•0c‡~JH5‹8;¢ú2¿#än™’Üí+/V;EúÆŠ tÉ;åNÚ}{-ÆQĞ†P£v«1ŒÈe˜Ğ³‘‹ùûÈwïVÛWApæ¦±&Ñ®O¦İÅVrµ¦§fç†’©é9@$±WÇ»¡Æçu†tÀCIuÅŒÑ®ÿ-j†’+ÃÃTzpêÙGuC$«W‡!œ
v)…úpºT­7
Jnèµ°“Õ+Ãã±üñO^ûÑèhğ Ì%A¸0'½²‚	@$w;à_RiÁyÃXšøèçK60Ë=ë¢*-ş­udÒˆ
hu0q·1ÆÂï¼»iîD+sş¨ä¯ECpÚDáÌ,®Ìk?Zi7&ğQƒ¾hZõ…«ÒmISó†²Ó÷keCbë›8æ45-oËàÃ¤­¨¸öçKàË±¦Ö…‰æ®æ¯Ëëƒ¡¥Lşë³á2CÁıÏ`ˆêÌB@ÜÙy‚²BYKíeÃL›ƒ¶ËŒKY8GÒ—Qß \Õî¶G÷Rï®T¤gn
±a£ŸÈKµ*¶èq$ëéAL¿¨»“76Bîà|ûêr·UîÖ— {Mu!xßôSÔİP¦É÷“³{± D¦ÇP­Pä+é3¢ïÆÊt[á¨X¨öQ±çä§*?fä,-Ó©vò!/Wí"­y0¿é‡0t”"í‰ôbñ®"ßŠyU²iórùÔÔ±‰s§ŞE()°áB~%íèÈ_#…«üjäW#Å±J£5_m,Öğïşñ¯Ê£ø‡JæMåWµ—Kc/ÔI·Å9 0’™? b2O·ĞRÔál\*Gõ]¯húé<n€Z©Tr¬Ã+mÖŠ9y¯³CwR®ç 2‚±P†L†V¬õŸÒ^¤6ÜE+gŒnˆ•å\Å‚ÓÁÑXBÍ¼ñ©HG¶v¤"‘[æÎw‡I¹J[P—]	‘Ç¯v]ãs¼§áÚEZÊ½AïbxÊä sÉÇ^)ùYÇD.¥›B—äÜ©©9°\© ÉFìO1FØH$‰îug»µ¢JA^ºXdÏÅ—hÍê7pî¡²65¸3 ²¼™¼:
GÿˆÿÓkÉ£ÙoŒŒr[Ë×,M»¤+˜ĞÛ“ı>Şù=ºPJ99x[.„«è+ kx Uï¡WılqªDüQ|=ßRVŠ™¥‡Ä„LyÙù I1N…¿+6“3dq“‚®?+Ÿùƒ2Øş&k%« Ñ9ôàyşŠCíìÜéc ‚ ÀÌÄ_†ÒbY ¥ês÷áÓ÷›Î tP¥z<Ü#Éyø>	ÄP‚··ÀI¯øº6Š,¦W
%p^pôWg&ìyºİ°¹”Ù™áXFØ ğæĞäØšª €cµ9&İR¬Ÿ|4v^ùGójB™™˜=}rü­B„OŸw|ò<ÊO€C<¡ ó¡U{¡BKBÊîä$Ğ¥vÉây¶Ñ•w rTfò—D[¯Ê¿R±Ûµ÷.­¢§hjˆKoÕüpq¥yi…³ùØ33[«aî7íH®á¼:ùüÂˆTŞWÆ¡ËçİOâr$8Ø5¿S(“V†¢™Çüé[–Š=è²Ğ÷Æ¸ƒ^ë¹©ŸOœ:7yêİñ“=ñ®‹Õ…÷)¯„°3ş;*F5{·›õöR*»œÅÔ`päéT´súŠ%V¶£;Ä{kï¾Bœvb½vøõw˜±£S'§OLÌe1ç—ŒpiÄ]ñ6˜I¤LA£RÌoÇVOÎ2æ©²Ë;¿qáş“&ß3úĞ¦xÜGhß±â¾=¢|ç,1¬ò¼tMÏ¥ëÈeªçœq¯ó÷•`Ù¥J;tñ¨Q«óÁÌÉJdk†9ıµÒ†…¢²OnDÃæŞ; 4” İ¨ø{ëOëtîûZkµÉT$§¡íAÒÍ'˜I²Ù{¾{æ,Úó‹õËáÓyPØOÇ¿°ú#ıxmw”†…â½“2µJÇˆ	p¦. CÜ¥ô*6¥¶@ øÑİ	%|•É­ÏS¼Ë{0˜Kg!›šY$Î³³Â\µÚ¥Ø”ñ2~‚FÏòòd{³ƒI`"35¿*‘?£1•äŒşû¬"ğèË‹µ½Ÿ=+ùoÑKıÃ$+íÅe9¥Ç¬Z‚AM[*×ìÁ3Š‰r2"Èƒk‹[Ñ@ns|U —0Ã8ÚBäÏ]ˆ¦øÍ9„Ó4üÌÅ\ñJ_ş<‚î,¼ihèdş;°ªíüT‹äåßAgë§#Û”èó:Ugù‚’ËŞ£Œ˜ĞT'™æìVdR[¹ÊDB˜ÅWDwPULû%éHîÊtìüaçãØÜAØş2ÉBÚ&Æ| Ÿğ„,ÙUuS´cSüP©[\U	šÄ)@æU«í©^Jòš P¥ ÆYÙ"  õœ•ºÃnVÈ-eõ&'HÆÌ†“%—Š‹I îS0}Æ º~ ^EÚQä¯nĞ$Ó.Ù]WS**üîQ!§v©)8ëçîr„•ˆ‰¨U›Ó6Öñ`ç?X€úJb‹+_¨víïù¥šım³Ì¡ØŸ]÷s±»ÔĞØßË‹Ëî÷U×KµmW—/Ùßµ¥‹®ù%÷ûò7ÖR§î&ÙrCuæ©Ï³Î5)³nßéa÷š%FË‰Zÿ”¨>pïş*Ÿ#™0÷t?İTPı®êâĞ;©^)¥wÖwEÛ\è$K¦ºZG}ex©#<@–ÿŞİ/Ëfõr•BTä-8,è{áwÆÚ°ºaoÃÌæÀ´]G¹Ó2ˆ |æ£&›äà|©ôÌ5ßÇQ ù!E]ıNt˜t@¨ÇÜ]).Ó¸€Ÿ8‘Öˆ‚dÖÂÏŞ,¦«À/«h·œ!ÕM^ßËEùÜªÌYùœ=A–yœÍ¤‡çZ,L`Fº¥ÖeğeN'V1R|ù†D²ÚÏ“lí#\)Úcmh8»R	Ÿlª÷$k©˜ë˜ŠW„l=ı·;ÿ‡Ô§Tl¢©P"~ÃB2Èº´(Vu€Œe­øˆ½'’¢áßî¡‹ÚËTÿ8E›"p¶ïahé}çû¿)‰™(´}s¦dûàGo€BøÙ{95u’ø^ñ8³Û]°K÷ò?1÷³ş=tÚb<—²ÕKşÃ _§d›†%úP¥ÁMÄÈp»,³}›À;=åˆ),°i…Ü˜>¿S½ÕæÓ7"*¦zÈê7KÂ?¤=Ø×¬îBkDğ’)v	¬¬Ó]®A,ñ*“rk°Ş…{é$u\m :0›3€ÁËÜ¢#GGDvéDŞ¤ô#4lÿS¢taAIJ®åzƒ²4è,L3”ûÿÑS§Ÿ9úÎä»çjâ¨Gp¹ÑİòõA„{âIUSP—<E÷P¾kJGJ‘Ú$1Ş•)s%•€˜îRÿÓÎİ^€ôUv”îÂì·ïIÅ‚Ï0ÁÁçÙ "FyDÀ)2AÌ`|B.¬a?ï`&¦¯mÆyÈaGÑõAÍ
Ur²šıÖ^ÖëÙ¸tF,ôÀ
0ãgƒÀB2Ö9öeHAfğÀ&Æ-R~oÏns‚Oš4ææ4ˆøï­Ì+s1»õÇ’C*Õ‹t«á¿Ôù¡¼½üÄÌë³4ƒßI¦ç3Áy½SGäö5|TÂjÀ¶0=f½%—ºƒ¹›?/Ö P‚Î½7Ã	+5±¨˜¸2kÇZæØzûcH‡L)»0o&	Òå3zÊOw¨6Éöf8	İÿsUŞñtt”H#®Cv_6K|%R=Â]J£a®õo%uĞ¦³şŒ¶lÑ/Á"˜ğ@úG<-8Ê­ òÍM¢d\¼ÇE°ñ¹…Û˜-¯ÿG¸CiƒÔ`&!›OÖMéôöãDKD#oÆ Ö-²ÂaF¦ávÎ¦…Šn*Eèş}f¨Ì![ˆ{ö”Øe¦ºtjx­43Ş.¢ÈEÅp£¾a7ÚëV¶DŒØï©ãÇ'Nœ;:uêİ‰™¹I0¿Lüb¼Å@bƒÀƒPáóÓ#ÉOâ^(ªÄ´ùq9mw!§gbí3.ÇÌµ¦k.¹³Ï „t8)PÅ	‚±Ëè¯Wä(á5ÛPWïš|Ò†ˆ±3ŠPgzR/Á$Àz¹U¯½Y„B
­¤»:ò¦jQŒVj­t¥Éïs?=3Á‡qî­ÓÇŞ˜;wr¶¤Sœµk±N‰kDvıÌpï¯¤+i¸ëÓ²"y2	i³­dáéz²ê6CY—bv¥^ì\–óŠ›}r·gvŸ5®ÒÑ7
_í?ÆªˆªÂFËËİd©µæGÚİ	ú¬³Ï9Ää‰Aº~s¢~¡Í`ƒqæ3z‰êpı2jáP‚Ú!½XUŸa2†/a 3u«ñ!ç3¢¨‡%Ú‹éî nÿ¡Îø‰´—…°/Ph»v¦Ø’fF"f^Ä$7 tĞÓ6çº`}?÷¥N¬°‘°ÙnŞ¬ E-¾à\¡F¶%rÓÂ©xÎÊgÑE’YbÚ,É ¤èX17•P'Éœúv«u±‘œ¬Ï·[ÖB×IÍO(Xé ±Ì…!sŠI9/i+¸L‡œUbÊšñ˜2lñd!0˜‹¤N5k8w @°«@Et´PÑCUmcª%öÚF^Kˆµ°æPê³¥7òÇBmÑÜäÉ‰©Ó€&Í€‡_¥øc/˜éÔ”`T¯í+«‡(æ’_#)Æå6	c¤î’\²Ì8Ş	è„%Ì½r´˜¿a¼‹	áEYÎ«Ú°¯v>†H´[lëZßùd‘øÚ3¨  €Pq›ÎÚå¾WìŠğ0*8'Åœ
¿½½…Ù¦ùÜ†pG$fd%”Å>ÚùÈpùÂ‰dGF_”77ğ¦¯‡¢%£üƒÛ_Ù]ÚÂÛş!9€è<Z€0‹öRÊ,~ÏÜW v™üÒÜ†ÛÄÒ¢la¶‹øÂm2í&Ö±!°~Ğğsg¯Úgt]!4ò©ihşóGúÏG`Ä¢E#ñb\áC¸·6Z¢~¢§H9ê”Œ­N¹»´\­¨¹cwE/×†çá0P¹(†h·À#X5¤Ä7%K]CºOv$¶É–¦YÎr½ÁuI»z¾c^Åê¡W¼¦ZöEÖ£ÂHk•—®ñkç¹U­~B
ÈÙTùÇ¨5çlÌ¨ha>kâ¼˜ı·ÿşkó!AH *´·“âJ³ÕIÛ¦7NËá¾vÂ§nÔñşq>+‘,iéyoøtÏæ~J$ı¿1ª0¨ã’ƒÛ1w­§O¹IØÃf=eu"‡ÈBÚô?Yµş“‘Âû†£­[¦÷oˆèóæ‘8HDÏn£80fñWH˜H>`.æcsñ=©Li¤:‹UÄ0Æì$$ÃÃÜÍp·Eê8*"¬ åq3³·0ï[ü
Ál¸8¡2]Ş¤jƒ”å?¾x\> ÙªÆy‚
7Åè"{!ÉÒa[ÎÆØ0‘EsÙ@øÀ«^¶?xÎAÜXµ—««ÍbÁ®ßâ3g‡,ßéÖê­JR¨_lŞÚyå5/W’kI¹\VáCCÉ;S''*^D<e­ÂB’–O3h^6o!½R–¡¨lyC·£e\aì¥ŠõÊ*Ù6L´ô$ëÙ#Ä•‘‚4>ww±€·¸mnáMÖ˜Í¶÷Ü3»( ©
œŒúOğqA±)Ye«…àò<H4ˆÔ	¤*¶•.İ»õêi{‘#DÄÇ9«4Y"[Slá›}†¶ş+İŒ‰º†cÍÖ°ùsi¢¡Ey®è$õvŠò2Ycëš½<B‡¬ì=9SĞ˜˜\ÌE¤¥nš´ÍYy-såó²ÉuóJ¢bÎ4§ğï®°|©Şh³“oÿ|òÄ‰‚²J
Ád‚l‹
OC×5XVAb8×†z1æ2/Ğ» hÌÔsj¤Õ¶LWÎÈ1×²İ2vÃÆ İÚÄ=ÉËÑÊèÁúÏ«õÃ8fVëñ[Êäi¸—ET$;E)D½ã§iÆl¶`ß—ÕÖÓŞ 0Í†íBßBP§¤«±¹­…8Y08ÛÖjŸ×,'eIŸ­ÎëŠ$v¢¢ó8
q&Şå¡T%Ú“¬$†D\öÔ0äw1iÇ]6ó "ÜúÍŠÙ(•ch–‹`(ÂŞıX¢	MÙ¡+îgo–»Ñæ‡¥„€xCö±‡hĞ(tt&õáa@1¨6SÏÆ9`ËmPúÈ#è)02‚%îyœ{7v¦1{.Ù×l3xfotjb:|p>vüV°›fv
µ¦ë¥µğ¦
È§¹²ì%µÌ¢¸ºKdvï#¹*]iµçıÄ•úb‹²x?0.O¼ø¢QpW„õ‘€‘ÕıFTšá#”>>­	H•~ÆDGß=OOy\*‘ êúP3‰Ğ=­RIœKœì›Ôê@ìÚg*×l Rá¿Gza†kd¢3D¢BO!F§£E7G4&…h=‹Çhm®ÀzÜyIbó5y™caIdk½®"91oï9~Iäºµä"ùcÅ2ÓRPiı£áó?ÜŞ*	gÚ'°nzé³X9Å*z_‹í<gqáˆº7MÏ[>L3ÄÓÊÎJwm±·ó/)âè¬¦óëÃJ<çàÜÔ9‹QVşì½qÌş¼(¥²×4÷Œğ]å(æ¬JP<“’¯jrwÖFÊø dçzk†ëqGÆ-{`.Ì•Æ‚=iŞ{K—ä<”´A­€5Ø4T(…Š(±²|!;Ú Yıõ‘"š=[ø“’š‰j^Æ×J!Wˆg=ñ¬á!(Ş…¼p%–p­ïknXºN´FTÑÕÔ¨êÙù ¬%ÑŠã¨|ô'f(O%¶|ïcöÅÀKeHQsms½zÈ{€Š1é›•‘­øú7²”cu¼ş¬³ƒóò*¢ÂòTDãlR)qv5£ï¬½èøUºÂ³ÛŞ²³¸ƒ‚ö‘
û„`9]2"!ÎP>Täaİº]šu ó˜ øİğqò8¿¦#´“p‡+ÊA„^1!41l8UÖ¿E=(;Òİãñ§=c5¤Â¡·Åqªù¾pÂh&+‹}‹Üİ1XWh‘aÔÅÒµY3%åWOö3Ó¾]²;az¬wŸ¨3%+âC8ÆOp…\;òAä¯ÖM€rŠÅÛao#!yJ‡Âšµ(9AMOOÑ+æŸa¤ÕmÚd¥IØgcÉ™ƒ>PäHùÏ³ ô§h&3»r›T¯¿C›Úgê~—µÃÓ}™!˜sÁ­È©òQ®„¥””OÎ¦PLvCÒGnQV w“VI†;V<S’Ê’x^ÚY¨£%²ÍÁn›ædm’RÉjÓùïÜ5Ğò2%A½¯­VˆfÃ#¡/4£?c;6[½ =Ëc`™:‹¥µC¯ÙçÁÓS}ggfŞÜ—ÿòVf×>òWš‹Õ¦GkÌ.gG¾€Ÿ"¶{õ;*T‡åùäê*œ	¦ e…’*­§Ÿ›´cÅ£ù9-Š+<#bF55ÃFk2¡'¯@*	Åö[	W„&OElc	õÕÖäo¹ğ
kZD®ïÑ›Ş¶Uº9\ŠÕz¶˜"dQÂËb¿GùÈIh9Â½3{Ôˆ¹!z2O¶¾K°¼ã±Kÿ¦?y8ñãõv!€pSësüù*£¡€§ÊÈ«PÉ)ËíñÜütŞ,‡"’ûEæTæw_úS°ƒ5ÖæíPQ_¹<`œ"İ›Å|tÏ(^)¹2@ªæÛÉÜìH£~óĞV¨äCëÎ™ ˜@':"@}ÇGß2µ &­Ş}gãÈYæÕ>Fƒ@Dqâpm°*m`~:÷&È¶°¸çŞ<s¶¤ÿÔ™¿5v˜ë©©,Õ†L¦Pu…¬@8GÎ¿a5ªîÕ˜VQöëzàfËvlEy;’9Ù‰* âeOİ²\î.b&rY|j73·j·µ¢@Ö5|$9äë.ÔšEIƒ“¶9ißÓ)%òÇhqõé&1\™¸ëgUöZX]‹ddƒ†bx!ª+‡E&ã›%JÑQo²Âc©`M’‘âú¶yb‚;G]òÍ¢‰ì–[bwñÖc$g¤Ënbk.ËëÀëªŠÉÁØFà„DÁDÔìÑµÅD«ºiäÂÉæñ”‘›®-8ùºÃ_'«Ë?¥z@@ß,ê”ÍqÎ±´¶²lĞó§ÿµJúPÊ¼şyzÕ=ë©©¿”^uÉåÛœÊ¦­½a}ôK^$wJ”éµ7P® Èhò™Q¸—ï•;2“
O³m­Ø}æBvm§µëõM-…„Uv	DåèÆöú¬CC™a´‹¶éè}W3^hæj?ÄD˜à™@:©’şùyú[ŸşXœûhç÷;¿·>-˜tÆ#9¸0‘¬+±”OÚ*?&¡¨ó³Éû­uÑ/Ğº‡\[")<Å>ó{Ù°ß©X°<Ï˜xÜŠˆİâË),(Ê–G_Eö_ñ%»ïe•%›6Â:‰wÖº›$;¼Ÿğ,8{-êÍ©¼ÛÌ™™8uô—	’…mÂ)ı¸µWr§{?Ÿ9é?¬yğ‚´fÓ.#-ÄQÖ/‡½ç¡^šùpT»ËàlŸÙÄ¡$ÛDDtÖÑ‡ÖV¯9äæ²"û¨MÔ€+†»cE©úŸä|ãrTà…·æ‹>0¼|aZöİËDöSşÎ¿íæ
°¢}œ,şË?vü®^ó>ë÷IµVƒO‚¦\–—W:‹Åkö ë*¸¢¢Á´`LZk–)èÆÆ©VŒ¸>°¬.BÎ ÒŠ÷ƒêŸtE9tm î”äÅúoôø®³X_èKßh¶/[¶³_˜‘X²›%ò›Îşò‚^˜†úy£¸ƒÌÕg‘ûÓ[7meŸë&š¯^‹XÏˆÉzNDå…EıcõÃX¡W¦b*3õ†{#«k€¦¶ qôuù_¾ã{hÇâHGË ­£í9k`›ç.×µ¹i[mKhãr[CĞÉ¢/æQÜÑºŞ¢ç²Œ9€÷­cğyÆzhµ,çiòœÅ#°€eô;ÒW Şa^¾¶`Ï²·Üãº9o>ª¼t­îêFÀ™‡îT£ÙâĞ1sğÎ@eq°™BV«mçMôoÿã÷ÿëëß	ƒl6rXù¾T%K²P5©UtÂÎ±òRÚéT/â2+PÅ¥U¶{Wwyk•W+B'lÌš"âıPÂà  ¹(9˜=Aùy£æÒ°äX2×êš6ÈÄò±—åÕIè¤Åb‹±£!ò–Ä¯pĞ¹ËyŒhÁ4ƒ¢êârN`×T!Å!Voc¦Ú{õî¢'…M.p¡	’ªm^Hüİ±¿ÇïBÆ¢(Ÿ+ 9OUÀL£}µ\íD3<q¹	ğÌµsØğ~4kšªÎ4(>„dùÛ:hÄiÖ9Ã‚ùówàæèKf¨…z,ÅÇ”'IlJ‘$5në6‰¾=Ê-"š¥õ`ç*üŞáí×ãa:Ê%Ÿ lüšu2ëcÿ†êMèİ®_®vÍÕ^ª^ŠÙGl§œ~1¬G¢B!ĞU³ÕiÖ"£7k¼4ï: ‡ÀÿÈG'‘Ø‰ÚÂ[¾•¡¯J\àÖh lL#{L~íù3îmÓŸoÃ÷ºÙv£íîğ¸#Âjõ$èruˆPL¡¢œ8ó+~Ì5ùR”HĞåYÄ×uŠ"º+ĞÀÎ(Øƒ“P^S<»ÀÚ ä•qy„u¸Û| h«¥¨1Zª7[ò¶¹¹8k“áŞœxÏæê‰¤îÊIÒã;ŒÙø¯²Îé¹Gd2	)ï7ïee’<êEû= óYÔï ëTÒÁ‰öJz’Dc¿É¡âÏC¹B}·ˆ¦**–›uñG±ªÏ¿Ó?1}^C—9ËÆŸO¨Ûı·}ş…şÿ…ş'ã’;ñ»Î¨¨æ=2ûä×²;fb³Å2PÒIöb'½@Øe üŠÛ¹2åaÍš©hiœåpÁ<ÒX¹7}UÙ­i7\ÊûªĞD­ˆGŸÆ²7éüNXÏÑwu Î
BßÃ€9É¸½#,6İN/×ÓU*G¨«“jg5nX} ’‚ëŞF
äâ*‚*¹‚%.Õ›fŒ‚ÊK»L“(øÛR‰²>v[an•äàAüafW–ƒªY¯†õ²@¥oã\±^^K´X¯Ô÷—åÍÙL,Íò®«Êk÷vY×-•âS¼n×C¯…+éDu`lk¨Ë›©ÕJcœáÅ`_0òrE"¯/WŠ¥Óåj¾TG1gg¨DTıbfĞŒ´?@ÙZ¯œ2ëk¹8-ÀÉğ‰T§UruQö€	»â÷şñpƒœ.„½é×Ï…ò¹T³_­Ü<E~N9\¸øÓB8SÍ@âóH}¤¯‚b5tù5D•Ü¥ÚŠXB3V‚âGÙò3^¹EêÿaèÙõí'–~í…‹Ô,_îã ótjgD›ög×^fmo¬mm¦¯7L¯â÷ß9œİ˜xDf\îOÇwzÕÌ¢¥íì·àu„&XÆ¿Š#¸]GŠ¿ªı°4ŒÿqSÂ&/hJ`şê@ª	0^Ã8g5L;¤<²u£opsÓ…m|8Óø06F¸&³p¼&,ŒIEaqôŸ‚#¥Ld4÷336~sxóHB×‚&I½‰oí0öµ™R^ 2ãg7!Úìëy<¡ä‡#@‹ş6µ–+µ¹\bYxUùµ^×,ÁôS…"£¦Ã5¼OÖ<ÌK~99äÅãËL@%€*nÂ¦C¸WÜ‹TƒG]X‹ËËY_!ä=ÂI×@åùš
‡uX;Šÿñvk	é.Şdƒ®«Kq €óU×Ü{™wÍİ°ƒâUå'Ë¸•kÎæÍb$o…å­šŠM|ëª[çd­¨gåp¿mıÂgÚM7·'–Œ`lˆúöŸyî°DæÀ%5±“êÓ÷ ™oùÈ¨5…µİÚËê5\g÷¢Cñ5ò¦ òz¸ùS«MThd»ö–íwN¼yí-t­å‘°#l\t“*åÖv±5lÆkKõ&}çï‚‘àÃiF_Û½>e?TXú•·ĞÛò&(Ù÷R•÷f?ò²®iasğ"nõª ôª Æë—†ePá›X3u¬¶¸é@ÕM÷a™Dw½
Ã9Â„º¬CI"ù¥@—~ÄêÒ´Ü»ø%æîU?D˜î ÀµŸ™<ÚZ2b´yëá–µ1\á‘hC|UZûAµsÄåpà’Â“ÍYğ7©™‰½âJÛÒı¨…!Sï4ğA¡§\é›%QD®—`Ä8N€õTøÇò¶G+ŞÛª»åï+1beIy¢Wå•pæó±rwV1Ú£pSrÕ9FÌ¬n7¼1²}¨·},ZÏá¿·‚í	½Ôz¶oÖ¤ğ˜„T†f%¥f‹KÛˆ4†Ïf“ñq˜ÏVØêäÔÖŠå¾p–|¶Å[ª•½%Šú
ÜkkÅââµÜú !,”‘ïÀÚ G¬z½V>¯U/jÌ°RAßB\ú[½ë/n<×ãûİ–´q·Ş…Îí™Nz÷ÎÛ•F\°x¤Äç¼ÉÀÀ*B¸pWAÖèf1#Æ š«Z¿êÙ^42x~'V';ò	îÑÊúë|¨o#Pß<·‡ë÷	#é«öî°jã‚ùìÖNâZöYñIlëìkÂèásÊ›ÁÂV£æÎ˜¦ÉúXÖÆ6¶k#›Œ6Væ±Æ4))ÀÃJ!×T’Ò‹t"ºÉ¿Æï‹gşú¡³/—ÆŠc•7ÎüõĞÙ–ÆŞ 3ÁP±üÃÒKYe8\hx°¾õtöåÃ»[5"1ä IÆ1
Šü‰¹io†BÏTèÅÍJ%j”-éÅ‰ùy]m
°ÈˆéÎ…DÕ¯lPt¨¹)2Áİkì¾²×@ÌZT£—¯0ØE¹ùì£<õÂ'ıUóñÙ“¶/’5Wç—'PıÙ›œ£tïû¨mC;Á<Å ·ì­ÌL\´„9/B]a}{
CÒiõÔb“Á4‡¼ŠAõ‡2N/P…hIò`Òãş)9X&iâ —°ƒ<_{¥#Õ¬Œ)å(ìAY²§¹ªx²2‡^³ı6ğ?P°NOÁ?`´œª ¾$­ Îö9Tì;ã±_¾zà/Ğö-Bã'tòh÷°'BÇĞmQÍ‹O!?a8îJıÃÓÌ”€X!-«zHÆà´	W¬c13Ğº&™h´o€Zç/ ø½Cx]Î¢rC4ÕZ¬²Nc¸0M±=¯Š=z~ïÍ™Èÿ
§dİ.ÕÍ¢;uø¹¼óõf£ŞLßÀ‚ºó‡GNÏşÉşÏQS›¾ŒkçCÈ<= ÔÄd¶¢{ ™bQ4SIp™ZtH$Äõr¨w-á¶ erÎ¥Wºúo˜:ÍÏÏw„íıò…VíªC1Ü¯¹BîÊcS¸÷P9´ÕDf®ÆËé9AéÍ)ÃÛrâo¨hÍRùFÒ£Ò®oÖã[—ÂBw1lA.¡ğFø£
FäHJ;l`-á±ÛPµeI3dãõ€lX¡‚æoÿLÀÑS&IÌ€I•êDTØï6x³_Ç,Ğ6³¹”&ÊfYösGoŒ¡ç÷(¡­+ŸNÉ›ÊV'æˆ¿#Ûì¦Š^Ç›ßpnÈ“Éé¶¡ğ([4‰×¶‰«¼b¯wÁ)ß¥Z_¬vŒæÈê–qúÀçŞA</ß$ÿ³°#âÚpYPïtÙ+ÒsÜ`²?øArĞv Pí*IA÷6¥·T¢ÀƒO# ¾„¨²;hUæÒpæ!Ÿ ×› âÕŞ‘Æ_Y#úíî@½C
¯-`êñFÃˆÑµH/G‘pŸ½êï×(ë¬,/·@ßî7ƒDÍˆë±±|•Ê|£ÕIOv‹™Êøœ’÷„Ãƒ5†8L4k';ÅL3ëciåeé“¥üĞ’_[õ€4ÿ©v¶çw¥Ü=3¸7WÀ]Rwx"†&È”0È"®Rt_ÙÊâDºøvİÀü†k'ùˆ«¬rEø)è¤r,Ô‘½nPŞ}Îêk“hºÂ‘wñù½íO³àÉèé–¤Ü^7|;ƒ§6¡z+•§Û"´&Ô¿i)Vk2ĞPvU˜î›’}CD×ç˜j“º?¦ìî÷ÌÈŸ‘¼ùÌUœÔˆ’âG1Çµ[¢^<Gï;|ÈÇyÂ †€!k0qk²@¬ˆYmÅ>"íV)Cåg…
Âˆfœƒ½~ƒyä x´±iÏß?ÚÔŸ™%Ìã]N+~B´’I¨`F„=)*>I\¶<n)x†nä™=¢;TÑ,„ú€f<€õV¢{>ÄU}+—/Æ“Ğ6#Ú:¦‡µOí`e¯kq#ğlÎ·S¬ãÎØ>ºh>è(y“^D™Aæk8ÕNÀ *å:WÅ,‡&µ{5³í3¦c¸†‘‚ÕÑ3ÚÊr'mwgVšPåi.lÀø°^«$çy°a¬7ÆxwMıe&EÈ8FËâk|X¤^ï^…à%…¿½wsõnÃI¹âº4ëË5¸[·/›<™Jvã½5ˆŒ•›LÜƒNÅK_Õfg5mÃ-˜€}sJ÷3²ù›Š—ôëØ
iXà›Y‰ÜVmvÈ¾í÷ÅbÈÓT2ìd€9@İ²ŞUÈÃ„¸àÚ?ş g
 :… Ïù¸œÅÎkÕÉJ|ÄÂBdP,_zi‡Lˆp‚>*ÉIĞi-Õ›ÅC££CfeyŸ¼œ¼2Z4^«™ßÿ›Æ<Ey£Wkµq¾''Z-Ã¢ ^ÍÈéÁ:‚º„DüAñÇ1>ù„í?ÙëÙŸ»ÕzÃ¬ğ<Jg·.g3Ú—²õIŠ{à%_+aÁJı%ÙuŸ`*úgœ3ŒCYy`Ûm½¶úr%ø:ÆÍşqyÔüï.cÆ/šeS;¬:S€ç wivdÀ?İ¼dhtÓ~Ø"ˆö3¯ğ2m£íÖj'Äí/@.èö›zçİz‹*9¾WmCzö
9èbÌÈée®gku+¿¦40ŒàéE“«|©Ôk#Ø²§ş[%iZC•ãZrä…kS”E¾¾¿•ŒB Ğ ócº¹“»a¹nÀÍªHşÅÑÈøû8obÅng€[Y£>AŒ™Çú|à˜Î|«&Ë­ºáW’nK°Ágt¥â¼ò¢e¼ìodòÃä0"S\^r¡ÕUx«-SéoèÙÈßî>~Û¨Xğ\âDAa°jU'‘©úÂU*õl¯ç)«¨ C™š—®á¶®˜Íñğ2$sÇj6÷¶¿q}mš.¨ºãéÇØ¹Wìğ:MüÛCÜ`&x$Õ nZ™T¶3‚ÁQX~jfÊu!×¡îÓşcm-	ÿI¦N˜<5‘LÿòäÄ©¹dvòäéãsS3Ù¦2è»zd™‘N}iÅÌ´7òvŒlÂßL»‹-ógu©e„‚lşüXBd4¥¬rŒ&Çàñˆ[Àc;ŠmÌOWAÜ±gt ÿ•ïqáû\wwÙ?G~Ş\À' ±öÚ-¬İ†U·· £
÷™ß7½[Ê5B?ZjRÁkËl•ºÁwÔÇ	 f@¾®oÌÕçãÇKùja-Ù~\†şŸQ_›¨Ó†t^EÌzá g­„ÈÄ .+Æ<Ûæú€•äç§&æŒÈˆhw¡Ñjµñš¦Ågíj³ÖÙè‡Éëø¢$ÂdD±G4HB­f›ÊœñQ n
Ó¢AaÄu¨fÁßyèâ)0	æCÚ€
JÜ¦'ª`È8–®Ş¼Üªƒd#D¦k¶ªCàpw~î§ö¶±	¸û¦½YˆWO²GàTI<°" ²¸u	¨ "é=]Kk[± üÄoåOs ×EræûÀ£¬y!€QÔû³©ÉSÉÑ©cÉì/gç&N&§M›gs³1ä«2¹·àĞ«E}¢
„ ëz^YÖ¢ÌVfë†í“
^x;*éÁAô3ÕUı¸^¬›¿p°iäŒÇXš×6>‚ŠPà™ìgğx¹Úé¬¶Ú5ïñÚüÚ¬K[“h½ ÙÏx5ú+yVTKõ”eKËğù+ş+÷›´ÙYi§ÇÒËæöÌ¦ómˆìj]ª»¨å†ä¯üBôwoÔªÚã?n¶ÛLC2ŞÆÎM¾;>uè'OMCúÉÙÙÉSoƒ5›’`?¤’Zde1oI­A¬¨}óå(…n­“\PãÓ}•;"9Fºé‰úR]h4”!Ÿ·ü!:•lYEYæ£5ÖUz–!ğ
p—aFf1¹pÊˆ9§…‹Ï9If€f*™µv ´ûh“É¡rrÒÿtÓ6A02ÿ…pÜ·[Um4à]Çãq€½xèhÕê‚Ak5IùR»ÊıÍ¼ªSYïœnÖêiÍAí|yAÌ:È#×AáXt{y”ûnæ>èÔÕ	]ğìÜŞKÚx¢…ºtTƒŸÒµhí¬,L¹|iÕ²M~¶;2¤}‚eÒn'r'2¡fÕwã—'O½;~bòØ9 r…ıá“ğM‚¿MdÆ¡ÃBäºBª,3—¶A¤d–"l&‡;+¯‹îôí}[n]ú^,ª_nPæÜÍt¹ŞdùíÀ˜zÿÖ`¡Ãåäèb:	Nª^n]Jk|lv%µÛ^ü>×UC.ÿ›¿ÿ6ÎÎãÜÌÄ»S?Çü™ú\àªØYı+º¨<¦†„rÔ\ò> ±.ıA6øPé‚Å)Ÿxg‰M;³­…î1¬T›Á“Q÷`¾Ş‘Ô¢rs3Í¾ó'»ıGTj_·¾Mà]i¶xïg}hwg=>sôÉwé°µ³X¿	º:µâJä­üÈö„C­¥È#§¤o|d-î8ÕúRZëÃE/áx±
İ`{ı¹å"­;µ2’sí­«‘•&?gşƒdW#Ùsì“ï1ì‚|bÁÓDë¢ş Øğ‰ğ‘R.çŞËùñ51rÄÛ§&››:75÷ÎÄŒŠöŒß›œy—ÕJE—£¤Œ§¨ÉU4ƒ«Õç–Ø S_Sš	Ù$ÉÙÏƒÊÇ±À÷Á=ÏæÓR ĞíİQíh{<Õ>ÎnëîJõF§îºã€Z€ ¿¿™Öjçx«í®ˆÆ”]³ŠÓ†‘ÇEu“ªËõY@`áÅ½¼TM=pò·•Ü]ûPpÆ¬³ÿ £ÉÀã6‘Ót.­Î2¬ê?D¯0#º>#u?–x2O¡Öı‰
†4[MşÖÎ:M„Ê:µ[±N²kº>Ä?ÓÏÙîà PŞ•½?G•ê#*ÊÀoÄ]°—lpEW)A­îº»ÖıxûÁö7Äô}b¨	”V¿_O·Ï·?QüoŠõœıØfÌ;°’©D‹ö®+¡Sèı)Õ3—MpO|Œvû=VÖÆŠ‰«[ílğl H÷W´ÃX°ö¨•ÑRtÍú®s¡/,
Ïî¶`N¿h}p©`dğÀ;mçhoáxÂÕ®5OW–0m„É<Ì°UZkTKéˆ1àÄú3yäT!”¡Ü6t{f©in³Ğ/)Ò„«¾×öoÊ+l{–ĞÅRu¹X¼l“E#Ò`$z9› :Heãaœ·¨ìJ°}“·SƒåªG®Å¿<÷”XŸQ·_ÜÊ±"½ã-2ÍÒËiûª]•d»6£¡tdmAySñ’£H¿Ç¨¾,k“³hp÷é•yEøÊŞ+k·@ÙÊs«6kuPÃwd¶t2|ïx¡Õ¨B>•vkÕO‚ ©®fèik5C2é™Ñöñ|Îî½!Ê,JB,ãÀgòGî{1`nCVãÑï	M$Lz™^1\İ|×f˜uk*Ú)”âi0ı÷ÇœÄ‚Şcù0Í‡“·SŞ×2ÿúÅAÔ¾Ùo¢ëg< ‚?hŞæÌ»©¹ŞÍ\çc¨ğó"~f22Sô{Ğ£¢\î´–Ò¢­{Š@I0tƒÇ:3éRËÜŞ¹j2H»!;‡¼uyÙ¶rÆÆ’ÏÒQ˜Ú‡ÿ¶Åî-1u~êÈÎúŒî3bó¹Ä$3›;7ˆf¢HI%HÊ¿@sì},•„|D½<2÷9Æ=K¢É&’¼T‰É§=İ7<ø#¬Æ²‘/xXV"ÃV9•'©¢>§¸)àÑËĞÒ|û»á¶ïoÿ,ü¶/9¨ÍÙ¦2_l…Ì VùÄÌ›¼«nf’óÑ17Ah·SÁÌ­‘B8CxxÇ<şœJ£|Üä­€C¼e‡®ÇÕœÉÁÌG’C´rd…xgFCë,gy´ĞGÿÖü%%ì/s“8¾º*c ‰º‡Lı¢¥ê]ËÕJåbbî¢£±NhäÙîÖG4QÑÈÅµQ§g#jGoªÛ%h¸ë}R0	CˆÎrçÎDÇÈè6„ ¡PäÑì¿_0„hÜ5¢ÒùËÀÁí¦4(Ùïû«nDystêôÌìƒOÏ}GÍ!Oy£Ñuçwï‹tƒ)téOLÓ§pßtTn¨É±º›Íˆ 4…jt…º—m'€HB’Ä×Ù	ï¾/dnK±«Ç;Â´Ÿ¢'Ó£íûX©ğ¤Ò#Aôñö'!¥ğw€Ş<¿EÛ÷&ÆdÙ)bÕBªf¾ƒaĞfœ z^İ$e4‰äzæ F_7¤uİ=}*¤ü+¤¨¿)±û«¨hwCßc—tc€{ƒµ1ÿöëÿîÂöˆŞ«]¡yçr|ĞVSát#Ûd¿NrWó˜gà'Od\òÉ4’~pŠ@8üNâof ä
@æWÛb-?4UªÒiàÀ}Â±
Ô±Ñx¸¬e«Êºƒº¢GÎÀu*ÙCÏ›ĞS5S…Æwşw«áúØ¿‘Ï ˆø¾öRïï/î-BW±
RÈˆ9£’¾$öÛÛ´Oñ2lÚÅù·ÆæÏ ]„}A4eîÊkMY†CD~ŠüØ*kÉV®JN2³¨T“O“ÆÊ-+¸õÎhŞQlé¸4jg²i³}Ì ‡Gîi›¤š¶òâ¨zJ[ŸÚ:"åeÄ½†Hˆ¿rû"OŞ7¸â6Ëâã
++XµÉ=µëN$;YäÉƒîòf©T:Òo‘ÙTCÉzl¡‚]¬®Ù³cé;¶Êş¾?ÍÖ“ôå9$îÏÄ$%ÅV;™{şjš4S³­İWcHêB…‹öè6£ûÏUæ{ˆ<˜fé…ªRƒ|ÜvŠ™;}lâÔÜ¹SSsçO>eùå|gmE:×1V`Ë§œîAˆ[àçiÄ¼À·â½SÁ²ÌQ]MªíÔnÄ‚të¤³œÎ×êó|¥ÂšÙ'­çôX…õƒİ8Ëb±X?%_EŠ­Dq›^ÇIÎ“›£?DøÒÊC­lì…ÖÌ7‚h¢H-º}ğÅXşŞgğ[è»¦V»Ïve¹°`LÛW1ÆrÎÎãiĞ›qİ§è’ŠÂSi}{Fg}Ë'O±ÓÇæ¼6ggqBÜî'>š¹%ƒÁÄFˆá€…<q9Ù~@SœõGó4\[tp}Æ›W­æ‡®’ólSØ44Ødâe¨™ UØ(k
ĞNœt	Mæ5‰¾Ëèù•4©š„jÿh+Ï
 ZèèÙ•ß0oZ^«¼1İf††Œ¼F=æU(=«$y6£?óz¿ÅãÜï­õóP,¾a.û4ßñ}Eò€¦È±à¶3}?³Á3´_˜=Ã¹íÂßÕP>ã¦
“Ë´İLC? šF5‚gû÷742h¹ïe2î—=LÏ»Ò‰fŒğµè÷à<İ¨òÈ!K–İ’RË†Ä|CöÂdÊÑA½Úò£ß=µ(BÖ) +¦ÉQˆôÈAe‰l/¥˜Øp ã¹ªdh±Qàæ5 EÛ­‰gÑGÀF|ó°3ğbåÛŞš„lı2é·¨Y<ƒ5ølŠYÎ¯”qBèéM¢õBûòwøÛE2}$¹JìÑ˜8•?IzåÏ†¡RÀ¡;g²Ùnµ‘:99K+ø«<¢¡¯Ä‹¢!{rQOIË„ù‘½¸KŒúÜg$ƒµ{psØìÜø‰‰sãÇç&fÎÍLœœ2 ĞÏ$†à	°
ù'ØûQNœ„[ºuYÖhüymµyÆ1E	VëÍZkUBºäß³OÍîEâ¹ÔWûÌµgd¡gEÏú ŒT–„ê¬ÊÕ)Û`×zs¾±Ñ–6ÿæöVa×˜eWĞ'³c8œøÅôäÌÄ±‚épÆÂ;áÁ#§€8„&I•Óç4o”k“”±iÀ]+FXB+S,¦ƒâ#Ã(á,ĞÔ‡ïê¤£¾{Î e«]m×W·[›6_\èÓşĞ½ÛÛÍB?äÈ"Ø@VSerf€¯hì>G3õMK0ÑløŞQèáÉ#Båñ™©ÿ:q*?®çJúKl¡¢ıGÄXÃàúä‚¹ÂP®
FÈN¥Òh)õ¹PDş+¾˜vÙT£{õ™F?ıÎÀO•ká¦X¢·0Jßü`ÿ÷½HO£{RÑ›xŠbÎMı|â”K4àŞ;ÑRÄ ¸¡BxÂ€±$ÖÀ_{¡’©ëÌI"&²B6—'ë§ŒU+4à•¶—Ûu4¡…0£Ş2äœŠôçé×YÄø`ò#~”‚gnªè³u‚äÇÛ_ÂŞ`Ö/æ.zzÂ$6Øƒà–Ë à7ĞS4ño•¡»O­$ÙŞí¼mÔì"ä­ùÊº4w 8PøªfÚ4¥
^é.f
I$}dg"q HÎnP¯ŞÚe¡m7g9š7îa§÷ƒÄ\@µ®³KÇö=ÖİÅmÚNëÅ§ÿ.g™úƒö‘ß–SDRŒBKõŞVÚmó	58‘ñv»zµA¼æ¿ÅL—„ş:‚ªÇ’¼ QËgåKa†ÕOK< l¥;Ùê‘ÈtkÖ¡Ïô×Œµ‹‚ïĞ-p‡‘÷“Ó	nòc=²0eÃNœo ¤ÿqçCkºÚ“™A½ ÁVüëÊIÁçkÓ®^àóÔ©tªKé*ÄRÃbÑá@úï°ØK£¦#Ex÷r†(Ö†âFkq8ÄÊÅu ¤Åæ÷¼)ûº?F)ûŸdïìµÑñ)ˆqØaıùİ İê¢V^õõ‚´NõNYL9ÌrÊê>Ü Å"èoRë‰zµÌ{6]‚syìÔ…€Æ8f¯ş #z®oÁ–Ïµ¦ºÑÕúPE'ü‹¸…FBÅ'¯ s¢ŸĞo¯Ü™áLDŠİ,=^Š›“eÈær
7«èî¥gW…ü\Dğ¦ºŠ+ÓSÑâéš÷íÚY®VÓn9­­”/­ÚDiÊ"V‰)|v’mbù--7é»i5uL”‹ÇI«ZÍÚ;†«¦ó<Êì¦*D^éuúXé^ş±èÖ´k…òÜËò#¬ÇÎä™ù:ÀïèBîÁøòrbˆ¤ğ«ŠÒ•’{ Ó2Ó‰¥<PV×§új0˜H¼ê¦­&tM?ÉİŸ%d½5Ÿ´V$C]%Ç‚à~^?>==:½s3u,Ó‹c‰4>131~ì—çŞƒä¹‰™™©™6MÁ8Ñ™áŸª?X%Àƒ<•¹òv:Õ‹æxŸ’ÆêûÛ
²sá:Õ}`:ÑÂs_h~qXi·pœ/PgaxWu/øT,ì ¹»Û]C­_[hšÓ>Rñìú<¹â$^%3{Bu7QÛ#)"“UCĞ:)f$±ù•Ï|FÂÖz°3P©@ÂN\^„+*Œ¨ê·ôr¼a&|¡‘Út¿òå;ÕÎâPvT/*ËİÚ3ò›Ÿ}ojæX{™MçF.2·%~úAL©l>$)\qÈ±t‘ƒ±¡P=hÛ$õ=xH4ÄşÎÕêrÒj'Õ•îb«©ïEØ™O›Õv½Õ9°›¨H¢øò’‰¸–ZÿôˆtŸäFƒ¥5Ñ;ëGÍÙŞ=nœœGPŞV~óÅ^œ›¯!Pw†µãvßV„Aùşc[‰‚*{oaŠáÉĞßi5j.??´‹­9d×(¤ËWå>×n¼éŞ×úíË&éAº0v(ÀÂ_ÙE™íˆ¬ôÈ‘8]ó»_p³°ƒØë'ƒé©ZxÈ×Yd>ÊÓaøSˆ·UT(v´¢·fÍÅÈì ´wfE¥’vü+Æw0òC«ƒ×pv:âß $2à"ÛpˆYy“ó&]"Äm{ˆ” à}ŞM!
îK¥‰
Şˆ[GôµvJË%|œ÷ÄøÇ”+õ†ûN}µF@Ódf<ÑÃ%`H“cîJÙYBx‹ÎÎ+jà¦n[Ìˆò©à7aMg%9È³~ëFµÓ=ÑºXo(9üÈÌøÈİ—ğmÜ`—½Ãì'åª69ÅÂzé(b:~ÃôĞäPµX6"î²7?Ÿ×ŸŸfW#:7­]8¿‹éÁ¢¸A× .ê-Qg;Ûtız6mØËŠõ.÷©ïQÇ	oPÖ¡¦ĞˆÔÈqi|†“^5…3š\öSäxwP©Z€Âp·X®;?Âm¯Ám
™½ááõƒşĞ>~d~€"1mübÿ#ÛqˆæÊÄÊI×óüvy ğ‚­òÉ¢£KFéË#YÃTXÑß¹	QÃ†ƒM4Û­FÊ5tÈ$Ëİ¸çÇ¨dI0L‰ŒaæWûªFÿà‹r½3eä[L„ôH3G®ÍìJ¤à”ÒŒbá¯]ŞÖ°µˆ´)Ù)x¸sâıóeö‹(î£-z–Gd}
„»r»Ê¼±µ-H'\È¶`¶#ñôşD>e§°×ùŸ…ÊºFtb¡G?ö<rÚ¬yW’`Í
ÚÂò(êÃ8c4K•S"rw ¦ÿAx"æ<‚Ë4ğˆ+³+ş=²“Æc^2C,È?ªeŒËâ¶Ûcè¢’{‰ü¯×2;Üs°(ñ›pmÔ{l~³uyTŞ	kk³Å^ÊŞ)E`kMH×>æ¹Ùµ÷Ğ€ş»yë%Óc®÷Ïaºµ¹‘ÎM:7~
³âÑWsõ
×p-›Ÿ¾Å®S9Ì€7
¥³áÜAÄ»òú^l¸’ÆôĞG¦ÔGâGJ]#P·Ús‹õe“DõÕØxZò@eß:M«(“2N(„§4E½§ê|À€“+r—~ºÊ>~2ü¡bN;$F¼f"ímsçLK+Kö<9İÉàSÔ_õ˜h½3C_M5œ‹}È›ÎbÀJ{¡:Ÿª{èù f(äOv#ËDv¾âŸ{N[÷#G¢¯‰ÒıDöTõÎÄ•åF}Ş–øñİ¶B–y1“ÇŸ— r0¼Ş³G¼nrQ6d™Z·H9ãAÆ^hz&€K‹ú±–‡@#öëµ8ãÔ«Œ×Â:qL,H3sk- t;„U +äúö—R¾…VYT9A»…¸ãÛ(Èû¦‹·eù0S¤xñ`ÿ¹T-Kö}ÄLü	V>— 6ø²ÊæÄ§Ù÷¢sêscŸGÑC	ñ<ºƒ}RLíF·óm+®¾EµU/¶ØG
Ç,˜†Óîß'Ò¿á¾(‰²*¢]êØãúõºõAõêß’N}pE8iÕgÒNÚíWÉ[w=›bu÷Éæåj“Ñö­î¶°—¢¿’?ê?é¤Spæl>C7Ø¥ u>šoËªÉÌèƒkË²SIl¾Rd·*‘@!¨C²3÷ìãKöÀ¬XŸCí•XÒ×Xvâ7	1·¡ÊÉ¿±y²s³w¢Ò´ŠïTØÖüæe±õò?wPîw/Ë±8Ÿ¼ZN¦Ûé2do“í_¬LÒIVëİÅÖ
8Ô!Æ†˜³îbºTNæ”·ŠdşHêíŞHÓi«Ù¸
m›I­‰úVÛõnª3út­¢ÂB½[µáÆtö1ÜSb$ïË†R‹ÕÆÂ°Õ—îÄêÆÒEƒC ’şÕ;§Şböüñ¨ycİØ5ı]Ò\i4  ˜ùOĞÛ BuĞÌ§í¶ªsN¹dS®å©Ì.·Úø»Àr.«*¬ı—ö¬6(=‚*a6Ş®^¨Ï«_¬k/ÁŞ=²±‹xæÆıætŞE°d¥Y7""ùCıi.¨—’=é¨Ùc£	òlëG"xÅNÖx õÜzzæ‰P{¦¹´'SLí€ÂlpVj½½ØÂxÂÁ}b›89>y¿ÈÔØ4øØ&Q	*ªú?Ll=ÛÂ’d;~%¿-LÜ|OBí0›˜çØÏ1lK ¶#Ä{iõÒ±t¡ºÒèŠW`ÄQù1¾¨Í~obüççÄo0Ô£B@¬QüÏàN›ÍÎƒ¤dxf¶â5ÌZu+ åŞº8ªSˆ:!R,†€Â¦	®mFPİ»aÆÈwûôİ:™SÆˆ~ƒ‰Ñ{ì›Ë·ÇC]ä-â"&ÚOıÒ'‡G¿fOS{ÇVë,Ê0“‡ŠÃ¹.¹î>0Ş³`“éÛâ&©3û±}gÃhKq­$Kiûbj%Ä,Ûî®ë5ÿC#Íì?8i3Û~‚:©9{P±v¹İºhffZø4¬vªÿî¶1‚ÒùVÊmšïRï)°éKfCk8¼*`½‡J¬4›¤o[¿	Š
NÈ`¶ı‘’$İÜ'¦ı†\›Àz#iÙ(ìĞPWue™ÄOe’ˆi#Ü?áÄãG¼×¬–3\\¦ªğeFQ£ÙÈÌ=ìÁîæ·¢P‰Ú#ís÷X¬Ïd7¡{bm?=­ìCQĞ¾×½b»¼P]ƒÓ³Çb~Ç gM‹e¯•“·$:hºÜÒnË
iF([ª6Í/#iA
H,±óáÎFÅ¦Fˆ×kø˜¸/õ9»ĞıÃÎW2«$İ•Ş>”€ü[b}m T€	¢òÍì£¹	Bz5õüI³ÍšV#;Çí!ƒİ÷E>À8û F`”¼ë“=«SœV3ŞÆÓç5²œÈx7zçöj»(j{ßL:y:~Ñô®šškÜ¾D©×ß“?‹Qˆa°	|"æ0Kc‚JTCÙãvª·€v `ìø×pŞgRÒ]ÃØˆPbÒd¼eÊ}N©pt¢TRŒîÊ
sOŠå p
u»µó;,«r7Á|.Ğ£dö†¹< rÃRÇFùÓmñµå¹ƒ4ëîã2fSÁ…r+EıäçP*†t®˜6‡¦Cu@p‘_ˆ !¹ƒŠ{'g?k˜(ƒSÛi‰«Qêgìåäc¨êu¬ÂñÁÎ­R‡øæˆ6—ÛÔDæ7çİÊßéÜŞ­í‡’¯X'QQ§‹
i©¶Ã5ç¶ï‚&¡ä‘ ³ª´f×J6ó[ÖÌ¥ˆ%¸-ri\ÅI<‚c¹^cXã‰	
šÂh*6×»TÅ
æ.¹wÀ{ùc#:[³ZÃÌ.	›š;î¼†¬ËôğÆ.¾XP¬ŞQX\ªÎw«‡_}møò¡Ânz9*k³ZQıb€óÒ­<ŠB|—”è¼AÕ–n¡Áà–_Ô[\Çï	seŞİ4H°-ª‘%ª[xO­3:ñV·©V)ì°“ßex4…øÎ?2?¾N¼@TÁ1añN›úÉÍº 5pÛ
RáÑ¹Á\ÇÄYÏ¶?…ÔD2EĞ¬~Ğwš÷Í*¤‚ŸqÂXw§ÅÆƒi(ßJŒÀz«s"Ÿœ=AbmŞ©K^tzcK`ËoÖL‚#ğĞÇoŸq)	À—l;Pp±uIl²ÎÖ´b&¸¼Üj+ĞÌ9!1M|ÿ“Šf	;·È8/ËÈ@Ág€•G¢)çè«²GşÙÄºí«bz1Ç–Q#8İ³²ZTk"–G>xÃ?/¸™6¬ÆÍ(À;/"*Fçïíë!;©a§Ï@¦
~Oæ‘Óv›;=v]¥7íÇÊœtƒAÚm.Yqìôô‰É£ãsĞ˜¬&“Ç
n¯^ÜRe3s_3†Iú§·‰>Œ¿ö}<ğõ[{ı¶´Jê”ÿœš%¼˜»Ğí¯a"ì µLûrù_ôõ\í%XA×^-áÄ”(–
Ù©ŠÏnxd
Ÿß‰óM’¼s+îŠJÁ”Â›Na\Ğ#–^>Ps¹‡Õ´()è}fr©bí$U¤üG&}¤ba˜.(ÔÊ¹M?Èˆ–Dæî+h¹=7‹Ç‡Õi7ÙLÁ½¸6C oÙ4¦ÀóİˆpŒeQïQê¿_#•ÌÌ„Æ¿C¶õ°Ê'¶ó;–M¯ÿ°ó!‹…°à‘xß£ÜªeîÑâ(°sn`.Îlú(ƒ‘‚*rØS‡	0ñ`,Eè%û÷$KccAˆFÇÙ¯¯0ßJ¦GO:àÌPã›éÉÓÍõëI5Îí©D•Ø§ÿYÿŞ=ánÇĞÉ9ú¤U‡»HÅ¤÷ô‰ƒ÷<¹ö•Éï üØ5‰s+ÿª+qÕŸ™Çüıãs“SP´ğäÉÉ¹sÇÇ'OL¨bW”·‡ŒK¶oç—¡.Û:„z£Ê[Ê4`
v?OÓË	òHõîÕÄĞkL}rªÕµY»`£|¡@š›ÖE1zØ­¨tÖV!/›Fâ&Çpó ¤I„d‘Å=3g3ÔÈÿ•»ãÃKÎ“»èÇ¨½·ı‘:¬›(l­Wì€²MëJp~ù’Ô|ÉK×|L½–¸7/3+­ç¹Vd®½ó„Ü/ú¹"ñÌÎSyÆrÒ>iùÌYµr_”ù¯îÛşqyÔüïPÁšÀÚãSÎ8X^L«5Ã³ŸSZ{¸
/
gñÃÓÍKÍÖj“?kuràGBŸrà‡?¿Ğn­vÀó¥fí(Éa\ï¼[o5ğF¼Wm7ŞT~ëÖ„k#!î˜$6¥ØÓêºKÙŞ{Ù;pş¥kúš­¹ŒÅ½Áòÿ  ÿÿì½[sÇ•.ú_QèPøtoÒ’½·!ÓØ 	É´Å‹	h<3ÚÜd³»@¶Ô@Cİ /f bx§iÇxtâDœ‡y›#“‚DÒEIÔã>x_rr]2s­Ì¬êj¤e[œ]••×•+W®Ë·
ÈÇ³#&+ˆ¬_^ËÅ¼s›§Å»Lvç¥cÖ%,c”ĞÙ°»«˜&f¬®ş#Ó‘¡kÖ+sÙm‹¡!;Zˆ !d+Èš‹A3œ”‹ö8e lıšp´(ù³t„ü~û°gDÉ „ìn­&4›|"¥nRÒŞ¢H½”Yª™ìÄU0Â8¼m×™ìïnm.)O2dÿ_YgÈîääò¼0$	’Xö>È`‚øDÁ ±?ÊP?Šñ>J>Š0>ª {”ázXÙL`yĞ6NÆªŒ§"bTD|Šr¡U{ÏkºYò€9ŠT9Š[í	 GÚï1AªÎóVLVA­!ÿñn`î… ¸fƒ‡ğdŠ32Î÷P$øí,p8øĞ»™•”Û™ÉÜ&y7Rnkm­¹Ö®×k3­µîŒõÛŸ{Æt¯uÖˆìd›0£ÆMzÅq[•-ŠFp¬6Ïö;—Åå‡Ÿv;Ç6VÎ²ÿ¬‘Â”¤¶UnÇ} ›i{b”MHµulÒ~îm6%ç Œîl’ù'8ç“£'Ábq‰“rsÍ»Æ×}ØÂ¼ˆôüwK4åWeÊÍ¬4ğŒ‰åUÚ),Ëj­8vÏ¢Ï0r­‘3O‚¯Íşáé çˆ^…dOEÂ³6ìªœ"DªS*ç
Ú°¦BÁjX,î¹æzk G¿æCîmÄŸŞô3MìÑ“”¬oiÔØPÊ¥@œ8VX£¾Nçt•T¾á6´[cÜÒ°çqíŒ0 ¡¡¹TŒğŠ«rO™“âŸZ–Œl^ªlÑ-oqóüÎp‰#ÜuÀ,A± ¾{ÉÈßò»Ú¡àOŸ7ä~šõàúƒ§õ>æ…<÷3T|Ú¶03ÛíÌĞ¼„;ªmp@ı„[…ÄÖğÄ<p ö¥«×\#„înÇ/ÚHr«7"neónY¶ô|ûSŠDaqô+ÖU‡àP.áŠpE™¬ÆO4+i¤»úz¢«cs“4@ÏØ¥é.År
¬•ê¥¦kG1‹^·[£ °Û,jeÀã :²E(QÄè?Q}âeëÁÅ)Ù˜q¥ÎVë²c{§ÏÚZM}ôóÄ¡êôëºşŸëãßˆÓ´ˆó]Æ‘‹F_¹ÈzW._–~ŸD¼Öµ”‚[¹ÇÓ>OÕd0¨É ““Qsc
àÚhCÍFíW›yö˜Åä'd-ÍÆíÈ<÷~¿­wLFï·ÉkYp<AèˆÓ^O_êÏù¼ãõò/©}$M7ö,äÌtÜöìLI÷›Âİ4™…zß7+.Ô8şP¢C‰ğ›ƒ—gÛT$.cÑÉD¢Õ(•ÒkáÚÎcœ¼…OO6ö’˜ªò@™ïRqçdoNbRSì!ö¶ğÒâ¤,L’ábyıpŞËÍL³'¨ØÍ2Yû¼™›Nà/êJı¯;ä¢5‘/ 9-8æäÆ4µ/ºäûc6´%
/îÀh§-µŞÖı}lEFo!N‹[QˆO7oaDdhÖ9ÏR	#çsNz[V…N%rÎÿ-Qˆ”)vo
ORfø³¹'_ˆ{$IIXÚŒ³œdÖ©;8ˆİƒ{xhHê¼S´Fˆ~–ÜRyQÜa“N‹½NgE	„Ò²ã
c¥€dUçÂß“îˆJøqÄ× ş¿P`F.š{fF€¦I¬gÂa"Ç¸iù:aO$GEeÁÄDF9vÃ§ù *õ“¿JDÉö„³¢U8Í5—ûƒv®.û_XæP7Smj×UrÖ¡şn)£€î‚Í,æ™ÊÉî¼áõò›>è_"G5UŸì_V¡H<§RÊp…±çõAÿbœ*îSı‹JI¿í_C¿¡Ä»ÌJ¢|ƒ÷Ñá@Ï©¾³øõ«¥† #Sx*¢â¢£É*6ª¶^`xÁ¡×5?BéO½eFu«!~fÊSÁı<ÆTœ,€‘¬®£t"Ïç")pªûKú	-5”†\ÚÎp ÷"Œ‘z¹_½X:±†Ñ¿#1E=À£@4İsè€™y‚§#‡ş„Qå_dÁdıÊï©ä²—=ÛÔ¼º+è©¤F?©mr:ğ3¯]	(: ”*Â’òíÆ¯IàÁ&Õ¿c%I‚
jË€jŠJ‘bêò$ğ‘{Ó\^[ï7FVê¯¼¼ë?†‰æ•«5sı£76½X1•*œ *#
0d$Œ›ã± _Ê_²Í€í%´ü§-¯ñ»ŞO?OùiäPï•_
ê‹ıM¢´¬b³¬¦1ÒñR«a ”?b“P,'X*ôaOÀX’4¾‹È™—¶RI½´`˜DÛ¯dgQÎm"İsTAQ±´ˆ/]ç6ÉÕ§gd¶ªõğçiFo8æ½Øï±Â«ñ è
¬ı\ÃÙÚ”†l"	$#w	Œ¸8êCïËj2ÉáE‘iı@‘s¶4\½˜Ì1R¢(Å€© İ2²ÃäDk%[+/£°]Š
©ø‘ÕJˆ.Ô[?ÿ.¡]D=E€.´ªºDWvEÃ7ƒ£ùÖx\+]Ze7t[
ß{W·Åè®h‰')ySt¤PéJª¿„¯äÚ¯º¯‚¬X¬f¨•ÎÖ¨ =f4ÉêlÔH-	DÔo„0LäLùDX×çte†a¯´Úë>ÑóM‹0^æ„/OŠÍnÕé‰7è-”lïn?
@"`3É1úPK0á—©‘^³=Å}‡¯dCrfÁ8ã`û‘»¡ĞMU/‚ôZİ´îˆc¸[‘Öé;o«¿°·ÕCq_Æ>M=^VÕ•c{sÚÒ=8+]´N~:Â3k¬#k_³ÄyV.(ë
E‘57–½8Ê¸®‘®RåÛèƒj\—·ÆæMÑTlöoá0ÛÅYV
Â“ÊÌhpPaˆˆñÃ½>˜º«íÙóª§A˜–My·ò%¤«À~ôPÎóêˆšàÜ€J×¯›°%t3òåh½ôG¦3	Ù_Nq™)å‚Î¹ê·>ì5ÖØ¤q¼Ÿ×9Œ¯k8´×¿„iùàí”xä=ÆÂğ­MQf“MÚA·s€á=2nP˜Ğ?t‡İ³=PqH¿HeUaL:S*†ëııöœÂ¬ËàAkŸ·^¨¨Ú§¬R¶ÊŸfû`®±^³	ëlÚ½ûI¶_öß²Áÿìß·+àjCÃ¾Ú¹Å|o‚ç¨Ìù“ìê¡û'‡À^}«:ßµ°¯;|wØ2Ó•(d†Q8»P !B˜°§L€®_zí½¡U&Öõ}O‡rb¨©ÄÀ3¹|‘Ú¶QüŞ¿íÖ*e®°¡øFu!uÇæC²ú…Ôäöµ#é÷Û¡İne\%Ih‡í¶îĞ¾i­V"tIx`‡DÏßêw‡k½ÖeXK]C;Ñm]kĞÏp´éQ)Ö?ºõjúc›‡œ ¾¦uË¾Ñ~áá0¨=7ëÉqpM®n‹|y£çóåÇ1%¦Šln„³È¤uoç«ù Û¦…p1DºŠD&$Q*L’¦E½ºŸJ&‰)+•µQj5£/„k‰o#Pœ à©‚…°rS	‘?ÊŞ“Ö·–‘ƒÂl‘
ØRêğuˆSnNT&C½#(ÊgÇÊq‹ˆÿ‹P¨<Ùâ«°ôšªb­Ù	` °"AÏ³ëQJ/«ÍĞ¹X"²]É0ÕØ”3æVæÖas½V·;|kÉlò®·n€"îf<QP^õlŒ_)Øæ~¶)îÌŸ¡ŒíÂÿ†½£î˜__n?Üş$LüÓ}FÈ´'öÈ'æ,ÃövÍ7ë³˜h ;ÚZ?o¬KõıSüwwµN>vuœahöï›Ê~`Ä’F¡´h%d¥~Ñ?ñ©5dJÖäHud‚C­N`ƒ×…û	8²>ÆÁ™;Şµí¯³ d¼Š®ºL¶Oÿd:°E¤ÿ@ºD?„ô‰œŠûñ@áÁÇèÛï#ĞÒ=ç Ö$Ür@Bú×´G=ğÑWpe‚›ŒÀÖÌ¸-sÇ‰¿héÁ-ÿ®yú;êÂùüŞtÊtcÿ|FHm07EM(Ç»ZƒÔIh½Û¤8rl`‘•ïoÿ	Ã”~ëğÒwn+tß¯Á•CuŒùÚtˆ¹¦×Ä8™Â:a—“å©.0ÆÏËkõ[={LÇ]õÒ‚Y¸C5òó•Åõ5©a£U‹¯d¶ÄdÄVÜÏ]€œÁ'QİğmL¶})pÏÅ`'¢£Vé¦j0o˜'âº=ÜpèRr/'äA`Ã¦Í%|¯Cš£;+uŸªj"WK«3£èù‰Ã+ÇÌ…Ú<Á#§B
/>5LÛ·'Óñ}†ÄùÜñbtè»ï£ØM•“ÍÁàõCz‚\©É)\ vÛsúüş'îBâa×P·a>œğĞ•2d]o¸(‰Çæá#B¿à–|€÷°ÿºõgÇë;·şÏç w‰œìÙö"Ì±[¹”é,4Ê ãuJ9@03Øùø?îAƒá8¿ş”©®92 æ¼KC¼Jús×àæ û6c3~Gğæ„°ª¥ígb€½<!†Ê¡ äQÉ”~°yÉãh2¾'ö,X<v*†.o¢ç5¨£;Æ4Âí’îöşrD/d¼êJëƒü]Ì¯ÉW¢:Ê)ğØ]kïÌP=óÿQ#2²–¥şÉ>§ÄV$ÛbV#˜ZøÍh6|pÂ7­?µåsúFæ`:6˜¾mÉaå¢(éˆ£:¹JÈkà'ïê‘€Ô“3ÿûu®¼1µùÚLs3QÌ
Z%€‰oÄ€‰!VHÄèö0óéÏX´aÙìşö3'}ùk¸E›Çä´^ceCå¬dç³$fB¶ÍñE­F!E»i+‹ˆN‰nLi>%8x˜:œ&wI×3ç’ÅÖí¨Ä¥ÚO¡¹~µûr¥†ÖUU‡uâAÊÛ/ÑH4Œ4Â_UŸ¡'¸9=÷|ÖaudáFôD¹>ıƒZÍÇ“²‚]î1´7Ô51ıø¤Óíûp7Ë”ØO» ‘ê_I3ù%Êˆ¬£ˆÆ…¢TQ·×Ç¼Ÿ¢ «–
¹™ÙŞÀ‚](S‹Ê±„Œv¦?HÕRy!í¨/Ê(V­àû‘²1¡Z|?©âšêÕ+ß5ù<Üí˜²Y¬[%2ıñh2…9 (!ˆñx3.)s´½!ÕÅä¦sZ(:ÛoRRÉQ°ş¡u›Üç‘<Qlxw@C´§!®m.›Z—›ËƒşŠ\ÊˆÚy~Jø:—HÅá)x>"(TÕvNò t!gsaÄŞœÙ›k&iA!oì“ü7ì‹şÓvKÏ£òşl³gØñFÛœ+­µÙìhkí't£›‚™üéTömT<LŸ›ç[ÃºéA£‘Á¯!Üô`zLuEaÊS2…áàë`ª.´zÀxÅ(
éDÍW]O˜Í“Ç†Vœ•†
N²ò-”\„YùÅ¦P•}Ãq•›‹+È8ÿˆÌJÌ³äx’WRV&]#@ÌæU‰)ÉÃ­­O7ó;pÏŞı¶4'Gô&ö³7	%Pşølé3”™8IÛåG©ĞŠª›ÌØˆ—8XÓÆÿ¯ä|¥éS–şädú7¯Ò¤¢Ã7ıókkò.=³ğgtÚ5{VU	L‰[dO'wò	™*Ü!^(:f>jt¬‰$í'+1PÉ~Pl¶K”*P';ˆkR”°*YBxÆ(
dîŸÍìN~ïØó…qÑIY9?†<àT÷Vµ?vÊİÚ²ĞúrÕáæß5Ú÷¦ùÏOD_Ìïïß®”2¼9”½l¸
ìª±?~’½îùªÜ¼´V;Gd¾Ò*o¸e•€¹íZŞ
ï¾mÈÜN¾ƒ1â•ÿÂSöY³2ØŸQÆ®Í7Óë#zÍ€K^óæ°S,Ôèë0sNaÒ/yÚmK]Dí%f`ğV!	ád5sÎÄ Tœ¤¤#ušJXHÙBwşLK¤».ğ´aÁPD´³ëÌMØÎ¯nSÙ-!sÿşLiê\pµS&µw‚¾´jà.Y±ÉìªëâY`ä¨š:sşœ~íJ‘ÃisØë!oßT¶_csÚT_†o‘xŸ¡rwÖ¢«ùLòÓ¹xk¿×=¥´“i^ªßD%. Ê×2ç`<‹*a%„ÒI$+
5.‚üçmÏûDôxoO¼Bq˜¶65&£4“‡¤ôXH=Jj!ó~Â"®¾ñ!¤Ğå*O,ü‹oÆ6º 2v{ıîÙAkpù(Å©.<rhéô;Gœ?ùO§B®ÆÃoÍ¿ûÎ’ıŠ©]ı|§u67¯Úèƒµ¶±n}–‰‹ÖÒï¹LyráÄ»K”Væùƒï,6éÓô—‹A¸5¼ı¹™ãÕüò,OÄ!ÿhá„×¢\(ßÕ´YJæœŠ&>åÇ›^*¤M®rÏv¢Ù«Üœ¯yÇ³tÄ\×¸*ç!?ÖÃ¦¦ÊŠ[’68‚>WâÕò³ÙÁ~¿—·Vëš±øúêäşÍ®ØáêPt{†º~ŞV³¾nÖ(Ê£]GVÒ€oí»T,»ãı¶FËf‰škÃóúİf•P1ë÷ÃjÒ¶Æ:'a@M¨õ²™•öm±ÄaE>51ŸZJ“^TÃ
 ÅÌ…Œ+}€fõÇ¡›EèÀŸ˜›·(Ô	G“†¢É3f3«ûG:›iå4Húô1Ã.C‘š©ßÒ	ÉĞö”®Ï­Ï†JWïĞ0cÏ°m
g«‘IèÓşXÍ3Õ–8Ê5j<võéâ‚ˆŸt¿QJÏj“L½‹TEN9şrÅfg´›®Ú{ˆé$LoÒmh6ó‰›#;GkÌFÜ}ŒÈß‰ah_|ˆY ·xHàEh˜yÇNj)BÂ^$äfA…j0£Ş€Qi"£WÎßÏ½’L×¶VÑâºF8Æê…6)¿€óêãßìUtK©q" ;x²•¡×Â5ÃÉ>ÑŞt»ŠÁTf±*e²HÎ^Óa2—@2·û
àÛ­É»›
™šMt:Ú1vÇ†’şñC…}†» Àº\ö;á'©±+m!_ş;ÛxÀã¹»[Aî‹÷œôîñ¨OÙ˜›a=¬¼1&48%“ú$KM3<=V à*x'¸Y2LwÌÊšEIàC%†`ö¡Áw:İv#J Ã°¯Aê[)!ÙÁ®}L/A ğCÌ»ûµ‹Ì¥øñÏ¤qn3)Ï¥RÔ&‘J"Â!1•ùúšÇ¼)AÑSÁœ#"àÆá‰ÄÕÉ‹yá·ÒÎzëÕ³AgÛŸ”İÙ“€¸d8œÛEé¸8ÿzÆ:A‚™U
écGãNılü½nn.¶<ö˜™"{·ÅP“É“C_»qø²ˆ¶ÓHk[ºDÂş–ğº;¾Ú¨Öîğ‡“²ù¥œùÈV—¨05Ir»´÷>¢F¶	Ö„b9gr¡è 3sF©@³ªx¤t ¼Ù€I<î_Iª¦c±ƒğ­Ô¼£p^BqÜ¨'ÂÓÑÜ×yœæ!œ^6ïNÃG˜L.|‹/luñ&öø¦æÃñ–¾ƒşô„Áª­aØc@˜T½Ó»ÑqÀúp½Äh#…$)< “(ÒâÓÄÛp`	O%=<3ŠÔ¼‰¨
ÑõOÕ$rÇê‘a9Då#C1RU—Ôº©ŞÉ	3¸ßiÕh–½‡ENùG%	ûrÑÆÍDã¶ŸPòáw‡€–ç	aa¾4à³æ Ï¡6uo-écG…áÎmÁÁùEØ¡­Ï±ÛŸ‰…vD8±>š¤U,ì¿²ÀFè18‘«¶Hß@HÏëäfl¿FI8Q—‹çòÍK0e4R›Ù?À°ß•ïšPP“¢¶¢RSÉşm4±é9‘w(»}¤ „*d0ŠÒİ°]w¶†ÛßZ‹²»³s£ä+‹.Ä± ”€ã™ù?V$^÷Hıöf„‘·›™EóWR‹RÎ	}áC,+ÌÃ$˜ ì ñ´°G‡X*A	ÉùH:3ıWulÊÓi¢ºÊ½–á(q¤òœBÒÇ¿v¥GÍegÀÿ1§
}.r˜Hn½¸
P¸~,sFã=×ïm­èqÒÄJŸÉ
Ö„;Y@[ª“ÉïAÛ*ED}±I\l¶ÛÛg0p}oPpÊIGo‚–¾UúVÖI0Šì§HÙZDc…ÉJÄä…\şiódÓ4‹@’æÑR‰Ä»1Ôƒã¨Jõı^çP¡Ê‚_VÕZ8„â¡Ux÷Ú
¡êõøª_ì“éÛ0=¦Ä"øFˆ¶è³o°D.>q«ßºyp2î8Zûµ»)Ú¹İÍŸ|sˆÜİ÷¯cñ­—}Óà_şªo6ÿ‘a\t99†4¼±UÇjBl0P
úî8gµ¢ÀÁ¢HDMs'Ç…wÕ/©;%ïøQ™ ‰¦&àæĞJ	¢¹z­+‹U@.E”8.…p!É(ƒ^I¬mÒé)áòäh¥»“:=ÓÏ¾³Õ9‘­ğË’UHVzNU«8^ıdå)ü—d©âäÕ’$9%Å
æC i'»dHâr{MYBK¼œ³’ä0Pâ@~D$m±ÊU<§îA,:‡i{‹K‰ÿTQ›Aª]¿©ìNg†Å¢«l«/µŠÑ7Õ+¯:P5P!ò*Ô,ĞK™P<&êT³×£(O=XAùµ	’ãÒi›«r€t›É²×®ùÄ®Æï÷¢.TøÜ/W¼³K^öY	Cd ­D/ÚNÀ{9ñI
\ßÅ<«–Ë>·éÚm^îÒE~îätcöWë±(ÏĞİ½H]ª¶'p¤0Œ•¢hºôd6¶7a©/¡­µº¤h8©‘¹Ú„lÏ}Í¶Í]*_í¶MÒr{7|¯Zª+Ğf£1&T¾WÆ#>ÁuÜµ:)ÎCµŒZJ¦á½ætl^º¯¿vÅNáfƒ€÷J. µE]÷qI©3vfa–X«B	CzT¨¸©üˆ:!ƒ¾{MŞç?åËğ¥ÇY¿cj¼#œøf÷j¤ÎP9¥–!‡Œ¡¯±vÃ±„9¶œ}U7¯ÒUN‰øv=f‰CÛı|ñ~ûƒ ¯ Æ­5?k™©Šê…K”ŸøÑôÚ ¿Üí•é`öøN"Şíê.¸·KQP`Òxìÿèª˜J…=M!-Æ‰õx*~ÜøùÑX
”Â¤§~¬Aş€£­U³ìqÈmF‰F:x½^<¹s=w|F Qù?B­çgN'¯w®§’F_*?ÂQÙ ÒT¨ä“dE0A¢¢ƒPƒÙVÒfûI×øƒúïÇsİ3óòL¨€! sd¥C„nbá«îîÜÒ³43“:Ÿ·?È60Ş‘5huâ)†>›ÿ=<·½¾Ñêõ.gíó-#óu&$ŞšÏ¤§Q¤Yi’ïl¬õºmŠ¯l(½l£Â,îšHIòƒ^ÒáŒ
ı_ t”d4g+$O¾iHš4âM¹'J”Ì¥àijì$vA#‰—ÁÄ~%³Ñkób/ÿãXÑ>W!
ŒQ‡V¢´%²I_øø«
mŞ¥X?ïÑ1Í(UO·S\Ë‘3M}›dF×t	?9L}IÃê»xŠgİU—y—ôaêö"÷Éj‚B­¬çƒÕV/ëÂ×İån>€–¥7# ÏdÃÖrŞ»<¡òbCé¤d™Ú:M„9±/£­5ÊÒYWr¾7ì³*¡ıv½@’Â›Ñ0[?ßZÏ.æƒ<;‹VÅõ¾y”£æÈa=A!L¾Ù‡fÿ¥p4¤/Ó‘ÂîKŒ©F?ã”å¨ˆm‚ø'¥nX¢!ø0"Œ°8ù!™®1È¬ğB «xnßÈ44ªG¸,îƒ`ÄÀ‹?ÑıÒ#a›Š0n¥¾™¥±ùn™ÿ»F¸”–%:o
FëŸ1f¥|7áMoB@Qævs‚9ã½Íáçö¿KhÚ¾jş¸MáóÀ ïexòäc­èÛyŠ¤0‹MÎÖOQ¶ø­Ç¨4}Ìù¥IJZNuFˆÑªCÖ¸^Ğ&»Ö„5òã°4ğ‚ è8É=fÄ„ kÑHÌ}‘°ß;¥ÀmP†#ô+Èaş‹E]æ,ç~fúí] Ïc¡yĞã<¾á&¾êŸÅlfa½ôQHî-D“Ñ“!¡XTéÄöà?]•³[A—"OÍDÇ\-acwß°ŸNªzÓJÏz)ëš÷şr£ûëÅ³+]Llí—£¿[¸”Úİa¾›o¡g7Ÿ
°úG6ù;úiòµyŒ¯Í™Y`eNú@ƒÕ?^ÌÏrŞ3ûMà[%ØqTL©³æB×lZºŠ¥	Dçr¢qfñ¸ü3òûK±ÒZ5×i«I…ŒèB÷»İ‡Hæ\¿_¬ûœ|‡ò™İ¢OA'ù‰:AÂÀ§Ô~QR;P eÙ[HÊoäEµ¥>$¾ÃOöX*1Äî8Ñ}hÃˆ2¹ëx9:ìİùw¦şÓô‘c‹K'ß=´tü¤»F—ÍAò×
rîº76á®u§Ó¼—Ä²Èü^áKÈ8*ö€ãÒ-&6¾vË«æ«¹x—íÔ‰;at÷ß:Ç%%rm(9ÖƒËtní×‰ÂìZºe“é9®[Û_–ú·ñŞüRtôcÆ\Êƒˆ²²üN7†kù*ì„¿R•ºK1h13“WÅö#ík*wÙÂÍkÿ<é+ĞŞã4w„¾Ø|ÊÏ@Jw8šö&ü-Æ«ŸãÌâqXÎ¹Ä*Uô9-T¡¹pfîáÂhƒµP-x†„áNôÌw½,e‰¬•2êıXGf
y¬p||<¾LÂ‚M2$¬(ÂË¯(şä?‚š-&‚”TS8C»Hbñ*0›…Zo»FJ;3ìõë4õø;uêIH¿ä	Wó±hI<œv{Dì(ëC‡nØ9İ±Ûº<ùCÿÆ¢sŸY†u¢VÄËŒˆ2$ß­³+kï òéêºiã$¿!~AqI*’§\ÁG“Yv5çc‰î‚N”ô.>Hä£úOóç¦GÎ|"íĞÑ‚Ä† [bš~a{xä÷±,ˆÕ°S0‡;^³©zÕ"7¢1hËœ^b¥­óCáXvÙ7+¹Ø»Å;‰9çP8&˜ÓüB¯g£—†2¬¿–»M	ñsÄBÇ„˜ˆ{²tæ!§ù…Cst9†\<Š¥˜œ.+0¯µ”«¨×¬ÛWú¢¤ÒlÁ¦W7ıA °h×nÍw(Î*Êö~1Ö_'°Ç5æ$‚3ZiyİÓÇfŒMÌcôsO¢ªBü6Éó/hÛ•¶ÊªkšMMïv7æ«ƒ~¯‡ª³"_Ì‚{|˜H3Ø.r¯¾h%vÿ«ãëÈ _12Â4-üßñUä„ÊQâ¤PëÕ‡N?£$L0Åko'tŸW9÷Ä•(ğšòla©	&‘Ò+Œ¼‰nIq-c]d,{ƒ(v
Ñ»Hİ{“ÆğŠ˜ªHØ8*ÛcÙÌÍAt³J
Ñ–íõ1B6bø°»Ahï"@ÙñĞ	øvÊËQåCßsbßÓâ@ ˆ4“š‚"Ú×_ì­=œå%7Äó­¡7øDÁš)[›Ï‡gÓ. İá¢‘ÄİÄM"æMI]@7ÎŠ›¦0ÙOªºRÙ@¬Úãl\uê-Š­DÎ¶oJÂ+KXáÚ˜Jì¥@¿Íù¦>Ü0RruİeµùáÿÊõÆ¼h’†¾ïVè¥¯\6ÒFko¿[—Wº.lN-MÚjÌë³Föj¸º['®$\+[·^/×bÁšÙT¬"É—’â%TÍ¿Ğ2¬IÓ•îä÷¾—‰é¤ HÄ±]¶¾N qYªÄ¹A”’N`úõég¾Ø-=±œ~y²ÓZ*kE¤·ùõåÒ…chg/ªß:éÂø4Wêß¹;ùc|·B·Ñğ³*HÙ—ÚƒY³yeZ5TÕêe1fB³l-ÂÇúÚÒ^6yXì|¨’¨ØüÒÏ®oR°—ÍÕŒÖ@zO°Ù(36Ø¹@Uu‹qßÍŠ=ÁüËŸÌºdÕ¶ñÚşıû§[­ÿù_ÿò§¹C™5X-óÑu‡L¥}…İÚp"ùç èÏÍ^¦{–kå‡¼ó{Ô¡|´CÉ§ãìôìÇ~	
Nó³ŞO¶?ÅÁßAò¼Ñ_>J.ÈWİ,äı¶ãPàûí2^éÿbc«®Æl¬4d9eUIV¬:YÌŠ¿¥.®öx:”Ú´nÊ''Gmjç$a¥´1ØNf^Q—âäE=3ÕE¹4!XIî5ú”åùÌ<b$iWåbÄI]ÃûĞŞÛşøÄ3³	?’9Íê:Wæ°1vrÔ k”Mv2[Oß¹:á|iıuõÃ#÷Öqyp«”GçØOj¥ˆ;q¬ Øiæ¿7µøzà‡Áº`Øñ)`ßNk½Õ&#­PJ'S-OiS;],r¿¥ä‡^«Ä¥;z¤ı|İ®HtŞ±¨%}3ì‘‡‹¯Ô ¼%Ñ¤o‘¯C’nˆÙ‘ÛºåüÒuk,†YÄ2Kk•”ü{Ê­¡5FûPh³tä+ÕJ¼•‘KÊm\Àš«©D€É*ñ-kæ4ÚuGS&Ÿ u$° ÿî°u¶—²æ ,¹ü:g
†_ùAOÖ¥l”3ù Y¦‹ß¡qökfZôÚ$:aÂä‰\B7ÖDØ¹‘¦f…ŸØúŞAJYê[óòûí)qRÄwÂ5è.š­CÈØÃy¾Æ'¸Xç<9ª³S1Ñ6DtbĞ]i.3E´…Cœ+@^J;Àrâ#– åWeˆ€qâD•Ô¨¬—ÂˆÎi@]béq;¦Ùl…¾%ù‚„&¶ÇA²dĞ|+d/é•Eˆû˜¡øÃÀ•³k
İ¥&hBş¡;ìíöºë—/ö3*A"ö8f4?È/ëX[C%6­ä–‹ß)7TÀİPÂú”))í.í!ıLìÚÀ}­6ã®÷ö	L†ÎVdÓÃ59á;ì-©iça­
"–K¦ Rïm?rZ™¶ŠàDmëÜ‚ƒ|)_sá%#İ}+ï[ÀŠ‚¯¢q‰k wï…Ç)A/¶ Â™»Ô[ÏßDöZ×ømvàNğ\[…FVÖ4¹ÀnÛ·À?;A/ÒßÃöióµ+±|H›™ğ}º†¢İŒ§G8áX¾ß*G‘›æ…¹¥n?|h,š€_•¹iøT/³‰[Ï¡6V|"üNW(q ù«ˆ
^Ày%â/döOH›/Ûî/Ğb»¿t¢«b÷$ºzíP¡-íJÍ$hø¢RŞµBy•Ÿ'p‘Û¥ÀÈº"¥@JëVX¿W¾¨PxÃÉ1î‘€P{;CİğÜĞA&ô=òöqJáñD×(_è3ğ”›A0(ñÊú²Eç°økß€ç"iäj˜¿S¨×Jê0ÜøSt†ä\Ê@?Ëİr‘éO1„3Ÿ’°Ãlz¦¤b©¨ÇĞöÏ|! `ĞçÕ‡†¯ôòi’³a¯¿î¡éïíÜâ~ÜÅÃ-İf5ùV;¹sLG†‘PªmôP†'¢ÇJñµ<@±mû)¦•3³8æ!ïÙÌ‰_ÍÏ â*ù
«J$¡1Â^ÑqêÑ¦c¸Áå¢÷N·EŠ£ß]Ì’ƒtM*˜Ò¬óû½So¦»ĞC—¡Åmî	ßºÜÜ^‹S‚!©{•Òõ•r-2‡ğRt	P¦—˜ãbØsY H9ì„²£¸ÕÜF%r‚¨QÄ"ºg^~Yf°Ú2$zwûOÛŸ€QìŞ·&¼-eåô½ Ã_¸
İ#ºƒUäGLm§R¿GîÊN|øÁßƒîÎ5ï-Ü!·}gj3¡í©ùà‘á0ŸCÈ!]ÜÁ#‰mo%Ë"T;·NÀ0t<ÇÉp2’nÔF‰×Ì#Šİ…¤Öl¥ßIø?Î5W¬ŞÛ<MmJãn%Ğx{à‚8vBèç°SÔ4è"Ï÷{›i['unÅvÌ:TW BËï
Âs£Ò¥—~ß^êâ/âIî‹Ğ/$âqNFàF©TDà÷oæ÷à µ:\†Ë€ºùòyšæ¶á|%øš.b³ÑÏŠU1+oî—¹O®—¦pq*,Ï¸4JP¼Jµ°š0ö|Ü9cÖ+Ì»Ÿy˜û¿úéÆì²Ş:ÏvŒİÖù~8£ï}Çûü¸Öt¬ØÁÎBb@2âŠî\‰ú¡N'.=0½øÅ6Îb^aÈ0õÔìEÎ‡ğŠèy:·él*>s0¿½éÓ—pŠ<6ÌB³
¹ÅtYHm#)MQY`¶+Ö»	f=näÕ«Th¥LR£ÅcOŸ1Fp	Ö
G­‰YÂ¹®dàSyµY!Ær£N6Üç.ÔßjàF0xL+Dªº«Û‰[ÁÅxU˜„A`ÕÚ¦ö9ÃCt½°’ˆ3j6Ó]p“ªxLI>Ï	ºÿ©àôÆ¿÷8läó@¸QÍ©ìu*Vn[ºûmÔK†ù¾M£:E"§a”Ñ°$ŸáÈ<†Bõ0U*l–Šq¶Ø©¨<.9U!m}3ÕHŸ*„ôÚ¸¶)é®ïBêÜ“º4ÊÒwïÚ`Êö,3B·oD[èä¸lâæÎ¿¡ãìSogHï4¥!P¿3Ç®•VWÔ®ÓE,§ŠÎÏÓœ+NsûR*¿æ×ı~V¾Ï×SQÙqÄRtíCªÇ İµ­L©ñlv ü—-.Z:rüØbvtşØüÛG-Å¥Ğ .€D€´¾ßÌÓ±ş!(X(¿1Õèì€¹Úî™QÍCŠmœqo6å—›¢„p¥¬íG®U¬m±›<—–B¿:^Şº)ã€¨^¸§*†5á&&uü¹Ô1$Ò(4åÇ2Ò†S¶„=½-ÜZ`Ï%33{ÜHÔEXêßêp_'%uË¤^óÉ¾Bó‰E¥Ú¦DÌ)vÇAUC’ÈĞSÔ%€(4Ø
i9ıÑêñÇèœe#3Úıµ¼³è¥øºn+pš+~ş‹ür°¦±ßœE®%¬[›³ä¶…"º¶cµ°¦ín†ÂÍ£Hnuë	§O4qpÚ>&Ø›ëìÉšJR§aNœâKêÎë¨ãÅ¾€:>#´¤[„‚ë<,Ü¼jÑZ$0aÂº7êßßö7[ L:İ²›áüRw¸ÎN9¼\À":Ş•Ôñ&·¼Sb]2Õç0Ò”¥Ç9SpÉIöÓâ&óæ|«Ó¿ÈgõáT–nÑn°«¨ÿeq<?nhğJŸ}-ZÜB€ıˆXH:I¤/M@`Ùüˆöç5˜ÿlûS2BÙ€Ó0èT`]VëFÊfônrÖØ·e?Yü0ÈàçR-Ú¿pUxˆÏ¼‹×'ãËµPÁÌñ´;KöŒš‘hø±”'dfÀğd	õ­åuâX'Opğl;3³0O{‡a‘:ù	pHæg‘ŒÒ°¬w×Ö$ËRËš™*Ó•0Â÷@x&ğ4á™P¢ Qï©ê¦_à¹ u+ôĞ¯_=
ÛDàK~HYCìxb6%-†¸òyG…){Š­#…àäÛF¯2ù;jo5¿´^éMu,:L™&l¥c§}©"d¤¦›‰óåŞÎÍe~%äÓ,‡®xÆS*íF‰SĞŒ>]íúT9\'…FTX³AX—:,£Œ5¯ú¼üóèdú€ŒRÁ‡ô±èæYP¯›Í¦%3{R2ãà„œˆµâS*>ùX¸±ÚÉÍÚå†s½ç·şòÒ¬t‡§¬Õ×&/üšÓè¯tÏL1%^QÌÊrnhÃ£’%M¹™Á×ûíóöêoC48ŠA,Ô@‡¹Rºvm;‚¶)Ü"¤${¡µ¼l¡œQøR:"E¥RF‰8§@	¯éY6À¥C¶Tj¡ôÄÓ"Aâ‡è-:´„]MèSBPã&¹¥ª\W&|ŒÑHizİ ÜváµµêQVJá $½ƒ†Ãk)ç¨R¡=#+<™U*t7ñ›…áCmûS½Î;Ğåv	qØ"±ìBXC&LĞ™˜aÆ‰4ÇªFl÷úC©s­kş
ÿ"8ÈMAY›cHù³!'QR?İ&w+ø–á‹$Ã]]¼À?Z*p]Äº÷özÒ~ $te/æj¢;!ï·ö^„²^}èªua+ôµ™S³z
àpÛÃÔ0x'8·Û$Û1ºérñ¢“æÇoU,œDOøÉâÈ(Nn·§²Äp¥‚¹ğâOCoàcõÑIî¾S‡(µ,w r=5œ9ğ¤Ö"@îËäSÛ¦œ`8âz‡¡
ª‰aÉ‘HÌ )<ÁíÓ”C¸^lô»ÖçèÈ)ãÈ5Nƒ«|ì jšÚC î™q ¿5Ú!”ÄOh`Wè I` /´„Ğ†s1LDÜÂìƒàu;Áh¼È©¦ã˜Ä%¦˜J8“ö}„\y€æÃ?(Sæ4ÍsKÜ] ò……3ÿ&aÏüÙ¡B<FÍnĞ*a>½Cî·^íL¾*Ï÷¸<¡-ëƒ)T‚­£h¥ gu±¿ğÂåÒ©Û¹1ıÿGÇ~©|Eƒ›>ù’£)ú·üíéOÚ¦ü,ÈÑ•†Î²©¤¡ÏrĞî-zLÛ­_t-é›ß¦Œ‚À;L„OğB$ù©eŸä€A±Dß ?]¬ÄÄå[=[Æ’)ÖÌ÷CSö{ß™€yjN<ÙGĞ‚âcÆ`°$®zVWû¥‘.c².
­*õJ»é›"äKäOTÏıb€BØNLØx¾fÀ€'Á&ÇGºknÎ¼îÙƒê€2Š%;rİvÄRr¡;6F“«~ÙHdºè‹7Hw—ÖyE'ß¡4Hğ¹
©n9‚(šÈtÌªÛÅóØnŒ˜‰dÅzJRE*ÎC¯_HRh0ÈTé=&›ª’ìŠ–T‘‚i	z©Ù@#‰î`OÉÄçÅ¢Q„Ç k†x	†¿%d(B_D”ğÛ†o
dÃŠ_»¿ÎCB@c aÊ ³‚©l·Vû«İv«ÇgÊIÛKX`,T6R²>¸\F#æuL&ø0b0ôtQrèLùÅJkğA>ğqWËæÎ©f‰ï#mD3ƒ9ü„KQ*°Ïæ	€¿=SZ@ûw‰õ©°‹ö¾RàŸ›(ÿˆ¯:óè½¥›ä,¸dá»š¬‹½ÜY¿Á‰Ü‚nÎ‰BŠ\³ÙTÄ7*h^SÉ
ô¦/ª[ê.t²íòO=)F)qOa‡H™Ú].|rê²ÛÄû{Vp€ÈÆ½K•Ş¨V9>uvâ™´]Ig•óm§«®4TÉ>¸_n¿D&ğ¤ãİÒÂü¡Ÿ-œÌÏ/şìàñù“‡³ƒó‡~±pìp¶xbáĞ‘ùw³ú±…_e'¿•<~üÙâ?-.-m$¼ó ÅÖ…Üz¨gıe@k]G­.V°±ÖëRkvörÖ5ƒl€ÃÖ_í]nÂ×K§|Ğ=Ş
$tÇL,İ!Œ­k¸Œ¡¾ŞeP9n¾ºF›ÜÜÆŠ¾{¤Yäb¶nÎ³ış3Ô‰RO3hš=Ìß›Âß†ã¶
üËì°î,´z­åîÎ,<4ıÚÿ÷[½Ş?å­A½±iŞµ—×ÖûÍAkµÓ_9xyİPıÀè™Ë×Îç—j¿Àæß”›ğÃİ1€ó¸³ Yh§Ù¾Ø©7¦²ì93	5÷Áé¡Ù¦ù-›+tºÀ"ªËJ§Ìüò¶ÙGİ¹È8A¨AÃó­üğGp8¯*€F¦ayq{á{ôk=aº•.#,7nÖÙd ãG7JûÂ:[ëµ³f"~ôÆT­¡:ôøDë2Ì·iĞ}9\ëu×Ågïí?%o}g7–—Ñwÿ ÃSUff~[Øe7p^À¶9=ÖsÃ¬×èY6â uªŞğ½î9PÓšr5r~Ôê‰8óÚ"©ÍæZgùj–ìâ »¿e‰Ëæëšâyõ¦à:Ã|ı ÙGy-X
°{`6;c.ú ‹&İ‡àK–¹öÏX˜ ûY±P‹k$¬ÜÒn¾:ıöÁšJ^ï®äÿÜ_5Õæ‡İÖÌ/6.¶ºŞ¯ù¼!Èı?P±h›6‹“Ù—³ø¿d uÉÖš>¶)À Ñ-{;%ŠşvÓ
“4+&Ÿ­¼Ì‹`~Öítàv`ç%›#Ú—c¥rõĞ;6ö<s³œÒÎtêNğ…´¹ÓAšĞën©M«S‚è91ˆÇ#ÔÑ>ˆƒĞH…ñíõÖ‰ı'o`¬ÈŸïõ*0P´óJ Ë~“¨AúŠãáØ‘òO.@N›¨^E¸N‚×èéğÓ] OõÙU‹“±6K±w9X§2ËCo{µCêP'!%ƒÃmäáGBBòğ+áŞc½i¯Á(Í!Yû|kÍHeÃÑTŸ75\6;Ø‰ZZèï0ç½9	É×É¶cî6kÙÅîºá ç3w‘ù
ç~‹Z3cowLÌ œO»tôzë0õ+ÅhÉ³(%lœù5rF‡P¨±™—İ™.u3UuAeµ–¹{÷–ÍÖ­‹İÿ¹ÖjåëÍ¼³ÑüàbíM ‡·Ì:mµ? q ø²œ!€ ™’½£ˆ¸ŞŞh:Yë\«‹²ˆÄ2p‘ÀSÎ”@{ÃğìG€Y«gİÎeºígF.7â¡‘¹Ñ)j »²’wº$LZ$àóùJ¶±Ú3„
CàÕ]7EL-mC’-Sv‰ÈÈèYİìÊ&m›‚€µÇfhu}½¿êmHöòwÈv2‰:eß„y$‚<ÚÍˆ.šÅ³[ÈaÑÅxĞKæÜ;ò#b VLĞàüpV¨ÒÁ†"ê¦="µ#¶˜«ûi¶¾£–_åw–ˆRÊÌF3nKTc®®dğ±µ'”òf3do$rê ¦zè„gÃª-í¿ìËÇÙ›oÏ÷<S[5R?»hÏšuL(‘<ñƒ[[tÜ¹E®sVtq,G÷šònÈaˆ¤w-y3¥Ó|’ê#ºOSşÑ¾Ó²í’Ì‚1î†ÊÆ^>ˆ¹±ıg—ÖeYöF:02fNã(IğúD4â©íh‚¬Üû¼cÃİ†8h9Mìc NÆcš{Ejè»&|&s0«ÍÁ?Nt–—ÌŸxË¾v¯YÛŞºõšÆìºÁ¹µÔ}MØvöÚ:Óñ©‰ô¤‰¯h{úgF§…–›mÍûX¨é{XĞ~¼,\¿~\¼ÆÉîê¢VzuûM|Ãä*;¸‰7µ
õ7….òÉ_fØÈı/w1Eİ; -ËU køfk¸Î‚$¡›hÇ# ¤ï˜Õî™U9eÄ1šÆaS£H¸ÊÖˆ#@xb~eîVV·.L¼â¹îD;i²Ù‹ıõR"{%R`èiI+ùàÎ”í%Ø/TÏÑ~M×©@—=ƒÑuFê‘4ãK±İ*+[™^b†Wœ™:Ça>»Õy%K¬!ºkˆâ!0©ˆâJk£”{ğü·Ào8 Mà¿6nñ>¢I ®ÈFbÒ{Ö¼¡“höÚ•¸›A²ğ,øşµ+Éİ´y¹~ë<öT—ï 
=Py„*&wºğˆà÷ş¼š+”}%Ê&ìÆµlğÇgf0·Ü
î^É49Ox™Îi¢à¸ğ‡E´»İõ£òaqq·{jÜı;š'HÓ»¨Ï–X+ä5+­ÕT7Õ|÷p£‚	**Ñ&µ@—-'ª»Ú]ï¶z å0"gw(…¯ø„6&"µï‹-[êÈ:½…à”wmàƒ;{YüŒ¼•ô.tb…z¥] (`‚>B,OÅT|ŞwĞW;èÇ8é™ê´òÕáÆ ?¼1€\Ixİƒã²½™âV¡†¼„Kiíò‘ìí|ÆÙ/@‰T‚­l­5Xï¶7z­AÆ}¹ßÏq]ÓÚºJö~°©!Sà‡­ÕusÄØ­~3Ô-y:á`¸6¹w[”×‚À¡GÅ¨%q"Àğ1Á)!)FÏœa97‰›ŞY7ÓïŠ:å¢EĞDÛêÚá9uóàrà«enò+kpY?ƒ–£-«aúpÓZ¢Ë3ôğ l8ïfHçyûàŞÈ„xÀw	t€Õ˜«Ğ¯£¥áœÆXpj¶¸Øè¦ùF›—ú@¸^»â–Öœb¯oB»OIXuQ’#ì‡is_W1è´r[hzF‚Ş”§ ßXo±D„ìu‚ZÊ4;àrØÔ-Q…Yò×®04M×{ùfmÂÌëmtÊ¾
™dïà’ÓmìùÎíY3ÎŸ/?Ö$;|wÙB†ï¬uÛÃ†9.LË°6úZŸ{#/B¢Ìf¯†Æ®öˆ£şl¸Y}Åœæİµ^>İ>ßïr!Îg×‡nêÌ0ïeuà
ÓH^šÙ'Xå,€CØÊêı‘×À)‡Š8Ø‚•*"¨ÛùjkĞí;u£9š-Bà½:E9ß òƒ)ìØL´0ù¦íßX+£ co}DóAÆÉ?›šéRÛSx¶EKÔˆ¤öÔê‚°ö§<,èO¾Æàœ<<=-™?C÷«$Ë´¸ä³O6PEˆ„æ_˜ÇÇ8hKˆHî°…®S`Î3’ÏŒ@€%3’ìöÃÙ‰÷&l a|=j†ƒÅfY°f™-ÈkPÌ]FÌTü'GècüÀ5'Ö °aøÀg,ñÀ2%çÜü¸
vpûØ¶Ş_#F?›½W“kcër@°ªw!EK–(÷)‰ù^šßr+[üÁ‹
Xåƒ'İ–ú€±ƒkíş`·Ímuhd„ÚlªšÔ€èãNwyÎËõËğewÕl{6¡Ùk}À¤5o8ÁœÁûmZ¸¶·á.—¥—;ßeGôw o[DwÖÁÚ µÂÁ?+ÜÙü\wÕõÑÀ^/˜e-EÃ¢À3É(dˆu`Úá<Ö_Á>¡İ‡¼ÏÀÒ#Öù‰X>ŒÂıÊlĞSŒ,Ë4é¯Ã#KÃÿV+ÍÔ—>•œğVçH4%Mœ:ÃªZ¡É_3€©„J+™1Ò Hƒ's#Twf ^ì™¶Îå+æ6ızó‡ÓË½Öğ¼ŠUÆ¯CÒ‡z³Ü=§Ñ¹m'vWò%”®4ÌÒÏ€x¥ ±×ó•5è¤‘~g³}Íÿáßmzoâ` FHbÄ»ø«nÛEÅœÍ‚Ûó{§¬Y*Z‚êÑY$»¡¿”¢ÛO×ty*ëv.…®á¦zs'?óá´™÷i'Eé€ó"è¾š«ı‹äÊh>Ş<#gÁ‹Ãrjpú ¹&ü)_É­ÄEä#Y”Y5—â_ªm¹ƒ¸˜z&r)ú“üCYÆS1—ópA\’§o8¿fhì‚‡Y§„£àw˜g-~>²|	É–»ƒáú¤ªÂ^m",{á”Nşİ›Y}´ëAHD¿—7{ısŞxQ{Ë\¡È§Ön)·ÃìB·eîS°}ÌÍêÍlµ}'¯_èb·×ƒAócÇ+ñmèšU+à•  @ë ×š}#Ñ%r¡[˜®ZäæEQç9¸…Ó[ãGrWÚÈê«L,ë@vøhs†Ğ­˜U?Ö—É_åY§¿ú£ğ…æßÎèÁÖêYkc½¿bø
zCMes©”13s¡›_$AW)& &5`ª–..¦îårº¨£k«ŞìšwüzÖğºL-4«ÜÍ?ôÁˆ½¨»ùÚšis†÷Á4à”&šÇá@ètû—bJŠ.ëöËé³¦Ğl¯TtA-XŒ#êõ`)Ô‚+b•º(ğÍwK“V2º*^LË¨7
If°YúÍ—T<ºæ}tÅ‡^½ â>`HŒ ”ØpŠ5NÕñÌ(«;EzŞ™°qİ…Ùvd X÷×¹}ÌNàw·–
JÖ?t6Ôb«è`cÚÏÙ)=ìVÓŸ!Ù‘Æ>.8†jÔOƒşLšÁåN”¦pĞNÁAˆkƒ'¢ÕQÅİ·±¨Hw§3´ÙêQ5öP¡Ü¸‰¯IG_\J4Kêİ°ˆ?Xå±­\9©³#××|z@•1”¤¥àZ£5¨ı0d}¼C/o¬’£MDÎ ëşDµË(xñ$ñ2ÓAğ¤ë&©•ÿ–DùZ¯ÕÎë3ïş_ÃSßŸ9gnÓ5ÇT±Ğ{<•¤7P:ƒÌ+ŠO‡/ÂßR15íuRé¡æŠKòá)ëèÇ$yhÔ•ôè`½ä9KÜ£ùÙLğn¸Ó¤#ÓgRA"—w^ôA÷»6<ß˜½‡·T³løsÚÿ6DØºì^Àt•'C¶ùuõ·Oj¢}Ë6™;FQmú_GšŞn¦ˆ{Éç-]Fö…]‘¶§÷pò`¬ûñöüŒµFVá"~Ámy.çëàµÎjûğc^9şë>şåÖòzéS1meĞÉÙ‹NºÃ-v”m»¬à
†{dÊ¸
~<‡Aaªâë\”C’Kók›9ŸÚ‡t™½Ú]Ò ¢Òä<5Îˆ-°!Ğ]YíÔÒ+½ƒ­îÎ9û{2+>›L\eæ@õc‰†ï”x=›é9aÃ¾ºûFLµ4W¼=¸UiCg8ULO:N‘ªàşÛZmó–º¯>`Š7m¨ wy¢ ÿƒ’ú_\ÚIïÑ¾zâòä3¾øh‡ÙÑy:äîÆNt¯õ@„Ã©å<yıa:ğñß‚ğ3&-€?)‹&aŸ’Ly*¹™À¸-³+{»È»j8S•æ~TZ‹=¦Ì¿º{(»»L0ö6Ûˆ]1by;ºMÑé 7ÿ'å‡Ó+­ÕéZö}Ã‰ÖÏsüu]D^¿ş£Fs¸q–äú¦²7D}©û˜}åtu¾MñÌ4¼×1Ş6.¸-aU»qÀ°Zv"sô˜‘Ë†İ|2MùšG`ókeÎl·ów¸l SÚ‡(qçkø‡‘¼ó!Ü¹e†4b
 ¾a¨V£s·e÷ŒÇC¨©r@P+J¦ä5	ÕC½ø(¦ĞùéÖITú`X«¤[.¡Õ¶v7°ÜîŠ,GÛ‹Z:?‚BW¹g!ƒ±ë8-duÖ¨ZT§lÃ»gGğûò÷FïY9Ÿ»Í·áÌ³øú9&ºˆg&‘¿c›ß±Í¿,ÛäVÕXf”f!ßA&Şƒ“i~)´Í–1;g/S ÓÉÌWÖÁ“¼åª»›ÚZÇr7ı+v2—ô«ÊÉÔÍ Józ—øÁKó1õ.Ÿ2·Øg”üöÀÅôj„·D“"¯QL>ú„2ÃAÃ ¸—™dÍ¦F÷…]ö…ùy-0-ÒÓ)³‘0-~@7)C eˆ¼HùkHuü:ŠŠT7ã9‰~‰É÷!m«g×¸²û}|¿QáÂëg	üHm²v_­Œ·6-î¦S×ÍŸ×iI®‘îCvs(J¼ÅYİoZ_¬èÅø'ün,ø5åf˜˜šİšîa¸“[lW#úxf™(ë(ûU‚×ä¿¿¦sÒdoRˆz½INÁ‹ÆS¬8p¶Ä…¸Ã%ú½d¤}-ak6å.Ÿ]/$ÀÙL¸{’»µR0îMjRí’s»İYï-ëg]hWn7ç÷bl7iÑŸÖÕ/\aöoÄQè ¯0bêÈşkQ§¡Rv÷¼íWàª÷³z¹J^H@ÕÊTlˆÚÄßŠCÚ_ÌéÌñò´·Ùj'/ò7Ë/Up8ƒï«¸œÁF°>gğ7ˆ	f#Øî#³!Ÿig>í±Fv&MïôÏ½ôFÊØ­Ì½Ô™2blÛ˜ŸFlT¦€á	„šåÒ¿Øğ€;èyı”>÷£?9òÎÔQ%Ü’à_g#'7Æê§7û~öß³ÿ–ıàó??Úgÿgÿ>Ÿƒ–şé¸WıŠA÷–j¢D{Ä0Ò JAÚ×=ôhc‡5'™ñÎ)nİ´#›§Î±ÙÜgÚƒ-&ì,ìÿe.gÂØ­›ªdl¶	ô¼9É¶VáVæ]ÆÈÍ¡6W²ı
îb [Åúæ0œeÁÌ
ƒÙeVÍ¥£è®Úl¨EÒ¶kmÆÂ—Â‚:2Š|ª ×AØ\‘>"êr"n¸Šr€ö„óy¡‚éÌ<	¯ª¸¢·„Äá¹ÕUùÆENx>‹<®š|ËğS3è](¼µ¾YKän+TD»ó3*Vûm#óÏ›I[ÏŞéŸfßƒUÜ@|Gfï—eiœ¶ğN®¢½/Móëi8ãïšÓ¯A²Œ§†·^¡ (?ÍvîíüÇÎpiÚk1>2Kbt†ñé÷3H/Ò‹¨Í–ÕS¢ê:qÿÇÛ`£SfdÆàóåSvØnØSõ1ˆ”jñG”ï®ŠÒõá*›=u“ó‘œx¢v>Úş“Í-‚rÏÇ×ˆ?ÑtªÍhz@j§6(2iËÅ0Œ¹!˜’SšĞó›4Jš‘’Xø)~¾E)D8·_PAÀLPÊ y5˜ÿ€Ø„VV«Füˆ,rD0•[ïˆ¢5?½Q¾9ìÖë‚›×É;b*;›‹Éüé{ÖÈZ]HÙZATÃ •ydÎãéô7­’oü‘*ÒşŒ˜×÷Me¯Û£|æ*­ÁÁ+d¼×ZÃáÅş 3ØÓœ‡ö/·1‹R°ÚQ¶Ÿt€<Á#<	d½g(ˆ{©¥ÇÔn­Î#LµÀ2²¢K'•Ø¶A˜^Û8kÖ4U…·TĞvñìŒ²q,7hgàÑjÔ6)­¤-›cVRqSGäìfâ¡Õ^(ÉUµ¢êê+ºMzfüîØÀŸ’ä½€Ö<óŸ›,Šµr‰ty¤T@DÜë {¡„N(~ŒÈ¿ÈS…6ç"& á,š­S_Zëšè÷ş+ÁØ¾Ş/ä–5ã^‚L g[¥ÿ FJ÷_Èİe¾3TëJëƒÜ¥!=Å;ó­Ê‚ÿk“½Y§LÃßrÀ–ó‘®
å‚*Ÿ¨Ã$­©Ïå•7È«"+'A	S#x|}M{Ó__Ó	Ûç"ÿ\y+qî<—àÎ¼)oË–Pò|OĞ$Â°x€'íÇ¨˜ÎÄGdŒ:dN—8ÄHÍ:ÙïÄo¨–~†“ï1¤hÌŠ¿SàunÍú?‹q¦Yº_ÈAĞLËCLˆù1@•Èƒß»ßSò5!ÈË>‡¶‡¸úÕÇ‰å<#¦“qéW	®[€Š.î¶ş[Í­YîÍd$üMjù)Ê¦Ÿ43‘Ìœxè°y¬rI»ü“*([iAv‹ò"*M“òò‘©$Ğ”·D€TÁ,‚<O‰Iıú²÷UA§3N“ísJ%mÓËX­b‚¶2›ÈyïJw!TŞ-¸ %«—à[Âß!Ç€4ì»GÑ¿¦eG	%Ešqÿ'„2©œ…^Er…µ„5+Ffp£“ŒDä’«¬Ç•™§ÏfÅÂyt`ş°ì‹ÜEb©Î<¬.ØXÖ´-‚£e¼r)¯¢,ıb’”õ¸Î—'ñíRæÛ[©ïUÉ}>ÁŞEÛA"›ğíåkŠ&ğCî•·>8œ/·6zêâ‹ÄÄÅÕ+ËüÃp)NdP.<%×hÛßÊ~¨Véæìoì%B,fÆ&%* |ŸËTû0rB†N(÷””ÎO+MÜ%§°¨}Îl—Í5È§<‚HÎ!½W)}]qº1ú/…ìe–ó@~YSığ¼¥TæŠŠ$ôf²r©È9í[GãóÔØÑ±?~akIAJ‰Rb”ú%	Röõª¢4Rè7pÖsJÒ=Ğ;jĞîïüÖuŞQˆuE#³à,øç×ôôAªz½¥qˆvJĞàT¸!­¶ªVQ«$…r˜åH)ŒíZ«$íR$!”ùxTÀX
ºP›¬N“bj^’Äë$°¤¼9›Y®:sØezÆšg"AŒd–ÓNk›m{vqÁş+Ñª¥¸Aû.µfm6&}§7û[Ö›íê*8‚ÜTzŒDM…Æ%4üéş.F²“ñŒEr±a)¿dêzqoö
FiÓÎ,Aòi¸ ÏdŞµB‚=é£Õ™·V„§ì^ÑGÕPlÎû1ño‘ğ«4ª¸ ĞxÎÉßB·Êgâ²Ã
ÕÖÅ¥ñ©~2ø¬¸£{ÜœAb[áÌ'$¹ºŸÚİïlêày‹6	"óßÓ 8ĞWfHIuÏú5:ùÀê»{&÷`ã!Ğ×ñôz“œ¯ïÍŒv&qœûlÂÑ½Çšcİ:TH§U¥°İıšõD»múï§BŒ•ûFŞ·\Ô!8šşÌè¾fèVTvÛ[î˜<âÚh³ì^!¼‡ äÄ|‡Î-+­K$Äî§.÷úıAò—×aÓ8p9ú]÷‡¶lLUƒ£İÕ2ŒjƒEQÙ 2·ƒu²×»Êææ2,àrcË·Ø£×9S²c.z¬ßï¥g 1Kcö÷Ã°ìVa½Q?Í‘ğüf1ÏõİnÿĞêu;-Ö¾z:â¯­ãÅ¨rhB"ª)G{ğÌ×gşåœíåÕƒã±J;UG)øq 4ÜØ÷b>¸à½>ô×Lß2ç{<„Ù‘“·™º‡ë@q4zº0Ëâ!s´.µsDà\	FIO†uwüIjñ+†qg™©Ÿ±‚	kÚ²b6T'¼!cß³|Ö3›—ı&!mIÉ(7cwsH­{Ó_=[¶
^Ú†}øp£;P¸ê…Û+
~ë®š¤!ò“äƒy Øìš$)Äêg¥xáìœ–IÇØ¡!°áø[»aóè-‚¦ä!ôŒØj€Ápˆ ©
GéØ÷z7ı
XÊY˜#>5[À#İ¬v6fô<ß"¿è{3<ß¿øö …f<µ M÷Æ%Ë´íƒ§Ã“fKCXô¡~}=àpë¾ô¯TŸÙ™™ìÇfâÜo˜8³zlP¤ S¼LÒ³MÉ»Cóò`¾Üäékœ–˜éñ°¿’×µ”Òeúmœz_©nÊÃ| [ ¢/?:ĞãÔÙÁëHOPµó%”ÁXx0–šÑÙ²šÚ›Ñ—A¾?À†l¸XöÂ¡W™`fö—ñ7ÏXİÔJî¾9
=v8pJ¼àKKNbútÍ©ù€nN;¾æ­üß	‹2®ÓÊ¨Ûäla'$æŠ3%Ñá©âsÎ]éçHùî¹@}9¤Ÿ>iú=AbÍŸËJ‰sEÏĞ£ãg­!M*Õ5¡1ÖLúcõdÁÌ~ft3ui&Y26LCo¹7Q¾ˆ^©ÙĞğ¸2İ_˜+2%XY‰)D~ãu»²R)¼Q¿].P(á³’Ğo[$ÎN…È7†˜ÛOy–´°Á'ÌÁËI®4GÑ„ÏöZ7óF7SQ¯å\Ü·(4’"ı„’K¬KSf—òîÂàrµ˜Ÿ519Ió^:ÎÎ5óUØÀ(Eoè¾õ×r„3D5xÁ—wûKĞ¤¶[æ cÇÇ|uúíƒ5‰l
’Í?÷WÏÌ»­™_lÀ1)˜Ìy³Âû ¬B°3ù^TCğ"ÓçD›ÌSVQrU·Íqw•ƒ¼½%ï‡Óö p¶1}CftV8˜Óï9îºY»/0@4ˆy&/şcäæM†l}ƒZ•OM­ÇáX
sĞ27¬}aÕœ½°­›Í¦£ÀµfPz»ÅjaÛ}kˆºŠ·ºøíŒØÓ;×0¿Êï¸à/ ­*óàP0ç¿şåÿ/Ğ¨Àtƒöù9ö“Ãâíê‰0„ŠŸ§¬d¹BA"²ÀÁİdù«ĞÁ”Ó|å c#…Œ¡ıl* åè˜Dú‡èş6k)öÙkÃó‡äCÛöM‰b­6Vya èn7»Ã-ººø'6¢L=öakĞi·Oæ˜‡[‡\úçLÿfÃ˜É<Î(Ç¸£İP`Ç†í\÷W«@l§¨ä<‚g|ƒŒ:úPîöçª?‹;
$ùĞ9x@è<ÆPógğûæü9$À/Ö÷¤ø¬Hï«Nì¨)jU+q¨Iœ,ÏÜ4›æ˜=Ôsg3tˆväº¸p°–yõÜ~-IÆ>«â]ÒRÉ%.eŒƒ@hKŠ]ë
•åÒ'©+};BnÛåÙÿæD[pFdŸM›‰ÕŠ|qSß½v%96‚-+nlfˆÌğóbÓ'Í„nìs;Âİvœy~%N¸p>^·úûo\}$£‚n5pÉŸ_[cí	?ò{~Ñ5Ó¤Ó	eó ÿ _ È? Áƒ>‘mFŠğV-VÉ´W×şÆĞ)RaFèÇb¾^Cœ$XÂEêTWÂ\Èë
ıÅ9TJ_o©ÍÛ©sm«%”jËHÑ4!­5gWºÃ!oÈE_® ¥­©)V2›˜íK:è/(`œĞ`Ş¶øp:¢71+¡CiEnŞYô2/É¾{BŒ=R"ä9R×ÊnĞ£¹9ìñ°ÚOşšs©{ÛP.Îçœâ×<ÚÇâ%ôéÌ#f)MCöt—íÍRW½¯(¹­GÎàB¾¸–;s¾:¾ŠŸ1•áÀèï	Ì#Ä§BV\øÇù£§ß>9xáğéÅ¥ù¥w•©ÈÍ«”C5t	Éy'DdÅz×„šp~±Ö:€öZi]r‚´³bÂæÅ	JæÅk·æ~iv',ûŞTu7–—»—0vğ’™+#¢bç6In~íŠy¼y&ãu±Ÿ&ãL’—‹—ëjRÌokçº2Ór,I¡ÈL=—è8^šuò,vû´]…#¼$GtœäGÚ´ÕEà,FÀ2µjùE„ã„x,àj…$ß°ò²ÏÒ2"ëÊ‹¦¹¦“!é£÷	'o‘MÃìF	›ôös²ÜwÂÛ«Ş
•)¯^ŠÛ­caŒ
Z$¬Eî…R¸IyBŠ¸“fW ôY$¼ÕÔ™¥$ÜBE[TÏ/7º¿Ö_38f¢eğ†ú´Œ„Õu‘÷ĞäÒÅ…ƒ™EìûoÂÈÊ¿
]4%> ı*Î–)ô;xò˜¼Ë˜Ë!¨!ÑAëÆÎG ÛôZ¾ _ÀUœ1s-¬¡/?;¿iHAÕçA×BÈÑn¦v!é3Jv¢7›qp	RT­İëÃYB‚Zˆ1ëÏ ¬èeCëìÌm	> )Â;oO¦‰ôP :òUlzÖîz'5$C=yÁDÒecò£‘iY} ¥Še§sPªX¯sÒ›ñ¿nRüEŠø"P”2Àb›êÉ'À#œÛ¾ß¹±XJPá–ê'ÛTÀŠÔ/Fd(‰ÿ"lµœç†õøëLE=›ü‘@-~õËÏo.(=·KçX@ú»G{ävŒÈ†óó¼Øéø/~*Ç„5ò<®H/CŸ‚ ¨×ÜorŠ¯´«³ÈùS|çvB‘RÕ#·º·çôfL‡!;­îZúÅj•ömúë3ğ³ŠO›ı,vkó÷p*Á§!tãõ‡çİYäÁ—V´aÄ÷ÀÔká®t%p •Tóí*ÒEğª|K¬ÿ-¹Xñ
–zYq™ï­váhU<¿ßyMº[œúÜ‘*ÁzÌ`+İà½PcïÑ=›nŒš‚ï$=ì¥|7’@Ñ-İñuyÜ|£¯õ<‡É›ı(6/íÁZ4)¼KÙ°Mo_»b¿·Gå v§G\½•"Ò—Ò+’ùx‰dJ±D§Ã0u|Ä™#¾<š+—òäÁ¿¢é³ü<àæá?=™1'/¢ƒˆKûÙ}ù÷wÒ,Y +3— @º	y(fÉ!‘éÆo¦uHâ¦ÕºT4èÌ·0G¼Ë¯¯¡W0h¿nÜfq<HídÄ[Úóé=°¿’ƒ½UÅ–‡çr ä;¿G7¤İù>¹Anu¨8{Fq“æ/6übû“	lèğ‹¡]@,ŞVéB|ğ!TQC(äØ_)›Î ^Ñú.>´Eş¸s«fzXìtÀ|ñ%yD}~yHNşsßÄx¤;ì Bè¢HV<¨Äˆ`@Íı±,2‹ÖNğÈĞNÿ„Iÿdğ†­õ™À³#½aÙ"4}îf8ü¬N}ÎåÍƒÒ|‹{ÌgÌñZ}¯áÑš|ÑÃıÆfÇëûNy‰ôe:ò)ıùÒÒdiîÖê!M!M¾umyŒÿ‹y`~ËóØL+e¶!Sd÷·ÿ`ÈÅváı'A&Æ‘6ÏëH>Ÿb@3ê~bqãƒ:ÂµÜ8·ŸT6A^ùoÙ=¢;üë†MÊ€îfèxÇ?„I>7,¶¶…êV´¡Çëšl²ÿïÿÍlİ&OÉ L{ç?l'üàŸQü6ÓÅÃãD.¿•øvè#èâ~a?<2cıw7?¡ˆkXÂ½…X-WÍ›°èy+	èàå#Öm­ı„ å§@^ü©Ï‡8ê§s/I¾gÍşhóÏòSuQ®	TãÎ–ÚÆí©İaĞ®®'°€¾³ÄÕ 0—ÙéA½­0°úÜ[ÎX¼´‰sÛÚÈ<ö“€ì(Ê\ko³£Særìè1–øïpùb”4±|á$DXgşkÔ¬Ğ&i§m¯˜4[Ç:‡2?”r&6+¦ªĞ¦¿ÁJ¤¶c5ªB/öÂBQ@¡Ô¹d€¶ il$lû›Qe®ïam¢$ùÖ¸’T-<2,_?Ü'­åíÂ¼¨!üTw"¤Dk[ñ}NøÔ87šZM4Vî6ã+\ï¯·zìÎq@tUø{È"Q8Æš{şƒ}úOØÄ¯óAŸIºãâ¹"Šğ{³)ºÃó©Ô›Ò:ºCŒm5²já’;å€u+fÎĞWçĞÏæ—{ûôüÒÒÂÑKìµWé©:ƒÖÅÕã¨:ïT¨|á,->}pá­ã'N/¾{ğèÛ€Nf”şüWG–~vøäü¯%¿©ONŠ	¦œ•‰9HÌÔs6Ö´± Kz*ÑÄMBXy~iïmÁVoÑ²dµ¢Ù¹ÒgÓ³vå|kÈ¼¹_0cîÂvUE)}ƒ¢K,upY1>çôæ%¼İ,GDco-ìíğ| ¶×Zİêâ¤;rÔêĞÌ·Œë[Îõ‘c§Oœ<şöÉ…ÅÅ$-†Õ´V‡ó'íÂÁS†Ÿ|¨y¯º†(TáéÜñ·(£0·5åşÔ¶G’ÎÕBšÉ-"’ \ù4ÁŠ~Ø«ôN_:rtÁp‹GN:¿Áñ»PTSphLJRó§FÌ“[=Ç/à†ª÷ÕB>õı¼'ƒ*ûÿŒ]Û=|³ıEVGŠ TãÛ.ÏcVğÍ±WI
­xDÖ˜“¢áFâ\¢ííÉ&ûd6ÛgıÅ‘¸yFñTëÃ¸ásTF÷İJø²0äİ±CÉ;f[ M‡ºéº#°—dJ­úÌ)
À‰Ñ¯Şæ¨Á˜*¥úÎÕô‘<Ğw°}µòSÔlÁÚ|†0$>ËMÑÄ@ÇŒéŒmÔ_#'"ÓuèÇÃf<¯Èh"ç©Ô¾Ø@d,RÉª”ä}îø»„åÀíªÒ1ù}J/R¾Ç¤^/Q6G,±.A´i½ª¯ÌiåÑ×şIxPyI”Q(½sˆmê*Óğ '™Y‹,v¼½ıbÉ—Ú#¼İZ]<ß¿ª|²Ô·Çteœ“,pÖ¥9¡béÕğ¬È¯µ‹n0	döNP+):UölÿV,8rº‚ò®jå
bIã¥Èe'Ë_ÂtrĞøÚ¦^‹kiq¡2PûÏùíº4ò õ)¨Ğ„ùrıW-€½êu!ø¼aLNBô‡QøşèbÂ¿[Húò¸™PL’ıƒtãámsÏ{¨p*A¹*€•"¥(V$ÛJ) |Ãá¬ÙË?i®I!lÎ$°bÜ¹´g…ñ÷ÛÍ)FĞâï|DúT»ßş“U¯*-}V×Jx#G&İJ(pÿNôÂjÌe8³×Uò‡tÜã)‰G>¹ßâ€A¸Â‘J¢¸cZ$„-Ê-ã»!ñ«6ºµVl˜0­€«7äÓƒÌSéƒŸqñIS4Íº_kxLÚ_ÆØró_‹¦µæ;z7îº+[•¶wˆˆ¨Ö†ôÊ åQoØŠÁu|ì!w°‚şSJrŸm•w3óä&öR‰[M‹$Áİ`šY,Ù9ÑBx¼é‹fíX4õÿ
V˜{0ù@Ûh$¸AV-®Q,ƒ§éOÈ[	5éˆ·Kx.æ|†·¿kÚân£Lì7ÍWfÿºı´)˜•“º¾÷=È«<è¯ãAûœù>Ìk¤uÈ]¤XÊX%ÁNXW¢	ÿö{ÄJ=yáTÂÜ®à4Ë“Àš",ÈMF/?´±Ş_^>
=­«&¾Ÿı°!óÕéoÍ=ÃëóÅü,8Œ;xËåA¥nf†Åi~IÏšZ½ø£An®—u@ÜNe|³.%æµŒŠ“ˆj:^.¥öÁ¯~ş6Ò²ø#!¤ìƒ5]ÚzLR6 læ ‰ø•©# ‚fwø &çuG‚íKf	ó§æÚ+^ˆdæÓª”^_ñÅd¸z¶{ÑyÎsûVğÏù ¯ô\ÖÀáÁE*Z8¬"kÖ¦ä»¿Îa_³85?„bõ+ˆõn¦¼Mv€šR»Í½ŸR…<ö£ûÌ]ğ _(î"ˆkñm:ğ_¨ª;ø„âj’§ø¿gÑ}|´VAŸê2$ÅHoÎHK:!ëİµş±QĞPåËwéÕ[^ØÒ×îÒKw…+÷_¸G_·wyÙWm±È/¨©µ ßRñS$ÏIê²wå*Å=1>xGßÂXs ¯ùZ_àßXzg'?s5^oŸ7ô3±YQ$¢P“AE#M„“¾]eCŒR?û—‘¥ÌÆû8ÊJ|Åıˆï3 ìÓE±KQwK¶yí÷øßõ Ø"
™B@í®É0¬&Ùf2Ñ´Øcntlº.åH•eŸÌ"ç¾tDÒ‘i¹,ˆc6b{/)^'r-†M37çZŒéÓ¾*#Ï°šC	Bµˆ­.X×Š_ŸÜÓ›¶¶è\+¢ap£s)g‚ôtøİ<Ôá^FqöŸƒşòŞÑtŠ+p]¬ PãÊˆ
"E[¢tÔ†RIÙÑÌf«”å^	™áÔù¨Öxı»!_Ü®å«¼cAÃÎL%ê¡E±é”}¯—¡ÿ\4gÃ½‹H€W3<áî`Lvİæ2İùíöı&Ü@ÀDnvœ*U$“¥Ê3Í‚ı®4d8B†±s£3F“d5’ÙL¹yÁPÂƒ®næIÙ‡£Z9n0˜k–5ls§Äh4«×P|zá-,^<}tşkŠ+g¯ŒWôLà¶IzaH¹nïÙ´$Î§­>ŒWùIVíŠ©Öc¡l6šgŠÖ0Şüa*zsËPÈŸAj¸suûë@,QÎ·90^9#™ˆûÜ¹=Ã‰G¾;çM
Wà4”JÕãÜM¡›¨º»®6¤æ‰;Fşš¤“¹

Ê›fR?·¹=Ce•õ5U}d…»?£	göåPñ¸œèÇ[!S4°yğ*ı3A&Œt]Å#z†iX˜<@¨4+:±%CfĞ>©±L¢c;*,ôr-^¦»f¾¾€j˜‹ÔM39˜¢æ“AÁ:˜
0–š?ïl?¶İ¸ÖfİLùçĞÖ×àa¬Üu_u^ÑOøàfÓiËnª,YËo…ı´åYhÆ›“óÀ¬ßB—úçØÔÖm¡Ôÿ¦üØB¸üx!µËã4ƒ3È#Aƒù¸Ö%^¡‘’Iy„ŠPù¼³˜[ŠO.íZC~ˆñA€ş^	!wwPİ\"ÄÉ	‰ƒ6ø¼	`‡V&FxÑš–;P+²?¤¶¸ôîá…cK§Í-éÈñc§O.üò]0ì¹¨wÎQåÂXæ”„W"UE]\¨^£‡`fg
àUü)0³[`V ŒdÈ]ì¹ÇÁø‘ˆâ&ÜµHœÅÇJ’³bÁ°±ÚÎlŒÛ?Í/åƒvw˜×*e‚ñƒ¼E½zt¡# î¨Sed¾å4Ìqk9%w:¹5Z7OÙœoùÛ@Ğ§œ¾aìê~!o8Ü¶3ÜgI@l» ¬âÛW7©Şø/åSŞÏW®«9È×z­v^ŸùßüÙôÌ¯}?\ëuO®5ŞÛwÊ>Œ¯M+˜¤©sÂ¿3
¡L¸ş"`œ.9:]¾`^ì‡EµÁ…—L=Ä¹€Â·®œ›‘~‚ìN…"‡.”•¸`°yşwœÆ‘a¿ç(\6° Î•Ø§@‚X,çöS+]!¹IŸd½1é5'>²d.¬Íá^b|àÿ[¶ÀÿO2à—”ŞÄo˜N‹¾ÌóBâßÚù=XEmhÒCÄÕwFÛ§à/ rlSÏ—¼zı ÆO¸Eê(L½^˜x]³M_J¡Êw¦‚½H¿mlZ‹qş§ôàöO½Wºäñÿ  ÿÿì]ënÇ•ş¯§hìÌšQN²PQê–(q$­hÙX†İœi’½jN§gD1èEØâı/°8¾É–eÅ–åI¨¿yİGØ:—ª:uéIvìÀ4`‘İÕu¯Sçúöøur:X¬Î‰:•ª
›¥E»›Ô¾:²Ã°ÚÑ÷§ÊqVóÊæ“S„´î{Sè§0cÓ
©Æ½5ë:­Õïö\	¥Ö¶ÛEvMÛtîcˆ*üYv_ß8&Äİ¾ß}ÈW¡ˆ‹LÎ9²E:E²SÕÌ¼×b¤Û|MšVFéZŞ;–oäê¦Çà¾4F„€5rÔÀÏqÕóñ¾jª®‚É	ü=nRXN&3¤ğM‡æFw û‡O÷îŠIga¦Pä½_Ğ3ÇÕqcO6>U…­Œ1ğĞ«'²ÿÔ, gçÕ@Uêi¦zxÆ@qÃÇÆ¹’rCi‹	:ö•‘¡˜‹8f)˜Í¤ÅñJ&¡”ªlx¥ºímÏÉ¹Á¶eò·t¼l¨ı\]JêF9Õí#ÂVyL”«İG|…¬šï@]od¸oHÆêÅ€|?®1uõĞ–©¶£{ãUl»–…’{aO¶I“<şsÏÉë\¨lp^˜Y¯©(ìu:’¡zWvH¡q]şÛÖËN*ÉØ}òÚã·ÁğC
k…&~ö+8£e¡V$¦Â¤lÔœ‰ã×UûvF*ô³´É›=Æ$Õ¨U°ß{ïÃÒ™İWÌÙõ¸røÿÕ„8 ÆïS m@Z9;hË®ƒ—$im­Zw·÷ò÷¬¦ÔÄÒQ™‚fòÖŞ_8›6%ÖF¾R}DYbÉ’G¶Oíëš`îµŞ“ãh`÷1ñ¬ğUÄÛî!Ñ{œÛd›Å~¾”–ßš›WùA~)ã,®XéCßALóÄ–ø&Ä­½š–—÷¡c´‹ïhY	onãÜ%¤ÕéØfF(³ œ>AjÔò¬àIÖj ojs&Lu+p\¢6|¹˜İ‹@8Æéî{–¿ïšç‚Ì^Â^ïÜ¦Œ ğª¸›¨¹B$M©¿>l"¶c”QÈTÇ˜ÅW‡g²âÜÃ2KL<‘•zÛÂ03bãµ ã.Ác^Óv…OÀÍrgÈÈ}Ç ±ì´";b¨5æŸƒxÍÓÃlpÅ°%ÆŠMIÈ#yıj+ñ±Òï-rvÆ¯¥j¼'îï=]ªi<¦y¨İ¤İ<Aü€sÚÙşˆ‰ûëÿ´84‹oYK&®R—Ú`¼t­Ô%Ì¸	éÌ‹I®ÙúFîä&ŠD”ˆÚuù'z&¾Òûá°ç?I¹±áãï¹®foXÿ='Ë\™Í¾}©ì‡$0N:Fû¦µîÓ£ˆ}d‡)Mmfâ£%vÅ_Ë‰3Æ×+rd¥CZQ¥ƒ|l`ÀSÇ²V(è#¨K¦¸ª_Ì]¹<›ïMÑo(™å&›iÿˆ‡,dĞ;}ó9HbÒ‹§MWË¥èşéA±sÜ¡¥rxû™;NêÔá.×d…B {~¸«Sêı¬ÌiPnò'QJÌ ‚Ğ±†0°<Õ½QŒ|¹f~LµÚÙÙÙ«f›ûgp’^¬#” ôiåæè#ıÄ®W8nk²ù=PmyšËğ-Y%2`òæ™ä3ÇŸO?´³d4™ºfß™?‹ñu¨t]šuØ[ETô†jC3w>MâŞÀ<Ò¯z_HÇ—ØN”¨³SÄ £‘â#¸Øoªg)I gâµVRí%Cšò Ç-Š„`E²tÚ±ò“qÇ *Q	ÓÖÂEß–nĞû­{NGÀÉpŞËÿ9hAÈ¹èÎrr)“¿8AqL@™¦ÿJv…ï¼Uv8fè¨ıYæSùoE´~Ùr°çMó-§¶çdMä¡U‰ÂøE:™@&&J’Jt ƒó:eÌ¡Sû!q2›{!QZgéƒµ¿Oïo¡©]Ğ[­¾snGÓfüf}®kfw'àıÔ•­1Q(Øhş!Õş×ÆPëY‹èOk£uÌ/"ß¨µÔDê­ Í¦¤#ÎB"‚x6¥cæñLÇ>½“åô¢†£_„Ô(§:my’¥Ñ…öî8„ş&±oVÌ\Û/…üğaaTw`‰b•E¼¹­]óuæ,ÆšI-k,lÛïÇÙØw¤“ñcİüæ1tĞ'KÇ·öa\îÕáî…}š¡ Ç­)ÅÊ2"èü!qP`lçwlïMXèş=´_üşBÒø¹;ÒîCS]2ŞÌÈÓ.ŸQÖ+Gı$W—X‚&©JüF9˜WTí([/0Ä6—Šª7±4Ÿˆ¨mPÕeJ"NÕ‡B¼éT!à„°âŒ“Õƒ[q9«byµàÕxîdR*óˆVø®·™6²¤TS°‘_½´(vöcªˆbgA·G5kÙ¬OÓd]ÑÅÍd~ÍE™ö“õr$›ë$ç³l¨Ÿ¦^”E_•ù”gbê]Ëzé¤¢ùmYN¦•¬MÆcÅ%`—3ĞC³ÍTXT ±º~	xN Š—4¾À‡ ï©é‘Å,ü“ãFŠxÇWİ0ïöîtN{~…´AìöJ5éŠQ¡ã×Œú™¡}x˜;÷€P¯Y¡ìbÇ`ß8÷÷PáDĞÈ7á’S|ó>sbq¸Xº"áV¥Èñ›”Ó\8òÂ»fğ„IÁø· BÀoèş…8~ÕşŠ1gıƒ &]d¿P¯şĞ5!mÀ:ĞÜØ£¹¼‰×9¡¨Š"îşóñ¯©-;áÚ‰–üØ,O	.¦	k:o_U7G¹}6Ã-ì’wš¾:8q©Y™>4cÊD…øŠ|YĞ•£^ìÆê°ù‘äf›6i–œQ7lIQ¾}«©öz$Ãö0èÜ°&[éŒE~]ßĞã–a¥r`ĞÏ
A€Œf"c¶í%ûòVç‘[Ú…(9]ı	…Õ á@ıëd-ÑÊêHs\9G¶ê¿€Ç²Ô?o‰ûú~hyb8øÅZáR2Ş6¶yt9¨Â‘…\”uÒ¦Ö&Jõ±îí8…Ú8¾«O"ûjéãb#¬´×qÅ¼Dy;çyà&mÌ+azÃºxMÇ¹ód2÷Â÷xnN*áşb<RÓœ„¶
\Pƒ¶´ÃäŞ‚ùÊ³—¹‰Cd­ˆ¿§S[Ç©Ïé„Ø1âIßï„ËH‡_;TS‡Ï@{UøÑxzg–, ‹lÜTÃŞ²ÿŒ
z2¡Çé/ñkºŞ×£OgI„pœâ9im›éVÂo,ÀárÇ¤†Xµ’„i¦MÅoğ$›‚LØ–¯é£ƒ¦Q7)ièh.ãáŞ_TíHW9ğÌ Ù°Åüºæ‹Ş,~k€ó”®óƒ¼ÚcH	¸¿ŒLêÛ‰£ƒ^Âœ¤¼>ƒ–Y£€)ã§áªØ	àWÜBÌÍO(Bíõë=o€üÔ Á/[ë§Ó¹¾÷©u.xÏ‚9½ÈÂÿ– HèFìÔ5ò~Õƒ¿!½umr4Ô*ŞÔØOR¨#Üìap@vÜBÏ	à}ñSvı 0/Â5ÉPQó)prbCÜÃ<#ï«ÿ¿C(
Ÿ±“6±™w‰¿ƒ»Äğñ_Ú¸·/Ôt]ö]{ë¹¬ÿÇ0‚ÇÿÑu„ñø‰ÁFÕl~!;7!N¥PÌ{P@[Y
ic×'J&;~qœúLuˆm8¨µCqjı€åa•_´Ÿ«¥Î•ÕTsx!ùDEò!•ªYwM{ƒyIµâ¦L£n£bß?×Ğ¶„×©³lÁOÔº?i1ÊÒş®5,w‰ápq:g²¤Im0ª“œ&%¶rgT1¸uID B|•Jr~ò4RAıaß”]ƒ)¿TËuz½mÎg;U;R‚ nØûNLĞáHuâµ3åC˜ÍrR­È:§tÿÄ›üœ¶I®W^á¿ÑÛ}ËûÈ5©İö‹ïkì}Ğ#5°Ñ;ã`ÕqIvGw»][cHÍÙã/Ÿ;{*‚eª;°Ê¥ƒSW·,î‡´ÉëÖÈ†ÇL© ì×J÷§©—5ı\ñÀß/–Ã§KÎPÕáõ‘"ğŸXÄˆÿE4jÄt+páì€&8œq\Í˜Ô/Z_·û‰3-¸â†nkàäÆ}«%è°g2‚³}İØ»ÈØt~¯„;Uœ$¥©Œ—”¡©¨ßé lËsVê„óõŠ‹7ı„ÓöJ˜Ib¾Ù›cÔÏj¢kúş$“ø²EÚ~J²$j¢y¬§Kc§hıÔpÆRÃŠDûè•¯'ÚèhgÂOü0ò­_ÄV’êö¦ó7‡ë™™eÅ8Ø:ıû{†Ê³3µûÎy‘BU~FY‡’p‚	ƒ»ëı,«³ÂIGë2ÊÒ£HOHŞÿÏ_jîÌn×MIÑúŠú#A‹¬™<|Æ¶pÿ…Ï½7ªöktl¶°Ö~-B çXáºJÈ¦¯gÂ]„`²ÂèÊ¹{`ævJSÖu~D°e¸l†c¯Ëf/â+-l¤ÆdÄğ£áB jşÔìÖó½kw0cj0$Nk>Ğ¦ónMd<OWÆğ3›±~f5XÀOÌh!ßGLviÂ(7ùiCİdQºØZû…·OÒ¾ÀKå†õgÇ³0‰%î%e‡å–´^;tLêíw}ŠXNŞ|ş’hÊhÅÆŒ¹n—×ïè¸&ÙPÇzcµD“®@Ëõ¤Rõ£œZHøLÏ¹òá2:!åC|uàÅî.©ÿˆ	<¢•ôuÜ•àùb
/ØSéÜàü ÜˆOË
ávøî@ˆ©«zÖŒ]”_•ÛU†!¼Ş¬ájÖÔş²(•+¾±,ĞáúÕtJ,OÌ’àk˜©"b9sc/É’‰ÀF6Æ°ÛÌ¦M¯1yFìÖ"iÆ€Ï~Ó€ØŠÖ\Pb®"Ô.´(Ë‹CF:iiÏ²t2Ş,GĞ¿Eí×7Ûµ ˆFD |.#Ué'î­¬»6ïxG‡¢ÈFÆ.ËÚÅ% /ó¤~ïšğÛMïÕvFƒ.^	_/Óõ¾.>b;EÂ«kÕ!ÀnÜû÷#ÀVdc1”éÑŞÇ”l›# \ :MĞLğ»·a7„3Şæ„Efëšı\ˆá¨¡`>“¢»ºCèæ)„Î˜ t/rÄyWCŸbÊx=¥ğBó!@*£]+UšùLÙ’¿ùçÁæbã8ÀiğR>ÇÅ@˜P+dj²Mcb¨±-VŸoÖ‹%w¬«­U…‹Å}ğÅaÇAlĞh›^{½¦7?ÉÙ®ıÙÉ~m6be§õ*Ú@´gQr·|@šè	ª®ôT¯'©]Êˆ®42úåæÙŸ_!"N‚#;Öö³V[á'n56¸Ù[»İvó^eO§¶l˜Nl»¡Ë2%˜ĞÎ=
Yµ¨Çéö’¿s¿S±|*›eû©ÕVã´1¸È[è©š”57º«¿±’•NKGx$€bâ8`£#÷[.s"»ÛèŠóp&Ïl†f,;<Å-¼ÃYëĞƒI	Xœ}˜®65ôo†)€³Ä
ŞFÌÆS&=™µ„VAÏ›;Ã<d¶½ÍyØÜL=ÖmJ°yzÇğWÇïE}ªŸÔ£zF6;z“ûÀ–’GtŠ9¼·,åwjq{äş†Ì»…G³jp5×X§Oî[nÂ6¹€f‰)Òwú•JoOwù<ÍÕóÔÏÜ×¼	òÊ©¿pl#ì¿(º¶ZnaQ62ûQÆHaî*ŠÊÉ0²)!IW¶™^ÈTGá'¯ÖÉGåv7yÙÆ[¡ÏÙ)ÒG3¦®Ü·(¦J×Ø+‹‚èÅ„‚ÑX!JÓÍ$5c˜TQYIªëãÃœèÜãRFW%Û›y‘ÉX0õo^I•nƒÁ`Ó •(W5Ìz9Dt%éºC)k”o€_GÒWƒ€š‘~‰ö²~79ª†Ã!o½tP 0Ì”}âÔôÀÀ 4k‡£à!..S“D3QÚz”•ÃÇİW½@5šÕøÔyj[Áwæôe ¼ğ¦Æq~ş’=ú»â/õ(¢ÏÜújNs¦C²]Å»6d
¼çdgºˆ…‰E	¥£Lƒ¦·H\©¼®Á]&ªgì³ÎE‘ÂûÜš&æuÿz¦¶f'Æıam~=r¿I„Y³.Àl“¨ÿú›%DÅ4-ßH¾İYMİh}J2 ìŠØŸœŒMğ¶O æwÎ›m[Çék]§GB}dûğ}@c-(Sœ/%¸«aAk9rûb S´×S—kÿ¥Œ¬‚ÖÊ5µR¥DÎ?,à™ıp}¾c-ÂáĞ”ß#
Fk«j‚ŸåÙ› Ë1”ÛÙe½…MÇùéióĞèêD†#«ïep^­ô·òULœP©s¯YTO¯)ÄÓ«zUYÜ&<,lDXÍ°s:ÔUºĞã[o-L9ëĞÀf1ó+;¨÷f¸3¦ƒ³ˆE¦7'çqø6nMœÈÈBûS>Ó„óŸœ\e¶­ß#^K±mâUPC.‚ïÂ•Ö0Å?N–ˆÜE–Ü«]˜è¾‹îĞ£PX…	1N£Ô{Ó¾-f7Ö/¼›F¾qÀía÷Ç‰AKñc­û®tŒ’8{vXCÛlãáÇVÑUCX¼]¦‘ÔçßbRyöÛÔÉ?sĞ¯Ë`œó§=Ü\Îµ#öš™nAâíÓuÒ°-Ûœjñí§ie¡cyuà\˜ñtŸIw õ¶Ü²Ÿ.^N²sX9•[ü…I;‡T2»Q$;ÉeæJõ…ŞS[û‘†kÎõ¬4ÈSh óı‘{aû®)y‘ŸIYö@I”w	ÌlïC'áP$Q‘’cùı¥ïÑĞwŸñn×•—Š!ı¬5ºQÍöÒ†^ã(G’I;p’s]=‘ÊÀrN ñd.g!ñqÆ­Ÿˆ“Í²¨µö¾w·›è¿ù4ˆås/l>ïÃ*j…ñ+¸‹¹’L‹"ßÈ5y4Ç“q9jÀóû.=æ³O)2ƒMÍĞB$ØÑGÖ&NŒÔ«ØœÈÓg6óÎŞ@š_K^†ıdRÃÎ1ó	’Á8¨2ÑÄ¢=æÛ‘gr
7^wëÜh¡êÅ»‹£üïLÌOÈÏµQ"iÍ-nÓÈô‚&u¸Yz<-Øˆ:SÕ°”sIï†Q¿Ä+”ÔÒûû«cÿrØÇ5g:½ûébŠ¡*ÕÏ/3 Ëâ2ò·Híä¥»ÀÜ}„»dJGf”ï)JU€ºqñÀ‹âÊèÒu k“¼è¯ôÓ!ò@OÁ›¶qşñ÷·ØmK®€~F%¤!Å–±O¶‰?Sl¶LœfR©­T-G•,djåd¨ü	lxn 	é4ópŒí'ò¬èWmœŠÌ6õBMÖFyoq=Ëúkiï|Sb7dë˜]!½hÄ:MCèÃ.íNäüó{+ è§&²ÿDHYqzp^±7‡möVAşöïO^*ËóÉz>Â`3´¿Ò‘[ä¹ °5AÀ/˜Gm\¥ÛûØø, GÇàÕ·¶ƒÖTf#ÜŞ,Õ	¦³«™ÀıÀ«&y…¸œù€ªC32Åö;&·ä}ƒ’d¸N“"ÛÈm »3gU§#u?jdQª«ÜF[2/k7ásŒªÖj3B£lQ3QÉZV”ÛÉ…<å®42¶„Ùªª@7‚í\*)ÔÄN†5Êá$ãndQ™fë-"pHcwº‹ç¤á‰9£;.ê†Œ ?:^S1GùZ.cÆNt0)
Ó¿Ø^Õï  åH„•ÿÙÙd¨ÇC4¢>¾—ìOO`nÜg£•£µ¶Å1õ2EâZ\±ÊÔ0'72§ş šb3z]Eê{‚‰ox_ÂgÔ_OÁ¬ˆÑ‡×•æTuz »<ï…æSÉ“C”²Ğí»á*ksĞVêïVº—äIO¼½C¿æ;Ó:6mm¥£oİélA¦jVÑƒcjŞ…¯-½îëŸL‡èAD¯ÒpG_¤{¦í0ïd¯q¹iÁŸydùv¯9‘sr@3ĞµêˆÇ5“PqCæå‘],¯ÇÜ¡¬éøØ>eYai!ù§‰ÆøwÍE„Ÿ©‚¶Èz0/è/Ğ§Í¡“öúZ}KTãò,u.q­Ë½Ët‹áı$™t(~h?œ]1l|Ú“ØÄg©CqÆiìœZª¯ç×Dià+ª7’è¹*‚YéÔtUËæ¸jÈL¯Jöùq¾¶OİXæ§ \NìÁ·àŠò—g'2Ûr=ÍbÍ²TÏî~)ß£×Ë°T×²o7ÌÌ^sÚ}üH©˜›²şâäÙ•Õ7^:¾rö;~ô$’Í#§Ï:¶rö_ßX9ëxÏ)ùÿ'Ù8Yİ©O üs`\ 0p˜l^õdXÆ•70(ŠßÎšÈ~<Ú‘Ü_<
½½‘ì³IÄİ²+ô<ö‰ÈXì~Ñ©SÕºßñöö³¢ÜË@,lJcçÙlCM:$¢¶é>uôƒnÑ3<A±a6êe}}kXdcã¢ç7DNKğÃiÖ‹²I„@ÓU|¢±vÚë)WVıš¼T]½A’¥N²ßoÄºÔZıÈ’Î t4-z“4[}%ş÷²ä‚ÆsQCËFÔÊdß¸uÍ"í¦{.°oE—P€ˆ«² ß ñ“ÖãõçŸö>BÄ…¢"É Ã‡™Xê®ŞZÉx3UûpA&£ÉÆFš·í|¼I¾Ç¦Óù€®ØÓ£U[Î®®«Ø§IµÓ™ü(yq	Y şQòV “÷–7÷h!+n1À¶Â¼‹&æMßì•£®ç·ºáe¹¦úK}¦®è§EZÕnÎ±Fó@cëÏÙæó¹¼8% ˆ*n)Ôo=[	÷²İs°.z:ÉæwŞ„¹İ“ú×&Ñtœ¡-€˜
ßİSZB.xÄñs 0¿$¿)Geêî-üú-¥=å¿Ì~p¤€ôÂÆ*î(Íºí¹.Íô!ø–é„SDõÉÆ[‚l´ßâ]½_õ]D±wŞ|Á«À{ t&ÚiYL"ÇÿpÉá½.¹‡èÆŒM¿pĞâR‚©-7÷%U‚Yº‘á”Ÿ!Â¼lÖ€Šöë¤£W(*¡H½+Ã ÷UW¼ÊèÖH&¢ã3«†ĞÑ“¤¨FãtÆ<u¼Õä‹¨·9¹ü‡LlŞX¿µ[!$XÍÆNfE=ãj¨óu³Ñ¤¨6zÁxºWFîäar]Z1µ³:q·=ëf®E³şŒş·,IÓ„ÅÛ#³ÔİL+tô†é¨ÁsP%QÏO½ß¼¿äé,D­`i„J'ñlH§e`4Wc£¹|×Ú“¨‡!”9)Àm%Vº?F º"áK~ˆ=C%¦e9÷Á„$À½Eò»kÉx×s†Ú°%¥D&>·· ”c‰¨Lø‹,Q†P2²¬(öxV-Ü„|½‰1Wìm)®^_Ãíî–']Áa9®Ä«#£I•ÛvÂÅ|A´´§^‚G¾›˜’„ş&m%YÏlÚ¤e‘‘ÄİÖ0~Z(S / ^
äó)pŞz°¹(â±¿2âUlyÄëØIL¹RNft³öY°JöÕ¶líİÙ{´÷(Êî(ÿúã[uzôHämráP¦è?ª7w(wÏ=Âù@gú†ÌŞ˜Æ…€"ØT0Â§WtÂ¥®çÌıµ„¼JáÅì",XƒNù©=ÃıÅoĞ«Nq·iÒ=ãğ”KZÍƒêî#iïüd¨ÕNò*WyÀÉ &/¹­¬)dĞS|˜ìvâê|wÒó-ô´Úô¾¥S¯U&¿ài7ÈO¨µĞOä´ìöW‘0â.Ì_uá~A}‡˜M£Ypûi” ²°lD£ƒaé*\è²TF„&À«Ëå•½FÁ_v4ÿŠ{ú$î%Ğ¦šuÓ4´Ó›+UË.D¤1¶?»ê¢­LÕF'
[×ıã/§Ob¶ÉHğ`ËQzµêÏOqWbĞÿ-€’×²_£$“ÛÉ=Èßf¿S4÷wX×çÏÉ©&Âº÷) úŞ¥TÁ	€P8«t˜Ò½q*¸Ç—U©?»Í¾d49ĞKãÖã-ØUŞ2ìZ¤e7ªn½$ÌrH¿<„e1>>ù‰Á“çƒN¶ÀÉ°o’WÒIa!:¦à%ïJù¢n§¹ÎC{l2J×ŠlUOÔàvÜ²S©5ïñ…¤1Í–Çù¾=š<¢ºd(–o9S;äñem«7tl7º¡Qœˆ)ğÄ'»F0Î1AZ¾šAşm˜òr”@’¹<-@ï=*fo2Îêî§J}·È¬Íb¡X²(gàM‚™‚<1?u#†0pF_¢›>biAÑ\(˜“áğ>æU¼ef±Ë`ôá!$¬VE.ŠÇÕ½/x²‘µú@'¼ûø
ä‰„Tƒ×)+7oa‚J¿‡o¥'óè¤—[ÉÙ<!ÛÌñÑì‚EBq£”ôàØ©›[ø`M]bû{Xß"™98/	y&îTOtróÅEíU”Á{>Ñ-Ò%×ájN>*È²_1Æ+qm=eÀ©Ìé4§É´N„>‡Ö•î`K<¾,ND„SÁH|«Gˆí,¶»Ú')ĞÆAÜ&è ª:hâ	³à!c$q£sğûíõ¯¨xü¡)•Ô—BØ…Õl,T_ş³‚ÙÑPå’«¯Šx‰ Îïì"5š¡z¼l-Çr%\ QTôß(Y‚ùïÕÆóêiA]WÓ`]8AwIäæ¨õéL9tu»ÁŸ)<hjXÃ¶]zû¢2!#<™À-Ú4Ú:¢3ó‡²•®Bš’"l5QÃmÅŠh&´µ?Œ"ı—˜4÷>¤%~@émá
ù³ßŞ8Î{tÃ "h‹§ÌGÁõf©Ø‡×ù0µîİ½Ïà~nII‹ñâ">â>,+®–¯;Ê¶ÔîîkÚ¶›h¿–ı8œk{ÿ)Ìçk×ÄĞÅJ6÷à.ğÇ×I9+i UÁÏ÷şˆUFŠiŒèäMô‰†v‰‡Ó×)]óçäô2Dw÷C¾b,Îù‘ï)şÓ(ßÀ´Êïs
æ¶mÎ @ÿ¬ÌI=½›`÷HÉrYıúçåÜ¿jæúºÚ.ÔˆîFØh—maî{^z.dRF64û¯n+óşƒÜÏ¼éx«ş½ì½n"xëÍ¶ÛìŞÑ¢‡ÔÒ	kéjYk¥4H—|ˆÍTèıò sßWå’è“®†®ôeˆ“¢ĞLï«ù0#IÄ¬d>üCyoRL¶ÖîMÕt62<Çk˜©ä¹ú{ç‰Ã\•\ó	JIÀüóêJx@òcÍeÕÌ7§£Ş¦“ûG²u4×›†n¢Â=¢ö¥ÆÔİÿní+ı>*¾ĞÂ¿•^Ôª.£Å¯k5Yôz(½ ¾q\FËFÄ‡ƒ
ğŞWõ¯×PâPÜ\\ËÜQtêüÌ;ï‰d-¢©·¦U¼Q	Æ\mˆûŠ~ÜÒ"´%oªoj£@É÷xœÔrÂ>ï ‰·A,GÒï¬ª¾VñÆ}hZû;¹]ŸâzufÊÈH5\N³~jgÜ@HÓ»ÀİÄù‡iıİôà½ƒ ñ Bù5`)\GíÒP7ÑíeºcPTºC»Ël¶ wµÌğZ„n¯:òëÇ7=‹Ößà®tF7ËÅy´¬çE"_ÉÇY²•÷ûE¶şyåˆrW#PŞKú …İÏG–}d2ˆNke9®Æ#%ªY¨&°¹ŠfµşzûóäÕ4‡ÄAy«¯U«íƒºĞ°W”“~rB5ƒAÂİn·åYpH¹*($WÖ3£r+¯„wˆíÂ]OE›íOOŞópìp³º¹­|ßZË`kZßÕ•ñXÎ-ë5K„àu£$?"Öì."Ãm	R‰ÄèÚ® |˜ ]¼’¬?Ò²Ò—{ïój[*#û¢D‡©ş\NN÷¦q›÷øÄÀ‘SôñŠjêÚ„\‡¯(MÄ_TÙ+BíèöÓ‘q?ª3 ›å:ÆmWl.×^ùÁš¾¼ÑWÕzêÂì£váŞî{u³8¨şøP²ÿ.Jt„*½ŒªÓk°5ÆÙj¶vªT;®V¨äµüuÅÁ`uÕã§òõ½QJì³•È6†:Ûñ´6z
¥É›ÿ÷ß<JÎLFjÏ=‰¹(±›”ÜAØÉ ºïÑñ%W´Z`Š5Ï…2ïËéÀzujÛHø½ASÁ®Gªâ^ümë¯¿ÿŸÿıóíš£”zÀŞ ƒt: Ê³€¤1ê1EÁítgÙÜTª”0í™ìnøh8*áDv³Á…î©ÓÇ¿qüÔ+dƒToú$= |¤ûŒÖA³Öó"«’uE­UÜ±uüì<=£X80a'÷oŠ[kë¶{Ûıvg!iA!M ƒë“P=«Ğ´£«¡J SLÀ‰¡ì¨O¢äAQ}ş1*\Ğ2ÒÙ B©m{©kST¬}v±»9Ş*Z¶nËD Êº>™Ò¢¨V¸dî(	
')» ×5ÿ%¹”«ãÔåU2,ÉŸ™d'ûcØ?ÃäihY³ç²¶QŞ }ĞBP'~òI7µ•ÉëŸº	–>û¦`õ,®«›ş¤Ó5^GSÌ'ÒÿÄ9DNÚS9gjÆğ†<©ö÷ÉïHƒ*µµ‹l‘wÌ]V”C¸’tœœ)Gãä{KKKO³Û8`Z?Ä÷Q“)@‡8ñáÛğÏåä’¸Êª^`älZbµ^/s6æaÚrU.zãB‹][Må½Æíêy…,$ƒìâ8â"8˜¢ú­®Îqndt½pœT8!£qõªâHou:ÎîA¦	hYŞ6I÷xc|Ä¡dœ«S<:xXÅöÃP/‹Y°òDI÷èÖd¼¾øÃØöId³´T8‹%¥¶ËÖI¨ò§ªFğ‚)íèêÄü¢â» ‰^JZlğ]„Uka2Ú‹ãıØ5µn]8TA]–ª;Ì'ü`§ªjt"¿¸ª˜óªê®“İÀi.K£ËA‹.°â‰<ÄêŒ~®Nå— Ÿ}Š©ªş'HIŸß–¤±õ¹V<6œk¶w^GıÜ}²ÿÂËÛÈàüÂ6©mbƒáp‹NÜÄ’÷ÿV1Ho“ßÃ-än°ï‚&–\ÓÔ{°åª~‚Üú¥pn#ƒöurmFFïvãUˆM@)î~ù´ª}ŸÑy°ÏO©¿N0Ï,N	ºZÍzå¨Oçù¸¼tß|şœ­l¼Y*©ˆş‚»ÊrÕ¯Ã†½W¢¤NZ¥nr›zÄ>P< ùnëú&Ştün­Ò‚ì*$Ëƒõ¡ÂMÄHzoïãD/1ŞuïQ7A{úÛŒØhÜT÷ÿÆªH”…u'€lĞ>súìËêô.¡,¾÷‘&¢™2Å‰ışWÉKŠÿTìÉÀ:z)]#bÄ^ı@Ä7ÇãáòşıEÙK‹Í²/?	šØ}Ó´¯N„€ºxìÚÄL	¡ğA=>§˜¢h^M–S*4òÿ   ÿÿ x2C¡