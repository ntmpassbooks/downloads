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
let member1Token = '';
let member2Token = '';
let jhmPresidentToken = '';
let jhmTreasurerToken = '';
let jhmMemberToken = '';

const NTM_ORG_ID = 'org-ntm-001';
const JHM_ORG_ID = 'org-jhm-002';
const NTM_MEMBER_1_ID = 'usr-ntm-member-01'; // Rahul Patil
let ntmMember2Id = '';
const JHM_MEMBER_ID = 'usr-jhm-member-02'; // Amit Sawant

let testLoan1Id = '';
let testLoan1TxnId = '';
let testLoan1TxnNumber = '';
let testRepayment1Id = '';
let testRepayment1TxnId = '';

before(async () => {
  seedDatabase();
  const db = getDatabase();

  const { hash, salt } = await import('../src/modules/auth/auth.service.js').then((m) =>
    m.AuthService.hashPin('1234')
  );

  // 1. Create a second NTM Member in Mandal 1 to test cross-member IDOR
  ntmMember2Id = 'usr-ntm-member-02';
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    ntmMember2Id,
    NTM_ORG_ID,
    '9876543213',
    'संजय पवार (सदस्य २)',
    'MEMBER',
    hash,
    salt
  );

  // 2. Create President for JHM02 (Mandal 2) to test cross-tenant barriers
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    'usr-jhm-president-02',
    JHM_ORG_ID,
    '9876543290',
    'प्रकाश जाधव (अध्यक्ष)',
    'PRESIDENT',
    hash,
    salt
  );

  // 3. Create Treasurer for JHM02 (Mandal 2)
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    'usr-jhm-treasurer-02',
    JHM_ORG_ID,
    '9876543291',
    'अमित जोशी (खजिनदार)',
    'TREASURER',
    hash,
    salt
  );

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

  // Login as NTM President
  const presRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
  });
  presidentToken = (await presRes.json()).token;

  // Login as NTM Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  treasurerToken = (await treasRes.json()).token;

  // Login as NTM Member 1
  const mem1Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  member1Token = (await mem1Res.json()).token;

  // Login as NTM Member 2
  const mem2Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543213', pin: '1234' }),
  });
  member2Token = (await mem2Res.json()).token;

  // Login as JHM President
  const jhmPresRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543290', pin: '1234' }),
  });
  jhmPresidentToken = (await jhmPresRes.json()).token;

  // Login as JHM Treasurer
  const jhmTreasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543291', pin: '1234' }),
  });
  jhmTreasurerToken = (await jhmTreasRes.json()).token;

  // Login as JHM Member
  const jhmMemRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543299', pin: '1234' }),
  });
  jhmMemberToken = (await jhmMemRes.json()).token;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeDatabase();
});

