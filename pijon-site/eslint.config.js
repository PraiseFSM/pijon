import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactPlugin from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

/**
 * LOCAL-FIRST ENFORCEMENT
 * Pijon has NO backend and makes NO network calls at runtime.
 * Data lives only in the browser (IndexedDB) or in files the user owns.
 * The `no-restricted-globals` and `no-restricted-syntax` rules below are
 * ERRORS (not warnings) because a network call is a legal violation (FERPA/COPPA/GDPR)
 * and breaks Pijon's core privacy promise — it must be a build-breaker, not a hint.
 */

/** Rules shared across all TS files */
const noNetworkRules = {
  // LOCAL-FIRST: any use of network APIs is a hard error — not a warning.
  // "Data never leaves the device" is Pijon's #1 design goal and a legal requirement.
  'no-restricted-globals': [
    'error',
    {
      name: 'fetch',
      message:
        'Pijon is local-first — no network calls allowed. All data must stay on-device (IndexedDB or user-owned files).',
    },
    {
      name: 'XMLHttpRequest',
      message:
        'Pijon is local-first — no network calls allowed. Use IndexedDB or File System Access API instead.',
    },
    {
      name: 'WebSocket',
      message:
        'Pijon is local-first — no WebSocket connections allowed. Data must never leave the device.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='WebSocket']",
      message: 'Pijon is local-first — no WebSocket connections allowed.',
    },
    {
      selector: "NewExpression[callee.name='XMLHttpRequest']",
      message: 'Pijon is local-first — no XHR allowed.',
    },
  ],

  // Keep the codebase honest: no sneaky `any`
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },

  // Node/build-tool files (vite.config.ts, etc.) — typed against tsconfig.node.json
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['vite.config.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: ['./tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: noNetworkRules,
  },

  // Application source files — typed against tsconfig.app.json
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      // Disable ESLint rules that would conflict with Prettier formatting
      prettierConfig,
    ],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      react: reactPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Catch common React mistakes: missing key props, invalid JSX, etc.
      'react/jsx-key': 'error',
      'react/no-array-index-key': 'warn',
      'react/self-closing-comp': 'warn',
      ...noNetworkRules,
    },
  },

  // Vitest test files — relax a few rules that are painful in tests
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `expect(mock.method).toHaveBeenCalled()` is idiomatic in Vitest — the
      // "unbound method" concern does not apply to jest/vi mock functions.
      '@typescript-eslint/unbound-method': 'off',
      // Tests sometimes check conditions that TypeScript can statically resolve —
      // acceptable in test assertions where clarity beats brevity.
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
);
