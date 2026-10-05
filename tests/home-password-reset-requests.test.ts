import test from 'node:test';
import assert from 'node:assert/strict';
import { homePasswordResets } from '../src/shared/home-password-reset-requests';
const matches = (a: any,b: any) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const admin = 'admin@example.com';
test('admin home only shows requests owned by the signed-in teacher', () => {
  const own={status:'new',teacherEmail:admin};
  assert.deepEqual(homePasswordResets([{status:'new',teacherEmail:'ada@example.com'},own],admin,matches),[own]);
});
test('own requests are filtered before the four-card limit', () => {
  const foreign=Array.from({length:6},()=>({status:'new',teacherEmail:'ada@example.com'}));
  assert.equal(homePasswordResets([...foreign,{status:'new',teacherEmail:admin}],admin,matches).length,1);
});
test('handled requests and ownerless records stay out of home', () => {
  assert.equal(homePasswordResets([{status:'handled',teacherEmail:admin},{status:'new'}],admin,matches).length,0);
});
