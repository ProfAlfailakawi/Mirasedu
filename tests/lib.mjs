// Shared helpers for the Miras flows regression suite.
export const BASE = process.env.MIRAS_TEST_BASE || "http://localhost:3000";
export const UA = "Mozilla/5.0 (TestRunner)";

export const AA = "aa@test.kw", BB = "bb@test.kw", CC = "cc@test.kw", DD = "dd@test.kw";
export const S_A1 = `111-${AA}`, S_A2 = `222-${AA}`, S_C = `333-${AA}`;
export const S_B1 = `111-${BB}`, S_C1 = `111-${CC}`, S_D1 = `111-${DD}`;

export function makeJar() { return {}; }
function applySetCookie(jar, res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

export async function api(method, path, body, { deviceToken, jar, ua } = {}) {
  const headers = { "content-type": "application/json", "user-agent": ua || UA };
  if (deviceToken !== undefined && deviceToken !== null) headers["x-miras-device-id"] = deviceToken;
  if (jar) { const ch = cookieHeader(jar); if (ch) headers["cookie"] = ch; }
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (jar) applySetCookie(jar, res);
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}

export function createReporter(title) {
  let pass = 0, fail = 0; const lines = [];
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`  ✅ ${name}`); }
    else { fail++; lines.push(`  ❌ ${name}  ::  ${String(detail).slice(0, 240)}`); }
  };
  const done = () => {
    console.log(`\n=== ${title} ===`);
    for (const l of lines) console.log(l);
    console.log(`  --- ${title}: PASS=${pass} FAIL=${fail}`);
    process.exit(fail ? 1 : 0);
  };
  return { check, done };
}

export const enr = (s) => ((s && s.enrollments) || []);
export const codesOf = (s) => enr(s).map((e) => String(e.courseCode || e.sectionCode || "").toLowerCase());
export const hasCourse = (s, c) => codesOf(s).includes(String(c).toLowerCase());
export const nameFor = (s, c) => { const e = enr(s).find((x) => String(x.courseCode || x.sectionCode || "").toLowerCase() === String(c).toLowerCase()); return e ? e.courseName : undefined; };
export const ownerFor = (s, c) => { const e = enr(s).find((x) => String(x.courseCode || x.sectionCode || "").toLowerCase() === String(c).toLowerCase()); return e ? String(e.teacherEmail || "").toLowerCase() : undefined; };
export const isActive = (s, c) => { const e = enr(s).find((x) => String(x.courseCode || x.sectionCode || "").toLowerCase() === String(c).toLowerCase()); return !!e && e.isActive === true; };
export const isLocked = (s, c) => { const e = enr(s).find((x) => String(x.courseCode || x.sectionCode || "").toLowerCase() === String(c).toLowerCase()); return !!e && (e.isActive === false || e.status === "locked"); };
export const anyBareNumberName = (s) => enr(s).some((e) => /^\s*\d+\s*$/.test(String(e.courseName || "")));
export const anyEmailName = (s) => enr(s).some((e) => String(e.courseName || "").includes("@"));
