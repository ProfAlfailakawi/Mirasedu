import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * Duo ≠ iPad: كل وضعية خاصة بالـDuo (كتاب، حاسوب محمول، ترويسة قصيرة) يميّزها
 * العرض وحده — الاستعلام الوحيد الذي يصله CSS في Safari. شاشة Duo الداخلية
 * ≈669×867 طولياً و≈951×585 عرضياً؛ أصغر iPad عرضه 744 طولياً و1024 عرضياً.
 * هذا الاختبار يقرأ الأوراق كنص فيفشل إن اتّسع استعلام أحدها حتى يصل iPad.
 */
const css = fs.readFileSync(new URL('../src/design/miras-duo-layouts.css', import.meta.url), 'utf8');
const MARKER = '(iPhone Duo A–J)';
const start = css.indexOf(MARKER);
assert.ok(start > 0, 'Duo section marker must exist');

/* الاستعلامات @media في المستوى الأعلى بعد بداية قسم الـDuo. */
function topLevelMedia(src: string) {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && src.startsWith('@media', i)) out.push(src.slice(i + 6, src.indexOf('{', i)).replace(/\s+/g, ' ').trim());
  }
  return out;
}
const queries = topLevelMedia(css.slice(start));
const parts = queries.flatMap((q) => q.split(',').map((p) => p.trim()));
const px = (p: string, f: string) => { const m = p.match(new RegExp(`\\(${f}: ?(\\d+)px\\)`)); return m ? Number(m[1]) : null; };

test('duo css: the Duo section declares media queries (guard is not vacuous)', () => {
  assert.ok(queries.length >= 6, `found ${queries.length}`);
});

test('duo css: every query in the Duo section is scoped to screen (A4 print width falls in the book range)', () => {
  for (const p of parts) assert.match(p, /^screen and /, `not screen-scoped: "${p}"`);
});

test('duo css: ranged postures never reach an iPad (portrait book <= 720px, landscape <= 1000px, short laptop <= 1000px)', () => {
  for (const p of parts) {
    const min = px(p, 'min-width'); const max = px(p, 'max-width');
    if (min === null) continue; // open-ended phone rules and the hinge query are not postures
    assert.notEqual(max, null, `ranged query without a max-width: "${p}"`);
    const landscape = /\(orientation: landscape\)/.test(p);
    const shortLaptop = px(p, 'max-height') !== null && px(p, 'max-height')! <= 480;
    const cap = landscape || shortLaptop ? 1000 : 720;
    assert.ok(max! <= cap, `"${p}" allows width ${max} > ${cap}`);
  }
});

test('duo css: the 640-1000 book range is split into a portrait <= 720 part and an orientation-gated landscape part', () => {
  const book = parts.filter((p) => px(p, 'min-height') === 540);
  assert.equal(book.length, 2);
  const [portrait, landscape] = book;
  assert.equal(px(portrait, 'max-width'), 720);
  assert.equal(px(landscape, 'max-width'), 1000);
  assert.match(landscape, /\(orientation: landscape\)/);
});

test('duo css: the grading cards (instead of the 900px table) are Duo-only; iPads keep the table from md', () => {
  const idx = css.indexOf('div.overflow-x-auto:has(> table[class*="min-w-[900px]"]):not(#_):not(#__):not(#___) {\n    display: none');
  assert.ok(idx > 0, 'cards rule must exist');
  const before = css.slice(0, idx);
  const q = before.slice(before.lastIndexOf('@media')).split('{')[0];
  assert.match(q, /orientation: landscape/);
  assert.doesNotMatch(q, /1179/);
});
