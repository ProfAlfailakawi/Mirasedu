/**
 * طباعة داخل الصفحة نفسها (للتطبيق): جسر الطباعة الأصلي يطبع الإطار الرئيسي فقط،
 * ولا تعمل window.open ولا popup.print(). نحقن أنماط المستند وجسمه في طبقة
 * بملء الشاشة، ونخفي بقية التطبيق عند الطباعة، ثم نستدعي window.print() على الإطار الرئيسي.
 */
export function extractPrintParts(html: string): { css: string; body: string } {
  const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]).join("\n");
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  // لا نُنقّي سكربتات بتعبير نمطي: innerHTML لا ينفّذ <script>، والـ HTML مولَّد من التطبيق نفسه.
  const body = m ? m[1] : html;
  return { css, body };
}

export const PRINT_OVERLAY_ID = "miras-print-overlay";
const OVERLAY_CSS =
  `#${PRINT_OVERLAY_ID}{position:fixed;inset:0;z-index:2147483000;background:#fff;overflow:auto;-webkit-overflow-scrolling:touch}` +
  `@media print{body>*:not(#${PRINT_OVERLAY_ID}){display:none!important}#${PRINT_OVERLAY_ID}{position:static!important;overflow:visible!important}}`;

export function openPrintOverlay(html: string, doc: Document = document): () => void {
  const { css, body } = extractPrintParts(html);
  const style = doc.createElement("style");
  style.textContent = css + "\n" + OVERLAY_CSS;
  const overlay = doc.createElement("div");
  overlay.id = PRINT_OVERLAY_ID;
  overlay.setAttribute("dir", "rtl");
  overlay.innerHTML = body;
  const close = () => {
    try { style.remove(); } catch {}
    try { overlay.remove(); } catch {}
  };
  const closeBtn = overlay.querySelector(".toolbar-close");
  if (closeBtn) {
    closeBtn.removeAttribute("onclick");
    closeBtn.addEventListener("click", close);
  }
  doc.head.appendChild(style);
  doc.body.appendChild(overlay);
  return close;
}
