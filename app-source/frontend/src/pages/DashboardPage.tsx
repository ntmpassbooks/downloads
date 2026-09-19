import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { strings } from '../i18n/mr.js';
import { RoleBadge } from '../components/RoleBadge.js';
import { MemberDirectory } from '../components/MemberDirectory.js';
import { ProfileView } from '../components/ProfileView.js';
import { MonthlyReportView } from '../components/MonthlyReportView.js';
import { BishiManagementView } from '../components/BishiManagementView.js';
import { ExpenseManagementView } from '../components/ExpenseManagementView.js';
import { LoanManagementView } from '../components/LoanManagementView.js';
import { TransactionsView } from '../components/TransactionsView.js';
import { useNavigation } from '../context/NavigationContext.js';
import {
  generateBishiCycle,
  getBishiOverview,
  getMemberBishiConfig,
  BishiOverviewSummary,
  BishiConfig,
} from '../api/bishi.js';
import {
  getOrganizationLedger,
  getMyPassbook,
  getMandalFinancialSummary,
  MandalFinancialSummary,
} from '../api/ledger.js';
import {
  getMandalExpenses,
  Expense,
  EXPENSE_CATEGORIES,
} from '../api/expenses.js';
import { CreateExpenseModal } from '../components/CreateExpenseModal.js';
import {
  Building2,
  CheckCircle2,
  Users,
  ArrowRight,
  ShieldAlert,
  Coins,
  Loader2,
  CalendarClock,
  Wallet,
  BookOpen,
  Receipt,
  Plus,
  FileSpreadsheet,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { user, organization } = useAuth();
  const { currentTab: activeTab, setCurrentTab: setActiveTab } = useNavigation();

  // Bishi state
  const [bishiOverview, setBishiOverview] = useState<BishiOverviewSummary | null>(null);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleFeedback, setCycleFeedback] = useState<string | null>(null);

  // Financial Ledger & Passbook state
  const [financialSummary, setFinancialSummary] = useState<MandalFinancialSummary | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<{
    totalFunds: number;
    totalInflow: number;
    totalOutflow: number;
    totalExpenses: number;
    totalTransactions: number;
  } | null>(null);
  const [myPassbookSummary, setMyPassbookSummary] = useState<{ totalPaid: number; totalTransactions: number } | null>(null);
  const [myBishiConfig, setMyBishiConfig] = useState<BishiConfig | null>(null);

  // Mandal Expenses state (President & Treasurer)
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState<string>('ALL');
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);

  const fetchExpenses = useCallback(async (cat?: string) => {
    if (user?.role !== 'PRESIDENT' && user?.role !== 'TREASURER') return;
    setExpensesLoading(true);
    try {
      const res = await getMandalExpenses({
        category: cat && cat !== 'ALL' ? cat : undefined,
        limit: 20,
      });
      if (res.success && res.data) {
        setExpenses(res.data.expenses);
      }
    } catch {
      // Safe fail
    } finally {
      setExpensesLoading(false);
    }
  }, [user?.role]);

  const fetchOverview = useCallback(async () => {
    if (user?.role === 'PRESIDENT' || user?.role === 'TREASURER') {
      try {
        const [bishiRes, ledgerRes, summaryRes] = await Promise.all([
          getBishiOverview(),
          getOrganizationLedger(1, 1),
          getMandalFinancialSummary(),
        ]);
        if (bishiRes.success && bishiRes.data) {
          setBishiOverview(bishiRes.data.summary);
        }
        if (ledgerRes.success && ledgerRes.data) {
          setLedgerSummary(ledgerRes.data.summary);
        }
        if (summaryRes.success && summaryRes.data) {
          setFinancialSummary(summaryRes.data);
        }
      } catch {
        // Safe fail
      }
      fetchExpenses(selectedExpenseCategory);
    } else if (user?.role === 'MEMBER' && user?.id) {
      try {
        const [passbookRes, bishiRes] = await Promise.all([
          getMyPassbook(),
          getMemberBishiConfig(user.id),
        ]);
        if (passbookRes.success && passbookRes.data) {
          setMyPassbookSummary({
            totalPaid: passbookRes.data.totalPaid,
            totalTransactions: passbookRes.data.totalTransactions,
          });
        }
        if (bishiRes.success && bishiRes.data) {
          setMyBishiConfig(bishiRes.data);
        }
      } catch {
        // Safe fail
      }
    }
  }, [user?.role, user?.id, fetchExpenses, selectedExpenseCategory]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const handleCategoryFilter = (cat: string) => {
    setSelectedExpenseCategory(cat);
    fetchExpenses(cat);
  };

  const handleGenerateCycle = async () => {
    setCycleLoading(true);
    setCycleFeedback(null);
    try {
      const res = await generateBishiCycle();
      if (res.success && res.data) {
        setCycleFeedback(
          `मासिक चक्र पूर्ण: ${res.data.generatedCount} नवीन नोंदी तयार, ${res.data.skippedCount} आधीपासून अस्तित्वात.`
        );
        fetchOverview();
        setTimeout(() => setCycleFeedback(null), 5000);
      } else {
        setCycleFeedback(res.error || 'सायकल तयार करताना अडचण आली.');
      }
    } catch {
      setCycleFeedback('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setCycleLoading(false);
    }
  };

  const isPresident = user?.role === 'PRESIDENT';
  const isTreasurer = user?.role === 'TREASURER';
  const canManageBishi = isPresident || isTreasurer;

  return (
    <div className="flex-1 flex flex-col justify-between overflow-hidden">
      {/* Scrollable Main Area */}
      <div className="flex-1 p-3 sm:p-4 md:p-6 space-y-4 overflow-y-auto w-full max-w-4xl mx-auto">
        {/* TAB 1: Main Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            {/* Top Profile & Session Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
              {/* Mandal Profile Card */}
              <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
                  <Building2 className="w-6 h-6 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-slate-800 leading-snug truncate">
                    {organization?.name || 'मंडळ'}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs text-slate-500 font-medium">
                      कोड: <strong className="text-slate-700">{organization?.code}</strong>
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="text-xs text-slate-500 font-medium">
                      नोंदणी: <strong className="text-slate-700">{organization?.registrationNumber || 'N/A'}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* User Session & Role Card (Clickable to Profile) */}
              <div
                onClick={() => setActiveTab('profile')}
                className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-4 text-white shadow-md cursor-pointer hover:border-orange-500/30 border border-transparent transition-all active:scale-[0.99] flex flex-col justify-between"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs text-slate-400 font-medium">{strings.dashboard.welcome}</span>
                  {user && <RoleBadge role={user.role} />}
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold tracking-tight">{user?.fullName}</h3>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">+91 {user?.phone}</p>
                  </div>
                  <div className="text-xs text-orange-400 font-medium flex items-center gap-1 bg-white/10 px-2.5 py-1 rounded-lg">
                    <span>प्रोफाइल</span>
                    <span>›</span>
                  </div>
                </div>
              </div>
            </div>

            {/* President Member Management Quick Action */}
            {isPresident && (
              <div
                onClick={() => setActiveTab('members')}
                className="p-4 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20 cursor-pointer active:scale-[0.98] transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold leading-tight">सदस्य व्यवस्थापन</h4>
                    <p className="text-[11px] text-orange-100 mt-0.5">
                      सदस्य यादी, नवीन नोंदणी व खाते नियंत्रण
                    </p>
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-white/20">
                  <ArrowRight className="w-4 h-4 text-white" />
                </div>
              </div>
            )}

            {/* Bishi Overview & Monthly Cycle Generator (President & Treasurer) */}
            {(user?.role === 'PRESIDENT' || user?.role === 'TREASURER') && (
              <div id="bishi-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                      <Coins className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        {strings.bishi.title}
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        चालू महिना बीसी स्थिती
                      </span>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono bg-orange-50 text-orange-700 px-2 py-0.5 rounded-md border border-orange-100 font-bold">
                    {new Date().toISOString().slice(0, 7)}
                  </span>
                </div>

                {/* Real Summary Metrics - ZERO FAKE DATA */}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center">
                  <div className="p-1.5 sm:p-2 bg-slate-50 border border-slate-100 rounded-xl">
                    <span className="text-[10px] text-slate-400 block">एकूण बीसी</span>
                    <strong className="text-xs font-bold text-slate-800">
                      {bishiOverview?.totalConfigured ?? 0} सदस्य
                    </strong>
                  </div>
                  <div className="p-1.5 sm:p-2 bg-slate-50 border border-slate-100 rounded-xl">
                    <span className="text-[10px] text-slate-400 block">हप्ता रक्कम</span>
                    <strong className="text-xs font-bold text-slate-800">
                      ₹{bishiOverview?.totalExpectedAmount ?? 0}
                    </strong>
                  </div>
                  <div className="p-1.5 sm:p-2 bg-slate-50 border border-slate-100 rounded-xl">
                    <span className="text-[10px] text-slate-400 block">तयार नोंदी</span>
                    <strong className="text-xs font-bold text-slate-800">
                      {bishiOverview?.totalRecordsGenerated ?? 0}
                    </strong>
                  </div>
                </div>

                {/* Cycle Feedback Notice */}
                {cycleFeedback && (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-1.5 animate-in fade-in">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{cycleFeedback}</span>
                  </div>
                )}

                {/* President & Treasurer Trigger: Generate Monthly Cycle */}
                {canManageBishi && (
                  <button
                    type="button"
                    onClick={handleGenerateCycle}
                    disabled={cycleLoading}
                    className="w-full py-2.5 px-3 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-[0.99] text-white text-xs font-bold rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {cycleLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <CalendarClock className="w-3.5 h-3.5" />
                        <span>{strings.bishi.generateCycleButton}</span>
                      </>
                    )}
                  </button>
                )}

                {/* Direct link to dedicated Bishi Management View */}
                <button
                  type="button"
                  onClick={() => setActiveTab('bishi')}
                  className="w-full py-2 px-3 bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-bold rounded-xl border border-orange-200 flex items-center justify-center gap-1.5 transition-all"
                >
                  <span>संपूर्ण बीशी व्यवस्थापन पहा</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Real Financial Ledger & Treasury Summary (President & Treasurer) */}
            {(user?.role === 'PRESIDENT' || user?.role === 'TREASURER') && (
              <div id="ledger-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        {strings.treasury.title}
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        प्रत्यक्ष जमा व खर्च हिशोब
                      </span>
                    </div>
                  </div>

                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-100 font-bold">
                    लेजर सक्रिय
                  </span>
                </div>

                {/* Net Available Funds Hero Metric */}
                <div className="p-3.5 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl flex flex-col min-[380px]:flex-row min-[380px]:items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-bold text-emerald-800 block">
                      {strings.treasury.netFunds}
                    </span>
                    <strong className="text-2xl font-black text-emerald-900 font-mono tracking-tight">
                      ₹{financialSummary?.currentBalance ?? ledgerSummary?.totalFunds ?? 0}
                    </strong>
                    <span className="text-[10px] text-emerald-700/80 block mt-0.5">
                      शिल्लक = एकूण जमा - एकूण वितरण व खर्च
                    </span>
                  </div>
                  <div className="flex flex-row min-[380px]:flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setActiveTab('transactions')}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 shadow-xs flex-1 min-[380px]:flex-none"
                    >
                      <span>व्यवहार पहा</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('expenses')}
                      className="px-3 py-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-800 text-xs font-bold rounded-xl border border-emerald-200 transition-all flex items-center justify-center gap-1 flex-1 min-[380px]:flex-none"
                    >
                      <span>खर्च तपशील</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Real Authoritative Treasury Breakdown Grid (9 Real Values) */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
                  {/* 1. Inflow */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      {strings.treasury.totalInflow}
                    </span>
                    <strong className="text-sm font-bold text-emerald-700 font-mono">
                      +₹{financialSummary?.totalInflow ?? ledgerSummary?.totalInflow ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5 truncate">
                      सर्व आवक
                    </span>
                  </div>

                  {/* 2. Vargani / Bishi Collected */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      वर्गणी / बिशी जमा
                    </span>
                    <strong className="text-sm font-bold text-teal-700 font-mono">
                      ₹{financialSummary?.totalVarganiCollected ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5 truncate">
                      हप्ते व वर्गणी
                    </span>
                  </div>

                  {/* 3. Pending Vargani */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      बाकी वर्गणी / बिशी
                    </span>
                    <strong className="text-sm font-bold text-amber-700 font-mono">
                      ₹{financialSummary?.pendingVargani ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5 truncate">
                      प्रलंबित हप्ते
                    </span>
                  </div>

                  {/* 4. Total Expenses */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      {strings.treasury.totalExpenses}
                    </span>
                    <strong className="text-sm font-bold text-rose-700 font-mono">
                      ₹{financialSummary?.totalExpenses ?? ledgerSummary?.totalExpenses ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      अधिकृत मंडळ खर्च
                    </span>
                  </div>

                  {/* 5. Loans Disbursed */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      एकूण कर्ज वाटप
                    </span>
                    <strong className="text-sm font-bold text-indigo-700 font-mono">
                      ₹{financialSummary?.totalLoansDisbursed ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      सदस्य कर्ज वाटप
                    </span>
                  </div>

                  {/* 6. Loan Repayments */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      कर्ज परतफेड जमा
                    </span>
                    <strong className="text-sm font-bold text-blue-700 font-mono">
                      ₹{financialSummary?.totalLoanRepayments ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      परत आलेली रक्कम
                    </span>
                  </div>

                  {/* 7. Outstanding Loans */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      शिल्लक बाकी कर्ज
                    </span>
                    <strong className="text-sm font-bold text-orange-700 font-mono">
                      ₹{financialSummary?.outstandingLoans ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      येणे बाकी कर्ज
                    </span>
                  </div>

                  {/* 8. Total Confirmed Transactions */}
                  <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-slate-500 font-medium block">
                      पुष्टी झालेले व्यवहार
                    </span>
                    <strong className="text-sm font-bold text-slate-800 font-mono">
                      {financialSummary?.totalTransactions ?? ledgerSummary?.totalTransactions ?? 0}
                    </strong>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      लेजर नोंदी
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Real Mandal Expense History (President & Treasurer) */}
            {(user?.role === 'PRESIDENT' || user?.role === 'TREASURER') && (
              <div id="expenses-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center text-red-600 font-bold">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        {strings.expenses.title}
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        {strings.expenses.subtitle}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab('expenses')}
                      className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition-colors flex items-center gap-1"
                      title="सर्व खर्च पहा"
                    >
                      <span>सर्व खर्च</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsExpenseModalOpen(true)}
                      className="p-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-bold transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>नोंदवा</span>
                    </button>
                  </div>
                </div>

                {/* Category Filter Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
                  <button
                    type="button"
                    onClick={() => handleCategoryFilter('ALL')}
                    className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-colors ${
                      selectedExpenseCategory === 'ALL'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {strings.expenses.filterAll}
                  </button>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-colors ${
                        selectedExpenseCategory === cat
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Expense List or Empty State */}
                {expensesLoading ? (
                  <div className="p-6 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
                    <span className="text-xs text-slate-400 mt-2 block">
                      खर्च नोंदी लोड होत आहेत...
                    </span>
                  </div>
                ) : expenses.length === 0 ? (
                  <div className="p-6 text-center space-y-2 bg-slate-50/70 border border-dashed border-slate-200 rounded-xl">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                      <Receipt className="w-5 h-5" />
                    </div>
                    <h5 className="text-xs font-bold text-slate-700">
                      {strings.expenses.emptyTitle}
                    </h5>
                    <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                      {strings.expenses.emptyDesc}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {expenses.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1 hover:border-red-200 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-100 text-red-800">
                            {item.category}
                          </span>
                          <strong className="text-sm font-bold text-red-600 font-mono">
                            -₹{item.amount}
                          </strong>
                        </div>
                        <p className="text-xs font-medium text-slate-800 leading-snug">
                          {item.reason}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                          <span className="shrink-0">{item.expenseDate}</span>
                          <span className="font-mono truncate">{item.transactionNumber}</span>
                          <span className="truncate max-w-[120px]">नोंद: {item.recordedByName || 'अधिकृत'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Member's Personal Bishi Summary Card (For Members) */}
            {user?.role === 'MEMBER' && (
              <div
                onClick={() => setActiveTab('bishi')}
                className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3 cursor-pointer hover:border-orange-300 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                      <Coins className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        माझी बीशी माहिती
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        मासिक हप्ता व भरणा स्थिती
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-orange-600 font-bold flex items-center gap-0.5">
                    <span>तपशील पहा</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>

                {!myBishiConfig ? (
                  <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center space-y-1">
                    <p className="text-xs font-semibold text-slate-700">
                      सध्या कोणतीही बीशी नोंद उपलब्ध नाही.
                    </p>
                    <p className="text-[10px] text-slate-400">
                      मंडळाचे अध्यक्ष जेव्हा तुमची बीसी रक्कम निश्चित करतील, तेव्हा ती येथे दिसेल.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                      <span className="text-[10px] text-slate-400 block font-medium">मासिक हप्ता</span>
                      <strong className="text-sm font-bold text-slate-800 font-mono">
                        ₹{myBishiConfig.monthlyAmount}
                      </strong>
                    </div>
                    <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                      <span className="text-[10px] text-slate-400 block font-medium">देय दिनांक</span>
                      <strong className="text-sm font-bold text-slate-800 font-mono">
                        दर महिन्याची {myBishiConfig.dueDay} तारीख
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Member's Quick Digital Passbook Summary (For Members) */}
            {user?.role === 'MEMBER' && (
              <div
                onClick={() => setActiveTab('profile')}
                className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3 cursor-pointer hover:border-orange-300 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        माझे पासबुक व पावत्या
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        आपल्या बीसी ठेवी व अधिकृत नोंदी
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-emerald-600 font-mono block">
                      ₹{myPassbookSummary?.totalPaid ?? 0}
                    </span>
                    <span className="text-[10px] text-orange-600 font-bold">तपशील पहा ›</span>
                  </div>
                </div>

                {myPassbookSummary?.totalTransactions === 0 ? (
                  <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center">
                    <p className="text-xs font-semibold text-slate-700">
                      सध्या कोणतेही व्यवहार उपलब्ध नाहीत.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <span className="text-slate-500 text-[11px]">एकूण पुष्टी झालेले व्यवहार</span>
                    <strong className="font-mono text-slate-800 font-bold">
                      {myPassbookSummary?.totalTransactions ?? 0}
                    </strong>
                  </div>
                )}
              </div>
            )}

            {/* Financial Reports & Audit Quick Access Card (President & Treasurer) */}
            {(user?.role === 'PRESIDENT' || user?.role === 'TREASURER') && (
              <div
                onClick={() => setActiveTab('reports')}
                className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3 cursor-pointer hover:border-orange-300 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        आर्थिक अहवाल व ऑडिट विवरण
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        मासिक अहवाल, लेजर विवरण व ऑडिट नोंदी
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-orange-600 font-bold flex items-center gap-0.5">
                    <span>विवरण पहा</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Member Management (President Only) */}
        {activeTab === 'members' && (
          isPresident ? (
            <MemberDirectory
              mandalName={organization?.name}
              mandalCode={organization?.code}
            />
          ) : (
            <div className="p-6 text-center space-y-3 bg-white rounded-2xl border border-slate-100 shadow-xs">
              <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">अनधिकृत प्रवेश (Access Denied)</h4>
              <p className="text-xs text-slate-500">
                सदस्य व्यवस्थापन कक्षाचा प्रवेश केवळ अधिकृत अध्यक्षांसाठी मर्यादित आहे.
              </p>
            </div>
          )
        )}

        {/* TAB: Bishi Management (Dedicated view for all roles) */}
        {activeTab === 'bishi' && (
          <BishiManagementView />
        )}

        {/* TAB: Dedicated Transactions View (व्यवहार) */}
        {activeTab === 'transactions' && (
          <TransactionsView />
        )}

        {/* TAB: Dedicated Loan Management (All roles, role-scoped) */}
        {activeTab === 'loans' && (
          <LoanManagementView />
        )}

        {/* TAB: Mandal Expenses Management (President & Treasurer) */}
        {activeTab === 'expenses' && (
          (user?.role === 'PRESIDENT' || user?.role === 'TREASURER') ? (
            <ExpenseManagementView />
          ) : (
            <div className="p-6 text-center space-y-3 bg-white rounded-2xl border border-slate-100 shadow-xs">
              <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">अनधिकृत प्रवेश (Access Denied)</h4>
              <p className="text-xs text-slate-500">
                मंडळ खर्च पाहण्याचा व नोंदवण्याचा अधिकार केवळ अध्यक्ष व खजिनदारांना आहे.
              </p>
            </div>
          )
        )}

        {/* TAB: Monthly Financial Statement & Audit Export (President & Treasurer) */}
        {activeTab === 'reports' && (
          (user?.role === 'PRESIDENT' || user?.role === 'TREASURER') ? (
            <MonthlyReportView />
          ) : (
            <div className="p-6 text-center space-y-3 bg-white rounded-2xl border border-slate-100 shadow-xs">
              <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">अनधिकृत प्रवेश (Access Denied)</h4>
              <p className="text-xs text-slate-500">
                आर्थिक अहवाल व ऑडिट विवरण पाहण्याचा अधिकार केवळ अध्यक्ष व खजिनदारांना आहे.
              </p>
            </div>
          )
        )}

        {/* TAB 3: User Profile & Security Settings */}
        {activeTab === 'profile' && (
          <ProfileView />
        )}
      </div>

      {/* Create Expense Modal (President & Treasurer) */}
      <CreateExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        onExpenseCreated={fetchOverview}
      />
    </div>
  );
};
