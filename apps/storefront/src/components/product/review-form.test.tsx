import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeXhr } from '@/testing/fake-xhr';
import { ReviewForm } from './review-form';

const removePhoto = vi.hoisted(() => vi.fn());
const refreshReviews = vi.hoisted(() => vi.fn());
vi.mock('@/lib/picture-actions', () => ({
  removeReviewPhotoAction: removePhoto,
  refreshReviewsAction: refreshReviews,
}));

const csrf = { name: '__csrf', token: 'token-1' };
const REVIEW = '0e000000-0000-4000-8000-000000000001';
const saved = {
  status: 'success' as const,
  message: 'Thank you. Your review is published.',
  values: { reviewId: REVIEW },
};

const action = vi.fn();

beforeEach(() => {
  FakeXhr.reset();
  action.mockReset();
  removePhoto.mockReset();
  // A Server Action always returns a promise; the form chains .catch() on it.
  refreshReviews.mockReset();
  refreshReviews.mockResolvedValue(undefined);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function image(name: string, size = 4096): File {
  const file = new File([new Uint8Array(8)], name, { type: 'image/jpeg', lastModified: 1 });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function renderForm() {
  return render(<ReviewForm productId="p1" slug="desk-lamp" csrf={csrf} action={action} />);
}

function write(text = 'A thoroughly good lamp, well made.') {
  fireEvent.click(screen.getByLabelText('5 out of 5'));
  fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: text } });
}

function choose(...files: File[]) {
  fireEvent.change(screen.getByLabelText('Photos (optional)', { selector: 'input' }), {
    target: { files },
  });
}

async function submit(form?: HTMLFormElement) {
  const target =
    form ??
    (screen.getByRole('button', { name: 'Post review' }).closest('form') as HTMLFormElement);
  await act(async () => {
    fireEvent.submit(target);
    await Promise.resolve();
  });
}

