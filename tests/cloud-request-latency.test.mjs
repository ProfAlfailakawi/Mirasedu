import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { build } from 'esbuild';

// Run the real database with only a deterministic in-memory Firestore adapter.
// The SDK, dotenv, credentials and repository database are never accessed.
async function withDatabase(options, run) {
  const root = process.cwd();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'miras-cloud-request-'));
  const oldLocalMode = process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE;
  let db;
  let listener;
  let revision = 1;
  const state = {
    reads: 0, commits: 0, cacheWrites: 0, events: [], beforeCommit: null,
    commitDelay: 1,
  };
  const documents = new Map();
  const initial = {
    students: [{ id: 'test-student', name: 'Initial', devices: ['old'] }],
    joinCodes: [{ code: 'TEST', studentId: 'test-student' }],
    teachers: [], sections: [],
  };
  const manifest = Object.fromEntries(Object.keys(initial).map(key => [key, { chunkCount: 1 }]));
  documents.set('system/database', {
    storageFormat: 'entity-json-v3', entityKeys: Object.keys(initial),
    entityManifest: manifest, lastUpdated: 100, contentCounts: { students: 1 },
  });
  for (const [key, value] of Object.entries(initial)) {
    documents.set(`system/database/entities/${key}`, { payload: JSON.stringify(value) });
  }
  const snapshot = docPath => ({
    exists: documents.has(docPath), data: () => structuredClone(documents.get(docPath)),
    updateTime: revision,
  });
  const ref = docPath => ({
    path: docPath,
    get: async () => { state.reads += 1; return snapshot(docPath); },
    collection: key => ({
      doc: id => ref(`${docPath}/${key}/${id}`),
      get: async () => {
        state.reads += 1;
        return { docs: [...documents.keys()].filter(keyPath => keyPath.startsWith(`${docPath}/${key}/`)).map(snapshot) };
      },
    }),
    onSnapshot: fn => { listener = fn; return () => { listener = null; }; },
    set: async value => {
      documents.set(docPath, structuredClone(value)); revision += 1;
      if (docPath === 'system/database') listener?.(snapshot(docPath));
      return { writeTime: revision };
    },
  });
  const cloud = {
    doc: ref,
    batch: () => {
      const operations = [];
      return {
        set: (doc, value) => operations.push({ path: doc.path, value }),
        update: (doc, value, condition) => operations.push({ path: doc.path, value, condition }),
        delete: doc => operations.push({ path: doc.path, remove: true }),
        commit: async () => {
          state.events.push('cloud-start'); state.commits += 1;
          if (state.beforeCommit) {
            const hook = state.beforeCommit; state.beforeCommit = null; hook();
          }
          for (const operation of operations) {
            if (operation.condition && operation.condition.lastUpdateTime !== revision) {
              throw Object.assign(new Error('metadata revision conflict'), { code: 9 });
            }
          }
          await new Promise(resolve => setTimeout(resolve, state.commitDelay));
          for (const operation of operations) {
            if (operation.remove) documents.delete(operation.path);
            else documents.set(operation.path, structuredClone(operation.value));
          }
          revision += 1;
          listener?.(snapshot('system/database'));
          state.events.push('cloud-ack');
          return operations.map(() => ({ writeTime: revision }));
        },
      };
    },
  };
  globalThis.__mirasLatencyCloud = cloud;
  try {
    const bundled = await build({
      entryPoints: [path.join(root, 'src/server/db.ts')], bundle: true,
      platform: 'node', format: 'cjs', packages: 'external', write: false,
      plugins: [{ name: 'isolated-cloud', setup(builder) {
        builder.onResolve({ filter: /^(firebase-admin\/(app|firestore|storage)|dotenv)$/ }, args => ({ path: args.path, namespace: 'fake' }));
        builder.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ contents:
          args.path === 'dotenv' ? 'export default {config:()=>({})};' :
          args.path.endsWith('/app') ? 'export const applicationDefault=()=>({}); export const getApps=()=>[]; export const initializeApp=()=>({});' :
          args.path.endsWith('/firestore') ? 'export const getFirestore=()=>globalThis.__mirasLatencyCloud;' :
          'export const getStorage=()=>({bucket:()=>({})});',
        }));
      } }],
    });
    process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE = options.cloud === false ? 'true' : 'false';
    if (options.cloud !== false) {
      fs.writeFileSync(path.join(sandbox, 'firebase-applet-config.json'), JSON.stringify({ projectId: 'isolated', firestoreDatabaseId: 'isolated' }));
    } else {
      fs.mkdirSync(path.join(sandbox, 'data'));
      fs.writeFileSync(path.join(sandbox, 'data/db.json'), JSON.stringify(initial));
    }
    process.chdir(sandbox);
    const module = new Module(path.join(root, 'tests', 'isolated-latency-db.cjs'));
    module.filename = path.join(root, 'tests', 'isolated-latency-db.cjs');
    module.paths = Module._nodeModulePaths(path.join(root, 'tests'));
    module._compile(bundled.outputFiles[0].text, module.filename);
    db = module.exports.dbInstance;
    await db.initialSyncPromise;
    if (options.cloud !== false) {
      // A fully migrated manifest isolates ordinary writes from startup migrations.
      for (const [key, value] of Object.entries(db.data)) {
        if (key === 'lastUpdated') continue;
        const perDoc = ['activityLogs', 'examSessions', 'inAppNotifications', 'notificationAudit', 'errorReports'].includes(key);
        manifest[key] = perDoc ? { chunkCount: 1, perDoc: true, count: value?.length || 0 } : { chunkCount: 1 };
        if (!perDoc) documents.set(`system/database/entities/${key}`, { payload: JSON.stringify(value ?? null) });
      }
      db.lastEntityManifest = structuredClone(manifest);
      const meta = documents.get('system/database');
      meta.entityManifest = manifest; meta.entityKeys = Object.keys(manifest);
    }
    const saveState = db.saveState.bind(db);
    db.saveState = value => { state.cacheWrites += 1; state.events.push('cache-write'); return saveState(value); };
    await run({ db, state, documents, sandbox, changeExternal: update => { update(documents); revision += 1; } });
  } finally {
    if (db) {
      clearTimeout(db.persistTimeout); clearImmediate(db.localSaveTimer);
      db.pendingFSSync = false; db.dirtyLocal = false;
      db.cloudUnsubscribe?.();
      await db.syncPromise?.catch(() => {});
      clearTimeout(db.persistTimeout); clearImmediate(db.localSaveTimer);
      db.pendingFSSync = false; db.dirtyLocal = false;
    }
    process.chdir(root);
    if (oldLocalMode === undefined) delete process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE;
    else process.env.MIRAS_ALLOW_LOCAL_ONLY_MODE = oldLocalMode;
    delete globalThis.__mirasLatencyCloud;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

test('unawaited login mutations register before the response barrier and start cloud before disk cache', async () => {
  await withDatabase({}, async ({ db, state, documents }) => {
    const previous = db.getMutationVersion();
    db.updateStudent('test-student', { devices: [], pendingDeviceTransfer: true });
    assert.equal(db.getMutationVersion(), previous + 1, 'a synchronous endpoint must see its mutation before res.json');
    assert.equal(db.pendingFSSync, true);
    const confirmation = db.waitForMutationSync(db.getMutationVersion());
    assert.equal(state.cacheWrites, 0, 'cloud confirmation must not synchronously flush the whole disk cache');
    assert.equal(state.events[0], 'cloud-start');
    await confirmation;
    assert.equal(JSON.parse(documents.get('system/database/entities/students').payload)[0].pendingDeviceTransfer, true);
  });
});

test('already committed targets do not flush pending cache or wait for later mutations', async () => {
  await withDatabase({}, async ({ db, state }) => {
    db.updateStudent('test-student', { name: 'Committed' });
    const committed = db.getMutationVersion();
    await db.waitForMutationSync(committed);
    db.updateStudent('test-student', { name: 'Later' });
    const writes = state.cacheWrites, commits = state.commits;
    await db.waitForMutationSync(committed);
    assert.equal(state.cacheWrites, writes);
    assert.equal(state.commits, commits);
    assert.ok(db.getMutationVersion() > committed);
  });
});

test('guard refusal still applies to committed targets and blocked writes are not registered', async () => {
  await withDatabase({}, async ({ db, state }) => {
    db.updateStudent('test-student', { name: 'Saved' });
    const committed = db.getMutationVersion();
    await db.waitForMutationSync(committed);
    db.lockDatabaseGuard('isolated guard refusal');
    const commits = state.commits;
    await assert.rejects(db.waitForMutationSync(committed), /writes are blocked/);
    await db.persist();
    assert.equal(db.getMutationVersion(), committed);
    assert.equal(state.commits, commits);
  });
});

test('local-only mutation confirmation keeps immediate disk durability', async () => {
  await withDatabase({ cloud: false }, async ({ db, state, sandbox }) => {
    db.updateStudent('test-student', { name: 'Local durable' });
    await db.waitForMutationSync(db.getMutationVersion());
    assert.ok(state.cacheWrites > 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(sandbox, 'data/db.json'), 'utf8')).students[0].name, 'Local durable');
    assert.equal(state.commits, 0);
  });
});

