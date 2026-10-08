// Enrolling a passkey grants future logins, so only the signed-in owner of the
// account may start it. A request without that account's session is refused.
import { api, makeJar, createReporter, AA, BB } from './lib.mjs';
const { check, done } = createReporter('FLOWS / PASSKEY ENROLL');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const seeded = (id) => ({ idNumber: id, password: `pass${id}` });
const start = (body, o = { jar: makeJar(), deviceToken: 'anon-pk' }) => api('POST', '/api/auth/passkey/register/start', body, o);

const s1001 = { jar: makeJar(), deviceToken: 'tok-1001' };
const s2002 = { jar: makeJar(), deviceToken: 'tok-2002' };
const tAA = { jar: makeJar(), deviceToken: 'pk-aa' };
const tBB = { jar: makeJar(), deviceToken: 'pk-bb' };
const admin = { jar: makeJar(), deviceToken: 'pk-admin' };
check('student 1001 login', (await api('POST', '/api/auth/login', seeded('1001'), s1001)).ok);
check('student 2002 login', (await api('POST', '/api/auth/login', seeded('2002'), s2002)).ok);
check('teacher AA login', (await api('POST', '/api/auth/login', { idNumber: AA, password: pw }, tAA)).ok);
check('teacher BB login', (await api('POST', '/api/auth/login', { idNumber: BB, password: pw }, tBB)).ok);
check('admin login', (await api('POST', '/api/auth/login', { idNumber: 'ah.alfailakawi@paaet.edu.kw', password: pw }, admin)).ok);

// Refused: no session, another student's session, a teacher session for a student.
let r = await start({ role: 'student', userId: '1001' });
check('student enroll without a session is refused', r.status === 401 && !r.data?.options, `${r.status}`);
r = await start({ role: 'student', userId: '1001' }, s2002);
check("student enroll with another student's session is refused", r.status === 401 && !r.data?.options, `${r.status}`);
r = await start({ role: 'student', userId: '1001' }, tAA);
check('student enroll with a teacher session is refused', r.status === 401 && !r.data?.options, `${r.status}`);
// Refused for teacher accounts too.
r = await start({ role: 'teacher', userId: AA });
check('teacher enroll without a session is refused', r.status === 401 && !r.data?.options, `${r.status}`);
r = await start({ role: 'teacher', userId: AA }, tBB);
check("teacher enroll with another teacher's session is refused", r.status === 401 && !r.data?.options, `${r.status}`);
r = await start({ role: 'teacher', userId: 'ah.alfailakawi@paaet.edu.kw' }, tAA);
check('admin enroll with a regular teacher session is refused', r.status === 401 && !r.data?.options, `${r.status}`);

// Allowed: each owner with their own session.
r = await start({ role: 'student', userId: '1001' }, s1001);
check('student enrolls with their own session', r.ok && !!r.data?.options?.challenge, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
r = await start({ role: 'teacher', userId: AA }, tAA);
check('teacher enrolls with their own session', r.ok && !!r.data?.options?.challenge, `${r.status}`);
r = await start({ role: 'teacher', userId: 'AA@test.kw' }, tAA);
check('teacher email case does not matter', r.ok && !!r.data?.options?.challenge, `${r.status}`);
r = await start({ role: 'teacher', userId: 'ah.alfailakawi@paaet.edu.kw' }, admin);
check('super admin enrolls with their own session', r.ok && !!r.data?.options?.challenge, `${r.status}`);
r = await start({ role: 'student', userId: 'nobody-here' }, s1001);
check('unknown account still reports not found', r.status === 404, `${r.status}`);
done();
