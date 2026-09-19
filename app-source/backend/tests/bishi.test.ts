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

const NTM_ORG_ID = 'org-ntm-001';
const JHM_ORG_ID = 'org-jhm-002';
const NTM_MEMBER_ID = 'usr-ntm-member-01';
const JHM_MEMBER_ID = 'usr-jhm-member-02';

before(async () => {
  seedDatabase();
  const db = getDatabase();

  // Create President for Mandal 2 to verify cross-mandal barriers
  const { hash, salt } = await import('../src/modules/auth/auth.service.js').then((m) =>
    m.AuthService.hashPin('1234')
  );
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    'usr-jhm-president-02',
    JHM_ORG_ID,
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
});

describe('NTM Passbook — Phase 1C Bishi Foundation Tests', () => {
  test('1. Safeguard 1: Unconfigured member returns null (ZERO default Bishi amount)', async () => {
    const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data, null, 'Unconfigured member must have null data, not a default amount');
  });

  test('2. Member cannot configure Bishi (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${memberToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 1000, dueDay: 10 }),
    });
    assert.strictEqual(res.status, 403, 'Member must be forbidden from configuring Bishi');
  });

  test('3. Treasurer can configure Bishi for a member (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${treasurerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 1000, dueDay: 10 }),
    });
    assert.strictEqual(res.status, 200, 'Treasurer must be authorized to configure Bishi');
    const body = await res.json();
    assert.strictEqual(body.success, true);
  });

  test('4. Validation: Invalid amounts or days are rejected with 400', async () => {
    // Negative/zero amount
    const res1 = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 0, dueDay: 10 }),
    });
    assert.strictEqual(res1.status, 400);

    // Due day > 31
    const res2 = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 1000, dueDay: 32 }),
    });
    assert.strictEqual(res2.status, 400);
  });

  test('5. Cross-Mandal Isolation: President of NTM cannot configure member of JHM', async () => {
    const res = await fetch(`${baseUrl}/api/members/${JHM_MEMBER_ID}/bishi-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 1000, dueDay: 10 }),
    });
    assert.ok(res.status === 404 || res.status === 403, 'Cross-tenant configuration must fail');
  });

  test('6. President successfully configures real Bishi amount and due day', async () => {
    const res = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 1000, dueDay: 31 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.monthlyAmount, 1000);
    assert.strictEqual(body.data.dueDay, 31);
    assert.strictEqual(body.data.memberId, NTM_MEMBER_ID);

    // Direct DB check
    const db = getDatabase();
    const row = db
      .prepare('SELECT monthly_amount, due_day FROM bishi_configs WHERE member_id = ?')
      .get(NTM_MEMBER_ID) as any;
    assert.strictEqual(row.monthly_amount, 1000);
    assert.strictEqual(row.due_day, 31);
  });

  test('7. Due-Date Snapshot & Month Length Clamping: 31st clamps safely to month end', async () => {
    // Generate cycle for April 2026 (30 days in April)
    const res = await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthYear: '2026-04' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.generatedCount, 1);

    // Check member's record due date
    const recRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-records`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const recBody = await recRes.json();
    const aprRecord = recBody.data.find((r: any) => r.monthYear === '2026-04');
    assert.ok(aprRecord, 'April record must exist');
    assert.strictEqual(aprRecord.dueDate, '2026-04-30', '31st in April must clamp to 2026-04-30');
    assert.strictEqual(aprRecord.expectedAmount, 1000);
  });

  test('8. Safeguard 5: Newly generated Bishi record status is strictly PENDING and paid_amount is 0', async () => {
    const recRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-records`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const recBody = await recRes.json();
    const record = recBody.data.find((r: any) => r.monthYear === '2026-04');
    assert.strictEqual(record.status, 'PENDING', 'Record status must be PENDING');
    assert.strictEqual(record.paidAmount, 0, 'Paid amount must be 0');
    assert.strictEqual(record.paidDate, null, 'Paid date must be null');
  });

  test('9. Duplicate Cycle Protection: Generating cycle again skips without creating duplicate', async () => {
    const res = await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthYear: '2026-04' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.generatedCount, 0, 'Should generate 0 new records');
    assert.strictEqual(body.data.skippedCount, 1, 'Should skip 1 existing record');

    // Verify DB count
    const db = getDatabase();
    const rows = db
      .prepare('SELECT count(*) as cnt FROM bishi_records WHERE member_id = ? AND month_year = ?')
      .get(NTM_MEMBER_ID, '2026-04') as any;
    assert.strictEqual(rows.cnt, 1, 'Exactly one record must exist for 2026-04');
  });

  test('10. Database Constraint: Duplicate insertion throws SQLite UNIQUE constraint violation', () => {
    const db = getDatabase();
    assert.throws(() => {
      db.prepare(`
        INSERT INTO bishi_records (
          id, organization_id, member_id, bishi_config_id,
          month_year, expected_amount, due_date, status, paid_amount
        ) VALUES ('fake-id-999', ?, ?, 'some-cfg', '2026-04', 1000, '2026-04-30', 'PENDING', 0)
      `).run(NTM_ORG_ID, NTM_MEMBER_ID);
    }, /UNIQUE constraint failed/);
  });

  test('11. Safeguard 2: Historical Immutability (updating config does NOT change past records)', async () => {
    // Member currently has 2026-04 record with ₹1000.
    // President now raises Bishi amount to ₹2500 and changes due day to 15.
    const updateRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlyAmount: 2500, dueDay: 15 }),
    });
    assert.strictEqual(updateRes.status, 200);

    // Fetch records and verify 2026-04 is STILL ₹1000 and due date is STILL 2026-04-30!
    const recRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-records`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const recBody = await recRes.json();
    const aprRecord = recBody.data.find((r: any) => r.monthYear === '2026-04');
    assert.strictEqual(aprRecord.expectedAmount, 1000, 'Historical expected amount must remain ₹1000');
    assert.strictEqual(aprRecord.dueDate, '2026-04-30', 'Historical due date must remain 2026-04-30');

    // Generate cycle for May 2026 -> new cycle uses new ₹2500 amount and 15th due date!
    const genRes = await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${presidentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthYear: '2026-05' }),
    });
    assert.strictEqual(genRes.status, 200);

    const recRes2 = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-records`, {
      headers: { Authorization: `Bearer ${presidentToken}` },
    });
    const recBody2 = await recRes2.json();
    const mayRecord = recBody2.data.find((r: any) => r.monthYear === '2026-05');
    const pastAprRecord = recBody2.data.find((r: any) => r.monthYear === '2026-04');

    assert.strictEqual(mayRecord.expectedAmount, 2500, 'May record must reflect new ₹2500 amount');
    assert.strictEqual(mayRecord.dueDate, '2026-05-15', 'May record must reflect new due date 2026-05-15');
    assert.strictEqual(pastAprRecord.expectedAmount, 1000, 'Past April record remains strictly ₹1000');
  });

  test('12. Member Self-Service: Member can view own config and records', async () => {
    // Member views own config
    const cfgRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(cfgRes.status, 200);
    const cfgBody = await cfgRes.json();
    assert.strictEqual(cfgBody.data.monthlyAmount, 2500);

    // Member views own records
    const recRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(recRes.status, 200);
    const recBody = await recRes.json();
    assert.strictEqual(recBody.data.length, 2);
  });

  test('13. Member Isolation: Member cannot view another member\'s config or records (403 Forbidden)', async () => {
    // Member attempts to view Treasurer's config
    const cfgRes = await fetch(`${baseUrl}/api/members/usr-ntm-treasurer-01/bishi-config`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(cfgRes.status, 403);

    // Member attempts to view Treasurer's records
    const recRes = await fetch(`${baseUrl}/api/members/usr-ntm-treasurer-01/bishi-records`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(recRes.status, 403);
  });

  test('14. Inactive Member Handling: Inactive member cannot be configured & is skipped in cycle', async () => {
    const db = getDatabase();
    // Deactivate member
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(NTM_MEMBER_ID);

    try {
      // Attempting to configure inactive member fails with 400
      const cfgRes = await fetch(`${baseUrl}/api/members/${NTM_MEMBER_ID}/bishi-config`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthlyAmount: 3000, dueDay: 20 }),
      });
      assert.strictEqual(cfgRes.status, 400);

      // Generating cycle for June 2026 skips inactive member
      const genRes = await fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-06' }),
      });
      assert.strictEqual(genRes.status, 200);
      const genBody = await genRes.json();
      assert.strictEqual(genBody.data.generatedCount, 0, 'Inactive member must not have record generated');
    } finally {
      // Re-activate member for cleanup
      db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(NTM_MEMBER_ID);
    }
  });

  test('15. Mandal Bishi Overview: President and Treasurer can retrieve overview', async () => {
    const res = await fetch(`${baseUrl}/api/bishi/overview?monthYear=2026-05`, {
      headers: { Authorization: `Bearer ${treasurerToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.summary);
    assert.strictEqual(body.data.summary.totalConfigured, 1);
    assert.strictEqual(body.data.summary.totalRecordsGenerated, 1);
  });

  test('16. Audit Logging: Actions BISHI_CONFIG_SET, BISHI_CONFIG_UPDATED, BISHI_CYCLE_GENERATED exist', () => {
    const db = getDatabase();
    const logs = db
      .prepare("SELECT action, details FROM audit_logs WHERE organization_id = ? AND action LIKE 'BISHI_%'")
      .all(NTM_ORG_ID) as any[];

    const actions = logs.map((l) => l.action);
    assert.ok(actions.includes('BISHI_CONFIG_SET'), 'Must log BISHI_CONFIG_SET');
    assert.ok(actions.includes('BISHI_CONFIG_UPDATED'), 'Must log BISHI_CONFIG_UPDATED');
    assert.ok(actions.includes('BISHI_CYCLE_GENERATED'), 'Must log BISHI_CYCLE_GENERATED');
  });

  test('17. Concurrent Cycle Generation: Simultaneous requests do not create duplicate records', async () => {
    // Run two concurrent cycle generations for July 2026
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-07' }),
      }),
      fetch(`${baseUrl}/api/bishi/generate-cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${presidentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monthYear: '2026-07' }),
      }),
    ]);

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res2.status, 200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    const totalGenerated = body1.data.generatedCount + body2.data.generatedCount;
    assert.strictEqual(totalGenerated, 1, 'Exactly one record should be generated across concurrent calls');

    // Confirm DB has exactly 1 record for 2026-07
    const db = getDatabase();
    const countRow = db
      .prepare('SELECT count(*) as cnt FROM bishi_records WHERE member_id = ? AND month_year = ?')
      .get(NTM_MEMBER_ID, '2026-07') as any;
    assert.strictEqual(countRow.cnt, 1);
  });
});
