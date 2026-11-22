import { retargetVisualTransition } from '../animation.js';
import type { ComputedItemPlacement } from '../clustering.js';
import type { TwoPhaseLayoutResult } from '../layout.js';
import { hexToOklab, lerpOklabHex, mixOklabColors } from '../oklab.js';
import type {
  ClusterDescriptor,
  EmptyClusterBehavior,
  Point2D,
  SimplexMesh,
  SimplexRendererAdapter,
  VisualResolver,
} from '../types.js';
import type { ZoomFrameSpec } from '../zoom.js';
import type { ResolvedClusterVisual, ResolvedItemVisual } from './flight.js';
import {
  computeClusterStarItemRestOpacity,
  type AnimatedContextClusterRecord,
  type AnimatedContextEdgeRecord,
  type AnimatedContextItemRecord,
  type AnimatedContextTriangleRecord,
  type AnimatedEdgeRecord,
  type AnimatedNodeRecord,
  type AnimatedTriangleRecord,
} from './types.js';

export function buildAnimatedTrianglesAndEdges<TItem, TTagMeta, TClusterMeta>(input: {
  readonly mesh: SimplexMesh;
  readonly currentClusters: readonly ClusterDescriptor<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly currentPlacements: readonly ComputedItemPlacement<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly previousTriangles: readonly AnimatedTriangleRecord[];
  readonly snapColorImmediately: boolean;
}): {
  readonly triangleStates: AnimatedTriangleRecord[];
  readonly edgeRecords: AnimatedEdgeRecord[];
} {
  const prevTriMap = new Map<number, AnimatedTriangleRecord>();
  for (const tr of input.previousTriangles) {
    prevTriMap.set(tr.index, tr);
  }

  const fallbackOklab = hexToOklab('#1e293b');
  const triangleStates: AnimatedTriangleRecord[] = input.mesh.triangles.map((tri) => {
    const [va, vb, vc] = tri.vertices;
    const pA = input.mesh.vertices[va]!;
    const pB = input.mesh.vertices[vb]!;
    const pC = input.mesh.vertices[vc]!;
    const cA = input.currentClusters[va];
    const cB = input.currentClusters[vb];
    const cC = input.currentClusters[vc];
    const mixed = mixOklabColors([
      { oklab: cA?.oklab ?? fallbackOklab, weight: 1 },
      { oklab: cB?.oklab ?? fallbackOklab, weight: 1 },
      { oklab: cC?.oklab ?? fallbackOklab, weight: 1 },
    ]);
    const prev = prevTriMap.get(tri.index);
    const startOklab: [number, number, number] =
      prev && !input.snapColorImmediately
        ? [...prev.currentOklab]
        : [mixed.oklab[0], mixed.oklab[1], mixed.oklab[2]];

    let coveredItemCount = 0;
    let interiorItemCount = 0;
    for (const placement of input.currentPlacements) {
      const ucs = placement.layoutContext.unitClusters;
      if (ucs.length === 0) continue;
      let allInside = true;
      for (let k = 0; k < ucs.length; k++) {
        const cIdx = ucs[k]!.cluster.clusterIndex;
        if (cIdx !== va && cIdx !== vb && cIdx !== vc) {
          allInside = false;
          break;
        }
      }
      if (allInside) {
        coveredItemCount++;
        if (ucs.length === 3) {
          interiorItemCount++;
        }
      }
    }

    const targetPoints: readonly [Point2D, Point2D, Point2D] = [
      { x: pA.x, y: pA.y },
      { x: pB.x, y: pB.y },
      { x: pC.x, y: pC.y },
    ];
    return {
      index: tri.index,
      vertexIndices: [va, vb, vc],
      targetPoints,
      points: [targetPoints[0], targetPoints[1], targetPoints[2]],
      centroid: {
        x: (pA.x + pB.x + pC.x) / 3,
        y: (pA.y + pB.y + pC.y) / 3,
      },
      coveredItemCount,
      interiorItemCount,
      currentOklab: startOklab,
      targetOklab: mixed.oklab,
      fillHex: lerpOklabHex(
        startOklab,
        mixed.oklab,
        input.snapColorImmediately ? 1 : 0,
      ),
    };
  });

  const edgeRecords: AnimatedEdgeRecord[] = input.mesh.edges.map((e, idx) => {
    const a = input.mesh.vertices[e.a]!;
    const b = input.mesh.vertices[e.b]!;
    const cA = input.currentClusters[e.a];
    const cB = input.currentClusters[e.b];
    const mixed = mixOklabColors([
      { oklab: cA?.oklab ?? fallbackOklab, weight: 1 },
      { oklab: cB?.oklab ?? fallbackOklab, weight: 1 },
    ]);
    const targetA = { x: a.x, y: a.y };
    const targetB = { x: b.x, y: b.y };
    return {
      index: idx,
      vertexIndices: [e.a, e.b],
      targetA,
      targetB,
      a: targetA,
      b: targetB,
      mixedColorHex: mixed.hex,
    };
  });

  return { triangleStates, edgeRecords };
}

