import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { CreateNotificationParams, NotificationRecord } from './notification.types.js';
import { PushService } from './push.service.js';
import { FirestorePublisherService } from './firestore_publisher.service.js';

export class NotificationService {
  /**
   * Dispatches a notification idempotently to persistent storage and triggers push.
   * If an idempotencyKey is provided and already exists, skips duplicate insertion gracefully.
   */
  public static async sendNotification(params: CreateNotificationParams): Promise<NotificationRecord | null> {
    const db = getDatabase();

    // 1. Idempotency pre-check
    if (params.idempotencyKey) {
      const existing = db
        .prepare('SELECT * FROM notifications WHERE idempotency_key = ?')
        .get(params.idempotencyKey) as any;

      if (existing) {
        return this.mapRowToRecord(existing);
      }
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const dataJson = params.data ? JSON.stringify(params.data) : null;

    try {
      db.prepare(`
        INSERT INTO notifications (
          id, organization_id, user_id, type, title, message,
          entity_type, entity_id, is_read, idempotency_key, data_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        id,
        params.organizationId,
        params.userId,
        params.type,
        params.title,
        params.message,
        params.entityType || null,
        params.entityId || null,
        params.idempotencyKey || null,
        dataJson,
        nowIso
      );
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed') && params.idempotencyKey) {
        const existing = db
          .prepare('SELECT * FROM notifications WHERE idempotency_key = ?')
          .get(params.idempotencyKey) as any;
        if (existing) return this.mapRowToRecord(existing);
      }
      throw err;
    }

    const createdRecord = this.getNotificationById(id);

    // 2. Trigger push notification asynchronously in background
    try {
      await PushService.dispatchPushToUser(params.userId, {
        title: params.title,
        body: params.message,
        data: {
          notificationId: id,
          type: params.type,
          entityType: params.entityType || '',
          entityId: params.entityId || '',
        },
      });
    } catch {
      // Push failure never fails in-app persistence
    }

    // 3. Trigger Firestore real-time synchronization in background (non-blocking)
    if (createdRecord) {
      try {
        await FirestorePublisherService.publishNotification(createdRecord);
      } catch {
        // Firestore failure must never fail in-app persistence or financial operations
      }
    }

    return createdRecord;
  }

  public static async sendToRoles(
    orgId: string,
    roles: Array<'PRESIDENT' | 'TREASURER'>,
    notificationInput:
      | ((recipientId: string) => CreateNotificationParams)
      | (Omit<CreateNotificationParams, 'userId' | 'organizationId'> & { idempotencyKey?: string }),
    excludeUserIds: string[] = []
  ): Promise<void> {
    const db = getDatabase();
    const placeholders = roles.map(() => '?').join(',');
    const users = db
      .prepare(`SELECT id FROM users WHERE organization_id = ? AND role IN (${placeholders}) AND is_active = 1`)
      .all(orgId, ...roles) as Array<{ id: string }>;

    for (const u of users) {
      if (excludeUserIds.includes(u.id)) continue;
      if (typeof notificationInput === 'function') {
        await this.sendNotification(notificationInput(u.id));
      } else {
        await this.sendNotification({
          ...notificationInput,
          organizationId: orgId,
          userId: u.id,
          idempotencyKey: notificationInput.idempotencyKey
            ? `${notificationInput.idempotencyKey}-${u.id}`
            : undefined,
        });
      }
    }
  }

  public static getNotifications(
    orgId: string,
    userId: string,
    options: { limit?: number; offset?: number; unreadOnly?: boolean; type?: string } = {}
  ): { notifications: NotificationRecord[]; total: number; unreadCount: number } {
    const db = getDatabase();
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);

    let whereClause = 'WHERE organization_id = ? AND user_id = ?';
    const params: any[] = [orgId, userId];

    if (options.unreadOnly) {
      whereClause += ' AND is_read = 0';
    }
    if (options.type) {
      whereClause += ' AND type = ?';
      params.push(options.type);
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) as count FROM notifications ${whereClause}`)
      .get(...params) as { count: number };

    const unreadRow = db
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE organization_id = ? AND user_id = ? AND is_read = 0')
      .get(orgId, userId) as { count: number };

    const rows = db
      .prepare(`SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];

    return {
      notifications: rows.map(r => this.mapRowToRecord(r)),
      total: totalRow.count,
      unreadCount: unreadRow.count,
    };
  }

  public static getUnreadCount(orgId: string, userId: string): number {
    const db = getDatabase();
    const row = db
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE organization_id = ? AND user_id = ? AND is_read = 0')
      .get(orgId, userId) as { count: number };
    return row.count;
  }

  public static markAsRead(orgId: string, userId: string, notificationId: string): NotificationRecord {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM notifications WHERE id = ?')
      .get(notificationId) as any;

    if (!row) {
      throw new AppError('सूचना सापडली नाही (Notification not found)', 404);
    }

    if (row.organization_id !== orgId || row.user_id !== userId) {
      throw new AppError('या सूचनेमध्ये बदल करण्याचा अधिकार नाही (Unauthorized)', 403);
    }

    if (row.is_read !== 1) {
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?').run(nowIso, notificationId);
      // Non-blocking Firestore sync
      FirestorePublisherService.updateReadState(orgId, notificationId, true, nowIso).catch(() => {});
    }

    return this.getNotificationById(notificationId)!;
  }

  public static markAllAsRead(orgId: string, userId: string): { updatedCount: number } {
    const db = getDatabase();
    const nowIso = new Date().toISOString();
    const result = db
      .prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE organization_id = ? AND user_id = ? AND is_read = 0')
      .run(nowIso, orgId, userId);

    // Non-blocking Firestore sync
    FirestorePublisherService.markAllAsReadForUser(orgId, userId).catch(() => {});

    return { updatedCount: Number(result.changes) };
  }

  public static getNotificationById(id: string): NotificationRecord | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as any;
    if (!r) return null;
    return this.mapRowToRecord(r);
  }

  private static mapRowToRecord(r: any): NotificationRecord {
    return {
      id: r.id,
      organizationId: r.organization_id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      message: r.message,
      entityType: r.entity_type || null,
      entityId: r.entity_id || null,
      isRead: Boolean(r.is_read),
      readAt: r.read_at || null,
      idempotencyKey: r.idempotency_key || null,
      dataJson: r.data_json || null,
      createdAt: r.created_at,
    };
  }
}
