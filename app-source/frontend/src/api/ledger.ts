import { apiRequest, ApiResponse } from './client.js';

export interface FinancialTransaction {
  id: string;
  organizationId: string;
  memberId: string | null;
  memberName?: string;
  actorId: string;
  actorName?: string;
  transactionType: 'BISHI_PAYMENT' | 'LOAN_DISBURSED' | 'LOAN_REPAYMENT' | 'EXPENSE';
  referenceId: string;
  transactionNumber: string;
  amount: number;
  paymentMethod: 'CASH';
  transactionDate: string;
  status: 'CONFIRMED' | 'CANCELLED';
  notes: string | null;
  bishiMonth?: string;
  createdAt: string;
}

export interface MemberPassbookResponse {
  member: {
    id: string;
    fullName: string;
    phone: string;
  };
  totalPaid: number;
  totalTransactions: number;
  transactions: FinancialTransaction[];
}

export interface OrganizationLedgerResponse {
  summary: {
    totalFunds: number;
    totalInflow: number;
    totalOutflow: number;
    totalExpenses: number;
    totalTransactions: number;
  };
  transactions: FinancialTransaction[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Record real cash Bishi payment (President & Treasurer Only).
 */
export async function recordCashBishiPayment(
  bishiRecordId: string,
  amount: number,
  notes?: string
): Promise<ApiResponse<FinancialTransaction>> {
  return apiRequest(`/bishi/${bishiRecordId}/cash-payment`, {
    method: 'POST',
    body: JSON.stringify({ amount, notes }),
  });
}

/**
 * Get authenticated user's own digital passbook.
 */
export async function getMyPassbook(): Promise<ApiResponse<MemberPassbookResponse>> {
  return apiRequest('/passbook/me');
}

/**
 * Get a member's digital passbook (Self, President, or Treasurer).
 */
export async function getMemberPassbook(memberId: string): Promise<ApiResponse<MemberPassbookResponse>> {
  return apiRequest(`/passbook/member/${memberId}`);
}

/**
 * Get mandal-wide financial ledger (President & Treasurer Only).
 */
export async function getOrganizationLedger(
  page = 1,
  limit = 20
): Promise<ApiResponse<OrganizationLedgerResponse>> {
  return apiRequest(`/ledger?page=${page}&limit=${limit}`);
}

export interface TransactionReceipt {
  receiptNumber: string;
  transactionNumber: string;
  transactionId: string;
  transactionType?: 'BISHI_PAYMENT' | 'LOAN_DISBURSED' | 'LOAN_REPAYMENT';
  organization: {
    id: string;
    name: string;
    code: string;
    registrationNumber: string | null;
  };
  member: {
    id: string;
    fullName: string;
    phone: string;
  };
  bishiMonth: string | null;
  amount: number;
  paymentMethod: 'CASH';
  transactionDate: string;
  recordedBy: {
    id: string;
    fullName: string;
    role: string;
  };
  status: 'CONFIRMED';
  notes: string | null;
}

/**
 * Get authentic receipt for a confirmed transaction.
 */
export async function getTransactionReceipt(
  transactionId: string
): Promise<ApiResponse<TransactionReceipt>> {
  return apiRequest(`/transactions/${transactionId}/receipt`);
}

export interface MandalFinancialSummary {
  currentBalance: number;
  totalInflow: number;
  totalVarganiCollected: number;
  pendingVargani: number;
  totalExpenses: number;
  totalLoansDisbursed: number;
  totalLoanRepayments: number;
  outstandingLoans: number;
  totalTransactions: number;
}

export interface RecordVarganiInput {
  memberId?: string;
  bishiRecordId?: string;
  amount: number;
  paymentMethod?: 'CASH';
  notes?: string;
  contributorName?: string;
}

/**
 * Get Mandal-wide financial summary (President & Treasurer Only).
 */
export async function getMandalFinancialSummary(): Promise<ApiResponse<MandalFinancialSummary>> {
  return apiRequest<MandalFinancialSummary>('/ledger/mandal-summary');
}

/**
 * Record a confirmed Vargani / Jama contribution (President & Treasurer Only).
 */
export async function recordVarganiContribution(
  data: RecordVarganiInput
): Promise<ApiResponse<FinancialTransaction>> {
  return apiRequest<FinancialTransaction>('/ledger/contributions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

