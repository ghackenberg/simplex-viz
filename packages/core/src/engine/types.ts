import type { SpringScalar, VisualTransitionState } from '../animation.js';
import type { ComputedItemPlacement } from '../clustering.js';
import { isPointInTriangle } from '../geometry.js';
import type { OklabTuple } from '../oklab.js';
import type {
  ClusterDescriptor,
  ContentLayoutContext,
  ConvexGeometry,
  MeshEdgeRenderState,
  MeshTriangleRenderState,
  Point2D,
  SceneFrameSnapshot,
} from '../types.js';
import {
  IDENTITY_ZOOM_AFFINE,
  composeZoomAffine,
  type ZoomAffineTransform,
  type ZoomFrameSpec,
} from '../zoom.js';

/**
 * Resting opacity floor inside a `cluster-star` frame at maximum simplex distance `d = 1`
 * (`w_0 = 0`, i.e. items on outer 1-ring neighbor clusters/edges), matching `contextItemNodes` (`0.32`)
 * so active outer-rim items blend continuously into the dimmed surrounding neighborhood.
 */
export const CLUSTER_STAR_MIN_ITEM_OPACITY = 0.32;

export function computeClusterStarItemRestOpacity<TItem, TTagMeta, TClusterMeta>(
  activeZoomFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> | undefined,
  unitClusters: ReadonlyArray<{
    readonly cluster: { readonly clusterIndex: number };
    readonly weight: number;
  }>,
): number {
  if (activeZoomFrame?.kind !== 'cluster-star') {
    return 1;
  }
  let centerWeight = 0;
  for (const uc of unitClusters) {
    if (uc.cluster.clusterIndex === 0) {
      centerWeight += uc.weight;
    }
  }
  const w0 = Math.max(0, Math.min(1, centerWeight));
  return (
    CLUSTER_STAR_MIN_ITEM_OPACITY + (1 - CLUSTER_STAR_MIN_ITEM_OPACITY) * w0
  );
}

export interface AnimatedNodeRecord<TVisual, TDomainMeta> {
  readonly id: string;
  status: 'active' | 'exiting';
  x: SpringScalar;
  y: SpringScalar;
  scale: SpringScalar;
  opacity: SpringScalar;
  visual: TVisual;
  hull: ConvexGeometry;
  cacheKey: string;
  transition: VisualTransitionState<TVisual> | null;
  domain: TDomainMeta;
}

export interface AnimatedTriangleRecord {
  readonly index: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly targetPoints: readonly [Point2D, Point2D, Point2D];
  points: [Point2D, Point2D, Point2D];
  centroid: Point2D;
  readonly coveredItemCount: number;
  readonly interiorItemCount: number;
  currentOklab: [number, number, number];
  targetOklab: OklabTuple;
  fillHex: string;
  flightOpacity?: number;
}

export interface AnimatedEdgeRecord {
  readonly index: number;
  readonly vertexIndices: readonly [number, number];
  readonly targetA: Point2D;
  readonly targetB: Point2D;
  a: Point2D;
  b: Point2D;
  readonly mixedColorHex: string;
  flightOpacity?: number;
}

export interface AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly targetPoints: readonly [Point2D, Point2D, Point2D];
  points: [Point2D, Point2D, Point2D];
  centroid: Point2D;
  opacity: number;
}

export interface AnimatedContextEdgeRecord<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly targetA: Point2D;
  readonly targetB: Point2D;
  a: Point2D;
  b: Point2D;
  opacity: number;
}

