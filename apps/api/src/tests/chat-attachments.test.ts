import { describe, expect, it } from 'vitest';
import { contentMatchesType, chatUploadLimit } from '../modules/chat/attachments';
import { makeImage } from './media-fakes';

/*
 * What a chat upload may be. These tests hold down the two decisions that keep the allowlist
 * meaningful: the signature in a file's own bytes must agree with the Content-Type it claims, and
 * each kind has its own ceiling. A document or a recording is never parsed here — only its
 * leading bytes are read.
 */

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');
/** A minimal ZIP local-file header, which is what a DOCX or XLSX begins with. */
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const OGG = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(24)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ', 'latin1'), Buffer.alloc(8)]);
const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(16)]);
const WAV = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4),
  Buffer.from('WAVE', 'latin1'),
]);

describe('contentMatchesType', () => {
  it('accepts a picture whose bytes really are that format', async () => {
    expect(contentMatchesType(await makeImage('png', 500, 500), 'image/png')).toBe(true);
    expect(contentMatchesType(await makeImage('jpeg', 500, 500), 'image/jpeg')).toBe(true);
    expect(contentMatchesType(await makeImage('webp', 500, 500), 'image/webp')).toBe(true);
  });

  it('refuses a picture whose bytes are another format', async () => {
    const png = await makeImage('png', 500, 500);
    expect(contentMatchesType(png, 'image/jpeg')).toBe(false);
    expect(contentMatchesType(png, 'image/webp')).toBe(false);
  });

  it.each([
    ['application/pdf', () => PDF],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', () => ZIP],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', () => ZIP],
    ['audio/ogg', () => OGG],
    ['audio/webm', () => WEBM],
    ['audio/mp4', () => MP4],
    ['audio/mpeg', () => MP3],
    ['audio/wav', () => WAV],
    ['text/plain', () => Buffer.from('Delivery note: two lamps', 'utf8')],
    ['text/csv', () => Buffer.from('sku,qty\nlamp,2', 'utf8')],
  ])('accepts %s when its bytes carry that signature', (type, body) => {
    expect(contentMatchesType(body(), type)).toBe(true);
  });

  it.each(['application/pdf', 'audio/ogg', 'audio/mpeg', 'text/plain'])(
    'refuses %s when the bytes are something else',
    async (type) => {
      const png = await makeImage('png', 500, 500);
      expect(contentMatchesType(png, type)).toBe(false);
      expect(contentMatchesType(Buffer.from([0x00, 0x01, 0x02]), type)).toBe(false);
      expect(contentMatchesType(Buffer.from('Delivery note: two lamps', 'utf8'), type)).toBe(
        type === 'text/plain',
      );
    },
  );

  it('refuses a type that is not on the allowlist at all', () => {
    expect(contentMatchesType(PDF, 'application/x-msdownload')).toBe(false);
    expect(contentMatchesType(PDF, 'application/zip')).toBe(false);
    expect(contentMatchesType(PDF, '')).toBe(false);
  });
});

describe('chatUploadLimit', () => {
  it('gives each kind its own ceiling', () => {
    expect(chatUploadLimit('image/png')).toBe(10 * 1024 * 1024);
    expect(chatUploadLimit('audio/ogg')).toBe(10 * 1024 * 1024);
    expect(chatUploadLimit('application/pdf')).toBe(20 * 1024 * 1024);
    expect(
      chatUploadLimit('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe(20 * 1024 * 1024);
  });

  it('uses the largest ceiling for a type nobody allows, so the reader is never the reason', () => {
    expect(chatUploadLimit('application/zip')).toBe(20 * 1024 * 1024);
  });
});
