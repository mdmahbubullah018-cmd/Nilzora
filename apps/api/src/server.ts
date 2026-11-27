import { createApp } from './app';
import { createProcessRedis } from './cache';
import { createServer } from 'node:http';
import { attachRealtime, type Realtime } from './realtime/server';
import type { ChatNotifier } from './realtime/notifier';
import { createChatTicketSigner } from './realtime/ticket';
import { createPostgresChatStore, createSupabaseChatStore } from './modules/chat/store';
import {
  createPostgresChatAdminStore,
  createSupabaseChatAdminStore,
} from './modules/chat/admin-store';
import { firstPartySettings, googleAudiences, googleSettings, twoFactorKey } from './auth/config';
import { createSecretBox } from './auth/secret-box';
import { createTwoFactorService } from './auth/two-factor';
import { createPostgresDomainEventStore } from './modules/events/store';
import { createDomainEventWorker } from './modules/events/worker';
import { createAuthService } from './auth/first-party';
import { createGoogleAdapter } from './auth/google';
import { createGoogleIdTokenVerifier } from './auth/google-id-token';
import { createGoogleIdentitySignIn, createGoogleOAuth } from './auth/oauth';
import { createEmailSender, emailDiagnosticOf, EmailUnavailableError } from './auth/sender';
import { createPostgresStaffInvitationStore } from './modules/admin/staff-invitations';
import { ConfigError, loadConfig, type AppConfig } from './config/env';
import { createDatabasePool } from './db/pool';
import {
  createPostgresAvatarDirectory,
  NO_AVATAR_DIRECTORY,
} from './modules/users/avatar-directory';
import { createLogger } from './logging/logger';
import {
  createPostgresAdminAccountStore,
  createSupabaseAdminAccountStore,
} from './modules/admin/accounts-store';
import {
  createPostgresAdminCatalogStore,
  createSupabaseAdminCatalogStore,
} from './modules/admin/catalog-store';
import {
  createPostgresModerationStore,
  createSupabaseModerationStore,
} from './modules/admin/moderation-store';
import {
  createPostgresAdminOrderStore,
  createSupabaseAdminOrderStore,
} from './modules/admin/orders-store';
import {
  createPostgresAdminReportStore,
  createSupabaseAdminReportStore,
} from './modules/admin/reports-store';
import {
  createPostgresAdminCouponStore,
  createSupabaseAdminCouponStore,
} from './modules/admin/coupons-store';
import {
  createPostgresAdminDiscountStore,
  createSupabaseAdminDiscountStore,
} from './modules/admin/discounts-store';
import {
  createPostgresMediaLibraryStore,
  createSupabaseMediaLibraryStore,
} from './modules/admin/media-library-store';
import {
  createPostgresExportJobStore,
  createPostgresExportWorkerBackend,
  createPostgresReportStore,
  createSupabaseReportStore,
} from './modules/exports/store';
import { startExportWorker } from './modules/exports/worker';
import {
  createPostgresSiteContentStore,
  createSupabaseSiteContentStore,
} from './modules/site/content-store';
import {
  createAutomationWorker,
  createPostgresAutomationJobRunner,
} from './modules/chat/automation-worker';
import { createPostgresChatAssistant } from './modules/chat/assistant-service';
import { createPostgresReviewStore, createSupabaseReviewStore } from './modules/reviews/store';
import { attachmentsRouter } from './modules/attachments/routes';
import {
  createPostgresAttachmentStore,
  createSupabaseAttachmentStore,
} from './modules/attachments/store';
import {
  createPostgresAfterSalesStore,
  createSupabaseAfterSalesStore,
} from './modules/after-sales/store';
import { createPostgresSavedCartStore, createSupabaseSavedCartStore } from './modules/carts/store';
import { createPostgresWishlistStore, createSupabaseWishlistStore } from './modules/wishlist/store';
import { createPostgresVoucherStore, createSupabaseVoucherStore } from './modules/vouchers/routes';
import {
  createPostgresBroadcastStore,
  createSupabaseBroadcastStore,
} from './modules/admin/broadcast-routes';
import { createPostgresInboxStore, createSupabaseInboxStore } from './modules/inbox/store';
import {
  createPostgresCustomerNotificationStore,
  createSupabaseCustomerNotificationStore,
} from './modules/inbox/customer-store';
import {
  createPostgresNotificationPreferenceStore,
  createSupabaseNotificationPreferenceStore,
} from './modules/inbox/preference-store';
import { createPostgresInsightStore, createSupabaseInsightStore } from './modules/insights/store';
import { createPostgresSiteStore, createSupabaseSiteStore } from './modules/site/store';
import {
  createPostgresOnboardingStore,
  createSupabaseOnboardingStore,
} from './modules/onboarding/store';
import { createPostgresPopupStore } from './modules/popups/store';
import { createSupabaseAddressStore, createPostgresAddressStore } from './modules/addresses/store';
import { createSupabaseAuthGateway } from './modules/auth/gateway';
import { createPostgresCartStore, createSupabaseCartStore } from './modules/cart/store';
import {
  createCatalogDiscoveryStore,
  createPostgresDiscoveryStore,
} from './modules/catalog/discovery';
import { createSupabaseCatalogStore } from './modules/catalog/store';
import { withZoneCache } from './modules/zones/cached-store';
import { createPostgresZoneStore, createSupabaseZoneStore } from './modules/zones/store';
import { createPostgresDeviceStore, createSupabaseDeviceStore } from './modules/devices/store';
import { createR2ObjectStore } from './modules/media/object-store';
import {
  createPostgresMediaKeyReferences,
  createSupabaseMediaKeyReferences,
} from './modules/media/references';
import {
  createPostgresProductImageStore,
  createSupabaseProductImageStore,
} from './modules/media/store';
import {
  createPostgresProductVideoStore,
  createSupabaseProductVideoStore,
} from './modules/media/videos';
import { createFcmSender } from './modules/notifications/fcm';
import { createSupabaseAnnouncementStore } from './modules/notifications/announcement-store';
import {
  startAnnouncementWorker,
  type AnnouncementWorker,
} from './modules/notifications/announcement-worker';
import { createSupabaseNotificationStore } from './modules/notifications/store';
import { createPostgresOrderEmailStore } from './modules/order-emails/store';
import { startOrderEmailWorker } from './modules/order-emails/worker';
import { startNotificationWorker, type NotificationWorker } from './modules/notifications/worker';
import { imageEmbeddingProvider } from './modules/image-search/embedding';
import { createImageSearchIndexer } from './modules/image-search/indexer';
import { createImageSourceReader } from './modules/image-search/image-source';
import { createImageSearchService } from './modules/image-search/service';
import { createPostgresImageSearchStore } from './modules/image-search/store';
import { merchandisingRouter } from './modules/merchandising/routes';
import {
  createPostgresMerchandisingStore,
  createSupabaseMerchandisingStore,
} from './modules/merchandising/store';
import { createRateLimiter } from './middleware/rate-limit';
import { createCourierProcessor } from './modules/couriers/processor';
import { createCourierRegistry } from './modules/couriers/registry';
import { createCourierRuntime } from './modules/couriers/runtime';
import { createCourierService } from './modules/couriers/service';
import { createPostgresCourierStore, createSupabaseCourierStore } from './modules/couriers/store';
import { createCourierWorker } from './modules/couriers/worker';
import { createPostgresOrderStore, createSupabaseOrderStore } from './modules/orders/store';
import { createPostgresAccountStore, createSupabaseAccountStore } from './modules/users/accounts';
import { createSupabaseClients } from './supabase/clients';
import type { Logger } from 'pino';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function readConfig(): AppConfig | undefined {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // Fail fast with the variable names and rules only; values are never printed.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return undefined;
  }
}

