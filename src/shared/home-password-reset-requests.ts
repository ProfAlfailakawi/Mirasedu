/** Home belongs to the signed-in teacher, including when that teacher is an admin. */
export function homePasswordResets(requests: any[], teacherEmail: string, sameIdentity: (a: any, b: any) => boolean): any[] {
  return requests.filter((request) => request?.status === 'new' && sameIdentity(request.teacherEmail, teacherEmail)).slice(0, 4);
}
