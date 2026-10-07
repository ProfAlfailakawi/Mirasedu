import test from "node:test";
import assert from "node:assert/strict";
import { retryableCreateAttempt } from "../src/shared/retryable-create";
import { shouldApplySubmissionCourseResponse } from "../src/shared/submission-fetch-scope";
import { dateInputValueInTimeZone } from "../src/shared/date-input";

test("project/exam create retry reuses an ID until payload changes", () => {
  const first = retryableCreateAttempt(null, "same-payload", "project", () => "stable");
  first.busy = false;
  assert.equal(retryableCreateAttempt(first, "same-payload", "project", () => "wrong").id, "project-stable");
  assert.equal(retryableCreateAttempt(first, "edited-payload", "project", () => "new").id, "project-new");
});

test("late submissions response for an old course is ignored", () => {
  assert.equal(shouldApplySubmissionCourseResponse("501-A", "501-B", (a, b) => a === b), false);
  assert.equal(shouldApplySubmissionCourseResponse("501-A", "501-A", (a, b) => a === b), true);
});

test("project date defaults use the Kuwait calendar day", () => {
  assert.equal(dateInputValueInTimeZone(new Date("2026-10-07T21:30:00.000Z"), "Asia/Kuwait"), "2026-10-08");
});
