export type BulkGradeCandidate = {
  id: string;
  hasWork: boolean;
  hasGrade: boolean;
  inProgress: boolean;
  cheating: boolean;
  returned: boolean;
};

/** Select completed work that still needs grading; an explicit return reopens it. */
export function ungradedAttemptIds(rows: BulkGradeCandidate[]): string[] {
  return rows
    .filter((row) => row.id && row.hasWork && !row.inProgress && !row.cheating &&
      (row.returned || !row.hasGrade))
    .map((row) => row.id);
}

export function gradeActivityColumnTitle(kind: string, title: string): string {
  return kind === "exam" ? `اختبار: ${title}` : title;
}
