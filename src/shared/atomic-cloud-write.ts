export type CloudWriteOperation = {
  kind: 'set' | 'delete';
  collection: string;
  id: string;
  data?: any;
};

export const RECORD_CHUNK_LAYOUT = 'records-v1';
const RECORD_CHUNK_TARGET_BYTES = 192 * 1024;
// Well under Firestore's 1 MiB document limit, counted in UTF-8 bytes (Arabic text is 2 bytes per letter).
const RECORD_CHUNK_MAX_BYTES = 640 * 1024;
// Readers refuse more than 250 chunks for one entity.
const RECORD_CHUNK_MAX_COUNT = 200;

const utf8Length = (text: string) => {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
  return new TextEncoder().encode(text).byteLength;
};

export type EntityChunks = {
  payloads: string[];
  layout?: { layout: string; recordsPerChunk: number };
};

/** Remembers chunks of values that are never mutated (cloud snapshots). */
export type EntityChunkMemo = {
  get(value: any, key: string): EntityChunks | undefined;
  set(value: any, key: string, chunks: EntityChunks): void;
};

const storedRecordsPerChunk = (stored?: { layout?: string; recordsPerChunk?: number } | null) =>
  stored?.layout === RECORD_CHUNK_LAYOUT && Number.isSafeInteger(stored.recordsPerChunk) &&
  Number(stored.recordsPerChunk) >= 1 ? Number(stored.recordsPerChunk) : 0;

/**
 * Splits an entity's JSON into chunk payloads whose concatenation is exactly
 * JSON.stringify(value), so every reader (older servers included) is unaffected.
 * Arrays are cut between records with a fixed number of records per chunk, kept
 * from the stored layout, so editing one record or appending new ones changes
 * only the chunks that hold them instead of every chunk after a byte offset.
 */
export function chunkEntityValue(
  value: any,
  chunkSize: number,
  stored?: { layout?: string; recordsPerChunk?: number } | null,
  targetBytes = RECORD_CHUNK_TARGET_BYTES,
): EntityChunks {
  const bySize = (json: string): EntityChunks => {
    const payloads: string[] = [];
    for (let i = 0; i < json.length; i += chunkSize) payloads.push(json.slice(i, i + chunkSize));
    if (!payloads.length) payloads.push('null');
    return { payloads };
  };
  if (!Array.isArray(value)) return bySize(JSON.stringify(value) ?? 'null');
  // Same element encoding as JSON.stringify(array): holes and unserializable values become null.
  const records = Array.from(value, (item) => JSON.stringify(item) ?? 'null');
  if (!records.length) return { payloads: ['[]'], layout: { layout: RECORD_CHUNK_LAYOUT, recordsPerChunk: 1 } };
  const layoutFor = (perChunk: number): string[] | null => {
    if (Math.ceil(records.length / perChunk) > RECORD_CHUNK_MAX_COUNT) return null;
    const payloads: string[] = [];
    for (let start = 0; start < records.length; start += perChunk) {
      const payload = (start === 0 ? '[' : ',') + records.slice(start, start + perChunk).join(',') +
        (start + perChunk >= records.length ? ']' : '');
      if (payload.length * 3 > RECORD_CHUNK_MAX_BYTES && utf8Length(payload) > RECORD_CHUNK_MAX_BYTES) return null;
      payloads.push(payload);
    }
    return payloads;
  };
  const kept = storedRecordsPerChunk(stored);
  let perChunk = kept;
  let payloads = kept ? layoutFor(kept) : null;
  if (!payloads) {
    const averageRecord = records.reduce((total, record) => total + record.length + 1, 0) / records.length;
    perChunk = Math.max(1, Math.floor(targetBytes / Math.max(1, averageRecord)),
      Math.ceil(records.length / RECORD_CHUNK_MAX_COUNT));
    payloads = layoutFor(perChunk);
    while (!payloads && perChunk > 1) {
      perChunk = Math.max(1, Math.floor(perChunk / 2));
      payloads = layoutFor(perChunk);
    }
  }
  // A single oversized record cannot be cut between records; keep size-based slicing for it.
  if (!payloads) return bySize('[' + records.join(',') + ']');
  return { payloads, layout: { layout: RECORD_CHUNK_LAYOUT, recordsPerChunk: perChunk } };
}

/**
 * Chunk documents to write for one entity. `baseline` must be exactly what the
 * cloud holds for this entity under `stored`; chunks identical to it are skipped.
 * Without a trustworthy baseline every chunk is written.
 */
export function changedEntityChunks(
  value: any,
  stored: Record<string, any> | null | undefined,
  baseline: { value: any } | null,
  chunkSize: number,
  targetBytes?: number,
  memo?: EntityChunkMemo,
) {
  const chunksOf = (input: any, entry: Record<string, any> | null | undefined) => {
    const memoKey = (layoutEntry: any) => `${chunkSize}:${targetBytes ?? ''}:${storedRecordsPerChunk(layoutEntry)}`;
    const hit = memo?.get(input, memoKey(entry));
    if (hit) return hit;
    const chunks = chunkEntityValue(input, chunkSize, entry, targetBytes);
    memo?.set(input, memoKey(entry), chunks);
    // Re-chunking with the resulting layout reproduces these exact chunks.
    if (chunks.layout) memo?.set(input, memoKey(chunks.layout), chunks);
    return chunks;
  };
  const next = chunksOf(value, stored);
  let before: string[] | null = null;
  if (baseline && stored && next.layout && stored.layout === next.layout.layout &&
      Number(stored.recordsPerChunk) === next.layout.recordsPerChunk) {
    const previous = chunksOf(baseline.value, stored);
    if (previous.layout && previous.payloads.length === Number(stored.chunkCount)) before = previous.payloads;
  }
  const indexes = next.payloads
    .map((payload, index) => (before && index < before.length && before[index] === payload ? -1 : index))
    .filter((index) => index >= 0);
  const manifestEntry = next.layout
    ? { chunkCount: next.payloads.length, ...next.layout }
    : { chunkCount: next.payloads.length };
  return { payloads: next.payloads, indexes, manifestEntry };
}

