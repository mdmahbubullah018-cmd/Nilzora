import { describe, expect, it } from 'vitest';
import { googlePictureUrl } from './avatar-directory';

/*
 * Only a Google-hosted https picture may be shown. The metadata it comes from is the
 * account's own and can be rewritten, so an avatar URL is treated like any other untrusted
 * value: anything else is dropped rather than loaded into the customer's or an admin's page.
 */

describe('googlePictureUrl', () => {
  it.each([
    'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c',
    'https://lh4.googleusercontent.com/a/other',
    'https://lh5.googleusercontent.com/a/third',
    'https://lh6.googleusercontent.com/a/fourth',
  ])('accepts a Google picture host (%s)', (value) => {
    expect(googlePictureUrl(value)).toBe(value);
  });

  it.each([
    ['another host', 'https://example.test/a.png'],
    ['plain http', 'http://lh3.googleusercontent.com/a/x'],
    ['a lookalike host', 'https://lh3.googleusercontent.com.evil.test/a/x'],
    ['credentials in the URL', 'https://user:pass@lh3.googleusercontent.com/a/x'],
    ['javascript', 'javascript:alert(1)'],
    ['not a URL', 'lh3.googleusercontent.com/a/x'],
    ['empty', '   '],
  ])('refuses %s', (_label, value) => {
    expect(googlePictureUrl(value)).toBeNull();
  });

  it('refuses a value that is not a string', () => {
    expect(googlePictureUrl(null)).toBeNull();
    expect(googlePictureUrl(42)).toBeNull();
  });
});
