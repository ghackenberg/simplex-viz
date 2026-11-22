import {
  embedSimilarityMatrixOnMesh,
  matchClustersHungarian,
} from '../clustering.js';
import { assignDiscriminativeClusterLabels } from '../discriminativeLabels.js';
import { DeterministicRng } from '../prng.js';
import type {
  ClusterMemberRef,
  DefaultTaggedItem,
  IdentifiedItem,
} from '../types.js';
import type { SubspaceZoomFeature } from '../zoom.js';
import { embedLoadBalancedOnMesh } from './tagAssembly.js';
import type {
  AssignedColor,
  ClusteringStrategyContext,
  ClusteringStrategyOutput,
  ComputedItemAnchor,
  ComputedTopicCluster,
  SimplexClusteringStrategy,
} from './types.js';

export type EmbeddingVector = readonly number[] | Float32Array | Float64Array;

export interface EmbeddingSource<TItem> {
  readonly name?: string;
  /** Relative modality weight (`>= 0`). Default: `1`. */
  readonly weight?: number;
  readonly getVector: (item: TItem) => EmbeddingVector;
}

export type EmbeddingAnchorRuleKind =
  | 'simplex-projection'
  | 'explaining-away'
  | 'top-1';

export interface EmbeddingClusteringOptions<TItem> {
  /**
   * High-dimensional vector extractor (single embedding OR weighted array of multi-modal embeddings
   * such as image + audio + text vectors).
   */
  readonly getEmbedding:
    | ((item: TItem) => EmbeddingVector)
    | readonly EmbeddingSource<TItem>[];
  /** Distance/similarity metric. Default: `'cosine'`. */
  readonly metric?: 'cosine' | 'euclidean';
  /** Preferred number of cluster vertices `K` when using an adaptive mesh. */
  readonly clusterCount?: number;
  /** Maximum k-Means refinement iterations. Default: `24`. */
  readonly maxIterations?: number;
  /**
   * Rule mapping each item's embedding onto a vertex / edge / triangle of the 60° mesh:
   * - `'simplex-projection'` (default): closed-form NNLS barycentric projection minimizing reconstruction error on vertex/edge/triangle.
   * - `'explaining-away'`: similarity-weighted smallest covering simplex (`vertex ≺ edge ≺ triangle`).
   * - `'top-1'`: hard assignment onto the closest single cluster vertex.
   */
  readonly anchorRule?: EmbeddingAnchorRuleKind;
  /** Optional custom human-readable label derivation per cluster from medoid/closest members. */
  readonly deriveLabel?: (
    representativeMembers: readonly ClusterMemberRef<TItem>[],
    clusterIndex: number,
  ) => string;
  /** Optional interpretable features used to assign base-rate-aware, collision-free `defaultLabel`s across sibling clusters. */
  readonly features?: readonly SubspaceZoomFeature<TItem>[];
  /** Maximum representative members retained per cluster. Default: `3`. */
  readonly representativeCount?: number;
  /** Sharpening exponent for similarity-to-weight mapping in `explaining-away`. Default: `6`. */
  readonly similaritySharpness?: number;
}

function l2NormalizeCopy(vec: Float64Array): Float64Array {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i]! * vec[i]!;
  }
  if (normSq <= 1e-18) {
    return vec;
  }
  const inv = 1 / Math.sqrt(normSq);
  const out = new Float64Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i]! * inv;
  }
  return out;
}

function buildUnifiedItemVectors<TItem>(
  items: readonly IdentifiedItem<TItem>[],
  getEmbedding: EmbeddingClusteringOptions<TItem>['getEmbedding'],
  metric: 'cosine' | 'euclidean',
): Float64Array[] {
  if (typeof getEmbedding === 'function') {
    let maxDim = 0;
    const raw = items.map((entry) => {
      const v = getEmbedding(entry.item);
      if (v.length > maxDim) maxDim = v.length;
      return v;
    });
    const dim = Math.max(1, maxDim);
    return raw.map((v) => {
      const buf = new Float64Array(dim);
      for (let i = 0; i < v.length; i++) {
        const val = v[i]!;
        buf[i] = Number.isFinite(val) ? val : 0;
      }
      return metric === 'cosine' ? l2NormalizeCopy(buf) : buf;
    });
  }

  const activeSources = getEmbedding.filter((s) => (s.weight ?? 1) > 0);
  if (activeSources.length === 0) {
    return items.map(() => new Float64Array([1]));
  }

  const blockDims = activeSources.map((src) => {
    let d = 0;
    for (const entry of items) {
      const len = src.getVector(entry.item).length;
      if (len > d) d = len;
    }
    return Math.max(1, d);
  });
  const totalDim = blockDims.reduce((s, d) => s + d, 0);

  return items.map((entry) => {
    const combined = new Float64Array(totalDim);
    let offset = 0;
    for (let sIdx = 0; sIdx < activeSources.length; sIdx++) {
      const src = activeSources[sIdx]!;
      const dim = blockDims[sIdx]!;
      const scale = Math.sqrt(Math.max(0, src.weight ?? 1));
      const rawVec = src.getVector(entry.item);
      const block = new Float64Array(dim);
      for (let i = 0; i < rawVec.length; i++) {
        const val = rawVec[i]!;
        block[i] = Number.isFinite(val) ? val : 0;
      }
      const normBlock = l2NormalizeCopy(block);
      for (let i = 0; i < dim; i++) {
        combined[offset + i] = normBlock[i]! * scale;
      }
      offset += dim;
    }
    return metric === 'cosine' ? l2NormalizeCopy(combined) : combined;
  });
}

