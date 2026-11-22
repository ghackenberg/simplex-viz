import type { OklabTuple } from '../oklab.js';
import type {
  AnalyzedTagCorpus,
  NormalizedContentItem,
} from '../clustering.js';
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  Point2D,
  SimplexMesh,
  TagDescriptor,
} from '../types.js';

export type ZoomStrategyMode = 'free-camera' | 'drill-down';

/**
 * Default full-scale ratio threshold (`placed.scale / sizeMultiplier`) at which a triangle
 * or cluster is treated as comfortably legible/clickable without requiring another `1:4`
 * drill-down subdivision.
 *
 * Derived from the default `CollisionLocalScaleController` shrink ladder (`0.85^k`: `1.00`,
 * `0.85`, `0.7225`, …) and the `2x` linear (`4x` area) gain of `1:4` conformal subdivision:
 * `0.75` sits cleanly above `√0.5 ≈ 0.707` (50% target area) and strictly between one minor
 * shrink round (`0.85`, leaf reached) and two shrink rounds (`0.7225`, worth subdividing).
 */
export const DEFAULT_FULL_SCALE_THRESHOLD = 0.75;

export type ZoomFrameKind =
  | 'root'
  | 'triangle'
  | 'triangle-focus'
  | 'cluster-star'
  | 'cluster-spotlight';

export interface ZoomBreadcrumbSegment {
  readonly label: string;
  readonly colorHex?: string;
}

export interface ZoomBreadcrumb {
  readonly depth: number;
  readonly frameId: string;
  readonly kind: ZoomFrameKind;
  readonly label: string;
  readonly shortLabel: string;
  readonly accentHex?: string;
  /** Optional rich human-readable topic segments with per-cluster color dots. */
  readonly segments?: readonly ZoomBreadcrumbSegment[];
}

export interface ZoomNeighborTarget {
  readonly id: string;
  readonly targetKind: 'triangle' | 'cluster';
  readonly label: string;
  readonly shortLabel: string;
  readonly itemCount: number;
  readonly anchorPoint: Point2D;
  readonly normal: Point2D;
  readonly accentHex: string;
}

export interface SimplexZoomState {
  readonly strategyName: string;
  readonly mode: ZoomStrategyMode;
  readonly depth: number;
  readonly activeFrameKind: ZoomFrameKind;
  readonly canDrillUp: boolean;
  readonly isLeafReached: boolean;
  readonly fullScaleItemRatio: number;
  readonly breadcrumbs: readonly ZoomBreadcrumb[];
  readonly neighbors: readonly ZoomNeighborTarget[];
  readonly drillableTriangleIndices: readonly number[];
  readonly focusableTriangleIndices: readonly number[];
  readonly drillableClusterUids: readonly string[];
}

export interface ZoomItemAnchorInput<TItem, TTagMeta> {
  readonly id: string;
  readonly item: TItem;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly tags: readonly TagDescriptor<TTagMeta>[];
  readonly unitWeights: ReadonlyArray<{
    readonly clusterIndex: number;
    readonly weight: number;
    readonly coverage: number;
  }>;
  readonly mixedColorHex: string;
  readonly mixedOklab: OklabTuple;
  readonly residualDistance?: number;
  readonly featureSummary?: string;
}

export interface ZoomContextTriangle<TItem, TTagMeta, TClusterMeta> {
  readonly id: string;
  readonly neighborId?: string;
  readonly points: readonly [Point2D, Point2D, Point2D];
  readonly centroid: Point2D;
  readonly clusters: readonly [
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  ];
  readonly mixedColorHex: string;
  readonly coveredItemCount: number;
  readonly interiorItemCount: number;
}

export interface ZoomContextEdge<TItem, TTagMeta, TClusterMeta> {
  readonly a: Point2D;
  readonly b: Point2D;
  readonly mixedColorHex: string;
  readonly clusters: readonly [
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  ];
}

export interface ZoomContextCluster<TItem, TTagMeta, TClusterMeta> {
  readonly id: string;
  readonly neighborId?: string;
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
  readonly x: number;
  readonly y: number;
}