async function settle(run: () => void) {
  await act(async () => {
    run();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const xhr = (index: number) => FakeXhr.all[index] as FakeXhr;

describe('ReviewForm photos', () => {
  it('lets the customer choose, preview and remove photos before posting', () => {
    renderForm();

    choose(image('a.jpg'), image('b.jpg'));
    expect(screen.getByRole('button', { name: 'Remove photo a.jpg' })).not.toBeNull();
    expect(screen.getByText('2/4')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo a.jpg' }));
    expect(screen.queryByRole('button', { name: 'Remove photo a.jpg' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove photo b.jpg' })).not.toBeNull();
  });

  it('refuses a fifth photo and an oversized or non-image file, saying which', () => {
    renderForm();

    choose(image('1.jpg'), image('2.jpg'), image('3.jpg'), image('4.jpg'), image('5.jpg'));
    expect(screen.getByRole('alert').textContent).toContain('at most 4');

    choose(image('huge.jpg', 6 * 1024 * 1024));
    expect(screen.getByRole('alert').textContent).toContain('huge.jpg');
  });

  it('posts through the Server Action alone when there are no photos', async () => {
    action.mockResolvedValue(saved);
    renderForm();
    write();

    await submit();

    expect(action).toHaveBeenCalledTimes(1);
    expect(FakeXhr.all).toHaveLength(0);
  });

  it('saves the review first, then sends each photo in turn with its own real progress', async () => {
    action.mockResolvedValue(saved);
    renderForm();
    write();
    choose(image('a.jpg'), image('b.jpg'));

    await submit();

    // The server confirmed the review; only then does the first photo go out.
    expect(action).toHaveBeenCalledTimes(1);
    expect(FakeXhr.all).toHaveLength(1);
    const first = xhr(0);
    expect(first.url).toBe('/api/uploads/review-photo');
    expect(first.body?.get('reviewId')).toBe(REVIEW);
    expect(first.body?.get('slug')).toBe('desk-lamp');
    expect(first.body?.get('__csrf')).toBe('token-1');
    expect(first.body?.get('image')).toBeInstanceOf(File);

    await settle(() => first.progress(1024, 4096));
    expect(
      screen.getByRole('progressbar', { name: 'Uploading a.jpg' }).getAttribute('aria-valuenow'),
    ).toBe('25');
    // The second photo waits its turn.
    expect(FakeXhr.all).toHaveLength(1);

    await settle(() => {
      first.transferred();
      first.answer({ status: 'success', values: { imageId: 'img-a' } });
    });
    expect(FakeXhr.all).toHaveLength(2);
    expect(xhr(1).body?.get('image')).toBeInstanceOf(File);

    await settle(() => {
      xhr(1).transferred();
      xhr(1).answer({ status: 'success', values: { imageId: 'img-b' } });
    });
    expect(screen.getByText(/2 of 2 photos added/)).not.toBeNull();
    // Only now, with every photo on the review, is the page refreshed to show it.
    expect(refreshReviews).toHaveBeenCalledWith('desk-lamp');
  });

  it('asks the server not to refresh the page while photos are still to be sent', async () => {
    action.mockResolvedValue(saved);
    renderForm();
    write();
    choose(image('a.jpg'));

    await submit();

    // Refreshing at once would swap this form for the published review and lose the photos.
    const sent = action.mock.calls[0]?.[1] as FormData;
    expect(sent.get('deferRefresh')).toBe('1');
    expect(refreshReviews).not.toHaveBeenCalled();
  });

  it('keeps the text and the photos, and sends nothing, when the review is refused', async () => {
    action.mockResolvedValue({
      status: 'error',
      message: 'Only customers who received this product can review it.',
      values: { body: 'A thoroughly good lamp, well made.' },
    });
    renderForm();
    write();
    choose(image('a.jpg'));

    await submit();

    expect(screen.getByText(/Only customers who received/)).not.toBeNull();
    expect(FakeXhr.all).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Remove photo a.jpg' })).not.toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>(/Your review/).value).toContain(
      'thoroughly good',
    );
  });

  it('does not submit twice while the review is being saved', async () => {
    let resolveAction: (state: typeof saved) => void = () => undefined;
    action.mockImplementation(
      () =>
        new Promise<typeof saved>((resolve) => {
          resolveAction = resolve;
        }),
    );
    renderForm();
    write();
    choose(image('a.jpg'));

    const formElement = screen
      .getByRole('button', { name: 'Post review' })
      .closest('form') as HTMLFormElement;
    await submit(formElement);
    await submit(formElement);
    expect(action).toHaveBeenCalledTimes(1);

    await settle(() => resolveAction(saved));
    expect(FakeXhr.all).toHaveLength(1);
  });

  it('reports a failed photo beside the ones that worked, and retries it only when that is safe', async () => {
    action.mockResolvedValue(saved);
    renderForm();
    write();
    choose(image('a.jpg'), image('b.jpg'));
    await submit();

    await settle(() => {
      xhr(0).transferred();
      xhr(0).answer({ status: 'success', values: { imageId: 'img-a' } });
    });
    // The second photo's connection drops before every byte was sent: nothing was saved.
    await settle(() => {
      xhr(1).progress(100, 4096);
      xhr(1).fail();
    });

    expect(screen.getByText(/1 of 2 photos added; 1 could not be/)).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Nothing was saved');

    await settle(() => screen.getByRole('button', { name: /^Try again/ }).click());
    expect(FakeXhr.all).toHaveLength(3);
    await settle(() => {
      xhr(2).transferred();
      xhr(2).answer({ status: 'success', values: { imageId: 'img-b' } });
    });
    expect(screen.getByText(/2 of 2 photos added/)).not.toBeNull();
  });

  it('offers no retry when the photo was fully sent but never confirmed', async () => {
    action.mockResolvedValue(saved);
    renderForm();
    write();
    choose(image('a.jpg'));
    await submit();

    await settle(() => {
      xhr(0).progress(4096, 4096);
      xhr(0).transferred();
      xhr(0).fail();
    });

    expect(screen.getByRole('alert').textContent).toContain('before Nilzora confirmed');
    expect(screen.queryByRole('button', { name: /^Try again/ })).toBeNull();
  });

  it('removes a photo the server already confirmed, and only after the server says so', async () => {
    action.mockResolvedValue(saved);
    removePhoto.mockResolvedValue({ status: 'success', message: 'Photo removed.' });
    renderForm();
    write();
    choose(image('a.jpg'));
    await submit();
    await settle(() => {
      xhr(0).transferred();
      xhr(0).answer({ status: 'success', values: { imageId: 'img-a' } });
    });

    await settle(() => screen.getByRole('button', { name: 'Remove photo a.jpg' }).click());

    const [, sent] = removePhoto.mock.calls[0] as [unknown, FormData];
    expect(sent.get('imageId')).toBe('img-a');
    expect(sent.get('slug')).toBe('desk-lamp');
    expect(screen.queryByRole('button', { name: 'Remove photo a.jpg' })).toBeNull();
  });

  it('keeps a confirmed photo listed when the server will not remove it', async () => {
    action.mockResolvedValue(saved);
    removePhoto.mockResolvedValue({ status: 'error', message: 'This photo could not be found.' });
    renderForm();
    write();
    choose(image('a.jpg'));
    await submit();
    await settle(() => {
      xhr(0).transferred();
      xhr(0).answer({ status: 'success', values: { imageId: 'img-a' } });
    });

    await settle(() => screen.getByRole('button', { name: 'Remove photo a.jpg' }).click());

    expect(within(document.body).getByText(/could not be found/)).not.toBeNull();
  });
});
