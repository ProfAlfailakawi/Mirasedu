/**
 * Students who tried to submit a project after it closed. The server keeps one entry per
 * student on the project; the teacher sees them on the activity card and can open a window
 * (extension) for them.
 */
export type LateAttempt = { studentId: string; studentName: string; firstAt: string; lastAt: string; count: number };

export const MAX_LATE_ATTEMPTS = 300;

/** Same canonical form the server uses for student ids (Arabic digits converted, formatting dropped). */
export function attemptStudentId(value: any): string {
  return String(value ?? "")
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[^0-9]/g, "");
}

/**
 * Adds or refreshes a student's entry. Returns null when nothing should be written: no usable id,
 * or the same student tried again within `throttleMs` (a double tap must not rewrite the project).
 */
export function recordLateAttempt(
  existing: any,
  student: { id: any; name?: any },
  nowMs: number = Date.now(),
  throttleMs: number = 60_000,
): LateAttempt[] | null {
  const id = attemptStudentId(student?.id);
  if (!id) return null;
  const list: LateAttempt[] = Array.isArray(existing) ? existing : [];
  const prev = list.find((item) => attemptStudentId(item?.studentId) === id);
  const prevAt = prev ? Date.parse(String(prev.lastAt || "")) : NaN;
  if (prev && Number.isFinite(prevAt) && nowMs - prevAt < throttleMs) return null;
  const nowIso = new Date(nowMs).toISOString();
  const entry: LateAttempt = {
    studentId: id,
    studentName: String(student?.name || "").trim() || id,
    firstAt: prev?.firstAt || nowIso,
    lastAt: nowIso,
    count: (Number(prev?.count) || 0) + 1,
  };
  return [...list.filter((item) => attemptStudentId(item?.studentId) !== id), entry].slice(-MAX_LATE_ATTEMPTS);
}
