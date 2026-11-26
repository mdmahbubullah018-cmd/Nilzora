import { describe, expect, it } from 'vitest';
import { emailSchema, fullNameSchema, passwordSchema } from './account';

describe('emailSchema', () => {
  it('trims and lower-cases addresses', () => {
    expect(emailSchema.parse('  Rahim.Uddin@Example.COM ')).toBe('rahim.uddin@example.com');
  });

  it.each(['', 'not-an-email', 'a@', '@example.com', `${'a'.repeat(250)}@example.com`])(
    'rejects %j',
    (input) => {
      expect(emailSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('passwordSchema', () => {
  it.each(['secret123', 'পাসওয়ার্ড১২৩৪', 'Correct horse 7 battery'])('accepts %j', (input) => {
    expect(passwordSchema.safeParse(input).success).toBe(true);
  });

  it('allows exactly 72 bytes of multi-byte text', () => {
    // 22 ASCII + 1 digit + 16 three-byte Bengali letters = 22 + 1 + 48 = 71 bytes; + "1" = 72.
    expect(passwordSchema.safeParse(`${'a'.repeat(22)}1${'ক'.repeat(16)}1`).success).toBe(true);
    expect(passwordSchema.safeParse(`${'a'.repeat(22)}1${'ক'.repeat(16)}12`).success).toBe(false);
  });

  it.each([
    ['too short', 'abc123'],
    ['letters only', 'onlyletters'],
    ['digits only', '1234567890'],
    ['over 72 bytes', `${'a'.repeat(70)}১২`],
  ])('rejects a password that is %s', (_, input) => {
    expect(passwordSchema.safeParse(input).success).toBe(false);
  });
});

describe('fullNameSchema', () => {
  it('trims names', () => {
    expect(fullNameSchema.parse('  Rahima Khatun ')).toBe('Rahima Khatun');
  });

  it.each(['', '   ', 'x'.repeat(121)])('rejects %j', (input) => {
    expect(fullNameSchema.safeParse(input).success).toBe(false);
  });
});
