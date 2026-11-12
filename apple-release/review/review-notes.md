# ملاحظات المراجعة — مِراس

**ملاحظة للمراجع (EN):** Miras is a native shell around our production service at https://mirasedu.web.app. Native features: offline detection and banner with automatic recovery, pull-to-refresh, swipe navigation, resume-last-page, iPad multitasking and Mac (Apple silicon) support.

- حساب التجربة: OWNER-TODO: حساب تجربة (طالب + معلم) ببيانات وهمية.
- المدفوعات: لا مشتريات داخل التطبيق.
- مخاطر المراجعة: الكاميرا لمسح QR ورفع الصور فقط؛ WebAuthn/Passkeys في WKWebView تتطلب Associated Domains (webcredentials) — غير مفعّل بعد.
