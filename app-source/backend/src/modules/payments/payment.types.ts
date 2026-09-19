import { SupportedBank } from './bank.adapters.js';

export type PaymentProviderType = SupportedBank;
export type AccountType = 'CURRENT' | 'SAVINGS';
export type PaymentConfigStatus = 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'FAILED' | 'DISABLED';
export type PaymentOrderStatus = 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

export interface PaymentConfig {
  id: string;
  organizationId: string;
  bank: SupportedBank;
  provider: SupportedBank;
  accountName: string;
  accountType: AccountType | null;
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
  providerPaymentId: string | null;
  status: PaymentOrderStatus;
  idempotencyKey: string;
  financialTransactionId: string | null;
  expiresAt: string;
  completedAt: string | null;
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
