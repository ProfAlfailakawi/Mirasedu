import assert from 'node:assert/strict';
import { api, makeJar, createReporter, AA, BB } from './lib.mjs';
const {check,done}=createReporter('FLOWS / CLOUD WORKSPACE');
const teacherPassword=process.env.TEST_TEACHER_PASSWORD||'change-me-in-ci';
const admin='ah.alfailakawi@paaet.edu.kw';
const rejected=await api('GET','/api/teacher/workspace');
check('workspace rejects unauthenticated callers',rejected.status===401);
const studentJar=makeJar();
await api('POST','/api/auth/login',{idNumber:'1001',password:'pass1001'},{jar:studentJar,deviceToken:'tok-1001'});
const noTeacher=await api('GET','/api/teacher/workspace',null,{jar:studentJar,deviceToken:'tok-1001'});
check('student cannot load a teacher workspace',noTeacher.status===401);
await api('POST','/api/auth/forgot-password',{idNumber:'1001'});
for(const email of [AA,BB,admin]){
 const jar=makeJar(),opts={jar,deviceToken:`fixture-${email}`};
 const login=await api('POST','/api/auth/login',{idNumber:email,password:teacherPassword},opts);
 check(`${email}: first login succeeds`,login.ok);
 const r=await api('GET','/api/teacher/workspace',null,opts);
 check(`${email}: bootstrap has all required arrays and verified identity`,r.ok&&r.data.success&&r.data.teacherEmail===email&&['sections','exams','projects','requests','logs'].every(k=>Array.isArray(r.data[k]))&&Array.isArray(r.data.reports?.students)&&Array.isArray(r.data.reports?.allowedStudents));
 check(`${email}: response exposes workspace timing`,/workspace;dur=/.test(r.serverTiming||''));
 const legacy=await Promise.all(['sections','exams','projects','password-reset-requests','logs','reports'].map(path=>api('GET',`/api/teacher/${path}`,null,opts)));
 let identical=true;try{
  for(const [i,key] of ['sections','exams','projects','requests','logs'].entries())assert.deepEqual(r.data[key],legacy[i].data[key]);
  assert.deepEqual(r.data.reports,legacy[5].data);
 }catch{identical=false;}
 check(`${email}: single read matches all six established endpoints`,identical);
 const repeat=await api('GET','/api/teacher/workspace',null,opts);
 check(`${email}: subsequent account entry still reads complete data`,repeat.ok&&repeat.data.success);
 const forged=await api('GET',`/api/teacher/workspace?includeAll=1&teacherEmail=${encodeURIComponent(email===BB?AA:BB)}`,null,{...opts,headers:{'x-teacher-email':email===BB?AA:BB}});
 check(`${email}: query and header cannot change the signed-in identity`,forged.data.teacherEmail===email);
 check(`${email}: personal bootstrap never includes another teacher's sections`,forged.data.sections?.every(s=>s.ownerEmail===email));
}
done();
