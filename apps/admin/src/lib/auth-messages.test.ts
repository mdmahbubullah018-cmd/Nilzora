import { RATE_LIMITED_MESSAGE } from '@nilzora/web-session';
import { describe, expect, it } from 'vitest';
import { SIGN_IN_RATE_LIMITED } from './auth-messages';

describe('SIGN_IN_RATE_LIMITED', () => {
  it('matches the message the session layer sends for a rate-limited sign-in', () => {
    expect(SIGN_IN_RATE_LIMITED).toBe(RATE_LIMITED_MESSAGE);
  });
});
