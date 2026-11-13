# @simplex-viz/svg

Framework-agnostic SVG rendering engine and pluggable `SvgNodeView` architecture for `@simplex-viz/core`. Zero dependency on React—embeds cleanly into Vanilla TypeScript, Vue, Angular, Svelte, and Web Components.

- **Live Demo:** <https://hackenberg.tech/simplex-viz/>
- **Source & Monorepo:** <https://github.com/ghackenberg/simplex-viz/tree/main/packages/svg>

## Installation

```bash
npm install @simplex-viz/core @simplex-viz/svg
```

## Included `SvgNodeView` Plugins

- `GeometricShapeSvgView` — Circle, rounded diamond, hexagon, and 5-point star with 64-point parametric SVG path morphing.
- `MultiSectorGlyphSvgView` — Multi-colored topic weight donut glyphs representing exact barycentric weights.
- `BadgeClusterSvgView` — Dynamic text badges with automatic offscreen `getBBox()` convex hull measurement.
- `ClusterAnchorSvgView` — Calibrated double-ring vertex anchors with code & member count.

## Quickstart (Vanilla TS)

```ts
import {
  SimplexSvgController,
  GeometricShapeSvgView,
  ClusterAnchorSvgView,
} from '@simplex-viz/svg';

const controller = new SimplexSvgController(containerEl, {
  items,
  visualResolver,
  contentView: new GeometricShapeSvgView(),
  clusterView: new ClusterAnchorSvgView(),
});
```