function dotVec(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

function sqDistVec(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return sum;
}

export function extractHeuristicItemLabel<TItem>(item: TItem, fallbackId: string): string {
  if (typeof item === 'object' && item !== null) {
    const candidates = ['label', 'title', 'headline', 'name', 'category'] as const;
    for (const key of candidates) {
      if (key in item) {
        const val = (item as Record<string, unknown>)[key];
        if (typeof val === 'string' && val.trim().length > 0) {
          return val.trim();
        }
      }
    }
  }
  return fallbackId;
}

function projectOntoEdgeSimplex(
  x: Float64Array,
  cA: Float64Array,
  cB: Float64Array,
): { readonly weights: readonly [number, number]; readonly residualSq: number } {
  const dim = x.length;
  let dd = 0;
  let rd = 0;
  let rr = 0;
  for (let i = 0; i < dim; i++) {
    const d = cA[i]! - cB[i]!;
    const r = x[i]! - cB[i]!;
    dd += d * d;
    rd += r * d;
    rr += r * r;
  }
  const t = dd > 1e-12 ? Math.max(0, Math.min(1, rd / dd)) : 0.5;
  const residualSq = Math.max(0, rr - 2 * t * rd + t * t * dd);
  return { weights: [t, 1 - t], residualSq };
}

function projectOntoTriangleSimplex(
  x: Float64Array,
  cA: Float64Array,
  cB: Float64Array,
  cC: Float64Array,
): { readonly weights: readonly [number, number, number]; readonly residualSq: number } {
  const dim = x.length;
  let g11 = 0;
  let g12 = 0;
  let g22 = 0;
  let b1 = 0;
  let b2 = 0;

  for (let i = 0; i < dim; i++) {
    const d1 = cA[i]! - cC[i]!;
    const d2 = cB[i]! - cC[i]!;
    const r = x[i]! - cC[i]!;
    g11 += d1 * d1;
    g12 += d1 * d2;
    g22 += d2 * d2;
    b1 += r * d1;
    b2 += r * d2;
  }

  const det = g11 * g22 - g12 * g12;
  if (Math.abs(det) > 1e-12) {
    const wA = (b1 * g22 - b2 * g12) / det;
    const wB = (g11 * b2 - g12 * b1) / det;
    const wC = 1 - wA - wB;
    if (wA >= 0 && wB >= 0 && wC >= 0) {
      let resSq = 0;
      for (let i = 0; i < dim; i++) {
        const pred = wA * cA[i]! + wB * cB[i]! + wC * cC[i]!;
        const err = x[i]! - pred;
        resSq += err * err;
      }
      return { weights: [wA, wB, wC], residualSq: resSq };
    }
  }

  // Optimal point lies on one of the 3 boundary edges
  const eAB = projectOntoEdgeSimplex(x, cA, cB);
  const eBC = projectOntoEdgeSimplex(x, cB, cC);
  const eCA = projectOntoEdgeSimplex(x, cC, cA);

  if (eAB.residualSq <= eBC.residualSq && eAB.residualSq <= eCA.residualSq) {
    return { weights: [eAB.weights[0], eAB.weights[1], 0], residualSq: eAB.residualSq };
  }
  if (eBC.residualSq <= eCA.residualSq) {
    return { weights: [0, eBC.weights[0], eBC.weights[1]], residualSq: eBC.residualSq };
  }
  return { weights: [eCA.weights[1], 0, eCA.weights[0]], residualSq: eCA.residualSq };
}

interface SolvedEmbeddingBase<TItem, TTagMeta> {
  readonly K: number;
  readonly N: number;
  readonly dim: number;
  readonly vectors: Float64Array[];
  readonly assignments: Int32Array;
  readonly sigmaSq: number;
  readonly clusterToVertex: number[];
  readonly vertexCentroids: Float64Array[];
  readonly vertexCentroidArrays: number[][];
  readonly matchedUids: readonly string[];
  readonly preservedColors: ReadonlyMap<number, AssignedColor>;
  readonly simScoreToVertex: (vec: Float64Array, v: number) => number;
  readonly membersPerVertex: ClusterMemberRef<TItem>[][];
  readonly _tagMeta?: TTagMeta;
}

/**
 * Shared k-Means++ initialization, spherical/Lloyd refinement (with empty cluster rescue),
 * QAP mesh embedding (standard or load-balanced), and Hungarian cluster identity matching.
 */
function solveEmbeddingClusters<TItem, TTagMeta>(params: {
  readonly ctx: ClusteringStrategyContext<TItem, TTagMeta>;
  readonly getEmbedding: EmbeddingClusteringOptions<TItem>['getEmbedding'];
  readonly metric: 'cosine' | 'euclidean';
  readonly maxIterations: number;
  readonly balanceLoad: boolean;
  readonly itemSimScaleFactor: number;
}): SolvedEmbeddingBase<TItem, TTagMeta> {
  const { ctx, getEmbedding, metric, maxIterations, balanceLoad, itemSimScaleFactor } = params;
  const K = ctx.mesh.vertices.length;
  const N = ctx.items.length;

  const vectors = buildUnifiedItemVectors(ctx.items, getEmbedding, metric);
  const dim = vectors[0]!.length;
  const rng = new DeterministicRng(ctx.seed);

  const distToCentroid = (x: Float64Array, c: Float64Array): number =>
    metric === 'cosine' ? Math.max(0, 1 - dotVec(x, c)) : sqDistVec(x, c);

  // 1. Initialize K centroids via warm-start matching or deterministic k-Means++
  const centroids: Float64Array[] = [];
  if (ctx.reason !== 'initial' && ctx.previousClusters.length > 0) {
    for (const prev of ctx.previousClusters) {
      if (centroids.length >= K) break;
      if (prev.centroid && prev.centroid.length === dim) {
        const buf = Float64Array.from(prev.centroid);
        centroids.push(metric === 'cosine' ? l2NormalizeCopy(buf) : buf);
      }
    }
  }

  if (centroids.length === 0) {
    const firstIdx = rng.nextInt(N);
    centroids.push(Float64Array.from(vectors[firstIdx]!));
  }

  const minDistSq = new Float64Array(N).fill(Infinity);
  while (centroids.length < K) {
    let sumW = 0;
    for (let i = 0; i < N; i++) {
      let best = Infinity;
      for (const c of centroids) {
        const d = distToCentroid(vectors[i]!, c);
        if (d < best) best = d;
      }
      minDistSq[i] = best * best;
      sumW += minDistSq[i]!;
    }

    if (sumW <= 1e-14) {
      const pick = centroids.length % N;
      centroids.push(Float64Array.from(vectors[pick]!));
      continue;
    }

    let r = rng.next() * sumW;
    let chosen = N - 1;
    for (let i = 0; i < N; i++) {
      r -= minDistSq[i]!;
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(Float64Array.from(vectors[chosen]!));
  }

  // 2. Spherical / Lloyd k-Means refinement
  const assignments = new Int32Array(N);
  const counts = new Int32Array(K);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = 0;
    for (let i = 0; i < N; i++) {
      const v = vectors[i]!;
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < K; c++) {
        const d = distToCentroid(v, centroids[c]!);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed++;
      }
    }

    const sums = Array.from({ length: K }, () => new Float64Array(dim));
    counts.fill(0);
    for (let i = 0; i < N; i++) {
      const c = assignments[i]!;
      counts[c]! += 1;
      const sumRow = sums[c]!;
      const v = vectors[i]!;
      for (let d = 0; d < dim; d++) {
        sumRow[d]! += v[d]!;
      }
    }

    // Rescue empty clusters from the item with highest assignment error
    for (let c = 0; c < K; c++) {
      if (counts[c]! > 0) continue;
      let worstIdx = c % N;
      let worstErr = -1;
      for (let i = 0; i < N; i++) {
        const err = distToCentroid(vectors[i]!, centroids[assignments[i]!]!);
        if (err > worstErr) {
          worstErr = err;
          worstIdx = i;
        }
      }
      const prevC = assignments[worstIdx]!;
      if (counts[prevC]! > 1) {
        counts[prevC]! -= 1;
        const prevSum = sums[prevC]!;
        const v = vectors[worstIdx]!;
        for (let d = 0; d < dim; d++) prevSum[d]! -= v[d]!;
      }
      assignments[worstIdx] = c;
      counts[c] = 1;
      const v = vectors[worstIdx]!;
      for (let d = 0; d < dim; d++) sums[c]![d] = v[d]!;
    }

    for (let c = 0; c < K; c++) {
      const cnt = Math.max(1, counts[c]!);
      const avg = new Float64Array(dim);
      for (let d = 0; d < dim; d++) {
        avg[d] = sums[c]![d]! / cnt;
      }
      centroids[c] = metric === 'cosine' ? l2NormalizeCopy(avg) : avg;
    }

    if (iter > 0 && changed === 0) break;
  }

  // 3. Build KxK centroid affinity matrix & embed onto 60° simplex mesh via QAP
  let meanPairDistSq = 0;
  let pairCount = 0;
  for (let a = 0; a < K; a++) {
    for (let b = a + 1; b < K; b++) {
      meanPairDistSq += sqDistVec(centroids[a]!, centroids[b]!);
      pairCount++;
    }
  }
  const sigmaSq = Math.max(1e-4, pairCount > 0 ? meanPairDistSq / pairCount : 1);

  const affinityMatrix = Array.from({ length: K }, () => new Float64Array(K));
  for (let a = 0; a < K; a++) {
    for (let b = a + 1; b < K; b++) {
      const aff =
        metric === 'cosine'
          ? Math.pow(Math.max(0, dotVec(centroids[a]!, centroids[b]!)), 1.5)
          : Math.exp(-sqDistVec(centroids[a]!, centroids[b]!) / (2 * sigmaSq));
      affinityMatrix[a]![b] = aff;
      affinityMatrix[b]![a] = aff;
    }
  }

  const clusterToVertex = balanceLoad
    ? embedLoadBalancedOnMesh({
        affinityMatrix,
        clusterLoads: Array.from(counts),
        mesh: ctx.mesh,
        seed: ctx.seed,
      })
    : embedSimilarityMatrixOnMesh({
        affinityMatrix,
        mesh: ctx.mesh,
        seed: ctx.seed,
      });

  const vertexCentroids: Float64Array[] = Array.from(
    { length: K },
    () => new Float64Array(dim),
  );
  const vertexPartitionMembers: Set<string>[] = Array.from(
    { length: K },
    () => new Set<string>(),
  );
  for (let c = 0; c < K; c++) {
    vertexCentroids[clusterToVertex[c]!] = centroids[c]!;
  }
  for (let i = 0; i < N; i++) {
    vertexPartitionMembers[clusterToVertex[assignments[i]!]!]!.add(ctx.items[i]!.id);
  }

  const vertexCentroidArrays = vertexCentroids.map((vc) => Array.from(vc));
  const { matchedUids, preservedColors } = matchClustersHungarian({
    currentVertexMemberSets: vertexPartitionMembers,
    currentVertexCentroids: vertexCentroidArrays,
    mesh: ctx.mesh,
    previousClusters: ctx.previousClusters,
    allocateClusterUid: ctx.allocateClusterUid,
  });

  const itemSimScale = Math.max(1e-4, sigmaSq * itemSimScaleFactor);
  const simScoreToVertex = (vec: Float64Array, v: number): number =>
    metric === 'cosine'
      ? Math.max(0, (dotVec(vec, vertexCentroids[v]!) + 1) * 0.5)
      : Math.exp(-sqDistVec(vec, vertexCentroids[v]!) / itemSimScale);

  const membersPerVertex: ClusterMemberRef<TItem>[][] = Array.from({ length: K }, () => []);

  return {
    K,
    N,
    dim,
    vectors,
    assignments,
    sigmaSq,
    clusterToVertex,
    vertexCentroids,
    vertexCentroidArrays,
    matchedUids,
    preservedColors,
    simScoreToVertex,
    membersPerVertex,
  };
}

