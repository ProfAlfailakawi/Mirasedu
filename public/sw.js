/* Miras PWA + FCM service worker */
const MIRAS_CACHE_VERSION = 'miras-shell-v80-radar-compact-again-20260712';
const MIRAS_STUDENT_LIVE_CHANNEL = 'miras-student-live-v1';
const MIRAS_STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon-32.png',
  '/favicon-16.png',
  '/ios-icon-192-v7.png',
  '/ios-icon-512-v7.png',
  '/apple-touch-icon-v7.png',
  '/maskable-icon-v7.png'
];
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');
} catch (e) {}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.all([
    initMirasFirebaseMessaging(),
    caches.open(MIRAS_CACHE_VERSION).then((cache) => cache.addAll(MIRAS_STATIC_ASSETS)).catch(() => undefined)
  ]));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    initMirasFirebaseMessaging(),
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => (key.startsWith('miras-shell-') || key.startsWith('miras-static-')) && key !== MIRAS_CACHE_VERSION).map((key) => caches.delete(key)))
    )
  ]));
});

async function initMirasFirebaseMessaging(config) {
  try {
    if (!self.firebase || self.firebase.apps.length) return;
    let firebaseConfig = config;
    if (!firebaseConfig) {
      const resp = await fetch('/api/config/firebase-public', { cache: 'no-store' });
      const data = await resp.json();
      firebaseConfig = data && data.firebaseConfig;
    }
    if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.messagingSenderId || !firebaseConfig.appId) return;
    self.firebase.initializeApp(firebaseConfig);
    // تهيئة SDK مطلوبة لاستمرار توافق توكنات FCM، لكن العرض مملوك حصراً لمعالج
    // push أدناه. تسجيل onBackgroundMessage هنا كان يصنع مسار عرض يدوي ثانياً.
    self.firebase.messaging();
  } catch (e) {}
}

// ═══ شبكة الصيد النووية — طبقة عامل الخدمة 🛰️ ═══════════════════════════════
// أخطاء الـSW (دفعات، كاش، مزامنة خلفية) كانت تموت بصمت خارج نظر الجميع.
var mirasSwRadarBudget = 3;
function mirasSwRadar(message, stack) {
  try {
    if (mirasSwRadarBudget <= 0) return;
    mirasSwRadarBudget -= 1;
    fetch('/api/monitor/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: String(message || '').slice(0, 250), stack: String(stack || '').slice(0, 1000), url: '/sw', source: 'sw', role: '', userId: '' })
    }).catch(function () {});
  } catch (e) {}
}
self.addEventListener('error', function (e) {
  mirasSwRadar('SW error: ' + String((e && e.message) || 'unknown'), String((e && e.filename) || '') + ':' + String((e && e.lineno) || ''));
});
self.addEventListener('unhandledrejection', function (e) {
  var r = e && e.reason;
  mirasSwRadar('SW rejection: ' + String((r && r.message) || r || 'unknown'), String((r && r.stack) || ''));
});

const mirasRecentNotificationKeys = new Map();
const MIRAS_NOTIFICATION_LEDGER_DB = 'miras-notification-delivery-ledger-v1';
const MIRAS_NOTIFICATION_LEDGER_STORE = 'shown';

