import { apiRequest, ApiResponse } from './client.js';

export const EXPENSE_CATEGORIES = [
  'मंडळ कार्यक्रम',
  'साहित्य',
  'प्रवास',
  'कार्यालयीन खर्च',
  'देखभाल',
  'इतर',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  organizationId: string;
  recordedById: string;
  recordedByName?: string;
  transactionId: string;
  transactionNumber?: string;
  amount: number;
  category: ExpenseCategory;
  reason: string;
  expenseDate: string;
  status: 'CONFIRMED' | 'CANCELLED';
  receiptUrl?: string | null;
  createdAt: string;
}

export interface CreateExpenseInput {
  amount: number;
  category: ExpenseCategory;
  reason: string;
  expenseDate?: string;
}

export interface ExpenseListResponse {
  expenses: Expense[];
  summary: {
    totalExpenses: number;
    totalTransactions: number;
  };
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Record a new mandal expense (President & Treasurer only).
 */
export async function createExpense(
  input: CreateExpenseInput
): Promise<ApiResponse<Expense>> {
  return apiRequest('/expenses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Get paginated list of mandal expenses (President & Treasurer only).
 */
export async function getMandalExpenses(params?: {
  page?: number;
  limit?: number;
  category?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ApiResponse<ExpenseListResponse>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', params.page.toString());
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.category) query.set('category', params.category);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);

  const queryString = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/expenses${queryString}`);
}

/**
 * Get expense by ID.
 */
export async function getExpenseById(
  id: string
): Promise<ApiResponse<Expense>> {
  return apiRequest(`/expenses/${id}`);
}

/**
 * Get authorized expense categories.
 */
export async function getExpenseCategories(): Promise<
  ApiResponse<{ categories: readonly string[] }>
> {
  return apiRequest('/expenses/categories');
}

/**
 * Permanently deletes an authorized expense (President only).
 */
export async function deleteExpense(
  id: string
): Promise<ApiResponse<{ id: string; transactionId: string | null; amount: number; message: string }>> {
  return apiRequest(`/expenses/${id}`, {
    method: 'DELETE',
  });
}

