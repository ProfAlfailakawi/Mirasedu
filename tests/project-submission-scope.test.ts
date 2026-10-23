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

import { isFreshSubmissionNews, teacherOwnsSubmissionCourse } from "../src/shared/project-submission-scope";

const quiet = { returned: false, inProgress: false, alert: false };
const seen = Date.parse("2026-10-23T10:00:00Z");

test("a hand-in after the last visit is news; an older one is not", () => {
  assert.equal(isFreshSubmissionNews({ submittedAt: "2026-10-23T10:05:00Z" }, seen, quiet), true);
  assert.equal(isFreshSubmissionNews({ submittedAt: "2026-10-23T09:00:00Z" }, seen, quiet), false);
  assert.equal(isFreshSubmissionNews({ resubmittedAt: "2026-10-23T10:05:00Z", submittedAt: "2026-10-22T10:00:00Z" }, seen, quiet), true);
});

test("teacher-side edits and in-progress exams are never news", () => {
  const edited = { submittedAt: "2026-10-23T09:00:00Z", updatedAt: "2026-10-23T11:00:00Z" };
  assert.equal(isFreshSubmissionNews(edited, seen, quiet), false);
  assert.equal(isFreshSubmissionNews({ submittedAt: "2026-10-23T10:05:00Z" }, seen, { ...quiet, returned: true }), false);
  assert.equal(isFreshSubmissionNews({ submittedAt: "2026-10-23T10:05:00Z" }, seen, { ...quiet, inProgress: true }), false);
});

test("an integrity alert after the last visit is news even without a new hand-in", () => {
  const flagged = { submittedAt: "2026-10-23T09:00:00Z", updatedAt: "2026-10-23T10:30:00Z", isCheating: true };
  assert.equal(isFreshSubmissionNews(flagged, seen, quiet), true);
  assert.equal(isFreshSubmissionNews({ submittedAt: "2026-10-23T09:00:00Z", updatedAt: "2026-10-23T10:30:00Z" }, seen, { ...quiet, alert: true }), true);
});

test("without a baseline nothing is news", () => {
  assert.equal(isFreshSubmissionNews({ submittedAt: "2026-10-23T10:05:00Z" }, 0, quiet), false);
});

test("exam hand-ins count only for the owner of their course", () => {
  assert.equal(teacherOwnsSubmissionCourse({ courseCode: "112-owner@example.com" }, teacher, courseOwner), true);
  assert.equal(teacherOwnsSubmissionCourse({ courseCode: "112-peer@example.com" }, teacher, courseOwner), false);
  assert.equal(teacherOwnsSubmissionCourse({}, teacher, courseOwner), true);
});
