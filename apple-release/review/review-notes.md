# ملاحظات المراجعة — مِراس

**ملاحظة للمراجع (EN):** Miras is a native shell around our production service at https://mirasedu.web.app. Native features: offline detection and banner with automatic recovery, pull-to-refresh, swipe navigation, resume-last-page, iPad multitasking and Mac (Apple silicon) support.

- حساب التجربة: OWNER-TODO: حساب تجربة (طالب + معلم) ببيانات وهمية.
- المدفوعات: لا مشتريات داخل التطبيق.
- مخاطر المراجعة: الكاميرا لمسح QR ورفع الصور فقط؛ WebAuthn/Passkeys في WKWebView تتطلب Associated Domains (webcredentials) — مضاف في `App.entitlements` مع `/.well-known/apple-app-site-association`؛ يلزم تفعيل القدرة على App ID من بوابة المطورين.

## إشعارات النظام (APNs) — خطوات يدوية لازمة

الكود جاهز، ويلزم من المالك:
1. بوابة Apple Developer ← Identifiers ← `com.dralfailakawi.miras`: فعّل **Associated Domains** و**Push Notifications**.
2. أنشئ مفتاح APNs (.p8) من Keys، وضبط متغيرات الخادم (Cloud Run): `APNS_KEY_P8` و`APNS_KEY_ID` و`APNS_TEAM_ID=55V8UB9X3H` (و`APNS_ENV=sandbox` لبناء Xcode المباشر فقط).
3. في مجلد `apple/`: `npm install && npx cap sync ios` ثم أرشِف وارفع بناءً جديداً.
4. انشر الموقع (`firebase deploy --only hosting`) كي يُخدَم ملف AASA، وتحقق: `curl -i https://mirasedu.web.app/.well-known/apple-app-site-association` (يجب 200 وJSON).
