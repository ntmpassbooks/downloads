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

before(async () => {
  seedDatabase();
  const db = getDatabase();

  // Create President for second mandal (org-jhm-002) for cross-mandal testing
  const { hash, salt } = await import('../src/modules/auth/auth.service.js').then((m) =>
    m.AuthService.hashPin('1234')
  );
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    'usr-jhm-president-02',
    'org-jhm-002',
    '9876543290',
    'प्रकाश जाधव',
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

  // Login as NTM Treasurer (usr-ntm-treasurer-01, phone 9876543211)
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  const treasData = await treasRes.json();
  treasurerToken = treasData.token;

  // Login as NTM Member (usr-ntm-member-01, phone 9876543212)
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
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeDatabase();
});

describe('NTM Passbook — Phase 1B-3 Treasurer & Role Management Tests', () => {
  // Test 1: President can assign MEMBER -> TREASURER
  test('1. President can assign a MEMBER to TREASURER', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-member-01/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ role: 'TREASURER' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.role, 'TREASURER');
    assert.equal(body.data.id, 'usr-ntm-member-01');
  });

  // Test 2: Previous Treasurer automatically became MEMBER
  test('2. Previous Treasurer automatically becomes MEMBER after transfer', async () => {
    const db = getDatabase();
    const oldTreas = db.prepare('SELECT id, role FROM users WHERE id = ?').get('usr-ntm-treasurer-01') as any;
    assert.ok(oldTreas);
    assert.equal(oldTreas.role, 'MEMBER');
  });

  // Test 3: Exactly one active Treasurer in the organization
  test('3. Mandal maintains exactly one active Treasurer', async () => {
    const db = getDatabase();
    const treasurers = db
      .prepare("SELECT id, full_name FROM users WHERE organization_id = 'org-ntm-001' AND role = 'TREASURER' AND is_active = 1")
      .all() as any[];

    assert.equal(treasurers.length, 1);
    assert.equal(treasurers[0].id, 'usr-ntm-member-01');
  });

  // Test 4: Inactive member cannot become Treasurer
  test('4. Inactive member cannot become Treasurer (400)', async () => {
    const db = getDatabase();
    // Create an inactive member
    db.prepare(`
      INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
      VALUES ('usr-inactive-99', 'org-ntm-001', '9876543888', 'निष्क्रिय सदस्य', 'MEMBER', 'hash', 'salt', 0)
    `).run();

    const res = await fetch(`${baseUrl}/api/members/usr-inactive-99/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ role: 'TREASURER' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /निष्क्रिय सदस्याला/);
  });

  // Test 5: Member from another organization cannot become Treasurer (IDOR defense)
  test('5. Cannot assign Treasurer to member of another Mandal (403 Forbidden)', async () => {
    // usr-jhm-member-02 belongs to org-jhm-002
    const res = await fetch(`${baseUrl}/api/members/usr-jhm-member-02/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ role: 'TREASURER' }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /सुरक्षा उल्लंघन/);
  });

  // Test 6: Treasurer cannot assign Treasurer (403)
  test('6. Treasurer cannot perform Treasurer role assignment (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-treasurer-01/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({ role: 'TREASURER' }),
    });
    assert.equal(res.status, 403);
  });

  // Test 7: Member cannot assign Treasurer (403)
  test('7. Member cannot perform Treasurer role assignment (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-treasurer-01/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ role: 'TREASURER' }),
    });
    assert.equal(res.status, 403);
  });

  // Test 8: President cannot assign PRESIDENT role through role endpoint (400)
  test('8. Role endpoint rejects assigning role PRESIDENT (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-member-01/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ role: 'PRESIDENT' }),
    });
    assert.equal(res.status, 400);
  });

  // Test 9: Same Treasurer assignment is handled safely (no duplicate write)
  test('9. Re-assigning current Treasurer returns 200 safely without error', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-member-01/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ role: 'TREASURER' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.role, 'TREASURER');
  });

  // Test 10: Audit event created for TREASURER_TRANSFERRED
  test('10. Audit log records TREASURER_TRANSFERRED with safe metadata', async () => {
    const db = getDatabase();
    const row = db
      .prepare("SELECT action, details FROM audit_logs WHERE action = 'TREASURER_TRANSFERRED' ORDER BY created_at DESC LIMIT 1")
      .get() as any;

    assert.ok(row);
    assert.match(row.details, /usr-ntm-member-01/);
    assert.doesNotMatch(row.details, /pin/i);
  });
});