export function buildContextElements<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(input: {
  readonly activeZoomFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> | undefined;
  readonly solved: TwoPhaseLayoutResult;
  readonly sizeMultiplier: number | undefined;
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
}): {
  readonly contextTriangleStates: AnimatedContextTriangleRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextEdgeRecords: AnimatedContextEdgeRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextClusterNodes: AnimatedContextClusterRecord<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextItemNodes: AnimatedContextItemRecord<
    TItem,
    TContentVisual,
    TTagMeta,
    TClusterMeta
  >[];
} {
  const { activeZoomFrame, solved, visualResolver, renderer } = input;

  const contextTriangleStates: AnimatedContextTriangleRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[] =
    activeZoomFrame?.contextTriangles && activeZoomFrame.contextTriangles.length > 0
      ? activeZoomFrame.contextTriangles.map((ct, idx) => {
          const targetPoints: readonly [Point2D, Point2D, Point2D] = [
            ct.points[0],
            ct.points[1],
            ct.points[2],
          ];
          return {
            base: {
              index: -(idx + 1),
              vertexIndices: [-1, -1, -1] as const,
              points: targetPoints,
              centroid: ct.centroid,
              fillHex: ct.mixedColorHex,
              fillOpacity: 0.085,
              clusters: ct.clusters,
              coveredItemCount: ct.coveredItemCount,
              interiorItemCount: ct.interiorItemCount,
              isContext: true,
              neighborId: ct.neighborId,
              interaction: {
                isHovered: false,
                isFocused: false,
                isDimmed: true,
              },
            },
            targetPoints,
            points: [targetPoints[0], targetPoints[1], targetPoints[2]],
            centroid: ct.centroid,
            opacity: 1,
          };
        })
      : [];

  const contextEdgeRecords: AnimatedContextEdgeRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[] =
    activeZoomFrame?.contextEdges && activeZoomFrame.contextEdges.length > 0
      ? activeZoomFrame.contextEdges.map((ce, idx) => ({
          base: {
            index: -(idx + 1),
            vertexIndices: [-1, -1] as const,
            a: ce.a,
            b: ce.b,
            mixedColorHex: ce.mixedColorHex,
            clusters: ce.clusters,
            isHighlighted: false,
            isDimmed: true,
          },
          targetA: ce.a,
          targetB: ce.b,
          a: ce.a,
          b: ce.b,
          opacity: 1,
        }))
      : [];

  let contextClusterNodes: AnimatedContextClusterRecord<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] = [];
  if (
    activeZoomFrame?.contextClusters &&
    activeZoomFrame.contextClusters.length > 0
  ) {
    const ctxScale = Math.max(0.45, Math.min(0.86, solved.clusterScale * 0.85));
    contextClusterNodes = activeZoomFrame.contextClusters.map((cc) => {
      const visual = visualResolver.resolveClusterVisual(cc.cluster);
      const cacheKey = visualResolver.getVisualCacheKey(visual);
      const hull = renderer.measureClusterHull(visual, cacheKey);
      return {
        id: cc.id,
        neighborId: cc.neighborId,
        cluster: cc.cluster,
        visual,
        cacheKey,
        hull,
        targetX: cc.x,
        targetY: cc.y,
        targetScale: ctxScale,
        x: cc.x,
        y: cc.y,
        scale: ctxScale,
        opacity: 0.34,
      };
    });
  }

  let contextItemNodes: AnimatedContextItemRecord<
    TItem,
    TContentVisual,
    TTagMeta,
    TClusterMeta
  >[] = [];
  if (activeZoomFrame?.contextItems && activeZoomFrame.contextItems.length > 0) {
    const sizeMult = Math.max(0.1, input.sizeMultiplier ?? 1);
    const fallbackItemScale = Math.max(
      0.3 * sizeMult,
      Math.min(0.8 * sizeMult, solved.contentScale * 0.82),
    );
    contextItemNodes = activeZoomFrame.contextItems.map((ci) => {
      const visual = visualResolver.resolveContentVisual(
        ci.item,
        ci.layoutContext,
      );
      const cacheKey = visualResolver.getVisualCacheKey(visual);
      const hull = renderer.measureContentHull(visual, cacheKey);
      const ctxScale =
        ci.scale !== undefined
          ? Math.max(0.26 * sizeMult, Math.min(0.92 * sizeMult, ci.scale))
          : fallbackItemScale;
      return {
        id: ci.id,
        rawId: ci.rawId,
        neighborId: ci.neighborId,
        item: ci.item,
        layoutContext: ci.layoutContext,
        visual,
        cacheKey,
        hull,
        targetX: ci.x,
        targetY: ci.y,
        targetScale: ctxScale,
        x: ci.x,
        y: ci.y,
        scale: ctxScale,
        opacity: 0.32,
      };
    });
  }

  return {
    contextTriangleStates,
    contextEdgeRecords,
    contextClusterNodes,
    contextItemNodes,
  };
}

