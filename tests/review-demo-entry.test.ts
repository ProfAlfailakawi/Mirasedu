import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isReviewDemoEntryVisible, REVIEW_DEMO_ENTRY_DEFAULT } from '../src/shared/review-demo-entry';

test('hidden by default, even in the native shell', () => {
  assert.equal(REVIEW_DEMO_ENTRY_DEFAULT, false);
  assert.equal(isReviewDemoEntryVisible({ nativeShell: true, search: '' }), false);
});
test('reviewer param works only inside the native shell', () => {
  assert.equal(isReviewDemoEntryVisible({ nativeShell: true, search: '?review-demo=1' }), true);
  assert.equal(isReviewDemoEntryVisible({ nativeShell: false, search: '?review-demo=1' }), false);
  assert.equal(isReviewDemoEntryVisible({ nativeShell: true, search: '?review-demo=0' }), false);
});
test('flag shows it in the shell only', () => {
  assert.equal(isReviewDemoEntryVisible({ nativeShell: true, search: '', flag: true }), true);
  assert.equal(isReviewDemoEntryVisible({ nativeShell: false, search: '', flag: true }), false);
});
test('App.tsx uses the helper', () => {
  const src = fs.readFileSync('App.tsx', 'utf8');
  assert.match(src, /const MIRAS_DEMO_ENTRY_VISIBLE = isReviewDemoEntryVisible\(\);/);
});
