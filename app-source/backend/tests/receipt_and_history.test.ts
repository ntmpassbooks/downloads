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

const NTM_ORG_ID = 'org-ntm-001';
const JHM_ORG_ID = 'org-jhm-002';
const NTM_MEMBER_1_ID = 'usr-ntm-member-01';
let ntmMember2Id = '';
const JHM_MEMBER_ID = 'usr-jhm-member-02';

let confirmedTxnId = '';
let confirmedTxnNumber = '';
let pendingBishiRecordId = '';

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

  // Setup Bishi for Member 1
  await fetch(`${baseUrl}/api/members/${NTM_MEMBER_1_ID}/bishi-config`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${presidentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monthlyAmount: 2000, dueDay: 10 }),
  });

  // Generate 2 cycles: 2026-06 and 2026-07
  await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${presidentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monthYear: '2026-06' }),
  });

  await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${presidentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monthYear: '2026-07' }),
  });

  // Query records
  const recsRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_1_ID}/bishi-records`, {
    headers: { Authorization: `Bearer ${presidentToken}` },
  });
  const recs = (await recsRes.json()).data;
  const cycleJune = recs.find((r: any) => r.monthYear === '2026-06');
  const cycleJuly = recs.find((r: any) => r.monthYear === '2026-07');

  pendingBishiRecordId = cycleJuly.id;

  // Pay 2026-06 to create confirmed transaction
  const payRes = await fetch(`${baseUrl}/api/bishi/${cycleJune.id}/cash-payment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${treasurerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: 2000, notes: 'रोख जमा पावती चाचणी' }),
  });
  const payData = await payRes.json();
  confirmedTxnId = payData.data.id;
  confirmedTxnNumber = payData.data.transactionNumber;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeDatabase();
});

