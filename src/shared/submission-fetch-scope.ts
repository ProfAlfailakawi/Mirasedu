export function shouldApplySubmissionCourseResponse(
  requestedCourse: string,
  currentCourse: string,
  coursesMatch: (requested: string, current: string) => boolean,
): boolean {
  return !requestedCourse || !currentCourse || coursesMatch(requestedCourse, currentCourse);
}
