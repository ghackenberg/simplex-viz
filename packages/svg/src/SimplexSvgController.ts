import {
  SimplexGraphEngine,
  SimplexTimelineController,
  createSimplexTimelineHostSession,
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
  formatSimplexClusterAriaMetadata,
  formatSimplexItemAriaMetadata,
  formatSimplexTooltipText,
  formatSimplexTriangleAriaMetadata,
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
import {
  exportSvgElementToPng,
  prepareStandaloneSvg,
  type ExportPngBlobOptions,
  type ExportPngDataUrlOptions,
  type ExportPngOptions,
  type ExportSvgOptions,
} from './export.js';
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
import type {
  DeferInitialLayoutOptions,
  SimplexDomTooltipRenderer,
  SimplexDomTooltipRenderResult,
  SimplexSvgControllerOptions,
  SimplexSvgControllerResolvedOptions,
  SimplexSvgTooltipOption,
  SimplexSvgTooltipTarget,
  SimplexSvgUpdateOptions,
  SimplexTooltipFormatter,
  TimelinePlayerOptions,
} from './svgControllerTypes.js';
import {
  SvgRendererAdapter,
  type SvgAriaMetadataResolver,
  type SvgRendererOptions,
} from './SvgRendererAdapter.js';
import type { SvgEdgeView, SvgNodeView, SvgTriangleView } from './types.js';
import { type GeometricShapeSvgViewOptions } from './views/GeometricShapeSvgView.js';

export type {
  DeferInitialLayoutOptions,
  SimplexDomTooltipRenderer,
  SimplexDomTooltipRenderResult,
  SimplexSvgControllerOptions,
  SimplexSvgControllerResolvedOptions,
  SimplexSvgTooltipOption,
  SimplexSvgTooltipTarget,
  SimplexSvgUpdateOptions,
  SimplexTooltipFormatter,
  TimelinePlayerOptions,
};

let nextA11yInstanceSeq = 0;

const DEFAULT_ARIA_LABEL = 'Interactive simplex topic graph';


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
  private readonly resizeObserverHandle: SimplexResizeObserverHandle | null = null;
  private readonly fpsTracker: SimplexFpsTracker;
  private onZoomStateChangeCallback?: (state: SimplexZoomState) => void;
  private readonly legendEmitter: SimplexLegendChangeEmitter<
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  private userInteractions?: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private readonly focusOnClusterClick: boolean;
  private readonly focusOnTriangleClick: boolean;
  private showZoomBreadcrumbs: boolean;
  private readonly getIdExtractor: (item: TItem) => string;
  private getLabelExtractor?: (item: TItem) => string;
  private readonly formatTagLabelFn?: (tag: string) => string;
  private badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  private getShapeOption?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  private shapeOptions?: GeometricShapeSvgViewOptions;
  private usesCustomContentView: boolean;
  private usesCustomClusterView: boolean;
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
  private readonly srAnnouncer: SimplexSrAnnouncerHandle;
  private ariaLabel: string;
  private keyboardNavigationEnabled: boolean;
  private readonly keyboardNavigator!: SimplexKeyboardNavigator;
  private readonly timelineSession: SimplexTimelineHostSession<TItem, TTagMeta>;
  private lastExternalItemsRef: readonly TItem[];
  private fullCorpusItems: readonly TItem[];
  private focusedClusterUidState: string | null = null;
  private focusedTriangleIndexState: number | null = null;
  private currentPreset: SimplexVisualPreset;
  private currentTheme: SimplexTheme;
  private usesCustomVisualResolver: boolean;
  private readonly cameraProxy: CameraController;

  private rafId: number | null = null;
  private lastFrameTs = 0;
  private controllerBatchDepth = 0;
  private destroyed = false;

  // Centralized drag-to-pan, touch direction-locking, and multi-touch pinch-zoom binding on root <svg>
  private touchScrollLockPx: number;
  private clickTolerancePx: number;
  private viewportHandle: SimplexInteractiveViewportHandle | null = null;
  private fontLoadCleanup: (() => void) | null = null;
  private reducedMotionPreference: ReducedMotionPreference = 'auto';
  private reducedMotionActive = false;
  private reducedMotionMediaCleanup: (() => void) | null = null;
  private marqueeSelectionEnabled = true;
  private marqueeOverlayGroup: SVGGElement | null = null;
  private marqueeRectEl: SVGRectElement | null = null;

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
    this.containerEl = resolveSimplexContainer(containerEl, 'SimplexSvgController');
    this.fpsTracker = createSimplexFpsTracker(options.onFpsUpdate);
    this.onZoomStateChangeCallback = options.onZoomStateChange;
    this.userInteractions = options.interactions;
    this.focusOnClusterClick = options.focusOnClusterClick ?? true;
    this.focusOnTriangleClick = options.focusOnTriangleClick ?? true;
    this.showZoomBreadcrumbs = options.showZoomBreadcrumbs ?? true;
    this.getLabelExtractor = options.getLabel;
    this.formatTagLabelFn = options.formatTagLabel;
    this.badgeOptions = options.badgeOptions;
    this.getShapeOption = options.getShape;
    this.shapeOptions = options.shapeOptions;
    this.usesCustomContentView = options.contentView !== undefined;
    this.usesCustomClusterView = options.clusterView !== undefined;
    this.ariaLabel = options.ariaLabel?.trim() || DEFAULT_ARIA_LABEL;
    this.keyboardNavigationEnabled = options.keyboardNavigation ?? true;
    this.marqueeSelectionEnabled = options.marqueeSelection ?? true;
    this.reducedMotionPreference = options.reducedMotion ?? 'auto';
    this.reducedMotionActive = this.computeReducedMotionActive();
    this.getIdExtractor =
      options.getId ??
      ((item: TItem) =>
        typeof item === 'object' && item !== null && 'id' in item
          ? String((item as { readonly id: unknown }).id)
          : '');

    this.currentPreset = options.preset ?? 'geometric';
    this.currentTheme = options.theme ?? 'dark';
    this.usesCustomVisualResolver = options.visualResolver !== undefined;
    const presetViews = createPresetViews(this.currentPreset, {
      shapeOptions: this.shapeOptions,
    });
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

    this.touchScrollLockPx =
      typeof options.touchScrollLockPx === 'number' &&
      Number.isFinite(options.touchScrollLockPx)
        ? Math.max(0, options.touchScrollLockPx)
        : 8;
    this.clickTolerancePx =
      typeof options.clickTolerancePx === 'number' &&
      Number.isFinite(options.clickTolerancePx)
        ? Math.max(0, options.clickTolerancePx)
        : 12;

    const doc = this.containerEl.ownerDocument;
    this.svgEl = doc.createElementNS(SVG_NS, 'svg');
    this.svgEl.setAttribute('width', '100%');
    this.svgEl.setAttribute('height', '100%');
    this.svgEl.style.display = 'block';
    this.svgEl.style.touchAction = this.touchScrollLockPx > 0 ? 'pan-y' : 'none';
    this.svgEl.style.userSelect = 'none';
    this.syncSvgAccessibilityAttributes();
    this.syncReducedMotionAttribute();
    this.containerEl.appendChild(this.svgEl);
    this.srAnnouncer = createSimplexSrAnnouncer(this.containerEl, doc);
    this.tooltipOverlay = createSimplexTooltipOverlay<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta,
      HTMLDivElement
    >({
      hostEl: this.containerEl,
      baseClassName: 'sv-tooltip',
      ensureHostPositioned: true,
      initialTheme: this.currentTheme,
      initialOption: options.tooltip ?? false,
      getDefaultText: (target) =>
        formatSimplexTooltipText(target, {
          getLabel: this.getLabelExtractor,
          formatTagLabel: this.formatTagLabelFn,
          zoomMode: this.engine.getZoomStrategy().mode,
          zoomState: this.engine.getZoomState(),
        }),
    });

    this.breadcrumbOverlay = createSimplexZoomBreadcrumbsOverlay({
      hostEl: this.containerEl,
      ensureHostPositioned: true,
      initialTheme: this.currentTheme,
      initialVisible: this.showZoomBreadcrumbs,
      onDrillToDepth: (depth) => {
        this.drillToDepth(depth);
      },
    });
    this.timelineOverlay = createSimplexTimelineBarOverlay<TItem>({
      hostEl: this.containerEl,
      ensureHostPositioned: true,
      initialTheme: this.currentTheme,
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

    const measured = measureSimplexContainer(this.containerEl, 960, 620, 40);
    const hasInitialSize = measured.hasValidSize;
    const initialW = measured.width;
    const initialH = measured.height;
    const canObserveResize = typeof ResizeObserver !== 'undefined';
    const { shouldDeferSolve, deferFallbackTimeoutMs } =
      resolveSimplexDeferInitialLayoutConfig(
        options.deferInitialLayout,
        hasInitialSize,
        canObserveResize,
      );

    const ariaIdPrefix = `sv-a11y-${++nextA11yInstanceSeq}`;
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
      ariaIdPrefix,
      ariaMetadataResolver: this.buildAriaMetadataResolver(),
    });

    this.lastExternalItemsRef = options.items;
    this.fullCorpusItems = options.items.slice();
    this.timelineSession = createSimplexTimelineHostSession<TItem, TTagMeta>({
      rawClusteringStrategy: options.clusteringStrategy,
      rawLayoutStrategy: options.layoutStrategy,
      baseEmptyClusterBehavior: options.emptyClusterBehavior ?? 'normal',
    });
    const initialTimeline = this.timelineSession.configureInitial(
      options.timeline,
      this.fullCorpusItems,
    );

    this.legendEmitter = createSimplexLegendChangeEmitter({
      initialCallback: options.onLegendChange,
      isDestroyed: () => this.destroyed,
      getEngineLegendModel: () => this.engine?.getLegendModel(),
      getTimelineController: () => this.timelineSession.getController(),
    });

    this.engine = SimplexGraphEngine.createFromResolved({
      items: initialTimeline.initialItems,
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
      clusteringStrategy: initialTimeline.clusteringStrategy,
      colorStrategy: options.colorStrategy,
      layoutStrategy: initialTimeline.layoutStrategy,
      zoomStrategy: options.zoomStrategy,
      theme: this.currentTheme,
      showHulls: options.showHulls,
      emptyClusterBehavior: initialTimeline.emptyClusterBehavior,
      itemFilter: options.itemFilter,
      itemFilterMode: options.itemFilterMode,
      canonicalSeedItems: this.timelineSession.getController()
        ? this.fullCorpusItems
        : undefined,
      deferInitialSolve: shouldDeferSolve,
      reducedMotion: this.reducedMotionActive,
      selectedIds: options.selectedIds,
      shiftClickSelects: options.shiftClickSelects,
      interactions: this.wrapInteractions(),
      onMetricsChange: options.onMetricsChange,
      onClustersChange: options.onClustersChange,
      onSelectionChange: options.onSelectionChange,
      onLegendChange: (model) => {
        this.legendEmitter.emit(model);
      },
      onZoomStateChange: (state) => {
        this.syncZoomOverlays(state);
        this.keyboardNavigator?.handleZoomStateChange(state);
        this.onZoomStateChangeCallback?.(state);
      },
    });
    if (!shouldDeferSolve) {
      // Refresh first rendered frame with live engine-backed ARIA labels on clusters/items/triangles
      this.engine.renderNow();
    }
    const initialZoomState = this.engine.getZoomState();
    this.keyboardNavigator = createSimplexKeyboardNavigator({
      engine: this.engine,
      srAnnouncer: this.srAnnouncer,
      initialEnabled: this.keyboardNavigationEnabled,
      initialZoomState,
      getLabel: (item) =>
        this.getLabelExtractor ? this.getLabelExtractor(item) : '',
      formatTagLabel: (tag) =>
        this.formatTagLabelFn ? this.formatTagLabelFn(tag) : '',
      getItemId: this.getIdExtractor,
      getFocusedClusterUid: () => this.focusedClusterUidState,
      getFocusedTriangleIndex: () => this.focusedTriangleIndexState,
      onFocusTargetChange: (target) => {
        this.adapter.setKeyboardFocusTarget(target);
        const domId = target ? this.adapter.getDomIdForTarget(target) : null;
        if (domId) {
          this.svgEl.setAttribute('aria-activedescendant', domId);
        } else {
          this.svgEl.removeAttribute('aria-activedescendant');
        }
      },
      onHideTooltip: () => this.tooltipOverlay.hide(),
      onRequestRender: (immediate) => {
        if (immediate) this.engine.renderNow();
        this.ensureLoopRunning();
      },
      onDrillUp: () => this.drillUp(),
      onClearFocusedCluster: () => this.setFocusedClusterUid(null),
      onClearFocusedTriangle: () => this.setFocusedTriangleIndex(null),
      onClearFocusedItem: () => {
        this.focusItem(null);
      },
      onClearSelection: () => this.clearSelection(),
      isSurfaceActiveElement: () =>
        this.svgEl.ownerDocument.activeElement === this.svgEl,
      isDestroyed: () => this.destroyed,
    });
    this.syncZoomOverlays(initialZoomState);
    this.onZoomStateChangeCallback?.(initialZoomState);
    this.timelineSession.attachInitial(this.getTimelineSessionHooks());

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

    this.attachViewportInteractions();
    this.syncReducedMotionMediaSubscription();

    if (canObserveResize) {
      this.resizeObserverHandle = observeSimplexContainerResize({
        container: this.containerEl,
        pendingInitialViewport: !hasInitialSize,
        shouldDeferSolve,
        deferFallbackTimeoutMs,
        fallbackWidth: 960,
        fallbackHeight: 620,
        minValidSize: 40,
        isDestroyed: () => this.destroyed,
        onDeferredInit: (width, height) => {
          this.adapter.invalidateHulls();
          this.engine.reinitializeViewport(width, height);
          this.ensureLoopRunning();
        },
        onResize: (width, height) => {
          this.engine.setViewport(width, height);
          this.ensureLoopRunning();
        },
      });
    }

    if (options.relayoutOnFontLoad !== false) {
      this.attachFontLoadListener();
    }

    if (!shouldDeferSolve) {
      this.ensureLoopRunning();
    }
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

  private wrapInteractions(): InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return wrapSimplexControllerInteractions({
      getUserInteractions: () => this.userInteractions,
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

  private attachFontLoadListener(): void {
    this.fontLoadCleanup = subscribeSimplexFontLoadRelayout(
      this.containerEl.ownerDocument,
      () => {
        if (!this.destroyed) {
          this.relayout();
        }
      },
    );
  }

  get camera(): CameraController {
    return this.cameraProxy;
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
      onFrameActivity: () => this.ensureLoopRunning(),
      onLegendSync: () => this.legendEmitter.emit(),
      isDestroyed: () => this.destroyed,
    };
  }

  /** Active headless timeline controller when `timeline` is enabled, or `null` otherwise. */
  get timeline(): SimplexTimelineController<TItem> | null {
    return this.timelineSession.getController();
  }

  /** Returns the active headless timeline controller, or `null` when timeline mode is disabled. */
  getTimeline(): SimplexTimelineController<TItem> | null {
    return this.timelineSession.getController();
  }

  /**
   * Subscribes to timeline state changes (including enabling/disabling timeline mode at runtime).
   * Invokes `listener` immediately with the current state (or `null`) and returns an unsubscribe handle.
   */
  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void {
    return this.timelineSession.subscribe(listener);
  }

  /**
   * Dynamically enables, updates, or disables timeline playback at runtime.
   */
  setTimelineOptions(
    timeline: boolean | TimelinePlayerOptions<TItem> | undefined,
  ): void {
    if (this.destroyed) return;
    this.timelineSession.setTimelineOptions(
      timeline,
      this.fullCorpusItems,
      this.getTimelineSessionHooks(),
    );
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

  /**
   * Returns a structured legend model synchronized with the active zoom/drill-down frame,
   * item filter counts, `emptyClusterBehavior`, focused cluster, and active timeline step.
   */
  getLegendModel(
    options?: SimplexLegendModelOptions,
  ): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> {
    return syncSimplexLegendTimelineStep(
      this.engine.getLegendModel(options),
      this.timelineSession.getController(),
    );
  }

  /** Updates the structured legend model change listener at runtime. */
  setOnLegendChange(
    cb?: (model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>) => void,
  ): void {
    this.legendEmitter.setCallback(cb);
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

    const timelineCtrl = this.timelineSession.getController();
    if (timelineCtrl) {
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.timelineSession.syncFinalSeededClusteringForCorpus(
        this.fullCorpusItems,
        (strategy) => this.engine.setClusteringStrategy(strategy),
      );
      timelineCtrl.setItems(this.fullCorpusItems);
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

    const timelineCtrl = this.timelineSession.getController();
    if (timelineCtrl) {
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.timelineSession.syncFinalSeededClusteringForCorpus(
        this.fullCorpusItems,
        (strategy) => this.engine.setClusteringStrategy(strategy),
      );
      timelineCtrl.setItems(this.fullCorpusItems);
      this.ensureLoopRunning();
      return;
    }

    this.engine.removeItems(ids);
    this.ensureLoopRunning();
  }

  setItems(items: readonly TItem[]): void {
    const timelineCtrl = this.timelineSession.getController();
    if (timelineCtrl) {
      if (items === this.lastExternalItemsRef) {
        return;
      }
      this.lastExternalItemsRef = items;
      this.fullCorpusItems = items.slice();
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.timelineSession.syncFinalSeededClusteringForCorpus(
        this.fullCorpusItems,
        (strategy) => this.engine.setClusteringStrategy(strategy),
      );
      timelineCtrl.setItems(this.fullCorpusItems);
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
    const views = this.buildDefaultPresetViews(preset);
    this.adapter.setViews({
      contentView: views.contentView,
      clusterView: views.clusterView,
    });
    this.engine.setVisualResolver(this.buildDefaultPresetResolver(preset));
    this.ensureLoopRunning();
  }

  /**
   * Updates lightweight hover, dimming, and stroke styling options on the built-in
   * `GeometricShapeSvgView` (applies to `'geometric'` and `'badges'` presets when no
   * custom `contentView` is provided).
   */
  setShapeOptions(shapeOptions?: GeometricShapeSvgViewOptions): void {
    this.shapeOptions = shapeOptions;
    if (!this.usesCustomContentView && this.currentPreset !== 'glyphs') {
      const { contentView } = this.buildDefaultPresetViews(this.currentPreset);
      this.adapter.setViews({ contentView });
      this.adapter.invalidateHulls();
      this.engine.relayout();
      this.ensureLoopRunning();
    }
  }

  private buildDefaultPresetViews(preset: SimplexVisualPreset): {
    readonly contentView: SvgNodeView<TContentVisual>;
    readonly clusterView: SvgNodeView<TClusterVisual>;
  } {
    const views = createPresetViews(preset, { shapeOptions: this.shapeOptions });
    return {
      contentView: views.contentView as unknown as SvgNodeView<TContentVisual>,
      clusterView: views.clusterView as unknown as SvgNodeView<TClusterVisual>,
    };
  }

  private buildDefaultPresetResolver(
    preset: SimplexVisualPreset = this.currentPreset,
    theme: SimplexTheme = this.currentTheme,
  ): VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(preset, {
      getLabel: this.getLabelExtractor,
      theme,
      formatTagLabel: this.formatTagLabelFn,
      badgeOptions: this.badgeOptions,
      getShape: this.getShapeOption,
    }) as unknown as VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;
  }

  /**
   * Executes `fn` inside a re-entrant batch transaction so multiple sequential controller
   * setter calls coalesce into at most one pipeline/layout solve and one SVG render pass.
   */
  batch<TResult>(fn: () => TResult): TResult {
    this.controllerBatchDepth += 1;
    try {
      return this.engine.batch(fn);
    } finally {
      this.controllerBatchDepth -= 1;
      if (this.controllerBatchDepth === 0) {
        this.ensureLoopRunning();
      }
    }
  }

  /**
   * Atomically applies any combination of theme, preset, styling options, views,
   * filters, strategies, or interaction settings in a single coalesced layout and render pass.
   */
  setOptions(
    options: SimplexSvgUpdateOptions<
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
      let needsRenderNow = false;
      let needsHullInvalidation = false;
      let presetChanged = false;
      let themeChanged = false;
      let resolverInputsChanged = false;
      let shapeOptionsChanged = false;

      if (options.preset !== undefined && options.preset !== this.currentPreset) {
        this.currentPreset = options.preset;
        presetChanged = true;
        resolverInputsChanged = true;
      }
      if ('getLabel' in options && options.getLabel !== this.getLabelExtractor) {
        this.getLabelExtractor = options.getLabel;
        resolverInputsChanged = true;
      }
      if ('badgeOptions' in options && options.badgeOptions !== this.badgeOptions) {
        this.badgeOptions = options.badgeOptions;
        resolverInputsChanged = true;
        needsHullInvalidation = true;
      }
      if ('getShape' in options && options.getShape !== this.getShapeOption) {
        this.getShapeOption = options.getShape;
        resolverInputsChanged = true;
        needsHullInvalidation = true;
      }
      if ('shapeOptions' in options && options.shapeOptions !== this.shapeOptions) {
        this.shapeOptions = options.shapeOptions;
        shapeOptionsChanged = true;
      }
      if (options.theme !== undefined && options.theme !== this.currentTheme) {
        this.currentTheme = options.theme;
        themeChanged = true;
        resolverInputsChanged = true;
        shouldSyncZoomOverlays = true;
        shouldSyncTimelineOverlay = true;
        this.tooltipOverlay.setTheme(options.theme);
        this.adapter.setTheme(options.theme);
        this.engine.setTheme(options.theme);
        needsRenderNow = true;
      }

      // Views: rebuild preset views at most once and merge explicit view overrides
      const viewPatch: Partial<
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
      > = {};
      let hasViewPatch = false;

      if ('contentView' in options) {
        if (options.contentView === null) {
          this.usesCustomContentView = false;
        } else if (options.contentView !== undefined) {
          this.usesCustomContentView = true;
          (viewPatch as { contentView?: SvgNodeView<TContentVisual> }).contentView =
            options.contentView;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
      }
      if ('clusterView' in options) {
        if (options.clusterView === null) {
          this.usesCustomClusterView = false;
        } else if (options.clusterView !== undefined) {
          this.usesCustomClusterView = true;
          (viewPatch as { clusterView?: SvgNodeView<TClusterVisual> }).clusterView =
            options.clusterView;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
      }

      const needPresetContentView =
        !this.usesCustomContentView &&
        (presetChanged ||
          options.contentView === null ||
          (shapeOptionsChanged && this.currentPreset !== 'glyphs'));
      const needPresetClusterView =
        !this.usesCustomClusterView &&
        (presetChanged || options.clusterView === null);

      if (needPresetContentView || needPresetClusterView) {
        const presetViews = this.buildDefaultPresetViews(this.currentPreset);
        if (needPresetContentView) {
          (viewPatch as { contentView?: SvgNodeView<TContentVisual> }).contentView =
            presetViews.contentView;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
        if (needPresetClusterView) {
          (viewPatch as { clusterView?: SvgNodeView<TClusterVisual> }).clusterView =
            presetViews.clusterView;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
      }

      if (options.triangleView !== undefined) {
        (
          viewPatch as {
            triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
          }
        ).triangleView = options.triangleView;
        hasViewPatch = true;
        needsRenderNow = true;
      }
      if (options.edgeView !== undefined) {
        (
          viewPatch as {
            edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
          }
        ).edgeView = options.edgeView;
        hasViewPatch = true;
        needsRenderNow = true;
      }

      if (hasViewPatch) {
        this.adapter.setViews(viewPatch);
        needsRenderNow = true;
      }
      if (needsHullInvalidation) {
        this.adapter.invalidateHulls();
      }

      // Visual resolver: rebuild at most once
      let didUpdateResolver = false;
      if ('visualResolver' in options) {
        if (options.visualResolver === null) {
          this.usesCustomVisualResolver = false;
          this.engine.setVisualResolver(this.buildDefaultPresetResolver());
          didUpdateResolver = true;
          needsRenderNow = true;
        } else if (options.visualResolver !== undefined) {
          this.usesCustomVisualResolver = true;
          this.engine.setVisualResolver(options.visualResolver);
          didUpdateResolver = true;
          needsRenderNow = true;
        }
      } else if (!this.usesCustomVisualResolver && resolverInputsChanged) {
        this.engine.setVisualResolver(this.buildDefaultPresetResolver());
        didUpdateResolver = true;
        needsRenderNow = true;
      }

      if (needsHullInvalidation && !didUpdateResolver) {
        this.engine.relayout();
        needsRenderNow = true;
      }

      // Core solver & strategy options
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
        needsRenderNow = true;
      }
      if (options.layoutStrategy !== undefined) {
        this.setLayoutStrategy(options.layoutStrategy);
      }
      if (options.zoomStrategy !== undefined) {
        this.engine.setZoomStrategy(options.zoomStrategy);
        shouldSyncZoomOverlays = true;
      }

      // Presentation, filter, timeline, items & interaction options
      if (options.showHulls !== undefined) {
        this.engine.setShowHulls(options.showHulls);
        needsRenderNow = true;
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
        this.engine.setItemFilter(nextPredicate, { mode: nextMode });
      }
      if (options.pinnedIds !== undefined) {
        this.engine.setPinnedIds(options.pinnedIds);
        needsRenderNow = true;
      }
      if ('highlightedIds' in options) {
        this.engine.setHighlightedIds(options.highlightedIds ?? null);
        needsRenderNow = true;
      }
      if ('onSelectionChange' in options) {
        this.engine.setOnSelectionChange(options.onSelectionChange);
      }
      if ('onLegendChange' in options) {
        this.setOnLegendChange(options.onLegendChange);
      }
      if ('selectedIds' in options) {
        this.engine.setSelectedIds(options.selectedIds ?? null);
        needsRenderNow = true;
      }
      if (options.marqueeSelection !== undefined) {
        this.setMarqueeSelection(options.marqueeSelection);
      }
      if (options.shiftClickSelects !== undefined) {
        this.setShiftClickSelects(options.shiftClickSelects);
      }
      if ('focusedItemId' in options) {
        this.engine.focusItem(options.focusedItemId ?? null);
        needsRenderNow = true;
      }
      if ('focusedClusterUid' in options) {
        this.setFocusedClusterUid(options.focusedClusterUid ?? null);
        needsRenderNow = true;
      }
      if ('focusedTriangleIndex' in options) {
        this.setFocusedTriangleIndex(options.focusedTriangleIndex ?? null);
        needsRenderNow = true;
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
      if (options.timeline !== undefined) {
        this.setTimelineOptions(options.timeline);
      }
      if (options.items !== undefined) {
        this.setItems(options.items);
      }

      if (needsRenderNow || themeChanged) {
        this.engine.renderNow();
      }
    });

    if (shouldSyncZoomOverlays) {
      this.syncZoomOverlays(this.engine.getZoomState());
    }
    const ctrl = this.timelineSession.getController();
    if (shouldSyncTimelineOverlay && ctrl) {
      this.syncTimelineOverlay(ctrl.getState());
    }
  }

  /**
   * Switches built-in preset & tooltip theme between `'dark'` and `'light'`.
   */
  setTheme(theme: SimplexTheme): void {
    if (this.currentTheme === theme) return;
    this.batch(() => {
      this.currentTheme = theme;
      this.tooltipOverlay.setTheme(theme);
      this.breadcrumbOverlay.setTheme(theme);
      this.timelineOverlay.setTheme(theme);
      this.adapter.setTheme(theme);
      this.engine.setTheme(theme);
      if (!this.usesCustomVisualResolver) {
        this.engine.setVisualResolver(
          this.buildDefaultPresetResolver(this.currentPreset, theme),
        );
      }
      this.engine.renderNow();
    });
    this.syncZoomOverlays(this.engine.getZoomState());
    const ctrl = this.timelineSession.getController();
    if (ctrl) {
      this.syncTimelineOverlay(ctrl.getState());
    }
  }

  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.engine.setMeshStrategy(strategy);
    this.ensureLoopRunning();
  }

  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    const effective = this.timelineSession.setRawClusteringStrategy(
      strategy,
      this.fullCorpusItems,
    );
    this.engine.setClusteringStrategy(effective);
    this.ensureLoopRunning();
  }

  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.engine.setColorStrategy(strategy);
    this.ensureLoopRunning();
  }

  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    const effective = this.timelineSession.setRawLayoutStrategy(strategy);
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
    tooltip: SimplexSvgTooltipOption<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.tooltipOverlay.setOption(tooltip);
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
    this.timelineSession.setBaseEmptyClusterBehavior(behavior);
    this.engine.setEmptyClusterBehavior(behavior);
    this.ensureLoopRunning();
  }

  /** Returns the currently active item filter predicate and mode (`'dim' | 'hide'`). */
  getItemFilter(): ItemFilterState<TItem> {
    return this.engine.getItemFilter();
  }

  /**
   * Filters content items visually and interactively without triggering a layout re-solve.
   * All anchors, clusters, and item positions remain frozen across rapid filter changes.
   *
   * - `mode: 'dim'` (default): Softly dims non-matching items cleanly.
   * - `mode: 'hide'`: Hides non-matching items (`opacity: 0`, `pointer-events: none`, excluded from `hitTest()`).
   * - Pass `null` to clear the filter and restore all items.
   */
  setItemFilter(
    predicate: ItemFilterPredicate<TItem> | null,
    options?: ItemFilterOptions,
  ): void {
    this.engine.setItemFilter(predicate, options);
    const currentKeyboardFocus = this.keyboardNavigator.getFocusTarget();
    if (currentKeyboardFocus !== null) {
      const stillVisible = this.engine
        .getInteractiveTargets()
        .some((t) => isSameSimplexKeyboardTarget(currentKeyboardFocus, t));
      if (!stillVisible) {
        this.clearKeyboardFocus();
      }
    }
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
    this.userInteractions = interactions;
    this.engine.setInteractions(this.wrapInteractions());
  }

  setPinnedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this.engine.setPinnedIds(ids);
    this.ensureLoopRunning();
  }

  /** Sets highlighted item IDs (dimming non-matches), or pass `null` to clear. */
  setHighlightedIds(ids: Iterable<string> | null): void {
    this.engine.setHighlightedIds(ids);
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Returns the currently highlighted item IDs. */
  getHighlightedIds(): ReadonlySet<string> {
    return this.engine.getHighlightedIds();
  }

  /**
   * Replaces the active multi-selection set (`null` clears selection).
   * Tracked independently of `highlightedIds` and `pinnedIds`.
   */
  setSelectedIds(ids: Iterable<string> | null): void {
    this.engine.setSelectedIds(ids);
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Toggles a single item ID in the multi-selection set and returns its new selected state. */
  toggleSelectedId(id: string): boolean {
    const next = this.engine.toggleSelectedId(id);
    this.engine.renderNow();
    this.ensureLoopRunning();
    return next;
  }

  /** Clears all currently selected item IDs. */
  clearSelection(): void {
    this.engine.clearSelection();
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Returns a snapshot of the currently multi-selected item IDs. */
  getSelectedIds(): ReadonlySet<string> {
    return this.engine.getSelectedIds();
  }

  /**
   * Selects active content items intersecting the given SVG-local screen rectangle.
   */
  selectItemsInScreenRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string> {
    const next = this.engine.selectItemsInScreenRect(x1, y1, x2, y2, options);
    this.engine.renderNow();
    this.ensureLoopRunning();
    return next;
  }

  /** Enables or disables `Shift+Drag` marquee box selection at runtime. */
  setMarqueeSelection(enabled: boolean): void {
    this.marqueeSelectionEnabled = enabled;
    if (!enabled) {
      this.viewportHandle?.cancelMarquee();
      this.hideMarqueeRect();
    }
  }

  /** Returns whether `Shift+Drag` marquee box selection is currently enabled. */
  isMarqueeSelectionEnabled(): boolean {
    return this.marqueeSelectionEnabled;
  }

  /** Enables or disables built-in `Shift+Click` multi-selection before `onContentClick` / `onLeftClick`. */
  setShiftClickSelects(enabled: boolean): void {
    this.engine.setShiftClickSelects(enabled);
  }

  /** Returns whether built-in `Shift+Click` multi-selection is currently enabled. */
  getShiftClickSelects(): boolean {
    return this.engine.getShiftClickSelects();
  }

  /** Updates the multi-selection change listener at runtime. */
  setOnSelectionChange(cb?: (selectedIds: ReadonlySet<string>) => void): void {
    this.engine.setOnSelectionChange(cb);
  }

  /** Returns the currently programmatically focused item ID, or `null`. */
  getFocusedItemId(): string | null {
    return this.engine.getFocusedItemId();
  }

  /**
   * Programmatically focuses a specific content item (highlighting it and dispatching hover/tooltip
   * callbacks), or clears item focus when passed `null`.
   */
  focusItem(
    itemId: string | null,
    options?: FocusItemOptions & { readonly announce?: boolean },
  ): boolean {
    if (itemId === null) {
      this.engine.focusItem(null, options);
      if (options?.hover !== false) {
        this.tooltipOverlay.hide();
      }
      this.engine.renderNow();
      this.ensureLoopRunning();
      return false;
    }
    const ok = this.engine.focusItem(itemId, options);
    if (!ok) return false;
    if (options?.announce) {
      const rec = this.engine.getItemLayoutById(itemId);
      const label = rec
        ? extractDefaultItemLabel(rec.item, itemId, this.getLabelExtractor)
        : itemId;
      this.announce(`Focused item: ${label}`);
    }
    this.engine.renderNow();
    this.ensureLoopRunning();
    return true;
  }

  /**
   * Programmatically zooms or drills down to a specific content item:
   * - In `free-camera` mode: pans and zooms the camera onto the item.
   * - In `drill-down` mode: navigates to the item's ancestor frame (if needed) and drills down
   *   into its covering triangle or cluster up to `options.maxDrillSteps` (default `4`).
   *
   * Optionally focuses the item afterwards (`options.focus !== false`).
   */
  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean {
    const ok = this.engine.zoomToItem(itemId, options);
    if (!ok) return false;
    this.syncZoomOverlays(this.engine.getZoomState());
    this.engine.renderNow();
    this.ensureLoopRunning();
    return true;
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
   * Captures a plain JSON-serializable snapshot of the graph's interactive view state
   * (camera pan/zoom, drill-down path, focus, highlights, multi-selection, pins, and
   * active `timelineStep` when a timeline is configured).
   */
  getViewState(): SimplexViewState {
    const base = this.engine.getViewState();
    const timelineCtrl = this.timelineSession.getController();
    if (!timelineCtrl) {
      return base;
    }
    return {
      ...base,
      timelineStep: timelineCtrl.getState().step,
    };
  }

  /**
   * Restores a previously serialized `SimplexViewState` snapshot (for deep-linking,
   * browser history navigation, or session persistence).
   *
   * When a timeline controller is attached and `state.timelineStep` is provided,
   * pauses playback and seeks to the target step before restoring drill-down, camera,
   * focus, highlights, pins, and multi-selection.
   */
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
        this.ensureLoopRunning();
      },
    });
  }

  /** Updates the touch direction-locking threshold in CSS pixels (`0` disables scroll-yielding). */
  setTouchScrollLockPx(px: number): void {
    this.touchScrollLockPx = Number.isFinite(px) ? Math.max(0, px) : 8;
    this.viewportHandle?.syncTouchAction();
  }

  /** Updates the maximum drag-vs-click pointer displacement tolerance in CSS pixels. */
  setClickTolerancePx(px: number): void {
    this.clickTolerancePx = Number.isFinite(px) ? Math.max(0, px) : 12;
  }

  /**
   * Updates the reduced-motion preference (`'auto' | boolean`).
   * Under `'auto'`, tracks `window.matchMedia('(prefers-reduced-motion: reduce)')` live.
   */
  setReducedMotion(preference: ReducedMotionPreference): void {
    if (this.destroyed) return;
    this.reducedMotionPreference = preference;
    this.syncReducedMotionMediaSubscription();
    this.applyReducedMotionState(this.computeReducedMotionActive());
  }

  /** Returns the configured `reducedMotion` preference (`'auto' | boolean`). */
  getReducedMotion(): ReducedMotionPreference {
    return this.reducedMotionPreference;
  }

  /** Returns `true` when motion reduction is currently active (explicit `true` or OS `reduce` under `'auto'`). */
  isReducedMotionActive(): boolean {
    return this.reducedMotionActive;
  }

  private computeReducedMotionActive(): boolean {
    return resolveSimplexReducedMotion(
      this.reducedMotionPreference,
      this.containerEl.ownerDocument,
    );
  }

  private syncReducedMotionAttribute(): void {
    if (this.reducedMotionActive) {
      this.svgEl.setAttribute('data-reduced-motion', 'true');
    } else {
      this.svgEl.removeAttribute('data-reduced-motion');
    }
  }

  private applyReducedMotionState(active: boolean): void {
    this.reducedMotionActive = active;
    this.syncReducedMotionAttribute();
    this.engine.setReducedMotion(active);
  }

  private detachReducedMotionMediaSubscription(): void {
    this.reducedMotionMediaCleanup?.();
    this.reducedMotionMediaCleanup = null;
  }

  private syncReducedMotionMediaSubscription(): void {
    this.detachReducedMotionMediaSubscription();
    if (this.destroyed || this.reducedMotionPreference !== 'auto') return;
    this.reducedMotionMediaCleanup = subscribeSimplexReducedMotionMedia(
      this.reducedMotionPreference,
      this.containerEl.ownerDocument,
      (matches) => {
        if (this.destroyed || this.reducedMotionPreference !== 'auto') return;
        this.applyReducedMotionState(matches);
      },
    );
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

  /**
   * Serializes the current simplex view (including zoomed sub-levels, camera framing,
   * filters, highlights, and timeline frames) as a standalone, publication-ready `<svg>` string
   * with resolved inline styles and active theme background.
   */
  exportSvg(options?: ExportSvgOptions): string {
    if (this.destroyed) {
      throw new Error('SimplexSvgController.exportSvg: cannot export after destroy().');
    }
    this.engine.renderNow();
    return prepareStandaloneSvg(
      this.svgEl,
      { theme: this.currentTheme },
      options,
    ).svgString;
  }

  /**
   * Rasterizes the current simplex view onto an offscreen HiDPI `<canvas>` and returns
   * a PNG `Blob` (default) or base64 `data:` URL string (`{ format: 'dataUrl' }`).
   */
  exportPng(options: ExportPngDataUrlOptions): Promise<string>;
  exportPng(options?: ExportPngBlobOptions): Promise<Blob>;
  exportPng(options?: ExportPngOptions): Promise<Blob | string>;
  exportPng(options?: ExportPngOptions): Promise<Blob | string> {
    if (this.destroyed) {
      return Promise.reject(
        new Error('SimplexSvgController.exportPng: cannot export after destroy().'),
      );
    }
    this.engine.renderNow();
    return exportSvgElementToPng(
      this.svgEl,
      { theme: this.currentTheme },
      options,
    );
  }

  /** Deterministically advances simulation & timeline clocks in tests without waiting for rAF. */
  stepForTest(dtMs: number): boolean {
    this.timelineSession.getController()?.tick(dtMs);
    return this.engine.step(dtMs);
  }

  private triggerPinchDrillIn(screenX: number, screenY: number): boolean {
    return applySimplexPinchDrillTarget(
      resolveSimplexPinchDrillTarget(this.engine, screenX, screenY),
      {
        drillToNeighbor: (id) => this.drillToNeighbor(id),
        drillDownTriangle: (idx) => this.drillDownTriangle(idx),
        drillDownCluster: (uid) => this.drillDownCluster(uid),
      },
    );
  }

  private syncZoomOverlays(state: SimplexZoomState): void {
    if (this.destroyed) return;
    this.breadcrumbOverlay.setTheme(this.currentTheme);
    this.breadcrumbOverlay.sync(state, this.showZoomBreadcrumbs);
  }

  private syncTimelineOverlay(
    state: SimplexTimelineState<TItem> | null,
  ): void {
    if (this.destroyed) return;
    this.timelineOverlay.sync(state, {
      visible: this.timelineSession.getShowControls(),
      position: this.timelineSession.getPosition(),
      theme: this.currentTheme,
    });
  }

  private announce(message: string): void {
    if (this.destroyed || !message) return;
    this.srAnnouncer.announce(message);
  }

  private buildAriaMetadataResolver(): SvgAriaMetadataResolver<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  > {
    return {
      getClusterAria: (node) => {
        if (!this.engine) {
          return { role: 'button', label: `Topic cluster ${node.id}` };
        }
        const cluster = this.engine.getClusterByUid(node.id);
        if (!cluster) {
          return { role: 'button', label: `Topic cluster ${node.id}` };
        }
        return formatSimplexClusterAriaMetadata(
          cluster,
          this.engine.getZoomState(),
          { isFocused: this.focusedClusterUidState === cluster.clusterUid },
        );
      },
      getItemAria: (node) => {
        if (!this.engine) {
          return { role: 'button', label: `Item ${node.id}` };
        }
        const rec = this.engine.getItemLayoutById(node.id);
        if (!rec) {
          return { role: 'button', label: `Item ${node.id}` };
        }
        return formatSimplexItemAriaMetadata(rec.item, rec.layoutContext, {
          getLabel: this.getLabelExtractor,
          formatTagLabel: this.formatTagLabelFn,
          isFilteredDimmed: node.isFilteredOut,
        });
      },
      getTriangleAria: (tr) => {
        if (!this.engine) {
          return { hidden: true };
        }
        return formatSimplexTriangleAriaMetadata(tr, this.engine.getZoomState(), {
          isFocused: tr.interaction.isFocused,
          hideEmptyUninteractive: true,
        });
      },
    };
  }

  private syncSvgAccessibilityAttributes(): void {
    this.svgEl.setAttribute('role', 'application');
    this.svgEl.setAttribute('aria-roledescription', 'interactive topic graph');
    this.svgEl.setAttribute('aria-label', this.ariaLabel);
    if (this.keyboardNavigationEnabled) {
      this.svgEl.setAttribute('tabindex', '0');
      this.svgEl.setAttribute(
        'aria-keyshortcuts',
        'ArrowRight ArrowLeft ArrowDown ArrowUp Home End Enter Space Escape',
      );
    } else {
      this.svgEl.removeAttribute('tabindex');
      this.svgEl.removeAttribute('aria-keyshortcuts');
      this.svgEl.removeAttribute('aria-activedescendant');
    }
  }

  /** Updates the `aria-label` on the root `<svg>` element at runtime. */
  setAriaLabel(label: string): void {
    this.ariaLabel = label.trim() || DEFAULT_ARIA_LABEL;
    this.syncSvgAccessibilityAttributes();
  }

  /** Enables or disables built-in keyboard navigation and focus ring tracking at runtime. */
  setKeyboardNavigation(enabled: boolean): void {
    if (this.keyboardNavigationEnabled === enabled) return;
    this.keyboardNavigationEnabled = enabled;
    this.keyboardNavigator.setEnabled(enabled);
    this.syncSvgAccessibilityAttributes();
  }

  /** Returns the currently keyboard-focused cluster, item, or triangle target, or `null`. */
  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null {
    return this.keyboardNavigator.getFocusTarget();
  }

  /** Clears the active keyboard focus ring, `aria-activedescendant`, and synthetic hover tooltip. */
  clearKeyboardFocus(options?: { readonly preserveHover?: boolean }): void {
    this.keyboardNavigator.clearFocus(options);
  }

  /** Returns the ordered list of currently visible, keyboard-navigable scene targets. */
  getInteractiveTargets(): readonly SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] {
    return this.engine.getInteractiveTargets();
  }

  private ensureMarqueeRect(): SVGRectElement {
    if (!this.marqueeOverlayGroup || !this.marqueeRectEl) {
      const doc = this.svgEl.ownerDocument;
      const group = doc.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'sv-marquee-overlay');
      group.setAttribute('pointer-events', 'none');
      group.setAttribute('display', 'none');

      const rect = doc.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'sv-marquee-rect');
      rect.setAttribute('rx', '3');
      rect.setAttribute('ry', '3');
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('stroke-dasharray', '4 3');
      group.appendChild(rect);
      this.svgEl.appendChild(group);

      this.marqueeOverlayGroup = group;
      this.marqueeRectEl = rect;
    }
    const isLight = this.currentTheme === 'light';
    this.marqueeRectEl.setAttribute(
      'fill',
      isLight ? 'rgba(124, 58, 237, 0.12)' : 'rgba(139, 92, 246, 0.16)',
    );
    this.marqueeRectEl.setAttribute('stroke', isLight ? '#7c3aed' : '#a78bfa');
    return this.marqueeRectEl;
  }

  private showMarqueeRect(x: number, y: number, width: number, height: number): void {
    const rect = this.ensureMarqueeRect();
    rect.setAttribute('x', x.toFixed(1));
    rect.setAttribute('y', y.toFixed(1));
    rect.setAttribute('width', width.toFixed(1));
    rect.setAttribute('height', height.toFixed(1));
    this.marqueeOverlayGroup?.removeAttribute('display');
  }

  private hideMarqueeRect(): void {
    if (this.marqueeOverlayGroup) {
      this.marqueeOverlayGroup.setAttribute('display', 'none');
    }
  }

  private attachViewportInteractions(): void {
    this.viewportHandle = bindSimplexInteractiveViewport({
      surfaceEl: this.svgEl,
      engine: this.engine,
      clickDispatch: 'click-event',
      bindTouchListeners: true,
      capturePointer: false,
      pinchDrillInRatio: 1.28,
      getTouchScrollLockPx: () => this.touchScrollLockPx,
      getClickTolerancePx: () => this.clickTolerancePx,
      isMarqueeEnabled: () => this.marqueeSelectionEnabled,
      isDestroyed: () => this.destroyed,
      canStartFreeCameraPan: (x, y) => {
        const hit = this.engine.hitTest(x, y);
        return hit.kind === 'background' || hit.kind === 'triangle';
      },
      hideTooltip: () => this.tooltipOverlay.hide(),
      onMarqueeChange: (rect) => {
        if (!rect) {
          this.hideMarqueeRect();
        } else {
          this.showMarqueeRect(rect.x, rect.y, rect.width, rect.height);
        }
      },
      onMarqueeCommit: (x1, y1, x2, y2, altKey) => {
        const prevSize = this.engine.getSelectedIds().size;
        const nextSelected = this.engine.selectItemsInScreenRect(x1, y1, x2, y2, {
          mode: altKey ? 'toggle' : 'add',
        });
        this.engine.renderNow();
        this.ensureLoopRunning();
        if (nextSelected.size !== prevSize) {
          this.announce(
            `Selected ${nextSelected.size} item${nextSelected.size === 1 ? '' : 's'}`,
          );
        }
      },
      onPinchDrillIn: (midX, midY) => this.triggerPinchDrillIn(midX, midY),
      onDrillUp: () => this.drillUp(),
      onAfterCameraTransform: () => {
        this.engine.renderNow();
      },
      onAfterLeftClick: () => {
        this.engine.renderNow();
      },
      onScheduleFrame: () => {
        this.ensureLoopRunning();
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

  private ensureLoopRunning(): void {
    if (this.destroyed || this.rafId !== null || this.controllerBatchDepth > 0) return;
    if (typeof requestAnimationFrame === 'undefined') {
      this.engine.renderNow();
      return;
    }
    this.lastFrameTs = performance.now();
    const tick = (now: number) => {
      if (this.destroyed) return;
      const dtMs = Math.max(1, Math.min(50, now - this.lastFrameTs));
      this.lastFrameTs = now;
      this.fpsTracker.recordFrame(dtMs);

      const timelineCtrl = this.timelineSession.getController();
      timelineCtrl?.tick(dtMs);
      const settled = this.engine.step(dtMs);
      const timelinePlaying = timelineCtrl?.getState().playing ?? false;
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
    this.timelineSession.destroy();
    this.resizeObserverHandle?.disconnect();
    this.fontLoadCleanup?.();
    this.fontLoadCleanup = null;
    this.detachReducedMotionMediaSubscription();
    this.hideMarqueeRect();
    this.marqueeOverlayGroup = null;
    this.marqueeRectEl = null;
    this.viewportHandle?.destroy();
    this.viewportHandle = null;
    this.engine.destroy();
    this.tooltipOverlay.destroy();
    this.breadcrumbOverlay.destroy();
    this.srAnnouncer.destroy();
    this.timelineOverlay.destroy();
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
