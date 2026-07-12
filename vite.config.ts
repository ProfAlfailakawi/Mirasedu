import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import https from 'https';
import {defineConfig, type Plugin} from 'vite';

// ───────────────────────────────────────────────────────────────────────────
// حارس ملفات عارض PDF.js — مدمج داخل إعداد Vite عمداً.
//
// أداة AI Studio تحذف كل ملفات ‎.mjs عند المزامنة، بما فيها
// public/pdfjs/build/pdf.mjs و pdf.worker.mjs (فيتعطّل عرض PDF/PowerPoint —
// كان pdf.worker.mjs الحيّ يرجع HTML بدل JS). وحتى سكربت حماية منفصل بامتداد
// ‎.mjs كان يُحذف هو الآخر. لذلك وُضعت الحماية هنا في vite.config.ts (ملف ‎.ts
// لا تحذفه الأداة). قبل كل بناء يتحقق من وجود الملفين، وإلا يعيد تنزيلهما من
// pdfjs-dist@6.1.200 (مطابق بايت-ببايت — تم التحقق). لا يلمس ملفاً سليماً.
// ───────────────────────────────────────────────────────────────────────────
function ensurePdfjs(): Plugin {
  const VERSION = '6.1.200';
  const buildDir = path.resolve(__dirname, 'public', 'pdfjs', 'build');
  const required = [
    {name: 'pdf.mjs', minBytes: 700 * 1024},
    {name: 'pdf.worker.mjs', minBytes: 1.8 * 1024 * 1024},
  ];
  const download = (url: string, dest: string, redirects = 5): Promise<void> =>
    new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects <= 0) return reject(new Error('too many redirects'));
            res.resume();
            return resolve(download(res.headers.location, dest, redirects - 1));
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          const out = fs.createWriteStream(dest);
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve()));
          out.on('error', reject);
        })
        .on('error', reject);
    });
  return {
    name: 'miras-ensure-pdfjs',
    apply: 'build',
    async buildStart() {
      fs.mkdirSync(buildDir, {recursive: true});
      for (const {name, minBytes} of required) {
        const dest = path.join(buildDir, name);
        let healthy = false;
        try {
          healthy = fs.statSync(dest).size >= minBytes;
        } catch {}
        if (healthy) continue;
        // eslint-disable-next-line no-console
        console.log(`[ensure-pdfjs] مفقود/تالف: ${name} — إعادة التنزيل…`);
        await download(
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build/${name}`,
          dest,
        );
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [ensurePdfjs(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // تقسيم مكتبات الطرف الثالث الثابتة (React/Firebase/الحركة/الأيقونات) إلى حزم
      // منفصلة يُخزّنها المتصفح عبر النشرات (حزمة التطبيق تتغيّر دون هذه)، فتصغر
      // حزمة index الرئيسية (كانت ١.٢م.ب) ويصبح أول فتح أسرع على جوالات الطلبة.
      // نُبقي كل شيء آخر في الحزمة الافتراضية (الأأمن) لتفادي أي مشكلة ترتيب تحميل.
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'vendor-firebase';
            if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react';
            if (id.includes('/motion/')) return 'vendor-motion';
            if (id.includes('/lucide-react/')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/data/**',
          '**/.miras-seb-attempts.json',
        ],
      },
    },
  };
});
