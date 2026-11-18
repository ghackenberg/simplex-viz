# Changelog

All notable changes to **SimplexViz** (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`, and the documentation/showcase site) are documented in this file following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), coordinated with per-package release notes via `@changesets/cli`.

## [0.7.0] - 2026-11-18

### Fixed
- **`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react` — ESM `Node16` / `NodeNext` `.d.ts` module resolution ([#2](https://github.com/ghackenberg/simplex-viz/issues/2))**:
  - Added explicit `.js` file extensions to all relative imports and `export *` re-exports across all three packages so published `.d.ts` declarations resolve cleanly under TypeScript `moduleResolution: "node16"` and `"nodenext"` without degrading cross-package re-exports to `any`.
  - Enforced `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in each package's `tsconfig.build.json` to catch extensionless relative specifiers at build time.
  - Added an automated Vitest integration test (`nodenextResolution.test.ts`) verifying `nodenext` typechecking with both `skipLibCheck: true` and `skipLibCheck: false`.
- **`@simplex-viz/core` — Content-node selection clarity**:
  - Removed automatic nearest-neighbor emphasis when selecting a content item so individual node inspection remains visually clean.

### Added / Changed
- **`@simplex-viz/core`**:
  - **Subspace Zoom & Discriminative Cluster Labeling**: Added `createSubspaceZoomStrategy` for representation-agnostic `6`-vertex local subspace refinement across embeddings, pairwise similarity kernels, and tags (`minItemsForRecluster: 6`, `blendFactor: 0.35`), alongside `assignDiscriminativeClusterLabels`, `resolveDiscriminativeClusterLabel`, `disambiguatePeerClusterTitle`, and `parentContextLabel` breadcrumb/corner context.
  - **Single-Triangle Leaf Focus (`'triangle-focus'`, `leafTriangleFocus: true`)**: Non-subdividable leaf triangles remain focusable as single triangles (`focusableTriangleIndices`, `activeFrameKind: 'triangle-focus'`) via their open triangle background while keeping covered content items directly clickable (no pointer pass-through on leaf triangles) and toggling back up on repeat background clicks.
  - **Uniform 1-Ring `'incident-star'` Cluster & Subcluster Drill-Down**: Standardized both primary and intermediate cluster focus on lattice-conformal 1-ring `'incident-star'` meshes with continuous barycentric simplex-distance item dimming (`opacity = 0.32 + 0.68 · w̃₀`), direct lateral rim switching, and toggle-up when re-clicking the centered cluster.
  - **Aspect-Aligned Full-Canvas Triangulation**: Updated `buildSimplexMesh` and `createAdaptiveHexMeshStrategy` to align `60°` lattice orientation to the viewport aspect ratio across mobile, standard, and widescreen canvases (`minSideLength: 130`, uncapped `maxSideLength` by default, `maxClusters: 14`, and adaptive `innerPadding: 32–48` via `resolveDefaultInnerPadding`).
  - **Space-Filling Layout Strategy Presets**: Upgraded `createPbdUniformLayoutStrategy`, `createWarmStartPbdLayoutStrategy`, and `createLocalAdaptiveLayoutStrategy` to combine `createMeshInwardFanSeeder` + `createSpaceFillingPbdRelaxer` with post-dispersion scale/density regulation (`crowdRadiusPx: 76`, `minLocalScale: 0.35`, `warmStart: true`, and local halo collision polish instead of a global shrink fallback) while maintaining `0.0 px` SAT overlap and covering-triangle containment.
- **`@simplex-viz/svg` & `@simplex-viz/react`**:
  - Added WCAG-AA perceptual cluster surface contrast calibration (`colorContrast`) and two-line `parentContextLabel` rendering on chamfered intermediate subcluster plaques in `BadgeClusterSvgView` and `ClusterAnchorSvgView`.
  - Re-exported `createSubspaceZoomStrategy`, `resolveDefaultInnerPadding`, discriminative label helpers, and enriched `SimplexZoomState` fields (`activeFrameKind`, `focusableTriangleIndices`) across `@simplex-viz/svg` and `@simplex-viz/react`.
- **Documentation, Brand Pipeline & CI/CD**:
  - Built the multi-page Astro 7 documentation, interactive strategy catalog, live Playground, real-world open dataset explorers (UCI Zoo, Hillenbrand American English Vowels, Palmer Penguins, Wikimedia Commons Media, arXiv CS Abstracts), package API references, and engineering notes.
  - Added `scripts/gh-issue.ts` (`npm run issue`) for fetching open GitHub issues and comments directly from the repository via the public GitHub REST API.
  - Refactored GitHub Actions workflows around a reusable `_quality.yml` gate (gating both GitHub Pages deployment and npm publishing while preserving `release.yml` for npm OIDC Trusted Publishing), enabled `pnpm sync:brand:check` in CI, switched brand PNG rendering to deterministic npm-managed `@fontsource/*` WOFF2 fonts (`Plus Jakarta Sans` + `IBM Plex Mono` + `Noto Sans` fallbacks) decompressed via `woff2-encoder` without relying on OS fonts, and cleaned stale artifacts from `public/`.

## [0.6.0] - 2026-11-15

### Added / Changed
- **`@simplex-viz/core`**:
  - **5th Pluggable Pipeline Stage (`SimplexZoomStrategy`)**: Hierarchical discrete drill-down and continuous camera zoom via `createBarycentricZoomStrategy` (`1:4` conformal triangle subdivision preserving exact `▲/▼/▶/◀` orientation, *Adaptive Contrast Stretch*, `incident-star` and `spotlight` cluster zoom, automatic leaf stop at `1.0x` full scale), `createSemanticZoomStrategy` (`6`-vertex tag re-partitioning with loop protection), and `createFreeCameraZoomStrategy` *(Quickstart default)*.
  - **Cohesive Neighborhood & Drill-Down UX**: Smooth affine camera transitions (`ZoomAffineTransform`) when drilling in/out and switching laterally across neighbors, dimmed clickable neighborhood context including automatic multi-level zoom-out when clicking leaf neighbors, hover-equivalent highlight of the focused region (`highlightBoundary` & `isHighlighted`), automatic pointer pass-through (`isPassThrough`) on content nodes inside drillable triangles, and automatic disabling of mouse-wheel camera zoom in `drill-down` mode.
  - **Soft-Simplex Clustering Strategies**: Added `createSoftSimplexTagClusteringStrategy` and `createSoftSimplexEmbeddingClusteringStrategy` with load-balanced QAP embedding and continuous interior triangle projection (`triangleSpread`) while leaving single-cluster members unconstrained in a 360° halo around their cluster vertex.
  - **Composable Layout Architecture (`Seeder × Relaxer × ScaleController`)**: Added `solveComposedLayout`, `createComposedLayoutStrategy`, and `createCollisionDrivenLayoutStrategy` alongside orthogonal building blocks (`createPhyllotaxisSeeder`, `createMeshInwardFanSeeder`, `withWarmStartSeeder`, `createBarycentricPbdRelaxer`, `createSpaceFillingPbdRelaxer`, `createUniformScaleController`, `createCollisionLocalScaleController`, `createDensityPriorScaleController`, `createFixedScaleController`) while preserving strict `0.0 px` SAT overlap and triangle containment guarantees.
  - **Explicit Triangle Side Length & Hierarchy Roles**: Added `MeshOptions.sideLength` for exact equilateral edge lengths plus `ClusterDescriptor.role` (`'primary' | 'intermediate'`) and `mixWeights` for synthesized zoom midpoint nodes.
- **`@simplex-viz/svg`**:
  - **Direct Internal `1:4` Subdivision Preview**: Drillable triangles (`isDrillable === true`) render their 3 midpoint edges directly through the active `SvgEdgeView` plugin inside `<g class="sv-drill-edges">`, matching the outer mesh line style 1:1.
  - **Zoom Navigation & Intermediate Cluster Styling**: Added built-in breadcrumb bar (`showZoomBreadcrumbs`), discrete 2-finger pinch-out/in gestures in `drill-down` mode, compact chamfered `'intermediate'` badges/anchors in `BadgeClusterSvgView` & `ClusterAnchorSvgView`, and imperative methods (`setZoomStrategy`, `drillDownTriangle`, `drillDownCluster`, `drillToNeighbor`, `drillUp`, `drillToDepth`, `drillToRoot`, `getZoomState`).
- **`@simplex-viz/react`**:
  - Added `<SimplexTopicGraph />` props (`zoomStrategy`, `showZoomBreadcrumbs`, `onZoomStateChange`), full drill-down methods on `useSimplexGraphController()`, and complete re-exports of all new strategies, layout building blocks, and types.
- **Documentation**:
  - Updated complete Quickstart default tables and step-by-step customization guides across all four `README.md` files.

## [0.5.0] - 2026-11-14

### Added / Changed
- **`@simplex-viz/core`**:
  - **Full Generalization of the Clustering Layer**: Tag-based clustering (`{ id, tags }` / Jaccard + Hitting-Set) is now a built-in specialization rather than a hard core requirement (`requiresTags?: boolean`, `StrategyItemIdentityConfig`, `extractIdentifiedItems`, `embedSimilarityMatrixOnMesh`).
  - **`createEmbeddingClusteringStrategy`**: First-class support for untagged domain objects with single or weighted multi-modal vector embeddings (`sources`), k-Means++ / Spherical k-Means, QAP mesh embedding, Hungarian cluster UID stability, and closed-form barycentric NNLS simplex projection (`'simplex-projection'`, `'explaining-away'`, `'top-1'`).
  - **`createSimilarityClusteringStrategy`**: Clustering arbitrary untagged objects via a pairwise similarity kernel `(a, b) => [0, 1]` using PAM k-Medoids, QAP mesh embedding, and simplex projection.
  - Enriched derivation context metadata (`representativeItems`, `centroid`, `cohesion`, `featureSummary`, `residualDistance`) and generic Hungarian matching by membership/centroids without tags.
- **`@simplex-viz/svg` & `@simplex-viz/react`**:
  - Threaded `StrategyItemIdentityConfig` (`getTags` optional for non-tag strategies), cluster-weight fallback tooltips for untagged items, updated cache keys, and re-exports of all embedding/similarity strategies and types.
- **Demo App & Documentation**:
  - Added 4 switchable datasets (`Knowledge Articles (Tags)`, `Images & Videos (Dual Embeddings)`, `Voice Samples (Audio Signatures)`, `Body Shapes (Latent Vectors)`) without `.tags` on non-tag models, domain-specific SVG previews (audio waveform, body silhouette, media gradient), and dynamic modality weight controls.

## [0.4.0] - 2026-11-14

### Added
- **`@simplex-viz/core`**:
  - Barycentric triangle-face hit-testing (`isPointInTriangle`, `HitTarget` `kind: 'triangle'`), `onTriangleHover`, `setFocusedTriangleIndex`, and enriched `MeshTriangleRenderState` & `MeshEdgeRenderState` snapshots.
- **`@simplex-viz/svg`**:
  - Pluggable triangulation face views (`SvgTriangleView`: `OklabTintTriangleSvgView`, `GradientTriangleSvgView` with continuous barycentric shading, `BarycentricSectorTriangleSvgView`, `BlueprintInsetTriangleSvgView`, `DensityHeatmapTriangleSvgView`) and mesh edge views (`SvgEdgeView`: `DashedMeshEdgeSvgView`, `ClusterTintedEdgeSvgView`, `PrecisionRailEdgeSvgView`, `MinimalHighlightEdgeSvgView`) with live runtime swapping via `setTriangleView`, `setEdgeView`, and `setViews`.
  - Clickable and hoverable triangle faces with `focusOnTriangleClick`, `onTriangleHover`, built-in triangle tooltips (`target.kind === 'triangle'`), and seamless drag-to-pan across triangles.
- **`@simplex-viz/react`**:
  - Added rendering & interaction props (`triangleView`, `edgeView`, `focusedTriangleIndex`, `focusOnTriangleClick`, `onTriangleHover`), extended `SimplexReactTooltipTarget` (`'triangle'`), and imperative setters (`setTriangleView`, `setEdgeView`, `setFocusedTriangleIndex`) on `useSimplexGraphController`.
- **Demo App & Documentation**:
  - Added independent controls for triangle faces (including *Continuous Barycentric Gradient*) and mesh edges, interactive triangle tooltips, triangle focus inspector, and right-click context menu.

## [0.3.0] - 2026-11-14

### Added
- **`@simplex-viz/core`**:
  - Pluggable strategy interfaces across the spatial pipeline (`SimplexMeshStrategy`, `SimplexClusteringStrategy` with separate `initialize`/`update` plus `sharedTagRule` & `anchorRule`, `SimplexColorStrategy`, `SimplexLayoutStrategy`).
  - Built-in strategy factories (`createAdaptiveHexMeshStrategy`, `createFixedLatticeMeshStrategy`, `createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`, `createOklabContrastColorStrategy`, `createThemeAdaptiveOklabColorStrategy`, `createPaletteColorStrategy`, `createPbdUniformLayoutStrategy`, `createWarmStartPbdLayoutStrategy`, `createLocalAdaptiveLayoutStrategy`) with runtime hot-swapping on `SimplexGraphEngine` (`setMeshStrategy`, `setClusteringStrategy`, `setColorStrategy`, `setLayoutStrategy`).
- **`@simplex-viz/svg`**:
  - Multi-touch **2-finger pinch-to-zoom & touch-pan** and `pointercancel` cleanup in `SimplexSvgController`.
  - Synchronous `cameraProxy` render sync (`engine.renderNow()`) so zoom/pan/reset apply immediately in SVG.
  - Re-exported all core strategies, rules, and `set*Strategy`/getter methods on `SimplexSvgController`.
- **`@simplex-viz/react`**:
  - Added strategy props (`meshStrategy`, `clusteringStrategy`, `colorStrategy`, `layoutStrategy`) on `<SimplexTopicGraph />` and imperative setters on `useSimplexGraphController`.
- **Demo App & Documentation**:
  - Decoupled fine-grained render settings for content nodes (`Geometric Shape` default) and cluster nodes (`Stats Pill Badge` default).
  - Fully responsive layout across phones, tablets, laptops, and ultra-wide displays (`100dvh`, `ResizeObserver`-driven triangulation, fly-out drawer, clamped overlays) and library version badge in header.

## [0.2.1] - 2026-11-13

### Changed
- **Branding, Logos & README Preview Graphics**:
  - Redesigned main logo (`SimplexViz`) and package logos (`core`, `svg`, `react`) with transparent backgrounds, maximized triangle geometry with stepped vertex rings, brightened edge gradients, and consistent brand vertex colors (`#06B6D4`, `#F59E0B`, `#D946EF`).
  - Updated all four transparent README preview graphics (`preview-demo`, `preview-core`, `preview-svg`, `preview-react`) for clean contrast in both Light Mode and Dark Mode.
  - Introduced TypeScript sync pipeline (`scripts/sync-brand.ts`) for unified SVG, PNG, favicon, and social preview assets.
- **Demo App & CI**:
  - Added automatic and manual Dark/Light mode theme switcher in the demo app without persistent storage.
  - Updated `pnpm-lock.yaml` for `--frozen-lockfile` in GitHub Actions.

## [0.2.0] - 2026-11-13

### Added
- **`@simplex-viz/core`**:
  - Added synchronous one-shot function `solveSimplexSnapshot(items, options?)` for overlap-free layouts without a `SimplexRendererAdapter` or animation loop.
- **`@simplex-viz/svg`**:
  - Added one-liner factory `createSimplexSvg(target, itemsOrOptions)`, CSS selector support in `SimplexSvgController`, three built-in presets (`'geometric'`, `'glyphs'`, `'badges'`), default interactivity (`zoom-to-cursor` + `focusOnClusterClick`), optional DOM hover tooltip, and re-exports of core helpers and types.
- **`@simplex-viz/react`**:
  - Added zero-config `<SimplexTopicGraph items={items} preset="glyphs" tooltip />`, keyless JSX renderers (`renderContentNode`/`renderClusterNode` without a `VisualResolver`), built-in React tooltip overlay, and re-exports from `@simplex-viz/svg` and `@simplex-viz/core`.
- **Demo App & Documentation**:
  - Switched to self-hosted fonts via `@fontsource` (zero Google Fonts CDN requests), simplified single-triangle logo, and reorganized all READMEs around a Quickstart-first structure.

## [0.1.0] - 2026-11-13

### Added
- **`@simplex-viz/core`**:
  - Dynamic toothed `60°` simplex mesh generator (`buildSimplexMesh`) with `0°`/`90°` orientation and row parity optimization.
  - Two-stage topic clustering (`computeSimplexClustering`) with regularized Jaccard partitioning, Simulated Annealing QAP embedding, Weighted Hitting-Set planar completion with backward pruning, explaining-away simplex assignment, and Hungarian bipartite matching.
  - Perceptual OKLab color assignment and chroma-preserving color mixing.
  - Exact convex hull collision detection (`computeConvexMtv` for circle/circle, circle/polygon, and polygon/polygon SAT) and hierarchical two-phase solver (`solveTwoPhaseLayout`) with a `0.0 px` overlap guarantee.
  - Interruptible critically damped spring integrators (`stepCriticallyDampedSpring`) and dual-layer transition state machines.
  - Schema-free conditional hybrid accessors (`ItemIdentityConfig`) and end-to-end type-safe tag/cluster metadata (`TTagMeta`, `TClusterMeta`).
- **`@simplex-viz/svg`**:
  - Framework-agnostic `SvgRendererAdapter` engine with keyed DOM reconciliation, offscreen `getBBox()` measurement, and universal dual-layer crossfade.
  - Centralized root-SVG pointer handling (`SimplexSvgController`) and 4 modular `SvgNodeView` plugins (`GeometricShapeSvgView` with 64-point morphing, `MultiSectorGlyphSvgView`, `BadgeClusterSvgView`, `ClusterAnchorSvgView`).
- **`@simplex-viz/react`**:
  - Type-safe `<SimplexTopicGraph />` component and `useSimplexGraphController` hook supporting portable `SvgNodeView` plugins and declarative JSX render props (`renderContentNode`, `renderClusterNode`).
- **Demo App & CI/CD**:
  - Interactive showcase application with 3 live-switchable rendering modes, rapid-fire stress test, collision inspector, and interaction configurator.
  - Comprehensive Vitest test suite, ESLint module-boundary rules, Changesets configuration, and GitHub Actions workflows (`ci.yml`, `deploy-pages.yml`, `release.yml`).
