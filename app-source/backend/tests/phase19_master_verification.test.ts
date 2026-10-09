import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { LoanCalculator } from '../src/modules/loans/loan-calculator.js';

describe('Phase 19: Comprehensive Professional Reports, EMI Loan System & Online Repayment Master Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  // Tokens
  let presidentToken: string;
  let treasurerToken: string;
  let memberToken: string;

  // IDs
  let orgId: string;
  let presidentId: string;
  let treasurerId: string;
  let memberId: string;

  let testLoanId: string;
  let testTxnId: string;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-phase19-session-secret-key-32-chars!!';
    runMigrations();
    const db = getDatabase();

    // Reset tables for isolated testing
    db.exec(`
      DELETE FROM audit_logs;
      DELETE FROM notifications;
      DELETE FROM financial_transactions;
      DELETE FROM loan_installments;
      DELETE FROM loan_repayments;
      DELETE FROM loans;
      DELETE FROM payment_orders;
      DELETE FROM bishi_records;
      DELETE FROM bishi_configs;
      DELETE FROM expenses;
      DELETE FROM sessions;
      DELETE FROM users;
      DELETE FROM organizations;
    `);

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // 1. Register President
    const presRegRes = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'आदर्श नवतरुण मित्र मंडळ',
        fullName: 'गणेश अध्यक्ष पाटील',
        phone: '9800000001',
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    const presRegData = await presRegRes.json();
    assert.strictEqual(presRegRes.status, 201);
    presidentToken = presRegData.token;
    presidentId = presRegData.user.id;
    orgId = presRegData.user.organizationId;

    // Configure UPI & QR for organization
    const cfgRes = await fetch(`${baseUrl}/api/payments/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        upiId: 'aadarsh@sbi',
        accountName: 'आदर्श मंडळ',
        isActive: true,
      }),
    });
    assert.strictEqual(cfgRes.status, 200);

    // 2. Add Treasurer
    const treasRes = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        fullName: 'सुरेश खजिनदार सावंत',
        phone: '9800000002',
        role: 'TREASURER',
        initialPin: '1234',
      }),
    });
    const treasData = await treasRes.json();
    assert.strictEqual(treasRes.status, 201);
    treasurerId = treasData.data.id;

    // Login Treasurer
    const treasLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9800000002',
        pin: '1234',
      }),
    });
    const treasLoginData = await treasLoginRes.json();
    assert.strictEqual(treasLoginRes.status, 200);
    treasurerToken = treasLoginData.token;

    // 3. Add Member
    const memRes = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        fullName: 'रमेश सभासद कदम',
        phone: '9800000003',
        role: 'MEMBER',
        initialPin: '1234',
      }),
    });
    const memData = await memRes.json();
    assert.strictEqual(memRes.status, 201);
    memberId = memData.data.id;

    // Login Member
    const memLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9800000003',
        pin: '1234',
      }),
    });
    const memLoginData = await memLoginRes.json();
    assert.strictEqual(memLoginRes.status, 200);
    memberToken = memLoginData.token;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDatabase();
  });

  // =========================================================================
  // 1. Pure Loan Math & Calculator Verification
  // =========================================================================
  test('1.1 LoanCalculator: Flat interest calculation (Annual rate)', () => {
    const res = LoanCalculator.calculateSchedule({
      principal: 12000,
      interestRate: 12, // 12% p.a.
      interestType: 'FLAT',
      ratePeriod: 'ANNUAL',
      tenureMonths: 12,
      firstDueDate: '2026-11-01',
    });

    assert.strictEqual(res.totalInterest, 1440); // 12000 * 0.12 * 1
    assert.strictEqual(res.totalPayable, 13440);
    assert.strictEqual(res.installments.length, 12);
    assert.strictEqual(res.monthlyInstallment, 1120);

    const sumTotal = res.installments.reduce((s, i) => s + i.totalAmount, 0);
    assert.strictEqual(sumTotal, 13440);
  });

  test('1.2 LoanCalculator: Reducing-Balance EMI formula with balancing final installment', () => {
    const res = LoanCalculator.calculateSchedule({
      principal: 50000,
      interestRate: 12, // 12% p.a. = 1% p.m.
      interestType: 'REDUCING_BALANCE',
      ratePeriod: 'ANNUAL',
      tenureMonths: 6,
      firstDueDate: '2026-11-01',
    });

    assert.strictEqual(res.tenureMonths, 6);
    assert.ok(res.monthlyInstallment > 8000);
    assert.strictEqual(res.installments.length, 6);

    // Sum of principal components across all installments must exactly equal principal
    const sumPrincipal = res.installments.reduce((s, i) => s + i.principalAmount, 0);
    assert.strictEqual(sumPrincipal, 50000);

    const sumTotal = res.installments.reduce((s, i) => s + i.totalAmount, 0);
    assert.strictEqual(sumTotal, res.totalPayable);
    assert.strictEqual(res.installments[5].remainingPrincipal, 0);
  });

  test('1.3 API: POST /api/loans/calculate-preview returns real-time schedule preview', async () => {
    const res = await fetch(`${baseUrl}/api/loans/calculate-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        principal: 24000,
        interestRate: 10,
        interestType: 'FLAT',
        ratePeriod: 'ANNUAL',
        tenureMonths: 12,
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.totalInterest, 2400);
    assert.strictEqual(body.data.totalPayable, 26400);
    assert.strictEqual(body.data.installments.length, 12);
  });

  // =========================================================================
  // 2. Loan Creation, Installments Schedule & Self-Disbursement Safeguards
  // =========================================================================
  test('2.1 President cannot disburse loan to self (Self-loan safeguard: 403)', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        memberId: presidentId,
        amount: 20000,
        interestRate: 12,
        interestType: 'FLAT',
        ratePeriod: 'ANNUAL',
        tenureMonths: 6,
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  test('2.2 President creates loan for Member with installment schedule generation', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        memberId,
        amount: 10000,
        interestRate: 12,
        interestType: 'FLAT',
        ratePeriod: 'ANNUAL',
        tenureMonths: 5,
        firstDueDate: '2026-11-01',
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    testLoanId = body.data.id;
    testTxnId = body.data.disbursementTransactionId;

    assert.strictEqual(body.data.totalInterest, 500); // 10000 * 0.12 * (5/12) = 500
    assert.strictEqual(body.data.totalPayable, 10500);
    assert.strictEqual(body.data.outstandingBalance, 10500);

    // Verify installments schedule in database
    const db = getDatabase();
    const instRows = db
      .prepare('SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY installment_number ASC')
      .all(testLoanId) as any[];

    assert.strictEqual(instRows.length, 5);
    assert.strictEqual(instRows[0].total_amount, 2100);
    assert.strictEqual(instRows[0].paid_amount, 0);
  });

  test('2.3 Member and Officer can view installment schedule via GET /api/loans/:id/installments', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoanId}/installments`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.length, 5);
    assert.strictEqual(body.data[0].installmentNumber, 1);
  });

  // =========================================================================
  // 3. Repayment Tracking, Overpayment Protection & Self-Recording Safeguard
  // =========================================================================
  test('3.1 Officer cannot record cash repayment on own loan (Cross-officer safeguard: 403)', async () => {
    // Treasurer creates a loan for President
    const loanForPresRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({
        memberId: presidentId,
        amount: 5000,
        tenureMonths: 1,
      }),
    });
    const presLoan = await loanForPresRes.json();
    assert.strictEqual(loanForPresRes.status, 201);

    // President tries to self-record cash repayment -> 403 Forbidden!
    const selfRepayRes = await fetch(`${baseUrl}/api/loans/${presLoan.data.id}/repay-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ amount: 5000 }),
    });
    assert.strictEqual(selfRepayRes.status, 403);

    // Cross-officer: Treasurer can record repayment for President
    const validRepayRes = await fetch(`${baseUrl}/api/loans/${presLoan.data.id}/repay-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({ amount: 5000 }),
    });
    assert.strictEqual(validRepayRes.status, 200);
  });

  test('3.2 Partial cash repayment updates installment status and reduces outstanding balance', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoanId}/repay-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({ amount: 2100 }), // Exact 1st installment
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.loan.outstandingBalance, 8400); // 10500 - 2100 = 8400

    // Check installment 1 is PAID
    const db = getDatabase();
    const inst1 = db.prepare('SELECT * FROM loan_installments WHERE loan_id = ? AND installment_number = 1').get(testLoanId) as any;
    assert.strictEqual(inst1.status, 'PAID');
    assert.strictEqual(inst1.paid_amount, 2100);
  });

  test('3.3 Overpayment beyond outstanding balance is strictly rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoanId}/repay-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({ amount: 9000 }), // Remaining is 8400
    });
    assert.strictEqual(res.status, 400);
  });

  // =========================================================================
  // 4. Online Loan Repayment Order & Cross-Officer Approval Workflow
  // =========================================================================
  test('4.1 Member initiates online loan repayment notice [मी पेमेंट केले]', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoanId}/pay-online`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ amount: 2100 }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.order.status, 'ONLINE_PENDING');
    assert.strictEqual(body.data.order.paymentType, 'LOAN_REPAYMENT');
  });

  test('4.2 Pending online loan repayment is listed for Officers', async () => {
    const res = await fetch(`${baseUrl}/api/payments/orders/pending`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    const loanOrder = body.data.find((o: any) => o.loanId === testLoanId);
    assert.ok(loanOrder);
    assert.strictEqual(loanOrder.status, 'ONLINE_PENDING');
  });

  test('4.3 Officer approves online loan repayment atomically', async () => {
    const db = getDatabase();
    const order = db.prepare("SELECT * FROM payment_orders WHERE loan_id = ? AND status = 'ONLINE_PENDING'").get(testLoanId) as any;
    assert.ok(order);

    const approveRes = await fetch(`${baseUrl}/api/payments/orders/${order.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const approveData = await approveRes.json();
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(approveData.success, true);
    assert.strictEqual(approveData.data.paymentMethod, 'ONLINE');

    // Verify ledger transaction created
    const txn = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(approveData.data.transactionId) as any;
    assert.strictEqual(txn.transaction_type, 'LOAN_REPAYMENT');
    assert.strictEqual(txn.payment_method, 'ONLINE');

    // Verify installment 2 is PAID
    const inst2 = db.prepare('SELECT * FROM loan_installments WHERE loan_id = ? AND installment_number = 2').get(testLoanId) as any;
    assert.strictEqual(inst2.status, 'PAID');
    assert.strictEqual(inst2.paid_amount, 2100);
  });

  // =========================================================================
  // 5. Professional Report Exports (PDF, Excel, CSV) & PDF Receipt
  // =========================================================================
  test('5.1 PDF Monthly Statement Export generates valid print-ready A4 PDF', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement/export?format=pdf&monthYear=${currentMonth}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');

    const buffer = Buffer.from(await res.arrayBuffer());
    assert.ok(buffer.length > 5000, 'PDF buffer must be non-empty and well-formed');
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF', 'File must start with %PDF header');
  });

  test('5.2 Excel Monthly Statement Export generates valid .xlsx workbook', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement/export?format=excel&monthYear=${currentMonth}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    assert.ok(buffer.length > 1000, 'Excel buffer must be non-empty');
    assert.strictEqual(buffer.slice(0, 2).toString(), 'PK', 'XLSX must be a zip file (PK header)');
  });

  test('5.3 CSV Monthly Statement Export has UTF-8 BOM and RFC 4180 escaping', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement/export?format=csv&monthYear=${currentMonth}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/csv; charset=utf-8');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf[0], 0xEF, 'Byte 0 must be 0xEF (UTF-8 BOM)');
    assert.strictEqual(buf[1], 0xBB, 'Byte 1 must be 0xBB (UTF-8 BOM)');
    assert.strictEqual(buf[2], 0xBF, 'Byte 2 must be 0xBF (UTF-8 BOM)');

    const text = buf.toString('utf8');
    assert.ok(text.includes('व्यवहार क्र.'));
  });

  test('5.4 Loans Register Export supports PDF, Excel, and CSV', async () => {
    // PDF
    const pdfRes = await fetch(`${baseUrl}/api/reports/loans/export?format=pdf`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(pdfRes.status, 200);
    assert.strictEqual(pdfRes.headers.get('content-type'), 'application/pdf');

    // Excel
    const xlsxRes = await fetch(`${baseUrl}/api/reports/loans/export?format=excel`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(xlsxRes.status, 200);

    // CSV
    const csvRes = await fetch(`${baseUrl}/api/reports/loans/export?format=csv`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(csvRes.status, 200);
  });

  test('5.5 Transaction Receipt: Downloadable ONLY as PDF (Strictly NO Excel or CSV)', async () => {
    // 1. PDF download works
    const pdfRes = await fetch(`${baseUrl}/api/transactions/${testTxnId}/receipt/pdf`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(pdfRes.status, 200);
    assert.strictEqual(pdfRes.headers.get('content-type'), 'application/pdf');
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    assert.strictEqual(pdfBuf.slice(0, 4).toString(), '%PDF');

    // 2. Reject Excel/CSV request for receipt with 400 Bad Request
    const excelRes = await fetch(`${baseUrl}/api/transactions/${testTxnId}/receipt/pdf?format=excel`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(excelRes.status, 400);

    const csvRes = await fetch(`${baseUrl}/api/transactions/${testTxnId}/receipt/pdf?format=csv`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(csvRes.status, 400);
  });

  // =========================================================================
  // 6. Production Database Safety Gate Verification
  // =========================================================================
  test('6.1 Production database ntm_prod.sqlite strictly preserved with zero rows', () => {
    const prodDbPath = path.resolve(process.cwd(), fs.existsSync('./data/ntm_prod.sqlite') ? './data/ntm_prod.sqlite' : './backend/data/ntm_prod.sqlite');
    const prodDb = new DatabaseSync(prodDbPath);
    const tables = prodDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];

    assert.strictEqual(tables.length, 14, 'Production database must contain 14 tables');
    for (const t of tables) {
      const row = prodDb.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any;
      assert.strictEqual(row.c, 0, `Table ${t.name} in ntm_prod.sqlite must have 0 rows`);
    }
  });
});
