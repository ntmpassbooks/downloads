import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getRegistrationStatus } from '../api/auth.js';
import { strings } from '../i18n/mr.js';
import { RegisterPresidentModal } from '../components/RegisterPresidentModal.js';
import {
  Phone,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Loader2,
  Sparkles,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();

  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Authoritative server-side registration availability
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const cleanedPhone = phone.trim().replace(/\D/g, '');
    const params = cleanedPhone.length === 10 ? { phone: cleanedPhone } : undefined;

    getRegistrationStatus(params)
      .then((res) => {
        if (isMounted && res.success) {
          setRegistrationOpen(res.registrationOpen);
        }
      })
      .catch(() => {
        // If status query fails, default to closed for security
        if (isMounted) setRegistrationOpen(false);
      });

    return () => {
      isMounted = false;
    };
  }, [phone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side phone sanitization & validation
    const cleanedPhone = phone.trim().replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanedPhone)) {
      setError('कृपया वैध १० अंकी मोबाईल नंबर प्रविष्ट करा.');
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      setError('कृपया ४ ते ६ अंकी सुरक्षा पिन प्रविष्ट करा.');
      return;
    }

    setLoading(true);
    const result = await login(cleanedPhone, pin, rememberMe);
    setLoading(false);

    if (!result.success) {
      if (result.error?.includes('निष्क्रिय')) {
        setError(strings.errors.inactiveAccount);
      } else if (result.error?.includes('१५ मिनिटांनंतर') || result.error?.includes('Too many')) {
        setError(strings.errors.tooManyAttempts);
      } else {
        setError(result.error || strings.errors.invalidCredentials);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] w-full max-w-md mx-auto overflow-y-auto">
      {/* App & Login Branding Header */}
      <div className="flex flex-col items-center text-center mt-3">
        <img
          src="/NTM_Passbook_Logo.png"
          alt="NTM Passbook"
          className="w-16 h-auto max-h-16 object-contain rounded-2xl mb-3 drop-shadow-md"
        />
        <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
          {strings.auth.loginTitle}
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
          {strings.auth.loginSubtitle}
        </p>
      </div>

      {error && (
        <div className="my-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Production-Only Real Login Form */}
      <form onSubmit={handleSubmit} className="space-y-4 my-auto" autoComplete="off">
        {/* Mobile Number Input */}
        <div>
          <label htmlFor="login-phone" className="block text-xs font-semibold text-slate-700 mb-1.5">
            {strings.auth.phoneLabel}
          </label>
          <div className="relative flex items-center">
            <div className="absolute left-3 flex items-center gap-1.5 text-slate-400">
              <Phone className="w-4 h-4" />
              <span className="text-xs font-semibold text-slate-600 border-r border-slate-300 pr-2">
                +91
              </span>
            </div>
            <input
              id="login-phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              data-lpignore="true"
              data-form-type="other"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder={strings.auth.phonePlaceholder}
              disabled={loading}
              className="w-full pl-20 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
              required
            />
          </div>
        </div>

        {/* Security PIN Input */}
        <div>
          <label htmlFor="login-pin" className="block text-xs font-semibold text-slate-700 mb-1.5">
            {strings.auth.pinLabel}
          </label>
          <div className="relative flex items-center">
            <div className="absolute left-3 text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="login-pin"
              name="pin"
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              autoComplete="off"
              data-lpignore="true"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder={strings.auth.pinPlaceholder}
              disabled={loading}
              className="w-full pl-10 pr-11 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium tracking-widest text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs font-mono"
              required
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              disabled={loading}
              className="absolute right-3 p-1 text-slate-400 hover:text-slate-600 focus:outline-hidden"
              aria-label={showPin ? 'पिन लपवा' : 'पिन दाखवा'}
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Remember Me Option */}
        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading}
              className="w-4 h-4 text-orange-600 rounded-md border-slate-300 focus:ring-orange-500 focus:ring-offset-0 transition-colors"
            />
            <span className="text-xs font-medium text-slate-600">{strings.auth.rememberMe}</span>
          </label>
        </div>

        {/* Submit Login Button */}
        <button
          type="submit"
          disabled={loading || !phone || !pin}
          className="w-full py-3.5 px-4 bg-orange-600 hover:bg-orange-700 active:scale-[0.98] text-white font-semibold rounded-xl text-sm shadow-md shadow-orange-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{strings.auth.submittingButton}</span>
            </>
          ) : (
            <>
              <span>{strings.auth.submitButton}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Authoritative First-Time President Registration Section */}
      {registrationOpen && (
        <div className="mt-4 pt-4 border-t border-slate-200 text-center animate-in fade-in">
          <div className="p-3.5 bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-2xl space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-orange-950">
              <Sparkles className="w-3.5 h-3.5 text-orange-600" />
              <span>{strings.auth.firstTimeNotice}</span>
            </div>
            <p className="text-[11px] text-orange-900/80">
              नवीन मंडळ स्थापन करण्यासाठी प्रथम अध्यक्षांची नोंदणी करा.
            </p>
            <button
              type="button"
              onClick={() => setIsRegisterOpen(true)}
              className="w-full py-2.5 px-3 bg-white hover:bg-orange-500 hover:text-white border border-orange-300 text-orange-800 text-xs font-bold rounded-xl transition-all shadow-xs active:scale-[0.98]"
            >
              {strings.auth.registerPresidentButton}
            </button>
          </div>
        </div>
      )}

      {/* President Registration Modal */}
      <RegisterPresidentModal
        isOpen={isRegisterOpen}
        onClose={() => {
          setIsRegisterOpen(false);
          // Re-check registration status after close
          getRegistrationStatus().then((res) => {
            if (res.success) setRegistrationOpen(res.registrationOpen);
          });
        }}
      />
    </div>
  );
};
