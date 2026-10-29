/*
 * «نُحدّث البرنامج» داخل التطبيق.
 *
 * أثناء نشر miras-api تجيب واجهةُ Google الأمامية طلباتِ /api بصفحة HTML إنجليزية
 * (500/502/503/504) لا يكتبها خادمُنا — هو يجيب /api بـJSON دائماً. كانت الشاشات
 * تحاول قراءتها JSON فتعرض «تعذر التنفيذ»، وكان تعافي الحزم يظنّ التعثّر نسخةً
 * قديمة فيمسح الذاكرة ويُسقط العامل في اللحظة التي يلزم فيها.
 *
 * هنا يُعرف ذلك الجواب، ويظهر شريطٌ هادئ واحد بدل رسالة الخطأ، ويسأل
 * /api/health كل ثلاث ثوانٍ حتى يعود الخادم فيختفي ويُعلم من ينتظر.
 */

const UPDATING_STATUSES = new Set([500, 502, 503, 504]);

export const UPDATING_MESSAGE = "نُحدّث البرنامج الآن، لحظاتٍ ونعود.";
export const UPDATING_WRITE_MESSAGE = `${UPDATING_MESSAGE} إن كنت تحفظ تغييراً فتأكد من حالته بعد عودتنا.`;
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
  const bar = document.createElement("div");
  bar.className = "miras-updating-notice";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.dir = "rtl";
  bar.textContent = UPDATING_MESSAGE;
  bar.style.cssText = [
    "position:fixed", "inset-inline:0", "bottom:max(18px,env(safe-area-inset-bottom))", "margin:0 auto", "width:max-content", "max-width:calc(100vw - 32px)",
    "z-index:2147483000", "padding:11px 18px", "border-radius:14px", "font-family:inherit", "font-size:14px", "font-weight:700", "line-height:1.6",
    "background:var(--miras-surface,#fff)", "color:var(--miras-ink,#0B1020)", "border:1px solid var(--miras-line,#E6EAF2)",
    "box-shadow:var(--miras-e3,0 18px 44px rgba(11,16,32,.12))", "text-align:center", "pointer-events:none",
  ].join(";");
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
