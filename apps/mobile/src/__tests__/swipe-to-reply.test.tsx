import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { REPLY_THRESHOLD, SwipeToReply } from '@/features/support/swipe-to-reply';

/*
 * Gestures never fire under Jest (see native-animation-mocks.tsx), so the gesture this
 * component configures is captured and its callbacks are driven directly, the way the native
 * handler would call them.
 */

interface PanConfig {
  enabled: boolean;
  activeOffsetX: [number, number];
  failOffsetX: [number, number];
  failOffsetY: [number, number];
  onActivate: () => void;
  onUpdate: (event: { translationX: number }) => void;
  onDeactivate: (event: { canceled: boolean }) => void;
}

let mockCaptured: PanConfig | null = null;

jest.mock('react-native-gesture-handler', () => ({
  __esModule: true,
  GestureDetector: ({ children }: { children: ReactNode }) => children,
  usePanGesture: (config: unknown) => {
    mockCaptured = config as PanConfig;
    return { type: 'pan', config };
  },
}));

function swipe(distance: number, canceled = false) {
  if (mockCaptured === null) throw new Error('no gesture configured');
  mockCaptured.onActivate();
  mockCaptured.onUpdate({ translationX: distance });
  mockCaptured.onDeactivate({ canceled });
}

describe('<SwipeToReply>', () => {
  beforeEach(() => {
    mockCaptured = null;
  });

  it('only starts on a deliberate rightward move, and a vertical move fails it', async () => {
    await render(
      <SwipeToReply enabled onReply={() => undefined}>
        <Text>Hello</Text>
      </SwipeToReply>,
    );
    expect(screen.getByText('Hello')).toBeOnTheScreen();
    expect(mockCaptured?.activeOffsetX).toEqual([-10_000, 16]);
    expect(mockCaptured?.failOffsetX[0]).toBeLessThan(0);
    expect(mockCaptured?.failOffsetY).toEqual([-12, 12]);
  });

  it('replies when let go past the threshold, and not before or when cancelled', async () => {
    const onReply = jest.fn();
    await render(
      <SwipeToReply enabled onReply={onReply}>
        <Text>Hello</Text>
      </SwipeToReply>,
    );
    swipe(REPLY_THRESHOLD - 10);
    expect(onReply).not.toHaveBeenCalled();
    swipe(REPLY_THRESHOLD + 30, true);
    expect(onReply).not.toHaveBeenCalled();
    swipe(REPLY_THRESHOLD + 30);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('is switched off for a message that cannot be answered', async () => {
    await render(
      <SwipeToReply enabled={false} onReply={() => undefined}>
        <Text>System line</Text>
      </SwipeToReply>,
    );
    expect(mockCaptured?.enabled).toBe(false);
  });
});
