/** Share only a running cloud read. Never retain a successful or failed result. */
export function createCloudSingleFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return {
    run(key: string, read: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing;
      const request = Promise.resolve().then(read).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
  };
}

export const cloudSessionKey = (identity: string, token: string, generation: number) =>
  JSON.stringify([identity, token, generation]);