export interface ZoomContextItem<TItem, TTagMeta, TClusterMeta> {
  readonly id: string;
  readonly rawId: string;
  readonly neighborId?: string;
  readonly item: TItem;
  readonly layoutContext: {
    readonly id: string;
    readonly tags: readonly TagDescriptor<TTagMeta>[];
    readonly mixedColorHex: string;
    readonly mixedOklab: OklabTuple;
    readonly unitClusters: ReadonlyArray<{
      readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
      readonly weight: number;
      readonly coverage: number;
    }>;
    readonly residualDistance?: number;
    readonly featureSummary?: string;
  };
  readonly x: number;
  readonly y: number;
  readonly scale?: number;
}

export interface ZoomAffineTransform {
  readonly scale: number;
  readonly sourceCx: number;
  readonly sourceCy: number;
  readonly targetCx: number;
  readonly targetCy: number;
}

export const IDENTITY_ZOOM_AFFINE: ZoomAffineTransform = {
  scale: 1,
  sourceCx: 0,
  sourceCy: 0,
  targetCx: 0,
  targetCy: 0,
};

export function applyZoomAffine(
  transform: ZoomAffineTransform,
  pt: Point2D,
): Point2D {
  return {
    x: transform.targetCx + (pt.x - transform.sourceCx) * transform.scale,
    y: transform.targetCy + (pt.y - transform.sourceCy) * transform.scale,
  };
}

export function invertZoomAffine(
  transform: ZoomAffineTransform,
): ZoomAffineTransform {
  const invScale = 1 / Math.max(1e-6, transform.scale);
  return {
    scale: invScale,
    sourceCx: transform.targetCx,
    sourceCy: transform.targetCy,
    targetCx: transform.sourceCx,
    targetCy: transform.sourceCy,
  };
}

export function composeZoomAffine(
  first: ZoomAffineTransform,
  second: ZoomAffineTransform,
): ZoomAffineTransform {
  return {
    scale: first.scale * second.scale,
    sourceCx: first.sourceCx,
    sourceCy: first.sourceCy,
    targetCx:
      second.targetCx + (first.targetCx - second.sourceCx) * second.scale,
    targetCy:
      second.targetCy + (first.targetCy - second.sourceCy) * second.scale,
  };
}

export interface ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> {
  readonly frameId: string;
  readonly kind: ZoomFrameKind;
  readonly label: string;
  readonly shortLabel: string;
  readonly accentHex?: string;
  readonly breadcrumbSegments?: readonly ZoomBreadcrumbSegment[];
  readonly mesh: SimplexMesh;
  readonly clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
  readonly items: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly neighbors: readonly ZoomNeighborTarget[];
  /** Affine similarity transform mapping `parentFrame` coordinates into this frame's viewport coordinates. */
  readonly parentToFrameTransform?: ZoomAffineTransform;
  readonly contextTriangles?: readonly ZoomContextTriangle<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextEdges?: readonly ZoomContextEdge<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextClusters?: readonly ZoomContextCluster<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextItems?: readonly ZoomContextItem<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  /** Scoped neighbor IDs (`@<parentFrameId>/cluster:<idx>`) for the 3 outer corners of a `'triangle-focus'` frame. */
  readonly cornerClusterNeighborIds?: readonly string[];
  readonly strategyData?: unknown;
}

export interface ZoomTargetEvaluationContext<TItem, TTagMeta, TClusterMeta> {
  readonly frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly depth: number;
  /** Ratio `placed.scale / sizeMultiplier` per item ID (`>= 0.999` means full `1.0x` size). */
  readonly itemScaleRatios: ReadonlyMap<string, number>;
  readonly overlapCount: number;
}

export interface ZoomTargetEvaluationResult {
  readonly drillableTriangleIndices: readonly number[];
  readonly focusableTriangleIndices?: readonly number[];
  readonly drillableClusterUids: readonly string[];
  readonly isLeafReached: boolean;
  readonly fullScaleItemRatio: number;
}

export interface ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta> {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly innerPadding: number;
  readonly allocateClusterUid: () => string;
  readonly deriveClusterMeta: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
  readonly rootItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly corpus: AnalyzedTagCorpus | null;
  /** Optional formatter converting canonical tag IDs into concise human-readable display labels. */
  readonly formatTagLabel?: (tag: string) => string;
  /** Settled overlap-free item positions & scales from `parentFrame` used to project dimmed neighborhood content items accurately. */
  readonly parentSettledItems?: ReadonlyMap<
    string,
    { readonly x: number; readonly y: number; readonly scale: number }
  >;
}

