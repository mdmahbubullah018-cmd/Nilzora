// @vitest-environment jsdom
import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { PictureUploadForm } from './picture-upload-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refresh, replace: vi.fn(), push: vi.fn() }),
}));
const refresh = vi.hoisted(() => vi.fn());

/** The browser's XMLHttpRequest, played by hand: the test fires the events a real one would. */
class Xhr {
  static all: Xhr[] = [];
  upload: { onprogress: ((e: ProgressEvent) => void) | null; onload: (() => void) | null } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  url = '';
  body: FormData | null = null;
  constructor() {
    Xhr.all.push(this);
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  answer(body: object) {
    this.upload.onload?.();
    this.status = 200;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

const csrf: CsrfInput = { name: '__csrf', token: 't' };
const serverAction = vi.fn(() => Promise.resolve({ status: 'idle' as const }));

beforeEach(() => {
  Xhr.all = [];
  refresh.mockReset();
  serverAction.mockClear();
  vi.stubGlobal('XMLHttpRequest', Xhr);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

function pick(file: File) {
  const input = screen.getByLabelText(/Upload a picture/);
  fireEvent.change(input, { target: { files: [file] } });
}

function renderForm() {
  return render(
    <PictureUploadForm
      kind="category-image"
      idName="categoryId"
      idValue="c1"
      csrf={csrf}
      label="Upload a picture"
      action={serverAction}
    />,
  );
}

describe('PictureUploadForm', () => {
  it('rejects a file over 5 MB and a non-image on the spot, with the submit button blocked', () => {
    renderForm();

    pick(new File([new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1)], 'big.png', { type: 'image/png' }));
    expect(screen.getByRole('alert').textContent).toContain('5 MB');
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(true);

    pick(new File([new Uint8Array(8)], 'notes.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('alert').textContent).toMatch(/JPEG, PNG or WebP/);
    expect(Xhr.all).toHaveLength(0);
  });

  it('previews a valid file, then posts the form to its upload route and shows the real bytes', () => {
    renderForm();
    pick(new File([new Uint8Array(PNG)], 'cover.png', { type: 'image/png' }));
    expect(screen.getByText('cover.png')).not.toBeNull();

    fireEvent.submit(
      screen.getByRole('button', { name: 'Upload' }).closest('form') as HTMLFormElement,
    );

    expect(Xhr.all).toHaveLength(1);
    const xhr = Xhr.all[0] as Xhr;
    expect(xhr.url).toBe('/api/uploads/category-image');
    expect(xhr.body?.get('categoryId')).toBe('c1');
    expect(xhr.body?.get('image')).toBeInstanceOf(File);
    // The browser's Server Action path is not used while the upload route is.
    expect(serverAction).not.toHaveBeenCalled();

    act(() => xhr.progress(512, 2048));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });

  it('ignores a second submit while the first is running, and locks the file field', () => {
    renderForm();
    pick(new File([new Uint8Array(PNG)], 'cover.png', { type: 'image/png' }));
    const formElement = screen
      .getByRole('button', { name: 'Upload' })
      .closest('form') as HTMLFormElement;

    fireEvent.submit(formElement);
    fireEvent.submit(formElement);

    expect(Xhr.all).toHaveLength(1);
    expect(screen.getByLabelText(/Upload a picture/).hasAttribute('disabled')).toBe(true);
  });

  it('refreshes the page and shows the success message only after the server confirms', async () => {
    renderForm();
    pick(new File([new Uint8Array(PNG)], 'cover.png', { type: 'image/png' }));
    fireEvent.submit(
      screen.getByRole('button', { name: 'Upload' }).closest('form') as HTMLFormElement,
    );
    const xhr = Xhr.all[0] as Xhr;

    act(() => xhr.progress(2048, 2048));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText('Picture updated.')).toBeNull();

    await act(async () => {
      xhr.answer({ status: 'success', message: 'Picture updated.' });
      await Promise.resolve();
    });

    expect(screen.getByText('Picture updated.')).not.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('hands the stored picture back to a picker that asked for it', async () => {
    const onUploaded = vi.fn();
    render(
      <PictureUploadForm
        kind="media"
        csrf={csrf}
        label="Upload a picture"
        action={serverAction}
        onUploaded={onUploaded}
      />,
    );
    pick(new File([new Uint8Array(PNG)], 'banner.png', { type: 'image/png' }));
    fireEvent.submit(
      screen.getByRole('button', { name: 'Upload' }).closest('form') as HTMLFormElement,
    );

    await act(async () => {
      (Xhr.all[0] as Xhr).answer({
        status: 'success',
        message: 'Picture added to the library.',
        values: {
          mediaKey: 'media/banner/0d000000-0000-4000-8000-000000000011',
          mediaUrl: 'https://media.nilzora.test/media/banner/full.webp',
          mediaThumbUrl: 'https://media.nilzora.test/media/banner/thumb.webp',
        },
      });
      await Promise.resolve();
    });

    expect(onUploaded).toHaveBeenCalledWith({
      key: 'media/banner/0d000000-0000-4000-8000-000000000011',
      url: 'https://media.nilzora.test/media/banner/full.webp',
      thumbUrl: 'https://media.nilzora.test/media/banner/thumb.webp',
    });
  });

  it('keeps the chosen file after a refusal, offers a retry, and sends the same file again', async () => {
    renderForm();
    pick(new File([new Uint8Array(PNG)], 'cover.png', { type: 'image/png' }));
    fireEvent.submit(
      screen.getByRole('button', { name: 'Upload' }).closest('form') as HTMLFormElement,
    );

    await act(async () => {
      (Xhr.all[0] as Xhr).answer({ status: 'error', message: 'The picture is too large.' });
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain('too large');
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
      await Promise.resolve();
    });
    expect(Xhr.all).toHaveLength(2);
    expect((Xhr.all[1] as Xhr).body?.get('image')).toBeInstanceOf(File);
  });
});

describe('PictureUploadForm guidance and picking', () => {
  it('shows the size and shape of the slot it uploads to, not one rule for every picture', () => {
    const { unmount } = render(
      <PictureUploadForm
        kind="banner-image"
        placement="home_hero"
        idName="bannerId"
        idValue="b1"
        csrf={csrf}
        label="Upload picture"
        action={serverAction}
      />,
    );
    expect(screen.getByText(/Recommended 2400 × 1000 px \(12:5\)/)).not.toBeNull();
    unmount();

    renderForm();
    expect(screen.getByText(/Recommended 800 × 800 px \(1:1\)/)).not.toBeNull();
    expect(screen.getByText(/up to 5 MB/)).not.toBeNull();
  });

  it('takes a picture dropped on the area, and Remove clears it again', () => {
    renderForm();
    const area = screen.getByLabelText(/Upload a picture/).closest('label') as HTMLLabelElement;
    const file = new File([new Uint8Array(PNG)], 'dropped.png', { type: 'image/png' });
    fireEvent.drop(area, { dataTransfer: { files: [file] } });
    expect(screen.getByText('dropped.png')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(screen.queryByText('dropped.png')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(true);
  });

  it('offers cropping and rotating for a valid picture only', () => {
    renderForm();
    pick(new File([new Uint8Array(8)], 'notes.pdf', { type: 'application/pdf' }));
    expect(
      screen.queryByRole('button', { name: /Crop or rotate/ })?.hasAttribute('disabled') ?? true,
    ).toBe(true);
    pick(new File([new Uint8Array(PNG)], 'cover.png', { type: 'image/png' }));
    expect(screen.getByRole('button', { name: /Crop or rotate/ }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});
