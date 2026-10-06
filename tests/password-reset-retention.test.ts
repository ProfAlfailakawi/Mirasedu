import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_RESET_RETENTION_MS, shouldRemoveFinishedPasswordReset } from '../src/shared/password-reset-retention';

const now = Date.parse('2026-10-06T12:00:00Z');
const expiry = (age: number) => new Date(now - age).toISOString();
test('expired requests remain for 24 hours after expiry, then are removed', () => {
  assert.equal(shouldRemoveFinishedPasswordReset({status:'expired',expiresAt:expiry(PASSWORD_RESET_RETENTION_MS-1)},now),false);
  assert.equal(shouldRemoveFinishedPasswordReset({status:'expired',expiresAt:expiry(PASSWORD_RESET_RETENTION_MS)},now),true);
});
test('stale new snapshots also clear only after expiry plus 24 hours', () => {
  assert.equal(shouldRemoveFinishedPasswordReset({status:'new',expiresAt:expiry(PASSWORD_RESET_RETENTION_MS+1)},now),true);
  assert.equal(shouldRemoveFinishedPasswordReset({status:'new',expiresAt:expiry(-3600000)},now),false);
});
test('malformed timestamps are preserved', () => {
  assert.equal(shouldRemoveFinishedPasswordReset({status:'expired',expiresAt:'invalid'},now),false);
});

test('completed requests clear 24 hours after completion, not after older expiry', () => {
  const request={status:'handled',expiresAt:expiry(7*PASSWORD_RESET_RETENTION_MS),handledAt:expiry(1000)};
  assert.equal(shouldRemoveFinishedPasswordReset(request,now),false);
  assert.equal(shouldRemoveFinishedPasswordReset({...request,handledAt:expiry(PASSWORD_RESET_RETENTION_MS)},now),true);
});
test('legacy finished requests fall back to expiry and recent usedAt stays visible', () => {
  assert.equal(shouldRemoveFinishedPasswordReset({status:'handled',expiresAt:expiry(7*PASSWORD_RESET_RETENTION_MS)},now),true);
  assert.equal(shouldRemoveFinishedPasswordReset({status:'used',expiresAt:expiry(7*PASSWORD_RESET_RETENTION_MS),usedAt:expiry(1000)},now),false);
});

test('database cleanup persists once, preserves active requests and is idempotent', async () => {
  const { readFileSync } = await import('node:fs');
  const source=readFileSync(new URL('../src/server/db.ts',import.meta.url),'utf8');
  const method=source.slice(source.indexOf('public getPasswordResetRequests()'),source.indexOf('public getJoinCodes()'));
  const body=method.slice(method.indexOf('{'),method.lastIndexOf('}')+1);
  const getter=new Function('shouldRemoveFinishedPasswordReset',`return function() ${body}`)(shouldRemoveFinishedPasswordReset);
  const at=(offset:number)=>new Date(Date.now()+offset).toISOString();
  let writes=0;
  const db={data:{passwordResetRequests:[
    {id:'expired-old',status:'new',expiresAt:at(-2*PASSWORD_RESET_RETENTION_MS)},
    {id:'handled-old',status:'handled',handledAt:at(-2*PASSWORD_RESET_RETENTION_MS)},
    {id:'active',status:'new',expiresAt:at(3600000)},
    {id:'expired-recent',status:'expired',expiresAt:at(-1000)},
    {id:'handled-recent',status:'handled',handledAt:at(-1000)},
  ]},persist:()=>writes++};
  assert.deepEqual(getter.call(db).map((r:any)=>r.id),['active','expired-recent','handled-recent']);
  assert.equal(writes,1);
  getter.call(db);
  assert.equal(writes,1);
});

test('manual activation card renders the course label once and QR has no admin-only gate', async () => {
  const { readFileSync } = await import('node:fs');
  const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
  const card=app.slice(app.indexOf('const studentCourses = studentCourseCodes.map'),app.indexOf('لا يوجد مقرر مرتبط',app.indexOf('const studentCourses = studentCourseCodes.map')));
  assert.equal(card.includes('{course.sectionDisplay}'),false);
  assert.equal((card.match(/\{course\.displayName\}/g)||[]).length,2); // title attribute and one text node
  const reset=app.slice(app.indexOf('const renderPasswordResetRequest ='),app.indexOf('const renderPasswordResetRequest =')+7000);
  const qrIndex=reset.indexOf('setPasswordResetQrLink(req.resetLink)');
  const qr=reset.slice(reset.lastIndexOf('<button',qrIndex),reset.indexOf('</button>',qrIndex)+9);
  assert.ok(qr);
  assert.equal(qr.includes('isAdmin'),false);
  assert.ok(qr.includes('QR تغيير كلمة المرور'));
});
