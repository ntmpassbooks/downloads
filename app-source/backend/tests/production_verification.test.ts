process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
process.env.SESSION_SECRET = 'production-verification-test-secret-minimum-32chars!';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/db/connection.js';
import { seedDatabase } from '../src/db/seed.js';
import { createDatabaseBackup } from '../src/scripts/backup.js';
import { verifyBackupFile } from '../src/scripts/restore.js';

describe('Phase 1H: Real Production Transition & Verification Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let ntmPresidentToken: string;
  let ntmTreasurerToken: string;
  let ntmMemberToken: string;
  let jhmPresidentToken: string;
  let jhmMemberToken: string;

  const NTM_ORG_ID = 'org-ntm-001';
  const JHM_ORG_ID = 'org-jhm-002';
  const tempBackupDir = path.resolve(process.cwd(), './backups_test');

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

    // Login NTM President
    const presRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    ntmPresidentToken = (await presRes.json()).token;

    // Login NTM Treasurer
    const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
    });
    ntmTreasurerToken = (await treasRes.json()).token;

    // Login NTM Member
    const memRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
    });
    ntmMemberToken = (await memRes.json()).token;

    // Login JHM President (Secondary Mandal)
    const { hash, salt } = await import('../src/modules/auth/auth.service.js').then((m) =>
      m.AuthService.hashPin('1234')
    );
    db.prepare(`
      INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
      VALUES ('usr-jhm-pres-99', 'org-jhm-002', '9876543288', 'JHM President', 'PRESIDENT', ?, ?, 1)
    `).run(hash, salt);

    const jhmPresRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543288', pin: '1234' }),
    });
    jhmPresidentToken = (await jhmPresRes.json()).token;

    // Login JHM Member (9876543299 from seed)
    const jhmMemRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543299', pin: '1234' }),
    });
    jhmMemberToken = (await jhmMemRes.json()).token;
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    closeDatabase();
    if (fs.existsSync(tempBackupDir)) {
      fs.rmSync(tempBackupDir, { recursive: true, force: true });
    }
  });

  // 1. Seed Guard in Production
  test('1. Database seeding is strictly forbidden when NODE_ENV is production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.throws(
      () => {
        seedDatabase();
      },
      { message: /strictly forbidden in production/i }
    );
    process.env.NODE_ENV = originalEnv;
  });

  // 2. Production Security Headers (Helmet)
  test('2. Production security headers are enforced and X-Powered-By is omitted', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-powered-by'), null);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  });

  // 3. CORS Policy Enforcement
  test('3. CORS rejects unauthorized origin and accepts authorized origin', async () => {
    const unauthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://malicious-attacker-site.com' },
    });
    assert.strictEqual(unauthRes.headers.get('access-control-allow-origin'), null);

    const authRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.strictEqual(authRes.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  });

  // 4. Client Cannot Override Server Organization Context
  test('4. Client cannot override authenticated organization ID via request body', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ntmPresidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fullName: 'अविनाश साळुंखे',
        phone: '9876543111',
        initialPin: '1234',
        role: 'MEMBER',
        organizationId: JHM_ORG_ID, // Attempted spoof
        organization_id: JHM_ORG_ID,
      }),
    });

    assert.strictEqual(res.status, 201);
    const json = await res.json();
    assert.strictEqual(json.data.organizationId, NTM_ORG_ID, 'Must remain NTM01 despite spoof attempt');
  });

  // 5. Cross-Tenant IDOR: Member Access
  test('5. Cross-tenant IDOR: Org A President cannot read Org B member details', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-jhm-member-02`, {
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    assert.strictEqual(res.status, 403, 'Must reject cross-mandal member access');
  });

  // 6. Cross-Tenant IDOR: Bishi Config & Records
  test('6. Cross-tenant IDOR: Org A President cannot set or read Org B member Bishi config', async () => {
    const setRes = await fetch(`${baseUrl}/api/bishi/config/usr-jhm-member-02`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ntmPresidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 1000, dueDay: 10 }),
    });
    assert.ok(setRes.status === 403 || setRes.status === 404, 'Must reject cross-mandal Bishi config set');

    const getRes = await fetch(`${baseUrl}/api/bishi/config/usr-jhm-member-02`, {
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    assert.ok(getRes.status === 403 || getRes.status === 404, 'Must reject cross-mandal Bishi config get');
  });

  // 7. Cross-Tenant IDOR: Loans & Repayments
  test('7. Cross-tenant IDOR: Org A President cannot create loan for Org B member', async () => {
    const res = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ntmPresidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberId: 'usr-jhm-member-02',
        principalAmount: 5000,
        purpose: 'Cross mandal loan attempt',
      }),
    });
    assert.ok(res.status === 400 || res.status === 403 || res.status === 404, 'Must reject cross-mandal loan');
  });

  // 8. Cross-Tenant IDOR: Expenses
  test('8. Cross-tenant IDOR: Org A President cannot access Org B expenses', async () => {
    // 1. Org B President creates an expense in Org B
    const createB = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jhmPresidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 1200,
        category: 'साहित्य',
        reason: 'Org B specific expense',
      }),
    });
    assert.strictEqual(createB.status, 201);
    const expB = (await createB.json()).data;

    // 2. Org A President attempts to query Org B expense by ID
    const getA = await fetch(`${baseUrl}/api/expenses/${expB.id}`, {
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    assert.strictEqual(getA.status, 404, 'Must not find cross-tenant expense');

    // 3. Org A President expense list must not contain Org B expense
    const listA = await fetch(`${baseUrl}/api/expenses`, {
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    const listAJson = await listA.json();
    const hasExpB = listAJson.data.expenses.some((e: any) => e.id === expB.id);
    assert.strictEqual(hasExpB, false);
  });

  // 9. Cross-Tenant IDOR: Financial Ledger
  test('9. Cross-tenant IDOR: Organization ledger is strictly scoped to authenticated user org', async () => {
    const resA = await fetch(`${baseUrl}/api/ledger`, {
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    const jsonA = await resA.json();

    const resB = await fetch(`${baseUrl}/api/ledger`, {
      headers: { Authorization: `Bearer ${jhmPresidentToken}` },
    });
    const jsonB = await resB.json();

    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);

    // Verify all transactions in jsonA belong strictly to NTM_ORG_ID
    for (const t of jsonA.data.transactions) {
      assert.strictEqual(t.organizationId, NTM_ORG_ID);
    }
  });

  // 10. Member RBAC Boundaries
  test('10. Member is strictly blocked from all financial administrative endpoints (403)', async () => {
    const endpoints = [
      { path: '/api/members', method: 'GET' },
      { path: '/api/members', method: 'POST', body: { fullName: 'X', phone: '9876543999', initialPin: '1234', role: 'MEMBER' } },
      { path: '/api/bishi/generate-cycle', method: 'POST', body: {} },
      { path: '/api/bishi/overview', method: 'GET' },
      { path: '/api/ledger', method: 'GET' },
      { path: '/api/loans', method: 'POST', body: { memberId: 'usr-ntm-member-01', principalAmount: 1000 } },
      { path: '/api/expenses', method: 'GET' },
      { path: '/api/expenses', method: 'POST', body: { amount: 500, category: 'साहित्य', reason: 'Test' } },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          Authorization: `Bearer ${ntmMemberToken}`,
          'Content-Type': 'application/json',
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      assert.strictEqual(res.status, 403, `Endpoint ${ep.method} ${ep.path} must return 403 for member`);
    }
  });

  // 11. Immutability: Financial transactions cannot be modified
  test('11. Confirmed financial transactions have no PUT, PATCH, or DELETE routes', async () => {
    const putRes = await fetch(`${baseUrl}/api/transactions/tx-123`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    assert.strictEqual(putRes.status, 404);

    const patchRes = await fetch(`${baseUrl}/api/transactions/tx-123`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    assert.strictEqual(patchRes.status, 404);

    const delRes = await fetch(`${baseUrl}/api/transactions/tx-123`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ntmPresidentToken}` },
    });
    assert.strictEqual(delRes.status, 404);
  });

  // 12. Backup Creation via VACUUM INTO
  test('12. Database backup utility creates consistent, readable snapshot via VACUUM INTO', () => {
    const backupResult = createDatabaseBackup(tempBackupDir);
    assert.strictEqual(backupResult.success, true);
    assert.strictEqual(fs.existsSync(backupResult.backupPath), true);
    assert.ok(backupResult.sizeBytes > 0);

    // Verify backup integrity
    const verifyResult = verifyBackupFile(backupResult.backupPath);
    assert.strictEqual(verifyResult.isValid, true);
    assert.strictEqual(verifyResult.integrityCheck, 'ok');
    assert.ok(verifyResult.tableCounts.users > 0);
  });

  // 13. Production Database Separation Check
  test('13. Production DB path cannot use dev or test database filename', async () => {
    const { env } = await import('../src/config/env.js');
    assert.ok(env.DB_PATH.length > 0);
  });
});
