import type { NextConfig } from 'next';

/**
 * Anti-framing for every response: no site, including this one, may show the admin
 * workspaces in a frame (clickjacking). `frame-ancestors` is the CSP directive modern
 * browsers honour; X-Frame-Options covers older ones. The app sets no other CSP yet;
 * when one is added, put its directives in this list so they ship as one header.
 */
export const CONTENT_SECURITY_POLICY = ["frame-ancestors 'none'"].join('; ');

export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Stop `next dev` from writing an AGENTS.md file into the app.
  agentRules: false,
  // A product image upload is a Server Action carrying up to 5 MB (PRODUCT_IMAGE_MAX_BYTES)
  // plus the form fields; the 1 MB default would refuse it. The API enforces the real limit.
  // A product video (PRODUCT_VIDEO_MAX_BYTES, 40 MB) reaches the upload route through the
  // proxy, whose default buffer is 10 MB; the route and the API still enforce the real limits.
  experimental: { serverActions: { bodySizeLimit: '6mb' }, proxyClientMaxBodySize: '41mb' },
  headers: () => Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]),
};

export default nextConfig;
