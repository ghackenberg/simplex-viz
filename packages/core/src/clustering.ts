import { assignMeshClusterColors, mixOklabColors, type OklabTuple } from './oklab';
import { DeterministicRng } from './prng';
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterMemberRef,
  ContentLayoutContext,
  Point2D,
  SimplexMesh,
  TagDescriptor,
} from './types';

export interface NormalizedContentItem<TItem> {
  readonly item: TItem;
  readonly id: string;
  readonly tags: readonly string[];
}

export interface ComputedItemPlacement<TItem, TTagMeta, TClusterMeta> {
  readonly id: string;
  readonly item: TItem;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly unitVertexIndices: readonly number[];
  readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
}

export interface ClusteringResult<TItem, TTagMeta, TClusterMeta> {
  readonly clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
  readonly items: readonly ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>[];
  readonly uniqueTags: readonly string[];
  readonly totalTagsAssignedCount: number;
}

export interface PreviousClusterSnapshot {
  readonly clusterUid: string;
  readonly tags: ReadonlySet<string>;
  readonly x: number;
  readonly y: number;
  readonly colorHex: string;
  readonly oklab: OklabTuple;
}

/**
 * Hungarian (Munkres) minimum-cost bipartite matching for square/rectangular cost matrix.
 * Returns array `assignment[row] = col` (or `-1` if unmatched when rows > cols).
 */
