import test from 'node:test';
import assert from 'node:assert/strict';
import { countActivatedCourseStudents as count } from '../src/shared/course-activation-count';
const match = (a: any, b: any) => a === b;
const code = 'teacher@example.com:105';
test('roster membership and pending activation do not count', () => {
  assert.equal(count([{id:'1',sectionCode:code},{id:'2',enrollments:[{courseCode:code,pendingActivation:true,isActive:true}]}],code,match),0);
});
test('explicit activations count once per student and only for this course', () => {
  assert.equal(count([{id:'1',activatedCourseCodes:[code]},{id:'1',activatedCourseCodes:[code]},{id:'2',activatedCourseCodes:['other@example.com:105']}],code,match),1);
});
test('active and timestamped enrollments count; pending and roster entries do not', () => {
  const entries = [{isActive:true},{activatedAt:'2026-10-05'},{isActive:true,requiresJoinCode:true},{isActive:true,rosterOnly:true},{isActive:true,enrollmentState:'removed'}];
  assert.equal(count(entries.map((entry,i)=>({id:String(i+1),enrollments:[{courseCode:code,...entry}]})),code,match),2);
});
test('removed course is excluded and restored course included', () => {
  const student={id:'1',activatedCourseCodes:[code],removedCourseLinks:[{courseCode:code}]};
  assert.equal(count([student],code,match),0);
  assert.equal(count([{...student,removedCourseLinks:[{courseCode:code,restoredAt:'today'}]}],code,match),1);
});
test('previous activation remains counted when course is closed', () => {
  assert.equal(count([{id:'1',activatedCourseCodes:[code],enrollments:[{courseCode:code,enrollmentState:'course_closed',isActive:false}]}],code,match),1);
});
test('updated data updates count without mutating records', () => {
  const students=[{id:'1',activatedCourseCodes:[code]}];
  const before=JSON.stringify(students);
  assert.equal(count(students,code,match),1);
  assert.equal(JSON.stringify(students),before);
  assert.equal(count([...students,{id:'2',activatedCourseCodes:[code]}],code,match),2);
});
test('missing ids and malformed lists do not crash or count', () => {
  assert.equal(count([null,{activatedCourseCodes:[code]},{id:'1',enrollments:[null],removedCourseLinks:{},activatedCourseCodes:{}}],code,match),0);
});