export interface AnimatedContextClusterRecord<
  TItem,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly id: string;
  readonly neighborId?: string;
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TClusterVisual;
  readonly cacheKey: string;
  readonly hull: ConvexGeometry;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetScale: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export interface AnimatedContextItemRecord<
  TItem,
  TContentVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly id: string;
  readonly rawId: string;
  readonly neighborId?: string;
  readonly item: TItem;
  readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TContentVisual;
  readonly cacheKey: string;
  readonly hull: ConvexGeometry;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetScale: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export interface ActiveNodeFlightEndpoint {
  readonly localStart: Point2D;
  readonly localEnd: Point2D;
  readonly localStartScale: number;
  readonly targetScale: number;
  readonly startOpacity: number;
  readonly targetOpacity: number;
  readonly isNewlyEntering: boolean;
}

export interface FlightDepartingTriangle<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly localPoints: readonly [Point2D, Point2D, Point2D];
  readonly startOpacity: number;
}

export interface FlightDepartingEdge<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly localA: Point2D;
  readonly localB: Point2D;
  readonly startOpacity: number;
}

export interface FlightDepartingCluster<
  TItem,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly id: string;
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
  readonly localStart: Point2D;
  readonly localStartScale: number;
  readonly localEndScale: number;
  readonly startOpacity: number;
  readonly visual: TClusterVisual;
  readonly hull: ConvexGeometry;
  readonly cacheKey: string;
}

export interface FlightDepartingItem<TContentVisual> {
  readonly rawId: string;
  readonly id: string;
  readonly localStart: Point2D;
  readonly localStartScale: number;
  readonly localEndScale: number;
  readonly startOpacity: number;
  readonly visual: TContentVisual;
  readonly hull: ConvexGeometry;
  readonly cacheKey: string;
}

export interface ZoomFlightState<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  rawProgress: number;
  readonly durationSec: number;
  readonly flightTransform: ZoomAffineTransform;
  readonly invFlight: ZoomAffineTransform;
  readonly departingTriangles: readonly FlightDepartingTriangle<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly departingEdges: readonly FlightDepartingEdge<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly departingClusters: readonly FlightDepartingCluster<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly departingItems: readonly FlightDepartingItem<TContentVisual>[];
  readonly clusterEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
  readonly contextClusterEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
  readonly itemEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
  readonly contextItemEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
}

export interface DrillTransitionSpec<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly snapshot: SceneFrameSnapshot<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  readonly clusterDomainByNodeId: ReadonlyMap<
    string,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
  >;
  readonly flightTransform: ZoomAffineTransform;
  readonly invFlight: ZoomAffineTransform;
}

export interface ZoomRegionBoundary<TItem, TTagMeta, TClusterMeta> {
  readonly isZoomedIn: boolean;
  readonly activeFrameKind: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>['kind'] | undefined;
  readonly boundaryEdgeKeys: ReadonlySet<string>;
  readonly outerCornerVerts: ReadonlySet<number>;
}

export function defaultGetId<TItem>(item: TItem): string {
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const raw = (item as { readonly id: string }).id;
    return typeof raw === 'string' ? raw : String(raw);
  }
  return '';
}

export function defaultGetTags<TItem>(item: TItem): readonly string[] {
  if (typeof item === 'object' && item !== null && 'tags' in item) {
    const raw = (item as { readonly tags: readonly string[] }).tags;
    return Array.isArray(raw) ? raw : [];
  }
  return [];
}

export function getRootToStackTransform<TItem, TTagMeta, TClusterMeta>(
  stack: readonly ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>[],
): ZoomAffineTransform {
  let acc = IDENTITY_ZOOM_AFFINE;
  for (let i = 1; i < stack.length; i++) {
    const t = stack[i]?.parentToFrameTransform;
    if (t) {
      acc = composeZoomAffine(acc, t);
    }
  }
  return acc;
}

