import 'server-only';
import type { PublicPopup } from '@nilzora/contracts';
import { attempt } from '@/lib/catalog';
import { session } from '@/lib/session';

/**
 * The promotional popups live on the website, best first (the visitor sees at most one).
 *
 * Deliberately not cached with the rest of the catalog: a popup's schedule, platform and
 * audience gates are evaluated by the database at read time, so a cached answer could keep
 * showing a popup that has just expired — or hide one that was just published. The read is
 * one indexed query, and any failure (module not deployed, an outage, artwork that cannot be
 * resolved) means "no popup", never a broken page.
 */
export async function getPromoPopups(): Promise<PublicPopup[]> {
  const read = await attempt(async () => (await session.publicApi().publicPopups('website')).popups).catch(
    () => ({ kind: 'unavailable' }) as const,
  );
  return read.kind === 'ok' ? read.value : [];
}
