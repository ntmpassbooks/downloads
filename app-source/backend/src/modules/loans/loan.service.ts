import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser, ROLES } from '../../types/roles.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CreateLoanInput, CalculateLoanPreviewInput } from './loan.validation.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  LoanCalculator,
  InterestType,
  RatePeriod,
  LoanCalculationResult,
} from './loan-calculator.js';

export interface LoanInstallment {
  id: string;
  organizationId: string;
  loanId: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  paidAmount: number;
  paidDate: string | null;
  status: 'UPCOMING' | 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
  createdAt: string;
  updatedAt: string;
}

export interface LoanRepayment {
  id: string;
  organizationId: string;
  loanId: string;
  memberId: string;
  actorId: string;
  actorName?: string;
  amount: number;
  principalPaid: number;
  interestPaid: number;
  paymentMethod: 'CASH' | 'ONLINE';
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
  amount: number; // Principal
  loanDate: string;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  interestRate: number;
  interestType: InterestType;
  ratePeriod: RatePeriod;
  tenureMonths: number;
  monthlyInstallment: number;
  totalInterest: number;
  totalPayable: number;
  firstDueDate: string | null;
  notes: string | null;
  disbursementTransactionId: string | null;
  disbursementTransactionNumber?: string;
  totalRepaid: number;
  outstandingBalance: number;
  createdAt: string;
  updatedAt: string;
  repayments?: LoanRepayment[];
  installments?: LoanInstallment[];
}

export class LoanService {
  /**
   * Calculates a real-time preview of loan installments, EMI, total interest, and schedule.
   */
  public static calculatePreview(input: CalculateLoanPreviewInput): LoanCalculationResult {
    return LoanCalculator.calculateSchedule({
      principal: input.principal,
      interestRate: input.interestRate,
      interestType: input.interestType,
      ratePeriod: input.ratePeriod,
      tenureMonths: input.tenureMonths,
      firstDueDate: input.firstDueDate,
    });
  }

