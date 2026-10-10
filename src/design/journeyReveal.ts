/*
 * Pure helpers for the journey-stepper intro (no React, no DOM) so the rules
 * can be unit-tested. The step `state` handed to <DnaStepper> is always the
 * truth; these helpers only decide how many of the already-true stations are
 * shown so far while the one-time intro plays.
 */
import type { DnaStep, DnaStepState } from './DnaKit';

/** Number of stations that are really lit: index of the last done/current + 1. */
export function journeyTarget(steps: ReadonlyArray<Pick<DnaStep, 'state'>>): number {
  let target = 0;
  steps.forEach((s, i) => {
    if (s.state === 'done' || s.state === 'current') target = i + 1;
  });
  return target;
}

/** ~0.55-0.75s per station, whole intro capped near 4.5s. */
export function journeyStepMs(count: number): number {
  const n = Math.max(1, count);
  return Math.min(750, Math.max(350, Math.round(4000 / n)));
}

/**
 * State to display for station `i` while `lit` stations are revealed.
 * `lit === null` means settled: show the real state. A returned/blocked
 * station is never filled; it simply appears once the station before it lit.
 */
export function journeyDisplayState(real: DnaStepState, i: number, lit: number | null): DnaStepState {
  if (lit === null) return real;
  if (real === 'returned' || real === 'blocked') return i <= lit ? real : 'pending';
  return i < lit ? real : 'pending';
}

const played = new Set<string>();
const STORE = 'journey-played:';

export function journeyAlreadyPlayed(playKey?: string): boolean {
  if (!playKey) return false;
  if (played.has(playKey)) return true;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(STORE + playKey)) {
      played.add(playKey);
      return true;
    }
  } catch {
    /* storage may be blocked */
  }
  return false;
}

export function journeyMarkPlayed(playKey?: string): void {
  if (!playKey) return;
  played.add(playKey);
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORE + playKey, '1');
  } catch {
    /* storage may be blocked */
  }
}

/** Test hook. */
export function journeyResetPlayed(): void {
  played.clear();
}

/**
 * Stepper props for a student submission card: one intro per submission id,
 * and never any motion while the exam is still being taken.
 */
export function submissionJourneyProps(sub: { id?: unknown } | null | undefined, inProgress: boolean) {
  const id = sub?.id == null ? '' : String(sub.id);
  return { reveal: !inProgress, still: inProgress, playKey: id ? `submission:${id}` : undefined };
}
