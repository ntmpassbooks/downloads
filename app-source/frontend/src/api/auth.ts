import { apiRequest, ApiResponse } from './client.js';
import { User, Organization } from '../context/AuthContext.js';

export interface ChangePinPayload {
  currentPin: string;
  newPin: string;
}

export interface ChangePinResponse {
  token: string;
  message: string;
}

export interface SelfProfileResponse {
  user: User;
  organization: Organization;
}

export async function changePin(payload: ChangePinPayload): Promise<ApiResponse<ChangePinResponse>> {
  return apiRequest('/auth/pin', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getSelfProfile(): Promise<ApiResponse<SelfProfileResponse>> {
  return apiRequest('/auth/me');
}

export interface RegistrationStatusResponse {
  registrationOpen: boolean;
  reason?: string;
}

export async function getRegistrationStatus(params?: {
  mandalName?: string;
  phone?: string;
}): Promise<ApiResponse<RegistrationStatusResponse>> {
  const query = new URLSearchParams();
  if (params?.mandalName) query.append('mandalName', params.mandalName);
  if (params?.phone) query.append('phone', params.phone);
  const qStr = query.toString();
  return apiRequest(`/auth/registration-status${qStr ? `?${qStr}` : ''}`);
}

export interface RegisterPresidentPayload {
  mandalName: string;
  fullName: string;
  phone: string;
  pin: string;
  confirmPin: string;
  registrationNumber?: string;
}

export interface RegisterPresidentResponse {
  token: string;
  expiresAt: string;
  user: User;
  organization: Organization;
  message: string;
}

export async function registerPresident(
  payload: RegisterPresidentPayload
): Promise<ApiResponse<RegisterPresidentResponse>> {
  return apiRequest('/auth/register-president', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface MyPinResponse {
  isRecoverable: boolean;
  pin?: string;
  message?: string;
}

export async function getMyPin(): Promise<ApiResponse<MyPinResponse>> {
  return apiRequest('/auth/my-pin');
}

