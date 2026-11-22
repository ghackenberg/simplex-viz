# @simplex-viz/canvas

## 1.0.0

### Major Changes

- **v1.0.0 Public Release**: Initial stable `v1.0.0` release across the fixed SimplexViz package group (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/canvas`, `@simplex-viz/react`, `@simplex-viz/wc`):
  - Headless, DOM-free core engine (`@simplex-viz/core` & `@simplex-viz/core/worker`) and shared browser runtime helpers (`@simplex-viz/core/dom`).
  - Unified corpus & timeline synchronization, legend change detection, viewport/tooltip/accessibility bindings, and `selectItemsInScreenRect` (`rect` and coordinate signatures) across SVG, Canvas, React, and Web Component packages.
  - Reactive `SimplexCanvasController.camera` proxy scheduling, pre-capture `renderNow()` + post-destroy guard in `exportPng()`, structured tooltip support (`SimplexStructuredTooltipOption`), React `useSimplexTimeline` conditional mount/unmount tracking, and complete package documentation.

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@1.0.0

## 0.14.0

### Minor Changes

- Initial `@simplex-viz/canvas` package providing a high-capacity HTML5 Canvas 2D renderer (`CanvasRendererAdapter`, `SimplexCanvasController`, `createSimplexCanvas`, `renderSimplexSnapshotToCanvas`, `createCanvasPresetVisualResolver`) for 2,000–10,000+ items at 60 FPS with zero per-node DOM overhead, HiDPI DPR scaling, world-space frustum culling, automatic `lodThresholdPx` LOD simplification, `'geometric'` / `'glyphs'` / `'badges'` presets and custom Canvas 2D render hooks, continuous pan/zoom and `1:4` hierarchical drill-down with breadcrumbs, chronological timeline playback, `Shift+Click`/`Shift+Drag` multi-selection, WCAG 2.1 AA keyboard navigation & focus halo, tooltips, and native `exportPng()` (#21).

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.14.0
