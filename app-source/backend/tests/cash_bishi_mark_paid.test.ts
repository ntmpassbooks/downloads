process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_cash_bishi_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;
const TEST_DB = './data/ntm_cash_bishi_test.sqlite';

before(async () => {
  closeDatabase();
  if (fs.existsSync(TEST_DB)) {
    try { fs.unlinkSync(TEST_DB); } catch {}
  }
  runMigrations();
  const db = getDatabase();
  db.exec('DELETE FROM audit_logs;');
  db.exec('DELETE FROM expenses;');
  db.exec('DELETE FROM loan_repayments;');
  db.exec('DELETE FROM loans;');
  db.exec('DELETE FROM financial_transactions;');
  db.exec('DELETE FROM bishi_records;');
  db.exec('DELETE FROM bishi_configs;');
  db.exec('DELETE FROM device_tokens;');
  db.exec('DELETE FROM notifications;');
  db.exec('DELETE FROM payment_orders;');
  db.exec('DELETE FROM payment_configs;');
  db.exec('DELETE FROM sessions;');
  db.exec('DELETE FROM users;');
  db.exec('DELETE FROM organizations;');

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
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeDatabase();
  if (fs.existsSync(TEST_DB)) {
    try { fs.unlinkSync(TEST_DB); } catch {}
  }
});

