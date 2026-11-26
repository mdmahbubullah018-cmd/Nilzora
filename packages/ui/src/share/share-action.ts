/*
 * Sharing from a browser
 * ----------------------
 * One implementation of "share this address", used by every web control in the monorepo so the
 * storefront and the admin cannot drift apart.
 *
 * Order of preference:
 *   1. the platform share sheet (Web Share API), which is what a phone and a modern desktop
 *      browser offer — it is the real share, not an imitation;
 *   2. the clipboard, when the sheet is unavailable or refuses;
 *   3. the legacy copy command, for a browser that exposes neither.
 *
 * A cancelled sheet is `cancelled`, not a failure: the shopper changed their mind. A genuine
 * failure to share still tries to copy, because a copied link is a useful outcome — and the
 * caller is told exactly which of the two happened, so it can never show a success message for
 * an operation that did not take place.
 */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareRequest {
  title: string;
  text: string;
  /** The address being shared. A receipt has none, so the text itself is what gets copied. */
  url?: string;
}

/**
 * The last-resort copy: a temporary, off-screen field and the old selection command, which is
 * the only route left when `navigator.clipboard` is missing (an insecure origin, an old WebView).
 */
function legacyCopy(value: string): boolean {
  if (typeof document === 'undefined') return false;
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '-9999px';
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  field.remove();
  return copied;
}

/** Puts `value` on the clipboard, by whichever route this browser offers. */
export async function copyToClipboard(value: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // A denied permission or an insecure origin: the legacy route may still work.
    }
  }
  return legacyCopy(value);
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Shares `request` and reports what actually happened. Never throws: a caller renders the
 * outcome, so a rejected share cannot become an unhandled rejection in a click handler.
 */
export async function runShare(request: ShareRequest): Promise<ShareOutcome> {
  const platform = typeof navigator === 'undefined' ? undefined : navigator;
  if (platform !== undefined && typeof platform.share === 'function') {
    let usable = true;
    if (typeof platform.canShare === 'function') {
      try {
        usable = platform.canShare(request);
      } catch {
        // A browser that throws from canShare cannot share this payload either.
        usable = false;
      }
    }
    if (usable) {
      try {
        await platform.share(request);
        return 'shared';
      } catch (error) {
        if (isAbort(error)) return 'cancelled';
        // A refused sheet (no target, a policy): fall through to the clipboard.
      }
    }
  }
  return (await copyToClipboard(request.url ?? request.text)) ? 'copied' : 'failed';
}
