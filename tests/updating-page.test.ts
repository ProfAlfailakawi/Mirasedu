// «نُحدّث البرنامج» بدل صفحة Google الإنجليزية أثناء نشر miras-api.
//
//   U1) public/sw.js: تنقّلٌ بـ 500/502/503/504، أو انقطاعٌ والجهازُ متّصل ← صفحةُ التحديث
//       (503، no-store)؛ والنجاحُ والتحويل يمرّان كما هما.
//   U2) لا يمسّ /api ولا /seb ولا غيرَ GET، ولا يحفظ جوابَ 5xx في أيّ ذاكرة، ولا يحفظ
//       صفحةَ التحديث هيكلاً؛ ودون اتصالٍ حقيقي يبقى الهيكل.
//   U3) التثبيتُ يحفظ الصفحة في ذاكرةٍ ثابتة يُبقيها التفعيل؛ وبصمةُ البناء باقية.
//   U4) الصفحة («حصة تحديث»): مستقلّة بلا طلبٍ خارجي، RTL، نهاري/ليلي، تسأل /api/health كل ٣ ثوانٍ
//       وتتباطأ، وتعيد فتح الرابط نفسه، ولا تدور في حلقة.
//   U5) الخادم: GET /api/health قبل كل وسيط؛ والتطبيق: 5xx بغير JSON على /api ← شريطٌ
//       هادئ لا رسالةُ خطأ؛ وتعافي الحزم يسأل الخادم قبل أن يمسح شيئاً.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { isPlatformUpdating, nextDelay, serverAnswers, updatingJsonResponse, UPDATING_MESSAGE } from '../src/shared/updating-notice';

const root = new URL('..', import.meta.url).pathname;
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const ORIGIN = 'https://mirasedu.web.app';
const PAGE = read('public/updating.html');
const pathOf = (key: any) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).pathname;
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const GOOGLE_502 = '<html><title>Error 502 (Server Error)!!1</title><p>Error: Server Error. Please try again in 30 seconds.</p></html>';

type Net = (pathname: string) => Promise<Response>;
/** The worker in a sandbox with an in-memory Cache Storage that records every write. */
function worker(net: Net, options: { online?: boolean } = {}) {
  const source = read('public/sw.js');
  const handlers: Record<string, (event: any) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  const writes: Array<{ cache: string; key: string; status: number }> = [];
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name)!;
    return {
      put: async (key: any, response: Response) => { writes.push({ cache: name, key: pathOf(key), status: response.status }); entries.set(pathOf(key), response.clone()); },
      match: async (key: any) => entries.get(pathOf(key))?.clone(),
      addAll: async (list: string[]) => { for (const item of list) { const r = await net(pathOf(item)); if (r.ok) entries.set(pathOf(item), r); } },
    };
  };
  const caches = {
    open,
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (key: any) => { for (const entries of store.values()) { const hit = entries.get(pathOf(key)); if (hit) return hit.clone(); } return undefined; },
  };
  const self: any = {
    addEventListener: (type: string, fn: any) => { handlers[type] = fn; },
    location: { origin: ORIGIN }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] },
    navigator: { onLine: options.online ?? true }, registration: {},
  };
  vm.runInNewContext(source, {
    self, URL, Response, Promise, JSON, String, Date, Math, Map, Number, caches,
    importScripts() { throw new Error('offline'); },
    fetch: (request: any) => net(pathOf(request)),
  });
  const lifecycle = async (type: string, data?: unknown) => {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const request = async (pathname: string, init: { mode?: string; method?: string; destination?: string } = {}) => {
    let answer: Promise<Response> | null = null;
    handlers.fetch({
      request: { url: `${ORIGIN}${pathname}`, mode: init.mode ?? 'navigate', method: init.method ?? 'GET', destination: init.destination ?? 'document' },
      respondWith: (p: Promise<Response>) => { answer = p; },
      waitUntil: () => {},
    });
    let response: Response | null = null;
    let error: unknown = null;
    try { response = answer ? await answer : null; } catch (e) { error = e; }
    await tick(); await tick();
    return { answered: answer !== null, response, error };
  };
  return { lifecycle, request, store, writes, open };
}

