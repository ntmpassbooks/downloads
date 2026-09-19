import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  X,
  QrCode,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  RefreshCw,
  Receipt as ReceiptIcon,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import {
  createPaymentOrder,
  getOrderStatus,
  CreateOrderResponse,
  SUPPORTED_BANKS,
} from '../api/payments.js';

interface PaymentModalProps {
  isOpen: boolean;
  bishiRecordId: string;
  monthYear: string;
  expectedAmount: number;
  onClose: () => void;
  onPaymentSuccess?: (transactionId?: string) => void;
  onViewReceipt?: (transactionId: string) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  bishiRecordId,
  monthYear,
  expectedAmount,
  onClose,
  onPaymentSuccess,
  onViewReceipt,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<CreateOrderResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900); // 15 mins default
  const [isPaid, setIsPaid] = useState(false);
  const [paidTxnId, setPaidTxnId] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const pollIntervalRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);

  // Initialize or reset modal
  useEffect(() => {
    if (isOpen && bishiRecordId) {
      setIsPaid(false);
      setPaidTxnId(null);
      setError(null);
      setQrDataUrl(null);
      setOrderData(null);
      initOrder();
    } else {
      cleanupTimers();
    }

    return () => {
      cleanupTimers();
    };
  }, [isOpen, bishiRecordId]);

  const cleanupTimers = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  };

  const initOrder = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await createPaymentOrder(bishiRecordId);
      if (res.success && res.data) {
        const data = res.data;
        setOrderData(data);

        // Generate QR code data URL
        const targetUrl = data.upiIntentUrl || `upi://pay?pa=${encodeURIComponent('mandal@upi')}&pn=${encodeURIComponent(data.accountName)}&am=${data.order.amount.toFixed(2)}&cu=INR`;
        const qrUrl = await QRCode.toDataURL(targetUrl, {
          width: 260,
          margin: 1.5,
          color: {
            dark: '#1e293b',
            light: '#ffffff',
          },
        });
        setQrDataUrl(qrUrl);

        // Compute remaining seconds from order.expiresAt
        const expiresAtMs = new Date(data.order.expiresAt).getTime();
        const initialRemaining = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
        setSecondsRemaining(initialRemaining);

        // Start countdown timer
        countdownIntervalRef.current = setInterval(() => {
          setSecondsRemaining((prev) => {
            if (prev <= 1) {
              clearInterval(countdownIntervalRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        // Start automatic polling every 3.5 seconds
        startPolling(data.order.id);
      } else {
        setError(
          res.error ||
            'मंडळाची ऑनलाइन भरणा सुविधा सध्या उपलब्ध नाही. कृपया अध्यक्षांशी संपर्क साधा किंवा रोख भरणा करा.'
        );
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही. कृपया थोड्या वेळाने प्रयत्न करा.');
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (orderId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const statusRes = await getOrderStatus(orderId);
        if (statusRes.success && statusRes.data) {
          if (statusRes.data.status === 'PAID' || statusRes.data.status === 'SUCCESS') {
            handlePaidSuccess(statusRes.data.financialTransactionId || undefined);
          } else if (statusRes.data.status === 'EXPIRED') {
            cleanupTimers();
            setError('पेमेंटची मुदत संपली आहे. कृपया नवीन व्यवहार सुरू करा.');
          }
        }
      } catch {
        // Silent poll error handling
      }
    }, 3500);
  };

  const handleManualCheckStatus = async () => {
    if (!orderData || checkingStatus || isPaid) return;
    setCheckingStatus(true);
    try {
      const statusRes = await getOrderStatus(orderData.order.id);
      if (statusRes.success && statusRes.data) {
        if (statusRes.data.status === 'PAID' || statusRes.data.status === 'SUCCESS') {
          handlePaidSuccess(statusRes.data.financialTransactionId || undefined);
        } else if (statusRes.data.status === 'EXPIRED') {
          cleanupTimers();
          setError('पेमेंटची मुदत संपली आहे. कृपया नवीन व्यवहार सुरू करा.');
        } else {
          setError('व्यवहाराची सर्व्हरकडून पुष्टी मिळालेली नाही. कृपया पुन्हा प्रयत्न करण्यापूर्वी व्यवहाराची स्थिती तपासा.');
        }
      } else {
        setError(
          statusRes.error ||
            'व्यवहाराची सर्व्हरकडून पुष्टी मिळालेली नाही. कृपया पुन्हा प्रयत्न करण्यापूर्वी व्यवहाराची स्थिती तपासा.'
        );
      }
    } catch {
      setError('व्यवहाराची सर्व्हरकडून पुष्टी मिळालेली नाही. कृपया पुन्हा प्रयत्न करण्यापूर्वी व्यवहाराची स्थिती तपासा.');
    } finally {
      setCheckingStatus(false);
    }
  };


  const handlePaidSuccess = (txnId?: string) => {
    cleanupTimers();
    setIsPaid(true);
    if (txnId) setPaidTxnId(txnId);
    if (onPaymentSuccess) onPaymentSuccess(txnId);
  };

  if (!isOpen) return null;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-[calc(100vw-24px)] sm:max-w-sm bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-3 sm:px-5 sm:py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs shrink-0">
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold leading-tight truncate">ऑनलाइन बीशी भरणा</h3>
              <p className="text-[11px] text-orange-100 mt-0.5 truncate">UPI / QR कोड द्वारे त्वरित भरणा</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center transition-all min-h-[44px] min-w-[44px] shrink-0"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 max-h-[calc(85vh-72px)] overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-10 h-10 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">सुरक्षित भरणा QR तयार होत आहे...</p>
            </div>
          ) : isPaid ? (
            /* Success View */
            <div className="py-6 text-center space-y-4 animate-in fade-in duration-300">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div className="space-y-1">
                <h4 className="text-base font-bold text-slate-900">भरणा यशस्वी झाला!</h4>
                <p className="text-xs text-slate-500">
                  {monthYear} महिन्याचा बीशी हप्ता अधिकृतपणे जमा झाला आहे.
                </p>
              </div>

              <div className="p-4 bg-emerald-50 border border-emerald-200/80 rounded-2xl text-left space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">जमा झालेली रक्कम:</span>
                  <strong className="font-bold text-slate-900 font-mono">
                    ₹{orderData?.order.amount || expectedAmount}
                  </strong>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">भरणा पद्धत:</span>
                  <span className="font-bold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full text-[10px]">
                    ऑनलाइन UPI (Online)
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">स्थिती:</span>
                  <span className="font-bold text-emerald-700">भरणा पूर्ण (PAID)</span>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                {paidTxnId && onViewReceipt && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onViewReceipt(paidTxnId);
                    }}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
                  >
                    <ReceiptIcon className="w-4 h-4" />
                    डिजिटल पावती पहा
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-bold text-xs transition-all"
                >
                  बंद करा
                </button>
              </div>
            </div>
          ) : error ? (
            /* Error / Blocked View */
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-8 h-8" />
              </div>

              <div className="space-y-1 px-2">
                <h4 className="text-sm font-bold text-slate-800">ऑनलाइन भरणा उपलब्ध नाही</h4>
                <p className="text-xs text-slate-500 leading-relaxed">{error}</p>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={initOrder}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  पुन्हा प्रयत्न करा
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-bold text-xs transition-all"
                >
                  रद्द करा
                </button>
              </div>
            </div>
          ) : orderData && qrDataUrl ? (
            /* QR & UPI Intent View */
            <div className="space-y-4 text-center">
              {/* Mandal Payee Banner */}
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between text-left">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-slate-800 truncate max-w-[170px]">
                      {orderData.accountName}
                    </h5>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span>{SUPPORTED_BANKS.find((b) => b.code === orderData.bank)?.marathiName || orderData.bank} (चालू खाते)</span>
                      <span>•</span>
                      <span className="font-mono">हप्ता: {monthYear}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-medium">रक्कम</span>
                  <strong className="text-sm font-bold text-slate-900 font-mono block">
                    ₹{orderData.order.amount}
                  </strong>
                </div>
              </div>

              {/* Dynamic QR Code Card */}
              <div className="p-4 bg-white rounded-2xl border-2 border-dashed border-orange-200 inline-block mx-auto shadow-xs">
                <img
                  src={qrDataUrl}
                  alt="UPI QR Code"
                  className="w-44 h-44 min-[360px]:w-52 min-[360px]:h-52 mx-auto rounded-lg shadow-xs"
                />
                <p className="text-[11px] font-bold text-slate-700 mt-2">
                  कोणत्याही UPI ॲपने स्कॅन करा
                </p>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  Google Pay • PhonePe • Paytm • BHIM
                </p>
              </div>

              {/* Expiration Timer & Auto-Polling Indicator */}
              <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-600">
                <Clock className="w-4 h-4 text-amber-500 animate-pulse" />
                <span>मुदत:</span>
                <span className="font-mono font-bold text-amber-600">{formattedTime}</span>
              </div>

              {/* Mobile 1-Click UPI Intent Button */}
              {orderData.upiIntentUrl && (
                <a
                  href={orderData.upiIntentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-orange-600/20 transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  UPI ॲपने त्वरित भरा (GPay / PhonePe)
                </a>
              )}

              {/* Manual Check Status Button */}
              <button
                type="button"
                disabled={checkingStatus}
                onClick={handleManualCheckStatus}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
                {checkingStatus ? 'तपासत आहे...' : 'भरणा स्थिती तपासा'}
              </button>

              {/* Security Footnote */}
              <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>256-Bit एनक्रिप्टेड • अधिकृत डिजिटल पावती त्वरित मिळेल</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
