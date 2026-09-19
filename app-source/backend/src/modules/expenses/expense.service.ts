import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser, ROLES } from '../../types/roles.js';
import {
  CreateExpenseInput,
  Expense,
  ExpenseCategory,
  ExpenseListResponse,
} from './expense.types.js';
import { NotificationService } from '../notifications/notification.service.js';

export class ExpenseService {
  /**
   * Records a real mandal expense and atomically creates an EXPENSE ledger transaction.
   * Authorized: President and Treasurer only. Members strictly forbidden (403).
   */
  public static createExpense(
    orgId: string,
    input: CreateExpenseInput,
    actor: AuthenticatedUser,
    ipAddress: string
  ): Expense {
    const db = getDatabase();

    // 1. Role Authorization
    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError(
        'केवळ अध्यक्ष किंवा खजिनदार खर्च नोंदवू शकतात (Only President or Treasurer can record expenses)',
        403
      );
    }

    // 2. Organization Verification
    const org = db
      .prepare('SELECT id, code, name FROM organizations WHERE id = ?')
      .get(orgId) as { id: string; code: string; name: string } | undefined;

    if (!org) {
      throw new AppError('मंडळ सापडले नाही (Organization not found)', 404);
    }

    // 3. Double-Submission / Rapid Duplicate Prevention
    const recentDuplicate = db
      .prepare(`
        SELECT id FROM expenses
        WHERE organization_id = ?
          AND actor_id = ?
          AND amount = ?
          AND category = ?
          AND reason = ?
          AND created_at >= datetime('now', '-2 seconds')
      `)
      .get(orgId, actor.id, input.amount, input.category, input.reason);

    if (recentDuplicate) {
      throw new AppError(
        'हा खर्च नुकताच नोंदवला गेला आहे. कृपया पुन्हा प्रयत्न करू नका (Duplicate expense detected)',
        409
      );
    }

    const expenseDate = input.expenseDate || new Date().toISOString().split('T')[0];
    const expenseId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const transactionNumber = `TXN-EXP-${org.code || 'NTM'}-${timestamp}-${randomSuffix}`;

    db.exec('BEGIN IMMEDIATE TRANSACTION;');

