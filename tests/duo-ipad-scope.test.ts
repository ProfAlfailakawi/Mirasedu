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
/* ركن الودجت (قسم ١٣): الاستعلامان الطوليان الوحيدان المسموحان في قسم الـDuo. */
const WIDGET_PORTRAIT = [
  'screen and (orientation: portrait) and (min-width: 360px) and (max-width: 720px) and (min-height: 360px) and (min-aspect-ratio: 47/100)',
];
const WIDGET_LANDSCAPE = 'screen and (orientation: landscape) and (min-width: 540px) and (max-width: 1000px) and (min-height: 300px) and (max-height: 960px) and (max-aspect-ratio: 5/3)';
const WIDGET_SEGMENTS = 'screen and (horizontal-viewport-segments: 2)';

test('duo css: the book (two pages + spine) is landscape-only and uses the shared BOOK condition', () => {
  const book = queries.filter((q) => q === BOOK);
  assert.ok(book.length >= 2, `book queries found: ${book.length}`);
  /* no query in the Duo section may turn the book on for portrait: portrait is only the keep-out */
  for (const q of queries) {
    if (q.includes('(orientation: portrait)')) {
      for (const alt of q.split(',').map((a) => a.trim())) {
        if (alt.includes('(orientation: portrait)')) assert.ok(WIDGET_PORTRAIT.includes(alt), `portrait query that is not the widget keep-out: "${alt}"`);
      }
    }
    assert.doesNotMatch(q, /min-height: 540px/, `old 540px book height: "${q}"`);
  }
  assert.ok(!queries.some((q) => /min-width: 640px\) and \(max-width: 720px\)(?!.*orientation)/.test(q)), 'a 640-720 branch without orientation would split portrait');
});

/* evaluates a single media-query alternative (screen + min/max width/height + orientation + aspect-ratio) at a viewport */
function matches(alt: string, w: number, h: number) {
  if (/display-mode|viewport-segments/.test(alt)) return false;
  for (const m of alt.matchAll(/\((min|max)-(width|height): ?(\d+)px\)/g)) {
    const v = m[2] === 'width' ? w : h;
    if (m[1] === 'min' ? v < Number(m[3]) : v > Number(m[3])) return false;
  }
  for (const m of alt.matchAll(/\((min|max)-aspect-ratio: ?(\d+)\/(\d+)\)/g)) {
    const r = w / h; const t = Number(m[2]) / Number(m[3]);
    if (m[1] === 'min' ? r < t : r > t) return false;
  }
  const o = alt.match(/\(orientation: (landscape|portrait)\)/);
  if (o && (o[1] === 'landscape') !== (w >= h)) return false;
  return true;
}

test('duo css: the widget corner (قسم ١٣) is one :root block, zero outside the Duo, with no display-mode / UA dependence', () => {
  const sec = css.slice(css.indexOf('١٣) ركن الودجت'), css.indexOf('١٤) شريط التثبيت'));
  assert.ok(sec.length > 500, 'section 13 must exist');
  /* خارج الـDuo: كل المتغيرات 0 */
  for (const v of ['w', 'gap', 'h', 'inset', 'clear']) assert.match(sec.slice(0, sec.indexOf('@media')), new RegExp(`--duo-widget-${v}: 0px;`), `--duo-widget-${v} must default to 0px`);
  const head = sec.slice(sec.indexOf('@media'), sec.indexOf('{', sec.indexOf('@media')));
  const alts = head.slice(6).replace(/\s+/g, ' ').split(',').map((a) => a.trim());
  assert.deepEqual(alts, [...WIDGET_PORTRAIT, WIDGET_LANDSCAPE, WIDGET_SEGMENTS]);
  assert.match(sec, /--duo-widget-w: 96px;/);
  assert.match(sec, /--duo-widget-gap: 8px;/);
  assert.match(sec, /--duo-widget-h: clamp\(64px, 31vh, 270px\);/);
  /* لا يعتمد على display-mode (يلزم في تبويب Safari وفي التطبيق) ولا على UA/Capacitor */
  assert.doesNotMatch(css, /display-mode/, 'no display-mode condition may remain in the Duo stylesheet');
  /* لا تكديس للتخصيص ولا !important خارج الطبقة: القسم كله داخل @layer duo-widget */
  assert.doesNotMatch(sec, /:not\(#_\)/, 'section 13 must not stack :not(#_) specificity');
  const outsideLayer = sec.replace(/@layer duo-widget \{[\s\S]*\n  \}\n\}/, '');
  assert.doesNotMatch(outsideLayer, /!important/, '!important in section 13 must live inside @layer duo-widget');
  assert.match(sec, /@layer duo-widget \{/);

  const on = [[382, 580], [382, 780], [385, 571], [457, 678], [457, 700], [457, 760], [457, 860], [440, 660], [480, 720], [470, 780], [470, 900], [594, 368], [580, 382], [669, 867], [669, 1000], [720, 900], [951, 669], [951, 800], [1000, 960], [540, 360], [780, 470], [951, 585], [867, 669], [678, 457], [585, 951]];
  const off = [[390, 844], [393, 852], [402, 874], [430, 932], [440, 956], [844, 390], [932, 430], [667, 375], [951, 350], [744, 1133], [820, 1180], [1024, 768], [1180, 820], [1280, 800], [1366, 1024]];
  const area = alts.filter((a) => !/viewport-segments/.test(a));
  for (const [w, h] of on) assert.ok(area.some((a) => matches(a, w, h)), `widget corner must be active at ${w}x${h}`);
  for (const [w, h] of off) assert.ok(!area.some((a) => matches(a, w, h)), `widget corner must NOT be active at ${w}x${h}`);
});

test('duo css: the grading cards (instead of the 900px table) are Duo-only; iPads keep the table from md', () => {
  const idx = css.indexOf('div.overflow-x-auto:has(> table[class*="min-w-[900px]"]):not(#_):not(#__):not(#___) {\n    display: none');
  assert.ok(idx > 0, 'cards rule must exist');
  const before = css.slice(0, idx);
  const q = before.slice(before.lastIndexOf('@media')).split('{')[0];
  assert.match(q, /orientation: landscape/);
  assert.doesNotMatch(q, /1179/);
});
