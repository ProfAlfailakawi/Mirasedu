import test from 'node:test';
import assert from 'node:assert/strict';
import { notSubmittedListOpen } from '../src/shared/not-submitted-gate';

// Due 2026-10-11 → ends 23:59:59.999 Kuwait = 20:59:59.999 UTC.
const END = Date.UTC(2026, 9, 11, 20, 59, 59, 999);

test('hidden while the original deadline has not passed', () => {
  assert.equal(notSubmittedListOpen(END, Date.UTC(2026, 9, 11, 9)), false);
  assert.equal(notSubmittedListOpen(END, END), false);
});
test('shown once the original deadline has passed', () => {
  assert.equal(notSubmittedListOpen(END, END + 1), true);
});
test('an activity without a usable deadline keeps the list', () => {
  assert.equal(notSubmittedListOpen(0), true);
  assert.equal(notSubmittedListOpen(NaN), true);
});
