import {
  assignItemsToSimplexUnits,
  completePlanarSharedTags,
  defaultNormalizeTag,
  embedSimilarityMatrixOnMesh,
  extractNormalizedItems,
  type AnalyzedTagCorpus,
  type NormalizedContentItem,
  type RawItemUnitAssignment,
} from '../clustering.js';
import { DeterministicRng } from '../prng.js';
import type {
  ClusterMemberRef,
  SimplexMesh,
  TagDescriptor,
} from '../types.js';
import type {
  AssignedColor,
  ClusteringStrategyContext,
  ClusteringStrategyOutput,
  ComputedItemAnchor,
  ComputedTopicCluster,
  SharedTagRule,
  SimplexAnchorRule,
} from './types.js';

export function resolveSharedTags<TItem>(params: {
  readonly rule: SharedTagRule<TItem>;
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly corpus: AnalyzedTagCorpus;
  readonly itemTagIndexLists: readonly (readonly number[])[];
  readonly vertexCoreTags: readonly ReadonlySet<number>[];
  readonly mesh: SimplexMesh;
}): readonly Set<number>[] {
  const { rule, normalizedItems, corpus, itemTagIndexLists, vertexCoreTags, mesh } = params;
  const K = mesh.vertices.length;
  if (typeof rule === 'function') {
    return rule({
      normalizedItems,
      corpus,
      itemTagIndexLists,
      vertexCoreTags,
      mesh,
    });
  }
  if (rule === 'none') {
    return Array.from({ length: K }, () => new Set<number>());
  }
  return completePlanarSharedTags({
    vertexCoreTags,
    itemTagIndexLists,
    mesh,
    tagCount: corpus.uniqueTags.length,
  });
}

export function resolveItemAnchors<TItem>(params: {
  readonly rule: SimplexAnchorRule<TItem>;
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly corpus: AnalyzedTagCorpus;
  readonly itemTagIndexLists: readonly (readonly number[])[];
  readonly vertexCoreTags: readonly ReadonlySet<number>[];
  readonly vertexSharedTags: readonly ReadonlySet<number>[];
  readonly mesh: SimplexMesh;
}): readonly RawItemUnitAssignment<TItem>[] {
  const {
    rule,
    normalizedItems,
    corpus,
    itemTagIndexLists,
    vertexCoreTags,
    vertexSharedTags,
    mesh,
  } = params;
  if (typeof rule === 'function') {
    return rule({
      normalizedItems,
      corpus,
      itemTagIndexLists,
      vertexCoreTags,
      vertexSharedTags,
      mesh,
    });
  }
  return assignItemsToSimplexUnits({
    normalizedItems,
    itemTagIndexLists,
    vertexCoreTags,
    vertexSharedTags,
    mesh,
    rule,
  });
}

export function assembleClusteringOutput<TItem, TTagMeta>(params: {
  readonly corpus: AnalyzedTagCorpus;
  readonly mesh: SimplexMesh;
  readonly vertexCoreTags: readonly ReadonlySet<number>[];
  readonly vertexSharedTags: readonly ReadonlySet<number>[];
  readonly rawAssignments: readonly RawItemUnitAssignment<TItem>[];
  readonly matchedUids: readonly string[];
  readonly preservedColors: ReadonlyMap<number, AssignedColor>;
  readonly formatTagLabel?: (tag: string) => string;
  readonly resolveTagMeta?: (tag: string) => TTagMeta | undefined;
}): ClusteringStrategyOutput<TItem, TTagMeta> {
  const {
    corpus,
    mesh,
    vertexCoreTags,
    vertexSharedTags,
    rawAssignments,
    matchedUids,
    preservedColors,
    formatTagLabel,
    resolveTagMeta,
  } = params;
  const K = mesh.vertices.length;
  const { uniqueTags, tagFreqMap } = corpus;

  const membersPerCluster: ClusterMemberRef<TItem>[][] = Array.from({ length: K }, () => []);
  for (const raw of rawAssignments) {
    const isExclusive = raw.weights.length === 1;
    for (const w of raw.weights) {
      membersPerCluster[w.clusterIndex]!.push({
        item: raw.entry.item,
        itemId: raw.entry.id,
        coverage: w.coverage,
        normalizedWeight: w.normalizedWeight,
        isExclusiveVertexMember: isExclusive,
      });
    }
  }

  const buildTagDescriptor = (tag: string): TagDescriptor<TTagMeta> => {
    const formatted = formatTagLabel ? formatTagLabel(tag).trim() : '';
    return {
      tag,
      ...(formatted.length > 0 ? { label: formatted } : {}),
      frequency: tagFreqMap.get(tag) ?? 0,
      meta: resolveTagMeta ? resolveTagMeta(tag) : undefined,
    };
  };

  const clusters: ComputedTopicCluster<TItem, TTagMeta>[] = [];
  for (let v = 0; v < K; v++) {
    const vertex = mesh.vertices[v]!;
    const coreTags = [...(vertexCoreTags[v] ?? [])]
      .map((tIdx) => buildTagDescriptor(uniqueTags[tIdx]!))
      .sort((a, b) => b.frequency - a.frequency);
    const sharedTags = [...(vertexSharedTags[v] ?? [])]
      .map((tIdx) => buildTagDescriptor(uniqueTags[tIdx]!))
      .sort((a, b) => b.frequency - a.frequency);

    const defaultLabel =
      coreTags
        .slice(0, 2)
        .map((t) => t.label ?? t.tag)
        .join(' · ') || `Cluster ${v + 1}`;

    clusters.push({
      clusterIndex: v,
      clusterUid: matchedUids[v]!,
      code: `T${v + 1}`,
      defaultLabel,
      gridNode: {
        row: vertex.row,
        col: vertex.col,
        x: vertex.x,
        y: vertex.y,
      },
      coreTags,
      sharedTags,
      members: membersPerCluster[v]!,
    });
  }

  const items: ComputedItemAnchor<TItem, TTagMeta>[] = rawAssignments.map((raw) => ({
    id: raw.entry.id,
    item: raw.entry.item,
    tags: raw.tagIndices.map((tIdx) => buildTagDescriptor(uniqueTags[tIdx]!)),
    anchorX: raw.anchor.x,
    anchorY: raw.anchor.y,
    unitVertexIndices: raw.unitVertices,
    unitWeights: raw.weights.map((w) => ({
      clusterIndex: w.clusterIndex,
      weight: w.normalizedWeight,
      coverage: w.coverage,
    })),
  }));

  return {
    clusters,
    items,
    uniqueTags,
    preservedColors,
  };
}

