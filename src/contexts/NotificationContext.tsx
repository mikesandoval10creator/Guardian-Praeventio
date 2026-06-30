import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getMessagingInstance } from '../services/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { useProject } from './ProjectContext';
import { doc, onSnapshot, collection, query, orderBy, limit, updateDoc } from 'firebase/firestore';
import { useFirebase } from './FirebaseContext';
import { db } from '../services/firebase';

import { get, set } from 'idb-keyval';
import { logger } from '../utils/logger';
import { dedupeNotifications } from '../utils/notificationDedup';

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
  const [isCrisisMode, setIsCrisisMode] = useState(false);

  // Latest isCrisisMode without re-subscribing message/notification listeners.
  // Reading the ref inside handlers avoids re-running effects (and stacking
  // duplicate onMessage listeners) every time crisis mode toggles.
  const isCrisisModeRef = useRef(isCrisisMode);
  useEffect(() => {
    isCrisisModeRef.current = isCrisisMode;
  }, [isCrisisMode]);

  // Notifications are persisted PER PROJECT so one project's items never bleed
  // into another's list. Falls back to a global key before a project is picked.
  const storageKey = selectedProject?.id
    ? `praeventio_notifications_${selectedProject.id}`
    : 'praeventio_notifications';
  // Tracks which storageKey the current `notifications` were loaded for, so the
  // save effect never writes the previous project's items under the new key
  // during the async project switch.
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedProject?.id) return undefined;
    const projectRef = doc(db, 'projects', selectedProject.id);
    const unsubscribe = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        setIsCrisisMode(docSnap.data().isEmergencyActive || false);
      }
    });
    return () => unsubscribe();
  }, [selectedProject?.id]);

  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    let active = true;
    const loadNotifications = async () => {
      const saved = await get(storageKey);
      if (!active) return;
      loadedKeyRef.current = storageKey;
      if (saved) {
        // Collapse any historical duplicates already on disk (the bug that
        // produced "9 identical notifications") on the way in.
        setNotifications(dedupeNotifications(saved as Notification[]));
      } else {
        setNotifications([
          { id: '1', title: 'Bienvenido a Praeventio Guard', message: 'Tu sistema de gestión de seguridad está listo.', type: 'success', time: 'Ahora', read: false, createdAt: Date.now() }
        ]);
      }
    };
    loadNotifications();
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    // Guard: don't persist until the load for THIS key has completed, otherwise
    // a project switch would write the old list under the new project's key.
    if (loadedKeyRef.current !== storageKey) return;
    if (notifications.length > 0) {
      set(storageKey, notifications);
    }
  }, [notifications, storageKey]);

  useEffect(() => {
    let cancelled = false;
    let unsubMessage: (() => void) | undefined;

    const setupMessaging = async () => {
      try {
        const messaging = await getMessagingInstance();
        if (!messaging || cancelled) return;

        // Request permission and get token
        const permission = await Notification.requestPermission();
        if (permission !== 'granted' || cancelled) return;

        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        const token = await getToken(messaging, vapidKey ? { vapidKey } : undefined);
        // Persist token so server can send targeted pushes
        if (token && user?.uid) {
          try {
            await updateDoc(doc(db, 'users', user.uid), { fcmToken: token });
          } catch {} // non-critical
        }
        if (cancelled) return;

        // Handle incoming messages when app is in foreground. We register the
        // listener ONCE and capture its unsubscribe — previously this effect
        // re-ran on every isCrisisMode toggle and stacked listeners, so a single
        // push was handled N times → N identical notifications. Crisis state is
        // read from the ref so we never need to re-subscribe.
        unsubMessage = onMessage(messaging, (payload) => {
          logger.debug('Message received. ', payload as unknown as Record<string, unknown>);
          if (isCrisisModeRef.current) return; // radio silence
          addNotification({
            title: payload.notification?.title || 'Nueva Notificación',
            message: payload.notification?.body || '',
            type: 'info'
          });
        });
      } catch (error) {
        logger.error('Error setting up Firebase Messaging:', error);
      }
    };

    setupMessaging();
    return () => {
      cancelled = true;
      if (unsubMessage) unsubMessage();
    };
  }, [user?.uid]);

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
        setNotifications(prev => prev.some(n => n.id === docId) ? prev : dedupeNotifications([notification, ...prev]));
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
    if (isCrisisModeRef.current) return; // Radio silence mode

    const newNotification: Notification = {
      ...n,
      id: crypto.randomUUID(),
      time: 'Ahora',
      read: false,
      createdAt: Date.now()
    };
    // Dedupe by content: if an identical notification already exists it collapses
    // into the newest one instead of stacking a visual duplicate.
    setNotifications(prev => dedupeNotifications([newNotification, ...prev]));

    // Trigger Push Notification if supported
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(n.title, { body: n.message });
    }
  }, []);

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
