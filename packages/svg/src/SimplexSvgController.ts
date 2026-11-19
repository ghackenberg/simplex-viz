import {
  SimplexGraphEngine,
  SimplexTimelineController,
  createCollisionDrivenLayoutStrategy,
  createFinalSeededClusteringStrategy,
  createFinalSeededLayoutStrategy,
  createSimplexTimeline,
  createSoftSimplexTagClusteringStrategy,
  isPointInTriangle,
  type CameraController,
  type ClusterDerivationContext,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ClusterMetaConfig,
  type ContentHoverEvent,
  type DefaultTaggedItem,
  type EmptyClusterBehavior,
  type FinalSeededLayoutScaleMode,
  type InteractionHandlers,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexLayoutStrategy,
  type SimplexMeshStrategy,
  type SimplexTimelineOptions,
  type SimplexTimelineState,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type StrategyItemIdentityConfig,
  type TriangleHoverEvent,
  type VisualResolver,
} from '@simplex-viz/core';
import { SVG_NS } from './hullMeasure.js';
import {
  createPresetViews,
  createPresetVisualResolver,
  extractDefaultItemLabel,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type PresetBadgeClusterOptions,
  type PresetContentShapeOption,
  type SimplexTheme,
  type SimplexVisualPreset,
} from './presets.js';
import { SvgRendererAdapter, type SvgRendererOptions } from './SvgRendererAdapter.js';
import type { SvgEdgeView, SvgNodeView, SvgTriangleView } from './types.js';

export type SimplexTooltipFormatter<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = (
  target:
    | ({ readonly kind: 'content' } & ContentHoverEvent<
        TItem,
        TContentVisual,
        TTagMeta,
        TClusterMeta
      >)
    | ({ readonly kind: 'cluster' } & ClusterHoverEvent<
        TItem,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >)
    | ({ readonly kind: 'triangle' } & TriangleHoverEvent<
        TItem,
        TTagMeta,
        TClusterMeta
      >),
) => string;

/**
 * Configuration options for the built-in optional timeline / frame-stepping player
 * in `@simplex-viz/svg` and `@simplex-viz/react`.
 */
export interface TimelinePlayerOptions<TItem = DefaultTaggedItem>
  extends SimplexTimelineOptions<TItem> {
  /**
   * Renders the compact, theme-adaptive Play/Pause/Step/Scrubber HUD bar inside the graph container.
   * Set to `false` when driving playback through a custom host UI via `controller.timeline`.
   * Default: `true`.
   */
  readonly showControls?: boolean;
  /** Vertical placement of the built-in timeline player bar. Default: `'bottom'`. */
  readonly position?: 'bottom' | 'top';
  /**
   * Automatically wraps the active clustering strategy in `createFinalSeededClusteringStrategy`
   * seeded from the full corpus so cluster vertices, UIDs, labels, and colors stay pinned across
   * `0..N` playback frames with zero cluster hopping. Default: `true`.
   */
  readonly autoFinalSeed?: boolean;
  /**
   * Automatically wraps the active layout strategy in `createFinalSeededLayoutStrategy`
   * seeded from the full corpus so items appear at their exact final coordinates across `0..N`
   * playback frames with zero drift.
   * - `false` / `undefined` (default): active `layoutStrategy` runs normally on each step.
   * - `true` or `'pinned'`: freeze both coordinates and final scale.
   * - `'adaptive'`: freeze coordinates, allow sparse frames to render larger and smoothly scale down.
   */
  readonly autoFinalSeedLayout?: boolean | FinalSeededLayoutScaleMode;
  /**
   * Controls how empty / not-yet-populated future clusters are rendered while timeline playback
   * is active (`'normal'`, `'dim'`, or `'hide'`). Overrides top-level `emptyClusterBehavior`
   * during timeline playback when specified.
   */
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  /** Invoked whenever the timeline playback state changes (step, play/pause, speed, corpus). */
  readonly onStateChange?: (state: SimplexTimelineState<TItem>) => void;
}

export interface SimplexSvgControllerResolvedOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items: readonly TItem[];
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly getLabel?: (item: TItem) => string;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  /** Built-in visual preset used when `visualResolver` / views are omitted. Default: `'geometric'`. */
  readonly preset?: SimplexVisualPreset;
  /** Visual color theme (`'dark'` or `'light'`) for built-in presets and tooltips. Default: `'dark'`. */
  readonly theme?: SimplexTheme;
  /** Optional custom visual resolver (defaults to the active `preset` resolver). */
  readonly visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  /** Optional custom content `SvgNodeView` (defaults to the active `preset` view). */
  readonly contentView?: SvgRendererOptions<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >['contentView'];
  /** Optional custom cluster `SvgNodeView` (defaults to the active `preset` view). */
  readonly clusterView?: SvgRendererOptions<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >['clusterView'];
  /** Optional pluggable `SvgTriangleView` for triangulation faces. */
  readonly triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
  /** Optional pluggable `SvgEdgeView` for triangulation edges. */
  readonly edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
  readonly normalizeTag?: (rawTag: string) => string;
  /** Optional formatter converting canonical tag IDs into concise human-readable display labels without altering clustering or equality checks. */
  readonly formatTagLabel?: (tag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  /** Formatting & code-toggle options for `BadgeClusterSvgView` when using `preset: 'badges'`. */
  readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  /** Fixed shape or per-item shape resolver overriding topological rank shapes in `GeometricShapeSvgView` (`'geometric'` / `'badges'` presets). */
  readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexMeshStrategy<TItem>;
  readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  readonly layoutStrategy?: SimplexLayoutStrategy;
  readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  readonly showHulls?: boolean;
  /**
   * Controls how clusters with `0` active member items are rendered (`'normal'`, `'dim'`, or `'hide'`).
   * Especially useful during chronological timeline playback with final-seeded clusters. Default: `'normal'`.
   */
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  /** Renders the built-in breadcrumb bar when drilled into sub-levels. Default: `true`. */
  readonly showZoomBreadcrumbs?: boolean;
  /**
   * Opt-in chronological timeline / frame-stepping playback support.
   * Pass `true` for zero-config playback with auto-detected timestamps and built-in HUD controls,
   * or a `TimelinePlayerOptions` object for custom frame extractors, speed, and UI controls.
   */
  readonly timeline?: boolean | TimelinePlayerOptions<TItem>;
  /**
   * Automatically re-measures SVG hulls and re-solves layout once webfonts finish loading
   * (`document.fonts.ready` and `loadingdone`). Prevents stale fallback-font text measurements
   * in production deployments. Default: `true`.
   */
  readonly relayoutOnFontLoad?: boolean;
  /**
   * Automatically toggles cluster focus when clicking a topic cluster (and clears on background click)
   * unless consumed (`return true`) by a click interaction handler. Default: `true`.
   */
  readonly focusOnClusterClick?: boolean;
  /**
   * Automatically toggles triangle face focus when clicking a triangle face (and clears on background click)
   * unless consumed (`return true`) by a click interaction handler. Default: `true`.
   */
  readonly focusOnTriangleClick?: boolean;
  /** Enables a built-in floating DOM hover tooltip (or supply a custom text formatter). Default: `false`. */
  readonly tooltip?:
    | boolean
    | SimplexTooltipFormatter<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;
  readonly interactions?: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly onMetricsChange?: (metrics: LayoutMetrics) => void;
  readonly onClustersChange?: (
    clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
  ) => void;
  readonly onZoomStateChange?: (state: SimplexZoomState) => void;
  readonly onFpsUpdate?: (fps: number) => void;
}

export type SimplexSvgControllerOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = StrategyItemIdentityConfig<TItem, TTagMeta> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> &
  Omit<
    SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'getId' | 'getTags' | 'deriveClusterMeta' | 'clusteringStrategy'
  >;

function resolveContainerElement(target: HTMLElement | string): HTMLElement {
  if (typeof target !== 'string') {
    return target;
  }
  if (typeof document === 'undefined') {
    throw new Error(
      `SimplexSvgController: cannot resolve selector "${target}" outside a DOM environment.`,
    );
  }
  const el = document.querySelector<HTMLElement>(target);
  if (!el) {
    throw new Error(
      `SimplexSvgController: no element matched container selector "${target}".`,
    );
  }
  return el;
}

/**
 * High-level framework-agnostic SVG graph controller for Vanilla TypeScript, Vue, Angular,
 * Svelte, Web Components, and `@simplex-viz/react`.
 *
 * Works zero-config with `{ items }` via built-in presets, default zoom/pan/focus interactions,
 * and optional tooltips, while remaining 100% customizable through `VisualResolver` and `SvgNodeView`.
 */