export function reconcileSpringNodes<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(input: {
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
  readonly solved: TwoPhaseLayoutResult;
  readonly snapImmediately: boolean;
  readonly emptyClusterBehavior: EmptyClusterBehavior;
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
}): void {
  const activeClusterIds = new Set<string>();
  input.resolvedClusters.forEach((rc, idx) => {
    const placed = input.solved.clusters[idx]!;
    const uid = rc.cluster.clusterUid;
    activeClusterIds.add(uid);
    const clusterTargetOpacity =
      input.emptyClusterBehavior === 'hide' && rc.cluster.members.length === 0
        ? 0
        : 1;

    const existing = input.clusterNodes.get(uid);
    if (!existing || input.snapImmediately) {
      input.clusterNodes.set(uid, {
        id: uid,
        status: 'active',
        x: { value: placed.x, velocity: 0, target: placed.x },
        y: { value: placed.y, velocity: 0, target: placed.y },
        scale: {
          value: input.snapImmediately ? placed.scale : placed.scale * 0.72,
          velocity: 0,
          target: placed.scale,
        },
        opacity: {
          value: input.snapImmediately ? clusterTargetOpacity : 0,
          velocity: 0,
          target: clusterTargetOpacity,
        },
        visual: rc.visual,
        hull: rc.hull,
        cacheKey: rc.cacheKey,
        transition: null,
        domain: rc.cluster,
      });
    } else {
      const nextTransition = retargetVisualTransition(
        existing.transition,
        existing.visual,
        existing.hull,
        existing.cacheKey,
        rc.visual,
        rc.hull,
        rc.cacheKey,
      );
      existing.status = 'active';
      existing.x.target = placed.x;
      existing.y.target = placed.y;
      existing.scale.target = placed.scale;
      existing.opacity.target = clusterTargetOpacity;
      existing.visual = rc.visual;
      existing.hull = rc.hull;
      existing.cacheKey = rc.cacheKey;
      existing.transition = nextTransition;
      existing.domain = rc.cluster;
    }
  });

  for (const [uid, node] of input.clusterNodes) {
    if (!activeClusterIds.has(uid)) {
      if (input.snapImmediately) {
        input.clusterNodes.delete(uid);
      } else {
        node.status = 'exiting';
        node.opacity.target = 0;
        node.scale.target = node.scale.value * 0.7;
      }
    }
  }

  const activeItemIds = new Set<string>();
  input.resolvedItems.forEach((ri, idx) => {
    const placed = input.solved.items[idx]!;
    const id = ri.placement.id;
    const targetOpacity = computeClusterStarItemRestOpacity(
      input.activeZoomFrame,
      ri.placement.layoutContext.unitClusters,
    );
    activeItemIds.add(id);

    const existing = input.itemNodes.get(id);
    if (!existing || input.snapImmediately) {
      input.itemNodes.set(id, {
        id,
        status: 'active',
        x: {
          value: input.snapImmediately ? placed.x : ri.placement.anchorX,
          velocity: 0,
          target: placed.x,
        },
        y: {
          value: input.snapImmediately ? placed.y : ri.placement.anchorY,
          velocity: 0,
          target: placed.y,
        },
        scale: {
          value: input.snapImmediately ? placed.scale : placed.scale * 0.5,
          velocity: 0,
          target: placed.scale,
        },
        opacity: {
          value: input.snapImmediately ? targetOpacity : 0,
          velocity: 0,
          target: targetOpacity,
        },
        visual: ri.visual,
        hull: ri.hull,
        cacheKey: ri.cacheKey,
        transition: null,
        domain: ri.placement,
      });
    } else {
      const nextTransition = retargetVisualTransition(
        existing.transition,
        existing.visual,
        existing.hull,
        existing.cacheKey,
        ri.visual,
        ri.hull,
        ri.cacheKey,
      );
      existing.status = 'active';
      existing.x.target = placed.x;
      existing.y.target = placed.y;
      existing.scale.target = placed.scale;
      existing.opacity.target = targetOpacity;
      existing.visual = ri.visual;
      existing.hull = ri.hull;
      existing.cacheKey = ri.cacheKey;
      existing.transition = nextTransition;
      existing.domain = ri.placement;
    }
  });

  for (const [id, node] of input.itemNodes) {
    if (!activeItemIds.has(id)) {
      if (input.snapImmediately) {
        input.itemNodes.delete(id);
      } else {
        node.status = 'exiting';
        node.opacity.target = 0;
        node.scale.target = Math.max(0.05, node.scale.value * 0.6);
      }
    }
  }
}
