import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionsStillWaiting } from '../src/shared/extension-work';

const NOW = Date.UTC(2026, 9, 11, 12);
const future = new Date(NOW + 3600_000).toISOString();
const past = new Date(NOW - 3600_000).toISOString();

test('counts running extensions of students who have not submitted', () => {
  const ext = [{ studentId: '1', until: future }, { studentId: '2', until: future }];
  assert.equal(extensionsStillWaiting(ext, [], NOW), 2);
});
test('a student who submitted is no longer waiting, whatever the id case', () => {
  const ext = [{ studentId: 'A1', until: future }, { studentId: '2', until: future }];
  assert.equal(extensionsStillWaiting(ext, ['a1'], NOW), 1);
});
test('expired extensions and bad data are ignored; duplicates count once', () => {
  const ext = [{ studentId: '1', until: past }, { studentId: '', until: future }, { studentId: '3', until: 'x' },
    { studentId: '4', until: future }, { studentId: '4', until: future }];
  assert.equal(extensionsStillWaiting(ext, [], NOW), 1);
  assert.equal(extensionsStillWaiting(undefined, [], NOW), 0);
});
