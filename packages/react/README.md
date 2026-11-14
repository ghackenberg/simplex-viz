<p align="center">
  <img src="https://raw.githubusercontent.com/ghackenberg/simplex-viz/main/docs/assets/logo-react.png" width="525" alt="SimplexViz / react — @simplex-viz/react" />
</p>

# @simplex-viz/react

End-to-end type-safe React bindings, declarative JSX node renderers, and imperative controller hooks for `@simplex-viz/core` and `@simplex-viz/svg`.

- **Live Demo:** <https://hackenberg.tech/simplex-viz/>
- **Source & Monorepo:** <https://github.com/ghackenberg/simplex-viz/tree/main/packages/react>
- **Companion Packages:** [`@simplex-viz/core`](https://www.npmjs.com/package/@simplex-viz/core) · [`@simplex-viz/svg`](https://www.npmjs.com/package/@simplex-viz/svg)

## Declarative JSX Slot Architecture

In React, `<SimplexTopicGraph />` lets you drop custom JSX directly into cluster and content slots instead of hand-writing imperative SVG DOM code. The wireframe preview below illustrates how those two component slots populate a single visualization:

<p align="center">
  <img src="https://raw.githubusercontent.com/ghackenberg/simplex-viz/main/docs/assets/preview-react.png" width="100%" alt="@simplex-viz/react preview showing minimalist renderClusterNode and renderContentNode JSX slot placeholders with automatic getBBox() collision sizing" />
</p>

*Figure: Architectural slot layout rendered with `@simplex-viz/react`. Dashed topic cards illustrate the `renderClusterNode` JSX slot positioned on a subtle 60° simplex mesh, while minimalist skeleton content cards represent `renderContentNode` slots complete with color accents, type/time metadata, and interactive selection highlights (amber for pinned, cyan for hovered). Every JSX element is measured automatically via offscreen `getBBox()` so custom React SVG cards remain strictly overlap-free.*

## Features

- **`<SimplexTopicGraph />`**: Responsive, zero-overlap triangulation graph component that automatically observes container resizing, computes cluster layouts, and drives 60 fps spring animations.
- **Two rendering modes** (mix and match or swap live with smooth crossfading):
  1. **Declarative JSX Renderers** (`renderContentNode`, `renderClusterNode`): Write standard React SVG JSX (`<g>`, `<rect>`, `<text>`, `<circle>`). Nodes are automatically measured via offscreen `getBBox()` for collision-free placement.
  2. **Portable `Svg*View` Plugins** (`contentView`, `clusterView`, `triangleView`, `edgeView` from `@simplex-viz/svg`): Direct SVG DOM updates with zero React reconciliation overhead per animation frame, including swappable triangle face (`OklabTintTriangleSvgView`, `GradientTriangleSvgView`, `BarycentricSectorTriangleSvgView`, `BlueprintInsetTriangleSvgView`, `DensityHeatmapTriangleSvgView`) and mesh edge (`DashedMeshEdgeSvgView`, `ClusterTintedEdgeSvgView`, `PrecisionRailEdgeSvgView`, `MinimalHighlightEdgeSvgView`) views.
- **Interactive triangulation faces**: Built-in triangle hit-testing with hover emphasis (`onTriangleHover`), click-to-focus (`focusOnTriangleClick`, `focusedTriangleIndex`), and tooltip targets (`target.kind === 'triangle'`).
- **Full generic type inference**: Infers `<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>` end-to-end across `items`, `getId`, `getTags`, `deriveClusterMeta`, `visualResolver`, `renderContentNode`, `renderClusterNode`, hover events, and click targets.
- **`useSimplexGraphController`**: Imperative hook for live item mutations (`addItems`, `removeItems`, `setItems`), view/strategy hot-swapping (`setTriangleView`, `setEdgeView`, `set*Strategy`), camera controls (`zoomBy`, `resetCamera`), and telemetry getters.

## Installation

Install `@simplex-viz/react` (`@simplex-viz/core` and `@simplex-viz/svg` are bundled as dependencies, and their views, helpers, and TypeScript types are re-exported directly from `@simplex-viz/react`; requires `react >= 18.0.0` and `react-dom >= 18.0.0`):

```bash
npm install @simplex-viz/react
```

## Quickstart (Zero-Config)

Render `<SimplexTopicGraph />` with any array of `{ id, tags }` objects. Drag-to-pan, cursor wheel zoom (`onWheel="zoom-to-cursor"`), cluster click-focus (`focusOnClusterClick`), and optional hover tooltips (`tooltip`) work immediately without a `VisualResolver` or view plugins:

```tsx
import { SimplexTopicGraph } from '@simplex-viz/react';

const items = [
  { id: '1', label: 'Simplex Mesh', tags: ['geometry', 'triangulation', 'math'] },
  { id: '2', label: 'OKLab Mixing', tags: ['color', 'geometry', 'perception'] },
  { id: '3', label: 'SAT Solver', tags: ['collision', 'geometry'] },
];

export function QuickTopicMap() {
  return (
    <div style={{ width: '100%', height: 560 }}>
      <SimplexTopicGraph items={items} preset="geometric" tooltip />
    </div>
  );
}
```

### Switch Visual Presets & Customize Tooltips

Swap between the three built-in presets (`'geometric'`, `'glyphs'`, or `'badges'`) with live animated morphing/crossfading, pass `getLabel` for custom records, or supply a React JSX `tooltip` renderer:

```tsx
<SimplexTopicGraph
  items={articles}
  getId={(a) => a.slug}
  getTags={(a) => a.hashtags}
  getLabel={(a) => a.title}
  preset="glyphs"
  tooltip={(target) => {
    if (target.kind === 'content') {
      return (
        <div>
          <strong>{target.item.title}</strong>
          <div>{`${target.item.readingMinutes} min read`}</div>
        </div>
      );
    }
    if (target.kind === 'cluster') {
      return (
        <strong>{`${target.cluster.defaultLabel} (${target.cluster.members.length})`}</strong>
      );
    }
    return (
      <strong>{`Triangle #${target.triangle.index + 1} (${target.triangle.coveredItemCount} items)`}</strong>
    );
  }}