describe('NTM Passbook — Phase 1B-3 Self Profile Tests', () => {
  // Test 11: Member can retrieve own profile
  test('11. Member can retrieve own profile via GET /api/auth/me', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.phone, '9876543212');
    assert.ok(body.organization);
    assert.equal(body.organization.code, 'NTM01');

    // Sensitive field exclusion
    assert.equal(body.user.pin_hash, undefined);
    assert.equal(body.user.pin_salt, undefined);
    assert.equal(body.user.pin, undefined);
  });

  // Test 12: Treasurer can retrieve own profile
  test('12. Treasurer can retrieve own profile via GET /api/auth/me', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.phone, '9876543211');
    assert.equal(body.user.pin_hash, undefined);
  });
});

describe('NTM Passbook — Phase 1B-3 Secure PIN Change Tests', () => {
  let userOldSessionToken = '';
  let userSecondSessionToken = '';
  const testUserPhone = '9876543211'; // usr-ntm-treasurer-01

  before(async () => {
    // Create two active sessions for test user
    const res1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testUserPhone, pin: '1234' }),
    });
    const data1 = await res1.json();
    userOldSessionToken = data1.token;

    const res2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testUserPhone, pin: '1234' }),
    });
    const data2 = await res2.json();
    userSecondSessionToken = data2.token;
  });

  // Test 13: Unauthenticated PIN change rejected (401)
  test('13. Unauthenticated PIN change is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin: '1234', newPin: '5678' }),
    });
    assert.equal(res.status, 401);
  });

  // Test 14: Wrong current PIN is rejected (401)
  test('14. Wrong current PIN is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userOldSessionToken}`,
      },
      body: JSON.stringify({ currentPin: '9999', newPin: '5678' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /सध्याचा PIN चुकीचा आहे/);
  });

  // Test 15: New PIN equal to current PIN is rejected (400)
  test('15. New PIN equal to current PIN is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userOldSessionToken}`,
      },
      body: JSON.stringify({ currentPin: '1234', newPin: '1234' }),
    });
    assert.equal(res.status, 400);
  });

  // Test 16: Malformed PIN rejected (400)
  test('16. Malformed PIN (e.g. 2 digits or letters) is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userOldSessionToken}`,
      },
      body: JSON.stringify({ currentPin: '1234', newPin: '12' }),
    });
    assert.equal(res.status, 400);
  });

  // Test 17: Successful PIN change and session rotation
  let rotatedToken = '';
  test('17. Successful PIN change rotates token and updates database', async () => {
    const res = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userOldSessionToken}`,
      },
      body: JSON.stringify({ currentPin: '1234', newPin: '5678' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.token);
    rotatedToken = body.token;
    assert.notEqual(rotatedToken, userOldSessionToken);
  });

  // Test 18: Previous session tokens are revoked
  test('18. Previous session tokens are revoked and rejected with 401', async () => {
    const res1 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userOldSessionToken}` },
    });
    assert.equal(res1.status, 401);

    const res2 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userSecondSessionToken}` },
    });
    assert.equal(res2.status, 401);
  });

  // Test 19: Rotated token works seamlessly for user
  test('19. Rotated token functions correctly for authenticated user', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rotatedToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.phone, testUserPhone);
  });

  // Test 20: Old PIN is rejected for new logins
  test('20. Old PIN is rejected for new logins (401)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testUserPhone, pin: '1234' }),
    });
    assert.equal(res.status, 401);
  });

  // Test 21: New PIN works for login
  test('21. New PIN logs in successfully (200)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testUserPhone, pin: '5678' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.phone, testUserPhone);
  });

  // Test 22: Audit log records PIN_CHANGED without PIN leakage
  test('22. Audit log records PIN_CHANGED with zero PIN or hash exposure', async () => {
    const db = getDatabase();
    const row = db
      .prepare("SELECT action, details FROM audit_logs WHERE action = 'PIN_CHANGED' ORDER BY created_at DESC LIMIT 1")
      .get() as any;

    assert.ok(row);
    assert.doesNotMatch(row.details, /5678/);
    assert.doesNotMatch(row.details, /1234/);
    assert.doesNotMatch(row.details, /pin_hash/);
  });
});
