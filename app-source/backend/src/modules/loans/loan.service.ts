import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser, ROLES } from '../../types/roles.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CreateLoanInput } from './loan.validation.js';
import { NotificationService } from '../notifications/notification.service.js';

export interface LoanRepayment {
  id: string;
  organizationId: string;
  loanId: string;
  memberId: string;
  actorId: string;
  actorName?: string;
  amount: number;
  paymentMethod: 'CASH';
  repaymentDate: string;
  transactionId: string | null;
  transactionNumber?: string;
  notes: string | null;
  createdAt: string;
}

export interface Loan {
  id: string;
  organizationId: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  actorId: string;
  actorName?: string;
  amount: number;
  loanDate: string;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  interestRate: number;
  notes: string | null;
  disbursementTransactionId: string | null;
  disbursementTransactionNumber?: string;
  totalRepaid: number;
  outstandingBalance: number;
  createdAt: string;
  updatedAt: string;
  repayments?: LoanRepayment[];
}

export class LoanService {
  /**
   * President-only loan creation and disbursement.
   * Atomically creates loan record, LOAN_DISBURSED ledger transaction, and audit log.
   */
  public static createLoan(
    orgId: string,
    input: CreateLoanInput,
    actor: AuthenticatedUser,
    ipAddress: string
  ): Loan {
    const db = getDatabase();

    // 1. Authorization: President or Treasurer can create/approve loans
    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार कर्ज मंजूर करू शकतात (Only President or Treasurer can approve loans)', 403);
    }

    if (!actor.isActive) {
      throw new AppError('निष्क्रिय वापरकर्ता कर्ज मंजूर करू शकत नाही (Inactive user cannot approve loans)', 403);
    }

    // 2. Verify target member exists in the same mandal and is active
    const member = db
      .prepare('SELECT id, full_name, phone, is_active FROM users WHERE id = ? AND organization_id = ?')
      .get(input.memberId, orgId) as { id: string; full_name: string; phone: string; is_active: number } | undefined;

    if (!member) {
      throw new AppError('सदस्य सापडला नाही (Member not found in this mandal)', 404);
    }

    if (!member.is_active) {
      throw new AppError('निष्क्रिय सदस्याला कर्ज देता येत नाही (Cannot grant loan to inactive member)', 400);
    }

