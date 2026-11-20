import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/ssr.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['@simplex-viz/core'],
  tsconfig: './tsconfig.build.json',
});
