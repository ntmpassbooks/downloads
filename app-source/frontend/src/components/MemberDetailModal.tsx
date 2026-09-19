import React, { useState, useEffect } from 'react';
import { Member, updateMemberStatus, updateMemberRole, deleteMember, getMemberPin } from '../api/members.js';
import {
  BishiConfig,
  BishiRecord,
  getMemberBishiConfig,
  setMemberBishiConfig,
  getMemberBishiRecords,
} from '../api/bishi.js';
import {
  MemberPassbookResponse,
  recordCashBishiPayment,
  getMemberPassbook,
} from '../api/ledger.js';
import {
  Loan,
  createLoan,
  recordCashLoanRepayment,
  getMemberLoans,
} from '../api/loans.js';
import { useAuth } from '../context/AuthContext.js';
import { RoleBadge } from './RoleBadge.js';
import { ReceiptModal } from './ReceiptModal.js';
import { SecurePinViewModal } from './SecurePinViewModal.js';
import { strings } from '../i18n/mr.js';
import {
  X,
  Phone,
  Calendar,
  Building2,
  Power,
  AlertTriangle,
  Loader2,
  BookOpen,
  Coins,
  Receipt,
  Crown,
  Award,
  CheckCircle2,
  CalendarClock,
  History,
  Save,
  Banknote,
  PlusCircle,
  HandCoins,
  Check,
  Trash2,
  KeyRound,
} from 'lucide-react';

interface MemberDetailModalProps {
  member: Member | null;
  mandalName?: string;
  mandalCode?: string;
  isOpen: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
}

