import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
process.env.SESSION_SECRET = 'audit-and-reporting-test-session-secret-32-chars-long!';

describe('Phase 2A: Financial Reporting & Audit Export Tests', () => {
  let app: any;
  let server: any;
  let baseUrl: string;
  let db: DatabaseSync;

  // Org A tokens
  let orgAPresToken: string;
  let orgATreasToken: string;
  let orgAMemToken: string;
  let orgAId: string;
  let orgAPresId: string;
  let orgAMemberId: string;

  // Org B tokens
  let orgBPresToken: string;
  let orgBId: string;

  before(async () => {
    const testDbPath = path.resolve(process.cwd(), './data/ntm_test.sqlite');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const walPath = `${testDbPath}-wal`;
    const shmPath = `${testDbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    const { createApp } = await import('../src/app.js');
    const { runMigrations } = await import('../src/db/migrate.js');
    const { getDatabase } = await import('../src/db/connection.js');

    runMigrations();
    db = getDatabase();

    app = createApp();
    server = app.listen(0);
    await new Promise((res) => server.once('listening', res));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Setup Org A: First President
    const regResA = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवनेरी मित्र मंडळ अ',
        mandalCode: 'SMMA1',
        fullName: 'अध्यक्ष अ',
        phone: '9822000001',
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    const regJsonA = await regResA.json();
    orgAPresToken = regJsonA.token;
    orgAPresId = regJsonA.user.id;
    orgAId = regJsonA.organization.id;

    // Create Treasurer in Org A
    const treasRes = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAPresToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'खजिनदार अ',
        phone: '9822000002',
        initialPin: '1234',
        role: 'TREASURER',
      }),
    });
    const treasJson = await treasRes.json();
    const treasLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000002', pin: '1234' }),
    });
    orgATreasToken = (await treasLogin.json()).token;

    // Create Member in Org A
    const memRes = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAPresToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'सभासद अ',
        phone: '9822000003',
        initialPin: '1234',
        role: 'MEMBER',
      }),
    });
    const memJson = await memRes.json();
    orgAMemberId = memJson.data.id;
    const memLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000003', pin: '1234' }),
    });
    orgAMemToken = (await memLogin.json()).token;

    // Setup Org B directly in DB to test tenant isolation
    orgBId = 'org-tenant-b-uuid';
    db.prepare(`
      INSERT INTO organizations (id, name, code, registration_number)
      VALUES (?, 'दुसरे मंडळ ब', 'SMMB2', 'REG-B02')
    `).run(orgBId);

    const { AuthService } = await import('../src/modules/auth/auth.service.js');
    const { hash, salt } = AuthService.hashPin('1234');
    const orgBPresId = 'user-pres-b-uuid';
    db.prepare(`
      INSERT INTO users (id, organization_id, phone, pin_hash, pin_salt, full_name, role, is_active)
      VALUES (?, ?, '9822000099', ?, ?, 'अध्यक्ष ब', 'PRESIDENT', 1)
    `).run(orgBPresId, orgBId, hash, salt);

    const orgBLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000099', pin: '1234' }),
    });
    const orgBLoginJson = await orgBLogin.json();
    orgBPresToken = orgBLoginJson.token;
  });

  after(() => {
    server?.close();
  });

  it('1. Unauthenticated request to monthly statement is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-09`);
    assert.strictEqual(res.status, 401);
  });

  it('2. Member request to monthly statement is rejected with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-09`, {
      headers: { Authorization: `Bearer ${orgAMemToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  it('3. Monthly statement rejects missing monthYear query with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(res.status, 400);
  });

  it('4. Monthly statement rejects invalid monthYear format with 400 Bad Request', async () => {
    const invalidFormats = ['2026-13', '2026-00', '2026/09', 'invalid', '2026-9'];
    for (const fmt of invalidFormats) {
      const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=${fmt}`, {
        headers: { Authorization: `Bearer ${orgAPresToken}` },
      });
      assert.strictEqual(res.status, 400, `Expected 400 for format ${fmt}`);
    }
  });

  it('5. Empty ledger returns 0 counts and zero balances without fake data', async () => {
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-05`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.monthYear, '2026-05');
    assert.strictEqual(json.data.openingBalance, 0);
    assert.strictEqual(json.data.inflows.totalInflow, 0);
    assert.strictEqual(json.data.inflows.bishiCollection, 0);
    assert.strictEqual(json.data.inflows.loanRepayments, 0);
    assert.strictEqual(json.data.outflows.totalOutflow, 0);
    assert.strictEqual(json.data.outflows.loanDisbursements, 0);
    assert.strictEqual(json.data.outflows.expenses, 0);
    assert.strictEqual(json.data.netMovement, 0);
    assert.strictEqual(json.data.closingBalance, 0);
    assert.strictEqual(json.data.transactionCount, 0);
    assert.deepStrictEqual(json.data.transactions, []);
  });

  it('6. Math verification: Opening balance, Inflow, Outflow, Net Movement, and Closing Balance calculate accurately', async () => {
    // Insert historical transactions across 2 months
    // Month 1: 2026-06
    // Bishi payment: ₹2000 (Inflow)
    // Expense: ₹500 (Outflow)
    // Month 1 Net = 2000 - 500 = +1500
    db.prepare(`
      INSERT INTO financial_transactions (
        id, organization_id, member_id, actor_id, transaction_type, reference_id,
        transaction_number, amount, payment_method, transaction_date, status, notes
      ) VALUES 
      ('txn-m1-1', ?, ?, ?, 'BISHI_PAYMENT', 'rec-1', 'TXN-20260610-01', 2000, 'CASH', '2026-06-10', 'CONFIRMED', 'जून बीसी जमा'),
      ('txn-m1-2', ?, NULL, ?, 'EXPENSE', 'exp-1', 'TXN-20260615-02', 500, 'CASH', '2026-06-15', 'CONFIRMED', 'चहापान खर्च')
    `).run(orgAId, orgAMemberId, orgAPresId, orgAId, orgAPresId);

    // Month 2: 2026-07
    // Loan disbursed: ₹5000 (Outflow)
    // Loan repaid: ₹1000 (Inflow)
    // Month 2 Net = 1000 - 5000 = -4000
    db.prepare(`
      INSERT INTO financial_transactions (
        id, organization_id, member_id, actor_id, transaction_type, reference_id,
        transaction_number, amount, payment_method, transaction_date, status, notes
      ) VALUES 
      ('txn-m2-1', ?, ?, ?, 'LOAN_DISBURSED', 'loan-1', 'TXN-20260705-01', 5000, 'CASH', '2026-07-05', 'CONFIRMED', 'कर्ज वाटप'),
      ('txn-m2-2', ?, ?, ?, 'LOAN_REPAYMENT', 'repay-1', 'TXN-20260720-02', 1000, 'CASH', '2026-07-20', 'CONFIRMED', 'कर्ज परतफेड')
    `).run(orgAId, orgAMemberId, orgAPresId, orgAId, orgAMemberId, orgAPresId);

    // Verify Month 1 Statement (2026-06)
    const resM1 = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-06`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    const jsonM1 = await resM1.json();
    assert.strictEqual(jsonM1.data.openingBalance, 0);
    assert.strictEqual(jsonM1.data.inflows.bishiCollection, 2000);
    assert.strictEqual(jsonM1.data.inflows.totalInflow, 2000);
    assert.strictEqual(jsonM1.data.outflows.expenses, 500);
    assert.strictEqual(jsonM1.data.outflows.totalOutflow, 500);
    assert.strictEqual(jsonM1.data.netMovement, 1500);
    assert.strictEqual(jsonM1.data.closingBalance, 1500);
    assert.strictEqual(jsonM1.data.transactionCount, 2);

    // Verify Month 2 Statement (2026-07)
    const resM2 = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-07`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    const jsonM2 = await resM2.json();
    // Opening balance of Month 2 must equal closing balance of Month 1 (₹1500)
    assert.strictEqual(jsonM2.data.openingBalance, 1500);
    assert.strictEqual(jsonM2.data.inflows.loanRepayments, 1000);
    assert.strictEqual(jsonM2.data.inflows.totalInflow, 1000);
    assert.strictEqual(jsonM2.data.outflows.loanDisbursements, 5000);
    assert.strictEqual(jsonM2.data.outflows.totalOutflow, 5000);
    assert.strictEqual(jsonM2.data.netMovement, -4000);
    assert.strictEqual(jsonM2.data.closingBalance, -2500); // 1500 - 4000 = -2500
    assert.strictEqual(jsonM2.data.transactionCount, 2);

    // Verify Month 3 Statement (2026-08) - No transactions in Month 3
    const resM3 = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-08`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    const jsonM3 = await resM3.json();
    // Opening balance of Month 3 must equal closing balance of Month 2 (-₹2500)
    assert.strictEqual(jsonM3.data.openingBalance, -2500);
    assert.strictEqual(jsonM3.data.inflows.totalInflow, 0);
    assert.strictEqual(jsonM3.data.outflows.totalOutflow, 0);
    assert.strictEqual(jsonM3.data.netMovement, 0);
    assert.strictEqual(jsonM3.data.closingBalance, -2500);
    assert.strictEqual(jsonM3.data.transactionCount, 0);
  });

  it('7. Treasurer can retrieve monthly statement with identical authoritative data', async () => {
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-06`, {
      headers: { Authorization: `Bearer ${orgATreasToken}` },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.data.openingBalance, 0);
    assert.strictEqual(json.data.closingBalance, 1500);
  });

  it('8. Cross-Tenant IDOR: Org B President cannot view Org A monthly statement figures', async () => {
    const resB = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-06`, {
      headers: { Authorization: `Bearer ${orgBPresToken}` },
    });
    assert.strictEqual(resB.status, 200);
    const jsonB = await resB.json();
    // Org B has 0 transactions, so it should receive clean zeroes, not Org A's ₹1500
    assert.strictEqual(jsonB.data.openingBalance, 0);
    assert.strictEqual(jsonB.data.inflows.totalInflow, 0);
    assert.strictEqual(jsonB.data.closingBalance, 0);
    assert.strictEqual(jsonB.data.transactionCount, 0);
    assert.deepStrictEqual(jsonB.data.transactions, []);
  });

  it('9. Unauthenticated request to export audit CSV is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/reports/export-audit`);
    assert.strictEqual(res.status, 401);
  });

  it('10. Member request to export audit CSV is rejected with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/reports/export-audit`, {
      headers: { Authorization: `Bearer ${orgAMemToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  it('11. President can export audit CSV with UTF-8 BOM, Marathi headers, and authoritative transactions', async () => {
    const res = await fetch(`${baseUrl}/api/reports/export-audit`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(res.headers.get('content-disposition') || '', /attachment; filename="ntm_audit_ledger_all\.csv"/);

    const buffer = Buffer.from(await res.arrayBuffer());
    // Check UTF-8 BOM prefix (\uFEFF -> 0xEF, 0xBB, 0xBF)
    assert.strictEqual(buffer[0], 0xef, 'Expected UTF-8 BOM byte 1');
    assert.strictEqual(buffer[1], 0xbb, 'Expected UTF-8 BOM byte 2');
    assert.strictEqual(buffer[2], 0xbf, 'Expected UTF-8 BOM byte 3');

    const text = buffer.toString('utf-8');

    // Check Marathi Header row
    assert.ok(text.includes('व्यवहार क्र. (Transaction No)'));
    assert.ok(text.includes('दिनांक (Date)'));
    assert.ok(text.includes('व्यवहाराचा प्रकार (Type)'));
    assert.ok(text.includes('रक्कम (Amount ₹)'));

    // Check transaction rows
    assert.ok(text.includes('TXN-20260610-01'));
    assert.ok(text.includes('2000'));
    assert.ok(text.includes('मासिक बीसी जमा'));
    assert.ok(text.includes('TXN-20260615-02'));
    assert.ok(text.includes('500'));
    assert.ok(text.includes('मंडळ खर्च'));
  });

  it('12. Audit CSV export supports monthYear filter', async () => {
    const res = await fetch(`${baseUrl}/api/reports/export-audit?monthYear=2026-06`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /attachment; filename="ntm_audit_ledger_2026-06\.csv"/);

    const text = await res.text();
    assert.ok(text.includes('TXN-20260610-01')); // June
    assert.ok(!text.includes('TXN-20260705-01')); // July transaction must NOT appear
  });

  it('13. Audit CSV export never leaks sensitive credentials (PINs, hashes, salts, tokens)', async () => {
    const res = await fetch(`${baseUrl}/api/reports/export-audit`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    const text = await res.text();

    assert.ok(!text.includes('pin_hash'));
    assert.ok(!text.includes('pin_salt'));
    assert.ok(!text.includes('$scrypt$'));
    assert.ok(!text.includes('session_tokens'));
  });

  it('14. Cross-Tenant IDOR: Org B CSV export does not contain Org A transactions', async () => {
    const resB = await fetch(`${baseUrl}/api/reports/export-audit`, {
      headers: { Authorization: `Bearer ${orgBPresToken}` },
    });
    assert.strictEqual(resB.status, 200);
    const textB = await resB.text();

    assert.ok(!textB.includes('TXN-20260610-01'));
    assert.ok(!textB.includes('TXN-20260705-01'));
    assert.ok(!textB.includes('शिवनेरी मित्र मंडळ'));
  });

  it('15. Read-only guarantee: Reporting endpoints never mutate database row counts', async () => {
    const getCounts = () => ({
      transactions: db.prepare('SELECT COUNT(*) as c FROM financial_transactions').get().c,
      users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      expenses: db.prepare('SELECT COUNT(*) as c FROM expenses').get().c,
      loans: db.prepare('SELECT COUNT(*) as c FROM loans').get().c,
    });

    const before = getCounts();

    // Call monthly statement and CSV export multiple times
    await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-06`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    await fetch(`${baseUrl}/api/reports/export-audit`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    await fetch(`${baseUrl}/api/reports/export-audit?monthYear=2026-07`, {
      headers: { Authorization: `Bearer ${orgATreasToken}` },
    });

    const after = getCounts();

    assert.deepStrictEqual(before, after, 'Database row counts must remain completely unchanged');
  });

  it('16. Year-boundary calculation: Historical transactions in prior year carry forward accurately into opening balance', async () => {
    // Insert transaction from 2025-12
    db.prepare(`
      INSERT INTO financial_transactions (
        id, organization_id, member_id, actor_id, transaction_type, reference_id,
        transaction_number, amount, payment_method, transaction_date, status, notes
      ) VALUES 
      ('txn-2025-1', ?, ?, ?, 'BISHI_PAYMENT', 'rec-2025', 'TXN-20251215-01', 3000, 'CASH', '2025-12-15', 'CONFIRMED', 'डिसेंबर २०२५ बीसी')
    `).run(orgAId, orgAMemberId, orgAPresId);

    // Fetch 2026-01 statement
    const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-01`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    // Opening balance for 2026-01 must include the 2025-12 transaction (₹3000)
    assert.strictEqual(json.data.openingBalance, 3000);
    assert.strictEqual(json.data.inflows.totalInflow, 0);
    assert.strictEqual(json.data.closingBalance, 3000);
  });

  it('17. Category verification: Bishi, Loan Repayment, Loan Disbursement, and Expense populate exact respective buckets', async () => {
    // Month 2026-09: Insert one of each category
    db.prepare(`
      INSERT INTO financial_transactions (
        id, organization_id, member_id, actor_id, transaction_type, reference_id,
        transaction_number, amount, payment_method, transaction_date, status, notes
      ) VALUES 
      ('cat-bishi', ?, ?, ?, 'BISHI_PAYMENT', 'bishi-ref-1', 'TXN-20260901-01', 1200, 'CASH', '2026-09-01', 'CONFIRMED', 'सप्टेंबर बीसी'),
      ('cat-repay', ?, ?, ?, 'LOAN_REPAYMENT', 'repay-ref-1', 'TXN-20260905-02', 800, 'CASH', '2026-09-05', 'CONFIRMED', 'कर्ज परतफेड'),
      ('cat-loan', ?, ?, ?, 'LOAN_DISBURSED', 'loan-ref-1', 'TXN-20260910-03', 4000, 'CASH', '2026-09-10', 'CONFIRMED', 'कर्ज वाटप'),
      ('cat-exp', ?, NULL, ?, 'EXPENSE', 'exp-ref-1', 'TXN-20260912-04', 350, 'CASH', '2026-09-12', 'CONFIRMED', 'मंडप खर्च')
    `).run(
      orgAId, orgAMemberId, orgAPresId,
      orgAId, orgAMemberId, orgAPresId,
      orgAId, orgAMemberId, orgAPresId,
      orgAId, orgAPresId
    );

    const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-09`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();

    assert.strictEqual(json.data.inflows.bishiCollection, 1200);
    assert.strictEqual(json.data.inflows.loanRepayments, 800);
    assert.strictEqual(json.data.inflows.totalInflow, 2000); // 1200 + 800
    assert.strictEqual(json.data.outflows.loanDisbursements, 4000);
    assert.strictEqual(json.data.outflows.expenses, 350);
    assert.strictEqual(json.data.outflows.totalOutflow, 4350); // 4000 + 350
    assert.strictEqual(json.data.netMovement, -2350); // 2000 - 4350
    assert.strictEqual(json.data.transactionCount, 4);

    // Verify Marathi mappings in transaction list
    const types = json.data.transactions.map((t: any) => ({ type: t.transactionType, mr: t.transactionTypeMarathi }));
    assert.ok(types.some((t: any) => t.type === 'BISHI_PAYMENT' && t.mr === 'मासिक बीसी जमा'));
    assert.ok(types.some((t: any) => t.type === 'LOAN_REPAYMENT' && t.mr === 'कर्ज परतफेड'));
    assert.ok(types.some((t: any) => t.type === 'LOAN_DISBURSED' && t.mr === 'कर्ज वितरण'));
    assert.ok(types.some((t: any) => t.type === 'EXPENSE' && t.mr === 'मंडळ खर्च'));
  });

  it('18. Route verification: Correct route /api/reports/monthly-statement is active (200), erroneous double prefix returns 404', async () => {
    // Valid registered route:
    const validRes = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-09`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(validRes.status, 200);

    // Double prefix route:
    const badRes = await fetch(`${baseUrl}/api/api/reports/monthly-statement?monthYear=2026-09`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(badRes.status, 404);
    const badJson = await badRes.json();
    assert.strictEqual(badJson.error, 'मागणी केलेला मार्ग उपलब्ध नाही (API route not found)');
  });

  it('19. Financial ledger immutability: Cancelled transactions are strictly excluded from report totals', async () => {
    db.prepare(`
      INSERT INTO financial_transactions (
        id, organization_id, member_id, actor_id, transaction_type, reference_id,
        transaction_number, amount, payment_method, transaction_date, status, notes
      ) VALUES 
      ('cat-cancelled', ?, ?, ?, 'BISHI_PAYMENT', 'bishi-ref-canc', 'TXN-20260920-99', 99999, 'CASH', '2026-09-20', 'CANCELLED', 'रद्द झालेला हप्ता')
    `).run(orgAId, orgAMemberId, orgAPresId);

    const res = await fetch(`${baseUrl}/api/reports/monthly-statement?monthYear=2026-09`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    const json = await res.json();
    // Bishi collection must still be exactly 1200, NOT 1200 + 99999
    assert.strictEqual(json.data.inflows.bishiCollection, 1200);
    assert.strictEqual(json.data.transactions.some((t: any) => t.id === 'cat-cancelled'), false);
  });

  it('20. Empty month CSV export produces valid headers and 0 data rows without errors or fake data', async () => {
    const res = await fetch(`${baseUrl}/api/reports/export-audit?monthYear=2024-01`, {
      headers: { Authorization: `Bearer ${orgAPresToken}` },
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    const lines = text.trim().split('\r\n');
    // Header only (1 line)
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes('व्यवहार क्र. (Transaction No)'));
  });
});