/** The network as the platform answers mid-deploy: the page itself is still reachable for install. */
const deploying = (status: number | 'drop'): Net => async (pathname) => {
  if (pathname === '/updating.html') return html(PAGE);
  if (status === 'drop') throw new TypeError('Failed to fetch');
  return html(GOOGLE_502, status);
};
const isUpdatingPage = async (response: Response | null) =>
  !!response && response.status === 503 && response.headers.get('cache-control') === 'no-store' &&
  /text\/html/.test(response.headers.get('content-type') || '') && (await response.clone().text()).includes('مِراس في حصة تحديث');

test('U1 a 500/502/503/504 navigation gets the updating page (503, no-store)', async () => {
  for (const status of [500, 502, 503, 504]) {
    const sw = worker(deploying(status));
    await sw.lifecycle('install');
    for (const p of ['/', '/teacher/courses', '/?miras_entry=student']) {
      assert.ok(await isUpdatingPage((await sw.request(p)).response), `${status} ${p}`);
    }
  }
});

test('U1 a dropped navigation while online gets the updating page', async () => {
  const sw = worker(deploying('drop'));
  await sw.lifecycle('install');
  assert.ok(await isUpdatingPage((await sw.request('/student')).response));
});

test('U1 success and redirects pass through untouched', async () => {
  const sw = worker(async (pathname) => (pathname === '/updating.html' ? html(PAGE) : html('<p>the app</p>')));
  await sw.lifecycle('install');
  const app = await sw.request('/student');
  assert.equal(app.response?.status, 200);
  assert.equal(await app.response!.text(), '<p>the app</p>');
  const redirect = worker(async () => new Response(null, { status: 302, headers: { Location: '/' } }));
  assert.equal((await redirect.request('/old')).response?.status, 302);
});

test('U2 /api, /seb and non-GET are never touched; no 5xx is ever cached', async () => {
  const sw = worker(deploying(502));
  await sw.lifecycle('install');
  assert.equal((await sw.request('/api/students', { mode: 'cors' })).answered, false);
  assert.equal((await sw.request('/api/export/file.xlsx')).answered, false, 'an /api navigation is left to the network');
  assert.equal((await sw.request('/seb/start')).answered, false, 'Safe Exam Browser pages are left alone');
  assert.equal((await sw.request('/student', { method: 'POST' })).answered, false);
  await sw.request('/');
  await sw.request('/teacher');
  const fiveXX = sw.writes.filter((w) => w.status >= 500);
  assert.deepEqual(fiveXX, [], 'no 5xx in any cache');
  assert.ok(!sw.writes.some((w) => w.key === '/' && w.status !== 200), 'the shell is never overwritten by an error');
});

test('U2 the updating page itself is never stored as the app shell; real screens still are', async () => {
  const sw = worker(async (pathname) => (pathname === '/updating.html' ? html(PAGE) : html(`<p>${pathname}</p>`)));
  await sw.lifecycle('install');
  sw.writes.length = 0; // install stores "/" from the precache list
  await sw.request('/updating.html');
  assert.ok(!sw.writes.some((w) => w.key === '/'), 'updating page not stored as "/"');
  await sw.request('/student');
  assert.ok(sw.writes.some((w) => w.key === '/' && w.status === 200), 'a real screen still refreshes the shell');
});

test('U2 truly offline keeps opening the cached shell', async () => {
  const offline = worker(async (pathname) => {
    if (pathname === '/') return html('<p>app shell</p>');
    if (pathname === '/updating.html') return html(PAGE);
    throw new TypeError('offline');
  }, { online: false });
  await offline.lifecycle('install');
  const shell = await offline.request('/student');
  assert.equal(await shell.response!.text(), '<p>app shell</p>');
});

test('U3 install stores the page in a fixed cache that activate keeps; build stamp intact', async () => {
  const source = read('public/sw.js');
  const sw = worker(deploying(502));
  await sw.lifecycle('install');
  assert.ok(sw.store.get('miras-updating')?.has('/updating.html'));
  await (await sw.open('miras-shell-old-build')).put('/x', new Response('x'));
  await sw.lifecycle('activate');
  assert.ok(sw.store.has('miras-updating'), 'activate keeps the updating cache');
  assert.ok(!sw.store.has('miras-shell-old-build'), 'activate still drops old shells');
  assert.ok(source.includes("const MIRAS_BUILD_ID = '__BUILD_ID__';"), 'build stamp placeholder intact');

  const empty = worker(async (pathname) => (pathname === '/updating.html' ? html(PAGE) : html(GOOGLE_502, 502)));
  assert.equal((await empty.request('/')).response?.status, 502, 'with nothing stored the answer comes back as it was');
  const refill = worker(async (pathname) => (pathname === '/updating.html' ? html(PAGE) : html('<p>ok</p>')));
  await refill.request('/student');
  assert.ok(refill.store.get('miras-updating')?.has('/updating.html'), 'a successful navigation refills a wiped page');
});

