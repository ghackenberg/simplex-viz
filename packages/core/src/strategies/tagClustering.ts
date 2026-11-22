import {
  analyzeTagCorpus,
  defaultNormalizeTag,
  embedClustersQapAnnealing,
  embedSimilarityMatrixOnMesh,
  extractIdentifiedItems,
  extractNormalizedItems,
  matchClustersHungarian,
  partitionTagsJaccard,
  resolveTagDisplayLabel,
  solveHungarianAssignment,
  type NormalizedContentItem,
  type PreviousClusterSnapshot,
  type RawItemUnitAssignment,
} from '../clustering.js';
import type {
  ClusterMemberRef,
  DefaultTaggedItem,
  IdentifiedItem,
  TagDescriptor,
} from '../types.js';
import {
  assembleClusteringOutput,
  embedLoadBalancedOnMesh,
  resolveItemAnchors,
  resolveSharedTags,
  resolveStrategyNormalizedItems,
} from './tagAssembly.js';
import type {
  AssignedColor,
  ClusteringStrategyContext,
  ClusteringStrategyOutput,
  ComputedItemAnchor,
  ComputedTopicCluster,
  SharedTagRule,
  SimplexAnchorRule,
  SimplexClusteringStrategy,
} from './types.js';

export interface JaccardClusteringOptions<TItem = DefaultTaggedItem> {
  /** Controls how cross-cluster `sharedTags` are generated. Default: `'planar-hitting-set'`. */
  readonly sharedTagRule?: SharedTagRule<TItem>;
  /** Controls how items map to simplex units and compute `(anchorX, anchorY)`. Default: `'explaining-away'`. */
  readonly anchorRule?: SimplexAnchorRule<TItem>;
  /** Optional custom tag extractor override scoped to this tag clustering strategy. */
  readonly getTags?: (item: TItem) => readonly string[];
  /** Optional custom tag normalizer scoped to this tag clustering strategy. */
  readonly normalizeTag?: (rawTag: string) => string;
}

/**
 * Default two-stage Jaccard core partitioning + Simulated Annealing QAP vertex embedding,
 * Phase-2 hitting-set shared tags, Hungarian identity matching, and configurable anchoring.
 */
