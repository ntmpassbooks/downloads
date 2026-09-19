import React from 'react';
import { Role } from '../context/AuthContext.js';
import { Shield, Wallet, UserCheck } from 'lucide-react';

interface RoleBadgeProps {
  role: Role;
  className?: string;
}

export const RoleBadge: React.FC<RoleBadgeProps> = ({ role, className = '' }) => {
  switch (role) {
    case 'PRESIDENT':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300 ${className}`}
        >
          <Shield className="w-3.5 h-3.5 text-amber-700" />
          अध्यक्ष (President)
        </span>
      );
    case 'TREASURER':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300 ${className}`}
        >
          <Wallet className="w-3.5 h-3.5 text-emerald-700" />
          खजिनदार (Treasurer)
        </span>
      );
    case 'MEMBER':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-900 border border-blue-300 ${className}`}
        >
          <UserCheck className="w-3.5 h-3.5 text-blue-700" />
          सदस्य (Member)
        </span>
      );
  }
};
