// Canonical test fixture for the Miras student flows regression suite.
// Writes data/db.json with a controlled, production-free dataset.
// NOTE: the runner (run-flows.sh) disables the live Firestore config and
// backs up/restores data/db.json, so running this never touches production.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DB = path.join(ROOT, "data", "db.json");
fs.mkdirSync(path.dirname(DB), { recursive: true });

const sha256pw = (pw) => "sha256:" + crypto.createHash("sha256").update(String(pw)).digest("hex");
const tokHash = (tok) => crypto.createHash("sha256").update(String(tok)).digest("hex").slice(0, 12);
// fingerprint that embeds a *previous* IP, so a local request (different ip)
// reproduces the "same device, IP changed" scenario.
const fpPrevIp = (tok) => `Mozilla/5.0_203.0.113.9_${tokHash(tok)}`;
const TEACHER_HASH = "sha256:REDACTED"; // ***REDACTED***

const AA = "aa@test.kw", BB = "bb@test.kw", CC = "cc@test.kw", DD = "dd@test.kw";
const S_A1 = `111-${AA}`, S_A2 = `222-${AA}`, S_C = `333-${AA}`;
const S_B1 = `111-${BB}`, S_C1 = `111-${CC}`, S_D1 = `111-${DD}`;

const now = new Date().toISOString();
const pastEnd = new Date(Date.now() - 86400000).toISOString();
const futureEnd = new Date(Date.now() + 86400000).toISOString();

const teacher = (email, name) => ({ id: email, name, email, passwordHash: TEACHER_HASH, role: "teacher", isActive: true });
const section = (code, courseName, owner) => ({ code, courseName, semester: "الفصل الأول 2026", isOpen: true, ownerEmail: owner });
const roster = (idNumber, name, sectionCode, teacherEmail) => ({ idNumber, name, sectionCode, teacherEmail });
const code = (c, sectionCode, owner, extra = {}) => ({
  code: c, semester: "الفصل الأول 2026", sectionCode, courseCode: sectionCode, studentSection: sectionCode,
  status: "active", ownerEmail: owner, isFreeCode: false, ...extra,
});

