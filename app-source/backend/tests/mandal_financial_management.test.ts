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
let memberId = '';
let jhmPresidentToken = '';
let jhmMemberToken = '';

const NTM_ORG_ID = 'org-ntm-001';
const JHM_ORG_ID = 'org-jhm-002';

let bishiRecord1Id = '';
let bishiRecord2Id = '';

before(async () => {
  seedDatabase();
  const db = getDatabase();

  const { hash, salt } = await import('../src/modules/auth/auth.service.js').then((m) =>
    m.AuthService.hashPin('1234')
  );

  // Setup second mandal: जय हनुमान मंडळ (JHM) for cross-tenant isolation testing
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, code, registration_number)
    VALUES (?, 'जय हनुमान मंडळ', 'JHM02', 'REG-JHM-002')
  `).run(JHM_ORG_ID);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, organization_id, full_name, phone, pin_hash, pin_salt, role, is_active)
    VALUES 
      ('usr-jhm-pres-20', ?, 'JHM President', '9876543220', ?, ?, 'PRESIDENT', 1),
      ('usr-jhm-mem-22', ?, 'JHM Member', '9876543222', ?, ?, 'MEMBER', 1)
  `).run(JHM_ORG_ID, hash, salt, JHM_ORG_ID, hash, salt);

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

  // 1. Log in NTM President
  const presRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
  });
  const presData = (await presRes.json()) as any;
  presidentToken = presData.token;

  // 2. Log in NTM Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  const treasData = (await treasRes.json()) as any;
  treasurerToken = treasData.token;

  // 3. Log in NTM Member
  const memRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  const memData = (await memRes.json()) as any;
  memberToken = memData.token;
  memberId = memData.user.id;

  // 4. Log in JHM President
  const jhmPresRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543220', pin: '1234' }),
  });
  const jhmPresData = (await jhmPresRes.json()) as any;
  jhmPresidentToken = jhmPresData.token;

  // 5. Log in JHM Member
  const jhmMemRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543222', pin: '1234' }),
  });
  const jhmMemData = (await jhmMemRes.json()) as any;
  jhmMemberToken = jhmMemData.token;

  // Configure Bishi for NTM Member
  await fetch(`${baseUrl}/api/members/${memberId}/bishi-config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${presidentToken}`,
    },
    body: JSON.stringify({
      monthlyAmount: 1000,
      dueDay: 10,
    }),
  });

  // Generate Bishi Cycles for 2 months (e.g. 2026-03 and 2026-04)
  await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${presidentToken}`,
    },
    body: JSON.stringify({ monthYear: '2026-03' }),
  });

  await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${presidentToken}`,
    },
    body: JSON.stringify({ monthYear: '2026-04' }),
  });

  // Retrieve generated records
  const recs = db
    .prepare('SELECT id, month_year FROM bishi_records WHERE member_id = ? ORDER BY month_year ASC')
    .all(memberId) as any[];

  bishiRecord1Id = recs[0].id;
  bishiRecord2Id = recs[1].id;
});

after(() => {
  if (server) server.close();
  closeDatabase();
});

