const crypto = require('crypto');

const saved = "scrypt:44ca34d3b7efd587207f89f8b603de68:530a785d6f8cb67a9e27e900e1d0876f97a116cbfd83ae197added08c7d1538b75b0e7e4b66c199ff0f02a52a45a52192e43149ccb3aeee1a9e06576e9dd6241";

function verifyPasswordFlexible(stored, submitted) {
  const clean = String(submitted || "").trim();
  const saved = String(stored || "");
  if (saved.startsWith("scrypt:")) {
    const [, salt, key] = saved.split(":");
    if (!salt || !key) return false;
    const candidate = crypto.scryptSync(clean, salt, 64).toString("hex");
    try { return crypto.timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(candidate, "hex")); }
    catch { return false; }
  }
  return saved === clean;
}

const candidates = [
  "123456", "1111", "000000", "Ahmed", "ahmed", "1111@paaet.edu.kw", "paaet", "paaet123", "Miras", "miras", "miras123"
];

for (const cand of candidates) {
  if (verifyPasswordFlexible(saved, cand)) {
    console.log("MATCH FOUND:", cand);
    process.exit(0);
  }
}

console.log("No match found in basic list.");
process.exit(1);
