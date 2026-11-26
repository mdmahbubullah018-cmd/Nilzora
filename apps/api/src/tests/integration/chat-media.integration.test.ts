import { randomUUID } from 'node:crypto';
import {
  apiErrorBodySchema,
  authSessionSchema,
  chatAttachmentUploadSchema,
  chatConversationResponseSchema,
  chatMessagePageSchema,
  chatMyFeedbackResponseSchema,
  chatReactionResponseSchema,
  chatReactionSummaryResponseSchema,
  postedChatMessageSchema,
} from '@nilzora/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../app';
import { createDatabasePool } from '../../db/pool';
import { createLogger } from '../../logging/logger';
import { createSupabaseAdminAccountStore } from '../../modules/admin/accounts-store';
import { createSupabaseAdminCatalogStore } from '../../modules/admin/catalog-store';
import { createSupabaseAdminCouponStore } from '../../modules/admin/coupons-store';
import { createSupabaseAdminDiscountStore } from '../../modules/admin/discounts-store';
import { createSupabaseModerationStore } from '../../modules/admin/moderation-store';
import { createSupabaseAdminOrderStore } from '../../modules/admin/orders-store';
import { createSupabaseAdminReportStore } from '../../modules/admin/reports-store';
import { createSupabaseAddressStore } from '../../modules/addresses/store';
import { createSupabaseAuthGateway } from '../../modules/auth/gateway';
import { createSupabaseCartStore } from '../../modules/cart/store';
import { createSupabaseCatalogStore } from '../../modules/catalog/store';
import { createPostgresChatAdminStore } from '../../modules/chat/admin-store';
import { createPostgresChatStore } from '../../modules/chat/store';
import { createMemoryObjectStore } from '../../modules/media/object-store';
import { createSupabaseProductImageStore } from '../../modules/media/store';
import { createSupabaseOrderStore } from '../../modules/orders/store';
import { createSupabaseReviewStore } from '../../modules/reviews/store';
import { createSupabaseAccountStore } from '../../modules/users/accounts';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';
import { makeImage } from '../media-fakes';

/*
 * Chat attachments, replies, reactions and retries, end to end on the local stack
 * -----------------------------------------------------------------------------
 * The real Express app, the real Postgres chat stores (a direct connection that carries each
 * caller's identity, exactly as the API runs against a local database) and the real database
 * functions. Only object storage is a substitute: `createMemoryObjectStore()` stands in for
 * Cloudflare R2, so these tests prove the API, the SQL and the byte round trip, and say nothing
 * about R2 itself, its credentials or its CDN, which are never contacted here.
 *
 * Every row the test creates belongs to accounts it creates; cleanup removes exactly those.
 */

const local = inject('supabase');
const BASE_URL = 'https://media.example.com';
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
  ADMIN_RATE_LIMIT_MAX: '10000',
  CHAT_RATE_LIMIT_MAX: '10000',
  CHAT_UPLOAD_RATE_LIMIT_MAX: '10000',
  CHAT_UPLOAD_IMAGE_LIMIT_MAX: '10000',
  CHAT_UPLOAD_DOCUMENT_LIMIT_MAX: '10000',
  CHAT_UPLOAD_AUDIO_LIMIT_MAX: '10000',
});
const clients = createSupabaseClients(config.supabase);
const pool = createDatabasePool({ connectionString: local.dbUrl, max: 6 });
const objects = createMemoryObjectStore();
const app = createApp({
  config,
  logger: createLogger(config),
  auth: {
    gateway: createSupabaseAuthGateway(clients),
    accounts: createSupabaseAccountStore(clients),
  },
  commerce: {
    catalog: createSupabaseCatalogStore(clients, { mediaBaseUrl: BASE_URL }),
    cart: createSupabaseCartStore(clients),
    addresses: createSupabaseAddressStore(clients),
    orders: createSupabaseOrderStore(clients),
  },
  admin: {
    catalog: createSupabaseAdminCatalogStore(clients, { mediaBaseUrl: BASE_URL }),
    orders: createSupabaseAdminOrderStore(clients),
    accounts: createSupabaseAdminAccountStore(clients),
    moderation: createSupabaseModerationStore(clients),
    reports: createSupabaseAdminReportStore(clients),
    coupons: createSupabaseAdminCouponStore(clients),
    discounts: createSupabaseAdminDiscountStore(clients),
    reviews: createSupabaseReviewStore(clients),
  },
  media: {
    images: createSupabaseProductImageStore(clients),
    storage: { objects, publicBaseUrl: BASE_URL },
  },
  chat: {
    store: createPostgresChatStore(pool),
    admin: createPostgresChatAdminStore(pool),
  },
});

