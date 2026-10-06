// Isolated audit data: every selectable account has codes, attempts and devices.
require('./seed-notification-scope.cjs');
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const admin = 'ah.alfailakawi@paaet.edu.kw';
const now = new Date().toISOString();
for (const [owner, studentId, course, count] of [
  [admin, '1007', `900-${admin}`, 2],
  ['bb@test.kw', '1003', '111-bb@test.kw', 2],
]) {
  db.students.push({ ...db.students[1], id: studentId, name: `طالب ${owner}`, sectionCode: course,
    studentSection: course, activatedCourseCodes: [course],
    enrollments: [{ courseCode: course, sectionCode: course, teacherEmail: owner, status: 'active', isActive: true }],
    lastLoginDate: now });
  for (let i = 0; i < count; i++) db.joinCodes.push({
    code: `LAB-AUDIT-${studentId}-${i}`, status: i ? 'active' : 'used', ownerEmail: owner,
    sectionCode: course, courseCode: course, studentSection: course,
    studentId: i ? '' : studentId, usedByStudentId: i ? '' : studentId,
    activatedAt: i ? '' : now, semester: 'الفصل الأول 2026',
  });
}
for (const [owner, studentId, course] of [
  [admin, '1007', `900-${admin}`], ['aa@test.kw', '1001', '111-aa@test.kw'], ['bb@test.kw', '1003', '111-bb@test.kw'],
]) {
  db.activationAttempts.push({ id: `audit-attempt-${studentId}`, studentId, studentName: `طالب ${studentId}`,
    teacherEmail: owner, targetTeacherEmail: owner, sectionCode: course, targetSectionCode: course,
    code: `LAB-REJECTED-${studentId}`, reason: 'كود غير صالح', status: 'rejected', timestamp: now, createdAt: now,
    deviceToken: `audit-device-${studentId}` });
  db.activityLogs.push({ id: `audit-log-${studentId}`, studentId, actorEmail: owner, teacherEmail: owner,
    sectionCode: course, action: 'مراجعة كود', details: 'سجل اختبار فلتر الحساب', timestamp: now });
  db.passkeyCredentials.push({ ...db.passkeyCredentials[0], id: `audit-credential-${studentId}`,
    credentialId: `audit-credential-${studentId}`, userId: studentId, userName: `طالب ${studentId}`, role: 'student' });
}
fs.writeFileSync(file, JSON.stringify(db, null, 2));
