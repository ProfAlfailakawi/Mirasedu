// The standard seed, plus a phone number on teacher A: teachers may sign in
// with their phone digits, so the ID-first login must not mistake them for a
// student who is missing from every roster.
require('./seed.cjs');
const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const teacher = db.teachers.find((t) => String(t.email).toLowerCase() === 'aa@test.kw');
teacher.phone = '96550001234';
fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf-8');
