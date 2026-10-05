/** Notification scope follows the signed-in teacher, never the admin audit selector. */
export function teacherOwnsNotification(item: any, teacherEmail: string, courseOwner: (code: string) => string, sameIdentity: (a: any, b: any) => boolean): boolean {
  const data = item?.data || {};
  const course = item?.sectionCode || item?.courseCode || item?.studentSection || data.sectionCode || data.courseCode;
  if (course) return sameIdentity(courseOwner(String(course)), teacherEmail);
  const owner = item?.teacherEmail || item?.ownerEmail || item?.actorEmail || data.teacherEmail || data.ownerEmail;
  return !!owner && sameIdentity(owner, teacherEmail);
}

/** Keep one representation only when both sources identify the same code event. */
export function duplicatesCodeIntegrityLog(note: any, logs: any[], timeValue: (item: any) => number): boolean {
  const data = note?.data || {};
  if (String(note?.type || data.type || '') !== 'code_integrity') return false;
  const student = String(note?.studentId || data.studentId || '');
  const code = String(note?.code || data.code || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!student || !code) return false;
  return logs.some(log => {
    const logCode = String(log.code || String(log.details || '').match(/الرمز:\s*(LAB-[A-Z0-9-]+)/i)?.[1] || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    return log.action === 'محاولة كود مرفوضة' && String(log.studentId || '') === student && logCode === code &&
      timeValue(log) > 0 && timeValue(note) > 0 && Math.abs(timeValue(log) - timeValue(note)) <= 15000;
  });
}