export const MemberDetailModal: React.FC<MemberDetailModalProps> = ({
  member,
  mandalName = '',
  mandalCode = '',
  isOpen,
  onClose,
  onStatusChanged,
}) => {
  const { user } = useAuth();
  const isPresident = user?.role === 'PRESIDENT';
  const canRecordPayment = user?.role === 'PRESIDENT' || user?.role === 'TREASURER';

  const [showConfirm, setShowConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [isPinViewModalOpen, setIsPinViewModalOpen] = useState(false);
  const [showRoleConfirm, setShowRoleConfirm] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleSuccess, setRoleSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFutureTab, setActiveFutureTab] = useState<'passbook' | 'bishi' | 'loans'>('passbook');

  // Bishi state
  const [bishiConfig, setBishiConfig] = useState<BishiConfig | null>(null);
  const [bishiRecords, setBishiRecords] = useState<BishiRecord[]>([]);
  const [bishiLoading, setBishiLoading] = useState(false);
  const [bishiAmount, setBishiAmount] = useState('');
  const [bishiDueDay, setBishiDueDay] = useState('');
  const [bishiSaving, setBishiSaving] = useState(false);
  const [bishiSuccess, setBishiSuccess] = useState<string | null>(null);
  const [bishiError, setBishiError] = useState<string | null>(null);

  // Passbook state
  const [passbookData, setPassbookData] = useState<MemberPassbookResponse | null>(null);
  const [passbookLoading, setPassbookLoading] = useState(false);
  const [passbookError, setPassbookError] = useState<string | null>(null);
  const [passbookFilter, setPassbookFilter] = useState<'ALL' | 'BISHI' | 'LOAN' | 'PAID'>('ALL');
  const [selectedTxnForReceipt, setSelectedTxnForReceipt] = useState<string | null>(null);

  // Cash payment confirmation modal state
  const [selectedRecordForPayment, setSelectedRecordForPayment] = useState<BishiRecord | null>(null);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);

  // Loans state
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState<string | null>(null);

  // New Loan Modal state (President only)
  const [showCreateLoanModal, setShowCreateLoanModal] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loanDate, setLoanDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loanNotes, setLoanNotes] = useState('');
  const [createLoanSubmitting, setCreateLoanSubmitting] = useState(false);
  const [createLoanError, setCreateLoanError] = useState<string | null>(null);
  const [createLoanSuccess, setCreateLoanSuccess] = useState<string | null>(null);

  // Loan Repayment Modal state (President / Treasurer)
  const [selectedLoanForRepayment, setSelectedLoanForRepayment] = useState<Loan | null>(null);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentSubmitting, setRepaymentSubmitting] = useState(false);
  const [repaymentError, setRepaymentError] = useState<string | null>(null);
  const [repaymentSuccess, setRepaymentSuccess] = useState<string | null>(null);

  const fetchLoansData = async () => {
    if (!member) return;
    setLoansLoading(true);
    setLoansError(null);
    try {
      const res = await getMemberLoans(member.id);
      if (res.success && res.data) {
        setLoans(res.data);
      } else {
        setLoansError(res.error || 'कर्ज माहिती आणण्यात अडचण आली.');
      }
    } catch {
      setLoansError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setLoansLoading(false);
    }
  };

  const handleOpenRepaymentModal = (loan: Loan) => {
    setSelectedLoanForRepayment(loan);
    setRepaymentAmount('');
    setRepaymentNotes('');
    setRepaymentError(null);
    setRepaymentSuccess(null);
  };

  const handleCreateLoanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    const amt = Number(loanAmount);
    if (!amt || amt <= 0) {
      setCreateLoanError(strings.loans.minAmountError);
      return;
    }
    setCreateLoanSubmitting(true);
    setCreateLoanError(null);
    setCreateLoanSuccess(null);
    try {
      const res = await createLoan({
        memberId: member.id,
        amount: amt,
        loanDate: loanDate || undefined,
        notes: loanNotes.trim() || undefined,
      });
      if (res.success && res.data) {
        setCreateLoanSuccess(strings.loans.createSuccess);
        setLoanAmount('');
        setLoanNotes('');
        fetchLoansData();
        fetchPassbookData();
        setTimeout(() => {
          setShowCreateLoanModal(false);
          setCreateLoanSuccess(null);
        }, 1200);
      } else {
        setCreateLoanError(res.error || strings.errors.generic);
      }
    } catch (err: any) {
      setCreateLoanError(err.message || strings.errors.networkError);
    } finally {
      setCreateLoanSubmitting(false);
    }
  };

  const handleRecordRepaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoanForRepayment) return;
    const amt = Number(repaymentAmount);
    if (!amt || amt <= 0) {
      setRepaymentError(strings.loans.minAmountError);
      return;
    }
    if (amt > selectedLoanForRepayment.outstandingBalance) {
      setRepaymentError(strings.loans.overpaymentError);
      return;
    }
    setRepaymentSubmitting(true);
    setRepaymentError(null);
    setRepaymentSuccess(null);
    try {
      const res = await recordCashLoanRepayment(selectedLoanForRepayment.id, {
        amount: amt,
        notes: repaymentNotes.trim() || undefined,
      });
      if (res.success && res.data) {
        setRepaymentSuccess(strings.loans.repaySuccess);
        setRepaymentAmount('');
        setRepaymentNotes('');
        fetchLoansData();
        fetchPassbookData();
        const txnId = res.data.transaction.id;
        setTimeout(() => {
          setSelectedLoanForRepayment(null);
          setRepaymentSuccess(null);
          if (txnId) {
            setSelectedTxnForReceipt(txnId);
          }
        }, 1200);
      } else {
        setRepaymentError(res.error || strings.errors.generic);
      }
    } catch (err: any) {
      setRepaymentError(err.message || strings.errors.networkError);
    } finally {
      setRepaymentSubmitting(false);
    }
  };

  const fetchBishiData = async () => {
    if (!member) return;
    setBishiLoading(true);
    setBishiError(null);
    try {
      const [cfgRes, recsRes] = await Promise.all([
        getMemberBishiConfig(member.id),
        getMemberBishiRecords(member.id),
      ]);
      if (cfgRes.success) {
        setBishiConfig(cfgRes.data || null);
        if (cfgRes.data) {
          setBishiAmount(String(cfgRes.data.monthlyAmount));
          setBishiDueDay(String(cfgRes.data.dueDay));
        } else {
          setBishiAmount('');
          setBishiDueDay('');
        }
      }
      if (recsRes.success && recsRes.data) {
        setBishiRecords(recsRes.data);
      }
    } catch {
      setBishiError('बीसी माहिती आणण्यात अडचण आली.');
    } finally {
      setBishiLoading(false);
    }
  };

  const fetchPassbookData = async () => {
    if (!member) return;
    setPassbookLoading(true);
    setPassbookError(null);
    try {
      const res = await getMemberPassbook(member.id);
      if (res.success && res.data) {
        setPassbookData(res.data);
      } else {
        setPassbookError(res.error || 'पासबुक माहिती आणण्यात अडचण आली.');
      }
    } catch {
      setPassbookError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setPassbookLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && member) {
      if (activeFutureTab === 'bishi') {
        fetchBishiData();
      } else if (activeFutureTab === 'passbook') {
        fetchPassbookData();
      } else if (activeFutureTab === 'loans') {
        fetchLoansData();
      }
    }
  }, [isOpen, member?.id, activeFutureTab]);

  const handleOpenPaymentModal = (rec: BishiRecord) => {
    setSelectedRecordForPayment(rec);
    setPaymentNotes('');
    setPaymentError(null);
    setPaymentSuccess(null);
  };

  const handleConfirmCashPayment = async () => {
    if (!selectedRecordForPayment) return;
    setPaymentSubmitting(true);
    setPaymentError(null);
    setPaymentSuccess(null);

    try {
      const res = await recordCashBishiPayment(
        selectedRecordForPayment.id,
        selectedRecordForPayment.expectedAmount,
        paymentNotes.trim() || undefined
      );

      if (res.success && res.data) {
        setPaymentSuccess(strings.payment.success);
        fetchBishiData();
        fetchPassbookData();
        onStatusChanged();
        setTimeout(() => {
          setSelectedRecordForPayment(null);
          setPaymentSuccess(null);
        }, 1200);
      } else {
        setPaymentError(res.error || 'पेमेंट नोंदणी करताना त्रुटी झाली.');
      }
    } catch {
      setPaymentError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const handleSaveBishiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    const amountNum = parseInt(bishiAmount, 10);
    const dayNum = parseInt(bishiDueDay, 10);

    if (isNaN(amountNum) || amountNum <= 0) {
      setBishiError('कृपया वैध मासिक बीसी रक्कम प्रविष्ट करा (किमान ₹१००).');
      return;
    }
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      setBishiError('कृपया वैध देय दिवस प्रविष्ट करा (१ ते ३१ दरम्यान).');
      return;
    }

    setBishiSaving(true);
    setBishiError(null);
    setBishiSuccess(null);
    try {
      const res = await setMemberBishiConfig(member.id, amountNum, dayNum);
      if (res.success && res.data) {
        setBishiConfig(res.data);
        setBishiSuccess(strings.bishi.saveSuccess);
        setTimeout(() => setBishiSuccess(null), 3000);
      } else {
        setBishiError(res.error || 'बीसी रचना जतन करताना त्रुटी झाली.');
      }
    } catch {
      setBishiError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setBishiSaving(false);
    }
  };

  if (!isOpen || !member) return null;

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('mr-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const handleToggleStatus = async () => {
    setLoading(true);
    setError(null);
    const newStatus = !member.isActive;

    try {
      const res = await updateMemberStatus(member.id, newStatus);
      if (res.success) {
        setShowConfirm(false);
        onStatusChanged();
        onClose();
      } else {
        setError(res.error || 'स्थिती बदलण्यात त्रुटी निर्माण झाली.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignTreasurer = async () => {
    setRoleLoading(true);
    setError(null);
    setRoleSuccess(null);

    try {
      const res = await updateMemberRole(member.id, 'TREASURER');
      if (res.success) {
        setRoleSuccess(strings.members.assignTreasurerSuccess);
        setShowRoleConfirm(false);
        onStatusChanged();
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setError(res.error || 'खजिनदार नियुक्ती करताना त्रुटी निर्माण झाली.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setRoleLoading(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!member || deleteLoading) return;
    setDeleteLoading(true);
    setError(null);
    try {
      const res = await deleteMember(member.id);
      if (res.success && res.data) {
        setDeleteMessage(res.message);
        setShowDeleteConfirm(false);
        onStatusChanged();
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setError(res.error || 'सदस्य हटवताना त्रुटी निर्माण झाली.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!isOpen || !member) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-3">
      <div className="w-full max-w-[calc(100%-0.5rem)] sm:max-w-[380px] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85dvh] animate-in slide-in-from-bottom duration-200">
        
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold">{strings.members.detailModalTitle}</h3>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 active:scale-95 transition-all text-white cursor-pointer -mr-2"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {error}
            </div>
          )}

          {deleteMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{deleteMessage}</span>
            </div>
          )}

          {/* Member Card Profile */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-base font-bold text-slate-800 truncate">{member.fullName}</h4>
                <RoleBadge role={member.role} />
              </div>

              <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-mono font-medium">+91 {member.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>{mandalName || 'मंडळ'}{mandalCode ? ` (${mandalCode})` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{strings.members.createdAt}: <strong>{formatDate(member.createdAt)}</strong></span>
                </div>
              </div>
            </div>

            {/* Status indicator */}
            <div className="shrink-0 flex flex-col items-end">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                  member.isActive
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : 'bg-red-100 text-red-900 border border-red-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${member.isActive ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                {member.isActive ? strings.members.statusActive : strings.members.statusInactive}
              </span>
            </div>
          </div>

          {/* Financial Records Navigation */}
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              आर्थिक नोंदी व व्यवस्थापन
            </h5>

            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-semibold text-slate-600">
              <button
                onClick={() => setActiveFutureTab('passbook')}
                className={`py-1.5 rounded-lg transition-all flex flex-col items-center gap-0.5 ${
                  activeFutureTab === 'passbook' ? 'bg-white text-orange-600 shadow-xs' : ''
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>पासबुक</span>
              </button>
              <button
                onClick={() => setActiveFutureTab('bishi')}
                className={`py-1.5 rounded-lg transition-all flex flex-col items-center gap-0.5 ${
                  activeFutureTab === 'bishi' ? 'bg-white text-orange-600 shadow-xs' : ''
                }`}
              >
                <Coins className="w-3.5 h-3.5" />
                <span>बीशी</span>
              </button>
              <button
                onClick={() => setActiveFutureTab('loans')}
                className={`py-1.5 rounded-lg transition-all flex flex-col items-center gap-0.5 ${
                  activeFutureTab === 'loans' ? 'bg-white text-orange-600 shadow-xs' : ''
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>कर्ज</span>
              </button>
            </div>

            {/* Real Bishi Module View */}
            {activeFutureTab === 'bishi' && (
              <div className="space-y-3 pt-1">
                {/* Error/Success Messages */}
                {bishiError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                    {bishiError}
                  </div>
                )}
                {bishiSuccess && (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{bishiSuccess}</span>
                  </div>
                )}

                {/* Configuration Card */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                        <Coins className="w-4 h-4" />
                      </div>
                      <div>
                        <h6 className="text-xs font-bold text-slate-800">
                          {strings.bishi.configTitle}
                        </h6>
                        <span className="text-[10px] text-slate-500">
                          {bishiConfig
                            ? 'मासिक हप्ता रचना सक्रिय आहे'
                            : strings.bishi.notConfigured}
                        </span>
                      </div>
                    </div>

                    {bishiConfig && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-200">
                        सक्रिय
                      </span>
                    )}
                  </div>

                  {/* If President / Treasurer: Edit/Set Form */}
                  {canRecordPayment ? (
                    <form onSubmit={handleSaveBishiConfig} className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        {/* Monthly Amount Input */}
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            {strings.bishi.monthlyAmount}
                          </label>
                          <div className="relative flex items-center">
                            <span className="absolute left-2.5 text-xs font-bold text-slate-400">₹</span>
                            <input
                              type="number"
                              value={bishiAmount}
                              onChange={(e) => setBishiAmount(e.target.value)}
                              placeholder={strings.bishi.monthlyAmountPlaceholder}
                              min={100}
                              max={1000000}
                              disabled={bishiSaving || !member.isActive}
                              className="w-full pl-6 pr-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all disabled:opacity-50"
                            />
                          </div>
                        </div>

                        {/* Due Day Input */}
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            {strings.bishi.dueDay}
                          </label>
                          <input
                            type="number"
                            value={bishiDueDay}
                            onChange={(e) => setBishiDueDay(e.target.value)}
                            placeholder={strings.bishi.dueDayPlaceholder}
                            min={1}
                            max={31}
                            disabled={bishiSaving || !member.isActive}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all disabled:opacity-50"
                          />
                        </div>
                      </div>

                      {member.isActive ? (
                        <button
                          type="submit"
                          disabled={bishiSaving}
                          className="w-full py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-[0.98] text-white text-xs font-bold rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                        >
                          {bishiSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              <span>{strings.bishi.saveConfigButton}</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <p className="text-[11px] text-red-600 text-center">
                          निष्क्रिय सदस्यासाठी बीसी रचना बदलता येत नाही.
                        </p>
                      )}
                    </form>
                  ) : (
                    /* Read-Only display for non-president */
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 bg-white rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">हप्ता रक्कम</span>
                        <strong className="text-slate-800 text-sm">
                          {bishiConfig ? `₹${bishiConfig.monthlyAmount}` : 'सेट नाही'}
                        </strong>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">देय दिवस</span>
                        <strong className="text-slate-800 text-sm">
                          {bishiConfig ? `दर महिन्याची ${bishiConfig.dueDay} तारीख` : 'सेट नाही'}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Historical Monthly Records */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h6 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-slate-500" />
                      <span>{strings.bishi.recordsTitle}</span>
                    </h6>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {bishiRecords.length} नोंदी
                    </span>
                  </div>

                  {bishiLoading ? (
                    <div className="py-6 flex justify-center text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
                    </div>
                  ) : bishiRecords.length === 0 ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-1">
                      <CalendarClock className="w-5 h-5 text-slate-300 mx-auto" />
                      <p className="text-xs font-semibold text-slate-600">
                        {strings.bishi.noRecords}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        अध्यक्षांनी चालू महिन्याचे बीसी चक्र सुरू केल्यानंतर येथे नोंदी दिसतील.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                      {bishiRecords.map((r) => (
                        <div
                          key={r.id}
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <div className="font-bold text-slate-800 flex items-center gap-1.5">
                              <span>महिना: {r.monthYear}</span>
                              <span className="text-[10px] font-mono text-slate-400">
                                (देय: {r.dueDate})
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              हप्ता: <strong className="text-slate-700">₹{r.expectedAmount}</strong>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            {r.status === 'PAID' ? (
                              <div className="space-y-0.5">
                                <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                                  {strings.bishi.statusPaid}
                                </span>
                                {r.paidDate && (
                                  <div className="text-[9px] text-slate-500">
                                    {formatDate(r.paidDate)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                                  {r.status === 'PENDING' ? strings.bishi.statusPending : r.status}
                                </span>
                                {canRecordPayment && r.status === 'PENDING' && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPaymentModal(r)}
                                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-[10px] rounded-lg shadow-xs flex items-center gap-1 transition-all"
                                  >
                                    <Banknote className="w-3 h-3" />
                                    <span>{strings.payment.recordCashButton}</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Payment Constraint Notice */}
                  <p className="text-[10px] text-slate-400 text-center italic pt-1">
                    {strings.bishi.paymentNotice}
                  </p>
                </div>
              </div>
            )}

            {/* Real Passbook Tab View */}
            {activeFutureTab === 'passbook' && (
              <div className="space-y-3 pt-1">
                {/* Passbook Header Card */}
                <div className="p-3.5 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl flex items-center justify-between shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <h6 className="text-xs font-bold">{strings.passbook.title}</h6>
                      <p className="text-[10px] text-slate-300">अधिकृत डिजिटल नोंदी</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">{strings.passbook.totalPaid}</span>
                    <span className="text-sm font-bold text-emerald-400 font-mono">
                      ₹{passbookData?.totalPaid ?? 0}
                    </span>
                  </div>
                </div>

                {passbookError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                    {passbookError}
                  </div>
                )}

                {/* Category Filter Chips */}
                {passbookData && passbookData.transactions.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-0.5 pb-1">
                    <button
                      type="button"
                      onClick={() => setPassbookFilter('ALL')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        passbookFilter === 'ALL'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {strings.passbook.filterAll}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassbookFilter('BISHI')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        passbookFilter === 'BISHI'
                          ? 'bg-orange-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {strings.passbook.filterBishi}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassbookFilter('LOAN')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        passbookFilter === 'LOAN'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {strings.passbook.filterLoan}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassbookFilter('PAID')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        passbookFilter === 'PAID'
                          ? 'bg-emerald-700 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {strings.passbook.filterConfirmed}
                    </button>
                  </div>
                )}

                {passbookLoading ? (
                  <div className="py-8 flex justify-center text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
                  </div>
                ) : !passbookData || passbookData.transactions.length === 0 ? (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-1.5">
                    <BookOpen className="w-6 h-6 text-slate-300 mx-auto" />
                    <h6 className="text-xs font-bold text-slate-700">{strings.passbook.emptyTitle}</h6>
                    <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                      {strings.passbook.emptyDesc}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                    {passbookData.transactions
                      .filter((t) => {
                        if (passbookFilter === 'BISHI') return t.transactionType === 'BISHI_PAYMENT';
                        if (passbookFilter === 'LOAN')
                          return t.transactionType === 'LOAN_DISBURSED' || t.transactionType === 'LOAN_REPAYMENT';
                        if (passbookFilter === 'PAID') return t.status === 'CONFIRMED';
                        return true;
                      })
                      .map((t) => (
                        <div
                          key={t.id}
                          className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs space-y-1.5"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-1.5">
                              {t.transactionType === 'LOAN_DISBURSED' ? (
                                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 rounded font-bold text-[10px]">
                                  {strings.passbook.typeLoanDisbursed}
                                </span>
                              ) : t.transactionType === 'LOAN_REPAYMENT' ? (
                                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-[10px]">
                                  {strings.passbook.typeLoanRepayment}
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-[10px]">
                                  {strings.passbook.typeBishi}
                                </span>
                              )}
                              <span className="text-[11px] font-semibold text-slate-700">
                                {formatDate(t.transactionDate)}
                              </span>
                            </div>
                            <span
                              className={`text-xs font-bold font-mono ${
                                t.transactionType === 'LOAN_DISBURSED'
                                  ? 'text-rose-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {t.transactionType === 'LOAN_DISBURSED' ? `-₹${t.amount}` : `+₹${t.amount}`}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                            <div className="flex items-center gap-1">
                              <span>पद्धत: <strong>{strings.passbook.methodCash}</strong></span>
                              {t.notes && <span className="text-slate-400 truncate max-w-[100px]">• {t.notes}</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-slate-400 text-[9px]">{t.transactionNumber}</span>
                              {t.status === 'CONFIRMED' && t.transactionType !== 'LOAN_DISBURSED' && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedTxnForReceipt(t.id)}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 active:scale-95 transition-all cursor-pointer"
                                >
                                  <Receipt className="w-3 h-3 text-emerald-600" />
                                  <span>{strings.passbook.viewReceipt}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Real Loans Module View */}
            {activeFutureTab === 'loans' && (
              <div className="space-y-3 pt-1">
                {/* Summary Card */}
                <div className="p-3.5 bg-slate-900 text-white rounded-2xl flex items-center justify-between shadow-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">{strings.loans.outstandingBalance}</span>
                    <span className="text-base font-extrabold text-amber-400 font-mono">
                      ₹{loans.reduce((acc, l) => (l.status === 'ACTIVE' ? acc + l.outstandingBalance : acc), 0)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">{strings.loans.principalAmount}</span>
                    <span className="text-sm font-bold text-slate-200 font-mono">
                      ₹{loans.reduce((acc, l) => acc + l.amount, 0)}
                    </span>
                  </div>
                </div>

                {loansError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                    {loansError}
                  </div>
                )}

                {/* Header & President Action */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1.5">
                    <HandCoins className="w-4 h-4 text-orange-600" />
                    <h6 className="text-xs font-bold text-slate-800">
                      {strings.loans.memberLoansTitle}
                    </h6>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({loans.length})
                    </span>
                  </div>

                  {canRecordPayment && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateLoanModal(true);
                        setCreateLoanError(null);
                        setCreateLoanSuccess(null);
                        setLoanAmount('');
                        setLoanNotes('');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white text-[11px] font-bold rounded-lg transition-all shadow-xs cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>{strings.loans.newLoanButton}</span>
                    </button>
                  )}
                </div>

                {/* Loans List */}
                {loansLoading ? (
                  <div className="py-8 flex justify-center text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
                  </div>
                ) : loans.length === 0 ? (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-1.5">
                    <HandCoins className="w-6 h-6 text-slate-300 mx-auto" />
                    <h6 className="text-xs font-bold text-slate-700">{strings.loans.emptyLoans}</h6>
                    <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                      अध्यक्षांनी नवीन कर्ज मंजूर केल्यानंतर येथे कर्जाचा संपूर्ण हिशोब दिसेल.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-0.5">
                    {loans.map((loan) => (
                      <div
                        key={loan.id}
                        className="p-3 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-2.5 text-xs"
                      >
                        {/* Status & Loan Date Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                loan.status === 'ACTIVE'
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : loan.status === 'CLOSED'
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                  : 'bg-slate-100 text-slate-700 border-slate-300'
                              }`}
                            >
                              {loan.status === 'ACTIVE'
                                ? strings.loans.statusActive
                                : loan.status === 'CLOSED'
                                ? strings.loans.statusClosed
                                : strings.loans.statusCancelled}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {formatDate(loan.loanDate)}
                            </span>
                          </div>

                          <span className="font-mono text-slate-400 text-[10px]">
                            {loan.disbursementTransactionNumber}
                          </span>
                        </div>

                        {/* Numbers Grid */}
                        <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 text-center">
                          <div>
                            <span className="text-[10px] text-slate-400 block">{strings.loans.principalAmount}</span>
                            <strong className="text-slate-800 font-mono text-xs">₹{loan.amount}</strong>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">{strings.loans.totalRepaid}</span>
                            <strong className="text-emerald-700 font-mono text-xs">₹{loan.totalRepaid}</strong>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">{strings.loans.outstandingBalance}</span>
                            <strong className="text-amber-700 font-mono text-xs">₹{loan.outstandingBalance}</strong>
                          </div>
                        </div>

                        {loan.notes && (
                          <p className="text-[11px] text-slate-500 italic bg-slate-50/50 px-2 py-1 rounded">
                            {loan.notes}
                          </p>
                        )}

                        {/* Action: Record Repayment (President / Treasurer) */}
                        {canRecordPayment && loan.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => handleOpenRepaymentModal(loan)}
                            className="w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            <span>{strings.loans.recordRepaymentButton}</span>
                          </button>
                        )}

                        {/* Repayments History */}
                        {loan.repayments && loan.repayments.length > 0 && (
                          <div className="space-y-1.5 pt-1 border-t border-slate-100">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                              {strings.loans.repaymentHistory} ({loan.repayments.length})
                            </span>
                            <div className="space-y-1">
                              {loan.repayments.map((rep) => (
                                <div
                                  key={rep.id}
                                  className="p-1.5 bg-slate-50 rounded-lg flex items-center justify-between text-[11px]"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                                    <span className="text-slate-600 font-medium">
                                      {formatDate(rep.repaymentDate)}
                                    </span>
                                    {rep.actorName && (
                                      <span className="text-[10px] text-slate-400">
                                        ({rep.actorName})
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-emerald-700 font-mono">
                                      +₹{rep.amount}
                                    </span>
                                    {rep.transactionId && (
                                      <button
                                        type="button"
                                        onClick={() => setSelectedTxnForReceipt(rep.transactionId)}
                                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 active:scale-95 transition-all cursor-pointer"
                                      >
                                        पावती
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}


          </div>

          {/* President Controls: Treasurer Assignment / Transfer */}
          {isPresident && member.role !== 'PRESIDENT' && (
            <div className="pt-1 space-y-2">
              <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5 text-amber-600" />
                <span>मंडळ पदभार व्यवस्थापन (Role Management)</span>
              </h5>

              {roleSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{roleSuccess}</span>
                </div>
              )}

              {member.role === 'TREASURER' ? (
                <div className="p-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-600" />
                    <div>
                      <div className="text-xs font-bold text-amber-950">{strings.members.currentTreasurerBadge}</div>
                      <div className="text-[10px] text-amber-800">मंडळाचे अधिकृत खजिनदार</div>
                    </div>
                  </div>
                  <span className="text-[10px] bg-amber-200/70 text-amber-900 font-bold px-2 py-0.5 rounded-full">
                    सक्रिय पदभार
                  </span>
                </div>
              ) : (
                <>
                  {member.isActive ? (
                    !showRoleConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowRoleConfirm(true)}
                        disabled={roleLoading}
                        className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-xs hover:from-amber-600 hover:to-orange-600 active:scale-95 transition-all"
                      >
                        <Award className="w-4 h-4" />
                        <span>{strings.members.assignTreasurerButton}</span>
                      </button>
                    ) : (
                      <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <h6 className="text-xs font-bold text-amber-950">
                              {strings.members.assignTreasurerTitle}
                            </h6>
                            <p className="text-[11px] text-amber-900 mt-1 leading-relaxed">
                              {strings.members.assignTreasurerWarning}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setShowRoleConfirm(false)}
                            disabled={roleLoading}
                            className="flex-1 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all"
                          >
                            {strings.members.confirmCancel}
                          </button>
                          <button
                            type="button"
                            onClick={handleAssignTreasurer}
                            disabled={roleLoading}
                            className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                          >
                            {roleLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <span>होय, खजिनदार करा</span>
                            )}
                          </button>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500 text-center">
                      {strings.members.inactiveCannotBeTreasurer}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Activate / Deactivate Action */}
          {member.role !== 'PRESIDENT' && (
            <div className="pt-2">
              {!showConfirm ? (
                <button
                  type="button"
                  onClick={() => {
                    if (member.isActive) {
                      setShowConfirm(true);
                    } else {
                      handleToggleStatus();
                    }
                  }}
                  disabled={loading}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                    member.isActive
                      ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                      : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Power className="w-4 h-4" />
                      <span>
                        {member.isActive ? strings.members.deactivateButton : strings.members.activateButton}
                      </span>
                    </>
                  )}
                </button>
              ) : (
                /* Deactivation Confirmation Dialog */
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl space-y-2.5 animate-in fade-in duration-150">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h6 className="text-xs font-bold text-amber-950">
                        {strings.members.deactivateConfirmTitle}
                      </h6>
                      <p className="text-[11px] text-amber-900 mt-1 leading-relaxed">
                        {strings.members.deactivateConfirmText}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowConfirm(false)}
                      disabled={loading}
                      className="flex-1 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all"
                    >
                      {strings.members.confirmCancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleStatus}
                      disabled={loading}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                    >
                      {loading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span>{strings.members.confirmYes}</span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* View Member PIN (President Only) */}
          {isPresident && (
            <div className="pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsPinViewModalOpen(true)}
                disabled={deleteLoading || loading}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4 text-amber-700" />
                <span>सुरक्षा पिन पहा (View PIN)</span>
              </button>
            </div>
          )}

          {/* Delete Member Action (President Only) */}
          {isPresident && member.role !== 'PRESIDENT' && (
            <div className="pt-2 border-t border-slate-200">
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleteLoading || loading}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                  <span>सदस्य हटवा</span>
                </button>
              ) : (
                /* Delete Confirmation Dialog */
                <div className="p-3.5 bg-red-50 border border-red-300 rounded-2xl space-y-2.5 animate-in fade-in duration-150">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <h6 className="text-xs font-bold text-red-950">
                        हा सदस्य कायमचा हटवायचा आहे का?
                      </h6>
                      <p className="text-[11px] text-red-900 mt-1 leading-relaxed">
                        <strong>{member.fullName}</strong> यांना हटवल्यास त्यांच्या खात्याचा ॲक्सेस बंद होईल. आर्थिक इतिहास असल्यास तो सुरक्षित ठेवला जाईल.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleteLoading}
                      className="flex-1 min-h-[44px] py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
                    >
                      {strings.members.confirmCancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteMember}
                      disabled={deleteLoading}
                      className="flex-1 min-h-[44px] py-2 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {deleteLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>होय, हटवा</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Cash Payment Confirmation Modal */}
      {selectedRecordForPayment && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 animate-in fade-in duration-150">
          <div className="w-full max-w-[calc(100%-1rem)] sm:max-w-[360px] bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85dvh]">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-emerald-400" />
                <h4 className="text-sm font-bold">{strings.payment.modalTitle}</h4>
              </div>
              {!paymentSubmitting && (
                <button
                  type="button"
                  onClick={() => setSelectedRecordForPayment(null)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 text-white cursor-pointer -mr-2"
                  aria-label="बंद करा"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3">
              {paymentError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {paymentError}
                </div>
              )}
              {paymentSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{paymentSuccess}</span>
                </div>
              )}

              {/* Transaction Snapshot Details */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 divide-y divide-slate-200/60 text-xs">
                <div className="pb-1.5 flex justify-between">
                  <span className="text-slate-500">{strings.payment.memberLabel}</span>
                  <span className="font-bold text-slate-800">{member.fullName}</span>
                </div>
                <div className="py-1.5 flex justify-between">
                  <span className="text-slate-500">{strings.payment.monthLabel}</span>
                  <span className="font-bold text-slate-800">{selectedRecordForPayment.monthYear}</span>
                </div>
                <div className="py-1.5 flex justify-between">
                  <span className="text-slate-500">{strings.payment.dueDateLabel}</span>
                  <span className="font-mono text-slate-700">{selectedRecordForPayment.dueDate}</span>
                </div>
                <div className="py-1.5 flex justify-between">
                  <span className="text-slate-500">{strings.payment.methodLabel}</span>
                  <span className="font-bold text-emerald-700">{strings.payment.methodCash}</span>
                </div>
                <div className="pt-1.5 flex justify-between items-center">
                  <span className="text-slate-600 font-bold">{strings.payment.amountLabel}</span>
                  <span className="text-base font-extrabold text-slate-900 font-mono">
                    ₹{selectedRecordForPayment.expectedAmount}
                  </span>
                </div>
              </div>

              {/* Mandatory Physical Cash Warning */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-900 font-semibold leading-relaxed">
                  {strings.payment.warningNotice}
                </p>
              </div>

              {/* Optional Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  {strings.payment.notesLabel}
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder={strings.payment.notesPlaceholder}
                  maxLength={100}
                  disabled={paymentSubmitting}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all disabled:opacity-50"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedRecordForPayment(null)}
                  disabled={paymentSubmitting}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-semibold text-xs rounded-xl transition-all disabled:opacity-50"
                >
                  रद्द करा
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCashPayment}
                  disabled={paymentSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {paymentSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>{strings.payment.confirmButton}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create / Disburse Loan Modal (President Only) */}
      {showCreateLoanModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 animate-in fade-in duration-150">
          <div className="w-full max-w-[calc(100%-1rem)] sm:max-w-[360px] bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85dvh]">
            {/* Header */}
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HandCoins className="w-4 h-4 text-orange-400" />
                <h4 className="text-sm font-bold">{strings.loans.createModalTitle}</h4>
              </div>
              {!createLoanSubmitting && (
                <button
                  type="button"
                  onClick={() => setShowCreateLoanModal(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 text-white cursor-pointer -mr-2"
                  aria-label="बंद करा"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Form */}
            <form onSubmit={handleCreateLoanSubmit} className="p-4 space-y-3">
              {createLoanError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {createLoanError}
                </div>
              )}
              {createLoanSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{createLoanSuccess}</span>
                </div>
              )}

              {/* Member details snapshot */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 divide-y divide-slate-200/60 text-xs">
                <div className="pb-1.5 flex justify-between">
                  <span className="text-slate-500">सदस्याचे नाव</span>
                  <span className="font-bold text-slate-800">{member.fullName}</span>
                </div>
                <div className="pt-1.5 flex justify-between">
                  <span className="text-slate-500">मोबाईल नंबर</span>
                  <span className="font-mono text-slate-700">+91 {member.phone}</span>
                </div>
              </div>

              {/* Loan Amount */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  {strings.loans.amountLabel} <span className="text-red-500">*</span>
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-2.5 text-xs font-bold text-slate-400">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(e.target.value)}
                    placeholder={strings.loans.amountPlaceholder}
                    disabled={createLoanSubmitting}
                    className="w-full pl-6 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Loan Date */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  {strings.loans.loanDateLabel}
                </label>
                <input
                  type="date"
                  value={loanDate}
                  onChange={(e) => setLoanDate(e.target.value)}
                  disabled={createLoanSubmitting}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all disabled:opacity-50"
                />
              </div>

              {/* Optional Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  {strings.loans.notesLabel}
                </label>
                <input
                  type="text"
                  value={loanNotes}
                  onChange={(e) => setLoanNotes(e.target.value)}
                  placeholder={strings.loans.notesPlaceholder}
                  maxLength={100}
                  disabled={createLoanSubmitting}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all disabled:opacity-50"
                />
              </div>

              {/* Warning Notice */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-900 font-semibold leading-relaxed">
                  {strings.loans.warningLoanNotice}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreateLoanModal(false)}
                  disabled={createLoanSubmitting}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-semibold text-xs rounded-xl transition-all disabled:opacity-50"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={createLoanSubmitting}
                  className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {createLoanSubmitting ? (
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

      {/* Cash Loan Repayment Modal (President or Treasurer) */}
      {selectedLoanForRepayment && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 animate-in fade-in duration-150">
          <div className="w-full max-w-[calc(100%-1rem)] sm:max-w-[360px] bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85dvh]">
            {/* Header */}
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-emerald-400" />
                <h4 className="text-sm font-bold">{strings.loans.repayModalTitle}</h4>
              </div>
              {!repaymentSubmitting && (
                <button
                  type="button"
                  onClick={() => setSelectedLoanForRepayment(null)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 text-white cursor-pointer -mr-2"
                  aria-label="बंद करा"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Form */}
            <form onSubmit={handleRecordRepaymentSubmit} className="p-4 space-y-3">
              {repaymentError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {repaymentError}
                </div>
              )}
              {repaymentSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{repaymentSuccess}</span>
                </div>
              )}

              {/* Loan snapshot details */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 divide-y divide-slate-200/60 text-xs">
                <div className="pb-1.5 flex justify-between">
                  <span className="text-slate-500">सदस्याचे नाव</span>
                  <span className="font-bold text-slate-800">{member.fullName}</span>
                </div>
                <div className="py-1.5 flex justify-between">
                  <span className="text-slate-500">{strings.loans.principalAmount}</span>
                  <span className="font-mono text-slate-700">₹{selectedLoanForRepayment.amount}</span>
                </div>
                <div className="py-1.5 flex justify-between">
                  <span className="text-slate-500">{strings.loans.totalRepaid}</span>
                  <span className="font-mono text-emerald-700 font-bold">₹{selectedLoanForRepayment.totalRepaid}</span>
                </div>
                <div className="pt-1.5 flex justify-between items-center">
                  <span className="text-slate-600 font-bold">{strings.loans.outstandingBalance}</span>
                  <span className="text-base font-extrabold text-amber-700 font-mono">
                    ₹{selectedLoanForRepayment.outstandingBalance}
                  </span>
                </div>
              </div>

              {/* Repayment Amount Input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {strings.loans.repaymentAmountLabel} <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setRepaymentAmount(String(selectedLoanForRepayment.outstandingBalance))}
                    className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer"
                  >
                    पूर्ण शिल्लक भरा (₹{selectedLoanForRepayment.outstandingBalance})
                  </button>
                </div>
                <div className="relative flex items-center">
                  <span className="absolute left-2.5 text-xs font-bold text-slate-400">₹</span>
                  <input
                    type="number"
                    min="1"
                    max={selectedLoanForRepayment.outstandingBalance}
                    step="1"
                    required
                    value={repaymentAmount}
                    onChange={(e) => setRepaymentAmount(e.target.value)}
                    placeholder={strings.loans.repaymentAmountPlaceholder}
                    disabled={repaymentSubmitting}
                    className="w-full pl-6 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Warning Notice */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-900 font-semibold leading-relaxed">
                  {strings.loans.warningRepayNotice}
                </p>
              </div>

              {/* Optional Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  {strings.loans.notesLabel}
                </label>
                <input
                  type="text"
                  value={repaymentNotes}
                  onChange={(e) => setRepaymentNotes(e.target.value)}
                  placeholder="उदा. रोख रक्कम खजिनदारांकडे जमा"
                  maxLength={100}
                  disabled={repaymentSubmitting}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all disabled:opacity-50"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedLoanForRepayment(null)}
                  disabled={repaymentSubmitting}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-semibold text-xs rounded-xl transition-all disabled:opacity-50"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={repaymentSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {repaymentSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>{strings.payment.confirmButton}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Real Cash Payment Receipt Modal */}
      <ReceiptModal
        transactionId={selectedTxnForReceipt}
        isOpen={!!selectedTxnForReceipt}
        onClose={() => setSelectedTxnForReceipt(null)}
      />

      {/* Secure Recoverable PIN View Modal (President Only) */}
      {isPresident && member && (
        <SecurePinViewModal
          isOpen={isPinViewModalOpen}
          onClose={() => setIsPinViewModalOpen(false)}
          title="सदस्याचा सुरक्षा पिन"
          targetName={`${member.fullName} (+91 ${member.phone})`}
          fetchPin={() => getMemberPin(member.id)}
        />
      )}
    </div>
  );
};
