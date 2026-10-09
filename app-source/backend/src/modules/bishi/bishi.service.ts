import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser, ROLES } from '../../types/roles.js';

export interface BishiConfig {
  id: string;
  organizationId: string;
  memberId: string;
  monthlyAmount: number;
  dueDay: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BishiRecord {
  id: string;
  organizationId: string;
  memberId: string;
  bishiConfigId: string;
  monthYear: string;
  expectedAmount: number;
  dueDate: string;
  status: 'PENDING' | 'PAID' | 'OVERDUE';
  isOverdue?: boolean;
  paidAmount: number;
  paidDate: string | null;
  paymentMethod: string | null;
  paymentTransactionId?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BishiCycleSummary {
  monthYear: string;
  generatedCount: number;
  skippedCount: number;
}

export class BishiService {
  /**
   * Helper: Calculate applicable due date with safe month length clamping.
   * E.g., due day 31 in April clamps to 2026-04-30.
   * E.g., due day 31 in Feb 2026 clamps to 2026-02-28.
   */
  public static calculateDueDate(year: number, month: number, dueDay: number): string {
    // month is 1-indexed (1 = Jan, 12 = Dec)
    const maxDaysInMonth = new Date(year, month, 0).getDate();
    const clampedDay = Math.min(dueDay, maxDaysInMonth);
    const mm = String(month).padStart(2, '0');
    const dd = String(clampedDay).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  /**
   * Set or update a member's Bishi configuration (President Only).
   * ZERO default amount: only created upon explicit President action.
   */
  public static setMemberBishiConfig(
    orgId: string,
    memberId: string,
    monthlyAmount: number,
    dueDay: number,
    actorId: string,
    ipAddress: string
  ): BishiConfig {
    const db = getDatabase();

    // 1. Verify target user exists and belongs to this mandal
    const user = db
      .prepare('SELECT id, full_name, is_active FROM users WHERE id = ? AND organization_id = ?')
      .get(memberId, orgId) as { id: string; full_name: string; is_active: number } | undefined;

    if (!user) {
      throw new AppError('सदस्य सापडला नाही (Member not found in this mandal)', 404);
    }

    if (user.is_active !== 1) {
      throw new AppError('निष्क्रिय सदस्यासाठी बीसी सेट करता येत नाही (Cannot configure Bishi for an inactive member)', 400);
    }

    if (monthlyAmount <= 0) {
      throw new AppError('मासिक बीसी रक्कम शून्य किंवा ऋण असू शकत नाही (Amount must be strictly positive)', 400);
    }

    if (dueDay < 1 || dueDay > 31) {
      throw new AppError('देय दिवस १ ते ३१ दरम्यान असावा (Due day must be between 1 and 31)', 400);
    }

    // 2. Check for existing configuration
    const existing = db
      .prepare('SELECT id, monthly_amount, due_day FROM bishi_configs WHERE organization_id = ? AND member_id = ?')
      .get(orgId, memberId) as { id: string; monthly_amount: number; due_day: number } | undefined;

    let configId: string;
    let action: string;

    if (existing) {
      configId = existing.id;
      action = 'BISHI_CONFIG_UPDATED';
      db.prepare(`
        UPDATE bishi_configs
        SET monthly_amount = ?, due_day = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(monthlyAmount, dueDay, configId);
    } else {
      configId = crypto.randomUUID();
      action = 'BISHI_CONFIG_SET';
      db.prepare(`
        INSERT INTO bishi_configs (id, organization_id, member_id, monthly_amount, due_day, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(configId, orgId, memberId, monthlyAmount, dueDay);
    }

    // 3. Record Audit Log
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      actorId,
      action,
      JSON.stringify({
        memberId,
        memberName: user.full_name,
        monthlyAmount,
        dueDay,
        previousAmount: existing ? existing.monthly_amount : null,
      }),
      ipAddress
    );

    const saved = db
      .prepare('SELECT * FROM bishi_configs WHERE id = ?')
      .get(configId) as any;

    return {
      id: saved.id,
      organizationId: saved.organization_id,
      memberId: saved.member_id,
      monthlyAmount: saved.monthly_amount,
      dueDay: saved.due_day,
      isActive: Boolean(saved.is_active),
      createdAt: saved.created_at,
      updatedAt: saved.updated_at,
    };
  }

  /**
   * Get member's Bishi configuration. Returns null if not configured.
   */
  public static getMemberBishiConfig(orgId: string, memberId: string): BishiConfig | null {
    const db = getDatabase();

    // Verify member exists in mandal
    const user = db
      .prepare('SELECT id FROM users WHERE id = ? AND organization_id = ?')
      .get(memberId, orgId);

    if (!user) {
      throw new AppError('सदस्य सापडला नाही (Member not found in this mandal)', 404);
    }

    const row = db
      .prepare('SELECT * FROM bishi_configs WHERE organization_id = ? AND member_id = ?')
      .get(orgId, memberId) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      memberId: row.member_id,
      monthlyAmount: row.monthly_amount,
      dueDay: row.due_day,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Generate monthly Bishi cycle for active configured members (President Only).
   * - Enforces duplicate cycle protection via DB UNIQUE & pre-check.
   * - Sets initial status strictly as 'PENDING'.
   * - Preserves immutable expected_amount and calculated due_date snapshot.
   * - Inactive members or unconfigured members are skipped.
   */
  public static generateMonthlyCycle(
    orgId: string,
    targetMonthYear: string | undefined,
    actorId: string,
    ipAddress: string
  ): BishiCycleSummary {
    const db = getDatabase();

    const monthYear = targetMonthYear || new Date().toISOString().slice(0, 7);
    const [yearStr, monthStr] = monthYear.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new AppError('अवैध महिना-वर्ष स्वरूप (Invalid month-year format, expected YYYY-MM)', 400);
    }

    // Find all active members with an active Bishi configuration in this mandal
    const configuredMembers = db
      .prepare(`
        SELECT u.id as member_id, u.full_name, c.id as config_id, c.monthly_amount, c.due_day
        FROM users u
        INNER JOIN bishi_configs c ON u.id = c.member_id AND c.organization_id = u.organization_id
        WHERE u.organization_id = ? AND u.is_active = 1 AND c.is_active = 1
      `)
      .all(orgId) as Array<{
        member_id: string;
        full_name: string;
        config_id: string;
        monthly_amount: number;
        due_day: number;
      }>;

    let generatedCount = 0;
    let skippedCount = 0;

    const checkRecordStmt = db.prepare(`
      SELECT id FROM bishi_records
      WHERE organization_id = ? AND member_id = ? AND month_year = ?
    `);

    const insertRecordStmt = db.prepare(`
      INSERT INTO bishi_records (
        id, organization_id, member_id, bishi_config_id,
        month_year, expected_amount, due_date, status, paid_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)
    `);

    for (const m of configuredMembers) {
      // 1. Duplicate Cycle Check
      const existing = checkRecordStmt.get(orgId, m.member_id, monthYear);
      if (existing) {
        skippedCount++;
        continue;
      }

      // 2. Safe due date snapshot calculation with month clamping
      const dueDate = this.calculateDueDate(year, month, m.due_day);
      const recordId = crypto.randomUUID();

      try {
        insertRecordStmt.run(
          recordId,
          orgId,
          m.member_id,
          m.config_id,
          monthYear,
          m.monthly_amount, // Immutable snapshot of current config amount
          dueDate,
        );
        generatedCount++;
      } catch (err: any) {
        // If race condition hit unique constraint, count as skipped
        if (err.message && err.message.includes('UNIQUE')) {
          skippedCount++;
        } else {
          throw err;
        }
      }
    }

    // 3. Audit Log
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      actorId,
      'BISHI_CYCLE_GENERATED',
      JSON.stringify({
        monthYear,
        generatedCount,
        skippedCount,
        totalEligible: configuredMembers.length,
      }),
      ipAddress
    );

    return {
      monthYear,
      generatedCount,
      skippedCount,
    };
  }

  /**
   * Get member's monthly Bishi records.
   * Returns records sorted chronologically descending.
   * Historical amounts and due dates are preserved exactly as snapshot.
   */
  public static getMemberBishiRecords(orgId: string, memberId: string): BishiRecord[] {
    const db = getDatabase();

    // Verify member exists in mandal
    const user = db
      .prepare('SELECT id FROM users WHERE id = ? AND organization_id = ?')
      .get(memberId, orgId);

    if (!user) {
      throw new AppError('सदस्य सापडला नाही (Member not found in this mandal)', 404);
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(`
        SELECT * FROM bishi_records
        WHERE organization_id = ? AND member_id = ?
        ORDER BY month_year DESC, due_date DESC
      `)
      .all(orgId, memberId) as any[];

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      memberId: r.member_id,
      bishiConfigId: r.bishi_config_id,
      monthYear: r.month_year,
      expectedAmount: r.expected_amount,
      dueDate: r.due_date,
      status: r.status,
      isOverdue: Boolean(r.status !== 'PAID' && r.due_date < today),
      paidAmount: r.paid_amount,
      paidDate: r.paid_date,
      paymentMethod: r.payment_method,
      paymentTransactionId: r.payment_transaction_id,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Get organization-level Bishi overview for a given month.
   */
  public static getOrganizationBishiOverview(
    orgId: string,
    targetMonthYear?: string
  ) {
    const db = getDatabase();
    const monthYear = targetMonthYear || new Date().toISOString().slice(0, 7);

    // Get all members with their config and record for this month
    const today = new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(`
        SELECT 
          u.id as member_id,
          u.full_name,
          u.phone,
          u.role,
          u.is_active,
          c.id as config_id,
          c.monthly_amount,
          c.due_day,
          r.id as record_id,
          r.expected_amount as record_expected_amount,
          r.due_date as record_due_date,
          r.status as record_status,
          r.paid_amount as record_paid_amount,
          r.paid_date as record_paid_date,
          r.payment_method as record_payment_method,
          r.payment_transaction_id as record_payment_transaction_id,
          t.transaction_number as record_transaction_number
        FROM users u
        LEFT JOIN bishi_configs c ON u.id = c.member_id AND c.organization_id = u.organization_id
        LEFT JOIN bishi_records r ON u.id = r.member_id AND r.month_year = ? AND r.organization_id = u.organization_id
        LEFT JOIN financial_transactions t ON r.payment_transaction_id = t.id AND t.organization_id = u.organization_id
        WHERE u.organization_id = ?
        ORDER BY u.full_name ASC
      `)
      .all(monthYear, orgId) as any[];

    let totalConfigured = 0;
    let totalUnconfigured = 0;
    let totalExpectedAmount = 0;
    let totalRecordsGenerated = 0;
    let totalPaidAmount = 0;
    let totalPendingAmount = 0;
    let totalCashAmount = 0;
    let totalOnlineAmount = 0;
    let totalCashCount = 0;
    let totalOnlineCount = 0;

    const members = rows.map((r) => {
      const isConfigured = Boolean(r.config_id);
      if (isConfigured) {
        totalConfigured++;
        totalExpectedAmount += r.record_expected_amount || r.monthly_amount || 0;
      } else {
        totalUnconfigured++;
      }

      if (r.record_id) {
        totalRecordsGenerated++;
        if (r.record_status === 'PAID') {
          totalPaidAmount += r.record_paid_amount || 0;
          if (r.record_payment_method === 'CASH') {
            totalCashAmount += r.record_paid_amount || 0;
            totalCashCount++;
          } else if (r.record_payment_method === 'ONLINE_UPI') {
            totalOnlineAmount += r.record_paid_amount || 0;
            totalOnlineCount++;
          }
        } else {
          totalPendingAmount += r.record_expected_amount || 0;
        }
      }

      return {
        memberId: r.member_id,
        fullName: r.full_name,
        phone: r.phone,
        role: r.role,
        isActive: Boolean(r.is_active),
        config: isConfigured
          ? {
              id: r.config_id,
              monthlyAmount: r.monthly_amount,
              dueDay: r.due_day,
            }
          : null,
        record: r.record_id
          ? {
              id: r.record_id,
              expectedAmount: r.record_expected_amount,
              dueDate: r.record_due_date,
              status: r.record_status,
              isOverdue: Boolean(r.record_status !== 'PAID' && r.record_due_date < today),
              paidAmount: r.record_paid_amount,
              paidDate: r.record_paid_date,
              paymentMethod: r.record_payment_method,
              paymentTransactionId: r.record_payment_transaction_id,
              transactionNumber: r.record_transaction_number,
            }
          : null,
      };
    });

    return {
      monthYear,
      summary: {
        totalMembers: rows.length,
        totalConfigured,
        totalUnconfigured,
        totalExpectedAmount,
        totalRecordsGenerated,
        totalPaidAmount,
        totalPendingAmount,
        totalCashAmount,
        totalOnlineAmount,
        totalCashCount,
        totalOnlineCount,
      },
      members,
    };
  }

  /**
   * Safely deletes an unpaid, unreferenced Bishi monthly record.
   * Protects financial integrity:
   * Rejects if record is PAID, has paid_amount > 0, has payment_transaction_id, or has ledger transactions.
   */
  public static deleteBishiRecord(
    orgId: string,
    recordId: string,
    actor: AuthenticatedUser,
    ipAddress: string
  ): { id: string; monthYear: string; memberId: string; message: string } {
    const db = getDatabase();

    // 1. Authorization: President or Treasurer only
    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार बीसी नोंद हटवू शकतात (President or Treasurer only)', 403);
    }

    // 2. Fetch record in organization
    const record = db
      .prepare(`
        SELECT r.*, u.full_name as member_name
        FROM bishi_records r
        INNER JOIN users u ON r.member_id = u.id
        WHERE r.id = ? AND r.organization_id = ?
      `)
      .get(recordId, orgId) as any;

    if (!record) {
      throw new AppError('मासिक बीसी नोंद सापडली नाही (Bishi record not found in this mandal)', 404);
    }

    // 3. Inspect financial relationships: Do NOT delete if paid or referenced
    if (record.status === 'PAID' || record.paid_amount > 0 || record.payment_transaction_id) {
      throw new AppError(
        'भरलेली बीसी नोंद हटवता येत नाही. प्रत्यक्ष भरणा, लेजर नोंद व पावत्यांचे संरक्षण आवश्यक आहे (Cannot delete paid Bishi record; financial transactions and receipts are protected)',
        400
      );
    }

    // Check financial_transactions table
    const finTxn = db
      .prepare('SELECT id FROM financial_transactions WHERE organization_id = ? AND reference_id = ?')
      .get(orgId, recordId) as any;

    if (finTxn) {
      throw new AppError(
        'या नोंदीशी संबंधित आर्थिक लेजर व्यवहार अस्तित्वात असल्याने ही नोंद हटवता येत नाही (Cannot delete Bishi record with linked ledger transactions)',
        400
      );
    }

    // Check payment_orders table
    const paymentOrder = db
      .prepare('SELECT id, status FROM payment_orders WHERE organization_id = ? AND bishi_record_id = ? AND status IN (\'SUCCESS\', \'PENDING\')')
      .get(orgId, recordId) as any;

    if (paymentOrder && paymentOrder.status === 'SUCCESS') {
      throw new AppError(
        'या नोंदीसाठी यशस्वी ऑनलाइन पेमेंट झाले असल्याने ही नोंद हटवता येत नाही (Cannot delete Bishi record with successful online payment)',
        400
      );
    }

    // 4. Atomic deletion and audit log
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Clean up any draft/failed/cancelled payment orders if present
      db.prepare('DELETE FROM payment_orders WHERE organization_id = ? AND bishi_record_id = ?').run(orgId, recordId);

      // Delete the bishi record
      db.prepare('DELETE FROM bishi_records WHERE id = ? AND organization_id = ?').run(recordId, orgId);

      // Audit log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'BISHI_RECORD_DELETED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          recordId,
          memberId: record.member_id,
          memberName: record.member_name,
          monthYear: record.month_year,
          expectedAmount: record.expected_amount,
          deletedByName: actor.fullName,
          deletedByRole: actor.role,
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      return {
        id: recordId,
        monthYear: record.month_year,
        memberId: record.member_id,
        message: 'बीसी मासिक नोंद यशस्वीरीत्या हटवली (Bishi record deleted successfully)',
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}
