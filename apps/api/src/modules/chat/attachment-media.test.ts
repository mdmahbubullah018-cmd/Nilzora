import { describe, expect, it } from 'vitest';
import {
  withAttachmentUrls,
  withAttachmentUrlsOf,
  type StoredAttachment,
} from './attachment-media';

/*
 * How a chat attachment is addressed.
 *
 * Customer support media is private: the API answers with its own authorized route, never with a
 * bucket address, so holding a URL grants nothing. The object key stays on the server and is
 * never serialized to a client.
 */

const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const UPLOAD = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';
const ATTACHMENT = '44444444-4444-4444-8444-444444444444';

function attachment(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: ATTACHMENT,
    fileName: 'parcel.webp',
    contentType: 'image/webp',
    byteSize: 1024,
    width: 800,
    height: 600,
    objectKey: `chat/${CONVERSATION}/${UPLOAD}/full.webp`,
    ...overrides,
  };
}

describe('withAttachmentUrls', () => {
  it('addresses a picture through the private route, with a thumbnail variant', () => {
    const picture = withAttachmentUrls(attachment(), 'https://media.nilzora.test');

    expect(picture.url).toBe(`/chat/attachments/${ATTACHMENT}/media`);
    expect(picture.thumbnailUrl).toBe(`/chat/attachments/${ATTACHMENT}/media?variant=thumb`);
  });

  it('ignores the public bucket base entirely, even when one is configured', () => {
    const picture = withAttachmentUrls(attachment(), 'https://media.nilzora.test');

    expect(picture.url).not.toContain('media.nilzora.test');
    expect(picture.thumbnailUrl).not.toContain('media.nilzora.test');
  });

  it('addresses a document and a recording as the single private object they were stored as', () => {
    const document = withAttachmentUrls(
      attachment({
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        width: null,
        height: null,
        objectKey: `chat/${CONVERSATION}/${UPLOAD}/${FILE}`,
      }),
      undefined,
    );
    const voice = withAttachmentUrls(
      attachment({
        fileName: 'voice.webm',
        contentType: 'audio/webm',
        width: null,
        height: null,
        durationMs: 12_000,
        objectKey: `chat/${CONVERSATION}/${UPLOAD}/${FILE}`,
      }),
      undefined,
    );

    expect(document.url).toBe(`/chat/attachments/${ATTACHMENT}/media`);
    expect(document.thumbnailUrl).toBeNull();
    expect(voice.url).toBe(`/chat/attachments/${ATTACHMENT}/media`);
    expect(voice.thumbnailUrl).toBeNull();
    expect(voice.durationMs).toBe(12_000);
  });

  it('never serializes the object key or a bucket address', () => {
    const serialized = JSON.stringify(withAttachmentUrls(attachment()));

    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain(CONVERSATION);
    expect(serialized).not.toContain('full.webp');
  });

  it('keeps every attachment of a message in order', () => {
    const list = withAttachmentUrlsOf(
      [
        attachment(),
        attachment({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          contentType: 'application/pdf',
          objectKey: `chat/${CONVERSATION}/${UPLOAD}/${FILE}`,
        }),
      ],
      undefined,
    );

    expect(list.map((entry) => entry.url)).toStrictEqual([
      `/chat/attachments/${ATTACHMENT}/media`,
      '/chat/attachments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/media',
    ]);
  });
});
