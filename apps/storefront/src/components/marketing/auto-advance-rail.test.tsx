import type { ShoppingZone } from '@nilzora/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionFlags } from '@/lib/use-session-flag';
import {
  RAIL_ADVANCE_MS,
  RAIL_IDLE_MS,
  RAIL_PAUSE_KEY,
  RAIL_WRAP_FADE_MS,
} from './auto-advance-rail';
import { ZoneRail } from './zone-rail';

/*
 * The collection rail moves on by itself. jsdom has no layout, so the scroller's geometry is
 * stubbed: four cards of 300px starting 16px in (the rail's own padding), a 300px window over
 * 1000px of content, so the furthest the rail can scroll is 700px.
 */

const OFFSETS = [16, 316, 616, 916];
const MAX_SCROLL = 700;

function zone(n: number): ShoppingZone {
  return {
    id: `3f2a1b4c-0000-4000-8000-00000000000${String(n)}`,
    slug: `zone-${String(n)}`,
    name: `Zone ${String(n)}`,
    description: null,
    audience: 'all',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: 3,
  };
}

const zones = [1, 2, 3, 4].map(zone);

let reducedMotion = false;
let reducedListeners: (() => void)[] = [];
let observers: { callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] =
  [];

class FakeIntersectionObserver {
  readonly disconnect = vi.fn();
  constructor(callback: IntersectionObserverCallback) {
    observers.push({ callback, disconnect: this.disconnect });
  }
  observe = vi.fn();
  unobserve = vi.fn();
  takeRecords = () => [];
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  reducedListeners = [];
  resetSessionFlags();
  window.sessionStorage.clear();
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reducedMotion : false,
    media: query,
    addEventListener: (_type: string, listener: () => void) => {
      if (query.includes('reduce')) reducedListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      reducedListeners = reducedListeners.filter((existing) => existing !== listener);
    },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

/** Renders the real rail and gives its scroller the layout jsdom lacks. */
function renderRail({ scrollWidth = 1000 }: { scrollWidth?: number } = {}) {
  const view = render(<ZoneRail zones={zones} />);
  const list = view.container.querySelector('ul')!;
  let scrollLeft = 0;
  Object.defineProperty(list, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(list, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(list, 'scrollLeft', {
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
    configurable: true,
  });
  list.getBoundingClientRect = () => ({ left: 0 }) as DOMRect;
  [...list.children].forEach((card, index) => {
    (card as HTMLElement).getBoundingClientRect = () =>
      ({ left: (OFFSETS[index] ?? 0) - scrollLeft }) as DOMRect;
  });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    scrollLeft = options.left ?? 0;
  });
  list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
  return { ...view, list, scrollTo };
}

const seen = () => {
  for (const { callback } of observers) {
    act(() => {
      callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
  }
};

const unseen = () => {
  for (const { callback } of observers) {
    act(() => {
      callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
  }
};

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('AutoAdvanceRail', () => {
  it('scrolls to the next collection every interval and wraps to the start', () => {
    const { scrollTo } = renderRail();
    seen();

    advance(RAIL_ADVANCE_MS - 1);
    expect(scrollTo).not.toHaveBeenCalled();

    advance(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 316, behavior: 'smooth' });
    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 616, behavior: 'smooth' });
    // The last card cannot sit at its own start: the rail stops at its furthest scroll.
    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: MAX_SCROLL, behavior: 'smooth' });
    // From the end, back to the first card: a fade and a jump, never a sweep.
    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenCalledTimes(3);
    advance(RAIL_WRAP_FADE_MS);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'instant' });
    expect(scrollTo).toHaveBeenCalledTimes(4);
    expect(scrollTo).not.toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });

  it('only ever scrolls the list itself, never the page', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { scrollTo } = renderRail();
    seen();

    advance(RAIL_ADVANCE_MS * 2);

    expect(scrollTo).toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does nothing until the rail is on screen, and stops when it leaves', () => {
    const { scrollTo } = renderRail();

    advance(RAIL_ADVANCE_MS * 3);
    expect(scrollTo).not.toHaveBeenCalled();

    seen();
    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    unseen();
    advance(RAIL_ADVANCE_MS * 3);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('runs without an IntersectionObserver, rather than never moving', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { scrollTo } = renderRail();

    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('rests while the pointer is over it and starts a fresh wait when it leaves', () => {
    const { container, scrollTo } = renderRail();
    seen();
    const box = container.firstElementChild as HTMLElement;

    advance(RAIL_ADVANCE_MS - 1000);
    fireEvent.mouseEnter(box);
    advance(RAIL_ADVANCE_MS * 3);
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.mouseLeave(box);
    advance(RAIL_ADVANCE_MS - 1);
    expect(scrollTo).not.toHaveBeenCalled();
    advance(1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('rests while a link inside has keyboard focus', () => {
    const { container, scrollTo } = renderRail();
    seen();
    const link = container.querySelector('a')!;

    fireEvent.focusIn(link);
    advance(RAIL_ADVANCE_MS * 3);
    expect(scrollTo).not.toHaveBeenCalled();

    // Focus moving to another card inside the rail is still "inside".
    fireEvent.focusOut(link, { relatedTarget: container.querySelectorAll('a')[1] });
    advance(RAIL_ADVANCE_MS * 3);
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.focusOut(link, { relatedTarget: document.body });
    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pointerdown', (box: HTMLElement) => fireEvent.pointerDown(box)],
    ['touchstart', (box: HTMLElement) => fireEvent.touchStart(box)],
    ['wheel', (box: HTMLElement) => fireEvent.wheel(box)],
    ['keydown', (box: HTMLElement) => fireEvent.keyDown(box, { key: 'ArrowRight' })],
  ])('leaves the visitor alone for a while after a %s', (_name, interact) => {
    const { container, scrollTo } = renderRail();
    seen();
    const box = container.firstElementChild as HTMLElement;

    interact(box);
    // Every tick inside the idle window is skipped...
    advance(RAIL_IDLE_MS - 1);
    expect(scrollTo).not.toHaveBeenCalled();

    // ...and the first tick after it moves on again.
    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('never moves for a visitor who prefers reduced motion', () => {
    reducedMotion = true;
    const { scrollTo } = renderRail();
    seen();

    advance(RAIL_ADVANCE_MS * 4);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rests while the tab is hidden and resumes when it is shown again', () => {
    const { scrollTo } = renderRail();
    seen();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(RAIL_ADVANCE_MS * 3);
    expect(scrollTo).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(RAIL_ADVANCE_MS);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('leaves a rail alone when every collection already fits', () => {
    const { scrollTo } = renderRail({ scrollWidth: 300 });
    seen();

    advance(RAIL_ADVANCE_MS * 3);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('keeps every link and clears its timer and observer on unmount', () => {
    const { container, unmount } = renderRail();
    seen();
    expect(container.querySelectorAll('a')).toHaveLength(4);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalled();
  });

  it('renders nothing at all, and watches nothing, when there are no collections', () => {
    const { container } = render(<ZoneRail zones={[]} />);

    expect(container.innerHTML).toBe('');
    expect(observers).toHaveLength(0);
  });
});

describe('the Pause / Play control (WCAG 2.2.2)', () => {
  const control = (view: ReturnType<typeof renderRail>, name: string) =>
    within(view.container).getByRole('button', { name });

  it('is a labelled button of at least 44 x 44 px under the rail, in the page from the first render', () => {
    const view = renderRail();

    const pause = control(view, 'Pause collection slideshow');
    expect(pause.className).toContain('min-h-11');
    expect(pause.className).toContain('min-w-11');
    // Under the rail, not inside its scroller, so keyboard focus on it never pauses by "focus inside".
    expect(view.list.contains(pause)).toBe(false);
    expect(pause.getAttribute('aria-pressed')).toBeNull();
  });

  it('adds nothing to the page when the slideshow starts: the control is there before it moves', () => {
    const view = renderRail();
    const before = view.container.innerHTML;
    seen();
    advance(RAIL_ADVANCE_MS * 2);
    // Only the scroll position changed: the same elements, in the same places, with the same classes.
    expect(view.container.innerHTML).toBe(before);
  });

  it('stops the slideshow, says so politely, and starts it again on Play', () => {
    const view = renderRail();
    seen();
    advance(RAIL_ADVANCE_MS);
    expect(view.scrollTo).toHaveBeenCalledTimes(1);

    fireEvent.click(control(view, 'Pause collection slideshow'));
    expect(screen.getByRole('status').textContent).toBe('Paused collection slideshow');
    advance(RAIL_ADVANCE_MS * 4);
    expect(view.scrollTo).toHaveBeenCalledTimes(1);
    expect(control(view, 'Play collection slideshow')).toBeTruthy();

    fireEvent.click(control(view, 'Play collection slideshow'));
    expect(screen.getByRole('status').textContent).toBe('Playing collection slideshow');
    // Focus is on the button, not inside the rail: it moves on.
    advance(RAIL_ADVANCE_MS);
    expect(view.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('can be used with the keyboard', () => {
    const view = renderRail();
    const pause = control(view, 'Pause collection slideshow');

    // A native button: Enter and Space both activate it, and it is in the tab order.
    expect(pause.tagName).toBe('BUTTON');
    expect(pause.getAttribute('tabindex')).toBeNull();
    pause.focus();
    expect(document.activeElement).toBe(pause);
    fireEvent.click(pause);
    expect(control(view, 'Play collection slideshow')).toBeTruthy();
  });

  it('remembers the choice for the visit, across a remount, as a page change would', () => {
    const first = renderRail();
    fireEvent.click(control(first, 'Pause collection slideshow'));
    expect(window.sessionStorage.getItem(RAIL_PAUSE_KEY)).toBe('1');
    first.unmount();

    const second = renderRail();
    seen();
    expect(control(second, 'Play collection slideshow')).toBeTruthy();
    advance(RAIL_ADVANCE_MS * 3);
    expect(second.scrollTo).not.toHaveBeenCalled();
  });

  it('still holds the choice for the page when sessionStorage is unavailable', () => {
    const view = renderRail();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    fireEvent.click(control(view, 'Pause collection slideshow'));
    vi.restoreAllMocks();

    expect(control(view, 'Play collection slideshow')).toBeTruthy();
  });

  it('has no live region around the rail, so an automatic move is never announced', () => {
    const view = renderRail();
    seen();
    advance(RAIL_ADVANCE_MS * 3);

    expect(view.list.closest('[aria-live]')).toBeNull();
    // The only live region is the control's own status line, which stays empty until a press.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('is not drawn for fewer than three collections, which never overflow the row', () => {
    const view = render(<ZoneRail zones={zones.slice(0, 2)} />);

    expect(within(view.container).queryByRole('button')).toBeNull();
  });

  it('is hidden from lg up for exactly three collections, which fit the wide row', () => {
    const three = render(<ZoneRail zones={zones.slice(0, 3)} />);
    const row = within(three.container).getByRole('button').parentElement!;
    expect(row.className).toContain('lg:hidden');
    three.unmount();

    const four = renderRail();
    expect(control(four, 'Pause collection slideshow').parentElement!.className).not.toContain(
      'lg:hidden',
    );
  });

  it('is hidden by CSS for reduced motion, so it never shifts the page either way', () => {
    const view = renderRail();

    expect(control(view, 'Pause collection slideshow').parentElement!.className).toContain(
      'motion-reduce:hidden',
    );
  });
});

describe('reduced motion while the page is open', () => {
  it('stops the slideshow the moment the setting is switched on, and resumes when it is off', () => {
    const view = renderRail();
    seen();
    advance(RAIL_ADVANCE_MS);
    expect(view.scrollTo).toHaveBeenCalledTimes(1);
    expect(reducedListeners.length).toBeGreaterThan(0);

    reducedMotion = true;
    act(() => {
      for (const listener of reducedListeners) listener();
    });
    expect(vi.getTimerCount()).toBe(0);
    advance(RAIL_ADVANCE_MS * 4);
    expect(view.scrollTo).toHaveBeenCalledTimes(1);

    reducedMotion = false;
    act(() => {
      for (const listener of reducedListeners) listener();
    });
    advance(RAIL_ADVANCE_MS);
    expect(view.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('never fades or scrolls anything for a visitor who asked for reduced motion', () => {
    reducedMotion = true;
    const view = renderRail();
    seen();
    advance(RAIL_ADVANCE_MS * 6);

    expect(view.scrollTo).not.toHaveBeenCalled();
    expect(view.list.style.opacity).toBe('');
  });

  it('stops listening for the setting on unmount', () => {
    const view = renderRail();
    expect(reducedListeners.length).toBeGreaterThan(0);

    view.unmount();

    expect(reducedListeners).toHaveLength(0);
  });
});

describe('wrapping from the last collection to the first', () => {
  function toTheEnd(view: ReturnType<typeof renderRail>) {
    seen();
    advance(RAIL_ADVANCE_MS * 3);
    expect(view.list.scrollLeft).toBe(MAX_SCROLL);
  }

  it('fades the row out, jumps while it is invisible, and fades it back in', () => {
    const view = renderRail();
    toTheEnd(view);
    view.scrollTo.mockClear();

    advance(RAIL_ADVANCE_MS);
    expect(view.list.style.opacity).toBe('0');
    expect(view.scrollTo).not.toHaveBeenCalled();

    advance(RAIL_WRAP_FADE_MS);
    expect(view.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'instant' });
    expect(view.list.style.opacity).toBe('1');

    advance(RAIL_WRAP_FADE_MS);
    expect(view.list.style.opacity).toBe('');
    expect(view.list.style.transition).toBe('');
  });

  it('never leaves the row dim when the slideshow stops half-way through the fade', () => {
    const view = renderRail();
    toTheEnd(view);

    advance(RAIL_ADVANCE_MS);
    expect(view.list.style.opacity).toBe('0');
    fireEvent.mouseEnter(view.container.firstElementChild as HTMLElement);

    expect(view.list.style.opacity).toBe('');
    advance(RAIL_WRAP_FADE_MS * 3);
    // The jump was cancelled with the fade: the visitor is left where they were.
    expect(view.list.scrollLeft).toBe(MAX_SCROLL);
  });
});

describe('the rail does not clip a focus ring', () => {
  it('leaves room above the first card and, from lg, beside it, without moving the rail', () => {
    const view = renderRail();
    const classes = view.list.className;

    expect(classes).toContain('pt-1');
    expect(classes).toContain('-mt-1');
    expect(classes).toContain('lg:px-1');
    expect(classes).toContain('lg:-mx-1');
    // A snapped card rests at the scrollport edge: scroll padding keeps the 4px ring inside it
    // (the browser check measured 0px of room on the left at every width without this).
    expect(classes).toContain('scroll-pl-1');
    // The old zero side padding from lg is overridden, not left to fight it.
    expect(classes).not.toContain('lg:px-0');
    expect(classes).not.toContain('lg:mx-0');
  });
});
