import 'server-only';
import { createApiClient, type ApiClient } from '@nilzora/api-client';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import {
  actWithAccessToken,
  completeGoogleSignIn,
  confirmEmail,
  googleStart,
  register,
  requestPasswordReset,
  resendOtp,
  resetPassword,
  signIn,
  signOut,
  updateProfile,
  verifyOtp,
  type ActionContext,
  type FormState,
  type GoogleSignInOutcome,
  type GoogleStartOutcome,
  type SessionAct,
  type SignInOptions,
  type SignInResult,
} from './actions';
import { apiClientFor } from './api';
import { clearCartCookie, readCartCookie, writeCartCookie, type CartCookie } from './cart-cookie';
import { getApiUrl, getWebSessionConfig, type WebApp } from './config';
import { cookieNames, sessionTokens, type CookieJar } from './cookies';
import { csrfTokenFor, isSameOriginRequest } from './csrf';
import {
  readSession,
  readWithAccessToken,
  type SessionCall,
  type SessionRead,
  type SessionState,
} from './session';

export { ApiError, type ApiClient } from '@nilzora/api-client';
export {
  INITIAL_FORM_STATE,
  FORM_EXPIRED,
  RATE_LIMITED_MESSAGE,
  formStateStatus,
  type FormState,
  type SessionAct,
  type SignInResult,
} from './actions';
export { CART_COOKIE_MAX_LENGTH, cartCookieValueFits, type CartCookie } from './cart-cookie';
export { WebSessionConfigError, getApiUrl, type WebApp } from './config';
export { CSRF_FIELD } from './csrf';
export { safeRedirectPath } from './redirect';
export {
  createSupportGateway,
  type SupportFailure,
  type SupportGateway,
  type SupportResult,
  type SupportSession,
} from './support';
export type { SessionCall, SessionRead, SessionState, SessionUser } from './session';

/** The catalog reads publicApi() offers: public, cacheable and the same for every visitor. */
export type PublicApiClient = Pick<
  ApiClient,
  | 'getHealth'
  | 'listCategories'
  | 'discovery'
  | 'listCampaigns'
  | 'listProducts'
  | 'productFacets'
  | 'getProduct'
  | 'listBrands'
  | 'getBrand'
  | 'listBrandProducts'
  | 'listBanners'
  | 'shoppingZones'
  | 'publicSeo'
  | 'voucherCenter'
  | 'productVouchers'
  | 'publicStoreProfile'
  | 'publicSitePage'
  | 'publicNavigation'
  | 'publicHomepage'
  | 'publicPopup'
  | 'publicPopups'
  | 'sitemap'
>;

type NextCookieStore = Awaited<ReturnType<typeof cookies>>;

function nextCookieJar(store: NextCookieStore): CookieJar {
  return {
    // Cookies the proxy cleared for this request come back as empty values: absent.
    get: (name) => store.get(name)?.value || undefined,
    set: (name, value, options) => store.set(name, value, options),
    // Deleting with the original attributes (Secure, Path) is what lets browsers drop
    // `__Host-` cookies.
    delete: (name, options) => store.set(name, '', { ...options, maxAge: 0 }),
  };
}

