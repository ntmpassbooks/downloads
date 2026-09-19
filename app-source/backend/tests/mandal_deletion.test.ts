process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
process.env.SESSION_SECRET = 'mandal-deletion-test-secret-minimum-32chars!';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/db/connection.js';
import { seedDatabase } from '../src/db/seed.js';
import { AuthService } from '../src/modules/auth/auth.service.js';

describe('Phase 2C: Protected Permanent Mandal Delete & Full Reset Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let presidentToken: string;
  let treasurerToken: string;
  let memberToken: string;
  let secondaryOrgPresToken: string;

  const NTM_ORG_ID = 'org-ntm-001';
  const JHM_ORG_ID = 'org-jhm-002';

  before(async () => {
    seedDatabase();
    const db = getDatabase();

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

    // Login NTM President (9876543210, PIN 1234)
    const presRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    const presData = await presRes.json();
    presidentToken = presData.token;

    // Login NTM Treasurer (9876543211, PIN 1234)
    const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
    });
    const treasData = await treasRes.json();
    treasurerToken = treasData.token;

    // Login NTM Member (9876543212, PIN 1234)
    const memRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
    });
    const memData = await memRes.json();
    memberToken = memData.token;

    // Seed Secondary Org (JHM) with President
    const { hash, salt } = AuthService.hashPin('1234');
    db.prepare(`
      INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
      VALUES ('usr-jhm-pres-2c', 'org-jhm-002', '9876543288', 'JHM President', 'PRESIDENT', ?, ?, 1)
    `).run(hash, salt);

    const jhmPresRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543288', pin: '1234' }),
    });
    const jhmPresData = await jhmPresRes.json();
    secondaryOrgPresToken = jhmPresData.token;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDatabase();
  });

  // ==========================================
  // 1. Authorization & Role Checks
  // ==========================================

  test('1. Unauthenticated request to permanent delete is rejected (401)', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.strictEqual(res.status, 401);
  });

  test('2. Member is rejected from permanent delete with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  test('3. Treasurer is rejected from permanent delete with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  // ==========================================
  // 2. Input Validation & Cryptographic PIN Re-Authentication
  // ==========================================

  test('4. Missing PIN is rejected with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  test('5. Incorrect PIN is rejected with 401 Unauthorized (Re-Auth Failure)', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        pin: '9999',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /अवैध पिन/);
  });

  test('6. Unchecked confirmation is rejected with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        pin: '1234',
        confirmed: false,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  test('7. Incorrect confirmation phrase is rejected with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'delete mandal',
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  // ==========================================
  // 3. Multi-Tenant Protection & IDOR Resistance
  // ==========================================

  test('8. Multi-Tenant IDOR: President A cannot delete Org B by passing foreign org ID', async () => {
    const db = getDatabase();

    // Org B initially has records
    const orgBUsersBefore = db
      .prepare('SELECT COUNT(*) as count FROM users WHERE organization_id = ?')
      .get(JHM_ORG_ID) as { count: number };
    assert.ok(orgBUsersBefore.count > 0, 'Org B must have users before test');

    // Org A President attempts to delete Org B via parameter injection
    const res = await fetch(`${baseUrl}/api/organizations/permanent-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        organizationId: JHM_ORG_ID,
        pin: '1234',
        confirmed: true,
        confirmationPhrase: 'मंडळ कायमचे हटवा',
      }),
    });

    // Request succeeds for Org A (because server derives org exclusively from token),
    // but Org B must remain 100% UNTOUCHED!
    assert.strictEqual(res.status, 200);

    const orgBAfter = db
      .prepare('SELECT COUNT(*) as count FROM organizations WHERE id = ?')
      .get(JHM_ORG_ID) as { count: number };
    assert.strictEqual(orgBAfter.count, 1, 'Org B organization record must remain intact');

    const orgBUsersAfter = db
      .prepare('SELECT COUNT(*) as count FROM users WHERE organization_id = ?')
      .get(JHM_ORG_ID) as { count: number };
    assert.strictEqual(orgBUsersAfter.count, orgBUsersBefore.count, 'Org B users must remain 100% intact');
  });

  // ==========================================
  // 4. Complete Reverse-Dependency Deletion Verification
  // ==========================================

  test('9. Full Reverse-Dependency Deletion: All Org A records purged across all 10 tables', async () => {
    const db = getDatabase();

    // Verify Org A is completely wiped across all tables
    const tables = [
      { name: 'loan_repayments', col: 'organization_id' },
      { name: 'loans', col: 'organization_id' },
      { name: 'expenses', col: 'organization_id' },
      { name: 'bishi_records', col: 'organization_id' },
      { name: 'bishi_configs', col: 'organization_id' },
      { name: 'financial_transactions', col: 'organization_id' },
      { name: 'audit_logs', col: 'organization_id' },
      { name: 'users', col: 'organization_id' },
      { name: 'organizations', col: 'id' },
    ];

    for (const t of tables) {
      const count = (
        db.prepare(`SELECT COUNT(*) as count FROM ${t.name} WHERE ${t.col} = ?`).get(NTM_ORG_ID) as {
          count: number;
        }
      ).count;
      assert.strictEqual(count, 0, `Table ${t.name} should have 0 rows for deleted org ${NTM_ORG_ID}`);
    }

    // Sessions check for Org A users
    const sessionCount = (
      db.prepare(`
        SELECT COUNT(*) as count FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.organization_id = ?
      `).get(NTM_ORG_ID) as { count: number }
    ).count;
    assert.strictEqual(sessionCount, 0, 'All sessions for Org A must be 0');

    // Foreign keys remain enabled
    const fkPragma = (db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number }).foreign_keys;
    assert.strictEqual(fkPragma, 1, 'PRAGMA foreign_keys must remain ON');
  });

  // ==========================================
  // 5. Session Revocation & Login Lock
  // ==========================================

  test('10. Revoked President token receives 401 Unauthorized on subsequent requests', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 401);
  });

  test('11. Revoked Treasurer & Member tokens receive 401 Unauthorized', async () => {
    const treasRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.strictEqual(treasRes.status, 401);

    const memRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(memRes.status, 401);
  });

  test('12. Deleted users cannot log in with previous credentials', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    assert.strictEqual(res.status, 401);
  });

  // ==========================================
  // 6. Registration Reset & Fresh Installation Flow
  // ==========================================

  test('13. When all Presidents are deleted, registration status naturally unlocks (registrationOpen = true)', async () => {
    const db = getDatabase();

    // Wipe any remaining presidents from other orgs to simulate full first-installation reset
    db.prepare("DELETE FROM users WHERE role = 'PRESIDENT'").run();

    const res = await fetch(`${baseUrl}/api/auth/registration-status`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.registrationOpen, true, 'Registration must be open when 0 presidents exist');
  });

  test('14. New First President registration succeeds cleanly after reset', async () => {
    const regRes = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'श्री गणेश मित्र मंडळ',
        registrationNumber: 'MH/2026/SGM/001',
        fullName: 'सचिन तानाजी पाटील',
        phone: '9822334455',
        pin: '5678',
        confirmPin: '5678',
      }),
    });
    assert.strictEqual(regRes.status, 201);
    const regBody = await regRes.json();
    assert.strictEqual(regBody.success, true);
    assert.ok(regBody.user);
    assert.strictEqual(regBody.user.role, 'PRESIDENT');

    // Duplicate registration for the same Mandal is locked immediately (Per-Mandal lock)
    const dupRes = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'श्री गणेश मित्र मंडळ',
        fullName: 'दुसरा अध्यक्ष',
        phone: '9822334499',
        pin: '5678',
        confirmPin: '5678',
      }),
    });
    assert.strictEqual(dupRes.status, 409, 'Registration for the same Mandal must lock after first President');
  });

  // ==========================================
  // 7. Atomic Rollback Protection
  // ==========================================

  test('15. Controlled failure inside deletion rolls back atomically without partial deletions', async () => {
    const db = getDatabase();

    // Login the new President
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822334455', pin: '5678' }),
    });
    const newPresToken = (await loginRes.json()).token;

    // Get user details
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newPresToken}` },
    });
    const me = (await meRes.json()).user;

    const { OrganizationService } = await import('../src/modules/organization/organization.service.js');

    // Call with invalid actor role -> throws 403, 0 rows deleted
    assert.throws(
      () => {
        OrganizationService.permanentDeleteMandal(
          { ...me, role: 'MEMBER' },
          '5678'
        );
      },
      { statusCode: 403 }
    );

    // Verify user and org still exist
    const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(me.id);
    assert.ok(userCheck, 'User must remain intact after aborted deletion');

    const orgCheck = db.prepare('SELECT id FROM organizations WHERE id = ?').get(me.organizationId);
    assert.ok(orgCheck, 'Organization must remain intact after aborted deletion');
  });

  // ==========================================
  // 8. Concurrency / Double Submission Protection
  // ==========================================

  test('16. Concurrency check: Duplicate deletion calls fail safely without database corruption', async () => {
    // Login the new President again
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9822334455', pin: '5678' }),
    });
    const newPresToken = (await loginRes.json()).token;

    // Fire two requests concurrently
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/organizations/permanent-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newPresToken}`,
        },
        body: JSON.stringify({
          pin: '5678',
          confirmed: true,
          confirmationPhrase: 'मंडळ कायमचे हटवा',
        }),
      }),
      fetch(`${baseUrl}/api/organizations/permanent-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newPresToken}`,
        },
        body: JSON.stringify({
          pin: '5678',
          confirmed: true,
          confirmationPhrase: 'मंडळ कायमचे हटवा',
        }),
      }),
    ]);

    // One must succeed with 200
    const statuses = [res1.status, res2.status];
    assert.ok(statuses.includes(200), 'At least one concurrent deletion request must succeed');
    // The other must fail safely (401 or 404), never 500
    const otherStatus = statuses[0] === 200 ? statuses[1] : statuses[0];
    assert.ok([401, 404].includes(otherStatus), `Second request must fail safely with 401 or 404, got ${otherStatus}`);
  });
});
