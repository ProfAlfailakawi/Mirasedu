import test from "node:test";
import assert from "node:assert/strict";
import { gradeActivityColumnTitle, ungradedAttemptIds } from "../src/shared/submission-grading-selection";

test("bulk selection includes only completed, ungraded work and explicitly returned work", () => {
  const rows = [
    { id: "pending", hasWork: true, hasGrade: false, inProgress: false, cheating: false, returned: false },
    { id: "graded", hasWork: true, hasGrade: true, inProgress: false, cheating: false, returned: false },
    { id: "active", hasWork: true, hasGrade: false, inProgress: true, cheating: false, returned: false },
    { id: "cheating", hasWork: true, hasGrade: false, inProgress: false, cheating: true, returned: false },
    { id: "returned", hasWork: true, hasGrade: true, inProgress: false, cheating: false, returned: true },
    { id: "not-started", hasWork: false, hasGrade: false, inProgress: false, cheating: false, returned: false },
  ];
  assert.deepEqual(ungradedAttemptIds(rows), ["pending", "returned"]);
});

test("CSV project columns use the activity title while exam columns stay labeled", () => {
  assert.equal(gradeActivityColumnTitle("project", "المشروع الأول"), "المشروع الأول");
  assert.equal(gradeActivityColumnTitle("exam", "الاختبار الأول"), "اختبار: الاختبار الأول");
});
