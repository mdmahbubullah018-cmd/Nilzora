import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resistedTravel, SWIPE_REPLY_THRESHOLD, SwipeToReply } from './support-swipe';

function surface() {
  return screen.getByTestId('swipe-surface').parentElement as HTMLElement;
}

function drag(element: HTMLElement, path: [number, number][], pointerType = 'touch') {
  const [first, ...rest] = path;
  fireEvent.pointerDown(element, {
    pointerType,
    clientX: first?.[0],
    clientY: first?.[1],
    pointerId: 1,
  });
  for (const [x, y] of rest)
    fireEvent.pointerMove(element, { pointerType, clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(element, { pointerType, pointerId: 1 });
}

describe('<SwipeToReply> on the web', () => {
  it('replies after a rightward touch swipe past the threshold', () => {
    const onReply = vi.fn();
    render(
      <SwipeToReply enabled onReply={onReply}>
        <p>Hello</p>
      </SwipeToReply>,
    );
    drag(surface(), [
      [10, 100],
      [40, 101],
      [10 + 16 + SWIPE_REPLY_THRESHOLD + 4, 102],
    ]);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('ignores a short swipe, a vertical scroll and the mouse', () => {
    const onReply = vi.fn();
    render(
      <SwipeToReply enabled onReply={onReply}>
        <p>Hello</p>
      </SwipeToReply>,
    );
    drag(surface(), [
      [10, 100],
      [50, 100],
    ]);
    drag(surface(), [
      [10, 100],
      [12, 140],
      [200, 150],
    ]);
    drag(
      surface(),
      [
        [10, 100],
        [200, 100],
      ],
      'mouse',
    );
    expect(onReply).not.toHaveBeenCalled();
  });

  it('resists travel past the threshold and caps it', () => {
    expect(resistedTravel(-5)).toBe(0);
    expect(resistedTravel(SWIPE_REPLY_THRESHOLD)).toBe(SWIPE_REPLY_THRESHOLD);
    expect(resistedTravel(1000)).toBe(76);
  });
});
