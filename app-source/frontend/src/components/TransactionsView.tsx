import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import {
  getOrganizationLedger,
  getMyPassbook,
  FinancialTransaction,
} from '../api/ledger.js';
import { ReceiptModal } from './ReceiptModal.js';
import {
  Wallet,
  FileText,
  Search,
  ArrowDownLeft,
  Loader2,
  AlertTriangle,
  Coins,
  RefreshCw,
} from 'lucide-react';

export const TransactionsView: React.FC = () => {
  const { user } = useAuth();
  const isOfficer = user?.role === 'PRESIDENT' || user?.role === 'TREASURER';

  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [totalInflow, setTotalInflow] = useState<number>(0);
  const [totalTransactionsCount, setTotalTransactionsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'INFLOW' | 'LOAN'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeReceiptTxnId, setActiveReceiptTxnId] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isOfficer) {
        const res = await getOrganizationLedger(1, 100);
        if (res.success && res.data) {
          // Filter out EXPENSE from normal member transaction presentation
          const memberTxns = res.data.transactions.filter(
            (t) => t.transactionType !== 'EXPENSE'
          );
          setTransactions(memberTxns);
          setTotalInflow(res.data.summary.totalInflow);
          setTotalTransactionsCount(memberTxns.length);
        } else {
          setError(res.error || 'व्यवहार लोड करता आले नाहीत.');
        }
      } else {
        const res = await getMyPassbook();
        if (res.success && res.data) {
          setTransactions(res.data.transactions);
          setTotalInflow(res.data.totalPaid);
          setTotalTransactionsCount(res.data.totalTransactions);
        } else {
          setError(res.error || 'व्यवहार लोड करता आले नाहीत.');
        }
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setLoading(false);
    }
  }, [isOfficer]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Filter by tab and search term
  const filteredTransactions = transactions.filter((t) => {
    // Type filter
    if (filterType === 'INFLOW') {
      if (t.transactionType !== 'BISHI_PAYMENT' && t.transactionType !== 'LOAN_REPAYMENT') {
        return false;
      }
    } else if (filterType === 'LOAN') {
      if (t.transactionType !== 'LOAN_DISBURSED' && t.transactionType !== 'LOAN_REPAYMENT') {
        return false;
      }
    }

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchName = t.memberName?.toLowerCase().includes(term) ?? false;
      const matchNumber = t.transactionNumber.toLowerCase().includes(term);
      const matchNotes = t.notes?.toLowerCase().includes(term) ?? false;
      const matchMonth = t.bishiMonth?.toLowerCase().includes(term) ?? false;
      return matchName || matchNumber || matchNotes || matchMonth;
    }

    return true;
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

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'BISHI_PAYMENT':
        return 'मासिक बीसी जमा';
      case 'LOAN_REPAYMENT':
        return 'कर्ज परतफेड';
      case 'LOAN_DISBURSED':
        return 'कर्ज वाटप';
      default:
        return type;
    }
  };

  const isIncoming = (type: string) => {
    return type === 'BISHI_PAYMENT' || type === 'LOAN_REPAYMENT';
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Header & KPI Card */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">व्यवहार</h3>
              <p className="text-[11px] text-slate-500">अधिकृत आर्थिक व्यवहार, जमा व पावत्या</p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchTransactions}
            disabled={loading}
            className="min-w-[44px] min-h-[44px] p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center"
            title="रीफ्रेश करा"
            aria-label="रीफ्रेश करा"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Transactions Summary KPI Grid */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl text-left">
            <span className="text-[10px] text-emerald-800 block font-medium">एकूण जमा रक्कम</span>
            <strong className="text-base font-bold text-emerald-700 font-mono">
              +₹{totalInflow}
            </strong>
            <span className="text-[9px] text-emerald-600 block mt-0.5">
              बीसी व कर्ज परतफेड जमा
            </span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-left">
            <span className="text-[10px] text-slate-500 block font-medium">एकूण व्यवहार</span>
            <strong className="text-base font-bold text-slate-800 font-mono">
              {totalTransactionsCount} नोंदी
            </strong>
            <span className="text-[9px] text-slate-400 block mt-0.5">
              पुष्टी झालेले व्यवहार
            </span>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white rounded-2xl p-3 shadow-xs border border-slate-100 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="सदस्याचे नाव, पावती क्रमांक किंवा महिना शोधा..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-xl font-bold shrink-0 transition-colors flex items-center justify-center ${
              filterType === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            सर्व व्यवहार
          </button>
          <button
            type="button"
            onClick={() => setFilterType('INFLOW')}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-xl font-bold shrink-0 transition-colors flex items-center justify-center gap-1 ${
              filterType === 'INFLOW'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>जमा (Inflow)</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('LOAN')}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-xl font-bold shrink-0 transition-colors flex items-center justify-center gap-1 ${
              filterType === 'LOAN'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>कर्ज व्यवहार</span>
          </button>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Transactions List */}
      <div className="space-y-2.5">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2 bg-white rounded-2xl border border-slate-100">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <span className="text-xs">व्यवहार माहिती लोड होत आहे...</span>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2">
            <Wallet className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">सध्या कोणतेही व्यवहार उपलब्ध नाहीत.</p>
            <p className="text-[11px] text-slate-400">
              मंडळात अद्याप कोणतेही अधिकृत व्यवहार नोंदवलेले नाहीत.
            </p>
          </div>
        ) : (
          filteredTransactions.map((txn) => {
            const incoming = isIncoming(txn.transactionType);

            return (
              <div
                key={txn.id}
                className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          incoming
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {getTransactionLabel(txn.transactionType)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {formatDate(txn.transactionDate)}
                      </span>
                      {txn.bishiMonth && (
                        <span className="text-[10px] text-slate-500 font-medium">
                          ({txn.bishiMonth})
                        </span>
                      )}
                    </div>

                    {/* Source / Payer display */}
                    <div className="text-xs font-bold text-slate-800 pt-0.5 truncate">
                      {incoming ? (
                        <span className="flex items-center gap-1">
                          <span className="text-slate-500 font-normal text-[11px]">कोणी दिले:</span>
                          <span className="text-slate-800 font-bold">{txn.memberName || 'सदस्य'}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className="text-slate-500 font-normal text-[11px]">कोणाला दिले:</span>
                          <span className="text-slate-800 font-bold">{txn.memberName || 'सदस्य'}</span>
                        </span>
                      )}
                    </div>

                    {txn.notes && (
                      <p className="text-[11px] text-slate-500 truncate">{txn.notes}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <strong
                      className={`text-sm font-bold font-mono block ${
                        incoming ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      {incoming ? `+₹${txn.amount}` : `-₹${txn.amount}`}
                    </strong>
                    <span className="text-[9px] text-slate-400 font-medium">
                      {txn.paymentMethod === 'CASH' ? 'रोख' : 'ऑनलाइन'}
                    </span>
                  </div>
                </div>

                {/* Footer: Transaction ID & Receipt Action */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1.5 border-t border-slate-100">
                  <span className="font-mono text-[10px] truncate max-w-[180px]">
                    {txn.transactionNumber}
                  </span>

                  <button
                    type="button"
                    onClick={() => setActiveReceiptTxnId(txn.id)}
                    className="min-h-[44px] px-2 text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1 text-xs cursor-pointer active:scale-95 transition-all"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>पावती पहा</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Digital Receipt Modal */}
      <ReceiptModal
        transactionId={activeReceiptTxnId}
        isOpen={Boolean(activeReceiptTxnId)}
        onClose={() => setActiveReceiptTxnId(null)}
      />
    </div>
  );
};
