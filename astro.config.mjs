import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawBase = process.env.GITHUB_PAGES_BASE?.trim();
const normalizedBase =
  rawBase && rawBase !== './' && rawBase !== '/'
    ? `/${rawBase.replace(/^\/+|\/+$/g, '')}`
    : undefined;

export default defineConfig({
  site: 'https://hackenberg.tech',
  base: normalizedBase,
  output: 'static',
  integrations: [react(), mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark-default',
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@simplex-viz/core/worker': path.resolve(__dirname, 'packages/core/src/worker.ts'),
        '@simplex-viz/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
        '@simplex-viz/svg': path.resolve(__dirname, 'packages/svg/src/index.ts'),
        '@simplex-viz/canvas': path.resolve(__dirname, 'packages/canvas/src/index.ts'),
        '@simplex-viz/react': path.resolve(__dirname, 'packages/react/src/index.ts'),
        '@simplex-viz/wc/define': path.resolve(__dirname, 'packages/wc/src/define.ts'),
        '@simplex-viz/wc': path.resolve(__dirname, 'packages/wc/src/index.ts'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  },
});
