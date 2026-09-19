export const ROLES = {
  PRESIDENT: 'PRESIDENT',
  TREASURER: 'TREASURER',
  MEMBER: 'MEMBER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_DISPLAY_NAMES_MR: Record<Role, string> = {
  PRESIDENT: 'अध्यक्ष',
  TREASURER: 'खजिनदार',
  MEMBER: 'सदस्य',
};

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  PRESIDENT: [
    'organization:read',
    'organization:update',
    'member:read',
    'member:create',
    'member:update',
    'ledger:read',
    'ledger:create',
    'ledger:approve',
    'audit:read',
  ],
  TREASURER: [
    'organization:read',
    'member:read',
    'ledger:read',
    'ledger:create',
    'payment:record',
    'expense:record',
  ],
  MEMBER: [
    'organization:read',
    'self:read',
    'passbook:read',
    'payment:initiate',
  ],
};

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  phone: string;
  fullName: string;
  role: Role;
  isActive: boolean;
}
