import test from 'node:test';
import assert from 'node:assert/strict';
import { recordLateAttempt, attemptStudentId } from '../src/shared/late-attempts';

const NOW = Date.UTC(2026, 9, 11, 12);
const iso = (ms: number) => new Date(ms).toISOString();

test('the first attempt creates an entry with the student name', () => {
  const list = recordLateAttempt(undefined, { id: '1001', name: 'سارة' }, NOW)!;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].studentId, list[0].studentName, list[0].count], ['1001', 'سارة', 1]);
});
test('a repeat inside a minute writes nothing; later it counts up and keeps the first time', () => {
  const first = recordLateAttempt([], { id: '1001', name: 'سارة' }, NOW)!;
  assert.equal(recordLateAttempt(first, { id: '1001' }, NOW + 30_000), null);
  const again = recordLateAttempt(first, { id: '1001' }, NOW + 120_000)!;
  assert.equal(again.length, 1);
  assert.equal(again[0].count, 2);
  assert.equal(again[0].firstAt, iso(NOW));
});
test('Arabic-digit ids are the same student; a missing id writes nothing', () => {
  assert.equal(attemptStudentId('١٠٠١'), '1001');
  assert.equal(recordLateAttempt([], { id: '' }, NOW), null);
  const list = recordLateAttempt([], { id: '١٠٠١' }, NOW)!;
  assert.equal(recordLateAttempt(list, { id: '1001' }, NOW + 120_000)!.length, 1);
});
test('the list is capped', () => {
  let list: any[] = [];
  for (let i = 1; i <= 305; i++) list = recordLateAttempt(list, { id: String(i) }, NOW + i)!;
  assert.equal(list.length, 300);
  assert.equal(list[299].studentId, '305');
});
