/** Home belongs to the signed-in teacher, including when that teacher is an admin. */
export function homePasswordResets(requests: any[], teacherEmail: string, sameIdentity: (a: any, b: any) => boolean, ownsCourse: (request: any) => boolean = () => true): any[] {
  const latest = new Map<string, any>();
  [...requests].sort((a,b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime()).forEach(request => {
    if (request?.status !== 'new' || !sameIdentity(request.teacherEmail, teacherEmail) || !ownsCourse(request)) return;
    if (request.expiresAt && new Date(request.expiresAt).getTime() <= Date.now()) return;
    const key = String(request.studentId || request.id || '');
    if (!key || latest.has(key)) return;
    latest.set(key, request);
  });
  return [...latest.values()].slice(0, 4);
}
