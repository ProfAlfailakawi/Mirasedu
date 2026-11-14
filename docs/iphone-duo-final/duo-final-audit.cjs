/*
 * تدقيق iPhone Duo النهائي (عرض فقط) — Playwright WebKit.
 *
 * يشغَّل على خادم محلي معزول (بلا firebase-applet-config.json، مع
 * MIRAS_ALLOW_LOCAL_ONLY_MODE=true) ويدخل البيئة التجريبية فقط. كل طلب خارج
 * الخادم المحلي يُحجب (إلا خطوط Google) فلا يصل شيء إلى الإنتاج.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     node docs/iphone-duo-final/duo-final-audit.cjs <base-url> <out.json> [shotsDir] [label]
 *
 * يقيس لكل شاشة × مقاس: التمرير الأفقي، العناصر المقصوصة خارج الشاشة، أهداف
 * اللمس الأصغر من 44px، وفي مقاسات الشاشة الداخلية (وضع الكتاب) كل عنصر تفاعلي
 * أو سطر نص يتقاطع مع منطقة الكعب (منتصف الشاشة ± نصف عرض الكعب).
 */
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5140';
const OUT = process.argv[3] || 'duo-final-report.json';
const SHOTS = process.argv[4] || '';
const LABEL = process.argv[5] || 'after';
const SPINE = 32;
/* نطاق الشاشة الداخلية (وضع الكتاب) — يطابق الاستعلام في miras-duo-layouts.css. */
const INNER = '(min-width: 640px) and (max-width: 1000px) and (min-height: 540px) and (max-height: 960px)';

const VIEWPORTS = [
  ['A', 382, 580], ['A', 385, 571], ['A', 320, 568],
  ['B', 594, 368],
  ['C', 669, 867],
  ['D', 951, 585],
  ['E', 951, 350], ['E', 600, 350],
  ['F', 669, 520], ['F', 600, 480],
  ['G', 768, 1024], ['G', 1024, 768], ['G', 1280, 800], ['G', 1440, 900],
  ['H', 360, 640], ['H', 390, 844], ['H', 844, 390],
  ['S', 320, 350], ['S', 320, 600], ['S', 320, 900],
  ['S', 470, 350], ['S', 470, 600], ['S', 470, 900],
  ['S', 620, 350], ['S', 620, 600], ['S', 620, 900],
];
const SHOT_AT = new Set(['669x867', '951x585', '382x580', '951x350', '600x350', '594x368']);

async function newContext(browser, extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 669, height: 867 }, deviceScaleFactor: 1, hasTouch: true,
    reducedMotion: 'reduce', locale: 'ar', ...extra,
  });
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE) || /fonts\.(googleapis|gstatic)\.com/.test(u)) return r.continue();
    return r.abort();
  });
  return ctx;
}

async function settle(p, ms = 450) { await p.waitForTimeout(ms); }

