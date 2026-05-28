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
