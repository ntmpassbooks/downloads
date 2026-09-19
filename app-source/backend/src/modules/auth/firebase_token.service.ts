import { getFirebaseAuth } from '../../config/firebaseAdmin.js';
import { Role } from '../../types/roles.js';

export interface FirebaseTokenUser {
  id: string;
  role: Role;
  organizationId: string;
  phone: string;
}

export interface FirebaseClaims {
  role: Role;
  organizationId: string;
  phone: string;
  [key: string]: any;
}

let mockTokenGenerator: ((uid: string, claims: FirebaseClaims) => Promise<string>) | null = null;

export class FirebaseTokenService {
  /**
   * Generates a Firebase Custom Auth Token for an authenticated NTM Passbook user.
   *
   * UID: Strictly uses the user's UUID from the authoritative SQLite database.
   * Claims: role, organizationId, and phone derived strictly from the server-side user record.
   *
   * Returns: Signed custom token string, or null if Firebase Admin is not configured / fails.
   */
  public static async createCustomToken(user: FirebaseTokenUser): Promise<string | null> {
    if (!user || !user.id) {
      return null;
    }

    const claims: FirebaseClaims = {
      role: user.role,
      organizationId: user.organizationId,
      phone: user.phone,
    };

    // Test hook for isolated testing
    if (mockTokenGenerator) {
      return mockTokenGenerator(user.id, claims);
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      return null;
    }

    try {
      const customToken = await auth.createCustomToken(user.id, claims);
      return customToken;
    } catch (error: any) {
      // Safe log: Never print tokens or keys
      console.warn('⚠️ Could not generate Firebase Custom Token:', error?.message || 'Unknown error');
      return null;
    }
  }

  /**
   * Test helper to simulate Firebase token generation in offline/test environments
   */
  public static setMockTokenGeneratorForTesting(
    generator: ((uid: string, claims: FirebaseClaims) => Promise<string>) | null
  ): void {
    mockTokenGenerator = generator;
  }
}
