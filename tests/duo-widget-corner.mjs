/*
 * حارس ركن الودجت (iPhone Duo) — Playwright WebKit.
 *
 * على الـDuo الحقيقي يطفو فوق الزاوية العليا اليمنى (الفيزيائية) عنصر نظام ثابت
 * (كبسولة المصباح + الحساب/الموقع + الوقت + البطارية) ليس جزءًا من safe-area.
 * الحارس يفتح كل شاشة مهمة بكل مقاس Duo وكل وضع (فاتح/داكن/نص 200%) ويتأكد أن
 * صفر عناصر مهمة (نص ظاهر، a/button/input/select/textarea/[role=tab|button]/img/svg)
 * يتقاطع صندوقها مع مستطيل الركن:  x ≥ vw − widget-w  و  y ≤ widget-h  (فيزيائي).
 * يُستثنى ما يمتد خلفية (عنصر بلا نص ولا تفاعل، أو [data-duo-bleed]) ويُسجَّل.
 *
 * يعمل على خادم محلي معزول (tests/run-duo-widget.sh) وبيئة تجريبية فقط؛ كل طلب
 * خارج الخادم المحلي (عدا خطوط Google) يُحجب. WebKit أولًا؛ إن لم يتوفر يفشل الحارس
 * ولا يتراجع صامتًا إلى Chromium (DUO_WIDGET_BROWSER=chromium يطلبه صراحة).
 *
 *   MIRAS_TEST_BASE=http://localhost:3000 node tests/duo-widget-corner.mjs
 *   DUO_WIDGET_QUICK=1  مقاسات أقل للتشغيل السريع
 *   DUO_WIDGET_REPORT=out.json  تقرير JSON كامل
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const BASE = process.env.MIRAS_TEST_BASE || 'http://localhost:3412';
const REPORT = process.env.DUO_WIDGET_REPORT || '';
const QUICK = process.env.DUO_WIDGET_QUICK === '1';
const BROWSER = process.env.DUO_WIDGET_BROWSER === 'chromium' ? 'chromium' : 'webkit';

/* تقدير من لقطات المالك (لا قياس على جهاز): عرض 96px، ارتفاع ≈31% بحد 270px (انظر قسم ١٣). */
const WIDGET_W = 96;
const widgetH = (vh) => Math.min(270, Math.max(64, 0.31 * vh));

