var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_cors = __toESM(require("cors"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_fs2 = __toESM(require("fs"), 1);
var import_express_fileupload = __toESM(require("express-fileupload"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_dotenv2 = __toESM(require("dotenv"), 1);
var import_child_process = require("child_process");
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_server = require("@simplewebauthn/server");

// src/server/db.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_app = require("firebase-admin/app");
var import_firestore = require("firebase-admin/firestore");
import_dotenv.default.config();
var dbFS = null;
var firestoreQuotaExceeded = false;
var firestoreQuotaErrorDetail = "";
var firestoreQuotaExceededAt = 0;
var FIRESTORE_QUOTA_RETRY_COOLDOWN_MS = 5 * 60 * 1e3;
function reopenFirestoreSyncIfQuotaCooldownPassed() {
  if (firestoreQuotaExceeded && Date.now() - firestoreQuotaExceededAt > FIRESTORE_QUOTA_RETRY_COOLDOWN_MS) {
    firestoreQuotaExceeded = false;
    firestoreQuotaErrorDetail = "";
  }
}
try {
  const configPath = import_path.default.join(process.cwd(), "firebase-applet-config.json");
  if (import_fs.default.existsSync(configPath)) {
    const config = JSON.parse(import_fs.default.readFileSync(configPath, "utf-8"));
    const appName = "miras-server";
    const app2 = (0, import_app.getApps)().find((candidate) => candidate.name === appName) || (0, import_app.initializeApp)(
      {
        credential: (0, import_app.applicationDefault)(),
        projectId: config.projectId
      },
      appName
    );
    dbFS = (0, import_firestore.getFirestore)(app2, config.firestoreDatabaseId);
    console.log(
      "\u{1F525} Firebase Admin Firestore initialized successfully on backend server with database:",
      config.firestoreDatabaseId
    );
  }
} catch (e) {
  console.error("\u26A0\uFE0F Failed to initialize Firebase on backend server:", e);
}
var DATA_DIR = import_path.default.join(process.cwd(), "data");
if (!import_fs.default.existsSync(DATA_DIR)) {
  import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
}
var DB_FILE = import_path.default.join(DATA_DIR, "db.json");
var MIRAS_CLOUD_STORAGE_FORMAT = "chunked-json-v2";
var MIRAS_CLOUD_CHUNK_SIZE = 62e4;
var MIRAS_ALLOW_EMPTY_FIRESTORE_INIT = String(process.env.MIRAS_ALLOW_EMPTY_FIRESTORE_INIT || "").toLowerCase() === "true";
var MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD = String(process.env.MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD || "").toLowerCase() === "true";
var MIRAS_ALLOW_LOCAL_ONLY_MODE = String(process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE || "").toLowerCase() === "true";
var MIRAS_DATABASE_GUARD_CODE = "MIRAS_DATABASE_GUARD_LOCKED";
var MIRAS_DATABASE_GUARD_USER_MESSAGE = "\u0627\u0644\u0646\u0638\u0627\u0645 \u0641\u064A \u0648\u0636\u0639 \u0635\u064A\u0627\u0646\u0629 \u0644\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0622\u0646 \u0644\u062D\u0645\u0627\u064A\u0629 \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0650\u0631\u0627\u0633. \u0644\u0646 \u062A\u064F\u0639\u0631\u0636 \u0628\u064A\u0627\u0646\u0627\u062A \u0641\u0627\u0631\u063A\u0629 \u0648\u0644\u0646 \u062A\u064F\u062D\u0641\u0638 \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u062C\u062F\u064A\u062F\u0629 \u062D\u062A\u0649 \u062A\u0643\u062A\u0645\u0644 \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629.";
var MIRAS_DATABASE_CONTENT_KEYS = [
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
  "passkeyCredentials"
];
function databaseHasMeaningfulContent(state) {
  if (!state || typeof state !== "object") return false;
  return MIRAS_DATABASE_CONTENT_KEYS.some((key) => {
    const value = state[key];
    return Array.isArray(value) && value.length > 0;
  });
}
function readExistingDbFileHasMeaningfulContent() {
  try {
    if (!import_fs.default.existsSync(DB_FILE)) return false;
    const raw = import_fs.default.readFileSync(DB_FILE, "utf-8");
    if (!raw.trim()) return false;
    return databaseHasMeaningfulContent(JSON.parse(raw));
  } catch {
    return false;
  }
}
function cleanUndefined(obj) {
  if (obj === null || obj === void 0) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined);
  }
  if (typeof obj === "object") {
    const cleaned = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== void 0) {
        cleaned[key] = cleanUndefined(val);
      }
    }
    return cleaned;
  }
  return obj;
}
function handleFirestoreError(error, operationType, path3) {
  const errInfo = {
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
    path: path3
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  if (!errInfo.error.includes("RESOURCE_EXHAUSTED") && !errInfo.error.includes("Quota limit exceeded")) {
    throw new Error(JSON.stringify(errInfo));
  } else {
    firestoreQuotaExceeded = true;
    firestoreQuotaErrorDetail = errInfo.error;
    console.warn("\u26A0\uFE0F Firestore quota exceeded, skipped throwing error.");
  }
}
var initialTeachers = [
  { id: "Ah.Alfailakawi@paaet.edu.kw", name: "\u062F. \u0623\u062D\u0645\u062F \u062D\u0633\u064A\u0646 \u0627\u0644\u0641\u064A\u0644\u0643\u0627\u0648\u064A", email: "Ah.Alfailakawi@paaet.edu.kw", passwordHash: "sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678", role: "teacher", isActive: true },
  { id: "dr.ahmad.alfailakawi@gmail.com", name: "\u062F. \u0623\u062D\u0645\u062F \u062D\u0633\u064A\u0646 \u0627\u0644\u0641\u064A\u0644\u0643\u0627\u0648\u064A", email: "dr.ahmad.alfailakawi@gmail.com", passwordHash: "sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678", role: "teacher", isActive: true },
  { id: "ada.alenezi@paaet.edu.kw", name: "\u062F. \u0639\u0628\u062F\u0627\u0644\u0639\u0632\u064A\u0632 \u062F\u062E\u064A\u0644 \u0627\u0644\u0639\u0646\u0632\u064A", email: "ada.alenezi@paaet.edu.kw", passwordHash: "sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678", role: "teacher", isActive: true }
];
var normalizeDbStudentId = (value) => String(value ?? "").trim().replace(/[٠-٩]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d))).replace(/[۰-۹]/g, (d) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(d))).replace(/[^0-9]/g, "");
var normalizeDbEmail = (value) => String(value ?? "").trim().toLowerCase();
var cloneDbValue = (value) => value === void 0 ? value : JSON.parse(JSON.stringify(value));
var dbValuesEqual = (a, b) => {
  if (a === b) return true;
  if (a === void 0 || b === void 0) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};
function cloudArrayItemKey(item, pathParts) {
  if (item === null || typeof item !== "object") {
    return `value:${JSON.stringify(item)}`;
  }
  const field = String(pathParts[pathParts.length - 1] || "");
  const value = (...keys) => {
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
    "submissionId"
  );
  if (stable) return `${field || "record"}:${stable}`;
  return `object:${JSON.stringify(item)}`;
}
function mergeCloudThreeWay(base, local, cloud, pathParts = []) {
  if (dbValuesEqual(local, base)) return cloneDbValue(cloud);
  if (dbValuesEqual(cloud, base)) return cloneDbValue(local);
  if (local === void 0) return void 0;
  if (cloud === void 0) return cloneDbValue(local);
  if (Array.isArray(local) && Array.isArray(cloud)) {
    const baseArray = Array.isArray(base) ? base : [];
    const baseMap = new Map(baseArray.map((item) => [cloudArrayItemKey(item, pathParts), item]));
    const localMap = new Map(local.map((item) => [cloudArrayItemKey(item, pathParts), item]));
    const cloudMap = new Map(cloud.map((item) => [cloudArrayItemKey(item, pathParts), item]));
    const result = [];
    const emitted = /* @__PURE__ */ new Set();
    local.forEach((localItem) => {
      const key = cloudArrayItemKey(localItem, pathParts);
      const baseHas = baseMap.has(key);
      const cloudHas = cloudMap.has(key);
      if (baseHas && !cloudHas && dbValuesEqual(localItem, baseMap.get(key))) {
        emitted.add(key);
        return;
      }
      const merged = mergeCloudThreeWay(
        baseHas ? baseMap.get(key) : void 0,
        localItem,
        cloudHas ? cloudMap.get(key) : void 0,
        [...pathParts, key]
      );
      if (merged !== void 0) result.push(merged);
      emitted.add(key);
    });
    cloud.forEach((cloudItem) => {
      const key = cloudArrayItemKey(cloudItem, pathParts);
      if (emitted.has(key)) return;
      if (baseMap.has(key) && !localMap.has(key)) return;
      result.push(cloneDbValue(cloudItem));
      emitted.add(key);
    });
    return result;
  }
  if (local && cloud && typeof local === "object" && typeof cloud === "object" && !Array.isArray(local) && !Array.isArray(cloud)) {
    const baseObject = base && typeof base === "object" && !Array.isArray(base) ? base : {};
    const result = {};
    const keys = /* @__PURE__ */ new Set([
      ...Object.keys(baseObject),
      ...Object.keys(local),
      ...Object.keys(cloud)
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
        baseHas ? baseObject[key] : void 0,
        localHas ? local[key] : void 0,
        cloudHas ? cloud[key] : void 0,
        [...pathParts, key]
      );
      if (merged !== void 0) result[key] = merged;
    });
    return result;
  }
  return cloneDbValue(local);
}
var LocalDatabase = class {
  constructor() {
    this.isSyncingFS = false;
    this.lastFSSyncTime = 0;
    this.syncIntervalMS = 1e4;
    // Throttle to 10 seconds for standard saves
    this.pendingFSSync = false;
    this.persistTimeout = null;
    this.lastSyncedState = null;
    this.mutationVersion = 0;
    this.cloudUnsubscribe = null;
    this.syncPromise = null;
    // ⚡ تجميع وتأجيل الحفظ: انفجار التعديلات داخل الطلب الواحد (حذف مقرر يلمس مئات
    // الطلاب، حذف طالب، إزالة مقرر...) كان ينفّذ كتابة كامل القاعدة على القرص +
    // معاملة Firestore بشكل متزامن لكل تعديل، فيتجمّد الخادم. هذه الأعلام تضمن
    // كتابة محلية واحدة ومزامنة سحابية واحدة لكل دفعة، خارج مسار الاستجابة.
    this.dirtyLocal = false;
    this.localSaveTimer = null;
    this.cloudSyncScheduled = false;
    // نافذة تجميع الكتابة السحابية: كل التعديلات المتتابعة تُدفع في كتابة واحدة بعد
    // توقّف النشاط، فلا تعمل المزامنة الثقيلة أثناء الحذف/إعادة الجلب ويبقى التطبيق فورياً.
    this.cloudDebounceMS = 250;
    // طابع آخر كتابة دفعناها؛ يسمح للمستمع بتخطّي صدى كتابتنا بثمن رخيص (بدون مقارنة
    // كامل القاعدة عبر JSON.stringify الثقيل) بدل إعادة معالجة كل كتابة.
    this.lastWrittenUpdatedAt = 0;
    this.databaseGuardLocked = false;
    this.databaseGuardReason = "";
    this.isFirstSync = true;
    this.hasLocalDbFile = false;
    this.loadedEmptyOrInvalidLocalDb = false;
    this.allowEmptyDatabaseWriteOnce = false;
    this.data = this.load();
    this.lastSyncedState = cloneDbValue(this.data);
    this.initialSyncPromise = this.syncFromFirestore();
  }
  lockDatabaseGuard(reason) {
    this.databaseGuardLocked = true;
    this.databaseGuardReason = reason;
    console.error(`\u{1F6D1} ${MIRAS_DATABASE_GUARD_CODE}: ${reason}`);
  }
  unlockDatabaseGuard() {
    if (this.databaseGuardLocked) {
      console.log("\u2705 Database guard unlocked after receiving a non-empty trusted cloud state.");
    }
    this.databaseGuardLocked = false;
    this.databaseGuardReason = "";
  }
  isDatabaseGuardLocked() {
    return this.databaseGuardLocked;
  }
  getDatabaseGuardStatus() {
    return {
      locked: this.databaseGuardLocked,
      code: this.databaseGuardLocked ? MIRAS_DATABASE_GUARD_CODE : firestoreQuotaExceeded ? "FIRESTORE_QUOTA_EXCEEDED" : MIRAS_DATABASE_GUARD_CODE,
      message: firestoreQuotaExceeded ? "\u0627\u0644\u0646\u0638\u0627\u0645 \u0641\u064A \u0648\u0636\u0639 \u0635\u064A\u0627\u0646\u0629 \u0644\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0622\u0646. \u0623\u0648\u0642\u0641\u0646\u0627 \u0627\u0644\u062D\u0641\u0638 \u0645\u0624\u0642\u062A\u064B\u0627 \u062D\u062A\u0649 \u0644\u0627 \u062A\u0638\u0647\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u062B\u0645 \u062A\u062E\u062A\u0641\u064A." : MIRAS_DATABASE_GUARD_USER_MESSAGE,
      reason: this.databaseGuardReason,
      firestoreQuotaExceeded,
      firestoreQuotaErrorDetail,
      allowEmptyInit: MIRAS_ALLOW_EMPTY_FIRESTORE_INIT,
      allowLocalRestore: MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD,
      allowLocalOnlyMode: MIRAS_ALLOW_LOCAL_ONLY_MODE,
      localHasMeaningfulContent: databaseHasMeaningfulContent(this.data)
    };
  }
  async waitForSync() {
    this.flushLocalSave();
    if (firestoreQuotaExceeded) {
      const message = `FIRESTORE_QUOTA_EXCEEDED: ${firestoreQuotaErrorDetail || "Firestore quota exceeded"}`;
      console.warn(`\u26A0\uFE0F ${message}`);
      if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
        throw new Error(message);
      }
      return;
    }
    if (this.databaseGuardLocked && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
      throw new Error(`Database guard is locked: ${this.databaseGuardReason}`);
    }
    const deadline = Date.now() + 1500;
    let syncError = null;
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
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 200))
          ]);
        } catch (err) {
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
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (syncError) throw syncError;
    if (this.pendingFSSync || this.isSyncingFS) {
      throw new Error("Cloud synchronization timed out (1.5 seconds) and is still pending.");
    }
  }
  async syncFromFirestore() {
    if (!dbFS) {
      if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
        this.lockDatabaseGuard(
          "Firestore is not initialized. Cloud-only mode refused to run from local data/db.json so the app does not appear wiped or overwrite cloud data later."
        );
      }
      return;
    }
    try {
      this.isSyncingFS = true;
      let cloudRead;
      try {
        cloudRead = await this.readCloudDatabaseState();
      } catch (err) {
        handleFirestoreError(err, "get" /* GET */, "system/database");
        if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
          this.lockDatabaseGuard(
            "Initial Firestore read failed. Cloud-only mode blocked the runtime instead of serving local/empty cache as the real database."
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
              "\u26A0\uFE0F Firestore system/database exists but is empty. Restoring cloud from local cache because MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD=true."
            );
            await this.writeCloudDatabaseState(this.data);
            this.lastSyncedState = cloneDbValue(this.data);
            this.unlockDatabaseGuard();
            return;
          }
          this.lastSyncedState = cloneDbValue(this.data);
          this.lockDatabaseGuard(
            localHasContent ? "Firestore system/database exists but has no meaningful records. Refused to pull the empty cloud document over a local cache that contains data. Set MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD=true only if this local cache is the intended backup." : "Firestore system/database exists but has no meaningful records, and local data/db.json is empty or invalid. Empty runtime was blocked so the app does not appear wiped or save an empty database."
          );
          return;
        }
        console.log("\u2601\uFE0F Found persistent database state in cloud Firestore. Cloud is the source of truth.");
        this.data = cloudState;
        this.lastSyncedState = cloneDbValue(this.data);
        this.saveState(this.data);
        this.isFirstSync = false;
        this.unlockDatabaseGuard();
        console.log("\u2728 Cloud database synchronized to the local runtime cache.");
      } else {
        const localHasContent = databaseHasMeaningfulContent(this.data);
        if (!localHasContent && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
          this.lastSyncedState = cloneDbValue(this.data);
          this.lockDatabaseGuard(
            "Firestore system/database is missing and local data/db.json is empty or invalid. Empty cloud initialization was blocked to protect production data. Restore a backup or set MIRAS_ALLOW_EMPTY_FIRESTORE_INIT=true only for a brand-new installation."
          );
          return;
        }
        if (localHasContent && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
          this.lastSyncedState = cloneDbValue(this.data);
          this.lockDatabaseGuard(
            "Firestore system/database is missing while local cache contains data. Refused to promote local cache automatically because this may be the wrong Firebase project. Set MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD=true only after confirming this local cache is the backup you want to restore."
          );
          return;
        }
        console.log("\u{1F331} No prior database state found in Firestore. Creating first-time cloud backup...");
        try {
          if (!this.data.lastUpdated || this.data.lastUpdated === 0) {
            this.data.lastUpdated = Date.now();
          }
          await this.writeCloudDatabaseState(this.data);
          this.lastSyncedState = cloneDbValue(this.data);
          this.unlockDatabaseGuard();
          console.log("\u2728 Init cloud backup created successfully.");
        } catch (err) {
          handleFirestoreError(err, "write" /* WRITE */, "system/database");
          if (firestoreQuotaExceeded && !MIRAS_ALLOW_LOCAL_ONLY_MODE) {
            this.lockDatabaseGuard(
              "Initial Firestore write failed because quota is exhausted. Cloud durability is blocked until Firestore quota/billing is fixed."
            );
          }
        }
      }
    } catch (e) {
      console.error("\u26A0\uFE0F Error synchronizing with cloud Firestore state:", e);
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
  cloudDatabaseMetaRef() {
    return dbFS.doc("system/database");
  }
  cloudDatabaseChunkRef(index) {
    return dbFS.doc(
      `system/database/chunks/${String(index).padStart(4, "0")}`
    );
  }
  isChunkedCloudMeta(raw) {
    return String(raw?.storageFormat || "") === MIRAS_CLOUD_STORAGE_FORMAT;
  }
  async cloudStateFromMeta(raw) {
    if (!this.isChunkedCloudMeta(raw)) {
      return this.databaseStateFromCloud(raw);
    }
    const chunkCount = Number(raw?.chunkCount || 0);
    if (!Number.isFinite(chunkCount) || chunkCount < 1 || chunkCount > 250) {
      throw new Error(
        `Invalid chunked Firestore database metadata: chunkCount=${raw?.chunkCount}`
      );
    }
    const chunkSnaps = await Promise.all(
      Array.from(
        { length: chunkCount },
        (_, index) => this.cloudDatabaseChunkRef(index).get()
      )
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
      return this.databaseStateFromCloud(JSON.parse(chunks.join("")));
    } catch (err) {
      throw new Error(`Failed to parse chunked Firestore database payload: ${err?.message || String(err)}`);
    }
  }
  async readCloudDatabaseState() {
    const snap = await this.cloudDatabaseMetaRef().get();
    if (!snap.exists) {
      return { exists: false, state: this.databaseStateFromCloud({}), raw: null };
    }
    const raw = snap.data();
    return {
      exists: true,
      raw,
      state: await this.cloudStateFromMeta(raw)
    };
  }
  async writeCloudDatabaseState(state) {
    if (!dbFS) return;
    const cleaned = cleanUndefined(state);
    const payload = JSON.stringify(cleaned);
    const chunks = [];
    for (let i = 0; i < payload.length; i += MIRAS_CLOUD_CHUNK_SIZE) {
      chunks.push(payload.slice(i, i + MIRAS_CLOUD_CHUNK_SIZE));
    }
    if (!chunks.length) chunks.push("{}");
    const generation = Number(cleaned.lastUpdated || Date.now());
    await Promise.all(
      chunks.map(
        (payloadChunk, index) => this.cloudDatabaseChunkRef(index).set({
          storageFormat: MIRAS_CLOUD_STORAGE_FORMAT,
          generation,
          index,
          chunkCount: chunks.length,
          payload: payloadChunk,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        })
      )
    );
    await this.cloudDatabaseMetaRef().set({
      storageFormat: MIRAS_CLOUD_STORAGE_FORMAT,
      chunkCount: chunks.length,
      payloadLength: payload.length,
      lastUpdated: generation,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      contentCounts: MIRAS_DATABASE_CONTENT_KEYS.reduce((acc, key) => {
        const value = cleaned?.[key];
        acc[key] = Array.isArray(value) ? value.length : 0;
        return acc;
      }, {})
    });
  }
  databaseStateFromCloud(cloudData) {
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
      retiredJoinCodes: cloudData.retiredJoinCodes || [],
      teacherExams: cloudData.teacherExams || [],
      teacherProjects: cloudData.teacherProjects || [],
      teacherSubmissions: cloudData.teacherSubmissions || [],
      sebAttempts: cloudData.sebAttempts || [],
      examSessions: cloudData.examSessions || [],
      passwordResetRequests: cloudData.passwordResetRequests || [],
      activationAttempts: cloudData.activationAttempts || [],
      notificationTokens: cloudData.notificationTokens || [],
      inAppNotifications: cloudData.inAppNotifications || [],
      passkeyCredentials: cloudData.passkeyCredentials || [],
      bookMetadata: cloudData.bookMetadata
    };
  }
  startCloudListener() {
    if (!dbFS || this.cloudUnsubscribe) return;
    this.cloudUnsubscribe = this.cloudDatabaseMetaRef().onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) {
          if (!MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
            this.lockDatabaseGuard(
              "Firestore system/database disappeared while the server was running. Ignored the missing snapshot to avoid replacing the runtime with an empty database."
            );
          }
          return;
        }
        const raw = snapshot.data();
        if (!this.pendingFSSync && Number(raw?.lastUpdated || 0) === this.lastWrittenUpdatedAt) {
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
              currentHasContent ? "Firestore listener received an empty database snapshot. The local runtime still has data, so the empty snapshot was ignored to prevent data loss." : "Firestore listener received an empty database snapshot and the local runtime has no data. The empty state was blocked instead of being saved as the app database."
            );
            return;
          }
          this.unlockDatabaseGuard();
          if (dbValuesEqual(incoming, this.lastSyncedState)) return;
          const incomingStamp = Number(incoming?.lastUpdated || raw?.lastUpdated || 0);
          const localStamp = Number(this.data?.lastUpdated || 0);
          if (!this.pendingFSSync && !this.isSyncingFS && incomingStamp && localStamp && incomingStamp < localStamp) {
            this.pendingFSSync = true;
            this.scheduleCloudSync(false);
            return;
          }
          if (this.pendingFSSync) {
            this.data = mergeCloudThreeWay(
              this.lastSyncedState || {},
              this.data,
              incoming
            );
            this.lastSyncedState = cloneDbValue(incoming);
          } else {
            this.data = incoming;
            this.lastSyncedState = cloneDbValue(incoming);
          }
          this.scheduleLocalSave();
        })().catch((error) => {
          console.error("\u26A0\uFE0F Firestore chunked live synchronization failed:", error);
          if (!MIRAS_ALLOW_LOCAL_ONLY_MODE) {
            this.lockDatabaseGuard(
              `Firestore chunked listener failed: ${error?.message || String(error)}`
            );
          }
        });
      },
      (error) => {
        console.error("\u26A0\uFE0F Firestore live synchronization listener failed:", error);
      }
    );
  }
  load() {
    if (import_fs.default.existsSync(DB_FILE)) {
      try {
        const fileContent = import_fs.default.readFileSync(DB_FILE, "utf-8");
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
          passkeyCredentials: parsed.passkeyCredentials || [],
          bookMetadata: parsed.bookMetadata
        };
      } catch (e) {
        this.loadedEmptyOrInvalidLocalDb = true;
        if (e?.message !== "empty-db-file") {
          console.error("Failed to parse database file. A clean runtime state will be used without being promoted to Firestore automatically.", e);
        } else {
          console.warn("\u26A0\uFE0F data/db.json is empty. Using a clean runtime state only; cloud initialization from this empty file is blocked.");
        }
      }
    }
    const defaultState = {
      lastUpdated: 0,
      // Set to 0 so cloud backup is always preferred initially
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
      passkeyCredentials: []
    };
    return defaultState;
  }
  saveState(state) {
    try {
      const nextHasContent = databaseHasMeaningfulContent(state);
      const existingHasContent = readExistingDbFileHasMeaningfulContent();
      if (!nextHasContent && existingHasContent && !this.allowEmptyDatabaseWriteOnce) {
        console.error(
          "\u{1F6D1} Blocked writing an empty runtime database over a non-empty data/db.json cache. This prevents accidental data loss during development or deployment."
        );
        return;
      }
      import_fs.default.writeFileSync(DB_FILE, JSON.stringify(state), "utf-8");
    } catch (e) {
      console.error("Failed to write to database file", e);
    } finally {
      this.allowEmptyDatabaseWriteOnce = false;
    }
  }
  // كتابة محلية مؤجَّلة ومُجمَّعة: أول تعديل في الدورة يجدول كتابة واحدة عبر
  // setImmediate، وكل تعديل لاحق في نفس الدورة يكتفي برفع علم dirty. النتيجة:
  // كتابة قرص واحدة لكل دفعة بدل N كتابات متزامنة تجمّد حلقة الأحداث.
  scheduleLocalSave() {
    this.dirtyLocal = true;
    if (this.localSaveTimer) return;
    this.localSaveTimer = setImmediate(() => {
      this.localSaveTimer = null;
      this.flushLocalSave();
    });
  }
  // تفريغ متزامن فوري لأي حالة مؤجَّلة (يُستخدم قبل المزامنة وعند إيقاف الخادم).
  flushLocalSave() {
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
  getMutationVersion() {
    return this.mutationVersion;
  }
  async persist(immediate = true) {
    if (this.databaseGuardLocked && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
      console.error(
        `\u{1F6D1} ${MIRAS_DATABASE_GUARD_CODE}: blocked persist while database guard is locked. ${this.databaseGuardReason}`
      );
      return;
    }
    reopenFirestoreSyncIfQuotaCooldownPassed();
    this.mutationVersion += 1;
    this.data.lastUpdated = Math.max(
      Date.now(),
      Number(this.data.lastUpdated || 0) + 1
    );
    this.scheduleLocalSave();
    if (dbFS && !firestoreQuotaExceeded) {
      this.pendingFSSync = true;
      this.scheduleCloudSync(immediate);
    }
  }
  // يجدول كتابة سحابية واحدة لكل نافذة تجميع. كتابة واحدة معلّقة تكفي لأنها ستلتقط
  // أحدث this.data وقت التنفيذ، فلا نعيد الضبط مع كل تعديل (تفادياً للتجويع) ولا
  // نشغّل العمل الثقيل أثناء الطلب نفسه. كتلة finally في performCloudSync تعيد
  // الجدولة تلقائياً إن بقيت تغييرات معلّقة بعد الكتابة.
  scheduleCloudSync(immediate) {
    if (!dbFS || firestoreQuotaExceeded) return;
    if (this.isSyncingFS || this.cloudSyncScheduled || this.persistTimeout) return;
    const sinceLast = Date.now() - this.lastFSSyncTime;
    const delay = immediate ? 0 : Math.max(this.cloudDebounceMS, this.syncIntervalMS - sinceLast);
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
  flushCloudSoon() {
    if (!dbFS || firestoreQuotaExceeded || !this.pendingFSSync) return;
    if (this.isSyncingFS || this.cloudSyncScheduled) return;
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
  async performCloudSync() {
    if (!this.pendingFSSync || firestoreQuotaExceeded || !dbFS) return;
    if (this.isSyncingFS) return;
    let resolver;
    let rejecter;
    this.syncPromise = new Promise((resolve, reject) => {
      resolver = resolve;
      rejecter = reject;
    });
    this.pendingFSSync = false;
    this.isSyncingFS = true;
    this.lastFSSyncTime = Date.now();
    const versionAtStart = this.mutationVersion;
    const baseAtStart = cloneDbValue(this.lastSyncedState || this.data || {});
    const localAtStart = cleanUndefined(cloneDbValue(this.data));
    try {
      let committedPayload = null;
      const cloudRead = await this.readCloudDatabaseState();
      const cloudState = cloudRead.exists ? cloudRead.state : this.databaseStateFromCloud({});
      const localHasContent = databaseHasMeaningfulContent(localAtStart);
      const cloudHasContent = databaseHasMeaningfulContent(cloudState);
      if (!cloudHasContent && !localHasContent && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
        this.lockDatabaseGuard(
          cloudRead.exists ? "Blocked writing an empty runtime over an existing but empty Firestore system/database document." : "Blocked empty write to missing Firestore system/database. Restore backup or explicitly enable empty initialization for a new installation."
        );
        committedPayload = null;
      } else if (!cloudHasContent && localAtStart && !MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD && !MIRAS_ALLOW_EMPTY_FIRESTORE_INIT) {
        this.lockDatabaseGuard(
          cloudRead.exists ? "Blocked local cache from overwriting an existing empty Firestore database document without explicit restore approval." : "Blocked local cache from creating a missing Firestore database document without explicit restore approval."
        );
        committedPayload = null;
      } else if (!cloudHasContent && localHasContent && MIRAS_ALLOW_LOCAL_RESTORE_TO_EMPTY_CLOUD) {
        committedPayload = cleanUndefined(localAtStart);
        await this.writeCloudDatabaseState(committedPayload);
        this.unlockDatabaseGuard();
      } else if (!localHasContent && cloudHasContent) {
        committedPayload = cloudState;
        this.unlockDatabaseGuard();
      } else {
        const merged = mergeCloudThreeWay(
          baseAtStart,
          localAtStart,
          cloudState
        );
        merged.lastUpdated = Math.max(
          Date.now(),
          Number(merged.lastUpdated || 0),
          Number(localAtStart.lastUpdated || 0),
          Number(cloudState.lastUpdated || 0)
        );
        committedPayload = cleanUndefined(merged);
        await this.writeCloudDatabaseState(committedPayload);
        this.unlockDatabaseGuard();
      }
      if (committedPayload) {
        const committedState = this.databaseStateFromCloud(committedPayload);
        const mutationsArrivedDuringSync = this.mutationVersion !== versionAtStart;
        this.data = mutationsArrivedDuringSync ? mergeCloudThreeWay(
          baseAtStart,
          this.data,
          committedState
        ) : committedState;
        this.lastWrittenUpdatedAt = Number(
          committedState?.lastUpdated || 0
        );
        this.lastSyncedState = cloneDbValue(committedState);
        this.scheduleLocalSave();
      }
      if (resolver) resolver();
    } catch (err) {
      const errMsg = err?.message || String(err);
      this.pendingFSSync = true;
      if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("Quota limit exceeded")) {
        firestoreQuotaExceeded = true;
        firestoreQuotaExceededAt = Date.now();
        firestoreQuotaErrorDetail = errMsg;
        console.warn("\u26A0\uFE0F Firestore quota exceeded - Firebase sync is now suspended for this session.");
      } else {
        console.error("\u26A0\uFE0F Cloud Firestore sync transaction failed:", errMsg);
      }
      if (rejecter) rejecter(err);
      throw err;
    } finally {
      this.isSyncingFS = false;
      this.syncPromise = null;
      if (this.mutationVersion !== versionAtStart) this.pendingFSSync = true;
      if (this.pendingFSSync && !this.persistTimeout && !this.cloudSyncScheduled && !firestoreQuotaExceeded) {
        this.scheduleCloudSync(false);
      }
    }
  }
  // Getters
  async saveSubmissionAttachmentArchive(record) {
    const fileId = String(record?.fileId || "").trim();
    const base64 = String(record?.base64 || "");
    if (!fileId || !base64) return false;
    try {
      const archiveDir = import_path.default.join(DATA_DIR, "submission-attachment-archive");
      if (!import_fs.default.existsSync(archiveDir)) import_fs.default.mkdirSync(archiveDir, { recursive: true });
      import_fs.default.writeFileSync(
        import_path.default.join(archiveDir, `${fileId}.json`),
        JSON.stringify({
          fileId,
          originalName: record.originalName || "attachment",
          mimeType: record.mimeType || "application/octet-stream",
          size: Number(record.size || 0),
          storedName: record.storedName || "",
          base64,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        })
      );
    } catch (err) {
      console.warn("\u26A0\uFE0F Failed to write local submission attachment archive:", err);
    }
    if (!dbFS) return true;
    if (firestoreQuotaExceeded) return false;
    const chunkSize = 65e4;
    const chunks = [];
    for (let i = 0; i < base64.length; i += chunkSize) {
      chunks.push(base64.slice(i, i + chunkSize));
    }
    const retryDelaysMs = [0, 400, 900, 1800];
    let lastErr = null;
    for (const delay of retryDelaysMs) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await dbFS.doc(`submissionAttachments/${fileId}`).set(cleanUndefined({
          fileId,
          originalName: record.originalName || "attachment",
          mimeType: record.mimeType || "application/octet-stream",
          size: Number(record.size || 0),
          storedName: record.storedName || "",
          chunkCount: chunks.length,
          chunkSize,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }));
        await Promise.all(
          chunks.map(
            (data, index) => dbFS.doc(`submissionAttachments/${fileId}/chunks/${index}`).set({
              index,
              data
            })
          )
        );
        return true;
      } catch (err) {
        lastErr = err;
      }
    }
    console.warn(
      "\u26A0\uFE0F Failed to write cloud submission attachment archive after retries:",
      lastErr?.message || lastErr
    );
    return false;
  }
  async getSubmissionAttachmentArchive(fileIdValue) {
    const fileId = String(fileIdValue || "").trim();
    if (!fileId) return null;
    try {
      const archivePath = import_path.default.join(DATA_DIR, "submission-attachment-archive", `${fileId}.json`);
      if (import_fs.default.existsSync(archivePath)) {
        const parsed = JSON.parse(import_fs.default.readFileSync(archivePath, "utf-8"));
        const base64 = String(parsed?.base64 || "");
        if (base64) {
          return {
            buffer: Buffer.from(base64, "base64"),
            originalName: String(parsed?.originalName || parsed?.storedName || "attachment"),
            mimeType: String(parsed?.mimeType || "application/octet-stream")
          };
        }
      }
    } catch (err) {
      console.warn("\u26A0\uFE0F Failed to read local submission attachment archive:", err);
    }
    if (!dbFS) return null;
    try {
      const metaSnap = await dbFS.doc(`submissionAttachments/${fileId}`).get();
      if (!metaSnap.exists) return null;
      const meta = metaSnap.data();
      const chunkCount = Math.max(0, Number(meta?.chunkCount || 0));
      if (!chunkCount) return null;
      const chunkSnaps = await Promise.all(
        Array.from(
          { length: chunkCount },
          (_, index) => dbFS.doc(`submissionAttachments/${fileId}/chunks/${index}`).get()
        )
      );
      const base64 = chunkSnaps.map((snap) => snap.exists ? String(snap.data()?.data || "") : "").join("");
      if (!base64) return null;
      return {
        buffer: Buffer.from(base64, "base64"),
        originalName: String(meta?.originalName || meta?.storedName || "attachment"),
        mimeType: String(meta?.mimeType || "application/octet-stream")
      };
    } catch (err) {
      console.warn("\u26A0\uFE0F Failed to read cloud submission attachment archive:", err);
      return null;
    }
  }
  getStudents() {
    return this.data.students;
  }
  getTeachers() {
    if (!this.data.teachers) this.data.teachers = [...initialTeachers];
    else {
      let isDirty = false;
      for (const it of initialTeachers) {
        const existing = this.data.teachers.find((t) => t.id.toLowerCase() === it.id.toLowerCase() || t.email.toLowerCase() === it.email.toLowerCase());
        if (!existing) {
          this.data.teachers.push(it);
          isDirty = true;
        } else {
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
  getSections() {
    return this.data.sections;
  }
  getChapters() {
    return this.data.chapters;
  }
  getQuestionBank() {
    return this.data.questionBank;
  }
  getExercises() {
    return this.data.exercises;
  }
  getExerciseSubmissions() {
    return this.data.exerciseSubmissions;
  }
  getPersonalizedProjects() {
    return this.data.personalizedProjects;
  }
  getQuizSubmissions() {
    return this.data.quizSubmissions;
  }
  getActivityLogs() {
    return this.data.activityLogs;
  }
  getAllowedStudents() {
    return this.data.allowedStudents;
  }
  getOtps() {
    return this.data.otps;
  }
  getBookMetadata() {
    return this.data.bookMetadata;
  }
  getActivationAttempts() {
    if (!this.data.activationAttempts) this.data.activationAttempts = [];
    return this.data.activationAttempts;
  }
  getNotificationTokens() {
    if (!this.data.notificationTokens) this.data.notificationTokens = [];
    return this.data.notificationTokens;
  }
  getPasskeyCredentials() {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    return this.data.passkeyCredentials;
  }
  upsertPasskeyCredential(record) {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    const idx = this.data.passkeyCredentials.findIndex((item) => item.credentialId === record.credentialId);
    if (idx === -1) this.data.passkeyCredentials.unshift(record);
    else this.data.passkeyCredentials[idx] = { ...this.data.passkeyCredentials[idx], ...record, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    this.persist();
  }
  updatePasskeyCredential(credentialId, patch) {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    const idx = this.data.passkeyCredentials.findIndex((item) => item.credentialId === credentialId);
    if (idx !== -1) {
      this.data.passkeyCredentials[idx] = { ...this.data.passkeyCredentials[idx], ...patch, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      this.persist();
    }
  }
  deletePasskeyCredential(credentialId) {
    if (!this.data.passkeyCredentials) this.data.passkeyCredentials = [];
    const before = this.data.passkeyCredentials.length;
    this.data.passkeyCredentials = this.data.passkeyCredentials.filter((item) => item.credentialId !== credentialId);
    const changed = this.data.passkeyCredentials.length !== before;
    if (changed) this.persist();
    return changed;
  }
  getTeacherExams() {
    if (!this.data.teacherExams) this.data.teacherExams = [];
    return this.data.teacherExams;
  }
  getTeacherProjects() {
    if (!this.data.teacherProjects) this.data.teacherProjects = [];
    return this.data.teacherProjects;
  }
  getTeacherSubmissions() {
    if (!this.data.teacherSubmissions) this.data.teacherSubmissions = [];
    return this.data.teacherSubmissions;
  }
  getSebAttempts() {
    if (!this.data.sebAttempts) this.data.sebAttempts = [];
    return this.data.sebAttempts;
  }
  getExamSessions() {
    if (!this.data.examSessions) this.data.examSessions = [];
    return this.data.examSessions;
  }
  getPasswordResetRequests() {
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
  getJoinCodes() {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    return this.data.joinCodes;
  }
  getRetiredJoinCodes() {
    if (!this.data.retiredJoinCodes) this.data.retiredJoinCodes = [];
    return this.data.retiredJoinCodes;
  }
  archiveJoinCodeRecord(item, reason = "course_closed", actorEmail = "system") {
    if (!item || typeof item !== "object") return false;
    if (!this.data.retiredJoinCodes) this.data.retiredJoinCodes = [];
    const key = String(item?.code || "").trim().toUpperCase();
    if (!key) return false;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const archiveMap = /* @__PURE__ */ new Map();
    this.data.retiredJoinCodes.forEach((existing) => {
      const existingKey = String(existing?.code || "").trim().toUpperCase();
      if (existingKey) archiveMap.set(existingKey, existing);
    });
    const archivedItem = {
      ...item,
      status: String(item?.status || "").toLowerCase() === "active" ? "retired" : item?.status || "retired",
      retiredAt: item?.retiredAt || now,
      retiredReason: item?.retiredReason || reason,
      retiredByEmail: item?.retiredByEmail || actorEmail,
      archivedAt: item?.archivedAt || now
    };
    const isNew = !archiveMap.has(key);
    archiveMap.set(key, { ...archiveMap.get(key) || {}, ...archivedItem });
    this.data.retiredJoinCodes = Array.from(archiveMap.values());
    return isNew;
  }
  archiveJoinCodes(reason = "course_closed", actorEmail = "system") {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    let archived = 0;
    this.data.joinCodes.forEach((item) => {
      if (this.archiveJoinCodeRecord(item, reason, actorEmail)) archived += 1;
    });
    return archived;
  }
  exportStateSnapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }
  mergeBackupData(data = {}) {
    const summary = {};
    const normalizeKey = (value) => String(value ?? "").trim().toLowerCase();
    const stableKey = (item, keys, fallbackPrefix, index) => {
      for (const key of keys) {
        const value = normalizeKey(item?.[key]);
        if (value) return value;
      }
      return `${fallbackPrefix}-${Date.now()}-${index}`;
    };
    const mergeArray = (target, incoming, keys, label) => {
      if (!Array.isArray(incoming)) return target;
      const map = /* @__PURE__ */ new Map();
      target.forEach((item, index) => map.set(stableKey(item, keys, label, index), item));
      incoming.filter((item) => item && typeof item === "object").forEach((item, index) => {
        const key = stableKey(item, keys, label, index);
        map.set(key, { ...map.get(key) || {}, ...item });
      });
      summary[label] = incoming.length;
      return Array.from(map.values());
    };
    this.data.sections = mergeArray(this.data.sections, data.teacherSections || data.sections, ["code"], "teacherSections");
    this.data.students = mergeArray(this.data.students, data.teacherStudents || data.students, ["id", "idNumber", "studentId"], "teacherStudents");
    this.data.allowedStudents = mergeArray(this.data.allowedStudents, data.allowedStudentsRows || data.allowedStudents, ["idNumber", "id", "studentId"], "allowedStudents");
    this.data.questionBank = mergeArray(this.data.questionBank, data.teacherQuestions || data.questionBank, ["id"], "teacherQuestions");
    this.data.teacherExams = mergeArray(this.getTeacherExams(), data.teacherCreatedExams || data.teacherExams, ["id"], "teacherCreatedExams");
    this.data.teacherProjects = mergeArray(this.getTeacherProjects(), data.teacherProjects, ["id"], "teacherProjects");
    this.data.teacherSubmissions = mergeArray(this.getTeacherSubmissions(), data.teacherSubmissions, ["id", "submissionId"], "teacherSubmissions");
    this.data.examSessions = mergeArray(this.getExamSessions(), data.examSessions, ["id", "sessionId"], "examSessions");
    this.data.joinCodes = mergeArray(this.getJoinCodes(), data.joinCodesList || data.joinCodes, ["code"], "joinCodesList");
    this.data.retiredJoinCodes = mergeArray(this.getRetiredJoinCodes(), data.retiredJoinCodes || data.archivedJoinCodes || data.codeArchive, ["code"], "retiredJoinCodes");
    this.data.activityLogs = mergeArray(this.data.activityLogs, data.systemLogs || data.activityLogs, ["id", "timestamp"], "systemLogs");
    this.data.passwordResetRequests = mergeArray(this.getPasswordResetRequests(), data.passwordResetRequestsState || data.passwordResetRequests, ["id"], "passwordResetRequestsState");
    this.persist();
    return summary;
  }
  addJoinCode(jc) {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    this.data.joinCodes.push(jc);
    this.persist();
  }
  updateJoinCode(code, updated) {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    const idx = this.data.joinCodes.findIndex((j) => j.code.toUpperCase() === code.toUpperCase());
    if (idx !== -1) {
      this.data.joinCodes[idx] = { ...this.data.joinCodes[idx], ...updated };
      this.persist();
    }
  }
  compareAndUseJoinCode(code, patch) {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    const idx = this.data.joinCodes.findIndex((j) => String(j.code || "").toUpperCase() === String(code || "").toUpperCase());
    if (idx === -1) return { ok: false, reason: "not_found", current: null };
    const current = this.data.joinCodes[idx];
    if (String(current.status || "active").toLowerCase() !== "active") {
      return { ok: false, reason: "not_active", current };
    }
    this.data.joinCodes[idx] = { ...current, ...patch, status: "used" };
    this.persist();
    return { ok: true, current: this.data.joinCodes[idx] };
  }
  deleteJoinCode(code, reason = "manual_code_delete", actorEmail = "system") {
    if (!this.data.joinCodes) this.data.joinCodes = [];
    const normalizedCode = String(code || "").toUpperCase();
    const found = this.data.joinCodes.find((j) => String(j.code || "").toUpperCase() === normalizedCode);
    if (found) this.archiveJoinCodeRecord(found, reason, actorEmail);
    this.data.joinCodes = this.data.joinCodes.filter((j) => String(j.code || "").toUpperCase() !== normalizedCode);
    this.persist();
  }
  upsertTeacherExam(exam) {
    if (!this.data.teacherExams) this.data.teacherExams = [];
    const idx = this.data.teacherExams.findIndex((e) => e.id === exam.id);
    if (idx === -1) this.data.teacherExams.unshift(exam);
    else this.data.teacherExams[idx] = { ...this.data.teacherExams[idx], ...exam };
    this.persist();
  }
  deleteTeacherExam(id) {
    if (!this.data.teacherExams) this.data.teacherExams = [];
    this.data.teacherExams = this.data.teacherExams.filter((e) => e.id !== id);
    this.persist();
  }
  setTeacherExams(exams) {
    this.data.teacherExams = exams;
    this.persist();
  }
  upsertTeacherProject(project) {
    if (!this.data.teacherProjects) this.data.teacherProjects = [];
    const idx = this.data.teacherProjects.findIndex((p) => p.id === project.id);
    if (idx === -1) this.data.teacherProjects.unshift(project);
    else this.data.teacherProjects[idx] = { ...this.data.teacherProjects[idx], ...project };
    this.persist();
  }
  deleteTeacherProject(id) {
    if (!this.data.teacherProjects) this.data.teacherProjects = [];
    this.data.teacherProjects = this.data.teacherProjects.filter((p) => p.id !== id);
    this.persist();
  }
  upsertTeacherSubmission(sub) {
    if (!this.data.teacherSubmissions) this.data.teacherSubmissions = [];
    const idx = this.data.teacherSubmissions.findIndex((s) => s.id === sub.id);
    if (idx === -1) this.data.teacherSubmissions.unshift(sub);
    else this.data.teacherSubmissions[idx] = { ...this.data.teacherSubmissions[idx], ...sub };
    this.persist();
  }
  removeTeacherSubmissionsFor(kind, activityId) {
    if (!this.data.teacherSubmissions) this.data.teacherSubmissions = [];
    const beforeLen = this.data.teacherSubmissions.length;
    this.data.teacherSubmissions = this.data.teacherSubmissions.filter((s) => !(s.kind === kind && String(s.activityId) === String(activityId)));
    if (this.data.teacherSubmissions.length !== beforeLen) this.persist();
  }
  removeQuizSubmissionsForChapter(chapterId) {
    if (!this.data.quizSubmissions) this.data.quizSubmissions = [];
    const beforeLen = this.data.quizSubmissions.length;
    this.data.quizSubmissions = this.data.quizSubmissions.filter((s) => String(s.chapterId) !== String(chapterId));
    if (this.data.quizSubmissions.length !== beforeLen) this.persist();
  }
  setSebAttempts(attempts) {
    this.data.sebAttempts = attempts;
    this.persist();
  }
  upsertExamSession(session) {
    if (!this.data.examSessions) this.data.examSessions = [];
    const idx = this.data.examSessions.findIndex(
      (item) => item.id === session.id || item.sessionId === session.sessionId
    );
    if (idx !== -1) {
      const currentStatus = String(this.data.examSessions[idx]?.status || "");
      const incomingStatus = String(session?.status || "");
      const terminalStatuses = /* @__PURE__ */ new Set(["finished", "violated", "expired"]);
      if (terminalStatuses.has(currentStatus) && incomingStatus === "active") {
        return;
      }
    }
    const saved = { ...session, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    if (idx === -1) this.data.examSessions.unshift(saved);
    else this.data.examSessions[idx] = { ...this.data.examSessions[idx], ...saved };
    if (this.data.examSessions.length > 500) this.data.examSessions.length = 500;
    this.persist();
  }
  addPasswordResetRequest(req) {
    if (!this.data.passwordResetRequests) this.data.passwordResetRequests = [];
    this.data.passwordResetRequests.unshift(req);
    this.persist();
  }
  updatePasswordResetRequest(id, updated) {
    if (!this.data.passwordResetRequests) this.data.passwordResetRequests = [];
    const index = this.data.passwordResetRequests.findIndex((req) => req.id === id);
    if (index !== -1) {
      this.data.passwordResetRequests[index] = { ...this.data.passwordResetRequests[index], ...updated };
      this.persist();
    }
  }
  deletePasswordResetRequest(id) {
    if (!this.data.passwordResetRequests) this.data.passwordResetRequests = [];
    this.data.passwordResetRequests = this.data.passwordResetRequests.filter((req) => req.id !== id);
    this.persist();
  }
  addActivationAttempt(attempt) {
    if (!this.data.activationAttempts) this.data.activationAttempts = [];
    this.data.activationAttempts.unshift(attempt);
    if (this.data.activationAttempts.length > 1200) this.data.activationAttempts.length = 1200;
    this.persist();
  }
  updateActivationAttempt(id, updated) {
    if (!this.data.activationAttempts) this.data.activationAttempts = [];
    const idx = this.data.activationAttempts.findIndex((attempt) => String(attempt.id || "") === String(id || ""));
    if (idx !== -1) {
      this.data.activationAttempts[idx] = { ...this.data.activationAttempts[idx], ...updated };
      this.persist();
    }
  }
  upsertNotificationToken(token) {
    if (!this.data.notificationTokens) this.data.notificationTokens = [];
    this.data.notificationTokens = this.data.notificationTokens.filter((existing) => existing.token !== token.token);
    this.data.notificationTokens.unshift(token);
    this.persist();
  }
  disableNotificationToken(token, userId) {
    if (!this.data.notificationTokens) this.data.notificationTokens = [];
    const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.data.notificationTokens = this.data.notificationTokens.map((item) => {
      if (item.token === token && (!userId || item.userId === userId)) {
        return { ...item, disabledAt: updatedAt, updatedAt };
      }
      return item;
    });
    this.persist();
  }
  // Setters/Prunes
  setBookMetadata(meta) {
    this.data.bookMetadata = meta;
    this.persist();
  }
  setChapters(chapters) {
    this.data.chapters = chapters;
    this.persist();
  }
  setQuestionBank(questionBank) {
    this.data.questionBank = questionBank;
    this.persist();
  }
  addAllowedStudent(student) {
    const nextId = normalizeDbStudentId(student.idNumber);
    const nextSection = String(student.sectionCode || "").trim().toLowerCase();
    const idx = this.data.allowedStudents.findIndex(
      (s) => normalizeDbStudentId(s.idNumber) === nextId && String(s.sectionCode || "").trim().toLowerCase() === nextSection
    );
    if (idx === -1) {
      this.data.allowedStudents.push(student);
    } else {
      this.data.allowedStudents[idx] = student;
    }
    this.persist();
  }
  clearAllowedStudentsBySection(sectionCode) {
    this.data.allowedStudents = this.data.allowedStudents.filter((s) => s.sectionCode !== sectionCode);
    this.persist();
  }
  clearAllAllowedStudents() {
    this.data.allowedStudents = [];
    this.persist();
  }
  addSection(section) {
    this.data.sections.push(section);
    this.persist();
  }
  updateSection(code, updated) {
    const sec = this.data.sections.find((s) => s.code === code);
    if (sec) {
      Object.assign(sec, updated);
      this.persist();
    }
  }
  deleteSection(code) {
    this.data.sections = this.data.sections.filter((s) => s.code.toUpperCase() !== String(code).toUpperCase());
    this.persist();
  }
  addQuestion(question) {
    this.data.questionBank.push(question);
    this.persist();
  }
  updateQuestion(id, updated) {
    const index = this.data.questionBank.findIndex((q) => q.id === id);
    if (index !== -1) {
      this.data.questionBank[index] = { ...this.data.questionBank[index], ...updated };
      this.persist();
    }
  }
  deleteQuestion(id) {
    this.data.questionBank = this.data.questionBank.filter((q) => q.id !== id);
    this.persist();
  }
  addStudent(student) {
    const nextId = normalizeDbStudentId(student.id);
    const nextEmail = normalizeDbEmail(student.email);
    const duplicateId = this.data.students.find((s) => normalizeDbStudentId(s.id) === nextId);
    if (duplicateId) {
      throw new Error("DUPLICATE_STUDENT_ID");
    }
    const duplicateEmail = nextEmail ? this.data.students.find((s) => normalizeDbEmail(s.email) === nextEmail) : null;
    if (duplicateEmail) {
      throw new Error("DUPLICATE_STUDENT_EMAIL");
    }
    this.data.students.push(student);
    this.persist();
  }
  updateStudent(id, updated) {
    const index = this.data.students.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.data.students[index] = { ...this.data.students[index], ...updated };
      this.persist();
    }
  }
  deleteStudentDataCompletely(studentId) {
    const nextId = normalizeDbStudentId(studentId);
    if (!nextId) return;
    this.data.students = this.data.students.filter((s) => normalizeDbStudentId(s.id) !== nextId);
    this.data.joinCodes.forEach((jc) => {
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
    this.data.activityLogs = this.data.activityLogs.filter((log) => normalizeDbStudentId(log.studentId || "") !== nextId);
    this.persist();
  }
  addOtp(email, code) {
    const expiresAt = Date.now() + 10 * 60 * 1e3;
    this.data.otps = this.data.otps.filter((o) => o.email !== email);
    this.data.otps.push({ email, code, expiresAt });
    this.persist();
  }
  verifyOtp(email, code) {
    const otpIndex = this.data.otps.findIndex((o) => o.email === email && o.code === code && o.expiresAt > Date.now());
    if (otpIndex !== -1) {
      this.data.otps.splice(otpIndex, 1);
      this.persist();
      return true;
    }
    return false;
  }
  addWeeklyExercise(exercise) {
    this.data.exercises.push(exercise);
    this.persist();
  }
  addExerciseSubmission(sub) {
    this.data.exerciseSubmissions.push(sub);
    this.persist();
  }
  updateExerciseSubmission(id, updated) {
    const index = this.data.exerciseSubmissions.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.data.exerciseSubmissions[index] = { ...this.data.exerciseSubmissions[index], ...updated };
      this.persist();
    }
  }
  addPersonalizedProject(proj) {
    this.data.personalizedProjects = this.data.personalizedProjects.filter((p) => !(p.studentId === proj.studentId && p.status === "none"));
    this.data.personalizedProjects.push(proj);
    this.persist();
  }
  updatePersonalizedProject(id, updated) {
    const index = this.data.personalizedProjects.findIndex((p) => p.id === id);
    if (index !== -1) {
      this.data.personalizedProjects[index] = { ...this.data.personalizedProjects[index], ...updated };
      this.persist();
    }
  }
  addQuizSubmission(sub) {
    this.data.quizSubmissions.push(sub);
    this.persist();
  }
  updateQuizSubmission(id, updated) {
    const index = this.data.quizSubmissions.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.data.quizSubmissions[index] = { ...this.data.quizSubmissions[index], ...updated };
      this.persist();
    }
  }
  addActivityLog(log) {
    const id = "log-" + Math.random().toString(36).substring(2, 9);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    this.data.activityLogs.unshift({ id, timestamp, ...log });
    if (this.data.activityLogs.length > 1e3) {
      this.data.activityLogs.pop();
    }
    this.persist(false);
  }
  getInAppNotifications() {
    if (!this.data.inAppNotifications) this.data.inAppNotifications = [];
    return this.data.inAppNotifications;
  }
  addInAppNotification(item) {
    if (!this.data.inAppNotifications) this.data.inAppNotifications = [];
    this.data.inAppNotifications.unshift(item);
    if (this.data.inAppNotifications.length > 200) {
      this.data.inAppNotifications.length = 200;
    }
    this.persist(false);
  }
  cleanseTeacherStudentData(studentIds = [], teacherEmail = "") {
    const owner = String(teacherEmail || "").trim().toLowerCase();
    const normalizeId = (value) => normalizeDbStudentId(value);
    const normalizeEmail = (value) => normalizeDbEmail(value);
    const ownedCodes = /* @__PURE__ */ new Set();
    const addCode = (value) => {
      const code = String(value || "").trim();
      if (code) ownedCodes.add(code.toLowerCase());
    };
    const ownerFromCode = (code) => {
      const raw = String(code || "").trim();
      const match = raw.match(/__([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})$/i);
      return normalizeEmail(match?.[1] || "");
    };
    const recordOwner = (record) => normalizeEmail(
      record?.teacherEmail || record?.ownerEmail || record?.createdByEmail || record?.actorEmail || ownerFromCode(record?.courseCode || record?.sectionCode || record?.studentSection || record?.code)
    );
    const codeBelongsToTeacher = (code) => {
      const normalized = String(code || "").trim().toLowerCase();
      if (!normalized) return false;
      if (ownedCodes.has(normalized)) return true;
      return ownerFromCode(code) === owner;
    };
    const recordBelongsToTeacher = (record) => {
      if (!record) return false;
      const recOwner = recordOwner(record);
      if (recOwner && recOwner === owner) return true;
      return [record.courseCode, record.sectionCode, record.studentSection, record.code].some(codeBelongsToTeacher);
    };
    this.data.sections.forEach((section) => {
      if (recordOwner(section) === owner) addCode(section.code);
    });
    this.data.allowedStudents.forEach((row) => {
      if (recordOwner(row) === owner) addCode(row.sectionCode || row.studentSection || row.courseCode);
    });
    (this.data.joinCodes || []).forEach((jc) => {
      if (recordOwner(jc) === owner) addCode(jc.sectionCode || jc.studentSection || jc.courseCode);
    });
    (this.data.teacherExams || []).forEach((exam) => {
      if (recordBelongsToTeacher(exam)) addCode(exam.courseCode || exam.sectionCode || exam.studentSection);
    });
    (this.data.teacherProjects || []).forEach((project) => {
      if (recordBelongsToTeacher(project)) addCode(project.courseCode || project.sectionCode || project.studentSection);
    });
    const explicitStudentIds = new Set((studentIds || []).map(normalizeId).filter(Boolean));
    const affectedStudentIds = new Set(explicitStudentIds);
    const studentCourseCodes = (student) => {
      const codes = [];
      const add = (value) => {
        const code = String(value || "").trim();
        if (code && !codes.some((old) => old.toLowerCase() === code.toLowerCase())) codes.push(code);
      };
      add(student?.sectionCode);
      add(student?.studentSection);
      (Array.isArray(student?.activatedCourseCodes) ? student.activatedCourseCodes : []).forEach(add);
      (Array.isArray(student?.enrollments) ? student.enrollments : []).forEach(
        (entry) => add(entry?.courseCode || entry?.sectionCode || entry?.studentSection)
      );
      return codes;
    };
    this.data.students.forEach((student) => {
      const sid = normalizeId(student?.id);
      if (!sid) return;
      if (studentCourseCodes(student).some(codeBelongsToTeacher)) affectedStudentIds.add(sid);
    });
    this.data.allowedStudents.forEach((row) => {
      if (recordBelongsToTeacher(row)) {
        const sid = normalizeId(row.idNumber || row.id || row.studentId);
        if (sid) affectedStudentIds.add(sid);
      }
    });
    const removeFrom = (key, predicate) => {
      const list = Array.isArray(this.data[key]) ? this.data[key] : [];
      const before = list.length;
      this.data[key] = list.filter((item) => !predicate(item));
      return before - this.data[key].length;
    };
    const ownedChapterIds = new Set(
      (this.data.chapters || []).filter((chapter) => recordBelongsToTeacher(chapter)).map((chapter) => String(chapter.id || "")).filter(Boolean)
    );
    const beforeStudents = this.data.students.length;
    let trimmedStudents = 0;
    this.data.students = this.data.students.map((student) => {
      const sid = normalizeId(student?.id);
      if (!affectedStudentIds.has(sid)) return student;
      const codes = studentCourseCodes(student);
      const remainingCodes = codes.filter((code) => !codeBelongsToTeacher(code));
      if (!remainingCodes.length) return null;
      trimmedStudents += 1;
      const remainingEnrollments = Array.isArray(student.enrollments) ? student.enrollments.filter((entry) => !codeBelongsToTeacher(entry?.courseCode || entry?.sectionCode || entry?.studentSection)) : [];
      const remainingActivated = Array.isArray(student.activatedCourseCodes) ? student.activatedCourseCodes.filter((code) => !codeBelongsToTeacher(code)) : [];
      const nextPrimary = remainingCodes[0] || "";
      return {
        ...student,
        sectionCode: nextPrimary,
        studentSection: nextPrimary,
        activatedCourseCodes: remainingActivated,
        enrollments: remainingEnrollments,
        courseVisibilitySyncedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }).filter(Boolean);
    const removedStudents = beforeStudents - this.data.students.length;
    const studentAndTeacherRecord = (item) => {
      const sid = normalizeId(item?.studentId || item?.studentIdNumber || item?.idNumber || item?.id || item?.linkedStudentId);
      return sid && affectedStudentIds.has(sid) && recordBelongsToTeacher(item) || recordBelongsToTeacher(item);
    };
    let removedOperations = 0;
    const removedSections = removeFrom("sections", recordBelongsToTeacher);
    const removedChapters = removeFrom("chapters", (item) => recordBelongsToTeacher(item) || ownedChapterIds.has(String(item?.id || "")));
    const removedQuestions = removeFrom("questionBank", (item) => recordBelongsToTeacher(item) || ownedChapterIds.has(String(item?.chapterId || "")));
    const removedExercises = removeFrom("exercises", (item) => recordBelongsToTeacher(item) || ownedChapterIds.has(String(item?.chapterId || "")));
    const removedTeacherExams = removeFrom("teacherExams", recordBelongsToTeacher);
    const removedTeacherProjects = removeFrom("teacherProjects", recordBelongsToTeacher);
    removedOperations += removeFrom("exerciseSubmissions", studentAndTeacherRecord);
    removedOperations += removeFrom("quizSubmissions", studentAndTeacherRecord);
    removedOperations += removeFrom("personalizedProjects", studentAndTeacherRecord);
    removedOperations += removeFrom("teacherSubmissions", studentAndTeacherRecord);
    removedOperations += removeFrom("sebAttempts", studentAndTeacherRecord);
    removedOperations += removeFrom("activationAttempts", studentAndTeacherRecord);
    removedOperations += removeFrom("passwordResetRequests", (item) => {
      const sid = normalizeId(item?.studentId || item?.idNumber);
      return !!sid && affectedStudentIds.has(sid);
    });
    removedOperations += removeFrom("activityLogs", (item) => {
      const sid = normalizeId(item?.studentId || item?.studentIdNumber || item?.idNumber);
      return sid && affectedStudentIds.has(sid) && recordBelongsToTeacher(item) || recordBelongsToTeacher(item);
    });
    const removedRosterRows = removeFrom("allowedStudents", recordBelongsToTeacher);
    removedOperations += removedRosterRows;
    removedOperations += removeFrom("inAppNotifications", (item) => {
      const sid = normalizeId(item?.studentId || item?.data?.studentId || item?.userId || item?.data?.userId);
      return sid && affectedStudentIds.has(sid) && (recordBelongsToTeacher(item) || codeBelongsToTeacher(item?.sectionCode || item?.data?.courseCode)) || recordBelongsToTeacher(item);
    });
    removedOperations += removeFrom("notificationTokens", (item) => {
      const sid = normalizeId(item?.userId);
      return item?.role === "student" && sid && affectedStudentIds.has(sid) && codeBelongsToTeacher(item?.sectionCode);
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
      ownedCourseCodes: Array.from(ownedCodes)
    };
  }
  customReset(actorEmail = "system") {
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
  fullReset(actorEmail = "system") {
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
      (item) => String(item?.role || "") === "teacher"
    );
    this.data.bookMetadata = void 0;
    this.allowEmptyDatabaseWriteOnce = true;
    this.persist();
  }
};
var dbInstance = new LocalDatabase();
var shuttingDownDb = false;
process.on("exit", () => {
  try {
    dbInstance.flushLocalSave();
  } catch {
  }
});
var gracefulDbShutdown = (signal) => {
  if (shuttingDownDb) return;
  shuttingDownDb = true;
  try {
    dbInstance.flushLocalSave();
  } catch {
  }
  const finish = () => process.exit(0);
  const timer = setTimeout(finish, 3e3);
  Promise.resolve(dbInstance.waitForSync()).catch(() => {
  }).finally(() => {
    clearTimeout(timer);
    finish();
  });
};
process.on("SIGINT", () => gracefulDbShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulDbShutdown("SIGTERM"));

// server.ts
import_dotenv2.default.config();
var aiInstance = process.env.GEMINI_API_KEY ? new import_genai.GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
}) : null;
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT || 3e3);
var PASSKEY_RP_NAME = "\u0645\u0650\u0631\u0627\u0633";
var pendingPasskeyRegistrations = /* @__PURE__ */ new Map();
var pendingPasskeyAuthentications = /* @__PURE__ */ new Map();
var PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1e3;
var MIRAS_SESSION_COOKIE = "miras_session";
var MIRAS_DEVICE_COOKIE = "miras_device_secret";
var MIRAS_SESSION_SECRET = process.env.MIRAS_SESSION_SECRET || import_crypto.default.createHash("sha256").update(`miras-local-${process.cwd()}`).digest("hex");
var MIRAS_SESSION_TTL_MS = 1e3 * 60 * 60 * 24 * 14;
function base64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}
function base64urlDecode(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}
function signMirasPayload(payload) {
  return import_crypto.default.createHmac("sha256", MIRAS_SESSION_SECRET).update(payload).digest("base64url");
}
function hashMirasValue(value) {
  return import_crypto.default.createHash("sha256").update(String(value || "")).digest("hex");
}
function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}
function cookieOptions(req, maxAgeSeconds = 60 * 60 * 24 * 14) {
  const secure = String(req.headers["x-forwarded-proto"] || req.protocol || "").includes("https");
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}
function ensureDeviceSecretCookie(req, res) {
  const requestExisting = String(req.mirasDeviceSecret || "").trim();
  if (requestExisting && requestExisting.length >= 24) return requestExisting;
  const cookies = parseCookies(req);
  const existing = String(cookies[MIRAS_DEVICE_COOKIE] || "").trim();
  if (existing && existing.length >= 24) {
    req.mirasDeviceSecret = existing;
    return existing;
  }
  const secret = import_crypto.default.randomBytes(32).toString("base64url");
  req.mirasDeviceSecret = secret;
  res.append("Set-Cookie", `${MIRAS_DEVICE_COOKIE}=${encodeURIComponent(secret)}; ${cookieOptions(req, 60 * 60 * 24 * 365)}`);
  return secret;
}
function getDeviceSecretCookie(req) {
  return String(req.mirasDeviceSecret || parseCookies(req)[MIRAS_DEVICE_COOKIE] || "").trim();
}
function serverBoundDeviceHash(req, rawDeviceToken) {
  const secret = getDeviceSecretCookie(req);
  const raw = String(rawDeviceToken || "").trim();
  if (!secret || !raw) return "";
  return hashMirasValue(`${secret}:${raw}`);
}
function createMirasSessionToken(session) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (session.ttlMs || MIRAS_SESSION_TTL_MS);
  const payload = base64urlEncode(JSON.stringify({
    role: session.role,
    userId: String(session.userId || ""),
    email: session.email ? String(session.email).toLowerCase() : void 0,
    deviceTokenHash: session.deviceTokenHash || void 0,
    issuedAt,
    expiresAt
  }));
  return `${payload}.${signMirasPayload(payload)}`;
}
function readBearerToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(parseCookies(req)[MIRAS_SESSION_COOKIE] || "").trim();
}
function verifyMirasSessionToken(req) {
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
      console.warn(`[AUTH_DEBUG] Token expired at ${new Date(Number(parsed.expiresAt || 0)).toISOString()} (current time: ${(/* @__PURE__ */ new Date()).toISOString()})`);
      return null;
    }
    const role = String(parsed.role || "");
    if (!["student", "teacher", "admin"].includes(role)) {
      console.warn(`[AUTH_DEBUG] Invalid role in token: ${role}`);
      return null;
    }
    return {
      role,
      userId: String(parsed.userId || ""),
      email: parsed.email ? String(parsed.email).toLowerCase() : void 0,
      deviceTokenHash: parsed.deviceTokenHash || void 0,
      issuedAt: Number(parsed.issuedAt || 0),
      expiresAt: Number(parsed.expiresAt || 0)
    };
  } catch (err) {
    console.warn(`[AUTH_DEBUG] Exception during token verification: ${err?.message || err}`);
    return null;
  }
}
function attachMirasSessionCookie(req, res, token) {
  if (!token) return;
  res.append("Set-Cookie", `${MIRAS_SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieOptions(req)}`);
}
function createTeacherAuthPayload(req, res, teacher) {
  const rawDevice = getRequestDeviceToken(req);
  ensureDeviceSecretCookie(req, res);
  const authToken = createMirasSessionToken({
    role: isAdminEmail(teacher?.email) ? "admin" : "teacher",
    userId: String(teacher?.email || teacher?.id || "").toLowerCase(),
    email: String(teacher?.email || "").toLowerCase(),
    deviceTokenHash: rawDevice ? hashMirasValue(rawDevice) : void 0
  });
  attachMirasSessionCookie(req, res, authToken);
  return authToken;
}
function createStudentAuthPayload(req, res, student) {
  const rawDevice = getRequestDeviceToken(req);
  ensureDeviceSecretCookie(req, res);
  const authToken = createMirasSessionToken({
    role: "student",
    userId: String(student?.id || ""),
    email: student?.email ? String(student.email).toLowerCase() : void 0,
    deviceTokenHash: rawDevice ? hashMirasValue(rawDevice) : void 0
  });
  attachMirasSessionCookie(req, res, authToken);
  return authToken;
}
function verifiedTeacherEmailFromSession(req) {
  const session = verifyMirasSessionToken(req);
  if (!session) return "";
  if (session.role !== "teacher" && session.role !== "admin") return "";
  return String(session.email || session.userId || "").trim().toLowerCase();
}
function normalizeArabicIndicDigits(value) {
  return String(value || "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 1632 && code <= 1641) return String(code - 1632);
    if (code >= 1776 && code <= 1785) return String(code - 1776);
    return ch;
  });
}
function normalizeDigitsDeep(value) {
  if (typeof value === "string") return normalizeArabicIndicDigits(value);
  if (Array.isArray(value)) return value.map((item) => normalizeDigitsDeep(item));
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = normalizeDigitsDeep(value[key]);
  }
  return value;
}
function getRequestOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (origin) return origin;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}
function getPasskeyRpId(req) {
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
function passkeyUserHandle(role, userId) {
  return Buffer.from(`${role}:${userId}`, "utf-8");
}
function findPasskeyUser(role, userId) {
  const id = String(userId || "").trim();
  if (role === "teacher") {
    const teacher = dbInstance.getTeachers().find(
      (t) => t.email.toLowerCase() === id.toLowerCase() || t.id.toLowerCase() === id.toLowerCase()
    );
    return teacher && teacher.isActive ? { role, id: teacher.email, name: teacher.name, raw: teacher } : null;
  }
  const student = dbInstance.getStudents().find((s) => s.id === id || s.email?.toLowerCase() === id.toLowerCase());
  return student ? { role, id: student.id, name: student.name, raw: student } : null;
}
function credentialForVerification(saved) {
  return {
    id: saved.credentialId,
    publicKey: new Uint8Array(saved.publicKey || []),
    counter: Number(saved.counter || 0),
    transports: saved.transports || void 0
  };
}
function responseForPasskeyUser(req, saved, user) {
  if (saved.role === "teacher") {
    const teacher = user.raw;
    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: "\u062F\u062E\u0648\u0644 \u0623\u0633\u062A\u0627\u0630 \u0628\u0627\u0644\u0628\u0635\u0645\u0629",
      details: `\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 ${teacher.email} \u0639\u0628\u0631 Passkey/Face ID`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u062A\u0635\u0641\u062D",
      browser: "Passkey",
      isViolationWarning: false
    });
    return {
      success: true,
      role: "teacher",
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        role: teacher.role
      }
    };
  }
  const student = user.raw;
  if (student.isAccessBlocked) {
    const err = new Error(
      student.accessBlockReason || "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0624\u0642\u062A\u0627\u064B \u0645\u0646 \u0642\u0628\u0644 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
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
      action: "\u0627\u0646\u062A\u0647\u0627\u0643 \u0627\u0644\u0623\u062C\u0647\u0632\u0629",
      details: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629 \u0645\u0646 \u062C\u0647\u0627\u0632 \u063A\u064A\u0631 \u0645\u0635\u0631\u062D \u0628\u0647",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u062C\u0647\u0648\u0644",
      browser: "Passkey",
      isViolationWarning: true
    });
    notifyTeachersForSection(
      student.sectionCode,
      "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629 \u0645\u0631\u0641\u0648\u0636\u0629",
      `${student.name}: ${sessionValidation.error || "\u0645\u062E\u0627\u0644\u0641\u0629 \u0623\u062C\u0647\u0632\u0629"}`,
      { type: "login_blocked", studentId: student.id, link: "/" }
    );
    const err = new Error(
      sessionValidation.error || "\u0627\u0644\u062C\u0647\u0627\u0632 \u063A\u064A\u0631 \u0645\u0635\u0631\u062D \u0644\u0647."
    );
    err.statusCode = sessionValidation.statusCode || 403;
    throw err;
  }
  if (!sessionValidation.isValid && sebLoginPass) consumeSebPass(sebLoginPass);
  dbInstance.updateStudent(student.id, {
    lastLoginDate: (/* @__PURE__ */ new Date()).toISOString()
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629",
    details: "\u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0646\u0627\u062C\u062D \u0639\u0628\u0631 Passkey/Face ID \u0645\u0639 \u0628\u0642\u0627\u0621 \u0642\u0641\u0644 \u0627\u0644\u0623\u062C\u0647\u0632\u0629 \u0641\u0639\u0627\u0644\u0627\u064B",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0645\u0643\u062A\u0634\u0641 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B",
    browser: "Passkey",
    isViolationWarning: false
  });
  const responseStudent = sebLoginPass ? {
    ...student,
    sectionCode: sebLoginPass.courseCode,
    activeSebExamId: sebLoginPass.examId,
    enrollments: getStudentEnrollmentDetails(student)
  } : { ...student, enrollments: getStudentEnrollmentDetails(student) };
  return {
    success: true,
    student: responseStudent,
    sebSession: describeSebPass(sebLoginPass || null)
  };
}
function passkeyDeviceLabel(item) {
  const ua = String(item.userAgent || "");
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  return item.deviceType || "Passkey";
}
var sebAttemptsStorePath = import_path2.default.join(
  process.cwd(),
  ".miras-seb-attempts.json"
);
var liveContentRevision = Date.now();
function bumpLiveContentRevision() {
  liveContentRevision = Date.now();
  return liveContentRevision;
}
var EXAM_IN_PROGRESS_STATUS = "\u062F\u062E\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 - \u0642\u064A\u062F \u0627\u0644\u062D\u0644 \u0627\u0644\u0622\u0646";
var EXAM_EXITED_BEFORE_SUBMIT_STATUS = "\u062E\u0631\u062C \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0642\u0628\u0644 \u0627\u0644\u062A\u0633\u0644\u064A\u0645";
var EXAM_WITHDRAWN_STATUS = "\u0627\u0646\u0633\u062D\u0627\u0628 \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631";
var EXAM_CHEATING_ATTEMPT_STATUS = "\u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634";
var EXAM_SUBMITTED_STATUS = "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0627\u062A";
var EXAM_GRADED_STATUS = "\u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629";
var EXAM_TIME_EXPIRED_STATUS = "\u0627\u0646\u062A\u0647\u0649 \u0627\u0644\u0648\u0642\u062A";
var EXAM_RETURNED_STATUS = "\u0645\u0639\u0627\u062F \u0644\u0644\u0637\u0627\u0644\u0628";
function isProtectedFinalExamStatus(row) {
  const s = String(row?.status || "").trim();
  if (isReturnedSubmissionStatusServer(s)) return false;
  const terminalText = [
    row?.terminalStatus,
    row?.sessionStatus,
    row?.attemptStatus,
    row?.finishReason,
    row?.exitReason
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  return s === EXAM_CHEATING_ATTEMPT_STATUS || s === EXAM_WITHDRAWN_STATUS || s === EXAM_EXITED_BEFORE_SUBMIT_STATUS || s === EXAM_TIME_EXPIRED_STATUS || s === EXAM_GRADED_STATUS || s === EXAM_SUBMITTED_STATUS || s === "\u062F\u0631\u062C\u0629 \u0645\u0639\u062A\u0645\u062F\u0629" || /\b(?:cheating|violation|violated|expelled|exited|withdrawn|finished|completed|submitted)\b/.test(
    terminalText
  ) || terminalText.includes("landscape_orientation") || terminalText.includes("orientation_violation") || row?.teacherGradeOverride === true && String(row?.grade ?? row?.visibleGrade ?? "").trim() !== "";
}
function normalizedExamExitReason(reason) {
  const text = String(reason || "").trim().toLowerCase();
  if (text.includes("landscape") || text.includes("orientation") || text.includes("\u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0639\u0631\u0636\u064A") || text.includes("\u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u062C\u0647\u0627\u0632") || text.includes("\u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u0634\u0627\u0634\u0629") || text.includes("\u062A\u063A\u064A\u064A\u0631 \u0627\u062A\u062C\u0627\u0647")) {
    return "landscape_orientation";
  }
  return text ? "integrity_violation" : "violation";
}
function isReturnedSubmissionStatusServer(status) {
  const text = String(status || "").trim().toLowerCase();
  return ["\u0645\u0639\u0627\u062F \u0644\u0644\u0637\u0627\u0644\u0628", "\u0645\u0639\u0627\u062F \u0644\u0643", "returned", "return", "reopened"].includes(
    text
  );
}
function isCheatingAttemptSubmissionServer(row) {
  const text = `${row?.status || ""} ${row?.answerText || ""}`;
  return String(row?.status || "").trim() === EXAM_CHEATING_ATTEMPT_STATUS || text.includes("\u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634") || text.includes("\u062D\u0627\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u063A\u0634");
}
var EXAM_LOCK_HEARTBEAT_TIMEOUT_MS = 15 * 1e3;
var EXAM_LOCK_CONFLICT_MESSAGE = "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0641\u062A\u0648\u062D \u0641\u064A \u062C\u0644\u0633\u0629 \u0623\u062E\u0631\u0649.";
var EXAM_LOCK_CONFLICT_REASON = "\u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0641\u064A \u0623\u0643\u062B\u0631 \u0645\u0646 \u062C\u0644\u0633\u0629 \u0623\u0648 \u062C\u0647\u0627\u0632";
function isExamLockFailure(result) {
  return result.ok === false;
}
function normalizeExamSessionDisplayMode(value) {
  return String(value || "").trim().toLowerCase() === "pwa" ? "pwa" : "browser";
}
function requestExamSessionId(req) {
  return String(
    req.body?.examSessionId || req.body?.sessionId || req.query?.examSessionId || req.query?.sessionId || req.headers["x-miras-exam-session-id"] || ""
  ).trim();
}
function requestExamDisplayMode(req) {
  return normalizeExamSessionDisplayMode(
    req.body?.displayMode || req.query?.displayMode || req.headers["x-miras-display-mode"]
  );
}
function examSessionRecordId(studentId, examId, sessionId) {
  return `exam-session-${String(studentId)}-${String(examId)}-${String(sessionId)}`;
}
function sameExamSessionKey(session, studentId, examId) {
  return String(session?.studentId || "") === String(studentId || "") && String(session?.examId || "") === String(examId || "");
}
function getExamSessionsFor(studentId, examId) {
  return dbInstance.getExamSessions().filter((session) => sameExamSessionKey(session, studentId, examId)).sort(
    (a, b) => new Date(b.updatedAt || b.lastHeartbeatAt || b.startedAt || 0).getTime() - new Date(a.updatedAt || a.lastHeartbeatAt || a.startedAt || 0).getTime()
  );
}
function expireStaleExamSessions(studentId, examId) {
  const now = Date.now();
  dbInstance.getExamSessions().filter(
    (session) => String(session?.status || "") === "active" && (studentId === void 0 || String(session.studentId) === String(studentId)) && (examId === void 0 || String(session.examId) === String(examId))
  ).forEach((session) => {
    const lastBeat = new Date(
      session.lastHeartbeatAt || session.startedAt || 0
    ).getTime();
    if (Number.isFinite(lastBeat) && now - lastBeat <= EXAM_LOCK_HEARTBEAT_TIMEOUT_MS)
      return;
    dbInstance.upsertExamSession({
      ...session,
      status: "expired",
      finishedAt: session.finishedAt || new Date(now).toISOString(),
      finishReason: session.finishReason || "heartbeat-timeout"
    });
  });
}
function activeExamSessionFor(studentId, examId) {
  expireStaleExamSessions(studentId, examId);
  return getExamSessionsFor(studentId, examId).find(
    (session) => String(session.status || "") === "active"
  ) || null;
}
function latestBlockingExamSessionFor(studentId, examId) {
  return getExamSessionsFor(studentId, examId).find(
    (session) => String(session.status || "") === "violated"
  ) || null;
}
function isExamOfficiallyReturnedForLock(examId, studentId) {
  return !!(isExamReturnedForStudent(examId, studentId) || getActiveReturnException("exam", examId, studentId));
}
function recordExamSessionConflict(req, student, exam, activeSession, attemptedSessionId) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const conflict = {
    at: nowIso,
    attemptedSessionId,
    deviceId: getRequestDeviceToken(req) || getRequestDeviceFingerprint(req),
    userAgent: String(req.headers["user-agent"] || "Unknown Browser").slice(
      0,
      220
    ),
    displayMode: requestExamDisplayMode(req),
    ip: req.ip || "127.0.0.1",
    reason: EXAM_LOCK_CONFLICT_REASON
  };
  const previousConflicts = Array.isArray(activeSession.conflictAttempts) ? activeSession.conflictAttempts : [];
  const recentlyLogged = previousConflicts.some(
    (item) => String(item?.attemptedSessionId || "") === attemptedSessionId && Date.now() - new Date(item?.at || 0).getTime() < 5e3
  );
  dbInstance.upsertExamSession({
    ...activeSession,
    conflictAttempts: [...previousConflicts, conflict].slice(-20)
  });
  if (recentlyLogged) return;
  const courseCode = String(exam?.courseCode || student.sectionCode || "");
  const teacherEmail = sectionOwnerEmail(courseCode);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0641\u064A \u062C\u0644\u0633\u0629 \u0623\u062E\u0631\u0649",
    details: `${exam?.title || "\u0627\u062E\u062A\u0628\u0627\u0631"} \u2014 ${EXAM_LOCK_CONFLICT_REASON}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: courseCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: requestExamDisplayMode(req) === "pwa" ? "PWA" : "\u0645\u062A\u0635\u0641\u062D",
    browser: "\u0642\u0641\u0644 \u062C\u0644\u0633\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631",
    isViolationWarning: true
  });
  notifyTeachersForSection(
    courseCode,
    "\u062A\u0646\u0628\u064A\u0647 \u0646\u0632\u0627\u0647\u0629",
    `${student.name} \u062D\u0627\u0648\u0644 \u0641\u062A\u062D ${exam?.title || "\u0627\u062E\u062A\u0628\u0627\u0631"} \u0641\u064A \u062C\u0644\u0633\u0629 \u0623\u062E\u0631\u0649.`,
    {
      type: "exam_warning",
      studentId: student.id,
      examId: String(exam?.id || ""),
      link: "/"
    }
  );
}
function buildExamSessionFromRequest(req, student, exam, sessionId) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const deviceId = String(
    req.body?.deviceId || req.body?.deviceToken || req.query?.deviceId || req.query?.deviceToken || getRequestDeviceToken(req) || getRequestDeviceFingerprint(req)
  ).trim();
  return {
    id: examSessionRecordId(student.id, exam.id, sessionId),
    studentId: student.id,
    examId: String(exam.id),
    sessionId,
    deviceId,
    userAgent: String(req.headers["user-agent"] || "Unknown Browser").slice(
      0,
      220
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
    updatedAt: nowIso
  };
}
function acquireExamLockForRequest(req, student, exam) {
  const requestedSessionId = requestExamSessionId(req) || `srv-${Date.now()}-${import_crypto.default.randomBytes(6).toString("hex")}`;
  const returnedByTeacher = isExamOfficiallyReturnedForLock(exam.id, student.id);
  const violatedSession = latestBlockingExamSessionFor(student.id, exam.id);
  if (violatedSession && !returnedByTeacher) {
    return {
      ok: false,
      status: 409,
      error: "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0628\u0633\u0628\u0628 \u0645\u062E\u0627\u0644\u0641\u0629. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0641\u062A\u062D\u0647 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0625\u0644\u0627 \u0625\u0630\u0627 \u0623\u0639\u0627\u062F\u0647 \u0627\u0644\u0645\u0639\u0644\u0645.",
      reason: "violated"
    };
  }
  const activeSession = activeExamSessionFor(student.id, exam.id);
  if (activeSession) {
    if (String(activeSession.sessionId) !== requestedSessionId) {
      recordExamSessionConflict(
        req,
        student,
        exam,
        activeSession,
        requestedSessionId
      );
      return {
        ok: false,
        status: 409,
        error: EXAM_LOCK_CONFLICT_MESSAGE,
        reason: EXAM_LOCK_CONFLICT_REASON
      };
    }
    const refreshed = {
      ...activeSession,
      lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
      deviceId: String(
        req.body?.deviceId || req.body?.deviceToken || activeSession.deviceId || ""
      ),
      userAgent: String(req.headers["user-agent"] || activeSession.userAgent || "").slice(0, 220),
      displayMode: requestExamDisplayMode(req)
    };
    dbInstance.upsertExamSession(refreshed);
    return { ok: true, session: refreshed };
  }
  const session = buildExamSessionFromRequest(
    req,
    student,
    exam,
    requestedSessionId
  );
  dbInstance.upsertExamSession(session);
  return { ok: true, session };
}
function heartbeatExamLockForRequest(req, student, exam) {
  const sessionId = requestExamSessionId(req);
  if (!sessionId) {
    return { ok: false, status: 400, error: "\u0628\u064A\u0627\u0646\u0627\u062A \u062C\u0644\u0633\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0646\u0627\u0642\u0635\u0629." };
  }
  const activeSession = activeExamSessionFor(student.id, exam.id);
  if (!activeSession) {
    return {
      ok: false,
      status: 409,
      error: "\u0627\u0646\u062A\u0647\u062A \u062C\u0644\u0633\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0623\u0648 \u0627\u0646\u0642\u0637\u0639 \u0627\u062A\u0635\u0627\u0644\u0647\u0627.",
      reason: "expired"
    };
  }
  if (String(activeSession.sessionId) !== sessionId) {
    recordExamSessionConflict(req, student, exam, activeSession, sessionId);
    return {
      ok: false,
      status: 409,
      error: EXAM_LOCK_CONFLICT_MESSAGE,
      reason: EXAM_LOCK_CONFLICT_REASON
    };
  }
  const refreshed = {
    ...activeSession,
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
    deviceId: String(
      req.body?.deviceId || req.body?.deviceToken || activeSession.deviceId || ""
    ),
    userAgent: String(req.headers["user-agent"] || activeSession.userAgent || "").slice(0, 220),
    displayMode: requestExamDisplayMode(req)
  };
  dbInstance.upsertExamSession(refreshed);
  return { ok: true, session: refreshed };
}
function markExamLockStatusForRequest(req, student, exam, status, reason = "") {
  const sessionId = requestExamSessionId(req);
  if (!sessionId) return null;
  const session = getExamSessionsFor(student.id, exam.id).find(
    (item) => String(item.sessionId) === sessionId
  );
  if (!session) return null;
  const updated = {
    ...session,
    status,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    finishReason: status === "violated" ? normalizedExamExitReason(reason) : reason || status,
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  dbInstance.upsertExamSession(updated);
  return updated;
}
function fisherYatesShuffle(input) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function sanitizePublicQuizQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map((question) => {
    const { correctAnswer, ...publicQuestion } = question || {};
    return publicQuestion;
  });
}
function normalizeArabicDigitsServer(value) {
  return String(value ?? "").replace(/[٠-٩]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d))).replace(/[۰-۹]/g, (d) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(d))).replace(/[٫٬،]/g, ".");
}
function normalizeGradeValueServer(value) {
  const firstPart = normalizeArabicDigitsServer(value).split(/\s*من\s*|\//)[0] || "";
  const normalized = firstPart.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  if (!normalized) return "";
  return normalized.startsWith(".") ? `0${normalized}` : normalized;
}
function pointsForSubmission(submission) {
  const kind = String(submission?.kind || "").toLowerCase();
  const activityId = String(
    submission?.activityId || submission?.examId || submission?.projectId || ""
  );
  const source = kind === "exam" || kind === "quiz" ? dbInstance.getTeacherExams().find((exam) => String(exam.id) === activityId) : dbInstance.getTeacherProjects().find((project) => String(project.id) === activityId);
  const raw = source?.points ?? submission?.points ?? submission?.maxPoints ?? submission?.totalPoints;
  const max = Number(raw);
  return Number.isFinite(max) && max > 0 ? max : null;
}
function isTemporarySubmissionAttachmentUrl(value) {
  const url = String(value || "").trim();
  return /^(blob:|filesystem:|file:|webkit-fs:)/i.test(url);
}
function submissionAttachmentFileIdFromValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const pathPart = text.split("?")[0].split("#")[0];
  const name = pathPart.split("/").filter(Boolean).pop() || pathPart;
  const match = name.match(/^(file-[a-z0-9-]+?)(?:\.[a-z0-9]+)?$/i);
  return match ? match[1] : "";
}
function normalizePersistentSubmissionAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((att) => {
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
      att.storedName || att.fileId || att.attachmentId || rawStoredUrl || rawUrl || rawDownloadUrl
    );
    const id = String(att.id || att.fileId || att.attachmentId || derivedId || "").trim();
    const candidates = [rawStoredUrl, rawUrl, rawDownloadUrl].map((value) => String(value || "").trim()).filter((value) => value && !isTemporarySubmissionAttachmentUrl(value));
    const url = String(candidates[0] || (id ? `/api/submission-attachments/${id}` : "")).trim();
    const dataUrl = String(rawDataUrl || "").trim();
    const shouldKeepDataUrl = dataUrl.startsWith("data:") && dataUrl.length <= MIRAS_MAX_EMBEDDED_ATTACHMENT_DATA_URL_CHARS;
    if (!id && !url && !shouldKeepDataUrl) return null;
    return {
      ...rest,
      id: id || att.id,
      fileId: id || att.fileId,
      originalName: rest.originalName || rest.name || "\u0645\u0631\u0641\u0642",
      ...url ? { url, storedUrl: url, downloadUrl: url } : {},
      ...shouldKeepDataUrl ? { dataUrl } : {},
      persisted: true
    };
  }).filter(Boolean);
}
function findStoredSubmissionAttachmentDataUrl(fileId) {
  const wanted = String(fileId || "").trim();
  if (!wanted) return null;
  const submissions = Array.isArray(dbInstance.getTeacherSubmissions()) ? dbInstance.getTeacherSubmissions() : [];
  for (const sub of submissions) {
    const attachments = normalizePersistentSubmissionAttachments(sub?.attachments || []);
    for (const att of attachments) {
      const candidateId = String(
        att?.fileId || att?.id || att?.attachmentId || submissionAttachmentFileIdFromValue(att?.storedName || att?.storedUrl || att?.url)
      ).trim();
      if (candidateId !== wanted) continue;
      const dataUrl = String(att?.dataUrl || "").trim();
      if (!dataUrl.startsWith("data:")) continue;
      return {
        dataUrl,
        originalName: String(att?.originalName || att?.name || `${wanted}`),
        mimeType: String(att?.mimeType || "")
      };
    }
  }
  return null;
}
function findSubmissionByAttachmentId(fileId) {
  const wanted = String(fileId || "").trim();
  if (!wanted) return null;
  return dbInstance.getTeacherSubmissions().find(
    (submission) => normalizePersistentSubmissionAttachments(
      submission?.attachments || []
    ).some((attachment) => {
      const candidateId = String(
        attachment?.fileId || attachment?.id || attachment?.attachmentId || submissionAttachmentFileIdFromValue(
          attachment?.storedName || attachment?.storedUrl || attachment?.url
        )
      ).trim();
      return candidateId === wanted;
    })
  ) || null;
}
function sendStoredSubmissionAttachmentDataUrl(res, fallback) {
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
      `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`
    );
    res.end(buffer);
    return true;
  } catch {
    return false;
  }
}
function sendStoredSubmissionAttachmentBuffer(res, archive) {
  if (!archive?.buffer?.length) return false;
  const originalName = sanitizeAttachmentOriginalName(
    archive.originalName || "attachment"
  );
  res.setHeader(
    "Content-Type",
    archive.mimeType || "application/octet-stream"
  );
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`
  );
  res.end(archive.buffer);
  return true;
}
async function migrateEmbeddedSubmissionAttachments() {
  const submissions = Array.isArray(dbInstance.getTeacherSubmissions()) ? dbInstance.getTeacherSubmissions() : [];
  let migratedFiles = 0;
  let updatedSubmissions = 0;
  for (const submission of submissions) {
    const attachments = Array.isArray(submission?.attachments) ? submission.attachments : [];
    let submissionChanged = false;
    const migratedAttachments = [];
    for (const attachment of attachments) {
      const dataUrl = String(attachment?.dataUrl || "").trim();
      const match = dataUrl.match(
        /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/
      );
      if (!match) {
        migratedAttachments.push(attachment);
        continue;
      }
      const fileId = String(
        attachment?.fileId || attachment?.id || submissionAttachmentFileIdFromValue(
          attachment?.storedName || attachment?.storedUrl || attachment?.url
        )
      ).trim();
      if (!fileId || !match[2]) {
        migratedAttachments.push(attachment);
        continue;
      }
      const archived = await dbInstance.saveSubmissionAttachmentArchive({
        fileId,
        originalName: String(
          attachment?.originalName || attachment?.name || "attachment"
        ),
        mimeType: String(
          attachment?.mimeType || match[1] || "application/octet-stream"
        ),
        size: Number(attachment?.size || 0),
        storedName: String(attachment?.storedName || ""),
        base64: match[2]
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
        downloadUrl: `/api/submission-attachments/${fileId}`
      });
      submissionChanged = true;
      migratedFiles += 1;
    }
    if (submissionChanged) {
      dbInstance.upsertTeacherSubmission({
        ...submission,
        attachments: migratedAttachments,
        updatedAt: submission.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
      });
      updatedSubmissions += 1;
    }
  }
  if (updatedSubmissions > 0) {
    await dbInstance.waitForSync();
    console.log(
      `\u2705 Migrated ${migratedFiles} embedded submission attachment(s) out of ${updatedSubmissions} database record(s).`
    );
  }
}
function upsertRuntimeTeacherSubmission(submission) {
  const id = String(
    submission.id || `${submission.kind || "sub"}-${submission.activityId || Date.now()}-${submission.studentId || "student"}`
  );
  const previous = dbInstance.getTeacherSubmissions().find((item) => String(item.id) === id);
  const requestedStatus = String(submission?.status || "").trim();
  const requestedStatusLower = requestedStatus.toLowerCase();
  const incomingIsActiveStatus = requestedStatus === EXAM_IN_PROGRESS_STATUS || requestedStatusLower === "active" || requestedStatusLower === "started" || requestedStatusLower === "solving" || requestedStatusLower === "in_progress";
  if (previous && isProtectedFinalExamStatus(previous) && incomingIsActiveStatus) {
    return previous;
  }
  const incomingOwnsAttachments = Object.prototype.hasOwnProperty.call(
    submission || {},
    "attachments"
  );
  const normalizedIncomingAttachments = normalizePersistentSubmissionAttachments(
    submission?.attachments
  );
  const normalizedPreviousAttachments = normalizePersistentSubmissionAttachments(
    previous?.attachments
  );
  if (!incomingOwnsAttachments && normalizedPreviousAttachments.length) {
    submission = { ...submission, attachments: normalizedPreviousAttachments };
  } else if (incomingOwnsAttachments) {
    submission = { ...submission, attachments: normalizedIncomingAttachments };
  }
  const max = pointsForSubmission(submission);
  const normalizedGrade = submission.grade === "" || submission.grade === void 0 || submission.grade === null ? "" : normalizeGradeValueServer(submission.grade);
  const normalizedVisibleGrade = submission.visibleGrade === "" || submission.visibleGrade === void 0 || submission.visibleGrade === null ? submission.visibleGrade : normalizeGradeValueServer(submission.visibleGrade);
  submission = {
    ...submission,
    grade: normalizedGrade,
    visibleGrade: normalizedVisibleGrade
  };
  const incomingStatus = String(submission.status || "").trim();
  const incomingIsReturned = isReturnedSubmissionStatusServer(incomingStatus);
  if (!incomingIsReturned) {
    submission = {
      ...submission,
      returnedAt: void 0,
      returnedByEmail: void 0,
      returnNote: void 0
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
      gradedAt: void 0,
      serverSubmissionId: void 0,
      terminalStatus: void 0,
      sessionStatus: void 0,
      attemptStatus: void 0,
      finishReason: void 0,
      exitReason: void 0,
      exitedAt: void 0
    };
  }
  const previousHasManualTeacherGrade = previous?.teacherGradeOverride === true && String(
    previous?.grade ?? previous?.visibleGrade ?? previous?.teacherGrade ?? ""
  ).trim() !== "";
  const incomingHasManualTeacherGrade = submission.teacherGradeOverride === true && String(
    submission.grade ?? submission.visibleGrade ?? submission.teacherGrade ?? ""
  ).trim() !== "";
  const incomingAnswerText = String(submission.answerText || "");
  const incomingIsWithdrawalRepair = incomingStatus === EXAM_WITHDRAWN_STATUS || incomingStatus === EXAM_CHEATING_ATTEMPT_STATUS || incomingStatus === EXAM_EXITED_BEFORE_SUBMIT_STATUS || incomingAnswerText.includes("\u0627\u0646\u0633\u062D\u0628 \u0627\u0644\u0637\u0627\u0644\u0628") || incomingAnswerText.includes("\u0627\u0646\u0633\u062D\u0627\u0628 \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631") || incomingAnswerText.includes("\u062D\u0627\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u063A\u0634") || incomingAnswerText.includes("\u0623\u063A\u0644\u0642 \u0634\u0627\u0634\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631");
  const incomingLooksAutoZero = String(
    submission.grade ?? submission.visibleGrade ?? submission.score ?? ""
  ).trim() === "" || Number(
    normalizeGradeValueServer(
      submission.grade ?? submission.visibleGrade ?? submission.score ?? "0"
    )
  ) === 0;
  if (previousHasManualTeacherGrade && !incomingHasManualTeacherGrade && incomingIsWithdrawalRepair && incomingLooksAutoZero) {
    submission = {
      ...submission,
      grade: String(
        previous.grade ?? previous.visibleGrade ?? previous.teacherGrade ?? ""
      ),
      visibleGrade: String(
        previous.visibleGrade ?? previous.grade ?? previous.teacherGrade ?? ""
      ),
      teacherGradeOverride: true,
      status: previous.status || EXAM_GRADED_STATUS,
      gradedAt: previous.gradedAt || submission.gradedAt
    };
  }
  const finalNormalizedGrade = submission.grade === "" || submission.grade === void 0 || submission.grade === null ? "" : normalizeGradeValueServer(submission.grade);
  const numericGrade = finalNormalizedGrade === "" ? null : Number(finalNormalizedGrade);
  if (numericGrade !== null && Number.isFinite(numericGrade) && max !== null && numericGrade > max) {
    const err = new Error(`GRADE_EXCEEDS_MAX:${max}`);
    err.statusCode = 400;
    err.maxPoints = max;
    throw err;
  }
  const saved = {
    ...submission,
    id,
    submittedAt: submission.submittedAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  dbInstance.upsertTeacherSubmission(saved);
  bumpLiveContentRevision();
  const prevGrade = previous?.grade ?? previous?.visibleGrade ?? "";
  const nextGrade = saved.grade ?? saved.visibleGrade ?? "";
  if (saved.studentId && String(nextGrade) !== "" && String(nextGrade) !== String(prevGrade)) {
    const changed = String(prevGrade) !== "";
    const suffix = max ? `: ${nextGrade} \u0645\u0646 ${max}` : `: ${nextGrade}`;
    notifyStudent(
      String(saved.studentId),
      changed ? "\u062A\u0645 \u062A\u0639\u062F\u064A\u0644 \u062F\u0631\u062C\u0629" : "\u062F\u0631\u062C\u0629 \u062C\u062F\u064A\u062F\u0629",
      `${saved.activityTitle || "\u0646\u0634\u0627\u0637"}${suffix}`,
      {
        type: changed ? "grade_updated" : "grade_new",
        studentId: String(saved.studentId),
        activityId: String(saved.activityId || ""),
        kind: String(saved.kind || ""),
        courseCode: String(saved.courseCode || ""),
        link: "/"
      }
    );
  }
  return saved;
}
function examReviewSettings(exam) {
  const review = exam?.review || {};
  return {
    showGrade: review.showGrade === true,
    gradesReleased: review.gradesReleased === true,
    releasedAt: review.releasedAt
  };
}
function canShowExamGradeToStudent(exam) {
  const review = examReviewSettings(exam);
  if (review.showGrade) return true;
  return review.gradesReleased;
}
function preserveSpecialExamStatusOnGradeRelease(status) {
  const normalized = String(status || "").trim();
  return [
    EXAM_CHEATING_ATTEMPT_STATUS,
    EXAM_WITHDRAWN_STATUS,
    EXAM_EXITED_BEFORE_SUBMIT_STATUS,
    EXAM_TIME_EXPIRED_STATUS
  ].includes(normalized);
}
function gradeCurrentExamProgress(submission, fallbackTotalPoints) {
  const answers = submission?.draftAnswers || submission?.answers || {};
  const graded = gradeQuizAnswers(answers);
  const hasAnswers = answers && typeof answers === "object" && Object.keys(answers).length > 0;
  const score = hasAnswers ? Number(graded.score || 0) : Number(submission?.score || 0);
  const totalPoints = Number(
    fallbackTotalPoints || graded.totalPoints || submission?.totalPoints || 20
  ) || 20;
  return {
    answers,
    score: Number.isFinite(score) ? score : 0,
    totalPoints,
    matchedQuestions: graded.matchedQuestions.length ? graded.matchedQuestions : submission?.matchedQuestions || []
  };
}
function finalizeExamAttemptAsZero(req, params) {
  const { student, exam, reason } = params;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const safeReq = req || {};
  const baseTotalPoints = Number(exam?.points || params.submission?.totalPoints || 0) || 20;
  const progressGrade = gradeCurrentExamProgress(
    params.submission,
    baseTotalPoints
  );
  const totalPoints = progressGrade.totalPoints;
  const finalScore = progressGrade.score;
  const finalMatched = progressGrade.matchedQuestions;
  const finalStatus = EXAM_WITHDRAWN_STATUS;
  const finalReasonText = `\u0627\u0646\u0633\u062D\u0628 \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0623\u0648 \u0627\u0646\u0642\u0637\u0639\u062A \u062C\u0644\u0633\u062A\u0647\u060C \u0648\u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627: ${finalScore} \u0645\u0646 ${totalPoints}`;
  const quizSubmission = {
    id: params.submission?.id || "quiz-sub-" + Math.random().toString(36).substring(2, 9),
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: exam?.courseCode || params.pass?.courseCode || student.sectionCode,
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
      safeReq.headers?.["user-agent"] || "Safe Exam Browser"
    ).substring(0, 30),
    ipAddress: safeReq.ip || "127.0.0.1",
    startedAt: params.submission?.startedAt,
    submittedAt: now,
    status: "submitted",
    zeroReason: void 0,
    finishReason: finalStatus
  };
  if (params.submission?.id)
    dbInstance.updateQuizSubmission(
      params.submission.id,
      quizSubmission
    );
  else dbInstance.addQuizSubmission(quizSubmission);
  upsertRuntimeTeacherSubmission({
    id: `exam-${exam.id}-${student.id}`,
    kind: "exam",
    activityId: exam.id,
    activityTitle: exam.title,
    courseCode: exam.courseCode || params.pass?.courseCode || student.sectionCode,
    studentId: student.id,
    studentName: student.name,
    answerText: finalReasonText,
    status: finalStatus,
    grade: String(finalScore),
    visibleGrade: canShowExamGradeToStudent(exam) ? String(finalScore) : "",
    totalPoints,
    serverSubmissionId: quizSubmission.id,
    submittedAt: now,
    gradedAt: now
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u0627\u0646\u0633\u062D\u0627\u0628 \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631",
    details: `${reason} \u2014 \u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B: ${finalScore} \u0645\u0646 ${totalPoints}. \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631: ${exam.title}`,
    teacherEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    actorEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    sectionCode: exam.courseCode || student.sectionCode,
    ip: safeReq.ip || "127.0.0.1",
    userAgent: safeReq.headers?.["user-agent"] || "Unknown",
    os: "Safe Exam Browser",
    browser: "SEB",
    isViolationWarning: true
  });
  return quizSubmission;
}
function removeRuntimeTeacherSubmissionsFor(kind, activityId) {
  dbInstance.removeTeacherSubmissionsFor(kind, activityId);
  bumpLiveContentRevision();
}
function isActiveRecord(item) {
  return item && item.deleted !== true && item.archived !== true && item.isDeleted !== true && item.isArchived !== true && String(item.status || "").toLowerCase() !== "deleted";
}
function activeSections() {
  return dbInstance.getSections().filter((section) => isActiveRecord(section));
}
function logSebEvent(params) {
  dbInstance.addActivityLog({
    studentId: params.studentId,
    studentName: params.studentName,
    action: params.action,
    details: params.details,
    ip: params.req.ip || "127.0.0.1",
    userAgent: params.req.headers["user-agent"] || "Unknown",
    os: "Safe Exam Browser",
    browser: "SEB Token",
    isViolationWarning: !!params.warning
  });
}
function getRuntimeSebPasses() {
  const arr = dbInstance.getSebAttempts();
  return new Map(
    arr.map((item) => [String(item.token), item])
  );
}
function saveSebPass(pass) {
  const map = getRuntimeSebPasses();
  map.set(pass.token, pass);
  dbInstance.setSebAttempts(Array.from(map.values()));
  return pass;
}
function createSebPass(params) {
  const token = base64Url(import_crypto.default.randomBytes(32));
  const now = Date.now();
  const attemptId = params.attemptId || `seb-attempt-${now}-${base64Url(import_crypto.default.randomBytes(8))}`;
  const pass = {
    token,
    attemptId,
    studentId: String(params.studentId || ""),
    examId: String(params.examId || ""),
    courseCode: String(params.courseCode || ""),
    teacherEmail: params.teacherEmail || params.ownerEmail,
    ownerEmail: params.ownerEmail || params.teacherEmail,
    originalDeviceId: params.originalDeviceId,
    createdAt: now,
    expiresAt: now + Math.max(1, params.expiryMinutes || 10) * 60 * 1e3,
    status: "launch"
  };
  return saveSebPass(pass);
}
function getSebPassFromRequest(req) {
  return String(
    req.body?.sebToken || req.body?.sebPass || req.query?.token || req.query?.seb_token || req.query?.seb_pass || req.headers["x-miras-seb-token"] || req.headers["x-miras-seb-pass"] || ""
  ).trim();
}
function isSebPassExpired(pass) {
  return pass.status === "launch" && pass.expiresAt < Date.now();
}
function findSebPass(token) {
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
function rejectSebPass(req, pass, reason) {
  logSebEvent({
    studentId: pass?.studentId,
    action: "\u0631\u0641\u0636 \u0646\u0641\u0642 SEB",
    details: reason,
    req,
    warning: true
  });
}
function getValidSebPass(req, student, examId) {
  const token = getSebPassFromRequest(req);
  if (!token) return null;
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed") return null;
  if (student && String(pass.studentId) !== String(student.id)) return null;
  if (student && pass.courseCode && !studentHasEnrollmentInCourse(student, pass.courseCode))
    return null;
  if (examId && String(pass.examId) !== String(examId)) return null;
  return pass;
}
function getActiveSebAttempt(req, student, examId) {
  const pass = getValidSebPass(req, student, examId);
  if (!pass || pass.status !== "active") return null;
  return pass;
}
function consumeSebPass(pass) {
  if (!pass || pass.status === "closed") return;
  pass.usedAt = Date.now();
  if (pass.status === "launch") {
    pass.status = "active";
    pass.startedAt = pass.usedAt;
  }
  saveSebPass(pass);
}
function isSebSubmissionCloseReason(reason) {
  const normalizedReason = String(reason || "closed").toLowerCase();
  return normalizedReason === "submitted" || normalizedReason.includes("submit");
}
function closeSebAttempt(pass, reason = "closed") {
  if (!pass) return;
  const wasActive = pass.status === "active";
  const isSubmissionClose = isSebSubmissionCloseReason(reason);
  if (pass.status === "closed") {
    if (!isSubmissionClose) flagExamExitedBeforeSubmit(pass);
    return;
  }
  pass.status = "closed";
  pass.closedAt = Date.now();
  pass.closeReason = reason;
  saveSebPass(pass);
  if (wasActive && !isSubmissionClose) flagExamExitedBeforeSubmit(pass);
}
function flagExamExitedBeforeSubmit(pass) {
  try {
    const submission = dbInstance.getQuizSubmissions().find(
      (q) => String(q.studentId) === String(pass.studentId) && String(q.chapterId) === String(pass.examId)
    );
    const student = dbInstance.getStudents().find((s) => String(s.id) === String(pass.studentId));
    const exam = dbInstance.getTeacherExams().find((item) => String(item.id) === String(pass.examId));
    if (!student || !exam) return;
    const submissionId = `exam-${exam.id}-${student.id}`;
    const existing = dbInstance.getTeacherSubmissions().find((item) => String(item.id) === submissionId);
    if (existing && String(existing.status || "") === EXAM_EXITED_BEFORE_SUBMIT_STATUS)
      return;
    const quizStillInProgress = !!submission && String(submission.status || "") === "started";
    const teacherStillShowsInProgress = !!existing && String(existing.status || "") === EXAM_IN_PROGRESS_STATUS;
    if (!quizStillInProgress && !teacherStillShowsInProgress) return;
    finalizeExamAttemptAsZero({}, {
      student,
      exam,
      pass,
      submission,
      reason: "\u0628\u062F\u0623 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0638\u0647\u0631\u062A \u0644\u0647 \u0627\u0644\u0623\u0633\u0626\u0644\u0629\u060C \u062B\u0645 \u062E\u0631\u062C \u0623\u0648 \u0627\u0646\u0642\u0637\u0639\u062A \u0627\u0644\u062C\u0644\u0633\u0629 \u0642\u0628\u0644 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A."
    });
    notifyTeachersForSection(
      exam.courseCode || pass.courseCode,
      "\u062E\u0631\u0648\u062C \u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u062E\u062A\u0628\u0627\u0631 \u0642\u0628\u0644 \u0627\u0644\u062A\u0633\u0644\u064A\u0645",
      `${student.name} \u062E\u0631\u062C \u0645\u0646 \u0627\u062E\u062A\u0628\u0627\u0631 "${exam.title}" \u0642\u0628\u0644 \u062A\u0633\u0644\u064A\u0645 \u0625\u062C\u0627\u0628\u0627\u062A\u0647. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0633\u0645\u0627\u062D \u0644\u0647 \u0628\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0646 \u0634\u0627\u0634\u0629 \u062A\u0633\u0644\u064A\u0645\u0627\u062A \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A.`,
      {
        type: "exam_exited_before_submit",
        studentId: String(student.id),
        activityId: String(exam.id),
        kind: "exam",
        link: "/"
      }
    );
  } catch {
  }
}
function describeSebPass(pass) {
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
    closeReason: pass.closeReason || ""
  };
}
function buildAbsoluteServerUrl(req, pathnameWithQuery) {
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http"
  ).split(",")[0];
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`
  ).split(",")[0];
  return `${proto}://${host}${pathnameWithQuery}`;
}
function buildSebStartUrl(req, token) {
  return buildAbsoluteServerUrl(
    req,
    `/seb/start?token=${encodeURIComponent(token)}`
  );
}
function buildSebQuitUrl(req, token) {
  return buildAbsoluteServerUrl(
    req,
    `/seb/quit?token=${encodeURIComponent(token)}`
  );
}
function buildSebConfigUrl(token) {
  return `/seb/config/${encodeURIComponent(token)}/miras-official.seb`;
}
function buildSebConfigAbsoluteUrl(req, token) {
  return buildAbsoluteServerUrl(req, buildSebConfigUrl(token));
}
function buildSebConfigDeepLinkUrl(req, token) {
  const absolute = buildSebConfigAbsoluteUrl(req, token);
  if (/^https:\/\//i.test(absolute))
    return absolute.replace(/^https:\/\//i, "sebs://");
  if (/^http:\/\//i.test(absolute))
    return absolute.replace(/^http:\/\//i, "seb://");
  return absolute;
}
function renderSebLaunchPage(req, pass) {
  const launchUrl = buildSebConfigDeepLinkUrl(req, pass.token);
  const appStoreUrl = "https://apps.apple.com/app/safeexambrowser/id1155002964";
  const downloadUrl = "https://safeexambrowser.org/download_en.html";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646</title>
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
  <div class="shield">\u{1F6E1}\uFE0F</div>
  <h1>\u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0639\u0628\u0631 Safe Exam Browser</h1>
  <div class="lockNotice">
    <b>\u062A\u0646\u0628\u064A\u0647 \u0642\u0628\u0644 \u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631</b>
    \u0639\u0646\u062F \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 \u0627\u0644\u0632\u0631 \u0627\u0644\u0623\u0632\u0631\u0642 \u0633\u064A\u062A\u0645 \u0641\u062A\u062D \u062A\u0637\u0628\u064A\u0642 SEB \u0627\u0644\u0645\u062B\u0628\u062A \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u0631\u0628\u0637\u0647 \u0628\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0641\u0642\u0637.
    <br><br>
    \u0633\u062A\u0638\u0647\u0631 \u0644\u0643 \u0631\u0633\u0627\u0644\u0629 \u0645\u0646 \u0627\u0644\u0646\u0638\u0627\u0645 \u0628\u0639\u0646\u0648\u0627\u0646 "Confirm App Self-Lock" \u2014 \u0627\u0636\u063A\u0637 <span class="yes">"Yes"</span> \u0644\u0628\u062F\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631. \u0633\u064A\u064F\u0642\u0641\u0644 \u062C\u0647\u0627\u0632\u0643 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0648\u0644\u0646 \u062A\u0633\u062A\u0637\u064A\u0639 \u0627\u0644\u062E\u0631\u0648\u062C \u0644\u0623\u064A \u062A\u0637\u0628\u064A\u0642 \u062D\u062A\u0649 \u062A\u0633\u0644\u0651\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.
    <br><br>
	    \u0625\u0630\u0627 \u0636\u063A\u0637\u062A <span class="no">"No"</span> \u0628\u0627\u0644\u062E\u0637\u0623: \u0644\u0627 \u062A\u0642\u0644\u0642\u060C \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0644\u0645 \u064A\u0628\u062F\u0623. \u0627\u0631\u062C\u0639 \u0644\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0648\u0627\u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.
  </div>
  <p class="muted">\u0627\u0636\u063A\u0637 \u0627\u0644\u0632\u0631 \u0627\u0644\u0623\u0632\u0631\u0642 \u0644\u0641\u062A\u062D Safe Exam Browser \u0645\u0628\u0627\u0634\u0631\u0629. \u0625\u0630\u0627 \u0643\u0627\u0646 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0645\u062B\u0628\u062A\u0627\u064B \u0633\u064A\u0628\u062F\u0623 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u062F\u0627\u062E\u0644 SEB \u062F\u0648\u0646 \u062A\u0646\u0632\u064A\u0644 \u0645\u0644\u0641 \u064A\u062F\u0648\u064A.</p>
  <a class="btn primary" id="openSeb" href="${xmlEscape(launchUrl)}">\u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u062F\u0627\u062E\u0644 SEB</a>
  <a class="btn ios" href="${xmlEscape(appStoreUrl)}" rel="noopener">\u062A\u062D\u0645\u064A\u0644 SEB \u0644\u0623\u062C\u0647\u0632\u0629 iPhone / iPad</a>
  <a class="btn ghost" href="${xmlEscape(downloadUrl)}" rel="noopener">\u062A\u062D\u0645\u064A\u0644 SEB \u0644\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631</a>
  <div class="warn" id="warnBox">\u0625\u0630\u0627 \u0644\u0645 \u064A\u0641\u062A\u062D SEB \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B\u060C \u062A\u0623\u0643\u062F \u0623\u0646 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0645\u062B\u0628\u062A \u062B\u0645 \u0627\u0636\u063A\u0637 \u0627\u0644\u0632\u0631 \u0627\u0644\u0623\u0632\u0631\u0642 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649. \u0625\u0630\u0627 \u0644\u0645 \u064A\u0643\u0646 \u0645\u062B\u0628\u062A\u0627\u064B \u0627\u0633\u062A\u062E\u062F\u0645 \u0632\u0631 \u0627\u0644\u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0645\u0646\u0627\u0633\u0628 \u0644\u062C\u0647\u0627\u0632\u0643.</div>
  <p class="hint">\u0639\u0646\u062F \u0641\u062A\u062D SEB \u0633\u064A\u062A\u0645 \u0642\u0641\u0644 \u062C\u0647\u0627\u0632\u0643 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0648\u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0628\u0627\u0634\u0631\u0629.</p>
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
function renderSebStartPage(req, pass) {
  const quitUrl = buildSebQuitUrl(req, pass.token);
  const boot = JSON.stringify({
    token: pass.token,
    examId: pass.examId,
    courseCode: pass.courseCode,
    quitUrl
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u0628\u062F\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646</title>
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
    <div class="shield">\u{1F6E1}\uFE0F</div>
    <h1>\u062C\u0627\u0647\u0632 \u0644\u0628\u062F\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646</h1>
    <div class="desc">
    \u0642\u0628\u0644 \u0623\u0646 \u062A\u0636\u063A\u0637 "\u0628\u062F\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631"\u060C \u0627\u0642\u0631\u0623 \u0647\u0630\u0627 \u0627\u0644\u062A\u0646\u0628\u064A\u0647 \u062C\u064A\u062F\u0627\u064B:
    <b>\u0633\u064A\u064F\u0642\u0641\u0644 \u062C\u0647\u0627\u0632\u0643 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631</b>
    <span class="ok">\u2713</span> \u0644\u0627 \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u062E\u0631\u0648\u062C \u0644\u0623\u064A \u062A\u0637\u0628\u064A\u0642 \u0623\u0648 \u0645\u0648\u0642\u0639 \u0622\u062E\u0631.<br>
    <span class="ok">\u2713</span> \u0644\u0627 \u064A\u0645\u0643\u0646 \u0623\u062E\u0630 \u0644\u0642\u0637\u0629 \u0634\u0627\u0634\u0629 \u0623\u0648 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u0634\u0627\u0634\u0629.<br>
    <span class="ok">\u2713</span> \u0644\u0646 \u062A\u0633\u062A\u0637\u064A\u0639 \u0627\u0644\u062E\u0631\u0648\u062C \u0645\u0646 SEB \u0625\u0644\u0627 \u0628\u0639\u062F \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.
    <b>\u0625\u0630\u0627 \u0644\u0645 \u062A\u0643\u0646 \u062C\u0627\u0647\u0632\u0627\u064B \u0627\u0644\u0622\u0646</b>
    \u0627\u0636\u063A\u0637 "\u062E\u0631\u0648\u062C \u0622\u0645\u0646" \u0628\u0627\u0644\u0623\u0633\u0641\u0644\u060C \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0644\u0645 \u064A\u0628\u062F\u0623 \u0648\u0644\u0646 \u062A\u064F\u0633\u062C\u064E\u0651\u0644 \u0639\u0644\u064A\u0643 \u0623\u064A \u0645\u062D\u0627\u0648\u0644\u0629. \u062A\u0633\u062A\u0637\u064A\u0639 \u0627\u0644\u0631\u062C\u0648\u0639 \u0644\u0645\u0650\u0631\u0627\u0633 \u0648\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u0641\u062A\u062D \u0645\u0646 \u062C\u062F\u064A\u062F \u0644\u0627\u062D\u0642\u0627\u064B.
  </div>
    <button class="start" id="startBtn" type="button">\u0628\u062F\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0646</button>
    <a class="quit" href="${xmlEscape(quitUrl)}">\u062E\u0631\u0648\u062C \u0622\u0645\u0646 \u0628\u062F\u0648\u0646 \u0628\u062F\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631</a>
    <p class="muted">\u0625\u0630\u0627 \u0638\u0647\u0631\u062A \u0623\u064A \u0645\u0634\u0643\u0644\u0629\u060C \u0627\u0633\u062A\u062E\u062F\u0645 \u062E\u0631\u0648\u062C \u0622\u0645\u0646. \u0643\u0644\u0645\u0629 \u0627\u0644\u062E\u0631\u0648\u062C \u0644\u0644\u0645\u0631\u0627\u0642\u0628: CBE</p>
    <div class="rescue hidden" id="rescueBox">
      <h3>\u062A\u0623\u062E\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0623\u0633\u0626\u0644\u0629</h3>
      <p>\u0644\u0645 \u062A\u0635\u0644 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u062E\u0644\u0627\u0644 \u0627\u0644\u0648\u0642\u062A \u0627\u0644\u0645\u062A\u0648\u0642\u0639. \u0625\u0630\u0627 \u0627\u0633\u062A\u0645\u0631\u062A \u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0645 \u0632\u0631 \u0627\u0644\u062E\u0631\u0648\u062C \u0628\u0627\u0644\u0623\u0639\u0644\u0649 \u0648\u0623\u0628\u0644\u063A \u0627\u0644\u0645\u0631\u0627\u0642\u0628.</p>
    </div>
    <div class="status hidden" id="statusBox"></div>
    <div class="error hidden" id="errorBox"></div>
  </section>
  <section id="exam" class="hidden">
    <div class="top">
      <h2 id="examTitle">\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646</h2>
      <div class="top-meta">
        <div id="ambient-save-status" class="ambient-status status-idle"><span class="ambient-dot"></span><span class="ambient-txt">\u062C\u0627\u0647\u0632 \u0648\u0645\u0624\u0645\u0651\u0646</span></div>
        <span class="timer" id="timer">30:00</span>
      </div>
    </div>
    <div class="q-navigation" id="qPagerDots"></div>
    <div id="questions"></div>
    
    <div class="q-slider-actions">
      <button class="nav-btn-alt" id="sliderPrevBtn" type="button" disabled title="\u0627\u0644\u0633\u0627\u0628\u0642" aria-label="\u0627\u0644\u0633\u0627\u0628\u0642">&#8594;</button>
      <button class="nav-btn-alt" id="sliderNextBtn" type="button" title="\u0627\u0644\u062A\u0627\u0644\u064A" aria-label="\u0627\u0644\u062A\u0627\u0644\u064A">&#8592;</button>
    </div>
    
    <div class="actions">
      <button class="submit" id="submitBtn" type="button">\u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631</button>
      <a class="quit" href="${xmlEscape(quitUrl)}">\u0627\u0646\u0633\u062D\u0627\u0628 \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631</a>
    </div>
  </section>
  <section id="result" class="hidden">
    <div class="shield">\u2713</div>
    <h1>\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631</h1>
    <div class="status" id="resultBox">\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u062A\u0633\u0644\u064A\u0645. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u062E\u0631\u0648\u062C \u0645\u0646 SEB \u0628\u0623\u0645\u0627\u0646.</div>
    <a class="quit" href="${xmlEscape(quitUrl)}">\u0627\u0644\u062E\u0631\u0648\u062C \u0627\u0644\u0622\u0645\u0646 \u0645\u0646 SEB</a>
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
      setError(data.error||"\u0627\u0646\u062A\u0647\u062A \u062C\u0644\u0633\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.");
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
function setError(message){text("errorBox",message+" \u0625\u0630\u0627 \u0627\u0633\u062A\u0645\u0631\u062A \u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0645 \u062E\u0631\u0648\u062C \u0622\u0645\u0646 \u0648\u0623\u0628\u0644\u063A \u0627\u0644\u0645\u0631\u0627\u0642\u0628. \u0643\u0644\u0645\u0629 \u0627\u0644\u062E\u0631\u0648\u062C: CBE");show("errorBox");hide("statusBox");}

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
  statusEl.querySelector(".ambient-txt").textContent="\u062C\u0627\u0631\u064D \u0627\u0644\u062D\u0641\u0638 \u0645\u062D\u0644\u064A\u064B\u0627\u2026";
  
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
        statusEl.querySelector(".ambient-txt").textContent="\u062A\u0645\u062A \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629 \u0648\u0627\u0644\u062D\u0641\u0638 \u0628\u0646\u062C\u0627\u062D";
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
      statusEl.querySelector(".ambient-txt").textContent="\u0627\u0646\u0642\u0637\u0627\u0639 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 (\u062A\u0645 \u0627\u0644\u062A\u0623\u0645\u064A\u0646 \u0645\u062D\u0644\u064A\u064B\u0627)";
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
  hide("intro");show("exam");text("examTitle",title||"\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646");startTimer(minutes);
  
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
    head.innerHTML="<span>\u0627\u0644\u0633\u0624\u0627\u0644 "+(idx+1)+" \u0645\u0646 "+questions.length+"</span><span>"+(q.points||1)+" \u062F\u0631\u062C\u0629</span>";
    card.appendChild(head);
    
    const qtext=document.createElement("p");qtext.className="qtext";qtext.textContent=q.questionText||"\u0633\u0624\u0627\u0644";
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
    setStatus("\u062C\u0627\u0631\u064A \u0641\u062A\u062D \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0622\u0645\u0646\u0629 \u0648\u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0623\u0633\u0626\u0644\u0629...");
    const validateResp=await fetch("/api/seb/validate",{method:"POST",headers:headers(),body:JSON.stringify({sebToken:boot.token,seb:"1",miras_seb:"1"})});
    const session=await validateResp.json().catch(()=>({}));
    if(!validateResp.ok) throw new Error(session.error||"\u062A\u0639\u0630\u0631 \u062A\u0641\u0639\u064A\u0644 \u062C\u0644\u0633\u0629 SEB.");
    studentId=String(session.student&&session.student.id||"");
    examId=String(session.sebSession&&session.sebSession.examId||session.exam&&session.exam.id||boot.examId);
    activeExamSessionId=examSessionId();
    const lockResp=await fetch("/api/exam-lock/acquire",{method:"POST",headers:headers(),body:JSON.stringify({studentId,examId,sessionId:activeExamSessionId,deviceId:deviceId(),displayMode:displayMode()})});
    const lockData=await lockResp.json().catch(()=>({}));
    if(!lockResp.ok) throw new Error(lockData.error||"\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0641\u062A\u0648\u062D \u0641\u064A \u062C\u0644\u0633\u0629 \u0623\u062E\u0631\u0649.");
    activeExamSessionId=String(lockData.activeExamSessionId||activeExamSessionId);
    const quizResp=await fetch("/api/quizzes/generate?studentId="+encodeURIComponent(studentId)+"&chapterId="+encodeURIComponent(examId)+"&examSessionId="+encodeURIComponent(activeExamSessionId)+"&displayMode="+encodeURIComponent(displayMode()),{headers:headers(),cache:"no-store"});
    const quiz=await quizResp.json().catch(()=>({}));
    if(!quizResp.ok) throw new Error(quiz.error||"\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.");
    if(!Array.isArray(quiz.questions)||!quiz.questions.length) throw new Error("\u0644\u0645 \u062A\u0635\u0644 \u0623\u0633\u0626\u0644\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.");
    if(rescueTimer){clearTimeout(rescueTimer);rescueTimer=null;}
    hide("rescueBox");
    startTime=Date.now();
    renderQuestions(quiz.questions, session.exam&&session.exam.title, session.exam&&session.exam.timerMinutes);
    startExamHeartbeat();
  } catch(err) {
    if(rescueTimer){clearTimeout(rescueTimer);rescueTimer=null;}
    el("startBtn").disabled=false;
    setError(err&&err.message?err.message:"\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.");
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
    if(!resp.ok) throw new Error(data.error||"\u062A\u0639\u0630\u0631 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.");
    stopExamHeartbeat();
    hide("exam");show("result");
    const submission=data.submission||{};
    const savedScore=submission.score!==undefined?submission.score:(submission.percentage!==undefined?submission.percentage:"\u062A\u0645 \u0627\u0644\u062A\u0633\u0644\u064A\u0645");
    text("resultBox",data.gradeVisible?"\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u062A\u0633\u0644\u064A\u0645. \u0627\u0644\u0646\u062A\u064A\u062C\u0629: "+savedScore:"\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u062A\u0633\u0644\u064A\u0645 \u0648\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
  } catch(err) {
    el("submitBtn").disabled=false;
    alert((err&&err.message?err.message:"\u062A\u0639\u0630\u0631 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.")+"\\n\u0627\u0633\u062A\u062E\u062F\u0645 \u062E\u0631\u0648\u062C \u0622\u0645\u0646 \u0625\u0630\u0627 \u0627\u0633\u062A\u0645\u0631\u062A \u0627\u0644\u0645\u0634\u0643\u0644\u0629. \u0643\u0644\u0645\u0629 \u0627\u0644\u062E\u0631\u0648\u062C: CBE");
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
        statusEl.querySelector(".ambient-txt").textContent = "\u062A\u0645 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0648\u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629 \u0628\u0646\u062C\u0627\u062D!";
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
function safeSebFilePart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "exam";
}
function buildSebFileName(pass) {
  return `miras-seb-${safeSebFilePart(pass.courseCode)}-${safeSebFilePart(pass.examId)}-${safeSebFilePart(pass.attemptId)}.seb`;
}
function getSebConfigTokenFromRequest(req) {
  return String(
    req.params?.token || req.query.token || req.query.seb_token || req.query.seb_pass || req.query.seb_config_token || ""
  ).trim();
}
function xmlEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function validateSebLaunchInput(req) {
  const studentId = normalizeStudentId(
    req.body?.studentId || req.query?.studentId
  );
  const examId = String(req.body?.examId || req.query?.examId || "").trim();
  const courseCode = String(
    req.body?.courseCode || req.query?.courseCode || ""
  ).trim();
  const ownerEmail = String(
    req.body?.ownerEmail || req.body?.teacherEmail || req.query?.ownerEmail || req.query?.teacherEmail || ""
  ).trim().toLowerCase();
  const student = dbInstance.getStudents().find((s) => String(s.id) === studentId);
  const exam = dbInstance.getTeacherExams().find((item) => String(item.id) === examId);
  if (!studentId || !examId || !courseCode)
    return { error: "\u0628\u064A\u0627\u0646\u0627\u062A \u062C\u0644\u0633\u0629 SEB \u0646\u0627\u0642\u0635\u0629.", status: 400 };
  if (!student || !exam)
    return {
      error: "\u062A\u0639\u0630\u0631 \u062A\u062C\u0647\u064A\u0632 \u062C\u0644\u0633\u0629 SEB \u0644\u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u0623\u0648 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.",
      status: 404
    };
  if (String(exam.courseCode || "").toLowerCase() !== courseCode.toLowerCase())
    return {
      error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0644\u0627 \u064A\u062A\u0628\u0639 \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0645\u0637\u0644\u0648\u0628.",
      status: 403
    };
  if (!studentHasEnrollmentInCourse(student, courseCode))
    return {
      error: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u0641\u0639\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u0627\u0644\u0643\u0648\u062F \u0627\u0644\u0623\u0635\u0644\u064A.",
      status: 403
    };
  const examOwner = String(
    exam.ownerEmail || exam.teacherEmail || sectionOwnerEmail(courseCode) || ""
  ).trim().toLowerCase();
  if (ownerEmail && examOwner && ownerEmail !== examOwner)
    return {
      error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0644\u0627 \u064A\u062A\u0628\u0639 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0637\u0644\u0648\u0628.",
      status: 403
    };
  return {
    student,
    exam,
    studentId,
    examId,
    courseCode,
    ownerEmail: examOwner || ownerEmail
  };
}
function createSebLaunchFromActivatedSession(req) {
  const checked = validateSebLaunchInput(req);
  if (checked.error) return checked;
  if (!checked.exam?.seb?.enabled)
    return {
      error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 Safe Exam Browser.",
      status: 400
    };
  const now = Date.now();
  if (checked.exam.open && new Date(checked.exam.open).getTime() > now)
    return { error: "\u0644\u0645 \u064A\u0628\u062F\u0623 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0628\u0639\u062F.", status: 403 };
  if (checked.exam.close && new Date(checked.exam.close).getTime() + 24 * 60 * 60 * 1e3 < now && !getActiveReturnException("exam", checked.exam.id, checked.student.id))
    return { error: "\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.", status: 403 };
  const sessionValidation = validateSessionFingerprint(req, checked.student);
  if (!sessionValidation.isValid)
    return {
      error: sessionValidation.error || "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0646\u0634\u0627\u0621 \u062C\u0644\u0633\u0629 SEB \u0625\u0644\u0627 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0623\u0635\u0644\u064A \u0627\u0644\u0645\u0641\u0639\u0651\u0644.",
      status: 403
    };
  const examTimerMinutes = Math.max(
    1,
    Number(
      checked.exam.antiCheat?.timerMinutes ?? checked.exam.timerMinutes
    ) || 30
  );
  const pass = createSebPass({
    studentId: checked.studentId,
    examId: checked.examId,
    courseCode: checked.courseCode,
    ownerEmail: checked.ownerEmail,
    teacherEmail: checked.ownerEmail,
    originalDeviceId: getRequestDeviceToken(req) || getRequestDeviceFingerprint(req),
    expiryMinutes: examTimerMinutes + 5
  });
  logSebEvent({
    studentId: checked.student.id,
    studentName: checked.student.name,
    action: "\u0625\u0646\u0634\u0627\u0621 \u0646\u0641\u0642 SEB",
    details: `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u062C\u0644\u0633\u0629 \u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0624\u0642\u062A\u0629 \u0644\u0644\u0627\u062E\u062A\u0628\u0627\u0631 ${checked.examId} \u0641\u064A \u0645\u0642\u0631\u0631 ${checked.courseCode} \u062F\u0648\u0646 \u062A\u063A\u064A\u064A\u0631 \u0631\u0628\u0637 \u0627\u0644\u0643\u0648\u062F \u0623\u0648 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0623\u0635\u0644\u064A.`,
    req
  });
  return {
    pass,
    student: checked.student,
    exam: checked.exam,
    startUrl: buildSebStartUrl(req, pass.token),
    quitUrl: buildSebQuitUrl(req, pass.token),
    configUrl: buildSebConfigUrl(pass.token)
  };
}
function isSoftDeletedRecord(item) {
  if (!item) return false;
  const status = String(item.status || "").trim().toLowerCase();
  return Boolean(
    item.deleted === true || item.isDeleted === true || item.deletedAt || item.archivedAt || item.revokedAt || status === "deleted" || status === "removed"
  );
}
function isArchivedJoinCodeRecord(jc) {
  if (!jc) return false;
  const status = String(jc.status || "").trim().toLowerCase();
  return Boolean(
    jc.archived === true || jc.isArchived === true || jc.archivedAt || jc.retiredAt || jc.retiredReason || status === "retired" || status === "archived" || status === "archive"
  );
}
function isUsableJoinCodeRecord(jc) {
  return !!jc && !isSoftDeletedRecord(jc) && !isArchivedJoinCodeRecord(jc);
}
function isOperationalJoinCodeRecord(jc) {
  if (!isUsableJoinCodeRecord(jc)) return false;
  const course = joinCodeCourse(jc);
  if (!course || course.toLowerCase() === "all") return true;
  return sectionStillExists(course);
}
function joinCodeCourse(jc) {
  return String(jc?.sectionCode || jc?.studentSection || jc?.courseCode || "").trim();
}
function joinCodeLinkedToStudent(jc, studentIds) {
  if (!jc || !studentIds?.size) return false;
  const linkedIds = [jc.studentId, jc.usedByStudentId, jc.assignedStudentId].map((value) => normalizeStudentId(value)).filter(Boolean);
  return linkedIds.some((value) => studentIds.has(value));
}
function activatedCourseCodesForStudent(student, extraCourseCode) {
  const codes = [];
  const add = (value) => {
    const code = String(value || "").trim();
    if (!code || code.toLowerCase() === "all") return;
    if (!codes.some((existing) => sectionCodeEquivalent(existing, code))) codes.push(code);
  };
  (Array.isArray(student?.activatedCourseCodes) ? student.activatedCourseCodes : []).forEach(add);
  add(extraCourseCode);
  const activationCode = compactJoinCode(student?.activationCode || "");
  if (activationCode) {
    try {
      dbInstance.getJoinCodes().forEach((jc) => {
        if (!isUsableJoinCodeRecord(jc)) return;
        if (compactJoinCode(jc?.code || "") === activationCode)
          add(joinCodeCourse(jc));
      });
    } catch {
    }
  }
  return codes;
}
function buildPersistentStudentEnrollment(student, courseCode, source = "activation") {
  const code = String(courseCode || "").trim();
  if (!code || code.toLowerCase() === "all") return null;
  const sec = sectionForCourseCode(code) || resolveSectionForStudentGate(code);
  const teacherEmail = sec?.ownerEmail || extractEmailFromSectionCode(code) || sectionOwnerEmail(code);
  return {
    courseCode: code,
    sectionCode: code,
    studentSection: code,
    teacherEmail,
    teacherName: dbInstance.getTeachers().find((t) => String(t.email || "").toLowerCase() === String(teacherEmail || "").toLowerCase())?.name || sec?.teacherName || "",
    courseName: sec?.courseName || sec?.name || sectionDisplayCode(code) || code,
    status: "active",
    isActive: true,
    isLocked: false,
    isOpen: true,
    activatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source
  };
}
function mergePersistentStudentEnrollment(student, courseCode, source = "activation") {
  const next = buildPersistentStudentEnrollment(student, courseCode, source);
  const current = Array.isArray(student?.enrollments) ? student.enrollments : [];
  if (!next) return current;
  let found = false;
  const merged = current.filter((entry) => entry && typeof entry === "object").map((entry) => {
    const entryCode = entry.courseCode || entry.sectionCode || entry.studentSection;
    if (sectionCodeEquivalent(entryCode, next.courseCode)) {
      found = true;
      return { ...entry, ...next, activatedAt: next.activatedAt };
    }
    return entry;
  });
  if (!found) merged.push(next);
  return merged;
}
function buildStudentActivationPersistencePatch(student, courseCode) {
  const code = String(courseCode || student?.sectionCode || "").trim();
  const activatedCourseCodes = activatedCourseCodesForStudent(student, code);
  const remainingRemovalLinks = canonicalStudentRemovedCourseLinks(student).filter(
    (entry) => !courseMatchesRemovalTarget(
      entry?.courseCode || entry?.sectionCode || entry?.studentSection,
      code,
      entry?.teacherEmail || sectionOwnerEmail(code)
    )
  );
  const activatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const patch = {
    activatedCourseCodes,
    enrollments: mergePersistentStudentEnrollment(student, code).map((entry) => {
      const entryCode = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      return courseMatchesRemovalTarget(entryCode, code, entry?.teacherEmail || sectionOwnerEmail(code)) ? { ...entry, activatedAt } : entry;
    }),
    // التفعيل بالكود هو قرار سحابي نهائي لدورة العضوية الحالية؛ نمسح في نفس
    // عملية الحفظ كل صور علامة الحذف القديمة حتى لا تعيد إحداها إلغاء التفعيل.
    removedCourseLinks: remainingRemovalLinks,
    removedEnrollments: remainingRemovalLinks,
    deletedCourseLinks: remainingRemovalLinks,
    studentSection: code || student?.studentSection || student?.sectionCode || "",
    lastCourseActivationAt: activatedAt,
    courseVisibilitySyncedAt: activatedAt
  };
  if (!String(student?.sectionCode || "").trim() && code) patch.sectionCode = code;
  return patch;
}
function buildActivationCoursePayload(courseCode) {
  const code = String(courseCode || "").trim();
  const sec = sectionForCourseCode(code) || resolveSectionForStudentGate(code);
  const teacherEmail = String(
    sec?.ownerEmail || extractEmailFromSectionCode(code) || sectionOwnerEmail(code) || ""
  ).toLowerCase();
  const teacher = dbInstance.getTeachers().find((t) => String(t.email || "").toLowerCase() === teacherEmail);
  return {
    courseCode: code,
    sectionCode: code,
    studentSection: code,
    courseName: String(sec?.courseName || sec?.name || sectionDisplayCode(code) || code || "\u0627\u0644\u0645\u0642\u0631\u0631").trim(),
    teacherEmail,
    teacherName: teacher?.name || sec?.teacherName || "",
    isOpen: code ? isSectionOpenForStudents(code, { ownerEmail: teacherEmail }) : true
  };
}
function activationFailurePayload(code, error, extra = {}) {
  return {
    success: false,
    code,
    reason: code,
    error,
    message: error,
    ...extra
  };
}
function buildStudentActivationSuccessPayload(req, res, student, courseCode, enrollments, message, extra = {}) {
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
    enrollments
  };
  const session = {
    role: "student",
    userId: String(student?.id || ""),
    studentId: String(student?.id || ""),
    authToken,
    nextView: "student_workspace"
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
    ...extra
  };
}
function courseMatchesRemovalTarget(storedCourse, targetCourse, teacherEmail) {
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
function getStudentRemovedCourseLinks(student) {
  const pools = [
    student?.removedCourseLinks,
    student?.removedEnrollments,
    student?.deletedCourseLinks
  ];
  return pools.flatMap((value) => Array.isArray(value) ? value : []);
}
function canonicalStudentRemovedCourseLinks(student) {
  const deduped = /* @__PURE__ */ new Map();
  getStudentRemovedCourseLinks(student).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const course = String(
      entry.courseCode || entry.sectionCode || entry.studentSection || ""
    ).trim();
    if (!course) return;
    const teacher = String(
      entry.teacherEmail || entry.ownerEmail || entry.removedBy || sectionOwnerEmail(course) || ""
    ).trim().toLowerCase();
    const studentId = normalizeStudentId(
      entry.studentId || student?.id || student?.idNumber || student?.studentId
    );
    const key = `${studentId}|${course.toLowerCase()}|${teacher}`;
    const previous = deduped.get(key);
    const previousTime = Date.parse(String(previous?.removedAt || previous?.deletedAt || "")) || 0;
    const nextTime = Date.parse(String(entry.removedAt || entry.deletedAt || "")) || 0;
    if (!previous || nextTime >= previousTime) deduped.set(key, entry);
  });
  return Array.from(deduped.values());
}
function getStudentCourseCodeInvalidations(student) {
  const pools = [
    student?.courseCodeInvalidations,
    student?.joinCodeInvalidations,
    student?.removedJoinCodeInvalidations
  ];
  const explicit = pools.flatMap((value) => Array.isArray(value) ? value : []);
  const removalFallback = canonicalStudentRemovedCourseLinks(student).map((entry) => ({
    ...entry,
    invalidatedAt: entry?.invalidatedAt || entry?.removedAt || entry?.deletedAt || "",
    invalidationReason: entry?.invalidationReason || "student_removed_from_course"
  }));
  return [...explicit, ...removalFallback].filter((entry) => entry && typeof entry === "object");
}
function invalidatedJoinCodeCompactsFromEntry(entry) {
  const values = [
    entry?.code,
    entry?.joinCode,
    entry?.activationCode,
    ...Array.isArray(entry?.invalidatedJoinCodes) ? entry.invalidatedJoinCodes : [],
    ...Array.isArray(entry?.invalidatedJoinCodeCompacts) ? entry.invalidatedJoinCodeCompacts : [],
    ...Array.isArray(entry?.codes) ? entry.codes : []
  ];
  return new Set(values.map((value) => compactJoinCode(value)).filter(Boolean));
}
function latestStudentCourseCodeInvalidation(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return { time: 0, at: "", codes: /* @__PURE__ */ new Set(), entry: null };
  let latest = { time: 0, at: "", codes: /* @__PURE__ */ new Set(), entry: null };
  getStudentCourseCodeInvalidations(student).forEach((entry) => {
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
        entry
      };
    }
  });
  return latest;
}
function joinCodeLifecycleTime(jc) {
  return Date.parse(String(jc?.activatedAt || jc?.usedAt || "")) || Date.parse(String(jc?.createdAt || jc?.issuedAt || jc?.reissuedAt || "")) || 0;
}
function joinCodeIsConsumedRecord(jc) {
  if (!jc) return false;
  const status = String(jc?.status || "").trim().toLowerCase();
  return Boolean(
    status === "used" || status === "active-used" || status === "activated" || String(jc?.activatedAt || jc?.usedAt || "").trim() || String(jc?.usedByStudentId || "").trim()
  );
}
function joinCodeLockedActivationCourse(jc) {
  if (!jc) return "";
  const candidates = [
    jc?.resolvedCourseCode,
    jc?.activatedCourseCode,
    jc?.sectionCode,
    jc?.courseCode,
    jc?.studentSection
  ];
  for (const value of candidates) {
    const code = String(value || "").trim();
    if (code && code.toLowerCase() !== "all") return code;
  }
  return "";
}
function consumedJoinCodeMatchesCourse(jc, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!joinCodeIsConsumedRecord(jc) || !course || course.toLowerCase() === "all") return false;
  const lockedCourse = joinCodeLockedActivationCourse(jc);
  if (!lockedCourse) return false;
  return courseMatchesRemovalTarget(
    lockedCourse,
    course,
    teacherEmail || joinCodeOwnerEmail(jc)
  );
}
function joinCodeIsStaleForStudentCourse(jc, student, courseCode, teacherEmail) {
  if (!jc || !student) return false;
  const course = String(courseCode || "").trim();
  if (!course || course.toLowerCase() === "all") return false;
  const invalidation = latestStudentCourseCodeInvalidation(student, course, teacherEmail);
  if (!invalidation.time && !invalidation.codes.size) return false;
  const compact = compactJoinCode(jc?.code || "");
  if (compact && invalidation.codes.has(compact)) return true;
  if (!joinCodeMatchesStudentCourseIgnoringRemoval(jc, student, course, teacherEmail)) return false;
  const lifecycleTime = joinCodeLifecycleTime(jc);
  return !lifecycleTime || !invalidation.time || lifecycleTime <= invalidation.time;
}
function buildStudentCourseCodeInvalidationPatch(student, courseCode, teacherEmail, linkedJoinCodes = []) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const teacher = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  const invalidatedJoinCodes = Array.from(
    new Set(
      [
        ...Array.isArray(linkedJoinCodes) ? linkedJoinCodes.map((jc) => jc?.code || jc) : [],
        student?.activationCode
      ].map((value) => normalizeJoinCode(value)).filter(Boolean)
    )
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
    invalidatedJoinCodeCompacts: invalidatedJoinCodes.map((value) => compactJoinCode(value)).filter(Boolean)
  };
  const existing = (Array.isArray(student?.courseCodeInvalidations) ? student.courseCodeInvalidations : []).filter((entry) => {
    const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
    const entryTeacher = entry?.teacherEmail || entry?.ownerEmail || entry?.removedBy || teacher;
    return !courseMatchesRemovalTarget(entryCourse, course, entryTeacher || teacher);
  });
  const next = [...existing, marker];
  return {
    courseCodeInvalidations: next,
    joinCodeInvalidations: next
  };
}
function latestStudentCourseActivationTime(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return 0;
  let latest = 0;
  const consider = (value) => {
    const time = Date.parse(String(value || "")) || 0;
    if (time > latest) latest = time;
  };
  if (Array.isArray(student?.enrollments)) {
    student.enrollments.forEach((entry) => {
      const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      if (courseMatchesRemovalTarget(entryCourse, course, entry?.teacherEmail || teacherEmail)) {
        consider(entry?.activatedAt || entry?.reactivatedAt);
      }
    });
  }
  try {
    dbInstance.getJoinCodes().forEach((jc) => {
      const status = String(jc?.status || "").toLowerCase();
      if (!["used", "active-used", "activated"].includes(status)) return;
      if (!joinCodeMatchesStudentCourseIgnoringRemoval(jc, student, course, teacherEmail)) return;
      consider(jc?.activatedAt || jc?.usedAt);
    });
  } catch {
  }
  return latest;
}
function joinCodeMatchesStudentCourseIgnoringRemoval(jc, student, courseCode, teacherEmail) {
  if (!jc || !student) return false;
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid || !joinCodeLinkedToStudent(jc, /* @__PURE__ */ new Set([sid]))) return false;
  const owner = String(teacherEmail || joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
  const jcCourse = joinCodeCourse(jc);
  if (!jcCourse || !courseMatchesRemovalTarget(jcCourse, courseCode, owner || teacherEmail)) return false;
  const jcOwner = String(joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
  return !owner || !jcOwner || jcOwner === owner;
}
function isStudentCourseRemoved(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return false;
  const latestActivation = latestStudentCourseActivationTime(student, course, teacherEmail);
  return canonicalStudentRemovedCourseLinks(student).some((entry) => {
    if (!entry || entry.restoredAt || entry.isRestored === true || entry.status === "restored") return false;
    const removedCourse = entry.courseCode || entry.sectionCode || entry.studentSection;
    const entryTeacher = entry.teacherEmail || entry.ownerEmail || entry.removedBy || teacherEmail;
    if (!courseMatchesRemovalTarget(removedCourse, course, entryTeacher || teacherEmail)) return false;
    const removedAt = Date.parse(String(entry.removedAt || entry.deletedAt || "")) || 0;
    return !latestActivation || !removedAt || removedAt >= latestActivation;
  });
}
function withoutRemovedStudentCourses(student, courses, teacherEmail) {
  return courses.filter((course) => !isStudentCourseRemoved(student, course, teacherEmail));
}
function joinCodeMatchesStudentCourse(jc, student, courseCode, teacherEmail) {
  if (!jc || !student) return false;
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid) return false;
  if (!joinCodeLinkedToStudent(jc, /* @__PURE__ */ new Set([sid]))) return false;
  const owner = String(teacherEmail || joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
  const jcCourse = joinCodeCourse(jc);
  if (!jcCourse || !courseMatchesRemovalTarget(jcCourse, courseCode, owner || teacherEmail)) return false;
  if (owner) {
    const jcOwner = String(joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
    if (jcOwner && jcOwner !== owner) return false;
  }
  return !isStudentCourseRemoved(student, jcCourse, owner || teacherEmail);
}
function getFreshJoinCodeForStudentCourse(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!student || !course || !sid) return null;
  const expectedOwner = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  return dbInstance.getJoinCodes().find((jc) => {
    if (!isUsableJoinCodeRecord(jc)) return false;
    const status = String(jc.status || "active").trim().toLowerCase();
    if (status !== "active") return false;
    const assigned = normalizeStudentId(jc.assignedStudentId || jc.studentId);
    if (assigned !== sid) return false;
    if (String(jc.activatedAt || jc.usedAt || "").trim()) return false;
    const jcCourse = joinCodeCourse(jc);
    const owner = String(joinCodeOwnerEmail(jc) || "").trim().toLowerCase();
    const ownerMatches = expectedOwner ? !owner || owner === expectedOwner : true;
    return ownerMatches && courseMatchesRemovalTarget(jcCourse, course, expectedOwner || owner || teacherEmail);
  }) || null;
}
function studentHasCurrentRosterCourseLink(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!student || !course || !sid) return false;
  const owner = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  return dbInstance.getAllowedStudents().some((row) => {
    if (!row || isSoftDeletedRecord(row)) return false;
    const rowId = normalizeStudentId(row.id || row.idNumber || row.studentId);
    if (rowId !== sid) return false;
    const rowCourse = row.sectionCode || row.studentSection || row.courseCode || "";
    const rowOwner = String(row.teacherEmail || row.ownerEmail || sectionOwnerEmail(rowCourse) || "").trim().toLowerCase();
    if (owner && rowOwner && rowOwner !== owner) return false;
    return courseMatchesRemovalTarget(rowCourse, course, owner || rowOwner || teacherEmail);
  });
}
function studentHasOperationalUsedJoinCode(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return false;
  return dbInstance.getJoinCodes().some((jc) => {
    if (!isUsableJoinCodeRecord(jc)) return false;
    const status = String(jc.status || "").toLowerCase();
    if (!["used", "active-used", "activated"].includes(status) && !String(jc.activatedAt || jc.usedAt || "").trim()) return false;
    return joinCodeMatchesStudentCourse(jc, student, course, teacherEmail);
  });
}
function studentHasPersistentActiveEnrollment(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!student || !course || isStudentCourseRemoved(student, course, teacherEmail)) return false;
  if (!Array.isArray(student?.enrollments)) return false;
  return student.enrollments.some((entry) => {
    const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
    if (!courseMatchesRemovalTarget(entryCourse, course, entry?.teacherEmail || teacherEmail)) return false;
    const state = String(entry?.enrollmentState || entry?.status || "").trim().toLowerCase();
    if (entry?.isActive === false || entry?.pendingActivation === true || entry?.requiresJoinCode === true || entry?.isSuspended === true || entry?.isStudentSuspended === true || entry?.isClosedByTeacher === true || entry?.isCourseClosed === true || entry?.isOpen === false || ["pending_activation", "locked", "suspended", "student_suspended", "course_closed", "removed", "not_enrolled", "roster_only"].includes(state)) {
      return false;
    }
    return entry?.isActive === true || state === "active" || !!entry?.activatedAt || !!entry?.reactivatedAt || String(entry?.source || "").toLowerCase().includes("activation");
  });
}
function hasActivatedStudentCourseLink(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!student || !course || isStudentCourseRemoved(student, course, teacherEmail)) return false;
  const hasCurrentRoster = studentHasCurrentRosterCourseLink(student, course, teacherEmail);
  const hasUsedJoinCode = studentHasOperationalUsedJoinCode(student, course, teacherEmail);
  const hasPersistentEnrollment = studentHasPersistentActiveEnrollment(student, course, teacherEmail);
  const hasCurrentMembershipAnchor = hasCurrentRoster || hasUsedJoinCode || hasPersistentEnrollment;
  if (!hasCurrentMembershipAnchor) return false;
  if (activatedCourseCodesForStudent(student).some((code) => courseMatchesRemovalTarget(code, course, teacherEmail))) return true;
  if (hasPersistentEnrollment) return true;
  return hasUsedJoinCode;
}
function buildStudentCourseRemovalPatch(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  const existing = canonicalStudentRemovedCourseLinks(student).filter(
    (entry) => !courseMatchesRemovalTarget(entry?.courseCode || entry?.sectionCode || entry?.studentSection, course, entry?.teacherEmail || teacherEmail)
  );
  const marker = {
    studentId: String(student?.id || student?.idNumber || "").trim(),
    courseCode: course,
    sectionCode: course,
    studentSection: course,
    teacherEmail: String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase(),
    removedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "removed"
  };
  const next = [...existing, marker];
  return {
    removedCourseLinks: next,
    removedEnrollments: next,
    deletedCourseLinks: next
  };
}
function buildCleanStudentCourseReaddPatch(student, courseCode, teacherEmail) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return {};
  const patch = {};
  const links = canonicalStudentRemovedCourseLinks(student);
  const remainingLinks = links.filter(
    (entry) => !courseMatchesRemovalTarget(entry?.courseCode || entry?.sectionCode || entry?.studentSection, course, entry?.teacherEmail || teacherEmail)
  );
  if (remainingLinks.length !== links.length) {
    patch.removedCourseLinks = remainingLinks;
    patch.removedEnrollments = remainingLinks;
    patch.deletedCourseLinks = remainingLinks;
  }
  const cleanArrayOfCourses = (arr) => arr.filter((c) => !courseMatchesRemovalTarget(c, course, teacherEmail));
  const cleanEnrollmentArray = (arr) => arr.filter((en) => !courseMatchesRemovalTarget(en?.courseCode || en?.sectionCode || en?.studentSection, course, en?.teacherEmail || teacherEmail));
  if (Array.isArray(student.activatedCourseCodes)) patch.activatedCourseCodes = cleanArrayOfCourses(student.activatedCourseCodes);
  if (Array.isArray(student.enrollments)) patch.enrollments = cleanEnrollmentArray(student.enrollments);
  if (Array.isArray(student.suspendedEnrollments)) patch.suspendedEnrollments = cleanEnrollmentArray(student.suspendedEnrollments);
  const currentActivationCode = compactJoinCode(student.activationCode || "");
  if (currentActivationCode) {
    const activationCodeBelongsToCourse = dbInstance.getJoinCodes().some((jc) => {
      if (compactJoinCode(jc?.code || "") !== currentActivationCode) return false;
      return courseMatchesRemovalTarget(joinCodeCourse(jc), course, teacherEmail);
    });
    if (activationCodeBelongsToCourse) patch.activationCode = "";
  }
  const remainingVisibleCourses = Array.from(new Set([
    ...Array.isArray(patch.activatedCourseCodes) ? patch.activatedCourseCodes : Array.isArray(student.activatedCourseCodes) ? student.activatedCourseCodes : [],
    ...(Array.isArray(patch.enrollments) ? patch.enrollments : Array.isArray(student.enrollments) ? student.enrollments : []).map((en) => en?.courseCode || en?.sectionCode || en?.studentSection)
  ].map((v) => String(v || "").trim()).filter(Boolean)));
  const fallbackCourse = remainingVisibleCourses.find((c) => !courseMatchesRemovalTarget(c, course, teacherEmail)) || "";
  if (courseMatchesRemovalTarget(student.sectionCode, course, teacherEmail)) patch.sectionCode = fallbackCourse;
  if (courseMatchesRemovalTarget(student.studentSection, course, teacherEmail)) patch.studentSection = fallbackCourse;
  if (student.isAccessBlocked && String(student.accessBlockReason || "") === "\u062A\u0645 \u062D\u0630\u0641\u0643 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0623\u062E\u064A\u0631 \u0627\u0644\u0645\u0639\u064A\u0646 \u0644\u0643.") {
    patch.isAccessBlocked = false;
    patch.accessBlockReason = "";
  }
  patch.courseVisibilitySyncedAt = (/* @__PURE__ */ new Date()).toISOString();
  patch.cleanReaddAt = (/* @__PURE__ */ new Date()).toISOString();
  return patch;
}
function buildStudentCourseDeepRemovalPatch(student, courseCode, teacherEmail, linkedJoinCodes = []) {
  const course = String(courseCode || "").trim();
  const patch = buildCleanStudentCourseReaddPatch(student, course, teacherEmail);
  Object.assign(patch, buildStudentCourseRemovalPatch(student, course, teacherEmail));
  Object.assign(patch, buildStudentCourseCodeInvalidationPatch(student, course, teacherEmail, linkedJoinCodes));
  patch.cleanReaddAt = void 0;
  patch.courseRemovedAt = (/* @__PURE__ */ new Date()).toISOString();
  return patch;
}
function buildStudentCourseActivationResetPatch(student, courseCode, teacherEmail, linkedJoinCodes = []) {
  const course = String(courseCode || "").trim();
  if (!student || !course) return {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const owner = String(teacherEmail || sectionOwnerEmail(course) || "").trim().toLowerCase();
  const matchesCourse = (value, entryTeacher) => courseMatchesRemovalTarget(value, course, entryTeacher || owner);
  const codeCompacts = new Set(
    (Array.isArray(linkedJoinCodes) ? linkedJoinCodes : []).map((jc) => compactJoinCode(jc?.code || jc)).filter(Boolean)
  );
  const patch = {};
  if (Array.isArray(student.activatedCourseCodes)) {
    patch.activatedCourseCodes = student.activatedCourseCodes.filter(
      (value) => !matchesCourse(value)
    );
  }
  const existingEnrollments = Array.isArray(student.enrollments) ? student.enrollments : [];
  const keptEnrollments = existingEnrollments.filter(
    (entry) => !matchesCourse(
      entry?.courseCode || entry?.sectionCode || entry?.studentSection,
      entry?.teacherEmail || entry?.ownerEmail
    )
  );
  const sec = sectionForCourseCode(course, owner) || resolveSectionForStudentGate(course);
  const courseName = String(sec?.courseName || sec?.name || sectionDisplayCode(course) || courseNameFromCode(course) || course).trim();
  keptEnrollments.push({
    studentId: String(student.id || student.idNumber || student.studentId || "").trim(),
    courseCode: course,
    sectionCode: course,
    studentSection: course,
    teacherEmail: owner,
    teacherName: dbInstance.getTeachers().find((t) => String(t.email || "").toLowerCase() === owner)?.name || sec?.teacherName || "",
    courseName,
    status: "pending_activation",
    enrollmentState: "pending_activation",
    isActive: false,
    isLocked: true,
    isOpen: true,
    requiresJoinCode: true,
    pendingActivation: true,
    activationResetAt: now,
    activationResetReason: "join_code_deleted_from_archive"
  });
  patch.enrollments = keptEnrollments;
  const remainingRemovalLinks = canonicalStudentRemovedCourseLinks(student).filter(
    (entry) => !matchesCourse(
      entry?.courseCode || entry?.sectionCode || entry?.studentSection,
      entry?.teacherEmail || entry?.ownerEmail || entry?.removedBy
    )
  );
  patch.removedCourseLinks = remainingRemovalLinks;
  patch.removedEnrollments = remainingRemovalLinks;
  patch.deletedCourseLinks = remainingRemovalLinks;
  const currentActivationCompact = compactJoinCode(student.activationCode || "");
  if (currentActivationCompact && (!codeCompacts.size || codeCompacts.has(currentActivationCompact))) {
    patch.activationCode = "";
  }
  const fallbackCourse = Array.from(new Set([
    ...Array.isArray(patch.activatedCourseCodes) ? patch.activatedCourseCodes : [],
    ...keptEnrollments.filter(
      (entry) => entry?.isActive === true || String(entry?.status || "").toLowerCase() === "active"
    ).map((entry) => entry?.courseCode || entry?.sectionCode || entry?.studentSection)
  ].map((value) => String(value || "").trim()).filter(Boolean))).find((value) => !matchesCourse(value)) || "";
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
function deleteRetiredJoinCodeRecord(code) {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return false;
  const data = dbInstance.data;
  if (!data || !Array.isArray(data.retiredJoinCodes)) return false;
  const before = data.retiredJoinCodes.length;
  data.retiredJoinCodes = data.retiredJoinCodes.filter(
    (item) => String(item?.code || "").trim().toUpperCase() !== key
  );
  if (data.retiredJoinCodes.length !== before) {
    try {
      dbInstance.persist?.();
    } catch {
    }
    return true;
  }
  return false;
}
function getStudentRosterCourseCodes(student) {
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid) return [];
  const codes = /* @__PURE__ */ new Set();
  try {
    dbInstance.getAllowedStudents().forEach((row) => {
      if (normalizeStudentId(row.idNumber || row.id || row.studentId) !== sid) return;
      const course = String(row.sectionCode || row.studentSection || row.courseCode || "").trim();
      if (course && course.toLowerCase() !== "all") codes.add(course);
    });
  } catch {
  }
  return withoutRemovedStudentCourses(student, Array.from(codes));
}
function getStudentDiscoveredCourseCodes(student, options = {}) {
  const sid = normalizeStudentId(student?.id);
  const codes = /* @__PURE__ */ new Set();
  const add = (v) => {
    const code = String(v || "").trim();
    if (code && code.toLowerCase() !== "all") codes.add(code);
  };
  add(student?.sectionCode);
  add(student?.studentSection);
  activatedCourseCodesForStudent(student).forEach(add);
  if (Array.isArray(student?.enrollments)) {
    student.enrollments.forEach(
      (entry) => add(entry?.courseCode || entry?.sectionCode || entry?.studentSection)
    );
  }
  if (options.includeRosterOnly === true) {
    getStudentRosterCourseCodes(student).forEach(add);
  }
  try {
    dbInstance.getJoinCodes().forEach((jc) => {
      if (!isUsableJoinCodeRecord(jc)) return;
      if (normalizeStudentId(jc.assignedStudentId || jc.studentId) === sid || normalizeStudentId(jc.usedByStudentId) === sid)
        add(joinCodeCourse(jc));
    });
  } catch {
  }
  try {
    dbInstance.getTeacherSubmissions().forEach((sub) => {
      if (normalizeStudentId(sub.studentId) === sid)
        add(sub.courseCode || sub.sectionCode);
    });
  } catch {
  }
  return withoutRemovedStudentCourses(student, Array.from(codes));
}
function resolveSectionForStudentGate(courseCode, context) {
  const raw = String(courseCode || "").trim();
  if (!raw) return null;
  const contextOwner = String(
    context?.ownerEmail || context?.teacherEmail || context?.createdByEmail || context?.actorEmail || extractEmailFromSectionCode(raw) || ""
  ).trim().toLowerCase();
  const exact = activeSections().find((sec) => {
    if (String(sec.code || "").toLowerCase() !== raw.toLowerCase())
      return false;
    if (!contextOwner) return true;
    return String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() === contextOwner;
  });
  if (exact) return exact;
  const display = sectionDisplayCode(raw).toLowerCase();
  if (!display) return null;
  return activeSections().find((sec) => {
    if (sectionDisplayCode(sec.code).toLowerCase() !== display) return false;
    if (!contextOwner) return true;
    return String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() === contextOwner;
  }) || null;
}
function isSectionOpenForStudents(courseCode, context) {
  const raw = String(courseCode || "").trim();
  if (!raw) return false;
  const sec = resolveSectionForStudentGate(courseCode, context);
  return sec ? sec.isOpen !== false : true;
}
function suspensionCourseMatches(entry, courseCode) {
  const target = String(courseCode || "").trim().toLowerCase();
  if (!target) return false;
  return [entry?.courseCode, entry?.sectionCode].some(
    (value) => String(value || "").trim().toLowerCase() === target
  );
}
function getSuspendedEnrollmentRecord(student, courseCode) {
  const list = Array.isArray(student?.suspendedEnrollments) ? student.suspendedEnrollments : [];
  return list.find(
    (entry) => entry?.isSuspended === true && suspensionCourseMatches(entry, courseCode)
  );
}
function isStudentSuspendedInCourse(student, courseCode) {
  return !!getSuspendedEnrollmentRecord(student, courseCode);
}
function studentAccessIsTeacherHold(student) {
  if (!student?.isAccessBlocked) return false;
  const reason = String(student?.accessBlockReason || "");
  return reason.includes("\u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0624\u0642\u062A") || reason.includes("\u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631");
}
function setNoCache(res) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  } catch {
  }
}
function touchStudentsLinkedToCourse(courseCode) {
  try {
    const course = String(courseCode || "").trim();
    if (!course) return;
    dbInstance.getStudents().forEach((student) => {
      if (getStudentDiscoveredCourseCodes(student).some((code) => sectionCodeEquivalent(code, course))) {
        dbInstance.updateStudent(student.id, {
          courseVisibilitySyncedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
  } catch {
  }
}
function setStudentCourseSuspension(student, courseCode, teacherEmail, suspended, reason = "") {
  const normalizedCourse = String(courseCode || "").trim();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = Array.isArray(student?.suspendedEnrollments) ? student.suspendedEnrollments : [];
  let touched = false;
  const next = existing.map((entry) => {
    if (!suspensionCourseMatches(entry, normalizedCourse)) return entry;
    touched = true;
    return suspended ? {
      ...entry,
      studentId: String(student.id),
      courseCode: normalizedCourse,
      sectionCode: normalizedCourse,
      teacherEmail,
      isSuspended: true,
      suspendedAt: entry.suspendedAt || now,
      suspendedBy: teacherEmail,
      suspensionReason: reason || entry.suspensionReason || ""
    } : {
      ...entry,
      studentId: String(student.id),
      courseCode: normalizedCourse,
      sectionCode: normalizedCourse,
      teacherEmail: entry.teacherEmail || teacherEmail,
      isSuspended: false,
      reactivatedAt: now,
      reactivatedBy: teacherEmail
    };
  });
  if (!touched) {
    next.push({
      studentId: String(student.id),
      courseCode: normalizedCourse,
      sectionCode: normalizedCourse,
      teacherEmail,
      isSuspended: suspended,
      suspendedAt: suspended ? now : void 0,
      suspendedBy: suspended ? teacherEmail : void 0,
      suspensionReason: reason || "",
      reactivatedAt: suspended ? void 0 : now,
      reactivatedBy: suspended ? void 0 : teacherEmail
    });
  }
  dbInstance.updateStudent(student.id, { suspendedEnrollments: next });
  return dbInstance.getStudents().find((st) => String(st.id) === String(student.id)) || {
    ...student,
    suspendedEnrollments: next
  };
}
function getStudentActiveCourseCodes(student) {
  const sid = normalizeStudentId(student?.id);
  const active = /* @__PURE__ */ new Set();
  const add = (v) => {
    const code = String(v || "").trim();
    if (code && code.toLowerCase() !== "all" && isSectionOpenForStudents(code) && !isStudentSuspendedInCourse(student, code) && !isStudentCourseRemoved(student, code))
      active.add(code);
  };
  try {
    dbInstance.getJoinCodes().forEach((jc) => {
      if (!isUsableJoinCodeRecord(jc)) return;
      const linked = normalizeStudentId(
        jc.studentId || jc.usedByStudentId || jc.assignedStudentId
      ) === sid;
      const status = String(jc.status || "").toLowerCase();
      if (linked && (status === "used" || status === "active-used" || status === "activated")) {
        const code = joinCodeCourse(jc);
        if (isSectionOpenForStudents(code, jc) && !isStudentSuspendedInCourse(student, code) && !isStudentCourseRemoved(student, code, jc.ownerEmail || jc.teacherEmail || jc.createdByEmail))
          active.add(String(code || "").trim());
      }
    });
  } catch {
  }
  activatedCourseCodesForStudent(student).forEach((code) => {
    if (hasActivatedStudentCourseLink(student, code, sectionOwnerEmail(code))) add(code);
  });
  if (Array.isArray(student?.enrollments)) {
    student.enrollments.forEach((entry) => {
      const state = String(entry?.enrollmentState || entry?.status || "").trim().toLowerCase();
      if (entry?.isActive === false || entry?.pendingActivation === true || entry?.requiresJoinCode === true || state === "pending_activation" || state === "locked" || state === "suspended" || state === "student_suspended" || entry?.isSuspended === true) return;
      const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      if (hasActivatedStudentCourseLink(student, entryCourse, entry?.teacherEmail || sectionOwnerEmail(entryCourse))) add(entryCourse);
    });
  }
  if (!active.size && student?.isPaid && String(student?.activationCode || "").trim()) {
    const legacyCourse = student?.sectionCode || student?.studentSection;
    if (studentHasOperationalUsedJoinCode(student, legacyCourse, sectionOwnerEmail(legacyCourse))) {
      add(legacyCourse);
    }
  }
  return Array.from(active);
}
function studentHasEnrollmentInCourse(student, courseCode) {
  const code = String(courseCode || "").trim().toLowerCase();
  if (!code) return true;
  return getStudentActiveCourseCodes(student).some(
    (c) => sectionCodeEquivalent(c, courseCode)
  );
}
function getStudentEnrollmentDetails(student) {
  const rosterOnlyCodes = getStudentRosterCourseCodes(student);
  const allCodes = getStudentDiscoveredCourseCodes(student, { includeRosterOnly: true }).filter(
    (courseCode) => !!(resolveSectionForStudentGate(courseCode) || sectionForCourseCode(courseCode))
  );
  const seen = /* @__PURE__ */ new Set();
  return allCodes.map((courseCode) => {
    const sec = resolveSectionForStudentGate(courseCode) || sectionForCourseCode(courseCode);
    const teacherEmail = String(
      sec?.ownerEmail || extractEmailFromSectionCode(courseCode) || sectionOwnerEmail(courseCode) || ""
    ).toLowerCase();
    const canonicalCourseCode = String(sec?.code || courseCode || "").trim();
    if (!canonicalCourseCode || canonicalCourseCode.toLowerCase() === "all") return null;
    const dedupeKey = `${canonicalCourseCode.toLowerCase()}|${teacherEmail}`;
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);
    const removedFromCourse = isStudentCourseRemoved(student, canonicalCourseCode, teacherEmail);
    if (removedFromCourse) return null;
    const teacher = dbInstance.getTeachers().find(
      (t) => String(t.email || "").toLowerCase() === String(teacherEmail || "").toLowerCase()
    );
    const isOpen = isSectionOpenForStudents(canonicalCourseCode, { ownerEmail: teacherEmail });
    const suspension = getSuspendedEnrollmentRecord(student, canonicalCourseCode);
    const isStudentSuspended = !!suspension;
    const freshJoinCode = getFreshJoinCodeForStudentCourse(student, canonicalCourseCode, teacherEmail);
    const hasFreshJoinCode = !!freshJoinCode;
    const hasActivatedLink = hasActivatedStudentCourseLink(student, canonicalCourseCode, teacherEmail);
    const isRosterLinked = rosterOnlyCodes.some(
      (code) => sectionCodeEquivalent(code, canonicalCourseCode)
    );
    const shouldShowPendingActivation = !hasActivatedLink && hasFreshJoinCode && isRosterLinked;
    if (!hasActivatedLink && !shouldShowPendingActivation) return null;
    let enrollmentState = "active";
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
      suspensionReason: suspension?.suspensionReason || ""
    };
  }).filter(Boolean);
}
function pruneGhostCoursePatch(student) {
  if (!student) return null;
  const exists = (code) => !!(resolveSectionForStudentGate(code) || sectionForCourseCode(code));
  const patch = {};
  let changed = false;
  if (Array.isArray(student.activatedCourseCodes)) {
    const cleaned = student.activatedCourseCodes.filter((c) => exists(c));
    if (cleaned.length !== student.activatedCourseCodes.length) {
      patch.activatedCourseCodes = cleaned;
      changed = true;
    }
  }
  if (Array.isArray(student.enrollments)) {
    const cleaned = student.enrollments.filter(
      (e) => exists(e?.courseCode || e?.sectionCode || e?.studentSection)
    );
    if (cleaned.length !== student.enrollments.length) {
      patch.enrollments = cleaned;
      changed = true;
    }
  }
  const firstReal = (Array.isArray(student.enrollments) ? student.enrollments : []).map((e) => String(e?.courseCode || e?.sectionCode || "").trim()).find((c) => c && exists(c)) || "";
  if (String(student.sectionCode || "").trim() && !exists(student.sectionCode)) {
    patch.sectionCode = firstReal;
    changed = true;
  }
  if (String(student.studentSection || "").trim() && !exists(student.studentSection)) {
    patch.studentSection = firstReal;
    changed = true;
  }
  return changed ? patch : null;
}
function sanitizeStudentForClient(student, enrollmentDetails) {
  if (!student) return student;
  const enrollments = Array.isArray(enrollmentDetails) ? enrollmentDetails : getStudentEnrollmentDetails(student);
  const visibleCodes = enrollments.map((entry) => String(entry?.courseCode || entry?.sectionCode || entry?.studentSection || "").trim()).filter(Boolean);
  const activatedVisibleCodes = enrollments.filter((entry) => entry?.pendingActivation !== true && entry?.requiresJoinCode !== true).map((entry) => String(entry?.courseCode || entry?.sectionCode || entry?.studentSection || "").trim()).filter(Boolean);
  const matchesAny = (code, pool) => pool.some((item) => sectionCodeEquivalent(item, code));
  const activatedCourseCodes = (Array.isArray(student.activatedCourseCodes) ? student.activatedCourseCodes : []).map((code) => String(code || "").trim()).filter(
    (code, index, list) => !!code && matchesAny(code, activatedVisibleCodes) && list.findIndex((item) => sectionCodeEquivalent(item, code)) === index
  );
  activatedVisibleCodes.forEach((code) => {
    if (!activatedCourseCodes.some((item) => sectionCodeEquivalent(item, code)))
      activatedCourseCodes.push(code);
  });
  const safeSection = (value) => {
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
    activationCode: keepActivationCode ? student.activationCode : ""
  };
}
function sectionStillExists(code) {
  const c = String(code || "").trim();
  if (!c || c.toLowerCase() === "all") return true;
  return !!(resolveSectionForStudentGate(c) || sectionForCourseCode(c));
}
function computeDataHealth() {
  const students = dbInstance.getStudents();
  const studentIds = new Set(students.map((s) => normalizeStudentId(s.id)).filter(Boolean));
  const codes = dbInstance.getJoinCodes();
  const roster = dbInstance.getAllowedStudents();
  let ghostStudents = 0;
  let ghostRefs = 0;
  students.forEach((s) => {
    const refs = /* @__PURE__ */ new Set();
    const add = (v) => {
      const c = String(v || "").trim();
      if (c && c.toLowerCase() !== "all" && !sectionStillExists(c)) refs.add(c.toLowerCase());
    };
    add(s.sectionCode);
    add(s.studentSection);
    (Array.isArray(s.activatedCourseCodes) ? s.activatedCourseCodes : []).forEach(add);
    (Array.isArray(s.enrollments) ? s.enrollments : []).forEach(
      (e) => add(e?.courseCode || e?.sectionCode || e?.studentSection)
    );
    if (refs.size) {
      ghostStudents += 1;
      ghostRefs += refs.size;
    }
  });
  const orphanCodes = codes.filter(
    (c) => !sectionStillExists(c.sectionCode || c.studentSection || c.courseCode)
  ).length;
  const deadLinkCodes = codes.filter((c) => {
    const linked = normalizeStudentId(c.studentId || c.usedByStudentId || c.assignedStudentId || "");
    return !!linked && !studentIds.has(linked);
  }).length;
  const rosterOrphans = roster.filter(
    (r) => !sectionStillExists(r.sectionCode || r.studentSection || r.courseCode)
  ).length;
  const activeDeadStudentCodes = codes.filter((c) => {
    const status = String(c.status || "active").toLowerCase();
    const linked = normalizeStudentId(c.assignedStudentId || c.studentId || c.usedByStudentId || "");
    return status === "active" && !!linked && !studentIds.has(linked);
  }).length;
  const activeDeletedCourseCodes = codes.filter(
    (c) => String(c.status || "active").toLowerCase() === "active" && !sectionStillExists(c.sectionCode || c.studentSection || c.courseCode)
  ).length;
  const activeDuplicateMap = /* @__PURE__ */ new Map();
  codes.forEach((c) => {
    if (String(c.status || "active").toLowerCase() !== "active") return;
    const sid = normalizeStudentId(c.assignedStudentId || c.studentId || c.usedByStudentId || "");
    const course = String(c.sectionCode || c.courseCode || c.studentSection || "").trim().toLowerCase();
    if (!sid || !course) return;
    const key = `${sid}|${course}|${joinCodeOwnerEmail(c)}`;
    activeDuplicateMap.set(key, (activeDuplicateMap.get(key) || 0) + 1);
  });
  const duplicateActiveStudentCourseCodes = Array.from(activeDuplicateMap.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const tamperedLedgers = codes.filter((c) => !verifyLedger(c).ok).length;
  const unsignedActiveCodes = codes.filter((c) => String(c.status || "active").toLowerCase() === "active" && !String(c.codeSignature || "").trim()).length;
  const byStatus = codes.reduce((acc, c) => {
    const st = String(c.status || "active").toLowerCase();
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});
  const frozen = codes.filter((c) => isJoinCodeTemporarilyFrozen(c)).length;
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
      frozen
    }
  };
}
function healDataIssues(actorEmail = "system") {
  const students = dbInstance.getStudents();
  const studentIds = new Set(students.map((s) => normalizeStudentId(s.id)).filter(Boolean));
  let healedStudents = 0;
  let archivedCodes = 0;
  let relinkedCodes = 0;
  let removedRoster = 0;
  students.forEach((s) => {
    const patch = pruneGhostCoursePatch(s);
    if (patch) {
      dbInstance.updateStudent(s.id, patch);
      healedStudents += 1;
    }
  });
  dbInstance.getJoinCodes().slice().forEach((c) => {
    if (!sectionStillExists(c.sectionCode || c.studentSection || c.courseCode)) {
      dbInstance.deleteJoinCode(c.code, "data_heal_orphan_code", actorEmail);
      archivedCodes += 1;
    }
  });
  dbInstance.getJoinCodes().forEach((c) => {
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
        isFreeCode: false
      });
      relinkedCodes += 1;
    }
  });
  const duplicateBuckets = /* @__PURE__ */ new Map();
  dbInstance.getJoinCodes().forEach((c) => {
    if (String(c.status || "active").toLowerCase() !== "active") return;
    const sid = normalizeStudentId(c.assignedStudentId || c.studentId || c.usedByStudentId || "");
    const course = String(c.sectionCode || c.courseCode || c.studentSection || "").trim().toLowerCase();
    if (!sid || !course) return;
    const key = `${sid}|${course}|${joinCodeOwnerEmail(c)}`;
    duplicateBuckets.set(key, [...duplicateBuckets.get(key) || [], c]);
  });
  duplicateBuckets.forEach((items) => {
    if (items.length <= 1) return;
    items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(1).forEach((c) => {
      dbInstance.deleteJoinCode(c.code, "data_heal_duplicate_active_code", actorEmail);
      archivedCodes += 1;
    });
  });
  const beforeRoster = dbInstance.getAllowedStudents().length;
  dbInstance.data.allowedStudents = dbInstance.getAllowedStudents().filter((r) => sectionStillExists(r.sectionCode || r.studentSection || r.courseCode));
  removedRoster = beforeRoster - dbInstance.getAllowedStudents().length;
  dbInstance.persist();
  return { healedStudents, archivedCodes, relinkedCodes, removedRoster };
}
function activeRuntimeTeacherProjects() {
  return dbInstance.getTeacherProjects().filter((project) => isActiveRecord(project));
}
function activeTeacherExams() {
  return dbInstance.getTeacherExams().filter((exam) => isActiveRecord(exam));
}
function activeQuestionBank() {
  return dbInstance.getQuestionBank().filter((q) => isActiveRecord(q));
}
function normalizeQuestionCategoryTokenServer(value) {
  return String(value || "").trim().toLowerCase();
}
function teacherChapterForToken(token, teacherEmail) {
  const normalizedToken = normalizeQuestionCategoryTokenServer(token);
  if (!normalizedToken) return null;
  const owner = String(teacherEmail || "").trim().toLowerCase();
  return dbInstance.getChapters().find((chapter) => {
    const chapterOwner = String(chapter?.teacherEmail || owner).toLowerCase();
    if (owner && chapterOwner !== owner) return false;
    return [chapter?.id, chapter?.title, chapter?.categoryTitle, chapter?.chapterTitle].map(normalizeQuestionCategoryTokenServer).includes(normalizedToken);
  }) || null;
}
function categoryAliasesForTokenServer(token, teacherEmail) {
  const raw = String(token || "").trim();
  if (!raw) return [];
  const chapter = teacherChapterForToken(raw, teacherEmail);
  return Array.from(
    new Set(
      [raw, chapter?.id, chapter?.title, chapter?.categoryTitle, chapter?.chapterTitle].map(normalizeQuestionCategoryTokenServer).filter(Boolean)
    )
  );
}
function questionCategoryAliasesServer(q, teacherEmail) {
  return Array.from(
    new Set(
      [
        q?.chapterId,
        q?.categoryId,
        q?.category,
        q?.categoryTitle,
        q?.chapterTitle,
        q?.chapter?.id,
        q?.chapter?.title
      ].flatMap((value) => categoryAliasesForTokenServer(value, teacherEmail)).filter(Boolean)
    )
  );
}
function questionMatchesSelectedCategoriesServer(q, selectedCategoriesInput, teacherEmail) {
  const selectedCategories = Array.isArray(selectedCategoriesInput) ? selectedCategoriesInput.map(String).filter(Boolean) : [];
  if (!selectedCategories.length) return true;
  const qAliases = questionCategoryAliasesServer(q, teacherEmail);
  return selectedCategories.some(
    (cat) => categoryAliasesForTokenServer(cat, teacherEmail).some((alias) => qAliases.includes(alias))
  );
}
function questionCourseMatchesExamServer(q, examCourseCode) {
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
    q?.section?.code
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (!candidates.length) return true;
  return candidates.some((candidate) => sectionCodeEquivalent(candidate, course));
}
function questionBelongsToTeacherServer(q, teacherEmail) {
  const owner = String(q?.teacherEmail || "ah.alfailakawi@paaet.edu.kw").toLowerCase();
  return owner === String(teacherEmail || "").trim().toLowerCase();
}
function questionMatchesOfficialExamServer(q, exam, teacherEmail) {
  return q?.isApproved === true && isActiveRecord(q) && questionBelongsToTeacherServer(q, teacherEmail) && questionCourseMatchesExamServer(q, exam?.courseCode) && questionMatchesSelectedCategoriesServer(q, exam?.selectedCategories, teacherEmail);
}
function canonicalizeQuestionPayloadForTeacher(q, teacherEmail) {
  const payload = { ...q || {} };
  const lookup = payload.chapterId || payload.categoryId || payload.categoryTitle || payload.chapterTitle || payload.category || "";
  const chapter = teacherChapterForToken(lookup, teacherEmail);
  if (chapter) {
    payload.chapterId = chapter.id || payload.chapterId;
    payload.categoryTitle = chapter.title || payload.categoryTitle;
    payload.chapterTitle = chapter.title || payload.chapterTitle;
  }
  return payload;
}
function gradeQuizAnswers(answers) {
  const matchedQuestions = [];
  let score = 0;
  let totalPoints = 0;
  const validAnswers = answers || {};
  for (const qId of Object.keys(validAnswers)) {
    const q = activeQuestionBank().find(
      (item) => String(item.id) === String(qId)
    );
    if (!q) continue;
    const studentAns = validAnswers[qId];
    let isCorrect = false;
    if (q.type === "multiple-choice" || q.type === "true-false") {
      isCorrect = String(studentAns).trim() === String(q.correctAnswer).trim();
    } else if (q.type === "short-answer" || q.type === "scenario-analysis") {
      isCorrect = String(studentAns).trim().toLowerCase().includes(String(q.correctAnswer).trim().toLowerCase());
    } else if (q.type === "matching") {
      let matchCount = 0;
      const originalMap = q.correctAnswer;
      const studentMap = studentAns || {};
      const keys = Object.keys(originalMap);
      keys.forEach((k) => {
        if (studentMap[k] === originalMap[k]) matchCount++;
      });
      isCorrect = matchCount === keys.length;
    } else if (q.type === "ordering") {
      const originalArray = q.correctAnswer;
      const studentArray = studentAns || [];
      isCorrect = JSON.stringify(originalArray) === JSON.stringify(studentArray);
    }
    const pointsEarned = isCorrect ? q.points : 0;
    score += pointsEarned;
    totalPoints += q.points;
    matchedQuestions.push({
      questionId: q.id,
      questionText: q.questionText,
      studentAnswer: studentAns,
      correctAnswer: q.type === "matching" || q.type === "ordering" ? q.correctAnswer : q.correctAnswer,
      isCorrect,
      pointsEarned
    });
  }
  return { score, totalPoints, matchedQuestions };
}
function activeRuntimeTeacherSubmissions() {
  const examIds = new Set(
    activeTeacherExams().map((exam) => String(exam.id))
  );
  const projectIds = new Set(
    [
      ...activeRuntimeTeacherProjects(),
      ...dbInstance.getPersonalizedProjects().filter((project) => isActiveRecord(project))
    ].map((project) => String(project.id))
  );
  return dbInstance.getTeacherSubmissions().filter((item) => {
    if (!isActiveRecord(item)) return false;
    const kind = String(item.kind || "");
    const activityId = String(item.activityId || "");
    if (kind === "exam") return examIds.has(activityId);
    if (kind === "project") return projectIds.has(activityId);
    return true;
  });
}
function normalizeStudentId(value) {
  return String(value ?? "").trim().replace(/[٠-٩]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d))).replace(/[۰-۹]/g, (d) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(d))).replace(/[^0-9]/g, "");
}
function liveStudentNameMap() {
  const map = /* @__PURE__ */ new Map();
  for (const student of dbInstance.getStudents()) {
    const id = normalizeStudentId(student.id);
    const name = String(student.name || "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}
function withLiveStudentNames(items, nameMap) {
  if (!Array.isArray(items) || !items.length) return items;
  const map = nameMap || liveStudentNameMap();
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const id = normalizeStudentId(
      item.studentId ?? item.linkedStudentId
    );
    const live = id ? map.get(id) : "";
    return live && live !== item.studentName ? { ...item, studentName: live } : item;
  });
}
function normalizeArabicDigits(value) {
  return String(value ?? "").replace(/[٠-٩]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d))).replace(/[۰-۹]/g, (d) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(d)));
}
function normalizeJoinCode(value) {
  if (!value) return "";
  const cleaned = String(value).trim().toUpperCase().replace(/[٠-٩]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d))).replace(/[۰-۹]/g, (d) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(d)));
  const compactRaw = cleaned.replace(/[^A-Z0-9]/g, "");
  if (!compactRaw) return "";
  if (compactRaw.startsWith(MIRAS_JOIN_CODE_PREFIX)) {
    const rawBody = compactRaw.slice(MIRAS_JOIN_CODE_PREFIX.length);
    const legacyDigits = rawBody.replace(/[OI]/g, (ch) => ch === "O" ? "0" : "1").replace(/\D/g, "");
    const looksLegacyNumeric = /^[0-9OI]+$/.test(rawBody);
    if (looksLegacyNumeric && legacyDigits.length === 8) {
      return `${MIRAS_JOIN_CODE_PREFIX}-${legacyDigits.slice(0, 4)}-${legacyDigits.slice(4, 8)}`;
    }
    if (looksLegacyNumeric && legacyDigits.length > 0 && legacyDigits.length < 8) {
      const a = legacyDigits.slice(0, 4);
      const b = legacyDigits.slice(4, 8);
      return [MIRAS_JOIN_CODE_PREFIX, a, b].filter(Boolean).join("-");
    }
    const body = rawBody.replace(/0/g, "O").replace(/1/g, "I").replace(/[^A-Z2-9]/g, "").slice(0, MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE);
    if (!body) return MIRAS_JOIN_CODE_PREFIX;
    const groups = [];
    for (let i = 0; i < body.length; i += MIRAS_JOIN_CODE_GROUP_SIZE) {
      groups.push(body.slice(i, i + MIRAS_JOIN_CODE_GROUP_SIZE));
    }
    return [MIRAS_JOIN_CODE_PREFIX, ...groups].join("-");
  }
  return cleaned;
}
function compactJoinCode(value) {
  const norm = normalizeJoinCode(value);
  return norm.replace(/-/g, "").toUpperCase();
}
function isUnifiedJoinCode(value) {
  const norm = normalizeJoinCode(value);
  return /^LAB-\d{4}-\d{4}$/.test(norm) || /^LAB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(norm);
}
function isFullMirasJoinCode(value) {
  return /^LAB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(
    normalizeJoinCode(value)
  );
}
function issuedJoinCodeCompacts() {
  const retired = typeof dbInstance.getRetiredJoinCodes === "function" ? dbInstance.getRetiredJoinCodes() : [];
  return new Set(
    [
      ...dbInstance.getJoinCodes().map((item) => compactJoinCode(item.code)),
      ...retired.map((item) => compactJoinCode(item.code))
    ].filter(Boolean)
  );
}
function archivedJoinCodesCount() {
  return typeof dbInstance.getRetiredJoinCodes === "function" ? dbInstance.getRetiredJoinCodes().length : 0;
}
function browserFamilyFromUserAgent(userAgent) {
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
function deviceFingerprintBrowserSegment(fingerprint) {
  const s = String(fingerprint || "").trim();
  if (!s) return "";
  const raw = s.split("_")[0] || "";
  const family = raw.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  if (!family || family === "unknown" || family === "unknown-browser" || family === "mozilla" || family === "mozilla-5.0") return "legacy";
  if (family === "mozilla/5.0") return "legacy";
  return family;
}
function getRequestDeviceFingerprint(req) {
  const browser = browserFamilyFromUserAgent(req?.headers?.["user-agent"] || "");
  const displayMode = requestExamDisplayMode(req);
  const ip = req?.ip || "127.0.0.1";
  const deviceToken = getRequestDeviceToken(req);
  return `${browser}-${displayMode}_${ip}_${deviceToken ? import_crypto.default.createHash("sha256").update(deviceToken).digest("hex").slice(0, 12) : "no-device-token"}`;
}
function getRequestDeviceToken(req) {
  return String(
    req?.body?.deviceToken || req?.headers?.["x-miras-device-id"] || ""
  ).trim().slice(0, 160);
}
function deviceTokenHashSegment(fingerprint) {
  const s = String(fingerprint || "").trim();
  if (!s) return "";
  const idx = s.lastIndexOf("_");
  const seg = idx >= 0 ? s.slice(idx + 1) : s;
  return seg && seg !== "no-device-token" ? seg : "";
}
function deviceFingerprintsMatch(a, b) {
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
var STUDENT_DEVICE_ALREADY_BOUND_ERROR = "\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0631\u062A\u0628\u0637 \u0628\u062D\u0633\u0627\u0628 \u0637\u0627\u0644\u0628 \u0622\u062E\u0631. \u064A\u0631\u062C\u0649 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062C\u0647\u0627\u0632\u0643 \u0627\u0644\u0634\u062E\u0635\u064A \u0623\u0648 \u0645\u0631\u0627\u062C\u0639\u0629 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631.";
function findStudentBoundToDevice(deviceToken, deviceFingerprint, excludeStudentId) {
  const token = String(deviceToken || "").trim();
  const fingerprintRaw = String(deviceFingerprint || "").trim();
  const fingerprint = fingerprintRaw && !fingerprintRaw.endsWith("_no-device-token") ? fingerprintRaw : "";
  const excluded = normalizeStudentId(excludeStudentId || "");
  if (!token && !fingerprint) return null;
  const isDifferentStudent = (candidateId) => {
    const candidate = normalizeStudentId(candidateId || "");
    return !!candidate && (!excluded || candidate !== excluded);
  };
  const matchingJoinCode = dbInstance.getJoinCodes().find((jc) => {
    const linkedStudentId = jc.studentId || jc.usedByStudentId;
    if (!isDifferentStudent(linkedStudentId)) return false;
    const jcToken = String(jc.activationDeviceToken || "").trim();
    const jcFingerprint = String(jc.activationDeviceFingerprint || "").trim();
    return token && jcToken && jcToken === token || fingerprint && jcFingerprint && deviceFingerprintsMatch(jcFingerprint, fingerprint);
  });
  if (matchingJoinCode) {
    const linkedStudentId = matchingJoinCode.studentId || matchingJoinCode.usedByStudentId;
    return dbInstance.getStudents().find(
      (s) => normalizeStudentId(s.id) === normalizeStudentId(linkedStudentId)
    ) || { id: linkedStudentId };
  }
  if (fingerprint) {
    const matchingStudent = dbInstance.getStudents().find((student) => {
      if (!isDifferentStudent(student.id)) return false;
      return Array.isArray(student.devices) && student.devices.some(
        (item) => deviceFingerprintsMatch(item, fingerprint)
      );
    });
    if (matchingStudent) return matchingStudent;
  }
  return null;
}
var SECOND_HAND_DEVICE_APPROVAL_REASON = "\u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u0645\u0633\u062A\u062E\u062F\u0645 \u0633\u0627\u0628\u0642\u064B\u0627";
function sameDeviceValue(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  return !!left && !!right && left === right;
}
function activeSecondHandDeviceConflict(params) {
  const now = Date.now();
  const token = String(params.deviceToken || "").trim();
  const fingerprint = String(params.deviceFingerprint || "").trim();
  const studentId = normalizeStudentId(params.studentId);
  const sectionCode = String(params.sectionCode || "").trim();
  const currentRequestId = String(params.currentRequestId || "").trim();
  const pendingSameDevice = dbInstance.getActivationAttempts().find((attempt) => {
    if (currentRequestId && String(attempt.id || "") === currentRequestId) return false;
    if (String(attempt.approvalRequestType || "") !== "second_hand_device") return false;
    if (String(attempt.approvalStatus || "") !== "pending") return false;
    if (normalizeStudentId(attempt.targetStudentId || attempt.studentId) === studentId) return false;
    if (sectionCode && !sectionCodeEquivalent(attempt.targetSectionCode || attempt.sectionCode, sectionCode)) return false;
    const attemptTime = new Date(attempt.approvalRequestedAt || attempt.timestamp || 0).getTime() || 0;
    if (attemptTime && now - attemptTime > 24 * 60 * 60 * 1e3) return false;
    return sameDeviceValue(attempt.deviceToken, token) || deviceFingerprintsMatch(attempt.deviceFingerprint, fingerprint);
  });
  if (pendingSameDevice) {
    return {
      conflict: true,
      reason: "\u064A\u0648\u062C\u062F \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0646\u0634\u0637 \u0644\u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0639 \u0637\u0627\u0644\u0628 \u0622\u062E\u0631 \u0641\u064A \u0646\u0641\u0633 \u0627\u0644\u0645\u0642\u0631\u0631."
    };
  }
  const activeSeb = dbInstance.getSebAttempts().find((pass) => {
    if (normalizeStudentId(pass.studentId) === studentId) return false;
    if (sectionCode && !sectionCodeEquivalent(pass.courseCode || pass.sectionCode, sectionCode)) return false;
    const expiresAt = Number(pass.expiresAt || 0) || new Date(pass.expiresAt || 0).getTime() || 0;
    if (expiresAt && expiresAt < now) return false;
    return sameDeviceValue(pass.originalDeviceId, token) || deviceFingerprintsMatch(pass.originalDeviceId, fingerprint);
  });
  if (activeSeb) {
    return {
      conflict: true,
      reason: "\u064A\u0648\u062C\u062F \u062A\u0635\u0631\u064A\u062D \u0627\u062E\u062A\u0628\u0627\u0631 SEB \u0646\u0634\u0637 \u0644\u0637\u0627\u0644\u0628 \u0622\u062E\u0631 \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631."
    };
  }
  const recentViolation = dbInstance.getActivationAttempts().find((attempt) => {
    if (normalizeStudentId(attempt.targetStudentId || attempt.studentId) === studentId) return false;
    if (sectionCode && !sectionCodeEquivalent(attempt.targetSectionCode || attempt.sectionCode, sectionCode)) return false;
    const attemptTime = new Date(attempt.timestamp || attempt.createdAt || 0).getTime() || 0;
    if (!attemptTime || now - attemptTime > 6 * 60 * 60 * 1e3) return false;
    const text = `${attempt.reason || ""} ${attempt.activeConflictReason || ""}`;
    if (!/غش|SEB|جلسة نشطة|تعارض نشط|محاولة تفعيل كود من جهاز مرتبط/.test(text)) return false;
    return sameDeviceValue(attempt.deviceToken, token) || deviceFingerprintsMatch(attempt.deviceFingerprint, fingerprint);
  });
  if (recentViolation) {
    return {
      conflict: true,
      reason: "\u064A\u0648\u062C\u062F \u0646\u0634\u0627\u0637 \u0623\u0645\u0646\u064A \u062D\u062F\u064A\u062B \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632 \u062F\u0627\u062E\u0644 \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631\u060C \u0648\u064A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0628\u0627\u0634\u0631\u0629."
    };
  }
  return { conflict: false, reason: "\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0639\u0627\u0631\u0636 \u0646\u0634\u0637 \u0627\u0644\u0622\u0646." };
}
function createSecondHandDeviceApprovalRequest(params) {
  const existing = dbInstance.getActivationAttempts().find((attempt) => {
    if (String(attempt.approvalRequestType || "") !== "second_hand_device") return false;
    if (String(attempt.approvalStatus || "") !== "pending") return false;
    if (normalizeStudentId(attempt.targetStudentId || attempt.studentId) !== normalizeStudentId(params.student.id)) return false;
    if (compactJoinCode(attempt.targetJoinCode || attempt.code || "") !== compactJoinCode(params.code)) return false;
    return sameDeviceValue(attempt.deviceToken, params.deviceToken) || sameDeviceValue(attempt.deviceFingerprint, params.deviceFingerprint);
  });
  if (existing) return existing;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const requestId = `dev-approval-${Date.now()}-${import_crypto.default.randomBytes(3).toString("hex")}`;
  const conflict = activeSecondHandDeviceConflict({
    deviceToken: params.deviceToken,
    deviceFingerprint: params.deviceFingerprint,
    studentId: params.student.id,
    sectionCode: params.sectionCode
  });
  const request = {
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
    deviceApprovalRecommendation: conflict.conflict ? "\u064A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u062C\u0639\u0629 \u0642\u0628\u0644 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F" : "\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0639\u0627\u0631\u0636 \u0646\u0634\u0637",
    silentEnforcement: true,
    recommendedAction: conflict.conflict ? "\u0631\u0627\u062C\u0639 \u0627\u0644\u0637\u0644\u0628 \u0642\u0628\u0644 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F" : "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u0625\u0630\u0627 \u062A\u0637\u0627\u0628\u0642\u062A \u0647\u0648\u064A\u0629 \u0627\u0644\u0637\u0627\u0644\u0628"
  };
  dbInstance.addActivationAttempt(request);
  rememberInAppNotification({
    role: "teacher",
    teacherEmail: params.teacherEmail,
    sectionCode: params.sectionCode,
    type: "second_hand_device_approval",
    title: "\u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u0645\u0633\u062A\u062E\u062F\u0645 \u0633\u0627\u0628\u0642\u064B\u0627",
    body: `${params.student.name || params.student.id} \u2022 ${courseNameFromCode(params.sectionCode)} \u2022 ${conflict.reason}`,
    data: {
      approvalRequestId: requestId,
      approvalRequestType: "second_hand_device",
      studentId: params.student.id,
      courseCode: params.sectionCode,
      link: "/"
    }
  });
  dbInstance.addActivityLog({
    studentId: params.student.id,
    studentName: params.student.name,
    action: "\u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u0645\u0633\u062A\u062E\u062F\u0645 \u0633\u0627\u0628\u0642\u064B\u0627",
    details: `\u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u0633\u0628\u0642 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647 \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645 \u0644\u0644\u0637\u0627\u0644\u0628 ${params.student.name || params.student.id} \u0641\u064A \u0645\u0642\u0631\u0631 ${courseNameFromCode(params.sectionCode)}. ${conflict.reason}`,
    teacherEmail: params.teacherEmail,
    actorEmail: params.teacherEmail,
    sectionCode: params.sectionCode,
    ip: params.req.ip || "127.0.0.1",
    userAgent: params.req.headers["user-agent"] || "Unknown",
    os: "\u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632",
    browser: "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u064A\u0628",
    isViolationWarning: false
  });
  return request;
}
function releaseDeviceFromPreviousOwners(params) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const newStudentId = normalizeStudentId(params.newStudentId);
  dbInstance.getJoinCodes().forEach((jc) => {
    const linkedStudentId = normalizeStudentId(jc.studentId || jc.usedByStudentId || jc.assignedStudentId || "");
    if (!linkedStudentId || linkedStudentId === newStudentId) return;
    const matches = sameDeviceValue(jc.activationDeviceToken, params.deviceToken) || deviceFingerprintsMatch(jc.activationDeviceFingerprint, params.deviceFingerprint);
    if (!matches) return;
    dbInstance.updateJoinCode(jc.code, {
      activationDeviceToken: "",
      activationDeviceFingerprint: "",
      secondHandDeviceReleasedAt: now,
      secondHandDeviceReleasedBy: params.actorEmail,
      secondHandDeviceReleasedForStudentId: newStudentId,
      secondHandDeviceApprovalRequestId: params.requestId
    });
  });
  dbInstance.getStudents().forEach((student) => {
    if (normalizeStudentId(student.id) === newStudentId) return;
    const devices = Array.isArray(student.devices) ? student.devices : [];
    if (!devices.some((d) => deviceFingerprintsMatch(d, params.deviceFingerprint))) return;
    const nextDevices = devices.filter((d) => !deviceFingerprintsMatch(d, params.deviceFingerprint));
    const retiredDeviceFingerprints = Array.from(new Set([...Array.isArray(student.retiredDeviceFingerprints) ? student.retiredDeviceFingerprints : [], params.deviceFingerprint].filter(Boolean)));
    const retiredDeviceTokens = Array.from(new Set([...Array.isArray(student.retiredDeviceTokens) ? student.retiredDeviceTokens : [], params.deviceToken].filter(Boolean)));
    dbInstance.updateStudent(student.id, {
      devices: nextDevices,
      retiredDeviceFingerprints,
      retiredDeviceTokens,
      secondHandDeviceReleasedAt: now,
      secondHandDeviceReleasedBy: params.actorEmail,
      secondHandDeviceReleasedForStudentId: newStudentId
    });
  });
}
function isSebRequest(req) {
  const userAgent = String(req.headers["user-agent"] || "");
  const sebHeader = String(
    req.headers["x-safeexambrowser-requesthash"] || req.headers["x-safe-exam-browser"] || req.headers["x-miras-seb-armed"] || ""
  );
  const sebQuery = String(
    req.query?.seb || req.query?.miras_seb || req.body?.seb || ""
  );
  return /SafeExamBrowser|SEB/i.test(userAgent) || /SafeExamBrowser|SEB/i.test(sebHeader) || sebQuery === "1" || !!getSebPassFromRequest(req);
}
function hasSebRuntimeHint(req) {
  const userAgent = String(req.headers["user-agent"] || "");
  const sebHeader = String(
    req.headers["x-safeexambrowser-requesthash"] || req.headers["x-safe-exam-browser"] || ""
  );
  return /SafeExamBrowser|SEB/i.test(userAgent) || /SafeExamBrowser|SEB/i.test(sebHeader);
}
function buildResetLink(req, token) {
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http"
  ).split(",")[0];
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`
  ).split(",")[0];
  return `${proto}://${host}/?resetToken=${encodeURIComponent(token)}`;
}
function publicPasswordResetRequest(reqItem) {
  const expired = reqItem.status === "new" && new Date(reqItem.expiresAt).getTime() <= Date.now();
  return {
    ...reqItem,
    status: expired ? "expired" : reqItem.status,
    resetToken: void 0
  };
}
function firebasePublicConfig() {
  let fileConfig = {};
  try {
    const configPath = import_path2.default.join(process.cwd(), "firebase-applet-config.json");
    if (import_fs2.default.existsSync(configPath))
      fileConfig = JSON.parse(import_fs2.default.readFileSync(configPath, "utf-8"));
  } catch {
  }
  return {
    apiKey: process.env.FIREBASE_API_KEY || fileConfig.apiKey || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || fileConfig.authDomain || "",
    projectId: process.env.FIREBASE_PROJECT_ID || fileConfig.projectId || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || fileConfig.storageBucket || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || fileConfig.messagingSenderId || "",
    appId: process.env.FIREBASE_APP_ID || fileConfig.appId || "",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || fileConfig.measurementId || "",
    vapidKey: process.env.FIREBASE_FCM_VAPID_KEY || fileConfig.vapidKey || ""
  };
}
function appPublicUrl() {
  const raw = String(process.env.APP_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "";
}
function absoluteHttpsPushLink(link) {
  const base = appPublicUrl();
  const raw = String(link || "/").trim() || "/";
  try {
    const url = base ? new URL(raw, `${base}/`) : new URL(raw);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
function stringifyFcmData(data, title, body) {
  const out = {};
  Object.entries({ ...data, title, body }).forEach(([key, value]) => {
    if (value !== void 0 && value !== null) out[key] = String(value);
  });
  if (!out.link) out.link = "/";
  return out;
}
function shouldDisableFcmToken(reason) {
  return /UNREGISTERED|registration-token-not-registered|Requested entity was not found|INVALID_ARGUMENT/i.test(
    reason || ""
  );
}
function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
var fcmAccessTokenCache = null;
function serviceAccountFromEnvOrFile() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  if (raw.trim()) {
    try {
      return raw.trim().startsWith("{") ? JSON.parse(raw) : JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    } catch {
      console.warn(
        "FCM service account env is present but not valid JSON/base64 JSON."
      );
      return null;
    }
  }
  const serviceAccountPath = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || ""
  ).trim();
  if (serviceAccountPath && import_fs2.default.existsSync(serviceAccountPath)) {
    try {
      const parsed = JSON.parse(import_fs2.default.readFileSync(serviceAccountPath, "utf-8"));
      if (parsed?.client_email && parsed?.private_key) return parsed;
    } catch {
      console.warn(
        "FCM service account file is present but not valid service-account JSON."
      );
    }
  }
  return null;
}
function hasFcmSenderCandidate() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS)
    return true;
  if (process.env.K_SERVICE || process.env.GAE_ENV || process.env.FUNCTION_TARGET)
    return true;
  try {
    const active = (0, import_child_process.execFileSync)(
      "gcloud",
      ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
      { encoding: "utf-8", timeout: 4e3 }
    ).trim();
    return !!active;
  } catch {
    return false;
  }
}
async function getMetadataAccessToken() {
  try {
    const resp = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(1500)
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.access_token) return null;
    fcmAccessTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1e3
    };
    return fcmAccessTokenCache.token;
  } catch {
    return null;
  }
}
function getGcloudAccessToken(projectId) {
  try {
    const args = ["auth", "print-access-token"];
    if (projectId) args.push("--project", projectId);
    const token = (0, import_child_process.execFileSync)("gcloud", args, {
      encoding: "utf-8",
      timeout: 7e3
    }).trim();
    if (!token) return null;
    fcmAccessTokenCache = { token, expiresAt: Date.now() + 50 * 60 * 1e3 };
    return token;
  } catch {
    return null;
  }
}
async function getFcmAccessToken() {
  if (fcmAccessTokenCache && fcmAccessTokenCache.expiresAt > Date.now() + 6e4)
    return fcmAccessTokenCache.token;
  const publicConfig = firebasePublicConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || publicConfig.projectId;
  const serviceAccount = serviceAccountFromEnvOrFile();
  if (!serviceAccount) {
    const metadataToken = await getMetadataAccessToken();
    if (metadataToken) return metadataToken;
    return getGcloudAccessToken(projectId);
  }
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = import_crypto.default.createSign("RSA-SHA256").update(signingInput).sign(serviceAccount.private_key);
  const assertion = `${signingInput}.${base64Url(signature)}`;
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!tokenResp.ok) {
    console.warn(
      "FCM OAuth token request failed:",
      await tokenResp.text().catch(() => "")
    );
    return null;
  }
  const data = await tokenResp.json();
  fcmAccessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1e3
  };
  return fcmAccessTokenCache.token;
}
async function sendFcmToToken(token, title, body, data = {}) {
  const publicConfig = firebasePublicConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || publicConfig.projectId;
  const accessToken = await getFcmAccessToken();
  if (!projectId || !accessToken || !token)
    return { sent: false, reason: "FCM_NOT_CONFIGURED" };
  const fcmData = stringifyFcmData(data, title, body);
  const clickLink = absoluteHttpsPushLink(fcmData.link);
  const webpush = {
    notification: {
      title,
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "ar",
      data: { url: fcmData.link || "/" }
    }
  };
  if (clickLink) webpush.fcm_options = { link: clickLink };
  const resp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush,
          data: fcmData
        }
      })
    }
  );
  if (!resp.ok)
    return {
      sent: false,
      reason: await resp.text().catch(() => "FCM_SEND_FAILED")
    };
  return { sent: true };
}
function notificationTargets(filter) {
  return dbInstance.getNotificationTokens().filter(
    (token) => !token.disabledAt && token.permission === "granted" && filter(token)
  );
}
function notifyUsers(filter, title, body, data = {}) {
  const safeTitle = sanitizePublicMessageText(title) || "\u0645\u0650\u0631\u0627\u0633";
  const safeBody = sanitizePublicMessageText(body) || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F.";
  const targets = notificationTargets(filter);
  const seen = /* @__PURE__ */ new Set();
  targets.forEach((target) => {
    sendFcmToToken(target.token, safeTitle, safeBody, data).then((result) => {
      if (!result.sent) {
        console.warn("FCM send skipped/failed:", result.reason);
        if (shouldDisableFcmToken(String(result.reason || ""))) {
          dbInstance.disableNotificationToken(target.token, target.userId);
        }
      }
    }).catch((err) => console.warn("FCM send failed:", err?.message || err));
    const key = `${target.role}:${target.userId || ""}:${target.sectionCode || ""}:${data.courseCode || ""}`;
    const courseNotificationAlreadyCoversStudent = target.role === "student" && Boolean(data.courseCode) && !data.userId && !data.studentId;
    if (!courseNotificationAlreadyCoversStudent && !seen.has(key)) {
      seen.add(key);
      rememberInAppNotification({
        userId: target.userId,
        role: target.role,
        sectionCode: target.sectionCode,
        title: safeTitle,
        body: safeBody,
        type: data.type || "push",
        data
      });
    }
  });
  return targets.length;
}
function isCriticalTeacherNotification(data = {}, title = "") {
  const type = String(data.type || "").toLowerCase();
  if ([
    "exam_submission",
    "project_submission",
    "course_activated",
    "code_used",
    "student_registered",
    "student_logged_in"
  ].includes(type)) {
    return false;
  }
  const titleLower = title.toLowerCase();
  if (titleLower.includes("\u062A\u0633\u0644\u064A\u0645") || titleLower.includes("\u062F\u062E\u0648\u0644 \u0646\u0627\u062C\u062D") || titleLower.includes("\u062A\u0633\u062C\u064A\u0644 \u0637\u0627\u0644\u0628") || titleLower.includes("\u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631") || titleLower.includes("\u0645\u0634\u0631\u0648\u0639 \u062C\u062F\u064A\u062F")) {
    return false;
  }
  return [
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
    "exam_warning"
  ].includes(type) || /خطر|تحذير|نزاهة|مرفوض|كلمة مرور|استرجاع|خروج طالب|خرج من اختبار|انسحاب|غش/i.test(
    title
  );
}
function notifyTeachersForSection(sectionCode, title, body, data = {}) {
  if (!isCriticalTeacherNotification(data, title)) return 0;
  const safeTitle = sanitizePublicMessageText(title) || "\u0645\u0650\u0631\u0627\u0633";
  const safeBody = sanitizePublicMessageText(body) || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F.";
  const ownerEmail = sectionOwnerEmail(sectionCode);
  const count = notifyUsers(
    (token) => token.role !== "student" && (!ownerEmail || String(token.teacherEmail || token.userId).toLowerCase() === ownerEmail),
    safeTitle,
    safeBody,
    data
  );
  if (ownerEmail) {
    rememberInAppNotification({
      userId: ownerEmail,
      role: isAdminEmail(ownerEmail) ? "admin" : "teacher",
      title: safeTitle,
      body: safeBody,
      type: data.type || "teacher",
      data: { ...data, teacherEmail: ownerEmail }
    });
  }
  return count;
}
function notifyStudent(studentId, title, body, data = {}) {
  const safeTitle = sanitizePublicMessageText(title) || "\u0645\u0650\u0631\u0627\u0633";
  const safeBody = sanitizePublicMessageText(body) || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F.";
  const count = notifyUsers(
    (token) => token.role === "student" && String(token.userId) === String(studentId),
    safeTitle,
    safeBody,
    data
  );
  if (count === 0 || Boolean(data.courseCode)) {
    rememberInAppNotification({
      userId: String(studentId),
      role: "student",
      title: safeTitle,
      body: safeBody,
      type: data.type || "student",
      data
    });
  }
  return count;
}
function studentTokenHasCourse(token, courseCode) {
  const code = String(courseCode || "").trim().toLowerCase();
  if (!code) return false;
  if (String(token.sectionCode || "").toLowerCase() === code) return true;
  const student = dbInstance.getStudents().find((st) => String(st.id) === String(token.userId));
  return !!student && getStudentDiscoveredCourseCodes(student).some(
    (c) => String(c).toLowerCase() === code
  );
}
function studentEnrolledForNotifications(student, courseCode) {
  const code = String(courseCode || "").trim().toLowerCase();
  if (!code) return true;
  return getStudentDiscoveredCourseCodes(student).some(
    (c) => String(c).toLowerCase() === code
  );
}
function rememberInAppNotification(item) {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const saved = {
    id: item.id || `note-${Date.now()}-${import_crypto.default.randomBytes(3).toString("hex")}`,
    userId: item.userId ? String(item.userId) : "",
    role: item.role ? String(item.role) : "",
    sectionCode: item.sectionCode ? String(item.sectionCode) : "",
    title: sanitizePublicMessageText(item.title || "\u0645\u0650\u0631\u0627\u0633") || "\u0645\u0650\u0631\u0627\u0633",
    body: sanitizePublicMessageText(item.body || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F.") || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F.",
    type: String(item.type || item.data?.type || "course"),
    data: item.data || {},
    createdAt: item.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    read: false
  };
  const signature = [
    saved.userId,
    saved.role,
    saved.sectionCode,
    saved.type,
    compact(
      saved.data?.activityId || saved.data?.examId || saved.data?.projectId || saved.data?.submissionId || ""
    ),
    compact(saved.title),
    compact(saved.body)
  ].join("|");
  const now = new Date(saved.createdAt).getTime() || Date.now();
  const store = dbInstance.getInAppNotifications();
  const duplicate = store.find((old) => {
    const oldSignature = [
      String(old.userId || ""),
      String(old.role || ""),
      String(old.sectionCode || ""),
      String(old.type || old.data?.type || "course"),
      compact(
        old.data?.activityId || old.data?.examId || old.data?.projectId || old.data?.submissionId || ""
      ),
      compact(old.title || "\u0645\u0650\u0631\u0627\u0633"),
      compact(old.body || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F.")
    ].join("|");
    const oldTime = new Date(old.createdAt || 0).getTime() || 0;
    return oldSignature === signature && Math.abs(now - oldTime) <= 15e3;
  });
  if (duplicate) return duplicate;
  dbInstance.addInAppNotification(saved);
  return saved;
}
function rememberCourseNotification(sectionCode, title, body, type = "course", data = {}) {
  return rememberInAppNotification({
    sectionCode,
    role: "student",
    title,
    body,
    type,
    data: { ...data, courseCode: sectionCode }
  });
}
var activationRateBuckets = /* @__PURE__ */ new Map();
function activationRateKey(kind, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return `${kind}:${import_crypto.default.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}
function rememberActivationRateStrike(req, params) {
  const now = Date.now();
  const fingerprint = getRequestDeviceFingerprint(req);
  const token = getRequestDeviceToken(req);
  const keys = [
    activationRateKey("ip", req.ip || "127.0.0.1"),
    activationRateKey("device", token || fingerprint),
    activationRateKey("student", params.student?.id),
    activationRateKey("code", compactJoinCode(params.code || ""))
  ].filter(Boolean);
  for (const key of keys) {
    const old = activationRateBuckets.get(key);
    if (!old || now - old.firstSeen > 60 * 60 * 1e3) {
      activationRateBuckets.set(key, {
        firstSeen: now,
        attempts: 1,
        blockedUntil: 0
      });
    } else {
      old.attempts += 1;
      activationRateBuckets.set(key, old);
    }
  }
  if (activationRateBuckets.size > 5e3) {
    for (const [key, bucket] of activationRateBuckets.entries()) {
      if (now - bucket.firstSeen > 2 * 60 * 60 * 1e3 && bucket.blockedUntil < now)
        activationRateBuckets.delete(key);
    }
  }
}
function getActivationRateLimit(req, params) {
  const now = Date.now();
  const fingerprint = getRequestDeviceFingerprint(req);
  const token = getRequestDeviceToken(req);
  const checks = [
    {
      key: activationRateKey("student", params.student?.id),
      max: 12,
      windowMs: 10 * 60 * 1e3,
      blockMs: 10 * 60 * 1e3
    },
    {
      key: activationRateKey("code", compactJoinCode(params.code || "")),
      max: 8,
      windowMs: 10 * 60 * 1e3,
      blockMs: 15 * 60 * 1e3
    },
    {
      key: activationRateKey("device", token || fingerprint),
      max: 28,
      windowMs: 30 * 60 * 1e3,
      blockMs: 30 * 60 * 1e3
    },
    {
      key: activationRateKey("ip", req.ip || "127.0.0.1"),
      max: 80,
      windowMs: 60 * 60 * 1e3,
      blockMs: 60 * 60 * 1e3
    }
  ].filter((item) => item.key);
  for (const item of checks) {
    const bucket = activationRateBuckets.get(item.key);
    if (!bucket) continue;
    if (bucket.blockedUntil > now) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.blockedUntil - now) / 1e3)
        )
      };
    }
    if (now - bucket.firstSeen <= item.windowMs && bucket.attempts >= item.max) {
      bucket.blockedUntil = now + item.blockMs;
      activationRateBuckets.set(item.key, bucket);
      return {
        limited: true,
        retryAfterSeconds: Math.ceil(item.blockMs / 1e3)
      };
    }
    if (now - bucket.firstSeen > item.windowMs && bucket.blockedUntil < now) {
      activationRateBuckets.delete(item.key);
    }
  }
  return { limited: false, retryAfterSeconds: 0 };
}
var STRICT_LIBRARY_MODE_DEFAULT = true;
var CODE_REPUTATION_LABELS = {
  normal: "\u0637\u0628\u064A\u0639\u064A",
  watch: "\u0645\u0631\u0627\u0642\u0628\u0629",
  suspicious: "\u0645\u0634\u062A\u0628\u0647",
  danger: "\u062E\u0637\u0631",
  temporarily_blocked: "\u0645\u062D\u0638\u0648\u0631 \u0645\u0624\u0642\u062A\u064B\u0627"
};
function getActivationTelemetry(req) {
  const raw = req.body && (req.body.activationTelemetry || req.body.codeTelemetry || req.body.typingTelemetry) || {};
  const typed = Boolean(raw.typed);
  const pasted = Boolean(raw.pasted);
  const durationMs = Math.max(
    0,
    Math.min(Number(raw.durationMs || raw.elapsedMs || 0) || 0, 10 * 60 * 1e3)
  );
  const keyEvents = Math.max(
    0,
    Math.min(Number(raw.keyEvents || raw.keyCount || 0) || 0, 500)
  );
  const correctionEvents = Math.max(
    0,
    Math.min(Number(raw.correctionEvents || raw.backspaces || 0) || 0, 200)
  );
  const fieldName = String(raw.fieldName || raw.source || "joinCode").slice(
    0,
    60
  );
  const looksAutomated = Boolean(raw.looksAutomated) || !typed && durationMs > 0 && durationMs < 350 || keyEvents >= 8 && durationMs > 0 && durationMs < 1200;
  return {
    typed,
    pasted,
    durationMs,
    keyEvents,
    correctionEvents,
    fieldName,
    looksAutomated
  };
}
function codeJourneyEvent(label, req, extra = {}) {
  return {
    id: `cj-${Date.now()}-${import_crypto.default.randomBytes(2).toString("hex")}`,
    label,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    ip: req.ip || "127.0.0.1",
    deviceFingerprint: getRequestDeviceFingerprint(req),
    deviceToken: getRequestDeviceToken(req),
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    ...extra
  };
}
function stableLedgerString(value) {
  if (Array.isArray(value)) return `[${value.map(stableLedgerString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((k) => k !== "hash").sort().map((k) => `${JSON.stringify(k)}:${stableLedgerString(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
function ledgerHash(prevHash, payload) {
  return import_crypto.default.createHash("sha256").update(`${prevHash}|${stableLedgerString(payload)}`).digest("hex");
}
function appendCodeJourney(code, event) {
  const previous = Array.isArray(code.codeJourney) ? code.codeJourney : [];
  const prevHash = String(previous.at(-1)?.hash || "GENESIS");
  const payload = { ...event, prevHash };
  return [...previous.slice(-49), { ...payload, hash: ledgerHash(prevHash, payload) }];
}
function verifyLedger(code) {
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
function reputationTone(score, blockedUntil) {
  if (blockedUntil && new Date(blockedUntil).getTime() > Date.now())
    return "temporarily_blocked";
  if (score >= 90) return "danger";
  if (score >= 70) return "suspicious";
  if (score >= 40) return "watch";
  return "normal";
}
function calculateCodeReputation(params) {
  const normalized = normalizeJoinCode(params.code);
  const compact = compactJoinCode(params.code);
  const attempts = dbInstance.getActivationAttempts().filter((attempt) => {
    const aCompact = compactJoinCode(
      attempt.normalizedCode || attempt.code || ""
    );
    return compact && aCompact === compact;
  });
  const devices = new Set(
    attempts.map((a) => a.deviceToken || a.deviceFingerprint).filter(Boolean)
  );
  const ips = new Set(attempts.map((a) => a.ip).filter(Boolean));
  const students = new Set(
    attempts.map((a) => normalizeStudentId(a.studentId)).filter(Boolean)
  );
  const reason = String(params.reason || "");
  const honey = isUnifiedJoinCode(params.code) && !params.foundCode;
  let score = 10;
  score += Math.min(36, attempts.length * 6);
  score += Math.min(24, Math.max(0, devices.size - 1) * 8);
  score += Math.min(18, Math.max(0, ips.size - 1) * 6);
  score += Math.min(20, Math.max(0, students.size - 1) * 10);
  if (honey) score += 40;
  if (reason.includes("\u0645\u0633\u062A\u062E\u062F\u0645") || reason.includes("\u0645\u0642\u0641\u0644")) score += 22;
  if (reason.includes("\u062C\u0647\u0627\u0632") || reason.includes("\u062A\u0648\u0643\u0646")) score += 18;
  if (reason.includes("\u0645\u062E\u0635\u0635") || reason.includes("\u0644\u0627 \u064A\u062A\u0628\u0639")) score += 14;
  if (params.telemetry?.looksAutomated) score += 22;
  if (params.telemetry?.pasted && Number(params.telemetry?.durationMs || 0) < 1500)
    score += 8;
  score = Math.min(99, score);
  const shouldFreeze = Boolean(params.foundCode) && String(params.foundCode.status || "") === "active" && (score >= 92 || devices.size >= 8 || attempts.length >= 12);
  const blockedUntil = shouldFreeze ? new Date(Date.now() + 2 * 60 * 60 * 1e3).toISOString() : String(params.foundCode?.activationFrozenUntil || "");
  const level = reputationTone(score, blockedUntil);
  return {
    score,
    level,
    label: CODE_REPUTATION_LABELS[level] || "\u0637\u0628\u064A\u0639\u064A",
    honey,
    distinctDevices: devices.size,
    distinctIps: ips.size,
    distinctStudents: students.size,
    totalAttempts: attempts.length + 1,
    shouldFreeze,
    blockedUntil
  };
}
function updateJoinCodeReputation(req, params) {
  if (!params.foundCode) return null;
  const reputation = calculateCodeReputation(params);
  const current = params.foundCode;
  dbInstance.updateJoinCode(params.foundCode.code, {
    codeReputation: reputation.level,
    codeReputationLabel: reputation.label,
    codeReputationScore: reputation.score,
    codeReputationUpdatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    distinctFailedDevices: reputation.distinctDevices,
    distinctFailedIps: reputation.distinctIps,
    distinctFailedStudents: reputation.distinctStudents,
    activationFrozenUntil: reputation.shouldFreeze ? reputation.blockedUntil : current.activationFrozenUntil,
    activationReviewRequired: Boolean(
      current.activationReviewRequired || reputation.shouldFreeze
    ),
    codeJourney: appendCodeJourney(
      params.foundCode,
      codeJourneyEvent("\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0641\u0648\u0636\u0629", req, {
        reason: params.reason,
        studentId: params.student?.id,
        studentName: params.student?.name,
        reputationLevel: reputation.level,
        reputationLabel: reputation.label,
        reputationScore: reputation.score,
        telemetry: params.telemetry
      })
    )
  });
  return reputation;
}
function isJoinCodeTemporarilyFrozen(code) {
  const until = new Date(String(code?.activationFrozenUntil || "")).getTime();
  return Number.isFinite(until) && until > Date.now();
}
function joinCodeWindowStatus(code) {
  const now = Date.now();
  const startsRaw = String(
    code?.activationStartsAt || code?.validFrom || ""
  ).trim();
  const endsRaw = String(
    code?.activationEndsAt || code?.validUntil || ""
  ).trim();
  const startsAt = startsRaw ? new Date(startsRaw).getTime() : 0;
  const endsAt = endsRaw ? new Date(endsRaw).getTime() : 0;
  if (startsAt && Number.isFinite(startsAt) && now < startsAt)
    return {
      ok: false,
      reason: "\u0627\u0644\u0643\u0648\u062F \u062E\u0627\u0631\u062C \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u062A\u0641\u0639\u064A\u0644: \u0644\u0645 \u062A\u0628\u062F\u0623 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0628\u0639\u062F"
    };
  if (endsAt && Number.isFinite(endsAt) && now > endsAt)
    return { ok: false, reason: "\u0627\u0644\u0643\u0648\u062F \u062E\u0627\u0631\u062C \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u062A\u0641\u0639\u064A\u0644: \u0627\u0646\u062A\u0647\u062A \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629" };
  return { ok: true, reason: "" };
}
function resolveJoinCodeBatchId(code) {
  const direct = String(
    code?.batchId || code?.batchName || code?.batch || code?.libraryBatch || ""
  ).trim();
  if (direct) return direct;
  const semester = String(code?.semester || code?.academicTerm || "").trim();
  const section = String(
    code?.studentSection || code?.sectionCode || code?.courseCode || ""
  ).trim();
  if (semester || section)
    return [semester || "\u062F\u0641\u0639\u0629 \u063A\u064A\u0631 \u0645\u0624\u0631\u062E\u0629", section || "\u0643\u0644 \u0627\u0644\u0634\u0639\u0628"].join(" / ");
  return "\u062F\u0641\u0639\u0629 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629";
}
function resolveAttemptBatchId(attempt, codeRecord) {
  return String(
    attempt?.batchId || resolveJoinCodeBatchId(codeRecord || attempt || {})
  );
}
function classifyStudentFairness(attempts, codeRecord) {
  const total = attempts.length;
  const devices = new Set(
    attempts.map((a) => a.deviceToken || a.deviceFingerprint).filter(Boolean)
  );
  const students = new Set(
    attempts.map((a) => normalizeStudentId(a.studentId)).filter(Boolean)
  );
  const pastedFast = attempts.filter(
    (a) => a.activationTelemetry?.pasted && Number(a.activationTelemetry?.durationMs || 0) < 1500
  ).length;
  const automated = attempts.filter(
    (a) => a.activationTelemetry?.looksAutomated
  ).length;
  const honey = attempts.some(
    (a) => a.honeyCode || String(a.reason || "").includes("\u0645\u0635\u064A\u062F\u0629")
  );
  const usedByOther = attempts.some(
    (a) => String(a.reason || "").includes("\u0645\u0633\u062A\u062E\u062F\u0645") || String(a.reason || "").includes("\u0645\u0631\u062A\u0628\u0637")
  );
  let level = "\u062E\u0637\u0623 \u0628\u0633\u064A\u0637";
  let score = Math.min(
    99,
    total * 8 + Math.max(0, devices.size - 1) * 12 + Math.max(0, students.size - 1) * 15 + pastedFast * 6 + automated * 18 + (honey ? 28 : 0) + (usedByOther ? 18 : 0)
  );
  let label = "\u062E\u0637\u0623 \u0637\u0627\u0644\u0628 \u0637\u0628\u064A\u0639\u064A";
  if (automated || honey || total >= 10) {
    level = "\u0646\u0645\u0637 \u0622\u0644\u064A";
    label = "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0634\u0628\u0647 \u0627\u0644\u062A\u062E\u0645\u064A\u0646 \u0623\u0648 \u0627\u0644\u0633\u0643\u0631\u0628\u062A";
  } else if (usedByOther || students.size >= 2) {
    level = "\u062A\u062F\u0627\u0648\u0644 \u0645\u062D\u062A\u0645\u0644";
    label = "\u0643\u0648\u062F \u064A\u0628\u062F\u0648 \u0623\u0646\u0647 \u0627\u0646\u062A\u0642\u0644 \u0628\u064A\u0646 \u0623\u0643\u062B\u0631 \u0645\u0646 \u0637\u0627\u0644\u0628";
  } else if (pastedFast >= 2 || devices.size >= 3) {
    level = "\u0646\u0633\u062E/\u0644\u0635\u0642 \u0645\u0634\u0628\u0648\u0647";
    label = "\u0625\u062F\u062E\u0627\u0644 \u0633\u0631\u064A\u0639 \u0623\u0648 \u0623\u062C\u0647\u0632\u0629 \u0645\u062A\u0639\u062F\u062F\u0629 \u064A\u062D\u062A\u0627\u062C \u0645\u062A\u0627\u0628\u0639\u0629";
  } else if (total <= 2 && devices.size <= 1) {
    score = Math.min(score, 25);
  }
  return {
    level,
    label,
    score,
    totalAttempts: total,
    distinctDevices: devices.size,
    distinctStudents: students.size
  };
}
function calculateSessionConfidence(req, student, codeRecord, telemetry) {
  const token = getRequestDeviceToken(req);
  const fingerprint = getRequestDeviceFingerprint(req);
  let score = 82;
  const reasons = [];
  if (!token) {
    score -= 35;
    reasons.push("\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0648\u0643\u0646 \u062C\u0647\u0627\u0632");
  }
  if (codeRecord?.activationDeviceToken && token && codeRecord.activationDeviceToken === token) {
    score += 12;
    reasons.push("\u062A\u0648\u0643\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0637\u0627\u0628\u0642");
  }
  if (codeRecord?.activationDeviceToken && token && codeRecord.activationDeviceToken !== token) {
    score -= 32;
    reasons.push("\u062A\u0648\u0643\u0646 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641");
  }
  if (codeRecord?.activationDeviceFingerprint && fingerprint && codeRecord.activationDeviceFingerprint === fingerprint) {
    score += 8;
    reasons.push("\u0628\u0635\u0645\u0629 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0637\u0627\u0628\u0642\u0629");
  }
  if (codeRecord?.activationDeviceFingerprint && fingerprint && codeRecord.activationDeviceFingerprint !== fingerprint) {
    score -= 16;
    reasons.push("\u0628\u0635\u0645\u0629 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641\u0629");
  }
  if (telemetry?.looksAutomated) {
    score -= 20;
    reasons.push("\u0646\u0645\u0637 \u0625\u062F\u062E\u0627\u0644 \u0622\u0644\u064A");
  }
  if (telemetry?.pasted && Number(telemetry?.durationMs || 0) < 1500) {
    score -= 8;
    reasons.push("\u0644\u0635\u0642 \u0633\u0631\u064A\u0639 \u0644\u0644\u0643\u0648\u062F");
  }
  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? "\u062B\u0642\u0629 \u0639\u0627\u0644\u064A\u0629" : score >= 55 ? "\u062B\u0642\u0629 \u0645\u062A\u0648\u0633\u0637\u0629" : score >= 35 ? "\u062B\u0642\u0629 \u0645\u0646\u062E\u0641\u0636\u0629" : "\u062E\u0637\u0631";
  return { score, level, reasons };
}
function buildCodeCaseFile(code, attempts) {
  const normalized = normalizeJoinCode(
    code?.code || attempts[0]?.normalizedCode || attempts[0]?.code || ""
  );
  const relatedAttempts = attempts.filter(
    (a) => compactJoinCode(a.normalizedCode || a.code || "") === compactJoinCode(normalized)
  );
  const involvedStudents = Array.from(
    new Map(
      relatedAttempts.map((a) => [
        normalizeStudentId(a.studentId) || a.studentName || a.id,
        {
          id: normalizeStudentId(a.studentId),
          name: a.studentName || "\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641",
          sectionCode: a.sectionCode || code?.studentSection || code?.sectionCode || ""
        }
      ])
    ).values()
  ).filter((x) => x.id || x.name !== "\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641");
  const devices = new Set(
    relatedAttempts.map((a) => a.deviceToken || a.deviceFingerprint).filter(Boolean)
  );
  const last = relatedAttempts.slice().sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  )[0];
  const fairness = classifyStudentFairness(relatedAttempts, code);
  return {
    id: `case-${compactJoinCode(normalized) || import_crypto.default.createHash("sha1").update(String(normalized)).digest("hex").slice(0, 10)}`,
    code: normalized,
    batchId: resolveJoinCodeBatchId(code),
    ownerStudentId: code?.studentId || code?.usedByStudentId || code?.assignedStudentId || "",
    ownerStudentName: code?.studentName || code?.assignedStudentName || "",
    sectionCode: code?.studentSection || code?.sectionCode || last?.sectionCode || "",
    reputation: code?.codeReputation || last?.codeReputation || "watch",
    reputationLabel: code?.codeReputationLabel || last?.codeReputationLabel || "\u0645\u0631\u0627\u0642\u0628\u0629",
    reputationScore: Number(
      code?.codeReputationScore || last?.codeReputationScore || fairness.score || 0
    ),
    reason: code?.lastFailedAttemptReason || last?.reason || fairness.label,
    attempts: relatedAttempts.length,
    devices: devices.size,
    involvedStudents,
    lastAt: last?.timestamp || code?.lastFailedAttemptAt || "",
    fairness,
    silentEnforcement: true,
    secondStepRecommended: Number(code?.codeReputationScore || fairness.score || 0) >= 85 && !code?.activationReviewRequired
  };
}
function buildBatchIntelligence(codes, attempts) {
  const batches = /* @__PURE__ */ new Map();
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
      distinctDevices: /* @__PURE__ */ new Set(),
      distinctStudents: /* @__PURE__ */ new Set(),
      sections: /* @__PURE__ */ new Set(),
      score: 0
    };
    item.totalCodes += 1;
    if (String(code.status || "") === "used") item.usedCodes += 1;
    if (String(code.status || "") === "active") item.activeCodes += 1;
    if (Number(code.codeReputationScore || 0) >= 40 || code.activationReviewRequired)
      item.suspiciousCodes += 1;
    if (String(code.codeReputation || "") === "danger") item.dangerCodes += 1;
    if (String(code.codeReputation || "") === "temporarily_blocked" || isJoinCodeTemporarilyFrozen(code))
      item.frozenCodes += 1;
    const section = String(
      code.studentSection || code.sectionCode || ""
    ).trim();
    if (section) item.sections.add(section);
    batches.set(batchId, item);
  }
  for (const attempt of attempts) {
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || ""
    );
    const code = codes.find(
      (c) => compactJoinCode(c.code) === compactJoinCode(normalized)
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
      distinctDevices: /* @__PURE__ */ new Set(),
      distinctStudents: /* @__PURE__ */ new Set(),
      sections: /* @__PURE__ */ new Set(),
      score: 0
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
  return Array.from(batches.values()).map((b) => {
    const abnormalRate = b.totalCodes ? Math.round(b.suspiciousCodes / b.totalCodes * 100) : b.attempts ? 100 : 0;
    const score = Math.min(
      99,
      abnormalRate + Math.min(35, b.attempts * 3) + Math.min(25, b.distinctDevices.size * 5) + Math.min(20, b.honeyAttempts * 10) + b.dangerCodes * 12 + b.frozenCodes * 10
    );
    const level = score >= 75 ? "\u0639\u0627\u0644\u064A\u0629 \u0627\u0644\u062E\u0637\u0648\u0631\u0629" : score >= 45 ? "\u062A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u0642\u0628\u0629" : "\u0622\u0645\u0646\u0629";
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
      sections: Array.from(b.sections).slice(0, 8)
    };
  }).sort((a, b) => b.score - a.score);
}
function buildCollectiveTransferAlerts(codes, attempts) {
  const groups = /* @__PURE__ */ new Map();
  for (const attempt of attempts) {
    const reason = String(attempt.reason || "");
    if (!(reason.includes("\u0645\u0633\u062A\u062E\u062F\u0645") || reason.includes("\u0645\u0631\u062A\u0628\u0637") || reason.includes("\u062C\u0647\u0627\u0632") || reason.includes("\u062A\u0648\u0643\u0646")))
      continue;
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || ""
    );
    const code = codes.find(
      (c) => compactJoinCode(c.code) === compactJoinCode(normalized)
    );
    const section = String(
      attempt.sectionCode || code?.studentSection || code?.sectionCode || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629"
    );
    const item = groups.get(section) || {
      sectionCode: section,
      attempts: 0,
      codes: /* @__PURE__ */ new Set(),
      students: /* @__PURE__ */ new Set(),
      devices: /* @__PURE__ */ new Set(),
      examples: []
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
        at: attempt.timestamp || ""
      });
    groups.set(section, item);
  }
  return Array.from(groups.values()).map((g) => ({
    sectionCode: g.sectionCode,
    attempts: g.attempts,
    distinctCodes: g.codes.size,
    distinctStudents: g.students.size,
    distinctDevices: g.devices.size,
    examples: g.examples,
    score: Math.min(
      99,
      g.attempts * 10 + g.codes.size * 15 + g.students.size * 12
    )
  })).filter(
    (g) => g.distinctCodes >= 2 || g.distinctStudents >= 2 || g.attempts >= 4
  ).sort((a, b) => b.score - a.score).slice(0, 10);
}
function codeConfidenceStamp(score, level) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "danger" || score >= 90)
    return { label: "\u062E\u0637\u0631", tone: "rose", score };
  if (normalized === "suspicious" || score >= 70)
    return { label: "\u0645\u062A\u062F\u0627\u0648\u0644 \u0645\u062D\u062A\u0645\u0644", tone: "orange", score };
  if (normalized === "watch" || score >= 40)
    return { label: "\u064A\u062D\u062A\u0627\u062C \u0645\u062A\u0627\u0628\u0639\u0629", tone: "amber", score };
  if (score >= 20) return { label: "\u0637\u0628\u064A\u0639\u064A", tone: "emerald", score };
  return { label: "\u0645\u0648\u062B\u0648\u0642", tone: "emerald", score };
}
function recommendCodeAction(input) {
  const score = Number(input.score || 0);
  const text = [
    input.reason,
    input.fairnessLevel,
    input.sessionLevel,
    input.batchLevel
  ].join(" ");
  if (input.activationReviewRequired || score >= 92)
    return {
      action: "\u062C\u0645\u0651\u062F \u0627\u0644\u0643\u0648\u062F \u0644\u0644\u0645\u0631\u0627\u062C\u0639\u0629",
      priority: "\u0639\u0627\u0644\u064A\u0629",
      rationale: "\u062F\u0631\u062C\u0629 \u0627\u0644\u0627\u0634\u062A\u0628\u0627\u0647 \u0645\u0631\u062A\u0641\u0639\u0629 \u0648\u062A\u062D\u062A\u0627\u062C \u0642\u0631\u0627\u0631\u064B\u0627 \u0625\u062F\u0627\u0631\u064A\u064B\u0627 \u0642\u0628\u0644 \u0627\u0633\u062A\u0645\u0631\u0627\u0631 \u0627\u0644\u062A\u0641\u0639\u064A\u0644."
    };
  if (text.includes("\u062F\u0641\u0639\u0629") || input.batchLevel === "\u0639\u0627\u0644\u064A\u0629 \u0627\u0644\u062E\u0637\u0648\u0631\u0629")
    return {
      action: "\u0631\u0627\u062C\u0639 \u0627\u0644\u062F\u0641\u0639\u0629",
      priority: "\u0639\u0627\u0644\u064A\u0629",
      rationale: "\u0627\u0644\u0646\u0645\u0637 \u0645\u0631\u062A\u0628\u0637 \u0628\u0645\u0635\u062F\u0631 \u0627\u0644\u0623\u0643\u0648\u0627\u062F \u0648\u0644\u064A\u0633 \u0628\u0643\u0648\u062F \u0648\u0627\u062D\u062F \u0641\u0642\u0637."
    };
  if (text.includes("\u062A\u062F\u0627\u0648\u0644") || text.includes("\u0645\u0633\u062A\u062E\u062F\u0645") || text.includes("\u0645\u0631\u062A\u0628\u0637") || score >= 78)
    return {
      action: "\u0627\u0637\u0644\u0628 \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0637\u0627\u0644\u0628",
      priority: "\u0645\u062A\u0648\u0633\u0637\u0629",
      rationale: "\u062A\u0648\u062C\u062F \u0645\u0624\u0634\u0631\u0627\u062A \u0627\u0646\u062A\u0642\u0627\u0644 \u0643\u0648\u062F \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647 \u0645\u0646 \u0623\u0643\u062B\u0631 \u0645\u0646 \u062C\u0647\u0629."
    };
  if (text.includes("\u062C\u0647\u0627\u0632") || text.includes("\u062A\u0648\u0643\u0646"))
    return {
      action: "\u0623\u0639\u062F \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632 \u0639\u0646\u062F \u0627\u0644\u062D\u0627\u062C\u0629",
      priority: "\u0645\u062A\u0648\u0633\u0637\u0629",
      rationale: "\u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0627\u0644\u062C\u0647\u0627\u0632\u060C \u0648\u0644\u0627 \u064A\u0644\u0632\u0645 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0643\u0648\u062F \u0645\u0628\u0627\u0634\u0631\u0629."
    };
  if (text.includes("\u0645\u0635\u064A\u062F\u0629") || text.includes("\u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F") || text.includes("\u0635\u064A\u063A\u0629") || score >= 45)
    return {
      action: "\u0631\u0627\u0642\u0628 \u0641\u0642\u0637",
      priority: "\u0645\u0646\u062E\u0641\u0636\u0629",
      rationale: "\u0627\u0644\u0633\u0644\u0648\u0643 \u064A\u0633\u062A\u062D\u0642 \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u062F\u0648\u0646 \u0625\u062C\u0631\u0627\u0621 \u0645\u0628\u0627\u0634\u0631 \u0639\u0644\u0649 \u0627\u0644\u0637\u0627\u0644\u0628."
    };
  return {
    action: "\u0644\u0627 \u062A\u0641\u0639\u0644 \u0634\u064A\u0626\u064B\u0627",
    priority: "\u0647\u0627\u062F\u0626\u0629",
    rationale: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0624\u0634\u0631\u0627\u062A \u0643\u0627\u0641\u064A\u0629 \u0644\u0627\u062A\u062E\u0627\u0630 \u0625\u062C\u0631\u0627\u0621."
  };
}
function buildSeasonalCodeMemory(codes, attempts) {
  const buckets = /* @__PURE__ */ new Map();
  const sorted = attempts.slice().sort(
    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
  );
  for (const attempt of sorted) {
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || ""
    );
    const code = codes.find(
      (c) => compactJoinCode(c.code) === compactJoinCode(normalized)
    );
    const rawTerm = String(
      code?.semester || code?.academicTerm || attempt.semester || attempt.academicTerm || "\u0641\u0635\u0644 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F"
    ).trim() || "\u0641\u0635\u0644 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F";
    const date = new Date(attempt.timestamp || Date.now());
    const weekKey = Number.isFinite(date.getTime()) ? `${date.getUTCFullYear()}-W${Math.ceil(((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5 + new Date(Date.UTC(date.getUTCFullYear(), 0, 1)).getUTCDay() + 1) / 7)}` : "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F";
    const item = buckets.get(rawTerm) || {
      term: rawTerm,
      attempts: 0,
      honey: 0,
      trading: 0,
      device: 0,
      automated: 0,
      weeks: /* @__PURE__ */ new Map(),
      sections: /* @__PURE__ */ new Map(),
      latestAt: ""
    };
    item.attempts += 1;
    if (attempt.honeyCode || String(attempt.reason || "").includes("\u0645\u0635\u064A\u062F\u0629"))
      item.honey += 1;
    if (String(attempt.reason || "").includes("\u0645\u0633\u062A\u062E\u062F\u0645") || String(attempt.reason || "").includes("\u0645\u0631\u062A\u0628\u0637"))
      item.trading += 1;
    if (String(attempt.reason || "").includes("\u062C\u0647\u0627\u0632") || String(attempt.reason || "").includes("\u062A\u0648\u0643\u0646"))
      item.device += 1;
    if (attempt.activationTelemetry?.looksAutomated) item.automated += 1;
    const wk = item.weeks.get(weekKey) || {
      week: weekKey,
      attempts: 0,
      trading: 0,
      honey: 0
    };
    wk.attempts += 1;
    wk.trading += String(attempt.reason || "").includes("\u0645\u0633\u062A\u062E\u062F\u0645") ? 1 : 0;
    wk.honey += attempt.honeyCode ? 1 : 0;
    item.weeks.set(weekKey, wk);
    const section = String(
      attempt.sectionCode || code?.studentSection || code?.sectionCode || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629"
    );
    item.sections.set(section, (item.sections.get(section) || 0) + 1);
    item.latestAt = attempt.timestamp || item.latestAt;
    buckets.set(rawTerm, item);
  }
  return Array.from(buckets.values()).map((b) => {
    const weeks = Array.from(b.weeks.values()).sort((a, b2) => b2.attempts - a.attempts).slice(0, 4);
    const sections = Array.from(b.sections.entries()).map(([sectionCode, count]) => ({ sectionCode, count })).sort((a, b2) => b2.count - a.count).slice(0, 5);
    const score = Math.min(
      99,
      b.attempts * 3 + b.trading * 12 + b.honey * 10 + b.automated * 14 + b.device * 5
    );
    const expectedTrend = score >= 75 ? "\u0627\u0631\u062A\u0641\u0627\u0639 \u0645\u062A\u0648\u0642\u0639 \u064A\u062D\u062A\u0627\u062C \u0645\u062A\u0627\u0628\u0639\u0629" : score >= 45 ? "\u0646\u0634\u0627\u0637 \u0642\u0627\u0628\u0644 \u0644\u0644\u0632\u064A\u0627\u062F\u0629" : "\u0646\u0634\u0627\u0637 \u0637\u0628\u064A\u0639\u064A";
    const nextRecommendation = score >= 75 ? "\u0631\u0627\u0642\u0628 \u0623\u0648\u0644 \u0623\u0633\u0628\u0648\u0639 \u0648\u0623\u064A\u0627\u0645 \u0645\u0627 \u0642\u0628\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u060C \u0648\u0631\u0627\u062C\u0639 \u0627\u0644\u062F\u0641\u0639\u0627\u062A \u0630\u0627\u062A \u0627\u0644\u0646\u0634\u0627\u0637 \u0627\u0644\u0623\u0639\u0644\u0649." : score >= 45 ? "\u0627\u0643\u062A\u0641\u0650 \u0628\u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u0647\u0627\u062F\u0626\u0629 \u0645\u0639 \u0641\u062D\u0635 \u0627\u0644\u0634\u0639\u0628 \u0627\u0644\u0623\u0639\u0644\u0649 \u0646\u0634\u0627\u0637\u064B\u0627." : "\u0644\u0627 \u064A\u0644\u0632\u0645 \u0625\u062C\u0631\u0627\u0621 \u062E\u0627\u0635.";
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
      latestAt: b.latestAt
    };
  }).sort((a, b) => b.score - a.score).slice(0, 8);
}
function buildOutOfContextCodeAlerts(codes, attempts) {
  const alerts = [];
  for (const attempt of attempts) {
    const normalized = normalizeJoinCode(
      attempt.normalizedCode || attempt.code || ""
    );
    const code = codes.find(
      (c) => compactJoinCode(c.code) === compactJoinCode(normalized)
    );
    if (!code) continue;
    const expectedSection = String(
      code.studentSection || code.sectionCode || ""
    ).trim();
    const actualSection = String(attempt.sectionCode || "").trim();
    const reasons = [];
    if (expectedSection && actualSection && expectedSection !== actualSection)
      reasons.push("\u0627\u0644\u0634\u0639\u0628\u0629 \u0644\u0627 \u062A\u0637\u0627\u0628\u0642 \u0634\u0639\u0628\u0629 \u0627\u0644\u0643\u0648\u062F");
    const window = joinCodeWindowStatus(code);
    if (!window.ok) reasons.push("\u0645\u062D\u0627\u0648\u0644\u0629 \u062E\u0627\u0631\u062C \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u062A\u0641\u0639\u064A\u0644");
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
        score: reasons.length * 35 + (String(attempt.reason || "").includes("\u0645\u0633\u062A\u062E\u062F\u0645") ? 20 : 0)
      });
  }
  return alerts.sort((a, b) => b.score - a.score).slice(0, 12);
}
function inferLeakSources(codes, attempts, batchIntelligence, collectiveTransferAlerts, outOfContextAlerts) {
  const signals = [];
  const highBatch = batchIntelligence.filter((b) => b.score >= 65);
  for (const b of highBatch.slice(0, 6))
    signals.push({
      source: "\u062F\u0641\u0639\u0629 \u0623\u0643\u0648\u0627\u062F \u062A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u062C\u0639\u0629",
      confidence: Math.min(99, b.score),
      evidence: `\u062F\u0641\u0639\u0629 ${b.batchId}: \u0646\u0634\u0627\u0637 \u063A\u064A\u0631 \u0637\u0628\u064A\u0639\u064A ${b.abnormalRate}%\u060C \u0623\u062C\u0647\u0632\u0629 ${b.distinctDevices}\u060C \u0648\u0645\u062D\u0627\u0648\u0644\u0627\u062A ${b.attempts}.`,
      recommendation: "\u0631\u0627\u062C\u0639 \u0645\u0635\u062F\u0631 \u062A\u0648\u0632\u064A\u0639 \u0627\u0644\u062F\u0641\u0639\u0629 \u0648\u0637\u0631\u064A\u0642\u0629 \u062A\u0633\u0644\u064A\u0645\u0647\u0627."
    });
  for (const c of collectiveTransferAlerts.slice(0, 6))
    signals.push({
      source: "\u062A\u062F\u0627\u0648\u0644 \u062F\u0627\u062E\u0644 \u0634\u0639\u0628\u0629",
      confidence: Math.min(99, c.score),
      evidence: `\u0627\u0644\u0634\u0639\u0628\u0629 ${c.sectionCode}: ${c.distinctCodes} \u0623\u0643\u0648\u0627\u062F \u0648${c.distinctStudents} \u0637\u0644\u0628\u0629 \u0636\u0645\u0646 \u0646\u0645\u0637 \u0648\u0627\u062D\u062F.`,
      recommendation: "\u0631\u0627\u062C\u0639 \u0627\u0644\u0634\u0639\u0628\u0629 \u0628\u0647\u062F\u0648\u0621 \u062F\u0648\u0646 \u0627\u062A\u0647\u0627\u0645 \u0645\u0628\u0627\u0634\u0631."
    });
  const honeyCount = attempts.filter(
    (a) => a.honeyCode || String(a.reason || "").includes("\u0645\u0635\u064A\u062F\u0629")
  ).length;
  const automatedCount = attempts.filter(
    (a) => a.activationTelemetry?.looksAutomated
  ).length;
  if (honeyCount >= 3 || automatedCount >= 3)
    signals.push({
      source: "\u062A\u062E\u0645\u064A\u0646 \u0622\u0644\u064A \u0623\u0648 \u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0639\u0634\u0648\u0627\u0626\u064A\u0629",
      confidence: Math.min(99, 50 + honeyCount * 8 + automatedCount * 10),
      evidence: `${honeyCount} \u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0639\u0644\u0649 \u0623\u0643\u0648\u0627\u062F \u063A\u064A\u0631 \u0645\u0635\u062F\u0631\u0629 \u0648${automatedCount} \u0623\u0646\u0645\u0627\u0637 \u0625\u062F\u062E\u0627\u0644 \u0622\u0644\u064A\u0629.`,
      recommendation: "\u0627\u0643\u062A\u0641\u0650 \u0628\u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0648\u0627\u0644\u062E\u0646\u0642 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A \u0644\u0644\u0645\u062D\u0627\u0648\u0644\u0627\u062A."
    });
  if (outOfContextAlerts.length >= 2)
    signals.push({
      source: "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062E\u0627\u0631\u062C \u0627\u0644\u0633\u064A\u0627\u0642",
      confidence: Math.min(99, 45 + outOfContextAlerts.length * 8),
      evidence: `${outOfContextAlerts.length} \u0645\u062D\u0627\u0648\u0644\u0629 \u0638\u0647\u0631\u062A \u0641\u064A \u0634\u0639\u0628\u0629 \u0623\u0648 \u0648\u0642\u062A \u063A\u064A\u0631 \u0645\u062A\u0648\u0642\u0639.`,
      recommendation: "\u0631\u0627\u062C\u0639 \u062A\u0648\u0627\u0641\u0642 \u0627\u0644\u062F\u0641\u0639\u0629 \u0645\u0639 \u0627\u0644\u0634\u0639\u0628\u0629 \u0648\u0648\u0642\u062A \u0627\u0644\u062A\u0648\u0632\u064A\u0639."
    });
  return signals.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}
function buildTeacherCodeReports(input) {
  const reports = [];
  const topBatch = input.batchIntelligence.find((b) => b.score >= 45);
  if (topBatch)
    reports.push({
      title: `\u062F\u0641\u0639\u0629 ${topBatch.batchId} \u062A\u062D\u062A\u0627\u062C \u0645\u062A\u0627\u0628\u0639\u0629`,
      body: `\u0646\u0634\u0627\u0637 \u063A\u064A\u0631 \u0637\u0628\u064A\u0639\u064A ${topBatch.abnormalRate}% \u0645\u0639 ${topBatch.attempts} \u0645\u062D\u0627\u0648\u0644\u0629 \u0648${topBatch.distinctDevices} \u0623\u062C\u0647\u0632\u0629.`,
      suggestedAction: topBatch.score >= 75 ? "\u0631\u0627\u062C\u0639 \u0627\u0644\u062F\u0641\u0639\u0629 \u0642\u0628\u0644 \u062A\u0648\u0632\u064A\u0639 \u0623\u0643\u0648\u0627\u062F \u0625\u0636\u0627\u0641\u064A\u0629." : "\u0631\u0627\u0642\u0628 \u0627\u0644\u062F\u0641\u0639\u0629 \u0641\u0642\u0637 \u0648\u0644\u0627 \u062A\u0648\u0642\u0641\u0647\u0627 \u0627\u0644\u0622\u0646.",
      priority: topBatch.score >= 75 ? "\u0639\u0627\u0644\u064A\u0629" : "\u0645\u062A\u0648\u0633\u0637\u0629"
    });
  const topCollective = input.collectiveTransferAlerts[0];
  if (topCollective)
    reports.push({
      title: `\u0627\u0634\u062A\u0628\u0627\u0647 \u062A\u062F\u0627\u0648\u0644 \u062F\u0627\u062E\u0644 \u0634\u0639\u0628\u0629 ${topCollective.sectionCode}`,
      body: `${topCollective.distinctCodes} \u0623\u0643\u0648\u0627\u062F \u0648${topCollective.distinctStudents} \u0637\u0644\u0628\u0629 \u0638\u0647\u0631\u0648\u0627 \u0641\u064A \u0646\u0645\u0637 \u0648\u0627\u062D\u062F.`,
      suggestedAction: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0637\u0644\u0627\u0628 \u0628\u0647\u062F\u0648\u0621\u060C \u0648\u0644\u0627 \u062D\u0627\u062C\u0629 \u0644\u0625\u064A\u0642\u0627\u0641 \u0643\u0627\u0645\u0644 \u0627\u0644\u062F\u0641\u0639\u0629 \u0645\u0628\u0627\u0634\u0631\u0629.",
      priority: "\u0645\u062A\u0648\u0633\u0637\u0629"
    });
  const topLeak = input.leakSources[0];
  if (topLeak)
    reports.push({
      title: `\u062A\u0641\u0633\u064A\u0631 \u0645\u062D\u062A\u0645\u0644: ${topLeak.source}`,
      body: topLeak.evidence,
      suggestedAction: topLeak.recommendation,
      priority: topLeak.confidence >= 75 ? "\u0639\u0627\u0644\u064A\u0629" : "\u0645\u062A\u0648\u0633\u0637\u0629"
    });
  const topContext = input.outOfContextAlerts[0];
  if (topContext)
    reports.push({
      title: "\u0643\u0648\u062F \u0638\u0647\u0631 \u062E\u0627\u0631\u062C \u0633\u064A\u0627\u0642\u0647",
      body: `${topContext.code} \u0638\u0647\u0631 \u0641\u064A ${topContext.actualSection || "\u0634\u0639\u0628\u0629 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629"} \u0628\u064A\u0646\u0645\u0627 \u0627\u0644\u0645\u062A\u0648\u0642\u0639 ${topContext.expectedSection || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F"}.`,
      suggestedAction: "\u0631\u0627\u062C\u0639 \u0627\u0631\u062A\u0628\u0627\u0637 \u0627\u0644\u0643\u0648\u062F \u0628\u0627\u0644\u0634\u0639\u0628\u0629 \u0642\u0628\u0644 \u0627\u062A\u062E\u0627\u0630 \u0625\u062C\u0631\u0627\u0621 \u0639\u0644\u0649 \u0627\u0644\u0637\u0627\u0644\u0628.",
      priority: "\u0645\u0646\u062E\u0641\u0636\u0629"
    });
  return reports.slice(0, 6);
}
function markJoinCodeActivated(code, req, student, extra = {}) {
  const existing = code;
  return {
    codeReputation: "normal",
    codeReputationLabel: CODE_REPUTATION_LABELS.normal,
    codeReputationScore: Math.max(
      0,
      Math.min(25, Number(existing.codeReputationScore || 0))
    ),
    codeReputationUpdatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    strictLibraryMode: existing.strictLibraryMode !== false,
    activationReviewRequired: false,
    activationFrozenUntil: "",
    codeJourney: appendCodeJourney(
      code,
      codeJourneyEvent("\u062A\u0645 \u0627\u0644\u062A\u0641\u0639\u064A\u0644", req, {
        studentId: student.id,
        studentName: student.name,
        sectionCode: extra.sectionCode || student.sectionCode,
        telemetry: getActivationTelemetry(req)
      })
    )
  };
}
function sendActivationRateLimitIfNeeded(req, res, params) {
  const limit = getActivationRateLimit(req, params);
  if (!limit.limited) return false;
  recordActivationAttempt(req, {
    code: params.code || "",
    student: params.student,
    foundCode: params.foundCode,
    reason: "\u0625\u064A\u0642\u0627\u0641 \u0645\u0624\u0642\u062A \u0628\u0633\u0628\u0628 \u062A\u0643\u0631\u0627\u0631 \u0645\u062D\u0627\u0648\u0644\u0627\u062A \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0643\u0648\u062F"
  });
  res.setHeader("Retry-After", String(limit.retryAfterSeconds));
  res.status(429).json({
    error: "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0627\u0644\u062A\u0641\u0639\u064A\u0644 \u0645\u0624\u0642\u062A\u064B\u0627 \u0644\u062D\u0645\u0627\u064A\u0629 \u0627\u0644\u0643\u0648\u062F. \u062D\u0627\u0648\u0644 \u0644\u0627\u062D\u0642\u064B\u0627 \u0623\u0648 \u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
  });
  return true;
}
function recordActivationAttempt(req, params) {
  const dedupToken = getRequestDeviceToken(req);
  const dedupFingerprint = getRequestDeviceFingerprint(req);
  const dedupWindowMs = 6 * 60 * 60 * 1e3;
  const dedupNow = Date.now();
  rememberActivationRateStrike(req, {
    code: params.code,
    student: params.student
  });
  const hasRecentIdenticalAttempt = dbInstance.getActivationAttempts().some((attempt) => {
    if (String(attempt.reason || "") !== String(params.reason || "")) return false;
    if (String(attempt.studentId || "") !== String(params.student?.id || ""))
      return false;
    if (compactJoinCode(attempt.normalizedCode || attempt.code || "") !== compactJoinCode(params.code))
      return false;
    const sameDevice = !!dedupToken && String(attempt.deviceToken || "") === dedupToken || !!dedupFingerprint && String(attempt.deviceFingerprint || "") === dedupFingerprint || !dedupToken && !dedupFingerprint;
    if (!sameDevice) return false;
    const attemptMs = new Date(attempt.timestamp || 0).getTime();
    return Number.isFinite(attemptMs) && dedupNow - attemptMs < dedupWindowMs;
  });
  if (hasRecentIdenticalAttempt) return;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const deviceFingerprint = getRequestDeviceFingerprint(req);
  const deviceToken = getRequestDeviceToken(req);
  const telemetry = getActivationTelemetry(req);
  const attemptSectionCode = String(
    req.body?.courseCode || req.body?.sectionCode || params.student?.sectionCode || params.student?.studentSection || params.foundCode?.studentSection || params.foundCode?.sectionCode || params.foundCode?.courseCode || ""
  ).trim();
  const reputation = updateJoinCodeReputation(req, { ...params, telemetry });
  const honeyCode = isUnifiedJoinCode(params.code) && !params.foundCode;
  const currentAttemptsForCode = dbInstance.getActivationAttempts().filter(
    (attempt) => compactJoinCode(attempt.normalizedCode || attempt.code || "") === compactJoinCode(params.code)
  );
  const fairness = classifyStudentFairness(
    currentAttemptsForCode,
    params.foundCode
  );
  const sessionConfidence = calculateSessionConfidence(
    req,
    params.student,
    params.foundCode,
    telemetry
  );
  const batchId = params.foundCode ? resolveJoinCodeBatchId(params.foundCode) : "\u0645\u0635\u0627\u0626\u062F \u0627\u0644\u0623\u0643\u0648\u0627\u062F";
  const secondStepRecommended = Boolean(
    (reputation?.score || fairness.score) >= 85 && !params.foundCode?.activationReviewRequired
  );
  dbInstance.addActivationAttempt({
    id: `act-${Date.now()}-${import_crypto.default.randomBytes(3).toString("hex")}`,
    code: String(params.code || ""),
    normalizedCode: normalizeJoinCode(params.code),
    studentId: params.student?.id,
    studentName: params.student?.name,
    sectionCode: attemptSectionCode,
    courseCode: attemptSectionCode,
    targetSectionCode: attemptSectionCode,
    status: params.status || "blocked",
    reason: honeyCode ? "\u0645\u0635\u064A\u062F\u0629 \u0643\u0648\u062F \u063A\u064A\u0631 \u0645\u064F\u0635\u062F\u0631 \u0623\u0648 \u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u062E\u0645\u064A\u0646 \u0643\u0648\u062F" : params.reason,
    deviceFingerprint,
    deviceToken,
    ip: req.ip || "127.0.0.1",
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    timestamp,
    activationTelemetry: telemetry,
    codeReputation: reputation?.level || (honeyCode ? "suspicious" : "watch"),
    codeReputationLabel: reputation?.label || (honeyCode ? "\u0645\u0634\u062A\u0628\u0647" : "\u0645\u0631\u0627\u0642\u0628\u0629"),
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
      reputation?.level || (honeyCode ? "suspicious" : "watch")
    ),
    recommendedAction: recommendCodeAction({
      score: reputation?.score || fairness.score,
      reason: params.reason,
      fairnessLevel: fairness.level,
      sessionLevel: sessionConfidence.level
    })
  });
  if (params.foundCode) {
    dbInstance.updateJoinCode(params.foundCode.code, {
      leakAttemptCount: Number(params.foundCode.leakAttemptCount || 0) + 1,
      lastFailedAttemptAt: timestamp,
      lastFailedAttemptStudentId: params.student?.id,
      lastFailedAttemptReason: params.reason,
      batchId,
      lastFairnessLevel: fairness.level,
      lastFairnessLabel: fairness.label,
      lastFairnessScore: fairness.score,
      lastSessionConfidenceScore: sessionConfidence.score,
      secondStepRecommended
    });
  }
  dbInstance.addActivityLog({
    studentId: params.student?.id,
    studentName: params.student?.name || "\u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641\u0629",
    action: honeyCode ? "\u0645\u0635\u064A\u062F\u0629 \u0643\u0648\u062F" : "\u0645\u062D\u0627\u0648\u0644\u0629 \u0643\u0648\u062F \u0645\u0631\u0641\u0648\u0636\u0629",
    details: `${honeyCode ? "\u0645\u0635\u064A\u062F\u0629 \u0643\u0648\u062F \u063A\u064A\u0631 \u0645\u064F\u0635\u062F\u0631" : params.reason} \u2014 \u0627\u0644\u0631\u0645\u0632: ${normalizeJoinCode(params.code) || "-"}`,
    teacherEmail: attemptSectionCode ? sectionOwnerEmail(attemptSectionCode) : void 0,
    actorEmail: attemptSectionCode ? sectionOwnerEmail(attemptSectionCode) : void 0,
    sectionCode: attemptSectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: String(req.headers["user-agent"] || "Unknown"),
    os: "\u0646\u0632\u0627\u0647\u0629 \u0627\u0644\u0623\u0643\u0648\u0627\u062F",
    browser: honeyCode ? "\u0645\u0635\u064A\u062F\u0629 \u0627\u0644\u0623\u0643\u0648\u0627\u062F" : "\u0646\u0638\u0627\u0645 \u0627\u0644\u062D\u0645\u0627\u064A\u0629",
    isViolationWarning: true
  });
  if (params.student && attemptSectionCode) {
    notifyTeachersForSection(
      attemptSectionCode,
      honeyCode ? "\u0645\u0635\u064A\u062F\u0629 \u0643\u0648\u062F" : "\u062A\u0646\u0628\u064A\u0647 \u0646\u0632\u0627\u0647\u0629 \u0643\u0648\u062F",
      `\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0641\u0648\u0636\u0629 \u0644\u0644\u0637\u0627\u0644\u0628 ${params.student.name}: ${honeyCode ? "\u0645\u0635\u064A\u062F\u0629 \u0643\u0648\u062F \u063A\u064A\u0631 \u0645\u064F\u0635\u062F\u0631" : params.reason}`,
      {
        type: "code_integrity",
        code: normalizeJoinCode(params.code),
        studentId: params.student.id,
        link: "/"
      }
    );
  }
}
var MIRAS_JOIN_CODE_PREFIX = "LAB";
var MIRAS_JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var MIRAS_JOIN_CODE_GROUPS = 3;
var MIRAS_JOIN_CODE_GROUP_SIZE = 4;
var MIRAS_JOIN_CODE_COMPACT_LENGTH = MIRAS_JOIN_CODE_PREFIX.length + MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE;
function makeJoinCode(prefix = MIRAS_JOIN_CODE_PREFIX, studentId = "", existing = /* @__PURE__ */ new Set()) {
  const safePrefix = String(prefix || MIRAS_JOIN_CODE_PREFIX).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || MIRAS_JOIN_CODE_PREFIX;
  const groupsFromBody = (body2) => {
    const groups = [];
    for (let i = 0; i < body2.length; i += MIRAS_JOIN_CODE_GROUP_SIZE) {
      groups.push(body2.slice(i, i + MIRAS_JOIN_CODE_GROUP_SIZE));
    }
    return [safePrefix, ...groups].join("-");
  };
  const randomBody = () => {
    let out = "";
    for (let i = 0; i < MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE; i++) {
      out += MIRAS_JOIN_CODE_ALPHABET[import_crypto.default.randomInt(0, MIRAS_JOIN_CODE_ALPHABET.length)];
    }
    return out;
  };
  for (let i = 0; i < 400; i++) {
    const code = groupsFromBody(randomBody());
    if (!existing.has(compactJoinCode(code))) return code;
  }
  let seed = import_crypto.default.createHash("sha256").update(`${Date.now()}|${studentId}|${import_crypto.default.randomBytes(16).toString("hex")}`).digest();
  let body = "";
  for (let i = 0; body.length < MIRAS_JOIN_CODE_GROUPS * MIRAS_JOIN_CODE_GROUP_SIZE; i++) {
    if (i >= seed.length) {
      seed = import_crypto.default.createHash("sha256").update(seed).digest();
      i = 0;
    }
    body += MIRAS_JOIN_CODE_ALPHABET[seed[i] % MIRAS_JOIN_CODE_ALPHABET.length];
  }
  return groupsFromBody(body);
}
function isProductionLikeRuntime() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production" || Boolean(process.env.K_SERVICE || process.env.FIREBASE_CONFIG || process.env.GOOGLE_CLOUD_PROJECT);
}
function joinCodeSignatureRequired() {
  const raw = String(process.env.MIRAS_JOIN_CODE_SIGNATURE_REQUIRED || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return raw === "1" || raw === "true" || raw === "yes" || isProductionLikeRuntime();
}
function joinCodeSigningSecret() {
  const explicit = String(
    process.env.MIRAS_JOIN_CODE_SIGNING_SECRET || process.env.JOIN_CODE_SIGNING_SECRET || ""
  ).trim();
  if (explicit) return explicit;
  const sessionSecret = String(process.env.MIRAS_SESSION_SECRET || MIRAS_SESSION_SECRET || "").trim();
  return import_crypto.default.createHash("sha256").update(`miras-join-code-signing-v1:${sessionSecret}`).digest("hex");
}
function joinCodeSignaturePayload(code) {
  return [
    compactJoinCode(code?.code || code),
    String(code?.ownerEmail || code?.createdByEmail || "").trim().toLowerCase(),
    String(code?.sectionCode || code?.courseCode || code?.studentSection || "").trim().toLowerCase(),
    String(code?.createdAt || "").trim()
  ].join("|");
}
function signJoinCodeRecord(code) {
  const secret = joinCodeSigningSecret();
  if (!secret) return "";
  return import_crypto.default.createHmac("sha256", secret).update(joinCodeSignaturePayload(code)).digest("hex");
}
function attachJoinCodeSignature(code) {
  const signature = signJoinCodeRecord(code);
  if (!signature) return code;
  return {
    ...code,
    codeSignature: signature,
    codeSignatureVersion: "hmac-sha256-v1",
    codeSignatureCreatedAt: code.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  };
}
function verifyJoinCodeSignature(code) {
  const signature = String(code?.codeSignature || "").trim();
  const expected = signJoinCodeRecord(code);
  const required = joinCodeSignatureRequired();
  if (!signature) {
    return expected ? { ok: !required, legacy: true, canSign: true } : { ok: !required, legacy: true, skipped: true, missingSecret: true };
  }
  if (!expected) {
    return { ok: !required, legacy: true, skipped: true, missingSecret: true };
  }
  const ok = expected.length === signature.length && import_crypto.default.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  return { ok, legacy: false, required };
}
function ensureJoinCodeSignature(code) {
  const state = verifyJoinCodeSignature(code);
  if (state.ok && !state.legacy) return state;
  if (!state.legacy) return state;
  const signature = signJoinCodeRecord(code);
  if (!signature) return state;
  const patch = {
    codeSignature: signature,
    codeSignatureVersion: "hmac-sha256-v1",
    codeSignatureCreatedAt: code?.codeSignatureCreatedAt || code?.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    if (code?.code) dbInstance.updateJoinCode(code.code, patch);
    Object.assign(code, patch);
  } catch {
  }
  return { ok: true, legacy: true, migrated: true };
}
function createCodeJourneyEvent(label, actorEmail, extra = {}) {
  return appendCodeJourney({}, {
    id: `cj-${Date.now()}-${import_crypto.default.randomBytes(2).toString("hex")}`,
    label,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    actorEmail,
    ...extra
  });
}
function isValidEmailFormat(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
}
function isValidPaaetEmail(value) {
  return String(value || "").trim().toLowerCase().endsWith("@paaet.edu.kw");
}
function extractPdfTextLocal(filePath) {
  try {
    if (filePath && import_fs2.default.existsSync(filePath)) {
      const out = (0, import_child_process.execFileSync)("pdftotext", ["-layout", filePath, "-"], {
        encoding: "utf8",
        timeout: 2e4,
        maxBuffer: 20 * 1024 * 1024
      });
      const cleaned = out.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").trim();
      if (cleaned.length > 80) {
        return { text: cleaned, method: "pdftotext-local" };
      }
    }
  } catch (err) {
    console.log(
      "pdftotext local extraction unavailable or failed; trying raw PDF extraction."
    );
  }
  try {
    const raw = import_fs2.default.readFileSync(filePath);
    const ascii = raw.toString("latin1");
    const pieces = Array.from(ascii.matchAll(/\(([^()]{3,})\)/g)).map(
      (m) => m[1]
    );
    const cleaned = pieces.join(" ").replace(/\\[rn]/g, " ").replace(/[ \t]+/g, " ").trim();
    if (cleaned.length > 80) {
      return { text: cleaned, method: "raw-pdf-string-scan" };
    }
  } catch (err) {
    console.log("Raw PDF text scan failed.");
  }
  return {
    text: "",
    method: "none",
    warning: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0646\u0635 \u0642\u0627\u0628\u0644 \u0644\u0644\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u062F\u0627\u062E\u0644 \u0645\u0644\u0641 PDF. \u063A\u0627\u0644\u0628\u064B\u0627 \u0627\u0644\u0645\u0644\u0641 \u0645\u0635\u0648\u0651\u0631/\u0645\u0645\u0633\u0648\u062D \u0636\u0648\u0626\u064A\u064B\u0627\u060C \u0648\u0627\u0644\u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0645\u062D\u0644\u064A \u0627\u0644\u0645\u062C\u0627\u0646\u064A \u0644\u0627 \u064A\u0633\u062A\u062E\u062F\u0645 OCR. \u064A\u0645\u0643\u0646\u0643 \u0631\u0641\u0639 \u0646\u0633\u062E\u0629 \u0646\u0635\u064A\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0646\u0633\u062E \u0644\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u062A\u0642\u0633\u064A\u0645 \u0623\u062F\u0642."
  };
}
function normalizeTitle(line, fallback) {
  const t = (line || "").replace(/[\u0000\r\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return fallback;
  return t.length > 80 ? t.slice(0, 80) + "\u2026" : t;
}
function topConceptsFromText(text, count = 4) {
  const stop = /* @__PURE__ */ new Set([
    "\u0627\u0644\u0630\u064A",
    "\u0627\u0644\u062A\u064A",
    "\u0639\u0644\u0649",
    "\u0627\u0644\u0649",
    "\u0625\u0644\u0649",
    "\u0641\u064A",
    "\u0645\u0646",
    "\u0639\u0646",
    "\u0647\u0630\u0627",
    "\u0647\u0630\u0647",
    "\u0630\u0644\u0643",
    "\u062A\u0644\u0643",
    "\u0643\u0627\u0646",
    "\u0643\u0627\u0646\u062A",
    "\u0645\u0639",
    "\u0643\u0645\u0627",
    "\u0648\u0642\u062F",
    "\u0644\u0630\u0644\u0643",
    "\u062D\u064A\u062B",
    "\u0628\u064A\u0646",
    "\u0628\u0639\u062F",
    "\u0642\u0628\u0644",
    "\u0639\u0646\u062F",
    "\u0643\u0644",
    "\u0623\u064A",
    "\u0623\u0648",
    "\u0623\u0646",
    "\u0625\u0646",
    "\u0647\u0648",
    "\u0647\u064A",
    "\u062B\u0645",
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from"
  ]);
  const words = (text.match(/[\p{L}]{4,}/gu) || []).map((w) => w.trim()).filter((w) => !stop.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, count).map(([w]) => w);
}
function buildLocalChaptersFromText(text, meta) {
  const clean = (text || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const headingRegex = /^(الفصل|الباب|الوحدة|المحور|Chapter|Unit|Module)\s*[\w\d\u0660-\u0669\u06F0-\u06F9:：\-.، ]{0,80}/i;
  const headingIndexes = lines.map((l, i) => ({ l, i })).filter((x) => headingRegex.test(x.l)).slice(0, 8);
  let chapters = [];
  if (headingIndexes.length >= 2) {
    chapters = headingIndexes.slice(0, 6).map((h, idx) => {
      const next = headingIndexes[idx + 1]?.i ?? lines.length;
      const block = lines.slice(h.i, next).join(" ");
      const concepts = topConceptsFromText(block, 5);
      const topics = concepts.slice(0, 3).map((c, tIdx) => ({
        id: `topic-${idx + 1}-${tIdx + 1}`,
        title: `\u0645\u0648\u0636\u0648\u0639 ${tIdx + 1}: ${c}`,
        pages: `${Math.max(1, idx * 20 + tIdx * 6 + 1)}-${Math.max(6, idx * 20 + tIdx * 6 + 6)}`,
        concepts: concepts.slice(tIdx, tIdx + 3).length ? concepts.slice(tIdx, tIdx + 3) : concepts
      }));
      return {
        id: `chap-${idx + 1}`,
        title: normalizeTitle(h.l, `\u0627\u0644\u0641\u0635\u0644 ${idx + 1}`),
        subtitle: "\u062A\u0645 \u0627\u0633\u062A\u062E\u0644\u0627\u0635 \u0647\u0630\u0627 \u0627\u0644\u0641\u0635\u0644 \u0645\u062D\u0644\u064A\u064B\u0627 \u0645\u0646 \u0628\u0646\u064A\u0629 \u0627\u0644\u0645\u0635\u062F\u0631 \u0627\u0644\u0645\u0631\u0641\u0648\u0639 \u062F\u0648\u0646 \u0643\u0634\u0641 \u0627\u0633\u0645 \u0627\u0644\u0645\u0644\u0641.",
        topics: topics.length ? topics : [
          {
            id: `topic-${idx + 1}-1`,
            title: "\u0645\u0648\u0636\u0648\u0639 \u0639\u0627\u0645 \u0645\u0633\u062A\u062E\u0631\u062C",
            pages: "1-10",
            concepts: concepts.length ? concepts : ["\u0645\u0641\u0647\u0648\u0645 \u0639\u0627\u0645"]
          }
        ]
      };
    });
  } else if (clean.length > 80) {
    const chunks = [];
    const chunkSize = Math.ceil(clean.length / 4);
    for (let i = 0; i < 4; i++)
      chunks.push(clean.slice(i * chunkSize, (i + 1) * chunkSize));
    chapters = chunks.map((block, idx) => {
      const concepts = topConceptsFromText(block, 5);
      return {
        id: `chap-${idx + 1}`,
        title: `\u0627\u0644\u0641\u0635\u0644 ${idx + 1}: \u0645\u062D\u0648\u0631 \u0645\u0633\u062A\u062E\u0631\u062C \u0645\u0646 \u0627\u0644\u0645\u0635\u062F\u0631`,
        subtitle: "\u062A\u0642\u0633\u064A\u0645 \u0645\u062D\u0644\u064A \u0645\u062C\u0627\u0646\u064A \u0645\u0628\u0646\u064A \u0639\u0644\u0649 \u0646\u0635 PDF \u0627\u0644\u0642\u0627\u0628\u0644 \u0644\u0644\u0627\u0633\u062A\u062E\u0631\u0627\u062C.",
        topics: [0, 1].map((tIdx) => ({
          id: `topic-${idx + 1}-${tIdx + 1}`,
          title: `\u0645\u0648\u0636\u0648\u0639 ${tIdx + 1}: ${concepts[tIdx] || "\u0645\u0641\u0647\u0648\u0645 \u062A\u0637\u0628\u064A\u0642\u064A"}`,
          pages: `${idx * 20 + tIdx * 10 + 1}-${idx * 20 + (tIdx + 1) * 10}`,
          concepts: concepts.slice(tIdx, tIdx + 3).length ? concepts.slice(tIdx, tIdx + 3) : ["\u0645\u0641\u0647\u0648\u0645 \u0639\u0627\u0645"]
        }))
      };
    });
  }
  return {
    chapters,
    extractedChars: clean.length,
    method: meta?.extractionMethod || "local",
    warning: clean.length <= 80 ? "PDF \u0644\u0627 \u064A\u062D\u062A\u0648\u064A \u0646\u0635\u064B\u0627 \u0642\u0627\u0628\u0644\u064B\u0627 \u0644\u0644\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0643\u0641\u0627\u064A\u0629. \u0644\u0645 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0641\u0635\u0648\u0644 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629." : void 0
  };
}
app.use((0, import_cors.default)());
app.use((0, import_express_fileupload.default)({ limits: { fileSize: 25 * 1024 * 1024 } }));
app.use(import_express.default.json({ limit: "50mb" }));
app.use(import_express.default.urlencoded({ limit: "50mb", extended: true }));
app.use((req, _res, next) => {
  normalizeDigitsDeep(req.body);
  normalizeDigitsDeep(req.query);
  normalizeDigitsDeep(req.params);
  next();
});
app.use(async (req, res, next) => {
  try {
    if (req.url.startsWith("/api/") && !req.path.startsWith("/api/config")) {
      await dbInstance.initialSyncPromise;
    }
  } catch (e) {
    console.error("\u26A0\uFE0F Initial cloud database sync failed before API request:", e);
  }
  if (req.method !== "GET" && req.url.startsWith("/api/")) {
    const originalJson = res.json.bind(res);
    let cloudGuardedJson = false;
    res.json = ((body) => {
      const statusCode = Number(res.statusCode || 200);
      if (cloudGuardedJson || res.headersSent || statusCode >= 400) {
        return originalJson(body);
      }
      cloudGuardedJson = true;
      Promise.resolve(dbInstance.waitForSync()).then(() => {
        try {
          if (!res.headersSent) originalJson(body);
        } catch (e) {
          console.error("\u26A0\uFE0F Failed to send guarded JSON response:", e);
        }
      }).catch((e) => {
        console.error("\u26A0\uFE0F Cloud durability guard could not confirm sync before JSON response:", e);
        try {
          if (!res.headersSent) {
            res.status(503);
            originalJson(cloudDurabilityErrorBody());
          }
        } catch (sendError) {
          console.error("\u26A0\uFE0F Failed to send cloud durability error response:", sendError);
        }
      });
      return res;
    });
    res.on("finish", () => {
      try {
        dbInstance.flushCloudSoon();
      } catch (e) {
        console.error("\u26A0\uFE0F Background DB sync error after response:", e);
      }
    });
  }
  next();
});
function cloudDurabilityErrorBody() {
  const status = dbInstance.getDatabaseGuardStatus();
  return {
    error: status?.message || "\u062A\u0639\u0630\u0631 \u062A\u0623\u0643\u064A\u062F \u062D\u0641\u0638 \u0627\u0644\u062A\u063A\u064A\u064A\u0631 \u0641\u064A \u0627\u0644\u0633\u062D\u0627\u0628\u0629. \u0644\u0645 \u0646\u0624\u0643\u062F \u0646\u062C\u0627\u062D \u0627\u0644\u0639\u0645\u0644\u064A\u0629\u061B \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0628\u0639\u062F \u0642\u0644\u064A\u0644.",
    code: status?.code || "CLOUD_SYNC_UNAVAILABLE"
  };
}
async function ensureDurableSync(res) {
  try {
    await dbInstance.waitForSync();
    return true;
  } catch (error) {
    console.error("\u26A0\uFE0F Cloud durability sync failed inside API route:", error);
    if (!res.headersSent) {
      res.status(503).json(cloudDurabilityErrorBody());
    }
    return false;
  }
}
function pathMatchesStudentOwnedApi(pathname) {
  return /^\/api\/students\/[^/]+$/.test(pathname) || /^\/api\/students\/[^/]+\/(session-status|snapshot|log-violation|activate|reset-devices|activate-course)$/.test(pathname) || pathname === "/api/learning-fingerprint" || pathname.startsWith("/api/quizzes") || pathname.startsWith("/api/exercises") || pathname.startsWith("/api/projects/generate") || pathname.startsWith("/api/projects/submit") || pathname.startsWith("/api/submissions/upload") || pathname.startsWith("/api/submission-attachments/") || pathname === "/api/student/submissions" || // الحالة الحية للطالب هي المحمّل الرئيسي لمساحة عمل الطالب (مقررات/اختبارات/
  // مشاريع). كانت مفتوحة بلا حماية، فيستطيع متصفح ثانٍ (Safari/PWA) تحميل
  // البرنامج كاملاً رغم قفل الجهاز على بقية المسارات. تخضع الآن لنفس قفل
  // الجهاز: الجهاز المربوط فقط يحمّل البرنامج، وأي متصفح/جهاز آخر يُمنع.
  pathname === "/api/live/student-state" || pathname === "/api/payment/simulate";
}
function endpointStudentId(req) {
  const match = req.path.match(/^\/api\/students\/([^/]+)/);
  return normalizeStudentId(
    (match ? decodeURIComponent(match[1]) : "") || req.body?.studentId || req.query?.studentId || req.body?.idNumber || ""
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
        code: "TEACHER_SESSION_REQUIRED"
      });
    }
    req.mirasTeacherEmail = teacherEmail;
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
    const sessionStudentId = verifiedSession?.role === "student" ? normalizeStudentId(verifiedSession.userId) : "";
    const teacherEmail = teacherEmailFromRequest(req);
    if (teacherEmail) return next();
    if (pathname === "/api/live/student-state" && !sessionStudentId) {
      req.mirasPublicStudentStatePreview = true;
      return next();
    }
    if (!sessionStudentId || requestedStudentId && requestedStudentId !== sessionStudentId) {
      console.warn(`[AUTH_DEBUG] STUDENT_SESSION_REQUIRED for ${req.method} ${pathname}. sessionStudentId: ${sessionStudentId || "None"}, requestedStudentId: ${requestedStudentId || "None"}`);
      return res.status(401).json({
        error: "STUDENT_SESSION_REQUIRED",
        code: "STUDENT_SESSION_REQUIRED"
      });
    }
    const currentDeviceToken = getRequestDeviceToken(req);
    if (verifiedSession?.deviceTokenHash && (!currentDeviceToken || hashMirasValue(currentDeviceToken) !== verifiedSession.deviceTokenHash)) {
      return res.status(403).json({
        error: "\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0645\u062A\u0635\u0641\u062D \u0622\u062E\u0631. \u0627\u0641\u062A\u062D \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0623\u0635\u0644\u064A \u0623\u0648 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632.",
        code: "STUDENT_DEVICE_LOCKED"
      });
    }
    const student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === sessionStudentId);
    if (!student) {
      return res.status(401).json({
        error: "STUDENT_SESSION_REQUIRED",
        code: "STUDENT_SESSION_REQUIRED"
      });
    }
    const deviceValidation = validateSessionFingerprint(req, student);
    if (!deviceValidation.isValid) {
      return res.status(deviceValidation.statusCode || 403).json({
        error: deviceValidation.error || "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0642\u0641\u0644 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632 \u0623\u0648 \u0645\u062A\u0635\u0641\u062D \u0622\u062E\u0631.",
        code: "STUDENT_DEVICE_LOCKED"
      });
    }
    return next();
  }
  next();
});
app.post("/api/seb/launch", (req, res) => {
  const launched = createSebLaunchFromActivatedSession(req);
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
    fileName: buildSebFileName(launched.pass)
  });
});
app.post("/api/seb/pass", (req, res) => {
  const launched = createSebLaunchFromActivatedSession(req);
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
    fileName: buildSebFileName(launched.pass)
  });
});
app.post("/seb/open", (req, res) => {
  const launched = createSebLaunchFromActivatedSession(req);
  if (launched.error) {
    res.status(launched.status || 400);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>\u062A\u0639\u0630\u0631 \u062A\u0634\u063A\u064A\u0644 SEB</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}.box{width:min(560px,calc(100vw - 32px));background:white;border:1px solid #e2e8f0;border-radius:24px;padding:28px;box-shadow:0 24px 70px rgba(15,23,42,.12)}h1{font-size:24px;margin:0 0 12px}p{line-height:1.8;color:#475569}.back{display:inline-flex;margin-top:16px;background:#1e1b4b;color:white;text-decoration:none;border-radius:16px;padding:12px 18px;font-weight:800}</style></head><body><main class="box"><h1>\u062A\u0639\u0630\u0631 \u062A\u0634\u063A\u064A\u0644 Safe Exam Browser</h1><p>${xmlEscape(launched.error)}</p><a class="back" href="/">\u0627\u0644\u0631\u062C\u0648\u0639 \u0625\u0644\u0649 \u0645\u0631\u0627\u0633</a></main></body></html>`
    );
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  return res.send(renderSebLaunchPage(req, launched.pass));
});
app.get("/seb/launch", (req, res) => {
  const token = String(
    req.query.token || req.query.seb_token || req.query.seb_pass || ""
  ).trim();
  const pass = findSebPass(token);
  if (!token) {
    return sendSebStartError(
      req,
      res,
      403,
      null,
      "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0646 \u0645\u0644\u0641 SEB \u0639\u0627\u0645. \u0627\u0641\u062A\u062D \u062D\u0633\u0627\u0628\u0643 \u0641\u064A \u0645\u0650\u0631\u0627\u0633 \u0645\u0646 \u062C\u0647\u0627\u0632\u0643 \u0627\u0644\u0645\u0641\u0639\u0651\u0644 \u062B\u0645 \u0627\u0636\u063A\u0637 \u0632\u0631 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0639\u0628\u0631 SEB \u0644\u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u062C\u0644\u0633\u0629 \u062E\u0627\u0635\u0629 \u0628\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631."
    );
  }
  if (!pass || pass.status === "closed")
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "\u0631\u0627\u0628\u0637 \u062A\u0634\u063A\u064A\u0644 SEB \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0645\u0646\u062A\u0647\u064A."
    );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  return res.send(
    hasSebRuntimeHint(req) ? renderSebStartPage(req, pass) : renderSebLaunchPage(req, pass)
  );
});
function renderSebStartErrorPage(req, pass, message) {
  const quitUrl = pass ? buildSebQuitUrl(req, pass.token) : "";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>\u062A\u0639\u0630\u0631 \u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:22px;box-sizing:border-box}.box{max-width:560px;text-align:center;padding:32px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(255,255,255,.06)}h1{font-size:22px;margin:0 0 12px}p{line-height:1.8;color:#cbd5e1;font-size:14px}.pass{display:inline-block;margin-top:12px;border-radius:14px;background:rgba(255,255,255,.1);padding:10px 16px;font-size:22px;font-weight:900;letter-spacing:1px}a.btn{display:inline-flex;margin-top:18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:16px;padding:12px 22px;font-weight:900;font-size:14px}</style>
</head>
<body>
<div class="box"><h1>\u062A\u0639\u0630\u0631 \u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646</h1><p>${xmlEscape(message)}</p><p>\u0625\u0630\u0627 \u0628\u0642\u064A\u062A \u062F\u0627\u062E\u0644 SEB \u0627\u0633\u062A\u062E\u062F\u0645 \u0643\u0644\u0645\u0629 \u0627\u0644\u062E\u0631\u0648\u062C \u0644\u062F\u0649 \u0627\u0644\u0645\u0631\u0627\u0642\u0628:</p><span class="pass">CBE</span>${quitUrl ? `<br><a class="btn" href="${xmlEscape(quitUrl)}">\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u062C\u0644\u0633\u0629 \u0648\u0627\u0644\u062E\u0631\u0648\u062C \u0645\u0646 SEB</a>` : ""}</div>
</body>
</html>`;
}
function sendSebStartError(req, res, status, pass, message) {
  void status;
  res.status(200);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  return res.send(renderSebStartErrorPage(req, pass, message));
}
app.get("/seb/start", (req, res) => {
  const token = String(req.query.token || "").trim();
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed") {
    rejectSebPass(req, pass, "\u0631\u0627\u0628\u0637 \u062C\u0644\u0633\u0629 SEB \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0645\u0646\u062A\u0647\u064A \u0639\u0646\u062F /seb/start.");
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "\u0631\u0627\u0628\u0637 \u062C\u0644\u0633\u0629 SEB \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0645\u0646\u062A\u0647\u064A. \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0641\u062A\u062D \u0645\u062D\u0627\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629\u060C \u062B\u0645 \u0627\u0636\u063A\u0637 \u0632\u0631 \u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0623\u0635\u0644\u064A \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0641\u0642\u0637."
    );
  }
  if (pass.status !== "launch" && pass.status !== "active") {
    rejectSebPass(
      req,
      pass,
      `\u0645\u062D\u0627\u0648\u0644\u0629 \u0625\u0639\u0627\u062F\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 startURL \u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u062D\u0627\u0644\u062A\u0647\u0627 ${pass.status}.`
    );
    return sendSebStartError(
      req,
      res,
      409,
      pass,
      "\u062A\u0645 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0631\u0627\u0628\u0637 \u062A\u0634\u063A\u064A\u0644 SEB \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0633\u0627\u0628\u0642\u0627\u064B. \u0627\u0637\u0644\u0628 \u0645\u062D\u0627\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0625\u0630\u0627 \u0627\u062D\u062A\u062C\u062A \u0625\u0639\u0627\u062F\u0629 \u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631."
    );
  }
  const student = dbInstance.getStudents().find((s) => String(s.id) === String(pass.studentId));
  const exam = dbInstance.getTeacherExams().find((item) => String(item.id) === String(pass.examId));
  if (!student || !exam || String(exam.courseCode || "").toLowerCase() !== String(pass.courseCode || "").toLowerCase() || !studentHasEnrollmentInCourse(student, pass.courseCode)) {
    closeSebAttempt(pass, "invalid-binding-at-start");
    rejectSebPass(
      req,
      pass,
      "\u0641\u0634\u0644 \u0631\u0628\u0637 \u062C\u0644\u0633\u0629 SEB \u0628\u0627\u0644\u0637\u0627\u0644\u0628/\u0627\u0644\u0645\u0642\u0631\u0631/\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0639\u0646\u062F start."
    );
    return sendSebStartError(
      req,
      res,
      403,
      pass,
      "\u062C\u0644\u0633\u0629 SEB \u0644\u0627 \u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u0637\u0627\u0644\u0628 \u0623\u0648 \u0627\u0644\u0645\u0642\u0631\u0631 \u0623\u0648 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631."
    );
  }
  const priorStartedAttempt = dbInstance.getQuizSubmissions().find(
    (q) => String(q.studentId) === String(student.id) && String(q.chapterId) === String(pass.examId) && String(q.status || "") === "started"
  );
  if (priorStartedAttempt) {
    finalizeExamAttemptAsZero(req, {
      student,
      exam,
      pass,
      submission: priorStartedAttempt,
      reason: "\u062D\u0627\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0631\u062C\u0648\u0639 \u0625\u0644\u0649 \u0627\u062E\u062A\u0628\u0627\u0631 \u0633\u0628\u0642 \u0623\u0646 \u0638\u0647\u0631\u062A \u0644\u0647 \u0623\u0633\u0626\u0644\u062A\u0647 \u0648\u0644\u0645 \u064A\u0633\u0644\u0651\u0645\u0647\u061B \u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627."
    });
    closeSebAttempt(pass, "attempt-already-started-closed");
    return sendSebStartError(
      req,
      res,
      409,
      pass,
      "\u062A\u0645 \u0641\u062A\u062D \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0633\u0627\u0628\u0642\u0627\u064B \u0648\u0638\u0647\u0631\u062A \u0623\u0633\u0626\u0644\u062A\u0647\u060C \u0644\u0630\u0644\u0643 \u0623\u063A\u0644\u0642\u062A \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0648\u0631\u064F\u0635\u062F\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644\u062A \u0644\u0647\u0627. \u064A\u0633\u062A\u0637\u064A\u0639 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0641\u0642\u0637 \u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0625\u0630\u0627 \u0642\u0631\u0631 \u0627\u0644\u0633\u0645\u0627\u062D \u0628\u0645\u062D\u0627\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629."
    );
  }
  logSebEvent({
    studentId: student.id,
    studentName: student.name,
    action: "\u0639\u0631\u0636 \u0634\u0627\u0634\u0629 \u0627\u0644\u062A\u062D\u0630\u064A\u0631 \u0642\u0628\u0644 \u0628\u062F\u0621 SEB",
    details: `\u062A\u0645 \u0641\u062A\u062D startURL \u0644\u0644\u0627\u062E\u062A\u0628\u0627\u0631 ${pass.examId} \u0641\u064A \u0645\u0642\u0631\u0631 ${pass.courseCode} \u0648\u0639\u0631\u0636 \u0634\u0627\u0634\u0629 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0644\u0644\u0637\u0627\u0644\u0628.`,
    req
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  return res.send(renderSebStartPage(req, pass));
});
app.post("/api/seb/validate", (req, res) => {
  const token = getSebPassFromRequest(req);
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed") {
    rejectSebPass(req, pass, "\u0641\u0634\u0644 validate: token \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0623\u0648 \u0645\u063A\u0644\u0642.");
    return res.status(403).json({ error: "\u062C\u0644\u0633\u0629 SEB \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629 \u0623\u0648 \u0645\u0646\u062A\u0647\u064A\u0629." });
  }
  if (pass.status === "launch") {
    if (!hasSebRuntimeHint(req) && String(
      req.body?.seb || req.query?.seb || req.body?.miras_seb || req.query?.miras_seb || ""
    ) !== "1") {
      rejectSebPass(req, pass, "\u0641\u0634\u0644 validate: token \u0644\u0645 \u064A\u0635\u0644 \u0645\u0646 \u0633\u064A\u0627\u0642 SEB.");
      return res.status(409).json({ error: "\u0627\u0641\u062A\u062D \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0646 \u062A\u0637\u0628\u064A\u0642 Safe Exam Browser \u0623\u0648\u0644\u0627\u064B." });
    }
    consumeSebPass(pass);
  }
  const student = dbInstance.getStudents().find((s) => String(s.id) === String(pass.studentId));
  const exam = dbInstance.getTeacherExams().find((item) => String(item.id) === String(pass.examId));
  if (!student || !exam) {
    rejectSebPass(req, pass, "\u0641\u0634\u0644 validate: \u0627\u0644\u0637\u0627\u0644\u0628 \u0623\u0648 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.");
    return res.status(404).json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0637\u0627\u0644\u0628 \u0623\u0648 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0645\u0631\u062A\u0628\u0637 \u0628\u062C\u0644\u0633\u0629 SEB." });
  }
  if (String(exam.courseCode || "").toLowerCase() !== String(pass.courseCode || "").toLowerCase()) {
    rejectSebPass(req, pass, "\u0641\u0634\u0644 validate: \u0627\u0644\u0645\u0642\u0631\u0631 \u0644\u0627 \u064A\u0637\u0627\u0628\u0642 \u0645\u0642\u0631\u0631 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.");
    return res.status(403).json({ error: "\u062C\u0644\u0633\u0629 SEB \u0644\u0627 \u062A\u0637\u0627\u0628\u0642 \u0645\u0642\u0631\u0631 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631." });
  }
  if (!studentHasEnrollmentInCourse(student, pass.courseCode)) {
    rejectSebPass(req, pass, "\u0641\u0634\u0644 validate: \u0627\u0644\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u0641\u0639\u0644 \u0628\u0627\u0644\u0643\u0648\u062F \u0627\u0644\u0623\u0635\u0644\u064A.");
    return res.status(403).json({ error: "\u0627\u0644\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u0641\u0639\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u0627\u0644\u0643\u0648\u062F \u0627\u0644\u0623\u0635\u0644\u064A." });
  }
  const existingAttempt = dbInstance.getQuizSubmissions().find(
    (q) => String(q.studentId) === String(student.id) && String(q.chapterId) === String(pass.examId)
  );
  if (existingAttempt && String(existingAttempt.status || "") === "started") {
    const sameSebAttempt = pass.status === "active" && String(existingAttempt.sebAttemptId || "") && String(existingAttempt.sebAttemptId) === String(pass.attemptId);
    if (sameSebAttempt) {
      logSebEvent({
        studentId: student.id,
        studentName: student.name,
        action: "\u0627\u0633\u062A\u0645\u0631\u0627\u0631 \u0646\u0641\u0642 SEB",
        details: `\u062A\u0645 \u0627\u0633\u062A\u0643\u0645\u0627\u0644 \u0646\u0641\u0633 \u0645\u062D\u0627\u0648\u0644\u0629 SEB \u0627\u0644\u0646\u0634\u0637\u0629 \u0644\u0644\u0627\u062E\u062A\u0628\u0627\u0631 ${pass.examId} \u062F\u0648\u0646 \u0641\u062A\u062D \u0645\u062D\u0627\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629.`,
        req
      });
      return res.json({
        success: true,
        student: {
          ...student,
          sectionCode: pass.courseCode,
          activeSebExamId: pass.examId,
          enrollments: getStudentEnrollmentDetails(student)
        },
        exam: {
          id: exam.id,
          title: exam.title,
          courseCode: exam.courseCode,
          ownerEmail: exam.ownerEmail || exam.teacherEmail || sectionOwnerEmail(exam.courseCode),
          timerMinutes: Number(
            exam.antiCheat?.timerMinutes ?? exam.timerMinutes
          ) || 30
        },
        sebSession: describeSebPass(pass),
        quitUrl: buildSebQuitUrl(req, pass.token)
      });
    }
    const zeroSubmission = finalizeExamAttemptAsZero(req, {
      student,
      exam,
      pass,
      submission: existingAttempt,
      reason: "\u0627\u0646\u0642\u0637\u0639\u062A \u0623\u0648 \u0623\u064F\u0639\u064A\u062F\u062A \u062C\u0644\u0633\u0629 SEB \u0628\u0639\u062F \u0638\u0647\u0648\u0631 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0648\u0642\u0628\u0644 \u0627\u0644\u062A\u0633\u0644\u064A\u0645\u061B \u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627 \u0627\u0644\u0637\u0627\u0644\u0628."
    });
    closeSebAttempt(pass, "started-attempt-reopened-closed");
    return res.status(409).json({
      error: "\u062A\u0645 \u0641\u062A\u062D \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0633\u0627\u0628\u0642\u0627\u064B \u0648\u0638\u0647\u0631\u062A \u0623\u0633\u0626\u0644\u062A\u0647\u060C \u0644\u0630\u0644\u0643 \u0623\u063A\u0644\u0642\u062A \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0648\u0631\u064F\u0635\u062F\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644\u062A \u0644\u0647\u0627. \u064A\u0633\u062A\u0637\u064A\u0639 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0641\u0642\u0637 \u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.",
      submission: zeroSubmission
    });
  }
  if (existingAttempt && String(existingAttempt.status || "submitted") !== "started" && String(existingAttempt.status || "submitted") !== "returned") {
    closeSebAttempt(pass, "attempt-already-closed");
    return res.status(409).json({
      error: "\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0642\u0641\u0644\u0629 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u0641\u062A\u062D\u0647\u0627 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0625\u0644\u0627 \u0625\u0630\u0627 \u0623\u0639\u0627\u062F\u0647\u0627 \u0627\u0644\u0623\u0633\u062A\u0627\u0630.",
      submission: existingAttempt
    });
  }
  logSebEvent({
    studentId: student.id,
    studentName: student.name,
    action: "\u062A\u0641\u0639\u064A\u0644 \u0646\u0641\u0642 SEB",
    details: `\u062A\u0645 \u062A\u062D\u0648\u064A\u0644 \u0631\u0627\u0628\u0637 SEB \u0625\u0644\u0649 \u0645\u062D\u0627\u0648\u0644\u0629 \u0646\u0634\u0637\u0629 \u0644\u0644\u0627\u062E\u062A\u0628\u0627\u0631 ${pass.examId} \u0641\u064A \u0645\u0642\u0631\u0631 ${pass.courseCode}.`,
    req
  });
  return res.json({
    success: true,
    student: {
      ...student,
      sectionCode: pass.courseCode,
      activeSebExamId: pass.examId,
      enrollments: getStudentEnrollmentDetails(student)
    },
    exam: {
      id: exam.id,
      title: exam.title,
      courseCode: exam.courseCode,
      ownerEmail: exam.ownerEmail || exam.teacherEmail || sectionOwnerEmail(exam.courseCode),
      timerMinutes: Number(
        exam.antiCheat?.timerMinutes ?? exam.timerMinutes
      ) || 30
    },
    sebSession: describeSebPass(pass),
    quitUrl: buildSebQuitUrl(req, pass.token)
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
    req.query.token || req.query.seb_token || req.query.seb_pass || ""
  ).trim();
  const map = getRuntimeSebPasses();
  const pass = findSebPass(token) || map.get(token) || null;
  if (pass) closeSebAttempt(pass, "explicit-quit-url");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>\u0627\u0644\u062E\u0631\u0648\u062C \u0645\u0646 SEB</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#020617;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:560px;text-align:center;padding:32px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(255,255,255,.06)}.pass{display:inline-block;margin-top:12px;border-radius:14px;background:rgba(255,255,255,.1);padding:10px 16px;font-size:22px;font-weight:900;letter-spacing:1px}a{color:#a5b4fc;font-weight:800}</style></head><body><div class="box"><h1>\u062A\u0645 \u0625\u063A\u0644\u0627\u0642 \u062C\u0644\u0633\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0622\u0645\u0646</h1><p>\u0625\u0630\u0627 \u0644\u0645 \u064A\u064F\u063A\u0644\u0642 Safe Exam Browser \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B\u060C \u0627\u0633\u062A\u062E\u062F\u0645 \u0632\u0631 \u0627\u0644\u062E\u0631\u0648\u062C \u0627\u0644\u0622\u0645\u0646 \u062F\u0627\u062E\u0644 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C \u0623\u0648 \u0623\u0628\u0644\u063A \u0627\u0644\u0645\u0631\u0627\u0642\u0628.</p><p>\u0643\u0644\u0645\u0629 \u0627\u0644\u062E\u0631\u0648\u062C:</p><span class="pass">CBE</span></div></body></html>`
  );
});
function sendSebConfig(req, res) {
  const token = getSebConfigTokenFromRequest(req);
  const pass = findSebPass(token);
  if (!pass || pass.status === "closed")
    return res.status(403).send(
      "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0646\u0634\u0627\u0621 \u0645\u0644\u0641 SEB \u0625\u0644\u0627 \u0645\u0646 \u062C\u0644\u0633\u0629 \u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0624\u0642\u062A\u0629 \u0635\u0627\u0644\u062D\u0629 \u062A\u0645 \u0625\u0637\u0644\u0627\u0642\u0647\u0627 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0623\u0635\u0644\u064A."
    );
  if (hasSebRuntimeHint(req) && pass.status !== "launch") {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    return res.redirect(302, buildSebStartUrl(req, pass.token));
  }
  const startUrl = buildSebStartUrl(req, pass.token);
  const quitUrl = buildSebQuitUrl(req, pass.token);
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http"
  ).split(",")[0];
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`
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
    "no-store, no-cache, must-revalidate, proxy-revalidate"
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
  const hasFirebaseClientConfig = !!(config.apiKey && config.projectId && config.messagingSenderId && config.appId);
  return res.json({
    firebaseConfig: {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
      measurementId: config.measurementId
    },
    vapidKey: config.vapidKey,
    isMessagingConfigured: hasFirebaseClientConfig,
    canSendFromServer: hasFirebaseClientConfig && hasFcmSenderCandidate(),
    firestoreQuotaExceeded,
    firestoreQuotaErrorDetail
  });
});
function requireNotificationIdentity(req, res, userId, role) {
  const session = verifyMirasSessionToken(req);
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!session) {
    const teacherRole = normalizedRole === "teacher" || normalizedRole === "admin";
    res.status(401).json({
      error: teacherRole ? "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629." : "\u062C\u0644\u0633\u0629 \u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.",
      code: teacherRole ? "TEACHER_SESSION_REQUIRED" : "STUDENT_SESSION_REQUIRED"
    });
    return null;
  }
  if (normalizedRole === "student") {
    if (session.role !== "student" || normalizeStudentId(session.userId) !== normalizeStudentId(userId)) {
      res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628." });
      return null;
    }
    return session;
  }
  if (session.role !== "teacher" && session.role !== "admin") {
    res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u0623\u0633\u062A\u0627\u0630." });
    return null;
  }
  const sessionEmail = String(session.email || session.userId || "").trim().toLowerCase();
  if (userId && sessionEmail !== String(userId).trim().toLowerCase()) {
    res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628." });
    return null;
  }
  return session;
}
app.post("/api/notifications/register-token", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const userId = String(req.body?.userId || "").trim();
  const role = String(req.body?.role || "student");
  if (!token || !userId || !["student", "teacher", "admin"].includes(role)) {
    return res.status(400).json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629." });
  }
  if (!requireNotificationIdentity(req, res, userId, role)) return;
  const student = role === "student" ? dbInstance.getStudents().find((s) => String(s.id) === userId) : void 0;
  const teacher = role !== "student" ? dbInstance.getTeachers().find(
    (t) => String(t.email || t.id).toLowerCase() === userId.toLowerCase()
  ) : void 0;
  if (role === "student" && !student || role !== "student" && !teacher) {
    return res.status(404).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0631\u0628\u0637 \u0627\u0644\u062A\u0648\u0643\u0646 \u0628\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641." });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const saved = {
    token,
    userId,
    userName: student?.name || teacher?.name,
    role,
    sectionCode: student?.sectionCode || String(req.body?.sectionCode || ""),
    teacherEmail: role === "student" ? sectionOwnerEmail(student?.sectionCode) : (teacher?.email || userId).toLowerCase(),
    deviceToken: getRequestDeviceToken(req),
    permission: req.body?.permission === "denied" ? "denied" : req.body?.permission === "default" ? "default" : "granted",
    platform: req.body?.platform === "pwa" ? "pwa" : "web",
    userAgent: String(req.headers["user-agent"] || ""),
    createdAt: now,
    updatedAt: now
  };
  dbInstance.upsertNotificationToken(saved);
  return res.json({
    success: true,
    tokenLinkedTo: {
      userId: saved.userId,
      role: saved.role,
      sectionCode: saved.sectionCode
    }
  });
});
app.post("/api/notifications/unregister-token", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const userId = String(req.body?.userId || "").trim();
  const session = verifyMirasSessionToken(req);
  if (!session) {
    return res.status(401).json({
      error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.",
      code: "STUDENT_SESSION_REQUIRED"
    });
  }
  const sessionUserId = session.role === "student" ? normalizeStudentId(session.userId) : String(session.email || session.userId || "").trim().toLowerCase();
  const requestedUserId = session.role === "student" ? normalizeStudentId(userId) : String(userId || "").trim().toLowerCase();
  if (!requestedUserId || requestedUserId !== sessionUserId) {
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0641\u0635\u0644 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628." });
  }
  if (token && !token.startsWith("inapp:"))
    dbInstance.disableNotificationToken(token, userId || void 0);
  return res.json({ success: true });
});
function isCourseWideStudentNotification(item) {
  const type = String(item?.type || item?.data?.type || "").toLowerCase();
  const text = `${type} ${item?.title || ""} ${item?.body || ""}`;
  if ([
    "course",
    "course_notice",
    "course_announcement",
    "exam_reminder",
    "course_opened",
    "course_closed",
    "course_updated",
    "activity_published",
    "project_published"
  ].includes(type))
    return true;
  if (/تنبيه اختبار|اختبار متاح|موعد|رزنامة|تقويم|إعلان|عام/i.test(text))
    return true;
  return false;
}
function isStudentPrivateNotificationShape(item) {
  const type = String(item?.type || item?.data?.type || "").toLowerCase();
  const text = `${type} ${item?.title || ""} ${item?.body || ""}`;
  if (item?.data?.studentId || item?.studentId) return true;
  return [
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
    "student_logged_in"
  ].includes(type) || /درجة|مرصودة|رصد|تسليم|محاولة غش|غش|خروج قبل التسليم|إعادة محاولة|استرجاع كلمة|فعّل مقرر|تسجيل طالب/i.test(text);
}
app.get("/api/notifications/inbox", (req, res) => {
  const userId = String(req.query.userId || "").trim();
  const role = String(req.query.role || "student").trim();
  const sectionCode = String(req.query.sectionCode || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "\u0647\u0648\u064A\u0629 \u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0645\u0637\u0644\u0648\u0628\u0629." });
  }
  if (!requireNotificationIdentity(req, res, userId, role)) return;
  const since = req.query.since ? new Date(String(req.query.since)).getTime() : 0;
  const studentForNotifications = role === "student" ? dbInstance.getStudents().find((st) => String(st.id) === userId) : void 0;
  const notificationCourseCodes = role === "student" && studentForNotifications ? getStudentDiscoveredCourseCodes(studentForNotifications) : [];
  const courseNotificationIsFreshForStudent = (item, courseValue, createdMs) => {
    if (role !== "student" || !studentForNotifications || !courseValue) return true;
    const activationMs = latestStudentCourseActivationTime(
      studentForNotifications,
      courseValue,
      sectionOwnerEmail(courseValue)
    ) || (Date.parse(String(studentForNotifications.lastCourseActivationAt || "")) || 0) || (Date.parse(String(studentForNotifications.signupDate || studentForNotifications.createdAt || "")) || 0);
    if (!activationMs || !createdMs) return true;
    return createdMs + 30 * 1e3 >= activationMs;
  };
  const items = dbInstance.getInAppNotifications().filter((item) => {
    const t = new Date(item.createdAt || item.updatedAt || item.data?.createdAt || item.data?.sentAt || 0).getTime();
    if (since && t <= since) return false;
    const itemRole = String(item.role || item.data?.role || item.data?.targetRole || "").trim().toLowerCase();
    const direct = item.userId && userId && String(item.userId).toLowerCase() === userId.toLowerCase() && (!itemRole || itemRole === role);
    if (role === "student" && ["teacher", "admin", "superadmin", "super_admin"].includes(itemRole))
      return false;
    if (role === "admin" || role === "superadmin" || role === "super_admin") {
      const itemUser = String(item.userId || item.data?.userId || "").toLowerCase();
      const teacherEmail = String(item.teacherEmail || item.data?.teacherEmail || "").toLowerCase();
      const isAdminDirected = itemUser && itemUser === userId.toLowerCase() || teacherEmail && teacherEmail === userId.toLowerCase() || ["admin", "superadmin", "super_admin"].includes(itemRole);
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
        "teacher_student_change"
      ].includes(String(item.type || item.data?.type || "").toLowerCase());
      return isAdminDirected && !isRoutineTeacherAction;
    }
    const itemStudentId = String(
      item.data?.studentId || item.studentId || ""
    ).trim();
    const itemUserId = String(item.data?.userId || item.userId || "").trim();
    if (role === "student") {
      const privateTarget = itemStudentId || (itemUserId && itemRole === "student" ? itemUserId : "");
      if (privateTarget && String(privateTarget).toLowerCase() !== userId.toLowerCase()) return false;
      if (!privateTarget && isStudentPrivateNotificationShape(item)) return false;
    }
    const itemCourse = String(
      item.sectionCode || item.courseCode || item.data?.courseCode || item.data?.sectionCode || ""
    ).trim();
    const course = role === "student" && itemCourse && isCourseWideStudentNotification(item) && (sectionCodeEquivalent(sectionCode, itemCourse) || notificationCourseCodes.some(
      (code) => sectionCodeEquivalent(code, itemCourse)
    ));
    if (course && !courseNotificationIsFreshForStudent(item, itemCourse, t))
      return false;
    return direct || course;
  }).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  ).slice(0, 40);
  return res.json({
    success: true,
    notifications: items.map(sanitizeNotificationForResponse)
  });
});
app.post("/api/notifications/course", (req, res) => {
  const teacherEmail = verifiedTeacherEmailFromSession(req);
  if (!teacherEmail) {
    return res.status(401).json({
      error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.",
      code: "TEACHER_SESSION_REQUIRED"
    });
  }
  const sectionCode = String(
    req.body?.sectionCode || req.body?.courseCode || ""
  ).trim();
  const title = String(req.body?.title || "\u062A\u0646\u0628\u064A\u0647 \u0645\u0642\u0631\u0631").trim();
  const body = String(req.body?.body || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F \u0641\u064A \u0627\u0644\u0645\u0642\u0631\u0631.").trim();
  const type = String(req.body?.type || "course").trim();
  if (!sectionCode)
    return res.status(400).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0645\u0642\u0631\u0631." });
  const safeTitle = sanitizePublicMessageText(title) || "\u062A\u0646\u0628\u064A\u0647 \u0645\u0642\u0631\u0631";
  const safeBody = sanitizePublicMessageText(body) || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F \u0641\u064A \u0627\u0644\u0645\u0642\u0631\u0631.";
  const saved = rememberCourseNotification(sectionCode, safeTitle, safeBody, type, {
    type,
    courseCode: sectionCode,
    link: "/"
  });
  const sent = notifyUsers(
    (token) => token.role === "student" && studentTokenHasCourse(token, sectionCode),
    safeTitle,
    safeBody,
    { type, courseCode: sectionCode, link: "/" }
  );
  return res.json({ success: true, notification: saved, sent });
});
var CODE_WATERMARK_SECRET = process.env.MIRAS_WATERMARK_SECRET || "miras-watermark-v1";
function codeWatermark(studentId, code) {
  return import_crypto.default.createHash("sha256").update(
    `${CODE_WATERMARK_SECRET}:${normalizeStudentId(studentId)}:${normalizeJoinCode(code)}`
  ).digest("hex").slice(0, 12).toUpperCase();
}
function buildCodeHealthFunnel(scopedCodes) {
  const students = dbInstance.getStudents();
  const quiz = dbInstance.getQuizSubmissions();
  const teacherSubs = dbInstance.getTeacherSubmissions();
  const issued = scopedCodes.length;
  const usedCodes = scopedCodes.filter(
    (c) => String(c.status || "").toLowerCase() === "used"
  );
  let firstLogin = 0;
  let firstExam = 0;
  usedCodes.forEach((c) => {
    const sid = normalizeStudentId(c.studentId || c.usedByStudentId);
    if (!sid) return;
    const st = students.find((s) => normalizeStudentId(s.id) === sid);
    if (st && (st.lastLoginDate || Array.isArray(st.devices) && st.devices.length > 0))
      firstLogin += 1;
    const tookExam = quiz.some((s) => normalizeStudentId(s.studentId) === sid) || teacherSubs.some(
      (s) => normalizeStudentId(s.studentId) === sid && String(s.kind || "") === "exam"
    );
    if (tookExam) firstExam += 1;
  });
  const activated = usedCodes.length;
  return {
    issued,
    activated,
    firstLogin,
    firstExam,
    activationRate: issued ? Math.round(activated / issued * 100) : 0,
    loginRate: activated ? Math.round(firstLogin / activated * 100) : 0,
    examRate: activated ? Math.round(firstExam / activated * 100) : 0
  };
}
function buildIpClusterAlerts(scopedCodes, scopedAttempts) {
  const byIp = /* @__PURE__ */ new Map();
  const add = (ip, studentId, when, code, batchId) => {
    const key = String(ip || "").trim();
    if (!key || key === "127.0.0.1" || key === "::1") return;
    const item = byIp.get(key) || {
      ip: key,
      students: /* @__PURE__ */ new Set(),
      codes: /* @__PURE__ */ new Set(),
      batches: /* @__PURE__ */ new Set(),
      times: []
    };
    if (studentId) item.students.add(String(studentId));
    if (code) item.codes.add(String(code));
    if (batchId) item.batches.add(String(batchId));
    const t = new Date(when || 0).getTime();
    if (t) item.times.push(t);
    byIp.set(key, item);
  };
  scopedCodes.forEach((c) => {
    if (String(c.status || "").toLowerCase() === "used") {
      add(
        c.activationIp,
        c.studentId || c.usedByStudentId,
        c.activatedAt,
        c.code,
        resolveJoinCodeBatchId(c)
      );
    }
  });
  scopedAttempts.forEach(
    (a) => add(a.ip, a.studentId, a.timestamp, a.code, a.batchId)
  );
  const alerts = [];
  byIp.forEach((item) => {
    const distinctStudents = item.students.size;
    if (distinctStudents < 3) return;
    const times = item.times.sort((x, y) => x - y);
    const windowMs = times.length ? times[times.length - 1] - times[0] : 0;
    const windowMinutes = Math.round(windowMs / 6e4);
    const tightWindow = times.length >= 3 && windowMs <= 30 * 60 * 1e3;
    const score = Math.min(99, distinctStudents * 18 + (tightWindow ? 25 : 0));
    alerts.push({
      ip: item.ip,
      distinctStudents,
      distinctCodes: item.codes.size,
      batches: Array.from(item.batches).slice(0, 4),
      windowMinutes,
      tightWindow,
      score,
      evidence: `${distinctStudents} \u0637\u0644\u0628\u0629 \u0648${item.codes.size} \u0623\u0643\u0648\u0627\u062F \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u0634\u0628\u0643\u0629${tightWindow ? ` \u062E\u0644\u0627\u0644 ${windowMinutes} \u062F\u0642\u064A\u0642\u0629` : ""}.`,
      recommendation: "\u0627\u0644\u0646\u0645\u0637 \u064A\u0634\u0628\u0647 \u062A\u0641\u0639\u064A\u0644\u0627\u064B \u062C\u0645\u0627\u0639\u064A\u0627\u064B \u0645\u0646 \u062C\u0647\u0627\u0632/\u0634\u0628\u0643\u0629 \u0648\u0627\u062D\u062F\u0629 \u2014 \u0631\u0627\u062C\u0639 \u0637\u0631\u064A\u0642\u0629 \u062A\u0648\u0632\u064A\u0639 \u0647\u0630\u0647 \u0627\u0644\u062F\u0641\u0639\u0629."
    });
  });
  return alerts.sort((a, b) => b.score - a.score).slice(0, 12);
}
function buildSharingRingGraph(scopedAttempts, scopedCodes) {
  const nodes = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const touchNode = (id, label, kind, risk = 0) => {
    if (!id) return;
    const prev = nodes.get(id) || { id, label, kind, risk: 0, count: 0 };
    prev.risk = Math.max(prev.risk, risk);
    prev.count = Number(prev.count || 0) + 1;
    nodes.set(id, prev);
  };
  const touchEdge = (from, to, risk = 0) => {
    if (!from || !to) return;
    const key = `${from}->${to}`;
    const prev = edges.get(key) || { from, to, weight: 0, risk: 0 };
    prev.weight += 1;
    prev.risk = Math.max(prev.risk, risk);
    edges.set(key, prev);
  };
  const rows = [
    ...scopedAttempts.map((a) => ({
      device: a.deviceToken || a.deviceFingerprint,
      student: normalizeStudentId(a.studentId || a.idNumber),
      name: a.studentName || a.studentId || "\u0637\u0627\u0644\u0628",
      risk: String(a.reason || "").includes("\u062C\u0647\u0627\u0632") ? 90 : 55
    })),
    ...scopedCodes.map((c) => ({
      device: c.activationDeviceToken || c.activationDeviceFingerprint,
      student: normalizeStudentId(c.studentId || c.usedByStudentId || c.assignedStudentId),
      name: c.studentName || c.assignedStudentName || c.studentId || "\u0637\u0627\u0644\u0628",
      risk: Number(c.codeReputationScore || 25)
    }))
  ].filter((r) => r.device && r.student);
  const byDevice = /* @__PURE__ */ new Map();
  rows.forEach((r) => {
    const deviceId = `dev:${import_crypto.default.createHash("sha1").update(String(r.device)).digest("hex").slice(0, 10)}`;
    const studentId = `stu:${r.student}`;
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, /* @__PURE__ */ new Set());
    byDevice.get(deviceId).add(studentId);
    const risk = Math.max(Number(r.risk || 0), byDevice.get(deviceId).size >= 2 ? 88 : 35);
    touchNode(deviceId, `\u062C\u0647\u0627\u0632 ${String(r.device).slice(0, 4)}\u2026`, "device", risk);
    touchNode(studentId, r.name || r.student, "student", risk);
    touchEdge(deviceId, studentId, risk);
  });
  const ringDevices = Array.from(byDevice.entries()).filter(([, students]) => students.size >= 2);
  const allowedDeviceIds = new Set(ringDevices.map(([id]) => id));
  const allowedStudentIds = /* @__PURE__ */ new Set();
  ringDevices.forEach(([, students]) => students.forEach((sid) => allowedStudentIds.add(sid)));
  const filteredNodes = Array.from(nodes.values()).filter((n) => allowedDeviceIds.has(n.id) || allowedStudentIds.has(n.id)).slice(0, 24);
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  return {
    nodes: filteredNodes,
    edges: Array.from(edges.values()).filter((e) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)).slice(0, 40),
    rings: ringDevices.slice(0, 8).map(([id, students]) => ({ id, risk: 90, students: students.size, devices: 1 }))
  };
}
function buildCodeRadar(codes, attempts) {
  const now = Date.now();
  const linkedByDevice = /* @__PURE__ */ new Map();
  attempts.forEach((attempt) => {
    const device = String(attempt.device || attempt.deviceToken || attempt.activationDeviceToken || attempt.deviceFingerprint || "").trim();
    const sid = normalizeStudentId(attempt.studentId || attempt.idNumber || attempt.assignedStudentId || "");
    if (!device || !sid) return;
    if (!linkedByDevice.has(device)) linkedByDevice.set(device, /* @__PURE__ */ new Set());
    linkedByDevice.get(device).add(sid);
  });
  const sharedStudentIds = /* @__PURE__ */ new Set();
  linkedByDevice.forEach((students) => {
    if (students.size >= 2) students.forEach((sid) => sharedStudentIds.add(sid));
  });
  const radar = {
    safe: 0,
    late: 0,
    suspicious: 0,
    sharing: 0,
    total: 0,
    hot: []
  };
  codes.filter(isUsableJoinCodeRecord).forEach((code) => {
    radar.total += 1;
    const score = Number(code.codeReputationScore || 0);
    const rep = String(code.codeReputation || "normal").toLowerCase();
    const status = String(code.status || "").toLowerCase();
    const createdAt = Date.parse(String(code.createdAt || code.issuedAt || "")) || now;
    const ageDays = Math.max(0, Math.floor((now - createdAt) / 864e5));
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
        score
      });
    }
  });
  radar.hot = radar.hot.slice(0, 8);
  return radar;
}
function buildSmartHealPreview(health) {
  const items = [
    { key: "ghostStudents", label: "\u0637\u0644\u0627\u0628 \u0639\u0627\u0644\u0642\u0648\u0646", count: Number(health?.ghostStudents || 0), tone: "amber" },
    { key: "orphanCodes", label: "\u0623\u0643\u0648\u0627\u062F \u0642\u062F\u064A\u0645\u0629", count: Number(health?.orphanCodes || 0), tone: "rose" },
    { key: "deadLinkCodes", label: "\u0631\u0648\u0627\u0628\u0637 \u0645\u0643\u0633\u0648\u0631\u0629", count: Number(health?.deadLinkCodes || 0), tone: "violet" },
    { key: "rosterOrphans", label: "\u0643\u0634\u0641 \u064A\u062A\u064A\u0645", count: Number(health?.rosterOrphans || 0), tone: "slate" },
    { key: "activeDeadStudentCodes", label: "\u0646\u0634\u0637 \u0628\u0644\u0627 \u0637\u0627\u0644\u0628", count: Number(health?.activeDeadStudentCodes || 0), tone: "rose" },
    { key: "duplicateActiveStudentCourseCodes", label: "\u062A\u0643\u0631\u0627\u0631 \u0646\u0634\u0637", count: Number(health?.duplicateActiveStudentCourseCodes || 0), tone: "amber" },
    { key: "tamperedLedgers", label: "\u0633\u062C\u0644 \u0645\u0643\u0633\u0648\u0631", count: Number(health?.tamperedLedgers || 0), tone: "rose" }
  ].filter((item) => item.count > 0);
  return {
    canHeal: items.length > 0,
    total: items.reduce((sum, item) => sum + item.count, 0),
    items: items.slice(0, 5),
    summary: items.length ? items.slice(0, 3).map((item) => `${item.count} ${item.label}`).join(" \u2014 ") : "\u0646\u0638\u064A\u0641"
  };
}
function buildMirasPulse(scopedCodes, scopedAttempts, health, radar) {
  const activeCodes = scopedCodes.filter((c) => String(c.status || "active").toLowerCase() === "active").length;
  const stuckStudents = dbInstance.getStudents().filter((student) => {
    const roster = getStudentRosterCourseCodes(student);
    if (!roster.length) return false;
    const active = getStudentActiveCourseCodes(student);
    return roster.some((course) => !active.some((a) => sectionCodeEquivalent(a, course)));
  }).length;
  const sensitiveExams = dbInstance.getTeacherExams().filter((exam) => {
    if (!isActiveRecord(exam)) return false;
    const status2 = String(exam.status || exam.visibility || "").toLowerCase();
    return status2.includes("open") || status2.includes("active") || exam.isOpen === true || exam.isPublished === true;
  }).length;
  const suspiciousSessions = scopedAttempts.filter((attempt) => {
    const reason = String(attempt.reason || "");
    const level = String(attempt.sessionConfidenceLevel || attempt.fairnessLevel || "");
    return reason.includes("\u062C\u0647\u0627\u0632") || reason.includes("\u0645\u0634\u0627\u0631\u0643\u0629") || level.includes("\u0645\u0646\u062E\u0641\u0636") || Number(attempt.sessionConfidenceScore || 0) >= 70;
  }).length;
  const issues = Number(health?.totalIssues || 0) + Number(radar?.suspicious || 0) + Number(radar?.sharing || 0) + stuckStudents + suspiciousSessions;
  const status = issues > 8 ? "danger" : issues > 0 ? "watch" : "calm";
  return {
    status,
    score: status === "calm" ? 98 : Math.max(35, 96 - Math.min(60, issues * 5)),
    rings: [
      { key: "health", value: Number(health?.totalIssues || 0), tone: Number(health?.totalIssues || 0) ? "amber" : "emerald", label: "\u0635\u062D\u0629" },
      { key: "codes", value: Number((radar?.suspicious || 0) + (radar?.sharing || 0)), tone: radar?.sharing || 0 ? "violet" : radar?.suspicious || 0 ? "rose" : "emerald", label: "\u0623\u0643\u0648\u0627\u062F" },
      { key: "students", value: stuckStudents, tone: stuckStudents ? "amber" : "emerald", label: "\u0637\u0644\u0628\u0629" },
      { key: "attempts", value: suspiciousSessions, tone: suspiciousSessions ? "rose" : "emerald", label: "\u062C\u0644\u0633\u0627\u062A" },
      { key: "exams", value: sensitiveExams, tone: "indigo", label: "\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A" }
    ],
    metrics: { activeCodes, stuckStudents, activationAttempts: scopedAttempts.length, sensitiveExams, suspiciousSessions },
    healPreview: buildSmartHealPreview(health)
  };
}
function buildTrustMap(scopedCodes, scopedAttempts, graph, radar) {
  const dots = [];
  const pushDot = (kind, id, label, tone, score, title = "") => {
    const key = `${kind}:${String(id || label || Math.random()).slice(0, 32)}`;
    if (dots.some((d) => d.key === key)) return;
    dots.push({ key, kind, label: String(label || id || "\u2014").slice(0, 18), tone, score, title: String(title || label || id || "") });
  };
  (Array.isArray(radar?.hot) ? radar.hot : []).forEach((item) => {
    pushDot("code", item.code, item.code, item.risk === "sharing" ? "violet" : "rose", Number(item.score || 80), item.studentName || item.studentId || "");
  });
  (Array.isArray(graph?.nodes) ? graph.nodes : []).forEach((node) => {
    const tone = node.kind === "device" ? "violet" : Number(node.risk || 0) >= 80 ? "rose" : "amber";
    pushDot(node.kind || "node", node.id, node.label, tone, Number(node.risk || 50));
  });
  scopedAttempts.slice(0, 40).forEach((attempt) => {
    const score = Number(attempt.sessionConfidenceScore || attempt.fairnessScore || 0);
    if (score >= 70 || String(attempt.reason || "").includes("\u062C\u0647\u0627\u0632")) {
      pushDot("student", normalizeStudentId(attempt.studentId), attempt.studentName || attempt.studentId, score >= 85 ? "rose" : "amber", score || 75, attempt.reason || "");
    }
  });
  scopedCodes.filter(isUsableJoinCodeRecord).slice(0, 60).forEach((code) => {
    if (dots.length >= 28) return;
    const score = Number(code.codeReputationScore || 0);
    if (score >= 35) pushDot("code", code.code, code.code, score >= 80 ? "rose" : "amber", score, code.studentName || code.assignedStudentName || "");
  });
  return { dots: dots.slice(0, 28), counts: dots.reduce((acc, dot) => {
    acc[dot.tone] = (acc[dot.tone] || 0) + 1;
    return acc;
  }, {}) };
}
function buildEventReplay(scopedCodes, scopedAttempts) {
  const events = [];
  const add = (type, label, at, payload = {}) => {
    const time = Date.parse(String(at || payload.timestamp || payload.createdAt || "")) || 0;
    events.push({ type, label, at: at || payload.timestamp || payload.createdAt || "", time, ...payload });
  };
  try {
    dbInstance.getActivityLogs().forEach((log) => {
      const action = String(log.action || log.details || "");
      if (!/(حذف|إضافة|اضاف|تفعيل|إعادة|اعادة|تنظيف|شفاء|كود|رمز)/.test(action)) return;
      add("log", action, log.timestamp || log.createdAt || log.date, {
        studentId: log.studentId || "",
        studentName: log.studentName || "",
        courseCode: log.sectionCode || log.courseCode || "",
        tone: action.includes("\u062D\u0630\u0641") ? "rose" : action.includes("\u062A\u0641\u0639\u064A\u0644") ? "emerald" : action.includes("\u0625\u0639\u0627\u062F\u0629") || action.includes("\u0627\u0639\u0627\u062F\u0629") ? "violet" : "indigo"
      });
    });
  } catch {
  }
  scopedCodes.slice(0, 50).forEach((code) => {
    (Array.isArray(code.codeJourney) ? code.codeJourney : []).forEach((ev) => {
      const label = ev.label || ev.action || "\u062D\u062F\u062B \u0643\u0648\u062F";
      add("code", label, ev.at || ev.timestamp || code.updatedAt || code.createdAt, {
        code: code.code,
        studentId: code.studentId || code.usedByStudentId || code.assignedStudentId || "",
        studentName: code.studentName || code.assignedStudentName || "",
        courseCode: joinCodeCourse(code),
        tone: String(label).includes("\u062D\u0630\u0641") ? "rose" : String(label).includes("\u062A\u0641\u0639\u064A\u0644") ? "emerald" : "indigo"
      });
    });
  });
  scopedAttempts.slice(0, 30).forEach((attempt) => {
    if (!String(attempt.reason || "").trim()) return;
    add("attempt", "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0641\u0639\u064A\u0644", attempt.timestamp || attempt.createdAt, { code: attempt.normalizedCode || attempt.code || "", studentId: attempt.studentId || "", studentName: attempt.studentName || "", courseCode: attempt.sectionCode || attempt.courseCode || "", tone: String(attempt.reason || "").includes("\u062C\u0647\u0627\u0632") ? "rose" : "amber", reason: attempt.reason || "" });
  });
  return events.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 10).map(({ time, ...rest }) => rest);
}
function maybeRunSafeDataSweep() {
  const health = computeDataHealth();
  if (!health.totalIssues) return health;
  return computeDataHealth();
}
function isRejectedActivationAttemptForReport(attempt) {
  const status = String(attempt?.status || "").toLowerCase();
  const reason = String(attempt?.reason || "");
  if (status === "success" || status === "used" || status === "activated") return false;
  if (attempt?.success === true || attempt?.activationSucceeded === true) return false;
  if (String(attempt?.approvalRequestType || "") === "second_hand_device") return false;
  if (/تم\s*(تفعيل|اعتماد)|نجح|success/i.test(reason)) return false;
  return Boolean(attempt?.code || attempt?.normalizedCode || reason);
}
function parseReportDateStart(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const t = (/* @__PURE__ */ new Date(`${raw}T00:00:00`)).getTime();
  return Number.isFinite(t) ? t : 0;
}
function parseReportDateEnd(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const t = (/* @__PURE__ */ new Date(`${raw}T23:59:59.999`)).getTime();
  return Number.isFinite(t) ? t : 0;
}
function shortServerDeviceId(attempt) {
  const raw = String(attempt?.deviceToken || attempt?.deviceFingerprint || "").trim();
  if (!raw) return "";
  const digest = import_crypto.default.createHash("sha1").update(raw).digest("hex").toUpperCase();
  return `FP-${digest.slice(0, 4)}-${digest.slice(-4)}`;
}
function attemptReportOwnerMatches(attempt, codeRecord, targetEmail) {
  const email = String(targetEmail || "").toLowerCase();
  if (!email) return false;
  const sectionCode = String(
    attempt?.targetSectionCode || attempt?.sectionCode || attempt?.courseCode || codeRecord?.studentSection || codeRecord?.sectionCode || codeRecord?.courseCode || ""
  ).trim();
  return String(attempt?.targetTeacherEmail || "").toLowerCase() === email || String(attempt?.teacherEmail || "").toLowerCase() === email || sectionCode && sectionOwnerEmail(sectionCode).toLowerCase() === email || sectionCode && teacherOwnsCourseCode(sectionCode, email) || codeRecord && joinCodeOwnerEmail(codeRecord) === email;
}
app.get("/api/teacher/activation-attempts", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  }
  const isAdmin = isAdminEmail(teacherEmail);
  const scope = String(req.query.scope || "").trim().toLowerCase();
  const targetEmail = isAdmin && scope && scope !== "all" && scope !== "self" ? scope : teacherEmail;
  const start = parseReportDateStart(req.query.from);
  const end = parseReportDateEnd(req.query.to);
  const codes = dbInstance.getJoinCodes();
  const allowedRows = dbInstance.getAllowedStudents();
  const students = dbInstance.getStudents();
  const rawAttempts = dbInstance.getActivationAttempts().filter(isRejectedActivationAttemptForReport).filter((attempt) => {
    const at = new Date(attempt.timestamp || attempt.createdAt || 0).getTime();
    if (start && Number.isFinite(at) && at < start) return false;
    if (end && Number.isFinite(at) && at > end) return false;
    return true;
  }).filter((attempt) => {
    if (isAdmin && scope === "all") return true;
    const codeRecord = codes.find(
      (code) => compactJoinCode(code.code) === compactJoinCode(attempt.normalizedCode || attempt.code || "")
    );
    return attemptReportOwnerMatches(attempt, codeRecord, targetEmail);
  });
  const keyOf = (attempt) => [
    normalizeStudentId(attempt.linkedStudentId || attempt.studentId || ""),
    compactJoinCode(attempt.normalizedCode || attempt.code || ""),
    String(attempt.targetSectionCode || attempt.sectionCode || attempt.courseCode || "").toLowerCase()
  ].join("|");
  const counts = /* @__PURE__ */ new Map();
  rawAttempts.forEach((attempt) => counts.set(keyOf(attempt), (counts.get(keyOf(attempt)) || 0) + 1));
  const attempts = rawAttempts.slice().sort(
    (a, b) => (new Date(b.timestamp || b.createdAt || 0).getTime() || 0) - (new Date(a.timestamp || a.createdAt || 0).getTime() || 0)
  ).map((attempt) => {
    const normalizedCode = normalizeJoinCode(attempt.normalizedCode || attempt.code || "");
    const codeRecord = codes.find(
      (code) => compactJoinCode(code.code) === compactJoinCode(normalizedCode)
    );
    const studentId = normalizeStudentId(
      attempt.linkedStudentId || attempt.studentId || attempt.targetStudentId || ""
    );
    const student = students.find((st) => normalizeStudentId(st.id) === studentId);
    const sectionCode = String(
      attempt.targetSectionCode || attempt.sectionCode || attempt.courseCode || codeRecord?.studentSection || codeRecord?.sectionCode || student?.sectionCode || ""
    ).trim();
    const allowed = allowedRows.find((row) => {
      const sid = normalizeStudentId(row.idNumber || row.id || row.studentId);
      if (sid !== studentId) return false;
      if (!sectionCode) return true;
      return allowedStudentMatchesCourse(row, sid, sectionCode, sectionOwnerEmail(sectionCode));
    });
    return {
      ...attempt,
      normalizedCode,
      linkedStudentId: student?.id || allowed?.idNumber || studentId || attempt.studentId || "",
      linkedStudentName: student?.name || allowed?.name || attempt.studentName || attempt.targetStudentName || "",
      linkedSectionCode: sectionCode,
      linkedSectionName: courseNameFromCode(sectionCode) || sectionDisplayCode(sectionCode) || "\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F",
      attemptCount: counts.get(keyOf(attempt)) || 1,
      deviceShortId: shortServerDeviceId(attempt)
    };
  });
  const summary = {
    attempts: attempts.length,
    students: new Set(attempts.map((a) => normalizeStudentId(a.linkedStudentId || a.studentId)).filter(Boolean)).size,
    codes: new Set(attempts.map((a) => compactJoinCode(a.normalizedCode || a.code)).filter(Boolean)).size,
    devices: new Set(attempts.map((a) => a.deviceShortId).filter(Boolean)).size
  };
  return res.json({ success: true, attempts, summary });
});
app.get("/api/teacher/code-integrity", (req, res) => {
  const teacherEmail = String(
    req.query.teacherEmail || req.headers["x-teacher-email"] || ""
  ).toLowerCase();
  const adminView = !teacherEmail || isAdminEmail(teacherEmail);
  const retired = typeof dbInstance.getRetiredJoinCodes === "function" ? dbInstance.getRetiredJoinCodes() : [];
  const liveCodes = dbInstance.getJoinCodes().filter(isOperationalJoinCodeRecord);
  const lookupCodes = [
    ...liveCodes,
    ...retired.filter((code) => isArchivedJoinCodeRecord(code))
  ];
  const attempts = dbInstance.getActivationAttempts();
  const scopedAttempts = attempts.filter((attempt) => {
    if (adminView) return true;
    return sectionOwnerEmail(attempt.sectionCode).toLowerCase() === teacherEmail;
  });
  const scopedCodes = liveCodes.filter(
    (code) => adminView || sectionOwnerEmail(
      code.studentSection || code.sectionCode || code.courseCode
    ).toLowerCase() === teacherEmail || joinCodeOwnerEmail(code) === teacherEmail
  );
  const scopedLookupCodes = lookupCodes.filter(
    (code) => adminView || sectionOwnerEmail(
      code.studentSection || code.sectionCode || code.courseCode
    ).toLowerCase() === teacherEmail || joinCodeOwnerEmail(code) === teacherEmail
  );
  const suspiciousCodes = scopedCodes.filter(
    (code) => Number(code.leakAttemptCount || 0) > 0 || Number(code.codeReputationScore || 0) >= 40 || code.activationReviewRequired || code.secondStepRecommended
  ).sort(
    (a, b) => Number(b.codeReputationScore || b.leakAttemptCount || 0) - Number(a.codeReputationScore || a.leakAttemptCount || 0)
  );
  const honeyAttempts = scopedAttempts.filter(
    (a) => a.honeyCode || String(a.reason || "").includes("\u0645\u0635\u064A\u062F\u0629")
  );
  const reputationCounts = scopedCodes.reduce(
    (acc, code) => {
      const level = String(code.codeReputation || "normal");
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    },
    { normal: 0, watch: 0, suspicious: 0, danger: 0, temporarily_blocked: 0 }
  );
  const tradingAlerts = scopedCodes.filter(
    (code) => Number(code.distinctFailedDevices || 0) >= 3 || Number(code.distinctFailedStudents || 0) >= 2 || String(code.codeReputation || "") === "danger" || String(code.codeReputation || "") === "temporarily_blocked"
  ).sort(
    (a, b) => Number(b.codeReputationScore || 0) - Number(a.codeReputationScore || 0)
  ).slice(0, 12);
  const batchIntelligence = buildBatchIntelligence(
    scopedCodes,
    scopedAttempts
  ).slice(0, adminView ? 40 : 15);
  const seasonalMemory = buildSeasonalCodeMemory(scopedCodes, scopedAttempts);
  const outOfContextAlerts = buildOutOfContextCodeAlerts(
    scopedCodes,
    scopedAttempts
  );
  const heatmap = {
    safeBatches: batchIntelligence.filter((b) => b.level === "\u0622\u0645\u0646\u0629").length,
    watchBatches: batchIntelligence.filter(
      (b) => b.level === "\u062A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u0642\u0628\u0629"
    ).length,
    dangerBatches: batchIntelligence.filter(
      (b) => b.level === "\u0639\u0627\u0644\u064A\u0629 \u0627\u0644\u062E\u0637\u0648\u0631\u0629"
    ).length,
    tradedCodes: tradingAlerts.length,
    guessedCodes: honeyAttempts.length,
    highRiskWindows: batchIntelligence.filter((b) => b.score >= 75).slice(0, 6)
  };
  const collectiveTransferAlerts = buildCollectiveTransferAlerts(
    scopedCodes,
    scopedAttempts
  );
  const codeHealthFunnel = buildCodeHealthFunnel(scopedCodes);
  const ipClusterAlerts = buildIpClusterAlerts(scopedCodes, scopedAttempts);
  const caseFiles = suspiciousCodes.slice(0, 24).map((code) => buildCodeCaseFile(code, scopedAttempts)).sort((a, b) => b.reputationScore - a.reputationScore);
  const leakSources = inferLeakSources(
    scopedCodes,
    scopedAttempts,
    batchIntelligence,
    collectiveTransferAlerts,
    outOfContextAlerts
  );
  const teacherReports = buildTeacherCodeReports({
    tradingAlerts,
    batchIntelligence,
    collectiveTransferAlerts,
    caseFiles,
    leakSources,
    outOfContextAlerts
  });
  const fairnessSummary = scopedAttempts.reduce((acc, attempt) => {
    const label = String(attempt.fairnessLevel || "\u063A\u064A\u0631 \u0645\u0635\u0646\u0641");
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const sessionConfidenceSummary = scopedAttempts.reduce(
    (acc, attempt) => {
      const label = String(attempt.sessionConfidenceLevel || "\u063A\u064A\u0631 \u0645\u0635\u0646\u0641");
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    },
    {}
  );
  const secondStepQueue = suspiciousCodes.filter(
    (code) => code.secondStepRecommended || Number(code.codeReputationScore || 0) >= 85
  ).slice(0, 12).map((code) => ({
    code: code.code,
    batchId: resolveJoinCodeBatchId(code),
    studentId: code.studentId || code.assignedStudentId || "",
    studentName: code.studentName || code.assignedStudentName || "",
    score: Number(code.codeReputationScore || 0),
    reason: code.lastFailedAttemptReason || "\u0627\u0634\u062A\u0628\u0627\u0647 \u0639\u0627\u0644\u064D \u064A\u0633\u062A\u062D\u0642 \u062A\u0641\u0639\u064A\u0644\u064B\u0627 \u0627\u062D\u062A\u064A\u0627\u0637\u064A\u064B\u0627 \u0639\u0644\u0649 \u0645\u0631\u062D\u0644\u062A\u064A\u0646"
  }));
  const enrichCodeOwner = (item) => {
    const normalizedCode = normalizeJoinCode(
      item.normalizedCode || item.code || item.joinCode || ""
    );
    const codeRecord = scopedLookupCodes.find(
      (code) => normalizeJoinCode(code.code) === normalizedCode || compactJoinCode(code.code) === compactJoinCode(normalizedCode)
    );
    const linkedStudentId = normalizeStudentId(
      item.studentId || item.idNumber || item.assignedStudentId || codeRecord?.studentId || codeRecord?.usedByStudentId || codeRecord?.assignedStudentId
    );
    const student = dbInstance.getStudents().find((st) => normalizeStudentId(st.id) === linkedStudentId);
    const allowed = dbInstance.getAllowedStudents().find(
      (row) => normalizeStudentId(row.idNumber || row.id || row.studentId) === linkedStudentId
    );
    const sectionCode = item.sectionCode || codeRecord?.studentSection || codeRecord?.sectionCode || student?.sectionCode || allowed?.sectionCode || "";
    const reason = String(
      item.reason || codeRecord?.lastFailedAttemptReason || ""
    );
    const attemptCount = Number(
      codeRecord?.leakAttemptCount || item.leakAttemptCount || 0
    );
    const storedScore = Number(
      codeRecord?.codeReputationScore || item.codeReputationScore || 0
    );
    const confidenceScore = storedScore || Math.min(
      99,
      Math.max(
        15,
        (reason.includes("\u062C\u0647\u0627\u0632") ? 85 : 0) || (reason.includes("\u0643\u0648\u062F") && reason.includes("\u0645\u0633\u062A\u062E\u062F\u0645") ? 78 : 0) || (reason.includes("\u0645\u062E\u0635\u0635") ? 72 : 0) || (reason.includes("\u0645\u0635\u064A\u062F\u0629") ? 72 : 0) || (reason.includes("\u0635\u064A\u063A\u0629") ? 34 : 0) || (attemptCount >= 3 ? 76 : attemptCount > 0 ? 58 : 40)
      )
    );
    const codeRep = String(
      codeRecord?.codeReputation || item.codeReputation || (confidenceScore >= 90 ? "danger" : confidenceScore >= 70 ? "suspicious" : confidenceScore >= 40 ? "watch" : "normal")
    );
    const integrityLabel = codeRecord?.codeReputationLabel || item.codeReputationLabel || CODE_REPUTATION_LABELS[codeRep] || (confidenceScore >= 75 ? "\u0645\u0634\u062A\u0628\u0647" : confidenceScore >= 50 ? "\u0645\u0631\u0627\u0642\u0628\u0629" : "\u0637\u0628\u064A\u0639\u064A");
    const itemAttempts = scopedAttempts.filter(
      (attempt) => compactJoinCode(attempt.normalizedCode || attempt.code || "") === compactJoinCode(normalizedCode)
    );
    const fairness = item.fairnessLevel ? {
      level: item.fairnessLevel,
      label: item.fairnessLabel,
      score: item.fairnessScore
    } : classifyStudentFairness(itemAttempts, codeRecord);
    return {
      ...item,
      normalizedCode: normalizedCode || item.normalizedCode || item.code || "",
      linkedStudentId: student?.id || allowed?.idNumber || linkedStudentId || "",
      linkedStudentName: student?.name || allowed?.name || item.studentName || codeRecord?.studentName || "",
      linkedStudentEmail: student?.email || item.studentEmail || "",
      linkedSectionCode: sectionCode,
      linkedSectionName: activeSections().find(
        (sec) => String(sec.code).toLowerCase() === String(sectionCode).toLowerCase()
      )?.courseName || courseNameFromCode(sectionCode) || "\u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0645\u062D\u062F\u062F",
      linkedAccountLabel: [
        student?.name || allowed?.name || item.studentName || "",
        student?.id || allowed?.idNumber || linkedStudentId || ""
      ].filter(Boolean).join(" \u2022 "),
      confidenceScore,
      integrityLabel,
      codeReputation: codeRep,
      codeReputationLabel: integrityLabel,
      codeReputationScore: confidenceScore,
      distinctFailedDevices: codeRecord?.distinctFailedDevices || item.distinctFailedDevices || 0,
      distinctFailedIps: codeRecord?.distinctFailedIps || item.distinctFailedIps || 0,
      distinctFailedStudents: codeRecord?.distinctFailedStudents || item.distinctFailedStudents || 0,
      activationFrozenUntil: codeRecord?.activationFrozenUntil || item.activationFrozenUntil || "",
      activationReviewRequired: Boolean(
        codeRecord?.activationReviewRequired || item.activationReviewRequired
      ),
      strictLibraryMode: codeRecord?.strictLibraryMode !== false,
      batchId: codeRecord?.batchId || item.batchId || resolveJoinCodeBatchId(codeRecord || item),
      codeJourney: codeRecord?.codeJourney || item.codeJourney || [],
      honeyCode: Boolean(item.honeyCode || reason.includes("\u0645\u0635\u064A\u062F\u0629")),
      fairness,
      fairnessLevel: fairness.level,
      fairnessLabel: fairness.label,
      fairnessScore: fairness.score,
      silentEnforcement: item.silentEnforcement !== false,
      sessionConfidenceScore: item.sessionConfidenceScore || codeRecord?.lastSessionConfidenceScore || 0,
      sessionConfidenceLevel: item.sessionConfidenceLevel || "\u063A\u064A\u0631 \u0645\u0635\u0646\u0641",
      secondStepRecommended: Boolean(
        item.secondStepRecommended || codeRecord?.secondStepRecommended || confidenceScore >= 85
      ),
      confidenceStamp: codeConfidenceStamp(confidenceScore, codeRep),
      recommendedAction: recommendCodeAction({
        score: confidenceScore,
        reason,
        fairnessLevel: fairness.level,
        sessionLevel: item.sessionConfidenceLevel || "",
        activationReviewRequired: Boolean(
          codeRecord?.activationReviewRequired || item.activationReviewRequired
        )
      })
    };
  };
  const realAdminView = isAdminEmail(teacherEmailFromRequest(req));
  const adminHealth = realAdminView ? maybeRunSafeDataSweep() : void 0;
  const adminCodeRadar = realAdminView ? buildCodeRadar(scopedCodes, scopedAttempts) : void 0;
  const adminSharingGraph = realAdminView ? buildSharingRingGraph(scopedAttempts, scopedCodes) : void 0;
  const adminMirasPulse = realAdminView ? buildMirasPulse(scopedCodes, scopedAttempts, adminHealth, adminCodeRadar) : void 0;
  const adminTrustMap = realAdminView ? buildTrustMap(scopedCodes, scopedAttempts, adminSharingGraph, adminCodeRadar) : void 0;
  const adminEventReplay = realAdminView ? buildEventReplay(scopedCodes, scopedAttempts) : void 0;
  return res.json({
    success: true,
    summary: {
      totalAttempts: scopedAttempts.length,
      repeatedCodes: suspiciousCodes.length,
      deviceMismatch: scopedAttempts.filter(
        (a) => String(a.reason || "").includes("\u062C\u0647\u0627\u0632")
      ).length,
      oldFormat: scopedAttempts.filter(
        (a) => String(a.reason || "").includes("\u0635\u064A\u063A\u0629")
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
      ipClusterAlerts: ipClusterAlerts.length
    },
    codeHealthFunnel,
    ipClusterAlerts,
    sharingGraph: isAdminEmail(teacherEmailFromRequest(req)) ? adminSharingGraph : void 0,
    codeRadar: isAdminEmail(teacherEmailFromRequest(req)) ? adminCodeRadar : void 0,
    mirasPulse: isAdminEmail(teacherEmailFromRequest(req)) ? adminMirasPulse : void 0,
    trustMap: isAdminEmail(teacherEmailFromRequest(req)) ? adminTrustMap : void 0,
    eventReplay: isAdminEmail(teacherEmailFromRequest(req)) ? adminEventReplay : void 0,
    attempts: scopedAttempts.slice(0, 120).map(enrichCodeOwner),
    suspiciousCodes: suspiciousCodes.slice(0, 80).map(enrichCodeOwner),
    honeyAttempts: honeyAttempts.slice(0, 40).map(enrichCodeOwner),
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
    dataHealth: isAdminEmail(teacherEmailFromRequest(req)) ? adminHealth : void 0
  });
});
var usedRollCallScans = /* @__PURE__ */ new Set();
function rollCallSecret() {
  return String(process.env.MIRAS_ROLLCALL_QR_SECRET || process.env.MIRAS_SESSION_SECRET || MIRAS_SESSION_SECRET || "").trim();
}
function signRollCallPayload(payload) {
  return import_crypto.default.createHmac("sha256", rollCallSecret()).update(stableLedgerString(payload)).digest("hex");
}
function encodeRollCallToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signRollCallPayload(payload);
  return `${body}.${sig}`;
}
function decodeRollCallToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return { ok: false, error: "bad_format" };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "bad_json" };
  }
  const expected = signRollCallPayload(payload);
  const ok = expected.length === sig.length && import_crypto.default.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!ok) return { ok: false, error: "bad_signature" };
  const now = Date.now();
  if (Math.abs(now - Number(payload.iat || 0)) > 2e4 || Number(payload.exp || 0) < now) return { ok: false, error: "expired" };
  return { ok: true, payload };
}
app.post("/api/teacher/rollcall-qr", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const sectionCode = String(req.body?.sectionCode || req.body?.courseCode || "").trim();
  if (!teacherEmail || !sectionCode) return res.status(400).json({ error: "\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629." });
  if (!isAdminEmail(teacherEmail) && !teacherOwnsCourseCode(sectionCode, teacherEmail)) {
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u0635\u062F\u0627\u0631 QR \u0644\u0647\u0630\u0647 \u0627\u0644\u0634\u0639\u0628\u0629." });
  }
  const iat = Date.now();
  const payload = {
    typ: "miras-rollcall-v1",
    sectionCode,
    teacherEmail: teacherEmail.toLowerCase(),
    iat,
    exp: iat + 15e3,
    nonce: import_crypto.default.randomBytes(8).toString("hex")
  };
  return res.json({ success: true, token: encodeRollCallToken(payload), expiresAt: new Date(payload.exp).toISOString(), refreshAfterMs: 1e4 });
});
app.post("/api/students/rollcall-qr/activate", (req, res) => {
  const decoded = decodeRollCallToken(req.body?.token || req.body?.qrToken || "");
  if (!decoded.ok) return res.status(400).json({ error: "\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0631\u0645\u0632 \u0627\u0644\u062D\u0636\u0648\u0631. \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0634\u0627\u0634\u0629." });
  const payload = decoded.payload;
  const studentId = normalizeStudentId(req.body?.studentId || req.body?.idNumber || req.body?.id || "");
  if (!studentId) return res.status(400).json({ error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0645\u0637\u0644\u0648\u0628." });
  const scanKey = `${payload.nonce}:${studentId}`;
  if (usedRollCallScans.has(scanKey)) return res.status(409).json({ error: "\u062A\u0645 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0633\u062D \u0627\u0644\u062D\u0636\u0648\u0631 \u0644\u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u0627\u0644\u0641\u0639\u0644." });
  const rosterMatch = dbInstance.getAllowedStudents().find(
    (row) => allowedStudentMatchesCourse(row, studentId, payload.sectionCode, payload.teacherEmail)
  );
  if (!rosterMatch) return res.status(403).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0643\u0634\u0641 \u0647\u0630\u0647 \u0627\u0644\u0634\u0639\u0628\u0629." });
  let code = dbInstance.getJoinCodes().find(
    (jc) => String(jc.status || "active").toLowerCase() === "active" && joinCodeWindowStatus(jc).ok && !isJoinCodeTemporarilyFrozen(jc) && joinCodeOwnerEmail(jc) === String(payload.teacherEmail).toLowerCase() && courseCodeMatchesForTeacher(jc.sectionCode || jc.courseCode || jc.studentSection, payload.sectionCode, payload.teacherEmail) && (joinCodeAssignedToStudent(jc, { id: studentId }) || !jc.assignedStudentId)
  );
  if (!code) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const generated = attachJoinCodeSignature({
      code: makeJoinCode("LAB", "", issuedJoinCodeCompacts()),
      semester: String(req.body?.semester || "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u062D\u0627\u0644\u064A"),
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
      batchId: `RollCall-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}-${payload.sectionCode}`,
      codeJourney: createCodeJourneyEvent("QR \u062D\u0636\u0648\u0631 \u062F\u0648\u0651\u0627\u0631", payload.teacherEmail, { sectionCode: payload.sectionCode, studentId })
    });
    dbInstance.addJoinCode(generated);
    code = generated;
  }
  usedRollCallScans.add(scanKey);
  const replayTimer = setTimeout(() => usedRollCallScans.delete(scanKey), 3e4);
  replayTimer.unref?.();
  req.body = { ...req.body || {}, courseCode: payload.sectionCode, sectionCode: payload.sectionCode, otp: code.code, code: code.code, joinCode: code.code };
  return processStudentCourseActivation(req, res, studentId, code.code, {
    name: req.body?.name || rosterMatch.name || studentId,
    email: req.body?.email || `${studentId}@paaet.edu.kw`,
    semester: req.body?.semester,
    password: req.body?.password
  });
});
app.post("/api/teacher/data-heal", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!isAdminEmail(teacherEmail)) {
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0645\u062A\u0627\u062D \u0644\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646 \u0641\u0642\u0637." });
  }
  const before = computeDataHealth();
  const healed = healDataIssues(teacherEmail);
  dbInstance.addActivityLog({
    action: "\u0635\u064A\u0627\u0646\u0629 \u0648\u0634\u0641\u0627\u0621 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A",
    details: `\u0634\u0641\u0627\u0621 \u0630\u0627\u062A\u064A: \u0637\u0644\u0627\u0628=${healed.healedStudents}\u060C \u0623\u0643\u0648\u0627\u062F \u0645\u0624\u0631\u0634\u0641\u0629=${healed.archivedCodes}\u060C \u0623\u0643\u0648\u0627\u062F \u0645\u062D\u0631\u0651\u0631\u0629=${healed.relinkedCodes}\u060C \u0635\u0641\u0648\u0641 \u0643\u0634\u0641=${healed.removedRoster}`,
    teacherEmail,
    actorEmail: teacherEmail,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646",
    browser: "\u0645\u0631\u0643\u0632 \u0627\u0644\u0630\u0643\u0627\u0621",
    isViolationWarning: false
  });
  return res.json({ success: true, before, healed, dataHealth: computeDataHealth() });
});
function isAdminEmail(email) {
  const norm = String(email || "").toLowerCase();
  return norm.includes("ah.alfailakawi") || norm.includes("ahmad.alfailakawi");
}
function extractEmailFromSectionCode(code) {
  const raw = String(code || "").trim().toLowerCase();
  if (raw.indexOf("@") === -1) return "";
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
function sectionOwnerEmail(code) {
  const raw = String(code || "").trim();
  const exactSection = activeSections().find((sec) => String(sec.code).toLowerCase() === raw.toLowerCase());
  if (exactSection?.ownerEmail) return exactSection.ownerEmail.toLowerCase();
  const embeddedOwner = extractEmailFromSectionCode(raw);
  if (embeddedOwner) return embeddedOwner;
  const displaySection = activeSections().find(
    (sec) => sectionDisplayCode(sec.code).toLowerCase() === sectionDisplayCode(raw).toLowerCase()
  );
  if (displaySection?.ownerEmail) return displaySection.ownerEmail.toLowerCase();
  const c = raw.toUpperCase();
  if (c === "TECH-A1" || c === "TECH-B2") return "ada.alenezi@paaet.edu.kw";
  return "ah.alfailakawi@paaet.edu.kw";
}
function sectionDisplayCode(code) {
  const value = String(code || "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (upper === "TECH-A1" || upper === "TECH-B2") return upper;
  const embeddedEmail = extractEmailFromSectionCode(value);
  if (embeddedEmail) {
    const cleaned = value.replace(new RegExp(embeddedEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/^-+|-+$/g, "").replace(/--+/g, "-").trim();
    if (cleaned) return cleaned.toUpperCase();
  }
  return upper;
}
function buildTeacherScopedSectionCode(displayCode, teacherEmail) {
  const displayOnly = sectionDisplayCode(String(displayCode || "").trim());
  const normalizedCode = String(displayOnly || "").trim().toUpperCase();
  if (!normalizedCode) return "";
  if (normalizedCode === "TECH-A1" || normalizedCode === "TECH-B2") return normalizedCode;
  return `${normalizedCode}-${String(teacherEmail || "").trim().toLowerCase()}`;
}
function sectionCodeEquivalent(a, b) {
  const aa = String(a || "").trim().toLowerCase();
  const bb = String(b || "").trim().toLowerCase();
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const aDisplay = sectionDisplayCode(aa).toLowerCase();
  const bDisplay = sectionDisplayCode(bb).toLowerCase();
  if (!aDisplay || !bDisplay || aDisplay !== bDisplay) return false;
  const aOwner = extractEmailFromSectionCode(aa);
  const bOwner = extractEmailFromSectionCode(bb);
  if (aOwner && bOwner) return aOwner === bOwner;
  return true;
}
function courseCodeMatchesForTeacher(a, b, teacherEmail) {
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
function allowedStudentMatchesCourse(row, studentId, courseCode, teacherEmail) {
  if (normalizeStudentId(row?.idNumber || row?.id || row?.studentId) !== normalizeStudentId(studentId)) return false;
  const rowCourse = row?.sectionCode || row?.studentSection || row?.courseCode;
  if (!rowCourse) return false;
  if (teacherEmail) {
    const wanted = String(teacherEmail).trim().toLowerCase();
    const rowOwner = String(row?.teacherEmail || "").trim().toLowerCase() || extractEmailFromSectionCode(rowCourse) || sectionOwnerEmail(rowCourse);
    if (rowOwner && rowOwner !== wanted) return false;
  }
  if (!courseCode || String(courseCode).toLowerCase() === "all") return true;
  return courseCodeMatchesForTeacher(rowCourse, courseCode, teacherEmail);
}
function joinCodeAssignedToStudent(code, student) {
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  if (!sid) return false;
  return [code?.assignedStudentId, code?.studentId, code?.usedByStudentId].map((v) => normalizeStudentId(v)).filter(Boolean).includes(sid);
}
function courseNameFromCode(courseCode) {
  const raw = String(courseCode || "").trim();
  const sec = sectionForCourseCode(raw) || resolveSectionForStudentGate(raw);
  return String(sec?.courseName || sec?.name || sectionDisplayCode(raw) || raw || "\u0627\u0644\u0645\u0642\u0631\u0631").trim();
}
function isGenericJoinCourseCode(value) {
  const raw = String(value || "").trim().toLowerCase();
  return !raw || raw === "all";
}
function isUsefulCourseNameForDisplay(name, code) {
  const text = String(name || "").trim();
  if (!text || text.toLowerCase() === "all" || /غير\s*محم/i.test(text)) return false;
  const displayCode = sectionDisplayCode(String(code || "").trim());
  if (displayCode && text.toLowerCase() === displayCode.toLowerCase()) return false;
  return true;
}
function resolveJoinCodeCourseForDisplay(jc) {
  const candidates = [];
  const addCandidate = (codeValue, nameValue) => {
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
    jc?.studentId || jc?.usedByStudentId || jc?.assignedStudentId || ""
  );
  const linkedCode = compactJoinCode(jc?.code || "");
  let linkedStudent = null;
  if (linkedStudentId || linkedCode) {
    linkedStudent = dbInstance.getStudents().find((student) => {
      const sameStudent = linkedStudentId && normalizeStudentId(student?.id || student?.idNumber || student?.studentId) === linkedStudentId;
      const sameActivationCode = linkedCode && compactJoinCode(student?.activationCode || "") === linkedCode;
      return sameStudent || sameActivationCode;
    });
  }
  if (linkedStudent) {
    (Array.isArray(linkedStudent.enrollments) ? linkedStudent.enrollments : []).forEach(
      (entry) => addCandidate(
        entry?.courseCode || entry?.sectionCode || entry?.studentSection,
        entry?.courseName || entry?.sectionName || entry?.title
      )
    );
    (Array.isArray(linkedStudent.activatedCourseCodes) ? linkedStudent.activatedCourseCodes : []).forEach((code) => addCandidate(code));
    addCandidate(linkedStudent.studentSection, linkedStudent.courseName);
    addCandidate(linkedStudent.sectionCode, linkedStudent.courseName);
  }
  if (linkedStudentId) {
    dbInstance.getAllowedStudents().forEach((row) => {
      const rowId = normalizeStudentId(row?.idNumber || row?.id || row?.studentId);
      if (rowId !== linkedStudentId) return;
      addCandidate(
        row?.sectionCode || row?.studentSection || row?.courseCode,
        row?.courseName || row?.sectionName || row?.subjectName
      );
    });
  }
  let firstCourseCode = "";
  for (const item of candidates) {
    const section = sectionForCourseCode(item.code) || resolveSectionForStudentGate(item.code);
    const resolvedCode = String(section?.code || item.code || "").trim();
    if (!firstCourseCode) firstCourseCode = resolvedCode;
    const resolvedName = String(
      item.name || section?.courseName || section?.name || courseNameFromCode(resolvedCode)
    ).trim();
    if (isUsefulCourseNameForDisplay(resolvedName, resolvedCode)) {
      return { courseCode: resolvedCode, courseName: resolvedName };
    }
  }
  return { courseCode: firstCourseCode, courseName: "" };
}
function escapeRegExpLiteral(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function publicTeacherNameForEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return "\u0627\u0644\u062F\u0643\u062A\u0648\u0631";
  const cleanName = (name) => {
    const text = String(name || "").trim();
    return text && !text.includes("@") ? text : "";
  };
  const teacher = dbInstance.getTeachers().find(
    (t) => String(t.email || "").toLowerCase() === normalized || String(t.id || "").toLowerCase() === normalized
  );
  const teacherName = cleanName(teacher?.name);
  if (teacherName) return teacherName;
  const section = dbInstance.getSections().find(
    (sec) => [
      sec?.ownerEmail,
      sec?.teacherEmail,
      sec?.createdByEmail,
      extractEmailFromSectionCode(sec?.code)
    ].map((value) => String(value || "").toLowerCase()).includes(normalized)
  );
  const sectionName = cleanName(
    section?.teacherName || section?.ownerName || section?.instructorName
  );
  if (sectionName) return sectionName;
  if (normalized.includes("ada.alenezi")) return "\u062F. \u0639\u0628\u062F\u0627\u0644\u0639\u0632\u064A\u0632 \u062F\u062E\u064A\u0644 \u0627\u0644\u0639\u0646\u0632\u064A";
  if (normalized.includes("ah.alfailakawi") || normalized.includes("ahmad.alfailakawi") || normalized.includes("dr.ahmad.alfailakawi"))
    return "\u062F. \u0623\u062D\u0645\u062F \u062D\u0633\u064A\u0646 \u0627\u0644\u0641\u064A\u0644\u0643\u0627\u0648\u064A";
  return "\u0627\u0644\u062F\u0643\u062A\u0648\u0631";
}
function publicCourseNameForMessage(courseCode) {
  const raw = String(courseCode || "").trim();
  if (!raw) return "\u0627\u0644\u0645\u0642\u0631\u0631";
  const label = courseNameFromCode(raw);
  const display = sectionDisplayCode(raw);
  const cleanLabel = String(label || "").trim();
  if (!cleanLabel || cleanLabel.includes("@") || display && cleanLabel.toLowerCase() === display.toLowerCase() || /^[A-Z0-9_-]+$/i.test(cleanLabel))
    return "\u0627\u0644\u0645\u0642\u0631\u0631";
  return cleanLabel;
}
function replaceStandalonePublicToken(source, token, label) {
  const raw = String(token || "").trim();
  if (!raw || !label) return source;
  const boundary = "[^\\p{L}\\p{N}@._%+-]";
  const escaped = escapeRegExpLiteral(raw);
  return source.replace(
    new RegExp(`(^|${boundary})${escaped}(?=$|${boundary})`, "giu"),
    (_match, prefix) => `${prefix}${label}`
  );
}
function replaceCourseContextPublicToken(source, token, label) {
  const raw = String(token || "").trim();
  if (!raw || !label) return source;
  const courseWord = "(?:\u0645\u0642\u0631\u0631|\u0627\u0644\u0645\u0642\u0631\u0631|\u0644\u0645\u0642\u0631\u0631|\u0644\u0644\u0645\u0642\u0631\u0631|\u0634\u0639\u0628\u0629|\u0627\u0644\u0634\u0639\u0628\u0629|\u0644\u0634\u0639\u0628\u0629|\u0644\u0644\u0634\u0639\u0628\u0629|\u0643\u0648\u0631\u0633|course|section)";
  const escaped = escapeRegExpLiteral(raw);
  return source.replace(
    new RegExp(
      `(${courseWord}\\s*(?:[:#\\-\u2013\u2014]\\s*)?)${escaped}(?=$|[^\\p{L}\\p{N}@._%+-])`,
      "giu"
    ),
    (_match, prefix) => `${prefix}${label}`
  );
}
function sanitizePublicMessageText(value) {
  let text = String(value || "");
  if (!text) return "";
  const replaceCourseToken = (token) => publicCourseNameForMessage(token);
  text = text.replace(
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}-[A-Za-z0-9_-]+/gi,
    replaceCourseToken
  );
  text = text.replace(
    /[A-Za-z0-9_-]+-[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    replaceCourseToken
  );
  const seen = /* @__PURE__ */ new Set();
  dbInstance.getSections().map((sec) => ({
    code: String(sec?.code || "").trim(),
    display: sectionDisplayCode(sec?.code),
    label: publicCourseNameForMessage(sec?.code)
  })).filter((ref) => ref.code || ref.display).sort((a, b) => String(b.code || b.display).length - String(a.code || a.display).length).forEach((ref) => {
    [ref.code, ref.display].map((token) => String(token || "").trim()).filter(Boolean).forEach((token) => {
      const key = `${token.toLowerCase()}::${ref.label}`;
      if (seen.has(key)) return;
      seen.add(key);
      const scopedOrNamed = token.includes("@") || /[A-Za-z]/.test(token) && /[-_]/.test(token);
      text = scopedOrNamed ? replaceStandalonePublicToken(text, token, ref.label) : replaceCourseContextPublicToken(text, token, ref.label);
    });
  });
  text = text.replace(
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    (email) => publicTeacherNameForEmail(email)
  );
  return text.replace(/\s{2,}/g, " ").trim();
}
function sanitizeNotificationForResponse(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    title: sanitizePublicMessageText(item.title || "\u0645\u0650\u0631\u0627\u0633") || "\u0645\u0650\u0631\u0627\u0633",
    body: sanitizePublicMessageText(item.body || item.message || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F.") || "\u0644\u062F\u064A\u0643 \u062A\u0646\u0628\u064A\u0647 \u062C\u062F\u064A\u062F."
  };
}
function deletedTeacherCourseShadowMatches(section, finalCode, teacherEmail) {
  const deleted = Boolean(section?.deletedAt || section?.isDeleted || section?.archivedAt || section?.retiredAt);
  if (!deleted) return false;
  const owner = String(section?.ownerEmail || sectionOwnerEmail(section?.code)).toLowerCase();
  return owner === String(teacherEmail || "").toLowerCase() && sectionCodeEquivalent(section?.code, finalCode);
}
function teacherOwnsCourseCode(courseCode, teacherEmail) {
  const normalizedTeacher = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(courseCode || "").trim();
  if (!normalizedTeacher || !raw) return false;
  const embeddedOwner = extractEmailFromSectionCode(raw);
  if (embeddedOwner) return embeddedOwner === normalizedTeacher;
  return activeSections().some((sec) => {
    const owner = String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase();
    return owner === normalizedTeacher && sectionCodeEquivalent(sec.code, raw);
  });
}
function resolveTeacherScopedCourseCode(courseCode, teacherEmail) {
  const normalizedTeacher = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(courseCode || "").trim();
  if (!raw) return "";
  const exact = activeSections().find(
    (sec) => String(sec.code || "").toLowerCase() === raw.toLowerCase()
  );
  if (exact?.code && (!normalizedTeacher || String(exact.ownerEmail || "").toLowerCase() === normalizedTeacher)) {
    return String(exact.code);
  }
  const display = sectionDisplayCode(raw).toLowerCase();
  const owned = activeSections().find((sec) => {
    const owner = String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase();
    return owner === normalizedTeacher && sectionDisplayCode(sec.code).toLowerCase() === display;
  });
  if (owned?.code) return String(owned.code);
  const embeddedOwner = extractEmailFromSectionCode(raw);
  if (embeddedOwner) return raw;
  return normalizedTeacher ? buildTeacherScopedSectionCode(raw, normalizedTeacher) : raw;
}
function sectionForCourseCode(courseCode, teacherEmail) {
  const raw = String(courseCode || "").trim();
  if (!raw) return null;
  const exact = activeSections().find(
    (sec) => String(sec.code || "").toLowerCase() === raw.toLowerCase()
  );
  if (exact) return exact;
  const owner = String(teacherEmail || extractEmailFromSectionCode(raw) || "").toLowerCase();
  const display = sectionDisplayCode(raw).toLowerCase();
  return activeSections().find((sec) => {
    if (sectionDisplayCode(sec.code).toLowerCase() !== display) return false;
    if (!owner) return true;
    return String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() === owner;
  }) || null;
}
function resolveJoinCodeCreationTarget(requestedCourseCode, teacherEmail) {
  const requester = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(normalizeArabicIndicDigits(String(requestedCourseCode || "")) || "").trim();
  if (!raw || raw.toLowerCase() === "all") {
    return {
      code: "",
      ownerEmail: "",
      error: "\u0627\u062E\u062A\u0631 \u0645\u0642\u0631\u0631\u0627\u064B \u0645\u062D\u062F\u062F\u0627\u064B \u0642\u0628\u0644 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0631\u0645\u0632. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0635\u062F\u0627\u0631 \u0631\u0645\u0632 \u0639\u0627\u0645 \u0628\u0644\u0627 \u0645\u0642\u0631\u0631."
    };
  }
  const exact = activeSections().find(
    (sec) => String(sec.code || "").toLowerCase() === raw.toLowerCase()
  );
  if (exact) {
    const ownerEmail = String(exact.ownerEmail || sectionOwnerEmail(exact.code)).toLowerCase();
    if (!isAdminEmail(requester) && ownerEmail !== requester) {
      return {
        code: "",
        ownerEmail: "",
        error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0635\u062F\u0627\u0631 \u0631\u0645\u0648\u0632 \u0644\u0634\u0639\u0628\u0629 \u064A\u0645\u0644\u0643\u0647\u0627 \u0623\u0633\u062A\u0627\u0630 \u0622\u062E\u0631."
      };
    }
    return { section: exact, code: String(exact.code), ownerEmail };
  }
  const display = sectionDisplayCode(raw).toLowerCase();
  const matches = activeSections().filter(
    (sec) => sectionDisplayCode(sec.code).toLowerCase() === display
  );
  const allowedMatches = isAdminEmail(requester) ? matches : matches.filter(
    (sec) => String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase() === requester
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
      error: "\u0631\u0642\u0645 \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0648\u062C\u0648\u062F \u0639\u0646\u062F \u0623\u0643\u062B\u0631 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630. \u0627\u062E\u062A\u0631 \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0645\u062D\u062F\u062F\u0629 \u0628\u062F\u0644\u0627\u064B \u0645\u0646 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0639\u0627\u0645."
    };
  }
  const scoped = resolveTeacherScopedCourseCode(raw, requester);
  const scopedSection = sectionForCourseCode(scoped, requester);
  if (scopedSection) {
    const ownerEmail = String(
      scopedSection.ownerEmail || sectionOwnerEmail(scopedSection.code)
    ).toLowerCase();
    return { section: scopedSection, code: String(scopedSection.code), ownerEmail };
  }
  return {
    code: "",
    ownerEmail: "",
    error: "\u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0645\u062D\u062F\u062F \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0623\u0648 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0644\u0625\u0635\u062F\u0627\u0631 \u0631\u0645\u0648\u0632 \u062F\u062E\u0648\u0644."
  };
}
function getTeacherOwnedEquivalentSections(courseCode, teacherEmail) {
  const ownerKey = String(teacherEmail || "").trim().toLowerCase();
  const raw = String(courseCode || "").trim();
  if (!ownerKey || !raw) return [];
  const display = sectionDisplayCode(raw).toLowerCase();
  return activeSections().filter((sec) => {
    const secOwner = String(sec.ownerEmail || sectionOwnerEmail(sec.code)).toLowerCase();
    if (secOwner !== ownerKey) return false;
    return String(sec.code || "").toLowerCase() === raw.toLowerCase() || sectionCodeEquivalent(sec.code, raw) || !!display && sectionDisplayCode(sec.code).toLowerCase() === display;
  });
}
function resolveActivationCourseForStudent(foundCode, student, teacherEmail) {
  const ownerKey = String(teacherEmail || joinCodeOwnerEmail(foundCode) || "").trim().toLowerCase();
  const adminOwnedGeneralCode = isAdminEmail(ownerKey) && [foundCode?.sectionCode, foundCode?.studentSection, foundCode?.courseCode].map((value) => String(value || "").trim().toLowerCase()).every((value) => !value || value === "all");
  const candidates = [
    foundCode?.sectionCode,
    foundCode?.studentSection,
    foundCode?.courseCode
  ];
  const sid = normalizeStudentId(student?.id || student?.idNumber || student?.studentId);
  const addCandidate = (value) => {
    const code = String(value || "").trim();
    if (code && code.toLowerCase() !== "all" && !candidates.some((c) => sectionCodeEquivalent(c, code))) candidates.push(code);
  };
  try {
    dbInstance.getAllowedStudents().forEach((row) => {
      if (normalizeStudentId(row?.idNumber || row?.id || row?.studentId) !== sid) return;
      const rowCourse = row?.sectionCode || row?.studentSection || row?.courseCode;
      if (!rowCourse) return;
      const rowOwner = sectionOwnerEmail(rowCourse);
      if (ownerKey && rowOwner && rowOwner !== ownerKey && !isAdminEmail(ownerKey)) return;
      addCandidate(rowCourse);
    });
  } catch {
  }
  if (adminOwnedGeneralCode) {
    const rosterCourses = dbInstance.getAllowedStudents().filter(
      (row) => normalizeStudentId(row?.idNumber || row?.id || row?.studentId) === sid
    ).map((row) => String(row?.sectionCode || row?.studentSection || row?.courseCode || "").trim()).filter(Boolean).filter(
      (code, index, arr) => arr.findIndex((other) => sectionCodeEquivalent(other, code)) === index
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
function activationCourseCodeOrFallback(foundCode, student, teacherEmail) {
  const resolved = resolveActivationCourseForStudent(foundCode, student, teacherEmail);
  if (resolved) return resolved;
  return String(
    foundCode?.sectionCode || foundCode?.studentSection || foundCode?.courseCode || student?.sectionCode || ""
  ).trim();
}
function migrateTeacherCourseCodeReferences(oldCode, newCode) {
  const from = String(oldCode || "").trim();
  const to = String(newCode || "").trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
  const fromDisplay = sectionDisplayCode(from).toLowerCase();
  const fromOwner = extractEmailFromSectionCode(from) || sectionOwnerEmail(from);
  const same = (value, row) => {
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
  const patchDirectCourseFields = (row) => {
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
  dbInstance.getStudents().forEach((student) => {
    patchDirectCourseFields(student);
    if (Array.isArray(student.activatedCourseCodes)) {
      student.activatedCourseCodes = student.activatedCourseCodes.map(
        (c) => same(c) ? to : c
      );
    }
    if (Array.isArray(student.enrollments)) {
      student.enrollments.forEach((entry) => patchDirectCourseFields(entry));
    }
    if (Array.isArray(student.courseEnrollments)) {
      student.courseEnrollments.forEach((entry) => patchDirectCourseFields(entry));
    }
    if (Array.isArray(student.lockedEnrollments)) {
      student.lockedEnrollments.forEach((entry) => patchDirectCourseFields(entry));
    }
    if (Array.isArray(student.suspendedEnrollments)) {
      student.suspendedEnrollments.forEach((entry) => patchDirectCourseFields(entry));
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
    dbInstance.getInAppNotifications()
  ].forEach((rows) => {
    if (Array.isArray(rows)) rows.forEach((row) => patchDirectCourseFields(row));
  });
  dbInstance.persist();
}
function teacherEmailFromRequest(req) {
  const verified = verifiedTeacherEmailFromSession(req);
  if (verified) return verified;
  return "";
}
function joinCodeOwnerEmail(code) {
  return String(
    code?.ownerEmail || code?.createdByEmail || sectionOwnerEmail(code?.studentSection || code?.sectionCode)
  ).toLowerCase();
}
function canAccessJoinCode(code, teacherEmail) {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  return isAdminEmail(normalized) || joinCodeOwnerEmail(code) === normalized;
}
function passwordResetOwnerEmail(item) {
  const explicit = String(
    item?.teacherEmail || item?.ownerEmail || item?.createdByEmail || ""
  ).toLowerCase();
  if (explicit) return explicit;
  return sectionOwnerEmail(item?.sectionCode || item?.courseCode);
}
function canAccessPasswordResetRequest(item, teacherEmail) {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  if (isAdminEmail(normalized)) return true;
  const owner = passwordResetOwnerEmail(item);
  if (owner === normalized || sectionOwnerEmail(item?.sectionCode || item?.courseCode) === normalized)
    return true;
  const student = dbInstance.getStudents().find((s) => String(s.id) === String(item?.studentId));
  if (student && teacherCanManageStudent(student, normalized)) return true;
  const allowed = dbInstance.getAllowedStudents().find((s) => String(s.idNumber) === String(item?.studentId));
  if (allowed?.sectionCode && sectionOwnerEmail(allowed.sectionCode) === normalized)
    return true;
  return false;
}
function teacherCanManageStudent(student, teacherEmail) {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  if (isAdminEmail(normalized)) return true;
  const courseCodes = getStudentDiscoveredCourseCodes(student);
  return courseCodes.some((code) => sectionOwnerEmail(code) === normalized);
}
function isDatabaseResetActivityLog(log) {
  const text = `${log?.action || ""} ${log?.details || ""} ${log?.message || ""}`;
  return /تطهير|تصفير|قاعدة البيانات|حذف بيانات الحساب|أكواد الدخول/.test(text);
}
function filterLogsForTeacher(email) {
  const normalized = String(email || "").toLowerCase();
  const logs = dbInstance.getActivityLogs().filter((log) => !isDatabaseResetActivityLog(log));
  if (!normalized || isAdminEmail(normalized)) return logs;
  const students = dbInstance.getStudents();
  return logs.filter((log) => {
    const actorEmail = String(
      log.actorEmail || log.teacherEmail || ""
    ).toLowerCase();
    if (!log.studentId) {
      if (actorEmail) return actorEmail === normalized;
      return String(log.details || "").toLowerCase().includes(normalized);
    }
    const student = students.find(
      (st) => String(st.id) === String(log.studentId)
    );
    return student ? sectionOwnerEmail(student.sectionCode) === normalized : sectionOwnerEmail(log.sectionCode) === normalized;
  });
}
var MIRAS_BACKUP_SCHEMA = "miras.full-fidelity.backup.v2";
function parseAllowedStudentsTextForBackup(value, fallbackSection = "") {
  return String(value || "").split(/\r?\n/).map((line) => {
    const [idNumber = "", name = "", sectionCode = fallbackSection] = line.split(",").map((part) => String(part || "").trim());
    return { idNumber, name, sectionCode };
  }).filter((row) => row.idNumber && row.name);
}
function backupCourseCode(item) {
  return String(
    item?.courseCode || item?.sectionCode || item?.studentSection || item?.section || ""
  ).trim();
}
function backupOwnerEmail(item) {
  const explicit = String(
    item?.ownerEmail || item?.createdByEmail || item?.teacherEmail || item?.createdBy || item?.actorEmail || ""
  ).trim().toLowerCase();
  if (explicit) return explicit;
  return sectionOwnerEmail(backupCourseCode(item));
}
function backupBelongsToTeacher(item, teacherEmail) {
  const normalized = String(teacherEmail || "").toLowerCase();
  if (!normalized) return false;
  const owner = backupOwnerEmail(item);
  return owner === normalized || sectionOwnerEmail(backupCourseCode(item)) === normalized;
}
function scopedBackupRows(rows, includeAll, teacherEmail) {
  return includeAll ? rows : rows.filter((row) => backupBelongsToTeacher(row, teacherEmail));
}
function buildMirasBackupPayload(teacherEmail, scope) {
  const includeAll = isAdminEmail(teacherEmail) && scope === "all";
  const snapshot = dbInstance.exportStateSnapshot();
  const allowedStudentsRows = scopedBackupRows(
    snapshot.allowedStudents || [],
    includeAll,
    teacherEmail
  );
  const data = {
    teacherSections: scopedBackupRows(
      snapshot.sections || [],
      includeAll,
      teacherEmail
    ),
    teacherStudents: scopedBackupRows(
      snapshot.students || [],
      includeAll,
      teacherEmail
    ),
    allowedStudentsRows,
    allowedStudentsText: allowedStudentsRows.map((row) => `${row.idNumber}, ${row.name}, ${row.sectionCode}`).join("\n"),
    teacherCreatedExams: scopedBackupRows(
      snapshot.teacherExams || [],
      includeAll,
      teacherEmail
    ),
    teacherProjects: scopedBackupRows(
      snapshot.teacherProjects || [],
      includeAll,
      teacherEmail
    ),
    teacherQuestions: scopedBackupRows(
      snapshot.questionBank || [],
      includeAll,
      teacherEmail
    ),
    teacherSubmissions: scopedBackupRows(
      snapshot.teacherSubmissions || [],
      includeAll,
      teacherEmail
    ),
    joinCodesList: scopedBackupRows(
      snapshot.joinCodes || [],
      includeAll,
      teacherEmail
    ),
    codeIntegrity: {
      attempts: scopedBackupRows(snapshot.codeAttempts || snapshot.integrityAttempts || [], includeAll, teacherEmail),
      suspiciousCodes: scopedBackupRows(snapshot.suspiciousCodes || [], includeAll, teacherEmail),
      tradingAlerts: scopedBackupRows(snapshot.tradingAlerts || [], includeAll, teacherEmail),
      batchIntelligence: scopedBackupRows(snapshot.batchIntelligence || [], includeAll, teacherEmail),
      caseFiles: scopedBackupRows(snapshot.caseFiles || [], includeAll, teacherEmail),
      teacherReports: scopedBackupRows(snapshot.teacherReports || [], includeAll, teacherEmail),
      dataHealth: snapshot.dataHealth || {}
    },
    systemLogs: includeAll ? snapshot.activityLogs || [] : filterLogsForTeacher(teacherEmail),
    passwordResetRequestsState: includeAll ? snapshot.passwordResetRequests || [] : (snapshot.passwordResetRequests || []).filter(
      (item) => backupBelongsToTeacher(item, teacherEmail)
    ),
    submissionLocks: {},
    accessStoppedIds: {},
    previewSubmissionGrades: {}
  };
  return {
    schema: MIRAS_BACKUP_SCHEMA,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    scope: includeAll ? "all" : "me",
    ownerEmail: teacherEmail,
    counts: Object.fromEntries(
      Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])
    ),
    data
  };
}
function prepareMirasImportData(rawPayload, targetOwnerEmail, preserveExistingOwners) {
  const data = rawPayload?.data && typeof rawPayload.data === "object" ? rawPayload.data : rawPayload;
  if (!data || typeof data !== "object") throw new Error("bad payload");
  const owner = String(targetOwnerEmail || "").trim().toLowerCase();
  const stamp = (item, fields = ["ownerEmail", "teacherEmail"]) => {
    const next = { ...item || {} };
    fields.forEach((field) => {
      if (!preserveExistingOwners || !next[field]) next[field] = owner;
    });
    return next;
  };
  const allowedFromText = parseAllowedStudentsTextForBackup(
    data.allowedStudentsText
  );
  const allowedStudentsRows = [
    ...Array.isArray(data.allowedStudentsRows) ? data.allowedStudentsRows : [],
    ...Array.isArray(data.allowedStudents) ? data.allowedStudents : [],
    ...allowedFromText
  ];
  return {
    ...data,
    teacherSections: Array.isArray(data.teacherSections || data.sections) ? (data.teacherSections || data.sections).map(
      (item) => stamp(item, ["ownerEmail"])
    ) : void 0,
    teacherStudents: Array.isArray(data.teacherStudents || data.students) ? data.teacherStudents || data.students : void 0,
    allowedStudentsRows,
    teacherCreatedExams: Array.isArray(
      data.teacherCreatedExams || data.teacherExams
    ) ? (data.teacherCreatedExams || data.teacherExams).map(
      (item) => stamp(item, ["createdBy", "teacherEmail"])
    ) : void 0,
    teacherProjects: Array.isArray(data.teacherProjects) ? data.teacherProjects.map(
      (item) => stamp(item, ["createdBy", "teacherEmail", "ownerEmail"])
    ) : void 0,
    teacherQuestions: Array.isArray(data.teacherQuestions || data.questionBank) ? (data.teacherQuestions || data.questionBank).map(
      (item) => stamp(item, ["teacherEmail"])
    ) : void 0,
    teacherSubmissions: Array.isArray(data.teacherSubmissions) ? data.teacherSubmissions.map(
      (item) => stamp(item, ["teacherEmail", "ownerEmail"])
    ) : void 0,
    joinCodesList: Array.isArray(data.joinCodesList || data.joinCodes) ? (data.joinCodesList || data.joinCodes).map(
      (item) => stamp(item, ["ownerEmail", "createdByEmail"])
    ) : void 0,
    systemLogs: Array.isArray(data.systemLogs || data.activityLogs) ? (data.systemLogs || data.activityLogs).map(
      (item) => stamp(item, ["teacherEmail", "actorEmail"])
    ) : void 0,
    passwordResetRequestsState: Array.isArray(
      data.passwordResetRequestsState || data.passwordResetRequests
    ) ? (data.passwordResetRequestsState || data.passwordResetRequests).map(
      (item) => stamp(item, ["teacherEmail"])
    ) : void 0
  };
}
function isExamReturnedForStudent(examId, studentId) {
  return dbInstance.getTeacherSubmissions().some(
    (item) => String(item.kind || "") === "exam" && String(item.activityId ?? "") === String(examId) && String(item.studentId ?? "") === String(studentId) && ["\u0645\u0639\u0627\u062F \u0644\u0644\u0637\u0627\u0644\u0628", "\u0645\u0639\u0627\u062F \u0644\u0643", "returned", "return", "reopened"].includes(
      String(item.status || "").trim().toLowerCase()
    )
  );
}
function getActiveReturnException(kind, activityId, studentId) {
  const normalizedKind = String(kind || "").toLowerCase() === "quiz" ? "exam" : String(kind || "").toLowerCase();
  const now = Date.now();
  const isExceptionCarryStatus = (status) => {
    const normalized = String(status || "").trim().toLowerCase();
    return normalized === EXAM_IN_PROGRESS_STATUS || ["\u0645\u0639\u0627\u062F \u0644\u0644\u0637\u0627\u0644\u0628", "\u0645\u0639\u0627\u062F \u0644\u0643", "returned", "return", "reopened"].includes(
      normalized
    );
  };
  const rows = dbInstance.getTeacherSubmissions().filter(
    (item) => String(item.kind || "").toLowerCase() === normalizedKind && String(item.activityId ?? "") === String(activityId) && String(item.studentId ?? "") === String(studentId) && isExceptionCarryStatus(item.status) && Number.isFinite(new Date(item.returnExceptionUntil || 0).getTime()) && new Date(item.returnExceptionUntil || 0).getTime() > now
  ).sort(
    (a, b) => new Date(b.returnedAt || b.updatedAt || b.submittedAt || 0).getTime() - new Date(a.returnedAt || a.updatedAt || a.submittedAt || 0).getTime()
  );
  return rows[0] || null;
}
function submissionIsLocked(item) {
  if (!item) return false;
  const status = String(item.status || "submitted");
  return status !== "returned" && status !== "started";
}
function validateSessionFingerprint(req, student) {
  const browser = req.headers["user-agent"] || "Unknown Browser";
  const ip = req.ip || "127.0.0.1";
  const sebPass = getValidSebPass(req, student);
  if (sebPass && isSebRequest(req)) {
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u062F\u062E\u0648\u0644 SEB \u0622\u0645\u0646",
      details: `\u062A\u0645 \u0627\u0644\u0633\u0645\u0627\u062D \u0628\u062F\u062E\u0648\u0644 Safe Exam Browser \u0628\u062C\u0644\u0633\u0629 \u0645\u0624\u0642\u062A\u0629 \u0644\u0644\u0645\u0642\u0631\u0631 ${sebPass.courseCode} \u0648\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 ${sebPass.examId} \u062F\u0648\u0646 \u0641\u0643 \u0642\u0641\u0644 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0623\u0635\u0644\u064A.`,
      ip,
      userAgent: browser,
      os: "Safe Exam Browser",
      browser: "SEB Pass",
      isViolationWarning: false
    });
    return { isValid: true };
  }
  const currentFingerprint = getRequestDeviceFingerprint(req);
  const currentDeviceToken = getRequestDeviceToken(req);
  const deviceBoundToOtherStudent = findStudentBoundToDevice(
    currentDeviceToken,
    currentFingerprint,
    student.id
  );
  if (deviceBoundToOtherStudent) {
    recordActivationAttempt(req, {
      code: student.activationCode || "LOGIN",
      student,
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062C\u0647\u0627\u0632 \u0645\u0631\u062A\u0628\u0637 \u0628\u0637\u0627\u0644\u0628 \u0622\u062E\u0631"
    });
    return {
      isValid: false,
      statusCode: 409,
      error: STUDENT_DEVICE_ALREADY_BOUND_ERROR
    };
  }
  if (student.pendingDeviceTransfer) {
    if (!currentDeviceToken) {
      return {
        isValid: false,
        statusCode: 400,
        error: "\u062A\u0639\u0630\u0651\u0631 \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632\u0643 \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u0623\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0644\u0645 \u064A\u0631\u0633\u0644 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u062C\u0647\u0627\u0632. \u062A\u0623\u0643\u062F \u0623\u0646\u0643 \u0644\u0627 \u062A\u0633\u062A\u062E\u062F\u0645 \u0648\u0636\u0639 \u0627\u0644\u062A\u0635\u0641\u062D \u0627\u0644\u062E\u0627\u0635/\u0627\u0644\u0645\u062A\u062E\u0641\u0651\u064A \u0648\u0623\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u064A\u0633\u0645\u062D \u0628\u062D\u0641\u0638 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0648\u0642\u0639\u060C \u062B\u0645 \u0623\u0639\u062F \u0641\u062A\u062D \u0645\u0650\u0631\u0627\u0633 \u0648\u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."
      };
    }
    const retiredTokens = Array.isArray(
      student.retiredDeviceTokens
    ) ? student.retiredDeviceTokens : [];
    const retiredFingerprints = Array.isArray(
      student.retiredDeviceFingerprints
    ) ? student.retiredDeviceFingerprints : [];
    const isRetiredOldDevice = retiredTokens.some(
      (t) => String(t || "").trim() && String(t).trim() === currentDeviceToken
    ) || retiredFingerprints.some(
      (f) => String(f || "").trim() && String(f).trim() === currentFingerprint
    );
    if (isRetiredOldDevice) {
      recordActivationAttempt(req, {
        code: student.activationCode || "DEVICE_TRANSFER",
        student,
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0642\u062F\u064A\u0645 \u0628\u0639\u062F \u0627\u0639\u062A\u0645\u0627\u062F \u0646\u0642\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F"
      });
      return {
        isValid: false,
        statusCode: 409,
        error: "\u062D\u0633\u0627\u0628\u0643 \u0641\u064A \u0648\u0636\u0639 \u0627\u0644\u0646\u0642\u0644 \u0644\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F. \u064A\u0631\u062C\u0649 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u062C\u0647\u0627\u0632\u0643 \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0646\u0642\u0644\u060C \u0644\u0623\u0646 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0642\u062F\u064A\u0645 \u0623\u0635\u0628\u062D \u0645\u0644\u063A\u064A\u0627\u064B."
      };
    }
    student.devices = [currentFingerprint];
    dbInstance.updateStudent(student.id, {
      devices: [currentFingerprint],
      pendingDeviceTransfer: false,
      retiredDeviceFingerprints: [],
      retiredDeviceTokens: []
    });
    const transferActivationCode = student.activationCode;
    if (transferActivationCode && isUnifiedJoinCode(transferActivationCode)) {
      const rec = dbInstance.getJoinCodes().find(
        (jc) => normalizeJoinCode(jc.code) === normalizeJoinCode(transferActivationCode)
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
            currentDeviceToken
          ),
          activationIp: ip || rec.activationIp || ""
        });
      }
    }
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F",
      details: `\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632/\u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u0644\u0637\u0627\u0644\u0628 ${student.name} \u0628\u0639\u062F \u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0639\u0644\u0649 \u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632\u060C \u0648\u0642\u064F\u0641\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u0639\u0644\u064A\u0647.`,
      ip,
      userAgent: browser,
      os: "\u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F",
      browser: "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632",
      isViolationWarning: false
    });
    return { isValid: true };
  }
  const activationCode = student.activationCode;
  if (activationCode && isUnifiedJoinCode(activationCode)) {
    const activationRecord = dbInstance.getJoinCodes().find(
      (jc) => normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode)
    );
    const lockedFingerprint = activationRecord?.activationDeviceFingerprint;
    const lockedDeviceToken = activationRecord?.activationDeviceToken;
    const lockedDeviceServerHash = String(activationRecord?.activationDeviceServerHash || "").trim();
    const currentDeviceServerHash = serverBoundDeviceHash(req, currentDeviceToken);
    if (activationRecord?.status === "used" && lockedDeviceServerHash && (!currentDeviceServerHash || lockedDeviceServerHash !== currentDeviceServerHash)) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0628\u062A\u0648\u0643\u0646 \u0645\u0646\u0633\u0648\u062E \u062F\u0648\u0646 \u0633\u0631 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0623\u0635\u0644\u064A",
        foundCode: activationRecord
      });
      return {
        isValid: false,
        statusCode: 409,
        error: "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0642\u0641\u0644 \u0639\u0644\u0649 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0623\u0635\u0644\u064A. \u0644\u0627 \u064A\u0643\u0641\u064A \u0646\u0633\u062E \u0627\u0644\u0643\u0648\u062F \u0623\u0648 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u062A\u0635\u0641\u062D\u061B \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632."
      };
    }
    if (activationRecord?.status === "used" && lockedDeviceToken && !currentDeviceToken) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0628\u062F\u0648\u0646 \u062A\u0648\u0643\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0645\u0641\u0639\u0651\u0644",
        foundCode: activationRecord
      });
      return {
        isValid: false,
        error: "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062A\u0639\u0631\u0641 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u0644\u0623\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0644\u0645 \u064A\u0631\u0633\u0644 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u062C\u0647\u0627\u0632. \u062A\u0623\u0643\u062F \u0623\u0646\u0643 \u0644\u0627 \u062A\u0633\u062A\u062E\u062F\u0645 \u0648\u0636\u0639 \u0627\u0644\u062A\u0635\u0641\u062D \u0627\u0644\u062E\u0627\u0635/\u0627\u0644\u0645\u062A\u062E\u0641\u0651\u064A \u0648\u0623\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u064A\u0633\u0645\u062D \u0628\u062D\u0641\u0638 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0648\u0642\u0639\u060C \u062B\u0645 \u0627\u0641\u062A\u062D \u0645\u0650\u0631\u0627\u0633 \u0648\u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649. \u0625\u0646 \u0643\u0646\u062A \u062A\u0646\u062A\u0642\u0644 \u0644\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F \u0641\u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \xAB\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632\xBB."
      };
    }
    if (activationRecord?.status === "used" && lockedDeviceToken && currentDeviceToken && lockedDeviceToken !== currentDeviceToken) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0645\u0646 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641 \u0639\u0646 \u062C\u0647\u0627\u0632 \u0627\u0644\u062A\u0641\u0639\u064A\u0644",
        foundCode: activationRecord
      });
      return {
        isValid: false,
        error: "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0633\u062C\u0644 \u0641\u064A \u062C\u0647\u0627\u0632 \u0622\u062E\u0631. \u0644\u0644\u062A\u0628\u062F\u064A\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 (\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632) \u062B\u0645 \u0633\u062C\u0644 \u062F\u062E\u0648\u0644\u0643 \u0647\u0646\u0627."
      };
    }
    if (activationRecord?.status === "used" && lockedDeviceToken && currentDeviceToken && lockedDeviceToken === currentDeviceToken && lockedFingerprint && !deviceFingerprintsMatch(lockedFingerprint, currentFingerprint)) {
      const lockedBrowserSegment = deviceFingerprintBrowserSegment(lockedFingerprint);
      const currentBrowserSegment = deviceFingerprintBrowserSegment(currentFingerprint);
      const isUpgradeToPwa = lockedBrowserSegment.endsWith("-browser") && currentBrowserSegment.endsWith("-pwa") && lockedBrowserSegment.split("-")[0] === currentBrowserSegment.split("-")[0];
      if (isUpgradeToPwa) {
        dbInstance.updateJoinCode(activationRecord.code, {
          activationDeviceFingerprint: currentFingerprint
        });
        student.devices = [currentFingerprint];
        dbInstance.updateStudent(student.id, { devices: [currentFingerprint] });
        dbInstance.addActivityLog({
          studentId: student.id,
          studentName: student.name,
          action: "\u062A\u0631\u0642\u064A\u0629 \u0625\u0644\u0649 \u062A\u0637\u0628\u064A\u0642 PWA",
          details: `\u062A\u0645\u062A \u062A\u0631\u0642\u064A\u0629 \u0648\u0636\u0639 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0644\u0637\u0627\u0644\u0628 ${student.name} \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0645\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0625\u0644\u0649 \u062A\u0637\u0628\u064A\u0642 PWA \u0627\u0644\u0645\u0639\u062A\u0645\u062F \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632.`,
          ip,
          userAgent: browser,
          os: "PWA Upgrade",
          browser: "\u0645\u0646\u0635\u0629 \u0645\u0650\u0631\u0627\u0633",
          isViolationWarning: false
        });
      } else {
        recordActivationAttempt(req, {
          code: activationCode,
          student,
          reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0628\u0646\u0641\u0633 \u062A\u0648\u0643\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0646 \u0645\u062A\u0635\u0641\u062D \u0645\u062E\u062A\u0644\u0641",
          foundCode: activationRecord
        });
        return {
          isValid: false,
          statusCode: 409,
          error: "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0642\u0641\u0644 \u0639\u0644\u0649 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0623\u0635\u0644\u064A. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0641\u062A\u062D\u0647 \u0645\u0646 \u0645\u062A\u0635\u0641\u062D \u0622\u062E\u0631 \u062D\u062A\u0649 \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632 \u0625\u0644\u0627 \u0628\u0639\u062F \u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0639\u0644\u0649 \u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632."
        };
      }
    }
    if (activationRecord?.status === "used" && lockedDeviceToken && currentDeviceToken && lockedDeviceToken === currentDeviceToken && lockedFingerprint && lockedFingerprint !== currentFingerprint && deviceFingerprintsMatch(lockedFingerprint, currentFingerprint)) {
      dbInstance.updateJoinCode(activationRecord.code, {
        activationDeviceFingerprint: currentFingerprint
      });
    }
    if (activationRecord?.status === "used" && !lockedDeviceToken && currentDeviceToken) {
      dbInstance.updateJoinCode(activationRecord.code, {
        activationDeviceToken: currentDeviceToken,
        activationDeviceServerHash: serverBoundDeviceHash(req, currentDeviceToken)
      });
    }
    if (activationRecord?.status === "used" && !lockedDeviceToken && lockedFingerprint && lockedFingerprint !== currentFingerprint) {
      recordActivationAttempt(req, {
        code: activationCode,
        student,
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0628\u0628\u0635\u0645\u0629 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641\u0629",
        foundCode: activationRecord
      });
      return {
        isValid: false,
        error: "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0633\u062C\u0644 \u0641\u064A \u062C\u0647\u0627\u0632 \u0622\u062E\u0631. \u0644\u0644\u062A\u0628\u062F\u064A\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 (\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632) \u062B\u0645 \u0633\u062C\u0644 \u062F\u062E\u0648\u0644\u0643 \u0647\u0646\u0627."
      };
    }
    if (activationRecord?.status === "used" && !lockedFingerprint) {
      dbInstance.updateJoinCode(activationRecord.code, {
        activationDeviceFingerprint: currentFingerprint
      });
    }
  }
  const fingerprintAlreadyBound = student.devices.some(
    (d) => deviceFingerprintsMatch(d, currentFingerprint)
  );
  if (fingerprintAlreadyBound) {
    const currentDevices = Array.isArray(student.devices) ? student.devices.map((d) => String(d || "").trim()).filter(Boolean) : [];
    if (currentDevices.length !== 1 || !currentDevices.some((d) => d === currentFingerprint)) {
      student.devices = [currentFingerprint];
      dbInstance.updateStudent(student.id, { devices: [currentFingerprint] });
    }
  }
  if (!fingerprintAlreadyBound) {
    if (student.devices.length >= 1) {
      return {
        isValid: false,
        error: `\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0633\u062C\u0644 \u0641\u064A \u062C\u0647\u0627\u0632 \u0622\u062E\u0631. \u0644\u0644\u062A\u0628\u062F\u064A\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 (\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632) \u062B\u0645 \u0633\u062C\u0644 \u062F\u062E\u0648\u0644\u0643 \u0647\u0646\u0627.`
      };
    }
    student.devices.push(currentFingerprint);
    dbInstance.updateStudent(student.id, { devices: student.devices });
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F",
      details: `\u062A\u0645 \u0631\u0628\u0637 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0648\u062D\u064A\u062F \u0644\u0644\u062D\u0633\u0627\u0628 \u0628\u0646\u062C\u0627\u062D: ${currentFingerprint}`,
      ip,
      userAgent: browser,
      os: "\u0645\u0643\u062A\u0634\u0641 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B",
      browser: "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u064A\u0628",
      isViolationWarning: false
    });
  }
  return { isValid: true };
}
app.post("/api/auth/forgot-password", (req, res) => {
  const idNumber = normalizeStudentId(req.body?.idNumber);
  if (!/^\d{4,}$/.test(idNumber))
    return res.status(400).json({ error: "\u0623\u062F\u062E\u0644 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0628\u0634\u0643\u0644 \u0635\u062D\u064A\u062D." });
  const student = dbInstance.getStudents().find((s) => String(s.id) === idNumber);
  const allowed = dbInstance.getAllowedStudents().find((s) => String(s.idNumber) === idNumber);
  const resetToken = import_crypto.default.randomBytes(24).toString("hex");
  const verificationCode = makeJoinCode(
    "LAB",
    "",
    /* @__PURE__ */ new Set([
      ...dbInstance.getPasswordResetRequests().map((item) => compactJoinCode(item.verificationCode)),
      ...dbInstance.getOtps().map((item) => compactJoinCode(item.code)),
      ...dbInstance.getJoinCodes().map((item) => compactJoinCode(item.code))
    ])
  );
  const requestedAt = /* @__PURE__ */ new Date();
  const expiresAt = new Date(requestedAt.getTime() + 60 * 60 * 1e3);
  const resetRequest = {
    id: `pr-${Date.now()}-${import_crypto.default.randomBytes(3).toString("hex")}`,
    studentId: idNumber,
    studentName: student?.name || allowed?.name || "\u063A\u064A\u0631 \u0645\u0633\u062C\u0644",
    studentEmail: student?.email,
    studentPhone: student?.phone || allowed?.phone || "",
    username: student?.email || idNumber,
    sectionCode: student?.sectionCode || allowed?.sectionCode,
    teacherEmail: student ? sectionOwnerEmail(student.sectionCode) : allowed ? sectionOwnerEmail(allowed.sectionCode) : void 0,
    resetToken,
    resetLink: buildResetLink(req, resetToken),
    verificationCode,
    status: "new",
    requestedAt: requestedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  dbInstance.addPasswordResetRequest(resetRequest);
  dbInstance.addActivityLog({
    studentId: idNumber,
    studentName: student?.name || allowed?.name || "\u063A\u064A\u0631 \u0645\u0633\u062C\u0644",
    action: "\u0637\u0644\u0628 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",
    details: student ? `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0631\u0627\u0628\u0637 \u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0645\u0624\u0642\u062A \u064A\u0646\u062A\u0647\u064A \u062E\u0644\u0627\u0644 \u0633\u0627\u0639\u0629 \u0648\u0627\u062D\u062F\u0629. \u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628: ${resetRequest.id}` : "\u0637\u0644\u0628 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644\u061B \u064A\u0644\u0632\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0643\u0634\u0641 \u0642\u0628\u0644 \u0625\u0635\u062F\u0627\u0631 \u0623\u064A \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631.",
    teacherEmail: student ? sectionOwnerEmail(student.sectionCode) : allowed ? sectionOwnerEmail(allowed.sectionCode) : void 0,
    actorEmail: student ? sectionOwnerEmail(student.sectionCode) : allowed ? sectionOwnerEmail(allowed.sectionCode) : void 0,
    sectionCode: student?.sectionCode || allowed?.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0627\u0644\u062F\u062E\u0648\u0644",
    browser: "\u0644\u0648\u062D\u0629 \u0627\u0644\u062F\u062E\u0648\u0644",
    isViolationWarning: false
  });
  notifyTeachersForSection(
    student?.sectionCode || allowed?.sectionCode,
    "\u0637\u0644\u0628 \u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631",
    `${resetRequest.studentName} \u0637\u0644\u0628 \u0631\u0627\u0628\u0637 \u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646`,
    { type: "password_reset", studentId: idNumber, link: "/" }
  );
  if (student)
    notifyStudent(
      student.id,
      "\u0631\u0627\u0628\u0637 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u062C\u0627\u0647\u0632",
      "\u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u0644\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0624\u0642\u062A \u0627\u0644\u0622\u0645\u0646.",
      { type: "password_reset_ready", link: "/" }
    );
  return res.json({
    success: true,
    message: "\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0637\u0644\u0628 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631. \u0633\u064A\u0638\u0647\u0631 \u0627\u0644\u0637\u0644\u0628 \u0641\u064A \u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062D\u0643\u0645 \u0645\u0639 \u0631\u0627\u0628\u0637 \u0645\u0624\u0642\u062A \u0622\u0645\u0646 \u064A\u0646\u062A\u0647\u064A \u062E\u0644\u0627\u0644 \u0633\u0627\u0639\u0629."
  });
});
app.post("/api/auth/reset-password", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const newPassword = String(req.body?.newPassword || "");
  if (!token || isWeakDefaultPassword(newPassword))
    return res.status(400).json({ error: "\u0627\u0644\u0631\u0627\u0628\u0637 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0642\u0635\u064A\u0631\u0629/\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629. \u0627\u062E\u062A\u0631 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0644\u0627 \u062A\u0642\u0644 \u0639\u0646 6 \u062E\u0627\u0646\u0627\u062A." });
  const requestItem = dbInstance.getPasswordResetRequests().find((item) => item.resetToken === token);
  if (!requestItem)
    return res.status(404).json({ error: "\u0631\u0627\u0628\u0637 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  if (requestItem.status !== "new" || new Date(requestItem.expiresAt).getTime() <= Date.now()) {
    dbInstance.updatePasswordResetRequest(requestItem.id, {
      status: requestItem.status === "new" ? "expired" : requestItem.status
    });
    return res.status(410).json({ error: "\u0631\u0627\u0628\u0637 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u0645\u0646\u062A\u0647\u064A \u0623\u0648 \u062A\u0645 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647 \u0633\u0627\u0628\u0642\u0627\u064B." });
  }
  const student = dbInstance.getStudents().find((s) => String(s.id) === String(requestItem.studentId));
  if (!student)
    return res.status(404).json({ error: "\u0644\u0627 \u064A\u0648\u062C\u062F \u062D\u0633\u0627\u0628 \u0637\u0627\u0644\u0628 \u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628." });
  const currentFingerprint = getRequestDeviceFingerprint(req);
  const currentDeviceToken = getRequestDeviceToken(req);
  const activationCode = student.activationCode;
  if (activationCode && isUnifiedJoinCode(activationCode)) {
    const activationRecord = dbInstance.getJoinCodes().find(
      (jc) => normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode)
    );
    const lockedDeviceToken = String(
      activationRecord?.activationDeviceToken || ""
    ).trim();
    const lockedFingerprint = String(
      activationRecord?.activationDeviceFingerprint || ""
    ).trim();
    if (activationRecord?.status === "used") {
      if (lockedDeviceToken && (!currentDeviceToken || lockedDeviceToken !== currentDeviceToken)) {
        recordActivationAttempt(req, {
          code: activationCode,
          student,
          reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0645\u0646 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641 \u0639\u0646 \u062C\u0647\u0627\u0632 \u0627\u0644\u062A\u0641\u0639\u064A\u0644",
          foundCode: activationRecord
        });
        return res.status(403).json({
          error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0645\u0646 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641. \u0627\u0641\u062A\u062D \u0631\u0627\u0628\u0637 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0630\u064A \u0627\u0633\u062A\u062E\u062F\u0645\u062A \u0641\u064A\u0647 \u0643\u0648\u062F \u0627\u0644\u062A\u0641\u0639\u064A\u0644."
        });
      }
      if (!lockedDeviceToken && lockedFingerprint && lockedFingerprint !== currentFingerprint) {
        recordActivationAttempt(req, {
          code: activationCode,
          student,
          reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0628\u0628\u0635\u0645\u0629 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641\u0629",
          foundCode: activationRecord
        });
        return res.status(403).json({
          error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0645\u0646 \u062C\u0647\u0627\u0632 \u0645\u062E\u062A\u0644\u0641. \u0627\u0641\u062A\u062D \u0631\u0627\u0628\u0637 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0630\u064A \u0627\u0633\u062A\u062E\u062F\u0645\u062A \u0641\u064A\u0647 \u0643\u0648\u062F \u0627\u0644\u062A\u0641\u0639\u064A\u0644."
        });
      }
    }
  }
  const usedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (isWeakDefaultPassword(newPassword)) {
    return res.status(400).json({ error: "\u0627\u062E\u062A\u0631 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0642\u0648\u064A\u0629 \u0644\u0627 \u062A\u0642\u0644 \u0639\u0646 6 \u062E\u0627\u0646\u0627\u062A \u0648\u0644\u0627 \u062A\u0633\u062A\u062E\u062F\u0645 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629." });
  }
  dbInstance.updateStudent(student.id, { passwordHash: hashPasswordSecure(newPassword) });
  dbInstance.updatePasswordResetRequest(requestItem.id, {
    status: "handled",
    usedAt,
    handledAt: usedAt
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",
    details: `\u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0637\u0627\u0644\u0628 \u0631\u0627\u0628\u0637 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0645\u0624\u0642\u062A \u0628\u0646\u062C\u0627\u062D. \u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628: ${requestItem.id}`,
    teacherEmail: sectionOwnerEmail(student.sectionCode),
    actorEmail: sectionOwnerEmail(student.sectionCode),
    sectionCode: student.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0627\u0644\u062F\u062E\u0648\u0644",
    browser: "\u0631\u0627\u0628\u0637 \u0622\u0645\u0646",
    isViolationWarning: false
  });
  notifyTeachersForSection(
    student.sectionCode,
    "\u062A\u0645 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0637\u0627\u0644\u0628",
    `${student.name} \u063A\u064A\u0651\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0639\u0628\u0631 \u0631\u0627\u0628\u0637 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0627\u0644\u0622\u0645\u0646.`,
    { type: "password_changed", studentId: student.id, link: "/" }
  );
  return res.json({
    success: true,
    message: "\u062A\u0645 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0628\u0646\u062C\u0627\u062D. \u064A\u0645\u0643\u0646\u0643 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0627\u0644\u0622\u0646."
  });
});
app.post("/api/teacher/upload-allowed", (req, res) => {
  const { studentsList } = req.body;
  if (!Array.isArray(studentsList)) {
    return res.status(400).json({ error: "\u062A\u0646\u0633\u064A\u0642 \u0643\u0634\u0641 \u0627\u0644\u0637\u0644\u0627\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" });
  }
  const teacherEmail = teacherEmailFromRequest(req);
  const targetSectionRaw = String(
    req.body?.sectionCode || studentsList[0]?.sectionCode || ""
  ).trim();
  const targetSection = resolveTeacherScopedCourseCode(targetSectionRaw, teacherEmail);
  if (!targetSection) {
    return res.status(400).json({ error: "\u064A\u062C\u0628 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0645\u0642\u0631\u0631 \u0642\u0628\u0644 \u0631\u0641\u0639 \u0643\u0634\u0641 \u0627\u0644\u0637\u0644\u0627\u0628" });
  }
  const invalid = studentsList.find(
    (s) => !String(s.name || "").trim() || !/^\d{4,}$/.test(normalizeStudentId(s.idNumber))
  );
  if (invalid) {
    return res.status(400).json({ error: "\u0643\u0644 \u0635\u0641 \u0641\u064A \u0627\u0644\u0643\u0634\u0641 \u064A\u062C\u0628 \u0623\u0646 \u064A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0627\u0633\u0645 \u0648\u0631\u0642\u0645 \u062C\u0627\u0645\u0639\u064A \u0648\u0627\u0636\u062D" });
  }
  const seenIds = /* @__PURE__ */ new Set();
  const duplicateInUpload = studentsList.find((s) => {
    const id = normalizeStudentId(s.idNumber);
    if (seenIds.has(id)) return true;
    seenIds.add(id);
    return false;
  });
  if (duplicateInUpload) {
    return res.status(400).json({
      error: `\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A ${normalizeStudentId(duplicateInUpload.idNumber)} \u0645\u0643\u0631\u0631 \u062F\u0627\u062E\u0644 \u0627\u0644\u0643\u0634\u0641. \u0627\u062D\u0630\u0641 \u0627\u0644\u062A\u0643\u0631\u0627\u0631 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u062D\u0641\u0638.`
    });
  }
  const previousRosterIds = new Set(
    dbInstance.getAllowedStudents().filter(
      (r) => sectionCodeEquivalent(r.sectionCode || r.studentSection || r.courseCode, targetSection)
    ).map((r) => normalizeStudentId(r.idNumber || r.id || r.studentId)).filter(Boolean)
  );
  dbInstance.clearAllowedStudentsBySection(targetSection);
  try {
    const rows = dbInstance.getAllowedStudents();
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const rowCourse = rows[i]?.sectionCode || rows[i]?.courseCode;
      const sameCourse = sectionCodeEquivalent(rowCourse, targetSection);
      const rowOwner = extractEmailFromSectionCode(rowCourse);
      if (sameCourse && (!rowOwner || rowOwner === teacherEmail)) rows.splice(i, 1);
    }
    dbInstance.persist();
  } catch {
  }
  studentsList.forEach((s) => {
    const normId = normalizeStudentId(s.idNumber);
    dbInstance.addAllowedStudent({
      idNumber: normId,
      name: String(s.name).trim(),
      sectionCode: targetSection,
      // نثبّت مالك الصف صراحةً حتى لا تعتمد المطابقات على استنتاج المالك من الكود فقط.
      teacherEmail
    });
    const registered = dbInstance.getStudents().find((st) => normalizeStudentId(st.id) === normId);
    if (registered) {
      const isNewCourseMembership = !previousRosterIds.has(normId);
      const restorePatch = {
        // تنظيف الدورة القديمة مطلوب فقط عند إضافة الطالب فعلياً بعد أن كان
        // خارج الكشف. إعادة حفظ الكشف نفسه لا يجوز أن تمس تفعيل الطالب الحالي.
        ...isNewCourseMembership ? buildCleanStudentCourseReaddPatch(registered, targetSection, teacherEmail) : {},
        name: String(s.name).trim(),
        courseVisibilitySyncedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      dbInstance.updateStudent(registered.id, restorePatch);
    }
  });
  try {
    const courseName = courseNameFromCode(targetSection);
    const enrollTitle = "\u062A\u0645\u062A \u0625\u0636\u0627\u0641\u062A\u0643 \u0644\u0645\u0642\u0631\u0631";
    const enrollBody = `\u062A\u0645\u062A \u0625\u0636\u0627\u0641\u062A\u0643 \u0625\u0644\u0649 \u0645\u0642\u0631\u0631 ${courseName}. \u0623\u062F\u062E\u0644 \u0643\u0648\u062F \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0646 \u062D\u0633\u0627\u0628\u0643 \u0644\u062A\u0641\u0639\u064A\u0644\u0647.`;
    studentsList.forEach((s) => {
      const sid = normalizeStudentId(s.idNumber);
      if (!sid || previousRosterIds.has(sid)) return;
      const reg = dbInstance.getStudents().find((st) => normalizeStudentId(st.id) === sid);
      if (!reg) return;
      const alreadyActive = getStudentActiveCourseCodes(reg).some(
        (c) => sectionCodeEquivalent(c, targetSection)
      );
      if (alreadyActive) return;
      notifyUsers(
        (token) => token.role === "student" && normalizeStudentId(token.userId) === sid,
        enrollTitle,
        enrollBody,
        { type: "course_enrolled", courseCode: targetSection, studentId: sid, link: "/" }
      );
      rememberInAppNotification({
        userId: sid,
        role: "student",
        sectionCode: targetSection,
        title: enrollTitle,
        body: enrollBody,
        type: "course_enrolled",
        data: { type: "course_enrolled", courseCode: targetSection, link: "/" }
      });
    });
  } catch {
  }
  return res.json({
    success: true,
    count: studentsList.length,
    sectionCode: targetSection,
    allowedStudents: dbInstance.getAllowedStudents()
  });
});
app.get("/api/teacher/allowed-students", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const includeAll = String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
  const allowedStudents = dbInstance.getAllowedStudents().filter(
    (row) => includeAll || sectionOwnerEmail(row.sectionCode) === teacherEmail || !teacherEmail
  );
  return res.json({ success: true, allowedStudents });
});
app.get("/api/auth/lookup-student/:id", (req, res) => {
  const normalizedIdNumber = normalizeStudentId(String(req.params.id || ""));
  const allowed = dbInstance.getAllowedStudents().find((s) => normalizeStudentId(s.idNumber) === normalizedIdNumber);
  if (!allowed) {
    return res.status(404).json({
      error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u063A\u064A\u0631 \u0645\u062F\u0631\u062C \u0641\u064A \u0643\u0634\u0648\u0641\u0627\u062A \u0623\u064A \u0645\u0642\u0631\u0631 \u0645\u0639\u062A\u0645\u062F. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0627\u062F\u0629 \u0644\u0625\u0636\u0627\u0641\u0629 \u0627\u0633\u0645\u0643 \u0641\u064A \u0643\u0634\u0641 \u0627\u0644\u0645\u0642\u0631\u0631."
    });
  }
  const section = sectionForCourseCode(allowed.sectionCode);
  return res.json({
    success: true,
    student: {
      idNumber: allowed.idNumber,
      name: allowed.name,
      sectionCode: allowed.sectionCode,
      courseName: section?.courseName || allowed.sectionCode
    }
  });
});
app.get("/api/teacher/student-lookup/:id", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  const normalizedIdNumber = normalizeStudentId(String(req.params.id || ""));
  if (!normalizedIdNumber) return res.status(400).json({ error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u063A\u064A\u0631 \u0648\u0627\u0636\u062D." });
  const requestedCourse = String(req.query.courseCode || req.query.sectionCode || "").trim();
  const allowed = dbInstance.getAllowedStudents().find((row) => {
    if (normalizeStudentId(row.idNumber || row.id || row.studentId) !== normalizedIdNumber) return false;
    if (!requestedCourse) return true;
    return allowedStudentMatchesCourse(row, normalizedIdNumber, requestedCourse, teacherEmail);
  }) || dbInstance.getAllowedStudents().find((row) => normalizeStudentId(row.idNumber || row.id || row.studentId) === normalizedIdNumber);
  const registered = dbInstance.getStudents().find((st) => normalizeStudentId(st.id || st.idNumber || st.studentId) === normalizedIdNumber);
  const name = String(allowed?.name || registered?.name || registered?.studentName || "").trim();
  if (!name) return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0633\u0645 \u0645\u062D\u0641\u0648\u0638 \u0644\u0647\u0630\u0627 \u0627\u0644\u0631\u0642\u0645." });
  return res.json({
    success: true,
    student: {
      idNumber: normalizedIdNumber,
      name,
      sectionCode: allowed?.sectionCode || registered?.sectionCode || requestedCourse || ""
    }
  });
});
app.post("/api/auth/test-reset-student", (req, res) => {
  const { studentId } = req.body;
  if (!studentId) {
    return res.status(400).json({ error: "\u064A\u0631\u062C\u0649 \u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A" });
  }
  const normId = normalizeStudentId(studentId);
  dbInstance.deleteStudentDataCompletely(normId);
  dbInstance.addActivityLog({
    studentId: normId,
    studentName: "\u0637\u0627\u0644\u0628 \u062A\u062C\u0631\u064A\u0628\u064A",
    action: "\u062A\u0635\u0641\u064A\u0631 \u062D\u0633\u0627\u0628 \u062A\u062C\u0631\u064A\u0628\u064A \u0628\u0627\u0644\u0643\u0627\u0645\u0644",
    details: `\u062A\u0645 \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 ${normId} \u0648\u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0631\u0645\u0648\u0632 \u0627\u0644\u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0647 \u0644\u062A\u062C\u0631\u0628\u0629 \u0627\u0644\u062A\u0633\u062C\u064A\u0644 \u0643\u0637\u0627\u0644\u0628 \u062C\u062F\u064A\u062F.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0637\u0648\u064A\u0631",
    browser: "\u0623\u062F\u0627\u0629 \u0627\u0644\u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A\u0629",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    message: `\u062A\u0645 \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062C\u0627\u0645\u0639\u064A ${normId} \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0648\u062A\u0641\u0631\u064A\u063A \u0631\u0645\u0648\u0632 \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0647 \u0628\u0646\u062C\u0627\u062D. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0622\u0646 \u062A\u0633\u062C\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u0643\u0637\u0627\u0644\u0628 \u062C\u062F\u064A\u062F \u062A\u0645\u0627\u0645\u0627\u064B!`
  });
});
app.post("/api/auth/register", (req, res) => {
  const { idNumber, name, semester, password } = req.body;
  const normalizedIdNumberForEmail = normalizeStudentId(idNumber);
  const email = normalizeArabicDigits(
    req.body.email || `${normalizedIdNumberForEmail || "student"}@paaet.edu.kw`
  ).trim().toLowerCase();
  if (!idNumber || !password) {
    return res.status(400).json({ error: "\u064A\u0631\u062C\u0649 \u062A\u0639\u0628\u0626\u0629 \u062C\u0645\u064A\u0639 \u0627\u0644\u062D\u0642\u0648\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629" });
  }
  if (isWeakDefaultPassword(password)) {
    return res.status(400).json({
      error: "\u0627\u062E\u062A\u0631 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0623\u0642\u0648\u0649 \u0642\u0628\u0644 \u0625\u062F\u062E\u0627\u0644 \u0643\u0648\u062F \u0627\u0644\u0645\u0642\u0631\u0631. \u0644\u0627 \u064A\u064F\u0633\u0645\u062D \u0628\u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629 \u0623\u0648 \u0623\u0642\u0644 \u0645\u0646 6 \u062E\u0627\u0646\u0627\u062A."
    });
  }
  if (req.body.email && !isValidEmailFormat(email)) {
    return res.status(400).json({ error: "\u0627\u0643\u062A\u0628 \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0628\u0635\u064A\u063A\u0629 \u0635\u062D\u064A\u062D\u0629 \u0642\u0628\u0644 \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629." });
  }
  if (req.body.email && !isValidPaaetEmail(email)) {
    return res.status(400).json({
      error: "\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0644\u0644\u0637\u0627\u0644\u0628 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0646\u062A\u0647\u064A \u0628\u0640 @paaet.edu.kw"
    });
  }
  const normalizedIdNumber = normalizeStudentId(idNumber);
  const allowed = dbInstance.getAllowedStudents().find((s) => normalizeStudentId(s.idNumber) === normalizedIdNumber);
  if (!allowed) {
    return res.status(400).json({
      error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u063A\u064A\u0631 \u0645\u062F\u0631\u062C \u0641\u064A \u0643\u0634\u0648\u0641\u0627\u062A \u0623\u064A \u0645\u0642\u0631\u0631 \u0645\u0639\u062A\u0645\u062F. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0627\u062F\u0629 \u0644\u0625\u0636\u0627\u0641\u0629 \u0627\u0633\u0645\u0643 \u0641\u064A \u0643\u0634\u0641 \u0627\u0644\u0645\u0642\u0631\u0631."
    });
  }
  const emailExists = dbInstance.getStudents().find(
    (s) => String(s.email || "").trim().toLowerCase() === email && normalizeStudentId(s.id) !== normalizedIdNumber
  );
  if (emailExists) {
    return res.status(400).json({
      error: "\u0647\u0630\u0627 \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0645\u0633\u062A\u062E\u062F\u0645 \u0641\u064A \u062D\u0633\u0627\u0628 \u0637\u0627\u0644\u0628 \u0622\u062E\u0631. \u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0643\u0631\u0627\u0631 \u0627\u0644\u0628\u0631\u064A\u062F \u0628\u064A\u0646 \u0623\u0643\u062B\u0631 \u0645\u0646 \u0637\u0627\u0644\u0628."
    });
  }
  const exists = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normalizedIdNumber);
  if (exists) {
    const accountActivated = !!exists.isActivated;
    if (accountActivated) {
      return res.status(409).json({
        error: "\u0644\u062F\u064A\u0643 \u062D\u0633\u0627\u0628 \u0645\u0641\u0639\u0644 \u0645\u0633\u0628\u0642\u064B\u0627. \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u064B\u0627\u060C \u062B\u0645 \u0623\u0636\u0641 \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u062C\u062F\u064A\u062F \u0645\u0646 \u062F\u0627\u062E\u0644 \u062D\u0633\u0627\u0628\u0643.",
        alreadyActivated: true,
        shouldLogin: true,
        email: exists.email || email
      });
    }
    if (!verifyPasswordFlexible(exists.passwordHash, password)) {
      return res.status(401).json({
        error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0645\u0633\u062C\u0644 \u0628\u0627\u0644\u0641\u0639\u0644 \u0648\u0644\u0643\u0646 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644. \u0623\u062F\u062E\u0644 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u0644\u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u062A\u0641\u0639\u064A\u0644."
      });
    }
    return res.json({
      success: true,
      message: "\u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0648\u062C\u0648\u062F \u0644\u0643\u0646\u0647 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644. \u0623\u062F\u062E\u0644 \u0643\u0648\u062F \u0627\u0644\u0645\u0642\u0631\u0631 \u0644\u0625\u0643\u0645\u0627\u0644 \u062A\u0641\u0639\u064A\u0644 \u062D\u0633\u0627\u0628\u0643.",
      email: exists.email || email,
      existingStudent: true,
      needsActivation: true
    });
  }
  return res.json({
    success: true,
    message: "\u062C\u0627\u0647\u0632 \u0644\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628",
    email
  });
});
app.post("/api/auth/verify-otp", (req, res) => {
  const { idNumber, name, semester, password } = req.body;
  const otp = String(req.body.otp || "").trim();
  if (!idNumber || !otp) {
    return res.status(400).json({ error: "\u0627\u0644\u0631\u062C\u0627\u0621 \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0648\u0631\u0645\u0632 \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645" });
  }
  return processStudentCourseActivation(req, res, idNumber, otp, {
    name,
    semester,
    password,
    email: req.body.email
  });
});
app.post("/api/auth/passkey/register/start", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const role = String(req.body?.role || "").toLowerCase();
    const userId = String(
      req.body?.userId || req.body?.idNumber || req.body?.email || ""
    ).trim();
    if (role !== "teacher" && role !== "student")
      return res.status(400).json({ error: "\u0646\u0648\u0639 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D." });
    const user = findPasskeyUser(role, userId);
    if (!user)
      return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u0635\u0645\u0629." });
    const existing = dbInstance.getPasskeyCredentials().filter(
      (item) => item.role === role && String(item.userId).toLowerCase() === String(user.id).toLowerCase()
    );
    const rpID = getPasskeyRpId(req);
    const options = await (0, import_server.generateRegistrationOptions)({
      rpName: PASSKEY_RP_NAME,
      rpID,
      userName: role === "teacher" ? String(user.raw.email || user.id) : String(user.id),
      userID: passkeyUserHandle(role, String(user.id)),
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: existing.map((item) => ({
        id: item.credentialId,
        transports: item.transports
      })),
      authenticatorSelection: {
        // passkey حقيقي قابل للاكتشاف (resident) حتى يفتح Face ID / Touch ID مباشرة
        // بدون اختيار "use passcode" في كل مرة. مدعوم من كل أجهزة البصمة الحديثة.
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
        authenticatorAttachment: "platform"
      },
      preferredAuthenticatorType: "localDevice",
      timeout: 6e4
    });
    pendingPasskeyRegistrations.set(options.challenge, {
      userId: String(user.id),
      role,
      challenge: options.challenge,
      startedAt: Date.now(),
      deviceToken: String(req.body?.deviceToken || "")
    });
    return res.json({ success: true, options });
  } catch (e) {
    console.error("passkey register start failed", e);
    return res.status(500).json({ error: "\u062A\u0639\u0630\u0631 \u0628\u062F\u0621 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u0635\u0645\u0629 \u062D\u0627\u0644\u064A\u0627\u064B." });
  }
});
app.post("/api/auth/passkey/register/finish", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const response = req.body?.response;
    if (!response)
      return res.status(400).json({ error: "\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0627\u0644\u0628\u0635\u0645\u0629 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629." });
    let matchedChallenge = "";
    const verification = await (0, import_server.verifyRegistrationResponse)({
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
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo || !matchedChallenge) {
      return res.status(400).json({ error: "\u0644\u0645 \u064A\u0643\u062A\u0645\u0644 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u0635\u0645\u0629." });
    }
    const pending = pendingPasskeyRegistrations.get(matchedChallenge);
    if (!pending)
      return res.status(400).json({ error: "\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0637\u0644\u0628 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u0635\u0645\u0629." });
    pendingPasskeyRegistrations.delete(matchedChallenge);
    const user = findPasskeyUser(pending.role, pending.userId);
    if (!user) return res.status(404).json({ error: "\u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0645 \u064A\u0639\u062F \u0645\u062A\u0627\u062D\u0627\u064B." });
    const credential = verification.registrationInfo.credential;
    dbInstance.upsertPasskeyCredential({
      id: `${pending.role}-${user.id}-${credential.id}`,
      userId: String(user.id),
      userName: user.name,
      role: pending.role,
      credentialId: credential.id,
      publicKey: Array.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      deviceToken: pending.deviceToken || getRequestDeviceToken(req),
      userAgent: String(req.headers["user-agent"] || ""),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    dbInstance.addActivityLog({
      studentId: pending.role === "student" ? String(user.id) : void 0,
      studentName: user.name,
      actorEmail: pending.role === "teacher" ? String(user.raw.email || user.id) : void 0,
      teacherEmail: pending.role === "teacher" ? String(user.raw.email || user.id) : void 0,
      action: pending.role === "teacher" ? "\u062A\u0641\u0639\u064A\u0644 \u0628\u0635\u0645\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630" : "\u062A\u0641\u0639\u064A\u0644 \u0628\u0635\u0645\u0629 \u0627\u0644\u0637\u0627\u0644\u0628",
      details: "\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 Passkey/Face ID \u0644\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u062A\u0635\u0641\u062D",
      browser: "Passkey",
      isViolationWarning: false
    });
    return res.json({
      success: true,
      message: "\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.",
      role: pending.role,
      userId: String(user.id),
      userName: user.name
    });
  } catch (e) {
    console.error("passkey register finish failed", e);
    return res.status(400).json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0628\u0635\u0645\u0629. \u062D\u0627\u0648\u0644 \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u062C\u0647\u0627\u0632 \u0648\u0627\u0644\u0645\u062A\u0635\u0641\u062D." });
  }
});
app.post("/api/auth/passkey/status", (req, res) => {
  try {
    const role = String(req.body?.role || "").toLowerCase();
    const userId = String(
      req.body?.userId || req.body?.idNumber || req.body?.email || ""
    ).trim();
    if (role !== "teacher" && role !== "student")
      return res.status(400).json({ error: "\u0646\u0648\u0639 \u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D." });
    const user = findPasskeyUser(role, userId);
    if (!user) return res.status(404).json({ error: "\u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
    const enabled = dbInstance.getPasskeyCredentials().some(
      (item) => item.role === role && String(item.userId || "").toLowerCase() === String(user.id || "").toLowerCase()
    );
    return res.json({
      success: true,
      enabled,
      role,
      userId: String(user.id),
      userName: user.name
    });
  } catch (e) {
    console.error("passkey status failed", e);
    return res.status(500).json({ error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062D\u0627\u0644\u0629 \u0627\u0644\u0628\u0635\u0645\u0629 \u062D\u0627\u0644\u064A\u0627\u064B." });
  }
});
app.get("/api/auth/passkey/devices", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !isAdminEmail(teacherEmail))
    return res.status(403).json({ error: "\u0647\u0630\u0647 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0644\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646 \u0641\u0642\u0637." });
  const devices = dbInstance.getPasskeyCredentials().map((item) => ({
    credentialId: item.credentialId,
    role: item.role,
    userId: item.userId,
    userName: item.userName,
    deviceType: item.deviceType,
    backedUp: item.backedUp,
    deviceLabel: passkeyDeviceLabel(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastUsedAt: item.lastUsedAt
  }));
  return res.json({ success: true, devices });
});
app.delete("/api/auth/passkey/devices/:credentialId", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !isAdminEmail(teacherEmail))
    return res.status(403).json({ error: "\u0647\u0630\u0647 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0644\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646 \u0641\u0642\u0637." });
  const credentialId = String(req.params.credentialId || "");
  const saved = dbInstance.getPasskeyCredentials().find((item) => item.credentialId === credentialId);
  if (!saved) return res.status(404).json({ error: "\u0627\u0644\u062C\u0647\u0627\u0632 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const ok = dbInstance.deletePasskeyCredential(credentialId);
  if (!ok) return res.status(404).json({ error: "\u0627\u0644\u062C\u0647\u0627\u0632 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  dbInstance.addActivityLog({
    studentId: saved.role === "student" ? saved.userId : void 0,
    studentName: saved.userName,
    actorEmail: teacherEmail,
    teacherEmail,
    action: "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u062C\u0647\u0627\u0632 \u0645\u0648\u062B\u0648\u0642",
    details: `\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u062B\u0642\u0629 \u062C\u0647\u0627\u0632 \u0628\u0635\u0645\u0629 \u0644\u062D\u0633\u0627\u0628 ${saved.userName || saved.userId}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646",
    browser: "Passkey",
    isViolationWarning: false
  });
  return res.json({ success: true, message: "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u062B\u0642\u0629 \u0627\u0644\u062C\u0647\u0627\u0632." });
});
app.post("/api/auth/passkey/recovery-reset", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !isAdminEmail(teacherEmail))
    return res.status(403).json({ error: "\u0647\u0630\u0647 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0644\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646 \u0641\u0642\u0637." });
  const role = String(req.body?.role || "").toLowerCase();
  const userId = normalizeArabicDigits(String(req.body?.userId || req.body?.idNumber || req.body?.email || "")).trim();
  if (role !== "teacher" && role !== "student")
    return res.status(400).json({ error: "\u062D\u062F\u062F \u0646\u0648\u0639 \u0627\u0644\u062D\u0633\u0627\u0628 \u0642\u0628\u0644 \u062A\u0647\u064A\u0626\u0629 \u0627\u0644\u0628\u0635\u0645\u0629." });
  const user = findPasskeyUser(role, userId);
  if (!user) return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0637\u0644\u0648\u0628." });
  const before = dbInstance.getPasskeyCredentials().filter(
    (item) => item.role === role && String(item.userId || "").toLowerCase() === String(user.id || "").toLowerCase()
  );
  before.forEach((item) => dbInstance.deletePasskeyCredential(item.credentialId));
  dbInstance.addActivityLog({
    studentId: role === "student" ? String(user.id) : void 0,
    studentName: user.name,
    actorEmail: teacherEmail,
    teacherEmail,
    action: role === "teacher" ? "\u062A\u0647\u064A\u0626\u0629 \u0628\u0635\u0645\u0629 \u0645\u0639\u0644\u0645" : "\u062A\u0647\u064A\u0626\u0629 \u0628\u0635\u0645\u0629 \u0637\u0627\u0644\u0628",
    details: `\u062A\u0645\u062A \u062A\u0647\u064A\u0626\u0629 \u0627\u0644\u0628\u0635\u0645\u0629 \u0644\u062D\u0633\u0627\u0628 ${user.name || user.id} \u0628\u0639\u062F \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0647\u0648\u064A\u0629\u061B \u064A\u0633\u062A\u0637\u064A\u0639 \u0635\u0627\u062D\u0628 \u0627\u0644\u062D\u0633\u0627\u0628 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u062B\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u0635\u0645\u0629 \u0645\u0646 \u062C\u0647\u0627\u0632\u0647 \u0645\u0646 \u062C\u062F\u064A\u062F.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646",
    browser: "Passkey",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    removed: before.length,
    message: before.length ? `\u062A\u0645\u062A \u062A\u0647\u064A\u0626\u0629 \u0627\u0644\u0628\u0635\u0645\u0629 \u0648\u0625\u0644\u063A\u0627\u0621 ${before.length} \u062C\u0647\u0627\u0632 \u0645\u0648\u062B\u0648\u0642. \u0627\u0637\u0644\u0628 \u0645\u0646 \u0635\u0627\u062D\u0628 \u0627\u0644\u062D\u0633\u0627\u0628 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u062B\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u0635\u0645\u0629 \u0645\u0646 \u062C\u062F\u064A\u062F.` : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u0635\u0645\u0629 \u0645\u062D\u0641\u0648\u0638\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u062D\u0627\u0644\u064A\u0627\u064B\u061B \u064A\u0633\u062A\u0637\u064A\u0639 \u0635\u0627\u062D\u0628 \u0627\u0644\u062D\u0633\u0627\u0628 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u0635\u0645\u0629 \u0628\u0639\u062F \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631."
  });
});
app.post("/api/auth/passkey/login/start", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const roleRaw = String(req.body?.role || "").toLowerCase();
    const role = roleRaw === "teacher" || roleRaw === "student" ? roleRaw : void 0;
    const credentials = dbInstance.getPasskeyCredentials().filter((item) => !role || item.role === role);
    if (!credentials.length)
      return res.status(404).json({ error: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u0635\u0645\u0629 \u0645\u0641\u0639\u0651\u0644\u0629 \u0628\u0639\u062F \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0646\u0638\u0627\u0645." });
    const options = await (0, import_server.generateAuthenticationOptions)({
      rpID: getPasskeyRpId(req),
      // قائمة فارغة = تدفّق passkey "قابل للاكتشاف": يفتح Face ID مباشرة دون نافذة
      // "Use Passkey" واختيار الحساب. يتطلب أن تكون البصمة مسجّلة كـ resident
      // (انظر residentKey: "required" في التسجيل) — فيُعاد تفعيل البصمة مرة واحدة بعد التحديث.
      allowCredentials: [],
      userVerification: "required",
      timeout: 6e4
    });
    pendingPasskeyAuthentications.set(options.challenge, {
      challenge: options.challenge,
      startedAt: Date.now(),
      role
    });
    return res.json({ success: true, options });
  } catch (e) {
    console.error("passkey login start failed", e);
    return res.status(500).json({ error: "\u062A\u0639\u0630\u0631 \u0628\u062F\u0621 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629 \u062D\u0627\u0644\u064A\u0627\u064B." });
  }
});
app.post("/api/auth/passkey/login/finish", async (req, res) => {
  try {
    cleanupPasskeyChallenges();
    const response = req.body?.response;
    if (!response?.id)
      return res.status(400).json({ error: "\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629." });
    const saved = dbInstance.getPasskeyCredentials().find((item) => item.credentialId === response.id);
    if (!saved)
      return res.status(404).json({ error: "\u0647\u0630\u0647 \u0627\u0644\u0628\u0635\u0645\u0629 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644\u0629 \u0641\u064A \u0645\u0650\u0631\u0627\u0633." });
    let matchedChallenge = "";
    const verification = await (0, import_server.verifyAuthenticationResponse)({
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
      requireUserVerification: true
    });
    if (!verification.verified || !matchedChallenge)
      return res.status(401).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0628\u0635\u0645\u0629." });
    pendingPasskeyAuthentications.delete(matchedChallenge);
    dbInstance.updatePasskeyCredential(saved.credentialId, {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: (/* @__PURE__ */ new Date()).toISOString(),
      userAgent: String(req.headers["user-agent"] || ""),
      deviceToken: getRequestDeviceToken(req) || saved.deviceToken
    });
    const user = findPasskeyUser(saved.role, saved.userId);
    if (!user)
      return res.status(404).json({ error: "\u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0631\u062A\u0628\u0637 \u0628\u0627\u0644\u0628\u0635\u0645\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
    try {
      dbInstance.addActivityLog({
        studentId: saved.role === "student" ? String(user.id) : void 0,
        studentName: user.name,
        actorEmail: saved.role === "teacher" ? String(user.raw.email || user.id) : void 0,
        teacherEmail: saved.role === "teacher" ? String(user.raw.email || user.id) : void 0,
        action: "\u062A\u0645 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629",
        details: "\u062A\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0639\u0628\u0631 Passkey/Face ID \u0628\u0646\u062C\u0627\u062D.",
        ip: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "Unknown",
        os: "\u0645\u062A\u0635\u0641\u062D",
        browser: "Passkey",
        isViolationWarning: false
      });
    } catch {
    }
    const payload = responseForPasskeyUser(req, saved, user);
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
  } catch (e) {
    console.error("passkey login finish failed", e);
    try {
      const response = req.body?.response;
      const saved = response?.id ? dbInstance.getPasskeyCredentials().find((item) => item.credentialId === response.id) : null;
      dbInstance.addActivityLog({
        studentId: saved?.role === "student" ? saved.userId : void 0,
        studentName: saved?.userName || "\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0635\u0645\u0629",
        actorEmail: saved?.role === "teacher" ? saved.userId : void 0,
        teacherEmail: saved?.role === "teacher" ? saved.userId : void 0,
        action: "\u0641\u0634\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629",
        details: String(e?.message || "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0628\u0635\u0645\u0629"),
        ip: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "Unknown",
        os: "\u0645\u062A\u0635\u0641\u062D",
        browser: "Passkey",
        isViolationWarning: false
      });
    } catch {
    }
    const msg = String(e?.message || "");
    const smart = msg.includes("\u0627\u0646\u062A\u0647\u062A") || msg.toLowerCase().includes("challenge") ? "\u0623\u0639\u062F \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0644\u062A\u062C\u062F\u064A\u062F \u0627\u0644\u0628\u0635\u0645\u0629." : "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0627\u0644\u0628\u0635\u0645\u0629. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0645 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631.";
    return res.status(Number(e?.statusCode || 401)).json({ error: smart });
  }
});
var loginAttemptBuckets = /* @__PURE__ */ new Map();
var LOGIN_WINDOW_MS = 10 * 60 * 1e3;
var LOGIN_MAX_FAILS = 8;
var LOGIN_BLOCK_MS = 10 * 60 * 1e3;
function loginRateKey(req, identity) {
  return `${req.ip || "127.0.0.1"}:${String(identity || "").toLowerCase()}`;
}
function checkLoginRateLimit(req, identity) {
  const b = loginAttemptBuckets.get(loginRateKey(req, identity));
  if (b && b.blockedUntil > Date.now()) {
    return {
      limited: true,
      retryAfterSeconds: Math.ceil((b.blockedUntil - Date.now()) / 1e3)
    };
  }
  return { limited: false, retryAfterSeconds: 0 };
}
function recordLoginFailure(req, identity) {
  const key = loginRateKey(req, identity);
  const now = Date.now();
  let b = loginAttemptBuckets.get(key);
  if (!b || now - b.firstAt > LOGIN_WINDOW_MS)
    b = { count: 0, firstAt: now, blockedUntil: 0 };
  b.count += 1;
  if (b.count >= LOGIN_MAX_FAILS) b.blockedUntil = now + LOGIN_BLOCK_MS;
  loginAttemptBuckets.set(key, b);
}
function recordLoginSuccess(req, identity) {
  loginAttemptBuckets.delete(loginRateKey(req, identity));
}
function hashPasswordSecure(password, salt = import_crypto.default.randomBytes(16).toString("hex")) {
  const key = import_crypto.default.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt:${salt}:${key}`;
}
function verifyPasswordFlexible(stored, submitted) {
  const clean = String(submitted || "").trim();
  const saved = String(stored || "");
  if (saved.startsWith("scrypt:")) {
    const [, salt, key] = saved.split(":");
    if (!salt || !key) return false;
    const candidate = import_crypto.default.scryptSync(clean, salt, 64).toString("hex");
    try {
      return import_crypto.default.timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(candidate, "hex"));
    } catch {
      return false;
    }
  }
  if (saved.startsWith("sha256:")) {
    const candidate = "sha256:" + import_crypto.default.createHash("sha256").update(clean).digest("hex");
    return saved === candidate;
  }
  return saved === clean;
}
function isWeakDefaultPassword(password) {
  const v = String(password || "").trim();
  return !v || v === "123456" || v === "000000" || v.length < 6;
}
app.post("/api/auth/login", (req, res) => {
  const { idNumber, password } = req.body;
  if (!idNumber || !password) {
    return res.status(400).json({ error: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0648\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631" });
  }
  const identity = String(idNumber).trim();
  const loginLimit = checkLoginRateLimit(req, identity);
  if (loginLimit.limited) {
    res.setHeader("Retry-After", String(loginLimit.retryAfterSeconds));
    return res.status(429).json({
      error: `\u0645\u062D\u0627\u0648\u0644\u0627\u062A \u062F\u062E\u0648\u0644 \u0643\u062B\u064A\u0631\u0629. \u062D\u0627\u0648\u0644 \u0628\u0639\u062F ${Math.ceil(loginLimit.retryAfterSeconds / 60)} \u062F\u0642\u064A\u0642\u0629.`
    });
  }
  const cleanPassword = String(password).trim();
  const normalizedIdentity = normalizeArabicDigits(identity).trim().toLowerCase();
  const digitsIdentity = normalizeStudentId(identity);
  const fixedTeacherLogins = {
    "ah.alfailakawi@paaet.edu.kw": {
      id: "ah.alfailakawi@paaet.edu.kw",
      email: "ah.alfailakawi@paaet.edu.kw",
      name: "\u062F. \u0623\u062D\u0645\u062F \u062D\u0633\u064A\u0646 \u0627\u0644\u0641\u064A\u0644\u0643\u0627\u0648\u064A",
      role: "admin",
      isActive: true,
      passwordHash: "sha256:2a57b6d36e9831b0453f9c25e37250c9752f318a63ef38dfd51027bb8091cc25"
    },
    "ada.alenezi@paaet.edu.kw": {
      id: "ada.alenezi@paaet.edu.kw",
      email: "ada.alenezi@paaet.edu.kw",
      name: "\u062F. \u0639\u0628\u062F\u0627\u0644\u0639\u0632\u064A\u0632 \u062F\u062E\u064A\u0644 \u0627\u0644\u0639\u0646\u0632\u064A",
      role: "teacher",
      isActive: true,
      passwordHash: "sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678"
    }
  };
  const fixedTeacher = fixedTeacherLogins[normalizedIdentity];
  if (fixedTeacher && verifyPasswordFlexible(fixedTeacher.passwordHash, cleanPassword) && fixedTeacher.isActive) {
    recordLoginSuccess(req, identity);
    const effectiveRole = isAdminEmail(fixedTeacher.email) ? "admin" : fixedTeacher.role || "teacher";
    const authToken2 = createTeacherAuthPayload(req, res, { ...fixedTeacher, role: effectiveRole });
    return res.json({
      success: true,
      role: effectiveRole,
      authToken: authToken2,
      teacher: {
        id: fixedTeacher.id,
        name: fixedTeacher.name,
        email: fixedTeacher.email,
        role: effectiveRole,
        authToken: authToken2
      }
    });
  }
  const teacher = dbInstance.getTeachers().find((t) => {
    const aliases = [
      t.email,
      t.id,
      t.phone,
      t.mobile,
      ...Array.isArray(t.loginAliases) ? t.loginAliases : []
    ].map((value) => normalizeArabicDigits(String(value || "")).trim().toLowerCase()).filter(Boolean);
    return aliases.some((alias) => {
      if (alias === normalizedIdentity) return true;
      const aliasDigits = normalizeStudentId(alias);
      return !!digitsIdentity && !!aliasDigits && aliasDigits === digitsIdentity;
    });
  });
  if (teacher) {
    const teacherPasswordMatches = verifyPasswordFlexible(teacher.passwordHash, cleanPassword);
    if (!teacherPasswordMatches || !teacher.isActive) {
      recordLoginFailure(req, identity);
      return res.status(401).json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" });
    }
    recordLoginSuccess(req, identity);
    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: "\u062F\u062E\u0648\u0644 \u0623\u0633\u062A\u0627\u0630",
      details: `\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 ${teacher.email}`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u062A\u0635\u0641\u062D",
      browser: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
      isViolationWarning: false
    });
    const effectiveRole = isAdminEmail(teacher.email) ? "admin" : teacher.role || "teacher";
    const authToken2 = createTeacherAuthPayload(req, res, { ...teacher, role: effectiveRole });
    return res.json({
      success: true,
      role: effectiveRole,
      authToken: authToken2,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        role: effectiveRole,
        authToken: authToken2
      }
    });
  }
  const student = /^\d+$/.test(digitsIdentity) ? dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === digitsIdentity) : null;
  if (!student) {
    recordLoginFailure(req, identity);
    return res.status(401).json({ error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" });
  }
  if (!verifyPasswordFlexible(student.passwordHash, cleanPassword)) {
    recordLoginFailure(req, identity);
    return res.status(401).json({ error: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" });
  }
  recordLoginSuccess(req, identity);
  if (student.isAccessBlocked) {
    return res.status(403).json({
      error: student.accessBlockReason || "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0624\u0642\u062A\u0627\u064B \u0645\u0646 \u0642\u0628\u0644 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
    });
  }
  const sebLoginPass = isSebRequest(req) ? getValidSebPass(req, student) : null;
  const sessionValidation = validateSessionFingerprint(req, student);
  if (!sessionValidation.isValid && !sebLoginPass) {
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u0627\u0646\u062A\u0647\u0627\u0643 \u0627\u0644\u0623\u062C\u0647\u0632\u0629",
      details: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0641\u0627\u0634\u0644\u0629 \u0628\u0633\u0628\u0628 \u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u0623\u062C\u0647\u0632\u0629 (\u062C\u0647\u0627\u0632 \u062B\u0627\u0644\u062B)",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u062C\u0647\u0648\u0644",
      browser: "\u0645\u062C\u0647\u0648\u0644",
      isViolationWarning: true
    });
    notifyTeachersForSection(
      student.sectionCode,
      "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0645\u0631\u0641\u0648\u0636\u0629",
      `${student.name}: ${sessionValidation.error || "\u0645\u062E\u0627\u0644\u0641\u0629 \u0623\u062C\u0647\u0632\u0629"}`,
      { type: "login_blocked", studentId: student.id, link: "/" }
    );
    return res.status(sessionValidation.statusCode || 403).json({ error: sessionValidation.error });
  }
  if (!sessionValidation.isValid && sebLoginPass) {
    consumeSebPass(sebLoginPass);
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u062F\u062E\u0648\u0644 SEB \u0628\u062A\u0635\u0631\u064A\u062D \u0645\u0624\u0642\u062A",
      details: `\u062A\u0645 \u0627\u0644\u0633\u0645\u0627\u062D \u0644\u0644\u0637\u0627\u0644\u0628 \u0628\u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 Safe Exam Browser \u0644\u0644\u0627\u062E\u062A\u0628\u0627\u0631 ${sebLoginPass.examId} \u0641\u064A \u0645\u0642\u0631\u0631 ${sebLoginPass.courseCode} \u062F\u0648\u0646 \u0641\u0643 \u0631\u0628\u0637 \u062C\u0647\u0627\u0632\u0647 \u0627\u0644\u0623\u0635\u0644\u064A.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "SEB",
      browser: "SEB Pass",
      isViolationWarning: false
    });
  }
  const loginGhostPatch = pruneGhostCoursePatch(student) || {};
  dbInstance.updateStudent(student.id, {
    lastLoginDate: (/* @__PURE__ */ new Date()).toISOString(),
    ...loginGhostPatch
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644",
    details: "\u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 \u0646\u0627\u062C\u062D \u0625\u0644\u0649 \u0627\u0644\u0645\u0646\u0635\u0629",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0645\u0643\u062A\u0634\u0641 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B",
    browser: "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u064A\u0628",
    isViolationWarning: false
  });
  const refreshedLoginStudent = dbInstance.getStudents().find((st) => normalizeStudentId(st.id) === normalizeStudentId(student.id)) || student;
  const loginEnrollments = getStudentEnrollmentDetails(refreshedLoginStudent);
  const responseStudent = sanitizeStudentForClient(
    sebLoginPass ? {
      ...refreshedLoginStudent,
      sectionCode: sebLoginPass.courseCode,
      activeSebExamId: sebLoginPass.examId
    } : refreshedLoginStudent,
    loginEnrollments
  );
  const authToken = createStudentAuthPayload(req, res, responseStudent);
  return res.json({
    success: true,
    authToken,
    student: { ...responseStudent, authToken },
    sebSession: describeSebPass(sebLoginPass || null)
  });
});
app.post("/api/learning-fingerprint", (req, res) => {
  const { studentId, fingerprintAnswers } = req.body;
  const student = dbInstance.getStudents().find((s) => s.id === String(studentId));
  if (!student) {
    return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  }
  const {
    techLevel,
    projectType,
    prefField,
    fears,
    workStyle,
    targetGrade,
    goal
  } = fingerprintAnswers;
  const fieldToken = prefField === "\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A" ? "AI" : prefField === "\u0627\u0644\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u0639\u0632\u0632" ? "AR" : prefField === "\u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A\u0629" ? "GAME" : prefField === "\u0627\u0644\u062A\u0635\u0645\u064A\u0645 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A" ? "DSGN" : "E-LEARN";
  const styleToken = projectType === "\u062A\u0637\u0628\u064A\u0642\u064A \u0648\u0639\u0645\u0644\u064A" ? "APP" : "ANLYS";
  const numToken = Math.floor(10 + Math.random() * 90).toString();
  const sectionPart = student.sectionCode || "TECH";
  const pathwayCode = `${fieldToken}-${styleToken}-${sectionPart}-${numToken}`;
  const strengths = [
    "\u0627\u0644\u0627\u0647\u062A\u0645\u0627\u0645 \u0628\u0645\u062C\u0627\u0644 " + prefField,
    "\u0646\u0645\u0637 \u062A\u0639\u0644\u0645 " + (projectType === "\u062A\u0637\u0628\u064A\u0642\u064A \u0648\u0639\u0645\u0644\u064A" ? "\u062A\u0637\u0628\u064A\u0642\u064A \u0646\u0634\u0637" : "\u062A\u062D\u0644\u064A\u0644\u064A \u0639\u0645\u064A\u0642")
  ];
  const weaknesses = fears ? ["\u062E\u0648\u0641 \u0645\u0646: " + fears] : [];
  const recommendations = [
    `\u062A\u0645 \u062A\u0647\u064A\u0626\u0629 \u0645\u0633\u0627\u0631 \u062F\u0631\u0627\u0633\u062A\u0643 \u0627\u0644\u0645\u062E\u0635\u0635 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0644\u064A\u062A\u0646\u0627\u0633\u0628 \u0645\u0639 \u0627\u0647\u062A\u0645\u0627\u0645\u0643 \u0628\u0640 ${prefField}.`,
    `\u0646\u0646\u0635\u062D\u0643 \u0628\u0645\u0631\u0627\u062C\u0639\u0629 \u062A\u0645\u0627\u0631\u064A\u0646 \u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u0631\u0627\u0628\u0639 \u0644\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u062A\u062F\u0631\u064A\u0628 \u064A\u0639\u0636\u062F \u0646\u0642\u0627\u0637 \u0636\u0639\u0641\u0643.`,
    `\u0645\u0634\u0631\u0648\u0639\u0643 \u0627\u0644\u0634\u062E\u0635\u064A \u064A\u062A\u0637\u0644\u0628 \u0627\u0644\u062A\u0631\u0643\u064A\u0632 \u0627\u0644\u0639\u0627\u0644\u064A \u0648\u062A\u0637\u0628\u064A\u0642 \u0645\u0647\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u0635\u0645\u064A\u0645.`
  ];
  dbInstance.updateStudent(student.id, {
    pathwayCode,
    learningStyle: fingerprintAnswers,
    strengths,
    weaknesses,
    recommendations,
    progress: 10
    // first milestone completed!
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u0628\u0635\u0645\u0629 \u0627\u0644\u062A\u0639\u0644\u0645 \u0644\u0628\u0646\u0627\u0621 \u0627\u0644\u0645\u0633\u0627\u0631",
    details: `\u062A\u0645 \u062A\u0648\u0644\u064A\u062F \u0628\u0635\u0645\u0629 \u0627\u0644\u062A\u0639\u0644\u0645 \u0648\u0627\u0644\u0645\u0633\u0627\u0631 \u0627\u0644\u062F\u0631\u0627\u0633\u064A \u0627\u0644\u062E\u0627\u0635 \u0644\u0644\u0637\u0627\u0644\u0628 \u0628\u0646\u062C\u0627\u062D: ${pathwayCode}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0630\u0627\u062A\u064A",
    browser: "\u0645\u062A\u0635\u0641\u062D",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    student: {
      ...dbInstance.getStudents().find((s) => s.id === student.id),
      enrollments: getStudentEnrollmentDetails(
        dbInstance.getStudents().find((s) => s.id === student.id)
      )
    }
  });
});
app.get("/api/students/:id", (req, res) => {
  setNoCache(res);
  const student = dbInstance.getStudents().find((s) => s.id === String(req.params.id));
  if (!student) {
    return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  }
  const filteredProjects = dbInstance.getPersonalizedProjects().filter((p) => p.studentId === student.id);
  const submissions = dbInstance.getExerciseSubmissions().filter((s) => s.studentId === student.id);
  const quizzes = dbInstance.getQuizSubmissions().filter((q) => q.studentId === student.id);
  return res.json({
    student: {
      ...student,
      enrollments: getStudentEnrollmentDetails(student)
    },
    projects: filteredProjects.filter(
      (p) => !p.courseCode || !isStudentSuspendedInCourse(student, p.courseCode)
    ),
    exerciseSubmissions: withLiveStudentNames(submissions),
    quizSubmissions: withLiveStudentNames(quizzes),
    enrollments: getStudentEnrollmentDetails(student)
  });
});
app.get("/api/students/:id/session-status", (req, res) => {
  const student = dbInstance.getStudents().find((s) => s.id === String(req.params.id));
  if (!student)
    return res.json({
      blocked: true,
      reason: "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0645 \u064A\u0639\u062F \u0645\u0648\u062C\u0648\u062F\u0627\u064B \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645."
    });
  const activationCode = student.activationCode;
  const linkedCode = activationCode ? dbInstance.getJoinCodes().find(
    (jc) => normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode)
  ) : null;
  if (student.isAccessBlocked)
    return res.json({
      blocked: true,
      reason: student.accessBlockReason || "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0624\u0642\u062A\u0627\u064B \u0645\u0646 \u0642\u0628\u0644 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
    });
  if (activationCode && (!linkedCode || String(linkedCode.status || "") === "revoked" || String(linkedCode.status || "") === "deleted")) {
    const hasAnyPreservedCourse = getStudentActiveCourseCodes(student).length > 0 || activatedCourseCodesForStudent(student).length > 0 || Array.isArray(student.enrollments) && student.enrollments.some(
      (entry) => entry?.isActive !== false && String(entry?.status || "").toLowerCase() !== "locked" && String(entry?.status || "").toLowerCase() !== "suspended" && String(entry?.courseCode || entry?.sectionCode || "").trim()
    );
    if (!hasAnyPreservedCourse) {
      return res.json({
        blocked: false,
        name: student.name,
        accessResetAt: String(student.accessResetAt || ""),
        enrollments: getStudentEnrollmentDetails(student)
      });
    }
  }
  return res.json({
    blocked: false,
    name: student.name,
    accessResetAt: String(student.accessResetAt || ""),
    enrollments: getStudentEnrollmentDetails(student)
  });
});
app.post("/api/students/:id/snapshot", (req, res) => {
  const student = dbInstance.getStudents().find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0643\u0627\u0626\u0646" });
  const { snapshot, purpose, verificationCode } = req.body;
  dbInstance.updateStudent(student.id, { webcamSnapshot: snapshot });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u062A\u062D\u0642\u0642 \u062D\u064A \u062E\u0641\u064A\u0641",
    details: `\u062A\u0645 \u0627\u0644\u062A\u0642\u0627\u0637 \u0635\u0648\u0631\u0629 \u062D\u064A\u0629 \u0628\u0646\u062C\u0627\u062D \u0644\u0644\u062A\u062D\u0642\u0642 \u0642\u0628\u0644 \u0627\u0644\u0625\u062C\u0631\u0627\u0621: ${purpose || "\u0645\u0647\u0645\u0629 \u0631\u0626\u064A\u0633\u064A\u0629"}. \u0643\u0648\u062F \u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A \u0644\u0644\u064A\u0648\u0645: ${verificationCode}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0635\u0648\u0631\u0629 \u0643\u0627\u0645\u064A\u0631\u0627 \u062D\u064A\u0629",
    browser: "\u0645\u0646\u0635\u0629 \u0645\u0650\u0631\u0627\u0633",
    isViolationWarning: false
  });
  return res.json({ success: true });
});
app.post("/api/students/:id/log-violation", (req, res) => {
  const student = dbInstance.getStudents().find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0643\u0627\u0626\u0646" });
  const { details, action } = req.body;
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: action || "\u0641\u0634\u0644 \u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0645\u0639\u0631\u0641\u064A",
    details: details || "\u0623\u062C\u0627\u0628 \u0628\u062C\u0648\u0627\u0628 \u062E\u0627\u0637\u0626 \u0623\u062B\u0646\u0627\u0621 \u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0623\u0645\u0627\u0646 \u0627\u0644\u0630\u0627\u062A\u064A",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u062D\u0642\u0642",
    browser: "\u0645\u0646\u0635\u0629 \u0645\u0650\u0631\u0627\u0633",
    isViolationWarning: true
  });
  notifyTeachersForSection(
    student.sectionCode,
    String(action || "\u062A\u0646\u0628\u064A\u0647 \u0646\u0632\u0627\u0647\u0629 \u062F\u0627\u062E\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631"),
    `${student.name}: ${String(details || "\u062A\u0646\u0628\u064A\u0647 \u0646\u0632\u0627\u0647\u0629 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631")}`,
    { type: "exam_warning", studentId: student.id, link: "/" }
  );
  return res.json({ success: true });
});
app.post("/api/students/:id/activate", (req, res) => {
  const student = dbInstance.getStudents().find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644" });
  const { isPaid } = req.body;
  dbInstance.updateStudent(student.id, { isPaid });
  return res.json({
    success: true,
    student: dbInstance.getStudents().find((s) => s.id === student.id)
  });
});
app.post("/api/students/:id/reset-devices", (req, res) => {
  const student = dbInstance.getStudents().find((s) => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail || !teacherCanManageStudent(student, teacherEmail)) {
    return res.status(403).json({ error: "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632 \u064A\u062A\u0645 \u0645\u0646 \u062D\u0633\u0627\u0628 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u0641\u0642\u0637." });
  }
  const browser = req.headers["user-agent"] || "Unknown Browser";
  const ip = req.ip || "127.0.0.1";
  const retiredDeviceFingerprints = Array.isArray(student.devices) ? student.devices.map((d) => String(d || "").trim()).filter(Boolean) : [];
  const activationCode = String(student.activationCode || "").trim();
  const linkedJoinCodes = dbInstance.getJoinCodes().filter((jc) => {
    const sameCode = activationCode && normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode);
    const sameStudent = normalizeStudentId(jc.studentId || jc.usedByStudentId || "") === normalizeStudentId(student.id);
    return sameCode || sameStudent;
  });
  const retiredDeviceTokens = linkedJoinCodes.map((jc) => String(jc.activationDeviceToken || "").trim()).filter(Boolean);
  linkedJoinCodes.forEach((jc) => {
    dbInstance.updateJoinCode(jc.code, {
      activationDeviceFingerprint: "",
      activationDeviceToken: "",
      activationDeviceServerHash: ""
    });
  });
  dbInstance.updateStudent(student.id, {
    devices: [],
    pendingDeviceTransfer: true,
    retiredDeviceFingerprints,
    retiredDeviceTokens,
    accessResetAt: (/* @__PURE__ */ new Date()).toISOString(),
    isAccessBlocked: false,
    accessBlockReason: ""
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    action: "\u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0623\u062C\u0647\u0632\u0629",
    details: `\u0642\u0627\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0628\u0641\u0635\u0644 \u062C\u0645\u064A\u0639 \u0627\u0644\u0623\u062C\u0647\u0632\u0629 \u0627\u0644\u0642\u062F\u064A\u0645\u0629 \u0648\u062A\u062C\u0647\u064A\u0632 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F \u0639\u0646\u062F \u0623\u0648\u0644 \u062F\u062E\u0648\u0644 \u0644\u0644\u0637\u0627\u0644\u0628.`,
    ip,
    userAgent: browser,
    os: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0645\u062A\u0635\u0641\u062D \u0648\u064A\u0628",
    isViolationWarning: false
  });
  return res.json({ success: true, devices: [], pendingDeviceTransfer: true });
});
function resolveExamLockSubject(req, res) {
  const studentId = String(
    req.body?.studentId || req.query?.studentId || ""
  ).trim();
  const examId = String(
    req.body?.examId || req.body?.chapterId || req.query?.examId || req.query?.chapterId || ""
  ).trim();
  const student = dbInstance.getStudents().find((s) => s.id === studentId);
  if (!student) {
    res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
    return null;
  }
  const exam = activeTeacherExams().find(
    (item) => String(item.id) === examId
  );
  if (!exam) {
    res.status(404).json({ error: "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
    return null;
  }
  if (!studentHasEnrollmentInCourse(student, exam.courseCode || student.sectionCode)) {
    res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u062E\u0635\u0635 \u0644\u0623\u062D\u062F \u0645\u0642\u0631\u0631\u0627\u062A\u0643 \u0627\u0644\u0645\u0641\u0639\u0644\u0629." });
    return null;
  }
  const now = Date.now();
  if (exam.open && new Date(exam.open).getTime() > now) {
    res.status(403).json({ error: "\u0644\u0645 \u064A\u0628\u062F\u0623 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0628\u0639\u062F." });
    return null;
  }
  if (exam.close && new Date(exam.close).getTime() + 24 * 60 * 60 * 1e3 < now && !getActiveReturnException("exam", exam.id, student.id)) {
    res.status(403).json({ error: "\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631." });
    return null;
  }
  return { student, exam };
}
app.post("/api/exam-lock/acquire", (req, res) => {
  const subject = resolveExamLockSubject(req, res);
  if (!subject) return;
  const result = acquireExamLockForRequest(req, subject.student, subject.exam);
  if (isExamLockFailure(result))
    return res.status(result.status).json({ error: result.error, reason: result.reason });
  return res.json({
    success: true,
    activeExamSessionId: result.session.sessionId,
    session: result.session
  });
});
app.post("/api/exam-lock/heartbeat", (req, res) => {
  const subject = resolveExamLockSubject(req, res);
  if (!subject) return;
  const result = heartbeatExamLockForRequest(req, subject.student, subject.exam);
  if (isExamLockFailure(result))
    return res.status(result.status).json({ error: result.error, reason: result.reason });
  return res.json({
    success: true,
    activeExamSessionId: result.session.sessionId,
    lastHeartbeatAt: result.session.lastHeartbeatAt
  });
});
app.post("/api/exam-lock/release", (req, res) => {
  const subject = resolveExamLockSubject(req, res);
  if (!subject) return;
  const rawStatus = String(req.body?.status || "").trim();
  const status = rawStatus === "violated" || rawStatus === "expired" ? rawStatus : "finished";
  const session = markExamLockStatusForRequest(
    req,
    subject.student,
    subject.exam,
    status,
    String(req.body?.reason || status)
  );
  return res.json({ success: true, session });
});
app.get("/api/quizzes/generate", (req, res) => {
  const { studentId, chapterId } = req.query;
  const student = dbInstance.getStudents().find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const sebPassForRequest = getActiveSebAttempt(req, student);
  if (sebPassForRequest && String(chapterId) !== String(sebPassForRequest.examId)) {
    rejectSebPass(
      req,
      sebPassForRequest,
      `\u0631\u0641\u0636 \u062A\u0648\u0644\u064A\u062F \u0627\u062E\u062A\u0628\u0627\u0631 \u062E\u0627\u0631\u062C \u0646\u0637\u0627\u0642 \u0646\u0641\u0642 SEB: \u0627\u0644\u0645\u0637\u0644\u0648\u0628 ${String(chapterId)} \u0648\u0627\u0644\u0645\u0633\u0645\u0648\u062D ${sebPassForRequest.examId}.`
    );
    return res.status(403).json({ error: "\u062C\u0644\u0633\u0629 SEB \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u0645\u062E\u0635\u0635\u0629 \u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0627\u062D\u062F \u0641\u0642\u0637." });
  }
  const officialExam = activeTeacherExams().find(
    (exam) => String(exam.id) === String(chapterId)
  );
  let activeExamSessionForResponse = null;
  if (officialExam) {
    const activeSebAttempt = getActiveSebAttempt(req, student, officialExam.id);
    if (!studentHasEnrollmentInCourse(
      student,
      officialExam.courseCode || student.sectionCode
    )) {
      return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u062E\u0635\u0635 \u0644\u0623\u062D\u062F \u0645\u0642\u0631\u0631\u0627\u062A\u0643 \u0627\u0644\u0645\u0641\u0639\u0644\u0629." });
    }
    if (officialExam.seb?.enabled && !activeSebAttempt) {
      rejectSebPass(
        req,
        getValidSebPass(req, student, officialExam.id),
        `\u0631\u0641\u0636 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 ${officialExam.id}: \u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u062D\u0627\u0648\u0644\u0629 SEB \u0646\u0634\u0637\u0629 \u0645\u0637\u0627\u0628\u0642\u0629.`
      );
      return res.status(403).json({
        error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u064A\u062A\u0637\u0644\u0628 \u062C\u0644\u0633\u0629 SEB \u0622\u0645\u0646\u0629 \u0645\u0641\u0639\u0644\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u0648\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631. \u0627\u0636\u063A\u0637 \u0632\u0631 \u062A\u0634\u063A\u064A\u0644 SEB \u0645\u0646 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u061B \u0625\u0630\u0627 \u0643\u0646\u062A \u062F\u0627\u062E\u0644 SEB \u0627\u0636\u063A\u0637 \u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0644\u0627 \u062A\u062D\u0645\u0651\u0644 \u0645\u0644\u0641 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062C\u062F\u064A\u062F."
      });
    }
    const now = Date.now();
    if (officialExam.open && new Date(officialExam.open).getTime() > now)
      return res.status(403).json({ error: "\u0644\u0645 \u064A\u0628\u062F\u0623 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0628\u0639\u062F." });
    if (officialExam.close && new Date(officialExam.close).getTime() + 24 * 60 * 60 * 1e3 < now && !getActiveReturnException("exam", officialExam.id, student.id))
      return res.status(403).json({ error: "\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631." });
    const lockResult = acquireExamLockForRequest(req, student, officialExam);
    if (isExamLockFailure(lockResult)) {
      return res.status(lockResult.status).json({
        error: lockResult.error,
        reason: lockResult.reason
      });
    }
    activeExamSessionForResponse = lockResult.session;
  }
  const previousQuizAttempt = dbInstance.getQuizSubmissions().find(
    (q) => q.studentId === student.id && String(q.chapterId) === String(chapterId)
  );
  const returnedByTeacher = officialExam ? isExamReturnedForStudent(officialExam.id, student.id) : false;
  if (previousQuizAttempt && returnedByTeacher && String(previousQuizAttempt.status || "") !== "returned") {
    dbInstance.updateQuizSubmission(previousQuizAttempt.id, {
      status: "returned",
      returnedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    previousQuizAttempt.status = "returned";
  }
  const previousAttemptStatus = String(
    previousQuizAttempt?.status || ""
  );
  const isReloadOfActiveSebAttempt = previousAttemptStatus === "started" && !!sebPassForRequest;
  const isReloadOfActiveRegularAttempt = previousAttemptStatus === "started" && !sebPassForRequest && !!String(previousQuizAttempt?.deviceFingerprint || "").trim() && String(previousQuizAttempt?.deviceFingerprint || "") === getRequestDeviceFingerprint(req);
  const isReloadOfActiveAttempt = isReloadOfActiveSebAttempt || isReloadOfActiveRegularAttempt;
  if (previousQuizAttempt && previousAttemptStatus === "started" && officialExam && !isReloadOfActiveAttempt) {
    const zeroSubmission = finalizeExamAttemptAsZero(req, {
      student,
      exam: officialExam,
      pass: sebPassForRequest,
      submission: previousQuizAttempt,
      reason: "\u062A\u0645\u062A \u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0628\u0639\u062F \u0638\u0647\u0648\u0631 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0633\u0627\u0628\u0642\u0627\u064B \u0648\u062F\u0648\u0646 \u062A\u0633\u0644\u064A\u0645\u061B \u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627 \u0627\u0644\u0637\u0627\u0644\u0628."
    });
    return res.status(409).json({
      error: "\u062A\u0645 \u0641\u062A\u062D \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0633\u0627\u0628\u0642\u0627\u064B \u0648\u0638\u0647\u0631\u062A \u0623\u0633\u0626\u0644\u062A\u0647. \u0623\u063A\u0644\u0642\u062A \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0648\u0631\u064F\u0635\u062F\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644\u062A \u0644\u0647\u0627\u060C \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629 \u0625\u0644\u0627 \u0625\u0630\u0627 \u0623\u0639\u0627\u062F\u0647 \u0627\u0644\u0623\u0633\u062A\u0627\u0630.",
      submission: zeroSubmission
    });
  }
  if (previousQuizAttempt && previousAttemptStatus !== "returned" && !isReloadOfActiveAttempt) {
    return res.status(409).json({
      error: "\u062A\u0645 \u0641\u062A\u062D \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0633\u0627\u0628\u0642\u0627\u064B \u0623\u0648 \u0627\u0644\u062E\u0631\u0648\u062C \u0645\u0646\u0647. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629 \u0625\u0644\u0627 \u0625\u0630\u0627 \u0623\u0639\u0627\u062F\u0647 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0644\u0643.",
      submission: previousQuizAttempt
    });
  }
  const previousGeneratedQuestions = sanitizePublicQuizQuestions(
    previousQuizAttempt?.generatedQuestions || []
  );
  const isReturnedCheatingQuizAttempt = !!previousQuizAttempt && previousAttemptStatus === "returned" && (isCheatingAttemptSubmissionServer(previousQuizAttempt) || String(previousQuizAttempt?.finishReason || "").trim() === EXAM_CHEATING_ATTEMPT_STATUS);
  if (isReturnedCheatingQuizAttempt && previousGeneratedQuestions.length > 0) {
    const restartedAttempt = {
      ...previousQuizAttempt,
      status: "started",
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      deviceFingerprint: getRequestDeviceFingerprint(req),
      generatedQuestions: previousGeneratedQuestions,
      generatedQuestionIds: previousQuizAttempt?.generatedQuestionIds || previousQuizAttempt?.previousGeneratedQuestionIds || previousGeneratedQuestions.map((q) => q.id),
      answers: {},
      draftAnswers: {},
      matchedQuestions: [],
      score: 0,
      totalPoints: 0
    };
    dbInstance.updateQuizSubmission(previousQuizAttempt.id, restartedAttempt);
    if (officialExam) {
      upsertRuntimeTeacherSubmission({
        id: `exam-${officialExam.id}-${student.id}`,
        kind: "exam",
        activityId: officialExam.id,
        activityTitle: officialExam.title,
        courseCode: officialExam.courseCode || student.sectionCode,
        studentId: student.id,
        studentName: student.name,
        answerText: "\u062F\u062E\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0628\u062F\u0623\u062A \u0645\u062D\u0627\u0648\u0644\u062A\u0647\u061B \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0642\u064A\u062F \u0627\u0644\u062D\u0644 \u0627\u0644\u0622\u0646.",
        status: EXAM_IN_PROGRESS_STATUS,
        submittedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return res.json({
      chapterId,
      officialExamId: officialExam?.id,
      activeExamSessionId: activeExamSessionForResponse?.sessionId,
      questions: previousGeneratedQuestions
    });
  }
  if (isReloadOfActiveAttempt && previousGeneratedQuestions.length > 0) {
    if (officialExam) {
      const reloadRowId = `exam-${officialExam.id}-${student.id}`;
      const reloadExistingRow = dbInstance.getTeacherSubmissions().find((item) => String(item.id) === reloadRowId);
      if (!isProtectedFinalExamStatus(reloadExistingRow)) {
        upsertRuntimeTeacherSubmission({
          id: reloadRowId,
          kind: "exam",
          activityId: officialExam.id,
          activityTitle: officialExam.title,
          courseCode: officialExam.courseCode || student.sectionCode,
          studentId: student.id,
          studentName: student.name,
          answerText: "\u062F\u062E\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0628\u062F\u0623\u062A \u0645\u062D\u0627\u0648\u0644\u062A\u0647\u061B \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0642\u064A\u062F \u0627\u0644\u062D\u0644 \u0627\u0644\u0622\u0646.",
          status: EXAM_IN_PROGRESS_STATUS,
          submittedAt: previousQuizAttempt?.startedAt || (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    return res.json({
      chapterId,
      officialExamId: officialExam?.id,
      activeExamSessionId: activeExamSessionForResponse?.sessionId,
      questions: previousGeneratedQuestions
    });
  }
  const examTeacherEmail = String(
    officialExam?.createdBy || sectionOwnerEmail(officialExam?.courseCode || student.sectionCode) || "ah.alfailakawi@paaet.edu.kw"
  ).toLowerCase();
  const chapterQuestions = officialExam ? activeQuestionBank().filter(
    (q) => questionMatchesOfficialExamServer(q, officialExam, examTeacherEmail)
  ) : activeQuestionBank().filter((q) => {
    const sameChapter = questionMatchesSelectedCategoriesServer(
      q,
      [chapterId],
      examTeacherEmail
    );
    return sameChapter && q.isApproved === true && questionBelongsToTeacherServer(q, examTeacherEmail);
  });
  if (chapterQuestions.length === 0) {
    return res.status(404).json({
      error: officialExam ? "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u0633\u0626\u0644\u0629 \u0645\u0639\u062A\u0645\u062F\u0629 \u0641\u064A \u0628\u0646\u0643 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0627\u0644\u0645\u0642\u0631\u0631." : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u0633\u0626\u0644\u0629 \u0645\u0639\u062A\u0645\u062F\u0629 \u0641\u064A \u0628\u0646\u0643 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0641\u0635\u0644 \u062D\u0627\u0644\u064A\u0627\u064B."
    });
  }
  const drawCount = officialExam ? Math.max(
    1,
    Math.min(
      Number(officialExam.questionsCount) || 1,
      chapterQuestions.length
    )
  ) : Math.min(5, chapterQuestions.length);
  const selected = fisherYatesShuffle(chapterQuestions).slice(0, drawCount);
  const formattedQuestions = selected.map((q) => {
    const { correctAnswer, ...publicQuestion } = q;
    if (q.type === "multiple-choice" && q.options) {
      const shuffledOptions = fisherYatesShuffle(q.options);
      return { ...publicQuestion, options: shuffledOptions };
    }
    return publicQuestion;
  });
  const startedAttempt = {
    id: previousQuizAttempt?.id || "quiz-sub-" + Math.random().toString(36).substring(2, 9),
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
    deviceOS: "\u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0634\u062E\u0635",
    deviceBrowser: String(
      req.headers["user-agent"] || "Unknown Browser"
    ).substring(0, 30),
    ipAddress: req.ip || "127.0.0.1",
    startedAt: isReloadOfActiveAttempt && previousQuizAttempt?.startedAt ? previousQuizAttempt.startedAt : (/* @__PURE__ */ new Date()).toISOString(),
    status: "started",
    generatedQuestionIds: selected.map((q) => q.id),
    generatedQuestions: formattedQuestions,
    sebAttemptId: sebPassForRequest?.attemptId || ""
  };
  if (previousQuizAttempt)
    dbInstance.updateQuizSubmission(
      previousQuizAttempt.id,
      startedAttempt
    );
  else dbInstance.addQuizSubmission(startedAttempt);
  if (officialExam) {
    const inProgressRowId = `exam-${officialExam.id}-${student.id}`;
    const existingExamRow = dbInstance.getTeacherSubmissions().find((item) => String(item.id) === inProgressRowId);
    if (!isProtectedFinalExamStatus(existingExamRow)) {
      upsertRuntimeTeacherSubmission({
        id: inProgressRowId,
        kind: "exam",
        activityId: officialExam.id,
        activityTitle: officialExam.title,
        courseCode: officialExam.courseCode || student.sectionCode,
        studentId: student.id,
        studentName: student.name,
        answerText: "\u062F\u062E\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0628\u062F\u0623\u062A \u0645\u062D\u0627\u0648\u0644\u062A\u0647\u061B \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0642\u064A\u062F \u0627\u0644\u062D\u0644 \u0627\u0644\u0622\u0646.",
        status: EXAM_IN_PROGRESS_STATUS,
        submittedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  return res.json({
    chapterId,
    officialExamId: officialExam?.id,
    activeExamSessionId: activeExamSessionForResponse?.sessionId,
    questions: formattedQuestions
  });
});
app.post("/api/quizzes/save-draft", (req, res) => {
  const { studentId, chapterId, answers } = req.body;
  if (studentId && chapterId) {
    const student = dbInstance.getStudents().find((s) => String(s.id) === String(studentId));
    const officialExam = activeTeacherExams().find(
      (exam) => String(exam.id) === String(chapterId)
    );
    if (student && officialExam && requestExamSessionId(req)) {
      const lockResult = heartbeatExamLockForRequest(req, student, officialExam);
      if (isExamLockFailure(lockResult)) {
        return res.status(lockResult.status).json({
          error: lockResult.error,
          reason: lockResult.reason
        });
      }
    }
    const previousQuizSubmission = dbInstance.getQuizSubmissions().find(
      (q) => String(q.studentId) === String(studentId) && String(q.chapterId) === String(chapterId)
    );
    if (previousQuizSubmission && String(previousQuizSubmission.status || "") === "started") {
      dbInstance.updateQuizSubmission(previousQuizSubmission.id, {
        ...previousQuizSubmission,
        draftAnswers: answers || {}
      });
    }
  }
  return res.json({ success: true, syncedAt: Date.now() });
});
app.post("/api/quizzes/integrity-exit", (req, res) => {
  const {
    studentId,
    chapterId,
    answers,
    integrityReason,
    integritySignals,
    wasOffline
  } = req.body || {};
  const student = dbInstance.getStudents().find((item) => String(item.id) === String(studentId));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const exam = activeTeacherExams().find(
    (item) => String(item.id) === String(chapterId)
  );
  if (!exam) return res.status(404).json({ error: "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  if (exam.seb?.enabled || exam.sebEnabled) {
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u0627\u0631 \u0645\u062E\u0635\u0635 \u0644\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0639\u0627\u062F\u064A \u0641\u0642\u0637." });
  }
  if (!studentHasEnrollmentInCourse(
    student,
    exam.courseCode || student.sectionCode
  )) {
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u062E\u0635\u0635 \u0644\u0623\u062D\u062F \u0645\u0642\u0631\u0631\u0627\u062A\u0643 \u0627\u0644\u0645\u0641\u0639\u0644\u0629." });
  }
  const previousQuizSubmission = dbInstance.getQuizSubmissions().find(
    (item) => String(item.studentId) === String(student.id) && String(item.chapterId) === String(exam.id)
  );
  const teacherRowId = `exam-${exam.id}-${student.id}`;
  const previousTeacherRow = dbInstance.getTeacherSubmissions().find((item) => String(item.id) === teacherRowId);
  const previousTerminalText = [
    previousQuizSubmission?.terminalStatus,
    previousQuizSubmission?.finishReason,
    previousQuizSubmission?.exitReason
  ].map((value) => String(value || "").trim().toLowerCase()).join(" ");
  const alreadyConfirmed = String(previousTeacherRow?.status || "") === EXAM_CHEATING_ATTEMPT_STATUS || /\b(?:cheating|violation|violated|expelled)\b/.test(
    previousTerminalText
  ) || previousTerminalText.includes("landscape_orientation") || previousTerminalText.includes("orientation_violation");
  if (alreadyConfirmed) {
    markExamLockStatusForRequest(
      req,
      student,
      exam,
      "violated",
      previousQuizSubmission?.exitReason || integrityReason || "violation"
    );
    return res.json({
      success: true,
      alreadyConfirmed: true,
      submission: previousQuizSubmission,
      teacherSubmission: previousTeacherRow
    });
  }
  if (previousQuizSubmission && String(previousQuizSubmission.status || "") !== "started") {
    return res.status(409).json({
      error: "\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0646\u062A\u0647\u064A\u0629 \u0645\u0633\u0628\u0642\u0627\u064B.",
      submission: previousQuizSubmission
    });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const cleanReason = String(integrityReason || "").replace(/\s+/g, " ").trim().slice(0, 260);
  const teacherReason = cleanReason || "\u062A\u063A\u064A\u064A\u0631 \u0627\u062A\u062C\u0627\u0647 \u0627\u0644\u0634\u0627\u0634\u0629 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631";
  const terminalExitReason = normalizedExamExitReason(teacherReason);
  const safeSignals = Array.isArray(integritySignals) ? integritySignals.slice(-8).map((signal) => ({
    key: String(signal?.key || "").slice(0, 80),
    reason: String(signal?.reason || "").slice(0, 160),
    weight: Number(signal?.weight || 0),
    at: String(signal?.at || "").slice(0, 40),
    visibility: String(signal?.visibility || "").slice(0, 30),
    online: Boolean(signal?.online),
    viewport: String(signal?.viewport || "").slice(0, 40)
  })) : [];
  const safeAnswers = answers && typeof answers === "object" ? answers : previousQuizSubmission?.draftAnswers || {};
  const progressGrade = gradeCurrentExamProgress(
    {
      ...previousQuizSubmission,
      draftAnswers: safeAnswers,
      answers: safeAnswers
    },
    Number(exam.points || previousQuizSubmission?.totalPoints || 20)
  );
  const totalPoints = Number(exam.points || progressGrade.totalPoints || 20) || 20;
  const quizSubmission = {
    ...previousQuizSubmission || {},
    id: previousQuizSubmission?.id || "quiz-sub-" + Math.random().toString(36).substring(2, 9),
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
    zeroReason: void 0,
    finishReason: EXAM_CHEATING_ATTEMPT_STATUS,
    terminalStatus: "violation",
    attemptStatus: "violation",
    sessionStatus: "violated",
    exitReason: terminalExitReason,
    exitedAt: now,
    exitWasOffline: !!wasOffline,
    integrityReason: cleanReason || void 0,
    integritySignals: safeSignals.length ? safeSignals : void 0
  };
  if (previousQuizSubmission?.id) {
    dbInstance.updateQuizSubmission(
      previousQuizSubmission.id,
      quizSubmission
    );
  } else {
    dbInstance.addQuizSubmission(quizSubmission);
  }
  markExamLockStatusForRequest(
    req,
    student,
    exam,
    "violated",
    terminalExitReason
  );
  const teacherSubmission = upsertRuntimeTeacherSubmission({
    ...previousTeacherRow || {},
    id: teacherRowId,
    kind: "exam",
    activityId: exam.id,
    activityTitle: exam.title,
    courseCode: exam.courseCode || student.sectionCode,
    studentId: student.id,
    studentName: student.name,
    answerText: `\u062D\u0627\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u063A\u0634 (${teacherReason}) \u0641\u062A\u0645 \u0625\u062E\u0631\u0627\u062C\u0647 \u0648\u0631\u0635\u062F\u062A \u062F\u0631\u062C\u0627\u062A\u0647 \u0627\u0644\u062D\u0627\u0644\u064A\u0629: 0 \u0645\u0646 ${totalPoints}`,
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
    gradedAt: canShowExamGradeToStudent(exam) ? now : void 0
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634",
    details: `${teacherReason} \u2014 \u062A\u0645 \u0625\u062E\u0631\u0627\u062C \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 ${exam.title} \u0648\u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0635\u0641\u0631.`,
    teacherEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    actorEmail: sectionOwnerEmail(exam.courseCode || student.sectionCode),
    sectionCode: exam.courseCode || student.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0646\u0638\u0627\u0645 \u0627\u0644\u0646\u0632\u0627\u0647\u0629",
    browser: "\u0645\u0650\u0631\u0627\u0633",
    isViolationWarning: true
  });
  notifyTeachersForSection(
    exam.courseCode || student.sectionCode,
    "\u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634",
    `${student.name} \u062D\u0627\u0648\u0644 \u0627\u0644\u063A\u0634 \u0641\u064A ${exam.title} (${teacherReason}) \u0648\u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0635\u0641\u0631.`,
    {
      type: "exam_cheating_attempt",
      studentId: student.id,
      examId: exam.id,
      link: "/"
    }
  );
  notifyStudent(
    student.id,
    "\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634",
    `\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 ${exam.title} \u0628\u0633\u0628\u0628 \u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634\u060C \u0648\u0631\u064F\u0635\u062F\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0635\u0641\u0631.`,
    {
      type: "exam_cheating_attempt",
      examId: exam.id,
      link: "/"
    }
  );
  return res.json({
    success: true,
    submission: quizSubmission,
    teacherSubmission
  });
});
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
    integritySignals
  } = req.body;
  const student = dbInstance.getStudents().find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const sebPassForRequest = getActiveSebAttempt(req, student);
  if (sebPassForRequest && String(chapterId) !== String(sebPassForRequest.examId)) {
    rejectSebPass(
      req,
      sebPassForRequest,
      `\u0631\u0641\u0636 \u062A\u0633\u0644\u064A\u0645 \u0627\u062E\u062A\u0628\u0627\u0631 \u062E\u0627\u0631\u062C \u0646\u0637\u0627\u0642 \u0646\u0641\u0642 SEB: \u0627\u0644\u0645\u0637\u0644\u0648\u0628 ${String(chapterId)} \u0648\u0627\u0644\u0645\u0633\u0645\u0648\u062D ${sebPassForRequest.examId}.`
    );
    return res.status(403).json({ error: "\u062C\u0644\u0633\u0629 SEB \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u0645\u062E\u0635\u0635\u0629 \u0644\u062A\u0633\u0644\u064A\u0645 \u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0627\u062D\u062F \u0641\u0642\u0637." });
  }
  const officialExam = activeTeacherExams().find(
    (exam) => String(exam.id) === String(chapterId)
  );
  if (officialExam) {
    const activeSebAttempt = getActiveSebAttempt(req, student, officialExam.id);
    if (!studentHasEnrollmentInCourse(
      student,
      officialExam.courseCode || student.sectionCode
    )) {
      return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u062E\u0635\u0635 \u0644\u0623\u062D\u062F \u0645\u0642\u0631\u0631\u0627\u062A\u0643 \u0627\u0644\u0645\u0641\u0639\u0644\u0629." });
    }
    if (officialExam.seb?.enabled && (!isSebRequest(req) || !activeSebAttempt)) {
      return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0633\u0644\u064A\u0645 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u062E\u0627\u0631\u062C Safe Exam Browser." });
    }
    const now = Date.now();
    if (officialExam.open && new Date(officialExam.open).getTime() > now)
      return res.status(403).json({ error: "\u0644\u0645 \u064A\u0628\u062F\u0623 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0628\u0639\u062F." });
    if (officialExam.close && new Date(officialExam.close).getTime() + 24 * 60 * 60 * 1e3 < now && !getActiveReturnException("exam", officialExam.id, student.id))
      return res.status(403).json({ error: "\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0625\u062A\u0627\u062D\u0629 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631." });
  }
  const browser = req.headers["user-agent"] || "Unknown Browser";
  const ip = req.ip || "127.0.0.1";
  const deviceFingerprint = getRequestDeviceFingerprint(req);
  const durationMs = Date.now() - (startTime || Date.now());
  const durationMinutes = Math.max(
    0.1,
    Number((durationMs / 1e3 / 60).toFixed(1))
  );
  const isSuspiciouslyFast = durationMinutes < 0.2;
  if (isSuspiciouslyFast) {
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u0634\u0628\u0647\u0629 \u0633\u0631\u0639\u0629 \u063A\u064A\u0631 \u0645\u0639\u062A\u0627\u062F\u0629",
      details: `\u0623\u0646\u0647\u0649 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u062A\u062F\u0631\u064A\u0628\u064A \u0627\u0644\u062E\u0627\u0635 \u0628\u0627\u0644\u0641\u0635\u0644 \u0641\u064A \u063A\u0636\u0648\u0646 ${durationMinutes} \u062F\u0642\u064A\u0642\u0629 \u0648\u0647\u0648 \u062A\u064A\u0627\u0631 \u0633\u0631\u064A\u0639 \u0644\u0644\u063A\u0627\u064A\u0629 \u064A\u0639\u0637\u064A \u0634\u0628\u0647\u0629 \u062A\u0628\u0627\u062F\u0644 \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0623\u0648 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A.`,
      ip,
      userAgent: browser,
      os: "\u0645\u062D\u0644\u0644 \u0627\u0644\u0633\u0644\u0648\u0643 \u0627\u0644\u0630\u0643\u064A",
      browser: "\u062A\u0641\u062A\u064A\u0634 \u0630\u0627\u062A\u064A",
      isViolationWarning: true
    });
    notifyTeachersForSection(
      student.sectionCode,
      "\u062A\u0646\u0628\u064A\u0647 \u0627\u062E\u062A\u0628\u0627\u0631",
      `${student.name} \u0623\u0646\u0647\u0649 \u0627\u062E\u062A\u0628\u0627\u0631\u064B\u0627 \u0628\u0633\u0631\u0639\u0629 \u063A\u064A\u0631 \u0645\u0639\u062A\u0627\u062F\u0629`,
      { type: "exam_warning", studentId: student.id, link: "/" }
    );
  }
  const matchedQuestions = [];
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
      isCorrect = String(studentAns).trim().toLowerCase().includes(String(q.correctAnswer).trim().toLowerCase());
    } else if (q.type === "matching") {
      let matchCount = 0;
      const originalMap = q.correctAnswer;
      const studentMap = studentAns || {};
      const keys = Object.keys(originalMap);
      keys.forEach((k) => {
        if (studentMap[k] === originalMap[k]) matchCount++;
      });
      isCorrect = matchCount === keys.length;
    } else if (q.type === "ordering") {
      const originalArray = q.correctAnswer;
      const studentArray = studentAns || [];
      isCorrect = JSON.stringify(originalArray) === JSON.stringify(studentArray);
    }
    const pointsEarned = isCorrect ? q.points : 0;
    score += pointsEarned;
    totalPoints += q.points;
    matchedQuestions.push({
      questionId: q.id,
      questionText: q.questionText,
      studentAnswer: studentAns,
      correctAnswer: q.type === "matching" || q.type === "ordering" ? q.correctAnswer : q.correctAnswer,
      isCorrect,
      pointsEarned
    });
  }
  const previousQuizSubmission = dbInstance.getQuizSubmissions().find((q) => q.studentId === student.id && q.chapterId === chapterId);
  const wasAutoZeroedOnly = !!previousQuizSubmission && String(previousQuizSubmission.status || "") === "submitted" && !!String(previousQuizSubmission.zeroReason || "").trim();
  if (submissionIsLocked(previousQuizSubmission) && !wasAutoZeroedOnly) {
    return res.status(409).json({
      error: "\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0633\u0628\u0642\u0627\u064B \u0648\u062A\u0645 \u0642\u0641\u0644 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0641\u062A\u062D\u0647 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0625\u0644\u0627 \u0628\u0639\u062F \u0625\u0631\u062C\u0627\u0639\u0647 \u0645\u0646 \u0627\u0644\u0645\u0639\u0644\u0645.",
      submission: previousQuizSubmission
    });
  }
  const submissionTimedOut = timedOut === true || String(submitReason || "") === "time-expired";
  const isSuspiciousExit = String(submitReason || "") === "suspicious_exit";
  const isWithdrawnOrExited = !isSuspiciousExit && (String(submitReason || "") === "withdrawn" || ["exited", "pagehide", "screen-closed"].includes(
    String(submitReason || "")
  ));
  const isInterruptedAttempt = isSuspiciousExit || isWithdrawnOrExited;
  const isSebProtectedExam = !!(officialExam?.seb?.enabled || officialExam?.sebEnabled);
  const normalIntegrityReason = !isSebProtectedExam && isSuspiciousExit ? String(integrityReason || "").replace(/\s+/g, " ").trim().slice(0, 260) : "";
  const normalIntegritySignals = !isSebProtectedExam && isSuspiciousExit && Array.isArray(integritySignals) ? integritySignals.slice(-8).map((signal) => ({
    key: String(signal?.key || "").slice(0, 80),
    reason: String(signal?.reason || "").slice(0, 160),
    weight: Number(signal?.weight || 0),
    at: String(signal?.at || "").slice(0, 40),
    visibility: String(signal?.visibility || "").slice(0, 30),
    online: Boolean(signal?.online),
    viewport: String(signal?.viewport || "").slice(0, 40)
  })) : [];
  const normalIntegrityTeacherReason = normalIntegrityReason || normalIntegritySignals.map((signal) => signal.reason).filter(Boolean).slice(-4).join("\u060C ") || "\u062A\u0628\u062F\u064A\u0644 \u062A\u0637\u0628\u064A\u0642 \u0623\u0648 \u0634\u0627\u0634\u0629";
  const terminalExitReason = isSuspiciousExit ? normalizedExamExitReason(normalIntegrityTeacherReason) : isWithdrawnOrExited ? "exited_before_submit" : "";
  const examTotalPoints = Number(officialExam?.points || totalPoints || 20);
  const finalScore = isSuspiciousExit ? 0 : score;
  const submission = {
    id: previousQuizSubmission?.id || "quiz-sub-" + Math.random().toString(36).substring(2, 9),
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
    deviceOS: "\u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0634\u062E\u0635",
    deviceBrowser: browser.substring(0, 30),
    ipAddress: ip,
    submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "submitted",
    zeroReason: void 0,
    finishReason: submissionTimedOut ? EXAM_TIME_EXPIRED_STATUS : isSuspiciousExit ? EXAM_CHEATING_ATTEMPT_STATUS : isWithdrawnOrExited ? EXAM_WITHDRAWN_STATUS : void 0,
    terminalStatus: isSuspiciousExit ? "violation" : isWithdrawnOrExited ? "exited" : submissionTimedOut ? "finished" : "submitted",
    exitReason: terminalExitReason || void 0,
    exitedAt: isInterruptedAttempt ? (/* @__PURE__ */ new Date()).toISOString() : void 0,
    exitWasOffline: isInterruptedAttempt ? !!wasOffline : void 0,
    integrityReason: normalIntegrityReason || void 0,
    integritySignals: normalIntegritySignals.length ? normalIntegritySignals : void 0,
    resubmittedAt: previousQuizSubmission ? (/* @__PURE__ */ new Date()).toISOString() : void 0
  };
  if (previousQuizSubmission)
    dbInstance.updateQuizSubmission(
      previousQuizSubmission.id,
      submission
    );
  else dbInstance.addQuizSubmission(submission);
  const completedSebAttempt = officialExam ? getActiveSebAttempt(req, student, officialExam.id) : null;
  if (completedSebAttempt) closeSebAttempt(completedSebAttempt, "submitted");
  if (officialExam) {
    markExamLockStatusForRequest(
      req,
      student,
      officialExam,
      isInterruptedAttempt ? "violated" : "finished",
      submissionTimedOut ? "time-expired" : isSuspiciousExit ? terminalExitReason : isWithdrawnOrExited ? "exited-before-submit" : "submitted"
    );
  }
  const totalSubmissions = dbInstance.getQuizSubmissions().filter((q) => q.studentId === student.id);
  const currentProgress = Math.min(
    100,
    Math.floor(20 + totalSubmissions.length * 15)
  );
  dbInstance.updateStudent(student.id, {
    progress: currentProgress,
    score: student.score + finalScore
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u062A\u0642\u062F\u064A\u0645 \u0627\u062E\u062A\u0628\u0627\u0631 \u062A\u062F\u0631\u064A\u0628\u064A",
    details: `\u0623\u062A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u062A\u062F\u0631\u064A\u0628\u064A \u0644\u0644\u0641\u0635\u0644 \u0648\u062D\u0635\u0644 \u0639\u0644\u0649 \u0639\u0644\u0627\u0645\u0629: ${finalScore}/${examTotalPoints}`,
    ip,
    userAgent: browser,
    os: "\u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0642\u064A\u064A\u0645 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A",
    browser: "\u0645\u0650\u0631\u0627\u0633",
    isViolationWarning: false
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
      answerText: submissionTimedOut ? `\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0625\u062C\u0627\u0628\u0627\u062A \u0627\u0644\u0637\u0627\u0644\u0628 \u0648\u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629: ${finalScore} \u0645\u0646 ${examTotalPoints}` : isSuspiciousExit ? `\u062D\u0627\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u063A\u0634 (${normalIntegrityTeacherReason}) \u0641\u062A\u0645 \u0625\u062E\u0631\u0627\u062C\u0647 \u0648\u0631\u0635\u062F\u062A \u062F\u0631\u062C\u0627\u062A\u0647 \u0627\u0644\u062D\u0627\u0644\u064A\u0629: 0 \u0645\u0646 ${examTotalPoints}` : isWithdrawnOrExited ? `\u0627\u0646\u0633\u062D\u0628 \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0623\u0648 \u0627\u0646\u0642\u0637\u0639\u062A \u062C\u0644\u0633\u062A\u0647\u060C \u0648\u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627: ${finalScore} \u0645\u0646 ${examTotalPoints}` : `\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0628\u0646\u062C\u0627\u062D. \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u0645\u062D\u0633\u0648\u0628\u0629: ${finalScore} \u0645\u0646 ${examTotalPoints}`,
      answers,
      matchedQuestions,
      grade: String(finalScore),
      visibleGrade: gradeVisible ? String(finalScore) : "",
      totalPoints: examTotalPoints,
      serverSubmissionId: submission.id,
      status: submissionTimedOut ? EXAM_TIME_EXPIRED_STATUS : isSuspiciousExit ? EXAM_CHEATING_ATTEMPT_STATUS : isWithdrawnOrExited ? EXAM_WITHDRAWN_STATUS : gradeVisible ? EXAM_GRADED_STATUS : EXAM_SUBMITTED_STATUS,
      terminalStatus: isSuspiciousExit ? "violation" : isWithdrawnOrExited ? "exited" : "submitted",
      exitReason: terminalExitReason || void 0,
      exitedAt: isInterruptedAttempt ? submission.submittedAt : void 0,
      submittedAt: submission.submittedAt,
      gradedAt: gradeVisible ? submission.submittedAt : void 0
    });
    notifyTeachersForSection(
      officialExam.courseCode || student.sectionCode,
      isSuspiciousExit ? "\u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634" : isWithdrawnOrExited ? "\u0627\u0646\u0633\u062D\u0627\u0628 \u0645\u0646 \u0627\u062E\u062A\u0628\u0627\u0631" : "\u062A\u0633\u0644\u064A\u0645 \u0627\u062E\u062A\u0628\u0627\u0631",
      isSuspiciousExit ? `${student.name} \u062D\u0627\u0648\u0644 \u0627\u0644\u063A\u0634 \u0641\u064A ${officialExam.title} (${normalIntegrityTeacherReason}) \u0648\u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0635\u0641\u0631.` : isWithdrawnOrExited ? `${student.name} \u0627\u0646\u0633\u062D\u0628 \u0623\u0648 \u0623\u063A\u0644\u0642 \u0634\u0627\u0634\u0629 ${officialExam.title} \u0648\u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627: ${finalScore} \u0645\u0646 ${examTotalPoints}` : `${student.name} \u0633\u0644\u0651\u0645 ${officialExam.title} \u0628\u062F\u0631\u062C\u0629 ${finalScore} \u0645\u0646 ${examTotalPoints}`,
      {
        type: isSuspiciousExit ? "exam_cheating_attempt" : isWithdrawnOrExited ? "exam_exited_before_submit" : "exam_submission",
        studentId: student.id,
        examId: officialExam.id,
        link: "/"
      }
    );
    notifyStudent(
      student.id,
      isSuspiciousExit ? "\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634" : isWithdrawnOrExited ? "\u062A\u0645 \u062D\u0641\u0638 \u062D\u0627\u0644\u0629 \u0627\u0644\u0627\u0646\u0633\u062D\u0627\u0628" : "\u062A\u0645 \u062D\u0641\u0638 \u0646\u062A\u064A\u062C\u062A\u0643",
      isSuspiciousExit ? `\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 ${officialExam.title} \u0628\u0633\u0628\u0628 \u0645\u062D\u0627\u0648\u0644\u0629 \u063A\u0634\u060C \u0648\u0631\u064F\u0635\u062F\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0635\u0641\u0631.` : isWithdrawnOrExited ? `\u062A\u0645 \u062D\u0641\u0638 ${officialExam.title} \u0648\u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644\u062A \u0644\u0647\u0627: ${finalScore} \u0645\u0646 ${examTotalPoints}.` : `\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 ${officialExam.title} \u0648\u062D\u0641\u0638 \u062F\u0631\u062C\u062A\u0643.`,
      {
        type: isSuspiciousExit ? "exam_cheating_attempt" : isWithdrawnOrExited ? "exam_withdrawn" : "exam_result",
        examId: officialExam.id,
        link: "/"
      }
    );
  }
  return res.json({
    success: true,
    submission,
    review: officialExam ? examReviewSettings(officialExam) : void 0,
    gradeVisible: officialExam ? canShowExamGradeToStudent(officialExam) : true
  });
});
app.get("/api/exercises", (req, res) => {
  const { studentId } = req.query;
  const student = dbInstance.getStudents().find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const exList = dbInstance.getExercises();
  const submissions = dbInstance.getExerciseSubmissions().filter((s) => s.studentId === student.id);
  return res.json({
    exercises: exList,
    submissions
  });
});
app.post("/api/exercises/submit", (req, res) => {
  const { studentId, exerciseId, studentAnswer, attachments } = req.body;
  const student = dbInstance.getStudents().find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const ex = dbInstance.getExercises().find((e) => e.id === exerciseId);
  if (!ex) return res.status(404).json({ error: "\u0627\u0644\u062A\u0645\u0631\u064A\u0646 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const hasExerciseAnswer = String(studentAnswer || "").trim().length > 0;
  const hasExerciseAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!hasExerciseAnswer && !hasExerciseAttachments) {
    return res.status(400).json({
      error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0633\u0644\u064A\u0645 \u0646\u0634\u0627\u0637 \u0641\u0627\u0631\u063A. \u0627\u0643\u062A\u0628 \u0625\u062C\u0627\u0628\u062A\u0643 \u0623\u0648 \u0623\u0631\u0641\u0642 \u0645\u0644\u0641\u0627\u064B \u0642\u0628\u0644 \u0627\u0644\u062A\u0633\u0644\u064A\u0645."
    });
  }
  const exLateDeadlineMs = mirasDeadlineEndMs(
    ex.closeDate || ex.close || ex.dueDate || ""
  );
  const exSubmittedLate = !!(exLateDeadlineMs && Number.isFinite(exLateDeadlineMs) && Date.now() > exLateDeadlineMs);
  const previousExerciseSubmission = dbInstance.getExerciseSubmissions().find(
    (s) => s.studentId === student.id && s.exerciseId === exerciseId
  );
  if (submissionIsLocked(previousExerciseSubmission)) {
    return res.status(409).json({
      error: "\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0647\u0630\u0627 \u0627\u0644\u0646\u0634\u0627\u0637 \u0645\u0633\u0628\u0642\u0627\u064B \u0648\u062A\u0645 \u0642\u0641\u0644\u0647. \u0644\u0627 \u064A\u0641\u062A\u062D \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0625\u0644\u0627 \u0628\u0639\u062F \u0636\u063A\u0637 \u0627\u0644\u0645\u0639\u0644\u0645 \u0632\u0631 \u0627\u0644\u0625\u0631\u062C\u0627\u0639.",
      submission: previousExerciseSubmission
    });
  }
  const watermarkSeed = `EX-${studentId}-${exerciseId}`;
  const watermarkText = `\u0623\u0643\u0627\u062F\u064A\u0645\u064A \u0645\u0641\u0639\u0651\u0644: \u0627\u0644\u0637\u0627\u0644\u0628 ${student.name} \u2022 \u0627\u0644\u0631\u0642\u0645: ${student.id} \u2022 \u0627\u0644\u0645\u0642\u0631\u0631: ${student.sectionCode} \u2022 \u0645\u0633\u0627\u0631: ${student.pathwayCode || "N/A"}`;
  const submission = {
    id: previousExerciseSubmission?.id || "ex-sub-" + Math.random().toString(36).substring(2, 9),
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: student.sectionCode,
    exerciseId,
    exerciseTitle: ex.title,
    studentAnswer,
    attachments: normalizePersistentSubmissionAttachments(attachments),
    submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
    watermark: watermarkText,
    status: "submitted",
    submittedLate: exSubmittedLate,
    resubmittedAt: previousExerciseSubmission ? (/* @__PURE__ */ new Date()).toISOString() : void 0
  };
  if (previousExerciseSubmission)
    dbInstance.updateExerciseSubmission(
      previousExerciseSubmission.id,
      submission
    );
  else dbInstance.addExerciseSubmission(submission);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u062A\u0633\u0644\u064A\u0645 \u062A\u0645\u0631\u064A\u0646 \u0623\u0633\u0628\u0648\u0639\u064A",
    details: `\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0625\u062C\u0627\u0628\u0629 \u062A\u0645\u0631\u064A\u0646: ${ex.title}. \u062A\u0645 \u0625\u0644\u062D\u0627\u0642 \u0627\u0644\u0639\u0644\u0627\u0645\u0629 \u0627\u0644\u0645\u0627\u0626\u064A\u0629 \u0627\u0644\u062B\u0627\u0628\u062A\u0629 \u0628\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0648\u0644\u062F.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0646\u0638\u0627\u0645 \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0646\u0635\u0648\u0635",
    browser: "\u0645\u062A\u0635\u0641\u062D",
    isViolationWarning: false
  });
  return res.json({ success: true, submission });
});
app.post("/api/projects/generate", async (req, res) => {
  const { studentId } = req.body;
  const student = dbInstance.getStudents().find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  if (!student.pathwayCode) {
    return res.status(400).json({
      error: "\u064A\u0631\u062C\u0649 \u0627\u0633\u062A\u0643\u0645\u0627\u0644 \u0628\u0635\u0645\u0629 \u0627\u0644\u062A\u0639\u0644\u0645 \u0623\u0648\u0644\u0627\u064B \u0644\u062A\u0648\u0644\u064A\u062F \u0643\u0648\u062F \u0627\u0644\u0645\u0633\u0627\u0631 \u0627\u0644\u062F\u0631\u0627\u0633\u064A \u0627\u0644\u062E\u0627\u0635 \u0628\u0643."
    });
  }
  const { prefField, targetGrade, workStyle, projectType } = student.learningStyle || {
    prefField: "\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A",
    targetGrade: "\u0645\u0631\u062D\u0644\u0629 \u0645\u062A\u0648\u0633\u0637\u0629",
    workStyle: "\u0639\u0645\u0644 \u0641\u0631\u062F\u064A",
    projectType: "\u062A\u0637\u0628\u064A\u0642\u064A \u0648\u0639\u0645\u0644\u064A"
  };
  const codeToken = Math.floor(100 + Math.random() * 900).toString();
  const watermarkText = `\u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u0634\u062E\u0635\u064A \u0627\u0644\u0645\u0639\u062A\u0645\u062F \u2022 \u0627\u0644\u0637\u0627\u0644\u0628: ${student.name} \u2022 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A: ${student.id} \u2022 \u0627\u0644\u0627\u0644\u0645\u0642\u0631\u0631: ${student.sectionCode} \u2022 \u0645\u0633\u0627\u0631: ${student.pathwayCode}`;
  let projectTitle = "";
  let projectDesc = "";
  let requirements = [];
  let steps = [];
  let rubric = [];
  let targetLearner = targetGrade === "\u0645\u0631\u062D\u0644\u0629 \u0645\u062A\u0648\u0633\u0637\u0629" ? "\u0627\u0644\u0637\u0644\u0628\u0629 \u0641\u064A \u0627\u0644\u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0645\u062A\u0648\u0633\u0637\u0629" : "\u0627\u0644\u0637\u0644\u0628\u0629 \u0641\u064A \u0627\u0644\u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0627\u0628\u062A\u062F\u0627\u0626\u064A\u0629";
  let techUsed = prefField;
  if (false) {
    try {
      const prompt = `\u0623\u0646\u062A \u0623\u0633\u062A\u0627\u0630 \u062C\u0627\u0645\u0639\u064A \u062E\u0628\u064A\u0631 \u0641\u064A \u062A\u0635\u0645\u064A\u0645 \u0627\u0644\u062A\u0639\u0644\u0645 \u0648\u0627\u0644\u0627\u0628\u062A\u0643\u0627\u0631 \u0627\u0644\u0631\u0642\u0645\u064A. \u0642\u0645 \u0628\u062A\u0635\u0645\u064A\u0645 \u0645\u0634\u0631\u0648\u0639 \u0628\u062D\u062B\u064A \u062A\u0637\u0628\u064A\u0642\u064A \u0641\u0631\u064A\u062F \u0648\u0634\u062E\u0635\u064A \u0643\u0644\u064A\u0627\u064B \u0644\u0637\u0627\u0644\u0628 \u062C\u0627\u0645\u0639\u064A \u0645\u062E\u0635\u0635 \u0644\u062F\u064A\u0647 \u0627\u0644\u0647\u0648\u064A\u0629 \u0648\u0627\u0644\u0627\u0647\u062A\u0645\u0627\u0645\u0627\u062A \u0627\u0644\u062A\u0627\u0644\u064A\u0629:
- \u0627\u0644\u0645\u062C\u0627\u0644 \u0627\u0644\u062A\u0643\u0646\u0648\u0644\u0648\u062C\u064A \u0627\u0644\u0631\u0626\u064A\u0633\u064A \u0627\u0644\u0645\u0641\u0636\u0644 \u0644\u062F\u064A\u0647: ${prefField}
- \u0627\u0644\u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0633\u0646\u064A\u0629 \u0627\u0644\u062A\u064A \u064A\u0633\u062A\u0647\u062F\u0641\u0647\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0644\u062A\u0635\u0645\u064A\u0645 \u0645\u0646\u0627\u0647\u062C \u0644\u0647\u0627: ${targetGrade}
- \u0646\u0645\u0637 \u0645\u0634\u0627\u0631\u064A\u0639\u0647 \u0627\u0644\u0645\u0641\u0636\u0644: ${projectType}
- \u0646\u0645\u0637 \u0639\u0645\u0644 \u0627\u0644\u0637\u0627\u0644\u0628: ${workStyle}

\u062A\u0623\u0643\u062F \u0645\u0646 \u0635\u064A\u0627\u063A\u0629 \u0625\u062C\u0627\u0628\u0629 \u062A\u0631\u0643\u0632 \u0639\u0644\u0649 \u062F\u0645\u062C \u0647\u0630\u0647 \u0627\u0644\u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0641\u064A \u0645\u0634\u0631\u0648\u0639 \u0648\u0627\u062D\u062F \u0645\u062A\u0643\u0627\u0645\u0644\u060C \u0628\u062D\u064A\u062B \u064A\u0646\u062A\u062C \u0627\u0644\u0637\u0627\u0644\u0628 \u0646\u0645\u0648\u0630\u062C\u0627\u064B \u0641\u0631\u064A\u062F\u0627\u064B \u0648\u0645\u062E\u0637\u0637\u0627\u064B \u062A\u0639\u0644\u064A\u0645\u064A\u0627\u064B.
\u0646\u0633\u0642 \u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0643\u0640 JSON \u0635\u0627\u0644\u062D \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0644\u064A\u0643\u0648\u0646 \u0642\u0627\u0628\u0644\u0627\u064B \u0644\u0644\u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0641\u0648\u0631\u064A\u0629\u060C \u0645\u0639 \u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645 \u0628\u0627\u0644\u0628\u0646\u064A\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629:
{
  "title": "\u0639\u0646\u0648\u0627\u0646 \u0641\u0631\u064A\u062F \u0648\u0645\u0628\u062A\u0643\u0631 \u0648\u062C\u0630\u0627\u0628 \u0644\u0644\u0645\u0634\u0631\u0648\u0639\u060C \u0644\u0627 \u064A\u062A\u0643\u0631\u0631 \u0645\u0639 \u0639\u064A\u0646\u0627\u062A \u062A\u0642\u0644\u064A\u062F\u064A\u0629",
  "description": "\u0648\u0635\u0641 \u0634\u064A\u0642 \u0648\u0645\u0641\u0635\u0644 \u0644\u0644\u0645\u0634\u0631\u0648\u0639 \u0648\u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A\u0629 \u0627\u0644\u0645\u062D\u062F\u062F\u0629 \u0648\u0643\u064A\u0641 \u064A\u0633\u0627\u0647\u0645 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0641\u064A \u062D\u0644\u0647\u0627 \u0628\u0637\u0628\u0627\u0626\u0639 \u0627\u0644\u062A\u0642\u0646\u064A\u0629 \u0627\u0644\u0645\u062E\u062A\u0627\u0631\u0629",
  "requirements": [
    "\u0642\u0627\u0626\u0645\u0629 \u0645\u0646 4 \u0645\u062A\u0637\u0644\u0628\u0627\u062A \u062A\u0642\u0646\u064A\u0629 \u0648\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629 \u062F\u0642\u064A\u0642\u0629 \u0645\u062E\u0635\u0635\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u062A\u0635\u0645\u064A\u0645"
  ],
  "steps": [
    "\u062E\u0637\u0648\u0627\u062A \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u062A\u062A\u0627\u0628\u0639\u0629 \u0648\u0627\u0644\u0645\u0645\u0646\u0647\u062C\u0629 \u0628\u0627\u0644\u062A\u0641\u0635\u064A\u0644 \u0644\u064A\u062A\u0633\u0646\u0649 \u0644\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u062A\u0646\u0641\u064A\u0630"
  ],
  "rubric": [
    {
      "criterion": "\u0627\u0644\u0645\u0639\u064A\u0627\u0631 \u0627\u0644\u0623\u0648\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A",
      "weight": 25,
      "levels": ["\u0645\u0645\u062A\u0627\u0632 \u0648\u0645\u062A\u0642\u0646 \u062A\u0645\u0627\u0645\u0627\u064B (90-100)", "\u062C\u064A\u062F \u0648\u0644\u0647 \u0641\u0631\u0635\u0629 \u062A\u0637\u0648\u064A\u0631 (80-89)", "\u0645\u0642\u0628\u0648\u0644 \u0648\u064A\u062D\u062A\u0627\u062C \u062A\u062F\u0642\u064A\u0642 (70-79)", "\u0636\u0639\u064A\u0641 \u0648\u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644"]
    },
    {
      "criterion": "\u0627\u0644\u0645\u0639\u064A\u0627\u0631 \u0627\u0644\u062A\u0642\u0646\u064A \u0627\u0644\u0641\u0631\u064A\u062F \u0644\u0633\u0631 \u0627\u0644\u0627\u0646\u062F\u0645\u0627\u062C",
      "weight": 25,
      "levels": ["\u0645\u0645\u062A\u0627\u0632 \u0648\u0645\u0643\u062A\u0645\u0644", "\u062C\u064A\u062F", "\u0645\u0642\u0628\u0648\u0644", "\u0636\u0639\u064A\u0641"]
    },
    {
      "criterion": "\u0645\u0646\u0647\u062C\u064A\u0629 \u0627\u0644\u062A\u0635\u0645\u064A\u0645 \u0648\u062A\u0645\u0627\u0633\u0643 \u0627\u0644\u0623\u0646\u0634\u0637\u0629",
      "weight": 25,
      "levels": ["\u0645\u0645\u062A\u0627\u0632 \u0648\u0645\u0643\u062A\u0645\u0644", "\u062C\u064A\u062F", "\u0645\u0642\u0628\u0648\u0644", "\u0636\u0639\u064A\u0641"]
    },
    {
      "criterion": "\u0627\u0644\u0648\u0636\u0648\u062D \u0648\u0627\u0644\u0639\u0631\u0636 \u0648\u0627\u0644\u062A\u0648\u062B\u064A\u0642 \u0648\u0627\u0644\u0645\u0644\u062D\u0642 \u0627\u0644\u062A\u0648\u0644\u064A\u062F\u064A",
      "weight": 25,
      "levels": ["\u0645\u0645\u062A\u0627\u0632 \u0648\u0645\u0643\u062A\u0645\u0644", "\u062C\u064A\u062F", "\u0645\u0642\u0628\u0648\u0644", "\u0636\u0639\u064A\u0641"]
    }
  ]
}`;
      const response = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.8
        }
      });
      const parsed = JSON.parse(response.text?.trim() || "{}");
      projectTitle = parsed.title || `\u062A\u0635\u0645\u064A\u0645 \u0628\u0631\u0645\u062C\u064A\u0629 \u0630\u0643\u064A\u0629 \u0644\u0644\u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062F\u0631\u0627\u0633\u064A\u0629 \u062F\u0645\u062C \u0645\u0647\u0627\u0631\u0627\u062A ${prefField}`;
      projectDesc = parsed.description || "\u062A\u0637\u0648\u064A\u0631 \u0628\u064A\u0626\u0629 \u0645\u0634\u0631\u0648\u0639\u0627\u062A \u062A\u0643\u0646\u0648\u0644\u0648\u062C\u064A\u0629 \u0646\u0634\u0637\u0629 \u062A\u062E\u062F\u0645 \u062A\u062D\u0633\u064A\u0646 \u0623\u0633\u0627\u0644\u064A\u0628 \u0627\u0644\u0641\u0647\u0645.";
      requirements = parsed.requirements || [
        "\u0625\u0639\u062F\u0627\u062F \u0646\u0645\u0648\u0630\u062C \u062A\u0637\u0628\u064A\u0642\u064A \u0645\u062A\u0643\u0627\u0645\u0644 \u0644\u0644\u0645\u0641\u0647\u0648\u0645 \u0627\u0644\u0645\u062E\u062A\u0627\u0631.",
        "\u062A\u0648\u0638\u064A\u0641 \u0628\u0631\u0645\u062C\u064A\u0629 \u0645\u062E\u0631\u062C\u0629 \u0631\u0642\u0645\u064A\u0629 \u062C\u0627\u0647\u0632\u0629 \u0644\u0644\u0645\u0639\u0627\u064A\u0646\u0629.",
        "\u0635\u064A\u0627\u063A\u0629 \u062E\u0637\u0629 \u062A\u0642\u0648\u064A\u0645 \u0648\u0627\u062E\u062A\u0628\u0627\u0631 \u0642\u0628\u0644\u064A\u0629 \u0648\u0628\u0639\u062F\u064A\u0629 \u0644\u0644\u0637\u0644\u0628\u0629.",
        "\u0643\u062A\u0627\u0628\u0629 \u062A\u0642\u0631\u064A\u0631 \u062A\u0648\u0642\u064A\u0639 \u0623\u0643\u0627\u062F\u064A\u0645\u064A \u0641\u0631\u062F\u064A \u0645\u0644\u062D\u0642 \u0628\u0627\u0644\u0645\u0646\u0635\u0629."
      ];
      steps = parsed.steps || [
        "\u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u062C\u0627\u062A \u0648\u062A\u0648\u0635\u064A\u0641 \u0627\u0644\u0641\u0626\u0629 \u0627\u0644\u0645\u0633\u062A\u0647\u062F\u0641\u0629 \u0628\u062F\u0642\u0629.",
        "\u062A\u0635\u0645\u064A\u0645 \u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062F\u0641\u0642 \u0644\u0644\u0623\u062F\u0627\u0629 \u0648\u0627\u0644\u0633\u064A\u0646\u0627\u0631\u064A\u0648 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A \u0627\u0644\u0645\u0635\u0627\u062D\u0628.",
        "\u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0648\u062A\u0631\u0643\u064A\u0628 \u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0645\u0644\u0635\u0642\u0627\u062A \u0627\u0644\u062A\u0641\u0627\u0639\u0644\u064A\u0629.",
        "\u0625\u062F\u0631\u0627\u062C \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062A\u0642\u064A\u064A\u0645 Rubric \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A \u0627\u0644\u0645\u0648\u0644\u062F \u0641\u064A \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0646\u0647\u0627\u0626\u064A \u0648\u062A\u0633\u0644\u064A\u0645\u0647."
      ];
      rubric = parsed.rubric || [
        {
          criterion: "\u062C\u0648\u062F\u0629 \u0627\u0644\u062A\u0648\u0637\u064A\u0646 \u0648\u0627\u0644\u062A\u0648\u0627\u0641\u0642 \u0645\u0639 \u0627\u0644\u0645\u062C\u0627\u0644 \u0627\u0644\u0645\u0641\u0636\u0644",
          weight: 25,
          levels: [
            "\u0645\u0643\u062A\u0645\u0644 \u0648\u0642\u0648\u064A \u0648\u0628\u0635\u0645\u0629 \u0634\u062E\u0635\u064A\u0629 \u0648\u0627\u0636\u062D\u0629",
            "\u0645\u0642\u0628\u0648\u0644 \u0645\u0639 \u062D\u0627\u062C\u0629 \u062A\u0639\u062F\u064A\u0644 \u062E\u0641\u064A\u0641\u0629",
            "\u0636\u0639\u064A\u0641 \u0648\u0628\u062D\u0627\u062C\u0629 \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0646\u0634\u0631"
          ]
        }
      ];
    } catch (e) {
      console.log(
        "Gemini project generation failed, falling back to rule-based engine."
      );
    }
  }
  if (!projectTitle) {
    if (prefField === "\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A") {
      projectTitle = `\u062A\u0635\u0645\u064A\u0645 \u0646\u0634\u0627\u0637 \u062A\u0639\u0644\u0651\u0645 \u0645\u062A\u0643\u0627\u0645\u0644 \u0644\u0644\u0639\u0644\u0648\u0645 \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0627\u0644\u062A\u0648\u0644\u064A\u062F\u064A \u0644\u0645\u0643\u0627\u0641\u062D\u0629 \u062A\u062F\u0646\u064A \u062F\u0627\u0641\u0639\u064A\u0629 \u0627\u0644\u062A\u0639\u0644\u064A\u0645 \u0644\u0637\u0644\u0628\u0629 ${targetLearner}`;
      projectDesc = `\u0635\u064A\u0627\u063A\u0629 \u062E\u0637\u0629 \u062F\u0631\u0627\u0633\u064A\u0629 \u062A\u0641\u0627\u0639\u0644\u064A\u0629 \u064A\u062A\u0642\u0645\u0635 \u0641\u064A\u0647\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u062F\u0648\u0631 \u0645\u0635\u0645\u0645 \u062A\u0642\u0646\u064A \u064A\u0648\u0638\u0641 \u0631\u0648\u0628\u0648\u062A\u0627\u062A \u0645\u062E\u0635\u0635\u0629 \u0623\u0648 \u0623\u062F\u0648\u0627\u062A \u062A\u0648\u0644\u064A\u062F \u0644\u062A\u0639\u0636\u064A\u062F \u0627\u0633\u062A\u064A\u0639\u0627\u0628 \u0645\u0641\u0627\u0647\u064A\u0645 \u0635\u0639\u0628\u0629\u060C \u0645\u0639 \u0634\u0631\u062D \u0622\u0644\u064A\u0627\u062A \u0627\u0644\u062A\u0642\u064A\u064A\u0645 \u0627\u0644\u0645\u0646\u0647\u062C\u064A\u0629.`;
      requirements = [
        "\u0623\u0646 \u064A\u062A\u0636\u0645\u0646 \u0633\u064A\u0646\u0627\u0631\u064A\u0648 \u0648\u0627\u0642\u0639\u064A \u0644\u062F\u0645\u062C \u0631\u0648\u0628\u0648\u062A \u062A\u0639\u0644\u064A\u0645\u064A \u0641\u064A \u0627\u0644\u0634\u0631\u062D \u0644\u062A\u0628\u0633\u064A\u0637 \u0627\u0644\u0645\u0627\u062F\u0629.",
        "\u062A\u0648\u0636\u064A\u062D \u0622\u0644\u064A\u0629 \u062A\u062F\u0631\u064A\u0628 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0627\u0644\u0645\u0648\u062C\u0647 \u0644\u062A\u062C\u0646\u0628 \u062A\u0632\u064A\u064A\u0641 \u0627\u0644\u062D\u0642\u0627\u0626\u0642 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629.",
        "\u062A\u0635\u0645\u064A\u0645 \u0646\u0645\u0648\u0630\u062C \u062A\u0642\u0648\u064A\u0645 \u0648\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0644\u0636\u0645\u0627\u0646 \u0639\u062F\u0645 \u0627\u0644\u0627\u062A\u0643\u0627\u0644\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u0622\u0644\u0629.",
        "\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u062A\u0642\u0631\u064A\u0631 \u0646\u0647\u0627\u0626\u064A \u0645\u0637\u0628\u0648\u0639 \u0648\u0645\u0648\u062B\u0642 \u0628\u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0630\u0643\u064A."
      ];
      steps = [
        "\u062A\u062D\u062F\u064A\u062F \u062F\u0631\u0633 \u0627\u0644\u0639\u0644\u0648\u0645 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A \u0648\u062A\u0641\u0643\u064A\u0643 \u0627\u0644\u0645\u0641\u0627\u0647\u064A\u0645 \u0627\u0644\u0635\u0639\u0628\u0629 \u0628\u0647.",
        "\u062A\u0635\u0645\u064A\u0645 \u062E\u0637\u0629 \u0627\u0644\u062D\u0648\u0627\u0631 (Prompt Engineering Guide) \u0627\u0644\u062A\u064A \u0633\u064A\u0633\u062A\u062E\u062F\u0645\u0647\u0627 \u0627\u0644\u0637\u0644\u0628\u0629.",
        "\u0625\u0639\u062F\u0627\u062F \u062C\u062F\u0648\u0644 \u0645\u0642\u0627\u0631\u0646\u0629 \u0644\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0646\u062A\u0642\u0627\u0629 \u0644\u0644\u0645\u0633\u062A\u0648\u064A\u0627\u062A \u0627\u0644\u0645\u062E\u062A\u0644\u0641\u0629.",
        "\u0625\u0631\u0641\u0627\u0642 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062A\u0648\u0637\u064A\u0646 \u0648\u0627\u0644\u0639\u0631\u0636 \u0648\u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A \u0627\u0644\u0634\u0627\u0645\u0644."
      ];
    } else if (prefField === "\u0627\u0644\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u0639\u0632\u0632") {
      projectTitle = `\u062A\u0635\u0645\u064A\u0645 \u0644\u0648\u062D\u0629 \u0648\u0645\u062C\u0633\u0645\u0627\u062A \u062A\u0641\u0627\u0639\u0644\u064A\u0629 \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u0639\u0632\u0632 (AR) \u0644\u062A\u0628\u0633\u064A\u0637 \u0627\u0644\u0645\u0641\u0627\u0647\u064A\u0645 \u0627\u0644\u0645\u062C\u0631\u062F\u0629 \u0644\u0637\u0644\u0628\u0629 ${targetLearner}`;
      projectDesc = `\u064A\u0647\u062F\u0641 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0625\u0644\u0649 \u0627\u0644\u062A\u062E\u0637\u064A\u0637 \u0644\u062A\u062C\u0631\u0628\u0629 \u0648\u0627\u0642\u0639 \u0645\u0639\u0632\u0632 \u062D\u064A\u0629 (AR Magic Board) \u062A\u062A\u064A\u062D \u0644\u0644\u0637\u0644\u0628\u0629 \u0627\u0644\u062A\u0641\u0627\u0639\u0644 \u0645\u0639 \u062C\u062F\u0627\u0631\u064A\u0627\u062A \u0623\u0648 \u0635\u0648\u0631 \u0645\u0627\u062F\u064A\u0629 \u0648\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0623\u0628\u0639\u0627\u062F \u0627\u0644\u062B\u0644\u0627\u062B\u064A\u0629 \u0644\u0647\u0627 \u0644\u062A\u0628\u0633\u064A\u0637 \u0627\u0644\u0641\u0647\u0645 \u0627\u0644\u0645\u0639\u0645\u0644\u064A.`;
      requirements = [
        "\u062A\u0648\u0635\u064A\u0641 \u0627\u0644\u0623\u062F\u0627\u0629 \u0627\u0644\u062A\u0643\u0646\u0648\u0644\u0648\u062C\u064A\u0629 \u0627\u0644\u062A\u0641\u0627\u0639\u0644\u064A\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629 (\u0645\u062B\u0644 CoSpaces \u0623\u0648 Assemblr EDU).",
        "\u062A\u0623\u0633\u064A\u0633 \u0645\u062E\u0637\u0637 \u062E\u0627\u0631\u062C\u064A \u0644\u063A\u0631\u0641\u0629 \u0627\u0644\u0635\u0641 \u0648\u0627\u0644\u062A\u0646\u0642\u0644 \u0627\u0644\u0637\u0644\u0627\u0628\u064A \u062F\u0627\u062E\u0644\u0647\u0627.",
        "\u0631\u0633\u0645 \u062E\u0631\u0627\u0626\u0637 \u0627\u0644\u0631\u0628\u0637 \u0627\u0644\u0628\u0635\u0631\u064A \u0648\u062A\u0635\u0645\u064A\u0645 \u0627\u0644\u0631\u0645\u0648\u0632 \u0627\u0644\u062A\u0648\u0636\u064A\u062D\u064A\u0629 \u0644\u0644\u0645\u0634\u0627\u0647\u062F.",
        "\u0646\u0645\u0648\u0630\u062C \u0644\u0644\u062A\u0642\u0648\u064A\u0645 \u0645\u0633\u062A\u0646\u062F\u0627\u064B \u0644\u0640 Rubric \u0627\u0644\u0623\u062F\u0627\u0621 \u0648\u0627\u0644\u0625\u0646\u062A\u0627\u062C \u0627\u0644\u0631\u0642\u0645\u064A."
      ];
      steps = [
        "\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0648\u062D\u062F\u0629 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A\u0629 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631 \u0648\u0625\u0646\u0634\u0627\u0621 \u0645\u062C\u0633\u0645\u0627\u062A\u0647\u0627 \u0648\u0631\u0628\u0637\u0647\u0627 \u0628\u0627\u0644\u0647\u0648\u0627\u062A\u0641.",
        "\u0631\u0633\u0645 \u0646\u0645\u0648\u0630\u062C \u0623\u0648\u0644\u064A \u064A\u062F\u0648\u064A \u0644\u0644\u0628\u0637\u0627\u0642\u0627\u062A \u0648\u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062A \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0644\u0644\u062F\u0631\u0633.",
        "\u0641\u062D\u0635 \u062C\u0627\u0647\u0632\u064A\u0629 \u0627\u0644\u062A\u0641\u0627\u0639\u0644 \u0641\u064A \u0628\u064A\u0626\u0629 \u062A\u062C\u0631\u064A\u0628\u064A\u0629 \u0645\u0639 \u0639\u062F\u062F \u0645\u0646 \u0627\u0644\u0623\u0642\u0631\u0627\u0646.",
        "\u0631\u0641\u0639 \u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u062E\u062A\u0627\u0645\u064A \u0648\u0635\u0648\u0631 \u0645\u0646 \u0627\u0644\u062A\u062C\u0631\u0628\u0629 \u0641\u064A \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u0646\u062C\u0627\u0632."
      ];
    } else {
      projectTitle = `\u062A\u0635\u0645\u064A\u0645 \u062F\u0631\u0633 \u0631\u0642\u0645\u064A \u0642\u0627\u0626\u0645 \u0639\u0644\u0649 \u0627\u0644\u062A\u0644\u0639\u064A\u0628 (Gamification) \u0644\u062A\u0639\u0632\u064A\u0632 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0625\u064A\u062C\u0627\u0628\u064A\u0629 \u0648\u0627\u0644\u062A\u0639\u0644\u0645 \u0627\u0644\u0628\u0646\u0627\u0626\u064A \u0644\u0637\u0644\u0628\u0629 ${targetLearner}`;
      projectDesc = `\u0625\u0646\u0634\u0627\u0621 \u0628\u064A\u0626\u0629 \u0645\u0647\u0627\u0645 \u062A\u0641\u0627\u0639\u0644\u064A\u0629 \u062A\u0647\u062F\u0641 \u0644\u062F\u0645\u062C \u0645\u064A\u0643\u0627\u0646\u064A\u0643\u064A\u0627\u062A \u0627\u0644\u0623\u0644\u0639\u0627\u0628 (\u0646\u0642\u0627\u0637\u060C \u0623\u0648\u0633\u0645\u0629\u060C \u0645\u0633\u062A\u0648\u064A\u0627\u062A\u060C \u0645\u062A\u0635\u062F\u0631\u064A\u0646) \u0641\u064A \u0628\u064A\u0626\u0629 \u062C\u0627\u0645\u0639\u064A\u0629 \u0623\u0648 \u0635\u0641\u064A\u0629 \u062A\u0632\u064A\u062F \u062F\u0627\u0641\u0639\u064A\u0629 \u0627\u0644\u062A\u0639\u0644\u0645 \u0648\u062A\u0628\u0646\u064A \u062A\u0641\u0648\u0642 \u062A\u0641\u0627\u0639\u0644\u064A \u062D\u0642\u064A\u0642\u064A.`;
      requirements = [
        "\u062A\u062D\u062F\u064A\u062F 3 \u0622\u0644\u064A\u0627\u062A \u0644\u0644\u062A\u0644\u0639\u064A\u0628 \u0645\u0646\u062A\u0642\u0627\u0629 \u0628\u0639\u0646\u0627\u064A\u0629 \u062A\u062E\u062F\u0645 \u0627\u0644\u0641\u0647\u0645 \u0627\u0644\u0645\u0628\u0627\u0634\u0631.",
        "\u0648\u062C\u0648\u062F \u0633\u0631\u062F \u0642\u0635\u0635\u064A (narrative) \u064A\u0631\u0628\u0637 \u0627\u0644\u0645\u0647\u0627\u0645 \u0628\u0628\u0639\u0636\u0647\u0627.",
        "\u0648\u062C\u0648\u062F \u062A\u063A\u0630\u064A\u0629 \u0631\u0627\u062C\u0639\u0629 \u062A\u0641\u0627\u0639\u0644\u064A\u0629 \u0641\u0648\u0631\u064A\u0629 \u0648\u0645\u0633\u062A\u0648\u0649 \u0625\u0646\u0642\u0627\u0630 \u0644\u0644\u0645\u062A\u0639\u062B\u0631\u064A\u0646.",
        "\u0625\u0631\u0641\u0627\u0642 \u0645\u0633\u062A\u0646\u062F \u0627\u0644\u062A\u0642\u064A\u064A\u0645 \u0627\u0644\u0634\u0627\u0645\u0644 \u0644\u0644\u062D\u0642\u064A\u0628\u0629 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A\u0629 \u0627\u0644\u0645\u0635\u0645\u0645\u0629."
      ];
      steps = [
        "\u0635\u064A\u0627\u063A\u0629 \u0642\u0635\u0629 \u0627\u0644\u062A\u0644\u0639\u064A\u0628 \u0648\u0627\u0644\u0634\u062E\u0635\u064A\u0629 \u0627\u0644\u0628\u0637\u0648\u0644\u064A\u0629 \u0644\u0644\u0637\u0644\u0628\u0629.",
        "\u0631\u0633\u0645 \u0634\u062C\u0631\u0629 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0648\u0643\u062A\u0627\u0628\u0629 \u0634\u0631\u0648\u0637 \u0627\u0644\u062A\u0631\u0642\u064A\u0629 \u0648\u0627\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0627\u0644\u0623\u0648\u0633\u0645\u0629.",
        "\u062A\u0630\u0644\u064A\u0644 \u0627\u0644\u0623\u062E\u0637\u0627\u0621 \u0639\u0628\u0631 \u062A\u062C\u0631\u0628\u0629 \u0627\u0644\u0644\u0639\u0628 (Playtesting Guide).",
        "\u062A\u0648\u0644\u064A\u062F \u0645\u0644\u0641 \u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0648\u0639\u0631\u0636\u0647 \u0644\u0644\u0627\u0633\u062A\u0639\u0631\u0627\u0636 \u0641\u064A \u0645\u0646\u0635\u0629 \u0627\u0644\u0645\u062E\u0631\u062C\u0627\u062A."
      ];
    }
    rubric = [
      {
        criterion: "\u0645\u0646\u0647\u062C\u064A\u0629 \u0627\u0644\u062F\u0645\u062C \u0648\u0627\u0644\u062A\u0648\u0638\u064A\u0641 \u0627\u0644\u062A\u0631\u0628\u0648\u064A \u0627\u0644\u0633\u0644\u064A\u0645 \u0641\u064A \u0627\u0644\u062A\u0635\u0645\u064A\u0645",
        weight: 30,
        levels: [
          "\u0645\u0645\u062A\u0639 \u0648\u0645\u0628\u062F\u0639 \u0648\u0645\u0635\u0627\u063A \u0628\u0630\u0643\u0627\u0621",
          "\u0645\u0646\u0647\u062C\u064A \u0648\u064A\u062D\u062A\u0627\u062C \u062A\u062F\u0639\u064A\u0645 \u0637\u0641\u064A\u0641",
          "\u062A\u0642\u0644\u064A\u062F\u064A \u064A\u0646\u0642\u0635 \u0627\u0644\u0625\u0628\u062F\u0627\u0639",
          "\u0636\u0639\u064A\u0641 \u0648\u063A\u064A\u0631 \u0645\u0646\u0627\u0633\u0628"
        ]
      },
      {
        criterion: "\u0627\u0644\u0631\u0624\u064A\u0629 \u0627\u0644\u062A\u0642\u0646\u064A\u0629 \u0648\u0627\u0644\u062A\u0648\u0627\u0641\u0642 \u0645\u0639 \u0627\u0647\u062A\u0645\u0627\u0645\u0627\u062A \u0628\u0635\u0645\u0629 \u0627\u0644\u0637\u0627\u0644\u0628",
        weight: 30,
        levels: [
          "\u062A\u0648\u0627\u0641\u0642 \u062A\u0627\u0645 \u0648\u0645\u062A\u0642\u0646 \u0648\u0645\u062A\u0645\u064A\u0632",
          "\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u062A\u0648\u0627\u0641\u0642 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A",
          "\u064A\u062D\u062A\u0627\u062C \u0644\u062A\u0639\u062F\u064A\u0644 \u0634\u0627\u0645\u0644",
          "\u0645\u0639\u062F\u0648\u0645"
        ]
      },
      {
        criterion: "\u0648\u0636\u0648\u062D \u0627\u0644\u0623\u0646\u0634\u0637\u0629 \u0648\u0627\u0644\u062E\u0637\u0648\u0627\u062A \u0648\u0642\u0627\u0628\u0644\u064A\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0648\u0627\u0642\u0639\u064A\u0629",
        weight: 20,
        levels: [
          "\u0645\u0645\u062A\u0627\u0632 \u062A\u0645\u0627\u0645\u0627\u064B \u0648\u0642\u0627\u0628\u0644 \u0644\u0644\u062A\u0643\u0631\u0627\u0631",
          "\u062C\u064A\u062F \u0648\u0645\u0646\u0638\u0645",
          "\u0645\u062D\u062F\u0648\u062F \u0627\u0644\u0641\u0627\u0639\u0644\u064A\u0629",
          "\u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u062A\u0646\u0641\u064A\u0630"
        ]
      },
      {
        criterion: "\u0627\u0644\u0647\u0648\u064A\u0629 \u0648\u0627\u0644\u062A\u062D\u0642\u0642 \u0648\u0635\u0628\u0627\u063A\u0629 Watermark \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629",
        weight: 20,
        levels: [
          "\u0627\u0644\u0628\u0635\u0645\u0629 \u0648\u0627\u0644\u0627\u0633\u0645 \u0637\u0627\u0647\u0631\u064A\u0646 \u0628\u0627\u0644\u0643\u0627\u0645\u0644",
          "\u062A\u0639\u062A\u064A\u0645 \u0637\u0641\u064A\u0641 \u0641\u064A \u0627\u0644\u0647\u0648\u064A\u0629 \u0648\u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629",
          "\u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0628\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0639\u0627\u064A\u0646"
        ]
      }
    ];
  }
  const newProject = {
    id: `P-${prefField === "\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A" ? "AI" : prefField === "\u0627\u0644\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u0639\u0632\u0632" ? "AR" : "GAME"}-${codeToken}`,
    studentId: student.id,
    studentName: student.name,
    studentIdNumber: student.id,
    sectionCode: student.sectionCode,
    pathwayCode: student.pathwayCode,
    title: projectTitle,
    description: projectDesc,
    targetLearner,
    technology: prefField,
    educationalProblem: "\u062A\u062F\u0646\u064A \u0627\u0644\u0627\u0646\u062F\u0645\u0627\u062C \u0648\u0643\u0633\u0644 \u0627\u0644\u062A\u0644\u0642\u064A\u0646 \u0627\u0644\u062A\u0642\u0644\u064A\u062F\u064A \u0644\u0644\u0645\u0642\u0631\u0631",
    productType: projectType,
    requirements,
    steps,
    rubric,
    dueDate: "2026-06-30",
    isGenerated: true,
    status: "generated",
    watermark: watermarkText
  };
  dbInstance.addPersonalizedProject(newProject);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u062A\u0648\u0644\u064A\u062F \u0645\u0634\u0631\u0648\u0639 \u0634\u062E\u0635\u064A \u0641\u0631\u064A\u062F",
    details: `\u062A\u0645 \u0625\u0637\u0644\u0627\u0642 \u062E\u0648\u0627\u0631\u0632\u0645\u064A\u0629 \u0627\u0644\u062A\u062E\u0635\u064A\u0635 \u0644\u062A\u0648\u0644\u064A\u062F \u0645\u0634\u0631\u0648\u0639 \u062A\u0637\u0628\u064A\u0642\u064A \u0641\u0631\u064A\u062F \u0628\u0631\u0642\u0645: ${newProject.id}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0645\u062D\u0631\u0643 \u0627\u0644\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0630\u0643\u064A",
    browser: "\u0646\u0638\u0627\u0645 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A",
    isViolationWarning: false
  });
  return res.json({ success: true, project: newProject });
});
var submissionUploadsDir = () => import_path2.default.join(process.cwd(), "data", "uploads");
var ensureSubmissionUploadsDir = () => {
  const dir = submissionUploadsDir();
  if (!import_fs2.default.existsSync(dir)) import_fs2.default.mkdirSync(dir, { recursive: true });
  return dir;
};
var sanitizeAttachmentOriginalName = (value) => {
  const base = import_path2.default.basename(String(value || "unnamed"));
  return base.replace(/[\r\n\0]/g, "").slice(0, 180) || "unnamed";
};
var MIRAS_ALLOWED_SUBMISSION_EXTENSIONS = [
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
  ".zip"
];
var MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL = "PDF\u060C Word\u060C PowerPoint\u060C Excel\u060C CSV\u060C TXT\u060C \u0635\u0648\u0631 JPG/PNG/WebP \u0623\u0648 ZIP";
var MIRAS_MAX_EMBEDDED_ATTACHMENT_DATA_URL_CHARS = 3e6;
function mirasDeadlineEndMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 1632 && code <= 1641) return String(code - 1632);
    if (code >= 1776 && code <= 1785) return String(code - 1776);
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
function mirasSubmissionFileExtension(fileName) {
  return import_path2.default.extname(String(fileName || "").split(/[?#]/)[0]).toLowerCase();
}
function mirasUnsupportedSubmissionFileResponse(fileName, ext) {
  const originalName = sanitizeAttachmentOriginalName(fileName || "\u0645\u0644\u0641");
  const suffix = ext ? ` (${ext})` : "";
  return {
    code: "UNSUPPORTED_FILE_TYPE",
    error: `\u0635\u064A\u063A\u0629 \u0627\u0644\u0645\u0644\u0641 "${originalName}" \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645\u0629${suffix}. \u0627\u0644\u0635\u064A\u063A \u0627\u0644\u0645\u062A\u0627\u062D\u0629: ${MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL}.`
  };
}
function isMirasSubmissionFileTypeAllowed(fileName) {
  const ext = mirasSubmissionFileExtension(fileName);
  return !!ext && MIRAS_ALLOWED_SUBMISSION_EXTENSIONS.includes(ext);
}
app.post("/api/submissions/upload", (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u062E\u062A\u064A\u0627\u0631 \u0623\u064A \u0645\u0644\u0641 \u0644\u0644\u0631\u0641\u0639" });
  }
  const uploadedFile = req.files.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0631\u0641\u0648\u0639 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  }
  const fileArray = Array.isArray(uploadedFile) ? uploadedFile : [uploadedFile];
  const targetFile = fileArray[0];
  const maxSizeBytes = 25 * 1024 * 1024;
  if (targetFile.size > maxSizeBytes) {
    return res.status(400).json({ error: "\u062D\u062C\u0645 \u0627\u0644\u0645\u0644\u0641 \u064A\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0627\u0644\u0645\u0633\u0645\u0648\u062D \u0628\u0647 (25 \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A)" });
  }
  const originalName = sanitizeAttachmentOriginalName(targetFile.name || "unnamed");
  const ext = import_path2.default.extname(originalName).toLowerCase();
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
    ".scr"
  ];
  if (dangerousExtensions.includes(ext)) {
    return res.status(415).json({
      code: "FILE_TYPE_NOT_ALLOWED",
      error: `\u0635\u064A\u063A\u0629 \u0627\u0644\u0645\u0644\u0641 "${originalName}" \u063A\u064A\u0631 \u0645\u0633\u0645\u0648\u062D\u0629. \u0627\u0644\u0635\u064A\u063A \u0627\u0644\u0645\u062A\u0627\u062D\u0629: ${MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL}.`
    });
  }
  if (!isMirasSubmissionFileTypeAllowed(originalName)) {
    return res.status(415).json(mirasUnsupportedSubmissionFileResponse(originalName, ext));
  }
  const mimeType = (targetFile.mimetype || "").toLowerCase();
  const dangerousMimeTypes = [
    "application/x-msdownload",
    "application/x-sh",
    "application/javascript",
    "text/html",
    "application/x-httpd-php",
    "application/java-archive"
  ];
  if (dangerousMimeTypes.some((m) => mimeType.includes(m))) {
    return res.status(415).json({
      code: "FILE_TYPE_NOT_ALLOWED",
      error: `\u0635\u064A\u063A\u0629 \u0627\u0644\u0645\u0644\u0641 "${originalName}" \u063A\u064A\u0631 \u0645\u0633\u0645\u0648\u062D\u0629. \u0627\u0644\u0635\u064A\u063A \u0627\u0644\u0645\u062A\u0627\u062D\u0629: ${MIRAS_ALLOWED_SUBMISSION_FORMATS_LABEL}.`
    });
  }
  const uploadsDir = ensureSubmissionUploadsDir();
  const fileId = "file-" + Math.random().toString(36).substring(2, 9) + "-" + Date.now();
  const storedName = `${fileId}${ext}`;
  const filePath = import_path2.default.join(uploadsDir, storedName);
  targetFile.mv(filePath, async (err) => {
    if (err) {
      console.error("Error moving uploaded file:", err);
      return res.status(500).json({ error: "\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0627\u0644\u0645\u0644\u0641 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645" });
    }
    const attachmentUrl = `/api/submission-attachments/${fileId}`;
    let fileBuffer;
    try {
      fileBuffer = Buffer.isBuffer(targetFile.data) && targetFile.data.length ? targetFile.data : import_fs2.default.readFileSync(filePath);
    } catch {
      return res.status(500).json({
        error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0641 \u0628\u0639\u062F \u0631\u0641\u0639\u0647. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.",
        code: "ATTACHMENT_READ_FAILED"
      });
    }
    const archived = await dbInstance.saveSubmissionAttachmentArchive({
      fileId,
      originalName,
      mimeType: mimeType || "application/octet-stream",
      size: targetFile.size,
      storedName,
      base64: fileBuffer.toString("base64")
    });
    if (!archived) {
      return res.status(503).json({
        error: "\u062A\u0639\u0630\u0631 \u062A\u0623\u0643\u064A\u062F \u062D\u0641\u0638 \u0627\u0644\u0645\u0631\u0641\u0642 \u0641\u064A \u0627\u0644\u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0633\u062D\u0627\u0628\u064A. \u0644\u0645 \u0646\u0633\u062C\u0644 \u0631\u0641\u0639\u064B\u0627 \u0648\u0647\u0645\u064A\u064B\u0627\u061B \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0628\u0639\u062F \u0642\u0644\u064A\u0644.",
        code: "ATTACHMENT_CLOUD_ARCHIVE_FAILED"
      });
    }
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
      uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
      persisted: true,
      archived: true,
      cloudPersisted: true
    };
    return res.json({ success: true, attachment });
  });
});
app.get("/api/submission-attachments/:fileId", async (req, res) => {
  const requestedId = submissionAttachmentFileIdFromValue(req.params.fileId) || String(req.params.fileId || "").trim();
  const uploadsDir = submissionUploadsDir();
  if (!requestedId) {
    return res.status(404).json({ error: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  }
  const submission = findSubmissionByAttachmentId(requestedId);
  if (!submission) {
    return res.status(404).json({ error: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  }
  const teacherEmail = teacherEmailFromRequest(req);
  const session = verifyMirasSessionToken(req);
  if (teacherEmail) {
    const courseCode = String(
      submission.courseCode || submission.sectionCode || ""
    );
    const submissionOwner = String(
      submission.teacherEmail || submission.createdBy || sectionOwnerEmail(courseCode) || ""
    ).toLowerCase();
    if (!isAdminEmail(teacherEmail) && submissionOwner && submissionOwner !== teacherEmail) {
      return res.status(403).json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D \u0644\u0643 \u0628\u0641\u062A\u062D \u0647\u0630\u0627 \u0627\u0644\u0645\u0631\u0641\u0642." });
    }
  } else if (session?.role !== "student" || normalizeStudentId(session.userId) !== normalizeStudentId(submission.studentId)) {
    return res.status(403).json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D \u0644\u0643 \u0628\u0641\u062A\u062D \u0647\u0630\u0627 \u0627\u0644\u0645\u0631\u0641\u0642." });
  }
  if (!import_fs2.default.existsSync(uploadsDir)) {
    const archive = await dbInstance.getSubmissionAttachmentArchive(requestedId);
    if (sendStoredSubmissionAttachmentBuffer(res, archive)) return;
    const fallback = findStoredSubmissionAttachmentDataUrl(requestedId);
    if (sendStoredSubmissionAttachmentDataUrl(res, fallback)) return;
    return res.status(404).json({ error: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  }
  const files = import_fs2.default.readdirSync(uploadsDir);
  const matchedFile = files.find(
    (f) => f === requestedId || f.startsWith(`${requestedId}.`)
  );
  if (!matchedFile) {
    const archive = await dbInstance.getSubmissionAttachmentArchive(requestedId);
    if (sendStoredSubmissionAttachmentBuffer(res, archive)) return;
    const fallback = findStoredSubmissionAttachmentDataUrl(requestedId);
    if (sendStoredSubmissionAttachmentDataUrl(res, fallback)) return;
    return res.status(404).json({ error: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631 \u0623\u0648 \u062A\u0645 \u062D\u0630\u0641\u0647" });
  }
  const filePath = import_path2.default.join(uploadsDir, matchedFile);
  const stat = import_fs2.default.existsSync(filePath) ? import_fs2.default.statSync(filePath) : null;
  if (!stat || !stat.isFile()) {
    const archive = await dbInstance.getSubmissionAttachmentArchive(requestedId);
    if (sendStoredSubmissionAttachmentBuffer(res, archive)) return;
    const fallback = findStoredSubmissionAttachmentDataUrl(requestedId);
    if (sendStoredSubmissionAttachmentDataUrl(res, fallback)) return;
    return res.status(404).json({ error: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631 \u0623\u0648 \u062A\u0645 \u062D\u0630\u0641\u0647" });
  }
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(matchedFile)}`
  );
  return res.sendFile(filePath);
});
app.post("/api/projects/submit", (req, res) => {
  const { projectId, submissionText, submissionFileName, submissionFile } = req.body;
  const project = dbInstance.getPersonalizedProjects().find((p) => p.id === projectId);
  if (!project)
    return res.status(404).json({ error: "\u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631" });
  if (project.status === "submitted" || project.status === "graded") {
    return res.status(409).json({
      error: "\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0645\u0633\u0628\u0642\u0627\u064B \u0648\u062A\u0645 \u0642\u0641\u0644\u0647. \u0644\u0627 \u064A\u0641\u062A\u062D \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0625\u0644\u0627 \u0628\u0639\u062F \u0625\u0631\u062C\u0627\u0639\u0647 \u0645\u0646 \u0627\u0644\u0645\u0639\u0644\u0645."
    });
  }
  const hasProjectText = String(submissionText || "").trim().length > 0;
  const hasProjectFile = !!submissionFile || String(submissionFileName || "").trim().length > 0;
  if (!hasProjectText && !hasProjectFile) {
    return res.status(400).json({
      error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0633\u0644\u064A\u0645 \u0645\u0634\u0631\u0648\u0639 \u0641\u0627\u0631\u063A. \u0623\u0636\u0641 \u0646\u0635\u0627\u064B \u0623\u0648 \u0623\u0631\u0641\u0642 \u0645\u0644\u0641\u0627\u064B \u0642\u0628\u0644 \u0627\u0644\u062A\u0633\u0644\u064A\u0645."
    });
  }
  if (String(submissionFileName || "").trim() && !isMirasSubmissionFileTypeAllowed(submissionFileName)) {
    return res.status(415).json(mirasUnsupportedSubmissionFileResponse(submissionFileName));
  }
  const closeMs = project.closeDate ? mirasDeadlineEndMs(project.closeDate) : 0;
  if (closeMs && Number.isFinite(closeMs) && closeMs < Date.now() && !getActiveReturnException("project", project.id, project.studentId)) {
    return res.status(403).json({
      error: "\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0645\u0634\u0631\u0648\u0639. \u064A\u062D\u062A\u0627\u062C \u0627\u0644\u0637\u0627\u0644\u0628 \u0625\u0644\u0649 \u0646\u0627\u0641\u0630\u0629 \u0627\u0633\u062A\u062B\u0646\u0627\u0621 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630."
    });
  }
  const projectLateDeadlineMs = mirasDeadlineEndMs(
    project.closeDate || project.dueDate || ""
  );
  const projectSubmittedLate = !!(projectLateDeadlineMs && Number.isFinite(projectLateDeadlineMs) && Date.now() > projectLateDeadlineMs);
  const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
  dbInstance.updatePersonalizedProject(projectId, {
    submissionText,
    submissionFile,
    submissionFileName,
    status: "submitted",
    submittedAt,
    submittedLate: projectSubmittedLate,
    resubmittedAt: project.status === "returned" ? submittedAt : project.resubmittedAt
  });
  const student = dbInstance.getStudents().find((s) => s.id === project.studentId);
  const courseCode = String(
    project.courseCode || project.sectionCode || ""
  ).trim();
  const teacherSubmission = upsertRuntimeTeacherSubmission({
    id: `project-${project.id}-${project.studentId}`,
    kind: "project",
    activityId: project.id,
    activityTitle: project.title || "\u0645\u0634\u0631\u0648\u0639 \u0634\u062E\u0635\u064A",
    courseCode,
    studentId: project.studentId,
    studentName: student?.name || project.studentName || project.studentId,
    answerText: String(submissionText || "").trim() || "\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0628\u0645\u0631\u0641\u0642 \u0648\u0645\u0633\u062A\u0646\u062F\u0627\u062A.",
    fileName: submissionFileName || "",
    submissionFileName: submissionFileName || "",
    hasSubmissionFile: !!submissionFile,
    status: "\u0645\u0642\u0641\u0644 \u0628\u0639\u062F \u0627\u0644\u062A\u0633\u0644\u064A\u0645",
    submittedAt,
    updatedAt: submittedAt,
    submittedLate: projectSubmittedLate,
    source: "personalized_project",
    personalizedProject: true
  });
  if (student) {
    dbInstance.updateStudent(student.id, {
      progress: Math.min(100, student.progress + 30)
      // Add 30% progress
    });
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u062A\u0633\u0644\u064A\u0645 \u0645\u0634\u0631\u0648\u0639 \u0646\u0647\u0627\u0626\u064A",
      details: `\u0642\u0627\u0645 \u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u062A\u0633\u0644\u064A\u0645 \u0645\u0634\u0631\u0648\u0639\u0647 \u0627\u0644\u0634\u062E\u0635\u064A (${project.title}) \u0628\u0646\u062C\u0627\u062D \u0644\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u0627\u0644\u062A\u0642\u064A\u064A\u0645.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u0633\u062A\u0646\u062F \u0627\u0644\u0637\u0627\u0644\u0628",
      browser: "\u0627\u0644\u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A",
      isViolationWarning: false
    });
  }
  return res.json({ success: true, submission: teacherSubmission });
});
app.post("/api/projects/:id/grade", (req, res) => {
  const { grade, feedback } = req.body;
  const project = dbInstance.getPersonalizedProjects().find((p) => p.id === req.params.id);
  if (!project)
    return res.status(404).json({ error: "\u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631 \u0644\u0644\u062A\u062F\u0642\u064A\u0642" });
  dbInstance.updatePersonalizedProject(project.id, {
    grade: Number(grade),
    gradeFeedback: feedback,
    status: "graded",
    gradedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const student = dbInstance.getStudents().find((s) => s.id === project.studentId);
  if (student) {
    dbInstance.updateStudent(student.id, {
      score: student.score + Number(grade) * 2,
      // point boost for projects
      progress: Math.min(100, student.progress + 15)
    });
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u062A\u0642\u064A\u064A\u0645 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0627\u062F\u0629",
      details: `\u062A\u0645 \u0627\u0644\u0627\u0646\u062A\u0647\u0627\u0621 \u0645\u0646 \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0648\u0631\u0635\u062F \u0639\u0644\u0627\u0645\u0629: ${grade}/100 \u0628\u0646\u062C\u0627\u062D \u0645\u0639 \u0635\u064A\u0627\u063A\u0629 \u0627\u0644\u0645\u0628\u0631\u0631\u0627\u062A \u0648\u0627\u0644\u062F\u0631\u0648\u0633 \u0627\u0644\u0645\u0633\u062A\u0641\u0627\u062F\u0629.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
      browser: "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u064A\u0628",
      isViolationWarning: false
    });
  }
  return res.json({ success: true });
});
app.post("/api/payment/simulate", (req, res) => {
  const { studentId, paymentMethod, amount } = req.body;
  const student = dbInstance.getStudents().find((s) => s.id === String(studentId));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  dbInstance.updateStudent(student.id, { isPaid: true });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: "\u0633\u062F\u0627\u062F \u0631\u0645\u0632\u064A \u0644\u0644\u062E\u062F\u0645\u0627\u062A",
    details: `\u062A\u0645 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0628\u0646\u062C\u0627\u062D \u0641\u064A \u0645\u062E\u062A\u0628\u0631 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0648\u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0628\u0645\u0628\u0644\u063A ${amount || "15"} \u062F.\u0643 \u0639\u0628\u0631 \u0628\u0648\u0627\u0628\u0629 (${paymentMethod}) \u0648\u0631\u0642\u0645 \u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0629: KNET-${Math.floor(1e5 + Math.random() * 9e5)}`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u0633\u062F\u0627\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A",
    browser: "\u0645\u0635\u062F\u0642 \u0643\u0648\u064A\u062A\u064A",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    invoice: {
      transactionId: `TXN-${Math.floor(1e5 + Math.random() * 9e5)}`,
      date: (/* @__PURE__ */ new Date()).toISOString(),
      studentName: student.name,
      studentId: student.id,
      amount: amount || "15 \u062F.\u0643",
      method: paymentMethod,
      semester: student.semester,
      status: "\u0645\u062F\u0641\u0648\u0639 \u0628\u0646\u062C\u0627\u062D"
    }
  });
});
function processStudentCourseActivation(req, res, studentId, joinCodeRaw, registrationParams) {
  const normStudentId = normalizeStudentId(studentId);
  const normJoinCode = normalizeJoinCode(joinCodeRaw);
  const compactCode = compactJoinCode(joinCodeRaw);
  ensureDeviceSecretCookie(req, res);
  if (!normStudentId || !normJoinCode) {
    return res.status(400).json(activationFailurePayload("ACTIVATION_INPUT_MISSING", "\u0627\u0644\u0631\u062C\u0627\u0621 \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0648\u0643\u0648\u062F \u0627\u0644\u062A\u0641\u0639\u064A\u0644."));
  }
  const rateLimitStudent = {
    id: normStudentId,
    name: registrationParams?.name || normStudentId
  };
  if (sendActivationRateLimitIfNeeded(req, res, {
    code: joinCodeRaw,
    student: rateLimitStudent
  })) {
    return;
  }
  const allCodes = dbInstance.getJoinCodes();
  const foundCode = allCodes.find(
    (jc) => isUnifiedJoinCode(jc.code) && (normalizeJoinCode(jc.code) === normJoinCode || compactJoinCode(jc.code) === compactCode)
  );
  if (!foundCode) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId, name: registrationParams?.name || normStudentId },
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F"
    });
    return res.status(404).json(activationFailurePayload("INVALID_CODE", "\u0627\u0644\u0643\u0648\u062F \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u060C \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."));
  }
  const signatureState = ensureJoinCodeSignature(foundCode);
  if (!signatureState.ok) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId, name: registrationParams?.name || normStudentId },
      reason: "\u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0643\u0648\u062F \u063A\u064A\u0631 \u0635\u062D\u064A\u062D",
      foundCode
    });
    return res.status(400).json(activationFailurePayload("INVALID_CODE", "\u0627\u0644\u0643\u0648\u062F \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u060C \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."));
  }
  if (foundCode.status === "revoked") {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId },
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0645\u0644\u063A\u0649",
      foundCode
    });
    return res.status(400).json(activationFailurePayload("CODE_REVOKED", "\u0627\u0644\u0643\u0648\u062F \u0645\u0648\u0642\u0648\u0641 \u0623\u0648 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."));
  }
  if (isSoftDeletedRecord(foundCode) || isArchivedJoinCodeRecord(foundCode)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId },
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0645\u0624\u0631\u0634\u0641 \u0623\u0648 \u0645\u062D\u0630\u0648\u0641",
      foundCode
    });
    return res.status(410).json(activationFailurePayload("CODE_ARCHIVED", "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0645\u0624\u0631\u0634\u0641 \u0623\u0648 \u0645\u062D\u0630\u0648\u0641 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."));
  }
  const codeOwner = joinCodeOwnerEmail(foundCode);
  const claimedStudentId = normalizeStudentId(
    foundCode.assignedStudentId || foundCode.studentId || foundCode.usedByStudentId || ""
  );
  if (claimedStudentId && claimedStudentId !== normStudentId) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: { id: normStudentId, name: registrationParams?.name || normStudentId },
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0645\u062E\u0635\u0635 \u0644\u0637\u0627\u0644\u0628 \u0622\u062E\u0631",
      foundCode
    });
    return res.status(403).json({
      ...activationFailurePayload(
        "CODE_ASSIGNED_TO_OTHER",
        "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0645\u062E\u0635\u0635 \u0644\u0637\u0627\u0644\u0628 \u0622\u062E\u0631. \u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0643\u0648\u062F \u0627\u0644\u0635\u0627\u062F\u0631 \u0628\u0627\u0633\u0645\u0643 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
      )
    });
  }
  const requestedCourse = String(req.body?.courseCode || req.body?.sectionCode || "").trim();
  let activationCourseCode = activationCourseCodeOrFallback(foundCode, { id: normStudentId }, codeOwner);
  const allowedRowsForStudent = dbInstance.getAllowedStudents().filter((s) => normalizeStudentId(s.idNumber || s.id || s.studentId) === normStudentId);
  const foundCodeAlreadyConsumed = joinCodeIsConsumedRecord(foundCode);
  const codeCourseValues = [
    foundCode.sectionCode,
    foundCode.studentSection,
    foundCode.courseCode,
    foundCode.resolvedCourseCode,
    foundCode.activatedCourseCode
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const codeIsGeneralActivation = !foundCodeAlreadyConsumed && (codeCourseValues.length === 0 || codeCourseValues.every((value) => value === "all") || String(activationCourseCode || "").trim().toLowerCase() === "all");
  if (codeIsGeneralActivation && !requestedCourse && allowedRowsForStudent.length > 0) {
    const rosterCourseCandidates = [];
    allowedRowsForStudent.forEach((row) => {
      const rawCourse = String(row?.sectionCode || row?.studentSection || row?.courseCode || "").trim();
      if (!rawCourse || rawCourse.toLowerCase() === "all") return;
      const rowOwner = String(
        row?.teacherEmail || extractEmailFromSectionCode(rawCourse) || sectionOwnerEmail(rawCourse) || ""
      ).toLowerCase();
      if (!isAdminEmail(codeOwner) && rowOwner && codeOwner && rowOwner !== codeOwner) return;
      const resolved = String(sectionForCourseCode(rawCourse, rowOwner || codeOwner)?.code || rawCourse).trim();
      if (!resolved || resolved.toLowerCase() === "all") return;
      if (!rosterCourseCandidates.some((existing) => courseMatchesRemovalTarget(existing, resolved, rowOwner || codeOwner))) {
        rosterCourseCandidates.push(resolved);
      }
    });
    if (rosterCourseCandidates.length >= 1) {
      activationCourseCode = rosterCourseCandidates[0];
    }
  }
  if (foundCodeAlreadyConsumed) {
    const lockedCourse = joinCodeLockedActivationCourse(foundCode);
    if (!lockedCourse) {
      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student: { id: normStudentId, name: registrationParams?.name || normStudentId },
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0644\u0627 \u0645\u0642\u0631\u0631 \u0645\u0642\u0641\u0644",
        foundCode
      });
      return res.status(409).json(activationFailurePayload("CODE_USED", "\u0627\u0644\u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0627\u0644\u0641\u0639\u0644. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."));
    }
    if (requestedCourse && !consumedJoinCodeMatchesCourse(foundCode, requestedCourse, codeOwner)) {
      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student: { id: normStudentId, name: registrationParams?.name || normStudentId },
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0645\u0642\u0631\u0631 \u0633\u0627\u0628\u0642 \u0644\u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631 \u0645\u062E\u062A\u0644\u0641",
        foundCode
      });
      return res.status(409).json(
        activationFailurePayload(
          "CODE_COURSE_MISMATCH",
          "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0648\u0645\u0642\u0641\u0644 \u0639\u0644\u0649 \u0645\u0642\u0631\u0631 \u0622\u062E\u0631. \u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0643\u0648\u062F \u0627\u0644\u062C\u062F\u064A\u062F \u0627\u0644\u062E\u0627\u0635 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631."
        )
      );
    }
    activationCourseCode = lockedCourse;
  } else if (requestedCourse) {
    const requestedOwner = String(
      sectionForCourseCode(requestedCourse, codeOwner)?.ownerEmail || sectionOwnerEmail(requestedCourse)
    ).toLowerCase();
    const isInRequestedRoster = allowedRowsForStudent.some(
      (r) => allowedStudentMatchesCourse(
        r,
        normStudentId,
        requestedCourse,
        isAdminEmail(codeOwner) ? requestedOwner : codeOwner
      )
    );
    const codeCanActivateRequested = activationCourseCode.toLowerCase() === "all" || isAdminEmail(codeOwner) || courseCodeMatchesForTeacher(requestedCourse, activationCourseCode, codeOwner);
    if (isInRequestedRoster && codeCanActivateRequested) {
      activationCourseCode = requestedCourse;
    }
  }
  let student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId);
  const allowed = allowedRowsForStudent[0];
  if (!allowed) {
    return res.status(404).json(activationFailurePayload("STUDENT_NOT_FOUND", "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0643\u0634\u0648\u0641\u0627\u062A \u0627\u0644\u0645\u0642\u0631\u0631\u0627\u062A \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u0629."));
  }
  const rosterOwnerForActivation = String(
    sectionForCourseCode(activationCourseCode, codeOwner)?.ownerEmail || sectionOwnerEmail(activationCourseCode) || codeOwner
  ).toLowerCase();
  const rosterMatch = allowedRowsForStudent.find(
    (row) => allowedStudentMatchesCourse(
      row,
      normStudentId,
      activationCourseCode,
      isAdminEmail(codeOwner) ? rosterOwnerForActivation : codeOwner
    )
  );
  if (!rosterMatch) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId, name: registrationParams?.name || normStudentId },
      reason: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0643\u0634\u0641 \u0627\u0644\u0645\u0642\u0631\u0631 \u0648\u0642\u062A \u0627\u0644\u062A\u0641\u0639\u064A\u0644",
      foundCode
    });
    return res.status(403).json({
      ...activationFailurePayload(
        "STUDENT_NOT_IN_COURSE",
        "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u064A\u062E\u0635 \u0645\u0642\u0631\u0631\u064B\u0627 \u0644\u0633\u062A \u0645\u062F\u0631\u062C\u064B\u0627 \u0641\u064A \u0643\u0634\u0641\u0647 \u0628\u0639\u062F. \u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u062B\u0645 \u0623\u0639\u062F \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0643\u0648\u062F."
      )
    });
  }
  const rosterAny = rosterMatch;
  const foundCodeAny = foundCode;
  const studentAny = student;
  const resolvedCourseCode = String(
    activationCourseCode === "all" ? rosterAny.sectionCode || rosterAny.studentSection || rosterAny.courseCode || foundCodeAny.studentSection || foundCodeAny.sectionCode || foundCodeAny.courseCode || studentAny?.sectionCode || studentAny?.studentSection || "" : activationCourseCode || foundCodeAny.studentSection || foundCodeAny.sectionCode || foundCodeAny.courseCode || rosterAny.sectionCode || rosterAny.studentSection || rosterAny.courseCode || studentAny?.sectionCode || studentAny?.studentSection || ""
  ).trim();
  if (!resolvedCourseCode || resolvedCourseCode.toLowerCase() === "all") {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId, name: registrationParams?.name || normStudentId },
      reason: "\u0644\u0645 \u064A\u062A\u0645 \u062A\u062D\u062F\u064A\u062F \u0634\u0639\u0628\u0629 \u0627\u0644\u0645\u0642\u0631\u0631 \u0648\u0642\u062A \u0627\u0644\u062A\u0641\u0639\u064A\u0644",
      foundCode
    });
    return res.status(400).json(activationFailurePayload("COURSE_NOT_FOUND", "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062F \u0645\u0642\u0631\u0631 \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F. \u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u0644\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0634\u0639\u0628\u0629 \u0627\u0644\u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0627\u0644\u0643\u0648\u062F."));
  }
  if (foundCodeAlreadyConsumed && !consumedJoinCodeMatchesCourse(foundCode, resolvedCourseCode, codeOwner)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId, name: registrationParams?.name || normStudentId },
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0625\u0639\u0627\u062F\u0629 \u0631\u0628\u0637 \u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u0642\u0631\u0631\u0647 \u0627\u0644\u0623\u0635\u0644\u064A",
      foundCode
    });
    return res.status(409).json(
      activationFailurePayload(
        "CODE_COURSE_MISMATCH",
        "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0648\u0645\u0642\u0641\u0644 \u0639\u0644\u0649 \u0645\u0642\u0631\u0631 \u0622\u062E\u0631. \u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0643\u0648\u062F \u0627\u0644\u062C\u062F\u064A\u062F \u0627\u0644\u062E\u0627\u0635 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631."
      )
    );
  }
  const courseOwner = String(
    sectionForCourseCode(resolvedCourseCode, codeOwner)?.ownerEmail || sectionOwnerEmail(resolvedCourseCode)
  ).toLowerCase();
  const codeOwnerCanActivateCourse = codeOwner === courseOwner || isAdminEmail(codeOwner) || teacherOwnsCourseCode(resolvedCourseCode, codeOwner) || courseCodeMatchesForTeacher(resolvedCourseCode, activationCourseCode, codeOwner) || rosterMatch && String(rosterMatch.teacherEmail || "").trim().toLowerCase() === codeOwner;
  if (!codeOwnerCanActivateCourse) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId },
      reason: "\u0627\u0644\u0643\u0648\u062F \u0644\u0627 \u064A\u062A\u0628\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631",
      foundCode
    });
    return res.status(403).json(activationFailurePayload("INVALID_CODE", "\u0627\u0644\u0643\u0648\u062F \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u060C \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."));
  }
  if (student && joinCodeIsStaleForStudentCourse(foundCode, student, resolvedCourseCode, courseOwner || codeOwner)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student,
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0642\u062F\u064A\u0645 \u0628\u0639\u062F \u062D\u0630\u0641 \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631",
      foundCode
    });
    return res.status(409).json(
      activationFailurePayload(
        "CODE_STALE_AFTER_REMOVAL",
        "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u062A\u0627\u0628\u0639 \u0644\u062F\u0648\u0631\u0629 \u0642\u062F\u064A\u0645\u0629 \u0628\u0639\u062F \u062D\u0630\u0641\u0643 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
      )
    );
  }
  const windowState = joinCodeWindowStatus(foundCode);
  if (!windowState.ok) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId },
      reason: windowState.reason,
      foundCode
    });
    const expired = String(windowState.reason || "").includes("\u0627\u0646\u062A\u0647\u062A");
    return res.status(403).json(
      activationFailurePayload(
        expired ? "CODE_EXPIRED" : "CODE_NOT_ACTIVE",
        expired ? "\u0627\u0644\u0643\u0648\u062F \u0645\u0646\u062A\u0647\u064A. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631." : "\u0627\u0644\u0643\u0648\u062F \u0644\u0645 \u064A\u0628\u062F\u0623 \u0648\u0642\u062A \u062A\u0641\u0639\u064A\u0644\u0647 \u0628\u0639\u062F. \u062D\u0627\u0648\u0644 \u0644\u0627\u062D\u0642\u064B\u0627 \u0623\u0648 \u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
      )
    );
  }
  if (isJoinCodeTemporarilyFrozen(foundCode)) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId },
      reason: "\u0627\u0644\u0643\u0648\u062F \u0645\u062C\u0645\u0651\u062F \u0645\u0624\u0642\u062A\u064B\u0627 \u0644\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0628\u0633\u0628\u0628 \u0633\u0644\u0648\u0643 \u063A\u064A\u0631 \u0637\u0628\u064A\u0639\u064A",
      foundCode
    });
    return res.status(423).json(activationFailurePayload("CODE_FROZEN", "\u0627\u0644\u0643\u0648\u062F \u0645\u0648\u0642\u0648\u0641 \u0645\u0624\u0642\u062A\u064B\u0627 \u0644\u0644\u0645\u0631\u0627\u062C\u0639\u0629. \u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."));
  }
  const activationDeviceToken = getRequestDeviceToken(req);
  if (!activationDeviceToken) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId },
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0641\u0639\u064A\u0644 \u0628\u062F\u0648\u0646 \u062A\u0648\u0643\u0646 \u062C\u0647\u0627\u0632",
      foundCode
    });
    return res.status(400).json({
      ...activationFailurePayload(
        "DEVICE_TOKEN_MISSING",
        "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632. \u0627\u0641\u062A\u062D \u0627\u0644\u0646\u0638\u0627\u0645 \u0645\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0623\u0635\u0644\u064A \u062B\u0645 \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."
      )
    });
  }
  const activationFingerprint = getRequestDeviceFingerprint(req);
  if (student && !student.pendingDeviceTransfer) {
    const currentDevices = Array.isArray(student.devices) ? student.devices.map((d) => String(d || "").trim()).filter(Boolean) : [];
    const sameRegisteredDevice = currentDevices.some(
      (d) => deviceFingerprintsMatch(d, activationFingerprint)
    );
    if (currentDevices.length > 0 && !sameRegisteredDevice) {
      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student,
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631 \u0645\u0646 \u0645\u062A\u0635\u0641\u062D \u0623\u0648 \u062C\u0647\u0627\u0632 \u063A\u064A\u0631 \u0645\u0639\u062A\u0645\u062F \u0644\u0644\u062D\u0633\u0627\u0628",
        foundCode
      });
      return res.status(409).json({
        ...activationFailurePayload(
          "DEVICE_MISMATCH",
          "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0631\u062A\u0628\u0637 \u0628\u0645\u062A\u0635\u0641\u062D \u0623\u0648 \u062C\u0647\u0627\u0632 \u0622\u062E\u0631. \u0641\u0639\u0651\u0644 \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0645\u0639\u062A\u0645\u062F \u0623\u0648 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632."
        )
      });
    }
  }
  const deviceBoundToOtherStudent = findStudentBoundToDevice(
    activationDeviceToken,
    activationFingerprint,
    normStudentId
  );
  if (deviceBoundToOtherStudent) {
    const requestStudent = student || {
      id: normStudentId,
      name: rosterMatch.name || registrationParams?.name || allowed.name || normStudentId,
      email: registrationParams?.email || `${normStudentId}@paaet.edu.kw`,
      sectionCode: resolvedCourseCode,
      studentSection: resolvedCourseCode
    };
    const conflict = activeSecondHandDeviceConflict({
      deviceToken: activationDeviceToken,
      deviceFingerprint: activationFingerprint,
      studentId: normStudentId,
      sectionCode: resolvedCourseCode
    });
    if (conflict.conflict) {
      const pendingRequest2 = createSecondHandDeviceApprovalRequest({
        req,
        code: joinCodeRaw,
        foundCode,
        student: requestStudent,
        rosterMatch,
        sectionCode: resolvedCourseCode,
        teacherEmail: courseOwner,
        deviceToken: activationDeviceToken,
        deviceFingerprint: activationFingerprint,
        previousStudent: deviceBoundToOtherStudent
      });
      return res.status(202).json({
        ...activationFailurePayload(
          "DEVICE_APPROVAL_REQUIRED",
          "\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0633\u0628\u0642 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647 \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645. \u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0644\u0644\u0623\u0633\u062A\u0627\u0630."
        ),
        pendingDeviceApproval: true,
        approvalRequestId: pendingRequest2.id,
        message: "\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0633\u0628\u0642 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647 \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645. \u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0644\u0644\u0623\u0633\u062A\u0627\u0630."
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
      previousStudent: deviceBoundToOtherStudent
    });
    return res.status(202).json({
      ...activationFailurePayload(
        "DEVICE_APPROVAL_REQUIRED",
        "\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0633\u0628\u0642 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647 \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645. \u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0644\u0644\u0623\u0633\u062A\u0627\u0630."
      ),
      pendingDeviceApproval: true,
      approvalRequestId: pendingRequest.id,
      message: "\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0633\u0628\u0642 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647 \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645. \u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0644\u0644\u0623\u0633\u062A\u0627\u0630."
    });
  }
  if (student && registrationParams?.password) {
    const submittedPassword = String(registrationParams.password).trim();
    if (!verifyPasswordFlexible(student.passwordHash, submittedPassword)) {
      return res.status(401).json({
        ...activationFailurePayload(
          "PASSWORD_MISMATCH",
          "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0644\u0627 \u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0633\u062C\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A."
        )
      });
    }
  }
  if (foundCodeAlreadyConsumed) {
    const sameStudentOwnsCode = normalizeStudentId(foundCode.studentId || foundCode.usedByStudentId || "") === normStudentId;
    const deviceBindingCleared = !String(foundCode.activationDeviceToken || "").trim() && !String(foundCode.activationDeviceFingerprint || "").trim();
    if (sameStudentOwnsCode && !studentAccessIsTeacherHold(student) && !deviceBindingCleared) {
      const lockedDeviceToken = String(foundCode.activationDeviceToken || "").trim();
      const lockedFingerprint = String(foundCode.activationDeviceFingerprint || "").trim();
      const tokenMatches = !!lockedDeviceToken && lockedDeviceToken === activationDeviceToken;
      const fingerprintMatches = !!lockedFingerprint && deviceFingerprintsMatch(lockedFingerprint, activationFingerprint);
      const sameAuthorizedDevice = tokenMatches && (!lockedFingerprint || fingerprintMatches) || !lockedDeviceToken && fingerprintMatches;
      if (sameAuthorizedDevice) {
        if (student) {
          dbInstance.updateStudent(student.id, {
            isPaid: true,
            isActivated: true,
            activationCode: foundCode.code,
            ...buildStudentActivationPersistencePatch(student, resolvedCourseCode || student.sectionCode),
            isAccessBlocked: false,
            accessBlockReason: "",
            devices: [activationFingerprint],
            lastLoginDate: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        dbInstance.updateJoinCode(foundCode.code, {
          studentId: normStudentId,
          studentName: student?.name || registrationParams?.name || rosterMatch.name || normStudentId,
          studentSection: resolvedCourseCode || foundCode.studentSection,
          sectionCode: resolvedCourseCode || foundCode.sectionCode || foundCode.studentSection,
          courseCode: resolvedCourseCode || foundCode.courseCode || foundCode.sectionCode,
          activationDeviceToken: lockedDeviceToken || activationDeviceToken,
          activationDeviceFingerprint: activationFingerprint,
          activationDeviceServerHash: foundCode.activationDeviceServerHash || serverBoundDeviceHash(req, activationDeviceToken),
          activationIp: req.ip || foundCode.activationIp || ""
        });
        const updatedStudent = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || student;
        if (!updatedStudent) {
          return res.status(404).json(activationFailurePayload("STUDENT_NOT_FOUND", "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F. \u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u0642\u0628\u0644 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0641\u0639\u064A\u0644."));
        }
        const sameDeviceActivatedCodes = activatedCourseCodesForStudent(updatedStudent, resolvedCourseCode);
        const sameDeviceEnrollments = getStudentEnrollmentDetails(updatedStudent).map(
          (entry) => entry.isOpen !== false && entry.isSuspended !== true && sameDeviceActivatedCodes.some(
            (code) => sectionCodeEquivalent(code, entry.courseCode || entry.sectionCode)
          ) ? {
            ...entry,
            status: "active",
            isActive: true,
            isLocked: false,
            isOpen: true,
            isClosedByTeacher: false,
            isSuspended: false
          } : entry
        );
        return res.json(
          buildStudentActivationSuccessPayload(
            req,
            res,
            {
              ...updatedStudent,
              sectionCode: String(updatedStudent?.sectionCode || "").trim() || resolvedCourseCode,
              studentSection: String(updatedStudent?.studentSection || "").trim() || resolvedCourseCode,
              activatedCourseCodes: sameDeviceActivatedCodes
            },
            resolvedCourseCode,
            sameDeviceEnrollments,
            "\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0628\u062F\u064A\u0644 \u0628\u0646\u062C\u0627\u062D."
          )
        );
      }
      recordActivationAttempt(req, {
        code: joinCodeRaw,
        student: student || { id: normStudentId },
        reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0628\u062F\u064A\u0644 \u0645\u0646 \u062C\u0647\u0627\u0632 \u063A\u064A\u0631 \u0645\u0639\u062A\u0645\u062F",
        foundCode
      });
      return res.status(409).json({
        ...activationFailurePayload(
          "CODE_USED_ON_ANOTHER_DEVICE",
          "\u0627\u0644\u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0648\u0645\u0631\u0628\u0648\u0637 \u0628\u062C\u0647\u0627\u0632 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0645\u0639\u062A\u0645\u062F. \u0625\u0630\u0627 \u0643\u0646\u062A \u062A\u0633\u062A\u062E\u062F\u0645 \u062C\u0647\u0627\u0632\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0641\u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632 \u0623\u0648\u0644\u064B\u0627."
        )
      });
    }
    const transferApprovedForThisStudent = sameStudentOwnsCode && deviceBindingCleared && student && !student.isAccessBlocked;
    if (transferApprovedForThisStudent) {
      const retiredTokens = Array.isArray(student.retiredDeviceTokens) ? student.retiredDeviceTokens : [];
      const retiredFingerprints = Array.isArray(student.retiredDeviceFingerprints) ? student.retiredDeviceFingerprints : [];
      const isRetiredOldDevice = retiredTokens.some((t) => String(t || "").trim() && String(t).trim() === activationDeviceToken) || retiredFingerprints.some((f) => String(f || "").trim() && String(f).trim() === activationFingerprint);
      if (isRetiredOldDevice) {
        recordActivationAttempt(req, {
          code: joinCodeRaw,
          student,
          reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062F\u062E\u0648\u0644 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0642\u062F\u064A\u0645 \u0628\u0639\u062F \u0627\u0639\u062A\u0645\u0627\u062F \u0646\u0642\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F",
          foundCode
        });
        return res.status(409).json({
          ...activationFailurePayload(
            "OLD_DEVICE_RETIRED",
            "\u062D\u0633\u0627\u0628\u0643 \u0641\u064A \u0648\u0636\u0639 \u0627\u0644\u0646\u0642\u0644 \u0644\u062C\u0647\u0627\u0632 \u062C\u062F\u064A\u062F. \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u062C\u0647\u0627\u0632\u0643 \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0646\u0642\u0644."
          )
        });
      }
      const transferCourseName = courseNameFromCode(resolvedCourseCode);
      dbInstance.updateJoinCode(foundCode.code, {
        activationDeviceToken,
        activationDeviceFingerprint: activationFingerprint,
        studentSection: resolvedCourseCode || foundCode.studentSection || foundCode.sectionCode,
        sectionCode: resolvedCourseCode || foundCode.sectionCode || foundCode.studentSection,
        courseCode: resolvedCourseCode || foundCode.courseCode || foundCode.sectionCode,
        resolvedCourseCode,
        resolvedCourseName: transferCourseName,
        courseName: transferCourseName,
        sectionName: transferCourseName,
        activationIp: req.ip || foundCode.activationIp || ""
      });
      dbInstance.updateStudent(student.id, {
        isPaid: true,
        isActivated: true,
        activationCode: foundCode.code,
        ...buildStudentActivationPersistencePatch(student, resolvedCourseCode || student.sectionCode),
        devices: [activationFingerprint],
        accessResetAt: (/* @__PURE__ */ new Date()).toISOString(),
        isAccessBlocked: false,
        accessBlockReason: "",
        pendingDeviceTransfer: false,
        retiredDeviceFingerprints: [],
        retiredDeviceTokens: [],
        lastLoginDate: (/* @__PURE__ */ new Date()).toISOString()
      });
      const transferredStudent = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || student;
      const transferredEnrollments = getStudentEnrollmentDetails(transferredStudent);
      return res.json(
        buildStudentActivationSuccessPayload(
          req,
          res,
          transferredStudent,
          resolvedCourseCode,
          transferredEnrollments,
          "\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632\u0643 \u0627\u0644\u062C\u062F\u064A\u062F \u0628\u0646\u062C\u0627\u062D. \u0623\u0647\u0644\u0627\u064B \u0628\u0643 \u0645\u062C\u062F\u062F\u0627\u064B \u0641\u064A \u0645\u0633\u0627\u0631\u0643."
        )
      );
    }
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: student || { id: normStudentId },
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0625\u0639\u0627\u062F\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0648\u062F \u0645\u0642\u0641\u0644",
      foundCode
    });
    return res.status(409).json(activationFailurePayload("CODE_USED", "\u0627\u0644\u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0627\u0644\u0641\u0639\u0644. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."));
  }
  let isNew = false;
  let pendingNewStudent = null;
  let pendingStudentPatch = null;
  let activationStudent = student;
  const activationNow = (/* @__PURE__ */ new Date()).toISOString();
  if (!student) {
    isNew = true;
    const finalEmail = normalizeArabicDigits(
      registrationParams?.email || `${normStudentId}@paaet.edu.kw`
    ).trim().toLowerCase();
    const emailExists = dbInstance.getStudents().find(
      (s) => String(s.email || "").trim().toLowerCase() === finalEmail && normalizeStudentId(s.id) !== normStudentId
    );
    if (emailExists) {
      return res.status(400).json({
        ...activationFailurePayload(
          "STUDENT_EMAIL_IN_USE",
          "\u0647\u0630\u0627 \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0645\u0633\u062A\u062E\u062F\u0645 \u0641\u064A \u062D\u0633\u0627\u0628 \u0637\u0627\u0644\u0628 \u0622\u062E\u0631. \u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0643\u0631\u0627\u0631 \u0627\u0644\u0628\u0631\u064A\u062F \u0628\u064A\u0646 \u0623\u0643\u062B\u0631 \u0645\u0646 \u0637\u0627\u0644\u0628."
        )
      });
    }
    if (isWeakDefaultPassword(registrationParams?.password)) {
      return res.status(400).json({
        ...activationFailurePayload(
          "WEAK_PASSWORD",
          "\u0627\u062E\u062A\u0631 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0642\u0648\u064A\u0629 \u0644\u0627 \u062A\u0642\u0644 \u0639\u0646 6 \u062E\u0627\u0646\u0627\u062A \u0648\u0644\u0627 \u062A\u0633\u062A\u062E\u062F\u0645 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629."
        )
      });
    }
    const newStudent = {
      id: normStudentId,
      name: rosterMatch.name || registrationParams?.name || allowed.name || normStudentId,
      email: finalEmail,
      sectionCode: resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode,
      studentSection: resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode,
      semester: registrationParams?.semester || "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u0623\u0648\u0644 2026",
      passwordHash: hashPasswordSecure(String(registrationParams?.password || "")),
      isPaid: true,
      activationCode: foundCode.code,
      activatedCourseCodes: [resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode].filter(Boolean),
      enrollments: mergePersistentStudentEnrollment(
        { enrollments: [], sectionCode: resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode },
        resolvedCourseCode || rosterMatch.sectionCode || allowed.sectionCode
      ),
      isActivated: true,
      devices: [activationFingerprint],
      progress: 0,
      score: 0,
      strengths: [],
      weaknesses: [],
      recommendations: ["\u064A\u0631\u062C\u0649 \u0625\u0643\u0645\u0627\u0644 \u0628\u0635\u0645\u0629 \u0627\u0644\u062A\u0639\u0644\u0645 \u0644\u0628\u062F\u0621 \u0645\u0633\u0627\u0631\u0643 \u0627\u0644\u0634\u062E\u0635\u064A \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A."],
      signupDate: activationNow,
      lastLoginDate: activationNow
    };
    pendingNewStudent = newStudent;
    activationStudent = newStudent;
  } else if (student) {
    pendingStudentPatch = {
      isPaid: true,
      isActivated: true,
      activationCode: foundCode.code,
      ...buildStudentActivationPersistencePatch(student, resolvedCourseCode || student.sectionCode),
      sectionCode: String(student.sectionCode || "").trim() ? student.sectionCode : resolvedCourseCode,
      studentSection: String(student.studentSection || "").trim() ? student.studentSection : resolvedCourseCode,
      devices: [activationFingerprint],
      lastLoginDate: activationNow
    };
    activationStudent = { ...student, ...pendingStudentPatch };
  }
  const resolvedCourseName = courseNameFromCode(resolvedCourseCode);
  const activationPatch = {
    status: "used",
    studentId: activationStudent.id,
    usedByStudentId: activationStudent.id,
    studentName: activationStudent.name,
    studentSection: resolvedCourseCode || activationStudent.sectionCode,
    sectionCode: resolvedCourseCode || foundCode.sectionCode || activationStudent.sectionCode,
    courseCode: resolvedCourseCode || foundCode.courseCode || activationStudent.sectionCode,
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
      courseName: resolvedCourseName
    })
  };
  const resignedSignature = signJoinCodeRecord({
    code: foundCode.code,
    ownerEmail: foundCode.ownerEmail || foundCode.createdByEmail || codeOwner,
    sectionCode: activationPatch.sectionCode,
    createdAt: foundCode.createdAt
  });
  if (resignedSignature) {
    activationPatch.codeSignature = resignedSignature;
    activationPatch.codeSignatureVersion = "hmac-sha256-v1";
    activationPatch.codeSignatureCreatedAt = foundCode.codeSignatureCreatedAt || foundCode.createdAt || activationNow;
  }
  const joinCodeStateBeforeUse = { ...foundCode };
  const consumed = dbInstance.compareAndUseJoinCode ? dbInstance.compareAndUseJoinCode(foundCode.code, activationPatch) : { ok: false, reason: "unsupported" };
  if (!consumed.ok) {
    recordActivationAttempt(req, {
      code: joinCodeRaw,
      student: activationStudent,
      foundCode,
      reason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0641\u0639\u064A\u0644 \u0645\u062A\u0632\u0627\u0645\u0646\u0629 \u0644\u0643\u0648\u062F \u0627\u0633\u062A\u064F\u0647\u0644\u0643 \u0628\u0627\u0644\u0641\u0639\u0644"
    });
    return res.status(409).json(activationFailurePayload("CODE_USED", "\u0627\u0644\u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0627\u0644\u0641\u0639\u0644. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."));
  }
  try {
    if (pendingNewStudent) {
      dbInstance.addStudent(pendingNewStudent);
      student = pendingNewStudent;
    } else if (student && pendingStudentPatch) {
      dbInstance.updateStudent(student.id, pendingStudentPatch);
      student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || activationStudent;
    }
  } catch (err) {
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
          studentSection: String(student.studentSection || "").trim() ? student.studentSection : resolvedCourseCode,
          devices: [activationFingerprint],
          lastLoginDate: activationNow
        };
        dbInstance.updateStudent(student.id, pendingStudentPatch);
        student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || { ...student, ...pendingStudentPatch };
      }
    }
    if (!student) {
      try {
        dbInstance.updateJoinCode(foundCode.code, {
          ...joinCodeStateBeforeUse,
          status: String(joinCodeStateBeforeUse.status || "active"),
          studentId: joinCodeStateBeforeUse.studentId ?? "",
          usedByStudentId: joinCodeStateBeforeUse.usedByStudentId ?? "",
          studentName: joinCodeStateBeforeUse.studentName ?? "",
          activatedAt: joinCodeStateBeforeUse.activatedAt ?? "",
          activationDeviceToken: joinCodeStateBeforeUse.activationDeviceToken ?? "",
          activationDeviceFingerprint: joinCodeStateBeforeUse.activationDeviceFingerprint ?? "",
          activationDeviceServerHash: joinCodeStateBeforeUse.activationDeviceServerHash ?? "",
          activationIp: joinCodeStateBeforeUse.activationIp ?? ""
        });
      } catch {
      }
      return res.status(500).json(activationFailurePayload("ACTIVATION_COMMIT_FAILED", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u062D\u0633\u0627\u0628 \u0627\u0644\u0637\u0627\u0644\u0628 \u0648\u0644\u0645 \u064A\u064F\u0633\u062A\u0647\u0644\u0643 \u0627\u0644\u0643\u0648\u062F. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629\u060C \u0648\u0625\u0646 \u062A\u0643\u0631\u0651\u0631 \u0641\u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."));
    }
  }
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    action: isNew ? "\u062A\u0633\u062C\u064A\u0644 \u062D\u0633\u0627\u0628" : "\u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631 \u0625\u0636\u0627\u0641\u064A",
    details: isNew ? `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u062C\u062F\u064A\u062F \u0628\u0646\u062C\u0627\u062D \u0648\u062A\u0641\u0639\u064A\u0644\u0647 \u0639\u0628\u0631 \u0631\u0645\u0632 \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645 ${foundCode.code} \u0644\u0645\u0642\u0631\u0631 ${courseNameFromCode(resolvedCourseCode)}` : `\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631 \u0625\u0636\u0627\u0641\u064A ${courseNameFromCode(resolvedCourseCode)} \u0628\u0643\u0648\u062F ${foundCode.code} \u0628\u0646\u062C\u0627\u062D.`,
    teacherEmail: courseOwner,
    actorEmail: courseOwner,
    sectionCode: resolvedCourseCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: isNew ? "\u062A\u0633\u062C\u064A\u0644 \u062C\u062F\u064A\u062F" : "\u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631",
    browser: "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u064A\u0628",
    isViolationWarning: false
  });
  notifyTeachersForSection(
    resolvedCourseCode,
    isNew ? "\u062A\u0633\u062C\u064A\u0644 \u0637\u0627\u0644\u0628 \u062C\u062F\u064A\u062F" : "\u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631 \u0625\u0636\u0627\u0641\u064A",
    `${student.name} \u0641\u0639\u0651\u0644 \u0645\u0642\u0631\u0631 ${courseNameFromCode(resolvedCourseCode)} \u0628\u0627\u0644\u0643\u0648\u062F`,
    {
      type: isNew ? "student_registered" : "course_activated",
      studentId: student.id,
      courseCode: resolvedCourseCode,
      link: "/"
    }
  );
  const finalStudent = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === normStudentId) || student;
  const finalActivatedCodes = activatedCourseCodesForStudent(finalStudent, resolvedCourseCode);
  const finalEnrollments = getStudentEnrollmentDetails(finalStudent).map(
    (entry) => (
      // لا نتجاوز قرار المعلم: المقرر المُغلق/المعلّق يبقى على حالته الحقيقية حتى
      // عند لحظة التفعيل. المقرر المفتوح المُفعّل يظهر نشطاً فوراً.
      entry.isOpen !== false && entry.isSuspended !== true && finalActivatedCodes.some((code) => sectionCodeEquivalent(code, entry.courseCode || entry.sectionCode)) ? {
        ...entry,
        status: "active",
        isActive: true,
        isLocked: false,
        isOpen: true,
        isClosedByTeacher: false,
        isSuspended: false
      } : entry
    )
  );
  return res.json(
    buildStudentActivationSuccessPayload(
      req,
      res,
      {
        ...finalStudent,
        sectionCode: String(finalStudent?.sectionCode || "").trim() || resolvedCourseCode,
        studentSection: String(finalStudent?.studentSection || "").trim() || resolvedCourseCode,
        activatedCourseCodes: finalActivatedCodes
      },
      resolvedCourseCode,
      finalEnrollments,
      isNew ? "\u062A\u0647\u0627\u0646\u064A\u0646\u0627! \u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u062D\u0633\u0627\u0628\u0643 \u0648\u0631\u0628\u0637 \u0627\u0644\u0645\u0642\u0631\u0631 \u0628\u0646\u062C\u0627\u062D." : "\u062A\u0645 \u0631\u0628\u0637 \u0627\u0644\u0645\u0642\u0631\u0631 \u0628\u0646\u062C\u0627\u062D \u0641\u0648\u0631\u0627\u064B."
    )
  );
}
app.post("/api/students/join-lab", (req, res) => {
  const studentId = normalizeArabicDigits(String(req.body.studentId || req.body.idNumber || "")).trim();
  const joinCode = normalizeArabicDigits(String(req.body.joinCode || req.body.code || "")).trim();
  if (!studentId || !joinCode) {
    return res.status(400).json({ error: "\u0627\u0644\u0631\u062C\u0627\u0621 \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0648\u0631\u0645\u0632 \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645" });
  }
  return processStudentCourseActivation(req, res, studentId, joinCode);
});
function teacherCanHandleDeviceApproval(request, teacherEmail) {
  const email = String(teacherEmail || "").toLowerCase();
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const sectionCode = request?.targetSectionCode || request?.sectionCode || "";
  return String(request?.targetTeacherEmail || "").toLowerCase() === email || sectionOwnerEmail(sectionCode).toLowerCase() === email || teacherOwnsCourseCode(sectionCode, email);
}
function findDeviceApprovalRequest(requestId) {
  const id = String(requestId || "").trim();
  if (!id) return null;
  return dbInstance.getActivationAttempts().find(
    (attempt) => String(attempt.id || "") === id && String(attempt.approvalRequestType || "") === "second_hand_device"
  ) || null;
}
app.post("/api/teacher/device-approval/:id/approve", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const request = findDeviceApprovalRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632." });
  if (!teacherCanHandleDeviceApproval(request, teacherEmail)) return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0639\u062A\u0645\u0627\u062F \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632." });
  if (String(request.approvalStatus || "") !== "pending") {
    return res.status(409).json({ error: "\u062A\u0645\u062A \u0645\u0639\u0627\u0644\u062C\u0629 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628 \u0633\u0627\u0628\u0642\u064B\u0627." });
  }
  const targetStudentId = normalizeStudentId(request.targetStudentId || request.studentId || "");
  const targetJoinCode = normalizeJoinCode(request.targetJoinCode || request.code || "");
  const sectionCode = String(request.targetSectionCode || request.sectionCode || "").trim();
  const deviceToken = String(request.deviceToken || "").trim();
  const deviceFingerprint = String(request.deviceFingerprint || "").trim();
  if (!targetStudentId || !targetJoinCode || !sectionCode || !deviceToken || !deviceFingerprint) {
    return res.status(400).json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629." });
  }
  const joinCode = dbInstance.getJoinCodes().find(
    (jc) => normalizeJoinCode(jc.code) === targetJoinCode || compactJoinCode(jc.code) === compactJoinCode(targetJoinCode)
  );
  if (!joinCode || String(joinCode.status || "") === "revoked") {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "\u0627\u0644\u0643\u0648\u062F \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0623\u0648 \u0645\u0644\u063A\u0649 \u0648\u0642\u062A \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F."
    });
    return res.status(409).json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0644\u0623\u0646 \u0643\u0648\u062F \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0627\u0644\u0622\u0646." });
  }
  if (isSoftDeletedRecord(joinCode) || isArchivedJoinCodeRecord(joinCode)) {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "\u0627\u0644\u0643\u0648\u062F \u0645\u0624\u0631\u0634\u0641 \u0623\u0648 \u0645\u062D\u0630\u0648\u0641 \u0648\u0642\u062A \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F."
    });
    return res.status(410).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0645\u0624\u0631\u0634\u0641 \u0623\u0648 \u0645\u062D\u0630\u0648\u0641. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627." });
  }
  const codeOwner = joinCodeOwnerEmail(joinCode);
  if (joinCodeIsConsumedRecord(joinCode) && !consumedJoinCodeMatchesCourse(joinCode, sectionCode, codeOwner)) {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0639\u062A\u0645\u0627\u062F \u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0644\u0645\u0642\u0631\u0631 \u0645\u062E\u062A\u0644\u0641."
    });
    return res.status(409).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0648\u0645\u0642\u0641\u0644 \u0639\u0644\u0649 \u0645\u0642\u0631\u0631 \u0622\u062E\u0631. \u0627\u0633\u062A\u062E\u062F\u0645 \u0643\u0648\u062F \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0635\u062D\u064A\u062D." });
  }
  const currentOwner = normalizeStudentId(joinCode.studentId || joinCode.usedByStudentId || "");
  if (String(joinCode.status || "") === "used" && currentOwner && currentOwner !== targetStudentId) {
    return res.status(409).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u0644\u0623\u0646 \u0627\u0644\u0643\u0648\u062F \u0623\u0635\u0628\u062D \u0645\u0633\u062A\u062E\u062F\u0645\u064B\u0627 \u0644\u0637\u0627\u0644\u0628 \u0622\u062E\u0631." });
  }
  const conflict = activeSecondHandDeviceConflict({
    deviceToken,
    deviceFingerprint,
    studentId: targetStudentId,
    sectionCode,
    currentRequestId: request.id
  });
  if (conflict.conflict && String(req.body?.force || "") !== "1") {
    dbInstance.updateActivationAttempt(request.id, {
      activeConflict: true,
      activeConflictReason: conflict.reason,
      deviceApprovalRecommendation: "\u064A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u062C\u0639\u0629 \u0642\u0628\u0644 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F"
    });
    return res.status(409).json({ error: conflict.reason });
  }
  const allowedRowsForStudent = dbInstance.getAllowedStudents().filter(
    (row) => normalizeStudentId(row.idNumber || row.id || row.studentId) === targetStudentId
  );
  const rosterMatch = allowedRowsForStudent.find(
    (row) => allowedStudentMatchesCourse(row, targetStudentId, sectionCode, codeOwner)
  ) || allowedRowsForStudent.find((row) => sectionCodeEquivalent(row.sectionCode || row.studentSection || row.courseCode, sectionCode));
  if (!rosterMatch) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u0644\u0623\u0646 \u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0643\u0634\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631." });
  }
  let student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === targetStudentId);
  if (student && joinCodeIsStaleForStudentCourse(joinCode, student, sectionCode, codeOwner)) {
    dbInstance.updateActivationAttempt(request.id, {
      approvalStatus: "rejected",
      approvalResolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
      approvalResolvedBy: teacherEmail,
      activeConflictReason: "\u0627\u0644\u0643\u0648\u062F \u062A\u0627\u0628\u0639 \u0644\u062F\u0648\u0631\u0629 \u0642\u062F\u064A\u0645\u0629 \u0628\u0639\u062F \u062D\u0630\u0641 \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631."
    });
    return res.status(409).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u062A\u0627\u0628\u0639 \u0644\u062F\u0648\u0631\u0629 \u0642\u062F\u064A\u0645\u0629 \u0628\u0639\u062F \u062D\u0630\u0641 \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631. \u0627\u0637\u0644\u0628 \u0643\u0648\u062F\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627." });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (!student) {
    const email = String(request.targetStudentEmail || `${targetStudentId}@paaet.edu.kw`).trim().toLowerCase();
    const newStudent = {
      id: targetStudentId,
      name: request.targetStudentName || rosterMatch.name || targetStudentId,
      email,
      sectionCode,
      studentSection: sectionCode,
      semester: rosterMatch.semester || "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u0623\u0648\u0644 2026",
      passwordHash: hashPasswordSecure(import_crypto.default.randomBytes(9).toString("base64url")),
      isPaid: true,
      isActivated: true,
      activationCode: joinCode.code,
      activatedCourseCodes: [sectionCode],
      enrollments: mergePersistentStudentEnrollment({ enrollments: [], sectionCode }, sectionCode, "second_hand_device_approval"),
      devices: [deviceFingerprint],
      progress: 0,
      score: 0,
      strengths: [],
      weaknesses: [],
      recommendations: ["\u064A\u0631\u062C\u0649 \u0625\u0643\u0645\u0627\u0644 \u0628\u0635\u0645\u0629 \u0627\u0644\u062A\u0639\u0644\u0645 \u0644\u0628\u062F\u0621 \u0645\u0633\u0627\u0631\u0643 \u0627\u0644\u0634\u062E\u0635\u064A \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A."],
      signupDate: now,
      lastLoginDate: now
    };
    dbInstance.addStudent(newStudent);
    student = newStudent;
  } else {
    dbInstance.updateStudent(student.id, {
      isPaid: true,
      isActivated: true,
      activationCode: joinCode.code,
      ...buildStudentActivationPersistencePatch(student, sectionCode),
      sectionCode: String(student.sectionCode || "").trim() ? student.sectionCode : sectionCode,
      studentSection: String(student.studentSection || "").trim() ? student.studentSection : sectionCode,
      devices: [deviceFingerprint],
      lastLoginDate: now,
      secondHandDeviceApprovedAt: now,
      secondHandDeviceApprovedBy: teacherEmail
    });
    student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === targetStudentId) || student;
  }
  releaseDeviceFromPreviousOwners({
    deviceToken,
    deviceFingerprint,
    newStudentId: targetStudentId,
    requestId: request.id,
    actorEmail: teacherEmail
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
    secondHandDeviceApprovalRequestId: request.id
  });
  dbInstance.updateActivationAttempt(request.id, {
    approvalStatus: "approved",
    approvalResolvedAt: now,
    approvalResolvedBy: teacherEmail,
    activeConflict: false,
    activeConflictReason: conflict.reason,
    deviceApprovalRecommendation: "\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632"
  });
  dbInstance.addActivityLog({
    studentId: targetStudentId,
    studentName: student.name || request.targetStudentName || targetStudentId,
    action: "\u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u0645\u0633\u062A\u062E\u062F\u0645 \u0633\u0627\u0628\u0642\u064B\u0627",
    details: `\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0633\u0627\u0628\u0642\u064B\u0627 \u0644\u0644\u0637\u0627\u0644\u0628 ${student.name || targetStudentId} \u0641\u064A \u0645\u0642\u0631\u0631 ${courseNameFromCode(sectionCode)} \u062F\u0648\u0646 \u062D\u0630\u0641 \u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0633\u0627\u0628\u0642.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632",
    browser: "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u064A\u0628",
    isViolationWarning: false
  });
  return res.json({ success: true, message: "\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u0648\u0631\u0628\u0637 \u0627\u0644\u0645\u0642\u0631\u0631 \u0628\u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u0646\u062C\u0627\u062D." });
});
app.post("/api/teacher/device-approval/:id/reject", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const request = findDeviceApprovalRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632." });
  if (!teacherCanHandleDeviceApproval(request, teacherEmail)) return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0631\u0641\u0636 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628." });
  if (String(request.approvalStatus || "") !== "pending") {
    return res.status(409).json({ error: "\u062A\u0645\u062A \u0645\u0639\u0627\u0644\u062C\u0629 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628 \u0633\u0627\u0628\u0642\u064B\u0627." });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  dbInstance.updateActivationAttempt(request.id, {
    approvalStatus: "rejected",
    approvalResolvedAt: now,
    approvalResolvedBy: teacherEmail,
    deviceApprovalRecommendation: "\u062A\u0645 \u0631\u0641\u0636 \u0627\u0644\u0637\u0644\u0628"
  });
  dbInstance.addActivityLog({
    studentId: request.targetStudentId || request.studentId,
    studentName: request.targetStudentName || request.studentName,
    action: "\u0631\u0641\u0636 \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632 \u0645\u0633\u062A\u062E\u062F\u0645 \u0633\u0627\u0628\u0642\u064B\u0627",
    details: `\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0633\u0627\u0628\u0642\u064B\u0627 \u0641\u064A \u0645\u0642\u0631\u0631 ${courseNameFromCode(request.targetSectionCode || request.sectionCode)}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: request.targetSectionCode || request.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0647\u0627\u0632",
    browser: "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u064A\u0628",
    isViolationWarning: false
  });
  return res.json({ success: true, message: "\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632." });
});
app.get("/api/teacher/join-codes", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const includeAll = String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
  const includeRetired = String(req.query.includeRetired || "") === "1";
  const retired = includeRetired && typeof dbInstance.getRetiredJoinCodes === "function" ? dbInstance.getRetiredJoinCodes().map((item) => ({
    ...item,
    isArchived: true
  })) : [];
  const recentlyIssuedCodeVisible = (jc) => {
    const created = Date.parse(String(jc?.createdAt || jc?.issuedAt || "")) || 0;
    return created > 0 && Date.now() - created < 10 * 60 * 1e3;
  };
  const sourceCodes = [
    ...dbInstance.getJoinCodes().filter(
      (jc) => isOperationalJoinCodeRecord(jc) || isUsableJoinCodeRecord(jc) && recentlyIssuedCodeVisible(jc)
    ),
    ...retired.filter((item) => isArchivedJoinCodeRecord(item))
  ];
  const joinCodes = sourceCodes.filter((jc) => String(jc?.code || "").trim()).filter((jc) => includeAll || canAccessJoinCode(jc, teacherEmail)).map((jc) => {
    const storedCourseCode = String(
      jc.sectionCode || jc.courseCode || jc.studentSection || ""
    ).trim();
    const resolvedCourse = resolveJoinCodeCourseForDisplay(jc);
    const courseCode = String(resolvedCourse.courseCode || storedCourseCode).trim();
    const storedName = String(jc.courseName || jc.resolvedCourseName || jc.activatedCourseName || "").trim();
    const courseName = resolvedCourse.courseName || (isUsefulCourseNameForDisplay(storedName, courseCode) ? storedName : "") || (isGenericJoinCourseCode(courseCode) ? "" : courseNameFromCode(courseCode));
    return {
      ...jc,
      sectionCode: courseCode || jc.sectionCode,
      courseCode: courseCode || jc.courseCode,
      studentSection: courseCode || jc.studentSection,
      resolvedCourseCode: resolvedCourse.courseCode || (isGenericJoinCourseCode(courseCode) ? "" : courseCode),
      resolvedCourseName: resolvedCourse.courseName || "",
      courseName: isUsefulCourseNameForDisplay(courseName, courseCode) ? courseName : isGenericJoinCourseCode(courseCode) ? "\u0631\u0645\u0632 \u0639\u0627\u0645 \u2014 \u064A\u064F\u0631\u0628\u0637 \u0639\u0646\u062F \u0627\u0644\u062A\u0641\u0639\u064A\u0644" : courseNameFromCode(courseCode)
    };
  });
  return res.json({ joinCodes });
});
app.post("/api/teacher/join-codes/create", (req, res) => {
  const { count, semester, sectionCode, assignedStudentId, isFreeCode } = req.body;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629. \u0633\u062C\u0651\u0644 \u0627\u0644\u062E\u0631\u0648\u062C \u062B\u0645 \u0627\u062F\u062E\u0644 \u0645\u0646 \u062C\u062F\u064A\u062F." });
  const numCount = Math.max(1, Math.min(Number(count) || 10, 2e3));
  const targetSemester = semester || "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u062F\u0631\u0627\u0633\u064A \u0627\u0644\u062B\u0627\u0646\u064A 2026";
  const generalSale = (req.body?.generalSale === true || String(req.body?.generalSale || "") === "1") && isAdminEmail(teacherEmail) && !assignedStudentId && !isFreeCode;
  let targetSection;
  let ownerEmail;
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
  const assignToRoster = !generalSale && (req.body?.assignToRoster === true || String(req.body?.assignToRoster || "") === "1");
  let assignedName = String(req.body.assignedStudentName || "").trim();
  const assignedId = normalizeStudentId(assignedStudentId);
  if (isFreeCode || assignedId) {
    if (!/^\d{4,}$/.test(assignedId))
      return res.status(400).json({ error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0645\u0637\u0644\u0648\u0628 \u0644\u0644\u0631\u0645\u0632 \u0627\u0644\u0645\u062C\u0627\u0646\u064A \u0627\u0644\u062E\u0627\u0635." });
    const registeredAny = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === assignedId);
    const allowed = dbInstance.getAllowedStudents().find(
      (s) => allowedStudentMatchesCourse(s, assignedId, targetSection, ownerEmail)
    );
    const registered = registeredAny && (allowed || getStudentDiscoveredCourseCodes(registeredAny).some(
      (course) => courseCodeMatchesForTeacher(course, targetSection, ownerEmail)
    )) ? registeredAny : null;
    assignedName = registered?.name || allowed?.name || "";
    if (!assignedName)
      return res.status(400).json({
        error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0635\u062F\u0627\u0631 \u0631\u0645\u0632 \u062E\u0627\u0635: \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0643\u0634\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631."
      });
    const existingFree = dbInstance.getJoinCodes().find(
      (j) => String(j.assignedStudentId || j.studentId || "") === assignedId && String(j.status || "") === "active" && joinCodeOwnerEmail(j) === ownerEmail && courseCodeMatchesForTeacher(
        j.sectionCode || j.studentSection || j.courseCode,
        targetSection,
        ownerEmail
      )
    );
    if (existingFree)
      return res.status(409).json({
        error: "\u064A\u0648\u062C\u062F \u0631\u0645\u0632 \u0641\u0639\u0627\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0637\u0627\u0644\u0628 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u0628\u0627\u0644\u0641\u0639\u0644.",
        existingCode: existingFree.code
      });
  }
  const rosterAssignments = assignToRoster && !assignedId ? Array.from(
    dbInstance.getAllowedStudents().filter((row) => {
      const sid = normalizeStudentId(
        row?.idNumber || row?.id || row?.studentId
      );
      return sid && allowedStudentMatchesCourse(row, sid, targetSection, ownerEmail);
    }).reduce((map, row) => {
      const sid = normalizeStudentId(
        row?.idNumber || row?.id || row?.studentId
      );
      if (!map.has(sid)) map.set(sid, row);
      return map;
    }, /* @__PURE__ */ new Map()).values()
  ).map((row) => ({
    id: normalizeStudentId(row?.idNumber || row?.id || row?.studentId),
    name: String(row?.name || "").trim()
  })).filter((row) => {
    if (!row.id) return false;
    const hasActiveCode = dbInstance.getJoinCodes().some((jc) => {
      const linked = normalizeStudentId(
        jc.assignedStudentId || jc.studentId || jc.usedByStudentId
      );
      return linked === row.id && String(jc.status || "active").toLowerCase() === "active" && joinCodeOwnerEmail(jc) === ownerEmail && courseCodeMatchesForTeacher(
        jc.sectionCode || jc.studentSection || jc.courseCode,
        targetSection,
        ownerEmail
      );
    });
    return !hasActiveCode;
  }) : [];
  if (assignToRoster && !assignedId && !rosterAssignments.length) {
    return res.status(400).json({
      error: "\u0644\u0627 \u064A\u0648\u062C\u062F \u0637\u0644\u0627\u0628 \u0641\u064A \u0643\u0634\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u064A\u062D\u062A\u0627\u062C\u0648\u0646 \u0631\u0645\u0648\u0632\u0627\u064B \u062C\u062F\u064A\u062F\u0629. \u0627\u0631\u0641\u0639 \u0627\u0644\u0643\u0634\u0641 \u0623\u0648 \u0627\u062E\u062A\u0631 \u0637\u0627\u0644\u0628\u0627\u064B \u0645\u062D\u062F\u062F\u0627\u064B."
    });
  }
  const created = [];
  const finalCount = assignToRoster && !assignedId ? Math.min(numCount, rosterAssignments.length) : numCount;
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
        error: "\u062A\u0639\u0630\u0631 \u062A\u0648\u0644\u064A\u062F \u0643\u0648\u062F \u0645\u0643\u062A\u0645\u0644 \u0648\u0622\u0645\u0646. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629."
      });
    }
    const batchId = `Batch-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}-${targetSection}-${ownerEmail}`;
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    const rosterAssignment = !assignedId ? rosterAssignments[i] : null;
    const codeAssignedId = assignedId || rosterAssignment?.id || "";
    const codeAssignedName = assignedName || rosterAssignment?.name || "";
    const newJc = {
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
      codeJourney: createCodeJourneyEvent("\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0643\u0648\u062F", teacherEmail, {
        createdAt,
        teacherEmail,
        ownerEmail,
        sectionCode: targetSection,
        batchId,
        studentId: codeAssignedId || void 0
      }),
      ...codeAssignedId ? {
        assignedStudentId: codeAssignedId,
        assignedStudentName: codeAssignedName || codeAssignedId,
        isFreeCode: Boolean(assignedId || isFreeCode)
      } : {}
    };
    const signedJc = attachJoinCodeSignature(newJc);
    dbInstance.addJoinCode(signedJc);
    created.push(signedJc);
  }
  dbInstance.addActivityLog({
    action: assignedId ? "\u062A\u0648\u0644\u064A\u062F \u0631\u0645\u0632 \u0645\u062C\u0627\u0646\u064A \u062E\u0627\u0635" : generalSale ? "\u062A\u0648\u0644\u064A\u062F \u0631\u0645\u0648\u0632 \u0639\u0627\u0645\u0629 \u0644\u0644\u0628\u064A\u0639" : assignToRoster ? "\u062A\u0648\u0644\u064A\u062F \u0631\u0645\u0648\u0632 \u0634\u062E\u0635\u064A\u0629 \u0645\u0646 \u0627\u0644\u0643\u0634\u0641" : "\u062A\u0648\u0644\u064A\u062F \u062F\u0641\u0639\u0629 \u0631\u0645\u0648\u0632",
    details: assignedId ? `\u062A\u0645 \u0625\u0635\u062F\u0627\u0631 \u0631\u0645\u0632 \u0645\u062C\u0627\u0646\u064A \u062E\u0627\u0635 \u0644\u0644\u0637\u0627\u0644\u0628 ${assignedName} (${assignedId}) \u062F\u0627\u062E\u0644 \u062D\u0633\u0627\u0628 ${ownerEmail}` : generalSale ? `\u062A\u0645 \u062A\u0648\u0644\u064A\u062F (${created.length}) \u0631\u0645\u0632\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0644\u0644\u0628\u064A\u0639 \u063A\u064A\u0631 \u0645\u0631\u062A\u0628\u0637 \u0628\u0645\u0642\u0631\u0631\u060C \u064A\u064F\u0631\u0628\u0637 \u0628\u0627\u0633\u0645 \u0627\u0644\u0637\u0627\u0644\u0628 \u0648\u0645\u0642\u0631\u0631\u0647 \u0639\u0646\u062F \u0627\u0644\u062A\u0641\u0639\u064A\u0644.` : assignToRoster ? `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 (${created.length}) \u0631\u0645\u0632\u0627\u064B \u0634\u062E\u0635\u064A\u0627\u064B \u0645\u0646 \u0643\u0634\u0641 \u0627\u0644\u0645\u0642\u0631\u0631 \u062F\u0627\u062E\u0644 \u062D\u0633\u0627\u0628 ${ownerEmail}` : `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u062F\u0641\u0639\u0629 \u0631\u0645\u0648\u0632 \u062C\u062F\u064A\u062F\u0629 \u0639\u062F\u062F\u0647\u0627 (${numCount}) \u0644\u0644\u0641\u0635\u0644 \u0627\u0644\u062F\u0631\u0627\u0633\u064A: ${targetSemester} \u062F\u0627\u062E\u0644 \u062D\u0633\u0627\u0628 ${ownerEmail}`,
    teacherEmail: ownerEmail,
    actorEmail: teacherEmail,
    sectionCode: targetSection,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0634\u0631\u064A\u0637 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    count: created.length,
    joinCodes: created,
    created
  });
});
app.post("/api/teacher/join-codes/update", (req, res) => {
  const { code, status } = req.body;
  if (!code || !status) return res.status(400).json({ error: "\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0646\u0627\u0642\u0635\u0629" });
  const teacherEmail = teacherEmailFromRequest(req);
  const found = dbInstance.getJoinCodes().find((j) => compactJoinCode(j.code) === compactJoinCode(code));
  if (!found) return res.status(404).json({ error: "\u0627\u0644\u0631\u0645\u0632 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  if (!canAccessJoinCode(found, teacherEmail))
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0631\u0645\u0632 \u062A\u0627\u0628\u0639 \u0644\u062D\u0633\u0627\u0628 \u0623\u0633\u062A\u0627\u0630 \u0622\u062E\u0631." });
  const normalizedStatus = String(status || "").toLowerCase();
  if (!["active", "revoked"].includes(normalizedStatus)) {
    return res.status(400).json({ error: "\u062D\u0627\u0644\u0629 \u0627\u0644\u0631\u0645\u0632 \u063A\u064A\u0631 \u0645\u0639\u062A\u0645\u062F\u0629." });
  }
  if (String(found.status || "").toLowerCase() === "used") {
    return res.status(409).json({
      error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u063A\u064A\u064A\u0631 \u062D\u0627\u0644\u0629 \u0643\u0648\u062F \u0645\u0633\u062A\u062E\u062F\u0645. \u0627\u0633\u062A\u062E\u062F\u0645 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0623\u0648 \u0627\u0644\u062D\u0630\u0641 \u0627\u0644\u0625\u062F\u0627\u0631\u064A \u0644\u0644\u062D\u0641\u0627\u0638 \u0639\u0644\u0649 \u0627\u0644\u0633\u062C\u0644."
    });
  }
  dbInstance.updateJoinCode(found.code, {
    status: normalizedStatus,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return res.json({ success: true });
});
app.post("/api/teacher/join-codes/delete", (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0646\u0627\u0642\u0635\u0629" });
  const teacherEmail = teacherEmailFromRequest(req);
  const activeFound = dbInstance.getJoinCodes().find((j) => compactJoinCode(j.code) === compactJoinCode(code));
  const retiredFound = !activeFound && typeof dbInstance.getRetiredJoinCodes === "function" ? dbInstance.getRetiredJoinCodes().find((j) => compactJoinCode(j.code) === compactJoinCode(code)) : null;
  const found = activeFound || retiredFound;
  if (!found) return res.status(404).json({ error: "\u0627\u0644\u0631\u0645\u0632 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  if (!canAccessJoinCode(found, teacherEmail))
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0631\u0645\u0632 \u062A\u0627\u0628\u0639 \u0644\u062D\u0633\u0627\u0628 \u0623\u0633\u062A\u0627\u0630 \u0622\u062E\u0631." });
  const wasActivated = Boolean(
    found.activatedAt || String(found.status || "").toLowerCase() === "used" || found.studentId || found.usedByStudentId
  );
  const assignedOnlyStudentId = String(found.assignedStudentId || "").trim();
  const linkedStudentId = String(
    found.studentId || found.usedByStudentId || ""
  ).trim();
  let resetActivationStudentId = null;
  const deletedCourse = String(joinCodeCourse(found) || found.sectionCode || "").trim();
  if (activeFound) {
    dbInstance.deleteJoinCode(
      found.code,
      found.isFreeCode ? "teacher_deleted_free_code" : "teacher_deleted_code",
      teacherEmail
    );
  } else {
    deleteRetiredJoinCodeRecord(found.code);
  }
  if (wasActivated && linkedStudentId) {
    const linkedStudent = dbInstance.getStudents().find(
      (st) => String(st.id) === linkedStudentId || normalizeStudentId(st.id) === normalizeStudentId(linkedStudentId)
    );
    if (linkedStudent && deletedCourse) {
      dbInstance.updateStudent(
        linkedStudent.id,
        buildStudentCourseActivationResetPatch(
          linkedStudent,
          deletedCourse,
          joinCodeOwnerEmail(found) || teacherEmail,
          [found]
        )
      );
      resetActivationStudentId = linkedStudent.id;
      notifyUsers(
        (token) => token.role === "student" && String(token.userId) === String(linkedStudent.id),
        "\u064A\u0644\u0632\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0642\u0631\u0631",
        "\u062A\u0645 \u062D\u0630\u0641 \u0643\u0648\u062F \u062A\u0641\u0639\u064A\u0644 \u0633\u0627\u0628\u0642. \u0633\u064A\u0638\u0647\u0631 \u0627\u0644\u0645\u0642\u0631\u0631 \u0644\u062F\u064A\u0643 \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0643\u0648\u062F \u062A\u0641\u0639\u064A\u0644 \u062C\u062F\u064A\u062F.",
        {
          type: "course_activation_required",
          studentId: linkedStudent.id,
          courseCode: deletedCourse,
          link: "/"
        }
      );
    }
  } else if (assignedOnlyStudentId) {
    notifyUsers(
      (token) => token.role === "student" && String(token.userId) === String(assignedOnlyStudentId),
      "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0631\u0645\u0632 \u062F\u062E\u0648\u0644",
      "\u062A\u0645 \u062D\u0630\u0641 \u0631\u0645\u0632 \u062F\u062E\u0648\u0644 \u0643\u0627\u0646 \u0645\u062E\u0635\u0635\u0627\u064B \u0644\u0643 \u0642\u0628\u0644 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647. \u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u0639\u0646\u062F \u0627\u0644\u062D\u0627\u062C\u0629.",
      {
        type: "assigned_code_deleted",
        studentId: assignedOnlyStudentId,
        courseCode: found.sectionCode || "",
        link: "/"
      }
    );
  }
  dbInstance.addActivityLog({
    action: "\u062D\u0630\u0641 \u0631\u0645\u0632 \u062F\u062E\u0648\u0644",
    details: `\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0631\u0645\u0632 ${found.code}${resetActivationStudentId ? ` \u0648\u0625\u0631\u062C\u0627\u0639 \u0645\u0642\u0631\u0631 \u0627\u0644\u0637\u0627\u0644\u0628 (${resetActivationStudentId}) \u0625\u0644\u0649 \u062D\u0627\u0644\u0629 \u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062A\u0641\u0639\u064A\u0644 \u062F\u0648\u0646 \u062D\u0630\u0641 \u0627\u0644\u0645\u0642\u0631\u0631` : assignedOnlyStudentId ? ` \u0648\u0643\u0627\u0646 \u0645\u062E\u0635\u0635\u0627\u064B \u0644\u0644\u0637\u0627\u0644\u0628 (${assignedOnlyStudentId}) \u0642\u0628\u0644 \u0627\u0644\u062A\u0641\u0639\u064A\u0644 \u062F\u0648\u0646 \u0642\u0641\u0644 \u062D\u0633\u0627\u0628\u0647` : ""}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: found.sectionCode || deletedCourse || "",
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0631\u0645\u0648\u0632",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    resetActivationStudentId,
    activationRequiredStudentId: resetActivationStudentId,
    lockedCourseStudentId: null,
    blockedStudentId: null
  });
});
app.post("/api/teacher/join-codes/reissue", (req, res) => {
  const { oldCode } = req.body;
  if (!oldCode) return res.status(400).json({ error: "\u0631\u0645\u0632 \u0645\u0641\u0642\u0648\u062F" });
  const teacherEmail = teacherEmailFromRequest(req);
  const allCodes = dbInstance.getJoinCodes();
  const old = allCodes.find(
    (j) => normalizeJoinCode(j.code) === normalizeJoinCode(oldCode) || compactJoinCode(j.code) === compactJoinCode(oldCode)
  );
  if (!old) return res.status(404).json({ error: "\u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0642\u062F\u064A\u0645 \u063A\u064A\u0631 \u0643\u0627\u0626\u0646" });
  if (!canAccessJoinCode(old, teacherEmail))
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0631\u0645\u0632 \u062A\u0627\u0628\u0639 \u0644\u062D\u0633\u0627\u0628 \u0623\u0633\u062A\u0627\u0630 \u0622\u062E\u0631." });
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  dbInstance.updateJoinCode(old.code, {
    status: "revoked",
    updatedAt: nowIso
  });
  const newCode = makeJoinCode("LAB", "", issuedJoinCodeCompacts());
  const oldResolvedCourse = resolveJoinCodeCourseForDisplay(old);
  const oldResolvedCourseCode = String(
    oldResolvedCourse.courseCode || old.sectionCode || old.studentSection || old.courseCode || ""
  ).trim();
  const oldResolvedCourseName = oldResolvedCourse.courseName || (isGenericJoinCourseCode(oldResolvedCourseCode) ? "" : courseNameFromCode(oldResolvedCourseCode));
  const newJc = {
    code: newCode,
    semester: old.semester,
    sectionCode: oldResolvedCourseCode || old.sectionCode,
    courseCode: oldResolvedCourseCode || old.courseCode || old.sectionCode,
    studentSection: oldResolvedCourseCode || old.studentSection || old.sectionCode,
    resolvedCourseCode: oldResolvedCourseCode,
    resolvedCourseName: oldResolvedCourseName,
    courseName: oldResolvedCourseName || old.courseName,
    status: "active",
    ownerEmail: joinCodeOwnerEmail(old),
    createdByEmail: teacherEmail,
    createdAt: nowIso,
    reissuedFrom: old.code,
    codeJourney: createCodeJourneyEvent("\u0623\u064F\u0639\u064A\u062F \u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u0643\u0648\u062F", teacherEmail, { reissuedFrom: old.code, sectionCode: old.sectionCode })
  };
  if (old.studentId) {
    newJc.status = "used";
    newJc.studentId = old.studentId;
    newJc.usedByStudentId = old.usedByStudentId || old.studentId;
    newJc.studentName = old.studentName;
    newJc.studentSection = oldResolvedCourseCode || old.studentSection || old.sectionCode;
    newJc.sectionCode = oldResolvedCourseCode || old.sectionCode || old.studentSection;
    newJc.courseCode = oldResolvedCourseCode || old.courseCode || old.studentSection || old.sectionCode;
    newJc.resolvedCourseCode = oldResolvedCourseCode;
    newJc.resolvedCourseName = oldResolvedCourseName;
    newJc.courseName = oldResolvedCourseName || old.courseName;
    newJc.activatedAt = old.activatedAt || nowIso;
    newJc.activationDeviceFingerprint = old.activationDeviceFingerprint || "";
    newJc.activationDeviceToken = old.activationDeviceToken || "";
    newJc.activationDeviceServerHash = old.activationDeviceServerHash || "";
    dbInstance.updateStudent(old.studentId, { activationCode: newCode });
  }
  const signedReissued = attachJoinCodeSignature(newJc);
  dbInstance.addJoinCode(signedReissued);
  dbInstance.updateJoinCode(old.code, { replacedBy: newCode, codeJourney: appendCodeJourney(old, codeJourneyEvent("\u0623\u064F\u0639\u064A\u062F \u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u0643\u0648\u062F", req, { replacedBy: newCode, teacherEmail })) });
  dbInstance.addActivityLog({
    action: "\u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0631\u064A\u062F \u0627\u0644\u0631\u0645\u0632",
    details: old.studentId ? `\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0631\u0645\u0632 (${old.code}) \u0648\u062A\u0648\u0644\u064A\u062F \u0631\u0645\u0632 \u0628\u062F\u064A\u0644 (${newCode}) \u0644\u0644\u0637\u0627\u0644\u0628 \u0645\u0639 \u062D\u0641\u0638 \u0642\u0641\u0644 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0623\u0635\u0644\u064A. \u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u062C\u0647\u0627\u0632 \u064A\u062A\u0645 \u0641\u0642\u0637 \u0645\u0646 \u0623\u0645\u0631 \u0625\u0639\u0627\u062F\u0629 \u0636\u0628\u0637 \u0627\u0644\u0648\u0635\u0648\u0644.` : `\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0631\u0645\u0632 (${old.code}) \u0648\u062A\u0648\u0644\u064A\u062F \u0631\u0645\u0632 \u0628\u062F\u064A\u0644 \u0628\u0627\u0633\u0645 (${newCode}).`,
    teacherEmail: joinCodeOwnerEmail(old),
    actorEmail: teacherEmail,
    sectionCode: String(old.studentSection || old.sectionCode || ""),
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0634\u0631\u064A\u0637 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    newCode,
    joinCode: newJc,
    deviceLockPreserved: Boolean(old.studentId)
  });
});
app.post("/api/teacher/students/:id/update-profile", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  const studentId = String(req.params.id).trim();
  const student = dbInstance.getStudents().find((s) => String(s.id) === studentId);
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  if (!teacherCanManageStudent(student, teacherEmail)) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0639\u062F\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0637\u0627\u0644\u0628 \u062E\u0627\u0631\u062C \u0645\u0642\u0631\u0631\u0627\u062A\u0643." });
  }
  const { newIdNumber, newName } = req.body;
  const targetId = normalizeStudentId(newIdNumber);
  const targetName = String(newName || "").trim();
  if (!targetId || !targetName) {
    return res.status(400).json({ error: "\u064A\u062C\u0628 \u0625\u062F\u062E\u0627\u0644 \u0627\u0633\u0645 \u0648\u0631\u0642\u0645 \u062C\u0627\u0645\u0639\u064A \u0635\u062D\u064A\u062D\u064A\u0646." });
  }
  if (targetId !== student.id) {
    const duplicate = dbInstance.getStudents().find((s) => String(s.id) === targetId);
    if (duplicate) {
      return res.status(400).json({ error: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0627\u0645\u0639\u064A \u0627\u0644\u062C\u062F\u064A\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0627\u0644\u0641\u0639\u0644 \u0644\u0637\u0627\u0644\u0628 \u0622\u062E\u0631." });
    }
  }
  dbInstance.addActivityLog({
    studentId: targetId,
    studentName: targetName,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: student.sectionCode,
    action: "\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A",
    details: `\u062A\u0645 \u062A\u0639\u062F\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 \u0642\u0628\u0644 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631. \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0642\u062F\u064A\u0645: ${student.name}\u060C \u0627\u0644\u062C\u062F\u064A\u062F: ${targetName}. \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0642\u062F\u064A\u0645: ${student.id}\u060C \u0627\u0644\u062C\u062F\u064A\u062F: ${targetId}.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0637\u0644\u0627\u0628",
    isViolationWarning: false
  });
  dbInstance.updateStudent(student.id, {
    name: targetName
  });
  if (student.id !== targetId) {
    student.id = targetId;
    dbInstance.persist();
  }
  dbInstance.getJoinCodes().forEach((jc) => {
    const linkedIds = [jc.studentId, jc.usedByStudentId, jc.assignedStudentId].map((value) => normalizeStudentId(value)).filter(Boolean);
    if (linkedIds.some((v) => v === studentId)) {
      if (jc.studentId) jc.studentId = targetId;
      if (jc.usedByStudentId) jc.usedByStudentId = targetId;
      if (jc.assignedStudentId) jc.assignedStudentId = targetId;
    }
  });
  const oldNormalizedId = normalizeStudentId(studentId);
  const newNormalizedId = normalizeStudentId(targetId);
  if (oldNormalizedId && newNormalizedId && oldNormalizedId !== newNormalizedId) {
    const retargetStudentId = (rows) => {
      if (!Array.isArray(rows)) return;
      rows.forEach((row) => {
        if (!row || typeof row !== "object") return;
        if (normalizeStudentId(row.studentId) === oldNormalizedId)
          row.studentId = targetId;
        if (row.linkedStudentId && normalizeStudentId(row.linkedStudentId) === oldNormalizedId)
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
    student: { ...student, name: targetName, id: targetId, idNumber: targetId }
  });
});
app.post("/api/teacher/students/:id/manual-activate", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({
      error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629. \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u064A\u062F\u0648\u064A \u0645\u0646 \u0648\u0627\u062C\u0647\u0629 \u0627\u0644\u0637\u0627\u0644\u0628."
    });
  const student = dbInstance.getStudents().find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0643\u0627\u0626\u0646" });
  if (!teacherCanManageStudent(student, teacherEmail)) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0641\u0639\u064A\u0644 \u0637\u0627\u0644\u0628 \u062E\u0627\u0631\u062C \u0645\u0642\u0631\u0631\u0627\u062A\u0643." });
  }
  dbInstance.updateStudent(student.id, {
    isPaid: true,
    activationCode: student.activationCode || "MANUAL-BY-INSTRUCTOR",
    isAccessBlocked: false,
    accessBlockReason: "",
    accessResetAt: (/* @__PURE__ */ new Date()).toISOString(),
    devices: []
  });
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: student.sectionCode,
    action: "\u0627\u0644\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u064A\u062F\u0648\u064A \u0644\u0644\u0623\u0633\u062A\u0627\u0630",
    details: `\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u062D\u0633\u0627\u0628 \u0627\u0644\u0637\u0627\u0644\u0628 \u064A\u062F\u0648\u064A\u0627\u064B (${student.name}) \u0628\u0642\u0631\u0627\u0631 \u0645\u0646 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u062F\u0648\u0646 \u062A\u0637\u0644\u0628 \u0631\u0645\u0632 \u0627\u0646\u0636\u0645\u0627\u0645.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0634\u0631\u064A\u0637 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629",
    isViolationWarning: false
  });
  return res.json({ success: true });
});
app.post("/api/teacher/students/:idNumber/course-suspension", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  const idNumber = normalizeStudentId(req.params.idNumber);
  const courseCode = String(
    req.body?.courseCode || req.body?.sectionCode || ""
  ).trim();
  const suspend = req.body?.suspend !== false;
  const reason = String(req.body?.reason || "").trim();
  if (!idNumber || !courseCode)
    return res.status(400).json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0637\u0627\u0644\u0628 \u0623\u0648 \u0627\u0644\u0645\u0642\u0631\u0631 \u0646\u0627\u0642\u0635\u0629." });
  const ownerEmail = sectionOwnerEmail(courseCode);
  if (!isAdminEmail(teacherEmail) && ownerEmail !== teacherEmail) {
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u062A\u0627\u0628\u0639 \u0644\u062D\u0633\u0627\u0628 \u0623\u0633\u062A\u0627\u0630 \u0622\u062E\u0631." });
  }
  const student = dbInstance.getStudents().find(
    (st) => normalizeStudentId(st.idNumber || st.id || st.studentId) === idNumber
  );
  if (!student)
    return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u062D\u0633\u0627\u0628 \u0627\u0644\u0637\u0627\u0644\u0628." });
  if (!getStudentDiscoveredCourseCodes(student).some(
    (code) => String(code).toLowerCase() === courseCode.toLowerCase()
  )) {
    return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631." });
  }
  const updatedStudent = setStudentCourseSuspension(
    student,
    courseCode,
    teacherEmail,
    suspend,
    reason
  );
  const revision = bumpLiveContentRevision();
  notifyStudent(
    String(updatedStudent.id),
    suspend ? "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u062F\u062E\u0648\u0644 \u0645\u0642\u0631\u0631 \u0645\u0624\u0642\u062A\u064B\u0627" : "\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u0645\u0642\u0631\u0631",
    suspend ? `\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u062F\u062E\u0648\u0644\u0643 \u0644\u0645\u0642\u0631\u0631 ${sectionDisplayCode(courseCode)} \u0645\u0624\u0642\u062A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0645\u0631\u0627\u062C\u0639\u0629 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631.` : `\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u062F\u062E\u0648\u0644\u0643 \u0644\u0645\u0642\u0631\u0631 ${sectionDisplayCode(courseCode)}.`,
    {
      type: suspend ? "course_student_suspended" : "course_student_reactivated",
      studentId: String(updatedStudent.id),
      courseCode,
      link: "/",
      revision: String(revision)
    }
  );
  dbInstance.addActivityLog({
    studentId: String(updatedStudent.id),
    studentName: String(updatedStudent.name || ""),
    action: suspend ? "\u062A\u0639\u0637\u064A\u0644 \u0637\u0627\u0644\u0628 \u0641\u064A \u0645\u0642\u0631\u0631" : "\u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u0637\u0627\u0644\u0628 \u0641\u064A \u0645\u0642\u0631\u0631",
    details: suspend ? `\u062A\u0645 \u062A\u0639\u0637\u064A\u0644 \u062F\u062E\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0625\u0644\u0649 \u0645\u0642\u0631\u0631 ${courseCode} \u0641\u0642\u0637 \u062F\u0648\u0646 \u062D\u0630\u0641 \u0628\u064A\u0627\u0646\u0627\u062A\u0647 \u0623\u0648 \u062A\u0633\u0644\u064A\u0645\u0627\u062A\u0647 \u0623\u0648 \u062F\u0631\u062C\u0627\u062A\u0647.` : `\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u062F\u062E\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0625\u0644\u0649 \u0645\u0642\u0631\u0631 ${courseCode}.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: courseCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0637\u0644\u0627\u0628",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    student: {
      ...updatedStudent,
      enrollments: getStudentEnrollmentDetails(updatedStudent)
    },
    enrollments: getStudentEnrollmentDetails(updatedStudent),
    revision
  });
});
app.post("/api/teacher/students/:idNumber/remove-course", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  const idNumber = normalizeStudentId(req.params.idNumber);
  const student = dbInstance.getStudents().find(
    (s) => normalizeStudentId(
      s.idNumber || s.id || s.studentId
    ) === idNumber
  );
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const courseCodeToRemove = String(req.body.courseCode || "").trim();
  if (!courseCodeToRemove)
    return res.status(400).json({ error: "\u0631\u0645\u0632 \u0627\u0644\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const normalizedCourseToRemove = courseCodeToRemove.toLowerCase();
  if (teacherEmail && !isAdminEmail(teacherEmail) && sectionOwnerEmail(courseCodeToRemove) !== teacherEmail) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0632\u0627\u0644\u0629 \u062D\u0633\u0627\u0628 \u0637\u0627\u0644\u0628 \u0645\u0646 \u0645\u0642\u0631\u0631 \u0644\u0627 \u062A\u0645\u0644\u0643\u0647." });
  }
  const studentIds = new Set(
    [
      student.id,
      student.idNumber,
      student.studentId,
      idNumber
    ].map((value) => normalizeStudentId(value)).filter(Boolean)
  );
  const hasTeacherSub = dbInstance.getTeacherSubmissions().some((sub) => {
    const isSameStudent = studentIds.has(normalizeStudentId(sub.studentId));
    if (!isSameStudent) return false;
    const subCourse = String(sub.courseCode || sub.sectionCode || "");
    return courseCodeMatchesForTeacher(subCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(subCourse, courseCodeToRemove);
  });
  const hasExerciseSub = dbInstance.getExerciseSubmissions().some((sub) => {
    const isSameStudent = studentIds.has(normalizeStudentId(sub.studentId));
    if (!isSameStudent) return false;
    const subCourse = String(sub.courseCode || sub.sectionCode || "");
    return courseCodeMatchesForTeacher(subCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(subCourse, courseCodeToRemove);
  });
  const hasQuizSub = dbInstance.getQuizSubmissions().some((sub) => {
    const isSameStudent = studentIds.has(normalizeStudentId(sub.studentId));
    if (!isSameStudent) return false;
    const subCourse = String(sub.courseCode || sub.sectionCode || "");
    return courseCodeMatchesForTeacher(subCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(subCourse, courseCodeToRemove);
  });
  const hasProjectSub = dbInstance.getPersonalizedProjects().some((project) => {
    const isSameStudent = studentIds.has(normalizeStudentId(project.studentId));
    if (!isSameStudent) return false;
    const projectCourse = String(project.courseCode || project.sectionCode || "");
    const matchesCourse = courseCodeMatchesForTeacher(projectCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(projectCourse, courseCodeToRemove);
    return matchesCourse && (project.status === "submitted" || project.status === "graded");
  });
  if (hasTeacherSub || hasExerciseSub || hasQuizSub || hasProjectSub) {
    return res.status(400).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062D\u0630\u0641 \u0627\u0644\u0637\u0627\u0644\u0628 \u0644\u0648\u062C\u0648\u062F \u062A\u0633\u0644\u064A\u0645\u0627\u062A (\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A\u060C \u0645\u0634\u0627\u0631\u064A\u0639\u060C \u0623\u0648 \u062A\u062F\u0631\u064A\u0628\u0627\u062A) \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0647 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631." });
  }
  const currentActivationCodeForRemoval = compactJoinCode(student.activationCode || "");
  const linkedCourseCodes = dbInstance.getJoinCodes().filter((jc) => {
    const jcCourse = joinCodeCourse(jc);
    const matchesCourse = courseCodeMatchesForTeacher(jcCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(jcCourse, courseCodeToRemove);
    if (!matchesCourse) return false;
    const linkedIds = [jc.studentId, jc.usedByStudentId, jc.assignedStudentId].map((value) => normalizeStudentId(value)).filter(Boolean);
    const isCurrentActivationCode = !!currentActivationCodeForRemoval && compactJoinCode(jc.code || "") === currentActivationCodeForRemoval;
    return isCurrentActivationCode || linkedIds.some((value) => studentIds.has(value));
  });
  linkedCourseCodes.forEach((jc) => dbInstance.deleteJoinCode(jc.code));
  dbInstance.data.allowedStudents = dbInstance.getAllowedStudents().filter((row) => {
    const rowId = normalizeStudentId(row.idNumber || row.id || row.studentId);
    if (!studentIds.has(rowId)) return true;
    const rowCourse = row.sectionCode || row.studentSection || row.courseCode || "";
    const matches = courseCodeMatchesForTeacher(rowCourse, courseCodeToRemove, teacherEmail) || sectionCodeEquivalent(rowCourse, courseCodeToRemove);
    return !matches;
  });
  dbInstance.persist();
  const deletedCodes = new Set(
    linkedCourseCodes.map((jc) => compactJoinCode(jc.code))
  );
  const currentActivationCode = currentActivationCodeForRemoval;
  const remainingJoinCode = dbInstance.getJoinCodes().find((jc) => {
    if (!isUsableJoinCodeRecord(jc)) return false;
    const status = String(jc.status || "").toLowerCase();
    if (!(status === "used" || status === "active-used" || status === "activated"))
      return false;
    if (courseMatchesRemovalTarget(joinCodeCourse(jc), courseCodeToRemove, teacherEmail)) return false;
    return joinCodeLinkedToStudent(jc, studentIds);
  });
  const patch = buildStudentCourseDeepRemovalPatch(student, courseCodeToRemove, teacherEmail, linkedCourseCodes);
  const remainingPrimaryCode = remainingJoinCode ? String(joinCodeCourse(remainingJoinCode)) : "";
  if (courseMatchesRemovalTarget(student.sectionCode, courseCodeToRemove, teacherEmail)) {
    patch.sectionCode = remainingPrimaryCode;
  }
  if (courseMatchesRemovalTarget(student.studentSection, courseCodeToRemove, teacherEmail)) {
    patch.studentSection = remainingPrimaryCode;
  }
  if (currentActivationCode && deletedCodes.has(currentActivationCode)) {
    patch.activationCode = remainingJoinCode ? remainingJoinCode.code : "";
  }
  patch.courseVisibilitySyncedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (Object.keys(patch).length)
    dbInstance.updateStudent(student.id, patch);
  let updatedStudent = dbInstance.getStudents().find((s) => s.id === student.id) || student;
  const remainingCourses = getStudentActiveCourseCodes(updatedStudent);
  if (!remainingCourses.length) {
    dbInstance.updateStudent(student.id, {
      isAccessBlocked: true,
      accessBlockReason: "\u062A\u0645 \u062D\u0630\u0641\u0643 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0623\u062E\u064A\u0631 \u0627\u0644\u0645\u0639\u064A\u0646 \u0644\u0643.",
      devices: []
    });
  } else if (updatedStudent.isAccessBlocked && String(updatedStudent.accessBlockReason || "") === "\u062A\u0645 \u062D\u0630\u0641\u0643 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0623\u062E\u064A\u0631 \u0627\u0644\u0645\u0639\u064A\u0646 \u0644\u0643.") {
    dbInstance.updateStudent(student.id, {
      isAccessBlocked: false,
      accessBlockReason: ""
    });
  }
  updatedStudent = dbInstance.getStudents().find((s) => s.id === student.id) || updatedStudent;
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: courseCodeToRemove,
    action: "\u062D\u0630\u0641 \u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631",
    details: `\u062A\u0645 \u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0637\u0627\u0644\u0628 ${student.name} \u0645\u0646 \u0627\u0644\u0645\u0642\u0631\u0631 ${courseCodeToRemove}${linkedCourseCodes.length ? ` \u0645\u0639 \u0641\u0635\u0644 ${linkedCourseCodes.length} \u0631\u0645\u0632 \u062F\u062E\u0648\u0644 \u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631` : ""}.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0645\u062A\u0635\u0641\u062D",
    isViolationWarning: false
  });
  return res.json({
    success: true,
    updatedStudent: {
      ...updatedStudent,
      enrollments: getStudentEnrollmentDetails(updatedStudent)
    },
    removedJoinCodes: linkedCourseCodes.length
  });
});
app.post("/api/teacher/students/:id/reset-access", (req, res) => {
  const student = dbInstance.getStudents().find((s) => s.id === String(req.params.id));
  if (!student) return res.status(404).json({ error: "\u0627\u0644\u0637\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !isAdminEmail(teacherEmail) && sectionOwnerEmail(student.sectionCode) !== teacherEmail) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0639\u062F\u064A\u0644 \u062D\u0633\u0627\u0628 \u0637\u0627\u0644\u0628 \u0641\u064A \u0645\u0642\u0631\u0631 \u0644\u0627 \u062A\u0645\u0644\u0643\u0647." });
  }
  const activationCode = student.activationCode;
  const linkedJoinCodes = dbInstance.getJoinCodes().filter((jc) => {
    const sameCode = activationCode && normalizeJoinCode(jc.code) === normalizeJoinCode(activationCode);
    const sameStudent = normalizeStudentId(jc.studentId || jc.usedByStudentId || "") === normalizeStudentId(student.id);
    return sameCode || sameStudent;
  });
  const retiredDeviceFingerprints = Array.isArray(student.devices) ? student.devices.map((d) => String(d || "").trim()).filter(Boolean) : [];
  const retiredDeviceTokens = linkedJoinCodes.map((jc) => String(jc.activationDeviceToken || "").trim()).filter(Boolean);
  linkedJoinCodes.forEach((jc) => {
    dbInstance.updateJoinCode(jc.code, {
      activationDeviceFingerprint: "",
      activationDeviceToken: "",
      // لا بد من تفريغ بصمة الخادم أيضاً عند إعادة التهيئة، وإلا بقيت مرتبطة
      // بالجهاز القديم فتقفل الطالب على الجهاز الجديد بعد أول دخول وتُطلق تنبيه
      // "توكن منسوخ" زوراً وتمنع إدخال الكود الجديد. (نفس ما يفعله reset-devices)
      activationDeviceServerHash: ""
    });
  });
  const mode = String(req.body?.mode || "reset_device");
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const accessPatch = mode === "hold" ? {
    devices: [],
    accessResetAt: nowIso,
    isAccessBlocked: true,
    accessBlockReason: "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0624\u0642\u062A\u0627\u064B \u0645\u0646 \u0642\u0628\u0644 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631.",
    pendingDeviceTransfer: false,
    retiredDeviceFingerprints: [],
    retiredDeviceTokens: []
  } : mode === "restore" ? {
    devices: [],
    accessResetAt: nowIso,
    isAccessBlocked: false,
    accessBlockReason: "",
    isPaid: true,
    pendingDeviceTransfer: false,
    retiredDeviceFingerprints: [],
    retiredDeviceTokens: []
  } : {
    devices: [],
    accessResetAt: nowIso,
    isAccessBlocked: false,
    accessBlockReason: "",
    // حالة واضحة: "بانتظار اعتماد الجهاز الجديد". أول جهاز مختلف فعلاً عن
    // القديم يدخل بنجاح يُعتمد رسمياً ويُقفل عليه، والجهاز القديم يُرفض برسالة واضحة.
    pendingDeviceTransfer: true,
    retiredDeviceFingerprints,
    retiredDeviceTokens
  };
  dbInstance.updateStudent(student.id, accessPatch);
  dbInstance.addActivityLog({
    studentId: student.id,
    studentName: student.name,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: student.sectionCode,
    action: mode === "hold" ? "\u0625\u064A\u0642\u0627\u0641 \u062D\u0633\u0627\u0628 \u0627\u0644\u0637\u0627\u0644\u0628" : mode === "restore" ? "\u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u062D\u0633\u0627\u0628 \u0627\u0644\u0637\u0627\u0644\u0628" : "\u0625\u0639\u0627\u062F\u0629 \u062A\u0647\u064A\u0626\u0629 \u0631\u0628\u0637 \u0627\u0644\u0623\u062C\u0647\u0632\u0629",
    details: mode === "hold" ? `\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u062D\u0633\u0627\u0628 \u0627\u0644\u0637\u0627\u0644\u0628 ${student.name} \u0641\u0648\u0631\u064A\u0627\u064B.` : mode === "restore" ? `\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u062D\u0633\u0627\u0628 \u0627\u0644\u0637\u0627\u0644\u0628 ${student.name} \u0648\u0627\u0644\u0633\u0645\u0627\u062D \u0644\u0647 \u0628\u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u062C\u062F\u064A\u062F.` : `\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0647\u064A\u0626\u0629 \u062C\u0647\u0627\u0632 \u0627\u0644\u0637\u0627\u0644\u0628 ${student.name} \u0648\u0625\u0646\u0647\u0627\u0621 \u062C\u0644\u0633\u0629 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0642\u062F\u064A\u0645 \u0648\u062A\u062C\u0647\u064A\u0632 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u062C\u062F\u064A\u062F \u0639\u0646\u062F \u0627\u0644\u062F\u062E\u0648\u0644 \u0627\u0644\u062A\u0627\u0644\u064A.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0637\u0644\u0628\u0629",
    isViolationWarning: false
  });
  notifyUsers(
    (token) => token.role === "student" && String(token.userId) === String(student.id),
    mode === "hold" ? "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u062D\u0633\u0627\u0628" : mode === "restore" ? "\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628" : "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0648\u0635\u0648\u0644",
    mode === "hold" ? "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u062D\u0633\u0627\u0628\u0643 \u0645\u0624\u0642\u062A\u0627\u064B \u0645\u0646 \u0642\u0628\u0644 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631." : mode === "restore" ? "\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644 \u062D\u0633\u0627\u0628\u0643. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u062C\u062F\u064A\u062F." : "\u062A\u0645\u062A \u0625\u0639\u0627\u062F\u0629 \u062A\u0647\u064A\u0626\u0629 \u0631\u0628\u0637 \u062C\u0647\u0627\u0632 \u062D\u0633\u0627\u0628\u0643. \u0627\u0641\u062A\u062D \u0645\u0650\u0631\u0627\u0633 \u0645\u0646 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u064A\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F\u0647 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B.",
    {
      type: mode === "hold" ? "access_blocked" : mode === "restore" ? "access_restored" : "access_reset",
      studentId: student.id,
      link: "/"
    }
  );
  return res.json({
    success: true,
    student: dbInstance.getStudents().find((s) => s.id === student.id)
  });
});
app.get("/api/teacher/sections", (req, res) => {
  setNoCache(res);
  const teacherEmail = teacherEmailFromRequest(req);
  const includeAll = String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
  const sections = activeSections().filter(
    (sec) => includeAll || !teacherEmail || sectionOwnerEmail(sec.code) === teacherEmail
  );
  return res.json({ success: true, sections });
});
app.post("/api/teacher/sections", (req, res) => {
  const { code, courseName, semester, isOpen } = req.body;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  if (!code || !courseName) {
    return res.status(400).json({ error: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0631\u0645\u0632 \u0627\u0644\u0645\u0642\u0631\u0631 \u0648\u0627\u0633\u0645 \u0627\u0644\u0645\u0642\u0631\u0631." });
  }
  const normalizedCode = sectionDisplayCode(String(code).trim());
  const finalCode = buildTeacherScopedSectionCode(normalizedCode, teacherEmail);
  const teacherKey = teacherEmail.toLowerCase();
  const exists = getTeacherOwnedEquivalentSections(finalCode, teacherKey).find(
    (s) => String(s.code || "").trim() && !deletedTeacherCourseShadowMatches(s, finalCode, teacherKey)
  );
  if (exists) {
    return res.status(409).json({
      error: "\u0631\u0642\u0645 \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0627\u0644\u0641\u0639\u0644 \u062F\u0627\u062E\u0644 \u062D\u0633\u0627\u0628\u0643. \u0627\u062D\u0630\u0641 \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0642\u062F\u064A\u0645 \u0623\u0648 \u0639\u062F\u0651\u0644 \u0631\u0642\u0645\u0647 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629."
    });
  }
  const section = {
    code: finalCode,
    courseName,
    semester: semester || "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u062D\u0627\u0644\u064A",
    isOpen: typeof isOpen === "boolean" ? isOpen : true,
    ownerEmail: teacherEmail
  };
  dbInstance.addSection(section);
  return res.json({ success: true, section });
});
app.put("/api/teacher/sections/:code", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const codeParam = String(req.params.code).trim().toUpperCase();
  const section = activeSections().find((s) => s.code.toUpperCase() === codeParam);
  if (!section) return res.status(404).json({ error: "\u0627\u0644\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  if (section.ownerEmail?.toLowerCase() !== teacherEmail.toLowerCase()) {
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u062A\u0627\u0628\u0639 \u0644\u062D\u0633\u0627\u0628 \u0623\u0633\u062A\u0627\u0630 \u0622\u062E\u0631." });
  }
  const currentCode = String(section.code || "").trim();
  const requestedDisplayCode = String(req.body?.code || sectionDisplayCode(currentCode) || currentCode).trim();
  const nextCode = buildTeacherScopedSectionCode(requestedDisplayCode, teacherEmail);
  if (!nextCode) {
    return res.status(400).json({ error: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0631\u0645\u0632 \u0627\u0644\u0645\u0642\u0631\u0631." });
  }
  const nextCourseName = String(req.body?.courseName ?? section.courseName ?? "").trim();
  if (!nextCourseName) {
    return res.status(400).json({ error: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0642\u0631\u0631." });
  }
  const teacherKey = teacherEmail.toLowerCase();
  const duplicate = getTeacherOwnedEquivalentSections(nextCode, teacherKey).find(
    (s) => !sectionCodeEquivalent(s.code, currentCode)
  );
  if (duplicate) {
    return res.status(409).json({
      error: "\u0631\u0642\u0645 \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0627\u0644\u0641\u0639\u0644 \u062F\u0627\u062E\u0644 \u062D\u0633\u0627\u0628\u0643. \u063A\u064A\u0651\u0631 \u0627\u0644\u0631\u0642\u0645 \u0623\u0648 \u0639\u062F\u0651\u0644 \u0627\u0644\u0645\u0642\u0631\u0631 \u0627\u0644\u0645\u0648\u062C\u0648\u062F."
    });
  }
  const patch = {
    ...req.body,
    code: nextCode,
    courseName: nextCourseName,
    ownerEmail: teacherEmail
  };
  if (req.body?.semester !== void 0) patch.semester = req.body.semester || "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u062D\u0627\u0644\u064A";
  dbInstance.updateSection(section.code, patch);
  migrateTeacherCourseCodeReferences(currentCode, nextCode);
  touchStudentsLinkedToCourse(nextCode);
  bumpLiveContentRevision();
  const updatedSection = activeSections().find((s) => sectionCodeEquivalent(s.code, nextCode));
  if (typeof req.body?.isOpen === "boolean") {
    const affectedStudentIds = new Set(
      dbInstance.getStudents().filter(
        (student) => getStudentDiscoveredCourseCodes(student).some(
          (code) => sectionCodeEquivalent(code, nextCode)
        )
      ).map((student) => String(student.id))
    );
    notifyUsers(
      (token) => token.role === "student" && affectedStudentIds.has(String(token.userId)),
      req.body.isOpen ? "\u062A\u0645 \u0641\u062A\u062D \u0627\u0644\u0645\u0642\u0631\u0631" : "\u062A\u0645 \u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0645\u0642\u0631\u0631",
      req.body.isOpen ? `\u062A\u0645 \u0641\u062A\u062D \u0645\u0642\u0631\u0631 ${courseNameFromCode(nextCode)} \u0645\u0646 \u062C\u062F\u064A\u062F.` : `\u062A\u0645 \u0625\u063A\u0644\u0627\u0642 \u0645\u0642\u0631\u0631 ${courseNameFromCode(nextCode)} \u0648\u062A\u0639\u0637\u064A\u0644 \u0643\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639 \u0627\u0644\u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0647.`,
      {
        type: req.body.isOpen ? "course_opened" : "course_closed",
        courseCode: nextCode,
        link: "/"
      }
    );
  }
  return res.json({ success: true, section: updatedSection });
});
app.delete("/api/teacher/sections/:code", (req, res) => {
  const codeParam = String(req.params.code || "").trim();
  const teacherEmail = teacherEmailFromRequest(req);
  const section = getTeacherOwnedEquivalentSections(codeParam, teacherEmail)[0];
  if (!section) return res.status(404).json({ error: "\u0627\u0644\u0645\u0642\u0631\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  if (String(section.ownerEmail || sectionOwnerEmail(section.code)).toLowerCase() !== teacherEmail.toLowerCase()) {
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u062A\u0627\u0628\u0639 \u0644\u062D\u0633\u0627\u0628 \u0623\u0633\u062A\u0627\u0630 \u0622\u062E\u0631." });
  }
  const deletedCodes = getTeacherOwnedEquivalentSections(section.code, teacherEmail).map((sec) => sec.code);
  const matchesDeleted = (c) => {
    const cc = String(c || "").trim();
    return !!cc && deletedCodes.some(
      (code) => courseCodeMatchesForTeacher(cc, code, teacherEmail) || sectionCodeEquivalent(cc, code)
    );
  };
  const removedCodeCompacts = new Set(
    dbInstance.getJoinCodes().filter((jc) => matchesDeleted(jc.sectionCode || jc.courseCode || jc.code || "")).map((jc) => compactJoinCode(jc.code))
  );
  dbInstance.data.allowedStudents = dbInstance.getAllowedStudents().filter((s) => {
    const courseCode = s.sectionCode || s.studentSection || s.courseCode || "";
    return !matchesDeleted(courseCode);
  });
  dbInstance.getStudents().forEach((s) => {
    const patch = {};
    const touchedCodes = /* @__PURE__ */ new Set();
    const rememberTouched = (value) => {
      const raw = String(value || "").trim();
      if (raw && matchesDeleted(raw)) touchedCodes.add(raw);
    };
    rememberTouched(s.sectionCode);
    rememberTouched(s.studentSection);
    if (Array.isArray(s.enrollments)) {
      s.enrollments.forEach((en) => rememberTouched(en?.courseCode || en?.sectionCode || en?.studentSection));
      const next = s.enrollments.filter(
        (en) => !matchesDeleted(en?.courseCode || en?.sectionCode || en?.studentSection)
      );
      if (next.length !== s.enrollments.length) patch.enrollments = next;
    }
    if (Array.isArray(s.activatedCourseCodes)) {
      s.activatedCourseCodes.forEach(rememberTouched);
      const next = s.activatedCourseCodes.filter((c) => !matchesDeleted(c));
      if (next.length !== s.activatedCourseCodes.length) patch.activatedCourseCodes = next;
    }
    if (Array.isArray(s.suspendedEnrollments)) {
      const next = s.suspendedEnrollments.filter(
        (en) => !matchesDeleted(en?.courseCode || en?.sectionCode)
      );
      if (next.length !== s.suspendedEnrollments.length) patch.suspendedEnrollments = next;
    }
    if (matchesDeleted(s.sectionCode)) patch.sectionCode = "";
    if (matchesDeleted(s.studentSection)) patch.studentSection = "";
    if (s.activationCode && removedCodeCompacts.has(compactJoinCode(s.activationCode)))
      patch.activationCode = "";
    if (touchedCodes.size) {
      const existingLinks = canonicalStudentRemovedCourseLinks(s).filter(
        (entry) => !matchesDeleted(entry?.courseCode || entry?.sectionCode || entry?.studentSection)
      );
      const removedAt = (/* @__PURE__ */ new Date()).toISOString();
      const markers = Array.from(touchedCodes).map((course) => ({
        studentId: normalizeStudentId(s.id || s.idNumber || s.studentId),
        courseCode: course,
        sectionCode: course,
        studentSection: course,
        teacherEmail,
        removedAt,
        deletedAt: removedAt,
        status: "removed",
        reason: "course_deleted"
      }));
      patch.removedCourseLinks = [...existingLinks, ...markers];
      patch.removedEnrollments = patch.removedCourseLinks;
      patch.deletedCourseLinks = patch.removedCourseLinks;
    }
    if (Object.keys(patch).length) dbInstance.updateStudent(s.id, patch);
  });
  dbInstance.data.joinCodes = dbInstance.getJoinCodes().filter((jc) => {
    const jcCode = jc.sectionCode || jc.courseCode || jc.code || "";
    return !matchesDeleted(jcCode);
  });
  deletedCodes.forEach((code) => dbInstance.deleteSection(code));
  dbInstance.persist();
  return res.json({ success: true, deletedCodes, deletedSection: section });
});
app.post("/api/teacher/textbook/upload", (req, res) => {
  const { fileName, size, fileData } = req.body;
  const uploadedAt = /* @__PURE__ */ new Date();
  const safeId = `SRC-${uploadedAt.getFullYear()}-${import_crypto.default.randomBytes(4).toString("hex").toUpperCase()}`;
  const protectedDir = import_path2.default.join(process.cwd(), "data", "protected_sources");
  import_fs2.default.mkdirSync(protectedDir, { recursive: true });
  let sha256 = "metadata-only";
  let storedPath = "metadata-only";
  if (typeof fileData === "string" && fileData.includes("base64,")) {
    const base64Payload = fileData.split("base64,")[1];
    const buffer = Buffer.from(base64Payload, "base64");
    sha256 = import_crypto.default.createHash("sha256").update(buffer).digest("hex");
    storedPath = import_path2.default.join(protectedDir, `${safeId}.pdf`);
    import_fs2.default.writeFileSync(storedPath, buffer);
  }
  dbInstance.setBookMetadata({
    fileName: `\u0645\u0635\u062F\u0631 \u0645\u062D\u0645\u064A ${safeId}`,
    uploadDate: uploadedAt.toLocaleString("en-GB", {
      timeZone: "Asia/Kuwait",
      hour12: false
    }),
    size: size || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F",
    sourceId: safeId,
    sha256,
    protectedPath: storedPath,
    originalNameHidden: fileName ? true : false
  });
  dbInstance.addActivityLog({
    action: "\u0631\u0641\u0639 \u0645\u0635\u062F\u0631 PDF \u0645\u062D\u0645\u064A",
    details: `\u062A\u0645 \u0631\u0641\u0639 \u0645\u0635\u062F\u0631 \u0645\u0642\u0631\u0631 \u0645\u062D\u0645\u064A \u0628\u0631\u0642\u0645 (${safeId}). \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0638\u0627\u0647\u0631 \u0644\u0644\u0637\u0644\u0628\u0629 \u0648\u064A\u0633\u062A\u062E\u062F\u0645 \u062F\u0627\u062E\u0644\u064A\u0627\u064B \u0641\u0642\u0637 \u0644\u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0641\u0635\u0648\u0644 \u0648\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0623\u0646\u0634\u0637\u0629 \u0648\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0648\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0623\u0645\u0646\u064A\u0629",
    browser: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0634\u0631\u0641",
    isViolationWarning: false
  });
  return res.json({ success: true, metadata: dbInstance.getBookMetadata() });
});
app.post("/api/teacher/textbook/delete", (req, res) => {
  dbInstance.setBookMetadata(void 0);
  return res.json({ success: true });
});
app.post("/api/teacher/textbook/analyze", async (req, res) => {
  let teacherEmail = teacherEmailFromRequest(req);
  const courseCode = String(
    req.query.courseCode || req.body?.courseCode || ""
  ).trim();
  if (!teacherEmail && courseCode) {
    teacherEmail = sectionOwnerEmail(courseCode);
  }
  if (!teacherEmail) {
    teacherEmail = "ah.alfailakawi@paaet.edu.kw";
  }
  teacherEmail = teacherEmail.toLowerCase();
  const existingChapters = dbInstance.getChapters().filter(
    (c) => c.teacherEmail && c.teacherEmail.toLowerCase() === teacherEmail
  );
  const isExplicitTrigger = req.body && (req.body.force === true || req.body.fileName);
  if (existingChapters.length > 0 && !isExplicitTrigger) {
    return res.json({
      success: true,
      chapters: existingChapters,
      metadata: dbInstance.getBookMetadata()
    });
  }
  const meta = dbInstance.getBookMetadata() || {};
  const protectedPath = meta.protectedPath;
  let extraction = {
    text: "",
    method: "none",
    warning: "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0635\u062F\u0631 PDF \u0645\u0631\u0641\u0648\u0639 \u062D\u062A\u0649 \u0627\u0644\u0622\u0646."
  };
  if (!protectedPath || protectedPath === "metadata-only") {
    const teacherChapters = dbInstance.getChapters().filter(
      (c) => c.teacherEmail && c.teacherEmail.toLowerCase() === teacherEmail
    );
    return res.json({
      success: true,
      chapters: teacherChapters,
      metadata: dbInstance.getBookMetadata(),
      warning: "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0635\u062F\u0631 PDF \u0645\u0631\u0641\u0648\u0639\u060C \u0644\u0630\u0644\u0643 \u0644\u0645 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0623\u064A \u0641\u0635\u0648\u0644 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629.",
      extractionMethod: "none",
      extractedChars: 0
    });
  }
  if (protectedPath && protectedPath !== "metadata-only" && import_fs2.default.existsSync(protectedPath)) {
    extraction = extractPdfTextLocal(protectedPath);
  }
  const result = buildLocalChaptersFromText(extraction.text, {
    ...meta,
    extractionMethod: extraction.method
  });
  if (!result.chapters.length) {
    dbInstance.setBookMetadata({
      ...meta,
      extractedChars: result.extractedChars,
      extractionMethod: extraction.method,
      extractionWarning: extraction.warning || result.warning || "\u0644\u0645 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0641\u0635\u0648\u0644 \u0644\u0623\u0646 \u0627\u0644\u0645\u0635\u062F\u0631 \u0644\u0627 \u064A\u062D\u062A\u0648\u064A \u0646\u0635\u0627\u064B \u0643\u0627\u0641\u064A\u0627\u064B.",
      lastAnalyzedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const teacherChapters = dbInstance.getChapters().filter(
      (c) => c.teacherEmail && c.teacherEmail.toLowerCase() === teacherEmail
    );
    return res.json({
      success: true,
      chapters: teacherChapters,
      metadata: dbInstance.getBookMetadata(),
      warning: extraction.warning || result.warning || "\u0644\u0645 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0641\u0635\u0648\u0644 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629.",
      extractionMethod: extraction.method,
      extractedChars: result.extractedChars
    });
  }
  const chaptersWithEmail = result.chapters.map((c) => ({
    ...c,
    teacherEmail
  }));
  const otherChapters = dbInstance.getChapters().filter(
    (c) => c.teacherEmail && c.teacherEmail.toLowerCase() !== teacherEmail
  );
  const mergedChapters = [...otherChapters, ...chaptersWithEmail];
  dbInstance.setChapters(mergedChapters);
  dbInstance.setBookMetadata({
    ...meta,
    extractedChars: result.extractedChars,
    extractionMethod: extraction.method,
    extractionWarning: extraction.warning || result.warning || "",
    lastAnalyzedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  dbInstance.addActivityLog({
    action: "\u062A\u062D\u0644\u064A\u0644 \u0645\u0635\u062F\u0631 PDF \u0645\u062D\u0644\u064A",
    details: extraction.warning ? `\u062A\u0645 \u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0645\u0635\u062F\u0631 \u0645\u062D\u0644\u064A\u064B\u0627 \u0644\u0643\u0646 \u0627\u0644\u0646\u0635 \u0627\u0644\u0642\u0627\u0628\u0644 \u0644\u0644\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0645\u062D\u062F\u0648\u062F. ${extraction.warning}` : `\u062A\u0645 \u0627\u0633\u062A\u062E\u0631\u0627\u062C ${result.extractedChars} \u062D\u0631\u0641\u064B\u0627 \u0645\u0646 \u0627\u0644\u0645\u0635\u062F\u0631 \u0648\u0628\u0646\u0627\u0621 \u062E\u0631\u064A\u0637\u0629 \u0641\u0635\u0648\u0644 \u0645\u062D\u0644\u064A\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u0639\u062F\u064A\u0644.`,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0645\u062D\u0644\u0644 PDF \u0645\u062D\u0644\u064A \u0645\u062C\u0627\u0646\u064A",
    browser: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0634\u0631\u0641",
    isViolationWarning: !!extraction.warning
  });
  return res.json({
    success: true,
    chapters: chaptersWithEmail,
    metadata: dbInstance.getBookMetadata(),
    warning: extraction.warning || result.warning || "",
    extractionMethod: extraction.method,
    extractedChars: result.extractedChars
  });
});
app.post("/api/teacher/textbook/update", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const { chapters } = req.body;
  if (!Array.isArray(chapters)) {
    return res.status(400).json({ error: "\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0641\u0635\u0648\u0644 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" });
  }
  let teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0645\u0639\u0644\u0645 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629" });
  }
  teacherEmail = teacherEmail.toLowerCase();
  const chaptersWithEmail = chapters.map((c) => ({
    ...c,
    teacherEmail
  }));
  const otherChapters = dbInstance.getChapters().filter(
    (c) => c.teacherEmail && c.teacherEmail.toLowerCase() !== teacherEmail
  );
  const mergedChapters = [...otherChapters, ...chaptersWithEmail];
  dbInstance.setChapters(mergedChapters);
  if (!await ensureDurableSync(res)) return;
  return res.json({ success: true, chapters: chaptersWithEmail });
});
app.post("/api/teacher/textbook/generate-questions", async (req, res) => {
  const { chapterId, quantity } = req.body;
  const chapter = dbInstance.getChapters().find((c) => c.id === chapterId);
  if (!chapter)
    return res.status(404).json({ error: "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u062F\u0631\u0627\u0633\u064A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  let fetchedQuestions = [];
  if (false) {
    try {
      const prompt = `\u0623\u0646\u062A \u0623\u0633\u062A\u0627\u0630 \u0648\u0623\u0643\u0627\u062F\u064A\u0645\u064A \u062E\u0628\u064A\u0631 \u0641\u064A \u0635\u064A\u0627\u063A\u0629 \u0623\u0633\u0626\u0644\u0629 \u062A\u0642\u064A\u064A\u0645 \u0627\u0644\u062A\u0639\u0644\u0645 \u0627\u0644\u062A\u0637\u0628\u064A\u0642\u064A \u0644\u0644\u0645\u0631\u0627\u062D\u0644 \u0627\u0644\u062C\u0627\u0645\u0639\u064A\u0629.
\u0642\u0645 \u0628\u062A\u0648\u0644\u064A\u062F ${quantity || 3} \u0623\u0631\u0628\u0639\u0629 \u0623\u0633\u0626\u0644\u0629 \u0641\u0631\u064A\u062F\u0629\u060C \u062A\u062A\u0648\u0627\u0641\u0642 \u0645\u0639 \u062A\u0641\u0627\u0635\u064A\u0644 \u0648\u0645\u062D\u062A\u0648\u0649 \u0647\u0630\u0627 \u0627\u0644\u0641\u0635\u0644 \u0645\u0646 \u0643\u062A\u0627\u0628 \u0627\u0644\u062A\u0639\u0644\u0645 \u0627\u0644\u062A\u0637\u0628\u064A\u0642\u064A:
\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0641\u0635\u0644: "${chapter.title}"
\u0623\u0647\u062F\u0627\u0641\u0647 \u0648\u0645\u0648\u0627\u0636\u064A\u0639\u0647: ${JSON.stringify(chapter.topics)}

\u062A\u0623\u0643\u062F \u0645\u0646 \u062A\u0646\u0648\u064A\u0639 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0628\u064A\u0646: \u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0646 \u0645\u062A\u0639\u062F\u062F (multiple-choice)\u060C \u0648\u0635\u062D \u0623\u0648 \u062E\u0637\u0623 (true-false)\u060C \u062A\u0631\u062A\u064A\u0628 \u062E\u0637\u0648\u0627\u062A (ordering)\u060C \u062A\u062D\u0644\u064A\u0644 \u062D\u0627\u0644\u0629 \u062A\u0637\u0628\u064A\u0642\u064A (scenario-analysis).
\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0641\u0635\u062D\u0649 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629 \u0648\u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0630\u0643\u064A\u0629 \u0648\u0644\u064A\u0633\u062A \u062A\u0627\u0641\u0647\u0629.
\u0623\u0631\u0633\u0644 \u0627\u0644\u0631\u062F \u0628\u062A\u0646\u0633\u064A\u0642 JSON \u0646\u0638\u064A\u0641 \u0648\u0635\u0627\u0644\u062D \u0644\u0644\u0645\u0635\u0641\u0648\u0641\u0629 \u0644\u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0628\u0646\u064A\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629 \u0641\u0642\u0637\u060C \u062F\u0648\u0646 \u0643\u062A\u0627\u0628\u0629 \u0623\u064A \u0643\u0644\u0627\u0645 \u062A\u062D\u0636\u064A\u0631\u064A \u0623\u0648 \u0634\u0631\u062D:
[
  {
    "type": "multiple-choice",
    "questionText": "\u0646\u0635 \u0627\u0644\u0633\u0624\u0627\u0644 \u0627\u0644\u062F\u0642\u064A\u0642 \u0627\u0644\u0639\u0627\u0644\u064A \u0627\u0644\u0635\u0639\u0648\u0628\u0629 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629 \u0648\u0627\u0644\u0645\u0641\u0627\u0647\u064A\u0645\u064A\u0629",
    "options": ["\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u0623\u0648\u0644 \u0627\u0644\u0635\u062D\u064A\u062D", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u062B\u0627\u0646\u064A \u0627\u0644\u0645\u0634\u062A\u062A \u0630\u0643\u064A", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u062B\u0627\u0644\u062B \u0627\u0644\u0645\u0634\u062A\u062A \u0630\u0643\u064A", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u0631\u0627\u0628\u0639 \u0627\u0644\u0645\u0634\u062A\u062A \u0630\u0643\u064A"],
    "correctAnswer": "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u0623\u0648\u0644 \u0627\u0644\u0635\u062D\u064A\u062D",
    "difficulty": "intermediate",
    "points": 5
  },
  {
    "type": "true-false",
    "questionText": "\u0647\u0646\u0627 \u0646\u0635 \u0627\u0644\u0633\u0624\u0627\u0644 \u0627\u0644\u0645\u062B\u064A\u0631 \u0644\u0644\u0645\u0642\u0627\u0631\u0646\u0629 \u0641\u064A \u062A\u0635\u0645\u064A\u0645 \u0627\u0644\u0645\u0642\u0631\u0631",
    "correctAnswer": "\u0635\u062D",
    "difficulty": "beginner",
    "points": 3
  },
  {
    "type": "ordering",
    "questionText": "\u0631\u062A\u0628 \u062E\u0637\u0648\u0627\u062A \u0627\u0644\u0625\u0646\u0634\u0627\u0626\u064A\u0629 \u0628\u0637\u0631\u064A\u0642\u0629 \u0639\u0644\u0645\u064A\u0629:",
    "correctAnswer": ["\u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u0623\u0648\u0644\u0649 \u0644\u0644\u062A\u0631\u062A\u064A\u0628", "\u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u062B\u0627\u0646\u064A\u0629 \u0644\u0644\u062A\u0631\u062A\u064A\u0628", "\u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u062B\u0627\u0644\u062B\u0629 \u0644\u0644\u062A\u0631\u062A\u064A\u0628", "\u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u0631\u0627\u0628\u0639\u0629 \u0644\u0644\u062A\u0631\u062A\u064A\u0628"],
    "difficulty": "advanced",
    "points": 5
  }
]`;
      const response = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.8
        }
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
          isApproved: false,
          // Must be approved by teacher first!
          isGenerated: true
        }));
      }
    } catch (e) {
      console.log(
        "Failed to generate questions via Gemini AI; no fallback questions will be created."
      );
    }
  }
  if (fetchedQuestions.length === 0) {
    return res.status(503).json({
      error: "\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u0627\u064B\u060C \u0648\u0644\u0645 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0623\u0633\u0626\u0644\u0629 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629 \u0623\u0648 \u062A\u062C\u0631\u064A\u0628\u064A\u0629."
    });
  }
  return res.json({ success: true, questions: fetchedQuestions });
});
app.post("/api/teacher/question-bank/approve", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629." });
  }
  const { questions } = req.body;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: "\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0645\u0642\u062A\u0631\u062D\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" });
  }
  questions.forEach((q) => {
    const canonicalQuestion = canonicalizeQuestionPayloadForTeacher(
      normalizeQuestionPayload(q),
      teacherEmail.toLowerCase()
    );
    canonicalQuestion.isApproved = true;
    canonicalQuestion.teacherEmail = teacherEmail.toLowerCase();
    const exists = dbInstance.getQuestionBank().find((item) => item.id === canonicalQuestion.id);
    if (!exists) {
      dbInstance.addQuestion(canonicalQuestion);
    } else {
      dbInstance.updateQuestion(canonicalQuestion.id, {
        ...canonicalQuestion,
        isApproved: true,
        teacherEmail: teacherEmail.toLowerCase()
      });
    }
  });
  if (!await ensureDurableSync(res)) return;
  bumpLiveContentRevision();
  return res.json({ success: true, count: questions.length });
});
function normalizeQuestionTypeValue(value) {
  const t = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if ([
    "multichoice",
    "multiplechoice",
    "multiple-choice",
    "choice",
    "\u0627\u062E\u062A\u064A\u0627\u0631-\u0645\u062A\u0639\u062F\u062F",
    "\u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0646 \u0645\u062A\u0639\u062F\u062F"
  ].includes(t))
    return "multiple-choice";
  if ([
    "truefalse",
    "true-false",
    "true/false",
    "\u0635\u062D-\u062E\u0637\u0623",
    "\u0635\u062D/\u062E\u0637\u0623",
    "\u0635\u062D \u0648\u062E\u0637\u0623"
  ].includes(t))
    return "true-false";
  if (["shortanswer", "short-answer", "essay", "short", "\u0645\u0642\u0627\u0644\u064A", "\u0642\u0635\u064A\u0631"].includes(
    t
  ))
    return "short-answer";
  return t || "short-answer";
}
function normalizeTrueFalseAnswer(value) {
  const v = String(value || "").trim().toLowerCase();
  if (["true", "1", "\u0635\u062D", "\u0635\u062D\u064A\u062D"].includes(v)) return "\u0635\u062D";
  if (["false", "0", "\u062E\u0637\u0623", "\u062E\u0637\u0627", "\u063A\u064A\u0631 \u0635\u062D\u064A\u062D"].includes(v)) return "\u062E\u0637\u0623";
  return String(value || "").trim();
}
function normalizeQuestionPayload(qData) {
  const type = normalizeQuestionTypeValue(qData?.type);
  const options = Array.isArray(qData?.options) ? qData.options.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  return {
    ...qData,
    type,
    options: type === "multiple-choice" ? options : type === "true-false" ? ["\u0635\u062D", "\u062E\u0637\u0623"] : qData?.options,
    correctAnswer: type === "true-false" ? normalizeTrueFalseAnswer(qData?.correctAnswer) : String(qData?.correctAnswer ?? "").trim()
  };
}
app.get("/api/teacher/question-bank", async (req, res) => {
  await dbInstance.initialSyncPromise;
  let teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.json({
      success: true,
      questions: [],
      revision: liveContentRevision
    });
  }
  teacherEmail = teacherEmail.toLowerCase();
  const filteredQuestions = activeQuestionBank().filter((q) => {
    const owner = String(
      q.teacherEmail || "ah.alfailakawi@paaet.edu.kw"
    ).toLowerCase();
    return owner === teacherEmail;
  });
  return res.json({
    success: true,
    questions: filteredQuestions,
    revision: liveContentRevision
  });
});
app.post("/api/teacher/question-bank", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629." });
  }
  const qData = canonicalizeQuestionPayloadForTeacher(
    normalizeQuestionPayload(req.body),
    teacherEmail.toLowerCase()
  );
  qData.id = qData.id || "q-man-" + Math.random().toString(36).substring(2, 9);
  qData.isApproved = true;
  qData.isGenerated = qData.isGenerated || false;
  qData.teacherEmail = teacherEmail.toLowerCase();
  dbInstance.addQuestion(qData);
  if (!await ensureDurableSync(res)) return;
  const revision = bumpLiveContentRevision();
  return res.json({ success: true, question: qData, revision });
});
app.put("/api/teacher/question-bank/:id", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629." });
  }
  const existing = dbInstance.getQuestionBank().find((q) => String(q.id) === String(req.params.id));
  if (existing) {
    const owner = String(
      existing.teacherEmail || "ah.alfailakawi@paaet.edu.kw"
    ).toLowerCase();
    if (owner !== teacherEmail.toLowerCase() && !isAdminEmail(teacherEmail)) {
      return res.status(403).json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D \u0644\u0643 \u0628\u062A\u0639\u062F\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0633\u0624\u0627\u0644." });
    }
  }
  const payload = canonicalizeQuestionPayloadForTeacher(
    normalizeQuestionPayload({ ...req.body, id: req.params.id }),
    teacherEmail.toLowerCase()
  );
  payload.teacherEmail = existing?.teacherEmail || teacherEmail.toLowerCase();
  dbInstance.updateQuestion(req.params.id, payload);
  if (!await ensureDurableSync(res)) return;
  const updated = dbInstance.getQuestionBank().find((q) => String(q.id) === String(req.params.id)) || {
    ...payload,
    id: req.params.id
  };
  const revision = bumpLiveContentRevision();
  return res.json({ success: true, question: updated, revision });
});
app.delete("/api/teacher/question-bank/:id", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail) {
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629." });
  }
  const existing = dbInstance.getQuestionBank().find((q) => String(q.id) === String(req.params.id));
  if (existing) {
    const owner = String(
      existing.teacherEmail || "ah.alfailakawi@paaet.edu.kw"
    ).toLowerCase();
    if (owner !== teacherEmail.toLowerCase() && !isAdminEmail(teacherEmail)) {
      return res.status(403).json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D \u0644\u0643 \u0628\u062D\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0633\u0624\u0627\u0644." });
    }
  }
  dbInstance.deleteQuestion(req.params.id);
  if (!await ensureDurableSync(res)) return;
  const revision = bumpLiveContentRevision();
  return res.json({ success: true, revision });
});
app.post("/api/teacher/textbook/generate-exercises", async (req, res) => {
  const { chapterId } = req.body;
  const chapter = dbInstance.getChapters().find((c) => c.id === chapterId);
  if (!chapter)
    return res.status(404).json({ error: "\u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u062F\u0631\u0627\u0633\u064A \u063A\u064A\u0631 \u0645\u0648\u0635\u0648\u0641" });
  let exercises = [];
  if (false) {
    try {
      const prompt = `\u0623\u0646\u062A \u0623\u0633\u062A\u0627\u0630 \u062C\u0627\u0645\u0639\u064A \u0641\u064A \u0627\u0644\u062A\u0639\u0644\u0645 \u0627\u0644\u062A\u0637\u0628\u064A\u0642\u064A \u0648\u0627\u0644\u062A\u0642\u0646\u064A\u0627\u062A \u0627\u0644\u0631\u0642\u0645\u064A\u0629.
\u0642\u0645 \u0628\u062A\u0648\u0644\u064A\u062F \u062A\u0645\u0631\u064A\u0646 \u0623\u0633\u0628\u0648\u0639\u064A \u062A\u0637\u0628\u064A\u0642\u064A \u0648\u0646\u0642\u062F\u064A \u0645\u0634\u0648\u0642 \u0644\u0637\u0644\u0628\u0629 \u0627\u0644\u0645\u0642\u0631\u0631 \u0628\u0646\u0627\u0621\u064B \u0639\u0644\u0649 \u0645\u0639\u0637\u064A\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u0641\u0635\u0644 \u0627\u0644\u0645\u0646\u0647\u062C\u064A:
\u0627\u0633\u0645 \u0627\u0644\u0641\u0635\u0644: "${chapter.title}"
\u0623\u0647\u062F\u0627\u0641\u0647 \u0648\u0645\u0648\u0636\u0648\u0639\u0627\u062A\u0647 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629: ${JSON.stringify(chapter.topics)}

\u062A\u0623\u0643\u062F \u0645\u0646 \u0635\u064A\u0627\u063A\u0629 \u062A\u0645\u0631\u064A\u0646 \u064A\u0639\u062A\u0645\u062F \u0639\u0644\u0649 "\u0633\u064A\u0646\u0627\u0631\u064A\u0648 \u062A\u0641\u0643\u064A\u0643 \u0648\u0627\u0642\u0639\u0629 \u062D\u064A\u0629 \u0644\u062F\u0645\u062C \u0627\u0644\u062A\u0639\u0644\u064A\u0645 \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A" \u0623\u0648 "\u0645\u0642\u0627\u0631\u0646\u0629 \u062D\u0627\u0633\u0645\u0629 \u0644\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u064A\u0629".
\u0623\u0631\u0633\u0644 \u0627\u0644\u0631\u062F \u0628\u0627\u0644\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u062A\u0627\u0644\u064A \u0643\u0640 JSON \u0635\u0627\u0644\u062D \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0648\u0644\u0627 \u062A\u0631\u0633\u0644 \u0623\u064A \u0643\u0644\u0627\u0645 \u062A\u0648\u0636\u064A\u062D\u064A \u062C\u0627\u0646\u0628\u064A:
[
  {
    "title": "\u062A\u0645\u0631\u064A\u0646 \u0627\u0644\u0623\u0633\u0628\u0648\u0639: \u0639\u0646\u0648\u0627\u0646 \u0645\u0634\u0648\u0642 \u0648\u062D\u064A\u0648\u064A \u0645\u0644\u0627\u0645\u0633 \u0644\u0644\u062A\u0635\u0645\u064A\u0645",
    "type": "scenario",
    "promptText": "\u0634\u0631\u062D \u0643\u0627\u0645\u0644 \u0648\u0645\u062A\u0642\u0646 \u0648\u0645\u062B\u064A\u0631 \u0644\u0633\u064A\u0646\u0627\u0631\u064A\u0648 \u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0648\u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u0645\u0646 \u0627\u0644\u0637\u0627\u0644\u0628 \u062A\u0642\u062F\u064A\u0645\u0647 \u0628\u0627\u0644\u062A\u0641\u0635\u064A\u0644 \u0648\u0643\u064A\u0641\u064A\u0629 \u062F\u0645\u062C\u0647 \u0644\u0645\u0641\u0627\u0647\u064A\u0645 \u0627\u0644\u0641\u0635\u0644"
  }
]`;
      const response = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      const parsed = JSON.parse(response.text?.trim() || "[]");
      if (Array.isArray(parsed)) {
        exercises = parsed.map((item, index) => ({
          id: `ex-gen-${chapterId}-${Date.now()}-${index}`,
          chapterId,
          title: item.title || "\u062A\u0645\u0631\u064A\u0646 \u0646\u0642\u062F\u064A \u0645\u062E\u0635\u0635",
          type: item.type || "scenario",
          promptText: item.promptText || "\u0633\u064A\u0627\u0642 \u062A\u0645\u0631\u064A\u0646 \u062A\u0637\u0628\u064A\u0642\u064A \u0644\u062D\u0644 \u0645\u0634\u0627\u0643\u0644 \u0627\u0644\u0641\u0635\u0644 \u0648\u062A\u062D\u0633\u064A\u0646 \u0628\u064A\u0626\u0629 \u062F\u0645\u062C \u0627\u0644\u062A\u0642\u0646\u064A\u0629.",
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0],
          isPersonalized: true
        }));
      }
    } catch (e) {
      console.log(
        "Gemini exercise generation failed; no fallback exercises will be created."
      );
    }
  }
  if (exercises.length === 0)
    return res.status(503).json({
      error: "\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u062A\u0645\u0627\u0631\u064A\u0646 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u0627\u064B\u060C \u0648\u0644\u0645 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u062A\u0645\u0627\u0631\u064A\u0646 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629 \u0623\u0648 \u062A\u062C\u0631\u064A\u0628\u064A\u0629."
    });
  return res.json({ success: true, exercises });
});
app.post("/api/teacher/exercises/activate", (req, res) => {
  const { exercise } = req.body;
  if (!exercise) return res.status(400).json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0645\u0631\u064A\u0646 \u0641\u0627\u0631\u063A\u0629" });
  exercise.id = exercise.id || "ex-act-" + Math.random().toString(36).substring(2, 9);
  dbInstance.addWeeklyExercise(exercise);
  return res.json({ success: true, exercise });
});
app.get("/api/teacher/logs", (req, res) => {
  const teacherEmail = String(
    req.query.teacherEmail || req.headers["x-teacher-email"] || ""
  );
  return res.json({
    logs: withLiveStudentNames(filterLogsForTeacher(teacherEmail))
  });
});
app.get("/api/teacher/password-reset-requests", (req, res) => {
  const teacherEmail = String(
    req.query.teacherEmail || req.headers["x-teacher-email"] || ""
  ).toLowerCase();
  const requests = withLiveStudentNames(
    dbInstance.getPasswordResetRequests().filter(
      (item) => !teacherEmail || canAccessPasswordResetRequest(item, teacherEmail)
    ).map(publicPasswordResetRequest)
  );
  return res.json({ success: true, requests });
});
app.post("/api/teacher/password-reset-requests/:id/resend", (req, res) => {
  const item = dbInstance.getPasswordResetRequests().find((requestItem) => requestItem.id === req.params.id);
  if (!item) return res.status(404).json({ error: "\u0637\u0644\u0628 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u062F\u0627\u0631\u0629 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628." });
  const lastSentAt = /* @__PURE__ */ new Date();
  const expiresAt = new Date(lastSentAt.getTime() + 60 * 60 * 1e3);
  const resetToken = import_crypto.default.randomBytes(24).toString("hex");
  const verificationCode = makeJoinCode(
    "LAB",
    "",
    /* @__PURE__ */ new Set([
      ...dbInstance.getPasswordResetRequests().filter((requestItem) => requestItem.id !== item.id).map(
        (requestItem) => compactJoinCode(requestItem.verificationCode)
      ),
      ...dbInstance.getOtps().map((otpItem) => compactJoinCode(otpItem.code)),
      ...dbInstance.getJoinCodes().map((joinItem) => compactJoinCode(joinItem.code))
    ])
  );
  const resetLink = buildResetLink(req, resetToken);
  const updates = {
    status: "new",
    resetToken,
    resetLink,
    verificationCode,
    lastSentAt: lastSentAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  dbInstance.updatePasswordResetRequest(item.id, updates);
  dbInstance.addActivityLog({
    studentId: item.studentId,
    studentName: item.studentName,
    action: "\u0625\u0639\u0627\u062F\u0629 \u0625\u0635\u062F\u0627\u0631 \u0631\u0627\u0628\u0637 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639",
    details: `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0631\u0627\u0628\u0637 \u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u062C\u062F\u064A\u062F \u0635\u0627\u0644\u062D \u0644\u0645\u062F\u0629 \u0633\u0627\u0639\u0629. \u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628: ${item.id}`,
    teacherEmail: item.teacherEmail,
    actorEmail: item.teacherEmail,
    sectionCode: item.sectionCode,
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",
    isViolationWarning: false
  });
  if (item.studentId)
    notifyStudent(
      item.studentId,
      "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0631\u0627\u0628\u0637 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0639\u064A\u064A\u0646",
      "\u0631\u0627\u062C\u0639 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631 \u0644\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0624\u0642\u062A \u0627\u0644\u062C\u062F\u064A\u062F.",
      { type: "password_reset_ready", link: "/" }
    );
  return res.json({
    success: true,
    request: publicPasswordResetRequest({ ...item, ...updates })
  });
});
app.post(
  "/api/teacher/password-reset-requests/:id/manual-password",
  (req, res) => {
    const item = dbInstance.getPasswordResetRequests().find((requestItem) => requestItem.id === req.params.id);
    if (!item)
      return res.status(404).json({ error: "\u0637\u0644\u0628 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
    const teacherEmail = teacherEmailFromRequest(req);
    if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
      return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u062F\u0627\u0631\u0629 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628." });
    const newPassword = String(req.body?.newPassword || "");
    if (isWeakDefaultPassword(newPassword))
      return res.status(400).json({ error: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u064A\u062C\u0628 \u0623\u0644\u0627 \u062A\u0642\u0644 \u0639\u0646 6 \u062E\u0627\u0646\u0627\u062A \u0648\u0644\u0627 \u062A\u0643\u0648\u0646 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629." });
    const student = dbInstance.getStudents().find((s) => String(s.id) === String(item.studentId));
    if (!student)
      return res.status(404).json({ error: "\u0644\u0627 \u064A\u0648\u062C\u062F \u062D\u0633\u0627\u0628 \u0637\u0627\u0644\u0628 \u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628." });
    const handledAt = (/* @__PURE__ */ new Date()).toISOString();
    dbInstance.updateStudent(student.id, { passwordHash: hashPasswordSecure(newPassword) });
    dbInstance.updatePasswordResetRequest(item.id, {
      status: "handled",
      handledAt
    });
    dbInstance.addActivityLog({
      studentId: student.id,
      studentName: student.name,
      action: "\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u064A\u062F\u0648\u064A\u0627\u064B",
      details: `\u0642\u0627\u0645 \u0635\u0627\u062D\u0628 \u0627\u0644\u0646\u0638\u0627\u0645 \u0628\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0627\u0644\u0637\u0627\u0644\u0628 \u064A\u062F\u0648\u064A\u0627\u064B \u062F\u0648\u0646 \u0643\u0634\u0641 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u0642\u062F\u064A\u0645\u0629. \u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628: ${item.id}`,
      teacherEmail: item.teacherEmail,
      actorEmail: item.teacherEmail,
      sectionCode: student.sectionCode,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
      browser: "\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",
      isViolationWarning: false
    });
    notifyTeachersForSection(
      student.sectionCode,
      "\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u064A\u062F\u0648\u064A",
      `${student.name}: \u062A\u0645 \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u064A\u062F\u0648\u064A\u0627\u064B \u0645\u0646 \u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630.`,
      { type: "manual_password_changed", studentId: student.id, link: "/" }
    );
    return res.json({ success: true });
  }
);
app.post("/api/teacher/password-reset-requests/:id/complete", (req, res) => {
  const item = dbInstance.getPasswordResetRequests().find((requestItem) => requestItem.id === req.params.id);
  if (!item) return res.status(404).json({ error: "\u0637\u0644\u0628 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u062F\u0627\u0631\u0629 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628." });
  dbInstance.updatePasswordResetRequest(item.id, {
    status: "handled",
    handledAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return res.json({ success: true });
});
app.delete("/api/teacher/password-reset-requests/:id", (req, res) => {
  const item = dbInstance.getPasswordResetRequests().find((requestItem) => requestItem.id === req.params.id);
  if (!item) return res.status(404).json({ error: "\u0637\u0644\u0628 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !canAccessPasswordResetRequest(item, teacherEmail))
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u062F\u0627\u0631\u0629 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628." });
  dbInstance.deletePasswordResetRequest(req.params.id);
  return res.json({ success: true });
});
app.get("/api/teacher/exams", async (req, res) => {
  await dbInstance.initialSyncPromise;
  return res.json({ success: true, exams: activeTeacherExams() });
});
app.post("/api/teacher/exams", async (req, res) => {
  await dbInstance.initialSyncPromise;
  const exam = req.body;
  if (!exam?.title || !exam?.courseCode)
    return res.status(400).json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0646\u0627\u0642\u0635\u0629." });
  const rawTeacherEmail = teacherEmailFromRequest(req);
  if (!rawTeacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629." });
  const teacherEmail = rawTeacherEmail.toLowerCase();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const savedQuestionsCount = Math.max(
    1,
    Math.floor(Number(exam.questionsCount) || 1)
  );
  const savedTimerMinutes = Math.max(
    1,
    Math.floor(
      Number(exam.antiCheat?.timerMinutes ?? exam.timerMinutes) || 30
    )
  );
  const savedQuestionPoolCount = Math.max(
    savedQuestionsCount,
    Math.floor(
      Number(exam.antiCheat?.questionPoolCount) || savedQuestionsCount
    )
  );
  const selectedCategoriesForValidation = Array.isArray(exam.selectedCategories) ? exam.selectedCategories.map(String).filter(Boolean) : [];
  const examQuestionsAvailable = activeQuestionBank().filter(
    (q) => questionMatchesOfficialExamServer(
      q,
      { ...exam, selectedCategories: selectedCategoriesForValidation },
      teacherEmail
    )
  );
  if (examQuestionsAvailable.length < savedQuestionsCount) {
    return res.status(400).json({
      error: `\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u0633\u0626\u0644\u0629 \u0645\u062D\u0641\u0648\u0638\u0629 \u0643\u0627\u0641\u064A\u0629 \u0641\u064A \u0627\u0644\u0633\u062D\u0627\u0628\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u0623\u0648 \u0627\u0644\u062A\u0635\u0646\u064A\u0641. \u0627\u0644\u0645\u062A\u0627\u062D ${examQuestionsAvailable.length} \u0648\u0627\u0644\u0645\u0637\u0644\u0648\u0628 ${savedQuestionsCount}.`,
      availableQuestions: examQuestionsAvailable.length,
      requiredQuestions: savedQuestionsCount
    });
  }
  const incomingReview = exam.review || {};
  const saved = {
    ...exam,
    id: exam.id || `exam-${Date.now()}`,
    points: Number(exam.points) || 1,
    questionsCount: savedQuestionsCount,
    antiCheat: {
      ...exam.antiCheat || {},
      questionPoolCount: savedQuestionPoolCount,
      timerMinutes: savedTimerMinutes
    },
    review: {
      showGrade: incomingReview.showGrade === true,
      gradesReleased: incomingReview.gradesReleased === true,
      releasedAt: incomingReview.releasedAt
    },
    createdAt: exam.createdAt || now,
    updatedAt: now
  };
  const existedBefore = dbInstance.getTeacherExams().some((item) => String(item.id) === String(saved.id));
  dbInstance.upsertTeacherExam(saved);
  if (!await ensureDurableSync(res)) return;
  const revision = bumpLiveContentRevision();
  const noticeTitle = existedBefore ? "\u062A\u062D\u062F\u064A\u062B \u0627\u062E\u062A\u0628\u0627\u0631" : "\u0627\u062E\u062A\u0628\u0627\u0631 \u062C\u062F\u064A\u062F \u0645\u062A\u0627\u062D";
  const noticeBody = existedBefore ? `\u062A\u0645 \u062A\u062D\u062F\u064A\u062B ${saved.title} \u0641\u064A \u0645\u0642\u0631\u0631 ${saved.courseCode} \u0648\u0633\u064A\u0638\u0647\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0641\u0648\u0631\u064A\u0627\u064B.` : `\u062A\u0645 \u0646\u0634\u0631 ${saved.title} \u0644\u0645\u0642\u0631\u0631 ${saved.courseCode}`;
  rememberCourseNotification(
    saved.courseCode,
    noticeTitle,
    noticeBody,
    "exam_available",
    {
      examId: saved.id,
      courseCode: saved.courseCode,
      revision: String(revision),
      link: "/"
    }
  );
  notifyUsers(
    (token) => token.role === "student" && studentTokenHasCourse(token, saved.courseCode),
    noticeTitle,
    noticeBody,
    {
      type: "exam_available",
      examId: saved.id,
      courseCode: saved.courseCode,
      revision: String(revision),
      link: "/"
    }
  );
  return res.json({
    success: true,
    exam: saved,
    revision: liveContentRevision
  });
});
app.post("/api/teacher/exams/:id/remind", (req, res) => {
  const exam = dbInstance.getTeacherExams().find((item) => String(item.id) === String(req.params.id));
  if (!exam) return res.status(404).json({ error: "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !isAdminEmail(teacherEmail) && sectionOwnerEmail(exam.courseCode) !== teacherEmail && String(exam.createdBy || "").toLowerCase() !== teacherEmail) {
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u0631\u0633\u0627\u0644 \u062A\u0646\u0628\u064A\u0647 \u0644\u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631." });
  }
  const requiresSeb = !!(exam.seb?.enabled || exam.sebEnabled);
  const openText = exam.open ? new Date(exam.open).toLocaleString("en-GB", {
    timeZone: "Asia/Kuwait",
    hour12: false
  }) : "\u062D\u0633\u0628 \u0645\u0648\u0639\u062F \u0627\u0644\u0623\u0633\u062A\u0627\u0630";
  const students = dbInstance.getStudents().filter(
    (student) => studentEnrolledForNotifications(student, exam.courseCode)
  );
  let count = 0;
  let pushCount = 0;
  students.forEach((student) => {
    const accountReady = student.isPaid || student.isActivated || student.activationCode ? "\u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0641\u0639\u0644" : "\u0627\u0644\u062D\u0633\u0627\u0628 \u064A\u062D\u062A\u0627\u062C \u062A\u0641\u0639\u064A\u0644";
    const deviceReady = Array.isArray(student.devices) && student.devices.length ? "\u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0633\u062C\u0644" : "\u0627\u0641\u062A\u062D \u062D\u0633\u0627\u0628\u0643 \u0645\u0646 \u062C\u0647\u0627\u0632\u0643 \u0642\u0628\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631";
    pushCount += notifyStudent(
      String(student.id),
      "\u062A\u0646\u0628\u064A\u0647 \u0627\u062E\u062A\u0628\u0627\u0631",
      `${exam.title}: ${openText} \u2022 ${requiresSeb ? "\u064A\u062A\u0637\u0644\u0628 SEB" : "\u0644\u0627 \u064A\u062A\u0637\u0644\u0628 SEB"} \u2022 ${accountReady} \u2022 ${deviceReady}`,
      {
        type: "exam_reminder",
        examId: String(exam.id || ""),
        courseCode: String(exam.courseCode || ""),
        link: "/"
      }
    );
    count += 1;
  });
  dbInstance.addActivityLog({
    action: "\u0625\u0631\u0633\u0627\u0644 \u062A\u0646\u0628\u064A\u0647 \u0627\u062E\u062A\u0628\u0627\u0631",
    details: `\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u062A\u0646\u0628\u064A\u0647 ${String(exam.title || "\u0627\u062E\u062A\u0628\u0627\u0631")} \u0625\u0644\u0649 ${count} \u0637\u0627\u0644\u0628.`,
    teacherEmail,
    actorEmail: teacherEmail,
    sectionCode: String(exam.courseCode || ""),
    ip: req.ip || "127.0.0.1",
    userAgent: req.headers["user-agent"] || "Unknown",
    os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
    browser: "\u062A\u0646\u0628\u064A\u0647 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631",
    isViolationWarning: false
  });
  return res.json({ success: true, count, inAppCount: count, pushCount });
});
app.post("/api/teacher/exams/:id/release-grades", async (req, res) => {
  const exam = dbInstance.getTeacherExams().find((item) => String(item.id) === String(req.params.id));
  if (!exam) return res.status(404).json({ error: "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !isAdminEmail(teacherEmail) && sectionOwnerEmail(exam.courseCode) !== teacherEmail && String(exam.createdBy || "").toLowerCase() !== teacherEmail) {
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0631\u0635\u062F \u062F\u0631\u062C\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631." });
  }
  const releasedAt = (/* @__PURE__ */ new Date()).toISOString();
  const previousReview = examReviewSettings(exam);
  const review = {
    ...previousReview,
    showGrade: true,
    gradesReleased: true,
    releasedAt
  };
  dbInstance.upsertTeacherExam({
    ...exam,
    review,
    updatedAt: releasedAt
  });
  const submissions = dbInstance.getTeacherSubmissions().filter(
    (sub) => sub.kind === "exam" && String(sub.activityId) === String(exam.id)
  );
  let notifiedStudents = 0;
  submissions.forEach((sub) => {
    const grade = String(sub.grade ?? sub.score ?? sub.visibleGrade ?? "");
    if (grade === "") return;
    dbInstance.upsertTeacherSubmission({
      ...sub,
      visibleGrade: grade,
      status: preserveSpecialExamStatusOnGradeRelease(sub.status) ? sub.status : EXAM_GRADED_STATUS,
      gradedAt: sub.gradedAt || releasedAt,
      updatedAt: releasedAt
    });
    if (!previousReview.gradesReleased && sub.studentId) {
      const max = Number(sub.maxPoints ?? sub.points ?? exam.points) || 0;
      const suffix = max ? `${grade} \u0645\u0646 ${max}` : grade;
      notifyStudent(
        String(sub.studentId),
        "\u062A\u0645 \u0646\u0634\u0631 \u062F\u0631\u062C\u062A\u0643",
        `${exam.title || "\u0627\u062E\u062A\u0628\u0627\u0631"}: ${suffix}`,
        {
          type: "grade_released",
          studentId: String(sub.studentId),
          activityId: String(exam.id || ""),
          kind: "exam",
          courseCode: String(exam.courseCode || ""),
          link: "/"
        }
      );
      notifiedStudents += 1;
    }
  });
  bumpLiveContentRevision();
  if (!await ensureDurableSync(res)) return;
  return res.json({
    success: true,
    releasedAt,
    count: submissions.length,
    notifiedStudents,
    revision: liveContentRevision
  });
});
app.delete("/api/teacher/exams/:id", async (req, res) => {
  const exam = dbInstance.getTeacherExams().find((item) => String(item.id) === String(req.params.id));
  if (!exam) return res.status(404).json({ error: "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !isAdminEmail(teacherEmail) && sectionOwnerEmail(exam.courseCode) !== teacherEmail && String(exam.createdBy || "").toLowerCase() !== teacherEmail) {
    return res.status(403).json({ error: "\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u062D\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631." });
  }
  dbInstance.deleteTeacherExam(req.params.id);
  removeRuntimeTeacherSubmissionsFor("exam", req.params.id);
  dbInstance.removeQuizSubmissionsForChapter(req.params.id);
  const remainingPasses = dbInstance.getSebAttempts().map((item) => {
    if (String(item.examId) === String(req.params.id) && item.status !== "closed") {
      return {
        ...item,
        status: "closed",
        closedAt: Date.now(),
        closeReason: "exam-deleted"
      };
    }
    return item;
  });
  dbInstance.setSebAttempts(remainingPasses);
  const revision = bumpLiveContentRevision();
  if (!await ensureDurableSync(res)) return;
  return res.json({ success: true, revision });
});
app.get("/api/teacher/projects", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  const projects = activeRuntimeTeacherProjects().filter((project) => {
    if (!teacherEmail || isAdminEmail(teacherEmail)) return true;
    const code = String(project.courseCode || "");
    return !code || sectionOwnerEmail(code) === teacherEmail || String(project.createdBy || "").toLowerCase() === teacherEmail;
  });
  return res.json({ success: true, projects });
});
app.post("/api/teacher/projects", async (req, res) => {
  const project = req.body || {};
  if (!project?.title || !project?.courseCode)
    return res.status(400).json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0646\u0627\u0642\u0635\u0629." });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !isAdminEmail(teacherEmail) && sectionOwnerEmail(project.courseCode) !== teacherEmail && String(project.createdBy || "").toLowerCase() !== teacherEmail) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0646\u0634\u0631 \u0645\u0634\u0631\u0648\u0639 \u0641\u064A \u0645\u0642\u0631\u0631 \u0644\u0627 \u062A\u0645\u0644\u0643\u0647." });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existedBefore = dbInstance.getTeacherProjects().some((item) => String(item.id) === String(project.id || ""));
  const saved = {
    ...project,
    id: project.id || `proj-${Date.now()}`,
    points: Number(project.points) || 1,
    status: project.status || "published",
    createdBy: project.createdBy || teacherEmail || "local-teacher",
    createdAt: project.createdAt || now,
    updatedAt: now
  };
  dbInstance.upsertTeacherProject(saved);
  if (!await ensureDurableSync(res)) return;
  const revision = bumpLiveContentRevision();
  const noticeTitle = existedBefore ? "\u062A\u062D\u062F\u064A\u062B \u0645\u0634\u0631\u0648\u0639" : "\u0645\u0634\u0631\u0648\u0639 \u062C\u062F\u064A\u062F \u0645\u062A\u0627\u062D";
  const noticeBody = existedBefore ? `\u062A\u0645 \u062A\u062D\u062F\u064A\u062B ${saved.title} \u0641\u064A \u0645\u0642\u0631\u0631 ${saved.courseCode} \u0648\u0633\u064A\u0638\u0647\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0641\u0648\u0631\u064A\u0627\u064B.` : `\u062A\u0645 \u0646\u0634\u0631 ${saved.title} \u0644\u0645\u0642\u0631\u0631 ${saved.courseCode}`;
  rememberCourseNotification(
    saved.courseCode,
    noticeTitle,
    noticeBody,
    "project_available",
    {
      projectId: saved.id,
      courseCode: saved.courseCode,
      revision: String(revision),
      link: "/"
    }
  );
  notifyUsers(
    (token) => token.role === "student" && studentTokenHasCourse(token, saved.courseCode),
    noticeTitle,
    noticeBody,
    {
      type: "project_available",
      projectId: saved.id,
      courseCode: saved.courseCode,
      revision: String(revision),
      link: "/"
    }
  );
  return res.json({ success: true, project: saved });
});
app.delete("/api/teacher/projects/:id", async (req, res) => {
  const project = dbInstance.getTeacherProjects().find((item) => String(item.id) === String(req.params.id));
  if (!project) return res.json({ success: true });
  const teacherEmail = teacherEmailFromRequest(req);
  if (teacherEmail && !isAdminEmail(teacherEmail) && sectionOwnerEmail(project.courseCode) !== teacherEmail && String(project.createdBy || "").toLowerCase() !== teacherEmail) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062D\u0630\u0641 \u0645\u0634\u0631\u0648\u0639 \u0641\u064A \u0645\u0642\u0631\u0631 \u0644\u0627 \u062A\u0645\u0644\u0643\u0647." });
  }
  dbInstance.deleteTeacherProject(req.params.id);
  const revision = bumpLiveContentRevision();
  removeRuntimeTeacherSubmissionsFor("project", req.params.id);
  rememberCourseNotification(
    project.courseCode,
    "\u062D\u0630\u0641 \u0645\u0634\u0631\u0648\u0639",
    `\u062A\u0645 \u062D\u0630\u0641 ${project.title} \u0645\u0646 \u0645\u0642\u0631\u0631 ${project.courseCode}`,
    "project_deleted",
    { projectId: project.id, courseCode: project.courseCode, link: "/" }
  );
  notifyUsers(
    (token) => token.role === "student" && studentTokenHasCourse(token, project.courseCode),
    "\u062D\u0630\u0641 \u0645\u0634\u0631\u0648\u0639",
    `\u062A\u0645 \u062D\u0630\u0641 ${project.title} \u0645\u0646 \u0645\u0642\u0631\u0631 ${project.courseCode}`,
    {
      type: "project_deleted",
      projectId: project.id,
      courseCode: project.courseCode,
      link: "/"
    }
  );
  if (!await ensureDurableSync(res)) return;
  return res.json({ success: true, revision });
});
function syncInProgressExamSubmissions() {
  try {
    const exams = activeTeacherExams();
    dbInstance.getQuizSubmissions().forEach((sub) => {
      const exam = exams.find(
        (e) => String(e.id) === String(sub.chapterId)
      );
      if (!exam) return;
      const id = `exam-${exam.id}-${sub.studentId}`;
      const existing = dbInstance.getTeacherSubmissions().find((item) => String(item.id) === id);
      const student = dbInstance.getStudents().find((s) => String(s.id) === String(sub.studentId));
      const status = String(sub.status || "");
      if (status === "submitted") {
        if (String(existing?.status || "").trim() === "\u0645\u0639\u0627\u062F \u0644\u0644\u0637\u0627\u0644\u0628") {
          const returnedTime = new Date(existing.returnedAt || 0).getTime();
          const submittedTime = new Date(
            sub.submittedAt || sub.resubmittedAt || 0
          ).getTime();
          if (returnedTime > submittedTime) return;
        }
        const grade = String(sub.score ?? "");
        if (grade === "") return;
        const totalPoints = Number(sub.totalPoints || exam.points || 20) || 20;
        const zeroReason = String(sub.zeroReason || "").trim();
        const finishReason = String(sub.finishReason || "").trim();
        const isCheatingAttemptExit = finishReason === EXAM_CHEATING_ATTEMPT_STATUS;
        const isWithdrawnOrExited = finishReason === EXAM_EXITED_BEFORE_SUBMIT_STATUS || finishReason === EXAM_WITHDRAWN_STATUS || !!zeroReason && !isCheatingAttemptExit;
        const isInterruptedAttempt = isCheatingAttemptExit || isWithdrawnOrExited;
        const expectedWithdrawalStatus = isCheatingAttemptExit ? EXAM_CHEATING_ATTEMPT_STATUS : EXAM_WITHDRAWN_STATUS;
        const hasTeacherGradeOverride = existing?.teacherGradeOverride === true && String(existing?.grade ?? existing?.visibleGrade ?? "").trim() !== "";
        const shouldRepair = !existing || String(existing.status || "") === "\u0645\u0639\u0627\u062F \u0644\u0644\u0637\u0627\u0644\u0628" || String(existing.status || "") === EXAM_IN_PROGRESS_STATUS || String(existing.answerText || "").includes(
          "\u062F\u062E\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0628\u062F\u0623\u062A \u0645\u062D\u0627\u0648\u0644\u062A\u0647"
        ) || isInterruptedAttempt && !hasTeacherGradeOverride && String(existing.status || "") !== expectedWithdrawalStatus || finishReason === EXAM_TIME_EXPIRED_STATUS && String(existing.status || "") !== EXAM_TIME_EXPIRED_STATUS;
        if (!shouldRepair) return;
        const finalGrade = isCheatingAttemptExit ? "0" : grade;
        const finalAnswerText = isCheatingAttemptExit ? `\u062D\u0627\u0648\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u063A\u0634 (\u062A\u0628\u062F\u064A\u0644 \u062A\u0637\u0628\u064A\u0642 \u0623\u0648 \u0634\u0627\u0634\u0629) \u0641\u062A\u0645 \u0625\u062E\u0631\u0627\u062C\u0647 \u0648\u0631\u0635\u062F\u062A \u062F\u0631\u062C\u0627\u062A\u0647 \u0627\u0644\u062D\u0627\u0644\u064A\u0629: 0 \u0645\u0646 ${totalPoints}` : isWithdrawnOrExited ? `\u0627\u0646\u0633\u062D\u0628 \u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0646 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0623\u0648 \u0627\u0646\u0642\u0637\u0639\u062A \u062C\u0644\u0633\u062A\u0647\u060C \u0648\u062A\u0645 \u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627: ${finalGrade} \u0645\u0646 ${totalPoints}` : finishReason === EXAM_TIME_EXPIRED_STATUS ? `\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0625\u062C\u0627\u0628\u0627\u062A \u0627\u0644\u0637\u0627\u0644\u0628 \u0648\u0631\u0635\u062F \u0627\u0644\u062F\u0631\u062C\u0629: ${finalGrade} \u0645\u0646 ${totalPoints}` : `\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0628\u0646\u062C\u0627\u062D. \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u0645\u062D\u0633\u0648\u0628\u0629: ${finalGrade} \u0645\u0646 ${totalPoints}`;
        upsertRuntimeTeacherSubmission({
          ...existing || {},
          id,
          kind: "exam",
          activityId: exam.id,
          activityTitle: exam.title,
          courseCode: exam.courseCode || sub.sectionCode,
          studentId: sub.studentId,
          studentName: student?.name || sub.studentName,
          answerText: finalAnswerText,
          grade: finalGrade,
          visibleGrade: canShowExamGradeToStudent(exam) ? finalGrade : "",
          totalPoints,
          serverSubmissionId: sub.id,
          status: isInterruptedAttempt ? expectedWithdrawalStatus : finishReason === EXAM_TIME_EXPIRED_STATUS ? EXAM_TIME_EXPIRED_STATUS : canShowExamGradeToStudent(exam) ? EXAM_GRADED_STATUS : EXAM_SUBMITTED_STATUS,
          submittedAt: sub.submittedAt || existing?.submittedAt || (/* @__PURE__ */ new Date()).toISOString(),
          gradedAt: sub.submittedAt || existing?.gradedAt || (/* @__PURE__ */ new Date()).toISOString(),
          exitWasOffline: isInterruptedAttempt ? !!sub.exitWasOffline : existing?.exitWasOffline
        });
        return;
      }
      if (status !== "started") return;
      if (String(existing?.status || "").trim() === "\u0645\u0639\u0627\u062F \u0644\u0644\u0637\u0627\u0644\u0628") {
        const returnedTime = new Date(existing.returnedAt || 0).getTime();
        const startedTime = new Date(
          sub.startedAt || sub.submittedAt || 0
        ).getTime();
        if (returnedTime > startedTime) return;
      }
      if (existing && isProtectedFinalExamStatus(existing)) return;
      const startedAt = new Date(
        sub.startedAt || sub.submittedAt || 0
      ).getTime();
      const timerMinutes = Math.max(
        1,
        Number(
          exam.antiCheat?.timerMinutes ?? exam.timerMinutes
        ) || 30
      );
      const staleCutoffMs = (timerMinutes + 5) * 60 * 1e3;
      const hasActiveSebPass = Array.from(getRuntimeSebPasses().values()).some(
        (pass) => String(pass.studentId) === String(sub.studentId) && String(pass.examId) === String(exam.id) && String(pass.status) === "active" && Number(pass.expiresAt || 0) > Date.now()
      );
      if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt > staleCutoffMs && !hasActiveSebPass) {
        const studentForZero = student || dbInstance.getStudents().find((s) => String(s.id) === String(sub.studentId));
        if (studentForZero) {
          finalizeExamAttemptAsZero({}, {
            student: studentForZero,
            exam,
            submission: sub,
            reason: "\u0627\u0646\u062A\u0647\u0649 \u0648\u0642\u062A \u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0623\u0648 \u0627\u0646\u0642\u0637\u0639\u062A \u062C\u0644\u0633\u0629 SEB \u0642\u0628\u0644 \u0627\u0644\u062A\u0633\u0644\u064A\u0645\u061B \u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u062A\u064A \u0648\u0635\u0644 \u0644\u0647\u0627 \u0627\u0644\u0637\u0627\u0644\u0628."
          });
        }
        return;
      }
      if (existing && String(existing.status || "") === EXAM_IN_PROGRESS_STATUS)
        return;
      upsertRuntimeTeacherSubmission({
        ...existing || {},
        id,
        kind: "exam",
        activityId: exam.id,
        activityTitle: exam.title,
        courseCode: exam.courseCode || sub.sectionCode,
        studentId: sub.studentId,
        studentName: student?.name || sub.studentName,
        answerText: "\u062F\u062E\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0628\u062F\u0623\u062A \u0645\u062D\u0627\u0648\u0644\u062A\u0647\u061B \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0642\u064A\u062F \u0627\u0644\u062D\u0644 \u0627\u0644\u0622\u0646.",
        status: EXAM_IN_PROGRESS_STATUS,
        submittedAt: sub.startedAt || (/* @__PURE__ */ new Date()).toISOString(),
        grade: "",
        visibleGrade: ""
      });
    });
  } catch {
  }
}
app.get("/api/teacher/submissions", (req, res) => {
  syncInProgressExamSubmissions();
  const studentId = String(req.query.studentId || "").trim();
  const courseCode = String(req.query.courseCode || "").trim();
  let items = activeRuntimeTeacherSubmissions();
  if (studentId)
    items = items.filter(
      (item) => String(item.studentId || "") === studentId
    );
  if (courseCode)
    items = items.filter(
      (item) => sectionCodeEquivalent(item.courseCode || item.sectionCode, courseCode)
    );
  return res.json({
    success: true,
    submissions: withLiveStudentNames(items),
    revision: liveContentRevision
  });
});
app.post("/api/teacher/submissions", (req, res) => {
  try {
    const incoming = req.body || {};
    const incomingStudentId = String(incoming.studentId || "").trim();
    const incomingCourseCode = String(
      incoming.courseCode || incoming.sectionCode || ""
    ).trim();
    const incomingStudent = incomingStudentId ? dbInstance.getStudents().find(
      (st) => String(st.id) === incomingStudentId || normalizeStudentId(st.id) === normalizeStudentId(incomingStudentId)
    ) : null;
    if (incomingStudent && incomingCourseCode && isStudentSuspendedInCourse(incomingStudent, incomingCourseCode)) {
      return res.status(403).json({
        error: "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u062F\u062E\u0648\u0644\u0643 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0624\u0642\u062A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0645\u0631\u0627\u062C\u0639\u0629 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
      });
    }
    const submission = upsertRuntimeTeacherSubmission(incoming);
    return res.json({
      success: true,
      submission,
      revision: liveContentRevision
    });
  } catch (err) {
    if (String(err?.message || "").startsWith("GRADE_EXCEEDS_MAX")) {
      return res.status(400).json({
        error: `\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u062F\u062E\u0627\u0644 \u062F\u0631\u062C\u0629 \u0623\u0639\u0644\u0649 \u0645\u0646 \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u0645\u0642\u0631\u0631\u0629 (${err.maxPoints}).`
      });
    }
    return res.status(500).json({ error: "\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0627\u0644\u062A\u0633\u0644\u064A\u0645." });
  }
});
app.post("/api/student/submissions", (req, res) => {
  const incoming = req.body || {};
  const verifiedSession = verifyMirasSessionToken(req);
  const sessionStudentId = verifiedSession?.role === "student" ? normalizeStudentId(verifiedSession.userId) : "";
  if (!sessionStudentId) {
    return res.status(401).json({
      error: "STUDENT_SESSION_REQUIRED",
      code: "STUDENT_SESSION_REQUIRED"
    });
  }
  const incomingStudentId = normalizeStudentId(incoming.studentId);
  if (incomingStudentId && incomingStudentId !== sessionStudentId) {
    return res.status(403).json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0633\u0644\u064A\u0645 \u0646\u064A\u0627\u0628\u0629 \u0639\u0646 \u0637\u0627\u0644\u0628 \u0622\u062E\u0631." });
  }
  const kind = String(incoming.kind || "").trim().toLowerCase();
  if (kind !== "project" && kind !== "exercise") {
    return res.status(400).json({ error: "\u0646\u0648\u0639 \u0627\u0644\u062A\u0633\u0644\u064A\u0645 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645." });
  }
  const student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === sessionStudentId);
  if (!student) {
    return res.status(401).json({
      error: "STUDENT_SESSION_REQUIRED",
      code: "STUDENT_SESSION_REQUIRED"
    });
  }
  let courseCode = String(
    incoming.courseCode || incoming.sectionCode || ""
  ).trim();
  if (!courseCode && kind === "project") {
    const projectId = String(
      incoming.activityId || incoming.projectId || incoming.id || ""
    ).replace(/^project-/, "").split("-")[0].trim();
    const matchedProject = activeRuntimeTeacherProjects().find(
      (project) => String(project.id || "") === projectId || String(incoming.activityId || "") === String(project.id || "")
    );
    courseCode = String(
      matchedProject?.courseCode || matchedProject?.sectionCode || ""
    ).trim();
  }
  if (courseCode && isStudentSuspendedInCourse(student, courseCode)) {
    return res.status(403).json({
      error: "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u062F\u062E\u0648\u0644\u0643 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0631\u0631 \u0645\u0624\u0642\u062A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0645\u0631\u0627\u062C\u0639\u0629 \u0623\u0633\u062A\u0627\u0630 \u0627\u0644\u0645\u0642\u0631\u0631."
    });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const requestedStatus = String(incoming.status || "").trim();
  const safeStatus = requestedStatus && !isReturnedSubmissionStatusServer(requestedStatus) ? requestedStatus : "\u0645\u0642\u0641\u0644 \u0628\u0639\u062F \u0627\u0644\u062A\u0633\u0644\u064A\u0645";
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
    gradedAt: void 0,
    returnedAt: void 0,
    returnedByEmail: void 0,
    returnNote: void 0,
    status: safeStatus,
    submittedAt: incoming.submittedAt || nowIso,
    updatedAt: nowIso
  };
  try {
    const submission = upsertRuntimeTeacherSubmission(safeSubmission);
    return res.json({
      success: true,
      submission,
      revision: liveContentRevision
    });
  } catch (err) {
    return res.status(500).json({ error: "\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0627\u0644\u062A\u0633\u0644\u064A\u0645." });
  }
});
app.post("/api/students/:id/activate-course", (req, res) => {
  const studentId = normalizeStudentId(req.params.id);
  const rawCode = normalizeArabicDigits(String(req.body?.code || "")).trim();
  if (!studentId || !rawCode) {
    return res.status(400).json({ error: "\u0627\u0643\u062A\u0628 \u0643\u0648\u062F \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0642\u0631\u0631 \u0623\u0648\u0644\u0627\u064B." });
  }
  return processStudentCourseActivation(req, res, studentId, rawCode);
});
app.get("/api/live/student-state", (req, res) => {
  setNoCache(res);
  syncInProgressExamSubmissions();
  const studentId = normalizeStudentId(req.query.studentId);
  const isPublicStudentStatePreview = req.mirasPublicStudentStatePreview === true;
  const student = dbInstance.getStudents().find((s) => normalizeStudentId(s.id) === studentId);
  const requestedCourseCode = String(req.query.courseCode || "").trim();
  const enrollmentCodes = student ? getStudentActiveCourseCodes(student) : [];
  const discoveredCodes = student ? getStudentDiscoveredCourseCodes(student) : [];
  const visibleCodes = requestedCourseCode ? enrollmentCodes.filter((code) => sectionCodeEquivalent(code, requestedCourseCode)) : enrollmentCodes;
  const allowed = (code) => !!visibleCodes.length && visibleCodes.some((c) => sectionCodeEquivalent(c, code));
  const sections = activeSections().filter(
    (section) => discoveredCodes.some(
      (code) => String(code).toLowerCase() === String(section.code || "").toLowerCase() || sectionCodeEquivalent(section.code, code)
    )
  );
  const exams = activeTeacherExams().filter(
    (exam) => allowed(exam.courseCode)
  );
  const projects = activeRuntimeTeacherProjects().filter(
    (project) => allowed(project.courseCode)
  );
  const submissions = activeRuntimeTeacherSubmissions().filter(
    (item) => (!studentId || String(item.studentId || "") === studentId) && allowed(item.courseCode)
  );
  const activatedForLiveStudent = student ? activatedCourseCodesForStudent(student) : [];
  const enrollments = student ? getStudentEnrollmentDetails(student).map(
    (entry) => (
      // نُظهر المقرر المُفعّل نشطاً فوراً، لكن لا نتجاوز قرار المعلم: المقرر
      // المُغلق (isOpen=false) أو المعلّق (isSuspended) يبقى على حالته الحقيقية
      // ولا يُعرض "نشطاً" زوراً. (المقرر المُفعّل المفتوح يبقى نشطاً → ظهور فوري)
      entry.isOpen !== false && entry.isSuspended !== true && activatedForLiveStudent.some(
        (code) => sectionCodeEquivalent(code, entry.courseCode || entry.sectionCode)
      ) ? {
        ...entry,
        status: "active",
        isActive: true,
        isLocked: false,
        isOpen: true,
        isClosedByTeacher: false,
        isSuspended: false
      } : entry
    )
  ) : [];
  const clientStudent = student ? sanitizeStudentForClient(student, enrollments) : void 0;
  const responseSections = activeSections().filter(
    (section) => enrollments.some(
      (entry) => sectionCodeEquivalent(section.code, entry.courseCode || entry.sectionCode || entry.studentSection)
    )
  );
  if (isPublicStudentStatePreview) {
    const pendingOnlyEnrollments = enrollments.filter(
      (entry) => entry?.pendingActivation === true || entry?.requiresJoinCode === true
    );
    return res.json({
      success: true,
      revision: liveContentRevision,
      serverTime: (/* @__PURE__ */ new Date()).toISOString(),
      enrollments: pendingOnlyEnrollments,
      student: clientStudent ? {
        id: clientStudent.id,
        idNumber: clientStudent.id,
        enrollments: pendingOnlyEnrollments,
        activatedCourseCodes: []
      } : void 0,
      studentName: void 0,
      sections: [],
      exams: [],
      projects: [],
      submissions: []
    });
  }
  return res.json({
    success: true,
    revision: liveContentRevision,
    serverTime: (/* @__PURE__ */ new Date()).toISOString(),
    enrollments,
    student: clientStudent,
    studentName: clientStudent ? clientStudent.name : void 0,
    sections: responseSections,
    exams,
    projects,
    submissions
  });
});
function returnNoticeForKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "exam" || k === "quiz")
    return { title: "\u0625\u0639\u0627\u062F\u0629 \u0627\u062E\u062A\u0628\u0627\u0631", body: "\u062A\u0645\u062A \u0625\u062A\u0627\u062D\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0644\u0643 \u0645\u0646 \u062C\u062F\u064A\u062F." };
  if (k === "project")
    return { title: "\u0625\u0639\u0627\u062F\u0629 \u0645\u0634\u0631\u0648\u0639", body: "\u062A\u0645\u062A \u0625\u062A\u0627\u062D\u0629 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0644\u0643 \u0645\u0646 \u062C\u062F\u064A\u062F." };
  if (k === "exercise")
    return { title: "\u0625\u0639\u0627\u062F\u0629 \u0646\u0634\u0627\u0637", body: "\u062A\u0645\u062A \u0625\u062A\u0627\u062D\u0629 \u0627\u0644\u0646\u0634\u0627\u0637 \u0644\u0643 \u0645\u0646 \u062C\u062F\u064A\u062F." };
  return { title: "\u0625\u0639\u0627\u062F\u0629 \u062A\u0633\u0644\u064A\u0645", body: "\u062A\u0645\u062A \u0625\u062A\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0644\u0643 \u0645\u0646 \u062C\u062F\u064A\u062F." };
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
    returnExceptionGrantedAt
  } = req.body || {};
  const returnedAt = (/* @__PURE__ */ new Date()).toISOString();
  const returnedByEmail = String(
    teacherEmail || req.headers["x-teacher-email"] || ""
  );
  const normalizedKind = String(kind || "").trim();
  const normalizedActivityId = String(activityId ?? projectId ?? "").trim();
  const normalizedStudentId = String(studentId ?? "").trim();
  const exceptionUntilMs = new Date(returnExceptionUntil || 0).getTime();
  const normalizedReturnExceptionUntil = Number.isFinite(exceptionUntilMs) && exceptionUntilMs > Date.now() ? new Date(exceptionUntilMs).toISOString() : "";
  const normalizedReturnExceptionHours = normalizedReturnExceptionUntil && Number.isFinite(Number(returnExceptionHours)) ? Math.max(1, Math.min(24, Number(returnExceptionHours))) : "";
  let returnNotified = false;
  const returnActivityTitle = dbInstance.getTeacherExams().find((e) => String(e.id) === normalizedActivityId)?.title || dbInstance.getPersonalizedProjects().find(
    (p) => String(p.id) === String(projectId || activityId)
  )?.title || "\u0646\u0634\u0627\u0637";
  const ensureReturnNotice = (courseCode) => {
    if (returnNotified || !normalizedStudentId) return;
    const notice = returnNoticeForKind(normalizedKind || kind);
    notifyStudent(normalizedStudentId, notice.title, notice.body, {
      type: "submission_returned",
      studentId: normalizedStudentId,
      activityId: normalizedActivityId,
      kind: normalizedKind || String(kind || ""),
      courseCode: String(courseCode || ""),
      link: "/"
    });
    returnNotified = true;
  };
  if (normalizedKind && normalizedActivityId && normalizedStudentId) {
    const subs = dbInstance.getTeacherSubmissions();
    const matchIdx = subs.findIndex(
      (item) => submissionId && (String(item.id) === String(submissionId) || String(item.serverSubmissionId || "") === String(submissionId)) || String(item.kind || "") === normalizedKind && String(item.activityId ?? "") === normalizedActivityId && String(item.studentId ?? "") === normalizedStudentId
    );
    if (matchIdx !== -1) {
      const currentSub = subs[matchIdx];
      const shouldPreserveReturnedExamAnswers = false;
      const returnedPreservedAnswers = currentSub.answers && Object.keys(currentSub.answers || {}).length ? currentSub.answers : currentSub.previousAnswers || {};
      const returnedPreservedMatchedQuestions = Array.isArray(
        currentSub.matchedQuestions
      ) ? currentSub.matchedQuestions : currentSub.previousMatchedQuestions || [];
      const updatedSub = {
        ...currentSub,
        status: EXAM_RETURNED_STATUS,
        previousStatus: currentSub.status || currentSub.previousStatus || "",
        previousAnswerText: currentSub.answerText || currentSub.previousAnswerText || "",
        grade: "",
        visibleGrade: "",
        score: "",
        teacherGrade: "",
        finalGrade: "",
        teacherGradeOverride: false,
        gradedAt: void 0,
        previousServerSubmissionId: currentSub.serverSubmissionId || currentSub.previousServerSubmissionId || "",
        serverSubmissionId: void 0,
        previousGrade: String(
          currentSub.grade ?? currentSub.score ?? currentSub.visibleGrade ?? currentSub.previousGrade ?? ""
        ),
        previousVisibleGrade: String(
          currentSub.visibleGrade ?? currentSub.grade ?? currentSub.score ?? currentSub.previousVisibleGrade ?? ""
        ),
        previousTotalPoints: currentSub.totalPoints ?? currentSub.maxPoints ?? currentSub.points ?? currentSub.previousTotalPoints ?? "",
        previousAnswers: returnedPreservedAnswers,
        previousMatchedQuestions: returnedPreservedMatchedQuestions,
        answers: shouldPreserveReturnedExamAnswers ? returnedPreservedAnswers : {},
        matchedQuestions: shouldPreserveReturnedExamAnswers ? returnedPreservedMatchedQuestions : [],
        answerText: "\u062A\u0645 \u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0646\u0634\u0627\u0637 \u0644\u0644\u0637\u0627\u0644\u0628\u061B \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0641\u062A\u0648\u062D\u0629 \u0645\u0646 \u062C\u062F\u064A\u062F.",
        returnedAt,
        returnedByEmail,
        returnExceptionUntil: normalizedReturnExceptionUntil,
        returnExceptionHours: normalizedReturnExceptionHours,
        returnExceptionGrantedAt: normalizedReturnExceptionUntil ? returnExceptionGrantedAt || returnedAt : "",
        returnExceptionByEmail: normalizedReturnExceptionUntil ? returnedByEmail : "",
        returnNote,
        updatedAt: returnedAt
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
          link: "/"
        }
      );
      returnNotified = true;
      dbInstance.addActivityLog({
        studentId: normalizedStudentId,
        studentName: String(updatedSub.studentName || ""),
        action: "\u0625\u0631\u062C\u0627\u0639 \u0645\u062D\u0627\u0648\u0644\u0629 \u0644\u0644\u0637\u0627\u0644\u0628",
        details: `${updatedSub.activityTitle || "\u0646\u0634\u0627\u0637"} \u2014 \u062A\u0645 \u0627\u0644\u0625\u0631\u062C\u0627\u0639 \u0645\u0646 \u0634\u0627\u0634\u0629 \u0627\u0644\u062A\u0633\u0644\u064A\u0645\u0627\u062A.`,
        teacherEmail: returnedByEmail,
        actorEmail: returnedByEmail,
        sectionCode: String(updatedSub.courseCode || ""),
        ip: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "Unknown",
        os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
        browser: "\u0633\u062C\u0644 \u0625\u0646\u0635\u0627\u0641",
        isViolationWarning: false
      });
    }
  }
  if (kind === "exercise") {
    const sub = dbInstance.getExerciseSubmissions().find(
      (s) => String(s.id) === String(submissionId) || String(s.studentId) === String(studentId) && String(s.exerciseId) === String(activityId)
    );
    if (!sub)
      return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0646\u0634\u0627\u0637." });
    dbInstance.updateExerciseSubmission(sub.id, {
      status: "returned",
      returnedAt,
      returnedByEmail,
      returnNote
    });
    ensureReturnNotice(
      String(sub.sectionCode || sub.courseCode || "")
    );
    return res.json({ success: true, status: "returned" });
  }
  if (kind === "quiz" || kind === "exam") {
    const sub = dbInstance.getQuizSubmissions().find(
      (s) => String(s.id) === String(submissionId) || String(s.studentId) === String(studentId) && String(s.chapterId) === String(activityId)
    );
    if (sub) {
      const shouldPreserveReturnedQuizAnswers = isCheatingAttemptSubmissionServer(sub) || String(sub.finishReason || "").trim() === EXAM_CHEATING_ATTEMPT_STATUS;
      const preservedMatchedQuestions = sub.matchedQuestions || sub.previousMatchedQuestions || [];
      const preservedGeneratedQuestionIds = sub.generatedQuestionIds || sub.previousGeneratedQuestionIds || [];
      dbInstance.updateQuizSubmission(sub.id, {
        status: "returned",
        returnedAt,
        returnedByEmail,
        returnNote,
        previousMatchedQuestions: preservedMatchedQuestions,
        previousGeneratedQuestionIds: preservedGeneratedQuestionIds,
        matchedQuestions: shouldPreserveReturnedQuizAnswers ? preservedMatchedQuestions : [],
        generatedQuestionIds: shouldPreserveReturnedQuizAnswers ? preservedGeneratedQuestionIds : [],
        generatedQuestions: shouldPreserveReturnedQuizAnswers ? sub.generatedQuestions || [] : [],
        score: shouldPreserveReturnedQuizAnswers ? sub.score : 0,
        totalPoints: shouldPreserveReturnedQuizAnswers ? sub.totalPoints : 0,
        returnExceptionUntil: normalizedReturnExceptionUntil,
        returnExceptionHours: normalizedReturnExceptionHours,
        returnExceptionGrantedAt: normalizedReturnExceptionUntil ? returnExceptionGrantedAt || returnedAt : "",
        returnExceptionByEmail: normalizedReturnExceptionUntil ? returnedByEmail : "",
        zeroReason: shouldPreserveReturnedQuizAnswers ? sub.zeroReason : void 0,
        finishReason: shouldPreserveReturnedQuizAnswers ? sub.finishReason : void 0
      });
    }
    const returnedExam = dbInstance.getTeacherExams().find((e) => String(e.id) === normalizedActivityId);
    ensureReturnNotice(
      String(
        sub?.sectionCode || sub?.courseCode || returnedExam?.courseCode || ""
      )
    );
    return res.json({ success: true, status: "returned" });
  }
  const project = dbInstance.getPersonalizedProjects().find((p) => String(p.id) === String(projectId || activityId));
  if (project) {
    dbInstance.updatePersonalizedProject(project.id, {
      status: "returned",
      returnedAt,
      returnedByEmail,
      returnNote,
      returnExceptionUntil: normalizedReturnExceptionUntil,
      returnExceptionHours: normalizedReturnExceptionHours,
      returnExceptionGrantedAt: normalizedReturnExceptionUntil ? returnExceptionGrantedAt || returnedAt : "",
      returnExceptionByEmail: normalizedReturnExceptionUntil ? returnedByEmail : ""
    });
  } else if (normalizedKind !== "project") {
    return res.status(404).json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0645\u0634\u0631\u0648\u0639." });
  }
  ensureReturnNotice(
    String(project?.courseCode || project?.sectionCode || "")
  );
  return res.json({ success: true, status: "returned" });
});
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
    const percentCompleted = totalRegistered > 0 ? Math.floor(
      students.reduce((acc, s) => acc + s.progress, 0) / totalRegistered
    ) : 0;
    const deviceViolationCount = logs.filter(
      (l) => l.action === "\u0627\u0646\u062A\u0647\u0627\u0643 \u0627\u0644\u0623\u062C\u0647\u0632\u0629" || l.isViolationWarning
    ).length;
    const inactiveOrStruggling = students.filter((s) => s.progress < 20 || s.score < 5).map((s) => ({
      id: s.id,
      name: s.name,
      section: s.sectionCode,
      progress: s.progress,
      score: s.score,
      lastLogin: s.lastLoginDate
    }));
    const teacherEmail = teacherEmailFromRequest(req);
    const teacherChapters = dbInstance.getChapters().filter(
      (c) => c.teacherEmail && c.teacherEmail.toLowerCase() === teacherEmail.toLowerCase()
    );
    const chapterStats = teacherChapters.map((chapter) => {
      const chapterQuizzes = submissions.filter(
        (q) => q.chapterId === chapter.id
      );
      const avgScore = chapterQuizzes.length > 0 ? Math.floor(
        chapterQuizzes.reduce(
          (acc, q) => acc + q.score / q.totalPoints * 100,
          0
        ) / chapterQuizzes.length
      ) : 80;
      return {
        chapterId: chapter.id,
        title: chapter.title,
        attemptsCount: chapterQuizzes.length,
        averageScorePercent: avgScore
      };
    });
    const includeAll = String(req.query.includeAll || "") === "1" && isAdminEmail(teacherEmail);
    const teacherSections = activeSections().filter(
      (sec) => includeAll || !teacherEmail || sectionOwnerEmail(sec.code) === teacherEmail
    );
    const teacherSectionCodes = new Set(
      teacherSections.map((sec) => String(sec.code || "").toLowerCase())
    );
    const ownsCourse = (courseCode) => {
      if (includeAll || !teacherEmail) return true;
      const code = String(courseCode || "").trim();
      if (!code) return false;
      if (teacherSectionCodes.has(code.toLowerCase())) return true;
      if (teacherOwnsCourseCode(code, teacherEmail)) return true;
      return teacherSections.some((sec) => sectionCodeEquivalent(sec.code, code));
    };
    const reportStudents = dbInstance.getStudents().map((student) => {
      const enrollments = getStudentEnrollmentDetails(student).filter(
        (entry) => ownsCourse(entry.courseCode || entry.sectionCode)
      );
      return { ...student, enrollments };
    }).filter((student) => includeAll || !teacherEmail || student.enrollments.length > 0 || ownsCourse(student.sectionCode));
    return res.json({
      totalRegistered,
      totalAllowed,
      percentCompleted,
      deviceViolationCount,
      inactiveOrStruggling,
      chapterStats,
      students: reportStudents,
      allowedStudents: dbInstance.getAllowedStudents().filter((row) => ownsCourse(row.sectionCode || row.courseCode))
    });
  } catch (err) {
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
      warning: "\u062A\u0639\u0630\u0631 \u062A\u062C\u0645\u064A\u0639 \u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u0637\u0644\u0628\u0629 \u0645\u0624\u0642\u062A\u0627\u064B \u062F\u0648\u0646 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u062D\u0644\u064A\u0629 \u0642\u062F\u064A\u0645\u0629."
    });
  }
});
app.get("/api/teacher/miras-export", (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  const payload = buildMirasBackupPayload(
    teacherEmail,
    String(req.query.scope || "me")
  );
  return res.json({ success: true, payload });
});
app.post("/api/teacher/miras-import", async (req, res) => {
  const teacherEmail = teacherEmailFromRequest(req);
  if (!teacherEmail)
    return res.status(401).json({ error: "\u062C\u0644\u0633\u0629 \u0627\u0644\u0623\u0633\u062A\u0627\u0630 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629." });
  try {
    const requestedOwner = String(req.body?.targetOwnerEmail || teacherEmail).trim().toLowerCase();
    const targetOwnerEmail = isAdminEmail(teacherEmail) ? requestedOwner : teacherEmail;
    const preserveOwners = isAdminEmail(teacherEmail) && String(req.body?.preserveOwners || "") === "1";
    const prepared = prepareMirasImportData(
      req.body?.payload,
      targetOwnerEmail,
      preserveOwners
    );
    const summary = dbInstance.mergeBackupData(prepared);
    bumpLiveContentRevision();
    dbInstance.addActivityLog({
      action: "\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0646\u0633\u062E\u0629 \u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629",
      details: `\u062A\u0645 \u062F\u0645\u062C \u0646\u0633\u062E\u0629 \u0645\u0650\u0631\u0627\u0633 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 \u062F\u0627\u062E\u0644 \u062D\u0633\u0627\u0628 ${preserveOwners ? "\u0645\u0639 \u0627\u0644\u062D\u0641\u0627\u0638 \u0639\u0644\u0649 \u0627\u0644\u0645\u0644\u0627\u0643 \u0627\u0644\u0623\u0635\u0644\u064A\u064A\u0646" : targetOwnerEmail}.`,
      teacherEmail: targetOwnerEmail,
      actorEmail: teacherEmail,
      sectionCode: "",
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0623\u0633\u062A\u0627\u0630",
      browser: "Data Vault",
      isViolationWarning: false
    });
    if (!await ensureDurableSync(res)) return;
    return res.json({ success: true, summary, revision: liveContentRevision });
  } catch {
    return res.status(400).json({ error: "\u0645\u0644\u0641 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F." });
  }
});
app.post("/api/teacher/seed-allowed-list", (req, res) => {
  return res.status(410).json({
    error: "\u062A\u0645 \u062A\u0639\u0637\u064A\u0644 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u062C\u0631\u064A\u0628\u064A\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629. \u0627\u0631\u0641\u0639 \u0643\u0634\u0641 \u0627\u0644\u0637\u0644\u0627\u0628 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0645\u0646 \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062F\u0627\u0631\u0629."
  });
});
app.post("/api/teacher/database/custom-reset", (req, res) => {
  const teacherEmail = String(
    req.body?.teacherEmail || req.headers["x-teacher-email"] || ""
  ).toLowerCase();
  const teacher = dbInstance.getTeachers().find((t) => t.email.toLowerCase() === teacherEmail);
  if (!teacher) {
    return res.status(403).json({ error: "\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0639\u0644\u0645 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641." });
  }
  try {
    const ownedCourseCodes = dbInstance.getSections().filter((section) => {
      const owner = String(section.ownerEmail || sectionOwnerEmail(section.code) || "").toLowerCase();
      return owner === teacherEmail;
    }).map((section) => String(section.code || "").trim()).filter(Boolean);
    const ownedSet = new Set(ownedCourseCodes.map((code) => String(code).toLowerCase()));
    const studentIds = dbInstance.getStudents().filter((student) => {
      const codes = getStudentDiscoveredCourseCodes(student);
      return codes.some((code) => ownedSet.has(String(code).toLowerCase())) || String(sectionOwnerEmail(student.sectionCode || "")).toLowerCase() === teacherEmail;
    }).map((student) => String(student.id));
    const summary = dbInstance.cleanseTeacherStudentData(studentIds, teacher.email);
    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: isAdminEmail(teacherEmail) ? "\u062A\u0637\u0647\u064A\u0631 \u0641\u0635\u0648\u0644 \u0627\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646 \u0641\u0642\u0637" : "\u062A\u0637\u0647\u064A\u0631 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0639\u0644\u0645 \u0628\u0627\u0644\u0643\u0627\u0645\u0644",
      details: `\u062A\u0645 \u062D\u0630\u0641 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062E\u0627\u0635\u0629 \u0641\u0642\u0637: ${summary.removedSections} \u0645\u0642\u0631\u0631/\u0641\u0635\u0644\u060C ${summary.removedStudents} \u0637\u0627\u0644\u0628\u060C ${summary.removedOperations} \u0639\u0645\u0644\u064A\u0629\u060C ${summary.removedQuestions} \u0633\u0624\u0627\u0644\u060C ${summary.removedExercises} \u0648\u0627\u062C\u0628\u060C \u0645\u0639 \u0639\u062F\u0645 \u0644\u0645\u0633 \u0645\u0641\u0627\u062A\u064A\u062D/\u0623\u0643\u0648\u0627\u062F \u0627\u0644\u062F\u062E\u0648\u0644 \u0646\u0647\u0627\u0626\u064A\u0627\u064B (${summary.preservedJoinCodes} \u0643\u0648\u062F \u0645\u062D\u0641\u0648\u0638).`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u062A\u0635\u0641\u062D",
      browser: "\u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062D\u0643\u0645",
      isViolationWarning: false
    });
    return res.json({
      success: true,
      message: `\u062A\u0645 \u062A\u0637\u0647\u064A\u0631 \u0628\u064A\u0627\u0646\u0627\u062A \u062D\u0633\u0627\u0628\u0643 \u0641\u0642\u0637: \u062D\u0630\u0641 ${summary.removedSections} \u0645\u0642\u0631\u0631/\u0641\u0635\u0644\u060C ${summary.removedStudents} \u0637\u0627\u0644\u0628\u060C ${summary.removedOperations} \u0639\u0645\u0644\u064A\u0629\u060C ${summary.removedQuestions} \u0633\u0624\u0627\u0644\u060C ${summary.removedExercises} \u0648\u0627\u062C\u0628. \u0644\u0645 \u064A\u062A\u0645 \u0644\u0645\u0633 \u0623\u0643\u0648\u0627\u062F \u0627\u0644\u062F\u062E\u0648\u0644 \u0646\u0647\u0627\u0626\u064A\u0627\u064B.`,
      summary
    });
  } catch (error) {
    return res.status(500).json({ error: "\u0641\u0634\u0644 \u0641\u064A \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u062A\u0635\u0641\u064A\u0631: " + error.message });
  }
});
app.post("/api/teacher/database/full-reset", (req, res) => {
  const teacherEmail = String(
    req.body?.teacherEmail || req.headers["x-teacher-email"] || ""
  ).toLowerCase();
  const teacher = dbInstance.getTeachers().find((t) => t.email.toLowerCase() === teacherEmail);
  if (!teacher || !isAdminEmail(teacherEmail)) {
    return res.status(403).json({ error: "\u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0645\u062E\u0635\u0635 \u0644\u0644\u0633\u0648\u0628\u0631 \u0623\u062F\u0645\u0646 \u0641\u0642\u0637." });
  }
  try {
    const archivedBefore = archivedJoinCodesCount();
    dbInstance.fullReset(teacher.email);
    const archivedAdded = Math.max(
      0,
      archivedJoinCodesCount() - archivedBefore
    );
    dbInstance.addActivityLog({
      studentName: teacher.name,
      actorEmail: teacher.email,
      teacherEmail: teacher.email,
      action: "\u062A\u0635\u0641\u064A\u0631 \u0634\u0627\u0645\u0644 \u0648\u0643\u0627\u0645\u0644 \u0644\u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A",
      details: `\u062A\u0645 \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0643\u0627\u0645\u0644 \u0648\u0627\u0644\u0634\u0627\u0645\u0644 \u0645\u0639 \u062D\u0641\u0638 \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0623\u0643\u0648\u0627\u062F \u0648\u0645\u0646\u0639 \u0625\u0639\u0627\u062F\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647\u0627\u061B \u0623\u064F\u0636\u064A\u0641 ${archivedAdded} \u0643\u0648\u062F\u0627\u064B \u0644\u0644\u0623\u0631\u0634\u064A\u0641.`,
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      os: "\u0645\u062A\u0635\u0641\u062D",
      browser: "\u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062D\u0643\u0645",
      isViolationWarning: false
    });
    return res.json({
      success: true,
      message: archivedAdded ? `\u062A\u0645 \u0627\u0644\u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0634\u0627\u0645\u0644 \u0628\u0646\u062C\u0627\u062D\u060C \u0648\u0623\u064F\u0631\u0634\u0650\u0641 ${archivedAdded} \u0643\u0648\u062F\u0627\u064B \u0644\u0645\u0646\u0639 \u062A\u0643\u0631\u0627\u0631\u0647\u0627 \u0645\u0633\u062A\u0642\u0628\u0644\u0627\u064B.` : "\u062A\u0645 \u0627\u0644\u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0634\u0627\u0645\u0644 \u0648\u0627\u0644\u0643\u0627\u0645\u0644 \u0628\u0646\u062C\u0627\u062D\u060C \u0648\u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0623\u0643\u0648\u0627\u062F \u0645\u062D\u0641\u0648\u0638 \u0643\u0645\u0627 \u0647\u0648."
    });
  } catch (error) {
    return res.status(500).json({ error: "\u0641\u0634\u0644 \u0641\u064A \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0634\u0627\u0645\u0644: " + error.message });
  }
});
async function bootstrap() {
  console.log("\u23F3 Waiting for database initial sync with cloud Firestore...");
  try {
    await dbInstance.initialSyncPromise;
    console.log("\u2705 Database initial sync completed successfully.");
    await migrateEmbeddedSubmissionAttachments();
  } catch (err) {
    console.error(
      "\u26A0\uFE0F Database initial sync encountered an error, booting server anyway:",
      err
    );
  }
  if (process.env.NODE_ENV === "production" || process.env.DISABLE_HMR === "true") {
    const distPath = import_path2.default.join(process.cwd(), "dist");
    if (import_fs2.default.existsSync(distPath)) {
      app.use(import_express.default.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(import_path2.default.join(distPath, "index.html"));
      });
    } else {
      app.get("/", (req, res) => {
        res.send(
          "\u0645\u0650\u0631\u0627\u0633: \u0627\u0644\u0645\u0646\u0635\u0629 \u0642\u064A\u062F \u0627\u0644\u0628\u0646\u0627\u0621 \u0648\u0627\u0644\u062A\u062C\u0647\u064A\u0632. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062D\u0632\u0645 \u0627\u0644\u0645\u062A\u0631\u062C\u0645\u0629."
        );
      });
    }
  } else {
    const distPath = import_path2.default.join(process.cwd(), "dist");
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith("/api")) {
        return next();
      }
      try {
        let template = import_fs2.default.readFileSync(
          import_path2.default.resolve(process.cwd(), "index.html"),
          "utf-8"
        );
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\u{1F680} Living Book Lab Server active at http://localhost:${PORT}`);
  });
}
bootstrap().catch((err) => {
  console.error("Failed to start Living Book Lab Server:", err);
});
//# sourceMappingURL=server.cjs.map
