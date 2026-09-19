import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { env } from '../../config/env.js';
import { AuthenticatedUser, Role } from '../../types/roles.js';
import { AppError } from '../../middleware/errorHandler.js';
import { RegisterPresidentInput } from './auth.validation.js';
import { Organization } from '../organization/organization.service.js';
import { PinEncryptionService } from './pin_encryption.service.js';
import { NotificationService } from '../notifications/notification.service.js';

export class AuthService {
  /**
   * Hashes a PIN using scrypt with a unique cryptographically random salt.
   */
  public static hashPin(pin: string): { hash: string; salt: string } {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    return { hash, salt };
  }

  /**
   * Verifies a provided PIN against the stored hash and salt using timingSafeEqual.
   */
  public static verifyPin(pin: string, storedHash: string, salt: string): boolean {
    const hashBuffer = Buffer.from(storedHash, 'hex');
    const computedBuffer = crypto.scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1 });
    if (hashBuffer.length !== computedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(hashBuffer, computedBuffer);
  }

  /**
   * Generates a secure random session token and computes its HMAC hash for database storage.
   */
  public static createSession(
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): { rawToken: string; expiresAt: string } {
    const db = getDatabase();
    const sessionId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(32).toString('hex');

    // Store HMAC of the token in the database to prevent token theft via DB dumps
    const tokenHash = crypto.createHmac('sha256', env.SESSION_SECRET).update(rawToken).digest('hex');

    const expiresAtDate = new Date(Date.now() + env.SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
    const expiresAt = expiresAtDate.toISOString();

    const stmt = db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(sessionId, userId, tokenHash, expiresAt, ipAddress || null, userAgent || null);

    return { rawToken, expiresAt };
  }

  /**
   * Verifies a raw session token, checks expiry, and retrieves the active authenticated user.
   */
  public static validateSession(rawToken: string): AuthenticatedUser | null {
    if (!rawToken || typeof rawToken !== 'string') return null;

    const db = getDatabase();
    const tokenHash = crypto.createHmac('sha256', env.SESSION_SECRET).update(rawToken).digest('hex');
    const nowIso = new Date().toISOString();

    const stmt = db.prepare(`
      SELECT 
        u.id, 
        u.organization_id as organizationId, 
        u.phone, 
        u.full_name as fullName, 
        u.role, 
        u.is_active as isActive
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1
    `);

    const user = stmt.get(tokenHash, nowIso) as AuthenticatedUser | undefined;
    return user || null;
  }

  /**
   * Invalidates (deletes) a session token.
   */
  public static invalidateSession(rawToken: string): void {
    if (!rawToken) return;
    const db = getDatabase();
    const tokenHash = crypto.createHmac('sha256', env.SESSION_SECRET).update(rawToken).digest('hex');
    const stmt = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
    stmt.run(tokenHash);
  }

  /**
   * Invalidates all sessions for a user (e.g., on PIN reset or security breach).
   */
  public static invalidateAllUserSessions(userId: string): void {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');
    stmt.run(userId);
  }

  /**
   * Securely changes the user's PIN, verifies current PIN, hashes new PIN with scrypt,
   * invalidates old sessions, and rotates the current session token.
   */
  public static changePin(
    userId: string,
    currentPin: string,
    newPin: string,
    ipAddress?: string
  ): { rotatedToken: string; expiresAt: string } {
    const db = getDatabase();

    const user = db
      .prepare('SELECT id, organization_id, phone, pin_hash, pin_salt, is_active FROM users WHERE id = ?')
      .get(userId) as
      | {
          id: string;
          organization_id: string;
          phone: string;
          pin_hash: string;
          pin_salt: string;
          is_active: number;
        }
      | undefined;

    if (!user || user.is_active !== 1) {
      throw new AppError('खाते अस्तित्वात नाही किंवा निष्क्रिय आहे (Account not found or inactive)', 401);
    }

    // Timing-safe verification of current PIN
    const isCurrentValid = AuthService.verifyPin(currentPin, user.pin_hash, user.pin_salt);
    if (!isCurrentValid) {
      // Audit failed PIN change attempt
      const auditId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(auditId, user.organization_id, user.id, 'PIN_CHANGE_FAILED', 'Incorrect current PIN provided', ipAddress || null);

      throw new AppError('सध्याचा PIN चुकीचा आहे (Current PIN is incorrect)', 401);
    }

    // Scrypt hash of new PIN with a new random salt
    const { hash: newHash, salt: newSalt } = AuthService.hashPin(newPin);
    const { encryptedPin, pinIv, pinAuthTag, pinKeyVersion } = PinEncryptionService.encryptPin(newPin);

    // Update user record with scrypt hash and AES-256-GCM encrypted credential
    db.prepare(`
      UPDATE users 
      SET pin_hash = ?, pin_salt = ?, encrypted_pin = ?, pin_iv = ?, pin_auth_tag = ?, pin_key_version = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(
      newHash,
      newSalt,
      encryptedPin,
      pinIv,
      pinAuthTag,
      pinKeyVersion,
      userId
    );

    // Invalidate all existing sessions to revoke stale credentials
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

    // Issue freshly rotated session token for the current device
    const { rawToken: rotatedToken, expiresAt } = AuthService.createSession(userId, ipAddress);

    // Audit log (Zero sensitive PIN/hash exposure)
    const auditId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(auditId, user.organization_id, user.id, 'PIN_CHANGED', 'User security PIN changed and sessions rotated', ipAddress || null);

    // Send security notification to user
    NotificationService.sendNotification({
      organizationId: user.organization_id,
      userId: user.id,
      type: 'SECURITY_EVENT',
      title: 'सुरक्षा सूचना: PIN बदलला',
      message: 'आपल्या खात्याचा सिक्युरिटी PIN नुकताच बदलण्यात आला आहे. सर्व जुने सेशन्स बंद करण्यात आले आहेत.',
      entityType: 'SECURITY',
      entityId: user.id,
      idempotencyKey: `pin-change-${user.id}-${Date.now()}`,
    }).catch(err => console.error('Notification error (pin change):', err));

    return { rotatedToken, expiresAt };
  }

  /**
   * Checks whether first-time President registration is currently available.
   * If mandalName is supplied: checks if that specific Mandal already has a registered President.
   * If phone is supplied: checks if user is already registered in an existing Mandal.
   * For brand-new Mandals without parameters: returns true.
   */
  public static isRegistrationOpen(
    mandalName?: string,
    phone?: string
  ): { isOpen: boolean; reason?: string } {
    const db = getDatabase();

    // 1. Check if specific Mandal name is provided
    if (mandalName && mandalName.trim()) {
      const normalized = mandalName.trim().toLowerCase();
      const existing = db
        .prepare('SELECT id, name FROM organizations WHERE LOWER(TRIM(name)) = ?')
        .get(normalized) as { id: string; name: string } | undefined;

      if (existing) {
        return {
          isOpen: false,
          reason: 'नोंदणी सध्या उपलब्ध नाही. हे मंडळ आधीपासून नोंदणीकृत असून मंडळ अध्यक्ष आधीपासून अस्तित्वात आहेत (Registration is closed: This Mandal already has a registered President)',
        };
      }
    }

    // 2. Check if phone number is provided (existing user in an existing Mandal)
    if (phone && phone.trim()) {
      const cleanPhone = phone.trim().replace(/\D/g, '');
      const existingUser = db
        .prepare('SELECT id, organization_id FROM users WHERE phone = ?')
        .get(cleanPhone) as { id: string; organization_id: string } | undefined;

      if (existingUser) {
        return {
          isOpen: false,
          reason: 'हा मोबाईल क्रमांक आधीच नोंदणीकृत आहे. कृपया लॉगिन करा (Mobile number is already registered. Please log in.)',
        };
      }
    }

    return { isOpen: true };
  }

  /**
   * Atomically creates a new Mandal/Organization and its initial President account.
   * Enforces per-Mandal registration lock and race-condition defense using IMMEDIATE TRANSACTION.
   */
  public static registerPresident(
    input: RegisterPresidentInput,
    ipAddress?: string,
    userAgent?: string
  ): {
    rawToken: string;
    expiresAt: string;
    user: AuthenticatedUser;
    organization: Organization;
  } {
    const db = getDatabase();

    // Use IMMEDIATE transaction to acquire write lock immediately and prevent concurrent race conditions
    db.exec('BEGIN IMMEDIATE TRANSACTION;');

    try {
      // 1. Check if Mandal already exists (Strict Per-Mandal Registration Lock)
      // Once a Mandal is registered, its President registration is locked. No second President can register for that Mandal.
      const normalizedMandalName = input.mandalName.trim().toLowerCase();
      const existingMandal = db
        .prepare('SELECT id FROM organizations WHERE LOWER(TRIM(name)) = ?')
        .get(normalizedMandalName) as { id: string } | undefined;

      if (existingMandal) {
        db.exec('ROLLBACK;');
        throw new AppError(
          'नोंदणी सध्या उपलब्ध नाही. हे मंडळ आधीपासून नोंदणीकृत असून मंडळ अध्यक्ष आधीपासून अस्तित्वात आहेत (Registration is closed: This Mandal already has a registered President)',
          409
        );
      }

      // 2. Check if mobile number is already taken across any Mandal
      // (A user belongs to one Mandal at a time; existing members/treasurers cannot self-register as President)
      const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(input.phone);
      if (existingPhone) {
        db.exec('ROLLBACK;');
        throw new AppError(
          'हा मोबाईल क्रमांक आधीच नोंदणीकृत आहे. कृपया लॉगिन करा (Mobile number is already registered. Please log in.)',
          409
        );
      }

      // 3. If registrationNumber is provided, check uniqueness across organizations
      if (input.registrationNumber && input.registrationNumber.trim()) {
        const existingRegNum = db
          .prepare('SELECT id FROM organizations WHERE registration_number = ?')
          .get(input.registrationNumber.trim());
        if (existingRegNum) {
          db.exec('ROLLBACK;');
          throw new AppError(
            'हा मंडळ नोंदणी क्रमांक आधीच नोंदणीकृत आहे (Mandal registration number is already registered)',
            409
          );
        }
      }

      // 4. Create Mandal / Organization with collision-free unique code
      const orgId = crypto.randomUUID();
      let code = 'NTM01';
      let codeIndex = 1;
      while (db.prepare('SELECT id FROM organizations WHERE code = ?').get(code)) {
        codeIndex++;
        code = `MND${codeIndex.toString().padStart(3, '0')}`;
      }

      const nowIso = new Date().toISOString();
      db.prepare(`
        INSERT INTO organizations (id, name, code, registration_number, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(orgId, input.mandalName, code, input.registrationNumber || null, nowIso, nowIso);

      // 4. Create President User with Scrypt Hashing & AES-256-GCM Recoverable Encryption
      const userId = crypto.randomUUID();
      const { hash, salt } = AuthService.hashPin(input.pin);
      const { encryptedPin, pinIv, pinAuthTag, pinKeyVersion } = PinEncryptionService.encryptPin(input.pin);

      db.prepare(`
        INSERT INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, encrypted_pin, pin_iv, pin_auth_tag, pin_key_version, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PRESIDENT', ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(userId, orgId, input.phone, input.fullName, hash, salt, encryptedPin, pinIv, pinAuthTag, pinKeyVersion, nowIso, nowIso);

      // 5. Create Audit Log
      const auditId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditId,
        orgId,
        userId,
        'PRESIDENT_REGISTERED',
        `First President registered: ${input.fullName} (+91 ${input.phone}) for Mandal: ${input.mandalName} (${code})`,
        ipAddress || null,
        nowIso
      );

      // Commit the transaction atomically
      db.exec('COMMIT;');

      // 6. Create authenticated session for the newly registered President
      const { rawToken, expiresAt } = AuthService.createSession(userId, ipAddress, userAgent);

      return {
        rawToken,
        expiresAt,
        user: {
          id: userId,
          organizationId: orgId,
          phone: input.phone,
          fullName: input.fullName,
          role: 'PRESIDENT',
          isActive: true,
        },
        organization: {
          id: orgId,
          name: input.mandalName,
          code,
          registrationNumber: input.registrationNumber || null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      };
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Rollback error ignored if transaction already terminated
      }
      throw err;
    }
  }

  /**
   * Securely decrypts and returns the President's own PIN.
   * Logs an audit record (without recording the PIN).
   */
  public static getPresidentOwnPin(
    president: AuthenticatedUser,
    ipAddress?: string
  ): { isRecoverable: boolean; pin?: string; message?: string } {
    const db = getDatabase();

    const user = db
      .prepare(`
        SELECT id, organization_id, full_name, encrypted_pin, pin_iv, pin_auth_tag
        FROM users
        WHERE id = ? AND organization_id = ?
      `)
      .get(president.id, president.organizationId) as
      | {
          id: string;
          organization_id: string;
          full_name: string;
          encrypted_pin?: string | null;
          pin_iv?: string | null;
          pin_auth_tag?: string | null;
        }
      | undefined;

    if (!user) {
      throw new AppError('वापरकर्ता सापडला नाही (User not found)', 404);
    }

    if (!user.encrypted_pin || !user.pin_iv || !user.pin_auth_tag) {
      return {
        isRecoverable: false,
        message: 'या PIN ची सुरक्षित माहिती उपलब्ध नाही. नवीन PIN सेट करा.',
      };
    }

    const decryptedPin = PinEncryptionService.decryptPin(
      user.encrypted_pin,
      user.pin_iv,
      user.pin_auth_tag
    );

    // Audit log (Zero sensitive PIN/hash exposure in log)
    const auditId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'PRESIDENT_OWN_PIN_VIEWED', 'President viewed their own PIN securely', ?)
    `).run(auditId, president.organizationId, president.id, ipAddress || null);

    return {
      isRecoverable: true,
      pin: decryptedPin,
    };
  }
}

