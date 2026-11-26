import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectedImagePreview, UploadProgress } from './upload-progress';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UploadProgress', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<UploadProgress state={{ phase: 'idle' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('exposes the real percentage to assistive technology', () => {
    render(
      <UploadProgress
        state={{ phase: 'transferring', fileName: 'a.jpg', loaded: 460, total: 1000, percent: 46 }}
      />,
    );

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('46');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('46% uploaded');
    expect(bar.firstElementChild?.getAttribute('style')).toContain('width: 46%');
    expect(screen.getByText('a.jpg')).not.toBeNull();
  });

  it('offers Cancel only while bytes are being sent', () => {
    const cancel = vi.fn();
    const { rerender } = render(
      <UploadProgress
        state={{ phase: 'transferring', fileName: 'a.jpg', loaded: 1, total: 10, percent: 10 }}
        onCancel={cancel}
      />,
    );
    screen.getByRole('button', { name: 'Cancel upload' }).click();
    expect(cancel).toHaveBeenCalledTimes(1);

    // Once every byte is sent the server may already be saving it, so there is nothing to cancel.
    rerender(
      <UploadProgress
        state={{ phase: 'processing', fileName: 'a.jpg', total: 10 }}
        onCancel={cancel}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel upload' })).toBeNull();
  });

  it('keeps the success treatment for a confirmed success only', () => {
    render(
      <UploadProgress
        state={{ phase: 'success', fileName: 'a.jpg', message: 'Picture updated.' }}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Picture updated.');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows a retry only when it is safe and a handler exists', () => {
    const error = { phase: 'error' as const, fileName: 'a.jpg', message: 'Nope.' };
    const { rerender } = render(
      <UploadProgress state={{ ...error, canRetry: true }} onRetry={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull();

    rerender(<UploadProgress state={{ ...error, canRetry: false }} onRetry={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Nope.');
  });
});

describe('SelectedImagePreview', () => {
  it('releases the temporary URL when the file changes and when it goes away', () => {
    const create = vi.fn().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });

    const view = render(<SelectedImagePreview file={a} />);
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:one');

    view.rerender(<SelectedImagePreview file={b} />);
    expect(revoke).toHaveBeenCalledWith('blob:one');
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:two');

    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:two');
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
