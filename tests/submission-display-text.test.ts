import test from 'node:test';
import assert from 'node:assert/strict';
import { studentSubmissionDisplayText } from '../src/shared/submission-display-text';
const fmt = (sub: any) => `formatted:${Object.keys(sub.answers || {}).length || (sub.matchedQuestions || []).length}`;
test('a project answer written by the student is shown as is', () => {
  assert.equal(studentSubmissionDisplayText({ kind: 'project', answerText: ' حل الطالب ' }, fmt), 'حل الطالب');
});
test('files-only project submissions show no fake text', () => {
  for (const text of ['تم تسليم المشروع بمرفقات ومستندات مفصلة', 'تم تسليم المشروع بمرفق ومستندات.', 'تم تسليم المشروع بنجاح'])
    assert.equal(studentSubmissionDisplayText({ kind: 'project', answerText: text }, fmt), '');
});
test('alternate field names are read', () => {
  assert.equal(studentSubmissionDisplayText({ kind: 'exercise', submissionText: 'نص بديل' }, fmt), 'نص بديل');
});
test('exam answers go through the structured formatter', () => {
  assert.equal(studentSubmissionDisplayText({ kind: 'exam', answers: { q1: 'أ' }, answerText: 'دخل الطالب' }, fmt), 'formatted:1');
  assert.equal(studentSubmissionDisplayText({ kind: 'exam', matchedQuestions: [{}, {}] }, fmt), 'formatted:2');
});
test('an exam with no answers does not show its system message as the answer', () => {
  assert.equal(studentSubmissionDisplayText({ kind: 'exam', answerText: 'دخل الطالب الاختبار وبدأت محاولته' }, fmt), '');
});
test('empty or missing submissions give an empty string', () => {
  assert.equal(studentSubmissionDisplayText(null, fmt), '');
  assert.equal(studentSubmissionDisplayText({ kind: 'project' }, fmt), '');
});
test('a returned project shows the preserved original answer, not the return notice', () => {
  const returned = {
    kind: 'project',
    status: 'معاد للطالب',
    answerText: 'تم إرجاع النشاط للطالب؛ المحاولة مفتوحة من جديد.',
    previousAnswerText: 'حل الطالب الأصلي',
  };
  assert.equal(studentSubmissionDisplayText(returned, fmt), 'حل الطالب الأصلي');
  assert.equal(studentSubmissionDisplayText({ ...returned, previousAnswerText: '' }, fmt), '');
});
