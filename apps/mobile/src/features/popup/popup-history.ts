import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * Popup history
 * -------------
 * A promotional popup is shown at most as often as its own frequency allows, and the only party
 * that knows what this device has already seen is the device. Nothing here is uploaded: it holds
 * a popup id and the instant it was shown, never anything about the person.
 *
 *   once_ever          remembered on the device for good: shown one time, then never again.
 *   once_per_session   remembered for this launch only, in memory: closing the app and opening
 *                      it again is a new session, which is what "session" means on a phone
 *                      (there is no tab to close).
 *   once_per_day       remembered on the device for 24 hours.
 *   every_visit        never remembered here.
 *
 * Clearing the app's storage simply means the popup may be shown once more, which is the honest
 * behaviour of a device that has forgotten.
 */

const POPUP_HISTORY_KEY = 'nilzora.popup.history.v1';

/** Session memory for this launch, keyed by popup id. */
const sessionSeen = new Set<string>();

export type PopupFrequency = 'once_ever' | 'once_per_session' | 'once_per_day' | 'every_visit';

type PopupHistory = Readonly<Record<string, string>>;

/** Reads the stored record; an unreadable or corrupt value is treated as no history at all. */
async function readHistory(): Promise<PopupHistory> {
  try {
    const raw = await AsyncStorage.getItem(POPUP_HISTORY_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const history: Record<string, string> = {};
    for (const [popupId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      if (Number.isNaN(new Date(value).getTime())) continue;
      history[popupId] = value;
    }
    return history;
  } catch {
    return {};
  }
}

/**
 * Whether this device may be shown the popup now. `endsAt` is honoured too: a popup that has
 * already ended never appears, even from a cached payload.
 */
export async function popupMayShow(
  popup: { id: string; frequency: PopupFrequency; endsAt: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  if (popup.endsAt !== null) {
    const endsAt = new Date(popup.endsAt);
    if (!Number.isNaN(endsAt.getTime()) && endsAt.getTime() <= now.getTime()) return false;
  }
  if (popup.frequency === 'every_visit') return true;
  if (popup.frequency === 'once_per_session') return !sessionSeen.has(popup.id);

  const history = await readHistory();
  const shownAt = history[popup.id];
  if (shownAt === undefined) return true;
  if (popup.frequency === 'once_ever') return false;
  const shown = new Date(shownAt).getTime();
  if (Number.isNaN(shown)) return true;
  return shown + 24 * 60 * 60 * 1000 <= now.getTime();
}

/** Records that this device has been shown the popup, under its own frequency rule. */
export async function recordPopupShown(
  popup: { id: string; frequency: PopupFrequency },
  now: Date = new Date(),
): Promise<void> {
  if (popup.frequency === 'every_visit') return;
  if (popup.frequency === 'once_per_session') {
    sessionSeen.add(popup.id);
    return;
  }
  try {
    const history = { ...(await readHistory()), [popup.id]: now.toISOString() };
    await AsyncStorage.setItem(POPUP_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable: the worst case is seeing the popup once more.
  }
}

/** Forgets this launch's in-memory records (used by the tests). */
export function resetPopupSessionMemory(): void {
  sessionSeen.clear();
}