export function createJaccardAnnealingClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  options: JaccardClusteringOptions<TItem> = {},
): SimplexClusteringStrategy<TItem, TTagMeta> {
  const sharedTagRule = options.sharedTagRule ?? 'planar-hitting-set';
  const anchorRule = options.anchorRule ?? 'explaining-away';

  const runFull = (
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta> => {
    const K = ctx.mesh.vertices.length;
    const normalizedItems = resolveStrategyNormalizedItems(
      ctx,
      options.getTags,
      options.normalizeTag,
    );
    const corpus = analyzeTagCorpus(normalizedItems);
    const { uniqueTags, tagIndexMap } = corpus;
    if (uniqueTags.length === 0 || K === 0) {
      return { clusters: [], items: [], uniqueTags: [] };
    }

    const { corePartitions, tagToCoreCluster } = partitionTagsJaccard(corpus, K);
    const vertexCoreTags = embedClustersQapAnnealing({
      normalizedItems,
      tagIndexMap,
      tagToCoreCluster,
      corePartitions,
      mesh: ctx.mesh,
      seed: ctx.seed,
    });

    const itemTagIndexLists = normalizedItems.map((it) =>
      it.tags.map((t) => tagIndexMap.get(t)!),
    );

    const vertexSharedTags = resolveSharedTags({
      rule: sharedTagRule,
      normalizedItems,
      corpus,
      itemTagIndexLists,
      vertexCoreTags,
      mesh: ctx.mesh,
    });

    const currentVertexTagSets = Array.from({ length: K }, (_, v) => {
      const s = new Set<string>();
      for (const tIdx of vertexCoreTags[v]!) s.add(uniqueTags[tIdx]!);
      for (const tIdx of vertexSharedTags[v]!) s.add(uniqueTags[tIdx]!);
      return s;
    });

    const { matchedUids, preservedColors } = matchClustersHungarian({
      currentVertexTagSets,
      mesh: ctx.mesh,
      previousClusters: ctx.previousClusters,
      allocateClusterUid: ctx.allocateClusterUid,
    });

    const rawAssignments = resolveItemAnchors({
      rule: anchorRule,
      normalizedItems,
      corpus,
      itemTagIndexLists,
      vertexCoreTags,
      vertexSharedTags,
      mesh: ctx.mesh,
    });

    return assembleClusteringOutput({
      corpus,
      mesh: ctx.mesh,
      vertexCoreTags,
      vertexSharedTags,
      rawAssignments,
      matchedUids,
      preservedColors,
      formatTagLabel: ctx.formatTagLabel,
      resolveTagMeta: ctx.resolveTagMeta,
    });
  };

  const estimateTagClusterCount = ({
    items,
    normalizedItems,
  }: {
    readonly items: readonly IdentifiedItem<TItem>[];
    readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  }): number | undefined => {
    if (normalizedItems.length > 0) {
      const count = new Set(normalizedItems.flatMap((n) => n.tags)).size;
      if (count > 0) return count;
    }
    if (options.getTags) {
      const norm = options.normalizeTag ?? defaultNormalizeTag;
      const tagSet = new Set<string>();
      for (const entry of items) {
        for (const raw of options.getTags(entry.item)) {
          const t = norm(raw);
          if (t.length > 0) tagSet.add(t);
        }
      }
      if (tagSet.size > 0) return tagSet.size;
    }
    return undefined;
  };

  return {
    name: 'jaccard-annealing',
    requiresTags: true,
    getTags: options.getTags,
    normalizeTag: options.normalizeTag,
    estimateClusterCount: estimateTagClusterCount,
    initialize: runFull,
    update: runFull,
  };
}

/**
 * Incremental anchor-preserving clustering strategy:
 *
 * - `initialize`: runs full regularized Jaccard partitioning + Simulated Annealing QAP.
 * - `update`: preserves existing cluster topics, UIDs, colors, and relative spatial mesh locations
 *   across item mutations and viewport/mesh resizes; incrementally attaches new tags to the most
 *   similar existing cluster and prunes disappeared tags before recomputing Phase-2 shared tags
 *   and item unit anchors.
 */
export function createIncrementalAnchorClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  options: JaccardClusteringOptions<TItem> = {},
): SimplexClusteringStrategy<TItem, TTagMeta> {
  const sharedTagRule = options.sharedTagRule ?? 'planar-hitting-set';
  const anchorRule = options.anchorRule ?? 'explaining-away';
  const baseFull = createJaccardAnnealingClusteringStrategy<TItem, TTagMeta>(options);

  return {
    name: 'incremental-anchor',
    requiresTags: true,
    getTags: options.getTags,
    normalizeTag: options.normalizeTag,
    estimateClusterCount: baseFull.estimateClusterCount,
    initialize: (ctx) => baseFull.initialize(ctx),
    update(ctx) {
      if (
        ctx.previousClusters.length === 0 ||
        ctx.reason === 'initial' ||
        ctx.reason === 'strategy' ||
        ((ctx.reason === 'viewport' || ctx.reason === 'mesh') &&
          ctx.mesh.vertices.length !== ctx.previousClusters.length)
      ) {
        return baseFull.initialize(ctx);
      }

      const K = ctx.mesh.vertices.length;
      const normalizedItems = resolveStrategyNormalizedItems(
        ctx,
        options.getTags,
        options.normalizeTag,
      );
      const corpus = analyzeTagCorpus(normalizedItems);
      const { uniqueTags, tagIndexMap, similarity } = corpus;
      if (uniqueTags.length === 0 || K === 0) {
        return { clusters: [], items: [], uniqueTags: [] };
      }

      // 1. Align previous clusters to current mesh vertices by normalized spatial position
      const prevClusters = ctx.previousClusters;
      const prevW = Math.max(1, ctx.previousMesh?.width ?? ctx.mesh.width);
      const prevH = Math.max(1, ctx.previousMesh?.height ?? ctx.mesh.height);
      const newW = Math.max(1, ctx.mesh.width);
      const newH = Math.max(1, ctx.mesh.height);

      const spatialCost: number[][] = Array.from({ length: K }, (_, newIdx) => {
        const v = ctx.mesh.vertices[newIdx]!;
        const nx = v.x / newW;
        const ny = v.y / newH;
        return Array.from({ length: prevClusters.length }, (__, prevIdx) => {
          const prev = prevClusters[prevIdx]!;
          return Math.hypot(nx - prev.x / prevW, ny - prev.y / prevH);
        });
      });

      const vertexToPrev = solveHungarianAssignment(spatialCost);
      const vertexCoreTags: Set<number>[] = Array.from({ length: K }, () => new Set<number>());
      const assignedTagIndices = new Set<number>();
      const matchedUids: string[] = new Array(K).fill('');
      const preservedColors = new Map<number, AssignedColor>();

      for (let v = 0; v < K; v++) {
        const prevIdx = vertexToPrev[v] ?? -1;
        if (prevIdx >= 0 && prevIdx < prevClusters.length) {
          const prev = prevClusters[prevIdx]!;
          matchedUids[v] = prev.clusterUid;
          preservedColors.set(v, { hex: prev.colorHex, oklab: prev.oklab });
          const seedTags = prev.coreTags ?? prev.tags;
          for (const tag of seedTags) {
            const tIdx = tagIndexMap.get(tag);
            if (tIdx !== undefined && !assignedTagIndices.has(tIdx)) {
              vertexCoreTags[v]!.add(tIdx);
              assignedTagIndices.add(tIdx);
            }
          }
        }
      }

      // 2. Ensure every newly added vertex (e.g. viewport grew) borrows at least 1 weakly coupled tag
      for (let v = 0; v < K; v++) {
        if (!matchedUids[v]) {
          matchedUids[v] = ctx.allocateClusterUid();
        }
        if (vertexCoreTags[v]!.size === 0 && assignedTagIndices.size < uniqueTags.length) {
          let bestNewTag = -1;
          for (let t = 0; t < uniqueTags.length; t++) {
            if (!assignedTagIndices.has(t)) {
              bestNewTag = t;
              break;
            }
          }
          if (bestNewTag >= 0) {
            vertexCoreTags[v]!.add(bestNewTag);
            assignedTagIndices.add(bestNewTag);
          }
        }
      }

      // 3. Incrementally place newly added tags into the best-matching existing cluster
      const targetMaxSize = Math.max(1, Math.ceil(uniqueTags.length / K));
      for (let tIdx = 0; tIdx < uniqueTags.length; tIdx++) {
        if (assignedTagIndices.has(tIdx)) continue;
        let bestVertex = 0;
        let bestScore = -Infinity;
        for (let v = 0; v < K; v++) {
          const members = vertexCoreTags[v]!;
          let avgSim = 0;
          for (const m of members) {
            avgSim += similarity[tIdx]![m]!;
          }
          avgSim = members.size > 0 ? avgSim / members.size : 0;
          const balanceBonus = (targetMaxSize - members.size) * 0.02;
          const score = avgSim + balanceBonus;
          if (score > bestScore) {
            bestScore = score;
            bestVertex = v;
          }
        }
        vertexCoreTags[bestVertex]!.add(tIdx);
        assignedTagIndices.add(tIdx);
      }

      // 4. Rebalance empty vertices if items were removed or mesh grew
      for (let v = 0; v < K; v++) {
        if (vertexCoreTags[v]!.size > 0) continue;
        let donorVertex = -1;
        let maxDonorSize = 1;
        for (let other = 0; other < K; other++) {
          if (vertexCoreTags[other]!.size > maxDonorSize) {
            maxDonorSize = vertexCoreTags[other]!.size;
            donorVertex = other;
          }
        }
        if (donorVertex >= 0) {
          const moved = [...vertexCoreTags[donorVertex]!].pop();
          if (moved !== undefined) {
            vertexCoreTags[donorVertex]!.delete(moved);
            vertexCoreTags[v]!.add(moved);
          }
        }
      }

      const itemTagIndexLists = normalizedItems.map((it) =>
        it.tags.map((t) => tagIndexMap.get(t)!),
      );

      const vertexSharedTags = resolveSharedTags({
        rule: sharedTagRule,
        normalizedItems,
        corpus,
        itemTagIndexLists,
        vertexCoreTags,
        mesh: ctx.mesh,
      });

      const rawAssignments = resolveItemAnchors({
        rule: anchorRule,
        normalizedItems,
        corpus,
        itemTagIndexLists,
        vertexCoreTags,
        vertexSharedTags,
        mesh: ctx.mesh,
      });

      return assembleClusteringOutput({
        corpus,
        mesh: ctx.mesh,
        vertexCoreTags,
        vertexSharedTags,
        rawAssignments,
        matchedUids,
        preservedColors,
        formatTagLabel: ctx.formatTagLabel,
        resolveTagMeta: ctx.resolveTagMeta,
      });
    },
  };
}

