import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDatabase, closeDatabase } from './connection.js';
import { runMigrations } from './migrate.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { PinEncryptionService } from '../modules/auth/pin_encryption.service.js';

export function seedDatabase(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Database seeding is strictly forbidden in production environment!');
  }
  runMigrations();
  const db = getDatabase();

  console.log('🌱 Seeding organization and initial roles...');

  // 1. Create Primary Mandal (Organization)
  const orgId1 = 'org-ntm-001';
  const orgStmt = db.prepare(`
    INSERT OR REPLACE INTO organizations (id, name, code, registration_number)
    VALUES (?, ?, ?, ?)
  `);
  orgStmt.run(orgId1, 'नवतरुण मित्र मंडळ', 'NTM01', 'MH/PUN/2026/0123');

  // 2. Create Secondary Mandal for Multi-Tenant Isolation Verification
  const orgId2 = 'org-jhm-002';
  orgStmt.run(orgId2, 'जय हनुमान मित्र मंडळ', 'JHM02', 'MH/PUN/2026/0456');

  // Helper to upsert user
  const userStmt = db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, encrypted_pin, pin_iv, pin_auth_tag, pin_key_version, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const pin = '1234';
  const { hash, salt } = AuthService.hashPin(pin);
  const { encryptedPin, pinIv, pinAuthTag, pinKeyVersion } = PinEncryptionService.encryptPin(pin);

  // Core Role 1: President / अध्यक्ष
  userStmt.run(
    'usr-ntm-president-01',
    orgId1,
    '9876543210',
    'गणेश मोरे',
    'PRESIDENT',
    hash,
    salt,
    encryptedPin,
    pinIv,
    pinAuthTag,
    pinKeyVersion
  );

  // Core Role 2: Treasurer / खजिनदार
  userStmt.run(
    'usr-ntm-treasurer-01',
    orgId1,
    '9876543211',
    'सचिन शिंदे',
    'TREASURER',
    hash,
    salt,
    encryptedPin,
    pinIv,
    pinAuthTag,
    pinKeyVersion
  );

  // Core Role 3: Member / सदस्य
  userStmt.run(
    'usr-ntm-member-01',
    orgId1,
    '9876543212',
    'राहुल पाटील',
    'MEMBER',
    hash,
    salt,
    encryptedPin,
    pinIv,
    pinAuthTag,
    pinKeyVersion
  );

  // User in Secondary Mandal (to test tenant boundary rejection)
  userStmt.run(
    'usr-jhm-member-02',
    orgId2,
    '9876543299',
    'अमित सावंत',
    'MEMBER',
    hash,
    salt,
    encryptedPin,
    pinIv,
    pinAuthTag,
    pinKeyVersion
  );

  console.log('✅ Database seeded successfully:');
  console.log('   - Organization: नवतरुण मित्र मंडळ (Code: NTM01)');
  console.log('   - 1. अध्यक्ष (President): Phone: 9876543210, PIN: 1234');
  console.log('   - 2. खजिनदार (Treasurer): Phone: 9876543211, PIN: 1234');
  console.log('   - 3. सदस्य (Member):    Phone: 9876543212, PIN: 1234');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    seedDatabase();
    closeDatabase();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    closeDatabase();
    process.exit(1);
  }
}
