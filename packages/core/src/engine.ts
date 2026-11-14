import {
  retargetVisualTransition,
  stepCriticallyDampedSpring,
  stepVisualTransition,
  type SpringScalar,
  type VisualTransitionState,
} from './animation';
import { SimplexCamera } from './camera';
import {
  defaultNormalizeTag,
  extractNormalizedItems,
  type ComputedItemPlacement,
  type NormalizedContentItem,
  type PreviousClusterSnapshot,
} from './clustering';
import { hitTestConvexGeometry, isPointInTriangle } from './geometry';
import { hexToOklab, lerpOklabHex, mixOklabColors, type OklabTuple } from './oklab';
import {
  createAdaptiveHexMeshStrategy,
  createJaccardAnnealingClusteringStrategy,
  createOklabContrastColorStrategy,
  createPbdUniformLayoutStrategy,
  finalizeClusteringWithColors,
  type ClusteringStrategyContext,
  type ClusteringStrategyOutput,
  type PipelineUpdateReason,
  type PreviousNodeLayout,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexColorTheme,
  type SimplexLayoutStrategy,
  type SimplexMeshStrategy,
} from './strategies';
import type {
  CameraController,
  ClusterDerivationContext,
  ClusterDescriptor,
  ConvexGeometry,
  DefaultTaggedItem,
  HitTarget,
  InteractionHandlers,
  LayoutMetrics,
  LayoutSolverOptions,
  MeshEdgeRenderState,
  MeshOptions,
  MeshTriangleRenderState,
  NodeRenderState,
  NormalizedPointerEvent,
  NormalizedWheelEvent,
  Point2D,
  SceneFrameSnapshot,
  SimplexEngineConfig,
  SimplexEngineResolvedConfig,
  SimplexMesh,
  SimplexRendererAdapter,
  VisualResolver,
} from './types';

interface AnimatedNodeRecord<TVisual, TDomainMeta> {
  readonly id: string;
  status: 'active' | 'exiting';
  x: SpringScalar;
  y: SpringScalar;
  scale: SpringScalar;
  opacity: SpringScalar;
  visual: TVisual;
  hull: ConvexGeometry;
  cacheKey: string;
  transition: VisualTransitionState<TVisual> | null;
  domain: TDomainMeta;
}

interface AnimatedTriangleRecord {
  readonly index: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly points: readonly [Point2D, Point2D, Point2D];
  readonly centroid: Point2D;
  readonly coveredItemCount: number;
  readonly interiorItemCount: number;
  currentOklab: [number, number, number];
  targetOklab: OklabTuple;
  fillHex: string;
}

interface AnimatedEdgeRecord {
  readonly index: number;
  readonly vertexIndices: readonly [number, number];
  readonly a: Point2D;
  readonly b: Point2D;
  readonly mixedColorHex: string;
}

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
 * Headless triangulation, clustering, convex-layout, animation, and hit-testing engine.
 *
 * Completely independent of DOM, React, or SVG; communicates with rendering backends solely
 * through `SimplexRendererAdapter` and `HullMeasurer`.
 */
