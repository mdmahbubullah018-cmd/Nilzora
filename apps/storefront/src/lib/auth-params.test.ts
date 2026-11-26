import { describe, expect, it } from 'vitest';
import { loginNoticeFrom, singleParam, tokenHashFrom } from './auth-params';

const VALID_HASH = 'pkce_2b7f0c9e4d1a8b3c6e5f7a9d0b1c2e3f';

describe('singleParam', () => {
  it('returns a value that appears once and ignores repeated or missing ones', () => {
    expect(singleParam({ next: '/account' }, 'next')).toBe('/account');
    expect(singleParam({ next: ['/account', '/x'] }, 'next')).toBeUndefined();
    expect(singleParam({}, 'next')).toBeUndefined();
  });
});

describe('loginNoticeFrom', () => {
  it('maps known flags to fixed messages', () => {
    expect(loginNoticeFrom({ signedOut: '1' })).toEqual({
      tone: 'info',
      message: 'You have signed out.',
    });
    expect(loginNoticeFrom({ session: 'expired' })).toEqual({
      tone: 'warning',
      message: 'Your session ended. Sign in again.',
    });
    expect(loginNoticeFrom({ confirmed: '1' })).toEqual({
      tone: 'info',
      message: 'Your email address is confirmed. Sign in to continue.',
    });
  });

  it('never shows text taken from the query string', () => {
    const crafted = 'Your account is locked. Call 01700-000000 to unlock it.';
    for (const params of [
      { signedOut: crafted },
      { session: crafted },
      { confirmed: crafted },
      { message: crafted },
      { signedOut: ['1', '1'] },
    ]) {
      expect(loginNoticeFrom(params)).toBeUndefined();
    }
  });
});

describe('tokenHashFrom', () => {
  it('accepts a token hash with the shape the API expects', () => {
    expect(tokenHashFrom({ token_hash: VALID_HASH })).toBe(VALID_HASH);
  });

  it.each([
    ['missing', {}],
    ['empty', { token_hash: '' }],
    ['too short', { token_hash: 'abc123' }],
    ['unexpected characters', { token_hash: `${VALID_HASH}<script>` }],
    ['too long', { token_hash: 'a'.repeat(257) }],
    ['repeated', { token_hash: [VALID_HASH, VALID_HASH] }],
  ])('rejects a %s token hash', (_, params) => {
    expect(tokenHashFrom(params)).toBeUndefined();
  });
});
