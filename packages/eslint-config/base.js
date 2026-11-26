import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Build output and generated files are never linted. */
export const ignores = globalIgnores([
  '**/dist/',
  '**/build/',
  '**/coverage/',
  '**/.next/',
  '**/.expo/',
  '**/out/',
]);

/**
 * Type-aware TypeScript rules. Each package passes its own directory so the
 * typescript-eslint project service resolves that package's tsconfig.json.
 */
export function typeChecked({ tsconfigRootDir }) {
  return defineConfig([
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  ]);
}

/** Conventions shared by every Nilzora package. */
export const sharedRules = defineConfig({
  rules: {
    eqeqeq: ['error', 'smart'],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
  },
});

/** Platform-neutral TypeScript packages (contracts, validation, tokens, API client). */
export function libraryConfig({ tsconfigRootDir }) {
  return defineConfig([
    ignores,
    js.configs.recommended,
    typeChecked({ tsconfigRootDir }),
    sharedRules,
    prettier,
  ]);
}

/** Node.js services and tooling. */
export function nodeConfig({ tsconfigRootDir }) {
  return defineConfig([
    libraryConfig({ tsconfigRootDir }),
    { languageOptions: { globals: globals.node } },
  ]);
}
