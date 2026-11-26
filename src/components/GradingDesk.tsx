/*
 * «مكتب التصحيح» — عرض فقط.
 *
 *  - GradeDistribution: مدرّج توزيع الدرجات لنشاط واحد، يُبنى من الدرجات المحمّلة
 *    في الواجهة أصلاً، ويتحدّث مع كتابة الدرجة الحالية (قبل حفظها). لا يحفظ شيئاً.
 *  - useSwipeBetweenStudents: سحب أفقي على الجوال يستدعي دوال التنقل الموجودة
 *    (السابق/التالي) كما هي، ويتجاهل السحب داخل عنصر قابل للتمرير أفقياً أو حقل إدخال.
 */
import * as React from 'react';
import { prefersReducedMotion } from '../design/motion';
import './grading-desk.css';
import { BANDS, summarizeScores, toArabicDigits as toArabic, type DeskScore } from '../shared/grade-distribution';

export type { DeskScore } from '../shared/grade-distribution';

export function GradeDistribution({ scores, currentId, className = '' }: { scores: DeskScore[]; currentId?: string; className?: string }) {
  const { counts, graded, total, average, currentBand } = summarizeScores(scores, currentId);
  const peak = Math.max(1, ...counts);
  return (
    <section className={`miras-grade-dist ${className}`} aria-label="توزيع درجات النشاط" dir="rtl">
      <header className="miras-grade-dist__head">
        <h3>توزيع الدرجات</h3>
        <span className="miras-grade-dist__meta">
          {`رُصد ${toArabic(graded)} من ${toArabic(total)}`}
          {average !== null ? ` · المتوسط ${toArabic(Math.round(average * 100))}٪` : ''}
        </span>
      </header>
      <ol className="miras-grade-dist__bars">
        {counts.map((count, i) => (
          <li
            key={BANDS[i].label}
            className={`miras-grade-dist__bar${i === currentBand ? ' is-current' : ''}`}
            aria-label={`${BANDS[i].label}: ${toArabic(count)}${i === currentBand ? '، ومنها الطالب الحالي' : ''}`}
          >
            <span className="miras-grade-dist__count">{toArabic(count)}</span>
            <span className="miras-grade-dist__track">
              <span className="miras-grade-dist__fill" style={{ height: `${Math.round((count / peak) * 100)}%` }} />
            </span>
            <span className="miras-grade-dist__label">{BANDS[i].label}</span>
          </li>
        ))}
      </ol>
      {graded === 0 && <p className="miras-grade-dist__empty">لم تُرصد درجات لهذا النشاط بعد.</p>}
    </section>
  );
}

function insideHorizontalScroller(target: EventTarget | null, stop: HTMLElement | null): boolean {
  let el = target as HTMLElement | null;
  while (el && el !== stop) {
    if (el.matches?.('input, textarea, select, [contenteditable="true"], iframe, canvas')) return true;
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** RTL: moving the finger toward the left goes forward (التالي), toward the right goes back (السابق). */
export function useSwipeBetweenStudents(onPrevious: () => void, onNext: () => void, enabled: boolean) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const start = React.useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = React.useCallback((e: React.TouchEvent) => {
    if (!enabled || e.touches.length !== 1 || (typeof window !== 'undefined' && window.innerWidth >= 1024)) { start.current = null; return; }
    if (insideHorizontalScroller(e.target, ref.current)) { start.current = null; return; }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, [enabled]);
  const onTouchEnd = React.useCallback((e: React.TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - s.t > 700) return;
    const forward = dx < 0;
    const el = ref.current;
    if (el && !prefersReducedMotion()) {
      el.dataset.deskSwipe = forward ? 'next' : 'prev';
      window.setTimeout(() => { if (el) delete el.dataset.deskSwipe; }, 320);
    }
    if (forward) onNext(); else onPrevious();
  }, [onNext, onPrevious]);
  return { ref, onTouchStart, onTouchEnd };
}
