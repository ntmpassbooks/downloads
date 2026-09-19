process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;

let presidentToken = '';
let treasurerToken = '';
let memberToken = '';

const NTM_MEMBER_ID = 'usr-ntm-member-01';

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

  // 1. Login as President
  const presRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
  });
  const presData = await presRes.json();
  presidentToken = presData.token;

  // 2. Login as Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  const treasData = await treasRes.json();
  treasurerToken = treasData.token;

  // 3. Login as Member
  const memRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  const memData = await memRes.json();
  memberToken = memData.token;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeDatabase();
});

describe('NTM Passbook — CRITICAL ROLE RULE: President, Treasurer, Member RBAC Suite', () => {
  // 1. Treasurer Full Operational Management Tests
  describe('1. Treasurer Operational Access (Treasurer is NOT View-Only)', () => {
    test('1.1 Treasurer can list Mandal members', async () => {
      const res = await fetch(`${baseUrl}/api/members`, {
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));
    });

    test('1.2 Treasurer can configure Bishi for a member', async () => {
      const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: 1500, dueDay: 15 }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.monthlyAmount, 1500);
    });

    test('1.3 Treasurer can generate monthly Bishi cycle', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-07' }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    test('1.4 Treasurer can create and disburse a real loan', async () => {
      const res = await fetch(`${baseUrl}/api/loans`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: NTM_MEMBER_ID,
          amount: 8000,
          notes: 'खजिनदाराने मंजूर केलेले कर्ज',
        }),
      });
      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.amount, 8000);
    });

    test('1.5 Treasurer can record cash loan repayment', async () => {
      const listRes = await fetch(`${baseUrl}/api/loans`, {
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      const listBody = await listRes.json();
      assert.ok(listBody.data.length > 0);
      const loanId = listBody.data[0].id;

      const res = await fetch(`${baseUrl}/api/loans/${loanId}/repay-cash`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 2000,
          notes: 'खजिनदाराने स्वीकारलेली परतफेड',
        }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    test('1.6 Treasurer can create and record Mandal expense', async () => {
      const res = await fetch(`${baseUrl}/api/expenses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 1200,
          category: 'मंडळ कार्यक्रम',
          reason: 'मासिक सभेचा अधिकृत खर्च',
        }),
      });
      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    test('1.7 Treasurer can record Vargani / Jama contribution', async () => {
      const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: NTM_MEMBER_ID,
          amount: 500,
          category: 'उत्सव वर्गणी',
          notes: 'गणेशोत्सव वर्गणी जमा',
        }),
      });
      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    test('1.8 Treasurer can export financial audit CSV and view monthly statements', async () => {
      const auditRes = await fetch(`${baseUrl}/api/reports/export-audit`, {
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(auditRes.status, 200);
      assert.match(auditRes.headers.get('content-type') || '', /csv/);

      const stmtRes = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-07`, {
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(stmtRes.status, 200);
    });

    test('1.9 Treasurer can trigger notification scheduler run', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/scheduler/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });
  });

  // 2. Member Restrictions (Self-service only)
  describe('2. Member Access: Self-Service Only (Strict 403 on operational management)', () => {
    test('2.1 Member cannot configure Bishi (403)', async () => {
      const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: 1000, dueDay: 10 }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.2 Member cannot generate monthly Bishi cycle (403)', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-07' }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.3 Member cannot create loans (403)', async () => {
      const res = await fetch(`${baseUrl}/api/loans`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: NTM_MEMBER_ID,
          amount: 5000,
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.4 Member cannot record expenses (403)', async () => {
      const res = await fetch(`${baseUrl}/api/expenses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 500,
          category: 'चहा-पान',
          reason: 'सदस्याने दाखल केलेला खर्च',
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.5 Member cannot record Vargani contributions (403)', async () => {
      const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: NTM_MEMBER_ID,
          amount: 500,
          category: 'उत्सव वर्गणी',
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.6 Member cannot view other members in directory (403)', async () => {
      const res = await fetch(`${baseUrl}/api/members`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.7 Member cannot export financial audit (403)', async () => {
      const res = await fetch(`${baseUrl}/api/reports/export-audit`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // 3. President-Only Ownership and Security Administration Controls
  describe('3. President-Only Administrative & Security Safeguards', () => {
    test('3.1 Treasurer cannot view Member PIN (403)', async () => {
      const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/pin`, {
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.2 President can view Member PIN (200 with PIN)', async () => {
      const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/pin`, {
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(typeof body.data.pin, 'string');
    });

    test('3.3 Treasurer cannot assign/transfer roles (403)', async () => {
      const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/role`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'TREASURER' }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.4 Treasurer cannot delete a member (403)', async () => {
      const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.5 Treasurer cannot update payment gateway secrets/config (403)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'RAZORPAY',
          keyId: 'rzp_test_new',
          keySecret: 'secret_new',
          upiId: 'test@upi',
          merchantName: 'NTM Test',
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.6 Treasurer cannot toggle payment gateway status (403)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/config/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isEnabled: false }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.7 Treasurer cannot delete Mandal permanently (403)', async () => {
      const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationText: 'DELETE_MANDAL_PERMANENTLY' }),
      });
      assert.strictEqual(res.status, 403);
    });
  });
});
