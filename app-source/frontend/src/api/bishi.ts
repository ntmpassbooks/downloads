import { apiRequest, ApiResponse } from './client.js';

export interface BishiConfig {
  id: string;
  organizationId: string;
  memberId: string;
  monthlyAmount: number;
  dueDay: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BishiRecord {
  id: string;
  organizationId: string;
  memberId: string;
  bishiConfigId: string;
  monthYear: string;
  expectedAmount: number;
  dueDate: string;
  status: 'PENDING' | 'PAID' | 'OVERDUE';
  paidAmount: number;
  paidDate: string | null;
  paymentMethod: string | null;
  paymentTransactionId?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BishiCycleSummary {
  monthYear: string;
  generatedCount: number;
  skippedCount: number;
}

export interface BishiOverviewSummary {
  totalMembers: number;
  totalConfigured: number;
  totalUnconfigured: number;
  totalExpectedAmount: number;
  totalRecordsGenerated: number;
  totalPaidAmount?: number;
  totalPendingAmount?: number;
  totalCashAmount?: number;
  totalOnlineAmount?: number;
  totalCashCount?: number;
  totalOnlineCount?: number;
}

export interface BishiOverviewMember {
  memberId: string;
  fullName: string;
  phone: string;
  role: 'PRESIDENT' | 'TREASURER' | 'MEMBER';
  isActive: boolean;
  config: {
    id: string;
    monthlyAmount: number;
    dueDay: number;
  } | null;
  record: {
    id: string;
    expectedAmount: number;
    dueDate: string;
    status: 'PENDING' | 'PAID' | 'OVERDUE';
    paidAmount: number;
    paidDate?: string | null;
    paymentMethod?: 'CASH' | 'ONLINE_UPI' | string | null;
    paymentTransactionId?: string | null;
    transactionNumber?: string | null;
  } | null;
}

export interface BishiOverviewResponse {
  monthYear: string;
  summary: BishiOverviewSummary;
  members: BishiOverviewMember[];
}

/**
 * Get a member's Bishi configuration.
 * Returns data: null if not yet configured (ZERO default amount).
 */
export async function getMemberBishiConfig(memberId: string): Promise<ApiResponse<BishiConfig | null>> {
  return apiRequest(`/members/${memberId}/bishi-config`);
}

/**
 * Set or update a member's Bishi configuration (President Only).
 */
export async function setMemberBishiConfig(
  memberId: string,
  monthlyAmount: number,
  dueDay: number
): Promise<ApiResponse<BishiConfig>> {
  return apiRequest(`/members/${memberId}/bishi-config`, {
    method: 'POST',
    body: JSON.stringify({ monthlyAmount, dueDay }),
  });
}

/**
 * Get monthly Bishi records for a member.
 */
export async function getMemberBishiRecords(memberId: string): Promise<ApiResponse<BishiRecord[]>> {
  return apiRequest(`/members/${memberId}/bishi-records`);
}

/**
 * Trigger monthly cycle generation for all active configured members (President Only).
 */
export async function generateBishiCycle(monthYear?: string): Promise<ApiResponse<BishiCycleSummary>> {
  return apiRequest('/bishi/generate-cycle', {
    method: 'POST',
    body: JSON.stringify(monthYear ? { monthYear } : {}),
  });
}

/**
 * Get mandal-wide Bishi overview for a specific cycle (President & Treasurer).
 */
export async function getBishiOverview(monthYear?: string): Promise<ApiResponse<BishiOverviewResponse>> {
  const query = monthYear ? `?monthYear=${encodeURIComponent(monthYear)}` : '';
  return apiRequest(`/bishi/overview${query}`);
}

/**
 * Safely delete an unpaid/unreferenced Bishi record (President & Treasurer).
 */
export async function deleteBishiRecord(
  recordId: string
): Promise<ApiResponse<{ id: string; monthYear: string; message: string }>> {
  return apiRequest(`/bishi/records/${recordId}`, {
    method: 'DELETE',
  });
}
