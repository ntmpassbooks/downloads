import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { RoleBadge } from './RoleBadge.js';
import { ReceiptModal } from './ReceiptModal.js';
import { PaymentModal } from './PaymentModal.js';
import {
  getBishiOverview,
  generateBishiCycle,
  setMemberBishiConfig,
  getMemberBishiConfig,
  getMemberBishiRecords,
  deleteBishiRecord,
  BishiOverviewResponse,
  BishiOverviewMember,
  BishiRecord,
  BishiConfig,
} from '../api/bishi.js';
import { recordCashBishiPayment } from '../api/ledger.js';
import {
  Coins,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Search,
  Phone,
  Receipt,
  ChevronLeft,
  ChevronRight,
  X,
  Banknote,
  SlidersHorizontal,
  CalendarClock,
  QrCode,
  Trash2,
} from 'lucide-react';

export const BishiManagementView: React.FC = () => {
  const { user } = useAuth();
  const isPresident = user?.role === 'PRESIDENT';
  const isTreasurer = user?.role === 'TREASURER';
  const isMember = user?.role === 'MEMBER';
  const canManageBishi = isPresident || isTreasurer;

  const currentMonthYear = new Date().toISOString().slice(0, 7);
  const [selectedMonthYear, setSelectedMonthYear] = useState<string>(currentMonthYear);

  // Admin / Treasurer state
  const [overview, setOverview] = useState<BishiOverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PAID' | 'CASH' | 'ONLINE' | 'UNCONFIGURED'>('ALL');

  // Cycle generation state
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleFeedback, setCycleFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Config modal state (President only)
  const [configModalMember, setConfigModalMember] = useState<BishiOverviewMember | null>(null);
  const [configAmount, setConfigAmount] = useState('');
  const [configDueDay, setConfigDueDay] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Cash payment modal state (President & Treasurer)
  const [cashPaymentTarget, setCashPaymentTarget] = useState<{
    member: BishiOverviewMember;
    record: NonNullable<BishiOverviewMember['record']>;
  } | null>(null);
  const [cashPaymentAmount, setCashPaymentAmount] = useState('');
  const [cashPaymentNotes, setCashPaymentNotes] = useState('');
  const [cashPaymentSubmitting, setCashPaymentSubmitting] = useState(false);
  const [cashPaymentError, setCashPaymentError] = useState<string | null>(null);

  // Receipt Modal trigger
  const [activeReceiptTxnId, setActiveReceiptTxnId] = useState<string | null>(null);

  // Online Payment Modal trigger
  const [onlinePaymentRecord, setOnlinePaymentRecord] = useState<BishiRecord | null>(null);

  // Member personal state (for MEMBER role)
  const [memberConfig, setMemberConfig] = useState<BishiConfig | null>(null);
  const [memberRecords, setMemberRecords] = useState<BishiRecord[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  // Delete record state (President & Treasurer)
  const [recordToDelete, setRecordToDelete] = useState<{
    member: BishiOverviewMember;
    record: NonNullable<BishiOverviewMember['record']>;
  } | null>(null);
  const [deleteRecordLoading, setDeleteRecordLoading] = useState(false);
  const [deleteRecordError, setDeleteRecordError] = useState<string | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Fetch overview for President / Treasurer
  const fetchOverview = useCallback(async (month: string) => {
    if (!canManageBishi) return;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await getBishiOverview(month);
      if (res.success && res.data) {
        setOverview(res.data);
      } else {
        setOverviewError(res.error || 'बीशी माहिती लोड करता आली नाही.');
      }
    } catch {
      setOverviewError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setOverviewLoading(false);
    }
  }, [canManageBishi]);

  // Fetch member personal Bishi data
  const fetchMemberData = useCallback(async () => {
    if (!user?.id || !isMember) return;
    setMemberLoading(true);
    try {
      const [cfgRes, recsRes] = await Promise.all([
        getMemberBishiConfig(user.id),
        getMemberBishiRecords(user.id),
      ]);
      if (cfgRes.success) setMemberConfig(cfgRes.data || null);
      if (recsRes.success) setMemberRecords(recsRes.data || []);
    } catch {
      // Safe fail
    } finally {
      setMemberLoading(false);
    }
  }, [user?.id, isMember]);

  useEffect(() => {
    if (canManageBishi) {
      fetchOverview(selectedMonthYear);
    } else if (isMember) {
      fetchMemberData();
    }
  }, [selectedMonthYear, canManageBishi, isMember, fetchOverview, fetchMemberData]);

  // Cycle Generation Handler
  const handleGenerateCycle = async () => {
    if (!canManageBishi) return;
    setCycleLoading(true);
    setCycleFeedback(null);
    try {
      const res = await generateBishiCycle(selectedMonthYear);
      if (res.success && res.data) {
        setCycleFeedback({
          type: 'success',
          message: `मासिक चक्र यशस्वी: ${res.data.generatedCount} नवीन हप्ता नोंदी तयार झाल्या (${res.data.skippedCount} आधीपासून अस्तित्वात).`,
        });
        fetchOverview(selectedMonthYear);
        setTimeout(() => setCycleFeedback(null), 6000);
      } else {
        setCycleFeedback({
          type: 'error',
          message: res.error || 'सायकल तयार करताना त्रुटी आली.',
        });
      }
    } catch {
      setCycleFeedback({
        type: 'error',
        message: 'सर्व्हरशी संपर्क होऊ शकला नाही.',
      });
    } finally {
      setCycleLoading(false);
    }
  };

  // Month navigation helpers
  const handlePrevMonth = () => {
    const [year, month] = selectedMonthYear.split('-').map(Number);
    const date = new Date(year, month - 2, 1);
    const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonthYear(ym);
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonthYear.split('-').map(Number);
    const date = new Date(year, month, 1);
    const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonthYear(ym);
  };

  const formatMonthMarathi = (ym: string) => {
    try {
      const [year, month] = ym.split('-').map(Number);
      const date = new Date(year, month - 1, 1);
      return date.toLocaleDateString('mr-IN', { month: 'long', year: 'numeric' });
    } catch {
      return ym;
    }
  };

  // Open Set Config Modal
  const handleOpenConfigModal = (member: BishiOverviewMember) => {
    setConfigModalMember(member);
    setConfigAmount(member.config ? String(member.config.monthlyAmount) : '1000');
    setConfigDueDay(member.config ? String(member.config.dueDay) : '10');
    setConfigError(null);
  };

  // Save Bishi Config
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configModalMember) return;

    const amountNum = parseInt(configAmount, 10);
    const dueDayNum = parseInt(configDueDay, 10);

    if (isNaN(amountNum) || amountNum <= 0) {
      setConfigError('कृपया वैध मासिक बीसी रक्कम प्रविष्ट करा (किमान ₹१००).');
      return;
    }
    if (isNaN(dueDayNum) || dueDayNum < 1 || dueDayNum > 28) {
      setConfigError('कृपया वैध देय दिवस प्रविष्ट करा (१ ते २८ दरम्यान).');
      return;
    }

    setConfigSaving(true);
    setConfigError(null);
    try {
      const res = await setMemberBishiConfig(configModalMember.memberId, amountNum, dueDayNum);
      if (res.success) {
        showToast(`${configModalMember.fullName} यांची बीसी रचना यशस्वीरीत्या अद्ययावत झाली!`);
        setConfigModalMember(null);
        fetchOverview(selectedMonthYear);
      } else {
        setConfigError(res.error || 'रचना जतन करताना अडचण आली.');
      }
    } catch {
      setConfigError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setConfigSaving(false);
    }
  };

  // Open Cash Payment Modal
  const handleOpenCashPaymentModal = (
    member: BishiOverviewMember,
    record: NonNullable<BishiOverviewMember['record']>
  ) => {
    setCashPaymentTarget({ member, record });
    setCashPaymentAmount(String(record.expectedAmount));
    setCashPaymentNotes('रोख भरणा');
    setCashPaymentError(null);
  };

  // Submit Cash Payment
  const handleSubmitCashPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashPaymentTarget) return;

    const amountNum = parseInt(cashPaymentAmount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      setCashPaymentError('कृपया वैध भरणा रक्कम प्रविष्ट करा.');
      return;
    }

    setCashPaymentSubmitting(true);
    setCashPaymentError(null);
    try {
      const res = await recordCashBishiPayment(
        cashPaymentTarget.record.id,
        amountNum,
        cashPaymentNotes.trim() || undefined
      );

      if (res.success && res.data) {
        const txnId = res.data.id;
        showToast(`रोख जमा यशस्वी! पावती क्रमांक: ${res.data.transactionNumber || txnId}`);
        setCashPaymentTarget(null);
        fetchOverview(selectedMonthYear);
        // Automatically open the official receipt modal
        setActiveReceiptTxnId(txnId);
      } else {
        setCashPaymentError(res.error || 'रोख जमा नोंदवताना त्रुटी झाली.');
      }
    } catch {
      setCashPaymentError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setCashPaymentSubmitting(false);
    }
  };

  // Handle Delete Unpaid Record
  const handleConfirmDeleteRecord = async () => {
    if (!recordToDelete) return;
    setDeleteRecordLoading(true);
    setDeleteRecordError(null);
    try {
      const res = await deleteBishiRecord(recordToDelete.record.id);
      if (res.success) {
        const memberName = recordToDelete.member.fullName;
        setRecordToDelete(null);
        showToast(`${memberName} यांची ${selectedMonthYear} महिन्याची बीशी नोंद यशस्वीरीत्या हटवली.`);
        fetchOverview(selectedMonthYear);
      } else {
        setDeleteRecordError(res.error || 'नोंद हटवताना त्रुटी आली.');
      }
    } catch {
      setDeleteRecordError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setDeleteRecordLoading(false);
    }
  };

  // Filtered members list
  const filteredMembers = (overview?.members || []).filter((m) => {
    const matchesSearch =
      m.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.phone.includes(searchTerm);

    if (!matchesSearch) return false;

    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'UNCONFIGURED') return !m.config;
    if (statusFilter === 'PAID') return m.record?.status === 'PAID';
    if (statusFilter === 'CASH')
      return m.record?.status === 'PAID' && m.record?.paymentMethod === 'CASH';
    if (statusFilter === 'ONLINE')
      return m.record?.status === 'PAID' && m.record?.paymentMethod === 'ONLINE_UPI';
    if (statusFilter === 'PENDING')
      return m.record?.status === 'PENDING' || m.record?.status === 'OVERDUE';
    return true;
  });

  // Calculate live collected vs pending in this cycle
  const cyclePaidTotal = (overview?.members || [])
    .filter((m) => m.record?.status === 'PAID')
    .reduce((sum, m) => sum + (m.record?.paidAmount || 0), 0);

  const cyclePendingTotal = (overview?.members || [])
    .filter((m) => m.record?.status === 'PENDING' || m.record?.status === 'OVERDUE')
    .reduce((sum, m) => sum + (m.record?.expectedAmount || 0), 0);

  const cashPaidTotal =
    overview?.summary?.totalCashAmount ??
    (overview?.members || [])
      .filter((m) => m.record?.status === 'PAID' && m.record?.paymentMethod === 'CASH')
      .reduce((sum, m) => sum + (m.record?.paidAmount || 0), 0);

  const cashPaidCount =
    overview?.summary?.totalCashCount ??
    (overview?.members || []).filter(
      (m) => m.record?.status === 'PAID' && m.record?.paymentMethod === 'CASH'
    ).length;

  const onlinePaidTotal =
    overview?.summary?.totalOnlineAmount ??
    (overview?.members || [])
      .filter((m) => m.record?.status === 'PAID' && m.record?.paymentMethod === 'ONLINE_UPI')
      .reduce((sum, m) => sum + (m.record?.paidAmount || 0), 0);

  const onlinePaidCount =
    overview?.summary?.totalOnlineCount ??
    (overview?.members || []).filter(
      (m) => m.record?.status === 'PAID' && m.record?.paymentMethod === 'ONLINE_UPI'
    ).length;

  // ==========================================
  // RENDER: MEMBER PERSONAL BISHI VIEW
  // ==========================================
  if (isMember) {
    return (
      <div className="space-y-4 pb-12">
        {/* Header */}
        <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">माझी बीशी माहिती</h3>
              <p className="text-[11px] text-slate-500">मासिक हप्ता रचना व भरणा इतिहास</p>
            </div>
          </div>
          <span className="text-[10px] font-mono bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full border border-orange-100 font-bold">
            {formatMonthMarathi(currentMonthYear)}
          </span>
        </div>

        {memberLoading ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
            <span className="text-xs">माहिती लोड होत आहे...</span>
          </div>
        ) : !memberConfig ? (
          <div className="p-6 bg-white rounded-2xl border border-dashed border-slate-200 text-center space-y-2">
            <Coins className="w-10 h-10 text-slate-300 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700">सध्या कोणतीही बीशी नोंद उपलब्ध नाही.</h4>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              मंडळाचे अध्यक्ष जेव्हा तुमची मासिक बीसी रक्कम आणि देय तारीख निश्चित करतील, तेव्हा ती येथे दिसेल.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Config Summary Cards */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3.5 bg-white rounded-2xl border border-slate-100 shadow-xs">
                <span className="text-[10px] text-slate-400 block font-medium">मासिक हप्ता</span>
                <strong className="text-base font-bold text-slate-800 font-mono">
                  ₹{memberConfig.monthlyAmount}
                </strong>
                <span className="text-[10px] text-emerald-600 block mt-0.5 font-medium">नियमित हप्ता</span>
              </div>
              <div className="p-3.5 bg-white rounded-2xl border border-slate-100 shadow-xs">
                <span className="text-[10px] text-slate-400 block font-medium">देय तारीख</span>
                <strong className="text-base font-bold text-slate-800 font-mono">
                  {memberConfig.dueDay} तारीख
                </strong>
                <span className="text-[10px] text-slate-400 block mt-0.5 font-medium">प्रत्येक महिन्याची</span>
              </div>
            </div>

            {/* Records List */}
            <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                मासिक हप्ता भरणा इतिहास
              </h4>

              {memberRecords.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  सध्या कोणतीही बीशी नोंद उपलब्ध नाही.
                </p>
              ) : (
                <div className="space-y-2">
                  {memberRecords.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-800 font-mono">
                            {rec.monthYear}
                          </span>
                          {rec.status === 'PAID' ? (
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                              भरणा पूर्ण
                            </span>
                          ) : (
                            <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                              प्रलंबित
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block">
                          देय: {new Date(rec.dueDate).toLocaleDateString('mr-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>

                      <div className="text-right flex items-center gap-2">
                        <div>
                          <strong className="text-xs font-bold text-slate-800 font-mono block">
                            ₹{rec.status === 'PAID' ? rec.paidAmount : rec.expectedAmount}
                          </strong>
                          {rec.paidDate && (
                            <span className="text-[9px] text-slate-400 block">
                              जमा: {new Date(rec.paidDate).toLocaleDateString('mr-IN', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>

                        {rec.status === 'PAID' && rec.paymentTransactionId && (
                          <button
                            type="button"
                            onClick={() => setActiveReceiptTxnId(rec.paymentTransactionId!)}
                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                            title="पावती पहा"
                          >
                            <Receipt className="w-4 h-4" />
                          </button>
                        )}

                        {rec.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={() => setOnlinePaymentRecord(rec)}
                            className="px-2.5 py-1 rounded-xl bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold text-[11px] flex items-center gap-1 shadow-xs transition-all min-h-[36px] cursor-pointer"
                            title="ऑनलाइन भरा (UPI / QR)"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>ऑनलाइन भरा</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Digital Receipt Modal */}
        <ReceiptModal
          transactionId={activeReceiptTxnId}
          isOpen={Boolean(activeReceiptTxnId)}
          onClose={() => setActiveReceiptTxnId(null)}
        />

        {/* Member Online Payment Modal */}
        {onlinePaymentRecord && (
          <PaymentModal
            isOpen={Boolean(onlinePaymentRecord)}
            bishiRecordId={onlinePaymentRecord.id}
            monthYear={onlinePaymentRecord.monthYear}
            expectedAmount={onlinePaymentRecord.expectedAmount}
            onClose={() => setOnlinePaymentRecord(null)}
            onPaymentSuccess={(_txnId) => {
              fetchMemberData();
              showToast('ऑनलाइन भरणा यशस्वी झाला!');
            }}
            onViewReceipt={(txnId) => {
              setActiveReceiptTxnId(txnId);
            }}
          />
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: PRESIDENT & TREASURER BISHI MANAGEMENT
  // ==========================================
  return (
    <div className="space-y-4 pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2 animate-in fade-in shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Overview Error Notice */}
      {overviewError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{overviewError}</span>
        </div>
      )}

      {/* Top Header Card */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">बीशी व्यवस्थापन</h3>
              <p className="text-[11px] text-slate-500">मासिक चक्र, वर्गणी हिशोब व रोख पावती</p>
            </div>
          </div>

          {/* Month Selector Controls */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 rounded-lg hover:bg-white text-slate-600 transition-colors"
              title="मागील महिना"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-bold font-mono px-1.5 text-slate-700">
              {formatMonthMarathi(selectedMonthYear)}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1 rounded-lg hover:bg-white text-slate-600 transition-colors"
              title="पुढील महिना"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Live KPI Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-center">
          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
            <span className="text-[10px] text-slate-400 block font-medium">एकूण सदस्य</span>
            <strong className="text-sm font-bold text-slate-800">
              {overview?.summary?.totalMembers ?? 0} सदस्य
            </strong>
            <span className="text-[9px] text-slate-400 block mt-0.5 truncate">
              {overview?.summary?.totalConfigured ?? 0} बीसी निश्चित
            </span>
          </div>

          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-left">
            <span className="text-[10px] text-slate-400 block font-medium">मासिक अपेक्षित</span>
            <strong className="text-sm font-bold text-slate-800 font-mono">
              ₹{overview?.summary?.totalExpectedAmount ?? 0}
            </strong>
            <span className="text-[9px] text-slate-400 block mt-0.5 truncate">
              {overview?.summary?.totalRecordsGenerated ?? 0} नोंदी तयार
            </span>
          </div>

          <div className="p-2.5 bg-emerald-50/60 border border-emerald-100 rounded-xl text-left">
            <span className="text-[10px] text-emerald-700 block font-medium">चालू महिना एकूण जमा</span>
            <strong className="text-sm font-bold text-emerald-800 font-mono">
              ₹{cyclePaidTotal}
            </strong>
            <span className="text-[9px] text-emerald-600 block mt-0.5 truncate">
              भरणा झालेले हप्ते
            </span>
          </div>

          <div className="p-2.5 bg-teal-50/70 border border-teal-100 rounded-xl text-left">
            <span className="text-[10px] text-teal-700 block font-medium">💵 रोख (Cash) जमा</span>
            <strong className="text-sm font-bold text-teal-800 font-mono">
              ₹{cashPaidTotal}
            </strong>
            <span className="text-[9px] text-teal-600 block mt-0.5 truncate">
              {cashPaidCount} रोख पावत्या
            </span>
          </div>

          <div className="p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl text-left">
            <span className="text-[10px] text-blue-700 block font-medium">📱 ऑनलाइन (Online) जमा</span>
            <strong className="text-sm font-bold text-blue-800 font-mono">
              ₹{onlinePaidTotal}
            </strong>
            <span className="text-[9px] text-blue-600 block mt-0.5 truncate">
              {onlinePaidCount} डिजिटल व्यवहार
            </span>
          </div>

          <div className="p-2.5 bg-amber-50/60 border border-amber-100 rounded-xl text-left">
            <span className="text-[10px] text-amber-700 block font-medium">चालू महिना प्रलंबित</span>
            <strong className="text-sm font-bold text-amber-800 font-mono">
              ₹{cyclePendingTotal}
            </strong>
            <span className="text-[9px] text-amber-600 block mt-0.5 truncate">
              येणे बाकी वर्गणी
            </span>
          </div>
        </div>

        {/* Cycle Generation Feedback */}
        {cycleFeedback && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2 animate-in fade-in ${
              cycleFeedback.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {cycleFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{cycleFeedback.message}</span>
          </div>
        )}

        {/* President & Treasurer Cycle Generator Trigger */}
        {canManageBishi && (
          <button
            type="button"
            onClick={handleGenerateCycle}
            disabled={cycleLoading}
            className="w-full py-2.5 px-3 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-[0.99] text-white text-xs font-bold rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {cycleLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>मासिक चक्र तयार होत आहे...</span>
              </>
            ) : (
              <>
                <CalendarClock className="w-4 h-4" />
                <span>{selectedMonthYear} या महिन्याचे बीसी चक्र सुरू करा</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white rounded-2xl p-3 shadow-xs border border-slate-100 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="सदस्याचे नाव किंवा मोबाईल नंबर शोधा..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition-colors ${
              statusFilter === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            सर्व ({overview?.members?.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('CASH')}
            className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition-colors ${
              statusFilter === 'CASH'
                ? 'bg-teal-700 text-white'
                : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
            }`}
          >
            💵 रोख ({cashPaidCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('ONLINE')}
            className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition-colors ${
              statusFilter === 'ONLINE'
                ? 'bg-blue-700 text-white'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            📱 ऑनलाइन ({onlinePaidCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PENDING')}
            className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition-colors ${
              statusFilter === 'PENDING'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            प्रलंबित
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PAID')}
            className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition-colors ${
              statusFilter === 'PAID'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            भरणा पूर्ण
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('UNCONFIGURED')}
            className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition-colors ${
              statusFilter === 'UNCONFIGURED'
                ? 'bg-slate-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            रचना नाही ({overview?.summary?.totalUnconfigured ?? 0})
          </button>
        </div>
      </div>

      {/* Members Bishi List */}
      <div className="space-y-2.5">
        {overviewLoading ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2 bg-white rounded-2xl border border-slate-100">
            <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
            <span className="text-xs">बीशी यादी लोड होत आहे...</span>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2">
            <Coins className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">सध्या कोणतीही बीशी नोंद उपलब्ध नाही.</p>
            <p className="text-[11px] text-slate-400">
              {overview?.members?.length === 0
                ? 'मंडळात अद्याप सदस्य नोंदवलेले नाहीत.'
                : 'निवडलेल्या फिल्टरनुसार कोणतेही सदस्य नाहीत.'}
            </p>
          </div>
        ) : (
          filteredMembers.map((m) => {
            const hasConfig = Boolean(m.config);
            const record = m.record;
            const isPaid = record?.status === 'PAID';
            const isPending = record?.status === 'PENDING' || record?.status === 'OVERDUE';

            return (
              <div
                key={m.memberId}
                className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3"
              >
                {/* Member Identity Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">
                      {m.fullName.slice(0, 1)}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <strong className="text-xs font-bold text-slate-800">{m.fullName}</strong>
                        <RoleBadge role={m.role} />
                      </div>
                      <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{m.phone}</span>
                      </span>
                    </div>
                  </div>

                  {/* Bishi Config Tag / Action for President & Treasurer */}
                  {canManageBishi && (
                    <button
                      type="button"
                      onClick={() => handleOpenConfigModal(m)}
                      className="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 text-[11px] font-bold transition-colors flex items-center gap-1"
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      <span>{hasConfig ? 'रचना बदला' : '+ रचना करा'}</span>
                    </button>
                  )}
                </div>

                {/* Configuration Details Box */}
                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">मासिक हप्ता रचना</span>
                    {hasConfig ? (
                      <strong className="text-xs font-bold text-slate-800 font-mono">
                        ₹{m.config?.monthlyAmount}
                      </strong>
                    ) : (
                      <span className="text-xs text-amber-600 font-semibold">निश्चित नाही (₹०)</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">हप्ता देय दिनांक</span>
                    {hasConfig ? (
                      <strong className="text-xs font-bold text-slate-800 font-mono">
                        दर महिन्याची {m.config?.dueDay} तारीख
                      </strong>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </div>
                </div>

                {/* Current Month Cycle Record Status & Cash Action */}
                <div className="pt-1 flex items-center justify-between border-t border-slate-100 flex-wrap gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 block font-medium">
                      {selectedMonthYear} स्थिती:
                    </span>
                    {!record ? (
                      <span className="text-[11px] text-slate-400 italic">
                        नोंद तयार नाही (सायकल सुरू करा)
                      </span>
                    ) : isPaid ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            भरणा पूर्ण (₹{record.paidAmount})
                          </span>
                          {record.paymentMethod === 'ONLINE_UPI' ? (
                            <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                              📱 ऑनलाइन UPI
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                              💵 रोख (Cash)
                            </span>
                          )}
                        </div>
                        {(record.transactionNumber || record.paidDate) && (
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                            {record.transactionNumber && (
                              <span>पावती क्र: {record.transactionNumber}</span>
                            )}
                            {record.paidDate && (
                              <span>
                                {new Date(record.paidDate).toLocaleDateString('mr-IN', {
                                  day: 'numeric',
                                  month: 'short',
                                })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            record.status === 'OVERDUE'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {record.status === 'OVERDUE' ? 'थकबाकी' : 'प्रलंबित'}: ₹{record.expectedAmount}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1.5">
                    {/* View Receipt button for PAID record */}
                    {isPaid && record?.paymentTransactionId && (
                      <button
                        type="button"
                        onClick={() => setActiveReceiptTxnId(record.paymentTransactionId!)}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold transition-colors flex items-center gap-1"
                        title="डिजिटल पावती पहा"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>पावती</span>
                      </button>
                    )}

                    {/* Record Cash Payment button for PENDING record (President & Treasurer) */}
                    {canManageBishi && isPending && record && (
                      <button
                        type="button"
                        onClick={() => handleOpenCashPaymentModal(m, record)}
                        className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.98] text-white text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                        title="रोख भरणा - जमा झाले (Mark Paid)"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        <span>जमा झाले (रोख)</span>
                      </button>
                    )}

                    {/* Delete Unpaid Bishi Record (President & Treasurer) */}
                    {canManageBishi && isPending && record && (
                      <button
                        type="button"
                        onClick={() => {
                          setRecordToDelete({ member: m, record });
                          setDeleteRecordError(null);
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer min-h-[34px] min-w-[34px] flex items-center justify-center border border-slate-200 hover:border-red-200"
                        title="मासिक नोंद हटवा (Delete Record)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: SET / EDIT BISHI CONFIG (President Only)        */}
      {/* ======================================================== */}
      {configModalMember && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl p-5 max-w-[calc(100%-0.5rem)] sm:max-w-[360px] w-full space-y-4 shadow-xl animate-in zoom-in-95 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">बीशी रचना निश्चित करा</h4>
                  <p className="text-[10px] text-slate-500">{configModalMember.fullName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfigModalMember(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer -mr-2"
                aria-label="बंद करा"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {configError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                <span>{configError}</span>
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 font-bold mb-1">
                  मासिक हप्ता रक्कम (₹)
                </label>
                <input
                  type="number"
                  min="100"
                  step="50"
                  required
                  value={configAmount}
                  onChange={(e) => setConfigAmount(e.target.value)}
                  placeholder="उदा. 1000"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  किमान ₹१००, प्रत्येक सदस्याची स्वतंत्र रक्कम निश्चित करता येते.
                </span>
              </div>

              <div>
                <label className="block text-slate-600 font-bold mb-1">
                  दर महिन्याची देय तारीख (Due Day)
                </label>
                <input
                  type="number"
                  min="1"
                  max="28"
                  required
                  value={configDueDay}
                  onChange={(e) => setConfigDueDay(e.target.value)}
                  placeholder="उदा. 10"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  १ ते २८ दरम्यान तारीख निवडा (कॅलेंडर महिन्याच्या सुसंगततेसाठी).
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfigModalMember(null)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={configSaving}
                  className="flex-1 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {configSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'जतन करा'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: RECORD CASH BISHI PAYMENT (President & Treasurer) */}
      {/* ======================================================== */}
      {cashPaymentTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl p-5 max-w-[calc(100%-0.5rem)] sm:max-w-[360px] w-full space-y-4 shadow-xl animate-in zoom-in-95 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  <Banknote className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    रोख बीशी जमा (Mark Paid)
                  </h4>
                  <p className="text-[10px] text-slate-500">{cashPaymentTarget.member.fullName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCashPaymentTarget(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer -mr-2"
                aria-label="बंद करा"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Member & Cycle Context */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">चक्र महिना:</span>
                <strong className="font-mono text-slate-800">{selectedMonthYear}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">अपेक्षित हप्ता रक्कम:</span>
                <strong className="font-mono text-emerald-800">
                  ₹{cashPaymentTarget.record.expectedAmount}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">देय तारीख:</span>
                <span className="text-slate-700">
                  {new Date(cashPaymentTarget.record.dueDate).toLocaleDateString('mr-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>

            {cashPaymentError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                <span>{cashPaymentError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitCashPayment} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 font-bold mb-1">
                  जमा घेतलेली रोख रक्कम (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={cashPaymentAmount}
                  onChange={(e) => setCashPaymentAmount(e.target.value)}
                  placeholder="उदा. 1000"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-bold mb-1">
                  नोंद / शेरा (ऐच्छिक)
                </label>
                <input
                  type="text"
                  value={cashPaymentNotes}
                  onChange={(e) => setCashPaymentNotes(e.target.value)}
                  placeholder="उदा. रोख भरणा मिळाला"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] text-slate-500 space-y-0.5">
                <span className="font-bold text-slate-700 block">✓ अधिकृत पावती तयार होईल</span>
                <span>
                  रोख जमा झाल्यानंतर लेजरमध्ये नोंद होईल आणि तात्काळ डिजिटल पावती उपलब्ध होईल.
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCashPaymentTarget(null)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={cashPaymentSubmitting}
                  className="flex-1 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1 shadow-xs"
                >
                  {cashPaymentSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'जमा झाले (Mark Paid)'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: DELETE UNPAID BISHI RECORD MODAL                */}
      {/* ======================================================== */}
      {recordToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl p-5 max-w-[340px] w-full space-y-4 shadow-xl animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">बीशी मासिक नोंद हटवा</h4>
                <p className="text-[11px] text-slate-500">{recordToDelete.member.fullName} ({selectedMonthYear})</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              या सदस्याची <strong>{selectedMonthYear}</strong> महिन्याची देय रक्कम ₹{recordToDelete.record.expectedAmount} ची प्रलंबित नोंद हटवली जाईल. भरणा झालेली नोंद हटवली जात नाही.
            </p>

            {deleteRecordError && (
              <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                {deleteRecordError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setRecordToDelete(null);
                  setDeleteRecordError(null);
                }}
                disabled={deleteRecordLoading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                रद्द करा
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteRecord}
                disabled={deleteRecordLoading}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {deleteRecordLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'नोंद हटवा'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* DIGITAL RECEIPT MODAL                                    */}
      {/* ======================================================== */}
      <ReceiptModal
        transactionId={activeReceiptTxnId}
        isOpen={Boolean(activeReceiptTxnId)}
        onClose={() => setActiveReceiptTxnId(null)}
      />
    </div>
  );
};
