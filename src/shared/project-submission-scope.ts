import { sameTeacherIdentity } from "./teacher-account-scope";

/** Personal grading attention spans the teacher's courses, including for admins. */
export function teacherOwnsProjectSubmission(
  submission: any,
  project: any,
  teacherEmail: string,
  courseOwner: (code: string) => string,
): boolean {
  if (String(submission?.kind || "").toLowerCase() !== "project") return false;
  const course = String(
    project?.courseCode || project?.sectionCode ||
    submission?.courseCode || submission?.sectionCode || submission?.studentSection || "",
  ).trim();
  const owner = course
    ? courseOwner(course)
    : project?.createdBy || project?.ownerEmail || project?.teacherEmail;
  return sameTeacherIdentity(owner, teacherEmail);
}
