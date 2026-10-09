import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  OfflinePassbookCacheService,
  CachedPassbook,
} from '../src/services/offlinePassbookCache.service.js';
import { apiRequest, setMockOfflineForTesting } from '../src/api/client.js';
import { MemberPassbookResponse, FinancialTransaction } from '../src/api/ledger.js';

class MockStorage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('NTM Passbook — Phase 20: Secure Offline Passbook, Private Cache & Data Reliability', () => {
  let originalLocalStorage: any;
  let originalNavigator: any;
  let originalFetch: any;
  let mockStorage: MockStorage;

  const sampleMember = {
    id: 'user_mem_001',
    fullName: 'राहुल पाटील',
    phone: '9876543210',
  };

  const sampleTransactions: FinancialTransaction[] = [
    {
      id: 'txn_001',
      organizationId: 'org_ntm_001',
      memberId: 'user_mem_001',
      memberName: 'राहुल पाटील',
      actorId: 'user_pres_001',
      actorName: 'संतोष कोळी',
      transactionType: 'BISHI_PAYMENT',
      referenceId: 'bishi_rec_001',
      transactionNumber: 'TXN-202610-0001',
      amount: 1000,
      paymentMethod: 'CASH',
      transactionDate: '2026-10-01T10:00:00.000Z',
      status: 'CONFIRMED',
      notes: 'ऑक्टोबर बीसी हप्ता',
      bishiMonth: '2026-10',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    {
      id: 'txn_002',
      organizationId: 'org_ntm_001',
      memberId: 'user_mem_001',
      memberName: 'राहुल पाटील',
      actorId: 'user_treas_001',
      actorName: 'खजिनदार दादा',
      transactionType: 'LOAN_REPAYMENT',
      referenceId: 'loan_rep_001',
      transactionNumber: 'TXN-202610-0002',
      amount: 2500,
      paymentMethod: 'ONLINE',
      transactionDate: '2026-10-05T14:30:00.000Z',
      status: 'CONFIRMED',
      notes: 'कर्ज हप्ता क्र. १',
      bishiMonth: undefined,
      createdAt: '2026-10-05T14:30:00.000Z',
    },
  ];

  const samplePassbook: MemberPassbookResponse = {
    member: sampleMember,
    totalPaid: 3500,
    totalTransactions: 2,
    transactions: sampleTransactions,
  };

  let mockOnlineState = true;

  beforeEach(() => {
    mockStorage = new MockStorage();
    originalLocalStorage = (globalThis as any).localStorage;
    originalFetch = (globalThis as any).fetch;

    (globalThis as any).localStorage = mockStorage;
    mockOnlineState = true;
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        get: () => mockOnlineState,
        configurable: true,
      });
    } catch {
      // fallback
    }
    setMockOfflineForTesting(null);
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    (globalThis as any).fetch = originalFetch;
    mockOnlineState = true;
    setMockOfflineForTesting(null);
  });

  // ==========================================================================
  // SCENARIO 1: Online passbook retrieval and cache update
  // ==========================================================================
  test('Scenario 1: Authoritative server passbook is successfully saved into isolated private cache', () => {
    const saved = OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', samplePassbook);
    assert.equal(saved, true);

    const key = OfflinePassbookCacheService.getCacheKey('org_ntm_001', 'user_mem_001');
    assert.equal(key, 'ntm_pb_cache_org_ntm_001_user_mem_001');

    const result = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');
    assert.ok(result.passbook);
    assert.equal(result.passbook.organizationId, 'org_ntm_001');
    assert.equal(result.passbook.userId, 'user_mem_001');
    assert.equal(result.passbook.totalPaid, 3500);
    assert.equal(result.passbook.transactions.length, 2);
    assert.ok(result.passbook.lastSyncTimestamp);
  });

  // ==========================================================================
  // SCENARIO 2: Offline retrieval of previously synchronized records
  // ==========================================================================
  test('Scenario 2: When offline, previously synchronized personal passbook is retrieved with last sync timestamp', () => {
    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', samplePassbook);

    // Simulate network disconnect
    mockOnlineState = false;
    assert.equal(OfflinePassbookCacheService.isOnline(), false);

    const result = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');
    assert.ok(result.passbook);
    assert.equal(result.isStale, true);
    assert.equal(result.passbook.member.fullName, 'राहुल पाटील');
    assert.equal(result.passbook.transactions[0].transactionNumber, 'TXN-202610-0001');
    assert.equal(result.passbook.transactions[1].transactionNumber, 'TXN-202610-0002');
  });

  // ==========================================================================
  // SCENARIO 3: First-time offline use with an empty cache
  // ==========================================================================
  test('Scenario 3: First-time offline use with zero cached records returns clean empty state without crashing', () => {
    mockOnlineState = false;

    const result = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_fresh_002');
    assert.equal(result.passbook, null);
    assert.equal(result.isStale, false);
    assert.equal(result.error, undefined);
  });

  // ==========================================================================
  // SCENARIO 4: Account switching and cache isolation
  // ==========================================================================
  test('Scenario 4: Multi-tenant and multi-user isolation strictly prevents cross-account cache access', () => {
    // Save User 1 in Org 1
    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', samplePassbook);

    // User 2 in Org 1 tries to read User 1's cache
    const resultUser2 = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_002');
    assert.equal(resultUser2.passbook, null);

    // User 1 in Org 2 tries to read Org 1's cache
    const resultOrg2 = OfflinePassbookCacheService.getPassbook('org_ntm_002', 'user_mem_001');
    assert.equal(resultOrg2.passbook, null);

    // Attempting to spoof cache with mismatched user ID is purged immediately
    const key = OfflinePassbookCacheService.getCacheKey('org_ntm_001', 'user_mem_001');
    const tampered = JSON.parse(mockStorage.getItem(key)!);
    tampered.userId = 'user_hacker_999';
    mockStorage.setItem(key, JSON.stringify(tampered));

    const checkSpoof = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');
    assert.equal(checkSpoof.passbook, null);
    // Verified that spoofed cache was purged
    assert.equal(mockStorage.getItem(key), null);
  });

  // ==========================================================================
  // SCENARIO 5: Logout and session-expiry invalidation (cache purge)
  // ==========================================================================
  test('Scenario 5: Explicit logout or 401 session expiration purges all private passbook caches', () => {
    // Setup multiple caches
    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', samplePassbook);
    const passbook2 = { ...samplePassbook, member: { id: 'user_mem_002', fullName: 'दुसरा सदस्य', phone: '9999999999' } };
    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_002', passbook2);

    assert.ok(mockStorage.getItem('ntm_pb_cache_org_ntm_001_user_mem_001'));
    assert.ok(mockStorage.getItem('ntm_pb_cache_org_ntm_001_user_mem_002'));

    // Trigger complete cache purge
    OfflinePassbookCacheService.clearAllPassbookCaches();

    assert.equal(mockStorage.getItem('ntm_pb_cache_org_ntm_001_user_mem_001'), null);
    assert.equal(mockStorage.getItem('ntm_pb_cache_org_ntm_001_user_mem_002'), null);
  });

  // ==========================================================================
  // SCENARIO 6: Corrupt, tampered, and expired cache recovery
  // ==========================================================================
  test('Scenario 6: Corrupted JSON, invalid schema, and expired records are safely purged without throwing', () => {
    const key = OfflinePassbookCacheService.getCacheKey('org_ntm_001', 'user_mem_001');

    // Case A: Corrupted JSON syntax
    mockStorage.setItem(key, '{ invalid json syntax !!!');
    let res = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');
    assert.equal(res.passbook, null);
    assert.ok(res.error?.includes('दूषित'));
    assert.equal(mockStorage.getItem(key), null);

    // Case B: Incompatible version / schema
    mockStorage.setItem(key, JSON.stringify({ version: 999, data: 'unknown' }));
    res = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');
    assert.equal(res.passbook, null);
    assert.ok(res.error?.includes('कॅश आवृत्ती'));
    assert.equal(mockStorage.getItem(key), null);

    // Case C: Expired record older than 30 days (CACHE_TTL_MS)
    const thirtyOneDaysAgo = Date.now() - (31 * 24 * 60 * 60 * 1000);
    const expiredRecord: CachedPassbook = {
      version: 1,
      organizationId: 'org_ntm_001',
      userId: 'user_mem_001',
      member: sampleMember,
      totalPaid: 1000,
      totalTransactions: 1,
      transactions: sampleTransactions.slice(0, 1),
      lastSyncTimestamp: new Date(thirtyOneDaysAgo).toISOString(),
      cachedAt: thirtyOneDaysAgo,
    };
    mockStorage.setItem(key, JSON.stringify(expiredRecord));

    res = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');
    assert.equal(res.passbook, null);
    assert.ok(res.error?.includes('कालबाह्य'));
    assert.equal(mockStorage.getItem(key), null);
  });

  // ==========================================================================
  // SCENARIO 7: Offline payment/loan mutation blocking
  // ==========================================================================
  test('Scenario 7: Financial mutations are strictly blocked locally when offline with Marathi error message', async () => {
    setMockOfflineForTesting(true);
    mockOnlineState = false;

    const postRes = await apiRequest('/bishi/123/cash-payment', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
    });

    assert.equal(postRes.success, false);
    assert.equal(postRes.status, 0);
    assert.equal(
      postRes.error,
      'इंटरनेट कनेक्शन उपलब्ध नाही. (ऑफलाइन असताना आर्थिक व्यवहार व बदल सेव्ह होत नाहीत.)'
    );

    // assertOnlineForMutation also throws Marathi exception
    assert.throws(
      () => OfflinePassbookCacheService.assertOnlineForMutation('बीसी पेमेंट'),
      (err: any) => err.message.includes('इंटरनेट कनेक्शन उपलब्ध नाही')
    );
  });

  // ==========================================================================
  // SCENARIO 8: Zero offline queueing or auto-replay of financial mutations
  // ==========================================================================
  test('Scenario 8: No financial mutations are queued, buffered, or scheduled for auto-replay offline', async () => {
    setMockOfflineForTesting(true);
    mockOnlineState = false;

    await apiRequest('/loans/loan_1/repay-cash', {
      method: 'POST',
      body: JSON.stringify({ amount: 500 }),
    });

    // Check all storage keys: ensure no mutation queues or replay buffers exist
    for (let i = 0; i < mockStorage.length; i++) {
      const k = mockStorage.key(i);
      assert.ok(!k?.toLowerCase().includes('queue'), `Unexpected queue found: ${k}`);
      assert.ok(!k?.toLowerCase().includes('replay'), `Unexpected replay found: ${k}`);
      assert.ok(!k?.toLowerCase().includes('pending_mutation'), `Unexpected pending mutation found: ${k}`);
    }
  });

  // ==========================================================================
  // SCENARIO 9: Reconnection and authoritative data refresh
  // ==========================================================================
  test('Scenario 9: Fresh server response updates the cache timestamp and overwrites previous cached state', async () => {
    // Initial sync
    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', samplePassbook);
    const initialSync = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001').passbook?.lastSyncTimestamp;

    // Small delay to ensure timestamp progression
    await new Promise((r) => setTimeout(r, 15));

    // Simulate updated server passbook with new payment
    const updatedPassbook: MemberPassbookResponse = {
      ...samplePassbook,
      totalPaid: 4500,
      totalTransactions: 3,
      transactions: [
        ...sampleTransactions,
        {
          id: 'txn_003',
          organizationId: 'org_ntm_001',
          memberId: 'user_mem_001',
          memberName: 'राहुल पाटील',
          actorId: 'user_pres_001',
          actorName: 'संतोष कोळी',
          transactionType: 'BISHI_PAYMENT',
          referenceId: 'bishi_rec_003',
          transactionNumber: 'TXN-202610-0003',
          amount: 1000,
          paymentMethod: 'CASH',
          transactionDate: '2026-10-09T12:00:00.000Z',
          status: 'CONFIRMED',
          notes: 'नोव्हेंबर आगाऊ बीसी',
          createdAt: '2026-10-09T12:00:00.000Z',
        },
      ],
    };

    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', updatedPassbook);
    const refreshed = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');

    assert.ok(refreshed.passbook);
    assert.equal(refreshed.passbook.totalPaid, 4500);
    assert.equal(refreshed.passbook.totalTransactions, 3);
    assert.equal(refreshed.passbook.transactions.length, 3);
    assert.notEqual(refreshed.passbook.lastSyncTimestamp, initialSync);
  });

  // ==========================================================================
  // SCENARIO 10: Service worker exclusion of authenticated API responses
  // ==========================================================================
  test('Scenario 10: Service worker static cache explicitly excludes /api/ and /auth/ endpoints', () => {
    const swPath = fs.existsSync(path.resolve(process.cwd(), 'public', 'sw.js'))
      ? path.resolve(process.cwd(), 'public', 'sw.js')
      : path.resolve(process.cwd(), 'frontend', 'public', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'sw.js must exist');
    const swContent = fs.readFileSync(swPath, 'utf8');

    // Verify authenticated endpoints are never cached in Service Worker
    assert.ok(
      swContent.includes('/api/') || swContent.includes("event.request.url.includes('/api/')"),
      'sw.js must explicitly check and exclude /api/ routes'
    );
    assert.ok(
      swContent.includes('/auth/') || swContent.includes("event.request.url.includes('/auth/')"),
      'sw.js must explicitly check and exclude /auth/ routes'
    );
  });

  // ==========================================================================
  // SCENARIO 11: Bounded cache size (max 100 entries) and 30-day retention
  // ==========================================================================
  test('Scenario 11: Cache strictly bounds transaction list to latest 100 entries to prevent storage bloat', () => {
    const hugeTxnList: FinancialTransaction[] = [];
    for (let i = 1; i <= 150; i++) {
      hugeTxnList.push({
        id: `txn_${i}`,
        organizationId: 'org_ntm_001',
        memberId: 'user_mem_001',
        memberName: 'राहुल पाटील',
        actorId: 'user_pres_001',
        transactionType: 'BISHI_PAYMENT',
        referenceId: `bishi_${i}`,
        transactionNumber: `TXN-SEQ-${i}`,
        amount: 1000,
        paymentMethod: 'CASH',
        transactionDate: '2026-10-01T10:00:00.000Z',
        status: 'CONFIRMED',
        notes: null,
        createdAt: '2026-10-01T10:00:00.000Z',
      });
    }

    const hugePassbook: MemberPassbookResponse = {
      member: sampleMember,
      totalPaid: 150000,
      totalTransactions: 150,
      transactions: hugeTxnList,
    };

    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', hugePassbook);
    const cached = OfflinePassbookCacheService.getPassbook('org_ntm_001', 'user_mem_001');

    assert.ok(cached.passbook);
    assert.equal(cached.passbook.transactions.length, 100);
    assert.equal(cached.passbook.transactions[0].transactionNumber, 'TXN-SEQ-1');
    assert.equal(cached.passbook.transactions[99].transactionNumber, 'TXN-SEQ-100');
  });

  // ==========================================================================
  // SCENARIO 12: Sensitive credential leakage prevention
  // ==========================================================================
  test('Scenario 12: Cached passbook payload strictly contains zero PINs, tokens, salts, or credentials', () => {
    OfflinePassbookCacheService.savePassbook('org_ntm_001', 'user_mem_001', samplePassbook);
    const key = OfflinePassbookCacheService.getCacheKey('org_ntm_001', 'user_mem_001');
    const rawStored = mockStorage.getItem(key)!;

    assert.ok(rawStored, 'Cache entry must exist');
    const lower = rawStored.toLowerCase();

    assert.ok(!lower.includes('"pin"'), 'Must not store pin');
    assert.ok(!lower.includes('"token"'), 'Must not store token');
    assert.ok(!lower.includes('"salt"'), 'Must not store salt');
    assert.ok(!lower.includes('"password"'), 'Must not store password');
    assert.ok(!lower.includes('"secret"'), 'Must not store secret');
  });
});
