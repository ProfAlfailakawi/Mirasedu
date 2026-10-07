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
 const context={cloudSessionKey,teacherWorkspaceReady,cloudDataReady,teacherTabRef:{current:"home"},
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


test('a late personal bootstrap cannot overwrite an open administrative audit', async () => {
 const reply = deferred();
 const fixture = await teacherWithFetch(() => reply.promise);
 const loading = fixture.load('teacher@test.kw');
 await turn();
 fixture.context.teacherTabRef.current = 'codes';
 reply.resolve(new Response(JSON.stringify(payload('teacher@test.kw'))));
 assert.equal(await loading, true);
 assert.deepEqual(fixture.applied, ['Exams', 'Projects', 'Requests']);
});

test('audit reads reject old responses after all/self/all and tab or credential changes', async () => {
 const context = { auditContextRef: { current: { epoch: 1 } }, teacherTabRef: { current: 'codes' },
  auditScopeRef: { current: 'all' }, cloudSessionGenRef: { current: 1 },
  readStoredSessionAuthToken: () => context.token, token: 'fixture-token' };
 const capture = await compile(extract('captureTeacherRead', '\n  const getTeacherUrlParams'), 'captureTeacherRead', context);
 const first = capture();
 assert.equal(first(), true);
 context.auditScopeRef.current = 'self'; context.auditContextRef.current.epoch++;
 assert.equal(first(), false);
 context.auditScopeRef.current = 'all'; context.auditContextRef.current.epoch++;
 assert.equal(first(), false);
 const second = capture(); assert.equal(second(), true);
 context.teacherTabRef.current = 'home'; assert.equal(second(), false);
 context.teacherTabRef.current = 'codes'; context.token = 'another-token'; assert.equal(second(), false);
});

test('integrity read validates counters and never turns a failed cloud read into zero data', async () => {
 const start = source.indexOf('  const fetchCodeIntegrity = async (');
 const snippet = source.slice(start, source.indexOf('\n  // شفاء ذاتي', start));
 for (const data of [{ success: false }, { success: true }, { success: true, codeHealthFunnel: { issued: 0 } }]) {
  const applied = [], context = { captureTeacherRead: () => () => true, captureTeacherSession: () => ({ isCurrent: () => true }),
   activeTeacherEmail: () => 'fixture@test.kw', getTeacherUrlParams: () => '?teacherEmail=fixture%40test.kw',
   teacherTabRef: { current: 'codes' }, auditScopeRef: { current: 'self' }, teacherHeaders: () => ({}),
   fetch: async url => { assert.equal(new URL(url, 'http://localhost').searchParams.get('scope'), 'self'); return new Response(JSON.stringify(data)); },
   setCodeIntegrity: value => applied.push(value) };
  const read = await compile(snippet, 'fetchCodeIntegrity', context);
  const valid = data.success && Number.isFinite(data.codeHealthFunnel?.issued);
  assert.equal(await read(), !!valid);
  assert.equal(applied.length, valid ? 1 : 0);
 }
});

const paintScheduler = async () => {
 let nextId = 0;
 const frames = new Map(), timers = new Map();
 const window = {
  requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
  cancelAnimationFrame: id => frames.delete(id),
  setTimeout: callback => { const id = ++nextId; timers.set(id, callback); return id; },
  clearTimeout: id => timers.delete(id),
 };
 const start = source.indexOf('const scheduleAfterWorkspacePaint = (');
 const snippet = source.slice(start, source.indexOf('\nasync function mirasFetchWithRecovery', start));
 const schedule = await compile(snippet, 'scheduleAfterWorkspacePaint', { window });
 const flush = map => { const pending = [...map.values()]; map.clear(); pending.forEach(callback => callback()); };
 return { schedule, frame: () => flush(frames), tasks: () => flush(timers) };
};

test('optional workspace work starts after a painted frame and can be cancelled at every stage', async () => {
 for (const cancelAt of ['before-first-frame', 'between-frames', 'before-task', 'never']) {
  const scheduler = await paintScheduler(); let calls = 0;
  const cancel = scheduler.schedule(() => calls++);
  assert.equal(calls, 0);
  if (cancelAt === 'before-first-frame') cancel();
  scheduler.frame(); assert.equal(calls, 0);
  if (cancelAt === 'between-frames') cancel();
  scheduler.frame(); assert.equal(calls, 0);
  if (cancelAt === 'before-task') cancel();
  scheduler.tasks(); assert.equal(calls, cancelAt === 'never' ? 1 : 0);
 }
});

test('teacher login waits only for mandatory workspace data and does not start heavy secondary reads', async () => {
 const fixture = await teacherWithFetch(async () => new Response(JSON.stringify(payload('teacher@test.kw'))));
 const secondary = [];
 for (const name of ['fetchJoinCodes', 'fetchCodeIntegrity', 'fetchQuestionBank', 'fetchTeacherSubmissions']) {
  fixture.context[name] = async () => secondary.push(name);
 }
 // Recompile with these actual adapters because the first loader captured its original context values.
 const load = await compile(extract('loadTeacherCloudData', '\n  const fetchCodeIntegrity'), 'loadTeacherCloudData', fixture.context);
 assert.equal(await load('teacher@test.kw'), true);
 assert.equal(fixture.gate['teacher@test.kw'], true);
 assert.deepEqual(secondary, []);
});

test('optional login readers wait for an interactive teacher workspace and reject a queued old session', async () => {
 const start = source.indexOf('  useEffect(() => {\n    if (!teacherWorkspaceInteractive) return;');
 const end = source.indexOf('\n  }, [teacherWorkspaceInteractive, teacherSession?.email, teacherSession?.authToken]);', start);
 const effect = source.slice(start, end + '\n  }, [teacherWorkspaceInteractive, teacherSession?.email, teacherSession?.authToken]);'.length);
 for (const scenario of ['waiting', 'ready', 'old-session', 'audit']) {
  const scheduler = await paintScheduler(), calls = [];
  let current = true;
  const context = { teacherWorkspaceInteractive: scenario !== 'waiting', teacherSession: { email: 'teacher@test.kw', authToken: 'fixture-token', role: 'admin' },
   captureTeacherSession: () => ({ token: 'fixture-token', isCurrent: () => current }), scheduleAfterWorkspacePaint: scheduler.schedule,
   cloudSessionKey, cloudSessionGenRef: { current: 1 }, teacherSubmissionInitialReadRef: { current: null },
   teacherTabRef: { current: scenario === 'audit' ? 'codes' : 'home' }, localStorage: { getItem: () => null },
   setAvailableChapters: () => {}, setTeacherQuestions: () => {}, setMirasRadarAllowed: () => {},
   useEffect: fn => fn() };
  for (const name of ['fetchTeacherSubmissions', 'fetchJoinCodes', 'fetchCodeIntegrity', 'fetchMirasRadar', 'loadTeacherAccounts', 'fetchTrustedPasskeyDevices']) {
   context[name] = async () => calls.push(name);
  }
  const mount = await compile(`const mountOptional = () => { ${effect} };`, 'mountOptional', context);
  mount(); assert.deepEqual(calls, []);
  scheduler.frame(); scheduler.frame(); assert.deepEqual(calls, []);
  if (scenario === 'old-session') current = false;
  scheduler.tasks();
  const expected = scenario === 'ready' ? ['fetchTeacherSubmissions', 'fetchJoinCodes', 'fetchCodeIntegrity', 'fetchMirasRadar', 'loadTeacherAccounts'] :
   scenario === 'audit' ? ['fetchTeacherSubmissions', 'fetchMirasRadar', 'loadTeacherAccounts'] : [];
  assert.deepEqual(calls, expected, scenario);
 }
});

test('post-paint submissions bootstrap reads every teacher course and scoped refresh preserves the other courses', async () => {
 const start = source.indexOf('  const fetchTeacherSubmissions = async (');
 const snippet = source.slice(start, source.indexOf('\n  const performStudentLiveStateRefresh', start));
 const queries = [];
 const first = { id: 'one', studentId: 'student-a', courseCode: 'course-a' };
 const second = { id: 'two', studentId: 'student-b', courseCode: 'course-b' };
 let submissions = [];
 const context = { captureTeacherSession: () => ({ email: 'teacher@test.kw', isCurrent: () => true }),
  teacherHeaders: () => ({}), studentSession: null, activeCourseCode: 'course-a', isLiveRecord: () => true,
  applyReturnedSubmissionOverrides: rows => rows, courseCodesMatch: (a, b) => a === b,
  setTeacherSubmissions: update => { submissions = update(submissions); },
  fetch: async url => {
   const query = new URL(url, 'http://localhost').searchParams; queries.push(query);
   return new Response(JSON.stringify({ submissions: queries.length === 1 ? [first, second] : [{ ...first, score: 95 }] }));
  } };
 const read = await compile(snippet, 'fetchTeacherSubmissions', context);
 await read(undefined, undefined, 'teacher@test.kw', { allCourses: true });
 assert.equal(queries[0].has('courseCode'), false);
 assert.equal(queries[0].has('studentId'), false);
 assert.deepEqual(submissions, [first, second]);
 await read(undefined, 'course-a', 'teacher@test.kw');
 assert.equal(queries[1].get('courseCode'), 'course-a');
 assert.deepEqual(submissions.find(row => row.id === 'two'), second);
 assert.equal(submissions.find(row => row.id === 'one').score, 95);
});

test('scoped submission polling waits for the initial all-course snapshot', async () => {
 const start = source.indexOf('  useEffect(() => {\n    if (\n      currentView !== "teacher_workspace" ||\n      !["home", "submissions", "questions"].includes(teacherTab)');
 const endMarker = '\n  }, [currentView, teacherTab, activeCourseCode, teacherSession?.email, teacherSession?.authToken, teacherWorkspaceInteractive]);';
 const effect = source.slice(start, source.indexOf(endMarker, start) + endMarker.length);
 const scheduler = await paintScheduler(), initial = deferred(), calls = [];
 const session = { email: 'teacher@test.kw', token: 'fixture-token', isCurrent: () => true };
 const context = { currentView: 'teacher_workspace', teacherTab: 'home', activeCourseCode: 'course-a', teacherWorkspaceInteractive: true,
  teacherSession: { email: session.email, authToken: session.token }, captureTeacherSession: () => session,
  teacherSubmissionInitialReadRef: { current: { key: cloudSessionKey(session.email, session.token, 1), promise: initial.promise } },
  cloudSessionKey, cloudSessionGenRef: { current: 1 }, scheduleAfterWorkspacePaint: scheduler.schedule,
  document: { visibilityState: 'visible' }, window: { setInterval: () => 1, clearInterval: () => {} },
  fetchTeacherSubmissions: async (...args) => calls.push(args), useEffect: callback => callback() };
 const mount = await compile(`const mountPoll = () => { ${effect} };`, 'mountPoll', context);
 mount(); scheduler.frame(); scheduler.frame(); scheduler.tasks();
 assert.deepEqual(calls, []);
 initial.resolve(true); await turn();
 assert.deepEqual(calls, [[undefined, 'course-a', 'teacher@test.kw']]);
});

test('teacher-only readers skip guests and student sessions, and discard stale teacher responses', async () => {
 const ranges = [
  ['fetchTeacherExams', '\n  const applyTeacherProjects', 'exams'],
  ['fetchTeacherProjects', '\n  const fetchTeacherSubmissions', 'projects'],
  ['fetchTeacherSubmissions', '\n  const performStudentLiveStateRefresh', 'submissions'],
 ];
 for (const [name, end, field] of ranges) {
  const start = source.indexOf(`  const ${name} = async (`);
  const snippet = source.slice(start, source.indexOf(end, start));
  let calls = 0, active = false, credential = false;
  const context = { captureTeacherSession: () => credential ? { email: 'teacher@test.kw', isCurrent: () => active } : null,
   teacherHeaders: () => ({}), studentSession: null, activeCourseCode: '',
   fetch: async () => { calls++; return new Response(JSON.stringify({ [field]: [] })); },
   applyTeacherExams: () => assert.fail('stale exams applied'), applyTeacherProjects: () => assert.fail('stale projects applied'),
   setTeacherSubmissions: () => assert.fail('stale submissions applied') };
  const read = await compile(snippet, name, context);
  assert.equal(await read(), false); assert.equal(calls, 0, name);
  credential = true;
  assert.equal(await read(), false); assert.equal(calls, 1, name);
 }
});

test('teacher session captures require identity and token, then invalidate on logout or account switch', async () => {
 const context = { email: '', token: '', activeTeacherEmail: email => email || context.email,
  readStoredSessionAuthToken: () => context.token, cloudSessionGenRef: { current: 1 } };
 const capture = await compile(extract('captureTeacherSession', '\n  const captureTeacherRead'), 'captureTeacherSession', context);
 assert.equal(capture(), null);
 context.email = 'teacher@test.kw'; assert.equal(capture(), null);
 context.token = 'first-token'; const first = capture(); assert.equal(first.isCurrent(), true);
 context.token = 'second-token'; assert.equal(first.isCurrent(), false);
 const second = capture(); context.cloudSessionGenRef.current++; assert.equal(second.isCurrent(), false);
});
