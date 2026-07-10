import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