/** Small device transfers can commit their changed documents and manifest together. */
export function planAtomicCloudWrite(options: {
  current: Record<string, any>;
  previous: Record<string, any> | null;
  manifest: Record<string, any>;
  keys: readonly string[];
  perDocKeys: ReadonlySet<string>;
  chunkSize: number;
  generation: number;
  updatedAt: string;
  metaFields: Record<string, any>;
  maxOperations?: number;
  maxBytes?: number;
  /** Exactly the cloud's current state; enables rewriting only changed chunks. */
  baseline?: Record<string, any> | null;
  /** JSON.stringify, optionally answered from a cache of immutable snapshots. */
  serialize?: (value: any) => string;
  chunkMemo?: EntityChunkMemo;
  recordTargetBytes?: number;
}) {
  if (!options.previous || options.chunkSize < 1) return null;
  const manifest = { ...options.manifest };
  const operations: CloudWriteOperation[] = [];
  const encoder = new TextEncoder();
  const maxOperations = options.maxOperations ?? 400;
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  let bytes = 0;
  const add = (operation: CloudWriteOperation) => {
    // Leave generous space below Firestore's request limit for names and encoding.
    bytes += encoder.encode(JSON.stringify(operation)).byteLength + 1024;
    operations.push(operation);
    return operations.length <= maxOperations && bytes <= maxBytes;
  };
  const serialize = options.serialize ?? ((value: any) => JSON.stringify(value));
  const idOf = (item: any) => String(item?.id || item?.token || item?.code || '').trim();
  for (const key of options.keys) {
    const current = options.current[key] ?? null;
    const previous = options.previous[key] ?? null;
    if (manifest[key] && serialize(current) === serialize(previous)) continue;
    if (!manifest[key]) return null; // Initialization and restoration keep the established writer.
    if (options.perDocKeys.has(key) && Array.isArray(current)) {
      if (!manifest[key].perDoc || !Array.isArray(previous)) return null;
      const currentItems = new Map<string, any>(current.map(item => [idOf(item), item] as [string, any]).filter(([id]) => !!id));
      const previousItems = new Map<string, any>(previous.map(item => [idOf(item), item] as [string, any]).filter(([id]) => !!id));
      for (const [id, item] of currentItems) {
        if (id.includes('/')) return null;
        if (previousItems.has(id) && JSON.stringify(item) === JSON.stringify(previousItems.get(id))) continue;
        if (!add({ kind: 'set', collection: `perdoc_${key}`, id,
          data: { d: item, g: options.generation, u: options.updatedAt } })) return null;
      }
      for (const id of previousItems.keys()) {
        if (id.includes('/')) return null;
        if (!currentItems.has(id) && !add({ kind: 'delete', collection: `perdoc_${key}`, id })) return null;
      }
      manifest[key] = { chunkCount: Number(manifest[key].chunkCount || 1), perDoc: true, count: current.length };
    } else {
      const baseline = options.baseline ? { value: options.baseline[key] ?? null } : null;
      const chunks = changedEntityChunks(current, manifest[key], baseline, options.chunkSize, options.recordTargetBytes, options.chunkMemo);
      const chunkCount = chunks.payloads.length;
      for (const index of chunks.indexes) {
        if (!add({ kind: 'set', collection: 'entities', id: index ? `${key}__${index}` : key,
          data: { generation: options.generation, index, chunkCount,
            payload: chunks.payloads[index], updatedAt: options.updatedAt } })) return null;
      }
      manifest[key] = chunks.manifestEntry;
    }
  }
  if (!add({ kind: 'set', collection: 'meta', id: 'database', data: { ...options.metaFields, entityManifest: manifest } })) return null;
  return { manifest, operations };
}

export async function commitAtomicCloudWrite(plan: { operations: CloudWriteOperation[] }, batch: {
  set: (operation: CloudWriteOperation) => void;
  delete: (operation: CloudWriteOperation) => void;
  commit: () => Promise<unknown>;
}) {
  for (const operation of plan.operations) {
    if (operation.kind === 'delete') batch.delete(operation);
    else batch.set(operation);
  }
  return await batch.commit();
}

/** Only version conflicts may fall back to rereading/merging; quota and transport errors propagate. */
export async function attemptOptimisticCloudCommit(write: () => Promise<boolean>) {
  try {
    return await write() ? 'committed' as const : 'unsupported' as const;
  } catch (error: any) {
    if ([5, 9, 10, 'not-found', 'failed-precondition', 'aborted'].includes(error?.code)) return 'conflict' as const;
    throw error;
  }
}

export function canReuseCloudBaseline(metaStamp: number, baseStamp: number, writtenStamp: number, listenerStamp: number, conflicted: boolean) {
  return !conflicted && metaStamp > 0 && metaStamp === baseStamp &&
    (metaStamp === writtenStamp || metaStamp === listenerStamp);
}
