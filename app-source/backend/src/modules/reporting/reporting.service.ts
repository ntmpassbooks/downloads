import { getDatabase } from '../../db/connection.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser, ROLES } from '../../types/roles.js';
import { PdfGeneratorService } from './pdf-generator.service.js';
import { ExcelGeneratorService, ExcelColumnDef } from './excel-generator.service.js';
import { CsvGeneratorService, CsvColumnDef } from './csv-generator.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

export interface MonthlyStatementResponse {
  monthYear: string;
  openingBalance: number;
  inflows: {
    bishiCollection: number;
    loanRepayments: number;
    totalInflow: number;
  };
  outflows: {
    loanDisbursements: number;
    expenses: number;
    totalOutflow: number;
  };
  netMovement: number;
  closingBalance: number;
  transactionCount: number;
  transactions: Array<{
    id: string;
    transactionNumber: string;
    transactionType: string;
    transactionTypeMarathi: string;
    amount: number;
    paymentMethod: string;
    transactionDate: string;
    status: string;
    memberId: string | null;
    memberName: string | null;
    memberPhone: string | null;
    actorId: string;
    actorName: string;
    notes: string | null;
    referenceId: string | null;
    bishiMonth: string | null;
    createdAt: string;
  }>;
}

export interface ExportResult {
  filename: string;
  buffer: Buffer;
  contentType: string;
}

export class ReportingService {
  /**
   * Helper to map transaction type to standard Marathi terminology.
   */
  public static mapTransactionTypeMarathi(type: string): string {
    switch (type) {
      case 'BISHI_PAYMENT':
        return 'मासिक बीसी जमा';
      case 'LOAN_DISBURSED':
        return 'कर्ज वितरण';
      case 'LOAN_REPAYMENT':
        return 'कर्ज परतफेड';
      case 'EXPENSE':
        return 'मंडळ खर्च';
      default:
        return type;
    }
  }

  /**
   * Helper to retrieve organization details.
   */
  private static getOrgDetails(orgId: string): { name: string; code: string; registrationNumber: string | null } {
    const db = getDatabase();
    const row = db
      .prepare('SELECT name, code, registration_number FROM organizations WHERE id = ?')
      .get(orgId) as any;

    if (!row) {
      throw new AppError('मंडळ सापडले नाही (Organization not found)', 404);
    }

    return {
      name: row.name,
      code: row.code,
      registrationNumber: row.registration_number || null,
    };
  }

