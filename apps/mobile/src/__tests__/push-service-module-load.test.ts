import type * as ReactNative from 'react-native';
import type * as PushService from '../notifications/push-service';

/*
 * Regression test for the Expo Go startup crash: requiring 'expo-notifications' itself
 * can throw synchronously (Expo Go reports "Cannot find native module
 * 'ExpoTopicSubscriptionModule'" for some of its native modules). push-service.ts sits on
 * the import path from app/_layout.tsx to every screen, so if that throw happened while
 * push-service.ts's own top-level code ran, requiring push-service.ts - and everything
 * that imports it - would fail too, which is exactly what broke the whole app.
 *
 * This uses jest.doMock + jest.resetModules, isolated to this file, to simulate the
 * native module being entirely unavailable, and loads a fresh instance of push-service.ts
 * under that condition.
 */
describe('push-service module loading (Expo Go / missing native module)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('expo-notifications', () => {
      throw new Error("Cannot find native module 'ExpoTopicSubscriptionModule'");
    });
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { version: '0.1.0' } },
    }));
  });

  function loadPushService(): typeof PushService {
    return jest.requireActual<typeof PushService>('../notifications/push-service');
  }

  it('does not throw while loading, even though requiring expo-notifications does', () => {
    expect(loadPushService).not.toThrow();
  });

  it('lets the bridge that app/_layout.tsx imports load with it', () => {
    expect(() => {
      jest.requireActual('../notifications/notification-bridge');
    }).not.toThrow();
  });

  it('turns the native crash into PushUnavailableError instead of letting it escape', async () => {
    const pushService = loadPushService();

    await expect(pushService.getPermission()).rejects.toBeInstanceOf(
      pushService.PushUnavailableError,
    );
    await expect(pushService.requestPermission()).rejects.toBeInstanceOf(
      pushService.PushUnavailableError,
    );
    await expect(pushService.getDeviceToken()).rejects.toBeInstanceOf(
      pushService.PushUnavailableError,
    );
  });

  it('returns safe no-op functions from the synchronous listener/handler APIs', () => {
    const pushService = loadPushService();

    expect(() => pushService.showForegroundNotifications()()).not.toThrow();
    expect(() => pushService.addTokenListener(() => undefined)()).not.toThrow();
    expect(() => pushService.addTapListener(() => undefined)()).not.toThrow();
    expect(pushService.takeLaunchTap()).toBeNull();
  });

  it('keeps reporting unavailable on every call, not only the first', async () => {
    const pushService = loadPushService();

    await expect(pushService.getPermission()).rejects.toBeInstanceOf(
      pushService.PushUnavailableError,
    );
    await expect(pushService.getPermission()).rejects.toBeInstanceOf(
      pushService.PushUnavailableError,
    );
  });
});

/**
 * Loads a fresh push-service as a build running (or not running) in Expo Go on `platform`.
 * The module registry is reset first, so the platform replacement applies to the same
 * react-native instance the freshly loaded push-service imports.
 */
function loadInExpoState(options: { expoGo: boolean; platform: 'android' | 'ios' }): {
  pushService: typeof PushService;
  restorePlatform: { restore: () => void };
} {
  jest.resetModules();
  jest.doMock('expo', () => ({ isRunningInExpoGo: () => options.expoGo }));
  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: { version: '0.1.0' } },
  }));

  const { Platform: FreshPlatform } = jest.requireActual<typeof ReactNative>('react-native');
  const restorePlatform = jest.replaceProperty(FreshPlatform, 'OS', options.platform);
  const pushService = jest.requireActual<typeof PushService>('../notifications/push-service');
  return { pushService, restorePlatform };
}

describe('push-service in Expo Go on Android', () => {
  it('never requires expo-notifications there, and reports push as unavailable', async () => {
    const notificationsFactory = jest.fn(() => ({}));
    jest.doMock('expo-notifications', notificationsFactory);
    const { pushService, restorePlatform } = loadInExpoState({ expoGo: true, platform: 'android' });

    try {
      await expect(pushService.getPermission()).rejects.toBeInstanceOf(
        pushService.PushUnavailableError,
      );
      await expect(pushService.getDeviceToken()).rejects.toBeInstanceOf(
        pushService.PushUnavailableError,
      );
      expect(() => pushService.showForegroundNotifications()()).not.toThrow();
      expect(pushService.takeLaunchTap()).toBeNull();
      expect(notificationsFactory).not.toHaveBeenCalled();
    } finally {
      restorePlatform.restore();
    }
  });
});

describe('push-service outside Expo Go', () => {
  it('loads expo-notifications on first use, so a development build keeps working', () => {
    const setNotificationHandler = jest.fn();
    const notificationsFactory = jest.fn(() => ({ setNotificationHandler }));
    jest.doMock('expo-notifications', notificationsFactory);
    const { pushService, restorePlatform } = loadInExpoState({
      expoGo: false,
      platform: 'android',
    });

    try {
      pushService.showForegroundNotifications();

      expect(notificationsFactory).toHaveBeenCalledTimes(1);
      expect(setNotificationHandler).toHaveBeenCalledTimes(1);
    } finally {
      restorePlatform.restore();
    }
  });

  it('still loads it in Expo Go on iOS, where the missing native module does not exist', () => {
    const notificationsFactory = jest.fn(() => ({ setNotificationHandler: jest.fn() }));
    jest.doMock('expo-notifications', notificationsFactory);
    const { pushService, restorePlatform } = loadInExpoState({ expoGo: true, platform: 'ios' });

    try {
      pushService.showForegroundNotifications();

      expect(notificationsFactory).toHaveBeenCalledTimes(1);
    } finally {
      restorePlatform.restore();
    }
  });
});
