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
let baseUrl: string;

before(async () => {
  seedDatabase();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr !== null) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
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
  FirestorePublisherService.setMockPublisherForTesting(null);
  FirestorePublisherService.clearLastPublishedForTesting();
});

afterEach(() => {
  FirestorePublisherService.setMockPublisherForTesting(null);
  FirestorePublisherService.clearLastPublishedForTesting();
});

describe('NTM Passbook — Batch 7C: Backend Firestore Real-Time Publishing & Foundation Suite', () => {
  // --------------------------------------------------------------------------
  // 1. Safe Degradation When Firebase Admin is Unconfigured
  // --------------------------------------------------------------------------
  test('1. FirestorePublisherService safely degrades when Firebase Admin is unconfigured', async () => {
    const sampleRecord: NotificationRecord = {
      id: 'notif-sample-01',
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'ANNOUNCEMENT' as any,
      title: 'चाचणी सूचना',
      message: 'चाचणी संदेश',
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    // Must complete without throwing
    await assert.doesNotReject(async () => {
      await FirestorePublisherService.publishNotification(sampleRecord);
    });

    await assert.doesNotReject(async () => {
      await FirestorePublisherService.updateReadState('org-ntm-001', 'notif-sample-01', true);
    });

    await assert.doesNotReject(async () => {
      await FirestorePublisherService.markAllAsReadForUser('org-ntm-001', 'usr-ntm-member-01');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Notification Creation Triggers Firestore Publishing
  // --------------------------------------------------------------------------
  test('2. NotificationService.sendNotification inserts into SQLite and dispatches to FirestorePublisherService', async () => {
    let capturedNotification: NotificationRecord | null = null;
    FirestorePublisherService.setMockPublisherForTesting(async (notif) => {
      capturedNotification = notif;
    });

    const notif = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'BISHI_DUE',
      title: 'बीसी हप्ता बाकी आहे',
      message: 'आपला बीसी हप्ता ₹1000 बाकी आहे',
      idempotencyKey: 'test-idemp-firestore-01',
    });

    assert.ok(notif, 'Notification record must be created in SQLite');
    assert.equal(notif.organizationId, 'org-ntm-001');
    assert.equal(notif.userId, 'usr-ntm-member-01');

    // Verify it was dispatched to Firestore publisher with identical authoritative fields
    assert.ok(capturedNotification);
    assert.equal(capturedNotification!.id, notif.id);
    assert.equal(capturedNotification!.organizationId, 'org-ntm-001');
    assert.equal(capturedNotification!.userId, 'usr-ntm-member-01');
    assert.equal(capturedNotification!.title, 'बीसी हप्ता बाकी आहे');
  });

  // --------------------------------------------------------------------------
  // 3. Firestore Publishing Failure Never Rolls Back SQLite Persistence
  // --------------------------------------------------------------------------
  test('3. Firestore publisher failure does NOT rollback or fail notification insertion in SQLite', async () => {
    // Simulate Firestore outage
    FirestorePublisherService.setMockPublisherForTesting(async () => {
      throw new Error('Firestore 503 Service Unavailable / Network Timeout');
    });

    const notif = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-president-01',
      type: 'SECURITY_EVENT',
      title: 'सुरक्षा सूचना',
      message: 'लॉगिन यश',
      idempotencyKey: 'test-idemp-firestore-fail-02',
    });

    // SQLite record MUST exist and be returned
    assert.ok(notif);
    const db = getDatabase();
    const row = db.prepare('SELECT id, title FROM notifications WHERE id = ?').get(notif.id) as any;
    assert.ok(row, 'Notification must be safely persisted in SQLite despite Firestore outage');
    assert.equal(row.title, 'सुरक्षा सूचना');
  });

  // --------------------------------------------------------------------------
  // 4. Mark As Read Triggers Firestore Read State Update
  // --------------------------------------------------------------------------
  test('4. markAsRead updates read state in SQLite and dispatches update to Firestore', async () => {
    let capturedOrgId: string | null = null;
    let capturedNotifId: string | null = null;
    let capturedIsRead: boolean | null = null;

    FirestorePublisherService.setMockPublisherForTesting(null, async (orgId, notifId, isRead) => {
      capturedOrgId = orgId;
      capturedNotifId = notifId;
      capturedIsRead = isRead;
    });

    // Create notification
    const notif = await NotificationService.sendNotification({
      organizationId: 'org-ntm-001',
      userId: 'usr-ntm-member-01',
      type: 'LOAN_REPAYMENT',
      title: 'कर्ज परतफेड नोंद',
      message: '₹5000 जमा झाले',
      idempotencyKey: 'test-idemp-firestore-read-03',
    });

    assert.ok(notif);
    const updated = NotificationService.markAsRead('org-ntm-001', 'usr-ntm-member-01', notif.id);
    assert.equal(updated.isRead, true);

    // Verify Firestore read updater received correct params
    assert.equal(capturedOrgId, 'org-ntm-001');
    assert.equal(capturedNotifId, notif.id);
    assert.equal(capturedIsRead, true);
  });

  // --------------------------------------------------------------------------
  // 5. Firestore Rules Integrity and Completeness Check
  // --------------------------------------------------------------------------
  test('5. firestore.rules exists and contains required tenant isolation, role checks, and financial lockout', () => {
    let rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    if (!fs.existsSync(rulesPath)) {
      rulesPath = path.resolve(process.cwd(), '../firestore.rules');
    }
    assert.ok(fs.existsSync(rulesPath), 'firestore.rules must exist at project root');

    const rulesContent = fs.readFileSync(rulesPath, 'utf8');

    // Verify rules version
    assert.match(rulesContent, /rules_version\s*=\s*'2';/);

    // Verify default deny
    assert.match(rulesContent, /match\s+\/\{document=\*\*\}\s*\{\s*allow read,\s*write:\s*if\s+false;\s*\}/);

    // Verify token organization claim check
    assert.match(rulesContent, /request\.auth\.token\.organizationId/);

    // Verify role claim check
    assert.match(rulesContent, /request\.auth\.token\.role/);

    // Verify member own-only restriction
    assert.match(rulesContent, /resource\.data\.userId\s*==\s*request\.auth\.uid/);

    // Verify client creation is blocked (server authoritative only)
    assert.match(rulesContent, /allow create,\s*delete:\s*if\s+false;/);

    // Verify financial collections are strictly blocked
    assert.match(rulesContent, /match\s+\/bishi\/\{doc=\*\*\}\s*\{\s*allow read,\s*write:\s*if\s+false;\s*\}/);
    assert.match(rulesContent, /match\s+\/loans\/\{doc=\*\*\}\s*\{\s*allow read,\s*write:\s*if\s+false;\s*\}/);
    assert.match(rulesContent, /match\s+\/expenses\/\{doc=\*\*\}\s*\{\s*allow read,\s*write:\s*if\s+false;\s*\}/);
    assert.match(rulesContent, /match\s+\/ledger\/\{doc=\*\*\}\s*\{\s*allow read,\s*write:\s*if\s+false;\s*\}/);

    // Verify no unrestricted allow read, write: if true;
    assert.doesNotMatch(rulesContent, /allow\s+read,\s*write:\s*if\s+true;/);
  });

  // --------------------------------------------------------------------------
  // 6. Android Google Services Configuration Verification
  // --------------------------------------------------------------------------
  test('6. Android google-services.json exists and contains correct package and project ID', () => {
    const androidJsonPath = path.resolve(process.cwd(), '../frontend/android/app/google-services.json');
    assert.ok(fs.existsSync(androidJsonPath), 'android google-services.json must exist');

    const content = JSON.parse(fs.readFileSync(androidJsonPath, 'utf8'));
    assert.equal(content.project_info.project_id, 'ntm-passbook');
    assert.equal(content.client[0].client_info.android_client_info.package_name, 'com.ntmpassbook.app');
  });

  // --------------------------------------------------------------------------
  // 7. iOS GoogleService-Info.plist Verification
  // --------------------------------------------------------------------------
  test('7. iOS GoogleService-Info.plist exists at target path with correct bundle ID and project ID', () => {
    const iosPlistPath = path.resolve(process.cwd(), '../frontend/ios/App/App/GoogleService-Info.plist');
    assert.ok(fs.existsSync(iosPlistPath), 'frontend/ios/App/App/GoogleService-Info.plist must exist');

    const plistContent = fs.readFileSync(iosPlistPath, 'utf8');
    assert.match(plistContent, /<key>BUNDLE_ID<\/key>\s*<string>com\.ntmpassbook\.app<\/string>/);
    assert.match(plistContent, /<key>PROJECT_ID<\/key>\s*<string>ntm-passbook<\/string>/);
    assert.match(plistContent, /<key>GOOGLE_APP_ID<\/key>\s*<string>1:1020947438093:ios:7488bd1b23d47ce3751344<\/string>/);
  });
});