/**
 * Configuration options for `createFinalSeededClusteringStrategy`.
 */
export interface FinalSeededClusteringOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
> {
  /**
   * Underlying clustering strategy used to compute the canonical full-corpus clustering seed.
   * Defaults to `createJaccardAnnealingClusteringStrategy()`.
   * Works with any `SimplexClusteringStrategy` (Jaccard, Soft-Simplex Tags, Embeddings,
   * Soft-Simplex Embeddings, Pairwise Similarity, or custom).
   */
  readonly baseStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  /**
   * Optional explicit canonical full corpus used to compute the pinned final cluster anchors.
   * When omitted, the item collection supplied on `initialize()` is captured as the canonical seed.
   */
  readonly seedItems?: readonly TItem[];
  /**
   * Optional ID extractor used alongside explicit `seedItems` when `TItem` lacks an `id` field.
   */
  readonly getId?: (item: TItem) => string;
  /**
   * Behavior when `update(ctx)` encounters items whose IDs were not present in the canonical seed:
   * - `'project'` *(default)*: project unseen items onto the pinned final clusters without moving clusters.
   * - `'reseed'`: promote the incoming items to a new canonical seed via `baseStrategy.initialize`.
   */
  readonly unseenItemPolicy?: 'project' | 'reseed';
}

function isSimplexClusteringStrategy<TItem, TTagMeta>(
  value: unknown,
): value is SimplexClusteringStrategy<TItem, TTagMeta> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'initialize' in value &&
    typeof (value as { initialize?: unknown }).initialize === 'function'
  );
}

function fallbackExtractId<TItem>(item: TItem): string {
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const raw = (item as { readonly id: unknown }).id;
    return typeof raw === 'string' ? raw : String(raw ?? '');
  }
  return '';
}

function fallbackExtractTags<TItem>(item: TItem): readonly string[] {
  if (typeof item === 'object' && item !== null && 'tags' in item) {
    const raw = (item as { readonly tags?: unknown }).tags;
    return Array.isArray(raw) ? (raw as readonly string[]) : [];
  }
  return [];
}

/**
 * Final-seeded clustering strategy wrapper for path-independent chronological playback and subset filtering:
 *
 * 1. Computes and caches the canonical full-corpus clustering on initialization (or from explicit `seedItems`).
 * 2. Projects chronological or filtered item subsets onto those pinned final cluster anchors,
 *    mesh vertex indices, UIDs, labels, and colors — with zero cluster hopping.
 * 3. Re-seeds cleanly from the full canonical corpus on viewport/mesh resizes so shrinking and
 *    growing the viewport always restores the exact cluster count and balanced topology.
 * 4. Restores the exact full-corpus clustering at step `N`.
 */
