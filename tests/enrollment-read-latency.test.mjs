import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transform } from 'esbuild';

// Compile the actual server helpers with an in-memory read adapter. This never
// imports the server/database, reads credentials, starts a server, or uses cloud.
const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const helpers = new Map(parsed.statements.filter(ts.isFunctionDeclaration)
  .filter(node => node.name).map(node => [node.name.text, node.getText(parsed)]));
const names = [
  'normalizeStudentId', 'normalizeJoinCode', 'compactJoinCode',
  'isActiveRecord', 'activeSections', 'isSoftDeletedRecord', 'isArchivedJoinCodeRecord',
  'isUsableJoinCodeRecord', 'joinCodeCourse', 'joinCodeLinkedToStudent', 'joinCodeOwnerEmail',
  'extractEmailFromSectionCode', 'sectionDisplayCode', 'sectionCodeEquivalent',
  'sectionOwnerEmail', 'sectionForCourseCode', 'courseCodeMatchesForTeacher',
  'courseMatchesRemovalTarget', 'getStudentRemovedCourseLinks', 'canonicalStudentRemovedCourseLinks',
  'joinCodeMatchesStudentCourseIgnoringRemoval', 'latestStudentCourseActivationTime',
  'isStudentCourseRemoved', 'withoutRemovedStudentCourses', 'joinCodeMatchesStudentCourse',
  'teacherReadIndex', 'indexedStudentCodes', 'indexedStudentRoster',
  'activatedCourseCodesForStudent', 'getStudentRosterCourseCodes', 'getStudentDiscoveredCourseCodes',
  'resolveSectionForStudentGate', 'isSectionOpenForStudents', 'suspensionCourseMatches',
  'getSuspendedEnrollmentRecord', 'getFreshJoinCodeForStudentCourse',
  'studentHasCurrentRosterCourseLink', 'studentHasOperationalUsedJoinCode',
  'studentHasPersistentActiveEnrollment', 'hasActivatedStudentCourseLink',
  'teacherOwnsCourseCode', 'getStudentEnrollmentDetails', 'teacherReportsData',
];
for (const name of names) assert.ok(helpers.has(name), `actual helper ${name} exists`);

// Exact pre-optimization implementations serve as the behavioral reference.
// Their dependencies, course ownership checks and response helpers remain real.
const originalLatest = `function latestStudentCourseActivationTime(student: any, courseCode: any, teacherEmail?: any): number {
  const course = String(courseCode || "").trim();
  if (!student || !course) return 0;
  let latest = 0;
  const consider = (value: any) => {
    const time = Date.parse(String(value || "")) || 0;
    if (time > latest) latest = time;
  };
  if (Array.isArray(student?.enrollments)) {
    student.enrollments.forEach((entry: any) => {
      const entryCourse = entry?.courseCode || entry?.sectionCode || entry?.studentSection;
      if (courseMatchesRemovalTarget(entryCourse, course, entry?.teacherEmail || teacherEmail)) {
        consider(entry?.activatedAt || entry?.reactivatedAt);
      }
    });
  }
  try {
    dbInstance.getJoinCodes().forEach((jc: any) => {
      const status = String(jc?.status || "").toLowerCase();
      if (!["used", "active-used", "activated"].includes(status)) return;
      if (!joinCodeMatchesStudentCourseIgnoringRemoval(jc, student, course, teacherEmail)) return;
      consider(jc?.activatedAt || jc?.usedAt);
    });
  } catch {}
  return latest;
}`;
const originalRemoved = `function isStudentCourseRemoved(student: any, courseCode: any, teacherEmail?: any): boolean {
  const course = String(courseCode || "").trim();
  if (!student || !course) return false;
  const latestActivation = latestStudentCourseActivationTime(student, course, teacherEmail);
  return canonicalStudentRemovedCourseLinks(student).some((entry: any) => {
    if (!entry || entry.restoredAt || entry.isRestored === true || entry.status === "restored") return false;
    const removedCourse = entry.courseCode || entry.sectionCode || entry.studentSection;
    const entryTeacher = entry.teacherEmail || entry.ownerEmail || entry.removedBy || teacherEmail;
    if (!courseMatchesRemovalTarget(removedCourse, course, entryTeacher || teacherEmail)) return false;
    const removedAt = Date.parse(String(entry.removedAt || entry.deletedAt || "")) || 0;
    return !latestActivation || !removedAt || removedAt >= latestActivation;
  });
}`;
const constants = parsed.statements.filter(ts.isVariableStatement).filter(node =>
  node.declarationList.declarations.some(declaration =>
    ['MIRAS_JOIN_CODE_PREFIX', 'MIRAS_JOIN_CODE_GROUPS', 'MIRAS_JOIN_CODE_GROUP_SIZE'].includes(declaration.name.getText(parsed))))
  .map(node => node.getText(parsed)).join('\n');
