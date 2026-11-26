import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePopupAction,
  removePopupArtworkAction,
  savePopupAction,
  setPopupActiveAction,
  uploadPopupArtworkAction,
} from './popup-actions';

/*
 * The popup actions: what reaches the API, what is refused before it does, and what an
 * administrator is told. Nothing here touches the media service or a bucket.
 */

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  savePopup: vi.fn(),
  setPopupActive: vi.fn(),
  uploadPopupArtwork: vi.fn(),
  removePopupArtwork: vi.fn(),
  deletePopup: vi.fn(),
}));
const act = vi.hoisted((): { outcome: Outcome; calls: number } => ({ outcome: 'ok', calls: 0 }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      act.calls += 1;
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`redirect:${url}`);
  }),
}));

const IDLE: FormState = { status: 'idle' };
const POPUP = '0e000000-0000-4000-8000-000000000001';
const API_TEXT = 'API text that must not reach the browser';

function file(bytes: readonly number[], name = 'art.gif', type = 'image/gif'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1');
}

/** The fields a designed template submits, before any override. */
function template(overrides: Record<string, string | File> = {}): FormData {
  return form({
    internalName: 'Eid campaign',
    displayMode: 'template',
    title: 'Eid on Nilzora',
    subtitle: '',
    description: '',
    buttonLabel: 'Shop the offer',
    buttonHref: '/categories/fashion',
    imageAlt: 'Two cotton sarees in blue and gold',
    delaySeconds: '10',
    frequency: 'once_per_session',
    startsAt: '',
    endsAt: '',
    ...overrides,
  });
}