export class SimplexGraphEngine<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  private rawItems: TItem[];
  private readonly getIdFn: (item: TItem) => string;
  private readonly getTagsFn: (item: TItem) => readonly string[];
  private readonly normalizeTagFn: (raw: string) => string;
  private readonly resolveTagMetaFn?: (tag: string) => TTagMeta | undefined;
  private readonly deriveClusterMetaFn?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;

  private visualResolver: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private readonly renderer: SimplexRendererAdapter<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  private viewportWidth: number;
  private viewportHeight: number;
  private meshOptions: MeshOptions;
  private layoutOptions: LayoutSolverOptions;
  private meshStrategy: SimplexMeshStrategy<TItem>;
  private clusteringStrategy: SimplexClusteringStrategy<TItem, TTagMeta>;
  private colorStrategy: SimplexColorStrategy<TItem, TTagMeta>;
  private layoutStrategy: SimplexLayoutStrategy;
  private theme: SimplexColorTheme;
  private previousTheme: SimplexColorTheme | undefined;
  private showHulls: boolean;
  private interactions: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private onMetricsChange?: (metrics: LayoutMetrics) => void;
  private onClustersChange?: (
    clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
  ) => void;

  public readonly camera: CameraController;

  private currentMesh: SimplexMesh | null = null;
  private previousMesh: SimplexMesh | null = null;
  private previousNormalizedItems: readonly NormalizedContentItem<TItem>[] = [];
  private lastClusteringOutput: ClusteringStrategyOutput<TItem, TTagMeta> | null = null;
  private lastPrevClusterSnapshots: readonly PreviousClusterSnapshot[] = [];
  private currentClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = [];
  private currentPlacements: readonly ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>[] =
    [];

  private readonly clusterNodes = new Map<
    string,
    AnimatedNodeRecord<TClusterVisual, ClusterDescriptor<TItem, TTagMeta, TClusterMeta>>
  >();
  private readonly itemNodes = new Map<
    string,
    AnimatedNodeRecord<TContentVisual, ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>>
  >();
  private triangleStates: AnimatedTriangleRecord[] = [];
  private edgeRecords: AnimatedEdgeRecord[] = [];

  private readonly nextClusterUidSeq = { value: 0 };
  private hoveredContentId: string | null = null;
  private hoveredClusterUid: string | null = null;
  private hoveredTriangleIndex: number | null = null;
  private pinnedIds = new Set<string>();
  private highlightedIds = new Set<string>();
  private focusedClusterUid: string | null = null;
  private focusedTriangleIndex: number | null = null;

  private currentMetrics: LayoutMetrics = {
    clusterCount: 0,
    itemCount: 0,
    tagCount: 0,
    clusterScale: 1,
    contentScale: 1,
    overlapCount: 0,
    maxPenetrationPx: 0,
    isSettled: true,
    meshSideLength: 0,
    areaEfficiency: 0,
  };

  private dirtyRender = true;
  private destroyed = false;

  constructor(
    config: SimplexEngineConfig<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
  constructor(
    config: SimplexEngineResolvedConfig<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.rawItems = [...config.items];
    this.getIdFn = config.getId ?? defaultGetId;
    this.getTagsFn = config.getTags ?? defaultGetTags;
    this.normalizeTagFn = config.normalizeTag ?? defaultNormalizeTag;
    this.resolveTagMetaFn = config.resolveTagMeta;
    this.deriveClusterMetaFn = config.deriveClusterMeta;

    this.visualResolver = config.visualResolver;
    this.renderer = config.renderer;
    this.viewportWidth = Math.max(160, config.viewportWidth);
    this.viewportHeight = Math.max(160, config.viewportHeight);
    this.meshOptions = config.meshOptions ?? {};
    this.layoutOptions = config.layoutOptions ?? {};
    this.meshStrategy = config.meshStrategy ?? createAdaptiveHexMeshStrategy<TItem>();
    this.clusteringStrategy =
      config.clusteringStrategy ?? createJaccardAnnealingClusteringStrategy<TItem, TTagMeta>();
    this.colorStrategy =
      config.colorStrategy ?? createOklabContrastColorStrategy<TItem, TTagMeta>();
    this.layoutStrategy = config.layoutStrategy ?? createPbdUniformLayoutStrategy();
    this.theme = config.theme ?? 'dark';
    this.showHulls = config.showHulls ?? false;
    this.interactions = config.interactions ?? {};
    this.onMetricsChange = config.onMetricsChange;
    this.onClustersChange = config.onClustersChange;

    this.camera = new SimplexCamera(() => {
      this.dirtyRender = true;
    });

    this.recomputePipeline('initial');
  }

  /**
   * Internal factory for strongly typed wrapper packages (`@simplex-viz/svg`, `@simplex-viz/react`)
   * that already enforce `ItemIdentityConfig` and `ClusterMetaConfig` on their own public APIs.
   */
  static createFromResolved<
    TItem = DefaultTaggedItem,
    TContentVisual = unknown,
    TClusterVisual = unknown,
    TTagMeta = undefined,
    TClusterMeta = undefined,
  >(
    config: SimplexEngineResolvedConfig<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): SimplexGraphEngine<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return new (SimplexGraphEngine as unknown as new (
      c: SimplexEngineResolvedConfig<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ) => SimplexGraphEngine<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >)(config);
  }

  /** Returns the current computed topic clusters with typed metadata and member references. */
  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] {
    return this.currentClusters;
  }

  /** Returns the current simplex mesh geometry. */
  getMesh(): SimplexMesh | null {
    return this.currentMesh;
  }

  /** Returns the latest geometric & overlap telemetry metrics. */
  getMetrics(): LayoutMetrics {
    return this.currentMetrics;
  }

  /** Returns current active domain items. */
  getItems(): readonly TItem[] {
    return this.rawItems;
  }

  /** Appends one or more items and triggers an interruptible transition. */
  addItems(items: TItem | readonly TItem[]): void {
    const incoming = Array.isArray(items) ? items : [items];
    if (incoming.length === 0) return;

    const existingMap = new Map<string, number>();
    this.rawItems.forEach((it, idx) => {
      existingMap.set(this.getIdFn(it).trim(), idx);
    });

    const next = [...this.rawItems];
    for (const item of incoming) {
      const id = this.getIdFn(item).trim();
      if (!id) continue;
      const existingIdx = existingMap.get(id);
      if (existingIdx !== undefined) {
        next[existingIdx] = item;
      } else {
        existingMap.set(id, next.length);
        next.push(item);
      }
    }

    this.rawItems = next;
    this.recomputePipeline('items');
  }

  /** Removes one or more items by ID and smoothly fades out exiting nodes. */
  removeItems(ids: string | readonly string[]): void {
    const list = typeof ids === 'string' ? [ids] : ids;
    if (list.length === 0) return;
    const removeSet = new Set(list.map((id) => id.trim()));
    const filtered = this.rawItems.filter((it) => !removeSet.has(this.getIdFn(it).trim()));
    if (filtered.length === this.rawItems.length) return;
    this.rawItems = filtered;
    this.recomputePipeline('items');
  }

  /** Replaces the entire item collection while smoothly morphing matching clusters & items. */
  setItems(items: readonly TItem[]): void {
    this.rawItems = [...items];
    this.recomputePipeline('items');
  }

  /** Swaps the mesh/triangulation strategy at runtime and recomputes the graph. */
  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.meshStrategy = strategy;
    this.recomputePipeline('strategy');
  }

  /** Swaps the topic clustering & vertex assignment strategy at runtime and recomputes. */
  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    this.clusteringStrategy = strategy;
    this.recomputePipeline('strategy');
  }

  /** Swaps the cluster coloring & item mixing strategy at runtime with smooth transition. */
  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.colorStrategy = strategy;
    if (this.lastClusteringOutput && this.currentMesh) {
      this.applyColorsAndDeriveDescriptors('strategy');
      this.recomputeLayoutAndReconcile(false, this.currentMetrics.tagCount, 'strategy');
    }
  }

  /** Swaps the node positioning & scaling layout strategy at runtime and re-solves cleanly. */
  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    this.layoutStrategy = strategy;
    this.recomputeLayoutOnly('strategy');
  }

  /** Returns active mesh strategy. */
  getMeshStrategy(): SimplexMeshStrategy<TItem> {
    return this.meshStrategy;
  }

  /** Returns active clustering strategy. */
  getClusteringStrategy(): SimplexClusteringStrategy<TItem, TTagMeta> {
    return this.clusteringStrategy;
  }

  /** Returns active color strategy. */
  getColorStrategy(): SimplexColorStrategy<TItem, TTagMeta> {
    return this.colorStrategy;
  }

  /** Returns active layout strategy. */
  getLayoutStrategy(): SimplexLayoutStrategy {
    return this.layoutStrategy;
  }

  /** Updates mesh generation options and recomputes triangulation + clustering. */
  setMeshOptions(options: MeshOptions): void {
    this.meshOptions = options;
    this.recomputePipeline('mesh');
  }

  /** Updates layout solver options and re-solves overlap-free layout. */
  setLayoutOptions(options: LayoutSolverOptions): void {
    this.layoutOptions = options;
    this.recomputeLayoutOnly('strategy');
  }

  /** Updates canvas theme hint for color strategies. */
  setTheme(theme: SimplexColorTheme): void {
    if (this.theme === theme) return;
    this.previousTheme = this.theme;
    this.theme = theme;
    if (this.lastClusteringOutput && this.currentMesh) {
      this.applyColorsAndDeriveDescriptors('strategy');
      this.recomputeLayoutAndReconcile(false, this.currentMetrics.tagCount, 'strategy');
    }
  }

  /** Swaps the `VisualResolver` at runtime (e.g. changing node visual presets) with smooth crossfade. */
  setVisualResolver(
    resolver: VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.visualResolver = resolver;
    this.recomputeLayoutOnly('strategy');
  }

  /** Updates the uniform size multiplier and re-solves overlap-free layout. */
  setSizeMultiplier(multiplier: number): void {
    const clamped = Math.max(0.35, Math.min(3.0, multiplier));
    if (Math.abs((this.layoutOptions.sizeMultiplier ?? 1) - clamped) < 1e-4) return;
    this.layoutOptions = { ...this.layoutOptions, sizeMultiplier: clamped };
    this.recomputeLayoutOnly('strategy');
  }

  /** Updates viewport dimensions and recomputes mesh + layout cleanly. */
  setViewport(width: number, height: number): void {
    const w = Math.max(160, Math.round(width));
    const h = Math.max(160, Math.round(height));
    if (w === this.viewportWidth && h === this.viewportHeight) return;
    this.viewportWidth = w;
    this.viewportHeight = h;
    this.recomputePipeline('viewport');
  }

  /** Toggles convex hull debug wireframe rendering. */
  setShowHulls(show: boolean): void {
    if (this.showHulls === show) return;
    this.showHulls = show;
    this.dirtyRender = true;
  }

  /** Updates interaction callbacks cleanly without recreating the engine. */
  setInteractions(
    interactions: InteractionHandlers<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.interactions = interactions;
  }

  /** Sets pinned item IDs for visual emphasis. */
  setPinnedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this.pinnedIds = new Set(ids);
    this.dirtyRender = true;
  }

  /** Sets highlighted item IDs for visual emphasis / dimming others. */
  setHighlightedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this.highlightedIds = new Set(ids);
    this.dirtyRender = true;
  }

  /** Focuses a specific cluster UID (dimming unrelated nodes) or clears focus with `null`. */
  setFocusedClusterUid(clusterUid: string | null): void {
    this.focusedClusterUid = clusterUid;
    this.dirtyRender = true;
  }

  /** Focuses a specific mesh triangle face by index (dimming unrelated faces, clusters, and items) or clears with `null`. */
  setFocusedTriangleIndex(triangleIndex: number | null): void {
    const valid =
      triangleIndex !== null &&
      triangleIndex >= 0 &&
      triangleIndex < this.triangleStates.length
        ? triangleIndex
        : null;
    if (this.focusedTriangleIndex === valid) return;
    this.focusedTriangleIndex = valid;
    this.dirtyRender = true;
  }

  /** Forces an immediate frame render using the current snapshot. */
  renderNow(): void {
    if (this.destroyed) return;
    this.renderer.renderFrame(this.buildFrameSnapshot());
    this.dirtyRender = false;
  }

  private recomputePipeline(reason: PipelineUpdateReason): void {
    const normalized = extractNormalizedItems(
      this.rawItems,
      this.getIdFn,
      this.getTagsFn,
      this.normalizeTagFn,
    );

    const prevIdSet = new Set(this.previousNormalizedItems.map((it) => it.id));
    const nextIdSet = new Set(normalized.map((it) => it.id));
    const addedItemIds = new Set<string>();
    for (const id of nextIdSet) {
      if (!prevIdSet.has(id)) addedItemIds.add(id);
    }
    const removedItemIds = new Set<string>();
    for (const id of prevIdSet) {
      if (!nextIdSet.has(id)) removedItemIds.add(id);
    }

    const uniqueTagCount = new Set(normalized.flatMap((n) => n.tags)).size;
    const mesh = this.meshStrategy.buildMesh({
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      uniqueTagCount,
      itemCount: normalized.length,
      normalizedItems: normalized,
      meshOptions: this.meshOptions,
      previousMesh: this.previousMesh,
      reason,
    });
    this.currentMesh = mesh;

    const prevClusterSnapshots: PreviousClusterSnapshot[] = [];
    for (const cNode of this.clusterNodes.values()) {
      if (cNode.status !== 'active') continue;
      const tags = new Set<string>();
      const coreTags = new Set<string>();
      for (const t of cNode.domain.coreTags) {
        tags.add(t.tag);
        coreTags.add(t.tag);
      }
      for (const t of cNode.domain.sharedTags) tags.add(t.tag);
      prevClusterSnapshots.push({
        clusterUid: cNode.domain.clusterUid,
        tags,
        coreTags,
        x: cNode.x.value,
        y: cNode.y.value,
        colorHex: cNode.domain.colorHex,
        oklab: cNode.domain.oklab,
      });
    }

    const clusteringCtx: ClusteringStrategyContext<TItem, TTagMeta> = {
      normalizedItems: normalized,
      previousNormalizedItems: this.previousNormalizedItems,
      addedItemIds,
      removedItemIds,
      mesh,
      previousMesh: this.previousMesh,
      previousClusters: prevClusterSnapshots,
      resolveTagMeta: this.resolveTagMetaFn,
      allocateClusterUid: () => {
        this.nextClusterUidSeq.value += 1;
        return `cluster-${this.nextClusterUidSeq.value}`;
      },
      seed: this.layoutOptions.seed ?? 0x51a7c0de,
      reason,
    };

    const clusteringOutput =
      reason === 'initial' || prevClusterSnapshots.length === 0 || !this.clusteringStrategy.update
        ? this.clusteringStrategy.initialize(clusteringCtx)
        : this.clusteringStrategy.update(clusteringCtx);

    this.lastClusteringOutput = clusteringOutput;
    this.lastPrevClusterSnapshots = prevClusterSnapshots;
    this.previousNormalizedItems = normalized;
    this.previousMesh = mesh;

    this.applyColorsAndDeriveDescriptors(reason);

    this.recomputeLayoutAndReconcile(
      reason === 'initial',
      clusteringOutput.uniqueTags.length,
      reason,
    );
  }

  private applyColorsAndDeriveDescriptors(reason: PipelineUpdateReason): void {
    const clusteringOutput = this.lastClusteringOutput;
    const mesh = this.currentMesh;
    if (!clusteringOutput || !mesh) return;

    const finalized = finalizeClusteringWithColors<TItem, TTagMeta, TClusterMeta>({
      clusteringOutput,
      mesh,
      colorStrategy: this.colorStrategy,
      theme: this.theme,
      previousTheme: this.previousTheme,
      previousClusters: this.lastPrevClusterSnapshots,
      reason,
      seed: this.layoutOptions.seed ?? 0x51a7c0de,
      deriveClusterMeta: this.deriveClusterMetaFn,
    });

    this.previousTheme = this.theme;
    this.currentClusters = finalized.clusters as readonly ClusterDescriptor<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];
    this.currentPlacements = finalized.items as readonly ComputedItemPlacement<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];
    this.onClustersChange?.(this.currentClusters);
  }

  private recomputeLayoutOnly(reason: PipelineUpdateReason = 'strategy'): void {
    this.recomputeLayoutAndReconcile(false, this.currentMetrics.tagCount, reason);
  }

  private recomputeLayoutAndReconcile(
    isInitial: boolean,
    tagCount: number,
    reason: PipelineUpdateReason,
  ): void {
    const mesh = this.currentMesh;
    if (!mesh) return;

    // 1. Resolve visual descriptors and measure unscaled convex hulls via HullMeasurer
    const resolvedClusters = this.currentClusters.map((cluster) => {
      const visual = this.visualResolver.resolveClusterVisual(cluster);
      const cacheKey = this.visualResolver.getVisualCacheKey(visual);
      const hull = this.renderer.measureClusterHull(visual, cacheKey);
      return { cluster, visual, cacheKey, hull };
    });

    const resolvedItems = this.currentPlacements.map((placement) => {
      const visual = this.visualResolver.resolveContentVisual(
        placement.item,
        placement.layoutContext,
      );
      const cacheKey = this.visualResolver.getVisualCacheKey(visual);
      const hull = this.renderer.measureContentHull(visual, cacheKey);
      return { placement, visual, cacheKey, hull };
    });

    const previousClusterPositions = new Map<string, PreviousNodeLayout>();
    for (const [uid, cNode] of this.clusterNodes) {
      if (cNode.status === 'active') {
        previousClusterPositions.set(uid, {
          x: cNode.x.target,
          y: cNode.y.target,
          scale: cNode.scale.target,
        });
      }
    }
    const previousItemPositions = new Map<string, PreviousNodeLayout>();
    for (const [id, iNode] of this.itemNodes) {
      if (iNode.status === 'active') {
        previousItemPositions.set(id, {
          x: iNode.x.target,
          y: iNode.y.target,
          scale: iNode.scale.target,
        });
      }
    }

    // 2. Solve strictly overlap-free layout via active SimplexLayoutStrategy
    const solved = this.layoutStrategy.solve({
      clusters: resolvedClusters.map((rc) => ({
        id: rc.cluster.clusterUid,
        targetX: rc.cluster.gridNode.x,
        targetY: rc.cluster.gridNode.y,
        hull: rc.hull,
      })),
      items: resolvedItems.map((ri) => ({
        id: ri.placement.id,
        anchorX: ri.placement.anchorX,
        anchorY: ri.placement.anchorY,
        hull: ri.hull,
      })),
      mesh,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      viewportMargin: 8,
      layoutOptions: this.layoutOptions,
      previousClusterPositions,
      previousItemPositions,
      reason,
    });

    // 3. Reconcile cluster nodes (interruptible spring + dual-layer transition)
    const activeClusterIds = new Set<string>();
    resolvedClusters.forEach((rc, idx) => {
      const placed = solved.clusters[idx]!;
      const uid = rc.cluster.clusterUid;
      activeClusterIds.add(uid);

      const existing = this.clusterNodes.get(uid);
      if (!existing) {
        this.clusterNodes.set(uid, {
          id: uid,
          status: 'active',
          x: { value: placed.x, velocity: 0, target: placed.x },
          y: { value: placed.y, velocity: 0, target: placed.y },
          scale: {
            value: isInitial ? placed.scale : placed.scale * 0.72,
            velocity: 0,
            target: placed.scale,
          },
          opacity: { value: isInitial ? 1 : 0, velocity: 0, target: 1 },
          visual: rc.visual,
          hull: rc.hull,
          cacheKey: rc.cacheKey,
          transition: null,
          domain: rc.cluster,
        });
      } else {
        const nextTransition = retargetVisualTransition(
          existing.transition,
          existing.visual,
          existing.hull,
          existing.cacheKey,
          rc.visual,
          rc.hull,
          rc.cacheKey,
        );
        existing.status = 'active';
        existing.x.target = placed.x;
        existing.y.target = placed.y;
        existing.scale.target = placed.scale;
        existing.opacity.target = 1;
        existing.visual = rc.visual;
        existing.hull = rc.hull;
        existing.cacheKey = rc.cacheKey;
        existing.transition = nextTransition;
        existing.domain = rc.cluster;
      }
    });

    for (const [uid, node] of this.clusterNodes) {
      if (!activeClusterIds.has(uid)) {
        if (isInitial) {
          this.clusterNodes.delete(uid);
        } else {
          node.status = 'exiting';
          node.opacity.target = 0;
          node.scale.target = node.scale.value * 0.7;
        }
      }
    }

    // 4. Reconcile content item nodes (interruptible spring + re-entering reversal)
    const activeItemIds = new Set<string>();
    resolvedItems.forEach((ri, idx) => {
      const placed = solved.items[idx]!;
      const id = ri.placement.id;
      activeItemIds.add(id);

      const existing = this.itemNodes.get(id);
      if (!existing) {
        this.itemNodes.set(id, {
          id,
          status: 'active',
          x: {
            value: isInitial ? placed.x : ri.placement.anchorX,
            velocity: 0,
            target: placed.x,
          },
          y: {
            value: isInitial ? placed.y : ri.placement.anchorY,
            velocity: 0,
            target: placed.y,
          },
          scale: {
            value: isInitial ? placed.scale : placed.scale * 0.5,
            velocity: 0,
            target: placed.scale,
          },
          opacity: { value: isInitial ? 1 : 0, velocity: 0, target: 1 },
          visual: ri.visual,
          hull: ri.hull,
          cacheKey: ri.cacheKey,
          transition: null,
          domain: ri.placement,
        });
      } else {
        const nextTransition = retargetVisualTransition(
          existing.transition,
          existing.visual,
          existing.hull,
          existing.cacheKey,
          ri.visual,
          ri.hull,
          ri.cacheKey,
        );
        existing.status = 'active';
        existing.x.target = placed.x;
        existing.y.target = placed.y;
        existing.scale.target = placed.scale;
        existing.opacity.target = 1;
        existing.visual = ri.visual;
        existing.hull = ri.hull;
        existing.cacheKey = ri.cacheKey;
        existing.transition = nextTransition;
        existing.domain = ri.placement;
      }
    });

    for (const [id, node] of this.itemNodes) {
      if (!activeItemIds.has(id)) {
        if (isInitial) {
          this.itemNodes.delete(id);
        } else {
          node.status = 'exiting';
          node.opacity.target = 0;
          node.scale.target = Math.max(0.05, node.scale.value * 0.6);
        }
      }
    }

    // 5. Reconcile triangle background OKLab tints, centroids, and density counts
    const prevTriMap = new Map<number, AnimatedTriangleRecord>();
    for (const tr of this.triangleStates) {
      prevTriMap.set(tr.index, tr);
    }

    const fallbackOklab = hexToOklab('#1e293b');
    this.triangleStates = mesh.triangles.map((tri) => {
      const [va, vb, vc] = tri.vertices;
      const pA = mesh.vertices[va]!;
      const pB = mesh.vertices[vb]!;
      const pC = mesh.vertices[vc]!;
      const cA = this.currentClusters[va];
      const cB = this.currentClusters[vb];
      const cC = this.currentClusters[vc];
      const mixed = mixOklabColors([
        { oklab: cA?.oklab ?? fallbackOklab, weight: 1 },
        { oklab: cB?.oklab ?? fallbackOklab, weight: 1 },
        { oklab: cC?.oklab ?? fallbackOklab, weight: 1 },
      ]);
      const prev = prevTriMap.get(tri.index);
      const startOklab: [number, number, number] =
        prev && !isInitial
          ? [...prev.currentOklab]
          : [mixed.oklab[0], mixed.oklab[1], mixed.oklab[2]];

      let coveredItemCount = 0;
      let interiorItemCount = 0;
      for (const placement of this.currentPlacements) {
        const ucs = placement.layoutContext.unitClusters;
        if (ucs.length === 0) continue;
        let allInside = true;
        for (let k = 0; k < ucs.length; k++) {
          const cIdx = ucs[k]!.cluster.clusterIndex;
          if (cIdx !== va && cIdx !== vb && cIdx !== vc) {
            allInside = false;
            break;
          }
        }
        if (allInside) {
          coveredItemCount++;
          if (ucs.length === 3) {
            interiorItemCount++;
          }
        }
      }

      return {
        index: tri.index,
        vertexIndices: [va, vb, vc],
        points: [
          { x: pA.x, y: pA.y },
          { x: pB.x, y: pB.y },
          { x: pC.x, y: pC.y },
        ],
        centroid: {
          x: (pA.x + pB.x + pC.x) / 3,
          y: (pA.y + pB.y + pC.y) / 3,
        },
        coveredItemCount,
        interiorItemCount,
        currentOklab: startOklab,
        targetOklab: mixed.oklab,
        fillHex: lerpOklabHex(startOklab, mixed.oklab, isInitial ? 1 : 0),
      };
    });

    this.edgeRecords = mesh.edges.map((e, idx) => {
      const a = mesh.vertices[e.a]!;
      const b = mesh.vertices[e.b]!;
      const cA = this.currentClusters[e.a];
      const cB = this.currentClusters[e.b];
      const mixed = mixOklabColors([
        { oklab: cA?.oklab ?? fallbackOklab, weight: 1 },
        { oklab: cB?.oklab ?? fallbackOklab, weight: 1 },
      ]);
      return {
        index: idx,
        vertexIndices: [e.a, e.b],
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        mixedColorHex: mixed.hex,
      };
    });

    if (
      this.hoveredTriangleIndex !== null &&
      this.hoveredTriangleIndex >= this.triangleStates.length
    ) {
      this.hoveredTriangleIndex = null;
      this.interactions.onTriangleHover?.(null);
    }
    if (
      this.focusedTriangleIndex !== null &&
      this.focusedTriangleIndex >= this.triangleStates.length
    ) {
      this.focusedTriangleIndex = null;
    }

    this.currentMetrics = {
      clusterCount: this.currentClusters.length,
      itemCount: this.currentPlacements.length,
      tagCount,
      clusterScale: solved.clusterScale,
      contentScale: solved.contentScale,
      overlapCount: solved.overlapCount,
      maxPenetrationPx: solved.maxPenetrationPx,
      isSettled: isInitial,
      meshSideLength: mesh.sideLength,
      areaEfficiency: mesh.areaEfficiency,
    };
    this.onMetricsChange?.(this.currentMetrics);
    this.dirtyRender = true;

    if (isInitial) {
      this.renderNow();
    }
  }

  /**
   * Advances spring animations and dual-layer transitions by `dtMs` milliseconds,
   * rendering a frame if anything moved or changed. Returns `true` when fully settled.
   */
  step(dtMs: number): boolean {
    if (this.destroyed) return true;
    const dtSec = Math.min(0.05, Math.max(0.001, dtMs / 1000));
    let allSettled = true;

    const advanceMap = <TVisual, TDomain>(
      map: Map<string, AnimatedNodeRecord<TVisual, TDomain>>,
    ) => {
      const toDelete: string[] = [];
      for (const [key, node] of map) {
        const sX = stepCriticallyDampedSpring(node.x, dtSec, 13.5);
        const sY = stepCriticallyDampedSpring(node.y, dtSec, 13.5);
        const sS = stepCriticallyDampedSpring(node.scale, dtSec, 14.5);
        const sO = stepCriticallyDampedSpring(node.opacity, dtSec, 12.0);
        if (!sX || !sY || !sS || !sO) {
          allSettled = false;
        }

        if (node.transition) {
          const nextT = stepVisualTransition(node.transition, dtSec);
          node.transition = nextT.transition;
          if (nextT.transition !== null) {
            allSettled = false;
          }
        }

        if (node.status === 'exiting' && node.opacity.value <= 0.01) {
          toDelete.push(key);
        }
      }
      for (const key of toDelete) {
        map.delete(key);
      }
    };

    advanceMap(this.clusterNodes);
    advanceMap(this.itemNodes);

    // Smoothly blend background triangle OKLab colors
    const blendAlpha = 1 - Math.exp(-9 * dtSec);
    for (const tr of this.triangleStates) {
      const dL = tr.targetOklab[0] - tr.currentOklab[0];
      const da = tr.targetOklab[1] - tr.currentOklab[1];
      const db = tr.targetOklab[2] - tr.currentOklab[2];
      if (Math.abs(dL) + Math.abs(da) + Math.abs(db) > 0.002) {
        tr.currentOklab[0] += dL * blendAlpha;
        tr.currentOklab[1] += da * blendAlpha;
        tr.currentOklab[2] += db * blendAlpha;
        tr.fillHex = lerpOklabHex(tr.currentOklab, tr.targetOklab, 0);
        allSettled = false;
      } else {
        tr.currentOklab[0] = tr.targetOklab[0];
        tr.currentOklab[1] = tr.targetOklab[1];
        tr.currentOklab[2] = tr.targetOklab[2];
        tr.fillHex = lerpOklabHex(tr.targetOklab, tr.targetOklab, 1);
      }
    }

    if (!allSettled || this.dirtyRender) {
      this.renderer.renderFrame(this.buildFrameSnapshot());
      this.dirtyRender = false;
    }

    if (this.currentMetrics.isSettled !== allSettled) {
      this.currentMetrics = { ...this.currentMetrics, isSettled: allSettled };
      this.onMetricsChange?.(this.currentMetrics);
    }

    return allSettled;
  }

  private buildTriangleRenderState(
    tr: AnimatedTriangleRecord,
    hasTriangleFocus = false,
  ): MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta> {
    const [va, vb, vc] = tr.vertexIndices;
    const isHovered = this.hoveredTriangleIndex === tr.index;
    const isFocused = this.focusedTriangleIndex === tr.index;
    const isDimmed = hasTriangleFocus && !isFocused && !isHovered;
    return {
      index: tr.index,
      vertexIndices: tr.vertexIndices,
      points: tr.points,
      centroid: tr.centroid,
      fillHex: tr.fillHex,
      fillOpacity: 0.085,
      clusters: [
        this.currentClusters[va],
        this.currentClusters[vb],
        this.currentClusters[vc],
      ],
      coveredItemCount: tr.coveredItemCount,
      interiorItemCount: tr.interiorItemCount,
      interaction: {
        isHovered,
        isFocused,
        isDimmed,
      },
    };
  }

  private buildFrameSnapshot(): SceneFrameSnapshot<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  > {
    const hasTriangleOnlyFocus =
      this.focusedTriangleIndex !== null &&
      this.focusedClusterUid === null &&
      this.highlightedIds.size === 0;
    const focusedTriangle =
      this.focusedTriangleIndex !== null
        ? this.triangleStates[this.focusedTriangleIndex]
        : undefined;
    const hoveredTriangle =
      this.hoveredTriangleIndex !== null
        ? this.triangleStates[this.hoveredTriangleIndex]
        : undefined;
    const focusedTriVertSet = focusedTriangle
      ? new Set(focusedTriangle.vertexIndices)
      : null;
    const hoveredTriVertSet = hoveredTriangle
      ? new Set(hoveredTriangle.vertexIndices)
      : null;

    const hasHighlightFocus =
      this.highlightedIds.size > 0 ||
      this.focusedClusterUid !== null ||
      hasTriangleOnlyFocus;

    const clusters: NodeRenderState<TClusterVisual>[] = [];
    for (const cNode of this.clusterNodes.values()) {
      const isHovered = this.hoveredClusterUid === cNode.id;
      const isFocusedCluster = this.focusedClusterUid === cNode.id;
      const inFocusedTriangle = Boolean(
        hasTriangleOnlyFocus && focusedTriVertSet?.has(cNode.domain.clusterIndex),
      );
      const isPinned = this.pinnedIds.has(cNode.id);
      const isDimmed =
        (this.focusedClusterUid !== null && !isFocusedCluster && !isHovered) ||
        (hasTriangleOnlyFocus && !inFocusedTriangle && !isHovered);

      clusters.push({
        id: cNode.id,
        x: cNode.x.value,
        y: cNode.y.value,
        scale: cNode.scale.value,
        opacity: cNode.opacity.value,
        visual: cNode.visual,
        hull: cNode.hull,
        cacheKey: cNode.cacheKey,
        interaction: {
          isHovered,
          isPinned,
          isDimmed,
          isHighlighted: isFocusedCluster || inFocusedTriangle,
        },
        transition: cNode.transition
          ? {
              from: cNode.transition.from,
              fromHull: cNode.transition.fromHull,
              fromCacheKey: cNode.transition.fromCacheKey,
              to: cNode.transition.to,
              toHull: cNode.transition.toHull,
              toCacheKey: cNode.transition.toCacheKey,
              progress: cNode.transition.progress,
            }
          : null,
      });
    }

    const items: NodeRenderState<TContentVisual>[] = [];
    for (const iNode of this.itemNodes.values()) {
      const isHovered = this.hoveredContentId === iNode.id;
      const isPinned = this.pinnedIds.has(iNode.id);
      const belongsToFocusedCluster =
        this.focusedClusterUid !== null &&
        iNode.domain.layoutContext.unitClusters.some(
          (uc) => uc.cluster.clusterUid === this.focusedClusterUid,
        );
      const belongsToFocusedTriangle =
        hasTriangleOnlyFocus &&
        focusedTriVertSet !== null &&
        iNode.domain.layoutContext.unitClusters.length > 0 &&
        iNode.domain.layoutContext.unitClusters.every((uc) =>
          focusedTriVertSet.has(uc.cluster.clusterIndex),
        );
      const isHighlighted =
        this.highlightedIds.has(iNode.id) ||
        belongsToFocusedCluster ||
        belongsToFocusedTriangle;
      const isDimmed = hasHighlightFocus && !isHighlighted && !isHovered && !isPinned;

      items.push({
        id: iNode.id,
        x: iNode.x.value,
        y: iNode.y.value,
        scale: iNode.scale.value,
        opacity: iNode.opacity.value,
        visual: iNode.visual,
        hull: iNode.hull,
        cacheKey: iNode.cacheKey,
        interaction: {
          isHovered,
          isPinned,
          isDimmed,
          isHighlighted,
        },
        transition: iNode.transition
          ? {
              from: iNode.transition.from,
              fromHull: iNode.transition.fromHull,
              fromCacheKey: iNode.transition.fromCacheKey,
              to: iNode.transition.to,
              toHull: iNode.transition.toHull,
              toCacheKey: iNode.transition.toCacheKey,
              progress: iNode.transition.progress,
            }
          : null,
      });
    }

    const hasTriangleFocus = this.focusedTriangleIndex !== null;
    const triangles: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>[] =
      this.triangleStates.map((tr) =>
        this.buildTriangleRenderState(tr, hasTriangleFocus),
      );

    const edges: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[] =
      this.edgeRecords.map((edge) => {
        const [ea, eb] = edge.vertexIndices;
        const cA = this.currentClusters[ea];
        const cB = this.currentClusters[eb];
        const onFocusedTri = Boolean(
          focusedTriVertSet && focusedTriVertSet.has(ea) && focusedTriVertSet.has(eb),
        );
        const onHoveredTri = Boolean(
          hoveredTriVertSet && hoveredTriVertSet.has(ea) && hoveredTriVertSet.has(eb),
        );
        const touchesFocusedCluster =
          this.focusedClusterUid !== null &&
          (cA?.clusterUid === this.focusedClusterUid ||
            cB?.clusterUid === this.focusedClusterUid);
        const touchesHoveredCluster =
          this.hoveredClusterUid !== null &&
          (cA?.clusterUid === this.hoveredClusterUid ||
            cB?.clusterUid === this.hoveredClusterUid);
        return {
          index: edge.index,
          vertexIndices: edge.vertexIndices,
          a: edge.a,
          b: edge.b,
          mixedColorHex: edge.mixedColorHex,
          clusters: [cA, cB],
          isHighlighted:
            onFocusedTri ||
            onHoveredTri ||
            touchesFocusedCluster ||
            touchesHoveredCluster,
        };
      });

    return {
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      camera: this.camera.getState(),
      triangles,
      edges,
      clusters,
      items,
      showHulls: this.showHulls,
    };
  }

  /**
   * Mathematical convex-hull hit-testing in world coordinates.
   * Checks active items first (topmost draw order), then clusters, then triangle faces, else background.
   */
  hitTest(
    screenX: number,
    screenY: number,
  ): HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> {
    const worldPosition = this.camera.screenToWorld(screenX, screenY);
    const screenPosition = { x: screenX, y: screenY };

    // Test content items in reverse insertion order (topmost rendered first)
    const itemList = [...this.itemNodes.values()];
    for (let i = itemList.length - 1; i >= 0; i--) {
      const node = itemList[i]!;
      if (node.status !== 'active' || node.opacity.value < 0.15) continue;
      if (
        hitTestConvexGeometry(
          node.hull,
          node.x.value,
          node.y.value,
          node.scale.value,
          worldPosition.x,
          worldPosition.y,
          3 / Math.max(0.5, this.camera.getState().zoom),
        )
      ) {
        return {
          kind: 'content',
          item: node.domain.item,
          layoutContext: node.domain.layoutContext,
          visual: node.visual,
          worldPosition,
          screenPosition,
        };
      }
    }

    // Test topic clusters
    const clusterList = [...this.clusterNodes.values()];
    for (let i = clusterList.length - 1; i >= 0; i--) {
      const node = clusterList[i]!;
      if (node.status !== 'active' || node.opacity.value < 0.15) continue;
      if (
        hitTestConvexGeometry(
          node.hull,
          node.x.value,
          node.y.value,
          node.scale.value,
          worldPosition.x,
          worldPosition.y,
          3 / Math.max(0.5, this.camera.getState().zoom),
        )
      ) {
        return {
          kind: 'cluster',
          cluster: node.domain,
          visual: node.visual,
          worldPosition,
          screenPosition,
        };
      }
    }

    // Test mesh triangle faces
    const hasTriangleFocus = this.focusedTriangleIndex !== null;
    for (let i = this.triangleStates.length - 1; i >= 0; i--) {
      const tr = this.triangleStates[i]!;
      if (
        isPointInTriangle(
          worldPosition.x,
          worldPosition.y,
          tr.points[0],
          tr.points[1],
          tr.points[2],
        )
      ) {
        return {
          kind: 'triangle',
          triangle: this.buildTriangleRenderState(tr, hasTriangleFocus),
          worldPosition,
          screenPosition,
        };
      }
    }

    return {
      kind: 'background',
      worldPosition,
      screenPosition,
    };
  }

  /** Processes pointer movement for centralized hover detection. */
  handlePointerMove(screenX: number, screenY: number): void {
    const target = this.hitTest(screenX, screenY);

    if (target.kind === 'content') {
      const nextId = target.layoutContext.id;
      if (this.hoveredClusterUid !== null) {
        this.hoveredClusterUid = null;
        this.interactions.onClusterHover?.(null);
      }
      if (this.hoveredTriangleIndex !== null) {
        this.hoveredTriangleIndex = null;
        this.interactions.onTriangleHover?.(null);
      }
      this.hoveredContentId = nextId;
      this.dirtyRender = true;
      this.interactions.onContentHover?.({
        item: target.item,
        layoutContext: target.layoutContext,
        visual: target.visual,
        screenPosition: target.screenPosition,
        worldPosition: target.worldPosition,
      });
    } else if (target.kind === 'cluster') {
      const nextUid = target.cluster.clusterUid;
      if (this.hoveredContentId !== null) {
        this.hoveredContentId = null;
        this.interactions.onContentHover?.(null);
      }
      if (this.hoveredTriangleIndex !== null) {
        this.hoveredTriangleIndex = null;
        this.interactions.onTriangleHover?.(null);
      }
      this.hoveredClusterUid = nextUid;
      this.dirtyRender = true;
      this.interactions.onClusterHover?.({
        cluster: target.cluster,
        visual: target.visual,
        screenPosition: target.screenPosition,
        worldPosition: target.worldPosition,
      });
    } else if (target.kind === 'triangle') {
      if (this.hoveredContentId !== null) {
        this.hoveredContentId = null;
        this.interactions.onContentHover?.(null);
      }
      if (this.hoveredClusterUid !== null) {
        this.hoveredClusterUid = null;
        this.interactions.onClusterHover?.(null);
      }
      this.hoveredTriangleIndex = target.triangle.index;
      this.dirtyRender = true;
      this.interactions.onTriangleHover?.({
        triangle: target.triangle,
        screenPosition: target.screenPosition,
        worldPosition: target.worldPosition,
      });
    } else {
      if (this.hoveredContentId !== null) {
        this.hoveredContentId = null;
        this.dirtyRender = true;
        this.interactions.onContentHover?.(null);
      }
      if (this.hoveredClusterUid !== null) {
        this.hoveredClusterUid = null;
        this.dirtyRender = true;
        this.interactions.onClusterHover?.(null);
      }
      if (this.hoveredTriangleIndex !== null) {
        this.hoveredTriangleIndex = null;
        this.dirtyRender = true;
        this.interactions.onTriangleHover?.(null);
      }
    }
  }

  /** Clears active hover state when pointer exits the canvas/SVG surface. */
  handlePointerLeave(): void {
    if (this.hoveredContentId !== null) {
      this.hoveredContentId = null;
      this.dirtyRender = true;
      this.interactions.onContentHover?.(null);
    }
    if (this.hoveredClusterUid !== null) {
      this.hoveredClusterUid = null;
      this.dirtyRender = true;
      this.interactions.onClusterHover?.(null);
    }
    if (this.hoveredTriangleIndex !== null) {
      this.hoveredTriangleIndex = null;
      this.dirtyRender = true;
      this.interactions.onTriangleHover?.(null);
    }
  }

  /** Dispatches left-click interaction using mathematical convex-hull hit-testing. */
  handleLeftClick(raw: Omit<NormalizedPointerEvent, 'worldX' | 'worldY'>): void {
    const target = this.hitTest(raw.screenX, raw.screenY);
    const fullEvent: NormalizedPointerEvent = {
      ...raw,
      worldX: target.worldPosition.x,
      worldY: target.worldPosition.y,
    };
    this.interactions.onLeftClick?.(target, fullEvent);
  }

  /**
   * Dispatches right-click interaction using mathematical convex-hull hit-testing.
   * Returns `true` when the handler wants to suppress the browser's default context menu.
   */
  handleRightClick(raw: Omit<NormalizedPointerEvent, 'worldX' | 'worldY'>): boolean {
    const target = this.hitTest(raw.screenX, raw.screenY);
    const fullEvent: NormalizedPointerEvent = {
      ...raw,
      worldX: target.worldPosition.x,
      worldY: target.worldPosition.y,
    };
    const suppressed = this.interactions.onRightClick?.(target, fullEvent);
    return suppressed === true;
  }

  /** Dispatches wheel behavior according to the configured policy (`zoom-to-cursor`, `pan-vertical`, `none`, or custom). */
  handleWheel(event: NormalizedWheelEvent): boolean {
    const policy = this.interactions.onWheel ?? 'zoom-to-cursor';
    if (policy === 'none') return false;
    if (typeof policy === 'function') {
      policy(event, this.camera);
      return true;
    }
    if (policy === 'pan-vertical') {
      this.camera.panBy(-event.deltaX, -event.deltaY);
      return true;
    }
    // Default: 'zoom-to-cursor'
    const factor = Math.exp(-event.deltaY * 0.0014);
    this.camera.zoomToCursor(event.screenX, event.screenY, factor);
    return true;
  }

  /** Destroys the engine and releases its renderer adapter. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.destroy();
  }
}
