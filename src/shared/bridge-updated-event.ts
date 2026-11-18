// Bulk grading (e.g. "select all" + رصد الدرجة) saves one submission at a
// time and, on each individual save, used to fire `academicLabBridgeUpdated`
// right away. Every listener on that event re-fetches the teacher's full
// exams/projects/submissions/join-codes lists from the server, so grading a
// class of N students turned one bulk action into N back-to-back dispatches
// and up to 4×N redundant full-collection network requests firing almost at
// once — the real reason the "رصد الدرجة للمحدَّدين" button felt frozen for a
// long time, worst with projects (their submissions carry attachments, so
// each redundant refetch is heavier). Debouncing the dispatch collapses a
// burst of saves into a single event once the burst settles, so listeners
// still refresh — just once, not once per student.
export const BRIDGE_UPDATED_EVENT = "academicLabBridgeUpdated";
const BRIDGE_UPDATED_DEBOUNCE_MS = 400;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export function dispatchBridgeUpdated(
  target: { dispatchEvent: (event: Event) => boolean } | undefined =
    typeof window !== "undefined" ? window : undefined,
) {
  if (!target) return;
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    try {
      target.dispatchEvent(new Event(BRIDGE_UPDATED_EVENT));
    } catch {}
  }, BRIDGE_UPDATED_DEBOUNCE_MS);
}

// للاختبارات فقط: تصفير المؤقّت المعلّق بين الحالات.
export function resetBridgeUpdatedDispatchForTests() {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
}
