import { describe, expect, it } from 'vitest';
import { beginChatAttachmentSchema, uploadChatAttachmentQuerySchema } from './chat-admin';
import {
  CHAT_ATTACHMENT_TYPES,
  CHAT_AUDIO_MAX_DURATION_MS,
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_IMAGE_MAX_BYTES,
  chatMediaKindOf,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
  sanitizeChatFileName,
} from './chat-media';

/*
 * The chat media allowlist. Every layer reads these numbers — the API's body reader, the web
 * composers, the app and the database functions — so a wrong value here is an upload refused
 * after the whole file has been sent, or a limit that exists in one place only.
 */

describe('chatMediaKindOf', () => {
  it.each([
    ['image/jpeg', 'image'],
    ['image/png', 'image'],
    ['image/webp', 'image'],
    ['application/pdf', 'document'],
    ['text/plain', 'document'],
    ['text/csv', 'document'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document'],
    ['audio/webm', 'audio'],
    ['audio/ogg', 'audio'],
    ['audio/mp4', 'audio'],
    ['audio/mpeg', 'audio'],
    ['audio/wav', 'audio'],
  ])('reads %s as a %s', (type, kind) => {
    expect(chatMediaKindOf(type)).toBe(kind);
  });

  it('ignores a charset parameter and casing, as browsers send both', () => {
    expect(chatMediaKindOf('Text/Plain; charset=utf-8')).toBe('document');
    expect(chatMediaKindOf('IMAGE/PNG')).toBe('image');
  });

  it.each([
    'application/zip',
    'application/x-msdownload',
    'application/x-sh',
    'image/gif',
    'image/svg+xml',
    'audio/flac',
    'video/mp4',
    '',
  ])('refuses %s, which is not on the allowlist', (type) => {
    expect(chatMediaKindOf(type)).toBeNull();
  });

  it('lists every allowed type exactly once', () => {
    expect(new Set(CHAT_ATTACHMENT_TYPES).size).toBe(CHAT_ATTACHMENT_TYPES.length);
  });
});

describe('chatMediaMaxBytes', () => {
  it('gives documents more room than pictures or recordings', () => {
    expect(chatMediaMaxBytes('image')).toBe(CHAT_IMAGE_MAX_BYTES);
    expect(chatMediaMaxBytes('audio')).toBe(CHAT_IMAGE_MAX_BYTES);
    expect(chatMediaMaxBytes('document')).toBe(CHAT_DOCUMENT_MAX_BYTES);
    expect(CHAT_DOCUMENT_MAX_BYTES).toBeGreaterThan(CHAT_IMAGE_MAX_BYTES);
  });

  it('names the limit for a person', () => {
    expect(chatMediaMaxLabel('image')).toBe('10 MB');
    expect(chatMediaMaxLabel('document')).toBe('20 MB');
  });
});

describe('sanitizeChatFileName', () => {
  it('drops a path, keeping only the name', () => {
    expect(sanitizeChatFileName('../../etc/passwd.pdf', 'application/pdf')).toBe('passwd.pdf');
    expect(sanitizeChatFileName('C:\\Users\\me\\Invoice.PDF', 'application/pdf')).toBe(
      'Invoice.pdf',
    );
    expect(sanitizeChatFileName('/var/tmp/report.docx', 'application/pdf')).toBe('report.pdf');
  });

  it('takes the extension from the type actually stored, never from the name', () => {
    // A picture becomes WebP before it is stored, so its display name says so.
    expect(sanitizeChatFileName('photo.exe', 'image/png')).toBe('photo.webp');
    expect(sanitizeChatFileName('sheet.txt', 'text/csv')).toBe('sheet.csv');
    expect(
      sanitizeChatFileName(
        'notes.bin',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('notes.docx');
  });

  it('removes control characters and collapses whitespace', () => {
    expect(sanitizeChatFileName('a\u0000b\u001f  c  .pdf', 'application/pdf')).toBe('ab c.pdf');
  });

  it('never returns an empty name or a leading dot', () => {
    expect(sanitizeChatFileName('', 'application/pdf')).toBe('file.pdf');
    expect(sanitizeChatFileName('.env', 'text/plain')).toBe('env.txt');
    expect(sanitizeChatFileName('...', 'application/pdf')).toBe('file.pdf');
  });

  it('caps the length', () => {
    const long = `${'a'.repeat(400)}.pdf`;
    expect(sanitizeChatFileName(long, 'application/pdf').length).toBeLessThanOrEqual(120);
  });

  it('keeps a readable name untouched', () => {
    expect(sanitizeChatFileName('March invoice.pdf', 'application/pdf')).toBe('March invoice.pdf');
  });
});

/*
 * A voice message's length travels with the upload
 * -----------------------------------------------
 * The recorder measures it, the API carries it and the database stores it, so the player can show
 * the length before the audio has loaded. These assertions pin the three places that decide
 * whether such a value is allowed at all.
 */
describe('a voice message length', () => {
  it('is accepted on the upload query, as a number a query string can carry', () => {
    const parsed = uploadChatAttachmentQuerySchema.safeParse({
      fileName: 'voice.webm',
      durationMs: '12500',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.durationMs).toBe(12_500);
  });

  it('is optional, because a picture or a document has no length', () => {
    const parsed = uploadChatAttachmentQuerySchema.safeParse({ fileName: 'invoice.pdf' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.durationMs).toBeUndefined();
  });

  it('is refused beyond five minutes, empty or not a whole number of milliseconds', () => {
    for (const durationMs of ['0', '-1', '300001', '1.5', 'abc']) {
      expect(
        uploadChatAttachmentQuerySchema.safeParse({ fileName: 'v.webm', durationMs }).success,
      ).toBe(false);
    }
    expect(
      uploadChatAttachmentQuerySchema.safeParse({
        fileName: 'v.webm',
        durationMs: String(CHAT_AUDIO_MAX_DURATION_MS),
      }).success,
    ).toBe(true);
  });

  it('is capped at five minutes on the record the API creates too', () => {
    const base = {
      conversationId: '11111111-1111-4111-8111-111111111111',
      objectKey: 'chat/11111111-1111-4111-8111-111111111111/x',
      fileName: 'voice.webm',
      contentType: 'audio/webm' as const,
      byteSize: 1024,
    };
    expect(beginChatAttachmentSchema.safeParse({ ...base, durationMs: 60_000 }).success).toBe(true);
    expect(beginChatAttachmentSchema.safeParse({ ...base, durationMs: 300_001 }).success).toBe(
      false,
    );
  });
});
