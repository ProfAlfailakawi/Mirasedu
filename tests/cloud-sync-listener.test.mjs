import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { build } from 'esbuild';

// Execute the real LocalDatabase/cloud writer with a deterministic Firestore adapter.
// No SDK credentials, live requests, or production files are used by this test.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('device transfers survive early cloud echoes and queued later mutations without reloading the database', async () => {
 const root = process.cwd(), sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'miras-cloud-listener-'));
 let db;
 const documents = new Map();
 let listener, reads = 0, commits = 0, mutateDuringCommit, failNextCommit = false;
 const stamp = 100;
 const initial = {students:[{id:'test-student',name:'Test',devices:['old-device']}],joinCodes:[{code:'TEST',studentId:'test-student',activationDeviceFingerprint:'old-device'}],teachers:[],sections:[]};
 const manifest = Object.fromEntries(Object.keys(initial).map(key => [key,{chunkCount:1}]));
 documents.set('system/database',{storageFormat:'entity-json-v3',entityKeys:Object.keys(initial),entityManifest:manifest,lastUpdated:stamp,contentCounts:{students:1}});
 for(const [key,value] of Object.entries(initial)) documents.set(`system/database/entities/${key}`,{payload:JSON.stringify(value)});
 let revision = 1;
 const snapshot = p => ({exists:documents.has(p),data:()=>structuredClone(documents.get(p)),updateTime:revision});
 const ref = p => ({
  path:p,
  get:async()=>{reads++;return snapshot(p);},
  collection:key=>({doc:id=>ref(`${p}/${key}/${id}`),get:async()=>{reads++;return {docs:[...documents.keys()].filter(k=>k.startsWith(`${p}/${key}/`)).map(k=>snapshot(k))};}}),
  onSnapshot:fn=>{listener=fn;return ()=>{listener=null;};},
  set:async data=>{documents.set(p,structuredClone(data));revision++;if(p==='system/database')listener?.(snapshot(p));return {writeTime:revision};},
 });
 globalThis.__mirasTestCloud = {doc:ref,batch:()=>{
  const operations=[];
  return {
   set:(r,d)=>operations.push([r.path,d]),
   update:(r,d,condition)=>{assert.equal(condition.lastUpdateTime,revision);operations.push([r.path,d]);},
   delete:r=>operations.push([r.path,null]),
   commit:async()=>{
    commits++;
    if(failNextCommit){failNextCommit=false;throw new Error('injected cloud write failure');}
    for(const [p,d] of operations) d===null ? documents.delete(p) : documents.set(p,structuredClone(d));
    revision++;
    // Firestore's listener can beat the write acknowledgement to the process.
    listener?.(snapshot('system/database'));
    if(mutateDuringCommit){const mutate=mutateDuringCommit;mutateDuringCommit=null;await mutate();}
    await pause(25);
    return operations.map(()=>({writeTime:revision}));
   },
  };
 }};
 try {
  fs.writeFileSync(path.join(sandbox,'firebase-applet-config.json'),JSON.stringify({projectId:'test-only',firestoreDatabaseId:'test-only'}));
  const bundled = await build({entryPoints:[path.join(root,'src/server/db.ts')],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'fake-firestore',setup(builder){
   builder.onResolve({filter:/^firebase-admin\/(app|firestore|storage)$/},args=>({path:args.path,namespace:'fake'}));
   builder.onLoad({filter:/.*/,namespace:'fake'},args=>({contents:args.path.endsWith('/app')
    ? 'export const applicationDefault=()=>({}); export const getApps=()=>[]; export const initializeApp=()=>({});'
    : args.path.endsWith('/firestore') ? 'export const getFirestore=()=>globalThis.__mirasTestCloud;'
    : 'export const getStorage=()=>({bucket:()=>({})});'}));
  }}]});
  process.chdir(sandbox);
  const module = new Module(path.join(root,'tests','isolated-cloud-db.cjs'));
  module.filename=path.join(root,'tests','isolated-cloud-db.cjs');module.paths=Module._nodeModulePaths(path.join(root,'tests'));
  module._compile(bundled.outputFiles[0].text,module.filename);
  db=module.exports.dbInstance;
  await db.initialSyncPromise;
  const readsAfterInitial=reads;
  // Avoid the unrelated schema migration so this exercises the actual atomic path.
  for(const [key,value] of Object.entries(db.data)) {
   if(key==='lastUpdated')continue;
   const perDoc=['activityLogs','examSessions','inAppNotifications','notificationAudit','errorReports'].includes(key);
   manifest[key]=perDoc ? {chunkCount:1,perDoc:true,count:value?.length||0} : {chunkCount:1};
   if(!perDoc)documents.set(`system/database/entities/${key}`,{payload:JSON.stringify(value??null)});
  }
  db.lastEntityManifest=structuredClone(manifest);
  const meta=documents.get('system/database');meta.entityManifest=manifest;meta.entityKeys=Object.keys(manifest);
  // A later edit arriving during the transfer's cloud write must not be discarded.
  mutateDuringCommit=async()=>{db.updateStudent('test-student',{name:'Later edit'});await db.persist();};
  db.updateJoinCode('TEST',{activationDeviceFingerprint:''});
  db.updateStudent('test-student',{devices:[],pendingDeviceTransfer:true,optional:undefined,nested:{omit:undefined,array:[undefined,'kept']}});
  await db.persist();
  const transferVersion=db.getMutationVersion();
  await db.waitForMutationSync(transferVersion);
  assert.equal(reads,readsAfterInitial,'self-echo must not download cloud entities');
  assert.equal(db.getStudents()[0].pendingDeviceTransfer,true);
  assert.equal(db.getStudents()[0].name,'Later edit');
  await db.waitForMutationSync(db.getMutationVersion());
  await pause(30);
  assert.equal(reads,readsAfterInitial,'later queued edits also skip the preceding write echo');
  assert.equal(JSON.parse(documents.get('system/database/entities/students').payload)[0].name,'Later edit');
  assert.equal(JSON.parse(documents.get('system/database/entities/students').payload)[0].pendingDeviceTransfer,true);
  assert.ok(commits>=2);
  const durableStudent=JSON.parse(documents.get('system/database/entities/students').payload)[0];
  assert.ok(!('optional' in durableStudent));
  assert.ok(!('omit' in durableStudent.nested));
  assert.deepEqual([...durableStudent.nested.array].sort(),['kept',null].sort());
  // External writes still refresh the state; only our acknowledged echo is skipped.
  const external=structuredClone(documents.get('system/database'));external.lastUpdated=Date.now()+10000;
  documents.set('system/database/entities/students',{payload:JSON.stringify([{...db.getStudents()[0],name:'External edit'}])});
  documents.set('system/database',external);revision++;listener(snapshot('system/database'));
  await pause(40);
  assert.equal(db.getStudents()[0].name,'External edit');
  assert.ok(reads>readsAfterInitial);
  failNextCommit=true;
  db.updateStudent('test-student',{devices:['new-device']});
  await db.persist();
  await assert.rejects(db.waitForMutationSync(db.getMutationVersion()),/injected cloud write failure/);
  assert.deepEqual(JSON.parse(documents.get('system/database/entities/students').payload)[0].devices,[],'rejected cloud write must never be confirmed');
 } finally {
  if(db){clearTimeout(db.persistTimeout);clearImmediate(db.localSaveTimer);db.pendingFSSync=false;db.dirtyLocal=false;db.cloudUnsubscribe?.();}
  process.chdir(root);delete globalThis.__mirasTestCloud;fs.rmSync(sandbox,{recursive:true,force:true});
 }
});
