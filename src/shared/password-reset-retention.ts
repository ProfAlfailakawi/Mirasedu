/** Keep finished recovery requests for one day after expiry or completion. */
export const PASSWORD_RESET_RETENTION_MS = 24 * 60 * 60 * 1000;

export function shouldRemoveFinishedPasswordReset(request: any, now = Date.now()): boolean {
  const status = String(request?.status || '');
  if (!['new', 'expired', 'handled', 'used', 'cancelled', 'revoked'].includes(status)) return false;
  const expiresAt = Date.parse(String(request.expiresAt || ''));
  const finishedAt = ['new', 'expired'].includes(status)
    ? expiresAt
    : Date.parse(String(request.usedAt || request.handledAt || request.expiresAt || ''));
  return Number.isFinite(finishedAt) && now >= finishedAt + PASSWORD_RESET_RETENTION_MS;
}
