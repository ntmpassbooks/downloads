import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { permanentDeleteMandal } from '../api/organization.js';
import {
  AlertTriangle,
  Lock,
  CheckSquare,
  Square,
  Loader2,
  X,
  Trash2,
  ShieldAlert,
} from 'lucide-react';

interface DeleteMandalModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeleteMandalModal: React.FC<DeleteMandalModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { user, organization, logout } = useAuth();
  const [pin, setPin] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Only President is authorized
  if (user?.role !== 'PRESIDENT') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
        <div className="bg-white rounded-2xl max-w-[calc(100%-1rem)] sm:max-w-[360px] w-full p-6 text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-red-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">अनधिकृत प्रवेश (Access Denied)</h3>
          <p className="text-xs text-slate-500">
            मंडळ कायमचे हटवण्याचा अधिकार केवळ अधिकृत अध्यक्षांना आहे.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs"
          >
            बंद करा
          </button>
        </div>
      </div>
    );
  }

  const TARGET_PHRASE = 'मंडळ कायमचे हटवा';
  const isPhraseValid = confirmationPhrase.trim() === TARGET_PHRASE;
  const isPinValid = /^\d{4,6}$/.test(pin.trim());
  const canSubmit = isPinValid && confirmed && isPhraseValid && !isSubmitting;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await permanentDeleteMandal({
        pin: pin.trim(),
        confirmed: true,
        confirmationPhrase: confirmationPhrase.trim(),
      });

      if (res.success) {
        // Clear all state and invalidate session completely
        await logout();
      } else {
        setErrorMessage(res.error || 'मंडळ हटवताना त्रुटी निर्माण झाली. कृपया पुन्हा प्रयत्न करा.');
        setIsSubmitting(false);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'सर्व्हरशी संपर्क होऊ शकला नाही');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-[calc(100%-0.5rem)] sm:max-w-[380px] w-full overflow-hidden shadow-2xl border border-red-200 flex flex-col max-h-[85dvh]">
        {/* Header */}
        <div className="bg-red-600 px-4 py-3 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight">मंडळ कायमचे हटवा</h3>
              <p className="text-[11px] text-red-100 font-medium">धोकादायक कृती (Permanent Reset)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-w-[44px] min-h-[44px] rounded-full hover:bg-white/20 flex items-center justify-center transition-colors text-white/80 hover:text-white cursor-pointer -mr-2"
            aria-label="बंद करा"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleDelete} className="p-4 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Warning Banner */}
          <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-900 space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-xs text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>सावधान: ही कृती पूर्ववत करता येणार नाही!</span>
            </div>
            <p className="text-[11px] text-red-800 leading-relaxed">
              तुम्ही <strong>{organization?.name || 'मंडळ'}</strong> कायमचे नष्ट करत आहात. खालील सर्व माहिती सर्व्हरवरून तत्काळ आणि कायमस्वरूपी हटवली जाईल:
            </p>
            <ul className="text-[11px] text-red-700 list-disc list-inside space-y-0.5 pl-1">
              <li>सर्व सभासद खाती, खजिनदार व अध्यक्ष प्रोफाईल</li>
              <li>सर्व बीसी रचना, मासिक चक्र आणि भरलेले हप्ते</li>
              <li>आर्थिक लेजर व्यवहार, पावती नोंदी व हिशोब</li>
              <li>सभासद कर्जे, परतफेड नोंदी व उर्वरित शिल्लक</li>
              <li>मंडळाचे सर्व नोंदवलेले खर्च व वर्गीकरण</li>
              <li>सुरक्षा व ॲक्टिव्हिटी ऑडिट नोंदी</li>
            </ul>
          </div>

          {errorMessage && (
            <div className="p-3 bg-red-100/80 border border-red-300 rounded-xl text-red-900 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Re-Authentication Step: President PIN */}
          <div className="space-y-1.5 pt-1">
            <label className="font-bold text-slate-700 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>१. तुमचा अध्यक्ष लॉगिन पिन टाका:</span>
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="४ ते ६ अंकी सुरक्षा PIN"
              disabled={isSubmitting}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-red-500 font-mono tracking-widest text-slate-800"
            />
          </div>

          {/* Acknowledgement Checkbox */}
          <div
            onClick={() => !isSubmitting && setConfirmed(!confirmed)}
            className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-start gap-2.5 cursor-pointer hover:bg-slate-100/70 transition-colors select-none"
          >
            <div className="mt-0.5 text-red-600 shrink-0">
              {confirmed ? (
                <CheckSquare className="w-4 h-4 text-red-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
            </div>
            <p className="text-[11px] text-slate-700 font-medium leading-tight">
              मी समजतो की हा सर्व डेटा कायमचा नष्ट होईल आणि कोणतीही माहिती परत मिळवता येणार नाही.
            </p>
          </div>

          {/* Exact Marathi Confirmation Phrase Input */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700 block">
              २. पुष्टीकरणासाठी खालील वाक्य टाईप करा:
            </label>
            <div className="p-2 bg-slate-100 rounded-lg text-center font-bold text-slate-800 tracking-wide text-xs select-all">
              {TARGET_PHRASE}
            </div>
            <input
              type="text"
              value={confirmationPhrase}
              onChange={(e) => setConfirmationPhrase(e.target.value)}
              placeholder={`येथे "${TARGET_PHRASE}" टाईप करा`}
              disabled={isSubmitting}
              className={`w-full px-3.5 py-2.5 rounded-xl border font-medium text-xs focus:outline-hidden focus:ring-2 ${
                isPhraseValid
                  ? 'border-emerald-500 ring-emerald-500/20 bg-emerald-50/30 text-emerald-900'
                  : 'border-slate-300 focus:ring-red-500 text-slate-800'
              }`}
            />
          </div>

          {/* Actions */}
          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all ${
                canSubmit
                  ? 'bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white shadow-red-500/30'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>मंडळ हटवत आहे...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>मंडळ कायमचे हटवा</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
            >
              रद्द करा
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
