import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  popupMayShow,
  recordPopupShown,
  resetPopupSessionMemory,
} from '../features/popup/popup-history';
import { resetAsyncStorage } from '../test-utils/render-with-providers';

/*
 * The device-side popup rules. The server decides which popup exists; this decides whether this
 * device may be shown it, and it must not leak anything personal: ids and instants only.
 */

const POPUP_ID = '0e000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-12-30T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function popup(
  overrides: Partial<{
    frequency: 'once_per_session' | 'once_per_day' | 'every_visit';
    endsAt: string | null;
  }> = {},
) {
  return {
    id: POPUP_ID,
    frequency: 'once_per_session' as const,
    endsAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  void resetAsyncStorage();
  resetPopupSessionMemory();
});

describe('popupMayShow', () => {
  it('shows once per session, then not again until the app is launched afresh', async () => {
    expect(await popupMayShow(popup(), NOW)).toBe(true);
    await recordPopupShown(popup(), NOW);
    expect(await popupMayShow(popup(), NOW)).toBe(false);

    // A new launch is a new session.
    resetPopupSessionMemory();
    expect(await popupMayShow(popup(), NOW)).toBe(true);
  });

  it('shows once per day, measured from the moment it was shown', async () => {
    const daily = popup({ frequency: 'once_per_day' });
    await recordPopupShown(daily, NOW);

    expect(await popupMayShow(daily, new Date(NOW.getTime() + HOUR))).toBe(false);
    expect(await popupMayShow(daily, new Date(NOW.getTime() + 23 * HOUR))).toBe(false);
    expect(await popupMayShow(daily, new Date(NOW.getTime() + 24 * HOUR))).toBe(true);
  });

  it('never remembers an every-visit popup', async () => {
    const every = popup({ frequency: 'every_visit' });
    await recordPopupShown(every, NOW);
    expect(await popupMayShow(every, NOW)).toBe(true);
    expect(await popupMayShow(every, NOW)).toBe(true);
  });

  it('does not show a popup whose window has closed, even from a cached payload', async () => {
    const ended = popup({ endsAt: new Date(NOW.getTime() - HOUR).toISOString() });
    expect(await popupMayShow(ended, NOW)).toBe(false);
  });

  it('ignores a corrupt record rather than hiding the popup for ever', async () => {
    await AsyncStorage.setItem('nilzora.popup.history.v1', 'not json at all');
    expect(await popupMayShow(popup({ frequency: 'once_per_day' }), NOW)).toBe(true);
  });

  it('keeps one popup’s record from suppressing the next one', async () => {
    const daily = popup({ frequency: 'once_per_day' });
    await recordPopupShown(daily, NOW);
    const next = { ...daily, id: '0e000000-0000-4000-8000-000000000002' };
    expect(await popupMayShow(next, NOW)).toBe(true);
  });
});

describe('once ever', () => {
  it('is shown on a device exactly one time, across launches', async () => {
    const popup = { id: 'once-ever-popup', frequency: 'once_ever' as const, endsAt: null };
    expect(await popupMayShow(popup)).toBe(true);

    await recordPopupShown(popup);
    resetPopupSessionMemory();

    // A new launch (session memory cleared) still remembers it, and a year later too.
    expect(await popupMayShow(popup)).toBe(false);
    expect(await popupMayShow(popup, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))).toBe(false);
  });
});
