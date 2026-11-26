import { adminPopupSchema, popupResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AdminRefusalError } from '../modules/admin/errors';
import type { MemoryObjectStore } from '../modules/media/object-store';
import type { PopupStore } from '../modules/popups/store';
import { toAdminPopup, toPublicPopup } from '../modules/popups/store';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/** Reads one stored object back; the streaming reader is optional on the port, always there here. */
function readObject(objects: MemoryObjectStore, key: string) {
  return objects.get?.(key) ?? Promise.resolve(null);
}

/*
 * The popup routes: one public read, and the management of it behind `settings.manage`.
 *
 * The store is faked, so these prove the HTTP contract — the payload's shape, caching, RBAC,
 * validation, the sequence of storing artwork before recording it, and how a refusal is answered
 * — not that the database rules are correct. Those were checked directly against the migrated
 * schema (see the migration's own notes).
 */

const AT = '2026-12-30T09:00:00.000Z';
const MEDIA = 'https://media.nilzora.test';
const POPUP_ID = '0e000000-0000-4000-8000-000000000001';

/** What the database hands back for one popup (camelCase from jsonb, unvalidated). */
const row = {
  id: POPUP_ID,
  internalName: 'Eid campaign',
  displayMode: 'template',
  imageKey: `popups/${POPUP_ID}/0e000000-0000-4000-8000-000000000002`,
  imageKind: 'still',
  imageWidth: 1200,
  imageHeight: 860,
  imageBytes: 240_000,
  imageFormat: 'webp',
  imageAlt: 'Two cotton sarees in blue and gold',
  title: 'Eid on Nilzora',
  subtitle: null,
  description: null,
  buttonLabel: 'Shop the offer',
  buttonHref: '/categories/fashion',
  delaySeconds: 10,
  frequency: 'once_per_session',
  platform: 'both',
  audience: 'all',
  priority: 0,
  isActive: true,
  startsAt: null,
  endsAt: null,
  updatedAt: AT,
};

const publicPayload = {
  id: POPUP_ID,
  displayMode: 'template',
  imageKey: `popups/${POPUP_ID}/0e000000-0000-4000-8000-000000000002`,
  imageKind: 'still',
  imageWidth: 1200,
  imageHeight: 860,
  imageFormat: 'webp',
  imageAlt: 'Two cotton sarees in blue and gold',
  title: 'Eid on Nilzora',
  subtitle: null,
  description: null,
  buttonLabel: 'Shop the offer',
  buttonHref: '/categories/fashion',
  delaySeconds: 10,
  frequency: 'once_per_session',
  endsAt: null,
};

const body = {
  internalName: 'Eid campaign',
  displayMode: 'template',
  title: 'Eid on Nilzora',
  subtitle: '',
  description: '',
  buttonLabel: 'Shop the offer',
  buttonHref: '/categories/fashion',
  imageAlt: 'Two cotton sarees in blue and gold',
  delaySeconds: 10,
  frequency: 'once_per_session',
  isActive: false,
  startsAt: null,
  endsAt: null,
};

