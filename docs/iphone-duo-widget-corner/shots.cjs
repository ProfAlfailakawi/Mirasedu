/*
 * لقطات قبل/بعد لركن الودجت (Playwright WebKit) على خادم محلي معزول (بيئة تجريبية فقط).
 * يرسم إطار الركن (x ≥ vw − 96، y ≤ clamp(64, 31vh, 270)) بحدود حمراء شفافة فوق اللقطة.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node docs/iphone-duo-widget-corner/shots.cjs \
 *     http://localhost:3000 before docs/iphone-duo-widget-corner
 *
 * الشاشات: login (الدخول)، teacher (رئيسية المعلّم)، student (رئيسية الطالب).
 * الاسم الناتج: <before|after>-<screen>-<w>x<h>.png
 */
const path = require('path');
const fs = require('fs');
const pw = require(require.resolve('playwright', { paths: [process.cwd(), '/opt/node22/lib/node_modules'] }));
const BASE = process.argv[2] || 'http://localhost:3412';
const TAG = process.argv[3] || 'after';
const OUT = process.argv[4] || 'docs/iphone-duo-widget-corner';
const SIZES = (process.env.SHOT_SIZES || '382x580,669x867,951x585').split(',').map((s) => s.split('x').map(Number));
const SCREENS = (process.env.SHOT_SCREENS || 'login,teacher,student').split(',');
const W = 96, hOf = (vh) => Math.min(270, Math.max(64, 0.31 * vh));

const frame = ({ w, h }) => {
  const d = document.createElement('div');
  d.setAttribute('data-shot-frame', '1');
  d.style.cssText = `position:fixed;top:0;right:0;width:${w}px;height:${h}px;box-sizing:border-box;border:2px solid rgba(220,38,38,.95);background:rgba(220,38,38,.10);pointer-events:none;z-index:2147483647`;
  document.body.appendChild(d);
};
async function ctxFor(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, locale: 'ar', reducedMotion: 'reduce' });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(BASE) || /fonts\.(googleapis|gstatic)\.com/.test(u) ? r.continue() : r.abort(); });
  return ctx;
}
async function skipTour(p) {
  for (let i = 0; i < 4; i++) {
    const s = p.locator('button:visible:has-text("تخطّي"), button:visible:has-text("تخطي")').first();
    if (await s.isVisible().catch(() => false)) { await s.click().catch(() => {}); await p.waitForTimeout(700); } else break;
  }
}
/* كل مقاس: سياق جديد وجلسة تجريبية خاصة به (تحميل نظيف لا تغيير مقاس حيّ). */
async function enterDemo(p, role) {
  await p.goto(BASE + '/'); await p.waitForTimeout(1500);
  await p.evaluate(async (role) => {
    const r = await fetch('/api/demo/enter', { method: 'POST' }); const d = await r.json();
    sessionStorage.setItem('miras_demo_session', d.sessionId);
    let id = d.teacher;
    if (role === 'student') {
      const rr = await fetch('/api/demo/role', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-miras-demo': d.sessionId }, body: JSON.stringify({ role: 'student' }) });
      id = (await rr.json()).student;
    }
    localStorage.removeItem('miras_teacher_session'); localStorage.removeItem('miras_student_session');
    localStorage.setItem(role === 'student' ? 'miras_student_session' : 'miras_teacher_session', JSON.stringify(id));
  }, role);
  await p.reload(); await p.waitForTimeout(5000); await skipTour(p);
}
let browser;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  browser = await pw.webkit.launch();
  for (const screen of SCREENS) {
    for (const [w, h] of SIZES) {
      const ctx = await ctxFor(browser, w, h);
      const p = await ctx.newPage();
      if (screen === 'login') { await p.goto(BASE + '/'); await p.waitForTimeout(6000); } else await enterDemo(p, screen);
      await p.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0; window.scrollTo(0, 0); });
      await p.evaluate(frame, { w: W, h: hOf(h) });
      await p.screenshot({ path: path.join(OUT, `${TAG}-${screen}-${w}x${h}.png`) });
      await ctx.close();
    }
  }
  await browser.close();
})();