export function evaluateFlightCamera<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  flight: ZoomFlightState<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  rawProgress: number,
): {
  readonly u: number;
  readonly camScale: number;
  readonly M_u: ZoomAffineTransform;
} {
  const t = Math.max(0, Math.min(1, rawProgress));
  const smooth = t * t * (3 - 2 * t);
  const cubicOut = 1 - Math.pow(1 - t, 3);
  const u = 0.65 * smooth + 0.35 * cubicOut;

  const S = Math.max(0.02, Math.min(50, flight.flightTransform.scale));
  const alpha =
    Math.abs(S - 1) < 1e-4 ? u : (Math.pow(S, u) - 1) / (S - 1);
  const camScale = (1 - alpha) / S + alpha;
  const inv = flight.invFlight;
  const M_u: ZoomAffineTransform = {
    scale: camScale,
    sourceCx: inv.sourceCx,
    sourceCy: inv.sourceCy,
    targetCx: (1 - alpha) * inv.targetCx + alpha * inv.sourceCx,
    targetCy: (1 - alpha) * inv.targetCy + alpha * inv.sourceCy,
  };
  return { u, camScale, M_u };
}

/**
 * Checks whether an active content item `node` belongs to a currently zoomable/drillable
 * triangle when a `drill-down` zoom strategy is active. If so, returns that owning
 * `AnimatedTriangleRecord` so pointer hover & click pass through to the triangle face;
 * returns `null` when the item sits in a leaf (non-drillable) region and remains interactive.
 */
export function resolveDrillableTriangleForActiveItem<
  TItem,
  TContentVisual,
  TTagMeta,
  TClusterMeta,
>(
  node: AnimatedNodeRecord<
    TContentVisual,
    ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>
  >,
  probePosition: Point2D,
  drillableTriSet: ReadonlySet<number>,
  triangleStates: readonly AnimatedTriangleRecord[],
): AnimatedTriangleRecord | null {
  // 1. Check which active mesh triangle directly contains the pointer/probe position
  for (let i = triangleStates.length - 1; i >= 0; i--) {
    const tr = triangleStates[i]!;
    if (
      isPointInTriangle(
        probePosition.x,
        probePosition.y,
        tr.points[0],
        tr.points[1],
        tr.points[2],
      )
    ) {
      return drillableTriSet.has(tr.index) ? tr : null;
    }
  }

  // 2. If pointer hit an overhanging rim of `node`, check which triangle contains `node`'s center
  const nx = node.x.value;
  const ny = node.y.value;
  if (nx !== probePosition.x || ny !== probePosition.y) {
    for (let i = triangleStates.length - 1; i >= 0; i--) {
      const tr = triangleStates[i]!;
      if (isPointInTriangle(nx, ny, tr.points[0], tr.points[1], tr.points[2])) {
        return drillableTriSet.has(tr.index) ? tr : null;
      }
    }
  }

  // 3. Item relaxed slightly outside the outer mesh perimeter (e.g. 1-cluster item near a corner):
  //    find the geometrically nearest active triangle whose corner clusters cover `node`.
  const unitClusters = node.domain.layoutContext.unitClusters;
  if (unitClusters.length > 0) {
    let nearestCoveringTri: AnimatedTriangleRecord | null = null;
    let bestDistSq = Infinity;
    for (const tr of triangleStates) {
      const [va, vb, vc] = tr.vertexIndices;
      const covers = unitClusters.every(
        (uc) =>
          uc.cluster.clusterIndex === va ||
          uc.cluster.clusterIndex === vb ||
          uc.cluster.clusterIndex === vc,
      );
      if (!covers) continue;
      const dx = nx - tr.centroid.x;
      const dy = ny - tr.centroid.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        nearestCoveringTri = tr;
      }
    }
    if (nearestCoveringTri && drillableTriSet.has(nearestCoveringTri.index)) {
      return nearestCoveringTri;
    }
  }

  return null;
}

/**
 * Finds the best candidate triangle index containing or covering `node` using its solved
 * target coordinates `(node.x.target, node.y.target)` so multi-step `zoomToItem` works
 * synchronously even while spring/flight animations are in progress.
 */
export function resolveContainingTriangleIndexForItem<
  TItem,
  TContentVisual,
  TTagMeta,
  TClusterMeta,