/>
```

## Level 2 — Keyless Declarative JSX Renderers

Want bespoke React SVG cards without writing a `VisualResolver`? Pass `renderContentNode` and/or `renderClusterNode` directly—`@simplex-viz/react` manages cache keys automatically (customizable via optional `getContentCacheKey` / `getClusterCacheKey`) and measures your JSX via offscreen `getBBox()`:

```tsx
import { SimplexTopicGraph } from '@simplex-viz/react';

interface Article {
  readonly slug: string;
  readonly title: string;
  readonly hashtags: readonly string[];
}

export function CardMap({ articles }: { articles: readonly Article[] }) {
  return (
    <SimplexTopicGraph
      items={articles}
      getId={(a) => a.slug}
      getTags={(a) => a.hashtags}
      tooltip
      renderContentNode={(article, ctx, state) => (
        <g>
          <rect
            x={-54}
            y={-15}
            width={108}
            height={30}
            rx={6}
            fill="#0f172a"
            stroke={state.interaction.isHovered ? '#f8fafc' : ctx.mixedColorHex}
            strokeWidth={state.interaction.isHovered ? 2 : 1.2}
          />
          <text textAnchor="middle" y={4} fill="#f8fafc" fontSize={9}>
            {article.title.slice(0, 16)}
          </text>
        </g>
      )}
    />
  );
}
```

Notice that you can even customize only `renderContentNode` while letting `preset="badges"` handle cluster cards automatically.

## Level 3 — Full Custom `VisualResolver`, Controlled State & Imperative Hook

For full control over cluster aggregation (`deriveClusterMeta`), explicit visual cache keys, pinned items, controlled cluster focus, and external camera toolbars, combine `<SimplexTopicGraph />` with `useSimplexGraphController`.

### Step 1 — Define Domain, Visual, and Cluster Metadata Types

Describe your domain item (`Article`), visual cache descriptors (`ArticleVisual`, `ClusterVisual`), and aggregate cluster stats (`ClusterStats`). TypeScript preserves these types across every callback prop on `<SimplexTopicGraph />`:

```tsx
interface Article {
  readonly slug: string;
  readonly title: string;
  readonly hashtags: readonly string[];
  readonly readingMinutes: number;
}

interface ArticleVisual {
  readonly key: string;
  readonly title: string;
  readonly colorHex: string;
}

interface ClusterVisual {
  readonly key: string;
  readonly code: string;
  readonly label: string;
  readonly colorHex: string;
  readonly count: number;
}