    try {
      // Step A: Insert EXPENSE into financial_transactions
      // member_id is NULL for organization-level expenses
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type, reference_id,
          transaction_number, amount, payment_method, transaction_date, status, notes
        ) VALUES (?, ?, NULL, ?, 'EXPENSE', ?, ?, ?, 'CASH', ?, 'CONFIRMED', ?)
      `).run(
        transactionId,
        orgId,
        actor.id,
        expenseId,
        transactionNumber,
        input.amount,
        expenseDate,
        input.reason
      );

      // Step B: Insert into expenses table
      db.prepare(`
        INSERT INTO expenses (
          id, organization_id, actor_id, amount, category, expense_date, reason,
          status, transaction_id, notes, receipt_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, NULL)
      `).run(
        expenseId,
        orgId,
        actor.id,
        input.amount,
        input.category,
        expenseDate,
        input.reason,
        transactionId,
        input.notes || null
      );

      // Step C: Record immutable audit event
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'EXPENSE_CREATED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          expenseId,
          transactionId,
          transactionNumber,
          amount: input.amount,
          category: input.category,
          reason: input.reason,
          expenseDate,
          actorRole: actor.role,
          actorName: actor.fullName,
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      // Dispatch notifications outside transaction
      NotificationService.sendToRoles(
        orgId,
        [ROLES.PRESIDENT, ROLES.TREASURER],
        {
          type: 'FINANCIAL_EVENT',
          title: 'मंडळ खर्च नोंद',
          message: `₹${input.amount} चा मंडळ खर्च (${input.category}: ${input.reason}) नोंदवला गेला आहे. पावती क्र: ${transactionNumber}`,
          entityType: 'EXPENSE',
          entityId: expenseId,
          idempotencyKey: `expense-${expenseId}`,
          data: { expenseId, transactionId, transactionNumber, amount: input.amount, category: input.category, reason: input.reason },
        }
      ).catch(err => console.error('Notification error (expense admin):', err));

      return {
        id: expenseId,
        organizationId: orgId,
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        amount: input.amount,
        category: input.category,
        expenseDate,
        reason: input.reason,
        status: 'CONFIRMED',
        transactionId,
        transactionNumber,
        notes: input.notes || null,
        receiptUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Retrieves paginated organization expenses with live totals derived strictly from real DB records.
   * Authorized: President and Treasurer only.
   */
  public static getMandalExpenses(
    orgId: string,
    actor: AuthenticatedUser,
    page = 1,
    limit = 20,
    category?: ExpenseCategory
  ): ExpenseListResponse {
    const db = getDatabase();

    // 1. Role Authorization
    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError(
        'खर्च यादी पाहण्याची परवानगी केवळ अध्यक्ष किंवा खजिनदारांना आहे (Expenses view forbidden for this role)',
        403
      );
    }

    const offset = (page - 1) * limit;

    // 2. Summary counts from real database rows
    const summaryQuery = category
      ? `SELECT COALESCE(SUM(amount), 0) as total_expenses, COUNT(*) as count FROM expenses WHERE organization_id = ? AND status = 'CONFIRMED' AND category = ?`
      : `SELECT COALESCE(SUM(amount), 0) as total_expenses, COUNT(*) as count FROM expenses WHERE organization_id = ? AND status = 'CONFIRMED'`;

    const summaryParams = category ? [orgId, category] : [orgId];
    const summaryRow = db.prepare(summaryQuery).get(...summaryParams) as any;

    const totalExpenses = summaryRow?.total_expenses || 0;
    const totalCount = summaryRow?.count || 0;

    // 3. Query paginated records
    const recordsQuery = `
      SELECT 
        e.*,
        u.full_name as actor_name,
        u.role as actor_role,
        t.transaction_number
      FROM expenses e
      LEFT JOIN users u ON e.actor_id = u.id
      LEFT JOIN financial_transactions t ON e.transaction_id = t.id
      WHERE e.organization_id = ? AND e.status = 'CONFIRMED'
      ${category ? 'AND e.category = ?' : ''}
      ORDER BY e.expense_date DESC, e.created_at DESC, e.id DESC
      LIMIT ? OFFSET ?
    `;

    const queryParams = category
      ? [orgId, category, limit, offset]
      : [orgId, limit, offset];

    const rows = db.prepare(recordsQuery).all(...queryParams) as any[];

    const expenses: Expense[] = rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      actorRole: r.actor_role,
      amount: r.amount,
      category: r.category as ExpenseCategory,
      expenseDate: r.expense_date,
      reason: r.reason,
      status: r.status,
      transactionId: r.transaction_id,
      transactionNumber: r.transaction_number,
      notes: r.notes,
      receiptUrl: r.receipt_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return {
      summary: {
        totalExpenses,
        totalTransactions: totalCount,
      },
      expenses,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
    };
  }

  /**
   * Retrieves single expense details within organization boundary.
   */
  public static getExpenseById(
    orgId: string,
    expenseId: string,
    actor: AuthenticatedUser
  ): Expense {
    const db = getDatabase();

    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError(
        'खर्च तपशील पाहण्याची परवानगी केवळ अध्यक्ष किंवा खजिनदारांना आहे (Forbidden)',
        403
      );
    }

    const row = db
      .prepare(`
        SELECT 
          e.*,
          u.full_name as actor_name,
          u.role as actor_role,
          t.transaction_number
        FROM expenses e
        LEFT JOIN users u ON e.actor_id = u.id
        LEFT JOIN financial_transactions t ON e.transaction_id = t.id
        WHERE e.id = ? AND e.organization_id = ?
      `)
      .get(expenseId, orgId) as any;

    if (!row) {
      throw new AppError('खर्च नोंद सापडली नाही (Expense not found in this mandal)', 404);
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      amount: row.amount,
      category: row.category as ExpenseCategory,
      expenseDate: row.expense_date,
      reason: row.reason,
      status: row.status,
      transactionId: row.transaction_id,
      transactionNumber: row.transaction_number,
      notes: row.notes,
      receiptUrl: row.receipt_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Permanently and atomically deletes an authorized mandal expense along with its linked financial transaction.
   * Authorized: President only.
   * Preserves full ledger integrity and records an immutable audit log.
   */
  public static deleteExpense(
    orgId: string,
    expenseId: string,
    actor: AuthenticatedUser,
    ipAddress?: string
  ): { id: string; transactionId: string | null; amount: number; message: string } {
    const db = getDatabase();

    // 1. Role Authorization: Only President can delete expenses
    if (actor.role !== ROLES.PRESIDENT) {
      throw new AppError(
        'केवळ अध्यक्ष मंडळ खर्च हटवू शकतात (Only President can delete mandal expenses)',
        403
      );
    }

    // 2. Fetch existing expense within organization boundary
    const expense = db
      .prepare(`
        SELECT id, organization_id, actor_id, amount, category, reason, transaction_id
        FROM expenses
        WHERE id = ? AND organization_id = ?
      `)
      .get(expenseId, orgId) as any;

    if (!expense) {
      throw new AppError('खर्च नोंद सापडली नाही (Expense not found in this mandal)', 404);
    }

    // 3. Atomic deletion under transaction
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Step A: Delete expense record
      db.prepare('DELETE FROM expenses WHERE id = ? AND organization_id = ?').run(expenseId, orgId);

      // Step B: Atomically delete linked financial_transactions record
      if (expense.transaction_id) {
        db.prepare('DELETE FROM financial_transactions WHERE id = ? AND organization_id = ?').run(
          expense.transaction_id,
          orgId
        );
      }

      // Step C: Record immutable audit log
      const auditId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'EXPENSE_DELETED', ?, ?)
      `).run(
        auditId,
        orgId,
        actor.id,
        JSON.stringify({
          expenseId,
          transactionId: expense.transaction_id,
          amount: expense.amount,
          category: expense.category,
          reason: expense.reason,
          deletedByName: actor.fullName,
          deletedByRole: actor.role,
        }),
        ipAddress || null
      );

      db.exec('COMMIT;');

      return {
        id: expenseId,
        transactionId: expense.transaction_id || null,
        amount: expense.amount,
        message: 'खर्च नोंद यशस्वीरीत्या हटवली गेली (Expense deleted successfully)',
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}
