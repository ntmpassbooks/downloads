import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AuthService } from '../auth/auth.service.js';
import { PinEncryptionService } from '../auth/pin_encryption.service.js';
import { AuthenticatedUser } from '../../types/roles.js';
import { AppError } from '../../middleware/errorHandler.js';
import { CreateMemberInput, MemberListQuery } from './member.validation.js';

export interface SafeMember {
  id: string;
  organizationId: string;
  phone: string;
  fullName: string;
  role: 'PRESIDENT' | 'TREASURER' | 'MEMBER';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RawUserRow {
  id: string;
  organization_id: string;
  phone: string;
  full_name: string;
  role: 'PRESIDENT' | 'TREASURER' | 'MEMBER';
  is_active: number;
  created_at: string;
  updated_at: string;
}

export class MemberService {
  /**
   * Creates a new member inside the President's organization.
   * Client-supplied organization ID is never trusted.
   */
  public static createMember(
    president: AuthenticatedUser,
    input: CreateMemberInput,
    ipAddress?: string
  ): SafeMember {
    const db = getDatabase();

    // 1. Cryptographic hashing and AES-256-GCM encryption of initial PIN
    const memberId = 'usr-' + crypto.randomUUID();
    const initialPin = input.initialPin || '1234';
    const { hash, salt } = AuthService.hashPin(initialPin);
    const { encryptedPin, pinIv, pinAuthTag, pinKeyVersion } = PinEncryptionService.encryptPin(initialPin);
    const assignedRole = input.role || 'MEMBER';

    // Execute check and user insertion atomically within BEGIN IMMEDIATE to prevent race conditions
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // 2. Verify phone uniqueness within the President's organization
      const orgExisting = db
        .prepare('SELECT id FROM users WHERE organization_id = ? AND phone = ?')
        .get(president.organizationId, input.phone) as { id: string } | undefined;

      if (orgExisting) {
        throw new AppError(
          'या मोबाईल क्रमांकाचा सदस्य या मंडळात आधीपासून अस्तित्वात आहे (Member with this mobile number already exists in this Mandal)',
          409
        );
      }

      // 3. Perform a GLOBAL phone uniqueness check across all Mandals (One Phone Number = One User Identity)
      const globalExisting = db
        .prepare('SELECT id FROM users WHERE phone = ?')
        .get(input.phone) as { id: string } | undefined;

      if (globalExisting) {
        throw new AppError(
          'हा मोबाईल क्रमांक आधीच नोंदणीकृत आहे. कृपया लॉगिन करा.',
          409
        );
      }

      // 4. Insert user record bound to President's organization
      const insertStmt = db.prepare(`
        INSERT INTO users (id, organization_id, phone, full_name, role, pin_hash, pin_salt, encrypted_pin, pin_iv, pin_auth_tag, pin_key_version, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      insertStmt.run(
        memberId,
        president.organizationId,
        input.phone,
        input.fullName,
        assignedRole,
        hash,
        salt,
        encryptedPin,
        pinIv,
        pinAuthTag,
        pinKeyVersion
      );

      // 5. Audit Log record
      const auditId = crypto.randomUUID();
      const auditDetails = JSON.stringify({
        memberId,
        phone: input.phone,
        fullName: input.fullName,
        role: assignedRole,
        createdByName: president.fullName,
      });

      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'MEMBER_CREATED', ?, ?)
      `).run(auditId, president.organizationId, president.id, auditDetails, ipAddress || null);

      // 6. Fetch and return safe member record (zero secret exposure)
      const created = db
        .prepare(`
          SELECT id, organization_id, phone, full_name, role, is_active, created_at, updated_at
          FROM users WHERE id = ?
        `)
        .get(memberId) as unknown as RawUserRow;

      db.exec('COMMIT;');

      return {
        id: created.id,
        organizationId: created.organization_id,
        phone: created.phone,
        fullName: created.full_name,
        role: created.role,
        isActive: Boolean(created.is_active),
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      };
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch (_) {}
      throw error;
    }
  }

