import {
  embedSimilarityMatrixOnMesh,
  matchClustersHungarian,
} from '../clustering.js';
import { assignDiscriminativeClusterLabels } from '../discriminativeLabels.js';
import type { ClusterMemberRef, DefaultTaggedItem } from '../types.js';
import type { SubspaceZoomFeature } from '../zoom.js';
import { extractHeuristicItemLabel } from './embeddingClustering.js';
import type {
  ClusteringStrategyContext,
  ClusteringStrategyOutput,
  ComputedItemAnchor,
  ComputedTopicCluster,
  SimplexClusteringStrategy,
} from './types.js';

export interface SimilarityClusteringOptions<TItem> {
  /** Pairwise similarity function in `[0, 1]` between any two domain items. */
  readonly getSimilarity: (a: TItem, b: TItem) => number;
  /** Preferred number of cluster medoids `K` when using an adaptive mesh. */
  readonly clusterCount?: number;
  /** Projection rule onto mesh simplices. Default: `'simplex-projection'`. */
  readonly anchorRule?: 'simplex-projection' | 'top-1';
  /** Optional custom cluster label derivation from medoid & top members. */
  readonly deriveLabel?: (
    representativeMembers: readonly ClusterMemberRef<TItem>[],
    clusterIndex: number,
  ) => string;
  /** Optional interpretable features used to assign base-rate-aware, collision-free `defaultLabel`s across sibling clusters. */
  readonly features?: readonly SubspaceZoomFeature<TItem>[];
  /** Number of representative items retained per cluster. Default: `3`. */
  readonly representativeCount?: number;
}

/**
 * Representation-agnostic pairwise similarity clustering strategy (PAM k-Medoids + QAP mesh embedding).
 * Ideal when items have no fixed-length embedding vector and no tags, only a custom kernel,
 * graph distance, or domain similarity metric `getSimilarity(a, b)`.
 */
