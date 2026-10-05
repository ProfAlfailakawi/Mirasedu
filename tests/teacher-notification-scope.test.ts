import test from 'node:test';
import assert from 'node:assert/strict';
import { teacherOwnsNotification as owns, duplicatesCodeIntegrityLog } from '../src/shared/teacher-notification-scope';
import { deviceAuditForDisplay } from '../src/shared/device-audit';
const admin='admin@example.com';
const same=(a:any,b:any)=>String(a || '').toLowerCase()===String(b || '').toLowerCase();
const owner=(code:string)=>code.split('-').slice(1).join('-');
test('superadmin gets own course alerts and excludes another teacher',()=>{
  assert.equal(owns({sectionCode:`111-${admin}`},admin,owner,same),true);
  assert.equal(owns({sectionCode:'111-ada@example.com'},admin,owner,same),false);
});
test('foreign course takes priority over admin actor or target',()=>{
  assert.equal(owns({sectionCode:'111-ada@example.com',actorEmail:admin},admin,owner,same),false);
});
test('ownership from nested push data follows same course scope',()=>{
  assert.equal(owns({data:{courseCode:'111-ada@example.com',teacherEmail:admin}},admin,owner,same),false);
  assert.equal(owns({data:{teacherEmail:admin}},admin,owner,same),true);
});
test('ownerless administrative broadcast is not a personal course alert',()=>{
  assert.equal(owns({role:'admin'},admin,owner,same),false);
});
test('device refusal describes evidence without asserting a copied token',()=>{
  const original={id:'a',studentId:'1',action:'محاولة كود مرفوضة',details:'محاولة دخول بتوكن منسوخ دون سر المتصفح الأصلي — الرمز: LAB-1234',isViolationWarning:true};
  const [display]=deviceAuditForDisplay([original]);
  assert.match(display.details,/عدم تطابق/);
  assert.equal(display.isViolationWarning,true);
  assert.match(original.details,/توكن منسوخ/);
  assert.match(display.details,/LAB-1234/);
});

const log={action:'محاولة كود مرفوضة',studentId:'1',details:'سبب — الرمز: LAB-1234-5678',at:10000};
const time=(item:any)=>item.at;
test('push and log for same student and code event appear once',()=>{
  assert.equal(duplicatesCodeIntegrityLog({type:'code_integrity',data:{studentId:'1',code:'LAB-1234-5678'},at:10010},[log],time),true);
});
test('different codes, students, older events and missing evidence remain visible',()=>{
  const note={type:'code_integrity',data:{studentId:'1',code:'LAB-1234-5678'},at:10010};
  assert.equal(duplicatesCodeIntegrityLog({...note,data:{...note.data,code:'LAB-OTHER'}},[log],time),false);
  assert.equal(duplicatesCodeIntegrityLog({...note,data:{...note.data,studentId:'2'}},[log],time),false);
  assert.equal(duplicatesCodeIntegrityLog({...note,at:100000},[log],time),false);
  assert.equal(duplicatesCodeIntegrityLog({...note,data:{studentId:'1'}},[log],time),false);
});
