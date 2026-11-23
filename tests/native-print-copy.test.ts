import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractPrintParts, openPrintOverlay, PRINT_OVERLAY_ID } from '../src/shared/print-overlay';
import { cameraBlockedStatus, cameraBlockedHint, notificationsActivatedText } from '../src/shared/native-copy';

const HTML = '<!doctype html><html><head><style>.a{color:red}</style></head><body><div class="toolbar"><button class="toolbar-close" onclick="window.close()">إغلاق</button><button onclick="window.print()">طباعة</button></div><div class="sheet">x</div><script>alert(1)</script></body></html>';

test('extractPrintParts keeps css and body', () => {
  const p = extractPrintParts(HTML);
  assert.match(p.css, /\.a\{color:red\}/);
  assert.match(p.body, /class="sheet"/);
  });

test('openPrintOverlay builds an in-page overlay and close removes it (native path)', () => {
  const nodes: any[] = [];
  const mk = (tag: string): any => ({ tag, attrs: {} as any, listeners: {} as any, removed: false,
    setAttribute(k: string, v: string) { this.attrs[k] = v; }, remove() { this.removed = true; },
    appendChild(n: any) { nodes.push(n); }, addEventListener(e: string, f: any) { this.listeners[e] = f; },
    querySelector: () => closeBtn });
  const closeBtn: any = { removeAttribute(k: string) { closeBtn.removed = k; }, addEventListener(e: string, f: any) { closeBtn.cb = f; } };
  const doc: any = { createElement: mk, head: { appendChild: (n: any) => nodes.push(n) }, body: { appendChild: (n: any) => nodes.push(n) } };
  const close = openPrintOverlay(HTML, doc);
  const overlay = nodes.find((n) => n.id === PRINT_OVERLAY_ID);
  assert.ok(overlay); assert.match(overlay.innerHTML, /sheet/);
  assert.equal(closeBtn.removed, 'onclick');
  close(); assert.equal(overlay.removed, true);
});

test('native copy has no browser wording; browser copy unchanged', () => {
  assert.match(cameraBlockedStatus(true), /الإعدادات ‹ Miras ‹ الكاميرا/);
  assert.match(cameraBlockedHint(true), /الإعدادات ‹ Miras ‹ الكاميرا/);
  assert.match(notificationsActivatedText(true), /هذا الجهاز/);
  assert.equal(cameraBlockedStatus(false), 'اسمح للكاميرا من إعدادات المتصفح ثم أعد المحاولة أو اختر صورة QR.');
  assert.match(cameraBlockedHint(false), /إعدادات المتصفح/);
  assert.equal(notificationsActivatedText(false), 'تم تفعيل إشعارات مراس لهذا المتصفح.');
});

test('App.tsx wiring: overlay only in native, popup path kept for browser, firebase link hidden in native', () => {
  const s = fs.readFileSync('App.tsx', 'utf8');
  assert.match(s, /if \(isAppleNativeShell\(\)\) \{[\s\S]{0,400}openPrintOverlay\(html\)/);
  assert.match(s, /window\.open\(\s*"about:blank"/);
  assert.match(s, /!isAppleNativeShell\(\) && \(\s*<div className="mt-4">\s*<a\s*href="https:\/\/console\.firebase/);
});
