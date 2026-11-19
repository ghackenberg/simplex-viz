import {
  analyzeTagCorpus,
  assignItemsToSimplexUnits,
  completePlanarSharedTags,
  defaultNormalizeTag,
  embedClustersQapAnnealing,
  embedSimilarityMatrixOnMesh,
  extractIdentifiedItems,
  extractNormalizedItems,
  matchClustersHungarian,
  partitionTagsJaccard,
  resolveTagDisplayLabel,
  solveHungarianAssignment,
  type AnalyzedTagCorpus,
  type ComputedItemPlacement,
  type NormalizedContentItem,
  type PreviousClusterSnapshot,
  type RawItemUnitAssignment,
  type SharedTagRuleKind,
  type SimplexAnchorRuleKind,
} from './clustering.js';
import { computeConvexMtv, getHullBoundingBox } from './geometry.js';
import {
  createCollisionLocalScaleController,
  createDensityPriorScaleController,
  createMeshInwardFanSeeder,
  createSpaceFillingPbdRelaxer,
  createUniformScaleController,
  measureLayoutOverlaps,
  solveComposedLayout,
  withWarmStartSeeder,
  type LayoutClusterInput,
  type LayoutItemInput,
  type LayoutSeeder,
  type PlacedNode,
  type PositionRelaxer,
  type ScaleController,
  type TwoPhaseLayoutResult,
} from './layout.js';
import {
  buildSimplexLattice,
  buildSimplexMesh,
  resolveDefaultInnerPadding,
} from './mesh.js';
import {
  assignGreedyEdgeContrastColors,
  assignMeshClusterColors,
  hexToOklab,
  mixOklabColors,
  type OklabTuple,
} from './oklab.js';
import { DeterministicRng } from './prng.js';
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterMemberRef,
  DefaultTaggedItem,
  IdentifiedItem,
  LayoutSolverOptions,
  MeshOptions,
  PeerClusterContext,
  Point2D,
  SimplexMesh,
  TagDescriptor,
} from './types.js';
import { assignDiscriminativeClusterLabels } from './discriminativeLabels.js';
import type { SubspaceZoomFeature } from './zoom.js';

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

export interface EstimateClusterCountContext<TItem = DefaultTaggedItem> {
  readonly items: readonly IdentifiedItem<TItem>[];
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  /** Active item count (`normalizedItems.length` for tag strategies, `items.length` otherwise). */
  readonly itemCount: number;
  readonly meshOptions: MeshOptions;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly previousMesh: SimplexMesh | null;
  readonly reason: PipelineUpdateReason;
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly normalizeTag?: (raw: string) => string;
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
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly normalizeTag?: (raw: string) => string;
  readonly formatTagLabel?: (tag: string) => string;
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
  estimateClusterCount?(ctx: EstimateClusterCountContext<TItem>): number | undefined;
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
  /**
   * Optional hook invoked by `SimplexGraphEngine` with the full canonical corpus layout context
   * when subset/timeline seeding is active (e.g. `createFinalSeededLayoutStrategy`).
   */
  seedCanonicalLayout?(
    ctx: LayoutStrategyContext,
    signature?: string,
  ): TwoPhaseLayoutResult;
  /**
   * Optional predicate indicating whether the strategy needs a fresh canonical seed for the
   * provided mesh/viewport/options signature.
   */
  needsCanonicalSeed?(signature: string): boolean;
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
      const mergedOptions: MeshOptions = { ...defaults, ...ctx.meshOptions };
      const maxClusters = mergedOptions.maxClusters ?? 14;
      const requestedK =
        ctx.targetClusterCount ??
        (ctx.uniqueTagCount > 0
          ? ctx.uniqueTagCount
          : Math.min(
              maxClusters,
              Math.max(3, Math.round(Math.sqrt(Math.max(1, ctx.itemCount)))),
            ));
      return buildSimplexMesh(
        ctx.viewportWidth,
        ctx.viewportHeight,
        Math.max(3, requestedK),
        mergedOptions,
      );
    },
  };
}

/**
 * Fixed-dimension `(cols × rows)` 60° equilateral lattice strategy scaled symmetrically
 * to fit the viewport. When `orientation` is omitted or `'auto'`, automatically aligns
 * the lattice major axis with the viewport aspect ratio to maximize usable area.
 */
