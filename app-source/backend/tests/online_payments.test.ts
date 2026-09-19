process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
process.env.SESSION_SECRET = 'online-payments-test-secret-minimum-32chars!';
process.env.BANK_ENCRYPTION_KEY = 'test_bank_encryption_key_32chars_test!';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/db/connection.js';
import { seedDatabase } from '../src/db/seed.js';
import { runMigrations } from '../src/db/migrate.js';
import { BankAdapterFactory, SupportedBank } from '../src/modules/payments/bank.adapters.js';

describe('Multi-Bank Online Payment Integration Layer Tests (SBI, ICICI, Axis, AU, Kotak; BOI Excluded)', () => {
  let server: http.Server;
  let baseUrl: string;
  let presidentToken: string;
  let treasurerToken: string;
  let memberToken: string;
  let secondaryOrgPresToken: string;
  let secondaryOrgMemberToken: string;

  const NTM_ORG_ID = 'org-ntm-001';
  const JHM_ORG_ID = 'org-jhm-002';

  let memberId: string;
  let bishiRecordId: string;
  let bishiExpectedAmount = 1000;

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

    // Login NTM President (9876543210, PIN 1234)
    const presRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    const presData = (await presRes.json()) as any;
    presidentToken = presData.token;

    // Login NTM Treasurer (9876543211, PIN 1234)
    const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
    });
    const treasData = (await treasRes.json()) as any;
    treasurerToken = treasData.token;

    // Login NTM Member (9876543212, PIN 1234)
    const memRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
    });
    const memData = (await memRes.json()) as any;
    memberToken = memData.token;
    memberId = memData.user.id;

    // Seed a secondary organization for IDOR tests
    const db = getDatabase();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('1234', salt, 64).toString('hex');
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, code, registration_number)
      VALUES (?, 'जय हनुमान मंडळ', 'JHM02', 'REG-JHM-002')
    `).run(JHM_ORG_ID);

    const jhmPresId = 'usr-jhm-pres-001';
    db.prepare(`
      INSERT OR IGNORE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
      VALUES (?, ?, '9876543220', 'हनुमान अध्यक्ष', 'PRESIDENT', ?, ?, 1)
    `).run(jhmPresId, JHM_ORG_ID, hash, salt);

    const jhmMemId = 'usr-jhm-mem-001';
    db.prepare(`
      INSERT OR IGNORE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
      VALUES (?, ?, '9876543298', 'हनुमान सदस्य', 'MEMBER', ?, ?, 1)
    `).run(jhmMemId, JHM_ORG_ID, hash, salt);

    // Login JHM President
    const secPresRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543220', pin: '1234' }),
    });
    const secPresData = (await secPresRes.json()) as any;
    secondaryOrgPresToken = secPresData.token;

    // Login JHM Member
    const secMemRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543298', pin: '1234' }),
    });
    const secMemData = (await secMemRes.json()) as any;
    secondaryOrgMemberToken = secMemData.token;

    // Set up Bishi Config & Monthly cycle for Member
    await fetch(`${baseUrl}/api/members/${memberId}/bishi-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthlyAmount: bishiExpectedAmount, dueDay: 15 }),
    });

    const cycleRes = await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthYear: '2026-10' }),
    });
    assert.equal(cycleRes.status, 200);

    // Fetch the generated Bishi record for tests
    const recordsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const recordsData = (await recordsRes.json()) as any;
    const rec = recordsData.data.find((r: any) => r.monthYear === '2026-10');
    assert.ok(rec, 'Bishi record should exist for 2026-10');
    bishiRecordId = rec.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
  });

  // 1. Unauthorized Payment Configuration
  test('1. Unauthenticated request to configure payment account returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank: 'SBI', accountName: 'नवतरुण मंडळ ट्रस्ट' }),
    });
    assert.equal(res.status, 401);
  });

  // 2. Member cannot configure provider
  test('2. Member is forbidden from configuring payment provider settings (403)', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bank: 'SBI', accountName: 'हॅकर खाते' }),
    });
    assert.equal(res.status, 403);
  });

  // 3. Treasurer cannot configure President-only provider settings
  test('3. Treasurer is forbidden from editing payment configuration (403)', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({ bank: 'SBI', accountName: 'खजिनदार खाते' }),
    });
    assert.equal(res.status, 403);
  });

  // 4. Bank of India (BOI) is strictly rejected
  test('4. Bank of India (BOI) selection is strictly rejected with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'BOI',
        accountType: 'CURRENT',
        accountName: 'नवतरुण मित्र मंडळ',
        accountNumber: '123456789012',
        ifsc: 'BKID0001234',
      }),
    });
    assert.equal(res.status, 400);
    const data = (await res.json()) as any;
    assert.ok(
      JSON.stringify(data).includes('Bank of India (BOI) या प्रणालीमध्ये समर्थित नाही'),
      'Should contain BOI Marathi rejection message'
    );
  });

  // 5. Supported banks (SBI, ICICI, Axis, AU, Kotak) pass validation
  test('5. Supported banks (SBI, ICICI, Axis, AU, Kotak) pass validation', () => {
    const supported: SupportedBank[] = ['SBI', 'ICICI', 'AXIS', 'AU', 'KOTAK'];
    for (const b of supported) {
      const adapter = BankAdapterFactory.getAdapter(b);
      assert.equal(adapter.bank, b);
      assert.ok(adapter.displayName);
    }
  });

  // 6. Payment account initial state is PENDING
  test('6. President sets initial payment configuration; status is PENDING with is_active = 0', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'SBI',
        accountType: 'CURRENT',
        accountName: 'नवतरुण मित्र मंडळ बँक खाते',
        accountNumber: '39827461928',
        ifsc: 'SBIN0001234',
        branch: 'कोल्हापूर मुख्य शाखा',
        upiId: 'ntm.mandal@sbi',
        merchantId: 'SBICORP9988',
        notes: 'अधिकृत एसबीआय चालू खाते',
      }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.equal(data.data.bank, 'SBI');
    assert.equal(data.data.accountType, 'CURRENT');
    assert.equal(data.data.accountName, 'नवतरुण मित्र मंडळ बँक खाते');
    assert.equal(data.data.maskedAccountNumber, 'XXXX...1928');
    assert.equal(data.data.ifsc, 'SBIN0001234');
    assert.equal(data.data.upiId, 'ntm.mandal@sbi');
    assert.equal(data.data.merchantId, 'SBICORP9988');
    assert.equal(data.data.status, 'PENDING');
    assert.equal(data.data.isActive, false);
    // Secrets must never be exposed
    assert.equal(data.data.apiSecret, undefined);
    assert.equal(data.data.credentials_encrypted, undefined);
  });

  // 7. Attempting to activate without credentials fails
  test('7. Attempting to activate payment configuration without required API secret fails with 400', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(res.status, 400);
    const data = (await res.json()) as any;
    assert.match(data.error, /बँक API सुरक्षा एनक्रिप्शन \/ सिक्रेट की आवश्यक आहे/);
  });

  // 8. Inactive account blocks payment order creation
  test('8. Attempting to create a payment order while config is PENDING is blocked with 400', async () => {
    const res = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId }),
    });
    assert.equal(res.status, 400);
    const data = (await res.json()) as any;
    assert.match(data.error, /ऑनलाइन पेमेंट सध्या उपलब्ध नाही/);
  });

  // 9. Setting valid API credentials allows President to activate config
  test('9. Supplying valid bank API credentials allows activating payment config (status: ACTIVE)', async () => {
    // Update config with valid API secret
    const updateRes = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'SBI',
        accountType: 'CURRENT',
        accountName: 'नवतरुण मित्र मंडळ बँक खाते',
        accountNumber: '39827461928',
        ifsc: 'SBIN0001234',
        upiId: 'ntm.mandal@sbi',
        merchantId: 'SBICORP9988',
        apiSecret: 'sbi_secret_key_secure_32_chars_1234',
      }),
    });
    assert.equal(updateRes.status, 200);

    // Activate
    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const actData = (await actRes.json()) as any;
    assert.equal(actData.data.status, 'ACTIVE');
    assert.equal(actData.data.isActive, true);
    assert.equal(actData.data.hasCredentials, true);
  });

  // 10. Member creates valid payment order with selected bank
  test('10. Setting config to ACTIVE allows member to create a valid payment order with selected bank', async () => {
    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId }),
    });
    assert.equal(orderRes.status, 201);
    const orderData = (await orderRes.json()) as any;
    assert.equal(orderData.success, true);
    assert.equal(orderData.data.order.amount, bishiExpectedAmount);
    assert.equal(orderData.data.order.currency, 'INR');
    assert.equal(orderData.data.order.bank, 'SBI');
    assert.equal(orderData.data.order.status, 'CREATED');
    assert.ok(orderData.data.order.providerOrderId);
    assert.equal(orderData.data.bishiMonth, '2026-10');
    assert.ok(orderData.data.upiIntentUrl.includes('upi://pay'));
  });

  // 11. Invalid Bishi ID returns 404
  test('11. Order creation with non-existent Bishi ID returns 404', async () => {
    const fakeId = crypto.randomUUID();
    const res = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId: fakeId }),
    });
    assert.equal(res.status, 404);
  });

  // 12. Cross-member IDOR protection
  test('12. Member cannot create payment order for another member record (404 IDOR)', async () => {
    const res = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secondaryOrgMemberToken}`,
      },
      body: JSON.stringify({ bishiRecordId }),
    });
    assert.equal(res.status, 404);
  });

  // 13. Cross-tenant IDOR protection
  test('13. Secondary mandal user cannot access primary mandal payment config', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      headers: { Authorization: `Bearer ${secondaryOrgPresToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.data, null);
  });

  // 14. Amount tampering protection
  test('14. Client cannot override amount; backend derives strictly from bishi_records.expected_amount', async () => {
    const res = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId, amount: 10 }), // Tampered amount
    });
    const data = (await res.json()) as any;
    assert.equal(data.data.order.amount, bishiExpectedAmount);
  });

  // 15. Successful bank provider verification
  test('15. Successful provider verification confirms payment, creates ledger txn, and marks bishi PAID', async () => {
    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId }),
    });
    const orderData = (await orderRes.json()) as any;
    const order = orderData.data.order;

    const testAdapter = BankAdapterFactory.getAdapter('SBI');
    const testPaymentId = `pay_${crypto.randomBytes(6).toString('hex')}`;
    const testSignature = testAdapter.generateTestSignature(
      order.providerOrderId,
      testPaymentId,
      'sbi_secret_key_secure_32_chars_1234'
    );

    const verifyRes = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        orderId: order.id,
        providerPaymentId: testPaymentId,
        providerSignature: testSignature,
      }),
    });

    assert.equal(verifyRes.status, 200);
    const verifyData = (await verifyRes.json()) as any;
    assert.equal(verifyData.success, true);
    assert.ok(verifyData.data.transactionId);
    assert.ok(verifyData.data.receiptNumber.startsWith('RCP-'));
    assert.equal(verifyData.data.amount, bishiExpectedAmount);
    assert.equal(verifyData.data.bank, 'SBI');

    // Verify DB state directly
    const db = getDatabase();
    const bishi = db.prepare('SELECT * FROM bishi_records WHERE id = ?').get(bishiRecordId) as any;
    assert.equal(bishi.status, 'PAID');
    assert.equal(bishi.paid_amount, bishiExpectedAmount);
    assert.equal(bishi.payment_method, 'ONLINE_UPI');
    assert.equal(bishi.payment_transaction_id, verifyData.data.transactionId);

    const txn = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(verifyData.data.transactionId) as any;
    assert.equal(txn.payment_method, 'ONLINE_UPI');
    assert.equal(txn.transaction_type, 'BISHI_PAYMENT');
    assert.equal(txn.status, 'CONFIRMED');
    assert.equal(txn.amount, bishiExpectedAmount);
  });

  // 16. Failed provider verification with forged signature
  test('16. Forged or invalid provider signature is rejected with 400 and order marked FAILED', async () => {
    // Generate new Bishi cycle for 2026-11
    await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthYear: '2026-11' }),
    });

    const recsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const novRec = ((await recsRes.json()) as any).data.find((r: any) => r.monthYear === '2026-11');
    assert.ok(novRec);

    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId: novRec.id }),
    });
    const order = ((await orderRes.json()) as any).data.order;

    const verifyRes = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        orderId: order.id,
        providerPaymentId: 'pay_bad_test_123',
        providerSignature: 'invalid_forged_signature_1234567890',
      }),
    });

    assert.equal(verifyRes.status, 400);
    const db = getDatabase();
    const dbOrder = db.prepare('SELECT status FROM payment_orders WHERE id = ?').get(order.id) as any;
    assert.equal(dbOrder.status, 'FAILED');
  });

  // 17. Authenticated member can poll order status
  test('17. Authenticated member can poll order status via GET /api/payments/orders/:orderId/status', async () => {
    const db = getDatabase();
    const orderRow = db.prepare('SELECT id, status FROM payment_orders WHERE member_id = ? LIMIT 1').get(memberId) as any;
    assert.ok(orderRow);

    const res = await fetch(`${baseUrl}/api/payments/orders/${orderRow.id}/status`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.data.id, orderRow.id);
  });

  // 18. IDOR: Member cannot poll another member's order
  test('18. Member cannot poll order status belonging to another member (403 IDOR)', async () => {
    const db = getDatabase();
    const orderRow = db.prepare('SELECT id FROM payment_orders WHERE member_id = ? LIMIT 1').get(memberId) as any;

    const res = await fetch(`${baseUrl}/api/payments/orders/${orderRow.id}/status`, {
      headers: { Authorization: `Bearer ${secondaryOrgMemberToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'दुसऱ्या मंडळाचा तपशील पाहण्यास परवानगी नाही.');
  });

  // 19. Expired order cannot be verified
  test('19. Order past expiration timestamp is marked EXPIRED and cannot be verified', async () => {
    const db = getDatabase();
    const expiredOrderId = crypto.randomUUID();
    const pastDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO payment_orders (
        id, organization_id, member_id, bishi_record_id, amount, currency,
        bank, provider, provider_order_id, status, idempotency_key, expires_at
      ) VALUES (?, ?, ?, ?, 1000, 'INR', 'SBI', 'SBI', 'order_expired_test', 'CREATED', 'key_exp_test', ?)
    `).run(expiredOrderId, NTM_ORG_ID, memberId, bishiRecordId, pastDate);

    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        orderId: expiredOrderId,
        providerPaymentId: 'pay_test_expired',
        providerSignature: 'dummy_sig_12345678',
      }),
    });
    assert.equal(res.status, 400);
    const updated = db.prepare('SELECT status FROM payment_orders WHERE id = ?').get(expiredOrderId) as any;
    assert.equal(updated.status, 'EXPIRED');
  });

  // 20. Public Webhook endpoint rejects invalid signature
  test('20. Public Webhook endpoint rejects requests with invalid HMAC signature with 400', async () => {
    const db = getDatabase();
    const orderRow = db.prepare('SELECT provider_order_id FROM payment_orders WHERE organization_id = ? LIMIT 1').get(NTM_ORG_ID) as any;
    assert.ok(orderRow, 'Should have at least one payment order in DB');

    const body = JSON.stringify({ event: 'payment.captured', providerOrderId: orderRow.provider_order_id });
    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bank-signature': 'invalid_webhook_signature_hex_12345',
      },
      body,
    });
    assert.equal(res.status, 400);
  });

  // 21. Valid Webhook processes payment idempotently
  test('21. Valid webhook signature processes payment and marks bishi PAID idempotently', async () => {
    // Generate Bishi for 2026-12
    await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthYear: '2026-12' }),
    });

    const recsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const decRec = ((await recsRes.json()) as any).data.find((r: any) => r.monthYear === '2026-12');
    assert.ok(decRec);

    // Create order
    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId: decRec.id }),
    });
    const order = ((await orderRes.json()) as any).data.order;

    const testAdapter = BankAdapterFactory.getAdapter('SBI');
    const whPaymentId = `pay_wh_${crypto.randomBytes(4).toString('hex')}`;
    const whPayload = JSON.stringify({
      event: 'payment.captured',
      providerOrderId: order.providerOrderId,
      providerPaymentId: whPaymentId,
      amount: bishiExpectedAmount,
      currency: 'INR',
      status: 'captured',
    });

    const whSig = testAdapter.generateTestWebhookSignature(
      whPayload,
      'sbi_secret_key_secure_32_chars_1234'
    );

    // 1st Webhook delivery
    const whRes1 = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bank-signature': whSig,
      },
      body: whPayload,
    });
    assert.equal(whRes1.status, 200);
    const whData1 = (await whRes1.json()) as any;
    assert.equal(whData1.data.processed, true);

    // 22. Replayed / duplicate webhook
    const whRes2 = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bank-signature': whSig,
      },
      body: whPayload,
    });
    assert.equal(whRes2.status, 200);
    const whData2 = (await whRes2.json()) as any;
    assert.equal(whData2.data.processed, false); // Already processed, no duplicate!

    // Verify exactly 1 ledger transaction created
    const db = getDatabase();
    const txns = db.prepare('SELECT * FROM financial_transactions WHERE reference_id = ?').all(decRec.id);
    assert.equal(txns.length, 1);
  });

  // 23. Mismatched amount in webhook throws 400
  test('23. Webhook with mismatched amount throws 400 and does not credit transaction', async () => {
    // Generate Bishi for 2027-01
    await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthYear: '2027-01' }),
    });

    const recsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const janRec = ((await recsRes.json()) as any).data.find((r: any) => r.monthYear === '2027-01');

    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId: janRec.id }),
    });
    const order = ((await orderRes.json()) as any).data.order;

    const testAdapter = BankAdapterFactory.getAdapter('SBI');
    const whPayload = JSON.stringify({
      event: 'payment.captured',
      providerOrderId: order.providerOrderId,
      providerPaymentId: 'pay_tampered_amount',
      amount: 500, // ₹500 instead of ₹1000
      currency: 'INR',
      status: 'captured',
    });
    const whSig = testAdapter.generateTestWebhookSignature(
      whPayload,
      'sbi_secret_key_secure_32_chars_1234'
    );

    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bank-signature': whSig,
      },
      body: whPayload,
    });
    assert.equal(res.status, 400);
  });

  // 24. Duplicate payment attempt on already PAID bishi
  test('24. Order creation for an already PAID Bishi record returns 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId }), // Already paid in test 15
    });
    assert.equal(res.status, 409);
    const data = (await res.json()) as any;
    assert.match(data.error, /आधीच भरला गेला आहे/);
  });

  // 25. Concurrent payment verifications do not double-credit
  test('25. Concurrent payment verifications do not create duplicate transactions or corrupt DB', async () => {
    // Generate Bishi for 2027-02
    await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthYear: '2027-02' }),
    });

    const recsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const febRec = ((await recsRes.json()) as any).data.find((r: any) => r.monthYear === '2027-02');

    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId: febRec.id }),
    });
    const order = ((await orderRes.json()) as any).data.order;

    const testAdapter = BankAdapterFactory.getAdapter('SBI');
    const testPaymentId = `pay_concurrent_${crypto.randomBytes(4).toString('hex')}`;
    const testSignature = testAdapter.generateTestSignature(
      order.providerOrderId,
      testPaymentId,
      'sbi_secret_key_secure_32_chars_1234'
    );

    // Fire 3 simultaneous verification requests
    const [res1, res2, res3] = await Promise.all([
      fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({ orderId: order.id, providerPaymentId: testPaymentId, providerSignature: testSignature }),
      }),
      fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({ orderId: order.id, providerPaymentId: testPaymentId, providerSignature: testSignature }),
      }),
      fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({ orderId: order.id, providerPaymentId: testPaymentId, providerSignature: testSignature }),
      }),
    ]);

    // All should return 200
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(res3.status, 200);

    // Verify exactly ONE transaction exists in DB
    const db = getDatabase();
    const txns = db.prepare('SELECT * FROM financial_transactions WHERE reference_id = ?').all(febRec.id);
    assert.equal(txns.length, 1);
  });

  // 26. Receipt Creation & Payment Method
  test('26. Receipt generated for online payment shows paymentMethod: ONLINE_UPI', async () => {
    const db = getDatabase();
    const txn = db.prepare('SELECT id FROM financial_transactions WHERE reference_id = ?').get(bishiRecordId) as any;
    assert.ok(txn);

    const res = await fetch(`${baseUrl}/api/transactions/${txn.id}/receipt`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.data.paymentMethod, 'ONLINE_UPI');
    assert.equal(data.data.amount, bishiExpectedAmount);
    assert.ok(data.data.receiptNumber.startsWith('RCP-'));
  });

  // 27. Passbook Update
  test('27. Digital Passbook /api/passbook/me reflects online payment in totalPaid', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.ok(data.data.totalPaid >= bishiExpectedAmount);
    const found = data.data.transactions.find((t: any) => t.paymentMethod === 'ONLINE_UPI');
    assert.ok(found, 'Should find online payment in passbook');
  });

  // 28. Audit Log
  test('28. Audit log records ONLINE_PAYMENT_SUCCESS with zero secret exposure', async () => {
    const db = getDatabase();
    const log = db.prepare("SELECT * FROM audit_logs WHERE action = 'ONLINE_PAYMENT_SUCCESS' LIMIT 1").get() as any;
    assert.ok(log);
    assert.doesNotMatch(log.details, /secret/i);
    assert.doesNotMatch(log.details, /sbi_secret_key/i);
  });

  // 29. Payment provider disabled
  test('29. President sets config to DISABLED; subsequent order creations are blocked', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'DISABLED' }),
    });
    assert.equal(res.status, 200);

    // Generate Bishi for 2027-03
    await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthYear: '2027-03' }),
    });

    const recsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const marRec = ((await recsRes.json()) as any).data.find((r: any) => r.monthYear === '2027-03');

    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId: marRec.id }),
    });
    assert.equal(orderRes.status, 400);
    assert.match(((await orderRes.json()) as any).error, /ऑनलाइन पेमेंट सध्या उपलब्ध नाही/);
  });

  // 30. Switch bank to ICICI and test flow
  test('30. Switching bank to ICICI Bank verifies adapter, config, and orders', async () => {
    const updateRes = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'ICICI',
        accountType: 'CURRENT',
        accountName: 'नवतरुण मंडळ ICICI खाते',
        accountNumber: '001105001234',
        ifsc: 'ICIC0000011',
        upiId: 'mandal@icici',
        merchantId: 'ICICI_EZ_9921',
        apiSecret: 'icici_aes_key_secret_32_chars_ok!',
      }),
    });
    assert.equal(updateRes.status, 200);
    const data = (await updateRes.json()) as any;
    assert.equal(data.data.bank, 'ICICI');
    assert.equal(data.data.maskedAccountNumber, 'XXXX...1234');

    // Activate
    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);

    // Create order with ICICI config
    const recsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const marRec = ((await recsRes.json()) as any).data.find((r: any) => r.monthYear === '2027-03');

    const orderRes = await fetch(`${baseUrl}/api/payments/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ bishiRecordId: marRec.id }),
    });
    assert.equal(orderRes.status, 201);
    const orderData = (await orderRes.json()) as any;
    assert.equal(orderData.data.bank, 'ICICI');
    assert.equal(orderData.data.order.bank, 'ICICI');
    assert.ok(orderData.data.order.providerOrderId.startsWith('icici_ord_'));
  });

  // 31. Existing cash payment still works 100%
  test('31. Existing cash payment flow remains 100% functional and records in ledger', async () => {
    // Generate Bishi for 2027-05
    await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ monthYear: '2027-05' }),
    });

    const recsRes = await fetch(`${baseUrl}/api/members/${memberId}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const mayRec = ((await recsRes.json()) as any).data.find((r: any) => r.monthYear === '2027-05');

    // Treasurer records cash payment
    const cashRes = await fetch(`${baseUrl}/api/bishi/${mayRec.id}/cash-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({
        amount: bishiExpectedAmount,
        notes: 'रोख जमा तपासणी',
      }),
    });
    assert.equal(cashRes.status, 200);
    const cashData = (await cashRes.json()) as any;
    assert.equal(cashData.data.paymentMethod, 'CASH');
    assert.equal(cashData.data.status, 'CONFIRMED');

    const db = getDatabase();
    const bishi = db.prepare('SELECT status, payment_method FROM bishi_records WHERE id = ?').get(mayRec.id) as any;
    assert.equal(bishi.status, 'PAID');
    assert.equal(bishi.payment_method, 'CASH');
  });

  // 32. Mandatory Account Type enforcement
  test('32. Omitting accountType from payment configuration is rejected with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'SBI',
        accountName: 'नवतरुण मित्र मंडळ',
        accountNumber: '39827461928',
        ifsc: 'SBIN0001234',
        branch: 'कोल्हापूर',
        upiId: 'mandal@sbi',
      }),
    });
    assert.equal(res.status, 400);
    const data = (await res.json()) as any;
    assert.ok(
      JSON.stringify(data).includes('खात्याचा प्रकार') || JSON.stringify(data).includes('Account Type'),
      'Should report mandatory account type error'
    );
  });

  // 33. SBI + Current Account: Success
  test('33. Bank combination: SBI + Current Account is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'SBI',
        accountType: 'CURRENT',
        accountName: 'मंडळ SBI चालू खाते',
        accountNumber: '39827461928',
        ifsc: 'SBIN0001234',
        branch: 'मुख्य शाखा',
        upiId: 'mandal@sbi',
        merchantId: 'SBICORP881',
        apiSecret: 'sbi_valid_secret_32_chars_prod!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const data = (await actRes.json()) as any;
    assert.equal(data.data.status, 'ACTIVE');
    assert.equal(data.data.accountType, 'CURRENT');
  });

  // 34. SBI + Savings Account: Activates with valid credentials
  test('34. Bank combination: SBI + Savings Account (Institutional SB) is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'SBI',
        accountType: 'SAVINGS',
        accountName: 'मंडळ SBI बचत खाते',
        accountNumber: '39827461929',
        ifsc: 'SBIN0001234',
        branch: 'मुख्य शाखा',
        upiId: 'mandal@sbi',
        merchantId: 'SBICORP882',
        apiSecret: 'sbi_valid_secret_32_chars_prod!',
      }),
    });
    assert.equal(res.status, 200);
    const saveResult = (await res.json()) as any;
    assert.equal(saveResult.data.accountType, 'SAVINGS');

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const actData = (await actRes.json()) as any;
    assert.equal(actData.data.status, 'ACTIVE');
    assert.equal(actData.data.accountType, 'SAVINGS');
  });

  // 35. ICICI + Current Account: Success
  test('35. Bank combination: ICICI + Current Account is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'ICICI',
        accountType: 'CURRENT',
        accountName: 'मंडळ ICICI चालू खाते',
        accountNumber: '001105001234',
        ifsc: 'ICIC0000011',
        branch: 'बांद्रा शाखा',
        upiId: 'mandal@icici',
        merchantId: 'ICICICORP11',
        apiSecret: 'icici_valid_secret_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const data = (await actRes.json()) as any;
    assert.equal(data.data.status, 'ACTIVE');
  });

  // 36. ICICI + Savings Account: Activates with valid credentials
  test('36. Bank combination: ICICI + Savings Account (Institutional SB) is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'ICICI',
        accountType: 'SAVINGS',
        accountName: 'मंडळ ICICI बचत खाते',
        accountNumber: '001105001235',
        ifsc: 'ICIC0000011',
        branch: 'बांद्रा शाखा',
        upiId: 'mandal@icici',
        merchantId: 'ICICICORP12',
        apiSecret: 'icici_valid_secret_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const actData = (await actRes.json()) as any;
    assert.equal(actData.data.status, 'ACTIVE');
    assert.equal(actData.data.accountType, 'SAVINGS');
  });

  // 37. Axis Bank + Current Account: Success
  test('37. Bank combination: Axis Bank + Current Account is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'AXIS',
        accountType: 'CURRENT',
        accountName: 'मंडळ Axis चालू खाते',
        accountNumber: '918020011223344',
        ifsc: 'UTIB0000045',
        branch: 'वरळी शाखा',
        upiId: 'mandal@axisbank',
        merchantId: 'AXISCORP01',
        apiSecret: 'axis_valid_secret_key_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const data = (await actRes.json()) as any;
    assert.equal(data.data.status, 'ACTIVE');
  });

  // 38. Axis Bank + Savings Account: Activates with valid credentials
  test('38. Bank combination: Axis Bank + Savings Account (Institutional SB) is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'AXIS',
        accountType: 'SAVINGS',
        accountName: 'मंडळ Axis बचत खाते',
        accountNumber: '918020011223345',
        ifsc: 'UTIB0000045',
        branch: 'वरळी शाखा',
        upiId: 'mandal@axisbank',
        merchantId: 'AXISCORP02',
        apiSecret: 'axis_valid_secret_key_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const actData = (await actRes.json()) as any;
    assert.equal(actData.data.status, 'ACTIVE');
    assert.equal(actData.data.accountType, 'SAVINGS');
  });

  // 39. AU Small Finance Bank + Current Account: Success
  test('39. Bank combination: AU Small Finance Bank + Current Account is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'AU',
        accountType: 'CURRENT',
        accountName: 'मंडळ AU चालू खाते',
        accountNumber: '21112233445566',
        ifsc: 'AUBL0002111',
        branch: 'पुणे शाखा',
        upiId: 'mandal@aubank',
        merchantId: 'AUCORP01',
        apiSecret: 'au_valid_secret_key_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const data = (await actRes.json()) as any;
    assert.equal(data.data.status, 'ACTIVE');
  });

  // 40. AU Small Finance Bank + Savings Account: Activates with valid credentials
  test('40. Bank combination: AU Small Finance Bank + Savings Account (Institutional SB) is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'AU',
        accountType: 'SAVINGS',
        accountName: 'मंडळ AU बचत खाते',
        accountNumber: '21112233445567',
        ifsc: 'AUBL0002111',
        branch: 'पुणे शाखा',
        upiId: 'mandal@aubank',
        merchantId: 'AUCORP02',
        apiSecret: 'au_valid_secret_key_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const actData = (await actRes.json()) as any;
    assert.equal(actData.data.status, 'ACTIVE');
    assert.equal(actData.data.accountType, 'SAVINGS');
  });

  // 41. Kotak Mahindra Bank + Current Account: Success
  test('41. Bank combination: Kotak Mahindra Bank + Current Account is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'KOTAK',
        accountType: 'CURRENT',
        accountName: 'मंडळ Kotak चालू खाते',
        accountNumber: '887766554433',
        ifsc: 'KKBK0000888',
        branch: 'ठाणे शाखा',
        upiId: 'mandal@kotak',
        merchantId: 'KOTAKCORP01',
        apiSecret: 'kotak_valid_secret_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const data = (await actRes.json()) as any;
    assert.equal(data.data.status, 'ACTIVE');
  });

  // 42. Kotak Mahindra Bank + Savings Account: Activates with valid credentials
  test('42. Bank combination: Kotak Mahindra Bank + Savings Account (Institutional SB) is supported and activates with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        bank: 'KOTAK',
        accountType: 'SAVINGS',
        accountName: 'मंडळ Kotak बचत खाते',
        accountNumber: '887766554434',
        ifsc: 'KKBK0000888',
        branch: 'ठाणे शाखा',
        upiId: 'mandal@kotak',
        merchantId: 'KOTAKCORP02',
        apiSecret: 'kotak_valid_secret_32_chars_ok!',
      }),
    });
    assert.equal(res.status, 200);

    const actRes = await fetch(`${baseUrl}/api/payments/config/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    assert.equal(actRes.status, 200);
    const actData = (await actRes.json()) as any;
    assert.equal(actData.data.status, 'ACTIVE');
    assert.equal(actData.data.accountType, 'SAVINGS');
  });
});
