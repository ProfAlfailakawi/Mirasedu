// «تحقق» on a look-alike spelling of a code that survives only on a student's
// record still finds it, like the exact spelling does.
import { randomUUID } from 'node:crypto';
import { api, makeJar, createReporter } from './lib.mjs';
const { check, done } = createReporter('FLOWS / CODE CHECK ORPHAN LOOK-ALIKE');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const admin = { jar: makeJar(), deviceToken: 'orphan-admin' };
check('admin login', (await api('POST', '/api/auth/login', { idNumber: 'ah.alfailakawi@paaet.edu.kw', password: pw }, admin)).ok);
const exact = await api('POST', '/api/teacher/code-scan', { code: 'LAB-ZQQQ-QQQQ-QQQQ' }, admin);
check('exact spelling finds the code on the student record', exact.ok && String(exact.data?.studentId) === '1001', JSON.stringify(exact.data).slice(0, 140));
const typed = await api('POST', '/api/teacher/code-scan', { code: 'LAB-2QQQ-QQQQ-QQQQ' }, admin);
check('look-alike spelling finds the same code', typed.ok && typed.data?.code === 'LAB-ZQQQ-QQQQ-QQQQ' && String(typed.data?.studentId) === '1001', `${typed.status} ${JSON.stringify(typed.data).slice(0, 140)}`);

// An orphan code held by a student enrolled with TWO teachers has no single
// owner: the attempts-log «قريب من» hint may use it only in admin scope=all,
// never in a request scoped to one of those teachers.
const compact = (v) => String(v || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const chosen = `N${randomUUID().replace(/-/g, '')}`;
const rejected = await api('POST', '/api/auth/verify-otp', { idNumber: '1002', otp: 'LAB-QQ5Q-QQQQ-QQQQ', password: chosen, deviceToken: 'tok-orphan-multi' }, { deviceToken: 'tok-orphan-multi' });
check('misread spelling of the multi-teacher orphan code is rejected', !rejected.ok, `${rejected.status}`);
const logAll = (await api('GET', '/api/teacher/activation-attempts?scope=all', null, admin)).data;
const logged = (logAll?.attempts || []).find((a) => compact(a.normalizedCode || a.code) === 'LABQQ5QQQQQQQQQ');
check('admin scope=all annotates it with the orphan code', compact(logged?.lookalikeResolvedCode) === 'LABQQSQQQQQQQQQ', JSON.stringify(logged?.lookalikeResolvedCode || ''));
for (const scoped of ['aa@test.kw', 'bb@test.kw']) {
  const logScoped = (await api('GET', `/api/teacher/activation-attempts?scope=${scoped}`, null, admin)).data;
  const leaked = (logScoped?.attempts || []).some((a) => compact(a.lookalikeResolvedCode) === 'LABQQSQQQQQQQQQ');
  check(`a request scoped to ${scoped} never reveals the ambiguous orphan code`, !leaked, JSON.stringify((logScoped?.attempts || []).map((a) => a.lookalikeResolvedCode).filter(Boolean)));
}

// A code the ADMIN issued for teacher A's course carries the admin's
// ownerEmail, but it is that course's code: a request scoped to teacher A must
// still use it for the hint, while a scope of another teacher must not.
const rejected2 = await api('POST', '/api/auth/verify-otp', { idNumber: '2002', otp: 'LAB-6QNQ-QQQQ-QQQQ', sectionCode: '111-aa@test.kw', password: chosen, deviceToken: 'tok-orphan-admincode' }, { deviceToken: 'tok-orphan-admincode' });
check('misread spelling of the admin-issued course code is rejected', !rejected2.ok, `${rejected2.status}`);
const logA = (await api('GET', '/api/teacher/activation-attempts?scope=aa@test.kw', null, admin)).data;
const loggedA = (logA?.attempts || []).find((a) => compact(a.normalizedCode || a.code) === 'LAB6QNQQQQQQQQQ');
check("teacher A's scope lists the attempt and annotates it with the course's code", compact(loggedA?.lookalikeResolvedCode) === 'LABGQNQQQQQQQQQ', JSON.stringify({ listed: !!loggedA, got: loggedA?.lookalikeResolvedCode || '' }));
const logB = (await api('GET', '/api/teacher/activation-attempts?scope=bb@test.kw', null, admin)).data;
const leakedB = (logB?.attempts || []).some((a) => compact(a.lookalikeResolvedCode) === 'LABGQNQQQQQQQQQ');
check("teacher B's scope never reveals teacher A's course code", !leakedB, JSON.stringify((logB?.attempts || []).map((a) => a.lookalikeResolvedCode).filter(Boolean)));
done();
