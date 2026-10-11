import { createScrollJumpDetector, type ScrollJumpRecord } from "./scroll-jump-diagnostic";

const SCROLLER_SELECTOR = ".miras-submission-detail-scroll";

type Recent = { what: string; at: number; where: string };
export type WatchedScrollJump = ScrollJumpRecord & { context: Record<string, any> };

const shortStack = () =>
  String(new Error().stack || "")
    .split("\n")
    .slice(2, 6)
    .map((line) => line.trim().replace(/^at\s+/, "").replace(/\(?https?:\/\/[^/]+\//, "("))
    .join(" < ");

const describe = (el: any) =>
  el && el.tagName
    ? `${String(el.tagName).toLowerCase()}${el.id ? `#${el.id}` : ""}${
        typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}` : ""
      }`
    : "-";

/**
 * Watches the teacher solution scroller. When it jumps back to the top without a finger on the
 * screen, hands back a record with what changed around it. Restores every patched API on cleanup.
 */
export function watchSolutionScrollJumps(onJump: (record: WatchedScrollJump) => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const detector = createScrollJumpDetector();
  const recent: Recent[] = [];
  const note = (what: string, where: string) => {
    recent.push({ what, where, at: performance.now() });
    if (recent.length > 12) recent.shift();
  };

  // Record programmatic scroll/focus calls so a script-driven reset shows its caller.
  const restores: Array<() => void> = [];
  const patchMethod = (proto: any, name: string) => {
    const original = proto?.[name];
    if (typeof original !== "function") return;
    proto[name] = function patched(this: any, ...args: any[]) {
      try {
        note(`${name}(${args.length ? JSON.stringify(args[0])?.slice(0, 40) : ""})`, `${describe(this)} <- ${shortStack()}`);
      } catch {}
      return original.apply(this, args);
    };
    restores.push(() => {
      proto[name] = original;
    });
  };
  patchMethod(Element.prototype, "scrollTo");
  patchMethod(Element.prototype, "scrollBy");
  patchMethod(Element.prototype, "scrollIntoView");
  patchMethod(HTMLElement.prototype, "focus");
  patchMethod(window, "scrollTo");
  try {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    if (desc?.set && desc.get) {
      Object.defineProperty(Element.prototype, "scrollTop", {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value: number) {
          try {
            note(`scrollTop=${value}`, `${describe(this)} <- ${shortStack()}`);
          } catch {}
          desc.set!.call(this, value);
        },
      });
      restores.push(() => Object.defineProperty(Element.prototype, "scrollTop", desc));
    }
  } catch {}

  const viewport = () => {
    const vv: any = (window as any).visualViewport;
    return {
      innerHeight: window.innerHeight,
      visualViewport: vv ? `${Math.round(vv.height)}h@${Math.round(vv.offsetTop)}` : "-",
    };
  };
  let lastViewport = JSON.stringify(viewport());
  const onResize = () => {
    note(`resize ${JSON.stringify(viewport())}`, "window");
    lastViewport = JSON.stringify(viewport());
  };
  window.addEventListener("resize", onResize);
  (window as any).visualViewport?.addEventListener("resize", onResize);
  const onVisibility = () => note(`visibility=${document.visibilityState}`, "document");
  document.addEventListener("visibilitychange", onVisibility);

  const touchStart = () => detector.touchStart(performance.now());
  const touchMove = () => detector.touchMove(performance.now());
  const touchEnd = () => detector.touchEnd(performance.now());
  document.addEventListener("touchstart", touchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", touchMove, { capture: true, passive: true });
  document.addEventListener("touchend", touchEnd, { capture: true, passive: true });
  document.addEventListener("touchcancel", touchEnd, { capture: true, passive: true });

  let scroller: HTMLElement | null = null;
  let scrollerSerial = 0;
  const onScroll = () => {
    if (!scroller) return;
    const now = performance.now();
    const record = detector.scroll(now, scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
    if (!record) return;
    const context: Record<string, any> = {
      "آخر أحداث قبل القفزة": recent
        .filter((item) => now - item.at < 1500)
        .map((item) => `${Math.round(now - item.at)}ms ${item.what} @${item.where}`)
        .join(" || ") || "لا شيء (القفزة ليست من كود الصفحة)",
      "العنصر المركّز": describe(document.activeElement),
      "نسخة الحاوية": scrollerSerial,
      "الشاشة": JSON.stringify(viewport()),
      "تغيّرت الشاشة": JSON.stringify(viewport()) !== lastViewport,
      "حالة الصفحة": document.visibilityState,
    };
    onJump({ ...record, at: new Date().toISOString(), context });
  };

  const attach = () => {
    const found = document.querySelector<HTMLElement>(SCROLLER_SELECTOR);
    if (found === scroller) return;
    if (scroller) {
      scroller.removeEventListener("scroll", onScroll);
      note("scroller-replaced", scroller.isConnected ? "still-in-DOM" : "removed-from-DOM");
    }
    scroller = found;
    scrollerSerial += 1;
    if (scroller) scroller.addEventListener("scroll", onScroll, { passive: true });
  };
  attach();
  const pollId = window.setInterval(attach, 300);

  return () => {
    window.clearInterval(pollId);
    scroller?.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    (window as any).visualViewport?.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("touchstart", touchStart, true);
    document.removeEventListener("touchmove", touchMove, true);
    document.removeEventListener("touchend", touchEnd, true);
    document.removeEventListener("touchcancel", touchEnd, true);
    restores.reverse().forEach((restore) => {
      try {
        restore();
      } catch {}
    });
  };
}
