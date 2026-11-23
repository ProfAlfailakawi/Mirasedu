/**
 * هل يبدو أن الاختبار مفتوح داخل متصفح مضمَّن/WebView غير مدعوم؟
 * تطبيق iOS الرسمي (غلاف Capacitor) مستثنى صراحةً: وكيل المستخدم فيه بلا Safari
 * فكان يُعدّ «متصفحًا مضمَّنًا» ويُنهي الاختبار. في المتصفح يبقى السلوك كما هو تمامًا.
 */
export function isLikelyUnsupportedExamWebViewUA(ua: string, nativeShell: boolean): boolean {
  if (nativeShell) return false;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroidWebView =
    /; wv\)|\bwv\b|version\/\d+\.\d+.*chrome\/\d+.*mobile safari/i.test(ua);
  const isInAppBrowser =
    /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|LinkedInApp|EdgA\/.+WebView/i.test(
      ua,
    );
  const isIOSInApp = isIOS && !/Safari/i.test(ua) && /AppleWebKit/i.test(ua);
  return Boolean(isAndroidWebView || isInAppBrowser || isIOSInApp);
}