test('U4 the page is self-contained, RTL, light/dark, and in Modern Standard Arabic', () => {
  assert.ok(!/https?:\/\//i.test(PAGE) && !/\bsrc=/i.test(PAGE) && !/<link\b/i.test(PAGE) && !/@import/i.test(PAGE) && (PAGE.match(/url\([^)]*\)/g) || []).every((u) => u.startsWith('url(#')), 'no external or extra request');
  assert.match(PAGE, /<html lang="ar" dir="rtl">/);
  assert.match(PAGE, /prefers-color-scheme:dark/);
  assert.match(PAGE, /prefers-reduced-motion/);
  assert.match(PAGE, /<title>حصة تحديث · مِراس<\/title>/);
  for (const text of ['مِراس في حصة تحديث', 'يُستأنف الدرس بعد قليل', 'تُفتح وحدها', 'جرّب الدخول الآن', 'انقطع الاتصال بالإنترنت', 'أكثر من المعتاد']) assert.ok(PAGE.includes(text), text);
  assert.match(PAGE, /id="note" role="status" aria-live="polite"/);
  assert.match(PAGE, /<button type="button" id="retry">/);
  // The app mark itself (brand/miras-mark.svg), not an invented logo.
  assert.ok(PAGE.includes('M386 178A86 86 0 1 0 214 178') && PAGE.includes('M250 219 C 268 308, 244 374, 150 404'));
  // docs/DESIGN.md: no emoji in the interface.
  assert.ok(!/\p{Extended_Pictographic}/u.test(PAGE.replace(/<!--[\s\S]*?-->/g, '')), 'no emoji');
});

function runPage(options: { health: boolean[]; recent?: number[]; pathname?: string; online?: boolean }) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(PAGE)?.[1] || '';
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const asked: string[] = [];
  const nodes: Record<string, any> = {};
  const node = (id: string) => (nodes[id] ??= { textContent: '', addEventListener() {} });
  const store: Record<string, string> = options.recent ? { 'miras-updating-reloads': JSON.stringify(options.recent) } : {};
  const location = { pathname: options.pathname ?? '/student', reloads: 0, replaced: '', reload() { this.reloads++; }, replace(url: string) { this.replaced = url; } };
  let call = 0;
  vm.runInNewContext(script, {
    document: { getElementById: node, addEventListener() {}, hidden: false },
    window: { addEventListener() {} }, navigator: { onLine: options.online ?? true }, location,
    sessionStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    fetch: (url: string, init: any) => { asked.push(`${url}|${init?.cache}`); const ok = options.health[Math.min(call++, options.health.length - 1)]; return Promise.resolve({ ok }); },
    AbortController, JSON, Date, Math,
  });
  const step = async () => {
    const timer = timers.filter((t) => t.ms !== 8000).shift()!;
    timers.splice(timers.indexOf(timer), 1);
    timer.fn();
    await tick(); await tick();
    return timer.ms;
  };
  return { asked, location, nodes, step };
}

test('U4 the page asks /api/health every 3 s and reopens the same URL when back', async () => {
  const page = runPage({ health: [false, false, true] });
  const delays = [await page.step(), await page.step(), await page.step()];
  assert.deepEqual(delays, [3000, 3000, 3000]);
  assert.ok(page.asked.every((a) => a === '/api/health|no-store'));
  assert.equal(page.location.reloads, 1);
});

test('U4 the page backs off to 15 s while the server stays down', async () => {
  const page = runPage({ health: [false] });
  const delays: number[] = [];
  for (let i = 0; i < 16; i++) delays.push(await page.step());
  assert.equal(delays[0], 3000);
  assert.ok(delays[delays.length - 1] > 3000 && delays.every((ms) => ms <= 15000));
  assert.ok(delays.every((ms, i) => i === 0 || ms >= delays[i - 1]));
  assert.equal(page.location.reloads, 0);
});

