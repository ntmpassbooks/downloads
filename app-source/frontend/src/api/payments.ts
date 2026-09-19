import { apiRequest, ApiResponse } from './client.js';

export type SupportedBank = 'SBI' | 'ICICI' | 'AXIS' | 'AU' | 'KOTAK';

export interface BankOption {
  code: SupportedBank;
  name: string;
  marathiName: string;
  vpaSuffix: string;
}

export const SUPPORTED_BANKS: BankOption[] = [
  { code: 'SBI', name: 'State Bank of India', marathiName: 'भारतीय स्टेट बँक (SBI)', vpaSuffix: '@sbi' },
  { code: 'ICICI', name: 'ICICI Bank', marathiName: 'आयसीआयसीआय बँक (ICICI Bank)', vpaSuffix: '@icici' },
  { code: 'AXIS', name: 'Axis Bank', marathiName: 'ॲक्सिस बँक (Axis Bank)', vpaSuffix: '@axisbank' },
  { code: 'AU', name: 'AU Small Finance Bank', marathiName: 'एयू स्मॉल फायनान्स बँक (AU Bank)', vpaSuffix: '@aubank' },
  { code: 'KOTAK', name: 'Kotak Mahindra Bank', marathiName: 'कोटक महिंद्रा बँक (Kotak Bank)', vpaSuffix: '@kotak' },
];

export type PaymentConfigStatus = 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'FAILED' | 'DISABLED';
export type AccountType = 'CURRENT' | 'SAVINGS';

export interface PaymentConfig {
  id: string;
  organizationId: string;
  bank: SupportedBank;
  provider: SupportedBank;
  accountName: string;
  accountType?: AccountType | null;
  accountNumber?: string | null;
  maskedAccountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  upiId?: string | null;
  merchantId?: string | null;
  hasCredentials: boolean;
  status: PaymentConfigStatus;
  isActive: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentOrder {
  id: string;
  organizationId: string;
  memberId: string;
  bishiRecordId: string;
  amount: number;
  currency: string;
  bank: SupportedBank;
  provider: SupportedBank;
  providerOrderId: string;
  providerPaymentId?: string | null;
  status: 'CREATED' | 'PENDING' | 'SUCCESS' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  idempotencyKey: string;
  financialTransactionId?: string | null;
  expiresAt: string;
  completedAt?: string | null;
  createdAt: string;
}

export interface CreateOrderResponse {
  order: PaymentOrder;
  providerKeyId: string;
  bishiMonth: string;
  memberName: string;
  accountName: string;
  bank: SupportedBank;
  upiIntentUrl?: string;
}

export interface OrderStatusResponse {
  orderId: string;
  status: 'CREATED' | 'PENDING' | 'SUCCESS' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  amount: number;
  currency: string;
  providerPaymentId?: string | null;
  financialTransactionId?: string | null;
  expiresAt: string;
  completedAt?: string | null;
}

export interface UpsertPaymentConfigPayload {
  bank: SupportedBank;
  accountType: AccountType;
  accountName: string;
  accountNumber?: string;
  ifsc?: string;
  branch?: string;
  upiId?: string;
  merchantId?: string;
  apiSecret?: string;
  notes?: string;
}

// 1. Get payment configuration (President & Treasurer)
export async function getPaymentConfig(): Promise<ApiResponse<PaymentConfig | null>> {
  return apiRequest<PaymentConfig | null>('/api/payments/config');
}

// 2. Set/Update payment configuration (President)
export async function upsertPaymentConfig(
  data: UpsertPaymentConfigPayload
): Promise<ApiResponse<PaymentConfig>> {
  return apiRequest<PaymentConfig>('/api/payments/config', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// 3. Update payment configuration status (President)
export async function updatePaymentConfigStatus(
  status: 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'DISABLED'
): Promise<ApiResponse<PaymentConfig>> {
  return apiRequest<PaymentConfig>('/api/payments/config/status', {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// 4. Create payment order for a pending Bishi record (Member)
export async function createPaymentOrder(
  bishiRecordId: string
): Promise<ApiResponse<CreateOrderResponse>> {
  return apiRequest<CreateOrderResponse>('/api/payments/orders', {
    method: 'POST',
    body: JSON.stringify({ bishiRecordId }),
  });
}

// 5. Poll order status (Member, President, Treasurer)
export async function getOrderStatus(
  orderId: string
): Promise<ApiResponse<OrderStatusResponse>> {
  return apiRequest<OrderStatusResponse>(`/api/payments/orders/${orderId}/status`);
}

// 6. Verify payment server-side (Member)
export async function verifyPayment(data: {
  orderId: string;
  providerPaymentId: string;
  providerSignature: string;
}): Promise<ApiResponse<{
  success: boolean;
  message: string;
  orderId: string;
  status: string;
  financialTransactionId?: string;
  bishiRecordId?: string;
}>> {
  return apiRequest('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// 7. Get payment orders list (President & Treasurer all Mandal orders, Member own orders)
export async function getPaymentOrders(): Promise<ApiResponse<PaymentOrder[]>> {
  return apiRequest<PaymentOrder[]>('/api/payments/orders');
}

