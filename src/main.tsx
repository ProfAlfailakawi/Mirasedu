import {Component, StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
// Google AI Studio edits the root App.tsx/index.css files. Keep those files as
// the single production source so preview, build, and Firebase Hosting cannot
// silently drift onto different copies of the interface.
import App from '../App.tsx';
import '../index.css';

// ───────────────────────────────────────────────────────────────────────────
// حاجز عرض الواجهة (Render Guard)
//
// المشكلة: لم يكن في التطبيق أي ErrorBoundary، فأي استثناء غير متوقع أثناء رسم
// الواجهة كان يُسقط شجرة React بالكامل ويترك الطالب أمام «صفحة بيضاء فارغة» بلا
// أي تفسير. يحدث ذلك بوضوح في اللحظات التي تلي إدخال كود التفعيل لأول مرة عندما
// يكون الطالب داخلاً من جهاز/متصفح سبق استخدامه من حساب آخر (هاتف مشترى من صديق،
// أو متصفح مسجَّل فيه حساب آخر): تظهر رسالة النجاح ثم تنهار إعادة الرسم فتبيضّ
// الشاشة دون رسالة واضحة.
//
// هذا الحاجز يلتقط ذلك الانهيار ويعرض رسالة عربية واضحة مع خيارات استرجاع فعّالة،
// بدل الشاشة البيضاء. لا يغيّر أي ميزة قائمة؛ فهو لا يعمل إطلاقاً إلا في الحالة
// التي كانت أصلاً معطوبة (الشاشة البيضاء).
// ───────────────────────────────────────────────────────────────────────────
class MirasRenderGuard extends Component<
  {children: ReactNode},
  {failed: boolean}
> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error: unknown, info: unknown) {
    // نسجّل الخطأ في الكونسول لتشخيصه، ونبلّغ الرادار فوراً — انهيار الواجهة
    // (الشاشة البيضاء) كان أخطر خطأ غير مرئي لأحد.
    try {
      console.error('Miras render guard caught a UI error:', error, info);
    } catch {}
    try {
      void fetch('/api/monitor/report', {
        method: 'POST',
        keepalive: true,
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          message:
            'انهيار واجهة (شاشة بيضاء): ' +
            String((error as any)?.message || error).slice(0, 200),
          stack: String((error as any)?.stack || '').slice(0, 1400),
          url: location.pathname + '#react-crash',
          source: 'client',
          role: '',
          userId: '',
        }),
      }).catch(() => undefined);
    } catch {}
  }

  // إعادة فتح البرنامج مع الإبقاء على جلسة الطالب: إن كان الكود قد فُعّل بالفعل
  // فستُحمّل صفحته مباشرة بعد أن تستقر البيانات.
  private reopen = () => {
    try {
      window.location.reload();
    } catch {}
  };

  // البدء من جديد: نمسح جلسة الطالب/الأستاذ المحفوظة محلياً فقط (دون لمس هوية
  // الجهاز المربوط) ثم نعيد التحميل لتظهر شاشة الدخول نظيفة. مفيد عندما يكون
  // المتصفح يحمل جلسة حساب آخر.
  private restartClean = () => {
    try {
      localStorage.removeItem('miras_student_session');
      localStorage.removeItem('miras_teacher_session');
    } catch {}
    try {
      window.location.reload();
    } catch {}
  };

  render() {
    if (!this.state.failed) return (this as any).props.children;
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f4f5f8',
          fontFamily:
            "'Tajawal','Cairo','Segoe UI',system-ui,-apple-system,sans-serif",
          textAlign: 'center',
          color: '#0f172a',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '440px',
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid rgba(255,255,255,0.7)',
            borderRadius: '28px',
            padding: '32px 26px',
            boxShadow: '0 30px 80px rgba(15,23,42,0.12)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: '58px',
              height: '58px',
              margin: '0 auto 18px',
              display: 'grid',
              placeItems: 'center',
              borderRadius: '18px',
              background: '#eef2ff',
              color: '#4338ca',
              fontSize: '28px',
              fontWeight: 900,
            }}
          >
            !
          </div>
          <h1
            style={{
              fontSize: '19px',
              fontWeight: 900,
              margin: '0 0 12px',
              lineHeight: 1.5,
            }}
          >
            تعذّر عرض الصفحة
          </h1>
          <p
            style={{
              fontSize: '13px',
              fontWeight: 700,
              lineHeight: 2,
              color: '#475569',
              margin: '0 0 8px',
            }}
          >
            قد يكون هذا الجهاز أو المتصفح مستخدماً من حساب آخر (مثل هاتف سبق
            استخدامه من زميل)، أو حدث تعذّر مؤقت بعد إدخال الكود.
          </p>
          <p
            style={{
              fontSize: '12px',
              fontWeight: 700,
              lineHeight: 1.9,
              color: '#64748b',
              margin: '0 0 22px',
            }}
          >
            إن ظهرت لك رسالة نجاح التفعيل فإن كودك غالباً قد سُجِّل بالفعل. جرّب
            «إعادة فتح البرنامج» أولاً.
          </p>
          <div style={{display: 'grid', gap: '10px'}}>
            <button
              type="button"
              onClick={this.reopen}
              style={{
                width: '100%',
                padding: '13px 18px',
                borderRadius: '16px',
                border: 'none',
                cursor: 'pointer',
                background: '#0f172a',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 900,
                fontFamily: 'inherit',
              }}
            >
              إعادة فتح البرنامج
            </button>
            <button
              type="button"
              onClick={this.restartClean}
              style={{
                width: '100%',
                padding: '13px 18px',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                cursor: 'pointer',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '13px',
                fontWeight: 900,
                fontFamily: 'inherit',
              }}
            >
              تسجيل الدخول من جديد
            </button>
          </div>
          <p
            style={{
              fontSize: '11px',
              fontWeight: 700,
              lineHeight: 1.9,
              color: '#94a3b8',
              margin: '20px 0 0',
            }}
          >
            إذا تكرّر ظهور هذه الرسالة فهذا الجهاز مرتبط بحساب آخر؛ راجع أستاذ
            المقرر لتبديل الجهاز المعتمد.
          </p>
        </div>
      </div>
    );
  }
}

