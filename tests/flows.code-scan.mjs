// Scenario: a student activates a code with teacher A, A's course ends, then the
// student enrolls with teacher B. Any teacher checking either code sees that
// code's own course, semester and teacher, with the code's history kept.
import { api, makeJar, createReporter, AA, BB, S_A1, S_A2, S_B1 } from './lib.mjs';
const { check, done } = createReporter('FLOWS / CODE CHECK ACROSS TEACHERS');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const A = { jar: makeJar(), deviceToken: 'scan-a' }, B = { jar: makeJar(), deviceToken: 'scan-b' };
const studentOpts = { jar: makeJar(), deviceToken: 'tok-1001' };
for (const [id, o] of [[AA, A], [BB, B]]) check(`login ${id}`, (await api('POST', '/api/auth/login', { idNumber: id, password: pw }, o)).ok);
const seededStudent = '1001';
// The seed gives each student the password pass<id>.
await api('POST', '/api/auth/login', { idNumber: seededStudent, password: `pass${seededStudent}` }, studentOpts);
const issue = async (section, o) => (await api('POST', '/api/teacher/join-codes/create', { sectionCode: section, count: 1 }, o)).data.created?.[0];
const scan = async (code, o) => (await api('POST', '/api/teacher/code-scan', { code }, o)).data;
const show = (label, r) => console.log(`   ${label}:`, JSON.stringify({ state: r.state, activated: r.activated, studentId: r.studentId, course: r.courseName, section: r.sectionCode, semester: r.semester, teacher: r.teacherName, error: r.error }));

const oldCode = await issue(S_A1, A);
let r = await api('POST', '/api/students/1001/activate-course', { code: oldCode.code, courseCode: S_A1, deviceToken: 'tok-1001' }, studentOpts);
check('student activates with teacher A', r.ok, JSON.stringify(r.data).slice(0, 160));
const before = await scan(oldCode.code, B);
show('B checks A code (A course live)', before);
const aTeacherName = before.teacherName;

// End of semester for teacher A: the course is deleted.
r = await api('DELETE', `/api/teacher/sections/${encodeURIComponent(S_A1)}`, null, A);
check('teacher A deletes the finished course', r.ok, JSON.stringify(r.data).slice(0, 160));
const newCode = await issue(S_B1, B);
r = await api('POST', '/api/students/1001/activate-course', { code: newCode.code, courseCode: S_B1, deviceToken: 'tok-1001' }, studentOpts);
check('student activates with teacher B', r.ok, JSON.stringify(r.data).slice(0, 160));

for (const [who, o] of [['B', B], ['A', A]]) {
  const oldScan = await scan(oldCode.code, o);
  const newScan = await scan(newCode.code, o);
  show(`${who} checks old A code`, oldScan);
  show(`${who} checks new B code`, newScan);
  check(`${who}: old code still found after course deletion`, oldScan.success === true, oldScan.error);
  check(`${who}: old code keeps the student`, oldScan.studentId === '1001');
  check(`${who}: old code keeps teacher A, not the current teacher`, !!oldScan.teacherName && oldScan.teacherName === aTeacherName, `${oldScan.teacherName} vs ${aTeacherName}`);
  check(`${who}: old code keeps course A`, oldScan.sectionCode === before.sectionCode, `${oldScan.sectionCode} vs ${before.sectionCode}`);
  check(`${who}: old code shows previously activated`, oldScan.activated === true);
  check(`${who}: new code shows teacher B course`, newScan.success && newScan.sectionCode !== before.sectionCode && newScan.teacherName !== aTeacherName, `${newScan.sectionCode} ${newScan.teacherName}`);
}

// Teacher A removes the student from another course instead of deleting it.
const removedCode = await issue(S_A2, A);
r = await api('POST', '/api/students/1001/activate-course', { code: removedCode.code, courseCode: S_A2, deviceToken: 'tok-1001' }, studentOpts);
check('student activates a second course with teacher A', r.ok, JSON.stringify(r.data).slice(0, 160));
r = await api('POST', '/api/teacher/students/1001/remove-course', { courseCode: S_A2 }, A);
check('teacher A removes the student from that course', r.ok, JSON.stringify(r.data).slice(0, 160));
const removedScan = await scan(removedCode.code, B);
show('B checks code of removed course', removedScan);
check('removed-course code: found with student, course and teacher A',
  removedScan.success && removedScan.studentId === '1001' && removedScan.sectionCode === S_A2 && removedScan.teacherName === aTeacherName && removedScan.activated === true,
  JSON.stringify(removedScan).slice(0, 200));
done();
