import type { PublicOnboarding, PublicOnboardingSlide } from '@nilzora/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { completeBrandIntro } from '../features/onboarding/brand-intro-store';
import { OnboardingGate } from '../features/onboarding/onboarding-gate';
import { recordGuestCompletion } from '../features/onboarding/onboarding-history';
import { beginSplash, finishSplash, resetSplashStateForTests } from '../startup/splash-state';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, setPathname } from '../test-utils/expo-router-mock';
import { renderWithProviders, resetAsyncStorage } from '../test-utils/render-with-providers';
import { FAKE_ACCESS_TOKEN } from '../test-utils/session-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const CAMPAIGN_ID = '55555555-5555-4555-8555-000000000001';

function slide(n: number): PublicOnboardingSlide {
  return {
    id: `66666666-6666-4666-8666-00000000000${String(n)}`,
    heading: `Slide ${String(n)} heading`,
    description: `Slide ${String(n)} description`,
    imageUrl: null,
    icon: 'shop',
    ctaLabel: null,
    ctaPath: null,
    altText: null,
    position: n,
  };
}

function campaign(overrides: Partial<PublicOnboarding> = {}): PublicOnboarding {
  return {
    id: CAMPAIGN_ID,
    kind: 'promotion',
    frequency: 'once_per_campaign',
    repeatDays: null,
    slideSeconds: 10,
    endsAt: null,
    slides: [slide(1), slide(2)],
    ...overrides,
  };
}

/** A viewer that asked for the campaign and got one. */
async function renderGateWith(
  response: { campaign: PublicOnboarding | null },
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  const api = createFakeApiClient();
  api.publicOnboarding.mockResolvedValue(response);
  api.completeOnboarding.mockResolvedValue(undefined);
  const harness = await renderWithProviders(<OnboardingGate />, { api, ...options });
  return { ...harness, api };
}

beforeEach(async () => {
  resetRouterMock();
  await resetAsyncStorage();
  // These tests are about the Admin-managed campaign, which a first launch holds back while
  // the app's own introduction is shown: mark the introduction as seen, as a returning
  // customer's device would.
  await completeBrandIntro();
});