function fakeStore(overrides: Partial<PopupStore> = {}): PopupStore {
  return {
    publicPopups: vi.fn().mockResolvedValue([toPublicPopup(publicPayload, MEDIA)]),
    list: vi.fn().mockResolvedValue([toAdminPopup(row, MEDIA)]),
    get: vi.fn().mockResolvedValue(toAdminPopup(row, MEDIA)),
    save: vi.fn().mockResolvedValue(POPUP_ID),
    setActive: vi.fn().mockResolvedValue(undefined),
    setArtwork: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function setup(store: PopupStore = fakeStore()) {
  const identity = new FakeIdentity();
  const customer = identity.addUser({ email: 'customer@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
  const app = testApp({ auth: identity.deps, popups: store });

  const tokens = {
    customer: identity.tokenFor(customer),
    staff: identity.tokenFor(staff),
    owner: identity.tokenFor(owner),
  };

  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who?: keyof typeof tokens,
    payload?: object,
  ) {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who !== undefined) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return payload === undefined ? pending : pending.send(payload);
  }

  return { store, call, app, tokens };
}

describe('the public popup read', () => {
  it('reads the deadline Postgres sends, which carries a numeric offset', () => {
    // A timestamptz arrives as "2026-11-26T06:09:00+00:00"; the contract wants an ISO instant.
    // Getting this wrong once made the whole endpoint answer 503 and hid every live popup.
    const popup = toPublicPopup({ ...publicPayload, endsAt: '2026-11-26T06:09:00+00:00' }, MEDIA);

    expect(popup?.endsAt).toBe('2026-11-26T06:09:00.000Z');
  });

  it('drops one unreadable popup instead of failing the whole answer', () => {
    expect(toPublicPopup({ ...publicPayload, endsAt: 'not a date' }, MEDIA)).toBeNull();
  });

  it('answers the one popup a customer may see, with a short shared cache', async () => {
    const { store, call } = setup();
    const response = await call('get', '/popups');

    expect(response.status).toBe(200);
    const parsed = popupResponseSchema.parse(response.body);
    expect(parsed.popup?.title).toBe('Eid on Nilzora');
    expect(parsed.popup?.imageUrl).toBe(
      `${MEDIA}/popups/${POPUP_ID}/0e000000-0000-4000-8000-000000000002/full.webp`,
    );
    // The store decides eligibility; the route asks nothing of the caller.
    expect(store.publicPopups).toHaveBeenCalledWith('website');
    expect(parsed.popups).toHaveLength(1);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('answers nothing to show as a null popup, not a 404', async () => {
    const { call } = setup(fakeStore({ publicPopups: vi.fn().mockResolvedValue([]) }));
    const response = await call('get', '/popups');

    expect(response.status).toBe(200);
    expect(popupResponseSchema.parse(response.body).popup).toBeNull();
  });

  it('carries no management field to a customer', async () => {
    const { call } = setup();
    const response = await call('get', '/popups');
    const payload = response.body as { popup: Record<string, unknown> };

    expect(Object.keys(payload.popup)).not.toContain('internalName');
    expect(Object.keys(payload.popup)).not.toContain('isActive');
    expect(Object.keys(payload.popup)).not.toContain('startsAt');
  });

  it('does not leak a popup whose picture cannot be resolved', async () => {
    // No media base configured: the address cannot be built, so there is nothing to show.
    const { call } = setup(
      fakeStore({
        publicPopups: vi
          .fn()
          .mockResolvedValue([toPublicPopup(publicPayload, undefined)].filter(Boolean)),
      }),
    );
    const response = await call('get', '/popups');

    expect(response.status).toBe(200);
    expect(popupResponseSchema.parse(response.body).popup).toBeNull();
  });
});

describe('the public popup read by platform', () => {
  it('asks for the app when the app asks, and refuses an unknown platform', async () => {
    const { store, call } = setup();

    expect((await call('get', '/popups?platform=app')).status).toBe(200);
    expect(store.publicPopups).toHaveBeenLastCalledWith('app');
    expect((await call('get', '/popups?platform=tv')).status).toBe(400);
  });

  it('returns every live popup best first, with the first as the legacy single popup', async () => {
    const second = toPublicPopup(
      { ...publicPayload, id: '0e000000-0000-4000-8000-000000000009' },
      MEDIA,
    );
    const first = toPublicPopup(publicPayload, MEDIA);
    const { call } = setup(fakeStore({ publicPopups: vi.fn().mockResolvedValue([first, second]) }));
    const parsed = popupResponseSchema.parse((await call('get', '/popups')).body);

    expect(parsed.popups).toHaveLength(2);
    expect(parsed.popup?.id).toBe(POPUP_ID);
  });
});

describe('the popup management routes', () => {
  it('refuses a customer and a staff account, and allows the owner', async () => {
    const { call } = setup();

    expect((await call('get', '/admin/popups', 'customer')).status).toBe(403);
    // Staff do not hold settings.manage.
    expect((await call('get', '/admin/popups', 'staff')).status).toBe(403);
    expect((await call('get', '/admin/popups', 'owner')).status).toBe(200);
  });

  it('lists the saved popups', async () => {
    const { call } = setup();
    const response = await call('get', '/admin/popups', 'owner');

    expect(response.status).toBe(200);
    expect((response.body as { popups: unknown[] }).popups).toHaveLength(1);
  });

  it('creates a popup and answers it', async () => {
    const { store, call } = setup();
    const response = await call('post', '/admin/popups', 'owner', body);

    expect(response.status).toBe(201);
    adminPopupSchema.parse((response.body as { popup: unknown }).popup);
    expect(store.save).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      null,
      expect.objectContaining({ internalName: 'Eid campaign', displayMode: 'template' }),
    );
  });

  it('refuses a body that would be a dead button, before the store is reached', async () => {
    const { store, call } = setup();
    const response = await call('post', '/admin/popups', 'owner', { ...body, buttonHref: null });

    expect(response.status).toBe(400);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('refuses an off-site destination', async () => {
    const { call } = setup();
    const response = await call('post', '/admin/popups', 'owner', {
      ...body,
      buttonHref: 'https://example.test/x',
    });

    expect(response.status).toBe(400);
  });

  it('answers a second live popup as a conflict', async () => {
    const { call } = setup(
      fakeStore({
        setActive: vi.fn().mockRejectedValue(new AdminRefusalError('popup_conflict')),
      }),
    );
    const response = await call('post', `/admin/popups/${POPUP_ID}/active`, 'owner', {
      active: true,
    });

    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('popup_conflict');
  });

  it('answers a missing popup as 404', async () => {
    const { call } = setup(fakeStore({ get: vi.fn().mockResolvedValue(null) }));
    const response = await call('get', `/admin/popups/${POPUP_ID}`, 'owner');

    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).toBe('popup_not_found');
  });

  it('clears the artwork through the same function, and answers the popup', async () => {
    const { store, call } = setup();
    const response = await call('delete', `/admin/popups/${POPUP_ID}/image`, 'owner');

    expect(response.status).toBe(200);
    expect(store.setArtwork).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      POPUP_ID,
      null,
    );
  });

  it('deletes a popup', async () => {
    const { store, call } = setup();
    const response = await call('delete', `/admin/popups/${POPUP_ID}`, 'owner');

    expect(response.status).toBe(204);
    expect(store.remove).toHaveBeenCalledWith(expect.any(String), expect.any(String), POPUP_ID);
  });
});

describe('popup artwork uploads', () => {
  /** A popup store double plus in-memory object storage, so the real upload path runs. */
  async function withStorage(overrides: Partial<PopupStore> = {}) {
    const { createMemoryObjectStore } = await import('../modules/media/object-store');
    const objects = createMemoryObjectStore();
    const store = fakeStore(overrides);
    const identity = new FakeIdentity();
    const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
    const app = testApp({
      auth: identity.deps,
      popups: store,
      media: {
        // The popup routes only need the storage handle; the product routes are not exercised.
        images: {} as never,
        storage: { objects, publicBaseUrl: MEDIA },
      },
    });
    const token = identity.tokenFor(owner);
    return { store, objects, app, token };
  }

  /** A real picture, made by the same encoder the pipeline uses. */
  async function picture(format: 'png' | 'gif', frames = 1): Promise<Buffer> {
    const { default: sharp } = await import('sharp');
    const base = sharp({
      create: {
        width: 400,
        height: 320,
        channels: 4,
        background: { r: 2, g: 132, b: 199, alpha: 1 },
      },
    });
    if (format === 'png') return base.png().toBuffer();
    // A GIF needs a palette; two frames make it animated, which is the case that matters.
    const pages: Buffer[] = [];
    for (let index = 0; index < frames; index += 1) {
      pages.push(
        await sharp({
          create: {
            width: 400,
            height: 320,
            channels: 4,
            background: { r: index === 0 ? 2 : 139, g: index === 0 ? 132 : 92, b: 199, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
      );
    }
    return sharp(pages, { join: { animated: true } })
      .gif()
      .toBuffer();
  }

  it('answers 503 when media storage is not configured', async () => {
    const { call } = setup();
    const response = await call('post', `/admin/popups/${POPUP_ID}/image`, 'owner', undefined).set(
      'Content-Type',
      'image/webp',
    );

    expect(response.status).toBe(503);
  });

  it('stores a still through the picture pipeline and records its facts', async () => {
    const { store, objects, app, token } = await withStorage();
    const bytes = await picture('png');
    const response = await request(app)
      .post(`/api/v1/admin/popups/${POPUP_ID}/image`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .send(bytes);

    expect(response.status).toBe(200);
    const recorded = vi.mocked(store.setArtwork).mock.calls[0]?.[3];
    expect(recorded).toMatchObject({
      kind: 'still',
      format: 'webp',
      width: 400,
      height: 320,
    });
    expect(recorded?.key).toMatch(new RegExp(`^popups/${POPUP_ID}/`));
    // Both variants are written, and neither carries the uploaded metadata.
    expect(await readObject(objects, `${String(recorded?.key)}/full.webp`)).not.toBeNull();
    expect(await readObject(objects, `${String(recorded?.key)}/thumb.webp`)).not.toBeNull();
  });

  it('keeps an animated GIF exactly as uploaded, so it still animates', async () => {
    const { store, objects, app, token } = await withStorage();
    const bytes = await picture('gif', 2);
    const response = await request(app)
      .post(`/api/v1/admin/popups/${POPUP_ID}/image`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/gif')
      .send(bytes);

    expect(response.status).toBe(200);
    const recorded = vi.mocked(store.setArtwork).mock.calls[0]?.[3];
    expect(recorded).toMatchObject({ kind: 'animated', format: 'gif' });
    expect(recorded?.key).toMatch(/\.gif$/);
    const stored = await readObject(objects, String(recorded?.key));
    expect(stored).not.toBeNull();
    // Byte for byte: re-encoding is what would freeze it.
    const received: Buffer[] = [];
    for await (const chunk of stored?.body ?? []) received.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(received).equals(bytes)).toBe(true);
  });

  it('deletes the artwork it replaced once the new one is recorded', async () => {
    const { createMemoryObjectStore } = await import('../modules/media/object-store');
    const objects = createMemoryObjectStore();
    const previous = `popups/${POPUP_ID}/0e000000-0000-4000-8000-000000000009`;
    await objects.put({
      key: `${previous}/full.webp`,
      body: Buffer.from('old'),
      contentType: 'image/webp',
      cacheControl: 'public',
    });
    const store = fakeStore({ setArtwork: vi.fn().mockResolvedValue(previous) });
    const identity = new FakeIdentity();
    const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
    const app = testApp({
      auth: identity.deps,
      popups: store,
      media: { images: {} as never, storage: { objects, publicBaseUrl: MEDIA } },
    });
    const response = await request(app)
      .post(`/api/v1/admin/popups/${POPUP_ID}/image`)
      .set('Authorization', `Bearer ${identity.tokenFor(owner)}`)
      .set('Content-Type', 'image/png')
      .send(await picture('png'));

    expect(response.status).toBe(200);
    expect(await readObject(objects, `${previous}/full.webp`)).toBeNull();
  });

  it('removes what it stored when the record cannot be saved', async () => {
    const objects = (await import('../modules/media/object-store')).createMemoryObjectStore();
    const store = fakeStore({
      setArtwork: vi.fn().mockRejectedValue(new AdminRefusalError('popup_invalid')),
    });
    const identity = new FakeIdentity();
    const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
    const app = testApp({
      auth: identity.deps,
      popups: store,
      media: { images: {} as never, storage: { objects, publicBaseUrl: MEDIA } },
    });
    const response = await request(app)
      .post(`/api/v1/admin/popups/${POPUP_ID}/image`)
      .set('Authorization', `Bearer ${identity.tokenFor(owner)}`)
      .set('Content-Type', 'image/png')
      .send(await picture('png'));

    expect(response.status).toBe(400);
    const recorded = vi.mocked(store.setArtwork).mock.calls[0]?.[3];
    // Nothing was left behind: the orphaned variants were deleted.
    expect(await readObject(objects, `${String(recorded?.key)}/full.webp`)).toBeNull();
  });

  it('refuses a file whose bytes are not the picture it claims to be', async () => {
    const { store, app, token } = await withStorage();
    const response = await request(app)
      .post(`/api/v1/admin/popups/${POPUP_ID}/image`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('this is not a picture'));

    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('image_invalid');
    expect(store.setArtwork).not.toHaveBeenCalled();
  });
});