/** Push delivery runs beside the API and never blocks it: without credentials it is simply off. */
function startPush(
  config: AppConfig,
  supabase: ReturnType<typeof createSupabaseClients>,
  logger: Logger,
): { notifications: NotificationWorker; announcements: AnnouncementWorker } | undefined {
  for (const name of config.incompleteIntegrations) {
    logger.warn({ integration: name }, 'Integration is only partly configured and stays off');
  }
  if (!config.push) {
    logger.info('Push notifications are off (FCM is not configured)');
    return undefined;
  }
  try {
    const sender = createFcmSender(config.push);
    const notifications = startNotificationWorker({
      store: createSupabaseNotificationStore(supabase),
      sender,
      logger,
    });
    // Product announcements share the sender and the same outbox discipline, on their own
    // slower timer: a new product is not urgent, and a quiet poll is one indexed query.
    const announcements = startAnnouncementWorker({
      store: createSupabaseAnnouncementStore(supabase),
      sender,
      logger,
      mediaBaseUrl: config.media?.publicBaseUrl,
    });
    logger.info('Push notification workers started');
    return { notifications, announcements };
  } catch (error) {
    // For example an unreadable private key: the API keeps serving, push stays off.
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Push notifications could not start',
    );
    return undefined;
  }
}

function start(): void {
  const config = readConfig();
  if (!config) return;

  const logger = createLogger(config);
  // Which stack this process serves is the single most common source of "it works locally
  // but not in production". Log it first, as a classification only, never a URL.
  logger.info(
    {
      env: config.nodeEnv,
      database: config.databaseTarget.mode,
      connection: config.databaseTarget.connection,
      projectRef: config.databaseTarget.projectRef,
    },
    'Nilzora API database target',
  );
  if (config.databaseTarget.mode !== 'hosted') {
    logger.warn(
      { database: config.databaseTarget.mode },
      'Not connected to the hosted Supabase project; check the environment mode',
    );
  }
  const supabase = createSupabaseClients(config.supabase);
  // The direct connection is being introduced module by module. Until DATABASE_URL is
  // configured, every migrated query keeps using Supabase exactly as before.
  const database = config.databaseUrl
    ? createDatabasePool({
        connectionString: config.databaseUrl,
        onError: (error) => logger.error({ err: error }, 'Database connection failed'),
      })
    : undefined;
  const authSettings = firstPartySettings();
  const googleAuth = googleSettings();
  // First-party authentication needs the direct connection: sessions, codes and password
  // hashes live in PostgreSQL and are only reachable through its service-role functions.
  const firstParty =
    authSettings && database
      ? createAuthService({
          pool: database,
          codeSecret: authSettings.codeSecret,
          email: authSettings.email,
          accessTtlSeconds: authSettings.accessTtlSeconds,
          refreshTtlSeconds: authSettings.refreshTtlSeconds,
          // Only the flow and the safe SMTP diagnosis are logged: never the address, the code
          // or the provider's reply text (which can echo the address back).
          onEmailFailure: (flow, diagnostic) => {
            logger.warn(
              { flow, ...(diagnostic ?? {}) },
              'An account email could not be delivered by the mail server',
            );
          },
        })
      : undefined;
  // Google sign-in exists only when its three settings are present, and only with
  // first-party authentication (the session it issues is a first-party session).
  const google =
    firstParty && authSettings && googleAuth && database
      ? createGoogleOAuth({
          settings: googleAuth,
          codeSecret: authSettings.codeSecret,
          pool: database,
          oidc: createGoogleAdapter(googleAuth),
        })
      : undefined;
  // Native apps sign in with an ID token instead of a browser redirect: same client id,
  // same account linking, no secret involved.
  const googleIdToken =
    firstParty && database && googleAudiences().length > 0
      ? createGoogleIdentitySignIn({
          verifier: createGoogleIdTokenVerifier({ audiences: googleAudiences() }),
          pool: database,
        })
      : undefined;
  /*
   * Super_admin two-factor authentication. It needs first-party sessions, the direct connection
   * and TWO_FACTOR_ENCRYPTION_KEY. Production refuses to start without the key (2FA must never be
   * silently off there); development runs without it, with 2FA off and a warning, so a local or
   * development setup keeps working until the key is set.
   */
  let twoFactorEncryptionKey: Buffer | undefined;
  try {
    twoFactorEncryptionKey = twoFactorKey();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid 2FA key'}\n`);
    process.exitCode = 1;
    return;
  }
  if (!twoFactorEncryptionKey && config.nodeEnv === 'production') {
    process.stderr.write(
      'TWO_FACTOR_ENCRYPTION_KEY is required in production: super_admin accounts must use two-factor authentication\n',
    );
    process.exitCode = 1;
    return;
  }
  const twoFactor =
    twoFactorEncryptionKey && firstParty && authSettings && database
      ? createTwoFactorService({
          pool: database,
          box: createSecretBox(twoFactorEncryptionKey),
          pepper: authSettings.codeSecret,
        })
      : undefined;
  if (twoFactor) logger.info('Two-factor authentication is enforced for super_admin accounts');
  else
    logger.warn(
      'Two-factor authentication is OFF (it needs TWO_FACTOR_ENCRYPTION_KEY, first-party sign-in and DATABASE_URL)',
    );

  const auth = {
    gateway: createSupabaseAuthGateway(supabase),
    accounts: database
      ? createPostgresAccountStore(database)
      : createSupabaseAccountStore(supabase),
    ...(firstParty ? { sessions: firstParty } : {}),
    ...(twoFactor ? { twoFactor } : {}),
  };
  if (firstParty) {
    logger.info(
      { emailDelivery: Boolean(authSettings?.email), googleSignIn: google !== undefined },
      'First-party authentication is enabled; Supabase Auth remains available as fallback',
    );
    // A mail server that refuses the credentials breaks registration, sign-in codes and the
    // welcome email, and until now that was only visible when a customer tried to sign up.
    // One authenticated connection is opened at startup (no message is sent) and the result is
    // logged, so a wrong SMTP user, a revoked app password or a blocked port is visible in the
    // log the moment the API starts. It never stops the API: everything else still works.
    const probe = authSettings?.email;
    if (probe) {
      void probe
        .verify()
        .then(() => {
          logger.info('The mail server accepted the SMTP connection and credentials');
        })
        .catch((error: unknown) => {
          logger.error(
            error instanceof EmailUnavailableError ? { ...error.diagnostic } : {},
            'The mail server refused the SMTP connection or credentials: verification and welcome emails will fail until this is fixed',
          );
        });
    }
  }
  if (database) {
    logger.info('Identity, address and cart data use the direct database connection');
  }
  const mediaBaseUrl = config.media?.publicBaseUrl;
  // Optional Redis cache for the two public collections every customer client repeats.
  // Without REDIS_URL it is a cache that always misses, so nothing changes.
  // The same connection carries the shared rate-limit counters and the readiness probe.
  const redis = createProcessRedis(config.redisUrl, {
    info: (message) => {
      logger.info(message);
    },
    warn: (message) => {
      logger.warn(message);
    },
  });
  const catalogCache = redis.catalogCache;
  const namedLimiter = (name: string) =>
    createRateLimiter({ ...config.adminRateLimit, name, store: redis.counters });
  const commerce = {
    catalog: createSupabaseCatalogStore(supabase, { mediaBaseUrl, cache: catalogCache }),
    cart: database
      ? createPostgresCartStore(database, supabase, { mediaBaseUrl })
      : createSupabaseCartStore(supabase, { mediaBaseUrl }),
    addresses: database
      ? createPostgresAddressStore(database)
      : createSupabaseAddressStore(supabase),
    orders: database
      ? createPostgresOrderStore(database, { mediaBaseUrl })
      : createSupabaseOrderStore(supabase, { mediaBaseUrl }),
  };
  // Ranked discovery needs orders, wishlist rows and review moderation state, which only the
  // direct connection can read; without it the API offers just the newest products on sale.
  const discovery = database
    ? createPostgresDiscoveryStore(database, { mediaBaseUrl })
    : createCatalogDiscoveryStore(commerce.catalog);
  // Avatars and review photos: the database functions of the avatars-and-review-images
  // migration. Until it is applied they report themselves unavailable and nothing else breaks.
  const attachments = database
    ? createPostgresAttachmentStore(database)
    : createSupabaseAttachmentStore(supabase);
  const reviews = database
    ? createPostgresReviewStore(database, { mediaBaseUrl, attachments })
    : createSupabaseReviewStore(supabase, { mediaBaseUrl, attachments });
  const afterSales = database
    ? createPostgresAfterSalesStore(database)
    : createSupabaseAfterSalesStore(supabase);
  const carts = database
    ? createPostgresSavedCartStore(database)
    : createSupabaseSavedCartStore(supabase);
  const site = database
    ? createPostgresSiteStore(database, { mediaBaseUrl })
    : createSupabaseSiteStore(supabase, { mediaBaseUrl });
  const onboarding = database
    ? createPostgresOnboardingStore(database, { mediaBaseUrl })
    : createSupabaseOnboardingStore(supabase, { mediaBaseUrl });
  // Promotional popups live behind service-role functions only (the table has no end-user
  // policy), so they exist only where the direct connection does.
  const popups = database ? createPostgresPopupStore(database, { mediaBaseUrl }) : undefined;
  const inbox = database ? createPostgresInboxStore(database) : createSupabaseInboxStore(supabase);
  const notifications = database
    ? createPostgresCustomerNotificationStore(database)
    : createSupabaseCustomerNotificationStore(supabase);
  const notificationPreferences = database
    ? createPostgresNotificationPreferenceStore(database)
    : createSupabaseNotificationPreferenceStore(supabase);
  const wishlist = database
    ? createPostgresWishlistStore(database, { mediaBaseUrl })
    : createSupabaseWishlistStore(supabase, { mediaBaseUrl });
  const insights = database
    ? createPostgresInsightStore(database)
    : createSupabaseInsightStore(supabase);
  const admin = {
    catalog: database
      ? createPostgresAdminCatalogStore(database, { mediaBaseUrl, cache: catalogCache })
      : createSupabaseAdminCatalogStore(supabase, { mediaBaseUrl, cache: catalogCache }),
    orders: database
      ? createPostgresAdminOrderStore(database, { mediaBaseUrl, logger })
      : createSupabaseAdminOrderStore(supabase, { mediaBaseUrl, logger }),
    accounts: database
      ? createPostgresAdminAccountStore(database)
      : createSupabaseAdminAccountStore(supabase),
    moderation: database
      ? createPostgresModerationStore(database)
      : createSupabaseModerationStore(supabase),
    reports: database
      ? createPostgresAdminReportStore(database)
      : createSupabaseAdminReportStore(supabase),
    coupons: database
      ? createPostgresAdminCouponStore(database)
      : createSupabaseAdminCouponStore(supabase),
    discounts: database
      ? createPostgresAdminDiscountStore(database, { mediaBaseUrl })
      : createSupabaseAdminDiscountStore(supabase, { mediaBaseUrl }),
    reviews,
    afterSales,
    checkouts: carts,
    mediaLibrary: database
      ? createPostgresMediaLibraryStore(database)
      : createSupabaseMediaLibraryStore(supabase),
    // Static pages, navigation links and homepage sections.
    content: database
      ? createPostgresSiteContentStore(database)
      : createSupabaseSiteContentStore(supabase),
    // Background export jobs need the direct connection: the worker reads as each creator.
    exports: {
      reports: database ? createPostgresReportStore(database) : createSupabaseReportStore(supabase),
      jobs: database ? createPostgresExportJobStore(database) : undefined,
    },
  };
  // Push devices: first-party sessions are opaque tokens, so they need the direct
  // connection to carry the caller's session; the Supabase JWT path keeps PostgREST.
  const devices = database
    ? createPostgresDeviceStore(database)
    : createSupabaseDeviceStore(supabase);
  const media = {
    images: database
      ? createPostgresProductImageStore(database)
      : createSupabaseProductImageStore(supabase),
    videos: database
      ? createPostgresProductVideoStore(database)
      : createSupabaseProductVideoStore(supabase),
    storage: config.media
      ? { objects: createR2ObjectStore(config.media), publicBaseUrl: config.media.publicBaseUrl }
      : undefined,
  };
  // Visual search: the embedding model, the indexer and the search service. Everything except
  // the model lives in PostgreSQL (pgvector). Without the direct connection there is no index
  // to read, so the feature is simply not mounted and the rest of the API is unaffected.
  const imageSearchStore = database ? createPostgresImageSearchStore(database) : null;
  const imageSearchProvider = imageEmbeddingProvider(config.imageSearch.provider);
  const imageSearchIndexer =
    database !== null && imageSearchStore !== null && config.imageSearch.worker.enabled
      ? createImageSearchIndexer({
          store: imageSearchStore,
          provider: imageSearchProvider,
          reader: createImageSourceReader({ storage: media.storage, publicBaseUrl: mediaBaseUrl }),
          logger,
          batchSize: config.imageSearch.worker.batchSize,
          intervalMs: config.imageSearch.worker.intervalMs,
        })
      : null;
  const imageSearch =
    imageSearchStore === null
      ? undefined
      : {
          store: imageSearchStore,
          service: createImageSearchService({
            store: imageSearchStore,
            catalog: commerce.catalog,
            provider: imageSearchProvider,
            logger,
            enabled: config.imageSearch.enabled,
          }),
          catalog: commerce.catalog,
          provider: config.imageSearch.provider,
          indexer: imageSearchIndexer,
        };
  const merchandising = merchandisingRouter({
    ...auth,
    store: database
      ? createPostgresMerchandisingStore(database, { mediaBaseUrl, cache: catalogCache })
      : createSupabaseMerchandisingStore(supabase, { mediaBaseUrl, cache: catalogCache }),
    storage: media.storage,
    // Asked with the server's own connection: a picture may be referenced by a table the
    // administrator doing the change cannot read.
    references: database
      ? createPostgresMediaKeyReferences(database)
      : createSupabaseMediaKeyReferences(supabase),
    limiter: namedLimiter('merchandising'),
    logger,
  });
  const pictures = attachmentsRouter({
    ...auth,
    store: attachments,
    storage: media.storage,
    // Its own bucket: customers changing their picture never use up the admin's allowance.
    limiter: namedLimiter('pictures'),
    logger,
  });
  /*
   * Realtime is attached to the same HTTP server as the REST API: there is no second
   * backend. It needs the direct database connection, because room authorization and
   * message persistence run as the calling account (the socket ticket names an account,
   * not a token). Without that connection chat still works over REST, with no live events.
   */
  let realtime: Realtime | undefined;
  const tickets = config.realtime ? createChatTicketSigner(config.realtime.secret) : undefined;
  const canRunRealtime = database !== undefined && tickets !== undefined;
  // Late-bound: the routes are built before the socket server exists.
  const notify: ChatNotifier = {
    message: (conversationId, message) => realtime?.notifier.message(conversationId, message),
    read: (conversationId, userId, seq) => realtime?.notifier.read(conversationId, userId, seq),
    updated: (conversationId, change) => realtime?.notifier.updated(conversationId, change),
    assigned: (conversationId, assigneeId) =>
      realtime?.notifier.assigned(conversationId, assigneeId),
    queue: () => realtime?.notifier.queue(),
  };
  const chat = {
    store: database
      ? createPostgresChatStore(database, { publicBaseUrl: config.media?.publicBaseUrl })
      : createSupabaseChatStore(supabase, { publicBaseUrl: config.media?.publicBaseUrl }),
    admin: database
      ? createPostgresChatAdminStore(database, { publicBaseUrl: config.media?.publicBaseUrl })
      : createSupabaseChatAdminStore(supabase, { publicBaseUrl: config.media?.publicBaseUrl }),
    ...(canRunRealtime ? { tickets, notify } : {}),
    // Reads store facts with the service key, so it needs the pool rather than a user's token.
    ...(database ? { assistant: createPostgresChatAssistant(database, { logger, notify }) } : {}),
  };

  // Couriers: the staff routes, the customer's shipments and webhooks. The operating mode
  // and switches live in the database (Admin -> Operations -> Courier settings), so the
  // routes still answer when couriers are off and no courier is ever called then. Calls
  // reach the database as the caller, except the booking payload, the runtime settings,
  // credentials and webhook/worker functions, which are granted to the service role only.
  const courierStore = database
    ? createPostgresCourierStore(database)
    : createSupabaseCourierStore(supabase);
  const courierRegistry = createCourierRegistry({
    mockWebhookSecret: config.couriers.mockWebhookSecret,
  });
  const courierRuntime = createCourierRuntime({ store: courierStore, config: config.couriers });
  const couriers = {
    service: createCourierService({
      store: courierStore,
      registry: courierRegistry,
      config: config.couriers,
      runtime: courierRuntime,
      logger,
    }),
    processor: createCourierProcessor({
      store: courierStore,
      registry: courierRegistry,
      runtime: courierRuntime,
      logger,
    }),
  };
  if (config.couriers.ignoredVariables.length > 0) {
    // Names only, never values.
    logger.warn(
      { ignored: config.couriers.ignoredVariables },
      'ignored: courier operations are managed in Admin → Operations → Courier settings',
    );
  }
  logger.info(
    { databaseTarget: config.couriers.databaseTarget, mockAllowed: config.couriers.mockAllowed },
    'Courier settings are read from the database',
  );

  // The picture each customer shows: their own upload, then Google's, then their initials.
  const avatarDirectory = database ? createPostgresAvatarDirectory(database) : NO_AVATAR_DIRECTORY;

  const domainEvents = database ? createPostgresDomainEventStore(database) : undefined;
  const app = createApp({
    config,
    ...(domainEvents ? { events: domainEvents } : {}),
    readiness: {
      database: database
        ? async () => {
            await database.query('select 1');
            return true;
          }
        : undefined,
      redis: redis.ping,
    },
    rateLimitStore: redis.counters,
    ...(twoFactor ? { twoFactor } : {}),
    modules: [merchandising, pictures],
    avatars: { store: attachments, mediaBaseUrl, directory: avatarDirectory },
    logger,
    auth,
    commerce,
    discovery,
    devices,
    reviews,
    // Shopping zones: the storefront collections. The public list plus the workspace's own.
    // The public list goes through the catalog cache; every zone write clears it.
    zones: withZoneCache(
      database
        ? createPostgresZoneStore(database, { mediaBaseUrl })
        : createSupabaseZoneStore(supabase, { mediaBaseUrl }),
      catalogCache,
    ),
    // Zone pictures are asked about with the server's own connection before their files go.
    mediaReferences: database
      ? createPostgresMediaKeyReferences(database)
      : createSupabaseMediaKeyReferences(supabase),
    carts,
    wishlist,
    broadcasts: database
      ? createPostgresBroadcastStore(database)
      : createSupabaseBroadcastStore(supabase),
    vouchers: database
      ? createPostgresVoucherStore(database)
      : createSupabaseVoucherStore(supabase),
    afterSales,
    site,
    inbox,
    notifications,
    notificationPreferences,
    chat,
    insights,
    onboarding,
    popups,
    admin,
    couriers,
    media,
    ...(imageSearch ? { imageSearch } : {}),
    ...(database
      ? {
          staffInvitations: {
            store: createPostgresStaffInvitationStore(database),
            email: authSettings?.email,
            branding: {
              logoUrl: process.env.EMAIL_LOGO_URL,
              siteUrl: process.env.EMAIL_SITE_URL,
            },
            onEmailFailure: (error) => {
              logger.warn(
                { flow: 'staff_invitation', ...(emailDiagnosticOf(error) ?? {}) },
                'A staff invitation email could not be delivered by the mail server',
              );
            },
          },
        }
      : {}),
    ...(firstParty
      ? {
          firstParty: {
            service: firstParty,
            ...(google ? { google } : {}),
            ...(googleIdToken ? { googleIdToken } : {}),
          },
        }
      : {}),
  });
  const server = createServer(app);

  // The indexer drains the queue in this process, on its own timer: a product save never
  // waits for the model. A fresh database has state rows for nothing yet, so the catalogue
  // that already exists is queued once; afterwards the triggers keep it in step.
  if (imageSearchIndexer !== null && imageSearchStore !== null) {
    void imageSearchStore
      .countCandidates()
      .then((count) => (count === 0 ? imageSearchStore.queueAll() : 0))
      .then((queued) => {
        if (queued > 0) logger.info({ queued }, 'image search: queued the existing catalogue');
      })
      .catch((error: unknown) => {
        logger.warn(
          { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
          'image search: the existing catalogue could not be queued',
        );
      });
    imageSearchIndexer.start();
  } else if (database !== null && !config.imageSearch.worker.enabled) {
    logger.info('Image search indexer is off (IMAGE_SEARCH_WORKER=false)');
  }

  // Durable domain events -> realtime. Only with the direct connection (the outbox functions are
  // granted to the service role). The realtime consumer is late-bound like `notify`: with
  // realtime off it has nothing to deliver to, and clients recover through GET /me/events.
  const domainEventWorker = domainEvents
    ? createDomainEventWorker({
        store: domainEvents,
        consumers: [
          {
            name: 'realtime',
            handle: (event) => {
              realtime?.publishDomainEvent(event);
              return Promise.resolve();
            },
          },
        ],
        logger,
      })
    : undefined;
  domainEventWorker?.start();
  if (canRunRealtime && tickets) {
    realtime = attachRealtime(server, {
      chat: chat.store,
      tickets,
      auth,
      corsOrigins: config.corsOrigins,
      logger,
    });
  } else if (!database) {
    logger.info('Realtime chat is off (no direct database connection); chat uses REST only');
  } else {
    logger.info('Realtime chat is off (no ticket secret); chat uses REST only');
  }
  server.listen(config.port, (error?: Error) => {
    if (error) {
      logger.fatal({ err: error, port: config.port }, 'Nilzora API could not start listening');
      process.exitCode = 1;
      return;
    }
    logger.info({ port: config.port, env: config.nodeEnv }, 'Nilzora API listening');
  });

  const pushWorker = startPush(config, supabase, logger);
  const exportWorker = database
    ? startExportWorker({ backend: createPostgresExportWorkerBackend(database), logger })
    : undefined;
  if (!database) logger.info('Background exports are off (no direct database connection)');

  // Scheduled chat automation. Only with a direct connection, because the drain function is
  // granted to `service_role` and reached through the server's own identity.
  const automationWorker =
    database && config.chatAutomationWorker.enabled
      ? createAutomationWorker({
          runner: createPostgresAutomationJobRunner(database),
          logger,
          intervalMs: config.chatAutomationWorker.intervalMs,
          batchSize: config.chatAutomationWorker.batchSize,
        })
      : undefined;
  if (automationWorker) automationWorker.start();
  else if (config.chatAutomationWorker.enabled) {
    logger.info('Chat automation worker is off (no direct database connection)');
  }

  // Customer order emails (order received, out for delivery, return and refund updates).
  // Switched on deliberately (ORDER_EMAIL_WORKER=true) and only with the direct connection and
  // a mail server; the order itself never waits for it.
  const orderEmailSender = config.orderEmailWorker.enabled
    ? (authSettings?.email ?? createEmailSender())
    : undefined;
  const orderEmailWorker =
    config.orderEmailWorker.enabled && database && orderEmailSender
      ? startOrderEmailWorker({
          store: createPostgresOrderEmailStore(database, (userId, orderNumber) =>
            createPostgresOrderStore(database, { mediaBaseUrl }).get('', userId, orderNumber),
          ),
          sender: orderEmailSender,
          branding: () => ({
            logoUrl: process.env.EMAIL_LOGO_URL,
            siteUrl: process.env.EMAIL_SITE_URL,
          }),
          logger,
          pollIntervalMs: config.orderEmailWorker.intervalMs,
        })
      : undefined;
  if (config.orderEmailWorker.enabled && !orderEmailWorker) {
    logger.info('Order emails are off (they need DATABASE_URL and the SMTP settings)');
  }

  // Always running: each round reads the saved settings, does nothing while couriers are
  // off, retries webhooks otherwise and syncs tracking when that is switched on.
  const courierWorker = createCourierWorker({
    processor: couriers.processor,
    runtime: courierRuntime,
    logger,
  });
  courierWorker.start();

  /*
   * Graceful shutdown, in dependency order. The database pool is closed last: requests still in
   * flight and a worker's current round both need it, and closing it first (as this used to do,
   * all at once) failed exactly those requests during every deployment or restart.
   *   1. background workers finish their current round and take no new one;
   *   2. sockets close (Socket.IO also stops the HTTP server from accepting connections);
   *   3. the HTTP server stops accepting, idle keep-alive connections are dropped, and the
   *      requests already running are allowed to finish;
   *   4. Redis and the database pool close.
   * Anything still running after SHUTDOWN_TIMEOUT_MS is abandoned and the process exits 1.
   */
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    const serverClosed = new Promise<void>((resolve) => server.once('close', () => resolve()));
    void (async () => {
      await Promise.allSettled([
        courierWorker.stop(),
        pushWorker?.notifications.stop(),
        pushWorker?.announcements.stop(),
        exportWorker?.stop(),
        automationWorker?.stop(),
        orderEmailWorker?.stop(),
        domainEventWorker?.stop(),
      ]);
      await realtime?.close().catch(() => undefined);
      if (server.listening) server.close();
      server.closeIdleConnections();
      await serverClosed;
      await catalogCache.close().catch(() => undefined);
      if (database) await database.end().catch(() => undefined);
      logger.info('Shutdown complete');
      process.exit(0);
    })().catch((error: unknown) => {
      logger.error({ err: error }, 'Error while shutting down');
      process.exit(1);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start();
