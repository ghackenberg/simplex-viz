# Changelog

All notable changes to **SimplexViz** (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`, and the documentation/showcase site) are documented in this file following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), coordinated with per-package release notes via `@changesets/cli`.

## [0.11.0] - 2026-11-20

### Added
- **`@simplex-viz/core`**:
  - **Programmatic Search & Linked-View Navigation ([#19](https://github.com/ghackenberg/simplex-viz/issues/19))**: Added `FocusItemOptions`, `ZoomToItemOptions`, `setHighlightedIds()` / `setHighlightedItems()` accepting `Iterable<string> | null`, `getHighlightedIds()` / `getHighlightedItems()`, `focusItem(itemId, options?)`, `getFocusedItemId()`, and `zoomToItem(itemId, options?)`. In `free-camera` mode, `zoomToItem()` smoothly centers and zooms onto the target item; in `drill-down` mode, it drills down across covering triangles (up to `maxDrillSteps`) and optionally focuses the item.
- **`@simplex-viz/svg`**:
  - **Programmatic Search & Linked-View Navigation ([#19](https://github.com/ghackenberg/simplex-viz/issues/19))**: Added `setHighlightedIds()` / `setHighlightedItems()`, `getHighlightedIds()` / `getHighlightedItems()`, `focusItem(itemId, { highlight?, hover?, announce? })`, `getFocusedItemId()`, and `zoomToItem(itemId, options?)` on `SimplexSvgController`, plus `highlightedIds` and `focusedItemId` support in `setOptions()` (`SimplexSvgUpdateOptions`) with synchronized keyboard focus ring & screen-reader announcements.
  - **Client-Side SVG & PNG Snapshot Export ([#20](https://github.com/ghackenberg/simplex-viz/issues/20))**: Added `controller.exportSvg(options?)` (`ExportSvgOptions`: `includeBackground`, `backgroundColor`, `padding`, `width`, `height`, `inlineStyles`, `includeFocusRing`, `title`, `xmlDeclaration`) and `controller.exportPng(options?)` (`ExportPngOptions`: HiDPI `scale` default `2`, `format: 'blob' | 'dataUrl'`, `mimeType: 'image/png' | 'image/jpeg' | 'image/webp'`, `quality`), together with `resolveThemeBackgroundColor()`.
  - **Headless Zero-DOM SSR SVG String Renderer ([#18](https://github.com/ghackenberg/simplex-viz/issues/18))**: Added a dedicated `@simplex-viz/svg/ssr` subpath export (also re-exported from `@simplex-viz/svg`) providing `renderSimplexSvgString(itemsOrSnapshot, options?)`, `estimateSsrTextWidth()`, and `createSsrPresetHullMeasurers()` without any DOM globals (`window`/`document`). Solves overlap-free layouts (including `'badges'` via deterministic font metrics or a pluggable `measureText` callback) or renders pre-solved `SimplexLayoutSnapshot` objects across all built-in presets, themes, filters, highlights, hulls, and custom SVG string render hooks (`renderTriangle`, `renderEdge`, `renderCluster`, `renderContent`)—ready for SSR embedding or headless rasterization via `@resvg/resvg-js` without Puppeteer.
- **`@simplex-viz/react`**:
  - **Linked Views, Snapshot Export & SSR Re-Exports ([#18](https://github.com/ghackenberg/simplex-viz/issues/18), [#19](https://github.com/ghackenberg/simplex-viz/issues/19), [#20](https://github.com/ghackenberg/simplex-viz/issues/20))**: Extended `highlightedIds` on `<SimplexTopicGraph />` to accept `Iterable<string> | null`; exposed `setHighlightedIds`, `setHighlightedItems`, `getHighlightedIds`, `getHighlightedItems`, `focusItem`, `getFocusedItemId`, `zoomToItem`, `exportSvg`, and `exportPng` on `useSimplexGraphController().handle`; and re-exported `renderSimplexSvgString`, `estimateSsrTextWidth`, `createSsrPresetHullMeasurers`, `resolveThemeBackgroundColor`, and all new option/context types.
- **Documentation & READMEs**:
  - Updated all four `README.md` files, Astro documentation guides (`quickstart`, `customization`), and package API references (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`) for `0.11.0`.

## [0.10.0] - 2026-11-19

