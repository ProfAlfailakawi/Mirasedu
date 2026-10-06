/** Group repeated security alerts for display; retain every audit record. */
export function groupSecurityNotifications<T extends { key: string; title?: string; body?: string; when?: string; readKeys?: string[] }>(items: T[]): Array<T & { repeatCount?: number }> {
  const windowMs = 15 * 60 * 1000;
  const result: Array<T & { repeatCount?: number }> = [];
  const groups = new Map<string, { latest: number; item: T & { repeatCount?: number }; keys: Set<string> }>();
  const timestamp = (item: T) => Date.parse(String(item.when || ''));
  const compact = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
  for (const item of [...items].sort((a, b) => timestamp(b) - timestamp(a))) {
    const at = timestamp(item);
    const text = `${item.title || ''} ${item.body || ''}`;
    const isRepeatedSecurityAlert = /مصيدة|دخول مرفوض يحتاج مراجعة/.test(text);
    if (!isRepeatedSecurityAlert || !Number.isFinite(at)) {
      result.push(item);
      continue;
    }
    // The body includes the student; different students/reasons remain separate.
    const identity = JSON.stringify([compact(item.title), compact(item.body)]);
    const previous = groups.get(identity);
    if (previous && previous.latest - at <= windowMs) {
      if (previous.keys.has(item.key)) continue;
      previous.keys.add(item.key);
      previous.item.repeatCount = (previous.item.repeatCount || 1) + 1;
      previous.item.readKeys = [...new Set([...(previous.item.readKeys || []), item.key, ...(item.readKeys || [])])];
    } else {
      const grouped = { ...item, repeatCount: 1, readKeys: [...new Set([item.key, ...(item.readKeys || [])])] };
      groups.set(identity, { latest: at, item: grouped, keys: new Set([item.key]) });
      result.push(grouped);
    }
  }
  return result;
}
