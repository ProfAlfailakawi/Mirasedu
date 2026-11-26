// Regression: a student who was locked out by failed logins (the usual reason
// to ask for a reset) must be able to log in with the NEW password right after
// a successful reset. Before the fix the per-(IP + identity) login lockout
// survived the reset, so the correct new password still got 429 for up to 10
// minutes ("changed the password but still cannot log in").
import { api, makeJar, createReporter, AA } from './lib.mjs';
const { check, done } = createReporter('FLOWS / PASSWORD RESET CLEARS LOGIN LOCKOUT');

const DEVICE = 'tok-1001';
const lockOut = async (identity) => {
  let last;
  for (let i = 0; i < 9; i++) {
    last = await api('POST', '/api/auth/login', { idNumber: identity, password: `wrong-${i}-pass` }, { deviceToken: DEVICE });
  }
  return last;
};

// 1) Self-service reset link (same activation device).
let r = await lockOut('1001');
check('repeated wrong passwords lock the student login (429)', r.status === 429, JSON.stringify(r.data));

const owner = makeJar();
r = await api('POST', '/api/auth/login', { idNumber: AA, password: process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci' }, { deviceToken: `lockout-${AA}`, jar: owner });
check('teacher login', r.ok, JSON.stringify(r.data));

r = await api('POST', '/api/auth/forgot-password', { idNumber: '1001' });
check('student requests a reset link', r.ok, JSON.stringify(r.data));
let list = await api('GET', '/api/teacher/password-reset-requests', undefined, { jar: owner });
let request = (list.data.requests || []).find((x) => x.studentId === '1001' && x.status === 'new');
check('teacher sees the reset request', !!request, JSON.stringify(list.data).slice(0, 200));
if (request) {
  const token = new URL(request.resetLink).searchParams.get('resetToken');
  r = await api('POST', '/api/auth/reset-password', { token, newPassword: 'ResetPass771' }, { deviceToken: DEVICE });
  check('reset link sets the new password', r.ok, JSON.stringify(r.data));
  r = await api('POST', '/api/auth/login', { idNumber: '1001', password: 'ResetPass771' }, { deviceToken: DEVICE });
  check('new password logs in immediately after reset (no leftover lockout)', r.ok && r.data?.role === 'student', `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
}

// 2) Lockout typed with Arabic-Indic digits is the same student and is cleared too.
r = await lockOut('١٠٠١');
check('lockout under Arabic-digit identity', r.status === 429, JSON.stringify(r.data));

// 3) Teacher sets a new password manually from the reset-requests panel.
r = await api('POST', '/api/auth/forgot-password', { idNumber: '1001' });
list = await api('GET', '/api/teacher/password-reset-requests', undefined, { jar: owner });
request = (list.data.requests || []).find((x) => x.studentId === '1001' && x.status === 'new');
check('second reset request visible', !!request, JSON.stringify(list.data).slice(0, 200));
if (request) {
  r = await api('POST', `/api/teacher/password-reset-requests/${request.id}/manual-password`, { newPassword: 'ManualPass772' }, { jar: owner });
  check('teacher manual password saved', r.ok, JSON.stringify(r.data));
  r = await api('POST', '/api/auth/login', { idNumber: '١٠٠١', password: 'ManualPass772' }, { deviceToken: DEVICE });
  check('manually set password logs in immediately (Arabic-digit identity)', r.ok && r.data?.role === 'student', `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
}

// 4) Unchanged behavior: an unrelated locked identity stays locked, and the
// old password no longer works.
r = await lockOut('1002');
check('another student lockout still applies', r.status === 429, JSON.stringify(r.data));
r = await api('POST', '/api/auth/login', { idNumber: '1001', password: 'pass1001' }, { deviceToken: DEVICE });
check('old password is rejected after reset', !r.ok && r.status === 401, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
done();
