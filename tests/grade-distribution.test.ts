import assert from "node:assert/strict";
import test from "node:test";
import { summarizeScores, toArabicDigits } from "../src/shared/grade-distribution.ts";

test("ungraded, missing-max and non-numeric scores are left out of the bars", () => {
  const r = summarizeScores([
    { id: "a", value: 18, max: 20 },
    { id: "b", value: null, max: 20 },
    { id: "c", value: 5, max: null },
    { id: "d", value: Number.NaN, max: 20 },
  ]);
  assert.equal(r.graded, 1);
  assert.equal(r.total, 4);
  assert.deepEqual(r.counts, [0, 0, 0, 0, 1]);
});

test("band edges: 50% and 90% open the higher band; full marks land in the top band", () => {
  const r = summarizeScores([
    { id: "a", value: 9.9, max: 20 },
    { id: "b", value: 10, max: 20 },
    { id: "c", value: 18, max: 20 },
    { id: "d", value: 20, max: 20 },
    { id: "e", value: 25, max: 20 },
  ]);
  assert.deepEqual(r.counts, [1, 1, 0, 0, 3]);
});

test("the current student's band and the average follow the live value", () => {
  const before = summarizeScores([{ id: "x", value: 12, max: 20 }, { id: "y", value: 20, max: 20 }], "x");
  assert.equal(before.currentBand, 1);
  assert.equal(Math.round((before.average ?? 0) * 100), 80);
  const after = summarizeScores([{ id: "x", value: 17, max: 20 }, { id: "y", value: 20, max: 20 }], "x");
  assert.equal(after.currentBand, 3);
});

test("Arabic-Indic digits for display", () => {
  assert.equal(toArabicDigits(2026), "٢٠٢٦");
});
