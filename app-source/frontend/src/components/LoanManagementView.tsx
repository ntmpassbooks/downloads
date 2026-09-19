import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import {
  Loan,
  getMandalLoans,
  getMyLoans,
  createLoan,
  recordCashLoanRepayment,
  deleteLoan,
} from '../api/loans.js';
import { getMembers, Member } from '../api/members.js';
import { ReceiptModal } from './ReceiptModal.js';
import { strings } from '../i18n/mr.js';
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
} from 'lucide-react';

export const LoanManagementView: React.FC = () => {
  const { user } = useAuth();
  const isPresident = user?.role === 'PRESIDENT';
  const isTreasurer = user?.role === 'TREASURER';
  const canManageLoans = isPresident || isTreasurer;

  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'CLOSED'>('ALL');

  // Expanded repayment history per loan
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);

  // New Loan Modal State (President Only)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [loanDate, setLoanDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loanNotes, setLoanNotes] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Cash Repayment Modal State (President & Treasurer)
  const [selectedLoanForRepayment, setSelectedLoanForRepayment] = useState<Loan | null>(null);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentSubmitting, setRepaymentSubmitting] = useState(false);
  const [repaymentError, setRepaymentError] = useState<string | null>(null);

  // Receipt Modal State
  const [selectedTxnForReceipt, setSelectedTxnForReceipt] = useState<string | null>(null);

  // Delete / Cancel Loan State (President & Treasurer)
  const [loanToDelete, setLoanToDelete] = useState<Loan | null>(null);
  const [deleteLoanLoading, setDeleteLoanLoading] = useState(false);
  const [deleteLoanError, setDeleteLoanError] = useState<string | null>(null);

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

  // Load members for loan creation if President
  const openCreateModal = async () => {
    setShowCreateModal(true);
    setCreateError(null);
    setSelectedMemberId('');
    setLoanAmount('');
    setLoanNotes('');
    setLoanDate(new Date().toISOString().split('T')[0]);

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

  const handleCreateLoanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const parsedAmount = parseInt(loanAmount, 10);
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
        loanDate: loanDate || undefined,
        notes: loanNotes.trim() || undefined,
      });

      if (res.success) {
        setShowCreateModal(false);
        setSuccessFeedback(strings.loans.createSuccess);
        setTimeout(() => setSuccessFeedback(null), 4000);
        await fetchLoans();
      } else {
        setCreateError(res.error || 'कर्ज वाटप नोंद अयशस्वी.');
      }
    } catch (err: any) {
      setCreateError(err.message || 'सर्व्हर त्रुटी आली.');
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
        setSuccessFeedback(strings.loans.repaySuccess);
        setTimeout(() => setSuccessFeedback(null), 4000);
        await fetchLoans();
        // Automatically open receipt for the repayment transaction
        if (res.data.transaction?.id) {
          setSelectedTxnForReceipt(res.data.transaction.id);
        }
      } else {
        setRepaymentError(res.error || 'परतफेड नोंद अयशस्वी.');
      }
    } catch (err: any) {
      setRepaymentError(err.message || 'सर्व्हर त्रुटी आली.');
    } finally {
      setRepaymentSubmitting(false);
    }
  };

  // Handle Delete / Cancel Loan (President & Treasurer)
  const handleConfirmDeleteLoan = async () => {
    if (!loanToDelete) return;
    setDeleteLoanLoading(true);
    setDeleteLoanError(null);
    try {
      const res = await deleteLoan(loanToDelete.id);
      if (res.success) {
        const memberName = loanToDelete.memberName || 'सभासद';
        const action = res.data?.action;
        setLoanToDelete(null);
        setSuccessFeedback(
          action === 'CANCELLED'
            ? `${memberName} यांचे ₹${loanToDelete.amount} चे कर्ज यशस्वीरीत्या रद्द केले गेले. लेजरमधील व्यवहार रद्द म्हणून नोंदवला गेला.`
            : `${memberName} यांची कर्ज नोंद यशस्वीरीत्या हटवली गेली.`
        );
        setTimeout(() => setSuccessFeedback(null), 5000);
        await fetchLoans();
      } else {
        setDeleteLoanError(res.error || 'कर्ज हटवताना त्रुटी आली.');
      }
    } catch (err: any) {
      setDeleteLoanError(err.message || 'सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setDeleteLoanLoading(false);
    }
  };

  // Filtered loans list
  const filteredLoans = loans.filter((loan) => {
    if (statusFilter !== 'ALL' && loan.status !== statusFilter) {
      return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const name = (loan.memberName || '').toLowerCase();
      const phone = (loan.memberPhone || '').toLowerCase();
      const txn = (loan.disbursementTransactionNumber || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || txn.includes(q);
    }
    return true;
  });

  // Calculate high-level summary KPIs
  const totalPrincipal = loans.reduce((acc, l) => acc + l.amount, 0);
  const totalRepaid = loans.reduce((acc, l) => acc + l.totalRepaid, 0);
  const totalOutstanding = loans.reduce((acc, l) => (l.status === 'ACTIVE' ? acc + l.outstandingBalance : acc), 0);
  const activeCount = loans.filter((l) => l.status === 'ACTIVE').length;

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
                {canManageLoans ? 'उधार वाटप, रोख परतफेड व अधिकृत हिशोब' : 'आपल्या खात्यातील मंजूर कर्ज व परतफेड इतिहास'}
              </p>
            </div>
          </div>

          {canManageLoans && (
            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center gap-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-xs shrink-0"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>नवीन कर्ज</span>
            </button>
          )}
        </div>

        {/* Success Feedback Alert */}
        {successFeedback && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successFeedback}</span>
          </div>
        )}

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
            <span className="text-[10px] text-slate-500 block">शिल्लक येणे</span>
            <strong className="text-sm font-bold text-amber-700 font-mono">
              ₹{totalOutstanding.toLocaleString('en-IN')}
            </strong>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        {loans.length > 0 && (
          <div className="pt-2 space-y-2 border-t border-slate-100">
            {canManageLoans && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
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
                className={`px-3 py-1.5 rounded-lg border transition-all ${
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
                className={`px-3 py-1.5 rounded-lg border transition-all ${
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
                className={`px-3 py-1.5 rounded-lg border transition-all ${
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
        /* Standardized Clean Empty State */
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
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        दिनांक: {loan.loanDate}
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

                {/* Financial 3-box Grid */}
                <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 block">{strings.loans.principalAmount}</span>
                    <strong className="text-slate-800 font-mono text-xs">
                      ₹{loan.amount.toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">{strings.loans.totalRepaid}</span>
                    <strong className="text-emerald-700 font-mono text-xs">
                      ₹{loan.totalRepaid.toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">{strings.loans.outstandingBalance}</span>
                    <strong className="text-amber-700 font-mono text-xs">
                      ₹{loan.outstandingBalance.toLocaleString('en-IN')}
                    </strong>
                  </div>
                </div>

                {loan.notes && (
                  <p className="text-[11px] text-slate-500 italic bg-amber-50/50 p-2 rounded-lg border border-amber-100">
                    टीप: {loan.notes}
                  </p>
                )}

                {/* Action Buttons Row */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    {/* Disbursed Loan Receipt View */}
                    {loan.disbursementTransactionId && (
                      <button
                        type="button"
                        onClick={() => setSelectedTxnForReceipt(loan.disbursementTransactionId)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1"
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
                        className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg transition-colors flex items-center gap-1"
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
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[11px] font-bold rounded-lg transition-all shadow-xs flex items-center gap-1"
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
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center border border-slate-200 hover:border-red-200"
                      title="कर्ज रद्द / हटवा"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
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
                              दिनांक: {r.repaymentDate} • नोंदणी: {r.actorName || 'अध्यक्ष/खजिनदार'}
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
                              className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-orange-600 text-[10px] font-bold rounded-md flex items-center gap-0.5"
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

      {/* MODAL 1: Create Loan Modal (President Only) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[calc(100%-0.5rem)] sm:max-w-[360px] w-full p-5 space-y-4 shadow-xl border border-slate-100 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold">
                  <PlusCircle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    {strings.loans.createModalTitle}
                  </h4>
                  <p className="text-[10px] text-slate-400">अधिकृत कर्ज वाटप नोंदणी</p>
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
              {/* Member Selection Dropdown */}
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
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName} ({m.phone})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Amount Input */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  कर्ज मुद्दल रक्कम (₹) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="50"
                  placeholder="उदा. ५०००"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>

              {/* Loan Date */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  कर्ज वितरण दिनांक <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={loanDate}
                  onChange={(e) => setLoanDate(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  {strings.loans.notesLabel}
                </label>
                <input
                  type="text"
                  placeholder={strings.loans.notesPlaceholder}
                  value={loanNotes}
                  onChange={(e) => setLoanNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>

              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-[10px] text-amber-800 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>{strings.loans.warningLoanNotice}</span>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={createSubmitting}
                  className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all disabled:opacity-50"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="flex-1 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1 shadow-xs"
                >
                  {createSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>कर्ज मंजूर करा</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Record Cash Loan Repayment Modal (President & Treasurer) */}
      {selectedLoanForRepayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[calc(100%-0.5rem)] sm:max-w-[360px] w-full p-5 space-y-4 shadow-xl border border-slate-100 max-h-[85dvh] overflow-y-auto">
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
                <span className="text-slate-500">एकूण कर्ज मुद्दल:</span>
                <strong className="font-mono text-slate-800">
                  ₹{selectedLoanForRepayment.amount.toLocaleString('en-IN')}
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
                  {strings.loans.notesLabel}
                </label>
                <input
                  type="text"
                  placeholder="उदा. पहिला रोख हप्ता भरणा"
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
                  className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all disabled:opacity-50"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={repaymentSubmitting}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1 shadow-xs"
                >
                  {repaymentSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>रोख जमा नोंदवा</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Delete / Cancel Loan Confirmation Modal */}
      {loanToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-[340px] w-full p-5 space-y-4 shadow-xl border border-slate-100">
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
                    या कर्जावर आधीच ₹{loanToDelete.totalRepaid} रोख परतफेड झालेली आहे. परतफेड असलेले कर्ज हटवता किंवा रद्द करता येत नाही. आर्थिक लेजर व पावत्यांचे संरक्षण आवश्यक आहे.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLoanToDelete(null);
                    setDeleteLoanError(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
                >
                  समजले (बंद करा)
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  {loanToDelete.memberName} यांना दिलेले <strong>₹{loanToDelete.amount}</strong> चे कर्ज रद्द/हटवले जाईल. आर्थिक लेजरमधील वाटप व्यवहार रद्द म्हणून नोंदवला जाईल.
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
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    मागे जा
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDeleteLoan}
                    disabled={deleteLoanLoading}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {deleteLoanLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'कर्ज रद्द करा'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
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
