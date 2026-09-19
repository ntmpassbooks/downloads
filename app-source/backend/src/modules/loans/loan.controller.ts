import { Request, Response } from 'express';
import { LoanService } from './loan.service.js';
import { CreateLoanInput, RecordLoanRepaymentInput } from './loan.validation.js';

export function createLoanHandler(
  req: Request<{}, {}, CreateLoanInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const loan = LoanService.createLoan(actor.organizationId, req.body, actor, ipAddress);

  res.status(201).json({
    success: true,
    message: 'कर्ज यशस्वीरीत्या मंजूर व वितरित केले गेले (Loan approved and disbursed successfully)',
    data: loan,
  });
}

export function recordCashLoanRepaymentHandler(
  req: Request<{ loanId: string }, {}, RecordLoanRepaymentInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';
  const { loanId } = req.params;
  const { amount, notes } = req.body;

  const result = LoanService.recordCashLoanRepayment(
    actor.organizationId,
    loanId,
    amount,
    actor,
    ipAddress,
    notes
  );

  res.status(200).json({
    success: true,
    message: 'कर्ज परतफेड रोख रक्कम यशस्वीरीत्या नोंदवली गेली (Cash loan repayment recorded successfully)',
    data: result,
  });
}

export function getMemberLoansHandler(
  req: Request<{ memberId: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { memberId } = req.params;

  const loans = LoanService.getMemberLoans(actor.organizationId, memberId, actor);

  res.status(200).json({
    success: true,
    data: loans,
  });
}

export function getMyLoansHandler(req: Request, res: Response): void {
  const actor = req.user!;

  const loans = LoanService.getMemberLoans(actor.organizationId, actor.id, actor);

  res.status(200).json({
    success: true,
    data: loans,
  });
}

export function getMandalLoansHandler(req: Request, res: Response): void {
  const actor = req.user!;

  const loans = LoanService.getMandalLoans(actor.organizationId, actor);

  res.status(200).json({
    success: true,
    data: loans,
  });
}

export function deleteLoanHandler(req: Request<{ loanId: string }>, res: Response): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const result = LoanService.deleteLoan(actor.organizationId, req.params.loanId, actor, ipAddress);

  res.status(200).json({
    success: true,
    message: result.message,
    data: result,
  });
}
