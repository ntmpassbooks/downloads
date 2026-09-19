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
let secondMandalPresidentToken = '';

const NTM_ORG_ID = 'org-ntm-001';
const JHM_ORG_ID = 'org-jhm-002';
const NTM_MEMBER_ID = 'usr-ntm-member-01';
const JHM_MEMBER_ID = 'usr-jhm-member-02';

let bishiRecordId = '';
let bishiRecordId2 = '';

before(async () => {
  seedDatabase();
  const db = getDatabase();

  // Create President for JHM02 (Mandal 2) to test cross-tenant barriers
  const { hash, salt } = await import('../src/modules/auth/auth.service.js').then((m) =>
    m.AuthService.hashPin('1234')
  );
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
  const presData = await presRes.json();
  presidentToken = presData.token;

  // Login as NTM Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  const treasData = await treasRes.json();
  treasurerToken = treasData.token;

  // Login as NTM Member
  const memRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  const memData = await memRes.json();
  memberToken = memData.token;

  // Login as JHM President
  const jhmPresRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543290', pin: '1234' }),
  });
  const jhmPresData = await jhmPresRes.json();
  secondMandalPresidentToken = jhmPresData.token;

  // Setup: Configure Bishi for NTM Member and generate monthly cycle
  await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${presidentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monthlyAmount: 1500, dueDay: 10 }),
  });

  // Generate cycle for 2026-08 and 2026-09
  await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${presidentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monthYear: '2026-08' }),
  });
  await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${presidentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monthYear: '2026-09' }),
  });

  const recs = db
    .prepare('SELECT id, month_year FROM bishi_records WHERE member_id = ? ORDER BY month_year ASC')
    .all(NTM_MEMBER_ID) as any[];

  bishiRecordId = recs[0].id; // 2026-08
  bishiRecordId2 = recs[1].id; // 2026-09
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
});

describe('NTM Passbook — Phase 1D Cash Payment & Ledger Tests', () => {
  test('1. Member cannot record cash payment (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/bishi/${bishiRecordId}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${memberToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1500 }),
    });
    assert.strictEqual(res.status, 403);
  });

  test('2. Cross-mandal payment rejected (404/403)', async () => {
    // President of JHM attempting to pay NTM member's record
    const res = await fetch(`${baseUrl}/api/bishi/${bishiRecordId}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondMandalPresidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1500 }),
    });
    assert.ok(res.status === 404 || res.status === 403);
  });

  test('3. Payment with mismatched amount rejected with 400', async () => {
    // Expected is 1500, attempt with 1000 or 2000
    const res = await fetch(`${baseUrl}/api/bishi/${bishiRecordId}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  test('4. Treasurer successfully records real cash payment with exact amount', async () => {
    const res = await fetch(`${baseUrl}/api/bishi/${bishiRecordId}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1500, notes: 'ऑगस्ट हप्ता रोख जमा' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.amount, 1500);
    assert.strictEqual(body.data.paymentMethod, 'CASH');
    assert.strictEqual(body.data.status, 'CONFIRMED');
    assert.ok(body.data.transactionNumber.startsWith('TXN-'));
    assert.ok(body.data.id);
  });

  test('5. Bishi record status transitions to PAID atomically in real database', () => {
    const db = getDatabase();
    const row = db
      .prepare('SELECT status, paid_amount, payment_method, payment_transaction_id, paid_date FROM bishi_records WHERE id = ?')
      .get(bishiRecordId) as any;

    assert.strictEqual(row.status, 'PAID');
    assert.strictEqual(row.paid_amount, 1500);
    assert.strictEqual(row.payment_method, 'CASH');
    assert.ok(row.payment_transaction_id);
    assert.ok(row.paid_date);
  });

  test('6. Paid Bishi record cannot be paid again (409 Conflict)', async () => {
    const res = await fetch(`${baseUrl}/api/bishi/${bishiRecordId}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1500 }),
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  test('7. Database Uniqueness: Direct duplicate insert on financial_transactions fails', () => {
    const db = getDatabase();
    assert.throws(() => {
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type,
          reference_id, transaction_number, amount, payment_method, status
        ) VALUES ('fake-id-dup', ?, ?, 'usr-ntm-treasurer-01', 'BISHI_PAYMENT', ?, 'TXN-DUP-01', 1500, 'CASH', 'CONFIRMED')
      `).run(NTM_ORG_ID, NTM_MEMBER_ID, bishiRecordId);
    }, /UNIQUE constraint failed/);
  });

  test('8. President can record cash payment for eligible pending record', async () => {
    // Record 2 (2026-09) is still PENDING
    const res = await fetch(`${baseUrl}/api/bishi/${bishiRecordId2}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1500 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.amount, 1500);
    assert.strictEqual(body.data.paymentMethod, 'CASH');
  });

  test('9. Audit Log recorded BISHI_PAYMENT_RECORDED with full transaction metadata', () => {
    const db = getDatabase();
    const logs = db
      .prepare("SELECT action, details FROM audit_logs WHERE organization_id = ? AND action = 'BISHI_PAYMENT_RECORDED'")
      .all(NTM_ORG_ID) as any[];

    assert.ok(logs.length >= 2);
    const detail = JSON.parse(logs[0].details);
    assert.strictEqual(detail.amount, 1500);
    assert.ok(detail.transactionNumber);
    assert.ok(detail.bishiRecordId);
  });

  test('10. Immutability: No user APIs exist to edit or delete confirmed transactions', async () => {
    // PATCH /api/ledger/some-id -> 404
    const patchRes = await fetch(`${baseUrl}/api/ledger/fake-id`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 500 }),
    });
    assert.strictEqual(patchRes.status, 404);

    // DELETE /api/ledger/some-id -> 404
    const delRes = await fetch(`${baseUrl}/api/ledger/fake-id`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(delRes.status, 404);
  });
});

