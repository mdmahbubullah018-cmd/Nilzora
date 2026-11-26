import type { ShareTarget } from '@nilzora/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareButton } from './share-button';

const TARGET: ShareTarget = {
  kind: 'product',
  title: 'Clay Mug',
  text: 'Clay Mug — Hand-thrown in Dhaka.',
  url: 'https://nilzora.test/products/clay-mug',
  imageUrl: null,
};

function stubShare(implementation: (() => Promise<void>) | undefined) {
  const share =
    implementation === undefined ? undefined : vi.fn<() => Promise<void>>(implementation);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  return share;
}

function stubClipboard(writeText: () => Promise<void>) {
  const clipboard = { writeText: vi.fn<() => Promise<void>>(writeText) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  return clipboard;
}

describe('ShareButton', () => {
  it('names the record it shares, so the icon alone is never the label', () => {
    stubShare(undefined);
    render(<ShareButton target={TARGET} />);

    expect(screen.getByRole('button', { name: 'Share Clay Mug' })).toBeTruthy();
  });

  it('hands the platform the record’s own title, line and address', async () => {
    const share = stubShare(() => Promise.resolve());
    render(<ShareButton target={TARGET} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share Clay Mug' }));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: TARGET.title,
        text: TARGET.text,
        url: TARGET.url,
      }),
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Shared'));
  });

  it('says "Link copied" only when the copy actually happened', async () => {
    stubShare(undefined);
    const clipboard = stubClipboard(() => Promise.resolve());
    render(<ShareButton target={TARGET} variant="label" />);

    fireEvent.click(screen.getByRole('button', { name: 'Share Clay Mug' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Link copied'));
    expect(clipboard.writeText).toHaveBeenCalledWith(TARGET.url);
    // The label form confirms in place, so the reader sees it without moving their eyes.
    expect(screen.getByRole('button', { name: 'Share Clay Mug' }).textContent).toBe('Link copied');
  });

  it('reports a real failure instead of pretending it worked', async () => {
    stubShare(undefined);
    stubClipboard(() => Promise.reject(new Error('denied')));
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    render(<ShareButton target={TARGET} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share Clay Mug' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'This could not be shared. Please try again.',
      ),
    );
  });

  it('says nothing after the shopper dismisses the sheet', async () => {
    stubShare(() => Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    const clipboard = stubClipboard(() => Promise.resolve());
    render(<ShareButton target={TARGET} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share Clay Mug' }));

    await waitFor(() => expect(screen.getByRole('button').getAttribute('aria-busy')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('opens one share sheet for a rapid double tap', async () => {
    const share = stubShare(() => Promise.resolve());
    render(<ShareButton target={TARGET} />);
    const button = screen.getByRole('button', { name: 'Share Clay Mug' });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Shared'));
    expect(share).toHaveBeenCalledTimes(1);
  });
});
