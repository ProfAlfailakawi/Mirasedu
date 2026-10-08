// The standard seed, plus archived codes in every retirement shape «تحقق» must
// label correctly: no recorded reason (legacy), an unknown reason, a teacher
// delete, and the course-closure reasons that stay «لم يُستخدم».
require('./seed.cjs');
const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const base = { semester: 'الفصل الدراسي الثاني 2026', sectionCode: '111-aa@test.kw', ownerEmail: 'aa@test.kw', createdAt: new Date().toISOString(), retiredAt: new Date().toISOString(), isArchived: true };
db.retiredJoinCodes = [
  ...(db.retiredJoinCodes || []),
  { ...base, code: 'LAB-ZQNR-QQQQ-QQQ2', status: 'retired', assignedStudentId: '1001', assignedStudentName: 'طالب أول' }, // بلا سبب مسجّل
  { ...base, code: 'LAB-ZQNR-QQQQ-QQQ5', status: 'retired', retiredReason: 'some_future_reason' },
  { ...base, code: 'LAB-ZQNR-QQQQ-QQQ8', status: 'retired', retiredReason: 'teacher_deleted_code' },
  { ...base, code: 'LAB-ZQNR-QQQQ-QQQG', status: 'retired', retiredReason: 'course_deleted' },
  { ...base, code: 'LAB-ZQNR-QQQQ-QQGG', status: 'retired', retiredReason: 'course_closed_full_reset' },
  { ...base, code: 'LAB-ZQNR-QQQQ-QGGG', status: 'retired', retiredReason: 'course_closed' },
];
fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf-8');
