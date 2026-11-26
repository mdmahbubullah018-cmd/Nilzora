import { deviceTokenSchema, type DevicePlatform } from '@nilzora/contracts';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import type * as NotificationsNS from 'expo-notifications';
import { Platform } from 'react-native';

/*
 * The only module that talks to expo-notifications for registration. It turns the
 * library's open-ended results into small, checked values, and every failure of the
 * native side (no Firebase in this build, Expo Go, a missing module) into one error type,
 * so the screens never see - and never log - raw native errors or tokens.
 */

declare const require: (id: string) => unknown;

type NotificationsModule = typeof NotificationsNS;

/** Shown wherever notifications cannot work in this build. */
export const UNAVAILABLE_MESSAGE = 'Notifications are not available in this build.';

/** Notifications cannot be used here: Expo Go, a build without Firebase, or an unsupported platform. */
export class PushUnavailableError extends Error {
  override readonly name = 'PushUnavailableError';

  constructor() {
    super(UNAVAILABLE_MESSAGE);
  }
}

let cachedModule: NotificationsModule | null | undefined;

/**
 * expo-notifications cannot be loaded in Expo Go on Android. Its entry point re-exports
 * topicSubscription, whose Android module calls
 * requireNativeModule('ExpoTopicSubscriptionModule') while the package is being evaluated,
 * and Expo Go does not ship that native module - so requiring the package throws, whichever
 * function would be used later. This file sits on the import path from app/_layout.tsx to
 * every screen (through notification-bridge.tsx): a load at import time crashed the whole app
 * before it rendered. Remote push needs a development build on Android anyway, so the package
 * is not loaded there at all.
 *
 * isRunningInExpoGo() is the exact test for Expo Go. expo-constants' StoreClient environment
 * is not: it also covers development builds made with expo-dev-client, which must keep working.
 * Everywhere else the package is loaded on first use, inside a try/catch that turns any native
 * failure into PushUnavailableError, which every function below already handles.
 */
function cannotLoadNativeModule(): boolean {
  return Platform.OS === 'android' && isRunningInExpoGo();
}

function notificationsModule(): NotificationsModule {
  if (cachedModule === undefined) {
    if (cannotLoadNativeModule()) {
      cachedModule = null;
    } else {
      try {
        cachedModule = require('expo-notifications') as NotificationsModule;
      } catch {
        cachedModule = null;
      }
    }
  }
  if (cachedModule === null) throw new PushUnavailableError();
  return cachedModule;
}

/** Android notification channel used for order updates. */
export const ANDROID_CHANNEL_ID = 'default';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface Permission {
  state: PermissionState;
  /** False once the system will no longer show the permission prompt. */
  canAskAgain: boolean;
}

/** The platform name the API stores, or null where this app has no push support (web). */
export function pushPlatform(): DevicePlatform | null {
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'ios') return 'ios';
  return null;
}

/** The app's version for the device record, when known. */
export function appVersion(): string | undefined {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && version.trim() !== ''
    ? version.trim().slice(0, 32)
    : undefined;
}

function toPermission(response: unknown): Permission {
  if (typeof response !== 'object' || response === null) throw new PushUnavailableError();
  const { granted, status, canAskAgain } = response as Record<string, unknown>;
  let state: PermissionState;
  if (granted === true) state = 'granted';
  else if (status === 'denied') state = 'denied';
  else if (status === 'undetermined') state = 'undetermined';
  else throw new PushUnavailableError();
  return { state, canAskAgain: canAskAgain !== false };
}

/** The current notification permission, without asking. */
export async function getPermission(): Promise<Permission> {
  if (pushPlatform() === null) throw new PushUnavailableError();
  try {
    return toPermission(await notificationsModule().getPermissionsAsync());
  } catch {
    throw new PushUnavailableError();
  }
}

/** Android 8+ needs a channel before any notification can be shown (and before the Android 13 prompt). */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const notifications = notificationsModule();
    await notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Order updates',
      importance: notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // A missing channel must not stop the permission request; the system falls back to its own.
  }
}

/**
 * Asks the system for notification permission (on Android 13+ this shows the system
 * prompt). Call it only from a deliberate customer action, never at start-up.
 */
export async function requestPermission(): Promise<Permission> {
  if (pushPlatform() === null) throw new PushUnavailableError();
  await ensureChannel();
  try {
    return toPermission(await notificationsModule().requestPermissionsAsync());
  } catch {
    throw new PushUnavailableError();
  }
}

/** Reads a valid device token out of whatever the native side produced. */
function readToken(value: unknown): string | null {
  const parsed = deviceTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * This device's native push token (FCM on Android, APNs on iOS). Needs Firebase to be
 * configured in the build: it fails in Expo Go and in builds without google-services,
 * which is reported as PushUnavailableError.
 */
export async function getDeviceToken(): Promise<string> {
  if (pushPlatform() === null) throw new PushUnavailableError();
  let token: string | null;
  try {
    const result = await notificationsModule().getDevicePushTokenAsync();
    token = readToken(result.data);
  } catch {
    throw new PushUnavailableError();
  }
  if (token === null) throw new PushUnavailableError();
  return token;
}

/**
 * Calls `listener` with the new token when the platform rotates it. Returns the function
 * that stops listening; where listening is impossible it does nothing.
 */
export function addTokenListener(listener: (token: string) => void): () => void {
  try {
    const subscription = notificationsModule().addPushTokenListener((event) => {
      const token = readToken(event.data);
      if (token !== null) listener(token);
    });
    return () => {
      subscription.remove();
    };
  } catch {
    return () => undefined;
  }
}

/**
 * Shows notifications that arrive while the app is open (a banner and an entry in the
 * tray, no sound or badge). Returns the function that removes the handler.
 */
export function showForegroundNotifications(): () => void {
  try {
    notificationsModule().setNotificationHandler({
      handleNotification: () =>
        Promise.resolve({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
    });
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      notificationsModule().setNotificationHandler(null);
    } catch {
      // Nothing to undo.
    }
  };
}

/** The custom data the sender attached to a tapped notification. Untrusted: check it before use. */
function dataOf(response: NotificationsNS.NotificationResponse | null): unknown {
  return response?.notification.request.content.data;
}

/**
 * Calls `listener` with the data of each notification the customer taps while the app is
 * running or in the background. Returns the function that stops listening.
 */
export function addTapListener(listener: (data: unknown) => void): () => void {
  try {
    const subscription = notificationsModule().addNotificationResponseReceivedListener(
      (response) => {
        listener(dataOf(response));
      },
    );
    return () => {
      subscription.remove();
    };
  } catch {
    return () => undefined;
  }
}

/**
 * The data of the notification whose tap started the app, if any, handed out once (the
 * library keeps it until it is cleared, which would reopen the screen on every launch).
 */
export function takeLaunchTap(): { data: unknown } | null {
  try {
    const notifications = notificationsModule();
    const response = notifications.getLastNotificationResponse();
    if (response === null || response === undefined) return null;
    notifications.clearLastNotificationResponse();
    return { data: dataOf(response) };
  } catch {
    return null;
  }
}
