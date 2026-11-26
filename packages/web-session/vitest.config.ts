import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Next.js resolves `server-only` to an empty module on the server; tests do the same.
      'server-only': fileURLToPath(new URL('./src/testing/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