  /**
   * Retrieves an authoritative, read-only monthly financial statement for a given mandal.
   */
  public static getMonthlyStatement(orgId: string, monthYear: string): MonthlyStatementResponse {
    const db = getDatabase();

    // 1. Opening Balance prior to selected month
    const openingRow = db
      .prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type IN ('BISHI_PAYMENT', 'LOAN_REPAYMENT') THEN amount ELSE 0 END), 0) as prior_inflow,
          COALESCE(SUM(CASE WHEN transaction_type IN ('LOAN_DISBURSED', 'EXPENSE') THEN amount ELSE 0 END), 0) as prior_outflow
        FROM financial_transactions
        WHERE organization_id = ? AND status = 'CONFIRMED'
          AND substr(transaction_date, 1, 7) < ?
      `)
      .get(orgId, monthYear) as { prior_inflow: number; prior_outflow: number };

    const priorInflow = openingRow?.prior_inflow || 0;
    const priorOutflow = openingRow?.prior_outflow || 0;
    const openingBalance = priorInflow - priorOutflow;

    // 2. Current Month breakdown
    const currentSummaryRow = db
      .prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type = 'BISHI_PAYMENT' THEN amount ELSE 0 END), 0) as bishi_collection,
          COALESCE(SUM(CASE WHEN transaction_type = 'LOAN_REPAYMENT' THEN amount ELSE 0 END), 0) as loan_repayments,
          COALESCE(SUM(CASE WHEN transaction_type = 'LOAN_DISBURSED' THEN amount ELSE 0 END), 0) as loan_disbursements,
          COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount ELSE 0 END), 0) as expenses,
          COUNT(*) as transaction_count
        FROM financial_transactions
        WHERE organization_id = ? AND status = 'CONFIRMED'
          AND substr(transaction_date, 1, 7) = ?
      `)
      .get(orgId, monthYear) as {
        bishi_collection: number;
        loan_repayments: number;
        loan_disbursements: number;
        expenses: number;
        transaction_count: number;
      };

    const bishiCollection = currentSummaryRow?.bishi_collection || 0;
    const loanRepayments = currentSummaryRow?.loan_repayments || 0;
    const totalInflow = bishiCollection + loanRepayments;

    const loanDisbursements = currentSummaryRow?.loan_disbursements || 0;
    const expenses = currentSummaryRow?.expenses || 0;
    const totalOutflow = loanDisbursements + expenses;

    const netMovement = totalInflow - totalOutflow;
    const closingBalance = openingBalance + netMovement;
    const transactionCount = currentSummaryRow?.transaction_count || 0;

    // 3. Detailed list of transactions
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
          AND substr(t.transaction_date, 1, 7) = ?
        ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
      `)
      .all(orgId, monthYear) as any[];

    const transactions = rows.map((r) => ({
      id: r.id,
      transactionNumber: r.transaction_number,
      transactionType: r.transaction_type,
      transactionTypeMarathi: this.mapTransactionTypeMarathi(r.transaction_type),
      amount: r.amount,
      paymentMethod: r.payment_method === 'CASH' ? 'रोख' : 'ऑनलाइन UPI',
      transactionDate: r.transaction_date.slice(0, 10),
      status: r.status,
      memberId: r.member_id || null,
      memberName: r.member_name || (r.transaction_type === 'EXPENSE' ? 'मंडळ खर्च' : null),
      memberPhone: r.member_phone || null,
      actorId: r.actor_id,
      actorName: r.actor_name || 'प्रशासक',
      notes: r.notes || null,
      referenceId: r.reference_id || null,
      bishiMonth: r.bishi_month || null,
      createdAt: r.created_at,
    }));

    return {
      monthYear,
      openingBalance,
      inflows: { bishiCollection, loanRepayments, totalInflow },
      outflows: { loanDisbursements, expenses, totalOutflow },
      netMovement,
      closingBalance,
      transactionCount,
      transactions,
    };
  }

  /**
   * 1. Export Monthly Statement: PDF, Excel, CSV
   */
  public static async exportMonthlyStatement(
    orgId: string,
    monthYear: string,
    format: 'pdf' | 'excel' | 'csv'
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const statement = this.getMonthlyStatement(orgId, monthYear);

    const filename = `ntm_monthly_statement_${monthYear}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'आरंभी शिल्लक (Opening)', value: `₹${statement.openingBalance.toLocaleString('en-IN')}`, color: '#0284c7' },
        { label: 'एकूण जमा (Inflow)', value: `₹${statement.inflows.totalInflow.toLocaleString('en-IN')}`, color: '#059669' },
        { label: 'एकूण खर्च/वाटप (Outflow)', value: `₹${statement.outflows.totalOutflow.toLocaleString('en-IN')}`, color: '#dc2626' },
        { label: 'निव्वळ फरक (Net)', value: `₹${statement.netMovement.toLocaleString('en-IN')}`, color: statement.netMovement >= 0 ? '#059669' : '#dc2626' },
        { label: 'अखेरची शिल्लक (Closing)', value: `₹${statement.closingBalance.toLocaleString('en-IN')}`, color: '#0f172a' },
      ];

      const tableHeaders = ['व्यवहार क्र.', 'दिनांक', 'प्रकार', 'सदस्य नाव', 'पद्धत', 'रक्कम', 'नोंद'];
      const tableRows = statement.transactions.map((t) => [
        t.transactionNumber,
        t.transactionDate,
        t.transactionTypeMarathi,
        t.memberName || '-',
        t.paymentMethod,
        `₹${t.amount.toLocaleString('en-IN')}`,
        t.notes || '-',
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: 'मासिक वित्तीय विवरण (Monthly Statement)',
        periodLabel: monthYear,
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        rightAlignCols: [5],
        centerAlignCols: [1, 4],
        footerNote: 'हा अहवाल NTM Passbook अधिकृत आर्थिक लेजरवरून तयार केला आहे.',
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'व्यवहार क्र.', key: 'transactionNumber', width: 22 },
        { header: 'दिनांक', key: 'transactionDate', width: 14, align: 'center' },
        { header: 'व्यवहार प्रकार', key: 'transactionTypeMarathi', width: 18 },
        { header: 'सदस्य नाव', key: 'memberName', width: 24 },
        { header: 'मोबाईल', key: 'memberPhone', width: 14 },
        { header: 'देयक पद्धत', key: 'paymentMethod', width: 14, align: 'center' },
        { header: 'रक्कम (₹)', key: 'amount', width: 16, isCurrency: true },
        { header: 'नोंदणीकर्ता', key: 'actorName', width: 18 },
        { header: 'नोंद', key: 'notes', width: 26 },
      ];

      const data = statement.transactions.map((t) => ({
        transactionNumber: t.transactionNumber,
        transactionDate: t.transactionDate,
        transactionTypeMarathi: t.transactionTypeMarathi,
        memberName: t.memberName || '-',
        memberPhone: t.memberPhone || '-',
        paymentMethod: t.paymentMethod,
        amount: t.amount,
        actorName: t.actorName,
        notes: t.notes || '-',
      }));

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: `विवरण ${monthYear}`,
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: 'मासिक वित्तीय विवरण',
        periodLabel: monthYear,
        columns,
        data,
        summaryTotals: [{ labelKey: 'transactionTypeMarathi', sumKeys: ['amount'] }],
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    // CSV format
    const columns: CsvColumnDef[] = [
      { header: 'व्यवहार क्र.', key: 'transactionNumber' },
      { header: 'दिनांक', key: 'transactionDate' },
      { header: 'व्यवहार प्रकार', key: 'transactionTypeMarathi' },
      { header: 'सदस्य नाव', key: 'memberName' },
      { header: 'मोबाईल', key: 'memberPhone' },
      { header: 'देयक पद्धत', key: 'paymentMethod' },
      { header: 'रक्कम (₹)', key: 'amount' },
      { header: 'नोंदणीकर्ता', key: 'actorName' },
      { header: 'नोंद', key: 'notes' },
    ];

    const data = statement.transactions.map((t) => ({
      transactionNumber: t.transactionNumber,
      transactionDate: t.transactionDate,
      transactionTypeMarathi: t.transactionTypeMarathi,
      memberName: t.memberName || '-',
      memberPhone: t.memberPhone || '-',
      paymentMethod: t.paymentMethod,
      amount: t.amount,
      actorName: t.actorName,
      notes: t.notes || '-',
    }));

    const csvStr = CsvGeneratorService.generateCsv({ columns, data });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 2. Export Passbook: PDF, Excel, CSV
   */
  public static async exportPassbook(
    orgId: string,
    memberId: string | null | undefined,
    actor: AuthenticatedUser,
    format: 'pdf' | 'excel' | 'csv'
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const targetMemberId = memberId || actor.id;

    // IDOR check: Regular member can view only own passbook
    if (actor.role === ROLES.MEMBER && targetMemberId !== actor.id) {
      throw new AppError('तुम्हाला इतर सदस्यांचे पासबुक पाहण्याची परवानगी नाही', 403);
    }

    const passbook = LedgerService.getMemberPassbook(orgId, targetMemberId);
    const filename = `ntm_passbook_${passbook.member.fullName.replace(/\s+/g, '_')}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'एकूण जमा (Total Paid)', value: `₹${passbook.totalPaid.toLocaleString('en-IN')}`, color: '#059669' },
        { label: 'एकूण व्यवहार (Txn Count)', value: `${passbook.totalTransactions}`, color: '#0284c7' },
      ];

      const tableHeaders = ['व्यवहार क्र.', 'दिनांक', 'प्रकार', 'देयक पद्धत', 'रक्कम', 'नोंद'];
      const tableRows = passbook.transactions.map((t) => [
        t.transactionNumber,
        t.transactionDate.slice(0, 10),
        this.mapTransactionTypeMarathi(t.transactionType),
        t.paymentMethod === 'CASH' ? 'रोख' : 'ऑनलाइन',
        `₹${t.amount.toLocaleString('en-IN')}`,
        t.notes || '-',
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: `सदस्य पासबुक — ${passbook.member.fullName}`,
        subtitle: `मोबाईल: ${passbook.member.phone}`,
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        rightAlignCols: [4],
        centerAlignCols: [1, 3],
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'व्यवहार क्र.', key: 'transactionNumber', width: 22 },
        { header: 'दिनांक', key: 'transactionDate', width: 14, align: 'center' },
        { header: 'प्रकार', key: 'transactionType', width: 18 },
        { header: 'पद्धत', key: 'paymentMethod', width: 14, align: 'center' },
        { header: 'रक्कम (₹)', key: 'amount', width: 16, isCurrency: true },
        { header: 'नोंद', key: 'notes', width: 26 },
      ];

      const data = passbook.transactions.map((t) => ({
        transactionNumber: t.transactionNumber,
        transactionDate: t.transactionDate.slice(0, 10),
        transactionType: this.mapTransactionTypeMarathi(t.transactionType),
        paymentMethod: t.paymentMethod,
        amount: t.amount,
        notes: t.notes || '-',
      }));

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: 'पासबुक',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: `सदस्य पासबुक — ${passbook.member.fullName} (${passbook.member.phone})`,
        columns,
        data,
        summaryTotals: [{ labelKey: 'transactionType', sumKeys: ['amount'] }],
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    const columns: CsvColumnDef[] = [
      { header: 'व्यवहार क्र.', key: 'transactionNumber' },
      { header: 'दिनांक', key: 'transactionDate' },
      { header: 'प्रकार', key: 'transactionType' },
      { header: 'पद्धत', key: 'paymentMethod' },
      { header: 'रक्कम (₹)', key: 'amount' },
      { header: 'नोंद', key: 'notes' },
    ];

    const data = passbook.transactions.map((t) => ({
      transactionNumber: t.transactionNumber,
      transactionDate: t.transactionDate.slice(0, 10),
      transactionType: this.mapTransactionTypeMarathi(t.transactionType),
      paymentMethod: t.paymentMethod,
      amount: t.amount,
      notes: t.notes || '-',
    }));

    const csvStr = CsvGeneratorService.generateCsv({ columns, data });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 3. Export Financial Ledger: PDF, Excel, CSV
   */
  public static async exportFinancialLedger(
    orgId: string,
    format: 'pdf' | 'excel' | 'csv',
    monthYear?: string
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const db = getDatabase();

    let query = `
      SELECT t.*, m.full_name as member_name, m.phone as member_phone, a.full_name as actor_name
      FROM financial_transactions t
      LEFT JOIN users m ON t.member_id = m.id
      LEFT JOIN users a ON t.actor_id = a.id
      WHERE t.organization_id = ? AND t.status = 'CONFIRMED'
    `;
    const params: any[] = [orgId];
    if (monthYear) {
      query += ` AND substr(t.transaction_date, 1, 7) = ?`;
      params.push(monthYear);
    }
    query += ` ORDER BY t.transaction_date DESC, t.created_at DESC`;

    const rows = db.prepare(query).all(...params) as any[];

    const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
    const filename = `ntm_financial_ledger_${monthYear || 'all'}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'एकूण व्यवहार (Total Txns)', value: `${rows.length}`, color: '#0284c7' },
        { label: 'एकूण उलाढाल (Turnover)', value: `₹${totalAmount.toLocaleString('en-IN')}`, color: '#059669' },
      ];

      const tableHeaders = ['व्यवहार क्र.', 'दिनांक', 'प्रकार', 'सदस्य', 'पद्धत', 'रक्कम', 'नोंदणीकर्ता'];
      const tableRows = rows.map((r) => [
        r.transaction_number,
        r.transaction_date.slice(0, 10),
        this.mapTransactionTypeMarathi(r.transaction_type),
        r.member_name || (r.transaction_type === 'EXPENSE' ? 'मंडळ खर्च' : '-'),
        r.payment_method === 'CASH' ? 'रोख' : 'ऑनलाइन',
        `₹${r.amount.toLocaleString('en-IN')}`,
        r.actor_name || 'प्रशासक',
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: 'अधिकृत आर्थिक लेजर नोंदवही (Financial Ledger)',
        periodLabel: monthYear || 'सर्व व्यवहार',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        rightAlignCols: [5],
        centerAlignCols: [1, 4],
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'व्यवहार क्र.', key: 'transactionNumber', width: 22 },
        { header: 'दिनांक', key: 'transactionDate', width: 14, align: 'center' },
        { header: 'प्रकार', key: 'transactionType', width: 18 },
        { header: 'सदस्य', key: 'memberName', width: 24 },
        { header: 'मोबाईल', key: 'memberPhone', width: 14 },
        { header: 'पद्धत', key: 'paymentMethod', width: 14, align: 'center' },
        { header: 'रक्कम (₹)', key: 'amount', width: 16, isCurrency: true },
        { header: 'नोंदणीकर्ता', key: 'actorName', width: 18 },
        { header: 'नोंद', key: 'notes', width: 26 },
      ];

      const data = rows.map((r) => ({
        transactionNumber: r.transaction_number,
        transactionDate: r.transaction_date.slice(0, 10),
        transactionType: this.mapTransactionTypeMarathi(r.transaction_type),
        memberName: r.member_name || (r.transaction_type === 'EXPENSE' ? 'मंडळ खर्च' : '-'),
        memberPhone: r.member_phone || '-',
        paymentMethod: r.payment_method,
        amount: r.amount,
        actorName: r.actor_name,
        notes: r.notes || '-',
      }));

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: 'आर्थिक लेजर',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: 'अधिकृत आर्थिक लेजर नोंदवही',
        periodLabel: monthYear || 'सर्व व्यवहार',
        columns,
        data,
        summaryTotals: [{ labelKey: 'transactionType', sumKeys: ['amount'] }],
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    const columns: CsvColumnDef[] = [
      { header: 'व्यवहार क्र.', key: 'transactionNumber' },
      { header: 'दिनांक', key: 'transactionDate' },
      { header: 'प्रकार', key: 'transactionType' },
      { header: 'सदस्य', key: 'memberName' },
      { header: 'मोबाईल', key: 'memberPhone' },
      { header: 'पद्धत', key: 'paymentMethod' },
      { header: 'रक्कम (₹)', key: 'amount' },
      { header: 'नोंदणीकर्ता', key: 'actorName' },
      { header: 'नोंद', key: 'notes' },
    ];

    const data = rows.map((r) => ({
      transactionNumber: r.transaction_number,
      transactionDate: r.transaction_date.slice(0, 10),
      transactionType: this.mapTransactionTypeMarathi(r.transaction_type),
      memberName: r.member_name || (r.transaction_type === 'EXPENSE' ? 'मंडळ खर्च' : '-'),
      memberPhone: r.member_phone || '-',
      paymentMethod: r.payment_method,
      amount: r.amount,
      actorName: r.actor_name,
      notes: r.notes || '-',
    }));

    const csvStr = CsvGeneratorService.generateCsv({ columns, data });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 4. Export Loans Register: PDF, Excel, CSV
   */
  public static async exportLoans(
    orgId: string,
    format: 'pdf' | 'excel' | 'csv'
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const db = getDatabase();

    const loans = db.prepare(`
      SELECT l.*, m.full_name as member_name, m.phone as member_phone, a.full_name as actor_name
      FROM loans l
      INNER JOIN users m ON l.member_id = m.id
      LEFT JOIN users a ON l.actor_id = a.id
      WHERE l.organization_id = ?
      ORDER BY l.loan_date DESC, l.created_at DESC
    `).all(orgId) as any[];

    // Calculate repaid and outstanding for each
    const mapped = loans.map((l) => {
      const sumRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total_repaid
        FROM financial_transactions
        WHERE organization_id = ? AND transaction_type = 'LOAN_REPAYMENT'
          AND reference_id IN (SELECT id FROM loan_repayments WHERE loan_id = ?)
          AND status = 'CONFIRMED'
      `).get(orgId, l.id) as any;

      const totalRepaid = sumRow.total_repaid || 0;
      const targetTotal = l.total_payable > 0 ? l.total_payable : l.amount;
      const outstanding = Math.max(0, targetTotal - totalRepaid);

      return {
        id: l.id,
        memberName: l.member_name,
        memberPhone: l.member_phone,
        principal: l.amount,
        interestRate: `${l.interest_rate}% ${l.rate_period === 'MONTHLY' ? 'मासिक' : 'वार्षिक'}`,
        tenure: `${l.tenure_months || 1} महिने`,
        monthlyInstallment: l.monthly_installment || 0,
        totalPayable: targetTotal,
        totalRepaid,
        outstanding,
        status: l.status === 'ACTIVE' ? 'सक्रिय' : l.status === 'CLOSED' ? 'पूर्ण परतफेड' : 'रद्द',
        loanDate: l.loan_date.slice(0, 10),
      };
    });

    const totalPrincipal = mapped.reduce((s, m) => s + m.principal, 0);
    const totalOutstanding = mapped.reduce((s, m) => s + m.outstanding, 0);
    const filename = `ntm_loans_register_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'एकूण वाटप मुद्दल (Principal)', value: `₹${totalPrincipal.toLocaleString('en-IN')}`, color: '#0284c7' },
        { label: 'एकूण थकीत बाकी (Outstanding)', value: `₹${totalOutstanding.toLocaleString('en-IN')}`, color: '#dc2626' },
        { label: 'एकूण कर्जे (Loan Count)', value: `${mapped.length}`, color: '#0f172a' },
      ];

      const tableHeaders = ['सदस्य नाव', 'दिनांक', 'मुद्दल (₹)', 'व्याज / कालावधी', 'हप्ता (EMI)', 'परतफेड (₹)', 'शिल्लक (₹)', 'स्थिती'];
      const tableRows = mapped.map((m) => [
        m.memberName,
        m.loanDate,
        `₹${m.principal.toLocaleString('en-IN')}`,
        `${m.interestRate} (${m.tenure})`,
        `₹${m.monthlyInstallment.toLocaleString('en-IN')}`,
        `₹${m.totalRepaid.toLocaleString('en-IN')}`,
        `₹${m.outstanding.toLocaleString('en-IN')}`,
        m.status,
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: 'कर्ज व उधार नोंदवही (Loans Register)',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        rightAlignCols: [2, 4, 5, 6],
        centerAlignCols: [1, 7],
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'सदस्य नाव', key: 'memberName', width: 22 },
        { header: 'मोबाईल', key: 'memberPhone', width: 14 },
        { header: 'कर्ज दिनांक', key: 'loanDate', width: 14, align: 'center' },
        { header: 'मुद्दल (₹)', key: 'principal', width: 16, isCurrency: true },
        { header: 'व्याज दर', key: 'interestRate', width: 18 },
        { header: 'कालावधी', key: 'tenure', width: 14 },
        { header: 'मासिक हप्ता (₹)', key: 'monthlyInstallment', width: 16, isCurrency: true },
        { header: 'एकूण देय (₹)', key: 'totalPayable', width: 16, isCurrency: true },
        { header: 'भरलेली रक्कम (₹)', key: 'totalRepaid', width: 16, isCurrency: true },
        { header: 'शिल्लक बाकी (₹)', key: 'outstanding', width: 16, isCurrency: true },
        { header: 'स्थिती', key: 'status', width: 14, align: 'center' },
      ];

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: 'कर्ज नोंदवही',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: 'कर्ज व उधार नोंदवही',
        columns,
        data: mapped,
        summaryTotals: [{ labelKey: 'memberName', sumKeys: ['principal', 'totalPayable', 'totalRepaid', 'outstanding'] }],
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    const columns: CsvColumnDef[] = [
      { header: 'सदस्य नाव', key: 'memberName' },
      { header: 'मोबाईल', key: 'memberPhone' },
      { header: 'कर्ज दिनांक', key: 'loanDate' },
      { header: 'मुद्दल (₹)', key: 'principal' },
      { header: 'व्याज दर', key: 'interestRate' },
      { header: 'कालावधी', key: 'tenure' },
      { header: 'मासिक हप्ता (₹)', key: 'monthlyInstallment' },
      { header: 'एकूण देय (₹)', key: 'totalPayable' },
      { header: 'भरलेली रक्कम (₹)', key: 'totalRepaid' },
      { header: 'शिल्लक बाकी (₹)', key: 'outstanding' },
      { header: 'स्थिती', key: 'status' },
    ];

    const csvStr = CsvGeneratorService.generateCsv({ columns, data: mapped });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 5. Export Expenses Register: PDF, Excel, CSV
   */
  public static async exportExpenses(
    orgId: string,
    format: 'pdf' | 'excel' | 'csv',
    monthYear?: string
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const db = getDatabase();

    let query = `
      SELECT e.*, a.full_name as actor_name
      FROM expenses e
      LEFT JOIN users a ON e.actor_id = a.id
      WHERE e.organization_id = ? AND e.status = 'CONFIRMED'
    `;
    const params: any[] = [orgId];
    if (monthYear) {
      query += ` AND substr(e.expense_date, 1, 7) = ?`;
      params.push(monthYear);
    }
    query += ` ORDER BY e.expense_date DESC, e.created_at DESC`;

    const rows = db.prepare(query).all(...params) as any[];
    const totalExpenses = rows.reduce((s, r) => s + r.amount, 0);
    const filename = `ntm_expenses_${monthYear || 'all'}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'एकूण खर्च (Total Expenses)', value: `₹${totalExpenses.toLocaleString('en-IN')}`, color: '#dc2626' },
        { label: 'नोंद संख्या (Count)', value: `${rows.length}`, color: '#0f172a' },
      ];

      const tableHeaders = ['दिनांक', 'वर्गवारी (Category)', 'कारण (Reason)', 'रक्कम (₹)', 'नोंदणीकर्ता', 'टीप'];
      const tableRows = rows.map((r) => [
        r.expense_date.slice(0, 10),
        r.category,
        r.reason,
        `₹${r.amount.toLocaleString('en-IN')}`,
        r.actor_name || 'प्रशासक',
        r.notes || '-',
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: 'मंडळ खर्च नोंदवही (Expenses Register)',
        periodLabel: monthYear || 'सर्व नोंदी',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        rightAlignCols: [3],
        centerAlignCols: [0],
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'दिनांक', key: 'expenseDate', width: 14, align: 'center' },
        { header: 'वर्गवारी', key: 'category', width: 18 },
        { header: 'कारण', key: 'reason', width: 28 },
        { header: 'रक्कम (₹)', key: 'amount', width: 16, isCurrency: true },
        { header: 'नोंदणीकर्ता', key: 'actorName', width: 18 },
        { header: 'टीप', key: 'notes', width: 24 },
      ];

      const data = rows.map((r) => ({
        expenseDate: r.expense_date.slice(0, 10),
        category: r.category,
        reason: r.reason,
        amount: r.amount,
        actorName: r.actor_name || 'प्रशासक',
        notes: r.notes || '-',
      }));

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: 'खर्च नोंदवही',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: 'मंडळ खर्च नोंदवही',
        periodLabel: monthYear || 'सर्व नोंदी',
        columns,
        data,
        summaryTotals: [{ labelKey: 'reason', sumKeys: ['amount'] }],
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    const columns: CsvColumnDef[] = [
      { header: 'दिनांक', key: 'expenseDate' },
      { header: 'वर्गवारी', key: 'category' },
      { header: 'कारण', key: 'reason' },
      { header: 'रक्कम (₹)', key: 'amount' },
      { header: 'नोंदणीकर्ता', key: 'actorName' },
      { header: 'टीप', key: 'notes' },
    ];

    const data = rows.map((r) => ({
      expenseDate: r.expense_date.slice(0, 10),
      category: r.category,
      reason: r.reason,
      amount: r.amount,
      actorName: r.actor_name || 'प्रशासक',
      notes: r.notes || '-',
    }));

    const csvStr = CsvGeneratorService.generateCsv({ columns, data });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 6. Export Vargani Contributions: PDF, Excel, CSV
   */
  public static async exportVargani(
    orgId: string,
    format: 'pdf' | 'excel' | 'csv'
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const db = getDatabase();

    const rows = db.prepare(`
      SELECT t.*, m.full_name as member_name, a.full_name as actor_name
      FROM financial_transactions t
      LEFT JOIN users m ON t.member_id = m.id
      LEFT JOIN users a ON t.actor_id = a.id
      WHERE t.organization_id = ? AND t.transaction_type = 'BISHI_PAYMENT'
        AND t.reference_id LIKE 'vargani_%' AND t.status = 'CONFIRMED'
      ORDER BY t.transaction_date DESC, t.created_at DESC
    `).all(orgId) as any[];

    const totalVargani = rows.reduce((s, r) => s + r.amount, 0);
    const filename = `ntm_vargani_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'एकूण वर्गणी (Total Vargani)', value: `₹${totalVargani.toLocaleString('en-IN')}`, color: '#059669' },
        { label: 'देणगीदार संख्या (Count)', value: `${rows.length}`, color: '#0f172a' },
      ];

      const tableHeaders = ['व्यवहार क्र.', 'दिनांक', 'देणगीदार / सदस्य', 'रक्कम (₹)', 'पद्धत', 'नोंद'];
      const tableRows = rows.map((r) => [
        r.transaction_number,
        r.transaction_date.slice(0, 10),
        r.member_name || 'इतर देणगीदार',
        `₹${r.amount.toLocaleString('en-IN')}`,
        r.payment_method === 'CASH' ? 'रोख' : 'ऑनलाइन',
        r.notes || '-',
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: 'मंडळ वर्गणी व देणगी नोंदवही (Vargani Register)',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        rightAlignCols: [3],
        centerAlignCols: [1, 4],
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'व्यवहार क्र.', key: 'transactionNumber', width: 22 },
        { header: 'दिनांक', key: 'transactionDate', width: 14, align: 'center' },
        { header: 'देणगीदार / सदस्य', key: 'memberName', width: 24 },
        { header: 'रक्कम (₹)', key: 'amount', width: 16, isCurrency: true },
        { header: 'पद्धत', key: 'paymentMethod', width: 14, align: 'center' },
        { header: 'नोंदणीकर्ता', key: 'actorName', width: 18 },
        { header: 'नोंद', key: 'notes', width: 26 },
      ];

      const data = rows.map((r) => ({
        transactionNumber: r.transaction_number,
        transactionDate: r.transaction_date.slice(0, 10),
        memberName: r.member_name || 'इतर देणगीदार',
        amount: r.amount,
        paymentMethod: r.payment_method,
        actorName: r.actor_name,
        notes: r.notes || '-',
      }));

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: 'वर्गणी नोंदवही',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: 'मंडळ वर्गणी व देणगी नोंदवही',
        columns,
        data,
        summaryTotals: [{ labelKey: 'memberName', sumKeys: ['amount'] }],
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    const columns: CsvColumnDef[] = [
      { header: 'व्यवहार क्र.', key: 'transactionNumber' },
      { header: 'दिनांक', key: 'transactionDate' },
      { header: 'देणगीदार / सदस्य', key: 'memberName' },
      { header: 'रक्कम (₹)', key: 'amount' },
      { header: 'पद्धत', key: 'paymentMethod' },
      { header: 'नोंदणीकर्ता', key: 'actorName' },
      { header: 'नोंद', key: 'notes' },
    ];

    const data = rows.map((r) => ({
      transactionNumber: r.transaction_number,
      transactionDate: r.transaction_date.slice(0, 10),
      memberName: r.member_name || 'इतर देणगीदार',
      amount: r.amount,
      paymentMethod: r.payment_method,
      actorName: r.actor_name,
      notes: r.notes || '-',
    }));

    const csvStr = CsvGeneratorService.generateCsv({ columns, data });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 7. Export Members Register: PDF, Excel, CSV
   */
  public static async exportMembers(
    orgId: string,
    format: 'pdf' | 'excel' | 'csv'
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const db = getDatabase();

    const members = db.prepare(`
      SELECT u.*, c.monthly_amount, c.due_day
      FROM users u
      LEFT JOIN bishi_configs c ON u.id = c.member_id AND c.organization_id = u.organization_id
      WHERE u.organization_id = ?
      ORDER BY u.role DESC, u.full_name ASC
    `).all(orgId) as any[];

    const filename = `ntm_members_list_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'एकूण सदस्य (Total Members)', value: `${members.length}`, color: '#0284c7' },
        { label: 'सक्रिय सदस्य (Active)', value: `${members.filter((m) => m.is_active).length}`, color: '#059669' },
      ];

      const tableHeaders = ['सदस्य नाव', 'मोबाईल क्र.', 'पद / भूमिका', 'मासिक बीसी हप्ता', 'देय दिनांक', 'स्थिती'];
      const tableRows = members.map((m) => [
        m.full_name,
        m.phone,
        m.role === 'PRESIDENT' ? 'अध्यक्ष' : m.role === 'TREASURER' ? 'खजिनदार' : 'सदस्य',
        m.monthly_amount ? `₹${m.monthly_amount.toLocaleString('en-IN')}` : 'रचना नाही',
        m.due_day ? `${m.due_day} तारीख` : '-',
        m.is_active ? 'सक्रिय' : 'निष्क्रिय',
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: 'मंडळ सदस्य नोंदवही (Members Register)',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        rightAlignCols: [3],
        centerAlignCols: [4, 5],
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'सदस्य नाव', key: 'fullName', width: 24 },
        { header: 'मोबाईल क्र.', key: 'phone', width: 16 },
        { header: 'पद / भूमिका', key: 'role', width: 16, align: 'center' },
        { header: 'मासिक बीसी हप्ता (₹)', key: 'monthlyAmount', width: 20, isCurrency: true },
        { header: 'देय दिवस', key: 'dueDay', width: 14, align: 'center' },
        { header: 'स्थिती', key: 'status', width: 14, align: 'center' },
      ];

      const data = members.map((m) => ({
        fullName: m.full_name,
        phone: m.phone,
        role: m.role === 'PRESIDENT' ? 'अध्यक्ष' : m.role === 'TREASURER' ? 'खजिनदार' : 'सदस्य',
        monthlyAmount: m.monthly_amount || 0,
        dueDay: m.due_day ? `${m.due_day}` : '-',
        status: m.is_active ? 'सक्रिय' : 'निष्क्रिय',
      }));

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: 'सदस्य नोंदवही',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: 'मंडळ सदस्य नोंदवही',
        columns,
        data,
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    const columns: CsvColumnDef[] = [
      { header: 'सदस्य नाव', key: 'fullName' },
      { header: 'मोबाईल क्र.', key: 'phone' },
      { header: 'पद / भूमिका', key: 'role' },
      { header: 'मासिक बीसी हप्ता (₹)', key: 'monthlyAmount' },
      { header: 'देय दिवस', key: 'dueDay' },
      { header: 'स्थिती', key: 'status' },
    ];

    const data = members.map((m) => ({
      fullName: m.full_name,
      phone: m.phone,
      role: m.role === 'PRESIDENT' ? 'अध्यक्ष' : m.role === 'TREASURER' ? 'खजिनदार' : 'सदस्य',
      monthlyAmount: m.monthly_amount || 0,
      dueDay: m.due_day ? `${m.due_day}` : '-',
      status: m.is_active ? 'सक्रिय' : 'निष्क्रिय',
    }));

    const csvStr = CsvGeneratorService.generateCsv({ columns, data });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 8. Export Audit Logs: PDF, Excel, CSV
   */
  public static async exportAuditLogs(
    orgId: string,
    format: 'pdf' | 'excel' | 'csv'
  ): Promise<ExportResult> {
    const org = this.getOrgDetails(orgId);
    const db = getDatabase();

    const logs = db.prepare(`
      SELECT a.*, u.full_name as actor_name, u.role as actor_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.organization_id = ?
      ORDER BY a.created_at DESC
      LIMIT 1000
    `).all(orgId) as any[];

    const filename = `ntm_audit_logs_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : format}`;

    if (format === 'pdf') {
      const summaryCards = [
        { label: 'एकूण नोंदवही नोंदी (Audit Logs)', value: `${logs.length}`, color: '#0284c7' },
      ];

      const tableHeaders = ['दिनांक व वेळ', 'कृती (Action)', 'अधिकारी / वापरकर्ता', 'IP पत्ता', 'तपशील'];
      const tableRows = logs.map((l) => [
        l.created_at.slice(0, 19).replace('T', ' '),
        l.action,
        `${l.actor_name || 'प्रणाली'} (${l.actor_role || '-'})`,
        l.ip_address || '-',
        l.details ? l.details.slice(0, 60) : '-',
      ]);

      const buffer = await PdfGeneratorService.generateReportPdf({
        title: 'सुरक्षा व व्यवहार ऑडिट लॉग (Audit Trail)',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        summaryCards,
        tableHeaders,
        tableRows,
        centerAlignCols: [0, 3],
      });

      return { filename, buffer, contentType: 'application/pdf' };
    }

    if (format === 'excel') {
      const columns: ExcelColumnDef[] = [
        { header: 'दिनांक व वेळ', key: 'createdAt', width: 20, align: 'center' },
        { header: 'कृती (Action)', key: 'action', width: 24 },
        { header: 'वापरकर्ता', key: 'actorName', width: 20 },
        { header: 'भूमिका', key: 'actorRole', width: 14, align: 'center' },
        { header: 'IP पत्ता', key: 'ipAddress', width: 16 },
        { header: 'तपशील (Details JSON)', key: 'details', width: 40 },
      ];

      const data = logs.map((l) => ({
        createdAt: l.created_at.slice(0, 19).replace('T', ' '),
        action: l.action,
        actorName: l.actor_name || 'प्रणाली',
        actorRole: l.actor_role || '-',
        ipAddress: l.ip_address || '-',
        details: l.details || '-',
      }));

      const buffer = await ExcelGeneratorService.generateReportWorkbook({
        sheetName: 'ऑडिट लॉग',
        mandalName: org.name,
        mandalCode: org.code,
        mandalRegNo: org.registrationNumber,
        reportTitle: 'सुरक्षा व व्यवहार ऑडिट लॉग नोंदवही',
        columns,
        data,
      });

      return { filename, buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    const columns: CsvColumnDef[] = [
      { header: 'दिनांक व वेळ', key: 'createdAt' },
      { header: 'कृती', key: 'action' },
      { header: 'वापरकर्ता', key: 'actorName' },
      { header: 'भूमिका', key: 'actorRole' },
      { header: 'IP पत्ता', key: 'ipAddress' },
      { header: 'तपशील', key: 'details' },
    ];

    const data = logs.map((l) => ({
      createdAt: l.created_at.slice(0, 19).replace('T', ' '),
      action: l.action,
      actorName: l.actor_name || 'प्रणाली',
      actorRole: l.actor_role || '-',
      ipAddress: l.ip_address || '-',
      details: l.details || '-',
    }));

    const csvStr = CsvGeneratorService.generateCsv({ columns, data });
    return { filename, buffer: Buffer.from(csvStr, 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }

  /**
   * 9. Export Transaction Receipt: PDF ONLY!
   * Receipts must be downloadable ONLY as PDF. (Strictly NO Excel or CSV for receipts).
   */
  public static async exportReceiptPdf(
    orgId: string,
    transactionId: string,
    actor: AuthenticatedUser
  ): Promise<ExportResult> {
    const receipt = LedgerService.getTransactionReceipt(orgId, transactionId, actor);
    const filename = `ntm_receipt_${receipt.receiptNumber}.pdf`;

    const buffer = await PdfGeneratorService.generateReceiptPdf({
      receiptNumber: receipt.receiptNumber,
      transactionNumber: receipt.transactionNumber,
      transactionType: receipt.transactionType,
      transactionTypeMarathi: this.mapTransactionTypeMarathi(receipt.transactionType),
      organization: receipt.organization,
      member: receipt.member,
      amount: receipt.amount,
      paymentMethod: receipt.paymentMethod,
      transactionDate: receipt.transactionDate,
      recordedBy: receipt.recordedBy,
      bishiMonth: receipt.bishiMonth,
      notes: receipt.notes,
    });

    return {
      filename,
      buffer,
      contentType: 'application/pdf',
    };
  }

  /**
   * Backward-compatible audit CSV export
   */
  public static exportAuditCsv(orgId: string, monthYear?: string): string {
    const db = getDatabase();

    let query = `
      SELECT 
        t.*,
        m.full_name as member_name,
        m.phone as member_phone,
        a.full_name as actor_name,
        a.role as actor_role,
        r.month_year as bishi_month
      FROM financial_transactions t
      LEFT JOIN users m ON t.member_id = m.id
      LEFT JOIN users a ON t.actor_id = a.id
      LEFT JOIN bishi_records r ON t.reference_id = r.id
      WHERE t.organization_id = ? AND t.status = 'CONFIRMED'
    `;
    const params: any[] = [orgId];

    if (monthYear) {
      query += ` AND substr(t.transaction_date, 1, 7) = ?`;
      params.push(monthYear);
    }

    query += ` ORDER BY t.transaction_date ASC, t.created_at ASC, t.id ASC`;

    const rows = db.prepare(query).all(...params) as any[];

    const columns: CsvColumnDef[] = [
      { header: 'व्यवहार क्र. (Transaction No)', key: 'transactionNumber' },
      { header: 'दिनांक (Date)', key: 'transactionDate' },
      { header: 'व्यवहाराचा प्रकार (Type)', key: 'typeMarathi' },
      { header: 'रक्कम (Amount ₹)', key: 'amount' },
      { header: 'देयक पद्धत (Method)', key: 'paymentMethod' },
      { header: 'संबंधित सदस्य (Member Name)', key: 'memberName' },
      { header: 'सदस्य मोबाईल (Phone)', key: 'memberPhone' },
      { header: 'नोंदणीकर्ता (Recorded By)', key: 'actorName' },
      { header: 'नोंदणीकर्ता पद (Role)', key: 'actorRole' },
      { header: 'संदर्भ / महिना (Reference/Month)', key: 'reference' },
      { header: 'नोंद (Notes)', key: 'notes' },
      { header: 'स्थिती (Status)', key: 'status' },
      { header: 'व्यवहार आयडी (UUID)', key: 'id' },
    ];

    const data = rows.map((r) => ({
      transactionNumber: r.transaction_number,
      transactionDate: r.transaction_date,
      typeMarathi: this.mapTransactionTypeMarathi(r.transaction_type),
      amount: r.amount,
      paymentMethod: r.payment_method,
      memberName: r.member_name || (r.transaction_type === 'EXPENSE' ? 'मंडळ खर्च' : '-'),
      memberPhone: r.member_phone || '-',
      actorName: r.actor_name || 'प्रशासक',
      actorRole: r.actor_role || '-',
      reference: r.bishi_month || r.reference_id || '-',
      notes: r.notes || '-',
      status: r.status === 'CONFIRMED' ? 'पुष्टी (CONFIRMED)' : r.status,
      id: r.id,
    }));

    return CsvGeneratorService.generateCsv({ columns, data });
  }
}
