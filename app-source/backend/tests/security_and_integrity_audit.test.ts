process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_security_audit_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;
const TEST_DB = './data/ntm_security_audit_test.sqlite';

let mandalAPresToken = '';
let mandalATreasToken = '';
let mandalAMem1Token = '';
let mandalAMem2Token = '';
let mandalAMem1Id = 'usr-ntm-member-01';
let mandalAMem2Id = '';
const MANDAL_A_ORG_ID = 'org-ntm-001';

let mandalBPresToken = '';
let mandalBTreasToken = '';
let mandalBMemToken = '';
let mandalBMemId = '';
let mandalBOrgId = '';

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

  const aPresRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
  });
  mandalAPresToken = ((await aPresRes.json()) as any).token;

  const aTreasRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  mandalATreasToken = ((await aTreasRes.json()) as any).token;

  const aMemRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  mandalAMem1Token = ((await aMemRes.json()) as any).token;

  const createMem2Res = await fetch(baseUrl + '/api/members', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + mandalAPresToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fullName: 'मंगेश पाटील',
      phone: '9876543233',
      role: 'MEMBER',
      initialPin: '1234',
    }),
  });
  mandalAMem2Id = ((await createMem2Res.json()) as any).data.id;

  const aMem2Res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543233', pin: '1234' }),
  });
  mandalAMem2Token = ((await aMem2Res.json()) as any).token;

  const bRegRes = await fetch(baseUrl + '/api/auth/register-president', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mandalName: 'एकता तरुण मंडळ',
      fullName: 'गणेश शिंदे',
      phone: '9822000001',
      pin: '5678',
      confirmPin: '5678',
    }),
  });
  const bRegData = (await bRegRes.json()) as any;
  mandalBPresToken = bRegData.token;
  mandalBOrgId = bRegData.organization.id;

  await fetch(baseUrl + '/api/members', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + mandalBPresToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fullName: 'महेश जाधव',
      phone: '9822000002',
      role: 'TREASURER',
      initialPin: '5678',
    }),
  });

  const bTreasLogin = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9822000002', pin: '5678' }),
  });
  mandalBTreasToken = ((await bTreasLogin.json()) as any).token;

  const bMemAdd = await fetch(baseUrl + '/api/members', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + mandalBPresToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fullName: 'रोहन पवार',
      phone: '9822000003',
      role: 'MEMBER',
      initialPin: '5678',
    }),
  });
  mandalBMemId = ((await bMemAdd.json()) as any).data.id;

  const bMemLogin = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9822000003', pin: '5678' }),
  });
  mandalBMemToken = ((await bMemLogin.json()) as any).token;
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

