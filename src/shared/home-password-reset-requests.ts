/** Home belongs to the signed-in teacher, including when that teacher is an admin. */
export function isPendingPasswordReset(request: any, requests: any[], now = Date.now()): boolean {
  if (request?.status !== 'new') return false;
  const expires = Date.parse(String(request.expiresAt || ''));
  if (Number.isFinite(expires) && expires <= now) return false;
  const requested = Date.parse(String(request.requestedAt || ''));
  if (!Number.isFinite(requested)) return true;
  return !requests.some(done => {
    if (done.status !== 'handled' || String(done.studentId || '') !== String(request.studentId || '')) return false;
    const resolved = Date.parse(String(done.usedAt || done.handledAt || ''));
    return Number.isFinite(resolved) && resolved >= requested;
  });
}
export function homePasswordResets(requests: any[], teacherEmail: string, sameIdentity: (a: any, b: any) => boolean, ownsCourse: (request: any) => boolean = () => true, limit = 4): any[] {
  const latest = new Map<string, any>();
  [...requests].sort((a,b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime()).forEach(request => {
    if (!isPendingPasswordReset(request, requests) || !sameIdentity(request.teacherEmail, teacherEmail) || !ownsCourse(request)) return;
    const key = String(request.studentId || request.id || '');
    if (!key) return;
    if (latest.has(key)) {
      const selected = latest.get(key);
      latest.set(key, { ...selected, notificationGroupId: request.id || selected.notificationGroupId || selected.id,
        notificationReadKeys: [...(selected.notificationReadKeys || []), `teacher-reset-${request.id}`, `teacher-reset-${selected.id}`] });
      return;
    }
    latest.set(key, request);
  });
  return [...latest.values()].slice(0, limit);
}
