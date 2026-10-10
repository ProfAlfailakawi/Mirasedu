/*
 * One-time "stations light up one after another" intro for <DnaStepper reveal>.
 * Returns `lit`: how many stations are shown so far, or null once settled
 * (render the real states). Plays once per mount (and once per `playKey`),
 * never replays on data re-renders, and is skipped for reduced motion.
 *
 * Safety: the real state is never hidden indefinitely. The intro is only armed
 * when the element is measurable, the observer threshold is clamped to what the
 * viewport can actually reach, and the ticker always converges to `lit = null`
 * even when `target` grows (e.g. submitted -> graded) while it is running.
 */
import * as React from 'react';
import { journeyAlreadyPlayed, journeyMarkPlayed } from './journeyReveal';

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;
const SETTLE_MS = 1600; // lets the one-shot halo finish before data-just is removed

export interface JourneyRevealOptions {
  target: number;
  stepMs: number;
  threshold?: number;
  enabled?: boolean;
  /** Keep the intro waiting (stations unlit once seen) until false. */
  hold?: boolean;
  playKey?: string;
}

export function useJourneyReveal<T extends HTMLElement = HTMLOListElement>({
  target,
  stepMs,
  threshold = 0.5,
  enabled = true,
  hold = false,
  playKey,
}: JourneyRevealOptions) {
  const ref = React.useRef<T>(null);
  const [lit, setLit] = React.useState<number | null>(null);
  const [started, setStarted] = React.useState(false);
  const armed = React.useRef(false);
  const hasTarget = target > 0;

  // arm on the 0 -> >0 target transition (async data), once per mount / playKey
  useIsoLayoutEffect(() => {
    if (armed.current || !enabled || !hasTarget) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (journeyAlreadyPlayed(playKey)) return;
    const h = el.getBoundingClientRect().height;
    if (!(h > 0)) return; // not measurable yet: keep showing the real state
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const eff = Math.max(0.1, Math.min(threshold, vh > 0 ? (0.9 * vh) / h : threshold));
    armed.current = true;
    setLit(0); // before first paint: no flash of the final state
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= eff - 0.01)) return;
        io.disconnect();
        journeyMarkPlayed(playKey);
        setStarted(true);
      },
      { threshold: [eff] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      armed.current = false;
      setStarted(false);
      setLit(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasTarget, playKey]);

  // ticker: always converges to lit = null, whatever `target` does meanwhile
  React.useEffect(() => {
    if (!started || lit === null || hold) return;
    const wait = lit < target ? (lit === 0 ? 0 : stepMs) : SETTLE_MS;
    const t = setTimeout(() => setLit(lit < target ? lit + 1 : null), wait);
    return () => clearTimeout(t);
  }, [started, lit, target, hold, stepMs]);

  return { ref, lit };
}
