import { mixOklabColors } from '../oklab.js';
import type { ClusterDescriptor } from '../types.js';
import {
  buildSubdividedTriangleMeshWithTransform,
  computeContextAwarePadding,
} from './geometry.js';
import {
  buildClusterBreadcrumbInfo,
  buildClusterSpotlightSetup,
  buildMixWeights,
  buildNeighborhoodContext,
  buildSectorPartitionFrame,
  buildSynthesizedClusterDescriptor,
  buildTriangleBreadcrumbInfo,
  computeFullScaleStats,
  defaultClusterCode,
  deriveCornerParentContextLabel,
  evaluateTriangleFrameNeighbors,
  executeClusterStarDrill,
  executeSingleTriangleFocusDrill,
  formatCompactBridgeLabel,
  formatMixLabel,
  getFrameVertexRootWeights,
  isItemCoveredByVertices,
  mixRootWeightMaps,
  pairEdgeKey,
  parseScopedNeighborId,
  projectItemOntoTriangleBarycentric,
  resolveReadableClusterName,
  truncateClean,
} from './shared.js';
import {
  DEFAULT_FULL_SCALE_THRESHOLD,
  MAX_ZOOM_DRILL_DEPTH,
  type BarycentricZoomStrategyOptions,
  type InternalFrameMeta,
  type SimplexZoomStrategy,
  type ZoomClusterDrillContext,
  type ZoomDrillOutcome,
  type ZoomItemAnchorInput,
  type ZoomTriangleDrillContext,
} from './types.js';

export function executeBarycentricTriangleDrill<TItem, TTagMeta, TClusterMeta>(
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
  const itemLocalCoords = coveredItems.map((it) => ({
    item: it,
    ...projectItemOntoTriangleBarycentric(
      parentFrame,
      it,
      v0,
      v1,
      v2,
      w0Base,
      w1Base,
      w2Base,
    ),
  }));

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

  const vWeights: ReadonlyMap<number, number>[] = [
    effW0,
    effW1,
    effW2,
    mixRootWeightMaps(effW0, 0.5, effW1, 0.5),
    mixRootWeightMaps(effW1, 0.5, effW2, 0.5),
    mixRootWeightMaps(effW2, 0.5, effW0, 0.5),
  ];

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
        rawUnitWeights = [
          { clusterIndex: 0, weight: Math.max(0, 2 * u0 - 1) },
          { clusterIndex: 3, weight: 2 * u1 },
          { clusterIndex: 5, weight: 2 * u2 },
        ];
      } else if (u1 >= 0.5 - eps) {
        rawUnitWeights = [
          { clusterIndex: 3, weight: 2 * u0 },
          { clusterIndex: 1, weight: Math.max(0, 2 * u1 - 1) },
          { clusterIndex: 4, weight: 2 * u2 },
        ];
      } else if (u2 >= 0.5 - eps) {
        rawUnitWeights = [
          { clusterIndex: 5, weight: 2 * u0 },
          { clusterIndex: 4, weight: 2 * u1 },
          { clusterIndex: 2, weight: Math.max(0, 2 * u2 - 1) },
        ];
      } else {
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

    const {
      targetVert,
      sourceSpan,
      sourceTrianglePoints,
      focusPadding,
      spotContext,
    } = buildClusterSpotlightSetup({
      clusterIndex,
      parentFrame,
      directItems,
      helpers,
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
