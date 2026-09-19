import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser } from '../../types/roles.js';
import { RecordVarganiContributionInput } from './ledger.validation.js';
import { NotificationService } from '../notifications/notification.service.js';

export interface MandalFinancialSummary {
  currentBalance: number;
  totalInflow: number;
  totalVarganiCollected: number;
  pendingVargani: number;
  totalExpenses: number;
  totalLoansDisbursed: number;
  totalLoanRepayments: number;
  outstandingLoans: number;
  totalTransactions: number;
}

export interface FinancialTransaction {
  id: string;
  organizationId: string;
  memberId: string | null;
  memberName?: string;
  actorId: string;
  actorName?: string;
  transactionType: 'BISHI_PAYMENT' | 'LOAN_DISBURSED' | 'LOAN_REPAYMENT' | 'EXPENSE';
  referenceId: string;
  transactionNumber: string;
  amount: number;
  paymentMethod: 'CASH' | 'ONLINE_UPI';
  transactionDate: string;
  status: 'CONFIRMED' | 'CANCELLED';
  notes: string | null;
  bishiMonth?: string;
  createdAt: string;
}

export interface MemberPassbookResponse {
  member: {
    id: string;
    fullName: string;
    phone: string;
  };
  totalPaid: number;
  totalTransactions: number;
  transactions: FinancialTransaction[];
}

