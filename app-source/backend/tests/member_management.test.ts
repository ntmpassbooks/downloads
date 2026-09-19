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

  // Create a President for the second mandal (JHM02) to test cross-tenant attacks
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
    'प्रकाश जाधव (अध्यक्ष)',
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

  // Login as NTM Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  const treasData = await treasRes.json();
  treasurerToken = treasData.token;

  // Login as NTM Member
  const memRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  const memData = await memRes.json();
  memberToken = memData.token;

  // Login as JHM President (Secondary Mandal)
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

describe('NTM Passbook — Phase 1B-1 Member Management Backend Tests', () => {
  let createdMemberId = '';
  const newMemberPhone = '9876543220';

  // 1. Authorization: Unauthenticated rejected
  test('1. Unauthenticated user cannot create a member (401)', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: newMemberPhone,
        fullName: 'विजय चव्हाण',
      }),
    });
    assert.equal(res.status, 401);
  });

  // 2. Authorization: Member cannot create member
  test('2. Member cannot create another member (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        phone: newMemberPhone,
        fullName: 'विजय चव्हाण',
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /अधिकार नाही/);
  });

  // 3. Authorization: Treasurer cannot create member
  test('3. Treasurer cannot create a member (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${treasurerToken}`,
      },
      body: JSON.stringify({
        phone: newMemberPhone,
        fullName: 'विजय चव्हाण',
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /अधिकार नाही/);
  });

  // 4. Role Constraint: Cannot create account with role PRESIDENT
  test('4. President cannot create another account with role PRESIDENT (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        phone: '9876543221',
        fullName: 'दुसरा अध्यक्ष',
        role: 'PRESIDENT',
      }),
    });
    assert.equal(res.status, 400);
  });

  // 5. Successful Member Creation by President
  test('5. President can create a new Member inside own Mandal (201 Created)', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        phone: newMemberPhone,
        fullName: 'विजय चव्हाण',
        initialPin: '4321',
        role: 'MEMBER',
        // Attempt IDOR: provide another organizationId
        organizationId: 'org-jhm-002',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    createdMemberId = body.data.id;

    // Verify Organization Ownership: must be President's own mandal (org-ntm-001)
    assert.equal(body.data.organizationId, 'org-ntm-001');
    assert.equal(body.data.phone, newMemberPhone);
    assert.equal(body.data.fullName, 'विजय चव्हाण');
    assert.equal(body.data.role, 'MEMBER');
    assert.equal(body.data.isActive, true);

    // Security Verification: Zero secret exposure
    assert.equal(body.data.pin_hash, undefined);
    assert.equal(body.data.pin_salt, undefined);
    assert.equal(body.data.pin, undefined);
  });

  // 6. Database Persistence Verification
  test('6. Newly created member actually persists in SQLite database', async () => {
    const db = getDatabase();
    const row = db.prepare('SELECT id, phone, organization_id, is_active FROM users WHERE id = ?').get(createdMemberId) as any;
    assert.ok(row);
    assert.equal(row.phone, newMemberPhone);
    assert.equal(row.organization_id, 'org-ntm-001');
    assert.equal(row.is_active, 1);
  });

  // 7. Duplicate phone rejection within same Mandal
  test('7. Duplicate phone within same Mandal is rejected with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        phone: newMemberPhone,
        fullName: 'दुसरा विजय',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /आधीपासून अस्तित्वात आहे/);
  });

  // 8. Global phone uniqueness: Attempting to register same phone number in a different Mandal is rejected with 409 Conflict
  test('8. Same phone number in a different Mandal is rejected with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secondMandalPresidentToken}`,
      },
      body: JSON.stringify({
        phone: newMemberPhone,
        fullName: 'विजय चव्हाण (JHM)',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'हा मोबाईल क्रमांक आधीच नोंदणीकृत आहे. कृपया लॉगिन करा.');
  });

  // 9. Newly created member can log in using initialPin
  test('9. Newly created Member can log in successfully with initial PIN', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: newMemberPhone,
        pin: '4321',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.phone, newMemberPhone);
    assert.equal(body.organization.code, 'NTM01');
  });

  // 10. Member List API: President can retrieve own Mandal members with pagination
  test('10. President can retrieve own Mandal member directory with pagination', async () => {
    const res = await fetch(`${baseUrl}/api/members?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 4); // President, Treasurer, 2 Members
    assert.ok(body.pagination.total >= 4);

    // Ensure all returned members belong to org-ntm-001
    for (const m of body.data) {
      assert.equal(m.organizationId, 'org-ntm-001');
      assert.equal(m.pin_hash, undefined);
      assert.equal(m.pin_salt, undefined);
    }
  });

  // 11. Member List API: Non-President is rejected
  test('11. Non-President cannot access member directory (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
  });

  // 12. Member Details API: President can view own member details
  test('12. President can view individual member details in own Mandal', async () => {
    const res = await fetch(`${baseUrl}/api/members/${createdMemberId}`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, createdMemberId);
    assert.equal(body.data.fullName, 'विजय चव्हाण');
    assert.equal(body.data.pin_hash, undefined);
  });

  // 13. IDOR Defense: President cannot access member from another Mandal
  test('13. President cannot access member belonging to another Mandal (403 Forbidden)', async () => {
    // usr-jhm-member-02 belongs to org-jhm-002
    const res = await fetch(`${baseUrl}/api/members/usr-jhm-member-02`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /सुरक्षा उल्लंघन/);
  });

  // 14. Non-existent member returns 404
  test('14. Requesting non-existent member returns 404 Not Found', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-fake-99999`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 404);
  });

  // 15. Member Deactivation
  let newMemberToken = '';
  test('15. President can deactivate a Member', async () => {
    // First, login as the member to get an active session
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: newMemberPhone, pin: '4321' }),
    });
    const loginData = await loginRes.json();
    newMemberToken = loginData.token;
    assert.ok(newMemberToken);

    // Deactivate member
    const res = await fetch(`${baseUrl}/api/members/${createdMemberId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.isActive, false);

    // Verify historical record still exists in DB
    const db = getDatabase();
    const row = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(createdMemberId) as any;
    assert.ok(row);
    assert.equal(row.is_active, 0);
  });

  // 16. Deactivated Member session is invalidated and login is rejected
  test('16. Deactivated member session is immediately revoked and login is denied (401)', async () => {
    // Prior session token should fail
    const sessionRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newMemberToken}` },
    });
    assert.equal(sessionRes.status, 401);

    // Fresh login attempt should fail
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: newMemberPhone, pin: '4321' }),
    });
    assert.equal(loginRes.status, 401);
  });

  // 17. Role Safety: President cannot deactivate own account or another President
  test('17. President cannot deactivate own account (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-president-01/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(res.status, 400);
  });

  // 18. Member Re-activation
  test('18. President can re-activate a deactivated Member', async () => {
    const res = await fetch(`${baseUrl}/api/members/${createdMemberId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({ isActive: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.isActive, true);

    // Now member can log in again
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: newMemberPhone, pin: '4321' }),
    });
    assert.equal(loginRes.status, 200);
  });

  // 19. Audit Logging Verification
  test('19. Audit log records exist for MEMBER_CREATED, MEMBER_DEACTIVATED, MEMBER_ACTIVATED', async () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT action, organization_id, user_id, details FROM audit_logs WHERE organization_id = ?')
      .all('org-ntm-001') as any[];

    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes('MEMBER_CREATED'));
    assert.ok(actions.includes('MEMBER_DEACTIVATED'));
    assert.ok(actions.includes('MEMBER_ACTIVATED'));

    // Check that details contain safe information and NO PINs
    const creationLog = rows.find((r) => r.action === 'MEMBER_CREATED');
    assert.ok(creationLog);
    assert.match(creationLog.details, /विजय चव्हाण/);
    assert.doesNotMatch(creationLog.details, /4321/);
    assert.doesNotMatch(creationLog.details, /pin_hash/);
  });

  // 20. Member Search by Name
  test('20. Member Search by Name returns matching results from real DB', async () => {
    const res = await fetch(`${baseUrl}/api/members?search=विजय`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.length >= 1);
    assert.ok(body.data.some((m: any) => m.fullName.includes('विजय')));
  });

  // 21. Member Search by Phone
  test('21. Member Search by Phone returns matching results from real DB', async () => {
    const res = await fetch(`${baseUrl}/api/members?search=3220`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.length >= 1);
    assert.ok(body.data.some((m: any) => m.phone.includes('3220')));
  });

  // 22. President can permanently delete member with zero financial history
  test('22. President can permanently delete member with zero financial history', async () => {
    // 1. Create a zero-history member
    const createRes = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        fullName: 'तात्पुरता सदस्य (हटवण्यासाठी)',
        phone: '9876543295',
        initialPin: '1234',
        role: 'MEMBER',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const tempMemberId = created.data.id;

    // 2. Delete as President
    const delRes = await fetch(`${baseUrl}/api/members/${tempMemberId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json();
    assert.equal(delBody.success, true);
    assert.equal(delBody.data.status, 'DELETED');

    // 3. Verify user completely removed from database
    const db = getDatabase();
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(tempMemberId);
    assert.equal(row, undefined);

    // 4. Verify audit log was recorded
    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'MEMBER_PERMANENTLY_DELETED' AND details LIKE ?").get(`%${tempMemberId}%`) as any;
    assert.ok(audit);
  });

  // 23. President deleting member with financial history safely archives/deactivates them and preserves ledger
  test('23. President deleting member with financial history safely archives/deactivates them and preserves ledger', async () => {
    // 1. Create a member
    const createRes = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        fullName: 'आर्थिक व्यवहाराचा सदस्य',
        phone: '9876543288',
        initialPin: '1234',
        role: 'MEMBER',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const financialMemberId = created.data.id;

    // 2. Insert a real ledger transaction for this member
    const db = getDatabase();
    db.prepare(`
      INSERT INTO financial_transactions (
        id, organization_id, member_id, actor_id, transaction_type, reference_id,
        transaction_number, amount, payment_method, transaction_date, status
      ) VALUES (?, 'org-ntm-001', ?, 'usr-ntm-president-01', 'BISHI_PAYMENT', 'ref-test-01', 'TXN-TEST-001', 500, 'CASH', CURRENT_TIMESTAMP, 'CONFIRMED')
    `).run('txn-test-financial-01', financialMemberId);

    // 3. Delete as President
    const delRes = await fetch(`${baseUrl}/api/members/${financialMemberId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json();
    assert.equal(delBody.success, true);
    assert.equal(delBody.data.status, 'ARCHIVED');

    // Member row is preserved with is_active = 0
    const userRow = db.prepare('SELECT is_active FROM users WHERE id = ?').get(financialMemberId) as any;
    assert.equal(userRow.is_active, 0);

    // Transaction remains 100% intact!
    const txnRow = db.prepare('SELECT id FROM financial_transactions WHERE id = ?').get('txn-test-financial-01');
    assert.ok(txnRow);

    // Audit log recorded
    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'MEMBER_DELETED_ARCHIVED' AND details LIKE ?").get(`%${financialMemberId}%`) as any;
    assert.ok(audit);
  });

  // 24. Treasurer cannot delete members (403 Forbidden)
  test('24. Treasurer cannot delete members (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-member-01`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.equal(res.status, 403);
  });

  // 25. Member cannot delete members (403 Forbidden)
  test('25. Member cannot delete members (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-member-01`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
  });

  // 26. Cross-mandal member deletion blocked (403 Forbidden)
  test('26. Cross-mandal member deletion blocked (403 Forbidden)', async () => {
    // secondMandalPresidentToken tries to delete NTM member (usr-ntm-member-01 exists in NTM)
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-member-01`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secondMandalPresidentToken}` },
    });
    assert.equal(res.status, 403);
  });

  // 27. President cannot delete self or another President (400 Bad Request)
  test('27. President cannot delete self or another President (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-ntm-president-01`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 400);
  });
});
