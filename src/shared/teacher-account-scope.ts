/** Compare account identities without granting administrators an identity bypass. */
export function sameTeacherIdentity(a: any, b: any): boolean {
  const left = String(a || "").trim().toLowerCase();
  const right = String(b || "").trim().toLowerCase();
  return Boolean(left && right && left === right);
}
