import { apiRequest, ApiResponse } from './client.js';

export interface LoanRepayment {
  id: string;
  organizationId: string;
  loanId: string;
  memberId: string;
  actorId: string;
  actorName?: string;
  amount: number;
  paymentMethod: 'CASH';
  repaymentDate: string;
  transactionId: string | null;
  transactionNumber?: string;
  notes: string | null;
  createdAt: string;
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
  notes: string | null;
  disbursementTransactionId: string | null;
  disbursementTransactionNumber?: string;
  totalRepaid: number;
  outstandingBalance: number;
  createdAt: string;
  updatedAt: string;
  repayments?: LoanRepayment[];
}

export interface CreateLoanInput {
  memberId: string;
  amount: number;
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
