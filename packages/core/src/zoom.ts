import { mixOklabColors, type OklabTuple } from './oklab.js';
import type {
  AnalyzedTagCorpus,
  NormalizedContentItem,
} from './clustering.js';

function defaultClusterCode(index: number): string {
  return `T${index + 1}`;
}
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterMixComponent,
  ClusterRole,
  ContentLayoutContext,
  Point2D,
  SimplexMesh,
  TagDescriptor,
} from './types.js';

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
  readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
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

interface InternalVertexWeightData {
  readonly rootWeights: ReadonlyMap<number, number>;
  readonly subLabel?: string;
  readonly sectorKey?: string;
}

interface InternalFrameMeta {
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

const MAX_ZOOM_DRILL_DEPTH = 10;

// ============================================================================
// Pure Geometric Helpers (1:4 Equilateral Subdivision & 1-Ring Star Extraction)
// ============================================================================

interface ViewportAffineTransform extends ZoomAffineTransform {
  readonly apply: (pt: Point2D) => Point2D;
}

function scaleAndCenterPointsToViewport(
  points: readonly Point2D[],
  viewportWidth: number,
  viewportHeight: number,
  innerPadding: number,
): {
  readonly scaled: Point2D[];
  readonly scale: number;
  readonly transform: ViewportAffineTransform;
} {
  if (points.length === 0) {
    return {
      scaled: [],
      scale: 1,
      transform: {
        scale: 1,
        sourceCx: 0,
        sourceCy: 0,
        targetCx: viewportWidth * 0.5,
        targetCy: viewportHeight * 0.5,
        apply: (pt) => pt,
      },
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const usableW = Math.max(80, viewportWidth - innerPadding * 2);
  const usableH = Math.max(80, viewportHeight - innerPadding * 2);
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  const scale = Math.min(usableW / spanX, usableH / spanY);

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const targetCx = viewportWidth * 0.5;
  const targetCy = viewportHeight * 0.5;

  const apply = (pt: Point2D): Point2D => ({
    x: targetCx + (pt.x - cx) * scale,
    y: targetCy + (pt.y - cy) * scale,
  });

  const scaled = points.map(apply);
  return {
    scaled,
    scale,
    transform: {
      scale,
      sourceCx: cx,
      sourceCy: cy,
      targetCx,
      targetCy,
      apply,
    },
  };
}

function computeContextAwarePadding(
  viewportWidth: number,
  viewportHeight: number,
  basePadding: number,
  hasSurroundingContext: boolean,
): number {
  if (!hasSurroundingContext) return basePadding;
  const minDim = Math.min(viewportWidth, viewportHeight);
  return Math.round(
    Math.min(Math.max(basePadding, minDim * 0.14), minDim * 0.24),
  );
}

function buildSubdividedTriangleMeshWithTransform(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  viewportWidth: number,
  viewportHeight: number,
  innerPadding = 64,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): {
  readonly mesh: SimplexMesh;
  readonly transform: ViewportAffineTransform;
} {
  const m01 = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
  const m12 = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
  const m20 = { x: (p2.x + p0.x) * 0.5, y: (p2.y + p0.y) * 0.5 };

  const { scaled, transform } = scaleAndCenterPointsToViewport(
    [p0, p1, p2, m01, m12, m20],
    viewportWidth,
    viewportHeight,
    innerPadding,
  );

  const neighbors: readonly (readonly number[])[] = [
    [3, 5],
    [3, 4],
    [4, 5],
    [0, 1, 4, 5],
    [1, 2, 3, 5],
    [0, 2, 3, 4],
  ];

  const rows = [0, 1, 1, 0, 1, 0];
  const cols = [0, 0, 1, 1, 2, 2];

  const vertices = scaled.map((pt, idx) => ({
    index: idx,
    row: rows[idx]!,
    col: cols[idx]!,
    x: pt.x,
    y: pt.y,
    neighbors: neighbors[idx]!,
  }));

  const edges = [
    { a: 0, b: 3 },
    { a: 3, b: 1 },
    { a: 1, b: 4 },
    { a: 4, b: 2 },
    { a: 2, b: 5 },
    { a: 5, b: 0 },
    { a: 3, b: 4 },
    { a: 4, b: 5 },
    { a: 5, b: 3 },
  ];

  const triangles = [
    { index: 0, vertices: [0, 3, 5] as const },
    { index: 1, vertices: [3, 1, 4] as const },
    { index: 2, vertices: [5, 4, 2] as const },
    { index: 3, vertices: [4, 5, 3] as const },
  ];

  const sideLength = Math.hypot(
    scaled[3]!.x - scaled[0]!.x,
    scaled[3]!.y - scaled[0]!.y,
  );

  return {
    mesh: {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength,
      orientation,
      wideFirst: true,
      areaEfficiency: 0.72,
      vertices,
      edges,
      triangles,
    },
    transform,
  };
}

/**
 * Builds a zoomed, viewport-centered 6-vertex, 9-edge, 4-triangle `1:4` equilateral
 * subdivision mesh preserving exact parent ▲/▼/▶/◀ orientation.
 *
 * Vertex layout:
 * - `0, 1, 2`: parent corners `(p0, p1, p2)`
 * - `3`: midpoint `(p0 + p1) / 2`
 * - `4`: midpoint `(p1 + p2) / 2`
 * - `5`: midpoint `(p2 + p0) / 2`
 */
export function buildSubdividedTriangleMesh(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  viewportWidth: number,
  viewportHeight: number,
  innerPadding = 64,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): SimplexMesh {
  return buildSubdividedTriangleMeshWithTransform(
    p0,
    p1,
    p2,
    viewportWidth,
    viewportHeight,
    innerPadding,
    orientation,
  ).mesh;
}

/**
 * Extracts the 1-ring star sub-mesh of all triangles incident to `centerVertexIdx`,
 * scaled cleanly into the viewport while preserving exact 60-degree geometry.
 */
export function buildIncidentStarMesh(
  parentMesh: SimplexMesh,
  centerVertexIdx: number,
  viewportWidth: number,
  viewportHeight: number,
  innerPadding = 64,
): {
  readonly mesh: SimplexMesh;
  readonly newToOldVertex: readonly number[];
  readonly oldToNewVertex: ReadonlyMap<number, number>;
  readonly transform: ViewportAffineTransform;
} | null {
  const incidentTris = parentMesh.triangles.filter((t) =>
    t.vertices.includes(centerVertexIdx),
  );
  if (incidentTris.length === 0) return null;

  const newToOldVertex: number[] = [centerVertexIdx];
  const oldToNewVertex = new Map<number, number>([[centerVertexIdx, 0]]);
  for (const tri of incidentTris) {
    for (const v of tri.vertices) {
      if (!oldToNewVertex.has(v)) {
        oldToNewVertex.set(v, newToOldVertex.length);
        newToOldVertex.push(v);
      }
    }
  }

  const rawPoints = newToOldVertex.map((oldIdx) => {
    const pv = parentMesh.vertices[oldIdx]!;
    return { x: pv.x, y: pv.y };
  });

  const { scaled, scale, transform } = scaleAndCenterPointsToViewport(
    rawPoints,
    viewportWidth,
    viewportHeight,
    innerPadding,
  );

  const edgeSet = new Set<string>();
  const edges: { a: number; b: number }[] = [];
  const adj: Set<number>[] = newToOldVertex.map(() => new Set<number>());

  const triangles = incidentTris.map((tri, newTriIdx) => {
    const [a, b, c] = tri.vertices;
    const na = oldToNewVertex.get(a)!;
    const nb = oldToNewVertex.get(b)!;
    const nc = oldToNewVertex.get(c)!;
    const pairs: readonly [number, number][] = [
      [na, nb],
      [nb, nc],
      [nc, na],
    ];
    for (const [u, v] of pairs) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = `${lo}:${hi}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ a: lo, b: hi });
      }
      adj[u]!.add(v);
      adj[v]!.add(u);
    }
    return {
      index: newTriIdx,
      vertices: [na, nb, nc] as const,
    };
  });

  const vertices = scaled.map((pt, idx) => {
    const oldV = parentMesh.vertices[newToOldVertex[idx]!]!;
    return {
      index: idx,
      row: oldV.row,
      col: oldV.col,
      x: pt.x,
      y: pt.y,
      neighbors: [...adj[idx]!].sort((x, y) => x - y),
    };
  });

  return {
    mesh: {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength: parentMesh.sideLength * scale,
      orientation: parentMesh.orientation,
      wideFirst: parentMesh.wideFirst,
      areaEfficiency: parentMesh.areaEfficiency,
      vertices,
      edges,
      triangles,
    },
    newToOldVertex,
    oldToNewVertex,
    transform,
  };
}

function buildOrientedSingleTriangleMeshWithTransform(params: {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly innerPadding?: number;
  readonly sourceTrianglePoints?: readonly [Point2D, Point2D, Point2D];
  readonly orientation?: 'horizontal' | 'vertical';
  readonly sourceCenter?: Point2D;
  readonly sourceSpan?: number;
}): {
  readonly mesh: SimplexMesh;
  readonly transform: ViewportAffineTransform;
} {
  const {
    viewportWidth,
    viewportHeight,
    innerPadding = 68,
    sourceTrianglePoints,
    orientation = 'horizontal',
    sourceCenter,
    sourceSpan,
  } = params;

  if (sourceTrianglePoints) {
    const [q0, q1, q2] = sourceTrianglePoints;
    const { scaled, transform } = scaleAndCenterPointsToViewport(
      [q0, q1, q2],
      viewportWidth,
      viewportHeight,
      innerPadding,
    );
    const s0 = scaled[0]!;
    const s1 = scaled[1]!;
    const s2 = scaled[2]!;
    const sideLength = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    return {
      mesh: {
        width: viewportWidth,
        height: viewportHeight,
        innerPadding,
        sideLength,
        orientation,
        wideFirst: true,
        areaEfficiency: 0.5,
        vertices: [
          { index: 0, row: 0, col: 0, x: s0.x, y: s0.y, neighbors: [1, 2] },
          { index: 1, row: 1, col: 0, x: s1.x, y: s1.y, neighbors: [0, 2] },
          { index: 2, row: 1, col: 1, x: s2.x, y: s2.y, neighbors: [0, 1] },
        ],
        edges: [
          { a: 0, b: 1 },
          { a: 1, b: 2 },
          { a: 2, b: 0 },
        ],
        triangles: [{ index: 0, vertices: [0, 1, 2] as const }],
      },
      transform,
    };
  }

  const usableW = Math.max(120, viewportWidth - innerPadding * 2);
  const usableH = Math.max(120, viewportHeight - innerPadding * 2);
  const s =
    orientation === 'vertical'
      ? Math.min(usableH, (usableW * 2) / Math.sqrt(3))
      : Math.min(usableW, (usableH * 2) / Math.sqrt(3));
  const h = (s * Math.sqrt(3)) / 2;
  const cx = viewportWidth * 0.5;
  const cy = viewportHeight * 0.5;

  const p0 =
    orientation === 'vertical'
      ? { x: cx - h * 0.5, y: cy - s * 0.5 }
      : { x: cx, y: cy - h * 0.5 };
  const p1 =
    orientation === 'vertical'
      ? { x: cx - h * 0.5, y: cy + s * 0.5 }
      : { x: cx - s * 0.5, y: cy + h * 0.5 };
  const p2 =
    orientation === 'vertical'
      ? { x: cx + h * 0.5, y: cy }
      : { x: cx + s * 0.5, y: cy + h * 0.5 };

  const scale =
    sourceSpan && sourceSpan > 1 ? Math.max(1.35, s / sourceSpan) : 2.0;
  const srcCx = sourceCenter?.x ?? cx;
  const srcCy = sourceCenter?.y ?? cy;

  return {
    mesh: {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength: s,
      orientation,
      wideFirst: true,
      areaEfficiency: 0.5,
      vertices: [
        { index: 0, row: 0, col: 0, x: p0.x, y: p0.y, neighbors: [1, 2] },
        { index: 1, row: 1, col: 0, x: p1.x, y: p1.y, neighbors: [0, 2] },
        { index: 2, row: 1, col: 1, x: p2.x, y: p2.y, neighbors: [0, 1] },
      ],
      edges: [
        { a: 0, b: 1 },
        { a: 1, b: 2 },
        { a: 2, b: 0 },
      ],
      triangles: [{ index: 0, vertices: [0, 1, 2] as const }],
    },
    transform: {
      scale,
      sourceCx: srcCx,
      sourceCy: srcCy,
      targetCx: cx,
      targetCy: cy,
      apply: (pt: Point2D) => ({
        x: cx + (pt.x - srcCx) * scale,
        y: cy + (pt.y - srcCy) * scale,
      }),
    },
  };
}

// ============================================================================
// Root-Weight & Convex Interpolation Utilities
// ============================================================================

function normalizeWeightMap(raw: ReadonlyMap<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  let total = 0;
  for (const [k, v] of raw) {
    if (v > 1e-6) {
      out.set(k, v);
      total += v;
    }
  }
  if (total <= 1e-9) return out;
  for (const [k, v] of out) {
    const w = v / total;
    if (w > 1e-5) {
      out.set(k, w);
    } else {
      out.delete(k);
    }
  }
  return out;
}

function mixRootWeightMaps(
  a: ReadonlyMap<number, number>,
  wa: number,
  b: ReadonlyMap<number, number>,
  wb: number,
  c?: ReadonlyMap<number, number>,
  wc = 0,
): Map<number, number> {
  const sum = new Map<number, number>();
  for (const [k, v] of a) sum.set(k, (sum.get(k) ?? 0) + v * wa);
  for (const [k, v] of b) sum.set(k, (sum.get(k) ?? 0) + v * wb);
  if (c && wc > 0) {
    for (const [k, v] of c) sum.set(k, (sum.get(k) ?? 0) + v * wc);
  }
  return normalizeWeightMap(sum);
}

function getFrameVertexRootWeights<TItem, TTagMeta, TClusterMeta>(
  frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  vertexIdx: number,
): ReadonlyMap<number, number> {
  const meta = frame.strategyData as InternalFrameMeta | undefined;
  const fromMeta = meta?.vertexWeights[vertexIdx]?.rootWeights;
  if (fromMeta) return fromMeta;
  return new Map<number, number>([[vertexIdx, 1]]);
}

function getItemRootWeights<TItem, TTagMeta, TClusterMeta>(
  frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  item: ZoomItemAnchorInput<TItem, TTagMeta>,
): ReadonlyMap<number, number> {
  const meta = frame.strategyData as InternalFrameMeta | undefined;
  const direct = meta?.itemRootWeights?.get(item.id);
  if (direct) return direct;

  const out = new Map<number, number>();
  for (const uw of item.unitWeights) {
    const vWeights = getFrameVertexRootWeights(frame, uw.clusterIndex);
    for (const [rootIdx, rw] of vWeights) {
      out.set(rootIdx, (out.get(rootIdx) ?? 0) + rw * uw.weight);
    }
  }
  return normalizeWeightMap(out);
}

/**
 * Solves exact 3D/Simplex barycentric coordinates `(λ0, λ1, λ2)` of `targetWeights`
 * as a convex combination of 3 triangle corner weight distributions `(w0, w1, w2)`.
 * Returns `null` if `targetWeights` lies materially outside the simplex spanned by `(w0, w1, w2)`.
 */
function projectRootWeightsOntoTriangleCorners(
  targetWeights: ReadonlyMap<number, number>,
  w0: ReadonlyMap<number, number>,
  w1: ReadonlyMap<number, number>,
  w2: ReadonlyMap<number, number>,
): { readonly l0: number; readonly l1: number; readonly l2: number } | null {
  const allKeys = new Set<number>([
    ...targetWeights.keys(),
    ...w0.keys(),
    ...w1.keys(),
    ...w2.keys(),
  ]);
  const keys = [...allKeys];
  if (keys.length === 0) return null;

  // Solve min || l0*w0 + l1*w1 + l2*w2 - target ||^2  s.t. l0+l1+l2=1, l >= 0
  // Express l0 = 1 - u - v, l1 = u, l2 = v -> 2D least squares over (u, v)
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const k of keys) {
    const t = targetWeights.get(k) ?? 0;
    const x0 = w0.get(k) ?? 0;
    const d1 = (w1.get(k) ?? 0) - x0;
    const d2 = (w2.get(k) ?? 0) - x0;
    const rhs = t - x0;
    a11 += d1 * d1;
    a12 += d1 * d2;
    a22 += d2 * d2;
    b1 += d1 * rhs;
    b2 += d2 * rhs;
  }

  const det = a11 * a22 - a12 * a12;
  let l0: number;
  let l1: number;
  let l2: number;

  if (det > 1e-10) {
    const u = (b1 * a22 - b2 * a12) / det;
    const v = (a11 * b2 - a12 * b1) / det;
    l1 = u;
    l2 = v;
    l0 = 1 - u - v;
  } else {
    // Degenerate / collinear corners: fall back to 1D edge projection
    let bestEdge = { l0: 1, l1: 0, l2: 0, errSq: Infinity };
    const candidates: readonly [
      number,
      number,
      number,
      ReadonlyMap<number, number>,
      ReadonlyMap<number, number>,
    ][] = [
      [0, 1, 2, w0, w1],
      [1, 2, 0, w1, w2],
      [2, 0, 1, w2, w0],
    ];
    for (const [iA, iB, _iC, mapA, mapB] of candidates) {
      let denom = 0;
      let num = 0;
      for (const k of keys) {
        const diff = (mapB.get(k) ?? 0) - (mapA.get(k) ?? 0);
        const rhs = (targetWeights.get(k) ?? 0) - (mapA.get(k) ?? 0);
        denom += diff * diff;
        num += diff * rhs;
      }
      const t = denom > 1e-9 ? Math.max(0, Math.min(1, num / denom)) : 0;
      let errSq = 0;
      for (const k of keys) {
        const val =
          (mapA.get(k) ?? 0) * (1 - t) +
          (mapB.get(k) ?? 0) * t -
          (targetWeights.get(k) ?? 0);
        errSq += val * val;
      }
      if (errSq < bestEdge.errSq) {
        const arr = [0, 0, 0];
        arr[iA] = 1 - t;
        arr[iB] = t;
        bestEdge = { l0: arr[0]!, l1: arr[1]!, l2: arr[2]!, errSq };
      }
    }
    l0 = bestEdge.l0;
    l1 = bestEdge.l1;
    l2 = bestEdge.l2;
  }

  // Clamp tiny numerical noise to exact [0, 1] simplex; reject if far outside
  if (l0 < -0.025 || l1 < -0.025 || l2 < -0.025) {
    return null;
  }
  const c0 = Math.max(0, l0);
  const c1 = Math.max(0, l1);
  const c2 = Math.max(0, l2);
  const sum = c0 + c1 + c2;
  if (sum <= 1e-9) return null;
  const n0 = c0 / sum;
  const n1 = c1 / sum;
  const n2 = c2 / sum;

  // Verify reconstruction residual across root dimensions
  let errSq = 0;
  for (const k of keys) {
    const recon =
      n0 * (w0.get(k) ?? 0) +
      n1 * (w1.get(k) ?? 0) +
      n2 * (w2.get(k) ?? 0);
    const diff = recon - (targetWeights.get(k) ?? 0);
    errSq += diff * diff;
  }
  if (errSq > 1e-4) {
    return null;
  }

  return { l0: n0, l1: n1, l2: n2 };
}

function isItemCoveredByVertices<TItem, TTagMeta, TClusterMeta>(
  frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  item: ZoomItemAnchorInput<TItem, TTagMeta>,
  vertexSet: ReadonlySet<number>,
): boolean {
  if (item.unitWeights.length === 0) return false;
  return item.unitWeights.every((uw) => vertexSet.has(uw.clusterIndex));
}

function buildSynthesizedClusterDescriptor<TItem, TTagMeta, TClusterMeta>(params: {
  readonly clusterIndex: number;
  readonly clusterUid: string;
  readonly code: string;
  readonly defaultLabel: string;
  readonly oklab: OklabTuple;
  readonly hex: string;
  readonly vertex: {
    readonly row: number;
    readonly col: number;
    readonly x: number;
    readonly y: number;
  };
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  readonly sharedTags: readonly TagDescriptor<TTagMeta>[];
  readonly members: ClusterDescriptor<
    TItem,
    TTagMeta,
    TClusterMeta
  >['members'];
  readonly featureSummary?: string;
  readonly role?: ClusterRole;
  readonly mixWeights?: readonly ClusterMixComponent[];
  readonly subclusterLabel?: string;
  readonly parentContextLabel?: string;
  readonly preservePrimaryTitle?: string;
  readonly deriveClusterMeta: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
}): ClusterDescriptor<TItem, TTagMeta, TClusterMeta> {
  const ctx: ClusterDerivationContext<TItem, TTagMeta> = {
    clusterIndex: params.clusterIndex,
    clusterUid: params.clusterUid,
    code: params.code,
    defaultLabel: params.defaultLabel,
    colorHex: params.hex,
    oklab: params.oklab,
    gridNode: {
      row: params.vertex.row,
      col: params.vertex.col,
      x: params.vertex.x,
      y: params.vertex.y,
    },
    coreTags: params.coreTags,
    sharedTags: params.sharedTags,
    members: params.members,
    featureSummary: params.featureSummary,
    role: params.role ?? 'primary',
    mixWeights: params.mixWeights,
    subclusterLabel: params.subclusterLabel,
    parentContextLabel: params.parentContextLabel,
  };
  const rawMeta = params.deriveClusterMeta(ctx);
  const meta =
    params.preservePrimaryTitle &&
    typeof rawMeta === 'object' &&
    rawMeta !== null &&
    'title' in rawMeta &&
    typeof (rawMeta as { readonly title?: unknown }).title === 'string'
      ? ({
          ...(rawMeta as Record<string, unknown>),
          title: params.preservePrimaryTitle,
        } as TClusterMeta)
      : rawMeta;
  return {
    ...ctx,
    meta,
  };
}

function truncateClean(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function resolveReadableClusterName<TItem, TTagMeta, TClusterMeta>(
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  maxChars = 16,
): string {
  if (!cluster) return 'Cluster';
  let raw = '';
  if (
    cluster.meta &&
    typeof cluster.meta === 'object' &&
    'title' in cluster.meta &&
    typeof (cluster.meta as { readonly title?: unknown }).title === 'string'
  ) {
    const metaTitle = (cluster.meta as { readonly title: string }).title.trim();
    if (metaTitle.length > 0 && metaTitle !== 'bridge') {
      raw = metaTitle;
    }
  }
  if (!raw) {
    raw =
      cluster.subclusterLabel ||
      cluster.parentContextLabel ||
      cluster.defaultLabel ||
      cluster.code;
  }
  const primaryPart = raw.split(/\s*\/\s*|\s*↔\s*/)[0]!.trim() || raw.trim();
  return truncateClean(primaryPart, maxChars);
}

function deriveCornerParentContextLabel<TItem, TTagMeta, TClusterMeta>(
  parentCorner: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
): string {
  if (parentCorner.parentContextLabel && parentCorner.subclusterLabel) {
    const rootPart = truncateClean(parentCorner.parentContextLabel, 9);
    const subPart = truncateClean(parentCorner.subclusterLabel, 10);
    if (rootPart.toLowerCase() !== subPart.toLowerCase()) {
      return `${rootPart} › ${subPart}`;
    }
  }
  if (parentCorner.parentContextLabel) {
    return truncateClean(parentCorner.parentContextLabel, 18);
  }
  return resolveReadableClusterName(parentCorner, 18);
}

function buildTriangleBreadcrumbInfo<TItem, TTagMeta, TClusterMeta>(
  corners: readonly (
    | ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
    | undefined
  )[],
  fallbackCodes: readonly string[],
): {
  readonly label: string;
  readonly shortLabel: string;
  readonly segments: readonly ZoomBreadcrumbSegment[];
} {
  const segments: ZoomBreadcrumbSegment[] = corners.map((c, idx) => ({
    label: c ? resolveReadableClusterName(c, 14) : fallbackCodes[idx]!,
    colorHex: c?.colorHex,
  }));
  const joined = segments.map((s) => s.label).join(' · ');
  return {
    label: joined,
    shortLabel: joined,
    segments,
  };
}

function buildClusterBreadcrumbInfo<TItem, TTagMeta, TClusterMeta>(
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
): {
  readonly label: string;
  readonly shortLabel: string;
  readonly segments: readonly ZoomBreadcrumbSegment[];
} {
  const name = resolveReadableClusterName(cluster, 18);
  return {
    label: `${cluster.code} · ${name}`,
    shortLabel: name,
    segments: [{ label: name, colorHex: cluster.colorHex }],
  };
}

function extractHumanExemplarTitle<TItem>(
  item: TItem,
  getItemLabel?: (item: TItem) => string,
): string | null {
  if (getItemLabel) {
    const custom = getItemLabel(item)?.trim();
    if (custom) return custom.replace(/\s*\(\d{4}\)$/, '').trim();
  }
  if (typeof item === 'object' && item !== null) {
    const rec = item as Record<string, unknown>;
    const candidateKeys = [
      'shortTitle',
      'title',
      'label',
      'name',
      'headline',
      'speciesName',
      'fullName',
      'speakerName',
      'specimenCode',
    ];
    for (const k of candidateKeys) {
      const val = rec[k];
      if (typeof val === 'string' && val.trim().length > 0) {
        return val.trim().replace(/\s*\(\d{4}\)$/, '').trim();
      }
    }
    for (const nestedKey of [
      'entry',
      'repo',
      'animal',
      'zoo',
      'media',
      'voice',
      'body',
    ]) {
      const nested = rec[nestedKey];
      if (typeof nested === 'object' && nested !== null) {
        const nRec = nested as Record<string, unknown>;
        for (const k of candidateKeys) {
          const val = nRec[k];
          if (typeof val === 'string' && val.trim().length > 0) {
            return val.trim().replace(/\s*\(\d{4}\)$/, '').trim();
          }
        }
      }
    }
  }
  return null;
}

function sortRootWeightEntries(
  weights: ReadonlyMap<number, number>,
): ReadonlyArray<readonly [number, number]> {
  return [...weights.entries()]
    .filter(([, w]) => w >= 0.005)
    .sort((a, b) =>
      Math.abs(b[1] - a[1]) > 1e-4 ? b[1] - a[1] : a[0] - b[0],
    );
}

function buildMixWeights<TItem, TTagMeta, TClusterMeta>(
  weights: ReadonlyMap<number, number>,
  rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
): readonly ClusterMixComponent[] {
  return sortRootWeightEntries(weights).map(([idx, w]) => {
    const c = rootClusters[idx];
    return {
      code: c?.code ?? defaultClusterCode(idx),
      label: resolveReadableClusterName(c, 16),
      colorHex: c?.colorHex ?? '#64748b',
      weight: w,
    };
  });
}

function formatCompactBridgeLabel<TItem, TTagMeta, TClusterMeta>(
  weights: ReadonlyMap<number, number>,
  rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
  immediateEdgePair?: readonly [
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  ],
): string {
  if (immediateEdgePair && immediateEdgePair[0] && immediateEdgePair[1]) {
    const nameA = resolveReadableClusterName(immediateEdgePair[0], 10);
    const nameB = resolveReadableClusterName(immediateEdgePair[1], 10);
    if (nameA.toLowerCase() !== nameB.toLowerCase()) {
      return `${nameA} ↔ ${nameB}`;
    }
  }
  const sorted = sortRootWeightEntries(weights);
  if (sorted.length === 0) return 'Bridge';
  const [domIdx, domW] = sorted[0]!;
  const domCluster = rootClusters[domIdx];
  if (sorted.length === 1 || domW >= 0.996) {
    return resolveReadableClusterName(domCluster, 16);
  }
  const [idxA, wA] = sorted[0]!;
  const [idxB] = sorted[1]!;
  const nameA = resolveReadableClusterName(rootClusters[idxA], 10);
  const nameB = resolveReadableClusterName(rootClusters[idxB], 10);
  if (Math.abs(wA - 0.5) <= 0.04) {
    return `${nameA} ↔ ${nameB}`;
  }
  const pctA = wA >= 0.99 ? 99 : Math.max(1, Math.round(wA * 100));
  return `${pctA}% ${nameA} · ${nameB}`;
}

function formatMixLabel<TItem, TTagMeta, TClusterMeta>(
  weights: ReadonlyMap<number, number>,
  rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
): { readonly code: string; readonly label: string } {
  const sorted = sortRootWeightEntries(weights);
  if (sorted.length === 0) {
    return { code: 'M', label: 'Midpoint' };
  }
  const [domIdx, domW] = sorted[0]!;
  const domCluster = rootClusters[domIdx];
  if (sorted.length === 1 || domW >= 0.996) {
    return {
      code: domCluster?.code ?? defaultClusterCode(domIdx),
      label: resolveReadableClusterName(domCluster, 18),
    };
  }
  if (sorted.length === 2) {
    const [idxA, wA] = sorted[0]!;
    const [idxB] = sorted[1]!;
    const cA = rootClusters[idxA];
    const cB = rootClusters[idxB];
    const codeA = cA?.code ?? defaultClusterCode(idxA);
    const codeB = cB?.code ?? defaultClusterCode(idxB);
    const nameA = resolveReadableClusterName(cA, 12);
    const nameB = resolveReadableClusterName(cB, 12);
    if (Math.abs(wA - 0.5) <= 0.03) {
      return {
        code: `${codeA}·${codeB}`,
        label: `${nameA} ↔ ${nameB}`,
      };
    }
    const pctA = wA >= 0.99 ? 99 : Math.max(1, Math.round(wA * 100));
    const pctB = Math.max(1, 100 - pctA);
    return {
      code: `${codeA}·${codeB}`,
      label: `${pctA}% ${nameA} · ${pctB}% ${nameB}`,
    };
  }

  const topEntries =
    sorted[2] && sorted[2][1] >= 0.14 ? sorted.slice(0, 3) : sorted.slice(0, 2);
  const code = topEntries
    .map(([idx]) => rootClusters[idx]?.code ?? defaultClusterCode(idx))
    .join('·');
  const label = topEntries
    .map(([idx, w]) => {
      const c = rootClusters[idx];
      const name = resolveReadableClusterName(c, 11);
      const pct = w >= 0.99 ? '99' : w < 0.01 ? '<1' : String(Math.round(w * 100));
      return `${pct}% ${name}`;
    })
    .join(' · ');
  return { code, label };
}

function computeFullScaleStats(
  itemIds: readonly string[],
  itemScaleRatios: ReadonlyMap<string, number>,
  fullScaleThreshold: number,
): {
  readonly fullScaleCount: number;
  readonly ratio: number;
  readonly hasUnderScaled: boolean;
} {
  if (itemIds.length === 0) {
    return { fullScaleCount: 0, ratio: 1, hasUnderScaled: false };
  }
  let fullScaleCount = 0;
  for (const id of itemIds) {
    const ratio = itemScaleRatios.get(id) ?? 1;
    if (ratio >= fullScaleThreshold) {
      fullScaleCount++;
    }
  }
  return {
    fullScaleCount,
    ratio: fullScaleCount / itemIds.length,
    hasUnderScaled: fullScaleCount < itemIds.length,
  };
}

function evaluateTriangleFrameNeighbors<TItem, TTagMeta, TClusterMeta>(
  parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  parentTriIndex: number,
  subMesh: SimplexMesh,
): readonly ZoomNeighborTarget[] {
  const parentTri = parentFrame.mesh.triangles[parentTriIndex];
  if (!parentTri) return [];
  const [v0, v1, v2] = parentTri.vertices;
  const edgeSpecs: readonly {
    readonly a: number;
    readonly b: number;
    readonly localA: number;
    readonly localB: number;
    readonly midVertexIdx: number;
  }[] = [
    { a: v0, b: v1, localA: 0, localB: 1, midVertexIdx: 3 },
    { a: v1, b: v2, localA: 1, localB: 2, midVertexIdx: 4 },
    { a: v2, b: v0, localA: 2, localB: 0, midVertexIdx: 5 },
  ];

  const sv0 = subMesh.vertices[0]!;
  const sv1 = subMesh.vertices[1]!;
  const sv2 = subMesh.vertices[2]!;
  const triCx = (sv0.x + sv1.x + sv2.x) / 3;
  const triCy = (sv0.y + sv1.y + sv2.y) / 3;

  const neighbors: ZoomNeighborTarget[] = [];
  for (const spec of edgeSpecs) {
    const adjTri = parentFrame.mesh.triangles.find(
      (t) =>
        t.index !== parentTriIndex &&
        t.vertices.includes(spec.a) &&
        t.vertices.includes(spec.b),
    );
    if (!adjTri) continue;

    const la = subMesh.vertices[spec.localA]!;
    const lb = subMesh.vertices[spec.localB]!;
    const midPt = subMesh.vertices[spec.midVertexIdx] ?? {
      x: (la.x + lb.x) * 0.5,
      y: (la.y + lb.y) * 0.5,
    };
    const nxRaw = midPt.x - triCx;
    const nyRaw = midPt.y - triCy;
    const nLen = Math.hypot(nxRaw, nyRaw) || 1;

    const vertSet = new Set(adjTri.vertices);
    let itemCount = 0;
    for (const it of parentFrame.items) {
      if (isItemCoveredByVertices(parentFrame, it, vertSet)) itemCount++;
    }
    const cornerClusters = adjTri.vertices.map((vi) => parentFrame.clusters[vi]);
    const cornerNames = cornerClusters.map((c, idx) =>
      c ? resolveReadableClusterName(c, 12) : defaultClusterCode(adjTri.vertices[idx]!),
    );
    const mixed = mixOklabColors(
      cornerClusters
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );

    neighbors.push({
      id: `tri:${adjTri.index}`,
      targetKind: 'triangle',
      label: `${cornerNames.join(' · ')} (${itemCount})`,
      shortLabel: cornerNames.join(' · '),
      itemCount,
      anchorPoint: { x: midPt.x, y: midPt.y },
      normal: { x: nxRaw / nLen, y: nyRaw / nLen },
      accentHex: mixed.hex,
    });
  }
  return neighbors;
}

function buildSectorPartitionFrame<TItem, TTagMeta, TClusterMeta>(params: {
  readonly frameId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly accentHex: string;
  readonly breadcrumbSegments?: readonly ZoomBreadcrumbSegment[];
  readonly parentContextLabel?: string;
  readonly getItemLabel?: (item: TItem) => string;
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly baseRootWeights: ReadonlyMap<number, number>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
  readonly neighbors: readonly ZoomNeighborTarget[];
  readonly sourceTrianglePoints?: readonly [Point2D, Point2D, Point2D];
  readonly innerPadding?: number;
  readonly meshOrientation?: 'horizontal' | 'vertical';
  readonly sourceCenter?: Point2D;
  readonly sourceSpan?: number;
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
}): ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> {
  const {
    frameId,
    label,
    shortLabel,
    accentHex,
    breadcrumbSegments,
    parentContextLabel,
    getItemLabel,
    coveredItems,
    baseRootWeights,
    helpers,
    neighbors,
    sourceTrianglePoints,
    innerPadding,
    meshOrientation,
    sourceCenter,
    sourceSpan,
    contextTriangles,
    contextEdges,
    contextClusters,
    contextItems,
  } = params;

  const { mesh, transform } = buildOrientedSingleTriangleMeshWithTransform({
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    innerPadding: innerPadding ?? helpers.innerPadding,
    sourceTrianglePoints,
    orientation: meshOrientation ?? 'horizontal',
    sourceCenter,
    sourceSpan,
  });

  const parentToFrameTransform: ZoomAffineTransform = {
    scale: transform.scale,
    sourceCx: transform.sourceCx,
    sourceCy: transform.sourceCy,
    targetCx: transform.targetCx,
    targetCy: transform.targetCy,
  };

  // Split identical / single-point items evenly into 3 spatial sectors `[S1, S2, S3]`
  // using mild intra-group weights so they fan across the entire viewport triangle at 1.0x scale.
  const baseLab = mixOklabColors(
    [...baseRootWeights.entries()].map(([idx, w]) => ({
      oklab: helpers.rootClusters[idx]!.oklab,
      weight: w,
    })),
  ).oklab;

  const sectorLabs: readonly OklabTuple[] = [
    [
      Math.min(0.84, baseLab[0] + 0.04),
      baseLab[1] * 1.05 + 0.02,
      baseLab[2] * 0.95 - 0.01,
    ],
    [
      Math.max(0.54, baseLab[0] - 0.03),
      baseLab[1] * 0.95 - 0.02,
      baseLab[2] * 1.05 + 0.02,
    ],
    [
      baseLab[0],
      baseLab[1] * 0.98 - 0.01,
      baseLab[2] * 0.98 - 0.02,
    ],
  ];

  const sortedItems = [...coveredItems].sort((a, b) => a.id.localeCompare(b.id));
  const sectorBuckets: ZoomItemAnchorInput<TItem, TTagMeta>[][] = [[], [], []];
  const nextItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = sortedItems.map(
    (item, i) => {
      const s = i % 3;
      const vPos = mesh.vertices[s]!;
      const centroidX =
        (mesh.vertices[0]!.x + mesh.vertices[1]!.x + mesh.vertices[2]!.x) / 3;
      const centroidY =
        (mesh.vertices[0]!.y + mesh.vertices[1]!.y + mesh.vertices[2]!.y) / 3;
      const localX = vPos.x * 0.64 + centroidX * 0.36;
      const localY = vPos.y * 0.64 + centroidY * 0.36;
      const wPrimary = 0.64;
      const wOther = 0.18;
      const unitWeights = [0, 1, 2].map((ci) => ({
        clusterIndex: ci,
        weight: ci === s ? wPrimary : wOther,
        coverage: ci === s ? wPrimary : wOther,
      }));
      const converted: ZoomItemAnchorInput<TItem, TTagMeta> = {
        ...item,
        anchorX: localX,
        anchorY: localY,
        unitWeights,
      };
      sectorBuckets[s]!.push(converted);
      return converted;
    },
  );

  const sectorLetters = ['A', 'B', 'C'] as const;
  const mixWeights = buildMixWeights(baseRootWeights, helpers.rootClusters);
  const baseFmt = formatMixLabel(baseRootWeights, helpers.rootClusters);
  const sectorPrefix = baseFmt.code.length <= 5 ? `${baseFmt.code}·` : '';
  const effectiveParentContext =
    parentContextLabel ?? truncateClean(baseFmt.label, 18);

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = [0, 1, 2].map(
    (s) => {
      const lab = sectorLabs[s]!;
      const mixedHex = mixOklabColors([{ oklab: lab, weight: 1 }]).hex;
      const bucket = sectorBuckets[s]!;
      const leadItem = bucket[0];
      const exemplar = leadItem
        ? extractHumanExemplarTitle(leadItem.item, getItemLabel)
        : null;
      let sectorLabel: string;
      if (exemplar) {
        sectorLabel =
          bucket.length > 1
            ? `“${truncateClean(exemplar, 12)}” +${bucket.length - 1}`
            : truncateClean(exemplar, 15);
      } else if (leadItem && leadItem.tags.length > 0) {
        const topTag = leadItem.tags[0]!.tag.replace(/^#+/, '').slice(0, 9);
        sectorLabel = `#${topTag} · ${sectorLetters[s]} (${bucket.length})`;
      } else {
        sectorLabel = `Group ${sectorLetters[s]} (${bucket.length})`;
      }
      const members = nextItems.map((it) => {
        const uw = it.unitWeights[s]!;
        return {
          item: it.item,
          itemId: it.id,
          coverage: uw.coverage,
          normalizedWeight: uw.weight,
          isExclusiveVertexMember: false,
        };
      });
      return buildSynthesizedClusterDescriptor({
        clusterIndex: s,
        clusterUid: helpers.allocateClusterUid(),
        code: `${sectorPrefix}S${s + 1}`,
        defaultLabel: sectorLabel,
        oklab: lab,
        hex: mixedHex,
        vertex: mesh.vertices[s]!,
        coreTags: [],
        sharedTags: [],
        members,
        featureSummary: `Spatial group ${sectorLetters[s]} (${sectorLabel})`,
        role: 'intermediate',
        mixWeights,
        subclusterLabel: sectorLabel,
        parentContextLabel: effectiveParentContext,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    },
  );

  return {
    frameId,
    kind: 'cluster-spotlight',
    label,
    shortLabel,
    accentHex,
    breadcrumbSegments,
    mesh,
    clusters,
    items: nextItems,
    neighbors,
    parentToFrameTransform,
    contextTriangles,
    contextEdges,
    contextClusters,
    contextItems,
    strategyData: {
      kind: 'cluster-spotlight',
      vertexWeights: [0, 1, 2].map(() => ({ rootWeights: baseRootWeights })),
    } satisfies InternalFrameMeta,
  };
}

// ============================================================================
// Core Recursive 1:4 Barycentric Triangle Drill-Down Builder
// ============================================================================

function bboxOverlapsViewport(
  pts: readonly Point2D[],
  vw: number,
  vh: number,
  marginFactor = 0.55,
): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return (
    maxX >= -vw * marginFactor &&
    minX <= vw * (1 + marginFactor) &&
    maxY >= -vh * marginFactor &&
    minY <= vh * (1 + marginFactor)
  );
}

function pointNearViewport(
  pt: Point2D,
  vw: number,
  vh: number,
  marginFactor = 0.95,
): boolean {
  return (
    pt.x >= -vw * marginFactor &&
    pt.x <= vw * (1 + marginFactor) &&
    pt.y >= -vh * marginFactor &&
    pt.y <= vh * (1 + marginFactor)
  );
}

/**
 * Encodes an ancestor-scoped neighbor target (`@<frameId>/<localTarget>`)
 * so dimmed neighborhood elements from any zoom depth remain unambiguously clickable.
 */
export function formatScopedNeighborId(
  frameId: string,
  localTarget: string,
): string {
  return `@${frameId}/${localTarget}`;
}

/**
 * Parses a neighbor ID that may either be ancestor-scoped (`@<frameId>/<localTarget>`)
 * or unqualified (`tri:<idx>`, `cluster:<idx>`).
 */
export function parseScopedNeighborId(neighborId: string): {
  readonly parentFrameId?: string;
  readonly localTarget: string;
} {
  if (neighborId.startsWith('@')) {
    const slashIdx = neighborId.indexOf('/');
    if (slashIdx > 1) {
      return {
        parentFrameId: neighborId.slice(1, slashIdx),
        localTarget: neighborId.slice(slashIdx + 1),
      };
    }
  }
  return { localTarget: neighborId };
}

function pairEdgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function buildNeighborhoodContext<TItem, TTagMeta, TClusterMeta>(params: {
  readonly parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly excludedTriangleIndices: ReadonlySet<number>;
  readonly excludedVertexIndices: ReadonlySet<number>;
  readonly activeParentEdgeKeys: ReadonlySet<string>;
  readonly activeItemIds: ReadonlySet<string>;
  readonly parentSettledItems?: ReadonlyMap<
    string,
    { readonly x: number; readonly y: number; readonly scale: number }
  >;
  readonly transform: ViewportAffineTransform;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly allowClusterDrill: boolean;
}): {
  readonly contextTriangles: readonly ZoomContextTriangle<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextEdges: readonly ZoomContextEdge<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextClusters: readonly ZoomContextCluster<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextItems: readonly ZoomContextItem<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
} {
  const {
    parentFrame,
    excludedTriangleIndices,
    excludedVertexIndices,
    activeParentEdgeKeys,
    activeItemIds,
    parentSettledItems,
    transform,
    viewportWidth: vw,
    viewportHeight: vh,
  } = params;

  const fallbackOklab = mixOklabColors([]);
  const contextTriangles: ZoomContextTriangle<TItem, TTagMeta, TClusterMeta>[] = [];
  const nonExcludedParentTris: Array<{
    readonly index: number;
    readonly vSet: ReadonlySet<number>;
  }> = [];

  // Carry over deeper ancestor context triangles FIRST (underneath immediate sibling triangles)
  // while preserving their scoped `neighborId` so clicking outer ancestor neighbors works at any depth.
  if (parentFrame.contextTriangles) {
    for (const pct of parentFrame.contextTriangles) {
      const pa = transform.apply(pct.points[0]);
      const pb = transform.apply(pct.points[1]);
      const pc = transform.apply(pct.points[2]);
      if (!bboxOverlapsViewport([pa, pb, pc], vw, vh)) continue;
      contextTriangles.push({
        ...pct,
        id: `anc-${pct.id}`,
        neighborId: pct.neighborId,
        points: [pa, pb, pc],
        centroid: {
          x: (pa.x + pb.x + pc.x) / 3,
          y: (pa.y + pb.y + pc.y) / 3,
        },
      });
    }
  }

  for (const tri of parentFrame.mesh.triangles) {
    if (excludedTriangleIndices.has(tri.index)) continue;
    const [va, vb, vc] = tri.vertices;
    const vSet = new Set<number>([va, vb, vc]);
    nonExcludedParentTris.push({ index: tri.index, vSet });

    const pa = transform.apply(parentFrame.mesh.vertices[va]!);
    const pb = transform.apply(parentFrame.mesh.vertices[vb]!);
    const pc = transform.apply(parentFrame.mesh.vertices[vc]!);
    if (!bboxOverlapsViewport([pa, pb, pc], vw, vh)) continue;

    const cA = parentFrame.clusters[va];
    const cB = parentFrame.clusters[vb];
    const cC = parentFrame.clusters[vc];
    const mixed = mixOklabColors(
      [cA, cB, cC]
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );

    let coveredItemCount = 0;
    let interiorItemCount = 0;
    for (const it of parentFrame.items) {
      if (isItemCoveredByVertices(parentFrame, it, vSet)) {
        coveredItemCount++;
        if (it.unitWeights.length === 3) interiorItemCount++;
      }
    }

    contextTriangles.push({
      id: `ctx-tri-${parentFrame.frameId}-${tri.index}`,
      neighborId: formatScopedNeighborId(parentFrame.frameId, `tri:${tri.index}`),
      points: [pa, pb, pc],
      centroid: {
        x: (pa.x + pb.x + pc.x) / 3,
        y: (pa.y + pb.y + pc.y) / 3,
      },
      clusters: [cA, cB, cC],
      mixedColorHex:
        cA || cB || cC ? mixed.hex : fallbackOklab.hex,
      coveredItemCount,
      interiorItemCount,
    });
  }

  const contextEdges: ZoomContextEdge<TItem, TTagMeta, TClusterMeta>[] = [];
  const seenEdgeGeoKeys = new Set<string>();

  const edgeGeoKey = (p1: Point2D, p2: Point2D): string => {
    const k1 = `${Math.round(p1.x)},${Math.round(p1.y)}`;
    const k2 = `${Math.round(p2.x)},${Math.round(p2.y)}`;
    return k1 < k2 ? `${k1}-${k2}` : `${k2}-${k1}`;
  };

  for (const edge of parentFrame.mesh.edges) {
    if (activeParentEdgeKeys.has(pairEdgeKey(edge.a, edge.b))) continue;
    const pa = transform.apply(parentFrame.mesh.vertices[edge.a]!);
    const pb = transform.apply(parentFrame.mesh.vertices[edge.b]!);
    if (!bboxOverlapsViewport([pa, pb], vw, vh)) continue;
    const gKey = edgeGeoKey(pa, pb);
    if (seenEdgeGeoKeys.has(gKey)) continue;
    seenEdgeGeoKeys.add(gKey);
    const cA = parentFrame.clusters[edge.a];
    const cB = parentFrame.clusters[edge.b];
    const mixed = mixOklabColors(
      [cA, cB]
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );
    contextEdges.push({
      a: pa,
      b: pb,
      mixedColorHex: mixed.hex,
      clusters: [cA, cB],
    });
  }

  if (parentFrame.contextEdges) {
    for (const pce of parentFrame.contextEdges) {
      const pa = transform.apply(pce.a);
      const pb = transform.apply(pce.b);
      if (!bboxOverlapsViewport([pa, pb], vw, vh)) continue;
      const gKey = edgeGeoKey(pa, pb);
      if (seenEdgeGeoKeys.has(gKey)) continue;
      seenEdgeGeoKeys.add(gKey);
      contextEdges.push({
        ...pce,
        a: pa,
        b: pb,
      });
    }
  }

  const contextClusters: ZoomContextCluster<TItem, TTagMeta, TClusterMeta>[] = [];
  const seenClusterUids = new Set<string>();

  for (let vIdx = 0; vIdx < parentFrame.mesh.vertices.length; vIdx++) {
    if (excludedVertexIndices.has(vIdx)) continue;
    const cluster = parentFrame.clusters[vIdx];
    const vert = parentFrame.mesh.vertices[vIdx];
    if (!cluster || !vert) continue;
    const pt = transform.apply(vert);
    if (!pointNearViewport(pt, vw, vh)) continue;
    seenClusterUids.add(cluster.clusterUid);
    contextClusters.push({
      id: `ctx-cl-${parentFrame.frameId}-${cluster.clusterUid}`,
      neighborId: formatScopedNeighborId(parentFrame.frameId, `cluster:${vIdx}`),
      cluster,
      x: pt.x,
      y: pt.y,
    });
  }

  if (parentFrame.contextClusters) {
    for (const pcc of parentFrame.contextClusters) {
      if (seenClusterUids.has(pcc.cluster.clusterUid)) continue;
      const pt = transform.apply({ x: pcc.x, y: pcc.y });
      if (!pointNearViewport(pt, vw, vh)) continue;
      seenClusterUids.add(pcc.cluster.clusterUid);
      contextClusters.push({
        id: `anc-cl-${pcc.cluster.clusterUid}`,
        neighborId: pcc.neighborId,
        cluster: pcc.cluster,
        x: pt.x,
        y: pt.y,
      });
    }
  }

  // Project non-active parent content items (and deeper ancestor context items) into dimmed neighborhood
  const contextItems: ZoomContextItem<TItem, TTagMeta, TClusterMeta>[] = [];
  const seenItemRawIds = new Set<string>(activeItemIds);

  for (const it of parentFrame.items) {
    if (seenItemRawIds.has(it.id)) continue;
    const settled = parentSettledItems?.get(it.id);
    const srcPt = settled
      ? { x: settled.x, y: settled.y }
      : { x: it.anchorX, y: it.anchorY };
    const pt = transform.apply(srcPt);
    if (!pointNearViewport(pt, vw, vh)) continue;

    seenItemRawIds.add(it.id);

    let localTarget = 'frame';
    for (const candTri of nonExcludedParentTris) {
      if (isItemCoveredByVertices(parentFrame, it, candTri.vSet)) {
        localTarget = `tri:${candTri.index}`;
        break;
      }
    }
    if (localTarget === 'frame' && it.unitWeights.length >= 1) {
      let bestClusterIdx: number | null = null;
      let bestWeight = -Infinity;
      for (const uw of it.unitWeights) {
        if (!excludedVertexIndices.has(uw.clusterIndex) && uw.weight > bestWeight) {
          bestWeight = uw.weight;
          bestClusterIdx = uw.clusterIndex;
        }
      }
      if (bestClusterIdx !== null) {
        localTarget = `cluster:${bestClusterIdx}`;
      }
    }
    const neighborId = formatScopedNeighborId(parentFrame.frameId, localTarget);

    const validUnitClusters = it.unitWeights
      .map((uw) => {
        const cluster = parentFrame.clusters[uw.clusterIndex];
        return cluster
          ? {
              cluster,
              weight: uw.weight,
              coverage: uw.coverage,
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    contextItems.push({
      id: `ctx-it-${it.id}`,
      rawId: it.id,
      neighborId,
      item: it.item,
      layoutContext: {
        id: it.id,
        tags: it.tags,
        mixedColorHex: it.mixedColorHex,
        mixedOklab: it.mixedOklab,
        unitClusters: validUnitClusters,
        residualDistance: it.residualDistance,
        featureSummary: it.featureSummary,
      },
      x: pt.x,
      y: pt.y,
      scale: settled ? settled.scale * transform.scale : undefined,
    });
  }

  if (parentFrame.contextItems) {
    for (const pci of parentFrame.contextItems) {
      if (seenItemRawIds.has(pci.rawId)) continue;
      const pt = transform.apply({ x: pci.x, y: pci.y });
      if (!pointNearViewport(pt, vw, vh)) continue;
      seenItemRawIds.add(pci.rawId);
      contextItems.push({
        ...pci,
        id: `ctx-it-${pci.rawId}`,
        neighborId: pci.neighborId,
        x: pt.x,
        y: pt.y,
        scale:
          pci.scale !== undefined ? pci.scale * transform.scale : undefined,
      });
    }
  }

  return { contextTriangles, contextEdges, contextClusters, contextItems };
}

function executeBarycentricTriangleDrill<TItem, TTagMeta, TClusterMeta>(
  ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  options: {
    readonly adaptiveContrastStretch: boolean;
    readonly enableSectorFallback: boolean;
    readonly allowClusterDrill?: boolean;
  },
): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null {
  const { triangleIndex, parentFrame, helpers } = ctx;
  const tri = parentFrame.mesh.triangles[triangleIndex];
  if (!tri) return null;

  const [v0, v1, v2] = tri.vertices;
  const p0 = parentFrame.mesh.vertices[v0]!;
  const p1 = parentFrame.mesh.vertices[v1]!;
  const p2 = parentFrame.mesh.vertices[v2]!;

  const vertSet = new Set<number>([v0, v1, v2]);
  const coveredItems = parentFrame.items.filter((it) =>
    isItemCoveredByVertices(parentFrame, it, vertSet),
  );
  if (coveredItems.length === 0) return null;

  const w0Base = getFrameVertexRootWeights(parentFrame, v0);
  const w1Base = getFrameVertexRootWeights(parentFrame, v1);
  const w2Base = getFrameVertexRootWeights(parentFrame, v2);

  // Extract local barycentric coordinates (λ0, λ1, λ2) inside [v0, v1, v2] for each covered item
  const itemLocalCoords = coveredItems.map((it) => {
    const rw = getItemRootWeights(parentFrame, it);
    const projected = projectRootWeightsOntoTriangleCorners(rw, w0Base, w1Base, w2Base);
    if (projected) {
      return { item: it, rootWeights: rw, ...projected };
    }
    // Direct unitWeights fallback
    let l0 = 0;
    let l1 = 0;
    let l2 = 0;
    for (const uw of it.unitWeights) {
      if (uw.clusterIndex === v0) l0 += uw.weight;
      else if (uw.clusterIndex === v1) l1 += uw.weight;
      else if (uw.clusterIndex === v2) l2 += uw.weight;
    }
    const sum = l0 + l1 + l2 || 1;
    return { item: it, rootWeights: rw, l0: l0 / sum, l1: l1 / sum, l2: l2 / sum };
  });

  // Check if all items sit identically on a single corner/point (zero barycentric variance)
  let minL0 = 1, maxL0 = 0, minL1 = 1, maxL1 = 0, minL2 = 1, maxL2 = 0;
  for (const lc of itemLocalCoords) {
    if (lc.l0 < minL0) minL0 = lc.l0;
    if (lc.l0 > maxL0) maxL0 = lc.l0;
    if (lc.l1 < minL1) minL1 = lc.l1;
    if (lc.l1 > maxL1) maxL1 = lc.l1;
    if (lc.l2 < minL2) minL2 = lc.l2;
    if (lc.l2 > maxL2) maxL2 = lc.l2;
  }
  const spread = Math.max(maxL0 - minL0, maxL1 - minL1, maxL2 - minL2);

  const hasSurroundingContext =
    parentFrame.mesh.triangles.length > 1 ||
    (parentFrame.contextTriangles?.length ?? 0) > 0;
  const focusPadding = computeContextAwarePadding(
    helpers.viewportWidth,
    helpers.viewportHeight,
    helpers.innerPadding,
    hasSurroundingContext,
  );
  const { mesh: subMesh, transform } = buildSubdividedTriangleMeshWithTransform(
    p0,
    p1,
    p2,
    helpers.viewportWidth,
    helpers.viewportHeight,
    focusPadding,
    parentFrame.mesh.orientation,
  );

  const neighbors = evaluateTriangleFrameNeighbors(
    parentFrame,
    triangleIndex,
    subMesh,
  );

  const context = buildNeighborhoodContext({
    parentFrame,
    excludedTriangleIndices: new Set([triangleIndex]),
    excludedVertexIndices: vertSet,
    activeParentEdgeKeys: new Set([
      pairEdgeKey(v0, v1),
      pairEdgeKey(v1, v2),
      pairEdgeKey(v2, v0),
    ]),
    activeItemIds: new Set(coveredItems.map((it) => it.id)),
    parentSettledItems: helpers.parentSettledItems,
    transform,
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    allowClusterDrill: options.allowClusterDrill ?? true,
  });

  const c0 = parentFrame.clusters[v0];
  const c1 = parentFrame.clusters[v1];
  const c2 = parentFrame.clusters[v2];
  const triCodes = [
    c0?.code ?? defaultClusterCode(v0),
    c1?.code ?? defaultClusterCode(v1),
    c2?.code ?? defaultClusterCode(v2),
  ];
  const triCrumb = buildTriangleBreadcrumbInfo([c0, c1, c2], triCodes);
  const triMixed = mixOklabColors(
    [c0, c1, c2]
      .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
        Boolean(c),
      )
      .map((c) => ({ oklab: c.oklab, weight: 1 })),
  );

  // If zero barycentric variance remains and > 1 items are stacked, fan out into sectors
  // while strictly preserving the exact parent triangle orientation [p0, p1, p2]
  if (spread < 0.004 && coveredItems.length > 1 && options.enableSectorFallback) {
    const meanWeights =
      itemLocalCoords[0]?.rootWeights ?? mixRootWeightMaps(w0Base, 1, w1Base, 0);
    return {
      nextFrame: buildSectorPartitionFrame({
        frameId: `sector-${parentFrame.frameId}-t${triangleIndex}`,
        label: triCrumb.label,
        shortLabel: triCrumb.shortLabel,
        accentHex: triMixed.hex,
        breadcrumbSegments: triCrumb.segments,
        parentContextLabel: truncateClean(triCrumb.shortLabel, 20),
        coveredItems,
        baseRootWeights: meanWeights,
        helpers,
        neighbors,
        sourceTrianglePoints: [p0, p1, p2],
        innerPadding: focusPadding,
        meshOrientation: parentFrame.mesh.orientation,
        contextTriangles: context.contextTriangles,
        contextEdges: context.contextEdges,
        contextClusters: context.contextClusters,
        contextItems: context.contextItems,
      }),
    };
  }

  // Adaptive Contrast Stretch: prevents multi-click trap when an outlier sits at 99% of one corner
  let effW0 = w0Base;
  let effW1 = w1Base;
  let effW2 = w2Base;
  let stretchApplied = false;
  let stretchDomIdx = -1;
  let stretchFactor = 1;

  if (options.adaptiveContrastStretch && itemLocalCoords.length >= 2) {
    const cornerMins = [minL0, minL1, minL2];
    const cornerMaxs = [maxL0, maxL1, maxL2];
    for (let d = 0; d < 3; d++) {
      // Every item is >= 64% anchored to corner `d`, with at least one mixed item
      if (cornerMins[d]! >= 0.64 && cornerMins[d]! < 0.996 && cornerMaxs[d]! > 0.9) {
        const maxOff = 1 - cornerMins[d]!;
        if (maxOff > 0.002 && maxOff < 0.36) {
          stretchApplied = true;
          stretchDomIdx = d;
          stretchFactor = Math.min(1, maxOff * 1.25);
          break;
        }
      }
    }
  }

  const transformedCoords = itemLocalCoords.map((lc) => {
    let u0 = lc.l0;
    let u1 = lc.l1;
    let u2 = lc.l2;
    if (stretchApplied) {
      const arr = [lc.l0, lc.l1, lc.l2];
      const d = stretchDomIdx;
      const o1 = (d + 1) % 3;
      const o2 = (d + 2) % 3;
      const res = [0, 0, 0];
      res[o1] = arr[o1]! / stretchFactor;
      res[o2] = arr[o2]! / stretchFactor;
      res[d] = Math.max(0, 1 - res[o1]! - res[o2]!);
      u0 = res[0]!;
      u1 = res[1]!;
      u2 = res[2]!;
    }
    return { ...lc, u0, u1, u2 };
  });

  if (stretchApplied) {
    const bases = [w0Base, w1Base, w2Base];
    const d = stretchDomIdx;
    const o1 = (d + 1) % 3;
    const o2 = (d + 2) % 3;
    const nextBases: ReadonlyMap<number, number>[] = [w0Base, w1Base, w2Base];
    nextBases[o1] = mixRootWeightMaps(bases[d]!, 1 - stretchFactor, bases[o1]!, stretchFactor);
    nextBases[o2] = mixRootWeightMaps(bases[d]!, 1 - stretchFactor, bases[o2]!, stretchFactor);
    effW0 = nextBases[0]!;
    effW1 = nextBases[1]!;
    effW2 = nextBases[2]!;
  }

  // Sub-mesh 1:4 equilateral subdivision mesh is already computed above alongside surrounding context

  // 6 vertex root-weight profiles: [0=V0, 1=V1, 2=V2, 3=M01, 4=M12, 5=M20]
  const vWeights: ReadonlyMap<number, number>[] = [
    effW0,
    effW1,
    effW2,
    mixRootWeightMaps(effW0, 0.5, effW1, 0.5),
    mixRootWeightMaps(effW1, 0.5, effW2, 0.5),
    mixRootWeightMaps(effW2, 0.5, effW0, 0.5),
  ];

  // Assign each item into its exact sub-triangle / sub-edge / vertex among the 6 vertices
  const vertexItemWeights = Array.from(
    { length: 6 },
    () =>
      new Map<
        string,
        {
          readonly item: TItem;
          readonly weight: number;
          readonly coverage: number;
          readonly isExclusive: boolean;
        }
      >(),
  );

  const subItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = transformedCoords.map(
    (entry) => {
      const { u0, u1, u2, item } = entry;
      let rawUnitWeights: ReadonlyArray<{
        readonly clusterIndex: number;
        readonly weight: number;
      }>;

      const eps = 1e-4;
      if (u0 >= 1 - eps) {
        rawUnitWeights = [{ clusterIndex: 0, weight: 1 }];
      } else if (u1 >= 1 - eps) {
        rawUnitWeights = [{ clusterIndex: 1, weight: 1 }];
      } else if (u2 >= 1 - eps) {
        rawUnitWeights = [{ clusterIndex: 2, weight: 1 }];
      } else if (u0 >= 0.5 - eps) {
        // Sub-triangle 0: vertices [0, 3, 5] with exact convex coordinates:
        // mu0 = 2*u0 - 1, mu3 = 2*u1, mu5 = 2*u2
        rawUnitWeights = [
          { clusterIndex: 0, weight: Math.max(0, 2 * u0 - 1) },
          { clusterIndex: 3, weight: 2 * u1 },
          { clusterIndex: 5, weight: 2 * u2 },
        ];
      } else if (u1 >= 0.5 - eps) {
        // Sub-triangle 1: vertices [3, 1, 4]
        rawUnitWeights = [
          { clusterIndex: 3, weight: 2 * u0 },
          { clusterIndex: 1, weight: Math.max(0, 2 * u1 - 1) },
          { clusterIndex: 4, weight: 2 * u2 },
        ];
      } else if (u2 >= 0.5 - eps) {
        // Sub-triangle 2: vertices [5, 4, 2]
        rawUnitWeights = [
          { clusterIndex: 5, weight: 2 * u0 },
          { clusterIndex: 4, weight: 2 * u1 },
          { clusterIndex: 2, weight: Math.max(0, 2 * u2 - 1) },
        ];
      } else {
        // Central triangle 3: vertices [4, 5, 3] with exact barycentric transform:
        // w4 = 1 - 2*u0, w5 = 1 - 2*u1, w3 = 1 - 2*u2
        rawUnitWeights = [
          { clusterIndex: 4, weight: 1 - 2 * u0 },
          { clusterIndex: 5, weight: 1 - 2 * u1 },
          { clusterIndex: 3, weight: 1 - 2 * u2 },
        ];
      }

      const active = rawUnitWeights.filter((uw) => uw.weight > 1e-4);
      const total = active.reduce((acc, uw) => acc + uw.weight, 0) || 1;
      const unitWeights = active.map((uw) => ({
        clusterIndex: uw.clusterIndex,
        weight: uw.weight / total,
        coverage: uw.weight / total,
      }));

      let anchorX = 0;
      let anchorY = 0;
      for (const uw of unitWeights) {
        const vx = subMesh.vertices[uw.clusterIndex]!;
        anchorX += vx.x * uw.weight;
        anchorY += vx.y * uw.weight;
        vertexItemWeights[uw.clusterIndex]!.set(item.id, {
          item: item.item,
          weight: uw.weight,
          coverage: uw.coverage,
          isExclusive: unitWeights.length === 1,
        });
      }

      return {
        ...item,
        anchorX,
        anchorY,
        unitWeights,
      };
    },
  );

  // Build 6 ClusterDescriptors (inheriting root corner descriptors for 0..2 when unstretched,
  // or cleanly interpolated OKLab colors & labels for stretched/midpoint vertices 3..5)
  const cornersRef = [c0, c1, c2];
  const subClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = vWeights.map(
    (vw, vIdx) => {
      const vert = subMesh.vertices[vIdx]!;
      const mixedColor = mixOklabColors(
        [...vw.entries()].map(([rIdx, rw]) => ({
          oklab: helpers.rootClusters[rIdx]!.oklab,
          weight: rw,
        })),
      );
      const memberEntries = [...vertexItemWeights[vIdx]!.entries()].map(
        ([itemId, rec]) => ({
          item: rec.item,
          itemId,
          coverage: rec.coverage,
          normalizedWeight: rec.weight,
          isExclusiveVertexMember: rec.isExclusive,
        }),
      );

      // Pure unstretched parent corner retains parent code/tags and role directly
      const parentCorner = vIdx < 3 ? cornersRef[vIdx] : undefined;
      const isUnstretchedCorner = vIdx < 3 && (!stretchApplied || vIdx === stretchDomIdx);
      if (parentCorner && isUnstretchedCorner) {
        return buildSynthesizedClusterDescriptor({
          clusterIndex: vIdx,
          clusterUid: helpers.allocateClusterUid(),
          code: parentCorner.code,
          defaultLabel: parentCorner.defaultLabel,
          oklab: parentCorner.oklab,
          hex: parentCorner.colorHex,
          vertex: vert,
          coreTags: parentCorner.coreTags,
          sharedTags: parentCorner.sharedTags,
          members: memberEntries,
          featureSummary: parentCorner.featureSummary,
          role: parentCorner.role ?? 'primary',
          mixWeights: parentCorner.mixWeights,
          subclusterLabel: parentCorner.subclusterLabel,
          parentContextLabel: parentCorner.parentContextLabel,
          preservePrimaryTitle:
            (parentCorner.role ?? 'primary') === 'primary'
              ? resolveReadableClusterName(parentCorner, 32)
              : undefined,
          deriveClusterMeta: helpers.deriveClusterMeta,
        });
      }

      const midpointEdgePairs: ReadonlyArray<
        readonly [
          ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
          ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
        ]
      > = [
        [c0, c1],
        [c1, c2],
        [c2, c0],
      ];
      const immediatePair =
        vIdx >= 3 && !stretchApplied ? midpointEdgePairs[vIdx - 3] : undefined;
      const bridgeLabel = formatCompactBridgeLabel(
        vw,
        helpers.rootClusters,
        immediatePair,
      );
      const fmt = formatMixLabel(vw, helpers.rootClusters);
      const mixWeights = buildMixWeights(vw, helpers.rootClusters);
      return buildSynthesizedClusterDescriptor({
        clusterIndex: vIdx,
        clusterUid: helpers.allocateClusterUid(),
        code: fmt.code,
        defaultLabel: fmt.label,
        oklab: mixedColor.oklab,
        hex: mixedColor.hex,
        vertex: vert,
        coreTags: [],
        sharedTags: [],
        members: memberEntries,
        featureSummary: `Sub-simplex blend (${bridgeLabel})`,
        role: 'intermediate',
        mixWeights,
        subclusterLabel: bridgeLabel,
        parentContextLabel: parentCorner
          ? deriveCornerParentContextLabel(parentCorner)
          : undefined,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    },
  );

  const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
  for (const lc of itemLocalCoords) {
    itemRootMap.set(lc.item.id, lc.rootWeights);
  }

  return {
    nextFrame: {
      frameId: `tri-${parentFrame.frameId}-t${triangleIndex}`,
      kind: 'triangle',
      label: triCrumb.label,
      shortLabel: triCrumb.shortLabel,
      accentHex: triMixed.hex,
      breadcrumbSegments: triCrumb.segments,
      mesh: subMesh,
      clusters: subClusters,
      items: subItems,
      neighbors,
      parentToFrameTransform: {
        scale: transform.scale,
        sourceCx: transform.sourceCx,
        sourceCy: transform.sourceCy,
        targetCx: transform.targetCx,
        targetCy: transform.targetCy,
      },
      contextTriangles: context.contextTriangles,
      contextEdges: context.contextEdges,
      contextClusters: context.contextClusters,
      contextItems: context.contextItems,
      strategyData: {
        kind: 'triangle',
        parentTriIndex: triangleIndex,
        vertexWeights: vWeights.map((rw) => ({ rootWeights: rw })),
        itemRootWeights: itemRootMap,
      } satisfies InternalFrameMeta,
    },
  };
}

// ============================================================================
// Single-Triangle Leaf Focus Builder (Un-Subdivided 1-Triangle Focus)
// ============================================================================

function executeSingleTriangleFocusDrill<TItem, TTagMeta, TClusterMeta>(
  ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  allowClusterDrill = true,
): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null {
  if (ctx.parentDepth > MAX_ZOOM_DRILL_DEPTH) return null;
  const { triangleIndex, parentFrame, helpers } = ctx;
  if (
    parentFrame.mesh.triangles.length <= 1 ||
    parentFrame.kind === 'triangle-focus' ||
    parentFrame.kind === 'cluster-spotlight'
  ) {
    return null;
  }
  const tri = parentFrame.mesh.triangles[triangleIndex];
  if (!tri) return null;

  const [v0, v1, v2] = tri.vertices;
  const oldToNew = new Map<number, number>([
    [v0, 0],
    [v1, 1],
    [v2, 2],
  ]);
  const vSet = new Set<number>([v0, v1, v2]);
  const coveredItems = parentFrame.items.filter((it) =>
    isItemCoveredByVertices(parentFrame, it, vSet),
  );

  const c0 = parentFrame.clusters[v0];
  const c1 = parentFrame.clusters[v1];
  const c2 = parentFrame.clusters[v2];
  const p0 = parentFrame.mesh.vertices[v0]!;
  const p1 = parentFrame.mesh.vertices[v1]!;
  const p2 = parentFrame.mesh.vertices[v2]!;

  const focusPadding = computeContextAwarePadding(
    helpers.viewportWidth,
    helpers.viewportHeight,
    helpers.innerPadding,
    true,
  );
  const { mesh: focusMesh, transform } =
    buildOrientedSingleTriangleMeshWithTransform({
      viewportWidth: helpers.viewportWidth,
      viewportHeight: helpers.viewportHeight,
      innerPadding: focusPadding,
      sourceTrianglePoints: [p0, p1, p2],
      orientation: parentFrame.mesh.orientation,
    });

  const neighbors = evaluateTriangleFrameNeighbors(
    parentFrame,
    triangleIndex,
    focusMesh,
  );
  const context = buildNeighborhoodContext({
    parentFrame,
    excludedTriangleIndices: new Set([triangleIndex]),
    excludedVertexIndices: vSet,
    activeParentEdgeKeys: new Set([
      pairEdgeKey(v0, v1),
      pairEdgeKey(v1, v2),
      pairEdgeKey(v2, v0),
    ]),
    activeItemIds: new Set(coveredItems.map((it) => it.id)),
    parentSettledItems: helpers.parentSettledItems,
    transform,
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    allowClusterDrill,
  });

  const focusItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map(
    (it) => {
      const unitWeights = it.unitWeights.map((uw) => ({
        clusterIndex: oldToNew.get(uw.clusterIndex) ?? 0,
        weight: uw.weight,
        coverage: uw.coverage,
      }));
      let anchorX = 0;
      let anchorY = 0;
      for (const uw of unitWeights) {
        const v = focusMesh.vertices[uw.clusterIndex]!;
        anchorX += v.x * uw.weight;
        anchorY += v.y * uw.weight;
      }
      return {
        ...it,
        anchorX,
        anchorY,
        unitWeights,
      };
    },
  );

  const oldVertices = [v0, v1, v2];
  const focusClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] =
    oldVertices.map((oldIdx, newIdx) => {
      const origCluster = parentFrame.clusters[oldIdx]!;
      const vert = focusMesh.vertices[newIdx]!;
      const memberEntries: Array<
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta>['members'][number]
      > = [];
      for (const fItem of focusItems) {
        const uw = fItem.unitWeights.find((u) => u.clusterIndex === newIdx);
        if (!uw) continue;
        memberEntries.push({
          item: fItem.item,
          itemId: fItem.id,
          coverage: uw.coverage,
          normalizedWeight: uw.weight,
          isExclusiveVertexMember: fItem.unitWeights.length === 1,
        });
      }
      return buildSynthesizedClusterDescriptor({
        clusterIndex: newIdx,
        clusterUid: helpers.allocateClusterUid(),
        code: origCluster.code,
        defaultLabel: origCluster.defaultLabel,
        oklab: origCluster.oklab,
        hex: origCluster.colorHex,
        vertex: vert,
        coreTags: origCluster.coreTags,
        sharedTags: origCluster.sharedTags,
        members: memberEntries,
        featureSummary: origCluster.featureSummary,
        role: origCluster.role ?? 'primary',
        mixWeights: origCluster.mixWeights,
        subclusterLabel: origCluster.subclusterLabel,
        parentContextLabel: origCluster.parentContextLabel,
        preservePrimaryTitle:
          (origCluster.role ?? 'primary') === 'primary'
            ? resolveReadableClusterName(origCluster, 32)
            : undefined,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    });

  const triCodes = [
    c0?.code ?? defaultClusterCode(v0),
    c1?.code ?? defaultClusterCode(v1),
    c2?.code ?? defaultClusterCode(v2),
  ];
  const triCrumb = buildTriangleBreadcrumbInfo([c0, c1, c2], triCodes);
  const triMixed = mixOklabColors(
    [c0, c1, c2]
      .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
        Boolean(c),
      )
      .map((c) => ({ oklab: c.oklab, weight: 1 })),
  );

  const vWeights = oldVertices.map((oldIdx) => ({
    rootWeights: getFrameVertexRootWeights(parentFrame, oldIdx),
  }));
  const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
  for (const it of coveredItems) {
    itemRootMap.set(it.id, getItemRootWeights(parentFrame, it));
  }

  return {
    nextFrame: {
      frameId: `tri-focus-${parentFrame.frameId}-t${triangleIndex}`,
      kind: 'triangle-focus',
      label: triCrumb.label,
      shortLabel: triCrumb.shortLabel,
      accentHex: triMixed.hex,
      breadcrumbSegments: triCrumb.segments,
      mesh: focusMesh,
      clusters: focusClusters,
      items: focusItems,
      neighbors,
      parentToFrameTransform: {
        scale: transform.scale,
        sourceCx: transform.sourceCx,
        sourceCy: transform.sourceCy,
        targetCx: transform.targetCx,
        targetCy: transform.targetCy,
      },
      contextTriangles: context.contextTriangles,
      contextEdges: context.contextEdges,
      contextClusters: context.contextClusters,
      contextItems: context.contextItems,
      cornerClusterNeighborIds: allowClusterDrill
        ? oldVertices.map((oldIdx) => `@${parentFrame.frameId}/cluster:${oldIdx}`)
        : undefined,
      strategyData: {
        kind: 'triangle-focus',
        parentTriIndex: triangleIndex,
        vertexWeights: vWeights,
        itemRootWeights: itemRootMap,
      } satisfies InternalFrameMeta,
    },
  };
}

// ============================================================================
// Cluster 1-Ring Star Drill-Down Builder
// ============================================================================

function executeClusterStarDrill<TItem, TTagMeta, TClusterMeta>(
  ctx: ZoomClusterDrillContext<TItem, TTagMeta, TClusterMeta>,
  allowClusterDrill = true,
): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null {
  const { clusterIndex, parentFrame, helpers } = ctx;
  const incidentTris = parentFrame.mesh.triangles.filter((t) =>
    t.vertices.includes(clusterIndex),
  );
  const hasSurroundingContext =
    parentFrame.mesh.triangles.length > incidentTris.length ||
    (parentFrame.contextTriangles?.length ?? 0) > 0;
  const focusPadding = computeContextAwarePadding(
    helpers.viewportWidth,
    helpers.viewportHeight,
    helpers.innerPadding,
    hasSurroundingContext,
  );
  const star = buildIncidentStarMesh(
    parentFrame.mesh,
    clusterIndex,
    helpers.viewportWidth,
    helpers.viewportHeight,
    focusPadding,
  );
  if (!star) return null;

  const oldVertexSet = new Set(star.newToOldVertex);
  const coveredItems = parentFrame.items.filter((it) =>
    isItemCoveredByVertices(parentFrame, it, oldVertexSet),
  );

  const excludedTriangleIndices = new Set(incidentTris.map((t) => t.index));
  const activeParentEdgeKeys = new Set(
    star.mesh.edges.map((e) =>
      pairEdgeKey(star.newToOldVertex[e.a]!, star.newToOldVertex[e.b]!),
    ),
  );
  const context = buildNeighborhoodContext({
    parentFrame,
    excludedTriangleIndices,
    excludedVertexIndices: oldVertexSet,
    activeParentEdgeKeys,
    activeItemIds: new Set(coveredItems.map((it) => it.id)),
    parentSettledItems: helpers.parentSettledItems,
    transform: star.transform,
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    allowClusterDrill,
  });

  const starItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map((it) => {
    const unitWeights = it.unitWeights.map((uw) => ({
      clusterIndex: star.oldToNewVertex.get(uw.clusterIndex) ?? 0,
      weight: uw.weight,
      coverage: uw.coverage,
    }));
    let anchorX = 0;
    let anchorY = 0;
    for (const uw of unitWeights) {
      const v = star.mesh.vertices[uw.clusterIndex]!;
      anchorX += v.x * uw.weight;
      anchorY += v.y * uw.weight;
    }
    return {
      ...it,
      anchorX,
      anchorY,
      unitWeights,
    };
  });

  const starClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] =
    star.newToOldVertex.map((oldIdx, newIdx) => {
      const origCluster = parentFrame.clusters[oldIdx]!;
      const vert = star.mesh.vertices[newIdx]!;
      const memberEntries: Array<
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta>['members'][number]
      > = [];
      for (const stItem of starItems) {
        const uw = stItem.unitWeights.find((u) => u.clusterIndex === newIdx);
        if (!uw) continue;
        memberEntries.push({
          item: stItem.item,
          itemId: stItem.id,
          coverage: uw.coverage,
          normalizedWeight: uw.weight,
          isExclusiveVertexMember: stItem.unitWeights.length === 1,
        });
      }
      return buildSynthesizedClusterDescriptor({
        clusterIndex: newIdx,
        clusterUid: helpers.allocateClusterUid(),
        code: origCluster.code,
        defaultLabel: origCluster.defaultLabel,
        oklab: origCluster.oklab,
        hex: origCluster.colorHex,
        vertex: vert,
        coreTags: origCluster.coreTags,
        sharedTags: origCluster.sharedTags,
        members: memberEntries,
        featureSummary: origCluster.featureSummary,
        role: origCluster.role ?? 'primary',
        mixWeights: origCluster.mixWeights,
        subclusterLabel: origCluster.subclusterLabel,
        parentContextLabel: origCluster.parentContextLabel,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    });

  // Adjacent drillable clusters in parent mesh become lateral panning targets
  const centerVert = star.mesh.vertices[0]!;
  const neighbors: ZoomNeighborTarget[] = [];
  for (let newIdx = 1; newIdx < star.newToOldVertex.length; newIdx++) {
    const oldIdx = star.newToOldVertex[newIdx]!;
    const adjCluster = parentFrame.clusters[oldIdx];
    const adjVert = star.mesh.vertices[newIdx]!;
    if (!adjCluster) continue;
    const dx = adjVert.x - centerVert.x;
    const dy = adjVert.y - centerVert.y;
    const len = Math.hypot(dx, dy) || 1;
    const adjName = resolveReadableClusterName(adjCluster, 16);
    neighbors.push({
      id: `cluster:${oldIdx}`,
      targetKind: 'cluster',
      label: `${adjCluster.code} · ${adjName}`,
      shortLabel: adjName,
      itemCount: adjCluster.members.length,
      anchorPoint: { x: adjVert.x, y: adjVert.y },
      normal: { x: dx / len, y: dy / len },
      accentHex: adjCluster.colorHex,
    });
  }

  const centerOrig = parentFrame.clusters[clusterIndex]!;
  const starCrumb = buildClusterBreadcrumbInfo(centerOrig);
  const vWeights = star.newToOldVertex.map((oldIdx) => ({
    rootWeights: getFrameVertexRootWeights(parentFrame, oldIdx),
  }));
  const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
  for (const it of coveredItems) {
    itemRootMap.set(it.id, getItemRootWeights(parentFrame, it));
  }

  return {
    nextFrame: {
      frameId: `star-${parentFrame.frameId}-c${clusterIndex}`,
      kind: 'cluster-star',
      label: starCrumb.label,
      shortLabel: starCrumb.shortLabel,
      accentHex: centerOrig.colorHex,
      breadcrumbSegments: starCrumb.segments,
      mesh: star.mesh,
      clusters: starClusters,
      items: starItems,
      neighbors,
      parentToFrameTransform: {
        scale: star.transform.scale,
        sourceCx: star.transform.sourceCx,
        sourceCy: star.transform.sourceCy,
        targetCx: star.transform.targetCx,
        targetCy: star.transform.targetCy,
      },
      contextTriangles: context.contextTriangles,
      contextEdges: context.contextEdges,
      contextClusters: context.contextClusters,
      contextItems: context.contextItems,
      strategyData: {
        kind: 'cluster-star',
        parentClusterIndex: clusterIndex,
        vertexWeights: vWeights,
        itemRootWeights: itemRootMap,
      } satisfies InternalFrameMeta,
    },
  };
}

// ============================================================================
// Strategy 1: Barycentric Zoom Strategy (Default for Demo)
// ============================================================================

/**
 * Discrete geometric `1:4` triangle drill-down strategy with:
 * - Adaptive contrast stretch (prevents 99%-corner multi-step traps)
 * - Incident 1-ring cluster star zoom when clicking a topic cluster
 * - Leaf stop as soon as all covered items fit at full `1.0x` scale
 * - Smooth lateral neighbor triangle/cluster stepping & pinch-in drill-up
 */
export function createBarycentricZoomStrategy<
  TItem = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  options?: BarycentricZoomStrategyOptions,
): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
  const clusterZoomMode = options?.clusterZoomMode ?? 'incident-star';
  const adaptiveContrastStretch = options?.adaptiveContrastStretch ?? true;
  const enableSectorFallback = options?.enableSectorFallback ?? true;
  const stopWhenFullScale = options?.stopWhenFullScale ?? true;
  const fullScaleThreshold = options?.fullScaleThreshold ?? DEFAULT_FULL_SCALE_THRESHOLD;
  const leafTriangleFocus = options?.leafTriangleFocus ?? true;
  const allowClusterDrill = clusterZoomMode !== 'none';

  const barycentricDrillIntoTriangle = (
    ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null => {
    const { triangleIndex, parentFrame, itemScaleRatios } = ctx;
    const tri = parentFrame.mesh.triangles[triangleIndex];
    if (!tri) return null;

    if (ctx.parentDepth >= MAX_ZOOM_DRILL_DEPTH) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    const vSet = new Set(tri.vertices);
    const triItems = parentFrame.items.filter((it) =>
      isItemCoveredByVertices(parentFrame, it, vSet),
    );
    if (triItems.length === 0) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    if (stopWhenFullScale) {
      const stats = computeFullScaleStats(
        triItems.map((it) => it.id),
        itemScaleRatios,
        fullScaleThreshold,
      );
      if (!stats.hasUnderScaled) {
        return leafTriangleFocus
          ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
          : null;
      }
    }

    return executeBarycentricTriangleDrill(ctx, {
      adaptiveContrastStretch,
      enableSectorFallback,
      allowClusterDrill,
    });
  };

  const barycentricDrillIntoCluster = (
    ctx: ZoomClusterDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null => {
    if (clusterZoomMode === 'none') {
      return null;
    }
    if (
      clusterZoomMode === 'spotlight' &&
      ctx.parentDepth >= MAX_ZOOM_DRILL_DEPTH
    ) {
      return null;
    }
    if (ctx.parentDepth > MAX_ZOOM_DRILL_DEPTH) {
      return null;
    }
    const { clusterIndex, parentFrame, itemScaleRatios, helpers } = ctx;
    const meta = parentFrame.strategyData as InternalFrameMeta | undefined;
    if (meta?.kind === 'cluster-spotlight') return null;

    const cluster = parentFrame.clusters[clusterIndex];
    if (!cluster) return null;

    const incTris = parentFrame.mesh.triangles.filter((t) =>
      t.vertices.includes(clusterIndex),
    );

    if (clusterZoomMode === 'incident-star') {
      if (incTris.length === 0) return null;
      if (meta?.kind === 'cluster-star' && clusterIndex === 0) {
        return null;
      }
      return executeClusterStarDrill(ctx, true);
    }

    // Direct 3-sector spotlight mode (only when clusterZoomMode === 'spotlight')
    const directItems = parentFrame.items.filter((it) =>
      it.unitWeights.some(
        (uw) => uw.clusterIndex === clusterIndex && uw.weight >= 0.45,
      ),
    );
    if (directItems.length <= 1) return null;
    if (stopWhenFullScale) {
      const stats = computeFullScaleStats(
        directItems.map((it) => it.id),
        itemScaleRatios,
        fullScaleThreshold,
      );
      if (!stats.hasUnderScaled) return null;
    }

    const targetVert = parentFrame.mesh.vertices[clusterIndex];
    const clusterIncTris = parentFrame.mesh.triangles.filter((t) =>
      t.vertices.includes(clusterIndex),
    );
    const sourceSpan = Math.max(40, parentFrame.mesh.sideLength * 0.58);
    let sourceTrianglePoints:
      | readonly [Point2D, Point2D, Point2D]
      | undefined;
    if (clusterIncTris.length === 1 && targetVert) {
      const [va, vb, vc] = clusterIncTris[0]!.vertices;
      const qa = parentFrame.mesh.vertices[va]!;
      const qb = parentFrame.mesh.vertices[vb]!;
      const qc = parentFrame.mesh.vertices[vc]!;
      const qLen = Math.max(1, Math.hypot(qb.x - qa.x, qb.y - qa.y));
      const ratio = sourceSpan / qLen;
      const qCx = (qa.x + qb.x + qc.x) / 3;
      const qCy = (qa.y + qb.y + qc.y) / 3;
      sourceTrianglePoints = [
        { x: targetVert.x + (qa.x - qCx) * ratio, y: targetVert.y + (qa.y - qCy) * ratio },
        { x: targetVert.x + (qb.x - qCx) * ratio, y: targetVert.y + (qb.y - qCy) * ratio },
        { x: targetVert.x + (qc.x - qCx) * ratio, y: targetVert.y + (qc.y - qCy) * ratio },
      ];
    }
    const hasSurroundingContext =
      parentFrame.mesh.triangles.length > 1 ||
      (parentFrame.contextTriangles?.length ?? 0) > 0;
    const focusPadding = computeContextAwarePadding(
      helpers.viewportWidth,
      helpers.viewportHeight,
      helpers.innerPadding,
      hasSurroundingContext,
    );
    const { transform: spotTransform } = buildOrientedSingleTriangleMeshWithTransform({
      viewportWidth: helpers.viewportWidth,
      viewportHeight: helpers.viewportHeight,
      innerPadding: focusPadding,
      sourceTrianglePoints,
      orientation: parentFrame.mesh.orientation,
      sourceCenter: targetVert ? { x: targetVert.x, y: targetVert.y } : undefined,
      sourceSpan,
    });
    const spotContext = buildNeighborhoodContext({
      parentFrame,
      excludedTriangleIndices: new Set<number>(),
      excludedVertexIndices: new Set<number>([clusterIndex]),
      activeParentEdgeKeys: new Set<string>(),
      activeItemIds: new Set(directItems.map((it) => it.id)),
      parentSettledItems: helpers.parentSettledItems,
      transform: spotTransform,
      viewportWidth: helpers.viewportWidth,
      viewportHeight: helpers.viewportHeight,
      allowClusterDrill: true,
    });
    const spotCrumb = buildClusterBreadcrumbInfo(cluster);
    return {
      nextFrame: buildSectorPartitionFrame({
        frameId: `spotlight-${parentFrame.frameId}-c${clusterIndex}`,
        label: spotCrumb.label,
        shortLabel: spotCrumb.shortLabel,
        accentHex: cluster.colorHex,
        breadcrumbSegments: spotCrumb.segments,
        parentContextLabel: deriveCornerParentContextLabel(cluster),
        coveredItems: directItems,
        baseRootWeights: getFrameVertexRootWeights(parentFrame, clusterIndex),
        helpers,
        neighbors: [],
        sourceTrianglePoints,
        innerPadding: focusPadding,
        meshOrientation: parentFrame.mesh.orientation,
        sourceCenter: targetVert
          ? { x: targetVert.x, y: targetVert.y }
          : undefined,
        sourceSpan,
        contextTriangles: spotContext.contextTriangles,
        contextEdges: spotContext.contextEdges,
        contextClusters: spotContext.contextClusters,
        contextItems: spotContext.contextItems,
      }),
    };
  };

  return {
    name: `barycentric-${clusterZoomMode}`,
    mode: 'drill-down',

    evaluateTargets(ctx) {
      const { frame, itemScaleRatios } = ctx;
      const frameItemIds = frame.items.map((it) => it.id);
      const globalStats = computeFullScaleStats(
        frameItemIds,
        itemScaleRatios,
        fullScaleThreshold,
      );

      const trianglesStopped =
        ctx.depth >= MAX_ZOOM_DRILL_DEPTH ||
        frame.kind === 'triangle-focus' ||
        (stopWhenFullScale && !globalStats.hasUnderScaled);

      const drillableTriangleIndices: number[] = [];
      if (!trianglesStopped) {
        for (const tri of frame.mesh.triangles) {
          const vSet = new Set(tri.vertices);
          const triItems = frame.items.filter((it) =>
            isItemCoveredByVertices(frame, it, vSet),
          );
          if (triItems.length === 0) continue;
          const triStats = computeFullScaleStats(
            triItems.map((it) => it.id),
            itemScaleRatios,
            fullScaleThreshold,
          );
          if (!stopWhenFullScale || triStats.hasUnderScaled) {
            drillableTriangleIndices.push(tri.index);
          }
        }
      }

      const focusableTriangleIndices: number[] = [];
      if (
        leafTriangleFocus &&
        ctx.depth <= MAX_ZOOM_DRILL_DEPTH &&
        frame.mesh.triangles.length > 1 &&
        frame.kind !== 'triangle-focus' &&
        frame.kind !== 'cluster-spotlight'
      ) {
        const drillableSet = new Set(drillableTriangleIndices);
        for (const tri of frame.mesh.triangles) {
          if (!drillableSet.has(tri.index)) {
            focusableTriangleIndices.push(tri.index);
          }
        }
      }

      const drillableClusterUids: string[] = [];
      if (clusterZoomMode !== 'none') {
        const meta = frame.strategyData as InternalFrameMeta | undefined;
        frame.clusters.forEach((cluster, cIdx) => {
          if (meta?.kind === 'cluster-spotlight') return;

          if (clusterZoomMode === 'spotlight') {
            if (trianglesStopped) return;
            const directItems = frame.items.filter((it) =>
              it.unitWeights.some(
                (uw) => uw.clusterIndex === cIdx && uw.weight >= 0.45,
              ),
            );
            if (directItems.length <= 1) return;
            const directStats = computeFullScaleStats(
              directItems.map((it) => it.id),
              itemScaleRatios,
              fullScaleThreshold,
            );
            if (!stopWhenFullScale || directStats.hasUnderScaled) {
              drillableClusterUids.push(cluster.clusterUid);
            }
            return;
          }

          // 'incident-star' mode: every cluster & subcluster with >= 1 incident triangle is uniformly focusable
          if (ctx.depth > MAX_ZOOM_DRILL_DEPTH) return;
          if (meta?.kind === 'cluster-star' && cIdx === 0) return;
          const incTris = frame.mesh.triangles.filter((t) =>
            t.vertices.includes(cIdx),
          );
          if (incTris.length > 0) {
            drillableClusterUids.push(cluster.clusterUid);
          }
        });
      }

      return {
        drillableTriangleIndices,
        focusableTriangleIndices,
        drillableClusterUids,
        isLeafReached:
          clusterZoomMode === 'spotlight'
            ? drillableTriangleIndices.length === 0 &&
              drillableClusterUids.length === 0
            : drillableTriangleIndices.length === 0,
        fullScaleItemRatio: globalStats.ratio,
      };
    },

    drillIntoTriangle: barycentricDrillIntoTriangle,

    drillIntoCluster: barycentricDrillIntoCluster,

    drillToNeighbor(ctx) {
      const { localTarget } = parseScopedNeighborId(ctx.neighborId);
      const { parentFrame, itemScaleRatios, helpers } = ctx;
      if (localTarget.startsWith('tri:')) {
        const triIdx = parseInt(localTarget.slice(4), 10);
        if (!Number.isFinite(triIdx)) return null;
        const outcome = barycentricDrillIntoTriangle({
          triangleIndex: triIdx,
          parentFrame,
          parentDepth: ctx.currentDepth - 1,
          itemScaleRatios,
          helpers,
        });
        return outcome ? { ...outcome, replaceTop: true } : null;
      }
      if (localTarget.startsWith('cluster:')) {
        const cIdx = parseInt(localTarget.slice(8), 10);
        if (!Number.isFinite(cIdx)) return null;
        const targetCluster = parentFrame.clusters[cIdx];
        if (!targetCluster) return null;
        const outcome = barycentricDrillIntoCluster({
          clusterUid: targetCluster.clusterUid,
          clusterIndex: cIdx,
          parentFrame,
          parentDepth: ctx.currentDepth - 1,
          itemScaleRatios,
          helpers,
        });
        return outcome ? { ...outcome, replaceTop: true } : null;
      }
      return null;
    },
  };
}

// ============================================================================
// Strategy 2: Semantic Sub-Clustering Zoom Strategy (Adaptive 6-Vertex Tag Partition)
// ============================================================================

const SUB_MESH_VERTEX_BARY: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
];

interface SemanticItemProfile<TItem, TTagMeta> {
  readonly item: ZoomItemAnchorInput<TItem, TTagMeta>;
  readonly discTags: readonly string[];
  readonly discTagSet: ReadonlySet<string>;
  readonly sig: string;
  readonly l0: number;
  readonly l1: number;
  readonly l2: number;
  readonly rootWeights: ReadonlyMap<number, number>;
}

interface EvaluatedSemanticPartition<TItem, TTagMeta> {
  readonly vertexTags: readonly (readonly string[])[];
  readonly baseOnlyVertex: number;
  readonly repartitioned: boolean;
  readonly faceCounts: readonly [number, number, number, number];
  readonly maxFaceCount: number;
  readonly activeFaceCount: number;
  readonly objective: number;
  readonly assignments: ReadonlyArray<{
    readonly faceIndex: number;
    readonly unitWeights: ReadonlyArray<{
      readonly clusterIndex: number;
      readonly weight: number;
      readonly coverage: number;
    }>;
  }>;
  readonly profiles: readonly SemanticItemProfile<TItem, TTagMeta>[];
}

function evaluateSemanticSixVertexPartition<TItem, TTagMeta>(params: {
  readonly profiles: readonly SemanticItemProfile<TItem, TTagMeta>[];
  readonly vertexTags: readonly (readonly string[])[];
  readonly baseOnlyVertex: number;
  readonly repartitioned: boolean;
  readonly tagWeights: ReadonlyMap<string, number>;
  readonly subTris: SimplexMesh['triangles'];
}): EvaluatedSemanticPartition<TItem, TTagMeta> {
  const {
    profiles,
    vertexTags,
    baseOnlyVertex,
    repartitioned,
    tagWeights,
    subTris,
  } = params;

  const vertexTagSets = vertexTags.map((ts) => new Set(ts));
  const vertexNorms = vertexTags.map((ts) => {
    let sum = 0;
    for (const t of ts) sum += tagWeights.get(t) ?? 1;
    return Math.sqrt(Math.max(0.35, sum));
  });

  const faceUnionSets = subTris.map((st) => {
    const s = new Set<string>();
    for (const vi of st.vertices) {
      for (const t of vertexTags[vi] ?? []) s.add(t);
    }
    return s;
  });

  const faceCounts: [number, number, number, number] = [0, 0, 0, 0];
  const assignments = profiles.map((prof) => {
    let itemWeightSum = 0;
    for (const t of prof.discTags) itemWeightSum += tagWeights.get(t) ?? 1;
    const itemNorm = Math.sqrt(Math.max(0.35, itemWeightSum));

    // Symmetric specificity-weighted cosine affinity across all 6 vertices + gentle parent spatial tie-breaker
    const vScores: number[] = [];
    for (let vIdx = 0; vIdx < 6; vIdx++) {
      const vb = SUB_MESH_VERTEX_BARY[vIdx]!;
      const spatialPrior =
        1 -
        0.5 *
          (Math.abs(prof.l0 - vb[0]) +
            Math.abs(prof.l1 - vb[1]) +
            Math.abs(prof.l2 - vb[2]));

      let semanticAff: number;
      if (prof.discTags.length === 0) {
        // Items with only ubiquitous triangle tags gravitate cleanly to the designated base-only vertex
        semanticAff = vIdx === baseOnlyVertex ? 0.92 : 0.04;
      } else {
        const vSet = vertexTagSets[vIdx]!;
        let hitW = 0;
        for (const t of prof.discTags) {
          if (vSet.has(t)) hitW += tagWeights.get(t) ?? 1;
        }
        semanticAff = hitW > 0 ? hitW / (itemNorm * vertexNorms[vIdx]!) : 0;
      }

      vScores.push(Math.max(0.015, semanticAff + 0.055 * Math.max(0, spatialPrior)));
    }

    // Score each of the 4 congruent sub-triangles symmetrically (zero central-triangle bias)
    let bestFaceIdx = 0;
    let bestFaceScore = -Infinity;
    for (let fIdx = 0; fIdx < subTris.length; fIdx++) {
      const [va, vb, vc] = subTris[fIdx]!.vertices;
      let unionCov = 0;
      if (prof.discTags.length === 0) {
        unionCov =
          va === baseOnlyVertex || vb === baseOnlyVertex || vc === baseOnlyVertex
            ? 1
            : 0;
      } else if (itemWeightSum > 0) {
        const uSet = faceUnionSets[fIdx]!;
        let covW = 0;
        for (const t of prof.discTags) {
          if (uSet.has(t)) covW += tagWeights.get(t) ?? 1;
        }
        unionCov = covW / itemWeightSum;
      }

      const vertexMean = (vScores[va]! + vScores[vb]! + vScores[vc]!) / 3;
      const faceScore = 0.62 * unionCov + 0.38 * vertexMean;
      if (faceScore > bestFaceScore) {
        bestFaceScore = faceScore;
        bestFaceIdx = fIdx;
      }
    }

    faceCounts[bestFaceIdx] = (faceCounts[bestFaceIdx] ?? 0) + 1;
    const chosenVerts = subTris[bestFaceIdx]!.vertices;

    // Explaining-away contrast inside the chosen sub-triangle so exclusive vertex tags pull crisply
    const rawW = chosenVerts.map((vi, localPos) => {
      const otherA = vertexTagSets[chosenVerts[(localPos + 1) % 3]!]!;
      const otherB = vertexTagSets[chosenVerts[(localPos + 2) % 3]!]!;
      let exclusiveBonus = 0;
      for (const t of prof.discTags) {
        if (vertexTagSets[vi]!.has(t) && !otherA.has(t) && !otherB.has(t)) {
          exclusiveBonus += (tagWeights.get(t) ?? 1) * 0.45;
        }
      }
      return {
        clusterIndex: vi,
        weight: vScores[vi]! + exclusiveBonus,
      };
    });

    const sumW = rawW.reduce((acc, x) => acc + x.weight, 0) || 1;
    const unitWeights = rawW.map((x) => ({
      clusterIndex: x.clusterIndex,
      weight: x.weight / sumW,
      coverage: x.weight / sumW,
    }));

    return { faceIndex: bestFaceIdx, unitWeights };
  });

  const n = profiles.length || 1;
  const ideal = n / 4;
  let sqImbalance = 0;
  let maxFaceCount = 0;
  let activeFaceCount = 0;
  for (let f = 0; f < 4; f++) {
    const c = faceCounts[f]!;
    if (c > maxFaceCount) maxFaceCount = c;
    if (c > 0) activeFaceCount += 1;
    const diff = c - ideal;
    sqImbalance += diff * diff;
  }

  let emptyVertexPenalty = 0;
  for (let v = 0; v < 6; v++) {
    if ((vertexTags[v]?.length ?? 0) === 0 && v !== baseOnlyVertex) {
      emptyVertexPenalty += 3.5;
    }
  }

  const objective =
    -maxFaceCount * 80 -
    sqImbalance * 4 +
    activeFaceCount * 16 -
    emptyVertexPenalty;

  return {
    vertexTags,
    baseOnlyVertex,
    repartitioned,
    faceCounts,
    maxFaceCount,
    activeFaceCount,
    objective,
    assignments,
    profiles,
  };
}

function buildRepartitionedSixVertexTags<TItem, TTagMeta>(params: {
  readonly profiles: readonly SemanticItemProfile<TItem, TTagMeta>[];
  readonly discriminativeTags: readonly string[];
  readonly tagWeights: ReadonlyMap<string, number>;
  readonly subTris: SimplexMesh['triangles'];
}): EvaluatedSemanticPartition<TItem, TTagMeta> {
  const { profiles, discriminativeTags, tagWeights, subTris } = params;

  // Group items by unique discriminative tag signature
  const sigGroups = new Map<
    string,
    {
      readonly sig: string;
      readonly tags: readonly string[];
      readonly tagSet: ReadonlySet<string>;
      count: number;
      sumL0: number;
      sumL1: number;
      sumL2: number;
    }
  >();
  let hasEmptyDiscGroup = false;

  for (const p of profiles) {
    if (p.discTags.length === 0) hasEmptyDiscGroup = true;
    const existing = sigGroups.get(p.sig);
    if (existing) {
      existing.count += 1;
      existing.sumL0 += p.l0;
      existing.sumL1 += p.l1;
      existing.sumL2 += p.l2;
    } else {
      sigGroups.set(p.sig, {
        sig: p.sig,
        tags: p.discTags,
        tagSet: p.discTagSet,
        count: 1,
        sumL0: p.l0,
        sumL1: p.l1,
        sumL2: p.l2,
      });
    }
  }

  const nonEmptyGroups = [...sigGroups.values()]
    .filter((g) => g.tags.length > 0)
    .sort((a, b) => b.count - a.count || a.sig.localeCompare(b.sig));

  // Deterministic farthest-point prototype selection across distinct item tag signatures
  const maxProtos = Math.min(hasEmptyDiscGroup ? 5 : 6, nonEmptyGroups.length);
  const chosenProtos: typeof nonEmptyGroups = [];
  if (nonEmptyGroups.length > 0) {
    chosenProtos.push(nonEmptyGroups[0]!);
    while (chosenProtos.length < maxProtos) {
      let bestCand: (typeof nonEmptyGroups)[number] | null = null;
      let bestScore = -1;
      for (const cand of nonEmptyGroups) {
        if (chosenProtos.includes(cand)) continue;
        let minDissim = 1;
        for (const sel of chosenProtos) {
          let inter = 0;
          for (const t of cand.tags) {
            if (sel.tagSet.has(t)) inter += 1;
          }
          const union = cand.tags.length + sel.tags.length - inter || 1;
          const dissim = 1 - inter / union;
          if (dissim < minDissim) minDissim = dissim;
        }
        const score = (0.25 + minDissim) * Math.sqrt(cand.count);
        if (score > bestScore) {
          bestScore = score;
          bestCand = cand;
        }
      }
      if (!bestCand) break;
      chosenProtos.push(bestCand);
    }
  }

  const buckets: Set<string>[] = Array.from({ length: 6 }, () => new Set<string>());
  const claimedVertices = new Set<number>();

  // Assign each selected signature prototype to its spatially closest unclaimed sub-mesh vertex
  for (const proto of chosenProtos) {
    const m0 = proto.sumL0 / proto.count;
    const m1 = proto.sumL1 / proto.count;
    const m2 = proto.sumL2 / proto.count;
    let bestV = 0;
    let bestDist = Infinity;
    for (let v = 0; v < 6; v++) {
      if (claimedVertices.has(v)) continue;
      const vb = SUB_MESH_VERTEX_BARY[v]!;
      const dist =
        Math.abs(m0 - vb[0]) + Math.abs(m1 - vb[1]) + Math.abs(m2 - vb[2]);
      if (dist < bestDist) {
        bestDist = dist;
        bestV = v;
      }
    }
    claimedVertices.add(bestV);
    for (const t of proto.tags.slice(0, 3)) {
      buckets[bestV]!.add(t);
    }
  }

  // Reserve a dedicated vertex for base-only items (items carrying only ubiquitous triangle tags) when present
  let baseOnlyVertex = -1;
  if (hasEmptyDiscGroup) {
    const emptyGroup = sigGroups.get('');
    const m0 = emptyGroup ? emptyGroup.sumL0 / emptyGroup.count : 0.34;
    const m1 = emptyGroup ? emptyGroup.sumL1 / emptyGroup.count : 0.33;
    const m2 = emptyGroup ? emptyGroup.sumL2 / emptyGroup.count : 0.33;
    let bestV = 5;
    let bestDist = Infinity;
    for (let v = 0; v < 6; v++) {
      if (claimedVertices.has(v)) continue;
      const vb = SUB_MESH_VERTEX_BARY[v]!;
      const dist =
        Math.abs(m0 - vb[0]) + Math.abs(m1 - vb[1]) + Math.abs(m2 - vb[2]);
      if (dist < bestDist) {
        bestDist = dist;
        bestV = v;
      }
    }
    baseOnlyVertex = bestV;
    claimedVertices.add(bestV);
  }

  // Ensure every discriminative tag in the triangle's tag subset is placed on at least one vertex,
  // preferring unfilled vertices first so all 6 vertices actively participate when tags allow.
  for (const tag of discriminativeTags) {
    let alreadyPlaced = false;
    for (let v = 0; v < 6; v++) {
      if (buckets[v]!.has(tag)) {
        alreadyPlaced = true;
        break;
      }
    }
    if (alreadyPlaced) continue;

    // Compute tag's mean parent barycentric location
    let cnt = 0;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (const p of profiles) {
      if (p.discTagSet.has(tag)) {
        cnt += 1;
        s0 += p.l0;
        s1 += p.l1;
        s2 += p.l2;
      }
    }
    const m0 = cnt > 0 ? s0 / cnt : 0.34;
    const m1 = cnt > 0 ? s1 / cnt : 0.33;
    const m2 = cnt > 0 ? s2 / cnt : 0.33;

    let bestV = 0;
    let bestCost = Infinity;
    for (let v = 0; v < 6; v++) {
      if (v === baseOnlyVertex) continue;
      const vb = SUB_MESH_VERTEX_BARY[v]!;
      const geoDist =
        Math.abs(m0 - vb[0]) + Math.abs(m1 - vb[1]) + Math.abs(m2 - vb[2]);
      const loadCost = buckets[v]!.size * 0.65;
      const cost = geoDist * 0.4 + loadCost;
      if (cost < bestCost) {
        bestCost = cost;
        bestV = v;
      }
    }
    buckets[bestV]!.add(tag);
  }

  // If any non-base vertex is still empty and another vertex holds >= 2 tags, split a tag onto it
  // (outer corners 0..2 receive priority before midpoints 3..5; never copy already-used tags onto empty vertices)
  for (let v = 0; v < 6; v++) {
    if (v === baseOnlyVertex || buckets[v]!.size > 0) continue;
    let donorV = -1;
    let maxSize = 1;
    for (let d = 0; d < 6; d++) {
      if (buckets[d]!.size > maxSize) {
        maxSize = buckets[d]!.size;
        donorV = d;
      }
    }
    if (donorV >= 0) {
      const movedTag = [...buckets[donorV]!].at(-1)!;
      buckets[donorV]!.delete(movedTag);
      buckets[v]!.add(movedTag);
    }
  }

  let currentEval = evaluateSemanticSixVertexPartition({
    profiles,
    vertexTags: buckets.map((s) => [...s]),
    baseOnlyVertex,
    repartitioned: true,
    tagWeights,
    subTris,
  });

  // Fast deterministic hill-climbing swaps across the 6 vertices to directly optimize 4-triangle balance
  const candidateTags = discriminativeTags.slice(0, 10);
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const tag of candidateTags) {
      for (let targetV = 0; targetV < 6; targetV++) {
        if (targetV === baseOnlyVertex) continue;
        // Try moving `tag` exclusively to `targetV`
        const nextBuckets = buckets.map((s, vIdx) => {
          const copy = new Set(s);
          if (vIdx === targetV) copy.add(tag);
          else copy.delete(tag);
          return copy;
        });
        const trial = evaluateSemanticSixVertexPartition({
          profiles,
          vertexTags: nextBuckets.map((s) => [...s]),
          baseOnlyVertex,
          repartitioned: true,
          tagWeights,
          subTris,
        });
        if (trial.objective > currentEval.objective + 0.5) {
          for (let v = 0; v < 6; v++) buckets[v] = nextBuckets[v]!;
          currentEval = trial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // Eliminate any identical non-empty tag buckets across vertices (preferring outer corners 0..2 over midpoints 3..5)
  const seenBucketSigs = new Set<string>();
  for (let v = 0; v < 6; v++) {
    if (v === baseOnlyVertex || buckets[v]!.size === 0) continue;
    const sig = [...buckets[v]!].sort().join('\0');
    if (seenBucketSigs.has(sig)) {
      const nextBuckets = buckets.map((s, idx) =>
        idx === v ? new Set<string>() : new Set(s),
      );
      const trial = evaluateSemanticSixVertexPartition({
        profiles,
        vertexTags: nextBuckets.map((s) => [...s]),
        baseOnlyVertex,
        repartitioned: true,
        tagWeights,
        subTris,
      });
      if (trial.maxFaceCount < profiles.length) {
        buckets[v] = nextBuckets[v]!;
        currentEval = trial;
      }
    } else {
      seenBucketSigs.add(sig);
    }
  }

  return currentEval;
}

/**
 * Semantic zoom strategy that preserves the focused triangle's tag subset while splitting
 * into 6 sub-topic vertices — keeping parent corners anchored when already balanced, or
 * completely re-partitioning the triangle's tags across all 6 vertices whenever needed to
 * maximize 4-sub-triangle utilization and strictly prevent infinite drill-down loops.
 */
export function createSemanticZoomStrategy<
  TItem = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  options?: SemanticZoomStrategyOptions,
): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
  const clusterZoomMode = options?.clusterZoomMode ?? 'incident-star';
  const stopWhenFullScale = options?.stopWhenFullScale ?? true;
  const fullScaleThreshold = options?.fullScaleThreshold ?? DEFAULT_FULL_SCALE_THRESHOLD;
  const barycentricFallback = options?.barycentricFallback ?? true;
  const leafTriangleFocus = options?.leafTriangleFocus ?? true;
  const allowClusterDrill = clusterZoomMode !== 'none';
  const fallbackStrategy = createBarycentricZoomStrategy<TItem, TTagMeta, TClusterMeta>({
    clusterZoomMode,
    adaptiveContrastStretch: true,
    enableSectorFallback: true,
    stopWhenFullScale,
    fullScaleThreshold,
    leafTriangleFocus,
  });

  const buildSemanticTriangleDrill = (
    ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null => {
    const { triangleIndex, parentFrame, itemScaleRatios, helpers } = ctx;
    const tri = parentFrame.mesh.triangles[triangleIndex];
    if (!tri) return null;

    if (ctx.parentDepth >= MAX_ZOOM_DRILL_DEPTH) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    const [v0, v1, v2] = tri.vertices;
    const vSet = new Set([v0, v1, v2]);
    const coveredItems = parentFrame.items.filter((it) =>
      isItemCoveredByVertices(parentFrame, it, vSet),
    );
    if (coveredItems.length <= 1) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    if (stopWhenFullScale) {
      const stats = computeFullScaleStats(
        coveredItems.map((it) => it.id),
        itemScaleRatios,
        fullScaleThreshold,
      );
      if (!stats.hasUnderScaled) {
        return leafTriangleFocus
          ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
          : null;
      }
    }

    const c0 = parentFrame.clusters[v0];
    const c1 = parentFrame.clusters[v1];
    const c2 = parentFrame.clusters[v2];
    const p0 = parentFrame.mesh.vertices[v0]!;
    const p1 = parentFrame.mesh.vertices[v1]!;
    const p2 = parentFrame.mesh.vertices[v2]!;

    const normById = new Map<string, NormalizedContentItem<TItem>>();
    for (const ni of helpers.normalizedItems) normById.set(ni.id, ni);

    const getItemTags = (it: ZoomItemAnchorInput<TItem, TTagMeta>): readonly string[] => {
      const norm = normById.get(it.id);
      if (norm && norm.tags.length > 0) return norm.tags;
      return it.tags.map((t) => t.tag);
    };

    // 1. Determine the triangle's preserved tag subset `T_triangle`
    const allItemTagFreq = new Map<string, number>();
    for (const it of coveredItems) {
      for (const t of getItemTags(it)) {
        allItemTagFreq.set(t, (allItemTagFreq.get(t) ?? 0) + 1);
      }
    }

    const parentMeta = parentFrame.strategyData as InternalFrameMeta | undefined;
    const inheritedSubset = parentMeta?.semanticTagSubset
      ? new Set(parentMeta.semanticTagSubset)
      : null;

    const cornerPoolSet = new Set<string>();
    for (const c of [c0, c1, c2]) {
      if (!c) continue;
      for (const td of c.coreTags) {
        if (allItemTagFreq.has(td.tag) && (!inheritedSubset || inheritedSubset.has(td.tag))) {
          cornerPoolSet.add(td.tag);
        }
      }
      for (const td of c.sharedTags) {
        if (allItemTagFreq.has(td.tag) && (!inheritedSubset || inheritedSubset.has(td.tag))) {
          cornerPoolSet.add(td.tag);
        }
      }
    }

    const countDistinctSignatures = (allowedTags: ReadonlySet<string>): number => {
      if (allowedTags.size === 0) return 0;
      const sigs = new Set<string>();
      for (const it of coveredItems) {
        const present = getItemTags(it)
          .filter((t) => allowedTags.has(t))
          .sort()
          .join('\0');
        sigs.add(present);
      }
      return sigs.size;
    };

    let triangleTagSubsetSet: Set<string>;
    if (countDistinctSignatures(cornerPoolSet) >= 2) {
      triangleTagSubsetSet = cornerPoolSet;
    } else if (
      inheritedSubset &&
      countDistinctSignatures(
        new Set([...inheritedSubset].filter((t) => allItemTagFreq.has(t))),
      ) >= 2
    ) {
      triangleTagSubsetSet = new Set(
        [...inheritedSubset].filter((t) => allItemTagFreq.has(t)),
      );
    } else {
      triangleTagSubsetSet = new Set(allItemTagFreq.keys());
    }

    const nItems = coveredItems.length;
    const discriminativeTags = [...triangleTagSubsetSet]
      .filter((t) => {
        const f = allItemTagFreq.get(t) ?? 0;
        return f >= 1 && f < nItems;
      })
      .sort((a, b) => {
        const pa = (allItemTagFreq.get(a) ?? 0) / nItems;
        const pb = (allItemTagFreq.get(b) ?? 0) / nItems;
        const balA = pa * (1 - pa);
        const balB = pb * (1 - pb);
        return Math.abs(balB - balA) > 1e-4 ? balB - balA : a.localeCompare(b);
      });

    const ubiquitousTags = [...triangleTagSubsetSet]
      .filter((t) => (allItemTagFreq.get(t) ?? 0) === nItems)
      .sort();

    const w0Base = getFrameVertexRootWeights(parentFrame, v0);
    const w1Base = getFrameVertexRootWeights(parentFrame, v1);
    const w2Base = getFrameVertexRootWeights(parentFrame, v2);

    const discSet = new Set(discriminativeTags);
    const profiles: SemanticItemProfile<TItem, TTagMeta>[] = coveredItems.map((it) => {
      const discTags = getItemTags(it)
        .filter((t) => discSet.has(t))
        .sort();
      const rw = getItemRootWeights(parentFrame, it);
      const proj = projectRootWeightsOntoTriangleCorners(rw, w0Base, w1Base, w2Base);
      let l0 = proj?.l0 ?? 0;
      let l1 = proj?.l1 ?? 0;
      let l2 = proj?.l2 ?? 0;
      if (!proj) {
        for (const uw of it.unitWeights) {
          if (uw.clusterIndex === v0) l0 += uw.weight;
          else if (uw.clusterIndex === v1) l1 += uw.weight;
          else if (uw.clusterIndex === v2) l2 += uw.weight;
        }
        const s = l0 + l1 + l2 || 1;
        l0 /= s;
        l1 /= s;
        l2 /= s;
      }
      return {
        item: it,
        discTags,
        discTagSet: new Set(discTags),
        sig: discTags.join('\0'),
        l0,
        l1,
        l2,
        rootWeights: rw,
      };
    });

    const uniqueSignatureCount = new Set(profiles.map((p) => p.sig)).size;

    const hasSurroundingContext =
      parentFrame.mesh.triangles.length > 1 ||
      (parentFrame.contextTriangles?.length ?? 0) > 0;
    const focusPadding = computeContextAwarePadding(
      helpers.viewportWidth,
      helpers.viewportHeight,
      helpers.innerPadding,
      hasSurroundingContext,
    );
    const { mesh: subMesh, transform } = buildSubdividedTriangleMeshWithTransform(
      p0,
      p1,
      p2,
      helpers.viewportWidth,
      helpers.viewportHeight,
      focusPadding,
      parentFrame.mesh.orientation,
    );
    const neighbors = evaluateTriangleFrameNeighbors(
      parentFrame,
      triangleIndex,
      subMesh,
    );
    const context = buildNeighborhoodContext({
      parentFrame,
      excludedTriangleIndices: new Set([triangleIndex]),
      excludedVertexIndices: vSet,
      activeParentEdgeKeys: new Set([
        pairEdgeKey(v0, v1),
        pairEdgeKey(v1, v2),
        pairEdgeKey(v2, v0),
      ]),
      activeItemIds: new Set(coveredItems.map((it) => it.id)),
      parentSettledItems: helpers.parentSettledItems,
      transform,
      viewportWidth: helpers.viewportWidth,
      viewportHeight: helpers.viewportHeight,
      allowClusterDrill: clusterZoomMode !== 'none',
    });

    const triCodes = [
      c0?.code ?? defaultClusterCode(v0),
      c1?.code ?? defaultClusterCode(v1),
      c2?.code ?? defaultClusterCode(v2),
    ];
    const triCrumb = buildTriangleBreadcrumbInfo([c0, c1, c2], triCodes);
    const triMixed = mixOklabColors(
      [c0, c1, c2]
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );

    const buildSemanticLeafSectorFallback = (): ZoomDrillOutcome<
      TItem,
      TTagMeta,
      TClusterMeta
    > => {
      const meanWeights =
        profiles[0]?.rootWeights ?? mixRootWeightMaps(w0Base, 1, w1Base, 0);
      return {
        nextFrame: buildSectorPartitionFrame({
          frameId: `sem-sector-${parentFrame.frameId}-t${triangleIndex}`,
          label: triCrumb.label,
          shortLabel: triCrumb.shortLabel,
          accentHex: triMixed.hex,
          breadcrumbSegments: triCrumb.segments,
          parentContextLabel: truncateClean(triCrumb.shortLabel, 20),
          coveredItems,
          baseRootWeights: meanWeights,
          helpers,
          neighbors,
          sourceTrianglePoints: [p0, p1, p2],
          innerPadding: focusPadding,
          meshOrientation: parentFrame.mesh.orientation,
          contextTriangles: context.contextTriangles,
          contextEdges: context.contextEdges,
          contextClusters: context.contextClusters,
          contextItems: context.contextItems,
        }),
      };
    };

    // 2. If zero semantic variance remains among covered items (`uniqueSignatureCount <= 1`),
    // only use barycentric fallback if it genuinely separates items across multiple sub-triangles;
    // otherwise terminate cleanly via 3-sector spatial leaf partition (zero infinite loops!).
    if (uniqueSignatureCount <= 1) {
      if (barycentricFallback) {
        const baryOutcome = fallbackStrategy.drillIntoTriangle!(ctx);
        if (baryOutcome) {
          const bf = baryOutcome.nextFrame;
          if (bf.kind === 'cluster-spotlight') return baryOutcome;
          let maxSub = 0;
          for (const st of bf.mesh.triangles) {
            const sv = new Set(st.vertices);
            let cnt = 0;
            for (const bi of bf.items) {
              if (isItemCoveredByVertices(bf, bi, sv)) cnt += 1;
            }
            if (cnt > maxSub) maxSub = cnt;
          }
          if (maxSub < coveredItems.length) {
            return baryOutcome;
          }
        }
      }
      return buildSemanticLeafSectorFallback();
    }

    // 3. Information weights for discriminative tags inside `T_triangle`
    const tagWeights = new Map<string, number>();
    for (const t of discriminativeTags) {
      const f = allItemTagFreq.get(t) ?? 1;
      tagWeights.set(t, 1 + Math.log((nItems + 1) / (f + 0.5)));
    }

    // Candidate A: Anchored 3->6 split (keep corner discriminative tags, assign remaining to edge midpoints)
    const anchoredCornerTags: readonly (readonly string[])[] = [c0, c1, c2].map(
      (c) => (c?.coreTags.map((td) => td.tag) ?? []).filter((t) => discSet.has(t)),
    );
    const usedByCorners = new Set(anchoredCornerTags.flat());
    const remainingDisc = discriminativeTags.filter((t) => !usedByCorners.has(t));
    const midBuckets: string[][] = [[], [], []];
    remainingDisc.slice(0, 6).forEach((t, idx) => {
      midBuckets[idx % 3]!.push(t);
    });
    const anchoredVertexTags: readonly (readonly string[])[] = [
      anchoredCornerTags[0]!,
      anchoredCornerTags[1]!,
      anchoredCornerTags[2]!,
      midBuckets[0]!,
      midBuckets[1]!,
      midBuckets[2]!,
    ];

    const anchoredCornerSigs = anchoredCornerTags.map((tags) =>
      [...tags].sort().join('\0'),
    );
    const anchoredHasValidCorners =
      anchoredCornerTags[0]!.length > 0 &&
      anchoredCornerTags[1]!.length > 0 &&
      anchoredCornerTags[2]!.length > 0 &&
      new Set(anchoredCornerSigs).size === 3 &&
      midBuckets[0]!.length + midBuckets[1]!.length + midBuckets[2]!.length >= 1;

    const candidateA = anchoredHasValidCorners
      ? evaluateSemanticSixVertexPartition({
          profiles,
          vertexTags: anchoredVertexTags,
          baseOnlyVertex: -1,
          repartitioned: false,
          tagWeights,
          subTris: subMesh.triangles,
        })
      : null;

    // Candidate B: Full 6-vertex tag re-partition across the triangle's tag subset for optimal 4-face spread
    const candidateB = buildRepartitionedSixVertexTags({
      profiles,
      discriminativeTags,
      tagWeights,
      subTris: subMesh.triangles,
    });

    const anchoredIsWellBalanced =
      candidateA !== null &&
      candidateA.maxFaceCount < nItems &&
      (nItems < 4 ||
        (candidateA.activeFaceCount >= 2 &&
          candidateA.maxFaceCount <= Math.ceil(nItems * 0.65))) &&
      candidateA.maxFaceCount <= candidateB.maxFaceCount + 1;

    const chosen = anchoredIsWellBalanced ? candidateA! : candidateB;

    // Strict anti-loop invariant: if even full 6-vertex re-partition failed to reduce `maxFaceCount < nItems`,
    // emit a 3-sector leaf partition so item counts strictly shrink on every step.
    if (chosen.maxFaceCount >= nItems) {
      return buildSemanticLeafSectorFallback();
    }

    const vWeights: ReadonlyMap<number, number>[] = [
      w0Base,
      w1Base,
      w2Base,
      mixRootWeightMaps(w0Base, 0.5, w1Base, 0.5),
      mixRootWeightMaps(w1Base, 0.5, w2Base, 0.5),
      mixRootWeightMaps(w2Base, 0.5, w0Base, 0.5),
    ];

    const vertexMembers = Array.from(
      { length: 6 },
      () =>
        new Map<
          string,
          {
            readonly item: TItem;
            readonly weight: number;
            readonly coverage: number;
            readonly isExclusive: boolean;
          }
        >(),
    );

    const subItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = chosen.profiles.map(
      (prof, idx) => {
        const assign = chosen.assignments[idx]!;
        let anchorX = 0;
        let anchorY = 0;
        for (const uw of assign.unitWeights) {
          const vp = subMesh.vertices[uw.clusterIndex]!;
          anchorX += vp.x * uw.weight;
          anchorY += vp.y * uw.weight;
          vertexMembers[uw.clusterIndex]!.set(prof.item.id, {
            item: prof.item.item,
            weight: uw.weight,
            coverage: uw.coverage,
            isExclusive: assign.unitWeights.length === 1,
          });
        }

        // Blend item color toward its assigned sub-mesh vertices for clear visual feedback
        const itemVertexMix = mixOklabColors(
          assign.unitWeights.map((uw) => {
            const vw = vWeights[uw.clusterIndex]!;
            const vCol = mixOklabColors(
              [...vw.entries()].map(([rIdx, rw]) => ({
                oklab: helpers.rootClusters[rIdx]!.oklab,
                weight: rw,
              })),
            );
            return { oklab: vCol.oklab, weight: uw.weight };
          }),
        );

        return {
          ...prof.item,
          anchorX,
          anchorY,
          unitWeights: assign.unitWeights,
          mixedColorHex: itemVertexMix.hex,
          mixedOklab: itemVertexMix.oklab,
        };
      },
    );

    const parentCorners = [c0, c1, c2];
    const tagMetaLookup = new Map<string, TTagMeta | undefined>();
    for (const it of coveredItems) {
      for (const td of it.tags) {
        if (td.meta !== undefined && !tagMetaLookup.has(td.tag)) {
          tagMetaLookup.set(td.tag, td.meta);
        }
      }
    }
    for (const pc of parentCorners) {
      if (!pc) continue;
      for (const td of [...pc.coreTags, ...pc.sharedTags]) {
        if (td.meta !== undefined && !tagMetaLookup.has(td.tag)) {
          tagMetaLookup.set(td.tag, td.meta);
        }
      }
    }

    const formatTagDisplay = (t: string): string => {
      const metaObj = tagMetaLookup.get(t);
      if (
        metaObj &&
        typeof metaObj === 'object' &&
        'displayTitle' in metaObj &&
        typeof (metaObj as { readonly displayTitle?: unknown }).displayTitle ===
          'string'
      ) {
        const dt = (metaObj as { readonly displayTitle: string }).displayTitle.trim();
        if (dt.length > 0) return dt;
      }
      return `#${t.replace(/^#+/, '')}`;
    };

    const normLabelKey = (text: string): string => {
      const cleaned = text.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
      if (cleaned.includes('↔')) {
        return cleaned
          .split('↔')
          .map((p) => p.trim().replace(/^#+/, ''))
          .sort()
          .join(' ↔ ');
      }
      if (cleaned.includes(' · ')) {
        return cleaned
          .split(' · ')
          .map((p) => p.trim().replace(/^#+/, ''))
          .sort()
          .join(' · ');
      }
      return cleaned;
    };

    const sharedUbiquitousDescs: TagDescriptor<TTagMeta>[] = ubiquitousTags.map((t) => ({
      tag: t,
      frequency: allItemTagFreq.get(t) ?? nItems,
      meta: tagMetaLookup.get(t),
    }));

    const rawAssignedByVertex: readonly (readonly string[])[] = Array.from(
      { length: 6 },
      (_, vIdx) =>
        vIdx === chosen.baseOnlyVertex && (chosen.vertexTags[vIdx]?.length ?? 0) === 0
          ? ubiquitousTags.slice(0, 2)
          : (chosen.vertexTags[vIdx] ?? []),
    );

    // Count across how many of the 6 sub-vertices each tag appears so vertex-exclusive tags rank first
    const vertexTagFreq = new Map<string, number>();
    for (let vIdx = 0; vIdx < 6; vIdx++) {
      for (const t of new Set(rawAssignedByVertex[vIdx]!)) {
        vertexTagFreq.set(t, (vertexTagFreq.get(t) ?? 0) + 1);
      }
    }

    const rankedTagsByVertex: string[][] = [];
    const displayTagsByVertex: string[][] = [];
    const parentPrimaryNames: string[] = [c0, c1, c2].map((pc) =>
      pc ? resolveReadableClusterName(pc, 28) : '',
    );

    for (let vIdx = 0; vIdx < 6; vIdx++) {
      const pName = vIdx < 3 ? parentPrimaryNames[vIdx]! : '';
      const isRedundantWithParent = (t: string): boolean =>
        Boolean(pName) &&
        (normLabelKey(formatTagDisplay(t)) === normLabelKey(pName) ||
          normLabelKey(t) === normLabelKey(pName));

      const uniqueRaw = [...new Set(rawAssignedByVertex[vIdx]!)];
      const ranked = [...uniqueRaw].sort((a, b) => {
        const redA = isRedundantWithParent(a) ? 1 : 0;
        const redB = isRedundantWithParent(b) ? 1 : 0;
        if (redA !== redB) return redA - redB;
        const vfA = vertexTagFreq.get(a) ?? 6;
        const vfB = vertexTagFreq.get(b) ?? 6;
        if (vfA !== vfB) return vfA - vfB;
        const ifA = allItemTagFreq.get(a) ?? nItems;
        const ifB = allItemTagFreq.get(b) ?? nItems;
        if (ifA !== ifB) return ifA - ifB;
        return a.localeCompare(b);
      });
      rankedTagsByVertex.push(ranked);

      const nonRedundant = pName
        ? ranked.filter((t) => !isRedundantWithParent(t))
        : ranked;
      displayTagsByVertex.push(nonRedundant.length > 0 ? nonRedundant : ranked);
    }

    const buildTagLabelCandidates = (tags: readonly string[]): string[] => {
      const seenDisp = new Set<string>();
      const disp: string[] = [];
      for (const t of tags) {
        const formatted = formatTagDisplay(t);
        const k = normLabelKey(formatted);
        if (!seenDisp.has(k)) {
          seenDisp.add(k);
          disp.push(formatted);
        }
      }
      if (disp.length === 0) return [];
      if (disp.length === 1) return [disp[0]!];
      const cands: string[] = [];
      const pair01 = `${disp[0]!} · ${disp[1]!}`;
      if (pair01.length <= 24) {
        cands.push(pair01, disp[0]!);
      } else {
        cands.push(disp[0]!, pair01);
      }
      if (disp.length >= 3) {
        const pair02 = `${disp[0]!} · ${disp[2]!}`;
        if (pair02.length <= 24) cands.push(pair02);
        cands.push(disp[2]!);
        const pair12 = `${disp[1]!} · ${disp[2]!}`;
        if (pair12.length <= 24) cands.push(pair12);
      }
      cands.push(disp[1]!);
      for (let i = 3; i < disp.length; i++) {
        cands.push(disp[i]!);
      }
      return cands;
    };

    const collectMemberSpecificCandidates = (
      vIdx: number,
      primaryTagLabel?: string,
    ): string[] => {
      const recs = [...vertexMembers[vIdx]!.entries()].sort(
        (a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]),
      );
      if (recs.length === 0) return [];
      const extraTagScores = new Map<string, number>();
      const assignedSet = new Set(rankedTagsByVertex[vIdx]!);
      for (const [itemId, rec] of recs) {
        const itemInput = coveredItems.find((ci) => ci.id === itemId);
        if (!itemInput) continue;
        for (const t of getItemTags(itemInput)) {
          if (assignedSet.has(t)) continue;
          const freq = allItemTagFreq.get(t) ?? nItems;
          const spec = 1 + Math.log((nItems + 1) / (freq + 0.5));
          extraTagScores.set(t, (extraTagScores.get(t) ?? 0) + rec.weight * spec);
        }
      }
      const extraTags = [...extraTagScores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([t]) => formatTagDisplay(t));

      const out: string[] = [];
      for (const et of extraTags) {
        if (primaryTagLabel && normLabelKey(et) !== normLabelKey(primaryTagLabel)) {
          const combo = `${primaryTagLabel} · ${et}`;
          if (combo.length <= 24) out.push(combo);
        }
        out.push(et);
      }
      for (const [, rec] of recs.slice(0, 2)) {
        const ex = extractHumanExemplarTitle(rec.item);
        if (ex) {
          const cleanEx = truncateClean(ex, 18);
          if (primaryTagLabel && normLabelKey(cleanEx) !== normLabelKey(primaryTagLabel)) {
            const combo = `${primaryTagLabel} · ${truncateClean(ex, 11)}`;
            if (combo.length <= 24) out.push(combo);
          }
          out.push(cleanEx);
        }
      }
      return out;
    };

    const midpointEdgePairs: ReadonlyArray<
      readonly [
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
      ]
    > = [
      [c0, c1],
      [c1, c2],
      [c2, c0],
    ];
    const midpointCornerIdxPairs: ReadonlyArray<readonly [number, number]> = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];

    // Joint 6-vertex collision-free label resolution:
    // 1) Unchanged outer corners claim their clean parent primary label first (zero `JAVASCRIPT / JavaScript` stutter).
    // 2) Repartitioned outer corners claim their most specific non-colliding sub-tag label next.
    // 3) Midpoint vertices claim their exclusive tag pair or distinct sub-corner bridge label last.
    const usedDisplayKeys = new Set<string>();
    const unchangedCornerFlags: boolean[] = [false, false, false];
    const resolvedSubLabels: string[] = ['', '', '', '', '', ''];

    for (let vIdx = 0; vIdx < 3; vIdx++) {
      const parentCorner = parentCorners[vIdx];
      if (!parentCorner) continue;
      const pName = parentPrimaryNames[vIdx]!;
      const pKey = normLabelKey(pName);
      const nonRedundantCount = rankedTagsByVertex[vIdx]!.filter(
        (t) =>
          normLabelKey(formatTagDisplay(t)) !== pKey && normLabelKey(t) !== pKey,
      ).length;
      const wantsUnchanged =
        !chosen.repartitioned ||
        rawAssignedByVertex[vIdx]!.length === 0 ||
        nonRedundantCount === 0;
      if (wantsUnchanged && pKey.length > 0 && !usedDisplayKeys.has(pKey)) {
        unchangedCornerFlags[vIdx] = true;
        resolvedSubLabels[vIdx] = pName;
        usedDisplayKeys.add(pKey);
      }
    }

    for (let vIdx = 0; vIdx < 3; vIdx++) {
      if (unchangedCornerFlags[vIdx]) continue;
      const pName = parentPrimaryNames[vIdx]!;
      const dispCands = buildTagLabelCandidates(displayTagsByVertex[vIdx]!);
      const fullCands =
        displayTagsByVertex[vIdx]!.length < rankedTagsByVertex[vIdx]!.length
          ? buildTagLabelCandidates(rankedTagsByVertex[vIdx]!)
          : [];
      const memberCands = collectMemberSpecificCandidates(vIdx, dispCands[0]);
      const fallbackFmt = formatMixLabel(vWeights[vIdx]!, helpers.rootClusters);
      const allCands = [
        ...dispCands,
        ...fullCands,
        ...memberCands,
        ...(pName ? [`${truncateClean(pName, 12)} · ${fallbackFmt.code}`, pName] : []),
        fallbackFmt.label,
        `${fallbackFmt.label} (${vIdx + 1})`,
      ];
      let picked = allCands[0] ?? fallbackFmt.code;
      for (const cand of allCands) {
        const ck = normLabelKey(cand);
        if (ck.length > 0 && !usedDisplayKeys.has(ck)) {
          picked = cand;
          break;
        }
      }
      resolvedSubLabels[vIdx] = picked;
      usedDisplayKeys.add(normLabelKey(picked));
    }

    for (let vIdx = 3; vIdx < 6; vIdx++) {
      const [idxA, idxB] = midpointCornerIdxPairs[vIdx - 3]!;
      const immediatePair = midpointEdgePairs[vIdx - 3];
      const parentBridge = formatCompactBridgeLabel(
        vWeights[vIdx]!,
        helpers.rootClusters,
        immediatePair,
      );
      const subNameA = truncateClean(
        (resolvedSubLabels[idxA] || parentPrimaryNames[idxA] || 'A')
          .split(' · ')[0]!
          .replace(/^#+/, ''),
        10,
      );
      const subNameB = truncateClean(
        (resolvedSubLabels[idxB] || parentPrimaryNames[idxB] || 'B')
          .split(' · ')[0]!
          .replace(/^#+/, ''),
        10,
      );
      const subCornerBridge =
        normLabelKey(subNameA) !== normLabelKey(subNameB)
          ? `${subNameA} ↔ ${subNameB}`
          : parentBridge;

      const dispCands = buildTagLabelCandidates(displayTagsByVertex[vIdx]!);
      const bridgeCands = chosen.repartitioned
        ? [subCornerBridge, parentBridge]
        : [parentBridge, subCornerBridge];
      const memberCands = collectMemberSpecificCandidates(vIdx, dispCands[0]);
      const fmt = formatMixLabel(vWeights[vIdx]!, helpers.rootClusters);
      const allCands = [
        ...dispCands,
        ...bridgeCands,
        ...memberCands,
        `${subCornerBridge} · ${fmt.code}`,
        `${parentBridge} (${vIdx - 2})`,
      ];
      let picked = allCands[0] ?? parentBridge;
      for (const cand of allCands) {
        const ck = normLabelKey(cand);
        if (ck.length > 0 && !usedDisplayKeys.has(ck)) {
          picked = cand;
          break;
        }
      }
      resolvedSubLabels[vIdx] = picked;
      usedDisplayKeys.add(normLabelKey(picked));
    }

    const subClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = vWeights.map(
      (vw, vIdx) => {
        const vert = subMesh.vertices[vIdx]!;
        const parentCorner = vIdx < 3 ? parentCorners[vIdx] : undefined;
        const mixed = mixOklabColors(
          [...vw.entries()].map(([rIdx, rw]) => ({
            oklab: helpers.rootClusters[rIdx]!.oklab,
            weight: rw,
          })),
        );
        const members = [...vertexMembers[vIdx]!.entries()].map(
          ([itemId, rec]) => ({
            item: rec.item,
            itemId,
            coverage: rec.coverage,
            normalizedWeight: rec.weight,
            isExclusiveVertexMember: rec.isExclusive,
          }),
        );

        // Preserve original corner identity cleanly when anchored or when no sub-tag refines this corner
        if (parentCorner && vIdx < 3 && unchangedCornerFlags[vIdx]) {
          return buildSynthesizedClusterDescriptor({
            clusterIndex: vIdx,
            clusterUid: helpers.allocateClusterUid(),
            code: parentCorner.code,
            defaultLabel: parentCorner.defaultLabel,
            oklab: parentCorner.oklab,
            hex: parentCorner.colorHex,
            vertex: vert,
            coreTags: parentCorner.coreTags,
            sharedTags: parentCorner.sharedTags,
            members,
            featureSummary: parentCorner.featureSummary,
            role: parentCorner.role ?? 'primary',
            mixWeights: parentCorner.mixWeights,
            subclusterLabel: parentCorner.subclusterLabel,
            parentContextLabel: parentCorner.parentContextLabel,
            preservePrimaryTitle:
              (parentCorner.role ?? 'primary') === 'primary'
                ? resolvedSubLabels[vIdx]
                : undefined,
            deriveClusterMeta: helpers.deriveClusterMeta,
          });
        }

        const rankedTags = rankedTagsByVertex[vIdx]!;
        const tagDescs: TagDescriptor<TTagMeta>[] = rankedTags.map((t) => ({
          tag: t,
          frequency: allItemTagFreq.get(t) ?? helpers.corpus?.tagFreqMap.get(t) ?? 1,
          meta: tagMetaLookup.get(t),
        }));

        const fmt = formatMixLabel(vw, helpers.rootClusters);
        const mixWeights = buildMixWeights(vw, helpers.rootClusters);
        const conciseSubLabel = resolvedSubLabels[vIdx]!;
        const tagTitle =
          rankedTags.length > 0
            ? rankedTags.map((t) => `#${t}`).join(' · ')
            : conciseSubLabel;

        return buildSynthesizedClusterDescriptor({
          clusterIndex: vIdx,
          clusterUid: helpers.allocateClusterUid(),
          code: parentCorner ? parentCorner.code : fmt.code,
          defaultLabel: tagTitle,
          oklab: parentCorner ? parentCorner.oklab : mixed.oklab,
          hex: parentCorner ? parentCorner.colorHex : mixed.hex,
          vertex: vert,
          coreTags: tagDescs,
          sharedTags: sharedUbiquitousDescs,
          members,
          featureSummary: chosen.repartitioned
            ? `Re-partitioned sub-cluster (${conciseSubLabel})`
            : `Semantic midpoint (${conciseSubLabel})`,
          role: 'intermediate',
          mixWeights,
          subclusterLabel: conciseSubLabel,
          parentContextLabel: parentCorner
            ? deriveCornerParentContextLabel(parentCorner)
            : undefined,
          deriveClusterMeta: helpers.deriveClusterMeta,
        });
      },
    );

    const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
    for (const prof of profiles) {
      itemRootMap.set(prof.item.id, prof.rootWeights);
    }

    return {
      nextFrame: {
        frameId: `sem-${parentFrame.frameId}-t${triangleIndex}`,
        kind: 'triangle',
        label: triCrumb.label,
        shortLabel: triCrumb.shortLabel,
        accentHex: triMixed.hex,
        breadcrumbSegments: triCrumb.segments,
        mesh: subMesh,
        clusters: subClusters,
        items: subItems,
        neighbors,
        parentToFrameTransform: {
          scale: transform.scale,
          sourceCx: transform.sourceCx,
          sourceCy: transform.sourceCy,
          targetCx: transform.targetCx,
          targetCy: transform.targetCy,
        },
        contextTriangles: context.contextTriangles,
        contextEdges: context.contextEdges,
        contextClusters: context.contextClusters,
        contextItems: context.contextItems,
        strategyData: {
          kind: 'triangle',
          parentTriIndex: triangleIndex,
          vertexWeights: vWeights.map((rw) => ({ rootWeights: rw })),
          itemRootWeights: itemRootMap,
          semanticTagSubset: [...triangleTagSubsetSet],
        } satisfies InternalFrameMeta,
      },
    };
  };

  return {
    name: 'semantic-subcluster',
    mode: 'drill-down',

    evaluateTargets: fallbackStrategy.evaluateTargets,
    drillIntoTriangle: buildSemanticTriangleDrill,
    drillIntoCluster: fallbackStrategy.drillIntoCluster,
    drillToNeighbor(ctx) {
      const { localTarget } = parseScopedNeighborId(ctx.neighborId);
      if (localTarget.startsWith('tri:')) {
        const triIdx = parseInt(localTarget.slice(4), 10);
        if (!Number.isFinite(triIdx)) return null;
        const outcome = buildSemanticTriangleDrill({
          triangleIndex: triIdx,
          parentFrame: ctx.parentFrame,
          parentDepth: ctx.currentDepth - 1,
          itemScaleRatios: ctx.itemScaleRatios,
          helpers: ctx.helpers,
        });
        return outcome ? { ...outcome, replaceTop: true } : null;
      }
      return fallbackStrategy.drillToNeighbor!({
        ...ctx,
        neighborId: localTarget,
      });
    },
  };
}

// ============================================================================
// Strategy 3: Subspace Re-Clustering & Facet Lens Zoom Strategy
// ============================================================================

interface LocalSubspaceAxis {
  readonly familyKey: string;
  readonly values: Float64Array;
  readonly rawValues: Float64Array;
  readonly rawMean: number;
  readonly rawStd: number;
  readonly weight: number;
  readonly kind: 'boolean' | 'categorical' | 'numeric' | 'vector' | 'similarity';
  readonly highLabel: string;
  readonly lowLabel?: string;
  readonly formatMean?: (clusterMean: number, subsetMean: number) => string;
}

interface SubspacePrototype {
  readonly centroid: Float64Array;
  readonly memberIndices: readonly number[];
  readonly meanL0: number;
  readonly meanL1: number;
  readonly meanL2: number;
  readonly label: string;
}

const IGNORED_AUTO_KEYS = new Set<string>([
  'id',
  'slug',
  'key',
  'uid',
  'url',
  'href',
  'src',
  'title',
  'shortTitle',
  'name',
  'headline',
  'label',
  'description',
  'subtitle',
  'subtitleMeta',
  'summary',
  'author',
  'primaryAuthor',
  'colorHex',
  'palette',
  'mediaCredit',
  'waveform',
]);

function humanizeFieldKey(key: string): string {
  const cleaned = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(Musd|Mm|Cm|Hz|Pct|Min|Sec|Norm|Log)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractFallbackItemTitle<TItem>(
  item: TItem,
  fallbackId: string,
  getItemLabel?: (item: TItem) => string,
): string {
  if (getItemLabel) {
    const custom = getItemLabel(item)?.trim();
    if (custom) return custom;
  }
  if (typeof item === 'object' && item !== null) {
    const rec = item as Record<string, unknown>;
    for (const k of ['shortTitle', 'title', 'label', 'name', 'headline']) {
      const val = rec[k];
      if (typeof val === 'string' && val.trim().length > 0) {
        return val.trim().replace(/\s*\(\d{4}\)$/, '').slice(0, 18);
      }
    }
  }
  return fallbackId.slice(0, 16);
}

function buildLocalSubspaceAxes<TItem, TTagMeta, TClusterMeta>(params: {
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly depth: number;
  readonly kind: 'triangle' | 'cluster-spotlight';
  readonly options?: SubspaceZoomStrategyOptions<TItem>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
}): readonly LocalSubspaceAxis[] {
  const { coveredItems, depth, kind, options, helpers } = params;
  const n = coveredItems.length;
  if (n < 2) return [];

  const axes: LocalSubspaceAxis[] = [];
  const rawDomainItems = coveredItems.map((it) => it.item);

  // 1. Explicit interpretable features / facets
  const resolvedFeatures =
    typeof options?.features === 'function'
      ? options.features({ depth, kind, items: rawDomainItems })
      : options?.features;

  if (resolvedFeatures && resolvedFeatures.length > 0) {
    resolvedFeatures.forEach((feat, fIdx) => {
      if ((feat.minDepth ?? 0) > depth) return;
      const baseWeight = Math.max(0.05, feat.weight ?? 1);
      const familyKey = feat.id ?? `feat:${fIdx}:${feat.label}`;
      const extracted = rawDomainItems.map((it) => feat.getValue(it));

      let hasBool = false;
      let hasString = false;
      let hasNumber = false;
      for (const v of extracted) {
        if (typeof v === 'boolean') hasBool = true;
        else if (typeof v === 'string' && v.trim().length > 0) hasString = true;
        else if (typeof v === 'number' && Number.isFinite(v)) hasNumber = true;
      }

      if (hasBool && !hasString && !hasNumber) {
        const raw = new Float64Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const b = extracted[i] === true ? 1 : 0;
          raw[i] = b;
          sum += b;
        }
        const p = sum / n;
        if (p <= 1e-6 || p >= 1 - 1e-6) return;
        const std = Math.sqrt(p * (1 - p));
        // Balance boost peaks at 50/50 splits while keeping minority traits active
        const balanceFactor = 0.55 + 0.9 * Math.sqrt(4 * p * (1 - p));
        const effW = baseWeight * balanceFactor;
        const z = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          z[i] = ((raw[i]! - p) / std) * effW;
        }
        axes.push({
          familyKey,
          values: z,
          rawValues: raw,
          rawMean: p,
          rawStd: std,
          weight: effW,
          kind: 'boolean',
          highLabel: feat.highLabel ?? feat.label,
          lowLabel: feat.lowLabel,
          formatMean: feat.formatMean,
        });
        return;
      }

      if (hasString && !hasNumber) {
        const counts = new Map<string, number>();
        const cleanStrs = extracted.map((v) =>
          typeof v === 'string' ? v.trim() : '',
        );
        for (const s of cleanStrs) {
          if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
        }
        if (counts.size < 2) return;
        const sortedCats = [...counts.entries()]
          .filter(([, c]) => c > 0 && c < n)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 8);
        const catScale = 1 / Math.sqrt(Math.max(1, sortedCats.length * 0.5));
        for (const [catVal, count] of sortedCats) {
          const p = count / n;
          const std = Math.sqrt(p * (1 - p));
          if (std <= 1e-6) continue;
          const raw = new Float64Array(n);
          const z = new Float64Array(n);
          const effW =
            baseWeight * catScale * (0.55 + 0.9 * Math.sqrt(4 * p * (1 - p)));
          for (let i = 0; i < n; i++) {
            const hit = cleanStrs[i] === catVal ? 1 : 0;
            raw[i] = hit;
            z[i] = ((hit - p) / std) * effW;
          }
          axes.push({
            familyKey: `${familyKey}:${catVal}`,
            values: z,
            rawValues: raw,
            rawMean: p,
            rawStd: std,
            weight: effW,
            kind: 'categorical',
            highLabel: catVal,
          });
        }
        return;
      }

      if (hasNumber) {
        let validCount = 0;
        let sum = 0;
        for (const v of extracted) {
          if (typeof v === 'number' && Number.isFinite(v)) {
            sum += v;
            validCount += 1;
          }
        }
        if (validCount < 2) return;
        const mean = sum / validCount;
        const raw = new Float64Array(n);
        let sq = 0;
        for (let i = 0; i < n; i++) {
          const v = extracted[i];
          const num = typeof v === 'number' && Number.isFinite(v) ? v : mean;
          raw[i] = num;
          const d = num - mean;
          sq += d * d;
        }
        const std = Math.sqrt(sq / n);
        if (std <= 1e-6) return;
        const z = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const clamped = Math.max(-2.75, Math.min(2.75, (raw[i]! - mean) / std));
          z[i] = clamped * baseWeight;
        }
        axes.push({
          familyKey,
          values: z,
          rawValues: raw,
          rawMean: mean,
          rawStd: std,
          weight: baseWeight,
          kind: 'numeric',
          highLabel: feat.highLabel ?? `High ${feat.label}`,
          lowLabel: feat.lowLabel ?? `Low ${feat.label}`,
          formatMean: feat.formatMean,
        });
      }
    });
  }

  // 2. Explicit continuous embedding vector (residual zero-mean local standardization)
  if (options?.getVector) {
    const vecs = rawDomainItems.map((it) => options.getVector!(it));
    const dim = vecs.reduce((m, v) => Math.max(m, v.length), 0);
    if (dim > 0) {
      const means = new Float64Array(dim);
      const stds = new Float64Array(dim);
      let maxStd = 0;
      for (let d = 0; d < dim; d++) {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += vecs[i]?.[d] ?? 0;
        const mean = sum / n;
        means[d] = mean;
        let sq = 0;
        for (let i = 0; i < n; i++) {
          const diff = (vecs[i]?.[d] ?? 0) - mean;
          sq += diff * diff;
        }
        const std = Math.sqrt(sq / n);
        stds[d] = std;
        if (std > maxStd) maxStd = std;
      }
      if (maxStd > 1e-6) {
        const vecScale = axes.length > 0 ? 0.55 / Math.sqrt(dim) : 1 / Math.sqrt(dim);
        for (let d = 0; d < dim; d++) {
          const std = stds[d]!;
          if (std <= 1e-6) continue;
          const shrinkage = std / (std + 0.15 * maxStd);
          const effW = vecScale * shrinkage;
          const raw = new Float64Array(n);
          const z = new Float64Array(n);
          const mean = means[d]!;
          for (let i = 0; i < n; i++) {
            const val = vecs[i]?.[d] ?? 0;
            raw[i] = val;
            z[i] =
              Math.max(-2.75, Math.min(2.75, (val - mean) / std)) * effW;
          }
          const dimName = options.vectorDimensionLabels?.[d];
          axes.push({
            familyKey: `vec:${d}`,
            values: z,
            rawValues: raw,
            rawMean: mean,
            rawStd: std,
            weight: effW,
            kind: dimName ? 'numeric' : 'vector',
            highLabel: dimName ? `${dimName} +` : `Axis ${d + 1}+`,
            lowLabel: dimName ? `${dimName} −` : `Axis ${d + 1}−`,
          });
        }
      }
    }
  }

  // 3. Explicit pairwise similarity kernel (local landmark similarity profile)
  if (options?.getSimilarity && axes.length === 0) {
    const simMatrix: Float64Array[] = Array.from(
      { length: n },
      () => new Float64Array(n),
    );
    let minSim = 1;
    let maxSim = 0;
    for (let i = 0; i < n; i++) {
      simMatrix[i]![i] = 1;
      for (let j = i + 1; j < n; j++) {
        const s = Math.max(
          0,
          Math.min(1, options.getSimilarity(rawDomainItems[i]!, rawDomainItems[j]!)),
        );
        simMatrix[i]![j] = s;
        simMatrix[j]![i] = s;
        if (s < minSim) minSim = s;
        if (s > maxSim) maxSim = s;
      }
    }
    if (maxSim - minSim > 1e-5) {
      const landmarkCount = Math.min(n, 8);
      // Deterministic farthest-first landmarks across the local similarity kernel
      const landmarks: number[] = [0];
      while (landmarks.length < landmarkCount) {
        let bestIdx = -1;
        let bestMinDist = -1;
        for (let i = 0; i < n; i++) {
          if (landmarks.includes(i)) continue;
          let minDist = Infinity;
          for (const lm of landmarks) {
            const dist = 1 - simMatrix[i]![lm]!;
            if (dist < minDist) minDist = dist;
          }
          if (minDist > bestMinDist) {
            bestMinDist = minDist;
            bestIdx = i;
          }
        }
        if (bestIdx < 0 || bestMinDist <= 1e-5) break;
        landmarks.push(bestIdx);
      }
      const lmScale = 1 / Math.sqrt(Math.max(1, landmarks.length));
      landmarks.forEach((lmIdx, k) => {
        const raw = new Float64Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          raw[i] = simMatrix[i]![lmIdx]!;
          sum += raw[i]!;
        }
        const mean = sum / n;
        let sq = 0;
        for (let i = 0; i < n; i++) {
          const d = raw[i]! - mean;
          sq += d * d;
        }
        const std = Math.sqrt(sq / n);
        if (std <= 1e-6) return;
        const z = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          z[i] = ((raw[i]! - mean) / std) * lmScale;
        }
        const exLabel = extractFallbackItemTitle(
          rawDomainItems[lmIdx]!,
          coveredItems[lmIdx]!.id,
          options.getItemLabel,
        );
        axes.push({
          familyKey: `sim:${k}`,
          values: z,
          rawValues: raw,
          rawMean: mean,
          rawStd: std,
          weight: lmScale,
          kind: 'similarity',
          highLabel: exLabel,
        });
      });
    }
  }

  // 4. Zero-config automatic introspection (tags + varying object fields / embedded arrays)
  if (axes.length === 0) {
    const normById = new Map<string, NormalizedContentItem<TItem>>();
    for (const ni of helpers.normalizedItems) normById.set(ni.id, ni);

    const tagCounts = new Map<string, number>();
    const itemTagSets = coveredItems.map((it) => {
      const norm = normById.get(it.id);
      const list = norm && norm.tags.length > 0 ? norm.tags : it.tags.map((t) => t.tag);
      const set = new Set(list);
      for (const t of set) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      return set;
    });

    const discTags = [...tagCounts.entries()]
      .filter(([, c]) => c >= 1 && c < n)
      .sort((a, b) => {
        const pa = a[1] / n;
        const pb = b[1] / n;
        const ba = pa * (1 - pa);
        const bb = pb * (1 - pb);
        return Math.abs(bb - ba) > 1e-4 ? bb - ba : a[0].localeCompare(b[0]);
      })
      .slice(0, 12);

    for (const [tag, count] of discTags) {
      const p = count / n;
      const std = Math.sqrt(p * (1 - p));
      if (std <= 1e-6) continue;
      const effW = 0.65 + 0.85 * Math.sqrt(4 * p * (1 - p));
      const raw = new Float64Array(n);
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const hit = itemTagSets[i]!.has(tag) ? 1 : 0;
        raw[i] = hit;
        z[i] = ((hit - p) / std) * effW;
      }
      axes.push({
        familyKey: `tag:${tag}`,
        values: z,
        rawValues: raw,
        rawMean: p,
        rawStd: std,
        weight: effW,
        kind: 'categorical',
        highLabel: tag.replace(/^#+/, ''),
      });
    }

    // Inspect plain-object properties (up to depth 1 for wrapper unions like `{ kind, media: {...} }`)
    const unwrapRecord = (val: unknown): Record<string, unknown> | null => {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) return null;
      const top = val as Record<string, unknown>;
      for (const k of Object.keys(top)) {
        if (k === 'mediaCredit' || k === 'proportions') continue;
        const child = top[k];
        if (
          typeof child === 'object' &&
          child !== null &&
          !Array.isArray(child) &&
          Object.keys(child).length >= 4
        ) {
          return child as Record<string, unknown>;
        }
      }
      return top;
    };

    const records = rawDomainItems.map(unwrapRecord);
    if (records.every((r) => r !== null)) {
      const candidateKeys = Object.keys(records[0]!).filter(
        (k) =>
          !IGNORED_AUTO_KEYS.has(k) &&
          !k.endsWith('Url') &&
          !k.endsWith('Path') &&
          !k.endsWith('Id'),
      );

      for (const key of candidateKeys.slice(0, 16)) {
        const vals = records.map((r) => r![key]);
        const niceLabel = humanizeFieldKey(key);
        if (vals.every((v) => typeof v === 'boolean')) {
          let sum = 0;
          const raw = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            const b = vals[i] === true ? 1 : 0;
            raw[i] = b;
            sum += b;
          }
          const p = sum / n;
          if (p > 1e-6 && p < 1 - 1e-6) {
            const std = Math.sqrt(p * (1 - p));
            const effW = 0.6 + 0.8 * Math.sqrt(4 * p * (1 - p));
            const z = new Float64Array(n);
            for (let i = 0; i < n; i++) z[i] = ((raw[i]! - p) / std) * effW;
            axes.push({
              familyKey: `auto-b:${key}`,
              values: z,
              rawValues: raw,
              rawMean: p,
              rawStd: std,
              weight: effW,
              kind: 'boolean',
              highLabel: niceLabel,
              lowLabel: `Non-${niceLabel}`,
            });
          }
        } else if (vals.every((v) => typeof v === 'number' && Number.isFinite(v as number))) {
          const raw = new Float64Array(n);
          let sum = 0;
          for (let i = 0; i < n; i++) {
            raw[i] = vals[i] as number;
            sum += raw[i]!;
          }
          const mean = sum / n;
          let sq = 0;
          for (let i = 0; i < n; i++) {
            const d = raw[i]! - mean;
            sq += d * d;
          }
          const std = Math.sqrt(sq / n);
          if (std > 1e-6) {
            const z = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              z[i] = Math.max(-2.75, Math.min(2.75, (raw[i]! - mean) / std));
            }
            axes.push({
              familyKey: `auto-n:${key}`,
              values: z,
              rawValues: raw,
              rawMean: mean,
              rawStd: std,
              weight: 1,
              kind: 'numeric',
              highLabel: `High ${niceLabel}`,
              lowLabel: `Low ${niceLabel}`,
            });
          }
        } else if (vals.every((v) => typeof v === 'string')) {
          const counts = new Map<string, number>();
          for (const v of vals) {
            const s = (v as string).trim();
            if (s.length > 0 && s.length <= 24) {
              counts.set(s, (counts.get(s) ?? 0) + 1);
            }
          }
          if (counts.size >= 2 && counts.size <= Math.min(8, Math.ceil(n * 0.75))) {
            for (const [catVal, count] of counts) {
              if (count <= 0 || count >= n) continue;
              const p = count / n;
              const std = Math.sqrt(p * (1 - p));
              const raw = new Float64Array(n);
              const z = new Float64Array(n);
              const effW = 0.65 * Math.sqrt(4 * p * (1 - p) + 0.25);
              for (let i = 0; i < n; i++) {
                const hit = (vals[i] as string).trim() === catVal ? 1 : 0;
                raw[i] = hit;
                z[i] = ((hit - p) / std) * effW;
              }
              axes.push({
                familyKey: `auto-s:${key}:${catVal}`,
                values: z,
                rawValues: raw,
                rawMean: p,
                rawStd: std,
                weight: effW,
                kind: 'categorical',
                highLabel: catVal,
              });
            }
          }
        } else if (
          axes.length === 0 &&
          vals.every(
            (v) =>
              Array.isArray(v) &&
              v.length >= 2 &&
              v.length <= 64 &&
              typeof v[0] === 'number',
          )
        ) {
          const arrs = vals as readonly (readonly number[])[];
          const dim = arrs[0]!.length;
          const vScale = 1 / Math.sqrt(dim);
          for (let d = 0; d < dim; d++) {
            const raw = new Float64Array(n);
            let sum = 0;
            for (let i = 0; i < n; i++) {
              raw[i] = arrs[i]![d] ?? 0;
              sum += raw[i]!;
            }
            const mean = sum / n;
            let sq = 0;
            for (let i = 0; i < n; i++) {
              const diff = raw[i]! - mean;
              sq += diff * diff;
            }
            const std = Math.sqrt(sq / n);
            if (std <= 1e-6) continue;
            const z = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              z[i] = ((raw[i]! - mean) / std) * vScale;
            }
            axes.push({
              familyKey: `auto-v:${key}:${d}`,
              values: z,
              rawValues: raw,
              rawMean: mean,
              rawStd: std,
              weight: vScale,
              kind: 'vector',
              highLabel: `${niceLabel} ${d + 1}+`,
              lowLabel: `${niceLabel} ${d + 1}−`,
            });
          }
        }
      }
    }
  }

  return axes;
}

function assignDistinctPrototypeLabels<TItem, TTagMeta>(params: {
  readonly prototypes: ReadonlyArray<{
    readonly centroid: Float64Array;
    readonly memberIndices: readonly number[];
  }>;
  readonly axes: readonly LocalSubspaceAxis[];
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly getItemLabel?: (item: TItem) => string;
}): readonly string[] {
  const { prototypes, axes, coveredItems, getItemLabel } = params;
  const k = prototypes.length;
  const m = axes.length;
  const assigned = new Array<string>(k).fill('');
  const usedLabels = new Set<string>();

  interface CandidateLabel {
    readonly protoIdx: number;
    readonly label: string;
    readonly familyKey: string;
    readonly score: number;
  }

  const perProtoCandidates: CandidateLabel[][] = Array.from(
    { length: k },
    () => [],
  );

  for (let pIdx = 0; pIdx < k; pIdx++) {
    const proto = prototypes[pIdx]!;
    const members = proto.memberIndices;

    for (let aIdx = 0; aIdx < m; aIdx++) {
      const axis = axes[aIdx]!;
      if (axis.kind === 'vector') continue;

      let rawClusterMean: number;
      let zMean: number;
      if (members.length > 0) {
        let rSum = 0;
        let zSum = 0;
        for (const i of members) {
          rSum += axis.rawValues[i]!;
          zSum += axis.values[i]!;
        }
        rawClusterMean = rSum / members.length;
        zMean = zSum / (members.length * Math.max(0.1, axis.weight));
      } else {
        zMean = proto.centroid[aIdx]! / Math.max(0.1, axis.weight);
        rawClusterMean = axis.rawMean + zMean * axis.rawStd;
      }

      if (axis.kind === 'categorical') {
        if (rawClusterMean >= Math.max(0.34, axis.rawMean + 0.12)) {
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: axis.highLabel,
            familyKey: axis.familyKey,
            score: zMean * axis.weight + rawClusterMean * 0.65,
          });
        }
      } else if (axis.kind === 'boolean') {
        if (rawClusterMean >= Math.max(0.45, axis.rawMean + 0.12)) {
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: axis.highLabel,
            familyKey: axis.familyKey,
            score: zMean * axis.weight + rawClusterMean * 0.45,
          });
        } else if (
          axis.lowLabel &&
          rawClusterMean <= Math.min(0.55, axis.rawMean - 0.12)
        ) {
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: axis.lowLabel,
            familyKey: `${axis.familyKey}:low`,
            score: -zMean * axis.weight + (1 - rawClusterMean) * 0.45,
          });
        }
      } else if (axis.kind === 'numeric') {
        if (Math.abs(zMean) >= 0.22) {
          const customFormatted = axis.formatMean
            ? axis.formatMean(rawClusterMean, axis.rawMean)
            : undefined;
          const lbl =
            customFormatted ??
            (zMean >= 0
              ? axis.highLabel
              : (axis.lowLabel ?? axis.highLabel));
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: lbl,
            familyKey: `${axis.familyKey}:${zMean >= 0 ? 'hi' : 'lo'}`,
            score: Math.abs(zMean) * axis.weight,
          });
        }
      } else if (axis.kind === 'similarity' && zMean >= 0.25) {
        perProtoCandidates[pIdx]!.push({
          protoIdx: pIdx,
          label: axis.highLabel,
          familyKey: axis.familyKey,
          score: zMean * axis.weight * 0.85,
        });
      }
    }

    perProtoCandidates[pIdx]!.sort(
      (a, b) => b.score - a.score || a.label.localeCompare(b.label),
    );
  }

  // Greedy maximum-contrast assignment ensuring every sub-cluster receives a distinct label
  const flatCandidates = perProtoCandidates
    .flat()
    .sort((a, b) => b.score - a.score || a.protoIdx - b.protoIdx);

  for (const cand of flatCandidates) {
    if (assigned[cand.protoIdx]) continue;
    const normKey = cand.label.toLowerCase();
    if (usedLabels.has(normKey)) continue;
    assigned[cand.protoIdx] = cand.label;
    usedLabels.add(normKey);
  }

  // Second pass: combine top-2 orthogonal traits (e.g. "Large · Predator") or medoid exemplar title
  for (let pIdx = 0; pIdx < k; pIdx++) {
    if (assigned[pIdx]) continue;
    const cands = perProtoCandidates[pIdx]!;
    if (cands.length >= 2) {
      const cA = cands[0]!;
      const cB = cands.find((c) => c.familyKey !== cA.familyKey && c.label !== cA.label);
      if (cB) {
        const combo = `${cA.label.slice(0, 9)} · ${cB.label.slice(0, 9)}`;
        if (!usedLabels.has(combo.toLowerCase())) {
          assigned[pIdx] = combo;
          usedLabels.add(combo.toLowerCase());
          continue;
        }
      }
    }

    // Closest member to prototype centroid as concrete exemplar label
    const proto = prototypes[pIdx]!;
    let bestItemIdx = proto.memberIndices[0] ?? pIdx % coveredItems.length;
    let bestDistSq = Infinity;
    for (const idx of proto.memberIndices) {
      let dSq = 0;
      for (let a = 0; a < m; a++) {
        const diff = axes[a]!.values[idx]! - proto.centroid[a]!;
        dSq += diff * diff;
      }
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestItemIdx = idx;
      }
    }
    const exItem = coveredItems[bestItemIdx]!;
    let fallback = extractFallbackItemTitle(exItem.item, exItem.id, getItemLabel);
    if (usedLabels.has(fallback.toLowerCase())) {
      fallback = `${fallback.slice(0, 13)} #${pIdx + 1}`;
    }
    assigned[pIdx] = fallback;
    usedLabels.add(fallback.toLowerCase());
  }

  return assigned;
}

