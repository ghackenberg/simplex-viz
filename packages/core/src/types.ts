import type {
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexColorTheme,
  SimplexLayoutStrategy,
  SimplexMeshStrategy,
} from './strategies.js';
import type { SimplexZoomState, SimplexZoomStrategy } from './zoom.js';

/**
 * Default shape of a tagged item when no custom `getId` or `getTags` accessor is provided.
 */
export interface DefaultTaggedItem {
  readonly id: string;
  readonly tags: readonly string[];
}

/**
 * Lightweight identified item tuple used internally before strategy-specific feature extraction.
 */
export interface IdentifiedItem<TItem> {
  readonly id: string;
  readonly item: TItem;
}

/**
 * Conditional hybrid ID accessor configuration for arbitrary domain items `TItem`.
 */
export type ItemIdConfig<TItem> = [TItem] extends [{ readonly id: string }]
  ? { readonly getId?: (item: TItem) => string }
  : { readonly getId: (item: TItem) => string };

/**
 * Conditional tag accessor configuration for tag-based clustering strategies.
 */
export type ItemTagsConfig<TItem> = [TItem] extends [{ readonly tags: readonly string[] }]
  ? { readonly getTags?: (item: TItem) => readonly string[] }
  : { readonly getTags: (item: TItem) => readonly string[] };

/**
 * Conditional hybrid accessor configuration for tagged user domain items `TItem`.
 *
 * When `TItem` already contains `{ id: string }` and `{ tags: readonly string[] }`,
 * `getId` and `getTags` remain optional; otherwise TypeScript enforces providing them.
 */
export type ItemIdentityConfig<TItem> = ItemIdConfig<TItem> & ItemTagsConfig<TItem>;

/**
 * Conditional item identity + clustering strategy configuration.
 *
 * When `clusteringStrategy` is omitted, the built-in tag-based clustering specialization is active
 * (requiring `getTags` whenever `TItem` does not provide `{ tags: readonly string[] }`).
 * When a custom or embedding/similarity `clusteringStrategy` is provided, `getTags` is optional.
 */
export type StrategyItemIdentityConfig<TItem, TTagMeta> = ItemIdConfig<TItem> &
  (
    | (ItemTagsConfig<TItem> & {
        readonly clusteringStrategy?: undefined;
      })
    | {
        readonly clusteringStrategy: SimplexClusteringStrategy<TItem, TTagMeta>;
        readonly getTags?: (item: TItem) => readonly string[];
      }
  );

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
  /** Normalized canonical tag key used for clustering and equality matching. */
  readonly tag: string;
  /** Optional human-readable display label produced by `formatTagLabel` (defaults to `tag` when omitted). */
  readonly label?: string;
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
 * Visual & semantic hierarchy tier of a vertex cluster.
 * - `'primary'`: Main root topic cluster (`T1..TK`).
 * - `'intermediate'`: Synthesized zoom midpoint, blended edge/interior node, or spotlight sector.
 */
export type ClusterRole = 'primary' | 'intermediate';

/**
 * Contributing root topic cluster weight for an `'intermediate'` blended cluster node.
 */
export interface ClusterMixComponent {
  readonly code: string;
  readonly label: string;
  readonly colorHex: string;
  readonly weight: number;
}

/**
 * Lightweight sibling cluster snapshot exposed on `ClusterDerivationContext.peerClusters`
 * so `deriveClusterMeta` can evaluate specificity against sibling clusters and avoid duplicate names.
 */
export interface PeerClusterContext<TItem, TTagMeta = unknown> {
  readonly clusterIndex: number;
  readonly clusterUid: string;
  readonly code: string;
  readonly defaultLabel: string;
  readonly role?: ClusterRole;
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  readonly members: readonly ClusterMemberRef<TItem>[];
  readonly representativeItems?: readonly ClusterMemberRef<TItem>[];
}

/**
 * Context passed to `deriveClusterMeta` once cluster tags, mesh vertex, and unit members are finalized.
 */
