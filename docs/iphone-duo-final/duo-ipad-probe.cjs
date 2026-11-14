/*
 * Duo ≠ iPad — مجسّ مقاسات iPad (Playwright WebKit، عرض فقط).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     node docs/iphone-duo-final/duo-ipad-probe.cjs <base-url> <out.json> [cur|base] [baseline.css]
 *
 * يعمل على خادم معزول (MIRAS_ALLOW_LOCAL_ONLY_MODE=true) وبيئة تجريبية فقط.
 * الوضع cur: الـCSS الحالي. الوضع base: يستبدل محتوى miras-duo-layouts.css بنسخة
 * ما قبل جولة الـDuo (git show 1381372:src/design/miras-duo-layouts.css) لمقارنة
 * البصمة العددية للتخطيط. لكل شاشة × مقاس يسجّل: الاستعلامات المطابقة، علامات الكتاب
 * (--duo-book، محتوى ::after للكعب، موضع شريط الأقسام السفلي)، التمرير الأفقي، وبصمة
 * مستطيلات كل عناصر #root.
 */
const { webkit } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:5140';
const OUT = process.argv[3] || 'duo-ipad-probe.json';
const MODE = process.argv[4] || 'cur';
const BASE_CSS = MODE === 'base' ? fs.readFileSync(process.argv[5], 'utf8') : null;

const IPAD = [
  [744, 1133], [768, 1024], [810, 1080], [820, 1180], [834, 1112], [834, 1194], [1024, 1366],
  [1133, 744], [1024, 768], [1080, 810], [1180, 820], [1112, 834], [1194, 834], [1366, 1024],
  [744, 1040], [768, 920], [768, 950], [810, 990], [820, 1090], [834, 1020],
  [1024, 690], [1133, 660], [1180, 735],
  [1024, 350], [1133, 400],
];
const DUO = [[669, 867], [669, 520], [660, 800], [700, 900], [720, 900], [951, 585], [880, 585], [1000, 600], [951, 350], [600, 350]];
const SIZES = (process.env.PROBE_SET === 'duo' ? DUO : process.env.PROBE_SET === 'both' ? IPAD.concat(DUO) : IPAD);

function probe() {
  const dock = document.querySelector('.teacher-nav-desktop.teacher-orbit-dock');
  const cards = [...document.querySelectorAll('div:has(> div.overflow-x-auto > table) > .grid')].find((g) => /md:hidden/.test(g.className));
  const tbl = document.querySelector('div.overflow-x-auto > table[class*="min-w-[900px]"]');
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; };
  const root = document.getElementById('root');
  const fp = [];
  for (const el of root.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') { fp.push('n'); continue; }
    const r = el.getBoundingClientRect();
    fp.push([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), cs.display, cs.position].join(','));
  }
  const W = document.documentElement.clientWidth;
  return {
    W, H: innerHeight,
    duoBook: getComputedStyle(document.documentElement).getPropertyValue('--duo-book').trim() === '1',
    spineAfter: getComputedStyle(document.body, '::after').content,
    dockPosition: dock ? getComputedStyle(dock).position : null,
    gradingTableVisible: vis(tbl), gradingCardsVisible: cards ? vis(cards) : null,
    cardCols: cards && vis(cards) ? getComputedStyle(cards).gridTemplateColumns.split(' ').length : null,
    overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - W,
    n: fp.length, fp,
  };
}

(async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 669, height: 867 }, deviceScaleFactor: 1, hasTouch: true, reducedMotion: 'reduce', locale: 'ar' });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(BASE) || /fonts\.(googleapis|gstatic)\.com/.test(u) ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const settle = (ms) => p.waitForTimeout(ms);
  const apply = async () => {
    if (!BASE_CSS) return;
    const ok = await p.evaluate((css) => { const s = [...document.querySelectorAll('style[data-vite-dev-id]')].find((x) => /miras-duo-layouts\.css/.test(x.getAttribute('data-vite-dev-id'))); if (!s) return false; s.textContent = css; return true; }, BASE_CSS);
    if (!ok) throw new Error('duo stylesheet element not found');
  };
  const skipTour = async () => { for (let i = 0; i < 4; i++) { const b = p.locator('button:visible:has-text("تخطّي"), button:visible:has-text("تخطي")').first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await settle(700); } else break; } };
  const tab = async (t) => {
    for (let i = 0; i < 4; i++) {
      await skipTour();
      try { await p.locator(`button.miras-dock-item:visible:has-text("${t}")`).first().click({ timeout: 10000 }); break; }
      catch (e) { if (i === 3) throw e; await p.setViewportSize({ width: 669, height: 867 }); await settle(2500); }
    }
    await settle(1500); await skipTour();
  };
  const wait = async () => { for (let i = 0; i < 40; i++) { await settle(500); if (i > 4 && await p.evaluate(() => document.body.innerText.length > 120).catch(() => false)) break; } await settle(1200); };

  const results = [];
  const record = async (screen) => {
    for (const [w, h] of SIZES) {
      await p.setViewportSize({ width: w, height: h }); await settle(450);
      const m = await p.evaluate(probe);
      results.push({ screen, size: `${w}x${h}`, ...m });
    }
    await p.setViewportSize({ width: 669, height: 867 }); await settle(300);
  };

  // login
  await p.goto(BASE + '/'); await wait(); await apply(); await settle(300);
  await record('login');
  // teacher (demo)
  await p.goto(BASE + '/'); await p.evaluate(async () => { const r = await fetch('/api/demo/enter', { method: 'POST' }); const d = await r.json(); sessionStorage.setItem('miras_demo_session', d.sessionId); localStorage.removeItem('miras_student_session'); localStorage.setItem('miras_teacher_session', JSON.stringify(d.teacher)); });
  await p.reload(); await wait(); await settle(2000); await apply(); await skipTour();
  await record('teacher-home');
  await tab('المقررات'); await record('teacher-courses');
  await p.locator('button:visible:has-text("مقرر جديد")').first().click(); await settle(900); await record('teacher-courses-new-form-dialog'); await p.keyboard.press('Escape'); await settle(500);
  await tab('التسليمات'); await record('teacher-submissions');
  await p.locator('.miras-submissions-panel > .grid > button').first().click(); await settle(1200); await record('teacher-submissions-detail');
  fs.writeFileSync(OUT, JSON.stringify({ mode: MODE, results }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
