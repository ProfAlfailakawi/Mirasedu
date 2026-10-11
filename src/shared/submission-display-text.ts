/** The text a teacher sees as "the student's written answer" in the solution view. */
const ATTACHMENT_ONLY_PLACEHOLDER = /^تم تسليم المشروع بمرفق/;

export function studentSubmissionDisplayText(
  sub: any,
  formatStructuredAnswers: (sub: any) => string,
): string {
  if (!sub) return "";
  const isExam = ["exam", "quiz"].includes(String(sub.kind || "").toLowerCase());
  const hasStructuredAnswers =
    (Array.isArray(sub.matchedQuestions) && sub.matchedQuestions.length > 0) ||
    (sub.answers && typeof sub.answers === "object" && Object.keys(sub.answers).length > 0);
  if (hasStructuredAnswers) return formatStructuredAnswers(sub);
  // An exam without answers carries a system message in answerText (entered/left...), not an answer.
  if (isExam) return "";
  // After a teacher return, answerText holds a system message and the student's original
  // answer is kept in previousAnswerText; skip the message and read the preserved answer.
  const isReturnNotice = (value: string) => /^تم إرجاع النشاط للطالب/.test(value);
  const raw =
    [sub.answerText, sub.submissionText, sub.previousAnswerText, sub.studentSolutionText, sub.text]
      .map((value: any) => String(value || "").trim())
      .find((value: string) => !!value && !isReturnNotice(value)) || "";
  // Phrases the app writes itself when a student submits files with no text.
  if (ATTACHMENT_ONLY_PLACEHOLDER.test(raw) || raw === "تم تسليم المشروع بنجاح") return "";
  return raw;
}
