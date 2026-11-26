import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only. Tests against the real local Supabase stack run via
// `pnpm test:integration` (vitest.integration.config.ts).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
});
