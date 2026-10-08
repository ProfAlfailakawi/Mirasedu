// Device transfer (and other student :id actions) must find a student even when
// the stored id is a JSON number or carries Arabic-Indic digits, not only an
// exact string. This reproduced the "لا يوجد طالب" error the super admin hit.
import { api, makeJar, createReporter } from './lib.mjs';
const { check, done } = createReporter('FLOWS / DEVICE TRANSFER LOOKUP');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const admin = { jar: makeJar(), deviceToken: 'dtl-admin' };
check('admin login', (await api('POST', '/api/auth/login', { idNumber: 'ah.alfailakawi@paaet.edu.kw', password: pw }, admin)).ok);

// The route param is the western-digit string the UI shows; the stored records
// hold a number and Arabic-Indic digits respectively.
for (const [id, note] of [['305022200043', 'stored as a number'], ['305022200044', 'stored as Arabic-Indic digits']]) {
  const r = await api('POST', `/api/teacher/students/${encodeURIComponent(id)}/reset-access`, { teacherEmail: 'ah.alfailakawi@paaet.edu.kw', mode: 'reset_device' }, admin);
  check(`device transfer finds student (${note})`, r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0,140)}`);
}
const missing = await api('POST', '/api/teacher/students/999999999/reset-access', { teacherEmail: 'ah.alfailakawi@paaet.edu.kw', mode: 'reset_device' }, admin);
check('a genuinely unknown student still reports not found', missing.status === 404, `${missing.status}`);
done();