export interface ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta> {
  readonly triangleIndex: number;
  readonly parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly parentDepth: number;
  readonly itemScaleRatios: ReadonlyMap<string, number>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
}

export interface ZoomClusterDrillContext<TItem, TTagMeta, TClusterMeta> {
  readonly clusterUid: string;
  readonly clusterIndex: number;
  readonly parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly parentDepth: number;
  readonly itemScaleRatios: ReadonlyMap<string, number>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
}

export interface ZoomNeighborDrillContext<TItem, TTagMeta, TClusterMeta> {
  readonly neighborId: string;
  readonly currentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly currentDepth: number;
  readonly itemScaleRatios: ReadonlyMap<string, number>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
}

export interface ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> {
  readonly nextFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly replaceTop?: boolean;
}

/**
 * Pluggable 5th core strategy axis controlling zoom / drill-down interaction & subdivision.
 */
export interface SimplexZoomStrategy<
  TItem = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly name: string;
  readonly mode: ZoomStrategyMode;
  evaluateTargets?(
    ctx: ZoomTargetEvaluationContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomTargetEvaluationResult;
  drillIntoTriangle?(
    ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null;
  drillIntoCluster?(
    ctx: ZoomClusterDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null;
  drillToNeighbor?(
    ctx: ZoomNeighborDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null;
}

export type BarycentricClusterZoomMode = 'incident-star' | 'spotlight' | 'none';

export interface BarycentricZoomStrategyOptions {
  readonly clusterZoomMode?: BarycentricClusterZoomMode;
  readonly adaptiveContrastStretch?: boolean;
  readonly enableSectorFallback?: boolean;
  readonly stopWhenFullScale?: boolean;
  /** Full-scale ratio threshold (`placed.scale / sizeMultiplier`). Default: `0.75` (`DEFAULT_FULL_SCALE_THRESHOLD`). */
  readonly fullScaleThreshold?: number;
  /** Focuses leaf / non-subdividable triangles in multi-triangle meshes as single un-subdivided triangles. Default: `true`. */
  readonly leafTriangleFocus?: boolean;
}

export interface SemanticZoomStrategyOptions {
  readonly clusterZoomMode?: BarycentricClusterZoomMode;
  readonly stopWhenFullScale?: boolean;
  /** Full-scale ratio threshold (`placed.scale / sizeMultiplier`). Default: `0.75` (`DEFAULT_FULL_SCALE_THRESHOLD`). */
  readonly fullScaleThreshold?: number;
  readonly barycentricFallback?: boolean;
  /** Focuses leaf / non-subdividable triangles in multi-triangle meshes as single un-subdivided triangles. Default: `true`. */
  readonly leafTriangleFocus?: boolean;
}

/**
 * Context passed when resolving dynamic depth-aware zoom features in `createSubspaceZoomStrategy`.
 */
export interface SubspaceZoomContext<TItem = unknown> {
  /** Zero-based parent zoom depth (`0` when drilling from the root overview into depth `1`). */
  readonly depth: number;
  /** Target drill-down frame geometry (`'triangle'` = 6-vertex `1:4` sub-mesh, `'cluster-spotlight'` = 3-vertex spotlight). */
  readonly kind: 'triangle' | 'cluster-spotlight';
  /** Subset of domain items covered by the focused triangle or cluster. */
  readonly items: readonly TItem[];
}

/**
 * Interpretable feature or facet extractor evaluated locally on zoomed subsets by `createSubspaceZoomStrategy`.
 *
 * Features that are constant within the focused subset (zero local variance, e.g. `milk = true` inside
 * a *Mammals* cluster) automatically receive zero weight so intra-cluster variations take over.
 */
export interface SubspaceZoomFeature<TItem = unknown> {
  /** Optional stable identifier for deduplicating feature families. */
  readonly id?: string;
  /** Human-readable axis name (e.g. `'Budget'`, `'Aquatic'`, `'Island'`). */
  readonly label: string;
  /**
   * Extracts a boolean, categorical string, or continuous numeric value for `item`.
   * Returning `null`, `undefined`, or `NaN` marks the feature missing for that item.
   */
  readonly getValue: (
    item: TItem,
  ) => number | boolean | string | null | undefined;
  /** Relative feature importance weight (`> 0`). Default: `1.0`. */
  readonly weight?: number;
  /** Minimum parent zoom depth at which this feature participates (`0` = first drill-down). Default: `0`. */
  readonly minDepth?: number;
  /** Concise sub-cluster badge label when a boolean trait is `true` or numeric z-score is high. */
  readonly highLabel?: string;
  /** Concise sub-cluster badge label when a boolean trait is `false` or numeric z-score is low. */
  readonly lowLabel?: string;
  /** Optional custom label formatter receiving the sub-cluster's raw numeric mean and global subset mean. */
  readonly formatMean?: (clusterMean: number, subsetMean: number) => string;
}

/**
 * Configuration options for `createSubspaceZoomStrategy`.
 */
export interface SubspaceZoomStrategyOptions<TItem = unknown> {
  /**
   * Optional array (or depth-aware resolver) of interpretable features/facets used to re-cluster
   * and label sub-vertices locally inside any zoomed triangle or cluster spotlight.
   */
  readonly features?:
    | readonly SubspaceZoomFeature<TItem>[]
    | ((ctx: SubspaceZoomContext<TItem>) => readonly SubspaceZoomFeature<TItem>[]);
  /**
   * Optional continuous embedding extractor locally centered and standardized on the zoomed subset.
   */
  readonly getVector?: (item: TItem) => readonly number[];
  /**
   * Optional human-readable names for dimensions of `getVector` (used when synthesizing sub-cluster labels).
   */
  readonly vectorDimensionLabels?: readonly string[];
  /**
   * Optional pairwise similarity kernel `S(a, b) ∈ [0, 1]` used for local medoid subspace projection
   * when explicit features/vectors are absent or tied.
   */
  readonly getSimilarity?: (a: TItem, b: TItem) => number;
  /**
   * Optional item title extractor used as exemplar fallback when unnamed vectors/kernels are supplied.
   */
  readonly getItemLabel?: (item: TItem) => string;
  /**
   * Cluster badge click behavior (`'incident-star'` focuses the lattice-conformal 1-ring star of
   * incident triangles with simplex-distance item dimming; `'spotlight'` splits direct members
   * immediately into a standalone 3-sector spotlight; `'none'` disables cluster drill-down).
   * Default: `'incident-star'`.
   */
  readonly clusterZoomMode?: BarycentricClusterZoomMode;
  /** Terminates subdivision automatically once all covered items reach `fullScaleThreshold`. Default: `true`. */
  readonly stopWhenFullScale?: boolean;
  /** Full-scale ratio threshold (`placed.scale / sizeMultiplier`). Default: `0.75` (`DEFAULT_FULL_SCALE_THRESHOLD`). */
  readonly fullScaleThreshold?: number;
  /** Focuses leaf / non-subdividable triangles in multi-triangle meshes as single un-subdivided triangles. Default: `true`. */
  readonly leafTriangleFocus?: boolean;
}

export interface InternalVertexWeightData {
  readonly rootWeights: ReadonlyMap<number, number>;
  readonly subLabel?: string;
  readonly sectorKey?: string;
}

export interface InternalFrameMeta {
  readonly kind:
    | 'triangle'
    | 'triangle-focus'
    | 'cluster-star'
    | 'cluster-spotlight';
  readonly parentTriIndex?: number;
  readonly parentClusterIndex?: number;
  readonly vertexWeights: readonly InternalVertexWeightData[];
  readonly itemRootWeights?: ReadonlyMap<string, ReadonlyMap<number, number>>;
  readonly semanticTagSubset?: readonly string[];
}

export const MAX_ZOOM_DRILL_DEPTH = 10;

export const SUB_MESH_VERTEX_BARY: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
];

export interface ViewportAffineTransform extends ZoomAffineTransform {
  readonly apply: (pt: Point2D) => Point2D;
}
