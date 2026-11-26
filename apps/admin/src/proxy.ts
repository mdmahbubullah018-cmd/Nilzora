import { createSessionProxy } from '@nilzora/web-session/proxy';

/**
 * Keeps session cookies current (CSRF cookie, token refresh) before every page and
 * Server Action. It never decides access: each page verifies the session with the API.
 */
export const proxy = createSessionProxy('admin');

export const config = {
  // Everything except build assets and icons, so every page and Server Action is covered.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|apple-icon.png).*)'],
};