describe('NTM Passbook — Phase 1D Digital Passbook & Ledger Tests', () => {
  test('11. Member can view own digital passbook via /api/passbook/me', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.member.id, NTM_MEMBER_ID);
    assert.strictEqual(body.data.totalPaid, 3000); // 1500 + 1500
    assert.strictEqual(body.data.totalTransactions, 2);
    assert.strictEqual(body.data.transactions[0].paymentMethod, 'CASH');
    assert.strictEqual(body.data.transactions[0].transactionType, 'BISHI_PAYMENT');
  });

  test('12. Member viewing own passbook via member ID endpoint succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/member/${NTM_MEMBER_ID}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.totalPaid, 3000);
  });

  test('13. Member cannot view another member passbook (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/member/usr-ntm-treasurer-01`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  test('14. Treasurer can view authorized mandal member passbook', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/member/${NTM_MEMBER_ID}`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.totalTransactions, 2);
  });

  test('15. President can view mandal ledger via /api/ledger', async () => {
    const res = await fetch(`${baseUrl}/api/ledger`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.summary.totalFunds, 3000);
    assert.strictEqual(body.data.summary.totalTransactions, 2);
    assert.strictEqual(body.data.transactions.length, 2);
  });

  test('16. Non-President/Treasurer cannot view mandal ledger (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/ledger`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  test('17. Cross-mandal passbook access returns 404/403', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/member/${JHM_MEMBER_ID}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.ok(res.status === 404 || res.status === 403);
  });

  test('18. Deterministic Ordering: Transactions ordered by date DESC, created_at DESC, id DESC', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const body = await res.json();
    const txns = body.data.transactions;
    assert.ok(txns.length >= 2);
    assert.ok(new Date(txns[0].transactionDate) >= new Date(txns[1].transactionDate));
  });

  test('19. Dynamic Balance Calculation: Zero hardcoded total funds in database', () => {
    const db = getDatabase();
    const calculated = db
      .prepare('SELECT SUM(amount) as sum FROM financial_transactions WHERE organization_id = ?')
      .get(NTM_ORG_ID) as any;
    assert.strictEqual(calculated.sum, 3000);
  });

  test('20. Empty Passbook State: Member with no payments returns empty transactions array', async () => {
    // JHM Member has no transactions
    const res = await fetch(`${baseUrl}/api/passbook/member/${JHM_MEMBER_ID}`, {
      headers: { Authorization: `Bearer ${secondMandalPresidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.totalPaid, 0);
    assert.strictEqual(body.data.totalTransactions, 0);
    assert.deepStrictEqual(body.data.transactions, []);
  });
});
