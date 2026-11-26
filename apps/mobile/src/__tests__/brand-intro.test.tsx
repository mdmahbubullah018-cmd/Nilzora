import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { BrandOnboarding } from '../features/onboarding/brand-onboarding';
import {
  BRAND_INTRO_VERSION,
  brandIntroSeen,
  completeBrandIntro,
} from '../features/onboarding/brand-intro-store';
import { ONBOARDING_COPY } from '../features/onboarding/onboarding-copy';
import { renderWithProviders, resetAsyncStorage } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const en = ONBOARDING_COPY;

/** The progress indicator the screen shows for the current step. */
function dots(): { now: number; max: number } {
  const node = screen.getByRole('progressbar', { name: en.progressLabel });
  const value = node.props.accessibilityValue as { now: number; max: number };
  return { now: value.now, max: value.max };
}

beforeEach(async () => {
  await resetAsyncStorage();
});

describe('BrandOnboarding', () => {
  it('teaches the five steps in order, each on a miniature of the real screen', async () => {
    await renderWithProviders(<BrandOnboarding onFinish={() => undefined} />);

    expect(en.steps.map((step) => step.id)).toEqual([
      'browse',
      'photos',
      'variants',
      'cart',
      'order',
    ]);
    for (const [index, step] of en.steps.entries()) {
      expect(screen.getByTestId(`brand-intro-slide-${String(index)}`)).toBeOnTheScreen();
      // The demo for that step is drawn, with its own testID.
      expect(
        screen.getByTestId(`onboarding-demo-${step.id}`, { includeHiddenElements: true }),
      ).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: step.title })).toBeOnTheScreen();
    }
    expect(dots()).toEqual({ now: 1, max: 5 });
  });

  it('moves forward with Next and back with Previous, keeping the dots in step', async () => {
    const { user } = await renderWithProviders(<BrandOnboarding onFinish={() => undefined} />);

    await user.press(screen.getByRole('button', { name: en.next }));
    expect(dots().now).toBe(2);
    // The first step has nothing to go back to, so Previous appears only from the second.
    await user.press(screen.getByRole('button', { name: en.next }));
    expect(dots().now).toBe(3);

    await user.press(screen.getByRole('button', { name: en.previous }));
    expect(dots().now).toBe(2);
    await user.press(screen.getByRole('button', { name: en.previous }));
    expect(dots().now).toBe(1);
    expect(screen.queryByRole('button', { name: en.previous })).not.toBeOnTheScreen();
  });

  it('ends with Start shopping on the last step, and finishes exactly once', async () => {
    const onFinish = jest.fn();
    const { user } = await renderWithProviders(<BrandOnboarding onFinish={onFinish} />);

    for (let step = 0; step < en.steps.length - 1; step += 1) {
      await user.press(screen.getByRole('button', { name: en.next }));
    }
    expect(dots().now).toBe(5);
    expect(screen.queryByRole('button', { name: en.next })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: en.start }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('shows the miniature screens as decoration, never as controls', async () => {
    await renderWithProviders(<BrandOnboarding onFinish={() => undefined} />);

    for (const step of en.steps) {
      const demo = screen.getByTestId(`onboarding-demo-${step.id}`, {
        includeHiddenElements: true,
      });
      // Hidden from screen readers: the headline and body are the instruction, the picture is
      // not a second, unlabelled screen.
      expect(demo.props['aria-hidden']).toBe(true);
    }
  });

  it('steps back with the Android Back button, and leaves the first step to the system', async () => {
    type BackListener = Parameters<typeof BackHandler.addEventListener>[1];
    const handlers: BackListener[] = [];
    const add = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler);
        return {
          remove: () => {
            handlers.splice(handlers.indexOf(handler), 1);
          },
        };
      });
    const pressBack = async () => {
      let handled = false;
      await act(async () => {
        handled = handlers.some(
          (handler) => handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) === true,
        );
        await Promise.resolve();
      });
      return handled;
    };
    try {
      const onFinish = jest.fn();
      const { user } = await renderWithProviders(<BrandOnboarding onFinish={onFinish} />);
      await user.press(screen.getByRole('button', { name: en.next }));
      await user.press(screen.getByRole('button', { name: en.next }));
      expect(dots().now).toBe(3);

      expect(await pressBack()).toBe(true);
      expect(dots().now).toBe(2);
      expect(await pressBack()).toBe(true);
      expect(dots().now).toBe(1);
      // On the first step Back is not taken: the system handles it as it always did.
      expect(await pressBack()).toBe(false);
      expect(dots().now).toBe(1);
      expect(onFinish).not.toHaveBeenCalled();
    } finally {
      add.mockRestore();
    }
  });

  it('leaves from any step with Skip', async () => {
    const onFinish = jest.fn();
    const { user } = await renderWithProviders(<BrandOnboarding onFinish={onFinish} />);

    await user.press(screen.getByRole('button', { name: en.skip }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('offers no language switch: the tutorial is English only, like the shop', async () => {
    await renderWithProviders(<BrandOnboarding onFinish={() => undefined} />);

    expect(screen.queryByRole('button', { name: 'বাংলা' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'EN' })).not.toBeOnTheScreen();
    // The header holds the logo and Skip, nothing else a shopper can press.
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: en.skip })).toBeOnTheScreen();
  });

  it('contains no Bangla copy anywhere in its words', () => {
    const everyString = [
      en.progressLabel,
      en.skip,
      en.skipHint,
      en.next,
      en.nextHint,
      en.previous,
      en.previousHint,
      en.start,
      ...en.steps.flatMap((step) => [step.lead, step.highlight, step.title, step.body]),
      ...Object.values(en.demo),
    ];
    for (const value of everyString) {
      // U+0980–U+09FF is the Bengali block. The one character the tutorial keeps from it is
      // the taka sign (৳) in the demo price, which is the currency symbol every Nilzora price
      // already uses — a symbol, not a word.
      expect(value.replaceAll('৳', '')).not.toMatch(/[\u0980-\u09FF]/);
    }
  });
});

describe('brand introduction memory', () => {
  it('is unseen on a fresh install and seen once it is finished', async () => {
    expect(await brandIntroSeen()).toBe(false);
    await completeBrandIntro();
    expect(await brandIntroSeen()).toBe(true);
  });

  it('remembers the completion across a restart, under a versioned key', async () => {
    await completeBrandIntro();

    // A "restart" is a fresh read of the same storage.
    expect(await brandIntroSeen()).toBe(true);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).toContain(`nilzora.onboarding.intro.v${String(BRAND_INTRO_VERSION)}`);
  });

  it('treats storage that cannot be read as "not seen", rather than blocking the launch', async () => {
    const getItem = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    await waitFor(async () => {
      expect(await brandIntroSeen()).toBe(false);
    });
    getItem.mockRestore();
  });
});
