import { createRequire } from 'node:module';
import js from '@eslint/js';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const ts6Entry = (() => {
  try {
    return require.resolve('@typescript/typescript6');
  } catch {
    return null;
  }
})();
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'typescript' && ts6Entry) {
    return originalLoad.call(this, ts6Entry, parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};

const tseslint = require('typescript-eslint');

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                '@simplex-viz/svg',
                '@simplex-viz/react',
              ],
              message:
                '@simplex-viz/core must remain completely headless and free of React/DOM/SVG dependencies.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: '@simplex-viz/core must not access DOM global `window`.',
        },
        {
          name: 'document',
          message: '@simplex-viz/core must not access DOM global `document`.',
        },
      ],
    },
  },
  {
    files: ['packages/svg/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@simplex-viz/react'],
              message:
                '@simplex-viz/svg must remain framework-agnostic and never import React or @simplex-viz/react.',
            },
          ],
        },
      ],
    },
  },
);