export interface ClusterDerivationContext<TItem, TTagMeta = undefined> {
  /** Index of the cluster vertex in the current mesh (0 .. K-1). */
  readonly clusterIndex: number;
  /** Stable cluster identity preserved across re-clusterings via bipartite matching. */
  readonly clusterUid: string;
  /** Short human-readable cluster code (e.g. "T1", or compact "T1·T2" for intermediate midpoints). */
  readonly code: string;
  /** Default label derived from the top core tags or blended topics. */
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
  /** Disjoint core tags owned exclusively by this cluster's primary partition (empty for non-tag strategies). */
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  /** Minimal shared tags added during Phase 2 to guarantee 100% planar triangle coverage (empty for non-tag strategies). */
  readonly sharedTags: readonly TagDescriptor<TTagMeta>[];
  /** All content items whose active simplex unit includes this cluster (\tilde{w}_{ik} > 0). */
  readonly members: readonly ClusterMemberRef<TItem>[];
  /** Representative / medoid members ordered closest to the cluster center (populated by embedding/similarity strategies). */
  readonly representativeItems?: readonly ClusterMemberRef<TItem>[];
  /** Optional cluster centroid vector in embedding space. */
  readonly centroid?: readonly number[];
  /** Optional average intra-cluster similarity / compactness score in [0, 1]. */
  readonly cohesion?: number;
  /** Optional human-readable summary produced by non-tag clustering strategies. */
  readonly featureSummary?: string;
  /** Hierarchy tier (`'primary'` main cluster vs `'intermediate'` midpoint/sector bridge). Default: `'primary'`. */
  readonly role?: ClusterRole;
  /** Contributing root clusters and weights when `role === 'intermediate'`. */
  readonly mixWeights?: readonly ClusterMixComponent[];
  /**
   * Optional concise semantic label synthesized by a Stage-5 zoom strategy
   * (e.g. `'High Budget'`, `'Aquatic'`, `'Biscoe'`, `'#shaders'`) when a zoomed vertex
   * represents a discovered local sub-cluster or facet rather than an unlabeled geometric midpoint.
   */
  readonly subclusterLabel?: string;
  /**
   * Optional concise parent cluster anchor name (e.g. `'Action'`, `'Mammalia'`, `'Graphics'`)
   * preserved on the outer corners of a zoomed `1:4` triangle or spotlight frame when a corner
   * is locally re-partitioned into a finer `subclusterLabel`.
   */
  readonly parentContextLabel?: string;
  /**
   * Complete item population of the active frame, enabling base-rate lift and z-score specificity
   * calculations inside `deriveClusterMeta`.
   */
  readonly allItems?: readonly TItem[];
  /**
   * All sibling clusters (`0 .. K-1`) in the active frame, enabling joint collision-free label
   * assignment across peers via `resolveDiscriminativeClusterLabel`.
   */
  readonly peerClusters?: readonly PeerClusterContext<TItem, TTagMeta>[];
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
  /** Resolved tag descriptors for this item (empty when using tag-free clustering strategies). */
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
  /** Optional reconstruction error / residual distance from the assigned simplex unit (embedding/similarity strategies). */
  readonly residualDistance?: number;
  /** Optional concise feature summary emitted by custom clustering strategies. */
  readonly featureSummary?: string;
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
export type EmptyClusterBehavior = 'normal' | 'dim' | 'hide';

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
  /**
   * Padding around the usable mesh region in pixels.
   * When omitted, adapts smoothly to viewport size (`32 px` on compact mobile up to `48 px` on desktop).
   */
  readonly innerPadding?: number;
  /**
   * Explicit equilateral triangle side length in pixels.
   * When provided, overrides automatic viewport-filling sizing across both
   * adaptive and fixed-lattice mesh strategies.
   */
  readonly sideLength?: number;
  /** Minimum preferred triangle side length in pixels (used when `sideLength` is omitted). Default: 130. */
  readonly minSideLength?: number;
  /**
   * Optional upper cap on triangle side length in pixels (used when `sideLength` is omitted).
   * When omitted, triangles scale up freely to maximize usable canvas area.
   */
  readonly maxSideLength?: number;
  /** Upper bound on cluster count K. Default: 14. */
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
  /** True when this node represents a dimmed neighborhood cluster or content item outside the active zoomed mesh. */
  readonly isContext?: boolean;
  /** True when this node belongs to a drillable triangle and passes hover & click through to that triangle. */
  readonly isPassThrough?: boolean;
  /** Neighbor navigation ID (`tri:<index>` or `cluster:<index>`) when clicking a dimmed context node switches to it. */
  readonly neighborId?: string;
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
 * Render state for a single mesh triangle face, enriched with corner cluster descriptors,
 * item density counts, and hover/focus interaction flags.
 */
export interface MeshTriangleRenderState<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly index: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly points: readonly [Point2D, Point2D, Point2D];
  readonly centroid: Point2D;
  readonly fillHex: string;
  readonly fillOpacity: number;
  readonly clusters: readonly [
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  ];
  /** Total items whose active simplex unit lies within this triangle (vertex, edge, or 3-cluster face). */
  readonly coveredItemCount: number;
  /** Items anchored strictly across all 3 corner clusters of this triangle. */
  readonly interiorItemCount: number;
  /** True when this face represents a dimmed neighboring triangle outside the active focused region. */
  readonly isContext?: boolean;
  /**
   * True when an active triangle supports further drill-down in the current `drill-down` zoom strategy
   * (`zoomState.drillableTriangleIndices.includes(index)`). Undefined on leaf triangles,
   * dimmed context triangles, and when `free-camera` mode is active.
   */
  readonly isDrillable?: boolean;
  /** Neighbor navigation ID (`tri:<index>`) used when clicking a dimmed context triangle switches laterally. */
  readonly neighborId?: string;
  /** Optional transient opacity in `[0, 1]` used during continuous zoom/drill flight transitions. */
  readonly opacity?: number;
  /**
   * Optional boundary mask used when a multi-triangle zoomed-in region (e.g. `1:4` subdivision
   * or `cluster-star`) highlights its outer perimeter `[edge01, edge12, edge20]` and outer corners
   * `[v0, v1, v2]` without stroking internal subdivision seams at rest.
   */
  readonly highlightBoundary?: {
    readonly edges: readonly [boolean, boolean, boolean];
    readonly corners: readonly [boolean, boolean, boolean];
  };
  readonly interaction: {
    readonly isHovered: boolean;
    readonly isFocused: boolean;
    readonly isDimmed: boolean;
    /**
     * True when this triangle receives a hover-equivalent highlight
     * (e.g. active focused region while zoomed in, or a neighbor highlighted after zoom-out).
     */
    readonly isHighlighted?: boolean;
  };
}

