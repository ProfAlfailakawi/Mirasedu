#!/usr/bin/env node
/**
 * ضمان وجود ملفات عارض PDF.js قبل كل بناء (prebuild).
 *
 * المشكلة المتكررة: أدوات خارجية (مثل Google AI Studio) تحذف أحياناً الملفين
 * الكبيرين public/pdfjs/build/pdf.mjs و pdf.worker.mjs عند التصدير/المزامنة،
 * فيُنشر الموقع بلا عارض PDF/PowerPoint (يظهر index.html مكان الـ worker → تعطّل).
 *
 * هذا السكربت يعمل تلقائياً قبل `npm run build` (في نشري المحلي وفي GitHub Action
 * كليهما). إن كان أي ملف مفقوداً أو مقطوعاً (أصغر من الحد الأدنى = دليل تلف مثل
 * صفحة HTML بديلة) يعيد تنزيله من نسخة pdfjs-dist المثبّتة (6.1.200) — وهي مطابقة
 * بايت-ببايت للملفات الأصلية (تم التحقق). لا يلمس ملفاً سليماً موجوداً.
 */
import { createWriteStream } from "node:fs";
import { mkdir, stat, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const PDFJS_VERSION = "6.1.200";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "public", "pdfjs", "build");

// الحد الأدنى للحجم (بايت) لاكتشاف الملفات المقطوعة/المستبدَلة بـHTML.
const REQUIRED = [
  { name: "pdf.mjs", minBytes: 700 * 1024 },
  { name: "pdf.worker.mjs", minBytes: 1.8 * 1024 * 1024 },
];

const cdnUrl = (name) =>
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/${name}`;

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectsLeft <= 0) return reject(new Error("too many redirects"));
          res.resume();
          return resolve(
            download(res.headers.location, dest, redirectsLeft - 1),
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const out = createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

async function isHealthy(path, minBytes) {
  try {
    const s = await stat(path);
    return s.isFile() && s.size >= minBytes;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(BUILD_DIR, { recursive: true });
  let restored = 0;
  for (const { name, minBytes } of REQUIRED) {
    const dest = join(BUILD_DIR, name);
    if (await isHealthy(dest, minBytes)) continue;
    process.stdout.write(`[ensure-pdfjs] مفقود/تالف: ${name} — إعادة التنزيل…\n`);
    try {
      await download(cdnUrl(name), dest);
    } catch (err) {
      console.error(
        `\n[ensure-pdfjs] ✗ تعذّر استعادة ${name}: ${err?.message || err}\n` +
          `أوقفتُ البناء عمداً كي لا يُنشر عارض PDF معطوب.\n`,
      );
      process.exit(1);
    }
    if (!(await isHealthy(dest, minBytes))) {
      console.error(`[ensure-pdfjs] ✗ ${name} ما زال غير سليم بعد التنزيل.`);
      process.exit(1);
    }
    restored += 1;
    process.stdout.write(`[ensure-pdfjs] ✓ استُعيد ${name}\n`);
  }
  // لافتة تحذير دائمة بجانب الملفين.
  const guard = join(BUILD_DIR, "DO-NOT-DELETE.md");
  if (!(await isHealthy(guard, 10))) {
    await writeFile(
      guard,
      "# لا تحذف هذا المجلد\n\n`pdf.mjs` و `pdf.worker.mjs` (pdfjs-dist 6.1.200) " +
        "يُستخدمان عبر HTML في العارض (لا عبر import). حذفهما يعطّل عرض PDF/PowerPoint. " +
        "يعيد `scripts/ensure-pdfjs.mjs` تنزيلهما تلقائياً قبل كل بناء.\n",
      "utf8",
    );
  }
  if (restored === 0) {
    process.stdout.write("[ensure-pdfjs] ✓ ملفات pdfjs سليمة.\n");
  }
  // تنظيف أي بقايا تنزيل مؤقتة (لا شيء عادةً).
  void rm;
}

main().catch((err) => {
  console.error("[ensure-pdfjs] خطأ غير متوقع:", err);
  process.exit(1);
});
