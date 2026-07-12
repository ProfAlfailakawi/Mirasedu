const fs = require('fs');

try {
  let changed = false;
  const db = JSON.parse(fs.readFileSync('./data/db.json', 'utf8'));
  console.log("Sections count:", db.sections?.length || 0);
  
  if (db.sections) {
    db.sections.forEach(s => {
      // Ada only gets his classes. The rest go to Dr. Ahmad.
      if (s.code.toUpperCase() === "TECH-A1" || s.code.toUpperCase() === "TECH-B2") {
        if (s.ownerEmail !== "ada.alenezi@paaet.edu.kw") {
          s.ownerEmail = "ada.alenezi@paaet.edu.kw";
          changed = true;
          console.log(`Reassigned ${s.code} to Ada`);
        }
      } else {
        if (s.ownerEmail !== "dr.ahmad.alfailakawi@gmail.com" && s.ownerEmail !== "ah.alfailakawi@paaet.edu.kw") {
          s.ownerEmail = "ah.alfailakawi@paaet.edu.kw";
          changed = true;
          console.log(`Reassigned ${s.code} to Dr. Ahmad (was ${s.ownerEmail})`);
        }
      }
    });
  }
  
  if (changed) {
    db.lastUpdated = Date.now();
    fs.writeFileSync('./data/db.json', JSON.stringify(db, null, 2));
    console.log("Patched DB ownership successfully.");
  } else {
    console.log("No ownership changes needed.");
  }
} catch (e) {
  console.error(e);
}
