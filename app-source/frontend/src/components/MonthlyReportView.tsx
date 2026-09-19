import React, { useState, useEffect, useCallback } from 'react';
import {
  getMonthlyStatement,
  downloadAuditCsv,
  MonthlyStatementData,
} from '../api/reporting.js';
import {
  Calendar,
  Download,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
  Receipt,
  ArrowDownRight,
  ArrowUpRight,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export const MonthlyReportView: React.FC = () => {
  const currentMonthYear = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthYear);
  const [statement, setStatement] = useState<MonthlyStatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

  const formatMonthMarathi = (ym: string) => {
    try {
      const [year, month] = ym.split('-').map(Number);
      const date = new Date(year, month - 1, 1);
      return date.toLocaleDateString('mr-IN', { month: 'long', year: 'numeric' });
    } catch {
      return ym;
    }
  };

  const handlePrevMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 2, 1);
    const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(ym);
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month, 1);
    const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(ym);
  };

  const fetchStatement = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMonthlyStatement(month);
      if (res.success && res.data) {
        setStatement(res.data);
      } else {
        setError(res.error || 'मासिक विवरण लोड करता आले नाही');
      }
    } catch (err: any) {
      setError(err.message || 'नेटवर्क त्रुटी आली');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatement(selectedMonth);
  }, [selectedMonth, fetchStatement]);

  const handleDownloadCsv = async () => {
    setDownloading(true);
    setDownloadFeedback(null);
    const res = await downloadAuditCsv(selectedMonth);
    if (res.success) {
      setDownloadFeedback('ऑडिट CSV फाईल यशस्वीरीत्या डाऊनलोड झाली!');
      setTimeout(() => setDownloadFeedback(null), 4000);
    } else {
      setDownloadFeedback(res.error || 'डाऊनलोड अयशस्वी');
      setTimeout(() => setDownloadFeedback(null), 4000);
    }
    setDownloading(false);
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Header & Month Selector */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">मासिक आर्थिक विवरण</h3>
              <p className="text-[11px] text-slate-500">अधिकृत लेजरवर आधारित हिशोब</p>
            </div>
          </div>
          <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-100 flex items-center gap-1 font-bold">
            <ShieldCheck className="w-3 h-3" />
            {statement ? `ऑडिट पडताळणी पूर्ण (${statement.transactionCount} नोंदी)` : 'ऑडिट सुरक्षित'}
          </span>
        </div>

        {/* Month Selector Bar with Marathi Month & Quick Navigation */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
              title="मागील महिना"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center">
              <span className="text-xs font-bold text-slate-800 block">
                {formatMonthMarathi(selectedMonth)}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedMonth}
              </span>
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
              title="पुढील महिना"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => {
                  if (e.target.value) setSelectedMonth(e.target.value);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
              />
            </div>

            <button
              onClick={handleDownloadCsv}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-xs shrink-0 disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
              ) : (
                <Download className="w-4 h-4 text-orange-400" />
              )}
              <span>CSV एक्सपोर्ट</span>
            </button>
          </div>
        </div>

        {downloadFeedback && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-2 animate-in fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            {downloadFeedback}
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && !statement && (
        <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          <span className="text-xs font-medium">मासिक विवरण लोड होत आहे...</span>
        </div>
      )}

      {/* Financial Statement Breakdown */}
      {statement && (
        <>
          {/* Main Net Balance Card */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-slate-800 rounded-2xl p-4 text-white shadow-md space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[11px] text-slate-400 font-medium">अखेरची शिल्लक (Closing Balance)</span>
                <div className="text-2xl font-black tracking-tight text-white mt-0.5">
                  ₹{statement.closingBalance.toLocaleString('en-IN')}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block font-medium">सुरुवातीची शिल्लक</span>
                <span className="text-xs font-bold text-slate-200 font-mono">
                  ₹{statement.openingBalance.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Inflow vs Outflow comparison */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/50">
              <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
                <div className="flex items-center gap-1.5 text-emerald-400 mb-1">
                  <ArrowDownRight className="w-4 h-4" />
                  <span className="text-[11px] font-bold">एकूण महिना जमा</span>
                </div>
                <div className="text-base font-black text-emerald-400">
                  + ₹{statement.inflows.totalInflow.toLocaleString('en-IN')}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 space-y-0.5 font-medium">
                  <div>• बीसी: ₹{statement.inflows.bishiCollection.toLocaleString('en-IN')}</div>
                  <div>• कर्ज परतफेड: ₹{statement.inflows.loanRepayments.toLocaleString('en-IN')}</div>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
                <div className="flex items-center gap-1.5 text-rose-400 mb-1">
                  <ArrowUpRight className="w-4 h-4" />
                  <span className="text-[11px] font-bold">एकूण खर्च व वाटप</span>
                </div>
                <div className="text-base font-black text-rose-400">
                  - ₹{statement.outflows.totalOutflow.toLocaleString('en-IN')}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 space-y-0.5 font-medium">
                  <div>• कर्ज वितरण: ₹{statement.outflows.loanDisbursements.toLocaleString('en-IN')}</div>
                  <div>• मंडळ खर्च: ₹{statement.outflows.expenses.toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>

            {/* Net Movement Indicator */}
            <div className="flex items-center justify-between text-[11px] bg-white/5 px-3 py-2 rounded-xl border border-white/10">
              <span className="text-slate-300">या महिन्यातील निव्वळ निधी बदल:</span>
              <span
                className={`font-black font-mono ${
                  statement.netMovement >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {statement.netMovement >= 0 ? '+ ' : '- '}₹
                {Math.abs(statement.netMovement).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Monthly Transactions Feed */}
          <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                महिन्यातील व्यवहार नोंद ({statement.transactionCount})
              </h4>
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedMonth}
              </span>
            </div>

            {statement.transactions.length === 0 ? (
              <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <Receipt className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
                <p className="text-xs text-slate-500 font-bold">सध्या कोणतेही व्यवहार उपलब्ध नाहीत.</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {formatMonthMarathi(selectedMonth)} या महिन्यासाठी कोणतीही नोंद आढळली नाही.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {statement.transactions.map((t) => {
                  const isInflow = t.transactionType === 'BISHI_PAYMENT' || t.transactionType === 'LOAN_REPAYMENT';
                  return (
                    <div
                      key={t.id}
                      className="p-3 bg-slate-50 hover:bg-slate-100/80 border border-slate-100 rounded-xl transition-all flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                              t.transactionType === 'BISHI_PAYMENT'
                                ? 'bg-orange-100 text-orange-700'
                                : t.transactionType === 'LOAN_REPAYMENT'
                                ? 'bg-emerald-100 text-emerald-700'
                                : t.transactionType === 'LOAN_DISBURSED'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {t.transactionTypeMarathi}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {t.transactionNumber}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-slate-800">
                          {t.memberName || (t.transactionType === 'EXPENSE' ? 'मंडळ खर्च' : 'अज्ञात')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          दिनांक: {t.transactionDate} • नोंदणी: {t.actorName}
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`text-sm font-black font-mono block ${
                            isInflow ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isInflow ? '+ ' : '- '}₹{t.amount.toLocaleString('en-IN')}
                        </span>
                        <span className="text-[9px] text-slate-400 block font-medium">
                          {t.paymentMethod}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
