import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      'tests/reference/**',
      'tests/browser/reference/**',
      'src/glyphs.js',
      'src/editor-highlighter.js',
      'src/example-links.js',
    ],
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    files: ['*.js', 'scripts/**/*.js', 'tests/**/*.js'],
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
