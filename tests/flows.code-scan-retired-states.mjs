// «تحقق» on archived unused codes: any teacher-removed code reads «ملغي»,
// whatever (or whether) a retirement reason was recorded; only codes archived
// with their course (deletion/reset) read «لم يُستخدم».
import { api, makeJar, createReporter } from './lib.mjs';
const { check, done } = createReporter('FLOWS / CODE CHECK RETIRED STATES');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const admin = { jar: makeJar(), deviceToken: 'retired-admin' };
check('admin login', (await api('POST', '/api/auth/login', { idNumber: 'ah.alfailakawi@paaet.edu.kw', password: pw }, admin)).ok);
const expect = [
  ['LAB-ZQNR-QQQQ-QQQ2', 'ملغي', 'no recorded reason (legacy record)'],
  ['LAB-ZQNR-QQQQ-QQQ5', 'ملغي', 'unknown reason'],
  ['LAB-ZQNR-QQQQ-QQQ8', 'ملغي', 'teacher delete'],
  ['LAB-ZQNR-QQQQ-QQQG', 'لم يُستخدم', 'course deleted'],
  ['LAB-ZQNR-QQQQ-QQGG', 'لم يُستخدم', 'full reset'],
];
for (const [code, want, label] of expect) {
  const r = (await api('POST', '/api/teacher/code-scan', { code }, admin)).data;
  check(`«تحقق» ${label} -> «${want}»`, r?.state === want, JSON.stringify({ state: r?.state, code: r?.code }));
}
// The legacy record still carries its student in the result.
const legacy = (await api('POST', '/api/teacher/code-scan', { code: 'LAB-ZQNR-QQQQ-QQQ2' }, admin)).data;
check('legacy record keeps its student', String(legacy?.studentId) === '1001', JSON.stringify(legacy).slice(0, 120));
done();
