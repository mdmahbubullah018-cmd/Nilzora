import {
  chatMyFeedbackResponseSchema,
  type ChatMyFeedbackResponse,
  bulkCourierCheckResponseSchema,
  bulkOrderStatusRequestSchema,
  bulkOrderStatusResponseSchema,
  bulkOrderSummariesResponseSchema,
  bulkShipmentBookingRequestSchema,
  bulkShipmentBookingResponseSchema,
  courierOperationsRequestSchema,
  type BulkCourierCheckResponse,
  type BulkOrderStatusRequest,
  type BulkOrderStatusResponse,
  type BulkOrderSummariesResponse,
  type BulkShipmentBookingRequest,
  type BulkShipmentBookingResponse,
  type CourierBaseUrlRequest,
  type CourierLiveVerificationRequest,
  type CourierOperationsRequest,
  bookExchangeShipmentRequestSchema,
  bookReturnPickupRequestSchema,
  bookShipmentRequestSchema,
  bookShipmentResponseSchema,
  cancelShipmentRequestSchema,
  codPositionListQuerySchema,
  codPositionListResponseSchema,
  courierCheckResponseSchema,
  courierCompareResponseSchema,
  courierConfigResponseSchema,
  courierOverviewResponseSchema,
  courierRateCardSchema,
  courierSettlementListQuerySchema,
  courierSettlementListResponseSchema,
  courierSettlementSchema,
  customerShipmentsResponseSchema,
  orderCourierContextSchema,
  recordCourierSettlementRequestSchema,
  recordPortalBookingRequestSchema,
  type RecordPortalBookingRequest,
  recordShipmentStatusResponseSchema,
  refreshShipmentResponseSchema,
  shipmentDetailResponseSchema,
  shipmentHistoryResponseSchema,
  shipmentListResponseSchema,
  shipmentSchema,
  adminShipmentListQuerySchema,
  type AdminShipmentListQuery,
  type BookExchangeShipmentRequest,
  type BookReturnPickupRequest,
  type BookShipmentRequest,
  type BookShipmentResponse,
  type CancelShipmentRequest,
  type CodPositionListQuery,
  type CodPositionListResponse,
  type CourierCheckResponse,
  type CourierCompareRequest,
  type CourierCompareResponse,
  type CourierConfigResponse,
  type CourierLocationMappingRequest,
  type CourierOverviewResponse,
  type CourierProviderId,
  type CourierProviderRequest,
  type CourierRateCard,
  type CourierRateCardRequest,
  type CourierSettingsRequest,
  type CourierSettlement,
  type CourierSettlementListQuery,
  type CourierSettlementListResponse,
  type CustomerShipmentsResponse,
  type OrderCourierContext,
  type RecordCodAdjustmentRequest,
  type RecordCodCollectedRequest,
  type RecordCourierSettlementRequest,
  type RecordShipmentStatusRequest,
  type RecordShipmentStatusResponse,
  type RefreshShipmentResponse,
  type ResolveShipmentBookingRequest,
  type SetCodStateRequest,
  type Shipment,
  type ShipmentDetailResponse,
  type ShipmentHistoryResponse,
  type ShipmentListResponse,
  addressListResponseSchema,
  addressResponseSchema,
  adminAttributesResponseSchema,
  returnListResponseSchema,
  returnResponseSchema,
  refundListResponseSchema,
  refundResponseSchema,
  myRefundsResponseSchema,
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
  avatarResponseSchema,
  reviewImageListResponseSchema,
  reviewImageUploadResponseSchema,
  adminProductVariantsResponseSchema,
  adminOrderListResponseSchema,
  adminOrderResponseSchema,
  adminProductListResponseSchema,
  adminProductResponseSchema,
  analyticsOverviewResponseSchema,
  orderGeographyResponseSchema,
  API_V1_PREFIX,
  exportJobListResponseSchema,
  exportJobResponseSchema,
  reportPreviewResponseSchema,
  mediaAssetResponseSchema,
  mediaListResponseSchema,
  slugAvailabilityResponseSchema,
  apiErrorBodySchema,
  assignRoleResponseSchema,
  auditLogResponseSchema,
  authProvidersSchema,
  authSessionSchema,
  googleSignInResponseSchema,
  googleStartResponseSchema,
  cartQuoteResponseSchema,
  checkoutQuoteResponseSchema,
  couponRedemptionListResponseSchema,
  productReviewsResponseSchema,
  myReviewSchema,
  reviewableItemsResponseSchema,
  reviewPromptResponseSchema,
  reviewVoteResponseSchema,
  reviewReplySchema,
  adminReviewListResponseSchema,
  adminCouponListResponseSchema,
  adminCouponResponseSchema,
  adminRolesResponseSchema,
  storeSettingsResponseSchema,
  adminCampaignListResponseSchema,
  adminCampaignResponseSchema,
  campaignConflictListResponseSchema,
  campaignHistoryResponseSchema,
  campaignListResponseSchema,
  campaignPreviewResponseSchema,
  categoryCampaignListResponseSchema,
  categoryListResponseSchema,
  customerListResponseSchema,
  customerResponseSchema,
  dashboardResponseSchema,
  deliveryChargeListResponseSchema,
  deliveryChargeResponseSchema,
  deviceAnnouncementPreferenceResponseSchema,
  deviceRegistrationResponseSchema,
  discoveryResponseSchema,
  healthResponseSchema,
  inventoryMovementListResponseSchema,
  meResponseSchema,
  domainEventCursorResponseSchema,
  domainEventListResponseSchema,
  twoFactorEnrollResponseSchema,
  twoFactorRecoveryCodesResponseSchema,
  twoFactorRecoveryUsedResponseSchema,
  twoFactorStatusResponseSchema,
  moderationReviewerListResponseSchema,
  moderationTaskListResponseSchema,
  moderationTaskResponseSchema,
  productImageListResponseSchema,
  productImageUploadResponseSchema,
  productVideoListResponseSchema,
  voucherListResponseSchema,
  broadcastCreatedResponseSchema,
  pushSettingsSchema,
  type PushSettings,
  type SavePushSettingsRequest,
  broadcastListResponseSchema,
  type BroadcastCreatedResponse,
  type BroadcastListResponse,
  type BroadcastRequest,
  orderInternalResponseSchema,
  type OrderArchiveRequest,
  type OrderInternalResponse,
  voucherResponseSchema,
  type VoucherListResponse,
  type VoucherResponse,
  type ProductVideoContentType,
  type ProductVideoListResponse,
  type ReorderProductVideosRequest,
  orderListResponseSchema,
  orderResponseSchema,
  placeOrderResponseSchema,
  productListResponseSchema,
  productFacetsResponseSchema,
  productResponseSchema,
  registerResponseSchema,
  salesOverviewResponseSchema,
  salesTargetResponseSchema,
  INVITABLE_ROLES,
  staffInvitationListResponseSchema,
  staffInvitationPreviewSchema,
  staffInvitationResendResponseSchema,
  staffInvitationSentResponseSchema,
  staffListResponseSchema,
  staffMemberResponseSchema,
  type AcceptInvitationRequest,
  type AddressInput,
  type AddressListResponse,
  type AddressResponse,
  type AdminCategoryListResponse,
  type AdminCategoryResponse,
  type AdminRolesResponse,
  type SaveStoreSettingsRequest,
  type StoreSettingsResponse,
  type AvatarResponse,
  type ReviewImageListResponse,
  type ReviewImageUploadResponse,
  type AdminOrderListQuery,
  type AdminOrderListResponse,
  type AdminOrderResponse,
  type AdminProductListQuery,
  type AdminProductListResponse,
  type AdminProductResponse,
  type AnalyticsOverviewQuery,
  type AnalyticsOverviewResponse,
  type OrderGeographyQuery,
  type OrderGeographyResponse,
  type CreateExportRequest,
  type ExportJobListResponse,
  type ExportJobResponse,
  type ReportExportQuery,
  type ReportKind,
  type ReportPreviewQuery,
  type ReportPreviewResponse,
  type MediaAssetResponse,
  type MediaListQuery,
  type MediaListResponse,
  type SlugAvailabilityQuery,
  type SlugAvailabilityResponse,
  type UpdateMediaRequest,
  type AssignRoleRequest,
  type AssignRoleResponse,
  type AuditLogQuery,
  type AuditLogResponse,
  type AuthProviders,
  type AuthSession,
  type CancelOrderRequest,
  type CartItem,
  type CartQuoteResponse,
  type CategoryInput,
  type CategoryReorderInput,
  type CategoryListResponse,
  type CheckoutQuoteRequest,
  type CheckoutQuoteResponse,
  type CouponRedemptionListResponse,
  type ProductReviewsResponse,
  type ProductReviewQuery,
  type MyReview,
  type ReviewSubmitRequest,
  type ReviewReply,
  type ReviewReplyRequest,
  type ReviewVoteRequest,
  type ReviewVoteResponse,
  type ReviewableItemsResponse,
  type ReviewPromptResponse,
  type AdminReviewListQuery,
  type AdminReviewListResponse,
  type ReviewModerationRequest,
  type CouponSaveRequest,
  type AdminCouponListQuery,
  type AdminCouponListResponse,
  type AdminCouponResponse,
  type AdminCampaignListQuery,
  type AdminCampaignListResponse,
  type AdminCampaignProductsQuery,
  type AdminCampaignResponse,
  type CampaignConflictListResponse,
  type CampaignHistoryQuery,
  type CampaignHistoryResponse,
  type CampaignListResponse,
  type CampaignPreviewRequest,
  type CampaignPreviewResponse,
  type CampaignSaveRequest,
  type CampaignStatusRequest,
  type CategoryCampaignListResponse,
  type CodCollectionRequest,
  type CreateProductRequest,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerResponse,
  type CustomerStatusRequest,
  type DashboardResponse,
  type DeliveryChargeListResponse,
  type DeliveryChargeRequest,
  type DeliveryChargeResponse,
  type DeliveryZone,
  type DeviceAnnouncementPreferenceRequest,
  type DeviceAnnouncementPreferenceResponse,
  type DiscoveryResponse,
  type DeviceRegistrationRequest,
  type DeviceRegistrationResponse,
  type DeviceRemovalRequest,
  type HealthResponse,
  type InventoryMovementListQuery,
  type InventoryMovementListResponse,
  type ForgotPasswordRequest,
  type GoogleCallbackRequest,
  type GoogleIdTokenRequest,
  type GoogleSignInResponse,
  type GoogleStartResponse,
  type LoginRequest,
  type MeResponse,
  type DomainEventListResponse,
  type TwoFactorEnrollResponse,
  type TwoFactorRecoveryCodesResponse,
  type TwoFactorStatusResponse,
  type ModerationAssignmentRequest,
  type ModerationDecisionRequest,
  type ModerationListQuery,
  type ModerationReviewerListResponse,
  type ModerationTaskListResponse,
  type ModerationTaskResponse,
  type ModeratorQueueQuery,
  type OrderListQuery,
  type OrderListResponse,
  type OrderResponse,
  type OrderStatusChangeRequest,
  type PermissionOverrideRequest,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
  type ProductFacetsQuery,
  type ProductFacetsResponse,
  type ProductListQuery,
  type ProductListResponse,
  type ProductResponse,
  type ProductStatusRequest,
  type RegisterRequest,
  type RegisterResponse,
  type ResendOtpRequest,
  type ResetPasswordRequest,
  type SalesOverviewQuery,
  type SalesOverviewResponse,
  type SalesTargetRequest,
  type SalesTargetResponse,
  type VerifyOtpRequest,
  type StaffInvitationRequest,
  type StaffInvitationResendResponse,
  type StaffInvitationSentResponse,
  type StaffInvitationListResponse,
  type StaffInvitationPreview,
  type AcceptStaffInvitationRequest,
  type InvitableRole,
  type StaffListResponse,
  type StaffMemberResponse,
  type ProductImageContentType,
  type ProductImageListResponse,
  type ProductImageUploadResponse,
  type ReorderProductImagesRequest,
  type StockAdjustmentRequest,
  type UpdateProductImageRequest,
  type UpdateProductRequest,
  type UpdateProfileRequest,
  type AdminAdjustVariantStockRequest,
  type AdminSetVariantStockRequest,
  type AdminAttributesResponse,
  type AdminProductVariantsResponse,
  type AdminSaveAttributeRequest,
  type AdminSaveAttributeValueRequest,
  type AdminSaveVariantRequest,
  type AdminRefundListQuery,
  type AdminReturnListQuery,
  type MyRefundsResponse,
  type RefundCompletionRequest,
  type RefundDecisionRequest,
  type RefundListResponse,
  type RefundRequest,
  type RefundResponse,
  type ReturnDecisionRequest,
  type ReturnListResponse,
  type ReturnRequest,
  type ReturnResponse,
  cartResponseSchema,
  wishlistResponseSchema,
  type WishlistResponse,
  checkoutSessionResponseSchema,
  checkoutListResponseSchema,
  checkoutResponseSchema,
  checkoutRecoveryLinkResponseSchema,
  checkoutRecoveryMetricsResponseSchema,
  checkoutRecoveryPreviewSchema,
  checkoutRecoveryRestoreResponseSchema,
  recordCheckoutAttemptRequestSchema,
  setCheckoutRecoveryStateRequestSchema,
  adminCheckoutListQuerySchema,
  type CartResponse,
  type CartSetItemRequest,
  type CheckoutStartRequest,
  type CheckoutSessionResponse,
  type AdminCheckoutListQuery,
  type CheckoutListResponse,
  type CheckoutResponse,
  type CheckoutRecoveryChannel,
  type CheckoutRecoveryLink,
  type CheckoutRecoveryMetrics,
  type CheckoutRecoveryPreview,
  type CheckoutRecoveryState,
  type CheckoutRecoveryRestore,
  type GuestCartSetItemRequest,
  seoMetadataResponseSchema,
  seoOverviewResponseSchema,
  sitemapResponseSchema,
  storeProfileResponseSchema,
  adminHomepageResponseSchema,
  adminSitePageListResponseSchema,
  adminSitePageResponseSchema,
  homepageResponseSchema,
  menuItemListResponseSchema,
  menuItemResponseSchema,
  navigationResponseSchema,
  sitePageResponseSchema,
  type AdminHomepageResponse,
  type AdminSitePageListResponse,
  type AdminSitePageResponse,
  type HomepageResponse,
  type MenuItemListResponse,
  type MenuItemResponse,
  type NavigationResponse,
  type ReorderBannersRequest,
  type ReorderMenuRequest,
  type SaveHomepageRequest,
  type SaveMenuItemRequest,
  type SitePageResponse,
  type SitePageSlug,
  type SaveSitePageRequest,
  staffNotificationListResponseSchema,
  unreadNotificationCountSchema,
  customerNotificationListResponseSchema,
  customerNotificationsDeletedSchema,
  customerUnreadCountSchema,
  notificationPreferencesResponseSchema,
  type SeoKind,
  type SeoMetadataResponse,
  type SeoOverviewQuery,
  type SeoOverviewResponse,
  type SitemapResponse,
  type StoreProfileResponse,
  type SaveSeoRequest,
  type SaveStoreProfileRequest,
  type StaffNotificationListResponse,
  type StaffNotificationQuery,
  type UnreadNotificationCount,
  type CustomerNotificationListResponse,
  type CustomerNotificationsDeleted,
  type CustomerNotificationQuery,
  type CustomerUnreadCount,
  type NotificationPreferencesPatch,
  type NotificationPreferencesResponse,
  customerInsightListResponseSchema,
  type CustomerInsightListResponse,
  type CustomerInsightQuery,
  onboardingResponseSchema,
  onboardingCampaignListResponseSchema,
  onboardingCampaignResponseSchema,
  onboardingSlideResponseSchema,
  onboardingPreviewResponseSchema,
  type OnboardingResponse,
  type OnboardingCampaignListResponse,
  type OnboardingCampaignResponse,
  type OnboardingSlideResponse,
  type OnboardingPreviewResponse,
  type SaveOnboardingCampaignRequest,
  type SaveOnboardingSlideRequest,
  popupResponseSchema,
  adminPopupListResponseSchema,
  adminPopupResponseSchema,
  type PopupResponse,
  type AdminPopupListResponse,
  type AdminPopupResponse,
  type SavePopupRequest,
  type PopupArtworkContentType,
} from '@nilzora/contracts';
import {
  adminBannerListResponseSchema,
  adminBannerResponseSchema,
  adminBrandListResponseSchema,
  adminBrandResponseSchema,
  bannerListResponseSchema,
  brandListResponseSchema,
  brandLookupResponseSchema,
  brandProductsResponseSchema,
  productBrandResponseSchema,
  type AdminBannerListResponse,
  type AdminBannerResponse,
  type AdminBrandListResponse,
  type AdminBrandResponse,
  type BannerInput,
  type BannerListQuery,
  type BannerListResponse,
  type BrandInput,
  type BrandListResponse,
  type BrandLookupResponse,
  type BrandProductsQuery,
  type BrandProductsResponse,
} from '@nilzora/contracts';
import {
  adminCategoryZonesSchema,
  adminProductZonesSchema,
  adminShoppingZoneListResponseSchema,
  adminShoppingZoneResponseSchema,
  shoppingZonesResponseSchema,
  type AdminCategoryZones,
  type AdminProductZones,
  type AdminSaveShoppingZoneRequest,
  type AdminShoppingZoneListQuery,
  type AdminShoppingZoneListResponse,
  type AdminShoppingZoneResponse,
  type ShoppingZonesResponse,
} from '@nilzora/contracts';
import {
  chatConversationListResponseSchema,
  chatConversationResponseSchema,
  chatInternalNoteSchema,
  chatMessagePageSchema,
  chatNotesResponseSchema,
  chatReportResponseSchema,
  chatSocketTicketSchema,
  chatTeamResponseSchema,
  chatUnreadCountSchema,
  sendChatMessageResponseSchema,
  type AssignChatRequest,
  type ChatAnalytics,
  type ChatAnalyticsQuery,
  type ChatAttachmentUpload,
  type ChatAutomationPreview,
  type ChatAutomationRulesResponse,
  type ChatAutomationRunsResponse,
  type ChatConversationDetail,
  type ChatConversationListQuery,
  type ChatConversationListResponse,
  type ChatConversationResponse,
  type ChatConversationStatus,
  type ChatQueueQuery,
  type ChatTeamResponse,
  type ChatCsatResponse,
  type ChatInternalChannelsResponse,
  type ChatInternalNote,
  type ChatMessagePage,
  type ChatNotesResponse,
  type ChatPriority,
  type ChatPinnedMessagesResponse,
  type ChatReactionResponse,
  type ChatReactionSummaryResponse,
  type ChatReportDecideResponse,
  type ChatReportQueueResponse,
  type ChatReportResponse,
  type ChatSavedRepliesResponse,
  type ChatSearchResponse,
  type ChatMessageFeedback,
  type ChatMessageFeedbackResponse,
  type ChatSocketTicket,
  type ChatTagsResponse,
  type ChatTemplate,
  type ChatTemplatesResponse,
  type ChatUnreadCount,
  type DecideChatReport,
  type PostedChatMessage,
  type PostChatMessage,
  type PreviewChatAutomationRule,
  type RenderedChatTemplate,
  type RenderChatTemplate,
  type ReportChatMessageRequest,
  type SaveChatAutomationRule,
  type SaveChatSavedReply,
  type SaveChatTag,
  type SaveChatTemplate,
  type SendChatMessageRequest,
  type SendChatMessageResponse,
  type StartChatConversationRequest,
  type StartInternalChat,
  type SubmitChatCsat,
  type SubmitChatMessageFeedback,
} from '@nilzora/contracts';
import {
  chatAnalyticsSchema,
  chatAttachmentUploadSchema,
  chatAutomationPreviewSchema,
  chatAutomationRulesResponseSchema,
  chatAutomationRunsResponseSchema,
  chatConversationDetailSchema,
  chatCsatResponseSchema,
  chatMessageFeedbackResponseSchema,
  chatMessageFeedbackSchema,
  chatInternalChannelsResponseSchema,
  chatPinnedMessagesResponseSchema,
  chatReactionResponseSchema,
  chatReactionSummaryResponseSchema,
  chatReportDecisionSchema,
  chatReportQueueResponseSchema,
  chatSavedRepliesResponseSchema,
  chatSearchResponseSchema,
  chatTagsResponseSchema,
  chatTemplateSchema,
  chatTemplatesResponseSchema,
  postedChatMessageSchema,
  renderedChatTemplateSchema,
} from '@nilzora/contracts';
import { z, type ZodType } from 'zod';
import {
  imageSearchActivityResponseSchema,
  imageSearchJobSchema,
  imageSearchMissingImagesResponseSchema,
  imageSearchResponseSchema,
  imageSearchSettingsSchema,
  imageSearchStatsSchema,
  scanResolveResponseSchema,
  type ImageSearchActivityQuery,
  type ImageSearchActivityResponse,
  type ImageSearchClickRequest,
  type ImageSearchJob,
  type ImageSearchMissingImagesQuery,
  type ImageSearchMissingImagesResponse,
  type ImageSearchQuery,
  type ImageSearchResponse,
  type ImageSearchSettings,
  type ImageSearchSimilarRequest,
  type ImageSearchStats,
  type SaveImageSearchSettingsRequest,
  type ScanResolveRequest,
  type ScanResolveResponse,
  type StartImageSearchJobRequest,
} from '@nilzora/contracts';

/** Raised for every failed call; `code` is the API's error code when it sent one. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  /**
   * The API's `error.details`, when it sent any: validation issues, the cart lines
   * behind a stock refusal (`problems`), or the current total of `price_changed`.
   */
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    options?: ErrorOptions & { details?: unknown },
  ) {
    super(message, options);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = options?.details;
  }
}

export interface ApiClientOptions {
  /** Origin of the Nilzora API, e.g. http://localhost:4000 */
  baseUrl: string;
  /** Custom fetch implementation (tests, server-side instrumentation). */
  fetch?: typeof fetch;
  /** Abort calls that take longer than this. Defaults to 10 seconds. */
  timeoutMs?: number;
}

/** The picture a visual search sends: a browser Blob, or a React Native file descriptor. */
export type ImageUpload = Blob | { uri: string; name: string; type: string };

/** A downloaded file (an export or an order document). */
export interface DownloadedFile {  bytes: Uint8Array;
  /** From Content-Disposition; a fallback name when the server gave none. */
  fileName: string;
  contentType: string;
}

