import crypto from 'node:crypto';
import { api, makeJar, createReporter, AA, BB, S_A1, S_A2, S_B1, hasCourse } from './lib.mjs';
const { check, done } = createReporter('FOUR CODE LIFECYCLE FIXES');
const teacher = makeJar(), otherTeacher = makeJar(), admin = makeJar(), student = makeJar();
const teacherOpts = { jar: teacher, deviceToken: 'lifecycle-teacher' };
const otherOpts = { jar: otherTeacher, deviceToken: 'lifecycle-other' };
const adminOpts = { jar: admin, deviceToken: 'lifecycle-admin' };
const studentOpts = { jar: student, deviceToken: 'tok-1001' };
for (const [id, opts] of [[AA, teacherOpts], [BB, otherOpts], ['ah.alfailakawi@paaet.edu.kw', adminOpts]]) {
  const r = await api('POST', '/api/auth/login', { idNumber: id, password: process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci' }, opts);
  check(`teacher login ${id}`, r.ok);
}
await api('POST', '/api/auth/login', { idNumber: '1001', password: 'pass1001' }, studentOpts);
const issue = async (sectionCode, opts, extra = {}) => {
  const r = await api('POST', '/api/teacher/join-codes/create', { sectionCode, count: 1, ...extra }, opts);
  check('issue signed code', r.ok && !!r.data.created?.[0]?.codeSignature, JSON.stringify(r.data).slice(0, 180));
  return r.data.created?.[0];
};
const list = async (opts = teacherOpts) => (await api('GET', '/api/teacher/join-codes?includeRetired=1', null, opts)).data.joinCodes || [];
const activate = (code, courseCode) => api('POST', '/api/students/1001/activate-course', { code, courseCode, deviceToken: 'tok-1001' }, studentOpts);
const validSignature = c => !!c && c.codeSignature === crypto.createHmac('sha256', 'flow-test-signing-secret')
  .update([c.code.replace(/-/g, ''), c.ownerEmail.toLowerCase(), c.sectionCode.toLowerCase(), c.createdAt].join('|')).digest('hex');
// An empty course may be renumbered even when unused codes were issued.
let empty = await api('POST', '/api/teacher/sections', { code: '880', courseName: 'مقرر فارغ' }, teacherOpts);
check('create empty course', empty.ok);
const emptyCode = await issue(`880-${AA}`, teacherOpts);
empty = await api('PUT', `/api/teacher/sections/${encodeURIComponent(`880-${AA}`)}`, { code: '881', courseName: 'مقرر فارغ' }, teacherOpts);
check('empty course permits changing number', empty.ok, JSON.stringify(empty.data));
const migrated = (await list()).find(c => c.code === emptyCode.code);
check('unused signed code survives empty-course renumbering', migrated?.sectionCode === `881-${AA}` && validSignature(migrated));
let sections = await api('GET', '/api/teacher/sections', null, teacherOpts);
check('UI locks populated courses and permits empty course', sections.data.sections.find(s => s.code === S_A1)?.canEditCode === false && sections.data.sections.find(s => s.code === `881-${AA}`)?.canEditCode === true);
await api('POST', '/api/teacher/upload-allowed', { sectionCode: `881-${AA}`, studentsList: [{ idNumber: '8899', name: 'طالب في الكشف', sectionCode: `881-${AA}` }] }, teacherOpts);
empty = await api('PUT', `/api/teacher/sections/${encodeURIComponent(`881-${AA}`)}`, { code: '882', courseName: 'مقرر فارغ' }, teacherOpts);
check('roster-only student also locks course number', empty.status === 409 && empty.data.code === 'COURSE_CODE_LOCKED');
empty = await api('PUT', `/api/teacher/sections/${encodeURIComponent(`881-${AA}`)}`, { code: '881', courseName: 'اسم معدل' }, teacherOpts);
check('populated course still permits name changes', empty.ok);
const unused = await issue(S_A2, teacherOpts);
const used = await issue(S_A1, teacherOpts);
const unrelated = await issue(S_B1, otherOpts);
let r = await activate(used.code, S_A1);
check('activate before renaming', r.ok && r.data.success, JSON.stringify(r.data).slice(0, 180));
for (const [oldCode, newCode] of [[S_A2, '224'], [S_A1, '114']]) {
  r = await api('PUT', `/api/teacher/sections/${encodeURIComponent(oldCode)}`, { code: newCode, courseName: 'مقرر بعد تغيير الرقم' }, teacherOpts);
  check('course with students rejects number change', r.status === 409 && r.data.code === 'COURSE_CODE_LOCKED', JSON.stringify(r.data));
}
let rows = await list();
check('unused code re-signed after rejected renaming', validSignature(rows.find(c => c.code === unused.code)));
check('used code and locked course remain unchanged', validSignature(rows.find(c => c.code === used.code)) && rows.find(c => c.code === used.code)?.resolvedCourseCode === S_A1);
check('retired signed code stays valid without becoming active', validSignature(rows.find(c => c.code === 'LAB-TEST-2345-ABCD')) && rows.find(c => c.code === 'LAB-TEST-2345-ABCD')?.status === 'retired');
check('invalid original signature is not repaired', rows.find(c => c.code === 'LAB-TEST-2345-ABCE')?.codeSignature === 'a'.repeat(64));
r = await activate(unused.code, S_A2);
check('unused signed code activates after rejected course rename', r.ok && hasCourse(r.data.student, S_A2), JSON.stringify(r.data).slice(0, 180));
r = await activate(used.code, S_A1);
check('used signed code retries after rejected course rename', r.ok && hasCourse(r.data.student, S_A1), JSON.stringify(r.data).slice(0, 180));
r = await activate('LAB-TEST-2345-ABCE', S_A2);
check('tampered code still rejected after rename', !r.ok && r.data.code === 'INVALID_CODE', JSON.stringify(r.data));
const untouched = (await list(otherOpts)).find(c => c.code === unrelated.code);
check('other teacher code is unchanged', untouched?.sectionCode === S_B1 && untouched?.codeSignature === unrelated.codeSignature);
const assigned = await issue(S_A1, teacherOpts, { assignedStudentId: '1002', isFreeCode: true });
r = await api('POST', '/api/teacher/join-codes/reissue', { oldCode: assigned.code }, teacherOpts);
const replacement = r.data.joinCode;
check('unused replacement retains student and free-code designation', r.ok && replacement?.assignedStudentId === '1002' && replacement?.assignedStudentName === assigned.assignedStudentName && replacement?.isFreeCode === true);
r = await api('POST', '/api/auth/verify-otp', { idNumber: '7007', otp: replacement.code, password: 'GoodPass9', deviceToken: 'wrong-assignee' }, { deviceToken: 'wrong-assignee' });
check('another roster student cannot activate replacement', !r.ok && r.data.code === 'CODE_ASSIGNED_TO_OTHER', JSON.stringify(r.data));
r = await api('POST', '/api/auth/verify-otp', { idNumber: '1002', otp: replacement.code, password: 'GoodPass9', deviceToken: 'correct-assignee' }, { deviceToken: 'correct-assignee' });
check('assigned student can activate replacement', r.ok && r.data.success, JSON.stringify(r.data).slice(0, 180));
r = await api('POST', '/api/teacher/join-codes/reissue', { oldCode: used.code }, teacherOpts);
check('used replacement retains its student and device', r.ok && r.data.joinCode?.status === 'used' && r.data.joinCode?.studentId === '1001' && r.data.joinCode?.activationDeviceToken === 'tok-1001');
const revoked = await issue(S_A2, teacherOpts);
await api('POST', '/api/teacher/join-codes/update', { code: revoked.code, status: 'revoked' }, teacherOpts);
const snapshot = (await list()).filter(c => [used.code, unused.code, revoked.code].includes(c.code));
r = await api('POST', '/api/teacher/miras-import', { preserveOwners: '1', payload: { joinCodesList: [used, unused, revoked] } }, adminOpts);
check('old backup import succeeds', r.ok, JSON.stringify(r.data).slice(0, 180));
rows = await list();
check('import preserves current use, revocation, signatures and device bindings', snapshot.every(c => JSON.stringify(rows.find(x => x.code === c.code)) === JSON.stringify(c)));
r = await activate(revoked.code, S_A2);
check('old backup does not reactivate a revoked code', !r.ok && r.data.code === 'CODE_REVOKED', JSON.stringify(r.data));
done();
