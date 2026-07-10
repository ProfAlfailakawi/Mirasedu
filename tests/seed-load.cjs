// Load-test fixture: ONE course owned by one teacher with 1000 activated students
// all enrolled+active, plus one published exam and one approved question. Writes
// data/db.json. The load runner (run-load.sh) disables the live Firestore config
// and backs up/restores data/db.json, so this never touches production.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DB = path.join(ROOT, "data", "db.json");
fs.mkdirSync(path.dirname(DB), { recursive: true });

const sha256pw = (pw) => "sha256:" + crypto.createHash("sha256").update(String(pw)).digest("hex");
const TEACHER_HASH = "sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678"; // A97852900

const COUNT = Number(process.env.MIRAS_LOAD_STUDENTS || 1000);
const T = "load@test.kw";
const SEC = `500-${T}`; // course code (scoped to teacher)
const now = new Date().toISOString();
const futureEnd = new Date(Date.now() + 7 * 86400000).toISOString();
const pad = (n) => String(n).padStart(4, "0");
const sid = (i) => `L${pad(i)}`;

const students = [];
const allowedStudents = [];
for (let i = 1; i <= COUNT; i += 1) {
  const id = sid(i);
  allowedStudents.push({ idNumber: id, name: `طالب ${i}`, sectionCode: SEC, teacherEmail: T });
  students.push({
    id,
    name: `طالب ${i}`,
    email: `${id}@paaet.edu.kw`,
    sectionCode: SEC,
    studentSection: SEC,
    semester: "الفصل الأول 2026",
    passwordHash: sha256pw(`pass${id}`),
    isPaid: true,
    isActivated: true,
    activationCode: `LAB-LOAD-${pad(i)}`,
    activatedCourseCodes: [SEC],
    enrollments: [{ courseCode: SEC, sectionCode: SEC, teacherEmail: T, status: "active", isActive: true }],
    devices: [`Mozilla/5.0_203.0.113.9_dev${id}`],
    progress: (i % 100), score: 0, strengths: [], weaknesses: [], recommendations: [],
    signupDate: now, lastLoginDate: now,
  });
}

const db = {
  lastUpdated: Date.now(),
  teachers: [{ id: T, name: "د. الحِمل", email: T, passwordHash: TEACHER_HASH, role: "teacher", isActive: true }],
  sections: [{ code: SEC, courseName: "مقرر الحِمل", semester: "الفصل الأول 2026", isOpen: true, ownerEmail: T }],
  allowedStudents,
  students,
  joinCodes: [],
  retiredJoinCodes: [],
  chapters: [],
  questionBank: [{
    id: "q-load-1", chapterId: "cat-load", courseCode: SEC, teacherEmail: T,
    type: "multiple-choice", questionText: "سؤال الحِمل", options: ["أ", "ب", "ج"],
    correctAnswer: "أ", points: 1, difficulty: "beginner", isApproved: true, isGenerated: false,
  }],
  exercises: [], exerciseSubmissions: [], personalizedProjects: [], quizSubmissions: [],
  activityLogs: [], otps: [],
  teacherExams: [{
    id: "exam-load-1", title: "اختبار الحِمل", points: 1, questionsCount: 1,
    open: new Date(Date.now() - 3600000).toISOString(), close: futureEnd,
    courseCode: SEC, selectedCategories: ["cat-load"], seb: { enabled: false },
    antiCheat: { timerMinutes: 30 }, createdBy: T, createdAt: now,
  }],
  teacherProjects: [], teacherSubmissions: [], sebAttempts: [], passwordResetRequests: [],
  activationAttempts: [], notificationTokens: [], inAppNotifications: [], passkeyCredentials: [],
  examSessions: [],
};

fs.writeFileSync(DB, JSON.stringify(db), "utf-8");
if (require.main === module) console.log(`Seeded ${COUNT} students + 1 course + 1 exam ->`, DB);
module.exports = { T, SEC, COUNT, sid };
