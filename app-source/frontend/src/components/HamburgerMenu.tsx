import React from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useNavigation, NavTab } from '../context/NavigationContext.js';
import { useNotifications } from '../context/NotificationContext.js';
import { RoleBadge } from './RoleBadge.js';
import { strings } from '../i18n/mr.js';
import {
  X,
  Home,
  Users,
  Coins,
  Wallet,
  HandCoins,
  Receipt,
  FileSpreadsheet,
  Building2,
  LogOut,
  UserCircle,
  BookOpen,
  ShieldCheck,
  ChevronRight,
  CreditCard,
  Bell,
} from 'lucide-react';

export const HamburgerMenu: React.FC = () => {
  const { user, organization, logout } = useAuth();
  const { isMenuOpen, closeMenu, currentTab, navigateTo } = useNavigation();
  const { unreadCount, openNotifications } = useNotifications();

  if (!isMenuOpen || !user) return null;

  const role = user.role;

  interface MenuItem {
    id: string;
    label: string;
    sublabel?: string;
    icon: React.ComponentType<{ className?: string }>;
    tab: NavTab;
    sectionId?: string;
  }

  const getMenuItems = (): MenuItem[] => {
    if (role === 'PRESIDENT') {
      return [
        {
          id: 'home',
          label: 'मुख्यपृष्ठ',
          sublabel: 'डॅशबोर्ड व आढावा',
          icon: Home,
          tab: 'dashboard',
        },
        {
          id: 'members',
          label: 'सदस्य व्यवस्थापन',
          sublabel: 'सदस्य यादी व नवीन नोंदणी',
          icon: Users,
          tab: 'members',
        },
        {
          id: 'bishi',
          label: 'बीशी व्यवस्थापन',
          sublabel: 'मासिक चक्र व बीसी रचना',
          icon: Coins,
          tab: 'bishi',
        },
        {
          id: 'transactions',
          label: 'व्यवहार',
          sublabel: 'अधिकृत आर्थिक व्यवहार व पावत्या',
          icon: Wallet,
          tab: 'transactions',
        },
        {
          id: 'loans',
          label: 'कर्ज व्यवस्थापन',
          sublabel: 'उधार वाटप व परतफेड',
          icon: HandCoins,
          tab: 'loans',
        },
        {
          id: 'expenses',
          label: 'मंडळ खर्च',
          sublabel: 'खर्च नोंदी व वर्गीकरण',
          icon: Receipt,
          tab: 'expenses',
        },
        {
          id: 'reports',
          label: 'आर्थिक अहवाल / ऑडिट',
          sublabel: 'मासिक विवरण व CSV डाऊनलोड',
          icon: FileSpreadsheet,
          tab: 'reports',
        },
        {
          id: 'security',
          label: 'सुरक्षा',
          sublabel: 'पिन बदल व खाते सुरक्षा',
          icon: ShieldCheck,
          tab: 'profile',
          sectionId: 'security-section',
        },
        {
          id: 'payment-settings',
          label: 'ऑनलाइन भरणा रचना',
          sublabel: 'UPI व डिजिटल भरणा सेटिंग्ज',
          icon: CreditCard,
          tab: 'profile',
          sectionId: 'payment-settings-section',
        },
        {
          id: 'mandal-settings',
          label: 'मंडळ सेटिंग्ज',
          sublabel: 'मंडळ तपशील व धोकादायक कक्ष',
          icon: Building2,
          tab: 'profile',
          sectionId: 'mandal-settings-section',
        },
        {
          id: 'profile',
          label: 'प्रोफाइल',
          sublabel: 'माझे खाते तपशील',
          icon: UserCircle,
          tab: 'profile',
          sectionId: 'profile-section',
        },
      ];
    }

    if (role === 'TREASURER') {
      return [
        {
          id: 'home',
          label: 'मुख्यपृष्ठ',
          sublabel: 'डॅशबोर्ड व आढावा',
          icon: Home,
          tab: 'dashboard',
        },
        {
          id: 'bishi',
          label: 'बिशी व्यवस्थापन',
          sublabel: 'मासिक चक्र व बीसी भरणा',
          icon: Coins,
          tab: 'bishi',
        },
        {
          id: 'transactions',
          label: 'व्यवहार',
          sublabel: 'अधिकृत आर्थिक व्यवहार व पावत्या',
          icon: Wallet,
          tab: 'transactions',
        },
        {
          id: 'loans',
          label: 'कर्ज व्यवस्थापन',
          sublabel: 'उधार व रोख परतफेड',
          icon: HandCoins,
          tab: 'loans',
        },
        {
          id: 'expenses',
          label: 'मंडळ खर्च',
          sublabel: 'खर्च नोंदी व पावती',
          icon: Receipt,
          tab: 'expenses',
        },
        {
          id: 'reports',
          label: 'आर्थिक अहवाल / ऑडिट',
          sublabel: 'मासिक विवरण व ऑडिट',
          icon: FileSpreadsheet,
          tab: 'reports',
        },
        {
          id: 'profile',
          label: 'प्रोफाइल',
          sublabel: 'माझे खाते तपशील',
          icon: UserCircle,
          tab: 'profile',
          sectionId: 'profile-section',
        },
        {
          id: 'security',
          label: 'सुरक्षा',
          sublabel: 'पिन बदल व सत्र माहिती',
          icon: ShieldCheck,
          tab: 'profile',
          sectionId: 'security-section',
        },
      ];
    }

    // MEMBER role
    return [
      {
        id: 'home',
        label: 'मुख्यपृष्ठ',
        sublabel: 'डॅशबोर्ड माहिती',
        icon: Home,
        tab: 'dashboard',
      },
      {
        id: 'my-bishi',
        label: 'माझी बीशी',
        sublabel: 'हप्ता व भरणा इतिहास',
        icon: Coins,
        tab: 'bishi',
      },
      {
        id: 'my-loans',
        label: 'माझे कर्ज',
        sublabel: 'कर्ज तपशील व परतफेड',
        icon: HandCoins,
        tab: 'loans',
      },
      {
        id: 'passbook',
        label: 'माझे पासबुक',
        sublabel: 'डिजिटल पासबुक व पावत्या',
        icon: BookOpen,
        tab: 'profile',
        sectionId: 'passbook-section',
      },
      {
        id: 'profile',
        label: 'प्रोफाइल',
        sublabel: 'माझे खाते तपशील',
        icon: UserCircle,
        tab: 'profile',
        sectionId: 'profile-section',
      },
      {
        id: 'security',
        label: 'सुरक्षा',
        sublabel: 'पिन बदल व खाते सुरक्षा',
        icon: ShieldCheck,
        tab: 'profile',
        sectionId: 'security-section',
      },
    ];
  };

  const menuItems = getMenuItems();

  return (
    <div className="absolute inset-0 z-50 overflow-hidden select-none animate-in fade-in duration-200">
      {/* Semi-transparent Backdrop (Constrained to Mobile Frame) */}
      <div
        onClick={closeMenu}
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
      />

      {/* Slide-out Drawer Panel (Constrained to Mobile Container, Width: w-[82%] max-w-[300px]) */}
      <div className="absolute inset-y-0 right-0 w-[82%] max-w-[300px] bg-white shadow-2xl flex flex-col border-l border-slate-200 transform transition-transform duration-300 ease-out">
        {/* Drawer Header */}
        <div className="bg-gradient-to-br from-orange-600 to-amber-600 text-white p-4 pt-[max(1rem,env(safe-area-inset-top))] shrink-0 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm">
                ☰
              </div>
              <h2 className="text-sm font-bold tracking-tight">मेन्यू (Menu)</h2>
            </div>
            <button
              type="button"
              onClick={closeMenu}
              className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-white/20 hover:bg-white/30 active:scale-95 flex items-center justify-center transition-all text-white cursor-pointer -mr-1"
              aria-label="मेनू बंद करा"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* User & Mandal Identity Card */}
          <div className="bg-white/10 rounded-xl p-2.5 backdrop-blur-xs border border-white/20 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-xs truncate min-w-0 flex-1">{user.fullName}</span>
              <RoleBadge role={user.role} className="shrink-0" />
            </div>
            <div className="flex items-center justify-between text-[10px] text-orange-100">
              <span className="font-mono">+91 {user.phone}</span>
              {organization && (
                <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded text-[9px]">
                  {organization.code}
                </span>
              )}
            </div>
            {organization && (
              <p className="text-[10px] text-orange-200 truncate pt-0.5 border-t border-white/10 mt-0.5">
                {organization.name}
              </p>
            )}
          </div>
        </div>

        {/* Scrollable Navigation Items */}
        <nav className="flex-1 overflow-y-auto p-2.5 space-y-0.5 divide-y divide-slate-100">
          <div className="space-y-0.5 pb-2">
            {/* Notifications Shortcut Button */}
            <button
              type="button"
              onClick={() => {
                closeMenu();
                openNotifications();
              }}
              className="w-full p-2.5 rounded-xl text-left flex items-center justify-between transition-all min-h-[44px] cursor-pointer hover:bg-orange-50/60 text-slate-700 active:scale-[0.99] border border-orange-100 bg-orange-50/30 mb-1.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-orange-100 text-orange-600">
                  <Bell className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight truncate text-orange-950">
                    सूचना (Notifications)
                  </div>
                  <div className="text-[9px] text-slate-400 font-normal truncate mt-0.5">
                    बिशी, पेमेंट व इतर सूचना
                  </div>
                </div>
              </div>
              {unreadCount > 0 ? (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-300" />
              )}
            </button>

            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.tab && !item.sectionId;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.tab, item.sectionId)}
                  className={`w-full p-2.5 rounded-xl text-left flex items-center justify-between transition-all min-h-[44px] cursor-pointer ${
                    isActive
                      ? 'bg-orange-50 text-orange-700 font-bold border border-orange-200'
                      : 'hover:bg-slate-50 text-slate-700 active:scale-[0.99]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-orange-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold leading-tight truncate">
                        {item.label}
                      </div>
                      {item.sublabel && (
                        <div className="text-[9px] text-slate-400 font-normal truncate mt-0.5">
                          {item.sublabel}
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-orange-600' : 'text-slate-300'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Footer Action: Logout */}
          <div className="pt-2">
            <button
              type="button"
              onClick={async () => {
                closeMenu();
                await logout();
              }}
              className="w-full p-2.5 rounded-xl bg-red-50 hover:bg-red-100/80 active:scale-[0.99] border border-red-200 text-red-700 text-xs font-bold flex items-center justify-center gap-2 transition-all min-h-[44px] cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{strings.auth.logoutButton} (Log Out)</span>
            </button>
          </div>
        </nav>

        {/* Brand & Security Stamp */}
        <div className="p-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-200 bg-slate-50/80 text-center text-[10px] text-slate-400 space-y-0.5 shrink-0">
          <div className="flex items-center justify-center gap-1 font-semibold text-slate-500 text-[10px]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>एनटीएम पासबुक • सुरक्षित प्रणाली</span>
          </div>
          <p className="text-[9px] text-slate-400">सर्व हक्क सुरक्षित • २०२६</p>
        </div>
      </div>
    </div>
  );
};
