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
      role="alert"
      aria-live="assertive"
      className="bg-amber-600 text-white px-3.5 py-2.5 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs sm:text-sm font-medium transition-all duration-200 z-50 shrink-0 border-b border-amber-700/50"
    >
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-full bg-amber-700/60 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
          <WifiOff className="w-3.5 h-3.5 text-amber-100 animate-pulse" />
        </div>
        <div className="min-w-0">
          <span className="font-bold block sm:inline">सर्व्हर सध्या उपलब्ध नाही.</span>
          <span className="text-[11px] sm:text-xs text-amber-100 sm:ml-2 block sm:inline">
            कृपया काही वेळाने पुन्हा प्रयत्न करा.
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end shrink-0 pt-1 sm:pt-0">
        <button
          onClick={handleRetry}
          disabled={isChecking}
          type="button"
          aria-label="पुन्हा प्रयत्न करा"
          className="bg-amber-700 hover:bg-amber-800 active:scale-95 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
          <span>{isChecking ? 'तपासत आहे...' : 'पुन्हा प्रयत्न करा'}</span>
        </button>
      </div>
    </div>
  );
};
