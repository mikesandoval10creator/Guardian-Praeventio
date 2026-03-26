importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  projectId: "praeventio-541ad",
  appId: "1:565212386989:web:d826701018d2e882c21824",
  apiKey: "AIzaSyDrvGczpKniBDWtgl4INxEn6cuecgskmEU",
  authDomain: "praeventio-541ad.firebaseapp.com",
  storageBucket: "praeventio-541ad.firebasestorage.app",
  messagingSenderId: "565212386989"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification?.title || 'Praeventio Guard';
  const notificationOptions = {
    body: payload.notification?.body || 'Nueva alerta de seguridad',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
