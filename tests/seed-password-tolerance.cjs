// The standard seed, plus student passwords stored exactly the way the old
// registration/reset code stored them, so the login regression can prove that
// these real-world accounts sign in again without a reset:
//   1001 — signed up on an Arabic keyboard: the sign-up field turned "١٠٠١" into
//          "1001", and iOS added a trailing space that the server never trimmed.
//   2002 — typed a comma; the sign-up field stored it as a dot.
require('./seed.cjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'db.json');
const scryptRaw = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
db.students.find((s) => s.id === '1001').passwordHash = scryptRaw('pass1001 ');
db.students.find((s) => s.id === '2002').passwordHash = scryptRaw('a.b2002');
fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf-8');
