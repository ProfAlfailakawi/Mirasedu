import fs from 'fs';
const file = './data/db.json';
const db = JSON.parse(fs.readFileSync(file, 'utf-8'));
const t = db.teachers.find(t => t.email.toLowerCase() === 'ada.alenezi@paaet.edu.kw');
if (t) {
  t.passwordHash = 'sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678';
  t.name = 'د. عبدالعزيز دخيل العنزي';
}
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log('patched');
