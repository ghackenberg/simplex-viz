import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    'react',
    'react-dom',
    'react-dom/client',
    'react-dom/server',
    'react/jsx-runtime',
    '@simplex-viz/core',
    '@simplex-viz/svg',
  ],
  tsconfig: './tsconfig.build.json',
});
