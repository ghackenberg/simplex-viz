import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@simplex-viz/core': path.resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      '@simplex-viz/svg': path.resolve(import.meta.dirname, 'packages/svg/src/index.ts'),
      '@simplex-viz/react': path.resolve(import.meta.dirname, 'packages/react/src/index.ts'),
    },
  },
  test: {
    globals: false,
    testTimeout: 15000,
    include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
    typecheck: {
      enabled: true,
      include: ['packages/**/__tests__/**/*.test-d.{ts,tsx}'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['packages/*/src/**/index.ts'],
    },
  },
});
