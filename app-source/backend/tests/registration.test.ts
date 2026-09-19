process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDatabase, getDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;

function cleanDatabaseForRegistration() {
  runMigrations();
  const db = getDatabase();
  // Clear tables to simulate a fresh deployment awaiting first-time registration
  db.exec('DELETE FROM audit_logs;');
  db.exec('DELETE FROM expenses;');
  db.exec('DELETE FROM loan_repayments;');
  db.exec('DELETE FROM loans;');
  db.exec('DELETE FROM financial_transactions;');
  db.exec('DELETE FROM bishi_records;');
  db.exec('DELETE FROM bishi_configs;');
  db.exec('DELETE FROM sessions;');
  db.exec('DELETE FROM users;');
  db.exec('DELETE FROM organizations;');
}

before(async () => {
  cleanDatabaseForRegistration();

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
});

describe('NTM Passbook — Phase 1B-4 First President Registration & Lock Tests', () => {
  // Test 1: Initial Registration Availability
  test('1. Registration status returns open when no President exists in the database', async () => {
    const res = await fetch(`${baseUrl}/api/auth/registration-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.registrationOpen, true);
  });

  // Test 2: Input Validation - Missing or invalid inputs
  test('2. Registration rejects input with PIN mismatch (400)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवाजी मित्र मंडळ',
        fullName: 'तानाजी मालुसरे',
        phone: '9822012345',
        pin: '1234',
        confirmPin: '9999', // Mismatch
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.details[0].message, /समान/);
  });

  test('3. Registration rejects invalid phone number (400)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवाजी मित्र मंडळ',
        fullName: 'तानाजी मालुसरे',
        phone: '12345', // Invalid phone
        pin: '1234',
        confirmPin: '1234',
      }),
    });
    assert.equal(res.status, 400);
  });

  test('4. Registration rejects short PIN (400)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवाजी मित्र मंडळ',
        fullName: 'तानाजी मालुसरे',
        phone: '9822012345',
        pin: '12', // Less than 4 digits
        confirmPin: '12',
      }),
    });
    assert.equal(res.status, 400);
  });

  // Test 5: Successful First-time President Registration
  let registeredToken = '';
  let registeredPhone = '9822012345';
  let registeredPin = '4321';
  let registeredOrgId = '';

  test('5. First President registration succeeds with 201 and creates organization & user', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवनेरी मित्र मंडळ',
        fullName: 'तानाजी मालुसरे',
        phone: registeredPhone,
        pin: registeredPin,
        confirmPin: registeredPin,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token);
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.user.fullName, 'तानाजी मालुसरे');
    assert.equal(body.user.phone, registeredPhone);
    assert.ok(body.organization.id);
    assert.equal(body.organization.name, 'शिवनेरी मित्र मंडळ');
    assert.ok(body.organization.code);

    registeredToken = body.token;
    registeredOrgId = body.organization.id;

    // Verify zero PIN / hash exposure in response
    assert.equal('pin' in body.user, false);
    assert.equal('pin_hash' in body.user, false);
    assert.equal('pin_salt' in body.user, false);
    assert.equal('passwordHash' in body.user, false);
  });

  // Test 6: Database Persistence & Security
  test('6. Newly registered President is properly saved with Scrypt hash in SQLite DB', () => {
    const db = getDatabase();
    const userRow = db
      .prepare('SELECT id, role, pin_hash, pin_salt, is_active FROM users WHERE phone = ?')
      .get(registeredPhone) as { id: string; role: string; pin_hash: string; pin_salt: string; is_active: number };

    assert.ok(userRow);
    assert.equal(userRow.role, 'PRESIDENT');
    assert.equal(userRow.is_active, 1);
    assert.notEqual(userRow.pin_hash, registeredPin); // Never plaintext
    assert.ok(userRow.pin_salt);
  });

  // Test 7: Registration Lock Check
  test('7. Registration status reports open for onboarding new Mandals (registrationOpen: true)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/registration-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.registrationOpen, true);
  });

  // Test 8: Rejection of Second Registration Attempt for the SAME Mandal (Per-Mandal Lock)
  test('8. Second President registration attempt for the SAME Mandal is rejected with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवनेरी मित्र मंडळ', // Same mandal name
        fullName: 'दुसरा अध्यक्ष',
        phone: '9822099999',
        pin: '5555',
        confirmPin: '5555',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /नोंदणी सध्या उपलब्ध नाही|आधीपासून नोंदणीकृत/);
  });

  // Test 9: Concurrent Registration Race Condition Defense for Same Mandal
  test('9. Race-condition check: Concurrent registration requests for same Mandal cannot create duplicate Presidents', async () => {
    // Attempt simultaneous registration requests for the same Mandal
    const attempts = [
      fetch(`${baseUrl}/api/auth/register-president`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mandalName: 'शिवनेरी मित्र मंडळ',
          fullName: 'अध्यक्ष अ',
          phone: '9822011111',
          pin: '1111',
          confirmPin: '1111',
        }),
      }),
      fetch(`${baseUrl}/api/auth/register-president`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mandalName: 'शिवनेरी मित्र मंडळ',
          fullName: 'अध्यक्ष ब',
          phone: '9822022222',
          pin: '2222',
          confirmPin: '2222',
        }),
      }),
    ];

    const responses = await Promise.all(attempts);
    for (const res of responses) {
      assert.equal(res.status, 409); // All rejected because mandal is locked
    }

    // Verify exactly ONE president exists for 'शिवनेरी मित्र मंडळ'
    const db = getDatabase();
    const countRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM users u
      JOIN organizations o ON u.organization_id = o.id
      WHERE u.role = 'PRESIDENT' AND o.name = 'शिवनेरी मित्र मंडळ'
    `).get() as { count: number };
    assert.equal(countRow.count, 1);
  });

  // Test 10: Newly Registered President can Login
  test('10. Newly registered President can log in with phone and PIN', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: registeredPhone,
        pin: registeredPin,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.organization.name, 'शिवनेरी मित्र मंडळ');
  });

  // Test 11: GET /api/auth/me returns President profile
  test('11. Authenticated session returns correct President profile via /api/auth/me', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${registeredToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.user.fullName, 'तानाजी मालुसरे');
  });

  // Test 12: President has access to Member Management
  test('12. Newly registered President can access member directory endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      headers: { Authorization: `Bearer ${registeredToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  // Test 13: Audit log records PRESIDENT_REGISTERED
  test('13. Audit log properly recorded PRESIDENT_REGISTERED action', () => {
    const db = getDatabase();
    const log = db.prepare("SELECT * FROM audit_logs WHERE action = 'PRESIDENT_REGISTERED'").get() as any;
    assert.ok(log);
    assert.equal(log.organization_id, registeredOrgId);
    assert.match(log.details, /शिवनेरी मित्र मंडळ/);
  });

  // Test 14: Login strictly rejects non-phone strings like admin@shub
  test('14. Login endpoint rejects non-phone string (e.g. admin@shub) with 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: 'admin@shub', pin: '1234' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  // Test 15: Zero PIN / Hash / Salt exposure across profile and auth responses
  test('15. No PIN, hash, or salt is leaked in /api/auth/me response', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${registeredToken}` },
    });
    const body = await res.json();
    assert.equal('pin' in body.user, false);
    assert.equal('pin_hash' in body.user, false);
    assert.equal('pin_salt' in body.user, false);
  });

  // Test 16: Logout revokes session and subsequent calls return 401
  test('16. Logout revokes token and subsequent authenticated calls fail with 401', async () => {
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${registeredToken}` },
    });
    assert.equal(logoutRes.status, 200);

    const checkRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${registeredToken}` },
    });
    assert.equal(checkRes.status, 401);
  });
});
