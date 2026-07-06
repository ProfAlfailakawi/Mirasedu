const fs = require('fs');

const filePath = './database.json';
const db = JSON.parse(fs.readFileSync(filePath, 'utf8'));

if (!db.teachers) db.teachers = [];

const email = 'ada.alenezi@paaet.edu.kw';
const teacher = db.teachers.find(t => t.email.toLowerCase() === email.toLowerCase());

const newHash = 'sha256:15ed79e05666cab81a531c5b91fb6d9183604984c7ecad0ef5fa9d086928d678';

if (teacher) {
  teacher.passwordHash = newHash;
} else {
  db.teachers.push({
    id: email,
    name: "د. عبدالعزيز دخيل العنزي",
    email: email,
    passwordHash: newHash,
    role: "teacher",
    isActive: true
  });
}

// Ensure Ahmad's email is also maintained
const ahmad1 = db.teachers.find(t => t.id === 'Ah.Alfailakawi@paaet.edu.kw' || t.email === 'Ah.Alfailakawi@paaet.edu.kw');
if (!ahmad1) {
  db.teachers.push({ id: "Ah.Alfailakawi@paaet.edu.kw", name: "د. أحمد حسين الفيلكاوي", email: "Ah.Alfailakawi@paaet.edu.kw", passwordHash: "sha256:2a57b6d36e9831b0453f9c25e37250c9752f318a63ef38dfd51027bb8091cc25", role: "teacher", isActive: true });
}
const ahmad2 = db.teachers.find(t => t.id === 'dr.ahmad.alfailakawi@gmail.com' || t.email === 'dr.ahmad.alfailakawi@gmail.com');
if (!ahmad2) {
  db.teachers.push({ id: "dr.ahmad.alfailakawi@gmail.com", name: "د. أحمد حسين الفيلكاوي", email: "dr.ahmad.alfailakawi@gmail.com", passwordHash: "sha256:2a57b6d36e9831b0453f9c25e37250c9752f318a63ef38dfd51027bb8091cc25", role: "teacher", isActive: true });
}

db.lastUpdated = Date.now();
fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
console.log('Done!');
