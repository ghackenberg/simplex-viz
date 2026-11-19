# @simplex-viz/svg

## 0.8.0

### Minor Changes

- Add opt-in chronological timeline playback (`timeline`, `controller.timeline`, `getTimeline()`, `setTimelineOptions()`, `subscribeTimeline()`) with a theme-adaptive Play/Pause/Step/Scrubber HUD, automatic `createFinalSeededClusteringStrategy` wrapping (`autoFinalSeed`), optional `createFinalSeededLayoutStrategy` wrapping (`autoFinalSeedLayout: false | 'pinned' | 'adaptive'`), and configurable `emptyClusterBehavior` (`'normal' | 'dim' | 'hide'`, `setEmptyClusterBehavior()`, #8); add `badgeOptions` (`showCode`, `maxTitleChars`, `formatTitle`, `truncateBadgeTitle`, #4), fixed and item-driven N-gon `getShape` / `resolveGeometricShapeSpec` with exact convex hulls (#11), `formatTagLabel` across badges/tooltips/breadcrumbs (#7), automatic webfont relayout (`relayoutOnFontLoad: true` + `relayout()`, #9), composable click/hover/wheel handlers (#3), and re-export all new `@simplex-viz/core` APIs.

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.8.0

## 0.7.0

### Minor Changes

- Add explicit `.js` extensions for ESM `Node16`/`NodeNext` `.d.ts` compatibility (#2), add WCAG-AA perceptual cluster surface contrast calibration (`colorContrast`) and two-line `parentContextLabel` corner plaques in `BadgeClusterSvgView` and `ClusterAnchorSvgView`, and re-export `createSubspaceZoomStrategy`, `resolveDefaultInnerPadding`, discriminative label helpers, and enriched `SimplexZoomState` fields (`activeFrameKind`, `focusableTriangleIndices`).

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.7.0

## 0.6.0

### Minor Changes

- Support hierarchical `1:4` drill-down zoom in `SimplexSvgController` and `SvgRendererAdapter`: render internal `1:4` subdivision edges on `isDrillable` triangles directly through the active `SvgEdgeView` (`g.sv-drill-edges`), render dimmed neighborhood context layers, support discrete 2-finger pinch-out/in gestures and optional breadcrumb overlays (`showZoomBreadcrumbs`), add `'intermediate'` compact chamfered bridge variants to `BadgeClusterSvgView` and `ClusterAnchorSvgView`, and re-export all new `@simplex-viz/core` zoom, soft-simplex, and composable layout APIs.
- Updated dependencies
  - @simplex-viz/core@0.6.0

## 0.5.0

### Minor Changes

- Adopt `StrategyItemIdentityConfig` so `getTags` is optional when passing non-tag clustering strategies (`createEmbeddingClusteringStrategy`, `createSimilarityClusteringStrategy`), add weighted-anchor fallback formatting in built-in hover tooltips for untagged items, and re-export all new core embedding/similarity factories and types.
- Updated dependencies
  - @simplex-viz/core@0.5.0

## 0.4.0

### Minor Changes

- Add pluggable `SvgTriangleView` (`OklabTintTriangleSvgView`, `GradientTriangleSvgView` for continuous barycentric shading, `BarycentricSectorTriangleSvgView`, `BlueprintInsetTriangleSvgView`, `DensityHeatmapTriangleSvgView`) and `SvgEdgeView` (`DashedMeshEdgeSvgView`, `ClusterTintedEdgeSvgView`, `PrecisionRailEdgeSvgView`, `MinimalHighlightEdgeSvgView`) plugins with runtime hot-swapping (`setTriangleView`, `setEdgeView`, `setViews`), interactive triangle hover/click/tooltips (`focusOnTriangleClick`, `setFocusedTriangleIndex`), and drag-to-pan across faces.
- Updated dependencies
  - @simplex-viz/core@0.4.0

## 0.3.0

### Minor Changes

- Expose and re-export pluggable `@simplex-viz/core` strategy factories, rules, and runtime strategy setters/getters on `SimplexSvgController`, add synchronous camera transform updates via `camera` (`zoomToCursor`, `panBy`, `reset`), and support two-finger touch pinch-to-zoom, touch pan, and `pointercancel` cleanup.
- Updated dependencies
  - @simplex-viz/core@0.3.0

## 0.2.1

### Patch Changes

- Redesign package logos and README preview graphics with transparent dual-theme (Light & Dark mode) contrast, unified brand triangle vertex colors, and automated PNG asset synchronization.
- Updated dependencies
  - @simplex-viz/core@0.2.1

## 0.2.0

### Minor Changes

- Add zero-config `createSimplexSvg(target, itemsOrOptions)`, built-in visual presets (`'geometric'`, `'glyphs'`, `'badges'`), default cursor-zoom and cluster click-focus interactions, optional floating DOM hover tooltips, core utility/type re-exports, and progressive quickstart documentation.
- Updated dependencies
  - @simplex-viz/core@0.2.0

## 0.1.3

### Patch Changes

- Add project brand logo and built-in plugin showcase preview graphics, contextual lead-in prose, and step-by-step Vanilla TypeScript walkthroughs in `@simplex-viz/svg` README.
- Updated dependencies
  - @simplex-viz/core@0.1.3

## 0.1.2

### Patch Changes

- Expand `@simplex-viz/svg` README with a full Vanilla TypeScript quickstart, built-in `SvgNodeView` plugin docs, custom plugin guide, and `SimplexSvgController` API reference.
- Updated dependencies
  - @simplex-viz/core@0.1.2

## 0.1.1

### Patch Changes

- f443ebd: Update npm `homepage` links to point to the live interactive GitHub Pages demo, add `bugs` repository links, and replace LaTeX math notation in `@simplex-viz/core` README with plain Unicode for clean rendering on npmjs.org.
- Updated dependencies [f443ebd]
  - @simplex-viz/core@0.1.1
