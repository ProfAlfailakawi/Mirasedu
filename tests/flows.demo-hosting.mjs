/*
 * البيئة التجريبية خلف Firebase Hosting — أي بلا كعكات.
 *
 * لماذا هذا الملف موجود:
 *
 *   Firebase Hosting يحذف كل الكعكات من الطلبات التي يمرّرها إلى Cloud Run إلا
 *   `__session` وحدها. و`/api/**` هنا تمرّ بهذا الطريق (انظر `firebase.json`).
 *   فكانت كعكة الصندوق `miras_demo` تُضبط في المتصفح ولا تصل إلى الخادم أبداً:
 *   يراه الخادم طلباً بلا صندوق، فيرفض هوية المدرّب التجريبي — لأنها لا تعمل
 *   خارج صندوق — فيُقذف الزائر إلى شاشة الدخول بعد لحظةٍ من دخوله.
 *
 *   ولم تكشفه تجربةٌ محلية واحدة مهما تكررت: محلياً لا شبكة بين المتصفح
 *   والخادم، فالكعكة تصل ويعمل كل شيء.
 *
 * فهذا الاختبار يحاكي الشبكة لا المتصفح: `hosted()` أدناه لا ترسل كعكةً أبداً،
 * مهما أرسل الخادم من `Set-Cookie`. وهو الفرق الوحيد عن بقية الاختبارات — وهو
 * بالضبط ما كان يسقط.
 */

import { createReporter } from "./lib.mjs";

const BASE = process.env.MIRAS_TEST_BASE || "http://localhost:3000";
const DEMO_HEADER = "x-miras-demo";
const DEMO_ID_PATTERN = /^demo_[0-9a-f]{64}$/;

const { check, done } = createReporter("DEMO خلف Hosting (بلا كعكات)");

/* طلبٌ كما يصل عبر Hosting: بلا أي كعكة، مهما أرسل الخادم. */
async function hosted(method, path, { demo, token, body } = {}) {
  const headers = {
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0 (TestRunner)",
  };
  if (demo) headers[DEMO_HEADER] = demo;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, ok: res.ok, data };
}

const AUTHED = "/api/teacher/activation-attempts"; // يردّ 401 إن لم تُعرف الهوية

const enter = await hosted("POST", "/api/demo/enter");
check("الدخول إلى الصندوق ينجح", enter.ok, JSON.stringify(enter.data).slice(0, 200));

const demoId = String(enter.data?.sessionId || "");
const token = String(enter.data?.teacher?.authToken || "");

/* بلا هذين لا شيء بعدهما ذو معنى: الكعكة HttpOnly لا يراها العميل، فإن لم
   يُعَد المعرّف في الجسم فلا سبيل إلى نسبة أي طلب لاحق إلى صندوقه. */
check("المعرّف يُعاد إلى العميل بصيغته", DEMO_ID_PATTERN.test(demoId), demoId);
check("جلسة المدرّب التجريبي تُعاد معه", !!token);

if (!demoId || !token) done();

// ── الصندوق يصل بالترويسة وحدها ──────────────────────────────────────────────
const configIn = await hosted("GET", "/api/demo/config", { demo: demoId });
check(
  "الترويسة وحدها تُدخل الطلب في صندوقه",
  configIn.data?.active === true,
  JSON.stringify(configIn.data),
);

const authedIn = await hosted("GET", AUTHED, { demo: demoId, token });
check(
  "هوية المدرّب التجريبي مقبولة داخل الصندوق",
  authedIn.status !== 401,
  `status=${authedIn.status}`,
);

// ── وبلا الترويسة لا يصل شيء ────────────────────────────────────────────────
const configOut = await hosted("GET", "/api/demo/config");
check(
  "طلبٌ بلا ترويسة ليس في صندوق",
  configOut.data?.active === false,
  JSON.stringify(configOut.data),
);

const authedOut = await hosted("GET", AUTHED, { token });
check(
  "هوية المدرّب التجريبي مرفوضة خارج الصندوق",
  authedOut.status === 401,
  `status=${authedOut.status}`,
);

const authedBad = await hosted("GET", AUTHED, { demo: "demo_not-a-real-id", token });
check(
  "معرّفٌ مشوّه لا يُدخل أحداً",
  authedBad.status === 401,
  `status=${authedBad.status}`,
);

// ── وما يُكتب داخل الصندوق لا يمسّ البيانات الحقيقية ─────────────────────────
// هذا هو الشرط الذي لا يُساوَم عليه: الترويسة بديلٌ عن الكعكة في النقل فقط،
// ولا تُوسّع ما يستطيع الصندوق بلوغه.
const MARK = `عرض-ترويسة-${Date.now()}`;
const created = await hosted("POST", "/api/teacher/sections", {
  demo: demoId,
  token,
  body: { code: "DEMOHDR1", courseName: MARK },
});
check("الكتابة داخل الصندوق تنجح", created.status < 400, `status=${created.status}`);

const realSections = await hosted("GET", "/api/teacher/sections");
const leaked = (realSections.data?.sections || []).some(
  (sec) => String(sec?.courseName || "") === MARK,
);
check("ما كُتب في الصندوق لا يظهر في البيانات الحقيقية", !leaked, MARK);

// ── والهدم يحتاج الترويسة كذلك ──────────────────────────────────────────────
const resetOut = await hosted("POST", "/api/demo/reset");
check("إعادة التعيين بلا ترويسة تُرفض", resetOut.status === 410, `status=${resetOut.status}`);

const resetIn = await hosted("POST", "/api/demo/reset", { demo: demoId });
check("إعادة التعيين بالترويسة تنجح", resetIn.ok, `status=${resetIn.status}`);

const exited = await hosted("POST", "/api/demo/exit", { demo: demoId });
check("الخروج بالترويسة ينجح", exited.ok, `status=${exited.status}`);

done();
