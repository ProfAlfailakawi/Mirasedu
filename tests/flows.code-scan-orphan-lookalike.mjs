// «تحقق» on a look-alike spelling of a code that survives only on a student's
// record still finds it, like the exact spelling does.
import { api, makeJar, createReporter } from './lib.mjs';
const { check, done } = createReporter('FLOWS / CODE CHECK ORPHAN LOOK-ALIKE');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const admin = { jar: makeJar(), deviceToken: 'orphan-admin' };
check('admin login', (await api('POST', '/api/auth/login', { idNumber: 'ah.alfailakawi@paaet.edu.kw', password: pw }, admin)).ok);
const exact = await api('POST', '/api/teacher/code-scan', { code: 'LAB-ZQQQ-QQQQ-QQQQ' }, admin);
check('exact spelling finds the code on the student record', exact.ok && String(exact.data?.studentId) === '1001', JSON.stringify(exact.data).slice(0, 140));
const typed = await api('POST', '/api/teacher/code-scan', { code: 'LAB-2QQQ-QQQQ-QQQQ' }, admin);
check('look-alike spelling finds the same code', typed.ok && typed.data?.code === 'LAB-ZQQQ-QQQQ-QQQQ' && String(typed.data?.studentId) === '1001', `${typed.status} ${JSON.stringify(typed.data).slice(0, 140)}`);
done();
