import {
  retargetVisualTransition,
  type VisualTransitionState,
} from '../animation.js';
import type { ComputedItemPlacement } from '../clustering.js';
import type { TwoPhaseLayoutResult } from '../layout.js';
import type {
  ClusterDescriptor,
  ConvexGeometry,
  NodeRenderState,
} from '../types.js';
import { applyZoomAffine, type ZoomFrameSpec } from '../zoom.js';
import {
  computeClusterStarItemRestOpacity,
  evaluateFlightCamera,
  type ActiveNodeFlightEndpoint,
  type AnimatedContextClusterRecord,
  type AnimatedContextEdgeRecord,
  type AnimatedContextItemRecord,
  type AnimatedContextTriangleRecord,
  type AnimatedEdgeRecord,
  type AnimatedNodeRecord,
  type AnimatedTriangleRecord,
  type DrillTransitionSpec,
  type FlightDepartingCluster,
  type FlightDepartingEdge,
  type FlightDepartingItem,
  type FlightDepartingTriangle,
  type ZoomFlightState,
} from './types.js';

export interface ResolvedClusterVisual<
  TItem,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TClusterVisual;
  readonly cacheKey: string;
  readonly hull: ConvexGeometry;
}

export interface ResolvedItemVisual<
  TItem,
  TContentVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly placement: ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TContentVisual;
  readonly cacheKey: string;
  readonly hull: ConvexGeometry;
}

