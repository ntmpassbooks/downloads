import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import {
  Loan,
  LoanInstallment,
  LoanSchedulePreview,
  getMandalLoans,
  getMyLoans,
  createLoan,
  calculateLoanPreview,
  getLoanInstallments,
  initiateOnlineLoanRepayment,
  recordCashLoanRepayment,
  deleteLoan,
} from '../api/loans.js';
import { getMembers, Member } from '../api/members.js';
import { downloadLoansReport } from '../api/reporting.js';
import { ReceiptModal } from './ReceiptModal.js';
import { strings } from '../i18n/mr.js';
import { useAlertModal } from '../context/AlertModalContext.js';
import { ModalPortal } from './ModalPortal';
import {
  HandCoins,
  PlusCircle,
  Banknote,
  Receipt,
  Search,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Calendar,
  Phone,
  User,
  X,
  History,
  ChevronDown,
  ChevronUp,
  Trash2,
  CreditCard,
  QrCode,
  FileText,
  FileSpreadsheet,
  Download,
  CalendarDays,
} from 'lucide-react';

export const LoanManagementView: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useAlertModal();
  const isPresident = user?.role === 'PRESIDENT';
  const isTreasurer = user?.role === 'TREASURER';
  const canManageLoans = isPresident || isTreasurer;

  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'CLOSED'>('ALL');

  // Expanded repayment history per loan
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);

  // New Loan Modal State (President & Treasurer)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [interestRate, setInterestRate] = useState('12');
  const [interestType, setInterestType] = useState<'FLAT' | 'REDUCING_BALANCE'>('FLAT');
  const [ratePeriod, setRatePeriod] = useState<'ANNUAL' | 'MONTHLY'>('ANNUAL');
  const [tenureMonths, setTenureMonths] = useState('12');
  const [firstDueDate, setFirstDueDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [loanDate, setLoanDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loanNotes, setLoanNotes] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Real-time schedule preview
  const [schedulePreview, setSchedulePreview] = useState<LoanSchedulePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Cash Repayment Modal State (President & Treasurer)
  const [selectedLoanForRepayment, setSelectedLoanForRepayment] = useState<Loan | null>(null);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentSubmitting, setRepaymentSubmitting] = useState(false);
  const [repaymentError, setRepaymentError] = useState<string | null>(null);

  // Installment Schedule Modal State
  const [selectedLoanForInstallments, setSelectedLoanForInstallments] = useState<Loan | null>(null);
  const [installments, setInstallments] = useState<LoanInstallment[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);

  // Member Online Repayment Modal State
  const [selectedLoanForOnlineRepay, setSelectedLoanForOnlineRepay] = useState<Loan | null>(null);
  const [onlineRepayAmount, setOnlineRepayAmount] = useState('');
  const [onlineOrderDetails, setOnlineOrderDetails] = useState<{
    order: any;
    accountName: string;
    bank: string;
    upiIntentUrl?: string;
    upiId?: string | null;
    qrCodeData?: string | null;
  } | null>(null);
  const [onlineRepaySubmitting, setOnlineRepaySubmitting] = useState(false);
  const [onlineRepayStep, setOnlineRepayStep] = useState<'AMOUNT' | 'QR'>('AMOUNT');
  const [onlineRepayNoticeSent, setOnlineRepayNoticeSent] = useState(false);

  // Receipt Modal State
  const [selectedTxnForReceipt, setSelectedTxnForReceipt] = useState<string | null>(null);

  // Delete / Cancel Loan State (President & Treasurer)
  const [loanToDelete, setLoanToDelete] = useState<Loan | null>(null);
  const [deleteLoanLoading, setDeleteLoanLoading] = useState(false);
  const [deleteLoanError, setDeleteLoanError] = useState<string | null>(null);

  // Report Export State
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'excel' | 'csv' | null>(null);

  // Fetch loans according to role
  const fetchLoans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = canManageLoans ? await getMandalLoans() : await getMyLoans();
      if (res.success && res.data) {
        setLoans(res.data);
      } else {
        setError(res.error || 'कर्ज माहिती लोड करता आली नाही.');
      }
    } catch (err: any) {
      setError(err.message || 'नेटवर्क त्रुटी आली.');
    } finally {
      setLoading(false);
    }
  }, [canManageLoans]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  // Load members for loan creation
  const openCreateModal = async () => {
    setShowCreateModal(true);
    setCreateError(null);
    setSelectedMemberId('');
    setLoanAmount('');
    setInterestRate('12');
    setInterestType('FLAT');
    setRatePeriod('ANNUAL');
    setTenureMonths('12');
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    setFirstDueDate(d.toISOString().split('T')[0]);
    setLoanDate(new Date().toISOString().split('T')[0]);
    setLoanNotes('');
    setSchedulePreview(null);

    if (members.length === 0) {
      setMembersLoading(true);
      try {
        const res = await getMembers(1, 100, 'active');
        if (res.success && res.data) {
          setMembers(res.data);
        }
      } catch {
        // Safe fallback
      } finally {
        setMembersLoading(false);
      }
    }
  };

  // Recalculate schedule preview when inputs change
  useEffect(() => {
    if (!showCreateModal) return;
    const p = parseInt(loanAmount, 10);
    const r = parseFloat(interestRate);
    const m = parseInt(tenureMonths, 10);

    if (isNaN(p) || p <= 0 || isNaN(r) || isNaN(m) || m <= 0) {
      setSchedulePreview(null);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await calculateLoanPreview({
          principal: p,
          interestRate: r,
          interestType,
          ratePeriod,
          tenureMonths: m,
          firstDueDate: firstDueDate || undefined,
        });
        if (isMounted && res.success && res.data) {
          setSchedulePreview(res.data);
        }
      } catch {
        // Fallback or ignore
      } finally {
        if (isMounted) setPreviewLoading(false);
      }
    }, 250);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [showCreateModal, loanAmount, interestRate, interestType, ratePeriod, tenureMonths, firstDueDate]);

  const handleCreateLoanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const parsedAmount = parseInt(loanAmount, 10);
    const parsedRate = parseFloat(interestRate);
    const parsedTenure = parseInt(tenureMonths, 10);

    if (!selectedMemberId) {
      setCreateError('कृपया कर्ज घेणारा सदस्य निवडा.');
      return;
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setCreateError(strings.loans.minAmountError);
      return;
    }

    setCreateSubmitting(true);
    try {
      const res = await createLoan({
        memberId: selectedMemberId,
        amount: parsedAmount,
        interestRate: isNaN(parsedRate) ? 0 : parsedRate,
        interestType,
        ratePeriod,
        tenureMonths: isNaN(parsedTenure) ? 1 : parsedTenure,
        firstDueDate: firstDueDate || undefined,
        loanDate: loanDate || undefined,
        notes: loanNotes.trim() || undefined,
      });

      if (res.success) {
        setShowCreateModal(false);
        showSuccess('कर्ज वाटप यशस्वी', strings.loans.createSuccess);
        await fetchLoans();
      } else {
        const errMsg = res.error || 'कर्ज वाटप नोंद अयशस्वी.';
        setCreateError(errMsg);
        showError('त्रुटी', errMsg);
      }
    } catch (err: any) {
      const errMsg = err.message || 'सर्व्हर त्रुटी आली.';
      setCreateError(errMsg);
      showError('त्रुटी', errMsg);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleRepaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoanForRepayment) return;
    setRepaymentError(null);

    const parsedAmount = parseInt(repaymentAmount, 10);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setRepaymentError(strings.loans.minAmountError);
      return;
    }
    if (parsedAmount > selectedLoanForRepayment.outstandingBalance) {
      setRepaymentError(strings.loans.overpaymentError);
      return;
    }

    setRepaymentSubmitting(true);
    try {
      const res = await recordCashLoanRepayment(selectedLoanForRepayment.id, {
        amount: parsedAmount,
        notes: repaymentNotes.trim() || undefined,
      });

      if (res.success && res.data) {
        setSelectedLoanForRepayment(null);
        showSuccess('परतफेड नोंद यशस्वी', strings.loans.repaySuccess);
        await fetchLoans();
        if (res.data.transaction?.id) {
          setSelectedTxnForReceipt(res.data.transaction.id);
        }
      } else {
        const errMsg = res.error || 'परतफेड नोंद अयशस्वी.';
        setRepaymentError(errMsg);
        showError('त्रुटी', errMsg);
      }
    } catch (err: any) {
      const errMsg = err.message || 'सर्व्हर त्रुटी आली.';
      setRepaymentError(errMsg);
      showError('त्रुटी', errMsg);
    } finally {
      setRepaymentSubmitting(false);
    }
  };

  const openInstallmentsModal = async (loan: Loan) => {
    setSelectedLoanForInstallments(loan);
    setInstallments([]);
    setInstallmentsLoading(true);
    try {
      const res = await getLoanInstallments(loan.id);
      if (res.success && res.data) {
        setInstallments(res.data);
      }
    } catch (err: any) {
      showError('त्रुटी', err.message || 'हप्ते माहिती लोड करता आली नाही.');
    } finally {
      setInstallmentsLoading(false);
    }
  };

  const openOnlineRepaymentModal = (loan: Loan) => {
    setSelectedLoanForOnlineRepay(loan);
    setOnlineRepayAmount(String(loan.monthlyInstallment || Math.min(loan.outstandingBalance, 2000)));
    setOnlineOrderDetails(null);
    setOnlineRepayStep('AMOUNT');
    setOnlineRepayNoticeSent(false);
  };

  const handleGenerateOnlineOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoanForOnlineRepay) return;
    const p = parseInt(onlineRepayAmount, 10);
    if (isNaN(p) || p <= 0) {
      showError('त्रुटी', 'कृपया वैध रक्कम प्रविष्ट करा.');
      return;
    }
    if (p > selectedLoanForOnlineRepay.outstandingBalance) {
      showError('त्रुटी', `रक्कम बाकी शिल्लक ₹${selectedLoanForOnlineRepay.outstandingBalance} पेक्षा जास्त असू शकत नाही.`);
      return;
    }

    setOnlineRepaySubmitting(true);
    try {
      const res = await initiateOnlineLoanRepayment(selectedLoanForOnlineRepay.id, p);
      if (res.success && res.data) {
        setOnlineOrderDetails(res.data);
        setOnlineRepayStep('QR');
      } else {
        showError('त्रुटी', res.error || 'ऑनलाइन ऑर्डर तयार करता आली नाही.');
      }
    } catch (err: any) {
      showError('त्रुटी', err.message || 'सर्व्हर त्रुटी आली.');
    } finally {
      setOnlineRepaySubmitting(false);
    }
  };

  const handleConfirmMemberPaidNotice = () => {
    setOnlineRepayNoticeSent(true);
    showSuccess('पडताळणी सूचना पाठवली', 'मी पेमेंट केले ही सूचना अध्यक्षांना/खजिनदारांना पाठवली आहे. ते पडताळणी करून कर्ज खात्यात जमा नोंदवतील.');
    fetchLoans();
  };

  const handleConfirmDeleteLoan = async () => {
    if (!loanToDelete) return;
    setDeleteLoanLoading(true);
    setDeleteLoanError(null);
    try {
      const res = await deleteLoan(loanToDelete.id);
      if (res.success) {
        showSuccess('कर्ज हटवले', res.data?.message || 'कर्ज यशस्वीरीत्या हटवले/रद्द केले.');
        setLoanToDelete(null);
        await fetchLoans();
      } else {
        setDeleteLoanError(res.error || 'कर्ज हटवता आले नाही.');
      }
    } catch (err: any) {
      setDeleteLoanError(err.message || 'सर्व्हर त्रुटी आली.');
    } finally {
      setDeleteLoanLoading(false);
    }
  };

  const handleExportLoans = async (format: 'pdf' | 'excel' | 'csv') => {
    setExportingFormat(format);
    try {
      const res = await downloadLoansReport(format);
      if (res.success) {
        showSuccess('डाऊनलोड यशस्वी', `कर्ज रजिस्टर ${format.toUpperCase()} अहवाल डाऊनलोड झाला.`);
      } else {
        showError('त्रुटी', res.error || 'अहवाल डाऊनलोड अयशस्वी.');
      }
    } finally {
      setExportingFormat(null);
    }
  };

  // Filter loans
  const filteredLoans = loans.filter((loan) => {
    if (statusFilter !== 'ALL' && loan.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const name = (loan.memberName || '').toLowerCase();
      const phone = (loan.memberPhone || '').toLowerCase();
      const txn = (loan.disbursementTransactionNumber || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || txn.includes(q);
    }
    return true;
  });

  // Calculate summary KPIs
  const totalPrincipal = loans.reduce((acc, l) => acc + l.amount, 0);
  const totalRepaid = loans.reduce((acc, l) => acc + l.totalRepaid, 0);
  const totalOutstanding = loans.reduce((acc, l) => (l.status === 'ACTIVE' ? acc + l.outstandingBalance : acc), 0);
  const activeCount = loans.filter((l) => l.status === 'ACTIVE').length;

  const mapInstallmentStatus = (status: string) => {
    switch (status) {
      case 'PAID':
        return { label: 'पूर्ण भरलेला', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
      case 'PARTIALLY_PAID':
        return { label: 'अंशतः भरलेला', cls: 'bg-blue-50 text-blue-800 border-blue-200' };
      case 'DUE':
        return { label: 'देय (Due)', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
      case 'OVERDUE':
        return { label: 'थकबाकी (Overdue)', cls: 'bg-red-50 text-red-800 border-red-200' };
      default:
        return { label: 'आगामी (Upcoming)', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
    }
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Header Card */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
              <HandCoins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                {canManageLoans ? 'मंडळ कर्ज व्यवस्थापन' : 'माझी कर्जे व परतफेड'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {canManageLoans ? 'EMI हप्ते, मुद्दल-व्याज व अधिकृत हिशोब' : 'आपल्या खात्यातील मंजूर कर्ज, EMI हप्ते व परतफेड'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canManageLoans && (
              <button
                type="button"
                onClick={openCreateModal}
                className="flex items-center gap-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-xs shrink-0 cursor-pointer min-h-[38px]"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>नवीन कर्ज वाटप</span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
            <span className="text-[10px] text-slate-500 block">एकूण कर्जे</span>
            <strong className="text-sm font-bold text-slate-800 font-mono">
              {loans.length} <span className="text-[10px] text-slate-400 font-normal">({activeCount} सक्रिय)</span>
            </strong>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
            <span className="text-[10px] text-slate-500 block">एकूण मुद्दल</span>
            <strong className="text-sm font-bold text-slate-800 font-mono">
              ₹{totalPrincipal.toLocaleString('en-IN')}
            </strong>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
            <span className="text-[10px] text-slate-500 block">एकूण परतफेड</span>
            <strong className="text-sm font-bold text-emerald-700 font-mono">
              ₹{totalRepaid.toLocaleString('en-IN')}
            </strong>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
            <span className="text-[10px] text-slate-500 block">शिल्लक बाकी</span>
            <strong className="text-sm font-bold text-amber-700 font-mono">
              ₹{totalOutstanding.toLocaleString('en-IN')}
            </strong>
          </div>
        </div>

        {/* Export Buttons Bar */}
        {canManageLoans && loans.length > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 flex-wrap gap-2">
            <span className="text-[11px] font-bold text-slate-600">कर्ज रजिस्टर अहवाल:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleExportLoans('pdf')}
                disabled={exportingFormat !== null}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs disabled:opacity-50 min-h-[34px] cursor-pointer"
                title="प्रिंटेबल A4 PDF डाऊनलोड करा"
              >
                {exportingFormat === 'pdf' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportLoans('excel')}
                disabled={exportingFormat !== null}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs disabled:opacity-50 min-h-[34px] cursor-pointer"
                title="Excel .xlsx डाऊनलोड करा"
              >
                {exportingFormat === 'excel' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportLoans('csv')}
                disabled={exportingFormat !== null}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs disabled:opacity-50 min-h-[34px] cursor-pointer"
                title="CSV डाऊनलोड करा"
              >
                {exportingFormat === 'csv' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3 text-orange-400" />}
                <span>CSV</span>
              </button>
            </div>
          </div>
        )}

        {/* Search & Filter Toolbar */}
        {loans.length > 0 && (
          <div className="pt-2 space-y-2 border-t border-slate-100">
            {canManageLoans && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="नाव, मोबाईल किंवा व्यवहार क्र. शोधा..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>
            )}

            <div className="flex gap-1 overflow-x-auto text-[11px] font-bold text-slate-600 no-scrollbar">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-orange-600 text-white border-orange-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                सर्व ({loans.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                सक्रिय ({loans.filter((l) => l.status === 'ACTIVE').length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('CLOSED')}
                className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  statusFilter === 'CLOSED'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                पूर्ण भरलेले ({loans.filter((l) => l.status === 'CLOSED').length})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
          <span className="text-xs font-medium">कर्ज माहिती लोड होत आहे...</span>
        </div>
      ) : loans.length === 0 ? (
        <div className="p-8 bg-white border border-dashed border-slate-200 rounded-2xl text-center space-y-2 shadow-xs">
          <HandCoins className="w-10 h-10 text-slate-300 mx-auto" />
          <h4 className="text-sm font-bold text-slate-700">
            {strings.loans.emptyLoans}
          </h4>
          <p className="text-xs text-slate-400">
            {canManageLoans
              ? 'मंडळात कोणतेही कर्ज सक्रिय अथवा नोंदवलेले नाही.'
              : 'मंडळाने तुम्हाला कर्ज मंजूर केल्यानंतर त्याचा संपूर्ण तपशील येथे दिसेल.'}
          </p>
        </div>
      ) : filteredLoans.length === 0 ? (
        <div className="p-6 bg-white border border-slate-100 rounded-2xl text-center space-y-1 text-slate-400 text-xs">
          शोध परिणामात कोणतीही कर्ज नोंद सापडली नाही.
        </div>
      ) : (
        /* Loan Cards List */
        <div className="space-y-3">
          {filteredLoans.map((loan) => {
            const isExpanded = expandedLoanId === loan.id;
            const repayments = loan.repayments || [];

            return (
              <div
                key={loan.id}
                className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3"
              >
                {/* Header: Member & Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    {canManageLoans && (
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <h4 className="text-xs font-bold text-slate-800">
                          {loan.memberName || 'सदस्य'}
                        </h4>
                        {loan.memberPhone && (
                          <span className="text-[10px] text-slate-400 font-mono flex items-center gap-0.5">
                            <Phone className="w-2.5 h-2.5" />
                            {loan.memberPhone}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        दिनांक: {loan.loanDate?.slice(0, 10)}
                      </span>
                      {loan.disbursementTransactionNumber && (
                        <span className="font-mono">
                          • क्र: {loan.disbursementTransactionNumber}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                      loan.status === 'ACTIVE'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : loan.status === 'CLOSED'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {loan.status === 'ACTIVE'
                      ? strings.loans.statusActive
                      : loan.status === 'CLOSED'
                      ? strings.loans.statusClosed
                      : strings.loans.statusCancelled}
                  </span>
                </div>

                {/* Financial 4-box Grid (Principal, Repaid, Outstanding, EMI) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 block">{strings.loans.principalAmount}</span>
                    <strong className="text-slate-800 font-mono text-xs">
                      ₹{loan.amount.toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">परतफेड झालेली</span>
                    <strong className="text-emerald-700 font-mono text-xs">
                      ₹{loan.totalRepaid.toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">शिल्लक बाकी</span>
                    <strong className="text-amber-700 font-mono text-xs">
                      ₹{loan.outstandingBalance.toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">दरमहा हप्ता (EMI)</span>
                    <strong className="text-blue-700 font-mono text-xs">
                      ₹{(loan.monthlyInstallment || Math.round(loan.amount / (loan.tenureMonths || 1))).toLocaleString('en-IN')}
                    </strong>
                  </div>
                </div>

                {/* Loan Terms Badge Bar */}
                <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 flex-wrap">
                  <span className="font-semibold">
                    कालावधी: <strong className="text-slate-700">{loan.tenureMonths || 1} महिने</strong>
                  </span>
                  <span>•</span>
                  <span>
                    व्याज:{' '}
                    <strong className="text-slate-700">
                      {loan.interestRate}% ({loan.ratePeriod === 'MONTHLY' ? 'मासिक' : 'वार्षिक'})
                    </strong>
                  </span>
                  <span>•</span>
                  <span>
                    पद्धत:{' '}
                    <strong className="text-slate-700">
                      {loan.interestType === 'REDUCING_BALANCE' ? 'कमी होणारी शिल्लक (EMI)' : 'सपाट (Flat)'}
                    </strong>
                  </span>
                  {loan.totalPayable && (
                    <>
                      <span>•</span>
                      <span>
                        एकूण देय: <strong className="text-slate-800 font-mono">₹{loan.totalPayable.toLocaleString('en-IN')}</strong>
                      </span>
                    </>
                  )}
                </div>

                {loan.notes && (
                  <p className="text-[11px] text-slate-500 italic bg-amber-50/50 p-2 rounded-lg border border-amber-100">
                    टीप: {loan.notes}
                  </p>
                )}

                {/* Action Buttons Row */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* View Installments Schedule */}
                    <button
                      type="button"
                      onClick={() => openInstallmentsModal(loan)}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer min-h-[34px]"
                      title="हप्ते वेळापत्रक पहा"
                    >
                      <CalendarDays className="w-3.5 h-3.5" />
                      <span>हप्ते वेळापत्रक</span>
                    </button>

                    {/* Disbursed Loan Receipt View */}
                    {loan.disbursementTransactionId && (
                      <button
                        type="button"
                        onClick={() => setSelectedTxnForReceipt(loan.disbursementTransactionId)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer min-h-[34px]"
                        title="कर्ज वाटप पावती पहा"
                      >
                        <Receipt className="w-3 h-3 text-orange-600" />
                        <span>वाटप पावती</span>
                      </button>
                    )}

                    {/* Expand/Collapse Repayments History */}
                    {repayments.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedLoanId(isExpanded ? null : loan.id)}
                        className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer min-h-[34px]"
                      >
                        <History className="w-3 h-3 text-slate-400" />
                        <span>परतफेड ({repayments.length})</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Member Online Repayment Button */}
                    {!canManageLoans && loan.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={() => openOnlineRepaymentModal(loan)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-[11px] font-bold rounded-lg transition-all shadow-xs flex items-center gap-1 cursor-pointer min-h-[34px]"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>ऑनलाइन परतफेड</span>
                      </button>
                    )}

                    {/* President & Treasurer: Cash Repayment Button */}
                    {canManageLoans && loan.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLoanForRepayment(loan);
                          setRepaymentAmount('');
                          setRepaymentNotes('');
                          setRepaymentError(null);
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[11px] font-bold rounded-lg transition-all shadow-xs flex items-center gap-1 cursor-pointer min-h-[34px]"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        <span>रोख परतफेड</span>
                      </button>
                    )}

                    {/* President & Treasurer: Delete / Cancel Loan */}
                    {canManageLoans && loan.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={() => {
                          setLoanToDelete(loan);
                          setDeleteLoanError(null);
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer min-h-[34px] min-w-[34px] flex items-center justify-center border border-slate-200 hover:border-red-200"
                        title="कर्ज रद्द / हटवा"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Repayments Sub-list */}
                {isExpanded && repayments.length > 0 && (
                  <div className="pt-2 space-y-1.5 border-t border-dashed border-slate-200">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      परतफेड इतिहास
                    </span>
                    <div className="space-y-1">
                      {repayments.map((r) => (
                        <div
                          key={r.id}
                          className="p-2 bg-slate-50 rounded-lg flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-emerald-700 font-mono">
                              +₹{r.amount.toLocaleString('en-IN')}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              दिनांक: {r.repaymentDate?.slice(0, 10)} • पद्धत: {r.paymentMethod === 'ONLINE' ? 'ऑनलाइन' : 'रोख'} • नोंदणी: {r.actorName || 'अधिकारी'}
                            </span>
                            {r.notes && (
                              <span className="text-[10px] text-slate-500 block italic">
                                {r.notes}
                              </span>
                            )}
                          </div>
                          {r.transactionId && (
                            <button
                              type="button"
                              onClick={() => setSelectedTxnForReceipt(r.transactionId)}
                              className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-orange-600 text-[10px] font-bold rounded-md flex items-center gap-0.5 cursor-pointer"
                            >
                              <Receipt className="w-2.5 h-2.5" />
                              <span>पावती</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Create Loan Modal with Configurable Terms & Real-Time Preview */}
      {showCreateModal && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[calc(100%-0.5rem)] sm:max-w-[440px] w-full p-5 space-y-4 shadow-xl border border-slate-100 max-h-[90dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold">
                  <PlusCircle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    नवीन कर्ज वाटप (EMI व मुद्दल)
                  </h4>
                  <p className="text-[10px] text-slate-400">अधिकृत कर्ज वाटप व हप्ते वेळापत्रक</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors cursor-pointer -mr-2"
                aria-label="बंद करा"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLoanSubmit} className="space-y-3 text-xs">
              {/* Member Selection */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  सभासद निवडा <span className="text-red-500">*</span>
                </label>
                {membersLoading ? (
                  <div className="p-2 bg-slate-50 text-slate-400 text-center rounded-xl">
                    सदस्य यादी लोड होत आहे...
                  </div>
                ) : (
                  <select
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  >
                    <option value="">-- सभासद निवडा --</option>
                    {members
                      .filter((m) => m.id !== user?.id) // Do not allow self-disbursement in selector
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName} ({m.phone})
                        </option>
                      ))}
                  </select>
                )}
              </div>

              {/* Amount & Tenure (2 Columns) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    कर्ज मुद्दल रक्कम (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="100"
                    step="50"
                    placeholder="उदा. ५००००"
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    कालावधी (महिन्यांत) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={tenureMonths}
                    onChange={(e) => setTenureMonths(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  />
                </div>
              </div>

              {/* Interest Rate & Rate Period */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    व्याज दर (%) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    व्याज कालावधी
                  </label>
                  <select
                    value={ratePeriod}
                    onChange={(e) => setRatePeriod(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  >
                    <option value="ANNUAL">वार्षिक दर (Yearly p.a.)</option>
                    <option value="MONTHLY">मासिक दर (Monthly p.m.)</option>
                  </select>
                </div>
              </div>

              {/* Interest Type */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  व्याज पद्धत (Calculation Method)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInterestType('FLAT')}
                    className={`p-2 rounded-xl border text-center font-bold text-xs transition-all cursor-pointer ${
                      interestType === 'FLAT'
                        ? 'bg-orange-50 border-orange-500 text-orange-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    सपाट व्याज (Flat)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInterestType('REDUCING_BALANCE')}
                    className={`p-2 rounded-xl border text-center font-bold text-xs transition-all cursor-pointer ${
                      interestType === 'REDUCING_BALANCE'
                        ? 'bg-orange-50 border-orange-500 text-orange-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    कमी होणारी शिल्लक (EMI)
                  </button>
                </div>
              </div>

              {/* First Due Date & Loan Date */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    पहिला हप्ता दिनांक
                  </label>
                  <input
                    type="date"
                    value={firstDueDate}
                    onChange={(e) => setFirstDueDate(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    कर्ज वाटप दिनांक
                  </label>
                  <input
                    type="date"
                    value={loanDate}
                    onChange={(e) => setLoanDate(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  />
                </div>
              </div>

              {/* Real-time Calculation Summary Card */}
              {schedulePreview && (
                <div className="p-3 bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl border border-orange-200 space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs font-bold text-orange-900 border-b border-orange-200/60 pb-1">
                    <span>हप्ते गणित पूर्वदृष्य (EMI Calculation)</span>
                    {previewLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-600" />}
                  </div>
                  <div className="grid grid-cols-3 gap-1 pt-1 text-center">
                    <div className="p-1.5 bg-white rounded-xl border border-orange-100 shadow-2xs">
                      <span className="text-[10px] text-slate-500 block">दरमहा हप्ता</span>
                      <strong className="text-xs font-bold text-blue-700 font-mono">
                        ₹{schedulePreview.monthlyInstallment.toLocaleString('en-IN')}
                      </strong>
                    </div>
                    <div className="p-1.5 bg-white rounded-xl border border-orange-100 shadow-2xs">
                      <span className="text-[10px] text-slate-500 block">एकूण व्याज</span>
                      <strong className="text-xs font-bold text-amber-700 font-mono">
                        ₹{schedulePreview.totalInterest.toLocaleString('en-IN')}
                      </strong>
                    </div>
                    <div className="p-1.5 bg-white rounded-xl border border-orange-100 shadow-2xs">
                      <span className="text-[10px] text-slate-500 block">एकूण परतफेड</span>
                      <strong className="text-xs font-bold text-emerald-700 font-mono">
                        ₹{schedulePreview.totalPayable.toLocaleString('en-IN')}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  नोंद / कारण (पर्यायी)
                </label>
                <input
                  type="text"
                  placeholder="उदा. शेती अवजारे किंवा व्यवसाय सहाय्य"
                  value={loanNotes}
                  onChange={(e) => setLoanNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={createSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1 shadow-xs min-h-[44px] cursor-pointer"
                >
                  {createSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>कर्ज मंजूर करा</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* MODAL 2: Record Cash Loan Repayment (President & Treasurer) */}
      {selectedLoanForRepayment && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[calc(100%-0.5rem)] sm:max-w-[360px] w-full p-5 space-y-4 shadow-xl border border-slate-100 max-h-[85dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  <Banknote className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    {strings.loans.repayModalTitle}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    सदस्य: {selectedLoanForRepayment.memberName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLoanForRepayment(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors cursor-pointer -mr-2"
                aria-label="बंद करा"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Repayment Target Context */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">एकूण देय रक्कम:</span>
                <strong className="font-mono text-slate-800">
                  ₹{(selectedLoanForRepayment.totalPayable || selectedLoanForRepayment.amount).toLocaleString('en-IN')}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">शिल्लक येणे बाकी:</span>
                <strong className="font-mono text-amber-700">
                  ₹{selectedLoanForRepayment.outstandingBalance.toLocaleString('en-IN')}
                </strong>
              </div>
            </div>

            {repaymentError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span>{repaymentError}</span>
              </div>
            )}

            <form onSubmit={handleRepaySubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  परतफेड रक्कम (₹) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={selectedLoanForRepayment.outstandingBalance}
                  placeholder={`जास्तीत जास्त ₹${selectedLoanForRepayment.outstandingBalance}`}
                  value={repaymentAmount}
                  onChange={(e) => setRepaymentAmount(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  नोंद (पर्यायी)
                </label>
                <input
                  type="text"
                  placeholder="उदा. रोख हप्ता भरणा"
                  value={repaymentNotes}
                  onChange={(e) => setRepaymentNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-[10px] text-emerald-800 flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>{strings.loans.warningRepayNotice}</span>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLoanForRepayment(null)}
                  disabled={repaymentSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={repaymentSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1 shadow-xs min-h-[44px] cursor-pointer"
                >
                  {repaymentSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>रोख जमा नोंदवा</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* MODAL 3: Installments Schedule Modal */}
      {selectedLoanForInstallments && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[calc(100%-0.5rem)] sm:max-w-[520px] w-full p-5 space-y-4 shadow-xl border border-slate-100 max-h-[88dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                  <CalendarDays className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    कर्ज हप्ते वेळापत्रक (EMI Schedule)
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {selectedLoanForInstallments.memberName || 'सदस्य'} • एकूण मुद्दल: ₹{selectedLoanForInstallments.amount.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLoanForInstallments(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors cursor-pointer -mr-2"
                aria-label="बंद करा"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {installmentsLoading ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <span className="text-xs">हप्ते वेळापत्रक लोड होत आहे...</span>
              </div>
            ) : installments.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl">
                कोणतीही हप्ता नोंद सापडली नाही.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[10px] text-slate-500 uppercase font-bold">
                        <th className="py-2 px-1 text-center">हप्ता</th>
                        <th className="py-2 px-1">दिनांक</th>
                        <th className="py-2 px-1 text-right">मुद्दल</th>
                        <th className="py-2 px-1 text-right">व्याज</th>
                        <th className="py-2 px-1 text-right">एकूण EMI</th>
                        <th className="py-2 px-1 text-center">स्थिती</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {installments.map((inst) => {
                        const st = mapInstallmentStatus(inst.status);
                        return (
                          <tr key={inst.id} className="hover:bg-slate-50/80">
                            <td className="py-2.5 px-1 text-center font-bold text-slate-700 font-mono">
                              #{inst.installmentNumber}
                            </td>
                            <td className="py-2.5 px-1 font-mono text-[11px] text-slate-600">
                              {inst.dueDate}
                            </td>
                            <td className="py-2.5 px-1 text-right font-mono text-[11px] text-slate-600">
                              ₹{inst.principalAmount.toLocaleString('en-IN')}
                            </td>
                            <td className="py-2.5 px-1 text-right font-mono text-[11px] text-slate-500">
                              ₹{inst.interestAmount.toLocaleString('en-IN')}
                            </td>
                            <td className="py-2.5 px-1 text-right font-mono font-bold text-blue-700">
                              ₹{inst.totalAmount.toLocaleString('en-IN')}
                            </td>
                            <td className="py-2.5 px-1 text-center">
                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${st.cls}`}>
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setSelectedLoanForInstallments(null)}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-all min-h-[44px] cursor-pointer"
              >
                बंद करा
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* MODAL 4: Member Online Loan Repayment Modal */}
      {selectedLoanForOnlineRepay && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[calc(100%-0.5rem)] sm:max-w-[380px] w-full p-5 space-y-4 shadow-xl border border-slate-100 max-h-[88dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    ऑनलाइन कर्ज परतफेड
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    शिल्लक बाकी: ₹{selectedLoanForOnlineRepay.outstandingBalance.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLoanForOnlineRepay(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors cursor-pointer -mr-2"
                aria-label="बंद करा"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {onlineRepayStep === 'AMOUNT' && (
              <form onSubmit={handleGenerateOnlineOrder} className="space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    परतफेड रक्कम (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={selectedLoanForOnlineRepay.outstandingBalance}
                    value={onlineRepayAmount}
                    onChange={(e) => setOnlineRepayAmount(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    हप्ता रक्कम किंवा उपलब्ध रक्कम भरा (कमाल ₹{selectedLoanForOnlineRepay.outstandingBalance})
                  </span>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedLoanForOnlineRepay(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all min-h-[44px] cursor-pointer"
                  >
                    रद्द करा
                  </button>
                  <button
                    type="submit"
                    disabled={onlineRepaySubmitting}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1 shadow-xs min-h-[44px] cursor-pointer"
                  >
                    {onlineRepaySubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'QR कोड पहा'}
                  </button>
                </div>
              </form>
            )}

            {onlineRepayStep === 'QR' && onlineOrderDetails && (
              <div className="space-y-3 text-xs text-center">
                {onlineRepayNoticeSent ? (
                  <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2 text-emerald-800 animate-in fade-in">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-600" />
                    <h5 className="font-bold text-xs">पडताळणी सूचना नोंदवली गेली आहे!</h5>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      आपली ₹{onlineRepayAmount} ऑनलाइन भरणा पडताळणी सूचना मंडळाच्या अध्यक्षांना व खजिनदारांना पाठवली आहे. ते प्रत्यक्ष बँक खात्यात रक्कम तपासल्यानंतर पावती तयार होईल.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedLoanForOnlineRepay(null)}
                      className="w-full py-2 bg-emerald-600 text-white font-bold rounded-xl text-xs mt-2"
                    >
                      पूर्ण (बंद करा)
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="p-3 bg-blue-50/60 rounded-2xl border border-blue-100 space-y-2">
                      <span className="text-[11px] text-slate-600 block">
                        स्कॅन करा किंवा UPI अ‍ॅपद्वारे ₹{onlineRepayAmount} भरा:
                      </span>
                      {onlineOrderDetails.qrCodeData ? (
                        <div className="p-2 bg-white rounded-xl inline-block border border-slate-200 shadow-2xs">
                          <img
                            src={onlineOrderDetails.qrCodeData}
                            alt="Mandal Payment QR"
                            className="w-36 h-36 object-contain mx-auto"
                          />
                        </div>
                      ) : (
                        <div className="w-36 h-36 mx-auto bg-slate-100 border border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400">
                          <QrCode className="w-8 h-8 text-slate-400 mb-1" />
                          <span className="text-[10px]">QR उपलब्ध नाही</span>
                        </div>
                      )}

                      {onlineOrderDetails.upiId && (
                        <div className="p-2 bg-white rounded-xl border border-slate-200 text-slate-700 font-mono text-[11px] select-all">
                          {onlineOrderDetails.upiId}
                        </div>
                      )}
                    </div>

                    <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-[10px] text-amber-800 text-left flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        पेमेंट पूर्ण केल्यानंतर खालील बटण दाबून पडताळणी सूचना पाठवा. अध्यक्ष/खजिनदार रक्कम पडताळणी करून हप्ता जमा करतील.
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleConfirmMemberPaidNotice}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer min-h-[46px] flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>मी पेमेंट केले — पडताळणीसाठी पाठवा</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        </ModalPortal>
      )}

      {/* MODAL 5: Delete / Cancel Loan Confirmation */}
      {loanToDelete && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[340px] w-full p-5 space-y-4 shadow-xl border border-slate-100 my-auto">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">कर्ज हटवा / रद्द करा</h4>
                <p className="text-[11px] text-slate-500">{loanToDelete.memberName}</p>
              </div>
            </div>

            {loanToDelete.totalRepaid > 0 ? (
              <div className="space-y-3">
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    या कर्जावर आधीच ₹{loanToDelete.totalRepaid} परतफेड झालेली आहे. परतफेड असलेले कर्ज हटवता किंवा रद्द करता येत नाही.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLoanToDelete(null);
                    setDeleteLoanError(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all min-h-[44px] cursor-pointer"
                >
                  समजले (बंद करा)
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  {loanToDelete.memberName} यांना दिलेले <strong>₹{loanToDelete.amount}</strong> चे कर्ज रद्द/हटवले जाईल.
                </p>

                {deleteLoanError && (
                  <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                    {deleteLoanError}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setLoanToDelete(null);
                      setDeleteLoanError(null);
                    }}
                    disabled={deleteLoanLoading}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px] cursor-pointer"
                  >
                    मागे जा
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDeleteLoan}
                    disabled={deleteLoanLoading}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow-xs disabled:opacity-50 flex items-center justify-center gap-1.5 min-h-[44px] cursor-pointer"
                  >
                    {deleteLoanLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'कर्ज रद्द करा'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Authentic Receipt Modal */}
      <ReceiptModal
        transactionId={selectedTxnForReceipt}
        isOpen={!!selectedTxnForReceipt}
        onClose={() => setSelectedTxnForReceipt(null)}
      />
    </div>
  );
};
