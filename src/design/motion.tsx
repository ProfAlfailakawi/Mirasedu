/*
 * Calm motion primitives for the DNA kit (presentation only).
 *
 *  - useMotionPhase : one IntersectionObserver / play-once decision per element,
 *                     built on the journey-reveal session store. `rest` is the
 *                     final state (no motion attributes at all); `pre` and `play`
 *                     exist only once JS has really decided to animate.
 *  - DnaMotionGroup : a container that shares one phase with everything inside it
 *                     (rings, bars, counters). CSS in dna-motion.css reads `data-draw`.
 *  - DnaCountUp     : 0 -> value once per playKey, the final text is always what is
 *                     exposed to assistive tech and what is rendered at rest.
 *  - DnaChangeMark  : one soft highlight when a live value genuinely changes.
 *
 * The final state is rendered whenever motion cannot or should not run:
 * no IntersectionObserver (tests, SSR), reduced motion, hidden tab, a playKey that
 * already played this session, or an element covered by an overlay for too long.
 */
import * as React from 'react';
import { journeyAlreadyPlayed, journeyIsCovered, journeyMarkPlayed } from './journeyReveal';

export type MotionPhase = 'rest' | 'pre' | 'play';

const STORE = 'motion:';
const COVER_POLL_MS = 250;
const COVER_GIVE_UP_MS = 8000;

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Share of the element's height currently inside the viewport (0..1). */
function onScreenShare(el: Element): number {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  if (!(r.height > 0) || !(vh > 0)) return 0;
  const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  return Math.max(0, Math.min(1, visible / r.height));
}

/** True when an entrance may be armed now. Decided synchronously, before first paint. */
export function canPlayMotion(playKey?: string): boolean {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return false;
  if (prefersReducedMotion()) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  if (playKey && journeyAlreadyPlayed(STORE + playKey)) return false;
  return true;
}

export interface MotionPhaseOptions {
  /** false: always `rest` (the host decides it should not animate). */
  enabled?: boolean;
  /** Share of the element that must be visible before it plays. */
  threshold?: number;
  /** How long `play` lasts before returning to `rest` (>= the longest effect inside). */
  settleMs?: number;
}

export function useMotionPhase<T extends HTMLElement = HTMLElement>(playKey?: string, options: MotionPhaseOptions = {}) {
  const { enabled = true, threshold = 0.4, settleMs = 1400 } = options;
  const ref = React.useRef<T>(null);
  const [phase, setPhase] = React.useState<MotionPhase>(() => (enabled && canPlayMotion(playKey) ? 'pre' : 'rest'));

  // pre -> play when the element is really on screen (and not covered by a modal / tour)
  React.useEffect(() => {
    if (phase !== 'pre') return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setPhase('rest');
      return;
    }
    const h = el.getBoundingClientRect().height;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const eff = Math.max(0.1, Math.min(threshold, h > 0 && vh > 0 ? (0.9 * vh) / h : threshold));
    let poll: ReturnType<typeof setInterval> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (poll) clearInterval(poll);
      if (giveUp) clearTimeout(giveUp);
      poll = giveUp = undefined;
    };
    const play = () => {
      stop();
      io.disconnect();
      // The preference can change while the element waits: re-check before playing.
      if (document.hidden || prefersReducedMotion()) return setPhase('rest');
      if (playKey) journeyMarkPlayed(STORE + playKey);
      setPhase('play');
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= eff - 0.01)) return;
        if (!journeyIsCovered(el)) return play();
        if (poll) return;
        poll = setInterval(() => {
          // Once the cover is gone the element may have been scrolled away: only play while it is really on screen.
          if (!journeyIsCovered(el) && onScreenShare(el) >= eff - 0.01) play();
        }, COVER_POLL_MS);
        giveUp = setTimeout(() => {
          stop();
          io.disconnect();
          setPhase('rest'); // never leave the real state hidden
        }, COVER_GIVE_UP_MS);
      },
      { threshold: [eff] },
    );
    io.observe(el);
    return () => {
      stop();
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'pre']);

  // play -> rest: later value changes snap, nothing replays
  React.useEffect(() => {
    if (phase !== 'play') return;
    const t = setTimeout(() => setPhase('rest'), settleMs);
    return () => clearTimeout(t);
  }, [phase, settleMs]);

  return { ref, phase, attr: phase === 'rest' ? undefined : phase };
}

