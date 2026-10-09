import React from 'react';
import { ModalPortal } from './ModalPortal.js';
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  RefreshCw,
} from 'lucide-react';

export type AlertModalType = 'info' | 'success' | 'warning' | 'error' | 'confirm';

export interface CenteredAlertModalProps {
  isOpen: boolean;
  type?: AlertModalType;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onClose: () => void;
  isLoading?: boolean;
  showCancel?: boolean;
}

export const CenteredAlertModal: React.FC<CenteredAlertModalProps> = ({
  isOpen,
  type = 'info',
  title,
  message,
  confirmText = 'ठीक आहे',
  cancelText = 'रद्द करा',
  onConfirm,
  onClose,
  isLoading = false,
  showCancel = false,
}) => {
  if (!isOpen) return null;

  const getIconAndColors = () => {
    switch (type) {
      case 'success':
        return {
          icon: <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />,
          badgeBg: 'bg-emerald-100 dark:bg-emerald-950/60',
          borderColor: 'border-emerald-200 dark:border-emerald-800',
          confirmBtn: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400" />,
          badgeBg: 'bg-rose-100 dark:bg-rose-950/60',
          borderColor: 'border-rose-200 dark:border-rose-800',
          confirmBtn: 'bg-rose-600 hover:bg-rose-700 text-white',
        };
      case 'warning':
      case 'confirm':
        return {
          icon: <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />,
          badgeBg: 'bg-amber-100 dark:bg-amber-950/60',
          borderColor: 'border-amber-200 dark:border-amber-800',
          confirmBtn: 'bg-amber-600 hover:bg-amber-700 text-white',
        };
      case 'info':
      default:
        return {
          icon: <Info className="w-8 h-8 text-blue-600 dark:text-blue-400" />,
          badgeBg: 'bg-blue-100 dark:bg-blue-950/60',
          borderColor: 'border-blue-200 dark:border-blue-800',
          confirmBtn: 'bg-blue-600 hover:bg-blue-700 text-white',
        };
    }
  };

  const { icon, badgeBg, borderColor, confirmBtn } = getIconAndColors();

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    } else {
      onClose();
    }
  };

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="centered-alert-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto"
      >
      <div
        className={`relative w-full max-w-sm sm:max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border ${borderColor} p-5 sm:p-6 text-center flex flex-col items-center animate-in zoom-in-95 duration-150 my-auto`}
      >
        {/* Dismiss close button */}
        {!isLoading && (
          <button
            type="button"
            onClick={onClose}
            aria-label="बंद करा"
            className="absolute top-4 right-4 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Icon Badge */}
        <div className={`w-14 h-14 rounded-2xl ${badgeBg} flex items-center justify-center mb-3.5 shadow-inner shrink-0`}>
          {icon}
        </div>

        {/* Title */}
        <h3
          id="centered-alert-title"
          className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight mb-2 px-2"
        >
          {title}
        </h3>

        {/* Message body */}
        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed px-2 w-full max-h-48 overflow-y-auto">
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>

        {/* Action Buttons */}
        <div className="w-full flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3">
          {(showCancel || type === 'confirm') && (
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs sm:text-sm font-semibold transition-all active:scale-98 cursor-pointer disabled:opacity-50 min-h-[44px]"
            >
              {cancelText}
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className={`flex-1 py-2.5 px-4 ${confirmBtn} rounded-xl text-xs sm:text-sm font-bold shadow-md hover:shadow-lg transition-all active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 min-h-[44px]`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>प्रक्रिया सुरू आहे...</span>
              </>
            ) : (
              <span>{confirmText}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  </ModalPortal>
  );
};
