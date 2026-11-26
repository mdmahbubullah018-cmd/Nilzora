/**
 * Where the storefront fetches private chat media from.
 *
 * The API answers a message's attachments with its own authorized path
 * (`/chat/attachments/<id>/media`). The browser cannot use that directly — it carries no token —
 * so every address is pointed at this app's same-origin proxy, which forwards the request with
 * the customer's session cookies and lets the API decide whether this account may read it.
 * Nothing here can name another host: the API only ever emits those two path shapes, and both
 * collapse onto one UUID — the only thing the proxy accepts.
 */
const PROXY_PREFIX = '/api/support/media';

/** The two shapes `/chat/attachments` produces: a full file, and a picture's thumbnail. */
const MEDIA_PATH = /^\/chat\/attachments\/([^/?#]+)\/media(\?[^#]*)?$/;

export function chatMediaUrl(path: string): string {
  const match = MEDIA_PATH.exec(path);
  if (match === null) return path;
  // `/chat/attachments/<id>/media?variant=thumb` → `/api/support/media/<id>?variant=thumb`
  return `${PROXY_PREFIX}/${match[1] ?? ''}${match[2] ?? ''}`;
}