test('U4 no reload loop: 3 reloads in 2 minutes slow it to every 30 s', async () => {
  const now = Date.now();
  const page = runPage({ health: [true], recent: [now - 5000, now - 4000, now - 3000] });
  assert.equal(await page.step(), 30000);
  assert.ok(page.nodes.lead.textContent.includes('أكثر من المعتاد'));
});

test('U4 opened by name it returns to the start; offline it says so and does not ask', async () => {
  const named = runPage({ health: [true], pathname: '/updating.html' });
  await named.step();
  assert.equal(named.location.replaced, '/');
  assert.equal(named.location.reloads, 0);
  const offline = runPage({ health: [true], online: false });
  await offline.step();
  assert.equal(offline.asked.length, 0);
  assert.ok(offline.nodes.title.textContent.includes('انقطع الاتصال'));
});

test('U5 server: GET /api/health answers {ok:true} before every middleware', () => {
  const server = read('server.ts');
  const health = server.indexOf('app.get("/api/health"');
  const firstUse = server.indexOf('app.use(');
  assert.ok(health > 0 && health < firstUse, '/api/health is registered before the first app.use');
  const body = server.slice(health, server.indexOf('\n});', health) + 4);
  assert.match(body, /res\.json\(\{ ok: true \}\)/);
  assert.match(body, /no-store/);
  assert.ok(!/db|Instance|write|save|auth/i.test(body.replace('app.get("/api/health"', '')), 'no DB, no auth, no writes');
});

test('U5 app: only a 5xx that is not JSON is the platform; the bar replaces the error', async () => {
  assert.ok(isPlatformUpdating(502, 'text/html; charset=UTF-8') && isPlatformUpdating(503, '') && isPlatformUpdating(500, 'text/html') && isPlatformUpdating(504, null));
  assert.ok(!isPlatformUpdating(503, 'application/json; charset=utf-8') && !isPlatformUpdating(404, 'text/html') && !isPlatformUpdating(200, 'text/html'));
  const calm = updatingJsonResponse(false);
  assert.equal(calm.status, 503);
  assert.equal((await calm.json()).error, UPDATING_MESSAGE);
  assert.ok(!/\p{Extended_Pictographic}/u.test(UPDATING_MESSAGE));
  assert.equal(await serverAnswers((async () => new Response('{}', { status: 200 })) as typeof fetch), true);
  assert.equal(await serverAnswers((async () => html(GOOGLE_502, 502)) as typeof fetch), false);
  assert.equal(await serverAnswers((async () => { throw new TypeError('drop'); }) as typeof fetch), false);
  assert.deepEqual([1, 5, 6, 30].map(nextDelay).map((ms) => ms <= 15000), [true, true, true, true]);

  const app = read('App.tsx');
  const wrapper = app.slice(app.indexOf('async function mirasFetch('), app.indexOf('const fetch = mirasFetch;'));
  const hook = wrapper.indexOf('isPlatformUpdating(resp.status');
  assert.ok(hook > 0 && hook < wrapper.indexOf('clone.json()'), 'the fetch layer recognises the platform page before reading JSON');
  assert.match(wrapper, /showUpdatingNotice\(\)/);
  assert.match(wrapper, /return updatingJsonResponse\(trackMutatingRequest\)/);
});

test('U5 chunk recovery asks the server before wiping; the server coming back re-checks the version', () => {
  const update = read('src/shared/app-update.ts');
  const recovery = update.slice(update.indexOf('async function recoverFromStaleChunk'), update.indexOf('export function markShellHealthy'));
  const ask = recovery.indexOf('await serverAnswers()');
  assert.ok(ask > 0 && ask < recovery.indexOf('purgeShell()') && ask < recovery.indexOf('sessionStorage.setItem(CHUNK_KEY'));
  assert.match(update, /addEventListener\(SERVER_BACK_EVENT, \(\) => \{ void checkForUpdate\(\); \}\)/);
  const fetchServerBuild = update.slice(update.indexOf('async function fetchServerBuild'), update.indexOf('async function applyUpdate'));
  assert.ok(fetchServerBuild.indexOf('if (!response.ok) return null;') < fetchServerBuild.indexOf('response.json()'), 'the version check never reads the error page');
});
