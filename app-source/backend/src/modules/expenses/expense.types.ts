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
  actorId: string;
  actorName?: string;
  actorRole?: string;
  amount: number;
  category: ExpenseCategory;
  expenseDate: string;
  reason: string;
  status: 'CONFIRMED' | 'CANCELLED';
  transactionId: string | null;
  transactionNumber?: string;
  notes: string | null;
  receiptUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpenseInput {
  amount: number;
  category: ExpenseCategory;
  reason: string;
  expenseDate?: string;
  notes?: string;
}

export interface ExpenseListResponse {
  summary: {
    totalExpenses: number;
    totalTransactions: number;
  };
  expenses: Expense[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