interface ClusterStats {
  readonly count: number;
  readonly avgMinutes: number;
}
```

### Step 2 — Define Typed Declarative JSX Node Renderers

Write standard SVG JSX centered around `(0, 0)` for individual items and topic clusters. `@simplex-viz/react` measures the resulting `<g>` subtree automatically via offscreen `getBBox()` whenever `getVisualCacheKey` changes, guaranteeing collision-free card placement:

```tsx
import type {
  ClusterDescriptor,
  ContentLayoutContext,
  NodeRenderState,
} from '@simplex-viz/react';

const renderArticleNode = (
  article: Article,
  ctx: ContentLayoutContext<Article, undefined, ClusterStats>,
  state: NodeRenderState<ArticleVisual>,
) => (
  <g>
    <rect
      x={-54}
      y={-15}
      width={108}
      height={30}
      rx={6}
      fill="#0f172a"
      stroke={state.interaction.isPinned ? '#f59e0b' : ctx.mixedColorHex}
      strokeWidth={state.interaction.isHovered ? 2 : 1.2}
    />
    <text textAnchor="middle" y={4} fill="#f8fafc" fontSize={9}>
      {article.title.slice(0, 16)}
    </text>
  </g>
);

const renderTopicCluster = (
  cluster: ClusterDescriptor<Article, undefined, ClusterStats>,
  state: NodeRenderState<ClusterVisual>,
) => (
  <g>
    <rect
      x={-68}
      y={-20}
      width={136}
      height={40}
      rx={8}
      fill="#090d16"
      stroke={state.interaction.isHovered ? '#f8fafc' : cluster.colorHex}
      strokeWidth={1.6}
    />
    <text textAnchor="middle" y={-2} fill="#f8fafc" fontSize={10} fontWeight={600}>
      {`${cluster.code} · ${cluster.defaultLabel}`}
    </text>
    <text textAnchor="middle" y={12} fill="#94a3b8" fontSize={8.5}>
      {`${cluster.meta.count} items · avg ${cluster.meta.avgMinutes.toFixed(0)}m`}
    </text>
  </g>
);
```

### Step 3 — Initialize State, Controller Hook & Memoized `VisualResolver`

Inside your React component, set up selection state, create a typed controller handle with `useSimplexGraphController`, and memoize `visualResolver` with `useMemo` so re-renders never trigger unintended crossfade transitions:

```tsx
import { useMemo, useState } from 'react';
import {
  SimplexTopicGraph,
  useSimplexGraphController,
  type VisualResolver,
} from '@simplex-viz/react';

export function KnowledgeAtlas({ articles }: { articles: readonly Article[] }) {
  const [focusedClusterUid, setFocusedClusterUid] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());

  const { controllerRef, handle } = useSimplexGraphController<
    Article,
    ArticleVisual,
    ClusterVisual,
    undefined,
    ClusterStats
  >();

  const visualResolver = useMemo<
    VisualResolver<Article, ArticleVisual, ClusterVisual, undefined, ClusterStats>
  >(
    () => ({
      resolveContentVisual: (article, ctx) => ({
        key: `${article.slug}:${ctx.mixedColorHex}`,
        title: article.title,
        colorHex: ctx.mixedColorHex,
      }),
      resolveClusterVisual: (cluster) => ({
        key: `${cluster.clusterUid}:${cluster.meta.count}`,
        code: cluster.code,
        label: cluster.defaultLabel,
        colorHex: cluster.colorHex,
        count: cluster.meta.count,
      }),
      getVisualCacheKey: (visual) => visual.key,
    }),
    [],
  );
