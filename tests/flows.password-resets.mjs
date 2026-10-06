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
done();
