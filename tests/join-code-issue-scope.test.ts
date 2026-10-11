import test from 'node:test';
import assert from 'node:assert/strict';
import { joinCodeIssueScopeEmail } from '../src/shared/join-code-issue-scope';

test('«كل الحسابات» lists only the signed-in teacher\'s own sections', () => {
  assert.equal(joinCodeIssueScopeEmail('all', 'me@x.edu'), 'me@x.edu');
  assert.equal(joinCodeIssueScopeEmail('', 'me@x.edu'), 'me@x.edu');
});
test('«حسابي» is the signed-in teacher', () => {
  assert.equal(joinCodeIssueScopeEmail('self', 'me@x.edu'), 'me@x.edu');
});
test('picking another account lists that account', () => {
  assert.equal(joinCodeIssueScopeEmail('other@x.edu', 'me@x.edu'), 'other@x.edu');
});
