import { Request, Response } from 'express';
import { LedgerService } from './ledger.service.js';
import { RecordCashPaymentInput, RecordVarganiContributionInput } from './ledger.validation.js';
import { ROLES } from '../../types/roles.js';

export function recordCashPaymentHandler(
  req: Request<{ bishiRecordId: string }, {}, RecordCashPaymentInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';
  const { bishiRecordId } = req.params;
  const { amount, notes } = req.body;

  const transaction = LedgerService.recordCashBishiPayment(
    actor.organizationId,
    bishiRecordId,
    amount,
    actor,
    ipAddress,
    notes
  );

  res.status(200).json({
    success: true,
    message: 'रोख बीसी जमा यशस्वीरीत्या नोंदवली गेली (Cash Bishi payment recorded successfully)',
    data: transaction,
  });
}

export function getMyPassbookHandler(req: Request, res: Response): void {
  const actor = req.user!;
  const passbook = LedgerService.getMemberPassbook(actor.organizationId, actor.id);

  res.status(200).json({
    success: true,
    data: passbook,
  });
}

export function getMemberPassbookHandler(
  req: Request<{ memberId: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { memberId } = req.params;

  // Authorization check: President & Treasurer can view any member in their org.
  // Regular Member can ONLY view their own passbook.
  if (actor.role === ROLES.MEMBER && actor.id !== memberId) {
    res.status(403).json({
      success: false,
      error: 'तुम्हाला इतर सदस्यांचे पासबुक पाहण्याची परवानगी नाही (Cannot view other member passbook)',
    });
    return;
  }

  const passbook = LedgerService.getMemberPassbook(actor.organizationId, memberId);

  res.status(200).json({
    success: true,
    data: passbook,
  });
}

export function getOrganizationLedgerHandler(
  req: Request<{}, {}, {}, { page?: string; limit?: string }>,
  res: Response
): void {
  const actor = req.user!;
  const page = parseInt(req.query.page || '1', 10) || 1;
  const limit = parseInt(req.query.limit || '20', 10) || 20;

  const ledger = LedgerService.getOrganizationLedger(actor.organizationId, page, limit);

  res.status(200).json({
    success: true,
    data: ledger,
  });
}

export function getTransactionReceiptHandler(
  req: Request<{ transactionId: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { transactionId } = req.params;

  const receipt = LedgerService.getTransactionReceipt(actor.organizationId, transactionId, actor);

  res.status(200).json({
    success: true,
    data: receipt,
  });
}

export function getMandalFinancialSummaryHandler(req: Request, res: Response): void {
  const actor = req.user!;
  const summary = LedgerService.getMandalFinancialSummary(actor.organizationId);

  res.status(200).json({
    success: true,
    data: summary,
  });
}

export function recordVarganiContributionHandler(
  req: Request<{}, {}, RecordVarganiContributionInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const transaction = LedgerService.recordVarganiContribution(
    actor.organizationId,
    req.body,
    actor,
    ipAddress
  );

  res.status(201).json({
    success: true,
    message: 'वर्गणी / जमा यशस्वीरीत्या नोंदवली गेली (Vargani contribution recorded successfully)',
    data: transaction,
  });
}