export function createFixedLatticeMeshStrategy<TItem = DefaultTaggedItem>(config: {
  readonly cols: number;
  readonly rows: number;
  readonly orientation?: 'horizontal' | 'vertical' | 'auto';
  readonly wideFirst?: boolean;
  readonly innerPadding?: number;
  readonly sideLength?: number;
}): SimplexMeshStrategy<TItem> {
  const cols = Math.max(2, Math.round(config.cols));
  const rows = Math.max(2, Math.round(config.rows));
  const configuredOrientation = config.orientation ?? 'auto';
  const wideFirst = config.wideFirst ?? true;

  return {
    name: `fixed-lattice-${cols}x${rows}`,
    buildMesh(ctx) {
      const innerPadding =
        config.innerPadding ??
        ctx.meshOptions.innerPadding ??
        resolveDefaultInnerPadding(ctx.viewportWidth, ctx.viewportHeight);
      const usableW = Math.max(80, ctx.viewportWidth - 2 * innerPadding);
      const usableH = Math.max(80, ctx.viewportHeight - 2 * innerPadding);
      const sqrt3Over2 = Math.sqrt(3) / 2;
      const spanAlongCols = Math.max(0.5, cols - 1);
      const spanAlongRows = Math.max(0.5, (rows - 1) * sqrt3Over2);
      const orientation: 'horizontal' | 'vertical' =
        configuredOrientation === 'horizontal' || configuredOrientation === 'vertical'
          ? configuredOrientation
          : (() => {
              const viewAspect = usableW / usableH;
              const aspectH = spanAlongCols / spanAlongRows;
              const aspectV = spanAlongRows / spanAlongCols;
              const matchH =
                Math.min(aspectH, viewAspect) / Math.max(aspectH, viewAspect);
              const matchV =
                Math.min(aspectV, viewAspect) / Math.max(aspectV, viewAspect);
              return matchH >= matchV ? 'horizontal' : 'vertical';
            })();
      const rawW = orientation === 'horizontal' ? spanAlongCols : spanAlongRows;
      const rawH = orientation === 'horizontal' ? spanAlongRows : spanAlongCols;
      const explicitSide = config.sideLength ?? ctx.meshOptions.sideLength;
      const maxSide =
        ctx.meshOptions.maxSideLength !== undefined &&
        Number.isFinite(ctx.meshOptions.maxSideLength)
          ? Math.max(40, ctx.meshOptions.maxSideLength)
          : Number.POSITIVE_INFINITY;
      const sideLength =
        explicitSide !== undefined && Number.isFinite(explicitSide)
          ? Math.max(40, explicitSide)
          : Math.max(40, Math.min(usableW / rawW, usableH / rawH, maxSide));
      const worldWidth = Math.max(
        ctx.viewportWidth,
        Math.ceil(rawW * sideLength + 2 * innerPadding),
      );
      const worldHeight = Math.max(
        ctx.viewportHeight,
        Math.ceil(rawH * sideLength + 2 * innerPadding),
      );
      const effUsableW = Math.max(80, worldWidth - 2 * innerPadding);
      const effUsableH = Math.max(80, worldHeight - 2 * innerPadding);
      const areaEfficiency = Math.min(
        1,
        (rawW * sideLength * (rawH * sideLength)) / (effUsableW * effUsableH),
      );

      const { vertices, edges, triangles } = buildSimplexLattice(
        cols,
        rows,
        sideLength,
        orientation,
        wideFirst,
        worldWidth,
        worldHeight,
      );

      return {
        width: worldWidth,
        height: worldHeight,
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

      const singleResSq = Math.max(0, sqDistVec(vec, vertexCentroids[primaryVertex]!));
      let chosenUnit: number[] = [primaryVertex];
      let chosenWeights: number[] = [1];
      let chosenResidual = Math.sqrt(singleResSq);

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
// Built-In Composable & Preset Layout Strategies
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

export interface ComposedLayoutStrategyOptions {
  /** Optional custom strategy identifier. */
  readonly name?: string;
  /** Initial item coordinate generator (`phyllotaxis`, `mesh-inward-fan`, etc.). */
  readonly seeder?: LayoutSeeder;
  /** Inner position solver (`barycentric-pbd`, `space-filling-pbd`, etc.). */
  readonly relaxer?: PositionRelaxer;
  /** Outer scale adaptation controller (`uniform-scale`, `collision-local-scale`, `density-prior-scale`, `fixed-scale`, etc.). */
  readonly scaleController?: ScaleController;
  /**
   * When `true` (default: `true`), reuses settled item coordinates across non-initial updates
   * by wrapping `seeder` with `withWarmStartSeeder`. Set `false` for cold-start solves every frame.
   */
  readonly warmStart?: boolean;
  /** Default relaxation iteration budget if `ctx.layoutOptions.relaxationIterations` is omitted. */
  readonly defaultRelaxationIterations?: number;
}

/**
 * Composes an arbitrary `LayoutSeeder` × `PositionRelaxer` × `ScaleController` combination
 * into a `SimplexLayoutStrategy` coupled via an outer-scale / inner-position feedback loop.
 */
export function createComposedLayoutStrategy(
  options?: ComposedLayoutStrategyOptions,
): SimplexLayoutStrategy {
  const baseSeeder = options?.seeder ?? createMeshInwardFanSeeder();
  const warmStart = options?.warmStart ?? true;
  const effectiveSeeder = warmStart ? withWarmStartSeeder(baseSeeder) : baseSeeder;
  const relaxer = options?.relaxer ?? createSpaceFillingPbdRelaxer();
  const scaleController = options?.scaleController ?? createCollisionLocalScaleController();
  const defaultRelaxationIterations = options?.defaultRelaxationIterations ?? 44;
  const strategyName =
    options?.name ??
    `composed(${effectiveSeeder.name}+${relaxer.name}+${scaleController.name})`;

  return {
    name: strategyName,
    solve(ctx) {
      return solveComposedLayout({
        clusters: ctx.clusters,
        items: ctx.items,
        mesh: ctx.mesh,
        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,
        viewportMargin: ctx.viewportMargin,
        options: ctx.layoutOptions,
        previousItemPositions:
          warmStart && ctx.reason !== 'initial'
            ? toPositionMap(ctx.previousItemPositions)
            : undefined,
        seeder: effectiveSeeder,
        relaxer,
        scaleController,
        defaultRelaxationIterations,
      });
    },
  };
}

/**
 * Default space-filling uniform layout strategy: fans co-located items into open covering
 * mesh triangles, binary-searches a single global scale factor `\alpha` to preserve exact
 * relative size ratios across all nodes, and polishes with hard SAT separation (`0.0 px` overlap).
 */
export function createPbdUniformLayoutStrategy(): SimplexLayoutStrategy {
  return createComposedLayoutStrategy({
    name: 'pbd-uniform',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.72,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createUniformScaleController(),
    warmStart: false,
    defaultRelaxationIterations: 42,
  });
}

/**
 * Warm-started space-filling uniform PBD layout strategy: reuses existing items' settled
 * coordinates as initial positions during updates to minimize visual jumping when items are
 * added/removed or strategies change, while strictly guaranteeing `0.0 px` overlap.
 */
export function createWarmStartPbdLayoutStrategy(): SimplexLayoutStrategy {
  return createComposedLayoutStrategy({
    name: 'pbd-warm-start',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.72,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createUniformScaleController(),
    warmStart: true,
    defaultRelaxationIterations: 42,
  });
}

/**
 * Local density-adaptive scaling layout strategy: disperses items across open covering-triangle
 * interiors first, evaluates a smooth radial crowd kernel on the dispersed neighborhood so dense
 * hubs taper gradually while sparse regions keep full `1.0` scale, and polishes locally to
 * enforce `0.0 px` overlap across all hulls and viewport edges.
 */
export function createLocalAdaptiveLayoutStrategy(options?: {
  readonly crowdRadiusPx?: number;
  readonly minLocalScale?: number;
  readonly warmStart?: boolean;
}): SimplexLayoutStrategy {
  return createComposedLayoutStrategy({
    name: 'local-adaptive',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.7,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createDensityPriorScaleController({
      crowdRadiusPx: options?.crowdRadiusPx,
      minLocalScale: options?.minLocalScale,
    }),
    warmStart: options?.warmStart ?? true,
    defaultRelaxationIterations: 44,
  });
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
  return createComposedLayoutStrategy({
    name: 'collision-driven-adaptive',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.7,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createCollisionLocalScaleController({
      minLocalScale: options?.minLocalScale,
      shrinkFactor: options?.shrinkFactor,
    }),
    warmStart: options?.warmStart ?? true,
    defaultRelaxationIterations: 46,
  });
}

/**
 * Scaling mode for `createFinalSeededLayoutStrategy` when projecting partial subsets
 * (such as early chronological timeline frames) onto the canonical full-corpus layout:
 * - `'pinned'` (default): Pins both final `(x, y)` coordinates and final scales from step `N`
 *   for 100% spatial & size invariance across forward/backward scrubbing.
 * - `'adaptive'`: Pins exact final `(x, y)` coordinates (zero spatial drift!), while allowing
 *   items on sparse early frames to expand symmetrically up to full `1.0x` scale whenever
 *   they remain strictly overlap-free (`0.0 px` overlap) against active neighbors and clusters.
 */
export type FinalSeededLayoutScaleMode = 'pinned' | 'adaptive';

/**
 * Configuration options for `createFinalSeededLayoutStrategy`.
 */
export interface FinalSeededLayoutOptions {
  /** Base layout strategy used to solve the canonical full-corpus frame. Default: `createCollisionDrivenLayoutStrategy()`. */
  readonly baseStrategy?: SimplexLayoutStrategy;
  /** Scaling behavior for active subsets. Default: `'pinned'`. */
  readonly scaleMode?: FinalSeededLayoutScaleMode;
  /**
   * Policy when `solve()` encounters items absent from the cached canonical seed:
   * - `'fallback'` (default): Solves via `baseStrategy` with cached seed items as warm-start hints.
   * - `'reseed'`: Re-solves the new superset and caches it as the new canonical seed.
   */
  readonly unseenItemPolicy?: 'fallback' | 'reseed';
}

function isSimplexLayoutStrategy(value: unknown): value is SimplexLayoutStrategy {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as SimplexLayoutStrategy).name === 'string' &&
    'solve' in value &&
    typeof (value as SimplexLayoutStrategy).solve === 'function'
  );
}

function computeLayoutEnvironmentSignature(ctx: LayoutStrategyContext): string {
  const meshVertSig = ctx.mesh.vertices
    .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
    .join(';');
  const lo = ctx.layoutOptions;
  return [
    ctx.viewportWidth.toFixed(1),
    ctx.viewportHeight.toFixed(1),
    ctx.viewportMargin.toFixed(1),
    (lo.clusterGapPx ?? '').toString(),
    (lo.itemGapPx ?? '').toString(),
    (lo.minContentScale ?? '').toString(),
    (lo.relaxationIterations ?? '').toString(),
    (lo.sizeMultiplier ?? 1).toFixed(4),
    (lo.seed ?? '').toString(),
    meshVertSig,
  ].join('|');
}

function isInsideViewport(
  hull: PlacedNode['hull'],
  x: number,
  y: number,
  scale: number,
  viewportW: number,
  viewportH: number,
  margin: number,
): boolean {
  const box = getHullBoundingBox(hull, x, y, scale);
  return (
    box.minX >= margin - 1e-3 &&
    box.maxX <= viewportW - margin + 1e-3 &&
    box.minY >= margin - 1e-3 &&
    box.maxY <= viewportH - margin + 1e-3
  );
}

function solveSymmetricAdaptiveScales(
  clusters: readonly PlacedNode[],
  pinnedItems: readonly PlacedNode[],
  ctx: LayoutStrategyContext,
): readonly PlacedNode[] {
  const n = pinnedItems.length;
  if (n === 0) return pinnedItems;

  const sizeMult = Math.max(0.1, ctx.layoutOptions.sizeMultiplier ?? 1);
  const clusterGap = Math.max(0, ctx.layoutOptions.clusterGapPx ?? 14);
  const itemGap = Math.max(0, ctx.layoutOptions.itemGapPx ?? 5);
  const margin = ctx.viewportMargin;

  // Step 1: For each active item independently, find max scale in [pinnedScale, sizeMult]
  // that clears viewport margins and all active cluster obstacles.
  const minScales = new Float64Array(n);
  const capScales = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const it = pinnedItems[i]!;
    const lo = it.scale;
    const hi = Math.max(lo, sizeMult);
    minScales[i] = lo;

    const fitsObstacles = (s: number): boolean => {
      if (
        !isInsideViewport(
          it.hull,
          it.x,
          it.y,
          s,
          ctx.viewportWidth,
          ctx.viewportHeight,
          margin,
        )
      ) {
        return false;
      }
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c]!;
        const mtv = computeConvexMtv(
          it.hull,
          it.x,
          it.y,
          s,
          cl.hull,
          cl.x,
          cl.y,
          cl.scale,
          clusterGap,
        );
        if (mtv && mtv.depth > 1e-4) {
          return false;
        }
      }
      return true;
    };

    if (hi <= lo + 1e-4 || !fitsObstacles(lo)) {
      capScales[i] = lo;
    } else if (fitsObstacles(hi)) {
      capScales[i] = hi;
    } else {
      let a = lo;
      let b = hi;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (a + b) * 0.5;
        if (fitsObstacles(mid)) {
          a = mid;
        } else {
          b = mid;
        }
      }
      capScales[i] = a;
    }
  }

  // Step 2: Symmetric pairwise cap — every colliding pair (i, j) trims both scales
  // proportionally toward their guaranteed-safe pinnedScale so result is 100% order-independent
  // and guaranteed 0.0 px overlap across all pairs.
  const finalScales = new Float64Array(capScales);

  for (let i = 0; i < n; i++) {
    const itA = pinnedItems[i]!;
    const loA = minScales[i]!;
    for (let j = i + 1; j < n; j++) {
      const itB = pinnedItems[j]!;
      const loB = minScales[j]!;
      const hiA = finalScales[i]!;
      const hiB = finalScales[j]!;
      if (hiA <= loA + 1e-4 && hiB <= loB + 1e-4) continue;

      const initialMtv = computeConvexMtv(
        itA.hull,
        itA.x,
        itA.y,
        hiA,
        itB.hull,
        itB.x,
        itB.y,
        hiB,
        itemGap,
      );
      if (!initialMtv || initialMtv.depth <= 1e-4) continue;

      let tLo = 0;
      let tHi = 1;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (tLo + tHi) * 0.5;
        const sA = loA + mid * (hiA - loA);
        const sB = loB + mid * (hiB - loB);
        const mtv = computeConvexMtv(
          itA.hull,
          itA.x,
          itA.y,
          sA,
          itB.hull,
          itB.x,
          itB.y,
          sB,
          itemGap,
        );
        if (!mtv || mtv.depth <= 1e-4) {
          tLo = mid;
        } else {
          tHi = mid;
        }
      }
      finalScales[i] = loA + tLo * (hiA - loA);
      finalScales[j] = loB + tLo * (hiB - loB);
    }
  }

  return pinnedItems.map((it, idx) => ({
    ...it,
    scale: finalScales[idx]!,
  }));
}

