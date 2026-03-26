import { useState, useEffect } from 'react';
import { getMessagingInstance, getToken, onMessage } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';

export function usePushNotifications() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notificationPermissionStatus, setNotificationPermissionStatus] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermissionStatus(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    try {
      const messaging = await getMessagingInstance();
      if (!messaging) {
        console.warn('Messaging not supported in this browser.');
        return;
      }

      const permission = await Notification.requestPermission();
      setNotificationPermissionStatus(permission);

      if (permission === 'granted') {
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        
        if (!vapidKey) {
          console.warn('VITE_FIREBASE_VAPID_KEY is not set. Push notifications will not work in production.');
        }

        const token = await getToken(messaging, {
          vapidKey: vapidKey || undefined
        });

        if (token) {
          setFcmToken(token);
          console.log('FCM Token:', token);
          
          // Save token to user profile
          if (auth.currentUser) {
            await setDoc(doc(db, 'users', auth.currentUser.uid), {
              fcmToken: token,
              updatedAt: new Date()
            }, { merge: true });
          }
        } else {
          console.log('No registration token available. Request permission to generate one.');
        }
      } else {
        console.log('Unable to get permission to notify.');
      }
    } catch (error) {
      console.error('An error occurred while retrieving token. ', error);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupMessaging = async () => {
      const messaging = await getMessagingInstance();
      if (!messaging) return;

      unsubscribe = onMessage(messaging, (payload) => {
        console.log('Message received. ', payload);
        // Customize notification here if needed, or rely on service worker
        if (payload.notification) {
          new Notification(payload.notification.title || 'New Notification', {
            body: payload.notification.body,
            icon: '/vite.svg'
          });
        }
      });
    };

    setupMessaging();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  return {
    fcmToken,
    notificationPermissionStatus,
    requestPermission
  };
}
