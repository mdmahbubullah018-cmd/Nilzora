import { Writable } from 'node:stream';
import type { Express, Router } from 'express';
import type { Logger } from 'pino';
import { createApp, type CommerceStores } from '../app';
import { loadConfig, type AppConfig, type LogLevel } from '../config/env';
import { createLogger } from '../logging/logger';
import type { AuthDependencies } from '../middleware/authenticate';
import type { DiscoveryStore } from '../modules/catalog/discovery';
import type { AdminStores } from '../modules/admin/routes';
import type { AfterSalesStore } from '../modules/after-sales/store';
import type { InboxStore } from '../modules/inbox/store';
import type { CustomerNotificationStore } from '../modules/inbox/customer-store';
import type { NotificationPreferenceStore } from '../modules/inbox/preference-store';
import type { InsightStore } from '../modules/insights/store';
import type { OnboardingStore } from '../modules/onboarding/store';
import type { PopupStore } from '../modules/popups/store';
import type { SiteStore } from '../modules/site/store';
import type { SavedCartStore } from '../modules/carts/store';
import type { DeviceStore } from '../modules/devices/store';
import type { MediaStorage } from '../modules/media/routes';
import type { ReviewStore } from '../modules/reviews/store';
import type { ChatStore } from '../modules/chat/store';
import type { ChatAdminStore } from '../modules/chat/admin-store';
import type { ChatNotifier } from '../realtime/notifier';
import type { ChatAssistant } from '../modules/chat/assistant-service';
import type { ChatTicketSigner } from '../realtime/ticket';
import type { AvatarSource } from '../modules/users/routes';
import type { ProductImageStore } from '../modules/media/store';
import type { ZoneStore } from '../modules/zones/store';
import type { MediaKeyReferences } from '../modules/media/references';
import type { CourierProcessor } from '../modules/couriers/processor';
import type { CourierService } from '../modules/couriers/service';
import { FakeAdmin } from './admin-fakes';
import { FakeCommerce } from './commerce-fakes';
import { FakeDevices } from './device-fakes';
import { FakeIdentity } from './fakes';

/** Placeholder Supabase settings for unit tests; nothing connects to them. */
export const TEST_SUPABASE_ENV = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key-not-real-0000',
  SUPABASE_SECRET_KEY: 'test-secret-key-not-real-000000000',
};

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ NODE_ENV: 'test', ...TEST_SUPABASE_ENV, ...env });
}

export interface CapturedLogs {
  logger: Logger;
  /** Every log line exactly as written. */
  raw: () => string;
  entries: () => Record<string, unknown>[];
}

/** A real pino logger (with redaction) writing JSON lines into memory. */
export function captureLogs(level: LogLevel = 'info'): CapturedLogs {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      callback();
    },
  });
  const logger = createLogger({ nodeEnv: 'test', logLevel: level }, destination);
  return {
    logger,
    raw: () => lines.join('\n'),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export function testApp(
  options: {
    env?: Record<string, string>;
    modules?: Router[];
    logger?: Logger;
    auth?: AuthDependencies;
    /** Defaults to empty in-memory commerce data that knows none of the auth fake's users. */
    commerce?: CommerceStores;
    /** Defaults to empty in-memory admin data that knows none of the auth fake's users. */
    admin?: AdminStores;
    /** Defaults to an empty in-memory device table that knows none of the auth fake's users. */
    devices?: DeviceStore;
    /** Product-image routes; omitted, they are not mounted. */
    media?: { images: ProductImageStore; storage: MediaStorage | undefined };
    /** Persisted carts and checkout tracking; omitted, those routes are not mounted. */
    carts?: SavedCartStore;
    /** Returns and refunds; omitted, those routes are not mounted. */
    afterSales?: AfterSalesStore;
    /** SEO, the store profile, the staff inbox and customer insight. */
    phase3?: { site: SiteStore; inbox: InboxStore; insights: InsightStore };
    /** The customer's own notification history; omitted, those routes are not mounted. */
    notifications?: CustomerNotificationStore;
    /** The account's notification choices; omitted, those routes are not mounted. */
    notificationPreferences?: NotificationPreferenceStore;
    /** Onboarding and promotional campaigns. */
    onboarding?: OnboardingStore;
    /** Promotional popups; omitted, those routes are not mounted. */
    popups?: PopupStore;
    /** Where /me reads the profile picture from. */
    avatars?: AvatarSource;
    /** Customer reviews (public read, own review, moderation). */
    reviews?: ReviewStore;
    /** Ranked search-page discovery; omitted, that route is not mounted. */
    discovery?: DiscoveryStore;
    /** Shopping zones (collections); omitted, those routes are not mounted. */
    zones?: ZoneStore;
    /** Whether a picture is still referenced before its files are deleted (zones). */
    mediaReferences?: MediaKeyReferences;
    /** Unified communication: the store, and optionally its socket tickets and broadcaster. */
    /** Staff invitations that grant nothing until accepted; omitted, not mounted. */
    staffInvitations?: NonNullable<Parameters<typeof createApp>[0]['staffInvitations']>;
    /** Couriers: staff routes, customer shipments and webhooks; omitted, not mounted. */
    couriers?: { service: CourierService; processor: CourierProcessor };
    chat?: {
      store: ChatStore;
      admin?: ChatAdminStore | undefined;
      tickets?: ChatTicketSigner | undefined;
      notify?: ChatNotifier | undefined;
      assistant?: ChatAssistant | undefined;
    };
    /** Visual search: the service, the store and the provider metadata; omitted, not mounted. */
    imageSearch?: NonNullable<Parameters<typeof createApp>[0]['imageSearch']>;
  } = {},
): Express {
  const config = testConfig(options.env);
  return createApp({
    config,
    logger: options.logger ?? createLogger(config),
    auth: options.auth ?? new FakeIdentity().deps,
    commerce: options.commerce ?? new FakeCommerce(new FakeIdentity()).stores,
    admin: options.admin ?? new FakeAdmin(new FakeIdentity()).stores,
    devices: options.devices ?? new FakeDevices(new FakeIdentity()).stores,
    ...(options.media ? { media: options.media } : {}),
    ...(options.carts ? { carts: options.carts } : {}),
    ...(options.afterSales ? { afterSales: options.afterSales } : {}),
    ...(options.phase3 ? options.phase3 : {}),
    ...(options.notifications ? { notifications: options.notifications } : {}),
    ...(options.notificationPreferences
      ? { notificationPreferences: options.notificationPreferences }
      : {}),
    ...(options.onboarding ? { onboarding: options.onboarding } : {}),
    ...(options.popups ? { popups: options.popups } : {}),
    ...(options.avatars ? { avatars: options.avatars } : {}),
    ...(options.reviews ? { reviews: options.reviews } : {}),
    ...(options.discovery ? { discovery: options.discovery } : {}),
    ...(options.zones ? { zones: options.zones } : {}),
    ...(options.mediaReferences ? { mediaReferences: options.mediaReferences } : {}),
    ...(options.chat ? { chat: options.chat } : {}),
    ...(options.couriers ? { couriers: options.couriers } : {}),
    ...(options.staffInvitations ? { staffInvitations: options.staffInvitations } : {}),
    ...(options.imageSearch ? { imageSearch: options.imageSearch } : {}),
    modules: options.modules ?? [],
  });
}
