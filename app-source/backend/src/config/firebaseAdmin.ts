import fs from 'node:fs';
import path from 'node:path';
import { App, initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { env } from './env.js';

let firebaseApp: App | null = null;
let isInitialized = false;

/**
 * Safely initializes Firebase Admin using environment variables or a local service account file.
 * Returns null if credentials are not configured or invalid, without throwing or crashing the backend.
 */
export function initFirebaseAdmin(): App | null {
  if (isInitialized) {
    return firebaseApp;
  }

  isInitialized = true;

  try {
    // If an existing app named '[DEFAULT]' is already registered, reuse it
    const existingApps = getApps();
    if (existingApps && existingApps.length > 0 && existingApps[0]) {
      firebaseApp = existingApps[0];
      return firebaseApp;
    }

    // 1. Direct JSON string from environment variable (e.g. CI/CD or production secret)
    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      firebaseApp = initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || env.FIREBASE_PROJECT_ID || 'ntm-passbook',
      });
      return firebaseApp;
    }

    // 2. Local service account JSON file path (e.g. /etc/ntm-passbook/firebase-key.json)
    if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const resolvedPath = path.resolve(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);
      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(fileContent);
        firebaseApp = initializeApp({
          credential: cert(parsed),
          projectId: parsed.project_id || env.FIREBASE_PROJECT_ID || 'ntm-passbook',
        });
        return firebaseApp;
      }
    }

    // 3. Discrete environment variables
    if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      const formattedKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      firebaseApp = initializeApp({
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID || 'ntm-passbook',
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: formattedKey,
        }),
        projectId: env.FIREBASE_PROJECT_ID || 'ntm-passbook',
      });
      return firebaseApp;
    }

    // 4. Check for standard Google Application Default Credentials
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      firebaseApp = initializeApp({
        credential: applicationDefault(),
        projectId: env.FIREBASE_PROJECT_ID || 'ntm-passbook',
      });
      return firebaseApp;
    }

    // No credentials found - graceful degradation
    firebaseApp = null;
    return null;
  } catch (error: any) {
    // Log safe error without exposing credentials
    console.warn('⚠️ Firebase Admin initialization failed (running in SQLite-only mode):', error?.message || 'Unknown error');
    firebaseApp = null;
    return null;
  }
}

/**
 * Returns true if Firebase Admin has been successfully initialized.
 */
export function isFirebaseAdminConfigured(): boolean {
  if (!isInitialized) {
    initFirebaseAdmin();
  }
  return firebaseApp !== null;
}

/**
 * Returns the Firebase Auth instance, or null if Firebase Admin is not configured.
 */
export function getFirebaseAuth(): Auth | null {
  const app = initFirebaseAdmin();
  if (!app) return null;
  return getAuth(app);
}

/**
 * Returns the Firebase Firestore instance, or null if Firebase Admin is not configured.
 */
export function getFirebaseFirestore(): Firestore | null {
  const app = initFirebaseAdmin();
  if (!app) return null;
  return getFirestore(app);
}

/**
 * Resets Firebase Admin instance for testing purposes.
 */
export function resetFirebaseAdminForTesting(mockApp: App | null = null): void {
  firebaseApp = mockApp;
  isInitialized = mockApp !== null;
}
