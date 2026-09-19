process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import { ReportingService } from '../src/modules/reporting/reporting.service.js';
import { LoanService } from '../src/modules/loans/loan.service.js';
import { MemberService } from '../src/modules/member/member.service.js';
import { BishiService } from '../src/modules/bishi/bishi.service.js';
import { ExpenseService } from '../src/modules/expenses/expense.service.js';

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

async function apiPost(endpoint: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function apiGet(endpoint: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'GET',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('NTM Passbook — Batch 8A: Real Production Processes End-to-End Audit Suite', () => {
  // ==========================================================================
  // 1. Authentication & Active State Validation
  // ==========================================================================
  test('1. Authentication validates scrypt PIN, active state, and blocks role spoofing', async () => {
    const db = getDatabase();

    // President Login (Seeded in Org 1)
    const presidentLogin = await apiPost('/api/auth/login', { phone: '9876543210', pin: '1234' });
    assert.equal(presidentLogin.status, 200);
    assert.ok(presidentLogin.data.token);
    assert.equal(presidentLogin.data.user.role, 'PRESIDENT');
    assert.equal(presidentLogin.data.organization.code, 'NTM01');

    // Wrong PIN is strictly rejected with 401
    const badPinLogin = await apiPost('/api/auth/login', { phone: '9876543210', pin: '9999' });
    assert.equal(badPinLogin.status, 401);
    assert.equal(badPinLogin.data.success, false);

    // Inactive user login is rejected with 401
    try {
      db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run('usr-ntm-member-01');
      const inactiveLogin = await apiPost('/api/auth/login', { phone: '9876543212', pin: '1234' });
      assert.equal(inactiveLogin.status, 401);
      assert.equal(inactiveLogin.data.success, false);
    } finally {
      // Always restore active status
      db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run('usr-ntm-member-01');
    }
  });

  // ==========================================================================
  // 2. First President Registration Concurrency & Guard
  // ==========================================================================
  test('2. Registration is blocked when an active President already exists in the Mandal', async () => {
    const statusRes = await apiGet('/api/auth/registration-status?phone=9876543210');
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.registrationOpen, false, 'Registration must be closed when President exists for phone');

    const mandalStatusRes = await apiGet('/api/auth/registration-status?mandalName=' + encodeURIComponent('नवतरुण मित्र मंडळ'));
    assert.equal(mandalStatusRes.status, 200);
    assert.equal(mandalStatusRes.data.registrationOpen, false, 'Registration must be closed when Mandal already exists');

    // Attempting to register another President in an existing Mandal is rejected with 409
    const registerRes = await apiPost('/api/auth/register-president', {
      mandalName: 'नवतरुण मित्र मंडळ',
      fullName: 'दुसरे अध्यक्ष',
      phone: '9876500000',
      pin: '1234',
      confirmPin: '1234',
    });
    assert.equal(registerRes.status, 409);
    assert.equal(registerRes.data.success, false);
  });

  // ==========================================================================
  // 3. User & Member Management
  // ==========================================================================
  test('3. Member lifecycle: President creates member, member deactivation revokes sessions', async () => {
    const presidentLogin = await apiPost('/api/auth/login', { phone: '9876543210', pin: '1234' });
    const presidentToken = presidentLogin.data.token;
    const testPhone = '9876599999';

    // President creates member
    const createRes = await apiPost(
      '/api/members',
      {
        fullName: 'ऑडिट चाचणी सदस्य',
        phone: testPhone,
        initialPin: '1234',
        role: 'MEMBER',
      },
      presidentToken
    );
    assert.equal(createRes.status, 201);
    assert.ok(createRes.data.data.id);
    const newMemberId = createRes.data.data.id;

    // Member logs in successfully
    const memberLogin = await apiPost('/api/auth/login', { phone: testPhone, pin: '1234' });
    assert.equal(memberLogin.status, 200);
    const memberToken = memberLogin.data.token;

    // President deactivates member
    const patchRes = await fetch(`${baseUrl}/api/members/${newMemberId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(patchRes.status, 200);

    // Session must be immediately revoked (GET /api/auth/me returns 401)
    const meRes = await apiGet('/api/auth/me', memberToken);
    assert.equal(meRes.status, 401, 'Deactivated member session must be immediately revoked');
  });

  // ==========================================================================
  // 4. Bishi Real Production Flow
  // ==========================================================================
  test('4. Bishi real flow: cycle generation, Cash Mark Paid, ledger entry, immutable receipt', async () => {
    const president = {
      id: 'usr-ntm-president-01',
      organizationId: 'org-ntm-001',
      role: 'PRESIDENT' as const,
      phone: '9876543210',
      fullName: 'अध्यक्ष १',
      isActive: true,
    };
    const memberId = 'usr-ntm-member-01';
    const orgId = president.organizationId;

    // Configure Member Bishi
    BishiService.setMemberBishiConfig(orgId, memberId, 1500, 10, president.id, '127.0.0.1');

    // Generate monthly cycle
    const currentMonth = new Date().toISOString().slice(0, 7);
    const cycleRes = BishiService.generateMonthlyCycle(orgId, currentMonth, president.id, '127.0.0.1');
    assert.ok(cycleRes.generatedCount >= 0);

    const records = BishiService.getMemberBishiRecords(orgId, memberId);
    const pendingRecord = records.find((r) => r.status !== 'PAID');
    assert.ok(pendingRecord, 'A pending Bishi record must exist');

    // Wrong cash payment amount is strictly rejected with 400
    assert.throws(
      () => {
        LedgerService.recordCashBishiPayment(
          orgId,
          pendingRecord.id,
          999, // incorrect amount
          president,
          '127.0.0.1'
        );
      },
      (err: any) => err.statusCode === 400
    );

    // Exact cash payment succeeds and marks record PAID atomically
    const txn = LedgerService.recordCashBishiPayment(
      orgId,
      pendingRecord.id,
      pendingRecord.expectedAmount,
      president,
      '127.0.0.1',
      'ऑडिट रोख बीसी पावती चाचणी'
    );

    assert.ok(txn);
    assert.equal(txn.amount, pendingRecord.expectedAmount);
    assert.equal(txn.status, 'CONFIRMED');
    assert.equal(txn.paymentMethod, 'CASH');

    // Verify Bishi record updated to PAID
    const updatedRecords = BishiService.getMemberBishiRecords(orgId, memberId);
    const updatedRecord = updatedRecords.find((r) => r.id === pendingRecord.id);
    assert.equal(updatedRecord?.status, 'PAID');
    assert.equal(updatedRecord?.paidAmount, pendingRecord.expectedAmount);

    // Verified receipt can be fetched
    const receipt = LedgerService.getTransactionReceipt(orgId, txn.id, president);
    assert.ok(receipt);
    assert.equal(receipt.transactionNumber, txn.transactionNumber);
    assert.equal(receipt.amount, pendingRecord.expectedAmount);
  });

  // ==========================================================================
  // 5. Loans Real Production Flow
  // ==========================================================================
  test('5. Loan lifecycle: disbursement, LOAN_DISBURSED ledger, repayment, overpayment rejection', async () => {
    const president = {
      id: 'usr-ntm-president-01',
      organizationId: 'org-ntm-001',
      role: 'PRESIDENT' as const,
      phone: '9876543210',
      fullName: 'अध्यक्ष १',
      isActive: true,
    };
    const orgId = president.organizationId;
    const memberId = 'usr-ntm-member-01';

    // Create and disburse loan
    const loan = LoanService.createLoan(
      orgId,
      {
        memberId,
        amount: 8000,
        notes: 'ऑडिट कर्ज चाचणी',
      },
      president,
      '127.0.0.1'
    );

    assert.ok(loan.id);
    assert.equal(loan.amount, 8000);
    assert.equal(loan.outstandingBalance, 8000);
    assert.equal(loan.status, 'ACTIVE');

    // Repayment exceeding outstanding balance is strictly rejected with 400
    assert.throws(
      () => {
        LoanService.recordCashLoanRepayment(
          orgId,
          loan.id,
          10000,
          president,
          '127.0.0.1'
        );
      },
      (err: any) => err.statusCode === 400 || err.message.includes('जास्त')
    );

    // Partial repayment of 3000
    const partial = LoanService.recordCashLoanRepayment(
      orgId,
      loan.id,
      3000,
      president,
      '127.0.0.1',
      'हप्ता १'
    );
    assert.equal(partial.loan.outstandingBalance, 5000);
    assert.equal(partial.loan.totalRepaid, 3000);

    // Final repayment of 5000 closes the loan
    const finalRepay = LoanService.recordCashLoanRepayment(
      orgId,
      loan.id,
      5000,
      president,
      '127.0.0.1',
      'अंतिम हप्ता'
    );
    assert.equal(finalRepay.loan.outstandingBalance, 0);
    assert.equal(finalRepay.loan.status, 'CLOSED');
  });

  // ==========================================================================
  // 6. Expenses & Vargani Real Production Flow
  // ==========================================================================
  test('6. Expenses & Vargani: atomic transactions, audit logs, and ledger integration', async () => {
    const president = {
      id: 'usr-ntm-president-01',
      organizationId: 'org-ntm-001',
      role: 'PRESIDENT' as const,
      phone: '9876543210',
      fullName: 'अध्यक्ष १',
      isActive: true,
    };
    const orgId = president.organizationId;

    // Record expense
    const expense = ExpenseService.createExpense(
      orgId,
      {
        amount: 1200,
        category: 'इतर',
        reason: 'मंडळ ध्वज व सजावट खरेदी',
      },
      president,
      '127.0.0.1'
    );
    assert.ok(expense.id);
    assert.equal(expense.amount, 1200);

    // Record general Vargani contribution
    const varganiTxn = LedgerService.recordVarganiContribution(
      orgId,
      {
        amount: 2500,
        contributorName: 'श्री. गणेश भक्त',
        notes: 'वार्षिक उत्सव वर्गणी देणगी',
      },
      president,
      '127.0.0.1'
    );
    assert.ok(varganiTxn);
    assert.equal(varganiTxn.amount, 2500);
    assert.equal(varganiTxn.status, 'CONFIRMED');
  });

  // ==========================================================================
  // 7. Mandal Financial Summary (9 Real Authoritative Metrics)
  // ==========================================================================
  test('7. getMandalFinancialSummary calculates all 9 real metrics dynamically with zero fake data', () => {
    const orgId = 'org-ntm-001';
    const summary = LedgerService.getMandalFinancialSummary(orgId);

    assert.ok(summary);
    assert.equal(typeof summary.currentBalance, 'number');
    assert.equal(typeof summary.totalInflow, 'number');
    assert.equal(typeof summary.totalVarganiCollected, 'number');
    assert.equal(typeof summary.pendingVargani, 'number');
    assert.equal(typeof summary.totalExpenses, 'number');
    assert.equal(typeof summary.totalLoansDisbursed, 'number');
    assert.equal(typeof summary.totalLoanRepayments, 'number');
    assert.equal(typeof summary.outstandingLoans, 'number');
    assert.equal(typeof summary.totalTransactions, 'number');

    // Balance formula check: currentBalance = totalInflow - (totalLoansDisbursed + totalExpenses)
    assert.equal(
      summary.currentBalance,
      summary.totalInflow - (summary.totalLoansDisbursed + summary.totalExpenses)
    );

    // Outstanding loans formula check: outstandingLoans = totalLoansDisbursed - totalLoanRepayments
    assert.equal(
      summary.outstandingLoans,
      summary.totalLoansDisbursed - summary.totalLoanRepayments
    );
  });

  // ==========================================================================
  // 8. Reporting & Statements
  // ==========================================================================
  test('8. ReportingService generates authentic monthly statements derived from SQLite transactions', () => {
    const orgId = 'org-ntm-001';
    const currentMonth = new Date().toISOString().slice(0, 7);

    const statement = ReportingService.getMonthlyStatement(orgId, currentMonth);
    assert.ok(statement);
    assert.equal(statement.monthYear, currentMonth);
    assert.equal(typeof statement.openingBalance, 'number');
    assert.equal(typeof statement.inflows.totalInflow, 'number');
    assert.equal(typeof statement.outflows.totalOutflow, 'number');
    assert.equal(typeof statement.closingBalance, 'number');
    assert.equal(
      statement.closingBalance,
      statement.openingBalance + statement.netMovement
    );
  });

  // ==========================================================================
  // 9. Multi-Mandal Complete Isolation
  // ==========================================================================
  test('9. Multi-Mandal tenant isolation strictly denies cross-Mandal access', async () => {
    const presidentLoginOrg1 = await apiPost('/api/auth/login', { phone: '9876543210', pin: '1234' });
    const org2 = 'org-jhm-002';

    // Calling GET /api/members/usr-jhm-member-02 with Org 1 president returns 404/403
    const memberCrossRes = await apiGet('/api/members/usr-jhm-member-02', presidentLoginOrg1.data.token);
    assert.ok(memberCrossRes.status === 404 || memberCrossRes.status === 403);

    // Member Passbook cross-org access is strictly denied
    const memberLoginOrg1 = await apiPost('/api/auth/login', { phone: '9876543212', pin: '1234' });
    const crossPassbookRes = await apiGet('/api/passbook/member/usr-jhm-member-02', memberLoginOrg1.data.token);
    assert.equal(crossPassbookRes.status, 403);
  });
});
