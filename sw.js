/* Miras PWA + FCM service worker */
const MIRAS_CACHE_VERSION = 'miras-shell-v31-device-lock-live-sync-layout-20260704-v2';
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
    const messaging = self.firebase.messaging();
    messaging.onBackgroundMessage((payload) => showMirasNotification(payload));
  } catch (e) {}
}

const mirasRecentNotificationKeys = new Map();

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
  return [title || '', body || '', data?.type || '', data?.activityId || '', data?.courseCode || '', data?.url || ''].join('|');
}

function shouldSkipDuplicateNotification(title, body, data) {
  const now = Date.now();
  for (const [key, at] of mirasRecentNotificationKeys.entries()) {
    if (now - at > 10000) mirasRecentNotificationKeys.delete(key);
  }
  const key = notificationDedupeKey(title, body, data || {});
  const previous = mirasRecentNotificationKeys.get(key);
  if (previous && now - previous < 10000) return true;
  mirasRecentNotificationKeys.set(key, now);
  return false;
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
  const inAppPayload = await broadcastMirasInAppNotification(title, body, data || {});
  await saveMirasPendingFcmNotification(inAppPayload);
  if (shouldSkipDuplicateNotification(title, body, data)) return;
  return self.registration.showNotification(title, {
    body,
    icon: '/ios-icon-192-v7.png',
    badge: '/ios-icon-192-v7.png',
    dir: 'rtl',
    lang: 'ar',
    data,
    tag: data.type || data.activityId || `miras-${Date.now()}`,
    renotify: true,
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

  if (['style', 'script', 'worker', 'font', 'manifest'].includes(request.destination)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          caches.open(MIRAS_CACHE_VERSION).then((cache) => cache.put(request, fresh.clone())).catch(() => undefined);
        }
        return fresh;
      } catch {
        if (cached) return cached;
        return fetch(request);
      }
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