/* مقاسات Duo المعروفة، طوليًا وعرضيًا (بالتبديل). */
const BASE_SIZES = [[382, 580], [470, 780], [594, 368], [669, 867], [951, 585], [457, 678], [457, 760], [720, 900], [951, 669]];
const SIZES = BASE_SIZES.flatMap(([w, h]) => [[w, h], [h, w]]);
const QUICK_SIZES = [[382, 580], [457, 678], [669, 867], [951, 585]];
/* التطبيق (WKWebView) بلا أشرطة متصفح: الارتفاع أطول من Safari. */
const TALL_SIZES = [[382, 780], [457, 860], [470, 900], [669, 1000], [951, 700], [951, 800]];
const WK_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
/* سياقان: Safari (UA عادي) والتطبيق (UA بلا Safari/، window.Capacitor، navigator.standalone غير معرّف). */
const CONTEXTS = [
  { name: 'safari', opts: {}, sizes: () => (QUICK ? QUICK_SIZES : SIZES), variants: null },
  { name: 'app', opts: { userAgent: WK_UA, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, app: true,
    sizes: () => (QUICK ? [...QUICK_SIZES, [382, 780]] : [...SIZES, ...TALL_SIZES]), variants: ['light', 'dark', 'text200'] },
];
const CONTEXT_ONLY = (process.env.DUO_WIDGET_CONTEXTS || '').split(',').filter(Boolean);
/* أجهزة أخرى: يجب أن تبقى المتغيرات 0 (لا أثر). */
const CONTROL_SIZES = [[390, 844], [393, 852], [402, 874], [844, 390], [932, 430], [430, 932], [744, 1133], [1024, 768], [1280, 800], [951, 350]];

const ALL_VARIANTS = [
  { name: 'light' },
  { name: 'dark', dark: true },
  { name: 'text200', css: 'html{font-size:200% !important;-webkit-text-size-adjust:200% !important}' },
];
const VARIANT_ONLY = (process.env.DUO_WIDGET_VARIANTS || '').split(',').filter(Boolean);


/* ───────── القياس داخل الصفحة ───────── */
function measure({ zoneW, zoneH, onlyFixed }) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const zx = vw - zoneW;
  const rootStyle = getComputedStyle(document.documentElement);
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)') return false;
    }
    return true;
  };
  /* الجزء الظاهر فعلًا بعد قصّ الأسلاف (overflow/clip-path)؛ null إن لم يظهر شيء. */
  const clipTo = (r, el) => {
    let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clipPath && cs.clipPath !== 'none')) {
        const nb = n.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { l = Math.max(l, nb.left); rt = Math.min(rt, nb.right); }
        if (cs.overflowY !== 'visible') { t = Math.max(t, nb.top); b = Math.min(b, nb.bottom); }
      }
    }
    return rt - l >= 1 && b - t >= 1 ? { left: l, top: t, right: rt, bottom: b } : null;
  };
  const hitsZone = (r) => r && r.right > zx + 0.5 && r.left < vw && r.top < zoneH - 0.5 && r.bottom > 0;
  /* «لاصق»: sticky، أو ثابت صغير (ودجة عائمة). الحاويات الثابتة التي تملأ الشاشة (غلاف الصفحة، الستارة)
     تُهمَل هنا لأن محتواها يتمرّر؛ ما في داخل الستارة يُقاس في المرحلة الأولى أصلًا. */
  let lastStuckBy = '';
  const stuck = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'sticky') { lastStuckBy = `sticky ${n.tagName.toLowerCase()}.${String(n.className).split(/\s+/).slice(0, 2).join('.')}`; return true; }
      if (p === 'fixed') {
        const b = n.getBoundingClientRect();
        if (!(b.width >= vw * 0.9 && b.height >= vh * 0.9)) { lastStuckBy = `fixed ${n.tagName.toLowerCase()}.${String(n.className).split(/\s+/).slice(0, 2).join('.')}`; return true; }
      }
    }
    return false;
  };
  const name = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    const via = !t && el.parentElement ? ` <in ${el.parentElement.tagName.toLowerCase()}${typeof el.parentElement.className === 'string' && el.parentElement.className ? '.' + el.parentElement.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''}>` : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}${t ? ` "${t}"` : ''}${via}`;
  };
  const INTERACTIVE = 'a, button, input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"], summary';
  /* نافذة/ستارة مفتوحة تغطي الشاشة: ما خلفها غير قابل للتفاعل (مثل tests الـDuo السابقة)، فيُقاس داخلها فقط؛
     ويُسجَّل ذلك استثناءً صريحًا في التقرير. */
  const overlays = [...document.querySelectorAll('div.fixed, [role="dialog"]')].filter((o) => {
    const b = o.getBoundingClientRect();
    if (!isVisible(o) || b.width < vw * 0.9 || b.height < vh * 0.9) return false;
    return !!o.querySelector('button, input, a[href], select, textarea') && !o.matches('.meras-teacher-shell, .meras-student-shell, .miras-splash') && !o.querySelector('header.meras-topbar, .miras-mobile-teacher-zero-header');
  });
  const scope = overlays.length ? overlays[overlays.length - 1] : document.body;
  const violations = [];
  const exceptions = overlays.length ? ['overlay-scope: القياس داخل النافذة المفتوحة فقط'] : [];
  const seen = new Set();
  const consider = (el, rect, kind) => {
    if (onlyFixed && !stuck(el)) return;
    const r = clipTo(rect, el);
    if (!hitsZone(r)) return;
    const key = el.tagName + name(el) + kind;
    if (seen.has(key)) return;
    seen.add(key);
    const entry = `${onlyFixed ? `(${lastStuckBy}) ` : ''}${kind} ${name(el)} [x ${Math.round(r.left)}..${Math.round(r.right)}, y ${Math.round(r.top)}..${Math.round(r.bottom)}]`;
    if (el.closest('[data-duo-bleed]')) return exceptions.push(`bleed-attr ${entry}`);
    if ((kind === 'svg' || kind === 'img') && r.right - r.left >= vw * 0.5) return exceptions.push(`bleed-large-media ${entry}`);
    violations.push(entry);
  };
  for (const el of scope.querySelectorAll(`${INTERACTIVE}, img, svg`)) {
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if ((tag === 'svg' || tag === 'img') && el.parentElement && el.parentElement.closest(INTERACTIVE)) continue; // يُقاس بزرّه
    if (tag === 'svg' && el.closest('svg') !== el) continue;
    if (tag === 'input' && /checkbox|radio/.test(el.type) && getComputedStyle(el).opacity === '0') continue;
    consider(el, el.getBoundingClientRect(), tag === 'svg' || tag === 'img' ? tag : 'control');
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('script, style, noscript, svg') || !isVisible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const rr of range.getClientRects()) {
      if (rr.width < 1 || rr.height < 1) continue;
      consider(el, rr, 'text');
    }
  }
  /* المنطقة المحسوبة فعلاً: عنصر مسبار بأبعاد var(--duo-widget-w/h) (الخاصية غير المسجّلة لا تُحلّ بـgetComputedStyle). */
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;right:0;visibility:hidden;pointer-events:none;width:var(--duo-widget-w,0px);height:var(--duo-widget-h,0px)';
  document.body.appendChild(probe);
  const pr = probe.getBoundingClientRect();
  probe.remove();
  return {
    vw, vh, probe: { w: Math.round(pr.width * 10) / 10, h: Math.round(pr.height * 10) / 10 },
    vars: {
      w: rootStyle.getPropertyValue('--duo-widget-w').trim(),
      gap: rootStyle.getPropertyValue('--duo-widget-gap').trim(),
      h: rootStyle.getPropertyValue('--duo-widget-h').trim(),
    },
    overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw,
    violations, exceptions,
  };
}

/* ───────── مساعدات التنقل ───────── */
let CURRENT_APP = false;
async function newContext(browser, extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 669, height: 867 }, deviceScaleFactor: 1, hasTouch: true,
    reducedMotion: 'reduce', locale: 'ar', ...extra,
  });
  if (CURRENT_APP) {
    await ctx.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', platform: 'ios' };
      try { Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true }); } catch (e) {}
    });
  }
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE) || /fonts\.(googleapis|gstatic)\.com/.test(u)) return r.continue();
    return r.abort();
  });
  return ctx;
}
const settle = (p, ms = 350) => p.waitForTimeout(ms);
async function waitApp(p) {
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(400);
    const ok = await p.evaluate(() => document.body.innerText.length > 120).catch(() => false);
    if (ok && i > 4) break;
  }
  await settle(p, 1200);
}
async function skipTour(p) {
  for (let i = 0; i < 4; i++) {
    const b = p.locator('button:visible:has-text("تخطّي"), button:visible:has-text("تخطي")').first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await settle(p, 700); } else break;
  }
}
async function enterDemo(p, role) {
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.evaluate(async (role) => {
    const r = await fetch('/api/demo/enter', { method: 'POST' });
    const d = await r.json();
    sessionStorage.setItem('miras_demo_session', d.sessionId);
    let id = d.teacher;
    if (role === 'student') {
      const rr = await fetch('/api/demo/role', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-miras-demo': d.sessionId }, body: JSON.stringify({ role: 'student' }) });
      id = (await rr.json()).student;
    }
    localStorage.removeItem('miras_teacher_session'); localStorage.removeItem('miras_student_session');
    localStorage.setItem(role === 'student' ? 'miras_student_session' : 'miras_teacher_session', JSON.stringify(id));
  }, role);
  await p.reload();
  await waitApp(p);
  await settle(p, 1500);
  await skipTour(p);
}
const teacherTab = async (p, name) => {
  await p.locator(`button.miras-dock-item:visible:has-text("${name}")`).first().click({ timeout: 5000 });
  await settle(p, 1100);
  await skipTour(p);
};
const esc = async (p) => { await p.keyboard.press('Escape'); await settle(p, 400); };
const clickIf = async (p, sel, ms = 900) => {
  const l = p.locator(sel).first();
  await l.click({ timeout: 4000 });
  await settle(p, ms);
};

/* ───────── السيناريوهات ───────── */
const scenarios = [];
const add = (name, group, run) => scenarios.push({ name, group, run });

add('login-identify', 'login', async (p) => { await p.setViewportSize({ width: 669, height: 867 }); await p.goto(BASE + '/'); await waitApp(p); await settle(p, 1500); });
for (const [key, id] of [['login-student-password', '1001'], ['login-student-signup', '1100'], ['login-error-not-in-roster', '9999'], ['login-teacher-password', 'teacher-test-identity']]) {
  add(key, 'login', async (p) => {
    await p.setViewportSize({ width: 669, height: 867 });
    await p.goto(BASE + '/'); await waitApp(p); await settle(p, 1500);
    await p.fill('#miras-login-identity', id);
    await p.locator('.miras-login-primary').first().click();
    await settle(p, 2200);
  });
}

const teacher = [
  ['teacher-home', null, async () => {}],
  ['teacher-courses', 'مقررات', async (p) => teacherTab(p, 'المقررات')],
  ['teacher-courses-new-form', 'modal', async (p) => { await teacherTab(p, 'المقررات'); await clickIf(p, 'button:visible:has-text("مقرر جديد")'); }],
  ['teacher-students', null, async (p) => teacherTab(p, 'الطلبة')],
  ['teacher-questions', null, async (p) => { await teacherTab(p, 'الأسئلة'); await p.locator('button[aria-label="بنك الأسئلة"]:visible').first().click().catch(() => {}); await settle(p, 700); }],
  ['teacher-submissions', null, async (p) => teacherTab(p, 'التسليمات')],
  ['teacher-codes', null, async (p) => teacherTab(p, 'الأكواد')],
  ['teacher-dock-quick-menu', 'drawer', async (p) => { await teacherTab(p, 'الأكواد'); await p.locator('button.miras-dock-item:visible:has-text("الأكواد")').first().click({ button: 'right' }).catch(() => {}); await settle(p, 700); }],
  ['teacher-account-status', 'modal', async (p) => { await p.locator('button[aria-label="الرئيسية"]:visible').first().click().catch(() => {}); await settle(p, 700); await clickIf(p, '.miras-zero-name-pill:visible, .miras-teacher-account-pill:visible'); }],
  ['teacher-passkey', 'modal', async (p) => { await p.locator('button[aria-label="الرئيسية"]:visible').first().click().catch(() => {}); await settle(p, 700); await clickIf(p, 'button[aria-label*="البصمة"]:visible', 1100); }],
  ['teacher-notifications', 'sheet', async (p) => { await p.locator('button[aria-label="الرئيسية"]:visible').first().click().catch(() => {}); await settle(p, 800); await clickIf(p, 'button[aria-label="التنبيهات المهمة"]:visible', 1100); }],
];
const student = [
  ['student-home', null, async () => {}],
  ['student-exams', null, async (p) => { await clickIf(p, '.miras-now-available button:visible:has-text("الاختبارات")', 1300); }],
  ['student-projects', null, async (p) => { await clickIf(p, '.miras-now-available button:visible:has-text("المشاريع")', 1300); }],
  ['student-timeline', null, async (p) => { await clickIf(p, '.miras-student-overview-card button:visible:has-text("عرض السجل الكامل"), .miras-student-last-submission-card button', 1100); }],
  ['student-calendar-alerts', 'sheet', async (p) => { await clickIf(p, '.miras-student-actions-row button:nth-last-child(2)', 1100); }],
  ['student-install', 'modal', async (p) => { await clickIf(p, 'button[aria-label*="تثبيت"]:visible', 1100); }],
  ['student-passkey', 'modal', async (p) => { await clickIf(p, 'button[aria-label*="البصمة"]:visible', 1100); }],
];

const only = (process.env.DUO_WIDGET_ONLY || '').split(',').filter(Boolean);
const want = (n) => !only.length || only.some((o) => n.startsWith(o));

(async () => {
  const launcher = BROWSER === 'webkit' ? pw.webkit : pw.chromium;
  let browser;
  try { browser = await launcher.launch(); } catch (e) {
    console.error(`FAIL: cannot launch ${BROWSER}: ${e.message.split('\n')[0]}`);
    process.exit(2);
  }
  const report = { browser: BROWSER, version: browser.version(), base: BASE, sizes: SIZES.concat(TALL_SIZES).map((s) => s.join('x')), contexts: {}, cases: 0, violations: [], exceptions: {}, notes: [], controls: [], scenarios: [] };
  const fail = (m) => report.violations.push(m);
  let CTXNAME = 'safari';

  const runAt = async (p, scenario, variant, [w, h], phase) => {
    await p.setViewportSize({ width: w, height: h });
    await settle(p, 300);
    let handle = null;
    if (variant.css) handle = await p.addStyleTag({ content: variant.css });
    if (variant.dark) { await p.emulateMedia({ colorScheme: 'dark' }); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); }
    await settle(p, variant.css ? 700 : 250);
    /* كل حاويات التمرير إلى الأعلى (المرحلة السابقة تركتها في الأسفل) */
    await p.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTo({ top: 0, left: 0, behavior: 'instant' }); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
    await settle(p, 500);
    const zone = { zoneW: WIDGET_W, zoneH: widgetH(h), onlyFixed: false };
    const m = await p.evaluate(measure, zone);
    /* بعد التمرير للأسفل: ما هو لاصق/ثابت يبقى في الركن أثناء التمرير. */
    await p.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); });
    await settle(p, 500);
    const m2 = await p.evaluate(measure, { ...zone, onlyFixed: true });
    if (handle) await handle.evaluate((n) => n.remove());
    if (variant.dark) { await p.emulateMedia({ colorScheme: 'light' }); await p.evaluate(() => document.documentElement.removeAttribute('data-theme')); }
    report.cases++;
    const tag = `[${CTXNAME}] ${scenario.name} @${w}x${h} [${variant.name}]${phase ? ' ' + phase : ''}`;
    /* المتغيرات: يجب أن تكون نشطة هنا */
    if (!(m.probe.w > 0 && m.probe.h > 0)) fail(`${tag}: المنطقة صفرية (probe w=${m.probe.w}, h=${m.probe.h}) — الحارس لا يقيس شيئاً`);
    else if (Math.abs(m.probe.w - WIDGET_W) > 0.6 || Math.abs(m.probe.h - zone.zoneH) > 1.2) fail(`${tag}: المنطقة في CSS (${m.probe.w}×${m.probe.h}) لا تطابق ثوابت الحارس (${WIDGET_W}×${Math.round(zone.zoneH * 10) / 10})`);
    if (m.overflowX > 1) fail(`${tag}: تمرير أفقي ${m.overflowX}px`);
    for (const v of m.violations) fail(`${tag}: ${v}`);
    for (const v of m2.violations) if (!m.violations.includes(v)) fail(`${tag} (بعد التمرير): ${v}`);
    for (const e of [...m.exceptions, ...m2.exceptions]) report.exceptions[`${scenario.name}: ${e.replace(/\[x .*$/, '').trim()}`] = (report.exceptions[`${scenario.name}: ${e.replace(/\[x .*$/, '').trim()}`] || 0) + 1;
  };

  const safe = async (name, fn) => { try { await fn(); } catch (e) { fail(`${name}: تعذّر تشغيل السيناريو: ${String(e.message).split('\n')[0].slice(0, 160)}`); } };

  for (const C of CONTEXTS) {
    if (CONTEXT_ONLY.length && !CONTEXT_ONLY.includes(C.name)) continue;
    CTXNAME = C.name; CURRENT_APP = !!C.app;
    const sizes = C.sizes();
    const VARIANTS = C.variants ? ALL_VARIANTS.filter((v) => C.variants.includes(v.name) && (!VARIANT_ONLY.length || VARIANT_ONLY.includes(v.name))) : (VARIANT_ONLY.length ? ALL_VARIANTS.filter((v) => VARIANT_ONLY.includes(v.name)) : ALL_VARIANTS);
    const before = report.cases;
  /* الدخول (غير مسجل) */
  {
    const ctx = await newContext(browser, C.opts); const p = await ctx.newPage();
    for (const sc of scenarios.filter((s) => s.group === 'login' && want(s.name))) {
      await safe(sc.name, async () => {
        await sc.run(p);
        for (const v of VARIANTS) for (const sz of sizes) await runAt(p, sc, v, sz);
      });
      if (!report.scenarios.includes(sc.name)) report.scenarios.push(sc.name);
    }
    await ctx.close();
  }
  /* المعلّم */
  {
    const ctx = await newContext(browser, C.opts); const p = await ctx.newPage();
    await safe('teacher-enter', () => enterDemo(p, 'teacher'));
    for (const [name, group, prep] of teacher) {
      if (!want(name)) continue;
      const sc = { name, group };
      await safe(name, async () => {
        await p.setViewportSize({ width: 669, height: 867 });
        await p.locator('button[aria-label="الرئيسية"]:visible').first().click({ timeout: 1500 }).catch(() => {});
        await settle(p, 500);
        await prep(p);
        for (const v of VARIANTS) for (const sz of sizes) await runAt(p, sc, v, sz);
        await esc(p);
      });
      if (!report.scenarios.includes(name)) report.scenarios.push(name);
    }
    await ctx.close();
  }
  /* الطالب */
  {
    const ctx = await newContext(browser, C.opts); const p = await ctx.newPage();
    await safe('student-enter', () => enterDemo(p, 'student'));
    const home = async () => { await p.setViewportSize({ width: 669, height: 867 }); await p.reload(); await waitApp(p); await settle(p, 1200); for (let i = 0; i < 3; i++) { const b = p.locator('div.fixed.inset-0 button[aria-label*="إغلاق"]:visible').first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await settle(p, 500); } else break; } };
    for (const [name, group, prep] of student) {
      if (!want(name)) continue;
      const sc = { name, group };
      await safe(name, async () => {
        await home();
        await prep(p);
        for (const v of VARIANTS) for (const sz of sizes) await runAt(p, sc, v, sz);
      });
      if (!report.scenarios.includes(name)) report.scenarios.push(name);
    }
    await ctx.close();
  }

    report.contexts[C.name] = { cases: report.cases - before, sizes: sizes.length, variants: VARIANTS.map((v) => v.name) };
  }

  /* ضوابط: أجهزة أخرى يجب أن تبقى بلا أثر (المتغيرات 0). */
  {
    const ctx = await newContext(browser); const p = await ctx.newPage();
    await p.goto(BASE + '/'); await waitApp(p);
    for (const [w, h] of CONTROL_SIZES) {
      await p.setViewportSize({ width: w, height: h }); await settle(p, 300);
      const v = await p.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;visibility:hidden;width:var(--duo-widget-w,0px);height:var(--duo-widget-h,0px)'; document.body.appendChild(d); const r = d.getBoundingClientRect(); d.remove(); const s = getComputedStyle(document.documentElement); return { w: `${r.width}px`, h: `${r.height}px`, declared: s.getPropertyValue('--duo-widget-w').trim() }; });
      const off = parseFloat(v.w) === 0 && parseFloat(v.h) === 0 && v.declared === '0px';
      report.controls.push({ size: `${w}x${h}`, ...v, off });
      if (!off) fail(`ضابط ${w}x${h}: المنطقة نشطة على جهاز غير Duo (w=${v.w}, h=${v.h})`);
    }
    await ctx.close();
  }

  /* ضابط سلبي: الحارس نفسه يجب أن يرصد التقاطع على بناء الأساس (قبل الإصلاح) — وإلا فهو يمرّ فارغًا. */
  const NEG = process.env.DUO_WIDGET_NEGATIVE_BASE;
  if (NEG) {
    const ctx = await browser.newContext({ viewport: { width: 382, height: 580 }, deviceScaleFactor: 1, hasTouch: true, reducedMotion: 'reduce', locale: 'ar' });
    const p = await ctx.newPage();
    await p.goto(NEG + '/');
    let hits = 0;
    try {
      await p.evaluate(async () => { const r = await fetch('/api/demo/enter', { method: 'POST' }); const d = await r.json(); sessionStorage.setItem('miras_demo_session', d.sessionId); localStorage.setItem('miras_teacher_session', JSON.stringify(d.teacher)); });
      await p.reload(); await waitApp(p); await settle(p, 1500); await skipTour(p);
      const m = await p.evaluate(measure, { zoneW: WIDGET_W, zoneH: widgetH(580), onlyFixed: false });
      hits = m.violations.length;
      report.negativeControl = { base: NEG, size: '382x580', violations: hits, sample: m.violations.slice(0, 4) };
    } catch (e) { report.negativeControl = { base: NEG, error: String(e.message).slice(0, 120) }; }
    await ctx.close();
    if (hits === 0) fail('ضابط سلبي: لم يرصد الحارس أي تقاطع على بناء الأساس (382×580) — الحارس مشكوك فيه');
  }
  await browser.close();
  report.exceptions = Object.entries(report.exceptions).map(([k, n]) => `${k} ×${n}`);
  if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  for (const [k, v] of Object.entries(report.contexts)) console.log(`  سياق ${k}: ${v.cases} حالة، ${v.sizes} مقاسًا، متغيرات ${v.variants.join('/')}`);
  console.log(`duo-widget-corner (${BROWSER} ${report.version}): ${report.cases} حالة، ${report.sizes.length} مقاسًا، ${report.scenarios.length} شاشة، ${report.controls.length} ضوابط`);
  if (report.exceptions.length) console.log(`استثناءات مسجّلة (${report.exceptions.length}):\n  ` + report.exceptions.slice(0, 40).join('\n  '));
  if (report.violations.length) {
    console.log(`\nمخالفات: ${report.violations.length}`);
    for (const v of report.violations.slice(0, 120)) console.log('  ' + v);
    process.exit(1);
  }
  if (report.negativeControl) console.log(`ضابط سلبي (الأساس ${report.negativeControl.base}): ${report.negativeControl.violations ?? 'خطأ'} تقاطعًا مرصودًا على 382×580`);
  console.log('PASS: صفر عناصر مهمة داخل ركن الودجت');
})();
