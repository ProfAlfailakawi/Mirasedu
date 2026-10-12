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

/** Students activated in at least one of the given courses, each counted once. */
export function countActivatedAcrossCourses(
  students: any[], courseCodes: string[], matches: (a: any, b: any) => boolean,
): number {
  const ids = new Set<string>();
  for (const student of Array.isArray(students) ? students : []) {
    const id = String(student?.id || student?.idNumber || student?.studentId || '').trim();
    if (!id) continue;
    if ((Array.isArray(courseCodes) ? courseCodes : []).some((code) => countActivatedCourseStudents([student], code, matches) > 0)) ids.add(id);
  }
  return ids.size;
}

export type SectionActivationRow = { code: string; name: string; activated: number; total: number };

/**
 * Activated students per section out of that section's roster, plus the same totals across all
 * the sections (each student once). A section's total is its roster (names list plus known
 * members) and never below its activated count.
 */
export function summarizeSectionActivation(input: {
  sections: Array<{ code: string; name?: string }>;
  students: any[];
  rosterEntries: Array<{ id: any; sectionCode: any }>;
  matches: (a: any, b: any) => boolean;
  belongs: (student: any, courseCode: string) => boolean;
}): { rows: SectionActivationRow[]; activatedAll: number; totalAll: number } {
  const idOf = (value: any) => String(value ?? '').trim();
  const students = Array.isArray(input.students) ? input.students : [];
  const rosterEntries = Array.isArray(input.rosterEntries) ? input.rosterEntries : [];
  const everyone = new Set<string>();
  const rows = (Array.isArray(input.sections) ? input.sections : []).map((sec) => {
    const ids = new Set<string>();
    rosterEntries.forEach((entry) => {
      const id = idOf(entry?.id);
      if (id && input.matches(entry?.sectionCode, sec.code)) ids.add(id);
    });
    students.forEach((student) => {
      const id = idOf(student?.id || student?.idNumber || student?.studentId);
      if (id && input.belongs(student, sec.code)) ids.add(id);
    });
    const activated = countActivatedCourseStudents(students, sec.code, input.matches);
    ids.forEach((id) => everyone.add(id));
    return { code: sec.code, name: String(sec.name || sec.code), activated, total: Math.max(ids.size, activated) };
  });
  const activatedAll = countActivatedAcrossCourses(students, rows.map((row) => row.code), input.matches);
  return { rows, activatedAll, totalAll: Math.max(everyone.size, activatedAll) };
}
