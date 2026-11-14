# @simplex-viz/react

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
