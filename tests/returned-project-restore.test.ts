import test from 'node:test';
import assert from 'node:assert/strict';
import { returnedProjectDraft } from '../src/shared/returned-project-restore';

const att = [{ id: 'a1', name: 'report.pdf', url: '/u/report.pdf' }];

test('a returned project restores the original text and files', () => {
  const d = returnedProjectDraft('p1', {
    status: 'معاد للطالب', returnedAt: '2026-11-21T10:00:00Z',
    previousAnswerText: 'رابط المشروع: https://x.test', answerText: 'تم إرجاع النشاط للطالب؛ المحاولة مفتوحة من جديد.',
    attachments: att,
  });
  assert.equal(d?.text, 'رابط المشروع: https://x.test');
  assert.deepEqual(d?.attachments, att);
  assert.equal(d?.key, 'p1:2026-11-21T10:00:00Z');
});
test('the default "submitted with files" text is not restored into the box', () => {
  const d = returnedProjectDraft('p1', {
    status: 'معاد للطالب', returnedAt: 't',
    previousAnswerText: 'تم تسليم المشروع بمرفقات ومستندات مفصلة', attachments: att,
  });
  assert.equal(d?.text, '');
  assert.equal(d?.attachments.length, 1);
});
test('not returned, or nothing to restore, yields null', () => {
  assert.equal(returnedProjectDraft('p1', { status: 'مقفل بعد التسليم', answerText: 'x' }), null);
  assert.equal(returnedProjectDraft('p1', { status: 'معاد للطالب', returnedAt: 't', answerText: 'تم إرجاع النشاط للطالب' }), null);
  assert.equal(returnedProjectDraft('p1', undefined), null);
});
