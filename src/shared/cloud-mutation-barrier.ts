/** Wait for this mutation to be committed, rather than for all later traffic to stop. */
export async function waitForCloudMutation(
  version: number,
  sync: {
    committedVersion: () => number;
    flush: () => void;
    activeWrite: () => Promise<void> | null;
  },
  timeoutMs = 6000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sync.committedVersion() >= version) return;
    sync.flush();
    const active = sync.activeWrite();
    if (!active) throw new Error('Cloud mutation has not been committed.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        active,
        new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(200, Math.max(1, deadline - Date.now()))); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (sync.committedVersion() >= version) return;
  throw new Error('Cloud mutation confirmation timed out.');
}
