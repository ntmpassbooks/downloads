process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_final_audit_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';

let server: Server;
let baseUrl: string;

const TEST_DB = './data/ntm_final_audit_test.sqlite';

before(async () => {
  closeDatabase();
  if (fs.existsSync(TEST_DB)) {
    try {
      fs.unlinkSync(TEST_DB);
    } catch {}
  }
  runMigrations();
  const db = getDatabase();
  db.exec('DELETE FROM audit_logs;');
  db.exec('DELETE FROM expenses;');
  db.exec('DELETE FROM loan_repayments;');
  db.exec('DELETE FROM loans;');
  db.exec('DELETE FROM financial_transactions;');
  db.exec('DELETE FROM bishi_records;');
  db.exec('DELETE FROM bishi_configs;');
  db.exec('DELETE FROM device_tokens;');
  db.exec('DELETE FROM notifications;');
  db.exec('DELETE FROM payment_orders;');
  db.exec('DELETE FROM payment_configs;');
  db.exec('DELETE FROM sessions;');
  db.exec('DELETE FROM users;');
  db.exec('DELETE FROM organizations;');

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
  if (fs.existsSync(TEST_DB)) {
    try {
      fs.unlinkSync(TEST_DB);
    } catch {}
  }
});

describe('NTM Passbook — Final Multi-Mandal + Payment Access + Notification Audit + Loan Fix Suite', () => {
  let m1PresToken = '';
  let m1PresId = '';
  let m1OrgId = '';

  let m1TreasToken = '';
  let m1TreasId = '';

  let m1MemToken = '';
  let m1MemId = '';

  let m2PresToken = '';
  let m2PresId = '';
  let m2OrgId = '';

  let m2MemToken = '';
  let m2MemId = '';

  let m1LoanId = '';
  let m1NotifId = '';

  // ==========================================
  // 1. MULTI-MANDAL ONBOARDING & FIRST-PRESIDENT LOCK
  // ==========================================
  test('1. First President registers Mandal 1 (नागराज तरुण मंडळ) successfully', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'नागराज तरुण मंडळ',
        fullName: 'संतोष कोळी',
        phone: '9822000001',
        pin: '1234',
        confirmPin: '1234',
        registrationNumber: 'REG-NTM-01',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.role, 'PRESIDENT');
    m1PresToken = body.token;
    m1PresId = body.user.id;
    m1OrgId = body.organization.id;
  });

  test('2. First-President lock: Second President registration for same Mandal is rejected (409)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'नागराज तरुण मंडळ',
        fullName: 'दुसरा अध्यक्ष',
        phone: '9822000002',
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /मंडळ अध्यक्ष आधीपासून अस्तित्वात आहेत/);
  });

  test('3. Independent Mandal 2 (एकता तरुण मंडळ) can onboard its first President', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'एकता तरुण मंडळ',
        fullName: 'अनिल पाटील',
        phone: '9822000010',
        pin: '4321',
        confirmPin: '4321',
        registrationNumber: 'REG-ETM-02',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.notEqual(body.organization.id, m1OrgId);
    m2PresToken = body.token;
    m2PresId = body.user.id;
    m2OrgId = body.organization.id;
  });

  // Create Treasurer & Member in Mandal 1
  test('4. President creates Treasurer and Member in Mandal 1', async () => {
    // Treasurer
    const resTreas = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1PresToken}`,
      },
      body: JSON.stringify({
        fullName: 'रमेश खजिनदार',
        phone: '9822000003',
        role: 'TREASURER',
        initialPin: '1111',
      }),
    });
    assert.equal(resTreas.status, 201);
    const treasBody = await resTreas.json();
    m1TreasId = treasBody.data.id;

    // Member
    const resMem = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1PresToken}`,
      },
      body: JSON.stringify({
        fullName: 'सुरेश सदस्य',
        phone: '9822000004',
        role: 'MEMBER',
        initialPin: '2222',
      }),
    });
    assert.equal(resMem.status, 201);
    const memBody = await resMem.json();
    m1MemId = memBody.data.id;

    // Login Treasurer
    const treasLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000003', pin: '1111' }),
    });
    assert.equal(treasLogin.status, 200);
    const treasLoginBody = await treasLogin.json();
    assert.equal(treasLoginBody.user.role, 'TREASURER');
    m1TreasToken = treasLoginBody.token;

    // Login Member
    const memLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000004', pin: '2222' }),
    });
    assert.equal(memLogin.status, 200);
    const memLoginBody = await memLogin.json();
    assert.equal(memLoginBody.user.role, 'MEMBER');
    m1MemToken = memLoginBody.token;
  });

  // Create Member in Mandal 2
  test('5. President creates Member in Mandal 2', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m2PresToken}`,
      },
      body: JSON.stringify({
        fullName: 'एकता सदस्य १',
        phone: '9822000020',
        role: 'MEMBER',
        initialPin: '3333',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    m2MemId = body.data.id;

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000020', pin: '3333' }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    m2MemToken = loginBody.token;
  });

  // ==========================================
  // 2. TREASURER & MEMBER PAYMENT ACCESS
  // ==========================================
  test('6. President configures online payment for Mandal 1', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1PresToken}`,
      },
      body: JSON.stringify({
        bank: 'SBI',
        accountType: 'CURRENT',
        accountName: 'नागराज तरुण मंडळ चालू खाते',
        accountNumber: '123456789012',
        ifsc: 'SBIN0001234',
        branch: 'मुख्य शाखा',
        upiId: 'ntm@sbi',
        merchantId: 'SBI_MERCHANT_01',
        apiSecret: 'SUPER_SECRET_KEY_123',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.bank, 'SBI');
  });

  test('7. Treasurer can VIEW payment config (GET /api/payments/config) with masked account and ZERO secrets', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      headers: { Authorization: `Bearer ${m1TreasToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.bank, 'SBI');
    assert.equal(body.data.accountType, 'CURRENT');
    assert.equal(body.data.maskedAccountNumber, 'XXXX...9012');
    assert.equal(body.data.accountNumber, 'XXXX...9012'); // Masked for non-President
    assert.equal(body.data.hasCredentials, true);
    assert.equal(body.data.apiSecret, undefined);
    assert.equal(body.data.credentials_encrypted, undefined);
  });

  test('8. Treasurer CANNOT update payment config (POST /api/payments/config) -> 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1TreasToken}`,
      },
      body: JSON.stringify({
        bank: 'ICICI',
        accountType: 'CURRENT',
        accountName: 'बदलाचा प्रयत्न',
      }),
    });
    assert.equal(res.status, 403);
  });

  test('9. Treasurer CANNOT update payment status (PATCH /api/payments/config/status) -> 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1TreasToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(res.status, 403);
  });

  test('10. President can activate payment config', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1PresToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'ACTIVE');
  });

  test('11. President and Treasurer can list Mandal payment orders (GET /api/payments/orders)', async () => {
    // President
    const presRes = await fetch(`${baseUrl}/api/payments/orders`, {
      headers: { Authorization: `Bearer ${m1PresToken}` },
    });
    assert.equal(presRes.status, 200);
    const presBody = await presRes.json();
    assert.ok(Array.isArray(presBody.data));

    // Treasurer
    const treasRes = await fetch(`${baseUrl}/api/payments/orders`, {
      headers: { Authorization: `Bearer ${m1TreasToken}` },
    });
    assert.equal(treasRes.status, 200);
    const treasBody = await treasRes.json();
    assert.ok(Array.isArray(treasBody.data));
  });

  test('12. Member can list own payment orders (GET /api/payments/orders)', async () => {
    const memRes = await fetch(`${baseUrl}/api/payments/orders`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(memRes.status, 200);
    const memBody = await memRes.json();
    assert.ok(Array.isArray(memBody.data));
  });

  // ==========================================
  // 3. MEMBER LOAN API ROUTE & RBAC FIX
  // ==========================================
  test('13. Member Loan Route: GET /api/loans/me succeeds with 200 OK and returns empty list initially', async () => {
    const res = await fetch(`${baseUrl}/api/loans/me`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data, []);
  });

  test('14. Member Loan Route Alias: GET /api/loans/my-loans succeeds with 200 OK (Route Not Found FIXED)', async () => {
    const res = await fetch(`${baseUrl}/api/loans/my-loans`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data, []);
  });

  test('15. Unauthenticated request to /api/loans/me is rejected with 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/loans/me`);
    assert.equal(res.status, 401);
  });

  test('16. President creates loan for Member in Mandal 1', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1PresToken}`,
      },
      body: JSON.stringify({
        memberId: m1MemId,
        amount: 15000,
        loanDate: '2026-09-01',
        interestRate: 0,
        notes: 'सणासुदीसाठी बिनव्याजी कर्ज',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.amount, 15000);
    assert.equal(body.data.outstandingBalance, 15000);
    m1LoanId = body.data.id;
  });

  test('17. Member sees real loan via GET /api/loans/me with correct balance and repayments array', async () => {
    const res = await fetch(`${baseUrl}/api/loans/me`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, m1LoanId);
    assert.equal(body.data[0].amount, 15000);
    assert.equal(body.data[0].outstandingBalance, 15000);
    assert.equal(body.data[0].totalRepaid, 0);
  });

  test('18. Treasurer records cash loan repayment of ₹5000', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${m1LoanId}/repay-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1TreasToken}`,
      },
      body: JSON.stringify({
        amount: 5000,
        notes: 'पहिली परतफेड रोख',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.loan.outstandingBalance, 10000);
    assert.equal(body.data.loan.totalRepaid, 5000);
  });

  test('19. Member sees updated outstanding balance (₹10000) and repayment history via GET /api/loans/me', async () => {
    const res = await fetch(`${baseUrl}/api/loans/me`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data[0].outstandingBalance, 10000);
    assert.equal(body.data[0].totalRepaid, 5000);
    assert.equal(body.data[0].repayments.length, 1);
    assert.equal(body.data[0].repayments[0].amount, 5000);
  });

  test('20. IDOR Defense: Member cannot access another member loans directly (GET /api/loans/member/:id) -> 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/loans/member/${m1TreasId}`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('21. Tenant Isolation: Member cannot access Mandal 2 member loans -> 403 Forbidden or 404', async () => {
    const res = await fetch(`${baseUrl}/api/loans/member/${m2MemId}`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('22. President & Treasurer can view all Mandal loans via GET /api/loans', async () => {
    const presRes = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: `Bearer ${m1PresToken}` },
    });
    assert.equal(presRes.status, 200);
    const presBody = await presRes.json();
    assert.equal(presBody.data.length, 1);

    const treasRes = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: `Bearer ${m1TreasToken}` },
    });
    assert.equal(treasRes.status, 200);
    const treasBody = await treasRes.json();
    assert.equal(treasBody.data.length, 1);
  });

  test('23. Member is forbidden from accessing Mandal-wide loans list (GET /api/loans) -> 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 403);
  });

  // ==========================================
  // 4. NOTIFICATION AUDIT & VERIFICATION
  // ==========================================
  test('24. Member received LOAN_REPAYMENT notification automatically', async () => {
    const res = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.length >= 1);
    const notif = body.data.find((n: any) => n.type === 'LOAN_REPAYMENT');
    assert.ok(notif);
    assert.equal(notif.isRead, false);
    assert.match(notif.title, /कर्ज परतफेड जमा/);
    m1NotifId = notif.id;
  });

  test('25. Unread count returns correct count (GET /api/notifications/unread-count)', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.unreadCount >= 1);
  });

  test('26. Marking notification as read updates read state and markAllAsRead decrements unread count to 0', async () => {
    const initialRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    const initialCount = (await initialRes.json()).unreadCount;
    assert.ok(initialCount >= 1);

    const markRes = await fetch(`${baseUrl}/api/notifications/${m1NotifId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(markRes.status, 200);

    const midRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    const midCount = (await midRes.json()).unreadCount;
    assert.equal(midCount, initialCount - 1);

    // Mark all as read
    const allRes = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal(allRes.status, 200);

    const finalRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${m1MemToken}` },
    });
    assert.equal((await finalRes.json()).unreadCount, 0);
  });

  test('27. Cross-User Notification IDOR: User cannot mark another user notification as read -> 403 or 404', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/${m1NotifId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${m1TreasToken}` },
    });
    assert.ok([403, 404].includes(res.status));
  });

  test('28. Cross-Mandal Notification Isolation: Mandal 2 Member sees zero notifications from Mandal 1', async () => {
    const res = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${m2MemToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 0);
  });

  test('29. Duplicate Notification Protection: Resending notification with same idempotencyKey does not create duplicate', async () => {
    const notifPayload = {
      organizationId: m1OrgId,
      userId: m1MemId,
      type: 'FINANCIAL_EVENT' as const,
      title: 'चाचणी सूचना',
      message: 'ही चाचणी आर्थिक सूचना आहे',
      entityType: 'SYSTEM' as const,
      entityId: 'var-123',
      idempotencyKey: 'fin-unique-key-001',
    };

    const first = await NotificationService.sendNotification(notifPayload);
    assert.ok(first);

    const second = await NotificationService.sendNotification(notifPayload);
    assert.equal(second.id, first.id); // Same ID returned, deduplicated

    // Verify DB count
    const db = getDatabase();
    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM notifications WHERE idempotency_key = 'fin-unique-key-001'")
      .get() as { cnt: number };
    assert.equal(count.cnt, 1);
  });

  // ==========================================
  // 5. PERMANENT MANDAL DELETE ISOLATION
  // ==========================================
  test('30. Permanent delete of Mandal 1 leaves Mandal 2 completely intact and operational', async () => {
    // President deletes Mandal 1 with required confirmation phrase and PIN
    const delRes = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1PresToken}`,
      },
      body: JSON.stringify({
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.equal(delRes.status, 200);

    // Mandal 1 is deleted
    const db = getDatabase();
    const m1Org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(m1OrgId);
    assert.equal(m1Org, undefined);

    // Mandal 2 is COMPLETELY INTACT
    const m2Org = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(m2OrgId) as { id: string; name: string };
    assert.ok(m2Org);
    assert.equal(m2Org.name, 'एकता तरुण मंडळ');

    // Mandal 2 President and Member remain active and can log in
    const m2Login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000010', pin: '4321' }),
    });
    assert.equal(m2Login.status, 200);
  });
});
