import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser } from '../../types/roles.js';
import { AuthService } from '../auth/auth.service.js';

export interface Organization {
  id: string;
  name: string;
  code: string;
  registrationNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export class OrganizationService {
  public static getById(id: string): Organization | null {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT 
        id, 
        name, 
        code, 
        registration_number as registrationNumber, 
        created_at as createdAt, 
        updated_at as updatedAt 
      FROM organizations 
      WHERE id = ?
    `);
    const org = stmt.get(id) as Organization | undefined;
    return org || null;
  }

  public static getByCode(code: string): Organization | null {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT 
        id, 
        name, 
        code, 
        registration_number as registrationNumber, 
        created_at as createdAt, 
        updated_at as updatedAt 
      FROM organizations 
      WHERE code = ?
    `);
    const org = stmt.get(code) as Organization | undefined;
    return org || null;
  }

  /**
   * Protected permanent Mandal deletion workflow.
   * Exclusively accessible by the authenticated President.
   * Requires constant-time PIN re-authentication.
   * Executes atomic reverse-dependency cascade with PRAGMA foreign_keys = ON.
   */
  public static permanentDeleteMandal(
    actor: AuthenticatedUser,
    pin: string,
    _ipAddress?: string
  ): { success: true; message: string; registrationOpen: boolean } {
    const db = getDatabase();

    // 1. President-only authorization check
    if (actor.role !== 'PRESIDENT') {
      throw new AppError('केवळ मंडळाचे अध्यक्षच मंडळ कायमचे हटवू शकतात (Only President can delete mandal)', 403);
    }

    const orgId = actor.organizationId;

    // 2. Fetch President's cryptographic credentials
    const userRow = db
      .prepare('SELECT pin_hash, pin_salt FROM users WHERE id = ? AND organization_id = ?')
      .get(actor.id, orgId) as { pin_hash: string; pin_salt: string } | undefined;

    if (!userRow) {
      throw new AppError('वापरकर्ता सापडला नाही (User not found)', 404);
    }

    // 3. Re-authenticate President's PIN using constant-time Scrypt verification
    const isPinValid = AuthService.verifyPin(pin, userRow.pin_hash, userRow.pin_salt);
    if (!isPinValid) {
      throw new AppError('अवैध पिन. कृपया पुन्हा प्रयत्न करा. (Invalid PIN. Re-authentication failed.)', 401);
    }

    // 4. Verify organization exists
    const org = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(orgId) as
      | { id: string; name: string }
      | undefined;

    if (!org) {
      throw new AppError('मंडळाची माहिती सापडली नाही (Organization not found)', 404);
    }

    // 5. Ensure foreign keys are enabled
    db.exec('PRAGMA foreign_keys = ON;');

    // 6. Execute atomic reverse-dependency deletion inside BEGIN IMMEDIATE
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Step 0a: Delete payment orders (clears FK to financial_transactions, bishi_records, users)
      db.prepare('DELETE FROM payment_orders WHERE organization_id = ?').run(orgId);

      // Step 0b: Delete payment configurations (clears FK to organizations)
      db.prepare('DELETE FROM payment_configs WHERE organization_id = ?').run(orgId);

      // Step 0c: Delete device tokens and notifications (clears FK to organizations, users)
      db.prepare('DELETE FROM device_tokens WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM notifications WHERE organization_id = ?').run(orgId);

      // Step 1: Delete loan repayments (clears FK to loans & RESTRICT on users(actor_id))
      db.prepare('DELETE FROM loan_repayments WHERE organization_id = ?').run(orgId);

      // Step 2: Delete loans (clears RESTRICT on users(actor_id))
      db.prepare('DELETE FROM loans WHERE organization_id = ?').run(orgId);

      // Step 3: Delete expenses (clears FK to financial_transactions & RESTRICT on users(actor_id))
      db.prepare('DELETE FROM expenses WHERE organization_id = ?').run(orgId);

      // Step 4: Delete bishi records (clears RESTRICT on bishi_configs(id))
      db.prepare('DELETE FROM bishi_records WHERE organization_id = ?').run(orgId);

      // Step 5: Delete bishi configurations
      db.prepare('DELETE FROM bishi_configs WHERE organization_id = ?').run(orgId);

      // Step 6: Delete financial ledger transactions (clears RESTRICT on users(actor_id))
      db.prepare('DELETE FROM financial_transactions WHERE organization_id = ?').run(orgId);

      // Step 7: Delete all sessions belonging to organization users (session invalidation)
      db.prepare(`
        DELETE FROM sessions 
        WHERE user_id IN (SELECT id FROM users WHERE organization_id = ?)
      `).run(orgId);

      // Step 8: Delete organization audit logs
      db.prepare('DELETE FROM audit_logs WHERE organization_id = ?').run(orgId);

      // Step 9: Delete all users belonging to this organization
      db.prepare('DELETE FROM users WHERE organization_id = ?').run(orgId);

      // Step 10: Delete the organization record itself
      db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    return {
      success: true,
      message: 'मंडळ व सर्व संबंधित माहिती कायमची हटवली आहे (Mandal permanently deleted).',
      registrationOpen: true,
    };
  }
}
