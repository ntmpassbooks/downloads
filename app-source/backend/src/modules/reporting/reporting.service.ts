import { getDatabase } from '../../db/connection.js';

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
   * Helper to safely escape CSV values according to RFC 4180.
   */
  private static escapeCsvValue(val: any): string {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  }

  /**
   * Retrieves an authoritative, read-only monthly financial statement for a given mandal.
   * Calculations are derived purely from confirmed records in financial_transactions.
   */
  public static getMonthlyStatement(orgId: string, monthYear: string): MonthlyStatementResponse {
    const db = getDatabase();

    // 1. Calculate Opening Balance from all confirmed transactions strictly prior to the selected month
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

    // 2. Calculate Current Month breakdown
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

    // 3. Fetch detailed list of transactions for the month with member and actor details
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
      paymentMethod: r.payment_method,
      transactionDate: r.transaction_date,
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
      inflows: {
        bishiCollection,
        loanRepayments,
        totalInflow,
      },
      outflows: {
        loanDisbursements,
        expenses,
        totalOutflow,
      },
      netMovement,
      closingBalance,
      transactionCount,
      transactions,
    };
  }

  /**
   * Generates a clean, read-only CSV audit export from authoritative transactions.
   * Prepends UTF-8 BOM so Marathi characters render properly in spreadsheet software.
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

    // CSV Header row in Marathi
    const headers = [
      'व्यवहार क्र. (Transaction No)',
      'दिनांक (Date)',
      'व्यवहाराचा प्रकार (Type)',
      'रक्कम (Amount ₹)',
      'देयक पद्धत (Method)',
      'संबंधित सदस्य (Member Name)',
      'सदस्य मोबाईल (Phone)',
      'नोंदणीकर्ता (Recorded By)',
      'नोंदणीकर्ता पद (Role)',
      'संदर्भ / महिना (Reference/Month)',
      'नोंद (Notes)',
      'स्थिती (Status)',
      'व्यवहार आयडी (UUID)',
    ];

    const lines: string[] = [];
    // UTF-8 BOM (\uFEFF)
    lines.push('\uFEFF' + headers.map((h) => this.escapeCsvValue(h)).join(','));

    for (const r of rows) {
      const rowData = [
        r.transaction_number,
        r.transaction_date,
        this.mapTransactionTypeMarathi(r.transaction_type),
        r.amount,
        r.payment_method,
        r.member_name || (r.transaction_type === 'EXPENSE' ? 'मंडळ खर्च' : '-'),
        r.member_phone || '-',
        r.actor_name || 'प्रशासक',
        r.actor_role || '-',
        r.bishi_month || r.reference_id || '-',
        r.notes || '-',
        r.status === 'CONFIRMED' ? 'पुष्टी (CONFIRMED)' : r.status,
        r.id,
      ];
      lines.push(rowData.map((val) => this.escapeCsvValue(val)).join(','));
    }

    return lines.join('\r\n');
  }
}
