// إشعارات النظام (APNs) داخل غلاف iOS الأصلي (Capacitor).
// الصفحة تُحمَّل من الموقع داخل WKWebView، حيث لا يوجد Notification/Service Worker،
// فنستعمل إضافة @capacitor/push-notifications المسجّلة في التطبيق الأصلي عبر الجسر.
// خارج الغلاف الأصلي تعيد كل الدوال "unsupported" ولا تفعل شيئاً.

export type NativePushPermission = "granted" | "denied" | "default" | "unsupported";

type PushPlugin = {
  checkPermissions: () => Promise<{ receive: string }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: (
    event: string,
    cb: (payload: any) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
};

const getPlugin = (): PushPlugin | null => {
  try {
    const cap = (globalThis as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    if (cap.getPlatform?.() !== "ios") return null;
    return (cap.Plugins?.PushNotifications as PushPlugin) || null;
  } catch {
    return null;
  }
};

export const isNativePushAvailable = () => !!getPlugin();

const mapPermission = (value: string | undefined): NativePushPermission => {
  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  return "default"; // prompt / prompt-with-rationale
};

let lastKnown: NativePushPermission = "unsupported";
export const lastKnownNativePushPermission = () => lastKnown;

export async function readNativePushPermission(): Promise<NativePushPermission> {
  const plugin = getPlugin();
  if (!plugin) return "unsupported";
  try {
    lastKnown = mapPermission((await plugin.checkPermissions()).receive);
  } catch {
    lastKnown = "unsupported";
  }
  return lastKnown;
}

/** يطلب إذن النظام إن لم يُحسم بعد (نافذة iOS الأصلية). لا يسأل مرتين. */
export async function requestNativePushPermission(): Promise<NativePushPermission> {
  const plugin = getPlugin();
  if (!plugin) return "unsupported";
  try {
    const current = await readNativePushPermission();
    if (current !== "default") return current;
    lastKnown = mapPermission((await plugin.requestPermissions()).receive);
  } catch {
    lastKnown = "unsupported";
  }
  return lastKnown;
}

/** يسجّل الجهاز لدى APNs ويعيد توكن الجهاز (hex) أو "" عند الفشل/المهلة. */
export async function registerNativePushToken(timeoutMs = 15000): Promise<string> {
  const plugin = getPlugin();
  if (!plugin) return "";
  let handle: { remove: () => Promise<void> } | null = null;
  let failHandle: { remove: () => Promise<void> } | null = null;
  try {
    const token = await new Promise<string>(async (resolve) => {
      const timer = setTimeout(() => resolve(""), timeoutMs);
      const done = (value: string) => {
        clearTimeout(timer);
        resolve(value);
      };
      handle = await plugin.addListener("registration", (t: any) =>
        done(String(t?.value || "")),
      );
      failHandle = await plugin.addListener("registrationError", () => done(""));
      await plugin.register();
    });
    return token;
  } catch {
    return "";
  } finally {
    try {
      await (handle as any)?.remove?.();
      await (failHandle as any)?.remove?.();
    } catch {}
  }
}

/** يستدعي cb عند فتح المستخدم إشعاراً من النظام (لفتح الصفحة المناسبة). */
export async function onNativePushOpened(cb: (data: any) => void) {
  const plugin = getPlugin();
  if (!plugin) return () => {};
  try {
    const h = await plugin.addListener("pushNotificationActionPerformed", (a: any) =>
      cb(a?.notification?.data || {}),
    );
    return () => void h.remove().catch(() => {});
  } catch {
    return () => {};
  }
}
