import { apiRequest, ApiResponse } from './client.js';

export interface Member {
  id: string;
  organizationId: string;
  phone: string;
  fullName: string;
  role: 'PRESIDENT' | 'TREASURER' | 'MEMBER';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberListResponse {
  data: Member[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateMemberPayload {
  phone: string;
  fullName: string;
  initialPin?: string;
  role?: 'MEMBER' | 'TREASURER';
}

export async function getMembers(
  page = 1,
  limit = 20,
  status = 'all',
  search = ''
): Promise<ApiResponse<Member[]>> {
  let url = `/members?page=${page}&limit=${limit}&status=${status}`;
  if (search && search.trim()) {
    url += `&search=${encodeURIComponent(search.trim())}`;
  }
  return apiRequest(url);
}

export async function createMember(payload: CreateMemberPayload): Promise<ApiResponse<Member>> {
  return apiRequest('/members', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMemberStatus(memberId: string, isActive: boolean): Promise<ApiResponse<Member>> {
  return apiRequest(`/members/${memberId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
}

export async function getMemberDetails(memberId: string): Promise<ApiResponse<Member>> {
  return apiRequest(`/members/${memberId}`);
}

export async function updateMemberRole(memberId: string, role: 'TREASURER' | 'MEMBER'): Promise<ApiResponse<Member>> {
  return apiRequest(`/members/${memberId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function deleteMember(memberId: string): Promise<ApiResponse<{ id: string; status: 'DELETED' | 'ARCHIVED'; message: string }>> {
  return apiRequest(`/members/${memberId}`, {
    method: 'DELETE',
  });
}

export interface MemberPinResponse {
  isRecoverable: boolean;
  pin?: string;
  fullName?: string;
  message?: string;
}

export async function getMemberPin(memberId: string): Promise<ApiResponse<MemberPinResponse>> {
  return apiRequest(`/members/${memberId}/pin`);
}



