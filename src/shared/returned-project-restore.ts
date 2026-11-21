/**
 * When a teacher returns a project, the student must get their own submission
 * back to edit — not an empty form. The server keeps the original text in
 * `previousAnswerText` (it overwrites `answerText` with a system notice) and
 * leaves `attachments` untouched; this derives the draft to restore.
 */
const SYSTEM_PLACEHOLDERS = [
  "تم إرجاع النشاط للطالب",
  "تم تسليم المشروع بمرفقات ومستندات مفصلة",
  "تم تسليم المشروع بمرفقات",
  "تم تسليم المشروع بنجاح",
];

const isSystemText = (text: string) =>
  !text || SYSTEM_PLACEHOLDERS.some((p) => text.startsWith(p));

export type ReturnedProjectDraft = {
  /** Changes per return event, so each return restores exactly once. */
  key: string;
  text: string;
  attachments: any[];
};

export function returnedProjectDraft(
  projectId: unknown,
  prior: any,
): ReturnedProjectDraft | null {
  if (!prior) return null;
  const returned = !!prior.returnedAt || /معاد/.test(String(prior.status || ""));
  if (!returned) return null;
  const previous = String(prior.previousAnswerText || "").trim();
  const current = String(prior.answerText || "").trim();
  const text = !isSystemText(previous) ? previous : !isSystemText(current) ? current : "";
  const attachments = Array.isArray(prior.attachments) ? prior.attachments.filter(Boolean) : [];
  if (!text && attachments.length === 0) return null;
  return {
    key: `${projectId}:${prior.returnedAt || prior.updatedAt || prior.id || ""}`,
    text,
    attachments,
  };
}
