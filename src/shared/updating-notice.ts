/*
 * «نُحدّث البرنامج» داخل التطبيق.
 *
 * أثناء نشر miras-api تجيب واجهةُ Google الأمامية طلباتِ /api بصفحة HTML إنجليزية
 * (500/502/503/504) لا يكتبها خادمُنا — هو يجيب /api بـJSON دائماً. كانت الشاشات
 * تحاول قراءتها JSON فتعرض «تعذر التنفيذ»، وكان تعافي الحزم يظنّ التعثّر نسخةً
 * قديمة فيمسح الذاكرة ويُسقط العامل في اللحظة التي يلزم فيها.
 *
 * هنا يُعرف ذلك الجواب، وتظهر رسالةٌ عائمة واحدة («حصة تحديث») بدل رسالة الخطأ، ويسأل
 * /api/health كل ثلاث ثوانٍ حتى يعود الخادم فيختفي ويُعلم من ينتظر.
 */

const UPDATING_STATUSES = new Set([500, 502, 503, 504]);

export const UPDATING_MESSAGE = "مِراس في حصة تحديث قصيرة، ويُستأنف الدرس بعد قليل.";
export const UPDATING_WRITE_MESSAGE = `${UPDATING_MESSAGE} إن كنت تحفظ تغييراً فراجِعه حين يُقرع الجرس.`;
/** يُطلق على window حين يعود الخادم. */
export const SERVER_BACK_EVENT = "miras:server-back";
export const HEALTH_URL = "/api/health";

/** جوابُ المنصّة لا جوابُ البرنامج: 5xx بغير JSON. */
export const isPlatformUpdating = (status: number, contentType: string | null | undefined) =>
  UPDATING_STATUSES.has(status) && !String(contentType || "").includes("application/json");

/* يُلتقط عند تقييم الوحدة، قبل أغلفة fetch في App.tsx: سؤالُ الصحة لا يمرّ بمجسّ
   الرادار (فلا يبلّغ عن كل محاولة) ولا بإعادة المحاولة. */
const nativeFetch: typeof fetch | null =
  typeof window !== "undefined" && typeof window.fetch === "function" ? window.fetch.bind(window) : null;

/** هل يجيب الخادم أصلاً؟ */
export const serverAnswers = (request: typeof fetch | null = nativeFetch): Promise<boolean> =>
  request
    ? request(HEALTH_URL, { cache: "no-store" }).then((response) => response.ok, () => false)
    : Promise.resolve(true);

/** الجوابُ الذي تراه الشاشات بدل صفحة HTML: JSON برسالةٍ هادئة. */
export const updatingJsonResponse = (isWrite: boolean) =>
  new Response(JSON.stringify({ error: isWrite ? UPDATING_WRITE_MESSAGE : UPDATING_MESSAGE, code: "SERVER_UPDATING" }), {
    status: 503,
    statusText: "Updating",
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Miras-Updating": "1" },
  });

let notice: HTMLElement | null = null;
const waiting = new Set<() => void>();

/** التأخير قبل السؤال رقم `tries`: ثلاث ثوانٍ، ثم يتباطأ إلى خمس عشرة. */
export const nextDelay = (tries: number) => Math.min(15_000, Math.round(3000 * Math.pow(1.3, Math.max(0, tries - 5))));

/**
 * يُظهر الشريطَ مرّةً واحدة مهما تكرّر الطلب، ويسأل `probe` كل ثلاث ثوانٍ
 * (ويتباطأ إلى خمس عشرة)، فإذا أجاب أخفاه ونادى `onBack` ومن سبقه.
 */
export function showUpdatingNotice(probe: () => Promise<boolean> = serverAnswers, onBack?: () => void): void {
  if (onBack) waiting.add(onBack);
  if (notice || typeof document === "undefined" || !document.body) return;
  // بشكل الرسائل العائمة في التطبيق (.miras-floating-toast): مربّع أيقونة ملوّن ونصّ عريض.
  const bar = document.createElement("div");
  bar.className = "miras-updating-notice";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.dir = "rtl";
  bar.style.cssText = [
    "position:fixed", "inset-inline:0", "bottom:calc(env(safe-area-inset-bottom,0px) + 1.25rem)", "margin:0 auto",
    "width:min(30rem,calc(100vw - 1.5rem))", "z-index:2147483000", "display:flex", "align-items:center", "gap:0.6rem",
    "padding:0.55rem 0.75rem", "border-radius:var(--miras-r-lg,20px)", "font-family:inherit", "text-align:right",
    "background:var(--miras-surface,#fff)", "color:var(--miras-brand-ink,#312E81)", "border:1px solid var(--miras-brand-line,#DCDCFB)",
    "box-shadow:var(--miras-e3,0 18px 44px rgba(11,16,32,.12))", "pointer-events:none",
  ].join(";");
  const tile = document.createElement("span");
  tile.setAttribute("aria-hidden", "true");
  tile.style.cssText = "display:grid;place-items:center;flex:none;width:2.25rem;height:2.25rem;border-radius:0.9rem;background:var(--miras-brand-tint,#EEF0FE);color:var(--miras-brand,#4338CA)";
  const svgNs = "http://www.w3.org/2000/svg";
  const bell = document.createElementNS(svgNs, "svg");
  bell.setAttribute("viewBox", "0 0 24 24");
  bell.setAttribute("width", "18");
  bell.setAttribute("height", "18");
  bell.setAttribute("fill", "none");
  bell.setAttribute("stroke", "currentColor");
  bell.setAttribute("stroke-width", "1.75");
  bell.setAttribute("stroke-linecap", "round");
  bell.setAttribute("stroke-linejoin", "round");
  for (const d of ["M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"]) {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", d);
    bell.appendChild(path);
  }
  tile.appendChild(bell);
  const text = document.createElement("span");
  text.textContent = UPDATING_MESSAGE;
  text.style.cssText = "flex:1;min-width:0;font-size:0.8125rem;font-weight:700;line-height:1.6";
  bar.append(tile, text);
  document.body.appendChild(bar);
  notice = bar;
  let tries = 0;
  const ask = async () => {
    const back = await probe().catch(() => false);
    if (!back) { tries++; window.setTimeout(ask, nextDelay(tries)); return; }
    bar.remove();
    notice = null;
    const callbacks = [...waiting];
    waiting.clear();
    callbacks.forEach((callback) => { try { callback(); } catch { /* منتظرٌ واحد لا يوقف الباقين */ } });
    window.dispatchEvent(new Event(SERVER_BACK_EVENT));
  };
  window.setTimeout(ask, 3000);
}
