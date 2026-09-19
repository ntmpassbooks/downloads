import React from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useNavigation } from '../context/NavigationContext.js';
import { useNotifications } from '../context/NotificationContext.js';
import { Menu, Bell } from 'lucide-react';
import { RoleBadge } from './RoleBadge.js';
import { HamburgerMenu } from './HamburgerMenu.js';
import { strings } from '../i18n/mr.js';

export const Navbar: React.FC = () => {
  const { user, organization } = useAuth();
  const { toggleMenu } = useNavigation();
  const { unreadCount, openNotifications } = useNotifications();

  return (
    <>
      <header className="bg-orange-600 text-white px-3.5 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5 sm:pb-3 shadow-md shrink-0 flex flex-col gap-1">
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <img
              src="/NTM_Passbook_Logo.png"
              alt="NTM Passbook"
              className="w-8 h-8 object-contain rounded-lg bg-white/10 p-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold tracking-tight leading-tight truncate">{strings.appName}</h1>
              <p className="text-[11px] text-orange-100 font-medium truncate">
                {organization ? organization.name : strings.tagline}
              </p>
            </div>
          </div>

          {user && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={openNotifications}
                className="relative min-w-[44px] min-h-[44px] rounded-xl hover:bg-orange-700/60 active:scale-95 transition-all text-white flex items-center justify-center cursor-pointer"
                title="सूचना (Notifications)"
                aria-label="सूचना"
              >
                <Bell className="w-5 h-5 stroke-[2.2]" />
                {unreadCount > 0 && (
                  <span className="absolute top-2 right-2 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-orange-600">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={toggleMenu}
                className="min-w-[44px] min-h-[44px] -mr-1.5 rounded-xl hover:bg-orange-700/60 active:scale-95 transition-all text-white flex items-center justify-center cursor-pointer"
                title="मेनू उघडा (Menu)"
                aria-label="मेनू उघडा"
              >
                <Menu className="w-6 h-6 stroke-[2.2]" />
              </button>
            </div>
          )}
        </div>

        {user && (
          <div className="flex justify-between items-center pt-1 border-t border-orange-500/50 text-xs gap-2">
            <span className="text-orange-100 font-medium truncate min-w-0 flex-1">
              {user.fullName}
            </span>
            <RoleBadge role={user.role} className="shrink-0" />
          </div>
        )}
      </header>

      {user && <HamburgerMenu />}
    </>
  );
};
