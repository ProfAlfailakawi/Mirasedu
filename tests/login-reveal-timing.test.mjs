import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

// Execute the real overlay effect with deterministic React hooks and timers.
// Parent re-renders must never extend the cloud-ready transition.
async function fixture(reduced=false) {
 const source=fs.readFileSync(new URL('../src/components/LoginRevealOverlay.tsx',import.meta.url),'utf8');
 const {code}=await transform(source,{loader:'tsx',format:'cjs',jsx:'automatic'});
 const slots=[];let cursor=0,now=0,next=1;const timers=new Map(),effects=[];
 const react={
  useRef:value=>{const i=cursor++;return slots[i]||(slots[i]={current:value});},
  useState:value=>{const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useEffect:(run,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:run()};});}
 };
 const win={matchMedia:()=>({matches:reduced}),innerHeight:900,innerWidth:400,
  setTimeout:(run,delay)=>{const id=next++;timers.set(id,{run,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const require=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='motion/react')return {motion:{div:'motion.div'}};
  if(name==='lucide-react')return new Proxy({},{get:(_t,key)=>key});
  throw Error(name);
 };
 const module={exports:{}};new Function('module','exports','require','window','document',code)(module,module.exports,require,win,{querySelector:()=>null});
 const render=props=>{cursor=0;const result=module.exports.default(props);while(effects.length)effects.shift()();return result;};
 const advance=ms=>{now+=ms;let due;while((due=[...timers].find(([_id,t])=>t.at<=now))){timers.delete(due[0]);due[1].run();}};
 return {render,advance,timers};
}
test('the loading screen never leaves before actual cloud readiness',async()=>{
 const f=await fixture();let done=0;f.render({role:'teacher',ready:false,onDone:()=>done++});
 f.advance(60000);assert.equal(done,0);assert.equal(f.timers.size,0);
});
test('cloud readiness leaves in 180ms with no minimum intro wait and no re-render timer resets',async()=>{
 const f=await fixture();let oldDone=0,newDone=0;
 f.render({role:'teacher',ready:false,onDone:()=>oldDone++});
 f.render({role:'teacher',ready:true,onDone:()=>oldDone++});f.advance(0);
 for(let i=0;i<100;i++)f.render({role:'teacher',ready:true,onDone:()=>newDone++});
 f.advance(179);assert.equal(newDone,0);f.advance(1);assert.equal(newDone,1);assert.equal(oldDone,0);
});
test('reduced motion waits for data then reveals immediately',async()=>{
 const f=await fixture(true);let done=0;
 f.render({role:'student',ready:false,onDone:()=>done++});assert.equal(done,0);
 f.render({role:'student',ready:true,onDone:()=>done++});assert.equal(done,1);assert.equal(f.timers.size,0);
});
test('only the read-only passkey challenge bypasses mutation waiting; login writes retain their barrier',()=>{
 const server=fs.readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const guard=server.slice(server.indexOf('const readOnlyPasskeyStart ='),server.indexOf('\nfunction cloudDurabilityErrorBody'));
 assert.match(guard,/req\.method === "POST" && req\.path === "\/api\/auth\/passkey\/login\/start"/);
 assert.match(guard,/&& !readOnlyPasskeyStart/);
 assert.match(guard,/dbInstance\.waitForMutationSync\(responseMutationVersion\)/);
 assert.match(guard,/const responseMutationVersion = dbInstance\.getMutationVersion\(\)/);
 assert.match(guard,/catch\(\(\) => waitForResponseWrites\(\)\)/);
 const start=server.slice(server.indexOf('app.post("/api/auth/passkey/login/start"'),server.indexOf('app.post("/api/auth/passkey/login/finish"'));
 assert.doesNotMatch(start,/dbInstance\.(add|update|delete|set|persist)/);
});
