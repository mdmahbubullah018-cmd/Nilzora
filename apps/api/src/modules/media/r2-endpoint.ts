/*
 * The Cloudflare R2 S3 endpoint
 * -----------------------------
 * R2 answers S3 requests at `https://<account-id>.r2.cloudflarestorage.com`. The account id
 * is the only part that varies, so it is the only thing configuration carries: no endpoint
 * URL, no region and no bucket are pasted into the environment. This module is the single
 * place that turns that id into an endpoint, so every upload feature (product images,
 * category and brand pictures, banners, the media library, avatars, review photos, store
 * profile and chat attachments) talks to exactly the same address.
 *
 * Validation matters more than it looks. A pasted endpoint URL, a bare host or a value with
 * a stray character still *looks* plausible and produces a host that does not resolve, which
 * surfaces much later as an opaque DNS or signature failure on the first upload. Refusing the
 * value here, with the variable name and the expected shape but never the value itself, makes
 * that a start-up message instead of a mystery.
 *
 * The public address of the bucket is a different thing (see public-url.ts): it is an r2.dev
 * subdomain or a custom domain, it only ever serves reads, and it is never derived from this
 * endpoint. Keeping the two apart is why a misconfigured public base cannot leak the S3 host
 * into a page and why the S3 endpoint never ends up in a URL a customer sees.
 */

/** Cloudflare account ids are 32 hexadecimal characters. */
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const R2_STORAGE_HOST_SUFFIX = '.r2.cloudflarestorage.com';

/** Raised for a configuration value that cannot produce a usable endpoint. Never carries it. */
export class R2EndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R2EndpointError';
  }
}

/**
 * The account id, validated and normalised.
 *
 * `accountId` is trimmed and case-folded: an id copied in upper case is the same account, so
 * it is accepted. Anything that is not exactly 32 hexadecimal characters is refused, which
 * covers the two mistakes worth naming separately — a URL or host pasted in place of the id,
 * and a truncated or elongated id.
 */
export function normalizeR2AccountId(accountId: string): string {
  const candidate = accountId.trim();
  if (candidate === '') {
    throw new R2EndpointError('R2_ACCOUNT_ID: is empty');
  }
  if (candidate.includes('/') || candidate.includes(':') || candidate.includes('.')) {
    throw new R2EndpointError(
      'R2_ACCOUNT_ID: must be the account id alone, not a URL or a host name',
    );
  }
  if (!ACCOUNT_ID_PATTERN.test(candidate.toLowerCase())) {
    throw new R2EndpointError(
      `R2_ACCOUNT_ID: must be the 32-character hexadecimal Cloudflare account id (got ${candidate.length} characters)`,
    );
  }
  return candidate.toLowerCase();
}

/** The S3 endpoint for one account: `https://<account-id>.r2.cloudflarestorage.com`, validated. */
export function resolveR2Endpoint(accountId: string): string {
  const endpoint = new URL(`https://${normalizeR2AccountId(accountId)}${R2_STORAGE_HOST_SUFFIX}`);
  // Belt and braces: the shape above already fixes the scheme, host and absence of extras.
  if (
    endpoint.protocol !== 'https:' ||
    !endpoint.hostname.endsWith(R2_STORAGE_HOST_SUFFIX) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.port !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    endpoint.pathname !== '/'
  ) {
    throw new R2EndpointError('R2_ACCOUNT_ID: does not produce a valid R2 endpoint');
  }
  return endpoint.origin;
}

/**
 * True for the S3 API host family. `R2_PUBLIC_BASE_URL` must never point here: the endpoint
 * requires signed requests, so a browser asking it for an image gets an authorization error.
 */
export function isR2StorageHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return host === R2_STORAGE_HOST_SUFFIX.slice(1) || host.endsWith(R2_STORAGE_HOST_SUFFIX);
}
