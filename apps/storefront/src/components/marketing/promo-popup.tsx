'use client';

import type { PublicPopup } from '@nilzora/contracts';
import { PromoPopupDialog } from '@nilzora/ui';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * The promotional popup, on the storefront.
 *
 * The server decides whether a popup exists at all (switched on and inside its window). This
 * component owns the two things only the browser knows: how long the visitor has been here, and
 * whether this device has already been shown it.
 *
 *   delay      nothing appears until the popup's own delay (0 to 120 seconds) has passed, measured
 *              from when the layout mounted. A visitor who leaves before then never sees it.
 *   frequency  once ever (localStorage), once per session (sessionStorage), once per day
 *              (localStorage, timestamped), or every visit. Stored per popup id, so a newly published popup is not suppressed by
 *              a record of the previous one.
 *   routes     never on checkout or the sign-in flow: a modal over a payment form, or over a
 *              page whose whole job is to be finished, is the opposite of helpful. A popup that
 *              becomes due while the visitor is there is dropped, not queued for later.
 *
 * The picture is only requested when the popup opens, so a visitor who never reaches the delay
 * downloads nothing, and a popup that fails to load closes instead of leaving an empty card.
 */

/** One key per popup, so replacing the live popup is not suppressed by the old one's record. */
function seenKey(popupId: string): string {
  return `nilzora.popup.${popupId}`;
}

/** Where the visitor must not be interrupted. */
const QUIET_PREFIXES = [
  '/checkout',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-otp',
  '/confirm-email',
  '/auth',
] as const;

function isQuietRoute(pathname: string | null): boolean {
  if (pathname === null) return false;
  return QUIET_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Reads storage without ever throwing: a locked-down browser must not break the page. */
function readStorage(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(store: Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Full, disabled or blocked: the popup simply shows again next time.
  }
}

export interface PromoPopupProps {
  /** Every popup live on the website, best first. */
  popups: readonly PublicPopup[];
  /** Whether a customer is signed in, which the popup's audience is matched against. */
  signedIn: boolean;
}

/** Whether this device's record allows the popup to show again. */
function allowedByFrequency(popup: PublicPopup): boolean {
  const key = seenKey(popup.id);
  if (popup.frequency === 'once_ever') return readStorage(globalThis.localStorage, key) === null;
  if (popup.frequency === 'once_per_session') {
    return readStorage(globalThis.sessionStorage, key) !== '1';
  }
  if (popup.frequency === 'once_per_day') {
    const at = Number(readStorage(globalThis.localStorage, key));
    return !(Number.isFinite(at) && at > 0 && Date.now() - at < 24 * 60 * 60 * 1000);
  }
  return true;
}

export function PromoPopup({ popups, signedIn }: PromoPopupProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  /*
   * Whether the dialog has ever been opened. Nothing is rendered before it is, so the picture
   * is not fetched for a visitor who leaves before the delay; once it has opened the dialog
   * stays mounted, because a closed <dialog> is needed for the fade-out.
   */
  const [mounted, setMounted] = useState(false);
  // Whether the record has been written for this popup in this mount, so a re-render cannot
  // schedule a second appearance after the visitor closes it.
  const recorded = useRef(false);

  const quiet = isQuietRoute(pathname);

  const remember = useCallback((shown: PublicPopup) => {
    if (recorded.current) return;
    recorded.current = true;
    if (shown.frequency === 'every_visit') return;
    const key = seenKey(shown.id);
    if (shown.frequency === 'once_per_session') {
      writeStorage(globalThis.sessionStorage, key, '1');
      return;
    }
    // Once per day and once ever both live in localStorage; the timestamp serves either.
    writeStorage(globalThis.localStorage, key, String(Date.now()));
  }, []);

  // The popup that was chosen to show: the first, in priority order, whose audience fits this
  // visitor and whose frequency rule this device allows. Chosen in the effect because only the
  // browser knows what this device has seen.
  const [popup, setPopup] = useState<PublicPopup | null>(null);

  useEffect(() => {
    if (quiet) return;
    const chosen =
      popups.find(
        (candidate) =>
          (candidate.audience === 'all' ||
            (candidate.audience === 'logged_in' ? signedIn : !signedIn)) &&
          allowedByFrequency(candidate),
      ) ?? null;
    if (chosen === null) return;
    const timer = globalThis.setTimeout(() => {
      setPopup(chosen);
      setMounted(true);
      setOpen(true);
      remember(chosen);
    }, chosen.delaySeconds * 1000);
    return () => globalThis.clearTimeout(timer);
  }, [popups, signedIn, quiet, remember]);

  if (popup === null || !mounted) return null;

  return (
    <PromoPopupDialog
      open={open}
      onOpenChange={setOpen}
      label={popup.imageAlt ?? popup.title ?? 'Promotion'}
      closeLabel="Close this promotion"
      onImageError={() => setOpen(false)}
      content={{
        displayMode: popup.displayMode,
        imageUrl: popup.imageUrl,
        imageWidth: popup.imageWidth,
        imageHeight: popup.imageHeight,
        isAnimated: popup.isAnimated,
        imageAlt: popup.imageAlt,
        title: popup.title,
        subtitle: popup.subtitle,
        description: popup.description,
        buttonLabel: popup.buttonLabel,
        buttonHref: popup.buttonHref,
      }}
    />
  );
}
