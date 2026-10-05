import test from 'node:test';
import assert from 'node:assert/strict';
import { planAtomicCloudWrite, commitAtomicCloudWrite, attemptOptimisticCloudCommit, canReuseCloudBaseline } from '../src/shared/atomic-cloud-write';
const base = (): Parameters<typeof planAtomicCloudWrite>[0] => ({
 current: { students: [{id:'1001',devices:[]}], activityLogs:[{id:'new',action:'reset'}], joinCodes:[{code:'LAB-1',activationDeviceToken:''}] },
 previous:{ students:[{id:'1001',devices:['old']}], activityLogs:[{id:'old',action:'login'}], joinCodes:[{code:'LAB-1',activationDeviceToken:'old'}] },
 manifest:{students:{chunkCount:1},activityLogs:{chunkCount:1,perDoc:true,count:1},joinCodes:{chunkCount:1}},
 keys:['students','activityLogs','joinCodes'], perDocKeys:new Set(['activityLogs']),chunkSize:300000,
 generation:100,updatedAt:'2026-10-05T12:00:00Z',metaFields:{lastUpdated:100,contentCounts:{students:1,activityLogs:1,joinCodes:1}},
});
test('student, linked codes, audit and metadata form one acknowledged commit',async()=>{
 const options=base();const old=JSON.stringify(options);
 const plan=planAtomicCloudWrite(options)!;
 assert.ok(plan);
 const recorded:any[]=[];let commits=0;
 await commitAtomicCloudWrite(plan,{set:op=>recorded.push(op),delete:op=>recorded.push(op),commit:async()=>{commits++;}});
 assert.equal(commits,1);
 assert.ok(recorded.some(op=>op.id==='students'));
 assert.ok(recorded.some(op=>op.id==='joinCodes'));
 assert.ok(recorded.some(op=>op.id==='new'&&op.collection==='perdoc_activityLogs'));
 assert.ok(recorded.some(op=>op.id==='old'&&op.kind==='delete'));
 assert.equal(recorded.at(-1).collection,'meta');
 assert.equal(recorded.at(-1).data.entityManifest.activityLogs.count,1);
 assert.equal(JSON.stringify(options),old);
});
test('commit completion is not reported before cloud acknowledgment',async()=>{
 const plan=planAtomicCloudWrite(base())!;let resolve!:()=>void;let returned=false;
 const waiting=commitAtomicCloudWrite(plan,{set:()=>{},delete:()=>{},commit:()=>new Promise<void>(r=>{resolve=r;})}).then(()=>{returned=true;});
 await Promise.resolve();assert.equal(returned,false);resolve();await waiting;assert.equal(returned,true);
});
test('rejected commit is propagated and does not mutate the old manifest',async()=>{
 const options=base(),previous=JSON.stringify(options.manifest);
 await assert.rejects(commitAtomicCloudWrite(planAtomicCloudWrite(options)!,{set:()=>{},delete:()=>{},commit:async()=>{throw new Error('quota');}}),/quota/);
 assert.equal(JSON.stringify(options.manifest),previous);
});
test('unchanged keys and records are not rewritten',()=>{
 const options=base(); options.current=options.previous;
 const plan=planAtomicCloudWrite(options)!;
 assert.equal(plan.operations.length,1);assert.equal(plan.operations[0].collection,'meta');
});
test('chunked records reconstruct exactly including Arabic text',()=>{
 const options=base();options.chunkSize=12; options.current.students=[{id:'1001',name:'حسين الأمير',devices:[]}];
 const plan=planAtomicCloudWrite(options)!;
 const docs=plan.operations.filter(op=>op.collection==='entities'&&op.id.startsWith('students'));
 assert.deepEqual(JSON.parse(docs.map(op=>op.data.payload).join('')),options.current.students);
 assert.equal(plan.manifest.students.chunkCount,docs.length);
});
test('large requests fall back before creating any cloud write',()=>{
 assert.equal(planAtomicCloudWrite({...base(),maxOperations:2}),null);
 assert.equal(planAtomicCloudWrite({...base(),maxBytes:100}),null);
});
test('initialization, restoration and per-document migrations use the established writer',()=>{
 assert.equal(planAtomicCloudWrite({...base(),previous:null}),null);
 assert.equal(planAtomicCloudWrite({...base(),manifest:{}}),null);
 const options=base();options.manifest.activityLogs={chunkCount:1,perDoc:false,count:1};
 assert.equal(planAtomicCloudWrite(options),null);
});

test('optimistic path acknowledges one write and avoids a preliminary cloud read', async()=>{
 let commits=0;
 assert.equal(await attemptOptimisticCloudCommit(async()=>{commits++;return true;}),'committed');
 assert.equal(commits,1);
});
test('stale and deleted metadata fall back to a fresh read/merge',async()=>{
 for (const code of [5,9,10,'failed-precondition']) {
  assert.equal(await attemptOptimisticCloudCommit(async()=>{throw Object.assign(new Error('stale revision'),{code});}),'conflict');
 }
 assert.equal(await attemptOptimisticCloudCommit(async()=>false),'unsupported');
});
test('quota, permission, transport and unknown failures are never claimed as saved',async()=>{
 for (const code of [4,7,8,14,undefined]) {
  await assert.rejects(attemptOptimisticCloudCommit(async()=>{throw Object.assign(new Error('write failed'),{code});}),/write failed/);
 }
});

test('a rejected version or a listener advancing during the write forces a full cloud reread',()=>{
 assert.equal(canReuseCloudBaseline(100,100,100,100,false),true);
 assert.equal(canReuseCloudBaseline(100,100,100,100,true),false);
 assert.equal(canReuseCloudBaseline(101,100,100,101,false),false);
 assert.equal(canReuseCloudBaseline(0,0,0,0,false),false);
 assert.equal(canReuseCloudBaseline(100,100,99,99,false),false);
});