async function compiler(legacy) {
  const body = names.map(name => legacy && name === 'latestStudentCourseActivationTime' ? originalLatest
    : legacy && name === 'isStudentCourseRemoved' ? originalRemoved : helpers.get(name)).join('\n');
  const { code } = await transform(`${constants}\nconst teacherReadIndexes = new WeakMap<object, any>();\n${body}`, { loader: 'ts' });
  return new Function('dbInstance', `${code}\nreturn { latestStudentCourseActivationTime, isStudentCourseRemoved, indexedStudentCodes, getStudentEnrollmentDetails, teacherReportsData };`);
}
const [compileCurrent, compileOriginal] = await Promise.all([compiler(false), compiler(true)]);
function fixture(data, compile = compileCurrent) {
  const counters = { codeReads: 0 };
  let local = 0, cloud = 0;
  const db = {
    getStudents: () => data.students,
    getSections: () => data.sections,
    getJoinCodes: () => { counters.codeReads += 1; return data.codes; },
    getAllowedStudents: () => data.allowed || [],
    getTeacherSubmissions: () => data.submissions || [],
    getQuizSubmissions: () => data.quizzes || [],
    getTeachers: () => data.teachers || [],
    getActivityLogs: () => data.logs || [],
    getChapters: () => data.chapters || [],
    getReadRevision: () => `${local}:100:${cloud}`,
  };
  return { ...compile(db), counters, localWrite: () => local++, cloudSnapshot: () => cloud++ };
}
const owners = ['one@test.kw', 'two@test.kw'];
const course = (number, owner = owners[0]) => `${number}-${owner}`;
function base(students = [{ id: '1001' }], codes = []) {
  return { students, codes, sections: owners.flatMap(owner => [111, 222].map(number => ({
    code: course(number, owner), ownerEmail: owner, courseName: `Course ${number}`, isOpen: true,
  }))), teachers: owners.map(email => ({ email, name: email })) };
}
function compare(data, targets = [course(111), course(111, owners[1]), '111', course(222), 'missing']) {
  const current = fixture(data), original = fixture(data, compileOriginal);
  for (const student of data.students) for (const target of targets) for (const owner of [undefined, ...owners]) {
    assert.equal(current.latestStudentCourseActivationTime(student, target, owner),
      original.latestStudentCourseActivationTime(student, target, owner), `activation ${student.id}:${target}:${owner}`);
    assert.equal(current.isStudentCourseRemoved(student, target, owner),
      original.isStudentCourseRemoved(student, target, owner), `removal ${student.id}:${target}:${owner}`);
  }
  return { current, original };
}

test('activation timestamps preserve all linked aliases, status/date rules and owner boundaries', () => {
  const students = [{ id: ' ١٠٠١ ', enrollments: [{ courseCode: course(111), activatedAt: '2026-01-04' }] },
    { idNumber: '۱۰۰۲' }, { studentId: 'id-1003' }];
  const codes = [
    { studentId: '9999', assignedStudentId: '1001', status: 'used', usedAt: '2026-01-05' },
    { studentId: '1002', usedByStudentId: '١٠٠١', status: 'ACTIVE-USED', activatedAt: '2026-01-06' },
    { assignedStudentId: '1003', status: 'activated', activatedAt: '2026-01-07' },
    { studentId: '1001', status: ' used ', activatedAt: '2099-01-01' },
    { studentId: '1001', status: 'active', activatedAt: '2099-01-01' },
    { studentId: '1001', status: 'used', activatedAt: 'invalid', usedAt: '2099-01-01' },
    { studentId: '1001', status: 'used', activatedAt: '2026-01-08', deletedAt: '2026-01-09' },
    { studentId: '1001', status: 'activated', sectionCode: course(111, owners[1]), ownerEmail: owners[1], activatedAt: '2099-01-01' },
  ].map((code, index) => ({ code: `TEST-${index}`, sectionCode: course(111), ownerEmail: owners[0], ...code }));
  const data = base(students, codes);
  compare(data);
  assert.equal(fixture(data).latestStudentCourseActivationTime(students[0], course(111), owners[0]), Date.parse('2026-01-08'));
});