// حارس دائم داخل جهاز الطالب: ذاكرة Map تختفي عندما يعيد iOS تشغيل عامل الخدمة،
// وقد يعيد FCM تسليم الحدث بعدها. IndexedDB يجعل notificationId نفسه يُعرض مرة
// واحدة حتى بعد إعادة تشغيل الـSW أو إغلاق التطبيق وفتحه.
function claimMirasNotificationDelivery(key) {
  return new Promise((resolve) => {
    try {
      if (!self.indexedDB || !key) return resolve(false);
      const request = self.indexedDB.open(MIRAS_NOTIFICATION_LEDGER_DB, 1);
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(MIRAS_NOTIFICATION_LEDGER_STORE)) {
            db.createObjectStore(MIRAS_NOTIFICATION_LEDGER_STORE, { keyPath: 'id' });
          }
        } catch (e) {}
      };
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction(MIRAS_NOTIFICATION_LEDGER_STORE, 'readwrite');
          const store = tx.objectStore(MIRAS_NOTIFICATION_LEDGER_STORE);
          const now = Date.now();
          const get = store.get(key);
          let duplicate = false;
          get.onsuccess = () => {
            const previousAt = Number(get.result && get.result.at || 0);
            duplicate = previousAt > 0 && now - previousAt < 14 * 24 * 60 * 60 * 1000;
            if (!duplicate) {
              try { store.put({ id: key, at: now }); } catch (e) {}
            }
            try {
              const cursor = store.openCursor();
              cursor.onsuccess = () => {
                const item = cursor.result;
                if (!item) return;
                if (now - Number(item.value && item.value.at || 0) > 14 * 24 * 60 * 60 * 1000) {
                  try { item.delete(); } catch (e) {}
                }
                item.continue();
              };
            } catch (e) {}
          };
          get.onerror = () => { duplicate = false; };
          tx.oncomplete = () => {
            try { db.close(); } catch (e) {}
            resolve(duplicate);
          };
          tx.onerror = () => {
            try { db.close(); } catch (e) {}
            resolve(false);
          };
        } catch (e) {
          try { db.close(); } catch (err) {}
          resolve(false);
        }
      };
    } catch (e) {
      resolve(false);
    }
  });
}

const MIRAS_PENDING_FCM_DB = 'miras-pending-fcm-v1';
const MIRAS_PENDING_FCM_STORE = 'notifications';

function withMirasPendingFcmStore(mode, callback) {
  return new Promise((resolve) => {
    try {
      if (!self.indexedDB) return resolve(undefined);
      const request = self.indexedDB.open(MIRAS_PENDING_FCM_DB, 1);
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(MIRAS_PENDING_FCM_STORE)) {
            db.createObjectStore(MIRAS_PENDING_FCM_STORE, { keyPath: 'id' });
          }
        } catch (e) {}
      };
      request.onerror = () => resolve(undefined);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction(MIRAS_PENDING_FCM_STORE, mode);
          const store = tx.objectStore(MIRAS_PENDING_FCM_STORE);
          Promise.resolve(callback(store))
            .then((value) => {
              tx.oncomplete = () => {
                try { db.close(); } catch (e) {}
                resolve(value);
              };
              tx.onerror = () => {
                try { db.close(); } catch (e) {}
                resolve(value);
              };
            })
            .catch(() => {
              try { db.close(); } catch (e) {}
              resolve(undefined);
            });
        } catch (e) {
          try { db.close(); } catch (err) {}
          resolve(undefined);
        }
      };
    } catch (e) {
      resolve(undefined);
    }
  });
}

function saveMirasPendingFcmNotification(payload) {
  if (!payload || !payload.id) return Promise.resolve(undefined);
  return withMirasPendingFcmStore('readwrite', (store) => {
    try { store.put(payload); } catch (e) {}
  });
}

