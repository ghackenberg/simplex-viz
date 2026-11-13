import {
  computeSimplexClustering,
  defaultNormalizeTag,
  extractNormalizedItems,
} from './clustering';
import { solveTwoPhaseLayout } from './layout';
import { buildSimplexMesh } from './mesh';
import { hexToOklab, mixOklabColors } from './oklab';
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterMetaConfig,
  ContentLayoutContext,
  ConvexGeometry,
  DefaultTaggedItem,
  ItemIdentityConfig,
  LayoutMetrics,
  LayoutSolverOptions,
  MeshEdgeRenderState,
  MeshOptions,
  MeshTriangleRenderState,
  SimplexMesh,
} from './types';

function defaultGetId<TItem>(item: TItem): string {
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const raw = (item as { readonly id: string }).id;
    return typeof raw === 'string' ? raw : String(raw);
  }
  return '';
}

function defaultGetTags<TItem>(item: TItem): readonly string[] {
  if (typeof item === 'object' && item !== null && 'tags' in item) {
    const raw = (item as { readonly tags: readonly string[] }).tags;
    return Array.isArray(raw) ? raw : [];
  }
  return [];
}

/**
 * Configuration options for the headless one-shot `solveSimplexSnapshot()` helper.
 */
export type SimplexSnapshotOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = ItemIdentityConfig<TItem> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> & {
    /** Target canvas width in pixels. Default: `960`. */
    readonly width?: number;
    /** Target canvas height in pixels. Default: `600`. */
    readonly height?: number;
    /** Default circular hull radius for content items when `measureContentHull` is omitted. Default: `10`. */
    readonly itemRadius?: number;
    /** Default circular hull radius for topic clusters when `measureClusterHull` is omitted. Default: `24`. */
    readonly clusterRadius?: number;
    /** Optional tag normalizer (defaults to lowercase trim + leading `#` removal). */
    readonly normalizeTag?: (rawTag: string) => string;
    /** Optional domain metadata lookup per normalized tag. */
    readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
    /** Adaptive 60° simplex mesh configuration. */
    readonly meshOptions?: MeshOptions;
    /** Two-phase SAT collision solver options. */
    readonly layoutOptions?: LayoutSolverOptions;
    /** Optional custom convex hull callback for individual content items. */
    readonly measureContentHull?: (
      item: TItem,
      ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
    ) => ConvexGeometry;
    /** Optional custom convex hull callback for topic clusters. */
    readonly measureClusterHull?: (
      cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
    ) => ConvexGeometry;
  };

/**
 * Solved topic cluster node returned by `solveSimplexSnapshot()`.
 */
export interface SnapshotClusterNode<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly hull: ConvexGeometry;
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
}

/**
 * Solved content item node returned by `solveSimplexSnapshot()`.
 */
export interface SnapshotContentNode<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly hull: ConvexGeometry;
  readonly colorHex: string;
  readonly item: TItem;
  readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
}

/**
 * Complete settled layout snapshot emitted by `solveSimplexSnapshot()`.
 */
export interface SimplexLayoutSnapshot<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly width: number;
  readonly height: number;
  readonly mesh: SimplexMesh;
  readonly triangles: readonly MeshTriangleRenderState[];
  readonly edges: readonly MeshEdgeRenderState[];
  readonly clusters: readonly SnapshotClusterNode<TItem, TTagMeta, TClusterMeta>[];
  readonly items: readonly SnapshotContentNode<TItem, TTagMeta, TClusterMeta>[];
  readonly metrics: LayoutMetrics;
}

/**
 * Internal resolved shape for `solveSimplexSnapshot()` avoiding conditional-type intersection narrowing issues.
 */
interface SimplexSnapshotResolvedOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly width?: number;
  readonly height?: number;
  readonly itemRadius?: number;
  readonly clusterRadius?: number;
  readonly normalizeTag?: (rawTag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly measureContentHull?: (
    item: TItem,
    ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
  ) => ConvexGeometry;
  readonly measureClusterHull?: (
    cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  ) => ConvexGeometry;
}

/**
 * Computes a complete, strictly overlap-free 60° simplex layout in a single synchronous call—without
 * needing a `SimplexRendererAdapter` or animation loop. Ideal for quick prototypes, Node.js/SSR,
 * tests, and static Canvas/SVG exports.
 */
