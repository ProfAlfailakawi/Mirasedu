// ID-first login: the student types only their university number and is routed
// by the server — to the password step if they have an account, to sign-up if
// they are on a roster without one, or told to contact their teacher otherwise.
import { api, createReporter } from './lib.mjs';
const { check, done } = createReporter('FLOWS / LOGIN IDENTIFY');
const id = (v) => api('GET', `/api/auth/identify/${encodeURIComponent(v)}`);

const existing = await id('1001');
check('a student with an account goes to the password step', existing.ok && existing.data.status === 'account', JSON.stringify(existing.data));
check('the greeting uses the first name only', existing.data.firstName === 'طالب', JSON.stringify(existing.data.firstName));

const rosterOnly = await id('1002');
check('a rostered student without an account goes to sign-up', rosterOnly.ok && rosterOnly.data.status === 'signup', JSON.stringify(rosterOnly.data));

const missing = await id('9999');
check('a number on no roster is told to contact the teacher', missing.status === 404 && missing.data.status === 'missing' && /أستاذ المادة/.test(missing.data.error || ''), `${missing.status} ${JSON.stringify(missing.data)}`);

const tooShort = await id('12');
check('a number that is too short is rejected', tooShort.status === 400, `${tooShort.status}`);

const teacherPhone = await id('96550001234');
check('a teacher signing in by phone goes to the password step, not "missing"', teacherPhone.ok && teacherPhone.data.status === 'account' && teacherPhone.data.firstName === '', JSON.stringify(teacherPhone.data));

// The account status matches what login itself accepts: the same number logs in.
const login = await api('POST', '/api/auth/login', { idNumber: '1001', password: 'pass1001', deviceToken: 'tok-1001' }, { deviceToken: 'tok-1001' });
check('the number identify calls "account" logs in with its password', login.ok && login.data.success === true, `${login.status}`);
done();
