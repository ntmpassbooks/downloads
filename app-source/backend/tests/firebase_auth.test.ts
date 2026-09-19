process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';

import test, { before, after, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase } from '../src/db/connection.js';
import { FirebaseTokenService, FirebaseClaims } from '../src/modules/auth/firebase_token.service.js';
import {
  isFirebaseAdminConfigured,
  getFirebaseAuth,
  resetFirebaseAdminForTesting,
} from '../src/config/firebaseAdmin.js';

let server: Server;
let baseUrl: string;

before(async () => {
  // Ensure clean test database with seeded test fixtures
  seedDatabase();

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

afterEach(() => {
  // Reset any mock generator after each test
  FirebaseTokenService.setMockTokenGeneratorForTesting(null);
  resetFirebaseAdminForTesting(null);
});

describe('NTM Passbook — Batch 7A: Firebase Admin & Custom Auth Token Integration Suite', () => {
  // --------------------------------------------------------------------------
  // TEST GROUP 1: Firebase Admin Configuration & Graceful Degradation (Default)
  // --------------------------------------------------------------------------
  test('1. In default test/local environment with no Firebase credentials, Firebase Admin safely degrades', () => {
    resetFirebaseAdminForTesting(null);
    const configured = isFirebaseAdminConfigured();
    assert.equal(configured, false, 'Firebase Admin must report not configured when env credentials are absent');
    const auth = getFirebaseAuth();
    assert.equal(auth, null, 'getFirebaseAuth must return null when unconfigured');
  });

  test('2. Standard login succeeds normally without firebaseToken when Firebase Admin is not configured', async () => {
    // Attempt login as President
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token, 'Authoritative session token must be present');
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.user.id, 'usr-ntm-president-01');
    assert.equal(body.firebaseToken, undefined, 'firebaseToken must be absent when Firebase Admin is inactive');
  });

  test('3. GET /api/auth/me succeeds normally without firebaseToken when Firebase Admin is not configured', async () => {
    // First log in to get session token
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    const { token } = await loginRes.json();

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.success, true);
    assert.equal(meBody.user.id, 'usr-ntm-president-01');
    assert.equal(meBody.firebaseToken, undefined, 'firebaseToken must be absent in profile when inactive');
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Custom Token Generation & Strict Claims Verification
  // --------------------------------------------------------------------------
  test('4. When enabled, login returns signed Firebase Custom Token with user UUID as UID', async () => {
    let capturedUid: string | null = null;
    let capturedClaims: FirebaseClaims | null = null;

    FirebaseTokenService.setMockTokenGeneratorForTesting(async (uid, claims) => {
      capturedUid = uid;
      capturedClaims = claims;
      return `mock-firebase-custom-token-for-${uid}`;
    });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.firebaseToken, 'mock-firebase-custom-token-for-usr-ntm-president-01');

    // Verify UID is the authoritative SQLite user UUID, NOT phone number
    assert.equal(capturedUid, 'usr-ntm-president-01', 'Firebase UID must be the SQLite user UUID');
    assert.notEqual(capturedUid, '9876543210', 'Firebase UID must NOT be the phone number');

    // Verify claims derived strictly from server-side DB record
    assert.ok(capturedClaims, 'Claims must be passed to token generator');
    assert.equal(capturedClaims!.role, 'PRESIDENT');
    assert.equal(capturedClaims!.organizationId, 'org-ntm-001');
    assert.equal(capturedClaims!.phone, '9876543210');
  });

  test('5. GET /api/auth/me attaches fresh Firebase Custom Token when enabled', async () => {
    FirebaseTokenService.setMockTokenGeneratorForTesting(async (uid, claims) => {
      return `token-for-${uid}-${claims.role}`;
    });

    // Log in
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    const { token } = await loginRes.json();

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.success, true);
    assert.equal(meBody.firebaseToken, 'token-for-usr-ntm-president-01-PRESIDENT');
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Role Integrity & Client Tampering Defense
  // --------------------------------------------------------------------------
  test('6. Role Integrity: Member cannot elevate role via request body; claims strictly match SQLite record', async () => {
    let capturedClaims: FirebaseClaims | null = null;

    FirebaseTokenService.setMockTokenGeneratorForTesting(async (_uid, claims) => {
      capturedClaims = claims;
      return 'token-member';
    });

    // Member attempts to inject role: 'PRESIDENT' in login payload
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9876543212',
        pin: '1234',
        role: 'PRESIDENT', // Attempted injection
        organizationId: 'org-admin-fake', // Attempted injection
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.role, 'MEMBER');

    // Server-side claims must strictly reflect the authoritative database role
    assert.ok(capturedClaims);
    assert.equal(capturedClaims!.role, 'MEMBER', 'Claims role must be MEMBER from database, ignoring client payload');
    assert.equal(capturedClaims!.organizationId, 'org-ntm-001');
    assert.equal(capturedClaims!.phone, '9876543212');
  });

  test('7. Role Integrity: Treasurer claims strictly reflect TREASURER role', async () => {
    let capturedClaims: FirebaseClaims | null = null;

    FirebaseTokenService.setMockTokenGeneratorForTesting(async (_uid, claims) => {
      capturedClaims = claims;
      return 'token-treasurer';
    });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
    });

    assert.equal(res.status, 200);
    assert.ok(capturedClaims);
    assert.equal(capturedClaims!.role, 'TREASURER');
    assert.equal(capturedClaims!.organizationId, 'org-ntm-001');
    assert.equal(capturedClaims!.phone, '9876543211');
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Multi-Tenant Mandal Isolation in Custom Tokens
  // --------------------------------------------------------------------------
  test('8. Tenant Isolation: Mandal 1 and Mandal 2 users receive strictly isolated organizationId claims', async () => {
    const claimsByUser: Record<string, FirebaseClaims> = {};

    FirebaseTokenService.setMockTokenGeneratorForTesting(async (uid, claims) => {
      claimsByUser[uid] = claims;
      return `custom-token-${uid}`;
    });

    // Login Mandal 1 Member
    const m1Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
    });
    assert.equal(m1Res.status, 200);

    // Login Mandal 2 Member
    const m2Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543299', pin: '1234' }),
    });
    assert.equal(m2Res.status, 200);

    // Mandal 1 Member must have org-ntm-001
    const m1Claims = claimsByUser['usr-ntm-member-01'];
    assert.ok(m1Claims);
    assert.equal(m1Claims.organizationId, 'org-ntm-001');

    // Mandal 2 Member must have org-jhm-002
    const m2Claims = claimsByUser['usr-jhm-member-02'];
    assert.ok(m2Claims);
    assert.equal(m2Claims.organizationId, 'org-jhm-002');

    // Strict non-leakage check
    assert.notEqual(m1Claims.organizationId, m2Claims.organizationId);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 5: Error Resilience & Graceful Non-blocking Degradation
  // --------------------------------------------------------------------------
  test('9. Firebase token generation error does NOT block or break login flow', async () => {
    // Simulate Firebase outage / network failure
    FirebaseTokenService.setMockTokenGeneratorForTesting(async () => {
      throw new Error('Firebase Auth simulated network failure: 503 Service Unavailable');
    });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });

    // Login MUST still succeed with 200 OK because SQLite is the authoritative source of truth
    assert.equal(res.status, 200, 'Login must succeed even if Firebase token generation fails');
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token, 'Authoritative session token must still be generated');
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.firebaseToken, undefined, 'firebaseToken must be omitted on failure without crashing');
  });

  test('10. Firebase token generation error does NOT break GET /api/auth/me', async () => {
    // Login successfully first
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    const { token } = await loginRes.json();

    // Set failing generator
    FirebaseTokenService.setMockTokenGeneratorForTesting(async () => {
      throw new Error('Firebase timeout');
    });

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.success, true);
    assert.equal(meBody.user.id, 'usr-ntm-president-01');
    assert.equal(meBody.firebaseToken, undefined);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 6: FirebaseTokenService Unit Constraints
  // --------------------------------------------------------------------------
  test('11. FirebaseTokenService.createCustomToken rejects invalid user input safely', async () => {
    // Null / empty user
    const nullResult = await FirebaseTokenService.createCustomToken(null as any);
    assert.equal(nullResult, null);

    // User without ID
    const emptyResult = await FirebaseTokenService.createCustomToken({
      id: '',
      role: 'MEMBER',
      organizationId: 'org-1',
      phone: '9876543210',
    });
    assert.equal(emptyResult, null);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 7: President Registration Custom Token Integration
  // --------------------------------------------------------------------------
  test('12. President registration succeeds and omits firebaseToken when Firebase Admin is inactive', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'स्वराज मित्र मंडळ',
        fullName: 'बाजीप्रभू देशपांडे',
        phone: '9822998877',
        pin: '5678',
        confirmPin: '5678',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token, 'Session token must be present');
    assert.equal(body.user.role, 'PRESIDENT');
    assert.equal(body.firebaseToken, undefined, 'firebaseToken must be absent when inactive');
  });

  test('13. President registration attaches firebaseToken when enabled, with correct UID and claims', async () => {
    let capturedUid: string | null = null;
    let capturedClaims: FirebaseClaims | null = null;

    FirebaseTokenService.setMockTokenGeneratorForTesting(async (uid, claims) => {
      capturedUid = uid;
      capturedClaims = claims;
      return `reg-token-${uid}`;
    });

    const res = await fetch(`${baseUrl}/api/auth/register-president`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandalName: 'शिवशंभू मित्र मंडळ',
        fullName: 'संभाजी राजे',
        phone: '9822998866',
        pin: '4321',
        confirmPin: '4321',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token);
    assert.equal(body.firebaseToken, `reg-token-${body.user.id}`);

    assert.equal(capturedUid, body.user.id);
    assert.ok(capturedClaims);
    assert.equal(capturedClaims!.role, 'PRESIDENT');
    assert.equal(capturedClaims!.phone, '9822998866');
    assert.equal(capturedClaims!.organizationId, body.user.organizationId);
  });
});