describe('Phase 1E: Real Receipts + Payment History + Receipt Verification Tests', () => {
  // 1. Receipt available for successful cash Bishi transaction
  test('1. Receipt available for successful cash Bishi transaction', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data);
    assert.strictEqual(body.data.transactionId, confirmedTxnId);
    assert.strictEqual(body.data.status, 'CONFIRMED');
  });

  // 2. Receipt unavailable for pending Bishi / non-existent transaction
  test('2. Receipt unavailable for pending Bishi or non-existent transaction', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${pendingBishiRecordId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  // 3. Receipt data matches real ledger transaction
  test('3. Receipt data matches real ledger transaction exactly', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const { data: receipt } = await res.json();

    assert.strictEqual(receipt.amount, 2000);
    assert.strictEqual(receipt.paymentMethod, 'CASH');
    assert.strictEqual(receipt.bishiMonth, '2026-06');
    assert.strictEqual(receipt.organization.name, 'नवतरुण मित्र मंडळ');
    assert.strictEqual(receipt.organization.code, 'NTM01');
    assert.strictEqual(receipt.member.id, NTM_MEMBER_1_ID);
    assert.strictEqual(receipt.member.fullName, 'राहुल पाटील');
    assert.strictEqual(receipt.recordedBy.role, 'TREASURER');
    assert.strictEqual(receipt.recordedBy.fullName, 'सचिन शिंदे');
  });

  // 4. Receipt transaction ID matches ledger transaction ID
  test('4. Receipt transaction ID matches ledger transaction ID', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const { data: receipt } = await res.json();
    assert.strictEqual(receipt.transactionId, confirmedTxnId);
    assert.strictEqual(receipt.transactionNumber, confirmedTxnNumber);
  });

  // 5. Receipt cannot be modified through normal API
  test('5. Receipt cannot be modified through normal API (PUT / PATCH rejected)', async () => {
    const putRes = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 9999 }),
    });
    assert.ok(putRes.status === 404 || putRes.status === 405);

    const patchRes = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 9999 }),
    });
    assert.ok(patchRes.status === 404 || patchRes.status === 405);
  });

  // 6. Receipt cannot be deleted through normal API
  test('6. Receipt cannot be deleted through normal API (DELETE rejected)', async () => {
    const delRes = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.ok(delRes.status === 404 || delRes.status === 405);
  });

  // 7. Receipt number is unique
  test('7. Receipt number is unique across different transactions', async () => {
    // Pay second cycle 2026-07 to produce a second transaction
    const pay2Res = await fetch(`${baseUrl}/api/bishi/${pendingBishiRecordId}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 2000 }),
    });
    const pay2Data = await pay2Res.json();
    const txn2Id = pay2Data.data.id;

    const r1Res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const r2Res = await fetch(`${baseUrl}/api/transactions/${txn2Id}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });

    const r1 = (await r1Res.json()).data;
    const r2 = (await r2Res.json()).data;

    assert.notStrictEqual(r1.receiptNumber, r2.receiptNumber);
    assert.notStrictEqual(r1.transactionNumber, r2.transactionNumber);
  });

  // 8. Receipt number is immutable and prefixed with RCP-
  test('8. Receipt number is immutable and follows system RCP- format', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const { data: receipt } = await res.json();
    assert.ok(receipt.receiptNumber.startsWith('RCP-'));
    assert.strictEqual(receipt.receiptNumber, `RCP-${confirmedTxnNumber.replace(/^TXN-/, '')}`);
  });

  // 9. Member can view own receipt
  test('9. Member can view own receipt', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.member.id, NTM_MEMBER_1_ID);
  });

  // 10. Member cannot view another member's receipt (IDOR rejection 403)
  test('10. Member cannot view another members receipt (IDOR rejection 403)', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.error, /परवानगी नाही|Cannot view/);
  });

  // 11. Member can view own payment history
  test('11. Member can view own payment history via /api/passbook/me', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.member.id, NTM_MEMBER_1_ID);
    assert.ok(body.data.totalTransactions >= 1);
    assert.ok(body.data.transactions.some((t: any) => t.id === confirmedTxnId));
  });

  // 12. Member cannot view another member's payment history
  test('12. Member cannot view another members payment history (403 IDOR rejection)', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/member/${NTM_MEMBER_1_ID}`, {
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    assert.strictEqual(res.status, 403);
  });

  // 13. Treasurer can access authorized same-mandal receipts
  test('13. Treasurer can access authorized same-mandal receipts', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.transactionId, confirmedTxnId);
  });

  // 14. Treasurer cannot access another mandal's receipt
  test('14. Treasurer cannot access another mandals receipt (404/403 barrier)', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${jhmTreasurerToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  // 15. President can access same-mandal receipts
  test('15. President can access same-mandal receipts', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.transactionId, confirmedTxnId);
  });

  // 16. President cannot access another mandal's receipt
  test('16. President cannot access another mandals receipt (404/403 barrier)', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  // 17. Receipt amount always matches authoritative transaction
  test('17. Receipt amount always matches authoritative ledger transaction', async () => {
    const db = getDatabase();
    const txn = db.prepare('SELECT amount FROM financial_transactions WHERE id = ?').get(confirmedTxnId) as any;

    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const receipt = (await res.json()).data;
    assert.strictEqual(receipt.amount, txn.amount);
  });

  // 18. Payment history comes from real ledger
  test('18. Payment history comes directly from financial_transactions table', async () => {
    const db = getDatabase();
    const count = db
      .prepare("SELECT COUNT(*) as c FROM financial_transactions WHERE member_id = ? AND status = 'CONFIRMED'")
      .get(NTM_MEMBER_1_ID) as any;

    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const body = await res.json();
    assert.strictEqual(body.data.transactions.length, count.c);
  });

  // 19. No duplicate transaction/receipt created
  test('19. No duplicate transaction created for already paid record', async () => {
    const recsRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_1_ID}/bishi-records`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const recs = (await recsRes.json()).data;
    const juneRecord = recs.find((r: any) => r.monthYear === '2026-06');

    const doublePayRes = await fetch(`${baseUrl}/api/bishi/${juneRecord.id}/cash-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 2000 }),
    });
    assert.strictEqual(doublePayRes.status, 409);
  });

  // 20. Historical transaction remains unchanged
  test('20. Historical transaction remains unchanged upon query', async () => {
    const r1 = await (await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    })).json();

    const r2 = await (await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    })).json();

    assert.deepStrictEqual(r1.data, r2.data);
  });

  // 21. No fake/default financial data appears
  test('21. Zero fake financial data in receipt response', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/${confirmedTxnId}/receipt`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const { data: receipt } = await res.json();
    assert.strictEqual(receipt.amount, 2000);
    assert.strictEqual(receipt.paymentMethod, 'CASH');
    assert.ok(!JSON.stringify(receipt).includes('demo'));
    assert.ok(!JSON.stringify(receipt).includes('fake'));
  });

  // 22. Empty history produces clean empty state
  test('22. Empty history produces clean empty state with zero dummy items', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${member2Token}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.totalPaid, 0);
    assert.strictEqual(body.data.totalTransactions, 0);
    assert.deepStrictEqual(body.data.transactions, []);
  });

  // 23. Existing Bishi payment remains correct
  test('23. Existing Bishi payment remains correct', async () => {
    const res = await fetch(`${baseUrl}/api/passbook/me`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const body = await res.json();
    const juneTxn = body.data.transactions.find((t: any) => t.id === confirmedTxnId);
    assert.ok(juneTxn);
    assert.strictEqual(juneTxn.bishiMonth, '2026-06');
    assert.strictEqual(juneTxn.amount, 2000);
  });

  // 24. Bishi paid status remains consistent with ledger
  test('24. Bishi record status remains PAID and references transaction ID', () => {
    const db = getDatabase();
    const bishi = db
      .prepare('SELECT * FROM bishi_records WHERE payment_transaction_id = ?')
      .get(confirmedTxnId) as any;
    assert.ok(bishi);
    assert.strictEqual(bishi.status, 'PAID');
    assert.strictEqual(bishi.paid_amount, 2000);
  });

  // 25. Audit event remains intact
  test('25. Audit event BISHI_PAYMENT_RECORDED remains intact with full details', () => {
    const db = getDatabase();
    const audit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'BISHI_PAYMENT_RECORDED' ORDER BY created_at DESC LIMIT 1")
      .get() as any;
    assert.ok(audit);
    const details = JSON.parse(audit.details);
    assert.strictEqual(details.amount, 2000);
    assert.ok(details.transactionId);
  });
});
