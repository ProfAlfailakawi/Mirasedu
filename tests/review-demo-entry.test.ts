import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REVIEW_DEMO_STUDENT_ID,
  isReviewDemoEntryNumber,
  normalizeReviewDemoCandidate,
} from '../src/shared/review-demo-entry';

test('the reserved reviewer number is digits-only and long enough for the login field', () => {
  assert.match(REVIEW_DEMO_STUDENT_ID, /^\d{4,}$/);
});

test('only exactly the reserved number opens the reviewer demo', () => {
  assert.equal(isReviewDemoEntryNumber(REVIEW_DEMO_STUDENT_ID), true);
  assert.equal(isReviewDemoEntryNumber(` ${REVIEW_DEMO_STUDENT_ID} `), true);
  assert.equal(isReviewDemoEntryNumber(REVIEW_DEMO_STUDENT_ID.slice(1)), false);
  assert.equal(isReviewDemoEntryNumber(`${REVIEW_DEMO_STUDENT_ID}0`), false);
  assert.equal(isReviewDemoEntryNumber('2200123456'), false);
  assert.equal(isReviewDemoEntryNumber(''), false);
  assert.equal(isReviewDemoEntryNumber(undefined), false);
});

test('Arabic-Indic and Persian digits are normalised', () => {
  const arabic = REVIEW_DEMO_STUDENT_ID.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  const persian = REVIEW_DEMO_STUDENT_ID.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  assert.equal(normalizeReviewDemoCandidate(arabic), REVIEW_DEMO_STUDENT_ID);
  assert.equal(isReviewDemoEntryNumber(arabic), true);
  assert.equal(isReviewDemoEntryNumber(persian), true);
});

test('App.tsx: the reserved number opens the demo before any real roster lookup, and no demo button renders', () => {
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
});

test('the server never registers the reserved number as a real student', () => {
  const server = fs.readFileSync('server.ts', 'utf8');
  const db = fs.readFileSync('src/server/db.ts', 'utf8');
  assert.match(server, /import \{ REVIEW_DEMO_STUDENT_ID \} from "\.\/src\/shared\/review-demo-entry"/);
  // identify + register both refuse it
  assert.match(server, /normalizedIdNumber === REVIEW_DEMO_STUDENT_ID/g);
  assert.ok((server.match(/normalizedIdNumber === REVIEW_DEMO_STUDENT_ID/g) || []).length >= 2);
  // the single roster insertion point skips it
  const add = db.indexOf('public addAllowedStudent(student: AllowedStudent)');
  assert.ok(add > 0);
  assert.match(db.slice(add, add + 500), /nextId === REVIEW_DEMO_STUDENT_ID[\s\S]*return;/);
});
