/** Read-only indicator; activation and access rules remain on the server. */
export function countActivatedCourseStudents(
  students: any[], courseCode: string, matches: (a: any, b: any) => boolean,
): number {
  const ids = new Set<string>();
  for (const student of Array.isArray(students) ? students : []) {
    const id = String(student?.id || student?.idNumber || student?.studentId || '').trim();
    if (!id) continue;
    if ((Array.isArray(student.removedCourseLinks) ? student.removedCourseLinks : []).some((link: any) => link && !link.restoredAt && link.status !== 'restored' && matches(link.courseCode || link.sectionCode, courseCode))) continue;
    const explicit = (Array.isArray(student.activatedCourseCodes) ? student.activatedCourseCodes : []).some((code: any) => matches(code, courseCode));
    const enrolled = (Array.isArray(student.enrollments) ? student.enrollments : []).some((entry: any) =>
      entry && matches(entry.courseCode || entry.sectionCode, courseCode) &&
      !entry.pendingActivation && !entry.requiresJoinCode && !entry.rosterOnly &&
      !['pending_activation','roster_only','removed','not_enrolled'].includes(String(entry.enrollmentState || entry.status || '').toLowerCase()) &&
      (entry.isActive === true || entry.enrollmentState === 'active' || !!entry.activatedAt || !!entry.reactivatedAt),
    );
    if (explicit || enrolled) ids.add(id);
  }
  return ids.size;
}