function readAndClearMirasPendingFcmNotifications() {
  return withMirasPendingFcmStore('readwrite', (store) => new Promise((resolve) => {
    try {
      const req = store.getAll();
      req.onsuccess = () => {
        const items = Array.isArray(req.result) ? req.result : [];
        try { store.clear(); } catch (e) {}
        resolve(items.slice(-80));
      };
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  })) || Promise.resolve([]);
}

function notificationDedupeKey(title, body, data) {
  const stableId = data?.notificationId || data?.eventId || data?.messageId || '';
  if (stableId) return `id:${stableId}`;
  return [title || '', body || '', data?.type || '', data?.activityId || data?.examId || data?.projectId || '', data?.courseCode || '', data?.url || ''].join('|');
}

function shouldSkipDuplicateNotification(title, body, data) {
  const now = Date.now();
  for (const [key, at] of mirasRecentNotificationKeys.entries()) {
    if (now - at > 600000) mirasRecentNotificationKeys.delete(key);
  }
  const key = notificationDedupeKey(title, body, data || {});
  const previous = mirasRecentNotificationKeys.get(key);
  if (previous && now - previous < 600000) return true;
  mirasRecentNotificationKeys.set(key, now);
  return false;
}

function notificationTag(title, body, data) {
  const stableId = String(data?.notificationId || data?.eventId || data?.messageId || '').trim();
  if (stableId) return stableId.slice(0, 120);
  return `miras-${notificationDedupeKey(title, body, data || {}).slice(0, 100)}`;
}

function normalizePayload(payload) {
  const notification = payload.notification || payload.data || {};
  const title = notification.title || payload.title || payload?.data?.title || 'مِراس';
  const body = notification.body || payload.body || payload?.data?.body || 'لديك تنبيه جديد.';
  const data = {
    ...(payload.data || {}),
    url: payload?.fcmOptions?.link || payload?.webpush?.fcm_options?.link || payload?.data?.link || '/',
  };
  return { title, body, data };
}

async function broadcastMirasInAppNotification(title, body, data) {
  const payload = {
    id: data.notificationId || data.messageId || `sw-fcm-${Date.now()}`,
    title,
    body,
    source: 'fcm',
    type: data.type || 'push',
    sectionCode: data.sectionCode || data.courseCode || '',
    courseCode: data.courseCode || data.sectionCode || '',
    studentId: data.studentId || data.userId || '',
    userId: data.userId || data.studentId || '',
    targetRole: data.targetRole || data.role || '',
    data: { ...(data || {}), source: 'fcm' },
    createdAt: new Date().toISOString()
  };
  try {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const message = { type: 'MIRAS_FCM_IN_APP_NOTIFICATION', payload };
    clientsList.forEach((client) => {
      try { client.postMessage(message); } catch (e) {}
    });
  } catch (e) {}
  try {
    const channel = new BroadcastChannel(MIRAS_STUDENT_LIVE_CHANNEL);
    channel.postMessage({
      type: 'MIRAS_STUDENT_LIVE_SYNC',
      reason: 'service-worker-push',
      at: Date.now()
    });
    channel.close();
  } catch (e) {}
  return payload;
}

async function showMirasNotification(payload) {
  const { title, body, data } = normalizePayload(payload || {});
  // المنع يسبق البثّ والحفظ أيضاً؛ سابقاً كان يمنع بانر النظام فقط بينما يضيف
  // نسختين إلى قناة التطبيق وIndexedDB من نفس دفعة FCM.
  if (shouldSkipDuplicateNotification(title, body, data)) return;
  const persistentKey = notificationDedupeKey(title, body, data || {});
  if (await claimMirasNotificationDelivery(persistentKey)) return;
  const tag = notificationTag(title, body, data);
  try {
    const alreadyVisible = await self.registration.getNotifications({ tag });
    if (alreadyVisible && alreadyVisible.length) return;
  } catch (e) {}
  const inAppPayload = await broadcastMirasInAppNotification(title, body, data || {});
  await saveMirasPendingFcmNotification(inAppPayload);
  // التطبيق مفتوح وظاهر أمام المستخدم؟ التوست الداخلي (المبثوث أعلاه) يكفيه —
  // بانر النظام فوقه = نفس الإشعار "يصل مرتين" (شكوى المالك). البانر يظهر فقط
  // حين يكون التطبيق بالخلفية/مغلقاً، وهو عرفُ التطبيقات الاحترافية.
  try {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appVisible = wins.some((c) => c.visibilityState === 'visible');
    if (appVisible) return;
  } catch (e) {}
  return self.registration.showNotification(title, {
    body,
    icon: '/ios-icon-192-v7.png',
    badge: '/ios-icon-192-v7.png',
    dir: 'rtl',
    lang: 'ar',
    data,
    tag,
    renotify: false,
    requireInteraction: false,
  });
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  event.waitUntil(Promise.all([initMirasFirebaseMessaging(), showMirasNotification(payload)]));
});

