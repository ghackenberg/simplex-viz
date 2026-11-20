import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PACKAGES = ['core', 'svg', 'canvas', 'react', 'wc'] as const;

function ensureBuiltDist(): void {
  const allBuilt = PACKAGES.every((pkg) =>
    fs.existsSync(path.join(REPO_ROOT, 'packages', pkg, 'dist', 'index.d.ts')) &&
    fs.existsSync(path.join(REPO_ROOT, 'packages', pkg, 'dist', 'index.js')),
  );
  if (!allBuilt) {
    execFileSync('npm', ['run', 'build:packages'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
  }
}

describe('ESM Node16 / NodeNext .d.ts package resolution (GitHub Issue #2)', () => {
  beforeAll(() => {
    ensureBuiltDist();
  }, 60_000);

  it(
    'resolves @simplex-viz/core, @simplex-viz/svg, @simplex-viz/react, and @simplex-viz/wc cleanly under moduleResolution: nodenext (both skipLibCheck: true and skipLibCheck: false)',
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simplex-viz-nodenext-'));
      try {
        const scopeDir = path.join(tmpDir, 'node_modules', '@simplex-viz');
        fs.mkdirSync(scopeDir, { recursive: true });

        for (const pkg of PACKAGES) {
          const pkgTargetDir = path.join(scopeDir, pkg);
          fs.mkdirSync(pkgTargetDir, { recursive: true });
          fs.copyFileSync(
            path.join(REPO_ROOT, 'packages', pkg, 'package.json'),
            path.join(pkgTargetDir, 'package.json'),
          );
          fs.cpSync(
            path.join(REPO_ROOT, 'packages', pkg, 'dist'),
            path.join(pkgTargetDir, 'dist'),
            { recursive: true },
          );
        }

        // Link React & @types/react peer types so @simplex-viz/react declarations check cleanly under skipLibCheck: false
        const rootNodeModules = path.join(REPO_ROOT, 'node_modules');
        for (const peer of ['react', 'react-dom', 'csstype']) {
          const src = path.join(rootNodeModules, peer);
          if (fs.existsSync(src)) {
            fs.symlinkSync(src, path.join(tmpDir, 'node_modules', peer), 'dir');
          }
        }
        const typesScope = path.join(tmpDir, 'node_modules', '@types');
        fs.mkdirSync(typesScope, { recursive: true });
        for (const peerType of ['react', 'react-dom']) {
          const src = path.join(rootNodeModules, '@types', peerType);
          if (fs.existsSync(src)) {
            fs.symlinkSync(src, path.join(typesScope, peerType), 'dir');
          }
        }

        const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
        fs.writeFileSync(
          tsconfigPath,
          JSON.stringify(
            {
              compilerOptions: {
                module: 'nodenext',
                moduleResolution: 'nodenext',
                strict: true,
                noEmit: true,
                skipLibCheck: true,
                types: [],
              },
              files: ['repro.mts'],
            },
            null,
            2,
          ),
        );

        const reproSource = [
          'import { solveSimplexSnapshot, type SimplexLayoutSnapshot } from "@simplex-viz/core";',
          'import {',
          '  SIMPLEX_WORKER_PROTOCOL_VERSION,',
          '  attachSimplexWorkerHandler,',
          '  createSimplexWorkerClient,',
          '  solveSimplexSnapshotAsync,',
          '  type SimplexWorkerClient,',
          '} from "@simplex-viz/core/worker";',
          'import { createSimplexSvg, solveSimplexSnapshot as svgSolveSnapshot } from "@simplex-viz/svg";',
          'import { renderSimplexSvgString, estimateSsrTextWidth } from "@simplex-viz/svg/ssr";',
          'import {',
          '  createSimplexCanvas,',
          '  CanvasRendererAdapter,',
          '  renderSimplexSnapshotToCanvas,',
          '  solveSimplexSnapshot as canvasSolveSnapshot,',
          '} from "@simplex-viz/canvas";',
          'import {',
          '  SimplexTopicGraph,',
          '  ReactJsxSvgView,',
          '  useSimplexGraphController,',
          '  solveSimplexSnapshot as reactSolveSnapshot,',
          '} from "@simplex-viz/react";',
          'import {',
          '  SimplexTopicGraphElement,',
          '  defineSimplexTopicGraphElement,',
          '  solveSimplexSnapshot as wcSolveSnapshot,',
          '} from "@simplex-viz/wc";',
          'import { DEFAULT_SIMPLEX_TAG_NAME } from "@simplex-viz/wc/define";',
          '',
          'type IsAny<T> = 0 extends 1 & T ? true : false;',
          'type AssertFalse<T extends false> = T;',
          '',
          'const items = [{ id: "a", tags: ["geometry", "math"] }] as const;',
          'const coreSnap = solveSimplexSnapshot(items);',
          'const workerClient: SimplexWorkerClient = createSimplexWorkerClient(null);',
          'const asyncSnapPromise = solveSimplexSnapshotAsync(items, { client: workerClient });',
          'const svgSnap = svgSolveSnapshot(items);',
          'const canvasSnap = canvasSolveSnapshot(items);',
          'const reactSnap = reactSolveSnapshot(items);',
          'const wcSnap = wcSolveSnapshot(items);',
          'const ssrSvg = renderSimplexSvgString(items, { preset: "badges" });',
          '',
          'export type CheckCoreNotAny = AssertFalse<IsAny<typeof coreSnap>>;',
          'export type CheckWorkerPromiseNotAny = AssertFalse<IsAny<typeof asyncSnapPromise>>;',
          'export type CheckSvgReExportNotAny = AssertFalse<IsAny<typeof svgSnap>>;',
          'export type CheckCanvasReExportNotAny = AssertFalse<IsAny<typeof canvasSnap>>;',
          'export type CheckReactReExportNotAny = AssertFalse<IsAny<typeof reactSnap>>;',
          'export type CheckWcReExportNotAny = AssertFalse<IsAny<typeof wcSnap>>;',
          'export type CheckSsrReturnString = AssertFalse<IsAny<typeof ssrSvg>>;',
          'export const checkSnapshotAssignable: SimplexLayoutSnapshot<(typeof items)[number]> = reactSnap;',
          'export const exportedSymbols = [SIMPLEX_WORKER_PROTOCOL_VERSION, attachSimplexWorkerHandler, createSimplexWorkerClient, solveSimplexSnapshotAsync, createSimplexSvg, createSimplexCanvas, CanvasRendererAdapter, renderSimplexSnapshotToCanvas, renderSimplexSvgString, estimateSsrTextWidth, SimplexTopicGraph, ReactJsxSvgView, useSimplexGraphController, SimplexTopicGraphElement, defineSimplexTopicGraphElement, DEFAULT_SIMPLEX_TAG_NAME] as const;',
          '',
        ].join('\n');
        fs.writeFileSync(path.join(tmpDir, 'repro.mts'), reproSource);

        const tscBin = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

        // 1. Exact reproduction from Issue #2 (skipLibCheck: true)
        execFileSync(process.execPath, [tscBin, '-p', tsconfigPath], {
          cwd: tmpDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });

        // 2. Full declaration check across all emitted .d.ts files (skipLibCheck: false)
        execFileSync(
          process.execPath,
          [tscBin, '-p', tsconfigPath, '--skipLibCheck', 'false'],
          {
            cwd: tmpDir,
            encoding: 'utf8',
            stdio: 'pipe',
          },
        );

        const coreDts = fs.readFileSync(
          path.join(REPO_ROOT, 'packages/core/dist/index.d.ts'),
          'utf8',
        );
        const svgDts = fs.readFileSync(
          path.join(REPO_ROOT, 'packages/svg/dist/index.d.ts'),
          'utf8',
        );
        const canvasDts = fs.readFileSync(
          path.join(REPO_ROOT, 'packages/canvas/dist/index.d.ts'),
          'utf8',
        );
        const reactDts = fs.readFileSync(
          path.join(REPO_ROOT, 'packages/react/dist/index.d.ts'),
          'utf8',
        );
        const wcDts = fs.readFileSync(
          path.join(REPO_ROOT, 'packages/wc/dist/index.d.ts'),
          'utf8',
        );
        expect(coreDts).toContain('./types.js');
        expect(svgDts).toContain('./SimplexSvgController.js');
        expect(canvasDts).toContain('./SimplexCanvasController.js');
        expect(reactDts).toContain('./SimplexTopicGraph.js');
        expect(wcDts).toContain('./SimplexTopicGraphElement.js');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