export function buildZoomFlightState<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(input: {
  readonly drillFlight: DrillTransitionSpec<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly solved: TwoPhaseLayoutResult;
  readonly resolvedClusters: readonly ResolvedClusterVisual<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly resolvedItems: readonly ResolvedItemVisual<
    TItem,
    TContentVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly activeZoomFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> | undefined;
  readonly clusterNodes: Map<
    string,
    AnimatedNodeRecord<
      TClusterVisual,
      ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
    >
  >;
  readonly itemNodes: Map<
    string,
    AnimatedNodeRecord<
      TContentVisual,
      ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>
    >
  >;
  readonly contextClusterNodes: readonly AnimatedContextClusterRecord<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextItemNodes: readonly AnimatedContextItemRecord<
    TItem,
    TContentVisual,
    TTagMeta,
    TClusterMeta
  >[];
}): ZoomFlightState<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
> {
  const {
    snapshot: prevSnap,
    clusterDomainByNodeId,
    flightTransform,
    invFlight,
  } = input.drillFlight;
  const S = Math.max(0.02, Math.min(50, flightTransform.scale));

  // Index previous rendered clusters (active, context, and any mid-flight departing clusters)
  const prevClusters = prevSnap.clusters
    .map((pc) => {
      const cluster = clusterDomainByNodeId.get(pc.id);
      if (!cluster) return null;
      const effOpacity = pc.isContext
        ? pc.opacity
        : pc.interaction.isDimmed
          ? pc.opacity * 0.34
          : pc.opacity;
      if (effOpacity <= 0.02) return null;
      return {
        node: pc,
        cluster,
        effOpacity,
        claimed: false,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const maxMatchRadius = Math.max(
    110,
    Math.min(input.viewportWidth, input.viewportHeight) * 0.3,
  );
  const claimMatchingCluster = (
    targetCluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
    targetX: number,
    targetY: number,
  ) => {
    const expectedOld = applyZoomAffine(invFlight, { x: targetX, y: targetY });
    let best: (typeof prevClusters)[number] | null = null;
    let bestScore = Infinity;
    for (const cand of prevClusters) {
      if (cand.claimed) continue;
      const uidMatch = cand.cluster.clusterUid === targetCluster.clusterUid;
      const codeMatch = cand.cluster.code === targetCluster.code;
      if (!uidMatch && !codeMatch) continue;
      const dist = Math.hypot(
        cand.node.x - expectedOld.x,
        cand.node.y - expectedOld.y,
      );
      if (!uidMatch && dist > maxMatchRadius) continue;
      const score = uidMatch ? dist * 0.25 : dist;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (best) {
      best.claimed = true;
    }
    return best;
  };

  const clusterEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
  input.clusterNodes.clear();
  input.resolvedClusters.forEach((rc, idx) => {
    const placed = input.solved.clusters[idx]!;
    const uid = rc.cluster.clusterUid;
    const matched = claimMatchingCluster(rc.cluster, placed.x, placed.y);
    const nextTransition = matched
      ? retargetVisualTransition(
          null,
          matched.node.visual,
          matched.node.hull,
          matched.node.cacheKey,
          rc.visual,
          rc.hull,
          rc.cacheKey,
        )
      : null;

    if (matched) {
      const localStart = applyZoomAffine(flightTransform, {
        x: matched.node.x,
        y: matched.node.y,
      });
      clusterEndpoints.set(uid, {
        localStart,
        localEnd: { x: placed.x, y: placed.y },
        localStartScale: matched.node.scale * S,
        targetScale: placed.scale,
        startOpacity: matched.effOpacity,
        targetOpacity: 1,
        isNewlyEntering: false,
      });
    } else {
      clusterEndpoints.set(uid, {
        localStart: { x: placed.x, y: placed.y },
        localEnd: { x: placed.x, y: placed.y },
        localStartScale: placed.scale * 0.78,
        targetScale: placed.scale,
        startOpacity: 0,
        targetOpacity: 1,
        isNewlyEntering: true,
      });
    }

    input.clusterNodes.set(uid, {
      id: uid,
      status: 'active',
      x: { value: placed.x, velocity: 0, target: placed.x },
      y: { value: placed.y, velocity: 0, target: placed.y },
      scale: { value: placed.scale, velocity: 0, target: placed.scale },
      opacity: { value: 1, velocity: 0, target: 1 },
      visual: rc.visual,
      hull: rc.hull,
      cacheKey: rc.cacheKey,
      transition: nextTransition,
      domain: rc.cluster,
    });
  });

  const contextClusterEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
  for (const cc of input.contextClusterNodes) {
    const matched = claimMatchingCluster(cc.cluster, cc.targetX, cc.targetY);
    if (matched) {
      const localStart = applyZoomAffine(flightTransform, {
        x: matched.node.x,
        y: matched.node.y,
      });
      contextClusterEndpoints.set(cc.id, {
        localStart,
        localEnd: { x: cc.targetX, y: cc.targetY },
        localStartScale: matched.node.scale * S,
        targetScale: cc.targetScale,
        startOpacity: matched.effOpacity,
        targetOpacity: 0.34,
        isNewlyEntering: false,
      });
    } else {
      contextClusterEndpoints.set(cc.id, {
        localStart: { x: cc.targetX, y: cc.targetY },
        localEnd: { x: cc.targetX, y: cc.targetY },
        localStartScale: cc.targetScale * 0.85,
        targetScale: cc.targetScale,
        startOpacity: 0,
        targetOpacity: 0.34,
        isNewlyEntering: true,
      });
    }
  }

  const departingClusters: FlightDepartingCluster<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] = [];
  for (const rem of prevClusters) {
    if (rem.claimed) continue;
    const localStart = applyZoomAffine(flightTransform, {
      x: rem.node.x,
      y: rem.node.y,
    });
    const ghostId = rem.node.id.startsWith('ghost-cl-')
      ? rem.node.id
      : `ghost-cl-${rem.node.id}`;
    departingClusters.push({
      id: ghostId,
      cluster: rem.cluster,
      localStart,
      localStartScale: rem.node.scale * S,
      localEndScale: rem.node.scale * S * 0.82,
      startOpacity: rem.effOpacity,
      visual: rem.node.visual,
      hull: rem.node.hull,
      cacheKey: rem.node.cacheKey,
    });
  }

  // Reconcile content items across flight (active, dimmed neighborhood context, and departing ghosts)
  const prevItemsByRawId = new Map<
    string,
    {
      readonly node: NodeRenderState<TContentVisual>;
      readonly effOpacity: number;
      claimed: boolean;
    }
  >();
  for (const pi of prevSnap.items) {
    const effOpacity = pi.isContext
      ? pi.opacity
      : pi.interaction.isDimmed
        ? pi.opacity * 0.34
        : pi.opacity;
    if (effOpacity <= 0.02) continue;
    const rawId = pi.id.startsWith('ghost-it-')
      ? pi.id.slice(9)
      : pi.id.startsWith('ctx-it-')
        ? pi.id.slice(7)
        : pi.id;
    const existingEntry = prevItemsByRawId.get(rawId);
    if (!existingEntry || effOpacity > existingEntry.effOpacity) {
      prevItemsByRawId.set(rawId, { node: pi, effOpacity, claimed: false });
    }
  }

  const itemEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
  input.itemNodes.clear();
  input.resolvedItems.forEach((ri, idx) => {
    const placed = input.solved.items[idx]!;
    const id = ri.placement.id;
    const targetOpacity = computeClusterStarItemRestOpacity(
      input.activeZoomFrame,
      ri.placement.layoutContext.unitClusters,
    );
    const matched = prevItemsByRawId.get(id);
    let nextTransition: VisualTransitionState<TContentVisual> | null = null;

    if (matched) {
      matched.claimed = true;
      nextTransition = retargetVisualTransition(
        null,
        matched.node.visual,
        matched.node.hull,
        matched.node.cacheKey,
        ri.visual,
        ri.hull,
        ri.cacheKey,
      );
      const localStart = applyZoomAffine(flightTransform, {
        x: matched.node.x,
        y: matched.node.y,
      });
      itemEndpoints.set(id, {
        localStart,
        localEnd: { x: placed.x, y: placed.y },
        localStartScale: matched.node.scale * S,
        targetScale: placed.scale,
        startOpacity: matched.effOpacity,
        targetOpacity,
        isNewlyEntering: false,
      });
    } else {
      itemEndpoints.set(id, {
        localStart: {
          x: placed.x * 0.72 + ri.placement.anchorX * 0.28,
          y: placed.y * 0.72 + ri.placement.anchorY * 0.28,
        },
        localEnd: { x: placed.x, y: placed.y },
        localStartScale: placed.scale * 0.8,
        targetScale: placed.scale,
        startOpacity: 0,
        targetOpacity,
        isNewlyEntering: true,
      });
    }

    input.itemNodes.set(id, {
      id,
      status: 'active',
      x: { value: placed.x, velocity: 0, target: placed.x },
      y: { value: placed.y, velocity: 0, target: placed.y },
      scale: { value: placed.scale, velocity: 0, target: placed.scale },
      opacity: { value: targetOpacity, velocity: 0, target: targetOpacity },
      visual: ri.visual,
      hull: ri.hull,
      cacheKey: ri.cacheKey,
      transition: nextTransition,
      domain: ri.placement,
    });
  });

  const contextItemEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
  for (const ci of input.contextItemNodes) {
    const matched = prevItemsByRawId.get(ci.rawId);
    if (matched) {
      matched.claimed = true;
      const localStart = applyZoomAffine(flightTransform, {
        x: matched.node.x,
        y: matched.node.y,
      });
      contextItemEndpoints.set(ci.id, {
        localStart,
        localEnd: { x: ci.targetX, y: ci.targetY },
        localStartScale: matched.node.scale * S,
        targetScale: ci.targetScale,
        startOpacity: matched.effOpacity,
        targetOpacity: 0.32,
        isNewlyEntering: false,
      });
    } else {
      contextItemEndpoints.set(ci.id, {
        localStart: { x: ci.targetX, y: ci.targetY },
        localEnd: { x: ci.targetX, y: ci.targetY },
        localStartScale: ci.targetScale * 0.85,
        targetScale: ci.targetScale,
        startOpacity: 0,
        targetOpacity: 0.32,
        isNewlyEntering: true,
      });
    }
  }

  const departingItems: FlightDepartingItem<TContentVisual>[] = [];
  for (const [rawId, rem] of prevItemsByRawId) {
    if (rem.claimed) continue;
    const localStart = applyZoomAffine(flightTransform, {
      x: rem.node.x,
      y: rem.node.y,
    });
    const ghostId = rem.node.id.startsWith('ghost-it-')
      ? rem.node.id
      : `ghost-it-${rawId}`;
    departingItems.push({
      rawId,
      id: ghostId,
      localStart,
      localStartScale: rem.node.scale * S,
      localEndScale: rem.node.scale * S * 0.88,
      startOpacity: rem.effOpacity,
      visual: rem.node.visual,
      hull: rem.node.hull,
      cacheKey: rem.node.cacheKey,
    });
  }

  const departingTriangles: FlightDepartingTriangle<
    TItem,
    TTagMeta,
    TClusterMeta
  >[] = prevSnap.triangles
    .filter((pt) => (pt.opacity ?? 1) >= 0.06)
    .slice(-48)
    .map((pt) => ({
      base: {
        ...pt,
        isDrillable: undefined,
        neighborId: undefined,
        interaction: {
          isHovered: false,
          isFocused: false,
          isDimmed: pt.interaction.isDimmed,
        },
      },
      localPoints: [
        applyZoomAffine(flightTransform, pt.points[0]),
        applyZoomAffine(flightTransform, pt.points[1]),
        applyZoomAffine(flightTransform, pt.points[2]),
      ] as const,
      startOpacity: pt.opacity ?? 1,
    }));

  const departingEdges: FlightDepartingEdge<
    TItem,
    TTagMeta,
    TClusterMeta
  >[] = prevSnap.edges
    .filter((pe) => (pe.opacity ?? 1) >= 0.06)
    .slice(-72)
    .map((pe) => ({
      base: {
        ...pe,
        isHighlighted: false,
      },
      localA: applyZoomAffine(flightTransform, pe.a),
      localB: applyZoomAffine(flightTransform, pe.b),
      startOpacity: pe.opacity ?? 1,
    }));

  const durationSec = Math.min(
    0.66,
    Math.max(0.46, 0.44 + Math.abs(Math.log(S)) * 0.09),
  );
  return {
    rawProgress: 0,
    durationSec,
    flightTransform,
    invFlight,
    departingTriangles,
    departingEdges,
    departingClusters,
    departingItems,
    clusterEndpoints,
    contextClusterEndpoints,
    itemEndpoints,
    contextItemEndpoints,
  };
}

export function syncFlightState<
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
  state: {
    readonly triangleStates: readonly AnimatedTriangleRecord[];
    readonly contextTriangleStates: readonly AnimatedContextTriangleRecord<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];
    readonly edgeRecords: readonly AnimatedEdgeRecord[];
    readonly contextEdgeRecords: readonly AnimatedContextEdgeRecord<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];
    readonly contextClusterNodes: readonly AnimatedContextClusterRecord<
      TItem,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >[];
    readonly contextItemNodes: readonly AnimatedContextItemRecord<
      TItem,
      TContentVisual,
      TTagMeta,
      TClusterMeta
    >[];
    readonly clusterNodes: ReadonlyMap<
      string,
      AnimatedNodeRecord<
        TClusterVisual,
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
      >
    >;
    readonly itemNodes: ReadonlyMap<
      string,
      AnimatedNodeRecord<
        TContentVisual,
        ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>
      >
    >;
  },
): void {
  if (rawProgress >= 1) {
    for (const tr of state.triangleStates) {
      tr.points = [tr.targetPoints[0], tr.targetPoints[1], tr.targetPoints[2]];
      tr.centroid = {
        x: (tr.targetPoints[0].x + tr.targetPoints[1].x + tr.targetPoints[2].x) / 3,
        y: (tr.targetPoints[0].y + tr.targetPoints[1].y + tr.targetPoints[2].y) / 3,
      };
      tr.flightOpacity = undefined;
    }
    for (const ct of state.contextTriangleStates) {
      ct.points = [ct.targetPoints[0], ct.targetPoints[1], ct.targetPoints[2]];
      ct.centroid = {
        x: (ct.targetPoints[0].x + ct.targetPoints[1].x + ct.targetPoints[2].x) / 3,
        y: (ct.targetPoints[0].y + ct.targetPoints[1].y + ct.targetPoints[2].y) / 3,
      };
      ct.opacity = 1;
    }
    for (const edge of state.edgeRecords) {
      edge.a = edge.targetA;
      edge.b = edge.targetB;
      edge.flightOpacity = undefined;
    }
    for (const ce of state.contextEdgeRecords) {
      ce.a = ce.targetA;
      ce.b = ce.targetB;
      ce.opacity = 1;
    }
    for (const cc of state.contextClusterNodes) {
      cc.x = cc.targetX;
      cc.y = cc.targetY;
      cc.scale = cc.targetScale;
      cc.opacity = 0.34;
    }
    for (const ci of state.contextItemNodes) {
      ci.x = ci.targetX;
      ci.y = ci.targetY;
      ci.scale = ci.targetScale;
      ci.opacity = 0.32;
    }
    for (const cNode of state.clusterNodes.values()) {
      cNode.x.value = cNode.x.target;
      cNode.x.velocity = 0;
      cNode.y.value = cNode.y.target;
      cNode.y.velocity = 0;
      cNode.scale.value = cNode.scale.target;
      cNode.scale.velocity = 0;
      cNode.opacity.value = cNode.opacity.target;
      cNode.opacity.velocity = 0;
    }
    for (const iNode of state.itemNodes.values()) {
      iNode.x.value = iNode.x.target;
      iNode.x.velocity = 0;
      iNode.y.value = iNode.y.target;
      iNode.y.velocity = 0;
      iNode.scale.value = iNode.scale.target;
      iNode.scale.velocity = 0;
      iNode.opacity.value = iNode.opacity.target;
      iNode.opacity.velocity = 0;
    }
    return;
  }

  const { u, camScale, M_u } = evaluateFlightCamera(flight, rawProgress);

  for (const tr of state.triangleStates) {
    const p0 = applyZoomAffine(M_u, tr.targetPoints[0]);
    const p1 = applyZoomAffine(M_u, tr.targetPoints[1]);
    const p2 = applyZoomAffine(M_u, tr.targetPoints[2]);
    tr.points = [p0, p1, p2];
    tr.centroid = {
      x: (p0.x + p1.x + p2.x) / 3,
      y: (p0.y + p1.y + p2.y) / 3,
    };
    tr.flightOpacity = u;
  }

  for (const ct of state.contextTriangleStates) {
    const p0 = applyZoomAffine(M_u, ct.targetPoints[0]);
    const p1 = applyZoomAffine(M_u, ct.targetPoints[1]);
    const p2 = applyZoomAffine(M_u, ct.targetPoints[2]);
    ct.points = [p0, p1, p2];
    ct.centroid = {
      x: (p0.x + p1.x + p2.x) / 3,
      y: (p0.y + p1.y + p2.y) / 3,
    };
    ct.opacity = u;
  }

  for (const edge of state.edgeRecords) {
    edge.a = applyZoomAffine(M_u, edge.targetA);
    edge.b = applyZoomAffine(M_u, edge.targetB);
    edge.flightOpacity = u;
  }

  for (const ce of state.contextEdgeRecords) {
    ce.a = applyZoomAffine(M_u, ce.targetA);
    ce.b = applyZoomAffine(M_u, ce.targetB);
    ce.opacity = u;
  }

  const evalEndpoint = (ep: ActiveNodeFlightEndpoint) => {
    const lx = ep.localStart.x + (ep.localEnd.x - ep.localStart.x) * u;
    const ly = ep.localStart.y + (ep.localEnd.y - ep.localStart.y) * u;
    const pt = applyZoomAffine(M_u, { x: lx, y: ly });
    const localScale =
      ep.localStartScale + (ep.targetScale - ep.localStartScale) * u;
    const scale = Math.max(0.08, camScale * localScale);
    const opacity = ep.isNewlyEntering
      ? Math.max(0, Math.min(1, (u - 0.08) / 0.82)) * ep.targetOpacity
      : ep.startOpacity + (ep.targetOpacity - ep.startOpacity) * u;
    return { pt, scale, opacity };
  };

  for (const cNode of state.clusterNodes.values()) {
    const ep = flight.clusterEndpoints.get(cNode.id);
    if (!ep) continue;
    const { pt, scale, opacity } = evalEndpoint(ep);
    cNode.x.value = pt.x;
    cNode.x.velocity = 0;
    cNode.y.value = pt.y;
    cNode.y.velocity = 0;
    cNode.scale.value = scale;
    cNode.scale.velocity = 0;
    cNode.opacity.value = opacity;
    cNode.opacity.velocity = 0;
  }

  for (const cc of state.contextClusterNodes) {
    const ep = flight.contextClusterEndpoints.get(cc.id);
    if (!ep) continue;
    const { pt, scale, opacity } = evalEndpoint(ep);
    cc.x = pt.x;
    cc.y = pt.y;
    cc.scale = scale;
    cc.opacity = opacity;
  }

  for (const ci of state.contextItemNodes) {
    const ep = flight.contextItemEndpoints.get(ci.id);
    if (!ep) continue;
    const { pt, scale, opacity } = evalEndpoint(ep);
    ci.x = pt.x;
    ci.y = pt.y;
    ci.scale = scale;
    ci.opacity = opacity;
  }

  for (const iNode of state.itemNodes.values()) {
    const ep = flight.itemEndpoints.get(iNode.id);
    if (!ep) continue;
    const { pt, scale, opacity } = evalEndpoint(ep);
    iNode.x.value = pt.x;
    iNode.x.velocity = 0;
    iNode.y.value = pt.y;
    iNode.y.velocity = 0;
    iNode.scale.value = scale;
    iNode.scale.velocity = 0;
    iNode.opacity.value = opacity;
    iNode.opacity.velocity = 0;
  }
}