  /**
   * President or Treasurer loan creation and disbursement.
   * Atomically creates loan record, loan_installments schedule, LOAN_DISBURSED ledger transaction, and audit log.
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

    // Self-approval safeguard: An officer cannot disburse a loan to themselves
    if (member.id === actor.id) {
      throw new AppError(
        'अधिकारी स्वतःच्या खात्यावर कर्ज मंजूर करू शकत नाही. दुसऱ्या अधिकाऱ्याची (अध्यक्ष/खजिनदार) मंजुरी आवश्यक आहे. (Self-loan approval not allowed)',
        403
      );
    }

    // 3. Compute loan schedule
    const schedule = LoanCalculator.calculateSchedule({
      principal: input.amount,
      interestRate: input.interestRate ?? 0,
      interestType: input.interestType ?? 'FLAT',
      ratePeriod: input.ratePeriod ?? 'ANNUAL',
      tenureMonths: input.tenureMonths ?? 1,
      firstDueDate: input.firstDueDate,
    });

    const loanId = crypto.randomUUID();
    const txnId = crypto.randomUUID();
    const txnNumber = LedgerService.generateTransactionNumber();
    const loanDate = input.loanDate || new Date().toISOString();
    const todayStr = new Date().toISOString().slice(0, 10);

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
          loan_date, status, interest_rate, interest_type, rate_period,
          tenure_months, monthly_installment, total_interest, total_payable,
          first_due_date, notes, disbursement_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        loanId,
        orgId,
        member.id,
        actor.id,
        input.amount,
        loanDate,
        schedule.interestRate,
        schedule.interestType,
        schedule.ratePeriod,
        schedule.tenureMonths,
        schedule.monthlyInstallment,
        schedule.totalInterest,
        schedule.totalPayable,
        schedule.firstDueDate,
        input.notes || null,
        txnId
      );

      // Step C: Create loan_installments records
      const insertInstallmentStmt = db.prepare(`
        INSERT INTO loan_installments (
          id, organization_id, loan_id, installment_number, due_date,
          principal_amount, interest_amount, total_amount, paid_amount,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `);

      for (const inst of schedule.installments) {
        const instId = crypto.randomUUID();
        const initialStatus = inst.dueDate <= todayStr ? 'DUE' : 'UPCOMING';
        insertInstallmentStmt.run(
          instId,
          orgId,
          loanId,
          inst.installmentNumber,
          inst.dueDate,
          inst.principalAmount,
          inst.interestAmount,
          inst.totalAmount,
          initialStatus
        );
      }

      // Step D: Audit log
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
          principal: input.amount,
          interestRate: schedule.interestRate,
          interestType: schedule.interestType,
          ratePeriod: schedule.ratePeriod,
          tenureMonths: schedule.tenureMonths,
          monthlyInstallment: schedule.monthlyInstallment,
          totalInterest: schedule.totalInterest,
          totalPayable: schedule.totalPayable,
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
        message: `आपल्या खात्यावर ₹${input.amount} चे कर्ज मंजूर व वितरित झाले आहे. एकूण देय: ₹${schedule.totalPayable}. पावती क्र: ${txnNumber}`,
        entityType: 'LOAN',
        entityId: loanId,
        idempotencyKey: `loan-disbursed-${loanId}`,
        data: { loanId, transactionId: txnId, transactionNumber: txnNumber, amount: input.amount, totalPayable: schedule.totalPayable },
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
        interestRate: schedule.interestRate,
        interestType: schedule.interestType,
        ratePeriod: schedule.ratePeriod,
        tenureMonths: schedule.tenureMonths,
        monthlyInstallment: schedule.monthlyInstallment,
        totalInterest: schedule.totalInterest,
        totalPayable: schedule.totalPayable,
        firstDueDate: schedule.firstDueDate,
        notes: input.notes || null,
        disbursementTransactionId: txnId,
        disbursementTransactionNumber: txnNumber,
        totalRepaid: 0,
        outstandingBalance: schedule.totalPayable,
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
   * Allocates repayment amount across unpaid installments chronologically.
   * Cross-officer protection: Self-recording is strictly blocked!
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

    // Self-approval safeguard: Officer cannot record repayment on their own personal loan!
    if (initialLoan.member_id === actor.id) {
      throw new AppError(
        'अधिकारी स्वतःच्या खात्यावरील कर्ज परतफेड स्वतः नोंदवू शकत नाही. दुसऱ्या अधिकाऱ्याची (अध्यक्ष/खजिनदार) नोंद आवश्यक आहे. (Self-recording not allowed: cross-officer confirmation required)',
        403
      );
    }

    if (initialLoan.status === 'CLOSED') {
      throw new AppError('हे कर्ज आधीच पूर्ण भरले गेले आहे (This loan is already fully repaid and closed)', 400);
    }

    if (initialLoan.status === 'CANCELLED') {
      throw new AppError('हे कर्ज रद्द करण्यात आले आहे (This loan is cancelled)', 400);
    }

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
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
      const targetTotal = lockedLoan.total_payable > 0 ? lockedLoan.total_payable : lockedLoan.amount;
      const outstanding = targetTotal - currentRepaid;

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

      // Step A: Allocate repayment amount across unpaid installments
      const installments = db
        .prepare(`
          SELECT * FROM loan_installments
          WHERE loan_id = ? AND organization_id = ? AND status != 'PAID'
          ORDER BY installment_number ASC
        `)
        .all(loanId, orgId) as any[];

      let remainingToAllocate = amount;
      let totalPrincipalPaid = 0;
      let totalInterestPaid = 0;

      const updateInstallmentStmt = db.prepare(`
        UPDATE loan_installments
        SET paid_amount = ?, paid_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      for (const inst of installments) {
        if (remainingToAllocate <= 0) break;

        const unpaidOnInst = inst.total_amount - inst.paid_amount;
        const alloc = Math.min(remainingToAllocate, unpaidOnInst);
        const newInstPaid = inst.paid_amount + alloc;
        remainingToAllocate -= alloc;

        // Split principal and interest proportionally
        const ratio = inst.total_amount > 0 ? alloc / inst.total_amount : 1;
        const pAlloc = Math.round(inst.principal_amount * ratio);
        const iAlloc = alloc - pAlloc;
        totalPrincipalPaid += pAlloc;
        totalInterestPaid += iAlloc;

        const newInstStatus = newInstPaid >= inst.total_amount ? 'PAID' : 'PARTIALLY_PAID';
        const paidDate = newInstStatus === 'PAID' ? repaymentDate : (inst.paid_date || repaymentDate);

        updateInstallmentStmt.run(newInstPaid, paidDate, newInstStatus, inst.id);
      }

      // If no installments existed (e.g. legacy loan), treat full amount as principal
      if (installments.length === 0) {
        totalPrincipalPaid = amount;
        totalInterestPaid = 0;
      }

      // Step B: Insert into loan_repayments
      db.prepare(`
        INSERT INTO loan_repayments (
          id, organization_id, loan_id, member_id, actor_id,
          amount, principal_paid, interest_paid, payment_method, repayment_date, transaction_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CASH', ?, ?, ?)
      `).run(
        repaymentId,
        orgId,
        loanId,
        lockedLoan.member_id,
        actor.id,
        amount,
        totalPrincipalPaid,
        totalInterestPaid,
        repaymentDate,
        txnId,
        notes || null
      );

      // Step C: Insert into financial_transactions
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
      const newOutstanding = targetTotal - newTotalRepaid;
      const newStatus = newOutstanding === 0 ? 'CLOSED' : 'ACTIVE';

      // Step D: Update loan status and timestamp
      db.prepare(`
        UPDATE loans
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newStatus, loanId);

      // Step E: Audit log
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
          principalPaid: totalPrincipalPaid,
          interestPaid: totalInterestPaid,
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
          message: `${lockedLoan.member_name || initialLoan.member_name} यांनी ₹${amount} ची कर्ज परतफेड केली. उर्वरित बाकी: ₹${newOutstanding}.`,
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
        principalPaid: totalPrincipalPaid,
        interestPaid: totalInterestPaid,
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
        interestType: lockedLoan.interest_type || 'FLAT',
        ratePeriod: lockedLoan.rate_period || 'ANNUAL',
        tenureMonths: lockedLoan.tenure_months || 1,
        monthlyInstallment: lockedLoan.monthly_installment || 0,
        totalInterest: lockedLoan.total_interest || 0,
        totalPayable: targetTotal,
        firstDueDate: lockedLoan.first_due_date || null,
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
   * Retrieves installments schedule for a loan.
   */
  public static getLoanInstallments(
    orgId: string,
    loanId: string,
    actor: AuthenticatedUser
  ): LoanInstallment[] {
    const db = getDatabase();

    const loan = db
      .prepare('SELECT id, organization_id, member_id FROM loans WHERE id = ? AND organization_id = ?')
      .get(loanId, orgId) as { id: string; organization_id: string; member_id: string } | undefined;

    if (!loan) {
      throw new AppError('कर्ज नोंद सापडली नाही (Loan record not found)', 404);
    }

    if (actor.role === ROLES.MEMBER && actor.id !== loan.member_id) {
      throw new AppError('तुम्हाला इतर सदस्यांचे हप्ते पाहण्याची परवानगी नाही (Cannot view other member loan schedule)', 403);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(`
        SELECT * FROM loan_installments
        WHERE loan_id = ? AND organization_id = ?
        ORDER BY installment_number ASC
      `)
      .all(loanId, orgId) as any[];

    return rows.map((r) => {
      let status = r.status;
      if (status !== 'PAID' && r.due_date < todayStr && r.paid_amount === 0) {
        status = 'OVERDUE';
      } else if (status !== 'PAID' && r.due_date < todayStr && r.paid_amount > 0) {
        status = 'PARTIALLY_PAID';
      }

      return {
        id: r.id,
        organizationId: r.organization_id,
        loanId: r.loan_id,
        installmentNumber: r.installment_number,
        dueDate: r.due_date,
        principalAmount: r.principal_amount,
        interestAmount: r.interest_amount,
        totalAmount: r.total_amount,
        paidAmount: r.paid_amount,
        paidDate: r.paid_date,
        status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  /**
   * Retrieves loans for a member with dynamic calculation of total repaid and outstanding balance.
   */
  public static getMemberLoans(
    orgId: string,
    memberId: string,
    actor: AuthenticatedUser
  ): Loan[] {
    const db = getDatabase();

    if (actor.role === ROLES.MEMBER && actor.id !== memberId) {
      throw new AppError('तुम्हाला इतर सदस्यांची कर्जे पाहण्याची परवानगी नाही (Cannot view other member loans)', 403);
    }

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
      const targetTotal = row.total_payable > 0 ? row.total_payable : row.amount;
      const outstandingBalance = Math.max(0, targetTotal - totalRepaid);

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
        interestType: row.interest_type || 'FLAT',
        ratePeriod: row.rate_period || 'ANNUAL',
        tenureMonths: row.tenure_months || 1,
        monthlyInstallment: row.monthly_installment || 0,
        totalInterest: row.total_interest || 0,
        totalPayable: targetTotal,
        firstDueDate: row.first_due_date || null,
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
          principalPaid: r.principal_paid || r.amount,
          interestPaid: r.interest_paid || 0,
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
      const targetTotal = row.total_payable > 0 ? row.total_payable : row.amount;
      const outstandingBalance = Math.max(0, targetTotal - totalRepaid);

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
        interestType: row.interest_type || 'FLAT',
        ratePeriod: row.rate_period || 'ANNUAL',
        tenureMonths: row.tenure_months || 1,
        monthlyInstallment: row.monthly_installment || 0,
        totalInterest: row.total_interest || 0,
        totalPayable: targetTotal,
        firstDueDate: row.first_due_date || null,
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
          principalPaid: r.principal_paid || r.amount,
          interestPaid: r.interest_paid || 0,
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
   */
  public static deleteLoan(
    orgId: string,
    loanId: string,
    actor: AuthenticatedUser,
    ipAddress: string
  ): { id: string; action: 'DELETED' | 'CANCELLED'; message: string } {
    const db = getDatabase();

    if (actor.role !== ROLES.PRESIDENT && actor.role !== ROLES.TREASURER) {
      throw new AppError('केवळ अध्यक्ष किंवा खजिनदार कर्ज हटवू किंवा रद्द करू शकतात (President or Treasurer only)', 403);
    }

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

    const repaymentCount = db
      .prepare('SELECT COUNT(*) as count FROM loan_repayments WHERE loan_id = ? AND organization_id = ?')
      .get(loanId, orgId) as { count: number };

    if (repaymentCount.count > 0) {
      throw new AppError(
        'परतफेड असलेले कर्ज हटवता येत नाही. लेजर, पावत्या व आर्थिक इतिहासाचे संरक्षण आवश्यक आहे (Cannot delete loan with existing repayments; financial history must be preserved)',
        400
      );
    }

    const disbursementTxnId = loan.disbursement_transaction_id;

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      let actionTaken: 'DELETED' | 'CANCELLED' = 'DELETED';
      let message = '';

      if (disbursementTxnId) {
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
        db.prepare('DELETE FROM loan_installments WHERE loan_id = ? AND organization_id = ?').run(loanId, orgId);
        db.prepare('DELETE FROM loans WHERE id = ? AND organization_id = ?').run(loanId, orgId);

        actionTaken = 'DELETED';
        message = 'कर्ज नोंद यशस्वीरीत्या हटवली (Loan record deleted successfully)';

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
