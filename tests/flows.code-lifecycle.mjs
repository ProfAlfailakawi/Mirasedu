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
const unused = await issue(S_A2, teacherOpts);
const used = await issue(S_A1, teacherOpts);
const unrelated = await issue(S_B1, otherOpts);
let r = await activate(used.code, S_A1);
check('activate before renaming', r.ok && r.data.success, JSON.stringify(r.data).slice(0, 180));
for (const [oldCode, newCode] of [[S_A2, '224'], [S_A1, '114']]) {
  r = await api('PUT', `/api/teacher/sections/${encodeURIComponent(oldCode)}`, { code: newCode, courseName: 'مقرر بعد تغيير الرقم' }, teacherOpts);
  check('rename course number', r.ok, JSON.stringify(r.data));
}
let rows = await list();
check('unused code re-signed after renaming', validSignature(rows.find(c => c.code === unused.code)));
check('used code and locked course migrated together', validSignature(rows.find(c => c.code === used.code)) && rows.find(c => c.code === used.code)?.resolvedCourseCode === `114-${AA}`);
check('retired signed code migrated without becoming active', validSignature(rows.find(c => c.code === 'LAB-TEST-2345-ABCD')) && rows.find(c => c.code === 'LAB-TEST-2345-ABCD')?.status === 'retired');
check('invalid original signature is not repaired', rows.find(c => c.code === 'LAB-TEST-2345-ABCE')?.codeSignature === 'a'.repeat(64));
r = await activate(unused.code, `224-${AA}`);
check('unused signed code activates after course rename', r.ok && hasCourse(r.data.student, `224-${AA}`), JSON.stringify(r.data).slice(0, 180));
r = await activate(used.code, `114-${AA}`);
check('used signed code retries after course rename', r.ok && hasCourse(r.data.student, `114-${AA}`), JSON.stringify(r.data).slice(0, 180));
r = await activate('LAB-TEST-2345-ABCE', `224-${AA}`);
check('tampered code still rejected after rename', !r.ok && r.data.code === 'INVALID_CODE', JSON.stringify(r.data));
const untouched = (await list(otherOpts)).find(c => c.code === unrelated.code);
check('other teacher code is unchanged', untouched?.sectionCode === S_B1 && untouched?.codeSignature === unrelated.codeSignature);
const assigned = await issue(`114-${AA}`, teacherOpts, { assignedStudentId: '1002', isFreeCode: true });
r = await api('POST', '/api/teacher/join-codes/reissue', { oldCode: assigned.code }, teacherOpts);
const replacement = r.data.joinCode;
check('unused replacement retains student and free-code designation', r.ok && replacement?.assignedStudentId === '1002' && replacement?.assignedStudentName === assigned.assignedStudentName && replacement?.isFreeCode === true);
r = await api('POST', '/api/auth/verify-otp', { idNumber: '7007', otp: replacement.code, password: 'GoodPass9', deviceToken: 'wrong-assignee' }, { deviceToken: 'wrong-assignee' });
check('another roster student cannot activate replacement', !r.ok && r.data.code === 'CODE_ASSIGNED_TO_OTHER', JSON.stringify(r.data));
r = await api('POST', '/api/auth/verify-otp', { idNumber: '1002', otp: replacement.code, password: 'GoodPass9', deviceToken: 'correct-assignee' }, { deviceToken: 'correct-assignee' });
check('assigned student can activate replacement', r.ok && r.data.success, JSON.stringify(r.data).slice(0, 180));
r = await api('POST', '/api/teacher/join-codes/reissue', { oldCode: used.code }, teacherOpts);
check('used replacement retains its student and device', r.ok && r.data.joinCode?.status === 'used' && r.data.joinCode?.studentId === '1001' && r.data.joinCode?.activationDeviceToken === 'tok-1001');
const revoked = await issue(`224-${AA}`, teacherOpts);
await api('POST', '/api/teacher/join-codes/update', { code: revoked.code, status: 'revoked' }, teacherOpts);
const snapshot = (await list()).filter(c => [used.code, unused.code, revoked.code].includes(c.code));
r = await api('POST', '/api/teacher/miras-import', { preserveOwners: '1', payload: { joinCodesList: [used, unused, revoked] } }, adminOpts);
check('old backup import succeeds', r.ok, JSON.stringify(r.data).slice(0, 180));
rows = await list();
check('import preserves current use, revocation, signatures and device bindings', snapshot.every(c => JSON.stringify(rows.find(x => x.code === c.code)) === JSON.stringify(c)));
r = await activate(revoked.code, `224-${AA}`);
check('old backup does not reactivate a revoked code', !r.ok && r.data.code === 'CODE_REVOKED', JSON.stringify(r.data));
done();