/** Exports and documents can take a while to build. */
export const FILE_DOWNLOAD_TIMEOUT_MS = 60_000;

export interface CallOptions {
  signal?: AbortSignal;
}

/** Re-encoding and storing an image takes longer than an ordinary call. */
export const IMAGE_UPLOAD_TIMEOUT_MS = 30_000;
/** An image search embeds the picture, so it gets longer still than a plain upload. */
export const IMAGE_SEARCH_TIMEOUT_MS = 45_000;
/** A video can be up to 40 MB, so its upload gets longer. */
export const VIDEO_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Typed calls to the Nilzora API. The client holds no session: callers keep the
 * tokens (see the auth contract for where) and pass the access token per call.
 */
export interface ApiClient {
  getHealth(init?: RequestInit): Promise<HealthResponse>;
  /** Resolves with the same answer whether or not the email is already registered. */
  register(body: RegisterRequest, options?: CallOptions): Promise<RegisterResponse>;
  login(body: LoginRequest, options?: CallOptions): Promise<AuthSession>;
  /**
   * Redeems the six-digit code emailed at sign-up. Answers a session: verifying the
   * address is what completes registration, so the visitor is signed in straight away.
   */
  verifyOtp(body: VerifyOtpRequest, options?: CallOptions): Promise<AuthSession>;
  /** Re-sends the sign-up code. Answers 202 whether or not the address has an account. */
  resendOtp(body: ResendOtpRequest, options?: CallOptions): Promise<RegisterResponse>;
  /** Emails a reset code. Answers 202 whether or not the address has an account. */
  forgotPassword(body: ForgotPasswordRequest, options?: CallOptions): Promise<RegisterResponse>;
  /** Sets a new password from a reset code and revokes every existing session. */
  resetPassword(body: ResetPasswordRequest, options?: CallOptions): Promise<void>;
  /** Which social providers this deployment can offer, so the UI can hide the rest. */
  authProviders(options?: CallOptions): Promise<AuthProviders>;
  /** The Google URL to send the browser to, carrying a signed state and PKCE challenge. */
  googleStart(returnTo: string, options?: CallOptions): Promise<GoogleStartResponse>;
  /**
   * Redeems a Google callback server-side: the code and state never leave the server that
   * received them, and the returned session becomes that app's own HttpOnly cookies.
   */
  completeGoogle(body: GoogleCallbackRequest, options?: CallOptions): Promise<GoogleSignInResponse>;
  /**
   * Native apps: exchanges the ID token Google Identity Services issued to the app for a
   * Nilzora session. The API verifies the token; nothing in it is trusted as sent.
   */
  completeGoogleIdToken(body: GoogleIdTokenRequest, options?: CallOptions): Promise<AuthSession>;
  /** Confirms an address with the one-time hash from its confirmation email; signs nobody in. */
  confirmEmail(tokenHash: string, options?: CallOptions): Promise<void>;
  /** Refresh tokens rotate: store the returned pair, the old refresh token stops working. */
  refresh(refreshToken: string, options?: CallOptions): Promise<AuthSession>;
  /** Ends the session server-side; its refresh token is revoked too. */
  logout(accessToken: string, options?: CallOptions): Promise<void>;
  getMe(accessToken: string, options?: CallOptions): Promise<MeResponse>;
  /** The caller's domain events after a cursor (missed-event recovery after a reconnect). */
  myEvents(
    accessToken: string,
    after: number,
    limit?: number,
    options?: CallOptions,
  ): Promise<DomainEventListResponse>;
  /** The newest event seq: where a fresh client starts listening. */
  myEventsCursor(accessToken: string, options?: CallOptions): Promise<{ cursor: number }>;
  /** The caller's two-factor state (accounts that must use 2FA). */
  twoFactorStatus(accessToken: string, options?: CallOptions): Promise<TwoFactorStatusResponse>;
  /** Starts enrollment; the secret is returned once. `password` re-authenticates. */
  twoFactorEnroll(
    accessToken: string,
    password: string | undefined,
    options?: CallOptions,
  ): Promise<TwoFactorEnrollResponse>;
  /** Confirms enrollment with the first code; returns the ten recovery codes once. */
  twoFactorActivate(
    accessToken: string,
    code: string,
    options?: CallOptions,
  ): Promise<TwoFactorRecoveryCodesResponse>;
  /** Passes 2FA for this session. */
  twoFactorVerify(accessToken: string, code: string, options?: CallOptions): Promise<void>;
  /** Passes 2FA for this session with one recovery code (single use). */
  twoFactorRecover(
    accessToken: string,
    recoveryCode: string,
    options?: CallOptions,
  ): Promise<{ recoveryCodesLeft: number }>;
  /** Replaces the recovery codes (needs a current code). */
  twoFactorReplaceRecoveryCodes(
    accessToken: string,
    code: string,
    options?: CallOptions,
  ): Promise<TwoFactorRecoveryCodesResponse>;
  /** Removes 2FA after the password and a current or recovery code; enrollment is then required again. */
  twoFactorReset(
    accessToken: string,
    body: { password?: string | undefined; code: string },
    options?: CallOptions,
  ): Promise<void>;
  updateMe(
    accessToken: string,
    body: UpdateProfileRequest,
    options?: CallOptions,
  ): Promise<MeResponse>;

  // Catalog and cart: public, no session needed.
  listCategories(options?: CallOptions): Promise<CategoryListResponse>;
  /**
   * The ranked sections the search page shows before anyone types. Only sections the store's
   * own orders, wishlist saves and approved reviews support are returned.
   */
  discovery(options?: CallOptions): Promise<DiscoveryResponse>;
  /**
   * The promotional campaigns a shopper may see: live, visible, and reaching at least one
   * published product. The prices they set are already in every product payload; this is
   * for banners. With a category slug, only campaigns reaching that category.
   */
  listCampaigns(
    query?: { category?: string },
    options?: CallOptions,
  ): Promise<CampaignListResponse>;
  listProducts(query?: ProductListQuery, options?: CallOptions): Promise<ProductListResponse>;
  /**
   * The sizes and colours the listing context is actually sold in (GET /catalog/product-facets).
   * Empty lists mean there is nothing to offer, never an error.
   */
  productFacets(
    query?: ProductFacetsQuery,
    options?: CallOptions,
  ): Promise<ProductFacetsResponse>;
  /** The active shopping zones, in display order, banner already resolved (GET /catalog/shopping-zones). */
  shoppingZones(options?: CallOptions): Promise<ShoppingZonesResponse>;
  getProduct(slug: string, options?: CallOptions): Promise<ProductResponse>;
  listBrands(options?: CallOptions): Promise<BrandListResponse>;
  /** An active brand, or the slug a former brand address moved to. 404 when neither. */
  getBrand(slug: string, options?: CallOptions): Promise<BrandLookupResponse>;
  listBrandProducts(
    slug: string,
    query?: BrandProductsQuery,
    options?: CallOptions,
  ): Promise<BrandProductsResponse>;
  /** Banners the database considers on show for a placement (and category). */
  listBanners(query: BannerListQuery, options?: CallOptions): Promise<BannerListResponse>;
  /** Prices a cart from the live catalog. Only product ids and quantities are sent. */
  quoteCart(items: CartItem[], options?: CallOptions): Promise<CartQuoteResponse>;

