/**
 * Detects a scroller that snaps back to the top by itself (no finger on the screen) and
 * records what surrounded it, so a hard-to-reproduce device-only bug can be diagnosed.
 * Pure logic: the caller feeds it scroll/touch events and decides how to show the record.
 */
export type ScrollJumpRecord = {
  at: string;
  fromTop: number;
  toTop: number;
  msSincePrevScroll: number;
  touchActive: boolean;
  msSinceTouchMove: number | null;
  msSinceTouchEnd: number | null;
  scrollHeight: number;
  clientHeight: number;
};

export type ScrollJumpOptions = {
  /** Smallest previous position that counts as "was scrolled down". */
  minFromTop?: number;
  /** A jump lands at or below this position. */
  maxToTop?: number;
  /** Scroll events further apart than this are not one continuous motion. */
  maxGapMs?: number;
  /** A finger that left the screen this recently is still treated as user driven. */
  userGraceMs?: number;
  /** A touch with no movement for this long is no longer treated as a drag. */
  staleTouchMs?: number;
  /** Landing spot still counted as the top when nearly all of the position was lost at once. */
  nearTopPx?: number;
};

export function createScrollJumpDetector(options: ScrollJumpOptions = {}) {
  const minFromTop = options.minFromTop ?? 60;
  const maxToTop = options.maxToTop ?? 2;
  const userGraceMs = options.userGraceMs ?? 0;
  const staleTouchMs = options.staleTouchMs ?? 300;
  const nearTopPx = options.nearTopPx ?? 120;
  let prevTop = 0;
  let prevAt = 0;
  let touchActive = false;
  let lastTouchMoveAt: number | null = null;
  let lastTouchEndAt: number | null = null;

  return {
    touchStart(now: number) {
      touchActive = true;
      lastTouchMoveAt = now;
    },
    touchMove(now: number) {
      touchActive = true;
      lastTouchMoveAt = now;
    },
    touchEnd(now: number) {
      touchActive = false;
      lastTouchEndAt = now;
    },
    /** Returns a record when this scroll event is a jump to the top that no finger caused. */
    scroll(now: number, top: number, scrollHeight = 0, clientHeight = 0): ScrollJumpRecord | null {
      const from = prevTop;
      const gap = prevAt ? now - prevAt : 0;
      prevTop = top;
      prevAt = now;
      // Lands at the very top, or almost (a fling that was already running adds a few pixels).
      const landedAtTop = top <= maxToTop || (top <= nearTopPx && from > 0 && (from - top) / from >= 0.85);
      if (from < minFromTop || !landedAtTop) return null;
      // A finger dragging the content back up is a normal return to the top. A finger that has
      // not moved for a while cannot be scrolling, so a stale "touch active" flag is ignored.
      const fingerDragging = touchActive && lastTouchMoveAt !== null && now - lastTouchMoveAt < staleTouchMs;
      if (fingerDragging) return null;
      if (lastTouchEndAt !== null && now - lastTouchEndAt < userGraceMs) return null;
      return {
        at: new Date(now).toISOString(),
        fromTop: Math.round(from),
        toTop: Math.round(top),
        msSincePrevScroll: Math.round(gap),
        touchActive,
        msSinceTouchMove: lastTouchMoveAt === null ? null : Math.round(now - lastTouchMoveAt),
        msSinceTouchEnd: lastTouchEndAt === null ? null : Math.round(now - lastTouchEndAt),
        scrollHeight: Math.round(scrollHeight),
        clientHeight: Math.round(clientHeight),
      };
    },
  };
}

export function formatScrollJumpReport(
  records: Array<ScrollJumpRecord & { context?: Record<string, any> }>,
  environment: Record<string, any> = {},
): string {
  const lines: string[] = ["تقرير قفزة التمرير (مِراس)"];
  Object.entries(environment).forEach(([key, value]) => lines.push(`${key}: ${String(value)}`));
  records.forEach((record, index) => {
    lines.push("", `#${index + 1} ${record.at}`);
    lines.push(
      `من ${record.fromTop} إلى ${record.toTop} | الفاصل ${record.msSincePrevScroll}ms | ` +
        `لمس نشط: ${record.touchActive ? "نعم" : "لا"} | منذ آخر حركة لمس: ${record.msSinceTouchMove ?? "-"}ms | ` +
        `منذ رفع الإصبع: ${record.msSinceTouchEnd ?? "-"}ms | الارتفاع الكلي/المرئي: ${record.scrollHeight}/${record.clientHeight}`,
    );
    Object.entries(record.context || {}).forEach(([key, value]) => lines.push(`  ${key}: ${String(value)}`));
  });
  return lines.join("\n");
}
