<p align="center">
  <img src="https://raw.githubusercontent.com/ghackenberg/simplex-viz/main/docs/assets/logo-svg.png" width="525" alt="SimplexViz / svg — @simplex-viz/svg" />
</p>

# @simplex-viz/svg

Framework-agnostic SVG rendering engine and pluggable `SvgNodeView` architecture for `@simplex-viz/core`. Zero dependency on React—embeds cleanly into Vanilla TypeScript, Vue, Angular, Svelte, Solid, and Web Components.

- **Live Demo:** <https://hackenberg.tech/simplex-viz/>
- **Source & Monorepo:** <https://github.com/ghackenberg/simplex-viz/tree/main/packages/svg>
- **Companion Packages:** [`@simplex-viz/core`](https://www.npmjs.com/package/@simplex-viz/core) · [`@simplex-viz/react`](https://www.npmjs.com/package/@simplex-viz/react)

## Visual Rendering Showcase

While `@simplex-viz/core` computes pure spatial coordinates, `@simplex-viz/svg` turns each frame into live DOM `<svg>` elements inside any browser container or UI framework. The preview below renders its built-in views together in a single viewport:

<p align="center">
  <img src="https://raw.githubusercontent.com/ghackenberg/simplex-viz/main/docs/assets/preview-svg.png" width="100%" alt="@simplex-viz/svg rendering showcase showing GeometricShapeSvgView, MultiSectorGlyphSvgView, ClusterAnchorSvgView, and BadgeClusterSvgView" />
</p>

*Figure: Visual showcase of the four built-in `SvgNodeView` plugins rendered on an OKLab-tinted 60° simplex mesh. Content items mix `GeometricShapeSvgView` (circles, diamonds, hexagons, and stars that morph smoothly via 64-point paths) with `MultiSectorGlyphSvgView` (proportional donut glyphs whose sector arcs encode barycentric topic weights). Topic clusters alternate between compact `ClusterAnchorSvgView` vertex rings and auto-measured `BadgeClusterSvgView` cards sized via offscreen `getBBox()`.*

## Features

- **Framework-agnostic SVG scene graph**: Keyed DOM reconciliation for background mesh triangles, mesh edges, convex hull debug wireframes, cluster nodes, and content nodes.
- **Pluggable triangle face & mesh edge views**: Swap `SvgTriangleView` (`OklabTintTriangleSvgView`, `GradientTriangleSvgView`, `BarycentricSectorTriangleSvgView`, `BlueprintInsetTriangleSvgView`, `DensityHeatmapTriangleSvgView`) and `SvgEdgeView` (`DashedMeshEdgeSvgView`, `ClusterTintedEdgeSvgView`, `PrecisionRailEdgeSvgView`, `MinimalHighlightEdgeSvgView`) live via `setTriangleView` / `setEdgeView` / `setViews`.
- **Automatic offscreen `getBBox()` hull measurement**: Omit `measureConvexHull` on any `SvgNodeView` and `@simplex-viz/svg` automatically renders it in a hidden measurement bin, reads `getBBox()`, and caches a tight convex polygon for overlap-free layout.
- **Smooth 60 fps transitions**: Critically damped spring motion + specialized parametric `morph()` or automatic dual-layer crossfade when switching visual presets or mutating items.
- **Centralized root-SVG interactions**: Attaches pointer, two-finger touch pinch-to-zoom/pan, click, right-click, wheel, drag-to-pan, and `ResizeObserver` listeners solely on the root `<svg>` element and delegates hit-testing to `@simplex-viz/core`'s exact convex geometry + triangle-face solver (including triangle hover tooltips and click-to-focus while keeping drag-to-pan intact).
- **Modular built-in view plugins**: Four node views (geometric shape morphing, multi-sector topic glyphs, vertex anchors, dynamic text badges), five triangle face views, and four mesh edge views.

## Installation

Install `@simplex-viz/svg` alone (`@simplex-viz/core` is installed automatically and key utilities and types are re-exported directly from `@simplex-viz/svg`):

```bash
npm install @simplex-viz/svg
```

## Quickstart (Zero-Config)

### One-Liner Mount (`createSimplexSvg`)

Pass a container `HTMLElement` or CSS selector together with an array of `{ id, tags }` items to `createSimplexSvg`. Drag-to-pan, cursor wheel zoom, cluster click-focus, and floating hover tooltips are enabled automatically:

```ts
import { createSimplexSvg } from '@simplex-viz/svg';

const items = [
  { id: '1', label: 'Simplex Mesh', tags: ['geometry', 'triangulation', 'math'] },
  { id: '2', label: 'OKLab Mixing', tags: ['color', 'geometry', 'perception'] },
  { id: '3', label: 'SAT Solver', tags: ['collision', 'geometry'] },
];

const controller = createSimplexSvg('#graph', items);
```

### Presets, Labels & Custom Domain Records (`SimplexSvgController`)

When you want to pick a built-in visual preset (`'geometric'`, `'glyphs'`, or `'badges'`), display custom labels, or connect records without `{ id, tags }`, pass an options object to `createSimplexSvg` or `new SimplexSvgController(...)`:

```ts
import { SimplexSvgController } from '@simplex-viz/svg';

interface Article {
  readonly slug: string;
  readonly headline: string;
  readonly topics: readonly string[];
}

const controller = new SimplexSvgController('#graph', {
  items: articles,
  getId: (a) => a.slug,
  getTags: (a) => a.topics,
  getLabel: (a) => a.headline,
  preset: 'glyphs', // 'geometric' | 'glyphs' | 'badges'
  tooltip: true, // Built-in hover tooltip (or custom formatter)
});
```

You can also format hover tooltips yourself without building separate DOM overlays:

```ts
const controller = new SimplexSvgController('#graph', {
  items: articles,
  getId: (a) => a.slug,
  getTags: (a) => a.topics,
  preset: 'badges',
  tooltip: (target) => {
    if (target.kind === 'content') {
      return `${target.item.headline} (${target.layoutContext.tags.length} tags)`;
    }
    if (target.kind === 'cluster') {
      return `${target.cluster.defaultLabel}: ${target.cluster.members.length} articles`;
    }
    return `Triangle #${target.triangle.index + 1} (${target.triangle.coveredItemCount} items)`;
  },
});
```

Switch presets or mutate data smoothly at runtime—camera pan/zoom stays intact while springs retarget mid-flight:

```ts
controller.setPreset('badges');
controller.addItems({ slug: 'new-1', headline: 'Dual-Layer Crossfade', topics: ['svg', 'animation'] });
controller.removeItems('old-slug');
controller.camera.reset();
```

### Pluggable Core Strategies (Embeddings, Similarities & Tag Specialization)

`@simplex-viz/svg` re-exports all built-in `@simplex-viz/core` strategy factories—including **`createEmbeddingClusteringStrategy`** (single/multi-modal vector embeddings without any `tags` field) and **`createSimilarityClusteringStrategy`** (arbitrary pairwise similarity functions), alongside tag strategies (`createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`), mesh, color, and layout strategies:

```ts
import {
  SimplexSvgController,
  createEmbeddingClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createLocalAdaptiveLayoutStrategy,
} from '@simplex-viz/svg';

