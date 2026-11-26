import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  guestMaySee,
  readGuestHistory,
  recordGuestCompletion,
  type GuestRules,
} from '../features/onboarding/onboarding-history';
import { resetAsyncStorage } from '../test-utils/render-with-providers';

/*
 * The device-side frequency rules. A visitor without an account has no server record, so
 * these rules decide whether the campaign is due, and they must not leak anything personal.
 */

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const CAMPAIGN_ID = '33333333-3333-4333-8333-000000000001';
const NOW = new Date('2026-11-07T09:00:00.000Z');

function rules(overrides: Partial<GuestRules> = {}): GuestRules {
  return {
    id: CAMPAIGN_ID,
    frequency: 'once_per_campaign',
    repeatDays: null,
    endsAt: null,
    ...overrides,
  };
}

beforeEach(resetAsyncStorage);

describe('guestMaySee', () => {
  it('shows a once-per-campaign announcement to a device that has never seen it', () => {
    expect(guestMaySee(rules(), {}, NOW)).toBe(true);
  });

  it('does not show the same once-per-campaign announcement twice', () => {
    const history = { [CAMPAIGN_ID]: { completedAt: NOW.toISOString(), views: 1 } };
    expect(guestMaySee(rules(), history, NOW)).toBe(false);
  });

  it('shows a first-launch sequence only on a device with no campaign history at all', () => {
    expect(guestMaySee(rules({ frequency: 'first_launch' }), {}, NOW)).toBe(true);
    expect(
      guestMaySee(
        rules({ frequency: 'first_launch' }),
        { 'another-campaign': { completedAt: NOW.toISOString(), views: 1 } },
        NOW,
      ),
    ).toBe(false);
  });

  it('shows an every-launch campaign on every visit', () => {
    const history = { [CAMPAIGN_ID]: { completedAt: NOW.toISOString(), views: 4 } };
    expect(guestMaySee(rules({ frequency: 'every_launch' }), history, NOW)).toBe(true);
  });

  it('waits out the repeat interval before showing the campaign again', () => {
    const seen = new Date('2026-11-01T09:00:00.000Z').toISOString();
    const history = { [CAMPAIGN_ID]: { completedAt: seen, views: 1 } };
    const interval = rules({ frequency: 'interval', repeatDays: 7 });

    expect(guestMaySee(interval, history, new Date('2026-11-05T09:00:00.000Z'))).toBe(false);
    expect(guestMaySee(interval, history, new Date('2026-11-08T09:00:00.000Z'))).toBe(true);
  });

  it('never shows a campaign whose end has passed, whatever the frequency', () => {
    expect(
      guestMaySee(
        rules({ endsAt: '2026-11-07T08:59:59.000Z', frequency: 'every_launch' }),
        {},
        NOW,
      ),
    ).toBe(false);
    expect(
      guestMaySee(
        rules({ endsAt: '2026-11-07T09:00:00.000Z', frequency: 'every_launch' }),
        {},
        NOW,
      ),
    ).toBe(false);
    expect(
      guestMaySee(
        rules({ endsAt: '2026-11-08T09:00:00.000Z', frequency: 'every_launch' }),
        {},
        NOW,
      ),
    ).toBe(true);
  });
});

describe('guest history storage', () => {
  it('starts empty and records a completion', async () => {
    expect(await readGuestHistory()).toEqual({});

    await recordGuestCompletion(CAMPAIGN_ID, NOW);

    expect(await readGuestHistory()).toEqual({
      [CAMPAIGN_ID]: { completedAt: NOW.toISOString(), views: 1 },
    });
  });

  it('counts views without moving the completion time that the interval runs from', async () => {
    await recordGuestCompletion(CAMPAIGN_ID, NOW);
    await recordGuestCompletion(CAMPAIGN_ID, new Date('2026-11-20T09:00:00.000Z'));

    const history = await readGuestHistory();
    expect(history[CAMPAIGN_ID]).toEqual({ completedAt: NOW.toISOString(), views: 2 });
  });

  it('keeps campaigns apart', async () => {
    await recordGuestCompletion(CAMPAIGN_ID, NOW);
    await recordGuestCompletion('44444444-4444-4444-8444-000000000002', NOW);

    expect(Object.keys(await readGuestHistory())).toHaveLength(2);
  });

  it('holds no personal data beyond campaign ids and times', async () => {
    await recordGuestCompletion(CAMPAIGN_ID, NOW);

    const raw = JSON.stringify(await readGuestHistory());
    expect(raw).not.toMatch(/@/);
    expect(raw).not.toMatch(/token|email|user|device/i);
  });

  it('treats unreadable storage as no history', async () => {
    await AsyncStorage.setItem('nilzora.onboarding.history.v1', 'not json');

    expect(await readGuestHistory()).toEqual({});
  });

  it('drops entries that are not a campaign record', async () => {
    await AsyncStorage.setItem(
      'nilzora.onboarding.history.v1',
      JSON.stringify({ good: { completedAt: NOW.toISOString(), views: 2 }, bad: 'nope' }),
    );

    expect(await readGuestHistory()).toEqual({
      good: { completedAt: NOW.toISOString(), views: 2 },
    });
  });
});
