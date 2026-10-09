import React, { useState, useEffect, useCallback } from 'react';
import { ModalPortal } from './ModalPortal.js';
import { useAuth } from '../context/AuthContext.js';
import { strings } from '../i18n/mr.js';
import {
  getMandalExpenses,
  deleteExpense,
  Expense,
  EXPENSE_CATEGORIES,
} from '../api/expenses.js';
import {
  getMandalFinancialSummary,
  MandalFinancialSummary,
  FinancialTransaction,
} from '../api/ledger.js';
import { CreateExpenseModal } from './CreateExpenseModal.js';
import { RecordVarganiModal } from './RecordVarganiModal.js';
import { ReceiptModal } from './ReceiptModal.js';
import {
  Receipt,
  Plus,
  Search,
  Loader2,
  AlertTriangle,
  User,
  Trash2,
  X,
  Wallet,
  ArrowDownCircle,
  Coins,
  Clock,
  ArrowUpRight,
  HandCoins,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { useAlertModal } from '../context/AlertModalContext.js';

export const ExpenseManagementView: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useAlertModal();
  const canManageExpenses = user?.role === 'PRESIDENT' || user?.role === 'TREASURER';
  const isPresident = user?.role === 'PRESIDENT';

  // Mandal Financial Summary state
  const [financialSummary, setFinancialSummary] = useState<MandalFinancialSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Expenses list state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isVarganiModalOpen, setIsVarganiModalOpen] = useState(false);
  const [activeReceiptTxnId, setActiveReceiptTxnId] = useState<string | null>(null);

  // Delete state (President only)
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Unified Centered Message / Alert Feedback
  const showToast = (msg: string) => {
    showSuccess('संदेश', msg);
  };

  const fetchSummary = useCallback(async () => {
    if (!canManageExpenses) return;
    setSummaryLoading(true);
    try {
      const res = await getMandalFinancialSummary();
      if (res.success && res.data) {
        setFinancialSummary(res.data);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setSummaryLoading(false);
    }
  }, [canManageExpenses]);

  const fetchExpenses = useCallback(async (category?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMandalExpenses({
        category: category && category !== 'ALL' ? category : undefined,
        limit: 50,
      });
      if (res.success && res.data) {
        setExpenses(res.data.expenses);
      } else {
        setError(res.error || 'खर्च माहिती लोड करता आली नाही.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchExpenses(selectedCategory);
  }, [selectedCategory, fetchSummary, fetchExpenses]);

  const handleDeleteExpense = async () => {
    if (!expenseToDelete) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await deleteExpense(expenseToDelete.id);
      if (res.success) {
        setExpenseToDelete(null);
        showToast('खर्च नोंद यशस्वीरीत्या हटवली.');
        fetchExpenses(selectedCategory);
        fetchSummary();
      } else {
        const errMsg = res.error || 'खर्च हटवताना अडचण आली.';
        setDeleteError(errMsg);
        showError('त्रुटी', errMsg);
      }
    } catch {
      setDeleteError('सर्व्हरशी संपर्क होऊ शकला नाही.');
      showError('त्रुटी', 'सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleVarganiSuccess = (txn: FinancialTransaction) => {
    showToast(`वर्गणी जमा यशस्वी! पावती क्र: RCP-${txn.transactionNumber.replace(/^TXN-/, '')}`);
    fetchSummary();
    setActiveReceiptTxnId(txn.id);
  };

  const handleExpenseCreated = () => {
    showToast('नवीन खर्च यशस्वीरीत्या नोंदवला गेला!');
    fetchExpenses(selectedCategory);
    fetchSummary();
  };

  // If Member role accesses directly: block view
  if (!canManageExpenses) {
    return (
      <div className="p-6 bg-white rounded-3xl border border-slate-200 text-center space-y-3 my-6">
        <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-bold text-slate-800">प्रवेश प्रतिबंधित (Access Restricted)</h4>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          केवळ मंडळाचे अध्यक्ष किंवा खजिनदार यांना मंडळाची आर्थिक स्थिती व खर्च व्यवस्थापन पाहण्याचा अधिकार आहे.
        </p>
      </div>
    );
  }

  // Filter by search term
  const filteredExpenses = expenses.filter((e) => {
    const term = searchTerm.toLowerCase();
    const reasonMatch = e.reason.toLowerCase().includes(term);
    const categoryMatch = e.category.toLowerCase().includes(term);
    const recordedByMatch = e.recordedByName?.toLowerCase().includes(term) ?? false;
    return reasonMatch || categoryMatch || recordedByMatch;
  });

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('mr-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4 pb-12">

      {/* ========================================== */}
      {/* 1. MANDAL FINANCIAL SUMMARY (आर्थिक स्थिती) */}
      {/* ========================================== */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-100 space-y-4">
        {/* Top Header & Dual Action Buttons */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">मंडळाची आर्थिक स्थिती</h3>
                <p className="text-[11px] text-slate-500">अधिकृत ताळेबंद व जमा-खर्च लेजर</p>
              </div>
            </div>

            {summaryLoading && (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            )}
          </div>

          {/* Action Toolbar: + वर्गणी जमा करा & + खर्च नोंदवा */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsVarganiModalOpen(true)}
              className="min-h-[44px] py-2.5 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.98] text-white text-xs font-bold rounded-2xl shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ वर्गणी जमा करा</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="min-h-[44px] py-2.5 px-3 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 active:scale-[0.98] text-white text-xs font-bold rounded-2xl shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ खर्च नोंदवा</span>
            </button>
          </div>
        </div>

        {/* 9 Real Authoritative Financial Cards */}
        {financialSummary && (
          <div className="space-y-2.5 pt-1">
            {/* Primary Hero: 💰 सध्याची मंडळाची शिल्लक */}
            <div className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl shadow-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-emerald-400" />
                  <span>सध्याची मंडळाची शिल्लक</span>
                </span>
                <span className="text-[10px] bg-white/10 text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                  उपलब्ध निधी
                </span>
              </div>
              <strong
                className={`text-2xl font-black font-mono block ${
                  financialSummary.currentBalance >= 0 ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                ₹{financialSummary.currentBalance}
              </strong>
              <span className="text-[10px] text-slate-400 block">
                एकूण जमा वजा एकूण खर्च व कर्ज वितरण
              </span>
            </div>

            {/* Inflow & Vargani Row */}
            <div className="grid grid-cols-3 gap-2">
              {/* 📥 एकूण जमा */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-left">
                <div className="flex items-center gap-1 text-[10px] text-emerald-800 font-bold mb-0.5">
                  <ArrowDownCircle className="w-3 h-3 text-emerald-600" />
                  <span>एकूण जमा</span>
                </div>
                <strong className="text-sm font-bold text-emerald-900 font-mono block">
                  ₹{financialSummary.totalInflow}
                </strong>
                <span className="text-[9px] text-emerald-700 block mt-0.5">
                  सर्व आवक
                </span>
              </div>

              {/* 🧾 एकूण वर्गणी / बिशी जमा */}
              <div className="p-3 bg-teal-50/70 border border-teal-100 rounded-2xl text-left">
                <div className="flex items-center gap-1 text-[10px] text-teal-800 font-bold mb-0.5">
                  <Receipt className="w-3 h-3 text-teal-600" />
                  <span>वर्गणी/बीसी जमा</span>
                </div>
                <strong className="text-sm font-bold text-teal-900 font-mono block">
                  ₹{financialSummary.totalVarganiCollected}
                </strong>
                <span className="text-[9px] text-teal-700 block mt-0.5">
                  हप्ते व वर्गणी
                </span>
              </div>

              {/* ⏳ बाकी वर्गणी */}
              <div className="p-3 bg-amber-50/70 border border-amber-100 rounded-2xl text-left">
                <div className="flex items-center gap-1 text-[10px] text-amber-800 font-bold mb-0.5">
                  <Clock className="w-3 h-3 text-amber-600" />
                  <span>बाकी वर्गणी</span>
                </div>
                <strong className="text-sm font-bold text-amber-900 font-mono block">
                  ₹{financialSummary.pendingVargani}
                </strong>
                <span className="text-[9px] text-amber-700 block mt-0.5">
                  प्रलंबित हप्ते
                </span>
              </div>
            </div>

            {/* Expenses & Loans Row */}
            <div className="grid grid-cols-3 gap-2">
              {/* 💸 एकूण खर्च */}
              <div className="p-3 bg-rose-50/70 border border-rose-100 rounded-2xl text-left">
                <div className="flex items-center gap-1 text-[10px] text-rose-800 font-bold mb-0.5">
                  <ArrowUpRight className="w-3 h-3 text-rose-600" />
                  <span>एकूण खर्च</span>
                </div>
                <strong className="text-sm font-bold text-rose-900 font-mono block">
                  ₹{financialSummary.totalExpenses}
                </strong>
                <span className="text-[9px] text-rose-700 block mt-0.5">
                  अधिकृत खर्ची
                </span>
              </div>

              {/* 💳 एकूण कर्ज दिलेले */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl text-left">
                <div className="flex items-center gap-1 text-[10px] text-indigo-800 font-bold mb-0.5">
                  <HandCoins className="w-3 h-3 text-indigo-600" />
                  <span>कर्ज दिलेले</span>
                </div>
                <strong className="text-sm font-bold text-indigo-900 font-mono block">
                  ₹{financialSummary.totalLoansDisbursed}
                </strong>
                <span className="text-[9px] text-indigo-700 block mt-0.5">
                  एकूण वाटप
                </span>
              </div>

              {/* 💵 एकूण कर्ज परतफेड */}
              <div className="p-3 bg-blue-50/70 border border-blue-100 rounded-2xl text-left">
                <div className="flex items-center gap-1 text-[10px] text-blue-800 font-bold mb-0.5">
                  <Coins className="w-3 h-3 text-blue-600" />
                  <span>कर्ज परतफेड</span>
                </div>
                <strong className="text-sm font-bold text-blue-900 font-mono block">
                  ₹{financialSummary.totalLoanRepayments}
                </strong>
                <span className="text-[9px] text-blue-700 block mt-0.5">
                  जमा परतफेड
                </span>
              </div>
            </div>

            {/* Loan Outstanding & Total Transactions Row */}
            <div className="grid grid-cols-2 gap-2">
              {/* 📌 कर्जाची बाकी */}
              <div className="p-3 bg-purple-50/70 border border-purple-100 rounded-2xl text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-purple-800 font-bold">📌 कर्जाची बाकी</span>
                  <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                    उर्वरित
                  </span>
                </div>
                <strong className="text-base font-bold text-purple-900 font-mono block mt-1">
                  ₹{financialSummary.outstandingLoans}
                </strong>
                <span className="text-[9px] text-purple-600 block mt-0.5">
                  सदस्यांकडील येणे बाकी
                </span>
              </div>

              {/* 📊 एकूण व्यवहार */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-700 font-bold">📊 एकूण व्यवहार</span>
                  <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-medium">
                    लेजर
                  </span>
                </div>
                <strong className="text-base font-bold text-slate-800 font-mono block mt-1">
                  {financialSummary.totalTransactions} व्यवहार
                </strong>
                <span className="text-[9px] text-slate-500 block mt-0.5">
                  अधिकृत पुष्टी झालेले
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================== */}
      {/* 2. EXPENSE LIST & FILTERING SECTION        */}
      {/* ========================================== */}
      <div className="bg-white rounded-3xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Receipt className="w-4 h-4 text-rose-600" />
            <span>मंडळ खर्च नोंदी</span>
          </h4>
          <span className="text-[10px] text-slate-400 font-medium">
            एकूण {expenses.length} नोंदी
          </span>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="खर्चाचे कारण, वर्गवारी किंवा नोंदवणाऱ्याचे नाव शोधा..."
            className="w-full min-h-[44px] pl-10 pr-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-colors"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-xl font-bold shrink-0 transition-colors cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {strings.expenses.filterAll}
          </button>
          {EXPENSE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-xl font-bold shrink-0 transition-colors cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Expense Cards List */}
      <div className="space-y-2.5">
        {loading ? (
          <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
            <span className="text-xs">खर्च माहिती लोड होत आहे...</span>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2">
            <AlertTriangle className="w-5 h-5 text-red-500 mx-auto" />
            <p className="text-xs font-bold text-red-800">{error}</p>
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="py-12 bg-white rounded-3xl border border-slate-100 text-center space-y-2 p-6">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto text-slate-400">
              <Receipt className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-700">
              {searchTerm || selectedCategory !== 'ALL'
                ? 'शोधाशी जुळणारा खर्च आढळला नाही.'
                : 'सध्या कोणताही मंडळ खर्च नोंदवलेला नाही.'}
            </h4>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              मंडळाचा झालेला अधिकृत खर्च नोंदवण्यासाठी वरील "+ खर्च नोंदवा" बटण वापरा.
            </p>
          </div>
        ) : (
          filteredExpenses.map((exp) => (
            <div
              key={exp.id}
              className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3 transition-all hover:border-slate-200"
            >
              {/* Row 1: Amount & Category Badge */}
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 font-medium block">खर्च रक्कम</span>
                  <strong className="text-lg font-bold text-rose-700 font-mono block leading-tight">
                    -₹{exp.amount}
                  </strong>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-100">
                    {exp.category}
                  </span>

                  {/* President Delete Action */}
                  {isPresident && (
                    <button
                      type="button"
                      onClick={() => setExpenseToDelete(exp)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                      title="खर्च हटवा"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Reason */}
              <div className="space-y-1">
                <h5 className="text-xs font-bold text-slate-800 leading-snug">
                  {exp.reason}
                </h5>
              </div>

              {/* Row 3: Metadata Footer */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3 text-slate-400" />
                  <span>नोंद: {exp.recordedByName || 'अध्यक्ष / खजिनदार'}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span>{formatDate(exp.expenseDate)}</span>

                  {/* Supporting Document / Bill Link (genuine files only) */}
                  {exp.receiptUrl && (
                    <a
                      href={exp.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 font-bold flex items-center gap-0.5 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>बिल पहा</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ========================================== */}
      {/* 3. MODALS                                  */}
      {/* ========================================== */}

      {/* + खर्च नोंदवा Modal */}
      <CreateExpenseModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onExpenseCreated={handleExpenseCreated}
      />

      {/* + वर्गणी जमा करा Modal */}
      <RecordVarganiModal
        isOpen={isVarganiModalOpen}
        onClose={() => setIsVarganiModalOpen(false)}
        onSuccess={handleVarganiSuccess}
      />

      {/* Digital Receipt Modal (for newly recorded contributions) */}
      <ReceiptModal
        transactionId={activeReceiptTxnId}
        isOpen={Boolean(activeReceiptTxnId)}
        onClose={() => setActiveReceiptTxnId(null)}
      />

      {/* President Delete Confirmation Modal */}
      {expenseToDelete && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-red-600 px-5 py-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-white" />
                <h3 className="text-sm font-bold">खर्च नोंद हटवा</h3>
              </div>
              <button
                type="button"
                onClick={() => setExpenseToDelete(null)}
                className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all min-h-[36px] min-w-[36px]"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-3.5">
              <p className="text-xs text-slate-600 leading-relaxed">
                तुम्हाला खात्री आहे का की ही खर्च नोंद कायमची हटवायची आहे?
                यामुळे लेजरमधील संबंधित खर्ची नोंद देखील आपोआप रद्द होईल.
              </p>

              {/* Expense Preview */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">रक्कम:</span>
                  <span className="font-mono font-bold text-red-600 text-sm">₹{expenseToDelete.amount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">वर्गवारी:</span>
                  <span className="font-semibold text-slate-800">{expenseToDelete.category}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">तारीख:</span>
                  <span className="font-mono text-slate-700">{expenseToDelete.expenseDate}</span>
                </div>
                <div className="flex justify-between items-start pt-1 border-t border-slate-200">
                  <span className="text-slate-500">कारण:</span>
                  <span className="font-semibold text-slate-800 text-right max-w-[200px] truncate">{expenseToDelete.reason}</span>
                </div>
              </div>

              {deleteError && (
                <div className="p-2.5 bg-red-100 border border-red-200 rounded-xl text-xs text-red-800">
                  {deleteError}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setExpenseToDelete(null)}
                  disabled={deleteLoading}
                  className="min-h-[44px] flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="button"
                  onClick={handleDeleteExpense}
                  disabled={deleteLoading}
                  className="min-h-[44px] flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-red-600/30 cursor-pointer disabled:opacity-60"
                >
                  {deleteLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>हटवा</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </ModalPortal>
      )}
    </div>
  );
};
