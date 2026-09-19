process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { getDatabase, closeDatabase } from '../src/db/connection.js';
import { PinEncryptionService } from '../src/modules/auth/pin_encryption.service.js';

let server: Server;
let baseUrl: string;

let presidentToken: string;
let treasurerToken: string;
let memberToken: string;
let foreignPresidentToken: string;

let memberId: string;
let presidentId: string;
let foreignMemberId: string;

before(async () => {
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

  // Login as President
  const presRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
  });
  const presData = await presRes.json();
  presidentToken = presData.token;
  presidentId = presData.user.id;

  // Login as Treasurer
  const treasRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543211', pin: '1234' }),
  });
  const treasData = await treasRes.json();
  treasurerToken = treasData.token;

  // Login as Member
  const memRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543212', pin: '1234' }),
  });
  const memData = await memRes.json();
  memberToken = memData.token;
  memberId = memData.user.id;

  // Foreign member ID for tenant isolation tests (belongs to org-jhm-002)
  foreignMemberId = 'usr-jhm-member-02';
});

after(async () => {
  const db = getDatabase();
  try {
    db.prepare("DELETE FROM users WHERE id IN ('usr-legacy-no-enc')").run();
    db.prepare("DELETE FROM users WHERE phone = '9876543266'").run();
  } catch {
    // Ignore cleanup errors
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeDatabase();
});

describe('NTM Passbook — President Secure Recoverable PIN Suite', () => {
  // Test 1: Unauthenticated request to view member PIN
  test('1. Unauthenticated request to GET /api/members/:memberId/pin returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/members/${memberId}/pin`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // Test 2: Unauthenticated request to view own PIN
  test('2. Unauthenticated request to GET /api/auth/my-pin returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/my-pin`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // Test 3: Member cannot view other member PIN
  test('3. Member role cannot view member PIN (rejected with 403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members/${memberId}/pin`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error, /परवानगी नाही|Forbidden/i);
  });

  // Test 4: Member cannot view own PIN via President endpoint
  test('4. Member role cannot view own PIN via GET /api/auth/my-pin (rejected with 403)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/my-pin`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // Test 5: Treasurer cannot view member PIN
  test('5. Treasurer role cannot view member PIN (rejected with 403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members/${memberId}/pin`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // Test 6: Treasurer cannot view own PIN via President endpoint
  test('6. Treasurer role cannot view own PIN via GET /api/auth/my-pin (rejected with 403)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/my-pin`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // Test 7: President can view their own PIN
  test('7. President can view their own PIN via GET /api/auth/my-pin', async () => {
    const res = await fetch(`${baseUrl}/api/auth/my-pin`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.isRecoverable, true);
    assert.equal(body.data.pin, '1234');
  });

  // Test 8: President can view member's PIN in the same Mandal
  test('8. President can view member PIN in same Mandal via GET /api/members/:memberId/pin', async () => {
    const res = await fetch(`${baseUrl}/api/members/${memberId}/pin`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.isRecoverable, true);
    assert.equal(body.data.pin, '1234');
    assert.equal(body.data.fullName, 'राहुल पाटील');
  });

  // Test 9: Cross-tenant IDOR protection: President cannot view PIN of member in another Mandal
  test('9. Cross-tenant IDOR defense: President cannot view PIN of another Mandal member (404)', async () => {
    const res = await fetch(`${baseUrl}/api/members/${foreignMemberId}/pin`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // Test 10: Non-existent member ID returns 404
  test('10. Non-existent memberId returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/members/usr-non-existent-999/pin`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // Test 11: Account without encrypted PIN returns isRecoverable: false and clean Marathi message (no fake PIN)
  test('11. Account without encrypted PIN returns isRecoverable: false (no fake PIN)', async () => {
    const db = getDatabase();
    // Insert user with NULL encrypted_pin
    const unrecoveredId = 'usr-legacy-no-enc';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, encrypted_pin, pin_iv, pin_auth_tag, is_active)
      VALUES (?, 'org-ntm-001', '9876543288', 'जुना सदस्य', 'MEMBER', 'hash', 'salt', NULL, NULL, NULL, 1)
    `).run(unrecoveredId);

    const res = await fetch(`${baseUrl}/api/members/${unrecoveredId}/pin`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.isRecoverable, false);
    assert.equal(body.data.pin, undefined);
    assert.match(body.data.message, /या PIN ची सुरक्षित माहिती उपलब्ध नाही/);
  });

  // Test 12: Newly created member via API has encrypted PIN and can be viewed by President
  test('12. Newly created member via POST /api/members has encrypted PIN and can be viewed', async () => {
    const newMemberPhone = '9876543266';
    const createRes = await fetch(`${baseUrl}/api/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        fullName: 'प्रमोद जाधव',
        phone: newMemberPhone,
        initialPin: '4321',
        role: 'MEMBER',
      }),
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    const newId = createData.data.id;

    // View PIN
    const viewRes = await fetch(`${baseUrl}/api/members/${newId}/pin`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(viewRes.status, 200);
    const viewBody = await viewRes.json();
    assert.equal(viewBody.data.isRecoverable, true);
    assert.equal(viewBody.data.pin, '4321');
  });

  // Test 13: Plaintext PIN is never stored in database
  test('13. Plaintext PIN is never stored directly in users table', async () => {
    const db = getDatabase();
    const rows = db.prepare('SELECT id, phone, pin_hash, encrypted_pin FROM users').all() as any[];
    for (const row of rows) {
      assert.notEqual(row.pin_hash, '1234');
      assert.notEqual(row.pin_hash, '4321');
      assert.notEqual(row.encrypted_pin, '1234');
      assert.notEqual(row.encrypted_pin, '4321');
      // Verify encrypted_pin is hex formatted and longer than plaintext
      if (row.encrypted_pin) {
        assert.match(row.encrypted_pin, /^[0-9a-f]+$/i);
        assert.ok(row.encrypted_pin.length >= 8);
      }
    }
  });

  // Test 14: Audit logs do NOT record plaintext or encrypted PIN
  test('14. Audit logs NEVER record plaintext PIN or decrypted secret', async () => {
    const db = getDatabase();
    const auditLogs = db.prepare("SELECT * FROM audit_logs WHERE action IN ('MEMBER_PIN_VIEWED', 'PRESIDENT_OWN_PIN_VIEWED')").all() as any[];
    assert.ok(auditLogs.length >= 2, 'Should have recorded audit logs for pin viewing');
    for (const log of auditLogs) {
      assert.doesNotMatch(log.details, /1234/);
      assert.doesNotMatch(log.details, /4321/);
      assert.doesNotMatch(log.details, /pin:/i);
      assert.doesNotMatch(log.details, /password/i);
    }
  });

  // Test 15: AES-256-GCM encryption & decryption round-trip unit test
  test('15. PinEncryptionService encrypts and decrypts accurately', () => {
    const testPins = ['1234', '987654', '0000', '112233'];
    for (const p of testPins) {
      const enc = PinEncryptionService.encryptPin(p);
      assert.ok(enc.encryptedPin);
      assert.ok(enc.pinIv);
      assert.ok(enc.pinAuthTag);
      assert.equal(enc.pinKeyVersion, 1);

      const decrypted = PinEncryptionService.decryptPin(enc.encryptedPin, enc.pinIv, enc.pinAuthTag);
      assert.equal(decrypted, p);
    }
  });

  // Test 16: Tampering with ciphertext or auth tag fails authentication
  test('16. Tampering with ciphertext or tag throws decryption error', () => {
    const enc = PinEncryptionService.encryptPin('1234');
    // Tamper ciphertext
    const tamperedCipher = enc.encryptedPin.substring(0, enc.encryptedPin.length - 2) + 'ff';
    assert.throws(() => {
      PinEncryptionService.decryptPin(tamperedCipher, enc.pinIv, enc.pinAuthTag);
    });

    // Tamper auth tag
    const tamperedTag = 'ff' + enc.pinAuthTag.substring(2);
    assert.throws(() => {
      PinEncryptionService.decryptPin(enc.encryptedPin, enc.pinIv, tamperedTag);
    });
  });

  // Test 17-20: Changing PIN updates both scrypt hash and encrypted PIN, revokes old sessions, and allows login
  test('17-20. PATCH /api/auth/pin rotates credentials and session', async () => {
    // 17. Change President PIN from 1234 to 7788
    const changeRes = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${presidentToken}`,
      },
      body: JSON.stringify({
        currentPin: '1234',
        newPin: '7788',
      }),
    });
    assert.equal(changeRes.status, 200);
    const changeBody = await changeRes.json();
    assert.equal(changeBody.success, true);
    const newPresidentToken = changeBody.token;

    // 18. Old session token is revoked
    const oldSessionRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.equal(oldSessionRes.status, 401, 'Old session token must be rejected');

    // 19. Old PIN no longer authenticates for login
    const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '1234' }),
    });
    assert.equal(oldLoginRes.status, 401, 'Old PIN must fail');

    // 20. New PIN successfully authenticates
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', pin: '7788' }),
    });
    assert.equal(newLoginRes.status, 200, 'New PIN must succeed');

    // 21. President can view the updated PIN (7788)
    const viewUpdatedRes = await fetch(`${baseUrl}/api/auth/my-pin`, {
      headers: { Authorization: `Bearer ${newPresidentToken}` },
    });
    assert.equal(viewUpdatedRes.status, 200);
    const viewUpdatedBody = await viewUpdatedRes.json();
    assert.equal(viewUpdatedBody.data.isRecoverable, true);
    assert.equal(viewUpdatedBody.data.pin, '7788');

    // 22. Restore President PIN back to 1234 to preserve shared database state for other test suites
    const restoreRes = await fetch(`${baseUrl}/api/auth/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newPresidentToken}`,
      },
      body: JSON.stringify({
        currentPin: '7788',
        newPin: '1234',
      }),
    });
    assert.equal(restoreRes.status, 200);
  });
});