interface ImageAsset {
  readonly id: string;
  readonly caption: string;
  readonly clipVec: readonly number[];
  readonly colorVec: readonly number[];
}

const controller = new SimplexSvgController('#graph', {
  items: imageAssets,
  getLabel: (img) => img.caption,
  preset: 'glyphs',
  theme: 'dark',
  tooltip: true,
  clusteringStrategy: createEmbeddingClusteringStrategy<ImageAsset>({
    getEmbedding: [
      { name: 'Semantic', getVector: (i) => i.clipVec, weight: 0.7 },
      { name: 'Palette', getVector: (i) => i.colorVec, weight: 0.3 },
    ],
    metric: 'cosine',
    anchorRule: 'simplex-projection',
  }),
  colorStrategy: createThemeAdaptiveOklabColorStrategy(),
  layoutStrategy: createLocalAdaptiveLayoutStrategy({ warmStart: true }),
});
```

// Swap any pipeline stage live without resetting camera pan/zoom:
controller.setColorStrategy(createOklabContrastColorStrategy());
controller.setLayoutStrategy(createWarmStartPbdLayoutStrategy());
```

## Progressive Customization: Custom `VisualResolver` & `SvgNodeView`

Whenever built-in presets are not specific enough, swap in your own `VisualResolver`, view plugins, or root-SVG event handlers without rewriting the container lifecycle.

