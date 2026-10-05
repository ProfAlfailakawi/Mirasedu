import test from 'node:test';
import assert from 'node:assert/strict';
import { studentSessionIssuedAt, shouldApplyStudentLockSignal as apply } from '../src/shared/student-lock-signal';
const token = (issuedAt: number) => `${btoa(JSON.stringify({issuedAt,userId:'1001'}))}.signature`;
test('delayed previous-session signal does not dismiss a new login', () => {
  assert.equal(apply({sessionIssuedAt:100,at:300},token(200)),false);
});
test('current-session device refusal still applies', () => {
  assert.equal(apply({sessionIssuedAt:200,at:300},token(200)),true);
});
test('legacy signal sent before new login is ignored', () => {
  assert.equal(apply({at:100},token(200)),false);
  assert.equal(apply({at:300},token(200)),true);
});
test('signals without a newer stored session still clear the old UI', () => {
  assert.equal(apply({sessionIssuedAt:100},''),true);
});
test('invalid session metadata never bypasses a device refusal', () => {
  assert.equal(studentSessionIssuedAt('invalid'),0);
  assert.equal(apply({sessionIssuedAt:100},'invalid'),true);
});
