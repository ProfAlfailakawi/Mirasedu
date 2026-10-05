import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCloudMutation } from '../src/shared/cloud-mutation-barrier';

test('returns for the committed transfer while later background work is still running', async () => {
 let committed=4, resolveOwn!:()=>void;
 let active: Promise<void> | null=new Promise(resolve=>{resolveOwn=()=>{committed=5; active=new Promise(()=>{});resolve();};});
 let flushes=0;
 const waiting=waitForCloudMutation(5,{committedVersion:()=>committed,flush:()=>{flushes++;},activeWrite:()=>active},1000);
 resolveOwn();
 await waiting;
 assert.equal(committed,5);
 assert.equal(flushes,1);
 assert.ok(active);
});
test('does not treat an earlier cloud write as confirmation of the transfer', async () => {
 let committed=3, resolveEarlier!:()=>void, resolveTransfer!:()=>void;
 const earlier=new Promise<void>(resolve=>{resolveEarlier=()=>{committed=4;resolve();};});
 const transfer=new Promise<void>(resolve=>{resolveTransfer=()=>{committed=5;resolve();};});
 let active:Promise<void>|null=earlier;
 let returned=false;
 const waiting=waitForCloudMutation(5,{committedVersion:()=>committed,flush:()=>{},activeWrite:()=>active},1000).then(()=>{returned=true;});
 active=transfer;resolveEarlier();
 await Promise.resolve();await Promise.resolve();
 assert.equal(returned,false);
 resolveTransfer();await waiting;
 assert.equal(returned,true);
});
test('already committed mutation returns without forcing another write',async()=>{
 await waitForCloudMutation(5,{committedVersion:()=>6,flush:()=>assert.fail('unnecessary flush'),activeWrite:()=>null});
});
test('cloud write failure never confirms success',async()=>{
 await assert.rejects(waitForCloudMutation(5,{committedVersion:()=>4,flush:()=>{},activeWrite:()=>Promise.reject(new Error('write failed'))}),/write failed/);
});
test('missing write never confirms success',async()=>{
 await assert.rejects(waitForCloudMutation(5,{committedVersion:()=>4,flush:()=>{},activeWrite:()=>null}),/not been committed/);
});
test('stalled cloud write times out without reporting success',async()=>{
 await assert.rejects(waitForCloudMutation(5,{committedVersion:()=>4,flush:()=>{},activeWrite:()=>new Promise(()=>{})},20),/timed out/);
});
