/**
 * «لم يسلّم» is only meaningful once the activity's original deadline has passed: before that,
 * students who have not submitted are simply still working. An activity with no usable deadline
 * keeps showing the list.
 */
export function notSubmittedListOpen(originalDeadlineMs: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(originalDeadlineMs) || originalDeadlineMs <= 0) return true;
  return now > originalDeadlineMs;
}
