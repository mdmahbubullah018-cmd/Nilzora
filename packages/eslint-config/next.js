import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import { ignores, sharedRules, typeChecked } from './base.js';

/** Next.js apps: Core Web Vitals, React, hooks and a11y rules plus the shared type-aware rules. */
export function nextConfig({ tsconfigRootDir }) {
  return defineConfig([
    ignores,
    globalIgnores(['next-env.d.ts']),
    js.configs.recommended,
    nextVitals,
    nextTypescript,
    typeChecked({ tsconfigRootDir }),
    sharedRules,
    prettier,
  ]);
}
