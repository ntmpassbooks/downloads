import { SupportedBank } from './bank.adapters.js';

export type PaymentProviderType = SupportedBank;
export type AccountType = 'CURRENT' | 'SAVINGS';
export type PaymentConfigStatus = 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'FAILED' | 'DISABLED';
export type PaymentOrderStatus =
  | 'ONLINE_PENDING'
  | 'ONLINE_CONFIRMED'
  | 'ONLINE_REJECTED'
  | 'CREATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PaymentConfig {
  id: string;
  organizationId: string;
  upiId?: string | null;
  hasQrCode?: boolean;
  qrCodeData?: string | null;
  isActive: boolean;
  notes?: string | null;
  // Backward compatibility / optional properties
  bank?: SupportedBank;
  provider?: SupportedBank;
  accountName?: string;
  accountType?: AccountType | null;
  accountNumber?: string | null;
  maskedAccountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  merchantId?: string | null;
  hasCredentials?: boolean;
  status?: PaymentConfigStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentOrder {
  id: string;
  organizationId: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  paymentType?: 'BISHI' | 'LOAN_REPAYMENT';
  bishiRecordId?: string | null;
  loanId?: string | null;
  bishiMonth?: string;
  amount: number;
  currency: string;
  status: PaymentOrderStatus;
  idempotencyKey: string;
  financialTransactionId: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string | null;
  // Backward compatibility fields
  bank?: SupportedBank;
  provider?: SupportedBank;
  providerOrderId?: string;
  providerPaymentId?: string | null;
  expiresAt?: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderParams {
  amount: number; // in Rupees
  currency: string;
  receipt: string;
  merchantUpiId?: string;
  accountName?: string;
  notes?: Record<string, string>;
}

export interface ProviderOrderResult {
  providerOrderId: string;
  amount: number;
  currency: string;
  bank: SupportedBank;
  provider: SupportedBank;
  upiIntentUrl?: string;
}

export interface VerifyPaymentSignatureParams {
  orderId: string; // provider_order_id
  paymentId: string; // provider_payment_id
  signature: string;
}

export interface WebhookEventPayload {
  event: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  notes?: Record<string, string>;
  rawPayload: any;
}
