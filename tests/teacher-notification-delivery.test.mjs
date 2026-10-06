import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { transform } from 'esbuild';
import { notificationRole, notificationSignature, notificationEventIdentity } from '../src/shared/notification-identity.ts';
import { teacherOwnsNotification, currentPasswordResetNotification } from '../src/shared/teacher-notification-scope.ts';

// Execute the actual delivery functions with an in-memory DB and fake FCM.
// No Firebase config, tokens, network, or real accounts are used.
async function fixture(tokens=[]) {
  const source=fs.readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('function notificationTargets('),source.indexOf('type ActivationRateBucket ='));
  const {code}=await transform(block,{loader:'ts'});
  const notes=[],pushes=[],dispatches={},requests=[];
  const db={getNotificationTokens:()=>tokens,getNotificationDispatches:()=>dispatches,rememberNotificationDispatch:key=>dispatches[key]='sent',getInAppNotifications:()=>notes,addInAppNotification:note=>notes.push(note),updateNotificationAudit:()=>{},disableNotificationToken:()=>{},getPasswordResetRequests:()=>requests};
  const sections=[{code:'111-owner@test.kw',ownerEmail:'owner@test.kw'},{code:'111-other@test.kw',ownerEmail:'other@test.kw'},{code:'222-admin@test.kw',ownerEmail:'admin@test.kw'}];
  const names=['dbInstance','crypto','sanitizePublicMessageText','normalizeStudentId','activeSections','extractEmailFromSectionCode','sectionDisplayCode','isAdminEmail','notificationRole','notificationSignature','notificationEventIdentity','shouldSuppressRoutineStudentNotification','sendFcmToToken','fcmFailureClass','setTimeout','clearTimeout'];
  const values=[db,crypto,value=>String(value||''),value=>String(value||''),()=>sections,value=>String(value||'').match(/[a-z0-9.]+@[a-z0-9.]+/i)?.[0]||'',value=>String(value||'').split('-')[0],email=>email==='admin@test.kw',notificationRole,notificationSignature,notificationEventIdentity,()=>false,async(token,title,body,data)=>{pushes.push({token,title,body,data});return {sent:true};},()=> 'transient',()=>1,()=>{}];
  names.push('teacherOwnsNotification','currentPasswordResetNotification');values.push(teacherOwnsNotification,currentPasswordResetNotification);
  const api=new Function(...names,code+'\nreturn {notifyTeachersForSection,rememberInAppNotification,teacherNotificationOwner};')(...values);
  return {...api,notes,pushes,requests};
}
const token=(userId,role,token,updatedAt='2026-10-06T09:00:00Z')=>({userId,teacherEmail:userId,role,token,permission:'granted',updatedAt,deviceToken:token,sectionCode:'111-other@test.kw'});
test('routine activation, registration, login and submission produce no teacher push or bell',async()=>{
  const f=await fixture([token('owner@test.kw','teacher','own')]);
  for(const type of ['student_registered','course_activated','code_used','student_logged_in','exam_submission','project_submission'])f.notifyTeachersForSection('111-owner@test.kw','حدث طالب','تم بنجاح',{type,studentId:'1'});
  assert.equal(f.pushes.length,0);assert.equal(f.notes.length,0);
});
test('one personal warning reaches its owner; the admin and other teacher receive nothing',async()=>{
  const f=await fixture([token('owner@test.kw','teacher','own'),token('admin@test.kw','admin','admin'),token('other@test.kw','teacher','other')]);
  f.notifyTeachersForSection('111-owner@test.kw','تنبيه نزاهة','تحتاج مراجعة',{type:'code_integrity',studentId:'1',code:'LAB-AAAA'});
  await Promise.resolve();
  assert.equal(f.pushes.length,1);assert.equal(f.pushes[0].token,'own');assert.equal(f.notes.length,1);
  assert.equal(f.notes[0].data.teacherEmail,'owner@test.kw');
  assert.equal(f.notes[0].data.courseCode,'111-owner@test.kw');
  assert.equal(f.notes[0].sectionCode,'111-owner@test.kw');
  assert.equal(f.notes[0].data.notificationId,f.pushes[0].data.notificationId);
});
test('teacher/admin registrations on the same account select one latest push and one bell',async()=>{
  const f=await fixture([token('admin@test.kw','admin','old'),token('ADMIN@test.kw','teacher','new','2026-10-06T09:01:00Z')]);
  const data={type:'code_integrity',studentId:'1',notificationId:'one-event'};
  f.notifyTeachersForSection('222-admin@test.kw','تنبيه نزاهة','تحتاج مراجعة',data);await Promise.resolve();
  f.notifyTeachersForSection('222-admin@test.kw','تنبيه نزاهة','تحتاج مراجعة',data);await Promise.resolve();
  assert.equal(f.pushes.length,1);assert.equal(f.pushes[0].token,'new');assert.equal(f.notes.length,1);
});
test('no push is broadcast for missing, unknown or ambiguous course owners',async()=>{
  const f=await fixture([token('admin@test.kw','admin','admin'),token('other@test.kw','teacher','other')]);
  for(const course of ['',undefined,'unknown','111'])assert.equal(f.notifyTeachersForSection(course,'تنبيه نزاهة','تحتاج مراجعة',{type:'code_integrity'}),0);
  assert.equal(f.pushes.length,0);assert.equal(f.notes.length,0);
});
test('important requests, cheating and exam exits retain a personal bell without FCM',async()=>{
  const f=await fixture();
  for(const type of ['password_reset','exam_cheating_attempt','exam_exited_before_submit','exam_warning'])f.notifyTeachersForSection('111-owner@test.kw','تنبيه مهم',type,{type,teacherEmail:'owner@test.kw',studentId:'1'});
  assert.equal(f.notes.length,4);
  assert.ok(f.notes.every(note=>note.userId==='owner@test.kw'&&note.data.notificationId));
});
test('distinct students with identical names/text do not lose alerts',async()=>{
  const f=await fixture([token('owner@test.kw','teacher','own')]);
  for(const studentId of ['1','2'])f.notifyTeachersForSection('111-owner@test.kw','تنبيه نزاهة','طالب بنفس الاسم',{type:'code_integrity',studentId,code:'LAB-AAAA'});
  assert.equal(f.pushes.length,2);assert.equal(f.notes.length,2);
  assert.notEqual(f.pushes[0].data.notificationId,f.pushes[1].data.notificationId);
});
test('repeated requests while recovery is pending do not send repeated pushes; a fresh resolved request can notify',async()=>{
 const f=await fixture([token('owner@test.kw','teacher','own')]);
 const first={id:'r1',studentId:'1',status:'new',requestedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
 f.requests.push(first);f.notifyTeachersForSection('111-owner@test.kw','طلب استرجاع','طالب يطلب الاسترجاع',{type:'password_reset',studentId:'1',requestId:'r1',teacherEmail:'owner@test.kw'});await Promise.resolve();
 f.requests.push({...first,id:'r2'});f.notifyTeachersForSection('111-owner@test.kw','طلب استرجاع','طالب يطلب الاسترجاع',{type:'password_reset',studentId:'1',requestId:'r2',teacherEmail:'owner@test.kw'});await Promise.resolve();
 assert.equal(f.pushes.length,1);assert.equal(f.notes.length,1);
 f.requests.forEach(request=>request.status='handled');f.requests.push({...first,id:'r3'});
 f.notifyTeachersForSection('111-owner@test.kw','طلب استرجاع','طالب يطلب الاسترجاع',{type:'password_reset',studentId:'1',requestId:'r3',teacherEmail:'owner@test.kw'});await Promise.resolve();
 assert.equal(f.pushes.length,2);assert.equal(f.notes.length,2);
});
