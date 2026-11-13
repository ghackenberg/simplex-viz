/**
 * Default shape of a tagged item when no custom `getId` or `getTags` accessor is provided.
 */
export interface DefaultTaggedItem {
  readonly id: string;
  readonly tags: readonly string[];
}

/**
 * Conditional hybrid accessor configuration for arbitrary user domain items `TItem`.
 *
 * When `TItem` already contains `{ id: string }` and `{ tags: readonly string[] }`,
 * `getId` and `getTags` remain optional; otherwise TypeScript enforces providing them.
 */
export type ItemIdentityConfig<TItem> = (TItem extends { readonly id: string }
  ? { readonly getId?: (item: TItem) => string }
  : { readonly getId: (item: TItem) => string }) &
  (TItem extends { readonly tags: readonly string[] }
    ? { readonly getTags?: (item: TItem) => readonly string[] }
    : { readonly getTags: (item: TItem) => readonly string[] });

/**
 * Conditional configuration for deriving custom cluster metadata `TClusterMeta`.
 *
 * When `TClusterMeta` is `undefined`, `deriveClusterMeta` is optional. When a custom
 * `TClusterMeta` type is supplied, `deriveClusterMeta` becomes required at compile time.
 */
export type ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> = [TClusterMeta] extends [undefined]
  ? {
      readonly deriveClusterMeta?: (
        ctx: ClusterDerivationContext<TItem, TTagMeta>,
      ) => TClusterMeta;
    }
  : {
      readonly deriveClusterMeta: (
        ctx: ClusterDerivationContext<TItem, TTagMeta>,
      ) => TClusterMeta;
    };

/**
 * Normalized tag descriptor enriched with corpus frequency and optional user metadata.
 */
export interface TagDescriptor<TTagMeta = undefined> {
  /** Normalized canonical tag key. */
  readonly tag: string;
  /** Number of active items containing this tag. */
  readonly frequency: number;
  /** Optional domain metadata resolved via `resolveTagMeta`. */
  readonly meta: TTagMeta | undefined;
}

/**
 * Typed reference to a content item participating in a topic cluster.
 */
export interface ClusterMemberRef<TItem> {
  /** Unmodified original domain object with its exact type `TItem`. */
  readonly item: TItem;
  /** Canonical identifier extracted for this item. */
  readonly itemId: string;
  /** Raw tag coverage w_{ik} = |C_i ∩ T_k| / |T_k| in [0, 1]. */
  readonly coverage: number;
  /** Normalized barycentric weight \tilde{w}_{ik} in (0, 1] on the item's active simplex unit. */
  readonly normalizedWeight: number;
  /** True when 100% of the item's barycentric weight lies on this cluster vertex. */
  readonly isExclusiveVertexMember: boolean;
}

/**
 * Context passed to `deriveClusterMeta` once cluster tags, mesh vertex, and unit members are finalized.
 */
export interface ClusterDerivationContext<TItem, TTagMeta = undefined> {
  /** Index of the cluster vertex in the current mesh (0 .. K-1). */
  readonly clusterIndex: number;
  /** Stable cluster identity preserved across re-clusterings via bipartite matching. */
  readonly clusterUid: string;
  /** Short human-readable cluster code (e.g. "T1"). */
  readonly code: string;
  /** Default label derived from the top core tags. */
  readonly defaultLabel: string;
  /** Assigned perceptual sRGB hex color. */
  readonly colorHex: string;
  /** Assigned color in OKLab coordinates `[L, a, b]`. */
  readonly oklab: readonly [number, number, number];
  /** Mesh grid vertex position and lattice indices. */
  readonly gridNode: {
    readonly row: number;
    readonly col: number;
    readonly x: number;
    readonly y: number;
  };
  /** Disjoint core tags owned exclusively by this cluster's primary partition. */
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  /** Minimal shared tags added during Phase 2 to guarantee 100% planar triangle coverage. */
  readonly sharedTags: readonly TagDescriptor<TTagMeta>[];
  /** All content items whose active simplex unit includes this cluster (\tilde{w}_{ik} > 0). */
  readonly members: readonly ClusterMemberRef<TItem>[];
}

/**
 * Full runtime descriptor for a computed topic cluster, including derived domain metadata.
 */
export interface ClusterDescriptor<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> extends ClusterDerivationContext<TItem, TTagMeta> {
  /** Custom metadata produced by `deriveClusterMeta` (or `undefined` if unused). */
  readonly meta: TClusterMeta;
}

/**
 * Layout and semantic context passed to `VisualResolver.resolveContentVisual` for each item.
 */
export interface ContentLayoutContext<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Canonical identifier extracted via `getId`. */
  readonly id: string;
  /** Resolved tag descriptors for this item. */
  readonly tags: readonly TagDescriptor<TTagMeta>[];
  /** Perceptually mixed OKLab color converted to sRGB hex. */
  readonly mixedColorHex: string;
  /** Perceptually mixed color in OKLab `[L, a, b]`. */
  readonly mixedOklab: readonly [number, number, number];
  /** Active simplex unit clusters (length 1 = vertex, 2 = edge, 3 = triangle). */
  readonly unitClusters: ReadonlyArray<{
    readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
    readonly weight: number;
    readonly coverage: number;
  }>;
}

