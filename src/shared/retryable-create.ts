export type RetryableCreateAttempt = {
  signature: string;
  id: string;
  busy: boolean;
};

/** Reuse the same server id after ambiguous network/durability failures. */
export function retryableCreateAttempt(
  current: RetryableCreateAttempt | null,
  signature: string,
  prefix: string,
  createNonce: () => string,
): RetryableCreateAttempt {
  if (current?.signature === signature) return current;
  return { signature, id: `${prefix}-${createNonce()}`, busy: false };
}
