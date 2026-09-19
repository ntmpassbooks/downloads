import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { DeviceTokenRecord, PushPayload, PushPlatform, PushDeliveryResult } from './notification.types.js';

export interface IPushNotificationProvider {
  sendPush(tokens: string[], payload: PushPayload, platform: PushPlatform): Promise<PushDeliveryResult>;
}

export class MockPushNotificationProvider implements IPushNotificationProvider {
  public async sendPush(tokens: string[], _payload: PushPayload, _platform: PushPlatform): Promise<PushDeliveryResult> {
    return {
      successful: tokens.length,
      failed: 0,
      invalidTokens: [],
    };
  }
}

export class PushService {
  private static provider: IPushNotificationProvider = new MockPushNotificationProvider();

  public static setProvider(provider: IPushNotificationProvider): void {
    this.provider = provider;
  }

  public static registerDeviceToken(
    orgId: string,
    userId: string,
    deviceToken: string,
    platform: PushPlatform,
    deviceName?: string
  ): DeviceTokenRecord {
    const db = getDatabase();
    const cleanToken = deviceToken.trim();
    if (!cleanToken) {
      throw new Error('Device token cannot be empty');
    }

    const nowIso = new Date().toISOString();
    const existing = db
      .prepare('SELECT id, is_active FROM device_tokens WHERE user_id = ? AND device_token = ?')
      .get(userId, cleanToken) as { id: string; is_active: number } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE device_tokens 
        SET is_active = 1, updated_at = ?, last_used_at = ?, device_name = COALESCE(?, device_name)
        WHERE id = ?
      `).run(nowIso, nowIso, deviceName || null, existing.id);

      return this.getTokenById(existing.id)!;
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO device_tokens (id, organization_id, user_id, device_token, platform, device_name, is_active, created_at, updated_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(id, orgId, userId, cleanToken, platform, deviceName || null, nowIso, nowIso, nowIso);

    return this.getTokenById(id)!;
  }

  public static unregisterDeviceToken(userId: string, deviceToken: string): void {
    const db = getDatabase();
    db.prepare('UPDATE device_tokens SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND device_token = ?').run(userId, deviceToken.trim());
  }

  public static unregisterAllUserTokens(userId: string): void {
    const db = getDatabase();
    db.prepare('UPDATE device_tokens SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(userId);
  }

  public static getActiveTokensForUser(userId: string): DeviceTokenRecord[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM device_tokens WHERE user_id = ? AND is_active = 1').all(userId) as any[];
    return rows.map(r => ({
      id: r.id,
      organizationId: r.organization_id,
      userId: r.user_id,
      deviceToken: r.device_token,
      platform: r.platform as PushPlatform,
      deviceName: r.device_name,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastUsedAt: r.last_used_at,
    }));
  }

  public static async dispatchPushToUser(userId: string, payload: PushPayload): Promise<PushDeliveryResult> {
    const tokens = this.getActiveTokensForUser(userId);
    if (tokens.length === 0) {
      return { successful: 0, failed: 0, invalidTokens: [] };
    }

    const androidTokens = tokens.filter(t => t.platform === 'ANDROID').map(t => t.deviceToken);
    const iosTokens = tokens.filter(t => t.platform === 'IOS').map(t => t.deviceToken);
    const webTokens = tokens.filter(t => t.platform === 'WEB').map(t => t.deviceToken);

    let totalSuccess = 0;
    let totalFail = 0;
    const allInvalid: string[] = [];

    const platforms: Array<{ list: string[]; platform: PushPlatform }> = [
      { list: androidTokens, platform: 'ANDROID' },
      { list: iosTokens, platform: 'IOS' },
      { list: webTokens, platform: 'WEB' },
    ];

    for (const p of platforms) {
      if (p.list.length > 0) {
        try {
          const res = await this.provider.sendPush(p.list, payload, p.platform);
          totalSuccess += res.successful;
          totalFail += res.failed;
          if (res.invalidTokens.length > 0) {
            allInvalid.push(...res.invalidTokens);
          }
        } catch {
          totalFail += p.list.length;
        }
      }
    }

    if (allInvalid.length > 0) {
      const db = getDatabase();
      for (const inv of allInvalid) {
        db.prepare('UPDATE device_tokens SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE device_token = ?').run(inv);
      }
    }

    return {
      successful: totalSuccess,
      failed: totalFail,
      invalidTokens: allInvalid,
    };
  }

  private static getTokenById(id: string): DeviceTokenRecord | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM device_tokens WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      organizationId: r.organization_id,
      userId: r.user_id,
      deviceToken: r.device_token,
      platform: r.platform as PushPlatform,
      deviceName: r.device_name,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastUsedAt: r.last_used_at,
    };
  }
}
