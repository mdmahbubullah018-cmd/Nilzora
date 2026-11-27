import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  saveSeoAction,
  saveStoreProfileAction,
} from './site-actions';

/*
 * The SEO, store profile and inbox actions used to return nothing, so a refusal was
 * invisible. Each now answers with a state the form shows: fixed messages only, nothing
 * from the API's own text, and nothing reaches the API from an untrusted or malformed form.
 */

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  saveProductSeo: vi.fn(),
  saveCategorySeo: vi.fn(),
  saveStoreProfile: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
const act = vi.hoisted((): { outcome: Outcome } => ({ outcome: 'ok' }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const IDLE: FormState = { status: 'idle' };
const ID = '1d000000-0000-4000-8000-000000000001';
const API_TEXT = 'API text that must not reach the browser';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1');
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof RedirectSignal)) throw new Error('expected a redirect');
  return error.url;
}

beforeEach(() => {
  act.outcome = 'ok';
  revalidatePath.mockReset();
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('saveSeoAction', () => {
  const SEO = {
    kind: 'product',
    targetId: ID,
    seoTitle: ' Brass lamp ',
    seoDescription: '',
    ogTitle: '',
    ogDescription: '',
    ogImageKey: 'library/0d000000-0000-4000-8000-000000000009',
    canonicalPath: '/products/brass-lamp',
    noIndex: 'on',
  };

  it('saves a product’s metadata and answers with a success state', async () => {
    const state = await saveSeoAction(IDLE, form(SEO));
    expect(state).toEqual({ status: 'success', message: 'Search metadata saved.' });
    expect(api.saveProductSeo).toHaveBeenCalledWith('access-token', ID, {
      seoTitle: 'Brass lamp',
      seoDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageKey: 'library/0d000000-0000-4000-8000-000000000009',
      canonicalPath: '/products/brass-lamp',
      noIndex: true,
    });
    // The editor's address takes the singular kind: a plural path is a 404.
    expect(revalidatePath).toHaveBeenCalledWith('/admin/seo');
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/seo/product/${ID}`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/admin/seo/products/${ID}`);
  });

  it('saves a category through its own call, and sends a lapsed session back to the singular address', async () => {
    await saveSeoAction(IDLE, form({ ...SEO, kind: 'category' }));
    expect(api.saveCategorySeo).toHaveBeenCalledWith('access-token', ID, expect.any(Object));
    expect(api.saveProductSeo).not.toHaveBeenCalled();

    act.outcome = 'signed_out';
    await expect(redirectOf(saveSeoAction(IDLE, form(SEO)))).resolves.toBe(
      `/login?next=${encodeURIComponent(`/admin/seo/product/${ID}`)}`,
    );
  });

  it('marks every field that is too long or off-site before calling the API', async () => {
    const state = await saveSeoAction(
      IDLE,
      form({
        ...SEO,
        seoTitle: 'x'.repeat(71),
        seoDescription: 'y'.repeat(201),
        canonicalPath: 'https://evil.example/',
        ogImageKey: 'https://evil.example/a.png',
      }),
    );
    expect(state.status).toBe('error');
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual([
      'canonicalPath',
      'ogImageKey',
      'seoDescription',
      'seoTitle',
    ]);
    expect(state.values?.seoTitle).toBe('x'.repeat(71));
    expect(api.saveProductSeo).not.toHaveBeenCalled();
  });

  it('refuses a plural kind, a bad id and an untrusted form without reaching the API', async () => {
    expect((await saveSeoAction(IDLE, form({ ...SEO, kind: 'products' }))).message).toMatch(
      /out of date/,
    );
    expect((await saveSeoAction(IDLE, form({ ...SEO, targetId: '../x' }))).message).toMatch(
      /out of date/,
    );
    act.outcome = 'untrusted';
    expect((await saveSeoAction(IDLE, form(SEO))).status).toBe('error');
    expect(api.saveProductSeo).not.toHaveBeenCalled();
  });

  it('shows a fixed message for a refusal, never the API’s text', async () => {
    api.saveProductSeo.mockRejectedValue(refusal(403, 'forbidden'));
    const forbidden = await saveSeoAction(IDLE, form(SEO));
    expect(forbidden.message).toBe('Your account does not have permission for this action.');
    expect(forbidden.values?.seoTitle).toBe(' Brass lamp ');

    api.saveProductSeo.mockRejectedValue(refusal(404, 'seo_target_missing'));
    expect((await saveSeoAction(IDLE, form(SEO))).message).toBe(
      'That page no longer exists. Reload the list.',
    );
    api.saveProductSeo.mockRejectedValue(refusal(500, 'internal'));
    const unknown = await saveSeoAction(IDLE, form(SEO));
    expect(unknown.status).toBe('error');
    expect(JSON.stringify(unknown)).not.toContain(API_TEXT);
  });
});

describe('saveStoreProfileAction', () => {
  const PROFILE = { displayName: ' Nilzora ', tagline: 'Everyday essentials.' };

  it('saves the profile, turning empty fields into null', async () => {
    const state = await saveStoreProfileAction(IDLE, form(PROFILE));
    expect(state).toEqual({ status: 'success', message: 'Store profile saved.' });
    expect(api.saveStoreProfile).toHaveBeenCalledTimes(1);
    expect(api.saveStoreProfile.mock.calls[0]?.[1]).toMatchObject({
      displayName: 'Nilzora',
      tagline: 'Everyday essentials.',
      description: null,
      contactEmail: null,
      socialFacebook: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/store-profile');
  });

  it('sends the app, messaging and extra social fields, validated by the contract', async () => {
    await saveStoreProfileAction(
      IDLE,
      form({
        ...PROFILE,
        whatsappNumber: '+8801712345678',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora',
        appStoreUrl: 'https://apps.apple.com/bd/app/nilzora/id123456789',
        socialTiktok: 'https://www.tiktok.com/@nilzora',
        socialX: 'https://x.com/nilzora',
      }),
    );
    expect(api.saveStoreProfile.mock.calls[0]?.[1]).toMatchObject({
      whatsappNumber: '+8801712345678',
      playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora',
      appStoreUrl: 'https://apps.apple.com/bd/app/nilzora/id123456789',
      socialTiktok: 'https://www.tiktok.com/@nilzora',
      socialX: 'https://x.com/nilzora',
    });
  });

  it('marks a wrong WhatsApp number, store link or email beside its field, keeping what was typed', async () => {
    const state = await saveStoreProfileAction(
      IDLE,
      form({
        ...PROFILE,
        whatsappNumber: '01712345678',
        playStoreUrl: 'https://example.com/app',
        appStoreUrl: 'http://apps.apple.com/x',
        contactEmail: 'not an email',
        socialFacebook: 'facebook.com/nilzora',
      }),
    );
    expect(state.status).toBe('error');
    expect(state.fieldErrors?.whatsappNumber).toBe(
      'Use a Bangladeshi mobile number such as +8801712345678',
    );
    expect(state.fieldErrors?.playStoreUrl).toMatch(/Google Play address/);
    expect(state.fieldErrors?.appStoreUrl).toMatch(/App Store address/);
    expect(state.fieldErrors?.contactEmail).toMatch(/valid email/);
    expect(state.fieldErrors?.socialFacebook).toMatch(/https/);
    expect(state.values?.whatsappNumber).toBe('01712345678');
    expect(api.saveStoreProfile).not.toHaveBeenCalled();
  });

  it('requires a store name', async () => {
    const state = await saveStoreProfileAction(IDLE, form({ displayName: '  ' }));
    expect(state.fieldErrors?.displayName).toMatch(/store name/);
    expect(api.saveStoreProfile).not.toHaveBeenCalled();
  });

  it('keeps a newer field the loaded profile did not carry, but clears one the form showed', async () => {
    // The form showed no WhatsApp/app fields (an older payload) and they were left empty.
    await saveStoreProfileAction(
      IDLE,
      form({
        ...PROFILE,
        absentFields: 'whatsappNumber,playStoreUrl,appStoreUrl,socialTiktok,socialX',
      }),
    );
    const kept = api.saveStoreProfile.mock.calls[0]?.[1] as Record<string, unknown>;
    for (const field of [
      'whatsappNumber',
      'playStoreUrl',
      'appStoreUrl',
      'socialTiktok',
      'socialX',
    ]) {
      expect(kept).not.toHaveProperty(field);
    }

    // The payload carried them: an empty field is the person clearing it.
    await saveStoreProfileAction(IDLE, form({ ...PROFILE, absentFields: '' }));
    const cleared = api.saveStoreProfile.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(cleared.whatsappNumber).toBeNull();
    expect(cleared.playStoreUrl).toBeNull();
  });

  it('shows fixed messages for refusals and reaches no API with an untrusted form', async () => {
    api.saveStoreProfile.mockRejectedValue(refusal(403, 'forbidden'));
    const forbidden = await saveStoreProfileAction(IDLE, form(PROFILE));
    expect(forbidden.message).toBe('Your account does not have permission for this action.');
    expect(forbidden.values?.displayName).toBe(' Nilzora ');

    api.saveStoreProfile.mockRejectedValue(refusal(400, 'store_profile_invalid'));
    expect((await saveStoreProfileAction(IDLE, form(PROFILE))).message).toBe(
      'Check the store details and try again.',
    );
    expect(JSON.stringify(forbidden)).not.toContain(API_TEXT);

    api.saveStoreProfile.mockClear();
    act.outcome = 'untrusted';
    expect((await saveStoreProfileAction(IDLE, form(PROFILE))).status).toBe('error');
    expect(api.saveStoreProfile).not.toHaveBeenCalled();
  });
});

describe('inbox actions', () => {
  it('marks one notification read, or says why not', async () => {
    expect(await markNotificationReadAction(IDLE, form({ notificationId: ID }))).toEqual({
      status: 'success',
      message: 'Marked as read.',
    });
    expect(api.markNotificationRead).toHaveBeenCalledWith('access-token', ID);

    api.markNotificationRead.mockRejectedValue(refusal(404, 'notification_not_found'));
    expect((await markNotificationReadAction(IDLE, form({ notificationId: ID }))).message).toBe(
      'That notification is no longer available.',
    );
    expect((await markNotificationReadAction(IDLE, form({ notificationId: 'x' }))).message).toMatch(
      /out of date/,
    );
  });

  it('marks everything read, or says why not', async () => {
    expect((await markAllNotificationsReadAction(IDLE, form({}))).status).toBe('success');
    expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1);

    api.markAllNotificationsRead.mockRejectedValue(refusal(429, 'rate_limited'));
    const state = await markAllNotificationsReadAction(IDLE, form({}));
    expect(state.message).toBe('Too many changes in a short time. Wait a moment, then try again.');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});
