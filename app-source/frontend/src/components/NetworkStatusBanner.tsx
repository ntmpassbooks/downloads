import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';

export const NetworkStatusBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [showReconnected, setShowReconnected] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
      }, 3500);
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

  if (!isOnline) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="bg-red-600 text-white px-3.5 py-2 shadow-md flex items-center justify-between gap-2 text-xs sm:text-sm font-medium transition-all duration-200 z-50 shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <WifiOff className="w-4 h-4 shrink-0 animate-pulse text-red-200" />
          <div className="truncate">
            <span className="font-bold">इंटरनेट कनेक्शन उपलब्ध नाही.</span>
            <span className="ml-1.5 opacity-90 text-[11px] inline">
              (ऑफलाइन असताना आर्थिक व्यवहार व बदल सेव्ह होत नाहीत.)
            </span>
          </div>
        </div>
        <button
          onClick={() => window.location.reload()}
          type="button"
          aria-label="पुन्हा प्रयत्न करा"
          className="bg-red-700 hover:bg-red-800 active:scale-95 text-white px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          <span>रिफ्रेश</span>
        </button>
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-emerald-600 text-white px-3.5 py-1.5 shadow-sm flex items-center justify-center gap-2 text-xs font-semibold transition-all duration-300 z-50 shrink-0"
      >
        <Wifi className="w-3.5 h-3.5 text-emerald-200 animate-bounce" />
        <span>इंटरनेट कनेक्शन जोडले गेले.</span>
      </div>
    );
  }

  return null;
};
