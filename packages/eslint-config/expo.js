import expoFlat from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
import { ignores, sharedRules, typeChecked } from './base.js';

/** Expo / React Native apps: Expo's recommended rules plus the shared type-aware rules. */
export function expoConfig({ tsconfigRootDir }) {
  return defineConfig([ignores, expoFlat, typeChecked({ tsconfigRootDir }), sharedRules, prettier]);
}
