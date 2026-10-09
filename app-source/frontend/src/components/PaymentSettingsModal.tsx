import React, { useState, useEffect, useRef } from 'react';
import { ModalPortal } from './ModalPortal.js';
import {
  X,
  QrCode,
  Power,
  Ban,
  Save,
  Upload,
  Trash2,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { useAlertModal } from '../context/AlertModalContext.js';
import {
  getPaymentConfig,
  upsertPaymentConfig,
} from '../api/payments.js';

interface PaymentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isReadOnly?: boolean;
}

export const PaymentSettingsModal: React.FC<PaymentSettingsModalProps> = ({
  isOpen,
  onClose,
  isReadOnly = false,
}) => {
  const { user } = useAuth();
  const { showSuccess, showError } = useAlertModal();
  const canEdit = !isReadOnly && user?.role === 'PRESIDENT';

  const [upiId, setUpiId] = useState('');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [hasExistingQr, setHasExistingQr] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await getPaymentConfig();
      if (res.success && res.data) {
        const d = res.data;
        setUpiId(d.upiId || '');
        setQrCodeData(d.qrCodeData || null);
        setHasExistingQr(Boolean(d.hasQrCode || d.qrCodeData));
        setIsActive(Boolean(d.isActive));
        setNotes(d.notes || '');
      } else {
        setUpiId('');
        setQrCodeData(null);
        setHasExistingQr(false);
        setIsActive(false);
        setNotes('');
      }
    } catch {
      showError('त्रुटी', 'पेमेंट रचना माहिती लोड करताना अडचण आली.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate mime type
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      showError('वैधता त्रुटी', 'कृपया केवळ PNG किंवा JPEG फॉरमॅटमधील QR कोड इमेज अपलोड करा.');
      return;
    }

    // Validate size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      showError('वैधता त्रुटी', 'QR कोड इमेजची साईझ २ MB पेक्षा जास्त असू नये.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setQrCodeData(result);
      setHasExistingQr(true);
    };
    reader.onerror = () => {
      showError('त्रुटी', 'इमेज वाचताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveQr = () => {
    setQrCodeData(null);
    setHasExistingQr(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    const trimmedUpi = upiId.trim();
    const hasQr = Boolean(qrCodeData || hasExistingQr);

    // Validate: if isActive is true, at least one method is mandatory
    if (isActive && !trimmedUpi && !hasQr) {
      showError('वैधता त्रुटी', 'ऑनलाइन पेमेंट सक्रिय करण्यासाठी किमान एक पद्धत (UPI आयडी किंवा QR कोड) आवश्यक आहे.');
      return;
    }

    // Validate UPI pattern if entered
    if (trimmedUpi && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(trimmedUpi)) {
      showError('वैधता त्रुटी', 'कृपया वैध UPI आयडी प्रविष्ट करा (उदा. mandal@upi किंवा 9876543210@sbi).');
      return;
    }

    setSaving(true);
    try {
      const res = await upsertPaymentConfig({
        upiId: trimmedUpi || undefined,
        qrCodeData: qrCodeData, // If null, backend removes or leaves untouched
        isActive,
        notes: notes.trim() || undefined,
      });

      if (res.success && res.data) {
        setUpiId(res.data.upiId || '');
        setQrCodeData(res.data.qrCodeData || null);
        setHasExistingQr(Boolean(res.data.hasQrCode || res.data.qrCodeData));
        setIsActive(Boolean(res.data.isActive));
        showSuccess('यशस्वी', 'ऑनलाइन भरणा रचना यशस्वीरीत्या जतन झाली!');
      } else {
        showError('त्रुटी', res.error || 'पेमेंट रचना जतन करता आली नाही.');
      }
    } catch {
      showError('त्रुटी', 'सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold leading-tight">
                {canEdit ? 'ऑनलाइन भरणा रचना (UPI / QR)' : 'ऑनलाइन भरणा माहिती (UPI / QR)'}
              </h3>
              <p className="text-[11px] text-orange-100 mt-0.5">
                {canEdit ? 'मंडळाचा UPI आयडी व QR कोड व्यवस्थापन' : 'मंडळाचा UPI आयडी व QR कोड (फक्त पाहण्यासाठी)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center transition-all min-h-[44px] min-w-[44px] cursor-pointer"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 max-h-[calc(85vh-72px)] overflow-y-auto space-y-4">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              माहिती लोड होत आहे...
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              {/* Treasurer Read-only notice */}
              {!canEdit && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-2 text-xs text-blue-800">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>
                    केवळ मंडळाचे अध्यक्ष पेमेंट रचना बदलू शकतात. खजिनदार म्हणून आपण ही माहिती फक्त पाहू शकता.
                  </span>
                </div>
              )}

              {/* Status Banner */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">ऑनलाइन भरणा सेवा:</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                      isActive
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isActive ? (
                      <>
                        <Power className="w-3.5 h-3.5 text-emerald-600" />
                        सक्रिय (Active)
                      </>
                    ) : (
                      <>
                        <Ban className="w-3.5 h-3.5 text-slate-500" />
                        बंद (Disabled)
                      </>
                    )}
                  </span>
                </div>

                {canEdit && (
                  <label className="flex items-center gap-3 pt-2 border-t border-slate-200 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-800">
                      सदस्यांसाठी ऑनलाइन भरणा पर्याय सुरू ठेवा
                    </span>
                  </label>
                )}
              </div>

              {/* UPI ID Field */}
              <div className="p-3.5 bg-orange-50/40 rounded-2xl border border-orange-200/70 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-800">
                    मंडळाचा अधिकृत UPI आयडी (VPA)
                  </label>
                  <span className="text-[10px] text-orange-700 font-semibold bg-orange-100 px-2 py-0.5 rounded-md">
                    पर्यायी (QR उपलब्ध असल्यास)
                  </span>
                </div>

                {canEdit ? (
                  <input
                    type="text"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value.trim())}
                    placeholder="उदा. mandal@upi किंवा 9876543210@sbi"
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-white border border-orange-300 rounded-xl text-xs text-slate-900 font-mono focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                ) : (
                  <div className="min-h-[40px] px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800">
                    {upiId || 'सेट केलेला नाही'}
                  </div>
                )}
                <p className="text-[11px] text-slate-500 leading-tight">
                  सदस्य या UPI आयडीवर थेट PhonePe, GPay, Paytm किंवा BHIM द्वारे हप्ता पाठवू शकतात.
                </p>
              </div>

              {/* QR Code Upload / Display */}
              <div className="p-3.5 bg-amber-50/40 rounded-2xl border border-amber-200/70 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-800">
                    मंडळाचा QR कोड (QR Code Image)
                  </label>
                  <span className="text-[10px] text-amber-800 font-semibold bg-amber-100 px-2 py-0.5 rounded-md">
                    पर्यायी (UPI उपलब्ध असल्यास)
                  </span>
                </div>

                {/* QR Code Preview */}
                {(qrCodeData || hasExistingQr) ? (
                  <div className="p-3 bg-white rounded-2xl border border-amber-200 flex flex-col items-center gap-3">
                    {qrCodeData ? (
                      <img
                        src={qrCodeData}
                        alt="Mandal Payment QR"
                        className="w-48 h-48 object-contain rounded-xl border border-slate-200 shadow-xs"
                      />
                    ) : (
                      <div className="w-48 h-48 rounded-xl bg-slate-50 border border-dashed border-slate-300 flex flex-col items-center justify-center p-3 text-center">
                        <QrCode className="w-12 h-12 text-slate-400 mb-1" />
                        <span className="text-xs font-bold text-slate-600">QR कोड अपलोड केलेला आहे</span>
                      </div>
                    )}

                    {canEdit && (
                      <button
                        type="button"
                        onClick={handleRemoveQr}
                        className="py-1.5 px-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-red-200"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        QR कोड काढून टाका
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-white rounded-2xl border-2 border-dashed border-amber-200 text-center space-y-2">
                    <QrCode className="w-10 h-10 text-amber-500/70 mx-auto" />
                    <p className="text-xs text-slate-600 font-medium">
                      सध्या कोणताही QR कोड अपलोड केलेला नाही
                    </p>
                    {canEdit && (
                      <p className="text-[11px] text-slate-400">
                        PNG किंवा JPEG इमेज निवडा (कमाल आकार: २ MB)
                      </p>
                    )}
                  </div>
                )}

                {/* File input button for President */}
                {canEdit && (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/jpg"
                      onChange={handleFileChange}
                      className="hidden"
                      id="qr-code-upload"
                    />
                    <label
                      htmlFor="qr-code-upload"
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-white border border-amber-300 hover:bg-amber-50 active:scale-98 text-amber-900 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
                    >
                      <Upload className="w-4 h-4 text-amber-700" />
                      {(qrCodeData || hasExistingQr) ? 'नवीन QR कोड बदला' : 'QR कोड इमेज अपलोड करा'}
                    </label>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  सदस्यांसाठी विशेष सूचना / टीप (पर्यायी)
                </label>
                {canEdit ? (
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="उदा. भरणा केल्यानंतर स्क्रीनशॉट पाठवणे किंवा संदर्भ क्रमांक देणे"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                    {notes || 'कोणतीही टीप नाही'}
                  </div>
                )}
              </div>

              {/* Security Banner */}
              <div className="p-3 bg-blue-50/80 border border-blue-100 rounded-2xl flex items-start gap-2.5 text-[11px] text-blue-800">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong>पारदर्शक कारभार:</strong> सदस्य ऑनलाइन भरणा केल्यानंतर सूचना पाठवतात. अध्यक्ष किंवा खजिनदार पडताळणी करून मंजुरी दिल्यानंतरच अधिकृत पावती तयार होते.
                </span>
              </div>

              {/* Save Button (President only) */}
              {canEdit && (
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-orange-600 hover:bg-orange-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'जतन करत आहे...' : 'पेमेंट रचना जतन करा'}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};