export function solveHungarianAssignment(costMatrix: readonly (readonly number[])[]): number[] {
  const nRows = costMatrix.length;
  if (nRows === 0) return [];
  const nCols = costMatrix[0]?.length ?? 0;
  if (nCols === 0) return new Array(nRows).fill(-1);

  const dim = Math.max(nRows, nCols);
  const INF_PAD = 1e6;
  const u = new Float64Array(dim + 1);
  const v = new Float64Array(dim + 1);
  const p = new Int32Array(dim + 1);
  const way = new Int32Array(dim + 1);

  const getCost = (r: number, c: number): number => {
    if (r < nRows && c < nCols) {
      return costMatrix[r]![c] ?? INF_PAD;
    }
    return INF_PAD;
  };

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(dim + 1).fill(Infinity);
    const used = new Uint8Array(dim + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= dim; j++) {
        if (used[j]) continue;
        const cur = getCost(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const rowToCol = new Array<number>(nRows).fill(-1);
  for (let j = 1; j <= dim; j++) {
    const r = p[j]! - 1;
    const c = j - 1;
    if (r >= 0 && r < nRows && c >= 0 && c < nCols) {
      rowToCol[r] = c;
    }
  }
  return rowToCol;
}

/**
 * Default tag normalizer: trims whitespace, lowercases, and collapses internal whitespace.
 */
export function defaultNormalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalizes domain items, filters out empty tags and items with 0 valid tags.
 */
export function extractNormalizedItems<TItem>(
  rawItems: readonly TItem[],
  getId: (item: TItem) => string,
  getTags: (item: TItem) => readonly string[],
  normalizeTag: (raw: string) => string = defaultNormalizeTag,
): readonly NormalizedContentItem<TItem>[] {
  const seenIds = new Set<string>();
  const result: NormalizedContentItem<TItem>[] = [];

  for (const item of rawItems) {
    const id = getId(item).trim();
    if (!id || seenIds.has(id)) continue;
    const rawTagList = getTags(item);
    const tagSet = new Set<string>();
    for (const raw of rawTagList) {
      const norm = normalizeTag(raw);
      if (norm.length > 0) {
        tagSet.add(norm);
      }
    }
    if (tagSet.size === 0) continue;
    seenIds.add(id);
    result.push({
      item,
      id,
      tags: [...tagSet],
    });
  }

  return result;
}

/**
 * Executes the two-stage topic clustering pipeline, QAP mesh embedding,
 * planar triangle hitting-set completion, backward pruning, explaining-away unit selection,
 * OKLab color assignment & mixing, and bipartite identity matching.
 */
export function computeSimplexClustering<TItem, TTagMeta, TClusterMeta>(params: {
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly mesh: SimplexMesh;
  readonly resolveTagMeta?: (tag: string) => TTagMeta | undefined;
  readonly deriveClusterMeta: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly previousClusters?: readonly PreviousClusterSnapshot[];
  readonly nextClusterUidSeq: { value: number };
  readonly seed?: number;
}): ClusteringResult<TItem, TTagMeta, TClusterMeta>;
export function computeSimplexClustering<TItem, TTagMeta, TClusterMeta>(params: {
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly mesh: SimplexMesh;
  readonly resolveTagMeta?: (tag: string) => TTagMeta | undefined;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly previousClusters?: readonly PreviousClusterSnapshot[];
  readonly nextClusterUidSeq: { value: number };
  readonly seed?: number;
}): ClusteringResult<TItem, TTagMeta, TClusterMeta>;
export function computeSimplexClustering<TItem, TTagMeta, TClusterMeta>(params: {
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly mesh: SimplexMesh;
  readonly resolveTagMeta?: (tag: string) => TTagMeta | undefined;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly previousClusters?: readonly PreviousClusterSnapshot[];
  readonly nextClusterUidSeq: { value: number };
  readonly seed?: number;
}): ClusteringResult<TItem, TTagMeta, TClusterMeta | undefined> {
  const {
    normalizedItems,
    mesh,
    resolveTagMeta,
    deriveClusterMeta,
    previousClusters,
    nextClusterUidSeq,
    seed = 0x51a7c0de,
  } = params;

  const rng = new DeterministicRng(seed);
  const K = mesh.vertices.length;

  // Gather tag frequencies & item tag sets
  const tagFreqMap = new Map<string, number>();
  for (const entry of normalizedItems) {
    for (const tag of entry.tags) {
      tagFreqMap.set(tag, (tagFreqMap.get(tag) ?? 0) + 1);
    }
  }
  const uniqueTags = [...tagFreqMap.keys()].sort((a, b) => {
    const fa = tagFreqMap.get(a) ?? 0;
    const fb = tagFreqMap.get(b) ?? 0;
    if (fb !== fa) return fb - fa;
    return a.localeCompare(b);
  });

  const T = uniqueTags.length;
  const tagIndexMap = new Map<string, number>();
  uniqueTags.forEach((tag, idx) => tagIndexMap.set(tag, idx));

  // Edge case: 0 items or 0 tags
  if (T === 0 || K === 0) {
    return {
      clusters: [],
      items: [],
      uniqueTags: [],
      totalTagsAssignedCount: 0,
    };
  }

  // Co-occurrence counts & regularized Jaccard similarity matrix
  const cooccur = Array.from({ length: T }, () => new Float64Array(T));
  for (const entry of normalizedItems) {
    const indices = entry.tags.map((t) => tagIndexMap.get(t)!);
    for (let i = 0; i < indices.length; i++) {
      const ti = indices[i]!;
      for (let j = i + 1; j < indices.length; j++) {
        const tj = indices[j]!;
        cooccur[ti]![tj] = cooccur[ti]![tj]! + 1;
        cooccur[tj]![ti] = cooccur[tj]![ti]! + 1;
      }
    }
  }

  const sim = Array.from({ length: T }, () => new Float64Array(T));
  const reg = 1.0;
  for (let i = 0; i < T; i++) {
    const fi = tagFreqMap.get(uniqueTags[i]!) ?? 1;
    for (let j = i + 1; j < T; j++) {
      const fj = tagFreqMap.get(uniqueTags[j]!) ?? 1;
      const cij = cooccur[i]![j]!;
      const union = fi + fj - cij + reg;
      const val = union > 0 ? cij / union : 0;
      sim[i]![j] = val;
      sim[j]![i] = val;
    }
  }

  // Phase 1: Balanced Core Partition into K disjoint tag sets
  const corePartitions: number[][] = Array.from({ length: K }, () => []);
  const targetMaxSize = Math.ceil(T / K);
  const tagToCoreCluster = new Int32Array(T).fill(-1);

  // Seed each cluster with farthest-first / highest-frequency weakly-coupled tags
  const assignedSeeds = new Set<number>();
  if (T > 0) {
    corePartitions[0]!.push(0);
    tagToCoreCluster[0] = 0;
    assignedSeeds.add(0);
  }
  for (let c = 1; c < K && assignedSeeds.size < T; c++) {
    let bestTag = -1;
    let bestScore = Infinity;
    for (let t = 0; t < T; t++) {
      if (assignedSeeds.has(t)) continue;
      let maxSimToSeeds = 0;
      for (const s of assignedSeeds) {
        const sv = sim[t]![s]!;
        if (sv > maxSimToSeeds) maxSimToSeeds = sv;
      }
      // Prefer lower similarity to existing seeds, slight preference for higher frequency
      const freq = tagFreqMap.get(uniqueTags[t]!) ?? 1;
      const score = maxSimToSeeds - Math.min(0.15, freq * 0.002);
      if (score < bestScore) {
        bestScore = score;
        bestTag = t;
      }
    }
    if (bestTag >= 0) {
      corePartitions[c]!.push(bestTag);
      tagToCoreCluster[bestTag] = c;
      assignedSeeds.add(bestTag);
    }
  }

  // Assign remaining tags greedily to most cohesive core partition respecting capacity balance
  for (let t = 0; t < T; t++) {
    if (tagToCoreCluster[t] !== -1) continue;
    let bestCluster = 0;
    let bestAffinity = -Infinity;
    for (let c = 0; c < K; c++) {
      const members = corePartitions[c]!;
      if (members.length >= targetMaxSize) continue;
      let avgSim = 0;
      for (const m of members) {
        avgSim += sim[t]![m]!;
      }
      avgSim = members.length > 0 ? avgSim / members.length : 0;
      // Tie-break by smallest partition to keep clusters balanced
      const balanceBonus = (targetMaxSize - members.length) * 0.015;
      const score = avgSim + balanceBonus;
      if (score > bestAffinity) {
        bestAffinity = score;
        bestCluster = c;
      }
    }
    corePartitions[bestCluster]!.push(t);
    tagToCoreCluster[t] = bestCluster;
  }

  // Compute cluster-cluster co-occurrence affinity matrix for QAP mesh embedding
  const clusterAffinity = Array.from({ length: K }, () => new Float64Array(K));
  for (const entry of normalizedItems) {
    const touched = new Set<number>();
    for (const tag of entry.tags) {
      const idx = tagIndexMap.get(tag);
      if (idx !== undefined) {
        const c = tagToCoreCluster[idx]!;
        if (c >= 0) touched.add(c);
      }
    }
    const list = [...touched];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        clusterAffinity[a]![b] = clusterAffinity[a]![b]! + 1;
        clusterAffinity[b]![a] = clusterAffinity[b]![a]! + 1;
      }
    }
  }

  // Compute all-pairs shortest hop distance on the mesh (BFS from each vertex)
  const hopDist = Array.from({ length: K }, () => new Int32Array(K).fill(K));
  for (let start = 0; start < K; start++) {
    const queue = [start];
    hopDist[start]![start] = 0;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      const d = hopDist[start]![cur]!;
      const neighbors = mesh.vertices[cur]?.neighbors ?? [];
      for (const nb of neighbors) {
        if (hopDist[start]![nb]! > d + 1) {
          hopDist[start]![nb] = d + 1;
          queue.push(nb);
        }
      }
    }
  }

  // Simulated Annealing QAP: perm[clusterId] = vertexIndex
  const perm = Array.from({ length: K }, (_, i) => i);
  const evaluateQap = (p: readonly number[]): number => {
    let cost = 0;
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        const aff = clusterAffinity[i]![j]!;
        if (aff <= 0) continue;
        const hd = hopDist[p[i]!]![p[j]!]!;
        // Strongly reward hop distance 1 (mesh neighbors)
        const penalty = hd <= 1 ? 0 : (hd - 1) * (hd - 1) + 1;
        cost += aff * penalty;
      }
    }
    return cost;
  };

  let curQapCost = evaluateQap(perm);
  let bestPerm = [...perm];
  let bestQapCost = curQapCost;
  const saSteps = Math.min(900, Math.max(200, K * K * 12));
  for (let step = 0; step < saSteps && K >= 3; step++) {
    const temp = Math.max(0.02, 2.5 * (1 - step / saSteps));
    const a = rng.nextInt(K);
    let b = rng.nextInt(K);
    if (a === b) b = (a + 1) % K;
    const tmp = perm[a]!;
    perm[a] = perm[b]!;
    perm[b] = tmp;

    const nextCost = evaluateQap(perm);
    const delta = nextCost - curQapCost;
    if (delta <= 0 || rng.next() < Math.exp(-delta / temp)) {
      curQapCost = nextCost;
      if (curQapCost < bestQapCost) {
        bestQapCost = curQapCost;
        bestPerm = [...perm];
      }
    } else {
      perm[b] = perm[a]!;
      perm[a] = tmp;
    }
  }

  // Map vertexIndex -> coreTagSet & sharedTagSet
  const vertexCoreTags: Set<number>[] = Array.from({ length: K }, () => new Set<number>());
  for (let c = 0; c < K; c++) {
    const vIdx = bestPerm[c]!;
    for (const tagIdx of corePartitions[c]!) {
      vertexCoreTags[vIdx]!.add(tagIdx);
    }
  }

  const vertexSharedTags: Set<number>[] = Array.from({ length: K }, () => new Set<number>());
  const hasTag = (vIdx: number, tagIdx: number): boolean =>
    vertexCoreTags[vIdx]!.has(tagIdx) || vertexSharedTags[vIdx]!.has(tagIdx);

  // Build covering faces (mesh triangles; fallback to edges/vertices if no triangles)
  const coveringUnits: readonly (readonly number[])[] =
    mesh.triangles.length > 0
      ? mesh.triangles.map((tr) => tr.vertices)
      : mesh.edges.length > 0
        ? mesh.edges.map((e) => [e.a, e.b])
        : [Array.from({ length: K }, (_, i) => i)];

  const itemTagIndexLists = normalizedItems.map((it) =>
    it.tags.map((t) => tagIndexMap.get(t)!),
  );

  const isItemCoveredByUnit = (
    itemTags: readonly number[],
    unit: readonly number[],
  ): boolean => {
    for (const t of itemTags) {
      let covered = false;
      for (const v of unit) {
        if (hasTag(v, t)) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
    return true;
  };

  const isItemCoveredPlanar = (itemTags: readonly number[]): boolean => {
    for (const unit of coveringUnits) {
      if (isItemCoveredByUnit(itemTags, unit)) return true;
    }
    return false;
  };

  // Phase 2: Weighted Hitting-Set greedy minimal shared tag expansion
  const maxSharedIterations = T * K + 32;
  for (let iter = 0; iter < maxSharedIterations; iter++) {
    const uncoveredItems: number[] = [];
    for (let i = 0; i < itemTagIndexLists.length; i++) {
      if (!isItemCoveredPlanar(itemTagIndexLists[i]!)) {
        uncoveredItems.push(i);
      }
    }
    if (uncoveredItems.length === 0) break;

    // Evaluate candidate pairs (tag t, vertex v) that heal the most uncovered items
    let bestTag = -1;
    let bestVertex = -1;
    let bestGain = -Infinity;

    // Collect deficit tags per vertex across best-effort triangles for uncovered items
    const candidateGain = new Map<string, number>();
    for (const itemIdx of uncoveredItems) {
      const iTags = itemTagIndexLists[itemIdx]!;
      // Find triangle requiring the fewest missing tags
      let minMissing = Infinity;
      let bestTri: readonly number[] = coveringUnits[0]!;
      for (const tri of coveringUnits) {
        let missing = 0;
        for (const t of iTags) {
          let ok = false;
          for (const v of tri) {
            if (hasTag(v, t)) {
              ok = true;
              break;
            }
          }
          if (!ok) missing++;
        }
        if (missing < minMissing) {
          minMissing = missing;
          bestTri = tri;
        }
      }

      for (const t of iTags) {
        let alreadyInTri = false;
        for (const v of bestTri) {
          if (hasTag(v, t)) {
            alreadyInTri = true;
            break;
          }
        }
        if (alreadyInTri) continue;
        for (const v of bestTri) {
          const key = `${t}:${v}`;
          // Bonus if v is adjacent on the mesh to a vertex already owning t (contiguous tag zones)
          let contiguityBonus = 0;
          const neighbors = mesh.vertices[v]?.neighbors ?? [];
          for (const nb of neighbors) {
            if (hasTag(nb, t)) contiguityBonus += 0.35;
          }
          const score = 1 / Math.max(1, minMissing) + contiguityBonus;
          candidateGain.set(key, (candidateGain.get(key) ?? 0) + score);
        }
      }
    }

    for (const [key, gain] of candidateGain) {
      const [tStr, vStr] = key.split(':');
      const t = Number(tStr);
      const v = Number(vStr);
      if (hasTag(v, t)) continue;
      // Slight penalty to keep |T_k| balanced
      const sizePenalty = (vertexCoreTags[v]!.size + vertexSharedTags[v]!.size) * 0.02;
      const adjusted = gain - sizePenalty;
      if (adjusted > bestGain) {
        bestGain = adjusted;
        bestTag = t;
        bestVertex = v;
      }
    }

    if (bestTag >= 0 && bestVertex >= 0) {
      vertexSharedTags[bestVertex]!.add(bestTag);
    } else {
      break;
    }
  }

  // Backward pruning pass: remove any redundant sharedTag copy without breaking 100% coverage
  const sharedPairs: { v: number; t: number }[] = [];
  for (let v = 0; v < K; v++) {
    for (const t of vertexSharedTags[v]!) {
      sharedPairs.push({ v, t });
    }
  }
  for (const pair of sharedPairs) {
    vertexSharedTags[pair.v]!.delete(pair.t);
    let allStillCovered = true;
    for (const iTags of itemTagIndexLists) {
      if (!isItemCoveredPlanar(iTags)) {
        allStillCovered = false;
        break;
      }
    }
    if (!allStillCovered) {
      vertexSharedTags[pair.v]!.add(pair.t);
    }
  }

  // Bipartite matching with previous clusters (Hungarian algorithm) to keep stable UIDs & colors
  const currentVertexTagSets = Array.from({ length: K }, (_, v) => {
    const s = new Set<string>();
    for (const tIdx of vertexCoreTags[v]!) s.add(uniqueTags[tIdx]!);
    for (const tIdx of vertexSharedTags[v]!) s.add(uniqueTags[tIdx]!);
    return s;
  });

  const matchedUids: string[] = new Array(K).fill('');
  const preservedColors = new Map<number, { readonly hex: string; readonly oklab: OklabTuple }>();

  if (previousClusters && previousClusters.length > 0) {
    const prevCount = previousClusters.length;
    const maxDiag = Math.max(1, Math.hypot(mesh.width, mesh.height));
    const costMatrix: number[][] = Array.from({ length: K }, (_, newIdx) => {
      const newTags = currentVertexTagSets[newIdx]!;
      const newPos = mesh.vertices[newIdx]!;
      return Array.from({ length: prevCount }, (__, prevIdx) => {
        const prev = previousClusters[prevIdx]!;
        let intersection = 0;
        for (const t of newTags) {
          if (prev.tags.has(t)) intersection++;
        }
        const union = newTags.size + prev.tags.size - intersection;
        const jaccardDist = union > 0 ? 1 - intersection / union : 1;
        const euclidDist =
          Math.hypot(newPos.x - prev.x, newPos.y - prev.y) / maxDiag;
        return jaccardDist * 0.78 + euclidDist * 0.22;
      });
    });

    const assignment = solveHungarianAssignment(costMatrix);
    for (let newIdx = 0; newIdx < K; newIdx++) {
      const prevIdx = assignment[newIdx] ?? -1;
      if (prevIdx >= 0 && prevIdx < prevCount) {
        const cost = costMatrix[newIdx]![prevIdx]!;
        if (cost < 0.88) {
          const prev = previousClusters[prevIdx]!;
          matchedUids[newIdx] = prev.clusterUid;
          preservedColors.set(newIdx, { hex: prev.colorHex, oklab: prev.oklab });
        }
      }
    }
  }

  for (let v = 0; v < K; v++) {
    if (!matchedUids[v]) {
      nextClusterUidSeq.value += 1;
      matchedUids[v] = `cluster-${nextClusterUidSeq.value}`;
    }
  }

  const assignedColors = assignMeshClusterColors(K, mesh.edges, preservedColors);

  // Build candidate units sorted by dimension (1: vertices, 2: edges, 3: triangles)
  const vertexUnits: readonly (readonly number[])[] = Array.from({ length: K }, (_, v) => [v]);
  const edgeUnits: readonly (readonly number[])[] = mesh.edges.map((e) => [e.a, e.b]);
  const triangleUnits: readonly (readonly number[])[] = mesh.triangles.map((tr) => tr.vertices);

  const clusterTotalSizes = Array.from(
    { length: K },
    (_, v) => Math.max(1, vertexCoreTags[v]!.size + vertexSharedTags[v]!.size),
  );

  // Explaining-away smallest unit assignment & normalized weights
  interface RawItemAssignment {
    readonly entry: NormalizedContentItem<TItem>;
    readonly tagIndices: readonly number[];
    readonly unitVertices: readonly number[];
    readonly weights: readonly { readonly clusterIndex: number; readonly coverage: number; readonly normalizedWeight: number }[];
    readonly anchor: Point2D;
    readonly mixedColor: { readonly hex: string; readonly oklab: OklabTuple };
  }

  const rawAssignments: RawItemAssignment[] = [];
  const membersPerCluster: ClusterMemberRef<TItem>[][] = Array.from({ length: K }, () => []);

  const computeCoverage = (itemTags: readonly number[], v: number): number => {
    let hit = 0;
    for (const t of itemTags) {
      if (hasTag(v, t)) hit++;
    }
    return hit / clusterTotalSizes[v]!;
  };

  for (let i = 0; i < normalizedItems.length; i++) {
    const entry = normalizedItems[i]!;
    const iTags = itemTagIndexLists[i]!;

    const pickBestUnit = (units: readonly (readonly number[])[]): readonly number[] | null => {
      let best: readonly number[] | null = null;
      let bestScore = -1;
      for (const unit of units) {
        if (!isItemCoveredByUnit(iTags, unit)) continue;
        let sumCov = 0;
        for (const v of unit) {
          sumCov += computeCoverage(iTags, v);
        }
        if (sumCov > bestScore) {
          bestScore = sumCov;
          best = unit;
        }
      }
      return best;
    };

    const chosenUnit =
      pickBestUnit(vertexUnits) ??
      pickBestUnit(edgeUnits) ??
      pickBestUnit(triangleUnits) ??
      [0];

    const rawCoverages = chosenUnit.map((v) => ({
      clusterIndex: v,
      coverage: Math.max(1e-6, computeCoverage(iTags, v)),
    }));
    const totalCov = rawCoverages.reduce((acc, c) => acc + c.coverage, 0);

    const weights = rawCoverages.map((c) => ({
      clusterIndex: c.clusterIndex,
      coverage: c.coverage,
      normalizedWeight: c.coverage / totalCov,
    }));

    let bx = 0;
    let by = 0;
    for (const w of weights) {
      const pt = mesh.vertices[w.clusterIndex]!;
      bx += pt.x * w.normalizedWeight;
      by += pt.y * w.normalizedWeight;
    }

    const mixedColor = mixOklabColors(
      weights.map((w) => ({
        oklab: assignedColors[w.clusterIndex]!.oklab,
        weight: w.normalizedWeight,
      })),
    );

    const isExclusive = weights.length === 1;
    for (const w of weights) {
      membersPerCluster[w.clusterIndex]!.push({
        item: entry.item,
        itemId: entry.id,
        coverage: w.coverage,
        normalizedWeight: w.normalizedWeight,
        isExclusiveVertexMember: isExclusive,
      });
    }

    rawAssignments.push({
      entry,
      tagIndices: iTags,
      unitVertices: chosenUnit,
      weights,
      anchor: { x: bx, y: by },
      mixedColor,
    });
  }

  // Construct typed TagDescriptors and ClusterDescriptors (calling deriveClusterMeta once per cluster)
  const buildTagDescriptor = (tag: string): TagDescriptor<TTagMeta> => ({
    tag,
    frequency: tagFreqMap.get(tag) ?? 0,
    meta: resolveTagMeta ? resolveTagMeta(tag) : undefined,
  });

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta | undefined>[] = [];
  for (let v = 0; v < K; v++) {
    const vertex = mesh.vertices[v]!;
    const color = assignedColors[v]!;
    const coreTags = [...vertexCoreTags[v]!]
      .map((tIdx) => buildTagDescriptor(uniqueTags[tIdx]!))
      .sort((a, b) => b.frequency - a.frequency);
    const sharedTags = [...vertexSharedTags[v]!]
      .map((tIdx) => buildTagDescriptor(uniqueTags[tIdx]!))
      .sort((a, b) => b.frequency - a.frequency);

    const defaultLabel =
      coreTags
        .slice(0, 2)
        .map((t) => t.tag)
        .join(' · ') || `Cluster ${v + 1}`;

    const derivationCtx: ClusterDerivationContext<TItem, TTagMeta> = {
      clusterIndex: v,
      clusterUid: matchedUids[v]!,
      code: `T${v + 1}`,
      defaultLabel,
      colorHex: color.hex,
      oklab: color.oklab,
      gridNode: {
        row: vertex.row,
        col: vertex.col,
        x: vertex.x,
        y: vertex.y,
      },
      coreTags,
      sharedTags,
      members: membersPerCluster[v]!,
    };

    const meta = deriveClusterMeta ? deriveClusterMeta(derivationCtx) : undefined;
    clusters.push({
      ...derivationCtx,
      meta,
    });
  }

  const items: ComputedItemPlacement<TItem, TTagMeta, TClusterMeta | undefined>[] =
    rawAssignments.map((raw) => {
      const tags = raw.tagIndices.map((tIdx) => buildTagDescriptor(uniqueTags[tIdx]!));
      const unitClusters = raw.weights.map((w) => ({
        cluster: clusters[w.clusterIndex]!,
        weight: w.normalizedWeight,
        coverage: w.coverage,
      }));
      return {
        id: raw.entry.id,
        item: raw.entry.item,
        anchorX: raw.anchor.x,
        anchorY: raw.anchor.y,
        unitVertexIndices: raw.unitVertices,
        layoutContext: {
          id: raw.entry.id,
          tags,
          mixedColorHex: raw.mixedColor.hex,
          mixedOklab: raw.mixedColor.oklab,
          unitClusters,
        },
      };
    });

  const totalTagsAssignedCount = clusters.reduce(
    (sum, c) => sum + c.coreTags.length + c.sharedTags.length,
    0,
  );

  return {
    clusters,
    items,
    uniqueTags,
    totalTagsAssignedCount,
  };
}
