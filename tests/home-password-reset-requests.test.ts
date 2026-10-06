import test from 'node:test';
import assert from 'node:assert/strict';
import { homePasswordResets } from '../src/shared/home-password-reset-requests';
const matches = (a: any,b: any) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const admin = 'admin@example.com';
test('admin home only shows requests owned by the signed-in teacher', () => {
  const own={studentId:'1',status:'new',teacherEmail:admin};
  assert.deepEqual(homePasswordResets([{status:'new',teacherEmail:'ada@example.com'},own],admin,matches),[own]);
});
test('own requests are filtered before the four-card limit', () => {
  const foreign=Array.from({length:6},()=>({status:'new',teacherEmail:'ada@example.com'}));
  assert.equal(homePasswordResets([...foreign,{studentId:'1',status:'new',teacherEmail:admin}],admin,matches).length,1);
});
test('handled requests and ownerless records stay out of home', () => {
  assert.equal(homePasswordResets([{status:'handled',teacherEmail:admin},{status:'new'}],admin,matches).length,0);
});

test('course ownership overrides incorrectly assigned teacher metadata', () => {
  assert.equal(homePasswordResets([{studentId:'1',status:'new',teacherEmail:admin,sectionCode:'peer-course'}],admin,matches,(req)=>req.sectionCode==='own-course').length,0);
});
test('only latest request per student appears; other valid students stay visible', () => {
  const rows=[{id:'old',studentId:'1',status:'new',teacherEmail:admin,requestedAt:'2026-01-01'}, {id:'latest',studentId:'1',status:'new',teacherEmail:admin,requestedAt:'2026-01-02'}, {id:'other',studentId:'2',status:'new',teacherEmail:admin}];
  assert.deepEqual(homePasswordResets(rows,admin,matches).map(req=>req.id),['latest','other']);
});
test('expired requests do not appear as pending home actions',()=>{
  assert.equal(homePasswordResets([{studentId:'1',status:'new',teacherEmail:admin,expiresAt:'2020-01-01'}],admin,matches).length,0);
});
test('a recorded completed recovery resolves older duplicate alerts, while a later request stays pending',()=>{
 const now=Date.now(),at=offset=>new Date(now+offset).toISOString();
 const older={id:'older',studentId:'1',teacherEmail:admin,status:'new',requestedAt:at(-20000),expiresAt:at(3600000)};
 const handled={...older,id:'handled',status:'handled',handledAt:at(-10000)};
 assert.equal(homePasswordResets([older,handled],admin,matches).length,0);
 const fresh={...older,id:'fresh',requestedAt:at(-1000)};
 assert.deepEqual(homePasswordResets([older,handled,fresh],admin,matches).map(x=>x.id),['fresh']);
 assert.equal(older.status,'new'); // notification display never changes account or token state
});
