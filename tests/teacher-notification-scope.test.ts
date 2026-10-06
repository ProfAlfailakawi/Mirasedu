import test from 'node:test';
import assert from 'node:assert/strict';
import { teacherOwnsNotification as owns, duplicatesCodeIntegrityLog, currentPasswordResetNotification, pendingDeviceApprovalNotifications } from '../src/shared/teacher-notification-scope';
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
test('direct personal notices work across roles while student and foreign notices stay out',()=>{
  assert.equal(owns({role:'admin',userId:admin},admin,owner,same),true);
  assert.equal(owns({role:'admin',userId:'other@example.com'},admin,owner,same),false);
  assert.equal(owns({role:'student',data:{teacherEmail:admin}},admin,owner,same),false);
  assert.equal(owns({role:'teacher',userId:admin,data:{teacherEmail:'other@example.com'}},admin,owner,same),false);
  assert.equal(owns({targetSectionCode:'111-ada@example.com',sectionCode:`111-${admin}`},admin,owner,same),false);
});
test('expired, handled, deleted and superseded recovery notices are not pending alerts',()=>{
  const now=Date.parse('2026-10-06T10:00:00Z');
  const request={id:'new',studentId:'1',status:'new',requestedAt:'2026-10-06T09:45:00Z',expiresAt:'2026-10-06T10:45:00Z'};
  const note={type:'password_reset',createdAt:request.requestedAt,data:{studentId:'1',requestId:'new'}};
  assert.equal(currentPasswordResetNotification(note,[request],now),true);
  for(const rows of [[],[{...request,status:'handled'}],[{...request,expiresAt:'2026-10-06T09:59:59Z'}],[{...request,id:'different'}]])assert.equal(currentPasswordResetNotification(note,rows,now),false);
  assert.equal(currentPasswordResetNotification({...note,data:{studentId:'2',requestId:'new'}},[request],now),false);
  assert.equal(currentPasswordResetNotification({...note,createdAt:'2026-10-06T09:00:00Z',data:{studentId:'1'}},[request],now),false);
  assert.equal(currentPasswordResetNotification({...note,data:{studentId:'1'}},[request],now),true);
  assert.equal(currentPasswordResetNotification(note,[request,{...request,id:'done',status:'handled',handledAt:'2026-10-06T09:50:00Z'}],now),false);
  assert.equal(currentPasswordResetNotification({type:'exam_cheating_attempt'},[],now),true);
});
test('the approval bell contains one actual pending request rather than ordinary device audits',()=>{
  const request={id:'one',linkedStudentId:'1',targetSectionCode:'111-aa@test.kw',approvalRequestType:'second_hand_device',approvalStatus:'pending',timestamp:'2026-10-06T09:00:00Z'};
  const rows=[request,{...request,id:'two',timestamp:'2026-10-06T09:01:00Z'},{...request,id:'done',linkedStudentId:'2',approvalStatus:'approved'},{id:'audit',studentId:'3',reason:'محاولة دخول ببصمة جهاز مختلفة'}];
  assert.deepEqual(pendingDeviceApprovalNotifications(rows).map(x=>x.id),['two']);
  assert.equal(rows.length,4);
  assert.equal(pendingDeviceApprovalNotifications([...rows,{...request,id:'other',linkedStudentId:'4'}]).length,2);
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