export interface OrganizationLedgerResponse {
  summary: {
    totalFunds: number;
    totalInflow: number;
    totalOutflow: number;
    totalExpenses: number;
    totalTransactions: number;
  };
  transactions: FinancialTransaction[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface TransactionReceipt {
  receiptNumber: string;
  transactionNumber: string;
  transactionId: string;
  transactionType: 'BISHI_PAYMENT' | 'LOAN_DISBURSED' | 'LOAN_REPAYMENT';
  organization: {
    id: string;
    name: string;
    code: string;
    registrationNumber: string | null;
  };
  member: {
    id: string;
    fullName: string;
    phone: string;
  };
  bishiMonth: string | null;
  amount: number;
  paymentMethod: 'CASH' | 'ONLINE_UPI';
  transactionDate: string;
  recordedBy: {
    id: string;
    fullName: string;
    role: string;
  };
  status: 'CONFIRMED';
  notes: string | null;
}

export class LedgerService {
  /**
   * Generates an immutable, system-assigned unique transaction reference number.
   * Format: TXN-YYYYMMDD-XXXXXX
   */
  public static generateTransactionNumber(): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `TXN-${today}-${randomHex}`;
  }

  /**
   * Records a real cash payment for a monthly Bishi cycle (President & Treasurer Only).
   * - Atomic: creates ledger transaction, updates Bishi status to PAID, and writes audit log.
   * - Strict validation: exact amount matching pending Bishi amount; rejects already paid records.
   * - Uses BEGIN IMMEDIATE TRANSACTION to prevent concurrent race-conditions.
   */
  public static recordCashBishiPayment(
    orgId: string,
    bishiRecordId: string,
    amount: number,
    actor: AuthenticatedUser,
    ipAddress: string,
    notes?: string
  ): FinancialTransaction {
    const db = getDatabase();

    // 1. Authorization: Only Treasurer or President can record cash payments
    if (actor.role !== 'PRESIDENT' && actor.role !== 'TREASURER') {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार रोख जमा नोंदवू शकतात (Only President or Treasurer can record cash)', 403);
    }

    if (actor.isActive === false) {
      throw new AppError('निष्क्रिय वापरकर्ता व्यवहार नोंदवू शकत नाही (Inactive user cannot record transactions)', 403);
    }

    // 2. Verify target Bishi record exists and belongs to this mandal
    const record = db
      .prepare(`
        SELECT r.*, u.full_name as member_name, u.phone as member_phone, u.is_active as member_active
        FROM bishi_records r
        INNER JOIN users u ON r.member_id = u.id AND r.organization_id = u.organization_id
        WHERE r.id = ? AND r.organization_id = ?
      `)
      .get(bishiRecordId, orgId) as any;

    if (!record) {
      throw new AppError('मासिक बीसी नोंद सापडली नाही (Bishi record not found in this mandal)', 404);
    }

    if (record.status === 'PAID') {
      throw new AppError('हा बीसी हप्ता आधीच भरला गेला आहे (This Bishi record is already paid)', 409);
    }

    // 3. Exact amount validation: must match expected snapshot amount
    if (amount !== record.expected_amount) {
      throw new AppError(
        `भरलेली रक्कम अपेक्षित बीसी रकमेइतकीच (₹${record.expected_amount}) असावी (Amount must match expected ₹${record.expected_amount})`,
        400
      );
    }

    // 4. Atomic Execution with immediate write lock
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Re-check under locked transaction to guarantee race-condition safety
      const locked = db
        .prepare('SELECT status FROM bishi_records WHERE id = ?')
        .get(bishiRecordId) as any;

      if (!locked || locked.status === 'PAID') {
        throw new AppError('हा बीसी हप्ता आधीच भरला गेला आहे (Already paid)', 409);
      }

      const transactionId = crypto.randomUUID();
      const transactionNumber = this.generateTransactionNumber();

      // Step A: Insert into financial_transactions
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type,
          reference_id, transaction_number, amount, payment_method,
          transaction_date, status, notes
        ) VALUES (?, ?, ?, ?, 'BISHI_PAYMENT', ?, ?, ?, 'CASH', CURRENT_TIMESTAMP, 'CONFIRMED', ?)
      `).run(
        transactionId,
        orgId,
        record.member_id,
        actor.id,
        bishiRecordId,
        transactionNumber,
        amount,
        notes || null
      );

      // Step B: Update bishi_records to PAID
      db.prepare(`
        UPDATE bishi_records
        SET status = 'PAID',
            paid_amount = ?,
            paid_date = CURRENT_TIMESTAMP,
            payment_method = 'CASH',
            payment_transaction_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(amount, transactionId, bishiRecordId);

      // Step C: Record Audit Log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'BISHI_PAYMENT_RECORDED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          transactionId,
          transactionNumber,
          bishiRecordId,
          memberId: record.member_id,
          memberName: record.member_name,
          amount,
          monthYear: record.month_year,
          actorRole: actor.role,
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      // Dispatch notifications outside transaction
      NotificationService.sendNotification({
        organizationId: orgId,
        userId: record.member_id,
        type: 'BISHI_PAID',
        title: 'बिशी जमा पावती',
        message: `${record.month_year} महिन्याची ₹${amount} बिशी रोख जमा झाली आहे. पावती क्र: ${transactionNumber}`,
        entityType: 'BISHI',
        entityId: bishiRecordId,
        idempotencyKey: `bishi-paid-cash-${transactionNumber}`,
        data: { transactionId, transactionNumber, amount, monthYear: record.month_year },
      }).catch(err => console.error('Notification error (bishi cash member):', err));

      NotificationService.sendToRoles(
        orgId,
        ['PRESIDENT', 'TREASURER'],
        {
          type: 'BISHI_PAID',
          title: 'नवीन बिशी रोख जमा',
          message: `${record.member_name} यांनी ${record.month_year} महिन्याची ₹${amount} बिशी रोख जमा केली.`,
          entityType: 'BISHI',
          entityId: bishiRecordId,
          idempotencyKey: `bishi-paid-cash-admin-${transactionNumber}`,
          data: { transactionId, transactionNumber, memberId: record.member_id, amount },
        }
      ).catch(err => console.error('Notification error (bishi cash admin):', err));

      const savedTxn = db
        .prepare('SELECT * FROM financial_transactions WHERE id = ?')
        .get(transactionId) as any;

      return {
        id: savedTxn.id,
        organizationId: savedTxn.organization_id,
        memberId: savedTxn.member_id,
        memberName: record.member_name,
        actorId: savedTxn.actor_id,
        transactionType: savedTxn.transaction_type,
        referenceId: savedTxn.reference_id,
        transactionNumber: savedTxn.transaction_number,
        amount: savedTxn.amount,
        paymentMethod: savedTxn.payment_method,
        transactionDate: savedTxn.transaction_date,
        status: savedTxn.status,
        notes: savedTxn.notes,
        bishiMonth: record.month_year,
        createdAt: savedTxn.created_at,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Records a verified online payment for a monthly Bishi cycle.
   * - Atomic: creates ledger transaction, updates Bishi status to PAID, updates payment_order to SUCCESS, and writes audit log.
   * - Strict validation: exact amount matching pending Bishi expected amount; rejects already paid records.
   * - Uses BEGIN IMMEDIATE TRANSACTION to prevent concurrent race-conditions.
   */
  public static recordOnlineBishiPayment(
    orgId: string,
    bishiRecordId: string,
    orderId: string,
    providerPaymentId: string,
    memberId: string,
    ipAddress: string,
    notes?: string
  ): FinancialTransaction {
    const db = getDatabase();

    // 1. Verify target Bishi record exists and belongs to this mandal & member
    const record = db
      .prepare(`
        SELECT r.*, u.full_name as member_name, u.phone as member_phone, u.is_active as member_active
        FROM bishi_records r
        INNER JOIN users u ON r.member_id = u.id AND r.organization_id = u.organization_id
        WHERE r.id = ? AND r.organization_id = ? AND r.member_id = ?
      `)
      .get(bishiRecordId, orgId, memberId) as any;

    if (!record) {
      throw new AppError('मासिक बीसी नोंद सापडली नाही (Bishi record not found for this member)', 404);
    }

    if (record.status === 'PAID') {
      throw new AppError('हा बीसी हप्ता आधीच भरला गेला आहे (This Bishi record is already paid)', 409);
    }

    // 2. Verify payment order exists and matches
    const order = db
      .prepare(`
        SELECT * FROM payment_orders
        WHERE id = ? AND organization_id = ? AND bishi_record_id = ?
      `)
      .get(orderId, orgId, bishiRecordId) as any;

    if (!order) {
      throw new AppError('पेमेंट ऑर्डर सापडली नाही (Payment order not found)', 404);
    }

    if (order.status === 'SUCCESS') {
      throw new AppError('हा पेमेंट आधीच यशस्वीरीत्या नोंदवला गेला आहे (Payment already finalized)', 409);
    }

    if (order.amount !== record.expected_amount) {
      throw new AppError('ऑर्डर रक्कम आणि बीसी अपेक्षित रक्कम जुळत नाही (Amount mismatch)', 400);
    }

    // 3. Atomic Execution with immediate write lock
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Re-check under locked transaction to guarantee race-condition safety
      const lockedRecord = db
        .prepare('SELECT status FROM bishi_records WHERE id = ?')
        .get(bishiRecordId) as any;

      if (!lockedRecord || lockedRecord.status === 'PAID') {
        throw new AppError('हा बीसी हप्ता आधीच भरला गेला आहे (Already paid)', 409);
      }

      const lockedOrder = db
        .prepare('SELECT status FROM payment_orders WHERE id = ?')
        .get(orderId) as any;

      if (!lockedOrder || lockedOrder.status === 'SUCCESS') {
        throw new AppError('पेमेंट ऑर्डर आधीच पूर्ण झाली आहे (Order already succeeded)', 409);
      }

      const transactionId = crypto.randomUUID();
      const transactionNumber = this.generateTransactionNumber();

      // Step A: Insert into financial_transactions
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type,
          reference_id, transaction_number, amount, payment_method,
          transaction_date, status, notes
        ) VALUES (?, ?, ?, ?, 'BISHI_PAYMENT', ?, ?, ?, 'ONLINE_UPI', CURRENT_TIMESTAMP, 'CONFIRMED', ?)
      `).run(
        transactionId,
        orgId,
        record.member_id,
        record.member_id, // Member initiated and paid themselves
        bishiRecordId,
        transactionNumber,
        record.expected_amount,
        notes || `ऑनलाइन UPI पेमेंट (Ref: ${providerPaymentId})`
      );

      // Step B: Update bishi_records to PAID
      db.prepare(`
        UPDATE bishi_records
        SET status = 'PAID',
            paid_amount = ?,
            paid_date = CURRENT_TIMESTAMP,
            payment_method = 'ONLINE_UPI',
            payment_transaction_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(record.expected_amount, transactionId, bishiRecordId);

      // Step C: Update payment_orders to SUCCESS
      db.prepare(`
        UPDATE payment_orders
        SET status = 'SUCCESS',
            provider_payment_id = ?,
            financial_transaction_id = ?,
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(providerPaymentId, transactionId, orderId);

      // Step D: Record Audit Log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'ONLINE_BISHI_PAYMENT_RECORDED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        record.member_id,
        JSON.stringify({
          transactionId,
          transactionNumber,
          bishiRecordId,
          orderId,
          providerPaymentId,
          amount: record.expected_amount,
          monthYear: record.month_year,
          paymentMethod: 'ONLINE_UPI',
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      // Dispatch notifications outside transaction
      NotificationService.sendNotification({
        organizationId: orgId,
        userId: record.member_id,
        type: 'PAYMENT_VERIFIED',
        title: 'ऑनलाइन पेमेंट यशस्वी',
        message: `${record.month_year} महिन्याची ₹${record.expected_amount} बिशी ऑनलाइन जमा झाली आहे. ट्रॅन्झॅक्शन क्र: ${transactionNumber}`,
        entityType: 'PAYMENT_ORDER',
        entityId: orderId,
        idempotencyKey: `payment-verified-${orderId}`,
        data: { transactionId, transactionNumber, orderId, providerPaymentId, amount: record.expected_amount, monthYear: record.month_year },
      }).catch(err => console.error('Notification error (online bishi member):', err));

      NotificationService.sendToRoles(
        orgId,
        ['PRESIDENT', 'TREASURER'],
        {
          type: 'PAYMENT_VERIFIED',
          title: 'नवीन ऑनलाइन बिशी जमा',
          message: `${record.member_name} यांचे ₹${record.expected_amount} चे ऑनलाइन पेमेंट यशस्वी झाले. (${record.month_year})`,
          entityType: 'PAYMENT_ORDER',
          entityId: orderId,
          idempotencyKey: `payment-verified-admin-${orderId}`,
          data: { transactionId, transactionNumber, orderId, memberId: record.member_id, amount: record.expected_amount },
        }
      ).catch(err => console.error('Notification error (online bishi admin):', err));

      const savedTxn = db
        .prepare('SELECT * FROM financial_transactions WHERE id = ?')
        .get(transactionId) as any;

      return {
        id: savedTxn.id,
        organizationId: savedTxn.organization_id,
        memberId: savedTxn.member_id,
        memberName: record.member_name,
        actorId: savedTxn.actor_id,
        actorName: record.member_name,
        transactionType: savedTxn.transaction_type,
        referenceId: savedTxn.reference_id,
        transactionNumber: savedTxn.transaction_number,
        amount: savedTxn.amount,
        paymentMethod: savedTxn.payment_method,
        transactionDate: savedTxn.transaction_date,
        status: savedTxn.status,
        notes: savedTxn.notes,
        bishiMonth: record.month_year,
        createdAt: savedTxn.created_at,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Get a member's digital passbook with deterministic ordering.
   * Member can view ONLY their own passbook; President/Treasurer can view any in mandal.
   */
  public static getMemberPassbook(orgId: string, memberId: string): MemberPassbookResponse {
    const db = getDatabase();

    // Verify member exists in mandal
    const member = db
      .prepare('SELECT id, full_name, phone FROM users WHERE id = ? AND organization_id = ?')
      .get(memberId, orgId) as { id: string; full_name: string; phone: string } | undefined;

    if (!member) {
      throw new AppError('सदस्य सापडला नाही (Member not found in this mandal)', 404);
    }

    // Deterministic ordering: transaction_date DESC, created_at DESC, id DESC
    const rows = db
      .prepare(`
        SELECT 
          t.*,
          a.full_name as actor_name,
          r.month_year as bishi_month
        FROM financial_transactions t
        LEFT JOIN users a ON t.actor_id = a.id
        LEFT JOIN bishi_records r ON t.reference_id = r.id
        WHERE t.organization_id = ? AND t.member_id = ? AND t.status = 'CONFIRMED'
          AND t.transaction_type IN ('BISHI_PAYMENT', 'LOAN_DISBURSED', 'LOAN_REPAYMENT')
        ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
      `)
      .all(orgId, memberId) as any[];

    let totalPaid = 0;
    const transactions: FinancialTransaction[] = rows.map((r) => {
      if (r.transaction_type === 'BISHI_PAYMENT' || r.transaction_type === 'LOAN_REPAYMENT') {
        totalPaid += r.amount;
      }
      return {
        id: r.id,
        organizationId: r.organization_id,
        memberId: r.member_id,
        memberName: member.full_name,
        actorId: r.actor_id,
        actorName: r.actor_name,
        transactionType: r.transaction_type,
        referenceId: r.reference_id,
        transactionNumber: r.transaction_number,
        amount: r.amount,
        paymentMethod: r.payment_method,
        transactionDate: r.transaction_date,
        status: r.status,
        notes: r.notes,
        bishiMonth: r.bishi_month,
        createdAt: r.created_at,
      };
    });

    return {
      member: {
        id: member.id,
        fullName: member.full_name,
        phone: member.phone,
      },
      totalPaid,
      totalTransactions: transactions.length,
      transactions,
    };
  }

  /**
   * Get organization-wide financial ledger (President & Treasurer Only).
   * Calculates real treasury funds dynamically: Inflow (Bishi + Repayment) - Outflow (Disbursed + Expenses).
   */
  public static getOrganizationLedger(
    orgId: string,
    page = 1,
    limit = 20
  ): OrganizationLedgerResponse {
    const db = getDatabase();
    const offset = (page - 1) * limit;

    // Total metrics derived strictly from real ledger transactions
    const summaryRow = db
      .prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type IN ('BISHI_PAYMENT', 'LOAN_REPAYMENT') THEN amount ELSE 0 END), 0) as total_inflow,
          COALESCE(SUM(CASE WHEN transaction_type = 'LOAN_DISBURSED' THEN amount ELSE 0 END), 0) as total_loans_disbursed,
          COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount ELSE 0 END), 0) as total_expenses,
          COUNT(*) as total_transactions
        FROM financial_transactions
        WHERE organization_id = ? AND status = 'CONFIRMED'
      `)
      .get(orgId) as any;

    const totalInflow = summaryRow?.total_inflow || 0;
    const totalLoansDisbursed = summaryRow?.total_loans_disbursed || 0;
    const totalExpenses = summaryRow?.total_expenses || 0;
    const totalOutflow = totalLoansDisbursed + totalExpenses;
    const totalFunds = totalInflow - totalOutflow; // Net available treasury funds
    const totalTransactions = summaryRow?.total_transactions || 0;

    const rows = db
      .prepare(`
        SELECT 
          t.*,
          m.full_name as member_name,
          m.phone as member_phone,
          a.full_name as actor_name,
          r.month_year as bishi_month
        FROM financial_transactions t
        LEFT JOIN users m ON t.member_id = m.id
        LEFT JOIN users a ON t.actor_id = a.id
        LEFT JOIN bishi_records r ON t.reference_id = r.id
        WHERE t.organization_id = ? AND t.status = 'CONFIRMED'
        ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(orgId, limit, offset) as any[];

    const transactions: FinancialTransaction[] = rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      memberId: r.member_id || null,
      memberName: r.member_name || (r.transaction_type === 'EXPENSE' ? 'मंडळ खर्च' : undefined),
      actorId: r.actor_id,
      actorName: r.actor_name,
      transactionType: r.transaction_type,
      referenceId: r.reference_id,
      transactionNumber: r.transaction_number,
      amount: r.amount,
      paymentMethod: r.payment_method,
      transactionDate: r.transaction_date,
      status: r.status,
      notes: r.notes,
      bishiMonth: r.bishi_month,
      createdAt: r.created_at,
    }));

    return {
      summary: {
        totalFunds,
        totalInflow,
        totalOutflow,
        totalExpenses,
        totalTransactions,
      },
      transactions,
      pagination: {
        total: totalTransactions,
        page,
        limit,
        totalPages: Math.ceil(totalTransactions / limit) || 1,
      },
    };
  }

  /**
   * Retrieves an authentic, immutable receipt for a confirmed financial transaction.
   * - Strict eligibility: Only 'CONFIRMED' transactions have receipts.
   * - IDOR barrier: Members can view ONLY their own receipts (403 for other members).
   * - Mandal barrier: President & Treasurer can view receipts within their own mandal only.
   */
  public static getTransactionReceipt(
    orgId: string,
    transactionId: string,
    actor: AuthenticatedUser
  ): TransactionReceipt {
    const db = getDatabase();

    const row = db
      .prepare(`
        SELECT 
          t.id as transaction_id,
          t.organization_id,
          t.member_id,
          t.actor_id,
          t.transaction_type,
          t.reference_id,
          t.transaction_number,
          t.amount,
          t.payment_method,
          t.transaction_date,
          t.status,
          t.notes,
          o.name as org_name,
          o.code as org_code,
          o.registration_number as org_reg_no,
          m.full_name as member_name,
          m.phone as member_phone,
          a.full_name as actor_name,
          a.role as actor_role,
          r.month_year as bishi_month
        FROM financial_transactions t
        INNER JOIN organizations o ON t.organization_id = o.id
        LEFT JOIN users m ON t.member_id = m.id
        INNER JOIN users a ON t.actor_id = a.id
        LEFT JOIN bishi_records r ON t.reference_id = r.id
        WHERE t.id = ? AND t.organization_id = ?
      `)
      .get(transactionId, orgId) as any;

    if (!row) {
      throw new AppError('व्यवहार सापडला नाही (Transaction not found in this mandal)', 404);
    }

    // Receipt eligibility: Available only for confirmed transactions
    if (row.status !== 'CONFIRMED') {
      throw new AppError('या व्यवहाराची पावती उपलब्ध नाही (Receipt is not available for this transaction)', 400);
    }

    // IDOR Protection: Member can only view their own receipt
    if (actor.role === 'MEMBER' && (!row.member_id || row.member_id !== actor.id)) {
      throw new AppError('तुम्हाला इतर सदस्यांची पावती पाहण्याची परवानगी नाही (Cannot view other member receipt)', 403);
    }

    // System-generated deterministic and immutable receipt number
    const receiptNumber = `RCP-${row.transaction_number.replace(/^TXN-/, '')}`;

    return {
      receiptNumber,
      transactionNumber: row.transaction_number,
      transactionId: row.transaction_id,
      transactionType: row.transaction_type,
      organization: {
        id: row.organization_id,
        name: row.org_name,
        code: row.org_code,
        registrationNumber: row.org_reg_no || null,
      },
      member: {
        id: row.member_id || null,
        fullName: row.member_name || (row.transaction_type === 'EXPENSE' ? 'मंडळ खर्च (संस्था)' : 'मंडळ'),
        phone: row.member_phone || '-',
      },
      bishiMonth: row.bishi_month || null,
      amount: row.amount,
      paymentMethod: row.payment_method,
      transactionDate: row.transaction_date,
      recordedBy: {
        id: row.actor_id,
        fullName: row.actor_name,
        role: row.actor_role,
      },
      status: 'CONFIRMED',
      notes: row.notes || null,
    };
  }

  /**
   * Retrieves comprehensive Mandal financial summary (President & Treasurer Only).
   * All 9 metrics derived strictly and dynamically from confirmed database records.
   */
  public static getMandalFinancialSummary(orgId: string): MandalFinancialSummary {
    const db = getDatabase();

    // Query 1: Ledger Aggregations from confirmed financial transactions
    const ledgerRow = db
      .prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type IN ('BISHI_PAYMENT', 'LOAN_REPAYMENT') THEN amount ELSE 0 END), 0) as total_inflow,
          COALESCE(SUM(CASE WHEN transaction_type = 'BISHI_PAYMENT' THEN amount ELSE 0 END), 0) as total_vargani_collected,
          COALESCE(SUM(CASE WHEN transaction_type = 'LOAN_DISBURSED' THEN amount ELSE 0 END), 0) as total_loans_disbursed,
          COALESCE(SUM(CASE WHEN transaction_type = 'LOAN_REPAYMENT' THEN amount ELSE 0 END), 0) as total_loan_repayments,
          COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount ELSE 0 END), 0) as total_expenses,
          COUNT(*) as total_transactions
        FROM financial_transactions
        WHERE organization_id = ? AND status = 'CONFIRMED'
      `)
      .get(orgId) as any;

    const totalInflow = ledgerRow?.total_inflow || 0;
    const totalVarganiCollected = ledgerRow?.total_vargani_collected || 0;
    const totalLoansDisbursed = ledgerRow?.total_loans_disbursed || 0;
    const totalLoanRepayments = ledgerRow?.total_loan_repayments || 0;
    const totalExpenses = ledgerRow?.total_expenses || 0;
    const totalTransactions = ledgerRow?.total_transactions || 0;

    const currentBalance = totalInflow - (totalLoansDisbursed + totalExpenses);
    const outstandingLoans = totalLoansDisbursed - totalLoanRepayments;

    // Query 2: Pending Vargani from bishi_records (status != 'PAID')
    const bishiRow = db
      .prepare(`
        SELECT COALESCE(SUM(expected_amount - paid_amount), 0) as pending_vargani
        FROM bishi_records
        WHERE organization_id = ? AND status != 'PAID'
      `)
      .get(orgId) as any;

    const pendingVargani = bishiRow?.pending_vargani || 0;

    return {
      currentBalance,
      totalInflow,
      totalVarganiCollected,
      pendingVargani,
      totalExpenses,
      totalLoansDisbursed,
      totalLoanRepayments,
      outstandingLoans,
      totalTransactions,
    };
  }

  /**
   * Records a confirmed Vargani / Jama contribution (President & Treasurer Only).
   * - If bishiRecordId is provided: reuses recordCashBishiPayment flow to mark Bishi PAID.
   * - If general contribution: records an immutable credit in financial_transactions with reference_id.
   * - Atomic: BEGIN IMMEDIATE TRANSACTION with full audit log and receipt integration.
   */
  public static recordVarganiContribution(
    orgId: string,
    input: RecordVarganiContributionInput,
    actor: AuthenticatedUser,
    ipAddress: string
  ): FinancialTransaction {
    const db = getDatabase();

    // 1. Authorization check: President or Treasurer only
    if (actor.role !== 'PRESIDENT' && actor.role !== 'TREASURER') {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार वर्गणी नोंदवू शकतात (Only President or Treasurer can record contribution)', 403);
    }

    if (!actor.isActive) {
      throw new AppError('निष्क्रिय वापरकर्ता वर्गणी नोंदवू शकत नाही (Inactive user cannot record contribution)', 403);
    }

    // 2. If bishiRecordId is given: reuse the existing authoritative Bishi payment flow
    if (input.bishiRecordId) {
      return this.recordCashBishiPayment(
        orgId,
        input.bishiRecordId,
        input.amount,
        actor,
        ipAddress,
        input.notes
      );
    }

    // 3. Otherwise: General / Separate Vargani contribution
    // If memberId provided: verify member belongs to this mandal and is active
    let memberName: string | undefined;
    if (input.memberId) {
      const member = db
        .prepare('SELECT id, full_name, is_active FROM users WHERE id = ? AND organization_id = ?')
        .get(input.memberId, orgId) as { id: string; full_name: string; is_active: number } | undefined;

      if (!member) {
        throw new AppError('सदस्य सापडला नाही (Member not found in this mandal)', 404);
      }
      if (!member.is_active) {
        throw new AppError('निष्क्रिय सदस्यासाठी वर्गणी नोंदवता येत नाही (Cannot record contribution for inactive member)', 400);
      }
      memberName = member.full_name;
    }

    const transactionId = crypto.randomUUID();
    const transactionNumber = this.generateTransactionNumber();
    const referenceId = `vargani_${crypto.randomUUID()}`;
    const contributionNotes = input.notes || (input.contributorName ? `वर्गणी जमा: ${input.contributorName}` : 'मंडळ वर्गणी / जमा');

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type,
          reference_id, transaction_number, amount, payment_method,
          transaction_date, status, notes
        ) VALUES (?, ?, ?, ?, 'BISHI_PAYMENT', ?, ?, ?, 'CASH', CURRENT_TIMESTAMP, 'CONFIRMED', ?)
      `).run(
        transactionId,
        orgId,
        input.memberId || null,
        actor.id,
        referenceId,
        transactionNumber,
        input.amount,
        contributionNotes
      );

      // Audit log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'VARGANI_CONTRIBUTION_RECORDED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          transactionId,
          transactionNumber,
          referenceId,
          memberId: input.memberId || null,
          contributorName: input.contributorName || memberName || null,
          amount: input.amount,
          paymentMethod: 'CASH',
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      const contributorDisplay = input.contributorName || memberName || 'वर्गणीदार';
      NotificationService.sendToRoles(
        orgId,
        ['PRESIDENT', 'TREASURER'],
        {
          type: 'FINANCIAL_EVENT',
          title: 'नवीन वर्गणी जमा',
          message: `${contributorDisplay} यांच्याकडून ₹${input.amount} वर्गणी जमा झाली आहे. पावती क्र: ${transactionNumber}`,
          entityType: 'PAYMENT',
          entityId: referenceId,
          idempotencyKey: `vargani-${transactionNumber}`,
          data: { transactionId, transactionNumber, amount: input.amount, contributorName: contributorDisplay },
        }
      ).catch(err => console.error('Notification error (vargani admin):', err));

      return {
        id: transactionId,
        organizationId: orgId,
        memberId: input.memberId || null,
        memberName,
        actorId: actor.id,
        actorName: actor.fullName,
        transactionType: 'BISHI_PAYMENT',
        referenceId,
        transactionNumber,
        amount: input.amount,
        paymentMethod: 'CASH',
        transactionDate: new Date().toISOString(),
        status: 'CONFIRMED',
        notes: contributionNotes,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}

