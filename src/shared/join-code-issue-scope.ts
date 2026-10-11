/**
 * Whose courses the «مقرر إصدار الرمز» picker lists. «كل الحسابات» (and «حسابي») show the
 * signed-in teacher's own sections only; picking another account lists that account's sections.
 */
export function joinCodeIssueScopeEmail(auditScopeEmail: string, ownEmail: string): string {
  const scope = String(auditScopeEmail || "all").trim();
  return scope === "all" || scope === "self" || !scope ? String(ownEmail || "") : scope;
}
