import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePasswordResetRoute, passwordResetDeletionIds } from '../src/shared/password-reset-routing';
const sections = [{code:'501@one.edu',ownerEmail:'one@one.edu'}, {code:'501@two.edu',ownerEmail:'two@two.edu'}];
const display = (c: string) => c.split('@')[0];
test('duplicate display numbers never default to administrator or first teacher', () => {
 assert.equal(resolvePasswordResetRoute({sectionCode:'501'},[],sections,[],display).teacherEmail,'');
});
test('activation bound course resolves the actual colleague', () => {
 const route=resolvePasswordResetRoute({sectionCode:'501',activationCode:'LAB-A'},[],sections,[{code:'LAB-A',studentSection:'501@two.edu',ownerEmail:'admin@one.edu'}],display);
 assert.equal(route.teacherEmail,'two@two.edu');
 assert.equal(route.sectionCode,'501@two.edu');
});
test('exact owned primary course wins over a different enrollment', () => {
 assert.equal(resolvePasswordResetRoute({sectionCode:'501@one.edu',enrollments:[{courseCode:'501@two.edu'}]},[],sections,[],display).teacherEmail,'one@one.edu');
});
test('legacy enrollment ownership routes without a numeric fallback', () => {
 assert.equal(resolvePasswordResetRoute({sectionCode:'501',enrollments:[{courseCode:'501',teacherEmail:'two@two.edu'}]},[],sections,[],display).teacherEmail,'two@two.edu');
});
test('ambiguous enrollment ownership does not broadcast', () => {
 assert.equal(resolvePasswordResetRoute({sectionCode:'501',enrollments:[{courseCode:'501',teacherEmail:'one@one.edu'},{courseCode:'501',teacherEmail:'two@two.edu'}]},[],sections,[],display).teacherEmail,'');
});
test('delete also retires older pending duplicates, preserves newer requests and other owners', () => {
 const selected={id:'selected',studentId:'1001',teacherEmail:'one@one.edu',sectionCode:'501',status:'new',requestedAt:'2026-10-05T12:00:00Z'};
 const old={...selected,id:'old',requestedAt:'2026-10-05T11:00:00Z'};
 const records=[selected,old,{...old,id:'other',teacherEmail:'two@two.edu'},{...old,id:'handled',status:'handled'},{...selected,id:'future',requestedAt:'2026-10-05T13:00:00Z'},{...old,id:'other-student',studentId:'1002'}];
 assert.deepEqual(passwordResetDeletionIds(records,selected),['selected','old']);
});
