// The standard seed, plus an activation code kept only on a student's record
// (no row in the live or archived code ledgers), as a legacy cleanup can leave.
require('./seed.cjs');
const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const student = db.students.find((s) => String(s.id) === '1001');
student.activationCode = 'LAB-ZQQQ-QQQQ-QQQQ';
// A multi-teacher student holding an orphan code: its owner is ambiguous, so a
// request scoped to one of the teachers must not use it for lookalike hints.
const base = db.students.find((s) => String(s.id) === '2002');
db.students.push({
  ...JSON.parse(JSON.stringify(base)),
  id: '4004', studentNumber: '4004', name: 'طالب عند أستاذين', email: '4004@paaet.edu.kw',
  activationCode: 'LAB-QQSQ-QQQQ-QQQQ',
  activatedCourseCodes: ['111-aa@test.kw', '111-bb@test.kw'],
  enrollments: [
    { courseCode: '111-aa@test.kw', sectionCode: '111-aa@test.kw', teacherEmail: 'aa@test.kw', status: 'active', isActive: true },
    { courseCode: '111-bb@test.kw', sectionCode: '111-bb@test.kw', teacherEmail: 'bb@test.kw', status: 'active', isActive: true },
  ],
  devices: [],
});
fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf-8');
