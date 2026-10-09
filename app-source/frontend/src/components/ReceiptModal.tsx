import React, { useState, useEffect } from 'react';
import { getTransactionReceipt, TransactionReceipt } from '../api/ledger.js';
import { downloadReceiptPdf } from '../api/reporting.js';
import { strings } from '../i18n/mr.js';
import {
  X,
  Receipt,
  Printer,
  Download,
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
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (!receipt) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      alert('इंटरनेट कनेक्शन उपलब्ध नाही. ऑफलाइन असताना पावती डाऊनलोड करता येत नाही.');
      return;
    }
    setDownloadingPdf(true);
    try {
      const res = await downloadReceiptPdf(receipt.transactionId, receipt.transactionNumber);
      if (!res.success) {
        alert(res.error || 'पावती डाऊनलोड अयशस्वी झाली.');
      }
    } finally {
      setDownloadingPdf(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !transactionId) {
      setReceipt(null);
      setError(null);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setReceipt(null);
      setError('इंटरनेट कनेक्शन उपलब्ध नाही. अधिकृत पावती तपशील आणि पीडीएफ डाऊनलोड करण्यासाठी इंटरनेट आवश्यक आहे.');
      setLoading(false);
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
    if (!receipt) return;

    try {
      // Build an isolated printable iframe to guarantee pure receipt output
      // with zero app navigation, backdrop shadows, or control buttons
      const printFrame = document.createElement('iframe');
      printFrame.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;');
      document.body.appendChild(printFrame);

      const frameDoc = printFrame.contentWindow?.document;
      if (frameDoc) {
        const methodBadge =
          receipt.paymentMethod === 'CASH'
            ? 'रोख (CASH)'
            : 'ऑनलाइन (ONLINE)';

        const txnType =
          receipt.transactionType === 'LOAN_REPAYMENT'
            ? 'कर्ज परतफेड'
            : receipt.transactionType === 'BISHI_PAYMENT'
            ? 'बिशी हप्ता जमा'
            : receipt.transactionType === 'LOAN_DISBURSED'
            ? 'कर्ज वाटप'
            : receipt.transactionType || 'पावती';

        frameDoc.open();
        frameDoc.write(`
          <!DOCTYPE html>
          <html lang="mr">
          <head>
            <meta charset="UTF-8">
            <title>पावती - ${receipt.receiptNumber}</title>
            <style>
              @page { size: A4 portrait; margin: 15mm 15mm 20mm 15mm; }
              body {
                font-family: 'Noto Sans Devanagari', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #0f172a;
                margin: 0;
                padding: 10px;
                background: #ffffff;
                line-height: 1.5;
              }
              .receipt-container {
                max-width: 600px;
                margin: 0 auto;
                border: 2px solid #059669;
                border-radius: 16px;
                padding: 24px;
                background: #ffffff;
              }
              .header {
                text-align: center;
                border-bottom: 2px dashed #cbd5e1;
                padding-bottom: 16px;
                margin-bottom: 16px;
              }
              .mandal-title {
                font-size: 24px;
                font-weight: 800;
                color: #065f46;
                margin-bottom: 4px;
              }
              .mandal-code {
                font-size: 13px;
                color: #475569;
                font-weight: 600;
              }
              .rcp-chip {
                display: inline-block;
                margin-top: 10px;
                padding: 4px 14px;
                background: #ecfdf5;
                color: #065f46;
                border: 1px solid #a7f3d0;
                border-radius: 8px;
                font-weight: 700;
                font-size: 14px;
              }
              .amount-box {
                background: #0f172a;
                color: #ffffff;
                padding: 16px 20px;
                border-radius: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin: 16px 0;
              }
              .amount-label {
                font-size: 13px;
                color: #94a3b8;
              }
              .amount-value {
                font-size: 26px;
                font-weight: 800;
                color: #34d399;
                font-family: monospace;
              }
              .badge-confirmed {
                font-size: 12px;
                font-weight: 700;
                background: #065f46;
                color: #a7f3d0;
                padding: 4px 10px;
                border-radius: 6px;
                border: 1px solid #047857;
              }
              table.details-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 12px;
                font-size: 14px;
              }
              table.details-table td {
                padding: 10px 8px;
                border-bottom: 1px solid #f1f5f9;
              }
              table.details-table td.lbl {
                color: #64748b;
                width: 45%;
                font-weight: 500;
              }
              table.details-table td.val {
                font-weight: 700;
                color: #0f172a;
                text-align: right;
              }
              .signatures {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px dashed #cbd5e1;
              }
              .sig-block {
                text-align: center;
                font-size: 12px;
                color: #475569;
              }
              .sig-line {
                width: 140px;
                border-top: 1px solid #64748b;
                margin-bottom: 6px;
              }
              .footer-watermark {
                text-align: center;
                font-size: 11px;
                color: #94a3b8;
                margin-top: 24px;
              }
            </style>
          </head>
          <body>
            <div class="receipt-container">
              <div class="header">
                <div class="mandal-title">${receipt.organization.name}</div>
                <div class="mandal-code">
                  संकेतांक: ${receipt.organization.code}
                  ${receipt.organization.registrationNumber ? `• नोंदणी: ${receipt.organization.registrationNumber}` : ''}
                </div>
                <div class="rcp-chip">अधिकृत पावती क्र: ${receipt.receiptNumber}</div>
              </div>

              <div class="amount-box">
                <div>
                  <div class="amount-label">जमा रक्कम</div>
                  <div class="amount-value">₹${receipt.amount}</div>
                </div>
                <div style="text-align:right;">
                  <span class="badge-confirmed">✓ निश्चित (CONFIRMED)</span>
                  <div style="font-size:12px;color:#cbd5e1;margin-top:4px;">${methodBadge}</div>
                </div>
              </div>

              <table class="details-table">
                <tr>
                  <td class="lbl">सदस्याचे नाव:</td>
                  <td class="val">${receipt.member.fullName}</td>
                </tr>
                <tr>
                  <td class="lbl">मोबाईल क्रमांक:</td>
                  <td class="val">+91 ${receipt.member.phone}</td>
                </tr>
                <tr>
                  <td class="lbl">व्यवहार प्रकार:</td>
                  <td class="val">${txnType}</td>
                </tr>
                ${receipt.bishiMonth ? `<tr><td class="lbl">बिशी महिना:</td><td class="val">${receipt.bishiMonth}</td></tr>` : ''}
                <tr>
                  <td class="lbl">भरणा पद्धत:</td>
                  <td class="val">${methodBadge}</td>
                </tr>
                <tr>
                  <td class="lbl">दिनांक व वेळ:</td>
                  <td class="val">${formatDate(receipt.transactionDate)}</td>
                </tr>
                <tr>
                  <td class="lbl">नोंद / मंजुरी अधिकारी:</td>
                  <td class="val">${receipt.recordedBy.fullName} (${receipt.recordedBy.role === 'TREASURER' ? 'खजिनदार' : 'अध्यक्ष'})</td>
                </tr>
                <tr>
                  <td class="lbl">लेजर व्यवहार संदर्भ क्र:</td>
                  <td class="val" style="font-family:monospace;font-size:12px;">${receipt.transactionNumber}</td>
                </tr>
                ${receipt.notes ? `<tr><td class="lbl">नोंद:</td><td class="val" style="font-style:italic;">${receipt.notes}</td></tr>` : ''}
              </table>

              <div class="signatures">
                <div class="sig-block">
                  <div class="sig-line"></div>
                  <div>सदस्य स्वाक्षरी</div>
                </div>
                <div class="sig-block">
                  <div class="sig-line"></div>
                  <div>अधिकृत स्वाक्षरी (${receipt.recordedBy.role === 'TREASURER' ? 'खजिनदार' : 'अध्यक्ष'})</div>
                </div>
              </div>

              <div class="footer-watermark">
                NTM Passbook डिजिटल आर्थिक नोंदणी प्रणाली द्वारे व्युत्पन्न अधिकृत पावती
              </div>
            </div>
          </body>
          </html>
        `);
        frameDoc.close();

        setTimeout(() => {
          try {
            printFrame.contentWindow?.focus();
            printFrame.contentWindow?.print();
          } catch {
            window.print();
          } finally {
            setTimeout(() => {
              if (document.body.contains(printFrame)) {
                document.body.removeChild(printFrame);
              }
            }, 3000);
          }
        }, 300);
        return;
      }
    } catch {
      // Fallback directly to window.print()
      window.print();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="w-full max-w-[calc(100%-0.5rem)] sm:max-w-[420px] bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col my-auto border border-slate-100 max-h-[90dvh]">
        {/* Modal Top Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h4 id="receipt-dialog-title" className="text-sm font-bold tracking-wide">
                {strings.receipt.title}
              </h4>
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
                  <span className="text-[10px] text-slate-300 font-medium">
                    {receipt.paymentMethod === 'CASH'
                      ? '💵 रोख (CASH)'
                      : receipt.paymentMethod === 'ONLINE' || receipt.paymentMethod === 'ONLINE_UPI'
                      ? '📱 ऑनलाइन (ONLINE)'
                      : receipt.paymentMethod}
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
                  <span className="font-bold text-slate-800 text-right truncate min-w-0 flex-1">
                    {receipt.member.fullName}
                  </span>
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
                    {receipt.paymentMethod === 'CASH'
                      ? '💵 रोख (Cash)'
                      : '📱 ऑनलाइन (Online)'}
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
              <div className="flex flex-col sm:flex-row gap-2 pt-1 no-print">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer min-h-[44px] disabled:opacity-50"
                >
                  {downloadingPdf ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <Download className="w-4 h-4 text-white" />
                  )}
                  <span>PDF पावती डाऊनलोड</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer min-h-[44px]"
                >
                  <Printer className="w-4 h-4" />
                  <span>{strings.receipt.printButton}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-semibold text-xs rounded-xl transition-all cursor-pointer min-h-[44px]"
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
