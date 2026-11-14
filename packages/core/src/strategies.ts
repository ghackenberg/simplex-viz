import {
  analyzeTagCorpus,
  assignItemsToSimplexUnits,
  completePlanarSharedTags,
  defaultNormalizeTag,
  embedClustersQapAnnealing,
  embedSimilarityMatrixOnMesh,
  extractNormalizedItems,
  matchClustersHungarian,
  partitionTagsJaccard,
  solveHungarianAssignment,
  type AnalyzedTagCorpus,
  type ComputedItemPlacement,
  type NormalizedContentItem,
  type PreviousClusterSnapshot,
  type RawItemUnitAssignment,
  type SharedTagRuleKind,
  type SimplexAnchorRuleKind,
} from './clustering';
import {
  solveCollisionDrivenLayout,
  solveLocalAdaptiveLayout,
  solveTwoPhaseLayout,
  type LayoutClusterInput,
  type LayoutItemInput,
  type TwoPhaseLayoutResult,
} from './layout';
import { buildSimplexLattice, buildSimplexMesh } from './mesh';
import {
  assignGreedyEdgeContrastColors,
  assignMeshClusterColors,
  hexToOklab,
  mixOklabColors,
  type OklabTuple,
} from './oklab';
import { DeterministicRng } from './prng';
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterMemberRef,
  DefaultTaggedItem,
  IdentifiedItem,
  LayoutSolverOptions,
  MeshOptions,
  Point2D,
  SimplexMesh,
  TagDescriptor,
} from './types';

/**
 * Reason why the engine or snapshot solver invoked a strategy recomputation.
 */
export type PipelineUpdateReason =
  | 'initial'
  | 'items'
  | 'viewport'
  | 'mesh'
  | 'strategy';

// ============================================================================
// 1. Mesh / Triangulation Strategy
// ============================================================================

export interface SimplexMeshContext<TItem = DefaultTaggedItem> {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly uniqueTagCount: number;
  readonly itemCount: number;
  readonly items: readonly IdentifiedItem<TItem>[];
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  /** Optional desired cluster count provided by the active clustering strategy (e.g. embedding k). */
  readonly targetClusterCount?: number;
  readonly meshOptions: MeshOptions;
  readonly previousMesh: SimplexMesh | null;
  readonly reason: PipelineUpdateReason;
}

export interface SimplexMeshStrategy<TItem = DefaultTaggedItem> {
  readonly name: string;
  buildMesh(ctx: SimplexMeshContext<TItem>): SimplexMesh;
}

// ============================================================================
// 2. Topic Clustering & Vertex Assignment Strategy (+ Shared-Tag & Anchor Rules)
// ============================================================================

export interface SharedTagExpansionContext<TItem = DefaultTaggedItem> {
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly corpus: AnalyzedTagCorpus;
  readonly itemTagIndexLists: readonly (readonly number[])[];
  readonly vertexCoreTags: readonly ReadonlySet<number>[];
  readonly mesh: SimplexMesh;
}

export type SharedTagExpansionFn<TItem = DefaultTaggedItem> = (
  ctx: SharedTagExpansionContext<TItem>,
) => readonly Set<number>[];

export type SharedTagRule<TItem = DefaultTaggedItem> =
  | SharedTagRuleKind
  | SharedTagExpansionFn<TItem>;

export interface SimplexItemAnchorContext<TItem = DefaultTaggedItem> {
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly corpus: AnalyzedTagCorpus;
  readonly itemTagIndexLists: readonly (readonly number[])[];
  readonly vertexCoreTags: readonly ReadonlySet<number>[];
  readonly vertexSharedTags: readonly ReadonlySet<number>[];
  readonly mesh: SimplexMesh;
}

export type SimplexItemAnchorFn<TItem = DefaultTaggedItem> = (
  ctx: SimplexItemAnchorContext<TItem>,
) => readonly RawItemUnitAssignment<TItem>[];

export type SimplexAnchorRule<TItem = DefaultTaggedItem> =
  | SimplexAnchorRuleKind
  | SimplexItemAnchorFn<TItem>;

export interface ComputedTopicCluster<TItem = DefaultTaggedItem, TTagMeta = undefined> {
  readonly clusterIndex: number;
  readonly clusterUid: string;
  readonly code: string;
  readonly defaultLabel: string;
  readonly gridNode: {
    readonly row: number;
    readonly col: number;
    readonly x: number;
    readonly y: number;
  };
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  readonly sharedTags: readonly TagDescriptor<TTagMeta>[];
  readonly members: readonly ClusterMemberRef<TItem>[];
  readonly representativeItems?: readonly ClusterMemberRef<TItem>[];
  readonly centroid?: readonly number[];
  readonly cohesion?: number;
  readonly featureSummary?: string;
}

