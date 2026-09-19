import React, { useState, useEffect } from 'react';
import { getTransactionReceipt, TransactionReceipt } from '../api/ledger.js';
import { strings } from '../i18n/mr.js';
import {
  X,
  Receipt,
  Printer,
  Building2,
  User,
  Phone,
  Calendar,
  CreditCard,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';

interface ReceiptModalProps {
  transactionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  transactionId,
  isOpen,
  onClose,
}) => {
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !transactionId) {
      setReceipt(null);
      setError(null);
      return;
    }

    let isMounted = true;
    const fetchReceipt = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getTransactionReceipt(transactionId);
        if (isMounted) {
          if (res.success && res.data) {
            setReceipt(res.data);
          } else {
            setError(res.error || strings.receipt.notFound);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || strings.receipt.notFound);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchReceipt();
    return () => {
      isMounted = false;
    };
  }, [isOpen, transactionId]);

  if (!isOpen) return null;

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat('mr-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="w-full max-w-[calc(100%-0.5rem)] sm:max-w-[380px] bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col my-auto border border-slate-100 max-h-[85dvh]">
        {/* Modal Top Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold tracking-wide">{strings.receipt.title}</h4>
              <p className="text-[10px] text-slate-300">{strings.receipt.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={strings.receipt.closeButton}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 text-white transition-all active:scale-95 cursor-pointer -mr-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 space-y-3.5 overflow-y-auto flex-1">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
              <p className="text-xs font-semibold">{strings.receipt.loading}</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl space-y-2 text-center">
              <AlertTriangle className="w-6 h-6 text-red-500 mx-auto" />
              <p className="text-xs font-bold text-red-800">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 px-4 py-1.5 bg-white border border-red-200 rounded-xl text-xs font-semibold text-red-700 hover:bg-red-50 transition-all"
              >
                {strings.receipt.closeButton}
              </button>
            </div>
          )}

          {receipt && !loading && (
            <div id="printable-receipt" className="space-y-3.5">
              {/* Mandal & Receipt Numbers Header Card */}
              <div className="p-3 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl text-center space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-950">
                  <Building2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{receipt.organization.name}</span>
                </div>
                <div className="flex items-center justify-center gap-2 text-[10px] text-emerald-800 font-medium">
                  <span>संकेतांक: {receipt.organization.code}</span>
                  {receipt.organization.registrationNumber && (
                    <span>• नोंदणी: {receipt.organization.registrationNumber}</span>
                  )}
                </div>
                <div className="pt-1 border-t border-emerald-200/60 flex items-center justify-between text-[11px]">
                  <span className="text-emerald-900 font-semibold">{strings.receipt.receiptNumber}:</span>
                  <span className="font-mono font-bold text-emerald-950 bg-emerald-100/80 px-2 py-0.5 rounded-md border border-emerald-300/60">
                    {receipt.receiptNumber}
                  </span>
                </div>
              </div>

              {/* Amount & Status Badge */}
              <div className="p-3.5 bg-slate-900 text-white rounded-2xl flex items-center justify-between shadow-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">{strings.receipt.amount}</span>
                  <span className="text-xl font-extrabold text-emerald-400 font-mono">
                    ₹{receipt.amount}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{strings.receipt.statusConfirmed}</span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {receipt.paymentMethod === 'CASH' ? strings.passbook.methodCash : receipt.paymentMethod}
                  </span>
                </div>
              </div>

              {/* Key Details Breakdown */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 divide-y divide-slate-200/70 text-xs">
                <div className="pb-2 flex justify-between items-center gap-2">
                  <span className="text-slate-500 flex items-center gap-1.5 shrink-0">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>{strings.receipt.memberName}</span>
                  </span>
                  <span className="font-bold text-slate-800 text-right truncate min-w-0 flex-1">{receipt.member.fullName}</span>
                </div>

                <div className="py-2 flex justify-between items-center">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{strings.receipt.memberPhone}</span>
                  </span>
                  <span className="font-mono text-slate-700">{receipt.member.phone}</span>
                </div>

                <div className="py-2 flex justify-between items-center">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-slate-400" />
                    <span>{strings.receipt.txnType}</span>
                  </span>
                  <span className="font-bold text-slate-800">
                    {receipt.transactionType === 'LOAN_REPAYMENT'
                      ? strings.receipt.typeLoanRepayment
                      : receipt.transactionType === 'BISHI_PAYMENT'
                      ? strings.receipt.typeBishiPayment
                      : receipt.transactionType === 'LOAN_DISBURSED'
                      ? 'कर्ज वाटप'
                      : receipt.transactionType || 'पावती'}
                  </span>
                </div>

                {receipt.bishiMonth && (
                  <div className="py-2 flex justify-between items-center">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{strings.receipt.bishiMonth}</span>
                    </span>
                    <span className="font-bold text-slate-800">{receipt.bishiMonth}</span>
                  </div>
                )}

                <div className="py-2 flex justify-between items-center">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                    <span>{strings.receipt.paymentMethod}</span>
                  </span>
                  <span className="font-bold text-emerald-800">
                    {receipt.paymentMethod === 'CASH' ? 'रोख (Cash)' : receipt.paymentMethod}
                  </span>
                </div>

                <div className="py-2 flex justify-between items-center">
                  <span className="text-slate-500">{strings.receipt.paymentDate}</span>
                  <span className="font-semibold text-slate-700 text-[11px]">
                    {formatDate(receipt.transactionDate)}
                  </span>
                </div>

                <div className="py-2 flex justify-between items-center">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                    <span>{strings.receipt.recordedBy}</span>
                  </span>
                  <span className="font-semibold text-slate-800 text-right">
                    {receipt.recordedBy.fullName} ({receipt.recordedBy.role === 'TREASURER' ? 'खजिनदार' : 'अध्यक्ष'})
                  </span>
                </div>

                <div className="pt-2 flex justify-between items-center">
                  <span className="text-slate-500">{strings.receipt.transactionNumber}</span>
                  <span className="font-mono text-[10px] text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                    {receipt.transactionNumber}
                  </span>
                </div>

                {receipt.notes && (
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-slate-500">{strings.receipt.notes}</span>
                    <span className="text-slate-700 italic text-[11px]">{receipt.notes}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1 no-print">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>{strings.receipt.printButton}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-semibold text-xs rounded-xl transition-all cursor-pointer"
                >
                  {strings.receipt.closeButton}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