/* ------------------------------------------------------------------ group */

const MotionGroupContext = React.createContext<MotionPhase | null>(null);

export function useMotionGroupPhase(): MotionPhase | null {
  return React.useContext(MotionGroupContext);
}

export interface DnaMotionGroupProps {
  children?: React.ReactNode;
  className?: string;
  /** any other attribute (role, aria-*, data-*) is passed to the element */
  [attr: string]: unknown;
  as?: 'div' | 'section' | 'span' | 'ul' | 'ol' | 'li' | 'article';
  /** Remember by entity so remounts do not replay (one play per session). */
  playKey?: string;
  threshold?: number;
  settleMs?: number;
}

/** Container sharing one play-once phase with the rings, bars and counters inside it. */
export function DnaMotionGroup({ as = 'div', playKey, threshold, settleMs, children, ...rest }: DnaMotionGroupProps) {
  const { ref, phase, attr } = useMotionPhase<HTMLElement>(playKey, { threshold, settleMs });
  const Root = as as React.ElementType;
  return (
    <MotionGroupContext.Provider value={phase}>
      <Root ref={ref} data-draw={attr} {...rest}>
        {children}
      </Root>
    </MotionGroupContext.Provider>
  );
}

/* --------------------------------------------------------------- count-up */

/** cubic-bezier(0.22, 0.78, 0.24, 1): the kit's own --dna-ease. */
function bezierEase(p: number): number {
  const [x1, y1, x2, y2] = [0.22, 0.78, 0.24, 1];
  const cxv = 3 * x1;
  const bx = 3 * (x2 - x1) - cxv;
  const ax = 1 - cxv - bx;
  const cyv = 3 * y1;
  const by = 3 * (y2 - y1) - cyv;
  const ay = 1 - cyv - by;
  const sx = (t: number) => ((ax * t + bx) * t + cxv) * t;
  let t = p;
  for (let i = 0; i < 6; i++) {
    const d = (3 * ax * t + 2 * bx) * t + cxv;
    if (Math.abs(d) < 1e-6) break;
    t -= (sx(t) - p) / d;
  }
  t = Math.min(1, Math.max(0, t));
  return ((ay * t + by) * t + cyv) * t;
}

function decimalsOf(value: number): number {
  const s = String(value);
  const i = s.indexOf('.');
  return i < 0 || s.includes('e') ? 0 : Math.min(3, s.length - i - 1);
}

/**
 * The number to show. `rest` -> value, `pre` -> 0, `play` -> eased 0..value.
 * It never returns an intermediate value outside `play`.
 */
