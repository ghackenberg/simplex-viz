import type { ComputedItemPlacement } from '../clustering.js';
import type {
  CameraState,
  ClusterDescriptor,
  EmptyClusterBehavior,
  ItemFilterMode,
  ItemFilterPredicate,
  MeshEdgeRenderState,
  MeshTriangleRenderState,
  NodeRenderState,
  SceneFrameSnapshot,
} from '../types.js';
import {
  applyZoomAffine,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type ZoomFrameSpec,
} from '../zoom.js';
import {
  evaluateFlightCamera,
  resolveDrillableTriangleForActiveItem,
  type AnimatedContextClusterRecord,
  type AnimatedContextEdgeRecord,
  type AnimatedContextItemRecord,
  type AnimatedContextTriangleRecord,
  type AnimatedEdgeRecord,
  type AnimatedNodeRecord,
  type AnimatedTriangleRecord,
  type ZoomFlightState,
  type ZoomRegionBoundary,
} from './types.js';

export function computeZoomRegionBoundary<TItem, TTagMeta, TClusterMeta>(
  zoomMode: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>['mode'],
  zoomStack: readonly ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>[],
  triangleStates: readonly AnimatedTriangleRecord[],
): ZoomRegionBoundary<TItem, TTagMeta, TClusterMeta> {
  const isZoomedIn = zoomMode === 'drill-down' && zoomStack.length > 1;
  const activeZoomFrame = isZoomedIn ? zoomStack[zoomStack.length - 1] : undefined;
  const boundaryEdgeKeys = new Set<string>();
  const outerCornerVerts = new Set<number>();

  if (isZoomedIn && triangleStates.length > 0) {
    const edgeCounts = new Map<string, number>();
    for (const tr of triangleStates) {
      const [a, b, c] = tr.vertexIndices;
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const k = u < v ? `${u}:${v}` : `${v}:${u}`;
        edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
      }
    }
    for (const [k, count] of edgeCounts) {
      if (count === 1) {
        boundaryEdgeKeys.add(k);
      }
    }

    if (
      (activeZoomFrame?.kind === 'triangle' ||
        activeZoomFrame?.kind === 'cluster-spotlight') &&
      triangleStates.length > 1
    ) {
      outerCornerVerts.add(0);
      outerCornerVerts.add(1);
      outerCornerVerts.add(2);
    } else {
      for (const k of boundaryEdgeKeys) {
        const sep = k.indexOf(':');
        const u = Number(k.slice(0, sep));
        const v = Number(k.slice(sep + 1));
        if (activeZoomFrame?.kind !== 'cluster-star' || u !== 0) {
          outerCornerVerts.add(u);
        }
        if (activeZoomFrame?.kind !== 'cluster-star' || v !== 0) {
          outerCornerVerts.add(v);
        }
      }
    }
  }

  return {
    isZoomedIn,
    activeFrameKind: activeZoomFrame?.kind,
    boundaryEdgeKeys,
    outerCornerVerts,
  };
}

