/*
 * نقل معرّف الصندوق التجريبي — في ترويسة، لا في كعكة.
 *
 * السبب الجذري لِما كان يحدث على النشر الحيّ وحده:
 *
 *   Firebase Hosting يحذف كل الكعكات من الطلبات التي يمرّرها إلى Cloud Run إلا
 *   `__session` وحدها. سلوكٌ موثّق عندهم، سببه أن الكعكات تدخل في مفتاح التخزين
 *   المؤقت في شبكتهم. و`/api/**` في هذا المشروع تمرّ بهذا الطريق تماماً
 *   (انظر `firebase.json`).
 *
 *   فكعكة `miras_demo` كانت تُضبط في المتصفح ولا تصل إلى الخادم أبداً. يرى
 *   الخادم طلباً بلا صندوق، فيرفض هوية المدرّب التجريبي — لأنها لا تعمل خارج
 *   صندوق — فيُقذف الزائر إلى شاشة الدخول بعد لحظةٍ من دخوله. وهذا نصّ ما
 *   وصفه صاحب المنتج: «يدخلني ويطلعني بنفس الوقت».
 *
 *   ومحلياً لا شبكة بين المتصفح والخادم، فالكعكة تصل ويعمل كل شيء. ولهذا لم
 *   يظهر العطب في أي تجربة محلية مهما تكررت.
 *
 * وبقيةُ التطبيق كانت قد جاوزت هذا القيد من قبل: الجلسة تُرسل في `Authorization`
 * ومعرّف الجهاز في `x-miras-device-id` — لا في كعكة. فهذا الملف يضع الصندوق على
 * الطريق نفسه.
 *
 * ولماذا اعتراض `fetch` بدل إضافة الترويسة عند كل نداء: في `App.tsx` وحدها أكثر
 * من مئة وخمسين نداءً، ومنها ما لا يمرّ ببنّاء الترويسات المشترك، وفي ملفات أخرى
 * نداءات إلى `/api/` كذلك. ترويسةٌ تنقص من نداءٍ واحد تعني طلباً يخرج من الصندوق
 * إلى قاعدة البيانات الحقيقية — وهذا ما لا يجوز أن يعتمد على انتباه من يضيف
 * نداءً جديداً بعد اليوم. موضعٌ واحد يغطي كل شيء، وما يُكتب لاحقاً يغطّى تلقائياً.
 */

export const MIRAS_DEMO_HEADER = "x-miras-demo";

/* لكل لسان (tab) صندوقُه: `sessionStorage` لا `localStorage`. فتحُ الموقع في
   لسانٍ آخر لا يُدخل صاحبَه في عرضٍ لم يطلبه، ولا يُخرجه من حسابه الحقيقي. */
const MIRAS_DEMO_STORAGE_KEY = "miras_demo_session";

/* الصيغة نفسها التي يتحقق منها الخادم: `demo_` + 32 بايت بالست عشري. ما لا
   يطابقها لا يُرسل — فلا تُلصق ترويسةٌ فارغة أو مشوّهة بكل طلب. */
const MIRAS_DEMO_SESSION_PATTERN = /^demo_[0-9a-f]{64}$/;

export function readDemoSessionId(): string {
  try {
    const value = String(sessionStorage.getItem(MIRAS_DEMO_STORAGE_KEY) || "").trim();
    return MIRAS_DEMO_SESSION_PATTERN.test(value) ? value : "";
  } catch {
    /* تخزين محجوب: لا صندوق — والتطبيق يعمل كما هو. */
    return "";
  }
}

export function rememberDemoSessionId(sessionId: unknown): boolean {
  const value = String(sessionId || "").trim();
  if (!MIRAS_DEMO_SESSION_PATTERN.test(value)) return false;
  try {
    sessionStorage.setItem(MIRAS_DEMO_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function forgetDemoSessionId(): void {
  try {
    sessionStorage.removeItem(MIRAS_DEMO_STORAGE_KEY);
  } catch {
    /* لا يمنع الخروج */
  }
}

/* الترويسة لا تُرسل إلا إلى مسارات هذا الموقع نفسه. معرّف الصندوق لا يُسلَّم
   إلى أي جهةٍ أخرى مهما نادى التطبيقُ إليها. */
function isOwnApiRequest(input: RequestInfo | URL): boolean {
  try {
    const raw =
      typeof Request !== "undefined" && input instanceof Request
        ? input.url
        : String(input);
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return false;
    return url.pathname.startsWith("/api/") || url.pathname.startsWith("/seb/");
  } catch {
    return false;
  }
}

let installed = false;

export function installDemoTransport(): void {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const original = window.fetch.bind(window);

  window.fetch = function mirasDemoFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      const sessionId = readDemoSessionId();
      if (!sessionId || !isOwnApiRequest(input)) return original(input, init);

      if (typeof Request !== "undefined" && input instanceof Request && !init) {
        const headers = new Headers(input.headers);
        headers.set(MIRAS_DEMO_HEADER, sessionId);
        return original(new Request(input, { headers }));
      }

      const headers = new Headers(
        init?.headers ||
          (typeof Request !== "undefined" && input instanceof Request
            ? input.headers
            : undefined),
      );
      headers.set(MIRAS_DEMO_HEADER, sessionId);
      return original(input, { ...init, headers });
    } catch {
      /* الاعتراض رفاهية عرض: إن تعذّر، يمضي الطلب كما كان ولا يتعطّل التطبيق. */
      return original(input, init);
    }
  } as typeof window.fetch;
}
