import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';
import { createCloudSingleFlight, cloudSessionKey } from '../src/shared/cloud-single-flight.ts';
import { teacherWorkspaceReady } from '../src/shared/teacher-workspace-ready.ts';
import { cloudDataReady } from '../src/shared/cloud-data-ready.ts';

// Execute the actual App loaders, with network/state adapters and no browser,
// credentials, Firebase, or production data. No copied loader implementation.
const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const extract = (name, end) => {
 const start=source.indexOf(`  const ${name} = (`);
 assert.ok(start>0);
 return source.slice(start,source.indexOf(end,start));
};
const compile = async (snippet, name, context) => {
 const {code}=await transform(`${snippet}\nexport { ${name} };`,{loader:'ts',format:'cjs'});
 const module={exports:{}};
 new Function('module','exports',...Object.keys(context),code)(module,module.exports,...Object.values(context));
 return module.exports[name];
};
const deferred = () => {
 let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};
};
const turn=()=>new Promise(r=>setImmediate(r));
const payload=email=>({success:true,teacherEmail:email,sections:[],exams:[],projects:[],requests:[],logs:[],reports:{students:[],allowedStudents:[]}});

test('first teacher entry shares one HTTP read and applies all six datasets before opening',async()=>{
 const reply=deferred();let calls=0;
 const fixture=await teacherWithFetch(async(_url,init)=>{calls++;assert.equal(init.cache,'no-store');return reply.promise;});
 const first=fixture.load('teacher@test.kw'),second=fixture.load('teacher@test.kw');
 assert.equal(first,second);await turn();assert.equal(calls,1);assert.deepEqual(fixture.gate,{});
 reply.resolve(new Response(JSON.stringify(payload('teacher@test.kw'))));
 assert.equal(await first,true);assert.equal(fixture.applied.length,6);assert.equal(fixture.gate['teacher@test.kw'],true);
});
async function teacherWithFetch(fetchAdapter, requiredRead=async()=>true) {
 // Assign before compilation so the adapter is bound just like the production fetch function.
 const gate={},applied=[],state={token:'credential-one',gen:{current:1}};
 const context={cloudSessionKey,teacherWorkspaceReady,cloudDataReady,
  readStoredSessionAuthToken:()=>state.token,cloudSessionGenRef:state.gen,
  teacherCloudLoadInFlightRef:{current:createCloudSingleFlight()},teacherHeaders:()=>({}),
  setTeacherCloudLoads:()=>{},setTeacherCloudReady:fn=>Object.assign(gate,fn(gate)),fetch:fetchAdapter,
  fetchJoinCodes:async()=>{},fetchCodeIntegrity:async()=>{},fetchQuestionBank:async()=>{},fetchTeacherSubmissions:async()=>{},
  applyPasswordResetRequests:()=>applied.push('Requests')};
 for(const n of ['Sections','Exams','Projects','Logs','Reports'])context[`applyTeacher${n}`]=()=>applied.push(n);
 for(const n of ['fetchSections','fetchTeacherExams','fetchTeacherProjects','fetchPasswordResetRequests','fetchReports','fetchLogs'])context[n]=requiredRead;
 const load=await compile(extract('loadTeacherCloudData','\n  const fetchCodeIntegrity'),'loadTeacherCloudData',context);
 return {load,gate,applied,state,context};
}
test('second login reads the cloud again instead of reusing a settled result',async()=>{
 let calls=0;const f=await teacherWithFetch(async()=>{calls++;return new Response(JSON.stringify(payload('teacher@test.kw')));});
 assert.equal(await f.load('teacher@test.kw'),true);
 f.state.token='credential-two';f.state.gen.current++;delete f.gate['teacher@test.kw'];
 assert.equal(await f.load('teacher@test.kw'),true);assert.equal(calls,2);
});
test('network failure, incomplete payload, wrong identity and server warning keep teacher gate closed',async()=>{
 for(const data of [{}, {...payload('other@test.kw')}, {...payload('teacher@test.kw'),logs:null}, {...payload('teacher@test.kw'),reports:{students:[],allowedStudents:[],warning:'failed'}}]){
  const f=await teacherWithFetch(async()=>new Response(JSON.stringify(data)));
  assert.equal(await f.load('teacher@test.kw'),false);assert.deepEqual(f.gate,{});assert.deepEqual(f.applied,[]);
 }
 const f=await teacherWithFetch(async()=>{throw Error('offline');});assert.equal(await f.load('teacher@test.kw'),false);assert.deepEqual(f.gate,{});
});
test('an old account response cannot mark a new session ready or apply data',async()=>{
 const reply=deferred();const f=await teacherWithFetch(()=>reply.promise);
 const old=f.load('teacher@test.kw');await turn();f.state.token='credential-two';f.state.gen.current++;
 reply.resolve(new Response(JSON.stringify(payload('teacher@test.kw'))));
 assert.equal(await old,false);assert.deepEqual(f.gate,{});assert.deepEqual(f.applied,[]);
});

