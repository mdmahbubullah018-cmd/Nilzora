import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import {
  deleteMenuItemAction,
  moveMenuItemAction,
  saveHomepageAction,
  saveMenuItemAction,
  saveSitePageAction,
} from './content-actions';

/*
 * The static page, menu and homepage actions answer with a state the form shows: fixed
 * messages only (never the API's own text), nothing reaches the API from an untrusted or
 * malformed form, and a client-supplied slug, menu or order cannot widen what is saved.
 */

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminSaveSitePage: vi.fn(),
  adminCreateMenuItem: vi.fn(),
  adminUpdateMenuItem: vi.fn(),
  adminDeleteMenuItem: vi.fn(),
  adminReorderMenu: vi.fn(),
  adminSaveHomepage: vi.fn(),
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
const A = '1d000000-0000-4000-8000-00000000000a';
const B = '1d000000-0000-4000-8000-00000000000b';
const C = '1d000000-0000-4000-8000-00000000000c';
const API_TEXT = 'API text that must not reach the browser';
const EXPIRED = 'This page is out of date. Reload it and try again.';

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

describe('saveSitePageAction', () => {
  const PAGE = {
    slug: 'about',
    title: ' About us ',
    body: 'Who we are.',
    isPublished: 'on',
    seoTitle: '',
    seoDescription: '',
  };

  it('saves a page by its slug and says whether visitors can see it', async () => {
    const state = await saveSitePageAction(IDLE, form(PAGE));
    expect(state).toEqual({
      status: 'success',
      message: 'Page saved and published. Visitors see it now.',
    });
    expect(api.adminSaveSitePage).toHaveBeenCalledWith('access-token', 'about', {
      title: 'About us',
      body: 'Who we are.',
      isPublished: true,
      seoTitle: null,
      seoDescription: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/pages');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/pages/about');

    const draft = await saveSitePageAction(IDLE, form({ ...PAGE, isPublished: '' }));
    expect(draft.status).toBe('success');
    expect(draft.message).toContain('Draft saved');
    expect(api.adminSaveSitePage.mock.calls[1]?.[2]).toMatchObject({ isPublished: false });
  });

  it('refuses a slug that is not one of the six pages before calling the API', async () => {
    for (const slug of ['contact', '../about', '', 'ABOUT']) {
      const state = await saveSitePageAction(IDLE, form({ ...PAGE, slug }));
      expect(state).toEqual({ status: 'error', message: EXPIRED });
    }
    expect(api.adminSaveSitePage).not.toHaveBeenCalled();
  });

  it('marks the fields that fail the shared rules and keeps what was typed', async () => {
    const state = await saveSitePageAction(IDLE, form({ ...PAGE, title: '', body: '   ' }));
    expect(state.status).toBe('error');
    if (state.status !== 'error') return;
    expect(state.fieldErrors).toMatchObject({
      title: 'Enter a title of up to 120 characters.',
      body: 'A published page needs text. Write it, or save it as a draft.',
    });
    expect(state.values?.body).toBe('   ');
    expect(api.adminSaveSitePage).not.toHaveBeenCalled();
  });

  it('shows a fixed message for a refusal and keeps what was typed, never the API text', async () => {
    api.adminSaveSitePage.mockRejectedValue(refusal(403, 'forbidden'));
    const state = await saveSitePageAction(IDLE, form(PAGE));
    expect(state.status).toBe('error');
    expect(state.message).toContain('Manage store settings');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
    if (state.status === 'error') expect(state.values?.title).toBe(' About us ');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reaches no API with an untrusted form, and sends a lapsed session back to the page', async () => {
    act.outcome = 'untrusted';
    expect((await saveSitePageAction(IDLE, form(PAGE))).status).toBe('error');
    expect(api.adminSaveSitePage).not.toHaveBeenCalled();

    act.outcome = 'signed_out';
    await expect(redirectOf(saveSitePageAction(IDLE, form(PAGE)))).resolves.toBe(
      `/login?next=${encodeURIComponent('/admin/pages/about')}`,
    );
  });
});

describe('saveMenuItemAction', () => {
  const LINK = { menu: 'header', label: ' Sale ', href: '/products', isActive: 'on' };

  it('adds a link when the form carries no id', async () => {
    const state = await saveMenuItemAction(IDLE, form(LINK));
    expect(state).toEqual({ status: 'success', message: 'Link added.' });
    expect(api.adminCreateMenuItem).toHaveBeenCalledWith('access-token', {
      menu: 'header',
      label: 'Sale',
      href: '/products',
      isActive: true,
    });
    expect(api.adminUpdateMenuItem).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/navigation');
  });

  it('saves a link when the form carries a valid id, and an unticked box hides it', async () => {
    const state = await saveMenuItemAction(IDLE, form({ ...LINK, itemId: A, isActive: '' }));
    expect(state).toEqual({ status: 'success', message: 'Link saved.' });
    expect(api.adminUpdateMenuItem).toHaveBeenCalledWith(
      'access-token',
      A,
      expect.objectContaining({ isActive: false }),
    );
    expect(api.adminCreateMenuItem).not.toHaveBeenCalled();
  });

  it('treats a malformed id as an out-of-date page, never as a new link', async () => {
    const state = await saveMenuItemAction(IDLE, form({ ...LINK, itemId: 'not-an-id' }));
    expect(state).toEqual({ status: 'error', message: EXPIRED });
    expect(api.adminCreateMenuItem).not.toHaveBeenCalled();
    expect(api.adminUpdateMenuItem).not.toHaveBeenCalled();
  });

  it('marks an off-site or script link and an unknown menu before calling the API', async () => {
    const bad = await saveMenuItemAction(
      IDLE,
      form({ ...LINK, href: 'javascript:alert(1)', menu: 'sidebar' }),
    );
    expect(bad.status).toBe('error');
    if (bad.status === 'error') {
      expect(bad.fieldErrors?.href).toBe(
        'Use a store path such as /products, or an https address.',
      );
      expect(bad.fieldErrors?.menu).toBe('Choose which menu the link belongs to.');
      expect(bad.values?.href).toBe('javascript:alert(1)');
    }
    expect(api.adminCreateMenuItem).not.toHaveBeenCalled();
  });

  it('shows a fixed message when a menu is full or refuses, never the API text', async () => {
    api.adminCreateMenuItem.mockRejectedValue(refusal(400, 'bad_request'));
    const state = await saveMenuItemAction(IDLE, form(LINK));
    expect(state.status).toBe('error');
    expect(state.message).toContain('at most 12 links');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});

describe('deleteMenuItemAction', () => {
  it('removes the named link', async () => {
    const state = await deleteMenuItemAction(IDLE, form({ itemId: A }));
    expect(state).toEqual({ status: 'success', message: 'Link removed.' });
    expect(api.adminDeleteMenuItem).toHaveBeenCalledWith('access-token', A);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/navigation');
  });

  it('needs a valid id, and says plainly when the link is already gone', async () => {
    expect(await deleteMenuItemAction(IDLE, form({ itemId: 'x' }))).toEqual({
      status: 'error',
      message: EXPIRED,
    });
    expect(api.adminDeleteMenuItem).not.toHaveBeenCalled();

    api.adminDeleteMenuItem.mockRejectedValue(refusal(404, 'not_found'));
    const gone = await deleteMenuItemAction(IDLE, form({ itemId: A }));
    expect(gone.status).toBe('error');
    expect(gone.message).toBe('That record no longer exists. Reload the page.');
  });

  it('reaches no API with an untrusted form', async () => {
    act.outcome = 'untrusted';
    expect((await deleteMenuItemAction(IDLE, form({ itemId: A }))).status).toBe('error');
    expect(api.adminDeleteMenuItem).not.toHaveBeenCalled();
  });
});

describe('moveMenuItemAction', () => {
  const ORDER = `${A},${B},${C}`;

  it('sends the whole menu in its new order', async () => {
    const earlier = await moveMenuItemAction(
      IDLE,
      form({ menu: 'header', itemId: B, direction: 'earlier', order: ORDER }),
    );
    expect(earlier).toEqual({ status: 'success', message: 'Order saved.' });
    expect(api.adminReorderMenu).toHaveBeenLastCalledWith('access-token', {
      menu: 'header',
      ids: [B, A, C],
    });

    await moveMenuItemAction(
      IDLE,
      form({ menu: 'footer_help', itemId: B, direction: 'later', order: ORDER }),
    );
    expect(api.adminReorderMenu).toHaveBeenLastCalledWith('access-token', {
      menu: 'footer_help',
      ids: [A, C, B],
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/navigation');
  });

  it('refuses a move past either end, a stale order and a tampered direction, menu or id without calling the API', async () => {
    const stale = 'The menu changed since this page loaded. Reload it and try again.';
    expect(
      await moveMenuItemAction(
        IDLE,
        form({ menu: 'header', itemId: A, direction: 'earlier', order: ORDER }),
      ),
    ).toEqual({ status: 'error', message: stale });
    expect(
      await moveMenuItemAction(
        IDLE,
        form({ menu: 'header', itemId: C, direction: 'later', order: ORDER }),
      ),
    ).toEqual({ status: 'error', message: stale });
    // The id is not in the order the page carried.
    expect(
      await moveMenuItemAction(
        IDLE,
        form({ menu: 'header', itemId: B, direction: 'later', order: `${A},${C}` }),
      ),
    ).toEqual({ status: 'error', message: stale });
    // Ids that are not ids.
    expect(
      await moveMenuItemAction(
        IDLE,
        form({ menu: 'header', itemId: B, direction: 'later', order: `${B},drop-table` }),
      ),
    ).toEqual({ status: 'error', message: stale });

    for (const bad of [
      { menu: 'sidebar', itemId: B, direction: 'later', order: ORDER },
      { menu: 'header', itemId: B, direction: 'sideways', order: ORDER },
      { menu: 'header', itemId: 'nope', direction: 'later', order: ORDER },
    ]) {
      expect(await moveMenuItemAction(IDLE, form(bad))).toEqual({
        status: 'error',
        message: EXPIRED,
      });
    }
    expect(api.adminReorderMenu).not.toHaveBeenCalled();
  });

  it('answers a refused order with a fixed message', async () => {
    api.adminReorderMenu.mockRejectedValue(refusal(400, 'bad_request'));
    const state = await moveMenuItemAction(
      IDLE,
      form({ menu: 'header', itemId: B, direction: 'later', order: ORDER }),
    );
    expect(state.status).toBe('error');
    expect(state.message).toContain('menu changed');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});

describe('saveHomepageAction', () => {
  const FIELDS: Record<string, string> = {
    enabled_hero: 'on',
    enabled_categories: 'on',
    enabled_featured: 'on',
    title_featured: ' Our picks ',
    itemLimit_featured: '8',
    categorySlug_featured: 'eid',
    position_featured: '1',
    position_hero: '2',
    position_categories: '3',
  };

  it('saves every section once, in the typed order, with trimmed headings and the limit as a number', async () => {
    const state = await saveHomepageAction(IDLE, form(FIELDS));
    expect(state.status).toBe('success');
    expect(api.adminSaveHomepage).toHaveBeenCalledTimes(1);
    const sent = api.adminSaveHomepage.mock.calls[0]?.[1] as {
      sections: {
        key: string;
        isEnabled: boolean;
        title: string | null;
        itemLimit: number | null;
        config: object;
      }[];
    };
    expect(sent.sections).toHaveLength(7);
    expect(sent.sections[0]).toMatchObject({
      key: 'featured',
      isEnabled: true,
      title: 'Our picks',
      itemLimit: 8,
      config: { categorySlug: 'eid' },
    });
    // A box left unticked is a hidden section, not a dropped one.
    expect(sent.sections.find((section) => section.key === 'brands')?.isEnabled).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/homepage');
  });

  it('marks a bad limit on its own section and keeps what was typed', async () => {
    const state = await saveHomepageAction(IDLE, form({ ...FIELDS, itemLimit_featured: '99' }));
    expect(state.status).toBe('error');
    if (state.status !== 'error') return;
    expect(state.fieldErrors?.itemLimit_featured).toBe(
      'Use a whole number from 1 to 24, or leave it empty.',
    );
    expect(state.values).toMatchObject({ itemLimit_featured: '99', title_featured: ' Our picks ' });
    expect(api.adminSaveHomepage).not.toHaveBeenCalled();
  });

  it('ignores a filter smuggled onto a section that takes none', async () => {
    await saveHomepageAction(IDLE, form({ ...FIELDS, categorySlug_brands: 'eid' }));
    const sent = api.adminSaveHomepage.mock.calls[0]?.[1] as {
      sections: { key: string; config: object }[];
    };
    expect(sent.sections.find((section) => section.key === 'brands')?.config).toEqual({});
  });

  it('shows a fixed message for a refusal, never the API text, and calls nothing for an untrusted form', async () => {
    api.adminSaveHomepage.mockRejectedValue(refusal(400, 'bad_request'));
    const refused = await saveHomepageAction(IDLE, form(FIELDS));
    expect(refused.status).toBe('error');
    expect(refused.message).toBe(
      'The sections were refused. Check the headings, limits and filters.',
    );
    expect(JSON.stringify(refused)).not.toContain(API_TEXT);

    api.adminSaveHomepage.mockClear();
    act.outcome = 'untrusted';
    expect((await saveHomepageAction(IDLE, form(FIELDS))).status).toBe('error');
    expect(api.adminSaveHomepage).not.toHaveBeenCalled();
  });
});
