// Praeventio Guard — Firebase Cloud Messaging service worker.
//
// IMPORTANT — build-time injected config (Bloque 1.8 fix, 2026-05-19):
// The placeholders __VITE_FIREBASE_*__ below are substituted by the
// `fcmSwConfigInjector` Vite plugin during `vite build` from the
// `VITE_FIREBASE_*` env vars (loaded by `loadEnv()` in vite.config.ts).
//
// In dev (vite serve) the placeholders remain — Firebase Messaging will
// not initialize, which is intentional: push notifications are a
// production-only concern and the dev server doesn't need them.
//
// To enable in prod, set in CI/CD or .env.production:
//   VITE_FIREBASE_PROJECT_ID
//   VITE_FIREBASE_APP_ID
//   VITE_FIREBASE_API_KEY
//   VITE_FIREBASE_AUTH_DOMAIN
//   VITE_FIREBASE_STORAGE_BUCKET
//   VITE_FIREBASE_MESSAGING_SENDER_ID

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// [P1][VIDA] Deep-link contract — MIRROR of
// src/services/notifications/notificationDeepLink.ts (the TS source of truth).
// A service worker can't import TS/ESM, so the mapping is inlined here; the
// drift-guard test src/services/notifications/swDeepLinkParity.test.ts pins the
// two in sync. Returns an in-app RELATIVE path (never a scheme/host).
function resolveNotificationDeepLinkPath(data) {
  var d = data && typeof data === 'object' ? data : {};
  var qs = function (pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      var k = pairs[i][0];
      var v = pairs[i][1];
      if (v) out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    return out.length ? '?' + out.join('&') : '';
  };
  var projectId = typeof d.projectId === 'string' && d.projectId ? d.projectId : '';
  var source = ['source', 'push'];
  var project = ['projectId', projectId];
  var alertId = typeof d.alertId === 'string' && d.alertId ? d.alertId : '';
  if (d.type === 'sos' || alertId) {
    return '/emergencia-avanzada' + qs([['alertId', alertId], project, source]);
  }
  var emergencyType =
    typeof d.emergencyType === 'string' && d.emergencyType ? d.emergencyType : '';
  if (emergencyType) {
    return '/emergencia-avanzada' + qs([['emergencyType', emergencyType], project, source]);
  }
  var incidentId =
    typeof d.nodeId === 'string' && d.nodeId
      ? d.nodeId
      : typeof d.incidentId === 'string' && d.incidentId
        ? d.incidentId
        : '';
  if (incidentId) {
    return '/incidents/' + encodeURIComponent(incidentId) + '/bundle' + qs([project, source]);
  }
  return '/notifications' + qs([project, source]);
}

// Firebase auto-displays "notification" messages and stashes the ORIGINAL
// payload under Notification.data.FCM_MSG; our own onBackgroundMessage sets
// data directly. Unwrap either shape so the resolver always sees projectId /
// alertId / nodeId regardless of which copy the user tapped.
function unwrapNotificationData(raw) {
  if (raw && typeof raw === 'object') {
    if (raw.FCM_MSG && raw.FCM_MSG.data && typeof raw.FCM_MSG.data === 'object') {
      return raw.FCM_MSG.data;
    }
    return raw;
  }
  return {};
}

// [P1][VIDA] notificationclick — WITHOUT this, tapping a critical push in the
// browser did nothing. Focus an open app tab (navigate in-SPA via postMessage)
// or open a new window at the deep link. Registered unconditionally: harmless
// when no notifications exist, and independent of the FCM-init guard below.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = unwrapNotificationData(event.notification && event.notification.data);
  var path = resolveNotificationDeepLinkPath(data);
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            return client.focus().then(function (focused) {
              (focused || client).postMessage({
                type: 'praeventio:deep-link',
                url: path,
                projectId: data.projectId || null,
              });
            });
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(path);
        }
        return undefined;
      }),
  );
});

const FCM_CONFIG = {
  projectId: '__VITE_FIREBASE_PROJECT_ID__',
  appId: '__VITE_FIREBASE_APP_ID__',
  apiKey: '__VITE_FIREBASE_API_KEY__',
  authDomain: '__VITE_FIREBASE_AUTH_DOMAIN__',
  storageBucket: '__VITE_FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__VITE_FIREBASE_MESSAGING_SENDER_ID__',
};

// Guard against running with unsubstituted placeholders — happens in dev
// (no build) or if env vars are missing in CI. We do NOT throw because the
// SW is registered automatically by the browser and an unhandled throw
// here will repeatedly log to the user's console.
const hasUnsubstituted = Object.values(FCM_CONFIG).some((v) =>
  typeof v === 'string' && v.startsWith('__VITE_FIREBASE_'),
);

if (!hasUnsubstituted) {
  firebase.initializeApp(FCM_CONFIG);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message', payload);

    const notificationTitle = payload.notification?.title || 'Praeventio Guard';
    const notificationOptions = {
      body: payload.notification?.body || 'Nueva alerta de seguridad',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: payload.data,
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} else {
  console.warn(
    '[firebase-messaging-sw.js] FCM config placeholders not substituted — push notifications disabled. ' +
      'Expected in dev. In prod set VITE_FIREBASE_* env vars before vite build.',
  );
}
