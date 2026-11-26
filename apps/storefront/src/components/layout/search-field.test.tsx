import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestionResponse } from '@/lib/search-suggestions';
import { SearchField } from './search-field';
import { SUGGEST_DEBOUNCE_MS } from './use-search-suggestions';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

/** Requests the field made, each answered by hand with `answer`. */
interface Pending {
  url: string;
  signal: AbortSignal;
  resolve: (response: Response) => void;
}
let pending: Pending[] = [];

function answer(request: Pending | undefined, body: SuggestionResponse | object, status = 200) {
  if (!request) throw new Error('no request was made');
  request.resolve(new Response(JSON.stringify(body), { status }));
}

function suggestion(slug: string, name: string) {
  return {
    slug,
    name,
    priceMinor: 120_000,
    compareAtPriceMinor: null,
    categoryName: 'Fashion',
    brandName: 'Aarong',
    imageUrl: null,
    soldOut: false,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
          pending.push({ url, signal, resolve });
        }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockReset();
});

const input = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Search products' });

async function type(text: string) {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
  });
}

async function settle() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe('SearchField suggestions', () => {
  it('is a GET form to /search that works without suggestions', () => {
    render(<SearchField id="t" />);
    const form = screen.getByRole('search', { name: 'Site search' });
    expect(form.getAttribute('action')).toBe('/search');
    expect(input().name).toBe('q');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('waits for typing to pause, and asks nothing for a single letter', async () => {
    render(<SearchField id="t" />);
    await type('c');
    expect(pending).toHaveLength(0);

    fireEvent.change(input(), { target: { value: 'co' } });
    fireEvent.change(input(), { target: { value: 'cot' } });
    expect(pending).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    });
    expect(pending.map((request) => request.url)).toEqual(['/api/search/suggestions?q=cot']);
  });

  it('cancels the request for older text and never shows its late answer', async () => {
    render(<SearchField id="t" />);
    await type('sha');
    const first = pending[0];
    await type('shawl');
    expect(first?.signal.aborted).toBe(true);

    // The newer request answers; then the old one tries to.
    answer(pending[1], {
      query: 'shawl',
      items: [suggestion('nakshi-shawl', 'Nakshi Shawl')],
      total: 1,
    });
    await settle();
    expect(screen.getByRole('option', { name: /Nakshi Shawl/ })).not.toBeNull();
    expect(screen.queryByRole('option', { name: /Old answer/ })).toBeNull();
  });

  it('ignores an answer that is for different text than the field holds', async () => {
    render(<SearchField id="t" />);
    await type('lamp');
    answer(pending[0], {
      query: 'something else',
      items: [suggestion('x', 'Old answer')],
      total: 1,
    });
    await settle();
    expect(screen.queryByRole('option', { name: /Old answer/ })).toBeNull();
    expect(screen.getByText(/Suggestions are not available right now/)).not.toBeNull();
  });

  it('moves through the suggestions with the arrow keys and opens one with Enter', async () => {
    render(<SearchField id="t" />);
    await type('pan');
    answer(pending[0], {
      query: 'pan',
      items: [
        suggestion('cotton-panjabi', 'Cotton Panjabi'),
        suggestion('silk-panjabi', 'Silk Panjabi'),
      ],
      total: 7,
    });
    await settle();
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('option', { name: /See all 7 results for “pan”/ })).not.toBeNull();

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const active = input().getAttribute('aria-activedescendant');
    expect(active && document.getElementById(active)?.textContent).toContain('Silk Panjabi');

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/products/silk-panjabi');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('wraps round from the first suggestion to "see all results"', async () => {
    render(<SearchField id="t" />);
    await type('pan');
    answer(pending[0], { query: 'pan', items: [suggestion('a', 'A')], total: 1 });
    await settle();
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/search?q=pan');
  });

  it('closes the list on Escape, then clears the text on a second Escape', async () => {
    render(<SearchField id="t" />);
    await type('pan');
    answer(pending[0], { query: 'pan', items: [], total: 0 });
    await settle();
    expect(screen.getByText(/No products match/)).not.toBeNull();

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().value).toBe('pan');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('');
  });

  it('says so when the visitor searches too fast, and keeps the search usable', async () => {
    render(<SearchField id="t" />);
    await type('pan');
    answer(pending[0], { error: 'rate_limited' }, 429);
    await settle();
    expect(screen.getByText(/Searching too quickly/)).not.toBeNull();
    expect(screen.getByRole('option', { name: /Search for “pan”/ })).not.toBeNull();
  });

  it('opens a suggestion with a click', async () => {
    render(<SearchField id="t" />);
    await type('pan');
    answer(pending[0], {
      query: 'pan',
      items: [suggestion('cotton-panjabi', 'Cotton Panjabi')],
      total: 1,
    });
    await settle();
    fireEvent.click(screen.getByRole('option', { name: /Cotton Panjabi/ }));
    expect(push).toHaveBeenCalledWith('/products/cotton-panjabi');
  });

  it('starts from the search on screen and can be cleared on the search page', () => {
    render(<SearchField id="t" variant="page" defaultValue="rice" />);
    expect(input().value).toBe('rice');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input().value).toBe('');
  });
});
