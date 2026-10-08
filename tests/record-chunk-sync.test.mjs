import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { build } from 'esbuild';

// Runs the real LocalDatabase against a deterministic in-memory Firestore and,
// after every confirmed save, rebuilds each entity from the stored chunk
// documents exactly as a booting server would. Random edits, appends, removals,
// in-place nested edits, edits racing a commit, and an older server version
// writing in the old layout must all reconstruct to the in-memory database.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PERDOC = ['activityLogs', 'examSessions', 'inAppNotifications', 'notificationAudit', 'errorReports'];

test('record-aligned chunk writes always reconstruct the exact database', async () => {
  const root = process.cwd(), sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'miras-record-chunks-'));
  const documents = new Map();
  let listener, revision = 1, mutateDuringCommit = null, entityWrites = 0;
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = list => list[Math.floor(random() * list.length)];
  const initial = {
    students: Array.from({ length: 300 }, (_, i) => ({ id: String(5000 + i), name: `طالب ${i}`, devices: [`d${i}`], enrollments: [{ courseCode: 'C1' }] })),
    joinCodes: Array.from({ length: 3000 }, (_, i) => ({ code: `LAB-${i}`, studentId: String(5000 + (i % 300)), sig: 'x'.repeat(120), status: 'active' })),
    teachers: [], sections: [],
  };
  const manifest = Object.fromEntries(Object.keys(initial).map(key => [key, { chunkCount: 1 }]));
  documents.set('system/database', { storageFormat: 'entity-json-v3', entityKeys: Object.keys(initial), entityManifest: manifest, lastUpdated: 100, contentCounts: { students: 300 } });
  for (const [key, value] of Object.entries(initial)) documents.set(`system/database/entities/${key}`, { payload: JSON.stringify(value) });
  const snapshot = p => ({ exists: documents.has(p), data: () => structuredClone(documents.get(p)), updateTime: revision });
  const ref = p => ({
    path: p,
    get: async () => snapshot(p),
    collection: key => ({ doc: id => ref(`${p}/${key}/${id}`), get: async () => ({ docs: [...documents.keys()].filter(k => k.startsWith(`${p}/${key}/`)).map(k => snapshot(k)) }), listDocuments: async () => [] }),
    onSnapshot: fn => { listener = fn; return () => { listener = null; }; },
    set: async data => {
      if (p.includes('/entities/')) entityWrites++;
      documents.set(p, structuredClone(data)); revision++;
      if (p === 'system/database') listener?.(snapshot(p));
      return { writeTime: revision };
    },
  });
  globalThis.__mirasChunkCloud = { doc: ref, batch: () => {
    const operations = [];
    return {
      set: (r, d) => operations.push([r.path, d]),
      update: (r, d, condition) => { if (condition.lastUpdateTime !== revision) throw Object.assign(new Error('stale'), { code: 9 }); operations.push([r.path, d]); },
      delete: r => operations.push([r.path, null]),
      commit: async () => {
        for (const [p, d] of operations) {
          if (p.includes('/entities/')) entityWrites++;
          d === null ? documents.delete(p) : documents.set(p, structuredClone(d));
        }
        revision++;
        listener?.(snapshot('system/database'));
        if (mutateDuringCommit) { const mutate = mutateDuringCommit; mutateDuringCommit = null; mutate(); }
        await pause(2);
        return operations.map(() => ({ writeTime: revision }));
      },
    };
  } };
  const reconstruct = key => {
    const info = documents.get('system/database').entityManifest[key];
    const parts = [];
    for (let index = 0; index < info.chunkCount; index++) parts.push(documents.get(`system/database/entities/${index ? `${key}__${index}` : key}`).payload);
    return JSON.parse(parts.join(''));
  };
  let db;
  try {
    fs.writeFileSync(path.join(sandbox, 'firebase-applet-config.json'), JSON.stringify({ projectId: 'test-only', firestoreDatabaseId: 'test-only' }));
    const bundled = await build({ entryPoints: [path.join(root, 'src/server/db.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, plugins: [{ name: 'fake-firestore', setup(builder) {
      builder.onResolve({ filter: /^firebase-admin\/(app|firestore|storage)$/ }, args => ({ path: args.path, namespace: 'fake' }));
      builder.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ contents: args.path.endsWith('/app')
        ? 'export const applicationDefault=()=>({}); export const getApps=()=>[]; export const initializeApp=()=>({});'
        : args.path.endsWith('/firestore') ? 'export const getFirestore=()=>globalThis.__mirasChunkCloud;'
        : 'export const getStorage=()=>({bucket:()=>({})});' }));
    } }] });
    process.chdir(sandbox);
    const module = new Module(path.join(root, 'tests', 'isolated-chunk-db.cjs'));
    module.filename = path.join(root, 'tests', 'isolated-chunk-db.cjs'); module.paths = Module._nodeModulePaths(path.join(root, 'tests'));
    module._compile(bundled.outputFiles[0].text, module.filename);
    db = module.exports.dbInstance;
    await db.initialSyncPromise;
    // Every entity exists in the cloud manifest (as after the first save of a running system).
    for (const [key, value] of Object.entries(db.data)) {
      if (key === 'lastUpdated') continue;
      if (PERDOC.includes(key)) { manifest[key] = { chunkCount: 1, perDoc: true, count: value?.length || 0 }; continue; }
      manifest[key] = { chunkCount: 1 };
      documents.set(`system/database/entities/${key}`, { payload: JSON.stringify(value ?? null) });
    }
    db.lastEntityManifest = structuredClone(manifest);
    const meta = documents.get('system/database'); meta.entityManifest = manifest; meta.entityKeys = Object.keys(manifest);

    const verify = label => {
      for (const key of Object.keys(documents.get('system/database').entityManifest)) {
        if (PERDOC.includes(key)) continue;
        assert.deepEqual(reconstruct(key), JSON.parse(JSON.stringify(db.data[key] ?? null)), `${label}: ${key}`);
      }
    };
    const confirm = async label => { await db.waitForMutationSync(db.getMutationVersion()); await pause(5); verify(label); };

    db.updateStudent('5000', { devices: [] }); await confirm('first save converts the layout');
    assert.equal(documents.get('system/database').entityManifest.students.layout, 'records-v1');

    const edits = [
      () => db.updateJoinCode(pick(db.getJoinCodes()).code, { activationDeviceToken: '', status: pick(['active', 'used']) }),
      () => db.updateStudent(pick(db.getStudents()).id, { devices: [String(random())], pendingDeviceTransfer: true }),
      () => db.addJoinCode({ code: `LAB-N${Math.floor(random() * 1e9)}`, studentId: '5001', sig: 'y'.repeat(80) }),
      () => { db.data.joinCodes.splice(Math.floor(random() * db.data.joinCodes.length), 1); db.persist(); },
      () => { const student = pick(db.getStudents()); (student.enrollments ||= []).push({ courseCode: `C${Math.floor(random() * 9)}` }); db.persist(); },
      () => { db.data.students.unshift({ id: String(9000 + Math.floor(random() * 1e6)), name: 'جديد' }); db.persist(); },
    ];
    for (let round = 0; round < 60; round++) {
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i++) pick(edits)();
      if (round % 7 === 3) mutateDuringCommit = () => pick(edits)();
      await confirm(`round ${round}`);
    }

    // A late echo of an earlier write (its manifest describes older chunk counts)
    // is discarded and must not replace the writer's view of the stored layout.
    const staleMeta = structuredClone(documents.get('system/database'));
    for (let i = 0; i < 2500; i++) db.addJoinCode({ code: `LAB-GROW${i}`, studentId: '5003', sig: 'z'.repeat(120) });
    await confirm('growth before stale echo');
    assert.notEqual(staleMeta.entityManifest.joinCodes.chunkCount, documents.get('system/database').entityManifest.joinCodes.chunkCount);
    listener({ exists: true, data: () => structuredClone(staleMeta), updateTime: revision - 1 });
    await pause(30);
    for (let round = 0; round < 5; round++) { db.updateStudent(pick(db.getStudents()).id, { name: `بعد ${round}` }); await confirm(`after stale echo ${round}`); }

    // A single code edit uploads one chunk, not the whole list.
    entityWrites = 0;
    db.updateJoinCode(db.getJoinCodes()[1500].code, { status: 'revoked' });
    await confirm('single code edit');
    assert.ok(documents.get('system/database').entityManifest.joinCodes.chunkCount > 2);
    assert.equal(entityWrites, 1, 'one changed joinCodes chunk');

    // An older server version rewrites joinCodes in the old size-sliced layout.
    const external = structuredClone(documents.get('system/database'));
    const legacyCodes = [...JSON.parse(JSON.stringify(db.data.joinCodes)), { code: 'LAB-OLD-SERVER', studentId: '5002' }];
    documents.set('system/database/entities/joinCodes', { payload: JSON.stringify(legacyCodes) });
    external.entityManifest.joinCodes = { chunkCount: 1 };
    external.lastUpdated = Date.now() + 60_000;
    documents.set('system/database', external); revision++; listener(snapshot('system/database'));
    await pause(30);
    assert.ok(db.getJoinCodes().some(item => item.code === 'LAB-OLD-SERVER'));
    db.updateJoinCode(db.getJoinCodes()[10].code, { status: 'used' });
    await confirm('after an old-layout external write');
    assert.ok(reconstruct('joinCodes').some(item => item.code === 'LAB-OLD-SERVER'));
    for (let round = 0; round < 10; round++) { pick(edits)(); await confirm(`after external ${round}`); }
  } finally {
    if (db) { clearTimeout(db.persistTimeout); clearTimeout(db.localSaveDelayTimer); clearImmediate(db.localSaveTimer); db.pendingFSSync = false; db.dirtyLocal = false; db.cloudUnsubscribe?.(); }
    process.chdir(root); delete globalThis.__mirasChunkCloud; fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
