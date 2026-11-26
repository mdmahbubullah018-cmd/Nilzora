import { API_V1_PREFIX } from '@nilzora/contracts';
import express, { type Express, type Router } from 'express';
import type { Logger } from 'pino';
import type { AppConfig } from './config/env';
import type { AuthDependencies } from './middleware/authenticate';
import { cors } from './middleware/cors';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { httpLogger } from './middleware/http-logger';
import { clientAddress } from './middleware/client-address';
import { createRateLimiter } from './middleware/rate-limit';
import { createUploadLimiters } from './middleware/upload-rate-limit';
import { requestId } from './middleware/request-id';
import { securityHeaders } from './middleware/security-headers';
import { adminRouter, type AdminStores } from './modules/admin/routes';
import {
  staffInvitationRoutes,
  type StaffInvitationStore,
} from './modules/admin/staff-invitations';
import type { EmailSender } from './auth/sender';
import type { EmailBranding } from './email/design';
import { bulkOrdersRouter } from './modules/admin/bulk-orders-routes';
import { addressesRouter } from './modules/addresses/routes';
import { reviewRoutes } from './modules/reviews/routes';
import { afterSalesRoutes } from './modules/after-sales/routes';
import { chatRoutes } from './modules/chat/routes';
import { chatAdminRoutes } from './modules/chat/admin-routes';
import type { ChatAdminStore } from './modules/chat/admin-store';
import type { ChatAssistant } from './modules/chat/assistant-service';
import type { ChatStore } from './modules/chat/store';
import type { ChatNotifier } from './realtime/notifier';
import type { ChatTicketSigner } from './realtime/ticket';
import { inboxRoutes, moderatorInboxRoutes } from './modules/inbox/routes';
import { customerInboxRoutes } from './modules/inbox/customer-routes';
import type { CustomerNotificationStore } from './modules/inbox/customer-store';
import type { NotificationPreferenceStore } from './modules/inbox/preference-store';
import { insightRoutes } from './modules/insights/routes';
import { adminSiteRoutes, publicSiteRoutes } from './modules/site/routes';
import { adminOnboardingRoutes, onboardingRoutes } from './modules/onboarding/routes';
import { adminPopupRoutes, popupRoutes } from './modules/popups/routes';
import { cartRoutes } from './modules/carts/routes';
import { wishlistRoutes } from './modules/wishlist/routes';
import { voucherRoutes, type VoucherStore } from './modules/vouchers/routes';
import type { WishlistStore } from './modules/wishlist/store';
import type { ReviewStore } from './modules/reviews/store';
import type { AfterSalesStore } from './modules/after-sales/store';
import type { SavedCartStore } from './modules/carts/store';
import type { InboxStore } from './modules/inbox/store';
import type { InsightStore } from './modules/insights/store';
import type { SiteStore } from './modules/site/store';
import type { OnboardingStore } from './modules/onboarding/store';
import type { PopupStore } from './modules/popups/store';
import type { AddressStore } from './modules/addresses/store';
import type { AuthService } from './auth/first-party';
import type { GoogleIdentitySignIn, GoogleOAuth } from './auth/oauth';
import { firstPartyAuthRouter } from './modules/auth/first-party-routes';
import { twoFactorRouter } from './modules/auth/two-factor-routes';
import type { TwoFactorService } from './auth/two-factor';
import { domainEventRoutes } from './modules/events/routes';
import type { DomainEventStore } from './modules/events/store';
import { authRouter } from './modules/auth/routes';
import { cartRouter } from './modules/cart/routes';
import type { CartStore } from './modules/cart/store';
import type { DiscoveryStore } from './modules/catalog/discovery';
import { catalogRouter, discoveryRouter } from './modules/catalog/routes';
import { devicesRouter } from './modules/devices/routes';
import type { DeviceStore } from './modules/devices/store';
import type { CatalogStore } from './modules/catalog/store';
import { healthRouter, type ReadinessProbes } from './modules/health/routes';
import type { KeyValueStore } from './cache';
import { mediaRouter, type MediaStorage } from './modules/media/routes';
import type { MediaKeyReferences } from './modules/media/references';
import { zoneRoutes } from './modules/zones/routes';
import type { ZoneStore } from './modules/zones/store';
import type { ProductImageStore } from './modules/media/store';
import { productVideoRouter, type ProductVideoStore } from './modules/media/videos';
import { broadcastRoutes, type BroadcastStore } from './modules/admin/broadcast-routes';
import { ordersRouter } from './modules/orders/routes';
import type { CourierProcessor } from './modules/couriers/processor';
import { courierRouter } from './modules/couriers/routes';
import type { CourierService } from './modules/couriers/service';
import { courierWebhookRouter } from './modules/couriers/webhook-routes';
import type { OrderStore } from './modules/orders/store';
import { staffRouter } from './modules/staff/routes';
import { usersRouter, type AvatarSource } from './modules/users/routes';
import { imageSearchAdminRoutes } from './modules/image-search/admin-routes';
import { imageSearchRoutes } from './modules/image-search/routes';
import type { ImageEmbeddingConfig } from './modules/image-search/embedding';
import type { ImageSearchIndexer } from './modules/image-search/indexer';
import type { ImageSearchService } from './modules/image-search/service';
import type { ImageSearchStore } from './modules/image-search/store';

