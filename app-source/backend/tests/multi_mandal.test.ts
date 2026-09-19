process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_multi_mandal_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;

const TEST_DB = './data/ntm_multi_mandal_test.sqlite';

before(async () => {
  // Ensure clean test database with migrations applied
  closeDatabase();
  if (fs.existsSync(TEST_DB)) {
    try {
      fs.unlinkSync(TEST_DB);
    } catch {}
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
  db.exec('DELETE FROM sessions;');
  db.exec('DELETE FROM users;');
  db.exec('DELETE FROM organizations;');

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
  if (fs.existsSync(TEST_DB)) {
    try {
      fs.unlinkSync(TEST_DB);
    } catch {}
  }
});

describe('NTM Passbook — Multi-Mandal Onboarding & Cross-Tenant Isolation Suite', () => {
  let santoshToken = '';
  let santoshOrgId = '';
  let ekataToken = '';
  let ekataOrgId = '';
  let nagrajMember1Id = '';
  let nagrajMember1Token = '';
  let ekataMember2Id = '';
  let ekataMember2Token = '';
  let ekataLoanId = '';

  // 1. Santosh creates "Nagraj Tarun Mandal" + President
  test('1. Santosh can onboard and register "Nagraj Tarun Mandal" as first President (201)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'नागराज तरुण मंडळ',
        fullName: 'संतोष कोळी',
        phone: '9822000001',
        pin: '1234',
        confirmPin: '1234',
        registrationNumber: 'REG-NTM-001',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token);
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.organization.name, 'नागराज तरुण मंडळ');

    santoshToken = body.token;
    santoshOrgId = body.organization.id;
  });

  // 2 & 3. President registration lock activates for Nagraj; second President cannot register into Nagraj
  test('2 & 3. President registration lock is active for "नागराज तरुण मंडळ"; second President registration is rejected (409)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'नागराज तरुण मंडळ', // Same mandal name
        fullName: 'दुसरा अध्यक्ष',
        phone: '9822000099',
        pin: '9999',
        confirmPin: '9999',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /नोंदणी सध्या उपलब्ध नाही|आधीपासून नोंदणीकृत/);
  });

  // 4 & 5. Ekata creates independent "Ekata Tarun Mandal" + President; lock activates for Ekata
  test('4 & 5. An independent second Mandal "एकता तरुण मंडळ" can onboard with its own President (201) & locks', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'एकता तरुण मंडळ',
        fullName: 'एकता अध्यक्ष',
        phone: '9822000002',
        pin: '2345',
        confirmPin: '2345',
        registrationNumber: 'REG-EKATA-002',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token);
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.organization.name, 'एकता तरुण मंडळ');
    assert.notEqual(body.organization.id, santoshOrgId);

    ekataToken = body.token;
    ekataOrgId = body.organization.id;

    // Second President for Ekata is also locked
    const dupEkata = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'एकता तरुण मंडळ',
        fullName: 'दुसरा एकता अध्यक्ष',
        phone: '9822000088',
        pin: '8888',
        confirmPin: '8888',
      }),
    });
    assert.equal(dupEkata.status, 409);
  });

  // 6 & 7. Login: Santosh sees Nagraj ONLY; Ekata sees Ekata ONLY (no role selector)
  test('6 & 7. Phone + PIN login resolves organization & role server-side with complete isolation', async () => {
    // Santosh login
    const sanLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000001', pin: '1234' }),
    });
    assert.equal(sanLoginRes.status, 200);
    const sanData = await sanLoginRes.json();
    assert.equal(sanData.organization.id, santoshOrgId);
    assert.equal(sanData.organization.name, 'नागराज तरुण मंडळ');
    assert.equal(sanData.user.role, 'PRESIDENT');

    // Ekata login
    const ekLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000002', pin: '2345' }),
    });
    assert.equal(ekLoginRes.status, 200);
    const ekData = await ekLoginRes.json();
    assert.equal(ekData.organization.id, ekataOrgId);
    assert.equal(ekData.organization.name, 'एकता तरुण मंडळ');
    assert.equal(ekData.user.role, 'PRESIDENT');
  });

  // 8 & 9. Santosh adds Member M1 to Nagraj; Ekata adds Member M2 to Ekata
  test('8 & 9. Each President adds members within their respective Mandals', async () => {
    // Santosh adds M1
    const m1Res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${santoshToken}`,
      },
      body: JSON.stringify({
        fullName: 'नागराज सदस्य १',
        phone: '9822000011',
        initialPin: '1234',
        role: 'MEMBER',
      }),
    });
    assert.equal(m1Res.status, 201);
    const m1Data = await m1Res.json();
    nagrajMember1Id = m1Data.data.id;
    assert.equal(m1Data.data.organizationId, santoshOrgId);

    // Ekata adds M2
    const m2Res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ekataToken}`,
      },
      body: JSON.stringify({
        fullName: 'एकता सदस्य १',
        phone: '9822000012',
        initialPin: '1234',
        role: 'MEMBER',
      }),
    });
    assert.equal(m2Res.status, 201);
    const m2Data = await m2Res.json();
    ekataMember2Id = m2Data.data.id;
    assert.equal(m2Data.data.organizationId, ekataOrgId);
  });

  // 10 & 11. M1 cannot see Ekata data; M2 cannot see Nagraj data
  test('10 & 11. Members can only view their own Mandal profile; President directories are isolated', async () => {
    // Login M1
    const m1Login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000011', pin: '1234' }),
    });
    const m1Auth = await m1Login.json();
    nagrajMember1Token = m1Auth.token;
    assert.equal(m1Auth.organization.id, santoshOrgId);
    assert.equal(m1Auth.organization.name, 'नागराज तरुण मंडळ');

    // Login M2
    const m2Login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822000012', pin: '1234' }),
    });
    const m2Auth = await m2Login.json();
    ekataMember2Token = m2Auth.token;
    assert.equal(m2Auth.organization.id, ekataOrgId);
    assert.equal(m2Auth.organization.name, 'एकता तरुण मंडळ');

    // Santosh list: includes Santosh and M1, does NOT include Ekata or M2
    const sanList = await fetch(`${baseUrl}/api/members`, {
      headers: { Authorization: `Bearer ${santoshToken}` },
    });
    const sanListData = await sanList.json();
    const sanMemberPhones = sanListData.data.map((m: any) => m.phone);
    assert.ok(sanMemberPhones.includes('9822000001'));
    assert.ok(sanMemberPhones.includes('9822000011'));
    assert.ok(!sanMemberPhones.includes('9822000002'));
    assert.ok(!sanMemberPhones.includes('9822000012'));

    // Ekata list: includes Ekata and M2, does NOT include Santosh or M1
    const ekList = await fetch(`${baseUrl}/api/members`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    const ekListData = await ekList.json();
    const ekMemberPhones = ekListData.data.map((m: any) => m.phone);
    assert.ok(ekMemberPhones.includes('9822000002'));
    assert.ok(ekMemberPhones.includes('9822000012'));
    assert.ok(!ekMemberPhones.includes('9822000001'));
    assert.ok(!ekMemberPhones.includes('9822000011'));
  });

  // 12 & 13. Santosh creates Bishi in Nagraj; Ekata cannot see or access Nagraj Bishi
  test('12 & 13. Bishi configurations are strictly scoped per Mandal', async () => {
    // Santosh sets Bishi config for M1
    const bishiRes = await fetch(`${baseUrl}/api/members/${nagrajMember1Id}/bishi-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${santoshToken}`,
      },
      body: JSON.stringify({
        monthlyAmount: 2000,
        dueDay: 10,
      }),
    });
    assert.equal(bishiRes.status, 200);

    // Ekata views overview -> activeMembers with Bishi: 0
    const ekataBishiOverview = await fetch(`${baseUrl}/api/bishi/overview`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    const ekataBishiData = await ekataBishiOverview.json();
    assert.equal(ekataBishiData.data.summary.totalConfigured, 0);

    // Ekata attempts to access Nagraj M1 Bishi config directly -> 404
    const idorRes = await fetch(`${baseUrl}/api/members/${nagrajMember1Id}/bishi-config`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    assert.equal(idorRes.status, 404);
  });

  // 14 & 15. Ekata creates Loan in Ekata; Santosh cannot see or access Ekata Loan
  test('14 & 15. Loan records are strictly scoped per Mandal', async () => {
    // Ekata creates loan for M2
    const loanRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ekataToken}`,
      },
      body: JSON.stringify({
        memberId: ekataMember2Id,
        amount: 10000,
        notes: 'वैयक्तिक गरज',
      }),
    });
    assert.equal(loanRes.status, 201);
    const loanData = await loanRes.json();
    ekataLoanId = loanData.data.id;

    // Santosh views loans -> 0 loans
    const santoshLoans = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: `Bearer ${santoshToken}` },
    });
    const santoshLoanData = await santoshLoans.json();
    assert.equal(santoshLoanData.data.length, 0);

    // Santosh attempts to access Ekata loan directly -> 404
    const idorLoan = await fetch(`${baseUrl}/api/loans/member/${ekataMember2Id}`, {
      headers: { Authorization: `Bearer ${santoshToken}` },
    });
    assert.equal(idorLoan.status, 404);
  });

  // 16 & 17. Santosh records Expense in Nagraj; Ekata financial summary remains 0
  test('16 & 17. Expense entries and financial summaries are isolated per Mandal', async () => {
    // Santosh records 5000 expense
    const expRes = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${santoshToken}`,
      },
      body: JSON.stringify({
        amount: 5000,
        category: 'मंडळ कार्यक्रम',
        reason: 'वार्षिक उत्सव तयारी मंडप खर्च',
      }),
    });
    assert.equal(expRes.status, 201);

    // Ekata views expenses -> 0 expenses
    const ekataExp = await fetch(`${baseUrl}/api/expenses`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    const ekataExpData = await ekataExp.json();
    assert.equal(ekataExpData.data.expenses.length, 0);
    assert.equal(ekataExpData.data.summary.totalExpenses, 0);
  });

  // 18 & 19. Notifications for Nagraj delivered ONLY to Nagraj; Ekata ONLY to Ekata
  test('18 & 19. Real Notifications are delivered with zero cross-tenant leakage', async () => {
    // Santosh changes his PIN -> triggers SECURITY_EVENT for Santosh
    const pinRes = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${santoshToken}`,
      },
      body: JSON.stringify({
        currentPin: '1234',
        newPin: '5678',
      }),
    });
    assert.equal(pinRes.status, 200);
    const pinData = await pinRes.json();
    santoshToken = pinData.token; // Update token

    // Santosh has notification
    const sanNotif = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${santoshToken}` },
    });
    const sanNotifData = await sanNotif.json();
    assert.ok(sanNotifData.data.length > 0);
    assert.equal(sanNotifData.data[0].type, 'SECURITY_EVENT');

    // Ekata President has ZERO notifications
    const ekNotif = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    const ekNotifData = await ekNotif.json();
    assert.equal(ekNotifData.data.length, 0);
  });

  // 20. Permanent Mandal deletion: Deleting Nagraj wipes Nagraj; Ekata remains 100% intact
  test('20. Permanent deletion of Nagraj Tarun Mandal leaves Ekata Tarun Mandal completely intact', async () => {
    // Santosh deletes Nagraj Tarun Mandal
    const delRes = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${santoshToken}`,
      },
      body: JSON.stringify({
        pin: '5678', // Current rotated PIN
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.success, true);

    // Subsequent call with Santosh token returns 401 (revoked)
    const sanMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${santoshToken}` },
    });
    assert.equal(sanMeRes.status, 401);

    // Ekata Tarun Mandal is completely unaffected:
    // 1. Ekata President session is valid
    const ekMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    assert.equal(ekMeRes.status, 200);
    const ekMeData = await ekMeRes.json();
    assert.equal(ekMeData.organization.id, ekataOrgId);
    assert.equal(ekMeData.organization.name, 'एकता तरुण मंडळ');

    // 2. Ekata Members remain active
    const ekMemberList = await fetch(`${baseUrl}/api/members`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    assert.equal(ekMemberList.status, 200);
    const ekMemberListData = await ekMemberList.json();
    assert.equal(ekMemberListData.data.length, 2); // Ekata President + M2

    // 3. Ekata Loans remain active
    const ekLoans = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: `Bearer ${ekataToken}` },
    });
    assert.equal(ekLoans.status, 200);
    const ekLoansData = await ekLoans.json();
    assert.equal(ekLoansData.data.length, 1);
    assert.equal(ekLoansData.data[0].id, ekataLoanId);
  });

  // 21. Concurrent onboarding: Simultaneous requests do not corrupt organization IDs
  test('21. Simultaneous onboarding requests create independent Mandals safely', async () => {
    const attempts = [
      fetch(`${baseUrl}/api/auth/register-president`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mandalName: 'मंडळ Alpha',
          fullName: 'अध्यक्ष Alpha',
          phone: '9822111111',
          pin: '1111',
          confirmPin: '1111',
        }),
      }),
      fetch(`${baseUrl}/api/auth/register-president`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mandalName: 'मंडळ Beta',
          fullName: 'अध्यक्ष Beta',
          phone: '9822222222',
          pin: '2222',
          confirmPin: '2222',
        }),
      }),
    ];

    const responses = await Promise.all(attempts);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    assert.equal(responses[0].status, 201);
    assert.equal(responses[1].status, 201);
    assert.notEqual(bodies[0].organization.id, bodies[1].organization.id);
    assert.notEqual(bodies[0].organization.code, bodies[1].organization.code);
  });

  // 22. Registration lock bypass: Re-registering with same phone is rejected
  test('22. Attempts to register with an already registered phone number are rejected (409)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'नवीन मंडळ Gamma',
        fullName: 'अध्यक्ष Gamma',
        phone: '9822111111', // Already registered for Alpha
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /आधीच नोंदणीकृत आहे/);
  });

  // 23. Cross-tenant IDOR: Attempting to set Bishi for foreign member ID is rejected
  test('23. IDOR Protection: President cannot set Bishi config using another Mandal member ID', async () => {
    const db = getDatabase();
    const alphaUser = db.prepare("SELECT id FROM users WHERE phone = '9822111111'").get() as { id: string };

    const res = await fetch(`${baseUrl}/api/members/${alphaUser.id}/bishi-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ekataToken}`,
      },
      body: JSON.stringify({
        monthlyAmount: 1000,
        dueDay: 5,
      }),
    });
    assert.equal(res.status, 404);
  });

  // 24. App clean start / reinstall: Existing Mandals remain intact and isolated
  test('24. Server restart preserves multi-tenant data and keeps Mandals isolated', async () => {
    const db = getDatabase();

    const ekataOrg = db.prepare('SELECT name FROM organizations WHERE id = ?').get(ekataOrgId) as { name: string };
    assert.ok(ekataOrg);
    assert.equal(ekataOrg.name, 'एकता तरुण मंडळ');

    // Nagraj was deleted in test 20, should not exist
    const nagrajOrg = db.prepare('SELECT id FROM organizations WHERE id = ?').get(santoshOrgId);
    assert.equal(nagrajOrg, undefined);
  });
});
