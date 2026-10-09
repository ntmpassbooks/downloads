import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { strings } from '../i18n/mr.js';

interface SplashScreenProps {
  error?: string | null;
  onRetry?: () => void;
  mandalName?: string | null;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ error, onRetry, mandalName }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-between p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-b from-orange-600 via-orange-500 to-amber-600 text-white select-none overflow-hidden h-full w-full relative">
      {/* Decorative ambient background glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-400/25 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-800/30 rounded-full blur-3xl"></div>
      </div>

      {/* Top Balanced Spacing */}
      <div className="w-full h-4 sm:h-8 shrink-0"></div>

      {/* Center Branded Animated Core */}
      <div className="flex flex-col items-center justify-center text-center my-auto z-10 w-full px-2">
        {/* NTM Logo with Smooth Entrance & Gentle Ambient Pulse */}
        <div className="animate-ntm-logo relative">
          <div className="absolute -inset-2.5 bg-gradient-to-tr from-amber-300/40 via-white/20 to-orange-400/40 rounded-[34px] blur-xl opacity-90 animate-pulse"></div>
          <div className="animate-ntm-pulse-subtle relative w-28 h-28 sm:w-32 sm:h-32 rounded-[28px] bg-white p-2.5 shadow-2xl shadow-orange-950/30 flex items-center justify-center border border-white/40">
            <img
              src="./NTM_Passbook_Logo.png"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.tried) {
                  target.dataset.tried = 'true';
                  target.src = '/NTM_Passbook_Logo.png';
                }
              }}
              alt="एनटीएम पासबुक"
              className="w-full h-full object-contain rounded-[20px]"
            />
          </div>
        </div>

        {/* Primary Marathi Title with Fade & Slide Entrance */}
        <h1 className="animate-ntm-title text-2xl sm:text-3xl font-black text-white tracking-tight drop-shadow-md mt-6">
          {strings.appName}
        </h1>

        {/* Dynamic Brand Subtitle & Tagline Entrance */}
        <div className="animate-ntm-subtitle flex flex-col items-center mt-1.5 w-full max-w-full px-2">
          {mandalName && mandalName.trim().length > 0 ? (
            <p className="text-xs sm:text-sm font-extrabold text-orange-100 tracking-wide drop-shadow-xs max-w-full px-2 break-words text-center leading-snug">
              {mandalName.trim()}
            </p>
          ) : null}
          <p className="text-[11px] sm:text-xs text-orange-200/90 font-medium tracking-wide mt-1 text-center">
            {strings.tagline}
          </p>
        </div>
      </div>

      {/* Bottom Startup Status or Error Card + Fixed Developer Credit */}
      <div className="w-full max-w-xs shrink-0 pb-3 z-10 flex flex-col items-center justify-center gap-2.5">
        <div className="min-h-[58px] flex items-center justify-center w-full">
          {error ? (
            <div className="w-full p-4 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/40 text-center animate-in fade-in slide-in-from-bottom-3 duration-300">
              <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-2 shadow-xs">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                सर्व्हर सध्या उपलब्ध नाही.
              </h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                कृपया काही वेळाने पुन्हा प्रयत्न करा.
              </p>

              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 w-full py-2.5 px-4 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <span>पुन्हा प्रयत्न करा</span>
                </button>
              )}
            </div>
          ) : (
            <div className="animate-ntm-status flex flex-col items-center gap-2.5">
              {/* Animated Loading Indicator (3 Pulsing Dots) */}
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-white animate-bounce [animation-delay:-0.3s] shadow-xs"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-white/90 animate-bounce [animation-delay:-0.15s] shadow-xs"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-white/80 animate-bounce shadow-xs"></span>
              </div>

              {/* Real Startup Status Text */}
              <span className="text-xs sm:text-sm font-semibold text-white/95 tracking-wide drop-shadow-xs">
                ॲप सुरू करत आहे...
              </span>
            </div>
          )}
        </div>

        {/* Fixed Developer Credit */}
        <div className="pt-0.5 text-center select-none">
          <p className="text-[10px] sm:text-[11px] font-medium text-orange-200/80 tracking-wide">
            Developed by Santosh Koli
          </p>
        </div>
      </div>
    </div>
  );
};
