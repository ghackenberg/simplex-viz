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
  extractIdentifiedItems,
  extractNormalizedItems,
  type ComputedItemPlacement,
  type NormalizedContentItem,
  type PreviousClusterSnapshot,
} from './clustering';
import { hitTestConvexGeometry, isPointInTriangle } from './geometry';
import type { TwoPhaseLayoutResult } from './layout';
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
  ContentLayoutContext,
  ConvexGeometry,
  DefaultTaggedItem,
  HitTarget,
  IdentifiedItem,
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
import {
  IDENTITY_ZOOM_AFFINE,
  applyZoomAffine,
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
} from './zoom';

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
  readonly targetPoints: readonly [Point2D, Point2D, Point2D];
  points: [Point2D, Point2D, Point2D];
  centroid: Point2D;
  readonly coveredItemCount: number;
  readonly interiorItemCount: number;
  currentOklab: [number, number, number];
  targetOklab: OklabTuple;
  fillHex: string;
  flightOpacity?: number;
}

interface AnimatedEdgeRecord {
  readonly index: number;
  readonly vertexIndices: readonly [number, number];
  readonly targetA: Point2D;
  readonly targetB: Point2D;
  a: Point2D;
  b: Point2D;
  readonly mixedColorHex: string;
  flightOpacity?: number;
}

interface AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly targetPoints: readonly [Point2D, Point2D, Point2D];
  points: [Point2D, Point2D, Point2D];
  centroid: Point2D;
  opacity: number;
}

interface AnimatedContextEdgeRecord<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly targetA: Point2D;
  readonly targetB: Point2D;
  a: Point2D;
  b: Point2D;
  opacity: number;
}

interface AnimatedContextClusterRecord<
  TItem,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly id: string;
  readonly neighborId?: string;
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TClusterVisual;
  readonly cacheKey: string;
  readonly hull: ConvexGeometry;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetScale: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

interface AnimatedContextItemRecord<
  TItem,
  TContentVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly id: string;
  readonly rawId: string;
  readonly neighborId?: string;
  readonly item: TItem;
  readonly layoutContext: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
  readonly visual: TContentVisual;
  readonly cacheKey: string;
  readonly hull: ConvexGeometry;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetScale: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

interface ActiveNodeFlightEndpoint {
  readonly localStart: Point2D;
  readonly localEnd: Point2D;
  readonly localStartScale: number;
  readonly targetScale: number;
  readonly startOpacity: number;
  readonly targetOpacity: number;
  readonly isNewlyEntering: boolean;
}

interface FlightDepartingTriangle<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly localPoints: readonly [Point2D, Point2D, Point2D];
  readonly startOpacity: number;
}

interface FlightDepartingEdge<TItem, TTagMeta, TClusterMeta> {
  readonly base: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly localA: Point2D;
  readonly localB: Point2D;
  readonly startOpacity: number;
}

interface FlightDepartingCluster<
  TItem,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly id: string;
  readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
  readonly localStart: Point2D;
  readonly localStartScale: number;
  readonly localEndScale: number;
  readonly startOpacity: number;
  readonly visual: TClusterVisual;
  readonly hull: ConvexGeometry;
  readonly cacheKey: string;
}

interface FlightDepartingItem<TContentVisual> {
  readonly rawId: string;
  readonly id: string;
  readonly localStart: Point2D;
  readonly localStartScale: number;
  readonly localEndScale: number;
  readonly startOpacity: number;
  readonly visual: TContentVisual;
  readonly hull: ConvexGeometry;
  readonly cacheKey: string;
}

interface ZoomFlightState<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  rawProgress: number;
  readonly durationSec: number;
  readonly flightTransform: ZoomAffineTransform;
  readonly invFlight: ZoomAffineTransform;
  readonly departingTriangles: readonly FlightDepartingTriangle<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly departingEdges: readonly FlightDepartingEdge<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly departingClusters: readonly FlightDepartingCluster<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly departingItems: readonly FlightDepartingItem<TContentVisual>[];
  readonly clusterEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
  readonly contextClusterEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
  readonly itemEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
  readonly contextItemEndpoints: ReadonlyMap<string, ActiveNodeFlightEndpoint>;
}

