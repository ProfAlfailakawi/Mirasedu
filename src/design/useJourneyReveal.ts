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
import { journeyAlreadyPlayed, journeyIsCovered, journeyMarkPlayed } from './journeyReveal';

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;
const SETTLE_MS = 1600; // lets the one-shot halo finish before data-just is removed
const COVER_POLL_MS = 250; // re-check while a full-screen overlay covers the stepper
const COVER_GIVE_UP_MS = 20000; // then just show the real state (never stay unlit)

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
    let poll: ReturnType<typeof setInterval> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const stopWaiting = () => {
      if (poll) clearInterval(poll);
      if (giveUp) clearTimeout(giveUp);
      poll = giveUp = undefined;
    };
    const visibleEnough = () => {
      const r = el.getBoundingClientRect();
      const vhh = window.innerHeight || document.documentElement.clientHeight || 0;
      const seen = Math.min(r.bottom, vhh) - Math.max(r.top, 0);
      return r.height > 0 && seen / r.height >= eff - 0.01;
    };
    const play = () => {
      stopWaiting();
      io.disconnect();
      journeyMarkPlayed(playKey);
      setStarted(true);
    };
    // Seen, but a modal / tour overlay may be covering it: the intro would be
    // used up unseen. Wait until it is uncovered (bounded), then play.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= eff - 0.01)) return;
        if (!journeyIsCovered(el)) return play();
        if (poll) return;
        poll = setInterval(() => {
          if (visibleEnough() && !journeyIsCovered(el)) play();
        }, COVER_POLL_MS);
        giveUp = setTimeout(() => {
          stopWaiting();
          io.disconnect();
          setLit(null); // show the real state; the intro is not consumed
        }, COVER_GIVE_UP_MS);
      },
      { threshold: [eff] },
    );
    io.observe(el);
    return () => {
      stopWaiting();
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
