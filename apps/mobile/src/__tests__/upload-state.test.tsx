import { ApiError } from '@nilzora/api-client';
import { inAct } from '@/test-utils/upload-fakes';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { SessionEndedError } from '@/auth/session-manager';
import { Avatar } from '@/components/avatar';
import { UploadTransferError } from '@/uploads/native-upload';
import { describeUploadError, useNativeUpload } from '@/uploads/use-upload';

describe('describeUploadError', () => {
  it('allows a retry only when nothing can have been saved', () => {
    expect(describeUploadError(new UploadTransferError('network', false))).toMatchObject({
      canRetry: true,
      message: expect.stringContaining('Nothing was saved') as string,
    });
    expect(describeUploadError(new UploadTransferError('network', true))).toMatchObject({
      canRetry: false,
    });
    expect(describeUploadError(new UploadTransferError('cancelled', false)).canRetry).toBe(true);
    expect(describeUploadError(new UploadTransferError('cancelled', true)).canRetry).toBe(false);
  });

  it('uses fixed words for the API refusals, never the server text', () => {
    const refused = describeUploadError(
      new ApiError(413, 'payload_too_large', 'SECRET internal detail'),
    );
    expect(refused.message).toContain('5 MB');
    expect(refused.message).not.toContain('SECRET');
    expect(refused.canRetry).toBe(true);
  });

  it('does not retry an unconfirmed server failure or an ended session', () => {
    expect(describeUploadError(new ApiError(500, 'internal_error', 'x')).canRetry).toBe(false);
    expect(describeUploadError(new SessionEndedError())).toMatchObject({ canRetry: false });
  });
});

describe('useNativeUpload', () => {
  it('moves from sending to processing to success only through real events', async () => {
    const { result } = await renderHook(() => useNativeUpload());
    let finish!: (value: string) => void;
    let controls!: Parameters<Parameters<typeof result.current.start>[1]>[0];

    let outcome!: Promise<string | null>;
    await inAct(() => {
      outcome = result.current.start(
        'me.jpg',
        (c) =>
          new Promise<string>((resolve) => {
            controls = c;
            finish = resolve;
          }),
      );
    });
    expect(result.current.state).toMatchObject({ phase: 'transferring', percent: 0 });
    expect(result.current.busy).toBe(true);

    await inAct(() => controls.onProgress({ sent: 50, total: 100, percent: 50 }));
    expect(result.current.state).toMatchObject({ phase: 'transferring', percent: 50 });

    await inAct(() => controls.onSent());
    expect(result.current.state.phase).toBe('processing');
    expect(result.current.busy).toBe(true);

    await inAct(() => finish('done'));
    await expect(outcome).resolves.toBe('done');
    expect(result.current.state.phase).toBe('success');
    expect(result.current.busy).toBe(false);
  });

  it('refuses a second upload while one is running', async () => {
    const { result } = await renderHook(() => useNativeUpload());
    const run = jest.fn(() => new Promise<string>(() => undefined));
    await inAct(() => {
      void result.current.start('a.jpg', run);
    });
    let second: string | null = 'unset';
    await act(async () => {
      second = await result.current.start('b.jpg', run);
    });
    expect(second).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('aborts the transfer when the screen goes away', async () => {
    const { result, unmount } = await renderHook(() => useNativeUpload());
    let signal!: AbortSignal;
    await inAct(() => {
      void result.current.start('a.jpg', (c) => {
        signal = c.signal;
        return new Promise<string>(() => undefined);
      });
    });
    expect(signal.aborted).toBe(false);
    await act(async () => {
      await unmount();
    });
    expect(signal.aborted).toBe(true);
  });
});

describe('Avatar picture', () => {
  const HIDDEN = { includeHiddenElements: true } as const;

  it('shows the picture, and falls back to the initials if it cannot load', async () => {
    await render(<Avatar name="Ayesha Rahman" pictureUrl="https://media.example.test/t.webp" />);
    expect(screen.getByTestId('avatar-picture', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByText('AR', HIDDEN)).not.toBeOnTheScreen();

    await act(async () => {
      await fireEvent(screen.getByTestId('avatar-picture', HIDDEN), 'error');
    });
    expect(screen.getByText('AR', HIDDEN)).toBeOnTheScreen();
  });

  it('shows the initials when there is no picture', async () => {
    await render(<Avatar name="Ayesha Rahman" />);
    expect(screen.getByText('AR', HIDDEN)).toBeOnTheScreen();
  });
});
