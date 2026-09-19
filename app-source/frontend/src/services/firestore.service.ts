import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { getFirebaseClientFirestore, isFirebaseConfigured } from '../config/firebase.js';
import { NotificationRecord } from '../api/notifications.js';

let mockNotificationSubscription: ((
  orgId: string,
  userId: string,
  onUpdate: (notifications: NotificationRecord[]) => void,
  onError?: (err: any) => void
) => () => void) | null = null;

let mockMarkReadHandler: ((orgId: string, notifId: string) => Promise<boolean>) | null = null;

export class FirestoreService {
  /**
   * Subscribes to real-time notification updates for the authenticated user within their organization.
   *
   * Security & Scope:
   * - Scoped strictly to the user's organization and user ID.
   * - Does not expose or mutate any financial data.
   * - Safely returns a no-op function if Firebase is offline or unconfigured.
   */
  public static subscribeToUserNotifications(
    organizationId: string,
    userId: string,
    onUpdate: (notifications: NotificationRecord[]) => void,
    onError?: (err: any) => void
  ): () => void {
    if (!organizationId || !userId) {
      return () => {};
    }

    // Testing hook for automated test suites
    if (mockNotificationSubscription) {
      return mockNotificationSubscription(organizationId, userId, onUpdate, onError);
    }

    if (!isFirebaseConfigured()) {
      return () => {};
    }

    const firestore = getFirebaseClientFirestore();
    if (!firestore) {
      return () => {};
    }

    try {
      const notifRef = collection(firestore, 'organizations', organizationId, 'notifications');
      const q = query(
        notifRef,
        where('userId', '==', userId),
        orderBy('created_at', 'desc'),
        limit(50)
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const notifications: NotificationRecord[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            notifications.push({
              id: data.id || docSnap.id,
              organizationId: data.organizationId || organizationId,
              userId: data.userId || userId,
              type: data.type,
              title: data.title,
              message: data.message,
              entityType: data.entityType || null,
              entityId: data.entityId || null,
              data: data.data_json ? JSON.parse(data.data_json) : null,
              isRead: Boolean(data.is_read),
              readAt: data.read_at || null,
              createdAt: data.created_at || new Date().toISOString(),
            });
          });
          onUpdate(notifications);
        },
        (err) => {
          console.warn('⚠️ Firestore notifications listener error (non-blocking, fallback to REST):', err?.message);
          if (onError) onError(err);
        }
      );

      return unsubscribe;
    } catch (err: any) {
      console.warn('⚠️ Could not establish Firestore listener (falling back to REST):', err?.message);
      return () => {};
    }
  }

  /**
   * Updates notification read state in Firestore.
   */
  public static async markNotificationReadInFirestore(
    organizationId: string,
    notificationId: string
  ): Promise<boolean> {
    if (!organizationId || !notificationId) return false;

    if (mockMarkReadHandler) {
      return mockMarkReadHandler(organizationId, notificationId);
    }

    if (!isFirebaseConfigured()) return false;

    const firestore = getFirebaseClientFirestore();
    if (!firestore) return false;

    try {
      const notifDoc = doc(firestore, 'organizations', organizationId, 'notifications', notificationId);
      await updateDoc(notifDoc, {
        is_read: 1,
        read_at: new Date().toISOString(),
      });
      return true;
    } catch (err: any) {
      console.warn('⚠️ Firestore mark-read failed (non-blocking):', err?.message);
      return false;
    }
  }

  /**
   * Guard: Financial ledger writes are strictly disallowed through Firestore.
   */
  public static forbidDirectFinancialWrites(): never {
    throw new Error(
      'DIRECT FINANCIAL WRITES IN FIRESTORE ARE STRICTLY FORBIDDEN. All financial mutations must pass through the authoritative SQLite backend.'
    );
  }

  /**
   * Testing helpers
   */
  public static setMockNotificationSubscriptionForTesting(
    fn: ((
      orgId: string,
      userId: string,
      onUpdate: (notifications: NotificationRecord[]) => void,
      onError?: (err: any) => void
    ) => () => void) | null,
    markReadFn: ((orgId: string, notifId: string) => Promise<boolean>) | null = null
  ): void {
    mockNotificationSubscription = fn;
    mockMarkReadHandler = markReadFn;
  }
}
