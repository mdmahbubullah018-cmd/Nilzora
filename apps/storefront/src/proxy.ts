import { createSessionProxy } from '@nilzora/web-session/proxy';

/**
 * Keeps session cookies current (CSRF cookie, token refresh) before account and
 * checkout pages and their Server Actions run. Pages still verify every session with
 * the API.
 */
export const proxy = createSessionProxy('storefront');

export const config = {
  // `/api/support` is included so the chat widget gets a fresh access token and a CSRF cookie
  // before it writes, from pages that are cached and carry neither.
  //
  // `/products/:path+` is included for the customer's review form: a product page reads the
  // customer's own review (which needs a live access token), and both the Server Action that
  // saves the review and the Route Handler that uploads its photos are posted from it. Without
  // the refresh here, a session older than the access token's life looked signed out — the page
  // offered "Sign in to review" to a signed-in customer, and the submit answered "Your session
  // has ended". `:path+` keeps the all-products listing outside the proxy, so browsing stays
  // cookie-free. The proxy still decides nothing about access.
  matcher: [
    '/account/:path*',
    '/checkout',
    '/login',
    '/register',
    '/confirm-email',
    '/products/:path+',
    '/api/support',
    '/api/support/:path*',
    '/api/uploads/:path*',
  ],
};