export function buildTriangleRenderStateFromRecord<TItem, TTagMeta, TClusterMeta>(
  tr: AnimatedTriangleRecord,
  input: {
    readonly hoveredTriangleIndex: number | null;
    readonly focusedTriangleIndex: number | null;
    readonly neighborReturnHighlight:
      | { readonly kind: 'triangle'; readonly triangleIndex: number }
      | { readonly kind: 'cluster'; readonly clusterUid: string }
      | null;
    readonly zoomMode: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>['mode'];
    readonly currentZoomState: SimplexZoomState;
    readonly currentClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
    readonly triangleCount: number;
  },
  hasTriangleFocus: boolean,
  zoomBoundary: ZoomRegionBoundary<TItem, TTagMeta, TClusterMeta>,
  drillableTriSet?: ReadonlySet<number> | null,
): MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta> {
  const [va, vb, vc] = tr.vertexIndices;
  const isHovered = input.hoveredTriangleIndex === tr.index;
  const isFocused = input.focusedTriangleIndex === tr.index;
  const isReturnHighlighted =
    input.neighborReturnHighlight?.kind === 'triangle' &&
    input.neighborReturnHighlight.triangleIndex === tr.index;
  const isHighlighted = isReturnHighlighted || zoomBoundary.isZoomedIn;
  const isDimmed =
    hasTriangleFocus && !isFocused && !isHovered && !isReturnHighlighted;
  const isDrillable =
    drillableTriSet !== undefined
      ? Boolean(drillableTriSet?.has(tr.index))
      : input.zoomMode === 'drill-down' &&
        input.currentZoomState.drillableTriangleIndices.includes(tr.index);

  const pairKey = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);
  const useMacroBoundaryMask =
    zoomBoundary.isZoomedIn &&
    input.triangleCount > 1 &&
    !isHovered &&
    !isFocused &&
    !isReturnHighlighted;

  return {
    index: tr.index,
    vertexIndices: tr.vertexIndices,
    points: tr.points,
    centroid: tr.centroid,
    fillHex: tr.fillHex,
    fillOpacity: 0.085,
    opacity: tr.flightOpacity,
    isDrillable: isDrillable || undefined,
    clusters: [
      input.currentClusters[va],
      input.currentClusters[vb],
      input.currentClusters[vc],
    ],
    coveredItemCount: tr.coveredItemCount,
    interiorItemCount: tr.interiorItemCount,
    highlightBoundary: useMacroBoundaryMask
      ? {
          edges: [
            zoomBoundary.boundaryEdgeKeys.has(pairKey(va, vb)),
            zoomBoundary.boundaryEdgeKeys.has(pairKey(vb, vc)),
            zoomBoundary.boundaryEdgeKeys.has(pairKey(vc, va)),
          ],
          corners: [
            zoomBoundary.outerCornerVerts.has(va),
            zoomBoundary.outerCornerVerts.has(vb),
            zoomBoundary.outerCornerVerts.has(vc),
          ],
        }
      : undefined,
    interaction: {
      isHovered,
      isFocused,
      isDimmed,
      isHighlighted,
    },
  };
}

export function buildContextTriangleRenderStateFromRecord<TItem, TTagMeta, TClusterMeta>(
  ct: AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta>,
  hoveredTriangleIndex: number | null,
): MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta> {
  return {
    ...ct.base,
    points: ct.points,
    centroid: ct.centroid,
    opacity: ct.opacity < 0.999 ? ct.opacity : undefined,
    interaction: {
      isHovered: hoveredTriangleIndex === ct.base.index,
      isFocused: false,
      isDimmed: true,
      isHighlighted: false,
    },
  };
}

export interface SnapshotBuildInput<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly camera: CameraState;
  readonly showHulls: boolean;
  readonly zoomMode: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>['mode'];
  readonly zoomStack: readonly ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>[];
  readonly currentZoomState: SimplexZoomState;
  readonly currentClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
  readonly triangleStates: readonly AnimatedTriangleRecord[];
  readonly edgeRecords: readonly AnimatedEdgeRecord[];
  readonly contextTriangleStates: readonly AnimatedContextTriangleRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
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
    AnimatedNodeRecord<TClusterVisual, ClusterDescriptor<TItem, TTagMeta, TClusterMeta>>
  >;
  readonly itemNodes: ReadonlyMap<
    string,
    AnimatedNodeRecord<TContentVisual, ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>>
  >;
  readonly activeFlight: ZoomFlightState<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null;
  readonly neighborReturnHighlight:
    | { readonly kind: 'triangle'; readonly triangleIndex: number }
    | { readonly kind: 'cluster'; readonly clusterUid: string }
    | null;
  readonly focusedItemId: string | null;
  readonly focusedItemHighlight: boolean;
  readonly focusedClusterUid: string | null;
  readonly focusedTriangleIndex: number | null;
  readonly hoveredTriangleIndex: number | null;
  readonly hoveredClusterUid: string | null;
  readonly hoveredContextClusterId: string | null;
  readonly hoveredContentId: string | null;
  readonly pinnedIds: ReadonlySet<string>;
  readonly highlightedIds: ReadonlySet<string>;
  readonly selectedIds: ReadonlySet<string>;
  readonly emptyClusterBehavior: EmptyClusterBehavior;
  readonly itemFilterPredicate: ItemFilterPredicate<TItem> | null;
  readonly itemFilterMode: ItemFilterMode;
  readonly filteredOutItemIds: ReadonlySet<string>;
}