const run = randomUUID().slice(0, 8);
const PASSWORD = 'shopping2026';
type Who = 'customer' | 'other';
const accounts = {} as Record<Who, { id: string; token: string }>;

function errorOf(body: unknown) {
  return apiErrorBodySchema.parse(body).error;
}

function api(method: 'get' | 'post', path: string, who: Who) {
  return request(app)
    [method](`/api/v1${path}`)
    .set('Authorization', `Bearer ${accounts[who].token}`);
}

async function createAccount(who: Who) {
  const email = `it-chatmedia-${run}-${who}@example.com`;
  const { data, error } = await clients.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const login = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  accounts[who] = { id: data.user.id, token: authSessionSchema.parse(login.body).accessToken };
}

async function startConversation(who: Who, subject: string) {
  const response = await api('post', '/chat/conversations', who).send({
    kind: 'customer_support',
    subject,
    body: 'Hello, I need help',
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return chatConversationResponseSchema.parse(response.body).conversation.id;
}

async function upload(who: Who, conversationId: string, name: string, type: string, body: Buffer) {
  return api('post', `/chat/conversations/${conversationId}/attachments?fileName=${name}`, who)
    .set('Content-Type', type)
    .send(body);
}

async function uploaded(
  who: Who,
  conversationId: string,
  name: string,
  type: string,
  body: Buffer,
) {
  const response = await upload(who, conversationId, name, type, body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return chatAttachmentUploadSchema.parse(response.body);
}

function post(who: Who, body: object) {
  return api('post', '/chat/messages', who).send(body);
}

function media(who: Who, attachmentId: string) {
  return api('get', `/chat/attachments/${attachmentId}/media`, who).responseType('blob');
}

beforeAll(async () => {
  await createAccount('customer');
  await createAccount('other');
});

afterAll(async () => {
  const ids = Object.values(accounts).map((entry) => entry.id);
  if (ids.length > 0) {
    // Only this run's accounts' conversations (messages, attachments, reactions cascade).
    await pool.query('delete from public.chat_conversations where customer_id = any($1::uuid[])', [
      ids,
    ]);
    await pool.query('delete from public.audit_log where actor_id = any($1::uuid[])', [ids]);
  }
  for (const id of ids) await clients.admin.auth.admin.deleteUser(id);
  await pool.end();
});

describe('a picture message, from upload to download', () => {
  it('stores the file, creates the message, serves the bytes, and survives a retry', async () => {
    const conversationId = await startConversation('customer', `Picture ${run}`);
    // A small screenshot-sized picture: the product-photo minimum of 400 px must not apply.
    const original = await makeImage('png', 120, 90);
    const file = await uploaded('customer', conversationId, 'shot.png', 'image/png', original);
    expect(file.contentType).toBe('image/webp');
    expect([file.width, file.height]).toEqual([120, 90]);

    const clientMessageId = randomUUID();
    const sent = await post('customer', {
      conversationId,
      clientMessageId,
      body: 'Here is the photo',
      attachmentIds: [file.id],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const posted = postedChatMessageSchema.parse(sent.body);
    expect(posted.duplicate).toBe(false);
    expect(posted.attachments.map((attachment) => attachment.id)).toEqual([file.id]);

    // The message exists and carries the file when the thread is read back.
    const listed = await api('get', `/chat/conversations/${conversationId}/messages`, 'customer');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const page = chatMessagePageSchema.parse(listed.body);
    const stored = page.messages.find((message) => message.id === posted.message.id);
    expect(stored?.body).toBe('Here is the photo');
    expect(stored?.attachments.map((attachment) => attachment.id)).toEqual([file.id]);

    // The bytes come back through the authorized media route, byte for byte from storage.
    const fullKey = [...objects.objects.keys()].find(
      (key) => key.startsWith(`chat/${conversationId}/`) && key.endsWith('/full.webp'),
    );
    expect(fullKey).toBeDefined();
    const downloaded = await media('customer', file.id);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toContain('image/webp');
    expect(downloaded.headers['cache-control']).toContain('private');
    expect(Buffer.isBuffer(downloaded.body)).toBe(true);
    expect(
      (downloaded.body as Buffer).equals(
        objects.objects.get(fullKey ?? '')?.body ?? Buffer.alloc(0),
      ),
    ).toBe(true);

    // Retrying the same send (the response was lost): the stored message, not a duplicate and
    // not a "no pending attachment" refusal.
    const retried = await post('customer', {
      conversationId,
      clientMessageId,
      body: 'Here is the photo',
      attachmentIds: [file.id],
    });
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    const again = postedChatMessageSchema.parse(retried.body);
    expect(again.duplicate).toBe(true);
    expect(again.message.id).toBe(posted.message.id);
    expect(again.attachments.map((attachment) => attachment.id)).toEqual([file.id]);

    const afterRetry = chatMessagePageSchema.parse(
      (await api('get', `/chat/conversations/${conversationId}/messages`, 'customer')).body,
    );
    expect(
      afterRetry.messages.filter((message) => message.body === 'Here is the photo'),
    ).toHaveLength(1);

    // Reactions: add, change, remove, on the nested route the clients use.
    const react = (emoji: string) =>
      api(
        'post',
        `/chat/conversations/${conversationId}/messages/${posted.message.id}/reactions`,
        'customer',
      ).send({ emoji });
    const added = chatReactionResponseSchema.parse((await react('thumbs_up')).body);
    expect(added).toMatchObject({ added: true, emoji: 'thumbs_up' });
    const changed = chatReactionResponseSchema.parse((await react('heart')).body);
    expect(changed).toMatchObject({ added: true, emoji: 'heart' });
    expect(changed.summary).toEqual([{ emoji: 'heart', count: 1 }]);
    const summary = await api('get', `/chat/conversations/${conversationId}/reactions`, 'customer');
    expect(chatReactionSummaryResponseSchema.parse(summary.body).reactions).toEqual([
      { messageId: posted.message.id, emoji: 'heart', count: 1, mine: true },
    ]);
    const removed = chatReactionResponseSchema.parse((await react('heart')).body);
    expect(removed).toMatchObject({ added: false, summary: [] });

    // Another customer can neither read nor react nor download.
    const other = await startConversation('other', `Other ${run}`);
    expect(other).not.toBe(conversationId);
    const theirRead = await api('get', `/chat/conversations/${conversationId}/messages`, 'other');
    expect(theirRead.status).toBe(404);
    const theirReact = await api(
      'post',
      `/chat/conversations/${conversationId}/messages/${posted.message.id}/reactions`,
      'other',
    ).send({ emoji: 'heart' });
    expect(theirReact.status).toBe(404);
    expect(errorOf(theirReact.body).code).toBe('conversation_not_found');
    const theirMedia = await media('other', file.id);
    expect(theirMedia.status).toBe(404);
    const theirFeedback = await api(
      'get',
      `/chat/conversations/${conversationId}/my-feedback`,
      'other',
    );
    expect(theirFeedback.status).toBe(404);

    // Nor can they attach the first customer's upload to a message of their own.
    const stolen = await post('other', {
      conversationId: other,
      clientMessageId: randomUUID(),
      body: 'Not mine',
      attachmentIds: [file.id],
    });
    expect(stolen.status).toBe(404);
    expect(errorOf(stolen.body).code).toBe('attachment_not_found');

    // The owner reads their own (empty) feedback list.
    const mine = await api('get', `/chat/conversations/${conversationId}/my-feedback`, 'customer');
    expect(mine.status).toBe(200);
    expect(chatMyFeedbackResponseSchema.parse(mine.body).feedback).toEqual([]);
  });

  it('refuses a picture below the minimum and an oversized one, storing nothing', async () => {
    const conversationId = await startConversation('other', `Rules ${run}`);
    const before = objects.objects.size;
    const tiny = await upload(
      'other',
      conversationId,
      'dot.png',
      'image/png',
      await makeImage('png', 8, 8),
    );
    expect(tiny.status).toBe(400);
    expect(errorOf(tiny.body).code).toBe('image_invalid');
    const wide = await upload(
      'other',
      conversationId,
      'wide.png',
      'image/png',
      await makeImage('png', 8100, 20),
    );
    expect(wide.status).toBe(400);
    expect(errorOf(wide.body).code).toBe('image_invalid');
    expect(objects.objects.size).toBe(before);
  });
});

describe('a document and a voice recording', () => {
  it('attaches a PDF with no text and serves it back as a download', async () => {
    const conversationId = await startConversation('customer', `Document ${run}`);
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
    const file = await uploaded('customer', conversationId, 'invoice.pdf', 'application/pdf', pdf);
    expect(file.contentType).toBe('application/pdf');

    const sent = await post('customer', {
      conversationId,
      clientMessageId: randomUUID(),
      attachmentIds: [file.id],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const posted = postedChatMessageSchema.parse(sent.body);
    // A file with no text is shown under its own name.
    expect(posted.message.body).toBe('invoice.pdf');

    const downloaded = await media('customer', file.id);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toContain('application/pdf');
    expect(downloaded.headers['content-disposition']).toContain('attachment');
    expect((downloaded.body as Buffer).equals(pdf)).toBe(true);
  });

  it('attaches an audio recording with its length and serves its bytes', async () => {
    const conversationId = await startConversation('customer', `Audio ${run}`);
    const audio = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(64, 7)]);
    const response = await upload('customer', conversationId, 'voice.ogg', 'audio/ogg', audio);
    // The query string carries the length for a recording.
    expect(response.status).toBe(201);
    const withLength = await api(
      'post',
      `/chat/conversations/${conversationId}/attachments?fileName=voice2.ogg&durationMs=3000`,
      'customer',
    )
      .set('Content-Type', 'audio/ogg')
      .send(audio);
    expect(withLength.status, JSON.stringify(withLength.body)).toBe(201);
    const file = chatAttachmentUploadSchema.parse(withLength.body);
    expect(file.durationMs).toBe(3000);

    const sent = await post('customer', {
      conversationId,
      clientMessageId: randomUUID(),
      body: 'Voice message',
      attachmentIds: [file.id],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(postedChatMessageSchema.parse(sent.body).attachments[0]?.durationMs).toBe(3000);

    const downloaded = await media('customer', file.id);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toContain('audio/ogg');
    expect((downloaded.body as Buffer).equals(audio)).toBe(true);
  });

  it('answers a missing upload with its own code and stores no message', async () => {
    const conversationId = await startConversation('customer', `Missing ${run}`);
    const clientMessageId = randomUUID();
    const sent = await post('customer', {
      conversationId,
      clientMessageId,
      body: 'Ghost',
      attachmentIds: [randomUUID()],
    });
    expect(sent.status).toBe(404);
    expect(errorOf(sent.body).code).toBe('attachment_not_found');
    const stored = await pool.query(
      'select 1 from public.chat_messages where client_message_id = $1',
      [clientMessageId],
    );
    expect(stored.rowCount).toBe(0);
  });
});
