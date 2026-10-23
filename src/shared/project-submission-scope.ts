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

const eventMs = (value: any) => new Date(value || 0).getTime() || 0;

/**
 * Does this submission carry something the teacher has not seen yet?
 * A real hand-in (submittedAt/resubmittedAt) or an integrity alert
 * (cheating, forced exit, violation, withdrawal) newer than `seenAt`.
 * Teacher-side edits (grading, returning) never count as news, and an
 * exam still in progress is not a hand-in yet.
 */
export function isFreshSubmissionNews(
  submission: any,
  seenAt: number,
  state: { returned: boolean; inProgress: boolean; alert: boolean },
): boolean {
  if (!seenAt || state.returned || state.inProgress) return false;
  const submitted = Math.max(eventMs(submission?.submittedAt), eventMs(submission?.resubmittedAt));
  const flagged =
    state.alert || !!(submission?.isCheating || submission?.isForcedExit || submission?.hasViolation);
  const at = flagged
    ? Math.max(submitted, eventMs(submission?.updatedAt), eventMs(submission?.createdAt))
    : submitted;
  return at > seenAt;
}

/** Exam hand-ins belong to the owner of the course they were taken in. */
export function teacherOwnsSubmissionCourse(
  submission: any,
  teacherEmail: string,
  courseOwner: (code: string) => string,
): boolean {
  const course = String(
    submission?.courseCode || submission?.sectionCode || submission?.studentSection || "",
  ).trim();
  return !course || sameTeacherIdentity(courseOwner(course), teacherEmail);
}
