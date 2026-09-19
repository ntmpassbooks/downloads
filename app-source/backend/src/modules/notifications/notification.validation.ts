import { z } from 'zod';

export const registerDeviceTokenSchema = z.object({
  deviceToken: z.string().min(10, 'डिव्हाइस टोकन अवैध आहे (Invalid device token)'),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  deviceName: z.string().optional(),
});

export const unregisterDeviceTokenSchema = z.object({
  deviceToken: z.string().min(1, 'डिव्हाइस टोकन आवश्यक आहे'),
});

export const getNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  unreadOnly: z.coerce.boolean().optional(),
  type: z.string().optional(),
});

export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenSchema>;
export type UnregisterDeviceTokenInput = z.infer<typeof unregisterDeviceTokenSchema>;
export type GetNotificationsQueryInput = z.infer<typeof getNotificationsQuerySchema>;
