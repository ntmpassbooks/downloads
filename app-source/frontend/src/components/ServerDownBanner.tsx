import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useServerAvailability } from '../context/ServerAvailabilityContext.js';

interface ServerDownBannerProps {
  onRetrySuccess?: () => void;
}

export const ServerDownBanner: React.FC<ServerDownBannerProps> = ({ onRetrySuccess }) => {
  const { isServerDown, isChecking, retryConnection } = useServerAvailability();

  if (!isServerDown) {
    return null;
  }

  const handleRetry = async () => {
    if (isChecking) return;
    const isAvailable = await retryConnection();
    if (isAvailable && onRetrySuccess) {
      onRetrySuccess();
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="server-down-title"
      aria-describedby="server-down-desc"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto"
    >
      <div className="relative w-full max-w-sm sm:max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-amber-300 dark:border-amber-700/60 p-6 text-center flex flex-col items-center animate-in zoom-in-95 duration-200 my-auto">
        {/* Warning Icon Badge */}
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center mb-4 shadow-inner text-amber-600 dark:text-amber-400">
          <WifiOff className="w-8 h-8 animate-pulse" />
        </div>

        {/* Title */}
        <h3
          id="server-down-title"
          className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight mb-2"
        >
          सर्व्हर सध्या उपलब्ध नाही.
        </h3>

        {/* Message */}
        <p
          id="server-down-desc"
          className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed"
        >
          कृपया काही वेळाने पुन्हा प्रयत्न करा.
        </p>

        {/* Retry Button */}
        <button
          onClick={handleRetry}
          disabled={isChecking}
          type="button"
          aria-label="पुन्हा प्रयत्न करा"
          className="w-full py-3 px-5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 active:scale-98 disabled:opacity-60 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition-all cursor-pointer min-h-[44px]"
        >
          <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
          <span>{isChecking ? 'तपासत आहे...' : 'पुन्हा प्रयत्न करा'}</span>
        </button>
      </div>
    </div>
  );
};
