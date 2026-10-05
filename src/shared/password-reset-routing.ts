// Resolve personal reset routing without a first-section or administrator fallback.
export function resolvePasswordResetRoute(student: any, allowed: any[], sections: any[], codes: any[], display: (code: string) => string) {
  const clean = (v: any) => String(v || '').trim().toLowerCase();
  const raw = String(student?.sectionCode || allowed[0]?.sectionCode || '').trim();
  const exact = (course: any) => {
    const code = String(course || '').trim();
    const section = sections.find(s => clean(s.code) === clean(code));
    const embedded = code.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
    const owner = clean(section?.ownerEmail || embedded);
    return owner ? { sectionCode: code, teacherEmail: owner } : undefined;
  };
  const primary = exact(raw);
  if (primary) return primary;
  const compact = (v: any) => clean(v).replace(/[^a-z0-9]/g, '');
  const activation = compact(student?.activationCode);
  const activated = activation ? codes.find(c => compact(c.code) === activation) : undefined;
  const activatedCourse = activated?.studentSection || activated?.sectionCode || activated?.courseCode;
  const bound = exact(activatedCourse);
  if (bound) return bound;
  const candidates: { sectionCode: string; teacherEmail: string }[] = [];
  for (const item of [...(student?.enrollments || []), ...allowed]) {
    if (['removed', 'deleted', 'blocked'].includes(clean(item.status))) continue;
    const course = String(item.courseCode || item.sectionCode || item.studentSection || '').trim();
    if (!course || (raw && display(course) !== display(raw))) continue;
    const route = exact(course);
    const owner = clean(item.teacherEmail || item.ownerEmail);
    if (route) candidates.push(route);
    else if (owner) candidates.push({ sectionCode: course, teacherEmail: owner });
  }
  if (!candidates.length) {
    for (const section of sections) {
      if (raw && display(String(section.code)) === display(raw)) {
        const route = exact(section.code);
        if (route) candidates.push(route);
      }
    }
  }
  const owners = new Set(candidates.map(c => c.teacherEmail));
  return owners.size === 1 ? candidates[0] : { sectionCode: raw, teacherEmail: '' };
}

export function passwordResetDeletionIds(records: any[], selected: any) {
  const cutoff = Date.parse(selected.requestedAt);
  return records.filter(item => item.id === selected.id || (
    item.status === 'new' && selected.status === 'new' &&
    item.studentId === selected.studentId &&
    String(item.teacherEmail || '').toLowerCase() === String(selected.teacherEmail || '').toLowerCase() &&
    item.sectionCode === selected.sectionCode &&
    Number.isFinite(cutoff) && Date.parse(item.requestedAt) <= cutoff
  )).map(item => String(item.id));
}
