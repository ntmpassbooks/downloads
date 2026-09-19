import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  NotificationRecord,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  registerDeviceToken,
} from '../api/notifications';
import { FirestoreService } from '../services/firestore.service';

interface NotificationContextType {
  notifications: NotificationRecord[];
  unreadCount: number;
  isOpen: boolean;
  isLoading: boolean;
  openNotifications: () => void;
  closeNotifications: () => void;
  refreshNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  registerPushDevice: (deviceToken: string, platform?: 'ANDROID' | 'IOS' | 'WEB', deviceName?: string) => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const loadUnreadCount = useCallback(async () => {
    if (!token || !user) {
      setUnreadCount(0);
      return;
    }
    const res = await fetchUnreadCount();
    if (res.success && res.unreadCount !== undefined) {
      setUnreadCount(res.unreadCount);
    }
  }, [token, user]);

  const loadNotifications = useCallback(async () => {
    if (!token || !user) {
      setNotifications([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetchNotifications({ limit: 50 });
      if (res.success && res.data) {
        setNotifications(res.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    if (token && user) {
      loadUnreadCount();
      loadNotifications();

      // Batch 7C: Connect real-time Firestore notification subscription
      const unsubscribeFirestore = FirestoreService.subscribeToUserNotifications(
        user.organizationId,
        user.id,
        (realtimeNotifications) => {
          if (realtimeNotifications && realtimeNotifications.length > 0) {
            setNotifications(realtimeNotifications);
            const unread = realtimeNotifications.filter((n) => !n.isRead).length;
            setUnreadCount(unread);
          }
        }
      );

      // Fallback 30-second polling for environments without active Firebase or when offline
      const interval = setInterval(loadUnreadCount, 30000);

      return () => {
        clearInterval(interval);
        unsubscribeFirestore();
      };
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [token, user, loadUnreadCount, loadNotifications]);

  const openNotifications = () => {
    setIsOpen(true);
    loadNotifications();
    loadUnreadCount();
  };

  const closeNotifications = () => {
    setIsOpen(false);
  };

  const markAsRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    // Authoritative SQLite backend update
    await markNotificationAsRead(id);

    // Non-blocking Firestore sync
    if (user?.organizationId) {
      FirestoreService.markNotificationReadInFirestore(user.organizationId, id).catch(() => {});
    }

    loadUnreadCount();
  };

  const markAllAsRead = async () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
    );
    setUnreadCount(0);

    await markAllNotificationsAsRead();
    loadUnreadCount();
  };

  const registerPushDevice = async (
    deviceToken: string,
    platform: 'ANDROID' | 'IOS' | 'WEB' = 'WEB',
    deviceName?: string
  ): Promise<boolean> => {
    if (!token || !user) return false;
    const res = await registerDeviceToken({ deviceToken, platform, deviceName });
    return res.success;
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isOpen,
        isLoading,
        openNotifications,
        closeNotifications,
        refreshNotifications: loadNotifications,
        markAsRead,
        markAllAsRead,
        registerPushDevice,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
