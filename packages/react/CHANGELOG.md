# @simplex-viz/react

## 0.14.0

### Minor Changes

- Support `formatStepLabel` via a stable ref-proxy without restarting playback, and expose `handle.subscribeTimeline(listener)` on `useSimplexGraphController().handle` for zero-glue external React timeline HUDs (#30).

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.14.0
  - @simplex-viz/svg@0.14.0

## 0.13.0

### Minor Changes

- Add `shiftClickSelects` (#27) and `onLegendChange` (#29) props on `<SimplexTopicGraph />`, expose `getLegendModel(options?)` on `useSimplexGraphController().handle`, and re-export all new legend and custom DOM tooltip types (`SimplexLegendEntry`, `SimplexLegendModel`, `SimplexLegendModelOptions`, `SimplexDomTooltipRenderer`, `SimplexSvgTooltipTarget`, `SimplexSvgTooltipOption`, `SimplexDomTooltipRenderResult`, #28, #29).

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.13.0
  - @simplex-viz/svg@0.13.0

## 0.12.1

### Patch Changes

- Synchronized workspace patch release (`0.12.1`) accompanying `@simplex-viz/wc` README visual assets.
- Updated dependencies
  - @simplex-viz/core@0.12.1
  - @simplex-viz/svg@0.12.1

## 0.12.0

### Minor Changes

- Add `reducedMotion` (#23), `selectedIds`, `marqueeSelection`, and `onSelectionChange` (#25) props to `<SimplexTopicGraph />`; expose `setReducedMotion`, `getReducedMotion`, `isReducedMotionActive`, `setSelectedIds`, `toggleSelectedId`, `clearSelection`, `getSelectedIds`, `selectItemsInScreenRect`, `getViewState`, and `restoreViewState` (#24) on `useSimplexGraphController().handle`; and re-export all new `@simplex-viz/core` and `@simplex-viz/svg` types.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @simplex-viz/core@0.12.0
  - @simplex-viz/svg@0.12.0

## 0.11.0

### Minor Changes

- Extend `highlightedIds` on `<SimplexTopicGraph />` to accept `Iterable<string> | null` and expose programmatic search/linked-view controls (`setHighlightedIds`, `setHighlightedItems`, `getHighlightedIds`, `getHighlightedItems`, `focusItem`, `getFocusedItemId`, `zoomToItem`, #19) plus client-side snapshot export helpers (`exportSvg`, `exportPng`, #20) on `useSimplexGraphController().handle`; re-export headless SSR utilities (`renderSimplexSvgString`, `estimateSsrTextWidth`, `createSsrPresetHullMeasurers`, #18) and all new `@simplex-viz/svg` and `@simplex-viz/core` types.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @simplex-viz/core@0.11.0
  - @simplex-viz/svg@0.11.0

## 0.10.0

### Minor Changes

- Add zero-relayout filtering props (`itemFilter`, `itemFilterMode`, #15), unify dynamic `<SimplexTopicGraph />` prop synchronization inside a single batched `controller.batch(...)` effect per commit (#16), add WCAG 2.1 AA accessibility props (`ariaLabel`, `keyboardNavigation`, #17), expose `setItemFilter`, `getItemFilter`, `batch`, `setOptions`, `getKeyboardFocusTarget`, and `clearKeyboardFocus` on `useSimplexGraphController()`, and re-export all new `@simplex-viz/core` and `@simplex-viz/svg` types.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @simplex-viz/core@0.10.0
  - @simplex-viz/svg@0.10.0

## 0.9.0

### Minor Changes

- Add `deferInitialLayout` (#12), `touchScrollLockPx` and `clickTolerancePx` (#13), and `shapeOptions` (#14) props to `<SimplexTopicGraph />` with dynamic prop synchronization, and re-export `DeferInitialLayoutOptions` and `PresetViewsOptions` from `@simplex-viz/svg`.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @simplex-viz/core@0.9.0
  - @simplex-viz/svg@0.9.0

## 0.8.0

### Minor Changes

- Add `timeline`, `emptyClusterBehavior`, and `onTimelineStateChange` props to `<SimplexTopicGraph />` alongside the reactive `useSimplexTimeline()` hook and `handle.getTimeline()` / `handle.relayout()` on `useSimplexGraphController()` (#8, #9); add `formatTagLabel` (#7), `badgeOptions` (#4), `getShape` (#11), `relayoutOnFontLoad` (#9), and composable target-specific click props (`onContentClick`, `onClusterClick`, `onTriangleClick`, `onBackgroundClick`, #3); re-export all new `@simplex-viz/svg` and `@simplex-viz/core` strategies, helpers, and types.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @simplex-viz/core@0.8.0
  - @simplex-viz/svg@0.8.0

## 0.7.0

### Minor Changes

- Add explicit `.js` extensions for ESM `Node16`/`NodeNext` `.d.ts` compatibility (#2) and re-export `createSubspaceZoomStrategy`, `resolveDefaultInnerPadding`, discriminative label helpers, and enriched `SimplexZoomState` fields (`activeFrameKind`, `focusableTriangleIndices`) from `@simplex-viz/svg` and `@simplex-viz/core`.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @simplex-viz/core@0.7.0
  - @simplex-viz/svg@0.7.0

## 0.6.0

### Minor Changes

- Add `zoomStrategy`, `showZoomBreadcrumbs`, and `onZoomStateChange` props to `<SimplexTopicGraph />`, expose `setZoomStrategy`, `drillDownTriangle`, `drillDownCluster`, `drillToNeighbor`, `drillUp`, `drillToDepth`, `drillToRoot`, and `getZoomState` on `useSimplexGraphController()`, and re-export all new zoom, soft-simplex clustering, and composable layout APIs and types from `@simplex-viz/svg` and `@simplex-viz/core`.
- Updated dependencies
  - @simplex-viz/core@0.6.0
  - @simplex-viz/svg@0.6.0

## 0.5.0

### Minor Changes

- Update `SimplexTopicGraphProps` to `StrategyItemIdentityConfig` (making `getTags` optional for untagged embedding/similarity models), generalize keyless `renderContentNode` cache keys and built-in React tooltips for untagged items, and re-export `createEmbeddingClusteringStrategy`, `createSimilarityClusteringStrategy`, and related types.
- Updated dependencies
  - @simplex-viz/core@0.5.0
  - @simplex-viz/svg@0.5.0

## 0.4.0

### Minor Changes

- Add pluggable `triangleView` / `edgeView` props, interactive triangle props (`focusedTriangleIndex`, `focusOnTriangleClick`, `onTriangleHover`), `'triangle'` tooltip targets, `GradientTriangleSvgView` re-exports, and `setTriangleView` / `setEdgeView` / `setFocusedTriangleIndex` hook methods.
- Updated dependencies
  - @simplex-viz/core@0.4.0
  - @simplex-viz/svg@0.4.0

## 0.3.0

### Minor Changes

- Add pluggable strategy props (`meshStrategy`, `clusteringStrategy`, `colorStrategy`, `layoutStrategy`) to `<SimplexTopicGraph />`, expose imperative strategy setters on `useSimplexGraphController()`, and re-export all built-in strategy factories and rule types from `@simplex-viz/svg` and `@simplex-viz/core`.
- Updated dependencies
  - @simplex-viz/core@0.3.0
  - @simplex-viz/svg@0.3.0

## 0.2.1

### Patch Changes

- Redesign package logos and README preview graphics with transparent dual-theme (Light & Dark mode) contrast, unified brand triangle vertex colors, and automated PNG asset synchronization.
- Updated dependencies
  - @simplex-viz/core@0.2.1
  - @simplex-viz/svg@0.2.1

## 0.2.0

### Minor Changes

- Add zero-config `<SimplexTopicGraph items={items} />` support via built-in presets, keyless declarative JSX renderers (`renderContentNode`/`renderClusterNode` without requiring `visualResolver`), default cursor-zoom and cluster click-focus interactions, optional React `tooltip` overlay, single-import re-exports from `@simplex-viz/svg` and `@simplex-viz/core`, and progressive quickstart documentation.
- Updated dependencies
  - @simplex-viz/core@0.2.0
  - @simplex-viz/svg@0.2.0

## 0.1.3

### Patch Changes

- Add project brand logo and JSX slot architecture preview graphics, contextual lead-in prose, and step-by-step React walkthroughs in `@simplex-viz/react` README.
- Updated dependencies
  - @simplex-viz/core@0.1.3
  - @simplex-viz/svg@0.1.3

## 0.1.2

### Patch Changes

- Expand `@simplex-viz/react` README with declarative JSX and `SvgNodeView` quickstarts, full `<SimplexTopicGraph />` props reference, and `useSimplexGraphController()` docs.
- Updated dependencies
  - @simplex-viz/core@0.1.2
  - @simplex-viz/svg@0.1.2

## 0.1.1

### Patch Changes

- f443ebd: Update npm `homepage` links to point to the live interactive GitHub Pages demo, add `bugs` repository links, and replace LaTeX math notation in `@simplex-viz/core` README with plain Unicode for clean rendering on npmjs.org.
- Updated dependencies [f443ebd]
  - @simplex-viz/core@0.1.1
  - @simplex-viz/svg@0.1.1
