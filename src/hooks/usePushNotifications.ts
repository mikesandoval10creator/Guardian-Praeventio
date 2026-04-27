import { useState, useEffect } from 'react';
import { getMessagingInstance, getToken, onMessage } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export function usePushNotifications() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notificationPermissionStatus, setNotificationPermissionStatus] = useState<NotificationPermission | 'granted' | 'denied' | 'prompt'>('default');

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      PushNotifications.checkPermissions().then((res) => {
        setNotificationPermissionStatus(res.receive as NotificationPermission);
      });
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermissionStatus(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        let permStatus = await PushNotifications.checkPermissions();

        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.log('User denied push permission');
          return;
        }

        await PushNotifications.register();

        PushNotifications.addListener('registration', async (token) => {
          console.log('Push registration success, token: ' + token.value);
          setFcmToken(token.value);
          if (auth.currentUser) {
            await setDoc(doc(db, 'users', auth.currentUser.uid), {
              fcmToken: token.value,
              updatedAt: new Date()
            }, { merge: true });
          }
        });

        PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error on registration: ' + JSON.stringify(error));
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('Push received: ' + JSON.stringify(notification));
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('Push action performed: ' + JSON.stringify(notification));
        });

      } else {
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
      }
    } catch (error) {
      console.error('An error occurred while retrieving token. ', error);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupMessaging = async () => {
      if (!Capacitor.isNativePlatform()) {
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
      }
    };

    setupMessaging();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (Capacitor.isNativePlatform()) {
        PushNotifications.removeAllListeners();
      }
    };
  }, []);

  return {
    fcmToken,
    notificationPermissionStatus,
    requestPermission
  };
}
