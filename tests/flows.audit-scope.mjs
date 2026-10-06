import { api, makeJar, createReporter, AA, BB } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / ADMIN AUDIT SCOPE");
const admin = "ah.alfailakawi@paaet.edu.kw";
const password = process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci";
const jar = makeJar();
const opts = { jar, deviceToken: "admin-audit-scope" };

const login = await api("POST", "/api/auth/login", { idNumber: admin, password }, opts);
check("superadmin session is available", login.ok);

for (const scope of ["all", "self", AA, BB]) {
  const suffix = `?includeAll=1&scope=${encodeURIComponent(scope)}`;
  const [sections, reports, codes, integrity, attempts, logs, devices] = await Promise.all([
    api("GET", `/api/teacher/sections${suffix}`, null, opts),
    api("GET", `/api/teacher/reports${suffix}`, null, opts),
    api("GET", `/api/teacher/join-codes${suffix}&includeRetired=1`, null, opts),
    api("GET", `/api/teacher/code-integrity?scope=${encodeURIComponent(scope)}`, null, opts),
    api("GET", `/api/teacher/activation-attempts?scope=${encodeURIComponent(scope)}`, null, opts),
    api("GET", `/api/teacher/logs?scope=${encodeURIComponent(scope)}`, null, opts),
    api("GET", `/api/auth/passkey/devices?scope=${encodeURIComponent(scope)}`, null, opts),
  ]);
  check(`${scope}: section source is present for client-side account scoping`,
    sections.ok && Array.isArray(sections.data.sections) && sections.data.sections.length > 0);
  check(`${scope}: report source contains students and roster`,
    reports.ok && Array.isArray(reports.data.students) && Array.isArray(reports.data.allowedStudents));
  check(`${scope}: code sources remain arrays`,
    codes.ok && Array.isArray(codes.data.joinCodes));
  check(`${scope}: integrity endpoint returns scoped counters`,
    integrity.ok && integrity.data.success === true && Number.isFinite(integrity.data.summary?.totalAttempts));
  check(`${scope}: attempts/logs/devices endpoints remain valid`,
    attempts.ok && Array.isArray(attempts.data.attempts) && logs.ok && Array.isArray(logs.data.logs) && devices.ok && Array.isArray(devices.data.devices));
}

const allSections = await api("GET", "/api/teacher/sections?includeAll=1&scope=all", null, opts);
check("all scope includes both fixture teachers before UI filtering",
  allSections.data.sections.some((s) => String(s.ownerEmail).toLowerCase() === AA) &&
  allSections.data.sections.some((s) => String(s.ownerEmail).toLowerCase() === BB));
done();