/**
 * Final-seeded (frozen-coordinate) layout strategy wrapper for chronological timelines
 * and filtered subset exploration.
 *
 * Solves the canonical full-corpus layout once via `baseStrategy` (automatically re-seeding
 * on viewport, mesh, or `layoutOptions` changes), then projects any subset `0..N` directly
 * onto its exact final coordinates with **zero spatial drift** and **100% path-independent**
 * forward/backward scrubbing.
 *
 * - `scaleMode: 'pinned'` (default): Preserves both exact final coordinates and exact final scales.
 * - `scaleMode: 'adaptive'`: Preserves exact final coordinates while allowing sparse early frames
 *   to expand smoothly up to `1.0x` scale whenever strictly overlap-free (`0.0 px` overlap).
 */
export function createFinalSeededLayoutStrategy(
  baseOrOptions?: SimplexLayoutStrategy | FinalSeededLayoutOptions,
  extraOptions?: Omit<FinalSeededLayoutOptions, 'baseStrategy'>,
): SimplexLayoutStrategy {
  const resolved: FinalSeededLayoutOptions = isSimplexLayoutStrategy(baseOrOptions)
    ? { ...extraOptions, baseStrategy: baseOrOptions }
    : { ...baseOrOptions, ...extraOptions };

  const baseStrategy: SimplexLayoutStrategy =
    resolved.baseStrategy ?? createCollisionDrivenLayoutStrategy();
  const scaleMode: FinalSeededLayoutScaleMode = resolved.scaleMode ?? 'pinned';
  const unseenItemPolicy = resolved.unseenItemPolicy ?? 'fallback';

  let cachedEnvSignature: string | null = null;
  let cachedExternalSeedSignature: string | null = null;
  let cachedClustersById = new Map<string, PlacedNode>();
  let cachedItemsById = new Map<string, PlacedNode>();
  let cachedResult: TwoPhaseLayoutResult | null = null;

  const storeCanonicalSeed = (
    ctx: LayoutStrategyContext,
    result: TwoPhaseLayoutResult,
    externalSignature?: string,
  ): TwoPhaseLayoutResult => {
    cachedEnvSignature = computeLayoutEnvironmentSignature(ctx);
    cachedExternalSeedSignature = externalSignature ?? null;
    cachedResult = result;
    cachedClustersById = new Map(result.clusters.map((c) => [c.id, c]));
    cachedItemsById = new Map(result.items.map((it) => [it.id, it]));
    return result;
  };

  return {
    name: `final-seeded(${baseStrategy.name}:${scaleMode})`,

    needsCanonicalSeed(signature: string): boolean {
      return cachedResult === null || cachedExternalSeedSignature !== signature;
    },

    seedCanonicalLayout(
      ctx: LayoutStrategyContext,
      signature?: string,
    ): TwoPhaseLayoutResult {
      const solved = baseStrategy.solve({
        ...ctx,
        previousClusterPositions: undefined,
        previousItemPositions: undefined,
        reason: 'initial',
      });
      return storeCanonicalSeed(ctx, solved, signature);
    },

    solve(ctx: LayoutStrategyContext): TwoPhaseLayoutResult {
      const envSig = computeLayoutEnvironmentSignature(ctx);

      // No canonical seed yet or environment changed without an external full-corpus seed:
      // solve cleanly with baseStrategy and capture as canonical seed.
      if (!cachedResult || cachedEnvSignature !== envSig) {
        const solved = baseStrategy.solve(ctx);
        return storeCanonicalSeed(ctx, solved);
      }

      // Check whether all requested clusters and items exist in the canonical seed
      let allClustersMatched = true;
      for (const cl of ctx.clusters) {
        if (!cachedClustersById.has(cl.id)) {
          allClustersMatched = false;
          break;
        }
      }
      let allItemsMatched = true;
      for (const it of ctx.items) {
        if (!cachedItemsById.has(it.id)) {
          allItemsMatched = false;
          break;
        }
      }

      if (!allClustersMatched || !allItemsMatched) {
        if (unseenItemPolicy === 'reseed') {
          const solved = baseStrategy.solve({
            ...ctx,
            previousClusterPositions: undefined,
            previousItemPositions: undefined,
            reason: 'initial',
          });
          return storeCanonicalSeed(ctx, solved);
        }
        // Fallback: warm-start baseStrategy from cached seed positions
        const seedPrevClusters = new Map<string, PreviousNodeLayout>();
        for (const [id, node] of cachedClustersById) {
          seedPrevClusters.set(id, { x: node.x, y: node.y, scale: node.scale });
        }
        const seedPrevItems = new Map<string, PreviousNodeLayout>();
        for (const [id, node] of cachedItemsById) {
          seedPrevItems.set(id, { x: node.x, y: node.y, scale: node.scale });
        }
        return baseStrategy.solve({
          ...ctx,
          previousClusterPositions: seedPrevClusters,
          previousItemPositions: seedPrevItems,
        });
      }

      // Project active clusters & items onto exact canonical seed coordinates
      const placedClusters: PlacedNode[] = ctx.clusters.map((cl) => {
        const seeded = cachedClustersById.get(cl.id)!;
        return {
          ...seeded,
          hull: cl.hull,
        };
      });

      const pinnedItems: PlacedNode[] = ctx.items.map((it) => {
        const seeded = cachedItemsById.get(it.id)!;
        return {
          ...seeded,
          hull: it.hull,
        };
      });

      const finalItems =
        scaleMode === 'adaptive'
          ? solveSymmetricAdaptiveScales(placedClusters, pinnedItems, ctx)
          : pinnedItems;

      const overlaps = measureLayoutOverlaps(
        placedClusters,
        finalItems,
        ctx.viewportWidth,
        ctx.viewportHeight,
        ctx.viewportMargin,
      );

      let minContentScale = cachedResult.contentScale;
      if (finalItems.length > 0) {
        minContentScale = Infinity;
        for (const it of finalItems) {
          if (it.scale < minContentScale) minContentScale = it.scale;
        }
      }

      return {
        clusters: placedClusters,
        items: finalItems,
        clusterScale: cachedResult.clusterScale,
        contentScale: minContentScale,
        overlapCount: overlaps.overlapCount,
        maxPenetrationPx: overlaps.maxPenetrationPx,
      };
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

  const allItems: readonly TItem[] = clusteringOutput.items.map((it) => it.item);
  const peerClusters: readonly PeerClusterContext<TItem, TTagMeta>[] =
    clusteringOutput.clusters.map((base) => ({
      clusterIndex: base.clusterIndex,
      clusterUid: base.clusterUid,
      code: base.code,
      defaultLabel: base.defaultLabel,
      coreTags: base.coreTags,
      members: base.members,
      representativeItems: base.representativeItems,
    }));

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta | undefined>[] =
    clusteringOutput.clusters.map((base, idx) => {
      const color = assignedColors[idx] ?? fallbackColor;
      const derivationCtx: ClusterDerivationContext<TItem, TTagMeta> = {
        ...base,
        colorHex: color.hex,
        oklab: color.oklab,
        allItems,
        peerClusters,
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