/**
 * Render state for a single mesh edge connecting two adjacent vertex clusters.
 */
export interface MeshEdgeRenderState<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly index: number;
  readonly vertexIndices: readonly [number, number];
  readonly a: Point2D;
  readonly b: Point2D;
  readonly mixedColorHex: string;
  readonly clusters: readonly [
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  ];
  readonly isHighlighted: boolean;
  /** True when this edge belongs to the dimmed non-active neighborhood context. */
  readonly isDimmed?: boolean;
  /** Optional transient opacity in `[0, 1]` used during continuous zoom/drill flight transitions. */
  readonly opacity?: number;
}

/**
 * Complete renderer-independent frame snapshot produced by `SimplexGraphEngine`.
 */
export interface SceneFrameSnapshot<
  TContentVisual,
  TClusterVisual,
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly camera: CameraState;
  readonly triangles: readonly MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>[];
  readonly edges: readonly MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[];
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
export interface SimplexRendererAdapter<
  TContentVisual,
  TClusterVisual,
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> extends HullMeasurer<TContentVisual, TClusterVisual> {
  renderFrame(
    snapshot: SceneFrameSnapshot<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ): void;
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
      /** True when this content node belongs to the dimmed surrounding neighborhood outside the focused zoom region. */
      readonly isContext?: boolean;
      /** Neighbor navigation ID (`tri:<index>` or `cluster:<index>`) when clicking a dimmed context content item switches to its region. */
      readonly neighborId?: string;
    }
  | {
      readonly kind: 'cluster';
      readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
      readonly visual: TClusterVisual;
      readonly worldPosition: Point2D;
      readonly screenPosition: Point2D;
      /** Neighbor navigation ID (`cluster:<index>`) when clicking a dimmed context cluster switches to it. */
      readonly neighborId?: string;
    }
  | {
      readonly kind: 'triangle';
      readonly triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>;
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
  /** True when hovering a dimmed context content item in an adjacent neighborhood region. */
  readonly isContext?: boolean;
  /** Neighbor navigation ID (`tri:<index>` or `cluster:<index>`) when hovering a dimmed context content item. */
  readonly neighborId?: string;
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
  /** Neighbor navigation ID (`cluster:<index>`) when hovering a dimmed context cluster. */
  readonly neighborId?: string;
}

