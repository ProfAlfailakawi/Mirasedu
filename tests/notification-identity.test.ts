import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationRole, notificationIdentity, notificationSignature } from '../src/shared/notification-identity';
const base={role:'teacher',userId:'teacher@test.kw',type:'code_integrity',title:'تنبيه نزاهة كود',body:'محاولة مرفوضة',data:{studentId:'1',courseCode:'111-teacher@test.kw',code:'LAB-AAAA-BBBB-CCCC'}};
test('the bell and FCM use the same event id despite their different record ids',()=>{
 const bell={...base,id:'note-record',data:{...base.data,notificationId:'event-one'}};
 const push={...base,id:'fcm-record',role:'admin',data:{...base.data,notificationId:'event-one'}};
 assert.equal(notificationIdentity(bell),'event-one');
 assert.equal(notificationIdentity(push),notificationIdentity(bell));
 assert.equal(notificationSignature(bell),notificationSignature(push));
});
test('different events remain separate even on the same activity and student',()=>{
 const a={...base,data:{...base.data,examId:'exam',notificationId:'event-a'}};
 const b={...a,data:{...a.data,notificationId:'event-b'}};
 assert.notEqual(notificationSignature(a),notificationSignature(b));
});
test('legacy teacher notices distinguish the affected student, code, course and reason',()=>{
 for(const change of [{studentId:'2'},{code:'LAB-OTHER'},{courseCode:'222-teacher@test.kw'}])assert.notEqual(notificationSignature(base),notificationSignature({...base,data:{...base.data,...change}}));
 assert.notEqual(notificationSignature(base),notificationSignature({...base,body:'سبب مختلف'}));
 assert.equal(notificationSignature(base),notificationSignature({...base,role:'admin',userId:'TEACHER@test.kw'}));
});
test('separate recipients and student inboxes cannot be collapsed',()=>{
 assert.notEqual(notificationSignature(base),notificationSignature({...base,userId:'other@test.kw'}));
 assert.notEqual(notificationSignature(base),notificationSignature({...base,role:'student'}));
 assert.equal(notificationRole('super_admin'),'teacher');
 assert.equal(notificationRole('students'),'student');
});
test('legacy records retain their original id when no shared event id exists',()=>{
 assert.equal(notificationIdentity({...base,id:'old-note'}),'old-note');
});