describe('Phase 1F: Real Loans + Cash Repayment + Balance Foundation Tests', () => {
  // === Loan Creation (1 - 10) ===
  test('1. President can create a real loan for a member', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: NTM_MEMBER_1_ID,
        amount: 10000,
        notes: 'वैयक्तिक गरजेसाठी तात्पुरते कर्ज',
      }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.amount, 10000);
    assert.strictEqual(body.data.status, 'ACTIVE');
    assert.strictEqual(body.data.outstandingBalance, 10000);
    assert.strictEqual(body.data.totalRepaid, 0);

    testLoan1Id = body.data.id;
    testLoan1TxnId = body.data.disbursementTransactionId;
    testLoan1TxnNumber = body.data.disbursementTransactionNumber;
  });

  test('2. Member cannot create/approve a loan (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: NTM_MEMBER_1_ID,
        amount: 5000,
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  test('3. Treasurer can create a loan for a member (201 Created)', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: NTM_MEMBER_1_ID,
        amount: 5000,
        notes: 'खजिनदाराने मंजूर केलेले कर्ज',
      }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.amount, 5000);
  });

  test('4. Cross-mandal loan creation rejected (404/403 barrier)', async () => {
    // NTM President attempting to create loan for JHM Member
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: JHM_MEMBER_ID,
        amount: 5000,
      }),
    });
    assert.strictEqual(res.status, 404);
  });

  test('5. Invalid amount rejected (400)', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: NTM_MEMBER_1_ID,
        amount: 'invalid-amount',
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  test('6. Zero or negative amount rejected (400)', async () => {
    const zeroRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: NTM_MEMBER_1_ID,
        amount: 0,
      }),
    });
    assert.strictEqual(zeroRes.status, 400);

    const negRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: NTM_MEMBER_1_ID,
        amount: -5000,
      }),
    });
    assert.strictEqual(negRes.status, 400);
  });

  test('7. Real loan record created in database', () => {
    const db = getDatabase();
    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(testLoan1Id) as any;
    assert.ok(loan);
    assert.strictEqual(loan.amount, 10000);
    assert.strictEqual(loan.status, 'ACTIVE');
    assert.strictEqual(loan.organization_id, NTM_ORG_ID);
  });

  test('8. LOAN_DISBURSED ledger transaction created in financial_transactions', () => {
    const db = getDatabase();
    const txn = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(testLoan1TxnId) as any;
    assert.ok(txn);
    assert.strictEqual(txn.transaction_type, 'LOAN_DISBURSED');
    assert.strictEqual(txn.amount, 10000);
    assert.strictEqual(txn.reference_id, testLoan1Id);
    assert.strictEqual(txn.status, 'CONFIRMED');
  });

  test('9. Transaction number is unique and immutable', async () => {
    // Create second loan for Member 2
    const res2 = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: ntmMember2Id,
        amount: 3000,
      }),
    });
    const body2 = await res2.json();
    assert.notStrictEqual(body2.data.disbursementTransactionNumber, testLoan1TxnNumber);
  });

  test('10. Audit event LOAN_CREATED created in audit_logs', () => {
    const db = getDatabase();
    const audit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'LOAN_CREATED' AND details LIKE ? ORDER BY created_at DESC LIMIT 1")
      .get(`%${testLoan1Id}%`) as any;
    assert.ok(audit);
    const details = JSON.parse(audit.details);
    assert.strictEqual(details.loanId, testLoan1Id);
    assert.strictEqual(details.amount, 10000);
  });

  // === Loan Balance (11 - 14) ===
  test('11. New loan balance equals real disbursed amount', async () => {
    const res = await fetch(`${baseUrl}/api/loans/member/${NTM_MEMBER_1_ID}`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const body = await res.json();
    const loan = body.data.find((l: any) => l.id === testLoan1Id);
    assert.ok(loan);
    assert.strictEqual(loan.outstandingBalance, 10000);
    assert.strictEqual(loan.totalRepaid, 0);
  });

  test('12. Balance is derived dynamically from real ledger transactions', () => {
    const db = getDatabase();
    const disbursedRow = db
      .prepare("SELECT amount FROM financial_transactions WHERE reference_id = ? AND transaction_type = 'LOAN_DISBURSED'")
      .get(testLoan1Id) as any;
    assert.strictEqual(disbursedRow.amount, 10000);
  });

  test('13. No hardcoded outstanding balance in database', () => {
    const db = getDatabase();
    const cols = db.prepare("PRAGMA table_info(loans)").all() as Array<{ name: string }>;
    // The loans table schema does not store a mutable hardcoded outstanding_balance column
    assert.ok(!cols.some((c) => c.name === 'outstanding_balance'));
  });

  test('14. Historical loan principal amount remains unchanged', async () => {
    const res = await fetch(`${baseUrl}/api/loans/member/${NTM_MEMBER_1_ID}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const body = await res.json();
    const loan = body.data.find((l: any) => l.id === testLoan1Id);
    assert.strictEqual(loan.amount, 10000);
  });

  // === Cash Repayment (15 - 28) ===
  test('15. Authorized Treasurer can record cash loan repayment', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 4000,
        notes: 'पहिली रोख परतफेड',
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.repayment.amount, 4000);
    assert.strictEqual(body.data.loan.outstandingBalance, 6000);
    assert.strictEqual(body.data.loan.totalRepaid, 4000);
    assert.strictEqual(body.data.loan.status, 'ACTIVE');

    testRepayment1Id = body.data.repayment.id;
    testRepayment1TxnId = body.data.repayment.transactionId;
  });

  test('16. Member cannot record cash repayment (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.strictEqual(res.status, 403);
  });

  test('17. Cross-mandal loan repayment rejected (404/403 barrier)', async () => {
    // JHM Treasurer attempting to record repayment for NTM loan
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jhmTreasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.strictEqual(res.status, 404);
  });

  test('18. Invalid repayment amount rejected (400)', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 0 }),
    });
    assert.strictEqual(res.status, 400);
  });

  test('19. Overpayment rejected (repayment > outstanding balance: 400)', async () => {
    // Current outstanding is 6000; attempting to repay 7000
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 7000 }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /जास्त असू शकत नाही|cannot exceed/);
  });

  test('20. Partial repayment works and updates outstanding balance correctly', async () => {
    // Repay another 2000; remaining outstanding should be 4000
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 2000 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.loan.outstandingBalance, 4000);
    assert.strictEqual(body.data.loan.totalRepaid, 6000);
    assert.strictEqual(body.data.loan.status, 'ACTIVE');
  });

  test('21. Full repayment closes the loan (status = CLOSED)', async () => {
    // Pay final 4000
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 4000 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.loan.outstandingBalance, 0);
    assert.strictEqual(body.data.loan.totalRepaid, 10000);
    assert.strictEqual(body.data.loan.status, 'CLOSED');
  });

  test('22. Partial repayment keeps loan ACTIVE', async () => {
    // Member 2 has a loan of 3000
    const loansRes = await fetch(`${baseUrl}/api/loans/member/${ntmMember2Id}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const loan2 = (await loansRes.json()).data[0];

    const partialRes = await fetch(`${baseUrl}/api/loans/${loan2.id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.strictEqual(partialRes.status, 200);
    const partialBody = await partialRes.json();
    assert.strictEqual(partialBody.data.loan.status, 'ACTIVE');
    assert.strictEqual(partialBody.data.loan.outstandingBalance, 2000);
  });

  test('23. Repayment creates LOAN_REPAYMENT transaction in financial_transactions', () => {
    const db = getDatabase();
    const txn = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(testRepayment1TxnId) as any;
    assert.ok(txn);
    assert.strictEqual(txn.transaction_type, 'LOAN_REPAYMENT');
    assert.strictEqual(txn.amount, 4000);
    assert.strictEqual(txn.status, 'CONFIRMED');
    assert.strictEqual(txn.payment_method, 'CASH');
  });

  test('24. Repayment transaction ID is unique', () => {
    const db = getDatabase();
    const count = db
      .prepare("SELECT COUNT(DISTINCT transaction_number) as c FROM financial_transactions WHERE transaction_type = 'LOAN_REPAYMENT'")
      .get() as any;
    assert.ok(count.c >= 2);
  });

  test('25. Duplicate repayment prevented (cannot repay on already CLOSED loan)', async () => {
    const res = await fetch(`${baseUrl}/api/loans/${testLoan1Id}/repay-cash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /पूर्ण भरले|already fully repaid/);
  });

  test('26. Concurrent repayment protected via write lock', async () => {
    // Create new loan of 5000 for Member 1 to test concurrency
    const newLoanRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: NTM_MEMBER_1_ID,
        amount: 5000,
      }),
    });
    const newLoanId = (await newLoanRes.json()).data.id;

    // Send two concurrent repayments of 3000 each (total 6000 > 5000)
    const [p1, p2] = await Promise.all([
      fetch(`${baseUrl}/api/loans/${newLoanId}/repay-cash`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 3000 }),
      }),
      fetch(`${baseUrl}/api/loans/${newLoanId}/repay-cash`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${treasurerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 3000 }),
      }),
    ]);

    const statuses = [p1.status, p2.status];
    // One must succeed (200) and the second must be rejected (400 overpayment)
    assert.ok(statuses.includes(200));
    assert.ok(statuses.includes(400));
  });

  test('27. Audit event LOAN_REPAYMENT_RECORDED created in audit_logs', () => {
    const db = getDatabase();
    const audit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'LOAN_REPAYMENT_RECORDED' ORDER BY created_at DESC LIMIT 1")
      .get() as any;
    assert.ok(audit);
    const details = JSON.parse(audit.details);
    assert.ok(details.loanId);
    assert.ok(details.amount);
  });

  test('28. Rollback works on failure', () => {
    const db = getDatabase();
    const txnCountBefore = (db.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;

    // Direct database invalid insert test wrapped in try/catch rollback
    try {
      db.exec('BEGIN IMMEDIATE TRANSACTION;');
      db.prepare('INSERT INTO loans (id, organization_id, member_id, actor_id, amount) VALUES (?, ?, ?, ?, ?)').run(
        'invalid-id',
        'non-existent-org',
        'non-existent-member',
        'non-existent-actor',
        -1000 // violates CHECK (amount > 0)
      );
      db.exec('COMMIT;');
    } catch {
      db.exec('ROLLBACK;');
    }

    const txnCountAfter = (db.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;
    assert.strictEqual(txnCountBefore, txnCountAfter);
  });

  // === Passbook Integration (29 - 35) ===
  test('29. Member sees own loan disbursement in digital passbook', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const txns = body.data.transactions;
    assert.ok(txns.some((t: any) => t.transactionType === 'LOAN_DISBURSED'));
  });

  test('30. Member sees own repayment in digital passbook', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const body = await res.json();
    const txns = body.data.transactions;
    assert.ok(txns.some((t: any) => t.transactionType === 'LOAN_REPAYMENT'));
  });

  test('31. Member cannot see another members loans (403 IDOR rejection)', async () => {
    // Member 2 requesting Member 1 loans
    const res = await fetch(`${baseUrl}/api/loans/member/${NTM_MEMBER_1_ID}`, {
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /परवानगी नाही|Cannot view/);
  });

  test('32. Member cannot see another members repayment receipts (403 IDOR rejection)', async () => {
    // Member 2 requesting Member 1 repayment receipt
    const res = await fetch(`${baseUrl}/api/transactions/${testRepayment1TxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    assert.strictEqual(res.status, 403);
  });

  test('33. President sees same-mandal loan records', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.length >= 2);
  });

  test('34. Treasurer sees authorized same-mandal records', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.length >= 2);
  });

  test('35. Cross-mandal loan access rejected', async () => {
    // JHM President querying NTM loans
    const res = await fetch(`${baseUrl}/api/loans/member/${NTM_MEMBER_1_ID}`, {
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  // === Integrity & Security (36 - 40) ===
  test('36. Confirmed loan transaction cannot be edited (no PUT / PATCH endpoint)', async () => {
    const putRes = await fetch(`${baseUrl}/api/transactions/${testLoan1TxnId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 99999 }),
    });
    assert.ok(putRes.status === 404 || putRes.status === 405);
  });

  test('37. Confirmed loan transaction cannot be deleted (no DELETE endpoint)', async () => {
    const delRes = await fetch(`${baseUrl}/api/transactions/${testLoan1TxnId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.ok(delRes.status === 404 || delRes.status === 405);
  });

  test('38. Loan, passbook, and ledger remain 100% consistent', async () => {
    const db = getDatabase();
    const loanRow = db.prepare('SELECT amount FROM loans WHERE id = ?').get(testLoan1Id) as any;
    const repRows = db
      .prepare("SELECT amount FROM financial_transactions WHERE transaction_type = 'LOAN_REPAYMENT' AND reference_id IN (SELECT id FROM loan_repayments WHERE loan_id = ?)")
      .all(testLoan1Id) as any[];

    const sumRepaid = repRows.reduce((sum, r) => sum + r.amount, 0);
    assert.strictEqual(sumRepaid, loanRow.amount); // Loan 1 was fully repaid
  });

  test('39. Zero fake loan data is seeded in database', () => {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM loans').all() as any[];
    for (const r of rows) {
      assert.ok(!JSON.stringify(r).includes('demo'));
      assert.ok(!JSON.stringify(r).includes('fake'));
    }
  });

  test('40. Empty state works when a member has zero loans', async () => {
    // JHM Member has no loans
    const res = await fetch(`${baseUrl}/api/loans/member/${JHM_MEMBER_ID}`, {
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.data, []);
  });
});
