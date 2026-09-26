// ───────────────────────────────────────────────────────────────────────────
// سحب الملفات وإفلاتها (Drag & Drop)
//
// يضيف إمكانية سحب ملف وإفلاته على أي منطقة رفع قائمة في التطبيق (استيراد
// الأسماء من Excel، تسليم المشاريع، استيراد بنك الأسئلة، رفع الكتاب، …) دون
// المساس بمنطق أيٍّ منها: الملف المُفلَت يُوضع في حقل الرفع نفسه (input[type=file])
// ثم يُطلق حدث change، فيمرّ بالمعالج ذاته وبالتحقق ذاته تماماً كما لو اختاره
// المستخدم من نافذة الملفات.
//
// منطقة الإفلات: أقرب عنصر أب (حتى بضع مستويات) يحتوي حقل رفع واحداً فقط.
// يُحترم `accept` و`multiple` و`disabled`، ويُمنع المتصفح من فتح الملف إن
// أُفلت خارج أي منطقة رفع.
// ───────────────────────────────────────────────────────────────────────────

const ZONE_CLASS = "miras-drop-active";
const MAX_DEPTH = 5;

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types || []).includes("Files");

function findFileInput(target: EventTarget | null): {
  input: HTMLInputElement;
  zone: HTMLElement;
} | null {
  let node = target instanceof Element ? (target as HTMLElement) : null;
  for (let depth = 0; node && depth <= MAX_DEPTH; depth++) {
    if (node instanceof HTMLInputElement && node.type === "file") {
      return node.disabled ? null : { input: node, zone: node.parentElement || node };
    }
    const inputs = node.querySelectorAll<HTMLInputElement>('input[type="file"]');
    if (inputs.length === 1) {
      return inputs[0].disabled ? null : { input: inputs[0], zone: node };
    }
    if (inputs.length > 1) return null;
    node = node.parentElement;
  }
  return null;
}

function matchesAccept(file: File, accept: string) {
  const rules = accept
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (!rules.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

let activeZone: HTMLElement | null = null;
const setActiveZone = (zone: HTMLElement | null) => {
  if (activeZone === zone) return;
  activeZone?.classList.remove(ZONE_CLASS);
  activeZone = zone;
  activeZone?.classList.add(ZONE_CLASS);
};

export function installFileDrop() {
  if (typeof window === "undefined") return;

  const style = document.createElement("style");
  style.textContent = `.${ZONE_CLASS}{outline:2px dashed #6366f1!important;outline-offset:4px;border-radius:16px;background-color:rgba(99,102,241,.06)!important;transition:outline-color .15s,background-color .15s}`;
  document.head.appendChild(style);

  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const found = findFileInput(event.target);
    setActiveZone(found?.zone || null);
    if (event.dataTransfer) event.dataTransfer.dropEffect = found ? "copy" : "none";
  });

  window.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) setActiveZone(null);
  });

  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setActiveZone(null);
    const found = findFileInput(event.target);
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (!found || !dropped.length) return;
    const { input } = found;
    const accepted = dropped.filter((file) => matchesAccept(file, input.accept));
    const files = input.multiple ? accepted : accepted.slice(0, 1);
    if (!files.length) return;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  window.addEventListener("dragend", () => setActiveZone(null));
}
