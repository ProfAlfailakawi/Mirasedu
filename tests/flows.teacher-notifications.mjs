import { api, makeJar, createReporter, BB } from './lib.mjs';
const {check,done}=createReporter('FLOWS / PERSONAL TEACHER NOTIFICATIONS');
const admin='ah.alfailakawi@paaet.edu.kw',pw=process.env.TEST_TEACHER_PASSWORD||'change-me-in-ci';
for(const [email,role,expected] of [[admin,'admin',['own-admin','own-teacher-role','reset-current']],[admin,'teacher',['own-admin','own-teacher-role','reset-current']],[BB,'teacher',['foreign-admin-role']]]){
  const jar=makeJar(),deviceToken='notice-'+email;
  const login=await api('POST','/api/auth/login',{idNumber:email,password:pw},{jar,deviceToken});
  check('personal inbox login '+email+' '+role,login.ok);
  const response=await api('GET',`/api/notifications/inbox?userId=${encodeURIComponent(email)}&role=${role}`,null,{jar,deviceToken});
  const ids=(response.data.notifications||[]).map(note=>note.id).sort();
  check('only current own alerts for '+email+' '+role,response.ok&&JSON.stringify(ids)===JSON.stringify([...expected].sort()),JSON.stringify(ids));
  if(email===admin){
    const foreign=await api('GET',`/api/notifications/inbox?userId=${encodeURIComponent(BB)}&role=teacher`,null,{jar,deviceToken});
    check('admin cannot use another teacher identity in a personal inbox',foreign.status===403||foreign.status===401,String(foreign.status));
  }
}
done();
