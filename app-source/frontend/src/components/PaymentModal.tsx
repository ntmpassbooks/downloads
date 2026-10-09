import React, { useState, useEffect } from 'react';
import { ModalPortal } from './ModalPortal.js';
import QRCode from 'qrcode';
import {
  X,
  QrCode,
  Banknote,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Info,
  Clock,
  Send,
  Loader2,
} from 'lucide-react';
import {
  createPaymentOrder,
  getPaymentConfig,
  PaymentConfig,
  PaymentOrder,
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
}) => {
  const [activeTab, setActiveTab] = useState<'ONLINE' | 'CASH'>('ONLINE');
  const [loading, setLoading] = useState(false);
  const [submittingNotice, setSubmittingNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [generatedQr, setGeneratedQr] = useState<string | null>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [noticeSent, setNoticeSent] = useState(false);

  useEffect(() => {
    if (isOpen && bishiRecordId) {
      setError(null);
      setNoticeSent(false);
      setOrder(null);
      setCopiedUpi(false);
      loadPaymentDetails();
    }
  }, [isOpen, bishiRecordId]);

  const loadPaymentDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const configRes = await getPaymentConfig();
      if (configRes.success && configRes.data) {
        setConfig(configRes.data);

        // If upiId exists and no static QR image, generate QR code from UPI URL
        if (configRes.data.upiId && !configRes.data.qrCodeData) {
          const upiUrl = `upi://pay?pa=${encodeURIComponent(configRes.data.upiId)}&pn=${encodeURIComponent('NTM Passbook')}&am=${expectedAmount.toFixed(2)}&cu=INR`;
          try {
            const qrUrl = await QRCode.toDataURL(upiUrl, {
              width: 240,
              margin: 1.5,
              color: { dark: '#1e293b', light: '#ffffff' },
            });
            setGeneratedQr(qrUrl);
          } catch {
            setGeneratedQr(null);
          }
        }
      } else {
        setConfig(null);
      }
    } catch {
      setError('भरणा माहिती लोड करताना अडचण आली.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUpi = () => {
    if (!config?.upiId) return;
    navigator.clipboard.writeText(config.upiId);
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const handleSubmitOnlineNotice = async () => {
    setSubmittingNotice(true);
    setError(null);
    try {
      const res = await createPaymentOrder(bishiRecordId);
      if (res.success && res.data) {
        setOrder(res.data.order);
        setNoticeSent(true);
      } else {
        setError(res.error || 'भरणा सूचना पाठवता आली नाही.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setSubmittingNotice(false);
    }
  };

  if (!isOpen) return null;

  const isOnlineAvailable = Boolean(config?.isActive && (config.upiId || config.qrCodeData || config.hasQrCode));
  const qrImageToDisplay = config?.qrCodeData || generatedQr;
  const upiIntentUrl = config?.upiId
    ? `upi://pay?pa=${encodeURIComponent(config.upiId)}&pn=${encodeURIComponent('NTM Passbook')}&am=${expectedAmount.toFixed(2)}&cu=INR`
    : undefined;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div className="relative w-full max-w-[calc(100vw-24px)] sm:max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-3 sm:px-5 sm:py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs shrink-0">
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold leading-tight truncate">बीशी हप्ता भरणा</h3>
              <p className="text-[11px] text-orange-100 mt-0.5 truncate">
                महिना: {monthYear} • देय रक्कम: ₹{expectedAmount}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center transition-all min-h-[44px] min-w-[44px] shrink-0 cursor-pointer"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Payment Method Tabs: CASH vs ONLINE */}
        <div className="p-3 bg-slate-50 border-b border-slate-200">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('ONLINE')}
              className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer min-h-[42px] ${
                activeTab === 'ONLINE'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>📱 ऑनलाइन (ONLINE)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('CASH')}
              className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer min-h-[42px] ${
                activeTab === 'CASH'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Banknote className="w-4 h-4" />
              <span>💵 रोख (CASH)</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 max-h-[calc(85vh-140px)] overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-orange-500 animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">भरणा माहिती लोड होत आहे...</p>
            </div>
          ) : activeTab === 'CASH' ? (
            /* CASH SECTION */
            <div className="space-y-4 py-2">
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl text-center space-y-2.5">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <Banknote className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-emerald-900">रोख भरणा सूचना</h4>
                <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                  कृपया अध्यक्ष / खजिनदार यांच्याकडे रोख रक्कम जमा करा.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
                <div className="flex justify-between items-center text-slate-600">
                  <span>हप्ता महिना:</span>
                  <strong className="font-bold text-slate-800 font-mono">{monthYear}</strong>
                </div>
                <div className="flex justify-between items-center text-slate-600">
                  <span>भरणा रक्कम:</span>
                  <strong className="font-bold text-slate-800 font-mono text-sm">₹{expectedAmount}</strong>
                </div>
                <div className="flex justify-between items-center text-slate-600">
                  <span>भरणा पद्धत:</span>
                  <span className="font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full text-[10px]">
                    रोख (CASH)
                  </span>
                </div>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-2 text-[11px] text-blue-900 leading-relaxed">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  रोख रक्कम प्रत्यक्ष प्राप्त झाल्यावर अध्यक्ष किंवा खजिनदार आपल्या खात्यात जमा नोंदवतील आणि डिजिटल पावती उपलब्ध होईल.
                </span>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-bold text-xs transition-all cursor-pointer"
              >
                बंद करा
              </button>
            </div>
          ) : (
            /* ONLINE SECTION */
            <div className="space-y-4">
              {!isOnlineAvailable ? (
                /* Online NOT configured or disabled */
                <div className="py-6 text-center space-y-3">
                  <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">ऑनलाइन भरणा सध्या बंद आहे</h4>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                    मंडळाने सध्या ऑनलाइन भरणा सेवा सुरू केलेली नाही. कृपया अध्यक्षांशी संपर्क साधा किंवा रोख भरणा करा.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('CASH')}
                    className="mt-2 py-2 px-4 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition-all cursor-pointer"
                  >
                    रोख भरणा तपशील पहा
                  </button>
                </div>
              ) : noticeSent ? (
                /* Notice Submitted View */
                <div className="py-6 text-center space-y-4 animate-in fade-in duration-200">
                  <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
                    <Clock className="w-8 h-8" />
                  </div>

                  <div className="space-y-1">
                    <h4 className="text-base font-bold text-slate-900">पडताळणी प्रलंबित</h4>
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">
                      <Clock className="w-3.5 h-3.5" />
                      पडताळणी सूचना पाठवली आहे
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed px-2">
                    आपली ऑनलाइन भरणा सूचना मंडळाकडे पाठवली आहे. अध्यक्ष किंवा खजिनदार बँक खात्याची पडताळणी करून भरणा मंजूर करतील. तोपर्यंत हप्ता प्रलंबित राहील.
                  </p>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-left space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">रक्कम:</span>
                      <strong className="font-mono text-slate-800">₹{expectedAmount}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">महिना:</span>
                      <strong className="font-mono text-slate-800">{monthYear}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">स्थिती:</span>
                      <strong className="text-amber-700 font-bold">{order?.status || 'ONLINE_PENDING'}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 active:scale-98 text-white font-bold text-xs transition-all cursor-pointer shadow-sm"
                  >
                    ठीक आहे
                  </button>
                </div>
              ) : (
                /* Online Available - Pay via UPI / QR and Submit Notice */
                <div className="space-y-4 text-center">
                  {/* Amount Badge */}
                  <div className="p-3 bg-orange-50/60 rounded-2xl border border-orange-200/70 flex items-center justify-between text-left">
                    <div>
                      <span className="text-[11px] text-orange-950 font-medium block">
                        हप्ता: {monthYear}
                      </span>
                      <span className="text-[10px] text-orange-800 font-semibold">
                        मंडळ अधिकृत भरणा
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-medium">रक्कम</span>
                      <strong className="text-base font-bold text-slate-900 font-mono block">
                        ₹{expectedAmount}
                      </strong>
                    </div>
                  </div>

                  {/* QR Code Display (if available) */}
                  {qrImageToDisplay && (
                    <div className="p-3.5 bg-white rounded-2xl border-2 border-dashed border-orange-200 inline-block mx-auto shadow-xs">
                      <img
                        src={qrImageToDisplay}
                        alt="Mandal Payment QR"
                        className="w-48 h-48 mx-auto object-contain rounded-lg"
                      />
                      <p className="text-[11px] font-bold text-slate-700 mt-2">
                        कोणत्याही UPI ॲपने स्कॅन करून पैसे पाठवा
                      </p>
                      <p className="text-[9px] text-slate-400 mt-0.5">
                        Google Pay • PhonePe • Paytm • BHIM
                      </p>
                    </div>
                  )}

                  {/* UPI ID Display & Copy Button (if available) */}
                  {config?.upiId && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">मंडळाचा UPI आयडी:</span>
                        <button
                          type="button"
                          onClick={handleCopyUpi}
                          className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          {copiedUpi ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-600">कॉपी झाले!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>कॉपी करा</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-slate-200 text-xs font-mono font-bold text-slate-800 select-all text-center">
                        {config.upiId}
                      </div>
                    </div>
                  )}

                  {/* Open UPI App link button on mobile */}
                  {upiIntentUrl && (
                    <a
                      href={upiIntentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-black active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all"
                    >
                      <ExternalLink className="w-4 h-4" />
                      UPI ॲप उघडा (GPay / PhonePe)
                    </a>
                  )}

                  {/* Notes / Special Instructions */}
                  {config?.notes && (
                    <div className="p-2.5 bg-amber-50/60 border border-amber-200/80 rounded-xl text-left text-[11px] text-amber-900 leading-relaxed">
                      <strong>सूचना:</strong> {config.notes}
                    </div>
                  )}

                  {/* Submit Payment Notice Action */}
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] text-slate-500 text-left">
                      💡 पैसे पाठवल्यानंतर खालील बटणावर क्लिक करून अध्यक्षांना सूचना पाठवा:
                    </p>
                    <button
                      type="button"
                      disabled={submittingNotice}
                      onClick={handleSubmitOnlineNotice}
                      className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {submittingNotice ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>सूचना पाठवत आहे...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>मी पेमेंट केले — पडताळणीसाठी पाठवा</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>पडताळणीनंतर अधिकृत पावती त्वरित मिळेल</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  </ModalPortal>
  );
};
