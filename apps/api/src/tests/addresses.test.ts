import {
  addressListResponseSchema,
  addressResponseSchema,
  MAX_ADDRESSES,
} from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { commerceSetup, DHAKA_ADDRESS, errorOf, KHULNA_ADDRESS } from './commerce-helpers';

type Setup = ReturnType<typeof commerceSetup>;

function as(setup: Setup, who: 'customer' | 'other') {
  const auth = `Bearer ${setup.tokens[who]}`;
  return {
    list: () => request(setup.app).get('/api/v1/me/addresses').set('Authorization', auth),
    create: (body: object) =>
      request(setup.app).post('/api/v1/me/addresses').set('Authorization', auth).send(body),
    update: (id: string, body: object) =>
      request(setup.app).put(`/api/v1/me/addresses/${id}`).set('Authorization', auth).send(body),
    remove: (id: string) =>
      request(setup.app).delete(`/api/v1/me/addresses/${id}`).set('Authorization', auth),
  };
}

describe('customer addresses', () => {
  it('creates a normalised address with its delivery zone; the first becomes the default', async () => {
    const setup = commerceSetup();
    const response = await as(setup, 'customer').create({
      ...DHAKA_ADDRESS,
      label: '  ',
      postalCode: '',
    });

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(addressResponseSchema.parse(response.body).address).toMatchObject({
      label: null,
      recipientName: 'Rahima Khatun',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      postalCode: null,
      landmark: null,
      isDefault: true,
      deliveryZone: 'inside_dhaka',
    });
  });

  it('keeps exactly one default, newest first after it', async () => {
    const setup = commerceSetup();
    const customer = as(setup, 'customer');
    const first = addressResponseSchema.parse((await customer.create(DHAKA_ADDRESS)).body).address;
    const second = addressResponseSchema.parse(
      (await customer.create({ ...KHULNA_ADDRESS, isDefault: true })).body,
    ).address;
    const third = addressResponseSchema.parse(
      (await customer.create({ ...DHAKA_ADDRESS, area: 'Mirpur', isDefault: false })).body,
    ).address;

    const listed = addressListResponseSchema.parse((await customer.list()).body).addresses;
    expect(listed.map((address) => [address.id, address.isDefault])).toEqual([
      [second.id, true],
      [third.id, false],
      [first.id, false],
    ]);
    expect(second.deliveryZone).toBe('outside_dhaka');
  });

  it('replaces every field on update and can move the default', async () => {
    const setup = commerceSetup();
    const customer = as(setup, 'customer');
    const first = addressResponseSchema.parse((await customer.create(KHULNA_ADDRESS)).body).address;
    const second = addressResponseSchema.parse((await customer.create(DHAKA_ADDRESS)).body).address;

    const response = await customer.update(first.id, { ...DHAKA_ADDRESS, area: 'Gulshan' });
    expect(response.status).toBe(200);
    expect(addressResponseSchema.parse(response.body).address).toMatchObject({
      id: first.id,
      area: 'Gulshan',
      label: null,
      postalCode: null,
      landmark: null,
      deliveryZone: 'inside_dhaka',
      isDefault: true,
    });

    await customer.update(second.id, { ...DHAKA_ADDRESS, isDefault: true });
    const listed = addressListResponseSchema.parse((await customer.list()).body).addresses;
    expect(listed.find((address) => address.isDefault)?.id).toBe(second.id);
    expect(listed.filter((address) => address.isDefault)).toHaveLength(1);
  });

  it('deletes an address and promotes another to default', async () => {
    const setup = commerceSetup();
    const customer = as(setup, 'customer');
    const first = addressResponseSchema.parse((await customer.create(DHAKA_ADDRESS)).body).address;
    await customer.create(KHULNA_ADDRESS);

    const response = await customer.remove(first.id);
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');

    const listed = addressListResponseSchema.parse((await customer.list()).body).addresses;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.isDefault).toBe(true);
    expect((await customer.remove(first.id)).status).toBe(404);
  });

  it("treats another customer's address exactly like a missing one", async () => {
    const setup = commerceSetup();
    const theirs = addressResponseSchema.parse(
      (await as(setup, 'other').create(KHULNA_ADDRESS)).body,
    ).address;
    const customer = as(setup, 'customer');
    const missing = '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60';

    const updated = await customer.update(theirs.id, { ...DHAKA_ADDRESS, area: 'Hijacked' });
    const updatedMissing = await customer.update(missing, DHAKA_ADDRESS);
    const removed = await customer.remove(theirs.id);
    const removedMissing = await customer.remove(missing);

    expect([updated.status, updatedMissing.status, removed.status, removedMissing.status]).toEqual([
      404, 404, 404, 404,
    ]);
    // Identical answers apart from the request id, so ids cannot be probed.
    const { requestId: _theirs, ...theirsError } = errorOf(updated.body);
    const { requestId: _missing, ...missingError } = errorOf(updatedMissing.body);
    expect(theirsError).toStrictEqual(missingError);
    expect(addressListResponseSchema.parse((await customer.list()).body).addresses).toEqual([]);
    expect(setup.commerce.addresses).toHaveLength(1);
    expect(setup.commerce.addresses[0]?.area).toBe('Sonadanga');
  });

  it(`refuses more than ${MAX_ADDRESSES} addresses`, async () => {
    const setup = commerceSetup();
    const customer = as(setup, 'customer');
    for (let index = 0; index < MAX_ADDRESSES; index += 1) {
      expect((await customer.create({ ...DHAKA_ADDRESS, area: `Area ${index}` })).status).toBe(201);
    }

    const response = await customer.create(DHAKA_ADDRESS);
    expect(response.status).toBe(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'address_limit_reached',
      message: `You can keep up to ${MAX_ADDRESSES} addresses. Remove one to add another.`,
    });
  });

  it.each([
    ['a district outside the division', { ...DHAKA_ADDRESS, division: 'Sylhet' }],
    ['an unknown division', { ...DHAKA_ADDRESS, division: 'Atlantis' }],
    ['an invalid phone', { ...DHAKA_ADDRESS, phone: '12345' }],
    ['an owner id', { ...DHAKA_ADDRESS, userId: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60' }],
    ['a delivery zone', { ...DHAKA_ADDRESS, deliveryZone: 'inside_dhaka' }],
    ['a short address line', { ...DHAKA_ADDRESS, addressLine: 'H1' }],
  ])('rejects %s', async (_label, body) => {
    const setup = commerceSetup();
    const response = await as(setup, 'customer').create(body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.commerce.addresses).toEqual([]);
  });

  it('rejects address ids that are not uuids', async () => {
    const setup = commerceSetup();
    const customer = as(setup, 'customer');

    expect((await customer.update('1%20or%201=1', DHAKA_ADDRESS)).status).toBe(400);
    expect((await customer.remove('not-a-uuid')).status).toBe(400);
  });

  it('answers 503 without internal details when the database is unavailable', async () => {
    const setup = commerceSetup();
    setup.commerce.unavailable = true;
    const response = await as(setup, 'customer').list();

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('service_unavailable');
    expect(response.text).not.toMatch(/fetch failed|secret_table/);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
