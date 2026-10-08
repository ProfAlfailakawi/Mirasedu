// The Codes tab reads its list one server page at a time. Without a search the
// pages hold exactly the current codes (archived codes stay hidden); a search
// also reaches the archive. Same order, filters and counters as the inventory.
import { api, makeJar, createReporter, AA } from './lib.mjs';
const { check, done } = createReporter('FLOWS / CODE ARCHIVE PAGES');
const teacherPassword = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const admin = 'ah.alfailakawi@paaet.edu.kw';

const unauthenticated = await api('GET', '/api/teacher/join-codes/archive');
check('archive pages require a teacher session', unauthenticated.status === 401);

for (const [email, scope] of [[AA, ''], [admin, 'all'], [admin, 'self']]) {
  const opts = { jar: makeJar(), deviceToken: `archive-${email}` };
  const login = await api('POST', '/api/auth/login', { idNumber: email, password: teacherPassword }, opts);
  check(`${email} ${scope}: login`, login.ok);
  if (email === AA) {
    for (let i = 0; i < 3; i++) {
      await api('POST', '/api/teacher/join-codes/create', { sectionCode: `111-${AA}`, count: 4 }, opts);
    }
  }
  const scoped = scope ? `scope=${scope}&` : '';
  const full = (await api('GET', `/api/teacher/join-codes?${scoped}includeRetired=1`, null, opts)).data.joinCodes || [];
  const time = (c) => Date.parse(String(c.createdAt || c.activatedAt || '')) || 0;
  const everything = full.filter((c) => String(c.code || '').trim());
  const expected = everything.filter((c) => !c.isArchived);

  const pages = [];
  let page = 1, info;
  do {
    info = (await api('GET', `/api/teacher/join-codes/archive?${scoped}page=${page}&pageSize=5`, null, opts)).data;
    pages.push(...(info.joinCodes || []));
    page += 1;
  } while (info.success && page <= info.totalPages && page < 500);
  const label = `${email}${scope ? ` (${scope})` : ''}`;
  check(`${label}: pages together hold exactly the current codes`,
    info.success && pages.length === expected.length && info.total === expected.length &&
    new Set(pages.map((c) => c.code)).size === pages.length &&
    pages.every((c) => expected.some((e) => e.code === c.code)),
    `pages=${pages.length} full=${expected.length} total=${info.total}`);
  check(`${label}: newest first`, pages.every((c, i) => i === 0 || time(pages[i - 1]) >= time(c)));
  const archived = everything.filter((c) => c.isArchived);
  check(`${label}: archived codes are hidden without a search`, pages.every((c) => !c.isArchived) && info.counts?.archived === archived.length,
    `archived=${archived.length} counted=${info.counts?.archived}`);
  for (const old of archived.slice(0, 3)) {
    const r = (await api('GET', `/api/teacher/join-codes/archive?${scoped}q=${encodeURIComponent(old.code)}`, null, opts)).data;
    check(`${label}: archived ${old.code} appears when searched`, r.joinCodes?.some((c) => c.code === old.code && c.isArchived));
  }
  check(`${label}: rows carry the resolved course like the full list`,
    pages.every((c) => { const e = expected.find((x) => x.code === c.code); return e && e.courseName === c.courseName && e.sectionCode === c.sectionCode; }));

  // Exported and used are lifetime totals, archive included; "all" is current codes.
  const used = everything.filter((c) => c.status === 'used').length;
  const printed = everything.filter((c) => String(c.printedAt || '').trim()).length;
  check(`${label}: counters match the full inventory`,
    info.counts?.all === expected.length && info.counts?.used === used && info.counts?.printed === printed,
    JSON.stringify(info.counts));

  for (const status of ['active', 'used', 'revoked']) {
    const r = (await api('GET', `/api/teacher/join-codes/archive?${scoped}status=${status}&pageSize=200`, null, opts)).data;
    check(`${label}: status filter ${status}`, r.total === expected.filter((c) => c.status === status).length && r.joinCodes.every((c) => c.status === status));
  }
  if (expected.length) {
    const needle = expected[expected.length - 1].code.slice(-4).toLowerCase();
    const r = (await api('GET', `/api/teacher/join-codes/archive?${scoped}q=${encodeURIComponent(needle)}&pageSize=200`, null, opts)).data;
    const want = everything.filter((c) => String(c.code).toLowerCase().includes(needle) || String(c.semester || '').toLowerCase().includes(needle) ||
      String(c.studentName || '').toLowerCase().includes(needle) || String(c.assignedStudentName || '').toLowerCase().includes(needle) ||
      String(c.studentId || '').includes(needle) || String(c.assignedStudentId || '').includes(needle));
    check(`${label}: search`, r.total === want.length && r.total >= 1, `got ${r.total} want ${want.length}`);
  }
  const beyond = (await api('GET', `/api/teacher/join-codes/archive?${scoped}page=99999&pageSize=5`, null, opts)).data;
  check(`${label}: a page past the end is clamped to the last page`, beyond.page === beyond.totalPages);
}
done();
