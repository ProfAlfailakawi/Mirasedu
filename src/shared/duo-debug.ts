/*
 * صفحة تشخيص ركن الودجت (iPhone Duo) — تُحمَّل فقط عند وجود ?duo-debug=1 (انظر src/main.tsx).
 * ترسم إطار الركن (حدود حمراء شفافة، pointer-events: none) ولوحة صغيرة بقيم الجهاز تُوضع
 * خارج الركن (أسفل اليسار). لا تقرأ بيانات ولا تكتب شيئاً ولا تتصل بالخادم: عرض فقط.
 * للمالك: افتح الموقع أو التطبيق (TestFlight) على ?duo-debug=1، وتأكد أن الإطار الأحمر لا يغطي
 * شيئاً مهماً، ثم أرسل لقطة.
 */
export function installDuoDebug(): void {
  if (typeof document === 'undefined') return;
  /* معايرة حيّة على الجهاز: ?duo-debug=1&duo-w=110&duo-h=270 تتجاوز --duo-widget-w/-h على الجذر (هنا فقط).
     الإطار والمتغيرات المشتقة تتبعهما فوراً؛ قواعد التخطيط نفسها تقرأ المتغيرات فتتحرك معها حين تكون المنطقة نشطة. */
  const q = new URLSearchParams(location.search);
  const num = (k: string) => { const v = parseFloat(q.get(k) ?? ''); return Number.isFinite(v) && v > 0 && v < 2000 ? v : null; };
  const ow = num('duo-w'); const oh = num('duo-h');
  const root = document.documentElement.style;
  if (ow !== null) { root.setProperty('--duo-widget-w', `${ow}px`); if (!root.getPropertyValue('--duo-widget-gap')) root.setProperty('--duo-widget-inset', `calc(${ow}px + var(--duo-widget-gap, 8px))`); }
  if (oh !== null) { root.setProperty('--duo-widget-h', `${oh}px`); root.setProperty('--duo-widget-clear', `calc(${oh}px + var(--duo-widget-gap, 8px))`); }
  const frame = document.createElement('div');
  frame.setAttribute('data-duo-debug', 'frame');
  frame.style.cssText =
    'position:fixed;top:0;right:0;box-sizing:border-box;width:var(--duo-widget-w,0px);height:var(--duo-widget-h,0px);' +
    'border:2px solid rgba(220,38,38,.95);background:rgba(220,38,38,.10);pointer-events:none;z-index:2147483647';
  const probe = document.createElement('div');
  probe.setAttribute('data-duo-debug', 'probe');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;width:0;height:0;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  const panel = document.createElement('pre');
  panel.setAttribute('data-duo-debug', 'panel');
  panel.setAttribute('dir', 'ltr');
  panel.style.cssText =
    'position:fixed;left:6px;bottom:6px;max-width:calc(100vw - var(--duo-widget-inset,0px) - 12px);margin:0;padding:8px 10px;' +
    'font:11px/1.45 ui-monospace,Menlo,monospace;color:#0f172a;background:rgba(255,255,255,.94);border:1px solid #dc2626;' +
    'border-radius:10px;white-space:pre-wrap;word-break:break-word;pointer-events:none;z-index:2147483646;text-align:left';
  const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '(unset)';
  const render = () => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
    const pad = getComputedStyle(probe);
    const vv = window.visualViewport;
    const w = parseFloat(read('--duo-widget-w'));
    const native = !!cap?.isNativePlatform?.();
    const lines = [
      'duo-debug',
      `zone active: ${w > 0 ? 'YES' : 'NO'}`,
      `--duo-widget-w/gap/h: ${read('--duo-widget-w')} / ${read('--duo-widget-gap')} / ${read('--duo-widget-h')}`,
      `--duo-widget-inset/clear: ${read('--duo-widget-inset')} / ${read('--duo-widget-clear')}`,
      `inner: ${window.innerWidth}x${window.innerHeight}  visual: ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} @${vv.scale}` : 'n/a'}`,
      `orientation: ${window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'}  dpr: ${window.devicePixelRatio}`,
      `safe-area t/r/b/l: ${pad.paddingTop} ${pad.paddingRight} ${pad.paddingBottom} ${pad.paddingLeft}`,
      `dir: ${document.documentElement.dir || getComputedStyle(document.documentElement).direction}`,
      `standalone: navigator=${String(nav.standalone)} display-mode=${matchMedia('(display-mode: standalone)').matches}`,
      `Capacitor: ${native ? `native ${cap?.getPlatform?.() ?? '?'}` : cap ? 'present (not native)' : 'absent'}`,
      `UA has "Safari/": ${/Safari\//.test(navigator.userAgent)}  (WKWebView app = false)`,
      `override duo-w/duo-h: ${ow ?? '-'} / ${oh ?? '-'}`,
      'calibrate: send a screenshot with the red frame;',
      'adjust duo-w / duo-h until the frame covers the capsule',
      '(e.g. ?duo-debug=1&duo-w=110&duo-h=270).',
    ];
    panel.textContent = lines.join('\n');
  };
  const mount = () => {
    document.body.append(frame, probe, panel);
    render();
    window.addEventListener('resize', render);
    window.visualViewport?.addEventListener('resize', render);
    window.addEventListener('orientationchange', render);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