interface DrillTransitionSpec<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly snapshot: SceneFrameSnapshot<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  readonly clusterDomainByNodeId: ReadonlyMap<
    string,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
  >;
  readonly flightTransform: ZoomAffineTransform;
  readonly invFlight: ZoomAffineTransform;
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
  private zoomStrategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
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
      },
    ],
    neighbors: [],
    drillableTriangleIndices: [],
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
    this.zoomStrategy =
      config.zoomStrategy ??
      createFreeCameraZoomStrategy<TItem, TTagMeta, TClusterMeta>();
    this.theme = config.theme ?? 'dark';
    this.showHulls = config.showHulls ?? false;
    this.interactions = config.interactions ?? {};
    this.onMetricsChange = config.onMetricsChange;
    this.onClustersChange = config.onClustersChange;
    this.onZoomStateChange = config.onZoomStateChange;

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
    if (this.lastClusteringOutput && this.rootMesh) {
      this.solvedFrameCache.clear();
      this.currentMesh = this.rootMesh;
      this.applyColorsAndDeriveDescriptors('strategy');
      this.zoomStack = [this.buildRootZoomFrame()];
      this.recomputeLayoutAndReconcile(false, this.currentMetrics.tagCount, 'strategy');
    }
  }

  /** Swaps the node positioning & scaling layout strategy at runtime and re-solves cleanly. */
  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    this.layoutStrategy = strategy;
    this.recomputeLayoutOnly('strategy');
  }

  /** Swaps the zoom / drill-down strategy at runtime (resetting any open drill stack cleanly). */
  setZoomStrategy(
    strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>,
  ): void {
    this.zoomStrategy = strategy;
    if (strategy.mode === 'drill-down') {
      this.camera.reset();
    }
    const rootFrame = this.zoomStack[0];
    if (this.zoomStack.length > 1 && rootFrame) {
      this.executeDrillTransition([rootFrame]);
    } else {
      this.refreshZoomState();
      this.dirtyRender = true;
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

    const outcome = this.zoomStrategy.drillIntoTriangle({
      triangleIndex,
      parentFrame,
      parentDepth: this.zoomStack.length - 1,
      itemScaleRatios: this.lastSolvedScaleRatios,
      helpers: this.createZoomHelpers(parentFrame),
    });
    if (!outcome) return false;

    this.executeDrillTransition([...this.zoomStack, outcome.nextFrame]);
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

    const outcome = this.zoomStrategy.drillIntoCluster({
      clusterUid,
      clusterIndex,
      parentFrame,
      parentDepth: this.zoomStack.length - 1,
      itemScaleRatios: this.lastSolvedScaleRatios,
      helpers: this.createZoomHelpers(parentFrame),
    });
    if (!outcome) return false;

    this.executeDrillTransition([...this.zoomStack, outcome.nextFrame]);
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

    if (localTarget === 'frame') {
      this.executeDrillTransition(this.zoomStack.slice(0, ancestorDepth + 1));
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
      this.executeDrillTransition([
        ...this.zoomStack.slice(0, ancestorDepth + 1),
        outcome.nextFrame,
      ]);
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
        this.executeDrillTransition(this.zoomStack.slice(0, ancestorDepth + 1), {
          kind: 'triangle',
          triangleIndex: triIdx,
        });
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

    this.executeDrillTransition(this.zoomStack.slice(0, targetDepth + 1));
    return true;
  }

  /** Returns immediately to the root overview (`depth === 0`). */
  drillToRoot(): boolean {
    return this.drillToDepth(0);
  }

  private getRootToStackTransform(
    stack: readonly ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>[],
  ): ZoomAffineTransform {
    let acc = IDENTITY_ZOOM_AFFINE;
    for (let i = 1; i < stack.length; i++) {
      const t = stack[i]?.parentToFrameTransform;
      if (t) {
        acc = composeZoomAffine(acc, t);
      }
    }
    return acc;
  }

  private evaluateFlightCamera(
    flight: ZoomFlightState<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    rawProgress: number,
  ): {
    readonly u: number;
    readonly camScale: number;
    readonly M_u: ZoomAffineTransform;
  } {
    const t = Math.max(0, Math.min(1, rawProgress));
    const smooth = t * t * (3 - 2 * t);
    const cubicOut = 1 - Math.pow(1 - t, 3);
    const u = 0.65 * smooth + 0.35 * cubicOut;

    const S = Math.max(0.02, Math.min(50, flight.flightTransform.scale));
    const alpha =
      Math.abs(S - 1) < 1e-4 ? u : (Math.pow(S, u) - 1) / (S - 1);
    const camScale = (1 - alpha) / S + alpha;
    const inv = flight.invFlight;
    const M_u: ZoomAffineTransform = {
      scale: camScale,
      sourceCx: inv.sourceCx,
      sourceCy: inv.sourceCy,
      targetCx: (1 - alpha) * inv.targetCx + alpha * inv.sourceCx,
      targetCy: (1 - alpha) * inv.targetCy + alpha * inv.sourceCy,
    };
    return { u, camScale, M_u };
  }

  private getCurrentScreenRootTransform(): ZoomAffineTransform {
    const base = this.getRootToStackTransform(this.zoomStack);
    if (!this.activeFlight) return base;
    const { M_u } = this.evaluateFlightCamera(
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
    this.focusedTriangleIndex = null;
    this.focusedClusterUid = null;
    this.neighborReturnHighlight = null;
    this.interactions.onTriangleHover?.(null);
    this.interactions.onClusterHover?.(null);
    this.interactions.onContentHover?.(null);

    const snapshot = this.buildFrameSnapshot();

    this.zoomStack = nextStack;
    const active = this.zoomStack[this.zoomStack.length - 1]!;
    this.activateZoomFrame(active);
    this.neighborReturnHighlight = nextNeighborHighlight;
    this.camera.reset();

    const newRootTransform = this.getRootToStackTransform(this.zoomStack);
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
    if (this.lastClusteringOutput && this.rootMesh) {
      this.solvedFrameCache.clear();
      const wasZoomed = this.zoomStack.length > 1;
      this.currentMesh = this.rootMesh;
      this.applyColorsAndDeriveDescriptors('strategy');
      this.zoomStack = [this.buildRootZoomFrame()];
      this.neighborReturnHighlight = null;
      if (wasZoomed) {
        this.camera.reset();
      }
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
    if (this.highlightedIds.size > 0) {
      this.neighborReturnHighlight = null;
    }
    this.dirtyRender = true;
  }

  /** Focuses a specific cluster UID (dimming unrelated nodes) or clears focus with `null`. */
  setFocusedClusterUid(clusterUid: string | null): void {
    if (clusterUid !== null) {
      this.neighborReturnHighlight = null;
    }
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
    if (valid !== null) {
      this.neighborReturnHighlight = null;
    }
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
      meshOptions: this.meshOptions,
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
      getTags: effectiveGetTags,
      normalizeTag: effectiveNormalizeTag,
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
    this.previousItems = identifiedItems;
    this.previousNormalizedItems = normalized;
    this.previousMesh = mesh;

    this.applyColorsAndDeriveDescriptors(reason);
    this.rootMesh = mesh;
    this.zoomStack = [this.buildRootZoomFrame()];
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
      })),
      neighbors: this.zoomStrategy.mode === 'drill-down' ? activeFrame.neighbors : [],
      drillableTriangleIndices: evalResult.drillableTriangleIndices,
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

    // 3. Reconcile triangle background OKLab tints, centroids, and density counts
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
        prev && !isInitial && !drillFlight
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

      const targetPoints: readonly [Point2D, Point2D, Point2D] = [
        { x: pA.x, y: pA.y },
        { x: pB.x, y: pB.y },
        { x: pC.x, y: pC.y },
      ];
      return {
        index: tri.index,
        vertexIndices: [va, vb, vc],
        targetPoints,
        points: [targetPoints[0], targetPoints[1], targetPoints[2]],
        centroid: {
          x: (pA.x + pB.x + pC.x) / 3,
          y: (pA.y + pB.y + pC.y) / 3,
        },
        coveredItemCount,
        interiorItemCount,
        currentOklab: startOklab,
        targetOklab: mixed.oklab,
        fillHex: lerpOklabHex(startOklab, mixed.oklab, isInitial || drillFlight ? 1 : 0),
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
      const targetA = { x: a.x, y: a.y };
      const targetB = { x: b.x, y: b.y };
      return {
        index: idx,
        vertexIndices: [e.a, e.b],
        targetA,
        targetB,
        a: targetA,
        b: targetB,
        mixedColorHex: mixed.hex,
      };
    });

    if (
      activeZoomFrame?.contextTriangles &&
      activeZoomFrame.contextTriangles.length > 0
    ) {
      this.contextTriangleStates = activeZoomFrame.contextTriangles.map(
        (ct, idx) => {
          const targetPoints: readonly [Point2D, Point2D, Point2D] = [
            ct.points[0],
            ct.points[1],
            ct.points[2],
          ];
          return {
            base: {
              index: -(idx + 1),
              vertexIndices: [-1, -1, -1] as const,
              points: targetPoints,
              centroid: ct.centroid,
              fillHex: ct.mixedColorHex,
              fillOpacity: 0.085,
              clusters: ct.clusters,
              coveredItemCount: ct.coveredItemCount,
              interiorItemCount: ct.interiorItemCount,
              isContext: true,
              neighborId: ct.neighborId,
              interaction: {
                isHovered: false,
                isFocused: false,
                isDimmed: true,
              },
            },
            targetPoints,
            points: [targetPoints[0], targetPoints[1], targetPoints[2]],
            centroid: ct.centroid,
            opacity: 1,
          };
        },
      );
    } else {
      this.contextTriangleStates = [];
    }

    if (activeZoomFrame?.contextEdges && activeZoomFrame.contextEdges.length > 0) {
      this.contextEdgeRecords = activeZoomFrame.contextEdges.map((ce, idx) => ({
        base: {
          index: -(idx + 1),
          vertexIndices: [-1, -1] as const,
          a: ce.a,
          b: ce.b,
          mixedColorHex: ce.mixedColorHex,
          clusters: ce.clusters,
          isHighlighted: false,
          isDimmed: true,
        },
        targetA: ce.a,
        targetB: ce.b,
        a: ce.a,
        b: ce.b,
        opacity: 1,
      }));
    } else {
      this.contextEdgeRecords = [];
    }

    if (
      activeZoomFrame?.contextClusters &&
      activeZoomFrame.contextClusters.length > 0
    ) {
      const ctxScale = Math.max(0.45, Math.min(0.86, solved.clusterScale * 0.85));
      this.contextClusterNodes = activeZoomFrame.contextClusters.map((cc) => {
        const visual = this.visualResolver.resolveClusterVisual(cc.cluster);
        const cacheKey = this.visualResolver.getVisualCacheKey(visual);
        const hull = this.renderer.measureClusterHull(visual, cacheKey);
        return {
          id: cc.id,
          neighborId: cc.neighborId,
          cluster: cc.cluster,
          visual,
          cacheKey,
          hull,
          targetX: cc.x,
          targetY: cc.y,
          targetScale: ctxScale,
          x: cc.x,
          y: cc.y,
          scale: ctxScale,
          opacity: 0.34,
        };
      });
    } else {
      this.contextClusterNodes = [];
    }

    if (
      activeZoomFrame?.contextItems &&
      activeZoomFrame.contextItems.length > 0
    ) {
      const sizeMult = Math.max(0.1, this.layoutOptions.sizeMultiplier ?? 1);
      const fallbackItemScale = Math.max(
        0.3 * sizeMult,
        Math.min(0.8 * sizeMult, solved.contentScale * 0.82),
      );
      this.contextItemNodes = activeZoomFrame.contextItems.map((ci) => {
        const visual = this.visualResolver.resolveContentVisual(
          ci.item,
          ci.layoutContext,
        );
        const cacheKey = this.visualResolver.getVisualCacheKey(visual);
        const hull = this.renderer.measureContentHull(visual, cacheKey);
        const ctxScale =
          ci.scale !== undefined
            ? Math.max(0.26 * sizeMult, Math.min(0.92 * sizeMult, ci.scale))
            : fallbackItemScale;
        return {
          id: ci.id,
          rawId: ci.rawId,
          neighborId: ci.neighborId,
          item: ci.item,
          layoutContext: ci.layoutContext,
          visual,
          cacheKey,
          hull,
          targetX: ci.x,
          targetY: ci.y,
          targetScale: ctxScale,
          x: ci.x,
          y: ci.y,
          scale: ctxScale,
          opacity: 0.32,
        };
      });
    } else {
      this.contextItemNodes = [];
    }

    // 4. Reconcile cluster & item nodes (either continuous drill flight OR normal springs)
    if (drillFlight) {
      const { snapshot: prevSnap, clusterDomainByNodeId, flightTransform, invFlight } =
        drillFlight;
      const S = Math.max(0.02, Math.min(50, flightTransform.scale));

      // Index previous rendered clusters (active, context, and any mid-flight departing clusters)
      const prevClusters = prevSnap.clusters
        .map((pc) => {
          const cluster = clusterDomainByNodeId.get(pc.id);
          if (!cluster) return null;
          const effOpacity = pc.isContext
            ? pc.opacity
            : pc.interaction.isDimmed
              ? pc.opacity * 0.34
              : pc.opacity;
          if (effOpacity <= 0.02) return null;
          return {
            node: pc,
            cluster,
            effOpacity,
            claimed: false,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      const maxMatchRadius = Math.max(
        110,
        Math.min(this.viewportWidth, this.viewportHeight) * 0.3,
      );
      const claimMatchingCluster = (
        targetCluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
        targetX: number,
        targetY: number,
      ) => {
        const expectedOld = applyZoomAffine(invFlight, { x: targetX, y: targetY });
        let best: (typeof prevClusters)[number] | null = null;
        let bestScore = Infinity;
        for (const cand of prevClusters) {
          if (cand.claimed) continue;
          const uidMatch = cand.cluster.clusterUid === targetCluster.clusterUid;
          const codeMatch = cand.cluster.code === targetCluster.code;
          if (!uidMatch && !codeMatch) continue;
          const dist = Math.hypot(
            cand.node.x - expectedOld.x,
            cand.node.y - expectedOld.y,
          );
          if (!uidMatch && dist > maxMatchRadius) continue;
          const score = uidMatch ? dist * 0.25 : dist;
          if (score < bestScore) {
            bestScore = score;
            best = cand;
          }
        }
        if (best) {
          best.claimed = true;
        }
        return best;
      };

      const clusterEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
      this.clusterNodes.clear();
      resolvedClusters.forEach((rc, idx) => {
        const placed = solved.clusters[idx]!;
        const uid = rc.cluster.clusterUid;
        const matched = claimMatchingCluster(rc.cluster, placed.x, placed.y);
        const nextTransition = matched
          ? retargetVisualTransition(
              null,
              matched.node.visual,
              matched.node.hull,
              matched.node.cacheKey,
              rc.visual,
              rc.hull,
              rc.cacheKey,
            )
          : null;

        if (matched) {
          const localStart = applyZoomAffine(flightTransform, {
            x: matched.node.x,
            y: matched.node.y,
          });
          clusterEndpoints.set(uid, {
            localStart,
            localEnd: { x: placed.x, y: placed.y },
            localStartScale: matched.node.scale * S,
            targetScale: placed.scale,
            startOpacity: matched.effOpacity,
            targetOpacity: 1,
            isNewlyEntering: false,
          });
        } else {
          clusterEndpoints.set(uid, {
            localStart: { x: placed.x, y: placed.y },
            localEnd: { x: placed.x, y: placed.y },
            localStartScale: placed.scale * 0.78,
            targetScale: placed.scale,
            startOpacity: 0,
            targetOpacity: 1,
            isNewlyEntering: true,
          });
        }

        this.clusterNodes.set(uid, {
          id: uid,
          status: 'active',
          x: { value: placed.x, velocity: 0, target: placed.x },
          y: { value: placed.y, velocity: 0, target: placed.y },
          scale: { value: placed.scale, velocity: 0, target: placed.scale },
          opacity: { value: 1, velocity: 0, target: 1 },
          visual: rc.visual,
          hull: rc.hull,
          cacheKey: rc.cacheKey,
          transition: nextTransition,
          domain: rc.cluster,
        });
      });

      const contextClusterEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
      for (const cc of this.contextClusterNodes) {
        const matched = claimMatchingCluster(cc.cluster, cc.targetX, cc.targetY);
        if (matched) {
          const localStart = applyZoomAffine(flightTransform, {
            x: matched.node.x,
            y: matched.node.y,
          });
          contextClusterEndpoints.set(cc.id, {
            localStart,
            localEnd: { x: cc.targetX, y: cc.targetY },
            localStartScale: matched.node.scale * S,
            targetScale: cc.targetScale,
            startOpacity: matched.effOpacity,
            targetOpacity: 0.34,
            isNewlyEntering: false,
          });
        } else {
          contextClusterEndpoints.set(cc.id, {
            localStart: { x: cc.targetX, y: cc.targetY },
            localEnd: { x: cc.targetX, y: cc.targetY },
            localStartScale: cc.targetScale * 0.85,
            targetScale: cc.targetScale,
            startOpacity: 0,
            targetOpacity: 0.34,
            isNewlyEntering: true,
          });
        }
      }

      const departingClusters: FlightDepartingCluster<
        TItem,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >[] = [];
      for (const rem of prevClusters) {
        if (rem.claimed) continue;
        const localStart = applyZoomAffine(flightTransform, {
          x: rem.node.x,
          y: rem.node.y,
        });
        const ghostId = rem.node.id.startsWith('ghost-cl-')
          ? rem.node.id
          : `ghost-cl-${rem.node.id}`;
        departingClusters.push({
          id: ghostId,
          cluster: rem.cluster,
          localStart,
          localStartScale: rem.node.scale * S,
          localEndScale: rem.node.scale * S * 0.82,
          startOpacity: rem.effOpacity,
          visual: rem.node.visual,
          hull: rem.node.hull,
          cacheKey: rem.node.cacheKey,
        });
      }

      // Reconcile content items across flight (active, dimmed neighborhood context, and departing ghosts)
      const prevItemsByRawId = new Map<
        string,
        {
          readonly node: NodeRenderState<TContentVisual>;
          readonly effOpacity: number;
          claimed: boolean;
        }
      >();
      for (const pi of prevSnap.items) {
        const effOpacity = pi.isContext
          ? pi.opacity
          : pi.interaction.isDimmed
            ? pi.opacity * 0.34
            : pi.opacity;
        if (effOpacity <= 0.02) continue;
        const rawId = pi.id.startsWith('ghost-it-')
          ? pi.id.slice(9)
          : pi.id.startsWith('ctx-it-')
            ? pi.id.slice(7)
            : pi.id;
        const existingEntry = prevItemsByRawId.get(rawId);
        if (!existingEntry || effOpacity > existingEntry.effOpacity) {
          prevItemsByRawId.set(rawId, { node: pi, effOpacity, claimed: false });
        }
      }

      const itemEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
      this.itemNodes.clear();
      resolvedItems.forEach((ri, idx) => {
        const placed = solved.items[idx]!;
        const id = ri.placement.id;
        const matched = prevItemsByRawId.get(id);
        let nextTransition: VisualTransitionState<TContentVisual> | null = null;

        if (matched) {
          matched.claimed = true;
          nextTransition = retargetVisualTransition(
            null,
            matched.node.visual,
            matched.node.hull,
            matched.node.cacheKey,
            ri.visual,
            ri.hull,
            ri.cacheKey,
          );
          const localStart = applyZoomAffine(flightTransform, {
            x: matched.node.x,
            y: matched.node.y,
          });
          itemEndpoints.set(id, {
            localStart,
            localEnd: { x: placed.x, y: placed.y },
            localStartScale: matched.node.scale * S,
            targetScale: placed.scale,
            startOpacity: matched.effOpacity,
            targetOpacity: 1,
            isNewlyEntering: false,
          });
        } else {
          itemEndpoints.set(id, {
            localStart: {
              x: placed.x * 0.72 + ri.placement.anchorX * 0.28,
              y: placed.y * 0.72 + ri.placement.anchorY * 0.28,
            },
            localEnd: { x: placed.x, y: placed.y },
            localStartScale: placed.scale * 0.8,
            targetScale: placed.scale,
            startOpacity: 0,
            targetOpacity: 1,
            isNewlyEntering: true,
          });
        }

        this.itemNodes.set(id, {
          id,
          status: 'active',
          x: { value: placed.x, velocity: 0, target: placed.x },
          y: { value: placed.y, velocity: 0, target: placed.y },
          scale: { value: placed.scale, velocity: 0, target: placed.scale },
          opacity: { value: 1, velocity: 0, target: 1 },
          visual: ri.visual,
          hull: ri.hull,
          cacheKey: ri.cacheKey,
          transition: nextTransition,
          domain: ri.placement,
        });
      });

      const contextItemEndpoints = new Map<string, ActiveNodeFlightEndpoint>();
      for (const ci of this.contextItemNodes) {
        const matched = prevItemsByRawId.get(ci.rawId);
        if (matched) {
          matched.claimed = true;
          const localStart = applyZoomAffine(flightTransform, {
            x: matched.node.x,
            y: matched.node.y,
          });
          contextItemEndpoints.set(ci.id, {
            localStart,
            localEnd: { x: ci.targetX, y: ci.targetY },
            localStartScale: matched.node.scale * S,
            targetScale: ci.targetScale,
            startOpacity: matched.effOpacity,
            targetOpacity: 0.32,
            isNewlyEntering: false,
          });
        } else {
          contextItemEndpoints.set(ci.id, {
            localStart: { x: ci.targetX, y: ci.targetY },
            localEnd: { x: ci.targetX, y: ci.targetY },
            localStartScale: ci.targetScale * 0.85,
            targetScale: ci.targetScale,
            startOpacity: 0,
            targetOpacity: 0.32,
            isNewlyEntering: true,
          });
        }
      }

      const departingItems: FlightDepartingItem<TContentVisual>[] = [];
      for (const [rawId, rem] of prevItemsByRawId) {
        if (rem.claimed) continue;
        const localStart = applyZoomAffine(flightTransform, {
          x: rem.node.x,
          y: rem.node.y,
        });
        const ghostId = rem.node.id.startsWith('ghost-it-')
          ? rem.node.id
          : `ghost-it-${rawId}`;
        departingItems.push({
          rawId,
          id: ghostId,
          localStart,
          localStartScale: rem.node.scale * S,
          localEndScale: rem.node.scale * S * 0.88,
          startOpacity: rem.effOpacity,
          visual: rem.node.visual,
          hull: rem.node.hull,
          cacheKey: rem.node.cacheKey,
        });
      }

      const departingTriangles: FlightDepartingTriangle<
        TItem,
        TTagMeta,
        TClusterMeta
      >[] = prevSnap.triangles
        .filter((pt) => (pt.opacity ?? 1) >= 0.06)
        .slice(-48)
        .map((pt) => ({
          base: {
            ...pt,
            isDrillable: undefined,
            neighborId: undefined,
            interaction: {
              isHovered: false,
              isFocused: false,
              isDimmed: pt.interaction.isDimmed,
            },
          },
          localPoints: [
            applyZoomAffine(flightTransform, pt.points[0]),
            applyZoomAffine(flightTransform, pt.points[1]),
            applyZoomAffine(flightTransform, pt.points[2]),
          ] as const,
          startOpacity: pt.opacity ?? 1,
        }));

      const departingEdges: FlightDepartingEdge<
        TItem,
        TTagMeta,
        TClusterMeta
      >[] = prevSnap.edges
        .filter((pe) => (pe.opacity ?? 1) >= 0.06)
        .slice(-72)
        .map((pe) => ({
          base: {
            ...pe,
            isHighlighted: false,
          },
          localA: applyZoomAffine(flightTransform, pe.a),
          localB: applyZoomAffine(flightTransform, pe.b),
          startOpacity: pe.opacity ?? 1,
        }));

      const durationSec = Math.min(
        0.66,
        Math.max(0.46, 0.44 + Math.abs(Math.log(S)) * 0.09),
      );
      this.activeFlight = {
        rawProgress: 0,
        durationSec,
        flightTransform,
        invFlight,
        departingTriangles,
        departingEdges,
        departingClusters,
        departingItems,
        clusterEndpoints,
        contextClusterEndpoints,
        itemEndpoints,
        contextItemEndpoints,
      };
      this.syncActiveFlightState(0);
    } else {
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
      isSettled: isInitial && !this.activeFlight,
      meshSideLength: mesh.sideLength,
      areaEfficiency: mesh.areaEfficiency,
    };
    this.onMetricsChange?.(this.currentMetrics);
    this.refreshZoomState();
    this.dirtyRender = true;

    if (isInitial || drillFlight) {
      this.renderNow();
    }
  }

  private syncActiveFlightState(rawProgress: number): void {
    const flight = this.activeFlight;
    if (!flight) return;

    if (rawProgress >= 1) {
      for (const tr of this.triangleStates) {
        tr.points = [tr.targetPoints[0], tr.targetPoints[1], tr.targetPoints[2]];
        tr.centroid = {
          x: (tr.targetPoints[0].x + tr.targetPoints[1].x + tr.targetPoints[2].x) / 3,
          y: (tr.targetPoints[0].y + tr.targetPoints[1].y + tr.targetPoints[2].y) / 3,
        };
        tr.flightOpacity = undefined;
      }
      for (const ct of this.contextTriangleStates) {
        ct.points = [ct.targetPoints[0], ct.targetPoints[1], ct.targetPoints[2]];
        ct.centroid = {
          x: (ct.targetPoints[0].x + ct.targetPoints[1].x + ct.targetPoints[2].x) / 3,
          y: (ct.targetPoints[0].y + ct.targetPoints[1].y + ct.targetPoints[2].y) / 3,
        };
        ct.opacity = 1;
      }
      for (const edge of this.edgeRecords) {
        edge.a = edge.targetA;
        edge.b = edge.targetB;
        edge.flightOpacity = undefined;
      }
      for (const ce of this.contextEdgeRecords) {
        ce.a = ce.targetA;
        ce.b = ce.targetB;
        ce.opacity = 1;
      }
      for (const cc of this.contextClusterNodes) {
        cc.x = cc.targetX;
        cc.y = cc.targetY;
        cc.scale = cc.targetScale;
        cc.opacity = 0.34;
      }
      for (const ci of this.contextItemNodes) {
        ci.x = ci.targetX;
        ci.y = ci.targetY;
        ci.scale = ci.targetScale;
        ci.opacity = 0.32;
      }
      for (const cNode of this.clusterNodes.values()) {
        cNode.x.value = cNode.x.target;
        cNode.x.velocity = 0;
        cNode.y.value = cNode.y.target;
        cNode.y.velocity = 0;
        cNode.scale.value = cNode.scale.target;
        cNode.scale.velocity = 0;
        cNode.opacity.value = cNode.opacity.target;
        cNode.opacity.velocity = 0;
      }
      for (const iNode of this.itemNodes.values()) {
        iNode.x.value = iNode.x.target;
        iNode.x.velocity = 0;
        iNode.y.value = iNode.y.target;
        iNode.y.velocity = 0;
        iNode.scale.value = iNode.scale.target;
        iNode.scale.velocity = 0;
        iNode.opacity.value = iNode.opacity.target;
        iNode.opacity.velocity = 0;
      }
      return;
    }

    const { u, camScale, M_u } = this.evaluateFlightCamera(flight, rawProgress);

    for (const tr of this.triangleStates) {
      const p0 = applyZoomAffine(M_u, tr.targetPoints[0]);
      const p1 = applyZoomAffine(M_u, tr.targetPoints[1]);
      const p2 = applyZoomAffine(M_u, tr.targetPoints[2]);
      tr.points = [p0, p1, p2];
      tr.centroid = {
        x: (p0.x + p1.x + p2.x) / 3,
        y: (p0.y + p1.y + p2.y) / 3,
      };
      tr.flightOpacity = u;
    }

    for (const ct of this.contextTriangleStates) {
      const p0 = applyZoomAffine(M_u, ct.targetPoints[0]);
      const p1 = applyZoomAffine(M_u, ct.targetPoints[1]);
      const p2 = applyZoomAffine(M_u, ct.targetPoints[2]);
      ct.points = [p0, p1, p2];
      ct.centroid = {
        x: (p0.x + p1.x + p2.x) / 3,
        y: (p0.y + p1.y + p2.y) / 3,
      };
      ct.opacity = u;
    }

    for (const edge of this.edgeRecords) {
      edge.a = applyZoomAffine(M_u, edge.targetA);
      edge.b = applyZoomAffine(M_u, edge.targetB);
      edge.flightOpacity = u;
    }

    for (const ce of this.contextEdgeRecords) {
      ce.a = applyZoomAffine(M_u, ce.targetA);
      ce.b = applyZoomAffine(M_u, ce.targetB);
      ce.opacity = u;
    }

    const evalEndpoint = (ep: ActiveNodeFlightEndpoint) => {
      const lx = ep.localStart.x + (ep.localEnd.x - ep.localStart.x) * u;
      const ly = ep.localStart.y + (ep.localEnd.y - ep.localStart.y) * u;
      const pt = applyZoomAffine(M_u, { x: lx, y: ly });
      const localScale =
        ep.localStartScale + (ep.targetScale - ep.localStartScale) * u;
      const scale = Math.max(0.08, camScale * localScale);
      const opacity = ep.isNewlyEntering
        ? Math.max(0, Math.min(1, (u - 0.08) / 0.82)) * ep.targetOpacity
        : ep.startOpacity + (ep.targetOpacity - ep.startOpacity) * u;
      return { pt, scale, opacity };
    };

    for (const cNode of this.clusterNodes.values()) {
      const ep = flight.clusterEndpoints.get(cNode.id);
      if (!ep) continue;
      const { pt, scale, opacity } = evalEndpoint(ep);
      cNode.x.value = pt.x;
      cNode.x.velocity = 0;
      cNode.y.value = pt.y;
      cNode.y.velocity = 0;
      cNode.scale.value = scale;
      cNode.scale.velocity = 0;
      cNode.opacity.value = opacity;
      cNode.opacity.velocity = 0;
    }

    for (const cc of this.contextClusterNodes) {
      const ep = flight.contextClusterEndpoints.get(cc.id);
      if (!ep) continue;
      const { pt, scale, opacity } = evalEndpoint(ep);
      cc.x = pt.x;
      cc.y = pt.y;
      cc.scale = scale;
      cc.opacity = opacity;
    }

    for (const ci of this.contextItemNodes) {
      const ep = flight.contextItemEndpoints.get(ci.id);
      if (!ep) continue;
      const { pt, scale, opacity } = evalEndpoint(ep);
      ci.x = pt.x;
      ci.y = pt.y;
      ci.scale = scale;
      ci.opacity = opacity;
    }

    for (const iNode of this.itemNodes.values()) {
      const ep = flight.itemEndpoints.get(iNode.id);
      if (!ep) continue;
      const { pt, scale, opacity } = evalEndpoint(ep);
      iNode.x.value = pt.x;
      iNode.x.velocity = 0;
      iNode.y.value = pt.y;
      iNode.y.velocity = 0;
      iNode.scale.value = scale;
      iNode.scale.velocity = 0;
      iNode.opacity.value = opacity;
      iNode.opacity.velocity = 0;
    }
  }

  /**
   * Advances spring animations, continuous zoom flights, and dual-layer transitions by `dtMs`
   * milliseconds, rendering a frame if anything moved or changed. Returns `true` when fully settled.
   */
  step(dtMs: number): boolean {
    if (this.destroyed) return true;
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

  private computeZoomRegionBoundary(): {
    readonly isZoomedIn: boolean;
    readonly activeFrameKind: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>['kind'] | undefined;
    readonly boundaryEdgeKeys: ReadonlySet<string>;
    readonly outerCornerVerts: ReadonlySet<number>;
  } {
    const isZoomedIn =
      this.zoomStrategy.mode === 'drill-down' && this.zoomStack.length > 1;
    const activeZoomFrame = isZoomedIn
      ? this.zoomStack[this.zoomStack.length - 1]
      : undefined;
    const boundaryEdgeKeys = new Set<string>();
    const outerCornerVerts = new Set<number>();

    if (isZoomedIn && this.triangleStates.length > 0) {
      const edgeCounts = new Map<string, number>();
      for (const tr of this.triangleStates) {
        const [a, b, c] = tr.vertexIndices;
        for (const [u, v] of [
          [a, b],
          [b, c],
          [c, a],
        ] as const) {
          const k = u < v ? `${u}:${v}` : `${v}:${u}`;
          edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
        }
      }
      for (const [k, count] of edgeCounts) {
        if (count === 1) {
          boundaryEdgeKeys.add(k);
        }
      }

      if (
        (activeZoomFrame?.kind === 'triangle' ||
          activeZoomFrame?.kind === 'cluster-spotlight') &&
        this.triangleStates.length > 1
      ) {
        outerCornerVerts.add(0);
        outerCornerVerts.add(1);
        outerCornerVerts.add(2);
      } else {
        for (const k of boundaryEdgeKeys) {
          const sep = k.indexOf(':');
          const u = Number(k.slice(0, sep));
          const v = Number(k.slice(sep + 1));
          if (activeZoomFrame?.kind !== 'cluster-star' || u !== 0) {
            outerCornerVerts.add(u);
          }
          if (activeZoomFrame?.kind !== 'cluster-star' || v !== 0) {
            outerCornerVerts.add(v);
          }
        }
      }
    }

    return {
      isZoomedIn,
      activeFrameKind: activeZoomFrame?.kind,
      boundaryEdgeKeys,
      outerCornerVerts,
    };
  }

  private buildTriangleRenderState(
    tr: AnimatedTriangleRecord,
    hasTriangleFocus = false,
    zoomBoundary = this.computeZoomRegionBoundary(),
    drillableTriSet?: ReadonlySet<number> | null,
  ): MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta> {
    const [va, vb, vc] = tr.vertexIndices;
    const isHovered = this.hoveredTriangleIndex === tr.index;
    const isFocused = this.focusedTriangleIndex === tr.index;
    const isReturnHighlighted =
      this.neighborReturnHighlight?.kind === 'triangle' &&
      this.neighborReturnHighlight.triangleIndex === tr.index;
    const isHighlighted = isReturnHighlighted || zoomBoundary.isZoomedIn;
    const isDimmed =
      hasTriangleFocus && !isFocused && !isHovered && !isReturnHighlighted;
    const isDrillable =
      drillableTriSet !== undefined
        ? Boolean(drillableTriSet?.has(tr.index))
        : this.zoomStrategy.mode === 'drill-down' &&
          this.currentZoomState.drillableTriangleIndices.includes(tr.index);

    const pairKey = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);
    const useMacroBoundaryMask =
      zoomBoundary.isZoomedIn &&
      this.triangleStates.length > 1 &&
      !isHovered &&
      !isFocused &&
      !isReturnHighlighted;

    return {
      index: tr.index,
      vertexIndices: tr.vertexIndices,
      points: tr.points,
      centroid: tr.centroid,
      fillHex: tr.fillHex,
      fillOpacity: 0.085,
      opacity: tr.flightOpacity,
      isDrillable: isDrillable || undefined,
      clusters: [
        this.currentClusters[va],
        this.currentClusters[vb],
        this.currentClusters[vc],
      ],
      coveredItemCount: tr.coveredItemCount,
      interiorItemCount: tr.interiorItemCount,
      highlightBoundary: useMacroBoundaryMask
        ? {
            edges: [
              zoomBoundary.boundaryEdgeKeys.has(pairKey(va, vb)),
              zoomBoundary.boundaryEdgeKeys.has(pairKey(vb, vc)),
              zoomBoundary.boundaryEdgeKeys.has(pairKey(vc, va)),
            ],
            corners: [
              zoomBoundary.outerCornerVerts.has(va),
              zoomBoundary.outerCornerVerts.has(vb),
              zoomBoundary.outerCornerVerts.has(vc),
            ],
          }
        : undefined,
      interaction: {
        isHovered,
        isFocused,
        isDimmed,
        isHighlighted,
      },
    };
  }

  private buildContextTriangleRenderState(
    ct: AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta>,
  ): MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta> {
    return {
      ...ct.base,
      points: ct.points,
      centroid: ct.centroid,
      opacity: ct.opacity < 0.999 ? ct.opacity : undefined,
      interaction: {
        isHovered: this.hoveredTriangleIndex === ct.base.index,
        isFocused: false,
        isDimmed: true,
        isHighlighted: false,
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
    const zoomBoundary = this.computeZoomRegionBoundary();
    const returnTriIdx =
      this.neighborReturnHighlight?.kind === 'triangle'
        ? this.neighborReturnHighlight.triangleIndex
        : null;
    const returnTriangle =
      returnTriIdx !== null ? this.triangleStates[returnTriIdx] : undefined;
    const returnTriVertSet = returnTriangle
      ? new Set(returnTriangle.vertexIndices)
      : null;
    const returnClusterUid =
      this.neighborReturnHighlight?.kind === 'cluster'
        ? this.neighborReturnHighlight.clusterUid
        : null;

    const hasTriangleOnlyFocus =
      this.focusedTriangleIndex !== null &&
      this.focusedClusterUid === null &&
      this.highlightedIds.size === 0;
    const focusedTriangle =
      this.focusedTriangleIndex !== null
        ? this.triangleStates[this.focusedTriangleIndex]
        : undefined;
    const hoveredTriangle =
      this.hoveredTriangleIndex !== null && this.hoveredTriangleIndex >= 0
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

    const flightEval = this.activeFlight
      ? this.evaluateFlightCamera(this.activeFlight, this.activeFlight.rawProgress)
      : null;

    const clusters: NodeRenderState<TClusterVisual>[] = [];
    if (this.activeFlight && flightEval) {
      const { u, camScale, M_u } = flightEval;
      const fadeOut = 1 - Math.min(1, u / 0.78);
      if (fadeOut > 0.005) {
        for (const dc of this.activeFlight.departingClusters) {
          const pt = applyZoomAffine(M_u, dc.localStart);
          const localScale =
            dc.localStartScale + (dc.localEndScale - dc.localStartScale) * u;
          clusters.push({
            id: dc.id,
            x: pt.x,
            y: pt.y,
            scale: Math.max(0.08, camScale * localScale),
            opacity: dc.startOpacity * fadeOut,
            visual: dc.visual,
            hull: dc.hull,
            cacheKey: dc.cacheKey,
            isContext: true,
            interaction: {
              isHovered: false,
              isPinned: false,
              isDimmed: true,
              isHighlighted: false,
            },
            transition: null,
          });
        }
      }
    }

    for (const cc of this.contextClusterNodes) {
      const isHovered = this.hoveredContextClusterId === cc.id;
      clusters.push({
        id: cc.id,
        x: cc.x,
        y: cc.y,
        scale: cc.scale,
        opacity: cc.opacity,
        visual: cc.visual,
        hull: cc.hull,
        cacheKey: cc.cacheKey,
        isContext: true,
        neighborId: cc.neighborId,
        interaction: {
          isHovered,
          isPinned: false,
          isDimmed: true,
          isHighlighted: false,
        },
        transition: null,
      });
    }

    for (const cNode of this.clusterNodes.values()) {
      const isHovered = this.hoveredClusterUid === cNode.id;
      const isFocusedCluster = this.focusedClusterUid === cNode.id;
      const isReturnCluster = returnClusterUid === cNode.id;
      const inReturnTriangle = Boolean(
        returnTriVertSet?.has(cNode.domain.clusterIndex) &&
          cNode.domain.role !== 'intermediate',
      );
      const isZoomHighlightedCluster = Boolean(
        zoomBoundary.isZoomedIn &&
          cNode.domain.role !== 'intermediate' &&
          (zoomBoundary.activeFrameKind === 'cluster-star'
            ? cNode.domain.clusterIndex === 0
            : zoomBoundary.outerCornerVerts.has(cNode.domain.clusterIndex)),
      );
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
          isHighlighted:
            isFocusedCluster ||
            inFocusedTriangle ||
            isReturnCluster ||
            inReturnTriangle ||
            isZoomHighlightedCluster,
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
    if (this.activeFlight && flightEval) {
      const { u, camScale, M_u } = flightEval;
      const fadeOut = 1 - Math.min(1, u / 0.78);
      if (fadeOut > 0.005) {
        for (const di of this.activeFlight.departingItems) {
          const pt = applyZoomAffine(M_u, di.localStart);
          const localScale =
            di.localStartScale + (di.localEndScale - di.localStartScale) * u;
          items.push({
            id: di.id,
            x: pt.x,
            y: pt.y,
            scale: Math.max(0.08, camScale * localScale),
            opacity: di.startOpacity * fadeOut,
            visual: di.visual,
            hull: di.hull,
            cacheKey: di.cacheKey,
            isContext: true,
            interaction: {
              isHovered: false,
              isPinned: false,
              isDimmed: true,
              isHighlighted: false,
            },
            transition: null,
          });
        }
      }
    }

    for (const ci of this.contextItemNodes) {
      items.push({
        id: ci.id,
        x: ci.x,
        y: ci.y,
        scale: ci.scale,
        opacity: ci.opacity,
        visual: ci.visual,
        hull: ci.hull,
        cacheKey: ci.cacheKey,
        isContext: true,
        isPassThrough: true,
        neighborId: ci.neighborId,
        interaction: {
          isHovered: false,
          isPinned: false,
          isDimmed: true,
          isHighlighted: false,
        },
        transition: null,
      });
    }

    const drillableTriSetForItems =
      this.zoomStrategy.mode === 'drill-down' &&
      this.currentZoomState.drillableTriangleIndices.length > 0
        ? new Set(this.currentZoomState.drillableTriangleIndices)
        : null;

    for (const iNode of this.itemNodes.values()) {
      const isPassThrough =
        drillableTriSetForItems !== null &&
        this.resolveDrillableTriangleForActiveItem(
          iNode,
          { x: iNode.x.value, y: iNode.y.value },
          drillableTriSetForItems,
        ) !== null;
      const isHovered = !isPassThrough && this.hoveredContentId === iNode.id;
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
        isPassThrough: isPassThrough || undefined,
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
    const ghostTriangles: MeshTriangleRenderState<
      TItem,
      TTagMeta,
      TClusterMeta
    >[] = [];
    if (this.activeFlight && flightEval) {
      const { u, M_u } = flightEval;
      const fadeOut = 1 - u;
      if (fadeOut > 0.005) {
        this.activeFlight.departingTriangles.forEach((dt, idx) => {
          const p0 = applyZoomAffine(M_u, dt.localPoints[0]);
          const p1 = applyZoomAffine(M_u, dt.localPoints[1]);
          const p2 = applyZoomAffine(M_u, dt.localPoints[2]);
          ghostTriangles.push({
            ...dt.base,
            index: -10000 - idx,
            points: [p0, p1, p2],
            centroid: {
              x: (p0.x + p1.x + p2.x) / 3,
              y: (p0.y + p1.y + p2.y) / 3,
            },
            opacity: dt.startOpacity * fadeOut,
          });
        });
      }
    }

    const contextTriangles = this.contextTriangleStates.map((ct) =>
      this.buildContextTriangleRenderState(ct),
    );
    const triangles: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>[] = [
      ...ghostTriangles,
      ...contextTriangles,
      ...this.triangleStates.map((tr) =>
        this.buildTriangleRenderState(
          tr,
          hasTriangleFocus,
          zoomBoundary,
          drillableTriSetForItems,
        ),
      ),
    ];

    const ghostEdges: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[] = [];
    if (this.activeFlight && flightEval) {
      const { u, M_u } = flightEval;
      const fadeOut = 1 - u;
      if (fadeOut > 0.005) {
        this.activeFlight.departingEdges.forEach((de, idx) => {
          ghostEdges.push({
            ...de.base,
            index: -10000 - idx,
            a: applyZoomAffine(M_u, de.localA),
            b: applyZoomAffine(M_u, de.localB),
            opacity: de.startOpacity * fadeOut,
          });
        });
      }
    }

    const contextEdges: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[] =
      this.contextEdgeRecords.map((ce) => ({
        ...ce.base,
        a: ce.a,
        b: ce.b,
        opacity: ce.opacity < 0.999 ? ce.opacity : undefined,
      }));

    const edges: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>[] = [
      ...ghostEdges,
      ...contextEdges,
      ...this.edgeRecords.map((edge) => {
        const [ea, eb] = edge.vertexIndices;
        const edgeKey = ea < eb ? `${ea}:${eb}` : `${eb}:${ea}`;
        const cA = this.currentClusters[ea];
        const cB = this.currentClusters[eb];
        const onFocusedTri = Boolean(
          focusedTriVertSet && focusedTriVertSet.has(ea) && focusedTriVertSet.has(eb),
        );
        const onHoveredTri = Boolean(
          hoveredTriVertSet && hoveredTriVertSet.has(ea) && hoveredTriVertSet.has(eb),
        );
        const onReturnTri = Boolean(
          returnTriVertSet && returnTriVertSet.has(ea) && returnTriVertSet.has(eb),
        );
        const onZoomBoundary =
          zoomBoundary.isZoomedIn && zoomBoundary.boundaryEdgeKeys.has(edgeKey);
        const touchesZoomStarCenter =
          zoomBoundary.isZoomedIn &&
          zoomBoundary.activeFrameKind === 'cluster-star' &&
          (ea === 0 || eb === 0);
        const touchesFocusedCluster =
          this.focusedClusterUid !== null &&
          (cA?.clusterUid === this.focusedClusterUid ||
            cB?.clusterUid === this.focusedClusterUid);
        const touchesHoveredCluster =
          this.hoveredClusterUid !== null &&
          (cA?.clusterUid === this.hoveredClusterUid ||
            cB?.clusterUid === this.hoveredClusterUid);
        const touchesReturnCluster =
          returnClusterUid !== null &&
          (cA?.clusterUid === returnClusterUid ||
            cB?.clusterUid === returnClusterUid);
        return {
          index: edge.index,
          vertexIndices: edge.vertexIndices,
          a: edge.a,
          b: edge.b,
          mixedColorHex: edge.mixedColorHex,
          clusters: [cA, cB] as const,
          isHighlighted:
            onFocusedTri ||
            onHoveredTri ||
            onReturnTri ||
            onZoomBoundary ||
            touchesZoomStarCenter ||
            touchesFocusedCluster ||
            touchesHoveredCluster ||
            touchesReturnCluster,
          opacity: edge.flightOpacity,
        };
      }),
    ];

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
   * Checks whether an active content item `node` belongs to a currently zoomable/drillable
   * triangle when a `drill-down` zoom strategy is active. If so, returns that owning
   * `AnimatedTriangleRecord` so pointer hover & click pass through to the triangle face;
   * returns `null` when the item sits in a leaf (non-drillable) region and remains interactive.
   */
  private resolveDrillableTriangleForActiveItem(
    node: AnimatedNodeRecord<
      TContentVisual,
      ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>
    >,
    probePosition: Point2D,
    drillableTriSet: ReadonlySet<number>,
  ): AnimatedTriangleRecord | null {
    // 1. Check which active mesh triangle directly contains the pointer/probe position
    for (let i = this.triangleStates.length - 1; i >= 0; i--) {
      const tr = this.triangleStates[i]!;
      if (
        isPointInTriangle(
          probePosition.x,
          probePosition.y,
          tr.points[0],
          tr.points[1],
          tr.points[2],
        )
      ) {
        return drillableTriSet.has(tr.index) ? tr : null;
      }
    }

    // 2. If pointer hit an overhanging rim of `node`, check which triangle contains `node`'s center
    const nx = node.x.value;
    const ny = node.y.value;
    if (nx !== probePosition.x || ny !== probePosition.y) {
      for (let i = this.triangleStates.length - 1; i >= 0; i--) {
        const tr = this.triangleStates[i]!;
        if (isPointInTriangle(nx, ny, tr.points[0], tr.points[1], tr.points[2])) {
          return drillableTriSet.has(tr.index) ? tr : null;
        }
      }
    }

    // 3. Item relaxed slightly outside the outer mesh perimeter (e.g. 1-cluster item near a corner):
    //    find the geometrically nearest active triangle whose corner clusters cover `node`.
    const unitClusters = node.domain.layoutContext.unitClusters;
    if (unitClusters.length > 0) {
      let nearestCoveringTri: AnimatedTriangleRecord | null = null;
      let bestDistSq = Infinity;
      for (const tr of this.triangleStates) {
        const [va, vb, vc] = tr.vertexIndices;
        const covers = unitClusters.every(
          (uc) =>
            uc.cluster.clusterIndex === va ||
            uc.cluster.clusterIndex === vb ||
            uc.cluster.clusterIndex === vc,
        );
        if (!covers) continue;
        const dx = nx - tr.centroid.x;
        const dy = ny - tr.centroid.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          nearestCoveringTri = tr;
        }
      }
      if (nearestCoveringTri && drillableTriSet.has(nearestCoveringTri.index)) {
        return nearestCoveringTri;
      }
    }

    return null;
  }

  /**
   * Resolves a dimmed neighborhood `contextItemNode` (e.g. an exterior 1-cluster item or overhanging rim)
   * to its owning `contextTriangle` so unfocused content items never capture individual hover,
   * routing pointer hover & click cleanly to the neighbor triangle as a whole.
   */
  private resolveContextTriangleForContextItem(
    ci: AnimatedContextItemRecord<TItem, TContentVisual, TTagMeta, TClusterMeta>,
  ): AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta> | null {
    for (let i = this.contextTriangleStates.length - 1; i >= 0; i--) {
      const ct = this.contextTriangleStates[i]!;
      if (isPointInTriangle(ci.x, ci.y, ct.points[0], ct.points[1], ct.points[2])) {
        return ct;
      }
    }

    if (ci.neighborId) {
      let bestExact: AnimatedContextTriangleRecord<TItem, TTagMeta, TClusterMeta> | null =
        null;
      let bestExactDistSq = Infinity;
      for (const ct of this.contextTriangleStates) {
        if (ct.base.neighborId !== ci.neighborId) continue;
        const dx = ci.x - ct.centroid.x;
        const dy = ci.y - ct.centroid.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestExactDistSq) {
          bestExactDistSq = dSq;
          bestExact = ct;
        }
      }
      if (bestExact) return bestExact;
    }

    const itemClusterUids = new Set(
      ci.layoutContext.unitClusters.map((uc) => uc.cluster.clusterUid),
    );
    if (itemClusterUids.size > 0) {
      const scopePrefix = ci.neighborId?.startsWith('@')
        ? ci.neighborId.slice(0, ci.neighborId.indexOf('/') + 1)
        : '';
      let nearestSharing: AnimatedContextTriangleRecord<
        TItem,
        TTagMeta,
        TClusterMeta
      > | null = null;
      let bestDistSq = Infinity;
      for (const ct of this.contextTriangleStates) {
        if (
          scopePrefix &&
          ct.base.neighborId &&
          !ct.base.neighborId.startsWith(scopePrefix)
        ) {
          continue;
        }
        const sharesCorner = ct.base.clusters.some(
          (c) => c !== undefined && itemClusterUids.has(c.clusterUid),
        );
        if (!sharesCorner) continue;
        const dx = ci.x - ct.centroid.x;
        const dy = ci.y - ct.centroid.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          nearestSharing = ct;
        }
      }
      if (nearestSharing) return nearestSharing;
    }

    return null;
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
    const worldPosition = this.camera.screenToWorld(screenX, screenY);
    const screenPosition = { x: screenX, y: screenY };
    const hasTriangleFocus = this.focusedTriangleIndex !== null;

    const drillableTriSet =
      this.zoomStrategy.mode === 'drill-down' &&
      this.currentZoomState.drillableTriangleIndices.length > 0
        ? new Set(this.currentZoomState.drillableTriangleIndices)
        : null;
    let deferredDrillableTri: AnimatedTriangleRecord | null = null;

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
        if (drillableTriSet !== null) {
          const owningDrillable = this.resolveDrillableTriangleForActiveItem(
            node,
            worldPosition,
            drillableTriSet,
          );
          if (owningDrillable !== null) {
            deferredDrillableTri ??= owningDrillable;
            continue;
          }
        }
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

    // If an active item belonging to a drillable triangle passed through (including overhanging rims
    // or exterior single-cluster items), route directly to that drillable triangle before context/background.
    if (deferredDrillableTri !== null) {
      let targetTri = deferredDrillableTri;
      for (let i = this.triangleStates.length - 1; i >= 0; i--) {
        const tr = this.triangleStates[i]!;
        if (
          drillableTriSet?.has(tr.index) &&
          isPointInTriangle(
            worldPosition.x,
            worldPosition.y,
            tr.points[0],
            tr.points[1],
            tr.points[2],
          )
        ) {
          targetTri = tr;
          break;
        }
      }
      return {
        kind: 'triangle',
        triangle: this.buildTriangleRenderState(targetTri, hasTriangleFocus),
        worldPosition,
        screenPosition,
      };
    }

    // Test dimmed neighborhood clusters
    for (let i = this.contextClusterNodes.length - 1; i >= 0; i--) {
      const cc = this.contextClusterNodes[i]!;
      if (cc.opacity < 0.08) continue;
      if (
        hitTestConvexGeometry(
          cc.hull,
          cc.x,
          cc.y,
          cc.scale,
          worldPosition.x,
          worldPosition.y,
          3 / Math.max(0.5, this.camera.getState().zoom),
        )
      ) {
        return {
          kind: 'cluster',
          cluster: cc.cluster,
          visual: cc.visual,
          worldPosition,
          screenPosition,
          neighborId: cc.neighborId,
        };
      }
    }

    // Test mesh triangle faces
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

    // Test dimmed neighboring context triangle faces (dimmed context items inside them pass straight through)
    for (let i = this.contextTriangleStates.length - 1; i >= 0; i--) {
      const ct = this.contextTriangleStates[i]!;
      if (
        isPointInTriangle(
          worldPosition.x,
          worldPosition.y,
          ct.points[0],
          ct.points[1],
          ct.points[2],
        )
      ) {
        return {
          kind: 'triangle',
          triangle: this.buildContextTriangleRenderState(ct),
          worldPosition,
          screenPosition,
        };
      }
    }

    // Overhanging / exterior dimmed context item fallback: route directly to its owning neighbor triangle
    // (or neighbor cluster) without ever exposing individual content hover in unfocused triangles
    for (let i = this.contextItemNodes.length - 1; i >= 0; i--) {
      const ci = this.contextItemNodes[i]!;
      if (ci.opacity < 0.08) continue;
      if (
        hitTestConvexGeometry(
          ci.hull,
          ci.x,
          ci.y,
          ci.scale,
          worldPosition.x,
          worldPosition.y,
          3 / Math.max(0.5, this.camera.getState().zoom),
        )
      ) {
        const owningCtxTri = this.resolveContextTriangleForContextItem(ci);
        if (owningCtxTri) {
          return {
            kind: 'triangle',
            triangle: this.buildContextTriangleRenderState(owningCtxTri),
            worldPosition,
            screenPosition,
          };
        }
        if (ci.neighborId) {
          const owningCtxCluster = this.contextClusterNodes.find(
            (cc) => cc.neighborId === ci.neighborId,
          );
          if (owningCtxCluster) {
            return {
              kind: 'cluster',
              cluster: owningCtxCluster.cluster,
              visual: owningCtxCluster.visual,
              worldPosition,
              screenPosition,
              neighborId: owningCtxCluster.neighborId,
            };
          }
        }
        break;
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

  /** Dispatches left-click interaction using mathematical convex-hull hit-testing. */
  handleLeftClick(raw: Omit<NormalizedPointerEvent, 'worldX' | 'worldY'>): void {
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
    this.interactions.onLeftClick?.(target, fullEvent);
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
