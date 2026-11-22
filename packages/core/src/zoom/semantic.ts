import type { NormalizedContentItem } from '../clustering.js';
import { mixOklabColors } from '../oklab.js';
import type {
  ClusterDescriptor,
  SimplexMesh,
  TagDescriptor,
} from '../types.js';
import { createBarycentricZoomStrategy } from './barycentric.js';
import {
  buildSubdividedTriangleMeshWithTransform,
  computeContextAwarePadding,
} from './geometry.js';
import {
  buildMixWeights,
  buildNeighborhoodContext,
  buildSectorPartitionFrame,
  buildSynthesizedClusterDescriptor,
  buildTriangleBreadcrumbInfo,
  computeFullScaleStats,
  defaultClusterCode,
  deriveCornerParentContextLabel,
  evaluateTriangleFrameNeighbors,
  executeSingleTriangleFocusDrill,
  extractHumanExemplarTitle,
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
  SUB_MESH_VERTEX_BARY,
  type InternalFrameMeta,
  type SemanticZoomStrategyOptions,
  type SimplexZoomStrategy,
  type ZoomDrillOutcome,
  type ZoomItemAnchorInput,
  type ZoomTriangleDrillContext,
} from './types.js';

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

  for (const tag of discriminativeTags) {
    let alreadyPlaced = false;
    for (let v = 0; v < 6; v++) {
      if (buckets[v]!.has(tag)) {
        alreadyPlaced = true;
        break;
      }
    }
    if (alreadyPlaced) continue;

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

  const candidateTags = discriminativeTags.slice(0, 10);
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const tag of candidateTags) {
      for (let targetV = 0; targetV < 6; targetV++) {
        if (targetV === baseOnlyVertex) continue;
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
      const { rootWeights: rw, l0, l1, l2 } = projectItemOntoTriangleBarycentric(
        parentFrame,
        it,
        v0,
        v1,
        v2,
        w0Base,
        w1Base,
        w2Base,
      );
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

    const tagWeights = new Map<string, number>();
    for (const t of discriminativeTags) {
      const f = allItemTagFreq.get(t) ?? 1;
      tagWeights.set(t, 1 + Math.log((nItems + 1) / (f + 0.5)));
    }

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
    const tagLabelLookup = new Map<string, string>();
    for (const it of coveredItems) {
      for (const td of it.tags) {
        if (td.meta !== undefined && !tagMetaLookup.has(td.tag)) {
          tagMetaLookup.set(td.tag, td.meta);
        }
        if (td.label && !tagLabelLookup.has(td.tag)) {
          tagLabelLookup.set(td.tag, td.label);
        }
      }
    }
    for (const pc of parentCorners) {
      if (!pc) continue;
      for (const td of [...pc.coreTags, ...pc.sharedTags]) {
        if (td.meta !== undefined && !tagMetaLookup.has(td.tag)) {
          tagMetaLookup.set(td.tag, td.meta);
        }
        if (td.label && !tagLabelLookup.has(td.tag)) {
          tagLabelLookup.set(td.tag, td.label);
        }
      }
    }

    const resolveCustomTagLabel = (t: string): string | undefined => {
      const fromFn = helpers.formatTagLabel ? helpers.formatTagLabel(t).trim() : '';
      if (fromFn.length > 0) return fromFn;
      const fromExisting = tagLabelLookup.get(t)?.trim();
      return fromExisting && fromExisting.length > 0 ? fromExisting : undefined;
    };

    const formatTagDisplay = (t: string): string => {
      const customLabel = resolveCustomTagLabel(t);
      if (customLabel) return customLabel;
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

    const sharedUbiquitousDescs: TagDescriptor<TTagMeta>[] = ubiquitousTags.map((t) => {
      const label = resolveCustomTagLabel(t);
      return {
        tag: t,
        ...(label ? { label } : {}),
        frequency: allItemTagFreq.get(t) ?? nItems,
        meta: tagMetaLookup.get(t),
      };
    });

    const rawAssignedByVertex: readonly (readonly string[])[] = Array.from(
      { length: 6 },
      (_, vIdx) =>
        vIdx === chosen.baseOnlyVertex && (chosen.vertexTags[vIdx]?.length ?? 0) === 0
          ? ubiquitousTags.slice(0, 2)
          : (chosen.vertexTags[vIdx] ?? []),
    );

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
        const tagDescs: TagDescriptor<TTagMeta>[] = rankedTags.map((t) => {
          const label = resolveCustomTagLabel(t);
          return {
            tag: t,
            ...(label ? { label } : {}),
            frequency: allItemTagFreq.get(t) ?? helpers.corpus?.tagFreqMap.get(t) ?? 1,
            meta: tagMetaLookup.get(t),
          };
        });

        const fmt = formatMixLabel(vw, helpers.rootClusters);
        const mixWeights = buildMixWeights(vw, helpers.rootClusters);
        const conciseSubLabel = resolvedSubLabels[vIdx]!;
        const tagTitle =
          rankedTags.length > 0
            ? rankedTags.map((t) => formatTagDisplay(t)).join(' · ')
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