export interface ComputedItemAnchor<TItem = DefaultTaggedItem, TTagMeta = undefined> {
  readonly id: string;
  readonly item: TItem;
  readonly tags: readonly TagDescriptor<TTagMeta>[];
  readonly anchorX: number;
  readonly anchorY: number;
  readonly unitVertexIndices: readonly number[];
  readonly unitWeights: ReadonlyArray<{
    readonly clusterIndex: number;
    readonly weight: number;
    readonly coverage: number;
  }>;
  readonly residualDistance?: number;
  readonly featureSummary?: string;
}

export interface AssignedColor {
  readonly hex: string;
  readonly oklab: OklabTuple;
}

export interface ClusteringStrategyOutput<TItem = DefaultTaggedItem, TTagMeta = undefined> {
  readonly clusters: readonly ComputedTopicCluster<TItem, TTagMeta>[];
  readonly items: readonly ComputedItemAnchor<TItem, TTagMeta>[];
  readonly uniqueTags: readonly string[];
  readonly preservedColors?: ReadonlyMap<number, AssignedColor>;
}

export interface ClusteringStrategyContext<TItem = DefaultTaggedItem, TTagMeta = undefined> {
  /** All identified domain items (including untagged items for general clustering strategies). */
  readonly items: readonly IdentifiedItem<TItem>[];
  /** Previous identified items from the prior pipeline step. */
  readonly previousItems: readonly IdentifiedItem<TItem>[];
  /** Tag-normalized subset of items populated when `requiresTags !== false`. */
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly previousNormalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly addedItemIds: ReadonlySet<string>;
  readonly removedItemIds: ReadonlySet<string>;
  readonly mesh: SimplexMesh;
  readonly previousMesh: SimplexMesh | null;
  readonly previousClusters: readonly PreviousClusterSnapshot[];
  readonly getTags?: (item: TItem) => readonly string[];
  readonly normalizeTag?: (raw: string) => string;
  readonly resolveTagMeta?: (tag: string) => TTagMeta | undefined;
  readonly allocateClusterUid: () => string;
  readonly seed: number;
  readonly reason: PipelineUpdateReason;
}