function clusterItemsInLocalSubspace<TItem, TTagMeta>(params: {
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly axes: readonly LocalSubspaceAxis[];
  readonly localBary: ReadonlyArray<{
    readonly l0: number;
    readonly l1: number;
    readonly l2: number;
  }>;
  readonly targetK: number;
  readonly getItemLabel?: (item: TItem) => string;
}): readonly SubspacePrototype[] {
  const { coveredItems, axes, localBary, targetK, getItemLabel } = params;
  const n = coveredItems.length;
  const m = axes.length;

  const points: Float64Array[] = Array.from({ length: n }, (_, i) => {
    const vec = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      vec[a] = axes[a]!.values[i]!;
    }
    return vec;
  });

  const distSq = (u: Float64Array, v: Float64Array): number => {
    let s = 0;
    for (let d = 0; d < m; d++) {
      const diff = u[d]! - v[d]!;
      s += diff * diff;
    }
    return s;
  };

  // Seed deterministic farthest-first k-Means++ starting from item furthest from local origin (0..0)
  const centroids: Float64Array[] = [];
  let firstIdx = 0;
  let maxNormSq = -1;
  for (let i = 0; i < n; i++) {
    let normSq = 0;
    for (let d = 0; d < m; d++) normSq += points[i]![d]! * points[i]![d]!;
    if (normSq > maxNormSq + 1e-9) {
      maxNormSq = normSq;
      firstIdx = i;
    }
  }
  centroids.push(new Float64Array(points[firstIdx]!));

  while (centroids.length < targetK) {
    let bestIdx = -1;
    let bestMinD = -1;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const b = localBary[i]!;
        const spatialTie =
          0.02 *
          ((b.l0 - 1 / 3) * (b.l0 - 1 / 3) +
            (b.l1 - 1 / 3) * (b.l1 - 1 / 3) +
            (b.l2 - 1 / 3) * (b.l2 - 1 / 3));
        const d = distSq(points[i]!, centroids[c]!) + spatialTie;
        if (d < minD) minD = d;
      }
      if (minD > bestMinD + 1e-9) {
        bestMinD = minD;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestMinD <= 1e-6) break;
    centroids.push(new Float64Array(points[bestIdx]!));
  }

  // If fewer than targetK distinct feature vectors exist, synthesize midpoint bridge prototypes
  // between the most distant pair of existing centroids so all sub-mesh vertices participate cleanly.
  while (centroids.length < targetK && centroids.length >= 2) {
    let bestPair: [number, number] = [0, 1];
    let bestPairD = -1;
    for (let a = 0; a < centroids.length; a++) {
      for (let b = a + 1; b < centroids.length; b++) {
        const mid = new Float64Array(m);
        for (let d = 0; d < m; d++) {
          mid[d] = 0.5 * (centroids[a]![d]! + centroids[b]![d]!);
        }
        let minToExisting = Infinity;
        for (const ex of centroids) {
          const de = distSq(mid, ex);
          if (de < minToExisting) minToExisting = de;
        }
        if (minToExisting > bestPairD) {
          bestPairD = minToExisting;
          bestPair = [a, b];
        }
      }
    }
    if (bestPairD <= 1e-7) break;
    const mid = new Float64Array(m);
    for (let d = 0; d < m; d++) {
      mid[d] = 0.5 * (centroids[bestPair[0]]![d]! + centroids[bestPair[1]]![d]!);
    }
    centroids.push(mid);
  }

  const kActual = centroids.length;
  const assignments = new Int32Array(n);

  // Lloyd refinement with gentle load regularization so single outliers don't starve sibling clusters
  for (let iter = 0; iter < 10; iter++) {
    const counts = new Int32Array(kActual);
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestCost = Infinity;
      for (let c = 0; c < kActual; c++) {
        const cost = distSq(points[i]!, centroids[c]!) + counts[c]! * 0.035;
        if (cost < bestCost) {
          bestCost = cost;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) changed = true;
      assignments[i] = bestC;
      counts[bestC] = (counts[bestC] ?? 0) + 1;
    }
    if (!changed && iter > 0) break;

    for (let c = 0; c < kActual; c++) {
      if (counts[c]! === 0) continue;
      const next = new Float64Array(m);
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) {
          for (let d = 0; d < m; d++) next[d] = next[d]! + points[i]![d]!;
        }
      }
      for (let d = 0; d < m; d++) next[d] = next[d]! / counts[c]!;
      centroids[c] = next;
    }
  }

  const rawProtos = centroids.map((cent, cIdx) => {
    const memberIndices: number[] = [];
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      if (assignments[i] === cIdx) {
        memberIndices.push(i);
        s0 += localBary[i]!.l0;
        s1 += localBary[i]!.l1;
        s2 += localBary[i]!.l2;
      }
    }
    const cnt = memberIndices.length;
    return {
      centroid: cent,
      memberIndices,
      meanL0: cnt > 0 ? s0 / cnt : 1 / 3,
      meanL1: cnt > 0 ? s1 / cnt : 1 / 3,
      meanL2: cnt > 0 ? s2 / cnt : 1 / 3,
    };
  });

  const labels = assignDistinctPrototypeLabels({
    prototypes: rawProtos,
    axes,
    coveredItems,
    getItemLabel,
  });

  return rawProtos.map((p, idx) => ({
    ...p,
    label: labels[idx]!,
  }));
}