/**
 * Hover payload for mesh triangle faces.
 */
export interface TriangleHoverEvent<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly screenPosition: Point2D;
  readonly worldPosition: Point2D;
}

/**
 * Narrowed `HitTarget` payload for left-clicks on a content item.
 */
export type ContentClickEvent<
  TItem,
  TContentVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Extract<
  HitTarget<TItem, TContentVisual, never, TTagMeta, TClusterMeta>,
  { readonly kind: 'content' }
>;

/**
 * Narrowed `HitTarget` payload for left-clicks on a topic cluster anchor.
 */
export type ClusterClickEvent<
  TItem,
  TClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Extract<
  HitTarget<TItem, never, TClusterVisual, TTagMeta, TClusterMeta>,
  { readonly kind: 'cluster' }
>;

/**
 * Narrowed `HitTarget` payload for left-clicks on a mesh triangle face.
 */
export type TriangleClickEvent<
  TItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Extract<
  HitTarget<TItem, never, never, TTagMeta, TClusterMeta>,
  { readonly kind: 'triangle' }
>;

/**
 * Wheel interaction policy (active in `free-camera` mode).
 *
 * When a custom callback is supplied, return `true` to mark the wheel event as consumed
 * (suppressing built-in `'zoom-to-cursor'` while still preventing default page scroll);
 * return `void` or `false` to let built-in `'zoom-to-cursor'` compose afterward.
 */
export type WheelBehavior =
  | 'zoom-to-cursor'
  | 'pan-vertical'
  | 'none'
  | ((event: NormalizedWheelEvent, camera: CameraController) => boolean | void);

/**
 * Configurable renderer-independent interaction callbacks.
 *
 * Every callback follows one consistent composable convention:
 * - Return `true` to consume the event and suppress built-in default behavior
 *   (built-in drill-down/focus for click handlers, built-in tooltip for hover handlers,
 *   browser context menu for `onRightClick`, or built-in cursor zoom for custom `onWheel`).
 * - Return `void` / `undefined` / `false` to compose with built-in default behavior.
 */
