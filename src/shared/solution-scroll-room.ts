const SCROLLER_SELECTOR = ".miras-submission-detail-scroll";
/** Extra scrollable space under the last line of a long answer (px). */
export const SOLUTION_BOTTOM_ROOM_PX = 88;
const OVERFLOW_THRESHOLD_PX = 8;

/** True when the content (without our own extra room) is taller than the visible area. */
export function solutionNeedsBottomRoom(scrollHeight: number, clientHeight: number, roomApplied: boolean): boolean {
  const base = scrollHeight - (roomApplied ? SOLUTION_BOTTOM_ROOM_PX : 0);
  return base - clientHeight > OVERFLOW_THRESHOLD_PX;
}

/**
 * Gives a long answer in the teacher solution view clear empty space below its last line.
 * An answer that overflows by only a few lines leaves a tiny scroll range that is easy to
 * overshoot and hides the last line behind the bottom bar; a short answer is left untouched.
 * Returns a cleanup that removes the extra space.
 */
export function keepSolutionBottomRoom(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let scroller: HTMLElement | null = null;
  let applied = false;
  let observer: MutationObserver | null = null;
  let frame = 0;

  const setRoom = (want: boolean) => {
    if (!scroller || want === applied) return;
    applied = want;
    if (want) scroller.style.setProperty("padding-bottom", `calc(.75rem + ${SOLUTION_BOTTOM_ROOM_PX}px)`, "important");
    else scroller.style.removeProperty("padding-bottom");
  };
  const evaluate = () => {
    frame = 0;
    if (!scroller) return;
    setRoom(solutionNeedsBottomRoom(scroller.scrollHeight, scroller.clientHeight, applied));
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(evaluate);
  };
  const attach = () => {
    const found = document.querySelector<HTMLElement>(SCROLLER_SELECTOR);
    if (found === scroller) return;
    observer?.disconnect();
    if (scroller) scroller.style.removeProperty("padding-bottom");
    scroller = found;
    applied = false;
    if (scroller) {
      observer = new MutationObserver(schedule);
      observer.observe(scroller, { childList: true, subtree: true, characterData: true });
      schedule();
    }
  };
  attach();
  const pollId = window.setInterval(() => {
    attach();
    schedule();
  }, 500);
  window.addEventListener("resize", schedule);

  return () => {
    window.clearInterval(pollId);
    window.removeEventListener("resize", schedule);
    if (frame) window.cancelAnimationFrame(frame);
    observer?.disconnect();
    scroller?.style.removeProperty("padding-bottom");
  };
}