const isMirasSebEntry = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('miras_seb') === '1' || params.get('seb') === '1' || !!params.get('seb_token') || /SafeExamBrowser|SEB/i.test(navigator.userAgent);
  } catch {
    return /SafeExamBrowser|SEB/i.test(navigator.userAgent);
  }
};

const mountApp = () => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MirasRenderGuard>
        <App />
      </MirasRenderGuard>
    </StrictMode>,
  );
  // يُستخدم بواسطة شبكة إنقاذ SEB في index.html لإلغاء مهلة الإنقاذ بعد
  // تحميل الواجهة بنجاح.
  try {
    (window as any).__mirasAppMounted = true;
  } catch {}
};

mountApp();

const MIRAS_CLIENT_BUILD_VERSION = 'miras-v74-reapply-pdfjs-guard-20260711';

// ───────────────────────────────────────────────────────────────────────────
// شريط «تحديث جاهز» — أعلى الشاشة، مرة واحدة، بضغطة واحدة
//
// ملاحظات المالك: (١) موضعه كان أسفل الشاشة فيغطّي شريط التنقّل والبحث — نقلناه
// إلى الأعلى. (٢) كان يظهر في كل فتح للتطبيق — الآن يظهر مرة واحدة في الجلسة فقط،
// وبمجرد الضغط على «حدّث الآن» يُفعَّل التحديث ويُعاد التحميل فيختفي نهائياً (لا
// يوجد عامل خدمة منتظِر بعدها = لا شريط بعدها). لا يظهر إطلاقاً داخل متصفح الاختبار.
// ───────────────────────────────────────────────────────────────────────────
const showMirasUpdateBanner = (worker: ServiceWorker | null | undefined) => {
  try {
    if (!worker || isMirasSebEntry()) return;
    if (document.getElementById('miras-update-banner')) return;
    const onceKey = `miras-update-banner:${MIRAS_CLIENT_BUILD_VERSION}`;
    if (sessionStorage.getItem(onceKey) === '1') return;
    sessionStorage.setItem(onceKey, '1');

    const bar = document.createElement('div');
    bar.id = 'miras-update-banner';
    bar.setAttribute('dir', 'rtl');
    bar.style.cssText = [
      'position:fixed',
      'top:calc(env(safe-area-inset-top,0px) + 12px)',
      'left:50%',
      'transform:translateX(-50%) translateY(-160%)',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'max-width:calc(100vw - 24px)',
      'padding:9px 10px 9px 14px',
      'border-radius:9999px',
      'background:rgba(15,23,42,0.95)',
      'color:#fff',
      "font-family:'Tajawal','Cairo',system-ui,sans-serif",
      'font-weight:800',
      'font-size:13px',
      'box-shadow:0 18px 50px rgba(15,23,42,0.45)',
      '-webkit-backdrop-filter:blur(10px)',
      'backdrop-filter:blur(10px)',
      'transition:transform .5s cubic-bezier(.2,.9,.25,1)',
    ].join(';');

    const label = document.createElement('span');
    label.textContent = 'تحديث جديد جاهز ✨';
    label.style.cssText = 'white-space:nowrap;padding-inline-start:4px';

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.textContent = 'حدّث الآن';
    updateBtn.style.cssText =
      'border:none;cursor:pointer;border-radius:9999px;padding:7px 15px;background:#34d399;color:#04231a;font:inherit;font-weight:900;font-size:12px';
    updateBtn.onclick = () => {
      updateBtn.textContent = 'يُحدّث…';
      updateBtn.disabled = true;
      try {
        worker.postMessage({type: 'SKIP_WAITING'});
      } catch {}
    };

    const laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.setAttribute('aria-label', 'لاحقاً');
    laterBtn.textContent = '✕';
    laterBtn.style.cssText =
      'border:none;cursor:pointer;border-radius:9999px;width:28px;height:28px;background:rgba(255,255,255,.14);color:#fff;font:inherit;font-weight:900;font-size:12px';
    laterBtn.onclick = () => {
      bar.style.transform = 'translateX(-50%) translateY(-160%)';
      setTimeout(() => bar.remove(), 520);
    };

    bar.appendChild(label);
    bar.appendChild(updateBtn);
    bar.appendChild(laterBtn);
    document.body.appendChild(bar);
    requestAnimationFrame(() => {
      bar.style.transform = 'translateX(-50%) translateY(0)';
    });
  } catch {}
};

if ('serviceWorker' in navigator) {
  let mirasControllerReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (mirasControllerReloaded || isMirasSebEntry()) return;
    mirasControllerReloaded = true;
    try {
      const key = `miras-sw-refresh:${MIRAS_CLIENT_BUILD_VERSION}`;
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
      window.location.reload();
    } catch {}
  });

  window.addEventListener('load', () => {
    if (isMirasSebEntry()) {
      navigator.serviceWorker
        .getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .catch(() => undefined);
      return;
    }
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(MIRAS_CLIENT_BUILD_VERSION)}`)
      .then(registration => {
        // عامل خدمة جديد ينتظر بالفعل عند فتح التطبيق → اعرض الشريط لتفعيله بضغطة.
        if (registration.waiting && navigator.serviceWorker.controller) {
          showMirasUpdateBanner(registration.waiting);
        }
        try {
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              // اكتمل تنزيل نسخة جديدة وهناك نسخة تعمل حالياً = تحديث حقيقي.
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                showMirasUpdateBanner(worker);
              }
            });
          });
        } catch {}
        return registration.update();
      })
      .catch(() => undefined);
  });
}
