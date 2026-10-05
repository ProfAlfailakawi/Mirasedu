/** Session metadata only; this does not authenticate or grant device access. */
export function studentSessionIssuedAt(token: string): number {
  try {
    const payload = String(token || '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const value = Number(JSON.parse(atob(payload)).issuedAt);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

/** A delayed message from the previous session must not dismiss a new login. */
export function shouldApplyStudentLockSignal(signal: any, activeToken: string): boolean {
  const activeIssuedAt = studentSessionIssuedAt(activeToken);
  if (!activeIssuedAt) return true;
  const signalIssuedAt = Number(signal?.sessionIssuedAt || 0);
  if (signalIssuedAt > 0) return signalIssuedAt === activeIssuedAt;
  const sentAt = Number(signal?.at || 0);
  return !sentAt || sentAt >= activeIssuedAt;
}
