import { describe, expect, it } from 'vitest';
import { clientIpFrom } from './client-ip';

function forwardedFor(value: string): Headers {
  return new Headers({ 'x-forwarded-for': value });
}

describe('clientIpFrom', () => {
  it('takes the rightmost entry when no proxies are trusted', () => {
    const headers = forwardedFor('198.51.100.7, 203.0.113.9');
    expect(clientIpFrom(headers, 0)).toBe('203.0.113.9');
    expect(clientIpFrom(headers, 1)).toBe('203.0.113.9');
  });

  it('takes the N-th entry from the right behind N trusted proxies', () => {
    const headers = forwardedFor('1.1.1.1, 198.51.100.7, 203.0.113.9, 10.0.0.2');
    expect(clientIpFrom(headers, 2)).toBe('203.0.113.9');
    expect(clientIpFrom(headers, 3)).toBe('198.51.100.7');
  });

  it('ignores a client-supplied prefix when proxies append their own entries', () => {
    // The client claims 9.9.9.9; the trusted proxy appended the address it saw.
    expect(clientIpFrom(forwardedFor('9.9.9.9, 203.0.113.9'), 1)).toBe('203.0.113.9');
  });

  it('accepts IPv6 addresses and trims whitespace and empty entries', () => {
    expect(clientIpFrom(forwardedFor(' 2001:db8::1 ,, '), 0)).toBe('2001:db8::1');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['only separators', ' , ,'],
    ['not an address', 'unknown'],
    ['an address with a port', '203.0.113.9:443'],
    ['a bracketed IPv6 address', '[2001:db8::1]'],
    ['a hostname', 'evil.test'],
  ])('returns undefined when the header is %s', (_, value) => {
    const headers = value === undefined ? new Headers() : forwardedFor(value);
    expect(clientIpFrom(headers, 0)).toBeUndefined();
  });

  it('returns undefined when more proxies are trusted than there are entries', () => {
    expect(clientIpFrom(forwardedFor('203.0.113.9'), 2)).toBeUndefined();
  });

  it('returns undefined when the selected entry is invalid, without falling back', () => {
    expect(clientIpFrom(forwardedFor('203.0.113.9, garbage'), 0)).toBeUndefined();
  });
});
