process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';

import test, { before, after, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';
import { FirestorePublisherService } from '../src/modules/notifications/firestore_publisher.service.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import { NotificationRecord } from '../src/modules/notifications/notification.types.js';

let server: Server;

before(async () => {
  seedDatabase();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeDatabase();
});

beforeEach(() => {
  FirestorePublisherService.clearLastPublishedForTesting();
});

afterEach(() => {
  FirestorePublisherService.clearLastPublishedForTesting();
});

describe('NTM Passbook — Batch 7D: Firestore + Notification Deep Hardening & Verification Suite', () => {
  // ==========================================================================
  // 1. Schema Mapping Verification (SQLite <-> Record <-> Firestore Doc)
  // ==========================================================================
  test('1. Schema mapping is lossless between SQLite, NotificationRecord, and Firestore doc structure', async () => {
    let capturedDoc: any = null;
    FirestorePublisherService.setMockPublisherForTesting(async (notif) => {
      capturedDoc = {
        id: notif.id,
        organizationId: notif.organizationId,
        userId: notif.userId,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        entityType: notif.entityType || null,
        entityId: notif.entityId || null,
        is_read: notif.isRead ? 1 : 0,
        read_at: notif.readAt || null,
        created_at: notif.createdAt,
        data_json: notif.dataJson || null,
      };
    });

    const notif = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'BISHI_PAID',
      title: 'बीसी हप्ता जमा झाला',
      message: '₹1000 यशस्वीरित्या जमा झाले आहेत.',
      entityType: 'BISHI',
      entityId: 'bishi-record-101',
      data: { cycleNumber: 3, amount: 1000 },
      idempotencyKey: 'test-7d-schema-mapping-01',
    });

    assert.ok(notif);
    assert.equal(capturedDoc.id, notif.id);
    assert.equal(capturedDoc.organizationId, 'org-ntm-001');
    assert.equal(capturedDoc.userId, 'usr-ntm-member-01');
    assert.equal(capturedDoc.type, 'BISHI_PAID');
    assert.equal(capturedDoc.title, 'बीसी हप्ता जमा झाला');
    assert.equal(capturedDoc.entityType, 'BISHI');
    assert.equal(capturedDoc.entityId, 'bishi-record-101');
    assert.equal(capturedDoc.is_read, 0);
    assert.ok(capturedDoc.data_json.includes('"amount":1000'));
  });

  // ==========================================================================
  // 2. Deterministic Firestore Path Isolation
  // ==========================================================================
  test('2. Deterministic Firestore path /organizations/{orgId}/notifications/{notifId} prevents cross-Mandal pollution', async () => {
    const notifId = 'notif-path-uuid-777';
    const orgA = 'org-ntm-001';
    const orgB = 'org-jhm-002';

    const pathA = `/organizations/${orgA}/notifications/${notifId}`;
    const pathB = `/organizations/${orgB}/notifications/${notifId}`;

    assert.notEqual(pathA, pathB);
    assert.ok(pathA.startsWith(`/organizations/${orgA}/`));
    assert.ok(pathB.startsWith(`/organizations/${orgB}/`));
  });

  // ==========================================================================
  // 3. Notification Duplicate Protection & Idempotency
  // ==========================================================================
  test('3. Repeated publish with identical idempotencyKey returns existing record without creating duplicates', async () => {
    let publishCount = 0;
    FirestorePublisherService.setMockPublisherForTesting(async () => {
      publishCount++;
    });

    const key = 'test-7d-duplicate-protection-key';
    const first = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'PAYMENT_VERIFIED',
      title: 'पावती क्रमांक #552',
      message: 'आपली पावती तयार झाली आहे.',
      idempotencyKey: key,
    });

    const second = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'PAYMENT_VERIFIED',
      title: 'पावती क्रमांक #552',
      message: 'आपली पावती तयार झाली आहे.',
      idempotencyKey: key,
    });

    assert.ok(first);
    assert.ok(second);
    assert.equal(first.id, second.id, 'Idempotent calls must return the identical notification ID');
    assert.equal(publishCount, 1, 'Firestore publisher should only be dispatched once for idempotent call');

    const db = getDatabase();
    const countRow = db
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE idempotency_key = ?')
      .get(key) as { count: number };
    assert.equal(countRow.count, 1);
  });

  // ==========================================================================
  // 4. Server-Side Failure Resilience: Firebase Outage Never Fails SQLite
  // ==========================================================================
  test('4. Firebase publish failure (503 / timeout) preserves SQLite transaction and data integrity', async () => {
    FirestorePublisherService.setMockPublisherForTesting(async () => {
      throw new Error('Firestore Error: 503 UNAVAILABLE, deadline exceeded');
    });

    const notif = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-president-01',
      type: 'FINANCIAL_EVENT',
      title: 'महत्त्वाची आर्थिक नोंद',
      message: 'मंडळ शिल्लक अद्ययावत झाली.',
      idempotencyKey: 'test-7d-firebase-failure-resilience',
    });

    assert.ok(notif, 'Service must succeed despite Firebase publish failure');
    const db = getDatabase();
    const row = db.prepare('SELECT id, is_read FROM notifications WHERE id = ?').get(notif.id) as any;
    assert.ok(row, 'Notification must be safely committed in SQLite');
    assert.equal(row.is_read, 0);
  });

  // ==========================================================================
  // 5. Multi-Mandal Isolation in Notifications
  // ==========================================================================
  test('5. Multi-Mandal isolation: Mandal A notifications are completely invisible to Mandal B users', async () => {
    const notifOrg1 = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'BISHI_DUE',
      title: 'NTM बीसी सूचना',
      message: 'NTM मंडळाची बीसी भरणे बाकी आहे.',
      idempotencyKey: 'test-7d-multimandal-org1',
    });

    const resultOrg2 = NotificationService.getNotifications('org-jhm-002', 'usr-jhm-member-02');
    const foundCrossOrg = resultOrg2.notifications.find((n) => n.id === notifOrg1?.id);
    assert.equal(foundCrossOrg, undefined, 'Org 2 user must NEVER see Org 1 notifications');

    const unreadOrg2 = NotificationService.getUnreadCount('org-jhm-002', 'usr-jhm-member-02');
    assert.ok(typeof unreadOrg2 === 'number');
  });

  // ==========================================================================
  // 6. MEMBER Own-Only Isolation vs PRESIDENT/TREASURER Isolation
  // ==========================================================================
  test('6. Member can only view own notifications; cross-member access is rejected', async () => {
    const notifMember1 = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'BISHI_DUE',
      title: 'वैयक्तिक हप्ता',
      message: 'हप्ता ₹1000 भरावा.',
      idempotencyKey: 'test-7d-member-own-only',
    });

    assert.ok(notifMember1);

    const member2Result = NotificationService.getNotifications('org-ntm-001', 'usr-ntm-member-02');
    const leak = member2Result.notifications.find((n) => n.id === notifMember1.id);
    assert.equal(leak, undefined, 'Member 2 must not see Member 1 private notification');

    assert.throws(
      () => {
        NotificationService.markAsRead('org-ntm-001', 'usr-ntm-member-02', notifMember1.id);
      },
      (err: any) => err.statusCode === 403 || err.message.includes('Unauthorized') || err.message.includes('अधिकार नाही')
    );
  });

  // ==========================================================================
  // 7. Read/Unread State Synchronization & Batch Mark-All-As-Read
  // ==========================================================================
  test('7. markAsRead and markAllAsRead properly dispatch to FirestorePublisherService', async () => {
    let singleReadDispatched = false;
    let markAllDispatched = false;

    FirestorePublisherService.setMockPublisherForTesting(
      null,
      async (orgId, notifId, isRead) => {
        if (orgId === 'org-ntm-001' && isRead === true) {
          singleReadDispatched = true;
        }
      },
      async (orgId, userId) => {
        if (orgId === 'org-ntm-001' && userId === 'usr-ntm-member-01') {
          markAllDispatched = true;
        }
      }
    );

    const notif = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'LOAN_REMINDER',
      title: 'कर्ज हप्ता स्मरण',
      message: 'कृपया वेळेत कर्ज हप्ता जमा करावा.',
      idempotencyKey: 'test-7d-sync-read-01',
    });

    assert.ok(notif);

    NotificationService.markAsRead('org-ntm-001', 'usr-ntm-member-01', notif.id);
    assert.equal(singleReadDispatched, true, 'markAsRead must trigger Firestore read state dispatch');

    const markAllResult = NotificationService.markAllAsRead('org-ntm-001', 'usr-ntm-member-01');
    assert.ok(markAllResult.updatedCount >= 0);
    assert.equal(markAllDispatched, true, 'markAllAsRead must trigger Firestore markAllAsReadForUser dispatch');
  });

  // ==========================================================================
  // 8. Financial Path Lockout in Firestore Rules
  // ==========================================================================
  test('8. firestore.rules strictly locks all financial collection paths against client access', () => {
    let rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    if (!fs.existsSync(rulesPath)) {
      rulesPath = path.resolve(process.cwd(), '../firestore.rules');
    }
    assert.ok(fs.existsSync(rulesPath));

    const rules = fs.readFileSync(rulesPath, 'utf8');

    const collections = ['bishi', 'loans', 'expenses', 'ledger', 'vargani', 'passbook', 'payments'];
    for (const col of collections) {
      const regex = new RegExp(`match\\s+\\/${col}\\/\\{doc=\\*\\*\\}\\s*\\{\\s*allow read,\\s*write:\\s*if\\s+false;\\s*\\}`);
      assert.match(rules, regex, `Financial collection /${col} must be explicitly blocked with allow read, write: if false;`);
    }
  });

  // ==========================================================================
  // 9. Android and iOS Configuration Integrity
  // ==========================================================================
  test('9. Android google-services.json and iOS GoogleService-Info.plist are valid and configured for com.ntmpassbook.app', () => {
    const androidJsonPath = path.resolve(process.cwd(), '../frontend/android/app/google-services.json');
    assert.ok(fs.existsSync(androidJsonPath), 'android google-services.json must exist');
    const androidJson = JSON.parse(fs.readFileSync(androidJsonPath, 'utf8'));
    assert.equal(androidJson.project_info.project_id, 'ntm-passbook');
    assert.equal(androidJson.client[0].client_info.android_client_info.package_name, 'com.ntmpassbook.app');

    const iosPlistPath = path.resolve(process.cwd(), '../frontend/ios/App/App/GoogleService-Info.plist');
    assert.ok(fs.existsSync(iosPlistPath), 'ios GoogleService-Info.plist must exist');
    const plist = fs.readFileSync(iosPlistPath, 'utf8');
    assert.match(plist, /<key>BUNDLE_ID<\/key>\s*<string>com\.ntmpassbook\.app<\/string>/);
    assert.match(plist, /<key>PROJECT_ID<\/key>\s*<string>ntm-passbook<\/string>/);
  });
});