export function buildSceneFrameSnapshot<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  input: SnapshotBuildInput<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): SceneFrameSnapshot<
  TContentVisual,
  TClusterVisual,
  TItem,
  TTagMeta,
  TClusterMeta
> {
  const zoomBoundary = computeZoomRegionBoundary(
    input.zoomMode,
    input.zoomStack,
    input.triangleStates,
  );
  const returnTriIdx =
    input.neighborReturnHighlight?.kind === 'triangle'
      ? input.neighborReturnHighlight.triangleIndex
      : null;
  const returnTriangle =
    returnTriIdx !== null ? input.triangleStates[returnTriIdx] : undefined;
  const returnTriVertSet = returnTriangle
    ? new Set(returnTriangle.vertexIndices)
    : null;
  const returnClusterUid =
    input.neighborReturnHighlight?.kind === 'cluster'
      ? input.neighborReturnHighlight.clusterUid
      : null;

  const hasFocusedItemHighlight =
    input.focusedItemId !== null && input.focusedItemHighlight;
  const hasTriangleOnlyFocus =
    input.focusedTriangleIndex !== null &&
    input.focusedClusterUid === null &&
    input.highlightedIds.size === 0 &&
    !hasFocusedItemHighlight;
  const focusedTriangle =
    input.focusedTriangleIndex !== null
      ? input.triangleStates[input.focusedTriangleIndex]
      : undefined;
  const hoveredTriangle =
    input.hoveredTriangleIndex !== null && input.hoveredTriangleIndex >= 0
      ? input.triangleStates[input.hoveredTriangleIndex]
      : undefined;
  const focusedTriVertSet = focusedTriangle
    ? new Set(focusedTriangle.vertexIndices)
    : null;
  const hoveredTriVertSet = hoveredTriangle
    ? new Set(hoveredTriangle.vertexIndices)
    : null;

  const hasHighlightFocus =
    input.highlightedIds.size > 0 ||
    hasFocusedItemHighlight ||
    input.focusedClusterUid !== null ||
    hasTriangleOnlyFocus;

  const flightEval = input.activeFlight
    ? evaluateFlightCamera(input.activeFlight, input.activeFlight.rawProgress)
    : null;

  const clusters: NodeRenderState<TClusterVisual>[] = [];
  if (input.activeFlight && flightEval) {
    const { u, camScale, M_u } = flightEval;
    const fadeOut = 1 - Math.min(1, u / 0.78);
    if (fadeOut > 0.005) {
      for (const dc of input.activeFlight.departingClusters) {
        const pt = applyZoomAffine(M_u, dc.localStart);
        const localScale =
          dc.localStartScale + (dc.localEndScale - dc.localStartScale) * u;
        clusters.push({
          id: dc.id,
          x: pt.x,
          y: pt.y,
          scale: Math.max(0.08, camScale * localScale),
          opacity: dc.startOpacity * fadeOut,
          visual: dc.visual,
          hull: dc.hull,
          cacheKey: dc.cacheKey,
          isContext: true,
          interaction: {
            isHovered: false,
            isPinned: false,
            isDimmed: true,
            isHighlighted: false,
          },
          transition: null,
        });
      }
    }
  }

  for (const cc of input.contextClusterNodes) {
    const isHovered = input.hoveredContextClusterId === cc.id;
    clusters.push({
      id: cc.id,
      x: cc.x,
      y: cc.y,
      scale: cc.scale,
      opacity: cc.opacity,
      visual: cc.visual,
      hull: cc.hull,
      cacheKey: cc.cacheKey,
      isContext: true,
      neighborId: cc.neighborId,
      interaction: {
        isHovered,
        isPinned: false,
        isDimmed: true,
        isHighlighted: false,
      },
      transition: null,
    });
  }

  for (const cNode of input.clusterNodes.values()) {
    const isHovered = input.hoveredClusterUid === cNode.id;
    const isFocusedCluster = input.focusedClusterUid === cNode.id;
    const isReturnCluster = returnClusterUid === cNode.id;
    const inReturnTriangle = Boolean(
      returnTriVertSet?.has(cNode.domain.clusterIndex) &&
        cNode.domain.role !== 'intermediate',
    );
    const isZoomHighlightedCluster = Boolean(
      zoomBoundary.isZoomedIn &&
        (zoomBoundary.activeFrameKind === 'cluster-star'
          ? cNode.domain.clusterIndex === 0
          : zoomBoundary.activeFrameKind === 'triangle-focus'
            ? zoomBoundary.outerCornerVerts.has(cNode.domain.clusterIndex)
            : cNode.domain.role !== 'intermediate' &&
              zoomBoundary.outerCornerVerts.has(cNode.domain.clusterIndex)),
    );
    const inFocusedTriangle = Boolean(
      hasTriangleOnlyFocus && focusedTriVertSet?.has(cNode.domain.clusterIndex),
    );
    const isPinned = input.pinnedIds.has(cNode.id);
    const isEmptyCluster = cNode.domain.members.length === 0;
    const isHiddenEmptyCluster =
      input.emptyClusterBehavior === 'hide' && isEmptyCluster;
    const isDimmed =
      (input.focusedClusterUid !== null && !isFocusedCluster && !isHovered) ||
      (hasTriangleOnlyFocus && !inFocusedTriangle && !isHovered) ||
      (input.emptyClusterBehavior === 'dim' && isEmptyCluster && !isHovered);

    clusters.push({
      id: cNode.id,
      x: cNode.x.value,
      y: cNode.y.value,
      scale: cNode.scale.value,
      opacity: cNode.opacity.value,
      visual: cNode.visual,
      hull: cNode.hull,
      cacheKey: cNode.cacheKey,
      isPassThrough: isHiddenEmptyCluster ? true : undefined,
      interaction: {
        isHovered,
        isPinned,
        isDimmed,
        isHighlighted:
          isFocusedCluster ||
          inFocusedTriangle ||
          isReturnCluster ||
          inReturnTriangle ||
          isZoomHighlightedCluster,
      },
      transition: cNode.transition
        ? {
            from: cNode.transition.from,
            fromHull: cNode.transition.fromHull,
            fromCacheKey: cNode.transition.fromCacheKey,
            to: cNode.transition.to,
            toHull: cNode.transition.toHull,
            toCacheKey: cNode.transition.toCacheKey,
            progress: cNode.transition.progress,
          }
        : null,
    });
  }

  const items: NodeRenderState<TContentVisual>[] = [];
  if (input.activeFlight && flightEval) {
    const { u, camScale, M_u } = flightEval;
    const fadeOut = 1 - Math.min(1, u / 0.78);
    if (fadeOut > 0.005) {
      for (const di of input.activeFlight.departingItems) {
        const pt = applyZoomAffine(M_u, di.localStart);
        const localScale =
          di.localStartScale + (di.localEndScale - di.localStartScale) * u;
        items.push({
          id: di.id,
          x: pt.x,
          y: pt.y,
          scale: Math.max(0.08, camScale * localScale),
          opacity: di.startOpacity * fadeOut,
          visual: di.visual,
          hull: di.hull,
          cacheKey: di.cacheKey,
          isContext: true,
          interaction: {
            isHovered: false,
            isPinned: false,
            isDimmed: true,
            isHighlighted: false,
          },
          transition: null,
        });
      }
    }
  }

  for (const ci of input.contextItemNodes) {
    items.push({
      id: ci.id,
      x: ci.x,
      y: ci.y,
      scale: ci.scale,
      opacity: ci.opacity,
      visual: ci.visual,
      hull: ci.hull,
      cacheKey: ci.cacheKey,
      isContext: true,
      isPassThrough: true,
      neighborId: ci.neighborId,
      interaction: {
        isHovered: false,
        isPinned: false,
        isDimmed: true,
        isHighlighted: false,
      },
      transition: null,
    });
  }

  const drillableTriSetForItems =
    input.zoomMode === 'drill-down' &&
    input.currentZoomState.drillableTriangleIndices.length > 0
      ? new Set(input.currentZoomState.drillableTriangleIndices)
      : null;

  for (const iNode of input.itemNodes.values()) {
    const isFilteredOut =
      input.itemFilterPredicate !== null && input.filteredOutItemIds.has(iNode.id);
    const isHiddenByFilter = isFilteredOut && input.itemFilterMode === 'hide';
    const isDimmedByFilter = isFilteredOut && input.itemFilterMode === 'dim';
    const isPassThrough =
      isHiddenByFilter ||
      (drillableTriSetForItems !== null &&
        resolveDrillableTriangleForActiveItem(
          iNode,
          { x: iNode.x.value, y: iNode.y.value },
          drillableTriSetForItems,
          input.triangleStates,
        ) !== null);
    const isProgrammaticallyFocused =
      !isHiddenByFilter && input.focusedItemId === iNode.id;
    const isHovered =
      (!isPassThrough || isProgrammaticallyFocused) &&
      input.hoveredContentId === iNode.id;
    const isPinned = input.pinnedIds.has(iNode.id);
    const isSelected = !isHiddenByFilter && input.selectedIds.has(iNode.id);
    const belongsToFocusedCluster =
      input.focusedClusterUid !== null &&
      iNode.domain.layoutContext.unitClusters.some(
        (uc) => uc.cluster.clusterUid === input.focusedClusterUid,
      );
    const belongsToFocusedTriangle =
      hasTriangleOnlyFocus &&
      focusedTriVertSet !== null &&
      iNode.domain.layoutContext.unitClusters.length > 0 &&
      iNode.domain.layoutContext.unitClusters.every((uc) =>
        focusedTriVertSet.has(uc.cluster.clusterIndex),
      );
    const isHighlighted =
      !isHiddenByFilter &&
      (input.highlightedIds.has(iNode.id) ||
        (isProgrammaticallyFocused && input.focusedItemHighlight) ||
        belongsToFocusedCluster ||
        belongsToFocusedTriangle);
    const isDimmed =
      !isHiddenByFilter &&
      ((hasHighlightFocus &&
        !isHighlighted &&
        !isHovered &&
        !isPinned &&
        !isSelected) ||
        isDimmedByFilter);
    const effectiveItemOpacity = isHiddenByFilter
      ? 0
      : !input.activeFlight
        ? isPinned ||
          isSelected ||
          input.highlightedIds.has(iNode.id) ||
          (isProgrammaticallyFocused && input.focusedItemHighlight)
          ? Math.max(iNode.opacity.value, 1)
          : isHovered
            ? Math.max(iNode.opacity.value, 0.92)
            : iNode.opacity.value
        : iNode.opacity.value;

    items.push({
      id: iNode.id,
      x: iNode.x.value,
      y: iNode.y.value,
      scale: iNode.scale.value,
      opacity: effectiveItemOpacity,
      visual: iNode.visual,
      hull: iNode.hull,
      cacheKey: iNode.cacheKey,
      isPassThrough: isPassThrough || undefined,
      isFilteredOut: isFilteredOut || undefined,
      interaction: {
        isHovered,
        isPinned,
        isDimmed,
        isHighlighted,
        isSelected,
      },
      transition: iNode.transition
        ? {
            from: iNode.transition.from,
            fromHull: iNode.transition.fromHull,
            fromCacheKey: iNode.transition.fromCacheKey,
            to: iNode.transition.to,
            toHull: iNode.transition.toHull,
            toCacheKey: iNode.transition.toCacheKey,
            progress: iNode.transition.progress,
          }
        : null,
    });
  }

  const hasTriangleFocus = input.focusedTriangleIndex !== null;
  const ghostTriangles: MeshTriangleRenderState<
    TItem,
    TTagMeta,
    TClusterMeta
  >[] = [];
  if (input.activeFlight && flightEval) {
    const { u, M_u } = flightEval;
    const fadeOut = 1 - u;
    if (fadeOut > 0.005) {
      input.activeFlight.departingTriangles.forEach((dt, idx) => {
        const p0 = applyZoomAffine(M_u, dt.localPoints[0]);
        const p1 = applyZoomAffine(M_u, dt.localPoints[1]);
        const p2 = applyZoomAffine(M_u, dt.localPoints[2]);
        ghostTriangles.push({
          ...dt.base,
          index: -10000 - idx,
          points: [p0, p1, p2],
          centroid: {
            x: (p0.x + p1.x + p2.x) / 3,
            y: (p0.y + p1.y + p2.y) / 3,
          },
          opacity: dt.startOpacity * fadeOut,
        });
      });
    }
  }

  const contextTriangles = input.contextTriangleStates.map((ct) =>
    buildContextTriangleRenderStateFromRecord(ct, input.hoveredTriangleIndex),
  );
  const triInput = {
    hoveredTriangleIndex: input.hoveredTriangleIndex,
    focusedTriangleIndex: input.focusedTriangleIndex,
    neighborReturnHighlight: input.neighborReturnHighlight,
    zoomMode: input.zoomMode,
    currentZoomState: input.currentZoomState,
    currentClusters: input.currentClusters,
    triangleCount: input.triangleStates.length,
  };
  const triangles: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>[] = [
    ...ghostTriangles,
    ...contextTriangles,
    ...input.triangleStates.map((tr) =>
      buildTriangleRenderStateFromRecord(
        tr,
        triInput,
        hasTriangleFocus,
        zoomBoundary,
        drillableTriSetForItems,
      ),
    ),
  ];

  const ghostEdges: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[] = [];
  if (input.activeFlight && flightEval) {
    const { u, M_u } = flightEval;
    const fadeOut = 1 - u;
    if (fadeOut > 0.005) {
      input.activeFlight.departingEdges.forEach((de, idx) => {
        ghostEdges.push({
          ...de.base,
          index: -10000 - idx,
          a: applyZoomAffine(M_u, de.localA),
          b: applyZoomAffine(M_u, de.localB),
          opacity: de.startOpacity * fadeOut,
        });
      });
    }
  }

  const contextEdges: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[] =
    input.contextEdgeRecords.map((ce) => ({
      ...ce.base,
      a: ce.a,
      b: ce.b,
      opacity: ce.opacity < 0.999 ? ce.opacity : undefined,
    }));

  const edges: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[] = [
    ...ghostEdges,
    ...contextEdges,
    ...input.edgeRecords.map((edge) => {
      const [ea, eb] = edge.vertexIndices;
      const edgeKey = ea < eb ? `${ea}:${eb}` : `${eb}:${ea}`;
      const cA = input.currentClusters[ea];
      const cB = input.currentClusters[eb];
      const onFocusedTri = Boolean(
        focusedTriVertSet && focusedTriVertSet.has(ea) && focusedTriVertSet.has(eb),
      );
      const onHoveredTri = Boolean(
        hoveredTriVertSet && hoveredTriVertSet.has(ea) && hoveredTriVertSet.has(eb),
      );
      const onReturnTri = Boolean(
        returnTriVertSet && returnTriVertSet.has(ea) && returnTriVertSet.has(eb),
      );
      const onZoomBoundary =
        zoomBoundary.isZoomedIn && zoomBoundary.boundaryEdgeKeys.has(edgeKey);
      const touchesZoomStarCenter =
        zoomBoundary.isZoomedIn &&
        zoomBoundary.activeFrameKind === 'cluster-star' &&
        (ea === 0 || eb === 0);
      const touchesFocusedCluster =
        input.focusedClusterUid !== null &&
        (cA?.clusterUid === input.focusedClusterUid ||
          cB?.clusterUid === input.focusedClusterUid);
      const touchesHoveredCluster =
        input.hoveredClusterUid !== null &&
        (cA?.clusterUid === input.hoveredClusterUid ||
          cB?.clusterUid === input.hoveredClusterUid);
      const touchesReturnCluster =
        returnClusterUid !== null &&
        (cA?.clusterUid === returnClusterUid ||
          cB?.clusterUid === returnClusterUid);
      return {
        index: edge.index,
        vertexIndices: edge.vertexIndices,
        a: edge.a,
        b: edge.b,
        mixedColorHex: edge.mixedColorHex,
        clusters: [cA, cB] as const,
        isHighlighted:
          onFocusedTri ||
          onHoveredTri ||
          onReturnTri ||
          onZoomBoundary ||
          touchesZoomStarCenter ||
          touchesFocusedCluster ||
          touchesHoveredCluster ||
          touchesReturnCluster,
        opacity: edge.flightOpacity,
      };
    }),
  ];

  return {
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    camera: input.camera,
    triangles,
    edges,
    clusters,
    items,
    showHulls: input.showHulls,
  };
}
