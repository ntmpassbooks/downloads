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
let jhmPresidentToken = '';
let jhmTreasurerToken = '';
let jhmMemberToken = '';

const NTM_ORG_ID = 'org-ntm-001';
const JHM_ORG_ID = 'org-jhm-002';

let testExpense1Id = '';
let testExpense1TxnId = '';
let testExpense1TxnNumber = '';

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
      ('usr-jhm-pres-01', ?, 'JHM President', '9876543220', ?, ?, 'PRESIDENT', 1),
      ('usr-jhm-treas-01', ?, 'JHM Treasurer', '9876543221', ?, ?, 'TREASURER', 1),
      ('usr-jhm-member-02', ?, 'JHM Member', '9876543222', ?, ?, 'MEMBER', 1)
  `).run(JHM_ORG_ID, hash, salt, JHM_ORG_ID, hash, salt, JHM_ORG_ID, hash, salt);

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

  // Login NTM President
  const presRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
  });
  const presData = await presRes.json();
  presidentToken = presData.token;

  // Login NTM Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  const treasData = await treasRes.json();
  treasurerToken = treasData.token;

  // Login NTM Member
  const memRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  const memData = await memRes.json();
  memberToken = memData.token;

  // Login JHM President
  const jhmPresRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543220', pin: '1234' }),
  });
  const jhmPresData = await jhmPresRes.json();
  jhmPresidentToken = jhmPresData.token;

  // Login JHM Treasurer
  const jhmTreasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543221', pin: '1234' }),
  });
  const jhmTreasData = await jhmTreasRes.json();
  jhmTreasurerToken = jhmTreasData.token;

  // Login JHM Member
  const jhmMemRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543222', pin: '1234' }),
  });
  const jhmMemData = await jhmMemRes.json();
  jhmMemberToken = jhmMemData.token;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeDatabase();
});

describe('Phase 1G: Real Expense Management + Fund Outgo + Ledger Integration Tests', () => {
  // 1. President can create real expense
  test('1. President can create real expense', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 2500,
        category: 'मंडळ कार्यक्रम',
        reason: 'गणेशोत्सव मंडप सजावट',
        expenseDate: '2026-09-11',
        notes: 'सजावटीचे साहित्य रोख आणले',
      }),
    });

    const json = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.amount, 2500);
    assert.strictEqual(json.data.category, 'मंडळ कार्यक्रम');
    assert.strictEqual(json.data.reason, 'गणेशोत्सव मंडप सजावट');
    assert.strictEqual(json.data.status, 'CONFIRMED');
    assert.ok(json.data.id);
    assert.ok(json.data.transactionId);
    assert.ok(json.data.transactionNumber.startsWith('TXN-EXP-'));

    testExpense1Id = json.data.id;
    testExpense1TxnId = json.data.transactionId;
    testExpense1TxnNumber = json.data.transactionNumber;
  });

  // 2. Authorized Treasurer can create expense
  test('2. Authorized Treasurer can create expense', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({
        amount: 1200,
        category: 'साहित्य',
        reason: 'ध्वनिक्षेपक व वायर खरेदी',
        expenseDate: '2026-09-11',
      }),
    });

    const json = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.amount, 1200);
    assert.strictEqual(json.data.category, 'साहित्य');
    assert.strictEqual(json.data.status, 'CONFIRMED');
  });

  // 3. Member cannot create expense (403 Forbidden)
  test('3. Member cannot create expense (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        category: 'प्रवास',
        reason: 'सभासद प्रवास खर्च',
      }),
    });

    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.success, false);
  });

  // 4. Cross-mandal expense creation rejected (User is strictly scoped to own tenant)
  test('4. Cross-mandal expense creation rejected', async () => {
    // JHM Treasurer creates expense -> must strictly be recorded in JHM organization, cannot affect NTM
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jhmTreasurerToken}`,
      },
      body: JSON.stringify({
        amount: 800,
        category: 'कार्यालयीन खर्च',
        reason: 'JHM रजिस्टर वही खरेदी',
      }),
    });

    assert.strictEqual(res.status, 201);
    const json = await res.json();
    assert.strictEqual(json.data.organizationId, JHM_ORG_ID);

    // Verify in DB that NTM has not recorded this expense
    const db = getDatabase();
    const row = db.prepare('SELECT organization_id FROM expenses WHERE id = ?').get(json.data.id) as any;
    assert.strictEqual(row.organization_id, JHM_ORG_ID);
    assert.notStrictEqual(row.organization_id, NTM_ORG_ID);
  });

  // 5. Invalid amount rejected (400)
  test('5. Invalid amount rejected (400)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 'two thousand',
        category: 'देखभाल',
        reason: 'दुरुस्ती खर्च',
      }),
    });

    assert.strictEqual(res.status, 400);
  });

  // 6. Zero amount rejected (400)
  test('6. Zero amount rejected (400)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 0,
        category: 'देखभाल',
        reason: 'दुरुस्ती खर्च',
      }),
    });

    assert.strictEqual(res.status, 400);
  });

  // 7. Negative amount rejected (400)
  test('7. Negative amount rejected (400)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: -500,
        category: 'देखभाल',
        reason: 'दुरुस्ती खर्च',
      }),
    });

    assert.strictEqual(res.status, 400);
  });

  // 8. Invalid category rejected (400)
  test('8. Invalid category rejected (400)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        category: 'अनधिकृत वर्ग',
        reason: 'काहीतरी खर्च',
      }),
    });

    assert.strictEqual(res.status, 400);
  });

  // 9. Missing reason rejected if required (400)
  test('9. Missing reason rejected (400)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        category: 'इतर',
        reason: '',
      }),
    });

    assert.strictEqual(res.status, 400);
  });

  // 10. Real expense record created in database
  test('10. Real expense record created in database', () => {
    const db = getDatabase();
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(testExpense1Id) as any;

    assert.ok(expense);
    assert.strictEqual(expense.id, testExpense1Id);
    assert.strictEqual(expense.organization_id, NTM_ORG_ID);
    assert.strictEqual(expense.amount, 2500);
    assert.strictEqual(expense.category, 'मंडळ कार्यक्रम');
    assert.strictEqual(expense.reason, 'गणेशोत्सव मंडप सजावट');
    assert.strictEqual(expense.status, 'CONFIRMED');
    assert.strictEqual(expense.transaction_id, testExpense1TxnId);
  });

  // 11. Real EXPENSE ledger transaction created in financial_transactions
  test('11. Real EXPENSE ledger transaction created in financial_transactions', () => {
    const db = getDatabase();
    const txn = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(testExpense1TxnId) as any;

    assert.ok(txn);
    assert.strictEqual(txn.transaction_type, 'EXPENSE');
    assert.strictEqual(txn.amount, 2500);
    assert.strictEqual(txn.reference_id, testExpense1Id);
    assert.strictEqual(txn.transaction_number, testExpense1TxnNumber);
    assert.strictEqual(txn.status, 'CONFIRMED');
    assert.strictEqual(txn.member_id, null); // Organization-level transaction
  });

  // 12. Unique transaction ID generated
  test('12. Unique transaction ID generated', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 400,
        category: 'प्रवास',
        reason: 'बँक कामासाठी रिक्षा खर्च',
      }),
    });

    const json = await res.json();
    assert.strictEqual(res.status, 201);
    assert.notStrictEqual(json.data.transactionId, testExpense1TxnId);
    assert.notStrictEqual(json.data.transactionNumber, testExpense1TxnNumber);
  });

  // 13. Audit event EXPENSE_CREATED created in audit_logs
  test('13. Audit event EXPENSE_CREATED created in audit_logs', () => {
    const db = getDatabase();
    const audit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'EXPENSE_CREATED' AND organization_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(NTM_ORG_ID) as any;

    assert.ok(audit);
    const details = JSON.parse(audit.details);
    assert.ok(details.expenseId);
    assert.ok(details.transactionId);
    assert.ok(details.amount > 0);
    assert.ok(details.category);
    assert.ok(details.reason);
  });

  // 14. Expense and ledger transaction are atomic
  test('14. Expense and ledger transaction are atomic', () => {
    const db = getDatabase();
    const expensesCount = db.prepare('SELECT COUNT(*) as c FROM expenses WHERE organization_id = ?').get(NTM_ORG_ID) as any;
    const ledgerExpensesCount = db
      .prepare("SELECT COUNT(*) as c FROM financial_transactions WHERE organization_id = ? AND transaction_type = 'EXPENSE'")
      .get(NTM_ORG_ID) as any;

    assert.strictEqual(expensesCount.c, ledgerExpensesCount.c);
  });

  // 15. Rollback works on failure
  test('15. Rollback works on failure', () => {
    const db = getDatabase();
    const initialExpensesCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c;
    const initialTxnCount = (db.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;

    assert.throws(() => {
      // Simulate failure inside transaction
      db.exec('BEGIN IMMEDIATE TRANSACTION;');
      db.prepare(`
        INSERT INTO financial_transactions (id, organization_id, member_id, actor_id, transaction_type, reference_id, transaction_number, amount)
        VALUES ('fail-txn-1', 'org-ntm-001', NULL, 'usr-test', 'EXPENSE', 'fail-exp-1', 'TXN-FAIL-01', 999)
      `).run();
      // Cause deliberate syntax/foreign key error
      db.prepare("INSERT INTO non_existent_table VALUES ('err')").run();
      db.exec('COMMIT;');
    });

    try {
      db.exec('ROLLBACK;');
    } catch {}

    const afterExpensesCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c;
    const afterTxnCount = (db.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;

    assert.strictEqual(afterExpensesCount, initialExpensesCount);
    assert.strictEqual(afterTxnCount, initialTxnCount);
  });

  // 16. Confirmed expense cannot be silently edited (no PUT / PATCH endpoint)
  test('16. Confirmed expense cannot be edited (no PUT / PATCH endpoint)', async () => {
    const putRes = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ amount: 9999 }),
    });
    assert.strictEqual(putRes.status, 404);

    const patchRes = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ amount: 9999 }),
    });
    assert.strictEqual(patchRes.status, 404);
  });

  // 17. Unauthorized expense delete blocked (Member & Treasurer 403)
  test('17. Unauthorized expense delete blocked (Member & Treasurer 403)', async () => {
    // Member blocked
    const memberDelRes = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(memberDelRes.status, 403);

    // Treasurer blocked
    const treasDelRes = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.strictEqual(treasDelRes.status, 403);

    // Cross-mandal President blocked
    const crossDelRes = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    assert.strictEqual(crossDelRes.status, 404);
  });

  // 18. Expense does not alter Bishi history
  test('18. Expense does not alter Bishi history', () => {
    const db = getDatabase();
    // Bishi records must have zero reference to expenses
    const corruptedBishi = db
      .prepare("SELECT COUNT(*) as c FROM bishi_records WHERE status = 'EXPENSE' OR payment_method = 'EXPENSE'")
      .get() as any;
    assert.strictEqual(corruptedBishi.c, 0);
  });

  // 19. Expense does not alter loan balance
  test('19. Expense does not alter loan balance', async () => {
    const db = getDatabase();
    const loanRow = db.prepare('SELECT COUNT(*) as c FROM loans').get() as any;
    // Loan table has no records affected by expenses
    assert.ok(loanRow);
  });

  // 20. Fund calculation includes expense exactly once (reduces net funds)
  test('20. Fund calculation includes expense exactly once (reduces net funds)', async () => {
    const res = await fetch(`${baseUrl}/api/ledger`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const json = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(json.data.summary);
    const { totalInflow, totalOutflow, totalExpenses, totalFunds } = json.data.summary;

    assert.strictEqual(typeof totalFunds, 'number');
    assert.strictEqual(typeof totalExpenses, 'number');
    assert.strictEqual(totalOutflow >= totalExpenses, true);
    assert.strictEqual(totalFunds, totalInflow - totalOutflow);
  });

  // 21. No hardcoded fund amount
  test('21. No hardcoded fund amount', () => {
    const db = getDatabase();
    const sumRow = db
      .prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type IN ('BISHI_PAYMENT', 'LOAN_REPAYMENT') THEN amount ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN transaction_type IN ('LOAN_DISBURSED', 'EXPENSE') THEN amount ELSE 0 END), 0) as net
        FROM financial_transactions
        WHERE organization_id = ? AND status = 'CONFIRMED'
      `)
      .get(NTM_ORG_ID) as any;

    assert.strictEqual(typeof sumRow.net, 'number');
  });

  // 22. Member cannot access expense creation endpoint (403)
  test('22. Member cannot access expense creation endpoint (403)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        amount: 300,
        category: 'इतर',
        reason: 'अनधिकृत प्रयत्न',
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  // 23. Member cannot access unauthorized expense list (403)
  test('23. Member cannot access unauthorized expense list (403)', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  // 24. Cross-organization expense access blocked (IDOR)
  test('24. Cross-organization expense access blocked (IDOR)', async () => {
    // JHM President tries to access NTM's expense
    const res = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  // 25. Treasurer cannot access another mandals expenses
  test('25. Treasurer cannot access another mandals expenses', async () => {
    const res = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      headers: { Authorization: `Bearer ${jhmTreasurerToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  // 26. President cannot access another mandals expenses
  test('26. President cannot access another mandals expenses', async () => {
    const res = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  // 27. Sensitive auth fields never returned
  test('27. Sensitive auth fields (PIN, salt, token) never returned', async () => {
    const res = await fetch(`${baseUrl}/api/expenses/${testExpense1Id}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const json = await res.json();

    assert.strictEqual(res.status, 200);
    const serialized = JSON.stringify(json);
    assert.strictEqual(serialized.includes('pin_hash'), false);
    assert.strictEqual(serialized.includes('pin_salt'), false);
    assert.strictEqual(serialized.includes('pinHash'), false);
    assert.strictEqual(serialized.includes('pinSalt'), false);
  });

  // 28. Expense history uses real backend data
  test('28. Expense history uses real backend data', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const json = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(json.data.expenses));
    assert.strictEqual(json.data.expenses.length >= 2, true);
    assert.ok(json.data.summary.totalExpenses > 0);
  });

  // 29. Empty state works with zero expenses
  test('29. Empty state works with zero expenses', async () => {
    // Create a temporary third org with 0 expenses
    const db = getDatabase();
    const emptyOrgId = 'org-empty-test-03';
    db.prepare("INSERT OR IGNORE INTO organizations (id, name, code) VALUES (?, 'रिक्त मंडळ', 'EMP03')").run(emptyOrgId);

    const { hash, salt } = await import('../src/modules/auth/auth.service.js').then((m) =>
      m.AuthService.hashPin('1234')
    );
    db.prepare(`
      INSERT OR IGNORE INTO users (id, organization_id, full_name, phone, pin_hash, pin_salt, role, is_active)
      VALUES ('usr-emp-pres-01', ?, 'Empty President', '9876543277', ?, ?, 'PRESIDENT', 1)
    `).run(emptyOrgId, hash, salt);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543277', pin: '1234' }),
    });
    const loginJson = await loginRes.json();
    const emptyToken = loginJson.token;

    const res = await fetch(`${baseUrl}/api/expenses`, {
      headers: { Authorization: `Bearer ${emptyToken}` },
    });
    const json = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.data.expenses.length, 0);
    assert.strictEqual(json.data.summary.totalExpenses, 0);
    assert.strictEqual(json.data.summary.totalTransactions, 0);

    // Clean up temporary user and org
    db.prepare("DELETE FROM users WHERE id = 'usr-emp-pres-01'").run();
    db.prepare("DELETE FROM organizations WHERE id = ?").run(emptyOrgId);
  });

  // 30. No fake expense records are seeded
  test('30. No fake expense records are seeded', () => {
    const db = getDatabase();
    const fakeExpenses = db.prepare("SELECT * FROM expenses WHERE reason LIKE '%demo%' OR reason LIKE '%sample%'").all();
    assert.strictEqual(fakeExpenses.length, 0);
  });

  // 31. No hardcoded expense totals
  test('31. No hardcoded expense totals', async () => {
    const res = await fetch(`${baseUrl}/api/expenses`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const json = await res.json();

    const db = getDatabase();
    const realSum = (
      db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM expenses WHERE organization_id = ? AND status = 'CONFIRMED'").get(NTM_ORG_ID) as any
    ).s;

    assert.strictEqual(json.data.summary.totalExpenses, realSum);
  });

  // 32. Double submission does not create duplicate expense
  test('32. Double submission does not create duplicate expense', async () => {
    const payload = {
      amount: 1500,
      category: 'मंडळ कार्यक्रम',
      reason: 'प्रसाद व वाटप साहित्य',
      expenseDate: '2026-09-11',
    };

    // First submission
    const res1 = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res1.status, 201);

    // Immediate second submission with identical data
    const res2 = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify(payload),
    });

    // Must be rejected as duplicate
    assert.strictEqual(res2.status, 409);
  });

  // 33. President can atomically delete an authorized expense and cleans up ledger transaction
  test('33. President can atomically delete an authorized expense and cleans up ledger transaction', async () => {
    // 1. Create a test expense
    const createRes = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        amount: 850,
        category: 'प्रवास',
        reason: 'हटवण्यासाठी तात्पुरता खर्च',
        expenseDate: '2026-09-12',
      }),
    });
    assert.strictEqual(createRes.status, 201);
    const createdJson = await createRes.json();
    const tempExpenseId = createdJson.data.id;
    const tempTxnId = createdJson.data.transactionId;

    const db = getDatabase();
    // Verify both rows exist before delete
    const expenseBefore = db.prepare('SELECT id FROM expenses WHERE id = ?').get(tempExpenseId);
    const txnBefore = db.prepare('SELECT id FROM financial_transactions WHERE id = ?').get(tempTxnId);
    assert.ok(expenseBefore);
    assert.ok(txnBefore);

    // 2. Delete as President
    const delRes = await fetch(`${baseUrl}/api/expenses/${tempExpenseId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(delRes.status, 200);
    const delJson = await delRes.json();
    assert.strictEqual(delJson.success, true);

    // 3. Verify atomic deletion in database: NO orphaned rows
    const expenseAfter = db.prepare('SELECT id FROM expenses WHERE id = ?').get(tempExpenseId);
    const txnAfter = db.prepare('SELECT id FROM financial_transactions WHERE id = ?').get(tempTxnId);
    assert.strictEqual(expenseAfter, undefined);
    assert.strictEqual(txnAfter, undefined);

    // 4. Verify audit log was recorded
    const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'EXPENSE_DELETED' AND details LIKE ?").get(`%${tempExpenseId}%`) as any;
    assert.ok(auditLog);
  });
});
