import React, { useState, useRef } from 'react';
import { createExpense, EXPENSE_CATEGORIES, ExpenseCategory } from '../api/expenses.js';
import { strings } from '../i18n/mr.js';
import {
  X,
  Receipt,
  IndianRupee,
  Tag,
  FileText,
  Calendar,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

interface CreateExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseCreated: () => void;
}

export const CreateExpenseModal: React.FC<CreateExpenseModalProps> = ({
  isOpen,
  onClose,
  onExpenseCreated,
}) => {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('मंडळ कार्यक्रम');
  const [reason, setReason] = useState('');
  const [expenseDate, setExpenseDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    setError(null);
    setSuccess(null);

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError(strings.expenses.validationAmount);
      return;
    }

    if (!EXPENSE_CATEGORIES.includes(category)) {
      setError(strings.expenses.validationCategory);
      return;
    }

    if (!reason.trim() || reason.trim().length < 3) {
      setError(strings.expenses.validationReason);
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);

    try {
      const res = await createExpense({
        amount: parsedAmount,
        category,
        reason: reason.trim(),
        expenseDate: expenseDate || undefined,
      });

      if (res.success) {
        setSuccess(strings.expenses.successMessage);
        setAmount('');
        setReason('');
        setTimeout(() => {
          setSuccess(null);
          onExpenseCreated();
          onClose();
        }, 1200);
      } else {
        setError(res.error || res.message || strings.errors.generic);
      }
    } catch {
      setError(strings.errors.networkError);
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-[calc(100%-0.5rem)] sm:max-w-[380px] overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[85dvh]">
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-red-600 to-rose-600 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/20">
              <Receipt className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight">
                {strings.expenses.modalTitle}
              </h3>
              <p className="text-[11px] text-red-100 mt-0.5">
                {strings.expenses.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 text-white/80 hover:text-white transition-colors disabled:opacity-50 cursor-pointer -mr-2"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1">
          {/* Error Alert */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Alert */}
          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Warning Notice */}
          <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-[11px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span className="leading-tight">{strings.expenses.warningNotice}</span>
          </div>

          {/* Expense Amount */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <IndianRupee className="w-3.5 h-3.5 text-red-600" />
              <span>{strings.expenses.amountLabel}</span>
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="उदा. १५००"
              disabled={submitting}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all disabled:opacity-60"
              required
              autoFocus
            />
          </div>

          {/* Category Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-red-600" />
              <span>{strings.expenses.categoryLabel}</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              disabled={submitting}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all disabled:opacity-60"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Expense Reason / Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-red-600" />
              <span>{strings.expenses.reasonLabel}</span>
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={strings.expenses.reasonPlaceholder}
              disabled={submitting}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all resize-none disabled:opacity-60"
              required
            />
          </div>

          {/* Expense Date */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-red-600" />
              <span>{strings.expenses.dateLabel}</span>
            </label>
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              disabled={submitting}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all disabled:opacity-60"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {strings.receipt.closeButton}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 active:scale-[0.98] text-white text-xs font-bold shadow-md shadow-red-600/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{strings.expenses.submitting}</span>
                </>
              ) : (
                <>
                  <Receipt className="w-4 h-4" />
                  <span>{strings.expenses.submitButton}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
