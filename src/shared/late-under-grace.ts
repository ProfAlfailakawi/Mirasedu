/**
 * A submission that reached the teacher after the activity's closing time can only have been
 * accepted because the teacher opened a private window for that student: a project extension
 * or a return exception. A plain late submission (after the due date but before closing) is not
 * one of these. Extension submissions also carry an explicit flag.
 */
export function lateUnderGrace(
  sub: { lateByExtension?: boolean; submittedAt?: any; updatedAt?: any } | null | undefined,
  closeMs: number,
): boolean {
  if (!sub) return false;
  if (sub.lateByExtension === true) return true;
  if (!Number.isFinite(closeMs) || closeMs <= 0) return false;
  const at = Date.parse(String(sub.submittedAt || sub.updatedAt || ""));
  return Number.isFinite(at) && at > closeMs;
}