describe('Upgraded Mandal Financial Management Tests (वर्गणी / जमा + खर्च + ताळेबंद)', () => {
  let recordedTxn1Id = '';

  test('1. President can view Mandal financial summary via /api/ledger/mandal-summary', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.ok(data.data);
    assert.equal(typeof data.data.currentBalance, 'number');
    assert.equal(typeof data.data.totalInflow, 'number');
    assert.equal(typeof data.data.totalVarganiCollected, 'number');
    assert.equal(typeof data.data.pendingVargani, 'number');
    assert.equal(typeof data.data.totalExpenses, 'number');
    assert.equal(typeof data.data.totalLoansDisbursed, 'number');
    assert.equal(typeof data.data.totalLoanRepayments, 'number');
    assert.equal(typeof data.data.outstandingLoans, 'number');
    assert.equal(typeof data.data.totalTransactions, 'number');
    assert.equal(data.data.pendingVargani, 2000); // 2 months * 1000
  });

  test('2. Treasurer can view Mandal financial summary via /api/expenses/financial-summary', async () => {
    const res = await fetch(`${baseUrl}/api/expenses/financial-summary`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.equal(data.data.pendingVargani, 2000);
  });

  test('3. Member is strictly forbidden from viewing Mandal financial summary (403)', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
    const data = (await res.json()) as any;
    assert.equal(data.success, false);
  });

  test('4. Unauthenticated request to financial summary is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/mandal-summary`);
    assert.equal(res.status, 401);
  });

  test('5. Secondary mandal President accesses only their own isolated financial summary', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.equal(data.data.pendingVargani, 0); // JHM has no bishi cycles
    assert.equal(data.data.currentBalance, 0);
  });

  test('6. President can record authorized Vargani for an existing member Bishi installment', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        memberId,
        bishiRecordId: bishiRecord1Id,
        amount: 1000,
        paymentMethod: 'CASH',
        notes: 'मार्च २०२६ मासिक वर्गणी जमा',
      }),
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.ok(data.data.id);
    recordedTxn1Id = data.data.id;
    assert.equal(data.data.amount, 1000);
    assert.equal(data.data.paymentMethod, 'CASH');
    assert.equal(data.data.status, 'CONFIRMED');
    assert.equal(data.data.transactionType, 'BISHI_PAYMENT');
  });

  test('7. Confirmed Vargani contribution creates immutable record in financial_transactions', async () => {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM financial_transactions WHERE id = ?')
      .get(recordedTxn1Id) as any;
    assert.ok(row);
    assert.equal(row.organization_id, NTM_ORG_ID);
    assert.equal(row.member_id, memberId);
    assert.equal(row.amount, 1000);
    assert.equal(row.status, 'CONFIRMED');
    assert.equal(row.payment_method, 'CASH');
  });

  test('8. Confirmed Vargani contribution updates bishi_records status to PAID', async () => {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM bishi_records WHERE id = ?')
      .get(bishiRecord1Id) as any;
    assert.ok(row);
    assert.equal(row.status, 'PAID');
    assert.equal(row.paid_amount, 1000);
    assert.equal(row.payment_transaction_id, recordedTxn1Id);
  });

  test('9. Confirmed Vargani contribution generates authentic digital receipt (RCP-...)', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${recordedTxn1Id}/receipt`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.ok(data.data.receiptNumber.startsWith('RCP-'));
    assert.equal(data.data.amount, 1000);
    assert.equal(data.data.member.id, memberId);
    assert.equal(data.data.status, 'CONFIRMED');
  });

  test('10. Duplicate Vargani payment for already-paid Bishi record is rejected with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        memberId,
        bishiRecordId: bishiRecord1Id,
        amount: 1000,
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(res.status, 409);
    const data = (await res.json()) as any;
    assert.equal(data.success, false);
  });

  test('11. Treasurer can record authorized Vargani contribution for member', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({
        memberId,
        bishiRecordId: bishiRecord2Id,
        amount: 1000,
        paymentMethod: 'CASH',
        notes: 'एप्रिल २०२६ मासिक वर्गणी जमा (खजिनदार)',
      }),
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.equal(data.data.amount, 1000);
  });

  test('12. Member is strictly forbidden from recording Vargani contributions (403)', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        memberId,
        amount: 1000,
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(res.status, 403);
  });

  test('13. Server-side amount validation rejects negative, zero, or non-integer amounts with 400', async () => {
    // Negative amount
    const resNeg = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: -500,
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(resNeg.status, 400);

    // Zero amount
    const resZero = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 0,
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(resZero.status, 400);

    // Float amount
    const resFloat = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 500.5,
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(resFloat.status, 400);
  });

  test('14. Cross-tenant isolation blocks recording contribution for member of another mandal', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        memberId: 'usr-jhm-mem-22', // Member of JHM
        amount: 500,
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(res.status, 404);
  });

  test('15. General Vargani (without bishiRecordId) creates genuine confirmed transaction in ledger', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 5000,
        paymentMethod: 'CASH',
        contributorName: 'आनंदराव पाटील (हितचिंतक)',
        notes: 'गणेशोत्सव विशेष देणगी वर्गणी',
      }),
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.equal(data.data.amount, 5000);
    assert.equal(data.data.status, 'CONFIRMED');
    assert.ok(data.data.referenceId.startsWith('vargani_'));
  });

  test('16. General Vargani generates valid receipt accessible via receipt endpoint', async () => {
    const db = getDatabase();
    const generalTxn = db
      .prepare("SELECT id FROM financial_transactions WHERE reference_id LIKE 'vargani_%' LIMIT 1")
      .get() as any;

    const res = await fetch(`${baseUrl}/api/transactions/${generalTxn.id}/receipt`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.equal(data.data.amount, 5000);
    assert.ok(data.data.receiptNumber.startsWith('RCP-'));
  });

  test('17. Mandal financial balance (currentBalance) updates dynamically and accurately', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    // Total Vargani: 1000 + 1000 + 5000 = 7000
    // Expenses so far: 0
    // Loans so far: 0
    // Current Balance = 7000
    assert.equal(data.data.totalInflow, 7000);
    assert.equal(data.data.totalVarganiCollected, 7000);
    assert.equal(data.data.currentBalance, 7000);
  });

  test('18. Outstanding Vargani (pendingVargani) reflects 0 after both Bishi records are paid', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.data.pendingVargani, 0);
  });

  test('19. Recording an expense increases totalExpenses and accurately reduces currentBalance', async () => {
    const expRes = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 2000,
        category: 'मंडळ कार्यक्रम',
        reason: 'सांस्कृतिक कार्यक्रम खर्च',
      }),
    });
    assert.equal(expRes.status, 201);

    const summaryRes = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const summary = (await summaryRes.json()) as any;
    assert.equal(summary.data.totalExpenses, 2000);
    assert.equal(summary.data.currentBalance, 5000); // 7000 - 2000 = 5000
  });

  test('20. Deleting an expense rolls back ledger and restores currentBalance', async () => {
    const db = getDatabase();
    const exp = db
      .prepare('SELECT id FROM expenses WHERE reason = ?')
      .get('सांस्कृतिक कार्यक्रम खर्च') as any;

    const delRes = await fetch(`${baseUrl}/api/expenses/${exp.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(delRes.status, 200);

    const summaryRes = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const summary = (await summaryRes.json()) as any;
    assert.equal(summary.data.totalExpenses, 0);
    assert.equal(summary.data.currentBalance, 7000); // restored to 7000
  });

  test('21. Disbursing a loan increases totalLoansDisbursed and reduces currentBalance', async () => {
    const loanRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        memberId,
        amount: 3000,
        notes: 'वैद्यकीय मदतीसाठी तातडीचे कर्ज',
      }),
    });
    assert.equal(loanRes.status, 201);

    const summaryRes = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const summary = (await summaryRes.json()) as any;
    assert.equal(summary.data.totalLoansDisbursed, 3000);
    assert.equal(summary.data.outstandingLoans, 3000);
    assert.equal(summary.data.currentBalance, 4000); // 7000 - 3000 = 4000
  });

  test('22. Loan cash repayment increases totalInflow and totalLoanRepayments while reducing outstandingLoans', async () => {
    const db = getDatabase();
    const loan = db
      .prepare('SELECT id FROM loans WHERE member_id = ?')
      .get(memberId) as any;

    const repayRes = await fetch(`${baseUrl}/api/loans/${loan.id}/repay-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({
        amount: 1000,
        notes: 'पहिला हप्ता रोख परतफेड',
      }),
    });
    assert.equal(repayRes.status, 200);

    const summaryRes = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const summary = (await summaryRes.json()) as any;
    assert.equal(summary.data.totalInflow, 8000); // 7000 + 1000
    assert.equal(summary.data.totalLoanRepayments, 1000);
    assert.equal(summary.data.outstandingLoans, 2000); // 3000 - 1000 = 2000
    assert.equal(summary.data.currentBalance, 5000); // Inflow 8000 - Outflow 3000 = 5000
  });

  test('23. Cancelled/unconfirmed transactions are excluded from available funds', async () => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO financial_transactions (
        id, organization_id, member_id, actor_id, transaction_type,
        reference_id, transaction_number, amount, payment_method,
        transaction_date, status, notes
      ) VALUES (
        'cancelled-txn-001', ?, ?, ?, 'BISHI_PAYMENT',
        'ref-cancelled-001', 'TXN-CANCELLED-01', 50000, 'CASH',
        CURRENT_TIMESTAMP, 'CANCELLED', 'रद्द झालेला व्यवहार'
      )
    `).run(NTM_ORG_ID, memberId, memberId);

    const summaryRes = await fetch(`${baseUrl}/api/ledger/mandal-summary`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const summary = (await summaryRes.json()) as any;
    // Cancelled transaction of 50000 must NOT be counted
    assert.equal(summary.data.totalInflow, 8000);
    assert.equal(summary.data.currentBalance, 5000);
  });

  test('24. Existing व्यवहार /api/ledger reflects confirmed Vargani transactions seamlessly', async () => {
    const res = await fetch(`${baseUrl}/api/ledger?limit=50`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.ok(data.data.transactions.length >= 4);
    assert.equal(data.data.summary.totalFunds, 5000);
  });

  test('25. Existing Digital Passbook /api/passbook/me reflects member payments accurately', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    // Member paid 1000 + 1000 bishi + 1000 loan repayment = 3000
    assert.equal(data.data.totalPaid, 3000);
    assert.ok(data.data.transactions.some((t: any) => t.id === recordedTxn1Id));
  });
});