function finalizeEmbeddingClusterDescriptors<TItem, TTagMeta>(params: {
  readonly ctx: ClusteringStrategyContext<TItem, TTagMeta>;
  readonly solved: SolvedEmbeddingBase<TItem, TTagMeta>;
  readonly itemAnchors: readonly ComputedItemAnchor<TItem, TTagMeta>[];
  readonly repCount: number;
  readonly metric: 'cosine' | 'euclidean';
  readonly deriveLabel?: EmbeddingClusteringOptions<TItem>['deriveLabel'];
  readonly features?: readonly SubspaceZoomFeature<TItem>[];
}): ClusteringStrategyOutput<TItem, TTagMeta> {
  const { ctx, solved, itemAnchors, repCount, metric, deriveLabel, features } = params;
  const { K, dim, vertexCentroidArrays, matchedUids, preservedColors, membersPerVertex } =
    solved;

  const clusters: ComputedTopicCluster<TItem, TTagMeta>[] = [];
  for (let v = 0; v < K; v++) {
    const vertex = ctx.mesh.vertices[v]!;
    const members = [...membersPerVertex[v]!].sort(
      (a, b) => b.normalizedWeight - a.normalizedWeight || b.coverage - a.coverage,
    );
    const representatives = members.slice(0, repCount);
    const cohesion =
      members.length > 0
        ? Math.max(
            0,
            Math.min(
              1,
              members.reduce((sum, m) => sum + m.coverage, 0) / members.length,
            ),
          )
        : 0;
    const defaultLabel = deriveLabel
      ? deriveLabel(representatives, v)
      : representatives[0]
        ? extractHeuristicItemLabel(
            representatives[0].item,
            representatives[0].itemId,
          )
        : `Cluster ${v + 1}`;

    clusters.push({
      clusterIndex: v,
      clusterUid: matchedUids[v]!,
      code: `C${v + 1}`,
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
      centroid: vertexCentroidArrays[v],
      cohesion,
      featureSummary: `${metric} · ${dim}D · ${(cohesion * 100).toFixed(0)}% cohesion`,
    });
  }

  if (features && features.length > 0 && !deriveLabel) {
    const discLabels = assignDiscriminativeClusterLabels(
      clusters,
      { features },
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
}

/**
 * High-dimensional vector / multi-modal embedding clustering strategy:
 *
 * - Runs deterministic k-Means++ + Spherical/Lloyd k-Means directly on single or weighted multi-modal embeddings
 *   (no tags required!).
 * - Embeds the learned cluster centroid similarity matrix onto the 60° simplex mesh via QAP Simulated Annealing.
 * - Matches cluster UIDs & OKLab colors across updates via member overlap & centroid cosine similarity.
 * - Projects every item onto the optimal planar mesh simplex (`vertex ≺ edge ≺ triangle`) minimizing residual distance.
 */
export function createEmbeddingClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  options: EmbeddingClusteringOptions<TItem>,
): SimplexClusteringStrategy<TItem, TTagMeta> {
  const metric = options.metric ?? 'cosine';
  const maxIterations = Math.max(4, options.maxIterations ?? 24);
  const anchorRule = options.anchorRule ?? 'simplex-projection';
  const repCount = Math.max(1, options.representativeCount ?? 3);
  const sharpness = Math.max(1, options.similaritySharpness ?? 6);
  const isMultiModal = typeof options.getEmbedding !== 'function';
  const sourceCount = isMultiModal ? options.getEmbedding.length : 1;

  const runEmbeddingClustering = (
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta> => {
    const K = ctx.mesh.vertices.length;
    const N = ctx.items.length;
    if (K === 0 || N === 0) {
      return { clusters: [], items: [], uniqueTags: [] };
    }

    const solved = solveEmbeddingClusters({
      ctx,
      getEmbedding: options.getEmbedding,
      metric,
      maxIterations,
      balanceLoad: false,
      itemSimScaleFactor: 0.5,
    });
    const {
      dim,
      vectors,
      vertexCentroids,
      simScoreToVertex,
      membersPerVertex,
    } = solved;

    // Project each item onto optimal planar simplex unit (vertex ≺ edge ≺ triangle)
    const vertexUnits = Array.from({ length: K }, (_, v) => [v] as const);
    const edgeUnits = ctx.mesh.edges.map((e) => [e.a, e.b] as const);
    const triangleUnits = ctx.mesh.triangles.map((tr) => tr.vertices);
    const itemAnchors: ComputedItemAnchor<TItem, TTagMeta>[] = [];

    for (let i = 0; i < N; i++) {
      const entry = ctx.items[i]!;
      const vec = vectors[i]!;

      const vertProjections = vertexUnits.map(([v]) => {
        const resSq = sqDistVec(vec, vertexCentroids[v]!);
        return { v, resSq, sim: simScoreToVertex(vec, v) };
      });
      vertProjections.sort((a, b) => a.resSq - b.resSq);

      let chosenUnit: number[] = [vertProjections[0]!.v];
      let chosenWeights: number[] = [1];
      let chosenResidual = Math.sqrt(Math.max(0, vertProjections[0]!.resSq));

      if (anchorRule === 'simplex-projection') {
        const bestVert = vertProjections[0]!;

        let bestEdge: { unit: [number, number]; weights: [number, number]; resSq: number } | null =
          null;
        for (const [a, b] of edgeUnits) {
          const proj = projectOntoEdgeSimplex(vec, vertexCentroids[a]!, vertexCentroids[b]!);
          if (!bestEdge || proj.residualSq < bestEdge.resSq) {
            bestEdge = {
              unit: [a, b],
              weights: [proj.weights[0], proj.weights[1]],
              resSq: proj.residualSq,
            };
          }
        }

        let bestTri: {
          unit: [number, number, number];
          weights: [number, number, number];
          resSq: number;
        } | null = null;
        for (const [a, b, c] of triangleUnits) {
          const proj = projectOntoTriangleSimplex(
            vec,
            vertexCentroids[a]!,
            vertexCentroids[b]!,
            vertexCentroids[c]!,
          );
          if (!bestTri || proj.residualSq < bestTri.resSq) {
            bestTri = {
              unit: [a, b, c],
              weights: [proj.weights[0], proj.weights[1], proj.weights[2]],
              resSq: proj.residualSq,
            };
          }
        }

        const snapEps = 0.06;
        const triValid =
          bestTri !== null &&
          bestTri.weights.every((w) => w >= snapEps) &&
          bestTri.resSq < bestVert.resSq * 0.94 &&
          (!bestEdge || bestTri.resSq < bestEdge.resSq * 0.96);

        const edgeValid =
          !triValid &&
          bestEdge !== null &&
          bestEdge.weights.every((w) => w >= snapEps) &&
          bestEdge.resSq < bestVert.resSq * 0.96;

        if (triValid && bestTri) {
          chosenUnit = [...bestTri.unit];
          chosenWeights = [...bestTri.weights];
          chosenResidual = Math.sqrt(Math.max(0, bestTri.resSq));
        } else if (edgeValid && bestEdge) {
          chosenUnit = [...bestEdge.unit];
          chosenWeights = [...bestEdge.weights];
          chosenResidual = Math.sqrt(Math.max(0, bestEdge.resSq));
        } else {
          chosenUnit = [bestVert.v];
          chosenWeights = [1];
          chosenResidual = Math.sqrt(Math.max(0, bestVert.resSq));
        }
      } else if (anchorRule === 'explaining-away') {
        const sims = Array.from({ length: K }, (_, v) =>
          Math.pow(simScoreToVertex(vec, v), sharpness),
        );
        const totalSim = Math.max(
          1e-9,
          sims.reduce((acc, s) => acc + s, 0),
        );

        const tryLevel = (units: readonly (readonly number[])[]): number[] | null => {
          let bestU: number[] | null = null;
          let bestRatio = 0;
          for (const unit of units) {
            let sum = 0;
            for (const v of unit) sum += sims[v]!;
            const ratio = sum / totalSim;
            if (ratio >= 0.85 && ratio > bestRatio) {
              bestRatio = ratio;
              bestU = [...unit];
            }
          }
          return bestU;
        };

        const bestUnit =
          tryLevel(vertexUnits) ??
          tryLevel(edgeUnits) ??
          tryLevel(triangleUnits) ??
          (() => {
            const all = [...triangleUnits, ...edgeUnits, ...vertexUnits];
            let best: readonly number[] = [vertProjections[0]!.v];
            let maxSum = -1;
            for (const unit of all) {
              let s = 0;
              for (const v of unit) s += sims[v]!;
              if (s > maxSum) {
                maxSum = s;
                best = unit;
              }
            }
            return [...best];
          })();

        chosenUnit = bestUnit;
        const unitRaw = chosenUnit.map((v) => Math.max(1e-6, sims[v]!));
        const unitSum = unitRaw.reduce((a, b) => a + b, 0);
        chosenWeights = unitRaw.map((w) => w / unitSum);

        let predDistSq = 0;
        for (let d = 0; d < dim; d++) {
          let pred = 0;
          for (let j = 0; j < chosenUnit.length; j++) {
            pred += chosenWeights[j]! * vertexCentroids[chosenUnit[j]!]![d]!;
          }
          const err = vec[d]! - pred;
          predDistSq += err * err;
        }
        chosenResidual = Math.sqrt(Math.max(0, predDistSq));
      }

      const wSum = Math.max(
        1e-9,
        chosenWeights.reduce((a, b) => a + b, 0),
      );
      const normWeights = chosenWeights.map((w) => w / wSum);

      let anchorX = 0;
      let anchorY = 0;
      const unitWeights = chosenUnit.map((v, j) => {
        const w = normWeights[j]!;
        const pt = ctx.mesh.vertices[v]!;
        anchorX += pt.x * w;
        anchorY += pt.y * w;
        const cov = simScoreToVertex(vec, v);
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
        residualDistance: chosenResidual,
        featureSummary: isMultiModal
          ? `${sourceCount}-modal ${metric} (${dim}D)`
          : `${metric} embedding (${dim}D)`,
      });
    }

    return finalizeEmbeddingClusterDescriptors({
      ctx,
      solved,
      itemAnchors,
      repCount,
      metric,
      deriveLabel: options.deriveLabel,
      features: options.features,
    });
  };

  return {
    name: isMultiModal ? 'multimodal-embedding-kmeans' : 'embedding-kmeans',
    requiresTags: false,
    estimateClusterCount: ({ items }) =>
      options.clusterCount ??
      Math.min(12, Math.max(3, Math.round(Math.sqrt(Math.max(1, items.length))))),
    initialize: runEmbeddingClustering,
    update: runEmbeddingClustering,
  };
}

export interface SoftSimplexEmbeddingClusteringOptions<TItem>
  extends Omit<EmbeddingClusteringOptions<TItem>, 'anchorRule'> {
  /**
   * Controls continuous barycentric spreading inside the best enclosing mesh triangle (`0` = tight
   * NNLS projection, `0.45` = smooth interior spread). Default: `0.45`.
   */
  readonly triangleSpread?: number;
  /**
   * Minimum residual weight allocated to secondary/tertiary corners of the enclosing triangle so
   * items never pile directly on top of vertex cluster labels. Default: `0.08`.
   */
  readonly minSecondaryWeight?: number;
  /**
   * When true (default), large clusters preferentially occupy central high-degree mesh vertices.
   */
  readonly balanceLoad?: boolean;
}

/**
 * Soft-simplex embedding clustering strategy:
 *
 * - Clusters single- or multi-modal vector embeddings via k-Means++ + spherical/Lloyd refinement.
 * - Maps cluster centroids onto the 60° mesh with load-balanced QAP (favoring central vertices for
 *   denser clusters).
 * - Projects every item smoothly into its best-matching mesh triangle using continuous softmax-blended
 *   barycentric coordinates so items utilize triangle interiors rather than piling onto corners.
 */
export function createSoftSimplexEmbeddingClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  options: SoftSimplexEmbeddingClusteringOptions<TItem>,
): SimplexClusteringStrategy<TItem, TTagMeta> {
  const metric = options.metric ?? 'cosine';
  const maxIterations = Math.max(4, options.maxIterations ?? 24);
  const repCount = Math.max(1, options.representativeCount ?? 3);
  const triangleSpread = Math.max(0, Math.min(0.9, options.triangleSpread ?? 0.45));
  const minSecondaryWeight = Math.max(0.02, Math.min(0.22, options.minSecondaryWeight ?? 0.08));
  const balanceLoad = options.balanceLoad ?? true;
  const isMultiModal = typeof options.getEmbedding !== 'function';
  const sourceCount = isMultiModal ? options.getEmbedding.length : 1;

  const runSoftEmbedding = (
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta> => {
    const K = ctx.mesh.vertices.length;
    const N = ctx.items.length;
    if (K === 0 || N === 0) {
      return { clusters: [], items: [], uniqueTags: [] };
    }

    const solved = solveEmbeddingClusters({
      ctx,
      getEmbedding: options.getEmbedding,
      metric,
      maxIterations,
      balanceLoad,
      itemSimScaleFactor: 0.65,
    });
    const {
      dim,
      vectors,
      assignments,
      sigmaSq,
      clusterToVertex,
      vertexCentroids,
      simScoreToVertex,
      membersPerVertex,
    } = solved;

    const itemSimScale = Math.max(1e-4, sigmaSq * 0.65);
    const triangleUnits = ctx.mesh.triangles.map((tr) => tr.vertices);
    const triOccupancy = new Int32Array(triangleUnits.length);
    const itemAnchors: ComputedItemAnchor<TItem, TTagMeta>[] = [];

    // Continuous soft-simplex projection into best enclosing triangle
    for (let i = 0; i < N; i++) {
      const entry = ctx.items[i]!;
      const vec = vectors[i]!;
      const primaryVertex = clusterToVertex[assignments[i]!]!;

      const singleResSq = Math.max(0, sqDistVec(vec, vertexCentroids[primaryVertex]!));
      let chosenUnit: number[] = [primaryVertex];
      let chosenWeights: number[] = [1];
      let chosenResidual = Math.sqrt(singleResSq);

      if (triangleUnits.length > 0) {
        let bestTriIdx = -1;
        let bestScore = Infinity;
        let bestProjWeights: readonly [number, number, number] = [1, 0, 0];
        let bestResSq = Infinity;

        for (let t = 0; t < triangleUnits.length; t++) {
          const [a, b, c] = triangleUnits[t]!;
          const proj = projectOntoTriangleSimplex(
            vec,
            vertexCentroids[a]!,
            vertexCentroids[b]!,
            vertexCentroids[c]!,
          );
          const containsPrimary = a === primaryVertex || b === primaryVertex || c === primaryVertex;
          const primaryBias = containsPrimary ? 0.88 : 1.08;
          const occPenalty = 1 + 0.06 * triOccupancy[t]!;
          const score = (proj.residualSq + 1e-4) * primaryBias * occPenalty;
          if (score < bestScore) {
            bestScore = score;
            bestTriIdx = t;
            bestProjWeights = proj.weights;
            bestResSq = proj.residualSq;
          }
        }

        const maxProjWeight = Math.max(
          bestProjWeights[0],
          bestProjWeights[1],
          bestProjWeights[2],
        );
        // Exempt items that belong directly to a single cluster so they remain unconstrained
        // around their cluster node (even at boundary/corner triangulation vertices).
        const isMultiClusterItem =
          bestTriIdx >= 0 &&
          maxProjWeight < 0.82 &&
          bestResSq < singleResSq * 0.92;

        if (isMultiClusterItem) {
          triOccupancy[bestTriIdx]! += 1;
          const [a, b, c] = triangleUnits[bestTriIdx]!;
          const triCorners = [a, b, c];

          const tempDenom = Math.max(1e-4, itemSimScale * (0.45 + 1.15 * triangleSpread));
          const distSqs = triCorners.map((v) => sqDistVec(vec, vertexCentroids[v]!));
          const minD = Math.min(...distSqs);
          const rawSoft = distSqs.map((d) => Math.exp(-(d - minD) / tempDenom));
          const sumSoft = Math.max(1e-9, rawSoft.reduce((s, x) => s + x, 0));
          const softWeights = rawSoft.map((x) => x / sumSoft);

          const blended = triCorners.map((_, j) => {
            const wNnls = bestProjWeights[j]!;
            const wSoft = softWeights[j]!;
            const mixed = wNnls * (1 - triangleSpread) + wSoft * triangleSpread;
            return Math.max(minSecondaryWeight * (0.5 + 0.5 * softWeights[j]!), mixed);
          });
          const bSum = Math.max(1e-9, blended.reduce((s, x) => s + x, 0));

          chosenUnit = triCorners;
          chosenWeights = blended.map((w) => w / bSum);

          let predSq = 0;
          for (let d = 0; d < dim; d++) {
            const pred =
              chosenWeights[0]! * vertexCentroids[a]![d]! +
              chosenWeights[1]! * vertexCentroids[b]![d]! +
              chosenWeights[2]! * vertexCentroids[c]![d]!;
            const err = vec[d]! - pred;
            predSq += err * err;
          }
          chosenResidual = Math.sqrt(Math.max(0, Math.min(bestResSq + 1e-4, predSq)));
        }
      }

      let anchorX = 0;
      let anchorY = 0;
      const unitWeights = chosenUnit.map((v, j) => {
        const w = chosenWeights[j]!;
        const pt = ctx.mesh.vertices[v]!;
        anchorX += pt.x * w;
        anchorY += pt.y * w;
        const cov = simScoreToVertex(vec, v);
        membersPerVertex[v]!.push({
          item: entry.item,
          itemId: entry.id,
          coverage: cov,
          normalizedWeight: w,
          isExclusiveVertexMember: w >= 0.72,
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
        residualDistance: chosenResidual,
        featureSummary: isMultiModal
          ? `${sourceCount}-modal soft-simplex (${dim}D)`
          : `soft-simplex ${metric} (${dim}D)`,
      });
    }

    return finalizeEmbeddingClusterDescriptors({
      ctx,
      solved,
      itemAnchors,
      repCount,
      metric,
      deriveLabel: options.deriveLabel,
      features: options.features,
    });
  };

  return {
    name: isMultiModal ? 'soft-simplex-multimodal-embedding' : 'soft-simplex-embedding',
    requiresTags: false,
    estimateClusterCount: ({ items }) =>
      options.clusterCount ??
      Math.min(12, Math.max(3, Math.round(Math.sqrt(Math.max(1, items.length))))),
    initialize: runSoftEmbedding,
    update: runSoftEmbedding,
  };
}
