import React from 'react';
import { Home, Users, UserCircle, FileSpreadsheet } from 'lucide-react';
import { Role } from '../context/AuthContext.js';

export type NavTab = 'dashboard' | 'members' | 'reports' | 'profile';

interface BottomNavProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  userRole?: Role;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onTabChange,
  userRole,
}) => {
  const isPresident = userRole === 'PRESIDENT';
  const canViewReports = userRole === 'PRESIDENT' || userRole === 'TREASURER';

  return (
    <nav className="bg-white border-t border-slate-200 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around shrink-0 select-none shadow-lg">
      {/* Home Tab */}
      <button
        onClick={() => onTabChange('dashboard')}
        className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all flex-1 py-1 cursor-pointer ${
          currentTab === 'dashboard'
            ? 'text-orange-600 font-bold'
            : 'text-slate-400 hover:text-slate-600 font-medium'
        }`}
        aria-label="मुख्य पृष्ठ"
      >
        <Home className={`w-5 h-5 ${currentTab === 'dashboard' ? 'stroke-[2.5]' : 'stroke-2'}`} />
        <span className="text-[10px]">मुख्य पृष्ठ</span>
      </button>

      {/* Member Management Tab (Visible for President) */}
      {isPresident && (
        <button
          onClick={() => onTabChange('members')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all flex-1 py-1 cursor-pointer ${
            currentTab === 'members'
              ? 'text-orange-600 font-bold'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
          aria-label="सदस्य"
        >
          <Users className={`w-5 h-5 ${currentTab === 'members' ? 'stroke-[2.5]' : 'stroke-2'}`} />
          <span className="text-[10px]">सदस्य</span>
        </button>
      )}

      {/* Reports Tab (Visible for President & Treasurer) */}
      {canViewReports && (
        <button
          onClick={() => onTabChange('reports')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all flex-1 py-1 cursor-pointer ${
            currentTab === 'reports'
              ? 'text-orange-600 font-bold'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
          aria-label="अहवाल"
        >
          <FileSpreadsheet className={`w-5 h-5 ${currentTab === 'reports' ? 'stroke-[2.5]' : 'stroke-2'}`} />
          <span className="text-[10px]">अहवाल</span>
        </button>
      )}

      {/* Profile Tab (Available for all roles) */}
      <button
        onClick={() => onTabChange('profile')}
        className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all flex-1 py-1 cursor-pointer ${
          currentTab === 'profile'
            ? 'text-orange-600 font-bold'
            : 'text-slate-400 hover:text-slate-600 font-medium'
        }`}
        aria-label="प्रोफाइल"
      >
        <UserCircle className={`w-5 h-5 ${currentTab === 'profile' ? 'stroke-[2.5]' : 'stroke-2'}`} />
        <span className="text-[10px]">प्रोफाइल</span>
      </button>
    </nav>
  );
};
