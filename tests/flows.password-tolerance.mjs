// Students were "suddenly" signed out (the session expired 14 days after login
// with no renewal) and then their correct password was rejected, because the
// sign-up field had stored it with converted digits / a trailing space while
// login compared the raw typed text. This guards all three halves of the fix:
// equivalent passwords sign in, active sessions renew silently, and
// "forgot password" tells the student to contact the course teacher.
import crypto from 'node:crypto';
import { api, BASE, UA, createReporter } from './lib.mjs';
const { check, done } = createReporter('FLOWS / PASSWORD TOLERANCE + SESSION RENEWAL');
const login = (idNumber, password, tok) =>
  api('POST', '/api/auth/login', { idNumber, password, deviceToken: tok }, { deviceToken: tok });

// 1) Accounts stored by the old code sign in with what the student types.
let r = await login('1001', 'pass١٠٠١', 'tok-1001');
check('Arabic-keyboard digits match a password stored with Western digits + trailing space', r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data)}`);
r = await login('1001', 'pass1001', 'tok-1001');
check('Western digits match the same stored password', r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data)}`);
r = await login('1001', 'pass1001 ', 'tok-1001');
check('typing the same trailing space also works (login used to trim it away)', r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data)}`);
r = await login('2002', 'a,b2002', 'tok-2002');
check('a typed comma matches a password the sign-up field stored with a dot', r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data)}`);

// 2) Wrong passwords are still rejected.
r = await login('1001', 'pass1002', 'tok-1001');
check('a genuinely wrong password is still rejected', r.status === 401, `${r.status}`);
r = await login('1001', 'PASS1001', 'tok-1001');
check('case still matters', r.status === 401, `${r.status}`);

// 3) A long-running session is renewed silently on a normal student request.
const secret = 'flow-test-session-secret';
const forge = (issuedAt, deviceTok) => {
  const payload = Buffer.from(JSON.stringify({
    role: 'student', userId: '1001', email: '1001@paaet.edu.kw',
    deviceTokenHash: crypto.createHash('sha256').update(deviceTok).digest('hex'),
    issuedAt, expiresAt: issuedAt + 14 * 86400000,
  })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
const call = (token, tok) => fetch(`${BASE}/api/live/student-state?studentId=1001`, {
  headers: { 'user-agent': UA, 'x-miras-device-id': tok, authorization: `Bearer ${token}` },
});
const oldToken = forge(Date.now() - 13 * 86400000, 'tok-1001');
let res = await call(oldToken, 'tok-1001');
const renewed = res.headers.get('x-miras-session-renewed') || '';
check('a 13-day-old session is accepted', res.ok, `${res.status}`);
check('…and the server returns a renewed session token', !!renewed && renewed !== oldToken, renewed.slice(0, 20));
const renewedPayload = renewed ? JSON.parse(Buffer.from(renewed.split('.')[0], 'base64url').toString()) : {};
check('the renewed session keeps the same student and device binding', renewedPayload.userId === '1001' && renewedPayload.deviceTokenHash === crypto.createHash('sha256').update('tok-1001').digest('hex'), JSON.stringify(renewedPayload));
check('the renewed session lasts another 14 days', renewedPayload.expiresAt - Date.now() > 13.9 * 86400000, String(renewedPayload.expiresAt));
res = await call(renewed, 'tok-1001');
check('the renewed token works', res.ok, `${res.status}`);
check('a fresh session is not renewed again', !res.headers.get('x-miras-session-renewed'), 'renewed twice');
res = await call(forge(Date.now() - 13 * 86400000, 'tok-1001'), 'tok-other-browser');
check('a session presented from another browser is not renewed', !res.headers.get('x-miras-session-renewed'), `${res.status}`);

// 4) Forgot password: a clear instruction instead of a bare "تم".
r = await api('POST', '/api/auth/forgot-password', { idNumber: '1001' });
check('forgot-password asks the student to contact the course teacher', r.ok && /التواصل مع أستاذ المقرر/.test(r.data.message || ''), JSON.stringify(r.data));
done();
