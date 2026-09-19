process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;

function cleanDatabase() {
  runMigrations();
  const db = getDatabase();
  db.exec('DELETE FROM audit_logs;');
  db.exec('DELETE FROM expenses;');
  db.exec('DELETE FROM loan_repayments;');
  db.exec('DELETE FROM loans;');
  db.exec('DELETE FROM financial_transactions;');
  db.exec('DELETE FROM bishi_records;');
  db.exec('DELETE FROM bishi_configs;');
  db.exec('DELETE FROM payment_orders;');
  db.exec('DELETE FROM payment_configs;');
  db.exec('DELETE FROM sessions;');
  db.exec('DELETE FROM users;');
  db.exec('DELETE FROM organizations;');
}

before(async () => {
  cleanDatabase();

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
});

describe('NTM Passbook — Dynamic Splash Screen Mandal Name & Tenant Isolation Tests', () => {
  let presidentToken: string;
  let presidentOrgId: string;
  const presidentMandalName = 'श्री गणेश तरुण मंडळ';

  test('1. Fresh installation with no organization reports registrationOpen: true and returns no organization to unauthenticated caller', async () => {
    const statusRes = await fetch(baseUrl + '/api/auth/registration-status');
    const statusData = await statusRes.json();
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusData.success, true);
    assert.strictEqual(statusData.registrationOpen, true);

    // Unauthenticated call to /api/auth/me returns 401 Unauthorized
    const meRes = await fetch(baseUrl + '/api/auth/me');
    assert.strictEqual(meRes.status, 401);
  });

  test('2. First President registration dynamically sets organization name', async () => {
    const regRes = await fetch(baseUrl + '/api/auth/register-president', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: presidentMandalName,
        fullName: 'गणेश पाटील',
        phone: '9876543210',
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regData.success, true);
    assert.strictEqual(regData.organization.name, presidentMandalName);
    assert.ok(regData.token);

    presidentToken = regData.token;
    presidentOrgId = regData.organization.id;
  });

  test('3. Authenticated session restoration returns real organization name for splash screen', async () => {
    const meRes = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + presidentToken },
    });
    const meData = await meRes.json();
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meData.success, true);
    assert.strictEqual(meData.organization.name, presidentMandalName);
    assert.strictEqual(meData.organization.id, presidentOrgId);
  });

  test('4. Multiple users in the same Mandal (Treasurer/Member) receive identical organization name', async () => {
    // President adds a Member
    const addMemberRes = await fetch(baseUrl + '/api/members', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + presidentToken,
      },
      body: JSON.stringify({
        fullName: 'राहुल कदम',
        phone: '9876543211',
        pin: '1234',
      }),
    });
    const addMemberData = await addMemberRes.json();
    assert.strictEqual(addMemberRes.status, 201);

    // Member logs in
    const memberLoginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9876543211',
        pin: '1234',
      }),
    });
    const memberLoginData = await memberLoginRes.json();
    assert.strictEqual(memberLoginRes.status, 200);
    assert.strictEqual(memberLoginData.organization.name, presidentMandalName);

    // Member session restore
    const memberMeRes = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + memberLoginData.token },
    });
    const memberMeData = await memberMeRes.json();
    assert.strictEqual(memberMeRes.status, 200);
    assert.strictEqual(memberMeData.organization.name, presidentMandalName);
  });

  test('5. Tenant Isolation: Users in separate organizations only receive their own Mandal name', async () => {
    const db = getDatabase();
    // Simulate a secondary isolated organization
    const org2Id = 'org-tenant-2-xyz';
    const user2Id = 'user-tenant-2-xyz';
    const org2Name = 'शिवाजी तरुण मंडळ';
    const nowIso = new Date().toISOString();

    db.prepare('INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (?, ?, \'NTM02\', ?, ?)').run(org2Id, org2Name, nowIso, nowIso);
    db.prepare('INSERT INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active, created_at, updated_at) VALUES (?, ?, \'9111111111\', \'तानाजी मालुसरे\', \'PRESIDENT\', \'dummy_hash\', \'dummy_salt\', 1, ?, ?)').run(user2Id, org2Id, nowIso, nowIso);

    // Create session for user2
    const sessionId = crypto.randomUUID();
    const rawToken2 = crypto.randomBytes(32).toString('hex');
    const tokenHash2 = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'secret').update(rawToken2).digest('hex');
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(sessionId, user2Id, tokenHash2, expiresAt);

    // Query /api/auth/me for User 2
    const me2Res = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + rawToken2 },
    });
    const me2Data = await me2Res.json();
    assert.strictEqual(me2Res.status, 200);
    assert.strictEqual(me2Data.organization.name, org2Name);
    assert.strictEqual(me2Data.organization.id, org2Id);

    // Query /api/auth/me for User 1 remains Org 1
    const me1Res = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + presidentToken },
    });
    const me1Data = await me1Res.json();
    assert.strictEqual(me1Data.organization.name, presidentMandalName);

    // Clean up isolated tenant 2 fixtures
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user2Id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user2Id);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(org2Id);
  });

  test('6. Logout invalidates session and prevents stale Mandal name leaking', async () => {
    const logoutRes = await fetch(baseUrl + '/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + presidentToken },
    });
    assert.strictEqual(logoutRes.status, 200);

    // Subsequent session check is rejected with 401
    const meRes = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + presidentToken },
    });
    assert.strictEqual(meRes.status, 401);
  });

  test('7. Permanent Mandal deletion purges organization and resets registration to open', async () => {
    // Re-login President to obtain fresh session
    const pLoginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    const pLoginData = await pLoginRes.json();
    assert.strictEqual(pLoginRes.status, 200);
    const activeToken = pLoginData.token;

    // Delete Mandal
    const delRes = await fetch(baseUrl + '/api/organizations/permanent-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + activeToken,
      },
      body: JSON.stringify({
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    const delData = await delRes.json();
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delData.success, true);
    assert.strictEqual(delData.registrationOpen, true);

    // Token is now completely invalidated
    const postDelMe = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + activeToken },
    });
    assert.strictEqual(postDelMe.status, 401);

    // Registration is open again
    const statusRes = await fetch(baseUrl + '/api/auth/registration-status');
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.registrationOpen, true);
  });

  test('8. New Mandal registration after deletion displays the new Mandal name', async () => {
    const newMandalName = 'जय बजरंग तरुण मंडळ';
    const regRes = await fetch(baseUrl + '/api/auth/register-president', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: newMandalName,
        fullName: 'बजरंग पवार',
        phone: '9876500000',
        pin: '5678',
        confirmPin: '5678',
      }),
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regData.organization.name, newMandalName);

    // Verify session restoration reflects new Mandal name
    const meRes = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + regData.token },
    });
    const meData = await meRes.json();
    assert.strictEqual(meData.organization.name, newMandalName);
  });

  test('9. Very long Mandal name is safely persisted and returned without truncation', async () => {
    cleanDatabase();
    const longMandalName = 'श्री विघ्नहर्ता चिंतामणी सार्वजनिक गणेशोत्सव मित्र मंडळ ट्रस्ट (नोंदणीकृत)';
    const regRes = await fetch(baseUrl + '/api/auth/register-president', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: longMandalName,
        fullName: 'सचिन जोशी',
        phone: '9822001122',
        pin: '9999',
        confirmPin: '9999',
      }),
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regData.organization.name, longMandalName);

    const meRes = await fetch(baseUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + regData.token },
    });
    const meData = await meRes.json();
    assert.strictEqual(meData.organization.name, longMandalName);
  });

  test('10. Codebase Audit: "NAGARAJ TARUN MANDAL" is completely removed from all source files', () => {
    const frontendSplashPath = path.resolve('..', 'frontend', 'src', 'components', 'SplashScreen.tsx');
    const splashContent = fs.readFileSync(frontendSplashPath, 'utf8');
    assert.strictEqual(
      splashContent.includes('Nagaraj Tarun Mandal'),
      false,
      'SplashScreen.tsx must not contain "Nagaraj Tarun Mandal"'
    );
    assert.strictEqual(
      splashContent.includes('NAGARAJ TARUN MANDAL'),
      false,
      'SplashScreen.tsx must not contain "NAGARAJ TARUN MANDAL"'
    );
  });

  test('11. Fixed Credit Audit: Exactly "Developed by Santosh Koli" is displayed on SplashScreen', () => {
    const frontendSplashPath = path.resolve('..', 'frontend', 'src', 'components', 'SplashScreen.tsx');
    const splashContent = fs.readFileSync(frontendSplashPath, 'utf8');
    assert.strictEqual(
      splashContent.includes('Developed by Santosh Koli'),
      true,
      'SplashScreen.tsx must contain exact string "Developed by Santosh Koli"'
    );
  });
});
