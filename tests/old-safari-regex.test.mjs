// Safari before iOS 16.4 rejects regex lookbehind ((?<! / (?<=) with
// "invalid group specifier name", which crashed the whole page for students on
// older iPhones. Client code must not use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const clientFiles = ['App.tsx', ...fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .map((f) => path.join('src', String(f)))
  .filter((f) => /\.(tsx?|jsx?)$/.test(f) && !f.startsWith(path.join('src', 'server')))];

test('client code has no regex lookbehind (crashes Safari before iOS 16.4)', () => {
  for (const file of clientFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/\(\?<[!=]/.test(source), `${file} uses (?<! or (?<=`);
  }
});

test('the display sanitizer pattern keeps the same matches without lookbehind', () => {
  const map = new Map([['aa@test.kw', 'د. معلم'], ['111', 'مقدمة']]);
  const tokens = [...map.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp('(^|[^\\w.@-])(' + tokens.join('|') + ')(?![\\w.@-])', 'gi');
  const run = (s) => s.replace(pattern, (_m, lead, tok) => lead + (map.get(tok.toLowerCase()) ?? tok));
  assert.equal(run('aa@test.kw'), 'د. معلم');
  assert.equal(run('مقرر 111، 111'), 'مقرر مقدمة، مقدمة');
  assert.equal(run('x111 1111 a.111 111-x'), 'x111 1111 a.111 111-x');
  assert.equal(run('(AA@TEST.KW)'), '(د. معلم)');
});