export interface WebSession {
  /** The visitor's session, verified with the API once per request. */
  getSession(): Promise<SessionState>;
  /** Value for the hidden CSRF_FIELD input of every state-changing form. */
  csrfToken(): Promise<string>;
  signIn(formData: FormData, options?: SignInOptions): Promise<SignInResult>;
  register(formData: FormData): Promise<FormState>;
  /**
   * Redeems the six-digit code emailed at sign-up. Verifying the address completes
   * registration, so this signs the account in and stores the session.
   */
  verifyOtp(formData: FormData, options?: SignInOptions): Promise<SignInResult>;
  /** Sends a fresh sign-up code; the answer never reveals whether the address exists. */
  resendOtp(formData: FormData): Promise<FormState>;
  /** Emails a password-reset code; the answer never reveals whether the address exists. */
  requestPasswordReset(formData: FormData): Promise<FormState>;
  /** Sets a new password from a reset code and signs this browser out. */
  resetPassword(formData: FormData): Promise<FormState>;
  /**
   * Starts Google sign-in: the caller redirects the browser to the returned URL. The
   * form is CSRF-checked, because it sends the visitor to a third party.
   */
  googleStart(formData: FormData): Promise<GoogleStartOutcome>;
  /**
   * Completes Google sign-in from a callback route: relays the code and state to the API
   * server-side and stores the resulting session as this app's cookies.
   */
  completeGoogleSignIn(input: {
    code?: string | undefined;
    state?: string | undefined;
    /** The `iss` parameter of the authorization response (RFC 9207), forwarded unchanged. */
    iss?: string | undefined;
    error?: string | undefined;
  }): Promise<GoogleSignInOutcome>;
  confirmEmail(formData: FormData): Promise<FormState>;
  signOut(formData: FormData): Promise<FormState>;
  updateProfile(formData: FormData): Promise<FormState>;
  /**
   * An API client for this request that names the visitor's address for the API's
   * per-client rate limits. Reading the request makes the page dynamic: use it in
   * dynamic pages and Server Actions, and publicApi() for cacheable public reads.
   */
  api(): Promise<ApiClient>;
  /**
   * A catalog-only client that carries nothing about the visitor: no address, no client
   * secret, no tokens. It reads neither request headers nor cookies, and needs only
   * NILZORA_API_URL, so cached pages and data may use it; `fetch` lets the caller add
   * caching options such as revalidation. The API counts every call against this
   * server's address, so it offers only cacheable catalog reads: cart quotes, search
   * and everything personal go through api().
   */
  publicApi(options?: { fetch?: typeof fetch }): PublicApiClient;
  /**
   * An authenticated call for Server Components. It never refreshes or writes cookies
   * (pages cannot): the page must be under this app's proxy matcher, which refreshes
   * before rendering; elsewhere a lapsed access token would read as `unavailable`.
   * 401 is `signed_out`; a network failure, timeout or 5xx is `unavailable`; any other
   * error (including 403 account_suspended, which getSession() reports) is rethrown for
   * the page to map, e.g. a 404 to notFound().
   */
  read<T>(call: SessionCall<T>): Promise<SessionRead<T>>;
  /**
   * An authenticated call for Server Actions. A form without this app's Origin and a
   * valid CSRF_FIELD is `untrusted` and reaches no API; the CSRF cookie exists only on
   * pages under the proxy matcher, so forms using act() must live there. Otherwise a 401
   * refreshes the session once (writing the rotated cookies) and retries once; a refused
   * refresh clears the session (`signed_out`) and an undecided one is `unavailable`.
   * Other errors from the call are rethrown for the action to map to messages.
   */
  act<T>(formData: FormData, call: SessionCall<T>): Promise<SessionAct<T>>;
  /**
   * Whether this post comes from this app's exact Origin (and, when the browser says,
   * Sec-Fetch-Site same-origin), without a CSRF token. Only for Server Actions on
   * cacheable public pages, which cannot carry a per-browser token, that change
   * non-privileged state such as the cart: current browsers always send Origin with a
   * post and no other site can set it, and even a bypass would only change a cart the
   * visitor reviews before checkout and the API prices again. Never use it for account,
   * address, checkout or order actions: those need act() and its CSRF token.
   */
  isSameOrigin(): Promise<boolean>;
  /**
   * The storefront cart cookie (see cart-cookie.ts): not a credential, never trusted.
   * `set` and `clear` work only in Server Actions and Route Handlers.
   */
  cartCookie: CartCookie;
}

/**
 * Server-side session access for one web app. Use it from Server Components (reads)
 * and Server Actions (reads and writes); it cannot be imported into client code.
 */
export function createWebSession(app: WebApp): WebSession {
  async function context(): Promise<ActionContext> {
    // Reading the request first marks the page dynamic, so the build never prerenders
    // it and the configuration is only validated when a real request arrives.
    const requestHeaders = await headers();
    const jar = nextCookieJar(await cookies());
    const config = getWebSessionConfig(app);
    return { config, jar, headers: requestHeaders, api: apiClientFor(config, requestHeaders) };
  }

  async function cartJar(): Promise<CookieJar> {
    return nextCookieJar(await cookies());
  }

  return {
    getSession: cache(async () => {
      const ctx = await context();
      const names = cookieNames(ctx.config);
      return readSession(ctx.api, ctx.jar.get(names.access), ctx.jar.get(names.refresh));
    }),
    async csrfToken() {
      const ctx = await context();
      const value = ctx.jar.get(cookieNames(ctx.config).csrf);
      return value ? csrfTokenFor(ctx.config, value) : '';
    },
    signIn: async (formData, options) => signIn(await context(), formData, options),
    register: async (formData) => register(await context(), formData),
    verifyOtp: async (formData, options) => verifyOtp(await context(), formData, options),
    resendOtp: async (formData) => resendOtp(await context(), formData),
    requestPasswordReset: async (formData) => requestPasswordReset(await context(), formData),
    resetPassword: async (formData) => resetPassword(await context(), formData),
    googleStart: async (formData) => googleStart(await context(), formData),
    completeGoogleSignIn: async (input) => completeGoogleSignIn(await context(), input),
    confirmEmail: async (formData) => confirmEmail(await context(), formData),
    signOut: async (formData) => signOut(await context(), formData),
    updateProfile: async (formData) => updateProfile(await context(), formData),
    async api() {
      const requestHeaders = await headers();
      return apiClientFor(getWebSessionConfig(app), requestHeaders);
    },
    publicApi(options = {}) {
      // Only the API's address comes from the configuration; nothing from the request.
      const apiUrl = getApiUrl(app);
      return createApiClient({
        baseUrl: apiUrl,
        fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      });
    },
    async read(call) {
      const ctx = await context();
      return readWithAccessToken(ctx.api, sessionTokens(ctx.jar, ctx.config), call);
    },
    act: async (formData, call) => actWithAccessToken(await context(), formData, call),
    async isSameOrigin() {
      const requestHeaders = await headers();
      return isSameOriginRequest(requestHeaders, getWebSessionConfig(app));
    },
    cartCookie: {
      get: async () => readCartCookie(await cartJar(), getWebSessionConfig(app)),
      set: async (value) => writeCartCookie(await cartJar(), getWebSessionConfig(app), value),
      clear: async () => clearCartCookie(await cartJar(), getWebSessionConfig(app)),
    },
  };
}
