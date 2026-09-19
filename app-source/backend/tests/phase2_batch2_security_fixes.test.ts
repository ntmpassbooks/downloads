process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_phase2_batch2_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;
const TEST_DB = './data/ntm_phase2_batch2_test.sqlite';

let mandalAPresToken = '';
let mandalATreasToken = '';
let mandalAMemToken = '';
let mandalAMemId = 'usr-ntm-member-01';
const MANDAL_A_ORG_ID = 'org-ntm-001';

let mandalBPresToken = '';
let mandalBTreasToken = '';
let mandalBMemToken = '';
let mandalBMemId = '';
let mandalBOrgId = '';

let mandalAOrderId = '';

before(async () => {
  closeDatabase();
  if (fs.existsSync(TEST_DB)) {
    try { fs.unlinkSync(TEST_DB); } catch {}
  }
  seedDatabase();
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

  // Login Mandal A President (9876543210 / 1234)
  const aPresRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
  });
  assert.strictEqual(aPresRes.status, 200);
  const aPresBody = await aPresRes.json();
  mandalAPresToken = aPresBody.token;

  // Login Mandal A Treasurer (9876543211 / 1234)
  const aTreasRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  assert.strictEqual(aTreasRes.status, 200);
  const aTreasBody = await aTreasRes.json();
  mandalATreasToken = aTreasBody.token;

  // Login Mandal A Member (9876543212 / 1234)
  const aMemRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  assert.strictEqual(aMemRes.status, 200);
  const aMemBody = await aMemRes.json();
  mandalAMemToken = aMemBody.token;

  // Register Mandal B
  const bRegRes = await fetch(baseUrl + '/api/auth/register-president', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mandalName: 'एकता मित्र मंडळ (पुणे)',
      fullName: 'गणेश सावंत',
      phone: '9822112233',
      pin: '9876',
      confirmPin: '9876',
    }),
  });
  assert.strictEqual(bRegRes.status, 201);
  const bRegBody = await bRegRes.json();
  mandalBPresToken = bRegBody.token;
  mandalBOrgId = bRegBody.organization.id;

  // Create Member in Mandal B
  const bMemCreateRes = await fetch(baseUrl + '/api/members', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mandalBPresToken}`,
    },
    body: JSON.stringify({
      fullName: 'सचिन पाटील',
      phone: '9822445566',
      role: 'MEMBER',
      initialPin: '4321',
    }),
  });
  assert.strictEqual(bMemCreateRes.status, 201);
  const bMemCreateBody = await bMemCreateRes.json();
  mandalBMemId = bMemCreateBody.data.id;

  // Login Mandal B Member
  const bMemLoginRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9822445566', pin: '4321' }),
  });
  assert.strictEqual(bMemLoginRes.status, 200);
  const bMemLoginBody = await bMemLoginRes.json();
  mandalBMemToken = bMemLoginBody.token;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeDatabase();
  if (fs.existsSync(TEST_DB)) {
    try { fs.unlinkSync(TEST_DB); } catch {}
  }
});

describe('NTM Passbook — Phase 2 Batch 2 Security Fixes Suite', () => {

  // =========================================================================
  // FIX 1: GLOBAL PHONE UNIQUENESS & CONCURRENCY
  // =========================================================================
  describe('1. Global Phone Number Uniqueness & Concurrency Protection', () => {
    const phoneX = '9811002233';

    test('1.1 Member in Mandal A successfully registers phone X', async () => {
      const res = await fetch(baseUrl + '/api/members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mandalAPresToken}`,
        },
        body: JSON.stringify({
          fullName: 'राहुल शिंदे (मंडळ A)',
          phone: phoneX,
          role: 'MEMBER',
          initialPin: '1111',
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.phone, phoneX);
      assert.strictEqual(body.data.organizationId, MANDAL_A_ORG_ID);
    });

    test('1.2 Attempt to create Member in Mandal B with same phone X returns 409 Conflict', async () => {
      const res = await fetch(baseUrl + '/api/members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mandalBPresToken}`,
        },
        body: JSON.stringify({
          fullName: 'राहुल शिंदे (मंडळ B)',
          phone: phoneX,
          role: 'MEMBER',
          initialPin: '2222',
        }),
      });

      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'हा मोबाईल क्रमांक आधीच नोंदणीकृत आहे. कृपया लॉगिन करा.');
      // Verify no sensitive internal information leaked
      assert.strictEqual(body.data, undefined);
      assert.strictEqual(body.userId, undefined);
      assert.strictEqual(body.organizationId, undefined);
      assert.strictEqual(body.pin, undefined);
      assert.strictEqual(body.hash, undefined);
    });

    test('1.3 Verify no second user was created in the database for phone X', () => {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM users WHERE phone = ?').all(phoneX) as any[];
      assert.strictEqual(rows.length, 1);
    });

    test('1.4 Verify existing user in Mandal A remains completely unchanged', () => {
      const db = getDatabase();
      const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phoneX) as any;
      assert.ok(user);
      assert.strictEqual(user.organization_id, MANDAL_A_ORG_ID);
      assert.strictEqual(user.full_name, 'राहुल शिंदे (मंडळ A)');
      assert.strictEqual(user.role, 'MEMBER');
      assert.strictEqual(user.is_active, 1);
    });

    test('1.5 Concurrent member creation requests with the same phone: exactly one succeeds, other fails safely', async () => {
      const phoneY = '9822998877';

      // Fire two concurrent requests with identical phone number
      const [res1, res2] = await Promise.all([
        fetch(baseUrl + '/api/members', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mandalAPresToken}`,
          },
          body: JSON.stringify({
            fullName: 'अनिल पवार (A)',
            phone: phoneY,
            role: 'MEMBER',
          }),
        }),
        fetch(baseUrl + '/api/members', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mandalBPresToken}`,
          },
          body: JSON.stringify({
            fullName: 'अनिल पवार (B)',
            phone: phoneY,
            role: 'MEMBER',
          }),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409]);

      // Verify the 409 response has the exact required Marathi message
      const failedRes = res1.status === 409 ? res1 : res2;
      const failedBody = await failedRes.json();
      assert.strictEqual(failedBody.success, false);
      assert.strictEqual(failedBody.error, 'हा मोबाईल क्रमांक आधीच नोंदणीकृत आहे. कृपया लॉगिन करा.');

      // Verify exactly one user was created in the database
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM users WHERE phone = ?').all(phoneY);
      assert.strictEqual(rows.length, 1);
    });

    test('1.6 President registration with an already-registered member phone returns 409 Conflict', async () => {
      const res = await fetch(baseUrl + '/api/auth/register-president', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mandalName: 'छत्रपती तरुण मंडळ',
          fullName: 'नाव',
          phone: phoneX, // already registered in Mandal A
          pin: '5555',
          confirmPin: '5555',
        }),
      });

      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.error, /हा मोबाईल क्रमांक आधीच नोंदणीकृत आहे/);

      // Verify new Mandal was not created
      const db = getDatabase();
      const org = db.prepare('SELECT * FROM organizations WHERE name = ?').get('छत्रपती तरुण मंडळ');
      assert.strictEqual(org, undefined);
    });
  });

  // =========================================================================
  // FIX 2: PAYMENT ORDER STATUS TENANT HARDENING
  // =========================================================================
  describe('2. Payment Order Status Cross-Mandal Hardening', () => {

    test('2.1 Setup: Create a payment order in Mandal A', async () => {
      // 1. Configure Bishi for Mandal A Member
      const bishiCfgRes = await fetch(baseUrl + `/api/members/${mandalAMemId}/bishi-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mandalAPresToken}`,
        },
        body: JSON.stringify({
          monthlyAmount: 1000,
          dueDay: 10,
        }),
      });
      assert.strictEqual(bishiCfgRes.status, 200);

      // 2. Generate Bishi cycle
      const genRes = await fetch(baseUrl + '/api/bishi/generate-cycle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mandalAPresToken}`,
        },
        body: JSON.stringify({
          monthYear: '2026-09',
        }),
      });
      assert.strictEqual(genRes.status, 200);

      // 3. Get Mandal A Member's Bishi record
      const recRes = await fetch(baseUrl + `/api/members/${mandalAMemId}/bishi-records?year=2026`, {
        headers: { Authorization: `Bearer ${mandalAMemToken}` },
      });
      assert.strictEqual(recRes.status, 200);
      const recBody = await recRes.json();
      const bishiRecord = recBody.data.find((r: any) => r.monthYear === '2026-09');
      assert.ok(bishiRecord);

      // 4. Create Payment Order in Mandal A
      mandalAOrderId = 'ord-test-mandal-a-' + crypto.randomUUID();
      const db = getDatabase();
      db.prepare(`
        INSERT INTO payment_orders (
          id, organization_id, member_id, bishi_record_id, amount, currency,
          bank, provider, provider_order_id, status, idempotency_key, expires_at
        ) VALUES (?, ?, ?, ?, 1000, 'INR', 'SBI', 'SBI', ?, 'PENDING', ?, datetime('now', '+1 hour'))
      `).run(
        mandalAOrderId,
        MANDAL_A_ORG_ID,
        mandalAMemId,
        bishiRecord.id,
        'p_ord_' + crypto.randomUUID(),
        'idem_' + crypto.randomUUID()
      );
      assert.ok(mandalAOrderId);
    });

    test('2.2 Mandal B President requesting Mandal A order status is rejected with 403 Forbidden', async () => {
      const res = await fetch(baseUrl + `/api/payments/orders/${mandalAOrderId}/status`, {
        headers: { Authorization: `Bearer ${mandalBPresToken}` },
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'दुसऱ्या मंडळाचा तपशील पाहण्यास परवानगी नाही.');

      // Verify response leaks zero order, member, amount, or organization information
      assert.strictEqual(body.data, undefined);
      assert.strictEqual(body.amount, undefined);
      assert.strictEqual(body.memberId, undefined);
      assert.strictEqual(body.organizationId, undefined);
      assert.strictEqual(body.bank, undefined);
    });

    test('2.3 Mandal B Member requesting Mandal A order status is rejected with 403 Forbidden', async () => {
      const res = await fetch(baseUrl + `/api/payments/orders/${mandalAOrderId}/status`, {
        headers: { Authorization: `Bearer ${mandalBMemToken}` },
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'दुसऱ्या मंडळाचा तपशील पाहण्यास परवानगी नाही.');
      assert.strictEqual(body.data, undefined);
    });

    test('2.4 Requesting status of genuinely nonexistent order returns 404 Not Found', async () => {
      const res = await fetch(baseUrl + '/api/payments/orders/ord-non-existent-99999/status', {
        headers: { Authorization: `Bearer ${mandalAPresToken}` },
      });

      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.error, /पेमेंट ऑर्डर सापडली नाही/);
    });

    test('2.5 Authorized same-Mandal Member (owner) can view order status successfully', async () => {
      const res = await fetch(baseUrl + `/api/payments/orders/${mandalAOrderId}/status`, {
        headers: { Authorization: `Bearer ${mandalAMemToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.id, mandalAOrderId);
      assert.strictEqual(body.data.amount, 1000);
      assert.strictEqual(body.data.status, 'PENDING');
      assert.strictEqual(body.data.organizationId, MANDAL_A_ORG_ID);
    });

    test('2.6 Authorized same-Mandal President can view order status successfully', async () => {
      const res = await fetch(baseUrl + `/api/payments/orders/${mandalAOrderId}/status`, {
        headers: { Authorization: `Bearer ${mandalAPresToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.id, mandalAOrderId);
      assert.strictEqual(body.data.amount, 1000);
    });

    test('2.7 Authorized same-Mandal Treasurer can view order status successfully', async () => {
      const res = await fetch(baseUrl + `/api/payments/orders/${mandalAOrderId}/status`, {
        headers: { Authorization: `Bearer ${mandalATreasToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.id, mandalAOrderId);
      assert.strictEqual(body.data.amount, 1000);
    });
  });
});
