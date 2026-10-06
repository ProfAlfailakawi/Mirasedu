/** All home datasets must arrive from the authenticated server in the same read. */
export function teacherWorkspaceReady(data: any, email: string): boolean {
  return !!email.trim() && data?.success === true &&
    String(data.teacherEmail || "").trim().toLowerCase() === email.trim().toLowerCase() &&
    [data.sections, data.exams, data.projects, data.requests, data.logs,
      data.reports?.students, data.reports?.allowedStudents].every(Array.isArray) &&
    !data.reports?.warning;
}
