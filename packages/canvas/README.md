# @simplex-viz/canvas

High-capacity, framework-agnostic **HTML5 Canvas 2D** renderer for [`@simplex-viz/core`](https://www.npmjs.com/package/@simplex-viz/core), built to sustain smooth **60 FPS** interaction on **2,000–10,000+ item** corpora where SVG DOM node overhead becomes a bottleneck.

- **Live Demo:** <https://hackenberg.tech/simplex-viz/>
- **Source & Monorepo:** <https://github.com/ghackenberg/simplex-viz/tree/main/packages/canvas>
- **Companion Packages:** [`@simplex-viz/core`](https://www.npmjs.com/package/@simplex-viz/core) · [`@simplex-viz/svg`](https://www.npmjs.com/package/@simplex-viz/svg) · [`@simplex-viz/react`](https://www.npmjs.com/package/@simplex-viz/react) · [`@simplex-viz/wc`](https://www.npmjs.com/package/@simplex-viz/wc)

## Why `@simplex-viz/canvas`?

- **Zero per-node DOM overhead**: Renders triangles, internal `1:4` drillable previews, lattice edges, cluster badges/anchors, content nodes, multi-selection rings, marquee overlays, and WCAG focus halos onto a single HiDPI `<canvas>`.
- **Frustum culling & automatic LOD**: World-space viewport culling skips off-screen items/triangles/edges before draw calls, and `lodThresholdPx` automatically collapses sub-pixel polygons to fast zero-allocation circles when zoomed out.
- **Full `@simplex-viz/core` API parity**: Uses the exact same `SimplexGraphEngine`, `SimplexLayoutSnapshot`, hit-testing, `1:4` hierarchical zoom (`createBarycentricZoomStrategy`, `createSemanticZoomStrategy`, `createSubspaceZoomStrategy`), `SimplexTimelineController`, `getLegendModel()`, `setItemFilter()`, `Shift+Click`/`Shift+Drag` multi-selection, `getViewState()`/`restoreViewState()`, and WCAG 2.1 AA keyboard navigation.
- **Pairs with `@simplex-viz/core/worker`**: Render snapshots solved off the main thread directly via `renderSimplexSnapshotToCanvas(canvas, snapshot)`.

## Installation

```bash
npm install @simplex-viz/canvas
```

## Quickstart: Interactive Canvas Controller

```ts
import {
  createSimplexCanvas,
  createSubspaceZoomStrategy,
  createCollisionDrivenLayoutStrategy,
} from '@simplex-viz/canvas';

const controller = createSimplexCanvas('#atlas', {
  items: largeCorpus, // 2,000–10,000+ records
  preset: 'badges',
  theme: 'dark',
  layoutStrategy: createCollisionDrivenLayoutStrategy(),
  zoomStrategy: createSubspaceZoomStrategy(),
  tooltip: true,
});

// Native zero-serialization PNG export:
const pngBlob = await controller.exportPng({ scale: 2 });
```

## One-Shot Off-Thread Snapshot Rendering (`@simplex-viz/core/worker`)

```ts
import { createSimplexWorkerClient } from '@simplex-viz/core/worker';
import { renderSimplexSnapshotToCanvas } from '@simplex-viz/canvas';

const worker = createSimplexWorkerClient(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
);

const { snapshot } = await worker.solve(records, { width: 1200, height: 760 });
renderSimplexSnapshotToCanvas(canvasEl, snapshot, { theme: 'dark' });
```

## License

MIT — see [LICENSE](https://github.com/ghackenberg/simplex-viz/blob/main/LICENSE).
