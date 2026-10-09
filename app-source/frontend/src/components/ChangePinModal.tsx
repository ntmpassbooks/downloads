import React, { useState } from 'react';
import { changePin } from '../api/auth.js';
import { useAuth } from '../context/AuthContext.js';
import { strings } from '../i18n/mr.js';
import { X, Lock, KeyRound, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChangePinModal: React.FC<ChangePinModalProps> = ({ isOpen, onClose }) => {
  const { updateToken } = useAuth();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleReset = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validations
    if (!currentPin || !newPin || !confirmPin) {
      setError(strings.pinChange.errorRequired);
      return;
    }

    if (!/^\d{4,6}$/.test(currentPin) || !/^\d{4,6}$/.test(newPin)) {
      setError(strings.pinChange.errorPinDigits);
      return;
    }

    if (newPin === currentPin) {
      setError(strings.pinChange.errorSamePin);
      return;
    }

    if (newPin !== confirmPin) {
      setError(strings.pinChange.errorMismatch);
      return;
    }

    setLoading(true);

    try {
      const res = await changePin({ currentPin, newPin });

      if (res.success && res.token) {
        // Rotate token in context & storage
        updateToken(res.token);
        setSuccess(true);
        setTimeout(() => {
          handleClose();
        }, 1800);
      } else {
        setError(res.error || 'पिन बदलताना त्रुटी निर्माण झाली. कृपया पुन्हा प्रयत्न करा.');
      }
    } catch {
      setError(strings.errors.networkError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="w-full max-w-[calc(100%-0.5rem)] sm:max-w-[380px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[85dvh] animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-600/30 border border-orange-500/30 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-orange-400" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight">{strings.pinChange.title}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">{strings.pinChange.subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 active:scale-95 transition-all text-white cursor-pointer -mr-2"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 overflow-y-auto">
          {success ? (
            <div className="py-8 px-4 text-center space-y-3 animate-in zoom-in-95 duration-200">
              <div className="w-14 h-14 bg-emerald-100 border border-emerald-300 rounded-full flex items-center justify-center mx-auto text-emerald-600">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-slate-800">सुरक्षा पिन यशस्वीरीत्या बदलला!</h4>
              <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                {strings.pinChange.successMessage}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              {/* Current PIN */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>{strings.pinChange.currentPinLabel}</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  placeholder={strings.pinChange.currentPinPlaceholder}
                  required
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all font-mono tracking-widest"
                />
              </div>

              {/* New PIN */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  <span>{strings.pinChange.newPinLabel}</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  placeholder={strings.pinChange.newPinPlaceholder}
                  required
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all font-mono tracking-widest"
                />
              </div>

              {/* Confirm New PIN */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>{strings.pinChange.confirmPinLabel}</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder={strings.pinChange.confirmPinPlaceholder}
                  required
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all font-mono tracking-widest"
                />
              </div>

              {/* Security Hint */}
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed">
                नवीन पिन सेव्ह झाल्यानंतर जुने सर्व सत्र (Sessions) तात्काळ बंद केले जातील आणि हे नवीन सत्र सक्रिय राहील.
              </div>

              {/* Submit Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-all active:scale-[0.98]"
                >
                  रद्द करा
                </button>
                <button
                  type="submit"
                  disabled={loading || !currentPin || !newPin || !confirmPin}
                  className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl text-xs shadow-md shadow-orange-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{strings.pinChange.submitting}</span>
                    </>
                  ) : (
                    <span>{strings.pinChange.submitButton}</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
