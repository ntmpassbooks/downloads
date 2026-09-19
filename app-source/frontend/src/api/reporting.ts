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

export async function downloadAuditCsv(monthYear?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const token = localStorage.getItem('ntm_token') || sessionStorage.getItem('ntm_token');
    const query = monthYear ? `?monthYear=${encodeURIComponent(monthYear)}` : '';
    const res = await fetch(getApiUrl(`/reports/export-audit${query}`), {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errJson.error || 'ऑडिट फाईल डाऊनलोड करता आली नाही (Failed to download audit CSV)',
      };
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = monthYear ? `ntm_audit_ledger_${monthYear}.csv` : 'ntm_audit_ledger_all.csv';
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
