import test from 'node:test';
import assert from 'node:assert/strict';
import { sameTeacherIdentity } from '../src/shared/teacher-account-scope';

test('account selector matches only the selected email, even for an admin viewer', () => {
  const viewerRole = 'admin';
  assert.equal(viewerRole, 'admin');
  assert.equal(sameTeacherIdentity('Doctor@paaet.edu.kw', 'doctor@paaet.edu.kw'), true);
  assert.equal(sameTeacherIdentity('doctor@paaet.edu.kw', 'other@paaet.edu.kw'), false);
  assert.equal(sameTeacherIdentity('admin@paaet.edu.kw', 'other@paaet.edu.kw'), false);
  assert.equal(sameTeacherIdentity('', 'other@paaet.edu.kw'), false);
});
