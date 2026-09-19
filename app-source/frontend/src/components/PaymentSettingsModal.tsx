import React, { useState, useEffect } from 'react';
import {
  X,
  Building2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Power,
  Clock,
  Ban,
  Save,
  Eye,
  EyeOff,
  HelpCircle,
} from 'lucide-react';
import {
  getPaymentConfig,
  upsertPaymentConfig,
  updatePaymentConfigStatus,
  PaymentConfig,
  PaymentConfigStatus,
  AccountType,
  SupportedBank,
  SUPPORTED_BANKS,
} from '../api/payments.js';

interface PaymentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PaymentSettingsModal: React.FC<PaymentSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [bank, setBank] = useState<SupportedBank>('SBI');
  const [accountType, setAccountType] = useState<AccountType | ''>('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [branch, setBranch] = useState('');
  const [upiId, setUpiId] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<PaymentConfigStatus>('NOT_CONFIGURED');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    } else {
      setError(null);
      setSuccessMessage(null);
      setShowSecret(false);
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPaymentConfig();
      if (res.success && res.data) {
        const d = res.data;
        setConfig(d);
        setBank(d.bank || 'SBI');
        setAccountType(d.accountType || '');
        setAccountName(d.accountName || '');
        setAccountNumber(d.accountNumber || '');
        setIfsc(d.ifsc || '');
        setBranch(d.branch || '');
        setUpiId(d.upiId || '');
        setMerchantId(d.merchantId || '');
        setNotes(d.notes || '');
        setStatus(d.status || 'PENDING');
      } else {
        setConfig(null);
        setBank('SBI');
        setAccountType('');
        setAccountName('');
        setAccountNumber('');
        setIfsc('');
        setBranch('');
        setUpiId('');
        setMerchantId('');
        setApiSecret('');
        setNotes('');
        setStatus('NOT_CONFIGURED');
      }
    } catch {
      setError('पेमेंट रचना माहिती आणताना अडचण आली.');
    } finally {
      setLoading(false);
    }
  };

  const selectedBankInfo = SUPPORTED_BANKS.find((b) => b.code === bank) || SUPPORTED_BANKS[0];

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountType) {
      setError('कृपया खात्याचा प्रकार निवडा (चालू खाते किंवा बचत खाते). हे अनिवार्य आहे.');
      return;
    }
    if (!accountName.trim()) {
      setError('कृपया खातेदार / मंडळाचे नाव प्रविष्ट करा.');
      return;
    }
    if (accountNumber && !/^\d{9,18}$/.test(accountNumber.trim())) {
      setError('खाते क्रमांक ९ ते १८ अंकी असावा.');
      return;
    }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) {
      setError('कृपया योग्य ११ अक्षरी आयएफएससी (IFSC) कोड टाका (उदा. SBIN0001234).');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await upsertPaymentConfig({
        bank,
        accountType: accountType as AccountType,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim() || undefined,
        ifsc: ifsc.trim().toUpperCase() || undefined,
        branch: branch.trim() || undefined,
        upiId: upiId.trim() || undefined,
        merchantId: merchantId.trim() || undefined,
        apiSecret: apiSecret.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.success && res.data) {
        setConfig(res.data);
        setStatus(res.data.status);
        setApiSecret(''); // Clear plain secret from memory
        setSuccessMessage('बँक खाते व पेमेंट रचना यशस्वीरीत्या जतन झाली!');
      } else {
        setError(res.error || 'पेमेंट रचना जतन करता आली नाही.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (newStatus: 'ACTIVE' | 'DISABLED' | 'PENDING') => {
    if (!config) return;
    if (newStatus === 'ACTIVE') {
      if (!config.hasCredentials && !apiSecret.trim()) {
        setError('ऑनलाइन पेमेंट सक्रिय करण्यासाठी बँकेकडून मिळालेली सुरक्षा API की / सिक्रेट की भरणे आवश्यक आहे.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await updatePaymentConfigStatus(newStatus);
      if (res.success && res.data) {
        setConfig(res.data);
        setStatus(res.data.status);
        setSuccessMessage(
          newStatus === 'ACTIVE'
            ? 'ऑनलाइन भरणा सेवा यशस्वीरीत्या सक्रिय केली आहे!'
            : newStatus === 'DISABLED'
            ? 'ऑनलाइन भरणा सेवा बंद केली आहे.'
            : 'ऑनलाइन भरणा प्रलंबित स्थितीत ठेवला आहे.'
        );
      } else {
        setError(res.error || 'स्थिती बदलण्यात अडचण आली.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold leading-tight">
                ऑनलाइन भरणा व बँक रचना
              </h3>
              <p className="text-[11px] text-orange-100 mt-0.5">
                बहु-बँक UPI व डिजिटल संकलन व्यवस्थापन
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center transition-all min-h-[44px] min-w-[44px]"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 max-h-[calc(85vh-72px)] overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              माहिती लोड होत आहे...
            </div>
          ) : (
            <form onSubmit={handleSaveConfig} className="space-y-4">
              {/* Current Status Card */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">सध्याची भरणा स्थिती:</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                      status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : status === 'PENDING'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {status === 'ACTIVE' ? (
                      <>
                        <Power className="w-3.5 h-3.5 text-emerald-600" />
                        सक्रिय (Active)
                      </>
                    ) : status === 'PENDING' ? (
                      <>
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        प्रलंबित (Pending)
                      </>
                    ) : (
                      <>
                        <Ban className="w-3.5 h-3.5 text-slate-500" />
                        बंद (Disabled)
                      </>
                    )}
                  </span>
                </div>

                {status === 'PENDING' && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200/80 rounded-xl text-[11px] text-amber-800 leading-relaxed">
                    <strong>महत्त्वाची सूचना:</strong> बँक खात्याचे तपशील जतन झाले आहेत, परंतु बँक API/कलेक्शन सुविधा सक्रिय करण्यासाठी बँकेकडून अधिकृत onboarding पूर्ण करणे आवश्यक आहे. तोपर्यंत सदस्यांचा भरणा नेहमीप्रमाणे रोख स्वरूपात जमा करा.
                  </div>
                )}

                {/* Status Switcher Buttons */}
                {config && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                    <button
                      type="button"
                      disabled={saving || status === 'ACTIVE'}
                      onClick={() => handleToggleStatus('ACTIVE')}
                      className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        status === 'ACTIVE'
                          ? 'bg-emerald-600 text-white cursor-default'
                          : 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 active:scale-98'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      सक्रिय करा (Active)
                    </button>
                    <button
                      type="button"
                      disabled={saving || status === 'DISABLED'}
                      onClick={() => handleToggleStatus('DISABLED')}
                      className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        status === 'DISABLED'
                          ? 'bg-slate-700 text-white cursor-default'
                          : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 active:scale-98'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      सेवा बंद करा (Disable)
                    </button>
                  </div>
                )}
              </div>

              {/* 1. Bank Selector */}
              <div className="p-3.5 bg-orange-50/50 rounded-2xl border border-orange-200/60 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-800">
                    समर्थित बँक निवडा *
                  </label>
                  <span className="text-[10px] text-orange-700 font-semibold bg-orange-100 px-2 py-0.5 rounded-md">
                    आवश्यक
                  </span>
                </div>
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value as SupportedBank)}
                  className="w-full min-h-[44px] px-3 py-2.5 bg-white border border-orange-300 rounded-xl text-xs text-slate-900 font-bold focus:outline-hidden focus:border-orange-500 transition-colors"
                >
                  {SUPPORTED_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.marathiName}
                    </option>
                  ))}
                </select>
                <div className="flex items-start gap-1.5 text-[11px] text-slate-500 pt-1">
                  <HelpCircle className="w-3.5 h-3.5 text-orange-600 shrink-0 mt-0.5" />
                  <span>
                    मंडळाचे अधिकृत बँक खाते असलेली समर्थित बँक निवडा (BOI वगळता).
                  </span>
                </div>
              </div>

              {/* 2. Account Type Selector - MANDATORY */}
              <div className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-800">
                    खात्याचा प्रकार निवडा (Account Type) *
                  </label>
                  <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-md">
                    अनिवार्य निवड
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  {/* Current Account Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setAccountType('CURRENT');
                      setError(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all min-h-[56px] flex flex-col justify-center cursor-pointer ${
                      accountType === 'CURRENT'
                        ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-orange-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">चालू खाते</span>
                      {accountType === 'CURRENT' && <CheckCircle2 className="w-4 h-4 text-white" />}
                    </div>
                    <span className={`text-[10px] ${accountType === 'CURRENT' ? 'text-orange-100' : 'text-slate-500'}`}>
                      Current Account (API समर्थित)
                    </span>
                  </button>

                  {/* Savings Account Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setAccountType('SAVINGS');
                      setError(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all min-h-[56px] flex flex-col justify-center cursor-pointer ${
                      accountType === 'SAVINGS'
                        ? 'bg-amber-700 text-white border-amber-700 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">संस्थात्मक बचत खाते</span>
                      {accountType === 'SAVINGS' && <CheckCircle2 className="w-4 h-4 text-white" />}
                    </div>
                    <span className={`text-[10px] ${accountType === 'SAVINGS' ? 'text-amber-100' : 'text-slate-500'}`}>
                      Institutional Savings (समर्थित)
                    </span>
                  </button>
                </div>

                {/* Account Type Guidance */}
                {accountType === 'SAVINGS' && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900 leading-relaxed flex items-start gap-2 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold">संस्थात्मक बचत खाते (Institutional Savings Account):</strong>
                      <br />
                      {selectedBankInfo.marathiName} च्या मर्चंट सोल्यूशनद्वारे मंडळाच्या अधिकृत संस्थात्मक बचत खात्यावर ऑनलाइन संकलन समर्थित आहे.
                      <br />
                      <span className="text-blue-800 font-semibold mt-0.5 block">
                        महत्त्वाचे: हे खाते मंडळाच्या/ट्रस्टच्या अधिकृत नावे असणे आवश्यक आहे (वैयक्तिक खाते वापरू नये). बँकेकडून मर्चंट क्रेडेंशियल्स प्राप्त झाल्यानंतर ही रचना सक्रिय (ACTIVE) करता येईल.
                      </span>
                    </div>
                  </div>
                )}

                {accountType === 'CURRENT' && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 leading-relaxed flex items-start gap-2 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold">चालू खाते (Current Account):</strong>
                      <br />
                      {selectedBankInfo.marathiName} मध्ये मंडळाच्या अधिकृत चालू खात्यावर संपूर्ण मर्चंट कलेक्शन व वेबहूक पडताळणी पूर्णपणे समर्थित आहे.
                    </div>
                  </div>
                )}

                {!accountType && (
                  <p className="text-[11px] text-amber-800 font-medium pt-0.5">
                    ⚠️ कृपया चालू खाते किंवा बचत खाते यांपैकी एकावर क्लिक करून निवड निश्चित करा. कोणतीही पूर्व-निवड (Default) केलेली नाही.
                  </p>
                )}
              </div>

              {/* 3. Account Details */}
              <div className="space-y-3 pt-1">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-600" />
                  मंडळ बँक खाते माहिती (सामान्य माहिती)
                </h4>

                {/* Account Name */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700">
                      खातेदार / मंडळाचे नाव *
                    </label>
                    <span className="text-[10px] text-slate-500 font-medium">आवश्यक • सामान्य माहिती</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="उदा. नवतरुण मित्र मंडळ"
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 leading-tight">
                    मंडळाच्या अधिकृत बँक खात्यावर नोंदणीकृत असलेले नाव येथे टाका. सदस्यांना UPI पेमेंट करताना हेच नाव दिसेल.
                    <br />
                    <span className="text-slate-400">माहितीचा स्रोत: बँक पासबुक, चेकबुक किंवा खाते उघडण्याचे अधिकृत बँक पत्र.</span>
                  </p>
                </div>

                {/* Account Number */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700">
                      {accountType === 'SAVINGS'
                        ? 'बचत खाते क्रमांक (Savings Account Number) *'
                        : 'चालू खाते क्रमांक (Current Account Number) *'}
                    </label>
                    <span className="text-[10px] text-slate-500 font-medium">आवश्यक • सामान्य माहिती</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="उदा. 39827461928"
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-mono focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 leading-tight">
                    {accountType === 'SAVINGS'
                      ? 'मंडळाच्या अधिकृत बचत खात्याचा ९ ते १८ अंकी अचूक क्रमांक प्रविष्ट करा.'
                      : 'मंडळाच्या ९ ते १८ अंकी अधिकृत चालू खात्याचा (Current Account) अचूक क्रमांक प्रविष्ट करा. वैयक्तिक खाते टाकू नये.'}
                    <br />
                    <span className="text-slate-400">माहितीचा स्रोत: मंडळाचे पासबुक किंवा बँक स्टेटमेंट.</span>
                  </p>
                </div>

                {/* IFSC Code */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700">
                      आयएफएससी कोड (IFSC Code) *
                    </label>
                    <span className="text-[10px] text-slate-500 font-medium">आवश्यक • सामान्य माहिती</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    placeholder={`उदा. ${bank === 'SBI' ? 'SBIN0001234' : bank === 'ICICI' ? 'ICIC0000001' : bank === 'AXIS' ? 'UTIB0000001' : bank === 'AU' ? 'AUBF0000001' : 'KKBK0000001'}`}
                    maxLength={11}
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-mono uppercase focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 leading-tight">
                    मंडळाचे खाते ज्या शाखेत आहे त्या शाखेचा ११ अक्षरी अधिकृत IFSC कोड येथे टाका.
                    <br />
                    <span className="text-slate-400">माहितीचा स्रोत: चेकबुक किंवा बँक पासबुक.</span>
                  </p>
                </div>

                {/* Branch */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700">
                      बँक शाखा (Branch Name) *
                    </label>
                    <span className="text-[10px] text-slate-500 font-medium">आवश्यक • सामान्य माहिती</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="उदा. कोल्हापूर मुख्य शाखा"
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 leading-tight">
                    मंडळाचे बँक खाते ज्या शहरात/भागात आहे त्या शाखेचे अधिकृत नाव.
                  </p>
                </div>
              </div>

              {/* 3. Bank-Specific API Collection Details */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-600" />
                  {selectedBankInfo.marathiName} API व संकलन तपशील
                </h4>

                {/* UPI ID */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700">
                      अधिकृत UPI आयडी (VPA) *
                    </label>
                    <span className="text-[10px] text-slate-500 font-medium">आवश्यक • सामान्य माहिती</span>
                  </div>
                  <input
                    type="text"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder={`उदा. mandal${selectedBankInfo.vpaSuffix}`}
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-mono focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 leading-tight">
                    मंडळाच्या चालू खात्याशी लिंक असलेला अधिकृत UPI आयडी प्रविष्ट करा. हा आयडी QR कोड व UPI लिंक तयार करण्यासाठी वापरला जाईल.
                    <br />
                    <span className="text-slate-400">माहितीचा स्रोत: बँकेचे अधिकृत कॉर्पोरेट नेटबँकिंग किंवा मर्चंट ॲप.</span>
                  </p>
                </div>

                {/* Merchant ID */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700">
                      {bank === 'SBI'
                        ? 'एसबीआय मर्चंट कोड (Merchant Code) *'
                        : bank === 'ICICI'
                        ? 'Eazypay मर्चंट / सब-मर्चंट आयडी *'
                        : bank === 'AXIS'
                        ? 'ॲक्सिस कॉर्पोरेट / मर्चंट आयडी *'
                        : bank === 'AU'
                        ? 'एयू मर्चंट / टर्मिनल आयडी *'
                        : 'कोटक क्लायंट / मर्चंट कोड *'}
                    </label>
                    <span className="text-[10px] text-slate-500 font-medium">आवश्यक • सामान्य माहिती</span>
                  </div>
                  <input
                    type="text"
                    value={merchantId}
                    onChange={(e) => setMerchantId(e.target.value)}
                    placeholder={`उदा. ${bank}CORP100293`}
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-mono focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 leading-tight">
                    बँकेच्या कॉर्पोरेट / API कलेक्शन सुविधेअंतर्गत मंडळाला मिळालेला अधिकृत मर्चंट किंवा कॉर्पोरेट आयडी येथे प्रविष्ट करा.
                    <br />
                    <span className="text-slate-400">माहितीचा स्रोत: बँकेच्या कॉर्पोरेट बँकिंग किंवा API बँकिंग ऑनबोर्डिंग टीमकडून मिळालेल्या अधिकृत पत्रातून/ईमेलमधून.</span>
                  </p>
                </div>

                {/* API Secret / Encryption Key */}
                <div className="space-y-1 p-3 bg-amber-50/60 border border-amber-200 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-800 flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      बँक सुरक्षा एनक्रिप्शन / सिक्रेट की
                    </label>
                    <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-md">
                      गोपनीय (Sensitive)
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      placeholder={config?.hasCredentials ? '•••••••••••••••• (सुरक्षितपणे सेव्ह आहे)' : 'बँकेकडून मिळालेली सिक्रेट की टाका'}
                      className="w-full min-h-[44px] px-3.5 py-2.5 pr-11 bg-white border border-amber-300 rounded-xl text-xs text-slate-900 font-mono focus:outline-hidden focus:border-orange-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-amber-900 leading-relaxed font-medium">
                    <strong>ही अत्यंत गोपनीय माहिती आहे. ती कोणासोबतही शेअर करू नका.</strong>
                    <br />
                    बँकेकडून मिळालेली सुरक्षा एनक्रिप्शन/चेकसम की येथे टाका. ही की सर्व्हरवर AES-256-GCM ने एनक्रिप्ट करून ठेवली जाते व ऑनलाइन भरणा सक्रिय करण्यासाठी आवश्यक आहे.
                    <br />
                    <span className="text-amber-800 font-normal">
                      माहितीचा स्रोत: बँकेच्या अधिकृत API Banking Developer Portal किंवा टेक्निकल इंटिग्रेशन टीमकडून थेट मिळालेली की.
                    </span>
                  </p>
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    नोंदी / संदर्भ (पर्यायी)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="उदा. मंडळाचे अधिकृत चालू बँक खाते"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                </div>
              </div>

              {/* Security Banner */}
              <div className="p-3 bg-blue-50/80 border border-blue-100 rounded-2xl flex items-start gap-2.5 text-[11px] text-blue-800">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong>सुरक्षा हमी:</strong> बँक API की व क्रेडेंशियल्स सर्व्हरच्या तिजोरीत AES-256-GCM अल्गोरिदमद्वारे एनक्रिप्टेड आहेत. सदस्य, इतर पदाधिकारी किंवा कोणत्याही बाह्य व्यक्तीस हे तपशील कधीही उघड होत नाहीत.
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-orange-600 hover:bg-orange-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {saving ? 'जतन करत आहे...' : 'बँक पेमेंट रचना जतन करा'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
