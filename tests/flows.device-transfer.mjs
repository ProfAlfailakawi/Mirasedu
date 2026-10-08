// Device transfer is critical — verify it end to end and in every scenario,
// using the seeded activated students. Modes: reset_device, hold, restore.
// The super admin (whom the owner uses) drives the end-to-end switch; teacher
// authorization is checked against a managing and a non-managing teacher.
import { api, makeJar, createReporter, AA, BB } from './lib.mjs';
const { check, done } = createReporter('FLOWS / DEVICE TRANSFER');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const ADMIN = 'ah.alfailakawi@paaet.edu.kw';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const brief = (o) => JSON.stringify(o ?? null).slice(0, 160);

const bb = { jar: makeJar(), deviceToken: 't-bb' };
const admin = { jar: makeJar(), deviceToken: 't-admin' };
check('teacher BB login', (await api('POST', '/api/auth/login', { idNumber: BB, password: pw }, bb)).ok);
check('admin login', (await api('POST', '/api/auth/login', { idNumber: ADMIN, password: pw }, admin)).ok);
const reset = (id, mode, o) => api('POST', `/api/teacher/students/${encodeURIComponent(id)}/reset-access`, { mode }, o);
const login = (id, p, token, ua) => api('POST', '/api/auth/login', { idNumber: id, password: p }, { deviceToken: token, ua });

// --- Authorization ---
// Student 2002 is only in AA's course, so BB (who does not manage it) is refused.
const refused = await reset('2002', 'reset_device', bb);
check('AUTHZ: a teacher who does not manage the student is refused (403)', refused.status === 403, `${refused.status}`);
const rAnon = await api('POST', '/api/teacher/students/1001/reset-access', { mode: 'reset_device' }, { jar: makeJar(), deviceToken: 'anon' });
check('AUTHZ: no teacher session is refused (401/403)', rAnon.status === 401 || rAnon.status === 403, `${rAnon.status}`);
const rUnknown = await reset('999999999', 'reset_device', admin);
check('AUTHZ: an unknown student returns not found (404)', rUnknown.status === 404, `${rUnknown.status}`);
// The super admin is never scope-limited (this is the account the owner uses).
check('AUTHZ: super admin may transfer a student in any course', (await reset('2002', 'restore', admin)).ok);

// --- Lookup by the id formats the UI may send (the "لا يوجد طالب" report) ---
for (const [id, note] of [['1001', 'plain'], ['١٠٠١', 'Arabic-Indic digits'], [' 1001', 'with whitespace']]) {
  const g = await api('GET', `/api/students/${encodeURIComponent(id)}`, null, admin);
  check(`LOOKUP: student found by id (${note})`, g.status === 200 && String(g.data?.student?.id) === '1001', `${g.status} ${g.data?.student?.id}`);
}

// --- End-to-end device switch driven by the super admin, on student 2002 ---
check('E2E: original device logs in before transfer', (await login('2002', 'pass2002', 'tok-2002', SAFARI)).ok);
check('E2E: a different device is blocked before transfer', !(await login('2002', 'pass2002', 'tok-new2002', CHROME)).ok);
const did = await reset('2002', 'reset_device', admin);
check('E2E: admin transfers the device (200)', did.ok && did.data?.success === true, brief(did.data));
check('E2E: student is pending-transfer with devices cleared', did.data?.student?.pendingDeviceTransfer === true && Array.isArray(did.data?.student?.devices) && did.data.student.devices.length === 0, brief(did.data?.student));
const newDev = await login('2002', 'pass2002', 'tok-new2002', CHROME);
check('E2E: the new device logs in after the transfer', newDev.ok && newDev.data?.success === true, brief(newDev.data));
const oldDev = await login('2002', 'pass2002', 'tok-2002', SAFARI);
check('E2E: the old device is rejected after the new one is adopted', !oldDev.ok, `${oldDev.status} ${brief(oldDev.data)}`);

// --- hold / restore driven by the super admin, on registered student 3003 ---
const held = await reset('3003', 'hold', admin);
check('HOLD: account marked blocked', held.ok && held.data?.student?.isAccessBlocked === true, brief(held.data?.student));
check('HOLD: student cannot log in while held', !(await login('3003', 'pass3003', 'tok-3003', SAFARI)).ok);
const restored = await reset('3003', 'restore', admin);
check('RESTORE: account re-enabled', restored.ok && restored.data?.student?.isAccessBlocked === false, brief(restored.data?.student));
check('RESTORE: student can log in again after restore', (await login('3003', 'pass3003', 'tok-3003-new', SAFARI)).ok);
done();
