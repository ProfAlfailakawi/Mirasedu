// The standard seed, plus an activation code kept only on a student's record
// (no row in the live or archived code ledgers), as a legacy cleanup can leave.
require('./seed.cjs');
const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const student = db.students.find((s) => String(s.id) === '1001');
student.activationCode = 'LAB-ZQQQ-QQQQ-QQQQ';
fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf-8');
