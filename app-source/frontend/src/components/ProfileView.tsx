import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { RoleBadge } from './RoleBadge.js';
import { ChangePinModal } from './ChangePinModal.js';
import { ReceiptModal } from './ReceiptModal.js';
import { DeleteMandalModal } from './DeleteMandalModal.js';
import { SecurePinViewModal } from './SecurePinViewModal.js';
import { PaymentSettingsModal } from './PaymentSettingsModal.js';
import { getMyPin } from '../api/auth.js';
import {
  BishiConfig,
  BishiRecord,
  getMemberBishiConfig,
  getMemberBishiRecords,
} from '../api/bishi.js';
import {
  MemberPassbookResponse,
  getMyPassbook,
} from '../api/ledger.js';
import {
  Loan,
  getMyLoans,
} from '../api/loans.js';
import { strings } from '../i18n/mr.js';
import {
  User,
  Phone,
  Building2,
  Calendar,
  KeyRound,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  Hash,
  Coins,
  History,
  Loader2,
  BookOpen,
  Receipt,
  HandCoins,
  Check,
  Trash2,
  CreditCard,
} from 'lucide-react';

export const ProfileView: React.FC = () => {
  const { user, organization, logout } = useAuth();
  const [isChangePinOpen, setIsChangePinOpen] = useState(false);
  const [isMyPinModalOpen, setIsMyPinModalOpen] = useState(false);
  const [isPaymentSettingsOpen, setIsPaymentSettingsOpen] = useState(false);
  const [isDeleteMandalOpen, setIsDeleteMandalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Read-only Member Bishi State
  const [bishiConfig, setBishiConfig] = useState<BishiConfig | null>(null);
  const [bishiRecords, setBishiRecords] = useState<BishiRecord[]>([]);
  const [bishiLoading, setBishiLoading] = useState(false);

  // Read-only Member Loans State
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loansLoading, setLoansLoading] = useState(false);

  // Read-only Member Passbook State
  const [passbookData, setPassbookData] = useState<MemberPassbookResponse | null>(null);
  const [passbookLoading, setPassbookLoading] = useState(false);
  const [passbookFilter, setPassbookFilter] = useState<'ALL' | 'BISHI' | 'LOAN' | 'PAID'>('ALL');
  const [selectedTxnForReceipt, setSelectedTxnForReceipt] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let isMounted = true;
    setBishiLoading(true);
    setLoansLoading(true);
    setPassbookLoading(true);

    Promise.all([
      getMemberBishiConfig(user.id),
      getMemberBishiRecords(user.id),
      getMyPassbook(),
      getMyLoans(),
    ])
      .then(([cfgRes, recsRes, passbookRes, loansRes]) => {
        if (!isMounted) return;
        if (cfgRes.success) {
          setBishiConfig(cfgRes.data || null);
        }
        if (recsRes.success && recsRes.data) {
          setBishiRecords(recsRes.data);
        }
        if (passbookRes.success && passbookRes.data) {
          setPassbookData(passbookRes.data);
        }
        if (loansRes.success && loansRes.data) {
          setLoans(loansRes.data);
        }
      })
      .catch(() => {
        // Safe empty state
      })
      .finally(() => {
        if (isMounted) {
          setBishiLoading(false);
          setLoansLoading(false);
          setPassbookLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'उपलब्ध नाही';
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

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Profile Header Card */}
      <div id="profile-section" className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-2xl pointer-events-none -mr-8 -mt-8"></div>
        <div className="flex items-center gap-3.5 relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center text-white text-xl font-bold shadow-md shadow-orange-600/30 shrink-0">
            {user?.fullName ? user.fullName.charAt(0) : <User className="w-6 h-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold truncate leading-tight">{user?.fullName}</h2>
            </div>
            <p className="text-xs text-slate-300 font-mono mt-1 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-orange-400" />
              <span>+91 {user?.phone}</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              {user && <RoleBadge role={user.role} />}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                  user?.isActive !== false
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/20 text-red-300 border border-red-500/30'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    user?.isActive !== false ? 'bg-emerald-400' : 'bg-red-400'
                  }`}
                ></span>
                {user?.isActive !== false ? strings.members.statusActive : strings.members.statusInactive}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mandal Details Card */}
      <div id="mandal-settings-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-orange-600" />
            <span>{strings.profile.mandalName}</span>
          </h3>
          <span className="text-[10px] font-mono bg-orange-50 text-orange-700 px-2 py-0.5 rounded-md border border-orange-100 font-bold">
            {organization?.code}
          </span>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          <div className="py-2 flex justify-between items-center">
            <span className="text-slate-500">{strings.profile.mandalName}</span>
            <span className="font-semibold text-slate-800 text-right">{organization?.name}</span>
          </div>
          <div className="py-2 flex justify-between items-center">
            <span className="text-slate-500">{strings.profile.mandalCode}</span>
            <span className="font-mono font-semibold text-slate-800">{organization?.code}</span>
          </div>
          {organization?.registrationNumber && (
            <div className="py-2 flex justify-between items-center">
              <span className="text-slate-500">{strings.profile.regNumber}</span>
              <span className="font-mono font-semibold text-slate-800">
                {organization.registrationNumber}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Account Info Card */}
      <div id="security-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-slate-600" />
          <span>खाते माहिती</span>
        </h3>

        <div className="divide-y divide-slate-100 text-xs">
          <div className="py-2 flex justify-between items-center">
            <span className="text-slate-500">{strings.profile.role}</span>
            <span className="font-semibold text-slate-800">
              {strings.roles[user?.role || 'MEMBER']}
            </span>
          </div>
          <div className="py-2 flex justify-between items-center">
            <span className="text-slate-500">{strings.profile.status}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{strings.members.statusActive}</span>
            </span>
          </div>
          <div className="py-2 flex justify-between items-center">
            <span className="text-slate-500">{strings.profile.createdAt}</span>
            <span className="font-medium text-slate-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>{formatDate(user?.createdAt)}</span>
            </span>
          </div>
          <div className="py-2 flex justify-between items-center">
            <span className="text-slate-500">खाते आयडी (ID)</span>
            <span className="font-mono text-[11px] text-slate-500 flex items-center gap-1">
              <Hash className="w-3 h-3 text-slate-400" />
              <span>{user?.id ? `${user.id.substring(0, 16)}...` : 'N/A'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* My Bishi Card (Read-Only) */}
      <div id="bishi-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-orange-600" />
            <span>माझी बीशी माहिती</span>
          </h3>
          {bishiConfig && (
            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
              सक्रिय
            </span>
          )}
        </div>

        {bishiLoading ? (
          <div className="py-6 flex justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
          </div>
        ) : !bishiConfig ? (
          <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center space-y-1">
            <Coins className="w-5 h-5 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">
              सध्या कोणतीही बीशी नोंद उपलब्ध नाही.
            </p>
            <p className="text-[10px] text-slate-400">
              मंडळाचे अध्यक्ष जेव्हा तुमची बीसी रक्कम निश्चित करतील, तेव्हा ती येथे दिसेल.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <span className="text-[10px] text-slate-500 block">मासिक हप्ता रक्कम</span>
                <strong className="text-sm font-bold text-slate-800">
                  ₹{bishiConfig.monthlyAmount}
                </strong>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <span className="text-[10px] text-slate-500 block">हप्ता देय दिनांक</span>
                <strong className="text-sm font-bold text-slate-800">
                  दर महिन्याची {bishiConfig.dueDay} तारीख
                </strong>
              </div>
            </div>

            {/* Records list */}
            <div className="pt-1 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                <span className="flex items-center gap-1">
                  <History className="w-3.5 h-3.5 text-slate-400" />
                  <span>मासिक हप्ते इतिहास</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {bishiRecords.length} महिने
                </span>
              </div>

              {bishiRecords.length === 0 ? (
                <div className="p-2.5 bg-slate-50 rounded-xl text-center text-[11px] text-slate-400">
                  सध्या कोणतीही बीशी नोंद उपलब्ध नाही.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {bishiRecords.map((r) => (
                    <div
                      key={r.id}
                      className="p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-800">महिना: {r.monthYear}</div>
                        <div className="text-[10px] text-slate-400">देय: {r.dueDate}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-slate-800">₹{r.expectedAmount}</div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                          {r.status === 'PENDING' ? strings.bishi.statusPending : r.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[10px] text-slate-400 text-center italic pt-0.5">
                {strings.bishi.paymentNotice}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* My Loans Card (माझी कर्जे) */}
      <div id="loans-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <HandCoins className="w-4 h-4 text-orange-600" />
            <span>{strings.loans.myLoansTitle}</span>
          </h3>
          <span className="text-xs font-mono font-bold text-amber-600">
            {strings.loans.outstandingBalance}: ₹{loans.reduce((acc, l) => (l.status === 'ACTIVE' ? acc + l.outstandingBalance : acc), 0)}
          </span>
        </div>

        {loansLoading ? (
          <div className="py-6 flex justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
          </div>
        ) : loans.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center space-y-1">
            <HandCoins className="w-5 h-5 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">
              {strings.loans.emptyLoans}
            </p>
            <p className="text-[10px] text-slate-400">
              मंडळाने तुम्हाला कर्ज मंजूर केल्यानंतर त्याचा संपूर्ण तपशील येथे दिसेल.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-60 overflow-y-auto pr-0.5">
            {loans.map((loan) => (
              <div
                key={loan.id}
                className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs"
              >
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
                    <span className="text-[10px] text-slate-400 font-mono">
                      {formatDate(loan.loanDate)}
                    </span>
                  </div>
                  <span className="font-mono text-slate-400 text-[10px]">
                    {loan.disbursementTransactionNumber}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-white p-2 rounded-xl border border-slate-200/60 text-center">
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
                  <p className="text-[11px] text-slate-500 italic px-1">
                    {loan.notes}
                  </p>
                )}

                {/* Repayments History */}
                {loan.repayments && loan.repayments.length > 0 && (
                  <div className="space-y-1 pt-1.5 border-t border-slate-200/60">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      {strings.loans.repaymentHistory} ({loan.repayments.length})
                    </span>
                    {loan.repayments.map((rep) => (
                      <div
                        key={rep.id}
                        className="p-1.5 bg-white rounded-lg border border-slate-100 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="text-slate-600 font-medium">
                            {formatDate(rep.repaymentDate)}
                          </span>
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
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Digital Passbook Card */}
      <div id="passbook-section" className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-orange-600" />
            <span>{strings.passbook.historyTitle}</span>
          </h3>
          <span className="text-xs font-mono font-bold text-emerald-600">
            {strings.passbook.totalPaid}: ₹{passbookData?.totalPaid ?? 0}
          </span>
        </div>

        {/* Category Filter Chips */}
        {passbookData && passbookData.transactions.length > 0 && (
          <div className="flex items-center gap-1.5 pt-0.5">
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
          <div className="py-6 flex justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
          </div>
        ) : !passbookData || passbookData.transactions.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center space-y-1">
            <BookOpen className="w-5 h-5 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">
              {strings.passbook.emptyTitle}
            </p>
            <p className="text-[10px] text-slate-400">
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
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-slate-800 flex items-center gap-1.5">
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
                        <span className="text-[10px] text-slate-500 font-normal">
                          {formatDate(t.transactionDate)}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {t.transactionNumber}
                      </div>
                    </div>

                    <div className="text-right">
                      <div
                        className={`font-bold font-mono ${
                          t.transactionType === 'LOAN_DISBURSED' ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {t.transactionType === 'LOAN_DISBURSED' ? `-₹${t.amount}` : `+₹${t.amount}`}
                      </div>
                      <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-200">
                        {strings.passbook.statusConfirmed}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[10px] text-slate-500">
                    <div className="flex items-center gap-1">
                      <span>पद्धत: <strong>{strings.passbook.methodCash}</strong></span>
                      {t.notes && <span className="text-slate-400 truncate max-w-[100px]">• {t.notes}</span>}
                    </div>
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
              ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-1">
        {/* President View Own PIN Button */}
        {user?.role === 'PRESIDENT' && (
          <button
            type="button"
            onClick={() => setIsMyPinModalOpen(true)}
            className="w-full py-3 px-4 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-950 text-xs font-bold flex items-center justify-between transition-all active:scale-[0.99] shadow-xs cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shadow-xs">
                <KeyRound className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="font-bold">माझा PIN पहा (View My PIN)</div>
                <div className="text-[10px] text-amber-800 font-normal">
                  मंडळ अध्यक्षांचा स्वतःचा सुरक्षित पिन पहा
                </div>
              </div>
            </div>
            <span className="text-amber-600 text-sm font-bold">›</span>
          </button>
        )}

        {/* Payment Settings / View Button (President edit, Treasurer read-only) */}
        {(user?.role === 'PRESIDENT' || user?.role === 'TREASURER') && (
          <button
            id="payment-settings-section"
            type="button"
            onClick={() => setIsPaymentSettingsOpen(true)}
            className="w-full py-3 px-4 rounded-xl bg-orange-50 hover:bg-orange-100/80 border border-orange-200 text-orange-950 text-xs font-bold flex items-center justify-between transition-all active:scale-[0.99] shadow-xs cursor-pointer min-h-[44px]"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center shadow-xs">
                <CreditCard className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="font-bold">
                  {user.role === 'PRESIDENT'
                    ? 'ऑनलाइन भरणा रचना (Online Payment Settings)'
                    : 'ऑनलाइन भरणा माहिती (Online Payment Info)'}
                </div>
                <div className="text-[10px] text-orange-800 font-normal">
                  {user.role === 'PRESIDENT'
                    ? 'UPI आयडी व QR कोड व्यवस्थापन'
                    : 'मंडळाचा UPI आयडी व QR कोड पहा'}
                </div>
              </div>
            </div>
            <span className="text-orange-600 text-sm font-bold">›</span>
          </button>
        )}

        {/* Change PIN Button */}
        <button
          onClick={() => setIsChangePinOpen(true)}
          className="w-full py-3 px-4 rounded-xl bg-orange-50 hover:bg-orange-100/80 border border-orange-200 text-orange-900 text-xs font-bold flex items-center justify-between transition-all active:scale-[0.99] shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center shadow-xs">
              <KeyRound className="w-4 h-4" />
            </div>
            <div className="text-left">
              <div className="font-bold">{strings.profile.changePinButton}</div>
              <div className="text-[10px] text-orange-700/80 font-normal">
                सुरक्षित ४-६ अंकी लॉगिन पिन बदला
              </div>
            </div>
          </div>
          <span className="text-orange-600 text-sm font-bold">›</span>
        </button>

        {/* President Danger Zone - Mandal Permanent Reset */}
        {user?.role === 'PRESIDENT' && (
          <div className="bg-red-50/60 rounded-2xl p-4 border border-red-200 space-y-2.5 mt-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-red-900 uppercase tracking-wider flex items-center gap-1.5">
                <Trash2 className="w-4 h-4 text-red-600" />
                <span>धोकादायक कक्ष (Danger Zone)</span>
              </h3>
              <span className="text-[10px] font-bold bg-red-100 text-red-800 px-2 py-0.5 rounded-full border border-red-200">
                केवळ अध्यक्ष
              </span>
            </div>
            <p className="text-[11px] text-red-700 leading-relaxed">
              मंडळाची सर्व सभासद खाती, बीसी चक्र, कर्ज, खर्च आणि आर्थिक लेजर नोंदी कायमस्वरूपी नष्ट करा. ही कृती केल्यास ॲप सुरुवातीच्या स्थितीत रीसेट होईल.
            </p>
            <button
              type="button"
              onClick={() => setIsDeleteMandalOpen(true)}
              className="w-full py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-all active:scale-[0.99] cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>मंडळ कायमचे हटवा (Delete Mandal)</span>
            </button>
          </div>
        )}

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full py-3 px-4 rounded-xl bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-700 hover:text-red-700 text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
        >
          <LogOut className="w-4 h-4" />
          <span>{isLoggingOut ? strings.auth.loggingOut : strings.profile.logoutButton}</span>
        </button>
      </div>

      {/* Change PIN Modal */}
      <ChangePinModal
        isOpen={isChangePinOpen}
        onClose={() => setIsChangePinOpen(false)}
      />

      {/* Permanent Delete Mandal Modal (President Only) */}
      {user?.role === 'PRESIDENT' && (
        <DeleteMandalModal
          isOpen={isDeleteMandalOpen}
          onClose={() => setIsDeleteMandalOpen(false)}
        />
      )}

      {/* Real Cash Payment Receipt Modal */}
      <ReceiptModal
        transactionId={selectedTxnForReceipt}
        isOpen={!!selectedTxnForReceipt}
        onClose={() => setSelectedTxnForReceipt(null)}
      />

      {/* President Secure Own PIN View Modal */}
      {user?.role === 'PRESIDENT' && (
        <SecurePinViewModal
          isOpen={isMyPinModalOpen}
          onClose={() => setIsMyPinModalOpen(false)}
          title="माझा सुरक्षा पिन"
          targetName={`${user.fullName} (+91 ${user.phone})`}
          fetchPin={getMyPin}
        />
      )}

      {/* Payment Settings Modal (President edit, Treasurer read-only) */}
      {(user?.role === 'PRESIDENT' || user?.role === 'TREASURER') && (
        <PaymentSettingsModal
          isOpen={isPaymentSettingsOpen}
          onClose={() => setIsPaymentSettingsOpen(false)}
          isReadOnly={user.role === 'TREASURER'}
        />
      )}
    </div>
  );
};
