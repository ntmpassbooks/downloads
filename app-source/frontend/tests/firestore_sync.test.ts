import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFirebaseClientFirestore,
  resetFirebaseClientForTesting,
} from '../src/config/firebase.js';
import { FirestoreService } from '../src/services/firestore.service.js';
import { PushNotificationService } from '../src/services/pushNotification.service.js';
import { NotificationRecord } from '../src/api/notifications.js';

describe('NTM Passbook — Batch 7C: Frontend Firestore Real-Time Sync & Notification Suite', () => {
  beforeEach(() => {
    FirestoreService.setMockNotificationSubscriptionForTesting(null, null);
    resetFirebaseClientForTesting(null, null, null);
  });

  afterEach(() => {
    FirestoreService.setMockNotificationSubscriptionForTesting(null, null);
    resetFirebaseClientForTesting(null, null, null);
  });

  // --------------------------------------------------------------------------
  // TEST 1: getFirebaseClientFirestore handles unconfigured state safely
  // --------------------------------------------------------------------------
  test('1. getFirebaseClientFirestore returns null without throwing when unconfigured', () => {
    resetFirebaseClientForTesting(null, null, null);
    const firestore = getFirebaseClientFirestore();
    assert.equal(firestore, null, 'Firestore must return null safely when unconfigured');
  });

  // --------------------------------------------------------------------------
  // TEST 2: subscribeToUserNotifications handles unconfigured state with no-op
  // --------------------------------------------------------------------------
  test('2. subscribeToUserNotifications returns clean no-op unsubscribe when unconfigured', () => {
    resetFirebaseClientForTesting(null, null, null);
    let updateCalled = false;

    const unsubscribe = FirestoreService.subscribeToUserNotifications(
      'org-ntm-001',
      'usr-ntm-member-01',
      () => {
        updateCalled = true;
      }
    );

    assert.equal(typeof unsubscribe, 'function', 'Must return an unsubscribe function');
    assert.doesNotThrow(() => unsubscribe(), 'Calling unsubscribe must not throw');
    assert.equal(updateCalled, false);
  });

  // --------------------------------------------------------------------------
  // TEST 3: subscribeToUserNotifications maps and delivers real-time notifications
  // --------------------------------------------------------------------------
  test('3. subscribeToUserNotifications delivers mapped real-time NotificationRecord array', () => {
    const mockNotifications: NotificationRecord[] = [
      {
        id: 'notif-rt-01',
        organizationId: 'org-ntm-001',
        userId: 'usr-ntm-member-01',
        type: 'BISHI_DUE',
        title: 'नवीन बीसी हप्ता',
        message: '₹1000 बाकी आहे',
        isRead: false,
        createdAt: '2026-09-17T12:00:00.000Z',
      },
      {
        id: 'notif-rt-02',
        organizationId: 'org-ntm-001',
        userId: 'usr-ntm-member-01',
        type: 'PAYMENT_VERIFIED',
        title: 'पावती जमा झाली',
        message: 'आपली पावती तयार झाली आहे',
        isRead: true,
        readAt: '2026-09-17T12:30:00.000Z',
        createdAt: '2026-09-17T12:15:00.000Z',
      },
    ];

    let receivedList: NotificationRecord[] = [];
    FirestoreService.setMockNotificationSubscriptionForTesting((orgId, userId, onUpdate) => {
      assert.equal(orgId, 'org-ntm-001');
      assert.equal(userId, 'usr-ntm-member-01');
      onUpdate(mockNotifications);
      return () => {};
    });

    const unsub = FirestoreService.subscribeToUserNotifications(
      'org-ntm-001',
      'usr-ntm-member-01',
      (notifs) => {
        receivedList = notifs;
      }
    );

    assert.equal(receivedList.length, 2);
    assert.equal(receivedList[0].id, 'notif-rt-01');
    assert.equal(receivedList[0].isRead, false);
    assert.equal(receivedList[1].isRead, true);
    unsub();
  });

  // --------------------------------------------------------------------------
  // TEST 4: Multi-tenant and user isolation in Firestore subscription
  // --------------------------------------------------------------------------
  test('4. Real-time subscription strictly enforces organizationId and userId scoping', () => {
    let capturedOrgId = '';
    let capturedUserId = '';

    FirestoreService.setMockNotificationSubscriptionForTesting((orgId, userId) => {
      capturedOrgId = orgId;
      capturedUserId = userId;
      return () => {};
    });

    FirestoreService.subscribeToUserNotifications(
      'org-jhm-002',
      'usr-jhm-member-02',
      () => {}
    );

    assert.equal(capturedOrgId, 'org-jhm-002', 'Must scope subscription to Org 2');
    assert.equal(capturedUserId, 'usr-jhm-member-02', 'Must scope subscription to User 2');
    assert.notEqual(capturedOrgId, 'org-ntm-001');
  });

  // --------------------------------------------------------------------------
  // TEST 5: markNotificationReadInFirestore updates state safely
  // --------------------------------------------------------------------------
  test('5. markNotificationReadInFirestore invokes update and returns true', async () => {
    let capturedNotifId = '';
    let capturedOrg = '';

    FirestoreService.setMockNotificationSubscriptionForTesting(null, async (orgId, notifId) => {
      capturedOrg = orgId;
      capturedNotifId = notifId;
      return true;
    });

    const result = await FirestoreService.markNotificationReadInFirestore('org-ntm-001', 'notif-123');
    assert.equal(result, true);
    assert.equal(capturedOrg, 'org-ntm-001');
    assert.equal(capturedNotifId, 'notif-123');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Financial mutation lockout guard in FirestoreService
  // --------------------------------------------------------------------------
  test('6. FirestoreService.forbidDirectFinancialWrites throws to prevent client-side financial mutations', () => {
    assert.throws(
      () => {
        FirestoreService.forbidDirectFinancialWrites();
      },
      /DIRECT FINANCIAL WRITES IN FIRESTORE ARE STRICTLY FORBIDDEN/,
      'Must strictly reject direct financial mutations through Firestore'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 7: PushNotificationService platform detection
  // --------------------------------------------------------------------------
  test('7. PushNotificationService.getPlatform returns WEB in node/web environment', () => {
    const platform = PushNotificationService.getPlatform();
    assert.equal(platform, 'WEB');
  });

  // --------------------------------------------------------------------------
  // TEST 8: PushNotificationService registerDevice graceful foundation status
  // --------------------------------------------------------------------------
  test('8. PushNotificationService.registerDevice returns safe status without fabricating fake tokens', async () => {
    const result = await PushNotificationService.registerDevice();
    assert.ok(result);
    assert.equal(result.platform, 'WEB');
    assert.equal(result.token, undefined, 'Must never fabricate fake push tokens');
    assert.ok(
      result.status === 'UNSUPPORTED' || result.status === 'PENDING_PHYSICAL_DEVICE' || result.status === 'PERMISSION_DENIED',
      'Must return valid non-falsified status'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 9: Missing parameters in subscribeToUserNotifications return clean no-op
  // --------------------------------------------------------------------------
  test('9. Missing organizationId or userId safely returns no-op without attempting subscription', () => {
    let callAttempted = false;
    FirestoreService.setMockNotificationSubscriptionForTesting(() => {
      callAttempted = true;
      return () => {};
    });

    const unsub1 = FirestoreService.subscribeToUserNotifications('', 'usr-1', () => {});
    const unsub2 = FirestoreService.subscribeToUserNotifications('org-1', '', () => {});

    assert.equal(callAttempted, false);
    assert.doesNotThrow(() => unsub1());
    assert.doesNotThrow(() => unsub2());
  });

  // --------------------------------------------------------------------------
  // TEST 10: markNotificationReadInFirestore gracefully fails with missing parameters
  // --------------------------------------------------------------------------
  test('10. markNotificationReadInFirestore safely returns false with empty parameters', async () => {
    const res1 = await FirestoreService.markNotificationReadInFirestore('', 'notif-1');
    const res2 = await FirestoreService.markNotificationReadInFirestore('org-1', '');
    assert.equal(res1, false);
    assert.equal(res2, false);
  });
});
