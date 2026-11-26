import { shareMessage, shareTarget, type ShareTarget } from '@nilzora/contracts';
import { Share } from 'react-native';

/*
 * Passing a page on, from the app
 * -------------------------------
 * Android's own share sheet, opened through React Native's `Share` — the real system sheet with
 * whatever messaging and social apps the phone actually has, not a picture of one.
 *
 * The link is the customer storefront's own address, taken from EXPO_PUBLIC_STOREFRONT_URL, and
 * `shareTarget` refuses anything that is not a public page on that origin. Android ignores a
 * separate `url` field and sends only `message`, so the address is part of the message; iOS reads
 * both. When the build has no storefront address there is nothing honest to share, so the action
 * is simply not offered — each `*ShareTarget` returns null.
 */

/**
 * The storefront's address. Written out in full because Expo inlines only this exact form.
 *
 * In a development build the variable may be left unset; the app then points at the storefront
 * that runs beside the API it already talks to (same host, port 3000), which is where `expo start`
 * puts it. That is a development convenience only: a release build shares nothing unless it has
 * been given an address, because guessing one there would put a wrong link into a customer's hands.
 */
export function storefrontBaseUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_STOREFRONT_URL?.trim() ?? '';
  if (configured !== '') return configured;
  if (!__DEV__) return null;
  const api = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? '';
  const parts = /^([a-z]+):\/\/([^/:]+)/i.exec(api);
  return parts === null ? null : `${parts[1] ?? 'http'}://${parts[2] ?? 'localhost'}:3000`;
}

export interface ShareableProduct {
  slug: string;
  name: string;
  summary: string | null;
  imageUrl: string | null;
}

/** What this app would put on the sheet for `product`, or null when it cannot build a link. */
export function productShareTarget(product: ShareableProduct): ShareTarget | null {
  const base = storefrontBaseUrl();
  if (base === null) return null;
  return shareTarget({
    kind: 'product',
    title: product.name,
    description: product.summary,
    path: `/products/${encodeURIComponent(product.slug)}`,
    base,
    imageUrl: product.imageUrl,
  });
}

/** A category or a brand: the same public page the website's own share button points at. */
export interface ShareableCollection {
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
}

/**
 * The category's public page. The storefront serves categories under `/categories/<slug>`; the
 * slug is encoded so a value that is not a plain word cannot escape the path.
 */
export function categoryShareTarget(category: ShareableCollection): ShareTarget | null {
  const base = storefrontBaseUrl();
  if (base === null) return null;
  return shareTarget({
    kind: 'category',
    title: category.name,
    description: category.description,
    path: `/categories/${encodeURIComponent(category.slug)}`,
    base,
    imageUrl: category.imageUrl,
  });
}

/** The brand's public page, which the storefront serves at the site root: `/<slug>`. */
export function brandShareTarget(brand: ShareableCollection): ShareTarget | null {
  const base = storefrontBaseUrl();
  if (base === null) return null;
  return shareTarget({
    kind: 'brand',
    title: brand.name,
    description: brand.description,
    path: `/${encodeURIComponent(brand.slug)}`,
    base,
    imageUrl: brand.imageUrl,
  });
}

/** What the customer ended up doing with the sheet. */
export type ShareProductOutcome = 'shared' | 'dismissed' | 'failed' | 'unavailable';

/**
 * Opens the sheet for one target. Never throws: the caller turns the outcome into a message, so a
 * failed share cannot surface as an unhandled promise rejection. A null target means this build
 * has no link to hand over, which is reported as 'unavailable' rather than as a failure.
 */
async function openSheet(target: ShareTarget | null): Promise<ShareProductOutcome> {
  if (target === null) return 'unavailable';
  try {
    const result = await Share.share({
      title: target.title,
      message: shareMessage(target),
      url: target.url,
    });
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}

/** Opens the sheet for one product. */
export function shareProduct(product: ShareableProduct): Promise<ShareProductOutcome> {
  return openSheet(productShareTarget(product));
}

/** Opens the sheet for one category. */
export function shareCategory(category: ShareableCollection): Promise<ShareProductOutcome> {
  return openSheet(categoryShareTarget(category));
}

/** Opens the sheet for one brand. */
export function shareBrand(brand: ShareableCollection): Promise<ShareProductOutcome> {
  return openSheet(brandShareTarget(brand));
}
