<p align="center">
  <img src="https://raw.githubusercontent.com/ghackenberg/simplex-viz/main/docs/assets/logo-core.png" width="525" alt="SimplexViz / core — @simplex-viz/core" />
</p>

# @simplex-viz/core

Headless, zero-dependency TypeScript engine for triangulation-based visualization of arbitrary domain collections—single/multi-modal vector embeddings, pairwise similarities, or tagged content—on a dynamic 60° equilateral simplex mesh.

- **Live Demo:** <https://hackenberg.tech/simplex-viz/>
- **Source & Monorepo:** <https://github.com/ghackenberg/simplex-viz/tree/main/packages/core>
- **Companion Packages:** [`@simplex-viz/svg`](https://www.npmjs.com/package/@simplex-viz/svg) · [`@simplex-viz/react`](https://www.npmjs.com/package/@simplex-viz/react)

> Most browser apps should start with [`@simplex-viz/react`](https://www.npmjs.com/package/@simplex-viz/react) (for React) or [`@simplex-viz/svg`](https://www.npmjs.com/package/@simplex-viz/svg) (for Vanilla TypeScript, Vue, Angular, Svelte, or Web Components). Use `@simplex-viz/core` directly when building a custom Canvas/WebGL renderer, running layout calculations in a Web Worker or Node.js, or using low-level geometry, OKLab, and clustering primitives.

## Spatial Pipeline Overview

Before diving into the TypeScript API, the schematic diagram below traces a single tagged corpus through the engine's internal coordinate system—from raw lattice cells to final collision envelopes:

<p align="center">
  <img src="https://raw.githubusercontent.com/ghackenberg/simplex-viz/main/docs/assets/preview-core.png" width="100%" alt="Schematic diagram of the @simplex-viz/core 60-degree simplex mesh, vertex coordinates, barycentric OKLab weights, and convex SAT collision bounds" />
</p>

*Figure: Schematic geometry view of the headless `@simplex-viz/core` pipeline. Dashed blueprint lines mark the adaptive 60° equilateral triangle lattice (`s = 207 px`) anchored at grid coordinates `V0`–`V7` (`row, col`), with each cluster displaying its top core tags and dashed `clusterGapPx` clearance envelope. The highlighted amber tethers (`w = 0.50`) illustrate how the explaining-away step computes barycentric weights along a shared simplex edge to blend perceptual OKLab colors, while solid circular and rounded-rectangle outlines show exact `ConvexGeometry` bounds separated by the SAT/MTV solver (`overlapCount = 0`).*

## Key Capabilities

- **Zero dependencies & zero DOM**: Compiled strictly against `lib: ["ES2022"]` with `"dependencies": {}`. Runs identically in browsers, Node.js, Deno, Bun, Web Workers, and Edge runtimes.
- **Representation-agnostic & end-to-end type safe**: Works with arbitrary `<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>` via conditional hybrid accessors (`StrategyItemIdentityConfig<TItem, TTagMeta>`). Passing a non-tag `clusteringStrategy` (embeddings, pairwise similarity, or custom) makes `getTags` completely optional; using the default tag path enforces `getTags` only when `TItem` lacks `tags`.
- **Pluggable 4-stage pipeline**: Swap algorithms cleanly at construction or runtime via `SimplexMeshStrategy`, `SimplexClusteringStrategy` (`requiresTags`, `initialize`, incremental `update`), `SimplexColorStrategy`, and `SimplexLayoutStrategy`.
- **Embeddings, similarities & tag specialization**:
  - **Multi-modal embeddings** (`createEmbeddingClusteringStrategy`): Single or weighted multi-source feature vectors, k-Means++ / Spherical k-Means, QAP mesh embedding, Hungarian cluster UID stability, and closed-form NNLS barycentric planar simplex projection (`'simplex-projection'`, `'explaining-away'`, `'top-1'`).
  - **Pairwise similarities** (`createSimilarityClusteringStrategy`): PAM k-Medoids + QAP mesh embedding + simplex projection for arbitrary `(a, b) => [0, 1]` kernels.
  - **Tag clustering specialization** (`createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`): Regularized Jaccard partitioning, Simulated Annealing QAP, Weighted Hitting-Set planar completion, and backward tag pruning.
- **Perceptual OKLab palette & mixing**: Edge-contrast-optimized cluster colors (static dark-tuned, theme-adaptive dark/light, or custom hex palettes) and chroma-preserving barycentric OKLab blending.
- **Guaranteed 0.0 px overlap**: Hierarchical two-phase convex hull solver (`solveTwoPhaseLayout`, optional warm-starting, and `solveLocalAdaptiveLayout`) combining Separating Axis Theorem (SAT), circle-polygon Minimum Translation Vectors (MTV), uniform spatial hash grids, and binary scale search.
- **Interruptible C1-continuous animation**: Critically damped scalar springs and retargetable dual-layer transition state machines.
- **Mathematical hit-testing**: Resolution-independent convex-hull and barycentric triangle-face pointer hit-testing (`isPointInTriangle`) in world coordinates, with cluster and triangle focus isolation.

## Installation

Install the headless package standalone when integrating into a custom Canvas/WebGL renderer, worker thread, or Node.js process:

```bash
npm install @simplex-viz/core
```

## Quickstart: One-Shot Layout with `solveSimplexSnapshot`

If you want solved `(x, y)` coordinates, mesh triangles, topic clusters, and perceptual OKLab colors in a single synchronous call—without setting up a `SimplexRendererAdapter` or animation loop—call `solveSimplexSnapshot(items)`:

```ts
import { solveSimplexSnapshot } from '@simplex-viz/core';

const snapshot = solveSimplexSnapshot([
  { id: 'mesh', tags: ['geometry', 'triangulation', 'math'] },
  { id: 'oklab', tags: ['color', 'perception', 'geometry'] },
  { id: 'sat', tags: ['collision', 'geometry'] },
]);

console.log(snapshot.metrics.overlapCount); // 0
console.log(snapshot.clusters); // Solved vertex clusters + OKLab hex colors
console.log(snapshot.items); // Non-overlapping content coordinates & weights
```

For custom domain records that do not use `{ id, tags }`, supply `getId`, `getTags`, canvas dimensions, or custom hull callbacks in the second argument:

```ts
import { solveSimplexSnapshot, rectToConvexPolygon } from '@simplex-viz/core';

interface Paper {
  readonly doi: string;
  readonly keywords: readonly string[];
  readonly title: string;
}

const snapshot = solveSimplexSnapshot(papers, {
  getId: (p) => p.doi,
  getTags: (p) => p.keywords,
  width: 1200,
  height: 760,
  measureContentHull: (p) => rectToConvexPolygon(p.title.length * 7 + 16, 24, 6),
});
```

### Quickstart Without Tags (Single or Multi-Modal Embeddings)

Pass arbitrary objects without any `tags` property alongside `createEmbeddingClusteringStrategy` or `createSimilarityClusteringStrategy`:

```ts
import {
  solveSimplexSnapshot,
  createEmbeddingClusteringStrategy,
} from '@simplex-viz/core';

interface AudioSample {
  readonly id: string;
  readonly timbreVec: readonly number[];
  readonly prosodyVec: readonly number[];
}

const snapshot = solveSimplexSnapshot(samples as readonly AudioSample[], {
  clusteringStrategy: createEmbeddingClusteringStrategy<AudioSample>({
    getEmbedding: [
      { name: 'Timbre', getVector: (s) => s.timbreVec, weight: 0.75 },
      { name: 'Prosody', getVector: (s) => s.prosodyVec, weight: 0.25 },
    ],
    metric: 'cosine',
    anchorRule: 'simplex-projection',
  }),
});
```

## Full Engine Control: Using `SimplexGraphEngine` Step by Step

When building an interactive Canvas/WebGL surface with live mutations, hit-testing, camera pan/zoom, and 60 fps critically damped springs, use `SimplexGraphEngine` across the five steps below.

### Step 1 — Define Domain & Visual Descriptor Types

SimplexViz imposes no fixed schema on your data. Start by defining your domain record (`Article`), optional cluster metadata (`TopicStats`), and serializable visual descriptor types (`ArticleVisual`, `TopicVisual`) that represent what your renderer needs to draw:

```ts
import {
  SimplexGraphEngine,
  rectToConvexPolygon,
  type SimplexRendererAdapter,
  type VisualResolver,
  type SceneFrameSnapshot,
} from '@simplex-viz/core';

interface Article {
  readonly slug: string;
  readonly title: string;
  readonly hashtags: readonly string[];
  readonly readingMinutes: number;
}

interface ArticleVisual {
  readonly kind: 'circle' | 'pill';
  readonly radius: number;
  readonly colorHex: string;
  readonly label: string;
}

interface TopicVisual {
  readonly code: string;
  readonly title: string;
  readonly colorHex: string;
  readonly memberCount: number;
}

interface TopicStats {
  readonly count: number;
  readonly avgMinutes: number;
}
```

### Step 2 — Map Records to Visuals via `VisualResolver`

Next, implement a `VisualResolver`. Notice how `resolveContentVisual` receives `ctx.mixedColorHex`—already blended in perceptual OKLab space along the item's active simplex weights—and `getVisualCacheKey` tells the engine when a node's geometry needs to be re-measured:

```ts
const visualResolver: VisualResolver<
  Article,
  ArticleVisual,
  TopicVisual,
  undefined,
  TopicStats
> = {
  resolveContentVisual: (item, ctx) => ({
    kind: item.readingMinutes > 10 ? 'pill' : 'circle',
    radius: 10,
    colorHex: ctx.mixedColorHex,
    label: item.title,
  }),
  resolveClusterVisual: (cluster) => ({
    code: cluster.code,
    title: cluster.defaultLabel,
    colorHex: cluster.colorHex,
    memberCount: cluster.meta.count,
  }),
  getVisualCacheKey: (v) =>
    'kind' in v
      ? `${v.kind}:${v.colorHex}:${v.label}`
      : `${v.code}:${v.memberCount}`,
};
```

### Step 3 — Implement a Custom `SimplexRendererAdapter`

The engine asks your renderer adapter for centered convex bounding shapes (`measureContentHull` and `measureClusterHull`) so the SAT solver can guarantee `0.0 px` overlap, then calls `renderFrame(snapshot)` with solved coordinates, camera state, and interpolation weights:

```ts
const myRenderer: SimplexRendererAdapter<ArticleVisual, TopicVisual> = {
  measureContentHull(visual) {
    return visual.kind === 'circle'
      ? { kind: 'circle', radius: visual.radius }
      : rectToConvexPolygon(visual.label.length * 7 + 16, 24, 6);
  },
  measureClusterHull() {
    return { kind: 'circle', radius: 24 };
  },
  renderFrame(snapshot: SceneFrameSnapshot<ArticleVisual, TopicVisual>) {
    // Draw snapshot.triangles (with clusters, coveredItemCount, interiorItemCount,
    // interaction.isHovered / isFocused / isDimmed), snapshot.edges (with mixedColorHex,
    // clusters, isHighlighted), snapshot.clusters, and snapshot.items
    // using snapshot.camera ({ zoom, panX, panY })
  },
  destroy() {
    // Release Canvas/WebGL resources
  },
};
```

### Step 4 — Instantiate `SimplexGraphEngine`

Wire your items, accessors (`getId`, `getTags`, `deriveClusterMeta`), resolver, and renderer into `SimplexGraphEngine`. Because `Article` uses `slug` and `hashtags` rather than `{ id, tags }`, TypeScript verifies at compile time that both accessors are provided:

```ts
const engine = new SimplexGraphEngine<
  Article,
  ArticleVisual,
  TopicVisual,
  undefined,
  TopicStats
>({
  items: myArticles,
  getId: (a) => a.slug,
  getTags: (a) => a.hashtags,
  deriveClusterMeta: (ctx) => ({
    count: ctx.members.length,
    avgMinutes:
      ctx.members.reduce((sum, m) => sum + m.item.readingMinutes, 0) /
      Math.max(1, ctx.members.length),
  }),
  visualResolver,
  renderer: myRenderer,
  viewportWidth: 1200,
  viewportHeight: 800,
  meshOptions: { innerPadding: 48, minSideLength: 140, maxSideLength: 280, maxClusters: 12 },
  layoutOptions: { clusterGapPx: 14, itemGapPx: 5, seed: 42 },
  onMetricsChange: (metrics) => {
    console.log('Overlap count:', metrics.overlapCount); // Always 0 when settled
  },
});
```

### Step 5 — Drive the Spring Simulation Loop

Call `engine.step(dtMs)` on each animation frame (or in fixed steps inside a Worker/test). Once all critically damped springs settle, `step` returns `true` so your loop can idle until the next interaction or mutation:

```ts
function tick(dtMs: number) {
  const settled = engine.step(dtMs);
  if (!settled) {
    requestAnimationFrame(() => tick(16.67));
  }
}
```

### Live Mutations & Interactions

Once running, `SimplexGraphEngine` supports live dataset updates, viewport resizing, and global node scaling—retargeting active springs smoothly mid-flight:

```ts
engine.addItems({
  slug: 'sat-primer',
  title: 'Separating Axis Theorem',
  hashtags: ['geometry', 'collision'],
  readingMinutes: 8,
});
engine.removeItems('old-slug');
engine.setItems(nextArticles);
engine.setViewport(1440, 900);
engine.setSizeMultiplier(1.25);
engine.setShowHulls(true);
```

To highlight items, isolate a topic cluster, or handle user input in a Canvas/WebGL surface, pass focus IDs and normalized screen coordinates directly to the engine and camera controller:

```ts
// Focus & highlight states
engine.setPinnedIds(['sat-primer']);
engine.setFocusedClusterUid(engine.getClusters()[0]?.clusterUid ?? null);
engine.setFocusedTriangleIndex(0);

// Forward normalized pointer & wheel events from your surface
engine.handlePointerMove(screenX, screenY); // Emits onContentHover, onClusterHover, onTriangleHover
engine.handleLeftClick({
  screenX,
  screenY,
  button: 0,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
});
engine.camera.zoomToCursor(screenX, screenY, 1.15);
```

## Pluggable Core Strategies

Every algorithmic phase of `SimplexGraphEngine` and `solveSimplexSnapshot` is backed by a minimal typed strategy interface. All four default to zero-config implementations and can be replaced independently at construction time or hot-swapped at runtime (`setMeshStrategy`, `setClusteringStrategy`, `setColorStrategy`, `setLayoutStrategy`, `setTheme`).

### 1. `SimplexMeshStrategy` (Triangulation & Lattice Sizing)

- `createAdaptiveHexMeshStrategy(defaults?)` *(default)* — Automatically chooses `horizontal` / `vertical` orientation and `wideFirst` parity via `buildSimplexMesh`.
- `createFixedLatticeMeshStrategy({ cols, rows, orientation?, wideFirst?, innerPadding? })` — Pins an exact `(cols × rows)` 60° equilateral lattice (fixed cluster count `K = cols * rows`) across resizes.

### 2. `SimplexClusteringStrategy` (Embeddings, Similarities & Tag Specialization)

Clustering strategies declare `requiresTags?: boolean` (defaults to `true` for backward-compatible tag strategies, `false` for vector/similarity/custom spaces) and support distinct `initialize(ctx)` and optional `update(ctx)` hooks:

- **Vector Embeddings (`requiresTags: false`)**:
  - `createEmbeddingClusteringStrategy({ getEmbedding, metric?, anchorRule?, deriveLabel? })` — Clusters untagged objects from a single vector or weighted multi-modal feature vectors (`EmbeddingSource[]`) via k-Means++ / Spherical k-Means, embeds centroids onto the 60° mesh via QAP Simulated Annealing, preserves cluster UIDs across updates via Hungarian centroid + membership matching, and computes planar barycentric weights (`'simplex-projection'` NNLS on mesh triangles/edges, `'explaining-away'`, or `'top-1'`).
- **Pairwise Similarity (`requiresTags: false`)**:
  - `createSimilarityClusteringStrategy({ getSimilarity, anchorRule?, deriveLabel? })` — Clusters any untagged domain object from a symmetric `(a, b) => [0, 1]` similarity function using PAM k-Medoids, QAP mesh embedding, and planar simplex projection.
- **Tag Specialization (Default)**:
  - `createJaccardAnnealingClusteringStrategy({ getTags?, sharedTagRule?, anchorRule? })` *(default)* — Full Jaccard tag partitioning + Simulated Annealing QAP vertex embedding + Hungarian identity matching on every update.
  - `createIncrementalAnchorClusteringStrategy({ getTags?, sharedTagRule?, anchorRule? })` — Runs full Jaccard + SA QAP on `initialize`, then on `update` preserves existing vertex topics/UIDs/colors spatially, incrementally attaches newly seen tags to the best-matching cluster, and prunes vanished tags.
  - **`sharedTagRule`** (`SharedTagRule<TItem>`): `'planar-hitting-set'` *(default)*, `'none'`, or custom expansion function.
  - **`anchorRule`** (`SimplexAnchorRule<TItem>`): `'explaining-away'` *(default)*, `'raw-overlap'`, `'barycentric-all'`, or custom anchor function.

### 3. `SimplexColorStrategy` (Cluster Colors & Item Mixing)

- `createOklabContrastColorStrategy()` *(default)* — Optimizes perceptual OKLab edge contrast across adjacent mesh vertices and mixes item colors barycentrically in OKLab.
- `createThemeAdaptiveOklabColorStrategy()` — Dynamically adapts lightness & chroma contrast targets for `'dark'` vs. `'light'` canvases (`engine.setTheme(theme)`).
- `createPaletteColorStrategy(hexColors, { mode?: 'edge-contrast' | 'sequential', preserveMatchedColors? })` — Assigns colors from your curated hex palette along mesh edges (maximizing OKLab contrast) or sequentially.

### 4. `SimplexLayoutStrategy` (Positioning, Scaling & Overlap Resolution)

- `createPbdUniformLayoutStrategy()` *(default)* — Deterministic phyllotaxis tie-breaking + uniform global scale binary search + PBD convex relaxation + hard-separation polish (`0.0 px` overlap).
- `createWarmStartPbdLayoutStrategy()` — Seeds updates from each item's previous solved `(x, y)` coordinates to minimize spatial jumps during mutations (`0.0 px` overlap).
- `createLocalAdaptiveLayoutStrategy({ crowdRadiusPx?, minLocalScale?, warmStart? })` — Shrinks content items primarily around locally crowded simplex anchors so sparse areas preserve full `1.0` scale legibility (`0.0 px` overlap).

### Example: Passing & Swapping Strategies at Runtime

```ts
import {
  solveSimplexSnapshot,
  createFixedLatticeMeshStrategy,
  createIncrementalAnchorClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createLocalAdaptiveLayoutStrategy,
} from '@simplex-viz/core';

const snapshot = solveSimplexSnapshot(items, {
  width: 1200,
  height: 760,
  theme: 'light',
  meshStrategy: createFixedLatticeMeshStrategy({ cols: 3, rows: 3 }),
  clusteringStrategy: createIncrementalAnchorClusteringStrategy({
    sharedTagRule: 'planar-hitting-set',
    anchorRule: 'barycentric-all',
  }),
  colorStrategy: createThemeAdaptiveOklabColorStrategy(),
  layoutStrategy: createLocalAdaptiveLayoutStrategy({ warmStart: true }),
});

// Or swap any strategy dynamically on a running SimplexGraphEngine:
engine.setTheme('light');
engine.setColorStrategy(createThemeAdaptiveOklabColorStrategy());
engine.setLayoutStrategy(createLocalAdaptiveLayoutStrategy({ crowdRadiusPx: 72 }));
engine.setMeshStrategy(createFixedLatticeMeshStrategy({ cols: 4, rows: 3 }));
engine.setClusteringStrategy(createIncrementalAnchorClusteringStrategy());
```

## Configuration Reference

### `StrategyItemIdentityConfig<TItem, TTagMeta>` & `ClusterMetaConfig`

- If `TItem` has `{ readonly id: string }`, `getId` is optional; otherwise TypeScript requires `getId`.
- If a custom `clusteringStrategy` is passed (e.g., `createEmbeddingClusteringStrategy`, `createSimilarityClusteringStrategy`, or strategy-scoped `getTags`), `getTags` is optional even when `TItem` has no `tags` field.
- If `clusteringStrategy` is omitted and `TItem` lacks `tags`, TypeScript requires `getTags`.
- If `TClusterMeta` is `undefined` (default), `deriveClusterMeta` is optional. When a custom `TClusterMeta` type is supplied, `deriveClusterMeta(ctx)` becomes compile-time required and receives `representativeItems`, `centroid`, `cohesion`, and `featureSummary` alongside `members`, `coreTags`, and `sharedTags`.

### `MeshOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `innerPadding` | `number` | `48` | Padding around the usable simplex lattice in pixels. |
| `minSideLength` | `number` | `140` | Minimum preferred equilateral triangle edge length in pixels. |
| `maxSideLength` | `number` | `280` | Maximum preferred equilateral triangle edge length in pixels. |
| `maxClusters` | `number` | `12` | Upper bound on cluster vertices `K`. |

### `LayoutSolverOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `clusterGapPx` | `number` | `14` | Minimum guaranteed clearance between cluster hulls (px). |
| `itemGapPx` | `number` | `5` | Minimum guaranteed clearance between content items and clusters (px). |
| `minContentScale` | `number` | `0.2` | Lower bound for the binary search over content scale factor `α_content`. |
| `relaxationIterations` | `number` | `36` | Maximum PBD/MTV relaxation iterations per binary search probe. |
| `sizeMultiplier` | `number` | `1.0` | Uniform scale multiplier applied before solving. |
| `seed` | `number` | `undefined` | Optional deterministic PRNG seed for reproducible QAP embedding and tie-breaking. |

## Low-Level Pure Utilities

Every algorithmic building block can also be imported standalone:

- **Mesh**: `buildSimplexMesh(width, height, clusterCount, options)`, `buildSimplexLattice(...)`
- **Clustering**: `computeSimplexClustering(...)`, `embedSimilarityMatrixOnMesh(...)`, `extractIdentifiedItems(...)`, `analyzeTagCorpus(...)`, `partitionTagsJaccard(...)`, `computeMeshHopDistances(...)`, `embedClustersQapAnnealing(...)`, `completePlanarSharedTags(...)`, `matchClustersHungarian(...)`, `assignItemsToSimplexUnits(...)`, `extractNormalizedItems(...)`, `defaultNormalizeTag(...)`
- **Layout Solver**: `solveTwoPhaseLayout(...)`, `solveLocalAdaptiveLayout(...)`, `solveClusterPhase(...)`, `buildPhyllotaxisStarts(...)`, `runPerItemPbdRelaxation(...)`
- **Geometry & Collision**: `computeConvexHull`, `rectToConvexPolygon`, `regularPolygon`, `starConvexHull`, `isPointInTriangle`, `computeConvexMtv`, `computeCirclePolygonMtv`, `hitTestConvexGeometry`, `UniformSpatialHashGrid`
- **Color Science**: `hexToOklab`, `oklabToHex`, `mixOklabColors`, `lerpOklabHex`, `generatePerceptualClusterPalette`, `buildDistinctOklabPalette`, `assignMeshClusterColors`, `assignGreedyEdgeContrastColors`
- **Animation & Camera**: `stepCriticallyDampedSpring`, `retargetVisualTransition`, `stepVisualTransition`, `SimplexCamera`

## License

MIT — see [LICENSE](https://github.com/ghackenberg/simplex-viz/blob/main/LICENSE).