test('no live matching removal marker reads no activation inventory', () => {
  for (const removedCourseLinks of [undefined, [], [{ courseCode: course(222), removedAt: '2026-01-10' }],
    [{ courseCode: course(111), restoredAt: '2026-01-11' }],
    [{ courseCode: course(111), isRestored: true }], [{ courseCode: course(111), status: 'restored' }]]) {
    const data = base([{ id: '1001', removedCourseLinks }]);
    const f = fixture(data);
    assert.equal(f.isStudentCourseRemoved(data.students[0], course(111)), false);
    assert.equal(f.counters.codeReads, 0);
  }
});

test('removal aliases, deduplication, reactivation timestamps and missing dates retain their decisions', () => {
  const students = [
    { id: '1001', removedCourseLinks: [{ courseCode: course(111), removedAt: '2026-01-04' }] },
    { id: '1002', removedCourseLinks: [{ courseCode: course(111), removedAt: '2026-01-08' }] },
    { id: '1003', removedCourseLinks: [{ courseCode: course(111) }] },
    { id: '1004', removedEnrollments: [{ courseCode: course(111), deletedAt: '2026-01-03' }],
      deletedCourseLinks: [{ courseCode: course(111), removedAt: '2026-01-09' }],
      enrollments: [{ courseCode: course(111), reactivatedAt: '2026-01-10' }] },
    { id: '1005', removedCourseLinks: [{ courseCode: course(111), removedAt: '2026-01-06' }] },
  ];
  const codes = students.map((student, index) => ({ code: `TEST-${index}`, studentId: student.id,
    sectionCode: course(111), ownerEmail: owners[0], status: 'used', activatedAt: '2026-01-06' }));
  const { current } = compare(base(students, codes));
  assert.deepEqual(students.map(student => current.isStudentCourseRemoved(student, course(111))), [false, true, true, false, true]);
});

test('linked record order and read cache refresh on local writes and foreign cloud snapshots', () => {
  const row = { code: 'DUP', studentId: '1001', assignedStudentId: '١٠٠١', usedByStudentId: '۱۰۰۱',
    sectionCode: course(111), status: 'used', usedAt: '2026-01-01' };
  const data = base([{ id: '1001' }], [row, { ...row, code: 'SECOND' }, row]);
  const f = fixture(data), student = data.students[0];
  assert.deepEqual(f.indexedStudentCodes(student).map(code => code.code), ['DUP', 'SECOND', 'DUP']);
  assert.equal(f.counters.codeReads, 2);
  f.latestStudentCourseActivationTime(student, course(111));
  assert.equal(f.counters.codeReads, 2);
  data.codes.push({ ...row, code: 'LOCAL', usedAt: '2026-02-01' }); f.localWrite();
  assert.equal(f.latestStudentCourseActivationTime(student, course(111)), Date.parse('2026-02-01'));
  data.codes = [{ ...row, code: 'REMOTE', usedAt: '2026-03-01' }]; f.cloudSnapshot();
  assert.equal(f.latestStudentCourseActivationTime(student, course(111)), Date.parse('2026-03-01'));
  assert.equal(f.counters.codeReads, 6);
});

