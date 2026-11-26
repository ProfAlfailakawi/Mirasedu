/*
 * «مراسم التفعيل» — عرض فقط.
 *
 * يُشغَّل على الحافة الصاعدة لإشارة موجودة أصلاً (activationSoftReveal في App.tsx
 * تصبح true عند نجاح التفعيل). لا يرسل طلباً ولا يغيّر حالة ولا يؤخر انتقالاً:
 * طبقة ثابتة لا تلتقط اللمس (pointer-events: none) تبقى فوق مساحة الطالب التي
 * ينتقل إليها التطبيق فوراً، ثم تختفي وحدها.
 *
 * التسلسل: مفتاح يدور → يتحول إلى اسم الطالب → قفل ينغلق على رسم الجهاز المربوط.
 * مع تقليل الحركة: الإطار الأخير ثابتاً (الاسم والجهاز المقفل) ثم يختفي.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../design/motion';
import './activation-ceremony.css';

const PLAY_MS = 2300;
const STILL_MS = 1600;

function firstTwoNames(name: string): string {
  return String(name || '').trim().split(/\s+/).slice(0, 2).join(' ');
}

export function ActivationCeremony({ active, name }: { active: boolean; name?: string }) {
  const [run, setRun] = React.useState<null | { still: boolean; name: string; id: number }>(null);
  const prev = React.useRef(active);

  React.useEffect(() => {
    const rising = active && !prev.current;
    prev.current = active;
    if (!rising || typeof document === 'undefined') return;
    const still = prefersReducedMotion();
    const id = Date.now();
    setRun({ still, name: firstTwoNames(name || ''), id });
    const timer = window.setTimeout(() => setRun((r) => (r && r.id === id ? null : r)), still ? STILL_MS : PLAY_MS);
    return () => window.clearTimeout(timer);
    // name is read at the moment of activation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!run || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`miras-ceremony${run.still ? ' is-still' : ''}`}
      role="status"
      aria-live="polite"
      dir="rtl"
      data-testid="activation-ceremony"
    >
      <span className="miras-ceremony__sr">{`تم التفعيل${run.name ? `: ${run.name}` : ''}، وارتبط الحساب بهذا الجهاز.`}</span>
      <div className="miras-ceremony__card" aria-hidden="true">
        <div className="miras-ceremony__stage">
          <svg className="miras-ceremony__key" viewBox="0 0 64 64" width="56" height="56">
            <circle cx="20" cy="32" r="11" fill="none" stroke="currentColor" strokeWidth="5" />
            <path d="M31 32h26M49 32v9M57 32v7" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
          </svg>
          <p className="miras-ceremony__name">{run.name || 'أهلاً بك'}</p>
        </div>
        <svg className="miras-ceremony__device" viewBox="0 0 120 120" width="112" height="112">
          <rect className="miras-ceremony__phone" x="30" y="10" width="60" height="100" rx="12" />
          <rect className="miras-ceremony__screen" x="37" y="22" width="46" height="74" rx="4" />
          <g className="miras-ceremony__lock">
            <path className="miras-ceremony__shackle" d="M50 58v-8a10 10 0 0 1 20 0v8" fill="none" strokeWidth="5" strokeLinecap="round" />
            <rect className="miras-ceremony__body" x="44" y="56" width="32" height="24" rx="5" />
            <circle className="miras-ceremony__hole" cx="60" cy="67" r="3" />
          </g>
        </svg>
        <p className="miras-ceremony__caption">ارتبط حسابك بهذا الجهاز</p>
      </div>
    </div>,
    document.body,
  );
}

export default ActivationCeremony;
