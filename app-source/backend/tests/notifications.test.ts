process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import { BishiSchedulerService } from '../src/modules/notifications/bishi_scheduler.service.js';
import { PushService } from '../src/modules/notifications/push.service.js';

let server: Server;
let baseUrl: string;

function cleanDatabase() {
  runMigrations();
  const db = getDatabase();
  db.exec('DELETE FROM audit_logs;');
  db.exec('DELETE FROM device_tokens;');
  db.exec('DELETE FROM notifications;');
  db.exec('DELETE FROM expenses;');
  db.exec('DELETE FROM loan_repayments;');
  db.exec('DELETE FROM loans;');
  db.exec('DELETE FROM financial_transactions;');
  db.exec('DELETE FROM bishi_records;');
  db.exec('DELETE FROM bishi_configs;');
  db.exec('DELETE FROM payment_orders;');
  db.exec('DELETE FROM payment_configs;');
  db.exec('DELETE FROM sessions;');
  db.exec('DELETE FROM users;');
  db.exec('DELETE FROM organizations;');
}

before(async () => {
  cleanDatabase();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr !== null) {
        baseUrl = 'http://127.0.0.1:' + addr.port;
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

describe('NTM Passbook — Real Multi-Tenant Notification System Tests', () => {
  let presidentToken: string;
  let memberToken: string;
  let member2Token: string;
  let orgId: string;
  let presidentId: string;
  let memberId: string;
  let member2Id: string;

  test('1. Setup Mandal, President, and Members', async () => {
    // 1. Register first President
    const regRes = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवनेरी तरुण मंडळ',
        fullName: 'सचिन कदम',
        phone: '9820011221',
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    presidentToken = regData.token;
    orgId = regData.organization.id;
    presidentId = regData.user.id;

    // 2. Create Member 1
    const m1Res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        fullName: 'अमोल शिंदे',
        phone: '9820011222',
        pin: '1234',
        role: 'MEMBER',
      }),
    });
    assert.equal(m1Res.status, 201);
    const m1Data = await m1Res.json();
    memberId = m1Data.data.id;

    // 3. Create Member 2
    const m2Res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        fullName: 'प्रशांत पाटील',
        phone: '9820011223',
        pin: '1234',
        role: 'MEMBER',
      }),
    });
    assert.equal(m2Res.status, 201);
    const m2Data = await m2Res.json();
    member2Id = m2Data.data.id;

    // Log in as Member 1
    const l1Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9820011222', pin: '1234' }),
    });
    assert.equal(l1Res.status, 200);
    const l1Data = await l1Res.json();
    memberToken = l1Data.token;

    // Log in as Member 2
    const l2Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9820011223', pin: '1234' }),
    });
    assert.equal(l2Res.status, 200);
    const l2Data = await l2Res.json();
    member2Token = l2Data.token;
  });

  test('2. Unread notification count starts at 0 for new member', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.unreadCount, 0);
  });

  test('3. Direct notification dispatch sends notification and increments unread count', async () => {
    const notif = await NotificationService.sendNotification({
      organizationId: orgId,
      userId: memberId,
      type: 'BISHI_DUE',
      title: 'बिशी देय स्मरणपत्र',
      message: 'आपली या महिन्याची बिशी ₹१००० देय आहे.',
      entityType: 'BISHI',
      entityId: 'rec_1001',
      idempotencyKey: 'test-due-1001',
    });
    assert.ok(notif);
    assert.equal(notif.isRead, false);

    // Verify unread count is now 1
    const res = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unreadCount, 1);
  });

  test('4. Idempotency Key prevents duplicate notification creation', async () => {
    // Attempt to dispatch with identical idempotencyKey
    const duplicate = await NotificationService.sendNotification({
      organizationId: orgId,
      userId: memberId,
      type: 'BISHI_DUE',
      title: 'बिशी देय स्मरणपत्र (Duplicate attempt)',
      message: 'आपली या महिन्याची बिशी ₹१००० देय आहे.',
      entityType: 'BISHI',
      entityId: 'rec_1001',
      idempotencyKey: 'test-due-1001',
    });

    // Should return the original record without creating a second one
    assert.ok(duplicate);
    assert.equal(duplicate.idempotencyKey, 'test-due-1001');

    // Count must remain 1
    const res = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal((await res.json()).unreadCount, 1);
  });

  test('5. List notifications returns member notifications with pagination and metadata', async () => {
    const res = await fetch(`${baseUrl}/api/notifications?limit=10&offset=0`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].type, 'BISHI_DUE');
    assert.equal(body.pagination.unreadCount, 1);
    assert.equal(body.pagination.total, 1);
  });

  test('6. Mark single notification as read updates status and decrements unread count', async () => {
    // Fetch notifications list to get id
    const listRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const notifs = (await listRes.json()).data;
    const notifId = notifs[0].id;

    const readRes = await fetch(`${baseUrl}/api/notifications/${notifId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(readRes.status, 200);
    const readBody = await readRes.json();
    assert.equal(readBody.data.isRead, true);
    assert.ok(readBody.data.readAt);

    // Unread count is now 0
    const countRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal((await countRes.json()).unreadCount, 0);
  });

  test('7. IDOR Protection: Member 2 cannot view or mark Member 1 notification', async () => {
    // Member 1 receives another notification
    const m1Notif = await NotificationService.sendNotification({
      organizationId: orgId,
      userId: memberId,
      type: 'SECURITY_EVENT',
      title: 'सुरक्षा सूचना',
      message: 'गुप्त माहिती',
      idempotencyKey: 'sec-idor-test',
    });
    assert.ok(m1Notif);

    // Member 2 tries to mark Member 1 notification as read
    const idorRes = await fetch(`${baseUrl}/api/notifications/${m1Notif.id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    // Strict IDOR rejection (403 Forbidden or 404 Not Found)
    assert.ok(idorRes.status === 403 || idorRes.status === 404);

    // Member 2 notifications list is empty
    const m2ListRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    assert.equal(m2ListRes.status, 200);
    assert.equal((await m2ListRes.json()).data.length, 0);
  });

  test('8. Mark all as read updates all unread notifications for authenticated user only', async () => {
    // Send two more notifications to Member 1
    await NotificationService.sendNotification({
      organizationId: orgId,
      userId: memberId,
      type: 'FINANCIAL_EVENT',
      title: 'वर्गणी सूचना १',
      message: 'नोंद १',
      idempotencyKey: 'batch-test-1',
    });
    await NotificationService.sendNotification({
      organizationId: orgId,
      userId: memberId,
      type: 'FINANCIAL_EVENT',
      title: 'वर्गणी सूचना २',
      message: 'नोंद २',
      idempotencyKey: 'batch-test-2',
    });

    // Check unread count is 3 (1 from previous test + 2 new)
    const countRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal((await countRes.json()).unreadCount, 3);

    // Mark all as read
    const markAllRes = await fetch(`${baseUrl}/api/notifications/mark-all-read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(markAllRes.status, 200);
    const markAllBody = await markAllRes.json();
    assert.equal(markAllBody.success, true);
    assert.equal(markAllBody.updatedCount, 3);

    // Unread count is now 0
    const countAfterRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal((await countAfterRes.json()).unreadCount, 0);
  });

  test('9. Device Token registration, refresh, and unregistering', async () => {
    const dummyToken = 'fcm_mock_device_token_abc_1234567890';

    // Register token
    const regRes = await fetch(`${baseUrl}/api/notifications/device-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        deviceToken: dummyToken,
        platform: 'ANDROID',
        deviceName: 'Samsung Galaxy M32',
      }),
    });
    assert.equal(regRes.status, 200);
    const regBody = await regRes.json();
    assert.equal(regBody.success, true);
    assert.equal(regBody.data.deviceToken, dummyToken);
    assert.equal(regBody.data.platform, 'ANDROID');

    // Registering the same token again acts as an idempotent refresh
    const refreshRes = await fetch(`${baseUrl}/api/notifications/device-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        deviceToken: dummyToken,
        platform: 'ANDROID',
        deviceName: 'Samsung Galaxy M32 Updated',
      }),
    });
    assert.equal(refreshRes.status, 200);

    // Unregister token
    const unregRes = await fetch(`${baseUrl}/api/notifications/device-token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ deviceToken: dummyToken }),
    });
    assert.equal(unregRes.status, 200);
    const unregBody = await unregRes.json();
    assert.equal(unregBody.success, true);
  });

  test('10. Event Hook: PIN Change triggers SECURITY_EVENT notification', async () => {
    // Change member 1 PIN
    const pinRes = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        currentPin: '1234',
        newPin: '5678',
        confirmNewPin: '5678',
      }),
    });
    assert.equal(pinRes.status, 200);
    const pinData = await pinRes.json();
    memberToken = pinData.token; // update rotated token

    // Check notifications for SECURITY_EVENT
    const notifsRes = await fetch(`${baseUrl}/api/notifications?type=SECURITY_EVENT`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(notifsRes.status, 200);
    const notifs = (await notifsRes.json()).data;
    assert.ok(notifs.length >= 1);
    assert.equal(notifs[0].type, 'SECURITY_EVENT');
    assert.match(notifs[0].title, /सुरक्षा सूचना/);
  });

  test('11. Event Hook: Cash Bishi Payment triggers BISHI_PAID to member and admins', async () => {
    // 1. Setup Bishi config and generate cycle
    const db = getDatabase();
    const configId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_configs (id, organization_id, member_id, monthly_amount, due_day, is_active)
      VALUES (?, ?, ?, 500, 10, 1)
    `).run(configId, orgId, memberId);

    const bishiRecId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status)
      VALUES (?, ?, ?, ?, '2026-09', 500, '2026-09-10', 'PENDING')
    `).run(bishiRecId, orgId, memberId, configId);

    // 2. Record cash payment via President
    const payRes = await fetch(`${baseUrl}/api/bishi/${bishiRecId}/cash-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        notes: 'रोख जमा बिशी',
      }),
    });
    assert.equal(payRes.status, 200);

    // 3. Member receives BISHI_PAID notification
    const mRes = await fetch(`${baseUrl}/api/notifications?type=BISHI_PAID`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(mRes.status, 200);
    const mNotifs = (await mRes.json()).data;
    assert.ok(mNotifs.length >= 1);
    assert.equal(mNotifs[0].type, 'BISHI_PAID');
    assert.match(mNotifs[0].title, /बिशी जमा पावती/);

    // 4. President also receives operational BISHI_PAID notification
    const pRes = await fetch(`${baseUrl}/api/notifications?type=BISHI_PAID`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(pRes.status, 200);
    const pNotifs = (await pRes.json()).data;
    assert.ok(pNotifs.length >= 1);
    assert.match(pNotifs[0].title, /नवीन बिशी रोख जमा/);
  });

  test('12. Event Hook: Expense creation triggers FINANCIAL_EVENT to President', async () => {
    const expRes = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 350,
        category: 'साहित्य',
        reason: 'गणेशोत्सव नारळ व हार',
      }),
    });
    assert.equal(expRes.status, 201);

    // President receives FINANCIAL_EVENT notification
    const pRes = await fetch(`${baseUrl}/api/notifications?type=FINANCIAL_EVENT`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(pRes.status, 200);
    const notifs = (await pRes.json()).data;
    const expNotif = notifs.find((n: any) => n.title.includes('मंडळ खर्च नोंद'));
    assert.ok(expNotif);
    assert.match(expNotif.message, /३५०|350/);
  });

  test('13. Event Hook: Loan Disbursement & Cash Repayment trigger notifications', async () => {
    // 1. Create Loan
    const loanRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        memberId,
        amount: 2000,
        notes: 'आपत्कालीन वैद्यकीय कर्ज',
      }),
    });
    assert.equal(loanRes.status, 201);
    const loanData = await loanRes.json();
    const loanId = loanData.data.id;

    // Verify member received LOAN_DISBURSED notification
    const mLoanRes = await fetch(`${baseUrl}/api/notifications?type=LOAN_DISBURSED`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(mLoanRes.status, 200);
    const mLoanNotifs = (await mLoanRes.json()).data;
    assert.ok(mLoanNotifs.length >= 1);
    assert.match(mLoanNotifs[0].title, /कर्ज मंजूर व वितरित/);

    // 2. Record Cash Loan Repayment
    const repayRes = await fetch(`${baseUrl}/api/loans/${loanId}/repay-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 1000,
        notes: 'पहिला हप्ता जमा',
      }),
    });
    assert.equal(repayRes.status, 200);

    // Verify member received LOAN_REPAYMENT notification
    const mRepayRes = await fetch(`${baseUrl}/api/notifications?type=LOAN_REPAYMENT`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(mRepayRes.status, 200);
    const mRepayNotifs = (await mRepayRes.json()).data;
    assert.ok(mRepayNotifs.length >= 1);
    assert.match(mRepayNotifs[0].title, /कर्ज परतफेड जमा/);
  });

  test('14. Bishi Scheduler Cycle: Evaluates due dates and sends automated reminders in IST', async () => {
    const db = getDatabase();
    const todayStr = BishiSchedulerService.getTodayIST();
    const today = new Date(todayStr + 'T00:00:00Z');

    const config2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_configs (id, organization_id, member_id, monthly_amount, due_day, is_active)
      VALUES (?, ?, ?, 500, 10, 1)
    `).run(config2Id, orgId, member2Id);

    // Case A: Due in 2 days
    const dueIn2 = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recDue2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status)
      VALUES (?, ?, ?, ?, '2026-10', 500, ?, 'PENDING')
    `).run(recDue2Id, orgId, member2Id, config2Id, dueIn2);

    // Case B: Due today
    const recDueTodayId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status)
      VALUES (?, ?, ?, ?, '2026-11', 500, ?, 'PENDING')
    `).run(recDueTodayId, orgId, member2Id, config2Id, todayStr);

    // Case C: Overdue by 3 days
    const overdueDate = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recOverdueId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status)
      VALUES (?, ?, ?, ?, '2026-08', 500, ?, 'PENDING')
    `).run(recOverdueId, orgId, member2Id, config2Id, overdueDate);

    // Trigger reminder cycle via API (President only)
    const cycleRes = await fetch(`${baseUrl}/api/notifications/scheduler/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(cycleRes.status, 200);
    const cycleBody = await cycleRes.json();
    assert.equal(cycleBody.success, true);
    assert.ok(cycleBody.data.remindersSent >= 3);

    // Member 2 should have received the reminders
    const m2NotifsRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    assert.equal(m2NotifsRes.status, 200);
    const m2Notifs = (await m2NotifsRes.json()).data;
    assert.ok(m2Notifs.some((n: any) => n.title.includes('जवळ आली')));
    assert.ok(m2Notifs.some((n: any) => n.title.includes('आज बिशी भरण्याचा दिवस आहे') || n.type === 'BISHI_DUE_TODAY'));
    assert.ok(m2Notifs.some((n: any) => n.title.includes('थकीत') || n.type === 'BISHI_OVERDUE'));
  });

  test('15. Permanent Mandal Deletion cascade purges notifications and device tokens', async () => {
    const db = getDatabase();
    // Register token for President
    PushService.registerDeviceToken(orgId, presidentId, 'pres_token_1234567890', 'WEB');

    // Confirm notifications and tokens exist
    const countBeforeNotifs = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE organization_id = ?').get(orgId) as { c: number };
    const countBeforeTokens = db.prepare('SELECT COUNT(*) as c FROM device_tokens WHERE organization_id = ?').get(orgId) as { c: number };
    assert.ok(countBeforeNotifs.c > 0);
    assert.ok(countBeforeTokens.c > 0);

    // Delete Mandal permanently
    const delRes = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.equal(delRes.status, 200);

    // Confirm notifications and device tokens are completely purged
    const countAfterNotifs = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE organization_id = ?').get(orgId) as { c: number };
    const countAfterTokens = db.prepare('SELECT COUNT(*) as c FROM device_tokens WHERE organization_id = ?').get(orgId) as { c: number };
    assert.equal(countAfterNotifs.c, 0);
    assert.equal(countAfterTokens.c, 0);
  });
});
