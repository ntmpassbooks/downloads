process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase } from '../src/db/connection.js';

let server: Server;
let baseUrl: string;

before(async () => {
  // Seed the test database
  seedDatabase();

  // Spin up app on random available test port
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

describe('NTM Passbook — Phase 1A Automated Verification Suite', () => {
  // Test 1: Healthcheck & Persistent DB
  test('1. GET /api/health should return healthy and persistent database connected', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.database, 'connected');
  });

  // Test 2: Unauthenticated protection
  test('2. Protected endpoints should reject unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/protected/president-only`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /लॉग इन करा/);
  });

  // Test 3: Input validation (Zod)
  test('3. POST /api/auth/login should reject invalid phone format with 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '12345', pin: '1234' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.details.length > 0);
  });

  // Test 4: Invalid credentials
  test('4. POST /api/auth/login should reject incorrect PIN with 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '9999' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  // Test 5: Successful Login for 3 Core Roles
  let presidentToken = '';
  let treasurerToken = '';
  let memberToken = '';
  let secondMandalMemberToken = '';

  test('5. Login for President (अध्यक्ष) succeeds with correct role & token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token);
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.organization.code, 'NTM01');
    presidentToken = body.token;
  });

  test('6. Login for Treasurer (खजिनदार) succeeds with correct role & token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.role, 'TREASURER');
    treasurerToken = body.token;
  });

  test('7. Login for Member (सदस्य) succeeds with correct role & token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.role, 'MEMBER');
    memberToken = body.token;
  });

  test('8. Login for Secondary Mandal Member succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543299', pin: '1234' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.organization.code, 'JHM02');
    secondMandalMemberToken = body.token;
  });

  // Test 9: Server-side RBAC Enforcement
  test('9. Role enforcement: President can access President endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/protected/president-only`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  test('10. Role enforcement: Treasurer cannot access President-only endpoint (403)', async () => {
    const res = await fetch(`${baseUrl}/api/protected/president-only`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /अधिकार नाही/);
  });

  test('11. Role enforcement: Member cannot access President-only endpoint (403)', async () => {
    const res = await fetch(`${baseUrl}/api/protected/president-only`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  test('12. Role enforcement: Treasurer can access Treasurer-or-President endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/protected/treasurer-or-president`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('13. Role enforcement: Member cannot access Treasurer-or-President endpoint (403)', async () => {
    const res = await fetch(`${baseUrl}/api/protected/treasurer-or-president`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('14. Role enforcement: Member can access Member area endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/protected/member-area`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
  });

  // Test 15: Multi-Tenant Organization Isolation (IDOR Defense)
  test('15. Multi-tenant isolation: Member of NTM cannot access JHM organization data (403)', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/org-jhm-002`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /केवळ स्वतःच्या मंडळाची/);
  });

  test('16. Multi-tenant isolation: Member of NTM can access NTM organization data', async () => {
    const res = await fetch(`${baseUrl}/api/organizations/org-ntm-001`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.name, 'नवतरुण मित्र मंडळ');
  });

  // Test 17: Logout & Token Invalidation
  test('17. POST /api/auth/logout should invalidate token and reject subsequent calls', async () => {
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(logoutRes.status, 200);

    // Call /api/auth/me with the invalidated token
    const checkRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(checkRes.status, 401);
  });
});