export interface InteractionHandlers<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Return `true` to suppress the built-in hover tooltip for this content node. */
  readonly onContentHover?: (
    event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta> | null,
  ) => boolean | void;
  /** Return `true` to suppress the built-in hover tooltip for this cluster node. */
  readonly onClusterHover?: (
    event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta> | null,
  ) => boolean | void;
  /** Return `true` to suppress the built-in hover tooltip for this triangle face. */
  readonly onTriangleHover?: (
    event: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta> | null,
  ) => boolean | void;
  /**
   * Invoked on active (non-neighbor) content node left-click before `onLeftClick`.
   * Return `true` to consume the click and skip `onLeftClick` and built-in defaults.
   */
  readonly onContentClick?: (
    target: ContentClickEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
    rawEvent: NormalizedPointerEvent,
  ) => boolean | void;
  /**
   * Invoked on cluster anchor left-click before `onLeftClick`.
   * Return `true` to consume the click and suppress built-in cluster drill-down or focus toggle.
   */
  readonly onClusterClick?: (
    target: ClusterClickEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
    rawEvent: NormalizedPointerEvent,
  ) => boolean | void;
  /**
   * Invoked on triangle face left-click before `onLeftClick`.
   * Return `true` to consume the click and suppress built-in triangle drill-down or focus toggle.
   */
  readonly onTriangleClick?: (
    target: TriangleClickEvent<TItem, TTagMeta, TClusterMeta>,
    rawEvent: NormalizedPointerEvent,
  ) => boolean | void;
  /**
   * Invoked on empty canvas background left-click before `onLeftClick`.
   * Return `true` to consume the click and suppress built-in drill-up or focus clearing.
   */
  readonly onBackgroundClick?: (
    rawEvent: NormalizedPointerEvent,
  ) => boolean | void;
  /**
   * Invoked on any left-click not consumed by a target-specific click handler.
   * Return `true` to consume the click and suppress built-in drill-down / focus behavior;
   * return `void` or `false` to compose with built-in navigation and focus toggles.
   */
  readonly onLeftClick?: (
    target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
    rawEvent: NormalizedPointerEvent,
  ) => boolean | void;
  /**
   * Invoked on right-click (`contextmenu`).
   * Return `true` to suppress the browser's default context menu.
   */
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
  readonly renderer: SimplexRendererAdapter<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly normalizeTag?: (rawTag: string) => string;
  /** Optional formatter converting canonical normalized tag IDs into concise human-readable display labels without altering clustering or equality matching. */
  readonly formatTagLabel?: (tag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  /** Optional custom mesh/triangulation strategy. Default: `createAdaptiveHexMeshStrategy()`. */
  readonly meshStrategy?: SimplexMeshStrategy<TItem>;
  /** Optional custom topic clustering & vertex assignment strategy. Default: `createJaccardAnnealingClusteringStrategy()`. */
  readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  /** Optional custom cluster coloring & item color-mixing strategy. Default: `createOklabContrastColorStrategy()`. */
  readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  /** Optional custom cluster/content positioning & scaling strategy. Default: `createPbdUniformLayoutStrategy()`. */
  readonly layoutStrategy?: SimplexLayoutStrategy;
  /** Optional custom zoom / drill-down strategy. Default: `createFreeCameraZoomStrategy()`. */
  readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  /** Canvas theme hint forwarded to `SimplexColorStrategy`. Default: `'dark'`. */
  readonly theme?: SimplexColorTheme;
  /**
   * Visual treatment for clusters that currently have `0` active member items
   * (e.g. future clusters during chronological timeline playback with final-seeded clustering):
   * - `'normal'` (default): Render at full opacity.
   * - `'dim'`: Dim empty clusters (`interaction.isDimmed = true`) until their first member arrives.
   * - `'hide'`: Fade empty clusters to opacity `0` and disable pointer hit-testing until their first member arrives.
   */
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  /**
   * Optional full canonical item corpus used to seed `createFinalSeededLayoutStrategy`
   * when rendering partial subsets (such as early timeline frames or filtered views).
   */
  readonly canonicalSeedItems?: readonly TItem[];
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
  readonly onZoomStateChange?: (state: SimplexZoomState) => void;
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
> = StrategyItemIdentityConfig<TItem, TTagMeta> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> &
  Omit<
    SimplexEngineResolvedConfig<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'getId' | 'getTags' | 'deriveClusterMeta' | 'clusteringStrategy'
  >;
