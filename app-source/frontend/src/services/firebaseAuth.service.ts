import { signInWithCustomToken, signOut, User as FirebaseUser } from 'firebase/auth';
import { getFirebaseClientAuth, isFirebaseConfigured } from '../config/firebase.js';

let mockSignInHandler: ((token: string) => Promise<boolean>) | null = null;
let mockSignOutHandler: (() => Promise<void>) | null = null;

export class FirebaseAuthService {
  /**
   * Synchronizes client session with Firebase Authentication using the backend-generated Custom Token.
   *
   * @param firebaseToken Signed custom token issued by NTM Passbook backend
   * @returns Promise<boolean> true if Firebase sign-in succeeded, false if unconfigured or failed
   */
  public static async signInWithCustomToken(firebaseToken: string): Promise<boolean> {
    if (!firebaseToken || typeof firebaseToken !== 'string' || !firebaseToken.trim()) {
      return false;
    }

    // Testing hook for automated test suites
    if (mockSignInHandler) {
      return mockSignInHandler(firebaseToken);
    }

    if (!isFirebaseConfigured()) {
      // Firebase not configured in this environment; backend SQLite auth remains 100% authoritative
      return false;
    }

    const auth = getFirebaseClientAuth();
    if (!auth) {
      return false;
    }

    try {
      await signInWithCustomToken(auth, firebaseToken);
      return true;
    } catch (error: any) {
      // Safe diagnostic warning: Never log tokens or sensitive data
      console.warn(
        '⚠️ Firebase custom token sign-in failed (continuing with backend auth):',
        error?.code || error?.message || 'Unknown error'
      );
      return false;
    }
  }

  /**
   * Signs out the current user from Firebase Auth safely.
   */
  public static async signOut(): Promise<void> {
    // Testing hook for automated test suites
    if (mockSignOutHandler) {
      return mockSignOutHandler();
    }

    if (!isFirebaseConfigured()) {
      return;
    }

    const auth = getFirebaseClientAuth();
    if (!auth || !auth.currentUser) {
      return;
    }

    try {
      await signOut(auth);
    } catch (error: any) {
      // Safe warning: Failure to sign out of Firebase must not block app logout
      console.warn(
        '⚠️ Firebase signOut encountered an error (continuing with local logout):',
        error?.code || error?.message || 'Unknown error'
      );
    }
  }

  /**
   * Returns the current Firebase authenticated user, or null.
   */
  public static getCurrentUser(): FirebaseUser | null {
    const auth = getFirebaseClientAuth();
    return auth ? auth.currentUser : null;
  }

  /**
   * Returns true if Firebase Auth currently has an active user.
   */
  public static isAuthenticated(): boolean {
    const auth = getFirebaseClientAuth();
    return auth !== null && auth.currentUser !== null;
  }

  /**
   * Test helper to set mock handlers for automated testing.
   */
  public static setMockHandlersForTesting(
    signIn: ((token: string) => Promise<boolean>) | null = null,
    signOutHandler: (() => Promise<void>) | null = null
  ): void {
    mockSignInHandler = signIn;
    mockSignOutHandler = signOutHandler;
  }
}
