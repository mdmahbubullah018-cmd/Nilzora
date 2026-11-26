import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * Guest campaign history
 * ----------------------
 * A visitor without an account has no server record, so this device remembers which
 * campaigns have been seen. It holds campaign ids, a completion time and a view count —
 * nothing about the person, no device identifier and no account id. Clearing the app's
 * storage simply means the next launch may show a campaign again, which is the honest
 * behaviour of having no account.
 *
 * A signed-in customer never uses this store: the database keeps their history, and the
 * two must not be mixed (a guest's local record must not mark an authenticated campaign
 * as finished).
 */

const GUEST_HISTORY_KEY = 'nilzora.onboarding.history.v1';

export interface GuestHistoryEntry {
  /** When the sequence was finished or skipped, as an ISO instant. */
  completedAt: string;
  /** How many times it was shown. */
  views: number;
}

export type GuestHistory = Readonly<Record<string, GuestHistoryEntry>>;

/** The part of a campaign the device rules need. */
export interface GuestRules {
  id: string;
  frequency: 'first_launch' | 'every_launch' | 'once_per_campaign' | 'interval';
  repeatDays: number | null;
  endsAt: string | null;
}

/** Reads the record; an unreadable or corrupt value is treated as no history at all. */
export async function readGuestHistory(): Promise<GuestHistory> {
  try {
    const raw = await AsyncStorage.getItem(GUEST_HISTORY_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const history: Record<string, GuestHistoryEntry> = {};
    for (const [campaignId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue;
      const entry = value as { completedAt?: unknown; views?: unknown };
      if (typeof entry.completedAt !== 'string') continue;
      if (Number.isNaN(new Date(entry.completedAt).getTime())) continue;
      history[campaignId] = {
        completedAt: entry.completedAt,
        views: typeof entry.views === 'number' && entry.views > 0 ? entry.views : 1,
      };
    }
    return history;
  } catch {
    return {};
  }
}

/** Records that this device finished (or skipped) a campaign. */
export async function recordGuestCompletion(
  campaignId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const history = { ...(await readGuestHistory()) };
    const previous = history[campaignId];
    history[campaignId] = {
      // The first completion is kept: a repeat view does not restart the interval.
      completedAt: previous?.completedAt ?? now.toISOString(),
      views: (previous?.views ?? 0) + 1,
    };
    await AsyncStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable: the worst case is seeing the campaign once more.
  }
}

/**
 * Whether this device may be shown the campaign now.
 *
 * The rules mirror the ones the database applies to an account, so a guest and a customer
 * see the same sequence under the same policy. `endsAt` is honoured here too: a campaign
 * that has already ended never appears, even if it was cached.
 */
export function guestMaySee(
  campaign: GuestRules,
  history: GuestHistory,
  now: Date = new Date(),
): boolean {
  if (campaign.endsAt !== null) {
    const endsAt = new Date(campaign.endsAt);
    if (!Number.isNaN(endsAt.getTime()) && endsAt.getTime() <= now.getTime()) return false;
  }

  const entry = history[campaign.id];
  switch (campaign.frequency) {
    case 'every_launch':
      return true;
    case 'first_launch':
      // Never onboarded on this device at all.
      return Object.keys(history).length === 0;
    case 'once_per_campaign':
      return entry === undefined;
    case 'interval': {
      if (entry === undefined) return true;
      const days = campaign.repeatDays ?? 0;
      const completed = new Date(entry.completedAt).getTime();
      if (Number.isNaN(completed)) return true;
      return completed + days * 24 * 60 * 60 * 1000 <= now.getTime();
    }
  }
}
