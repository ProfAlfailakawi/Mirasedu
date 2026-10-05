import test from 'node:test';
import assert from 'node:assert/strict';
import { probeCloudReadiness as probe } from '../src/shared/cloud-readiness-probe';
const ready=()=>new Response(JSON.stringify({ok:true,hasData:true}));
const stalled=(_url:any,init:any)=>new Promise<Response>((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
test('direct healthy cloud wins while Hosting is stalled',async()=>{
  const request=(url:any,init:any)=>url==='direct'?Promise.resolve(ready()):stalled(url,init);
  assert.equal(await probe(request as typeof fetch,['hosting','direct'],30),true);
});
test('failed or incomplete cloud responses never open account',async()=>{
  for(const body of [{ok:false,hasData:true},{ok:true,hasData:false},{}]) {
    assert.equal(await probe((async()=>new Response(JSON.stringify(body))) as typeof fetch,['cloud'],30),false);
  }
});
test('unhealthy endpoint cannot block the healthy route',async()=>{
  assert.equal(await probe((async(url:any)=>url==='direct'?ready():new Response('{}',{status:503})) as typeof fetch,['hosting','direct'],30),true);
});
test('bounded stalled checks return false and release requests',async()=>{
  assert.equal(await probe(stalled as typeof fetch,['hosting','direct'],15),false);
});
