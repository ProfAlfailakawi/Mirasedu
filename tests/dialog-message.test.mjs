import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

// Runs the real compactMirasDialogMessage from App.tsx (the short title of every confirm dialog).
const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const compactMirasDialogMessage = (');
const snippet = source.slice(start, source.indexOf('\nconst allowedRosterRowsToText', start));
const { code } = await transform(`${snippet}\nexport { compactMirasDialogMessage };`, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
new Function('module', 'exports', 'simplifyMirasMessage', code)(module, module.exports, (text) => text);
const compact = module.exports.compactMirasDialogMessage;

const SUSPEND = 'هل تريد تعطيل دخول هذا الطالب إلى هذا المقرر فقط؟ سيبقى الطالب مسجلًا، ولن يتم حذف بياناته أو تسليماته أو درجاته.';

test('suspending a student in one course is not shown as a deletion', () => {
  assert.equal(compact(SUSPEND), 'إيقاف الطالب في هذا المقرر؟');
});
test('real deletions keep their titles', () => {
  assert.equal(compact('حذف الطالب من كشف هذا المقرر؟'), 'حذف الطالب؟');
  assert.equal(compact('هل تريد حذف هذا المشروع؟'), 'حذف المشروع؟');
  assert.equal(compact('حذف الاختبار نهائياً'), 'حذف الاختبار؟');
});
test('a negated deletion never becomes a delete title, other messages are unchanged', () => {
  assert.notEqual(compact('تعطيل الحساب، ولن يتم حذف أي شيء'), 'حذف؟');
  assert.equal(compact('هل تريد إيقاف الحساب؟'), 'إيقاف الحساب؟');
  assert.equal(compact('تفعيل الطالب'), 'تفعيل الحساب؟');
  assert.equal(compact(''), 'هل أنت متأكد؟');
});
