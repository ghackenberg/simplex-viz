# @simplex-viz/core

## 0.9.0

### Minor Changes

- Add `deferInitialSolve` engine option and `engine.reinitializeViewport(width, height)` for clean `0×0` container mount recovery with zero spring jump and zero provisional solve overhead (#12).

## 0.8.0

### Minor Changes

- Add zero-DOM chronological timeline controller (`SimplexTimelineController`, `createSimplexTimeline`, #8), add `createFinalSeededClusteringStrategy` (#5) and `createFinalSeededLayoutStrategy` (`scaleMode: 'pinned' | 'adaptive'`, `unseenItemPolicy: 'fallback' | 'reseed'`, `canonicalSeedItems`, #8) for path-independent chronological replay, add configurable `emptyClusterBehavior` (`'normal' | 'dim' | 'hide'`, `getEmptyClusterBehavior()`, `setEmptyClusterBehavior()`, #8), thread explicit `PipelineUpdateReason` and viewport dimensions into `estimateClusterCount` and `ClusteringStrategyContext` (#6), add `formatTagLabel` / `resolveTagDisplayLabel` to decouple canonical tag IDs from display labels (#7), standardize composable target-specific click/hover/wheel return-`true` consumption (#3), and add `engine.relayout()` (#9).

## 0.7.0

### Minor Changes

- Fix ESM `Node16`/`NodeNext` `.d.ts` resolution with explicit `.js` extensions on all relative imports/exports and `"moduleResolution": "NodeNext"` build checks (#2), add `createSubspaceZoomStrategy` for representation-agnostic `6`-vertex local subspace refinement, add discriminative cluster labeling helpers (`assignDiscriminativeClusterLabels`, `resolveDiscriminativeClusterLabel`, `disambiguatePeerClusterTitle`, `parentContextLabel`), standardize 1-ring `'incident-star'` cluster/subcluster drill-down with barycentric simplex-distance dimming, support single-triangle leaf focus (`'triangle-focus'`, `leafTriangleFocus: true`) with directly clickable content items, upgrade `buildSimplexMesh` / `createAdaptiveHexMeshStrategy` to aspect-aligned full-canvas triangulation (`resolveDefaultInnerPadding`, `minSideLength: 130`, `maxClusters: 14`), upgrade space-filling PBD layout presets, and remove automatic nearest-neighbor emphasis on content selection.

## 0.6.0

### Minor Changes

- Add pluggable 5th pipeline stage (`SimplexZoomStrategy`: `createBarycentricZoomStrategy` for conformal `1:4` triangle & `1`-ring cluster drill-down with neighborhood context, multi-level leaf-neighbor zoom-out, `highlightBoundary` / `isHighlighted`, content pass-through on drillable triangles, and blocked wheel scroll; `createSemanticZoomStrategy` for 6-vertex tag re-partitioning; `createFreeCameraZoomStrategy`), add `createSoftSimplexTagClusteringStrategy` and `createSoftSimplexEmbeddingClusteringStrategy`, introduce composable layout building blocks (`solveComposedLayout`, `createComposedLayoutStrategy`, `createCollisionDrivenLayoutStrategy`, `LayoutSeeder`, `PositionRelaxer`, `ScaleController`) with triangle containment, and support explicit `MeshOptions.sideLength` plus `'primary' | 'intermediate'` cluster roles.

## 0.5.0

### Minor Changes

- Generalize clustering beyond `{ id, tags }`: tag-based Jaccard + Hitting-Set clustering is now an out-of-the-box specialization (`requiresTags !== false`, `StrategyItemIdentityConfig`), while `createEmbeddingClusteringStrategy` (single/multi-modal vector embeddings, k-Means++ / Spherical k-Means, QAP mesh embedding, closed-form NNLS barycentric simplex projection) and `createSimilarityClusteringStrategy` (PAM k-Medoids + QAP mesh embedding) support arbitrary untagged domain objects cleanly.

## 0.4.0

### Minor Changes

- Add barycentric triangle-face hit-testing (`isPointInTriangle`, `HitTarget` `kind: 'triangle'`), `onTriangleHover`, `setFocusedTriangleIndex`, and enriched `MeshTriangleRenderState` / `MeshEdgeRenderState` snapshots.

## 0.3.0

### Minor Changes

- Make all four spatial pipeline stages pluggable and hot-swappable (`SimplexMeshStrategy`, `SimplexClusteringStrategy` with `initialize`/`update` plus configurable `sharedTagRule` and `anchorRule`, `SimplexColorStrategy`, and `SimplexLayoutStrategy`), add built-in strategy factories (`createAdaptiveHexMeshStrategy`, `createFixedLatticeMeshStrategy`, `createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`, `createOklabContrastColorStrategy`, `createThemeAdaptiveOklabColorStrategy`, `createPaletteColorStrategy`, `createPbdUniformLayoutStrategy`, `createWarmStartPbdLayoutStrategy`, `createLocalAdaptiveLayoutStrategy`), and document all strategies.

## 0.2.1

### Patch Changes

- Redesign package logos and README preview graphics with transparent dual-theme (Light & Dark mode) contrast, unified brand triangle vertex colors, and automated PNG asset synchronization.

## 0.2.0

### Minor Changes

- Add zero-config stateless `solveSimplexSnapshot(items, options?)` helper for synchronous one-shot layouts without a renderer adapter or animation loop, and update README to a Quickstart-first structure.

## 0.1.3

### Patch Changes

- Add project brand logo and schematic preview graphics, contextual lead-in prose, and step-by-step code walkthroughs in `@simplex-viz/core` README.

## 0.1.2

### Patch Changes

- Expand `@simplex-viz/core` README with complete headless quickstart examples, `MeshOptions` & `LayoutSolverOptions` configuration tables, and standalone utility API documentation.

## 0.1.1

### Patch Changes

- f443ebd: Update npm `homepage` links to point to the live interactive GitHub Pages demo, add `bugs` repository links, and replace LaTeX math notation in `@simplex-viz/core` README with plain Unicode for clean rendering on npmjs.org.
