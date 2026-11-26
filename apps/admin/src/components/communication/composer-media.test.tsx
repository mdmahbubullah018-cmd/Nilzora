// @vitest-environment jsdom
import { CHAT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerMediaMenu } from './composer-media';

/*
 * The Communication Center's media menu. Choosing a file must not start anything: the menu
 * holds it, shows a preview, and only its Upload action starts the request. The boundary is
 * stubbed at `XMLHttpRequest`, so each test plays exactly the events a real request fires and
 * the component has to react to them — nothing here is timed or simulated.
 */

const CONVERSATION_ID = '55555555-5555-4555-8555-555555555555';
const MEGABYTE = 1024 * 1024;

/** A stand-in for the browser's XMLHttpRequest: only what the upload transport touches. */
class FakeXhr {
  static all: FakeXhr[] = [];

  upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  url = '';
  headers: Record<string, string> = {};
  sent: unknown = null;

  constructor() {
    FakeXhr.all.push(this);
  }

  static reset(): void {
    FakeXhr.all = [];
  }

  open(_method: string, url: string): void {
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.onabort?.();
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  answer(body: object, status = 201): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

function file(name: string, size: number, type: string): File {
  return new File([new Uint8Array(new ArrayBuffer(size))], name, { type });
}

function renderMenu(
  options: {
    onAttached?: (attachment: { id: string; fileName: string }) => void;
    onPendingChange?: (pending: boolean) => void;
  } = {},
) {
  const onAttached = options.onAttached ?? vi.fn();
  const onPendingChange = options.onPendingChange ?? vi.fn();
  const view = render(
    <ComposerMediaMenu
      conversationId={CONVERSATION_ID}
      attachment={null}
      onAttached={onAttached}
      onCleared={vi.fn()}
      onPendingChange={onPendingChange}
      disabled={false}
    />,
  );
  const inputs = view.container.querySelectorAll('input[type="file"]');
  if (inputs.length !== 2) throw new Error(`expected two file inputs, found ${inputs.length}`);
  const [fileInput] = [...inputs] as [HTMLInputElement, HTMLInputElement];
  return { onAttached, onPendingChange, fileInput };
}

beforeEach(() => {
  FakeXhr.reset();
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ComposerMediaMenu', () => {
  it('previews a chosen file and sends nothing until Upload is pressed', () => {
    const { onAttached, onPendingChange, fileInput } = renderMenu();

    fireEvent.change(fileInput, {
      target: { files: [file('photo.png', 2 * MEGABYTE, 'image/png')] },
    });

    expect(FakeXhr.all).toHaveLength(0);
    expect(screen.getByText('photo.png')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    expect(onAttached).not.toHaveBeenCalled();
  });

  it('uploads on the explicit action with real byte progress, then attaches it', async () => {
    const { onAttached, onPendingChange, fileInput } = renderMenu();

    fireEvent.change(fileInput, {
      target: { files: [file('photo.png', 2 * MEGABYTE, 'image/png')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    const request = FakeXhr.all[0];
    expect(request?.url).toContain('/api/support/attachments');
    expect(request?.url).toContain(`conversationId=${CONVERSATION_ID}`);
    expect(request?.headers['Content-Type']).toBe('image/png');

    request?.progress(MEGABYTE, 2 * MEGABYTE);
    await waitFor(() => expect(screen.getByText(/uploading…?\s*50%/i)).toBeTruthy());

    request?.progress(2 * MEGABYTE, 2 * MEGABYTE);
    request?.answer({ id: 'attachment-1', fileName: 'photo.webp' });

    await waitFor(() =>
      expect(onAttached).toHaveBeenCalledWith({ id: 'attachment-1', fileName: 'photo.webp' }),
    );
    // Clearing the preview re-renders before the effect reports it: assert the eventual state.
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
  });

  it('refuses a file above its kind ceiling without starting a request', async () => {
    const { fileInput } = renderMenu();

    fireEvent.change(fileInput, {
      target: { files: [file('huge.png', CHAT_IMAGE_MAX_BYTES + 1, 'image/png')] },
    });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('larger than 10 MB'),
    );
    expect(FakeXhr.all).toHaveLength(0);
  });

  it('refuses a type that is not on the allowlist', async () => {
    const { fileInput } = renderMenu();

    fireEvent.change(fileInput, {
      target: { files: [file('setup.exe', 1024, 'application/x-msdownload')] },
    });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Attach a picture'),
    );
    expect(FakeXhr.all).toHaveLength(0);
  });

  it("shows the route's own refusal and attaches nothing", async () => {
    const { onAttached, fileInput } = renderMenu();

    fireEvent.change(fileInput, { target: { files: [file('photo.png', 1024, 'image/png')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    FakeXhr.all[0]?.answer(
      { error: { code: 'media_unavailable', message: 'Attachments are unavailable.' } },
      503,
    );

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Attachments are unavailable.'),
    );
    expect(onAttached).not.toHaveBeenCalled();
  });

  it('sends a document as its own type with its file name', () => {
    const { fileInput } = renderMenu();

    fireEvent.change(fileInput, {
      target: { files: [file('invoice.pdf', 4 * MEGABYTE, 'application/pdf')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(FakeXhr.all[0]?.url).toContain('fileName=invoice.pdf');
    expect(FakeXhr.all[0]?.headers['Content-Type']).toBe('application/pdf');
    expect((FakeXhr.all[0]?.sent as File).name).toBe('invoice.pdf');
  });

  it('discards a chosen file without sending it', () => {
    const { fileInput } = renderMenu();

    fireEvent.change(fileInput, { target: { files: [file('photo.png', 1024, 'image/png')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(FakeXhr.all).toHaveLength(0);
    expect(screen.queryByText('photo.png')).toBeNull();
  });
});
