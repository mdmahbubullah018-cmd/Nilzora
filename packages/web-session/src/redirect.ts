const BASE = 'http://nilzora.invalid';
const MAX_LENGTH = 512;

/** Backslashes (read as `/` by browsers) and control characters (stripped by URL parsing). */
function hasUnsafeCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === '\\' || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Turns an untrusted `next` value into a same-origin path under one of the allowed
 * prefixes, or returns the fallback. Absolute URLs, protocol-relative (`//host`) and
 * backslash forms, control characters and paths outside the allowed areas are refused,
 * so a crafted sign-in link cannot send the user to another site.
 */
export function safeRedirectPath(
  value: unknown,
  allowedPrefixes: readonly string[],
  fallback: string,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//') || hasUnsafeCharacter(value)) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  // Dot segments can normalise to a protocol-relative path (`/.//evil.com` becomes
  // `//evil.com`), which a browser would follow to another site.
  if (url.origin !== BASE || url.pathname.startsWith('//')) return fallback;

  const allowed = allowedPrefixes.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  );
  return allowed ? `${url.pathname}${url.search}` : fallback;
}
