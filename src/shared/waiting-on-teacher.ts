import { normalizeArabicIndicDigits } from "./arabic-text";
import { notSubmittedListOpen } from "./not-submitted-gate";

const key = (value: any) => normalizeArabicIndicDigits(String(value ?? "")).trim().toLowerCase();

/**
 * Students the teacher can act on from the activity list: registered in Miras, nothing submitted
 * for the activity, no extension still running, and only once the original deadline has passed
 * (before it they are simply still working). Returns the number of such students.
 */
export function studentsWaitingOnTeacher(input: {
  roster: any[];
  submittedStudentIds: Iterable<any>;
  extensions?: any;
  originalDeadlineMs: number;
  now?: number;
}): number {
  const now = input.now ?? Date.now();
  if (!notSubmittedListOpen(input.originalDeadlineMs, now)) return 0;
  const submitted = new Set<string>();
  for (const id of input.submittedStudentIds) {
    const k = key(id);
    if (k) submitted.add(k);
  }
  const extended = new Set<string>();
  (Array.isArray(input.extensions) ? input.extensions : []).forEach((entry: any) => {
    const until = Date.parse(String(entry?.until || ""));
    const k = key(entry?.studentId);
    if (k && Number.isFinite(until) && until > now) extended.add(k);
  });
  const counted = new Set<string>();
  (Array.isArray(input.roster) ? input.roster : []).forEach((row: any) => {
    if (row?.registered === false) return;
    const k = key(row?.id ?? row?.idNumber);
    if (!k || submitted.has(k) || extended.has(k)) return;
    counted.add(k);
  });
  return counted.size;
}
