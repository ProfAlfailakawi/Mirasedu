import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REVIEW_DEMO_ACCESS_CODE,
  isReviewDemoEntryNumber,
  normalizeReviewDemoCandidate,
} from '../src/shared/review-demo-entry';

test('the reserved reviewer code is long, alphanumeric, never purely numeric and not guessable', () => {
  assert.match(REVIEW_DEMO_ACCESS_CODE, /^[a-z2-9]{12,}$/);
  assert.doesNotMatch(REVIEW_DEMO_ACCESS_CODE, /^\d+$/);
  assert.match(REVIEW_DEMO_ACCESS_CODE, /[a-z]/);
  assert.match(REVIEW_DEMO_ACCESS_CODE, /\d/);
  assert.doesNotMatch(REVIEW_DEMO_ACCESS_CODE, /test|demo|apple|review|miras/i);
});

test('the old guessable number no longer opens the demo', () => {
  assert.equal(isReviewDemoEntryNumber('9999999999'), false);
});

test('only exactly the reserved code opens the reviewer demo (case-insensitive, spaces ignored)', () => {
  assert.equal(isReviewDemoEntryNumber(REVIEW_DEMO_ACCESS_CODE), true);
  assert.equal(isReviewDemoEntryNumber(` ${REVIEW_DEMO_ACCESS_CODE.toUpperCase()} `), true);
  assert.equal(isReviewDemoEntryNumber(REVIEW_DEMO_ACCESS_CODE.slice(1)), false);
  assert.equal(isReviewDemoEntryNumber(`${REVIEW_DEMO_ACCESS_CODE}0`), false);
  assert.equal(isReviewDemoEntryNumber('2200123456'), false);
  assert.equal(isReviewDemoEntryNumber(''), false);
  assert.equal(isReviewDemoEntryNumber(undefined), false);
});

test('Arabic-Indic and Persian digits inside the code are normalised', () => {
  const arabic = REVIEW_DEMO_ACCESS_CODE.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  const persian = REVIEW_DEMO_ACCESS_CODE.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  assert.equal(normalizeReviewDemoCandidate(arabic), REVIEW_DEMO_ACCESS_CODE);
  assert.equal(isReviewDemoEntryNumber(arabic), true);
  assert.equal(isReviewDemoEntryNumber(persian), true);
});

test('App.tsx: the code opens the demo before any real roster lookup, no demo button renders, and the field is not auto-capitalised', () => {
  const src = fs.readFileSync('App.tsx', 'utf8');
  const start = src.indexOf('const handleLoginIdentify = async () => {');
  assert.ok(start > 0);
  const body = src.slice(start, start + 2500);
  const guard = body.indexOf('isReviewDemoEntryNumber(identity)');
  const lookup = body.indexOf('/api/auth/identify/');
  assert.ok(guard > 0 && lookup > guard, 'guard must precede the roster lookup');
  assert.match(body.slice(guard, guard + 200), /enterDemo\(\)/);
  assert.doesNotMatch(src, /MIRAS_DEMO_ENTRY_VISIBLE/);
  assert.doesNotMatch(src, /جرّب العرض التجريبي/);
  const input = src.indexOf('id="miras-login-identity"');
  assert.ok(input > 0);
  assert.match(src.slice(input, input + 500), /autoCapitalize="none"/);
});

test('a visible, persistent Arabic notice states that the demo saves nothing and reaches no teacher', () => {
  const src = fs.readFileSync('App.tsx', 'utf8');
  assert.match(src, /miras-demo-notice/);
  assert.match(src, /عرض تجريبي ببيانات وهمية — لا يُحفظ شيء ولا يصل لأي معلّم/);
});

test('the server never registers the reserved code as a real student', () => {
  const server = fs.readFileSync('server.ts', 'utf8');
  const db = fs.readFileSync('src/server/db.ts', 'utf8');
  assert.match(server, /import \{ isReviewDemoEntryNumber \} from "\.\/src\/shared\/review-demo-entry"/);
  assert.ok((server.match(/isReviewDemoEntryNumber\(/g) || []).length >= 2);
  // identify checks the RAW param before normalisation (normalisation strips letters)
  const idAt = server.indexOf('app.get("/api/auth/identify/:id"');
  assert.ok(idAt > 0);
  const idBody = server.slice(idAt, idAt + 1200);
  assert.ok(idBody.indexOf('isReviewDemoEntryNumber(req.params.id)') < idBody.indexOf('normalizeStudentId('));
  const add = db.indexOf('public addAllowedStudent(student: AllowedStudent)');
  assert.ok(add > 0);
  assert.match(db.slice(add, add + 500), /isReviewDemoEntryNumber\(student\.idNumber\)[\s\S]*return;/);
});
