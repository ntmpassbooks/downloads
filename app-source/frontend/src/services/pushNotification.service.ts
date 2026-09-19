export type PushPlatform = 'ANDROID' | 'IOS' | 'WEB';

export interface PushRegistrationResult {
  supported: boolean;
  registered: boolean;
  platform: PushPlatform;
  token?: string;
  status: 'ACTIVE' | 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'PENDING_PHYSICAL_DEVICE';
  reason?: string;
}

export class PushNotificationService {
  /**
   * Detects current runtime platform.
   */
  public static getPlatform(): PushPlatform {
    if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform()) {
      const capPlatform = (window as any).Capacitor?.getPlatform();
      if (capPlatform === 'android') return 'ANDROID';
      if (capPlatform === 'ios') return 'IOS';
    }
    return 'WEB';
  }

  /**
   * Initializes push notification capabilities safely.
   *
   * Real production push delivery:
   * - Android requires physical device with Google Play Services and registered FCM token.
   * - iOS requires macOS Xcode build with Apple Developer Provisioning Profile & APNs Key.
   *
   * This method provides a clean foundation without fake success or hardcoded secrets.
   */
  public static async registerDevice(
    _onToken?: (token: string, platform: PushPlatform) => Promise<void>
  ): Promise<PushRegistrationResult> {
    const platform = this.getPlatform();

    // 1. Web / PWA Push Detection
    if (platform === 'WEB') {
      if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
        return {
          supported: false,
          registered: false,
          platform: 'WEB',
          status: 'UNSUPPORTED',
          reason: 'Web Push Notifications are not supported in this browser environment',
        };
      }

      // Check current browser permission
      if (Notification.permission === 'denied') {
        return {
          supported: true,
          registered: false,
          platform: 'WEB',
          status: 'PERMISSION_DENIED',
          reason: 'Notification permission was denied by the user',
        };
      }

      // Web foundation is ready; full FCM web registration requires VAPID key in production
      return {
        supported: true,
        registered: false,
        platform: 'WEB',
        status: 'PENDING_PHYSICAL_DEVICE',
        reason: 'Web push foundation ready; live FCM token requires production VAPID key',
      };
    }

    // 2. Native Capacitor (Android / iOS)
    // Physical device registration requires @capacitor/push-notifications plugin on real hardware
    return {
      supported: true,
      registered: false,
      platform,
      status: 'PENDING_PHYSICAL_DEVICE',
      reason: `Native ${platform} push foundation in place; actual hardware token registration requires physical device with Google Play Services / APNs provisioning.`,
    };
  }

  /**
   * Safe permission request wrapper.
   */
  public static async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }

    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch {
      return 'denied';
    }
  }
}
