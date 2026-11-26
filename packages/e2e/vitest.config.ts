import { defineConfig } from 'vitest/config';

/**
 * End-to-end suite: needs the local Supabase stack running and the API, storefront and
 * admin built (`pnpm build`). Run with `pnpm test:e2e` from the repository root.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.e2e.ts'],
    globalSetup: ['./src/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
