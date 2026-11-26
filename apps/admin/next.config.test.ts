import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('next.config headers', () => {
  it('forbids framing on every route', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const everywhere = rules.find((rule) => rule.source === '/:path*');

    const headers = new Map(everywhere?.headers.map((header) => [header.key, header.value]));

    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('sends a single Content-Security-Policy header', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const csp = rules.flatMap((rule) =>
      rule.headers.filter((header) => header.key.toLowerCase() === 'content-security-policy'),
    );
    expect(csp).toHaveLength(1);
  });
});