const db = {
  lastUpdated: Date.now(),
  // السوبر أدمن يطابق قائمة البريد الصريحة في الخادم (مطابقة تامة وآمنة).
  teachers: [
    teacher(AA, "د. معلم أ"), teacher(BB, "د. معلم ب"), teacher(CC, "د. معلم ج"), teacher(DD, "د. معلم د"),
    teacher("ah.alfailakawi@paaet.edu.kw", "السوبر أدمن"),
  ],
  sections: [
    section(S_A1, "مقدمة (أ)", AA), section(S_A2, "متقدم (أ)", AA), section(S_C, "خاص (أ)", AA),
    section(S_B1, "مقدمة (ب)", BB), section(S_C1, "مقدمة (ج)", CC), section(S_D1, "مقدمة (د)", DD),
  ],
  allowedStudents: [
    roster("1001", "طالب أول", S_A1, AA), roster("1001", "طالب أول", S_A2, AA), roster("1001", "طالب أول", S_B1, BB),
    roster("1002", "طالب ثاني", S_A1, AA),
    roster("1003", "طالب ثالث", S_B1, BB),
    roster("1005", "طالب خامس", S_A2, AA),
    roster("2002", "طالب آخر", S_A1, AA),
    roster("3003", "طالب ناقل", S_A1, AA),
    // 7007: روستر بلا حقل teacherEmail (مثل صف مرفوع من الواجهة؛ المالك في كود الشعبة)
    { idNumber: "7007", name: "طالب كشف بلا مالك", sectionCode: S_A1 },
    // multi-teacher new student: in A,B,C,D rosters (all course "111", different owners)
    roster("1100", "طالب متعدد", S_A1, AA), roster("1100", "طالب متعدد", S_B1, BB),
    roster("1100", "طالب متعدد", S_C1, CC), roster("1100", "طالب متعدد", S_D1, DD),
    // NOTE: 9999 intentionally in NO roster
  ],
  students: [
    {
      id: "1001", name: "طالب أول", email: "1001@paaet.edu.kw", sectionCode: S_A1, studentSection: S_A1,
      semester: "الفصل الأول 2026", passwordHash: sha256pw("pass1001"),
      isPaid: true, isActivated: true, activationCode: "LAB-1111-0001",
      // already-corrupted ghost data: two codes whose section no longer exists
      activatedCourseCodes: [S_A1, "777-ghost@test.kw", "111-OLDNAME@test.kw"],
      enrollments: [
        { courseCode: S_A1, sectionCode: S_A1, teacherEmail: AA, status: "active", isActive: true },
        { courseCode: "777-ghost@test.kw", sectionCode: "777-ghost@test.kw", status: "active", isActive: true },
      ],
      devices: [fpPrevIp("tok-1001")], progress: 10, score: 0, strengths: [], weaknesses: [], recommendations: [],
      signupDate: now, lastLoginDate: now,
    },
    {
      id: "2002", name: "طالب آخر", email: "2002@paaet.edu.kw", sectionCode: S_A1, studentSection: S_A1,
      semester: "الفصل الأول 2026", passwordHash: sha256pw("pass2002"),
      isPaid: true, isActivated: true, activationCode: "LAB-7777-0007", activatedCourseCodes: [S_A1],
      enrollments: [{ courseCode: S_A1, sectionCode: S_A1, teacherEmail: AA, status: "active", isActive: true }],
      devices: [fpPrevIp("tok-2002")], progress: 0, score: 0, strengths: [], weaknesses: [], recommendations: [],
      signupDate: now, lastLoginDate: now,
    },
    {
      id: "3003", name: "طالب ناقل", email: "3003@paaet.edu.kw", sectionCode: S_A1, studentSection: S_A1,
      semester: "الفصل الأول 2026", passwordHash: sha256pw("pass3003"),
      isPaid: true, isActivated: true, activationCode: "LAB-5555-0005", activatedCourseCodes: [S_A1],
      enrollments: [{ courseCode: S_A1, sectionCode: S_A1, teacherEmail: AA, status: "active", isActive: true }],
      devices: [fpPrevIp("tok-3003-old")], pendingDeviceTransfer: true,
      retiredDeviceTokens: ["tok-3003-old"], retiredDeviceFingerprints: [fpPrevIp("tok-3003-old")],
      progress: 0, score: 0, strengths: [], weaknesses: [], recommendations: [], signupDate: now, lastLoginDate: now,
    },
  ],
  joinCodes: [
    code("LAB-1111-0001", S_A1, AA, { status: "used", studentId: "1001", usedByStudentId: "1001", activatedAt: now, activationDeviceToken: "tok-1001", activationDeviceFingerprint: fpPrevIp("tok-1001") }),
    code("LAB-1111-0002", S_A1, AA),
    code("LAB-2222-0002", S_A2, AA),
    code("LAB-1111-0003", S_B1, BB),
    code("LAB-9999-0009", S_A1, AA, { status: "revoked" }),
    code("LAB-8888-0008", S_A1, AA, { activationEndsAt: pastEnd }),
    code("LAB-7777-0007", S_A1, AA, { status: "used", studentId: "2002", usedByStudentId: "2002", activatedAt: now, activationDeviceToken: "tok-2002", activationDeviceFingerprint: fpPrevIp("tok-2002") }),
    // single-course "free" code (any eligible student, but ONE course only) — matches the owner's model
    code("LAB-3333-0003", S_A2, AA, { isFreeCode: true }),
    code("LAB-4444-0004", S_C, AA),
    code("LAB-5555-0005", S_A1, AA, { status: "used", studentId: "3003", usedByStudentId: "3003", activatedAt: now, activationDeviceToken: "", activationDeviceFingerprint: "" }),
    code("LAB-7007-0001", S_A1, AA),
    // multi-teacher new-student journey codes (one per course)
    code("LAB-1100-0001", S_A1, AA),
    code("LAB-1100-0002", S_B1, BB),
    code("LAB-1100-0003", S_C1, CC),
    code("LAB-1100-0004", S_D1, DD),
    // single-course free code for course C — to prove a free code opens its ONE course
    // even for a student enrolled in several courses (no "first roster" ambiguity).
    code("LAB-1100-0009", S_C1, CC, { isFreeCode: true }),
  ],
  retiredJoinCodes: [], chapters: [], questionBank: [
    {
      id: "q-lock-1",
      chapterId: "cat-lock",
      courseCode: S_A1,
      teacherEmail: AA,
      type: "multiple-choice",
      questionText: "سؤال اختبار القفل",
      options: ["أ", "ب", "ج"],
      correctAnswer: "أ",
      points: 1,
      difficulty: "beginner",
      isApproved: true,
      isGenerated: false,
    },
  ], exercises: [], exerciseSubmissions: [],
  personalizedProjects: [
    // Fixtures for the authorization regression suite (flows.authz-audit).
    { id: "P-TEST-1001", studentId: "1001", studentName: "طالب أول", courseCode: S_A1, sectionCode: S_A1, title: "مشروع اختبار ملكية الطالب", status: "active", createdBy: AA, teacherEmail: AA, createdAt: now, updatedAt: now },
    { id: "P-TEST-2002", studentId: "2002", studentName: "طالب آخر", courseCode: S_A1, sectionCode: S_A1, title: "مشروع اختبار ملكية المعلم", status: "active", createdBy: AA, teacherEmail: AA, createdAt: now, updatedAt: now },
    { id: "P-TEST-GRADE", studentId: "1001", studentName: "طالب أول", courseCode: S_A1, sectionCode: S_A1, title: "مشروع مصفوفة صلاحية التقييم", status: "active", createdBy: AA, teacherEmail: AA, createdAt: now, updatedAt: now },
  ], quizSubmissions: [], activityLogs: [], otps: [], teacherExams: [
    {
      id: "exam-lock-1",
      title: "اختبار قفل الجلسة",
      points: 1,
      questionsCount: 1,
      open: new Date(Date.now() - 3600000).toISOString(),
      close: futureEnd,
      courseCode: S_A1,
      selectedCategories: ["cat-lock"],
      seb: { enabled: false },
      antiCheat: { timerMinutes: 10 },
      createdBy: AA,
      createdAt: now,
    },
  ],
  teacherProjects: [], teacherSubmissions: [], sebAttempts: [], passwordResetRequests: [],
  activationAttempts: [], notificationTokens: [], inAppNotifications: [], passkeyCredentials: [
    {
      id: "teacher-aa-public-device-test",
      userId: AA,
      userName: "د. معلم أ",
      role: "teacher",
      credentialId: "bWlyYXMtcHVibGljLWRldmljZS10ZXN0LWNyZWRlbnRpYWw",
      publicKey: [165,1,2,3,38,32,1,33,88,32,127,33,123,21,183,147,147,153,141,156,229,89,98,215,212,110,177,118,8,84,200,109,186,53,139,6,30,86,178,247,153,133,34,88,32,227,81,108,81,156,9,105,174,27,97,252,165,31,197,22,219,209,158,232,235,91,86,57,24,101,25,30,77,180,243,212,183],
      counter: 0,
      transports: ["internal"],
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  examSessions: [],
};

fs.writeFileSync(DB, JSON.stringify(db, null, 2), "utf-8");
if (require.main === module) console.log("Seeded", DB);
module.exports = { AA, BB, CC, DD, S_A1, S_A2, S_C, S_B1, S_C1, S_D1 };