### Step 1 — Define Your Domain Record & `VisualResolver`

Map each item and topic cluster into typed descriptors for any `SvgNodeView` plugin. Notice that `VisualResolver` and descriptor types can be imported directly from `@simplex-viz/svg`:

```ts
import type {
  ClusterAnchorVisual,
  GeometricShapeVisual,
  VisualResolver,
} from '@simplex-viz/svg';

interface Bookmark {
  readonly url: string;
  readonly title: string;
  readonly topics: readonly string[];
  readonly minutes: number;
}

const visualResolver: VisualResolver<
  Bookmark,
  GeometricShapeVisual,
  ClusterAnchorVisual
> = {
  resolveContentVisual: (bookmark, ctx) => ({
    shape: bookmark.minutes > 10 ? 'star' : 'circle',
    radius: 10,
    fillHex: ctx.mixedColorHex,
    strokeHex: '#07090E',
    strokeWidth: 1.4,
  }),
  resolveClusterVisual: (cluster) => ({
    code: cluster.code,
    label: cluster.defaultLabel,
    memberCount: cluster.members.length,
    colorHex: cluster.colorHex,
    radius: 22,
  }),
  getVisualCacheKey: (visual) =>
    'shape' in visual
      ? `${visual.shape}:${visual.radius}:${visual.fillHex}`
      : `${visual.code}:${visual.memberCount}:${visual.colorHex}`,
};
```

### Step 2 — Mount `SimplexSvgController` with Custom Views

Pass `visualResolver` together with `contentView` and `clusterView` plugins. You can omit `interactions` to keep default cluster click-focus and cursor zoom, or override individual handlers below:

```ts
import {
  SimplexSvgController,
  GeometricShapeSvgView,
  ClusterAnchorSvgView,
} from '@simplex-viz/svg';

const controller = new SimplexSvgController('#graph', {
  items: myBookmarks,
  getId: (b) => b.url,
  getTags: (b) => b.topics,
  visualResolver,
  contentView: new GeometricShapeSvgView(),
  clusterView: new ClusterAnchorSvgView(),
  meshOptions: { innerPadding: 48, minSideLength: 140, maxSideLength: 280, maxClusters: 10 },
  layoutOptions: { clusterGapPx: 14, itemGapPx: 5 },
  onMetricsChange: (metrics) => {
    console.log(`Clusters: ${metrics.clusterCount}, Overlaps: ${metrics.overlapCount}`);
  },
});
```

### Step 3 — Override Hover, Click & Wheel Interactions

Attach custom click, context-menu, and wheel policies at any time via `setInteractions`. Setting `interactions.onLeftClick` overrides the default cluster click-focus toggle:

```ts
controller.setInteractions({
  onContentHover: (ev) => {
    if (ev) console.log('Hovered item:', ev.item.title, ev.screenPosition);
  },
  onLeftClick: (target) => {
    if (target.kind === 'content') {
      console.log('Clicked:', target.item.title);
    } else if (target.kind === 'cluster') {
      controller.setFocusedClusterUid(target.cluster.clusterUid);
    } else {
      controller.setFocusedClusterUid(null);
    }
  },
  onRightClick: (target) => {
    console.log('Context menu target:', target.kind);
    return true; // Suppress browser default context menu
  },
  onWheel: 'zoom-to-cursor',
});
```

Always call `controller.destroy()` when tearing down your component or view to cancel animations, clean up tooltips, and disconnect `ResizeObserver`.

## Built-In `SvgNodeView` Plugins

### 1. `GeometricShapeSvgView`
Renders `'circle' | 'diamond' | 'star' | 'hexagon'` with analytical convex hulls and **64-point parametric SVG path morphing** between shapes and colors. Pass a `GeometricShapeVisual` descriptor from `resolveContentVisual` to control polygon kind, radius, fill, and outline stroke:

