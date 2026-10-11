const DAY_MS = 86400000;

/**
 * Whole days left until a deadline given as its end instant (a date-only due date is the end
 * of that Kuwait day, 23:59:59). 0 = it ends today, 1 = tomorrow, negative = already past.
 * Null when there is no usable deadline.
 */
export function daysUntilDeadline(deadlineMs: number, now: number = Date.now()): number | null {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return null;
  return Math.floor((deadlineMs - now) / DAY_MS);
}
