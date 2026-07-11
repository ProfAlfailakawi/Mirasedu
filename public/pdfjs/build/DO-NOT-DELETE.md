# لا تحذف هذا المجلد

`pdf.mjs` و `pdf.worker.mjs` (pdfjs-dist 6.1.200) يُستخدمان عبر HTML في العارض (لا عبر import). حذفهما يعطّل عرض PDF/PowerPoint. يعيد `scripts/ensure-pdfjs.mjs` تنزيلهما تلقائياً قبل كل بناء.