export function useCountUpValue(value: number, phase: MotionPhase, durationMs = 700): number {
  const [p, setP] = React.useState(0);
  React.useEffect(() => {
    if (phase !== 'play') return;
    let raf = 0;
    const t0 = performance.now();
    setP(0);
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / durationMs);
      setP(bezierEase(k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, durationMs]);
  if (phase === 'rest' || !Number.isFinite(value)) return value;
  if (phase === 'pre') return 0;
  const f = 10 ** decimalsOf(value);
  return Math.round(value * p * f) / f;
}

export interface DnaCountUpProps {
  value: number;
  /** The screen's own formatter (digits, separators, suffix). Defaults to String. */
  format?: (n: number) => string;
  /** Own phase when not inside a DnaMotionGroup. */
  playKey?: string;
  duration?: number;
  className?: string;
}

export function DnaCountUp({ value, format = String, playKey, duration = 700, className }: DnaCountUpProps) {
  const group = useMotionGroupPhase();
  const own = useMotionPhase<HTMLSpanElement>(playKey, { enabled: group === null, settleMs: duration + 500 });
  const phase = group ?? own.phase;
  const shown = useCountUpValue(value, phase, duration);
  const final = format(value);
  return (
    <span ref={own.ref} className={cx('dna-cu', className)} data-cu={phase === 'rest' ? undefined : phase}>
      {phase === 'rest' ? (
        final
      ) : (
        <>
          <span aria-hidden="true">{format(shown)}</span>
          <span className="dna-sr">{final}</span>
        </>
      )}
    </span>
  );
}

/**
 * Plain counts only: "12" or "63%" count up, anything else (ranges, words, Arabic
 * digits, money) is returned exactly as given.
 */
export function DnaCountText({ text, duration, className, playKey }: { text: string; duration?: number; className?: string; playKey?: string }) {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?(%?)$/.exec(text);
  if (!m) return <>{text}</>;
  const dec = m[2] ? m[2].length : 0;
  const suffix = m[3];
  return (
    <DnaCountUp
      value={Number(`${m[1]}${m[2] ? `.${m[2]}` : ''}`)}
      format={(n) => `${n.toFixed(dec)}${suffix}`}
      duration={duration}
      className={className}
      playKey={playKey}
    />
  );
}

/* ----------------------------------------------------------- change mark */

const flashMemory = new Map<string, { v: string; t: number }>();
const REMOUNT_WINDOW_MS = 3000;

/**
 * Counter that increments when `signal` genuinely changes after first paint, and
 * returns to 0 once the highlight is over. A parent that remounts the subtree on
 * each render is covered by a small keyed memory (only for very recent changes).
 */
export function useChangeToken(signal: string | number | null | undefined, memoryKey?: string, holdMs = 1300): number {
  const value = String(signal ?? '');
  const prev = React.useRef<string | null>(null);
  const [state, setState] = React.useState(() => {
    const m = memoryKey ? flashMemory.get(memoryKey) : undefined;
    const recent = !!m && m.v !== value && Date.now() - m.t < REMOUNT_WINDOW_MS && !prefersReducedMotion();
    return { n: recent ? 1 : 0 };
  });
  React.useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (memoryKey) flashMemory.set(memoryKey, { v: value, t: Date.now() });
    if (before === null || before === value || prefersReducedMotion()) return;
    setState((s) => ({ n: (s.n % 1000) + 1 }));
  }, [value, memoryKey]);
  React.useEffect(() => {
    if (!state.n) return;
    const t = setTimeout(() => setState({ n: 0 }), holdMs);
    return () => clearTimeout(t);
  }, [state.n, holdMs]);
  return state.n;
}

/**
 * Decorative overlay for the nearest positioned parent. One soft tint that fades
 * (opacity only); renders nothing at rest and nothing on first render.
 */
export function DnaChangeMark({ signal, memoryKey, className }: { signal: string | number | null | undefined; memoryKey?: string; className?: string }) {
  const n = useChangeToken(signal, memoryKey);
  return n ? <span key={n} className={cx('dna-flashmark', className)} aria-hidden="true" /> : null;
}

/**
 * Keys whose value changed since the previous render (after a short settling
 * window following mount, so a first data load never flashes).
 * Returns key -> token; entries drop out after `holdMs`.
 */
export function useChangedKeys(values: Record<string, string>, holdMs = 1300, graceMs = 800): Record<string, number> {
  const prev = React.useRef<Record<string, string> | null>(null);
  const mountedAt = React.useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  const counter = React.useRef(0);
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [flash, setFlash] = React.useState<Record<string, number>>({});
  const sig = JSON.stringify(values);
  React.useEffect(() => {
    const before = prev.current;
    prev.current = values;
    if (!before || prefersReducedMotion()) return;
    if (performance.now() - mountedAt.current < graceMs) return;
    const changed = Object.keys(values).filter((k) => k in before && before[k] !== values[k]);
    if (!changed.length) return;
    const n = ++counter.current;
    setFlash((f) => ({ ...f, ...Object.fromEntries(changed.map((k) => [k, n])) }));
    timers.current.push(
      setTimeout(() => {
        setFlash((f) => {
          const next = { ...f };
          changed.forEach((k) => {
            if (next[k] === n) delete next[k];
          });
          return next;
        });
      }, holdMs),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return flash;
}
