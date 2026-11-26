import 'server-only';
import type { ApiClient } from '@nilzora/web-session';

/** A file the API sent (an export, a report or an order document). */
type DownloadedFile = Awaited<ReturnType<ApiClient['adminOrderInvoice']>>;

/*
 * Downloads through the admin app
 * --------------------------------
 * The browser never calls the API itself: report exports, export-job files and order
 * documents are fetched by the admin server with the visitor's session and streamed back
 * from a route handler. The API checks every permission and writes the audit row; these
 * helpers only shape the answer and refuse cross-site requests (a download link on another
 * site must not make a signed-in admin's browser fetch store data).
 */

/** A safe attachment filename: letters, digits, dots and hyphens only. */
export function safeFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.length > 0 && cleaned.length <= 120 ? cleaned : fallback;
}

/** The file as an attachment that is never cached or sniffed. */
export function fileResponse(file: DownloadedFile, fallbackName: string): Response {
  // A copy on a plain ArrayBuffer (the client may hand back a view on a shared buffer).
  return new Response(file.bytes.slice(), {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${safeFileName(file.fileName, fallbackName)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Whether a request came from another site. Browsers send Sec-Fetch-Site on navigations
 * and fetches; `none` (typed address, bookmark) and `same-origin` are fine. Without the
 * header (older browsers, tools) the session cookie (SameSite=Lax) still applies.
 */
export function isCrossSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === 'cross-site' || site === 'same-site';
}

/** A plain-text refusal (the API's own message is never passed through). */
export function refusal(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
