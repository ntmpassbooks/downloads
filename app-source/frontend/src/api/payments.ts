import { apiRequest, ApiResponse } from './client.js';

export type PaymentOrderStatus =
  | 'ONLINE_PENDING'
  | 'ONLINE_CONFIRMED'
  | 'ONLINE_REJECTED'
  | 'CREATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PaymentConfig {
  id: string;
  organizationId: string;
  upiId?: string | null;
  hasQrCode: boolean;
  qrCodeData?: string | null;
  isActive: boolean;
  notes?: string | null;
  // Legacy backward compatibility
  bank?: string;
  provider?: string;
  accountName?: string;
  accountType?: string | null;
  accountNumber?: string | null;
  maskedAccountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  merchantId?: string | null;
  hasCredentials?: boolean;
  status?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentOrder {
  id: string;
  organizationId: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  bishiRecordId: string;
  bishiMonth?: string;
  amount: number;
  currency: string;
  status: PaymentOrderStatus;
  idempotencyKey: string;
  financialTransactionId?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string | null;
  // Legacy backward compatibility
  bank?: string;
  provider?: string;
  providerOrderId?: string;
  providerPaymentId?: string | null;
  expiresAt?: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateOrderResponse {
  order: PaymentOrder;
  upiId?: string | null;
  hasQrCode?: boolean;
  qrCodeData?: string | null;
  bishiMonth: string;
  memberName: string;
  accountName?: string;
  upiIntentUrl?: string;
  providerKeyId?: string;
  bank?: string;
}

export interface OrderStatusResponse {
  orderId: string;
  status: PaymentOrderStatus;
  amount: number;
  currency: string;
  rejectionReason?: string | null;
  financialTransactionId?: string | null;
  providerPaymentId?: string | null;
  expiresAt?: string;
  completedAt?: string | null;
}

export interface UpsertPaymentConfigPayload {
  upiId?: string;
  qrCodeData?: string | null;
  isActive?: boolean;
  notes?: string;
  // Legacy backward compatibility
  bank?: string;
  accountType?: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  branch?: string;
  merchantId?: string;
  apiSecret?: string;
}

// 1. Get payment configuration (President & Treasurer)
export async function getPaymentConfig(): Promise<ApiResponse<PaymentConfig | null>> {
  return apiRequest<PaymentConfig | null>('/api/payments/config');
}

// 2. Set/Update payment configuration (President only)
export async function upsertPaymentConfig(
  data: UpsertPaymentConfigPayload
): Promise<ApiResponse<PaymentConfig>> {
  return apiRequest<PaymentConfig>('/api/payments/config', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// 3. Update payment configuration status (President only)
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

// 6. Verify payment server-side (Legacy)
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

// 7. Get payment orders list
export async function getPaymentOrders(): Promise<ApiResponse<PaymentOrder[]>> {
  return apiRequest<PaymentOrder[]>('/api/payments/orders');
}

// 8. Get pending payment orders (President & Treasurer)
export async function getPendingPaymentOrders(): Promise<ApiResponse<PaymentOrder[]>> {
  return apiRequest<PaymentOrder[]>('/api/payments/orders/pending');
}

// 9. Approve online payment order (President & Treasurer)
export async function approvePaymentOrder(
  orderId: string
): Promise<ApiResponse<{
  success: boolean;
  message: string;
  order: PaymentOrder;
  financialTransactionId: string;
  receiptNumber: string;
}>> {
  return apiRequest(`/api/payments/orders/${orderId}/approve`, {
    method: 'POST',
  });
}

// 10. Reject online payment order (President & Treasurer)
export async function rejectPaymentOrder(
  orderId: string,
  reason: string
): Promise<ApiResponse<{
  success: boolean;
  message: string;
  order: PaymentOrder;
}>> {
  return apiRequest(`/api/payments/orders/${orderId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}


