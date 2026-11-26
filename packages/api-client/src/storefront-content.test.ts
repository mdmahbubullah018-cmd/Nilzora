import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

const TOKEN = 'owner-access-token';
const ITEM = '0f000000-0000-4000-8000-000000000001';
const BANNER = '0b000000-0000-4000-8000-000000000001';
const AT = '2026-11-08T08:00:00.000Z';

function setup(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response()));
  const client = createApiClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
    };
  };
  return { client, sent, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const page = {
  slug: 'about',
  title: 'About us',
  body: 'We sell lamps.',
  seoTitle: null,
  seoDescription: null,
  updatedAt: AT,
};
const item = {
  id: ITEM,
  menu: 'header',
  label: 'Eid sale',
  href: '/products',
  sortOrder: 0,
  isActive: true,
  updatedAt: AT,
};
const section = {
  key: 'hero',
  title: null,
  itemLimit: null,
  config: {},
  isEnabled: true,
  sortOrder: 0,
  updatedAt: AT,
};

describe('public storefront content', () => {
  it('reads a published page, the navigation and the homepage without a token', async () => {
    const read = setup(() => json({ page }));
    await expect(read.client.publicSitePage('about')).resolves.toStrictEqual({ page });
    expect(read.sent().url).toBe('http://localhost:4000/api/v1/store/pages/about');
    expect(read.sent().headers.get('Authorization')).toBeNull();

    const navigation = {
      menus: { header: [{ label: 'Sale', href: '/products' }], footerShop: [], footerHelp: [] },
      pages: [{ slug: 'about', title: 'About us' }],
    };
    const nav = setup(() => json({ navigation }));
    await expect(nav.client.publicNavigation()).resolves.toStrictEqual({ navigation });
    expect(nav.sent().url).toBe('http://localhost:4000/api/v1/store/navigation');

    const homepage = { sections: [{ key: 'hero', title: null, itemLimit: null, config: {} }] };
    const home = setup(() => json({ homepage }));
    await expect(home.client.publicHomepage()).resolves.toStrictEqual({ homepage });
    expect(home.sent().url).toBe('http://localhost:4000/api/v1/store/homepage');
  });

  it('raises not_found for an unpublished page and refuses an answer outside the contract', async () => {
    const missing = setup(() =>
      json({ error: { code: 'not_found', message: 'Page not found' } }, 404),
    );
    await expect(missing.client.publicSitePage('terms')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });

    const odd = setup(() => json({ navigation: { menus: { header: 'x' } } }));
    await expect(odd.client.publicNavigation()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('managing storefront content', () => {
  it('lists and saves pages', async () => {
    const list = setup(() => json({ pages: [{ ...page, isPublished: true }] }));
    await list.client.adminListSitePages(TOKEN);
    expect(list.sent()).toMatchObject({ url: 'http://localhost:4000/api/v1/admin/site-pages' });
    expect(list.sent().headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);

    const save = setup(() => json({ page: { ...page, isPublished: true } }));
    await save.client.adminSaveSitePage(TOKEN, 'about', {
      title: 'About us',
      body: 'We sell lamps.',
      isPublished: true,
    });
    expect(save.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/admin/site-pages/about',
      method: 'PUT',
      body: { title: 'About us', body: 'We sell lamps.', isPublished: true },
    });
  });

  it('creates, changes, orders and deletes navigation links', async () => {
    const link = { menu: 'header' as const, label: 'Eid sale', href: '/products', isActive: true };
    const create = setup(() => json({ item }, 201));
    await expect(create.client.adminCreateMenuItem(TOKEN, link)).resolves.toStrictEqual({ item });
    expect(create.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/admin/navigation',
      method: 'POST',
    });

    const update = setup(() => json({ item }));
    await update.client.adminUpdateMenuItem(TOKEN, ITEM, link);
    expect(update.sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/navigation/${ITEM}`,
      method: 'PUT',
    });

    const order = setup(() => json({ items: [item] }));
    await order.client.adminReorderMenu(TOKEN, { menu: 'header', ids: [ITEM] });
    expect(order.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/admin/navigation/order',
      method: 'PUT',
      body: { menu: 'header', ids: [ITEM] },
    });

    const listed = setup(() => json({ items: [item] }));
    await listed.client.adminListMenuItems(TOKEN);
    expect(listed.sent().url).toBe('http://localhost:4000/api/v1/admin/navigation');

    const removed = setup(() => new Response(null, { status: 204 }));
    await expect(removed.client.adminDeleteMenuItem(TOKEN, ITEM)).resolves.toBeUndefined();
    expect(removed.sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/navigation/${ITEM}`,
      method: 'DELETE',
    });
  });

  it('reads and saves the homepage sections', async () => {
    const get = setup(() => json({ sections: [section] }));
    await expect(get.client.adminGetHomepage(TOKEN)).resolves.toStrictEqual({
      sections: [section],
    });

    const save = setup(() => json({ sections: [section] }));
    await save.client.adminSaveHomepage(TOKEN, { sections: [{ key: 'hero', isEnabled: true }] });
    expect(save.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/admin/homepage',
      method: 'PUT',
      body: { sections: [{ key: 'hero', isEnabled: true }] },
    });
  });

  it('raises the API code for a refused link and refuses unsafe ids without sending', async () => {
    const refused = setup(() =>
      json({ error: { code: 'bad_request', message: 'Check the menu' } }, 400),
    );
    await expect(
      refused.client.adminCreateMenuItem(TOKEN, {
        menu: 'header',
        label: 'x',
        href: '/x',
        isActive: true,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'bad_request' });

    const { client, fetchMock } = setup(() => json({}));
    await expect(client.adminDeleteMenuItem(TOKEN, '..')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('banners', () => {
  const banner = {
    id: BANNER,
    placement: 'home_hero',
    title: 'Eid',
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: null,
    mobileImage: {
      url: 'https://media.example.com/banners/b/m/full.webp',
      thumbUrl: 'https://media.example.com/banners/b/m/thumb.webp',
    },
    categorySlug: null,
    categoryId: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
  };

  it('uploads and removes the small-screen picture with the mobile variant', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const upload = setup(() => json({ banner }));
    await upload.client.adminUploadBannerMobileImage(TOKEN, BANNER, {
      bytes,
      contentType: 'image/jpeg',
    });
    expect(upload.sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/banners/${BANNER}/image?variant=mobile`,
      method: 'POST',
      body: bytes,
    });
    expect(upload.sent().headers.get('Content-Type')).toBe('image/jpeg');

    const remove = setup(() => json({ banner }));
    await remove.client.adminRemoveBannerMobileImage(TOKEN, BANNER);
    expect(remove.sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/banners/${BANNER}/image?variant=mobile`,
      method: 'DELETE',
    });
  });

  it('orders the banners of a placement', async () => {
    const { client, sent } = setup(() => json({ banners: [banner] }));

    await expect(
      client.adminReorderBanners(TOKEN, {
        placement: 'home_hero',
        categoryId: null,
        ids: [BANNER],
      }),
    ).resolves.toStrictEqual({ banners: [banner] });
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/admin/banners/order',
      method: 'PUT',
      body: { placement: 'home_hero', categoryId: null, ids: [BANNER] },
    });
  });
});