const SIX_VERTEX_EDGES: readonly (readonly [number, number])[] = [
  [0, 3],
  [3, 1],
  [1, 4],
  [4, 2],
  [2, 5],
  [5, 0],
  [3, 4],
  [4, 5],
  [5, 3],
];

/**
 * Solves exact global optimum over all `6! = 720` bijections mapping 6 local subspace
 * prototypes onto the 6 vertices `[V0, V1, V2, M01, M12, M20]` of the `1:4` subdivided mesh.
 */
function alignSixPrototypesToSubMesh(
  prototypes: readonly SubspacePrototype[],
  totalItems: number,
): readonly SubspacePrototype[] {
  const m = prototypes[0]?.centroid.length ?? 0;
  // Pad to 6 if fewer than 6 prototypes were synthesized
  const padded: SubspacePrototype[] = [...prototypes];
  while (padded.length < 6) {
    const src = padded[padded.length % prototypes.length]!;
    padded.push({
      ...src,
      memberIndices: [],
      label: `${src.label} · ${padded.length + 1}`,
    });
  }

  // Pairwise cosine similarity between prototypes for QAP edge coherence
  const sim: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let a = 0; a < 6; a++) {
    for (let b = a + 1; b < 6; b++) {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let d = 0; d < m; d++) {
        const ua = padded[a]!.centroid[d]!;
        const ub = padded[b]!.centroid[d]!;
        dot += ua * ub;
        na += ua * ua;
        nb += ub * ub;
      }
      const cos =
        na > 1e-9 && nb > 1e-9 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
      sim[a]![b] = cos;
      sim[b]![a] = cos;
    }
  }

  // Precompute unary placement cost of prototype `p` on mesh vertex `v`
  const unaryCost: number[][] = Array.from({ length: 6 }, (_, pIdx) => {
    const p = padded[pIdx]!;
    const loadFrac = p.memberIndices.length / Math.max(1, totalItems);
    return SUB_MESH_VERTEX_BARY.map((vb, vIdx) => {
      const geoSq =
        (p.meanL0 - vb[0]) * (p.meanL0 - vb[0]) +
        (p.meanL1 - vb[1]) * (p.meanL1 - vb[1]) +
        (p.meanL2 - vb[2]) * (p.meanL2 - vb[2]);
      // Interior midpoints (3, 4, 5) have degree 4 (bordering 3 sub-triangles vs 1 for corners)
      const degreeBonus = vIdx >= 3 ? loadFrac * 0.32 : 0;
      return geoSq * 0.85 - degreeBonus;
    });
  });

  const bestPerm = [0, 1, 2, 3, 4, 5];
  let bestScore = Infinity;
  const cur = [0, 1, 2, 3, 4, 5];
  const used = new Uint8Array(6);

  const search = (depth: number, partialUnary: number): void => {
    if (depth === 6) {
      let edgeBonus = 0;
      for (const [va, vb] of SIX_VERTEX_EDGES) {
        edgeBonus += sim[cur[va]!]![cur[vb]!]! * 0.14;
      }
      const totalCost = partialUnary - edgeBonus;
      if (totalCost < bestScore) {
        bestScore = totalCost;
        for (let i = 0; i < 6; i++) bestPerm[i] = cur[i]!;
      }
      return;
    }
    for (let p = 0; p < 6; p++) {
      if (used[p]) continue;
      used[p] = 1;
      cur[depth] = p;
      search(depth + 1, partialUnary + unaryCost[p]![depth]!);
      used[p] = 0;
    }
  };

  search(0, 0);
  return bestPerm.map((pIdx) => padded[pIdx]!);
}