export function resolveStrategyNormalizedItems<TItem, TTagMeta>(
  ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  strategyGetTags?: (item: TItem) => readonly string[],
  strategyNormalizeTag?: (rawTag: string) => string,
): readonly NormalizedContentItem<TItem>[] {
  if (!strategyGetTags && !strategyNormalizeTag && ctx.normalizedItems.length > 0) {
    return ctx.normalizedItems;
  }
  const getTags = strategyGetTags ?? ctx.getTags;
  if (!getTags) {
    return ctx.normalizedItems;
  }
  const normalizeTag = strategyNormalizeTag ?? ctx.normalizeTag ?? defaultNormalizeTag;
  return extractNormalizedItems(
    ctx.items.map((it) => it.item),
    (raw) => {
      const match = ctx.items.find((entry) => entry.item === raw);
      return match ? match.id : '';
    },
    getTags,
    normalizeTag,
  );
}

/**
 * Load-balanced QAP refinement: starts from standard QAP mesh embedding and adds a soft
 * preference for placing high-membership clusters onto high-degree interior mesh vertices
 * (which border 4–6 triangles instead of 1–2 corner triangles).
 */
export function embedLoadBalancedOnMesh(params: {
  readonly affinityMatrix: readonly Float64Array[];
  readonly clusterLoads: readonly number[];
  readonly mesh: SimplexMesh;
  readonly seed: number;
  readonly loadBalanceWeight?: number;
}): number[] {
  const {
    affinityMatrix,
    clusterLoads,
    mesh,
    seed,
    loadBalanceWeight = 0.25,
  } = params;
  const K = mesh.vertices.length;
  const perm = embedSimilarityMatrixOnMesh({ affinityMatrix, mesh, seed });
  if (K <= 3 || loadBalanceWeight <= 0) return perm;

  const hopDist: number[][] = Array.from({ length: K }, () => new Array(K).fill(Infinity));
  for (let start = 0; start < K; start++) {
    hopDist[start]![start] = 0;
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      const curD = hopDist[start]![cur]!;
      for (const nb of mesh.vertices[cur]!.neighbors) {
        if (hopDist[start]![nb]! > curD + 1) {
          hopDist[start]![nb] = curD + 1;
          queue.push(nb);
        }
      }
    }
  }

  let maxLoad = 1;
  for (const l of clusterLoads) {
    if (l > maxLoad) maxLoad = l;
  }
  const normLoad = clusterLoads.map((l) => l / maxLoad);
  const maxDeg = Math.max(
    1,
    ...mesh.vertices.map((v) => v.neighbors.length),
  );
  const normDeg = mesh.vertices.map((v) => v.neighbors.length / maxDeg);

  const evaluateCost = (p: readonly number[]): number => {
    let qap = 0;
    let degBonus = 0;
    for (let i = 0; i < K; i++) {
      degBonus += normLoad[i]! * normDeg[p[i]!]!;
      const row = affinityMatrix[i]!;
      for (let j = i + 1; j < K; j++) {
        const aff = row[j] ?? 0;
        if (aff <= 0) continue;
        const hd = hopDist[p[i]!]![p[j]!]!;
        const pen = hd <= 1 ? 0 : (hd - 1) * (hd - 1) + 1;
        qap += aff * pen;
      }
    }
    return qap - loadBalanceWeight * degBonus * K * 0.35;
  };

  const rng = new DeterministicRng(seed ^ 0x9e3779b9);
  let curCost = evaluateCost(perm);
  let bestPerm = [...perm];
  let bestCost = curCost;
  const steps = Math.min(600, Math.max(120, K * K * 8));

  for (let step = 0; step < steps; step++) {
    const temp = Math.max(0.02, 1.8 * (1 - step / steps));
    const a = rng.nextInt(K);
    let b = rng.nextInt(K);
    if (a === b) b = (a + 1) % K;
    const tmp = perm[a]!;
    perm[a] = perm[b]!;
    perm[b] = tmp;

    const nextCost = evaluateCost(perm);
    const delta = nextCost - curCost;
    if (delta <= 0 || rng.next() < Math.exp(-delta / temp)) {
      curCost = nextCost;
      if (curCost < bestCost) {
        bestCost = curCost;
        bestPerm = [...perm];
      }
    } else {
      perm[b] = perm[a]!;
      perm[a] = tmp;
    }
  }

  return bestPerm;
}
