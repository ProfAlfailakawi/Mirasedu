import test from 'node:test';
import assert from 'node:assert/strict';
import { studentsWaitingOnTeacher } from '../src/shared/waiting-on-teacher';

const END = Date.UTC(2026, 9, 11, 20, 59, 59, 999);
const AFTER = END + 3600_000;
const BEFORE = END - 3600_000;
const roster = [
  { id: '1', registered: true },
  { id: '2', registered: true },
  { id: '3', registered: true },
  { id: '4', registered: false },
  { id: '٥' },
];

test('before the original deadline nobody is waiting', () => {
  assert.equal(studentsWaitingOnTeacher({ roster, submittedStudentIds: [], originalDeadlineMs: END, now: BEFORE }), 0);
});
test('after it, registered students with nothing submitted are counted; unregistered are not', () => {
  assert.equal(studentsWaitingOnTeacher({ roster, submittedStudentIds: [], originalDeadlineMs: END, now: AFTER }), 4);
});
test('submitted students and students with a running extension are not counted', () => {
  const ext = [{ studentId: '2', until: new Date(AFTER + 3600_000).toISOString() }, { studentId: '3', until: new Date(AFTER - 1000).toISOString() }];
  assert.equal(studentsWaitingOnTeacher({ roster, submittedStudentIds: ['1'], extensions: ext, originalDeadlineMs: END, now: AFTER }), 2);
});
test('Arabic-digit ids match, and an activity without a deadline counts from the start', () => {
  assert.equal(studentsWaitingOnTeacher({ roster, submittedStudentIds: ['٣', '5'], originalDeadlineMs: END, now: AFTER }), 2);
  assert.equal(studentsWaitingOnTeacher({ roster, submittedStudentIds: [], originalDeadlineMs: 0, now: BEFORE }), 4);
});
test('bad input is safe', () => {
  assert.equal(studentsWaitingOnTeacher({ roster: undefined as any, submittedStudentIds: [], originalDeadlineMs: 0 }), 0);
});