async function waitApp(p) {
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(500);
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

async function closeOverlays(p) {
  for (let i = 0; i < 3; i++) {
    const b = p.locator('div.fixed.inset-0 button[aria-label*="إغلاق"]:visible, div.fixed.inset-0.z-\\[120\\] button.h-11.w-11:visible').first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await settle(p, 600); } else break;
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
  await settle(p, 2000);
  await skipTour(p);
}

async function enterDemoNoTour(p, role) {
  await p.evaluate(async (role) => {
    const r = await fetch('/api/demo/enter', { method: 'POST' });
    const d = await r.json();
    sessionStorage.setItem('miras_demo_session', d.sessionId);
    localStorage.removeItem('miras_student_session');
    localStorage.setItem('miras_teacher_session', JSON.stringify(d.teacher));
  }, role);
  await p.reload();
  await waitApp(p);
  await settle(p, 2500);
}

async function teacherTab(p, name) {
  const b = p.locator(`button.miras-dock-item:visible:has-text("${name}")`).first();
  await b.click({ timeout: 5000 });
  await settle(p, 1500);
  await skipTour(p);
}

/* القياس داخل الصفحة. */
function measure([spine, inner]) {
  const W = document.documentElement.clientWidth;
  const H = window.innerHeight;
  const book = matchMedia(inner).matches;
  const bookCss = getComputedStyle(document.documentElement).getPropertyValue('--duo-book').trim() === '1';
  const z0 = W / 2 - spine / 2, z1 = W / 2 + spine / 2;
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || (cs.position === 'absolute' && cs.overflow === 'hidden' && n.getBoundingClientRect().width <= 1)) return false;
    }
    return true;
  };
  /* المدى الأفقي الظاهر فعلاً بعد قصّ الأسلاف (overflow/clip): نصٌّ مخفي للقراءة
     الصوتية داخل صندوق 1×1 لا يُحسب، وما يُقصّ داخل حاوية تمرير يُقاس بحدودها. */
  const visibleSpan = (r, el) => {
    let l = r.left, rt = r.right;
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.clip === 'rect(0px, 0px, 0px, 0px)' || (cs.clipPath && cs.clipPath !== 'none')) {
        const b = n.getBoundingClientRect();
        l = Math.max(l, b.left); rt = Math.min(rt, b.right);
        if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || b.width <= 1) return null;
      }
      if (cs.position === 'fixed') break;
    }
    return rt - l >= 1 ? [l, rt] : null;
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.tagName).trim().replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${t.slice(0, 40)}"`;
  };
  // نافذة مفتوحة؟ نقيس داخلها فقط (ما خلف الستارة غير قابل للتفاعل).
  const overlays = [...document.querySelectorAll('div.fixed.inset-0, [role="dialog"]')].filter((o) => {
    if (!isVisible(o)) return false;
    const r = o.getBoundingClientRect();
    return r.width >= W * 0.9 && r.height >= H * 0.9 && o.querySelector('button, input, a[href]');
  });
  const scope = overlays.length ? overlays[overlays.length - 1] : document.body;
  const interactive = [...scope.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], summary')].filter(isVisible);
  const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const out = {
    W, H, book, bookCss, dialog: overlays.length > 0,
    overflowX: docW > W + 1 ? docW - W : 0,
    clipped: [], smallTargets: [], spineHits: [],
  };
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) out.clipped.push(`${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    const tag = el.tagName.toLowerCase();
    const inlineLink = tag === 'a' && getComputedStyle(el).display === 'inline';
    const isCheck = tag === 'input' && /checkbox|radio/.test(el.type);
    /* منطقة لمس موسَّعة بعنصر ::after مطلق بإزاحات سالبة (نقاط جولة التعريف). */
    let tw = r.width, th = r.height;
    const af = getComputedStyle(el, '::after');
    if (af.content !== 'none' && af.position === 'absolute') {
      const n = (v) => (v.endsWith('px') ? Math.min(parseFloat(v), 0) : 0);
      tw = r.width - n(af.left) - n(af.right); th = r.height - n(af.top) - n(af.bottom);
    }
    if (!inlineLink && !isCheck && (tw < 43.5 || th < 43.5)) out.smallTargets.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    const sp = visibleSpan(r, el);
    if (book && sp && sp[0] < z1 && sp[1] > z0) out.spineHits.push(`${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  for (const h of scope.querySelectorAll('h1, h2, h3')) {
    if (!isVisible(h)) continue;
    const r = h.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) out.clipped.push(`${label(h)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  if (book) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el) || !isVisible(el) || el.closest('button, a, input, select, textarea, [role="button"], summary, svg, script, style')) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const rr of range.getClientRects()) {
        if (rr.width < 1) continue;
        const sp = visibleSpan(rr, el);
        if (sp && sp[0] < z1 && sp[1] > z0) { seen.add(el); out.spineHits.push(`text "${n.nodeValue.trim().slice(0, 40)}" [${Math.round(rr.left)}..${Math.round(rr.right)}]`); break; }
      }
    }
  }
  return out;
}

async function runScreen(p, screen, results, prep) {
  for (const [pose, w, h] of VIEWPORTS) {
    await p.setViewportSize({ width: w, height: h });
    await settle(p, 500);
    if (prep) await prep();
    const m = await p.evaluate(measure, [SPINE, INNER]);
    results.push({ screen, pose, size: `${w}x${h}`, ...m });
    if (SHOTS && SHOT_AT.has(`${w}x${h}`)) {
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.screenshot({ path: path.join(SHOTS, `${LABEL}-${screen}-${w}x${h}.png`) });
    }
  }
  await p.setViewportSize({ width: 669, height: 867 });
  await settle(p, 400);
  if (EXTRA) await extraPasses(p, screen);
}

/* I و J لكل شاشة: تُجمع في EXTRA_OUT. */
const EXTRA = process.env.DUO_NO_EXTRA !== '1';
const EXTRA_OUT = { live: [], stress: [] };
const LIVE_SEQ = [[951, 585], [669, 867], [470, 700], [382, 580], [594, 368], [951, 350], [951, 585]];
const overlayCount = () => document.querySelectorAll('div.fixed.inset-0 [class*="max-w-"], .miras-teacher-alert-popover, [role="dialog"]').length;

async function extraPasses(p, screen) {
  // ── I: تسلسل حيّ على الصفحة نفسها ──
  try {
    await p.setViewportSize({ width: 951, height: 585 }); await settle(p, 400);
    const before = await p.evaluate((oc) => {
      window.__duoMarker = window.__duoMarker || Math.random();
      const oCount = (new Function('return (' + oc + ')()'))();
      const input = [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find((i) => { const r = i.getBoundingClientRect(); return r.width > 40 && r.height > 10 && !i.disabled && !i.readOnly && getComputedStyle(i).visibility !== 'hidden'; });
      return { marker: window.__duoMarker, overlays: oCount, hasInput: !!input, value: input ? input.value : null, path: location.pathname + location.search };
    }, overlayCount.toString());
    let typed = null;
    if (before.hasInput && !/^(teacher-submissions-empty|teacher-submissions-detail|login-)/.test(screen)) {
      const loc = p.locator('input[type="text"]:visible, input[type="search"]:visible, input:not([type]):visible').first();
      typed = (before.value || '') + 'ب';
      await loc.fill(typed).catch(() => { typed = null; });
      await settle(p, 300);
    }
    const seq = [];
    let ok = true;
    for (const [w, h] of LIVE_SEQ) {
      await p.setViewportSize({ width: w, height: h }); await settle(p, 450);
      const st = await p.evaluate(([oc, typed]) => {
        const W = document.documentElement.clientWidth;
        const oCount = (new Function('return (' + oc + ')()'))();
        const values = [...document.querySelectorAll('input')].map((i) => i.value);
        return { marker: window.__duoMarker, overlays: oCount, typedKept: typed == null ? null : values.includes(typed), overflowX: Math.max(document.documentElement.scrollWidth - W, 0), path: location.pathname + location.search };
      }, [overlayCount.toString(), typed]);
      const stepOk = st.marker === before.marker && st.overlays === before.overlays && st.overflowX === 0 && st.typedKept !== false && st.path === before.path;
      if (!stepOk) ok = false;
      seq.push({ size: `${w}x${h}`, ...st, ok: stepOk });
    }
    if (typed != null) { await p.locator('input[type="text"]:visible, input[type="search"]:visible, input:not([type]):visible').first().fill(before.value || '').catch(() => {}); }
    EXTRA_OUT.live.push({ screen, ok, overlays: before.overlays, typed: typed != null, seq });
  } catch (e) { EXTRA_OUT.live.push({ screen, ok: false, error: e.message.slice(0, 140) }); }

  // ── J: نص 200%، داكن، حواف أمان غير متماثلة، لوحة مفاتيح ──
  const variants = {
    text200: { css: 'html{font-size:200% !important;-webkit-text-size-adjust:200% !important}' },
    dark: { dark: true },
    'safe-area': { css: 'body{padding-left:47px !important;padding-right:12px !important}' },
    keyboard: { keyboard: true },
  };
  for (const [name, v] of Object.entries(variants)) {
    for (const [w, h] of [[669, 867], [951, 585], [382, 580]]) {
      try {
        await p.setViewportSize({ width: w, height: h }); await settle(p, 300);
        let handle = null; let prevTheme = null; let focused = null;
        if (v.css) handle = await p.addStyleTag({ content: v.css });
        if (v.dark) { prevTheme = await p.evaluate(() => document.documentElement.getAttribute('data-theme')); await p.emulateMedia({ colorScheme: 'dark' }); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); }
        if (v.keyboard) {
          focused = await p.evaluate(() => { const i = [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 40 && r.height > 10 && !x.disabled; }); if (!i) return false; i.focus(); return true; });
          await p.setViewportSize({ width: w, height: 350 });
        }
        await settle(p, 900);
        const m = await p.evaluate(measure, [SPINE, INNER]);
        const focusVisible = v.keyboard && focused ? await p.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return false; a.scrollIntoView({ block: 'nearest' }); const r = a.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }) : null;
        EXTRA_OUT.stress.push({ screen, variant: name, size: `${w}x${v.keyboard ? 350 : h}`, book: m.book, overflowX: m.overflowX, clipped: m.clipped, spineHits: m.spineHits, focusVisible, noInput: v.keyboard ? !focused : undefined });
        if (handle) await handle.evaluate((n) => n.remove());
        if (v.dark) { await p.emulateMedia({ colorScheme: 'light' }); await p.evaluate((t) => { if (t == null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, prevTheme); }
        if (v.keyboard) await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      } catch (e) { EXTRA_OUT.stress.push({ screen, variant: name, size: `${w}x${h}`, error: e.message.slice(0, 140) }); }
    }
  }
  await p.setViewportSize({ width: 669, height: 867 }); await settle(p, 400);
}

(async () => {
  const browser = await webkit.launch();
  const results = [];
  const notes = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  const only = (process.env.DUO_ONLY || '').split(',').filter(Boolean);
  const want = (k) => !only.length || only.some((o) => k.startsWith(o));
  const safe = async (key, fn) => { if (!want(key)) return; try { await fn(); } catch (e) { notes.push(`${key}: ${e.message.slice(0, 140)}`); } };

  // ── الدخول وفروعه (قاعدة محلية مبذورة: tests/seed.cjs) ──
  {
    const ctx = await newContext(browser); const p = await ctx.newPage();
    const fresh = async () => { await p.setViewportSize({ width: 669, height: 867 }); await p.goto(BASE + '/'); await waitApp(p); await settle(p, 2500); };
    const identify = async (id) => { await fresh(); await p.fill('#miras-login-identity', id); await p.locator('.miras-login-primary').first().click(); await settle(p, 2500); };
    await safe('login-identify', async () => { await fresh(); await runScreen(p, 'login-identify', results); });
    await safe('login-student-password', async () => { await identify('1001'); await runScreen(p, 'login-student-password', results); });
    await safe('login-student-signup', async () => { await identify('1100'); await runScreen(p, 'login-student-signup', results); });
    await safe('login-error-not-in-roster', async () => { await identify('9999'); await runScreen(p, 'login-error-not-in-roster', results); });
    await safe('login-teacher-password', async () => { await identify('aa@test.kw'); await runScreen(p, 'login-teacher-password', results); });
    await ctx.close();
  }

  // ── المعلّم ──
  {
    const ctx = await newContext(browser); const p = await ctx.newPage();
    const tab = (t) => teacherTab(p, t);
    const esc = async () => { await p.keyboard.press('Escape'); await settle(p, 500); };
    await p.goto(BASE + '/');
    await enterDemoNoTour(p, 'teacher');
    await safe('teacher-tour', async () => { await runScreen(p, 'teacher-tour', results); });
    await skipTour(p);
    await safe('teacher-home', async () => { await runScreen(p, 'teacher-home', results); });
    await safe('teacher-courses', async () => { await tab('المقررات'); await runScreen(p, 'teacher-courses', results); });
    await safe('teacher-courses-new-form', async () => { await tab('المقررات'); await p.locator('button:visible:has-text("مقرر جديد")').first().click(); await settle(p, 900); await runScreen(p, 'teacher-courses-new-form', results); await esc(); });
    await safe('teacher-students', async () => { await tab('الطلبة'); await runScreen(p, 'teacher-students', results); });
    await safe('teacher-students-edit', async () => { await tab('الطلبة'); await p.locator('.miras-roster-card button:visible').first().click(); await settle(p, 900); await runScreen(p, 'teacher-students-edit', results); await esc(); });
    await safe('teacher-questions', async () => { await tab('الأسئلة'); await p.locator('button[aria-label="بنك الأسئلة"]:visible').first().click().catch(() => {}); await settle(p, 800); await runScreen(p, 'teacher-questions', results); });
    await safe('teacher-questions-new-form', async () => { await tab('الأسئلة'); await p.locator('button:visible:has-text("سؤال جديد")').first().click(); await settle(p, 900); await runScreen(p, 'teacher-questions-new-form', results); await esc(); });
    await safe('teacher-questions-exams', async () => { await tab('الأسئلة'); await p.locator('button[aria-label="الاختبارات"]:visible').first().click(); await settle(p, 900); await runScreen(p, 'teacher-questions-exams', results); });
    await safe('teacher-questions-projects', async () => { await tab('الأسئلة'); await p.locator('button[aria-label="المشاريع"]:visible').first().click(); await settle(p, 900); await runScreen(p, 'teacher-questions-projects', results); });
    await safe('teacher-submissions', async () => { await tab('التسليمات'); await runScreen(p, 'teacher-submissions', results); });
    await safe('teacher-submissions-empty', async () => {
      await tab('التسليمات');
      const s = p.locator('.miras-submissions-panel input:visible').first();
      await s.fill('zzzz-لا-يوجد'); await settle(p, 800);
      await runScreen(p, 'teacher-submissions-empty', results);
      await s.fill(''); await settle(p, 500);
    });
    await safe('teacher-submissions-detail', async () => { await tab('التسليمات'); await p.locator('.miras-submissions-panel > .grid > button').first().click(); await settle(p, 1200); await runScreen(p, 'teacher-submissions-detail', results); });
    for (const [lab, key] of [['الأكواد', 'health'], ['الأجهزة', 'devices'], ['توليد', 'generate'], ['تفعيل', 'manual']]) {
      await safe(`teacher-codes-${key}`, async () => { await tab('الأكواد'); await p.locator(`.miras-inner-tab[aria-label="${lab}"]:visible`).first().click(); await settle(p, 1000); await runScreen(p, `teacher-codes-${key}`, results); });
    }
    await safe('teacher-account-status', async () => { await p.locator('button[aria-label="الرئيسية"]:visible').first().click().catch(() => {}); await settle(p, 800); await p.locator('.miras-zero-name-pill:visible, .miras-teacher-account-pill:visible').first().click(); await settle(p, 900); await runScreen(p, 'teacher-account-status', results); await esc(); });
    await safe('teacher-passkey', async () => { await p.locator('button[aria-label*="البصمة"]:visible').first().click(); await settle(p, 1200); await runScreen(p, 'teacher-passkey', results); await esc(); });
    await safe('teacher-notifications', async () => {
      await p.locator('button[aria-label="الرئيسية"]:visible').first().click().catch(() => {}); await settle(p, 1000);
      await p.locator('button[aria-label="التنبيهات المهمة"]:visible').first().click({ timeout: 4000 }); await settle(p, 1200);
      await runScreen(p, 'teacher-notifications', results); await esc();
    });
    await ctx.close();
  }

  // ── الطالب ──
  {
    const ctx = await newContext(browser); const p = await ctx.newPage();
    await enterDemo(p, 'student');
    const home = async () => { await p.setViewportSize({ width: 669, height: 867 }); await p.reload(); await waitApp(p); await settle(p, 1500); await closeOverlays(p); };
    await safe('student-alert-dialog', async () => { await runScreen(p, 'student-alert-dialog', results); await closeOverlays(p); });
    await safe('student-home', async () => { await runScreen(p, 'student-home', results); });
    for (const [txt, key] of [['الاختبارات', 'exams'], ['المشاريع', 'projects']]) {
      await safe(`student-${key}`, async () => {
        await home();
        await p.locator(`.miras-now-available button:visible:has-text("${txt}")`).first().click({ timeout: 4000 }); await settle(p, 1500); await closeOverlays(p);
        await runScreen(p, `student-${key}`, results);
      });
    }
    await safe('student-timeline', async () => { await home(); await p.locator('.miras-student-overview-card button:visible:has-text("عرض السجل الكامل"), .miras-student-last-submission-card button').first().click(); await settle(p, 1200); await runScreen(p, 'student-timeline', results); });
    for (const [sel, key] of [['.miras-student-actions-row button:nth-last-child(2)', 'calendar-alerts'], ['button[aria-label*="تثبيت"]:visible', 'install'], ['button[aria-label*="البصمة"]:visible', 'passkey']]) {
      await safe(`student-${key}`, async () => { await home(); await p.locator(sel).first().click(); await settle(p, 1200); await runScreen(p, `student-${key}`, results); });
    }
    // الاختبار الجاري: خارج نطاق التعديل (نزاهة). يُقاس عند مقاس البدء فقط، لأن تغيير المقاس
    // أثناء الاختبار يقفله عمداً (getNormalExamViewportIssue) — وهذا سلوك مقصود.
    await safe('student-exam-running', async () => {
      await home();
      await p.locator('.miras-now-available button:visible:has-text("الاختبارات")').first().click(); await settle(p, 1500); await closeOverlays(p);
      await p.locator('button:visible:has-text("ابدأ الاختبار")').first().click(); await settle(p, 6000);
      const m = await p.evaluate(measure, [SPINE, INNER]);
      results.push({ screen: 'student-exam-running', pose: 'C', size: '669x867', note: 'boundary: exam screen not restyled; measured at start size only', ...m });
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${LABEL}-student-exam-running-669x867.png`) });
    });
    await ctx.close();
  }

  // ── I) تسلسل حيّ بلا إعادة تحميل ──
  const live = { sequence: [], ok: true };
  {
    const ctx = await newContext(browser, { viewport: { width: 951, height: 585 } }); const p = await ctx.newPage();
    await enterDemo(p, 'teacher');
    await teacherTab(p, 'التسليمات');
    const input = p.locator('.miras-submissions-panel input:visible').first();
    await input.fill('مشروع'); await settle(p, 600);
    await p.evaluate(() => { window.__duoMarker = Math.random(); window.scrollTo(0, 120); });
    const marker = await p.evaluate(() => window.__duoMarker);
    await input.focus();
    for (const [w, h] of [[951, 585], [669, 867], [470, 700], [382, 580], [594, 368], [951, 350], [951, 585]]) {
      await p.setViewportSize({ width: w, height: h }); await settle(p, 600);
      const st = await p.evaluate(() => {
        const i = document.querySelector('.miras-submissions-panel input');
        const W = document.documentElement.clientWidth;
        return {
          value: i ? i.value : null, marker: window.__duoMarker, focused: document.activeElement === i,
          tabActive: (document.querySelector('.miras-dock-item.is-active') || {}).innerText || '',
          overflowX: Math.max(document.documentElement.scrollWidth - W, 0), scrollY: Math.round(window.scrollY),
        };
      });
      const ok = st.value === 'مشروع' && st.marker === marker && /التسليمات/.test(st.tabActive) && st.overflowX === 0;
      if (!ok) live.ok = false;
      live.sequence.push({ size: `${w}x${h}`, ...st, ok });
    }
    // نافذة مفتوحة تبقى مفتوحة عبر تغيّر المقاس.
    try {
      const bell = p.locator('button[aria-label*="التنبيهات"]:visible, button.miras-zero-action-notifications:visible').first();
      await bell.click({ timeout: 4000 }); await settle(p, 1000);
      const before = await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0 [class*="max-w-"], .miras-teacher-alert-popover').length);
      for (const [w, h] of [[669, 867], [382, 580], [951, 585]]) { await p.setViewportSize({ width: w, height: h }); await settle(p, 500); }
      const after = await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0 [class*="max-w-"], .miras-teacher-alert-popover').length);
      live.dialogSurvives = { before, after, ok: before > 0 && after === before };
      if (!live.dialogSurvives.ok) live.ok = false;
    } catch (e) { live.dialogSurvives = { error: e.message.slice(0, 120) }; }
    await ctx.close();
  }

  // ── J) ضغط إتاحة ──
  const stress = [];
  for (const variant of ['text200', 'dark', 'keyboard', 'safe-area']) {
    const ctx = await newContext(browser, variant === 'dark' ? { colorScheme: 'dark' } : {});
    const p = await ctx.newPage();
    await enterDemo(p, 'teacher');
    if (variant === 'dark') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    if (variant === 'text200') await p.addStyleTag({ content: 'html{font-size:200% !important;-webkit-text-size-adjust:200% !important}' });
    if (variant === 'safe-area') await p.addStyleTag({ content: 'body{padding-left:47px !important;padding-right:12px !important}' });
    for (const [w, h] of [[669, 867], [951, 585], [382, 580]]) {
      await p.setViewportSize({ width: w, height: h }); await settle(p, 600);
      if (variant === 'keyboard') {
        await teacherTab(p, 'التسليمات').catch(() => {});
        await p.locator('.miras-submissions-panel input:visible').first().focus().catch(() => {});
        await p.setViewportSize({ width: w, height: 350 }); await settle(p, 600);
      }
      const m = await p.evaluate(measure, [SPINE, INNER]);
      const focusVisible = variant === 'keyboard' ? await p.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return false; const r = a.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }) : null;
      stress.push({ variant, size: `${w}x${variant === 'keyboard' ? 350 : h}`, overflowX: m.overflowX, clipped: m.clipped.length, spineHits: m.spineHits.length, book: m.book, focusVisible });
      if (SHOTS && variant !== 'keyboard' && w === 669) await p.screenshot({ path: path.join(SHOTS, `${LABEL}-J-${variant}-${w}x${h}.png`) });
    }
    await ctx.close();
  }

  await browser.close();
  const summary = {};
  for (const r of results) {
    const k = r.screen;
    summary[k] = summary[k] || { cases: 0, overflowX: 0, clipped: 0, small: 0, spineHits: 0, bookCases: 0 };
    const s = summary[k]; s.cases++; if (r.overflowX) s.overflowX++; s.clipped += r.clipped.length; s.small += r.smallTargets.length; s.spineHits += r.spineHits.length; if (r.book) s.bookCases++;
  }
  fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, base: BASE, spine: SPINE, generatedAt: new Date().toISOString(), engine: 'Playwright WebKit', summary, live, stress, perScreenLive: EXTRA_OUT.live, perScreenStress: EXTRA_OUT.stress, notes, results }, null, 1));
  console.log(JSON.stringify({ summary, live: { ok: live.ok, dialog: live.dialogSurvives }, stress, notes }, null, 1));
})();