```ts
import type { GeometricShapeVisual } from '@simplex-viz/svg';

const visual: GeometricShapeVisual = {
  shape: 'hexagon', // 'circle' | 'diamond' | 'star' | 'hexagon'
  radius: 11,
  fillHex: ctx.mixedColorHex,
  strokeHex: '#07090E',
  strokeWidth: 1.4,
};
```

### 2. `MultiSectorGlyphSvgView`
Renders a multi-colored donut glyph whose sector arc angles match an item's exact barycentric weights across its active simplex unit (vertex, edge, or triangle). Map `ctx.unitClusters` directly into `sectors` as shown below to reflect multi-topic membership visually:

```ts
import type { MultiSectorGlyphVisual } from '@simplex-viz/svg';

const visual: MultiSectorGlyphVisual = {
  outerRadius: 12,
  innerRadius: 5,
  sectors: ctx.unitClusters.map((uc) => ({
    colorHex: uc.cluster.colorHex,
    weight: uc.weight,
  })),
  centerColorHex: ctx.mixedColorHex,
};
```

### 3. `BadgeClusterSvgView`
Renders dynamic pill/card cluster badges sized to their title and metadata line. Because it intentionally omits `measureConvexHull`, `@simplex-viz/svg` measures the rendered `<svg>` elements via `getBBox()` so varying title lengths remain strictly overlap-free:

```ts
import type { BadgeClusterVisual } from '@simplex-viz/svg';

const visual: BadgeClusterVisual = {
  code: cluster.code,
  title: cluster.defaultLabel,
  metaLine: `${cluster.members.length} items`,
  colorHex: cluster.colorHex,
};
```

### 4. `ClusterAnchorSvgView`
Renders calibrated double-ring vertex anchors showing the cluster code and member count. Supply a `ClusterAnchorVisual` descriptor when you want compact circular topic anchors on mesh vertices:

```ts
import type { ClusterAnchorVisual } from '@simplex-viz/svg';

const visual: ClusterAnchorVisual = {
  code: cluster.code,
  label: cluster.defaultLabel,
  memberCount: cluster.members.length,
  colorHex: cluster.colorHex,
  radius: 23,
};
```

## Pluggable Triangle Faces & Mesh Edges (`SvgTriangleView` & `SvgEdgeView`)

Every mesh triangle face (`MeshTriangleRenderState`) and edge (`MeshEdgeRenderState`) is rendered through swappable `SvgTriangleView` and `SvgEdgeView` plugins. Triangle faces automatically participate in world-coordinate hit-testing: hovering illuminates the face and opens tooltips (`onTriangleHover`), left-clicking toggles triangle isolation (`focusOnTriangleClick`, default `true`), and pressing + dragging still pans smoothly across faces.

```ts
import {
  SimplexSvgController,
  BarycentricSectorTriangleSvgView,
  ClusterTintedEdgeSvgView,
  DensityHeatmapTriangleSvgView,
  PrecisionRailEdgeSvgView,
} from '@simplex-viz/svg';

const controller = new SimplexSvgController('#graph', {
  items,
  preset: 'glyphs',
  tooltip: true,
  triangleView: new BarycentricSectorTriangleSvgView({ baseOpacity: 0.14 }),
  edgeView: new ClusterTintedEdgeSvgView({ strokeWidth: 1.4 }),
});

// Hot-swap triangle face and edge renderers at runtime without re-running layout:
controller.setTriangleView(new DensityHeatmapTriangleSvgView({ peakItemCount: 10 }));
controller.setEdgeView(new PrecisionRailEdgeSvgView({ railOffset: 1.8 }));
```

### Built-In `SvgTriangleView` Plugins
- `OklabTintTriangleSvgView` *(default)* — Perceptual OKLab-blended face fill with hover/focus border emphasis and vertex markers.
- `GradientTriangleSvgView` — Continuous barycentric gradient shading using three isolated `plus-lighter` `<linearGradient>` passes so shared vertices and edges flow seamlessly across the entire triangulation.
- `BarycentricSectorTriangleSvgView` — Splits each triangle around its centroid into three cluster-colored corner sectors with optional dashed medians.
- `BlueprintInsetTriangleSvgView` — Architectural double-frame triangle with centroid cross reticle on hover/focus.
- `DensityHeatmapTriangleSvgView` — Scales face saturation by `coveredItemCount` and displays an item count pill at the centroid.

