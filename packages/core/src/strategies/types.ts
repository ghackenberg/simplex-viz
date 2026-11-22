import type {
  AnalyzedTagCorpus,
  NormalizedContentItem,
  PreviousClusterSnapshot,
  RawItemUnitAssignment,
  SharedTagRuleKind,
  SimplexAnchorRuleKind,
} from '../clustering.js';
import type {
  LayoutClusterInput,
  LayoutItemInput,
  TwoPhaseLayoutResult,
} from '../layout.js';
import type { OklabTuple } from '../oklab.js';
import type {
  ClusterMemberRef,
  DefaultTaggedItem,
  IdentifiedItem,
  LayoutSolverOptions,
  MeshOptions,
  SimplexMesh,
  TagDescriptor,
} from '../types.js';

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