describe('NTM Passbook — Cash Bishi Mark Paid / जमा झाले Verification Suite', () => {
  let presToken: string;
  let presId: string;
  let treasToken: string;
  let treasId: string;
  let memberToken: string;
  let memberId: string;
  let mandalId: string;

  let otherPresToken: string;
  let otherMandalId: string;

  let bishiRecord1Id: string;
  let bishiRecord2Id: string;
  let bishiConfigId: string;

  test('0. Setup Organizations, President, Treasurer, Members, and Bishi Cycle', async () => {
    const regRes = await fetch(baseUrl + '/api/auth/register-president', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'श्री गणेश तरुण मंडळ',
        fullName: 'गणेश अध्यक्ष',
        phone: '9822100001',
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    const regData = (await regRes.json()) as any;
    assert.equal(regRes.status, 201);
    presToken = regData.token;
    presId = regData.user.id;
    mandalId = regData.organization.id;

    const addTreasRes = await fetch(baseUrl + '/api/members', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({
        fullName: 'गणेश खजिनदार',
        phone: '9822100002',
        initialPin: '1234',
        role: 'TREASURER',
      }),
    });
    const treasData = (await addTreasRes.json()) as any;
    assert.equal(addTreasRes.status, 201);
    treasId = treasData.data.id;

    const treasLoginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822100002', pin: '1234' }),
    });
    const treasLoginData = (await treasLoginRes.json()) as any;
    assert.equal(treasLoginRes.status, 200);
    treasToken = treasLoginData.token;

    const addMemberRes = await fetch(baseUrl + '/api/members', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({
        fullName: 'रमेश सदस्य',
        phone: '9822100003',
        initialPin: '1234',
      }),
    });
    const memData = (await addMemberRes.json()) as any;
    assert.equal(addMemberRes.status, 201);
    memberId = memData.data.id;

    const memLoginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822100003', pin: '1234' }),
    });
    const memLoginData = (await memLoginRes.json()) as any;
    assert.equal(memLoginRes.status, 200);
    memberToken = memLoginData.token;

    // Configure Bishi for Member 1 (POST /api/members/:id/bishi-config)
    const bishiCfgRes = await fetch(baseUrl + '/api/members/' + memberId + '/bishi-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({ monthlyAmount: 1000, dueDay: 10 }),
    });
    const cfgData = (await bishiCfgRes.json()) as any;
    assert.equal(bishiCfgRes.status, 200);
    bishiConfigId = cfgData.data.id;

    // Generate Bishi Cycle for 2026-09
    const cycleRes = await fetch(baseUrl + '/api/bishi/generate-cycle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({ monthYear: '2026-09' }),
    });
    assert.equal(cycleRes.status, 200);

    // Generate Bishi Cycle for 2026-10 (for second test)
    const cycle2Res = await fetch(baseUrl + '/api/bishi/generate-cycle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({ monthYear: '2026-10' }),
    });
    assert.equal(cycle2Res.status, 200);

    const db = getDatabase();
    const rec1 = db.prepare("SELECT id FROM bishi_records WHERE member_id = ? AND month_year = '2026-09'").get(memberId) as any;
    const rec2 = db.prepare("SELECT id FROM bishi_records WHERE member_id = ? AND month_year = '2026-10'").get(memberId) as any;
    assert.ok(rec1, 'Cycle 1 record must exist');
    assert.ok(rec2, 'Cycle 2 record must exist');
    bishiRecord1Id = rec1.id;
    bishiRecord2Id = rec2.id;

    const regBRes = await fetch(baseUrl + '/api/auth/register-president', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'एकता मित्र मंडळ',
        fullName: 'एकता अध्यक्ष',
        phone: '9822100099',
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    const regBData = (await regBRes.json()) as any;
    assert.equal(regBRes.status, 201);
    otherPresToken = regBData.token;
    otherMandalId = regBData.organization.id;
  });

  test('1. CASH MARK PAID — PRESIDENT: Records Cash Bishi successfully', async () => {
    const res = await fetch(baseUrl + '/api/bishi/' + bishiRecord1Id + '/cash-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({
        amount: 1000,
        notes: 'अध्यक्षांनी रोख जमा घेतली',
      }),
    });
    const body = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    assert.equal(body.data.amount, 1000);
    assert.equal(body.data.paymentMethod, 'CASH');
    assert.equal(body.data.transactionType, 'BISHI_PAYMENT');
    assert.equal(body.data.status, 'CONFIRMED');
    assert.equal(body.data.actorId, presId);
  });

  test('2. CASH → BISHI VERIFIED: bishi_records updated to PAID with CASH method', async () => {
    const db = getDatabase();
    const rec = db.prepare('SELECT * FROM bishi_records WHERE id = ?').get(bishiRecord1Id) as any;
    assert.equal(rec.status, 'PAID');
    assert.equal(rec.payment_method, 'CASH');
    assert.equal(rec.paid_amount, 1000);
    assert.ok(rec.paid_date);
    assert.ok(rec.payment_transaction_id);
  });

  test('3. CASH → LEDGER VERIFIED: financial_transactions contains CONFIRMED entry with who recorded it', async () => {
    const db = getDatabase();
    const txn = db.prepare("SELECT * FROM financial_transactions WHERE reference_id = ? AND transaction_type = 'BISHI_PAYMENT'").get(bishiRecord1Id) as any;
    assert.ok(txn);
    assert.equal(txn.amount, 1000);
    assert.equal(txn.payment_method, 'CASH');
    assert.equal(txn.status, 'CONFIRMED');
    assert.equal(txn.actor_id, presId);
    assert.equal(txn.member_id, memberId);
    assert.equal(txn.organization_id, mandalId);
    assert.ok(txn.transaction_number.startsWith('TXN-'));
  });

  test('4. CASH → RECEIPT VERIFIED: Official receipt generated and retrievable', async () => {
    const db = getDatabase();
    const txn = db.prepare('SELECT id FROM financial_transactions WHERE reference_id = ?').get(bishiRecord1Id) as any;

    const memRes = await fetch(baseUrl + '/api/transactions/' + txn.id + '/receipt', {
      headers: { Authorization: 'Bearer ' + memberToken },
    });
    const memReceipt = (await memRes.json()) as any;
    assert.equal(memRes.status, 200);
    assert.equal(memReceipt.success, true);
    assert.equal(memReceipt.data.amount, 1000);
    assert.equal(memReceipt.data.paymentMethod, 'CASH');
    assert.equal(memReceipt.data.recordedBy.role, 'PRESIDENT');

    const treasRes = await fetch(baseUrl + '/api/transactions/' + txn.id + '/receipt', {
      headers: { Authorization: 'Bearer ' + treasToken },
    });
    assert.equal(treasRes.status, 200);
  });

  test('5. CASH → PASSBOOK VERIFIED: Member passbook includes Cash transaction and updates total', async () => {
    const res = await fetch(baseUrl + '/api/passbook/me', {
      headers: { Authorization: 'Bearer ' + memberToken },
    });
    const body = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.totalPaid, 1000);
    assert.ok(body.data.transactions.some((t: any) => t.referenceId === bishiRecord1Id && t.paymentMethod === 'CASH'));
  });

  test('6. CASH → NOTIFICATION VERIFIED: Member and Admins receive real notification', async () => {
    const db = getDatabase();
    const memNotifs = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'BISHI_PAID'").all(memberId) as any[];
    assert.ok(memNotifs.length > 0);
    assert.ok(memNotifs[0].message.includes('₹1000'));
    assert.ok(memNotifs[0].message.includes('रोख जमा'));

    const adminNotifs = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'BISHI_PAID'").all(treasId) as any[];
    assert.ok(adminNotifs.length > 0);
  });

  test('7. CASH → AUDIT VERIFIED: audit_logs records BISHI_PAYMENT_RECORDED with actor identity', async () => {
    const db = getDatabase();
    const log = db.prepare("SELECT * FROM audit_logs WHERE action = 'BISHI_PAYMENT_RECORDED' AND user_id = ?").get(presId) as any;
    assert.ok(log);
    const details = JSON.parse(log.details);
    assert.equal(details.amount, 1000);
    assert.equal(details.actorRole, 'PRESIDENT');
    assert.equal(details.memberId, memberId);
  });

  test('8. CASH MARK PAID — TREASURER: Treasurer can Mark Paid an actual cash Bishi payment', async () => {
    const res = await fetch(baseUrl + '/api/bishi/' + bishiRecord2Id + '/cash-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + treasToken,
      },
      body: JSON.stringify({
        amount: 1000,
        notes: 'खजिनदारांनी रोख जमा घेतली',
      }),
    });
    const body = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.amount, 1000);
    assert.equal(body.data.paymentMethod, 'CASH');
    assert.equal(body.data.actorId, treasId);

    const db = getDatabase();
    const txn = db.prepare('SELECT actor_id FROM financial_transactions WHERE id = ?').get(body.data.id) as any;
    assert.equal(txn.actor_id, treasId);
  });

  test('9. MEMBER MARK PAID BLOCKED: Member cannot call cash-payment API (403 Forbidden)', async () => {
    const res = await fetch(baseUrl + '/api/bishi/' + bishiRecord2Id + '/cash-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + memberToken,
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.equal(res.status, 403);
  });

  test('10. ONLINE MANUAL MARK PAID BLOCKED: No manual confirmation bypass endpoint exists', async () => {
    const res = await fetch(baseUrl + '/api/payments/manual-confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({ bishiRecordId: bishiRecord1Id }),
    });
    assert.equal(res.status, 404);

    const treasRes = await fetch(baseUrl + '/api/payments/manual-confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + treasToken,
      },
      body: JSON.stringify({ bishiRecordId: bishiRecord1Id }),
    });
    assert.equal(treasRes.status, 404);
  });

  test('11. DUPLICATE CASH PAYMENT BLOCKED: Already paid Bishi record rejected with 409 Conflict', async () => {
    const res = await fetch(baseUrl + '/api/bishi/' + bishiRecord1Id + '/cash-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    const body = (await res.json()) as any;
    assert.equal(res.status, 409);
    assert.match(body.error, /आधीच भरला गेला आहे/);
  });

  test('12. WRONG AMOUNT BLOCKED: Cash payment with incorrect amount rejected with 400 Bad Request', async () => {
    const db = getDatabase();
    const recId = 'test-rec-11';
    db.prepare("INSERT INTO bishi_records (id, organization_id, member_id, bishi_config_id, month_year, expected_amount, due_date, status) VALUES (?, ?, ?, ?, '2026-11', 1000, '2026-11-10', 'PENDING')").run(recId, mandalId, memberId, bishiConfigId);

    const res = await fetch(baseUrl + '/api/bishi/' + recId + '/cash-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presToken,
      },
      body: JSON.stringify({ amount: 500 }),
    });
    const body = (await res.json()) as any;
    assert.equal(res.status, 400);
    assert.match(body.error, /₹1000/);
  });

  test('13. CROSS-MANDAL CASH PAYMENT BLOCKED: President of Mandal B cannot record cash for Mandal A record', async () => {
    const res = await fetch(baseUrl + '/api/bishi/test-rec-11/cash-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + otherPresToken,
      },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.equal(res.status, 404);
  });
});
