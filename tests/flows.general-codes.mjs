import { api, makeJar, createReporter, S_A1, S_A2, hasCourse } from './lib.mjs';
const { check, done } = createReporter('GENERAL CODE RESET RECOVERY');
const admin = makeJar();
await api('POST', '/api/auth/login', {
  idNumber: 'ah.alfailakawi@paaet.edu.kw', password: process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci',
}, { jar: admin, deviceToken: 'general-admin' });
const jar = makeJar();
await api('POST', '/api/auth/login', { idNumber: '1001', password: 'pass1001' }, { jar, deviceToken: 'tok-1001' });
const activate = (code, courseCode = S_A2) => api('POST', '/api/students/1001/activate-course',
  { code, courseCode, deviceToken: 'tok-1001' }, { jar, deviceToken: 'tok-1001' });
let r = await activate('LAB-TEST-2345-6789');
check('signed unused general code retired by reset activates', r.ok && r.data.success && hasCourse(r.data.student, S_A2), JSON.stringify(r.data));
r = await activate('LAB-TEST-2345-6789');
check('same-device retry after recovery works', r.ok && hasCourse(r.data.student, S_A2), JSON.stringify(r.data));
r = await activate('LAB-TEST-2345-6789', S_A1);
check('recovered code cannot activate a second course', !r.ok && r.data.code === 'CODE_COURSE_MISMATCH', JSON.stringify(r.data));
r = await activate('LAB-TEST-2345-6789', '222-bb@test.kw');
check('same course number owned by another teacher stays rejected', !r.ok && r.data.code === 'CODE_COURSE_MISMATCH', JSON.stringify(r.data));
// A second student's first activation also works with the custom-reset archive.
r = await api('POST', '/api/auth/verify-otp', {
  idNumber: '1002', password: 'GoodPass9', email: '1002@paaet.edu.kw',
  otp: 'LAB-TEST-2345-678A', deviceToken: 'general-1002',
}, { deviceToken: 'general-1002' });
check('custom-reset inventory supports first account activation', r.ok && r.data.success && hasCourse(r.data.student, S_A1), JSON.stringify(r.data));
r = await api('GET', '/api/teacher/join-codes', null, { jar: admin, deviceToken: 'general-admin' });
const before = r.data.joinCodes || [];
check('recovered code persisted once as used', before.filter(c => c.code === 'LAB-TEST-2345-6789').length === 1 && before.find(c => c.code === 'LAB-TEST-2345-6789')?.status === 'used');
// Fresh device for each rejection prevents device/session rate limits masking failures.
for (const [suffix, label] of [['B','used'], ['C','revoked'], ['D','manually deleted'], ['E','course-specific'], ['F','assigned'], ['G','bad signature'], ['H','current revocation overrides archive']]) {
  const deviceToken = `reject-${suffix}`;
  r = await api('POST', '/api/students/join-lab', { studentId: '7007', joinCode: `LAB-TEST-2345-678${suffix}`, deviceToken }, { deviceToken });
  check(`${label} stays rejected`, !r.ok && ['INVALID_CODE','CODE_REVOKED'].includes(r.data.code), JSON.stringify(r.data));
}
r = await api('POST', '/api/teacher/join-codes/create', { generalSale: true, count: 1 }, { jar: admin, deviceToken: 'general-admin' });
check('new general code generated', r.ok, JSON.stringify(r.data));
r = await api('GET', '/api/teacher/join-codes', null, { jar: admin, deviceToken: 'general-admin' });
const inventory = (r.data.joinCodes || []).find(c => c.status === 'active' && c.sectionCode === 'all');
check('new general inventory exists', !!inventory);
r = await api('POST', '/api/teacher/database/full-reset', {}, { jar: admin, deviceToken: 'general-admin' });
check('full reset succeeds', r.ok, JSON.stringify(r.data));
r = await api('GET', '/api/teacher/join-codes', null, { jar: admin, deviceToken: 'general-admin' });
check('full reset preserves unused general inventory', r.ok && (r.data.joinCodes || []).some(c => c.code === inventory?.code && c.status === 'active'), JSON.stringify(r.data).slice(0, 180));
check('full reset removes consumed recovered code from active inventory', !(r.data.joinCodes || []).some(c => c.code === 'LAB-TEST-2345-6789'));
done();
