/**
 * The "try the demo" login button was added for Apple App Review. The app is
 * live, so it is hidden by default. It can be re-enabled for a reviewer, inside
 * the iOS shell only, with `?review-demo=1` (remembered for the session), or
 * for everyone in the shell by flipping the flag below.
 */
import { isAppleNativeShell } from "./apple-native-shell";

export const REVIEW_DEMO_ENTRY_DEFAULT = false;
export const REVIEW_DEMO_PARAM = "review-demo";
const SESSION_KEY = "miras_review_demo";

export function isReviewDemoEntryVisible(
  opts: { nativeShell?: boolean; search?: string; flag?: boolean } = {},
): boolean {
  const nativeShell = opts.nativeShell ?? isAppleNativeShell();
  if (!nativeShell) return false;
  if (opts.flag ?? REVIEW_DEMO_ENTRY_DEFAULT) return true;
  const hasWindow = typeof window !== "undefined";
  const search = opts.search ?? (hasWindow ? window.location.search : "");
  let param: string | null = null;
  try { param = new URLSearchParams(search).get(REVIEW_DEMO_PARAM); } catch {}
  if (param === "1") {
    try { if (hasWindow) window.sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    return true;
  }
  if (param === "0") {
    try { if (hasWindow) window.sessionStorage.removeItem(SESSION_KEY); } catch {}
    return false;
  }
  try { return hasWindow && window.sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}
