/**
 * True only inside the iOS app (Capacitor hosted mode), never on the website.
 * Capacitor injects `window.Capacitor`; always false on the web, SSR and tests.
 */
export function isAppleNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as any).Capacitor;
    return !!(cap?.isNativePlatform?.() && cap?.getPlatform?.() === "ios");
  } catch {
    return false;
  }
}
