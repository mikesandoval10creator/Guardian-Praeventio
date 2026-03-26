import React, { createContext, useContext, useState, useEffect } from 'react';

export type NotificationType = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
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
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    const saved = localStorage.getItem('praeventio_notifications');
    return saved ? JSON.parse(saved) : [
      { id: '1', title: 'Bienvenido a Praeventio Guard', message: 'Tu sistema de gestión de seguridad está listo.', type: 'success', time: 'Ahora', read: false, createdAt: Date.now() }
    ];
  });

  useEffect(() => {
    localStorage.setItem('praeventio_notifications', JSON.stringify(notifications));
  }, [notifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const addNotification = (n: Omit<Notification, 'id' | 'time' | 'read' | 'createdAt'>) => {
    const newNotification: Notification = {
      ...n,
      id: crypto.randomUUID(),
      time: 'Ahora',
      read: false,
      createdAt: Date.now()
    };
    setNotifications(prev => [newNotification, ...prev]);
    
    // Simulate Push Notification if supported
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(n.title, { body: n.message });
    }
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAsRead, markAllAsRead, clearAll }}>
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
