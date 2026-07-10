// Load driver: simulates many students polling the hottest endpoint
// (/api/live/student-state — the student-workspace loader every client polls
// every ~1.5-3s) against a LOCAL server seeded with 1000 students. Measures
// latency percentiles + throughput + error rate, and flags slow paths.
//
// Env: MIRAS_LOAD_CONCURRENCY (default 200), MIRAS_LOAD_TOTAL (default 5000),
//      MIRAS_LOAD_STUDENTS (default 1000).  BASE from lib.mjs.
import { BASE } from "./lib.mjs";

const CONCURRENCY = Number(process.env.MIRAS_LOAD_CONCURRENCY || 200);
const TOTAL = Number(process.env.MIRAS_LOAD_TOTAL || 5000);
const COUNT = Number(process.env.MIRAS_LOAD_STUDENTS || 1000);
const pad = (n) => String(n).padStart(4, "0");
const sid = (i) => `L${pad(i)}`;

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
const ms = (n) => `${n.toFixed(1)}ms`;

// one teacher session can read any student's live-state (teacher bypass in the
// student-owned middleware) — so we auth once and simulate the read fan-out.
let cookie = "";
const login = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-miras-device-id": "load-teacher" },
  body: JSON.stringify({ idNumber: "load@test.kw", password: "REDACTED" }),
});
for (const c of (login.headers.getSetCookie ? login.headers.getSetCookie() : [])) {
  const kv = c.split(";")[0];
  if (kv.includes("=")) cookie += (cookie ? "; " : "") + kv;
}
if (!login.ok || !cookie) {
  console.error("❌ teacher login failed — cannot run load test", login.status);
  process.exit(1);
}

async function hit(studentId) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${BASE}/api/live/student-state?studentId=${studentId}`, {
      headers: { cookie, "x-miras-device-id": "load-teacher" },
    });
    await r.arrayBuffer();
    return { ms: performance.now() - t0, ok: r.ok, status: r.status };
  } catch {
    return { ms: performance.now() - t0, ok: false, status: 0 };
  }
}

// warm-up (JIT + first Firestore-less read) — not measured
await Promise.all(Array.from({ length: 20 }, (_, i) => hit(sid(1 + (i % COUNT)))));

console.log(`\n=== LOAD: /api/live/student-state — ${COUNT} students, ${TOTAL} reqs @ concurrency ${CONCURRENCY} ===`);
const lat = [];
let errors = 0, idx = 0;
const start = performance.now();
async function worker() {
  while (true) {
    const my = idx++;
    if (my >= TOTAL) return;
    const r = await hit(sid(1 + (my % COUNT)));
    lat.push(r.ms);
    if (!r.ok) errors += 1;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const wall = (performance.now() - start) / 1000;
lat.sort((a, b) => a - b);
const mean = lat.reduce((s, v) => s + v, 0) / (lat.length || 1);
const rps = TOTAL / wall;

console.log(`  requests      : ${TOTAL}   errors: ${errors} (${((errors / TOTAL) * 100).toFixed(2)}%)`);
console.log(`  throughput    : ${rps.toFixed(0)} req/s   (wall ${wall.toFixed(2)}s)`);
console.log(`  latency mean  : ${ms(mean)}`);
console.log(`  latency p50   : ${ms(pct(lat, 50))}`);
console.log(`  latency p95   : ${ms(pct(lat, 95))}`);
console.log(`  latency p99   : ${ms(pct(lat, 99))}`);
console.log(`  latency max   : ${ms(lat[lat.length - 1] || 0)}`);

// verdict vs. a "rocket" bar: at 1000 students polling every 3s = ~333 req/s.
const p95 = pct(lat, 95);
const capacityRps = rps;
console.log(`\n  --- VERDICT ---`);
console.log(`  need ~333 req/s to serve 1000 students polling every 3s.`);
console.log(`  measured single-instance capacity: ${capacityRps.toFixed(0)} req/s.`);
const okCapacity = capacityRps >= 333;
const okLatency = p95 < 400;
console.log(`  capacity ${okCapacity ? "✅ covers 1000 students on ONE instance" : "⚠️ one instance under 333 req/s — Cloud Run autoscale (min-instances/CPU) carries the rest"}`);
console.log(`  p95 latency ${okLatency ? "✅ snappy (<400ms)" : "⚠️ >400ms — investigate the handler hot path"}`);
console.log(`  errors ${errors === 0 ? "✅ none" : `❌ ${errors} — investigate`}`);
process.exit(errors > TOTAL * 0.01 ? 1 : 0);