async function studentFixture(live, details) {
 const gate={},state={token:'student-one',gen:{current:1}}, applied=[];
 const context={cloudSessionKey,cloudSessionGenRef:state.gen,readStoredSessionAuthToken:()=>state.token,
  studentCloudLoadInFlightRef:{current:createCloudSingleFlight()},refreshStudentLiveState:live,
  fetch:details,jsonHeaders:()=>({}),setPersonalProject:p=>applied.push(p),setStudentSubmissions:s=>applied.push(s),
  cloudDataReady:(results,indices)=>indices.every(i=>results[i]?.status==='fulfilled'&&results[i].value===true),
  setStudentCloudReady:fn=>Object.assign(gate,fn(gate))};
 const load=await compile(extract('loadStudentCloudData','\n  const applyPasswordResetRequests'),'loadStudentCloudData',context);
 return {load,gate,state,applied,session:{id:'fixture-student',authToken:'student-one'}};
}
const detailsReply=()=>new Response(JSON.stringify({projects:[],exerciseSubmissions:[]}));
test('student live state and details start together; concurrent entry loads share both reads',async()=>{
 const live=deferred(),details=deferred();let liveCalls=0,detailCalls=0;
 const f=await studentFixture(()=>{liveCalls++;return live.promise;},()=>{detailCalls++;return details.promise;});
 const a=f.load(f.session),b=f.load(f.session);assert.equal(a,b);await turn();
 assert.equal(liveCalls,1);assert.equal(detailCalls,1);assert.deepEqual(f.gate,{});
 live.resolve(true);await turn();assert.deepEqual(f.gate,{});
 details.resolve(detailsReply());assert.equal(await a,true);assert.equal(f.gate[f.session.id],true);
});
test('student gate rejects failed live state or failed/incomplete details',async()=>{
 for(const [live,details] of [[false,detailsReply()],[true,new Response('{}')],[true,new Response('{}',{status:503})]]){
  const f=await studentFixture(async()=>live,async()=>details);
  assert.equal(await f.load(f.session),false);assert.deepEqual(f.gate,{});
 }
});
test('second student entry is fresh, and late results from an old session stay closed',async()=>{
 let calls=0;const f=await studentFixture(async()=>true,async()=>{calls++;return detailsReply();});
 assert.equal(await f.load(f.session),true);f.state.token='student-two';f.state.gen.current++;
 assert.equal(await f.load({...f.session,authToken:'student-two'}),true);assert.equal(calls,2);
 const delayed=deferred();const old=await studentFixture(async()=>true,()=>delayed.promise);
 const loading=old.load(old.session);await turn();old.state.token='student-two';old.state.gen.current++;
 delayed.resolve(detailsReply());assert.equal(await loading,false);assert.deepEqual(old.gate,{});assert.deepEqual(old.applied,[]);
});

test('single flight releases failures and keeps identities/credentials/generations separate',async()=>{
 const reads=createCloudSingleFlight();let count=0;const fail=()=>{count++;return Promise.reject(Error('offline'));};
 for(let i=0;i<2;i++)await assert.rejects(reads.run('one',fail));assert.equal(count,2);
 assert.notEqual(cloudSessionKey('a','b:1',1),cloudSessionKey('a:b','1',1));
 const reply=deferred();const a=reads.run(cloudSessionKey('a','one',1),()=>reply.promise);
 const b=reads.run(cloudSessionKey('a','two',1),()=>reply.promise);assert.notEqual(a,b);reply.resolve(true);await Promise.all([a,b]);
});

test('the initial teacher read sends the freshly stored credential before React updates the session',async()=>{
 const context={activeTeacherEmail:email=>email,readStoredSessionAuthToken:()=> 'new-credential',
  jsonHeaders:options=>({Authorization:`Bearer ${options.session?.authToken||'old-react-credential'}`})};
 const headers=await compile(extract('teacherHeaders','\n  const teacherScopedStorageKey'),'teacherHeaders',context);
 assert.equal(headers('teacher@test.kw').Authorization,'Bearer new-credential');
});
test('student bootstrap joins a running live poll instead of reporting false and delaying entry',async()=>{
 const reply=deferred(),state={token:'student-one'};let calls=0;const updates=[];
 const context={studentSession:{id:'fixture-student',authToken:'student-one'},
  cloudSessionGenRef:{current:1},studentLiveRefreshInFlightRef:{current:createCloudSingleFlight()},cloudSessionKey,
  readStoredSessionAuthToken:()=>state.token,jsonHeaders:()=>({}),
  fetch:()=>{calls++;return reply.promise;},liveStateFailStreakRef:{current:0},setLiveConnectionTrouble:()=>{},
  setLiveSyncInfo:fn=>fn({revision:0}),setStudentSession:()=>{},setStudentEnrollments:()=>updates.push('enrollments'),
  readLocalActivatedCourseCodes:()=>[],studentCourseFilter:'all',isCourseRecentlyActivated:()=>false,
  setTeacherCreatedExams:()=>updates.push('exams'),setTeacherProjects:()=>updates.push('projects'),isLiveRecord:()=>true};
 const snippet=source.slice(source.indexOf('  const performStudentLiveStateRefresh = async ('),source.indexOf('\n  const loadStudentCloudData'));
 const live=await compile(snippet,'refreshStudentLiveState',context);
 const poll=live(),initial=live(context.studentSession);assert.equal(poll,initial);await turn();assert.equal(calls,1);
 reply.resolve(new Response(JSON.stringify({enrollments:[],exams:[],projects:[]})));
 assert.equal(await initial,true);assert.deepEqual(updates,['enrollments','exams','projects']);
});

test('rolling deployment uses the previous authenticated API only if all six cloud reads succeed',async()=>{
 for(const reply of [()=>new Response('{}',{status:404}),()=>new Response('<html/>',{headers:{'content-type':'text/html'}})]){
  let reads=0;const ready=await teacherWithFetch(async()=>reply(),async()=>{reads++;return true;});
  assert.equal(await ready.load('teacher@test.kw'),true);assert.equal(reads,6);
  let readIndex=0;const failed=await teacherWithFetch(async()=>reply(),async()=>++readIndex!==4);
  assert.equal(await failed.load('teacher@test.kw'),false);assert.deepEqual(failed.gate,{});
 }
});
