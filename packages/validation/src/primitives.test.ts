import { describe, expect, it } from 'vitest';
import { bdMobilePhoneSchema, uuidSchema } from './primitives';

describe('uuidSchema', () => {
  it('accepts a valid uuid', () => {
    expect(uuidSchema.safeParse('3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60').success).toBe(true);
  });

  it.each(['', 'not-a-uuid', '3f8e2a52-7b1c-4d3e-9f0a'])('rejects %j', (input) => {
    expect(uuidSchema.safeParse(input).success).toBe(false);
  });
});

describe('bdMobilePhoneSchema', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['8801912345678', '+8801912345678'],
    ['017-1234-5678', '+8801712345678'],
    [' 01312 345678 ', '+8801312345678'],
  ])('normalises %j to %j', (input, expected) => {
    expect(bdMobilePhoneSchema.parse(input)).toBe(expected);
  });

  it.each(['01212345678', '0171234567', '017123456789', '+8811712345678', 'abcdefghijk', ''])(
    'rejects %j',
    (input) => {
      expect(bdMobilePhoneSchema.safeParse(input).success).toBe(false);
    },
  );
});