test('ordinary background edits acknowledge a single conditional commit without rereading the database', async () => {
  await withDatabase({}, async ({ db, state, documents }) => {
    const reads = state.reads;
    db.updateStudent('test-student', { name: 'Background saved' });
    await db.performCloudSync();
    assert.equal(state.commits, 1);
    assert.equal(state.reads, reads);
    assert.equal(JSON.parse(documents.get('system/database/entities/students').payload)[0].name, 'Background saved');
  });
});

test('background metadata conflicts reread and preserve the concurrent cloud edit', async () => {
  await withDatabase({}, async ({ db, state, documents, changeExternal }) => {
    const reads = state.reads;
    db.updateStudent('test-student', { devices: [], pendingDeviceTransfer: true });
    state.beforeCommit = () => changeExternal(store => {
      const student = JSON.parse(store.get('system/database/entities/students').payload)[0];
      store.set('system/database/entities/students', { payload: JSON.stringify([{ ...student, name: 'Concurrent cloud name' }]) });
      const meta = structuredClone(store.get('system/database'));
      meta.lastUpdated = Date.now() + 100;
      store.set('system/database', meta);
    });
    await db.performCloudSync();
    assert.ok(state.reads > reads, 'failed metadata precondition must force the cloud reread');
    const saved = JSON.parse(documents.get('system/database/entities/students').payload)[0];
    assert.equal(saved.name, 'Concurrent cloud name');
    assert.equal(saved.pendingDeviceTransfer, true);
    assert.deepEqual(saved.devices, []);
  });
});
