import React, { useState, useMemo } from 'react';
import { useNotifications } from '../context/NotificationContext';
import { useNavigation } from '../context/NavigationContext';
import { NotificationRecord } from '../api/notifications';
import {
  X,
  Bell,
  CheckCheck,
  Calendar,
  CreditCard,
  Receipt,
  ShieldCheck,
  Coins,
  AlertCircle,
  Clock,
  Inbox,
  Loader2,
} from 'lucide-react';

type FilterTab = 'ALL' | 'BISHI' | 'PAYMENTS' | 'LOANS' | 'OTHER';

export const NotificationModal: React.FC = () => {
  const {
    isOpen,
    closeNotifications,
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
  } = useNotifications();
  const { navigateTo } = useNavigation();

  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'ALL') return notifications;
    if (activeTab === 'BISHI') {
      return notifications.filter((n) =>
        ['BISHI_DUE', 'BISHI_DUE_TODAY', 'BISHI_OVERDUE', 'BISHI_PAID'].includes(n.type)
      );
    }
    if (activeTab === 'PAYMENTS') {
      return notifications.filter((n) =>
        ['PAYMENT_INITIATED', 'PAYMENT_VERIFIED', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED'].includes(n.type)
      );
    }
    if (activeTab === 'LOANS') {
      return notifications.filter((n) =>
        ['LOAN_DISBURSED', 'LOAN_REPAYMENT', 'LOAN_DUE_REMINDER'].includes(n.type)
      );
    }
    // OTHER
    return notifications.filter((n) =>
      ['FINANCIAL_EVENT', 'SECURITY_EVENT', 'ANNOUNCEMENT'].includes(n.type)
    );
  }, [notifications, activeTab]);

  if (!isOpen) return null;

  const formatMarathiTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 1) return 'आत्ताच';
      if (diffMins < 60) return `${diffMins} मिनिटांपूर्वी`;
      if (diffHours < 24) return `${diffHours} तासांपूर्वी`;
      if (diffDays === 1) return 'काल';
      if (diffDays < 7) return `${diffDays} दिवसांपूर्वी`;

      return date.toLocaleDateString('mr-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getNotificationIcon = (n: NotificationRecord) => {
    switch (n.type) {
      case 'BISHI_DUE':
      case 'BISHI_DUE_TODAY':
      case 'BISHI_OVERDUE':
        return (
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0 border border-amber-500/20">
            <Calendar className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
      case 'BISHI_PAID':
        return (
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-500/20">
            <Coins className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
      case 'PAYMENT_VERIFIED':
        return (
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-500/20">
            <CreditCard className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
      case 'PAYMENT_FAILED':
      case 'PAYMENT_EXPIRED':
        return (
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0 border border-rose-500/20">
            <AlertCircle className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
      case 'PAYMENT_INITIATED':
        return (
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0 border border-sky-500/20">
            <CreditCard className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
      case 'LOAN_DISBURSED':
      case 'LOAN_REPAYMENT':
      case 'LOAN_DUE_REMINDER':
        return (
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0 border border-blue-500/20">
            <Receipt className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
      case 'SECURITY_EVENT':
        return (
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0 border border-purple-500/20">
            <ShieldCheck className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
      case 'FINANCIAL_EVENT':
      default:
        return (
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-500/20">
            <Bell className="w-5 h-5 stroke-[2.2]" />
          </div>
        );
    }
  };

  const handleNotificationClick = (item: NotificationRecord) => {
    if (!item.isRead) {
      markAsRead(item.id);
    }
    closeNotifications();

    // Deep-link navigation based on notification type and entity
    if (item.type.startsWith('BISHI') || item.entityType === 'BISHI') {
      navigateTo('bishi');
    } else if (
      item.type.startsWith('PAYMENT') ||
      item.type === 'FINANCIAL_EVENT' ||
      item.entityType === 'PAYMENT_ORDER' ||
      item.entityType === 'VARGANI'
    ) {
      navigateTo('transactions');
    } else if (item.type.startsWith('LOAN') || item.entityType === 'LOAN') {
      navigateTo('loans');
    } else if (item.type === 'SECURITY_EVENT' || item.entityType === 'SECURITY') {
      navigateTo('profile', 'security-section');
    } else if (item.entityType === 'EXPENSE') {
      navigateTo('expenses');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden my-auto animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-modal-title"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 text-white px-4 py-3.5 flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Bell className="w-5 h-5 stroke-[2.2]" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-orange-600">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <div>
              <h2 id="notification-modal-title" className="text-base font-bold tracking-tight">
                सूचना केंद्र (Notifications)
              </h2>
              <p className="text-[11px] text-orange-100 font-medium">
                {unreadCount > 0 ? `${unreadCount} न वाचलेल्या सूचना` : 'सर्व सूचना अद्ययावत आहेत'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeNotifications}
            className="w-9 h-9 rounded-xl hover:bg-white/20 active:scale-95 transition-all text-white flex items-center justify-center cursor-pointer"
            title="बंद करा (Close)"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5 stroke-[2.2]" />
          </button>
        </div>

        {/* Action bar & Filter Tabs */}
        <div className="border-b border-slate-200 bg-slate-50/80 px-3 py-2 shrink-0 flex flex-col gap-2">
          {unreadCount > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={markAllAsRead}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 hover:text-orange-800 active:scale-95 transition-all py-1 px-2.5 rounded-lg bg-orange-100 hover:bg-orange-200/80 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                सर्व वाचल्या म्हणून चिन्हांकित करा
              </button>
            </div>
          )}

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-colors cursor-pointer ${
                activeTab === 'ALL'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              सर्व ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('BISHI')}
              className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-colors cursor-pointer ${
                activeTab === 'BISHI'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              बिशी
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PAYMENTS')}
              className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-colors cursor-pointer ${
                activeTab === 'PAYMENTS'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              पेमेंट
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('LOANS')}
              className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-colors cursor-pointer ${
                activeTab === 'LOANS'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              कर्ज
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('OTHER')}
              className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-colors cursor-pointer ${
                activeTab === 'OTHER'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              इतर
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-1">
          {isLoading && notifications.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="w-7 h-7 animate-spin text-orange-600" />
              <p className="text-xs">सूचना लोड होत आहेत...</p>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center text-slate-400 gap-2">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                <Inbox className="w-6 h-6 stroke-[1.8]" />
              </div>
              <p className="text-sm font-semibold text-slate-700">कोणतीही सूचना नाही</p>
              <p className="text-xs text-slate-500 max-w-xs">
                {activeTab === 'ALL'
                  ? 'मंडळाच्या सर्व महत्त्वाच्या घडामोडी व पावत्या येथे दिसतील.'
                  : 'या विभागात सध्या कोणत्याही नोंदी उपलब्ध नाहीत.'}
              </p>
            </div>
          ) : (
            filteredNotifications.map((item) => (
              <div
                key={item.id}
                onClick={() => handleNotificationClick(item)}
                className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer rounded-xl mx-1 my-0.5 ${
                  item.isRead
                    ? 'hover:bg-slate-50 opacity-80'
                    : 'bg-orange-50/40 hover:bg-orange-50/80 border border-orange-100/80'
                }`}
              >
                {getNotificationIcon(item)}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1.5">
                    <h3 className={`text-sm leading-snug ${item.isRead ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>
                      {item.title}
                    </h3>
                    {!item.isRead && (
                      <span className="w-2 h-2 rounded-full bg-orange-600 shrink-0 mt-1" title="न वाचलेली" />
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed break-words">
                    {item.message}
                  </p>
                  <div className="flex items-center gap-1 mt-1.5 text-[11px] text-slate-400">
                    <Clock className="w-3 h-3 stroke-[1.8]" />
                    <span>{formatMarathiTime(item.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 text-center shrink-0">
          <p className="text-[11px] text-slate-500">
            NTM Passbook • सुरक्षित डिजिटल सूचना प्रणाली
          </p>
        </div>
      </div>
    </div>
  );
};
