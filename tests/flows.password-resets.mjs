import { api, makeJar, createReporter, AA, BB } from './lib.mjs';
const {check,done}=createReporter('FLOWS / PASSWORD RESET ROUTING');
const owner=makeJar(), colleague=makeJar(), admin=makeJar();
for (const [email,jar] of [[AA,owner],[BB,colleague],['ah.alfailakawi@paaet.edu.kw',admin]]) {
 const r=await api('POST','/api/auth/login',{idNumber:email,password:process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci'},{deviceToken:`reset-${email}`,jar});
 check(`login ${email}`,r.ok);
}
for(let n=0;n<2;n++) {
 const r=await api('POST','/api/auth/forgot-password',{idNumber:'1001'});
 check('student requests temporary reset',r.ok);
}
let r=await api('GET','/api/teacher/password-reset-requests',undefined,{jar:owner});
const requests=(r.data.requests || []).filter(x=>x.studentId==='1001' && x.status==='new');
check('owner receives both pending requests with correct ownership',requests.length===2 && requests.every(x=>x.teacherEmail===AA),JSON.stringify(r.data));
const newest=requests.sort((a,b)=>Date.parse(b.requestedAt)-Date.parse(a.requestedAt))[0];
if(newest) {
 r=await api('GET',`/api/notifications/inbox?userId=${encodeURIComponent(AA)}&role=teacher`,undefined,{jar:owner});
 check('owner personal inbox receives current own student reset',r.ok && (r.data.notifications || []).some(x=>x.type==='password_reset' && x.data?.studentId==='1001'),JSON.stringify(r.data));
 r=await api('DELETE',`/api/teacher/password-reset-requests/${newest.id}`,undefined,{jar:owner});
 check('delete confirms both old duplicate and selected request',r.ok && r.data.deletedIds?.length===2,JSON.stringify(r.data));
 r=await api('GET','/api/teacher/password-reset-requests',undefined,{jar:owner});
 check('older duplicate does not reappear after deletion',!(r.data.requests || []).some(x=>x.studentId==='1001' && x.status==='new'));
 for(const item of requests) {
  r=await api('POST','/api/auth/reset-password',{token:new URL(item.resetLink).searchParams.get('resetToken'),newPassword:'FreshPass998'});
  check('deleted reset token is unusable',!r.ok);
 }
}
r=await api('GET',`/api/notifications/inbox?userId=${encodeURIComponent('ah.alfailakawi@paaet.edu.kw')}&role=admin`,undefined,{jar:admin});
check('superadmin personal inbox excludes colleague student resets',r.ok && !(r.data.items || r.data.notifications || []).some(x=>x.type==='password_reset' && x.data?.studentId==='1001'),JSON.stringify(r.data));
r=await api('GET',`/api/notifications/inbox?userId=${encodeURIComponent(AA)}&role=teacher`,undefined,{jar:owner});
check('deleted recovery requests disappear from the personal inbox',r.ok && !(r.data.items || r.data.notifications || []).some(x=>x.type==='password_reset' && x.data?.studentId==='1001'),JSON.stringify(r.data));
// Teacher-issued retry link is a one-time password reset permission, not a
// device transfer: it works on a different browser while login remains bound.
r=await api('POST','/api/auth/forgot-password',{idNumber:'1001'});
check('student can request a fresh password-reset link',r.ok,JSON.stringify(r.data));
let resetList=await api('GET','/api/teacher/password-reset-requests',undefined,{jar:owner});
let portableRequest=(resetList.data.requests||[]).find(x=>x.studentId==='1001'&&x.status==='new');
if(portableRequest){
 const priorLink=portableRequest.resetLink;
 const approved=await api('POST',`/api/teacher/password-reset-requests/${portableRequest.id}/resend`,undefined,{jar:owner});
 portableRequest=approved.data.request;
 check('teacher issues a fresh any-device recovery link',approved.ok&&portableRequest?.resetLink&&portableRequest.resetLink!==priorLink&&portableRequest.teacherApprovedAnyDeviceAt,JSON.stringify(approved.data));
 const crossDeviceReset=await api('POST','/api/auth/reset-password',{token:new URL(portableRequest.resetLink).searchParams.get('resetToken'),newPassword:'PortablePass998'},{deviceToken:'untrusted-reset-device'});
 check('teacher-approved link resets password from another device',crossDeviceReset.ok,JSON.stringify(crossDeviceReset.data));
 const originalDeviceLogin=await api('POST','/api/auth/login',{idNumber:'1001',password:'PortablePass998'},{deviceToken:'tok-1001'});
 check('password reset keeps the original device authorized',originalDeviceLogin.ok,JSON.stringify(originalDeviceLogin.data).slice(0,200));
 const newDeviceLogin=await api('POST','/api/auth/login',{idNumber:'1001',password:'PortablePass998'},{deviceToken:'untrusted-reset-device'});
 check('password reset does not transfer device authorization',!newDeviceLogin.ok,JSON.stringify(newDeviceLogin.data).slice(0,200));
}else check('teacher sees the current request for portable reset',false,JSON.stringify(resetList.data));
// Older student records can carry the university number in studentNumber/idNumber
// instead of id. The reset request, link routing and password update must still
// resolve to the same canonical student account.
r=await api('POST','/api/auth/forgot-password',{idNumber:'9009'});
check('student-number alias can request password reset',r.ok,JSON.stringify(r.data));
let aliasRequests=await api('GET','/api/teacher/password-reset-requests',undefined,{jar:owner});
const aliasRequest=(aliasRequests.data.requests||[]).find(x=>x.studentId==='9009'&&x.status==='new');
check('alias reset request routes to the student owner',!!aliasRequest&&aliasRequest.teacherEmail===AA,JSON.stringify(aliasRequest));
if(aliasRequest){
 const aliasReset=await api('POST','/api/auth/reset-password',{token:new URL(aliasRequest.resetLink).searchParams.get('resetToken'),newPassword:'FreshAlias998'},{deviceToken:'tok-1001'});
 check('alias reset link updates the canonical student account',aliasReset.ok,JSON.stringify(aliasReset.data));
}
// A student changing their own password through the reset link is routine: no teacher alert.
r=await api('GET',`/api/notifications/inbox?userId=${encodeURIComponent(AA)}&role=teacher`,undefined,{jar:owner});
check('student self-service password change does not alert the teacher',r.ok && !(r.data.items || r.data.notifications || []).some(x=>(x.type||x.data?.type)==='password_changed'),JSON.stringify(r.data).slice(0,200));
done();
