import test from "node:test";
import assert from "node:assert/strict";
import { teacherOwnsProjectSubmission } from "../src/shared/project-submission-scope";

const teacher = "owner@example.com";
const courseOwner = (code: string) => code.slice(code.indexOf("-") + 1);

test("another teacher's pending project never adds to an admin's personal badge", () => {
  const project = { id: "other-project", courseCode: "112-peer@example.com" };
  const submission = { kind: "project", activityId: project.id, courseCode: project.courseCode,
    status: "مقفل بعد التسليم", answerText: "Submitted work", grade: "" };
  assert.equal(teacherOwnsProjectSubmission(submission, project, teacher, courseOwner), false);
  assert.equal(teacherOwnsProjectSubmission(submission, project, "peer@example.com", courseOwner), true);
});

test("personal attention includes every owned section with the same display code as other accounts", () => {
  for (const code of ["112-owner@example.com", "113-owner@example.com", "1121-owner@example.com"]) {
    assert.equal(teacherOwnsProjectSubmission({ kind: "project" }, { courseCode: code }, teacher, courseOwner), true);
  }
  assert.equal(teacherOwnsProjectSubmission({ kind: "project" }, { courseCode: "112-peer@example.com" }, teacher, courseOwner), false);
});

test("the current project's course determines ownership when a saved row lacks its course", () => {
  assert.equal(teacherOwnsProjectSubmission({ kind: "project" }, { courseCode: "112-peer@example.com" }, teacher, courseOwner), false);
  assert.equal(teacherOwnsProjectSubmission({ kind: "project" }, { createdBy: "OWNER@example.com" }, teacher, courseOwner), true);
  assert.equal(teacherOwnsProjectSubmission({ kind: "project" }, {}, teacher, courseOwner), false);
  assert.equal(teacherOwnsProjectSubmission({ kind: "exam" }, { createdBy: teacher }, teacher, courseOwner), false);
});
