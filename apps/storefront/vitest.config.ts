import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${fromHere('./src')}/` },
      // Next.js resolves `server-only` to an empty module on the server; tests do the same.
      { find: 'server-only', replacement: fromHere('./src/testing/server-only.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testing/setup.ts'],
  },
});
