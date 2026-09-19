export type NotificationType =
  | 'BISHI_DUE'
  | 'BISHI_DUE_TODAY'
  | 'BISHI_OVERDUE'
  | 'BISHI_PAID'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_VERIFIED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_EXPIRED'
  | 'LOAN_DISBURSED'
  | 'LOAN_REPAYMENT'
  | 'LOAN_REMINDER'
  | 'FINANCIAL_EVENT'
  | 'SECURITY_EVENT';

export type EntityType = 'BISHI' | 'PAYMENT' | 'PAYMENT_ORDER' | 'LOAN' | 'EXPENSE' | 'VARGANI' | 'SECURITY' | 'SYSTEM';

export type PushPlatform = 'ANDROID' | 'IOS' | 'WEB';

export interface NotificationRecord {
  id: string;
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: EntityType | null;
  entityId?: string | null;
  isRead: boolean;
  readAt?: string | null;
  idempotencyKey?: string | null;
  dataJson?: string | null;
  createdAt: string;
}

export interface CreateNotificationParams {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: EntityType;
  entityId?: string;
  idempotencyKey?: string;
  data?: Record<string, any>;
}

export interface DeviceTokenRecord {
  id: string;
  organizationId: string;
  userId: string;
  deviceToken: string;
  platform: PushPlatform;
  deviceName?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushDeliveryResult {
  successful: number;
  failed: number;
  invalidTokens: string[];
}
