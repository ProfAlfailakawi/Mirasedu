/**
 * Students the teacher gave a private extension (still running) who have not submitted yet.
 * Matches ids case-insensitively and counts each student once.
 */
export function extensionsStillWaiting(
  extensions: any,
  submittedStudentIds: Iterable<any>,
  now: number = Date.now(),
): number {
  const submitted = new Set<string>();
  for (const id of submittedStudentIds) submitted.add(String(id ?? "").trim().toLowerCase());
  const waiting = new Set<string>();
  (Array.isArray(extensions) ? extensions : []).forEach((entry: any) => {
    const id = String(entry?.studentId ?? "").trim().toLowerCase();
    const until = Date.parse(String(entry?.until || ""));
    if (!id || !Number.isFinite(until) || until <= now || submitted.has(id)) return;
    waiting.add(id);
  });
  return waiting.size;
}
