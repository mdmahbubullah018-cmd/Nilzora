import type { PublicStoreProfile } from '@nilzora/contracts';

/*
 * App download links
 * ------------------
 * The store profile carries the Google Play and Apple App Store listings (the owner enters them
 * in the admin workspace). `appDownloadLinks(profile)` reads them, so every app area of the site
 * (the header popover, the badges under the trusted strip, the footer) shows only the platforms
 * the store has actually published, and nothing at all when it has published neither. There is no
 * QR image: the badges are the only way in. The checks below decide what is safe to render,
 * whatever the profile holds.
 */

export interface AppDownloadLinks {
  /** The Android listing (https://play.google.com/...), or null when not published. */
  googlePlayUrl: string | null;
  /** The iPhone listing (https://apps.apple.com/...), or null when not published. */
  appStoreUrl: string | null;
}

export const NO_APP_LINKS: AppDownloadLinks = {
  googlePlayUrl: null,
  appStoreUrl: null,
};

/** An https URL on one of the given hosts, without credentials; anything else is refused. */
function httpsUrlOn(value: string | null | undefined, hosts: readonly string[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    if (hosts.length > 0 && !hosts.includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Only an https link to the Google Play website is ever rendered as the Android badge. */
export function playStoreUrl(value: string | null | undefined): string | null {
  return httpsUrlOn(value, ['play.google.com']);
}

/** Only an https link to Apple's App Store website is ever rendered as the iPhone badge. */
export function appStoreUrl(value: string | null | undefined): string | null {
  return httpsUrlOn(value, ['apps.apple.com']);
}

/** True only when at least one store listing is published and safe to link to. */
export function hasAppAction(links: AppDownloadLinks): boolean {
  return playStoreUrl(links.googlePlayUrl) !== null || appStoreUrl(links.appStoreUrl) !== null;
}

/** The app links the store published, validated; none when the profile has none (or is absent). */
export function appDownloadLinks(
  profile: Pick<PublicStoreProfile, 'playStoreUrl' | 'appStoreUrl'> | null = null,
): AppDownloadLinks {
  if (profile === null) return NO_APP_LINKS;
  return {
    googlePlayUrl: playStoreUrl(profile.playStoreUrl),
    appStoreUrl: appStoreUrl(profile.appStoreUrl),
  };
}
