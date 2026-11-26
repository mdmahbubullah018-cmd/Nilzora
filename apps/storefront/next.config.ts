import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Stop `next dev` from writing an AGENTS.md file into the app.
  agentRules: false,
  // Without JavaScript a picture upload is a Server Action carrying up to 5 MB (the API's limit)
  // plus the form fields; the 1 MB default would refuse it. With JavaScript the picture goes to
  // /api/uploads instead, and the API enforces the real limit either way.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
};

export default nextConfig;