try {
  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data && event.data.type === 'MIRAS_SHOW_NOTIFICATION') {
      event.waitUntil(showMirasNotification(event.data.payload || {}));
    }
    if (event.data && event.data.type === 'MIRAS_FLUSH_PENDING_FCM') {
      event.waitUntil((async () => {
        const payloads = await readAndClearMirasPendingFcmNotifications();
        if (payloads && payloads.length && event.source) {
          try { event.source.postMessage({ type: 'MIRAS_FCM_PENDING_NOTIFICATIONS', payloads }); } catch (e) {}
        }
      })());
    }
    if (event.data && event.data.type === 'MIRAS_FIREBASE_CONFIG' && self.firebase && !self.firebase.apps.length) {
      event.waitUntil(initMirasFirebaseMessaging(event.data.config));
    }
  });
} catch (e) {}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification?.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if ('focus' in client) {
        try { client.postMessage({ type: 'MIRAS_STUDENT_LIVE_SYNC', reason: 'notification-click', at: Date.now() }); } catch {}
        try { await client.navigate(targetUrl); } catch {}
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/seb/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        const cache = await caches.open(MIRAS_CACHE_VERSION);
        cache.put('/', fresh.clone()).catch(() => undefined);
        return fresh;
      } catch {
        const cached = await caches.match('/') || await caches.match('/index.html');
        if (cached) return cached;
        return new Response('مِراس غير متصل حالياً. أعد المحاولة عند توفر الاتصال.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // أصول البناء المجزّأة بالهاش (Vite يُخرج ملفات ثابتة المحتوى تحت
  // ‎/assets/<اسم>-<هاش>.<امتداد>). لأن الرابط نفسه يتغيّر كلما تغيّر المحتوى،
  // فالنسخة المخزّنة لرابط معيّن صحيحة دائماً — لذا نخدمها من الكاش مباشرةً
  // (فورية، بلا شبكة) بدل إعادة تنزيل حزمة الـ JS/CSS كاملةً في كل فتحة صفحة
  // كما كان المسار السابق (network-first + no-store) يفعل. أي نشر جديد يُصدر
  // روابط هاش جديدة (يشير إليها index.html المُحمَّل دائماً من الشبكة)، فتفوت
  // الكاش وتُجلب مرة واحدة ثم تُخزَّن. هذا هو أكبر مكسب لسرعة "الموقع بالكامل".
  const isImmutableHashedAsset =
    (url.pathname.startsWith('/assets/') &&
      /-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i.test(url.pathname)) ||
    // محرّك وملفات عارض PDF.js (‎/pdfjs/build/pdf.worker.mjs ~٢.٢م.ب وغيرها):
    // كبيرة وثابتة الاسم. نخدمها cache-first (بلا إعادة جلب في الخلفية) فلا
    // يُعاد تنزيل ٢.٢ ميجابايت في كل فتح معاينة بوربوينت/PDF → معاينة فورية.
    // أي تحديث لها يُلتقط عبر رفع إصدار الـ SW (يمسح الكاش القديم).
    url.pathname.startsWith('/pdfjs/');

  if (isImmutableHashedAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          caches.open(MIRAS_CACHE_VERSION).then((cache) => cache.put(request, fresh.clone())).catch(() => undefined);
        }
        return fresh;
      } catch {
        return fetch(request);
      }
    })());
    return;
  }

  // بقية الأصول الثابتة الاسم (عارض PDF.js، manifest، ...): stale-while-revalidate.
  // نُرجع النسخة المخزّنة فوراً إن وُجدت (فتح لحظي) ونُحدّث الكاش في الخلفية،
  // فلا ينتظر المستخدم الشبكة عند كل فتحة، ويصل التحديث في الزيارة التالية.
  if (['style', 'script', 'worker', 'font', 'manifest'].includes(request.destination)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request, { cache: 'no-store' })
        .then((fresh) => {
          if (fresh && fresh.ok) {
            caches.open(MIRAS_CACHE_VERSION).then((cache) => cache.put(request, fresh.clone())).catch(() => undefined);
          }
          return fresh;
        })
        .catch(() => cached);
      return cached || network;
    })());
    return;
  }

  if (request.destination === 'image') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((fresh) => {
          if (fresh && fresh.ok) {
            caches.open(MIRAS_CACHE_VERSION).then((cache) => cache.put(request, fresh.clone())).catch(() => undefined);
          }
          return fresh;
        })
        .catch(() => cached);
      return cached || network;
    })());
  }
});