export interface SimplexClusteringStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
> {
  readonly name: string;
  /**
   * Indicates whether this strategy requires item tags (`true` by default for backward compatibility).
   * Non-tag strategies (embedding, similarity, custom feature spaces) should set `requiresTags: false`
   * so items without tags are never filtered out.
   */
  readonly requiresTags?: boolean;
  /**
   * Optional strategy-scoped tag extractor used by `SimplexGraphEngine` and `solveSimplexSnapshot`
   * when `getTags` is configured directly on the clustering strategy instead of top-level options.
   */
  readonly getTags?: (item: TItem) => readonly string[];
  /**
   * Optional strategy-scoped tag normalizer paired with strategy-scoped `getTags`.
   */
  readonly normalizeTag?: (rawTag: string) => string;
  /**
   * Optional cluster count hint used by `createAdaptiveHexMeshStrategy` when `uniqueTagCount` is absent
   * or when the strategy prefers a specific number of cluster vertices.
   */
  estimateClusterCount?(ctx: {
    readonly items: readonly IdentifiedItem<TItem>[];
    readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
    readonly meshOptions: MeshOptions;
  }): number | undefined;
  initialize(
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta>;
  update?(
    ctx: ClusteringStrategyContext<TItem, TTagMeta>,
  ): ClusteringStrategyOutput<TItem, TTagMeta>;
}

// ============================================================================
// 3. Cluster Coloring & Item Color-Mixing Strategy
// ============================================================================

export type SimplexColorTheme = 'dark' | 'light';

export interface ClusterColorInput<TItem = DefaultTaggedItem, TTagMeta = undefined> {
  readonly clusterIndex: number;
  readonly clusterUid: string;
  readonly code: string;
  readonly defaultLabel: string;
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  readonly sharedTags: readonly TagDescriptor<TTagMeta>[];
  readonly members: readonly ClusterMemberRef<TItem>[];
  readonly representativeItems?: readonly ClusterMemberRef<TItem>[];
  readonly centroid?: readonly number[];
  readonly cohesion?: number;
  readonly featureSummary?: string;
  readonly gridNode: {
    readonly row: number;
    readonly col: number;
    readonly x: number;
    readonly y: number;
  };
}

export interface ClusterColorStrategyContext<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
> {
  readonly clusters: readonly ClusterColorInput<TItem, TTagMeta>[];
  readonly mesh: SimplexMesh;
  readonly theme: SimplexColorTheme;
  readonly previousTheme?: SimplexColorTheme;
  readonly preservedColors?: ReadonlyMap<number, AssignedColor>;
  readonly previousClusters: readonly PreviousClusterSnapshot[];
  readonly reason: PipelineUpdateReason;
  readonly seed: number;
}

export interface ItemColorMixContext<TItem = DefaultTaggedItem, TTagMeta = undefined> {
  readonly id: string;
  readonly item: TItem;
  readonly tags: readonly TagDescriptor<TTagMeta>[];
  readonly theme: SimplexColorTheme;
  readonly unitColors: ReadonlyArray<{
    readonly clusterIndex: number;
    readonly color: AssignedColor;
    readonly weight: number;
    readonly coverage: number;
  }>;
}

export interface SimplexColorStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
> {
  readonly name: string;
  assignClusterColors(
    ctx: ClusterColorStrategyContext<TItem, TTagMeta>,
  ): readonly AssignedColor[];
  mixItemColor?(ctx: ItemColorMixContext<TItem, TTagMeta>): AssignedColor;
}

// ============================================================================
// 4. Content & Cluster Positioning / Scaling Strategy
// ============================================================================

export interface PreviousNodeLayout {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface LayoutStrategyContext {
  readonly clusters: readonly LayoutClusterInput[];
  readonly items: readonly LayoutItemInput[];
  readonly mesh: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
  readonly layoutOptions: LayoutSolverOptions;
  readonly previousClusterPositions?: ReadonlyMap<string, PreviousNodeLayout>;
  readonly previousItemPositions?: ReadonlyMap<string, PreviousNodeLayout>;
  readonly reason: PipelineUpdateReason;
}

export interface SimplexLayoutStrategy {
  readonly name: string;
  solve(ctx: LayoutStrategyContext): TwoPhaseLayoutResult;
}

// ============================================================================
// Internal Shared Helpers for Clustering Assembly
// ============================================================================

function resolveSharedTags<TItem>(params: {
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

function resolveItemAnchors<TItem>(params: {
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

function assembleClusteringOutput<TItem, TTagMeta>(params: {
  readonly corpus: AnalyzedTagCorpus;
  readonly mesh: SimplexMesh;
  readonly vertexCoreTags: readonly ReadonlySet<number>[];
  readonly vertexSharedTags: readonly ReadonlySet<number>[];
  readonly rawAssignments: readonly RawItemUnitAssignment<TItem>[];
  readonly matchedUids: readonly string[];
  readonly preservedColors: ReadonlyMap<number, AssignedColor>;
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

  const buildTagDescriptor = (tag: string): TagDescriptor<TTagMeta> => ({
    tag,
    frequency: tagFreqMap.get(tag) ?? 0,
    meta: resolveTagMeta ? resolveTagMeta(tag) : undefined,
  });

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
        .map((t) => t.tag)
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

// ============================================================================
// Built-In Mesh Strategies
// ============================================================================

/**
 * Default area-maximizing 60° toothed equilateral simplex mesh strategy.
 */
export function createAdaptiveHexMeshStrategy<TItem = DefaultTaggedItem>(
  defaults?: MeshOptions,
): SimplexMeshStrategy<TItem> {
  return {
    name: 'adaptive-hex-mesh',
    buildMesh(ctx) {
      const requestedK =
        ctx.targetClusterCount ??
        (ctx.uniqueTagCount > 0
          ? ctx.uniqueTagCount
          : Math.min(12, Math.max(3, Math.round(Math.sqrt(Math.max(1, ctx.itemCount))))));
      return buildSimplexMesh(
        ctx.viewportWidth,
        ctx.viewportHeight,
        Math.max(3, requestedK),
        { ...defaults, ...ctx.meshOptions },
      );
    },
  };
}

/**
 * Fixed-dimension `(cols × rows)` 60° equilateral lattice strategy scaled symmetrically
 * to fit the viewport. Useful when maintaining deterministic cluster vertex counts across resizes.
 */
export function createFixedLatticeMeshStrategy<TItem = DefaultTaggedItem>(config: {
  readonly cols: number;
  readonly rows: number;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly wideFirst?: boolean;
  readonly innerPadding?: number;
}): SimplexMeshStrategy<TItem> {
  const cols = Math.max(2, Math.round(config.cols));
  const rows = Math.max(2, Math.round(config.rows));
  const orientation = config.orientation ?? 'horizontal';
  const wideFirst = config.wideFirst ?? true;

  return {
    name: `fixed-lattice-${cols}x${rows}`,
    buildMesh(ctx) {
      const innerPadding = config.innerPadding ?? ctx.meshOptions.innerPadding ?? 48;
      const usableW = Math.max(80, ctx.viewportWidth - 2 * innerPadding);
      const usableH = Math.max(80, ctx.viewportHeight - 2 * innerPadding);
      const sqrt3Over2 = Math.sqrt(3) / 2;
      const spanAlongCols = Math.max(0.5, cols - 1);
      const spanAlongRows = Math.max(0.5, (rows - 1) * sqrt3Over2);
      const rawW = orientation === 'horizontal' ? spanAlongCols : spanAlongRows;
      const rawH = orientation === 'horizontal' ? spanAlongRows : spanAlongCols;
      const sideLength = Math.max(40, Math.min(usableW / rawW, usableH / rawH));
      const areaEfficiency = (rawW * sideLength * (rawH * sideLength)) / (usableW * usableH);

      const { vertices, edges, triangles } = buildSimplexLattice(
        cols,
        rows,
        sideLength,
        orientation,
        wideFirst,
        ctx.viewportWidth,
        ctx.viewportHeight,
      );

      return {
        width: ctx.viewportWidth,
        height: ctx.viewportHeight,
        innerPadding,
        sideLength,
        orientation,
        wideFirst,
        areaEfficiency,
        vertices,
        edges,
        triangles,
      };
    },
  };
}

// ============================================================================
// Built-In Clustering Strategies
// ============================================================================

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

function resolveStrategyNormalizedItems<TItem, TTagMeta>(
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
      if (ctx.previousClusters.length === 0) {
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
        resolveTagMeta: ctx.resolveTagMeta,
      });
    },
  };
}

/**
 * Load-balanced QAP refinement: starts from standard QAP mesh embedding and adds a soft
 * preference for placing high-membership clusters onto high-degree interior mesh vertices
 * (which border 4–6 triangles instead of 1–2 corner triangles).
 */
function embedLoadBalancedOnMesh(params: {
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
          const simVal = (it === st ? 0.85 : (similarity[it]?.[st] ?? 0) * 0.75);
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

      if (raw.unitVertices.length === 1) {
        const v = raw.unitVertices[0]!;
        let bestTriIdx = -1;
        let bestTriScore = -Infinity;
        let bestOther: [number, number] = [v, v];
        let bestAffs: [number, number] = [0.25, 0.25];

        for (let t = 0; t < ctx.mesh.triangles.length; t++) {
          const tv = ctx.mesh.triangles[t]!.vertices;
          if (tv[0] !== v && tv[1] !== v && tv[2] !== v) continue;
          const others = tv.filter((u) => u !== v);
          if (others.length !== 2) continue;
          const [b, c] = [others[0]!, others[1]!];
          const affB = scoreItemToVertex(raw.tagIndices, b);
          const affC = scoreItemToVertex(raw.tagIndices, c);
          const loadPenalty = 1 + 0.14 * triOccupancy[t]!;
          const score = (affB + affC + 0.12) / loadPenalty;
          if (score > bestTriScore) {
            bestTriScore = score;
            bestTriIdx = t;
            bestOther = [b, c];
            bestAffs = [affB, affC];
          }
        }

        if (bestTriIdx >= 0) {
          triOccupancy[bestTriIdx]! += 1;
          const [b, c] = bestOther;
          const sB = bestAffs[0] + 0.18;
          const sC = bestAffs[1] + 0.18;
          const sTotal = sB + sC;
          const wV = 1 - triangleSpread;
          const wB = triangleSpread * (sB / sTotal);
          const wC = triangleSpread * (sC / sTotal);
          const newUnit = [v, b, c];
          const newWeights = [
            { clusterIndex: v, coverage: raw.weights[0]?.coverage ?? 1, normalizedWeight: wV },
            { clusterIndex: b, coverage: Math.max(0.05, bestAffs[0]), normalizedWeight: wB },
            { clusterIndex: c, coverage: Math.max(0.05, bestAffs[1]), normalizedWeight: wC },
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

// ============================================================================
// Built-In Representation-Agnostic Embedding & Similarity Clustering Strategies
// ============================================================================

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

function extractHeuristicItemLabel<TItem>(item: TItem, fallbackId: string): string {
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

    const vectors = buildUnifiedItemVectors(ctx.items, options.getEmbedding, metric);
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
      const counts = new Int32Array(K);
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
          assignments[worstIdx] = c;
          counts[c] = 1;
          for (let d = 0; d < dim; d++) sums[c]![d] = v[d]!;
        } else {
          const v = vectors[worstIdx]!;
          counts[c] = 1;
          for (let d = 0; d < dim; d++) sums[c]![d] = v[d]!;
        }
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

    const clusterToVertex = embedSimilarityMatrixOnMesh({
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
      const vIdx = clusterToVertex[c]!;
      vertexCentroids[vIdx] = centroids[c]!;
    }
    for (let i = 0; i < N; i++) {
      const vIdx = clusterToVertex[assignments[i]!]!;
      vertexPartitionMembers[vIdx]!.add(ctx.items[i]!.id);
    }

    const vertexCentroidArrays = vertexCentroids.map((vc) => Array.from(vc));
    const { matchedUids, preservedColors } = matchClustersHungarian({
      currentVertexMemberSets: vertexPartitionMembers,
      currentVertexCentroids: vertexCentroidArrays,
      mesh: ctx.mesh,
      previousClusters: ctx.previousClusters,
      allocateClusterUid: ctx.allocateClusterUid,
    });

    // 4. Project each item onto optimal planar simplex unit (vertex ≺ edge ≺ triangle)
    const vertexUnits = Array.from({ length: K }, (_, v) => [v] as const);
    const edgeUnits = ctx.mesh.edges.map((e) => [e.a, e.b] as const);
    const triangleUnits = ctx.mesh.triangles.map((tr) => tr.vertices);

    const itemSimScale = Math.max(1e-4, sigmaSq * 0.5);
    const simScoreToVertex = (vec: Float64Array, v: number): number =>
      metric === 'cosine'
        ? Math.max(0, (dotVec(vec, vertexCentroids[v]!) + 1) * 0.5)
        : Math.exp(-sqDistVec(vec, vertexCentroids[v]!) / itemSimScale);

    const membersPerVertex: ClusterMemberRef<TItem>[][] = Array.from({ length: K }, () => []);
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
      const defaultLabel = options.deriveLabel
        ? options.deriveLabel(representatives, v)
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

    return {
      clusters,
      items: itemAnchors,
      uniqueTags: [],
      preservedColors,
    };
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

    const vectors = buildUnifiedItemVectors(ctx.items, options.getEmbedding, metric);
    const dim = vectors[0]!.length;
    const rng = new DeterministicRng(ctx.seed);
    const distToCentroid = (x: Float64Array, c: Float64Array): number =>
      metric === 'cosine' ? Math.max(0, 1 - dotVec(x, c)) : sqDistVec(x, c);

    // 1. Initialize K centroids via warm-start or k-Means++
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
      centroids.push(Float64Array.from(vectors[rng.nextInt(N)]!));
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
        centroids.push(Float64Array.from(vectors[centroids.length % N]!));
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

    // 2. Lloyd / spherical k-Means refinement
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
        const row = sums[c]!;
        const v = vectors[i]!;
        for (let d = 0; d < dim; d++) row[d]! += v[d]!;
      }

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
        for (let d = 0; d < dim; d++) avg[d] = sums[c]![d]! / cnt;
        centroids[c] = metric === 'cosine' ? l2NormalizeCopy(avg) : avg;
      }

      if (iter > 0 && changed === 0) break;
    }

    // 3. Centroid affinity + load-balanced QAP mesh embedding
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

    const itemSimScale = Math.max(1e-4, sigmaSq * 0.65);
    const simScoreToVertex = (vec: Float64Array, v: number): number =>
      metric === 'cosine'
        ? Math.max(0, (dotVec(vec, vertexCentroids[v]!) + 1) * 0.5)
        : Math.exp(-sqDistVec(vec, vertexCentroids[v]!) / itemSimScale);

    const triangleUnits = ctx.mesh.triangles.map((tr) => tr.vertices);
    const triOccupancy = new Int32Array(triangleUnits.length);
    const membersPerVertex: ClusterMemberRef<TItem>[][] = Array.from({ length: K }, () => []);
    const itemAnchors: ComputedItemAnchor<TItem, TTagMeta>[] = [];

    // 4. Continuous soft-simplex projection into best enclosing triangle
    for (let i = 0; i < N; i++) {
      const entry = ctx.items[i]!;
      const vec = vectors[i]!;
      const primaryVertex = clusterToVertex[assignments[i]!]!;

      let chosenUnit: number[] = [primaryVertex];
      let chosenWeights: number[] = [1];
      let chosenResidual = Math.sqrt(Math.max(0, sqDistVec(vec, vertexCentroids[primaryVertex]!)));

      if (triangleUnits.length > 0) {
        // Evaluate triangles (prioritizing triangles incident to primary cluster or low residual)
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

        if (bestTriIdx >= 0) {
          triOccupancy[bestTriIdx]! += 1;
          const [a, b, c] = triangleUnits[bestTriIdx]!;
          const triCorners = [a, b, c];

          // Compute temperature-scaled softmax weights across the 3 triangle corners
          const tempDenom = Math.max(1e-4, itemSimScale * (0.45 + 1.15 * triangleSpread));
          const distSqs = triCorners.map((v) => sqDistVec(vec, vertexCentroids[v]!));
          const minD = Math.min(...distSqs);
          const rawSoft = distSqs.map((d) => Math.exp(-(d - minD) / tempDenom));
          const sumSoft = Math.max(1e-9, rawSoft.reduce((s, x) => s + x, 0));
          const softWeights = rawSoft.map((x) => x / sumSoft);

          // Blend NNLS geometric projection with temperature-scaled softmax, then ensure
          // gentle non-zero interior pull away from cluster vertices
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
      const defaultLabel = options.deriveLabel
        ? options.deriveLabel(representatives, v)
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

    return {
      clusters,
      items: itemAnchors,
      uniqueTags: [],
      preservedColors,
    };
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
        const s = Math.max(0, Math.min(1, options.getSimilarity(ctx.items[i]!.item, ctx.items[j]!.item)));
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

    // Partition & re-select medoid within each cluster (2 passes)
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
        if (bestTri && bestTri.meanSim > topV.s * 1.03 && (!bestEdge || bestTri.meanSim > bestEdge.meanSim * 1.02)) {
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

// ============================================================================
// Built-In Color Strategies
// ============================================================================

/**
 * Default OKLab edge-contrast cluster coloring + chroma-preserving OKLab item mixing.
 */
export function createOklabContrastColorStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(): SimplexColorStrategy<TItem, TTagMeta> {
  return {
    name: 'oklab-contrast',
    assignClusterColors(ctx) {
      const preserved =
        ctx.reason === 'strategy' ? undefined : ctx.preservedColors;
      return assignMeshClusterColors(ctx.clusters.length, ctx.mesh.edges, preserved, {
        theme: 'dark',
      });
    },
    mixItemColor(ctx) {
      return mixOklabColors(
        ctx.unitColors.map((uc) => ({
          oklab: uc.color.oklab,
          weight: uc.weight,
        })),
      );
    },
  };
}

/**
 * Theme-adaptive OKLab contrast strategy that automatically adjusts perceptual lightness & chroma
 * for dark vs. light canvases whenever `theme` changes.
 */
export function createThemeAdaptiveOklabColorStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(): SimplexColorStrategy<TItem, TTagMeta> {
  return {
    name: 'theme-adaptive-oklab',
    assignClusterColors(ctx) {
      const themeChanged =
        ctx.previousTheme !== undefined && ctx.previousTheme !== ctx.theme;
      const preserved =
        ctx.reason === 'strategy' || themeChanged ? undefined : ctx.preservedColors;
      return assignMeshClusterColors(ctx.clusters.length, ctx.mesh.edges, preserved, {
        theme: ctx.theme,
      });
    },
    mixItemColor(ctx) {
      return mixOklabColors(
        ctx.unitColors.map((uc) => ({
          oklab: uc.color.oklab,
          weight: uc.weight,
        })),
      );
    },
  };
}

/**
 * Custom hex palette cluster coloring strategy (optimizing OKLab contrast along mesh edges
 * or assigning sequentially).
 */
export function createPaletteColorStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  hexColors: readonly string[],
  options?: {
    readonly mode?: 'edge-contrast' | 'sequential';
    readonly preserveMatchedColors?: boolean;
  },
): SimplexColorStrategy<TItem, TTagMeta> {
  const sanitized = (hexColors.length > 0 ? hexColors : ['#38bdf8', '#f472b6', '#34d399']).map(
    (hex) => {
      const normalizedHex = hex.startsWith('#') ? hex : `#${hex}`;
      return {
        hex: normalizedHex,
        oklab: hexToOklab(normalizedHex),
      };
    },
  );
  const mode = options?.mode ?? 'edge-contrast';
  const preserveMatched = options?.preserveMatchedColors ?? false;

  return {
    name: 'custom-palette',
    assignClusterColors(ctx) {
      const K = ctx.clusters.length;
      if (mode === 'sequential') {
        return Array.from({ length: K }, (_, idx) => sanitized[idx % sanitized.length]!);
      }
      const preserved =
        preserveMatched && ctx.reason !== 'strategy' ? ctx.preservedColors : undefined;
      return assignGreedyEdgeContrastColors(K, ctx.mesh.edges, sanitized, preserved);
    },
    mixItemColor(ctx) {
      return mixOklabColors(
        ctx.unitColors.map((uc) => ({
          oklab: uc.color.oklab,
          weight: uc.weight,
        })),
      );
    },
  };
}

// ============================================================================
// Built-In Layout Strategies
// ============================================================================

function toPositionMap(
  prev?: ReadonlyMap<string, PreviousNodeLayout>,
): ReadonlyMap<string, Point2D> | undefined {
  if (!prev || prev.size === 0) return undefined;
  const out = new Map<string, Point2D>();
  for (const [id, node] of prev) {
    out.set(id, { x: node.x, y: node.y });
  }
  return out;
}

/**
 * Default deterministic phyllotaxis tie-breaking + uniform global scale binary search
 * + PBD convex relaxation + hard-separation polish (`0.0 px` overlap).
 */
export function createPbdUniformLayoutStrategy(): SimplexLayoutStrategy {
  return {
    name: 'pbd-uniform',
    solve(ctx) {
      return solveTwoPhaseLayout({
        clusters: ctx.clusters,
        items: ctx.items,
        mesh: ctx.mesh,
        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,
        viewportMargin: ctx.viewportMargin,
        options: ctx.layoutOptions,
      });
    },
  };
}

/**
 * Warm-started PBD layout strategy: reuses existing items' settled coordinates as initial
 * positions during updates to minimize visual jumping when items are added/removed or strategies change,
 * while strictly guaranteeing `0.0 px` overlap.
 */
export function createWarmStartPbdLayoutStrategy(): SimplexLayoutStrategy {
  return {
    name: 'pbd-warm-start',
    solve(ctx) {
      return solveTwoPhaseLayout({
        clusters: ctx.clusters,
        items: ctx.items,
        mesh: ctx.mesh,
        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,
        viewportMargin: ctx.viewportMargin,
        options: ctx.layoutOptions,
        previousItemPositions:
          ctx.reason === 'initial' ? undefined : toPositionMap(ctx.previousItemPositions),
      });
    },
  };
}

/**
 * Local density-adaptive scaling layout strategy: shrinks only content nodes in locally
 * crowded anchor hotspots so sparser regions preserve full `1.0` scale legibility,
 * while enforcing `0.0 px` overlap across all hulls and viewport edges.
 */
export function createLocalAdaptiveLayoutStrategy(options?: {
  readonly crowdRadiusPx?: number;
  readonly minLocalScale?: number;
  readonly warmStart?: boolean;
}): SimplexLayoutStrategy {
  return {
    name: 'local-adaptive',
    solve(ctx) {
      return solveLocalAdaptiveLayout({
        clusters: ctx.clusters,
        items: ctx.items,
        mesh: ctx.mesh,
        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,
        viewportMargin: ctx.viewportMargin,
        options: ctx.layoutOptions,
        crowdRadiusPx: options?.crowdRadiusPx,
        minLocalScale: options?.minLocalScale,
        previousItemPositions:
          options?.warmStart && ctx.reason !== 'initial'
            ? toPositionMap(ctx.previousItemPositions)
            : undefined,
      });
    },
  };
}

export interface CollisionDrivenLayoutOptions {
  /** Minimum scale permitted for locally crowded colliding items. Default: `0.32`. */
  readonly minLocalScale?: number;
  /** Per-round multiplicative shrink step applied only to colliding items. Default: `0.85`. */
  readonly shrinkFactor?: number;
  /** Warm-starts item positions across updates for smooth transitions. Default: `true`. */
  readonly warmStart?: boolean;
}

/**
 * Collision-driven adaptive layout strategy:
 *
 * Keeps every node at full `1.0` scale wherever possible, spreads congested anchors into open
 * adjacent mesh triangles, and progressively shrinks **only** the locally colliding pockets until
 * `0.0 px` overlap is guaranteed.
 */
export function createCollisionDrivenLayoutStrategy(
  options?: CollisionDrivenLayoutOptions,
): SimplexLayoutStrategy {
  const warmStart = options?.warmStart ?? true;
  return {
    name: 'collision-driven-adaptive',
    solve(ctx) {
      return solveCollisionDrivenLayout({
        clusters: ctx.clusters,
        items: ctx.items,
        mesh: ctx.mesh,
        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,
        viewportMargin: ctx.viewportMargin,
        options: ctx.layoutOptions,
        minLocalScale: options?.minLocalScale,
        shrinkFactor: options?.shrinkFactor,
        previousItemPositions:
          warmStart && ctx.reason !== 'initial'
            ? toPositionMap(ctx.previousItemPositions)
            : undefined,
      });
    },
  };
}

/**
 * Applies `SimplexColorStrategy` and `deriveClusterMeta` to the topological output
 * of a `SimplexClusteringStrategy`, producing final `ClusterDescriptor`s and
 * `ComputedItemPlacement`s shared by both `SimplexGraphEngine` and `solveSimplexSnapshot`.
 */
export function finalizeClusteringWithColors<TItem, TTagMeta, TClusterMeta>(params: {
  readonly clusteringOutput: ClusteringStrategyOutput<TItem, TTagMeta>;
  readonly mesh: SimplexMesh;
  readonly colorStrategy: SimplexColorStrategy<TItem, TTagMeta>;
  readonly theme: SimplexColorTheme;
  readonly previousTheme?: SimplexColorTheme;
  readonly previousClusters: readonly PreviousClusterSnapshot[];
  readonly reason: PipelineUpdateReason;
  readonly seed: number;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
}): {
  readonly clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta | undefined>[];
  readonly items: readonly ComputedItemPlacement<TItem, TTagMeta, TClusterMeta | undefined>[];
  readonly uniqueTags: readonly string[];
} {
  const {
    clusteringOutput,
    mesh,
    colorStrategy,
    theme,
    previousTheme,
    previousClusters,
    reason,
    seed,
    deriveClusterMeta,
  } = params;

  if (clusteringOutput.clusters.length === 0) {
    return {
      clusters: [],
      items: [],
      uniqueTags: clusteringOutput.uniqueTags,
    };
  }

  const assignedColors = colorStrategy.assignClusterColors({
    clusters: clusteringOutput.clusters,
    mesh,
    theme,
    previousTheme,
    preservedColors: clusteringOutput.preservedColors,
    previousClusters,
    reason,
    seed,
  });

  const fallbackColor: AssignedColor = {
    hex: '#38bdf8',
    oklab: hexToOklab('#38bdf8'),
  };

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta | undefined>[] =
    clusteringOutput.clusters.map((base, idx) => {
      const color = assignedColors[idx] ?? fallbackColor;
      const derivationCtx: ClusterDerivationContext<TItem, TTagMeta> = {
        ...base,
        colorHex: color.hex,
        oklab: color.oklab,
      };
      const meta = deriveClusterMeta ? deriveClusterMeta(derivationCtx) : undefined;
      return {
        ...derivationCtx,
        meta,
      };
    });

  const items: ComputedItemPlacement<TItem, TTagMeta, TClusterMeta | undefined>[] =
    clusteringOutput.items.map((anchor) => {
      const unitClusters = anchor.unitWeights.map((uw) => ({
        cluster: clusters[uw.clusterIndex]!,
        weight: uw.weight,
        coverage: uw.coverage,
      }));
      const unitColors = anchor.unitWeights.map((uw) => ({
        clusterIndex: uw.clusterIndex,
        color: assignedColors[uw.clusterIndex] ?? fallbackColor,
        weight: uw.weight,
        coverage: uw.coverage,
      }));
      const mixedColor = colorStrategy.mixItemColor
        ? colorStrategy.mixItemColor({
            id: anchor.id,
            item: anchor.item,
            tags: anchor.tags,
            theme,
            unitColors,
          })
        : mixOklabColors(
            unitColors.map((uc) => ({ oklab: uc.color.oklab, weight: uc.weight })),
          );

      return {
        id: anchor.id,
        item: anchor.item,
        anchorX: anchor.anchorX,
        anchorY: anchor.anchorY,
        unitVertexIndices: anchor.unitVertexIndices,
        layoutContext: {
          id: anchor.id,
          tags: anchor.tags,
          mixedColorHex: mixedColor.hex,
          mixedOklab: mixedColor.oklab,
          unitClusters,
          residualDistance: anchor.residualDistance,
          featureSummary: anchor.featureSummary,
        },
      };
    });

  return {
    clusters,
    items,
    uniqueTags: clusteringOutput.uniqueTags,
  };
}