### Added
- **`@simplex-viz/core`**:
  - **Zero-Relayout Item Filtering ([#15](https://github.com/ghackenberg/simplex-viz/issues/15))**: Added `ItemFilterMode` (`'dim' | 'hide'`), `ItemFilterPredicate`, `ItemFilterOptions`, `ItemFilterState`, `NodeRenderState.isFilteredOut`, `itemFilter` / `itemFilterMode` on `SimplexGraphEngineConfig`, and `engine.setItemFilter(predicate, options?)` / `engine.getItemFilter()`. Filters items visually without re-clustering or re-solving SAT layout so node coordinates remain completely stable while `'hide'` items suppress hit-testing and visual presence cleanly.
  - **Re-entrant `batch()` Coalescing ([#16](https://github.com/ghackenberg/simplex-viz/issues/16))**: Added `engine.batch(fn)` to defer intermediate clustering, layout, and rendering passes across nested or sequential engine mutations and flush a single minimal pipeline recomputation when the outermost batch exits.
  - **Keyboard Navigation & Interactive Target Primitives ([#17](https://github.com/ghackenberg/simplex-viz/issues/17))**: Added `SimplexKeyboardFocusTarget`, `SimplexInteractiveTarget`, `engine.getInteractiveTargets()`, `engine.hoverInteractiveTarget()`, `engine.activateInteractiveTarget()`, `engine.getClusterByUid()`, and `engine.getItemLayoutById()` to support deterministic focus traversal and activation across clusters, content items, and triangles.
- **`@simplex-viz/svg`**:
  - **Zero-Relayout Item Filtering ([#15](https://github.com/ghackenberg/simplex-viz/issues/15))**: Added `itemFilter` / `itemFilterMode` options and `setItemFilter()` / `getItemFilter()` on `SimplexSvgController`, applied cleanly in `SvgRendererAdapter` without double-dimming or altering SAT hulls, and re-exported filter types.
  - **Atomic `batch()` & `setOptions()` Updates ([#16](https://github.com/ghackenberg/simplex-viz/issues/16))**: Added `SimplexSvgUpdateOptions`, `controller.batch(fn)`, and `controller.setOptions(opts)` to coalesce multi-property runtime updates (e.g. `theme`, `preset`, `layoutOptions`, `itemFilter`, strategies) into one recomputation, and internally batched `setTheme()` and `setTimelineOptions()`.
  - **WCAG 2.1 AA Keyboard Navigation & Screen-Reader Accessibility ([#17](https://github.com/ghackenberg/simplex-viz/issues/17))**: Added `ariaLabel` and `keyboardNavigation` (default `true`) options with runtime setters (`setAriaLabel()`, `setKeyboardNavigation()`, `getKeyboardFocusTarget()`, `clearKeyboardFocus()`, `getInteractiveTargets()`), single-tabstop `role="application"` + `tabindex="0"` + `aria-activedescendant` keyboard traversal (`ArrowRight`/`ArrowDown`/`ArrowLeft`/`ArrowUp`/`Home`/`End`/`Enter`/`Space`/`Escape`), collision-free instance-scoped SVG DOM IDs and semantic ARIA roles/labels (`SvgAriaAttributes`, `SvgAriaMetadataResolver`, `ariaIdPrefix`), a zoom- and theme-adaptive high-contrast double-halo SVG focus ring (`g.sv-a11y-focus-ring`), and a polite screen-reader live region (`div.sv-sr-announcer[role="status"][aria-live="polite"]`).
- **`@simplex-viz/react`**:
  - **Filtering, Batched Prop Sync & Accessibility ([#15](https://github.com/ghackenberg/simplex-viz/issues/15), [#16](https://github.com/ghackenberg/simplex-viz/issues/16), [#17](https://github.com/ghackenberg/simplex-viz/issues/17))**: Added `itemFilter`, `itemFilterMode`, `ariaLabel`, and `keyboardNavigation` props on `<SimplexTopicGraph />`; unified dynamic prop synchronization into a single batched `controller.batch(...)` effect per render commit; exposed `setItemFilter`, `getItemFilter`, `batch`, `setOptions`, `getKeyboardFocusTarget`, and `clearKeyboardFocus` on `useSimplexGraphController()`; and re-exported all new core and SVG types.
- **Documentation & READMEs**:
  - Updated all four `README.md` files, Astro documentation guides (`quickstart`, `customization`), and package API references (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`) for `0.10.0`.

## [0.9.0] - 2026-11-19

### Added / Fixed
- **`@simplex-viz/core`**:
  - **Deferred `0×0` Mount Initialization & Clean Re-Initialization ([#12](https://github.com/ghackenberg/simplex-viz/issues/12))**: Added `deferInitialSolve?: boolean` on `SimplexGraphEngineConfig` and `engine.reinitializeViewport(width, height)` so graphs mounted inside hidden tabs, modals, or before async CSS loads can either defer clustering/layout completely until a real viewport size arrives or perform a fresh `'initial'` solve with zero spring jump and zero stale `0×0` hull measurements.
- **`@simplex-viz/svg`**:
  - **Zero-Size Container Mount Recovery & `deferInitialLayout` ([#12](https://github.com/ghackenberg/simplex-viz/issues/12))**: Automatically detects `0×0` container mounts at construction, invalidates cached `getBBox()` hulls on the first non-zero `ResizeObserver` entry, and re-initializes the viewport cleanly with zero spring jump; added opt-in `deferInitialLayout?: boolean | DeferInitialLayoutOptions` (`{ fallbackTimeoutMs?: number }`) to skip the provisional `960×620` solve entirely until the container becomes visible.
  - **Mobile Touch-Scroll Direction-Locking & Peak-Displacement Click Tolerance ([#13](https://github.com/ghackenberg/simplex-viz/issues/13))**: Added `touchScrollLockPx` (default `8`) and `clickTolerancePx` (default `12`) together with runtime setters `setTouchScrollLockPx()` and `setClickTolerancePx()`. Sets `touch-action: pan-y` when `touchScrollLockPx > 0` so vertical single-finger swipes yield cleanly to native page scrolling while horizontal swipes and two-finger pinches lock onto the canvas, and suppresses trailing clicks whenever peak pointer displacement exceeds `clickTolerancePx` across both `free-camera` and `drill-down` modes.
  - **Lightweight `shapeOptions` Styling Hooks on `GeometricShapeSvgView` ([#14](https://github.com/ghackenberg/simplex-viz/issues/14))**: Added optional view-level `hoverScale` and `dimmedOpacity` hooks on `SvgNodeView` (applied cleanly in `SvgRendererAdapter` without altering SAT hulls or double-dimming), extended `GeometricShapeSvgViewOptions` with `hoverScale`, `hoverRingColor`, `dimmedOpacity`, `strokeColor`, and `strokeWidth` (factored into `measureConvexHull()` and preserved during `morph()`), forwarded `shapeOptions` through `createPresetViews(preset, { shapeOptions })` (`PresetViewsOptions`) and `SimplexSvgController`, and added `setShapeOptions()`.
- **`@simplex-viz/react`**:
  - **Production Embedding & Styling Props ([#12](https://github.com/ghackenberg/simplex-viz/issues/12), [#13](https://github.com/ghackenberg/simplex-viz/issues/13), [#14](https://github.com/ghackenberg/simplex-viz/issues/14))**: Added `deferInitialLayout`, `touchScrollLockPx`, `clickTolerancePx`, and `shapeOptions` props on `<SimplexTopicGraph />` with dynamic `useEffect` synchronization, and re-exported `DeferInitialLayoutOptions` and `PresetViewsOptions`.
- **Documentation & READMEs**:
  - Updated all four `README.md` files, Astro documentation guides (`quickstart`, `customization`), and package API references (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`) for `0.9.0`.

## [0.8.0] - 2026-11-19

### Added / Changed
- **`@simplex-viz/core`**:
  - **Chronological Timeline Engine ([#8](https://github.com/ghackenberg/simplex-viz/issues/8))**: Added zero-DOM `SimplexTimelineController` and `createSimplexTimeline` for grouping timestamped or frame-keyed records into ordered cumulative frames (`play`, `pause`, `toggle`, `stepBy`, `seek`, `resetToEnd`, `setSpeed`, `setStepIntervalMs`, `setLoop`, `tick`, `subscribe`), supporting `getTimestamp`, `getFrameKey`, undated step-`0` baseline items, and `includeEmptyStart`.
  - **Path-Independent Final-Seeded Clustering & Layout Strategies ([#5](https://github.com/ghackenberg/simplex-viz/issues/5), [#8](https://github.com/ghackenberg/simplex-viz/issues/8))**:
    - Added `createFinalSeededClusteringStrategy(baseStrategy?, options?)` to pin canonical full-corpus clusters, vertex assignments, UIDs, and OKLab hues across chronological subsets (`0..N`) or filtered views while re-seeding cleanly on viewport/mesh resizes.
    - Added `createFinalSeededLayoutStrategy(baseStrategy?, { scaleMode?: 'pinned' | 'adaptive', unseenItemPolicy?: 'fallback' | 'reseed' })` together with `canonicalSeedItems` / `engine.setCanonicalSeedItems(items)` to freeze canonical `(x, y)` coordinates across timeline frames—keeping exact final scales (`'pinned'`) or expanding sparse early frames symmetrically up to `1.0x` with exact SAT `0.0 px` overlap verification (`'adaptive'`).
  - **Configurable Empty-Cluster Rendering ([#8](https://github.com/ghackenberg/simplex-viz/issues/8))**: Added `emptyClusterBehavior: 'normal' | 'dim' | 'hide'` on `SimplexGraphEngine` (`getEmptyClusterBehavior()`, `setEmptyClusterBehavior()`) to keep future `0`-item clusters dimmed or hidden until their first item arrives.
  - **Viewport-Aware Update Reasons ([#6](https://github.com/ghackenberg/simplex-viz/issues/6))**: Threaded explicit `PipelineUpdateReason` (`'initial' | 'items' | 'viewport' | 'mesh' | 'strategy'`) and viewport dimensions into `estimateClusterCount(ctx: EstimateClusterCountContext)` and `ClusteringStrategyContext` so shrinking and regrowing the viewport cleanly restores the original cluster count.
  - **Decoupled Tag Display Labels ([#7](https://github.com/ghackenberg/simplex-viz/issues/7))**: Added `formatTagLabel` and `resolveTagDisplayLabel` to map canonical normalized tag IDs to human-readable labels across cluster titles, breadcrumbs, semantic zoom subclusters, and tooltips without affecting clustering.
  - **Composable Interaction Contract & Manual Relayout ([#3](https://github.com/ghackenberg/simplex-viz/issues/3), [#9](https://github.com/ghackenberg/simplex-viz/issues/9))**: Standardized target-specific click/hover handlers (`onContentClick`, `onClusterClick`, `onTriangleClick`, `onBackgroundClick`, `onLeftClick`, `onRightClick`, `onContentHover`, `onClusterHover`, `onTriangleHover`, and custom `onWheel`) so returning `void`/`false` composes with built-in drill-down/focus/tooltips/zoom and returning `true` consumes the event; added `engine.relayout()` to invalidate cached hulls and re-solve layout on demand.
- **`@simplex-viz/svg`**:
  - **Built-In Chronological Timeline Player HUD ([#8](https://github.com/ghackenberg/simplex-viz/issues/8))**: Added `timeline` option (`boolean | TimelinePlayerOptions`), `controller.timeline`, `getTimeline()`, `setTimelineOptions()`, and `subscribeTimeline()` with a theme-adaptive Play/Pause/Step/Scrubber overlay (`showControls`, `position: 'bottom' | 'top'`), automatic `createFinalSeededClusteringStrategy` wrapping (`autoFinalSeed: true`), optional `createFinalSeededLayoutStrategy` wrapping (`autoFinalSeedLayout: false | 'pinned' | 'adaptive'`), and `emptyClusterBehavior` (`'normal' | 'dim' | 'hide'`).
  - **Cluster Badge Formatting & Fixed/Item-Driven N-Gon Shapes ([#4](https://github.com/ghackenberg/simplex-viz/issues/4), [#11](https://github.com/ghackenberg/simplex-viz/issues/11))**: Added `badgeOptions` (`showCode`, `maxTitleChars`, `formatTitle`, `truncateBadgeTitle`) on `BadgeClusterSvgView` and presets, plus `getShape` / `GeometricShapeSpec` / `resolveGeometricShapeSpec` supporting arbitrary regular polygons (`sides >= 3`) with exact convex SAT hulls and invariance across `1:4` drill-down levels.
  - **Webfont Auto-Relayout & Composable Handlers ([#3](https://github.com/ghackenberg/simplex-viz/issues/3), [#9](https://github.com/ghackenberg/simplex-viz/issues/9))**: Added `relayoutOnFontLoad: true` (subscribing to `document.fonts.ready` / `loadingdone` with clean `destroy()` teardown), `controller.relayout()`, `setEmptyClusterBehavior()`, and `onWheel: 'none'` without calling `preventDefault()`.
- **`@simplex-viz/react`**:
  - **Timeline Props & Reactive Hook ([#8](https://github.com/ghackenberg/simplex-viz/issues/8))**: Added `timeline`, `emptyClusterBehavior`, and `onTimelineStateChange` props to `<SimplexTopicGraph />`, `handle.getTimeline()` and `handle.relayout()` on `useSimplexGraphController()`, and the reactive `useSimplexTimeline()` hook for declarative custom playback UIs.
  - **Preset Customization & Composable Interactions ([#3](https://github.com/ghackenberg/simplex-viz/issues/3), [#4](https://github.com/ghackenberg/simplex-viz/issues/4), [#7](https://github.com/ghackenberg/simplex-viz/issues/7), [#9](https://github.com/ghackenberg/simplex-viz/issues/9), [#11](https://github.com/ghackenberg/simplex-viz/issues/11))**: Added `formatTagLabel`, `badgeOptions`, `getShape`, `relayoutOnFontLoad`, and target-specific click props (`onContentClick`, `onClusterClick`, `onTriangleClick`, `onBackgroundClick`) on `<SimplexTopicGraph />`, and re-exported all new `@simplex-viz/core` and `@simplex-viz/svg` APIs and types.
- **Showcase, Playground & Documentation**:
  - Enabled live chronological timeline playback (`1928–1976`) with `autoFinalSeedLayout: 'adaptive'` and `emptyClusterBehavior: 'dim'` on the Vega Cinema example, added full Timeline, Final-Seeded Layout, and Empty-Cluster controls to the interactive Playground, and updated all READMEs, docs guides, and homepage copy.

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
