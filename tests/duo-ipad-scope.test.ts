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

const BOOK = 'screen and (min-width: 721px) and (max-width: 1000px) and (min-height: 520px) and (max-height: 960px) and (orientation: landscape)';
const DUO_PORTRAIT = 'screen and (min-width: 640px) and (max-width: 720px) and (min-height: 520px) and (max-height: 960px) and (orientation: portrait)';

test('duo css: the book (two pages + spine) is landscape-only and uses the shared BOOK condition', () => {
  const book = queries.filter((q) => q === BOOK);
  assert.ok(book.length >= 2, `book queries found: ${book.length}`);
  /* no query in the Duo section may turn the book on for portrait */
  for (const q of queries) {
    if (q.includes('(orientation: portrait)')) {
      assert.ok(q.includes('(display-mode: standalone)'), `portrait query that is not the standalone keep-out: "${q}"`);
    }
    assert.doesNotMatch(q, /min-height: 540px/, `old 540px book height: "${q}"`);
  }
  assert.ok(!queries.some((q) => /min-width: 640px\) and \(max-width: 720px\)(?!.*orientation)/.test(q)), 'a 640-720 branch without orientation would split portrait');
});

test('duo css: the widget keep-out only applies to the Duo inner screen in standalone mode', () => {
  const cut = queries.filter((q) => q.includes('(display-mode: standalone)'));
  assert.ok(cut.length >= 3, 'keep-out queries must exist');
  const allowed = [`${BOOK} and (display-mode: standalone)`, `${DUO_PORTRAIT} and (display-mode: standalone)`];
  for (const q of cut) {
    for (const alt of q.split(',').map((a) => a.trim())) assert.ok(allowed.includes(alt), `keep-out query outside the Duo inner screen: "${alt}"`);
  }
  assert.match(css, /--duo-cutout-w: 116px;/);
  assert.match(css, /--duo-cutout-h: 116px;/);
  /* never leave a test-only replacement of the standalone condition in the shipped file */
  assert.doesNotMatch(css, /orientation: (landscape|portrait)\) and \(min-width: 0px\)/);
});

test('duo css: the grading cards (instead of the 900px table) are Duo-only; iPads keep the table from md', () => {
  const idx = css.indexOf('div.overflow-x-auto:has(> table[class*="min-w-[900px]"]):not(#_):not(#__):not(#___) {\n    display: none');
  assert.ok(idx > 0, 'cards rule must exist');
  const before = css.slice(0, idx);
  const q = before.slice(before.lastIndexOf('@media')).split('{')[0];
  assert.match(q, /orientation: landscape/);
  assert.doesNotMatch(q, /1179/);
});
