import {
  apiErrorBodySchema,
  validationErrorDetailsSchema,
  type ValidationIssue,
} from '@nilzora/contracts';
import { bdMobilePhoneSchema, uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requestInput, validate, type RequestSchemas } from '../middleware/validate';
import { testApp } from './helpers';

/*
 * A test-only module mounted through createApp's module hook, so requests pass
 * through the complete middleware stack (CORS, rate limiting, JSON parsing,
 * error handling). No production route is created by these tests.
 */
const schemas = {
  params: z.object({ id: uuidSchema }),
  query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  body: z.object({ name: z.string().trim().min(1).max(80), phone: bdMobilePhoneSchema }),
} satisfies RequestSchemas;

const listSchemas = {
  body: z.object({ items: z.array(z.object({ quantity: z.number().int().positive() })) }),
} satisfies RequestSchemas;

const testModule = Router()
  .post('/validation-probe/:id', validate(schemas), (_req, res) => {
    res.status(201).json(requestInput<typeof schemas>(res));
  })
  .post('/validation-probe-list', validate(listSchemas), (_req, res) => {
    res.status(201).json(requestInput<typeof listSchemas>(res));
  });

const app = () => testApp({ modules: [testModule] });
const ID = '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60';

function issuesOf(body: unknown): ValidationIssue[] {
  const error = apiErrorBodySchema.parse(body).error;
  expect(error.code).toBe('validation_failed');
  return validationErrorDetailsSchema.parse(error.details).issues;
}

describe('validate()', () => {
  it('passes parsed, normalised input to the handler', async () => {
    const response = await request(app())
      .post(`/api/v1/validation-probe/${ID}?page=3`)
      .send({ name: '  Rahim  ', phone: '017-1234-5678' });

    expect(response.status).toBe(201);
    expect(response.body).toStrictEqual({
      params: { id: ID },
      query: { page: 3 },
      body: { name: 'Rahim', phone: '+8801712345678' },
    });
  });

  it('applies schema defaults', async () => {
    const response = await request(app())
      .post(`/api/v1/validation-probe/${ID}`)
      .send({ name: 'Rahim', phone: '01712345678' });

    expect(response.body).toMatchObject({ query: { page: 1 } });
  });

  it('reports invalid params, query and body together without echoing values', async () => {
    const response = await request(app())
      .post('/api/v1/validation-probe/not-a-uuid?page=0')
      .set('X-Request-Id', 'validation-0001')
      .send({ name: '', phone: '999-PRIVATE-NUMBER' });

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.requestId).toBe('validation-0001');
    const issues = issuesOf(response.body);
    expect(issues.map(({ location, path }) => `${location}:${path}`)).toEqual([
      'params:id',
      'query:page',
      'body:name',
      'body:phone',
    ]);
    expect(response.text).not.toContain('999-PRIVATE-NUMBER');
    expect(response.text).not.toContain('not-a-uuid');
  });

  it('rejects a missing body', async () => {
    const response = await request(app()).post(`/api/v1/validation-probe/${ID}`);

    expect(response.status).toBe(400);
    expect(issuesOf(response.body)).toEqual([
      expect.objectContaining({ location: 'body', path: '' }),
    ]);
  });

  it('does not parse non-JSON bodies', async () => {
    const response = await request(app())
      .post(`/api/v1/validation-probe/${ID}`)
      .set('Content-Type', 'text/plain')
      .send('name=Rahim&phone=01712345678');

    expect(response.status).toBe(400);
    expect(issuesOf(response.body)[0]?.location).toBe('body');
  });

  it('rejects malformed JSON with a dedicated code', async () => {
    const response = await request(app())
      .post(`/api/v1/validation-probe/${ID}`)
      .set('Content-Type', 'application/json')
      .send('{"name": "Rahim",');

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('invalid_json');
    expect(response.text).not.toContain('Unexpected');
  });

  it('rejects bodies over the size limit', async () => {
    const response = await request(app())
      .post(`/api/v1/validation-probe/${ID}`)
      .send({ name: 'x'.repeat(110 * 1024), phone: '01712345678' });

    expect(response.status).toBe(413);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('payload_too_large');
  });

  it('caps the number of reported issues', async () => {
    const items = Array.from({ length: 30 }, () => ({ quantity: -1 }));
    const response = await request(app()).post('/api/v1/validation-probe-list').send({ items });

    expect(response.status).toBe(400);
    expect(issuesOf(response.body)).toHaveLength(20);
  });
});
