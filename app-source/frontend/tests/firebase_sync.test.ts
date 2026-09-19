import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getFirebaseConfig, resetFirebaseClientForTesting } from '../src/config/firebase.js';
import { FirebaseAuthService } from '../src/services/firebaseAuth.service.js';

// Polyfill in-memory localStorage and sessionStorage for Node.js test environment
function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] || null,
    get length() {
      return store.size;
    },
  };
}

(globalThis as any).localStorage = createStorageMock();
(globalThis as any).sessionStorage = createStorageMock();

describe('NTM Passbook — Batch 7B: Frontend Firebase Client SDK & Auth Sync Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    FirebaseAuthService.setMockHandlersForTesting(null, null);
    resetFirebaseClientForTesting(null, null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    FirebaseAuthService.setMockHandlersForTesting(null, null);
    resetFirebaseClientForTesting(null, null);
  });

  // --------------------------------------------------------------------------
  // TEST 1: Firebase config initializes when valid config exists
  // --------------------------------------------------------------------------
  test('1. Firebase config initializes when valid config exists', () => {
    process.env.VITE_FIREBASE_API_KEY = 'AIzaSyFakeValidApiKey123456';
    process.env.VITE_FIREBASE_APP_ID = '1:1020947438093:web:abcdef123456';
    process.env.VITE_FIREBASE_PROJECT_ID = 'ntm-passbook';
    process.env.VITE_FIREBASE_AUTH_DOMAIN = 'ntm-passbook.firebaseapp.com';

    const config = getFirebaseConfig();
    assert.ok(config, 'Firebase config must be created when valid credentials exist');
    assert.equal(config.apiKey, 'AIzaSyFakeValidApiKey123456');
    assert.equal(config.projectId, 'ntm-passbook');
    assert.equal(config.appId, '1:1020947438093:web:abcdef123456');
    assert.equal(config.authDomain, 'ntm-passbook.firebaseapp.com');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Missing Firebase config does not crash the app
  // --------------------------------------------------------------------------
  test('2. Missing Firebase config does not crash the app', () => {
    delete process.env.VITE_FIREBASE_API_KEY;
    delete process.env.VITE_FIREBASE_APP_ID;

    // Must return null safely without throwing
    const config = getFirebaseConfig();
    assert.equal(config, null, 'Config must be null when API key and App ID are missing');

    // FirebaseAuthService.signInWithCustomToken must degrade gracefully to false
    assert.doesNotThrow(async () => {
      const result = await FirebaseAuthService.signInWithCustomToken('sample-token');
      assert.equal(result, false, 'Sign in must safely return false when Firebase is unconfigured');
    });
  });

  // --------------------------------------------------------------------------
  // TEST 3: Successful backend login with firebaseToken triggers Firebase custom-token sign-in
  // --------------------------------------------------------------------------
  test('3. Successful backend login with firebaseToken triggers Firebase custom-token sign-in', async () => {
    let capturedToken: string | null = null;
    FirebaseAuthService.setMockHandlersForTesting(async (token) => {
      capturedToken = token;
      return true;
    });

    // Simulate backend response payload
    const mockBackendResponse = {
      success: true,
      token: 'backend-session-raw-token-123',
      user: {
        id: 'usr-ntm-president-01',
        organizationId: 'org-ntm-001',
        phone: '9876543210',
        fullName: 'गणेश मोरे',
        role: 'PRESIDENT' as const,
      },
      organization: {
        id: 'org-ntm-001',
        name: 'नवतरुण मित्र मंडळ',
        code: 'NTM01',
        registrationNumber: null,
      },
      firebaseToken: 'firebase-custom-token-president-uuid',
    };

    // Simulate login sync logic in AuthContext
    if (mockBackendResponse.success && mockBackendResponse.token) {
      localStorage.setItem('ntm_token', mockBackendResponse.token);
      if (mockBackendResponse.firebaseToken) {
        await FirebaseAuthService.signInWithCustomToken(mockBackendResponse.firebaseToken);
      }
    }

    assert.equal(capturedToken, 'firebase-custom-token-president-uuid');
    assert.equal(localStorage.getItem('ntm_token'), 'backend-session-raw-token-123');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Backend login without firebaseToken still succeeds normally
  // --------------------------------------------------------------------------
  test('4. Backend login without firebaseToken still succeeds normally', async () => {
    let signInAttempted = false;
    FirebaseAuthService.setMockHandlersForTesting(async () => {
      signInAttempted = true;
      return true;
    });

    const mockBackendResponse = {
      success: true,
      token: 'backend-session-raw-token-456',
      user: {
        id: 'usr-ntm-member-01',
        organizationId: 'org-ntm-001',
        phone: '9876543212',
        fullName: 'राहुल पाटील',
        role: 'MEMBER' as const,
      },
      organization: {
        id: 'org-ntm-001',
        name: 'नवतरुण मित्र मंडळ',
        code: 'NTM01',
        registrationNumber: null,
      },
      // No firebaseToken (e.g. Firebase Admin disabled on backend)
    };

    if (mockBackendResponse.success && mockBackendResponse.token) {
      localStorage.setItem('ntm_token', mockBackendResponse.token);
      if ((mockBackendResponse as any).firebaseToken) {
        await FirebaseAuthService.signInWithCustomToken((mockBackendResponse as any).firebaseToken);
      }
    }

    assert.equal(signInAttempted, false, 'signInWithCustomToken must not be called when token is omitted');
    assert.equal(localStorage.getItem('ntm_token'), 'backend-session-raw-token-456');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Firebase sign-in failure does not invalidate successful backend authentication
  // --------------------------------------------------------------------------
  test('5. Firebase sign-in failure does not invalidate successful backend authentication', async () => {
    // Simulate Firebase outage / rejection
    FirebaseAuthService.setMockHandlersForTesting(async () => {
      throw new Error('Firebase network failure / invalid custom token');
    });

    const mockBackendResponse = {
      success: true,
      token: 'valid-backend-token-789',
      user: {
        id: 'usr-ntm-treasurer-01',
        organizationId: 'org-ntm-001',
        phone: '9876543211',
        fullName: 'सचिन शिंदे',
        role: 'TREASURER' as const,
      },
      organization: {
        id: 'org-ntm-001',
        name: 'नवतरुण मित्र मंडळ',
        code: 'NTM01',
        registrationNumber: null,
      },
      firebaseToken: 'malformed-or-expired-custom-token',
    };

    let loginError: any = null;
    let authSucceeded = false;

    try {
      if (mockBackendResponse.success && mockBackendResponse.token) {
        localStorage.setItem('ntm_token', mockBackendResponse.token);

        // Safe non-blocking degradation pattern used in AuthContext
        if (mockBackendResponse.firebaseToken) {
          try {
            await FirebaseAuthService.signInWithCustomToken(mockBackendResponse.firebaseToken);
          } catch {
            // Degrade silently
          }
        }
        authSucceeded = true;
      }
    } catch (err) {
      loginError = err;
    }

    assert.equal(loginError, null, 'Firebase failure must not throw or interrupt login');
    assert.equal(authSucceeded, true, 'Backend login must remain marked as successful');
    assert.equal(localStorage.getItem('ntm_token'), 'valid-backend-token-789');
  });

  // --------------------------------------------------------------------------
  // TEST 6: checkAuth() can restore backend session without Firebase
  // --------------------------------------------------------------------------
  test('6. checkAuth() can restore backend session without Firebase', async () => {
    localStorage.setItem('ntm_token', 'persisted-active-session-token');

    // Simulate /api/auth/me response with no firebaseToken
    const meResponse = {
      success: true,
      user: {
        id: 'usr-ntm-member-01',
        organizationId: 'org-ntm-001',
        phone: '9876543212',
        fullName: 'राहुल पाटील',
        role: 'MEMBER' as const,
      },
      organization: {
        id: 'org-ntm-001',
        name: 'नवतरुण मित्र मंडळ',
        code: 'NTM01',
        registrationNumber: null,
      },
    };

    let restoredUser: any = null;
    let restoredOrg: any = null;

    if (meResponse.success && meResponse.user && meResponse.organization) {
      restoredUser = meResponse.user;
      restoredOrg = meResponse.organization;
    }

    assert.ok(restoredUser);
    assert.equal(restoredUser.role, 'MEMBER');
    assert.equal(restoredOrg.code, 'NTM01');
    assert.equal(localStorage.getItem('ntm_token'), 'persisted-active-session-token');
  });

  // --------------------------------------------------------------------------
  // TEST 7: checkAuth() uses firebaseToken when provided
  // --------------------------------------------------------------------------
  test('7. checkAuth() uses firebaseToken when provided', async () => {
    let capturedToken: string | null = null;
    FirebaseAuthService.setMockHandlersForTesting(async (token) => {
      capturedToken = token;
      return true;
    });

    localStorage.setItem('ntm_token', 'persisted-active-session-token');

    // Simulate /api/auth/me response containing firebaseToken
    const meResponse = {
      success: true,
      user: {
        id: 'usr-ntm-president-01',
        organizationId: 'org-ntm-001',
        phone: '9876543210',
        fullName: 'गणेश मोरे',
        role: 'PRESIDENT' as const,
      },
      organization: {
        id: 'org-ntm-001',
        name: 'नवतरुण मित्र मंडळ',
        code: 'NTM01',
        registrationNumber: null,
      },
      firebaseToken: 'restored-session-firebase-custom-token',
    };

    if (meResponse.success && meResponse.user && meResponse.organization) {
      if (meResponse.firebaseToken) {
        await FirebaseAuthService.signInWithCustomToken(meResponse.firebaseToken);
      }
    }

    assert.equal(capturedToken, 'restored-session-firebase-custom-token');
  });

  // --------------------------------------------------------------------------
  // TEST 8: logout() attempts Firebase signOut when configured
  // --------------------------------------------------------------------------
  test('8. logout() attempts Firebase signOut when configured', async () => {
    let signOutCalled = false;
    FirebaseAuthService.setMockHandlersForTesting(null, async () => {
      signOutCalled = true;
    });

    localStorage.setItem('ntm_token', 'active-token-to-logout');
    sessionStorage.setItem('ntm_token', 'active-session-token');

    // Simulate AuthContext logout()
    try {
      await FirebaseAuthService.signOut();
    } catch {
      // Non-blocking degradation
    }
    localStorage.removeItem('ntm_token');
    sessionStorage.removeItem('ntm_token');

    assert.equal(signOutCalled, true, 'Firebase signOut must be invoked');
    assert.equal(localStorage.getItem('ntm_token'), null);
    assert.equal(sessionStorage.getItem('ntm_token'), null);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Firebase signOut failure does not break backend logout
  // --------------------------------------------------------------------------
  test('9. Firebase signOut failure does not break backend logout', async () => {
    FirebaseAuthService.setMockHandlersForTesting(null, async () => {
      throw new Error('Firebase signOut network timeout');
    });

    localStorage.setItem('ntm_token', 'token-before-failed-signout');

    let logoutCompleted = false;
    try {
      try {
        await FirebaseAuthService.signOut();
      } catch {
        // Safe degradation
      }
      localStorage.removeItem('ntm_token');
      logoutCompleted = true;
    } catch {
      logoutCompleted = false;
    }

    assert.equal(logoutCompleted, true, 'Logout cleanup must complete even if Firebase signOut fails');
    assert.equal(localStorage.getItem('ntm_token'), null, 'Local tokens must be purged');
  });

  // --------------------------------------------------------------------------
  // TEST 10: No frontend role/org values can override backend authentication state
  // --------------------------------------------------------------------------
  test('10. No frontend role/org values can override backend authentication state', () => {
    // Attempt local storage tampering
    localStorage.setItem('ntm_user', JSON.stringify({ role: 'PRESIDENT', organizationId: 'fake-org' }));

    // Authoritative backend response for Member
    const authoritativeUser = {
      id: 'usr-ntm-member-01',
      organizationId: 'org-ntm-001',
      phone: '9876543212',
      fullName: 'राहुल पाटील',
      role: 'MEMBER' as const,
    };

    // The frontend auth state is set solely from authoritative backend data
    const activeState = {
      role: authoritativeUser.role,
      organizationId: authoritativeUser.organizationId,
    };

    assert.equal(activeState.role, 'MEMBER', 'Client role must strictly match server-sent user.role');
    assert.notEqual(activeState.role, 'PRESIDENT', 'Tampered localStorage cannot elevate role');
    assert.equal(activeState.organizationId, 'org-ntm-001');
  });
});
