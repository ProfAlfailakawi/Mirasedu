/** نصوص تتكيّف مع تطبيق iOS (لا «متصفح» ولا «إعدادات المتصفح» داخل التطبيق). */
export const cameraBlockedStatus = (native: boolean): string =>
  native
    ? "اسمح للكاميرا من «الإعدادات ‹ Miras ‹ الكاميرا» ثم أعد المحاولة أو اختر صورة QR."
    : "اسمح للكاميرا من إعدادات المتصفح ثم أعد المحاولة أو اختر صورة QR.";

export const cameraBlockedHint = (native: boolean): string =>
  native
    ? "إذا بقي المنع، افتح «الإعدادات ‹ Miras ‹ الكاميرا» واسمح بها ثم جرّب مرة أخرى."
    : "إذا بقي المنع، افتح إعدادات المتصفح واسمح بالكاميرا ثم جرّب مرة أخرى.";

export const notificationsActivatedText = (native: boolean): string =>
  native
    ? "تم تفعيل إشعارات مراس لهذا الجهاز."
    : "تم تفعيل إشعارات مراس لهذا المتصفح.";
