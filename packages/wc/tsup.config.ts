import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/define.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['@simplex-viz/core', '@simplex-viz/svg'],
  tsconfig: './tsconfig.build.json',
});
