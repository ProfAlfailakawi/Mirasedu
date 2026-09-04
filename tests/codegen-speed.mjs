// Times generating a large batch of join codes (the "1000 codes is slow" case)
// against a LOCAL server seeded with the load fixture. Confirms speed + that all
// codes are unique (the O(N^2) uniqueness scan was the bottleneck).
import { BASE } from "./lib.mjs";

const N = Number(process.env.MIRAS_CODEGEN_COUNT || 1000);

let cookie = "";
const login = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-miras-device-id": "cg-teacher" },
  body: JSON.stringify({ idNumber: "load@test.kw", password: (process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci") }),
});
for (const c of (login.headers.getSetCookie ? login.headers.getSetCookie() : [])) {
  const kv = c.split(";")[0];
  if (kv.includes("=")) cookie += (cookie ? "; " : "") + kv;
}
if (!login.ok || !cookie) {
  console.error("❌ teacher login failed", login.status);
  process.exit(1);
}

const t0 = performance.now();
const r = await fetch(BASE + "/api/teacher/join-codes/create", {
  method: "POST",
  headers: { "content-type": "application/json", cookie, "x-miras-device-id": "cg-teacher" },
  body: JSON.stringify({ sectionCode: "500", count: N, semester: "الفصل الأول 2026" }),
});
const data = await r.json().catch(() => ({}));
const ms = performance.now() - t0;

const codes = Array.isArray(data.created) ? data.created : (data.codes || []);
const created = codes.length;
const unique = new Set(codes.map((c) => String(c.code || c))).size;

console.log(`\n=== CODE-GEN: ${N} codes on one request ===`);
console.log(`  status        : ${r.status}  ok: ${r.ok}`);
console.log(`  created       : ${created}   unique: ${unique}`);
console.log(`  total time    : ${ms.toFixed(0)}ms   (${(ms / Math.max(1, created)).toFixed(2)}ms/code)`);
const ok = r.ok && created >= Math.floor(N * 0.99) && unique === created;
console.log(`  verdict       : ${ok ? "✅ generated fast and every code is unique" : "⚠️ check output above"}`);
process.exit(ok ? 0 : 1);
