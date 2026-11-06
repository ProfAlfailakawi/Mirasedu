// Cloud entities are stored as `entities/<key>`, `entities/<key>__1`, ... and the
// `system/database` manifest says how many parts to read. Chunks are written first
// and the manifest last, so a writer that stops in between (container stopped,
// network drop) leaves the manifest describing an older layout. Each chunk records
// the `generation` and `chunkCount` of the write that produced it, which is enough
// to tell which parts belong to the newest layout.

export type EntityChunkInfo = { generation: number; chunkCount: number };

const MAX_ENTITY_CHUNKS = 250;

/**
 * How many parts of an entity belong to its newest layout.
 * - Newest write used fewer parts than the manifest: parts past that count are
 *   leftovers of an older generation and must not be appended to the payload.
 * - Newest write used more parts than the manifest: the extra parts must be read.
 * Falls back to the manifest count when the chunks carry no usable metadata.
 */
export function effectiveEntityChunkCount(
  chunks: Array<EntityChunkInfo | null>,
  manifestCount: number,
): number {
  let newest: EntityChunkInfo | null = null;
  for (const info of chunks) {
    if (!info || !Number.isFinite(info.generation) || !Number.isFinite(info.chunkCount)) continue;
    if (!newest || info.generation > newest.generation) newest = info;
  }
  if (!newest) return manifestCount;
  const count = Math.floor(newest.chunkCount);
  if (count < 1 || count > MAX_ENTITY_CHUNKS) return manifestCount;
  if (count > manifestCount) return count;
  // Shrink only when every part we drop is strictly older than the newest write.
  for (let i = count; i < Math.min(manifestCount, chunks.length); i += 1) {
    const info = chunks[i];
    if (!info || !(info.generation < newest.generation)) return manifestCount;
  }
  return count;
}

/**
 * Last resort when the joined chunks are not valid JSON: the shortest run of leading
 * chunks that is a complete JSON array or object. A complete document cannot be cut
 * short by accident, so whatever follows it can only be leftovers of another write.
 */
export function recoverEntityPayload(parts: string[]): { value: any; chunkCount: number } | null {
  let joined = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    joined += parts[i];
    const end = joined.trimEnd().slice(-1);
    if (end !== "]" && end !== "}") continue;
    try {
      return { value: JSON.parse(joined), chunkCount: i + 1 };
    } catch {
      // Not complete yet.
    }
  }
  return null;
}
