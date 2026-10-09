import { apiRequest, getApiUrl } from './client.js';

export interface MonthlyStatementData {
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

export async function getMonthlyStatement(monthYear: string) {
  return apiRequest<MonthlyStatementData>(
    `/reports/monthly-statement?monthYear=${encodeURIComponent(monthYear)}`
  );
}

export async function downloadReportFile(
  endpointPath: string,
  fallbackFilename: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = localStorage.getItem('ntm_token') || sessionStorage.getItem('ntm_token');
    const res = await fetch(getApiUrl(endpointPath), {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errJson.error || 'अहवाल डाऊनलोड करता आला नाही (Download failed)',
      };
    }

    // Extract filename from Content-Disposition header if available
    const disposition = res.headers.get('content-disposition');
    let filename = fallbackFilename;
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'नेटवर्क त्रुटी आली (Network error)',
    };
  }
}

export async function downloadMonthlyStatement(
  monthYear: string,
  format: 'pdf' | 'excel' | 'csv'
): Promise<{ success: boolean; error?: string }> {
  const ext = format === 'excel' ? 'xlsx' : format;
  return downloadReportFile(
    `/reports/monthly-statement/export?format=${format}&monthYear=${encodeURIComponent(monthYear)}`,
    `ntm_monthly_statement_${monthYear}.${ext}`
  );
}

export async function downloadPassbookReport(
  format: 'pdf' | 'excel' | 'csv',
  memberId?: string
): Promise<{ success: boolean; error?: string }> {
  const ext = format === 'excel' ? 'xlsx' : format;
  const q = memberId ? `&memberId=${encodeURIComponent(memberId)}` : '';
  return downloadReportFile(
    `/reports/passbook/export?format=${format}${q}`,
    `ntm_passbook.${ext}`
  );
}

export async function downloadFinancialLedgerReport(
  format: 'pdf' | 'excel' | 'csv',
  monthYear?: string
): Promise<{ success: boolean; error?: string }> {
  const ext = format === 'excel' ? 'xlsx' : format;
  const q = monthYear ? `&monthYear=${encodeURIComponent(monthYear)}` : '';
  return downloadReportFile(
    `/reports/financial-ledger/export?format=${format}${q}`,
    `ntm_ledger.${ext}`
  );
}

export async function downloadLoansReport(
  format: 'pdf' | 'excel' | 'csv'
): Promise<{ success: boolean; error?: string }> {
  const ext = format === 'excel' ? 'xlsx' : format;
  return downloadReportFile(
    `/reports/loans/export?format=${format}`,
    `ntm_loans_register.${ext}`
  );
}

export async function downloadExpensesReport(
  format: 'pdf' | 'excel' | 'csv',
  monthYear?: string
): Promise<{ success: boolean; error?: string }> {
  const ext = format === 'excel' ? 'xlsx' : format;
  const q = monthYear ? `&monthYear=${encodeURIComponent(monthYear)}` : '';
  return downloadReportFile(
    `/reports/expenses/export?format=${format}${q}`,
    `ntm_expenses.${ext}`
  );
}

export async function downloadBishiReport(
  format: 'pdf' | 'excel' | 'csv',
  monthYear?: string
): Promise<{ success: boolean; error?: string }> {
  const ext = format === 'excel' ? 'xlsx' : format;
  const q = monthYear ? `&monthYear=${encodeURIComponent(monthYear)}` : '';
  return downloadReportFile(
    `/reports/bishi/export?format=${format}${q}`,
    `ntm_bishi_report.${ext}`
  );
}

export async function downloadAuditReport(
  format: 'pdf' | 'excel' | 'csv',
  monthYear?: string
): Promise<{ success: boolean; error?: string }> {
  const ext = format === 'excel' ? 'xlsx' : format;
  const q = monthYear ? `&monthYear=${encodeURIComponent(monthYear)}` : '';
  return downloadReportFile(
    `/reports/audit/export?format=${format}${q}`,
    `ntm_audit_ledger.${ext}`
  );
}

/**
 * Download transaction receipt strictly as PDF.
 */
export async function downloadReceiptPdf(
  transactionId: string,
  transactionNumber?: string
): Promise<{ success: boolean; error?: string }> {
  const fallback = transactionNumber ? `ntm_receipt_${transactionNumber}.pdf` : `ntm_receipt_${transactionId}.pdf`;
  return downloadReportFile(`/transactions/${transactionId}/receipt/pdf`, fallback);
}

export async function downloadAuditCsv(monthYear?: string): Promise<{ success: boolean; error?: string }> {
  return downloadAuditReport('csv', monthYear);
}