/** Largest JSON body accepted by any route. */
export const JSON_BODY_LIMIT = '100kb';

/** Per-IP budget for courier webhooks (a courier sends bursts from few addresses). */
const WEBHOOK_RATE_LIMIT = { windowMs: 60_000, limit: 120 };

/** Catalog, cart, address and order data access (Supabase in production, fakes in unit tests). */
export interface CommerceStores {
  catalog: CatalogStore;
  cart: CartStore;
  addresses: AddressStore;
  orders: OrderStore;
}

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  /** Supabase Auth and identity-data access (real in production, fakes in unit tests). */
  auth: AuthDependencies;
  /** Commerce data access. The catalog, cart, address and order routes are mounted only when given. */
  commerce?: CommerceStores;
  /** Ranked search-page discovery. Mounted only when the app is given a store for it. */
  discovery?: DiscoveryStore;
  /** Push-device data access. The /me/devices routes are mounted only when given. */
  devices?: DeviceStore;
  /** Customer product reviews: the public read and the customer's own review. */
  reviews?: ReviewStore;
  /** Shopping zones: the public collection list and the workspace's management. */
  zones?: ZoneStore;
  /**
   * Whether a stored picture is still referenced before its files are deleted. Zones ask it
   * with the server's own connection, so a table an admin cannot read still counts.
   */
  mediaReferences?: MediaKeyReferences;
  /** Returns and refunds: the customer's own, and the staff queues. */
  afterSales?: AfterSalesStore;
  carts?: SavedCartStore;
  /** The signed-in customer's saved products, shared by the website and the app. */
  wishlist?: WishlistStore;
  vouchers?: VoucherStore;
  broadcasts?: BroadcastStore;
  /** SEO and the store profile: the public reads and the staff edits. */
  site?: SiteStore;
  /** The staff notification inbox. */
  inbox?: InboxStore;
  /** The customer's own notification history (POST /me endpoints). */
  notifications?: CustomerNotificationStore;
  /** The account's notification choices; absent, those two routes are not mounted. */
  notificationPreferences?: NotificationPreferenceStore;
  /**
   * Unified communication. The REST routes are mounted whenever a store is given;
   * `tickets` and `notify` are present only when the realtime layer is running, and the
   * ticket route answers 503 without them.
   */
  chat?: {
    store: ChatStore;
    /** Present when Phase 2 is wired: templates, automation, analytics, reports, internal chat. */
    admin?: ChatAdminStore | undefined;
    tickets?: ChatTicketSigner | undefined;
    notify?: ChatNotifier | undefined;
    /** Present when the assistant can read store facts; absent means it never answers. */
    assistant?: ChatAssistant | undefined;
  };
  /** Customer spending and segments. */
  insights?: InsightStore;
  /** Onboarding and promotional campaigns: the public read and the staff management. */
  onboarding?: OnboardingStore;
  /** Promotional popups: the public read and the staff management. */
  popups?: PopupStore;
  /** Admin and moderator data access. The /admin and /moderator routes are mounted only when given. */
  admin?: AdminStores;
  /**
   * Couriers (Steadfast, Pathao): the staff courier routes, the customer's own shipments and
   * the courier webhooks. Mounted only when given.
   */
  couriers?: { service: CourierService; processor: CourierProcessor };
  /**
   * Product-image routes (POST/PUT/PATCH/DELETE). Mounted only when given; with `storage`
   * undefined (R2 not configured) they answer 503 media_unavailable.
   */
  media?: {
    images: ProductImageStore;
    videos?: ProductVideoStore;
    storage: MediaStorage | undefined;
  };
  /**
   * First-party authentication. Mounted ahead of the Supabase Auth routes and only when
   * configured, so the paths it implements are served by it and the rest (confirm-email,
   * accept-invite) keep falling through to Supabase during the migration.
   */
  firstParty?: {
    service: AuthService;
    google?: GoogleOAuth | undefined;
    /** Verifies native Google ID tokens; present only with Google configured. */
    googleIdToken?: GoogleIdentitySignIn | undefined;
  };
  /**
   * Staff, moderator and admin invitations that grant nothing until accepted. Mounted ahead of
   * the admin router, so its /admin/staff/invitations paths replace the older ones that created
   * the account (and its role) at send time.
   */
  staffInvitations?: {
    store: StaffInvitationStore;
    email: EmailSender | undefined;
    branding: EmailBranding;
    onEmailFailure?: (error: unknown) => void;
  };
  /** Where /me reads the caller's profile picture from; without it /me carries no picture. */
  avatars?: AvatarSource;
  /** What GET /health/ready asks: the database (required) and Redis (optional). */
  readiness?: ReadinessProbes;
  /**
   * Shared rate-limit counters (Redis). Absent, every limiter counts in this process, which is
   * correct only while one API instance runs.
   */
  rateLimitStore?: KeyValueStore | undefined;
  /** Super_admin two-factor authentication; its /auth/two-factor routes are mounted when given. */
  twoFactor?: TwoFactorService | undefined;
  /** Domain events: missed-event recovery (/me/events) and outbox stats. */
  events?: DomainEventStore | undefined;
  /**
   * Visual search (search by image): the customer routes, the scan resolver and the admin
   * screens. Mounted only when the database connection and an embedding model are present.
   */
  imageSearch?:
    | {
        service: ImageSearchService;
        catalog: CatalogStore;
        store: ImageSearchStore;
        provider: ImageEmbeddingConfig;
        /** Present when the background indexer runs in this process. */
        indexer: ImageSearchIndexer | null;
      }
    | undefined;
  /**
   * Extra module routers, mounted under /api/v1 after the built-in modules, behind
   * rate limiting and JSON body parsing.
   */
  modules?: readonly Router[];
}