export function createSimilarityClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  options: SimilarityClusteringOptions<TItem>,
): SimplexClusteringStrategy<TItem, TTagMeta> {
  const anchorRule = options.anchorRule ?? 'simplex-projection';
  const repCount = Math.max(1, options.representativeCount ?? 3);

  const runSimilarityClustering = (
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta> => {
    const K = ctx.mesh.vertices.length;
    const N = ctx.items.length;
    if (K === 0 || N === 0) {
      return { clusters: [], items: [], uniqueTags: [] };
    }

    // 1. Symmetric N x N similarity matrix
    const sim = Array.from({ length: N }, () => new Float64Array(N));
    for (let i = 0; i < N; i++) {
      sim[i]![i] = 1;
      for (let j = i + 1; j < N; j++) {
        const s = Math.max(
          0,
          Math.min(1, options.getSimilarity(ctx.items[i]!.item, ctx.items[j]!.item)),
        );
        sim[i]![j] = s;
        sim[j]![i] = s;
      }
    }

    // 2. Deterministic farthest-first + PAM medoid refinement
    const medoids: number[] = [];
    let bestFirst = 0;
    let bestTotalSim = -1;
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < N; j++) sum += sim[i]![j]!;
      if (sum > bestTotalSim) {
        bestTotalSim = sum;
        bestFirst = i;
      }
    }
    medoids.push(bestFirst);
    const chosenSet = new Set<number>([bestFirst]);

    while (medoids.length < K) {
      let nextPick = -1;
      let minMaxSim = Infinity;
      for (let i = 0; i < N; i++) {
        if (chosenSet.has(i)) continue;
        let maxToMedoids = 0;
        for (const m of medoids) {
          if (sim[i]![m]! > maxToMedoids) maxToMedoids = sim[i]![m]!;
        }
        if (maxToMedoids < minMaxSim) {
          minMaxSim = maxToMedoids;
          nextPick = i;
        }
      }
      if (nextPick < 0) nextPick = medoids.length % N;
      medoids.push(nextPick);
      chosenSet.add(nextPick);
    }

    // Partition & re-select medoid within each cluster (3 passes)
    const assignments = new Int32Array(N);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < N; i++) {
        let bestC = 0;
        let bestS = -1;
        for (let c = 0; c < K; c++) {
          const s = sim[i]![medoids[c]!]!;
          if (s > bestS) {
            bestS = s;
            bestC = c;
          }
        }
        assignments[i] = bestC;
      }
      for (let c = 0; c < K; c++) {
        const membersIdx: number[] = [];
        for (let i = 0; i < N; i++) {
          if (assignments[i] === c) membersIdx.push(i);
        }
        if (membersIdx.length === 0) continue;
        let bestM = medoids[c]!;
        let bestMScore = -1;
        for (const cand of membersIdx) {
          let score = 0;
          for (const other of membersIdx) score += sim[cand]![other]!;
          if (score > bestMScore) {
            bestMScore = score;
            bestM = cand;
          }
        }
        medoids[c] = bestM;
      }
    }

    // 3. Embed KxK medoid similarity matrix on mesh via QAP
    const affinityMatrix = Array.from({ length: K }, () => new Float64Array(K));
    for (let a = 0; a < K; a++) {
      for (let b = a + 1; b < K; b++) {
        const aff = sim[medoids[a]!]![medoids[b]!]!;
        affinityMatrix[a]![b] = aff;
        affinityMatrix[b]![a] = aff;
      }
    }
    const clusterToVertex = embedSimilarityMatrixOnMesh({
      affinityMatrix,
      mesh: ctx.mesh,
      seed: ctx.seed,
    });
    const vertexMedoidIdx = new Int32Array(K);
    const vertexPartitionMembers: Set<string>[] = Array.from(
      { length: K },
      () => new Set<string>(),
    );
    for (let c = 0; c < K; c++) {
      vertexMedoidIdx[clusterToVertex[c]!] = medoids[c]!;
    }
    for (let i = 0; i < N; i++) {
      const vIdx = clusterToVertex[assignments[i]!]!;
      vertexPartitionMembers[vIdx]!.add(ctx.items[i]!.id);
    }

    const { matchedUids, preservedColors } = matchClustersHungarian({
      currentVertexMemberSets: vertexPartitionMembers,
      mesh: ctx.mesh,
      previousClusters: ctx.previousClusters,
      allocateClusterUid: ctx.allocateClusterUid,
    });

    const edgeUnits = ctx.mesh.edges.map((e) => [e.a, e.b] as const);
    const triangleUnits = ctx.mesh.triangles.map((tr) => tr.vertices);
    const membersPerVertex: ClusterMemberRef<TItem>[][] = Array.from({ length: K }, () => []);
    const itemAnchors: ComputedItemAnchor<TItem, TTagMeta>[] = [];

    for (let i = 0; i < N; i++) {
      const entry = ctx.items[i]!;
      const vertexSims = Array.from({ length: K }, (_, v) => ({
        v,
        s: sim[i]![vertexMedoidIdx[v]!]!,
      }));
      const sortedVerts = [...vertexSims].sort((a, b) => b.s - a.s);
      const topV = sortedVerts[0]!;

      let chosenUnit: number[] = [topV.v];
      let chosenWeights: number[] = [1];

      if (anchorRule === 'simplex-projection') {
        const tryUnits = (units: readonly (readonly number[])[]): {
          unit: number[];
          weights: number[];
          meanSim: number;
        } | null => {
          let best: { unit: number[]; weights: number[]; meanSim: number } | null = null;
          for (const u of units) {
            const raw = u.map((v) => Math.pow(Math.max(1e-4, vertexSims[v]!.s), 2));
            const sum = raw.reduce((a, b) => a + b, 0);
            const norm = raw.map((r) => r / sum);
            const minW = Math.min(...norm);
            if (u.length > 1 && minW < 0.08) continue;
            let meanSim = 0;
            for (let j = 0; j < u.length; j++) {
              meanSim += norm[j]! * vertexSims[u[j]!]!.s;
            }
            if (!best || meanSim > best.meanSim) {
              best = { unit: [...u], weights: norm, meanSim };
            }
          }
          return best;
        };

        const bestTri = tryUnits(triangleUnits);
        const bestEdge = tryUnits(edgeUnits);
        if (
          bestTri &&
          bestTri.meanSim > topV.s * 1.03 &&
          (!bestEdge || bestTri.meanSim > bestEdge.meanSim * 1.02)
        ) {
          chosenUnit = bestTri.unit;
          chosenWeights = bestTri.weights;
        } else if (bestEdge && bestEdge.meanSim > topV.s * 1.02) {
          chosenUnit = bestEdge.unit;
          chosenWeights = bestEdge.weights;
        }
      }

      let anchorX = 0;
      let anchorY = 0;
      const unitWeights = chosenUnit.map((v, j) => {
        const w = chosenWeights[j]!;
        const pt = ctx.mesh.vertices[v]!;
        anchorX += pt.x * w;
        anchorY += pt.y * w;
        const cov = vertexSims[v]!.s;
        membersPerVertex[v]!.push({
          item: entry.item,
          itemId: entry.id,
          coverage: cov,
          normalizedWeight: w,
          isExclusiveVertexMember: chosenUnit.length === 1,
        });
        return { clusterIndex: v, weight: w, coverage: cov };
      });

      itemAnchors.push({
        id: entry.id,
        item: entry.item,
        tags: [],
        anchorX,
        anchorY,
        unitVertexIndices: chosenUnit,
        unitWeights,
        featureSummary: 'Pairwise similarity medoid projection',
      });
    }

    const clusters: ComputedTopicCluster<TItem, TTagMeta>[] = [];
    for (let v = 0; v < K; v++) {
      const vertex = ctx.mesh.vertices[v]!;
      const members = [...membersPerVertex[v]!].sort(
        (a, b) => b.normalizedWeight - a.normalizedWeight || b.coverage - a.coverage,
      );
      const medoidEntry = ctx.items[vertexMedoidIdx[v]!]!;
      const representatives =
        members.length > 0
          ? members.slice(0, repCount)
          : [
              {
                item: medoidEntry.item,
                itemId: medoidEntry.id,
                coverage: 1,
                normalizedWeight: 1,
                isExclusiveVertexMember: true,
              },
            ];
      const cohesion =
        members.length > 0
          ? members.reduce((sum, m) => sum + m.coverage, 0) / members.length
          : 1;
      const defaultLabel = options.deriveLabel
        ? options.deriveLabel(representatives, v)
        : extractHeuristicItemLabel(medoidEntry.item, medoidEntry.id);

      clusters.push({
        clusterIndex: v,
        clusterUid: matchedUids[v]!,
        code: `S${v + 1}`,
        defaultLabel,
        gridNode: {
          row: vertex.row,
          col: vertex.col,
          x: vertex.x,
          y: vertex.y,
        },
        coreTags: [],
        sharedTags: [],
        members,
        representativeItems: representatives,
        cohesion,
        featureSummary: `k-Medoids · ${(cohesion * 100).toFixed(0)}% cohesion`,
      });
    }

    if (options.features && options.features.length > 0 && !options.deriveLabel) {
      const discLabels = assignDiscriminativeClusterLabels(
        clusters,
        { features: options.features },
        ctx.items.map((it) => it.item),
      );
      for (let v = 0; v < clusters.length; v++) {
        clusters[v] = { ...clusters[v]!, defaultLabel: discLabels[v] ?? clusters[v]!.defaultLabel };
      }
    }

    return {
      clusters,
      items: itemAnchors,
      uniqueTags: [],
      preservedColors,
    };
  };

  return {
    name: 'pairwise-similarity-medoids',
    requiresTags: false,
    estimateClusterCount: ({ items }) =>
      options.clusterCount ??
      Math.min(12, Math.max(3, Math.round(Math.sqrt(Math.max(1, items.length))))),
    initialize: runSimilarityClustering,
    update: runSimilarityClustering,
  };
}