test('empty legacy inventory rows cannot hide a valid linked activation history', () => {
  const student = { id: '1001', removedCourseLinks: [{ courseCode: course(111), removedAt: '2026-01-04' }] };
  const data = base([student], [null, undefined, { code: 'VALID', studentId: '1001',
    sectionCode: course(111), ownerEmail: owners[0], status: 'used', usedAt: '2026-01-06' }]);
  data.allowed = [null]; data.submissions = [undefined]; data.quizzes = [null];
  const { current } = compare(data);
  assert.equal(current.latestStudentCourseActivationTime(student, course(111)), Date.parse('2026-01-06'));
  assert.equal(current.isStudentCourseRemoved(student, course(111)), false);
});

test('mixed-owner randomized histories return exactly the original activation and removal facts', () => {
  let seed = 6421;
  const next = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const pick = values => values[next(values.length)];
  const dates = ['', 'invalid', '2026-01-02', '2026-01-08', '2026-01-15'];
  const students = Array.from({ length: 30 }, (_, i) => ({ id: String(1001 + i),
    enrollments: [{ courseCode: course(pick([111, 222]), pick(owners)), activatedAt: pick(dates), reactivatedAt: pick(dates) }],
    [pick(['removedCourseLinks', 'removedEnrollments', 'deletedCourseLinks'])]: Array.from({ length: next(4) }, () => ({
      courseCode: pick(['111', course(111), course(111, owners[1]), course(222)]),
      teacherEmail: pick(['', ...owners]), removedAt: pick(dates), deletedAt: pick(dates),
      status: pick(['removed', 'restored', '']), isRestored: !next(5),
    })),
  }));
  const codes = Array.from({ length: 300 }, (_, i) => ({ code: `TEST-${i}`,
    studentId: pick(['', students[next(students.length)].id]),
    assignedStudentId: pick(['', students[next(students.length)].id]),
    usedByStudentId: pick(['', students[next(students.length)].id]),
    sectionCode: pick(['111', course(111), course(111, owners[1]), course(222)]),
    ownerEmail: pick(['', ...owners]), status: pick(['used', 'ACTIVE-USED', 'activated', 'active', ' used ', 'archived']),
    activatedAt: pick(dates), usedAt: pick(dates), deletedAt: pick(['', '2026-01-10']),
  }));
  compare(base(students, codes));
});

test('complete enrollment and personal/all-account report payloads match the original helpers', () => {
  const data = base(Array.from({ length: 24 }, (_, i) => ({ id: String(1001 + i), name: `Student ${i}`,
    sectionCode: course(pickNumber(i), owners[i % 2]), activatedCourseCodes: [course(pickNumber(i), owners[i % 2])],
    progress: i * 3, score: i % 9, enrollments: [{ courseCode: course(pickNumber(i), owners[i % 2]),
      teacherEmail: owners[i % 2], isActive: true, activatedAt: '2026-01-06' }],
    ...(i % 4 === 0 ? { removedCourseLinks: [{ courseCode: course(pickNumber(i), owners[i % 2]), removedAt: '2026-01-08' }] } : {}),
  })));
  function pickNumber(i) { return i % 3 ? 111 : 222; }
  data.allowed = data.students.map(student => ({ idNumber: student.id, sectionCode: student.sectionCode }));
  data.codes = data.students.map((student, i) => ({ code: `TEST-${i}`, studentId: student.id,
    sectionCode: student.sectionCode, ownerEmail: owners[i % 2], status: i % 5 ? 'used' : 'active',
    ...(i % 5 ? { activatedAt: '2026-01-06' } : {}),
  }));
  data.chapters = owners.map((teacherEmail, i) => ({ id: `chapter-${i}`, teacherEmail, title: `Chapter ${i}` }));
  data.quizzes = data.students.map((student, i) => ({ studentId: student.id, chapterId: `chapter-${i % 2}`, score: i % 10, totalPoints: 10 }));
  data.logs = data.students.map((student, i) => ({ studentId: student.id, sectionCode: student.sectionCode, isViolationWarning: i % 6 === 0 }));
  const current = fixture(data), original = fixture(data, compileOriginal);
  for (const student of data.students) for (const owner of ['', ...owners])
    assert.deepEqual(current.getStudentEnrollmentDetails(student, owner), original.getStudentEnrollmentDetails(student, owner));
  for (const owner of owners) for (const all of [false, true])
    assert.deepEqual(current.teacherReportsData(owner, all), original.teacherReportsData(owner, all));
});