describe('OnboardingGate', () => {
  it("shows the app's own introduction on a fresh install, before any campaign", async () => {
    await resetAsyncStorage();
    await renderGateWith({ campaign: campaign() }, { session: { status: 'signed_out' } });

    expect(await screen.findByTestId('brand-intro-overlay')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Slide 1 heading' })).not.toBeOnTheScreen();
  });

  it('does not follow the introduction with a campaign in the same launch', async () => {
    await resetAsyncStorage();
    await renderGateWith({ campaign: campaign() }, { session: { status: 'signed_out' } });

    await screen.findByTestId('brand-intro-overlay');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('brand-intro-overlay')).not.toBeOnTheScreen();
    });
    // The campaign waits for a later launch instead of appearing back to back.
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
  });

  it('shows an active campaign to a first-time visitor', async () => {
    await renderGateWith({ campaign: campaign() }, { session: { status: 'signed_out' } });

    expect(await screen.findByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();
  });

  describe('with the launch splash', () => {
    afterEach(() => {
      resetSplashStateForTests();
    });

    it('shows a campaign that was known before the splash left', async () => {
      beginSplash();
      await renderGateWith({ campaign: campaign() }, { session: { status: 'signed_out' } });
      await screen.findByRole('header', { name: 'Slide 1 heading', includeHiddenElements: true });
      await act(() => {
        finishSplash();
      });
      expect(screen.getByTestId('onboarding-overlay')).toBeOnTheScreen();
    });

    it('holds back a campaign that arrives after the splash left, until a later launch', async () => {
      beginSplash();
      let answer: (value: { campaign: PublicOnboarding }) => void = () => undefined;
      const api = createFakeApiClient();
      api.publicOnboarding.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      await renderWithProviders(<OnboardingGate />, { api, session: { status: 'signed_out' } });
      await waitFor(() => {
        expect(api.publicOnboarding).toHaveBeenCalled();
      });
      await act(() => {
        finishSplash();
      });
      await act(async () => {
        answer({ campaign: campaign() });
        await Promise.resolve();
      });
      expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
      // Nothing was recorded as seen: the next launch asks again under the same rules.
      expect(api.completeOnboarding).not.toHaveBeenCalled();
    });
  });

  it('asks for the campaign without a token when nobody is signed in', async () => {
    const { api } = await renderGateWith(
      { campaign: campaign() },
      { session: { status: 'signed_out' } },
    );

    await screen.findByRole('header', { name: 'Slide 1 heading' });
    expect(api.publicOnboarding).toHaveBeenCalledWith(null, expect.anything());
  });

  it('asks with the customer token when signed in, and lets the server decide', async () => {
    const { api } = await renderGateWith({ campaign: campaign({ kind: 'welcome' }) });

    expect(await screen.findByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();
    expect(api.publicOnboarding).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, expect.anything());
  });

  it('shows nothing when the server says no campaign is due', async () => {
    const { api } = await renderGateWith({ campaign: null });

    await waitFor(() => {
      expect(api.publicOnboarding).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
  });

  it('shows nothing for a campaign that has no slides', async () => {
    const { api } = await renderGateWith({ campaign: campaign({ slides: [] }) });

    await waitFor(() => {
      expect(api.publicOnboarding).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
  });

  it('stays out of the way when the campaign cannot be loaded', async () => {
    const api = createFakeApiClient();
    api.publicOnboarding.mockRejectedValue(new Error('offline'));
    await renderWithProviders(<OnboardingGate />, { api, session: { status: 'signed_out' } });

    await waitFor(() => {
      expect(api.publicOnboarding).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
    expect(screen.toJSON()).toBeNull();
  });

  it('waits for the session before asking, so a customer is never treated as a guest', async () => {
    const api = createFakeApiClient();
    api.publicOnboarding.mockResolvedValue({ campaign: campaign() });
    const { setSession } = await renderWithProviders(<OnboardingGate />, {
      api,
      session: { status: 'restoring' },
    });

    expect(api.publicOnboarding).not.toHaveBeenCalled();
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();

    await act(async () => {
      await setSession({ status: 'signed_out' });
    });

    expect(await screen.findByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();
  });

  it('does not repeat a once-per-campaign announcement this device already finished', async () => {
    await recordGuestCompletion(CAMPAIGN_ID, new Date());

    await renderGateWith({ campaign: campaign() }, { session: { status: 'signed_out' } });

    await waitFor(() => {
      expect(AsyncStorage.getItem).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
  });

  it('shows a campaign every launch when the admin asked for that', async () => {
    await recordGuestCompletion(CAMPAIGN_ID, new Date());

    await renderGateWith(
      { campaign: campaign({ frequency: 'every_launch' }) },
      { session: { status: 'signed_out' } },
    );

    expect(await screen.findByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();
  });

  it('records a finished sequence on the device and opens the shop for a visitor', async () => {
    setPathname('/shop');
    const { user } = await renderGateWith(
      { campaign: campaign() },
      { session: { status: 'signed_out' } },
    );

    await screen.findByRole('header', { name: 'Slide 1 heading' });
    await user.press(screen.getByRole('button', { name: 'Next' }));
    await user.press(screen.getByRole('button', { name: 'Start Shopping' }));

    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
    });
    const stored = await AsyncStorage.getItem('nilzora.onboarding.history.v1');
    expect(stored).toContain(CAMPAIGN_ID);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('records a finished sequence on the server for a signed-in customer', async () => {
    const { user, api } = await renderGateWith({ campaign: campaign() });

    await screen.findByRole('header', { name: 'Slide 1 heading' });
    await user.press(screen.getByRole('button', { name: 'Next' }));
    await user.press(screen.getByRole('button', { name: 'Start Shopping' }));

    await waitFor(() => {
      expect(api.completeOnboarding).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, CAMPAIGN_ID);
    });
    expect(await AsyncStorage.getItem('nilzora.onboarding.history.v1')).toBeNull();
  });

  it('leaves the current screen alone when the shop is already open', async () => {
    setPathname('/');
    const { user } = await renderGateWith({ campaign: campaign() });

    await screen.findByRole('header', { name: 'Slide 1 heading' });
    await user.press(await screen.findByRole('button', { name: 'Next' }));
    await user.press(screen.getByRole('button', { name: 'Start Shopping' }));

    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('never shows the finished campaign again in the same run', async () => {
    const { user, api } = await renderGateWith({ campaign: campaign() });

    await screen.findByRole('header', { name: 'Slide 1 heading' });
    await user.press(screen.getByRole('button', { name: 'Next' }));
    await user.press(screen.getByRole('button', { name: 'Start Shopping' }));
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
    });

    // Even if the server answered with the same campaign again, it stays closed.
    api.publicOnboarding.mockResolvedValue({ campaign: campaign() });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
  });

  it('closes even when recording the completion fails', async () => {
    const api = createFakeApiClient();
    api.publicOnboarding.mockResolvedValue({ campaign: campaign() });
    api.completeOnboarding.mockRejectedValue(new Error('offline'));
    const { user } = await renderWithProviders(<OnboardingGate />, { api });

    await screen.findByRole('header', { name: 'Slide 1 heading' });
    await user.press(screen.getByRole('button', { name: 'Next' }));
    await user.press(screen.getByRole('button', { name: 'Start Shopping' }));

    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-overlay')).not.toBeOnTheScreen();
    });
  });
});
