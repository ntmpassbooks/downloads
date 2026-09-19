import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

/**
 * Reads Firebase Web Client configuration safely from Vite environment variables or process.env.
 */
export function getFirebaseConfig() {
  const env = (import.meta as any)?.env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID || 'ntm-passbook';
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`;
  const storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;
  const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const appId = env.VITE_FIREBASE_APP_ID;

  // We require at least API Key and App ID to consider Firebase Web configured
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim() || !appId || typeof appId !== 'string' || !appId.trim()) {
    return null;
  }

  return {
    apiKey: apiKey.trim(),
    authDomain: authDomain.trim(),
    projectId: projectId.trim(),
    storageBucket: storageBucket.trim(),
    messagingSenderId: messagingSenderId ? messagingSenderId.trim() : undefined,
    appId: appId.trim(),
  };
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let initialized = false;

/**
 * Safely initializes Firebase client SDK.
 * Returns null without throwing if credentials are not configured or invalid.
 */
export function initFirebaseClient(): {
  app: FirebaseApp | null;
  auth: Auth | null;
  firestore: Firestore | null;
} {
  if (initialized) {
    return { app: appInstance, auth: authInstance, firestore: firestoreInstance };
  }

  initialized = true;

  try {
    const config = getFirebaseConfig();
    if (!config) {
      // Missing Firebase credentials - graceful degradation (SQLite auth remains authoritative)
      appInstance = null;
      authInstance = null;
      firestoreInstance = null;
      return { app: null, auth: null, firestore: null };
    }

    if (getApps().length > 0) {
      appInstance = getApp();
    } else {
      appInstance = initializeApp(config);
    }

    authInstance = getAuth(appInstance);
    try {
      firestoreInstance = getFirestore(appInstance);
    } catch {
      firestoreInstance = null;
    }
    return { app: appInstance, auth: authInstance, firestore: firestoreInstance };
  } catch (err: any) {
    // Non-blocking safe log without sensitive data
    console.warn('⚠️ Firebase Client SDK initialization failed (operating in backend-only auth mode):', err?.message || 'Unknown error');
    appInstance = null;
    authInstance = null;
    firestoreInstance = null;
    return { app: null, auth: null, firestore: null };
  }
}

/**
 * Returns true if Firebase Web Client SDK is configured with valid credentials and initialized.
 */
export function isFirebaseConfigured(): boolean {
  if (!initialized) {
    initFirebaseClient();
  }
  return appInstance !== null && authInstance !== null;
}

/**
 * Returns the initialized FirebaseApp instance, or null if unconfigured.
 */
export function getFirebaseClientApp(): FirebaseApp | null {
  if (!initialized) {
    initFirebaseClient();
  }
  return appInstance;
}

/**
 * Returns the initialized Firebase Auth instance, or null if unconfigured.
 */
export function getFirebaseClientAuth(): Auth | null {
  if (!initialized) {
    initFirebaseClient();
  }
  return authInstance;
}

/**
 * Returns the initialized Firebase Firestore instance, or null if unconfigured.
 */
export function getFirebaseClientFirestore(): Firestore | null {
  if (!initialized) {
    initFirebaseClient();
  }
  return firestoreInstance;
}

// Initial attempt at module load (safe, non-throwing)
initFirebaseClient();

export const firebaseApp: FirebaseApp | null = appInstance;
export const firebaseAuth: Auth | null = authInstance;
export const firebaseFirestore: Firestore | null = firestoreInstance;

/**
 * Testing helper to reset or mock Firebase instances during automated verification.
 */
export function resetFirebaseClientForTesting(
  mockApp: FirebaseApp | null = null,
  mockAuth: Auth | null = null,
  mockFirestore: Firestore | null = null
): void {
  appInstance = mockApp;
  authInstance = mockAuth;
  firestoreInstance = mockFirestore;
  initialized = mockApp !== null || mockAuth !== null || mockFirestore !== null;
}
