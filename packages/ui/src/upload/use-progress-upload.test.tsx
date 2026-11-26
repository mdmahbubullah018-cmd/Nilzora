import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeXhr } from './fake-xhr';
import { UploadProgress } from './upload-progress';
import { useProgressUpload } from './use-progress-upload';

afterEach(cleanup);

const requests: FakeXhr[] = [];
const onSuccess = vi.fn();

beforeEach(() => {
  requests.length = 0;
  onSuccess.mockReset();
});

function Harness({ file }: { file: { name: string; size: number } }) {
  const upload = useProgressUpload({
    endpoint: '/api/uploads/brand-logo',
    onSuccess,
    createRequest: () => {
      const xhr = new FakeXhr();
      requests.push(xhr);
      return xhr.asRequest();
    },
  });
  return (
    <form
      data-testid="form"
      onSubmit={(event) => {
        event.preventDefault();
        upload.send(event.currentTarget, file);
      }}
    >
      <input name="brandId" defaultValue="b1" />
      <button type="submit">send</button>
      <button type="button" onClick={upload.cancel}>
        cancel
      </button>
      <output data-testid="busy">{String(upload.busy)}</output>
      <UploadProgress state={upload.state} onRetry={() => upload.send(document.forms[0]!, file)} />
    </form>
  );
}

const FILE = { name: 'logo.png', size: 4_000_000 };

function submit() {
  act(() => screen.getByRole('button', { name: 'send' }).click());
}
const last = () => requests[requests.length - 1]!;

/** Plays one browser event, then lets the upload's promise settle before the test looks. */
async function flush(event: () => void): Promise<void> {
  await act(async () => {
    event();
    await Promise.resolve();
  });
}

describe('useProgressUpload', () => {
  it('shows the browser-reported bytes, then a separate processing step, then success on the answer', async () => {
    render(<Harness file={FILE} />);
    submit();

    act(() => last().progress(1_000_000, 4_000_000));
    const bar = screen.getByRole('progressbar', { name: 'Uploading logo.png' });
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('Uploading… 25%')).not.toBeNull();
    expect(screen.getByText('977 KB / 3.8 MB')).not.toBeNull();

    act(() => last().progress(4_000_000, 4_000_000));
    act(() => last().transferred());
    // Every byte is sent but the server has not answered: no 100% success, no percentage at all.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/Checking and saving the image/)).not.toBeNull();
    expect(screen.queryByText(/uploaded successfully|Logo updated/i)).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('busy').textContent).toBe('true');

    await flush(() => last().respond(200, { status: 'success', message: 'Logo updated.' }));
    expect(screen.getByText('Logo updated.')).not.toBeNull();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('busy').textContent).toBe('false');
  });

  it('sends the form fields and refuses a second send while one is running', () => {
    render(<Harness file={FILE} />);
    submit();
    submit();
    submit();

    expect(requests).toHaveLength(1);
    const body = last().body as FormData;
    expect(body.get('brandId')).toBe('b1');
  });

  it('allows a new send once the previous one has finished', async () => {
    render(<Harness file={FILE} />);
    submit();
    act(() => last().transferred());
    await flush(() => last().respond(200, { status: 'success', message: 'Done.' }));
    submit();

    expect(requests).toHaveLength(2);
  });

  it('reports a refusal from the server as an error with no success message and no success callback', async () => {
    render(<Harness file={FILE} />);
    submit();
    act(() => last().transferred());
    await flush(() =>
      last().respond(200, { status: 'error', message: 'This picture was refused: too small.' }),
    );

    expect(screen.getByRole('alert').textContent).toContain('too small');
    expect(onSuccess).not.toHaveBeenCalled();
    // The server looked at the file and refused it, so choosing another is safe.
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull();
  });

  it('offers a retry when the connection dropped before the file was fully sent', async () => {
    render(<Harness file={FILE} />);
    submit();
    act(() => last().progress(500_000, 4_000_000));
    await flush(() => last().fail());

    expect(screen.getByRole('alert').textContent).toContain('Nothing was saved');
    act(() => screen.getByRole('button', { name: 'Try again' }).click());
    expect(requests).toHaveLength(2);
  });

  it('does not offer a retry once the file was sent but never confirmed', async () => {
    render(<Harness file={FILE} />);
    submit();
    act(() => last().progress(4_000_000, 4_000_000));
    act(() => last().transferred());
    await flush(() => last().fail());

    expect(screen.getByRole('alert').textContent).toContain('before Nilzora confirmed');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does not treat an unexpected page as a success', async () => {
    render(<Harness file={FILE} />);
    submit();
    act(() => last().transferred());
    await flush(() => last().respond(200, '<!doctype html><title>Sign in</title>'));

    expect(screen.getByRole('alert').textContent).toContain('session may have ended');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('cancels the transfer and returns to idle, and cancels when the form unmounts', async () => {
    const view = render(<Harness file={FILE} />);
    submit();
    await flush(() => screen.getByRole('button', { name: 'cancel' }).click());
    expect(last().aborted).toBe(true);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('busy').textContent).toBe('false');

    submit();
    view.unmount();
    expect(last().aborted).toBe(true);
  });
});
