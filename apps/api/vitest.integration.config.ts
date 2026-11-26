import { defineConfig } from 'vitest/config';

// Runs against the local Supabase stack (`pnpm supabase start`). Fails, rather than
// skipping, when the stack is not running.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./src/tests/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
