import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

// Execute the actual response middleware with an isolated durability adapter.
// No cloud credentials, real accounts or production requests are involved.
const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = source.indexOf('// قبل أي طلب API ننتظر');
const end = source.indexOf('\nfunction cloudDurabilityErrorBody', start);
assert.ok(start > 0 && end > start);
const { code } = await transform(source.slice(start, end), { loader: 'ts', format: 'cjs' });
const turn = () => new Promise(resolve => setImmediate(resolve));

async function fixture(path, { locked = false, rejectFirst = false } = {}) {
  let version = 20, middleware, globalWaits = 0;
  const targets = [], sent = [], finish = [];
  const db = {
    initialSyncPromise: Promise.resolve(),
    getMutationVersion: () => version,
    isDatabaseGuardLocked: () => locked,
    waitForMutationSync: async target => {
      targets.push(target);
      // Later traffic must not extend the target being confirmed.
      version += 1;
      if (rejectFirst && targets.length === 1) throw Error('transient write failure');
    },
    waitForSync: async () => { globalWaits++; if (locked) throw Error('guard locked'); },
    flushCloudSoon: () => {},
  };
  new Function('app', 'dbInstance', 'cloudDurabilityErrorBody', code)(
    { use: fn => { middleware = fn; } }, db, () => ({ code: 'CLOUD_SYNC_UNAVAILABLE' }),
  );
  const res = {
    locals: {}, statusCode: 200, headersSent: false,
    getHeader: () => undefined, setHeader: () => {},
    json: body => { sent.push({ status: res.statusCode, body }); res.headersSent = true; return res; },
    status: status => { res.statusCode = status; return res; },
    on: (name, fn) => { if (name === 'finish') finish.push(fn); },
  };
  await middleware({ method: 'POST', path, url: path }, res, () => {});
  return { res, targets, sent, mutate: () => { version++; }, globalWaits: () => globalWaits };
}

for (const path of ['/api/student/submissions', '/api/auth/passkey/register/start', '/api/notifications/mark-seen', '/api/auth/login']) {
  test(`${path} confirms its own write despite later traffic`, async () => {
    const f = await fixture(path); f.mutate(); f.res.json({ success: true }); await turn();
    assert.deepEqual(f.targets, [21]); assert.equal(f.globalWaits(), 0);
    assert.deepEqual(f.sent, [{ status: 200, body: { success: true } }]);
  });
}

test('a retry retains the original response version', async () => {
  const f = await fixture('/api/student/submissions', { rejectFirst: true });
  f.mutate(); f.res.json({ success: true }); await turn();
  assert.deepEqual(f.targets, [21, 21]); assert.equal(f.sent[0].status, 200);
});

test('a read-only response does not wait for unrelated writes', async () => {
  const f = await fixture('/api/auth/passkey/status'); f.res.json({ enabled: true }); await turn();
  assert.deepEqual(f.targets, []); assert.equal(f.globalWaits(), 0); assert.equal(f.sent[0].status, 200);
});

test('blocked writes remain failures and confirmed device actions do not wait twice', async () => {
  const blocked = await fixture('/api/student/submissions', { locked: true });
  blocked.res.json({ success: true }); await turn(); assert.equal(blocked.sent[0].status, 503);
  const confirmed = await fixture('/api/teacher/students/1001/reset-access');
  confirmed.mutate(); confirmed.res.locals.cloudMutationConfirmed = true;
  confirmed.res.json({ success: true }); await turn();
  assert.deepEqual(confirmed.targets, []); assert.equal(confirmed.sent[0].status, 200);
});
