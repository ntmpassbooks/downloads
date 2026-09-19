import { Request, Response } from 'express';
import { NotificationService } from './notification.service.js';
import { PushService } from './push.service.js';
import { BishiSchedulerService } from './bishi_scheduler.service.js';
import {
  GetNotificationsQueryInput,
  RegisterDeviceTokenInput,
  UnregisterDeviceTokenInput,
} from './notification.validation.js';

export function getNotificationsHandler(req: Request, res: Response): void {
  const user = req.user!;
  const query = req.query as unknown as GetNotificationsQueryInput;
  const result = NotificationService.getNotifications(user.organizationId, user.id, query);
  res.status(200).json({
    success: true,
    data: result.notifications,
    pagination: {
      total: result.total,
      limit: query?.limit,
      offset: query?.offset,
      unreadCount: result.unreadCount,
    },
  });
}

export function getUnreadCountHandler(req: Request, res: Response): void {
  const user = req.user!;
  const unreadCount = NotificationService.getUnreadCount(user.organizationId, user.id);
  res.status(200).json({
    success: true,
    unreadCount,
  });
}

export function markAsReadHandler(req: Request<{ id: string }>, res: Response): void {
  const user = req.user!;
  const updated = NotificationService.markAsRead(user.organizationId, user.id, req.params.id);
  res.status(200).json({
    success: true,
    data: updated,
  });
}

export function markAllAsReadHandler(req: Request, res: Response): void {
  const user = req.user!;
  const result = NotificationService.markAllAsRead(user.organizationId, user.id);
  res.status(200).json({
    success: true,
    message: 'सर्व सूचना वाचल्या गेल्या आहेत (All notifications marked as read)',
    updatedCount: result.updatedCount,
  });
}

export function registerDeviceTokenHandler(
  req: Request<{}, {}, RegisterDeviceTokenInput>,
  res: Response
): void {
  const user = req.user!;
  const tokenRecord = PushService.registerDeviceToken(
    user.organizationId,
    user.id,
    req.body.deviceToken,
    req.body.platform,
    req.body.deviceName
  );
  res.status(200).json({
    success: true,
    message: 'डिव्हाइस टोकन नोंदवले गेले (Device token registered successfully)',
    data: tokenRecord,
  });
}

export function unregisterDeviceTokenHandler(
  req: Request<{}, {}, UnregisterDeviceTokenInput>,
  res: Response
): void {
  const user = req.user!;
  PushService.unregisterDeviceToken(user.id, req.body.deviceToken);
  res.status(200).json({
    success: true,
    message: 'डिव्हाइस टोकन काढण्यात आले (Device token removed)',
  });
}

export async function runSchedulerHandler(_req: Request, res: Response): Promise<void> {
  const result = await BishiSchedulerService.runReminderCycle();
  res.status(200).json({
    success: true,
    message: 'बिशी स्मरण चक्र यशस्वीरित्या पूर्ण झाले (Bishi reminder cycle completed)',
    data: result,
  });
}
