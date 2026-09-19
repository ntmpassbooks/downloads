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

const NTM_ORG_ID = 'org-ntm-001';
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
  presidentToken = (await presRes.json()).token;

  // 2. Login as Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  treasurerToken = (await treasRes.json()).token;

  // 3. Login as Member
  const memRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  memberToken = (await memRes.json()).token;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeDatabase();
});

describe('NTM Passbook — Safe Deletion & Financial Safeguards: Bishi & Loan Management', () => {
  // ==========================================
  // 1. BISHI RECORD DELETION TESTS
  // ==========================================
  describe('1. Bishi Record Safe Deletion', () => {
    let pendingRecordId1 = '';
    let pendingRecordId2 = '';
    let paidRecordId = '';

    before(async () => {
      const db = getDatabase();
      // Configure Bishi for member
      await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: 2000, dueDay: 15 }),
      });

      // Generate cycle for 2026-08
      await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-08' }),
      });

      // Generate cycle for 2026-09
      await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-09' }),
      });

      // Generate cycle for 2026-10
      await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-10' }),
      });

      const r8 = db.prepare("SELECT id FROM bishi_records WHERE organization_id = ? AND month_year = '2026-08'").get(NTM_ORG_ID) as any;
      const r9 = db.prepare("SELECT id FROM bishi_records WHERE organization_id = ? AND month_year = '2026-09'").get(NTM_ORG_ID) as any;
      const r10 = db.prepare("SELECT id FROM bishi_records WHERE organization_id = ? AND month_year = '2026-10'").get(NTM_ORG_ID) as any;

      pendingRecordId1 = r8.id;
      pendingRecordId2 = r9.id;
      paidRecordId = r10.id;

      // Mark paidRecordId as PAID with cash
      await fetch(`${baseUrl}/api/bishi/${paidRecordId}/cash-payment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 2000, notes: 'Paid for test' }),
      });
    });

    test('1.1 Member CANNOT delete Bishi record (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/records/${pendingRecordId1}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    test('1.2 Unauthenticated request is rejected (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/records/${pendingRecordId1}`, {
        method: 'DELETE',
      });
      assert.strictEqual(res.status, 401);
    });

    test('1.3 President CAN delete an unpaid/pending Bishi record (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/records/${pendingRecordId1}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.id, pendingRecordId1);

      // Verify row is gone from database
      const db = getDatabase();
      const check = db.prepare('SELECT id FROM bishi_records WHERE id = ?').get(pendingRecordId1);
      assert.strictEqual(check, undefined);

      // Verify audit log
      const audit = db.prepare("SELECT action, details FROM audit_logs WHERE action = 'BISHI_RECORD_DELETED' ORDER BY created_at DESC LIMIT 1").get() as any;
      assert.ok(audit);
      assert.match(audit.details, /2026-08/);
    });

    test('1.4 Treasurer CAN delete an unpaid/pending Bishi record (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/records/${pendingRecordId2}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.id, pendingRecordId2);

      const db = getDatabase();
      const check = db.prepare('SELECT id FROM bishi_records WHERE id = ?').get(pendingRecordId2);
      assert.strictEqual(check, undefined);
    });

    test('1.5 PAID Bishi record CANNOT be deleted by President (400 Bad Request - Financial Protection)', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/records/${paidRecordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.error, /भरलेली बीसी नोंद हटवता येत नाही/);

      // Verify record still exists in database
      const db = getDatabase();
      const check = db.prepare('SELECT id, status FROM bishi_records WHERE id = ?').get(paidRecordId) as any;
      assert.ok(check);
      assert.strictEqual(check.status, 'PAID');
    });

    test('1.6 PAID Bishi record CANNOT be deleted by Treasurer (400 Bad Request - Financial Protection)', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/records/${paidRecordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.error, /भरलेली बीसी नोंद हटवता येत नाही/);
    });

    test('1.7 Non-existent Bishi record returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/bishi/records/non-existent-rec`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 404);
    });
  });

  // ==========================================
  // 2. LOAN MANAGEMENT DELETION & CANCELLATION TESTS
  // ==========================================
  describe('2. Loan Management Safe Deletion & Safeguards', () => {
    let loanWithRepaymentId = '';
    let loanForPresidentCancelId = '';
    let loanForTreasurerCancelId = '';
    let unreferencedLoanId = '';

    before(async () => {
      const db = getDatabase();

      // Loan 1: Will have repayment
      const l1Res = await fetch(`${baseUrl}/api/loans`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: NTM_MEMBER_ID,
          amount: 15000,
          notes: 'Loan with repayment test',
        }),
      });
      const l1Body = await l1Res.json();
      loanWithRepaymentId = l1Body.data.id;

      // Add a cash repayment to Loan 1
      await fetch(`${baseUrl}/api/loans/${loanWithRepaymentId}/repay-cash`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 3000, notes: 'First repayment' }),
      });

      // Loan 2: For President cancellation (no repayments)
      const l2Res = await fetch(`${baseUrl}/api/loans`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: NTM_MEMBER_ID,
          amount: 10000,
          notes: 'Loan for President cancel',
        }),
      });
      const l2Body = await l2Res.json();
      loanForPresidentCancelId = l2Body.data.id;

      // Loan 3: For Treasurer cancellation (no repayments)
      const l3Res = await fetch(`${baseUrl}/api/loans`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: NTM_MEMBER_ID,
          amount: 7000,
          notes: 'Loan for Treasurer cancel',
        }),
      });
      const l3Body = await l3Res.json();
      loanForTreasurerCancelId = l3Body.data.id;

      // Loan 4: Unreferenced loan (no disbursement transaction)
      unreferencedLoanId = 'loan-unreferenced-test-99';
      db.prepare(`
        INSERT INTO loans (id, organization_id, member_id, actor_id, amount, status, interest_rate)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0.0)
      `).run(unreferencedLoanId, NTM_ORG_ID, NTM_MEMBER_ID, 'usr-ntm-president-01', 5000);
    });

    test('2.1 Member CANNOT delete or cancel loan (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/loans/${loanForPresidentCancelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    test('2.2 Unauthenticated request is rejected (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/api/loans/${loanForPresidentCancelId}`, {
        method: 'DELETE',
      });
      assert.strictEqual(res.status, 401);
    });

    test('2.3 Loan with existing repayments CANNOT be deleted or cancelled (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/loans/${loanWithRepaymentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.error, /परतफेड असलेले कर्ज हटवता येत नाही/);

      // Verify Treasurer is also blocked from deleting repaid loan
      const resTreas = await fetch(`${baseUrl}/api/loans/${loanWithRepaymentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(resTreas.status, 400);
    });

    test('2.4 President CAN safely cancel loan with disbursement (marks loan & ledger txn CANCELLED)', async () => {
      const res = await fetch(`${baseUrl}/api/loans/${loanForPresidentCancelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.action, 'CANCELLED');

      // Verify loan status in DB is CANCELLED (not destroyed)
      const db = getDatabase();
      const loanRow = db.prepare('SELECT status, disbursement_transaction_id FROM loans WHERE id = ?').get(loanForPresidentCancelId) as any;
      assert.ok(loanRow);
      assert.strictEqual(loanRow.status, 'CANCELLED');

      // Verify financial_transaction is CANCELLED (ledger integrity preserved)
      const txnRow = db.prepare('SELECT status FROM financial_transactions WHERE id = ?').get(loanRow.disbursement_transaction_id) as any;
      assert.ok(txnRow);
      assert.strictEqual(txnRow.status, 'CANCELLED');

      // Verify audit log
      const audit = db.prepare("SELECT action, details FROM audit_logs WHERE action = 'LOAN_CANCELLED' ORDER BY created_at DESC LIMIT 1").get() as any;
      assert.ok(audit);
      assert.match(audit.details, /CANCELLED/);
    });

    test('2.5 Treasurer CAN safely cancel loan with disbursement', async () => {
      const res = await fetch(`${baseUrl}/api/loans/${loanForTreasurerCancelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${treasurerToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.action, 'CANCELLED');

      const db = getDatabase();
      const loanRow = db.prepare('SELECT status FROM loans WHERE id = ?').get(loanForTreasurerCancelId) as any;
      assert.ok(loanRow);
      assert.strictEqual(loanRow.status, 'CANCELLED');
    });

    test('2.6 Already cancelled loan CANNOT be cancelled again (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/loans/${loanForPresidentCancelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /आधीच रद्द करण्यात आले आहे/);
    });

    test('2.7 Unreferenced loan without disbursement IS permanently deleted (action: DELETED)', async () => {
      const res = await fetch(`${baseUrl}/api/loans/${unreferencedLoanId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.action, 'DELETED');

      // Verify hard-deleted from database
      const db = getDatabase();
      const check = db.prepare('SELECT id FROM loans WHERE id = ?').get(unreferencedLoanId);
      assert.strictEqual(check, undefined);
    });

    test('2.8 Non-existent loan returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/loans/non-existent-loan-id`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${presidentToken}` },
      });
      assert.strictEqual(res.status, 404);
    });
  });
});
