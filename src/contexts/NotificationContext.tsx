import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getMessagingInstance } from '../services/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { useProject } from './ProjectContext';
import { doc, onSnapshot, collection, query, orderBy, limit, updateDoc } from 'firebase/firestore';
import { useFirebase } from './FirebaseContext';
import { useEmergency } from './EmergencyContext';
import { db } from '../services/firebase';

import { get, set } from 'idb-keyval';
import { logger } from '../utils/logger';

export type NotificationType = 'info' | 'warning' | 'error' | 'success';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  time: string;
  read: boolean;
  createdAt: number;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'time' | 'read' | 'createdAt'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { isEmergencyActive } = useEmergency();
  const isCrisisMode = isEmergencyActive;

  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const loadNotifications = async () => {
      const saved = await get('praeventio_notifications');
      if (saved) {
        setNotifications(saved as Notification[]);
      } else {
        setNotifications([
          { id: '1', title: 'Bienvenido a Praeventio Guard', message: 'Tu sistema de gestión de seguridad está listo.', type: 'success', time: 'Ahora', read: false, createdAt: Date.now() }
        ]);
      }
    };
    loadNotifications();
  }, []);

  useEffect(() => {
    if (notifications.length > 0) {
      set('praeventio_notifications', notifications);
    }
  }, [notifications]);

  useEffect(() => {
    const setupMessaging = async () => {
      try {
        const messaging = await getMessagingInstance();
        if (!messaging) return;

        // Request permission and get token
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
          const token = await getToken(messaging, vapidKey ? { vapidKey } : undefined);
          // Persist token so server can send targeted pushes
          if (token && user?.uid) {
            try {
              await updateDoc(doc(db, 'users', user.uid), { fcmToken: token });
            } catch {} // non-critical
          }
          
          // Handle incoming messages when app is in foreground
          onMessage(messaging, (payload) => {
            logger.debug('Message received. ', payload as unknown as Record<string, unknown>);
            if (!isCrisisMode) {
              addNotification({
                title: payload.notification?.title || 'Nueva Notificación',
                message: payload.notification?.body || '',
                type: 'info'
              });
            }
          });
        }
      } catch (error) {
        logger.error('Error setting up Firebase Messaging:', error);
      }
    };

    setupMessaging();
  }, [isCrisisMode]);

  // Track Firestore notification IDs already surfaced to avoid re-showing on re-subscribe
  const processedFirestoreIds = useRef<Set<string>>(new Set());

  // Listen for system notifications written by useZettelkastenIntelligence and server triggers
  useEffect(() => {
    if (!selectedProject?.id) return undefined;

    const notifQuery = query(
      collection(db, `projects/${selectedProject.id}/notifications`),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(notifQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const docId = change.doc.id;
        if (processedFirestoreIds.current.has(docId)) return;
        processedFirestoreIds.current.add(docId);
        const data = change.doc.data();
        const notification: Notification = {
          id: docId,
          title: data.title || 'Notificación',
          message: data.message || '',
          type: data.severity === 'high' ? 'warning' : 'info',
          time: 'Ahora',
          read: false,
          createdAt: Date.now(),
        };
        setNotifications(prev => prev.some(n => n.id === docId) ? prev : [notification, ...prev]);
      });
    }, () => {}); // silent error — non-critical feature

    return () => {
      processedFirestoreIds.current.clear();
      unsubscribe();
    };
  }, [selectedProject?.id]);

  // Memoize el conteo no-leído para evitar recompute O(n) en cada render
  // del Provider (notifications puede tener hasta 20 items según el limit
  // del listener en línea 121).
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const addNotification = useCallback((n: Omit<Notification, 'id' | 'time' | 'read' | 'createdAt'>) => {
    if (isCrisisMode) return; // Radio silence mode

    const newNotification: Notification = {
      ...n,
      id: crypto.randomUUID(),
      time: 'Ahora',
      read: false,
      createdAt: Date.now()
    };
    setNotifications(prev => [newNotification, ...prev]);
    
    // Trigger Push Notification if supported
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(n.title, { body: n.message });
    }
  }, [isCrisisMode]);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Plan 2026-05-23 perf — memoize el value. Las 4 callbacks ya estaban
  // en useCallback (líneas 152-180); unreadCount lo memoizé arriba.
  // Consumers: ToastContainer (root), Sidebar (badge), Header bell icon —
  // todos re-renderizaban en cada render del Provider sin esto.
  const contextValue = useMemo(
    () => ({ notifications, unreadCount, addNotification, markAsRead, markAllAsRead, clearAll }),
    [notifications, unreadCount, addNotification, markAsRead, markAllAsRead, clearAll],
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
