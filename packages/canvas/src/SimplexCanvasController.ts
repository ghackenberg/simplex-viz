import {
  SimplexGraphEngine,
  SimplexTimelineController,
  createSimplexTimelineHostSession,
  extractSimplexItemLabel,
  type CameraController,
  type ClusterDescriptor,
  type DefaultTaggedItem,
  type EmptyClusterBehavior,
  type FocusItemOptions,
  type InteractionHandlers,
  type ItemFilterOptions,
  type ItemFilterPredicate,
  type ItemFilterState,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type ReducedMotionPreference,
  type RestoreViewStateOptions,
  type SelectInRectOptions,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexInteractiveTarget,
  type SimplexKeyboardFocusTarget,
  type SimplexLayoutStrategy,
  type SimplexLegendModel,
  type SimplexLegendModelOptions,
  type SimplexMeshStrategy,
  type SimplexCorpusSyncCallbacks,
  type SimplexTimelineHostSession,
  type SimplexTimelineHostSessionHooks,
  type SimplexTimelineState,
  type SimplexViewState,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type VisualResolver,
  type ZoomToItemOptions,
} from '@simplex-viz/core';
import {
  applySimplexPinchDrillTarget,
  bindSimplexInteractiveViewport,
  createSimplexFpsTracker,
  createSimplexKeyboardNavigator,
  createSimplexLegendChangeEmitter,
  createSimplexSrAnnouncer,
  createSimplexTimelineBarOverlay,
  createSimplexTooltipOverlay,
  createSimplexZoomBreadcrumbsOverlay,
  formatSimplexTooltipText,
  isSameSimplexKeyboardTarget,
  measureSimplexContainer,
  observeSimplexContainerResize,
  resolveSimplexContainer,
  resolveSimplexDeferInitialLayoutConfig,
  resolveSimplexPinchDrillTarget,
  resolveSimplexReducedMotion,
  restoreSimplexControllerViewState,
  subscribeSimplexFontLoadRelayout,
  subscribeSimplexReducedMotionMedia,
  syncSimplexLegendTimelineStep,
  wrapSimplexControllerInteractions,
  type SimplexFpsTracker,
  type SimplexInteractiveViewportHandle,
  type SimplexKeyboardNavigator,
  type SimplexLegendChangeEmitter,
  type SimplexResizeObserverHandle,
  type SimplexSrAnnouncerHandle,
  type SimplexTimelineBarOverlay,
  type SimplexTooltipOverlay,
  type SimplexZoomBreadcrumbsOverlay,
} from '@simplex-viz/core/dom';
import type {
  CanvasDomTooltipRenderResult,
  CanvasDomTooltipRenderer,
  CanvasStructuredTooltipOption,
  CanvasTimelineConfig,
  CanvasTooltipFormatter,
  CanvasTooltipOption,
  DeferInitialLayoutOptions,
  SimplexCanvasControllerOptions,
  SimplexCanvasControllerResolvedOptions,
  SimplexCanvasTooltipTarget,
  SimplexCanvasUpdateOptions,
} from './canvasControllerTypes.js';
import { CanvasRendererAdapter } from './CanvasRendererAdapter.js';
import { createCanvasPresetVisualResolver } from './presets.js';
import type {
  CanvasBadgeOptions,
  CanvasContentShapeOption,
  CanvasDefaultClusterVisual,
  CanvasDefaultContentVisual,
  CanvasEdgeRenderer,
  CanvasExportPngOptions,
  CanvasMarqueeRect,
  CanvasNodeRenderer,
  CanvasRenderStats,
  CanvasShapeOptions,
  CanvasTheme,
  CanvasTriangleRenderer,
  CanvasVisualPreset,
} from './types.js';

export type {
  CanvasDomTooltipRenderResult,
  CanvasDomTooltipRenderer,
  CanvasStructuredTooltipOption,
  CanvasTimelineConfig,
  CanvasTooltipFormatter,
  CanvasTooltipOption,
  DeferInitialLayoutOptions,
  SimplexCanvasControllerOptions,
  SimplexCanvasControllerResolvedOptions,
  SimplexCanvasTooltipTarget,
  SimplexCanvasUpdateOptions,
};

const DEFAULT_CANVAS_ARIA_LABEL = 'Interactive SimplexViz topic graph canvas';


/**
 * Interactive, framework-agnostic HTML5 Canvas 2D controller for `@simplex-viz/core`.
 *
 * Parity with `SimplexSvgController` (hierarchical 1:4 zoom, timeline playback,
 * multi-selection + Shift+Drag marquee, WCAG 2.1 AA keyboard navigation, reduced motion,
 * view-state serialization, legend model, tooltips, native PNG export) while sustaining
 * 60 FPS on 2,000–10,000+ item corpora via zero-DOM Canvas 2D rendering.
 */
