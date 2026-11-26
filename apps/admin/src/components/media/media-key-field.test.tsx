// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaKeyFieldProps } from './media-key-field';

/*
 * The media picker beside an image field.
 *
 * Opening it only lists pictures — nothing is uploaded and nothing is saved. Choosing one
 * writes the key into the same form field the store profile, SEO, onboarding and banner forms
 * have always posted, so the page's own Save button still does the work. The picker opens over
 * the page, so a form's other values are never lost to a navigation.
 */

const actions = vi.hoisted(() => ({ searchMediaAction: vi.fn(), uploadMediaAction: vi.fn() }));
vi.mock('@/lib/media-actions', () => actions);
// The upload tab is not opened here, but its module is part of the picker.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { MediaKeyField } = await import('./media-key-field');
const { CAMPAIGN_BANNER_GUIDANCE } = await import('@/lib/upload-guidance');

const CSRF = { name: 'csrf_token', token: 'signed-test-token' };

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: '0d000000-0000-4000-8000-000000000010',
    key: 'media/logo/0d000000-0000-4000-8000-000000000011',
    url: 'https://media.nilzora.test/media/logo/full.webp',
    thumbUrl: 'https://media.nilzora.test/media/logo/thumb.webp',
    contentType: 'image/webp',
    width: 800,
    height: 800,
    bytes: 24_000,
    alt: 'Store logo',
    originalName: 'logo.png',
    uploadedBy: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

function renderField(overrides: Partial<MediaKeyFieldProps> = {}) {
  const baseProps: MediaKeyFieldProps = {
    name: 'logoKey',
    label: 'Logo',
    hint: 'A square picture works best.',
    defaultValue: null,
    previewUrl: null,
    csrf: CSRF,
  };
  return render(<MediaKeyField {...baseProps} {...overrides} />);
}

function keyInput(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Logo');
}

async function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose a picture' }));
  await screen.findByRole('dialog');
}

afterEach(cleanup);

beforeEach(() => {
  // jsdom implements the element but not the modal methods; the picker only needs them to
  // mark itself open.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  actions.searchMediaAction.mockReset();
  actions.searchMediaAction.mockResolvedValue({ ok: true, assets: [asset()], total: 1 });
});

describe('the media key field', () => {
  it('shows the stored key and its picture', () => {
    renderField({
      defaultValue: 'media/logo/0d000000-0000-4000-8000-000000000011',
      previewUrl: 'https://media.nilzora.test/media/logo/thumb.webp',
    });

    expect(keyInput().value).toBe('media/logo/0d000000-0000-4000-8000-000000000011');
    expect(screen.getByRole('presentation', { hidden: true })).toBeTruthy();
  });

  it('lists the library in a dialog only when asked, and uploads nothing', async () => {
    renderField();
    expect(actions.searchMediaAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    await openPicker();

    await waitFor(() => expect(actions.searchMediaAction).toHaveBeenCalledTimes(1));
    const body = actions.searchMediaAction.mock.calls[0]?.[0] as FormData;
    expect(body.get(CSRF.name)).toBe(CSRF.token);
    expect(await screen.findByText('Store logo')).toBeTruthy();
    // Two ways in: the library and an upload, in the same window.
    expect(screen.getByRole('tab', { name: 'Media library' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Upload a picture' })).toBeTruthy();
    // Choosing is not saving.
    expect(actions.searchMediaAction).toHaveBeenCalledTimes(1);
  });

  it('writes the chosen picture key into the form field and closes', async () => {
    renderField();

    await openPicker();
    fireEvent.click(await screen.findByRole('button', { name: /Store logo/ }));

    expect(keyInput().value).toBe('media/logo/0d000000-0000-4000-8000-000000000011');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers the cropper, locked to the field’s shape, when the slot has guidance', async () => {
    renderField({ guidance: CAMPAIGN_BANNER_GUIDANCE, label: 'Banner picture' });

    // The guidance is printed before anything is chosen, not only after a refusal.
    expect(screen.getAllByText(/12:5/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Choose a picture' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('tab', { name: 'Upload a picture' }));

    // The upload tab is the crop-capable uploader (not the plain queue): its file field is
    // described by the 12:5 guidance the cropper is locked to.
    const field = dialog.querySelector<HTMLInputElement>('input[type="file"]');
    expect(field).not.toBeNull();
    const describedBy = field?.getAttribute('aria-describedby') ?? '';
    const guideId = describedBy.split(' ')[0];
    expect(guideId).toBeTruthy();
    expect(document.getElementById(guideId ?? '')?.textContent).toContain('12:5');
  });

  it('clears the field when the picture is removed', () => {
    renderField({ defaultValue: 'media/logo/0d000000-0000-4000-8000-000000000011' });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(keyInput().value).toBe('');
  });

  it('says why the library could not be listed', async () => {
    actions.searchMediaAction.mockResolvedValue({
      ok: false,
      message: 'The media library needs the "Manage store settings" permission.',
    });
    renderField();

    await openPicker();

    expect(
      await screen.findByText('The media library needs the "Manage store settings" permission.'),
    ).toBeTruthy();
  });

  it('searches the library with the typed text', async () => {
    renderField();

    await openPicker();
    await waitFor(() => expect(actions.searchMediaAction).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Search the media library'), {
      target: { value: 'welcome' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(actions.searchMediaAction).toHaveBeenCalledTimes(2));
    expect((actions.searchMediaAction.mock.calls[1]?.[0] as FormData).get('q')).toBe('welcome');
  });

  it('leaves the rest of the form untouched and keeps the field in its own form', async () => {
    render(
      <form aria-label="Share settings">
        <input aria-label="Share title" defaultValue="Winter sale" />
        <MediaKeyField
          name="ogImageKey"
          label="Share image"
          hint="1200 by 630 pixels."
          defaultValue={null}
          csrf={CSRF}
        />
        <button type="submit">Save</button>
      </form>,
    );

    await openPicker();
    fireEvent.click(await screen.findByRole('button', { name: /Store logo/ }));

    const form = screen.getByRole('form', { name: 'Share settings' });
    // The window never left the page: the other field still holds what was typed, and the
    // chosen key sits in the same form the Save button submits.
    expect(screen.getByLabelText('Share title')).toHaveProperty('value', 'Winter sale');
    expect(form.querySelector<HTMLInputElement>('input[name="ogImageKey"]')?.value).toBe(
      'media/logo/0d000000-0000-4000-8000-000000000011',
    );
    expect(within(form).getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
