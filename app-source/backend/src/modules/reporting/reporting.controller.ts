import { Request, Response } from 'express';
import { ReportingService } from './reporting.service.js';
import { MonthlyStatementQuery, AuditExportQuery } from './reporting.validation.js';

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