describe('NTM Passbook — Comprehensive Phase 2 Security & Financial Integrity Suite', () => {
  describe('1. Cross-Mandal Tenant Isolation & IDOR Defense', () => {
    test('1.1 Mandal A Member cannot access Mandal B Member profile (/api/members/:id -> 403)', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalBMemId, {
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.2 Mandal A President cannot access Mandal B Member profile (/api/members/:id -> 403)', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalBMemId, {
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.3 Mandal A President cannot alter status of Mandal B Member -> 403', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalBMemId + '/status', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: false }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.4 Mandal A President cannot delete Mandal B Member -> 403', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalBMemId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.5 Mandal A President cannot view Mandal B organization info (/api/organizations/:id -> 403)', async () => {
      const res = await fetch(baseUrl + '/api/organizations/' + mandalBOrgId, {
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.6 Mandal A President cannot view Mandal B member PIN (/api/members/:id/pin -> 404)', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalBMemId + '/pin', {
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('2. Role Escalation & RBAC Boundaries', () => {
    test('2.1 Member attempting President-only member creation is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/members', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAMem1Token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fullName: 'हॅकर', phone: '9999999999', role: 'MEMBER' }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.2 Member attempting Treasurer role assignment is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalAMem2Id + '/role', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + mandalAMem1Token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'TREASURER' }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.3 Member attempting permanent mandal deletion is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/organizations/permanent-delete', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAMem1Token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin: '1234' }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.4 Member attempting Cash Bishi Mark Paid is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/bishi/rec-fake-001/cash-payment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAMem1Token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 1000 }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.5 Member attempting to approve/create loan is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/loans', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAMem1Token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ memberId: mandalAMem1Id, amount: 5000 }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.6 Member attempting to record mandal expense is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/expenses', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAMem1Token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 500, category: 'साहित्य', reason: 'स्टेशनरी' }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.7 Member attempting to view mandal financial ledger is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/ledger', {
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.8 Member attempting to view mandal financial summary is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/ledger/mandal-summary', {
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.9 Treasurer attempting President-only member creation is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/members', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fullName: 'अनधिकृत', phone: '9999999998', role: 'MEMBER' }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.10 Treasurer attempting President-only payment configuration edit is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/payments/config', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bank: 'SBI',
          accountName: 'NTM Treasury',
          accountType: 'CURRENT',
          accountNumber: '123456789012',
          ifsc: 'SBIN0001234',
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.11 Treasurer attempting permanent mandal deletion is rejected with 403', async () => {
      const res = await fetch(baseUrl + '/api/organizations/permanent-delete', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin: '1234' }),
      });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('3. Same-Mandal Member Personal Data Isolation', () => {
    test('3.1 Member 1 cannot view Member 2 passbook (/api/passbook/member/:id -> 403)', async () => {
      const res = await fetch(baseUrl + '/api/passbook/member/' + mandalAMem2Id, {
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.2 Member 1 cannot view Member 2 loans (/api/loans/member/:id -> 403)', async () => {
      const res = await fetch(baseUrl + '/api/loans/member/' + mandalAMem2Id, {
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.3 Member 1 cannot view Member 2 Bishi records (/api/members/:id/bishi-records -> 403)', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalAMem2Id + '/bishi-records', {
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });

    test('3.4 Member 1 cannot view Member 2 Bishi config (/api/members/:id/bishi-config -> 403)', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalAMem2Id + '/bishi-config', {
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('4. Bishi Financial Integrity & Concurrency', () => {
    let testBishiRecordId = '';

    before(async () => {
      await fetch(baseUrl + '/api/members/' + mandalAMem1Id + '/bishi-config', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: 2500, dueDay: 20 }),
      });

      await fetch(baseUrl + '/api/bishi/generate-cycle', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-10' }),
      });

      const recsRes = await fetch(baseUrl + '/api/members/' + mandalAMem1Id + '/bishi-records', {
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      const recs = (await recsRes.json()) as any;
      const r = recs.data.find((x: any) => x.monthYear === '2026-10');
      testBishiRecordId = r.id;
    });

    test('4.1 Cash payment with incorrect amount is strictly rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/bishi/' + testBishiRecordId + '/cash-payment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 2000 }),
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.match(data.error, /2500/);
    });

    test('4.2 Concurrent cash payment requests: exactly 1 succeeds, second fails with 409 Conflict', async () => {
      const [res1, res2] = await Promise.all([
        fetch(baseUrl + '/api/bishi/' + testBishiRecordId + '/cash-payment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + mandalAPresToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ amount: 2500 }),
        }),
        fetch(baseUrl + '/api/bishi/' + testBishiRecordId + '/cash-payment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + mandalATreasToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ amount: 2500 }),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [200, 409]);
    });

    test('4.3 Subsequent cash payment attempt on already paid record returns 409 Conflict', async () => {
      const res = await fetch(baseUrl + '/api/bishi/' + testBishiRecordId + '/cash-payment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 2500 }),
      });
      assert.strictEqual(res.status, 409);
    });

    test('4.4 Destructive deletion of paid Bishi record is blocked with 400', async () => {
      const res = await fetch(baseUrl + '/api/bishi/records/' + testBishiRecordId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.match(data.error, /भरलेली बीसी नोंद हटवता येत नाही/);
    });
  });

  describe('5. Loan Financial Integrity & Overpayment Protection', () => {
    let testLoanId = '';

    before(async () => {
      const res = await fetch(baseUrl + '/api/loans', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: mandalAMem1Id,
          amount: 10000,
          notes: 'सुरक्षा चाचणी कर्ज',
        }),
      });
      const data = (await res.json()) as any;
      testLoanId = data.data.id;
    });

    test('5.1 Repayment exceeding outstanding balance is strictly rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/loans/' + testLoanId + '/repay-cash', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 15000 }),
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.match(data.error, /10000/);
    });

    test('5.2 Partial repayment succeeds and updates outstanding balance correctly', async () => {
      const res = await fetch(baseUrl + '/api/loans/' + testLoanId + '/repay-cash', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 4000 }),
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.data.loan.outstandingBalance, 6000);
      assert.strictEqual(data.data.loan.status, 'ACTIVE');
    });

    test('5.3 Deletion of loan with existing repayments is strictly rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/loans/' + testLoanId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.match(data.error, /परतफेड असलेले कर्ज हटवता येत नाही/);
    });

    test('5.4 Final repayment closes loan automatically', async () => {
      const res = await fetch(baseUrl + '/api/loans/' + testLoanId + '/repay-cash', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 6000 }),
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.data.loan.outstandingBalance, 0);
      assert.strictEqual(data.data.loan.status, 'CLOSED');
    });

    test('5.5 Repayment on already closed loan is rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/loans/' + testLoanId + '/repay-cash', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 1000 }),
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.match(data.error, /पूर्ण भरले गेले आहे/);
    });
  });

  describe('6. Input Validation & Boundary Integrity', () => {
    test('6.1 Negative bishi monthly amount is rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalAMem1Id + '/bishi-config', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: -500, dueDay: 10 }),
      });
      assert.strictEqual(res.status, 400);
    });

    test('6.2 Zero bishi monthly amount is rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalAMem1Id + '/bishi-config', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: 0, dueDay: 10 }),
      });
      assert.strictEqual(res.status, 400);
    });

    test('6.3 Invalid due day 32 is rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/members/' + mandalAMem1Id + '/bishi-config', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: 1000, dueDay: 32 }),
      });
      assert.strictEqual(res.status, 400);
    });

    test('6.4 Negative loan amount is rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/loans', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ memberId: mandalAMem1Id, amount: -1000 }),
      });
      assert.strictEqual(res.status, 400);
    });

    test('6.5 Negative expense amount is rejected with 400', async () => {
      const res = await fetch(baseUrl + '/api/expenses', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: -200, category: 'इतर', reason: 'अवैध' }),
      });
      assert.strictEqual(res.status, 400);
    });

    test('6.6 Rapid duplicate expense submission within 2s is rejected with 409', async () => {
      const payload = { amount: 350, category: 'प्रवास', reason: 'बस प्रवास भाडे' };
      const res1 = await fetch(baseUrl + '/api/expenses', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res1.status, 201);

      const res2 = await fetch(baseUrl + '/api/expenses', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalATreasToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res2.status, 409);
    });
  });

  describe('7. Session Security & Immediate Deactivation Invalidation', () => {
    test('7.1 Logout revokes session token immediately (subsequent call returns 401)', async () => {
      const loginRes = await fetch(baseUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543233', pin: '1234' }),
      });
      const tempToken = ((await loginRes.json()) as any).token;

      const meRes1 = await fetch(baseUrl + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + tempToken },
      });
      assert.strictEqual(meRes1.status, 200);

      const logoutRes = await fetch(baseUrl + '/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tempToken },
      });
      assert.strictEqual(logoutRes.status, 200);

      const meRes2 = await fetch(baseUrl + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + tempToken },
      });
      assert.strictEqual(meRes2.status, 401);
    });

    test('7.2 Deactivating a member immediately revokes all their active sessions', async () => {
      const loginRes = await fetch(baseUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543233', pin: '1234' }),
      });
      const activeMemberToken = ((await loginRes.json()) as any).token;

      const deactRes = await fetch(baseUrl + '/api/members/' + mandalAMem2Id + '/status', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: false }),
      });
      assert.strictEqual(deactRes.status, 200);

      const checkRes = await fetch(baseUrl + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + activeMemberToken },
      });
      assert.strictEqual(checkRes.status, 401);

      await fetch(baseUrl + '/api/members/' + mandalAMem2Id + '/status', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: true }),
      });
    });
  });

  describe('8. Payment & Notification Isolation & Zero Credential Exposure', () => {
    test('8.1 Payment configuration masks account number for Treasurer', async () => {
      await fetch(baseUrl + '/api/payments/config', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + mandalAPresToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bank: 'SBI',
          accountName: 'NTM Treasury Mandal',
          accountType: 'CURRENT',
          accountNumber: '123456789012',
          ifsc: 'SBIN0001234',
          upiId: 'ntm@sbi',
        }),
      });

      const treasCfgRes = await fetch(baseUrl + '/api/payments/config', {
        headers: { Authorization: 'Bearer ' + mandalATreasToken },
      });
      assert.strictEqual(treasCfgRes.status, 200);
      const treasData = (await treasCfgRes.json()) as any;
      assert.strictEqual(treasData.data.accountNumber, 'XXXX...9012');
      assert.strictEqual(treasData.data.hasCredentials, false);
      assert.strictEqual(treasData.data.apiSecret, undefined);
      assert.strictEqual(treasData.data.credentials_encrypted, undefined);
    });

    test('8.2 Member cannot mark another member notification as read -> 403', async () => {
      const db = getDatabase();
      const notifId = 'notif-test-mem2-' + Date.now();
      db.prepare(`
        INSERT INTO notifications (id, organization_id, user_id, type, title, message)
        VALUES (?, ?, ?, 'BISHI_DUE', 'सूचना', 'हप्ता बाकी आहे')
      `).run(notifId, MANDAL_A_ORG_ID, mandalAMem2Id);

      const res = await fetch(baseUrl + '/api/notifications/' + notifId + '/read', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + mandalAMem1Token },
      });
      assert.strictEqual(res.status, 403);
    });

    test('8.3 Zero PIN hash or salt is exposed in /api/auth/me or /api/members', async () => {
      const meRes = await fetch(baseUrl + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      const meData = (await meRes.json()) as any;
      assert.strictEqual(meData.user.pin_hash, undefined);
      assert.strictEqual(meData.user.pin_salt, undefined);
      assert.strictEqual(meData.user.encrypted_pin, undefined);

      const memListRes = await fetch(baseUrl + '/api/members', {
        headers: { Authorization: 'Bearer ' + mandalAPresToken },
      });
      const memListData = (await memListRes.json()) as any;
      for (const m of memListData.data) {
        assert.strictEqual(m.pin_hash, undefined);
        assert.strictEqual(m.pin_salt, undefined);
        assert.strictEqual(m.encrypted_pin, undefined);
      }
    });
  });
});