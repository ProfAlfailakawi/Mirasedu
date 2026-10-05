// Device-lock seed: the base seed, plus a legacy activation record for student
// 2002 whose device token was never stored (only a fingerprint from an older IP).
const fs = require("fs");
const path = require("path");
require("./seed.cjs");

const DB = path.join(__dirname, "..", "data", "db.json");
const db = JSON.parse(fs.readFileSync(DB, "utf-8"));
const legacy = db.joinCodes.find((c) => c.code === "LAB-7777-0007");
legacy.activationDeviceToken = "";
// Student 1001 has activated a second teacher's course as well.
const multiTeacher = db.students.find((student) => student.id === "1001");
multiTeacher.activatedCourseCodes.push("111-bb@test.kw");
multiTeacher.enrollments.push({ courseCode: "111-bb@test.kw", sectionCode: "111-bb@test.kw", teacherEmail: "bb@test.kw", status: "active", isActive: true });
fs.writeFileSync(DB, JSON.stringify(db, null, 2), "utf-8");
if (require.main === module) console.log("Seeded (device-lock)", DB);
