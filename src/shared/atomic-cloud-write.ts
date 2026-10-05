export type CloudWriteOperation = {
  kind: 'set' | 'delete';
  collection: string;
  id: string;
  data?: any;
};

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
  const idOf = (item: any) => String(item?.id || item?.token || item?.code || '').trim();
  for (const key of options.keys) {
    const current = options.current[key] ?? null;
    const previous = options.previous[key] ?? null;
    if (manifest[key] && JSON.stringify(current) === JSON.stringify(previous)) continue;
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
      const payload = JSON.stringify(current);
      const chunkCount = Math.max(1, Math.ceil(payload.length / options.chunkSize));
      for (let index = 0; index < chunkCount; index++) {
        if (!add({ kind: 'set', collection: 'entities', id: index ? `${key}__${index}` : key,
          data: { generation: options.generation, index, chunkCount,
            payload: payload.slice(index * options.chunkSize, (index + 1) * options.chunkSize), updatedAt: options.updatedAt } })) return null;
      }
      manifest[key] = { chunkCount };
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
