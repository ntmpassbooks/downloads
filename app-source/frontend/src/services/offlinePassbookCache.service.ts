import { FinancialTransaction, MemberPassbookResponse } from '../api/ledger.js';

export interface CachedPassbook {
  version: number;
  organizationId: string;
  userId: string;
  member: {
    id: string;
    fullName: string;
    phone: string;
  };
  totalPaid: number;
  totalTransactions: number;
  transactions: FinancialTransaction[];
  lastSyncTimestamp: string; // ISO 8601 string of last authoritative sync
  cachedAt: number; // Unix timestamp
}

export interface PassbookCacheResult {
  passbook: CachedPassbook | null;
  isStale: boolean;
  error?: string;
}

const CACHE_KEY_PREFIX = 'ntm_pb_cache_';
const CACHE_VERSION = 1;
const MAX_TRANSACTIONS_IN_CACHE = 100;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days retention policy

export class OfflinePassbookCacheService {
  /**
   * Deterministic, isolated cache key scoped by organizationId and userId.
   */
  public static getCacheKey(organizationId: string, userId: string): string {
    if (!organizationId || !userId) {
      throw new Error('Organization ID and User ID are required to construct cache key');
    }
    return `${CACHE_KEY_PREFIX}${organizationId.trim()}_${userId.trim()}`;
  }

  /**
   * Saves authoritative server passbook records to private client-side cache.
   * - Enforces tenant and user isolation.
   * - Sanitizes and bounds the stored transaction list to prevent storage bloat.
   * - Strictly excludes PINs, tokens, salts, or credentials.
   */
  public static savePassbook(
    organizationId: string,
    userId: string,
    data: MemberPassbookResponse
  ): boolean {
    if (!organizationId || !userId || !data || !data.member) {
      return false;
    }

    // Safety guard: ensure the data corresponds to the targeted member
    if (data.member.id !== userId) {
      return false;
    }

    try {
      const key = this.getCacheKey(organizationId, userId);

      // Bounded retention: store only the latest transactions
      const boundedTxns: FinancialTransaction[] = (data.transactions || [])
        .slice(0, MAX_TRANSACTIONS_IN_CACHE)
        .map((t) => ({
          id: t.id,
          organizationId: t.organizationId || organizationId,
          memberId: t.memberId,
          memberName: t.memberName,
          actorId: t.actorId,
          actorName: t.actorName,
          transactionType: t.transactionType,
          referenceId: t.referenceId,
          transactionNumber: t.transactionNumber,
          amount: t.amount,
          paymentMethod: t.paymentMethod,
          transactionDate: t.transactionDate,
          status: t.status,
          notes: t.notes || null,
          bishiMonth: t.bishiMonth || undefined,
          createdAt: t.createdAt,
        }));

      const record: CachedPassbook = {
        version: CACHE_VERSION,
        organizationId,
        userId,
        member: {
          id: data.member.id,
          fullName: data.member.fullName,
          phone: data.member.phone,
        },
        totalPaid: Number(data.totalPaid) || 0,
        totalTransactions: Number(data.totalTransactions) || boundedTxns.length,
        transactions: boundedTxns,
        lastSyncTimestamp: new Date().toISOString(),
        cachedAt: Date.now(),
      };

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(record));
        return true;
      }
      return false;
    } catch (err) {
      // Safe degradation on QuotaExceededError or disabled localStorage
      console.warn('Offline passbook cache save warning:', err);
      return false;
    }
  }

  /**
   * Retrieves cached passbook with strict schema, tenant, and integrity checks.
   * - Safely recovers from corrupted, tampered, or expired entries.
   * - Never returns another user's cache.
   */
  public static getPassbook(organizationId: string, userId: string): PassbookCacheResult {
    if (!organizationId || !userId) {
      return { passbook: null, isStale: false, error: 'अवैध वापरकर्ता ओळख.' };
    }

    if (typeof localStorage === 'undefined') {
      return { passbook: null, isStale: false, error: 'स्थानिक स्टोरेज उपलब्ध नाही.' };
    }

    const key = this.getCacheKey(organizationId, userId);
    const raw = localStorage.getItem(key);

    if (!raw) {
      return { passbook: null, isStale: false };
    }

    try {
      const parsed = JSON.parse(raw) as CachedPassbook;

      // 1. Structural & Version Validation
      if (!parsed || typeof parsed !== 'object' || parsed.version !== CACHE_VERSION) {
        this.clearUserPassbook(organizationId, userId);
        return { passbook: null, isStale: false, error: 'कॅश आवृत्ती जुनी किंवा विसंगत आढळली.' };
      }

      // 2. Strict Tenant & User Scoping Validation
      if (parsed.organizationId !== organizationId || parsed.userId !== userId || parsed.member?.id !== userId) {
        // Isolation violation: purge to prevent any cross-account data leakage
        this.clearUserPassbook(organizationId, userId);
        return { passbook: null, isStale: false, error: 'कॅश डेटा दुसऱ्या खात्याशी संबंधित आढळला.' };
      }

      // 3. Array & Type Validation
      if (!Array.isArray(parsed.transactions) || typeof parsed.totalPaid !== 'number' || typeof parsed.lastSyncTimestamp !== 'string') {
        this.clearUserPassbook(organizationId, userId);
        return { passbook: null, isStale: false, error: 'कॅश डेटा रचना अवैध आढळली.' };
      }

      // 4. Expiration / Retention Check
      const age = Date.now() - (parsed.cachedAt || 0);
      if (age > CACHE_TTL_MS) {
        this.clearUserPassbook(organizationId, userId);
        return { passbook: null, isStale: false, error: 'कॅश माहिती कालबाह्य (३० दिवसांपेक्षा जुनी) झाली आहे.' };
      }

      return { passbook: parsed, isStale: true };
    } catch {
      // Corrupt JSON: purge safely and return empty
      this.clearUserPassbook(organizationId, userId);
      return { passbook: null, isStale: false, error: 'कॅश डेटा दूषित आढळल्याने हटवण्यात आला.' };
    }
  }

  /**
   * Purges cached passbook for a specific user and organization.
   */
  public static clearUserPassbook(organizationId: string, userId: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const key = this.getCacheKey(organizationId, userId);
      localStorage.removeItem(key);
    } catch {
      // Ignore
    }
  }

  /**
   * Purges all offline passbook caches across all users and organizations.
   * Triggered on user logout or session expiration (401).
   */
  public static clearAllPassbookCaches(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_KEY_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Checks if network is currently connected.
   */
  public static isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  /**
   * Asserts online state for financial mutations.
   * Throws a localized Marathi error if offline.
   */
  public static assertOnlineForMutation(actionNameMarathi = 'हा आर्थिक व्यवहार'): void {
    if (!this.isOnline()) {
      throw new Error(`इंटरनेट कनेक्शन उपलब्ध नाही. ऑफलाइन असताना ${actionNameMarathi} करता येत नाही.`);
    }
  }
}
