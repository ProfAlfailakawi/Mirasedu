const text = (value: any) => String(value || '').replace(/\s+/g, ' ').trim();

/** Teacher and admin are the same personal inbox and delivery identity. */
export function notificationRole(value: any): string {
  const role = text(value).toLowerCase();
  if (['teacher', 'admin', 'superadmin', 'super_admin'].includes(role)) return 'teacher';
  return role === 'students' ? 'student' : role;
}

export function notificationEventIdentity(note: any): string {
  return text(note?.notificationId || note?.data?.notificationId);
}

export function notificationIdentity(note: any): string {
  const data = note?.data || {};
  const event = note?.eventId || note?.examId || note?.activityId || data.eventId || data.examId || data.activityId;
  const version = note?.updatedAt || data.updatedAt || note?.createdAt || '';
  return notificationEventIdentity(note) || text(note?.id) ||
    (event ? `calendar:${note?.type || data.type || 'event'}:${event}:${version}` : `${note?.title || 'مِراس'}:${note?.body || note?.message || ''}:${version}`);
}

/** A teacher's account is the recipient; the student and code identify the event. */
export function notificationSignature(note: any): string {
  const data = note?.data || {};
  const role = notificationRole(note?.role || note?.targetRole || data.role || data.targetRole || 'student');
  const recipient = text(note?.userId || data.userId || note?.teacherEmail || data.teacherEmail).toLowerCase();
  const event = notificationEventIdentity(note);
  if (event) return JSON.stringify([role, recipient, event]);
  return JSON.stringify([
    role, recipient, text(note?.studentId || data.studentId || recipient).toLowerCase(),
    text(note?.courseCode || note?.sectionCode || data.courseCode || data.sectionCode).toLowerCase(),
    text(note?.type || data.type || 'course').toLowerCase(), text(note?.kind || data.kind).toLowerCase(),
    text(note?.code || data.code).replace(/[^a-z0-9]/gi, '').toUpperCase(),
    text(note?.eventId || note?.examId || note?.activityId || data.eventId || data.examId || data.activityId),
    text(note?.title || 'مِراس'), text(note?.body || note?.message),
  ]);
}
