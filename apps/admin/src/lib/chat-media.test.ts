import { describe, expect, it } from 'vitest';
import { chatMediaUrl } from './chat-media';

const ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111';

/*
 * The shape here is not invented: it is exactly what `withAttachmentUrls` in the API emits, and
 * the proxy route only matches one segment after `/api/support/media`. A mapper that forwarded
 * the trailing `/media` onto the proxy would produce a path no route answers, so the workspace
 * would get a 404 page instead of the customer's picture or recording.
 */
describe('chatMediaUrl', () => {
  it('points a full attachment at the proxy, keeping a single uuid segment', () => {
    const mapped = chatMediaUrl(`/chat/attachments/${ATTACHMENT_ID}/media`);

    expect(mapped).toBe(`/api/support/media/${ATTACHMENT_ID}`);
    expect(mapped.split('/')).toHaveLength(5);
  });

  it('points a thumbnail at the same proxy path and keeps the variant', () => {
    expect(chatMediaUrl(`/chat/attachments/${ATTACHMENT_ID}/media?variant=thumb`)).toBe(
      `/api/support/media/${ATTACHMENT_ID}?variant=thumb`,
    );
  });

  it('leaves an address the API never produces untouched', () => {
    for (const path of [
      'https://media.example.test/chat/a/b.webp',
      `/media/${ATTACHMENT_ID}`,
      `/chat/attachments/${ATTACHMENT_ID}/other`,
      `/chat/attachments/${ATTACHMENT_ID}`,
      '',
    ]) {
      expect(chatMediaUrl(path)).toBe(path);
    }
  });

  it('cannot be used to reach a second path segment or another host', () => {
    for (const path of [
      `/chat/attachments/../../etc/passwd/media`,
      `/chat/attachments/${ATTACHMENT_ID}/media/../../admin`,
      `/chat/attachments/${ATTACHMENT_ID}/media#x`,
    ]) {
      expect(chatMediaUrl(path)).toBe(path);
    }
  });
});
