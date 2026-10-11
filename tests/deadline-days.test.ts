import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilDeadline } from '../src/shared/deadline-days';

// A date-only due date of 2026-10-11 ends at 23:59:59.999 Kuwait = 20:59:59.999 UTC.
const END = Date.UTC(2026, 9, 11, 20, 59, 59, 999);
const kuwait = (h: number, m = 0) => Date.UTC(2026, 9, 11, h - 3, m);

test('a project due today is "today" from the first minute of the day until 11:59 pm Kuwait', () => {
  assert.equal(daysUntilDeadline(END, kuwait(0, 1)), 0);
  assert.equal(daysUntilDeadline(END, kuwait(12)), 0);
  assert.equal(daysUntilDeadline(END, kuwait(23, 58)), 0);
});
test('it only becomes past after the end of the day', () => {
  assert.ok((daysUntilDeadline(END, kuwait(24, 1)) as number) < 0);
});
test('tomorrow and later count whole days', () => {
  assert.equal(daysUntilDeadline(END, Date.UTC(2026, 9, 10, 9)), 1);
  assert.equal(daysUntilDeadline(END, Date.UTC(2026, 9, 8, 9)), 3);
});
test('no deadline gives null', () => {
  assert.equal(daysUntilDeadline(0), null);
  assert.equal(daysUntilDeadline(NaN), null);
});
