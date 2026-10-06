import { groupSecurityNotifications } from "../src/shared/security-notification-groups.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';
import { teacherOwnsNotification, duplicatesCodeIntegrityLog, pendingDeviceApprovalNotifications } from '../src/shared/teacher-notification-scope.ts';
import { deviceReviewNotifications, deviceReviewPushNotifications } from '../src/shared/device-review-notifications.ts';
import { deviceAuditForDisplay } from '../src/shared/device-audit.ts';
import { homePasswordResets } from '../src/shared/home-password-reset-requests.ts';
import { notificationIdentity } from '../src/shared/notification-identity.ts';
const email='admin@test.kw',course='111-'+email;
const source=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
const begin=source.indexOf('  const criticalTeacherNotifications = useMemo(() => {');
const end=source.indexOf('\n\n  // يخفي زر جرس المعلم',begin);
assert.ok(begin>0&&end>begin);
const {code}=await transform(source.slice(begin,end),{loader:'tsx'});
const execute=new Function('context','with(context){'+code+';return criticalTeacherNotifications;}');
function feed(patch={}){
  const owns=item=>teacherOwnsNotification(item,email,value=>String(value).split('-').slice(1).join('-'),(a,b)=>String(a).toLowerCase()===String(b).toLowerCase());
  const values={useMemo:callback=>callback(),groupSecurityNotifications,teacherOwnsNotification,duplicatesCodeIntegrityLog,pendingDeviceApprovalNotifications,deviceReviewNotifications,deviceReviewPushNotifications,deviceAuditForDisplay,homePasswordResets,currentTeacherEmail:email,courseOwnerEmail:value=>String(value).split('-').slice(1).join('-'),isSameTeacherIdentity:(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),isAdminTeacher:true,systemLogs:[],deviceProblemAttempts:[],codeIntegrity:{attempts:[]},passwordResetRequests:[],homePasswordResetRequests:[],teacherImportantReadKeys:new Set(),localNotifications:[],teacherCreatedExams:[],teacherProjects:[],teacherStudents:[],teacherSubmissions:[],activeCourseExamSubmissions:[],livePulseStudentRows:[],assignedNotActivatedCodes:[],firestoreQuotaExceededState:false,activeCourseCode:'',teacherSession:{email},normalizeLocalNotification:item=>item,notificationTargetsTeacher:owns,isCriticalTeacherInAppNotification:note=>['code_integrity','exam_warning','password_reset','second_hand_device_approval'].includes(note.type),stableNotificationId:notificationIdentity,sanitizeCourseIdentifiersForDisplay:x=>x,logActionLabel:x=>x,openTeacherTab:()=>{},studentBelongsToCourse:()=>false,...patch};
  return execute(new Proxy(values,{has:()=>true,get:(target,key)=>key===Symbol.unscopables?undefined:(key in target?target[key]:globalThis[key])}));
}
const log={id:'one',studentId:'1',sectionCode:course,studentName:'طالب',action:'محاولة كود مرفوضة',details:'محاولة دخول بتوكن منسوخ دون سر المتصفح الأصلي — الرمز: LAB-AAAA-BBBB-CCCC',timestamp:'2026-10-06T00:21:00Z',isViolationWarning:true};
test('the actual feed renders four legacy binding warnings and their push copies once',()=>{
  const rows=[log,...[22,27,28].map(min=>({...log,id:'log-'+min,timestamp:`2026-10-06T00:${min}:00Z`}))];
  const local=rows.map(row=>({id:'push-'+row.id,userId:email,type:'code_integrity',title:'تنبيه نزاهة',createdAt:row.timestamp,data:{studentId:'1',teacherEmail:email,code:'LAB-AAAA-BBBB-CCCC'}}));
  const result=feed({systemLogs:[...rows,{...log,id:'foreign',sectionCode:'111-other@test.kw'}],localNotifications:local});
  assert.equal(result.length,1);assert.equal(result[0].tone,'amber');assert.match(result[0].title,/متصفح غير معتمد/);assert.doesNotMatch(result[0].body,/منسوخ|غش/);
  assert.equal(feed({systemLogs:rows,teacherImportantReadKeys:new Set(['admin-log-log-27'])}).length,0);
});
test('the actual feed shows all own current requests once beyond the four home-card limit',()=>{
  const now=Date.now(),requests=Array.from({length:6},(_,i)=>({id:'r'+i,studentId:String(i),teacherEmail:email,sectionCode:course,status:'new',requestedAt:new Date(now-i*1000).toISOString(),expiresAt:new Date(now+3600000).toISOString()}));
  const result=feed({passwordResetRequests:[...requests,{...requests[0],id:'handled',status:'handled'},{...requests[0],id:'foreign',teacherEmail:'other@test.kw',sectionCode:'111-other@test.kw'}],localNotifications:[{id:'stale-push',type:'password_reset',userId:email,title:'استرجاع',data:{teacherEmail:email,studentId:'0'}}]});
  assert.equal(result.length,6);assert.ok(result.every(row=>row.key.startsWith('teacher-reset-')));
  assert.equal(result[0].key,'teacher-reset-r0');
});
test('old push duplicates still group when their audit entries have left the latest audit page',()=>{
 const notes=[21,22,27,28].map(min=>({id:'push'+min,userId:email,type:'code_integrity',title:'تنبيه نزاهة',body:'محاولة دخول بتوكن منسوخ دون سر المتصفح الأصلي',createdAt:`2026-10-06T00:${min}:00Z`,data:{studentId:'1',teacherEmail:email,code:'LAB-AAAA-BBBB-CCCC'}}));
 const result=feed({localNotifications:notes});assert.equal(result.length,1);assert.equal(result[0].tone,'amber');assert.doesNotMatch(result[0].body,/منسوخ/);
 assert.equal(feed({localNotifications:notes,teacherImportantReadKeys:new Set(['admin-inapp-push27'])}).length,0);
});
test('ordinary success, studying and unused codes do not become important warnings',()=>{
  const result=feed({isAdminTeacher:false,systemLogs:[{...log,action:'تسجيل دخول',details:'تسجيل دخول ناجح',isViolationWarning:false},{...log,id:'admin-edit',details:'تمت المعالجة دون مخالفة',isViolationWarning:false}],livePulseStudentRows:[{activeSubmission:true}],assignedNotActivatedCodes:[{id:'unused'}]});
  assert.equal(result.length,0);
});
test('one pending approval from another own course remains visible; resolved approvals stay out',()=>{
  const approval={id:'approval',studentId:'1',targetSectionCode:course,approvalRequestType:'second_hand_device',approvalStatus:'pending',timestamp:log.timestamp};
  const result=feed({isAdminTeacher:false,activeCourseCode:'222-'+email,codeIntegrity:{attempts:[approval,{...approval,id:'handled',studentId:'2',approvalStatus:'approved'},{...approval,id:'audit',approvalRequestType:'',reason:'جهاز مختلف'}]},localNotifications:[{userId:email,type:'second_hand_device_approval',data:{courseCode:course}}]});
  assert.equal(result.length,1);assert.equal(result[0].approvalRequestId,'approval');
});
test('different students and genuinely different warning events remain in the actual feed',()=>{
  const result=feed({localNotifications:['1','2'].map(studentId=>({id:'note'+studentId,userId:email,type:'exam_warning',title:'تنبيه نزاهة',createdAt:log.timestamp,data:{studentId,teacherEmail:email,notificationId:'event'+studentId}}))});
  assert.equal(result.length,2);assert.notEqual(result[0].key,result[1].key);
});
test('repeating an unresolved request keeps its read key and does not resurrect the same alert',()=>{
 const now=Date.now(),first={id:'first',studentId:'1',teacherEmail:email,sectionCode:course,status:'new',requestedAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+3600000).toISOString()};
 const second={...first,id:'second',requestedAt:new Date(now-1000).toISOString()};
 const result=feed({passwordResetRequests:[first,second]});assert.equal(result.length,1);assert.equal(result[0].key,'teacher-reset-first');
 assert.equal(feed({passwordResetRequests:[first,second],teacherImportantReadKeys:new Set(['teacher-reset-first'])}).length,0);
 assert.equal(feed({passwordResetRequests:[{...first,status:'handled'},second]}).length,1);
});