export class SimplexSvgController<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  private readonly containerEl: HTMLElement;
  private readonly svgEl: SVGSVGElement;
  private readonly adapter: SvgRendererAdapter<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  private readonly engine: SimplexGraphEngine<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onFpsUpdate?: (fps: number) => void;
  private onZoomStateChangeCallback?: (state: SimplexZoomState) => void;
  private readonly focusOnClusterClick: boolean;
  private readonly focusOnTriangleClick: boolean;
  private showZoomBreadcrumbs: boolean;
  private readonly getIdExtractor: (item: TItem) => string;
  private getLabelExtractor?: (item: TItem) => string;
  private readonly formatTagLabelFn?: (tag: string) => string;
  private readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  private readonly getShapeOption?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  private tooltipOption:
    | boolean
    | SimplexTooltipFormatter<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;
  private tooltipEl: HTMLDivElement | null = null;
  private breadcrumbOverlayEl: HTMLDivElement | null = null;
  private timelineController: SimplexTimelineController<TItem> | null = null;
  private timelineUnsubscribe: (() => void) | null = null;
  private readonly timelineStateListeners = new Set<
    (state: SimplexTimelineState<TItem> | null) => void
  >();
  private timelineOverlayEl: HTMLDivElement | null = null;
  private timelineUiRefs: {
    playBtn: HTMLButtonElement;
    prevBtn: HTMLButtonElement;
    nextBtn: HTMLButtonElement;
    scrubber: HTMLInputElement;
    labelEl: HTMLSpanElement;
    countEl: HTMLSpanElement;
  } | null = null;
  private timelineShowControls = true;
  private timelinePosition: 'bottom' | 'top' = 'bottom';
  private timelineAutoFinalSeed = true;
  private timelineAutoFinalSeedLayout: FinalSeededLayoutScaleMode | false = false;
  private baseEmptyClusterBehavior: EmptyClusterBehavior = 'normal';
  private timelineEmptyClusterBehavior: EmptyClusterBehavior | undefined = undefined;
  private timelineOnStateChange?: (state: SimplexTimelineState<TItem>) => void;
  private rawClusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  private rawLayoutStrategy?: SimplexLayoutStrategy;
  private lastTimelineActiveItems: readonly TItem[] | null = null;
  private lastExternalItemsRef: readonly TItem[];
  private fullCorpusItems: readonly TItem[];
  private focusedClusterUidState: string | null = null;
  private focusedTriangleIndexState: number | null = null;
  private currentPreset: SimplexVisualPreset;
  private currentTheme: SimplexTheme;
  private readonly usesCustomVisualResolver: boolean;
  private readonly cameraProxy: CameraController;

  private rafId: number | null = null;
  private lastFrameTs = 0;
  private fpsSamples = 0;
  private fpsAccumMs = 0;
  private destroyed = false;

  // Centralized drag-to-pan and multi-touch pinch-zoom state on root <svg>
  private isDraggingPan = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist: number | null = null;
  private pinchStartDist: number | null = null;
  private pinchHandledInGesture = false;
  private lastPinchMid: { x: number; y: number } | null = null;
  private wheelPinchAccum = 0;
  private wheelPinchCooldownUntil = 0;
  private fontLoadCleanup: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement | string,
    options: SimplexSvgControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
  constructor(
    containerEl: HTMLElement | string,
    options: SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.containerEl = resolveContainerElement(containerEl);
    this.onFpsUpdate = options.onFpsUpdate;
    this.onZoomStateChangeCallback = options.onZoomStateChange;
    this.focusOnClusterClick = options.focusOnClusterClick ?? true;
    this.focusOnTriangleClick = options.focusOnTriangleClick ?? true;
    this.showZoomBreadcrumbs = options.showZoomBreadcrumbs ?? true;
    this.getLabelExtractor = options.getLabel;
    this.formatTagLabelFn = options.formatTagLabel;
    this.badgeOptions = options.badgeOptions;
    this.getShapeOption = options.getShape;
    this.tooltipOption = options.tooltip ?? false;
    this.getIdExtractor =
      options.getId ??
      ((item: TItem) =>
        typeof item === 'object' && item !== null && 'id' in item
          ? String((item as { readonly id: unknown }).id)
          : '');

    this.currentPreset = options.preset ?? 'geometric';
    this.currentTheme = options.theme ?? 'dark';
    this.usesCustomVisualResolver = options.visualResolver !== undefined;
    const presetViews = createPresetViews(this.currentPreset);
    const contentView = (options.contentView ??
      presetViews.contentView) as SvgNodeView<TContentVisual>;
    const clusterView = (options.clusterView ??
      presetViews.clusterView) as SvgNodeView<TClusterVisual>;
    const visualResolver = (options.visualResolver ??
      createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(this.currentPreset, {
        getLabel: this.getLabelExtractor,
        theme: this.currentTheme,
        formatTagLabel: this.formatTagLabelFn,
        badgeOptions: this.badgeOptions,
        getShape: this.getShapeOption,
      })) as VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;

    const doc = this.containerEl.ownerDocument;
    this.svgEl = doc.createElementNS(SVG_NS, 'svg');
    this.svgEl.setAttribute('width', '100%');
    this.svgEl.setAttribute('height', '100%');
    this.svgEl.style.display = 'block';
    this.svgEl.style.touchAction = 'none';
    this.svgEl.style.userSelect = 'none';
    this.containerEl.appendChild(this.svgEl);

    const rect = this.containerEl.getBoundingClientRect();
    const initialW = rect.width > 40 ? rect.width : 960;
    const initialH = rect.height > 40 ? rect.height : 620;

    this.adapter = new SvgRendererAdapter<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >(this.svgEl, {
      contentView,
      clusterView,
      triangleView: options.triangleView,
      edgeView: options.edgeView,
      theme: this.currentTheme,
    });

    this.rawClusteringStrategy = options.clusteringStrategy;
    this.rawLayoutStrategy = options.layoutStrategy;
    this.baseEmptyClusterBehavior = options.emptyClusterBehavior ?? 'normal';
    this.lastExternalItemsRef = options.items;
    this.fullCorpusItems = options.items.slice();

    if (options.timeline) {
      const timelineOpts: TimelinePlayerOptions<TItem> =
        options.timeline === true ? {} : options.timeline;
      this.timelineShowControls = timelineOpts.showControls ?? true;
      this.timelinePosition = timelineOpts.position ?? 'bottom';
      this.timelineAutoFinalSeed = timelineOpts.autoFinalSeed ?? true;
      this.timelineAutoFinalSeedLayout = this.normalizeAutoFinalSeedLayout(
        timelineOpts.autoFinalSeedLayout,
      );
      this.timelineEmptyClusterBehavior = timelineOpts.emptyClusterBehavior;
      this.timelineOnStateChange = timelineOpts.onStateChange;
      this.timelineController = createSimplexTimeline(
        this.fullCorpusItems,
        timelineOpts,
      );
      this.lastTimelineActiveItems = this.timelineController.getActiveItems();
    }

    const initialItems = this.timelineController
      ? this.timelineController.getActiveItems()
      : options.items;
    const initialClusteringStrategy = this.resolveEffectiveClusteringStrategy(
      this.rawClusteringStrategy,
      this.fullCorpusItems,
    );
    const initialLayoutStrategy = this.resolveEffectiveLayoutStrategy(
      this.rawLayoutStrategy,
    );
    const effectiveEmptyClusterBehavior =
      this.timelineController && this.timelineEmptyClusterBehavior !== undefined
        ? this.timelineEmptyClusterBehavior
        : this.baseEmptyClusterBehavior;

    this.engine = SimplexGraphEngine.createFromResolved({
      items: initialItems,
      getId: options.getId,
      getTags: options.getTags,
      deriveClusterMeta: options.deriveClusterMeta,
      visualResolver,
      renderer: this.adapter,
      viewportWidth: initialW,
      viewportHeight: initialH,
      normalizeTag: options.normalizeTag,
      formatTagLabel: options.formatTagLabel,
      resolveTagMeta: options.resolveTagMeta,
      meshOptions: options.meshOptions,
      layoutOptions: options.layoutOptions,
      meshStrategy: options.meshStrategy,
      clusteringStrategy: initialClusteringStrategy,
      colorStrategy: options.colorStrategy,
      layoutStrategy: initialLayoutStrategy,
      zoomStrategy: options.zoomStrategy,
      theme: this.currentTheme,
      showHulls: options.showHulls,
      emptyClusterBehavior: effectiveEmptyClusterBehavior,
      canonicalSeedItems: this.timelineController ? this.fullCorpusItems : undefined,
      interactions: this.wrapInteractions(options.interactions),
      onMetricsChange: options.onMetricsChange,
      onClustersChange: options.onClustersChange,
      onZoomStateChange: (state) => {
        this.syncZoomOverlays(state);
        this.onZoomStateChangeCallback?.(state);
      },
    });
    this.syncZoomOverlays(this.engine.getZoomState());
    this.onZoomStateChangeCallback?.(this.engine.getZoomState());
    if (this.timelineController) {
      this.attachTimelineController(this.timelineController);
    }

    const baseCamera = this.engine.camera;
    const syncCameraRender = (): void => {
      if (this.destroyed) return;
      this.engine.renderNow();
    };
    this.cameraProxy = {
      getState: () => baseCamera.getState(),
      setState: (next) => {
        baseCamera.setState(next);
        syncCameraRender();
      },
      zoomToCursor: (screenX, screenY, zoomFactor) => {
        baseCamera.zoomToCursor(screenX, screenY, zoomFactor);
        syncCameraRender();
      },
      panBy: (dx, dy) => {
        baseCamera.panBy(dx, dy);
        syncCameraRender();
      },
      reset: () => {
        baseCamera.reset();
        syncCameraRender();
      },
      screenToWorld: (screenX, screenY) => baseCamera.screenToWorld(screenX, screenY),
      worldToScreen: (worldX, worldY) => baseCamera.worldToScreen(worldX, worldY),
    };

    this.attachSvgListeners();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        if (this.destroyed) return;
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 60 && height > 60) {
            this.engine.setViewport(width, height);
            this.ensureLoopRunning();
          }
        }
      });
      this.resizeObserver.observe(this.containerEl);
    }

    if (options.relayoutOnFontLoad !== false) {
      this.attachFontLoadListener();
    }

    this.ensureLoopRunning();
  }

  static createFromResolved<
    TItem = DefaultTaggedItem,
    TContentVisual = DefaultContentPresetVisual,
    TClusterVisual = DefaultClusterPresetVisual,
    TTagMeta = undefined,
    TClusterMeta = undefined,
  >(
    containerEl: HTMLElement | string,
    options: SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return new (SimplexSvgController as unknown as new (
      el: HTMLElement | string,
      opts: SimplexSvgControllerResolvedOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ) => SimplexSvgController<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >)(containerEl, options);
  }

  private wrapInteractions(
    userInteractions?: InteractionHandlers<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return {
      onContentHover: (ev) => {
        const consumed = userInteractions?.onContentHover?.(ev);
        if (ev && consumed !== true) {
          this.showTooltip(
            ev.screenPosition.x,
            ev.screenPosition.y,
            this.formatContentTooltip(ev),
          );
        } else {
          this.hideTooltip();
        }
        return consumed;
      },
      onClusterHover: (ev) => {
        const consumed = userInteractions?.onClusterHover?.(ev);
        if (ev && consumed !== true) {
          this.showTooltip(
            ev.screenPosition.x,
            ev.screenPosition.y,
            this.formatClusterTooltip(ev),
          );
        } else {
          this.hideTooltip();
        }
        return consumed;
      },
      onTriangleHover: (ev) => {
        const consumed = userInteractions?.onTriangleHover?.(ev);
        if (ev && consumed !== true) {
          this.showTooltip(
            ev.screenPosition.x,
            ev.screenPosition.y,
            this.formatTriangleTooltip(ev),
          );
        } else {
          this.hideTooltip();
        }
        return consumed;
      },
      onLeftClick: (target, rawEvent) => {
        if (target.kind === 'content' && !target.neighborId) {
          if (userInteractions?.onContentClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'cluster') {
          if (userInteractions?.onClusterClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'triangle') {
          if (userInteractions?.onTriangleClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'background') {
          if (userInteractions?.onBackgroundClick?.(rawEvent) === true) {
            return true;
          }
        }
        if (userInteractions?.onLeftClick?.(target, rawEvent) === true) {
          return true;
        }
        if (this.engine.getZoomStrategy().mode === 'drill-down') {
          if (target.kind === 'triangle') {
            if (target.triangle.neighborId) {
              this.drillToNeighbor(target.triangle.neighborId);
            } else if (!target.triangle.isContext) {
              this.drillDownTriangle(target.triangle.index);
            }
          } else if (target.kind === 'cluster') {
            if (target.neighborId) {
              this.drillToNeighbor(target.neighborId);
            } else {
              this.drillDownCluster(target.cluster.clusterUid);
            }
          } else if (target.kind === 'content' && target.neighborId) {
            this.drillToNeighbor(target.neighborId);
          } else if (target.kind === 'background') {
            this.drillUp();
          }
          return false;
        }
        if (target.kind === 'cluster' && this.focusOnClusterClick) {
          if (this.focusedTriangleIndexState !== null) {
            this.setFocusedTriangleIndex(null);
          }
          const next =
            this.focusedClusterUidState === target.cluster.clusterUid
              ? null
              : target.cluster.clusterUid;
          this.setFocusedClusterUid(next);
        } else if (target.kind === 'triangle' && this.focusOnTriangleClick) {
          if (this.focusedClusterUidState !== null) {
            this.setFocusedClusterUid(null);
          }
          const next =
            this.focusedTriangleIndexState === target.triangle.index
              ? null
              : target.triangle.index;
          this.setFocusedTriangleIndex(next);
        } else if (target.kind === 'background') {
          if (this.focusedClusterUidState !== null) {
            this.setFocusedClusterUid(null);
          }
          if (this.focusedTriangleIndexState !== null) {
            this.setFocusedTriangleIndex(null);
          }
        }
        return false;
      },
      onRightClick: userInteractions?.onRightClick,
      onWheel: userInteractions?.onWheel ?? 'zoom-to-cursor',
    };
  }

  private attachFontLoadListener(): void {
    const doc = this.containerEl.ownerDocument;
    const fontSet = doc?.fonts;
    if (!fontSet) return;

    let readyTriggeredByEvent = false;
    let readyTimedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const onLoadingDone = (): void => {
      if (this.destroyed) return;
      readyTriggeredByEvent = true;
      this.relayout();
    };

    if (typeof fontSet.addEventListener === 'function') {
      fontSet.addEventListener('loadingdone', onLoadingDone);
    }

    if (fontSet.status !== 'loaded' && fontSet.ready && typeof fontSet.ready.then === 'function') {
      timeoutId = setTimeout(() => {
        readyTimedOut = true;
        timeoutId = null;
      }, 2000);
      fontSet.ready.then(
        () => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (this.destroyed || readyTimedOut || readyTriggeredByEvent) return;
          this.relayout();
        },
        () => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        },
      );
    }

    this.fontLoadCleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (typeof fontSet.removeEventListener === 'function') {
        fontSet.removeEventListener('loadingdone', onLoadingDone);
      }
    };
  }

  private formatContentTooltip(
    ev: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
  ): string {
    if (typeof this.tooltipOption === 'function') {
      return this.tooltipOption({ kind: 'content', ...ev });
    }
    const label = extractDefaultItemLabel(
      ev.item,
      ev.layoutContext.id,
      this.getLabelExtractor,
    );
    const tagList = ev.layoutContext.tags
      .map((t) => {
        if (t.label) return t.label;
        if (this.formatTagLabelFn) {
          const formatted = this.formatTagLabelFn(t.tag).trim();
          if (formatted.length > 0) return formatted;
        }
        return `#${t.tag}`;
      })
      .slice(0, 5)
      .join(' · ');
    const neighborHint = ev.neighborId ? '\nClick to switch to neighbor' : '';
    if (tagList) {
      return `${label}\n${tagList}${neighborHint}`;
    }
    const weightList = ev.layoutContext.unitClusters
      .map((uc) => `${uc.cluster.code} ${Math.round(uc.weight * 100)}%`)
      .join(' · ');
    return `${weightList ? `${label}\n${weightList}` : label}${neighborHint}`;
  }

  private formatClusterTooltip(
    ev: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
  ): string {
    if (typeof this.tooltipOption === 'function') {
      return this.tooltipOption({ kind: 'cluster', ...ev });
    }
    const count = ev.cluster.members.length;
    const base = `${ev.cluster.code} · ${ev.cluster.defaultLabel}\n${count} ${count === 1 ? 'item' : 'items'}`;
    return ev.neighborId ? `${base}\nClick to switch to neighbor` : base;
  }

  private formatTriangleTooltip(
    ev: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta>,
  ): string {
    if (typeof this.tooltipOption === 'function') {
      return this.tooltipOption({ kind: 'triangle', ...ev });
    }
    const corners = ev.triangle.clusters
      .map((c, idx) =>
        c ? c.code : `V${ev.triangle.vertexIndices[idx] ?? idx}`,
      )
      .join(' · ');
    const count = ev.triangle.coveredItemCount;
    if (ev.triangle.isContext) {
      return `Neighbor (${corners})\n${count} ${count === 1 ? 'item' : 'items'}${ev.triangle.neighborId ? '\nClick to switch to neighbor' : ''}`;
    }
    const zMode = this.engine.getZoomStrategy().mode;
    const zState = this.engine.getZoomState();
    const actionHint =
      zMode === 'drill-down'
        ? zState.activeFrameKind === 'triangle-focus' && zState.canDrillUp
          ? '\nClick to zoom out'
          : zState.drillableTriangleIndices.includes(ev.triangle.index)
            ? '\nClick to zoom in'
            : zState.focusableTriangleIndices.includes(ev.triangle.index)
              ? '\nClick to focus triangle'
              : ''
        : '';
    return `Triangle #${ev.triangle.index + 1} (${corners})\n${count} ${count === 1 ? 'item' : 'items'}${actionHint}`;
  }

  private applyTooltipThemeStyles(el: HTMLDivElement): void {
    const isLight = this.currentTheme === 'light';
    el.style.background = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9, 13, 22, 0.94)';
    el.style.border = isLight
      ? '1px solid rgba(203, 213, 225, 0.95)'
      : '1px solid rgba(51, 65, 85, 0.85)';
    el.style.color = isLight ? '#0f172a' : '#f1f5f9';
    el.style.boxShadow = isLight
      ? '0 10px 24px rgba(15, 23, 42, 0.12)'
      : '0 10px 24px rgba(0, 0, 0, 0.45)';
  }

  private ensureTooltipElement(): HTMLDivElement | null {
    if (!this.tooltipOption) return null;
    if (this.tooltipEl) return this.tooltipEl;

    const doc = this.containerEl.ownerDocument;
    const computedPos =
      typeof getComputedStyle !== 'undefined'
        ? getComputedStyle(this.containerEl).position
        : this.containerEl.style.position;
    if (!computedPos || computedPos === 'static') {
      this.containerEl.style.position = 'relative';
    }

    const el = doc.createElement('div');
    el.className = 'sv-tooltip';
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '20';
    el.style.display = 'none';
    el.style.maxWidth = '240px';
    el.style.padding = '7px 10px';
    el.style.borderRadius = '8px';
    el.style.fontFamily = 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
    el.style.fontSize = '12px';
    el.style.lineHeight = '1.4';
    el.style.whiteSpace = 'pre-line';
    this.applyTooltipThemeStyles(el);
    this.containerEl.appendChild(el);
    this.tooltipEl = el;
    return el;
  }

  private showTooltip(screenX: number, screenY: number, text: string): void {
    const el = this.ensureTooltipElement();
    if (!el || !text) return;
    el.textContent = text;
    el.style.display = 'block';
    const maxLeft = Math.max(8, (this.containerEl.clientWidth || 960) - 256);
    const maxTop = Math.max(8, (this.containerEl.clientHeight || 600) - 72);
    el.style.left = `${Math.min(Math.max(8, Math.round(screenX + 14)), maxLeft)}px`;
    el.style.top = `${Math.min(Math.max(8, Math.round(screenY + 14)), maxTop)}px`;
  }

  private hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.style.display = 'none';
    }
  }

  get camera(): CameraController {
    return this.cameraProxy;
  }

  /** Active headless timeline controller when `timeline` is enabled, or `null` otherwise. */
  get timeline(): SimplexTimelineController<TItem> | null {
    return this.timelineController;
  }

  /** Returns the active headless timeline controller, or `null` when timeline mode is disabled. */
  getTimeline(): SimplexTimelineController<TItem> | null {
    return this.timelineController;
  }

  /**
   * Subscribes to timeline state changes (including enabling/disabling timeline mode at runtime).
   * Invokes `listener` immediately with the current state (or `null`) and returns an unsubscribe handle.
   */
  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void {
    this.timelineStateListeners.add(listener);
    listener(this.timelineController?.getState() ?? null);
    return () => {
      this.timelineStateListeners.delete(listener);
    };
  }

  /**
   * Dynamically enables, updates, or disables timeline playback at runtime.
   */
  setTimelineOptions(
    timeline: boolean | TimelinePlayerOptions<TItem> | undefined,
  ): void {
    if (this.destroyed) return;
    if (!timeline) {
      if (!this.timelineController) return;
      const hadAutoFinalSeed = this.timelineAutoFinalSeed;
      const hadAutoFinalSeedLayout = this.timelineAutoFinalSeedLayout !== false;
      this.detachTimelineController();
      this.timelineAutoFinalSeed = true;
      this.timelineAutoFinalSeedLayout = false;
      this.timelineEmptyClusterBehavior = undefined;
      this.lastTimelineActiveItems = null;
      this.syncTimelineOverlay(null);
      this.engine.setCanonicalSeedItems(null);
      if (this.rawClusteringStrategy) {
        this.engine.setClusteringStrategy(this.rawClusteringStrategy);
      } else if (hadAutoFinalSeed) {
        this.engine.setClusteringStrategy(
          createSoftSimplexTagClusteringStrategy<TItem, TTagMeta>(),
        );
      }
      if (hadAutoFinalSeedLayout) {
        this.engine.setLayoutStrategy(
          this.rawLayoutStrategy ?? createCollisionDrivenLayoutStrategy(),
        );
      }
      this.engine.setEmptyClusterBehavior(this.baseEmptyClusterBehavior);
      this.engine.setItems(this.fullCorpusItems);
      this.notifyTimelineListeners(null);
      this.ensureLoopRunning();
      return;
    }

    const opts: TimelinePlayerOptions<TItem> = timeline === true ? {} : timeline;
    const prevAutoFinalSeed = this.timelineAutoFinalSeed;
    const prevAutoFinalSeedLayout = this.timelineAutoFinalSeedLayout;
    this.timelineShowControls = opts.showControls ?? true;
    this.timelinePosition = opts.position ?? 'bottom';
    this.timelineAutoFinalSeed = opts.autoFinalSeed ?? true;
    this.timelineAutoFinalSeedLayout = this.normalizeAutoFinalSeedLayout(
      opts.autoFinalSeedLayout,
    );
    this.timelineEmptyClusterBehavior = opts.emptyClusterBehavior;
    this.timelineOnStateChange = opts.onStateChange;

    this.detachTimelineController();
    this.timelineController = createSimplexTimeline(this.fullCorpusItems, opts);
    this.engine.setCanonicalSeedItems(this.fullCorpusItems);
    const effectiveClustering = this.resolveEffectiveClusteringStrategy(
      this.rawClusteringStrategy,
      this.fullCorpusItems,
    );
    if (effectiveClustering) {
      this.engine.setClusteringStrategy(effectiveClustering);
    } else if (prevAutoFinalSeed) {
      this.engine.setClusteringStrategy(
        createSoftSimplexTagClusteringStrategy<TItem, TTagMeta>(),
      );
    }
    const effectiveLayout = this.resolveEffectiveLayoutStrategy(this.rawLayoutStrategy);
    if (effectiveLayout) {
      this.engine.setLayoutStrategy(effectiveLayout);
    } else if (prevAutoFinalSeedLayout !== false) {
      this.engine.setLayoutStrategy(
        this.rawLayoutStrategy ?? createCollisionDrivenLayoutStrategy(),
      );
    }
    this.engine.setEmptyClusterBehavior(
      this.timelineEmptyClusterBehavior ?? this.baseEmptyClusterBehavior,
    );
    const activeItems = this.timelineController.getActiveItems();
    this.lastTimelineActiveItems = activeItems;
    this.engine.setItems(activeItems);
    this.attachTimelineController(this.timelineController);
    this.ensureLoopRunning();
  }

  getSvgElement(): SVGSVGElement {
    return this.svgEl;
  }

  getMetrics(): LayoutMetrics {
    return this.engine.getMetrics();
  }

  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] {
    return this.engine.getClusters();
  }

  getItems(): readonly TItem[] {
    return this.engine.getItems();
  }

  addItems(items: TItem | readonly TItem[]): void {
    const incoming = Array.isArray(items) ? (items as readonly TItem[]) : [items as TItem];
    if (incoming.length === 0) return;

    const byId = new Map<string, number>();
    const merged = this.fullCorpusItems.slice();
    merged.forEach((item, idx) => {
      const id = this.getIdExtractor(item);
      if (id) byId.set(id, idx);
    });
    for (const item of incoming) {
      const id = this.getIdExtractor(item);
      if (id && byId.has(id)) {
        merged[byId.get(id)!] = item;
      } else {
        if (id) byId.set(id, merged.length);
        merged.push(item);
      }
    }
    this.fullCorpusItems = merged;
    this.lastExternalItemsRef = merged;

    if (this.timelineController) {
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.syncFinalSeededClusteringForCorpus(this.fullCorpusItems);
      this.timelineController.setItems(this.fullCorpusItems);
      this.ensureLoopRunning();
      return;
    }

    this.engine.addItems(items);
    this.ensureLoopRunning();
  }

  removeItems(ids: string | readonly string[]): void {
    const idList = Array.isArray(ids) ? (ids as readonly string[]) : [ids as string];
    const removeSet = new Set(idList);
    if (removeSet.size === 0) return;

    const filtered = this.fullCorpusItems.filter(
      (item) => !removeSet.has(this.getIdExtractor(item)),
    );
    this.fullCorpusItems = filtered;
    this.lastExternalItemsRef = filtered;

    if (this.timelineController) {
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.syncFinalSeededClusteringForCorpus(this.fullCorpusItems);
      this.timelineController.setItems(this.fullCorpusItems);
      this.ensureLoopRunning();
      return;
    }

    this.engine.removeItems(ids);
    this.ensureLoopRunning();
  }

  setItems(items: readonly TItem[]): void {
    if (this.timelineController) {
      if (items === this.lastExternalItemsRef) {
        return;
      }
      this.lastExternalItemsRef = items;
      this.fullCorpusItems = items.slice();
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.syncFinalSeededClusteringForCorpus(this.fullCorpusItems);
      this.timelineController.setItems(this.fullCorpusItems);
      this.ensureLoopRunning();
      return;
    }
    this.lastExternalItemsRef = items;
    this.fullCorpusItems = items.slice();
    this.engine.setItems(items);
    this.ensureLoopRunning();
  }

  /**
   * Switches between built-in presets (`'geometric'`, `'glyphs'`, `'badges'`) with smooth
   * morph/crossfade transitions.
   */
  setPreset(preset: SimplexVisualPreset, getLabel?: (item: TItem) => string): void {
    this.currentPreset = preset;
    if (getLabel !== undefined) {
      this.getLabelExtractor = getLabel;
    }
    const views = createPresetViews(preset);
    const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(preset, {
      getLabel: this.getLabelExtractor,
      theme: this.currentTheme,
      formatTagLabel: this.formatTagLabelFn,
      badgeOptions: this.badgeOptions,
      getShape: this.getShapeOption,
    });
    this.adapter.setViews({
      contentView: views.contentView as unknown as SvgNodeView<TContentVisual>,
      clusterView: views.clusterView as unknown as SvgNodeView<TClusterVisual>,
    });
    this.engine.setVisualResolver(
      resolver as unknown as VisualResolver<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    );
    this.ensureLoopRunning();
  }

  /**
   * Switches built-in preset & tooltip theme between `'dark'` and `'light'`.
   */
  setTheme(theme: SimplexTheme): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    if (this.tooltipEl) {
      this.applyTooltipThemeStyles(this.tooltipEl);
    }
    this.adapter.setTheme(theme);
    this.engine.setTheme(theme);
    if (!this.usesCustomVisualResolver) {
      const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
        this.currentPreset,
        {
          getLabel: this.getLabelExtractor,
          theme,
          formatTagLabel: this.formatTagLabelFn,
          badgeOptions: this.badgeOptions,
          getShape: this.getShapeOption,
        },
      );
      this.engine.setVisualResolver(
        resolver as unknown as VisualResolver<
          TItem,
          TContentVisual,
          TClusterVisual,
          TTagMeta,
          TClusterMeta
        >,
      );
    }
    this.syncZoomOverlays(this.engine.getZoomState());
    if (this.timelineController) {
      this.syncTimelineOverlay(this.timelineController.getState());
    }
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.engine.setMeshStrategy(strategy);
    this.ensureLoopRunning();
  }

  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    this.rawClusteringStrategy = strategy;
    const effective =
      this.resolveEffectiveClusteringStrategy(strategy, this.fullCorpusItems) ??
      strategy;
    this.engine.setClusteringStrategy(effective);
    this.ensureLoopRunning();
  }

  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.engine.setColorStrategy(strategy);
    this.ensureLoopRunning();
  }

  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    this.rawLayoutStrategy = strategy;
    const effective = this.resolveEffectiveLayoutStrategy(strategy) ?? strategy;
    this.engine.setLayoutStrategy(effective);
    this.ensureLoopRunning();
  }

  setZoomStrategy(
    strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>,
  ): void {
    this.engine.setZoomStrategy(strategy);
    this.ensureLoopRunning();
  }

  setZoomUiOptions(options: {
    readonly showZoomBreadcrumbs?: boolean;
  }): void {
    if (options.showZoomBreadcrumbs !== undefined) {
      this.showZoomBreadcrumbs = options.showZoomBreadcrumbs;
    }
    this.syncZoomOverlays(this.engine.getZoomState());
  }

  getMeshStrategy(): SimplexMeshStrategy<TItem> {
    return this.engine.getMeshStrategy();
  }

  getClusteringStrategy(): SimplexClusteringStrategy<TItem, TTagMeta> {
    return this.engine.getClusteringStrategy();
  }

  getColorStrategy(): SimplexColorStrategy<TItem, TTagMeta> {
    return this.engine.getColorStrategy();
  }

  getLayoutStrategy(): SimplexLayoutStrategy {
    return this.engine.getLayoutStrategy();
  }

  getZoomStrategy(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
    return this.engine.getZoomStrategy();
  }

  getZoomState(): SimplexZoomState {
    return this.engine.getZoomState();
  }

  drillDownTriangle(triangleIndex: number): boolean {
    const ok = this.engine.drillDownTriangle(triangleIndex);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillDownCluster(clusterUid: string): boolean {
    const ok = this.engine.drillDownCluster(clusterUid);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillToNeighbor(neighborId: string): boolean {
    const ok = this.engine.drillToNeighbor(neighborId);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillUp(): boolean {
    const ok = this.engine.drillUp();
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillToDepth(depth: number): boolean {
    const ok = this.engine.drillToDepth(depth);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillToRoot(): boolean {
    const ok = this.engine.drillToRoot();
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  setMeshOptions(options: MeshOptions): void {
    this.engine.setMeshOptions(options);
    this.ensureLoopRunning();
  }

  setLayoutOptions(options: LayoutSolverOptions): void {
    this.engine.setLayoutOptions(options);
    this.ensureLoopRunning();
  }

  setTooltip(
    tooltip:
      | boolean
      | SimplexTooltipFormatter<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
  ): void {
    this.tooltipOption = tooltip;
    if (!tooltip) {
      this.hideTooltip();
    }
  }

  setVisualResolver(
    resolver: VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.engine.setVisualResolver(resolver);
    this.ensureLoopRunning();
  }

  setViews(
    views: Partial<
      Omit<
        SvgRendererOptions<
          TContentVisual,
          TClusterVisual,
          TItem,
          TTagMeta,
          TClusterMeta
        >,
        'theme'
      >
    >,
  ): void {
    this.adapter.setViews(views);
    if (views.triangleView !== undefined || views.edgeView !== undefined) {
      this.engine.renderNow();
    }
    this.ensureLoopRunning();
  }

  /** Swaps the triangulation face view plugin (`SvgTriangleView`) at runtime. */
  setTriangleView(view: SvgTriangleView<TItem, TTagMeta, TClusterMeta>): void {
    this.adapter.setViews({ triangleView: view });
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Swaps the triangulation edge view plugin (`SvgEdgeView`) at runtime. */
  setEdgeView(view: SvgEdgeView<TItem, TTagMeta, TClusterMeta>): void {
    this.adapter.setViews({ edgeView: view });
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  setSizeMultiplier(multiplier: number): void {
    this.engine.setSizeMultiplier(multiplier);
    this.ensureLoopRunning();
  }

  setShowHulls(show: boolean): void {
    this.engine.setShowHulls(show);
    this.ensureLoopRunning();
  }

  /** Returns the active empty-cluster rendering behavior (`'normal' | 'dim' | 'hide'`). */
  getEmptyClusterBehavior(): EmptyClusterBehavior {
    return this.engine.getEmptyClusterBehavior();
  }

  /** Configures how clusters with `0` active member items are rendered (`'normal' | 'dim' | 'hide'`). */
  setEmptyClusterBehavior(behavior: EmptyClusterBehavior): void {
    this.baseEmptyClusterBehavior = behavior;
    this.engine.setEmptyClusterBehavior(behavior);
    this.ensureLoopRunning();
  }

  setInteractions(
    interactions: InteractionHandlers<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.engine.setInteractions(this.wrapInteractions(interactions));
  }

  setPinnedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this.engine.setPinnedIds(ids);
    this.ensureLoopRunning();
  }

  setHighlightedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this.engine.setHighlightedIds(ids);
    this.ensureLoopRunning();
  }

  setFocusedClusterUid(clusterUid: string | null): void {
    this.focusedClusterUidState = clusterUid;
    this.engine.setFocusedClusterUid(clusterUid);
    this.ensureLoopRunning();
  }

  /** Focuses a specific mesh triangle face by index (dimming unrelated faces and nodes) or clears with `null`. */
  setFocusedTriangleIndex(triangleIndex: number | null): void {
    this.focusedTriangleIndexState = triangleIndex;
    this.engine.setFocusedTriangleIndex(triangleIndex);
    this.ensureLoopRunning();
  }

  /**
   * Clears cached SVG hull measurements, re-measures all active nodes, and re-solves
   * the current layout frame cleanly (for example after late webfont loading).
   */
  relayout(): void {
    if (this.destroyed) return;
    this.adapter.invalidateHulls();
    this.engine.relayout();
    this.ensureLoopRunning();
  }

  /** Deterministically advances simulation & timeline clocks in tests without waiting for rAF. */
  stepForTest(dtMs: number): boolean {
    this.timelineController?.tick(dtMs);
    return this.engine.step(dtMs);
  }

  private toLocalCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.svgEl.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private resetTouchPinchState(): void {
    this.lastPinchDist = null;
    this.pinchStartDist = null;
    this.pinchHandledInGesture = false;
    this.lastPinchMid = null;
  }

  private triggerPinchDrillIn(screenX: number, screenY: number): boolean {
    const zState = this.engine.getZoomState();
    const hit = this.engine.hitTest(screenX, screenY);
    if (hit.kind === 'triangle') {
      if (hit.triangle.neighborId) {
        return this.drillToNeighbor(hit.triangle.neighborId);
      }
      if (!hit.triangle.isContext && zState.activeFrameKind !== 'triangle-focus') {
        return this.drillDownTriangle(hit.triangle.index);
      }
      return false;
    }
    if (hit.kind === 'cluster') {
      if (hit.neighborId) {
        return this.drillToNeighbor(hit.neighborId);
      }
      return this.drillDownCluster(hit.cluster.clusterUid);
    }
    const candidateTriIndices =
      zState.drillableTriangleIndices.length > 0
        ? zState.drillableTriangleIndices
        : zState.focusableTriangleIndices;
    if (hit.kind === 'content') {
      const mesh = this.engine.getMesh();
      if (mesh) {
        for (const triIdx of candidateTriIndices) {
          const tri = mesh.triangles[triIdx];
          if (!tri) continue;
          const p0 = mesh.vertices[tri.vertices[0]]!;
          const p1 = mesh.vertices[tri.vertices[1]]!;
          const p2 = mesh.vertices[tri.vertices[2]]!;
          if (isPointInTriangle(hit.worldPosition.x, hit.worldPosition.y, p0, p1, p2)) {
            return this.drillDownTriangle(triIdx);
          }
        }
      }
      const primaryCluster = hit.layoutContext.unitClusters[0]?.cluster;
      if (primaryCluster && zState.drillableClusterUids.includes(primaryCluster.clusterUid)) {
        return this.drillDownCluster(primaryCluster.clusterUid);
      }
    }
    // Background fallback: drill into the closest drillable or focusable triangle
    if (candidateTriIndices.length > 0) {
      const mesh = this.engine.getMesh();
      if (mesh) {
        let bestIdx = candidateTriIndices[0]!;
        let bestDist = Infinity;
        for (const triIdx of candidateTriIndices) {
          const tri = mesh.triangles[triIdx];
          if (!tri) continue;
          const p0 = mesh.vertices[tri.vertices[0]]!;
          const p1 = mesh.vertices[tri.vertices[1]]!;
          const p2 = mesh.vertices[tri.vertices[2]]!;
          const cx = (p0.x + p1.x + p2.x) / 3;
          const cy = (p0.y + p1.y + p2.y) / 3;
          const d = Math.hypot(cx - hit.worldPosition.x, cy - hit.worldPosition.y);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = triIdx;
          }
        }
        return this.drillDownTriangle(bestIdx);
      }
    }
    return false;
  }

  private ensureContainerPositioned(): void {
    const computedPos =
      typeof getComputedStyle !== 'undefined'
        ? getComputedStyle(this.containerEl).position
        : this.containerEl.style.position;
    if (!computedPos || computedPos === 'static') {
      this.containerEl.style.position = 'relative';
    }
  }

  private syncZoomOverlays(state: SimplexZoomState): void {
    if (this.destroyed) return;
    const isLight = this.currentTheme === 'light';

    // Built-in Drill Breadcrumb Strip (unless disabled by host wrapper)
    if (
      this.showZoomBreadcrumbs &&
      state.mode === 'drill-down' &&
      state.depth > 0
    ) {
      this.ensureContainerPositioned();
      const doc = this.containerEl.ownerDocument;
      if (!this.breadcrumbOverlayEl) {
        const el = doc.createElement('div');
        el.className = 'sv-zoom-breadcrumbs';
        el.style.position = 'absolute';
        el.style.top = '12px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '16';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '3px';
        el.style.maxWidth = 'calc(100% - 24px)';
        el.style.overflowX = 'auto';
        el.style.whiteSpace = 'nowrap';
        el.style.padding = '4px 9px';
        el.style.borderRadius = '8px';
        el.style.backdropFilter = 'blur(8px)';
        el.style.fontFamily =
          'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
        el.style.fontSize = '11px';
        this.containerEl.appendChild(el);
        this.breadcrumbOverlayEl = el;
      }
      this.breadcrumbOverlayEl.style.display = 'flex';
      this.breadcrumbOverlayEl.style.background = isLight
        ? 'rgba(255, 255, 255, 0.95)'
        : 'rgba(11, 15, 23, 0.93)';
      this.breadcrumbOverlayEl.style.border = isLight
        ? '1px solid rgba(203, 213, 225, 0.95)'
        : '1px solid rgba(51, 65, 85, 0.92)';
      this.breadcrumbOverlayEl.style.boxShadow = isLight
        ? '0 4px 14px rgba(15, 23, 42, 0.08)'
        : '0 4px 16px rgba(0, 0, 0, 0.36)';
      this.breadcrumbOverlayEl.style.color = isLight ? '#0f172a' : '#e2e8f0';

      while (this.breadcrumbOverlayEl.firstChild) {
        this.breadcrumbOverlayEl.removeChild(this.breadcrumbOverlayEl.firstChild);
      }

      state.breadcrumbs.forEach((crumb, idx) => {
        if (idx > 0) {
          const sep = doc.createElement('span');
          sep.textContent = '›';
          sep.style.opacity = '0.48';
          sep.style.fontSize = '12px';
          sep.style.padding = '0 1px';
          this.breadcrumbOverlayEl!.appendChild(sep);
        }
        const isCurrent = idx === state.depth;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.title = crumb.label;
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '4px';
        btn.style.cursor = isCurrent ? 'default' : 'pointer';
        btn.style.fontWeight = isCurrent ? '700' : '500';
        btn.style.color = isCurrent
          ? isLight
            ? '#0f172a'
            : '#f8fafc'
          : isLight
            ? '#475569'
            : '#94a3b8';
        btn.style.background = isCurrent
          ? isLight
            ? 'rgba(241, 245, 249, 0.95)'
            : 'rgba(30, 41, 59, 0.72)'
          : 'transparent';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.style.padding = '2px 6px';

        const segs = crumb.segments;
        if (idx > 0 && segs && segs.length > 0) {
          segs.forEach((seg, sIdx) => {
            if (sIdx > 0) {
              const dotSep = doc.createElement('span');
              dotSep.textContent = '·';
              dotSep.style.opacity = '0.5';
              btn.appendChild(dotSep);
            }
            if (seg.colorHex) {
              const pip = doc.createElement('span');
              pip.style.display = 'inline-block';
              pip.style.width = '6px';
              pip.style.height = '6px';
              pip.style.borderRadius = '9999px';
              pip.style.background = seg.colorHex;
              pip.style.boxShadow = isLight
                ? '0 0 0 1px rgba(15, 23, 42, 0.16)'
                : '0 0 0 1px rgba(255, 255, 255, 0.35)';
              pip.style.flexShrink = '0';
              btn.appendChild(pip);
            }
            const lbl = doc.createElement('span');
            lbl.textContent = seg.label;
            btn.appendChild(lbl);
          });
        } else {
          btn.textContent = crumb.shortLabel;
        }

        if (!isCurrent) {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.drillToDepth(crumb.depth);
          });
        }
        this.breadcrumbOverlayEl!.appendChild(btn);
      });
    } else if (this.breadcrumbOverlayEl) {
      this.breadcrumbOverlayEl.style.display = 'none';
    }
  }

  private normalizeAutoFinalSeedLayout(
    option: boolean | FinalSeededLayoutScaleMode | undefined,
  ): FinalSeededLayoutScaleMode | false {
    if (option === true) return 'pinned';
    if (option === 'pinned' || option === 'adaptive') return option;
    return false;
  }

  private resolveEffectiveLayoutStrategy(
    baseStrategy: SimplexLayoutStrategy | undefined,
  ): SimplexLayoutStrategy | undefined {
    if (!this.timelineController || !this.timelineAutoFinalSeedLayout) {
      return baseStrategy;
    }
    if (baseStrategy && baseStrategy.name.startsWith('final-seeded(')) {
      return baseStrategy;
    }
    return createFinalSeededLayoutStrategy(baseStrategy, {
      scaleMode: this.timelineAutoFinalSeedLayout,
    });
  }

  private resolveEffectiveClusteringStrategy(
    baseStrategy: SimplexClusteringStrategy<TItem, TTagMeta> | undefined,
    seedItems: readonly TItem[],
  ): SimplexClusteringStrategy<TItem, TTagMeta> | undefined {
    if (
      !this.timelineController ||
      !this.timelineAutoFinalSeed ||
      seedItems.length === 0
    ) {
      return baseStrategy;
    }
    if (baseStrategy && baseStrategy.name.startsWith('final-seeded(')) {
      return baseStrategy;
    }
    return createFinalSeededClusteringStrategy<TItem, TTagMeta>(baseStrategy, {
      seedItems,
    });
  }

  private syncFinalSeededClusteringForCorpus(seedItems: readonly TItem[]): void {
    if (!this.timelineController || !this.timelineAutoFinalSeed) return;
    if (
      this.rawClusteringStrategy &&
      this.rawClusteringStrategy.name.startsWith('final-seeded(')
    ) {
      return;
    }
    const nextStrategy = this.resolveEffectiveClusteringStrategy(
      this.rawClusteringStrategy,
      seedItems,
    );
    if (nextStrategy) {
      this.engine.setClusteringStrategy(nextStrategy);
    }
  }

  private notifyTimelineListeners(
    state: SimplexTimelineState<TItem> | null,
  ): void {
    if (state) {
      this.timelineOnStateChange?.(state);
    }
    for (const listener of this.timelineStateListeners) {
      listener(state);
    }
  }

  private detachTimelineController(): void {
    this.timelineUnsubscribe?.();
    this.timelineUnsubscribe = null;
    this.timelineController?.destroy();
    this.timelineController = null;
  }

  private attachTimelineController(
    controller: SimplexTimelineController<TItem>,
  ): void {
    this.timelineUnsubscribe = controller.subscribe((state) => {
      if (this.destroyed) return;
      if (state.activeItems !== this.lastTimelineActiveItems) {
        this.lastTimelineActiveItems = state.activeItems;
        this.engine.setItems(state.activeItems);
      }
      this.syncTimelineOverlay(state);
      this.notifyTimelineListeners(state);
      this.ensureLoopRunning();
    });
    const initialState = controller.getState();
    this.syncTimelineOverlay(initialState);
    this.notifyTimelineListeners(initialState);
  }

  private createTimelineIconSvg(
    doc: Document,
    kind: 'play' | 'pause' | 'prev' | 'next',
  ): SVGSVGElement {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    if (kind === 'play') {
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '3,1.8 10.2,6 3,10.2');
      svg.appendChild(poly);
    } else if (kind === 'pause') {
      const r1 = doc.createElementNS(SVG_NS, 'rect');
      r1.setAttribute('x', '2.5');
      r1.setAttribute('y', '2');
      r1.setAttribute('width', '2.5');
      r1.setAttribute('height', '8');
      r1.setAttribute('rx', '0.6');
      const r2 = doc.createElementNS(SVG_NS, 'rect');
      r2.setAttribute('x', '7');
      r2.setAttribute('y', '2');
      r2.setAttribute('width', '2.5');
      r2.setAttribute('height', '8');
      r2.setAttribute('rx', '0.6');
      svg.appendChild(r1);
      svg.appendChild(r2);
    } else if (kind === 'prev') {
      const bar = doc.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', '2');
      bar.setAttribute('y', '2.2');
      bar.setAttribute('width', '1.6');
      bar.setAttribute('height', '7.6');
      bar.setAttribute('rx', '0.5');
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '9.8,2.2 4.2,6 9.8,9.8');
      svg.appendChild(bar);
      svg.appendChild(poly);
    } else {
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '2.2,2.2 7.8,6 2.2,9.8');
      const bar = doc.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', '8.4');
      bar.setAttribute('y', '2.2');
      bar.setAttribute('width', '1.6');
      bar.setAttribute('height', '7.6');
      bar.setAttribute('rx', '0.5');
      svg.appendChild(poly);
      svg.appendChild(bar);
    }
    return svg;
  }

  private styleTimelineButton(
    btn: HTMLButtonElement,
    isLight: boolean,
    disabled: boolean,
    accent = false,
  ): void {
    btn.disabled = disabled;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.width = '24px';
    btn.style.height = '24px';
    btn.style.padding = '0';
    btn.style.borderRadius = '6px';
    btn.style.border = 'none';
    btn.style.flexShrink = '0';
    btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    btn.style.opacity = disabled ? '0.38' : '1';
    if (accent) {
      btn.style.background = isLight
        ? 'rgba(15, 23, 42, 0.92)'
        : 'rgba(226, 232, 240, 0.94)';
      btn.style.color = isLight ? '#f8fafc' : '#0f172a';
    } else {
      btn.style.background = isLight
        ? 'rgba(241, 245, 249, 0.9)'
        : 'rgba(30, 41, 59, 0.72)';
      btn.style.color = isLight ? '#334155' : '#cbd5e1';
    }
  }

  private syncTimelineOverlay(
    state: SimplexTimelineState<TItem> | null,
  ): void {
    if (this.destroyed) return;
    if (!state || !this.timelineShowControls || state.frames.length === 0) {
      if (this.timelineOverlayEl) {
        this.timelineOverlayEl.style.display = 'none';
      }
      return;
    }

    const isLight = this.currentTheme === 'light';
    const doc = this.containerEl.ownerDocument;
    this.ensureContainerPositioned();

    if (!this.timelineOverlayEl || !this.timelineUiRefs) {
      const el = doc.createElement('div');
      el.className = 'sv-timeline-bar';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Timeline playback controls');
      el.style.position = 'absolute';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
      el.style.zIndex = '17';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '6px';
      el.style.maxWidth = 'calc(100% - 24px)';
      el.style.padding = '5px 10px';
      el.style.borderRadius = '8px';
      el.style.backdropFilter = 'blur(8px)';
      el.style.fontFamily =
        'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
      el.style.fontSize = '11px';

      const stopEvt = (ev: Event) => {
        ev.stopPropagation();
      };
      el.addEventListener('pointerdown', stopEvt);
      el.addEventListener('click', stopEvt);
      el.addEventListener('wheel', stopEvt);

      const playBtn = doc.createElement('button');
      playBtn.type = 'button';
      playBtn.setAttribute('data-sv-timeline-action', 'toggle');
      playBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.timelineController?.toggle();
      });

      const prevBtn = doc.createElement('button');
      prevBtn.type = 'button';
      prevBtn.setAttribute('data-sv-timeline-action', 'prev');
      prevBtn.setAttribute('aria-label', 'Previous step');
      prevBtn.title = 'Previous step';
      prevBtn.appendChild(this.createTimelineIconSvg(doc, 'prev'));
      prevBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.timelineController?.pause();
        this.timelineController?.stepBy(-1);
      });

      const scrubber = doc.createElement('input');
      scrubber.type = 'range';
      scrubber.min = '0';
      scrubber.step = '1';
      scrubber.setAttribute('data-sv-timeline-action', 'scrubber');
      scrubber.setAttribute('aria-label', 'Timeline step');
      scrubber.style.width = '128px';
      scrubber.style.minWidth = '64px';
      scrubber.style.margin = '0 2px';
      scrubber.style.cursor = 'pointer';
      scrubber.addEventListener('input', (ev) => {
        ev.stopPropagation();
        const nextVal = Number((ev.target as HTMLInputElement).value);
        this.timelineController?.pause();
        this.timelineController?.seek(nextVal);
      });

      const nextBtn = doc.createElement('button');
      nextBtn.type = 'button';
      nextBtn.setAttribute('data-sv-timeline-action', 'next');
      nextBtn.setAttribute('aria-label', 'Next step');
      nextBtn.title = 'Next step';
      nextBtn.appendChild(this.createTimelineIconSvg(doc, 'next'));
      nextBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.timelineController?.pause();
        this.timelineController?.stepBy(1);
      });

      const labelEl = doc.createElement('span');
      labelEl.setAttribute('data-sv-timeline-label', '');
      labelEl.style.fontWeight = '600';
      labelEl.style.whiteSpace = 'nowrap';
      labelEl.style.paddingLeft = '2px';

      const countEl = doc.createElement('span');
      countEl.setAttribute('data-sv-timeline-count', '');
      countEl.style.fontVariantNumeric = 'tabular-nums';
      countEl.style.whiteSpace = 'nowrap';
      countEl.style.fontSize = '10px';

      el.appendChild(playBtn);
      el.appendChild(prevBtn);
      el.appendChild(scrubber);
      el.appendChild(nextBtn);
      el.appendChild(labelEl);
      el.appendChild(countEl);

      this.containerEl.appendChild(el);
      this.timelineOverlayEl = el;
      this.timelineUiRefs = {
        playBtn,
        prevBtn,
        nextBtn,
        scrubber,
        labelEl,
        countEl,
      };
    }

    const el = this.timelineOverlayEl;
    const refs = this.timelineUiRefs;

    el.style.display = 'flex';
    if (this.timelinePosition === 'top') {
      el.style.top = '12px';
      el.style.bottom = '';
    } else {
      el.style.bottom = '12px';
      el.style.top = '';
    }
    el.style.background = isLight
      ? 'rgba(255, 255, 255, 0.95)'
      : 'rgba(11, 15, 23, 0.93)';
    el.style.border = isLight
      ? '1px solid rgba(203, 213, 225, 0.95)'
      : '1px solid rgba(51, 65, 85, 0.92)';
    el.style.boxShadow = isLight
      ? '0 4px 14px rgba(15, 23, 42, 0.08)'
      : '0 4px 16px rgba(0, 0, 0, 0.36)';
    el.style.color = isLight ? '#0f172a' : '#e2e8f0';

    while (refs.playBtn.firstChild) {
      refs.playBtn.removeChild(refs.playBtn.firstChild);
    }
    refs.playBtn.appendChild(
      this.createTimelineIconSvg(doc, state.playing ? 'pause' : 'play'),
    );
    refs.playBtn.setAttribute(
      'aria-label',
      state.playing ? 'Pause timeline' : 'Play timeline',
    );
    refs.playBtn.title = state.playing ? 'Pause' : 'Play';
    this.styleTimelineButton(
      refs.playBtn,
      isLight,
      state.totalSteps <= 0,
      true,
    );
    this.styleTimelineButton(refs.prevBtn, isLight, state.atStart);
    this.styleTimelineButton(refs.nextBtn, isLight, state.atEnd);

    refs.scrubber.max = String(state.totalSteps);
    refs.scrubber.value = String(state.step);
    refs.scrubber.disabled = state.totalSteps <= 0;
    refs.scrubber.style.accentColor = isLight ? '#0f172a' : '#e2e8f0';

    refs.labelEl.textContent = state.activeLabel;
    refs.labelEl.style.color = isLight ? '#0f172a' : '#f8fafc';
    refs.countEl.textContent = `${state.activeItemCount}/${state.totalItemCount}`;
    refs.countEl.style.color = isLight ? '#64748b' : '#94a3b8';
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    this.activePointers.set(e.pointerId, { x, y });

    if (this.activePointers.size >= 2) {
      this.isDraggingPan = false;
      this.dragMoved = true;
      const pts = [...this.activePointers.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      this.lastPinchDist = dist;
      this.pinchStartDist = dist;
      this.pinchHandledInGesture = false;
      this.lastPinchMid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
      this.hideTooltip();
      return;
    }

    if (this.engine.getZoomStrategy().mode === 'drill-down') {
      this.isDraggingPan = false;
      this.dragMoved = false;
      return;
    }

    const hit = this.engine.hitTest(x, y);
    if (hit.kind === 'background' || hit.kind === 'triangle') {
      this.isDraggingPan = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragMoved = false;
      if (hit.kind === 'background') {
        this.svgEl.style.cursor = 'grabbing';
      }
    } else {
      this.isDraggingPan = false;
      this.dragMoved = false;
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x, y });
    }

    const zoomMode = this.engine.getZoomStrategy().mode;

    if (this.activePointers.size >= 2) {
      const pts = [...this.activePointers.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const mid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };

      if (zoomMode === 'drill-down') {
        if (
          !this.pinchHandledInGesture &&
          this.pinchStartDist !== null &&
          this.pinchStartDist > 10 &&
          dist > 8
        ) {
          const ratio = dist / this.pinchStartDist;
          if (ratio >= 1.28) {
            this.pinchHandledInGesture = true;
            this.triggerPinchDrillIn(mid.x, mid.y);
          } else if (ratio <= 0.78) {
            this.pinchHandledInGesture = true;
            this.drillUp();
          }
        }
        this.dragMoved = true;
        this.lastPinchDist = dist;
        this.lastPinchMid = mid;
        this.hideTooltip();
        return;
      }

      if (this.lastPinchDist !== null && this.lastPinchMid !== null && this.lastPinchDist > 8 && dist > 8) {
        const dx = mid.x - this.lastPinchMid.x;
        const dy = mid.y - this.lastPinchMid.y;
        const zoomFactor = dist / this.lastPinchDist;
        this.engine.camera.panBy(dx, dy);
        this.engine.camera.zoomToCursor(mid.x, mid.y, zoomFactor);
        this.dragMoved = true;
        this.hideTooltip();
        this.engine.renderNow();
      }
      this.lastPinchDist = dist;
      this.lastPinchMid = mid;
      return;
    }

    if (this.isDraggingPan && zoomMode === 'free-camera') {
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      const dragThreshold = e.pointerType === 'touch' ? 6 : 3;
      if (Math.hypot(dx, dy) > dragThreshold) {
        this.dragMoved = true;
      }
      if (this.dragMoved) {
        this.svgEl.style.cursor = 'grabbing';
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.engine.camera.panBy(dx, dy);
        this.hideTooltip();
        this.engine.renderNow();
      }
      return;
    }

    if (e.pointerType === 'touch') {
      return;
    }
    this.engine.handlePointerMove(x, y);
    const hit = this.engine.hitTest(x, y);
    if (zoomMode === 'drill-down') {
      const zState = this.engine.getZoomState();
      if (hit.kind === 'triangle') {
        if (hit.triangle.neighborId) {
          this.svgEl.style.cursor = 'pointer';
        } else if (
          zState.activeFrameKind === 'triangle-focus' &&
          zState.canDrillUp
        ) {
          this.svgEl.style.cursor = 'zoom-out';
        } else {
          this.svgEl.style.cursor =
            zState.drillableTriangleIndices.includes(hit.triangle.index) ||
            zState.focusableTriangleIndices.includes(hit.triangle.index)
              ? 'zoom-in'
              : 'default';
        }
      } else if (hit.kind === 'cluster') {
        if (hit.neighborId) {
          this.svgEl.style.cursor = 'pointer';
        } else if (
          zState.activeFrameKind === 'cluster-star' &&
          hit.cluster.clusterIndex === 0 &&
          zState.canDrillUp
        ) {
          this.svgEl.style.cursor = 'zoom-out';
        } else {
          this.svgEl.style.cursor = zState.drillableClusterUids.includes(
            hit.cluster.clusterUid,
          )
            ? 'zoom-in'
            : 'default';
        }
      } else if (hit.kind === 'content') {
        this.svgEl.style.cursor = 'pointer';
      } else {
        this.svgEl.style.cursor = zState.canDrillUp ? 'zoom-out' : 'default';
      }
    } else {
      this.svgEl.style.cursor = hit.kind === 'background' ? 'grab' : 'pointer';
    }
    this.ensureLoopRunning();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.resetTouchPinchState();
    }
    if (this.activePointers.size === 0) {
      if (this.isDraggingPan) {
        this.isDraggingPan = false;
        this.svgEl.style.cursor =
          this.engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';
      } else {
        this.dragMoved = false;
      }
    }
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.resetTouchPinchState();
    }
    if (this.activePointers.size === 0) {
      this.isDraggingPan = false;
      this.dragMoved = false;
      this.svgEl.style.cursor =
        this.engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';
    }
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.resetTouchPinchState();
    }
    if (this.activePointers.size === 0) {
      this.isDraggingPan = false;
    }
    this.hideTooltip();
    this.engine.handlePointerLeave();
    this.ensureLoopRunning();
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    this.engine.handleLeftClick({
      screenX: x,
      screenY: y,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    this.ensureLoopRunning();
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    const suppress = this.engine.handleRightClick({
      screenX: x,
      screenY: y,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    if (suppress) {
      e.preventDefault();
    }
    this.ensureLoopRunning();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    // Support discrete trackpad pinch-in / pinch-out when in drill-down mode
    if (this.engine.getZoomStrategy().mode === 'drill-down' && e.ctrlKey) {
      e.preventDefault();
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now < this.wheelPinchCooldownUntil) return;
      this.wheelPinchAccum += e.deltaY;
      if (this.wheelPinchAccum <= -22) {
        this.wheelPinchAccum = 0;
        this.wheelPinchCooldownUntil = now + 360;
        this.triggerPinchDrillIn(x, y);
      } else if (this.wheelPinchAccum >= 22) {
        this.wheelPinchAccum = 0;
        this.wheelPinchCooldownUntil = now + 360;
        this.drillUp();
      }
      return;
    }
    const handled = this.engine.handleWheel({
      screenX: x,
      screenY: y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
    });
    if (handled) {
      e.preventDefault();
      this.ensureLoopRunning();
    }
  };

  private attachSvgListeners(): void {
    this.svgEl.addEventListener('pointerdown', this.onPointerDown);
    this.svgEl.addEventListener('pointermove', this.onPointerMove);
    this.svgEl.addEventListener('pointerup', this.onPointerUp);
    this.svgEl.addEventListener('pointercancel', this.onPointerCancel);
    this.svgEl.addEventListener('pointerleave', this.onPointerLeave);
    this.svgEl.addEventListener('click', this.onClick);
    this.svgEl.addEventListener('contextmenu', this.onContextMenu);
    this.svgEl.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private detachSvgListeners(): void {
    this.svgEl.removeEventListener('pointerdown', this.onPointerDown);
    this.svgEl.removeEventListener('pointermove', this.onPointerMove);
    this.svgEl.removeEventListener('pointerup', this.onPointerUp);
    this.svgEl.removeEventListener('pointercancel', this.onPointerCancel);
    this.svgEl.removeEventListener('pointerleave', this.onPointerLeave);
    this.svgEl.removeEventListener('click', this.onClick);
    this.svgEl.removeEventListener('contextmenu', this.onContextMenu);
    this.svgEl.removeEventListener('wheel', this.onWheel);
  }

  private ensureLoopRunning(): void {
    if (this.destroyed || this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      this.engine.renderNow();
      return;
    }
    this.lastFrameTs = performance.now();
    const tick = (now: number) => {
      if (this.destroyed) return;
      const dtMs = Math.max(1, Math.min(50, now - this.lastFrameTs));
      this.lastFrameTs = now;

      this.fpsSamples += 1;
      this.fpsAccumMs += dtMs;
      if (this.fpsAccumMs >= 320) {
        const fps = Math.round((this.fpsSamples * 1000) / this.fpsAccumMs);
        this.onFpsUpdate?.(fps);
        this.fpsSamples = 0;
        this.fpsAccumMs = 0;
      }

      this.timelineController?.tick(dtMs);
      const settled = this.engine.step(dtMs);
      const timelinePlaying = this.timelineController?.getState().playing ?? false;
      if (!settled || timelinePlaying) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Helper accessor matching `getId` when external callers inspect items. */
  getItemId(item: TItem): string {
    return this.getIdExtractor(item);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.detachTimelineController();
    this.timelineStateListeners.clear();
    this.resizeObserver?.disconnect();
    this.fontLoadCleanup?.();
    this.fontLoadCleanup = null;
    this.detachSvgListeners();
    this.engine.destroy();
    if (this.tooltipEl && this.tooltipEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.tooltipEl);
      this.tooltipEl = null;
    }
    if (this.breadcrumbOverlayEl && this.breadcrumbOverlayEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.breadcrumbOverlayEl);
      this.breadcrumbOverlayEl = null;
    }
    if (this.timelineOverlayEl && this.timelineOverlayEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.timelineOverlayEl);
      this.timelineOverlayEl = null;
      this.timelineUiRefs = null;
    }
    if (this.svgEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.svgEl);
    }
  }
}

/**
 * Convenience one-liner factory for mounting `@simplex-viz/svg` in Vanilla TypeScript,
 * Vue, Angular, Svelte, or Web Components.
 *
 * Accepts either an array of `{ id, tags }` items directly (with built-in presets,
 * cursor zoom, and cluster click-focus enabled) or a full options object.
 */
export function createSimplexSvg<TItem extends DefaultTaggedItem = DefaultTaggedItem>(
  target: HTMLElement | string,
  items: readonly TItem[],
): SimplexSvgController<TItem, DefaultContentPresetVisual, DefaultClusterPresetVisual>;
export function createSimplexSvg<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  target: HTMLElement | string,
  options: SimplexSvgControllerOptions<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): SimplexSvgController<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;
export function createSimplexSvg<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  target: HTMLElement | string,
  itemsOrOptions:
    | readonly TItem[]
    | SimplexSvgControllerOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
): SimplexSvgController<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> {
  if (Array.isArray(itemsOrOptions)) {
    return SimplexSvgController.createFromResolved(target, {
      items: itemsOrOptions,
      tooltip: true,
    });
  }
  return new SimplexSvgController(
    target,
    itemsOrOptions as SimplexSvgControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
}
