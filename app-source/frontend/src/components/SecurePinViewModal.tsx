import React, { useState, useEffect } from 'react';
import {
  X,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Eye,
  EyeOff,
  Clock,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { ApiResponse } from '../api/client.js';
import { ModalPortal } from './ModalPortal';

interface SecurePinViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  targetName?: string;
  fetchPin: () => Promise<ApiResponse<{ isRecoverable: boolean; pin?: string; message?: string }>>;
}

export const SecurePinViewModal: React.FC<SecurePinViewModalProps> = ({
  isOpen,
  onClose,
  title,
  targetName,
  fetchPin,
}) => {
  const [step, setStep] = useState<'confirm' | 'revealed' | 'not_recoverable' | 'error'>('confirm');
  const [pin, setPin] = useState<string | null>(null);
  const [isMasked, setIsMasked] = useState(true);
  const [countdown, setCountdown] = useState(30);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hard reset function to immediately wipe sensitive state from volatile memory
  const wipeMemory = () => {
    setPin(null);
    setIsMasked(true);
    setCountdown(30);
    setLoading(false);
    setErrorMsg(null);
    setStep('confirm');
  };

  const handleClose = () => {
    wipeMemory();
    onClose();
  };

  // Reset state whenever modal closes or opens
  useEffect(() => {
    if (!isOpen) {
      wipeMemory();
    }
  }, [isOpen]);

  // 30-second auto-hide countdown
  useEffect(() => {
    if (step !== 'revealed' || !pin) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleClose();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step, pin]);

  if (!isOpen) return null;

  const handleConfirmReveal = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetchPin();
      if (res.success && res.data) {
        if (!res.data.isRecoverable) {
          setStep('not_recoverable');
        } else if (res.data.pin) {
          setPin(res.data.pin);
          setIsMasked(true); // Masked by default for shoulder-surfing protection
          setCountdown(30);
          setStep('revealed');
        } else {
          setErrorMsg(res.data.message || 'पिन माहिती उपलब्ध नाही.');
          setStep('error');
        }
      } else {
        setErrorMsg(res.error || 'पिन तपासताना त्रुटी निर्माण झाली.');
        setStep('error');
      }
    } catch {
      setErrorMsg('सर्व्हरशी संपर्क होऊ शकला नाही. कृपया नंतर पुन्हा प्रयत्न करा.');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
        <div
          className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-auto animate-in zoom-in-95 duration-200"
          role="dialog"
        aria-modal="true"
        aria-labelledby="secure-pin-modal-title"
      >
        {/* Modal Header */}
        <div className="px-4 py-3.5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
              <KeyRound className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 id="secure-pin-modal-title" className="text-xs font-bold truncate">
                {title}
              </h3>
              {targetName && (
                <p className="text-[10px] text-slate-400 truncate leading-tight">
                  {targetName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
            aria-label="बंद करा"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4">
          {/* STEP 1: Confirmation Dialog */}
          {step === 'confirm' && (
            <div className="space-y-3.5">
              <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-950">
                      सुरक्षा पिन पाहण्याची पुष्टी
                    </h4>
                    <p className="text-[11px] text-amber-900 mt-1 leading-relaxed">
                      हा गोपनीय सुरक्षा पिन केवळ मंडळ अध्यक्षांना अधिकृत प्रशासकीय कारणास्तव पाहता येतो.
                    </p>
                  </div>
                </div>
                <div className="text-[10px] text-amber-800/90 pl-7.5 space-y-1">
                  <p>• पिन स्क्रीनवर जास्तीत जास्त ३० सेकंदांसाठीच उपलब्ध राहील.</p>
                  <p>• सुरक्षिततेसाठी हा पिन कोणाशीही शेअर करू नका.</p>
                </div>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className="flex-1 min-h-[44px] py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                >
                  रद्द करा
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReveal}
                  disabled={loading}
                  className="flex-1 min-h-[44px] py-2.5 px-3 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>पिन दाखवा</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Revealed PIN Screen */}
          {step === 'revealed' && pin && (
            <div className="space-y-4">
              {/* Countdown badge */}
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200 text-[11px] font-bold">
                  <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                  <span>स्वयं-लपवण्यासाठी: {countdown} सेकंद</span>
                </span>
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>AES-256</span>
                </span>
              </div>

              {/* PIN Display Card */}
              <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-700 space-y-2 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                    सध्याचा सुरक्षा पिन
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsMasked(!isMasked)}
                    className="min-h-[44px] px-2.5 py-1 text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    {isMasked ? (
                      <>
                        <Eye className="w-4 h-4" />
                        <span>पिन दाखवा</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-4 h-4" />
                        <span>पिन लपवा</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-center py-2">
                  <span
                    className={`font-mono text-3xl sm:text-4xl font-black text-amber-400 select-all ${
                      isMasked ? 'tracking-[0.4em]' : 'tracking-[0.3em]'
                    }`}
                  >
                    {isMasked ? '••••' : pin}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                स्क्रीन बंद केल्यास किंवा ३० सेकंद पूर्ण झाल्यावर हा पिन सुरक्षिततेसाठी मेमरीमधून पूर्णतः नष्ट होईल.
              </p>

              <button
                type="button"
                onClick={handleClose}
                className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                पूर्ण झाले (बंद करा)
              </button>
            </div>
          )}

          {/* STEP 3: Not Recoverable Notification */}
          {step === 'not_recoverable' && (
            <div className="space-y-3.5">
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-950">
                      सुरक्षित माहिती उपलब्ध नाही
                    </h4>
                    <p className="text-[11px] text-amber-900 mt-1 leading-relaxed">
                      या PIN ची सुरक्षित माहिती उपलब्ध नाही. नवीन PIN सेट करा.
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-amber-800/80 pl-7.5 leading-relaxed">
                  हे जुने खाते असल्याने याचा पिन पुनर्प्राप्त करण्यायोग्य स्वरूपात साठवलेला नाही. वापरकर्त्याने स्वतःचा पिन बदलल्यावर किंवा रीसेट केल्यावर तो येथे उपलब्ध होईल.
                </p>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="w-full min-h-[44px] py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                समजले (ठीक आहे)
              </button>
            </div>
          )}

          {/* STEP 4: Error State */}
          {step === 'error' && (
            <div className="space-y-3.5">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-red-950">त्रुटी आली</h4>
                  <p className="text-[11px] text-red-800 mt-0.5">{errorMsg}</p>
                </div>
              </div>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 min-h-[44px] py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                >
                  बंद करा
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReveal}
                  className="flex-1 min-h-[44px] py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  पुन्हा प्रयत्न करा
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </ModalPortal>
  );
};
