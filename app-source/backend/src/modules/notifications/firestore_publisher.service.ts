import { getFirebaseFirestore } from '../../config/firebaseAdmin.js';
import { NotificationRecord } from './notification.types.js';

let mockPublisher: ((notification: NotificationRecord) => Promise<void>) | null = null;
let mockReadStateUpdater: ((orgId: string, notificationId: string, isRead: boolean) => Promise<void>) | null = null;
let mockMarkAllAsReadUpdater: ((orgId: string, userId: string) => Promise<void>) | null = null;
let lastPublished: NotificationRecord | null = null;

export class FirestorePublisherService {
  /**
   * Publishes an authoritative notification to Firestore for real-time client synchronization.
   *
   * Rules:
   * - Derives organizationId and userId strictly from the authoritative database record.
   * - Failure MUST NOT fail or roll back the calling financial transaction.
   * - Logs safe diagnostic info without secrets.
   */
  public static async publishNotification(notification: NotificationRecord): Promise<void> {
    if (!notification || !notification.id || !notification.organizationId) {
      return;
    }

    lastPublished = notification;

    if (mockPublisher) {
      try {
        await mockPublisher(notification);
      } catch (err: any) {
        console.warn('⚠️ Mock Firestore publisher error:', err?.message || 'Unknown');
      }
      return;
    }

    const firestore = getFirebaseFirestore();
    if (!firestore) {
      // Firebase Admin Firestore not configured; SQLite remains the authoritative source
      return;
    }

    try {
      const docRef = firestore
        .collection('organizations')
        .doc(notification.organizationId)
        .collection('notifications')
        .doc(notification.id);

      await docRef.set({
        id: notification.id,
        organizationId: notification.organizationId,
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        entityType: notification.entityType || null,
        entityId: notification.entityId || null,
        is_read: notification.isRead ? 1 : 0,
        read_at: notification.readAt || null,
        created_at: notification.createdAt,
        data_json: notification.dataJson || null,
      }, { merge: true });
    } catch (error: any) {
      // Non-blocking: Firestore publishing failure MUST NOT rollback the financial transaction
      console.warn(
        '⚠️ Firestore notification publishing failed (non-blocking, SQLite intact):',
        error?.message || 'Unknown error'
      );
    }
  }

  /**
   * Updates read state of a notification in Firestore.
   */
  public static async updateReadState(
    organizationId: string,
    notificationId: string,
    isRead: boolean,
    readAt?: string | null
  ): Promise<void> {
    if (!organizationId || !notificationId) return;

    if (mockReadStateUpdater) {
      try {
        await mockReadStateUpdater(organizationId, notificationId, isRead);
      } catch {
        // Non-blocking
      }
      return;
    }

    const firestore = getFirebaseFirestore();
    if (!firestore) return;

    try {
      const docRef = firestore
        .collection('organizations')
        .doc(organizationId)
        .collection('notifications')
        .doc(notificationId);

      await docRef.update({
        is_read: isRead ? 1 : 0,
        read_at: readAt || null,
        updated_at: new Date().toISOString(),
      });
    } catch (error: any) {
      // Non-blocking
      console.warn('⚠️ Firestore read state update failed:', error?.message || 'Unknown error');
    }
  }

  /**
   * Batch updates all unread notifications for a user in Firestore.
   */
  public static async markAllAsReadForUser(organizationId: string, userId: string): Promise<void> {
    if (!organizationId || !userId) return;

    if (mockMarkAllAsReadUpdater) {
      try {
        await mockMarkAllAsReadUpdater(organizationId, userId);
      } catch {
        // Non-blocking
      }
      return;
    }

    const firestore = getFirebaseFirestore();
    if (!firestore) return;

    try {
      const snapshot = await firestore
        .collection('organizations')
        .doc(organizationId)
        .collection('notifications')
        .where('userId', '==', userId)
        .where('is_read', '==', 0)
        .get();

      if (snapshot.empty) return;

      const batch = firestore.batch();
      const nowIso = new Date().toISOString();
      snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          is_read: 1,
          read_at: nowIso,
          updated_at: nowIso,
        });
      });

      await batch.commit();
    } catch (error: any) {
      // Non-blocking
      console.warn('⚠️ Firestore mark-all-read batch update failed:', error?.message || 'Unknown error');
    }
  }

  /**
   * Test hooks for automated tests
   */
  public static setMockPublisherForTesting(
    publisher: ((notification: NotificationRecord) => Promise<void>) | null,
    readUpdater: ((orgId: string, notificationId: string, isRead: boolean) => Promise<void>) | null = null,
    markAllUpdater: ((orgId: string, userId: string) => Promise<void>) | null = null
  ): void {
    mockPublisher = publisher;
    mockReadStateUpdater = readUpdater;
    mockMarkAllAsReadUpdater = markAllUpdater;
  }

  public static getLastPublishedNotification(): NotificationRecord | null {
    return lastPublished;
  }

  public static clearLastPublishedForTesting(): void {
    lastPublished = null;
    mockPublisher = null;
    mockReadStateUpdater = null;
    mockMarkAllAsReadUpdater = null;
  }
}
