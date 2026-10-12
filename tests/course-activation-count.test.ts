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
import { countActivatedAcrossCourses as across } from '../src/shared/course-activation-count';
test('across courses a student activated in several is counted once; none or unknown courses give zero', () => {
  const a = 't@x:1', b = 't@x:2';
  const students = [
    { id: '1', activatedCourseCodes: [a, b] },
    { id: '2', activatedCourseCodes: [b] },
    { id: '3', activatedCourseCodes: ['other:9'] },
    { id: '4' },
  ];
  assert.equal(across(students, [a, b], match), 2);
  assert.equal(across(students, [a], match), 1);
  assert.equal(across(students, [], match), 0);
  assert.equal(across(undefined as any, [a], match), 0);
});
import { summarizeSectionActivation } from '../src/shared/course-activation-count';
test('per-section activated out of roster, with a de-duplicated overall total', () => {
  const a = 't@x:1', b = 't@x:2';
  const students = [
    { id: '1', activatedCourseCodes: [a, b], enrollments: [{ courseCode: a }, { courseCode: b }] },
    { id: '2', activatedCourseCodes: [a], enrollments: [{ courseCode: a }] },
    { id: '3', enrollments: [{ courseCode: b }] },
  ];
  const belongs = (s: any, code: string) => (s.enrollments || []).some((e: any) => e.courseCode === code);
  const roster = [{ id: '1', sectionCode: a }, { id: '2', sectionCode: a }, { id: '8', sectionCode: a }, { id: '3', sectionCode: b }];
  const r = summarizeSectionActivation({ sections: [{ code: a, name: 'أ' }, { code: b, name: 'ب' }], students, rosterEntries: roster, matches: match, belongs });
  assert.deepEqual(r.rows.map((x) => [x.name, x.activated, x.total]), [['أ', 2, 3], ['ب', 1, 2]]);
  assert.equal(r.activatedAll, 2);
  assert.equal(r.totalAll, 4);
});
test('a section total is never below its activated count, and bad input is safe', () => {
  const a = 't@x:1';
  const r = summarizeSectionActivation({ sections: [{ code: a }], students: [{ id: '1', activatedCourseCodes: [a] }], rosterEntries: [], matches: match, belongs: () => false });
  assert.deepEqual(r.rows.map((x) => [x.activated, x.total]), [[1, 1]]);
  const empty = summarizeSectionActivation({ sections: undefined as any, students: undefined as any, rosterEntries: undefined as any, matches: match, belongs: () => false });
  assert.deepEqual([empty.rows.length, empty.activatedAll, empty.totalAll], [0, 0, 0]);
});
