import test from "node:test";
import assert from "node:assert/strict";
import { effectiveEntityChunkCount } from "../src/server/entity-chunk-count.ts";

const c = (generation: number, chunkCount: number) => ({ generation, chunkCount });

test("keeps the manifest count when every part is from the same write", () => {
  assert.equal(effectiveEntityChunkCount([c(5, 3), c(5, 3), c(5, 3)], 3), 3);
});

test("keeps the manifest count when unchanged parts are older but within the newest layout", () => {
  assert.equal(effectiveEntityChunkCount([c(9, 3), c(4, 3), c(4, 3)], 3), 3);
});

test("drops leftover parts of an older, longer layout (manifest never updated)", () => {
  // Production case: newest write used 3 parts, manifest still says 9.
  const parts = [c(20, 3), c(20, 3), c(20, 3), c(10, 9), c(10, 9), c(10, 9), c(10, 9), c(10, 9), c(10, 9)];
  assert.equal(effectiveEntityChunkCount(parts, 9), 3);
});

test("reads extra parts when the newest write is longer than the manifest", () => {
  assert.equal(effectiveEntityChunkCount([c(20, 5), c(20, 5), c(10, 2)], 3), 5);
});

test("does not shrink when a part past the newest count is not older", () => {
  assert.equal(effectiveEntityChunkCount([c(20, 2), c(20, 2), c(20, 4)], 3), 3);
});

test("falls back to the manifest when chunks carry no usable metadata", () => {
  assert.equal(effectiveEntityChunkCount([null, null], 2), 2);
  assert.equal(effectiveEntityChunkCount([c(Number.NaN, 1)], 4), 4);
  assert.equal(effectiveEntityChunkCount([c(3, 0), c(3, 0)], 2), 2);
});