export function createApp({
  config,
  logger,
  auth,
  commerce,
  discovery,
  devices,
  reviews,
  afterSales,
  zones,
  mediaReferences,
  carts,
  wishlist,
  vouchers,
  broadcasts,
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
  avatars,
  firstParty,
  staffInvitations,
  readiness,
  rateLimitStore,
  twoFactor,
  events,
  imageSearch,
  modules = [],
}: AppDependencies): Express {
  const app = express();
  // Every limiter gets its own namespace in the shared store, so no two add to one counter.
  const limiter = (name: string, options: { windowMs: number; limit: number }) =>
    createRateLimiter({ ...options, name, store: rateLimitStore });
  const limits = (name: string, options: { windowMs: number; limit: number }) => ({
    ...options,
    name,
    store: rateLimitStore,
  });
  app.disable('x-powered-by');
  // req.ip honours X-Forwarded-For only for the configured number of proxy hops (0 = never).
  app.set('trust proxy', config.trustProxyHops === 0 ? false : config.trustProxyHops);
  // Flat query strings only; nested objects are not parsed from user input.
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(clientAddress(config.trustedClientSecret, logger));
  app.use(httpLogger(logger));
  app.use(securityHeaders());
  app.use(cors(config.corsOrigins));

  // Liveness stays outside rate limiting so infrastructure checks are never throttled.
  app.use(API_V1_PREFIX, healthRouter(config.databaseTarget, readiness));

  app.use(limiter('general', config.rateLimit));
  // Courier webhooks read their body raw (the signature covers the exact bytes), so they are
  // mounted before the JSON parser, with their own per-IP limit.
  if (couriers) {
    app.use(
      API_V1_PREFIX,
      courierWebhookRouter({
        processor: couriers.processor,
        limiter: limiter('courier-webhook', WEBHOOK_RATE_LIMIT),
        logger,
      }),
    );
  }
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  if (firstParty) {
    app.use(
      API_V1_PREFIX,
      firstPartyAuthRouter({
        auth: firstParty.service,
        rateLimit: limits('auth-first-party', config.authRateLimit),
        google: firstParty.google,
        googleIdToken: firstParty.googleIdToken,
      }),
    );
  }
  if (twoFactor) {
    app.use(
      API_V1_PREFIX,
      twoFactorRouter({
        auth,
        service: twoFactor,
        rateLimit: limits('two-factor', config.authRateLimit),
      }),
    );
  }
  app.use(API_V1_PREFIX, authRouter({ ...auth, rateLimit: limits('auth', config.authRateLimit) }));
  app.use(API_V1_PREFIX, usersRouter(auth, avatars));
  // One shared per-IP budget for every admin and moderator change.
  const adminLimiter = limiter('admin', config.adminRateLimit);
  app.use(API_V1_PREFIX, staffRouter({ ...auth, limiter: adminLimiter }));
  if (commerce) {
    app.use(API_V1_PREFIX, catalogRouter(commerce.catalog));
    app.use(API_V1_PREFIX, cartRouter({ ...auth, cart: commerce.cart }));
    app.use(API_V1_PREFIX, addressesRouter({ ...auth, addresses: commerce.addresses }));
    app.use(
      API_V1_PREFIX,
      ordersRouter({
        ...auth,
        orders: commerce.orders,
        rateLimit: limits('orders', config.orderRateLimit),
        mediaBaseUrl: config.media?.publicBaseUrl,
      }),
    );
  }
  if (discovery) app.use(API_V1_PREFIX, discoveryRouter(discovery));
  if (devices) app.use(API_V1_PREFIX, devicesRouter({ ...auth, devices }));
  if (reviews) app.use(API_V1_PREFIX, reviewRoutes({ ...auth, reviews }));
  if (zones) {
    app.use(
      API_V1_PREFIX,
      zoneRoutes({
        ...auth,
        zones,
        references: mediaReferences,
        storage: media?.storage,
        limiter: adminLimiter,
        logger,
      }),
    );
  }
  if (afterSales) app.use(API_V1_PREFIX, afterSalesRoutes({ ...auth, afterSales }));
  if (carts) app.use(API_V1_PREFIX, cartRoutes({ ...auth, carts }));
  if (wishlist) app.use(API_V1_PREFIX, wishlistRoutes({ ...auth, wishlist }));
  if (vouchers) {
    app.use(
      API_V1_PREFIX,
      voucherRoutes({ ...auth, vouchers, limiter: limiter('vouchers', config.orderRateLimit) }),
    );
  }
  if (site) app.use(API_V1_PREFIX, publicSiteRoutes({ ...auth, site }));
  if (inbox) {
    app.use(API_V1_PREFIX, inboxRoutes({ ...auth, inbox }));
    // Same store, its own door: a moderator sees only what their permissions address to them.
    app.use(API_V1_PREFIX, moderatorInboxRoutes({ ...auth, inbox }));
  }
  if (notifications) {
    app.use(
      API_V1_PREFIX,
      customerInboxRoutes({
        ...auth,
        notifications,
        ...(notificationPreferences ? { preferences: notificationPreferences } : {}),
      }),
    );
  }
  if (chat) {
    const chatLimiter = limiter('chat', config.chatRateLimit);
    // Uploads are the expensive chat operation, so they get their own budgets rather than
    // borrowing the message one. The counters live in Redis when it is configured.
    const uploadLimiters = createUploadLimiters({
      windowMs: config.chatUploadRateLimit.windowMs,
      limits: {
        total: config.chatUploadRateLimit.total,
        image: config.chatUploadRateLimit.image,
        document: config.chatUploadRateLimit.document,
        audio: config.chatUploadRateLimit.audio,
      },
      // The counters this limiter's own documentation promises: shared in Redis when configured.
      store: rateLimitStore,
    });
    app.use(
      API_V1_PREFIX,
      chatRoutes({
        ...auth,
        chat: chat.store,
        tickets: chat.tickets,
        notify: chat.notify,
        assistant: chat.assistant,
        // A separate budget from the general limiter: a fast conversation is normal.
        limiter: chatLimiter,
      }),
    );
    if (chat.admin) {
      app.use(
        API_V1_PREFIX,
        chatAdminRoutes({
          ...auth,
          chatAdmin: chat.admin,
          limiter: chatLimiter,
          uploadLimiters,
          storage: media?.storage,
          // The same broadcast the Phase 1 routes use: a pin or a reaction reaches everyone
          // already in the thread's room.
          notify: chat.notify,
          logger,
        }),
      );
    }
  }
  if (insights) app.use(API_V1_PREFIX, insightRoutes({ ...auth, insights }));
  if (onboarding) {
    app.use(API_V1_PREFIX, onboardingRoutes({ ...auth, onboarding }));
    app.use(API_V1_PREFIX, adminOnboardingRoutes({ ...auth, onboarding }));
  }
  if (popups) {
    app.use(API_V1_PREFIX, popupRoutes({ ...auth, popups, storage: media?.storage }));
    app.use(API_V1_PREFIX, adminPopupRoutes({ ...auth, popups, storage: media?.storage }));
  }
  if (site) app.use(API_V1_PREFIX, adminSiteRoutes({ ...auth, site }));
  if (staffInvitations) {
    app.use(
      API_V1_PREFIX,
      staffInvitationRoutes({
        ...auth,
        invitations: staffInvitations.store,
        email: staffInvitations.email,
        branding: staffInvitations.branding,
        adminAppOrigin: config.adminAppOrigin,
        limiter: adminLimiter,
        publicLimiter: limiter('staff-invitation', config.authRateLimit),
        onEmailFailure: staffInvitations.onEmailFailure,
      }),
    );
  }
  if (admin) {
    // Before the single-order routes, whose /admin/orders/:orderNumber/... paths would take
    // "bulk" for an order number.
    app.use(
      API_V1_PREFIX,
      bulkOrdersRouter({
        ...auth,
        orders: admin.orders,
        couriers: couriers?.service,
        limiter: adminLimiter,
        logger,
      }),
    );
    app.use(
      API_V1_PREFIX,
      adminRouter({
        ...auth,
        stores: admin,
        limiter: adminLimiter,
        adminAppOrigin: config.adminAppOrigin,
        storage: media?.storage,
        logger,
        ...(avatars?.directory
          ? { avatars: { directory: avatars.directory, mediaBaseUrl: avatars.mediaBaseUrl } }
          : {}),
      }),
    );
  }
  if (couriers) {
    app.use(
      API_V1_PREFIX,
      courierRouter({ ...auth, service: couriers.service, limiter: adminLimiter }),
    );
  }
  if (media)
    app.use(API_V1_PREFIX, mediaRouter({ ...auth, ...media, limiter: adminLimiter, logger }));
  if (broadcasts) {
    app.use(API_V1_PREFIX, broadcastRoutes({ ...auth, broadcasts, limiter: adminLimiter }));
  }
  if (media?.videos)
    app.use(
      API_V1_PREFIX,
      productVideoRouter({
        ...auth,
        videos: media.videos,
        storage: media.storage,
        limiter: adminLimiter,
        logger,
      }),
    );
  if (events) app.use(API_V1_PREFIX, domainEventRoutes({ ...auth, events }));
  if (imageSearch) {
    // Its own budget, because a camera surface fires in bursts: the brief's 20 a minute per
    // address, counted in Redis when it is configured so every instance shares the limit.
    app.use(
      API_V1_PREFIX,
      imageSearchRoutes({
        service: imageSearch.service,
        catalog: imageSearch.catalog,
        limiter: limiter('image-search', config.imageSearch.rateLimit),
        logger,
      }),
    );
    app.use(
      API_V1_PREFIX,
      imageSearchAdminRoutes({
        ...auth,
        store: imageSearch.store,
        provider: imageSearch.provider,
        indexer: imageSearch.indexer,
        limiter: adminLimiter,
        logger,
      }),
    );
  }
  for (const router of modules) app.use(API_V1_PREFIX, router);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
