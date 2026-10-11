import test from 'node:test';
import assert from 'node:assert/strict';
import { lateUnderGrace } from '../src/shared/late-under-grace';

const CLOSE = Date.UTC(2026, 9, 11, 20, 59, 59, 999);
const at = (ms: number) => new Date(ms).toISOString();

test('a submission after closing was accepted through an extension or exception', () => {
  assert.equal(lateUnderGrace({ submittedAt: at(CLOSE + 3600_000) }, CLOSE), true);
});
test('the extension flag counts even without a usable close time', () => {
  assert.equal(lateUnderGrace({ lateByExtension: true }, 0), true);
});
test('a plain late submission before closing is not counted', () => {
  assert.equal(lateUnderGrace({ submittedAt: at(CLOSE - 3600_000) }, CLOSE), false);
  assert.equal(lateUnderGrace({ submittedAt: at(CLOSE) }, CLOSE), false);
});
test('missing data is not counted', () => {
  assert.equal(lateUnderGrace(null, CLOSE), false);
  assert.equal(lateUnderGrace({}, CLOSE), false);
  assert.equal(lateUnderGrace({ submittedAt: 'x' }, CLOSE), false);
  assert.equal(lateUnderGrace({ submittedAt: at(CLOSE + 1) }, 0), false);
});