function buildSubspaceSpotlightFrame<TItem, TTagMeta, TClusterMeta>(params: {
  readonly frameId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly accentHex: string;
  readonly breadcrumbSegments?: readonly ZoomBreadcrumbSegment[];
  readonly parentContextLabel?: string;
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly baseRootWeights: ReadonlyMap<number, number>;
  readonly parentDepth: number;
  readonly options?: SubspaceZoomStrategyOptions<TItem>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
  readonly neighbors: readonly ZoomNeighborTarget[];
  readonly sourceTrianglePoints?: readonly [Point2D, Point2D, Point2D];
  readonly innerPadding?: number;
  readonly meshOrientation?: 'horizontal' | 'vertical';
  readonly sourceCenter?: Point2D;
  readonly sourceSpan?: number;
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
}): ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> {
  const {
    frameId,
    label,
    shortLabel,
    accentHex,
    breadcrumbSegments,
    parentContextLabel,
    coveredItems,
    baseRootWeights,
    parentDepth,
    options,
    helpers,
    neighbors,
    sourceTrianglePoints,
    innerPadding,
    meshOrientation,
    sourceCenter,
    sourceSpan,
    contextTriangles,
    contextEdges,
    contextClusters,
    contextItems,
  } = params;

  const axes = buildLocalSubspaceAxes({
    coveredItems,
    depth: parentDepth,
    kind: 'cluster-spotlight',
    options,
    helpers,
  });

  if (axes.length === 0 || coveredItems.length < 2) {
    return buildSectorPartitionFrame({
      frameId,
      label,
      shortLabel,
      accentHex,
      breadcrumbSegments,
      parentContextLabel,
      getItemLabel: options?.getItemLabel,
      coveredItems,
      baseRootWeights,
      helpers,
      neighbors,
      sourceTrianglePoints,
      innerPadding,
      meshOrientation,
      sourceCenter,
      sourceSpan,
      contextTriangles,
      contextEdges,
      contextClusters,
      contextItems,
    });
  }

  const { mesh, transform } = buildOrientedSingleTriangleMeshWithTransform({
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    innerPadding: innerPadding ?? helpers.innerPadding,
    sourceTrianglePoints,
    orientation: meshOrientation ?? 'horizontal',
    sourceCenter,
    sourceSpan,
  });

  const parentToFrameTransform: ZoomAffineTransform = {
    scale: transform.scale,
    sourceCx: transform.sourceCx,
    sourceCy: transform.sourceCy,
    targetCx: transform.targetCx,
    targetCy: transform.targetCy,
  };

  const uniformBary = coveredItems.map(() => ({
    l0: 1 / 3,
    l1: 1 / 3,
    l2: 1 / 3,
  }));
  const rawProtos = clusterItemsInLocalSubspace({
    coveredItems,
    axes,
    localBary: uniformBary,
    targetK: 3,
    getItemLabel: options?.getItemLabel,
  });

  const protos: SubspacePrototype[] = [...rawProtos];
  while (protos.length < 3) {
    const base = protos[protos.length % rawProtos.length]!;
    protos.push({
      ...base,
      memberIndices: [],
      label: `${base.label} · ${protos.length + 1}`,
    });
  }

  const baseLab = mixOklabColors(
    [...baseRootWeights.entries()].map(([idx, w]) => ({
      oklab: helpers.rootClusters[idx]!.oklab,
      weight: w,
    })),
  ).oklab;

  const spotLabs: readonly OklabTuple[] = [
    [
      Math.min(0.84, baseLab[0] + 0.045),
      baseLab[1] * 1.04 + 0.032,
      baseLab[2] * 0.94 - 0.022,
    ],
    [
      Math.max(0.54, baseLab[0] - 0.035),
      baseLab[1] * 0.94 - 0.028,
      baseLab[2] * 1.05 + 0.03,
    ],
    [
      baseLab[0] + 0.01,
      baseLab[1] * 0.96 - 0.012,
      baseLab[2] * 0.95 - 0.032,
    ],
  ];

  const m = axes.length;
  const vertexMembers = Array.from(
    { length: 3 },
    () =>
      new Map<
        string,
        {
          readonly item: TItem;
          readonly weight: number;
          readonly coverage: number;
          readonly isExclusive: boolean;
        }
      >(),
  );

  const nextItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map(
    (it, itemIdx) => {
      const dists = [0, 1, 2].map((s) => {
        let dSq = 0;
        for (let a = 0; a < m; a++) {
          const diff = axes[a]!.values[itemIdx]! - protos[s]!.centroid[a]!;
          dSq += diff * diff;
        }
        return Math.sqrt(dSq);
      });
      const minD = Math.min(...dists);
      const scaleD = Math.max(0.35, (dists[0]! + dists[1]! + dists[2]!) / 3);
      const rawW = dists.map((d) =>
        Math.exp(-((d - minD) / (scaleD * 0.72)) * 1.55) + 0.08,
      );
      const sumW = rawW[0]! + rawW[1]! + rawW[2]! || 1;
      const unitWeights = [0, 1, 2].map((s) => ({
        clusterIndex: s,
        weight: rawW[s]! / sumW,
        coverage: rawW[s]! / sumW,
      }));

      let anchorX = 0;
      let anchorY = 0;
      for (const uw of unitWeights) {
        const vp = mesh.vertices[uw.clusterIndex]!;
        anchorX += vp.x * uw.weight;
        anchorY += vp.y * uw.weight;
        vertexMembers[uw.clusterIndex]!.set(it.id, {
          item: it.item,
          weight: uw.weight,
          coverage: uw.coverage,
          isExclusive: false,
        });
      }

      const itemCol = mixOklabColors(
        unitWeights.map((uw) => ({
          oklab: spotLabs[uw.clusterIndex]!,
          weight: uw.weight,
        })),
      );

      return {
        ...it,
        anchorX,
        anchorY,
        unitWeights,
        mixedColorHex: itemCol.hex,
        mixedOklab: itemCol.oklab,
      };
    },
  );

  const mixWeights = buildMixWeights(baseRootWeights, helpers.rootClusters);
  const baseFmt = formatMixLabel(baseRootWeights, helpers.rootClusters);
  const codePrefix = baseFmt.code.length <= 5 ? `${baseFmt.code}·` : '';
  const effectiveParentContext =
    parentContextLabel ?? truncateClean(baseFmt.label, 18);

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = [0, 1, 2].map(
    (s) => {
      const lab = spotLabs[s]!;
      const hex = mixOklabColors([{ oklab: lab, weight: 1 }]).hex;
      const subLabel = protos[s]!.label;
      const members = [...vertexMembers[s]!.entries()].map(([itemId, rec]) => ({
        item: rec.item,
        itemId,
        coverage: rec.coverage,
        normalizedWeight: rec.weight,
        isExclusiveVertexMember: rec.isExclusive,
      }));
      return buildSynthesizedClusterDescriptor({
        clusterIndex: s,
        clusterUid: helpers.allocateClusterUid(),
        code: `${codePrefix}S${s + 1}`,
        defaultLabel: subLabel,
        oklab: lab,
        hex,
        vertex: mesh.vertices[s]!,
        coreTags: [],
        sharedTags: [],
        members,
        featureSummary: `Subspace cluster (${subLabel})`,
        role: 'intermediate',
        mixWeights,
        subclusterLabel: subLabel,
        parentContextLabel: effectiveParentContext,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    },
  );

  return {
    frameId,
    kind: 'cluster-spotlight',
    label,
    shortLabel,
    accentHex,
    breadcrumbSegments,
    mesh,
    clusters,
    items: nextItems,
    neighbors,
    parentToFrameTransform,
    contextTriangles,
    contextEdges,
    contextClusters,
    contextItems,
    strategyData: {
      kind: 'cluster-spotlight',
      vertexWeights: [0, 1, 2].map(() => ({ rootWeights: baseRootWeights })),
    } satisfies InternalFrameMeta,
  };
}

/**
 * Local subspace re-clustering & facet lens zoom strategy (`mode: 'drill-down'`):
 *
 * - Projects out features that are locally constant inside the focused triangle/cluster
 *   (zero intra-subset variance, such as `milk = true` inside *Mammals* or `species = Gentoo`)
 *   and re-clusters covered items over the highest-variance local features, facets, embeddings,
 *   or similarity kernels (`requiresTags: false`, with automatic zero-config introspection).
 * - Aligns up to 6 local prototypes onto the `1:4` equilateral sub-mesh via exact `6! = 720`
 *   spatial + QAP permutation optimization, labeling each sub-vertex with its strongest
 *   distinguishing attribute (`subclusterLabel`).
 * - Replaces arbitrary `Sector A / B / C` cluster spotlights with a genuine 3-way local
 *   subspace partition while strictly guaranteeing leaf termination (`0` infinite drill loops).
 */
export function createSubspaceZoomStrategy<
  TItem = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  options?: SubspaceZoomStrategyOptions<TItem>,
): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
  const clusterZoomMode = options?.clusterZoomMode ?? 'incident-star';
  const stopWhenFullScale = options?.stopWhenFullScale ?? true;
  const fullScaleThreshold = options?.fullScaleThreshold ?? DEFAULT_FULL_SCALE_THRESHOLD;
  const leafTriangleFocus = options?.leafTriangleFocus ?? true;
  const allowClusterDrill = clusterZoomMode !== 'none';

  const baseBarycentric = createBarycentricZoomStrategy<
    TItem,
    TTagMeta,
    TClusterMeta
  >({
    clusterZoomMode,
    adaptiveContrastStretch: true,
    enableSectorFallback: true,
    stopWhenFullScale,
    fullScaleThreshold,
    leafTriangleFocus,
  });

  const drillTriangleSubspace = (
    ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null => {
    const { triangleIndex, parentFrame, itemScaleRatios, helpers } = ctx;
    const tri = parentFrame.mesh.triangles[triangleIndex];
    if (!tri) return null;

    if (ctx.parentDepth >= MAX_ZOOM_DRILL_DEPTH) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    const [v0, v1, v2] = tri.vertices;
    const vSet = new Set<number>([v0, v1, v2]);
    const coveredItems = parentFrame.items.filter((it) =>
      isItemCoveredByVertices(parentFrame, it, vSet),
    );
    if (coveredItems.length <= 1) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    if (stopWhenFullScale) {
      const stats = computeFullScaleStats(
        coveredItems.map((it) => it.id),
        itemScaleRatios,
        fullScaleThreshold,
      );
      if (!stats.hasUnderScaled) {
        return leafTriangleFocus
          ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
          : null;
      }
    }

    const c0 = parentFrame.clusters[v0];
    const c1 = parentFrame.clusters[v1];
    const c2 = parentFrame.clusters[v2];
    const p0 = parentFrame.mesh.vertices[v0]!;
    const p1 = parentFrame.mesh.vertices[v1]!;
    const p2 = parentFrame.mesh.vertices[v2]!;

    const w0Base = getFrameVertexRootWeights(parentFrame, v0);
    const w1Base = getFrameVertexRootWeights(parentFrame, v1);
    const w2Base = getFrameVertexRootWeights(parentFrame, v2);

    const localBary = coveredItems.map((it) => {
      const rw = getItemRootWeights(parentFrame, it);
      const proj = projectRootWeightsOntoTriangleCorners(
        rw,
        w0Base,
        w1Base,
        w2Base,
      );
      if (proj) {
        return { rootWeights: rw, l0: proj.l0, l1: proj.l1, l2: proj.l2 };
      }
      let l0 = 0;
      let l1 = 0;
      let l2 = 0;
      for (const uw of it.unitWeights) {
        if (uw.clusterIndex === v0) l0 += uw.weight;
        else if (uw.clusterIndex === v1) l1 += uw.weight;
        else if (uw.clusterIndex === v2) l2 += uw.weight;
      }
      const s = l0 + l1 + l2 || 1;
      return { rootWeights: rw, l0: l0 / s, l1: l1 / s, l2: l2 / s };
    });

    const hasSurroundingContext =
      parentFrame.mesh.triangles.length > 1 ||
      (parentFrame.contextTriangles?.length ?? 0) > 0;
    const focusPadding = computeContextAwarePadding(
      helpers.viewportWidth,
      helpers.viewportHeight,
      helpers.innerPadding,
      hasSurroundingContext,
    );
    const { mesh: subMesh, transform } = buildSubdividedTriangleMeshWithTransform(
      p0,
      p1,
      p2,
      helpers.viewportWidth,
      helpers.viewportHeight,
      focusPadding,
      parentFrame.mesh.orientation,
    );
    const neighbors = evaluateTriangleFrameNeighbors(
      parentFrame,
      triangleIndex,
      subMesh,
    );
    const context = buildNeighborhoodContext({
      parentFrame,
      excludedTriangleIndices: new Set([triangleIndex]),
      excludedVertexIndices: vSet,
      activeParentEdgeKeys: new Set([
        pairEdgeKey(v0, v1),
        pairEdgeKey(v1, v2),
        pairEdgeKey(v2, v0),
      ]),
      activeItemIds: new Set(coveredItems.map((it) => it.id)),
      parentSettledItems: helpers.parentSettledItems,
      transform,
      viewportWidth: helpers.viewportWidth,
      viewportHeight: helpers.viewportHeight,
      allowClusterDrill: clusterZoomMode !== 'none',
    });

    const triCodes = [
      c0?.code ?? defaultClusterCode(v0),
      c1?.code ?? defaultClusterCode(v1),
      c2?.code ?? defaultClusterCode(v2),
    ];
    const triCrumb = buildTriangleBreadcrumbInfo([c0, c1, c2], triCodes);
    const triMixed = mixOklabColors(
      [c0, c1, c2]
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );

    const axes = buildLocalSubspaceAxes({
      coveredItems,
      depth: ctx.parentDepth,
      kind: 'triangle',
      options,
      helpers,
    });

    // For tiny subsets (< 4 items) or zero subspace variance, use 3-way spotlight or barycentric fallback
    if (axes.length === 0 || coveredItems.length <= 3) {
      if (axes.length > 0) {
        const meanWeights =
          localBary[0]?.rootWeights ?? mixRootWeightMaps(w0Base, 1, w1Base, 0);
        return {
          nextFrame: buildSubspaceSpotlightFrame({
            frameId: `sub-spot-${parentFrame.frameId}-t${triangleIndex}`,
            label: triCrumb.label,
            shortLabel: triCrumb.shortLabel,
            accentHex: triMixed.hex,
            breadcrumbSegments: triCrumb.segments,
            parentContextLabel: truncateClean(triCrumb.shortLabel, 20),
            coveredItems,
            baseRootWeights: meanWeights,
            parentDepth: ctx.parentDepth,
            options,
            helpers,
            neighbors,
            sourceTrianglePoints: [p0, p1, p2],
            innerPadding: focusPadding,
            meshOrientation: parentFrame.mesh.orientation,
            contextTriangles: context.contextTriangles,
            contextEdges: context.contextEdges,
            contextClusters: context.contextClusters,
            contextItems: context.contextItems,
          }),
        };
      }
      return baseBarycentric.drillIntoTriangle!(ctx);
    }

    const rawProtos = clusterItemsInLocalSubspace({
      coveredItems,
      axes,
      localBary,
      targetK: Math.min(6, coveredItems.length),
      getItemLabel: options?.getItemLabel,
    });

    if (rawProtos.length < 3) {
      const meanWeights =
        localBary[0]?.rootWeights ?? mixRootWeightMaps(w0Base, 1, w1Base, 0);
      return {
        nextFrame: buildSubspaceSpotlightFrame({
          frameId: `sub-spot-${parentFrame.frameId}-t${triangleIndex}`,
          label: triCrumb.label,
          shortLabel: triCrumb.shortLabel,
          accentHex: triMixed.hex,
          breadcrumbSegments: triCrumb.segments,
          parentContextLabel: truncateClean(triCrumb.shortLabel, 20),
          coveredItems,
          baseRootWeights: meanWeights,
          parentDepth: ctx.parentDepth,
          options,
          helpers,
          neighbors,
          sourceTrianglePoints: [p0, p1, p2],
          innerPadding: focusPadding,
          meshOrientation: parentFrame.mesh.orientation,
          contextTriangles: context.contextTriangles,
          contextEdges: context.contextEdges,
          contextClusters: context.contextClusters,
          contextItems: context.contextItems,
        }),
      };
    }

    const alignedProtos = alignSixPrototypesToSubMesh(
      rawProtos,
      coveredItems.length,
    );
    const m = axes.length;

    // Assign each item to its best-fitting planar sub-triangle among the 4 congruent faces
    const faceCounts = [0, 0, 0, 0];
    const itemAssignments = coveredItems.map((_, itemIdx) => {
      const b = localBary[itemIdx]!;
      const dists = alignedProtos.map((proto, vIdx) => {
        let dSq = 0;
        for (let a = 0; a < m; a++) {
          const diff = axes[a]!.values[itemIdx]! - proto.centroid[a]!;
          dSq += diff * diff;
        }
        const vb = SUB_MESH_VERTEX_BARY[vIdx]!;
        const spatialPrior =
          0.08 *
          ((b.l0 - vb[0]) * (b.l0 - vb[0]) +
            (b.l1 - vb[1]) * (b.l1 - vb[1]) +
            (b.l2 - vb[2]) * (b.l2 - vb[2]));
        return Math.sqrt(dSq + spatialPrior);
      });

      const minD = Math.min(...dists);
      const meanD =
        dists.reduce((acc, d) => acc + d, 0) / Math.max(1, dists.length);
      const kernelBandwidth = Math.max(0.32, meanD * 0.68);
      const vAff = dists.map(
        (d) => Math.exp(-((d - minD) / kernelBandwidth) * 1.65) + 0.03,
      );

      let bestFaceIdx = 0;
      let bestFaceScore = -Infinity;
      for (let fIdx = 0; fIdx < subMesh.triangles.length; fIdx++) {
        const [va, vb, vc] = subMesh.triangles[fIdx]!.vertices;
        const maxCornerAff = Math.max(vAff[va]!, vAff[vb]!, vAff[vc]!);
        const sumFaceAff = vAff[va]! + vAff[vb]! + vAff[vc]!;
        const crowdPenalty = 1 + 0.12 * (faceCounts[fIdx] ?? 0);
        const score = (0.58 * sumFaceAff + 0.42 * maxCornerAff) / crowdPenalty;
        if (score > bestFaceScore) {
          bestFaceScore = score;
          bestFaceIdx = fIdx;
        }
      }

      faceCounts[bestFaceIdx] = (faceCounts[bestFaceIdx] ?? 0) + 1;
      const [va, vb, vc] = subMesh.triangles[bestFaceIdx]!.vertices;
      const rawTriW = [vAff[va]!, vAff[vb]!, vAff[vc]!];
      const sumTriW = rawTriW[0]! + rawTriW[1]! + rawTriW[2]! || 1;
      // Gentle soft-simplex interior spread (84% prototype pull + 16% barycenter cushion)
      const unitWeights = [va, vb, vc].map((vIdx, pos) => {
        const w = 0.84 * (rawTriW[pos]! / sumTriW) + 0.16 * (1 / 3);
        return {
          clusterIndex: vIdx,
          weight: w,
          coverage: w,
        };
      });
      return { faceIndex: bestFaceIdx, unitWeights };
    });

    const maxFaceCount = Math.max(...faceCounts);
    // Strict anti-loop guarantee: if every item still landed in a single sub-triangle,
    // emit a 3-way local subspace spotlight frame so item counts strictly shrink.
    if (maxFaceCount >= coveredItems.length) {
      const meanWeights =
        localBary[0]?.rootWeights ?? mixRootWeightMaps(w0Base, 1, w1Base, 0);
      return {
        nextFrame: buildSubspaceSpotlightFrame({
          frameId: `sub-spot-${parentFrame.frameId}-t${triangleIndex}`,
          label: triCrumb.label,
          shortLabel: triCrumb.shortLabel,
          accentHex: triMixed.hex,
          breadcrumbSegments: triCrumb.segments,
          parentContextLabel: truncateClean(triCrumb.shortLabel, 20),
          coveredItems,
          baseRootWeights: meanWeights,
          parentDepth: ctx.parentDepth,
          options,
          helpers,
          neighbors,
          sourceTrianglePoints: [p0, p1, p2],
          innerPadding: focusPadding,
          meshOrientation: parentFrame.mesh.orientation,
          contextTriangles: context.contextTriangles,
          contextEdges: context.contextEdges,
          contextClusters: context.contextClusters,
          contextItems: context.contextItems,
        }),
      };
    }

    const vWeights: ReadonlyMap<number, number>[] = [
      w0Base,
      w1Base,
      w2Base,
      mixRootWeightMaps(w0Base, 0.5, w1Base, 0.5),
      mixRootWeightMaps(w1Base, 0.5, w2Base, 0.5),
      mixRootWeightMaps(w2Base, 0.5, w0Base, 0.5),
    ];

    const vertexColors = vWeights.map((vw, vIdx) => {
      if (vIdx < 3) {
        const corner = [c0, c1, c2][vIdx];
        if (corner) return { hex: corner.colorHex, oklab: corner.oklab };
      }
      return mixOklabColors(
        [...vw.entries()].map(([rIdx, rw]) => ({
          oklab: helpers.rootClusters[rIdx]!.oklab,
          weight: rw,
        })),
      );
    });

    const vertexMembers = Array.from(
      { length: 6 },
      () =>
        new Map<
          string,
          {
            readonly item: TItem;
            readonly weight: number;
            readonly coverage: number;
            readonly isExclusive: boolean;
          }
        >(),
    );

    const subItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map(
      (it, idx) => {
        const assign = itemAssignments[idx]!;
        let anchorX = 0;
        let anchorY = 0;
        for (const uw of assign.unitWeights) {
          const vp = subMesh.vertices[uw.clusterIndex]!;
          anchorX += vp.x * uw.weight;
          anchorY += vp.y * uw.weight;
          vertexMembers[uw.clusterIndex]!.set(it.id, {
            item: it.item,
            weight: uw.weight,
            coverage: uw.coverage,
            isExclusive: assign.unitWeights.length === 1,
          });
        }
        const itemMix = mixOklabColors(
          assign.unitWeights.map((uw) => ({
            oklab: vertexColors[uw.clusterIndex]!.oklab,
            weight: uw.weight,
          })),
        );
        return {
          ...it,
          anchorX,
          anchorY,
          unitWeights: assign.unitWeights,
          mixedColorHex: itemMix.hex,
          mixedOklab: itemMix.oklab,
        };
      },
    );

    const parentCorners = [c0, c1, c2];
    const subClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] =
      vWeights.map((vw, vIdx) => {
        const vert = subMesh.vertices[vIdx]!;
        const parentCorner = vIdx < 3 ? parentCorners[vIdx] : undefined;
        const vCol = vertexColors[vIdx]!;
        const proto = alignedProtos[vIdx]!;
        const fmt = formatMixLabel(vw, helpers.rootClusters);
        const mixWeights = buildMixWeights(vw, helpers.rootClusters);
        const members = [...vertexMembers[vIdx]!.entries()].map(
          ([itemId, rec]) => ({
            item: rec.item,
            itemId,
            coverage: rec.coverage,
            normalizedWeight: rec.weight,
            isExclusiveVertexMember: rec.isExclusive,
          }),
        );

        return buildSynthesizedClusterDescriptor({
          clusterIndex: vIdx,
          clusterUid: helpers.allocateClusterUid(),
          code: parentCorner ? parentCorner.code : fmt.code,
          defaultLabel: proto.label,
          oklab: vCol.oklab,
          hex: vCol.hex,
          vertex: vert,
          coreTags: [],
          sharedTags: [],
          members,
          featureSummary: `Subspace cluster (${proto.label})`,
          role: 'intermediate',
          mixWeights,
          subclusterLabel: proto.label,
          parentContextLabel: parentCorner
            ? deriveCornerParentContextLabel(parentCorner)
            : undefined,
          deriveClusterMeta: helpers.deriveClusterMeta,
        });
      });

    const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
    coveredItems.forEach((it, idx) => {
      itemRootMap.set(it.id, localBary[idx]!.rootWeights);
    });

    return {
      nextFrame: {
        frameId: `sub-${parentFrame.frameId}-t${triangleIndex}`,
        kind: 'triangle',
        label: triCrumb.label,
        shortLabel: triCrumb.shortLabel,
        accentHex: triMixed.hex,
        breadcrumbSegments: triCrumb.segments,
        mesh: subMesh,
        clusters: subClusters,
        items: subItems,
        neighbors,
        parentToFrameTransform: {
          scale: transform.scale,
          sourceCx: transform.sourceCx,
          sourceCy: transform.sourceCy,
          targetCx: transform.targetCx,
          targetCy: transform.targetCy,
        },
        contextTriangles: context.contextTriangles,
        contextEdges: context.contextEdges,
        contextClusters: context.contextClusters,
        contextItems: context.contextItems,
        strategyData: {
          kind: 'triangle',
          parentTriIndex: triangleIndex,
          vertexWeights: vWeights.map((rw) => ({ rootWeights: rw })),
          itemRootWeights: itemRootMap,
        } satisfies InternalFrameMeta,
      },
    };
  };

  const drillClusterSubspace = (
    ctx: ZoomClusterDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null => {
    if (clusterZoomMode === 'none') {
      return null;
    }
    if (
      clusterZoomMode === 'spotlight' &&
      ctx.parentDepth >= MAX_ZOOM_DRILL_DEPTH
    ) {
      return null;
    }
    if (ctx.parentDepth > MAX_ZOOM_DRILL_DEPTH) {
      return null;
    }
    const { clusterIndex, parentFrame, itemScaleRatios, helpers } = ctx;
    const meta = parentFrame.strategyData as InternalFrameMeta | undefined;
    if (meta?.kind === 'cluster-spotlight') return null;

    const cluster = parentFrame.clusters[clusterIndex];
    if (!cluster) return null;

    const incTris = parentFrame.mesh.triangles.filter((t) =>
      t.vertices.includes(clusterIndex),
    );

    if (clusterZoomMode === 'incident-star') {
      if (incTris.length === 0) return null;
      if (meta?.kind === 'cluster-star' && clusterIndex === 0) {
        return null;
      }
      return executeClusterStarDrill(ctx, true);
    }

    const directItems = parentFrame.items.filter((it) =>
      it.unitWeights.some(
        (uw) => uw.clusterIndex === clusterIndex && uw.weight >= 0.45,
      ),
    );
    if (directItems.length <= 1) return null;
    if (stopWhenFullScale) {
      const stats = computeFullScaleStats(
        directItems.map((it) => it.id),
        itemScaleRatios,
        fullScaleThreshold,
      );
      if (!stats.hasUnderScaled) return null;
    }

    const targetVert = parentFrame.mesh.vertices[clusterIndex];
    const sourceSpan = Math.max(40, parentFrame.mesh.sideLength * 0.58);
    let sourceTrianglePoints:
      | readonly [Point2D, Point2D, Point2D]
      | undefined;
    if (incTris.length === 1 && targetVert) {
      const [va, vb, vc] = incTris[0]!.vertices;
      const qa = parentFrame.mesh.vertices[va]!;
      const qb = parentFrame.mesh.vertices[vb]!;
      const qc = parentFrame.mesh.vertices[vc]!;
      const qLen = Math.max(1, Math.hypot(qb.x - qa.x, qb.y - qa.y));
      const ratio = sourceSpan / qLen;
      const qCx = (qa.x + qb.x + qc.x) / 3;
      const qCy = (qa.y + qb.y + qc.y) / 3;
      sourceTrianglePoints = [
        {
          x: targetVert.x + (qa.x - qCx) * ratio,
          y: targetVert.y + (qa.y - qCy) * ratio,
        },
        {
          x: targetVert.x + (qb.x - qCx) * ratio,
          y: targetVert.y + (qb.y - qCy) * ratio,
        },
        {
          x: targetVert.x + (qc.x - qCx) * ratio,
          y: targetVert.y + (qc.y - qCy) * ratio,
        },
      ];
    }
    const hasSurroundingContext =
      parentFrame.mesh.triangles.length > 1 ||
      (parentFrame.contextTriangles?.length ?? 0) > 0;
    const focusPadding = computeContextAwarePadding(
      helpers.viewportWidth,
      helpers.viewportHeight,
      helpers.innerPadding,
      hasSurroundingContext,
    );
    const { transform: spotTransform } =
      buildOrientedSingleTriangleMeshWithTransform({
        viewportWidth: helpers.viewportWidth,
        viewportHeight: helpers.viewportHeight,
        innerPadding: focusPadding,
        sourceTrianglePoints,
        orientation: parentFrame.mesh.orientation,
        sourceCenter: targetVert
          ? { x: targetVert.x, y: targetVert.y }
          : undefined,
        sourceSpan,
      });
    const spotContext = buildNeighborhoodContext({
      parentFrame,
      excludedTriangleIndices: new Set<number>(),
      excludedVertexIndices: new Set<number>([clusterIndex]),
      activeParentEdgeKeys: new Set<string>(),
      activeItemIds: new Set(directItems.map((it) => it.id)),
      parentSettledItems: helpers.parentSettledItems,
      transform: spotTransform,
      viewportWidth: helpers.viewportWidth,
      viewportHeight: helpers.viewportHeight,
      allowClusterDrill: true,
    });

    const spotCrumb = buildClusterBreadcrumbInfo(cluster);
    return {
      nextFrame: buildSubspaceSpotlightFrame({
        frameId: `sub-spotlight-${parentFrame.frameId}-c${clusterIndex}`,
        label: spotCrumb.label,
        shortLabel: spotCrumb.shortLabel,
        accentHex: cluster.colorHex,
        breadcrumbSegments: spotCrumb.segments,
        parentContextLabel: deriveCornerParentContextLabel(cluster),
        coveredItems: directItems,
        baseRootWeights: getFrameVertexRootWeights(parentFrame, clusterIndex),
        parentDepth: ctx.parentDepth,
        options,
        helpers,
        neighbors: [],
        sourceTrianglePoints,
        innerPadding: focusPadding,
        meshOrientation: parentFrame.mesh.orientation,
        sourceCenter: targetVert
          ? { x: targetVert.x, y: targetVert.y }
          : undefined,
        sourceSpan,
        contextTriangles: spotContext.contextTriangles,
        contextEdges: spotContext.contextEdges,
        contextClusters: spotContext.contextClusters,
        contextItems: spotContext.contextItems,
      }),
    };
  };

  return {
    name: 'subspace-recluster',
    mode: 'drill-down',
    evaluateTargets: baseBarycentric.evaluateTargets,
    drillIntoTriangle: drillTriangleSubspace,
    drillIntoCluster: drillClusterSubspace,
    drillToNeighbor(ctx) {
      const { localTarget } = parseScopedNeighborId(ctx.neighborId);
      const { parentFrame, itemScaleRatios, helpers } = ctx;
      if (localTarget.startsWith('tri:')) {
        const triIdx = parseInt(localTarget.slice(4), 10);
        if (!Number.isFinite(triIdx)) return null;
        const outcome = drillTriangleSubspace({
          triangleIndex: triIdx,
          parentFrame,
          parentDepth: ctx.currentDepth - 1,
          itemScaleRatios,
          helpers,
        });
        return outcome ? { ...outcome, replaceTop: true } : null;
      }
      if (localTarget.startsWith('cluster:')) {
        const cIdx = parseInt(localTarget.slice(8), 10);
        if (!Number.isFinite(cIdx)) return null;
        const targetCluster = parentFrame.clusters[cIdx];
        if (!targetCluster) return null;
        const outcome = drillClusterSubspace({
          clusterUid: targetCluster.clusterUid,
          clusterIndex: cIdx,
          parentFrame,
          parentDepth: ctx.currentDepth - 1,
          itemScaleRatios,
          helpers,
        });
        return outcome ? { ...outcome, replaceTop: true } : null;
      }
      return null;
    },
  };
}

// ============================================================================
// Strategy 4: Classic Free Camera Zoom Strategy (Continuous Wheel + Pinch + Pan)
// ============================================================================

/**
 * Classic continuous camera pan/zoom strategy (wheel zoom-to-cursor, 2-finger pinch zoom,
 * pointer drag-to-pan, no mesh drill-down stack).
 */
export function createFreeCameraZoomStrategy<
  TItem = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
  return {
    name: 'free-camera',
    mode: 'free-camera',
    evaluateTargets(ctx) {
      const ids = ctx.frame.items.map((it) => it.id);
      let full = 0;
      for (const id of ids) {
        if ((ctx.itemScaleRatios.get(id) ?? 1) >= DEFAULT_FULL_SCALE_THRESHOLD) full++;
      }
      return {
        drillableTriangleIndices: [],
        focusableTriangleIndices: [],
        drillableClusterUids: [],
        isLeafReached: false,
        fullScaleItemRatio: ids.length > 0 ? full / ids.length : 1,
      };
    },
  };
}


