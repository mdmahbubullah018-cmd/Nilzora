/*
 * Share targets
 * -------------
 * One description of "what is being shared", built the same way by every Nilzora client: a
 * title, one short factual line, the canonical public address, and — when one is published —
 * a picture.
 *
 * The address is the part that matters for safety. It is always assembled from the storefront's
 * own configured origin plus a path this module recognises as public, so a share can never point
 * at the admin workspace, an account or checkout page, an API route, or another host.
 *
 * This module parses and joins addresses itself instead of using the `URL` class. It runs in the
 * browser, in Node and in React Native, and Hermes only ships a partial `URL` implementation —
 * a share link is too important to depend on that. The grammar accepted here is deliberately
 * narrow: http(s), a host with nothing in front of it, and an absolute path.
 *
 * Nothing here invents catalogue facts: the title and the line come from the record being shared,
 * and a share never carries a price, a discount or an availability claim that the caller did not
 * supply.
 */

export const SHARE_KINDS = ['product', 'category', 'brand', 'store'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** Long catalogue copy is cut at a word boundary rather than mid-word. */
const MAX_TITLE = 200;
const MAX_TEXT = 240;

/** `scheme://host[:port]`, optionally followed by the base's own path, which is ignored. */
const ORIGIN = /^(https?):\/\/([^/?#@\\\s]+)(\/[^?#\\\s]*)?$/i;

/** An absolute http(s) picture address; nothing else is ever published in a share card. */
const IMAGE_URL = /^https?:\/\/[^/?#@\\\s]+(\/[^\s\\]*)?$/i;

const ENCODED_SEPARATOR = /%2f|%5c/i;

/**
 * The first path segment of anything that is never public, whoever asks.
 *
 * A brand lives at `/<brand-slug>` and a static store route always wins over it, so refusing
 * these first segments is what keeps "share this brand" from ever building a private address.
 * The API also refuses brand slugs equal to a store path, so the two lists cannot drift apart.
 */
const PRIVATE_SEGMENTS: ReadonlySet<string> = new Set([
  'account',
  'admin',
  'api',
  'auth',
  'cart',
  'checkout',
  'confirm-email',
  'forgot-password',
  'login',
  'moderator',
  'register',
  'reset-password',
  'search',
  'support',
  'verify-otp',
  'wishlist',
]);

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  const kept = boundary > max / 2 ? cut.slice(0, boundary) : cut;
  return `${kept.trimEnd()}…`;
}

/**
 * The scheme and host of the storefront, or null when `base` is not one this store may claim.
 * Credentials (`user:pass@`) and anything after the host are refused, and the base's own path is
 * dropped: every address built here is absolute, exactly as `new URL('/x', 'https://h/shop')`
 * would resolve.
 */
export function originOf(base: string): string | null {
  const match = ORIGIN.exec(base.trim());
  if (match === null) return null;
  const scheme = (match[1] ?? '').toLowerCase();
  const host = (match[2] ?? '').toLowerCase();
  if (scheme === '' || host === '') return null;
  return `${scheme}://${host}`;
}

/**
 * Whether a site path may be shared. Absolute-looking paths (`//host`, `/\host`) are refused
 * because a browser reads them as another origin, not as a path on this site.
 */
export function shareablePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
  const segment = (path.slice(1).split(/[/?#]/)[0] ?? '').toLowerCase();
  return segment === '' || !PRIVATE_SEGMENTS.has(segment);
}

/**
 * A path that cannot climb out of itself. Dot segments are what turn `/products/../../admin`
 * into the admin page once a browser resolves it, so a path containing one is refused outright
 * rather than normalised — an encoded separator is refused for the same reason.
 */
function climbsOut(path: string): boolean {
  for (const raw of path.split('/')) {
    if (raw === '') continue;
    if (ENCODED_SEPARATOR.test(raw)) return true;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return true;
    }
    if (segment === '.' || segment === '..') return true;
    if (segment.includes('/') || segment.includes('\\')) return true;
  }
  return false;
}

/**
 * The canonical public address of `path` on `base`, or null when it is not one this store may
 * claim. The query and fragment are dropped: filters, page numbers and review anchors describe a
 * view of a page, not the page itself, and a token in a query string must never be forwarded.
 */
export function absoluteShareUrl(path: string, base: string): string | null {
  const origin = originOf(base);
  if (origin === null) return null;
  const bare = path.split(/[?#]/)[0] ?? '';
  if (bare.includes('\\') || climbsOut(bare) || !shareablePath(bare)) return null;
  return `${origin}${bare}`;
}

/** A picture is only ever an absolute http(s) address without credentials. */
function safeImage(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || !IMAGE_URL.test(trimmed) || climbsOut(trimmed)) return null;
  return trimmed;
}

export interface ShareSource {
  kind: ShareKind;
  /** The record's own name, as the store publishes it. */
  title: string;
  /** The record's own summary or description, when it has one. */
  description?: string | null;
  /** A site path, e.g. `/products/clay-mug`. */
  path: string;
  /** The storefront's configured origin, e.g. `https://nilzora.com.bd`. */
  base: string;
  /** An absolute public image address, when the record has a published picture. */
  imageUrl?: string | null;
}

export interface ShareTarget {
  kind: ShareKind;
  title: string;
  /** One line: the name, then the store's own description when there is one. */
  text: string;
  /** The canonical public address. */
  url: string;
  imageUrl: string | null;
}

/** What a client actually shares, or null when there is nothing safe to point at. */
export function shareTarget(source: ShareSource): ShareTarget | null {
  const title = clamp(oneLine(source.title), MAX_TITLE);
  if (title === '') return null;
  const url = absoluteShareUrl(source.path, source.base);
  if (url === null) return null;
  const description = oneLine(source.description ?? '');
  return {
    kind: source.kind,
    title,
    text: description === '' ? title : clamp(`${title} — ${description}`, MAX_TEXT),
    url,
    imageUrl: safeImage(source.imageUrl ?? null),
  };
}

/**
 * The message a native share sheet carries. Android's `Share.share` ignores a separate `url`
 * field and sends only `message`, so the address has to be part of the text there.
 */
export function shareMessage(target: ShareTarget): string {
  return `${target.text}\n${target.url}`;
}
