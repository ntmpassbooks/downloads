import { apiRequest, ApiResponse } from './client';

export type NotificationType =
  | 'BISHI_DUE'
  | 'BISHI_DUE_TODAY'
  | 'BISHI_OVERDUE'
  | 'BISHI_PAID'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_VERIFIED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'LOAN_DISBURSED'
  | 'LOAN_REPAYMENT'
  | 'LOAN_DUE_REMINDER'
  | 'FINANCIAL_EVENT'
  | 'SECURITY_EVENT'
  | 'ANNOUNCEMENT';

export type EntityType = 'BISHI' | 'PAYMENT_ORDER' | 'LOAN' | 'EXPENSE' | 'VARGANI' | 'SECURITY';

export interface NotificationRecord {
  id: string;
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: EntityType | null;
  entityId?: string | null;
  data?: Record<string, any> | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface GetNotificationsParams {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  type?: string;
}

export interface NotificationsListResponse {
  notifications: NotificationRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    unreadCount: number;
  };
}

export async function fetchNotifications(params: GetNotificationsParams = {}): Promise<ApiResponse<NotificationRecord[]>> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  if (params.unreadOnly !== undefined) search.set('unreadOnly', String(params.unreadOnly));
  if (params.type) search.set('type', params.type);

  const query = search.toString();
  const endpoint = query ? `/notifications?${query}` : '/notifications';
  return apiRequest<NotificationRecord[]>(endpoint);
}

export async function fetchUnreadCount(): Promise<ApiResponse<{ unreadCount: number }>> {
  return apiRequest<{ unreadCount: number }>('/notifications/unread-count');
}

export async function markNotificationAsRead(id: string): Promise<ApiResponse<NotificationRecord>> {
  return apiRequest<NotificationRecord>(`/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export async function markAllNotificationsAsRead(): Promise<ApiResponse<{ updatedCount: number }>> {
  return apiRequest<{ updatedCount: number }>('/notifications/mark-all-read', {
    method: 'POST',
  });
}

export async function registerDeviceToken(payload: {
  deviceToken: string;
  platform: 'ANDROID' | 'IOS' | 'WEB';
  deviceName?: string;
}): Promise<ApiResponse<any>> {
  return apiRequest('/notifications/device-token', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function unregisterDeviceToken(deviceToken: string): Promise<ApiResponse<any>> {
  return apiRequest('/notifications/device-token', {
    method: 'DELETE',
    body: JSON.stringify({ deviceToken }),
  });
}
