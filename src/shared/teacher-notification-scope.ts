import { isPendingPasswordReset } from './home-password-reset-requests';

/** Notification scope follows the signed-in teacher, never the admin audit selector. */
export function teacherOwnsNotification(item: any, teacherEmail: string, courseOwner: (code: string) => string, sameIdentity: (a: any, b: any) => boolean): boolean {
  const data = item?.data || {};
  if (['student', 'students'].includes(String(item?.role || item?.targetRole || data.role || data.targetRole || '').toLowerCase())) return false;
  const recipient = item?.userId || data.userId;
  if (recipient && !sameIdentity(recipient, teacherEmail)) return false;
  const course = item?.targetSectionCode || item?.linkedSectionCode || item?.sectionCode || item?.courseCode || item?.studentSection || data.sectionCode || data.courseCode;
  if (course) return sameIdentity(courseOwner(String(course)), teacherEmail);
  const owner = item?.teacherEmail || item?.ownerEmail || data.teacherEmail || data.ownerEmail || item?.actorEmail || item?.userId || data.userId;
  return !!owner && sameIdentity(owner, teacherEmail);
}

/** Completed and expired recovery requests remain in the audit, not the bell. */
export function currentPasswordResetNotification(note: any, requests: any[], now = Date.now()): boolean {
  const data = note?.data || {};
  if (!['password_reset', 'password_reset_resend'].includes(String(note?.type || data.type || '').toLowerCase())) return true;
  const student = String(note?.studentId || data.studentId || '');
  const requestId = String(note?.requestId || data.requestId || '');
  const at = Date.parse(String(note?.createdAt || data.sentAt || note?.timestamp || ''));
  return requests.some(request => {
    if (!isPendingPasswordReset(request, requests, now) || String(request.studentId || '') !== student) return false;
    if (requestId) return String(request.id) === requestId;
    const requested = Date.parse(String(request.requestedAt || ''));
    return Number.isFinite(at) && Number.isFinite(requested) && at >= requested - 15000;
  });
}

/** Ordinary device audit entries are represented by their security alert only. */
export function pendingDeviceApprovalNotifications(attempts: any[]): any[] {
  const pending = new Map<string, any>();
  for (const attempt of [...attempts].sort((a, b) => Date.parse(b.approvalRequestedAt || b.timestamp || '') - Date.parse(a.approvalRequestedAt || a.timestamp || ''))) {
    if (attempt.approvalRequestType !== 'second_hand_device' || String(attempt.approvalStatus || 'pending') !== 'pending') continue;
    const student = String(attempt.targetStudentId || attempt.studentId || attempt.linkedStudentId || '');
    const course = String(attempt.targetSectionCode || attempt.linkedSectionCode || attempt.sectionCode || '').toLowerCase();
    const key = student && course ? JSON.stringify([student, course]) : String(attempt.id || '');
    if (key && !pending.has(key)) pending.set(key, attempt);
  }
  return [...pending.values()];
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
