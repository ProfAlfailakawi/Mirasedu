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

/**
 * Students the teacher opened the door for (a running extension) who have not submitted yet.
 * They are expected work, so the activity ring counts them in its denominator until they submit.
 * Ids are compared in the server's canonical digits-only form, one count per student. When a
 * roster is given, only current course members count: a student removed from the course can no
 * longer submit, so a leftover extension must not inflate the denominator.
 */
export function studentsExpectedByExtension(
  extensions: any,
  submittedStudentIds: Iterable<any>,
  now: number = Date.now(),
  roster?: any[],
): number {
  const canonical = (value: any) =>
    normalizeArabicIndicDigits(String(value ?? "")).replace(/[^0-9]/g, "");
  const submitted = new Set<string>();
  for (const id of submittedStudentIds) {
    const k = canonical(id);
    if (k) submitted.add(k);
  }
  const members = roster
    ? new Set((Array.isArray(roster) ? roster : []).map((row: any) => canonical(row?.id ?? row?.idNumber)).filter(Boolean))
    : null;
  const expected = new Set<string>();
  (Array.isArray(extensions) ? extensions : []).forEach((entry: any) => {
    const until = Date.parse(String(entry?.until || ""));
    const k = canonical(entry?.studentId);
    if (!k || !Number.isFinite(until) || until <= now || submitted.has(k)) return;
    if (members && !members.has(k)) return;
    expected.add(k);
  });
  return expected.size;
}
