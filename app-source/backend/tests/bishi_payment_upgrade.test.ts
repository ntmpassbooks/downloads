process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
process.env.SESSION_SECRET = 'batch16-payment-upgrade-test-secret-minimum-32chars!';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/db/connection.js';
import { seedDatabase } from '../src/db/seed.js';
import { runMigrations } from '../src/db/migrate.js';

describe('NTM Passbook — Batch 16: Mandal Bishi Payment Upgrade (UPI ID & QR Code + Manual Approval)', () => {
  let server: http.Server;
  let baseUrl: string;
  let orgId: string;
  let presidentToken: string;
  let treasurerToken: string;
  let memberToken: string;
  let memberId: string;
  let bishiRecordId: string;
  let bishiRecordId2: string;

  const validPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const invalidImageBase64 = 'data:image/png;base64,VEVTVA=='; // Decodes to "TEST"

  before(async () => {
    seedDatabase();
    runMigrations();

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

    // Login President
    const presRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    const presData = (await presRes.json()) as any;
    presidentToken = presData.token;
    orgId = presData.user.organizationId;

    // Login Treasurer
    const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
    });
    const treasData = (await treasRes.json()) as any;
    treasurerToken = treasData.token;

    // Login Member
    const memRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
    });
    const memData = (await memRes.json()) as any;
    memberToken = memData.token;
    memberId = memData.user.id;

    const db = getDatabase();

    let cfg = db.prepare('SELECT id FROM bishi_configs WHERE member_id = ?').get(memberId) as any;
    if (!cfg) {
      cfg = { id: crypto.randomUUID() };
      db.prepare(`
        INSERT INTO bishi_configs (id, organization_id, member_id, monthly_amount, due_day)
        VALUES (?, ?, ?, 1000, 10)
      `).run(cfg.id, orgId, memberId);
    }

    bishiRecordId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status)
      VALUES (?, ?, ?, ?, '2026-10', 1000, '2026-10-10', 'PENDING')
    `).run(bishiRecordId, orgId, memberId, cfg.id);

    bishiRecordId2 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status)
      VALUES (?, ?, ?, ?, '2026-11', 1000, '2026-11-10', 'PENDING')
    `).run(bishiRecordId2, orgId, memberId, cfg.id);
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDatabase();
  });

  describe('1. Role Permissions & Configuration (UPI & QR Code)', () => {
    test('1.1 Member cannot configure payment settings (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          upiId: 'mandal@upi',
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.2 Treasurer cannot configure payment settings (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          upiId: 'mandal@upi',
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.3 President cannot activate online payment without UPI ID and without QR Code (400)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isActive: true,
          upiId: null,
          qrCodeData: null,
        }),
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.match(data.error || data.message, /UPI आयडी किंवा QR कोड/);
    });

    test('1.4 Corrupted or non-image QR code upload is rejected by magic byte validator (400)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          qrCodeData: invalidImageBase64,
          isActive: true,
        }),
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.match(data.error || data.message, /PNG किंवा JPG/);
    });

    test('1.5 President successfully configures valid UPI ID and QR Code image (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          upiId: 'ntmpassbook@okaxis',
          qrCodeData: validPngBase64,
          isActive: true,
          notes: 'अधिकृत मंडळ पेमेंट खात्याचा UPI व QR कोड',
        }),
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.upiId, 'ntmpassbook@okaxis');
      assert.strictEqual(data.data.hasQrCode, true);
      assert.strictEqual(data.data.isActive, true);
    });

    test('1.6 Treasurer can view payment configuration (GET /api/payments/config)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.data.upiId, 'ntmpassbook@okaxis');
      assert.strictEqual(data.data.hasQrCode, true);
      assert.strictEqual(data.data.isActive, true);
    });

    test('1.7 Member can view payment configuration (GET /api/payments/config)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.data.upiId, 'ntmpassbook@okaxis');
      assert.strictEqual(data.data.hasQrCode, true);
      assert.strictEqual(data.data.isActive, true);
    });
  });

  describe('2. Member Online Payment Notice Submission (ONLINE_PENDING)', () => {
    let orderId: string;

    test('2.1 Member submits online payment notice for Bishi record -> creates ONLINE_PENDING order', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bishiRecordId,
        }),
      });
      assert.strictEqual(res.status, 201);
      const data = (await res.json()) as any;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.order.status, 'ONLINE_PENDING');
      assert.strictEqual(data.data.order.amount, 1000);
      assert.strictEqual(data.data.hasQrCode, true);
      assert.strictEqual(data.data.upiId, 'ntmpassbook@okaxis');
      orderId = data.data.order.id;
    });

    test('2.2 Bishi record remains UNPAID (status: PENDING) after online notice submission', async () => {
      const db = getDatabase();
      const bishi = db.prepare('SELECT status, paid_amount FROM bishi_records WHERE id = ?').get(bishiRecordId) as any;
      assert.strictEqual(bishi.status, 'PENDING');
      assert.ok(!bishi.paid_amount || bishi.paid_amount === 0);
    });

    test('2.3 No financial ledger transaction is created yet', async () => {
      const db = getDatabase();
      const txns = db.prepare('SELECT * FROM financial_transactions WHERE reference_id = ?').all(bishiRecordId);
      assert.strictEqual(txns.length, 0);
    });

    test('2.4 Notification was dispatched to officers (President & Treasurer)', async () => {
      const db = getDatabase();
      const notifs = db
        .prepare("SELECT * FROM notifications WHERE type = 'PAYMENT_INITIATED' ORDER BY created_at DESC")
        .all() as any[];
      assert.ok(notifs.length >= 1);
      assert.match(notifs[0].title, /ऑनलाइन भरणा/);
    });

    test('2.5 Submitting notice again returns existing ONLINE_PENDING order idempotently', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bishiRecordId,
        }),
      });
      assert.strictEqual(res.status, 201);
      const data = (await res.json()) as any;
      assert.strictEqual(data.data.order.id, orderId);
      assert.strictEqual(data.data.order.status, 'ONLINE_PENDING');
    });

    test('2.6 Member cannot view pending approval list (GET /api/payments/orders/pending -> 403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/pending`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.7 Member cannot approve payment order (POST /approve -> 403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/${orderId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.8 Member cannot reject payment order (POST /reject -> 403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/${orderId}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'चुकून झाले' }),
      });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('3. President / Treasurer Manual Approval Flow (ONLINE_CONFIRMED)', () => {
    let pendingOrderId: string;

    before(async () => {
      const db = getDatabase();
      const order = db.prepare("SELECT id FROM payment_orders WHERE bishi_record_id = ? AND status = 'ONLINE_PENDING'").get(bishiRecordId) as any;
      pendingOrderId = order.id;
    });

    test('3.1 President retrieves pending payment orders list', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/pending`, {
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.ok(Array.isArray(data.data));
      const found = data.data.find((o: any) => o.id === pendingOrderId);
      assert.ok(found);
      assert.strictEqual(found.amount, 1000);
      assert.strictEqual(found.status, 'ONLINE_PENDING');
      assert.ok(found.memberName);
    });

    test('3.2 Treasurer retrieves pending payment orders list', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/pending`, {
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.ok(Array.isArray(data.data));
      const found = data.data.find((o: any) => o.id === pendingOrderId);
      assert.ok(found);
    });

    test('3.3 President approves the pending payment order (POST /approve)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/${pendingOrderId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.amount, 1000);
      assert.strictEqual(data.data.paymentMethod, 'ONLINE');
      assert.match(data.data.transactionNumber, /^TXN-/);
      assert.match(data.data.receiptNumber, /^RCP-/);
    });

    test('3.4 Database integrity after approval: order ONLINE_CONFIRMED, bishi PAID, ledger record created', async () => {
      const db = getDatabase();

      // Check order
      const order = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(pendingOrderId) as any;
      assert.strictEqual(order.status, 'ONLINE_CONFIRMED');
      assert.ok(order.approved_by);
      assert.ok(order.approved_at);
      assert.ok(order.financial_transaction_id);

      // Check Bishi record
      const bishi = db.prepare('SELECT * FROM bishi_records WHERE id = ?').get(bishiRecordId) as any;
      assert.strictEqual(bishi.status, 'PAID');
      assert.strictEqual(bishi.paid_amount, 1000);
      assert.strictEqual(bishi.payment_method, 'ONLINE');
      assert.strictEqual(bishi.payment_transaction_id, order.financial_transaction_id);

      // Check financial ledger transaction
      const txn = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(order.financial_transaction_id) as any;
      assert.strictEqual(txn.amount, 1000);
      assert.strictEqual(txn.payment_method, 'ONLINE');
      assert.strictEqual(txn.status, 'CONFIRMED');
      assert.strictEqual(txn.transaction_type, 'BISHI_PAYMENT');

      // Check audit log
      const audit = db
        .prepare("SELECT * FROM audit_logs WHERE action = 'ONLINE_PAYMENT_APPROVED' AND user_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(order.approved_by) as any;
      assert.ok(audit);
    });

    test('3.5 Member received BISHI_PAID notification for approved online payment', async () => {
      const db = getDatabase();
      const notif = db
        .prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'BISHI_PAID' ORDER BY created_at DESC LIMIT 1")
        .get(memberId) as any;
      assert.ok(notif);
      assert.match(notif.title, /ऑनलाइन भरणा मंजूर/);
    });

    test('3.6 Duplicate approval attempt on already confirmed order returns 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/${pendingOrderId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 409);
    });

    test('3.7 Approved order disappears from pending orders list', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/pending`, {
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      const found = data.data.find((o: any) => o.id === pendingOrderId);
      assert.strictEqual(found, undefined);
    });
  });

  describe('4. President / Treasurer Manual Rejection Flow (ONLINE_REJECTED)', () => {
    let secondOrderId: string;

    before(async () => {
      // Member creates order for second bishi record
      const res = await fetch(`${baseUrl}/api/payments/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bishiRecordId: bishiRecordId2,
        }),
      });
      const data = (await res.json()) as any;
      secondOrderId = data.data.order.id;
    });

    test('4.1 Rejection without reason fails validation with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/${secondOrderId}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: '' }),
      });
      assert.strictEqual(res.status, 400);
    });

    test('4.2 Treasurer rejects pending payment order with valid reason (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/${secondOrderId}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'खात्यात रक्कम जमा झालेली दिसत नाही. कृपया पुन्हा तपासा.' }),
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.status, 'ONLINE_REJECTED');
      assert.strictEqual(data.data.rejectionReason, 'खात्यात रक्कम जमा झालेली दिसत नाही. कृपया पुन्हा तपासा.');
    });

    test('4.3 Database integrity after rejection: order ONLINE_REJECTED, bishi remains PENDING, NO ledger record', async () => {
      const db = getDatabase();

      // Check order
      const order = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(secondOrderId) as any;
      assert.strictEqual(order.status, 'ONLINE_REJECTED');
      assert.ok(order.rejected_by);
      assert.ok(order.rejected_at);
      assert.strictEqual(order.rejection_reason, 'खात्यात रक्कम जमा झालेली दिसत नाही. कृपया पुन्हा तपासा.');
      assert.strictEqual(order.financial_transaction_id, null);

      // Check Bishi record remains UNPAID
      const bishi = db.prepare('SELECT * FROM bishi_records WHERE id = ?').get(bishiRecordId2) as any;
      assert.strictEqual(bishi.status, 'PENDING');
      assert.ok(!bishi.paid_amount || bishi.paid_amount === 0);

      // Check zero ledger entries
      const txns = db.prepare('SELECT * FROM financial_transactions WHERE reference_id = ?').all(bishiRecordId2);
      assert.strictEqual(txns.length, 0);

      // Check audit log
      const audit = db
        .prepare("SELECT * FROM audit_logs WHERE action = 'ONLINE_PAYMENT_REJECTED' AND user_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(order.rejected_by) as any;
      assert.ok(audit);
    });

    test('4.4 Member received PAYMENT_FAILED notification with rejection reason', async () => {
      const db = getDatabase();
      const notif = db
        .prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'PAYMENT_FAILED' ORDER BY created_at DESC LIMIT 1")
        .get(memberId) as any;
      assert.ok(notif);
      assert.match(notif.message, /खात्यात रक्कम जमा झालेली दिसत नाही/);
    });

    test('4.5 Attempt to approve already rejected order is rejected with 400', async () => {
      const res = await fetch(`${baseUrl}/api/payments/orders/${secondOrderId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 400);
    });
  });

  describe('5. Passbook, Ledger, & Cash Payment Distinction', () => {
    test('5.1 Digital Passbook reflects confirmed ONLINE transaction with distinct method', async () => {
      const res = await fetch(`${baseUrl}/api/passbook/me`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      const txns = data.data?.transactions || data.transactions || [];
      assert.ok(txns.length >= 1);
      const onlineTxn = txns.find((t: any) => t.referenceId === bishiRecordId);
      assert.ok(onlineTxn);
      assert.strictEqual(onlineTxn.paymentMethod, 'ONLINE');
    });

    test('5.2 Officer Ledger reflects confirmed ONLINE transaction', async () => {
      const res = await fetch(`${baseUrl}/api/ledger`, {
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      const txns = data.data?.transactions || data.transactions || [];
      const onlineTxn = txns.find((t: any) => t.referenceId === bishiRecordId);
      assert.ok(onlineTxn);
      assert.strictEqual(onlineTxn.paymentMethod, 'ONLINE');
    });

    test('5.3 Cash payment flow continues to work with distinct CASH method', async () => {
      const db = getDatabase();
      const cashBishiId = crypto.randomUUID();
      const cfg = db.prepare('SELECT id FROM bishi_configs WHERE member_id = ?').get(memberId) as any;
      db.prepare(`
        INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status)
        VALUES (?, ?, ?, ?, '2026-12', 1000, '2026-12-10', 'PENDING')
      `).run(cashBishiId, orgId, memberId, cfg.id);

      const res = await fetch(`${baseUrl}/api/bishi/${cashBishiId}/cash-payment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 1000 }),
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.paymentMethod, 'CASH');

      // Verify in DB
      const bishi = db.prepare('SELECT status, payment_method FROM bishi_records WHERE id = ?').get(cashBishiId) as any;
      assert.strictEqual(bishi.status, 'PAID');
      assert.strictEqual(bishi.payment_method, 'CASH');

      const txn = db.prepare('SELECT payment_method FROM financial_transactions WHERE reference_id = ?').get(cashBishiId) as any;
      assert.strictEqual(txn.payment_method, 'CASH');
    });
  });
});
