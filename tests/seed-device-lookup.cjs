// Builds on the base seed, then adds two registered students whose stored id is
// not a plain western-digit string: one a JSON number, one Arabic-Indic digits.
// This reproduces the device-transfer "لا يوجد طالب" lookup miss.
require('./seed.cjs');
const fs = require('node:fs');
const path = require('node:path');
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const now = new Date().toISOString();
const base = (id) => ({
  id, name: `طالب ${id}`, email: `${String(id)}@paaet.edu.kw`,
  semester: 'الفصل الأول 2026', isPaid: true, isActivated: true,
  devices: ['dev-old'], signupDate: now, lastLoginDate: now,
  enrollments: [], activatedCourseCodes: [],
});
db.students = db.students || [];
// Stored as a JSON number (not a string) — the old strict s.id === "..." missed it.
db.students.push({ ...base(305022200043) });
// Stored with Arabic-Indic digits — a western-digit route param missed it.
db.students.push({ ...base('٣٠٥٠٢٢٢٠٠٠٤٤') });
fs.writeFileSync(dbPath, JSON.stringify(db));
