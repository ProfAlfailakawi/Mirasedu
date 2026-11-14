// The standard seed, with scrypt password hashes for the accounts the account
// deletion request flow re-authenticates (the route verifies scrypt only, like the
// other new password routes):
//   students 1001 / 2002  — the seed's pass<id> convention
//   teachers aa@test.kw and the super admin — TEST_TEACHER_PASSWORD
require('./seed.cjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'db.json');
const scryptRaw = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};
const TPW = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
db.students.find((s) => s.id === '1001').passwordHash = scryptRaw('pass' + '1001');
db.students.find((s) => s.id === '2002').passwordHash = scryptRaw('pass' + '2002');
for (const email of ['aa@test.kw', 'ah.alfailakawi@paaet.edu.kw']) {
  db.teachers.find((t) => t.email === email).passwordHash = scryptRaw(TPW);
}
fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf-8');