    const loanId = crypto.randomUUID();
    const txnId = crypto.randomUUID();
    const txnNumber = LedgerService.generateTransactionNumber();
    const loanDate = input.loanDate || new Date().toISOString();

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Step A: Create LOAN_DISBURSED transaction in financial_transactions
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type,
          reference_id, transaction_number, amount, payment_method,
          transaction_date, status, notes
        ) VALUES (?, ?, ?, ?, 'LOAN_DISBURSED', ?, ?, ?, 'CASH', ?, 'CONFIRMED', ?)
      `).run(
        txnId,
        orgId,
        member.id,
        actor.id,
        loanId,
        txnNumber,
        input.amount,
        loanDate,
        input.notes || null
      );

      // Step B: Create loan record
      db.prepare(`
        INSERT INTO loans (
          id, organization_id, member_id, actor_id, amount,
          loan_date, status, interest_rate, notes, disbursement_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0.0, ?, ?)
      `).run(
        loanId,
        orgId,
        member.id,
        actor.id,
        input.amount,
        loanDate,
        input.notes || null,
        txnId
      );

      // Step C: Audit log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'LOAN_CREATED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          loanId,
          memberId: member.id,
          memberName: member.full_name,
          amount: input.amount,
          transactionNumber: txnNumber,
          actorRole: actor.role,
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      // Dispatch notifications outside transaction
      NotificationService.sendNotification({
        organizationId: orgId,
        userId: member.id,
        type: 'LOAN_DISBURSED',
        title: 'कर्ज मंजूर व वितरित',
        message: `आपल्या खात्यावर ₹${input.amount} चे कर्ज मंजूर व वितरित झाले आहे. पावती क्र: ${txnNumber}`,
        entityType: 'LOAN',
        entityId: loanId,
        idempotencyKey: `loan-disbursed-${loanId}`,
        data: { loanId, transactionId: txnId, transactionNumber: txnNumber, amount: input.amount },
      }).catch(err => console.error('Notification error (loan member):', err));

      const notifyRoles = actor.role === ROLES.PRESIDENT ? [ROLES.TREASURER] : [ROLES.PRESIDENT];
      NotificationService.sendToRoles(
        orgId,
        notifyRoles,
        {
          type: 'LOAN_DISBURSED',
          title: 'नवीन कर्ज वितरण',
          message: `${member.full_name} यांना ₹${input.amount} कर्ज मंजूर व वितरित करण्यात आले आहे.`,
          entityType: 'LOAN',
          entityId: loanId,
          idempotencyKey: `loan-disbursed-admin-${loanId}`,
          data: { loanId, transactionId: txnId, transactionNumber: txnNumber, memberId: member.id, amount: input.amount },
        }
      ).catch(err => console.error('Notification error (loan admin):', err));

      return {
        id: loanId,
        organizationId: orgId,
        memberId: member.id,
        memberName: member.full_name,
        memberPhone: member.phone,
        actorId: actor.id,
        actorName: actor.fullName,
        amount: input.amount,
        loanDate,
        status: 'ACTIVE',
        interestRate: 0.0,
        notes: input.notes || null,
        disbursementTransactionId: txnId,
        disbursementTransactionNumber: txnNumber,
        totalRepaid: 0,
        outstandingBalance: input.amount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repayments: [],
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Records a real cash loan repayment (President or Treasurer).
   * Strict validation: Overpayment rejected; atomic database transaction; auto-closes loan upon full repayment.
   */
  public static recordCashLoanRepayment(
    orgId: string,
    loanId: string,
    amount: number,
    actor: AuthenticatedUser,
    ipAddress: string,
    notes?: string
  ): { repayment: LoanRepayment; loan: Loan } {
    const db = getDatabase();

    // 1. Authorization: President or Treasurer can record cash repayments
    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार कर्ज परतफेड नोंदवू शकतात (Only President or Treasurer can record repayment)', 403);
    }

    if (!actor.isActive) {
      throw new AppError('निष्क्रिय वापरकर्ता परतफेड नोंदवू शकत नाही (Inactive user cannot record repayment)', 403);
    }

    // 2. Verify loan exists in mandal
    const initialLoan = db
      .prepare(`
        SELECT l.*, u.full_name as member_name, u.phone as member_phone
        FROM loans l
        INNER JOIN users u ON l.member_id = u.id
        WHERE l.id = ? AND l.organization_id = ?
      `)
      .get(loanId, orgId) as any;

    if (!initialLoan) {
      throw new AppError('कर्ज नोंद सापडली नाही (Loan record not found in this mandal)', 404);
    }

    if (initialLoan.status === 'CLOSED') {
      throw new AppError('हे कर्ज आधीच पूर्ण भरले गेले आहे (This loan is already fully repaid and closed)', 400);
    }

    if (initialLoan.status === 'CANCELLED') {
      throw new AppError('हे कर्ज रद्द करण्यात आले आहे (This loan is cancelled)', 400);
    }

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Re-verify under immediate write lock
      const lockedLoan = db
        .prepare('SELECT * FROM loans WHERE id = ?')
        .get(loanId) as any;

      if (!lockedLoan || lockedLoan.status === 'CLOSED') {
        throw new AppError('हे कर्ज आधीच पूर्ण भरले गेले आहे (Already fully repaid)', 400);
      }

      // Calculate current total repaid from confirmed ledger transactions
      const sumRow = db
        .prepare(`
          SELECT COALESCE(SUM(amount), 0) as total_repaid
          FROM financial_transactions
          WHERE organization_id = ? 
            AND transaction_type = 'LOAN_REPAYMENT'
            AND reference_id IN (SELECT id FROM loan_repayments WHERE loan_id = ?)
            AND status = 'CONFIRMED'
        `)
        .get(orgId, loanId) as any;

      const currentRepaid = sumRow.total_repaid || 0;
      const outstanding = lockedLoan.amount - currentRepaid;

      // Overpayment check
      if (amount > outstanding) {
        throw new AppError(
          `परतफेड रक्कम उर्वरित बाकी रकमेपेक्षा (₹${outstanding}) जास्त असू शकत नाही (Repayment cannot exceed outstanding balance of ₹${outstanding})`,
          400
        );
      }

      const repaymentId = crypto.randomUUID();
      const txnId = crypto.randomUUID();
      const txnNumber = LedgerService.generateTransactionNumber();
      const repaymentDate = new Date().toISOString();

      // Step A: Insert into loan_repayments
      db.prepare(`
        INSERT INTO loan_repayments (
          id, organization_id, loan_id, member_id, actor_id,
          amount, payment_method, repayment_date, transaction_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, 'CASH', ?, ?, ?)
      `).run(
        repaymentId,
        orgId,
        loanId,
        lockedLoan.member_id,
        actor.id,
        amount,
        repaymentDate,
        txnId,
        notes || null
      );

      // Step B: Insert into financial_transactions
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type,
          reference_id, transaction_number, amount, payment_method,
          transaction_date, status, notes
        ) VALUES (?, ?, ?, ?, 'LOAN_REPAYMENT', ?, ?, ?, 'CASH', ?, 'CONFIRMED', ?)
      `).run(
        txnId,
        orgId,
        lockedLoan.member_id,
        actor.id,
        repaymentId,
        txnNumber,
        amount,
        repaymentDate,
        notes || null
      );

      const newTotalRepaid = currentRepaid + amount;
      const newOutstanding = lockedLoan.amount - newTotalRepaid;
      const newStatus = newOutstanding === 0 ? 'CLOSED' : 'ACTIVE';

      // Step C: Update loan status and timestamp
      db.prepare(`
        UPDATE loans
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newStatus, loanId);

      // Step D: Audit log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'LOAN_REPAYMENT_RECORDED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          loanId,
          repaymentId,
          transactionId: txnId,
          transactionNumber: txnNumber,
          memberId: lockedLoan.member_id,
          amount,
          newOutstanding,
          newStatus,
          actorRole: actor.role,
        }),
        ipAddress
      );

      if (newStatus === 'CLOSED') {
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
          VALUES (?, ?, ?, 'LOAN_CLOSED', ?, ?)
        `).run(
          crypto.randomUUID(),
          orgId,
          actor.id,
          JSON.stringify({
            loanId,
            memberId: lockedLoan.member_id,
            totalRepaid: newTotalRepaid,
            actorRole: actor.role,
          }),
          ipAddress
        );
      }

      db.exec('COMMIT;');

      // Dispatch notifications outside transaction
      NotificationService.sendNotification({
        organizationId: orgId,
        userId: lockedLoan.member_id,
        type: 'LOAN_REPAYMENT',
        title: 'कर्ज परतफेड जमा',
        message: `₹${amount} ची कर्ज परतफेड जमा झाली आहे. शिल्लक कर्ज: ₹${newOutstanding}. पावती क्र: ${txnNumber}`,
        entityType: 'LOAN',
        entityId: loanId,
        idempotencyKey: `loan-repayment-${repaymentId}`,
        data: { loanId, repaymentId, transactionId: txnId, transactionNumber: txnNumber, amount, newOutstanding, newStatus },
      }).catch(err => console.error('Notification error (loan repayment member):', err));

      NotificationService.sendToRoles(
        orgId,
        [ROLES.PRESIDENT, ROLES.TREASURER],
        {
          type: 'LOAN_REPAYMENT',
          title: 'कर्ज परतफेड नोंद',
          message: `${lockedLoan.member_name} यांनी ₹${amount} ची कर्ज परतफेड केली. उर्वरित बाकी: ₹${newOutstanding}.`,
          entityType: 'LOAN',
          entityId: loanId,
          idempotencyKey: `loan-repayment-admin-${repaymentId}`,
          data: { loanId, repaymentId, transactionId: txnId, transactionNumber: txnNumber, memberId: lockedLoan.member_id, amount, newOutstanding },
        }
      ).catch(err => console.error('Notification error (loan repayment admin):', err));

      const repaymentObj: LoanRepayment = {
        id: repaymentId,
        organizationId: orgId,
        loanId,
        memberId: lockedLoan.member_id,
        actorId: actor.id,
        actorName: actor.fullName,
        amount,
        paymentMethod: 'CASH',
        repaymentDate,
        transactionId: txnId,
        transactionNumber: txnNumber,
        notes: notes || null,
        createdAt: repaymentDate,
      };

      const loanObj: Loan = {
        id: loanId,
        organizationId: orgId,
        memberId: lockedLoan.member_id,
        memberName: initialLoan.member_name,
        memberPhone: initialLoan.member_phone,
        actorId: lockedLoan.actor_id,
        amount: lockedLoan.amount,
        loanDate: lockedLoan.loan_date,
        status: newStatus,
        interestRate: lockedLoan.interest_rate,
        notes: lockedLoan.notes,
        disbursementTransactionId: lockedLoan.disbursement_transaction_id,
        totalRepaid: newTotalRepaid,
        outstandingBalance: newOutstanding,
        createdAt: lockedLoan.created_at,
        updatedAt: new Date().toISOString(),
      };

      return { repayment: repaymentObj, loan: loanObj };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Retrieves loans for a member with dynamic calculation of total repaid and outstanding balance.
   * Member can view only their own loans; President & Treasurer can view any in mandal.
   */
  public static getMemberLoans(
    orgId: string,
    memberId: string,
    actor: AuthenticatedUser
  ): Loan[] {
    const db = getDatabase();

    // IDOR check: Regular member cannot view another member's loans
    if (actor.role === ROLES.MEMBER && actor.id !== memberId) {
      throw new AppError('तुम्हाला इतर सदस्यांची कर्जे पाहण्याची परवानगी नाही (Cannot view other member loans)', 403);
    }

    // Verify member exists in mandal
    const member = db
      .prepare('SELECT id, full_name, phone FROM users WHERE id = ? AND organization_id = ?')
      .get(memberId, orgId) as { id: string; full_name: string; phone: string } | undefined;

    if (!member) {
      throw new AppError('सदस्य सापडला नाही (Member not found in this mandal)', 404);
    }

    const loanRows = db
      .prepare(`
        SELECT 
          l.*,
          a.full_name as actor_name,
          dt.transaction_number as disbursement_txn_number
        FROM loans l
        LEFT JOIN users a ON l.actor_id = a.id
        LEFT JOIN financial_transactions dt ON l.disbursement_transaction_id = dt.id
        WHERE l.organization_id = ? AND l.member_id = ?
        ORDER BY l.loan_date DESC, l.created_at DESC, l.id DESC
      `)
      .all(orgId, memberId) as any[];

    return loanRows.map((row) => {
      // Fetch repayments for this loan
      const repayments = db
        .prepare(`
          SELECT 
            r.*,
            u.full_name as actor_name,
            t.transaction_number
          FROM loan_repayments r
          LEFT JOIN users u ON r.actor_id = u.id
          LEFT JOIN financial_transactions t ON r.transaction_id = t.id
          WHERE r.loan_id = ? AND r.organization_id = ?
          ORDER BY r.repayment_date DESC, r.created_at DESC
        `)
        .all(row.id, orgId) as any[];

      const totalRepaid = repayments.reduce((sum: number, r: any) => sum + r.amount, 0);
      const outstandingBalance = Math.max(0, row.amount - totalRepaid);

      return {
        id: row.id,
        organizationId: row.organization_id,
        memberId: row.member_id,
        memberName: member.full_name,
        memberPhone: member.phone,
        actorId: row.actor_id,
        actorName: row.actor_name,
        amount: row.amount,
        loanDate: row.loan_date,
        status: row.status,
        interestRate: row.interest_rate,
        notes: row.notes,
        disbursementTransactionId: row.disbursement_transaction_id,
        disbursementTransactionNumber: row.disbursement_txn_number,
        totalRepaid,
        outstandingBalance,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        repayments: repayments.map((r: any) => ({
          id: r.id,
          organizationId: r.organization_id,
          loanId: r.loan_id,
          memberId: r.member_id,
          actorId: r.actor_id,
          actorName: r.actor_name,
          amount: r.amount,
          paymentMethod: r.payment_method,
          repaymentDate: r.repayment_date,
          transactionId: r.transaction_id,
          transactionNumber: r.transaction_number,
          notes: r.notes,
          createdAt: r.created_at,
        })),
      };
    });
  }

  /**
   * Retrieves all loans within the mandal (President & Treasurer Only).
   */
  public static getMandalLoans(
    orgId: string,
    actor: AuthenticatedUser
  ): Loan[] {
    const db = getDatabase();

    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार मंडळाची कर्जे पाहू शकतात (President or Treasurer only)', 403);
    }

    const rows = db
      .prepare(`
        SELECT 
          l.*,
          m.full_name as member_name,
          m.phone as member_phone,
          a.full_name as actor_name,
          dt.transaction_number as disbursement_txn_number
        FROM loans l
        INNER JOIN users m ON l.member_id = m.id
        LEFT JOIN users a ON l.actor_id = a.id
        LEFT JOIN financial_transactions dt ON l.disbursement_transaction_id = dt.id
        WHERE l.organization_id = ?
        ORDER BY l.loan_date DESC, l.created_at DESC, l.id DESC
      `)
      .all(orgId) as any[];

    return rows.map((row) => {
      const repayments = db
        .prepare(`
          SELECT 
            r.*,
            u.full_name as actor_name,
            t.transaction_number
          FROM loan_repayments r
          LEFT JOIN users u ON r.actor_id = u.id
          LEFT JOIN financial_transactions t ON r.transaction_id = t.id
          WHERE r.loan_id = ? AND r.organization_id = ?
          ORDER BY r.repayment_date DESC, r.created_at DESC
        `)
        .all(row.id, orgId) as any[];

      const totalRepaid = repayments.reduce((sum: number, r: any) => sum + r.amount, 0);
      const outstandingBalance = Math.max(0, row.amount - totalRepaid);

      return {
        id: row.id,
        organizationId: row.organization_id,
        memberId: row.member_id,
        memberName: row.member_name,
        memberPhone: row.member_phone,
        actorId: row.actor_id,
        actorName: row.actor_name,
        amount: row.amount,
        loanDate: row.loan_date,
        status: row.status,
        interestRate: row.interest_rate,
        notes: row.notes,
        disbursementTransactionId: row.disbursement_transaction_id,
        disbursementTransactionNumber: row.disbursement_txn_number,
        totalRepaid,
        outstandingBalance,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        repayments: repayments.map((r: any) => ({
          id: r.id,
          organizationId: r.organization_id,
          loanId: r.loan_id,
          memberId: r.member_id,
          actorId: r.actor_id,
          actorName: r.actor_name,
          amount: r.amount,
          paymentMethod: r.payment_method,
          repaymentDate: r.repayment_date,
          transactionId: r.transaction_id,
          transactionNumber: r.transaction_number,
          notes: r.notes,
          createdAt: r.created_at,
        })),
      };
    });
  }

  /**
   * Safely deletes or cancels a loan (President or Treasurer).
   * Financial Safeguards:
   * 1. Rejects deletion if any loan repayments exist in loan_repayments.
   * 2. If loan has a disbursement ledger transaction:
   *    Protects financial integrity from destructive hard-delete.
   *    Performs safe reversal/cancellation: marks loan as CANCELLED and disbursement transaction as CANCELLED.
   * 3. If loan is unreferenced (no repayments, no disbursement transaction):
   *    Safely hard-deletes loan record.
   * 4. Member access is strictly rejected (403).
   */
  public static deleteLoan(
    orgId: string,
    loanId: string,
    actor: AuthenticatedUser,
    ipAddress: string
  ): { id: string; action: 'DELETED' | 'CANCELLED'; message: string } {
    const db = getDatabase();

    // 1. Authorization: President or Treasurer only
    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार कर्ज हटवू किंवा रद्द करू शकतात (President or Treasurer only)', 403);
    }

    // 2. Fetch loan in mandal
    const loan = db
      .prepare(`
        SELECT l.*, u.full_name as member_name
        FROM loans l
        INNER JOIN users u ON l.member_id = u.id
        WHERE l.id = ? AND l.organization_id = ?
      `)
      .get(loanId, orgId) as any;

    if (!loan) {
      throw new AppError('कर्ज नोंद सापडली नाही (Loan record not found in this mandal)', 404);
    }

    if (loan.status === 'CANCELLED') {
      throw new AppError('हे कर्ज आधीच रद्द करण्यात आले आहे (This loan is already cancelled)', 400);
    }

    // 3. Inspect financial relationships:
    // Check repayments
    const repaymentCount = db
      .prepare('SELECT COUNT(*) as count FROM loan_repayments WHERE loan_id = ? AND organization_id = ?')
      .get(loanId, orgId) as { count: number };

    if (repaymentCount.count > 0) {
      throw new AppError(
        'परतफेड असलेले कर्ज हटवता येत नाही. लेजर, पावत्या व आर्थिक इतिहासाचे संरक्षण आवश्यक आहे (Cannot delete loan with existing repayments; financial history must be preserved)',
        400
      );
    }

    // Check disbursement transaction
    const disbursementTxnId = loan.disbursement_transaction_id;

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      let actionTaken: 'DELETED' | 'CANCELLED' = 'DELETED';
      let message = '';

      if (disbursementTxnId) {
        // Financially active loan with disbursement ledger transaction:
        // Protect from destructive hard-delete! Use safe cancellation/reversal architecture.
        db.prepare(`
          UPDATE loans
          SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ?
        `).run(loanId, orgId);

        db.prepare(`
          UPDATE financial_transactions
          SET status = 'CANCELLED'
          WHERE id = ? AND organization_id = ?
        `).run(disbursementTxnId, orgId);

        actionTaken = 'CANCELLED';
        message = 'कर्ज यशस्वीरीत्या रद्द केले (Loan cancelled successfully; ledger transaction marked CANCELLED)';

        // Audit log
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
          VALUES (?, ?, ?, 'LOAN_CANCELLED', ?, ?)
        `).run(
          crypto.randomUUID(),
          orgId,
          actor.id,
          JSON.stringify({
            loanId,
            memberId: loan.member_id,
            memberName: loan.member_name,
            amount: loan.amount,
            disbursementTransactionId: disbursementTxnId,
            action: 'CANCELLED',
            cancelledByName: actor.fullName,
            cancelledByRole: actor.role,
          }),
          ipAddress
        );
      } else {
        // Safe permanent deletion for unreferenced / draft loan
        db.prepare('DELETE FROM loans WHERE id = ? AND organization_id = ?').run(loanId, orgId);

        actionTaken = 'DELETED';
        message = 'कर्ज नोंद यशस्वीरीत्या हटवली (Loan record deleted successfully)';

        // Audit log
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
          VALUES (?, ?, ?, 'LOAN_DELETED', ?, ?)
        `).run(
          crypto.randomUUID(),
          orgId,
          actor.id,
          JSON.stringify({
            loanId,
            memberId: loan.member_id,
            memberName: loan.member_name,
            amount: loan.amount,
            action: 'DELETED',
            deletedByName: actor.fullName,
            deletedByRole: actor.role,
          }),
          ipAddress
        );
      }

      db.exec('COMMIT;');

      return {
        id: loanId,
        action: actionTaken,
        message,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}
