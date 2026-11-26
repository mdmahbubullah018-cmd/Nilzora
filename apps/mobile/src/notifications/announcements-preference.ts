import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * The product-announcement choice, per device
 * -------------------------------------------
 * Two separate things decide whether a customer is told about a new product:
 *   - the phone's own notification permission (asked for by the app, owned by the system);
 *   - this device's opt-in, which is what the API stores so it never sends an announcement to
 *     someone who did not ask for one.
 *
 * The local copy exists so the switch shows the right state without a request, and so a
 * device whose account never reached the API still remembers what the customer chose. It is
 * keyed by account: one customer's choice is never shown to another signed-in account on the
 * same phone.
 */

const KEY_PREFIX = 'nilzora.push.announcements.';

type Listener = () => void;
const listeners = new Set<Listener>();
const cache = new Map<string, boolean>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever a remembered choice changes. */
export function subscribeAnnouncements(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The remembered choice for an account; false when it never made one. */
export async function readAnnouncementsChoice(userId: string): Promise<boolean> {
  const remembered = cache.get(userId);
  if (remembered !== undefined) return remembered;
  try {
    const value = (await AsyncStorage.getItem(`${KEY_PREFIX}${userId}`)) === 'on';
    cache.set(userId, value);
    return value;
  } catch {
    return false;
  }
}

/** Remembers the choice for an account. A storage failure only costs the cache. */
export async function writeAnnouncementsChoice(userId: string, enabled: boolean): Promise<void> {
  cache.set(userId, enabled);
  notify();
  try {
    await AsyncStorage.setItem(`${KEY_PREFIX}${userId}`, enabled ? 'on' : 'off');
  } catch {
    // The API already knows; the next launch simply asks the customer again if needed.
  }
}
