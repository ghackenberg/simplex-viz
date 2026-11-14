import {
  analyzeTagCorpus,
  assignItemsToSimplexUnits,
  completePlanarSharedTags,
  embedClustersQapAnnealing,
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
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterMemberRef,
  DefaultTaggedItem,
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
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
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
  readonly normalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly previousNormalizedItems: readonly NormalizedContentItem<TItem>[];
  readonly addedItemIds: ReadonlySet<string>;
  readonly removedItemIds: ReadonlySet<string>;
  readonly mesh: SimplexMesh;
  readonly previousMesh: SimplexMesh | null;
  readonly previousClusters: readonly PreviousClusterSnapshot[];
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
      return buildSimplexMesh(
        ctx.viewportWidth,
        ctx.viewportHeight,
        Math.max(3, ctx.uniqueTagCount),
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
    const corpus = analyzeTagCorpus(ctx.normalizedItems);
    const { uniqueTags, tagIndexMap } = corpus;
    if (uniqueTags.length === 0 || K === 0) {
      return { clusters: [], items: [], uniqueTags: [] };
    }

    const { corePartitions, tagToCoreCluster } = partitionTagsJaccard(corpus, K);
    const vertexCoreTags = embedClustersQapAnnealing({
      normalizedItems: ctx.normalizedItems,
      tagIndexMap,
      tagToCoreCluster,
      corePartitions,
      mesh: ctx.mesh,
      seed: ctx.seed,
    });

    const itemTagIndexLists = ctx.normalizedItems.map((it) =>
      it.tags.map((t) => tagIndexMap.get(t)!),
    );

    const vertexSharedTags = resolveSharedTags({
      rule: sharedTagRule,
      normalizedItems: ctx.normalizedItems,
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
      normalizedItems: ctx.normalizedItems,
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

  return {
    name: 'jaccard-annealing',
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
    initialize: (ctx) => baseFull.initialize(ctx),
    update(ctx) {
      if (ctx.previousClusters.length === 0) {
        return baseFull.initialize(ctx);
      }

      const K = ctx.mesh.vertices.length;
      const corpus = analyzeTagCorpus(ctx.normalizedItems);
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

      const itemTagIndexLists = ctx.normalizedItems.map((it) =>
        it.tags.map((t) => tagIndexMap.get(t)!),
      );

      const vertexSharedTags = resolveSharedTags({
        rule: sharedTagRule,
        normalizedItems: ctx.normalizedItems,
        corpus,
        itemTagIndexLists,
        vertexCoreTags,
        mesh: ctx.mesh,
      });

      const rawAssignments = resolveItemAnchors({
        rule: anchorRule,
        normalizedItems: ctx.normalizedItems,
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
        },
      };
    });

  return {
    clusters,
    items,
    uniqueTags: clusteringOutput.uniqueTags,
  };
}