  // Checkout, addresses and orders: the signed-in customer's own data.
  /** Prices a cart delivered to one of the caller's addresses, with delivery and total. */
  quoteCheckout(
    accessToken: string,
    body: CheckoutQuoteRequest,
    options?: CallOptions,
  ): Promise<CheckoutQuoteResponse>;
  listAddresses(accessToken: string, options?: CallOptions): Promise<AddressListResponse>;
  createAddress(
    accessToken: string,
    body: AddressInput,
    options?: CallOptions,
  ): Promise<AddressResponse>;
  /** Replaces every field of one of the caller's addresses. */
  updateAddress(
    accessToken: string,
    addressId: string,
    body: AddressInput,
    options?: CallOptions,
  ): Promise<AddressResponse>;
  deleteAddress(accessToken: string, addressId: string, options?: CallOptions): Promise<void>;
  /**
   * Places a Cash-on-Delivery order. Reuse the same `idempotencyKey` when retrying one
   * checkout attempt: a repeat answers with the original order and `created: false`.
   *
   * After a `timeout`, a `network_error` or a 503 (`service_unavailable`) the order
   * may already have been saved: retry with the same body and the same
   * `idempotencyKey`, never a new one, or the customer can end up with two orders.
   */
  placeOrder(
    accessToken: string,
    body: PlaceOrderRequest,
    options?: CallOptions,
  ): Promise<PlaceOrderResponse>;
  listOrders(
    accessToken: string,
    query?: OrderListQuery,
    options?: CallOptions,
  ): Promise<OrderListResponse>;
  getOrder(accessToken: string, orderNumber: string, options?: CallOptions): Promise<OrderResponse>;
  /**
   * One of the caller's own orders as a receipt PDF: the same paper the receipt page
   * shows. A foreign order number answers 404, never 403.
   */
  orderReceiptPdf(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<DownloadedFile>;
  /**
   * Cancels one of the caller's pending orders. After a `timeout`, a `network_error` or
   * a 503 (`service_unavailable`) the cancellation may already have been saved: retry
   * for the same order number (it plays the idempotency key's part; there is no other)
   * or reload it with getOrder. A retry that finds the order already cancelled answers
   * 409 `order_not_cancellable` and changes nothing.
   */
  cancelOrder(
    accessToken: string,
    orderNumber: string,
    body?: CancelOrderRequest,
    options?: CallOptions,
  ): Promise<OrderResponse>;

  // Unified communication: conversations, messages and the support queue.
  /** Opens a thread, or continues the caller's live one of the same kind. */
  startChatConversation(
    accessToken: string,
    body: StartChatConversationRequest,
    options?: CallOptions,
  ): Promise<ChatConversationResponse>;
  /** The caller's own threads, or a support queue when their permissions allow it. */
  listChatConversations(
    accessToken: string,
    query?: Partial<ChatConversationListQuery>,
    options?: CallOptions,
  ): Promise<ChatConversationListResponse>;
  /**
   * The operator inbox: only the customer and moderation threads the caller may open, filtered,
   * sorted and paged by the API. Refused to an account outside both workspaces.
   */
  listChatQueue(
    accessToken: string,
    query?: Partial<ChatQueueQuery>,
    options?: CallOptions,
  ): Promise<ChatConversationListResponse>;
  /** Teammates who can take a conversation or join a team thread, with their workload. */
  listChatTeam(accessToken: string, options?: CallOptions): Promise<ChatTeamResponse>;
  getChatConversation(
    accessToken: string,
    conversationId: string,
    options?: CallOptions,
  ): Promise<ChatConversationResponse>;
  getChatUnreadCount(accessToken: string, options?: CallOptions): Promise<ChatUnreadCount>;
  /** One page of messages, oldest first. `before` is the previous page's `nextCursor`. */
  listChatMessages(
    accessToken: string,
    conversationId: string,
    query?: { before?: number | undefined; limit?: number | undefined },
    options?: CallOptions,
  ): Promise<ChatMessagePage>;
  /**
   * Sends a message. `clientMessageId` is the caller's own id for it: retrying with the
   * same id returns the message stored the first time instead of posting a duplicate.
   */
  sendChatMessage(
    accessToken: string,
    conversationId: string,
    body: SendChatMessageRequest,
    options?: CallOptions,
  ): Promise<SendChatMessageResponse>;
  markChatRead(
    accessToken: string,
    conversationId: string,
    seq: number,
    options?: CallOptions,
  ): Promise<ChatUnreadCount>;
  setChatStatus(
    accessToken: string,
    conversationId: string,
    status: ChatConversationStatus,
    options?: CallOptions,
  ): Promise<ChatConversationResponse>;
  assignChatConversation(
    accessToken: string,
    conversationId: string,
    body: AssignChatRequest,
    options?: CallOptions,
  ): Promise<ChatConversationResponse>;
  setChatPriority(
    accessToken: string,
    conversationId: string,
    priority: ChatPriority,
    options?: CallOptions,
  ): Promise<ChatConversationResponse>;
  /** Staff-only notes; the API refuses these to a customer. */
  listChatNotes(
    accessToken: string,
    conversationId: string,
    query?: { before?: number | undefined; limit?: number | undefined },
    options?: CallOptions,
  ): Promise<ChatNotesResponse>;
  addChatNote(
    accessToken: string,
    conversationId: string,
    body: string,
    options?: CallOptions,
  ): Promise<ChatInternalNote>;
  reportChatMessage(
    accessToken: string,
    messageId: string,
    body: ReportChatMessageRequest,
    options?: CallOptions,
  ): Promise<ChatReportResponse>;
  /**
   * A two-minute credential for opening a chat socket. Only the web apps need it: their
   * access tokens live in HttpOnly cookies the browser cannot read. 503 when realtime is
   * off on that deployment.
   */
  createChatSocketTicket(accessToken: string, options?: CallOptions): Promise<ChatSocketTicket>;

  // -------------------------------------------------------------------------
  // Phase 2: templates, saved replies, automation, analytics and review
  // -------------------------------------------------------------------------

  /** Every template; archived ones only when asked for. */
  listChatTemplates(
    accessToken: string,
    query?: { includeArchived?: boolean | undefined },
    options?: CallOptions,
  ): Promise<ChatTemplatesResponse>;
  /** Creates a template, or updates one when `id` is set. An unknown `{variable}` is a 400. */
  saveChatTemplate(
    accessToken: string,
    body: SaveChatTemplate,
    options?: CallOptions,
  ): Promise<ChatTemplate>;
  /** Archives a template; the row stays so old messages remain explainable. */
  archiveChatTemplate(
    accessToken: string,
    templateId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** Renders a template for one conversation, for an agent about to send it. */
  renderChatTemplate(
    accessToken: string,
    body: RenderChatTemplate,
    options?: CallOptions,
  ): Promise<RenderedChatTemplate>;
  /** The caller's own saved replies plus the shared ones. */
  listChatSavedReplies(
    accessToken: string,
    options?: CallOptions,
  ): Promise<ChatSavedRepliesResponse>;
  saveChatSavedReply(
    accessToken: string,
    body: SaveChatSavedReply,
    options?: CallOptions,
  ): Promise<void>;
  deleteChatSavedReply(accessToken: string, replyId: string, options?: CallOptions): Promise<void>;
  /** The tag catalogue with how many conversations carry each one. */
  listChatTags(accessToken: string, options?: CallOptions): Promise<ChatTagsResponse>;
  saveChatTag(accessToken: string, body: SaveChatTag, options?: CallOptions): Promise<void>;
  /** Replaces a conversation's whole tag set, which is what a chip editor sends. */
  setChatConversationTags(
    accessToken: string,
    conversationId: string,
    tagIds: string[],
    options?: CallOptions,
  ): Promise<void>;
  /**
   * Uploads one file as the raw request body. The key is generated server-side under the
   * conversation's own prefix, so an upload cannot be aimed at another thread. `durationMs` is
   * the recording's length and is sent only for audio.
   */
  uploadChatAttachment(
    accessToken: string,
    conversationId: string,
    fileName: string,
    body: Uint8Array,
    contentType: string,
    durationMs?: number,
    options?: CallOptions,
  ): Promise<ChatAttachmentUpload>;
  /** Drops an upload slot that was reserved but never sent. */
  discardChatAttachment(
    accessToken: string,
    attachmentId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** Posts a message and attaches the uploads it carries, in one call. */
  postChatMessage(
    accessToken: string,
    body: PostChatMessage,
    options?: CallOptions,
  ): Promise<PostedChatMessage>;
  /**
   * The bytes of one chat attachment, read with the caller's own token. Chat media is private:
   * the API checks that this account may read the conversation before it returns anything.
   */
  chatAttachmentMedia(
    accessToken: string,
    attachmentId: string,
    variant?: 'full' | 'thumb',
    options?: CallOptions,
  ): Promise<DownloadedFile>;
  /** A customer's helpful / not-helpful verdict on one support reply. */
  submitChatMessageFeedback(
    accessToken: string,
    messageId: string,
    body: SubmitChatMessageFeedback,
    options?: CallOptions,
  ): Promise<ChatMessageFeedback>;
  /** The thread's verdicts, for an account that may support it. */
  listChatMessageFeedback(
    accessToken: string,
    conversationId: string,
    options?: CallOptions,
  ): Promise<ChatMessageFeedbackResponse>;
  /** The signed-in customer's own verdicts on a thread's replies (hides answered prompts). */
  listMyChatFeedback(
    accessToken: string,
    conversationId: string,
    options?: CallOptions,
  ): Promise<ChatMyFeedbackResponse>;
  /** The customer's rating of a resolved conversation, once. */
  submitChatCsat(
    accessToken: string,
    conversationId: string,
    body: Omit<SubmitChatCsat, 'conversationId'>,
    options?: CallOptions,
  ): Promise<ChatCsatResponse>;
  /** The moderator review queue. `status: 'all'` returns every state. */
  listChatReports(
    accessToken: string,
    query?: {
      status?: 'open' | 'reviewing' | 'dismissed' | 'actioned' | 'all' | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    },
    options?: CallOptions,
  ): Promise<ChatReportQueueResponse>;
  decideChatReport(
    accessToken: string,
    body: DecideChatReport,
    options?: CallOptions,
  ): Promise<ChatReportDecideResponse>;
  /** Hides a message from a thread. Reviewers and managers only. */
  deleteChatMessage(accessToken: string, messageId: string, options?: CallOptions): Promise<void>;
  /** Pins a message to the top of its thread. */
  pinChatMessage(
    accessToken: string,
    conversationId: string,
    messageId: string,
    options?: CallOptions,
  ): Promise<void>;
  unpinChatMessage(
    accessToken: string,
    conversationId: string,
    messageId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** The caller's pinned messages in one thread, newest pin first. */
  listChatPinnedMessages(
    accessToken: string,
    conversationId: string,
    options?: CallOptions,
  ): Promise<ChatPinnedMessagesResponse>;
  /** Adds the caller's emoji reaction, or removes it if it is already there. */
  toggleChatMessageReaction(
    accessToken: string,
    conversationId: string,
    messageId: string,
    emoji: string,
    options?: CallOptions,
  ): Promise<ChatReactionResponse>;
  /** Reaction totals for a whole thread, so one call decorates a page of messages. */
  listChatReactionSummary(
    accessToken: string,
    conversationId: string,
    options?: CallOptions,
  ): Promise<ChatReactionSummaryResponse>;
  /** Opens (or continues) a staff-only conversation. */
  startInternalChat(
    accessToken: string,
    body: StartInternalChat,
    options?: CallOptions,
  ): Promise<ChatConversationDetail>;
  /** The staff-only threads the caller is in. */
  listInternalChannels(
    accessToken: string,
    query?: { limit?: number | undefined; offset?: number | undefined },
    options?: CallOptions,
  ): Promise<ChatInternalChannelsResponse>;
  /** Message search, limited to conversations the caller may read. */
  searchChatMessages(
    accessToken: string,
    query: { q: string; limit?: number | undefined },
    options?: CallOptions,
  ): Promise<ChatSearchResponse>;
  /** Volume, response times, satisfaction and automation, for a period. */
  getChatAnalytics(
    accessToken: string,
    query?: ChatAnalyticsQuery,
    options?: CallOptions,
  ): Promise<ChatAnalytics>;
  listChatAutomationRules(
    accessToken: string,
    options?: CallOptions,
  ): Promise<ChatAutomationRulesResponse>;
  saveChatAutomationRule(
    accessToken: string,
    body: SaveChatAutomationRule,
    options?: CallOptions,
  ): Promise<void>;
  setChatAutomationRuleActive(
    accessToken: string,
    ruleId: string,
    isActive: boolean,
    options?: CallOptions,
  ): Promise<void>;
  deleteChatAutomationRule(
    accessToken: string,
    ruleId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** The run log, newest first. */
  listChatAutomationRuns(
    accessToken: string,
    query?: { limit?: number | undefined; offset?: number | undefined },
    options?: CallOptions,
  ): Promise<ChatAutomationRunsResponse>;
  /** Whether a rule would fire for one conversation, without changing anything. */
  previewChatAutomationRule(
    accessToken: string,
    body: PreviewChatAutomationRule,
    options?: CallOptions,
  ): Promise<ChatAutomationPreview>;

  // Push devices: the signed-in account's own native push tokens (delivery is server-side).
  /**
   * Registers this device's push token for the signed-in account, or refreshes it (call it
   * after sign-in and whenever the platform rotates the token). A token that belonged to
   * another account moves to this one. The answer never contains the token.
   */
  registerDevice(
    accessToken: string,
    body: DeviceRegistrationRequest,
    options?: CallOptions,
  ): Promise<DeviceRegistrationResponse>;
  /**
   * Forgets the signed-in account's own token (call it before signing out). Resolves
   * whether or not the token was registered, so a repeat is harmless.
   */
  unregisterDevice(
    accessToken: string,
    body: DeviceRemovalRequest,
    options?: CallOptions,
  ): Promise<void>;
  /**
   * Turns product announcements on or off for this device. Order updates are a separate
   * choice: this never changes them, and it sends nothing itself.
   */
  setDeviceAnnouncements(
    accessToken: string,
    body: DeviceAnnouncementPreferenceRequest,
    options?: CallOptions,
  ): Promise<DeviceAnnouncementPreferenceResponse>;

  // Staff accounts. The API and the database check the caller's permissions on every
  // call; the effective list from getMe() only shapes the interface.
  /** Redeems a staff invitation link and sets the invitee's password; signs nobody in. */
  acceptInvitation(body: AcceptInvitationRequest, options?: CallOptions): Promise<void>;
  assignRole(
    accessToken: string,
    userId: string,
    body: AssignRoleRequest,
    options?: CallOptions,
  ): Promise<AssignRoleResponse>;

  // Admin catalog
  adminListProducts(
    accessToken: string,
    query?: AdminProductListQuery,
    options?: CallOptions,
  ): Promise<AdminProductListResponse>;
  adminGetProduct(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<AdminProductResponse>;
  /** Creates a draft product; it is published only after its content is approved. */
  adminCreateProduct(
    accessToken: string,
    body: CreateProductRequest,
    options?: CallOptions,
  ): Promise<AdminProductResponse>;
  adminUpdateProduct(
    accessToken: string,
    productId: string,
    body: UpdateProductRequest,
    options?: CallOptions,
  ): Promise<AdminProductResponse>;
  adminSetProductStatus(
    accessToken: string,
    productId: string,
    body: ProductStatusRequest,
    options?: CallOptions,
  ): Promise<AdminProductResponse>;
  /** Not idempotent: after a timeout or a 503, reload the product (and its ledger) before retrying. */
  adminAdjustStock(
    accessToken: string,
    productId: string,
    body: StockAdjustmentRequest,
    options?: CallOptions,
  ): Promise<AdminProductResponse>;
  /**
   * Uploads one product image as raw bytes (not JSON): the Content-Type must be one of
   * image/jpeg, image/png or image/webp; the API checks the bytes themselves. `alt` is an
   * optional description for screen readers. Not idempotent: after a timeout, reload the
   * product's images before retrying.
   */
  adminUploadProductImage(
    accessToken: string,
    productId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType; alt?: string },
    options?: CallOptions,
  ): Promise<ProductImageUploadResponse>;
  adminUpdateProductImage(
    accessToken: string,
    imageId: string,
    body: UpdateProductImageRequest,
    options?: CallOptions,
  ): Promise<ProductImageListResponse>;
  /** `imageIds` must list every image of the product exactly once. */
  adminReorderProductImages(
    accessToken: string,
    productId: string,
    body: ReorderProductImagesRequest,
    options?: CallOptions,
  ): Promise<ProductImageListResponse>;
  adminDeleteProductImage(
    accessToken: string,
    imageId: string,
    options?: CallOptions,
  ): Promise<ProductImageListResponse>;
  adminListProductVideos(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<ProductVideoListResponse>;
  /** Uploads one product video as raw MP4 or WebM bytes. Not idempotent. */
  adminUploadProductVideo(
    accessToken: string,
    productId: string,
    video: { bytes: Uint8Array; contentType: ProductVideoContentType; title?: string },
    options?: CallOptions,
  ): Promise<ProductVideoListResponse>;
  /**  must list every video of the product exactly once. */
  adminReorderProductVideos(
    accessToken: string,
    productId: string,
    body: ReorderProductVideosRequest,
    options?: CallOptions,
  ): Promise<ProductVideoListResponse>;
  adminDeleteProductVideo(
    accessToken: string,
    videoId: string,
    options?: CallOptions,
  ): Promise<ProductVideoListResponse>;
  /** Submits a draft's content for review. */
  adminSubmitProduct(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<AdminProductResponse>;
  adminListCategories(
    accessToken: string,
    options?: CallOptions,
  ): Promise<AdminCategoryListResponse>;
  adminCreateCategory(
    accessToken: string,
    body: CategoryInput,
    options?: CallOptions,
  ): Promise<AdminCategoryResponse>;
  adminUpdateCategory(
    accessToken: string,
    categoryId: string,
    body: CategoryInput,
    options?: CallOptions,
  ): Promise<AdminCategoryResponse>;
  /**
   * Deletes a category (products.publish). Resolves with nothing (204). Refused with 409
   * category_in_use while products or subcategories still belong to it, 404 not_found when
   * it no longer exists.
   */
  /**
   * Puts one group of categories (a parent's subcategories, or the top level for a null parent)
   * in the given order (products.publish). The list must name every category of the group once;
   * a stale or partial list is refused with 400 and nothing changes. Resolves with nothing (204).
   */
  adminReorderCategories(
    accessToken: string,
    body: CategoryReorderInput,
    options?: CallOptions,
  ): Promise<void>;
  adminDeleteCategory(
    accessToken: string,
    categoryId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** Deletes a product that was never ordered (409 in_use once it has orders: archive it). */
  adminDeleteProduct(accessToken: string, productId: string, options?: CallOptions): Promise<void>;
  adminListBrands(accessToken: string, options?: CallOptions): Promise<AdminBrandListResponse>;
  adminCreateBrand(
    accessToken: string,
    body: BrandInput,
    options?: CallOptions,
  ): Promise<AdminBrandResponse>;
  adminUpdateBrand(
    accessToken: string,
    brandId: string,
    body: BrandInput,
    options?: CallOptions,
  ): Promise<AdminBrandResponse>;
  adminUploadBrandLogo(
    accessToken: string,
    brandId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AdminBrandResponse>;
  adminRemoveBrandLogo(
    accessToken: string,
    brandId: string,
    options?: CallOptions,
  ): Promise<AdminBrandResponse>;
  adminUploadBrandBanner(
    accessToken: string,
    brandId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AdminBrandResponse>;
  adminRemoveBrandBanner(
    accessToken: string,
    brandId: string,
    options?: CallOptions,
  ): Promise<AdminBrandResponse>;
  /**
   * Deletes a brand that no product belongs to (409 brand_in_use otherwise); its logo
   * files go with it. Resolves with nothing (204).
   */
  adminDeleteBrand(accessToken: string, brandId: string, options?: CallOptions): Promise<void>;
  adminGetProductBrand(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<{ brandId: string | null }>;
  adminSetProductBrand(
    accessToken: string,
    productId: string,
    brandId: string | null,
    options?: CallOptions,
  ): Promise<void>;
  adminListBanners(accessToken: string, options?: CallOptions): Promise<AdminBannerListResponse>;
  adminCreateBanner(
    accessToken: string,
    body: BannerInput,
    options?: CallOptions,
  ): Promise<AdminBannerResponse>;
  adminUpdateBanner(
    accessToken: string,
    bannerId: string,
    body: BannerInput,
    options?: CallOptions,
  ): Promise<AdminBannerResponse>;
  adminUploadBannerImage(
    accessToken: string,
    bannerId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AdminBannerResponse>;
  adminDeleteBanner(accessToken: string, bannerId: string, options?: CallOptions): Promise<void>;

  /* Shopping zones: the collections the storefront and the app browse by. */
  adminListZones(
    accessToken: string,
    query?: Partial<AdminShoppingZoneListQuery>,
    options?: CallOptions,
  ): Promise<AdminShoppingZoneListResponse>;
  adminZone(
    accessToken: string,
    zoneId: string,
    options?: CallOptions,
  ): Promise<AdminShoppingZoneResponse>;
  /** Creates a zone when `zoneId` is null; answers the saved zone. */
  adminSaveZone(
    accessToken: string,
    zoneId: string | null,
    body: AdminSaveShoppingZoneRequest,
    options?: CallOptions,
  ): Promise<AdminShoppingZoneResponse>;
  adminSetZoneActive(
    accessToken: string,
    zoneId: string,
    isActive: boolean,
    options?: CallOptions,
  ): Promise<AdminShoppingZoneResponse>;
  /** Replaces the hand-picked products; answers how many are still attached. */
  adminSetZoneProducts(
    accessToken: string,
    zoneId: string,
    productIds: string[],
    options?: CallOptions,
  ): Promise<{ kept: number }>;
  /** Replaces the inherited categories; answers how many are still attached. */
  adminSetZoneCategories(
    accessToken: string,
    zoneId: string,
    categoryIds: string[],
    options?: CallOptions,
  ): Promise<{ kept: number }>;
  adminUploadZoneBanner(
    accessToken: string,
    zoneId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType; alt?: string },
    options?: CallOptions,
  ): Promise<AdminShoppingZoneResponse>;
  adminRemoveZoneBanner(
    accessToken: string,
    zoneId: string,
    options?: CallOptions,
  ): Promise<AdminShoppingZoneResponse>;
  /** Uploads the app's own artwork for a zone; the website's picture is not touched. */
  adminUploadZoneMobileBanner(
    accessToken: string,
    zoneId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AdminShoppingZoneResponse>;
  adminRemoveZoneMobileBanner(
    accessToken: string,
    zoneId: string,
    options?: CallOptions,
  ): Promise<AdminShoppingZoneResponse>;
  /** Refused with `zone_in_use` while the zone still holds products or categories. */
  adminDeleteZone(accessToken: string, zoneId: string, options?: CallOptions): Promise<void>;
  /** A product's own zones, its category's zones, and what it resolves to. */
  adminProductZones(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<AdminProductZones>;
  /** Replaces a product's pinned zones; an empty list hands it back to its category. */
  adminSetProductZones(
    accessToken: string,
    productId: string,
    zoneIds: string[],
    options?: CallOptions,
  ): Promise<{ kept: number }>;
  /** The zones a category feeds to its products. */
  adminCategoryZones(
    accessToken: string,
    categoryId: string,
    options?: CallOptions,
  ): Promise<AdminCategoryZones>;
  adminSetCategoryZones(
    accessToken: string,
    categoryId: string,
    zoneIds: string[],
    options?: CallOptions,
  ): Promise<{ kept: number }>;
  /**
   * Sets or replaces a banner's picture for small screens (POST
   * /admin/banners/:id/image?variant=mobile). The main picture is untouched.
   */
  adminUploadBannerMobileImage(
    accessToken: string,
    bannerId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AdminBannerResponse>;
  /** Removes a banner's small-screen picture (DELETE /admin/banners/:id/image?variant=mobile). */
  adminRemoveBannerMobileImage(
    accessToken: string,
    bannerId: string,
    options?: CallOptions,
  ): Promise<AdminBannerResponse>;
  /**
   * Orders the banners of one placement (and category): `ids` lists each of them exactly
   * once, first shown first. Answers every banner.
   */
  adminReorderBanners(
    accessToken: string,
    body: ReorderBannersRequest,
    options?: CallOptions,
  ): Promise<AdminBannerListResponse>;
  /** Sets or replaces a category's cover picture (POST /admin/categories/:id/image). */
  adminUploadCategoryImage(
    accessToken: string,
    categoryId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AdminCategoryResponse>;
  adminRemoveCategoryImage(
    accessToken: string,
    categoryId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** Sets or replaces a category's page banner (POST /admin/categories/:id/banner). */
  adminUploadCategoryBanner(
    accessToken: string,
    categoryId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AdminCategoryResponse>;
  adminRemoveCategoryBanner(
    accessToken: string,
    categoryId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** Sets or replaces the caller's own profile picture (customers and staff alike). */
  uploadMyAvatar(
    accessToken: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<AvatarResponse>;
  removeMyAvatar(accessToken: string, options?: CallOptions): Promise<AvatarResponse>;
  /** Attaches a photo to the caller's own pending review. */
  uploadReviewImage(
    accessToken: string,
    reviewId: string,
    image: { bytes: Uint8Array; contentType: ProductImageContentType },
    options?: CallOptions,
  ): Promise<ReviewImageUploadResponse>;
  removeReviewImage(
    accessToken: string,
    imageId: string,
    options?: CallOptions,
  ): Promise<ReviewImageListResponse>;
  adminListInventoryMovements(
    accessToken: string,
    query?: InventoryMovementListQuery,
    options?: CallOptions,
  ): Promise<InventoryMovementListResponse>;

  // Admin coupons
  adminListCoupons(
    accessToken: string,
    query?: AdminCouponListQuery,
    options?: CallOptions,
  ): Promise<AdminCouponListResponse>;
  adminGetCoupon(
    accessToken: string,
    couponId: string,
    options?: CallOptions,
  ): Promise<AdminCouponResponse>;
  adminCreateCoupon(
    accessToken: string,
    body: CouponSaveRequest,
    options?: CallOptions,
  ): Promise<AdminCouponResponse>;
  adminUpdateCoupon(
    accessToken: string,
    couponId: string,
    body: CouponSaveRequest,
    options?: CallOptions,
  ): Promise<AdminCouponResponse>;
  adminSetCouponActive(
    accessToken: string,
    couponId: string,
    isActive: boolean,
    options?: CallOptions,
  ): Promise<void>;
  /** Deletes a coupon or voucher nobody redeemed (409 in_use otherwise). */
  adminDeleteCoupon(accessToken: string, couponId: string, options?: CallOptions): Promise<void>;
  adminCouponRedemptions(
    accessToken: string,
    couponId: string,
    query?: { page?: number; pageSize?: number },
    options?: CallOptions,
  ): Promise<CouponRedemptionListResponse>;

  // Discount campaigns: promotional pricing across products, categories and brands.
  adminListCampaigns(
    accessToken: string,
    query?: AdminCampaignListQuery,
    options?: CallOptions,
  ): Promise<AdminCampaignListResponse>;
  adminGetCampaign(
    accessToken: string,
    campaignId: string,
    options?: CallOptions,
  ): Promise<AdminCampaignResponse>;
  adminCreateCampaign(
    accessToken: string,
    body: CampaignSaveRequest,
    options?: CallOptions,
  ): Promise<AdminCampaignResponse>;
  adminUpdateCampaign(
    accessToken: string,
    campaignId: string,
    body: CampaignSaveRequest,
    options?: CallOptions,
  ): Promise<AdminCampaignResponse>;
  adminSetCampaignStatus(
    accessToken: string,
    campaignId: string,
    body: CampaignStatusRequest,
    options?: CallOptions,
  ): Promise<AdminCampaignResponse>;
  adminDuplicateCampaign(
    accessToken: string,
    campaignId: string,
    options?: CallOptions,
  ): Promise<AdminCampaignResponse>;
  adminPreviewCampaign(
    accessToken: string,
    body: CampaignPreviewRequest,
    options?: CallOptions,
  ): Promise<CampaignPreviewResponse>;
  adminCampaignProducts(
    accessToken: string,
    campaignId: string,
    query?: AdminCampaignProductsQuery,
    options?: CallOptions,
  ): Promise<CampaignPreviewResponse>;
  adminCampaignConflicts(
    accessToken: string,
    campaignId: string,
    options?: CallOptions,
  ): Promise<CampaignConflictListResponse>;
  adminCampaignHistory(
    accessToken: string,
    campaignId: string,
    query?: CampaignHistoryQuery,
    options?: CallOptions,
  ): Promise<CampaignHistoryResponse>;
  adminCategoryCampaigns(
    accessToken: string,
    query?: { categoryId?: string },
    options?: CallOptions,
  ): Promise<CategoryCampaignListResponse>;

  // Product attributes and the variants that combine their values.
  adminListAttributes(accessToken: string, options?: CallOptions): Promise<AdminAttributesResponse>;
  adminSaveAttribute(
    accessToken: string,
    input: AdminSaveAttributeRequest,
    options?: CallOptions,
  ): Promise<AdminAttributesResponse>;
  adminSaveAttributeValue(
    accessToken: string,
    input: AdminSaveAttributeValueRequest,
    options?: CallOptions,
  ): Promise<AdminAttributesResponse>;
  adminProductVariants(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<AdminProductVariantsResponse>;
  adminSaveVariant(
    accessToken: string,
    productId: string,
    input: AdminSaveVariantRequest,
    options?: CallOptions,
  ): Promise<AdminProductVariantsResponse>;
  adminSetVariantActive(
    accessToken: string,
    productId: string,
    variantId: string,
    isActive: boolean,
    options?: CallOptions,
  ): Promise<AdminProductVariantsResponse>;
  adminAdjustVariantStock(
    accessToken: string,
    productId: string,
    variantId: string,
    input: AdminAdjustVariantStockRequest,
    options?: CallOptions,
  ): Promise<AdminProductVariantsResponse>;
  adminSetVariantStock(
    accessToken: string,
    productId: string,
    variantId: string,
    input: AdminSetVariantStockRequest,
    options?: CallOptions,
  ): Promise<AdminProductVariantsResponse>;
  adminDeleteVariant(
    accessToken: string,
    productId: string,
    variantId: string,
    options?: CallOptions,
  ): Promise<void>;

  // Persisted carts and checkout tracking. The guest handle is the only guest credential.
  myCart(accessToken: string, options?: CallOptions): Promise<CartResponse>;
  setCartItem(
    accessToken: string,
    input: CartSetItemRequest,
    options?: CallOptions,
  ): Promise<CartResponse>;
  clearMyCart(accessToken: string, options?: CallOptions): Promise<CartResponse>;
  startGuestCart(token: string, options?: CallOptions): Promise<CartResponse>;
  setGuestCartItem(input: GuestCartSetItemRequest, options?: CallOptions): Promise<CartResponse>;
  clearGuestCart(token: string, options?: CallOptions): Promise<void>;
  mergeGuestCart(accessToken: string, token: string, options?: CallOptions): Promise<CartResponse>;

  /* The signed-in customer's wishlist, shared by the website and the app. */
  myWishlist(accessToken: string, options?: CallOptions): Promise<WishlistResponse>;
  /** The Voucher Center; with a token, each voucher carries the caller's own state. */
  voucherCenter(accessToken?: string | null, options?: CallOptions): Promise<VoucherListResponse>;
  /** The vouchers a customer can still collect or use on one product; the token adds their own state. */
  productVouchers(
    slug: string,
    accessToken?: string | null,
    options?: CallOptions,
  ): Promise<VoucherListResponse>;
  /** The caller's collected vouchers (hidden 4 days after they end). */
  myVouchers(accessToken: string, options?: CallOptions): Promise<VoucherListResponse>;
  /** Collects a voucher; collecting again answers the same voucher. */
  collectVoucher(
    accessToken: string,
    voucherId: string,
    options?: CallOptions,
  ): Promise<VoucherResponse>;
  addToWishlist(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<WishlistResponse>;
  removeFromWishlist(
    accessToken: string,
    productId: string,
    options?: CallOptions,
  ): Promise<WishlistResponse>;
  /** Folds a guest's device-local list in; safe to call again. */
  mergeWishlist(
    accessToken: string,
    slugs: readonly string[],
    options?: CallOptions,
  ): Promise<WishlistResponse>;
  startCheckout(
    accessToken: string,
    input: CheckoutStartRequest,
    options?: CallOptions,
  ): Promise<CheckoutSessionResponse>;
  checkoutActivity(accessToken: string, sessionId: string, options?: CallOptions): Promise<void>;
  checkoutConverted(
    accessToken: string,
    sessionId: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<void>;

  /** The incomplete-checkout queue and its recovery workflow. Reads need orders.read. */
  adminListCheckouts(
    accessToken: string,
    query?: AdminCheckoutListQuery,
    options?: CallOptions,
  ): Promise<CheckoutListResponse>;
  adminGetCheckout(
    accessToken: string,
    checkoutId: string,
    options?: CallOptions,
  ): Promise<CheckoutResponse>;
  /** The abandoned-checkout summary figures for one window; the server does the arithmetic. */
  adminCheckoutMetrics(
    accessToken: string,
    query?: { from?: string; to?: string },
    options?: CallOptions,
  ): Promise<{ metrics: CheckoutRecoveryMetrics }>;
  /** Records that staff contacted the customer. Nothing is sent: this is the record. */
  adminRecordCheckoutAttempt(
    accessToken: string,
    checkoutId: string,
    input: { channel: CheckoutRecoveryChannel; note?: string },
    options?: CallOptions,
  ): Promise<CheckoutResponse>;
  adminSetCheckoutRecoveryState(
    accessToken: string,
    checkoutId: string,
    state: CheckoutRecoveryState,
    options?: CallOptions,
  ): Promise<CheckoutResponse>;
  /** Mints a single-use link. The token is in this answer only, and is never readable again. */
  adminCreateCheckoutRecoveryLink(
    accessToken: string,
    checkoutId: string,
    options?: CallOptions,
  ): Promise<CheckoutRecoveryLink>;
  adminRevokeCheckoutRecoveryLink(
    accessToken: string,
    checkoutId: string,
    options?: CallOptions,
  ): Promise<CheckoutResponse>;
  /** Public: the link is the capability and the answer carries no personal data. */
  previewCheckoutRecovery(token: string, options?: CallOptions): Promise<CheckoutRecoveryPreview>;
  /** Puts the saved lines back into the signed-in owner's cart. */
  restoreCheckoutRecovery(
    accessToken: string,
    token: string,
    options?: CallOptions,
  ): Promise<CheckoutRecoveryRestore>;

  // SEO, the store profile, the staff inbox and customer insight.
  publicStoreProfile(options?: CallOptions): Promise<StoreProfileResponse>;
  /** A published static page; 404 not_found for a draft, an unwritten or an unknown page. */
  publicSitePage(slug: SitePageSlug, options?: CallOptions): Promise<SitePageResponse>;
  /** The active navigation links and the published pages (empty lists when none are set up). */
  publicNavigation(options?: CallOptions): Promise<NavigationResponse>;
  /** The enabled homepage sections in order; empty means "use the built-in homepage". */
  publicHomepage(options?: CallOptions): Promise<HomepageResponse>;
  /** Static pages, written or not (settings.manage). */
  adminListSitePages(
    accessToken: string,
    options?: CallOptions,
  ): Promise<AdminSitePageListResponse>;
  adminSaveSitePage(
    accessToken: string,
    slug: SitePageSlug,
    body: SaveSitePageRequest,
    options?: CallOptions,
  ): Promise<AdminSitePageResponse>;
  /** Navigation links of every menu (settings.manage). */
  adminListMenuItems(accessToken: string, options?: CallOptions): Promise<MenuItemListResponse>;
  adminCreateMenuItem(
    accessToken: string,
    body: SaveMenuItemRequest,
    options?: CallOptions,
  ): Promise<MenuItemResponse>;
  adminUpdateMenuItem(
    accessToken: string,
    itemId: string,
    body: SaveMenuItemRequest,
    options?: CallOptions,
  ): Promise<MenuItemResponse>;
  adminDeleteMenuItem(accessToken: string, itemId: string, options?: CallOptions): Promise<void>;
  /** Orders one menu: `ids` lists each of its links exactly once. */
  adminReorderMenu(
    accessToken: string,
    body: ReorderMenuRequest,
    options?: CallOptions,
  ): Promise<MenuItemListResponse>;
  /** Every homepage section with its state and order (settings.manage). */
  adminGetHomepage(accessToken: string, options?: CallOptions): Promise<AdminHomepageResponse>;
  /** Saves every section at once, in the order to show them. */
  adminSaveHomepage(
    accessToken: string,
    body: SaveHomepageRequest,
    options?: CallOptions,
  ): Promise<AdminHomepageResponse>;
  publicSeo(kind: SeoKind, slug: string, options?: CallOptions): Promise<SeoMetadataResponse>;
  sitemap(options?: CallOptions): Promise<SitemapResponse>;
  adminSeoOverview(
    accessToken: string,
    query?: SeoOverviewQuery,
    options?: CallOptions,
  ): Promise<SeoOverviewResponse>;
  saveProductSeo(
    accessToken: string,
    productId: string,
    input: SaveSeoRequest,
    options?: CallOptions,
  ): Promise<void>;
  saveCategorySeo(
    accessToken: string,
    categoryId: string,
    input: SaveSeoRequest,
    options?: CallOptions,
  ): Promise<void>;
  adminStoreProfile(accessToken: string, options?: CallOptions): Promise<StoreProfileResponse>;
  saveStoreProfile(
    accessToken: string,
    input: SaveStoreProfileRequest,
    options?: CallOptions,
  ): Promise<StoreProfileResponse>;
  staffNotifications(
    accessToken: string,
    query?: StaffNotificationQuery,
    options?: CallOptions,
  ): Promise<StaffNotificationListResponse>;
  unreadNotifications(accessToken: string, options?: CallOptions): Promise<UnreadNotificationCount>;
  markNotificationRead(
    accessToken: string,
    notificationId: string,
    options?: CallOptions,
  ): Promise<void>;
  markAllNotificationsRead(
    accessToken: string,
    options?: CallOptions,
  ): Promise<UnreadNotificationCount>;
  /** The signed-in customer's own notification history (GET /me/notifications). */
  myNotifications(
    accessToken: string,
    query?: CustomerNotificationQuery,
    options?: CallOptions,
  ): Promise<CustomerNotificationListResponse>;
  myUnreadNotifications(accessToken: string, options?: CallOptions): Promise<CustomerUnreadCount>;
  markMyNotificationRead(
    accessToken: string,
    notificationId: string,
    options?: CallOptions,
  ): Promise<void>;
  markAllMyNotificationsRead(
    accessToken: string,
    options?: CallOptions,
  ): Promise<CustomerUnreadCount>;
  /** Deletes some of the account's own notification-centre entries (never anyone else's). */
  deleteMyNotifications(
    accessToken: string,
    ids: readonly string[],
    options?: CallOptions,
  ): Promise<CustomerNotificationsDeleted>;
  /** Clears the account's whole notification centre as of `before`. */
  clearMyNotifications(
    accessToken: string,
    before: string,
    options?: CallOptions,
  ): Promise<CustomerNotificationsDeleted>;
  /** What the account wants to be told (GET /me/notification-preferences). */
  notificationPreferences(
    accessToken: string,
    options?: CallOptions,
  ): Promise<NotificationPreferencesResponse>;
  /** Saves the account's choices; a field left out keeps its value. */
  saveNotificationPreferences(
    accessToken: string,
    patch: NotificationPreferencesPatch,
    options?: CallOptions,
  ): Promise<NotificationPreferencesResponse>;
  /** The moderator workspace's inbox: the same rows, gated by the moderator permission. */
  moderatorNotifications(
    accessToken: string,
    query?: StaffNotificationQuery,
    options?: CallOptions,
  ): Promise<StaffNotificationListResponse>;
  moderatorUnreadNotifications(
    accessToken: string,
    options?: CallOptions,
  ): Promise<UnreadNotificationCount>;
  markModeratorNotificationRead(
    accessToken: string,
    notificationId: string,
    options?: CallOptions,
  ): Promise<void>;
  markAllModeratorNotificationsRead(
    accessToken: string,
    options?: CallOptions,
  ): Promise<UnreadNotificationCount>;
  adminCustomerInsights(
    accessToken: string,
    query?: CustomerInsightQuery,
    options?: CallOptions,
  ): Promise<CustomerInsightListResponse>;

  // Onboarding and promotional campaigns.
  /**
   * The campaign this caller may see right now. `accessToken` is optional on purpose: a
   * guest receives guest-eligible campaigns, a signed-in customer receives theirs (and not
   * one they have already finished).
   */
  publicOnboarding(accessToken?: string | null, options?: CallOptions): Promise<OnboardingResponse>;
  completeOnboarding(accessToken: string, campaignId: string, options?: CallOptions): Promise<void>;
  adminOnboardingCampaigns(
    accessToken: string,
    options?: CallOptions,
  ): Promise<OnboardingCampaignListResponse>;
  adminOnboardingCampaign(
    accessToken: string,
    campaignId: string,
    options?: CallOptions,
  ): Promise<OnboardingCampaignResponse>;
  createOnboardingCampaign(
    accessToken: string,
    input: SaveOnboardingCampaignRequest,
    options?: CallOptions,
  ): Promise<OnboardingCampaignResponse>;
  updateOnboardingCampaign(
    accessToken: string,
    campaignId: string,
    input: SaveOnboardingCampaignRequest,
    options?: CallOptions,
  ): Promise<OnboardingCampaignResponse>;
  deleteOnboardingCampaign(
    accessToken: string,
    campaignId: string,
    options?: CallOptions,
  ): Promise<void>;
  setOnboardingCampaignActive(
    accessToken: string,
    campaignId: string,
    active: boolean,
    options?: CallOptions,
  ): Promise<void>;
  previewOnboardingCampaign(
    accessToken: string,
    campaignId: string,
    options?: CallOptions,
  ): Promise<OnboardingPreviewResponse>;
  createOnboardingSlide(
    accessToken: string,
    campaignId: string,
    input: SaveOnboardingSlideRequest,
    options?: CallOptions,
  ): Promise<OnboardingSlideResponse>;
  updateOnboardingSlide(
    accessToken: string,
    campaignId: string,
    slideId: string,
    input: SaveOnboardingSlideRequest,
    options?: CallOptions,
  ): Promise<OnboardingSlideResponse>;
  deleteOnboardingSlide(
    accessToken: string,
    campaignId: string,
    slideId: string,
    options?: CallOptions,
  ): Promise<void>;
  reorderOnboardingSlides(
    accessToken: string,
    campaignId: string,
    slideIds: readonly string[],
    options?: CallOptions,
  ): Promise<void>;

  // The promotional popup: one customer-facing read, and the staff management of it.
  /**
   * The one popup a customer may be shown right now, or `null`. Taking no token is deliberate:
   * the answer is the same for every visitor, and the client decides whether it has already
   * been shown on this device.
   */
  publicPopup(options?: CallOptions): Promise<PopupResponse>;
  /** Every popup live on one platform, best first (GET /popups?platform=). */
  publicPopups(platform: 'website' | 'app', options?: CallOptions): Promise<PopupResponse>;
  adminPopups(accessToken: string, options?: CallOptions): Promise<AdminPopupListResponse>;
  adminPopup(
    accessToken: string,
    popupId: string,
    options?: CallOptions,
  ): Promise<AdminPopupResponse>;
  /** Creates a popup when `popupId` is null; answers the saved popup. */
  savePopup(
    accessToken: string,
    popupId: string | null,
    input: SavePopupRequest,
    options?: CallOptions,
  ): Promise<AdminPopupResponse>;
  setPopupActive(
    accessToken: string,
    popupId: string,
    active: boolean,
    options?: CallOptions,
  ): Promise<void>;
  /**
   * Uploads the artwork (a JPEG, PNG, WebP or animated GIF). The bytes decide the format; an
   * animated GIF is kept exactly as uploaded.
   */
  uploadPopupArtwork(
    accessToken: string,
    popupId: string,
    image: { bytes: Uint8Array; contentType: PopupArtworkContentType },
    options?: CallOptions,
  ): Promise<AdminPopupResponse>;
  removePopupArtwork(
    accessToken: string,
    popupId: string,
    options?: CallOptions,
  ): Promise<AdminPopupResponse>;
  deletePopup(accessToken: string, popupId: string, options?: CallOptions): Promise<void>;

  // After-sales: the customer's own returns and refunds.
  myReturns(accessToken: string, options?: CallOptions): Promise<ReturnListResponse>;
  myReturn(accessToken: string, returnId: string, options?: CallOptions): Promise<ReturnResponse>;
  requestReturn(
    accessToken: string,
    input: ReturnRequest,
    options?: CallOptions,
  ): Promise<ReturnResponse>;
  cancelMyReturn(accessToken: string, returnId: string, options?: CallOptions): Promise<void>;
  myOrderRefunds(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<MyRefundsResponse>;

  // After-sales: the staff queues.
  adminListReturns(
    accessToken: string,
    query?: AdminReturnListQuery,
    options?: CallOptions,
  ): Promise<ReturnListResponse>;
  adminGetReturn(
    accessToken: string,
    returnId: string,
    options?: CallOptions,
  ): Promise<ReturnResponse>;
  adminDecideReturn(
    accessToken: string,
    returnId: string,
    input: ReturnDecisionRequest,
    options?: CallOptions,
  ): Promise<ReturnResponse>;
  adminRestockReturn(
    accessToken: string,
    returnId: string,
    note: string | undefined,
    options?: CallOptions,
  ): Promise<ReturnResponse>;

  // Couriers and shipments (staff). Every call is checked again by the database.
  /** Providers, settings, rate cards and what each courier can do in this mode. */
  adminCourierConfig(accessToken: string, options?: CallOptions): Promise<CourierConfigResponse>;
  adminSaveCourierSettings(
    accessToken: string,
    input: CourierSettingsRequest,
    options?: CallOptions,
  ): Promise<CourierConfigResponse>;
  adminSaveCourierProvider(
    accessToken: string,
    provider: CourierProviderId,
    input: CourierProviderRequest,
    options?: CallOptions,
  ): Promise<CourierConfigResponse>;
  /** Checks the courier connection (mock mode: the mock; live: a read-only call, if verified). */
  adminCheckCourier(
    accessToken: string,
    provider: CourierProviderId,
    options?: CallOptions,
  ): Promise<CourierCheckResponse>;
  adminCreateCourierRateCard(
    accessToken: string,
    input: CourierRateCardRequest,
    options?: CallOptions,
  ): Promise<CourierRateCard>;
  adminUpdateCourierRateCard(
    accessToken: string,
    rateCardId: string,
    input: CourierRateCardRequest,
    options?: CallOptions,
  ): Promise<CourierRateCard>;
  adminDeleteCourierRateCard(
    accessToken: string,
    rateCardId: string,
    options?: CallOptions,
  ): Promise<void>;
  adminSaveCourierLocationMapping(
    accessToken: string,
    input: CourierLocationMappingRequest,
    options?: CallOptions,
  ): Promise<void>;
  adminDeleteCourierLocationMapping(
    accessToken: string,
    mappingId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** Mode, real bookings, tracking sync and timeout (couriers.configure). Live needs the confirmation. */
  adminSaveCourierOperations(
    accessToken: string,
    input: CourierOperationsRequest,
    options?: CallOptions,
  ): Promise<CourierConfigResponse>;
  /** Stores one courier credential encrypted (write-only: the value is never returned). */
  adminSetCourierCredential(
    accessToken: string,
    provider: CourierProviderId,
    field: string,
    value: string,
    options?: CallOptions,
  ): Promise<CourierConfigResponse>;
  adminClearCourierCredential(
    accessToken: string,
    provider: CourierProviderId,
    field: string,
    options?: CallOptions,
  ): Promise<CourierConfigResponse>;
  adminSaveCourierBaseUrl(
    accessToken: string,
    provider: CourierProviderId,
    input: CourierBaseUrlRequest,
    options?: CallOptions,
  ): Promise<CourierConfigResponse>;
  adminSetCourierLiveVerification(
    accessToken: string,
    provider: CourierProviderId,
    input: CourierLiveVerificationRequest,
    options?: CallOptions,
  ): Promise<CourierConfigResponse>;
  // Bulk order actions: every order is validated and answered on its own.
  adminBulkOrderStatus(
    accessToken: string,
    input: BulkOrderStatusRequest,
    options?: CallOptions,
  ): Promise<BulkOrderStatusResponse>;
  adminBulkOrderSummaries(
    accessToken: string,
    orderNumbers: readonly string[],
    options?: CallOptions,
  ): Promise<BulkOrderSummariesResponse>;
  adminBulkCourierCheck(
    accessToken: string,
    orderNumbers: readonly string[],
    options?: CallOptions,
  ): Promise<BulkCourierCheckResponse>;
  /** Books one parcel per listed order, only with `confirm: true`; one booking key per order. */
  adminBulkBookShipments(
    accessToken: string,
    input: BulkShipmentBookingRequest,
    options?: CallOptions,
  ): Promise<BulkShipmentBookingResponse>;
  adminCourierOverview(
    accessToken: string,
    query?: { includeMock?: boolean },
    options?: CallOptions,
  ): Promise<CourierOverviewResponse>;
  adminOrderCourierContext(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<OrderCourierContext>;
  /** Asks every courier for a price (live where verified, else the rate card) and recommends one. */
  adminCompareCouriers(
    accessToken: string,
    orderNumber: string,
    input: CourierCompareRequest,
    options?: CallOptions,
  ): Promise<CourierCompareResponse>;
  /** Books a shipment. Send the same bookingKey with every retry of the same attempt. */
  adminBookShipment(
    accessToken: string,
    orderNumber: string,
    input: BookShipmentRequest,
    options?: CallOptions,
  ): Promise<BookShipmentResponse>;
  adminOrderShipments(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<ShipmentHistoryResponse>;
  adminListShipments(
    accessToken: string,
    query?: AdminShipmentListQuery,
    options?: CallOptions,
  ): Promise<ShipmentListResponse>;
  adminGetShipment(
    accessToken: string,
    shipmentId: string,
    options?: CallOptions,
  ): Promise<ShipmentDetailResponse>;
  adminResolveShipmentBooking(
    accessToken: string,
    shipmentId: string,
    input: ResolveShipmentBookingRequest,
    options?: CallOptions,
  ): Promise<Shipment>;
  adminCancelShipment(
    accessToken: string,
    shipmentId: string,
    input: CancelShipmentRequest,
    options?: CallOptions,
  ): Promise<Shipment>;
  adminRefreshShipment(
    accessToken: string,
    shipmentId: string,
    options?: CallOptions,
  ): Promise<RefreshShipmentResponse>;
  adminRecordShipmentStatus(
    accessToken: string,
    shipmentId: string,
    input: RecordShipmentStatusRequest,
    options?: CallOptions,
  ): Promise<RecordShipmentStatusResponse>;
  adminReturnShipments(
    accessToken: string,
    returnId: string,
    options?: CallOptions,
  ): Promise<ShipmentHistoryResponse>;
  adminBookReturnPickup(
    accessToken: string,
    returnId: string,
    input: BookReturnPickupRequest,
    options?: CallOptions,
  ): Promise<BookShipmentResponse>;
  adminBookExchangeShipment(
    accessToken: string,
    returnId: string,
    input: BookExchangeShipmentRequest,
    options?: CallOptions,
  ): Promise<BookShipmentResponse>;
  /** Records a parcel booked in the courier's own portal (nothing is sent to the courier). */
  adminRecordPortalBooking(
    accessToken: string,
    orderNumber: string,
    input: RecordPortalBookingRequest,
    options?: CallOptions,
  ): Promise<Shipment>;
  adminCodPositions(
    accessToken: string,
    query?: CodPositionListQuery,
    options?: CallOptions,
  ): Promise<CodPositionListResponse>;
  adminRecordCodCollected(
    accessToken: string,
    shipmentId: string,
    input: RecordCodCollectedRequest,
    options?: CallOptions,
  ): Promise<ShipmentDetailResponse>;
  adminRecordCodAdjustment(
    accessToken: string,
    shipmentId: string,
    input: RecordCodAdjustmentRequest,
    options?: CallOptions,
  ): Promise<ShipmentDetailResponse>;
  adminSetCodState(
    accessToken: string,
    shipmentId: string,
    input: SetCodStateRequest,
    options?: CallOptions,
  ): Promise<ShipmentDetailResponse>;
  adminListCourierSettlements(
    accessToken: string,
    query?: CourierSettlementListQuery,
    options?: CallOptions,
  ): Promise<CourierSettlementListResponse>;
  adminRecordCourierSettlement(
    accessToken: string,
    input: RecordCourierSettlementRequest,
    options?: CallOptions,
  ): Promise<CourierSettlement>;
  /** The customer's own shipments of an order: courier, tracking code and timeline. */
  myOrderShipments(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<CustomerShipmentsResponse>;
  adminListRefunds(
    accessToken: string,
    query?: AdminRefundListQuery,
    options?: CallOptions,
  ): Promise<RefundListResponse>;
  adminGetRefund(
    accessToken: string,
    refundId: string,
    options?: CallOptions,
  ): Promise<RefundResponse>;
  adminRequestRefund(
    accessToken: string,
    input: RefundRequest,
    options?: CallOptions,
  ): Promise<RefundResponse>;
  adminDecideRefund(
    accessToken: string,
    refundId: string,
    input: RefundDecisionRequest,
    options?: CallOptions,
  ): Promise<RefundResponse>;
  adminCompleteRefund(
    accessToken: string,
    refundId: string,
    input: RefundCompletionRequest,
    options?: CallOptions,
  ): Promise<RefundResponse>;
  adminCancelRefund(
    accessToken: string,
    refundId: string,
    note: string,
    options?: CallOptions,
  ): Promise<RefundResponse>;

  // Product reviews: the public read, the customer's own, and moderation.
  productReviews(
    slug: string,
    query?: ProductReviewQuery,
    options?: CallOptions,
  ): Promise<ProductReviewsResponse>;
  myProductReview(accessToken: string, productId: string, options?: CallOptions): Promise<MyReview>;
  /** The delivered lines the customer has not reviewed yet. */
  pendingReviews(accessToken: string, options?: CallOptions): Promise<ReviewableItemsResponse>;
  /** The one delivered product the account page may ask the customer to review, or null. */
  reviewPrompt(accessToken: string, options?: CallOptions): Promise<ReviewPromptResponse>;
  /** "Not now": the prompt is not shown again for this product. Resolves with nothing (204). */
  dismissReviewPrompt(accessToken: string, productId: string, options?: CallOptions): Promise<void>;
  submitProductReview(
    accessToken: string,
    productId: string,
    body: ReviewSubmitRequest,
    options?: CallOptions,
  ): Promise<{ reviewId: string }>;
  /** Helpful / not helpful on one review; `verdict: null` withdraws the caller's own vote. */
  voteProductReview(
    accessToken: string,
    reviewId: string,
    body: ReviewVoteRequest,
    options?: CallOptions,
  ): Promise<ReviewVoteResponse>;
  adminListReviews(
    accessToken: string,
    query?: AdminReviewListQuery,
    options?: CallOptions,
  ): Promise<AdminReviewListResponse>;
  adminSetReviewStatus(
    accessToken: string,
    reviewId: string,
    body: ReviewModerationRequest,
    options?: CallOptions,
  ): Promise<void>;
  /** Writes or replaces the shop's public answer (`reviews.reply`). */
  adminReplyToReview(
    accessToken: string,
    reviewId: string,
    body: ReviewReplyRequest,
    options?: CallOptions,
  ): Promise<ReviewReply>;
  /** Withdraws the shop's answer. */
  adminClearReviewReply(
    accessToken: string,
    reviewId: string,
    options?: CallOptions,
  ): Promise<void>;

  // Admin orders
  adminListOrders(
    accessToken: string,
    query?: AdminOrderListQuery,
    options?: CallOptions,
  ): Promise<AdminOrderListResponse>;
  adminGetOrder(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<AdminOrderResponse>;
  /** One fulfilment step, or a cancellation that returns the stock. After a timeout or a 503
   * the change may be saved: reload the order before retrying (a repeated step answers
   * 409 `invalid_status_transition` and changes nothing). */
  adminUpdateOrderStatus(
    accessToken: string,
    orderNumber: string,
    body: OrderStatusChangeRequest,
    options?: CallOptions,
  ): Promise<AdminOrderResponse>;
  /** Records the order's cash as collected; a repeat answers 409 `payment_not_collectable`. */
  adminRecordCodCollection(
    accessToken: string,
    orderNumber: string,
    body: CodCollectionRequest,
    options?: CallOptions,
  ): Promise<AdminOrderResponse>;
  /** The latest push broadcasts with their delivery figures. */
  adminListBroadcasts(accessToken: string, options?: CallOptions): Promise<BroadcastListResponse>;
  /** Queues a push broadcast for every customer who opted in (409 within 10 minutes of the last). */
  adminCreateBroadcast(
    accessToken: string,
    body: BroadcastRequest,
    options?: CallOptions,
  ): Promise<BroadcastCreatedResponse>;
  /** Whether new products are announced automatically, and the words used. */
  adminPushSettings(accessToken: string, options?: CallOptions): Promise<PushSettings>;
  adminSavePushSettings(
    accessToken: string,
    body: SavePushSettingsRequest,
    options?: CallOptions,
  ): Promise<PushSettings>;
  /** Staff-only notes and the archive state of an order. */
  adminOrderInternal(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<OrderInternalResponse>;
  adminAddOrderNote(
    accessToken: string,
    orderNumber: string,
    body: string,
    options?: CallOptions,
  ): Promise<OrderInternalResponse>;
  /** Archives a cancelled, unpaid test order (with a reason) or restores it. */
  adminSetOrderArchived(
    accessToken: string,
    orderNumber: string,
    body: OrderArchiveRequest,
    options?: CallOptions,
  ): Promise<OrderInternalResponse>;

  // Admin accounts
  adminListCustomers(
    accessToken: string,
    query?: CustomerListQuery,
    options?: CallOptions,
  ): Promise<CustomerListResponse>;
  adminGetCustomer(
    accessToken: string,
    customerId: string,
    options?: CallOptions,
  ): Promise<CustomerResponse>;
  adminSetCustomerStatus(
    accessToken: string,
    customerId: string,
    body: CustomerStatusRequest,
    options?: CallOptions,
  ): Promise<CustomerResponse>;
  adminListStaff(accessToken: string, options?: CallOptions): Promise<StaffListResponse>;
  /**
   * Saves a pending invitation and emails its one-time link. Nothing is granted: no account, no
   * role, until the invitee accepts. `emailSent` is false when the mail server refused (the
   * invitation stays pending and can be sent again).
   */
  adminInviteStaff(
    accessToken: string,
    body: StaffInvitationRequest,
    options?: CallOptions,
  ): Promise<StaffInvitationSentResponse>;
  /** The invitations: pending, accepted, expired and revoked. */
  adminStaffInvitations(
    accessToken: string,
    options?: CallOptions,
  ): Promise<StaffInvitationListResponse>;
  /** A fresh token and expiry for a pending or expired invitation; the old link stops working. */
  adminResendStaffInvitation(
    accessToken: string,
    invitationId: string,
    options?: CallOptions,
  ): Promise<StaffInvitationSentResponse>;
  /** Withdraws a pending invitation. */
  adminRevokeStaffInvitation(
    accessToken: string,
    invitationId: string,
    options?: CallOptions,
  ): Promise<void>;
  /** What an invitee sees before accepting (no session). 404 `invitation_invalid` otherwise. */
  staffInvitationPreview(token: string, options?: CallOptions): Promise<StaffInvitationPreview>;
  /** Accepts an invitation with a password (no session); the invitee then signs in. */
  acceptStaffInvitation(
    body: AcceptStaffInvitationRequest,
    options?: CallOptions,
  ): Promise<{ role: InvitableRole }>;
  /**
   * Emails a pending invitee a new one-time link (the earlier one stops working). 409
   * `invitation_accepted` once the invitation was accepted; 404 for anything else.
   */
  resendStaffInvitation(
    accessToken: string,
    userId: string,
    options?: CallOptions,
  ): Promise<StaffInvitationResendResponse>;
  /** Grants or denies one permission to one account; `effect: null` removes the override. */
  adminSetPermission(
    accessToken: string,
    userId: string,
    body: PermissionOverrideRequest,
    options?: CallOptions,
  ): Promise<StaffMemberResponse>;

  // Moderation
  /** The reviews assigned to the caller. */
  moderatorQueue(
    accessToken: string,
    query?: ModeratorQueueQuery,
    options?: CallOptions,
  ): Promise<ModerationTaskListResponse>;
  moderatorGetTask(
    accessToken: string,
    taskId: string,
    options?: CallOptions,
  ): Promise<ModerationTaskResponse>;
  moderatorDecide(
    accessToken: string,
    taskId: string,
    body: ModerationDecisionRequest,
    options?: CallOptions,
  ): Promise<ModerationTaskResponse>;
  adminListModeration(
    accessToken: string,
    query?: ModerationListQuery,
    options?: CallOptions,
  ): Promise<ModerationTaskListResponse>;
  adminListReviewers(
    accessToken: string,
    options?: CallOptions,
  ): Promise<ModerationReviewerListResponse>;
  adminGetModerationTask(
    accessToken: string,
    taskId: string,
    options?: CallOptions,
  ): Promise<ModerationTaskResponse>;
  adminAssignModeration(
    accessToken: string,
    taskId: string,
    body: ModerationAssignmentRequest,
    options?: CallOptions,
  ): Promise<ModerationTaskResponse>;
  adminWithdrawModeration(
    accessToken: string,
    taskId: string,
    options?: CallOptions,
  ): Promise<ModerationTaskResponse>;

  // Reports and settings
  /**
   * The audit log, newest first (audit.read). Every filter is optional and they combine:
   * `from`/`to` are inclusive Bangladesh days (YYYY-MM-DD, at most 366 days apart), `q`
   * a plain-text search over the action, the actor's name and email, and the target id.
   * The log does not record IP addresses.
   */
  adminAuditLog(
    accessToken: string,
    query?: AuditLogQuery,
    options?: CallOptions,
  ): Promise<AuditLogResponse>;
  adminSalesOverview(
    accessToken: string,
    query?: SalesOverviewQuery,
    options?: CallOptions,
  ): Promise<SalesOverviewResponse>;
  /** The workspace summary; each card is null unless the caller holds its permission. */
  adminDashboard(accessToken: string, options?: CallOptions): Promise<DashboardResponse>;
  adminListDeliveryCharges(
    accessToken: string,
    options?: CallOptions,
  ): Promise<DeliveryChargeListResponse>;
  adminSetDeliveryCharge(
    accessToken: string,
    zone: DeliveryZone,
    body: DeliveryChargeRequest,
    options?: CallOptions,
  ): Promise<DeliveryChargeResponse>;
  /**
   * The dashboard and analytics aggregate over a range of Bangladesh calendar days
   * (finance.read). `compare` (on unless false) adds the equally long period before it;
   * top customers are null unless the caller may read customers.
   */
  adminAnalyticsOverview(
    accessToken: string,
    query: Omit<AnalyticsOverviewQuery, 'compare'> & {
      compare?: boolean | AnalyticsOverviewQuery['compare'];
    },
    options?: CallOptions,
  ): Promise<AnalyticsOverviewResponse>;
  /**
   * Order demand by division and district over Bangladesh calendar days — one aggregate
   * the analytics page's map, cards and charts all read (finance.read).
   */
  adminOrderGeography(
    accessToken: string,
    query: OrderGeographyQuery,
    options?: CallOptions,
  ): Promise<OrderGeographyResponse>;
  /** Sets this store's monthly sales target, or clears it with null (settings.manage). */
  adminSetSalesTarget(
    accessToken: string,
    body: SalesTargetRequest,
    options?: CallOptions,
  ): Promise<SalesTargetResponse>;
  /**
   * What each role holds by default (staff.roles.assign or staff.permissions.manage). The
   * owner is listed with every permission; accounts' own grants and denials are not applied.
   */
  adminListRoles(accessToken: string, options?: CallOptions): Promise<AdminRolesResponse>;
  /** Return window, cart inactivity, insight thresholds and sales target (settings.manage). */
  adminGetStoreSettings(accessToken: string, options?: CallOptions): Promise<StoreSettingsResponse>;
  /**
   * Saves the return window, cart inactivity and any threshold given, together or not at
   * all (settings.manage); a threshold left out keeps its value.
   */
  adminSaveStoreSettings(
    accessToken: string,
    body: SaveStoreSettingsRequest,
    options?: CallOptions,
  ): Promise<StoreSettingsResponse>;

  // Visual search (search by image)
  /**
   * Searches the catalogue with a picture. The answer is the ordinary product-card payload
   * plus each result's cosine similarity. The picture is sent, embedded and discarded: the
   * API never stores it.
   */
  searchProductsByImage(
    image: ImageUpload,
    query?: Partial<ImageSearchQuery>,
    options?: CallOptions,
  ): Promise<ImageSearchResponse>;
  /** The same search seeded with a picture the store already holds (Find similar). */
  findSimilarProducts(
    body: ImageSearchSimilarRequest,
    query?: Partial<ImageSearchQuery>,
    options?: CallOptions,
  ): Promise<ImageSearchResponse>;
  /** Records which result was opened, against the searchId the search answered. */
  recordImageSearchClick(
    body: ImageSearchClickRequest,
    options?: CallOptions,
  ): Promise<{ recorded: boolean }>;
  /** Resolves a decoded QR code or barcode to a product, or to a search phrase. */
  resolveScan(body: ScanResolveRequest, options?: CallOptions): Promise<ScanResolveResponse>;
  /** Image search settings, live statistics and recent jobs (image_search.manage). */
  adminImageSearch(accessToken: string, options?: CallOptions): Promise<ImageSearchStats>;
  /** Enables the feature, or changes its threshold and result cap (image_search.manage). */
  adminSaveImageSearchSettings(
    accessToken: string,
    body: SaveImageSearchSettingsRequest,
    options?: CallOptions,
  ): Promise<ImageSearchSettings>;
  /** Starts a backfill, a full reindex or a retry of failed pictures (image_search.manage). */
  adminStartImageSearchJob(
    accessToken: string,
    body: StartImageSearchJobRequest,
    options?: CallOptions,
  ): Promise<ImageSearchJob>;
  /** Products with no usable picture, with the reason (image_search.manage). */
  adminImageSearchMissingImages(
    accessToken: string,
    query?: Partial<ImageSearchMissingImagesQuery>,
    options?: CallOptions,
  ): Promise<ImageSearchMissingImagesResponse>;
  /** The anonymised recent search log (image_search.manage). */
  adminImageSearchActivity(
    accessToken: string,
    query?: Partial<ImageSearchActivityQuery>,
    options?: CallOptions,
  ): Promise<ImageSearchActivityResponse>;

  // Slugs and the media library
  /**
   * Whether a product, category or brand address is free (products.read), with a
   * suggestion when it is taken or reserved. `excludeId` is the item being edited.
   */
  adminSlugAvailability(
    accessToken: string,
    query: SlugAvailabilityQuery,
    options?: CallOptions,  ): Promise<SlugAvailabilityResponse>;
  /** Library pictures, newest first (settings.manage or products.update). */
  adminListMedia(
    accessToken: string,
    query?: MediaListQuery,
    options?: CallOptions,
  ): Promise<MediaListResponse>;
  /**
   * Uploads one library picture as raw bytes (not JSON), like a product image: the
   * Content-Type must be image/jpeg, image/png or image/webp and the API checks the bytes
   * themselves. `alt` describes it for screen readers; `name` is the file name, kept as a
   * label only. Not idempotent: after a timeout, list the library before retrying.
   */
  adminUploadMedia(
    accessToken: string,
    image: {
      bytes: Uint8Array;
      contentType: ProductImageContentType;
      alt?: string;
      name?: string;
    },
    options?: CallOptions,
  ): Promise<MediaAssetResponse>;
  /** Changes a library picture's description; an empty one removes it. */
  adminUpdateMedia(
    accessToken: string,
    mediaId: string,
    body: UpdateMediaRequest,
    options?: CallOptions,
  ): Promise<MediaAssetResponse>;
  /**
   * Deletes a library picture that no image field uses (409 in_use otherwise). Resolves
   * with nothing (204).
   */
  adminDeleteMedia(accessToken: string, mediaId: string, options?: CallOptions): Promise<void>;

  // Reports, exports and order documents
  /** The first 50 rows, the total, a summary and a chart of a report (its permission). */
  adminReportPreview(
    accessToken: string,
    kind: ReportKind,
    query: ReportPreviewQuery,
    options?: CallOptions,
  ): Promise<ReportPreviewResponse>;
  /**
   * The whole report as a CSV, Excel or PDF file. Over 5,000 rows it is refused with
   * 409 export_too_large: create an export job instead.
   */
  adminDownloadReport(
    accessToken: string,
    kind: ReportKind,
    query: ReportExportQuery,
    options?: CallOptions,
  ): Promise<DownloadedFile>;
  /** Queues a background export of any size (202). */
  adminCreateExport(
    accessToken: string,
    body: CreateExportRequest,
    options?: CallOptions,
  ): Promise<ExportJobResponse>;
  /** The caller's own export jobs, newest first. */
  adminListExports(accessToken: string, options?: CallOptions): Promise<ExportJobListResponse>;
  adminGetExport(
    accessToken: string,
    exportId: string,
    options?: CallOptions,
  ): Promise<ExportJobResponse>;
  /** A finished job's file (409 export_not_ready before, 410 export_expired after 7 days). */
  adminDownloadExport(
    accessToken: string,
    exportId: string,
    options?: CallOptions,
  ): Promise<DownloadedFile>;
  /** An order's invoice as a PDF (orders.read). */
  adminOrderInvoice(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<DownloadedFile>;
  /** An order's packing slip as a PDF, without prices (orders.read). */
  adminOrderPackingSlip(
    accessToken: string,
    orderNumber: string,
    options?: CallOptions,
  ): Promise<DownloadedFile>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const noContent = z.undefined();
/** PUT .../products and .../categories answer how many associations survived the write. */
const zoneKeptSchema = z.object({ kept: z.number().int().min(0) });

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function sendJson(
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Stands in for a value that must never become a path segment: request() refuses any
 * path holding it (see hasUnsafeSegment) before anything is sent.
 */
const REFUSED_SEGMENT = '..';

/**
 * One URL path segment, percent-encoded so it can never add a path, query or fragment.
 * Empty values and dot segments ('.', '..'), which the URL parser would resolve into
 * another route, are refused.
 */
function segment(value: string): string {
  if (value === '' || value === '.' || value === '..') return REFUSED_SEGMENT;
  return encodeURIComponent(value);
}

/**
 * Dot segments ('.', '..') would be resolved away by the URL parser and send the call
 * to another route, and an empty segment changes the route too, so such paths are
 * refused before anything is sent.
 */
function hasUnsafeSegment(path: string): boolean {
  const [route = ''] = path.split('?', 1);
  return route
    .split('/')
    .slice(1)
    .some((part) => part === '' || part === '.' || part === '..');
}

/**
 * A query string encoded by URLSearchParams. Only non-blank text and finite numbers
 * are sent (the contracts type coerced fields such as `page` as unknown); anything
 * else, including undefined and blank or whitespace-only text (an empty search box),
 * is left out rather than sent as `q=`.
 */
/** A yes/no query option: sent as "true" when on, left out otherwise (off is the default). */
function flag(value: boolean | string | undefined): string | undefined {
  return value === true || value === 'true' ? 'true' : undefined;
}

function queryString(values: Readonly<Record<string, unknown>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (
      (typeof value === 'string' && value.trim() !== '') ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      params.set(key, String(value));
    }
    // A list of values travels as one comma-separated parameter: `?size=m,l`. The contracts
    // accept that shape as readily as a repeated parameter, and it keeps links readable.
    if (Array.isArray(value) && value.length > 0) {
      params.set(key, value.map((entry) => String(entry)).join(','));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Like request(), for an answer that is a file instead of JSON. */
  async function requestFile(
    path: string,
    fallbackName: string,
    init: RequestInit = {},
    callTimeoutMs: number = FILE_DOWNLOAD_TIMEOUT_MS,
  ): Promise<DownloadedFile> {
    if (hasUnsafeSegment(path)) {
      throw new ApiError(0, 'invalid_request', 'The request path is not valid');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), callTimeoutMs);
    const callerSignal = init.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    const headers = new Headers(init.headers);
    headers.set('Accept', '*/*');

    try {
      let response: Response;
      let bytes: Uint8Array;
      try {
        response = await fetchImpl(`${baseUrl}${API_V1_PREFIX}${path}`, {
          ...init,
          headers,
          signal: controller.signal,
        });
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (cause) {
        if (callerSignal?.aborted) throw cause;
        if (controller.signal.aborted) {
          throw new ApiError(
            0,
            'timeout',
            `Request timed out after ${callTimeoutMs} ms`,
            undefined,
            {
              cause,
            },
          );
        }
        throw new ApiError(0, 'network_error', 'Could not reach the Nilzora API', undefined, {
          cause,
        });
      }

      if (!response.ok) {
        const parsed = apiErrorBodySchema.safeParse(parseJson(new TextDecoder().decode(bytes)));
        if (parsed.success) {
          const { code, message, requestId, details } = parsed.data.error;
          throw new ApiError(response.status, code, message, requestId, { details });
        }
        throw new ApiError(
          response.status,
          'http_error',
          `Request failed with status ${response.status}`,
        );
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const named = /filename="([A-Za-z0-9._-]{1,200})"/.exec(disposition)?.[1];
      return {
        bytes,
        fileName: named ?? fallbackName,
        contentType: response.headers.get('Content-Type') ?? 'application/octet-stream',
      };
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  const reportQuery = (query: ReportPreviewQuery, format?: string) =>
    queryString({
      ...(format === undefined ? {} : { format }),
      from: query.from,
      to: query.to,
      status: query.status,
      paymentStatus: query.paymentStatus,
      categoryId: query.categoryId,
      brandId: query.brandId,
      q: query.q,
    });

  async function request<T>(
    path: string,
    schema: ZodType<T>,
    init: RequestInit = {},
    callTimeoutMs: number = timeoutMs,
  ): Promise<T> {
    if (hasUnsafeSegment(path)) {
      throw new ApiError(0, 'invalid_request', 'The request path is not valid');
    }
    // A manual timeout instead of AbortSignal.timeout(), which React Native lacks.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), callTimeoutMs);
    const callerSignal = init.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');

    try {
      let response: Response;
      let text: string;
      try {
        response = await fetchImpl(`${baseUrl}${API_V1_PREFIX}${path}`, {
          ...init,
          headers,
          signal: controller.signal,
        });
        text = await response.text();
      } catch (cause) {
        if (callerSignal?.aborted) throw cause;
        if (controller.signal.aborted) {
          throw new ApiError(
            0,
            'timeout',
            `Request timed out after ${callTimeoutMs} ms`,
            undefined,
            {
              cause,
            },
          );
        }
        throw new ApiError(0, 'network_error', 'Could not reach the Nilzora API', undefined, {
          cause,
        });
      }

      const body = parseJson(text);
      if (!response.ok) {
        const parsed = apiErrorBodySchema.safeParse(body);
        if (parsed.success) {
          const { code, message, requestId, details } = parsed.data.error;
          throw new ApiError(response.status, code, message, requestId, { details });
        }
        throw new ApiError(
          response.status,
          'http_error',
          `Request failed with status ${response.status}`,
        );
      }

      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError(
          response.status,
          'invalid_response',
          'The API returned an unexpected response',
          undefined,
          { cause: parsed.error },
        );
      }
      return parsed.data;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  return {
    getHealth: (init) => request('/health', healthResponseSchema, init),
    register: (body, options) =>
      request('/auth/register', registerResponseSchema, { ...options, ...sendJson('POST', body) }),
    login: (body, options) =>
      request('/auth/login', authSessionSchema, { ...options, ...sendJson('POST', body) }),
    verifyOtp: (body, options) =>
      request('/auth/verify-otp', authSessionSchema, { ...options, ...sendJson('POST', body) }),
    resendOtp: (body, options) =>
      request('/auth/resend-otp', registerResponseSchema, {
        ...options,
        ...sendJson('POST', body),
      }),
    forgotPassword: (body, options) =>
      request('/auth/forgot-password', registerResponseSchema, {
        ...options,
        ...sendJson('POST', body),
      }),
    resetPassword: (body, options) =>
      request('/auth/reset-password', noContent, { ...options, ...sendJson('POST', body) }),
    authProviders: (options) => request('/auth/providers', authProvidersSchema, options),
    googleStart: (returnTo, options) =>
      request(`/auth/google/start${queryString({ returnTo })}`, googleStartResponseSchema, options),
    completeGoogle: (body, options) =>
      request('/auth/google/callback', googleSignInResponseSchema, {
        ...options,
        ...sendJson('POST', body),
      }),
    completeGoogleIdToken: (body, options) =>
      request('/auth/google/id-token', authSessionSchema, {
        ...options,
        ...sendJson('POST', body),
      }),
    confirmEmail: (tokenHash, options) =>
      request('/auth/confirm-email', noContent, {
        ...options,
        ...sendJson('POST', { tokenHash }),
      }),
    refresh: (refreshToken, options) =>
      request('/auth/refresh', authSessionSchema, {
        ...options,
        ...sendJson('POST', { refreshToken }),
      }),
    logout: (accessToken, options) =>
      request('/auth/logout', noContent, {
        ...options,
        method: 'POST',
        headers: bearer(accessToken),
      }),
    getMe: (accessToken, options) =>
      request('/me', meResponseSchema, { ...options, headers: bearer(accessToken) }),
    myEvents: (accessToken, after, limit = 100, options) =>
      request(
        `/me/events?after=${String(after)}&limit=${String(limit)}`,
        domainEventListResponseSchema,
        {
          ...options,
          headers: bearer(accessToken),
        },
      ),
    myEventsCursor: (accessToken, options) =>
      request('/me/events/cursor', domainEventCursorResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    twoFactorStatus: (accessToken, options) =>
      request('/auth/two-factor', twoFactorStatusResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    twoFactorEnroll: (accessToken, password, options) =>
      request('/auth/two-factor/enroll', twoFactorEnrollResponseSchema, {
        ...options,
        ...sendJson('POST', password === undefined ? {} : { password }, bearer(accessToken)),
      }),
    twoFactorActivate: (accessToken, code, options) =>
      request('/auth/two-factor/activate', twoFactorRecoveryCodesResponseSchema, {
        ...options,
        ...sendJson('POST', { code }, bearer(accessToken)),
      }),
    twoFactorVerify: (accessToken, code, options) =>
      request('/auth/two-factor/verify', noContent, {
        ...options,
        ...sendJson('POST', { code }, bearer(accessToken)),
      }),
    twoFactorRecover: (accessToken, recoveryCode, options) =>
      request('/auth/two-factor/recovery', twoFactorRecoveryUsedResponseSchema, {
        ...options,
        ...sendJson('POST', { recoveryCode }, bearer(accessToken)),
      }),
    twoFactorReplaceRecoveryCodes: (accessToken, code, options) =>
      request('/auth/two-factor/recovery-codes', twoFactorRecoveryCodesResponseSchema, {
        ...options,
        ...sendJson('POST', { code }, bearer(accessToken)),
      }),
    twoFactorReset: (accessToken, body, options) =>
      request('/auth/two-factor/reset', noContent, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    updateMe: (accessToken, body, options) =>
      request('/me', meResponseSchema, {
        ...options,
        ...sendJson('PATCH', body, bearer(accessToken)),
      }),

    listCategories: (options) =>
      request('/catalog/categories', categoryListResponseSchema, options),
    discovery: (options) => request('/catalog/discovery', discoveryResponseSchema, options),
    listCampaigns: (query = {}, options) =>
      request(
        `/catalog/campaigns${queryString({ category: query.category })}`,
        campaignListResponseSchema,
        options,
      ),
    listProducts: (query = {}, options) =>
      request(
        `/catalog/products${queryString({
          category: query.category,
          zone: query.zone,
          q: query.q,
          sort: query.sort,
          page: query.page,
          pageSize: query.pageSize,
          includeSubcategories: flag(query.includeSubcategories),
          brand: query.brand,
          minPriceMinor: query.minPriceMinor,
          maxPriceMinor: query.maxPriceMinor,
          inStock: flag(query.inStock),
          size: query.size,
          color: query.color,
        })}`,
        productListResponseSchema,
        options,
      ),
    productFacets: (query = {}, options) =>
      request(
        `/catalog/product-facets${queryString({
          category: query.category,
          zone: query.zone,
          q: query.q,
          includeSubcategories: flag(query.includeSubcategories),
          brand: query.brand,
          minPriceMinor: query.minPriceMinor,
          maxPriceMinor: query.maxPriceMinor,
          inStock: flag(query.inStock),
          size: query.size,
          color: query.color,
        })}`,
        productFacetsResponseSchema,
        options,
      ),
    shoppingZones: (options) =>
      request('/catalog/shopping-zones', shoppingZonesResponseSchema, options),
    getProduct: (slug, options) =>
      request(`/catalog/products/${segment(slug)}`, productResponseSchema, options),
    listBrands: (options) => request('/catalog/brands', brandListResponseSchema, options),
    getBrand: (slug, options) =>
      request(`/catalog/brands/${segment(slug)}`, brandLookupResponseSchema, options),
    listBrandProducts: (slug, query = {}, options) =>
      request(
        `/catalog/brands/${segment(slug)}/products${queryString({
          sort: query.sort,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
        brandProductsResponseSchema,
        options,
      ),
    listBanners: (query, options) =>
      request(
        `/catalog/banners${queryString({ placement: query.placement, category: query.category })}`,
        bannerListResponseSchema,
        options,
      ),
    quoteCart: (items, options) =>
      request('/cart/quote', cartQuoteResponseSchema, {
        ...options,
        ...sendJson('POST', { items }),
      }),

    quoteCheckout: (accessToken, body, options) =>
      request('/checkout/quote', checkoutQuoteResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    listAddresses: (accessToken, options) =>
      request('/me/addresses', addressListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    createAddress: (accessToken, body, options) =>
      request('/me/addresses', addressResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    updateAddress: (accessToken, addressId, body, options) =>
      request(`/me/addresses/${segment(addressId)}`, addressResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    deleteAddress: (accessToken, addressId, options) =>
      request(`/me/addresses/${segment(addressId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    placeOrder: (accessToken, body, options) =>
      request('/orders', placeOrderResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    listOrders: (accessToken, query = {}, options) =>
      request(
        `/orders${queryString({ page: query.page, pageSize: query.pageSize })}`,
        orderListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    getOrder: (accessToken, orderNumber, options) =>
      request(`/orders/${segment(orderNumber)}`, orderResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    orderReceiptPdf: (accessToken, orderNumber, options) =>
      requestFile(
        `/orders/${segment(orderNumber)}/receipt.pdf`,
        `Nilzora-Receipt-${orderNumber}.pdf`,
        {
          ...options,
          headers: bearer(accessToken),
        },
      ),
    cancelOrder: (accessToken, orderNumber, body = {}, options) =>
      request(`/orders/${segment(orderNumber)}/cancel`, orderResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),

    startChatConversation: (accessToken, body, options) =>
      request('/chat/conversations', chatConversationResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    listChatConversations: (accessToken, query = {}, options) =>
      request(
        `/chat/conversations${queryString({
          scope: query.scope,
          status: query.status,
          search: query.search,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
        chatConversationListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    listChatQueue: (accessToken, query = {}, options) =>
      request(
        `/chat/admin/queue${queryString({
          scope: query.scope,
          status: query.status,
          priority: query.priority,
          search: query.search,
          sort: query.sort,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
        chatConversationListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    listChatTeam: (accessToken, options) =>
      request('/chat/admin/team', chatTeamResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    getChatConversation: (accessToken, conversationId, options) =>
      request(`/chat/conversations/${segment(conversationId)}`, chatConversationResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    getChatUnreadCount: (accessToken, options) =>
      request('/chat/unread-count', chatUnreadCountSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    listChatMessages: (accessToken, conversationId, query = {}, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/messages${queryString({
          before: query.before,
          limit: query.limit,
        })}`,
        chatMessagePageSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    sendChatMessage: (accessToken, conversationId, body, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/messages`,
        sendChatMessageResponseSchema,
        { ...options, ...sendJson('POST', body, bearer(accessToken)) },
      ),
    markChatRead: (accessToken, conversationId, seq, options) =>
      request(`/chat/conversations/${segment(conversationId)}/read`, chatUnreadCountSchema, {
        ...options,
        ...sendJson('POST', { seq }, bearer(accessToken)),
      }),
    setChatStatus: (accessToken, conversationId, status, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/status`,
        chatConversationResponseSchema,
        { ...options, ...sendJson('POST', { status }, bearer(accessToken)) },
      ),
    assignChatConversation: (accessToken, conversationId, body, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/assignee`,
        chatConversationResponseSchema,
        { ...options, ...sendJson('POST', body, bearer(accessToken)) },
      ),
    setChatPriority: (accessToken, conversationId, priority, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/priority`,
        chatConversationResponseSchema,
        { ...options, ...sendJson('POST', { priority }, bearer(accessToken)) },
      ),
    listChatNotes: (accessToken, conversationId, query = {}, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/notes${queryString({
          before: query.before,
          limit: query.limit,
        })}`,
        chatNotesResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    addChatNote: (accessToken, conversationId, body, options) =>
      request(`/chat/conversations/${segment(conversationId)}/notes`, chatInternalNoteSchema, {
        ...options,
        ...sendJson('POST', { body }, bearer(accessToken)),
      }),
    reportChatMessage: (accessToken, messageId, body, options) =>
      request(`/chat/messages/${segment(messageId)}/report`, chatReportResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    createChatSocketTicket: (accessToken, options) =>
      request('/chat/socket-ticket', chatSocketTicketSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),

    // ---------------- Phase 2 ----------------

    listChatTemplates: (accessToken, query = {}, options) =>
      request(
        `/chat/admin/templates${queryString({ includeArchived: flag(query.includeArchived) })}`,
        chatTemplatesResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    saveChatTemplate: (accessToken, body, options) =>
      request('/chat/admin/templates', chatTemplateSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    archiveChatTemplate: (accessToken, templateId, options) =>
      request(`/chat/admin/templates/${segment(templateId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    renderChatTemplate: (accessToken, body, options) =>
      request('/chat/admin/templates/render', renderedChatTemplateSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    listChatSavedReplies: (accessToken, options) =>
      request('/chat/admin/saved-replies', chatSavedRepliesResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    saveChatSavedReply: (accessToken, body, options) =>
      request('/chat/admin/saved-replies', noContent, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    deleteChatSavedReply: (accessToken, replyId, options) =>
      request(`/chat/admin/saved-replies/${segment(replyId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    listChatTags: (accessToken, options) =>
      request('/chat/admin/tags', chatTagsResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    saveChatTag: (accessToken, body, options) =>
      request('/chat/admin/tags', noContent, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    setChatConversationTags: (accessToken, conversationId, tagIds, options) =>
      request(`/chat/conversations/${segment(conversationId)}/tags`, noContent, {
        ...options,
        ...sendJson('PUT', { tagIds }, bearer(accessToken)),
      }),
    uploadChatAttachment: (
      accessToken,
      conversationId,
      fileName,
      body,
      contentType,
      durationMs,
      options,
    ) =>
      request(
        `/chat/conversations/${segment(conversationId)}/attachments${queryString({ fileName, durationMs })}`,
        chatAttachmentUploadSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': contentType },
          body: body as unknown as BodyInit,
        },
        // The API re-encodes images and stores them in R2 before it answers, which routinely
        // outlasts the 10-second default (the object was then stored but the upload "failed").
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    discardChatAttachment: (accessToken, attachmentId, options) =>
      request(`/chat/attachments/${segment(attachmentId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    postChatMessage: (accessToken, body, options) =>
      request('/chat/messages', postedChatMessageSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    chatAttachmentMedia: (accessToken, attachmentId, variant, options) =>
      requestFile(
        `/chat/attachments/${segment(attachmentId)}/media${queryString({
          variant: variant === 'thumb' ? 'thumb' : undefined,
        })}`,
        'attachment',
        { ...options, method: 'GET', headers: bearer(accessToken) },
      ),
    submitChatCsat: (accessToken, conversationId, body, options) =>
      request(`/chat/conversations/${segment(conversationId)}/rating`, chatCsatResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    submitChatMessageFeedback: (accessToken, messageId, body, options) =>
      request(`/chat/messages/${segment(messageId)}/feedback`, chatMessageFeedbackSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    listChatMessageFeedback: (accessToken, conversationId, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/feedback`,
        chatMessageFeedbackResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    listMyChatFeedback: (accessToken, conversationId, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/my-feedback`,
        chatMyFeedbackResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    listChatReports: (accessToken, query = {}, options) =>
      request(
        `/chat/admin/reports${queryString({ status: query.status, limit: query.limit, offset: query.offset })}`,
        chatReportQueueResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    decideChatReport: (accessToken, body, options) =>
      request(`/chat/admin/reports/${segment(body.reportId)}/decide`, chatReportDecisionSchema, {
        ...options,
        ...sendJson(
          'POST',
          { status: body.status, actionTaken: body.actionTaken, note: body.note },
          bearer(accessToken),
        ),
      }),
    deleteChatMessage: (accessToken, messageId, options) =>
      request(`/chat/messages/${segment(messageId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    pinChatMessage: (accessToken, conversationId, messageId, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/messages/${segment(messageId)}/pin`,
        noContent,
        {
          ...options,
          ...sendJson('POST', {}, bearer(accessToken)),
        },
      ),
    unpinChatMessage: (accessToken, conversationId, messageId, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/messages/${segment(messageId)}/pin`,
        noContent,
        {
          ...options,
          method: 'DELETE',
          headers: bearer(accessToken),
        },
      ),
    listChatPinnedMessages: (accessToken, conversationId, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/pins`,
        chatPinnedMessagesResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    toggleChatMessageReaction: (accessToken, conversationId, messageId, emoji, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/messages/${segment(messageId)}/reactions`,
        chatReactionResponseSchema,
        {
          ...options,
          ...sendJson('POST', { emoji }, bearer(accessToken)),
        },
      ),
    listChatReactionSummary: (accessToken, conversationId, options) =>
      request(
        `/chat/conversations/${segment(conversationId)}/reactions`,
        chatReactionSummaryResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    startInternalChat: (accessToken, body, options) =>
      request('/chat/internal', chatConversationDetailSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    listInternalChannels: (accessToken, query = {}, options) =>
      request(
        `/chat/internal${queryString({ limit: query.limit, offset: query.offset })}`,
        chatInternalChannelsResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    searchChatMessages: (accessToken, query, options) =>
      request(
        `/chat/search${queryString({ q: query.q, limit: query.limit })}`,
        chatSearchResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    getChatAnalytics: (accessToken, query = {}, options) =>
      request(
        `/chat/admin/analytics${queryString({ from: query.from, to: query.to })}`,
        chatAnalyticsSchema,
        {
          ...options,
          headers: bearer(accessToken),
        },
      ),
    listChatAutomationRules: (accessToken, options) =>
      request('/chat/admin/automation', chatAutomationRulesResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    saveChatAutomationRule: (accessToken, body, options) =>
      request('/chat/admin/automation', noContent, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    setChatAutomationRuleActive: (accessToken, ruleId, isActive, options) =>
      request(`/chat/admin/automation/${segment(ruleId)}/active`, noContent, {
        ...options,
        ...sendJson('POST', { isActive }, bearer(accessToken)),
      }),
    deleteChatAutomationRule: (accessToken, ruleId, options) =>
      request(`/chat/admin/automation/${segment(ruleId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    listChatAutomationRuns: (accessToken, query = {}, options) =>
      request(
        `/chat/admin/automation/runs${queryString({ limit: query.limit, offset: query.offset })}`,
        chatAutomationRunsResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    previewChatAutomationRule: (accessToken, body, options) =>
      request('/chat/admin/automation/preview', chatAutomationPreviewSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),

    registerDevice: (accessToken, body, options) =>
      request('/me/devices', deviceRegistrationResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    unregisterDevice: (accessToken, body, options) =>
      request('/me/devices/remove', noContent, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),

    setDeviceAnnouncements: (accessToken, body, options) =>
      request('/me/devices/announcements', deviceAnnouncementPreferenceResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),

    acceptInvitation: (body, options) =>
      request('/auth/accept-invite', noContent, { ...options, ...sendJson('POST', body) }),
    assignRole: (accessToken, userId, body, options) =>
      request(`/admin/users/${segment(userId)}/role`, assignRoleResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),

    adminListProducts: (accessToken, query = {}, options) =>
      request(
        `/admin/products${queryString({ q: query.q, status: query.status, moderationStatus: query.moderationStatus, categoryId: query.categoryId, stock: query.stock, sort: query.sort, page: query.page, pageSize: query.pageSize })}`,
        adminProductListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminGetProduct: (accessToken, productId, options) =>
      request(`/admin/products/${segment(productId)}`, adminProductResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateProduct: (accessToken, body, options) =>
      request('/admin/products', adminProductResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUpdateProduct: (accessToken, productId, body, options) =>
      request(`/admin/products/${segment(productId)}`, adminProductResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminSetProductStatus: (accessToken, productId, body, options) =>
      request(`/admin/products/${segment(productId)}/status`, adminProductResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminAdjustStock: (accessToken, productId, body, options) =>
      request(`/admin/products/${segment(productId)}/stock`, adminProductResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUploadProductImage: (accessToken, productId, image, options) => {
      const query = image.alt ? `?${new URLSearchParams({ alt: image.alt }).toString()}` : '';
      return request(
        `/admin/products/${segment(productId)}/images${query}`,
        productImageUploadResponseSchema,
        {
          ...options,
          method: 'POST',
          // Raw bytes, deliberately not JSON: the API reads the body as the image itself.
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      );
    },
    adminUpdateProductImage: (accessToken, imageId, body, options) =>
      request(`/admin/product-images/${segment(imageId)}`, productImageListResponseSchema, {
        ...options,
        ...sendJson('PATCH', body, bearer(accessToken)),
      }),
    adminReorderProductImages: (accessToken, productId, body, options) =>
      request(
        `/admin/products/${segment(productId)}/images/order`,
        productImageListResponseSchema,
        { ...options, ...sendJson('PUT', body, bearer(accessToken)) },
      ),
    adminDeleteProductImage: (accessToken, imageId, options) =>
      request(`/admin/product-images/${segment(imageId)}`, productImageListResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminListProductVideos: (accessToken, productId, options) =>
      request(`/admin/products/${segment(productId)}/videos`, productVideoListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminUploadProductVideo: (accessToken, productId, video, options) => {
      const query = video.title ? `?${new URLSearchParams({ title: video.title }).toString()}` : '';
      return request(
        `/admin/products/${segment(productId)}/videos${query}`,
        productVideoListResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': video.contentType },
          body: video.bytes as BodyInit,
        },
        VIDEO_UPLOAD_TIMEOUT_MS,
      );
    },
    adminReorderProductVideos: (accessToken, productId, body, options) =>
      request(
        `/admin/products/${segment(productId)}/videos/order`,
        productVideoListResponseSchema,
        { ...options, ...sendJson('PUT', body, bearer(accessToken)) },
      ),
    adminDeleteProductVideo: (accessToken, videoId, options) =>
      request(`/admin/product-videos/${segment(videoId)}`, productVideoListResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminSubmitProduct: (accessToken, productId, options) =>
      request(`/admin/products/${segment(productId)}/submit`, adminProductResponseSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    adminListCategories: (accessToken, options) =>
      request('/admin/categories', adminCategoryListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateCategory: (accessToken, body, options) =>
      request('/admin/categories', adminCategoryResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUpdateCategory: (accessToken, categoryId, body, options) =>
      request(`/admin/categories/${segment(categoryId)}`, adminCategoryResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminDeleteProduct: (accessToken, productId, options) =>
      request(`/admin/products/${segment(productId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminReorderCategories: (accessToken, body, options) =>
      request('/admin/categories/reorder', noContent, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminDeleteCategory: (accessToken, categoryId, options) =>
      request(`/admin/categories/${segment(categoryId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminListBrands: (accessToken, options) =>
      request('/admin/brands', adminBrandListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateBrand: (accessToken, body, options) =>
      request('/admin/brands', adminBrandResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUpdateBrand: (accessToken, brandId, body, options) =>
      request(`/admin/brands/${segment(brandId)}`, adminBrandResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminUploadBrandLogo: (accessToken, brandId, image, options) =>
      request(
        `/admin/brands/${segment(brandId)}/logo`,
        adminBrandResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminRemoveBrandLogo: (accessToken, brandId, options) =>
      request(`/admin/brands/${segment(brandId)}/logo`, adminBrandResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminUploadBrandBanner: (accessToken, brandId, image, options) =>
      request(
        `/admin/brands/${segment(brandId)}/banner`,
        adminBrandResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminRemoveBrandBanner: (accessToken, brandId, options) =>
      request(`/admin/brands/${segment(brandId)}/banner`, adminBrandResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminDeleteBrand: (accessToken, brandId, options) =>
      request(`/admin/brands/${segment(brandId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminGetProductBrand: (accessToken, productId, options) =>
      request(`/admin/products/${segment(productId)}/brand`, productBrandResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSetProductBrand: (accessToken, productId, brandId, options) =>
      request(`/admin/products/${segment(productId)}/brand`, noContent, {
        ...options,
        ...sendJson('PUT', { brandId }, bearer(accessToken)),
      }),
    adminListBanners: (accessToken, options) =>
      request('/admin/banners', adminBannerListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateBanner: (accessToken, body, options) =>
      request('/admin/banners', adminBannerResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUpdateBanner: (accessToken, bannerId, body, options) =>
      request(`/admin/banners/${segment(bannerId)}`, adminBannerResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminUploadBannerImage: (accessToken, bannerId, image, options) =>
      request(
        `/admin/banners/${segment(bannerId)}/image`,
        adminBannerResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminUploadBannerMobileImage: (accessToken, bannerId, image, options) =>
      request(
        `/admin/banners/${segment(bannerId)}/image?variant=mobile`,
        adminBannerResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminRemoveBannerMobileImage: (accessToken, bannerId, options) =>
      request(
        `/admin/banners/${segment(bannerId)}/image?variant=mobile`,
        adminBannerResponseSchema,
        { ...options, method: 'DELETE', headers: bearer(accessToken) },
      ),
    adminReorderBanners: (accessToken, body, options) =>
      request('/admin/banners/order', adminBannerListResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminUploadCategoryImage: (accessToken, categoryId, image, options) =>
      request(
        `/admin/categories/${segment(categoryId)}/image`,
        adminCategoryResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminRemoveCategoryImage: (accessToken, categoryId, options) =>
      request(`/admin/categories/${segment(categoryId)}/image`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminUploadCategoryBanner: (accessToken, categoryId, image, options) =>
      request(
        `/admin/categories/${segment(categoryId)}/banner`,
        adminCategoryResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminRemoveCategoryBanner: (accessToken, categoryId, options) =>
      request(`/admin/categories/${segment(categoryId)}/banner`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    uploadMyAvatar: (accessToken, image, options) =>
      request(
        '/me/avatar',
        avatarResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    removeMyAvatar: (accessToken, options) =>
      request('/me/avatar', avatarResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    uploadReviewImage: (accessToken, reviewId, image, options) =>
      request(
        `/me/reviews/${segment(reviewId)}/images`,
        reviewImageUploadResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    removeReviewImage: (accessToken, imageId, options) =>
      request(`/me/review-images/${segment(imageId)}`, reviewImageListResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminDeleteBanner: (accessToken, bannerId, options) =>
      request(`/admin/banners/${segment(bannerId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminListZones: (accessToken, query = {}, options) =>
      request(
        `/admin/shopping-zones${queryString({
          q: query.q,
          status: query.status,
          sort: query.sort,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
        adminShoppingZoneListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminZone: (accessToken, zoneId, options) =>
      request(`/admin/shopping-zones/${segment(zoneId)}`, adminShoppingZoneResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSaveZone: (accessToken, zoneId, body, options) =>
      request(
        zoneId === null ? '/admin/shopping-zones' : `/admin/shopping-zones/${segment(zoneId)}`,
        adminShoppingZoneResponseSchema,
        {
          ...options,
          ...sendJson(zoneId === null ? 'POST' : 'PUT', body, bearer(accessToken)),
        },
      ),
    adminSetZoneActive: (accessToken, zoneId, isActive, options) =>
      request(`/admin/shopping-zones/${segment(zoneId)}/active`, adminShoppingZoneResponseSchema, {
        ...options,
        ...sendJson('PUT', { isActive }, bearer(accessToken)),
      }),
    adminSetZoneProducts: (accessToken, zoneId, productIds, options) =>
      request(`/admin/shopping-zones/${segment(zoneId)}/products`, zoneKeptSchema, {
        ...options,
        ...sendJson('PUT', { productIds }, bearer(accessToken)),
      }),
    adminSetZoneCategories: (accessToken, zoneId, categoryIds, options) =>
      request(`/admin/shopping-zones/${segment(zoneId)}/categories`, zoneKeptSchema, {
        ...options,
        ...sendJson('PUT', { categoryIds }, bearer(accessToken)),
      }),
    adminUploadZoneBanner: (accessToken, zoneId, image, options) =>
      request(
        `/admin/shopping-zones/${segment(zoneId)}/banner${queryString({ alt: image.alt })}`,
        adminShoppingZoneResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminRemoveZoneBanner: (accessToken, zoneId, options) =>
      request(`/admin/shopping-zones/${segment(zoneId)}/banner`, adminShoppingZoneResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminUploadZoneMobileBanner: (accessToken, zoneId, image, options) =>
      request(
        `/admin/shopping-zones/${segment(zoneId)}/mobile-banner`,
        adminShoppingZoneResponseSchema,
        {
          ...options,
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    adminRemoveZoneMobileBanner: (accessToken, zoneId, options) =>
      request(
        `/admin/shopping-zones/${segment(zoneId)}/mobile-banner`,
        adminShoppingZoneResponseSchema,
        {
          ...options,
          method: 'DELETE',
          headers: bearer(accessToken),
        },
      ),
    adminDeleteZone: (accessToken, zoneId, options) =>
      request(`/admin/shopping-zones/${segment(zoneId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminProductZones: (accessToken, productId, options) =>
      request(`/admin/products/${segment(productId)}/zones`, adminProductZonesSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSetProductZones: (accessToken, productId, zoneIds, options) =>
      request(`/admin/products/${segment(productId)}/zones`, zoneKeptSchema, {
        ...options,
        ...sendJson('PUT', { zoneIds }, bearer(accessToken)),
      }),
    adminCategoryZones: (accessToken, categoryId, options) =>
      request(`/admin/categories/${segment(categoryId)}/zones`, adminCategoryZonesSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSetCategoryZones: (accessToken, categoryId, zoneIds, options) =>
      request(`/admin/categories/${segment(categoryId)}/zones`, zoneKeptSchema, {
        ...options,
        ...sendJson('PUT', { zoneIds }, bearer(accessToken)),
      }),
    adminListInventoryMovements: (accessToken, query = {}, options) =>
      request(
        `/admin/inventory-movements${queryString({ productId: query.productId, reason: query.reason, page: query.page, pageSize: query.pageSize })}`,
        inventoryMovementListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),

    productReviews: (slug, query = {}, options) =>
      request(
        `/catalog/products/${segment(slug)}/reviews${queryString({ page: query.page, pageSize: query.pageSize })}`,
        productReviewsResponseSchema,
        options,
      ),
    myProductReview: (accessToken, productId, options) =>
      request(`/me/products/${segment(productId)}/review`, myReviewSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    pendingReviews: (accessToken, options) =>
      request('/me/reviews/pending', reviewableItemsResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    reviewPrompt: (accessToken, options) =>
      request('/me/reviews/prompt', reviewPromptResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    dismissReviewPrompt: (accessToken, productId, options) =>
      request('/me/reviews/prompt/dismiss', noContent, {
        ...options,
        ...sendJson('POST', { productId }, bearer(accessToken)),
      }),
    submitProductReview: (accessToken, productId, body, options) =>
      request(`/me/products/${segment(productId)}/review`, z.object({ reviewId: z.uuid() }), {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    voteProductReview: (accessToken, reviewId, body, options) =>
      request(`/me/reviews/${segment(reviewId)}/vote`, reviewVoteResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminListReviews: (accessToken, query = {}, options) =>
      request(
        `/admin/product-reviews${queryString({ status: query.status === 'all' ? undefined : query.status, q: query.q, page: query.page, pageSize: query.pageSize })}`,
        adminReviewListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminSetReviewStatus: (accessToken, reviewId, body, options) =>
      request(`/admin/product-reviews/${segment(reviewId)}/status`, noContent, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminReplyToReview: (accessToken, reviewId, body, options) =>
      request(`/admin/product-reviews/${segment(reviewId)}/reply`, reviewReplySchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminClearReviewReply: (accessToken, reviewId, options) =>
      request(`/admin/product-reviews/${segment(reviewId)}/reply`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),

    adminListCoupons: (accessToken, query = {}, options) =>
      request(
        `/admin/coupons${queryString({ q: query.q, state: query.state === 'all' ? undefined : query.state, page: query.page, pageSize: query.pageSize })}`,
        adminCouponListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminGetCoupon: (accessToken, couponId, options) =>
      request(`/admin/coupons/${segment(couponId)}`, adminCouponResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateCoupon: (accessToken, body, options) =>
      request('/admin/coupons', adminCouponResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUpdateCoupon: (accessToken, couponId, body, options) =>
      request(`/admin/coupons/${segment(couponId)}`, adminCouponResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminDeleteCoupon: (accessToken, couponId, options) =>
      request(`/admin/coupons/${segment(couponId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminSetCouponActive: (accessToken, couponId, isActive, options) =>
      request(`/admin/coupons/${segment(couponId)}/active`, noContent, {
        ...options,
        ...sendJson('PATCH', { isActive }, bearer(accessToken)),
      }),
    adminCouponRedemptions: (accessToken, couponId, query = {}, options) =>
      request(
        `/admin/coupons/${segment(couponId)}/redemptions${queryString({ page: query.page, pageSize: query.pageSize })}`,
        couponRedemptionListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),

    adminListCampaigns: (accessToken, query = {}, options) =>
      request(
        `/admin/discounts/campaigns${queryString({
          q: query.q,
          state: query.state === 'all' ? undefined : query.state,
          scope: query.scope === 'all' ? undefined : query.scope,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
        adminCampaignListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminGetCampaign: (accessToken, campaignId, options) =>
      request(`/admin/discounts/campaigns/${segment(campaignId)}`, adminCampaignResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateCampaign: (accessToken, body, options) =>
      request('/admin/discounts/campaigns', adminCampaignResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUpdateCampaign: (accessToken, campaignId, body, options) =>
      request(`/admin/discounts/campaigns/${segment(campaignId)}`, adminCampaignResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminSetCampaignStatus: (accessToken, campaignId, body, options) =>
      request(
        `/admin/discounts/campaigns/${segment(campaignId)}/status`,
        adminCampaignResponseSchema,
        { ...options, ...sendJson('PATCH', body, bearer(accessToken)) },
      ),
    adminDuplicateCampaign: (accessToken, campaignId, options) =>
      request(
        `/admin/discounts/campaigns/${segment(campaignId)}/duplicate`,
        adminCampaignResponseSchema,
        { ...options, method: 'POST', headers: bearer(accessToken) },
      ),
    adminPreviewCampaign: (accessToken, body, options) =>
      request('/admin/discounts/preview', campaignPreviewResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminCampaignProducts: (accessToken, campaignId, query = {}, options) =>
      request(
        `/admin/discounts/campaigns/${segment(campaignId)}/products${queryString({ page: query.page, pageSize: query.pageSize })}`,
        campaignPreviewResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminCampaignConflicts: (accessToken, campaignId, options) =>
      request(
        `/admin/discounts/campaigns/${segment(campaignId)}/conflicts`,
        campaignConflictListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminCampaignHistory: (accessToken, campaignId, query = {}, options) =>
      request(
        `/admin/discounts/campaigns/${segment(campaignId)}/history${queryString({ page: query.page, pageSize: query.pageSize })}`,
        campaignHistoryResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminCategoryCampaigns: (accessToken, query = {}, options) =>
      request(
        `/admin/discounts/category-campaigns${queryString({ categoryId: query.categoryId })}`,
        categoryCampaignListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),

    adminListAttributes: (accessToken, options) =>
      request('/admin/attributes', adminAttributesResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSaveAttribute: (accessToken, input, options) =>
      request('/admin/attributes', adminAttributesResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminSaveAttributeValue: (accessToken, input, options) =>
      request('/admin/attributes/values', adminAttributesResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminProductVariants: (accessToken, productId, options) =>
      request(
        `/admin/products/${segment(productId)}/variants`,
        adminProductVariantsResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminSaveVariant: (accessToken, productId, input, options) =>
      request(
        `/admin/products/${segment(productId)}/variants`,
        adminProductVariantsResponseSchema,
        { ...options, ...sendJson('POST', input, bearer(accessToken)) },
      ),
    adminSetVariantActive: (accessToken, productId, variantId, isActive, options) =>
      request(
        `/admin/products/${segment(productId)}/variants/${segment(variantId)}/active`,
        adminProductVariantsResponseSchema,
        { ...options, ...sendJson('POST', { isActive }, bearer(accessToken)) },
      ),
    adminAdjustVariantStock: (accessToken, productId, variantId, input, options) =>
      request(
        `/admin/products/${segment(productId)}/variants/${segment(variantId)}/stock`,
        adminProductVariantsResponseSchema,
        { ...options, ...sendJson('POST', input, bearer(accessToken)) },
      ),
    adminSetVariantStock: (accessToken, productId, variantId, input, options) =>
      request(
        `/admin/products/${segment(productId)}/variants/${segment(variantId)}/stock/set`,
        adminProductVariantsResponseSchema,
        { ...options, ...sendJson('POST', input, bearer(accessToken)) },
      ),
    adminDeleteVariant: (accessToken, productId, variantId, options) =>
      request(`/admin/products/${segment(productId)}/variants/${segment(variantId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),

    publicStoreProfile: (options) => request('/store/profile', storeProfileResponseSchema, options),
    publicSitePage: (slug, options) =>
      request(`/store/pages/${segment(slug)}`, sitePageResponseSchema, options),
    publicNavigation: (options) => request('/store/navigation', navigationResponseSchema, options),
    publicHomepage: (options) => request('/store/homepage', homepageResponseSchema, options),
    adminListSitePages: (accessToken, options) =>
      request('/admin/site-pages', adminSitePageListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSaveSitePage: (accessToken, slug, body, options) =>
      request(`/admin/site-pages/${segment(slug)}`, adminSitePageResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminListMenuItems: (accessToken, options) =>
      request('/admin/navigation', menuItemListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateMenuItem: (accessToken, body, options) =>
      request('/admin/navigation', menuItemResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminUpdateMenuItem: (accessToken, itemId, body, options) =>
      request(`/admin/navigation/${segment(itemId)}`, menuItemResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminDeleteMenuItem: (accessToken, itemId, options) =>
      request(`/admin/navigation/${segment(itemId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminReorderMenu: (accessToken, body, options) =>
      request('/admin/navigation/order', menuItemListResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminGetHomepage: (accessToken, options) =>
      request('/admin/homepage', adminHomepageResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSaveHomepage: (accessToken, body, options) =>
      request('/admin/homepage', adminHomepageResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    publicSeo: (kind, slug, options) =>
      request(`/seo/${segment(kind)}/${segment(slug)}`, seoMetadataResponseSchema, options),
    sitemap: (options) => request('/seo/sitemap', sitemapResponseSchema, options),
    adminSeoOverview: (accessToken, query = {}, options) =>
      request(`/admin/seo${queryString({ q: query.q })}`, seoOverviewResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    saveProductSeo: (accessToken, productId, input, options) =>
      request(`/admin/seo/products/${segment(productId)}`, noContent, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    saveCategorySeo: (accessToken, categoryId, input, options) =>
      request(`/admin/seo/categories/${segment(categoryId)}`, noContent, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    adminStoreProfile: (accessToken, options) =>
      request('/admin/store-profile', storeProfileResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    saveStoreProfile: (accessToken, input, options) =>
      request('/admin/store-profile', storeProfileResponseSchema, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    staffNotifications: (accessToken, query = {}, options) =>
      request(
        `/staff/notifications${queryString({ page: query.page, pageSize: query.pageSize })}`,
        staffNotificationListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    unreadNotifications: (accessToken, options) =>
      request('/staff/notifications/unread-count', unreadNotificationCountSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    markNotificationRead: (accessToken, notificationId, options) =>
      request(`/staff/notifications/${segment(notificationId)}/read`, noContent, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    markAllNotificationsRead: (accessToken, options) =>
      request('/staff/notifications/read-all', unreadNotificationCountSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    myNotifications: (accessToken, query = {}, options) =>
      request(
        `/me/notifications${queryString({ page: query.page, pageSize: query.pageSize, kind: query.kind })}`,
        customerNotificationListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    myUnreadNotifications: (accessToken, options) =>
      request('/me/notifications/unread-count', customerUnreadCountSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    markMyNotificationRead: (accessToken, notificationId, options) =>
      request(`/me/notifications/${segment(notificationId)}/read`, noContent, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    markAllMyNotificationsRead: (accessToken, options) =>
      request('/me/notifications/read-all', customerUnreadCountSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    deleteMyNotifications: (accessToken, ids, options) =>
      request('/me/notifications/delete', customerNotificationsDeletedSchema, {
        ...options,
        ...sendJson('POST', { ids: [...ids] }, bearer(accessToken)),
      }),
    clearMyNotifications: (accessToken, before, options) =>
      request('/me/notifications/clear', customerNotificationsDeletedSchema, {
        ...options,
        ...sendJson('POST', { before }, bearer(accessToken)),
      }),
    notificationPreferences: (accessToken, options) =>
      request('/me/notification-preferences', notificationPreferencesResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    saveNotificationPreferences: (accessToken, patch, options) =>
      request('/me/notification-preferences', notificationPreferencesResponseSchema, {
        ...options,
        ...sendJson('PATCH', patch, bearer(accessToken)),
      }),
    moderatorNotifications: (accessToken, query = {}, options) =>
      request(
        `/moderator/notifications${queryString({ page: query.page, pageSize: query.pageSize })}`,
        staffNotificationListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    moderatorUnreadNotifications: (accessToken, options) =>
      request('/moderator/notifications/unread-count', unreadNotificationCountSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    markModeratorNotificationRead: (accessToken, notificationId, options) =>
      request(`/moderator/notifications/${segment(notificationId)}/read`, noContent, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    markAllModeratorNotificationsRead: (accessToken, options) =>
      request('/moderator/notifications/read-all', unreadNotificationCountSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    adminCustomerInsights: (accessToken, query = {}, options) =>
      request(
        `/admin/insights/customers${queryString({ segment: query.segment, q: query.q, page: query.page, pageSize: query.pageSize })}`,
        customerInsightListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),

    publicOnboarding: (accessToken = null, options) =>
      request('/onboarding', onboardingResponseSchema, {
        ...options,
        ...(accessToken === null ? {} : { headers: bearer(accessToken) }),
      }),
    completeOnboarding: (accessToken, campaignId, options) =>
      request(`/onboarding/${segment(campaignId)}/complete`, noContent, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    adminOnboardingCampaigns: (accessToken, options) =>
      request('/admin/onboarding', onboardingCampaignListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminOnboardingCampaign: (accessToken, campaignId, options) =>
      request(`/admin/onboarding/${segment(campaignId)}`, onboardingCampaignResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    createOnboardingCampaign: (accessToken, input, options) =>
      request('/admin/onboarding', onboardingCampaignResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    updateOnboardingCampaign: (accessToken, campaignId, input, options) =>
      request(`/admin/onboarding/${segment(campaignId)}`, onboardingCampaignResponseSchema, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    deleteOnboardingCampaign: (accessToken, campaignId, options) =>
      request(`/admin/onboarding/${segment(campaignId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    setOnboardingCampaignActive: (accessToken, campaignId, active, options) =>
      request(`/admin/onboarding/${segment(campaignId)}/active`, noContent, {
        ...options,
        ...sendJson('POST', { active }, bearer(accessToken)),
      }),
    previewOnboardingCampaign: (accessToken, campaignId, options) =>
      request(`/admin/onboarding/${segment(campaignId)}/preview`, onboardingPreviewResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    createOnboardingSlide: (accessToken, campaignId, input, options) =>
      request(`/admin/onboarding/${segment(campaignId)}/slides`, onboardingSlideResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    updateOnboardingSlide: (accessToken, campaignId, slideId, input, options) =>
      request(
        `/admin/onboarding/${segment(campaignId)}/slides/${segment(slideId)}`,
        onboardingSlideResponseSchema,
        { ...options, ...sendJson('PUT', input, bearer(accessToken)) },
      ),
    deleteOnboardingSlide: (accessToken, campaignId, slideId, options) =>
      request(`/admin/onboarding/${segment(campaignId)}/slides/${segment(slideId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    reorderOnboardingSlides: (accessToken, campaignId, slideIds, options) =>
      request(`/admin/onboarding/${segment(campaignId)}/slides/reorder`, noContent, {
        ...options,
        ...sendJson('POST', { slideIds }, bearer(accessToken)),
      }),

    publicPopup: (options) => request('/popups', popupResponseSchema, options),
    publicPopups: (platform, options) =>
      request(`/popups?platform=${platform}`, popupResponseSchema, options),
    adminPopups: (accessToken, options) =>
      request('/admin/popups', adminPopupListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminPopup: (accessToken, popupId, options) =>
      request(`/admin/popups/${segment(popupId)}`, adminPopupResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    savePopup: (accessToken, popupId, input, options) =>
      request(
        popupId === null ? '/admin/popups' : `/admin/popups/${segment(popupId)}`,
        adminPopupResponseSchema,
        { ...options, ...sendJson(popupId === null ? 'POST' : 'PUT', input, bearer(accessToken)) },
      ),
    setPopupActive: (accessToken, popupId, active, options) =>
      request(`/admin/popups/${segment(popupId)}/active`, noContent, {
        ...options,
        ...sendJson('POST', { active }, bearer(accessToken)),
      }),
    uploadPopupArtwork: (accessToken, popupId, image, options) =>
      request(
        `/admin/popups/${segment(popupId)}/image`,
        adminPopupResponseSchema,
        {
          ...options,
          method: 'POST',
          body: image.bytes as BodyInit,
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
        },
        // A 5 MB picture over a slow connection needs the upload budget, not the API one.
        IMAGE_UPLOAD_TIMEOUT_MS,
      ),
    removePopupArtwork: (accessToken, popupId, options) =>
      request(`/admin/popups/${segment(popupId)}/image`, adminPopupResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    deletePopup: (accessToken, popupId, options) =>
      request(`/admin/popups/${segment(popupId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),

    myCart: (accessToken, options) =>
      request('/me/cart', cartResponseSchema, { ...options, headers: bearer(accessToken) }),
    setCartItem: (accessToken, input, options) =>
      request('/me/cart/items', cartResponseSchema, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    clearMyCart: (accessToken, options) =>
      request('/me/cart/clear', cartResponseSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    startGuestCart: (token, options) =>
      request('/guest/cart', cartResponseSchema, {
        ...options,
        ...sendJson('POST', { token }, {}),
      }),
    setGuestCartItem: (input, options) =>
      request('/guest/cart/items', cartResponseSchema, {
        ...options,
        ...sendJson('PUT', input, {}),
      }),
    clearGuestCart: (token, options) =>
      request('/guest/cart/clear', noContent, { ...options, ...sendJson('POST', { token }, {}) }),
    mergeGuestCart: (accessToken, token, options) =>
      request('/me/cart/merge', cartResponseSchema, {
        ...options,
        ...sendJson('POST', { token }, bearer(accessToken)),
      }),
    voucherCenter: (accessToken, options) =>
      request('/vouchers', voucherListResponseSchema, {
        ...options,
        headers: accessToken ? bearer(accessToken) : {},
      }),
    productVouchers: (slug, accessToken, options) =>
      request(`/vouchers/for-product/${segment(slug)}`, voucherListResponseSchema, {
        ...options,
        headers: accessToken ? bearer(accessToken) : {},
      }),
    myVouchers: (accessToken, options) =>
      request('/me/vouchers', voucherListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    collectVoucher: (accessToken, voucherId, options) =>
      request(`/vouchers/${segment(voucherId)}/collect`, voucherResponseSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    myWishlist: (accessToken, options) =>
      request('/me/wishlist', wishlistResponseSchema, { ...options, headers: bearer(accessToken) }),
    addToWishlist: (accessToken, productId, options) =>
      request('/me/wishlist', wishlistResponseSchema, {
        ...options,
        ...sendJson('POST', { productId }, bearer(accessToken)),
      }),
    removeFromWishlist: (accessToken, productId, options) =>
      request(`/me/wishlist/${segment(productId)}`, wishlistResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    mergeWishlist: (accessToken, slugs, options) =>
      request('/me/wishlist/merge', wishlistResponseSchema, {
        ...options,
        ...sendJson('POST', { slugs: [...slugs] }, bearer(accessToken)),
      }),
    startCheckout: (accessToken, input, options) =>
      request('/checkout/sessions', checkoutSessionResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    checkoutActivity: (accessToken, sessionId, options) =>
      request(`/checkout/sessions/${segment(sessionId)}/activity`, noContent, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    checkoutConverted: (accessToken, sessionId, orderNumber, options) =>
      request(`/checkout/sessions/${segment(sessionId)}/converted`, noContent, {
        ...options,
        ...sendJson('POST', { orderNumber }, bearer(accessToken)),
      }),
    adminListCheckouts: (accessToken, query = {}, options) => {
      const parsed = adminCheckoutListQuerySchema.parse(query);
      return request(
        `/admin/checkouts${queryString({
          status: parsed.status,
          q: parsed.q,
          from: parsed.from,
          to: parsed.to,
          sort: parsed.sort,
          page: parsed.page,
          pageSize: parsed.pageSize,
        })}`,
        checkoutListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      );
    },
    adminGetCheckout: (accessToken, checkoutId, options) =>
      request(`/admin/checkouts/${segment(checkoutId)}`, checkoutResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCheckoutMetrics: (accessToken, query = {}, options) =>
      request(
        `/admin/checkouts/metrics${queryString({ from: query.from, to: query.to })}`,
        checkoutRecoveryMetricsResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminRecordCheckoutAttempt: (accessToken, checkoutId, input, options) =>
      request(`/admin/checkouts/${segment(checkoutId)}/attempts`, checkoutResponseSchema, {
        ...options,
        ...sendJson('POST', recordCheckoutAttemptRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminSetCheckoutRecoveryState: (accessToken, checkoutId, state, options) =>
      request(`/admin/checkouts/${segment(checkoutId)}/state`, checkoutResponseSchema, {
        ...options,
        ...sendJson(
          'POST',
          setCheckoutRecoveryStateRequestSchema.parse({ state }),
          bearer(accessToken),
        ),
      }),
    adminCreateCheckoutRecoveryLink: (accessToken, checkoutId, options) =>
      request(`/admin/checkouts/${segment(checkoutId)}/link`, checkoutRecoveryLinkResponseSchema, {
        ...options,
        method: 'POST',
        headers: bearer(accessToken),
      }),
    adminRevokeCheckoutRecoveryLink: (accessToken, checkoutId, options) =>
      request(`/admin/checkouts/${segment(checkoutId)}/link`, checkoutResponseSchema, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    previewCheckoutRecovery: (token, options) =>
      request(`/checkout/recovery/${segment(token)}`, checkoutRecoveryPreviewSchema, options),
    restoreCheckoutRecovery: (accessToken, token, options) =>
      request(
        `/checkout/recovery/${segment(token)}/restore`,
        checkoutRecoveryRestoreResponseSchema,
        { ...options, method: 'POST', headers: bearer(accessToken) },
      ),

    myReturns: (accessToken, options) =>
      request('/returns', returnListResponseSchema, { ...options, headers: bearer(accessToken) }),
    myReturn: (accessToken, returnId, options) =>
      request(`/returns/${segment(returnId)}`, returnResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    requestReturn: (accessToken, input, options) =>
      request('/returns', returnResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    cancelMyReturn: (accessToken, returnId, options) =>
      request(`/returns/${segment(returnId)}/cancel`, noContent, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    myOrderRefunds: (accessToken, orderNumber, options) =>
      request(`/orders/${segment(orderNumber)}/refunds`, myRefundsResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),

    adminListReturns: (accessToken, query = {}, options) =>
      request(
        `/admin/returns${queryString({ status: query.status, q: query.q, page: query.page, pageSize: query.pageSize })}`,
        returnListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminGetReturn: (accessToken, returnId, options) =>
      request(`/admin/returns/${segment(returnId)}`, returnResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminDecideReturn: (accessToken, returnId, input, options) =>
      request(`/admin/returns/${segment(returnId)}/status`, returnResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminRestockReturn: (accessToken, returnId, note, options) =>
      request(`/admin/returns/${segment(returnId)}/restock`, returnResponseSchema, {
        ...options,
        ...sendJson('POST', note === undefined ? {} : { note }, bearer(accessToken)),
      }),

    adminCourierConfig: (accessToken, options) =>
      request('/admin/couriers/config', courierConfigResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSaveCourierSettings: (accessToken, input, options) =>
      request('/admin/couriers/settings', courierConfigResponseSchema, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    adminSaveCourierProvider: (accessToken, provider, input, options) =>
      request(`/admin/couriers/providers/${segment(provider)}`, courierConfigResponseSchema, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    adminCheckCourier: (accessToken, provider, options) =>
      request(`/admin/couriers/providers/${segment(provider)}/check`, courierCheckResponseSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    adminCreateCourierRateCard: (accessToken, input, options) =>
      request('/admin/couriers/rate-cards', courierRateCardSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminUpdateCourierRateCard: (accessToken, rateCardId, input, options) =>
      request(`/admin/couriers/rate-cards/${segment(rateCardId)}`, courierRateCardSchema, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    adminDeleteCourierRateCard: (accessToken, rateCardId, options) =>
      request(`/admin/couriers/rate-cards/${segment(rateCardId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminSaveCourierLocationMapping: (accessToken, input, options) =>
      request('/admin/couriers/location-mappings', noContent, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminDeleteCourierLocationMapping: (accessToken, mappingId, options) =>
      request(`/admin/couriers/location-mappings/${segment(mappingId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminSaveCourierOperations: (accessToken, input, options) =>
      request('/admin/couriers/operations', courierConfigResponseSchema, {
        ...options,
        ...sendJson('PUT', courierOperationsRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminSetCourierCredential: (accessToken, provider, field, value, options) =>
      request(
        `/admin/couriers/providers/${segment(provider)}/credentials/${segment(field)}`,
        courierConfigResponseSchema,
        { ...options, ...sendJson('PUT', { value }, bearer(accessToken)) },
      ),
    adminClearCourierCredential: (accessToken, provider, field, options) =>
      request(
        `/admin/couriers/providers/${segment(provider)}/credentials/${segment(field)}`,
        courierConfigResponseSchema,
        { ...options, method: 'DELETE', headers: bearer(accessToken) },
      ),
    adminSaveCourierBaseUrl: (accessToken, provider, input, options) =>
      request(
        `/admin/couriers/providers/${segment(provider)}/base-url`,
        courierConfigResponseSchema,
        {
          ...options,
          ...sendJson('PUT', input, bearer(accessToken)),
        },
      ),
    adminSetCourierLiveVerification: (accessToken, provider, input, options) =>
      request(
        `/admin/couriers/providers/${segment(provider)}/live-verification`,
        courierConfigResponseSchema,
        { ...options, ...sendJson('PUT', input, bearer(accessToken)) },
      ),
    adminBulkOrderStatus: (accessToken, input, options) =>
      request('/admin/orders/bulk/status', bulkOrderStatusResponseSchema, {
        ...options,
        ...sendJson('POST', bulkOrderStatusRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminBulkOrderSummaries: (accessToken, orderNumbers, options) =>
      request('/admin/orders/bulk/summaries', bulkOrderSummariesResponseSchema, {
        ...options,
        ...sendJson('POST', { orderNumbers }, bearer(accessToken)),
      }),
    adminBulkCourierCheck: (accessToken, orderNumbers, options) =>
      request('/admin/orders/bulk/courier-check', bulkCourierCheckResponseSchema, {
        ...options,
        ...sendJson('POST', { orderNumbers }, bearer(accessToken)),
      }),
    adminBulkBookShipments: (accessToken, input, options) =>
      request('/admin/orders/bulk/shipments', bulkShipmentBookingResponseSchema, {
        ...options,
        ...sendJson('POST', bulkShipmentBookingRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminCourierOverview: (accessToken, query = {}, options) =>
      request(
        `/admin/couriers/overview${queryString({ includeMock: query.includeMock ? 'true' : undefined })}`,
        courierOverviewResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminOrderCourierContext: (accessToken, orderNumber, options) =>
      request(`/admin/orders/${segment(orderNumber)}/courier`, orderCourierContextSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCompareCouriers: (accessToken, orderNumber, input, options) =>
      request(
        `/admin/orders/${segment(orderNumber)}/courier/quotes`,
        courierCompareResponseSchema,
        {
          ...options,
          ...sendJson('POST', input, bearer(accessToken)),
        },
      ),
    adminBookShipment: (accessToken, orderNumber, input, options) =>
      request(`/admin/orders/${segment(orderNumber)}/shipments`, bookShipmentResponseSchema, {
        ...options,
        ...sendJson('POST', bookShipmentRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminOrderShipments: (accessToken, orderNumber, options) =>
      request(`/admin/orders/${segment(orderNumber)}/shipments`, shipmentHistoryResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminListShipments: (accessToken, query = {}, options) => {
      const parsed = adminShipmentListQuerySchema.parse(query);
      return request(
        `/admin/shipments${queryString({
          status: parsed.status,
          provider: parsed.provider,
          kind: parsed.kind,
          q: parsed.q,
          from: parsed.from,
          to: parsed.to,
          includeMock: parsed.includeMock ? 'true' : undefined,
          page: parsed.page,
          pageSize: parsed.pageSize,
        })}`,
        shipmentListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      );
    },
    adminGetShipment: (accessToken, shipmentId, options) =>
      request(`/admin/shipments/${segment(shipmentId)}`, shipmentDetailResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminResolveShipmentBooking: (accessToken, shipmentId, input, options) =>
      request(`/admin/shipments/${segment(shipmentId)}/resolve`, shipmentSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminCancelShipment: (accessToken, shipmentId, input, options) =>
      request(`/admin/shipments/${segment(shipmentId)}/cancel`, shipmentSchema, {
        ...options,
        ...sendJson('POST', cancelShipmentRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminRefreshShipment: (accessToken, shipmentId, options) =>
      request(`/admin/shipments/${segment(shipmentId)}/refresh`, refreshShipmentResponseSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    adminRecordShipmentStatus: (accessToken, shipmentId, input, options) =>
      request(
        `/admin/shipments/${segment(shipmentId)}/events`,
        recordShipmentStatusResponseSchema,
        {
          ...options,
          ...sendJson('POST', input, bearer(accessToken)),
        },
      ),
    adminReturnShipments: (accessToken, returnId, options) =>
      request(`/admin/returns/${segment(returnId)}/shipments`, shipmentHistoryResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminBookReturnPickup: (accessToken, returnId, input, options) =>
      request(`/admin/returns/${segment(returnId)}/pickup`, bookShipmentResponseSchema, {
        ...options,
        ...sendJson('POST', bookReturnPickupRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminBookExchangeShipment: (accessToken, returnId, input, options) =>
      request(`/admin/returns/${segment(returnId)}/exchange`, bookShipmentResponseSchema, {
        ...options,
        ...sendJson('POST', bookExchangeShipmentRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminRecordPortalBooking: (accessToken, orderNumber, input, options) =>
      request(`/admin/orders/${segment(orderNumber)}/shipments/portal`, shipmentSchema, {
        ...options,
        ...sendJson('POST', recordPortalBookingRequestSchema.parse(input), bearer(accessToken)),
      }),
    adminCodPositions: (accessToken, query = {}, options) => {
      const parsed = codPositionListQuerySchema.parse(query);
      return request(
        `/admin/couriers/cod${queryString({
          provider: parsed.provider,
          status: parsed.status,
          includeMock: parsed.includeMock ? 'true' : undefined,
          page: parsed.page,
          pageSize: parsed.pageSize,
        })}`,
        codPositionListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      );
    },
    adminRecordCodCollected: (accessToken, shipmentId, input, options) =>
      request(
        `/admin/shipments/${segment(shipmentId)}/cod/collected`,
        shipmentDetailResponseSchema,
        {
          ...options,
          ...sendJson('POST', input, bearer(accessToken)),
        },
      ),
    adminRecordCodAdjustment: (accessToken, shipmentId, input, options) =>
      request(
        `/admin/shipments/${segment(shipmentId)}/cod/adjustments`,
        shipmentDetailResponseSchema,
        { ...options, ...sendJson('POST', input, bearer(accessToken)) },
      ),
    adminSetCodState: (accessToken, shipmentId, input, options) =>
      request(`/admin/shipments/${segment(shipmentId)}/cod/state`, shipmentDetailResponseSchema, {
        ...options,
        ...sendJson('PUT', input, bearer(accessToken)),
      }),
    adminListCourierSettlements: (accessToken, query = {}, options) => {
      const parsed = courierSettlementListQuerySchema.parse(query);
      return request(
        `/admin/couriers/settlements${queryString({
          provider: parsed.provider,
          includeMock: parsed.includeMock ? 'true' : undefined,
          page: parsed.page,
          pageSize: parsed.pageSize,
        })}`,
        courierSettlementListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      );
    },
    adminRecordCourierSettlement: (accessToken, input, options) =>
      request('/admin/couriers/settlements', courierSettlementSchema, {
        ...options,
        ...sendJson('POST', recordCourierSettlementRequestSchema.parse(input), bearer(accessToken)),
      }),
    myOrderShipments: (accessToken, orderNumber, options) =>
      request(`/orders/${segment(orderNumber)}/shipments`, customerShipmentsResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminListRefunds: (accessToken, query = {}, options) =>
      request(
        `/admin/refunds${queryString({ status: query.status, q: query.q, page: query.page, pageSize: query.pageSize })}`,
        refundListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminGetRefund: (accessToken, refundId, options) =>
      request(`/admin/refunds/${segment(refundId)}`, refundResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminRequestRefund: (accessToken, input, options) =>
      request('/admin/refunds', refundResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminDecideRefund: (accessToken, refundId, input, options) =>
      request(`/admin/refunds/${segment(refundId)}/decision`, refundResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminCompleteRefund: (accessToken, refundId, input, options) =>
      request(`/admin/refunds/${segment(refundId)}/completion`, refundResponseSchema, {
        ...options,
        ...sendJson('POST', input, bearer(accessToken)),
      }),
    adminCancelRefund: (accessToken, refundId, note, options) =>
      request(`/admin/refunds/${segment(refundId)}/cancel`, refundResponseSchema, {
        ...options,
        ...sendJson('POST', { note }, bearer(accessToken)),
      }),

    adminListOrders: (accessToken, query = {}, options) =>
      request(
        `/admin/orders${queryString({ status: query.status, paymentStatus: query.paymentStatus, q: query.q, from: query.from, to: query.to, customerId: query.customerId, view: query.view, deliveryZone: query.deliveryZone, sort: query.sort, page: query.page, pageSize: query.pageSize })}`,
        adminOrderListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminGetOrder: (accessToken, orderNumber, options) =>
      request(`/admin/orders/${segment(orderNumber)}`, adminOrderResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminUpdateOrderStatus: (accessToken, orderNumber, body, options) =>
      request(`/admin/orders/${segment(orderNumber)}/status`, adminOrderResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminListBroadcasts: (accessToken, options) =>
      request('/admin/broadcasts', broadcastListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminCreateBroadcast: (accessToken, body, options) =>
      request('/admin/broadcasts', broadcastCreatedResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminPushSettings: (accessToken, options) =>
      request('/admin/push-settings', pushSettingsSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSavePushSettings: (accessToken, body, options) =>
      request('/admin/push-settings', pushSettingsSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminOrderInternal: (accessToken, orderNumber, options) =>
      request(`/admin/orders/${segment(orderNumber)}/internal`, orderInternalResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminAddOrderNote: (accessToken, orderNumber, body, options) =>
      request(`/admin/orders/${segment(orderNumber)}/notes`, orderInternalResponseSchema, {
        ...options,
        ...sendJson('POST', { body }, bearer(accessToken)),
      }),
    adminSetOrderArchived: (accessToken, orderNumber, body, options) =>
      request(`/admin/orders/${segment(orderNumber)}/archive`, orderInternalResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminRecordCodCollection: (accessToken, orderNumber, body, options) =>
      request(`/admin/orders/${segment(orderNumber)}/cod-collection`, adminOrderResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),

    adminListCustomers: (accessToken, query = {}, options) =>
      request(
        `/admin/customers${queryString({ q: query.q, status: query.status, page: query.page, pageSize: query.pageSize })}`,
        customerListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminGetCustomer: (accessToken, customerId, options) =>
      request(`/admin/customers/${segment(customerId)}`, customerResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSetCustomerStatus: (accessToken, customerId, body, options) =>
      request(`/admin/customers/${segment(customerId)}/status`, customerResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminListStaff: (accessToken, options) =>
      request('/admin/staff', staffListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminInviteStaff: (accessToken, body, options) =>
      request('/admin/staff/invitations', staffInvitationSentResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminStaffInvitations: (accessToken, options) =>
      request('/admin/staff/invitations', staffInvitationListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminResendStaffInvitation: (accessToken, invitationId, options) =>
      request(
        `/admin/staff/invitations/${segment(invitationId)}/resend`,
        staffInvitationSentResponseSchema,
        { ...options, ...sendJson('POST', {}, bearer(accessToken)) },
      ),
    adminRevokeStaffInvitation: (accessToken, invitationId, options) =>
      request(`/admin/staff/invitations/${segment(invitationId)}/revoke`, noContent, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    staffInvitationPreview: (token, options) =>
      request(`/auth/staff-invitations/${segment(token)}`, staffInvitationPreviewSchema, options),
    acceptStaffInvitation: (body, options) =>
      request('/auth/staff-invitations/accept', z.object({ role: z.enum(INVITABLE_ROLES) }), {
        ...options,
        ...sendJson('POST', body, {}),
      }),
    resendStaffInvitation: (accessToken, userId, options) =>
      request(`/admin/staff/${segment(userId)}/invitation`, staffInvitationResendResponseSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),
    adminSetPermission: (accessToken, userId, body, options) =>
      request(`/admin/staff/${segment(userId)}/permissions`, staffMemberResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),

    moderatorQueue: (accessToken, query = {}, options) =>
      request(
        `/moderator/queue${queryString({ status: query.status, page: query.page, pageSize: query.pageSize })}`,
        moderationTaskListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    moderatorGetTask: (accessToken, taskId, options) =>
      request(`/moderator/tasks/${segment(taskId)}`, moderationTaskResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    moderatorDecide: (accessToken, taskId, body, options) =>
      request(`/moderator/tasks/${segment(taskId)}/decision`, moderationTaskResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminListModeration: (accessToken, query = {}, options) =>
      request(
        `/admin/moderation${queryString({ scope: query.scope, status: query.status, page: query.page, pageSize: query.pageSize })}`,
        moderationTaskListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminListReviewers: (accessToken, options) =>
      request('/admin/moderation/reviewers', moderationReviewerListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminGetModerationTask: (accessToken, taskId, options) =>
      request(`/admin/moderation/${segment(taskId)}`, moderationTaskResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminAssignModeration: (accessToken, taskId, body, options) =>
      request(`/admin/moderation/${segment(taskId)}/assignment`, moderationTaskResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminWithdrawModeration: (accessToken, taskId, options) =>
      request(`/admin/moderation/${segment(taskId)}/withdraw`, moderationTaskResponseSchema, {
        ...options,
        ...sendJson('POST', {}, bearer(accessToken)),
      }),

    adminAuditLog: (accessToken, query = {}, options) =>
      request(
        `/admin/audit-log${queryString({ action: query.action, actorId: query.actorId, from: query.from, to: query.to, q: query.q, page: query.page, pageSize: query.pageSize })}`,
        auditLogResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminSalesOverview: (accessToken, query = {}, options) =>
      request(
        `/admin/analytics/sales${queryString({ days: query.days })}`,
        salesOverviewResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminDashboard: (accessToken, options) =>
      request('/admin/dashboard', dashboardResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminListDeliveryCharges: (accessToken, options) =>
      request('/admin/settings/delivery-charges', deliveryChargeListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSetDeliveryCharge: (accessToken, zone, body, options) =>
      request(`/admin/settings/delivery-charges/${segment(zone)}`, deliveryChargeResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminAnalyticsOverview: (accessToken, query, options) =>
      request(
        `/admin/analytics/overview${queryString({
          from: query.from,
          to: query.to,
          // Sent as "true" or "false"; left out, the server compares by default.
          compare: query.compare === undefined ? undefined : String(query.compare),
        })}`,
        analyticsOverviewResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminOrderGeography: (accessToken, query, options) =>
      request(
        `/admin/analytics/orders/geography${queryString({
          from: query.from,
          to: query.to,
          division: query.division,
          district: query.district,
          status: query.status,
          metric: query.metric,
        })}`,
        orderGeographyResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminSetSalesTarget: (accessToken, body, options) =>
      request('/admin/settings/sales-target', salesTargetResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    adminListRoles: (accessToken, options) =>
      request('/admin/roles', adminRolesResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminGetStoreSettings: (accessToken, options) =>
      request('/admin/settings/store', storeSettingsResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSaveStoreSettings: (accessToken, body, options) =>
      request('/admin/settings/store', storeSettingsResponseSchema, {
        ...options,
        ...sendJson('PUT', body, bearer(accessToken)),
      }),
    searchProductsByImage: (image, query, options) => {
      const form = new FormData();
      // React Native ignores the third argument and reads `uri` off the object; the browser
      // uses the file name, which the API never keeps anyway.
      form.append('file', image as Blob, 'query.jpg');
      return request(
        `/search/image${queryString({
          sort: query?.sort,
          page: query?.page,
          pageSize: query?.pageSize,
          client: query?.client,
        })}`,
        imageSearchResponseSchema,
        { ...options, method: 'POST', body: form },
        IMAGE_SEARCH_TIMEOUT_MS,
      );
    },
    findSimilarProducts: (body, query, options) =>
      request(
        `/search/image/similar${queryString({
          sort: query?.sort,
          page: query?.page,
          pageSize: query?.pageSize,
          client: query?.client,
        })}`,
        imageSearchResponseSchema,
        { ...options, ...sendJson('POST', body) },
        IMAGE_SEARCH_TIMEOUT_MS,
      ),
    recordImageSearchClick: (body, options) =>
      request(
        '/search/image/click',
        z.object({ recorded: z.boolean() }),
        { ...options, ...sendJson('POST', body) },
      ),
    resolveScan: (body, options) =>
      request('/scan/resolve', scanResolveResponseSchema, {
        ...options,
        ...sendJson('POST', body),
      }),
    adminImageSearch: (accessToken, options) =>
      request('/admin/image-search', imageSearchStatsSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminSaveImageSearchSettings: (accessToken, body, options) =>
      request('/admin/image-search/settings', imageSearchSettingsSchema, {
        ...options,
        ...sendJson('PATCH', body, bearer(accessToken)),
      }),
    adminStartImageSearchJob: (accessToken, body, options) =>
      request('/admin/image-search/jobs', imageSearchJobSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminImageSearchMissingImages: (accessToken, query, options) =>
      request(
        `/admin/image-search/missing-images${queryString({
          q: query?.q,
          page: query?.page,
          pageSize: query?.pageSize,
        })}`,
        imageSearchMissingImagesResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminImageSearchActivity: (accessToken, query, options) =>
      request(
        `/admin/image-search/activity${queryString({
          q: query?.q,
          page: query?.page,
          pageSize: query?.pageSize,
        })}`,
        imageSearchActivityResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminSlugAvailability: (accessToken, query, options) =>
      request(
        `/admin/slugs/availability${queryString({ kind: query.kind, slug: query.slug, excludeId: query.excludeId })}`,
        slugAvailabilityResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminListMedia: (accessToken, query = {}, options) =>
      request(
        `/admin/media${queryString({ q: query.q, page: query.page, pageSize: query.pageSize })}`,
        mediaListResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminUploadMedia: (accessToken, image, options) => {
      const query = queryString({ alt: image.alt, name: image.name });
      return request(
        `/admin/media${query}`,
        mediaAssetResponseSchema,
        {
          ...options,
          method: 'POST',
          // Raw bytes, deliberately not JSON: the API reads the body as the image itself.
          headers: { ...bearer(accessToken), 'Content-Type': image.contentType },
          body: image.bytes as BodyInit,
        },
        IMAGE_UPLOAD_TIMEOUT_MS,
      );
    },
    adminUpdateMedia: (accessToken, mediaId, body, options) =>
      request(`/admin/media/${segment(mediaId)}`, mediaAssetResponseSchema, {
        ...options,
        ...sendJson('PATCH', body, bearer(accessToken)),
      }),
    adminDeleteMedia: (accessToken, mediaId, options) =>
      request(`/admin/media/${segment(mediaId)}`, noContent, {
        ...options,
        method: 'DELETE',
        headers: bearer(accessToken),
      }),
    adminReportPreview: (accessToken, kind, query, options) =>
      request(
        `/admin/reports/${segment(kind)}/preview${reportQuery(query)}`,
        reportPreviewResponseSchema,
        { ...options, headers: bearer(accessToken) },
      ),
    adminDownloadReport: (accessToken, kind, query, options) =>
      requestFile(
        `/admin/reports/${segment(kind)}/export${reportQuery(query, query.format)}`,
        `nilzora-${kind}.${query.format}`,
        { ...options, headers: bearer(accessToken) },
      ),
    adminCreateExport: (accessToken, body, options) =>
      request('/admin/exports', exportJobResponseSchema, {
        ...options,
        ...sendJson('POST', body, bearer(accessToken)),
      }),
    adminListExports: (accessToken, options) =>
      request('/admin/exports', exportJobListResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminGetExport: (accessToken, exportId, options) =>
      request(`/admin/exports/${segment(exportId)}`, exportJobResponseSchema, {
        ...options,
        headers: bearer(accessToken),
      }),
    adminDownloadExport: (accessToken, exportId, options) =>
      requestFile(`/admin/exports/${segment(exportId)}/download`, 'nilzora-export', {
        ...options,
        headers: bearer(accessToken),
      }),
    adminOrderInvoice: (accessToken, orderNumber, options) =>
      requestFile(
        `/admin/orders/${segment(orderNumber)}/invoice.pdf`,
        `invoice-${orderNumber}.pdf`,
        { ...options, headers: bearer(accessToken) },
      ),
    adminOrderPackingSlip: (accessToken, orderNumber, options) =>
      requestFile(
        `/admin/orders/${segment(orderNumber)}/packing-slip.pdf`,
        `packing-slip-${orderNumber}.pdf`,
        { ...options, headers: bearer(accessToken) },
      ),
  };
}
