import { apiRequest, ApiResponse } from './client.js';

export interface LoanRepayment {
  id: string;
  organizationId: string;
  loanId: string;
  memberId: string;
  actorId: string;
  actorName?: string;
  amount: number;
  principalPaid?: number;
  interestPaid?: number;
  paymentMethod: 'CASH' | 'ONLINE';
  repaymentDate: string;
  transactionId: string | null;
  transactionNumber?: string;
  notes: string | null;
  createdAt: string;
}

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
  status: 'UPCOMING' | 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
  paidAt?: string | null;
}

export interface Loan {
  id: string;
  organizationId: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  actorId: string;
  actorName?: string;
  amount: number;
  loanDate: string;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  interestRate: number;
  interestType?: 'FLAT' | 'REDUCING_BALANCE';
  ratePeriod?: 'MONTHLY' | 'ANNUAL';
  tenureMonths?: number;
  monthlyInstallment?: number;
  totalInterest?: number;
  totalPayable?: number;
  firstDueDate?: string | null;
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

export interface CreateLoanInput {
  memberId: string;
  amount: number;
  interestRate?: number;
  interestType?: 'FLAT' | 'REDUCING_BALANCE';
  ratePeriod?: 'MONTHLY' | 'ANNUAL';
  tenureMonths?: number;
  firstDueDate?: string;
  loanDate?: string;
  notes?: string;
}

export interface RecordLoanRepaymentInput {
  amount: number;
  notes?: string;
}

export interface RecordLoanRepaymentResponse {
  loan: Loan;
  repayment: LoanRepayment;
  transaction: {
    id: string;
    transactionNumber: string;
    amount: number;
    transactionType: string;
    transactionDate: string;
    status: string;
  };
}

export interface CalculateLoanPreviewInput {
  principal: number;
  interestRate: number;
  interestType: 'FLAT' | 'REDUCING_BALANCE';
  ratePeriod: 'MONTHLY' | 'ANNUAL';
  tenureMonths: number;
  firstDueDate?: string;
}

export interface LoanSchedulePreview {
  principal: number;
  interestRate: number;
  interestType: 'FLAT' | 'REDUCING_BALANCE';
  ratePeriod: 'MONTHLY' | 'ANNUAL';
  tenureMonths: number;
  monthlyInstallment: number;
  totalInterest: number;
  totalPayable: number;
  firstDueDate: string;
  installments: Array<{
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    remainingPrincipal: number;
  }>;
}

/**
 * President creates and disburses a real loan.
 */
export async function createLoan(input: CreateLoanInput): Promise<ApiResponse<Loan>> {
  return apiRequest('/loans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Calculate loan preview schedule and EMI terms in real-time.
 */
export async function calculateLoanPreview(
  input: CalculateLoanPreviewInput
): Promise<ApiResponse<LoanSchedulePreview>> {
  return apiRequest('/loans/calculate-preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Fetch installment schedule for a loan.
 */
export async function getLoanInstallments(loanId: string): Promise<ApiResponse<LoanInstallment[]>> {
  return apiRequest(`/loans/${loanId}/installments`);
}

/**
 * Member initiates online loan repayment notice [मी पेमेंट केले].
 */
export async function initiateOnlineLoanRepayment(
  loanId: string,
  amount: number
): Promise<ApiResponse<{
  order: any;
  providerKeyId: string;
  memberName: string;
  accountName: string;
  bank: string;
  upiIntentUrl?: string;
  upiId?: string | null;
  hasQrCode?: boolean;
  qrCodeData?: string | null;
}>> {
  return apiRequest(`/loans/${loanId}/pay-online`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

/**
 * President or Treasurer records cash loan repayment.
 */
export async function recordCashLoanRepayment(
  loanId: string,
  input: RecordLoanRepaymentInput
): Promise<ApiResponse<RecordLoanRepaymentResponse>> {
  return apiRequest(`/loans/${loanId}/repay-cash`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Get all loans for a specific member.
 */
export async function getMemberLoans(memberId: string): Promise<ApiResponse<Loan[]>> {
  return apiRequest(`/loans/member/${memberId}`);
}

/**
 * Get authenticated user's own loans.
 */
export async function getMyLoans(): Promise<ApiResponse<Loan[]>> {
  return apiRequest('/loans/me');
}

/**
 * Get all loans in mandal (President / Treasurer only).
 */
export async function getMandalLoans(): Promise<ApiResponse<Loan[]>> {
  return apiRequest('/loans');
}

/**
 * Safely delete or cancel a loan (President & Treasurer).
 */
export async function deleteLoan(
  loanId: string
): Promise<ApiResponse<{ id: string; action: 'DELETED' | 'CANCELLED'; message: string }>> {
  return apiRequest(`/loans/${loanId}`, {
    method: 'DELETE',
  });
}
