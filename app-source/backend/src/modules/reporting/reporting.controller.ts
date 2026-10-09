import { Request, Response, NextFunction } from 'express';
import { ReportingService, ExportResult } from './reporting.service.js';
import {
  MonthlyStatementQuery,
  AuditExportQuery,
  ExportReportQuery,
} from './reporting.validation.js';
import { AppError } from '../../middleware/errorHandler.js';

function sendExportResponse(res: Response, result: ExportResult): void {
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.status(200).send(result.buffer);
}

export function getMonthlyStatementHandler(
  req: Request<{}, {}, {}, MonthlyStatementQuery>,
  res: Response
): void {
  const actor = req.user!;
  const { monthYear } = req.query;

  const statement = ReportingService.getMonthlyStatement(actor.organizationId, monthYear);

  res.status(200).json({
    success: true,
    data: statement,
  });
}

export function exportAuditCsvHandler(
  req: Request<{}, {}, {}, AuditExportQuery>,
  res: Response
): void {
  const actor = req.user!;
  const { monthYear } = req.query;

  const csvContent = ReportingService.exportAuditCsv(actor.organizationId, monthYear);
  const filename = monthYear ? `ntm_audit_ledger_${monthYear}.csv` : `ntm_audit_ledger_all.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csvContent);
}

export async function exportMonthlyStatementHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';
    const monthYear = req.query.monthYear || new Date().toISOString().slice(0, 7);

    const result = await ReportingService.exportMonthlyStatement(
      actor.organizationId,
      monthYear,
      format
    );

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

export async function exportPassbookHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';
    const memberId = req.query.memberId || actor.id;

    const result = await ReportingService.exportPassbook(
      actor.organizationId,
      memberId,
      actor,
      format
    );

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

export async function exportFinancialLedgerHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';
    const monthYear = req.query.monthYear;

    const result = await ReportingService.exportFinancialLedger(
      actor.organizationId,
      format,
      monthYear
    );

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

export async function exportLoansHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';

    const result = await ReportingService.exportLoans(actor.organizationId, format);

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

export async function exportExpensesHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';
    const monthYear = req.query.monthYear;

    const result = await ReportingService.exportExpenses(
      actor.organizationId,
      format,
      monthYear
    );

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

export async function exportVarganiHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';

    const result = await ReportingService.exportVargani(actor.organizationId, format);

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

export async function exportMembersHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';

    const result = await ReportingService.exportMembers(actor.organizationId, format);

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

export async function exportAuditLogsHandler(
  req: Request<{}, {}, {}, ExportReportQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const format = req.query.format || 'pdf';

    const result = await ReportingService.exportAuditLogs(actor.organizationId, format);

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * Receipt download handler:
 * Receipts must be downloadable ONLY as PDF. (Strictly NO Excel or CSV for receipts).
 */
export async function exportReceiptPdfHandler(
  req: Request<{ transactionId: string }, {}, {}, { format?: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const { transactionId } = req.params;
    const format = req.query.format;

    // Strict policy check: Receipts must be downloadable ONLY as PDF
    if (format && format.toLowerCase() !== 'pdf') {
      throw new AppError(
        'पावती केवळ PDF फॉरमॅटमध्ये उपलब्ध आहे. Excel किंवा CSV फॉरमॅट पावत्यांसाठी समर्थित नाही. (Receipts can only be downloaded as PDF)',
        400
      );
    }

    const result = await ReportingService.exportReceiptPdf(
      actor.organizationId,
      transactionId,
      actor
    );

    sendExportResponse(res, result);
  } catch (err) {
    next(err);
  }
}
