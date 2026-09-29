// General sale codes are inventory, independent of a course/semester reset.
const RESET_REASONS = new Set([
  "course_closed_full_reset",
  "course_closed_custom_reset",
]);

function isUnusedGeneralCode(code: any): boolean {
  const courses = [code?.sectionCode, code?.courseCode, code?.studentSection];
  return Boolean(
    code?.code &&
    courses.some((value) => String(value || "").trim().toLowerCase() === "all") &&
    courses.every((value) => !value || String(value).trim().toLowerCase() === "all") &&
    ![
      "studentId", "assignedStudentId", "usedByStudentId", "activatedAt", "usedAt",
      "resolvedCourseCode", "activatedCourseCode", "activationDeviceToken",
      "activationDeviceFingerprint", "activationDeviceServerHash", "replacedBy",
      "deletedAt", "revokedAt", "deleted", "isDeleted", "archived", "isArchived",
    ].some((key) => code[key]),
  );
}

export function preserveGeneralCodeOnReset(code: any): boolean {
  return isUnusedGeneralCode(code) && code.status === "active" &&
    !code.archivedAt && !code.retiredAt && !code.retiredReason;
}

// Only undo the automatic retirement of unused general inventory. Manual
// deletion, revocation, course-specific and consumed codes remain retired.
export function recoverResetGeneralCode(code: any): any | null {
  if (!isUnusedGeneralCode(code) || code.status !== "retired" ||
      !RESET_REASONS.has(code.retiredReason)) return null;
  const { retiredAt, retiredReason, retiredByEmail, archivedAt, ...rest } = code;
  return {
    ...rest,
    status: "active",
    recoveredFromResetAt: retiredAt || archivedAt,
    recoveredFromResetReason: retiredReason,
  };
}
