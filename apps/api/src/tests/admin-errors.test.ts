import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../middleware/error-handler';
import { AdminRefusalError, sendAdminFailure, toAdminStoreError } from '../modules/admin/errors';
import { StoreUnavailableError } from '../modules/commerce/errors';
import { DB_MESSAGE } from './admin-fakes';
import { errorOf } from './admin-helpers';
import { captureLogs } from './helpers';

/** A route that fails the way an admin store call would, answered by the admin mapping. */
function failingApp(code: string, details: string | null = null, handled = true) {
  const app = express();
  app.get('/fail', (_req, res) => {
    const error = toAdminStoreError({ code, message: DB_MESSAGE, details }, 'admin_test');
    if (!handled) throw error;
    sendAdminFailure(res, error);
  });
  app.use(createErrorHandler(captureLogs().logger));
  return app;
}

describe('admin SQLSTATE mapping', () => {
  it.each([
    ['NZ403', 403, 'forbidden'],
    ['NZ404', 404, 'not_found'],
    ['NZ412', 400, 'bad_request'],
    ['NZ430', 409, 'product_content_locked'],
    ['NZ431', 409, 'product_under_review'],
    ['NZ432', 409, 'product_not_approved'],
    ['NZ433', 409, 'stock_below_zero'],
    ['NZ434', 409, 'invalid_status_transition'],
    ['NZ435', 409, 'payment_not_collectable'],
    ['NZ436', 409, 'review_closed'],
    ['NZ437', 409, 'own_submission'],
    ['NZ438', 403, 'cannot_change_self'],
    ['NZ439', 403, 'account_not_manageable'],
    ['23514', 400, 'bad_request'],
  ])('answers %s with %i %s and no database text', async (code, status, apiCode) => {
    const response = await request(failingApp(code)).get('/fail');

    expect(response.status).toBe(status);
    expect(errorOf(response.body).code).toBe(apiCode);
    expect(JSON.stringify(response.body)).not.toContain(DB_MESSAGE);
  });

  it.each([
    ['a SKU', 'Key (sku)=(DESK-LAMP) already exists.', 'sku_taken'],
    ['an address', 'Key (slug)=(desk-lamp) already exists.', 'slug_taken'],
  ])('answers a unique conflict on %s (23505) with 409', async (_label, details, apiCode) => {
    const response = await request(failingApp('23505', details)).get('/fail');

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe(apiCode);
    expect(JSON.stringify(response.body)).not.toContain('Key (');
  });

  it.each([
    ['an unknown SQLSTATE', 'XX000', null],
    ['an insufficient privilege', '42501', null],
    ['a unique conflict on another key', '23505', 'Key (product_id)=(x) already exists.'],
    ['a network failure', '', null],
  ])('treats %s as the store being unavailable (503)', async (_label, code, details) => {
    const error = toAdminStoreError({ code, message: DB_MESSAGE, details }, 'admin_test');
    const response = await request(failingApp(code, details, false)).get('/fail');

    expect(error).toBeInstanceOf(StoreUnavailableError);
    expect(error.message).not.toContain(DB_MESSAGE);
    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('service_unavailable');
    expect(JSON.stringify(response.body)).not.toContain(DB_MESSAGE);
  });

  it('answers a refusal that reaches the global handler with its standard answer', async () => {
    const response = await request(failingApp('NZ433', null, false)).get('/fail');

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('stock_below_zero');
  });

  it('rethrows anything that is not a refusal', () => {
    const failure = new Error('boom');
    expect(() => sendAdminFailure({} as never, failure)).toThrow(failure);
    expect(new AdminRefusalError('not_found').refusal).toBe('not_found');
  });
});
