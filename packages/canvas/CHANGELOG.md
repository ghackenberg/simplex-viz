# @simplex-viz/canvas

## 0.14.0

### Minor Changes

- Initial `@simplex-viz/canvas` package providing a high-capacity HTML5 Canvas 2D renderer (`CanvasRendererAdapter`, `SimplexCanvasController`, `createSimplexCanvas`, `renderSimplexSnapshotToCanvas`, `createCanvasPresetVisualResolver`) for 2,000–10,000+ items at 60 FPS with zero per-node DOM overhead, HiDPI DPR scaling, world-space frustum culling, automatic `lodThresholdPx` LOD simplification, `'geometric'` / `'glyphs'` / `'badges'` presets and custom Canvas 2D render hooks, continuous pan/zoom and `1:4` hierarchical drill-down with breadcrumbs, chronological timeline playback, `Shift+Click`/`Shift+Drag` multi-selection, WCAG 2.1 AA keyboard navigation & focus halo, tooltips, and native `exportPng()` (#21).

### Patch Changes

- Updated dependencies
  - @simplex-viz/core@0.14.0