export function createFinalSeededClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  baseOrOptions?:
    | SimplexClusteringStrategy<TItem, TTagMeta>
    | FinalSeededClusteringOptions<TItem, TTagMeta>,
  extraOptions?: Omit<FinalSeededClusteringOptions<TItem, TTagMeta>, 'baseStrategy'>,
): SimplexClusteringStrategy<TItem, TTagMeta> {
  const resolvedOptions: FinalSeededClusteringOptions<TItem, TTagMeta> =
    isSimplexClusteringStrategy<TItem, TTagMeta>(baseOrOptions)
      ? { ...extraOptions, baseStrategy: baseOrOptions }
      : { ...baseOrOptions, ...extraOptions };

  const baseStrategy: SimplexClusteringStrategy<TItem, TTagMeta> =
    resolvedOptions.baseStrategy ??
    createJaccardAnnealingClusteringStrategy<TItem, TTagMeta>();
  const requiresTags = baseStrategy.requiresTags !== false;
  const unseenItemPolicy = resolvedOptions.unseenItemPolicy ?? 'project';

  let seedIdentifiedItems: readonly IdentifiedItem<TItem>[] | null = null;
  let seedNormalizedItems: readonly NormalizedContentItem<TItem>[] | null = null;
  let seedItemIdSet = new Set<string>();
  let seedOutput: ClusteringStrategyOutput<TItem, TTagMeta> | null = null;
  let seedItemById = new Map<string, ComputedItemAnchor<TItem, TTagMeta>>();
  const pinnedColorsByUid = new Map<string, AssignedColor>();

  const materializeExplicitSeed = (
    getIdFn?: (item: TItem) => string,
    getTagsFn?: (item: TItem) => readonly string[],
    normalizeTagFn?: (raw: string) => string,
  ): {
    readonly identified: readonly IdentifiedItem<TItem>[];
    readonly normalized: readonly NormalizedContentItem<TItem>[];
  } | null => {
    if (!resolvedOptions.seedItems) return null;
    const idFn = resolvedOptions.getId ?? getIdFn ?? fallbackExtractId;
    const tagsFn = baseStrategy.getTags ?? getTagsFn ?? fallbackExtractTags;
    const normFn = baseStrategy.normalizeTag ?? normalizeTagFn ?? defaultNormalizeTag;
    const identified = extractIdentifiedItems(resolvedOptions.seedItems, idFn);
    const normalized = requiresTags
      ? extractNormalizedItems(resolvedOptions.seedItems, idFn, tagsFn, normFn)
      : [];
    return { identified, normalized };
  };

  const capturePreviousColors = (
    previousClusters: readonly PreviousClusterSnapshot[],
  ): void => {
    for (const prev of previousClusters) {
      if (prev.clusterUid && prev.colorHex) {
        pinnedColorsByUid.set(prev.clusterUid, {
          hex: prev.colorHex,
          oklab: prev.oklab,
        });
      }
    }
  };

  const computeCanonicalSeed = (
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
    canonicalIdentified: readonly IdentifiedItem<TItem>[],
    canonicalNormalized: readonly NormalizedContentItem<TItem>[],
  ): ClusteringStrategyOutput<TItem, TTagMeta> => {
    seedIdentifiedItems = canonicalIdentified;
    seedNormalizedItems = canonicalNormalized;
    const activeSeedIds = requiresTags
      ? canonicalNormalized.map((n) => n.id)
      : canonicalIdentified.map((it) => it.id);
    seedItemIdSet = new Set(activeSeedIds);

    const seedCtx: ClusteringStrategyContext<TItem, TTagMeta> = {
      ...ctx,
      items: canonicalIdentified,
      previousItems: canonicalIdentified,
      normalizedItems: canonicalNormalized,
      previousNormalizedItems: canonicalNormalized,
      addedItemIds: new Set(activeSeedIds),
      removedItemIds: new Set<string>(),
      reason: 'initial',
    };

    const computed = baseStrategy.initialize(seedCtx);
    seedOutput = computed;
    seedItemById = new Map(computed.items.map((anchor) => [anchor.id, anchor]));

    // Retain any preserved colors returned by the base strategy for matching cluster UIDs
    if (computed.preservedColors) {
      for (const [vIdx, color] of computed.preservedColors) {
        const cl = computed.clusters[vIdx];
        if (cl) {
          pinnedColorsByUid.set(cl.clusterUid, color);
        }
      }
    }

    return computed;
  };

  const projectUnseenItem = (
    id: string,
    item: TItem,
    rawTags: readonly string[],
    canonical: ClusteringStrategyOutput<TItem, TTagMeta>,
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ComputedItemAnchor<TItem, TTagMeta> => {
    const K = canonical.clusters.length;
    const tagDescriptors: TagDescriptor<TTagMeta>[] = rawTags.map((tag) => {
      const formatted = ctx.formatTagLabel?.(tag)?.trim();
      const label =
        formatted && formatted.length > 0 && formatted !== tag ? formatted : undefined;
      return {
        tag,
        ...(label !== undefined ? { label } : {}),
        frequency: 1,
        meta: ctx.resolveTagMeta?.(tag),
      };
    });

    if (requiresTags && rawTags.length > 0 && K > 0) {
      const tagSet = new Set(rawTags);
      const vertexScores: Array<{ readonly clusterIndex: number; readonly score: number }> = [];
      for (let v = 0; v < K; v++) {
        const cl = canonical.clusters[v]!;
        let score = 0;
        for (const t of cl.coreTags) {
          if (tagSet.has(t.tag)) score += 1.0;
        }
        for (const t of cl.sharedTags) {
          if (tagSet.has(t.tag)) score += 0.6;
        }
        if (score > 0) {
          vertexScores.push({ clusterIndex: v, score });
        }
      }

      if (vertexScores.length > 0) {
        vertexScores.sort((a, b) => b.score - a.score);
        // Prefer a valid simplex unit (single vertex, edge, or triangle) in the mesh
        const top = vertexScores.slice(0, 3);
        let chosen = [top[0]!];
        if (top.length >= 2) {
          const v0 = top[0]!.clusterIndex;
          const v1 = top[1]!.clusterIndex;
          const edgeMatch = ctx.mesh.edges.some(
            (e) =>
              (e.a === v0 && e.b === v1) || (e.a === v1 && e.b === v0),
          );
          if (edgeMatch) {
            chosen = [top[0]!, top[1]!];
            if (top.length >= 3) {
              const v2 = top[2]!.clusterIndex;
              const triMatch = ctx.mesh.triangles.some((t) => {
                const s = new Set(t.vertices);
                return s.has(v0) && s.has(v1) && s.has(v2);
              });
              if (triMatch) {
                chosen = [top[0]!, top[1]!, top[2]!];
              }
            }
          }
        }
        const totalScore = chosen.reduce((s, c) => s + c.score, 0) || 1;
        let anchorX = 0;
        let anchorY = 0;
        const unitWeights = chosen.map((c) => {
          const w = c.score / totalScore;
          const vtx = ctx.mesh.vertices[c.clusterIndex] ?? canonical.clusters[c.clusterIndex]!.gridNode;
          anchorX += vtx.x * w;
          anchorY += vtx.y * w;
          return {
            clusterIndex: c.clusterIndex,
            weight: w,
            coverage: Math.min(1, c.score / rawTags.length),
          };
        });
        return {
          id,
          item,
          tags: tagDescriptors,
          anchorX,
          anchorY,
          unitVertexIndices: chosen.map((c) => c.clusterIndex),
          unitWeights,
        };
      }
    }

    const fallbackVertex = ctx.mesh.vertices[0] ?? canonical.clusters[0]?.gridNode ?? { x: 0, y: 0 };
    return {
      id,
      item,
      tags: tagDescriptors,
      anchorX: fallbackVertex.x,
      anchorY: fallbackVertex.y,
      unitVertexIndices: K > 0 ? [0] : [],
      unitWeights: K > 0 ? [{ clusterIndex: 0, weight: 1, coverage: 1 }] : [],
    };
  };

  const projectOntoCanonicalSeed = (
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
    canonical: ClusteringStrategyOutput<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta> => {
    const K = canonical.clusters.length;
    const latestItemById = new Map<string, TItem>();
    for (const entry of ctx.items) {
      latestItemById.set(entry.id, entry.item);
    }

    const activeEntries: ReadonlyArray<{
      readonly id: string;
      readonly item: TItem;
      readonly tags: readonly string[];
    }> = requiresTags
      ? resolveStrategyNormalizedItems(
          ctx,
          baseStrategy.getTags,
          baseStrategy.normalizeTag,
        ).map((n) => ({
          id: n.id,
          item: latestItemById.get(n.id) ?? n.item,
          tags: n.tags,
        }))
      : ctx.items.map((it) => ({
          id: it.id,
          item: it.item,
          tags: [],
        }));

    const unseenMemberBuckets: ClusterMemberRef<TItem>[][] = Array.from(
      { length: K },
      () => [],
    );
    const projectedItems: ComputedItemAnchor<TItem, TTagMeta>[] = [];

    for (const entry of activeEntries) {
      const seeded = seedItemById.get(entry.id);
      if (seeded) {
        let anchorX = 0;
        let anchorY = 0;
        let weightSum = 0;
        for (const uw of seeded.unitWeights) {
          const vtx = ctx.mesh.vertices[uw.clusterIndex];
          if (vtx) {
            anchorX += vtx.x * uw.weight;
            anchorY += vtx.y * uw.weight;
            weightSum += uw.weight;
          }
        }
        const resolvedAnchorX = weightSum > 1e-6 ? anchorX / weightSum : seeded.anchorX;
        const resolvedAnchorY = weightSum > 1e-6 ? anchorY / weightSum : seeded.anchorY;
        const nextAnchor: ComputedItemAnchor<TItem, TTagMeta> = {
          ...seeded,
          item: entry.item,
          anchorX: resolvedAnchorX,
          anchorY: resolvedAnchorY,
        };
        projectedItems.push(nextAnchor);
      } else {
        const projected = projectUnseenItem(
          entry.id,
          entry.item,
          entry.tags,
          canonical,
          ctx,
        );
        projectedItems.push(projected);
        const isSingle = projected.unitWeights.length === 1;
        for (const uw of projected.unitWeights) {
          unseenMemberBuckets[uw.clusterIndex]?.push({
            itemId: entry.id,
            item: entry.item,
            coverage: uw.coverage,
            normalizedWeight: uw.weight,
            isExclusiveVertexMember: isSingle && uw.weight >= 0.999,
          });
        }
      }
    }

    const activeIdSet = new Set(activeEntries.map((e) => e.id));
    const preservedColors = new Map<number, AssignedColor>();

    const projectedClusters: ComputedTopicCluster<TItem, TTagMeta>[] =
      canonical.clusters.map((cl, v) => {
        const vtx = ctx.mesh.vertices[v];
        const seededMembers = cl.members
          .filter((m) => activeIdSet.has(m.itemId))
          .map((m) => ({
            ...m,
            item: latestItemById.get(m.itemId) ?? m.item,
          }));
        const members = [...seededMembers, ...(unseenMemberBuckets[v] ?? [])];
        const repItems = cl.representativeItems
          ?.filter((r) => activeIdSet.has(r.itemId))
          .map((r) => ({
            ...r,
            item: latestItemById.get(r.itemId) ?? r.item,
          }));

        const pinnedColor =
          pinnedColorsByUid.get(cl.clusterUid) ?? canonical.preservedColors?.get(v);
        if (pinnedColor) {
          preservedColors.set(v, pinnedColor);
        }

        // Re-apply formatTagLabel if labels are present on canonical tags
        const coreTags = cl.coreTags.map((td) => {
          const display = resolveTagDisplayLabel(td, ctx.formatTagLabel);
          return display !== td.tag && td.label !== display
            ? { ...td, label: display }
            : td;
        });

        return {
          ...cl,
          gridNode: vtx
            ? { row: vtx.row, col: vtx.col, x: vtx.x, y: vtx.y }
            : cl.gridNode,
          coreTags,
          members,
          ...(repItems !== undefined ? { representativeItems: repItems } : {}),
        };
      });

    return {
      clusters: projectedClusters,
      items: projectedItems,
      uniqueTags: canonical.uniqueTags,
      ...(preservedColors.size > 0 ? { preservedColors } : {}),
    };
  };

  return {
    name: `final-seeded(${baseStrategy.name})`,
    requiresTags,
    getTags: baseStrategy.getTags,
    normalizeTag: baseStrategy.normalizeTag,
    estimateClusterCount(ctx) {
      if (!seedIdentifiedItems && resolvedOptions.seedItems) {
        const explicit = materializeExplicitSeed(
          ctx.getId,
          ctx.getTags,
          ctx.normalizeTag,
        );
        if (explicit) {
          seedIdentifiedItems = explicit.identified;
          seedNormalizedItems = explicit.normalized;
        }
      }

      if (seedIdentifiedItems) {
        const canonicalNormalized = seedNormalizedItems ?? [];
        const canonicalCount = requiresTags
          ? canonicalNormalized.length
          : seedIdentifiedItems.length;
        const estimated = baseStrategy.estimateClusterCount?.({
          ...ctx,
          items: seedIdentifiedItems,
          normalizedItems: canonicalNormalized,
          itemCount: canonicalCount,
        });
        if (estimated !== undefined) return estimated;
        if (requiresTags) {
          const uniqueSeedTags = new Set(canonicalNormalized.flatMap((n) => n.tags)).size;
          if (uniqueSeedTags > 0) return uniqueSeedTags;
        }
        return seedOutput?.clusters.length;
      }

      return baseStrategy.estimateClusterCount?.(ctx);
    },
    initialize(ctx) {
      capturePreviousColors(ctx.previousClusters);
      const explicit = materializeExplicitSeed(
        ctx.getId,
        ctx.getTags,
        ctx.normalizeTag,
      );
      const canonicalIdentified = explicit ? explicit.identified : ctx.items;
      const canonicalNormalized = explicit
        ? explicit.normalized
        : requiresTags
          ? resolveStrategyNormalizedItems(
              ctx,
              baseStrategy.getTags,
              baseStrategy.normalizeTag,
            )
          : [];

      const canonical = computeCanonicalSeed(
        ctx,
        canonicalIdentified,
        canonicalNormalized,
      );

      // If explicit seedItems were supplied and initial ctx.items is already a subset, project immediately
      if (explicit) {
        return projectOntoCanonicalSeed(ctx, canonical);
      }
      return canonical;
    },
    update(ctx) {
      capturePreviousColors(ctx.previousClusters);
      if (!seedOutput || !seedIdentifiedItems) {
        return this.initialize(ctx);
      }

      const isGeometryOrStrategyReset =
        ctx.reason === 'initial' ||
        ctx.reason === 'viewport' ||
        ctx.reason === 'mesh' ||
        ctx.reason === 'strategy' ||
        ctx.mesh.vertices.length !== seedOutput.clusters.length;

      if (isGeometryOrStrategyReset) {
        const canonical = computeCanonicalSeed(
          ctx,
          seedIdentifiedItems,
          seedNormalizedItems ?? [],
        );
        return projectOntoCanonicalSeed(ctx, canonical);
      }

      if (unseenItemPolicy === 'reseed') {
        const activeIds = requiresTags
          ? resolveStrategyNormalizedItems(
              ctx,
              baseStrategy.getTags,
              baseStrategy.normalizeTag,
            ).map((n) => n.id)
          : ctx.items.map((it) => it.id);
        const hasUnseen = activeIds.some((id) => !seedItemIdSet.has(id));
        if (hasUnseen) {
          const nextNormalized = requiresTags
            ? resolveStrategyNormalizedItems(
                ctx,
                baseStrategy.getTags,
                baseStrategy.normalizeTag,
              )
            : [];
          return computeCanonicalSeed(ctx, ctx.items, nextNormalized);
        }
      }

      return projectOntoCanonicalSeed(ctx, seedOutput);
    },
  };
}

export interface SoftSimplexTagClusteringOptions<TItem = DefaultTaggedItem>
  extends JaccardClusteringOptions<TItem> {
  /**
   * Controls how strongly vertex- and edge-pinned tagged items fan out into their best
   * incident triangle based on secondary co-occurrence affinity (`0` = discrete, `0.42` = default).
   */
  readonly triangleSpread?: number;
  /**
   * When true (default), heavy topic clusters prefer central high-degree mesh vertices
   * bordering more triangles.
   */
  readonly balanceLoad?: boolean;
}

/**
 * Soft-simplex tag clustering strategy:
 *
 * Keeps full Jaccard core partitioning + optional planar hitting-set shared tags, places dense
 * topic clusters onto high-degree interior mesh vertices via load-balanced QAP, and gently
 * distributes vertex-/edge-anchored items into their best-matching incident triangle interiors
 * so canvas triangle faces fill evenly without piling items underneath cluster badges.
 */
export function createSoftSimplexTagClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  options: SoftSimplexTagClusteringOptions<TItem> = {},
): SimplexClusteringStrategy<TItem, TTagMeta> {
  const sharedTagRule = options.sharedTagRule ?? 'planar-hitting-set';
  const anchorRule = options.anchorRule ?? 'explaining-away';
  const triangleSpread = Math.max(0, Math.min(0.65, options.triangleSpread ?? 0.42));
  const balanceLoad = options.balanceLoad ?? true;

  const runSoftTagged = (
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta> => {
    const K = ctx.mesh.vertices.length;
    const normalizedItems = resolveStrategyNormalizedItems(
      ctx,
      options.getTags,
      options.normalizeTag,
    );
    const corpus = analyzeTagCorpus(normalizedItems);
    const { uniqueTags, tagIndexMap, similarity } = corpus;
    if (uniqueTags.length === 0 || K === 0) {
      return { clusters: [], items: [], uniqueTags: [] };
    }

    const { corePartitions, tagToCoreCluster } = partitionTagsJaccard(corpus, K);

    // Build cluster affinity and load weights for load-balanced QAP
    const clusterAffinity = Array.from({ length: K }, () => new Float64Array(K));
    const clusterLoads = new Float64Array(K);
    for (const entry of normalizedItems) {
      const touched = new Set<number>();
      for (const tag of entry.tags) {
        const idx = tagIndexMap.get(tag);
        if (idx !== undefined) {
          const c = tagToCoreCluster[idx]!;
          if (c >= 0 && c < K) {
            touched.add(c);
            clusterLoads[c] = (clusterLoads[c] ?? 0) + 1;
          }
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

    const bestPerm = balanceLoad
      ? embedLoadBalancedOnMesh({
          affinityMatrix: clusterAffinity,
          clusterLoads: Array.from(clusterLoads),
          mesh: ctx.mesh,
          seed: ctx.seed,
        })
      : embedSimilarityMatrixOnMesh({
          affinityMatrix: clusterAffinity,
          mesh: ctx.mesh,
          seed: ctx.seed,
        });

    const vertexCoreTags: Set<number>[] = Array.from({ length: K }, () => new Set<number>());
    for (let c = 0; c < K; c++) {
      const vIdx = bestPerm[c]!;
      for (const tagIdx of corePartitions[c] ?? []) {
        vertexCoreTags[vIdx]!.add(tagIdx);
      }
    }

    const itemTagIndexLists = normalizedItems.map((it) =>
      it.tags.map((t) => tagIndexMap.get(t)!),
    );
    const vertexSharedTags = resolveSharedTags({
      rule: sharedTagRule,
      normalizedItems,
      corpus,
      itemTagIndexLists,
      vertexCoreTags,
      mesh: ctx.mesh,
    });

    const currentVertexTagSets = Array.from({ length: K }, (_, v) => {
      const s = new Set<string>();
      for (const tIdx of vertexCoreTags[v]!) s.add(uniqueTags[tIdx]!);
      for (const tIdx of vertexSharedTags[v]!) s.add(uniqueTags[tIdx]!);
      return s;
    });

    const { matchedUids, preservedColors } = matchClustersHungarian({
      currentVertexTagSets,
      mesh: ctx.mesh,
      previousClusters: ctx.previousClusters,
      allocateClusterUid: ctx.allocateClusterUid,
    });

    const baseAssignments = resolveItemAnchors({
      rule: anchorRule,
      normalizedItems,
      corpus,
      itemTagIndexLists,
      vertexCoreTags,
      vertexSharedTags,
      mesh: ctx.mesh,
    });

    // Compute per-item tag affinity to any cluster vertex via Jaccard co-occurrence
    const scoreItemToVertex = (iTags: readonly number[], v: number): number => {
      const vTags = vertexCoreTags[v]!;
      const vShared = vertexSharedTags[v]!;
      if (iTags.length === 0 || (vTags.size === 0 && vShared.size === 0)) return 0;
      let best = 0;
      let sum = 0;
      let count = 0;
      for (const it of iTags) {
        for (const ct of vTags) {
          const simVal = it === ct ? 1 : (similarity[it]?.[ct] ?? 0);
          if (simVal > best) best = simVal;
          sum += simVal;
          count++;
        }
        for (const st of vShared) {
          const simVal = it === st ? 0.85 : (similarity[it]?.[st] ?? 0) * 0.75;
          if (simVal > best) best = simVal;
          sum += simVal;
          count++;
        }
      }
      return best * 0.65 + (count > 0 ? sum / count : 0) * 0.35;
    };

    const triOccupancy = new Int32Array(ctx.mesh.triangles.length);
    const spreadAssignments: RawItemUnitAssignment<TItem>[] = baseAssignments.map((raw) => {
      if (triangleSpread <= 0.01 || ctx.mesh.triangles.length === 0) {
        return raw;
      }
      if (raw.unitVertices.length >= 3) {
        for (let t = 0; t < ctx.mesh.triangles.length; t++) {
          const tv = ctx.mesh.triangles[t]!.vertices;
          if (
            raw.unitVertices.includes(tv[0]) &&
            raw.unitVertices.includes(tv[1]) &&
            raw.unitVertices.includes(tv[2])
          ) {
            triOccupancy[t]! += 1;
            break;
          }
        }
        return raw;
      }

      // Single-cluster items belong directly to one topic cluster and must NOT be forced
      // into a triangle wedge so they can arrange freely in a 360° halo around their cluster
      // (including around boundary/corner triangulation vertices).
      if (raw.unitVertices.length <= 1) {
        return raw;
      }

      if (raw.unitVertices.length === 2) {
        const [a, b] = [raw.unitVertices[0]!, raw.unitVertices[1]!];
        let bestTriIdx = -1;
        let bestTriScore = -Infinity;
        let bestC = -1;
        let bestAffC = 0;

        for (let t = 0; t < ctx.mesh.triangles.length; t++) {
          const tv = ctx.mesh.triangles[t]!.vertices;
          if (!tv.includes(a) || !tv.includes(b)) continue;
          const c = tv.find((u) => u !== a && u !== b);
          if (c === undefined) continue;
          const affC = scoreItemToVertex(raw.tagIndices, c);
          const score = (affC + 0.1) / (1 + 0.14 * triOccupancy[t]!);
          if (score > bestTriScore) {
            bestTriScore = score;
            bestTriIdx = t;
            bestC = c;
            bestAffC = affC;
          }
        }

        if (bestTriIdx >= 0 && bestC >= 0) {
          triOccupancy[bestTriIdx]! += 1;
          const wC = Math.min(0.24, triangleSpread * 0.42);
          const scaleAB = 1 - wC;
          const wA = (raw.weights[0]?.normalizedWeight ?? 0.5) * scaleAB;
          const wB = (raw.weights[1]?.normalizedWeight ?? 0.5) * scaleAB;
          const newUnit = [a, b, bestC];
          const newWeights = [
            { clusterIndex: a, coverage: raw.weights[0]?.coverage ?? 0.5, normalizedWeight: wA },
            { clusterIndex: b, coverage: raw.weights[1]?.coverage ?? 0.5, normalizedWeight: wB },
            { clusterIndex: bestC, coverage: Math.max(0.05, bestAffC), normalizedWeight: wC },
          ];
          let bx = 0;
          let by = 0;
          for (const w of newWeights) {
            const pt = ctx.mesh.vertices[w.clusterIndex]!;
            bx += pt.x * w.normalizedWeight;
            by += pt.y * w.normalizedWeight;
          }
          return {
            ...raw,
            unitVertices: newUnit,
            weights: newWeights,
            anchor: { x: bx, y: by },
          };
        }
      }

      return raw;
    });

    return assembleClusteringOutput({
      corpus,
      mesh: ctx.mesh,
      vertexCoreTags,
      vertexSharedTags,
      rawAssignments: spreadAssignments,
      matchedUids,
      preservedColors,
      formatTagLabel: ctx.formatTagLabel,
      resolveTagMeta: ctx.resolveTagMeta,
    });
  };

  const baseForMeta = createJaccardAnnealingClusteringStrategy<TItem, TTagMeta>(options);

  return {
    name: 'soft-simplex-tags',
    requiresTags: true,
    getTags: options.getTags,
    normalizeTag: options.normalizeTag,
    estimateClusterCount: baseForMeta.estimateClusterCount,
    initialize: runSoftTagged,
    update: runSoftTagged,
  };
}
