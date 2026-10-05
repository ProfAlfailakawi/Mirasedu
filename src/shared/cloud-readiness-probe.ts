/** Race read-only cloud checks; an HTTP success is required, never a cached flag. */
export async function probeCloudReadiness(
  request: typeof fetch,
  urls: string[],
  timeoutMs = 8000,
): Promise<boolean> {
  const controllers = urls.map(() => new AbortController());
  const timers: ReturnType<typeof setTimeout>[] = [];
  try {
    await Promise.any(urls.map(async (url, index) => {
      const controller = controllers[index];
      timers.push(setTimeout(() => controller.abort(), timeoutMs));
      const response = await request(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('cloud-not-ready');
      const data = await response.json();
      if (data?.ok !== true || data?.hasData !== true) throw new Error('cloud-not-ready');
    }));
    return true;
  } catch { return false; }
  finally {
    timers.forEach(clearTimeout);
    controllers.forEach(controller => controller.abort());
  }
}