/**
 * Pure data-descriptor resolver decoupling domain items & clusters from rendering primitives.
 */
export interface VisualResolver<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Converts a domain item and its layout context into a pure visual descriptor. */
  resolveContentVisual(
    item: TItem,
    ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
  ): TContentVisual;

  /** Converts a computed cluster descriptor into a pure visual descriptor. */
  resolveClusterVisual(
    cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  ): TClusterVisual;

  /** Returns a stable cache key so the engine detects descriptor changes, re-measures hulls, and crossfades. */
  getVisualCacheKey(visual: TContentVisual | TClusterVisual): string;
}

/**
 * 2D Cartesian point.
 */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/**
 * Axis-aligned 2D bounding box.
 */
export interface BoundingBox2D {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Unscaled (scale = 1.0) convex collision hull centered around local origin `(0, 0)`.
 */
export type ConvexGeometry =
  | { readonly kind: 'circle'; readonly radius: number }
  | { readonly kind: 'polygon'; readonly vertices: readonly Point2D[] };

/**
 * Vertex in the 60-degree toothed simplex mesh.
 */
export interface MeshVertex {
  readonly index: number;
  readonly row: number;
  readonly col: number;
  readonly x: number;
  readonly y: number;
  readonly neighbors: readonly number[];
}

/**
 * Undirected edge in the 60-degree simplex mesh.
 */
export interface MeshEdge {
  readonly a: number;
  readonly b: number;
}

/**
 * Equilateral 60-degree triangle face in the simplex mesh.
 */
export interface MeshTriangle {
  readonly index: number;
  readonly vertices: readonly [number, number, number];
}

/**
 * Complete computed 60-degree toothed simplex mesh.
 */
export interface SimplexMesh {
  readonly width: number;
  readonly height: number;
  readonly innerPadding: number;
  readonly sideLength: number;
  readonly orientation: 'horizontal' | 'vertical';
  readonly wideFirst: boolean;
  readonly areaEfficiency: number;
  readonly vertices: readonly MeshVertex[];
  readonly edges: readonly MeshEdge[];
  readonly triangles: readonly MeshTriangle[];
}

/**
 * Mesh generation constraints.
 */
export interface MeshOptions {
  /** Padding around the usable mesh region in pixels. Default: 48. */
  readonly innerPadding?: number;
  /** Minimum preferred triangle side length in pixels. Default: 140. */
  readonly minSideLength?: number;
  /** Maximum preferred triangle side length in pixels. Default: 280. */
  readonly maxSideLength?: number;
  /** Upper bound on cluster count K. Default: 12. */
  readonly maxClusters?: number;
}

/**
 * Renderer-agnostic per-node frame state emitted in `SceneFrameSnapshot`.
 */
export interface NodeRenderState<TVisual> {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Scale factor alpha computed by the two-phase collision-free solver. */
  readonly scale: number;
  readonly opacity: number;
  readonly visual: TVisual;
  /** Unscaled convex hull at scale = 1.0. */
  readonly hull: ConvexGeometry;
  readonly cacheKey: string;
  readonly interaction: {
    readonly isHovered: boolean;
    readonly isPinned: boolean;
    readonly isDimmed: boolean;
    readonly isHighlighted: boolean;
  };
  readonly transition: {
    readonly from: TVisual;
    readonly fromHull: ConvexGeometry;
    readonly fromCacheKey: string;
    readonly to: TVisual;
    readonly toHull: ConvexGeometry;
    readonly toCacheKey: string;
    readonly progress: number;
  } | null;
}

/**
 * Render state for a single mesh triangle face.
 */
export interface MeshTriangleRenderState {
  readonly index: number;
  readonly points: readonly [Point2D, Point2D, Point2D];
  readonly fillHex: string;
  readonly fillOpacity: number;
}

/**
 * Render state for a single mesh edge.
 */
export interface MeshEdgeRenderState {
  readonly a: Point2D;
  readonly b: Point2D;
  readonly isHighlighted: boolean;
}

/**
 * Complete renderer-independent frame snapshot produced by `SimplexGraphEngine`.
 */
export interface SceneFrameSnapshot<TContentVisual, TClusterVisual> {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly camera: CameraState;
  readonly triangles: readonly MeshTriangleRenderState[];
  readonly edges: readonly MeshEdgeRenderState[];
  readonly clusters: readonly NodeRenderState<TClusterVisual>[];
  readonly items: readonly NodeRenderState<TContentVisual>[];
  readonly showHulls: boolean;
}

/**
 * Abstract convex hull measurer implemented by rendering backends (e.g. SVG `getBBox()` or Canvas text metrics).
 */
export interface HullMeasurer<TContentVisual, TClusterVisual> {
  measureContentHull(visual: TContentVisual, cacheKey: string): ConvexGeometry;
  measureClusterHull(visual: TClusterVisual, cacheKey: string): ConvexGeometry;
}

/**
 * Renderer contract separating `@simplex-viz/core` from SVG, Canvas, or WebGL engines.
 */
export interface SimplexRendererAdapter<TContentVisual, TClusterVisual>
  extends HullMeasurer<TContentVisual, TClusterVisual> {
  renderFrame(snapshot: SceneFrameSnapshot<TContentVisual, TClusterVisual>): void;
  destroy(): void;
}

/**
 * Immutable 2D camera state.
 */
export interface CameraState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

/**
 * Camera manipulation API passed to custom wheel handlers and controllers.
 */
export interface CameraController {
  getState(): CameraState;
  setState(next: Partial<CameraState>): void;
  zoomToCursor(screenX: number, screenY: number, zoomFactor: number): void;
  panBy(dx: number, dy: number): void;
  reset(): void;
  screenToWorld(screenX: number, screenY: number): Point2D;
  worldToScreen(worldX: number, worldY: number): Point2D;
}

/**
 * Normalized pointer event decoupled from DOM-specific event classes.
 */
export interface NormalizedPointerEvent {
  readonly screenX: number;
  readonly screenY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Normalized wheel event decoupled from DOM-specific `WheelEvent`.
 */
export interface NormalizedWheelEvent {
  readonly screenX: number;
  readonly screenY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Discriminated union returned by mathematical convex-hull hit-testing.
 */
export type HitTarget<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | {
      readonly kind: 'content';
      readonly item: TItem;
      readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
      readonly visual: TContentVisual;
      readonly worldPosition: Point2D;
      readonly screenPosition: Point2D;
    }
  | {
      readonly kind: 'cluster';
      readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
      readonly visual: TClusterVisual;
      readonly worldPosition: Point2D;
      readonly screenPosition: Point2D;
    }
  | {
      readonly kind: 'background';
      readonly worldPosition: Point2D;
      readonly screenPosition: Point2D;
    };

/**
 * Hover payload for content items.
 */
export interface ContentHoverEvent<
  TItem,
  TContentVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly item: TItem;
  readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TContentVisual;
  readonly screenPosition: Point2D;
  readonly worldPosition: Point2D;
}

/**
 * Hover payload for topic clusters.
 */
export interface ClusterHoverEvent<
  TItem,
  TClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TClusterVisual;
  readonly screenPosition: Point2D;
  readonly worldPosition: Point2D;
}

/**
 * Wheel interaction policy.
 */
export type WheelBehavior =
  | 'zoom-to-cursor'
  | 'pan-vertical'
  | 'none'
  | ((event: NormalizedWheelEvent, camera: CameraController) => void);

/**
 * Configurable renderer-independent interaction callbacks.
 */
export interface InteractionHandlers<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly onContentHover?: (
    event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta> | null,
  ) => void;
  readonly onClusterHover?: (
    event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta> | null,
  ) => void;
  readonly onLeftClick?: (
    target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
    rawEvent: NormalizedPointerEvent,
  ) => void;
  readonly onRightClick?: (
    target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
    rawEvent: NormalizedPointerEvent,
  ) => boolean | void;
  readonly onWheel?: WheelBehavior;
}

