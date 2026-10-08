import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkEntityValue, changedEntityChunks, planAtomicCloudWrite, RECORD_CHUNK_LAYOUT } from '../src/shared/atomic-cloud-write';

const records = (count: number, extra = '') => Array.from({ length: count }, (_, i) => ({
  code: `LAB-${String(i).padStart(5, '0')}`, name: `طالب ${i} ${extra}`, note: 'a,b]["}{\\"q', n: i,
}));

test('record chunks always concatenate to the exact JSON of the value', () => {
  const samples: any[] = [
    [], [1], ['x'], records(1), records(997, 'نص عربي طويل'), [null, undefined, () => 1, { a: undefined, b: [undefined] }],
    // eslint-disable-next-line no-sparse-arrays
    [1, , 3], { notAnArray: true }, null, 'text', 42,
  ];
  for (const value of samples) {
    for (const target of [1, 64, 4096, undefined]) {
      const chunks = chunkEntityValue(value, 50, null, target);
      assert.equal(chunks.payloads.join(''), JSON.stringify(value) ?? 'null');
      assert.ok(chunks.payloads.length >= 1);
    }
  }
});

test('editing one record or appending rewrites only the chunks that hold them', () => {
  const before = records(2000);
  const first = chunkEntityValue(before, 620_000, null, 8 * 1024);
  assert.equal(first.layout?.layout, RECORD_CHUNK_LAYOUT);
  assert.ok(first.payloads.length > 10);
  const stored = { chunkCount: first.payloads.length, ...first.layout };

  const edited = before.map((item, i) => (i === 1234 ? { ...item, activationDeviceToken: '' } : item));
  const one = changedEntityChunks(edited, stored, { value: before }, 620_000, 8 * 1024);
  assert.equal(one.indexes.length, 1);
  assert.equal(one.payloads.join(''), JSON.stringify(edited));
  assert.deepEqual(one.manifestEntry, stored);

  const appended = [...before, ...records(3, 'new')];
  const tail = changedEntityChunks(appended, stored, { value: before }, 620_000, 8 * 1024);
  assert.ok(tail.indexes.length <= 2 && tail.indexes.every(index => index >= first.payloads.length - 1));
  assert.equal(tail.payloads.join(''), JSON.stringify(appended));
});

test('without a trusted baseline or with another stored layout every chunk is written', () => {
  const before = records(500);
  const first = chunkEntityValue(before, 620_000, null, 4 * 1024);
  const stored = { chunkCount: first.payloads.length, ...first.layout };
  const edited = before.map((item, i) => (i === 3 ? { ...item, n: -1 } : item));
  const all = (result: ReturnType<typeof changedEntityChunks>) => result.indexes.length === result.payloads.length;
  assert.ok(all(changedEntityChunks(edited, stored, null, 620_000, 4 * 1024)));
  assert.ok(all(changedEntityChunks(edited, { chunkCount: 3 }, { value: before }, 620_000, 4 * 1024)));
  assert.ok(all(changedEntityChunks(edited, { ...stored, chunkCount: stored.chunkCount + 1 }, { value: before }, 620_000, 4 * 1024)));
});

test('an oversized single record keeps size-based slicing and a bounded chunk count', () => {
  const huge = [{ id: 'x', blob: 'ب'.repeat(700 * 1024) }, { id: 'y' }];
  const chunks = chunkEntityValue(huge, 100_000);
  assert.equal(chunks.layout, undefined);
  assert.equal(chunks.payloads.join(''), JSON.stringify(huge));
  const many = chunkEntityValue(records(60_000), 620_000, null, 64);
  assert.ok(many.payloads.length <= 200);
  assert.equal(many.payloads.join(''), JSON.stringify(records(60_000)));
});

test('atomic plan with a baseline sends only the changed chunk and keeps the layout', () => {
  const before = records(3000);
  const first = chunkEntityValue(before, 620_000, null, 16 * 1024);
  const manifest = { joinCodes: { chunkCount: first.payloads.length, ...first.layout }, students: { chunkCount: 1 } };
  const current = { joinCodes: before.map((item, i) => (i === 10 ? { ...item, n: 0.5 } : item)), students: [{ id: '1' }] };
  const previous = { joinCodes: before, students: [{ id: '1' }] };
  const plan = planAtomicCloudWrite({
    current, previous, baseline: previous, manifest, keys: ['joinCodes', 'students'], perDocKeys: new Set(),
    chunkSize: 620_000, recordTargetBytes: 16 * 1024, generation: 1, updatedAt: 'now', metaFields: {},
  })!;
  assert.deepEqual(plan.operations.map(op => `${op.collection}/${op.id}`), ['entities/joinCodes', 'meta/database']);
  assert.deepEqual(plan.manifest.joinCodes, manifest.joinCodes);
  const full = planAtomicCloudWrite({
    current, previous, manifest, keys: ['joinCodes', 'students'], perDocKeys: new Set(),
    chunkSize: 620_000, recordTargetBytes: 16 * 1024, generation: 1, updatedAt: 'now', metaFields: {},
  })!;
  assert.equal(full.operations.length, first.payloads.length + 1);
});
