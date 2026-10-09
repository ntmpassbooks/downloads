import React from 'react';
import { Download, AlertTriangle, Sparkles, X, ShieldAlert } from 'lucide-react';
import { AppUpdateInfo } from '../services/update.service.js';
import { ModalPortal } from './ModalPortal';

interface AppUpdateModalProps {
  updateInfo: AppUpdateInfo | null;
  isOpen: boolean;
  onDismiss: () => void;
}

export const AppUpdateModal: React.FC<AppUpdateModalProps> = ({
  updateInfo,
  isOpen,
  onDismiss,
}) => {
  if (!isOpen || !updateInfo || !updateInfo.hasUpdate) {
    return null;
  }

  const { isMandatory, currentVersion, latestVersion, releaseNotes, downloadPageUrl } = updateInfo;

  const handleDownloadClick = () => {
    // Safely open the official download page
    window.open(downloadPageUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 via-amber-600 to-amber-700 px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs shadow-inner">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h3 id="update-dialog-title" className="text-base font-bold leading-tight">
                नवीन अपडेट उपलब्ध आहे
              </h3>
              <p className="text-xs text-orange-100 mt-0.5">
                NTM Passbook ची नवीन आवृत्ती उपलब्ध आहे.
              </p>
            </div>
          </div>
          {!isMandatory && (
            <button
              onClick={onDismiss}
              type="button"
              aria-label="बंद करा"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 active:scale-95 transition-colors text-white/80 hover:text-white cursor-pointer -mr-2"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Version comparison card */}
          <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 flex items-center justify-between text-xs sm:text-sm">
            <div>
              <span className="text-slate-500 font-medium block text-[11px]">सध्याची आवृत्ती</span>
              <span className="font-bold text-slate-800">v{currentVersion}</span>
            </div>
            <div className="text-orange-500 font-bold text-base">➔</div>
            <div className="text-right">
              <span className="text-orange-600 font-medium block text-[11px]">नवीन आवृत्ती</span>
              <span className="font-bold text-orange-700 bg-orange-100/70 px-2 py-0.5 rounded-md">
                v{latestVersion}
              </span>
            </div>
          </div>

          {/* Release Notes */}
          {releaseNotes && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-slate-700">अपडेटमधील बदल:</h4>
              <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-3 text-xs text-slate-700 leading-relaxed max-h-32 overflow-y-auto">
                {releaseNotes}
              </div>
            </div>
          )}

          {/* Mandatory Critical Uninstall/Install Instructions Box */}
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-3.5 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-900 leading-relaxed font-medium space-y-1">
              <p className="font-bold text-red-700 uppercase tracking-wide">महत्त्वाचे:</p>
              <p>नवीन आवृत्ती स्थापित करण्यापूर्वी</p>
              <p className="font-semibold text-red-800">कृपया सध्याचे NTM Passbook App uninstall करा.</p>
              <p>त्यानंतर अधिकृत Download Page वरून नवीन आवृत्ती डाउनलोड करून install करा.</p>
            </div>
          </div>

          {isMandatory && (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>सध्याची आवृत्ती जुनी असल्याने अपडेट करणे अनिवार्य आहे.</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={handleDownloadClick}
              type="button"
              className="flex-1 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-[0.98] text-white py-2.5 px-4 rounded-xl font-bold text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <Download className="w-4 h-4" />
              <span>अपडेट डाउनलोड करा</span>
            </button>
            {!isMandatory && (
              <button
                onClick={onDismiss}
                type="button"
                className="bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm cursor-pointer transition-all"
              >
                नंतर करा
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};