```

### Step 4 — Render `<SimplexTopicGraph />` with Camera Toolbar & Click Handling

Finally, wire the camera toolbar (`handle.zoomBy`, `handle.resetCamera`), pass the JSX renderers from Step 2, and handle left-clicks to toggle pinned items or isolate clicked topic clusters:

```tsx
  return (
    <div style={{ width: '100%', height: '640px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
        <button onClick={() => handle.zoomBy(1.2)}>Zoom In</button>
        <button onClick={() => handle.zoomBy(0.8)}>Zoom Out</button>
        <button onClick={() => handle.resetCamera()}>Reset Camera</button>
      </div>

      <SimplexTopicGraph
        controllerRef={controllerRef}
        items={articles}
        getId={(a) => a.slug}
        getTags={(a) => a.hashtags}
        deriveClusterMeta={(ctx) => ({
          count: ctx.members.length,
          avgMinutes:
            ctx.members.reduce((sum, m) => sum + m.item.readingMinutes, 0) /
            Math.max(1, ctx.members.length),
        })}
        visualResolver={visualResolver}
        pinnedIds={pinnedIds}
        focusedClusterUid={focusedClusterUid}
        renderContentNode={renderArticleNode}
        renderClusterNode={renderTopicCluster}
        onLeftClick={(target) => {
          if (target.kind === 'content') {
            setPinnedIds((prev) => {
              const next = new Set(prev);
              if (next.has(target.item.slug)) next.delete(target.item.slug);
              else next.add(target.item.slug);
              return next;
            });
          } else if (target.kind === 'cluster') {
            setFocusedClusterUid((cur) =>
              cur === target.cluster.clusterUid ? null : target.cluster.clusterUid,
            );
          } else {
            setFocusedClusterUid(null);
          }
        }}
      />
    </div>
  );
}
```

## Level 4 — Portable `SvgNodeView` Plugins (60 fps Without JSX Re-Renders)

For larger graphs or custom 64-point shape morphing without per-frame JSX overhead, instantiate `GeometricShapeSvgView` and `ClusterAnchorSvgView` (both re-exported directly from `@simplex-viz/react`) once outside the component and pass them via `contentView` and `clusterView`:

```tsx
import {
  SimplexTopicGraph,
  GeometricShapeSvgView,
  ClusterAnchorSvgView,
  type GeometricShapeVisual,
  type ClusterAnchorVisual,
  type VisualResolver,
  type DefaultTaggedItem,
} from '@simplex-viz/react';

const contentView = new GeometricShapeSvgView();
const clusterView = new ClusterAnchorSvgView();

export function FastGraph({
  items,
  visualResolver,
}: {
  items: readonly DefaultTaggedItem[];
  visualResolver: VisualResolver<DefaultTaggedItem, GeometricShapeVisual, ClusterAnchorVisual>;
}) {
  return (
    <SimplexTopicGraph<DefaultTaggedItem, GeometricShapeVisual, ClusterAnchorVisual>
      items={items}
      visualResolver={visualResolver}
      contentView={contentView}
      clusterView={clusterView}
    />
  );
}
```

> **Tip:** Memoize `visualResolver` (e.g., via `useMemo`) and keep `contentView` / `clusterView` instances stable outside render to avoid unnecessary crossfades. Changing `preset`, `visualResolver`, or switching view props intentionally triggers a smooth crossfade/morph transition.

## Combining Presets & Pluggable Core Strategies (Tags, Embeddings & Similarities)

Every `@simplex-viz/core` strategy factory is re-exported from `@simplex-viz/react`—including **`createEmbeddingClusteringStrategy`** (single or weighted multi-modal vector spaces on completely untagged items), **`createSimilarityClusteringStrategy`** (arbitrary pairwise similarity kernels), tag strategies (`createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`), and mesh, color, and layout strategies:

```tsx
import { useMemo, useState } from 'react';
import {
  SimplexTopicGraph,
  createEmbeddingClusteringStrategy,
  createLocalAdaptiveLayoutStrategy,
  createThemeAdaptiveOklabColorStrategy,
} from '@simplex-viz/react';

interface VoiceClip {
  readonly id: string;
  readonly speaker: string;
  readonly timbreVec: readonly number[];
  readonly prosodyVec: readonly number[];
}

export function VoiceSignatureMap({ clips }: { clips: readonly VoiceClip[] }) {
  const [theme] = useState<'dark' | 'light'>('dark');

  const clusteringStrategy = useMemo(
    () =>
      createEmbeddingClusteringStrategy<VoiceClip>({
        getEmbedding: [
          { name: 'Timbre', getVector: (c) => c.timbreVec, weight: 0.7 },
          { name: 'Prosody', getVector: (c) => c.prosodyVec, weight: 0.3 },
        ],
        metric: 'cosine',
        anchorRule: 'simplex-projection',
      }),
    [],
  );
  const colorStrategy = useMemo(
    () => createThemeAdaptiveOklabColorStrategy<VoiceClip>(),
    [],
  );
  const layoutStrategy = useMemo(
    () => createLocalAdaptiveLayoutStrategy({ warmStart: true }),
    [],
  );

  return (
    <SimplexTopicGraph
      items={clips}
      getLabel={(c) => c.speaker}
      preset="badges"
      theme={theme}
      clusteringStrategy={clusteringStrategy}
      colorStrategy={colorStrategy}
      layoutStrategy={layoutStrategy}
      tooltip
    />
  );
}
```

## `<SimplexTopicGraph />` Props Reference

### Data, Typing & Metadata
| Prop | Required | Description |
| --- | --- | --- |
| `items` | Yes | `readonly TItem[]` — Domain items to cluster and lay out. |
| `getId` | If `TItem` lacks `id` | `(item: TItem) => string` — Extracts a unique ID per item. |
| `getTags` | If `TItem` lacks `tags` and no `clusteringStrategy` is passed | `(item: TItem) => readonly string[]` — Extracts raw tag strings per item (optional when using `createEmbeddingClusteringStrategy` or `createSimilarityClusteringStrategy`). |
| `getLabel` | No | `(item: TItem) => string` — Optional label extractor used by presets and default hover tooltips. |
| `normalizeTag` | No | `(rawTag: string) => string` — Custom tag normalizer (defaults to lowercase trim + `#` strip). |
| `resolveTagMeta` | No | `(normalizedTag: string) => TTagMeta \| undefined` — Attaches domain metadata to each tag. |
| `deriveClusterMeta` | If `TClusterMeta` is defined | `(ctx) => TClusterMeta` — Derives aggregate metadata once per cluster update (`members`, `representativeItems`, `centroid`, `cohesion`, `featureSummary`, `coreTags`, `sharedTags`). |

### Visuals, Presets & Renderers
| Prop | Default | Description |
| --- | --- | --- |
| `preset` | `'geometric'` | Built-in visual preset (`'geometric' \| 'glyphs' \| 'badges'`) used when custom views or `visualResolver` are omitted. |
| `theme` | `'dark'` | Color theme (`'dark' \| 'light'`) applied to built-in presets, tooltips, and theme-adaptive color strategies. |
| `visualResolver` | Built-in preset resolver | Optional `VisualResolver` mapping items and clusters to custom descriptors and cache keys. |
| `renderContentNode` | — | Declarative React JSX renderer `(item, ctx, state) => ReactNode` (works with or without `visualResolver`, auto-measured via `getBBox()`). |
| `renderClusterNode` | — | Declarative React JSX renderer `(cluster, state) => ReactNode` (works with or without `visualResolver`, auto-measured via `getBBox()`). |
| `getContentCacheKey` | Auto-generated | Optional cache key callback `(item, ctx) => string` for keyless `renderContentNode`. |
| `getClusterCacheKey` | Auto-generated | Optional cache key callback `(cluster) => string` for keyless `renderClusterNode`. |
| `contentView` | Preset view | Portable `SvgNodeView<TContentVisual>` plugin (used when `renderContentNode` is omitted). |
| `clusterView` | Preset view | Portable `SvgNodeView<TClusterVisual>` plugin (used when `renderClusterNode` is omitted). |
| `triangleView` | `OklabTintTriangleSvgView` | Portable `SvgTriangleView` plugin for triangulation faces (`OklabTintTriangleSvgView`, `GradientTriangleSvgView`, `BarycentricSectorTriangleSvgView`, `BlueprintInsetTriangleSvgView`, `DensityHeatmapTriangleSvgView`, or custom). |
| `edgeView` | `DashedMeshEdgeSvgView` | Portable `SvgEdgeView` plugin for mesh edges (`DashedMeshEdgeSvgView`, `ClusterTintedEdgeSvgView`, `PrecisionRailEdgeSvgView`, `MinimalHighlightEdgeSvgView`, or custom). |

### Mesh, Solver, Strategies & Visual Emphasis
| Prop | Default | Description |
| --- | --- | --- |
| `meshOptions` | — | `{ innerPadding, minSideLength, maxSideLength, maxClusters }`. |
| `layoutOptions` | — | `{ clusterGapPx, itemGapPx, minContentScale, relaxationIterations, seed }`. |
| `meshStrategy` | `createAdaptiveHexMeshStrategy()` | Pluggable `SimplexMeshStrategy<TItem>` controlling 60° triangulation layout. |
| `clusteringStrategy` | `createJaccardAnnealingClusteringStrategy()` | Pluggable `SimplexClusteringStrategy<TItem, TTagMeta>` (`createEmbeddingClusteringStrategy`, `createSimilarityClusteringStrategy`, `createJaccardAnnealingClusteringStrategy`, `createIncrementalAnchorClusteringStrategy`, or custom). |
| `colorStrategy` | `createOklabContrastColorStrategy()` | Pluggable `SimplexColorStrategy<TItem, TTagMeta>` (OKLab contrast, theme-adaptive, or custom palette). |
| `layoutStrategy` | `createPbdUniformLayoutStrategy()` | Pluggable `SimplexLayoutStrategy` (`pbd-uniform`, `pbd-warm-start`, `local-adaptive`, or custom). |
| `sizeMultiplier` | `1.0` | Uniform node size multiplier (`0.35` – `3.0`). |
| `showHulls` | `false` | Renders convex bounding hull wireframes over nodes. |
| `pinnedIds` | — | `ReadonlySet<string> \| readonly string[]` of pinned item IDs. |
| `highlightedIds` | — | `ReadonlySet<string> \| readonly string[]` of highlighted item IDs (dims others). |
| `focusedClusterUid` | `null` | Controlled cluster focus UID. When omitted (`undefined`), clicking clusters toggles focus automatically. |
| `focusedTriangleIndex` | `null` | Controlled triangle face index. When omitted (`undefined`), clicking triangles toggles triangle isolation automatically. |
| `className` / `style` | — | Styling forwarded to the outer container `<div>` (defaults to `width: 100%; height: 100%`). |

### Interactions, Tooltips, Telemetry & Controller
| Prop | Default / Signature | Description |
| --- | --- | --- |
| `tooltip` | `false` | `boolean \| ((target: SimplexReactTooltipTarget) => ReactNode)` — Renders a built-in floating React `role="tooltip"` overlay for `'content'`, `'cluster'`, and `'triangle'` targets. |
| `focusOnClusterClick` | `true` | Automatically toggles cluster focus on click when `focusedClusterUid` and `onLeftClick` are omitted. |
| `focusOnTriangleClick` | `true` | Automatically toggles triangle face focus on click when `focusedTriangleIndex` and `onLeftClick` are omitted. |
| `onContentHover` | — | `(event: ContentHoverEvent \| null) => void` |
| `onClusterHover` | — | `(event: ClusterHoverEvent \| null) => void` |
| `onTriangleHover` | — | `(event: TriangleHoverEvent \| null) => void` |
| `onLeftClick` | — | `(target: HitTarget, rawEvent: NormalizedPointerEvent) => void` |
| `onRightClick` | — | `(target: HitTarget, rawEvent: NormalizedPointerEvent) => boolean \| void` (return `true` to suppress browser menu) |
| `onWheel` | `'zoom-to-cursor'` | `'zoom-to-cursor' \| 'pan-vertical' \| 'none' \| ((event, camera) => void)` |
| `onMetricsChange` | — | `(metrics: LayoutMetrics) => void` — Reports cluster count, scales `α`, `overlapCount`, `meshSideLength`, `areaEfficiency`. |
| `onClustersChange` | — | `(clusters: readonly ClusterDescriptor[]) => void` |
| `onFpsUpdate` | — | `(fps: number) => void` |
| `controllerRef` | — | Ref populated with the underlying `SimplexSvgController` instance. |

## `useSimplexGraphController()` Hook

Returns `{ controllerRef, handle }`:

- `handle.addItems(items)` — Appends items without resetting existing camera or springs.
- `handle.removeItems(ids)` — Removes items by ID with smooth fade-out.
- `handle.setItems(items)` — Replaces the active dataset.
- `handle.setTriangleView(view)` / `handle.setEdgeView(view)` / `handle.setFocusedTriangleIndex(index)` — Hot-swaps mesh triangle/edge renderers or updates triangle focus imperatively.
- `handle.setMeshStrategy(strategy)` / `handle.setClusteringStrategy(strategy)` / `handle.setColorStrategy(strategy)` / `handle.setLayoutStrategy(strategy)` — Hot-swaps core pipeline strategies imperatively.
- `handle.zoomBy(factor)` — Zooms relative to viewport center.
- `handle.resetCamera()` — Resets zoom & pan smoothly to `(1, 0, 0)`.
- `handle.getMetrics()` — Returns the latest `LayoutMetrics | null`.
- `handle.getClusters()` — Returns current `ClusterDescriptor[]`.
- `handle.getRawController()` — Returns the underlying `SimplexSvgController | null`.

## License

MIT — see [LICENSE](https://github.com/ghackenberg/simplex-viz/blob/main/LICENSE).
