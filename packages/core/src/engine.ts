import {
  stepCriticallyDampedSpring,
  stepVisualTransition,
} from './animation.js';
import { SimplexCamera } from './camera.js';
import {
  defaultNormalizeTag,
  extractIdentifiedItems,
  extractNormalizedItems,
  type ComputedItemPlacement,
  type NormalizedContentItem,
  type PreviousClusterSnapshot,
} from './clustering.js';
import { buildZoomFlightState, syncFlightState } from './engine/flight.js';
import {
  getInteractiveTargetsFromScene,
  hitTestScene,
  resolveHitTargetForInteractiveTargetFromScene,
  type SceneHitTestContext,
} from './engine/hitTest.js';
import {
  buildEngineLegendModel,
  computeLegendSignature,
} from './engine/legend.js';
import {
  buildAnimatedTrianglesAndEdges,
  buildContextElements,
  reconcileSpringNodes,
} from './engine/reconcile.js';
import { buildSceneFrameSnapshot } from './engine/snapshot.js';
import {
  defaultGetId,
  defaultGetTags,
  evaluateFlightCamera,
  getRootToStackTransform,
  resolveContainingTriangleIndexForItem,
  type AnimatedContextClusterRecord,
  type AnimatedContextEdgeRecord,
  type AnimatedContextItemRecord,
  type AnimatedContextTriangleRecord,
  type AnimatedEdgeRecord,
  type AnimatedNodeRecord,
  type AnimatedTriangleRecord,
  type DrillTransitionSpec,
  type ZoomFlightState,
} from './engine/types.js';
import {
  captureEngineViewState,
  filterValidStringIds,
  resolveClusterForViewStep,
} from './engine/viewState.js';
import { getHullBoundingBox } from './geometry.js';
import type { TwoPhaseLayoutResult } from './layout.js';
import { lerpOklabHex } from './oklab.js';
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
} from './strategies.js';
import type {
  CameraController,
  CameraState,
  ClusterDerivationContext,
  ClusterDescriptor,
  ContentLayoutContext,
  DefaultTaggedItem,
  EmptyClusterBehavior,
  FocusItemOptions,
  HitTarget,
  IdentifiedItem,
  InteractionHandlers,
  ItemFilterMode,
  ItemFilterOptions,
  ItemFilterPredicate,
  ItemFilterState,
  LayoutMetrics,
  LayoutSolverOptions,
  MeshOptions,
  NormalizedPointerEvent,
  NormalizedWheelEvent,
  ReducedMotionPreference,
  RestoreViewStateOptions,
  SceneFrameSnapshot,
  SelectInRectOptions,
  SimplexEngineConfig,
  SimplexEngineResolvedConfig,
  SimplexInteractiveTarget,
  SimplexKeyboardFocusTarget,
  SimplexLegendModel,
  SimplexLegendModelOptions,
  SimplexMesh,
  SimplexRendererAdapter,
  SimplexViewState,
  SimplexViewZoomStep,
  VisualResolver,
  ZoomToItemOptions,
} from './types.js';
import {
  composeZoomAffine,
  createFreeCameraZoomStrategy,
  invertZoomAffine,
  parseScopedNeighborId,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type ZoomAffineTransform,
  type ZoomFrameSpec,
  type ZoomItemAnchorInput,
  type ZoomSharedHelpers,
} from './zoom.js';

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
  private readonly formatTagLabelFn?: (tag: string) => string;
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
  private zoomStrategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  private theme: SimplexColorTheme;
  private previousTheme: SimplexColorTheme | undefined;
  private showHulls: boolean;
  private emptyClusterBehavior: EmptyClusterBehavior = 'normal';
  private itemFilterPredicate: ItemFilterPredicate<TItem> | null = null;
  private itemFilterMode: ItemFilterMode = 'dim';
  private readonly filteredOutItemIds = new Set<string>();
  private canonicalSeedItems: readonly TItem[] | null = null;
  private shiftClickSelectsEnabled = true;
  private visualResolverRevision = 0;
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
  private onZoomStateChange?: (state: SimplexZoomState) => void;

  public readonly camera: CameraController;

  private currentMesh: SimplexMesh | null = null;
  private previousMesh: SimplexMesh | null = null;
  private previousItems: readonly IdentifiedItem<TItem>[] = [];
  private previousNormalizedItems: readonly NormalizedContentItem<TItem>[] = [];
  private lastClusteringOutput: ClusteringStrategyOutput<TItem, TTagMeta> | null = null;
  private lastPrevClusterSnapshots: readonly PreviousClusterSnapshot[] = [];
  private currentClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = [];
  private currentPlacements: readonly ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>[] =
    [];
  private rootMesh: SimplexMesh | null = null;
  private rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = [];
  private rootPlacements: readonly ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>[] = [];
  private zoomStack: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>[] = [];
  private zoomStepPath: SimplexViewZoomStep[] = [];
  private lastSolvedScaleRatios = new Map<string, number>();
  private currentZoomState: SimplexZoomState = {
    strategyName: 'free-camera',
    mode: 'free-camera',
    depth: 0,
    activeFrameKind: 'root',
    canDrillUp: false,
    isLeafReached: false,
    fullScaleItemRatio: 1,
    breadcrumbs: [
      {
        depth: 0,
        frameId: 'root',
        kind: 'root',
        label: 'Overview',
        shortLabel: 'Overview',
        segments: [{ label: 'Overview' }],
      },
    ],
    neighbors: [],
    drillableTriangleIndices: [],
    focusableTriangleIndices: [],
    drillableClusterUids: [],
  };

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
  private contextTriangleStates: AnimatedContextTriangleRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[] = [];
  private contextEdgeRecords: AnimatedContextEdgeRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[] = [];
  private contextClusterNodes: AnimatedContextClusterRecord<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] = [];
  private contextItemNodes: AnimatedContextItemRecord<
    TItem,
    TContentVisual,
    TTagMeta,
    TClusterMeta
  >[] = [];
  private readonly solvedFrameCache = new Map<string, TwoPhaseLayoutResult>();
  private activeFlight: ZoomFlightState<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null = null;

  private readonly nextClusterUidSeq = { value: 0 };
  private hoveredContentId: string | null = null;
  private hoveredClusterUid: string | null = null;
  private hoveredContextClusterId: string | null = null;
  private hoveredTriangleIndex: number | null = null;
  private pinnedIds = new Set<string>();
  private highlightedIds = new Set<string>();
  private selectedIds = new Set<string>();
  private onSelectionChange?: (selectedIds: ReadonlySet<string>) => void;
  private onLegendChange?: (
    model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ) => void;
  private lastEmittedLegendSig: string | null = null;
  private focusedItemId: string | null = null;
  private focusedItemHighlight = false;
  private focusedClusterUid: string | null = null;
  private focusedTriangleIndex: number | null = null;
  private neighborReturnHighlight:
    | { readonly kind: 'triangle'; readonly triangleIndex: number }
    | { readonly kind: 'cluster'; readonly clusterUid: string }
    | null = null;

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
  private awaitingInitialSolve = false;
  private reducedMotionPreference: ReducedMotionPreference = 'auto';
  private reducedMotionActive = false;
  private destroyed = false;
  private batchDepth = 0;
  private batchPendingPipelineReason: PipelineUpdateReason | null = null;
  private batchPendingRecolor = false;
  private batchPendingLayout = false;
  private batchPendingZoomReset = false;
  private batchPendingRenderNow = false;
  private batchPendingLegendEmit = false;

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
    this.formatTagLabelFn = config.formatTagLabel;
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
    this.zoomStrategy =
      config.zoomStrategy ??
      createFreeCameraZoomStrategy<TItem, TTagMeta, TClusterMeta>();
    this.theme = config.theme ?? 'dark';
    this.emptyClusterBehavior = config.emptyClusterBehavior ?? 'normal';
    this.itemFilterPredicate = config.itemFilter ?? null;
    this.itemFilterMode = config.itemFilterMode ?? 'dim';
    this.canonicalSeedItems = config.canonicalSeedItems
      ? [...config.canonicalSeedItems]
      : null;
    this.showHulls = config.showHulls ?? false;
    this.reducedMotionPreference = config.reducedMotion ?? 'auto';
    this.reducedMotionActive = this.reducedMotionPreference === true;
    this.interactions = config.interactions ?? {};
    this.onMetricsChange = config.onMetricsChange;
    this.onClustersChange = config.onClustersChange;
    this.onZoomStateChange = config.onZoomStateChange;
    this.onSelectionChange = config.onSelectionChange;
    this.onLegendChange = config.onLegendChange;
    this.shiftClickSelectsEnabled = config.shiftClickSelects ?? true;
    if (config.selectedIds != null) {
      for (const id of config.selectedIds) {
        const trimmed = id.trim();
        if (trimmed) this.selectedIds.add(trimmed);
      }
    }

    this.camera = new SimplexCamera(() => {
      this.dirtyRender = true;
    });

    this.awaitingInitialSolve = Boolean(config.deferInitialSolve);
    if (!this.awaitingInitialSolve) {
      this.recomputePipeline('initial');
    } else {
      this.dirtyRender = false;
    }
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

  /** Updates the structured legend model change listener. */
  setOnLegendChange(
    cb?: (model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>) => void,
  ): void {
    this.onLegendChange = cb;
    this.lastEmittedLegendSig = null;
  }

  /**
   * Builds a structured legend model synchronized with the active zoom/drill-down frame,
   * item filter counts, `emptyClusterBehavior`, and focused cluster state.
   */
  getLegendModel(
    options?: SimplexLegendModelOptions,
  ): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> {
    return buildEngineLegendModel(
      {
        currentClusters: this.currentClusters,
        currentPlacements: this.currentPlacements,
        contextClusterNodes: this.contextClusterNodes,
        itemNodes: this.itemNodes,
        filteredOutItemIds: this.filteredOutItemIds,
        itemFilterPredicate: this.itemFilterPredicate,
        itemFilterMode: this.itemFilterMode,
        emptyClusterBehavior: this.emptyClusterBehavior,
        focusedClusterUid: this.focusedClusterUid,
        zoomDepth: this.currentZoomState.depth,
      },
      options,
    );
  }

  private emitLegendChangeIfNeeded(): void {
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.batchDepth > 0) {
      this.batchPendingLegendEmit = true;
      return;
    }
    if (!this.onLegendChange) return;
    const model = this.getLegendModel();
    const sig = computeLegendSignature(model);
    if (sig === this.lastEmittedLegendSig) return;
    this.lastEmittedLegendSig = sig;
    this.onLegendChange(model);
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
    if (this.awaitingInitialSolve) return;
    this.requestPipeline('items');
  }

  /** Removes one or more items by ID and smoothly fades out exiting nodes. */
  removeItems(ids: string | readonly string[]): void {
    const list = typeof ids === 'string' ? [ids] : ids;
    if (list.length === 0) return;
    const removeSet = new Set(list.map((id) => id.trim()));
    if (this.focusedItemId !== null && removeSet.has(this.focusedItemId)) {
      this.focusedItemId = null;
      this.focusedItemHighlight = false;
    }
    let selectionPruned = false;
    for (const id of removeSet) {
      if (this.selectedIds.delete(id)) {
        selectionPruned = true;
      }
    }
    const filtered = this.rawItems.filter((it) => !removeSet.has(this.getIdFn(it).trim()));
    if (selectionPruned) {
      this.dirtyRender = true;
      this.onSelectionChange?.(new Set(this.selectedIds));
    }
    if (filtered.length === this.rawItems.length) return;
    this.rawItems = filtered;
    if (this.awaitingInitialSolve) return;
    this.requestPipeline('items');
  }

  /** Replaces the entire item collection while smoothly morphing matching clusters & items. */
  setItems(items: readonly TItem[]): void {
    this.rawItems = [...items];
    if (
      this.focusedItemId !== null &&
      !this.rawItems.some((it) => this.getIdFn(it).trim() === this.focusedItemId)
    ) {
      this.focusedItemId = null;
      this.focusedItemHighlight = false;
    }
    if (this.awaitingInitialSolve) return;
    this.requestPipeline('items');
  }

  /** Swaps the mesh/triangulation strategy at runtime and recomputes the graph. */
  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.meshStrategy = strategy;
    if (this.awaitingInitialSolve) return;
    this.requestPipeline('strategy');
  }

  /** Swaps the topic clustering & vertex assignment strategy at runtime and recomputes. */
  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    this.clusteringStrategy = strategy;
    if (this.awaitingInitialSolve) return;
    this.requestPipeline('strategy');
  }

  /** Swaps the cluster coloring & item mixing strategy at runtime with smooth transition. */
  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.colorStrategy = strategy;
    if (this.awaitingInitialSolve) return;
    this.requestRecolor();
  }

  /** Swaps the node positioning & scaling layout strategy at runtime and re-solves cleanly. */
  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    this.layoutStrategy = strategy;
    if (this.awaitingInitialSolve) return;
    this.requestLayout();
  }

  /** Swaps the zoom / drill-down strategy at runtime (resetting any open drill stack cleanly). */
  setZoomStrategy(
    strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>,
  ): void {
    this.zoomStrategy = strategy;
    if (strategy.mode === 'drill-down') {
      this.camera.reset();
    }
    if (this.awaitingInitialSolve) return;
    this.requestZoomReset();
  }

  /**
   * Executes `fn` inside a re-entrant batch transaction so multiple sequential state,
   * theme, visual-resolver, or strategy mutations coalesce into at most one pipeline/layout
   * pass and one synchronous render frame when the outermost batch exits.
   */
  batch<TResult>(fn: () => TResult): TResult {
    this.batchDepth += 1;
    try {
      return fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) {
        this.flushBatch();
      }
    }
  }

  private mergePipelineReason(
    prev: PipelineUpdateReason | null,
    next: PipelineUpdateReason,
  ): PipelineUpdateReason {
    if (prev === null) return next;
    const rank: Record<PipelineUpdateReason, number> = {
      initial: 5,
      viewport: 4,
      mesh: 3,
      strategy: 2,
      items: 1,
    };
    return rank[next] >= rank[prev] ? next : prev;
  }

  private requestPipeline(reason: PipelineUpdateReason): void {
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.batchDepth > 0) {
      this.batchPendingPipelineReason = this.mergePipelineReason(
        this.batchPendingPipelineReason,
        reason,
      );
      return;
    }
    this.recomputePipeline(reason);
  }

  private requestRecolor(): void {
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.batchDepth > 0) {
      this.batchPendingRecolor = true;
      return;
    }
    this.applyRecolorAndReconcile();
  }

  private requestLayout(): void {
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.batchDepth > 0) {
      this.batchPendingLayout = true;
      return;
    }
    this.recomputeLayoutOnly('strategy');
  }

  private requestZoomReset(): void {
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.batchDepth > 0) {
      this.batchPendingZoomReset = true;
      return;
    }
    this.applyZoomStrategyChange();
  }

  private applyRecolorAndReconcile(): void {
    if (this.lastClusteringOutput && this.rootMesh) {
      this.solvedFrameCache.clear();
      const wasZoomed = this.zoomStack.length > 1;
      this.currentMesh = this.rootMesh;
      this.applyColorsAndDeriveDescriptors('strategy');
      this.zoomStack = [this.buildRootZoomFrame()];
      this.zoomStepPath = [];
      this.neighborReturnHighlight = null;
      if (wasZoomed) {
        this.camera.reset();
      }
      this.recomputeLayoutAndReconcile(false, this.currentMetrics.tagCount, 'strategy');
    }
  }

  private applyZoomStrategyChange(): void {
    const rootFrame = this.zoomStack[0];
    if (this.zoomStack.length > 1 && rootFrame) {
      this.executeDrillTransition([rootFrame], null, []);
    } else {
      this.refreshZoomState();
      this.dirtyRender = true;
    }
  }

  private flushBatch(): void {
    const pipelineReason = this.batchPendingPipelineReason;
    const pendingRecolor = this.batchPendingRecolor;
    const pendingLayout = this.batchPendingLayout;
    const pendingZoomReset = this.batchPendingZoomReset;
    const pendingRenderNow = this.batchPendingRenderNow;
    const pendingLegendEmit = this.batchPendingLegendEmit;

    this.batchPendingPipelineReason = null;
    this.batchPendingRecolor = false;
    this.batchPendingLayout = false;
    this.batchPendingZoomReset = false;
    this.batchPendingRenderNow = false;
    this.batchPendingLegendEmit = false;

    if (this.destroyed || this.awaitingInitialSolve) return;

    if (pipelineReason !== null) {
      this.recomputePipeline(pipelineReason);
    } else if (pendingRecolor) {
      this.applyRecolorAndReconcile();
    } else if (pendingLayout) {
      if (pendingZoomReset && this.zoomStack.length > 1 && this.zoomStack[0]) {
        const rootFrame = this.zoomStack[0];
        this.zoomStack = [rootFrame];
        this.zoomStepPath = [];
        this.activateZoomFrame(rootFrame);
        this.neighborReturnHighlight = null;
        this.camera.reset();
      }
      this.recomputeLayoutOnly('strategy');
    } else if (pendingZoomReset) {
      this.applyZoomStrategyChange();
    }

    if (pendingLegendEmit) {
      this.emitLegendChangeIfNeeded();
    }

    if (pendingRenderNow && this.dirtyRender) {
      this.renderNow();
    }
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

  /** Returns active zoom / drill-down strategy. */
  getZoomStrategy(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
    return this.zoomStrategy;
  }

  /** Returns the current drill-down depth, breadcrumbs, neighbors, and drillable targets. */
  getZoomState(): SimplexZoomState {
    return this.currentZoomState;
  }

  /** Drills down into a triangle face using the active `SimplexZoomStrategy`. */
  drillDownTriangle(triangleIndex: number): boolean {
    if (this.zoomStrategy.mode !== 'drill-down' || !this.zoomStrategy.drillIntoTriangle) {
      return false;
    }
    const parentFrame = this.zoomStack[this.zoomStack.length - 1];
    if (!parentFrame) return false;

    // Clicking the free face of an already-focused single leaf triangle toggles back up one level.
    if (
      parentFrame.kind === 'triangle-focus' &&
      this.zoomStack.length >= 2 &&
      triangleIndex === 0
    ) {
      return this.drillUp();
    }

    const outcome = this.zoomStrategy.drillIntoTriangle({
      triangleIndex,
      parentFrame,
      parentDepth: this.zoomStack.length - 1,
      itemScaleRatios: this.lastSolvedScaleRatios,
      helpers: this.createZoomHelpers(parentFrame),
    });
    if (!outcome) return false;

    this.executeDrillTransition(
      [...this.zoomStack, outcome.nextFrame],
      null,
      [...this.zoomStepPath, { kind: 'triangle', index: triangleIndex }],
    );
    return true;
  }

  /** Drills down onto a cluster's 1-ring star or direct spotlight using the active `SimplexZoomStrategy`. */
  drillDownCluster(clusterUid: string): boolean {
    if (this.zoomStrategy.mode !== 'drill-down' || !this.zoomStrategy.drillIntoCluster) {
      return false;
    }
    const parentFrame = this.zoomStack[this.zoomStack.length - 1];
    if (!parentFrame) return false;
    const clusterIndex = parentFrame.clusters.findIndex(
      (c) => c.clusterUid === clusterUid,
    );
    if (clusterIndex < 0) return false;
    const targetCluster = parentFrame.clusters[clusterIndex];

    // Inside an active 1-ring cluster star:
    // - Clicking the already-focused center cluster (index 0) toggles back up one level (`drillUp`).
    // - Clicking an outer 1-ring rim cluster (index > 0) switches laterally at the same zoom depth
    //   to that cluster's complete 1-ring star in the parent mesh.
    if (parentFrame.kind === 'cluster-star' && this.zoomStack.length >= 2) {
      if (clusterIndex === 0) {
        return this.drillUp();
      }
      const rimNeighbor = parentFrame.neighbors[clusterIndex - 1];
      if (rimNeighbor && rimNeighbor.targetKind === 'cluster') {
        return this.drillToNeighbor(rimNeighbor.id);
      }
    }

    // Inside an active single-triangle leaf focus:
    // Clicking any of the 3 corner clusters transitions laterally at the same zoom depth
    // to that cluster's complete 1-ring star in the parent mesh.
    if (parentFrame.kind === 'triangle-focus' && this.zoomStack.length >= 2) {
      const cornerNeighborId =
        parentFrame.cornerClusterNeighborIds?.[clusterIndex];
      if (cornerNeighborId) {
        return this.drillToNeighbor(cornerNeighborId);
      }
      return false;
    }

    const outcome = this.zoomStrategy.drillIntoCluster({
      clusterUid,
      clusterIndex,
      parentFrame,
      parentDepth: this.zoomStack.length - 1,
      itemScaleRatios: this.lastSolvedScaleRatios,
      helpers: this.createZoomHelpers(parentFrame),
    });
    if (!outcome) return false;

    const clusterStep: SimplexViewZoomStep = {
      kind: 'cluster',
      clusterIndex,
      clusterUid,
      label: targetCluster?.subclusterLabel ?? targetCluster?.defaultLabel,
    };
    const nextStack = outcome.replaceTop
      ? [...this.zoomStack.slice(0, -1), outcome.nextFrame]
      : [...this.zoomStack, outcome.nextFrame];
    const nextStepPath = outcome.replaceTop
      ? [...this.zoomStepPath.slice(0, -1), clusterStep]
      : [...this.zoomStepPath, clusterStep];
    this.executeDrillTransition(nextStack, null, nextStepPath);
    return true;
  }

  /**
   * Navigates to a neighboring triangle, cluster, or ancestor context element.
   * Supports neighbors at the immediate parent level as well as deeper ancestor levels:
   * - If the target neighbor supports drilling into `ancestorDepth + 1`, transitions smoothly
   *   into that neighbor frame (combining any needed zoom-out from deeper levels with the switch).
   * - If the target neighbor does NOT support that zoom level (e.g. sparse/leaf or empty),
   *   smoothly zooms out across as many levels as needed (`currentDepth -> ancestorDepth`)
   *   so the clicked neighbor is active and in full view.
   */
  drillToNeighbor(neighborId: string): boolean {
    if (
      this.zoomStrategy.mode !== 'drill-down' ||
      !this.zoomStrategy.drillToNeighbor ||
      this.zoomStack.length < 2
    ) {
      return false;
    }

    const { parentFrameId, localTarget } = parseScopedNeighborId(neighborId);
    const ancestorDepth =
      parentFrameId !== undefined
        ? this.zoomStack.findIndex((f) => f.frameId === parentFrameId)
        : this.zoomStack.length - 2;
    if (ancestorDepth < 0 || ancestorDepth >= this.zoomStack.length - 1) {
      return false;
    }

    const ancestorFrame = this.zoomStack[ancestorDepth]!;
    const childFrameAtLevel = this.zoomStack[ancestorDepth + 1]!;
    const ancestorStepPrefix = this.zoomStepPath.slice(0, ancestorDepth);

    if (localTarget === 'frame') {
      this.executeDrillTransition(
        this.zoomStack.slice(0, ancestorDepth + 1),
        null,
        ancestorStepPrefix,
      );
      return true;
    }

    const ancestorScaleRatios = this.getFrameItemScaleRatios(ancestorFrame);
    const outcome = this.zoomStrategy.drillToNeighbor({
      neighborId: localTarget,
      currentFrame: childFrameAtLevel,
      parentFrame: ancestorFrame,
      currentDepth: ancestorDepth + 1,
      itemScaleRatios: ancestorScaleRatios,
      helpers: this.createZoomHelpers(ancestorFrame),
    });

    if (outcome) {
      let nextStep: SimplexViewZoomStep | null = null;
      if (localTarget.startsWith('tri:')) {
        const triIdx = parseInt(localTarget.slice(4), 10);
        if (Number.isFinite(triIdx) && triIdx >= 0) {
          nextStep = { kind: 'triangle', index: triIdx };
        }
      } else if (localTarget.startsWith('cluster:')) {
        const cIdx = parseInt(localTarget.slice(8), 10);
        if (Number.isFinite(cIdx) && cIdx >= 0) {
          const targetCluster = ancestorFrame.clusters[cIdx];
          nextStep = {
            kind: 'cluster',
            clusterIndex: cIdx,
            clusterUid: targetCluster?.clusterUid,
            label: targetCluster?.subclusterLabel ?? targetCluster?.defaultLabel,
          };
        }
      }
      this.executeDrillTransition(
        [...this.zoomStack.slice(0, ancestorDepth + 1), outcome.nextFrame],
        null,
        nextStep ? [...ancestorStepPrefix, nextStep] : ancestorStepPrefix,
      );
      return true;
    }

    // Neighbor does not support `ancestorDepth + 1` (e.g. leaf-scale, <=1 item, empty, or cluster zoom disabled):
    // verify the target exists in `ancestorFrame`, zoom out across as many levels as needed to `ancestorDepth`,
    // and highlight the clicked neighbor in `ancestorFrame`.
    if (localTarget.startsWith('tri:')) {
      const triIdx = parseInt(localTarget.slice(4), 10);
      if (
        Number.isFinite(triIdx) &&
        triIdx >= 0 &&
        triIdx < ancestorFrame.mesh.triangles.length
      ) {
        this.executeDrillTransition(
          this.zoomStack.slice(0, ancestorDepth + 1),
          {
            kind: 'triangle',
            triangleIndex: triIdx,
          },
          ancestorStepPrefix,
        );
        return true;
      }
    } else if (localTarget.startsWith('cluster:')) {
      const cIdx = parseInt(localTarget.slice(8), 10);
      if (
        Number.isFinite(cIdx) &&
        cIdx >= 0 &&
        cIdx < ancestorFrame.clusters.length
      ) {
        const targetCluster = ancestorFrame.clusters[cIdx];
        this.executeDrillTransition(
          this.zoomStack.slice(0, ancestorDepth + 1),
          targetCluster
            ? { kind: 'cluster', clusterUid: targetCluster.clusterUid }
            : null,
          ancestorStepPrefix,
        );
        return true;
      }
    }

    return false;
  }

  /** Steps up one level in the drill-down hierarchy. */
  drillUp(): boolean {
    if (this.zoomStack.length <= 1) return false;
    return this.drillToDepth(this.zoomStack.length - 2);
  }

  /** Jumps directly to a specific ancestor depth (`0` = root overview). */
  drillToDepth(depth: number): boolean {
    const targetDepth = Math.max(0, Math.min(this.zoomStack.length - 1, depth));
    if (targetDepth >= this.zoomStack.length - 1) return false;

    this.executeDrillTransition(
      this.zoomStack.slice(0, targetDepth + 1),
      null,
      this.zoomStepPath.slice(0, targetDepth),
    );
    return true;
  }

  /** Returns immediately to the root overview (`depth === 0`). */
  drillToRoot(): boolean {
    return this.drillToDepth(0);
  }

  private getCurrentScreenRootTransform(): ZoomAffineTransform {
    const base = getRootToStackTransform(this.zoomStack);
    if (!this.activeFlight) return base;
    const { M_u } = evaluateFlightCamera(
      this.activeFlight,
      this.activeFlight.rawProgress,
    );
    return composeZoomAffine(base, M_u);
  }

  private executeDrillTransition(
    nextStack: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>[],
    nextNeighborHighlight:
      | { readonly kind: 'triangle'; readonly triangleIndex: number }
      | { readonly kind: 'cluster'; readonly clusterUid: string }
      | null = null,
    nextStepPath?: SimplexViewZoomStep[],
  ): void {
    const oldRootTransform = this.getCurrentScreenRootTransform();
    const clusterDomainByNodeId = new Map<
      string,
      ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
    >();
    for (const cNode of this.clusterNodes.values()) {
      clusterDomainByNodeId.set(cNode.id, cNode.domain);
    }
    for (const cc of this.contextClusterNodes) {
      clusterDomainByNodeId.set(cc.id, cc.cluster);
    }
    if (this.activeFlight) {
      for (const dc of this.activeFlight.departingClusters) {
        clusterDomainByNodeId.set(dc.id, dc.cluster);
      }
    }

    this.hoveredTriangleIndex = null;
    this.hoveredClusterUid = null;
    this.hoveredContextClusterId = null;
    this.hoveredContentId = null;
    this.focusedItemId = null;
    this.focusedItemHighlight = false;
    this.focusedTriangleIndex = null;
    this.focusedClusterUid = null;
    this.neighborReturnHighlight = null;
    this.interactions.onTriangleHover?.(null);
    this.interactions.onClusterHover?.(null);
    this.interactions.onContentHover?.(null);

    const snapshot = this.buildFrameSnapshot();

    this.zoomStack = nextStack;
    if (nextStepPath !== undefined) {
      this.zoomStepPath = nextStepPath;
    } else if (nextStack.length <= 1) {
      this.zoomStepPath = [];
    }
    const active = this.zoomStack[this.zoomStack.length - 1]!;
    this.activateZoomFrame(active);
    this.neighborReturnHighlight = nextNeighborHighlight;
    this.camera.reset();

    const newRootTransform = getRootToStackTransform(this.zoomStack);
    const flightTransform = composeZoomAffine(
      invertZoomAffine(oldRootTransform),
      newRootTransform,
    );
    const invFlight = invertZoomAffine(flightTransform);

    this.recomputeLayoutAndReconcile(
      false,
      this.currentMetrics.tagCount,
      'strategy',
      {
        snapshot,
        clusterDomainByNodeId,
        flightTransform,
        invFlight,
      },
    );
  }

  /** Updates mesh generation options and recomputes triangulation + clustering. */
  setMeshOptions(options: MeshOptions): void {
    this.meshOptions = options;
    if (this.awaitingInitialSolve) return;
    this.requestPipeline('mesh');
  }

  /** Updates layout solver options and re-solves overlap-free layout. */
  setLayoutOptions(options: LayoutSolverOptions): void {
    this.layoutOptions = options;
    if (this.awaitingInitialSolve) return;
    this.requestLayout();
  }

  /** Updates canvas theme hint for color strategies. */
  setTheme(theme: SimplexColorTheme): void {
    if (this.theme === theme) return;
    this.previousTheme = this.theme;
    this.theme = theme;
    if (this.awaitingInitialSolve) return;
    this.requestRecolor();
  }

  /**
   * Updates reduced-motion mode (`'auto' | boolean`). When enabled (`true`), immediately snaps
   * any in-flight spring, zoom flight, or visual transition to its settled target state and
   * suppresses spatial motion on subsequent updates.
   */
  setReducedMotion(preference: ReducedMotionPreference): void {
    this.reducedMotionPreference = preference;
    const nextActive = preference === true;
    const wasActive = this.reducedMotionActive;
    this.reducedMotionActive = nextActive;
    if (nextActive && (!wasActive || this.activeFlight !== null || !this.currentMetrics.isSettled)) {
      this.snapAnimationsToTarget();
    }
  }

  /** Returns the configured `reducedMotion` preference (`'auto' | boolean`). */
  getReducedMotion(): ReducedMotionPreference {
    return this.reducedMotionPreference;
  }

  /** Returns `true` when motion reduction is currently active on this engine. */
  isReducedMotion(): boolean {
    return this.reducedMotionActive;
  }

  /**
   * Snaps all active springs, zoom flights, visual crossfades, and OKLab triangle blends
   * directly to their target state without intermediate motion frames.
   */
  private snapAnimationsToTarget(): void {
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.activeFlight) {
      this.syncActiveFlightState(1);
      this.activeFlight = null;
    }

    const snapMap = <TVisual, TDomain>(
      map: Map<string, AnimatedNodeRecord<TVisual, TDomain>>,
    ) => {
      const toDelete: string[] = [];
      for (const [key, node] of map) {
        if (node.status === 'exiting') {
          toDelete.push(key);
          continue;
        }
        node.x.value = node.x.target;
        node.x.velocity = 0;
        node.y.value = node.y.target;
        node.y.velocity = 0;
        node.scale.value = node.scale.target;
        node.scale.velocity = 0;
        node.opacity.value = node.opacity.target;
        node.opacity.velocity = 0;
        node.transition = null;
      }
      for (const key of toDelete) {
        map.delete(key);
      }
    };

    snapMap(this.clusterNodes);
    snapMap(this.itemNodes);

    for (const tr of this.triangleStates) {
      tr.currentOklab[0] = tr.targetOklab[0];
      tr.currentOklab[1] = tr.targetOklab[1];
      tr.currentOklab[2] = tr.targetOklab[2];
      tr.fillHex = lerpOklabHex(tr.targetOklab, tr.targetOklab, 1);
    }

    if (!this.currentMetrics.isSettled) {
      this.currentMetrics = { ...this.currentMetrics, isSettled: true };
      this.onMetricsChange?.(this.currentMetrics);
    }
    this.dirtyRender = true;
    this.renderNow();
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
    this.visualResolverRevision += 1;
    if (this.awaitingInitialSolve) return;
    this.requestLayout();
  }

  /** Updates the uniform size multiplier and re-solves overlap-free layout. */
  setSizeMultiplier(multiplier: number): void {
    const clamped = Math.max(0.35, Math.min(3.0, multiplier));
    if (Math.abs((this.layoutOptions.sizeMultiplier ?? 1) - clamped) < 1e-4) return;
    this.layoutOptions = { ...this.layoutOptions, sizeMultiplier: clamped };
    if (this.awaitingInitialSolve) return;
    this.requestLayout();
  }

  /** Updates viewport dimensions and recomputes mesh + layout cleanly. */
  setViewport(width: number, height: number): void {
    if (this.awaitingInitialSolve) {
      this.reinitializeViewport(width, height);
      return;
    }
    const w = Math.max(160, Math.round(width));
    const h = Math.max(160, Math.round(height));
    if (w === this.viewportWidth && h === this.viewportHeight) return;
    this.viewportWidth = w;
    this.viewportHeight = h;
    this.requestPipeline('viewport');
  }

  /**
   * Discards any provisional/fallback viewport state and runs a fresh `'initial'`
   * mesh, clustering, and layout solve at the given viewport dimensions (without
   * spring-animating from a previous fallback size).
   */
  reinitializeViewport(width: number, height: number): void {
    if (this.destroyed) return;
    const w = Math.max(160, Math.round(width));
    const h = Math.max(160, Math.round(height));
    this.awaitingInitialSolve = false;
    this.viewportWidth = w;
    this.viewportHeight = h;

    this.currentMesh = null;
    this.previousMesh = null;
    this.previousItems = [];
    this.previousNormalizedItems = [];
    this.lastClusteringOutput = null;
    this.lastPrevClusterSnapshots = [];
    this.currentClusters = [];
    this.currentPlacements = [];
    this.rootMesh = null;
    this.rootClusters = [];
    this.rootPlacements = [];
    this.zoomStack = [];
    this.zoomStepPath = [];
    this.lastSolvedScaleRatios = new Map();
    this.clusterNodes.clear();
    this.itemNodes.clear();
    this.triangleStates = [];
    this.edgeRecords = [];
    this.contextTriangleStates = [];
    this.contextEdgeRecords = [];
    this.contextClusterNodes = [];
    this.contextItemNodes = [];
    this.solvedFrameCache.clear();
    this.activeFlight = null;
    this.nextClusterUidSeq.value = 0;
    this.hoveredContentId = null;
    this.hoveredClusterUid = null;
    this.hoveredContextClusterId = null;
    this.hoveredTriangleIndex = null;
    this.neighborReturnHighlight = null;
    this.camera.reset();

    this.batchPendingPipelineReason = null;
    this.batchPendingRecolor = false;
    this.batchPendingLayout = false;
    this.batchPendingZoomReset = false;
    this.batchPendingRenderNow = false;
    this.recomputePipeline('initial');
  }

  /**
   * Re-measures content & cluster hulls via the renderer adapter and re-solves the
   * current layout frame without re-running clustering or triangulation (e.g. after
   * late webfont loading updates text `getBBox()` metrics).
   */
  relayout(): void {
    if (this.destroyed) return;
    this.visualResolverRevision += 1;
    if (this.awaitingInitialSolve) return;
    this.requestLayout();
  }

  /** Toggles convex hull debug wireframe rendering. */
  setShowHulls(show: boolean): void {
    if (this.showHulls === show) return;
    this.showHulls = show;
    this.dirtyRender = true;
  }

  /** Returns the current empty-cluster visual behavior (`'normal' | 'dim' | 'hide'`). */
  getEmptyClusterBehavior(): EmptyClusterBehavior {
    return this.emptyClusterBehavior;
  }

  /**
   * Configures how clusters with `0` active member items are rendered
   * (`'normal'`, `'dim'`, or `'hide'`).
   */
  setEmptyClusterBehavior(behavior: EmptyClusterBehavior): void {
    if (this.emptyClusterBehavior === behavior) return;
    this.emptyClusterBehavior = behavior;
    if (this.awaitingInitialSolve) return;
    for (const cNode of this.clusterNodes.values()) {
      if (cNode.status !== 'active') continue;
      const targetOpacity =
        behavior === 'hide' && cNode.domain.members.length === 0 ? 0 : 1;
      cNode.opacity.target = targetOpacity;
      if (behavior === 'hide' && cNode.domain.members.length === 0) {
        if (this.hoveredClusterUid === cNode.id) {
          this.hoveredClusterUid = null;
        }
      }
    }
    this.dirtyRender = true;
    this.emitLegendChangeIfNeeded();
    this.renderNow();
  }

  /** Returns the currently active item filter predicate and mode (`'dim' | 'hide'`). */
  getItemFilter(): ItemFilterState<TItem> {
    return {
      predicate: this.itemFilterPredicate,
      mode: this.itemFilterMode,
    };
  }

  /**
   * Filters content items visually and interactively without re-running clustering or layout.
   * All anchors, clusters, and item positions stay 100% frozen across rapid filter changes.
   *
   * - `mode: 'dim'` (default): Softly dims non-matching items cleanly (`interaction.isDimmed = true`).
   * - `mode: 'hide'`: Hides non-matching items (`opacity: 0`, `pointer-events: none`, excluded from `hitTest()`).
   * - Pass `null` as `predicate` to clear the active filter and restore all items.
   */
  setItemFilter(
    predicate: ItemFilterPredicate<TItem> | null,
    options?: ItemFilterOptions,
  ): void {
    const nextMode: ItemFilterMode = options?.mode ?? 'dim';
    const prevMode = this.itemFilterMode;
    const prevHadFilter = this.itemFilterPredicate !== null;
    this.itemFilterPredicate = predicate;
    this.itemFilterMode = nextMode;
    const filteredChanged = this.refreshItemFilterCache();

    if (
      this.focusedItemId !== null &&
      this.itemFilterPredicate !== null &&
      this.itemFilterMode === 'hide' &&
      this.filteredOutItemIds.has(this.focusedItemId)
    ) {
      this.focusedItemId = null;
      this.focusedItemHighlight = false;
    }

    if (
      this.hoveredContentId !== null &&
      this.itemFilterPredicate !== null &&
      this.itemFilterMode === 'hide' &&
      this.filteredOutItemIds.has(this.hoveredContentId)
    ) {
      this.hoveredContentId = null;
      this.interactions.onContentHover?.(null);
    }

    if (this.destroyed || this.awaitingInitialSolve) return;
    if (!filteredChanged && prevMode === nextMode && prevHadFilter === (predicate !== null)) {
      return;
    }
    this.dirtyRender = true;
    this.emitLegendChangeIfNeeded();
    this.renderNow();
  }

  private refreshItemFilterCache(): boolean {
    const predicate = this.itemFilterPredicate;
    if (predicate === null) {
      if (this.filteredOutItemIds.size === 0) return false;
      this.filteredOutItemIds.clear();
      return true;
    }

    const nextFiltered = new Set<string>();
    for (const [id, node] of this.itemNodes) {
      if (!predicate(node.domain.item)) {
        nextFiltered.add(id);
      }
    }

    let changed = nextFiltered.size !== this.filteredOutItemIds.size;
    if (!changed) {
      for (const id of nextFiltered) {
        if (!this.filteredOutItemIds.has(id)) {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      this.filteredOutItemIds.clear();
      for (const id of nextFiltered) {
        this.filteredOutItemIds.add(id);
      }
    }
    return changed;
  }

  /**
   * Sets (or clears) the full canonical item corpus used to seed layout strategies
   * supporting `seedCanonicalLayout` (such as `createFinalSeededLayoutStrategy`).
   */
  setCanonicalSeedItems(items: readonly TItem[] | null): void {
    this.canonicalSeedItems = items ? [...items] : null;
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.layoutStrategy.seedCanonicalLayout) {
      this.requestLayout();
    }
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

  /** Returns the currently pinned item/cluster IDs. */
  getPinnedIds(): ReadonlySet<string> {
    return new Set(this.pinnedIds);
  }

  /** Sets highlighted item IDs for visual emphasis / dimming others (`null` clears highlights). */
  setHighlightedIds(ids: Iterable<string> | null): void {
    this.highlightedIds = ids === null ? new Set() : new Set(ids);
    if (this.highlightedIds.size > 0) {
      this.neighborReturnHighlight = null;
    }
    this.dirtyRender = true;
  }

  /** Returns the currently highlighted item IDs. */
  getHighlightedIds(): ReadonlySet<string> {
    return new Set(this.highlightedIds);
  }

  /** Updates the multi-selection change listener. */
  setOnSelectionChange(cb?: (selectedIds: ReadonlySet<string>) => void): void {
    this.onSelectionChange = cb;
  }

  /**
   * Replaces the active multi-selection set (`null` clears selection).
   * Tracked independently of `highlightedIds` and `pinnedIds`.
   * Emits `onSelectionChange` only when membership actually changes (unless `silent: true`).
   */
  setSelectedIds(
    ids: Iterable<string> | null,
    options?: { readonly silent?: boolean },
  ): void {
    const next = new Set<string>();
    if (ids !== null) {
      for (const raw of ids) {
        const trimmed = raw.trim();
        if (trimmed) next.add(trimmed);
      }
    }
    if (next.size === this.selectedIds.size) {
      let identical = true;
      for (const id of next) {
        if (!this.selectedIds.has(id)) {
          identical = false;
          break;
        }
      }
      if (identical) return;
    }
    this.selectedIds = next;
    this.dirtyRender = true;
    if (!options?.silent) {
      this.onSelectionChange?.(new Set(this.selectedIds));
    }
  }

  /**
   * Toggles a single item ID in the multi-selection set and emits `onSelectionChange`.
   * @returns `true` if the item is now selected, `false` if deselected.
   */
  toggleSelectedId(id: string): boolean {
    const trimmed = id.trim();
    if (!trimmed) return false;
    let nowSelected: boolean;
    if (this.selectedIds.has(trimmed)) {
      this.selectedIds.delete(trimmed);
      nowSelected = false;
    } else {
      this.selectedIds.add(trimmed);
      nowSelected = true;
    }
    this.dirtyRender = true;
    this.onSelectionChange?.(new Set(this.selectedIds));
    return nowSelected;
  }

  /** Clears all currently selected item IDs, emitting `onSelectionChange` if selection was non-empty. */
  clearSelection(): void {
    this.setSelectedIds(null);
  }

  /** Enables or disables built-in `Shift+Click` multi-selection before `onContentClick` / `onLeftClick`. */
  setShiftClickSelects(enabled: boolean): void {
    this.shiftClickSelectsEnabled = enabled;
  }

  /** Returns whether built-in `Shift+Click` multi-selection is currently enabled. */
  getShiftClickSelects(): boolean {
    return this.shiftClickSelectsEnabled;
  }

  /** Returns a snapshot of the currently multi-selected item IDs. */
  getSelectedIds(): ReadonlySet<string> {
    return new Set(this.selectedIds);
  }

  /**
   * Selects active content items intersecting the given world-space axis-aligned rectangle.
   * Excludes exiting nodes and items hidden by an active `itemFilter` (`itemFilterMode: 'hide'`).
   *
   * @returns The resulting `ReadonlySet<string>` of selected item IDs.
   */
  selectItemsInWorldRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string> {
    const x0 = Math.min(minX, maxX);
    const x1 = Math.max(minX, maxX);
    const y0 = Math.min(minY, maxY);
    const y1 = Math.max(minY, maxY);
    const mode = options?.mode ?? 'add';

    const hitIds: string[] = [];
    for (const iNode of this.itemNodes.values()) {
      if (iNode.status === 'exiting') continue;
      if (
        this.itemFilterPredicate !== null &&
        this.itemFilterMode === 'hide' &&
        this.filteredOutItemIds.has(iNode.id)
      ) {
        continue;
      }
      const box = getHullBoundingBox(
        iNode.hull,
        iNode.x.value,
        iNode.y.value,
        Math.max(0.05, iNode.scale.value),
      );
      if (box.maxX >= x0 && box.minX <= x1 && box.maxY >= y0 && box.minY <= y1) {
        hitIds.push(iNode.id);
      }
    }

    const next = mode === 'replace' ? new Set<string>() : new Set<string>(this.selectedIds);
    if (mode === 'toggle') {
      for (const id of hitIds) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
    } else {
      for (const id of hitIds) {
        next.add(id);
      }
    }

    this.setSelectedIds(next);
    return this.getSelectedIds();
  }

  /**
   * Selects active content items intersecting the given screen/SVG-local rectangle,
   * automatically transforming screen coordinates through the active camera.
   *
   * @returns The resulting `ReadonlySet<string>` of selected item IDs.
   */
  selectItemsInScreenRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string> {
    const w1 = this.camera.screenToWorld(x1, y1);
    const w2 = this.camera.screenToWorld(x2, y2);
    return this.selectItemsInWorldRect(w1.x, w1.y, w2.x, w2.y, options);
  }

  /** Returns the currently programmatically focused item ID, or `null`. */
  getFocusedItemId(): string | null {
    return this.focusedItemId;
  }

  /**
   * Programmatically focuses a specific content item (highlighting it and optionally dispatching
   * hover/tooltip callbacks), or clears item focus when passed `null`.
   *
   * Unlike `setHighlightedIds(...)`, programmatic `focusItem(...)` tracks focus independently so
   * hovering or selecting a single item in a linked list/table does not erase an active search highlight set.
   *
   * @returns `true` if `itemId` was active and focused; `false` when clearing (`null`) or if not currently visible.
   */
  focusItem(itemId: string | null, options?: FocusItemOptions): boolean {
    if (itemId === null) {
      const hadFocus = this.focusedItemId !== null;
      this.focusedItemId = null;
      this.focusedItemHighlight = false;
      if (hadFocus) {
        if (options?.hover !== false) {
          this.hoverInteractiveTarget(null);
        }
        this.dirtyRender = true;
      }
      return false;
    }

    const node = this.itemNodes.get(itemId);
    if (
      !node ||
      node.status !== 'active' ||
      (this.itemFilterPredicate !== null &&
        this.itemFilterMode === 'hide' &&
        this.filteredOutItemIds.has(itemId))
    ) {
      return false;
    }

    this.focusedItemId = itemId;
    this.focusedItemHighlight = options?.highlight !== false;
    this.neighborReturnHighlight = null;
    if (options?.hover !== false) {
      this.hoverInteractiveTarget({ kind: 'item', id: itemId });
    }
    this.dirtyRender = true;
    return true;
  }

  /**
   * Programmatically navigates to a specific content item:
   * - In **`free-camera` mode**: centers and zooms the camera smoothly onto the item's solved position.
   * - In **`drill-down` mode**: automatically navigates to the ancestor frame containing the item
   *   (if currently drilled into another branch) and drills down into its covering triangle or cluster
   *   until reaching leaf level (up to `options.maxDrillSteps`, default `4`).
   *
   * Optionally focuses the item afterwards (`options.focus !== false`).
   *
   * @returns `true` if the item was found and navigated to; `false` if missing or hidden by an active `'hide'` filter.
   */
  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean {
    if (this.destroyed || this.awaitingInitialSolve) return false;

    const rawMatch = this.rawItems.find((it) => this.getIdFn(it).trim() === itemId);
    if (
      rawMatch !== undefined &&
      this.itemFilterPredicate !== null &&
      this.itemFilterMode === 'hide' &&
      !this.itemFilterPredicate(rawMatch)
    ) {
      return false;
    }

    if (this.zoomStrategy.mode !== 'drill-down') {
      const node = this.itemNodes.get(itemId);
      if (
        !node ||
        node.status !== 'active' ||
        (this.itemFilterPredicate !== null &&
          this.itemFilterMode === 'hide' &&
          this.filteredOutItemIds.has(itemId))
      ) {
        return false;
      }

      const curCam = this.camera.getState();
      const targetZoom =
        options?.zoom !== undefined && Number.isFinite(options.zoom)
          ? Math.max(0.25, Math.min(6, options.zoom))
          : Math.max(curCam.zoom, 1.85);
      const panX = this.viewportWidth / 2 - node.x.target * targetZoom;
      const panY = this.viewportHeight / 2 - node.y.target * targetZoom;
      this.camera.setState({ zoom: targetZoom, panX, panY });

      if (options?.focus !== false) {
        this.focusItem(itemId, options?.focusOptions);
      }
      this.dirtyRender = true;
      return true;
    }

    // Drill-down mode: ensure item is present in the active frame (walk up stack if needed)
    let activeNode = this.itemNodes.get(itemId);
    if (!activeNode || activeNode.status !== 'active') {
      let ancestorDepth = -1;
      for (let d = this.zoomStack.length - 2; d >= 0; d--) {
        const frame = this.zoomStack[d];
        if (frame && frame.items.some((it) => it.id === itemId)) {
          ancestorDepth = d;
          break;
        }
      }
      if (ancestorDepth < 0) {
        return false;
      }
      this.drillToDepth(ancestorDepth);
      activeNode = this.itemNodes.get(itemId);
      if (!activeNode || activeNode.status !== 'active') {
        return false;
      }
    }

    if (
      this.itemFilterPredicate !== null &&
      this.itemFilterMode === 'hide' &&
      this.filteredOutItemIds.has(itemId)
    ) {
      return false;
    }

    const maxSteps =
      options?.maxDrillSteps !== undefined && Number.isFinite(options.maxDrillSteps)
        ? Math.max(0, Math.floor(options.maxDrillSteps))
        : 4;

    for (let step = 0; step < maxSteps; step++) {
      const node = this.itemNodes.get(itemId);
      if (!node || node.status !== 'active') break;
      const zState = this.currentZoomState;

      if (zState.drillableTriangleIndices.length > 0) {
        const drillableSet = new Set(zState.drillableTriangleIndices);
        const triIdx = resolveContainingTriangleIndexForItem(
          node,
          drillableSet,
          this.triangleStates,
        );
        if (triIdx !== null) {
          const prevDepth = this.zoomStack.length;
          if (this.drillDownTriangle(triIdx)) {
            const afterNode = this.itemNodes.get(itemId);
            if (!afterNode || afterNode.status !== 'active') {
              if (this.zoomStack.length > prevDepth) {
                this.drillUp();
              }
              break;
            }
            continue;
          }
          break;
        }
      }

      if (
        zState.activeFrameKind !== 'triangle-focus' &&
        zState.focusableTriangleIndices.length > 0
      ) {
        const focusableSet = new Set(zState.focusableTriangleIndices);
        const focusTriIdx = resolveContainingTriangleIndexForItem(
          node,
          focusableSet,
          this.triangleStates,
        );
        if (focusTriIdx !== null) {
          const prevDepth = this.zoomStack.length;
          if (this.drillDownTriangle(focusTriIdx)) {
            const afterNode = this.itemNodes.get(itemId);
            if (!afterNode || afterNode.status !== 'active') {
              if (this.zoomStack.length > prevDepth) {
                this.drillUp();
              }
            }
          }
          break;
        }
      }

      if (this.zoomStack.length === 1) {
        const primaryCluster = node.domain.layoutContext.unitClusters[0]?.cluster;
        if (
          primaryCluster &&
          zState.drillableClusterUids.includes(primaryCluster.clusterUid)
        ) {
          const prevDepth = this.zoomStack.length;
          if (this.drillDownCluster(primaryCluster.clusterUid)) {
            const afterNode = this.itemNodes.get(itemId);
            if (!afterNode || afterNode.status !== 'active') {
              if (this.zoomStack.length > prevDepth) {
                this.drillUp();
              }
            }
          }
        }
      }
      break;
    }

    const finalNode = this.itemNodes.get(itemId);
    if (!finalNode || finalNode.status !== 'active') {
      return false;
    }

    if (options?.focus !== false) {
      this.focusItem(itemId, options?.focusOptions);
    }
    this.dirtyRender = true;
    return true;
  }

  /** Returns the currently focused cluster UID, or `null` if none. */
  getFocusedClusterUid(): string | null {
    return this.focusedClusterUid;
  }

  /** Focuses a specific cluster UID (dimming unrelated nodes) or clears focus with `null`. */
  setFocusedClusterUid(clusterUid: string | null): void {
    if (clusterUid !== null) {
      this.neighborReturnHighlight = null;
    }
    this.focusedClusterUid = clusterUid;
    this.dirtyRender = true;
    this.emitLegendChangeIfNeeded();
  }

  /** Returns the currently focused mesh triangle index, or `null` if none. */
  getFocusedTriangleIndex(): number | null {
    return this.focusedTriangleIndex;
  }

  /** Focuses a specific mesh triangle face by index (dimming unrelated faces, clusters, and items) or clears with `null`. */
  setFocusedTriangleIndex(triangleIndex: number | null): void {
    const valid =
      triangleIndex !== null &&
      triangleIndex >= 0 &&
      triangleIndex < this.triangleStates.length
        ? triangleIndex
        : null;
    if (valid !== null) {
      this.neighborReturnHighlight = null;
    }
    if (this.focusedTriangleIndex === valid) return;
    this.focusedTriangleIndex = valid;
    this.dirtyRender = true;
  }

  /**
   * Captures a plain JSON-serializable snapshot of the graph's interactive view state
   * (camera pan/zoom, drill-down path, focus, highlights, multi-selection, and pins).
   */
  getViewState(): SimplexViewState {
    return captureEngineViewState({
      camera: this.camera.getState(),
      zoomStepPath: this.zoomStepPath,
      focusedClusterUid: this.focusedClusterUid,
      focusedTriangleIndex: this.focusedTriangleIndex,
      focusedItemId: this.focusedItemId,
      highlightedIds: this.highlightedIds,
      selectedIds: this.selectedIds,
      pinnedIds: this.pinnedIds,
    });
  }

  /**
   * Restores a previously serialized `SimplexViewState` snapshot (for deep-linking,
   * browser history navigation, or session persistence).
   *
   * Degrades gracefully when the dataset or zoom strategy has changed: stale IDs and
   * unreachable zoom steps are safely skipped without throwing.
   *
   * @returns `true` if a valid state object was applied, `false` if input was invalid or engine is unavailable.
   */
  restoreViewState(
    state: Partial<SimplexViewState> | null | undefined,
    options?: RestoreViewStateOptions,
  ): boolean {
    if (this.destroyed || this.awaitingInitialSolve) return false;
    if (!state || typeof state !== 'object') return false;
    if (state.version !== undefined && state.version !== 1) return false;

    const shouldSnap = !options?.animate || this.reducedMotionActive;
    const prevReducedMotion = this.reducedMotionActive;
    if (shouldSnap) {
      this.reducedMotionActive = true;
    }

    try {
      // 1. Replay drill-down path from root (when specified)
      if (Array.isArray(state.zoomPath)) {
        if (this.zoomStack.length > 1) {
          this.drillToRoot();
        }
        if (this.zoomStrategy.mode === 'drill-down' && state.zoomPath.length > 0) {
          for (const rawStep of state.zoomPath) {
            if (!rawStep || typeof rawStep !== 'object') break;
            if (rawStep.kind === 'triangle') {
              if (
                typeof rawStep.index !== 'number' ||
                !Number.isInteger(rawStep.index) ||
                rawStep.index < 0
              ) {
                break;
              }
              if (!this.drillDownTriangle(rawStep.index)) break;
            } else if (rawStep.kind === 'cluster') {
              const targetCluster = resolveClusterForViewStep(
                this.currentClusters,
                rawStep,
              );
              if (!targetCluster) break;
              if (!this.drillDownCluster(targetCluster.clusterUid)) break;
            } else {
              break;
            }
          }
        }
      }

      // 2. Restore free-camera transform
      if (state.camera && typeof state.camera === 'object') {
        const nextZoom =
          typeof state.camera.zoom === 'number' && Number.isFinite(state.camera.zoom)
            ? state.camera.zoom
            : undefined;
        const nextPanX =
          typeof state.camera.panX === 'number' && Number.isFinite(state.camera.panX)
            ? state.camera.panX
            : undefined;
        const nextPanY =
          typeof state.camera.panY === 'number' && Number.isFinite(state.camera.panY)
            ? state.camera.panY
            : undefined;
        if (nextZoom !== undefined || nextPanX !== undefined || nextPanY !== undefined) {
          const nextCam: Partial<CameraState> = {
            ...(nextZoom !== undefined ? { zoom: nextZoom } : {}),
            ...(nextPanX !== undefined ? { panX: nextPanX } : {}),
            ...(nextPanY !== undefined ? { panY: nextPanY } : {}),
          };
          this.camera.setState(nextCam);
        }
      }

      // Build valid ID lookup sets so stale deep-link IDs degrade cleanly
      const knownItemIds = new Set(
        extractIdentifiedItems(this.rawItems, this.getIdFn).map((it) => it.id),
      );
      const knownClusterUids = new Set<string>();
      for (const c of this.currentClusters) {
        knownClusterUids.add(c.clusterUid);
      }

      // 3. Restore pinned, highlighted, and multi-selected ID sets
      if (Array.isArray(state.pinnedIds)) {
        this.setPinnedIds(
          filterValidStringIds(state.pinnedIds, knownItemIds, knownClusterUids),
        );
      }

      if (Array.isArray(state.highlightedIds)) {
        this.setHighlightedIds(filterValidStringIds(state.highlightedIds, knownItemIds));
      }

      if (Array.isArray(state.selectedIds)) {
        this.setSelectedIds(filterValidStringIds(state.selectedIds, knownItemIds));
      }

      // 4. Restore cluster, triangle, and item focus
      if (state.focusedClusterUid !== undefined) {
        if (
          typeof state.focusedClusterUid === 'string' &&
          knownClusterUids.has(state.focusedClusterUid)
        ) {
          this.setFocusedClusterUid(state.focusedClusterUid);
        } else {
          this.setFocusedClusterUid(null);
        }
      }

      if (state.focusedTriangleIndex !== undefined) {
        if (
          typeof state.focusedTriangleIndex === 'number' &&
          Number.isInteger(state.focusedTriangleIndex)
        ) {
          this.setFocusedTriangleIndex(state.focusedTriangleIndex);
        } else {
          this.setFocusedTriangleIndex(null);
        }
      }

      if (state.focusedItemId !== undefined) {
        this.focusItem(null, { hover: false });
        if (typeof state.focusedItemId === 'string') {
          this.focusItem(state.focusedItemId, { hover: false });
        }
      }

      if (shouldSnap) {
        this.snapAnimationsToTarget();
      } else {
        this.dirtyRender = true;
      }
      this.renderNow();
    } finally {
      this.reducedMotionActive = prevReducedMotion;
    }

    return true;
  }

  /** Forces an immediate frame render using the current snapshot (deferred until batch end when inside `batch()`). */
  renderNow(): void {
    if (this.destroyed || this.awaitingInitialSolve) return;
    if (this.batchDepth > 0) {
      this.batchPendingRenderNow = true;
      this.dirtyRender = true;
      return;
    }
    this.renderer.renderFrame(this.buildFrameSnapshot());
    this.dirtyRender = false;
  }

  private recomputePipeline(reason: PipelineUpdateReason): void {
    this.solvedFrameCache.clear();
    this.neighborReturnHighlight = null;
    const identifiedItems = extractIdentifiedItems(this.rawItems, this.getIdFn);
    const requiresTags = this.clusteringStrategy.requiresTags !== false;
    const effectiveGetTags = this.clusteringStrategy.getTags ?? this.getTagsFn;
    const effectiveNormalizeTag = this.clusteringStrategy.normalizeTag ?? this.normalizeTagFn;
    const normalized = requiresTags
      ? extractNormalizedItems(
          this.rawItems,
          this.getIdFn,
          effectiveGetTags,
          effectiveNormalizeTag,
        )
      : [];

    const activePrevIds = requiresTags
      ? this.previousNormalizedItems.map((it) => it.id)
      : this.previousItems.map((it) => it.id);
    const activeNextIds = requiresTags
      ? normalized.map((it) => it.id)
      : identifiedItems.map((it) => it.id);

    const prevIdSet = new Set(activePrevIds);
    const nextIdSet = new Set(activeNextIds);
    const addedItemIds = new Set<string>();
    for (const id of nextIdSet) {
      if (!prevIdSet.has(id)) addedItemIds.add(id);
    }
    const removedItemIds = new Set<string>();
    for (const id of prevIdSet) {
      if (!nextIdSet.has(id)) removedItemIds.add(id);
    }

    const uniqueTagCount = requiresTags
      ? new Set(normalized.flatMap((n) => n.tags)).size
      : 0;
    const targetClusterCount = this.clusteringStrategy.estimateClusterCount?.({
      items: identifiedItems,
      normalizedItems: normalized,
      itemCount: activeNextIds.length,
      meshOptions: this.meshOptions,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      previousMesh: this.previousMesh,
      reason,
      getId: this.getIdFn,
      getTags: effectiveGetTags,
      normalizeTag: effectiveNormalizeTag,
    });
    const prevMesh = this.currentMesh;
    const mesh = this.meshStrategy.buildMesh({
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      uniqueTagCount,
      itemCount: activeNextIds.length,
      items: identifiedItems,
      normalizedItems: normalized,
      targetClusterCount,
      meshOptions: this.meshOptions,
      previousMesh: this.previousMesh,
      reason,
    });
    this.currentMesh = mesh;

    // Keep oversized explicit-sideLength meshes centered in the viewport without disturbing normal resizes
    if (reason === 'initial') {
      if (mesh.width > this.viewportWidth || mesh.height > this.viewportHeight) {
        const cam = this.camera.getState();
        this.camera.panBy(
          (this.viewportWidth - mesh.width) * 0.5 * cam.zoom,
          (this.viewportHeight - mesh.height) * 0.5 * cam.zoom,
        );
      }
    } else if (
      prevMesh &&
      reason !== 'viewport' &&
      (prevMesh.width !== mesh.width || prevMesh.height !== mesh.height)
    ) {
      const cam = this.camera.getState();
      this.camera.panBy(
        (prevMesh.width - mesh.width) * 0.5 * cam.zoom,
        (prevMesh.height - mesh.height) * 0.5 * cam.zoom,
      );
    }

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
      const memberIds = new Set<string>();
      for (const m of cNode.domain.members) {
        memberIds.add(m.itemId);
      }
      prevClusterSnapshots.push({
        clusterUid: cNode.domain.clusterUid,
        tags,
        coreTags,
        memberIds,
        centroid: cNode.domain.centroid,
        x: cNode.x.value,
        y: cNode.y.value,
        colorHex: cNode.domain.colorHex,
        oklab: cNode.domain.oklab,
      });
    }

    const clusteringCtx: ClusteringStrategyContext<TItem, TTagMeta> = {
      items: identifiedItems,
      previousItems: this.previousItems,
      normalizedItems: normalized,
      previousNormalizedItems: this.previousNormalizedItems,
      addedItemIds,
      removedItemIds,
      mesh,
      previousMesh: this.previousMesh,
      previousClusters: prevClusterSnapshots,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      getId: this.getIdFn,
      getTags: effectiveGetTags,
      normalizeTag: effectiveNormalizeTag,
      formatTagLabel: this.formatTagLabelFn,
      resolveTagMeta: this.resolveTagMetaFn,
      allocateClusterUid: () => {
        this.nextClusterUidSeq.value += 1;
        return `cluster-${this.nextClusterUidSeq.value}`;
      },
      seed: this.layoutOptions.seed ?? 0x51a7c0de,
      reason,
    };

    const clusteringOutput =
      reason === 'initial' ||
      reason === 'strategy' ||
      prevClusterSnapshots.length === 0 ||
      !this.clusteringStrategy.update
        ? this.clusteringStrategy.initialize(clusteringCtx)
        : this.clusteringStrategy.update(clusteringCtx);

    this.lastClusteringOutput = clusteringOutput;
    this.lastPrevClusterSnapshots = prevClusterSnapshots;
    this.previousItems = identifiedItems;
    this.previousNormalizedItems = normalized;
    this.previousMesh = mesh;

    this.applyColorsAndDeriveDescriptors(reason);
    this.rootMesh = mesh;
    this.zoomStack = [this.buildRootZoomFrame()];
    this.zoomStepPath = [];
    if (this.zoomStrategy.mode === 'drill-down') {
      this.camera.reset();
    }

    this.recomputeLayoutAndReconcile(
      reason === 'initial',
      clusteringOutput.uniqueTags.length,
      reason,
    );
  }

  private getFrameCacheKey(
    frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  ): string {
    return frame.frameId === 'root'
      ? 'root'
      : `${this.zoomStrategy.name}::${frame.frameId}`;
  }

  private getFrameItemScaleRatios(
    frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  ): ReadonlyMap<string, number> {
    const cacheKey = this.getFrameCacheKey(frame);
    let solved = this.solvedFrameCache.get(cacheKey);
    if (
      !solved ||
      solved.clusters.length !== frame.clusters.length ||
      solved.items.length !== frame.items.length
    ) {
      const resolvedClusters = frame.clusters.map((cluster) => {
        const visual = this.visualResolver.resolveClusterVisual(cluster);
        const vKey = this.visualResolver.getVisualCacheKey(visual);
        const hull = this.renderer.measureClusterHull(visual, vKey);
        return { cluster, hull };
      });
      const resolvedItems = frame.items.map((itemInput) => {
        const layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta> = {
          id: itemInput.id,
          tags: itemInput.tags,
          mixedColorHex: itemInput.mixedColorHex,
          mixedOklab: itemInput.mixedOklab,
          unitClusters: itemInput.unitWeights.map((uw) => ({
            cluster: frame.clusters[uw.clusterIndex]!,
            weight: uw.weight,
            coverage: uw.coverage,
          })),
          residualDistance: itemInput.residualDistance,
          featureSummary: itemInput.featureSummary,
        };
        const visual = this.visualResolver.resolveContentVisual(
          itemInput.item,
          layoutContext,
        );
        const vKey = this.visualResolver.getVisualCacheKey(visual);
        const hull = this.renderer.measureContentHull(visual, vKey);
        return { itemInput, hull };
      });
      solved = this.layoutStrategy.solve({
        clusters: resolvedClusters.map((rc) => ({
          id: rc.cluster.clusterUid,
          targetX: rc.cluster.gridNode.x,
          targetY: rc.cluster.gridNode.y,
          hull: rc.hull,
        })),
        items: resolvedItems.map((ri) => ({
          id: ri.itemInput.id,
          anchorX: ri.itemInput.anchorX,
          anchorY: ri.itemInput.anchorY,
          hull: ri.hull,
          unitVertexIndices: ri.itemInput.unitWeights.map((uw) => uw.clusterIndex),
        })),
        mesh: frame.mesh,
        viewportWidth: Math.max(this.viewportWidth, frame.mesh.width),
        viewportHeight: Math.max(this.viewportHeight, frame.mesh.height),
        viewportMargin: 8,
        layoutOptions: this.layoutOptions,
        reason: 'initial',
      });
      this.solvedFrameCache.set(cacheKey, solved);
    }

    const sizeMult = Math.max(0.1, this.layoutOptions.sizeMultiplier ?? 1);
    const ratios = new Map<string, number>();
    frame.items.forEach((it, idx) => {
      const placed = solved!.items[idx];
      if (placed) {
        ratios.set(it.id, placed.scale / sizeMult);
      }
    });
    return ratios;
  }

  private createZoomHelpers(
    parentFrame?: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  ): ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta> {
    const innerPadding = Math.max(44, Math.min(72, this.meshOptions.innerPadding ?? 56));
    const rootItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = this.rootPlacements.map(
      (p) => ({
        id: p.id,
        item: p.item,
        anchorX: p.anchorX,
        anchorY: p.anchorY,
        tags: p.layoutContext.tags,
        unitWeights: p.layoutContext.unitClusters.map((uc) => ({
          clusterIndex: uc.cluster.clusterIndex,
          weight: uc.weight,
          coverage: uc.coverage,
        })),
        mixedColorHex: p.layoutContext.mixedColorHex,
        mixedOklab: p.layoutContext.mixedOklab,
        residualDistance: p.layoutContext.residualDistance,
        featureSummary: p.layoutContext.featureSummary,
      }),
    );

    let parentSettledItems:
      | Map<string, { readonly x: number; readonly y: number; readonly scale: number }>
      | undefined;
    if (parentFrame) {
      const cachedParent = this.solvedFrameCache.get(
        this.getFrameCacheKey(parentFrame),
      );
      if (cachedParent) {
        parentSettledItems = new Map();
        for (const placed of cachedParent.items) {
          parentSettledItems.set(placed.id, {
            x: placed.x,
            y: placed.y,
            scale: placed.scale,
          });
        }
      } else if (this.zoomStack[this.zoomStack.length - 1] === parentFrame) {
        parentSettledItems = new Map();
        for (const [id, node] of this.itemNodes) {
          if (node.status === 'active') {
            parentSettledItems.set(id, {
              x: node.x.target,
              y: node.y.target,
              scale: node.scale.target,
            });
          }
        }
      }
    }

    return {
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      innerPadding,
      allocateClusterUid: () => {
        this.nextClusterUidSeq.value += 1;
        return `zcluster-${this.nextClusterUidSeq.value}`;
      },
      deriveClusterMeta: (ctx) =>
        this.deriveClusterMetaFn
          ? this.deriveClusterMetaFn(ctx)
          : (undefined as unknown as TClusterMeta),
      rootClusters: this.rootClusters,
      rootItems,
      normalizedItems: this.previousNormalizedItems,
      corpus: null,
      formatTagLabel: this.formatTagLabelFn,
      parentSettledItems,
    };
  }

  private buildRootZoomFrame(): ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> {
    const mesh = this.rootMesh ?? this.currentMesh!;
    const items: ZoomItemAnchorInput<TItem, TTagMeta>[] = this.rootPlacements.map(
      (p) => ({
        id: p.id,
        item: p.item,
        anchorX: p.anchorX,
        anchorY: p.anchorY,
        tags: p.layoutContext.tags,
        unitWeights: p.layoutContext.unitClusters.map((uc) => ({
          clusterIndex: uc.cluster.clusterIndex,
          weight: uc.weight,
          coverage: uc.coverage,
        })),
        mixedColorHex: p.layoutContext.mixedColorHex,
        mixedOklab: p.layoutContext.mixedOklab,
        residualDistance: p.layoutContext.residualDistance,
        featureSummary: p.layoutContext.featureSummary,
      }),
    );
    return {
      frameId: 'root',
      kind: 'root',
      label: 'Overview',
      shortLabel: 'Overview',
      breadcrumbSegments: [{ label: 'Overview' }],
      mesh,
      clusters: this.rootClusters,
      items,
      neighbors: [],
    };
  }

  private activateZoomFrame(
    frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  ): void {
    this.currentMesh = frame.mesh;
    this.currentClusters = frame.clusters;
    this.currentPlacements = frame.items.map((itemInput) => ({
      id: itemInput.id,
      item: itemInput.item,
      anchorX: itemInput.anchorX,
      anchorY: itemInput.anchorY,
      unitVertexIndices: itemInput.unitWeights.map((uw) => uw.clusterIndex),
      layoutContext: {
        id: itemInput.id,
        tags: itemInput.tags,
        mixedColorHex: itemInput.mixedColorHex,
        mixedOklab: itemInput.mixedOklab,
        unitClusters: itemInput.unitWeights.map((uw) => ({
          cluster: frame.clusters[uw.clusterIndex]!,
          weight: uw.weight,
          coverage: uw.coverage,
        })),
        residualDistance: itemInput.residualDistance,
        featureSummary: itemInput.featureSummary,
      },
    }));
    this.onClustersChange?.(this.currentClusters);
  }

  private refreshZoomState(): void {
    const activeFrame =
      this.zoomStack[this.zoomStack.length - 1] ??
      (this.currentMesh ? this.buildRootZoomFrame() : null);
    if (!activeFrame) return;

    const depth = Math.max(0, this.zoomStack.length - 1);
    const evalResult = this.zoomStrategy.evaluateTargets
      ? this.zoomStrategy.evaluateTargets({
          frame: activeFrame,
          depth,
          itemScaleRatios: this.lastSolvedScaleRatios,
          overlapCount: this.currentMetrics.overlapCount,
        })
      : {
          drillableTriangleIndices: [],
          focusableTriangleIndices: [],
          drillableClusterUids: [],
          isLeafReached: false,
          fullScaleItemRatio: 1,
        };

    const nextState: SimplexZoomState = {
      strategyName: this.zoomStrategy.name,
      mode: this.zoomStrategy.mode,
      depth,
      activeFrameKind: activeFrame.kind,
      canDrillUp: depth > 0,
      isLeafReached: evalResult.isLeafReached,
      fullScaleItemRatio: evalResult.fullScaleItemRatio,
      breadcrumbs: this.zoomStack.map((frame, idx) => ({
        depth: idx,
        frameId: frame.frameId,
        kind: frame.kind,
        label: frame.label,
        shortLabel: frame.shortLabel,
        accentHex: frame.accentHex,
        segments: frame.breadcrumbSegments,
      })),
      neighbors: this.zoomStrategy.mode === 'drill-down' ? activeFrame.neighbors : [],
      drillableTriangleIndices: evalResult.drillableTriangleIndices,
      focusableTriangleIndices: evalResult.focusableTriangleIndices ?? [],
      drillableClusterUids: evalResult.drillableClusterUids,
    };

    this.currentZoomState = nextState;
    this.onZoomStateChange?.(nextState);
  }

  private applyColorsAndDeriveDescriptors(reason: PipelineUpdateReason): void {
    const clusteringOutput = this.lastClusteringOutput;
    const mesh = this.rootMesh ?? this.currentMesh;
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
    this.rootClusters = finalized.clusters as readonly ClusterDescriptor<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];
    this.rootPlacements = finalized.items as readonly ComputedItemPlacement<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];
    this.currentClusters = this.rootClusters;
    this.currentPlacements = this.rootPlacements;
    this.onClustersChange?.(this.currentClusters);
  }

  private ensureCanonicalLayoutSeeded(
    mesh: SimplexMesh,
    reason: PipelineUpdateReason,
  ): void {
    const seedItems = this.canonicalSeedItems;
    if (!seedItems || seedItems.length === 0 || !this.layoutStrategy.seedCanonicalLayout) {
      return;
    }

    const fullIdentified = extractIdentifiedItems(seedItems, this.getIdFn);
    if (fullIdentified.length === 0) return;

    const meshSig = mesh.vertices
      .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
      .join(';');
    const clusterSig = this.currentClusters
      .map((c) => `${c.clusterUid}@${c.clusterIndex}`)
      .join(',');
    const itemIdSig = fullIdentified.map((it) => it.id).join(',');
    const seedSignature = [
      `v${this.visualResolverRevision}`,
      this.theme,
      this.clusteringStrategy.name,
      this.colorStrategy.name,
      `${Math.max(this.viewportWidth, mesh.width)}x${Math.max(this.viewportHeight, mesh.height)}`,
      meshSig,
      clusterSig,
      `sm=${this.layoutOptions.sizeMultiplier ?? 1}`,
      `cg=${this.layoutOptions.clusterGapPx ?? ''}`,
      `ig=${this.layoutOptions.itemGapPx ?? ''}`,
      `ms=${this.layoutOptions.minContentScale ?? ''}`,
      `ri=${this.layoutOptions.relaxationIterations ?? ''}`,
      `sd=${this.layoutOptions.seed ?? ''}`,
      `n=${fullIdentified.length}`,
      itemIdSig,
    ].join('|');

    if (
      this.layoutStrategy.needsCanonicalSeed &&
      !this.layoutStrategy.needsCanonicalSeed(seedSignature)
    ) {
      return;
    }

    const requiresTags = this.clusteringStrategy.requiresTags !== false;
    const effectiveGetTags = this.clusteringStrategy.getTags ?? this.getTagsFn;
    const effectiveNormalizeTag = this.clusteringStrategy.normalizeTag ?? this.normalizeTagFn;
    const fullNormalized = requiresTags
      ? extractNormalizedItems(
          seedItems,
          this.getIdFn,
          effectiveGetTags,
          effectiveNormalizeTag,
        )
      : [];

    const currentClusterSnapshots: PreviousClusterSnapshot[] = this.currentClusters.map(
      (c) => {
        const tags = new Set<string>();
        const coreTags = new Set<string>();
        for (const t of c.coreTags) {
          tags.add(t.tag);
          coreTags.add(t.tag);
        }
        for (const t of c.sharedTags) tags.add(t.tag);
        const memberIds = new Set<string>();
        for (const m of c.members) {
          memberIds.add(m.itemId);
        }
        return {
          clusterUid: c.clusterUid,
          tags,
          coreTags,
          memberIds,
          centroid: c.centroid,
          x: c.gridNode.x,
          y: c.gridNode.y,
          colorHex: c.colorHex,
          oklab: c.oklab,
        };
      },
    );

    let seedUidSeq = 0;
    const fullClusteringOutput = this.clusteringStrategy.initialize({
      items: fullIdentified,
      previousItems: [],
      normalizedItems: fullNormalized,
      previousNormalizedItems: [],
      addedItemIds: new Set(fullIdentified.map((it) => it.id)),
      removedItemIds: new Set<string>(),
      mesh,
      previousMesh: null,
      previousClusters: currentClusterSnapshots,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      getId: this.getIdFn,
      getTags: effectiveGetTags,
      normalizeTag: effectiveNormalizeTag,
      formatTagLabel: this.formatTagLabelFn,
      resolveTagMeta: this.resolveTagMetaFn,
      allocateClusterUid: () => {
        seedUidSeq += 1;
        return `seed-cluster-${seedUidSeq}`;
      },
      seed: this.layoutOptions.seed ?? 0x51a7c0de,
      reason: 'initial',
    });

    const fullFinalized = finalizeClusteringWithColors<TItem, TTagMeta, TClusterMeta>({
      clusteringOutput: fullClusteringOutput,
      mesh,
      colorStrategy: this.colorStrategy,
      theme: this.theme,
      previousTheme: this.theme,
      previousClusters: currentClusterSnapshots,
      reason: 'initial',
      seed: this.layoutOptions.seed ?? 0x51a7c0de,
      deriveClusterMeta: this.deriveClusterMetaFn,
    });

    const seedClusters = fullFinalized.clusters as readonly ClusterDescriptor<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];
    const seedPlacements = fullFinalized.items as readonly ComputedItemPlacement<
      TItem,
      TTagMeta,
      TClusterMeta
    >[];

    const resolvedSeedClusters = seedClusters.map((cluster) => {
      const visual = this.visualResolver.resolveClusterVisual(cluster);
      const cacheKey = this.visualResolver.getVisualCacheKey(visual);
      const hull = this.renderer.measureClusterHull(visual, cacheKey);
      return {
        id: cluster.clusterUid,
        targetX: cluster.gridNode.x,
        targetY: cluster.gridNode.y,
        hull,
      };
    });

    const resolvedSeedItems = seedPlacements.map((placement) => {
      const visual = this.visualResolver.resolveContentVisual(
        placement.item,
        placement.layoutContext,
      );
      const cacheKey = this.visualResolver.getVisualCacheKey(visual);
      const hull = this.renderer.measureContentHull(visual, cacheKey);
      return {
        id: placement.id,
        anchorX: placement.anchorX,
        anchorY: placement.anchorY,
        hull,
        unitVertexIndices: placement.layoutContext.unitClusters.map(
          (uc) => uc.cluster.clusterIndex,
        ),
      };
    });

    this.layoutStrategy.seedCanonicalLayout(
      {
        clusters: resolvedSeedClusters,
        items: resolvedSeedItems,
        mesh,
        viewportWidth: Math.max(this.viewportWidth, mesh.width),
        viewportHeight: Math.max(this.viewportHeight, mesh.height),
        viewportMargin: 8,
        layoutOptions: this.layoutOptions,
        reason: reason === 'viewport' ? 'viewport' : 'initial',
      },
      seedSignature,
    );
  }

  private recomputeLayoutOnly(reason: PipelineUpdateReason = 'strategy'): void {
    this.solvedFrameCache.clear();
    this.recomputeLayoutAndReconcile(false, this.currentMetrics.tagCount, reason);
  }

  private recomputeLayoutAndReconcile(
    isInitial: boolean,
    tagCount: number,
    reason: PipelineUpdateReason,
    drillFlight?: DrillTransitionSpec<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    const mesh = this.currentMesh;
    if (!mesh) return;

    if (!drillFlight) {
      this.activeFlight = null;
    }

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

    const stackFrame = this.zoomStack[this.zoomStack.length - 1];
    const frameCacheKey = stackFrame ? this.getFrameCacheKey(stackFrame) : null;
    const cachedSolved = frameCacheKey
      ? this.solvedFrameCache.get(frameCacheKey)
      : undefined;

    let solved: TwoPhaseLayoutResult;
    if (
      cachedSolved &&
      cachedSolved.clusters.length === resolvedClusters.length &&
      cachedSolved.items.length === resolvedItems.length
    ) {
      solved = cachedSolved;
    } else {
      let previousClusterPositions: Map<string, PreviousNodeLayout> | undefined;
      let previousItemPositions: Map<string, PreviousNodeLayout> | undefined;
      if (!drillFlight) {
        previousClusterPositions = new Map<string, PreviousNodeLayout>();
        for (const [uid, cNode] of this.clusterNodes) {
          if (cNode.status === 'active') {
            previousClusterPositions.set(uid, {
              x: cNode.x.target,
              y: cNode.y.target,
              scale: cNode.scale.target,
            });
          }
        }
        previousItemPositions = new Map<string, PreviousNodeLayout>();
        for (const [id, iNode] of this.itemNodes) {
          if (iNode.status === 'active') {
            previousItemPositions.set(id, {
              x: iNode.x.target,
              y: iNode.y.target,
              scale: iNode.scale.target,
            });
          }
        }
      }

      // 1b. Seed canonical full-corpus layout when a final-seeded layout strategy is active at root level
      if (
        !drillFlight &&
        this.zoomStack.length <= 1 &&
        this.canonicalSeedItems &&
        this.canonicalSeedItems.length > 0 &&
        this.layoutStrategy.seedCanonicalLayout
      ) {
        this.ensureCanonicalLayoutSeeded(mesh, reason);
      }

      // 2. Solve strictly overlap-free layout via active SimplexLayoutStrategy
      solved = this.layoutStrategy.solve({
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
          unitVertexIndices: ri.placement.layoutContext.unitClusters.map(
            (uc) => uc.cluster.clusterIndex,
          ),
        })),
        mesh,
        viewportWidth: Math.max(this.viewportWidth, mesh.width),
        viewportHeight: Math.max(this.viewportHeight, mesh.height),
        viewportMargin: 8,
        layoutOptions: this.layoutOptions,
        previousClusterPositions,
        previousItemPositions,
        reason: drillFlight ? 'initial' : reason,
      });

      if (frameCacheKey) {
        this.solvedFrameCache.set(frameCacheKey, solved);
      }
    }

    const activeZoomFrame =
      this.zoomStrategy.mode === 'drill-down'
        ? this.zoomStack[this.zoomStack.length - 1]
        : undefined;

    const snapImmediately = isInitial || this.reducedMotionActive;
    const effectiveDrillFlight = this.reducedMotionActive ? undefined : drillFlight;

    // 3. Reconcile triangle background OKLab tints, centroids, and density counts
    const reconciledMesh = buildAnimatedTrianglesAndEdges({
      mesh,
      currentClusters: this.currentClusters,
      currentPlacements: this.currentPlacements,
      previousTriangles: this.triangleStates,
      snapColorImmediately: snapImmediately || Boolean(effectiveDrillFlight),
    });
    this.triangleStates = reconciledMesh.triangleStates;
    this.edgeRecords = reconciledMesh.edgeRecords;

    const reconciledContext = buildContextElements({
      activeZoomFrame,
      solved,
      sizeMultiplier: this.layoutOptions.sizeMultiplier,
      visualResolver: this.visualResolver,
      renderer: this.renderer,
    });
    this.contextTriangleStates = reconciledContext.contextTriangleStates;
    this.contextEdgeRecords = reconciledContext.contextEdgeRecords;
    this.contextClusterNodes = reconciledContext.contextClusterNodes;
    this.contextItemNodes = reconciledContext.contextItemNodes;

    // 4. Reconcile cluster & item nodes (either continuous drill flight OR normal springs)
    if (effectiveDrillFlight) {
      this.activeFlight = buildZoomFlightState({
        drillFlight: effectiveDrillFlight,
        viewportWidth: this.viewportWidth,
        viewportHeight: this.viewportHeight,
        solved,
        resolvedClusters,
        resolvedItems,
        activeZoomFrame,
        clusterNodes: this.clusterNodes,
        itemNodes: this.itemNodes,
        contextClusterNodes: this.contextClusterNodes,
        contextItemNodes: this.contextItemNodes,
      });
      this.syncActiveFlightState(0);
    } else {
      this.activeFlight = null;
      reconcileSpringNodes({
        resolvedClusters,
        resolvedItems,
        solved,
        snapImmediately,
        emptyClusterBehavior: this.emptyClusterBehavior,
        activeZoomFrame,
        clusterNodes: this.clusterNodes,
        itemNodes: this.itemNodes,
      });
    }

    this.refreshItemFilterCache();
    if (
      this.hoveredContentId !== null &&
      this.itemFilterPredicate !== null &&
      this.itemFilterMode === 'hide' &&
      this.filteredOutItemIds.has(this.hoveredContentId)
    ) {
      this.hoveredContentId = null;
      this.interactions.onContentHover?.(null);
    }

    if (
      this.hoveredTriangleIndex !== null &&
      (this.hoveredTriangleIndex < 0
        ? -this.hoveredTriangleIndex - 1 >= this.contextTriangleStates.length
        : this.hoveredTriangleIndex >= this.triangleStates.length)
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

    const sizeMult = Math.max(0.1, this.layoutOptions.sizeMultiplier ?? 1);
    const scaleRatios = new Map<string, number>();
    resolvedItems.forEach((ri, idx) => {
      const placed = solved.items[idx];
      if (placed) {
        scaleRatios.set(ri.placement.id, placed.scale / sizeMult);
      }
    });
    this.lastSolvedScaleRatios = scaleRatios;

    this.currentMetrics = {
      clusterCount: this.currentClusters.length,
      itemCount: this.currentPlacements.length,
      tagCount,
      clusterScale: solved.clusterScale,
      contentScale: solved.contentScale,
      overlapCount: solved.overlapCount,
      maxPenetrationPx: solved.maxPenetrationPx,
      isSettled: snapImmediately && !this.activeFlight,
      meshSideLength: mesh.sideLength,
      areaEfficiency: mesh.areaEfficiency,
    };
    this.onMetricsChange?.(this.currentMetrics);
    this.refreshZoomState();
    this.emitLegendChangeIfNeeded();
    this.dirtyRender = true;

    if (snapImmediately || drillFlight) {
      this.renderNow();
    }
  }

  private syncActiveFlightState(rawProgress: number): void {
    if (!this.activeFlight) return;
    syncFlightState(this.activeFlight, rawProgress, {
      triangleStates: this.triangleStates,
      contextTriangleStates: this.contextTriangleStates,
      edgeRecords: this.edgeRecords,
      contextEdgeRecords: this.contextEdgeRecords,
      contextClusterNodes: this.contextClusterNodes,
      contextItemNodes: this.contextItemNodes,
      clusterNodes: this.clusterNodes,
      itemNodes: this.itemNodes,
    });
  }

  /**
   * Advances spring animations, continuous zoom flights, and dual-layer transitions by `dtMs`
   * milliseconds, rendering a frame if anything moved or changed. Returns `true` when fully settled.
   */
  step(dtMs: number): boolean {
    if (this.destroyed || this.awaitingInitialSolve) return true;
    if (this.reducedMotionActive) {
      if (this.activeFlight || !this.currentMetrics.isSettled || this.dirtyRender) {
        this.snapAnimationsToTarget();
      }
      return true;
    }
    const dtSec = Math.min(0.05, Math.max(0.001, dtMs / 1000));
    let allSettled = true;

    if (this.activeFlight) {
      const nextRaw = Math.min(
        1,
        this.activeFlight.rawProgress +
          dtSec / Math.max(0.1, this.activeFlight.durationSec),
      );
      this.activeFlight.rawProgress = nextRaw;

      for (const node of this.clusterNodes.values()) {
        if (node.transition) {
          const nextT = stepVisualTransition(node.transition, dtSec);
          node.transition = nextT.transition;
          if (nextT.transition !== null) allSettled = false;
        }
      }
      for (const node of this.itemNodes.values()) {
        if (node.transition) {
          const nextT = stepVisualTransition(node.transition, dtSec);
          node.transition = nextT.transition;
          if (nextT.transition !== null) allSettled = false;
        }
      }

      if (nextRaw >= 1) {
        this.syncActiveFlightState(1);
        this.activeFlight = null;
        this.dirtyRender = true;
      } else {
        this.syncActiveFlightState(nextRaw);
        allSettled = false;
      }
    } else {
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

  private buildFrameSnapshot(): SceneFrameSnapshot<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  > {
    return buildSceneFrameSnapshot({
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      camera: this.camera.getState(),
      showHulls: this.showHulls,
      zoomMode: this.zoomStrategy.mode,
      zoomStack: this.zoomStack,
      currentZoomState: this.currentZoomState,
      currentClusters: this.currentClusters,
      triangleStates: this.triangleStates,
      edgeRecords: this.edgeRecords,
      contextTriangleStates: this.contextTriangleStates,
      contextEdgeRecords: this.contextEdgeRecords,
      contextClusterNodes: this.contextClusterNodes,
      contextItemNodes: this.contextItemNodes,
      clusterNodes: this.clusterNodes,
      itemNodes: this.itemNodes,
      activeFlight: this.activeFlight,
      neighborReturnHighlight: this.neighborReturnHighlight,
      focusedItemId: this.focusedItemId,
      focusedItemHighlight: this.focusedItemHighlight,
      focusedClusterUid: this.focusedClusterUid,
      focusedTriangleIndex: this.focusedTriangleIndex,
      hoveredTriangleIndex: this.hoveredTriangleIndex,
      hoveredClusterUid: this.hoveredClusterUid,
      hoveredContextClusterId: this.hoveredContextClusterId,
      hoveredContentId: this.hoveredContentId,
      pinnedIds: this.pinnedIds,
      highlightedIds: this.highlightedIds,
      selectedIds: this.selectedIds,
      emptyClusterBehavior: this.emptyClusterBehavior,
      itemFilterPredicate: this.itemFilterPredicate,
      itemFilterMode: this.itemFilterMode,
      filteredOutItemIds: this.filteredOutItemIds,
    });
  }

  private getHitTestContext(): SceneHitTestContext<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return {
      camera: this.camera,
      zoomMode: this.zoomStrategy.mode,
      zoomStack: this.zoomStack,
      currentZoomState: this.currentZoomState,
      currentClusters: this.currentClusters,
      triangleStates: this.triangleStates,
      contextTriangleStates: this.contextTriangleStates,
      contextClusterNodes: this.contextClusterNodes,
      contextItemNodes: this.contextItemNodes,
      clusterNodes: this.clusterNodes,
      itemNodes: this.itemNodes,
      focusedClusterUid: this.focusedClusterUid,
      focusedTriangleIndex: this.focusedTriangleIndex,
      hoveredTriangleIndex: this.hoveredTriangleIndex,
      neighborReturnHighlight: this.neighborReturnHighlight,
      emptyClusterBehavior: this.emptyClusterBehavior,
      itemFilterPredicate: this.itemFilterPredicate,
      itemFilterMode: this.itemFilterMode,
      filteredOutItemIds: this.filteredOutItemIds,
      hasActiveFlight: this.activeFlight !== null,
    };
  }

  /**
   * Mathematical convex-hull hit-testing in world coordinates.
   * Checks active items first (topmost draw order, passing through items inside drillable triangles
   * when in `drill-down` mode), then clusters, then triangle faces, else background.
   */
  hitTest(
    screenX: number,
    screenY: number,
  ): HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> {
    return hitTestScene(this.getHitTestContext(), screenX, screenY);
  }

  /** Returns the active cluster descriptor for a given cluster UID, if currently mounted. */
  getClusterByUid(
    clusterUid: string,
  ): ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined {
    const active = this.clusterNodes.get(clusterUid);
    if (active && active.status === 'active') {
      return active.domain;
    }
    return this.currentClusters.find((c) => c.clusterUid === clusterUid);
  }

  /** Returns the active item and layout context for a given item ID, if currently mounted. */
  getItemLayoutById(
    itemId: string,
  ):
    | {
        readonly item: TItem;
        readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
      }
    | undefined {
    const active = this.itemNodes.get(itemId);
    if (active && active.status === 'active') {
      return {
        item: active.domain.item,
        layoutContext: active.domain.layoutContext,
      };
    }
    const placement = this.currentPlacements.find((p) => p.layoutContext.id === itemId);
    return placement
      ? { item: placement.item, layoutContext: placement.layoutContext }
      : undefined;
  }

  /**
   * Returns the deterministic ordered list of currently visible, interactive scene targets
   * (active topic clusters, drillable/focusable mesh triangles in drill-down mode, and
   * visible non-pass-through content items) for keyboard traversal and screen-reader navigation.
   */
  getInteractiveTargets(): readonly SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] {
    return getInteractiveTargetsFromScene(this.getHitTestContext());
  }

  private resolveHitTargetForInteractiveTarget(
    target: SimplexKeyboardFocusTarget,
  ): HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> | null {
    return resolveHitTargetForInteractiveTargetFromScene(
      this.getHitTestContext(),
      target,
    );
  }

  private dispatchHoverForHitTarget(
    target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
  ): void {
    if (target.kind === 'content') {
      if (this.hoveredClusterUid !== null || this.hoveredContextClusterId !== null) {
        this.hoveredClusterUid = null;
        this.hoveredContextClusterId = null;
        this.interactions.onClusterHover?.(null);
      }
      if (this.hoveredTriangleIndex !== null) {
        this.hoveredTriangleIndex = null;
        this.interactions.onTriangleHover?.(null);
      }
      this.hoveredContentId = target.layoutContext.id;
      this.dirtyRender = true;
      this.interactions.onContentHover?.({
        item: target.item,
        layoutContext: target.layoutContext,
        visual: target.visual,
        screenPosition: target.screenPosition,
        worldPosition: target.worldPosition,
        isContext: target.isContext,
        neighborId: target.neighborId,
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
      const matchedCtx = this.contextClusterNodes.find(
        (cc) => cc.cluster.clusterUid === nextUid,
      );
      if (matchedCtx) {
        this.hoveredClusterUid = null;
        this.hoveredContextClusterId = matchedCtx.id;
      } else {
        this.hoveredClusterUid = nextUid;
        this.hoveredContextClusterId = null;
      }
      this.dirtyRender = true;
      this.interactions.onClusterHover?.({
        cluster: target.cluster,
        visual: target.visual,
        screenPosition: target.screenPosition,
        worldPosition: target.worldPosition,
        neighborId: target.neighborId,
      });
    } else if (target.kind === 'triangle') {
      if (this.hoveredContentId !== null) {
        this.hoveredContentId = null;
        this.interactions.onContentHover?.(null);
      }
      if (this.hoveredClusterUid !== null || this.hoveredContextClusterId !== null) {
        this.hoveredClusterUid = null;
        this.hoveredContextClusterId = null;
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
      if (this.hoveredClusterUid !== null || this.hoveredContextClusterId !== null) {
        this.hoveredClusterUid = null;
        this.hoveredContextClusterId = null;
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

  private dispatchLeftClickForHitTarget(
    target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
    raw: Omit<NormalizedPointerEvent, 'worldX' | 'worldY'>,
  ): boolean {
    const fullEvent: NormalizedPointerEvent = {
      ...raw,
      worldX: target.worldPosition.x,
      worldY: target.worldPosition.y,
    };
    if (
      this.shiftClickSelectsEnabled &&
      target.kind === 'content' &&
      !target.neighborId &&
      fullEvent.shiftKey
    ) {
      this.toggleSelectedId(target.layoutContext.id);
      return true;
    }
    if (target.kind === 'content' && !target.neighborId) {
      if (this.interactions.onContentClick?.(target, fullEvent) === true) {
        return true;
      }
    } else if (target.kind === 'cluster') {
      if (this.interactions.onClusterClick?.(target, fullEvent) === true) {
        return true;
      }
    } else if (target.kind === 'triangle') {
      if (this.interactions.onTriangleClick?.(target, fullEvent) === true) {
        return true;
      }
    } else if (target.kind === 'background') {
      if (this.interactions.onBackgroundClick?.(fullEvent) === true) {
        return true;
      }
    }
    return this.interactions.onLeftClick?.(target, fullEvent) === true;
  }

  /**
   * Programmatically applies hover state and invokes hover callbacks (including tooltip triggers)
   * for a specific keyboard-focused scene target, or clears hover state when `null`.
   */
  hoverInteractiveTarget(target: SimplexKeyboardFocusTarget | null): boolean {
    if (target === null) {
      this.handlePointerLeave();
      return false;
    }
    const hitTarget = this.resolveHitTargetForInteractiveTarget(target);
    if (!hitTarget) {
      this.handlePointerLeave();
      return false;
    }
    this.dispatchHoverForHitTarget(hitTarget);
    return true;
  }

  /**
   * Programmatically activates a specific keyboard-focused scene target through the exact same
   * click/drill-down/focus interaction pipeline as `handleLeftClick`.
   */
  activateInteractiveTarget(
    target: SimplexKeyboardFocusTarget,
    modifiers?: Partial<
      Pick<NormalizedPointerEvent, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>
    >,
  ): boolean {
    const hitTarget = this.resolveHitTargetForInteractiveTarget(target);
    if (!hitTarget) return false;
    if (this.neighborReturnHighlight !== null) {
      this.neighborReturnHighlight = null;
      this.dirtyRender = true;
    }
    return this.dispatchLeftClickForHitTarget(hitTarget, {
      screenX: hitTarget.screenPosition.x,
      screenY: hitTarget.screenPosition.y,
      button: 0,
      shiftKey: Boolean(modifiers?.shiftKey),
      ctrlKey: Boolean(modifiers?.ctrlKey),
      altKey: Boolean(modifiers?.altKey),
      metaKey: Boolean(modifiers?.metaKey),
    });
  }

  /** Processes pointer movement for centralized hover detection. */
  handlePointerMove(screenX: number, screenY: number): void {
    const target = this.hitTest(screenX, screenY);
    this.dispatchHoverForHitTarget(target);
  }

  /** Clears active hover state when pointer exits the canvas/SVG surface. */
  handlePointerLeave(): void {
    if (this.hoveredContentId !== null) {
      this.hoveredContentId = null;
      this.dirtyRender = true;
      this.interactions.onContentHover?.(null);
    }
    if (this.hoveredClusterUid !== null || this.hoveredContextClusterId !== null) {
      this.hoveredClusterUid = null;
      this.hoveredContextClusterId = null;
      this.dirtyRender = true;
      this.interactions.onClusterHover?.(null);
    }
    if (this.hoveredTriangleIndex !== null) {
      this.hoveredTriangleIndex = null;
      this.dirtyRender = true;
      this.interactions.onTriangleHover?.(null);
    }
  }

  /**
   * Dispatches left-click interaction using mathematical convex-hull hit-testing.
   * When `shiftClickSelects` is enabled (default `true`), `Shift+Click` on active content nodes
   * toggles multi-selection before invoking `onContentClick` / `onLeftClick`.
   * Otherwise runs target-specific handlers (`onContentClick`, `onClusterClick`, `onTriangleClick`,
   * `onBackgroundClick`) first, then `onLeftClick` unless consumed (`return true`).
   * Returns `true` when any handler consumed the click.
   */
  handleLeftClick(raw: Omit<NormalizedPointerEvent, 'worldX' | 'worldY'>): boolean {
    if (this.neighborReturnHighlight !== null) {
      this.neighborReturnHighlight = null;
      this.dirtyRender = true;
    }
    const target = this.hitTest(raw.screenX, raw.screenY);
    return this.dispatchLeftClickForHitTarget(target, raw);
  }

  /**
   * Dispatches right-click interaction using mathematical convex-hull hit-testing.
   * Returns `true` when the handler wants to suppress the browser's default context menu.
   */
  handleRightClick(raw: Omit<NormalizedPointerEvent, 'worldX' | 'worldY'>): boolean {
    if (this.neighborReturnHighlight !== null) {
      this.neighborReturnHighlight = null;
      this.dirtyRender = true;
    }
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
    if (this.zoomStrategy.mode === 'drill-down') {
      return false;
    }
    const policy = this.interactions.onWheel ?? 'zoom-to-cursor';
    if (policy === 'none') return false;
    if (typeof policy === 'function') {
      const consumed = policy(event, this.camera);
      if (consumed === true) {
        return true;
      }
    }
    if (policy === 'pan-vertical') {
      this.camera.panBy(-event.deltaX, -event.deltaY);
      return true;
    }
    // Default (or composable custom wheel callback): 'zoom-to-cursor'
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
