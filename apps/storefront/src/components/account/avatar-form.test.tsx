import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeXhr } from '@/testing/fake-xhr';
import { AvatarForm } from './avatar-form';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const serverAction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/picture-actions', () => ({
  uploadAvatarAction: serverAction,
  removeAvatarAction: serverAction,
}));

const csrf = { name: '__csrf', token: 'token-1' };

beforeEach(() => {
  FakeXhr.reset();
  refresh.mockReset();
  serverAction.mockReset();
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

function image(name = 'me.jpg', size = 4096, type = 'image/jpeg'): File {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText(/Choose a picture/), { target: { files: [file] } });
}

const formElement = () =>
  screen.getByRole('button', { name: 'Save picture' }).closest('form') as HTMLFormElement;

describe('AvatarForm', () => {
  it('shows the current picture, or the initials when there is none', () => {
    const { unmount } = render(
      <AvatarForm csrf={csrf} avatarUrl="https://m/a/thumb.webp" initials="RK" />,
    );
    expect(screen.getByAltText('Your profile picture').getAttribute('src')).toBe(
      'https://m/a/thumb.webp',
    );
    expect(screen.getByRole('button', { name: 'Remove picture' })).not.toBeNull();
    unmount();

    render(<AvatarForm csrf={csrf} avatarUrl={null} initials="RK" />);
    expect(screen.getByText('RK')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull();
  });

  it('refuses an oversized file and a non-picture on the spot, sending nothing', () => {
    render(<AvatarForm csrf={csrf} avatarUrl={null} initials="RK" />);

    pick(image('big.jpg', PRODUCT_IMAGE_MAX_BYTES + 1));
    // A profile picture has its own 3 MB ceiling.\n    expect(screen.getByText(/larger than 3 MB/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save picture' }).hasAttribute('disabled')).toBe(
      true,
    );

    pick(image('notes.pdf', 100, 'application/pdf'));
    expect(screen.getByText(/JPEG, PNG or WebP picture/)).not.toBeNull();
    expect(FakeXhr.all).toHaveLength(0);
  });

  it('previews the file, posts it to the upload route and shows the real bytes', () => {
    render(<AvatarForm csrf={csrf} avatarUrl={null} initials="RK" />);
    pick(image());
    expect(screen.getByText('me.jpg')).not.toBeNull();

    fireEvent.submit(formElement());

    expect(FakeXhr.all).toHaveLength(1);
    const request = FakeXhr.all[0] as FakeXhr;
    expect(request.url).toBe('/api/uploads/avatar');
    expect(request.body?.get('__csrf')).toBe('token-1');
    // The form names no account: nothing in the body says whose picture it is.
    expect([...(request.body?.keys() ?? [])].sort()).toEqual(['__csrf', 'image']);
    expect(serverAction).not.toHaveBeenCalled();

    act(() => request.progress(2048, 4096));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('refreshes and confirms only after the server answers, never at 100% of the bytes', async () => {
    render(<AvatarForm csrf={csrf} avatarUrl={null} initials="RK" />);
    pick(image());
    fireEvent.submit(formElement());
    const request = FakeXhr.all[0] as FakeXhr;

    act(() => {
      request.progress(4096, 4096);
      request.transferred();
    });
    expect(screen.getByText(/Checking and saving/)).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText('Profile picture updated.')).toBeNull();

    await act(async () => {
      request.answer({ status: 'success', message: 'Profile picture updated.' });
      await Promise.resolve();
    });
    expect(screen.getByText('Profile picture updated.')).not.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled while bytes are being sent, and then sends again from scratch', async () => {
    render(<AvatarForm csrf={csrf} avatarUrl={null} initials="RK" />);
    pick(image());
    fireEvent.submit(formElement());
    act(() => (FakeXhr.all[0] as FakeXhr).progress(100, 4096));

    await act(async () => {
      screen.getByRole('button', { name: 'Cancel upload' }).click();
      await Promise.resolve();
    });

    expect((FakeXhr.all[0] as FakeXhr).aborted).toBe(true);
    expect(screen.queryByRole('progressbar')).toBeNull();
    // The chosen file is still there to send.
    fireEvent.submit(formElement());
    expect(FakeXhr.all).toHaveLength(2);
  });

  it('shows the refusal and keeps the file when the server will not take the picture', async () => {
    render(<AvatarForm csrf={csrf} avatarUrl={null} initials="RK" />);
    pick(image());
    fireEvent.submit(formElement());

    await act(async () => {
      const request = FakeXhr.all[0] as FakeXhr;
      request.transferred();
      request.answer({ status: 'error', message: 'This picture could not be used.' });
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain('could not be used');
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull();
  });
});