export function solveSimplexSnapshot<TItem extends DefaultTaggedItem = DefaultTaggedItem>(
  items: readonly TItem[],
  options?: SimplexSnapshotOptions<TItem, undefined, undefined>,
): SimplexLayoutSnapshot<TItem, undefined, undefined>;
export function solveSimplexSnapshot<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  items: readonly TItem[],
  options: SimplexSnapshotOptions<TItem, TTagMeta, TClusterMeta>,
): SimplexLayoutSnapshot<TItem, TTagMeta, TClusterMeta>;
export function solveSimplexSnapshot<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  items: readonly TItem[],
  options?: Partial<SimplexSnapshotOptions<TItem, TTagMeta, TClusterMeta>>,
): SimplexLayoutSnapshot<TItem, TTagMeta, TClusterMeta> {
  const opts = (options ?? {}) as SimplexSnapshotResolvedOptions<
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  const width = Math.max(160, opts.width ?? 960);
  const height = Math.max(160, opts.height ?? 600);
  const itemRadius = Math.max(2, opts.itemRadius ?? 10);
  const clusterRadius = Math.max(4, opts.clusterRadius ?? 24);
  const getId = opts.getId ?? defaultGetId;
  const getTags = opts.getTags ?? defaultGetTags;
  const normalizeTag = opts.normalizeTag ?? defaultNormalizeTag;

  const normalized = extractNormalizedItems(items, getId, getTags, normalizeTag);
  const uniqueTagCount = new Set(normalized.flatMap((n) => n.tags)).size;
  const mesh = buildSimplexMesh(
    width,
    height,
    Math.max(3, uniqueTagCount),
    opts.meshOptions ?? {},
  );

  const clustering = computeSimplexClustering<TItem, TTagMeta, TClusterMeta>({
    normalizedItems: normalized,
    mesh,
    resolveTagMeta: opts.resolveTagMeta,
    deriveClusterMeta: opts.deriveClusterMeta,
    nextClusterUidSeq: { value: 0 },
    seed: opts.layoutOptions?.seed,
  });

  const clusterHulls = clustering.clusters.map(
    (cluster): ConvexGeometry =>
      opts.measureClusterHull
        ? opts.measureClusterHull(cluster)
        : { kind: 'circle', radius: clusterRadius },
  );

  const itemHulls = clustering.items.map(
    (placement): ConvexGeometry =>
      opts.measureContentHull
        ? opts.measureContentHull(placement.item, placement.layoutContext)
        : { kind: 'circle', radius: itemRadius },
  );

  const solved = solveTwoPhaseLayout({
    clusters: clustering.clusters.map((cluster, idx) => ({
      id: cluster.clusterUid,
      targetX: cluster.gridNode.x,
      targetY: cluster.gridNode.y,
      hull: clusterHulls[idx]!,
    })),
    items: clustering.items.map((placement, idx) => ({
      id: placement.id,
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
      hull: itemHulls[idx]!,
    })),
    viewportWidth: width,
    viewportHeight: height,
    viewportMargin: 8,
    options: opts.layoutOptions ?? {},
  });

  const clusters: SnapshotClusterNode<TItem, TTagMeta, TClusterMeta>[] =
    clustering.clusters.map((cluster, idx) => {
      const placed = solved.clusters[idx]!;
      return {
        id: cluster.clusterUid,
        x: placed.x,
        y: placed.y,
        scale: placed.scale,
        hull: clusterHulls[idx]!,
        cluster,
      };
    });

  const resolvedItems: SnapshotContentNode<TItem, TTagMeta, TClusterMeta>[] =
    clustering.items.map((placement, idx) => {
      const placed = solved.items[idx]!;
      return {
        id: placement.id,
        x: placed.x,
        y: placed.y,
        scale: placed.scale,
        hull: itemHulls[idx]!,
        colorHex: placement.layoutContext.mixedColorHex,
        item: placement.item,
        layoutContext: placement.layoutContext,
      };
    });

  const fallbackOklab = hexToOklab('#1e293b');
  const triangles: MeshTriangleRenderState[] = mesh.triangles.map((tri) => {
    const [va, vb, vc] = tri.vertices;
    const pA = mesh.vertices[va]!;
    const pB = mesh.vertices[vb]!;
    const pC = mesh.vertices[vc]!;
    const cA = clustering.clusters[va];
    const cB = clustering.clusters[vb];
    const cC = clustering.clusters[vc];
    const mixed = mixOklabColors([
      { oklab: cA?.oklab ?? fallbackOklab, weight: 1 },
      { oklab: cB?.oklab ?? fallbackOklab, weight: 1 },
      { oklab: cC?.oklab ?? fallbackOklab, weight: 1 },
    ]);
    return {
      index: tri.index,
      points: [
        { x: pA.x, y: pA.y },
        { x: pB.x, y: pB.y },
        { x: pC.x, y: pC.y },
      ],
      fillHex: mixed.hex,
      fillOpacity: 0.085,
    };
  });

  const edges: MeshEdgeRenderState[] = mesh.edges.map((e) => {
    const a = mesh.vertices[e.a]!;
    const b = mesh.vertices[e.b]!;
    return {
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      isHighlighted: false,
    };
  });

  const metrics: LayoutMetrics = {
    clusterCount: clusters.length,
    itemCount: resolvedItems.length,
    tagCount: clustering.uniqueTags.length,
    clusterScale: solved.clusterScale,
    contentScale: solved.contentScale,
    overlapCount: solved.overlapCount,
    maxPenetrationPx: solved.maxPenetrationPx,
    isSettled: true,
    meshSideLength: mesh.sideLength,
    areaEfficiency: mesh.areaEfficiency,
  };

  return {
    width,
    height,
    mesh,
    triangles,
    edges,
    clusters,
    items: resolvedItems,
    metrics,
  };
}
