import React, { useState } from 'react';
import { registerPresident, getRegistrationStatus } from '../api/auth.js';
import { useAuth } from '../context/AuthContext.js';
import { strings } from '../i18n/mr.js';
import {
  X,
  Building2,
  User,
  Phone,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  Crown,
  ArrowRight,
} from 'lucide-react';

interface RegisterPresidentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RegisterPresidentModal: React.FC<RegisterPresidentModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { setAuthSession } = useAuth();

  const [mandalName, setMandalName] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const checkMandalName = async (name: string) => {
    const cleaned = name.trim();
    if (cleaned.length < 3) return;
    try {
      const res = await getRegistrationStatus({ mandalName: cleaned });
      if (res.success && !res.registrationOpen) {
        setError(
          res.reason ||
            'नोंदणी सध्या उपलब्ध नाही. हे मंडळ आधीपासून नोंदणीकृत असून मंडळ अध्यक्ष आधीपासून अस्तित्वात आहेत.'
        );
      }
    } catch {
      // Safe ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanedPhone = phone.trim().replace(/\D/g, '');
    const cleanedMandal = mandalName.trim();
    const cleanedName = fullName.trim();

    // Client-side validations
    if (!cleanedMandal || cleanedMandal.length < 3) {
      setError('मंडळाचे नाव किमान ३ अक्षरांचे असावे.');
      return;
    }

    if (!cleanedName || cleanedName.length < 2) {
      setError('अध्यक्षांचे पूर्ण नाव किमान २ अक्षरांचे असावे.');
      return;
    }

    if (!/^[6-9]\d{9}$/.test(cleanedPhone)) {
      setError('कृपया वैध १० अंकी मोबाईल नंबर प्रविष्ट करा.');
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      setError('सुरक्षा PIN ४ ते ६ अंकी असावा.');
      return;
    }

    if (pin !== confirmPin) {
      setError(strings.errors.pinMismatch);
      return;
    }

    setLoading(true);

    try {
      // Authoritative pre-check before registration attempt
      const statusRes = await getRegistrationStatus({
        mandalName: cleanedMandal,
        phone: cleanedPhone,
      }).catch(() => null);

      if (statusRes && !statusRes.registrationOpen) {
        setError(
          statusRes.reason ||
            'नोंदणी सध्या उपलब्ध नाही. हे मंडळ आधीपासून नोंदणीकृत असून मंडळ अध्यक्ष आधीपासून अस्तित्वात आहेत.'
        );
        setLoading(false);
        return;
      }

      const res = await registerPresident({
        mandalName: cleanedMandal,
        fullName: cleanedName,
        phone: cleanedPhone,
        pin,
        confirmPin,
      });

      if (res.success && res.token && res.user && res.organization) {
        // Authenticate immediately into the newly registered mandal
        setAuthSession(res.token, res.user, res.organization, true);
        onClose();
      } else {
        setError(res.error || strings.errors.generic);
      }
    } catch {
      setError(strings.errors.networkError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-3">
      <div className="w-full max-w-[calc(100%-0.5rem)] sm:max-w-[380px] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85dvh] animate-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 border border-orange-400/30 flex items-center justify-center text-orange-400">
              <Crown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight">{strings.register.title}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">{strings.register.subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 active:scale-95 transition-all text-white cursor-pointer -mr-2"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Mandal Name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{strings.register.mandalNameLabel}</span>
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="mandalName"
              value={mandalName}
              onChange={(e) => {
                setMandalName(e.target.value);
                if (error) setError(null);
              }}
              onBlur={() => checkMandalName(mandalName)}
              placeholder={strings.register.mandalNamePlaceholder}
              required
              disabled={loading}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
            />
          </div>

          {/* President Full Name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>{strings.register.presidentNameLabel}</span>
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={strings.register.presidentNamePlaceholder}
              required
              disabled={loading}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
            />
          </div>

          {/* Phone Number */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              <span>{strings.register.phoneLabel}</span>
              <span className="text-red-500">*</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-xs font-semibold text-slate-500 border-r border-slate-300 pr-2">
                +91
              </span>
              <input
                type="tel"
                name="phone"
                maxLength={10}
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder={strings.register.phonePlaceholder}
                required
                disabled={loading}
                className="w-full pl-14 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
              />
            </div>
          </div>

          {/* PIN & Confirm PIN in 2 columns */}
          <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>{strings.register.pinLabel}</span>
                <span className="text-red-500">*</span>
              </label>
              <div className="relative flex items-center">
                <input
                  type={showPin ? 'text' : 'password'}
                  name="pin"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder={strings.register.pinPlaceholder}
                  required
                  disabled={loading}
                  className="w-full pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium tracking-widest text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-2 p-1 text-slate-400 hover:text-slate-600 focus:outline-hidden"
                >
                  {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>{strings.register.confirmPinLabel}</span>
                <span className="text-red-500">*</span>
              </label>
              <input
                type={showPin ? 'text' : 'password'}
                name="confirmPin"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder={strings.register.confirmPinPlaceholder}
                required
                disabled={loading}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium tracking-widest text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs font-mono"
              />
            </div>
          </div>

          <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed">
            <strong>सूचना:</strong> पहिल्या अध्यक्षांची नोंदणी पूर्ण होताच सार्वजनिक नोंदणी बंद केली जाईल. उर्वरित सदस्यांची नोंदणी केवळ अध्यक्ष करू शकतील.
          </div>

          {/* Submit & Cancel Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-all active:scale-[0.98]"
            >
              रद्द करा
            </button>
            <button
              type="submit"
              disabled={loading || !mandalName || !fullName || !phone || !pin || !confirmPin}
              className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-[0.98] text-white font-semibold rounded-xl text-xs shadow-md shadow-orange-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{strings.register.submitting}</span>
                </>
              ) : (
                <>
                  <span>{strings.register.submitButton}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
