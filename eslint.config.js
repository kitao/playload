import js from '@eslint/js';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';

export default defineConfig([
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
  // Generated modules, checked by their generators.
  globalIgnores(['src/engine/glyphs.js', 'src/app/examples.js']),
  js.configs.recommended,
  {
    rules: {
      // `== null` deliberately matches both null and undefined.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    files: ['*.js', 'scripts/**/*.{js,mjs}', 'tests/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/browser/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['examples/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: Object.fromEntries(
        ['cls', 'put', 'spr', 'btn', 'btnp', 'play', 'pcg', 'scr'].map((name) => [
          name,
          'readonly',
        ]),
      ),
    },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^tick$', args: 'none' }] },
  },
]);
