import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preserveGeneralCodeOnReset, recoverResetGeneralCode } from '../src/server/generalJoinCodes.ts';

const active = { code: 'LAB-TEST-ABCD-EFGH', status: 'active', sectionCode: 'all', courseCode: 'all', studentSection: 'all' };
const archived = { ...active, status: 'retired', retiredReason: 'course_closed_full_reset', retiredAt: '2026-09-23', archivedAt: '2026-09-23' };
test('reset recovery leaves the original archive intact', () => {
  const before = structuredClone(archived);
  const recovered = recoverResetGeneralCode(archived);
  assert.equal(recovered.status, 'active');
  assert.equal(recovered.retiredAt, undefined);
  assert.equal(recovered.archivedAt, undefined);
  assert.equal(recovered.recoveredFromResetReason, archived.retiredReason);
  assert.deepEqual(archived, before);
});
test('consumption, assignments, revocation and deletion markers prevent recovery/preservation', () => {
  for (const key of ['studentId', 'assignedStudentId', 'usedByStudentId', 'activatedAt', 'usedAt', 'resolvedCourseCode', 'activatedCourseCode', 'activationDeviceToken', 'activationDeviceFingerprint', 'activationDeviceServerHash', 'replacedBy', 'deletedAt', 'revokedAt', 'deleted', 'isDeleted', 'archived', 'isArchived']) {
    assert.equal(preserveGeneralCodeOnReset({ ...active, [key]: 'marked' }), false, key);
    assert.equal(recoverResetGeneralCode({ ...archived, [key]: 'marked' }), null, key);
  }
  for (const status of ['used', 'active-used', 'activated', 'revoked', 'deleted']) {
    assert.equal(recoverResetGeneralCode({ ...archived, status }), null, status);
  }
  assert.equal(recoverResetGeneralCode({ ...archived, retiredReason: 'manual_code_delete' }), null);
  assert.equal(recoverResetGeneralCode({ ...archived, courseCode: '111-teacher@test.kw' }), null);
});
test('both database resets preserve only unused general inventory', async () => {
  // Import the database from an empty temporary cwd: no cloud config or real data.
  const original = process.cwd();
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'miras-reset-test-'));
  process.chdir(isolated);
  process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE = 'true';
  try {
    const { LocalDatabase } = await import('../src/server/db.ts');
    for (const method of ['customReset', 'fullReset']) {
      const records = [active,
        { ...active, code: 'LAB-TEST-ABCD-EFGJ', status: 'used', usedByStudentId: '1001' },
        { ...active, code: 'LAB-TEST-ABCD-EFGK', status: 'revoked' },
        { ...active, code: 'LAB-TEST-ABCD-EFGM', sectionCode: '111-teacher@test.kw' },
      ];
      const db = new LocalDatabase({ joinCodes: structuredClone(records), retiredJoinCodes: [] });
      db[method]('admin@test.kw');
      assert.deepEqual(db.getJoinCodes(), [active], method);
      assert.equal(db.getRetiredJoinCodes().length, 3, method);
      assert.equal(recoverResetGeneralCode(db.getRetiredJoinCodes()[0]), null);
    }
  } finally {
    process.chdir(original);
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});

test('backup imports add missing codes without overwriting current live or archived decisions', async () => {
  const original = process.cwd();
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'miras-import-test-'));
  process.chdir(isolated);
  process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE = 'true';
  try {
    const { LocalDatabase } = await import('../src/server/db.ts');
    const live = [
      { ...active, code: 'LAB-TEST-ABCD-EFGA', status: 'used', studentId: '1001', activationDeviceToken: 'device', codeSignature: 'current-signature' },
      { ...active, code: 'LAB-TEST-ABCD-EFGB', status: 'revoked', replacedBy: 'replacement' },
      { ...active, code: 'LAB-TEST-ABCD-EFGC', assignedStudentId: '1002' },
      { ...active, code: 'LAB-TEST-ABCD-EFGD', recoveredFromResetAt: '2026-09-29' },
    ];
    const retired = [
      { ...archived, code: 'LAB-TEST-ABCD-EFGE', status: 'used', studentId: '1003' },
      { ...archived, code: 'LAB-TEST-ABCD-EFGF', status: 'revoked' },
      { ...archived, code: live[3].code },
    ];
    const db = new LocalDatabase({ sections: [{ code: 'course', courseName: 'old' }], students: [], allowedStudents: [], questionBank: [], activityLogs: [], joinCodes: structuredClone(live), retiredJoinCodes: structuredClone(retired) });
    const incoming = {
      joinCodesList: [...live, ...retired].map(c => ({ ...active, code: c.code.toLowerCase().replace(/-/g, ''), codeSignature: 'stale-signature' })),
      retiredJoinCodes: [...live, ...retired].map(c => ({ ...archived, code: c.code, status: 'active' })),
      teacherSections: [{ code: 'course', courseName: 'new' }],
    };
    incoming.joinCodesList.push({ ...active, code: 'LAB-TEST-ABCD-EFGJ' });
    incoming.retiredJoinCodes.push({ ...archived, code: 'LAB-TEST-ABCD-EFGK' });
    db.mergeBackupData(incoming);
    assert.deepEqual(db.getJoinCodes().slice(0, live.length), live);
    assert.deepEqual(db.getRetiredJoinCodes().slice(0, retired.length), retired);
    assert.equal(db.getJoinCodes().length, live.length + 1);
    assert.equal(db.getRetiredJoinCodes().length, retired.length + 1);
    assert.equal(db.exportStateSnapshot().sections[0].courseName, 'new');
    const codesAfter = structuredClone({ live: db.getJoinCodes(), retired: db.getRetiredJoinCodes() });
    db.mergeBackupData(incoming);
    assert.deepEqual({ live: db.getJoinCodes(), retired: db.getRetiredJoinCodes() }, codesAfter);
  } finally {
    process.chdir(original);
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});
