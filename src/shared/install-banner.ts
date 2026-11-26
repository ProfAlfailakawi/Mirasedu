/**
 * One place that decides what the "install Miras" banner/buttons do.
 *
 *  - Inside the iOS native shell: never offer installation.
 *  - iPhone/iPad in a browser: offer the App Store app.
 *  - Inside the Android app (Capacitor): never offer installation either.
 *  - Android browser: offer the Google Play app (PLAY_STORE_URL); if it is
 *    ever emptied, the existing PWA install prompt is used again.
 *  - Desktop: unchanged (PWA prompt when the browser fires it).
 */
import { isAppleNativeShell } from "./apple-native-shell";

export const APP_STORE_URL = "https://apps.apple.com/app/id6834583275";
/** Google Play listing. Empty = keep the PWA prompt on Android. */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=kw.edu.mirasedu.app";

export type InstallPlatform = "ios" | "android" | "desktop";

export interface InstallEnv {
  userAgent?: string;
  maxTouchPoints?: number;
  nativeShell?: boolean;
}

export function detectInstallPlatform(userAgent = "", maxTouchPoints = 0): InstallPlatform {
  if (/iPad|iPhone|iPod/.test(userAgent)) return "ios";
  // iPadOS reports itself as a Mac; touch support tells it apart from a real Mac.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

/** Inside either store app (iOS or Android Capacitor shell), never on the website. */
function isAnyNativeShell(): boolean {
  if (isAppleNativeShell()) return true;
  if (typeof window === "undefined") return false;
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function readEnv(env: InstallEnv = {}): Required<InstallEnv> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    userAgent: env.userAgent ?? String(nav?.userAgent || ""),
    maxTouchPoints: env.maxTouchPoints ?? Number((nav as any)?.maxTouchPoints || 0),
    nativeShell: env.nativeShell ?? isAnyNativeShell(),
  };
}

/** Whether any install UI may be shown at all (false inside the iOS app). */
export function canOfferInstall(env?: InstallEnv): boolean {
  return !readEnv(env).nativeShell;
}

/**
 * Whether the banner should be raised by the manual (non-beforeinstallprompt)
 * path: iOS browsers always (Safari never fires the event), and Android
 * browsers once the Play listing exists (the store app, not the PWA).
 */
export function shouldShowManualInstallBanner(
  env?: InstallEnv,
  playStore: string = PLAY_STORE_URL,
): boolean {
  const e = readEnv(env);
  if (e.nativeShell) return false;
  const platform = detectInstallPlatform(e.userAgent, e.maxTouchPoints);
  return platform === "ios" || (platform === "android" && !!playStore);
}

/**
 * Store page the install button should open, or null to fall back to the
 * PWA prompt / share-sheet guide.
 */
export function installStoreUrl(
  env?: InstallEnv,
  urls: { appStore: string; playStore: string } = { appStore: APP_STORE_URL, playStore: PLAY_STORE_URL },
): string | null {
  const e = readEnv(env);
  if (e.nativeShell) return null;
  const platform = detectInstallPlatform(e.userAgent, e.maxTouchPoints);
  if (platform === "ios") return urls.appStore || null;
  if (platform === "android") return urls.playStore || null;
  return null;
}
