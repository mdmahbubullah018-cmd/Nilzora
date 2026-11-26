import { describe, expect, it, vi } from 'vitest';
import { copyToClipboard, runShare } from './share-action';

const REQUEST = {
  title: 'Clay Mug',
  text: 'Clay Mug — Hand-thrown in Dhaka.',
  url: 'https://nilzora.test/products/clay-mug',
};

/** Puts a share sheet on the navigator, or takes it away. */
function stubShare(implementation: (() => Promise<void>) | undefined) {
  const share =
    implementation === undefined ? undefined : vi.fn<() => Promise<void>>(implementation);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  return share;
}

function stubClipboard(writeText: (() => Promise<void>) | undefined) {
  const clipboard =
    writeText === undefined ? undefined : { writeText: vi.fn<() => Promise<void>>(writeText) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  return clipboard;
}

describe('runShare', () => {
  it('uses the platform share sheet when there is one', async () => {
    const share = stubShare(() => Promise.resolve());

    await expect(runShare(REQUEST)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(REQUEST);
  });

  it('treats a cancelled sheet as neither success nor failure', async () => {
    stubShare(() => Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    const clipboard = stubClipboard(() => Promise.resolve());

    await expect(runShare(REQUEST)).resolves.toBe('cancelled');
    // Nothing is copied behind the shopper's back after they dismissed the sheet.
    expect(clipboard?.writeText).not.toHaveBeenCalled();
  });

  it('copies the link when the sheet refuses for a real reason', async () => {
    stubShare(() => Promise.reject(new Error('not allowed')));
    const clipboard = stubClipboard(() => Promise.resolve());

    await expect(runShare(REQUEST)).resolves.toBe('copied');
    expect(clipboard?.writeText).toHaveBeenCalledWith(REQUEST.url);
  });

  it('copies the link when the browser has no share sheet', async () => {
    stubShare(undefined);
    const clipboard = stubClipboard(() => Promise.resolve());

    await expect(runShare(REQUEST)).resolves.toBe('copied');
    expect(clipboard?.writeText).toHaveBeenCalledWith(REQUEST.url);
  });

  it('respects a canShare that says no, and never calls share', async () => {
    const share = stubShare(() => Promise.resolve());
    Object.defineProperty(navigator, 'canShare', {
      value: () => false,
      configurable: true,
    });
    stubClipboard(() => Promise.resolve());

    await expect(runShare(REQUEST)).resolves.toBe('copied');
    expect(share).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'canShare');
  });

  it('reports failure, rather than success, when nothing worked', async () => {
    stubShare(undefined);
    stubClipboard(() => Promise.reject(new Error('denied')));
    // The legacy route is also unavailable in this environment.
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await expect(runShare(REQUEST)).resolves.toBe('failed');
    expect(execCommand).toHaveBeenCalled();
  });
});

describe('copyToClipboard', () => {
  it('writes through the clipboard API and leaves no field behind', async () => {
    const clipboard = stubClipboard(() => Promise.resolve());

    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(clipboard?.writeText).toHaveBeenCalledWith('hello');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('removes its temporary field even when the legacy command throws', async () => {
    stubClipboard(undefined);
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => {
        throw new Error('no');
      }),
      configurable: true,
    });

    await expect(copyToClipboard('hello')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