  /**
   * Retrieves paginated members for the President's organization.
   * Cross-tenant access is strictly impossible due to organization_id scoping.
   */
  public static listMembers(
    organizationId: string,
    query: MemberListQuery
  ): {
    members: SafeMember[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const db = getDatabase();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE organization_id = ?';
    const params: (string | number)[] = [organizationId];

    if (query.status === 'active') {
      whereClause += ' AND is_active = 1';
    } else if (query.status === 'inactive') {
      whereClause += ' AND is_active = 0';
    }

    if (query.search) {
      whereClause += ' AND (full_name LIKE ? OR phone LIKE ?)';
      const searchPattern = `%${query.search}%`;
      params.push(searchPattern, searchPattern);
    }

    // Total count query
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM users ${whereClause}`);
    const countResult = countStmt.get(...params) as { total: number };
    const total = countResult?.total || 0;

    // Paginated records query
    const selectQuery = `
      SELECT id, organization_id, phone, full_name, role, is_active, created_at, updated_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataStmt = db.prepare(selectQuery);
    const rows = dataStmt.all(...params, limit, offset) as unknown as RawUserRow[];

    const members: SafeMember[] = rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      phone: r.phone,
      fullName: r.full_name,
      role: r.role,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return {
      members,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves individual member details, enforcing strict organization ownership (IDOR defense).
   */
  public static getMemberById(organizationId: string, memberId: string): SafeMember {
    const db = getDatabase();
    const row = db
      .prepare(`
        SELECT id, organization_id, phone, full_name, role, is_active, created_at, updated_at
        FROM users WHERE id = ?
      `)
      .get(memberId) as unknown as RawUserRow | undefined;

    if (!row) {
      throw new AppError('सदस्य सापडला नाही (Member not found)', 404);
    }

    // Strict IDOR Check: Ensure target member belongs to the President's organization
    if (row.organization_id !== organizationId) {
      throw new AppError(
        'सुरक्षा उल्लंघन: आपण केवळ स्वतःच्या मंडळातील सदस्यांची माहिती पाहू शकता (Access denied: cross-organization access forbidden)',
        403
      );
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      phone: row.phone,
      fullName: row.full_name,
      role: row.role,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Activates or deactivates a member.
   * Deactivation immediately revokes sessions while preserving all historical data.
   */
  public static updateMemberStatus(
    president: AuthenticatedUser,
    memberId: string,
    isActive: boolean,
    ipAddress?: string
  ): SafeMember {
    const db = getDatabase();

    const row = db
      .prepare(`
        SELECT id, organization_id, phone, full_name, role, is_active, created_at, updated_at
        FROM users WHERE id = ?
      `)
      .get(memberId) as unknown as RawUserRow | undefined;

    if (!row) {
      throw new AppError('सदस्य सापडला नाही (Member not found)', 404);
    }

    // Cross-tenant IDOR defense
    if (row.organization_id !== president.organizationId) {
      throw new AppError(
        'सुरक्षा उल्लंघन: आपण केवळ स्वतःच्या मंडळातील सदस्यांची स्थिती बदलू शकता (Access denied: cross-organization access forbidden)',
        403
      );
    }

    // Role protection rules: Cannot deactivate President
    if (row.id === president.id) {
      throw new AppError('अध्यक्ष स्वतःचे खाते निष्क्रिय करू शकत नाहीत (President cannot deactivate own account)', 400);
    }
    if (row.role === 'PRESIDENT') {
      throw new AppError('अध्यक्षांचे खाते निष्क्रिय करता येत नाही (President account cannot be deactivated)', 400);
    }

    // Update active status
    const newStatus = isActive ? 1 : 0;
    db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      newStatus,
      memberId
    );

    // If deactivated, immediately revoke all active sessions for security
    if (!isActive) {
      AuthService.invalidateAllUserSessions(memberId);
    }

    // Record audit log
    const auditId = crypto.randomUUID();
    const action = isActive ? 'MEMBER_ACTIVATED' : 'MEMBER_DEACTIVATED';
    const auditDetails = JSON.stringify({
      memberId,
      phone: row.phone,
      fullName: row.full_name,
      role: row.role,
      performedByName: president.fullName,
    });

    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(auditId, president.organizationId, president.id, action, auditDetails, ipAddress || null);

    // Return refreshed safe record
    const updated = db
      .prepare(`
        SELECT id, organization_id, phone, full_name, role, is_active, created_at, updated_at
        FROM users WHERE id = ?
      `)
      .get(memberId) as unknown as RawUserRow;

    return {
      id: updated.id,
      organizationId: updated.organization_id,
      phone: updated.phone,
      fullName: updated.full_name,
      role: updated.role,
      isActive: Boolean(updated.is_active),
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };
  }

  /**
   * Updates/transfers Treasurer role with transactional atomicity.
   * Ensures exactly one active Treasurer per organization.
   */
  public static updateMemberRole(
    president: AuthenticatedUser,
    targetMemberId: string,
    newRole: 'TREASURER' | 'MEMBER',
    ipAddress?: string
  ): SafeMember {
    const db = getDatabase();

    // Begin atomic transaction
    db.exec('BEGIN TRANSACTION;');

    try {
      // 1. Fetch target member
      const target = db
        .prepare(`
          SELECT id, organization_id, phone, full_name, role, is_active, created_at, updated_at
          FROM users WHERE id = ?
        `)
        .get(targetMemberId) as unknown as RawUserRow | undefined;

      if (!target) {
        throw new AppError('सदस्य सापडला नाही (Member not found)', 404);
      }

      // 2. Cross-organization IDOR check
      if (target.organization_id !== president.organizationId) {
        throw new AppError(
          'सुरक्षा उल्लंघन: आपण केवळ स्वतःच्या मंडळातील सदस्यांची भूमिका बदलू शकता (Access denied: cross-organization access forbidden)',
          403
        );
      }

      // 3. Target must be active
      if (target.is_active !== 1) {
        throw new AppError(
          'निष्क्रिय सदस्याला खजिनदार म्हणून नियुक्त करता येत नाही (Inactive member cannot be assigned as Treasurer)',
          400
        );
      }

      // 4. Target cannot be President
      if (target.role === 'PRESIDENT' || target.id === president.id) {
        throw new AppError(
          'अध्यक्षांची भूमिका बदलता येत नाही (President role cannot be changed)',
          400
        );
      }

      // 5. If target already has the requested role, safe no-op
      if (target.role === newRole) {
        db.exec('COMMIT;');
        return {
          id: target.id,
          organizationId: target.organization_id,
          phone: target.phone,
          fullName: target.full_name,
          role: target.role,
          isActive: Boolean(target.is_active),
          createdAt: target.created_at,
          updatedAt: target.updated_at,
        };
      }

      let previousTreasurerId: string | null = null;

      // 6. If promoting to TREASURER, demote any existing active TREASURER in this Mandal
      if (newRole === 'TREASURER') {
        const currentTreasurer = db
          .prepare(`
            SELECT id, full_name, phone FROM users
            WHERE organization_id = ? AND role = 'TREASURER' AND id != ?
          `)
          .get(president.organizationId, targetMemberId) as unknown as { id: string; full_name: string; phone: string } | undefined;

        if (currentTreasurer) {
          previousTreasurerId = currentTreasurer.id;
          db.prepare(`
            UPDATE users SET role = 'MEMBER', updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).run(currentTreasurer.id);
        }
      }

      // 7. Update target role
      db.prepare(`
        UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(newRole, targetMemberId);

      // 8. Audit log
      const auditId = crypto.randomUUID();
      const auditAction = previousTreasurerId ? 'TREASURER_TRANSFERRED' : 'TREASURER_ASSIGNED';
      const auditDetails = JSON.stringify({
        newTreasurerId: target.id,
        newTreasurerName: target.full_name,
        newTreasurerPhone: target.phone,
        previousTreasurerId: previousTreasurerId || null,
        assignedByName: president.fullName,
      });

      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(auditId, president.organizationId, president.id, auditAction, auditDetails, ipAddress || null);

      // Commit transaction
      db.exec('COMMIT;');

      // 9. Fetch updated safe record
      const updated = db
        .prepare(`
          SELECT id, organization_id, phone, full_name, role, is_active, created_at, updated_at
          FROM users WHERE id = ?
        `)
        .get(targetMemberId) as unknown as RawUserRow;

      return {
        id: updated.id,
        organizationId: updated.organization_id,
        phone: updated.phone,
        fullName: updated.full_name,
        role: updated.role,
        isActive: Boolean(updated.is_active),
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  /**
   * Deletes or archives a member with strict authorization and accounting integrity.
   * - Only President can delete members.
   * - Cross-tenant IDOR protection enforced.
   * - President cannot delete self or another President.
   * - If member has financial history, safely archives & deactivates (is_active = 0) and revokes sessions.
   * - If member has zero financial history, permanently deletes user, draft configs/records, and sessions.
   * - Records immutable audit log.
   */
  public static deleteMember(
    president: AuthenticatedUser,
    memberId: string,
    ipAddress?: string
  ): { id: string; status: 'DELETED' | 'ARCHIVED'; message: string } {
    const db = getDatabase();

    // 1. Fetch target member
    const target = db
      .prepare(`
        SELECT id, organization_id, phone, full_name, role, is_active
        FROM users WHERE id = ?
      `)
      .get(memberId) as unknown as RawUserRow | undefined;

    if (!target) {
      throw new AppError('सदस्य सापडला नाही (Member not found)', 404);
    }

    // 2. Cross-organization IDOR defense
    if (target.organization_id !== president.organizationId) {
      throw new AppError(
        'सुरक्षा उल्लंघन: आपण केवळ स्वतःच्या मंडळातील सदस्य हटवू शकता (Access denied: cross-organization access forbidden)',
        403
      );
    }

    // 3. President account cannot be deleted
    if (target.id === president.id || target.role === 'PRESIDENT') {
      throw new AppError(
        'अध्यक्ष स्वतःचे किंवा अध्यक्षांचे खाते हटवू शकत नाहीत (President account cannot be deleted)',
        400
      );
    }

    // 4. Financial history inspection
    const txnCount = (db
      .prepare('SELECT COUNT(*) as count FROM financial_transactions WHERE organization_id = ? AND (member_id = ? OR actor_id = ?)')
      .get(president.organizationId, memberId, memberId) as any)?.count || 0;

    const bishiPaidCount = (db
      .prepare("SELECT COUNT(*) as count FROM bishi_records WHERE organization_id = ? AND member_id = ? AND (status = 'PAID' OR paid_amount > 0)")
      .get(president.organizationId, memberId) as any)?.count || 0;

    const loanCount = (db
      .prepare('SELECT COUNT(*) as count FROM loans WHERE organization_id = ? AND (member_id = ? OR actor_id = ?)')
      .get(president.organizationId, memberId, memberId) as any)?.count || 0;

    const loanRepaymentCount = (db
      .prepare('SELECT COUNT(*) as count FROM loan_repayments WHERE organization_id = ? AND (member_id = ? OR actor_id = ?)')
      .get(president.organizationId, memberId, memberId) as any)?.count || 0;

    const expenseCount = (db
      .prepare('SELECT COUNT(*) as count FROM expenses WHERE organization_id = ? AND actor_id = ?')
      .get(president.organizationId, memberId) as any)?.count || 0;

    const paymentOrderCount = (db
      .prepare("SELECT COUNT(*) as count FROM payment_orders WHERE organization_id = ? AND member_id = ? AND status = 'SUCCESS'")
      .get(president.organizationId, memberId) as any)?.count || 0;

    const totalFinancialRecords = txnCount + bishiPaidCount + loanCount + loanRepaymentCount + expenseCount + paymentOrderCount;

    const auditId = crypto.randomUUID();

    if (totalFinancialRecords > 0) {
      // Path A: Financial history exists -> Safely archive/deactivate to preserve ledger, audit & receipt integrity
      db.prepare('UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(memberId);
      db.prepare('UPDATE bishi_configs SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE member_id = ? AND organization_id = ?').run(memberId, president.organizationId);

      // Immediately revoke all active sessions
      AuthService.invalidateAllUserSessions(memberId);

      // Record audit log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'MEMBER_DELETED_ARCHIVED', ?, ?)
      `).run(
        auditId,
        president.organizationId,
        president.id,
        JSON.stringify({
          memberId,
          fullName: target.full_name,
          phone: target.phone,
          role: target.role,
          financialRecordsCount: totalFinancialRecords,
          reason: 'Has existing financial history - safely archived and deactivated to maintain accounting integrity',
          deletedByName: president.fullName,
        }),
        ipAddress || null
      );

      return {
        id: memberId,
        status: 'ARCHIVED',
        message: 'सदस्याचे आर्थिक व्यवहार अस्तित्वात असल्याने खाते सुरक्षितपणे निष्क्रिय व संग्रहित (Archived) केले गेले आहे.',
      };
    } else {
      // Path B: Zero financial history -> Safe atomic permanent deletion
      db.exec('BEGIN IMMEDIATE TRANSACTION;');
      try {
        db.prepare('DELETE FROM bishi_records WHERE member_id = ? AND organization_id = ?').run(memberId, president.organizationId);
        db.prepare('DELETE FROM bishi_configs WHERE member_id = ? AND organization_id = ?').run(memberId, president.organizationId);
        db.prepare('DELETE FROM payment_orders WHERE member_id = ? AND organization_id = ?').run(memberId, president.organizationId);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(memberId);
        db.prepare('DELETE FROM users WHERE id = ? AND organization_id = ?').run(memberId, president.organizationId);

        // Record audit log
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
          VALUES (?, ?, ?, 'MEMBER_PERMANENTLY_DELETED', ?, ?)
        `).run(
          auditId,
          president.organizationId,
          president.id,
          JSON.stringify({
            memberId,
            fullName: target.full_name,
            phone: target.phone,
            role: target.role,
            deletedByName: president.fullName,
          }),
          ipAddress || null
        );

        db.exec('COMMIT;');

        return {
          id: memberId,
          status: 'DELETED',
          message: 'सदस्य यशस्वीरीत्या हटवला गेला (Member deleted successfully)',
        };
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }
  }

  /**
   * Securely decrypts and returns a member's PIN for the President.
   * Enforces strict tenant isolation and logs an audit record (without recording the PIN).
   */
  public static getMemberPin(
    president: AuthenticatedUser,
    memberId: string,
    ipAddress?: string
  ): { isRecoverable: boolean; pin?: string; fullName: string; message?: string } {
    const db = getDatabase();

    // Tenant-isolated lookup: Member must exist within the President's organization
    const member = db
      .prepare(`
        SELECT id, organization_id, full_name, encrypted_pin, pin_iv, pin_auth_tag
        FROM users
        WHERE id = ? AND organization_id = ?
      `)
      .get(memberId, president.organizationId) as
      | {
          id: string;
          organization_id: string;
          full_name: string;
          encrypted_pin?: string | null;
          pin_iv?: string | null;
          pin_auth_tag?: string | null;
        }
      | undefined;

    if (!member) {
      throw new AppError('सदस्य सापडला नाही (Member not found)', 404);
    }

    if (!member.encrypted_pin || !member.pin_iv || !member.pin_auth_tag) {
      return {
        isRecoverable: false,
        fullName: member.full_name,
        message: 'या PIN ची सुरक्षित माहिती उपलब्ध नाही. नवीन PIN सेट करा.',
      };
    }

    const decryptedPin = PinEncryptionService.decryptPin(
      member.encrypted_pin,
      member.pin_iv,
      member.pin_auth_tag
    );

    // Audit log (Zero sensitive PIN/hash exposure in log)
    const auditId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'MEMBER_PIN_VIEWED', ?, ?)
    `).run(
      auditId,
      president.organizationId,
      president.id,
      `President viewed PIN for member ${member.full_name} (${member.id})`,
      ipAddress || null
    );

    return {
      isRecoverable: true,
      pin: decryptedPin,
      fullName: member.full_name,
    };
  }
}