### Built-In `SvgEdgeView` Plugins
- `DashedMeshEdgeSvgView` *(default)* — Crisp dashed lattice edges that illuminate in blended OKLab color when adjacent clusters or triangles are hovered/focused.
- `ClusterTintedEdgeSvgView` — Tri-segment gradient look transitioning smoothly between endpoint cluster hues and their OKLab midpoint mix.
- `PrecisionRailEdgeSvgView` — Parallel double-rail lines with a midpoint diamond marker.
- `MinimalHighlightEdgeSvgView` — Faint structural guides at rest that brighten cleanly on adjacent hover or focus.

## Writing Custom `SvgNodeView` Plugins

Implement `SvgNodeView<TVisual>` centered around local origin `(0, 0)`. `SvgRendererAdapter` handles world positioning `(x, y)`, solver scale `α`, opacity, and crossfading on the parent `<g>`.

First, define your visual descriptor and an optional analytical hull via `measureConvexHull` (re-exporting `rectToConvexPolygon` straight from `@simplex-viz/svg`, or omit `measureConvexHull` to measure automatically via offscreen `getBBox()`):

```ts
import { rectToConvexPolygon, type SvgNodeView } from '@simplex-viz/svg';

interface CardVisual {
  readonly title: string;
  readonly colorHex: string;
}

const getCardWidth = (title: string) => Math.max(80, title.length * 7 + 20);
```

Next, populate `mountOrUpdate` to construct pure SVG nodes inside `groupEl`, reacting to `state.interaction.isHovered` for instant border emphasis:

```ts
const SVG_NS = 'http://www.w3.org/2000/svg';

export const CustomCardSvgView: SvgNodeView<CardVisual> = {
  // Optional: omit to measure automatically via offscreen getBBox()
  measureConvexHull: (visual) =>
    rectToConvexPolygon(getCardWidth(visual.title), 28, 6),

  mountOrUpdate: (groupEl, visual, state) => {
    const doc = groupEl.ownerDocument;
    while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild);

    const width = getCardWidth(visual.title);
    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(-width / 2));
    rect.setAttribute('y', '-14');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', '28');
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', '#0d1320');
    rect.setAttribute(
      'stroke',
      state.interaction.isHovered ? '#f8fafc' : visual.colorHex,
    );
    rect.setAttribute('stroke-width', state.interaction.isHovered ? '2' : '1.2');

    const text = doc.createElementNS(SVG_NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('y', '4');
    text.setAttribute('fill', '#f8fafc');
    text.setAttribute('font-size', '11');
    text.textContent = visual.title;

    groupEl.appendChild(rect);
    groupEl.appendChild(text);
  },

  // Optional: omit to use universal dual-layer crossfade
  // morph: (groupEl, from, to, progress, state) => false,
};
```

## API Reference (`createSimplexSvg` & `SimplexSvgController`)

`SimplexSvgController(target, options)` accepts an `HTMLElement` or CSS selector string. `createSimplexSvg(target, itemsOrOptions)` accepts either a `{ id, tags }` array directly (with `tooltip: true`, cursor zoom, and cluster click-focus enabled) or any `SimplexSvgControllerOptions` object. `@simplex-viz/svg` also re-exports `solveSimplexSnapshot`, geometry hull helpers (`computeConvexHull`, `rectToConvexPolygon`, `regularPolygon`, `starConvexHull`), and core TypeScript types for single-import setups.