/**
 * Live geometric and solver telemetry emitted by `SimplexGraphEngine`.
 */
export interface LayoutMetrics {
  readonly clusterCount: number;
  readonly itemCount: number;
  readonly tagCount: number;
  readonly clusterScale: number;
  readonly contentScale: number;
  readonly overlapCount: number;
  readonly maxPenetrationPx: number;
  readonly isSettled: boolean;
  readonly meshSideLength: number;
  readonly areaEfficiency: number;
}

/**
 * Layout & clustering options for `SimplexGraphEngine`.
 */
export interface LayoutSolverOptions {
  /** Minimum gap between topic cluster hulls in pixels. Default: 14. */
  readonly clusterGapPx?: number;
  /** Minimum gap between content item hulls (and between items and clusters) in pixels. Default: 5. */
  readonly itemGapPx?: number;
  /** Minimum allowed content scale factor in binary search. Default: 0.2. */
  readonly minContentScale?: number;
  /** Maximum relaxation iterations per scale test. Default: 36. */
  readonly relaxationIterations?: number;
  /** Optional size multiplier applied uniformly when measuring/solving. Default: 1.0. */
  readonly sizeMultiplier?: number;
  /** Optional deterministic seed for reproducible layout and clustering. */
  readonly seed?: number;
}

export interface SimplexEngineResolvedConfig<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items: readonly TItem[];
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly visualResolver: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly renderer: SimplexRendererAdapter<TContentVisual, TClusterVisual>;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly normalizeTag?: (rawTag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly showHulls?: boolean;
  readonly interactions?: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly onMetricsChange?: (metrics: LayoutMetrics) => void;
  readonly onClustersChange?: (
    clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
  ) => void;
}

/**
 * Complete configuration object for creating a `SimplexGraphEngine`.
 */
export type SimplexEngineConfig<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = ItemIdentityConfig<TItem> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> &
  Omit<
    SimplexEngineResolvedConfig<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'getId' | 'getTags' | 'deriveClusterMeta'
  >;
