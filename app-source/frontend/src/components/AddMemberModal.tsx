import React, { useState } from 'react';
import { createMember } from '../api/members.js';
import { strings } from '../i18n/mr.js';
import { X, UserCheck, Phone, Lock, UserPlus, AlertCircle, Loader2 } from 'lucide-react';

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMemberCreated: () => void;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({
  isOpen,
  onClose,
  onMemberCreated,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [initialPin, setInitialPin] = useState('1234');
  const [role, setRole] = useState<'MEMBER' | 'TREASURER'>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanedPhone = phone.trim().replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanedPhone)) {
      setError('कृपया वैध १० अंकी मोबाईल नंबर प्रविष्ट करा (उदा. ९८७६५४३२१०)');
      return;
    }

    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('पूर्ण नाव किमान २ अक्षरांचे असणे आवश्यक आहे.');
      return;
    }

    if (!/^\d{4,6}$/.test(initialPin.trim())) {
      setError('प्रारंभिक सुरक्षा पिन ४ ते ६ अंकी असावा.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await createMember({
        fullName: fullName.trim(),
        phone: cleanedPhone,
        initialPin: initialPin.trim(),
        role,
      });

      if (res.success) {
        setFullName('');
        setPhone('');
        setInitialPin('1234');
        setRole('MEMBER');
        onMemberCreated();
        onClose();
      } else {
        if (res.error && res.error.includes('आधीपासून अस्तित्वात')) {
          setError(strings.members.duplicateError);
        } else {
          setError(res.error || 'सदस्य जोडण्यात त्रुटी निर्माण झाली.');
        }
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-3">
      {/* Mobile Sheet Container */}
      <div className="w-full max-w-[calc(100%-0.5rem)] sm:max-w-[380px] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85dvh] animate-in slide-in-from-bottom duration-200">
        
        {/* Modal Header */}
        <div className="bg-orange-600 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-white" />
            <h3 className="text-base font-bold">{strings.members.createModalTitle}</h3>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 active:scale-95 transition-all text-white cursor-pointer -mr-2"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {strings.members.fullNameLabel} <span className="text-red-500">*</span>
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 text-slate-400">
                <UserCheck className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={strings.members.fullNamePlaceholder}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
                required
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {strings.members.phoneLabel} <span className="text-red-500">*</span>
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 flex items-center gap-1 text-slate-400">
                <Phone className="w-4 h-4" />
                <span className="text-xs font-semibold text-slate-600 border-r border-slate-300 pr-1.5">+91</span>
              </div>
              <input
                type="tel"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="९८७६५४३२१०"
                className="w-full pl-20 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
                required
              />
            </div>
          </div>

          {/* Role (strictly MEMBER or TREASURER) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {strings.members.roleLabel}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('MEMBER')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  role === 'MEMBER'
                    ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                सदस्य (Member)
              </button>
              <button
                type="button"
                onClick={() => setRole('TREASURER')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  role === 'TREASURER'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                खजिनदार (Treasurer)
              </button>
            </div>
          </div>

          {/* Initial PIN */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {strings.members.initialPinLabel}
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type="text"
                maxLength={6}
                value={initialPin}
                onChange={(e) => setInitialPin(e.target.value.replace(/\D/g, ''))}
                placeholder="1234"
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
                required
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {strings.members.initialPinNotice}
            </p>
          </div>

          {/* Actions */}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
            >
              {strings.members.confirmCancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-semibold rounded-xl text-xs shadow-md shadow-orange-600/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>{strings.members.submitCreate}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