>(
  node: AnimatedNodeRecord<
    TContentVisual,
    ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>
  >,
  candidateTriSet: ReadonlySet<number>,
  triangleStates: readonly AnimatedTriangleRecord[],
): number | null {
  const tx = node.x.target;
  const ty = node.y.target;

  for (let i = triangleStates.length - 1; i >= 0; i--) {
    const tr = triangleStates[i]!;
    if (!candidateTriSet.has(tr.index)) continue;
    if (isPointInTriangle(tx, ty, tr.points[0], tr.points[1], tr.points[2])) {
      return tr.index;
    }
  }

  const unitClusters = node.domain.layoutContext.unitClusters;
  if (unitClusters.length > 0) {
    let bestIdx: number | null = null;
    let bestDistSq = Infinity;
    for (const tr of triangleStates) {
      if (!candidateTriSet.has(tr.index)) continue;
      const [va, vb, vc] = tr.vertexIndices;
      const covers = unitClusters.every(
        (uc) =>
          uc.cluster.clusterIndex === va ||
          uc.cluster.clusterIndex === vb ||
          uc.cluster.clusterIndex === vc,
      );
      if (!covers) continue;
      const dx = tx - tr.centroid.x;
      const dy = ty - tr.centroid.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = tr.index;
      }
    }
    if (bestIdx !== null) return bestIdx;
  }

  return null;
}

/**
 * Resolves a dimmed neighborhood `contextItemNode` (e.g. an exterior 1-cluster item or overhanging rim)
 * to its owning `contextTriangle` so unfocused content items never capture individual hover,
 * routing pointer hover & click cleanly to the neighbor triangle as a whole.
 */
export function resolveContextTriangleForContextItem<
  TItem,
  TContentVisual,
  TTagMeta,
  TClusterMeta,
>(
  ci: AnimatedContextItemRecord<TItem, TContentVisual, TTagMeta, TClusterMeta>,
  contextTriangleStates: readonly AnimatedContextTriangleRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[],
): AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta> | null {
  for (let i = contextTriangleStates.length - 1; i >= 0; i--) {
    const ct = contextTriangleStates[i]!;
    if (isPointInTriangle(ci.x, ci.y, ct.points[0], ct.points[1], ct.points[2])) {
      return ct;
    }
  }

  if (ci.neighborId) {
    let bestExact: AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta> | null =
      null;
    let bestExactDistSq = Infinity;
    for (const ct of contextTriangleStates) {
      if (ct.base.neighborId !== ci.neighborId) continue;
      const dx = ci.x - ct.centroid.x;
      const dy = ci.y - ct.centroid.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestExactDistSq) {
        bestExactDistSq = dSq;
        bestExact = ct;
      }
    }
    if (bestExact) return bestExact;
  }

  const itemClusterUids = new Set(
    ci.layoutContext.unitClusters.map((uc) => uc.cluster.clusterUid),
  );
  if (itemClusterUids.size > 0) {
    const scopePrefix = ci.neighborId?.startsWith('@')
      ? ci.neighborId.slice(0, ci.neighborId.indexOf('/') + 1)
      : '';
    let nearestSharing: AnimatedContextTriangleRecord<
      TItem,
      TTagMeta,
      TClusterMeta
    > | null = null;
    let bestDistSq = Infinity;
    for (const ct of contextTriangleStates) {
      if (
        scopePrefix &&
        ct.base.neighborId &&
        !ct.base.neighborId.startsWith(scopePrefix)
      ) {
        continue;
      }
      const sharesCorner = ct.base.clusters.some(
        (c) => c !== undefined && itemClusterUids.has(c.clusterUid),
      );
      if (!sharesCorner) continue;
      const dx = ci.x - ct.centroid.x;
      const dy = ci.y - ct.centroid.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        nearestSharing = ct;
      }
    }
    if (nearestSharing) return nearestSharing;
  }

  return null;
}