beforeEach(() => {
  act.outcome = 'ok';
  act.calls = 0;
  revalidatePath.mockReset();
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('savePopupAction', () => {
  it('saves an image-only popup: no words, no link, no delay needed', async () => {
    const state = await savePopupAction(
      IDLE,
      form({
        internalName: 'Picture only',
        displayMode: 'artwork',
        title: '',
        subtitle: '',
        description: '',
        buttonLabel: '',
        buttonHref: '',
        imageAlt: '',
        delaySeconds: '0',
        frequency: 'once_ever',
        platform: 'app',
        audience: 'guests',
        priority: '7',
        startsAt: '',
        endsAt: '',
      }),
    );

    expect(state.status).toBe('success');
    expect(api.savePopup).toHaveBeenCalledWith(
      'access-token',
      null,
      expect.objectContaining({
        displayMode: 'artwork',
        title: null,
        buttonHref: null,
        delaySeconds: 0,
        frequency: 'once_ever',
        platform: 'app',
        audience: 'guests',
        priority: 7,
      }),
    );
  });

  it('refuses an unknown platform, audience, priority or delay on the server', async () => {
    const refused: Record<string, string>[] = [
      { platform: 'tv' },
      { audience: 'vip' },
      { priority: '5000' },
      { delaySeconds: '500' },
    ];
    for (const bad of refused) {
      const state = await savePopupAction(IDLE, template(bad));
      expect(state.status).toBe('error');
    }
    expect(api.savePopup).not.toHaveBeenCalled();
  });

  it('creates a popup with the copy and timing it was given', async () => {
    const state = await savePopupAction(IDLE, template());

    expect(state).toEqual({
      status: 'success',
      message: 'Popup created. Add its artwork below.',
    });
    expect(api.savePopup).toHaveBeenCalledWith(
      'access-token',
      null,
      expect.objectContaining({
        internalName: 'Eid campaign',
        displayMode: 'template',
        title: 'Eid on Nilzora',
        delaySeconds: 10,
        frequency: 'once_per_session',
        isActive: false,
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/popups');
  });

  it('updates the popup the form names', async () => {
    const state = await savePopupAction(IDLE, template({ popupId: POPUP }));

    expect(state.status).toBe('success');
    expect(api.savePopup).toHaveBeenCalledWith('access-token', POPUP, expect.anything());
  });

  it('reports a missing button link against the field, without calling the API', async () => {
    const state = await savePopupAction(
      IDLE,
      template({ buttonLabel: 'Shop the offer', buttonHref: '' }),
    );

    expect(state.status).toBe('error');
    expect(state.fieldErrors?.buttonHref).toBeDefined();
    expect(api.savePopup).not.toHaveBeenCalled();
  });

  it('reports a missing button label against the field', async () => {
    const state = await savePopupAction(
      IDLE,
      template({ buttonLabel: '', buttonHref: '/categories/fashion' }),
    );

    expect(state.status).toBe('error');
    expect(state.fieldErrors?.buttonLabel).toBeDefined();
  });

  it('refuses words over complete artwork, and says where the mistake is', async () => {
    const state = await savePopupAction(IDLE, template({ displayMode: 'artwork' }));

    expect(state.status).toBe('error');
    expect(state.fieldErrors?.displayMode).toBeDefined();
    expect(api.savePopup).not.toHaveBeenCalled();
  });

  it('reads the schedule as Bangladesh time and keeps the words the form had', async () => {
    const state = await savePopupAction(
      IDLE,
      template({ startsAt: '2026-12-01T10:00', endsAt: '2026-12-02T10:00' }),
    );

    expect(state.status).toBe('success');
    expect(api.savePopup).toHaveBeenCalledWith(
      'access-token',
      null,
      expect.objectContaining({
        startsAt: '2026-12-01T04:00:00.000Z',
        endsAt: '2026-12-02T04:00:00.000Z',
      }),
    );
  });

  it('reports a refused activation in the store’s own words, never the API’s', async () => {
    api.savePopup.mockRejectedValueOnce(refusal(409, 'popup_conflict'));
    const state = await savePopupAction(IDLE, template());

    expect(state.status).toBe('error');
    expect(state.message).toMatch(/could not be switched on/i);
    expect(state.message).not.toContain(API_TEXT);
  });

  it('keeps the typed values when the API refuses, so nothing has to be retyped', async () => {
    api.savePopup.mockRejectedValueOnce(refusal(400, 'popup_invalid'));
    const state = await savePopupAction(IDLE, template());

    expect(state.status).toBe('error');
    expect(state.values?.internalName).toBe('Eid campaign');
  });
});

describe('uploadPopupArtworkAction', () => {
  it('sends an animated GIF as the type it is, untouched', async () => {
    const bytes = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3];
    const state = await uploadPopupArtworkAction(
      IDLE,
      form({ popupId: POPUP, image: file(bytes) }),
    );

    expect(state).toEqual({ status: 'success', message: 'Artwork updated.' });
    const call = api.uploadPopupArtwork.mock.calls[0] as unknown as [
      string,
      string,
      { contentType: string; bytes: Uint8Array },
    ];
    expect(call[1]).toBe(POPUP);
    expect(call[2].contentType).toBe('image/gif');
    expect(Array.from(call[2].bytes)).toEqual(bytes);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/popups');
  });

  it('refuses a file that is not one of the four accepted types, before uploading', async () => {
    const state = await uploadPopupArtworkAction(
      IDLE,
      form({ popupId: POPUP, image: file([1, 2, 3], 'art.svg', 'image/svg+xml') }),
    );

    expect(state.status).toBe('error');
    expect(state.fieldErrors?.image).toMatch(/JPEG, PNG, WebP or animated GIF/);
    expect(api.uploadPopupArtwork).not.toHaveBeenCalled();
  });

  it('refuses a picture over the byte limit, before uploading', async () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'art.png', {
      type: 'image/png',
    });
    const state = await uploadPopupArtworkAction(IDLE, form({ popupId: POPUP, image: oversized }));

    expect(state.status).toBe('error');
    expect(state.fieldErrors?.image).toMatch(/under 5 MB/);
    expect(api.uploadPopupArtwork).not.toHaveBeenCalled();
  });

  it('refuses a form with no file', async () => {
    const state = await uploadPopupArtworkAction(IDLE, form({ popupId: POPUP }));

    expect(state.status).toBe('error');
    expect(api.uploadPopupArtwork).not.toHaveBeenCalled();
  });

  it('explains that a live popup cannot lose its artwork', async () => {
    api.removePopupArtwork.mockRejectedValueOnce(refusal(400, 'popup_invalid'));
    const state = await removePopupArtworkAction(IDLE, form({ popupId: POPUP }));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(/switch the popup off/i);
  });
});

describe('setPopupActiveAction and deletePopupAction', () => {
  it('switches a popup on', async () => {
    const state = await setPopupActiveAction(IDLE, form({ popupId: POPUP, active: 'true' }));

    expect(state).toEqual({ status: 'success', message: 'Popup is live.' });
    expect(api.setPopupActive).toHaveBeenCalledWith('access-token', POPUP, true);
  });

  it('switches a popup off', async () => {
    const state = await setPopupActiveAction(IDLE, form({ popupId: POPUP, active: 'false' }));

    expect(state.message).toBe('Popup switched off.');
    expect(api.setPopupActive).toHaveBeenCalledWith('access-token', POPUP, false);
  });

  it('deletes the popup the form names', async () => {
    const state = await deletePopupAction(IDLE, form({ popupId: POPUP }));

    expect(state).toEqual({ status: 'success', message: 'Popup deleted.' });
    expect(api.deletePopup).toHaveBeenCalledWith('access-token', POPUP);
  });

  it('refuses a stale page rather than acting on an unknown popup', async () => {
    const state = await deletePopupAction(IDLE, form({ popupId: 'not-a-uuid' }));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(/out of date/i);
    expect(api.deletePopup).not.toHaveBeenCalled();
  });
});
