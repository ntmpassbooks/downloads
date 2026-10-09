import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi, RefreshCw, BookOpen, X } from 'lucide-react';
import { useOptionalNavigation } from '../context/NavigationContext.js';
import { ModalPortal } from './ModalPortal';

export const NetworkStatusBanner: React.FC = () => {
  const nav = useOptionalNavigation();
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [showReconnected, setShowReconnected] = useState<boolean>(false);
  const [dismissedModal, setDismissedModal] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      setDismissedModal(false);
      const timer = setTimeout(() => {
        setShowReconnected(false);
      }, 3000);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showReconnected) {
    return null;
  }

  // Offline: Floating Banner if Modal is dismissed
  if (!isOnline && dismissedModal) {
    return (
      <div className="bg-amber-600 text-white px-3 py-2 text-xs font-bold flex items-center justify-between shadow-md z-40 sticky top-0 animate-in slide-in-from-top-2 duration-150">
        <div className="flex items-center gap-2 min-w-0">
          <WifiOff className="w-4 h-4 shrink-0 animate-pulse text-amber-200" />
          <span className="truncate">ऑफलाइन मोड: फक्त सेव्ह केलेले पासबुक उपलब्ध (व्यवहार व बदल बंद)</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {nav && (
            <button
              type="button"
              onClick={() => nav.navigateTo('transactions')}
              className="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded text-[11px] font-bold min-h-[32px] cursor-pointer flex items-center gap-1"
            >
              <BookOpen className="w-3 h-3" />
              <span>पासबुक</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissedModal(false)}
            className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-[11px] font-bold min-h-[32px] cursor-pointer"
          >
            माहिती
          </button>
        </div>
      </div>
    );
  }

  // Offline: Centered Dialog with Option to Inspect Offline Passbook
  if (!isOnline && !dismissedModal) {
    return (
      <ModalPortal>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="network-offline-title"
          aria-describedby="network-offline-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto"
        >
          <div className="relative w-full max-w-sm sm:max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-red-300 dark:border-red-800 p-6 text-center flex flex-col items-center animate-in zoom-in-95 duration-200 my-auto">
            {/* Close button to dismiss and inspect offline view */}
            <button
              type="button"
              onClick={() => setDismissedModal(true)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
              aria-label="बंद करा"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Offline Icon Badge */}
            <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-950/60 flex items-center justify-center mb-4 shadow-inner text-red-600 dark:text-red-400">
              <WifiOff className="w-8 h-8 animate-pulse" />
            </div>

            {/* Title */}
            <h3
              id="network-offline-title"
              className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight mb-2"
            >
              इंटरनेट कनेक्शन उपलब्ध नाही
            </h3>

            {/* Description */}
            <p
              id="network-offline-desc"
              className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed"
            >
              ऑफलाइन असताना नवीन आर्थिक व्यवहार, कर्ज किंवा नोंदी सेव्ह होत नाहीत. तथापि, आपण पूर्वी सेव्ह केलेले व्यक्तिगत पासबुक ऑफलाइन तपासू शकता.
            </p>

            <div className="w-full space-y-2">
              {/* View Offline Passbook */}
              <button
                onClick={() => {
                  if (nav) {
                    nav.navigateTo('transactions');
                  }
                  setDismissedModal(true);
                }}
                type="button"
                className="w-full py-3 px-5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer min-h-[44px]"
              >
                <BookOpen className="w-4 h-4" />
                <span>ऑफलाइन पासबुक पहा</span>
              </button>

              {/* Refresh Action */}
              <button
                onClick={() => window.location.reload()}
                type="button"
                aria-label="रिफ्रेश करा"
                className="w-full py-2.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-98 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer min-h-[44px]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>पुन्हा तपासा / रिफ्रेश</span>
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    );
  }

  // Reconnected Toast/Modal
  if (showReconnected) {
    return (
      <ModalPortal>
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none animate-in fade-in duration-200"
        >
          <div className="bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs sm:text-sm font-bold border border-emerald-400/40 animate-in zoom-in-95 pointer-events-auto">
            <Wifi className="w-4 h-4 text-emerald-100" />
            <span>इंटरनेट कनेक्शन जोडले गेले.</span>
          </div>
        </div>
      </ModalPortal>
    );
  }

  return null;
};
