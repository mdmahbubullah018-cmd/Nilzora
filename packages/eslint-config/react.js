import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { libraryConfig } from './base.js';

/** Framework-neutral React web libraries (e.g. @nilzora/ui): hooks and accessibility rules. */
export function reactLibraryConfig({ tsconfigRootDir }) {
  return defineConfig([
    libraryConfig({ tsconfigRootDir }),
    reactHooks.configs.flat.recommended,
    jsxA11y.flatConfigs.recommended,
    { languageOptions: { globals: globals.browser } },
  ]);
}