export class SimplexCanvasController<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  private readonly container: HTMLElement;
  private readonly rootEl: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly srAnnouncer: SimplexSrAnnouncerHandle;
  private readonly tooltipOverlay: SimplexTooltipOverlay<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta,
    HTMLDivElement
  >;
  private readonly breadcrumbOverlay: SimplexZoomBreadcrumbsOverlay;
  private readonly timelineOverlay: SimplexTimelineBarOverlay<TItem>;
  private readonly adapter: CanvasRendererAdapter<
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

  private preset: CanvasVisualPreset;
  private theme: CanvasTheme;
  private readonly getIdExtractor: (item: TItem) => string;
  private getLabel?: (item: TItem) => string;
  private formatTagLabel?: (tag: string) => string;
  private badgeOptions?: CanvasBadgeOptions<TItem, TTagMeta, TClusterMeta>;
  private getShape?: CanvasContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  private shapeOptions?: CanvasShapeOptions;
  private customResolver: boolean;
  private interactions: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private readonly focusOnClusterClick: boolean;
  private readonly focusOnTriangleClick: boolean;
  private showZoomBreadcrumbs: boolean;
  private marqueeSelection: boolean;
  private touchScrollLockPx: number;
  private clickTolerancePx: number;
  private keyboardNavigation: boolean;
  private ariaLabel: string;
  private readonly keyboardNavigator!: SimplexKeyboardNavigator;
  private reducedMotionPreference: ReducedMotionPreference;
  private reducedMotionActive = false;

  private fullItems: readonly TItem[];
  private lastExternalItemsRef: readonly TItem[];
  private readonly timelineSession: SimplexTimelineHostSession<TItem, TTagMeta>;

  private readonly fpsTracker: SimplexFpsTracker;
  private onZoomStateChangeCallback?: (zoomState: SimplexZoomState) => void;
  private readonly legendEmitter: SimplexLegendChangeEmitter<
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  private controllerBatchDepth = 0;

  private rafId: number | null = null;
  private lastRafTime = 0;
  private repaintRequested = false;
  private destroyed = false;
  private focusedClusterUidState: string | null = null;
  private focusedTriangleIndexState: number | null = null;
  private resizeObserverHandle: SimplexResizeObserverHandle | null = null;
  private fontLoadCleanup: (() => void) | null = null;
  private cleanupReducedMotionMedia: (() => void) | null = null;
  private viewportHandle: SimplexInteractiveViewportHandle | null = null;
  private readonly cameraProxy: CameraController;

  constructor(
    container: HTMLElement | string,
    options: SimplexCanvasControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
  constructor(
    container: HTMLElement | string,
    options: SimplexCanvasControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.container = resolveSimplexContainer(container, 'createSimplexCanvas()');
    this.preset = options.preset ?? 'badges';
    this.theme = options.theme ?? 'dark';
    this.getIdExtractor =
      options.getId ??
      ((item: TItem) =>
        typeof item === 'object' && item !== null && 'id' in item
          ? String((item as { readonly id: unknown }).id)
          : '');
    this.getLabel = options.getLabel;
    this.formatTagLabel = options.formatTagLabel;
    this.badgeOptions = options.badgeOptions;
    this.getShape = options.getShape;
    this.shapeOptions = options.shapeOptions;
    this.customResolver = Boolean(options.visualResolver);
    this.interactions = options.interactions ?? {};
    this.focusOnClusterClick = options.focusOnClusterClick ?? true;
    this.focusOnTriangleClick = options.focusOnTriangleClick ?? true;
    this.showZoomBreadcrumbs = options.showZoomBreadcrumbs ?? true;
    this.marqueeSelection = options.marqueeSelection ?? true;
    this.touchScrollLockPx = Math.max(0, options.touchScrollLockPx ?? 8);
    this.clickTolerancePx = Math.max(0, options.clickTolerancePx ?? 12);
    this.keyboardNavigation = options.keyboardNavigation ?? true;
    this.ariaLabel = options.ariaLabel?.trim() || DEFAULT_CANVAS_ARIA_LABEL;
    this.reducedMotionPreference = options.reducedMotion ?? 'auto';
    this.reducedMotionActive = resolveSimplexReducedMotion(
      this.reducedMotionPreference,
      this.container.ownerDocument,
    );
    this.fpsTracker = createSimplexFpsTracker(options.onFpsUpdate);
    this.onZoomStateChangeCallback = options.onZoomStateChange;
    this.lastExternalItemsRef = options.items;
    this.fullItems = options.items.slice();

    // Wrapper div for canvas + HUD/tooltip overlays + sr-only announcer
    const doc = this.container.ownerDocument ?? document;
    this.rootEl = doc.createElement('div');
    this.rootEl.className = 'sv-canvas-root';
    this.rootEl.style.position = 'relative';
    this.rootEl.style.width = '100%';
    this.rootEl.style.height = '100%';
    this.rootEl.style.overflow = 'hidden';
    this.rootEl.style.userSelect = 'none';

    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'sv-canvas-surface';
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.outline = 'none';
    this.canvas.style.touchAction = this.touchScrollLockPx > 0 ? 'pan-y' : 'none';
    this.syncCanvasAccessibilityAttributes();

    this.rootEl.appendChild(this.canvas);
    this.srAnnouncer = createSimplexSrAnnouncer(this.rootEl, doc);
    this.container.appendChild(this.rootEl);

    this.tooltipOverlay = createSimplexTooltipOverlay<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta,
      HTMLDivElement
    >({
      hostEl: this.rootEl,
      baseClassName: 'sv-canvas-tooltip',
      ensureHostPositioned: false,
      initialTheme: this.theme,
      initialOption: options.tooltip ?? false,
      getDefaultText: (target) =>
        formatSimplexTooltipText(target, {
          getLabel: this.getLabel,
          formatTagLabel: this.formatTagLabel,
          preferSubclusterLabel: true,
          zoomMode: this.engine.getZoomStrategy().mode,
          zoomState: this.engine.getZoomState(),
        }),
    });

    this.breadcrumbOverlay = createSimplexZoomBreadcrumbsOverlay({
      hostEl: this.rootEl,
      ensureHostPositioned: false,
      initialTheme: this.theme,
      initialVisible: this.showZoomBreadcrumbs,
      onDrillToDepth: (depth) => {
        this.drillToDepth(depth);
      },
    });

    this.timelineOverlay = createSimplexTimelineBarOverlay<TItem>({
      hostEl: this.rootEl,
      ensureHostPositioned: false,
      initialTheme: this.theme,
      onTogglePlay: () => {
        this.timelineSession.getController()?.toggle();
      },
      onStepBy: (delta) => {
        const ctrl = this.timelineSession.getController();
        ctrl?.pause();
        ctrl?.stepBy(delta);
      },
      onSeek: (step) => {
        const ctrl = this.timelineSession.getController();
        ctrl?.pause();
        ctrl?.seek(step);
      },
    });

    const fallbackW = options.width ?? 960;
    const fallbackH = options.height ?? 600;
    const measured = measureSimplexContainer(
      this.container,
      fallbackW,
      fallbackH,
      40,
    );
    const hasInitialSize = measured.hasValidSize;
    const canObserveResize = typeof ResizeObserver !== 'undefined';
    const { shouldDeferSolve, deferFallbackTimeoutMs } =
      resolveSimplexDeferInitialLayoutConfig(
        options.deferInitialLayout,
        hasInitialSize,
        canObserveResize,
      );

    this.adapter = new CanvasRendererAdapter<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >({
      canvas: this.canvas,
      theme: this.theme,
      backgroundColor: options.backgroundColor,
      maxDevicePixelRatio: options.maxDevicePixelRatio,
      lodThresholdPx: options.lodThresholdPx,
      cullMarginPx: options.cullMarginPx,
      contentRenderer: options.contentRenderer,
      clusterRenderer: options.clusterRenderer,
      triangleRenderer: options.triangleRenderer,
      edgeRenderer: options.edgeRenderer,
      shapeOptions: this.shapeOptions,
    });

    const visualResolver = options.visualResolver ?? this.buildDefaultVisualResolver();

    this.timelineSession = createSimplexTimelineHostSession<TItem, TTagMeta>({
      rawClusteringStrategy: options.clusteringStrategy,
      rawLayoutStrategy: options.layoutStrategy,
      baseEmptyClusterBehavior: options.emptyClusterBehavior ?? 'normal',
    });
    const initialTimeline = this.timelineSession.configureInitial(
      options.timeline,
      this.fullItems,
    );
    const mergedLayoutOptions =
      options.sizeMultiplier !== undefined
        ? { ...options.layoutOptions, sizeMultiplier: options.sizeMultiplier }
        : options.layoutOptions;

    this.legendEmitter = createSimplexLegendChangeEmitter({
      initialCallback: options.onLegendChange,
      isDestroyed: () => this.destroyed,
      getEngineLegendModel: () => this.engine?.getLegendModel(),
      getTimelineController: () => this.timelineSession.getController(),
    });

    const engineConfig = {
      items: initialTimeline.initialItems,
      getId: options.getId,
      getTags: options.getTags,
      normalizeTag: options.normalizeTag,
      formatTagLabel: options.formatTagLabel,
      resolveTagMeta: options.resolveTagMeta,
      deriveClusterMeta: options.deriveClusterMeta,
      visualResolver,
      renderer: this.adapter,
      viewportWidth: measured.width,
      viewportHeight: measured.height,
      theme: this.theme,
      meshOptions: options.meshOptions,
      layoutOptions: mergedLayoutOptions,
      meshStrategy: options.meshStrategy,
      clusteringStrategy: initialTimeline.clusteringStrategy,
      colorStrategy: options.colorStrategy,
      layoutStrategy: initialTimeline.layoutStrategy,
      zoomStrategy: options.zoomStrategy,
      showHulls: options.showHulls,
      emptyClusterBehavior: initialTimeline.emptyClusterBehavior,
      itemFilter: options.itemFilter,
      itemFilterMode: options.itemFilterMode,
      selectedIds: options.selectedIds,
      shiftClickSelects: options.shiftClickSelects,
      reducedMotion: this.reducedMotionActive,
      deferInitialSolve: shouldDeferSolve,
      interactions: this.buildWrappedInteractions(),
      onMetricsChange: options.onMetricsChange,
      onClustersChange: options.onClustersChange,
      onZoomStateChange: (zs: SimplexZoomState) => {
        this.syncZoomOverlays(zs);
        this.keyboardNavigator?.handleZoomStateChange(zs);
        this.onZoomStateChangeCallback?.(zs);
      },
      onSelectionChange: options.onSelectionChange,
      onLegendChange: (model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>) => {
        this.legendEmitter.emit(model);
      },
    };

    this.engine = SimplexGraphEngine.createFromResolved<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >(engineConfig);

    if (this.timelineSession.getController()) {
      this.engine.setCanonicalSeedItems(this.fullItems);
    }

    if (options.highlightedIds !== undefined) {
      this.engine.setHighlightedIds(options.highlightedIds);
    }

    const initialZoomState = this.engine.getZoomState();
    this.keyboardNavigator = createSimplexKeyboardNavigator({
      engine: this.engine,
      srAnnouncer: this.srAnnouncer,
      initialEnabled: this.keyboardNavigation,
      initialZoomState,
      getLabel: (item) => (this.getLabel ? this.getLabel(item) : ''),
      formatTagLabel: (tag) =>
        this.formatTagLabel ? this.formatTagLabel(tag) : '',
      getItemId: this.getIdExtractor,
      getFocusedClusterUid: () => this.focusedClusterUidState,
      getFocusedTriangleIndex: () => this.focusedTriangleIndexState,
      onFocusTargetChange: (target) => {
        this.adapter.setKeyboardFocusTarget(target);
      },
      onHideTooltip: () => this.tooltipOverlay.hide(),
      onRequestRender: (immediate) => {
        if (immediate) this.repaintRequested = true;
        this.scheduleFrame();
      },
      onDrillUp: () => this.drillUp(),
      onClearFocusedCluster: () => this.setFocusedClusterUid(null),
      onClearFocusedTriangle: () => this.setFocusedTriangleIndex(null),
      onClearFocusedItem: () => {
        this.focusItem(null);
      },
      onClearSelection: () => this.clearSelection(),
      isSurfaceActiveElement: () =>
        (this.canvas.ownerDocument?.activeElement ?? null) === this.canvas,
      isDestroyed: () => this.destroyed,
    });
    this.syncZoomOverlays(initialZoomState);
    this.onZoomStateChangeCallback?.(initialZoomState);
    this.timelineSession.attachInitial(this.getTimelineSessionHooks());

    const baseCamera = this.engine.camera;
    const scheduleCameraFrame = (): void => {
      if (this.destroyed) return;
      this.scheduleFrame();
    };
    this.cameraProxy = {
      getState: () => baseCamera.getState(),
      setState: (next) => {
        baseCamera.setState(next);
        scheduleCameraFrame();
      },
      zoomToCursor: (screenX, screenY, zoomFactor) => {
        baseCamera.zoomToCursor(screenX, screenY, zoomFactor);
        scheduleCameraFrame();
      },
      panBy: (dx, dy) => {
        baseCamera.panBy(dx, dy);
        scheduleCameraFrame();
      },
      reset: () => {
        baseCamera.reset();
        scheduleCameraFrame();
      },
      screenToWorld: (screenX, screenY) => baseCamera.screenToWorld(screenX, screenY),
      worldToScreen: (worldX, worldY) => baseCamera.worldToScreen(worldX, worldY),
    };

    this.bindReducedMotionMediaQuery(this.reducedMotionPreference);
    this.bindDomEvents();
    if (canObserveResize) {
      this.bindResizeObserver({
        pendingInitialViewport: !hasInitialSize,
        shouldDeferSolve,
        deferFallbackTimeoutMs,
        fallbackWidth: fallbackW,
        fallbackHeight: fallbackH,
      });
    }
    if (options.relayoutOnFontLoad !== false) {
      this.fontLoadCleanup = subscribeSimplexFontLoadRelayout(
        this.container.ownerDocument,
        () => {
          if (!this.destroyed) {
            this.relayout();
          }
        },
      );
    }
    if (!shouldDeferSolve) {
      this.scheduleFrame();
    }
  }

  static createFromResolved<
    TItem = DefaultTaggedItem,
    TContentVisual = CanvasDefaultContentVisual,
    TClusterVisual = CanvasDefaultClusterVisual,
    TTagMeta = undefined,
    TClusterMeta = undefined,
  >(
    container: HTMLElement | string,
    options: SimplexCanvasControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): SimplexCanvasController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return new (SimplexCanvasController as unknown as new (
      el: HTMLElement | string,
      opts: SimplexCanvasControllerResolvedOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ) => SimplexCanvasController<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >)(container, options);
  }

  private getTimelineSessionHooks(): SimplexTimelineHostSessionHooks<TItem, TTagMeta> {
    return {
      batch: (fn) => this.batch(fn),
      setCanonicalSeedItems: (items) => this.engine.setCanonicalSeedItems(items),
      setClusteringStrategy: (strategy) => this.engine.setClusteringStrategy(strategy),
      setLayoutStrategy: (strategy) => this.engine.setLayoutStrategy(strategy),
      setEmptyClusterBehavior: (behavior) => this.engine.setEmptyClusterBehavior(behavior),
      setEngineItems: (items) => this.engine.setItems(items),
      syncOverlay: (state) => this.syncTimelineOverlay(state),
      onFrameActivity: () => this.scheduleFrame(),
      onLegendSync: () => this.legendEmitter.emit(),
      isDestroyed: () => this.destroyed,
    };
  }

  private syncCanvasAccessibilityAttributes(): void {
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-roledescription', 'interactive topic graph');
    this.canvas.setAttribute('aria-label', this.ariaLabel);
    this.canvas.setAttribute('tabindex', this.keyboardNavigation ? '0' : '-1');
    if (this.keyboardNavigation) {
      this.canvas.setAttribute(
        'aria-keyshortcuts',
        'ArrowRight ArrowLeft ArrowDown ArrowUp Home End Enter Space Escape',
      );
    } else {
      this.canvas.removeAttribute('aria-keyshortcuts');
    }
  }

  private syncZoomOverlays(state: SimplexZoomState): void {
    if (this.destroyed) return;
    this.breadcrumbOverlay.setTheme(this.theme);
    this.breadcrumbOverlay.sync(state, this.showZoomBreadcrumbs);
  }

  private syncTimelineOverlay(
    state: SimplexTimelineState<TItem> | null,
  ): void {
    if (this.destroyed) return;
    this.timelineOverlay.sync(state, {
      visible: this.timelineSession.getShowControls(),
      position: this.timelineSession.getPosition(),
      theme: this.theme,
    });
  }

  private buildDefaultVisualResolver(): VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return createCanvasPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
      this.preset,
      {
        getLabel: this.getLabel,
        theme: this.theme,
        formatTagLabel: this.formatTagLabel,
        badgeOptions: this.badgeOptions,
        getShape: this.getShape,
        shapeOptions: this.shapeOptions,
      },
    ) as unknown as VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;
  }

  private announce(message: string): void {
    if (this.destroyed || !message) return;
    this.srAnnouncer.announce(message);
  }

  private buildWrappedInteractions(): InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return wrapSimplexControllerInteractions({
      getUserInteractions: () => this.interactions,
      tooltipOverlay: this.tooltipOverlay,
      getLeftClickContext: () => ({
        zoomMode: this.engine.getZoomStrategy().mode,
        canDrillUp: this.engine.getZoomState().canDrillUp,
        selectedCount: this.engine.getSelectedIds().size,
        focusedItemId: this.engine.getFocusedItemId(),
        focusedClusterUid: this.focusedClusterUidState,
        focusedTriangleIndex: this.focusedTriangleIndexState,
        focusOnClusterClick: this.focusOnClusterClick,
        focusOnTriangleClick: this.focusOnTriangleClick,
        drillToNeighbor: (id) => this.drillToNeighbor(id),
        drillDownTriangle: (idx) => this.drillDownTriangle(idx),
        drillDownCluster: (uid) => this.drillDownCluster(uid),
        drillUp: () => this.drillUp(),
        setFocusedClusterUid: (uid) => this.setFocusedClusterUid(uid),
        setFocusedTriangleIndex: (idx) => this.setFocusedTriangleIndex(idx),
        clearFocusedItem: () => {
          this.focusItem(null);
        },
        clearSelection: () => this.clearSelection(),
      }),
    });
  }

  private bindReducedMotionMediaQuery(pref: ReducedMotionPreference): void {
    this.cleanupReducedMotionMedia?.();
    this.cleanupReducedMotionMedia = null;
    this.reducedMotionActive = resolveSimplexReducedMotion(
      pref,
      this.container.ownerDocument,
    );
    this.rootEl.dataset.reducedMotion = String(this.reducedMotionActive);
    this.cleanupReducedMotionMedia = subscribeSimplexReducedMotionMedia(
      pref,
      this.container.ownerDocument,
      (matches) => {
        if (this.destroyed || this.reducedMotionPreference !== 'auto') return;
        this.reducedMotionActive = matches;
        this.engine.setReducedMotion(matches);
        this.rootEl.dataset.reducedMotion = String(matches);
        this.scheduleFrame();
      },
    );
  }

  private bindDomEvents(): void {
    this.viewportHandle?.destroy();
    this.viewportHandle = bindSimplexInteractiveViewport({
      surfaceEl: this.canvas,
      engine: this.engine,
      clickDispatch: 'pointerup',
      bindTouchListeners: false,
      capturePointer: true,
      pinchDrillInRatio: 1.24,
      getTouchScrollLockPx: () => this.touchScrollLockPx,
      getClickTolerancePx: () => this.clickTolerancePx,
      isMarqueeEnabled: () => this.marqueeSelection,
      isDestroyed: () => this.destroyed,
      hideTooltip: () => this.tooltipOverlay.hide(),
      onMarqueeChange: (rect) => {
        this.adapter.setMarqueeRect(rect);
      },
      onMarqueeCommit: (x1, y1, x2, y2, altKey) => {
        this.engine.selectItemsInScreenRect(
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.max(x1, x2),
          Math.max(y1, y2),
          { mode: altKey ? 'toggle' : 'add' },
        );
        this.scheduleFrame();
      },
      onPinchDrillIn: (midX, midY) =>
        applySimplexPinchDrillTarget(
          resolveSimplexPinchDrillTarget(this.engine, midX, midY),
          {
            drillToNeighbor: (id) => this.drillToNeighbor(id),
            drillDownTriangle: (idx) => this.drillDownTriangle(idx),
            drillDownCluster: (uid) => this.drillDownCluster(uid),
          },
        ),
      onDrillUp: () => this.drillUp(),
      onAfterCameraTransform: () => {
        this.scheduleFrame();
      },
      onScheduleFrame: () => {
        this.scheduleFrame();
      },
      onPointerDownPre: () => {
        this.keyboardNavigator.onPointerDownPre();
      },
      onFocus: () => {
        this.keyboardNavigator.handleFocus();
      },
      onBlur: () => {
        this.keyboardNavigator.handleBlur();
      },
      onKeyDown: (ev) => {
        this.keyboardNavigator.handleKeyDown(ev);
      },
    });
  }

  private bindResizeObserver(config: {
    readonly pendingInitialViewport: boolean;
    readonly shouldDeferSolve: boolean;
    readonly deferFallbackTimeoutMs: number | null;
    readonly fallbackWidth: number;
    readonly fallbackHeight: number;
  }): void {
    this.resizeObserverHandle = observeSimplexContainerResize({
      container: this.container,
      pendingInitialViewport: config.pendingInitialViewport,
      shouldDeferSolve: config.shouldDeferSolve,
      deferFallbackTimeoutMs: config.deferFallbackTimeoutMs,
      fallbackWidth: config.fallbackWidth,
      fallbackHeight: config.fallbackHeight,
      minValidSize: 40,
      isDestroyed: () => this.destroyed,
      onDeferredInit: (width, height) => {
        const w = Math.round(width);
        const h = Math.round(height);
        this.adapter.invalidateHullCaches();
        this.engine.reinitializeViewport(w, h);
        this.repaintRequested = true;
        this.scheduleFrame();
      },
      onResize: (width, height) => {
        this.engine.setViewport(Math.round(width), Math.round(height));
        this.scheduleFrame();
      },
    });
  }

  private scheduleFrame(): void {
    if (this.destroyed || this.rafId !== null || this.controllerBatchDepth > 0) return;
    if (typeof requestAnimationFrame !== 'function') {
      const wantsRepaint = this.repaintRequested;
      this.repaintRequested = false;
      const settled = this.engine.step(16.67);
      if (wantsRepaint && settled) {
        this.adapter.redraw();
      }
      return;
    }
    this.lastRafTime =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = (now: number) => {
      this.rafId = null;
      if (this.destroyed) return;
      const dt = Math.min(64, Math.max(0, now - this.lastRafTime));
      this.lastRafTime = now;
      this.fpsTracker.recordFrame(dt);

      const wantsRepaint = this.repaintRequested;
      this.repaintRequested = false;

      const timelineCtrl = this.timelineSession.getController();
      let needsMore = false;
      if (timelineCtrl?.getState().playing) {
        timelineCtrl.tick(dt);
        needsMore = true;
      }
      const settled = this.engine.step(dt);
      if (wantsRepaint && settled) {
        this.adapter.redraw();
      }
      if (!settled || needsMore || this.repaintRequested) {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // ============================================================================
  // Public Controller API (Full Parity with SimplexSvgController)
  // ============================================================================

  get camera(): CameraController {
    return this.cameraProxy;
  }

  get timeline(): SimplexTimelineController<TItem> | null {
    return this.timelineSession.getController();
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  getRenderStats(): CanvasRenderStats {
    return this.adapter.getRenderStats();
  }

  getMetrics(): LayoutMetrics {
    return this.engine.getMetrics();
  }

  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] {
    return this.engine.getClusters();
  }

  getLegendModel(
    options?: SimplexLegendModelOptions,
  ): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> {
    return syncSimplexLegendTimelineStep(
      this.engine.getLegendModel(options),
      this.timelineSession.getController(),
    );
  }

  setOnLegendChange(
    cb?: (legend: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>) => void,
  ): void {
    this.legendEmitter.setCallback(cb);
  }

  getItemId(item: TItem): string {
    return this.getIdExtractor(item);
  }

  getItems(): readonly TItem[] {
    return this.fullItems;
  }

  private getCorpusSyncCallbacks(): SimplexCorpusSyncCallbacks<TItem, TTagMeta> {
    return {
      getId: this.getIdExtractor,
      setCanonicalSeedItems: (items) => this.engine.setCanonicalSeedItems(items),
      setClusteringStrategy: (strategy) => this.engine.setClusteringStrategy(strategy),
      setEngineItems: (items) => this.engine.setItems(items),
      addEngineItems: (items) => this.engine.addItems(items),
      removeEngineItems: (ids) => this.engine.removeItems(ids),
    };
  }

  setItems(items: readonly TItem[]): void {
    const sync = this.timelineSession.syncCorpusSetItems(
      items,
      this.fullItems,
      this.lastExternalItemsRef,
      this.getCorpusSyncCallbacks(),
    );
    if (!sync.changed) return;
    this.fullItems = sync.fullItems;
    this.lastExternalItemsRef = sync.lastExternalItemsRef;
    this.scheduleFrame();
  }

  addItems(items: TItem | readonly TItem[]): void {
    const sync = this.timelineSession.syncCorpusAddItems(
      items,
      this.fullItems,
      this.lastExternalItemsRef,
      this.getCorpusSyncCallbacks(),
    );
    if (!sync.changed) return;
    this.fullItems = sync.fullItems;
    this.lastExternalItemsRef = sync.lastExternalItemsRef;
    this.scheduleFrame();
  }

  removeItems(ids: string | readonly string[]): void {
    const sync = this.timelineSession.syncCorpusRemoveItems(
      ids,
      this.fullItems,
      this.lastExternalItemsRef,
      this.getCorpusSyncCallbacks(),
    );
    if (!sync.changed) return;
    this.fullItems = sync.fullItems;
    this.lastExternalItemsRef = sync.lastExternalItemsRef;
    this.scheduleFrame();
  }

  setPreset(preset: CanvasVisualPreset, getLabel?: (item: TItem) => string): void {
    this.preset = preset;
    if (getLabel !== undefined) this.getLabel = getLabel;
    this.customResolver = false;
    this.adapter.invalidateHullCaches();
    this.engine.setVisualResolver(this.buildDefaultVisualResolver());
    this.scheduleFrame();
  }

  setTheme(theme: CanvasTheme): void {
    if (this.theme === theme) return;
    this.batch(() => {
      this.theme = theme;
      this.adapter.setTheme(theme);
      this.tooltipOverlay.setTheme(theme);
      this.breadcrumbOverlay.setTheme(theme);
      this.timelineOverlay.setTheme(theme);
      this.engine.setTheme(theme);
      if (!this.customResolver) {
        this.engine.setVisualResolver(this.buildDefaultVisualResolver());
      }
    });
    this.syncZoomOverlays(this.engine.getZoomState());
    const timelineCtrl = this.timelineSession.getController();
    if (timelineCtrl) {
      this.syncTimelineOverlay(timelineCtrl.getState());
    }
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  setBackgroundColor(color: string | undefined): void {
    this.adapter.setBackgroundColor(color);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  setShapeOptions(shapeOptions?: CanvasShapeOptions): void {
    this.shapeOptions = shapeOptions;
    this.adapter.setShapeOptions(shapeOptions);
    if (!this.customResolver) {
      this.engine.setVisualResolver(this.buildDefaultVisualResolver());
    }
    this.scheduleFrame();
  }

  setVisualResolver(
    visualResolver: VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.customResolver = true;
    this.adapter.invalidateHullCaches();
    this.engine.setVisualResolver(visualResolver);
    this.scheduleFrame();
  }

  setRenderers(renderers: {
    readonly contentRenderer?: CanvasNodeRenderer<TContentVisual>;
    readonly clusterRenderer?: CanvasNodeRenderer<TClusterVisual>;
    readonly triangleRenderer?: CanvasTriangleRenderer<TItem, TTagMeta, TClusterMeta>;
    readonly edgeRenderer?: CanvasEdgeRenderer<TItem, TTagMeta, TClusterMeta>;
  }): void {
    this.adapter.setRenderers(renderers);
    this.engine.relayout();
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.engine.setMeshStrategy(strategy);
    this.scheduleFrame();
  }

  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    const effective = this.timelineSession.setRawClusteringStrategy(
      strategy,
      this.fullItems,
    );
    this.engine.setClusteringStrategy(effective);
    this.scheduleFrame();
  }

  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.engine.setColorStrategy(strategy);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    const effective = this.timelineSession.setRawLayoutStrategy(strategy);
    this.engine.setLayoutStrategy(effective);
    this.scheduleFrame();
  }

  setZoomStrategy(
    strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>,
  ): void {
    this.engine.setZoomStrategy(strategy);
    this.scheduleFrame();
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

  setZoomUiOptions(options: {
    readonly showZoomBreadcrumbs?: boolean;
  }): void {
    if (options.showZoomBreadcrumbs !== undefined) {
      this.showZoomBreadcrumbs = options.showZoomBreadcrumbs;
    }
    this.syncZoomOverlays(this.engine.getZoomState());
  }

  getZoomState(): SimplexZoomState {
    return this.engine.getZoomState();
  }

  drillDownTriangle(triangleIndex: number): boolean {
    const ok = this.engine.drillDownTriangle(triangleIndex);
    if (ok) this.scheduleFrame();
    return ok;
  }

  drillDownCluster(clusterUid: string): boolean {
    const ok = this.engine.drillDownCluster(clusterUid);
    if (ok) this.scheduleFrame();
    return ok;
  }

  drillToNeighbor(neighborId: string): boolean {
    const ok = this.engine.drillToNeighbor(neighborId);
    if (ok) this.scheduleFrame();
    return ok;
  }

  drillUp(): boolean {
    const ok = this.engine.drillUp();
    if (ok) this.scheduleFrame();
    return ok;
  }

  drillToDepth(depth: number): boolean {
    const ok = this.engine.drillToDepth(depth);
    if (ok) this.scheduleFrame();
    return ok;
  }

  drillToRoot(): boolean {
    const ok = this.engine.drillToRoot();
    if (ok) this.scheduleFrame();
    return ok;
  }

  setMeshOptions(options: MeshOptions): void {
    this.engine.setMeshOptions(options);
    this.scheduleFrame();
  }

  setLayoutOptions(options: LayoutSolverOptions): void {
    this.engine.setLayoutOptions(options);
    this.scheduleFrame();
  }

  setSizeMultiplier(multiplier: number): void {
    this.engine.setSizeMultiplier(multiplier);
    this.scheduleFrame();
  }

  setTooltip(
    tooltip: CanvasTooltipOption<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.tooltipOverlay.setOption(tooltip);
  }

  setShowHulls(show: boolean): void {
    this.engine.setShowHulls(show);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  getEmptyClusterBehavior(): EmptyClusterBehavior {
    return this.engine.getEmptyClusterBehavior();
  }

  setEmptyClusterBehavior(behavior: EmptyClusterBehavior): void {
    this.timelineSession.setBaseEmptyClusterBehavior(behavior);
    this.engine.setEmptyClusterBehavior(behavior);
    this.scheduleFrame();
  }

  getItemFilter(): ItemFilterState<TItem> {
    return this.engine.getItemFilter();
  }

  setItemFilter(
    predicate: ItemFilterPredicate<TItem> | null,
    options?: ItemFilterOptions,
  ): void {
    this.engine.setItemFilter(predicate, options);
    const currentFocus = this.keyboardNavigator.getFocusTarget();
    if (currentFocus !== null) {
      const stillVisible = this.engine
        .getInteractiveTargets()
        .some((t) => isSameSimplexKeyboardTarget(currentFocus, t));
      if (!stillVisible) {
        this.clearKeyboardFocus();
      }
    }
    this.repaintRequested = true;
    this.scheduleFrame();
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
    this.interactions = interactions;
    this.engine.setInteractions(this.buildWrappedInteractions());
  }

  setPinnedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this.engine.setPinnedIds(ids);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  setHighlightedIds(ids: Iterable<string> | null): void {
    this.engine.setHighlightedIds(ids);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  getHighlightedIds(): ReadonlySet<string> {
    return this.engine.getHighlightedIds();
  }

  setSelectedIds(ids: Iterable<string> | null): void {
    this.engine.setSelectedIds(ids);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  toggleSelectedId(id: string): boolean {
    const res = this.engine.toggleSelectedId(id);
    this.repaintRequested = true;
    this.scheduleFrame();
    return res;
  }

  clearSelection(): void {
    this.engine.clearSelection();
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  getSelectedIds(): ReadonlySet<string> {
    return this.engine.getSelectedIds();
  }

  selectItemsInScreenRect(
    rect: CanvasMarqueeRect,
    options?: SelectInRectOptions,
  ): ReadonlySet<string>;
  selectItemsInScreenRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string>;
  selectItemsInScreenRect(
    rectOrX1: number | CanvasMarqueeRect,
    y1OrOptions?: number | SelectInRectOptions,
    x2?: number,
    y2?: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string> {
    const isRect = typeof rectOrX1 === 'object' && rectOrX1 !== null;
    const left = isRect ? rectOrX1.x : rectOrX1;
    const top = isRect ? rectOrX1.y : (y1OrOptions as number);
    const right = isRect ? rectOrX1.x + rectOrX1.width : (x2 as number);
    const bottom = isRect ? rectOrX1.y + rectOrX1.height : (y2 as number);
    const resolvedOptions = isRect
      ? (y1OrOptions as SelectInRectOptions | undefined)
      : options;
    const res = this.engine.selectItemsInScreenRect(
      left,
      top,
      right,
      bottom,
      resolvedOptions,
    );
    this.repaintRequested = true;
    this.scheduleFrame();
    return res;
  }

  setMarqueeSelection(enabled: boolean): void {
    this.marqueeSelection = enabled;
    if (!enabled) {
      this.viewportHandle?.cancelMarquee();
      this.adapter.setMarqueeRect(null);
      this.repaintRequested = true;
      this.scheduleFrame();
    }
  }

  isMarqueeSelectionEnabled(): boolean {
    return this.marqueeSelection;
  }

  setShiftClickSelects(enabled: boolean): void {
    this.engine.setShiftClickSelects(enabled);
  }

  getShiftClickSelects(): boolean {
    return this.engine.getShiftClickSelects();
  }

  setOnSelectionChange(cb?: (selectedIds: ReadonlySet<string>) => void): void {
    this.engine.setOnSelectionChange(cb);
  }

  setFocusedClusterUid(clusterUid: string | null): void {
    this.focusedClusterUidState = clusterUid;
    this.engine.setFocusedClusterUid(clusterUid);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  setFocusedTriangleIndex(triangleIndex: number | null): void {
    this.focusedTriangleIndexState = triangleIndex;
    this.engine.setFocusedTriangleIndex(triangleIndex);
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  getFocusedItemId(): string | null {
    return this.engine.getFocusedItemId();
  }

  focusItem(
    itemId: string | null,
    options?: FocusItemOptions & { readonly announce?: boolean },
  ): boolean {
    if (itemId === null) {
      this.engine.focusItem(null, options);
      if (options?.hover !== false) {
        this.tooltipOverlay.hide();
      }
      this.repaintRequested = true;
      this.scheduleFrame();
      return false;
    }
    const ok = this.engine.focusItem(itemId, options);
    if (!ok) return false;
    if (options?.announce) {
      const rec = this.engine.getItemLayoutById(itemId);
      const label = rec
        ? extractSimplexItemLabel(rec.item, itemId, this.getLabel)
        : itemId;
      this.announce(`Focused item: ${label}`);
    }
    this.repaintRequested = true;
    this.scheduleFrame();
    return true;
  }

  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean {
    const ok = this.engine.zoomToItem(itemId, options);
    if (!ok) return false;
    this.syncZoomOverlays(this.engine.getZoomState());
    this.repaintRequested = true;
    this.scheduleFrame();
    return true;
  }

  getViewState(): SimplexViewState {
    const base = this.engine.getViewState();
    const timelineCtrl = this.timelineSession.getController();
    return timelineCtrl
      ? { ...base, timelineStep: timelineCtrl.getState().step }
      : base;
  }

  restoreViewState(
    state: Partial<SimplexViewState> | null | undefined,
    options?: RestoreViewStateOptions,
  ): boolean {
    return restoreSimplexControllerViewState(state, options, {
      isDestroyed: () => this.destroyed,
      getTimelineController: () => this.timelineSession.getController(),
      syncTimelineOverlay: (ts) => this.syncTimelineOverlay(ts),
      restoreEngineViewState: (s, opts) => this.engine.restoreViewState(s, opts),
      syncAfterRestore: () => {
        this.focusedClusterUidState = this.engine.getFocusedClusterUid();
        this.focusedTriangleIndexState = this.engine.getFocusedTriangleIndex();
        this.tooltipOverlay.hide();
        this.syncZoomOverlays(this.engine.getZoomState());
        this.repaintRequested = true;
        this.scheduleFrame();
      },
    });
  }

  setTouchScrollLockPx(px: number): void {
    this.touchScrollLockPx = Number.isFinite(px) ? Math.max(0, px) : 8;
    this.viewportHandle?.syncTouchAction();
  }

  setClickTolerancePx(px: number): void {
    this.clickTolerancePx = Number.isFinite(px) ? Math.max(0, px) : 12;
  }

  setReducedMotion(pref: ReducedMotionPreference): void {
    if (this.destroyed) return;
    this.reducedMotionPreference = pref;
    this.bindReducedMotionMediaQuery(pref);
    this.engine.setReducedMotion(this.reducedMotionActive);
    this.scheduleFrame();
  }

  getReducedMotion(): ReducedMotionPreference {
    return this.reducedMotionPreference;
  }

  isReducedMotionActive(): boolean {
    return this.reducedMotionActive;
  }

  setAriaLabel(label: string): void {
    this.ariaLabel = label.trim() || DEFAULT_CANVAS_ARIA_LABEL;
    this.syncCanvasAccessibilityAttributes();
  }

  setKeyboardNavigation(enabled: boolean): void {
    if (this.keyboardNavigation === enabled) return;
    this.keyboardNavigation = enabled;
    this.keyboardNavigator.setEnabled(enabled);
    this.syncCanvasAccessibilityAttributes();
  }

  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null {
    return this.keyboardNavigator.getFocusTarget();
  }

  clearKeyboardFocus(options?: { readonly preserveHover?: boolean }): void {
    this.keyboardNavigator.clearFocus(options);
  }

  getInteractiveTargets(): readonly SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] {
    return this.engine.getInteractiveTargets();
  }

  getTimeline(): SimplexTimelineController<TItem> | null {
    return this.timelineSession.getController();
  }

  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void {
    return this.timelineSession.subscribe(listener);
  }

  setTimelineOptions(
    timeline: boolean | CanvasTimelineConfig<TItem> | null | undefined,
  ): void {
    if (this.destroyed) return;
    this.timelineSession.setTimelineOptions(
      timeline,
      this.fullItems,
      this.getTimelineSessionHooks(),
    );
  }

  batch<TResult>(fn: () => TResult): TResult {
    this.controllerBatchDepth += 1;
    try {
      return this.engine.batch(fn);
    } finally {
      this.controllerBatchDepth -= 1;
      if (this.controllerBatchDepth === 0) {
        this.scheduleFrame();
      }
    }
  }

  setOptions(
    options: SimplexCanvasUpdateOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    if (this.destroyed) return;
    let shouldSyncZoomOverlays = false;
    let shouldSyncTimelineOverlay = false;

    this.batch(() => {
      let resolverInputsChanged = false;

      if (options.preset !== undefined && options.preset !== this.preset) {
        this.preset = options.preset;
        resolverInputsChanged = true;
      }
      if ('getLabel' in options && options.getLabel !== this.getLabel) {
        this.getLabel = options.getLabel;
        resolverInputsChanged = true;
      }
      if (
        'formatTagLabel' in options &&
        options.formatTagLabel !== this.formatTagLabel
      ) {
        this.formatTagLabel = options.formatTagLabel;
        resolverInputsChanged = true;
      }
      if ('badgeOptions' in options && options.badgeOptions !== this.badgeOptions) {
        this.badgeOptions = options.badgeOptions;
        this.adapter.invalidateHullCaches();
        resolverInputsChanged = true;
      }
      if ('getShape' in options && options.getShape !== this.getShape) {
        this.getShape = options.getShape;
        this.adapter.invalidateHullCaches();
        resolverInputsChanged = true;
      }
      if ('shapeOptions' in options && options.shapeOptions !== this.shapeOptions) {
        this.shapeOptions = options.shapeOptions;
        this.adapter.setShapeOptions(this.shapeOptions);
        resolverInputsChanged = true;
      }

      if (options.theme !== undefined && options.theme !== this.theme) {
        this.theme = options.theme;
        this.adapter.setTheme(options.theme);
        this.tooltipOverlay.setTheme(options.theme);
        this.breadcrumbOverlay.setTheme(options.theme);
        this.timelineOverlay.setTheme(options.theme);
        this.engine.setTheme(options.theme);
        shouldSyncZoomOverlays = true;
        shouldSyncTimelineOverlay = true;
        resolverInputsChanged = true;
      }

      if ('backgroundColor' in options) {
        this.adapter.setBackgroundColor(options.backgroundColor);
      }

      if (
        options.contentRenderer !== undefined ||
        options.clusterRenderer !== undefined ||
        options.triangleRenderer !== undefined ||
        options.edgeRenderer !== undefined
      ) {
        this.setRenderers({
          ...(options.contentRenderer !== undefined
            ? { contentRenderer: options.contentRenderer }
            : {}),
          ...(options.clusterRenderer !== undefined
            ? { clusterRenderer: options.clusterRenderer }
            : {}),
          ...(options.triangleRenderer !== undefined
            ? { triangleRenderer: options.triangleRenderer }
            : {}),
          ...(options.edgeRenderer !== undefined
            ? { edgeRenderer: options.edgeRenderer }
            : {}),
        });
      }

      if ('visualResolver' in options) {
        if (options.visualResolver === null) {
          this.customResolver = false;
          this.adapter.invalidateHullCaches();
          this.engine.setVisualResolver(this.buildDefaultVisualResolver());
        } else if (options.visualResolver !== undefined) {
          this.setVisualResolver(options.visualResolver);
        }
      } else if (!this.customResolver && resolverInputsChanged) {
        this.adapter.invalidateHullCaches();
        this.engine.setVisualResolver(this.buildDefaultVisualResolver());
      }

      if (options.meshOptions !== undefined) {
        this.engine.setMeshOptions(options.meshOptions);
      }
      if (options.layoutOptions !== undefined) {
        const mergedLayout =
          options.sizeMultiplier !== undefined
            ? { ...options.layoutOptions, sizeMultiplier: options.sizeMultiplier }
            : options.layoutOptions;
        this.engine.setLayoutOptions(mergedLayout);
      } else if (options.sizeMultiplier !== undefined) {
        this.engine.setSizeMultiplier(options.sizeMultiplier);
      }
      if (options.meshStrategy !== undefined) {
        this.engine.setMeshStrategy(options.meshStrategy);
      }
      if (options.clusteringStrategy !== undefined) {
        this.setClusteringStrategy(options.clusteringStrategy);
      }
      if (options.colorStrategy !== undefined) {
        this.engine.setColorStrategy(options.colorStrategy);
      }
      if (options.layoutStrategy !== undefined) {
        this.setLayoutStrategy(options.layoutStrategy);
      }
      if (options.zoomStrategy !== undefined) {
        this.engine.setZoomStrategy(options.zoomStrategy);
        shouldSyncZoomOverlays = true;
      }

      if (options.showHulls !== undefined) {
        this.engine.setShowHulls(options.showHulls);
      }
      if (options.emptyClusterBehavior !== undefined) {
        this.setEmptyClusterBehavior(options.emptyClusterBehavior);
      }
      if ('itemFilter' in options || 'itemFilterMode' in options) {
        const currentFilter = this.engine.getItemFilter();
        const nextPredicate =
          'itemFilter' in options
            ? (options.itemFilter ?? null)
            : currentFilter.predicate;
        const nextMode = options.itemFilterMode ?? currentFilter.mode;
        this.setItemFilter(nextPredicate, { mode: nextMode });
      }
      if (options.pinnedIds !== undefined) {
        this.engine.setPinnedIds(options.pinnedIds);
      }
      if ('highlightedIds' in options) {
        this.engine.setHighlightedIds(options.highlightedIds ?? null);
      }
      if ('onSelectionChange' in options) {
        this.engine.setOnSelectionChange(options.onSelectionChange);
      }
      if ('onLegendChange' in options) {
        this.setOnLegendChange(options.onLegendChange);
      }
      if ('selectedIds' in options) {
        this.engine.setSelectedIds(options.selectedIds ?? null);
      }
      if (options.marqueeSelection !== undefined) {
        this.setMarqueeSelection(options.marqueeSelection);
      }
      if (options.shiftClickSelects !== undefined) {
        this.setShiftClickSelects(options.shiftClickSelects);
      }
      if ('focusedItemId' in options) {
        this.focusItem(options.focusedItemId ?? null);
      }
      if ('focusedClusterUid' in options) {
        this.setFocusedClusterUid(options.focusedClusterUid ?? null);
      }
      if ('focusedTriangleIndex' in options) {
        this.setFocusedTriangleIndex(options.focusedTriangleIndex ?? null);
      }
      if (options.tooltip !== undefined) {
        this.setTooltip(options.tooltip);
      }
      if (options.ariaLabel !== undefined) {
        this.setAriaLabel(options.ariaLabel);
      }
      if (options.keyboardNavigation !== undefined) {
        this.setKeyboardNavigation(options.keyboardNavigation);
      }
      if (options.reducedMotion !== undefined) {
        this.setReducedMotion(options.reducedMotion);
      }
      if (options.touchScrollLockPx !== undefined) {
        this.setTouchScrollLockPx(options.touchScrollLockPx);
      }
      if (options.clickTolerancePx !== undefined) {
        this.setClickTolerancePx(options.clickTolerancePx);
      }
      if (options.interactions !== undefined) {
        this.setInteractions(options.interactions);
      }
      if (options.showZoomBreadcrumbs !== undefined) {
        this.showZoomBreadcrumbs = options.showZoomBreadcrumbs;
        shouldSyncZoomOverlays = true;
      }
      if ('timeline' in options) {
        this.setTimelineOptions(options.timeline);
      }
      if (options.items !== undefined) {
        this.setItems(options.items);
      }
      this.repaintRequested = true;
    });

    if (shouldSyncZoomOverlays) {
      this.syncZoomOverlays(this.engine.getZoomState());
    }
    const timelineCtrl = this.timelineSession.getController();
    if (shouldSyncTimelineOverlay && timelineCtrl) {
      this.syncTimelineOverlay(timelineCtrl.getState());
    }
  }

  /**
   * Schedules a coalesced `requestAnimationFrame` repaint without re-running layout.
   * Ideal for triggering a redraw once async Canvas textures or images finish decoding.
   */
  requestRender(): void {
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  relayout(): void {
    if (this.destroyed) return;
    this.adapter.invalidateHullCaches();
    this.engine.relayout();
    this.repaintRequested = true;
    this.scheduleFrame();
  }

  /**
   * Advances simulation & timeline deterministically by `dtMs` milliseconds (useful in tests & headless captures).
   */
  stepForTest(dtMs = 16.67): boolean {
    if (this.timelineSession.getController()?.getState().playing) {
      this.timelineSession.getController()?.tick(dtMs);
    }
    return this.engine.step(dtMs);
  }

  exportPng(options: CanvasExportPngOptions & { readonly format: 'dataUrl' }): Promise<string>;
  exportPng(options?: CanvasExportPngOptions & { readonly format?: 'blob' }): Promise<Blob>;
  exportPng(options?: CanvasExportPngOptions): Promise<Blob | string>;
  exportPng(options?: CanvasExportPngOptions): Promise<Blob | string> {
    if (this.destroyed) {
      return Promise.reject(
        new Error('SimplexCanvasController.exportPng: cannot export after destroy().'),
      );
    }
    this.engine.renderNow();
    return this.adapter.exportPng(options);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.timelineSession.destroy();
    this.resizeObserverHandle?.disconnect();
    this.resizeObserverHandle = null;
    this.fontLoadCleanup?.();
    this.fontLoadCleanup = null;
    this.cleanupReducedMotionMedia?.();
    this.cleanupReducedMotionMedia = null;
    this.viewportHandle?.destroy();
    this.viewportHandle = null;
    this.breadcrumbOverlay.destroy();
    this.timelineOverlay.destroy();
    this.tooltipOverlay.destroy();
    this.srAnnouncer.destroy();
    this.engine.destroy();
    this.rootEl.remove();
  }
}

/**
 * Ergonomic factory for mounting a high-capacity Canvas 2D SimplexViz graph.
 *
 * Accepts either a bare `items` array for zero-config mounting or a full options object.
 */
export function createSimplexCanvas<TItem extends DefaultTaggedItem = DefaultTaggedItem>(
  container: HTMLElement | string,
  items: readonly TItem[],
): SimplexCanvasController<TItem, CanvasDefaultContentVisual, CanvasDefaultClusterVisual>;
export function createSimplexCanvas<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  container: HTMLElement | string,
  options: SimplexCanvasControllerOptions<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): SimplexCanvasController<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
>;
export function createSimplexCanvas<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  container: HTMLElement | string,
  itemsOrOptions:
    | readonly TItem[]
    | SimplexCanvasControllerOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
): SimplexCanvasController<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
> {
  if (Array.isArray(itemsOrOptions)) {
    return SimplexCanvasController.createFromResolved(container, {
      items: itemsOrOptions,
    });
  }
  return new SimplexCanvasController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >(
    container,
    itemsOrOptions as SimplexCanvasControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
}
