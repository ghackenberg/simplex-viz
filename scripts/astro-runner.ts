import { build, dev, preview, sync } from 'astro';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'dev';

  if (mode === 'sync') {
    await sync({ root: ROOT });
    return;
  }

  if (mode === 'build') {
    await build({ root: ROOT });
    return;
  }

  if (mode === 'preview') {
    await preview({
      root: ROOT,
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
    });
    return;
  }

  await dev({
    root: ROOT,
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