| Method / Option | Description |
| --- | --- |
| `preset` / `setPreset(preset, getLabel?)` | Switches between `'geometric'`, `'glyphs'`, and `'badges'` with smooth transitions. |
| `theme` / `setTheme(theme)` | Switches `'dark'` / `'light'` presets and notifies theme-aware color strategies. |
| `meshStrategy` / `setMeshStrategy(strategy)` | Swaps `SimplexMeshStrategy` (`createAdaptiveHexMeshStrategy`, `createFixedLatticeMeshStrategy`, or custom). |
| `clusteringStrategy` / `setClusteringStrategy(strategy)` | Swaps `SimplexClusteringStrategy` (`createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`, `createEmbeddingClusteringStrategy`, `createSimilarityClusteringStrategy`, or custom). When supplying a non-tag strategy, `getTags` is optional. |
| `colorStrategy` / `setColorStrategy(strategy)` | Swaps `SimplexColorStrategy` (`createOklabContrastColorStrategy`, `createThemeAdaptiveOklabColorStrategy`, `createPaletteColorStrategy`, or custom). |
| `layoutStrategy` / `setLayoutStrategy(strategy)` | Swaps `SimplexLayoutStrategy` (`createPbdUniformLayoutStrategy`, `createWarmStartPbdLayoutStrategy`, `createLocalAdaptiveLayoutStrategy`, or custom). |
| `setMeshOptions(opts)` / `setLayoutOptions(opts)` | Updates `MeshOptions` or `LayoutSolverOptions` at runtime. |
| `getMeshStrategy()` / `getClusteringStrategy()` / `getColorStrategy()` / `getLayoutStrategy()` | Inspects the currently active core strategy instances. |
| `tooltip` / `setTooltip(tooltip)` | Enables a floating DOM hover tooltip (`boolean` or `(target) => string` formatter for `'content'`, `'cluster'`, and `'triangle'`). |
| `focusOnClusterClick` | Option (default `true`): toggles cluster focus on click when no custom `interactions.onLeftClick` is provided. |
| `focusOnTriangleClick` | Option (default `true`): toggles triangle face focus on click when no custom `interactions.onLeftClick` is provided. |
| `triangleView` / `setTriangleView(view)` | Swaps the `SvgTriangleView` plugin rendering triangulation faces (`OklabTintTriangleSvgView`, `GradientTriangleSvgView`, `BarycentricSectorTriangleSvgView`, `BlueprintInsetTriangleSvgView`, `DensityHeatmapTriangleSvgView`, or custom). |
| `edgeView` / `setEdgeView(view)` | Swaps the `SvgEdgeView` plugin rendering mesh edges (`DashedMeshEdgeSvgView`, `ClusterTintedEdgeSvgView`, `PrecisionRailEdgeSvgView`, `MinimalHighlightEdgeSvgView`, or custom). |
| `addItems(items)` | Appends one or more items and triggers an interruptible transition. |
| `removeItems(ids)` | Removes items by ID and smoothly fades out exiting nodes. |
| `setItems(items)` | Replaces the entire corpus while preserving matching clusters & items. |
| `setViews({ contentView, clusterView, triangleView, edgeView })` | Hot-swaps node, triangle face, and mesh edge view plugins at runtime. |
| `setVisualResolver(resolver)` | Updates descriptor resolution and crossfades smoothly. |
| `setSizeMultiplier(multiplier)` | Uniformly scales node sizes (`0.35` – `3.0`) and re-solves zero overlap. |
| `setShowHulls(show)` | Toggles convex bounding hull wireframe overlays. |
| `setPinnedIds(ids)` / `setHighlightedIds(ids)` | Controls pinned and highlighted visual emphasis states. |
| `setFocusedClusterUid(uid \| null)` | Isolates a cluster and its members, dimming unrelated nodes. |
| `setFocusedTriangleIndex(index \| null)` | Isolates a triangulation triangle face, its adjacent edges, vertices, and contained items. |
| `setInteractions(handlers)` | Replaces pointer, click, and wheel callbacks dynamically (`onContentHover`, `onClusterHover`, `onTriangleHover`, `onLeftClick`, `onRightClick`, `onWheel`). |
| `camera` | Exposes `CameraController` (`zoomToCursor`, `panBy`, `reset`, `getState`, `setState`) with immediate synchronous `<svg>` transform updates. |
| `getMetrics()` / `getClusters()` / `getItems()` | Reads live solver telemetry, clusters, and items. |
| `getSvgElement()` | Returns the managed root `<svg>` element. |
| `stepForTest(dtMs)` | Deterministically advances simulation time in unit/DOM tests. |
| `destroy()` | Cancels `requestAnimationFrame`, disconnects `ResizeObserver`, removes tooltips and `<svg>`. |

## License

MIT — see [LICENSE](https://github.com/ghackenberg/simplex-viz/blob/main/LICENSE).
