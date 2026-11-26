import type { PublicOnboarding, PublicOnboardingSlide } from '@nilzora/contracts';
import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { AppState, Dimensions, type AppStateStatus } from 'react-native';
import { OnboardingScreen } from '../features/onboarding/onboarding-screen';

/*
 * The presentation half of the campaign system: a campaign document in, a sequence out.
 * Timers are the whole point here, so every test drives them explicitly.
 */

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const WIDTH = Dimensions.get('window').width;

function slide(n: number, overrides: Partial<PublicOnboardingSlide> = {}): PublicOnboardingSlide {
  return {
    id: `11111111-1111-4111-8111-00000000000${String(n)}`,
    heading: `Slide ${String(n)} heading`,
    description: `Slide ${String(n)} description`,
    imageUrl: null,
    icon: 'shop',
    ctaLabel: null,
    ctaPath: null,
    altText: null,
    position: n,
    ...overrides,
  };
}

function campaign(overrides: Partial<PublicOnboarding> = {}): PublicOnboarding {
  return {
    id: '22222222-2222-4222-8222-000000000001',
    kind: 'welcome',
    frequency: 'first_launch',
    repeatDays: null,
    slideSeconds: 5,
    endsAt: null,
    slides: [slide(1), slide(2), slide(3)],
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('OnboardingScreen', () => {
  it('opens on the first slide and keeps Skip hidden for the first three seconds', async () => {
    await render(<OnboardingScreen campaign={campaign()} onFinish={jest.fn()} />);

    expect(screen.getByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Onboarding page' })).toHaveAccessibilityValue({
      min: 1,
      max: 3,
      now: 1,
    });
    expect(screen.queryByRole('button', { name: 'Skip the introduction' })).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Next' })).toBeOnTheScreen();

    await act(() => {
      jest.advanceTimersByTime(2999);
    });
    expect(screen.queryByRole('button', { name: 'Skip the introduction' })).not.toBeOnTheScreen();

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Skip the introduction' })).toBeOnTheScreen();
  });

  it('advances on its own after the configured five seconds', async () => {
    await render(
      <OnboardingScreen campaign={campaign({ slideSeconds: 5 })} onFinish={jest.fn()} />,
    );

    await act(() => {
      jest.advanceTimersByTime(4999);
    });
    expect(screen.getByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByRole('header', { name: 'Slide 2 heading' })).toBeOnTheScreen();
  });

  it('advances every three seconds for a three-second campaign', async () => {
    await render(
      <OnboardingScreen campaign={campaign({ slideSeconds: 3 })} onFinish={jest.fn()} />,
    );

    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('header', { name: 'Slide 2 heading' })).toBeOnTheScreen();

    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('header', { name: 'Slide 3 heading' })).toBeOnTheScreen();
  });

  it('waits ten seconds per slide for a ten-second campaign', async () => {
    await render(
      <OnboardingScreen campaign={campaign({ slideSeconds: 10 })} onFinish={jest.fn()} />,
    );

    await act(() => {
      jest.advanceTimersByTime(9999);
    });
    expect(screen.getByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByRole('header', { name: 'Slide 2 heading' })).toBeOnTheScreen();
  });

  it('lets someone move on immediately with Next, without waiting for the timer', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<OnboardingScreen campaign={campaign()} onFinish={jest.fn()} />);

    await user.press(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('progressbar', { name: 'Onboarding page' })).toHaveAccessibilityValue({
      now: 2,
    });
    expect(screen.getByRole('header', { name: 'Slide 2 heading' })).toBeOnTheScreen();
  });

  it('follows a swipe on the pager', async () => {
    await render(<OnboardingScreen campaign={campaign()} onFinish={jest.fn()} />);

    await fireEvent(screen.getByTestId('onboarding-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: WIDTH * 2, y: 0 } },
    });

    expect(screen.getByRole('header', { name: 'Slide 3 heading' })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Onboarding page' })).toHaveAccessibilityValue({
      now: 3,
    });
  });

  it('ends on Start Shopping, and finishing is never reported twice', async () => {
    const onFinish = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<OnboardingScreen campaign={campaign()} onFinish={onFinish} />);

    await user.press(screen.getByRole('button', { name: 'Next' }));
    await user.press(screen.getByRole('button', { name: 'Next' }));

    // The last slide replaces Skip with the finishing action.
    expect(screen.queryByRole('button', { name: 'Skip the introduction' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Start Shopping' }));
    expect(onFinish).toHaveBeenCalledTimes(1);

    // A timer that fires after the sequence ended must not report a second finish.
    await act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('skips the remaining slides and finishes once', async () => {
    const onFinish = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<OnboardingScreen campaign={campaign()} onFinish={onFinish} />);

    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    await user.press(screen.getByRole('button', { name: 'Skip the introduction' }));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('finishes by itself when the last slide times out', async () => {
    const onFinish = jest.fn();
    await render(
      <OnboardingScreen
        campaign={campaign({ slideSeconds: 3, slides: [slide(1)] })}
        onFinish={onFinish}
      />,
    );

    await act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('uses the slide call to action as the last button and passes its destination on', async () => {
    const onFinish = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(
      <OnboardingScreen
        campaign={campaign({
          slides: [
            slide(1),
            slide(2, { ctaLabel: 'Shop the new arrivals', ctaPath: '/shop?sort=newest' }),
          ],
        })}
        onFinish={onFinish}
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Next' }));
    await user.press(screen.getByRole('button', { name: 'Shop the new arrivals' }));

    // The store path is translated to the app's own Shop screen, keeping its sort.
    expect(onFinish).toHaveBeenCalledWith({ pathname: '/shop', params: { sort: 'newest' } });
  });

  it('offers a middle slide call to action as a link that also finishes', async () => {
    const onFinish = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(
      <OnboardingScreen
        campaign={campaign({
          slides: [slide(1, { ctaLabel: 'Browse categories', ctaPath: '/categories' }), slide(2)],
        })}
        onFinish={onFinish}
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Browse categories' }));

    expect(onFinish).toHaveBeenCalledWith('/categories');
  });

  it('opens the app screen for a storefront path, never the raw website address', async () => {
    const onFinish = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(
      <OnboardingScreen
        campaign={campaign({
          slides: [slide(1, { ctaLabel: 'Start shopping', ctaPath: '/products' })],
        })}
        onFinish={onFinish}
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Start shopping' }));

    expect(onFinish).toHaveBeenCalledWith({ pathname: '/shop', params: {} });
  });

  it('does not advance while the app is in the background', async () => {
    const listeners: ((status: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      listeners.push(handler);
      return { remove: jest.fn() };
    });

    await render(
      <OnboardingScreen campaign={campaign({ slideSeconds: 3 })} onFinish={jest.fn()} />,
    );

    await act(() => {
      jest.advanceTimersByTime(2000);
      for (const listener of listeners) listener('background');
    });

    // Well past the slide duration: nothing may happen behind the customer's back.
    await act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole('header', { name: 'Slide 1 heading' })).toBeOnTheScreen();

    await act(() => {
      for (const listener of listeners) listener('active');
    });
    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('header', { name: 'Slide 2 heading' })).toBeOnTheScreen();
  });

  it('shows a slide illustration, and its icon when there is no image', async () => {
    await render(
      <OnboardingScreen
        campaign={campaign({
          slides: [
            slide(1, {
              imageUrl: 'https://media.example.test/brand/hero/full.webp',
              altText: 'A parcel',
            }),
          ],
        })}
        onFinish={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('A parcel')).toBeOnTheScreen();
  });

  it('falls back to the icon when the illustration fails to load', async () => {
    await render(
      <OnboardingScreen
        campaign={campaign({
          slides: [
            slide(1, {
              imageUrl: 'https://media.example.test/brand/hero/full.webp',
              altText: 'A parcel',
            }),
          ],
        })}
        onFinish={jest.fn()}
      />,
    );

    const image = screen.getByLabelText('A parcel');
    await fireEvent(image, 'error');

    expect(screen.queryByLabelText('A parcel')).not.toBeOnTheScreen();
    expect(screen.getByText('Slide 1 heading')).toBeOnTheScreen();
  });

  it('exposes only the slide in view to a screen reader', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<OnboardingScreen campaign={campaign()} onFinish={jest.fn()} />);

    expect(screen.getByTestId('onboarding-slide-0')).toHaveProp(
      'accessibilityElementsHidden',
      false,
    );
    expect(screen.getByTestId('onboarding-slide-1', { includeHiddenElements: true })).toHaveProp(
      'accessibilityElementsHidden',
      true,
    );
    expect(screen.queryByTestId('onboarding-slide-1')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByTestId('onboarding-slide-1')).toHaveProp(
      'accessibilityElementsHidden',
      false,
    );
  });
});
