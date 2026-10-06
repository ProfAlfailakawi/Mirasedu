import { api, makeJar, createReporter, AA, BB } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / ADMIN AUDIT SCOPE");
const admin = "ah.alfailakawi@paaet.edu.kw";
const password = process.env.TEST_TEACHER_PASSWORD || "change-me-in-ci";
const jar = makeJar();
const opts = { jar, deviceToken: "admin-audit-scope" };

const login = await api("POST", "/api/auth/login", { idNumber: admin, password }, opts);
check("superadmin session is available", login.ok);

const snapshots = new Map();
for (const scope of ["all", "self", AA, BB, "all", BB, "self", AA, "all"]) {
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
  const snapshot = {
    issued: integrity.data.codeHealthFunnel?.issued,
    activated: integrity.data.codeHealthFunnel?.activated,
    healthCodes: integrity.data.dataHealth?.totals?.codes,
    pulseAttempts: integrity.data.mirasPulse?.metrics?.activationAttempts,
    attempts: attempts.data.attempts?.map(row => row.id).sort(),
    devices: devices.data.devices?.map(row => row.credentialId).sort(),
  };
  check(`${scope}: real code counters stay nonzero after repeated selections`,
    snapshot.issued > 0 && snapshot.activated > 0);
  check(`${scope}: attempts and trusted devices are populated`,
    snapshot.attempts?.length > 0 && snapshot.devices?.length > 0);
  if (snapshots.has(scope)) check(`${scope}: revisiting the scope preserves exact counts and records`,
    JSON.stringify(snapshot) === JSON.stringify(snapshots.get(scope)));
  snapshots.set(scope, snapshot);
  check(`${scope}: nested pulse and integrity counters use the same account`,
    snapshot.pulseAttempts === integrity.data.summary.totalAttempts);
  const owner = scope === "self" ? admin : scope;
  if (scope !== "all") check(`${scope}: no foreign rejected attempts leak into the selected account`,
    attempts.data.attempts.every(row => String(row.targetTeacherEmail || row.teacherEmail).toLowerCase() === owner));
  check(`${scope}: attempts/logs/devices endpoints remain valid`,
    attempts.ok && Array.isArray(attempts.data.attempts) && logs.ok && Array.isArray(logs.data.logs) && devices.ok && Array.isArray(devices.data.devices));
}

check("self and teacher filters do not show the all-account code total",
  snapshots.get("all").issued > snapshots.get("self").issued && snapshots.get("all").issued > snapshots.get(BB).issued);
check("all accounts includes every seeded rejected attempt", snapshots.get("all").attempts.length === 3);
check("personal account includes exactly its own seeded attempt", snapshots.get("self").attempts.length === 1);
check("nested data health includes only the selected account's codes",
  snapshots.get("self").healthCodes === 2 && snapshots.get(BB).healthCodes === 4 &&
  snapshots.get("all").healthCodes > snapshots.get("self").healthCodes);
const allSections = await api("GET", "/api/teacher/sections?includeAll=1&scope=all", null, opts);
check("all scope includes both fixture teachers before UI filtering",
  allSections.data.sections.some((s) => String(s.ownerEmail).toLowerCase() === AA) &&
  allSections.data.sections.some((s) => String(s.ownerEmail).toLowerCase() === BB));
done();
