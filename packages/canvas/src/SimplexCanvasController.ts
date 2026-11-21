import {
  SimplexGraphEngine,
  SimplexTimelineController,
  createFinalSeededClusteringStrategy,
  createFinalSeededLayoutStrategy,
  createSimplexTimeline,
  isPointInTriangle,
  type CameraController,
  type ClusterDerivationContext,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ContentHoverEvent,
  type DefaultTaggedItem,
  type EmptyClusterBehavior,
  type FocusItemOptions,
  type InteractionHandlers,
  type ItemFilterMode,
  type ItemFilterOptions,
  type ItemFilterPredicate,
  type ItemFilterState,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type NormalizedPointerEvent,
  type NormalizedWheelEvent,
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
  type SimplexTimelineListener,
  type SimplexTimelineOptions,
  type SimplexTimelineState,
  type SimplexViewState,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type TriangleHoverEvent,
  type VisualResolver,
  type ZoomToItemOptions,
} from '@simplex-viz/core';
import {
  CanvasRendererAdapter,
} from './CanvasRendererAdapter.js';
import {
  createCanvasPresetVisualResolver,
  extractCanvasItemLabel,
} from './presets.js';
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

export interface CanvasTimelineConfig<TItem = DefaultTaggedItem>
  extends SimplexTimelineOptions<TItem> {
  /** Wrap clustering in `createFinalSeededClusteringStrategy` so clusters stay pinned. Default: `true`. */
  readonly autoFinalSeed?: boolean;
  /** Pin item coordinates across frames (`false` | `'pinned'` | `'adaptive'`). Default: `false`. */
  readonly autoFinalSeedLayout?: false | 'pinned' | 'adaptive';
  /** Visibility for 0-item clusters across timeline frames. */
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  /** Optional listener invoked whenever timeline playback state changes. */
  readonly onStateChange?: SimplexTimelineListener<TItem>;
}

export type CanvasTooltipOption<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | boolean
  | {
      readonly formatContent?: (
        event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
      ) => string;
      readonly formatCluster?: (
        event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
      ) => string;
      readonly formatTriangle?: (
        event: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta>,
      ) => string;
    };

export interface SimplexCanvasControllerOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items: readonly TItem[];
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly getLabel?: (item: TItem) => string;
  readonly normalizeTag?: (rawTag: string) => string;
  readonly formatTagLabel?: (tag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;

  /** Built-in visual preset (`'geometric'` | `'glyphs'` | `'badges'`). Default: `'badges'`. */
  readonly preset?: CanvasVisualPreset;
  /** Theme (`'dark'` | `'light'`). Default: `'dark'`. */
  readonly theme?: CanvasTheme;
  /** Explicit canvas background fill (`'transparent'` for alpha canvas). */
  readonly backgroundColor?: string;
  /** Maximum devicePixelRatio cap (default `2`). */
  readonly maxDevicePixelRatio?: number;
  /** Screen-space radius threshold (CSS px) below which shapes simplify for 60 FPS LOD. Default: `3.5`. */
  readonly lodThresholdPx?: number;
  /** World-space viewport culling margin (px). Default: `48`. */
  readonly cullMarginPx?: number;

  readonly badgeOptions?: CanvasBadgeOptions<TItem, TTagMeta, TClusterMeta>;
  readonly getShape?: CanvasContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  readonly shapeOptions?: CanvasShapeOptions;

  readonly visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly contentRenderer?: CanvasNodeRenderer<TContentVisual>;
  readonly clusterRenderer?: CanvasNodeRenderer<TClusterVisual>;
  readonly triangleRenderer?: CanvasTriangleRenderer<TItem, TTagMeta, TClusterMeta>;
  readonly edgeRenderer?: CanvasEdgeRenderer<TItem, TTagMeta, TClusterMeta>;

  readonly width?: number;
  readonly height?: number;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexMeshStrategy<TItem>;
  readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  readonly layoutStrategy?: SimplexLayoutStrategy;
  readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;

  readonly showHulls?: boolean;
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  readonly itemFilter?: ItemFilterPredicate<TItem> | null;
  readonly itemFilterMode?: ItemFilterMode;
  readonly highlightedIds?: Iterable<string> | null;
  readonly selectedIds?: Iterable<string> | null;
  readonly shiftClickSelects?: boolean;
  readonly marqueeSelection?: boolean;
  readonly reducedMotion?: ReducedMotionPreference;
  readonly deferInitialLayout?: boolean;
  readonly touchScrollLockPx?: number;
  readonly clickTolerancePx?: number;
  readonly keyboardNavigation?: boolean;
  readonly ariaLabel?: string;
  readonly tooltip?: CanvasTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly timeline?: CanvasTimelineConfig<TItem> | null;

  readonly interactions?: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly onMetricsChange?: (metrics: LayoutMetrics) => void;
  readonly onZoomStateChange?: (zoomState: SimplexZoomState) => void;
  readonly onSelectionChange?: (selectedIds: ReadonlySet<string>) => void;
  readonly onLegendChange?: (
    legend: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ) => void;
}

export type SimplexCanvasUpdateOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Partial<
  Omit<
    SimplexCanvasControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'items'
  >
> & {
  readonly items?: readonly TItem[];
};

function resolveContainer(container: HTMLElement | string): HTMLElement {
  if (typeof container === 'string') {
    if (typeof document === 'undefined') {
      throw new Error('createSimplexCanvas(): cannot query CSS selector outside a DOM environment.');
    }
    const el = document.querySelector<HTMLElement>(container);
    if (!el) {
      throw new Error(`createSimplexCanvas(): container "${container}" not found.`);
    }
    return el;
  }
  return container;
}

function readContainerSize(
  container: HTMLElement,
  fallbackW?: number,
  fallbackH?: number,
): { readonly width: number; readonly height: number; readonly isZero: boolean } {
  const rect =
    typeof container.getBoundingClientRect === 'function'
      ? container.getBoundingClientRect()
      : { width: 0, height: 0 };
  const measuredW = rect.width || container.clientWidth || 0;
  const measuredH = rect.height || container.clientHeight || 0;
  if (measuredW > 0 && measuredH > 0) {
    return { width: measuredW, height: measuredH, isZero: false };
  }
  return {
    width: Math.max(160, fallbackW ?? 960),
    height: Math.max(160, fallbackH ?? 600),
    isZero: measuredW <= 0 || measuredH <= 0,
  };
}

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
  private readonly announcerEl: HTMLDivElement;
  private readonly tooltipEl: HTMLDivElement;
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
  private getLabel?: (item: TItem) => string;
  private formatTagLabel?: (tag: string) => string;
  private badgeOptions?: CanvasBadgeOptions<TItem, TTagMeta, TClusterMeta>;
  private getShape?: CanvasContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  private shapeOptions?: CanvasShapeOptions;
  private customResolver: boolean;

  private tooltipOption: CanvasTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private interactions: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private marqueeSelection: boolean;
  private touchScrollLockPx: number;
  private clickTolerancePx: number;
  private keyboardNavigation: boolean;
  private keyboardTargets: readonly SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] = [];
  private keyboardFocusIndex = -1;

  private fullItems: readonly TItem[];
  private timelineController: SimplexTimelineController<TItem> | null = null;
  private timelineConfig: CanvasTimelineConfig<TItem> | null = null;
  private timelineUnsubscribe: (() => void) | null = null;
  private readonly timelineListeners = new Set<SimplexTimelineListener<TItem>>();

  private rafId: number | null = null;
  private lastRafTime = 0;
  private repaintRequested = false;
  private destroyed = false;
  private deferredPending = false;
  private focusedClusterUidState: string | null = null;
  private focusedTriangleIndexState: number | null = null;
  private wheelPinchAccum = 0;
  private wheelPinchCooldownUntil = 0;
  private resizeObserver: ResizeObserver | null = null;
  private reducedMotionMql: MediaQueryList | null = null;
  private reducedMotionListener: (() => void) | null = null;
  private cleanupDomListeners: (() => void) | null = null;

  constructor(
    container: HTMLElement | string,
    options: SimplexCanvasControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.container = resolveContainer(container);
    this.preset = options.preset ?? 'badges';
    this.theme = options.theme ?? 'dark';
    this.getLabel = options.getLabel;
    this.formatTagLabel = options.formatTagLabel;
    this.badgeOptions = options.badgeOptions;
    this.getShape = options.getShape;
    this.shapeOptions = options.shapeOptions;
    this.customResolver = Boolean(options.visualResolver);
    this.tooltipOption = options.tooltip ?? false;
    this.interactions = options.interactions ?? {};
    this.marqueeSelection = options.marqueeSelection ?? true;
    this.touchScrollLockPx = Math.max(0, options.touchScrollLockPx ?? 8);
    this.clickTolerancePx = Math.max(0, options.clickTolerancePx ?? 12);
    this.keyboardNavigation = options.keyboardNavigation ?? true;
    this.fullItems = options.items.slice();

    // Wrapper div for canvas + optional tooltip + sr-only announcer
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
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('tabindex', this.keyboardNavigation ? '0' : '-1');
    this.canvas.setAttribute(
      'aria-label',
      options.ariaLabel ?? 'Interactive SimplexViz topic graph canvas',
    );

    this.announcerEl = doc.createElement('div');
    this.announcerEl.className = 'sv-sr-announcer';
    this.announcerEl.setAttribute('role', 'status');
    this.announcerEl.setAttribute('aria-live', 'polite');
    this.announcerEl.setAttribute('aria-atomic', 'true');
    this.announcerEl.style.position = 'absolute';
    this.announcerEl.style.width = '1px';
    this.announcerEl.style.height = '1px';
    this.announcerEl.style.overflow = 'hidden';
    this.announcerEl.style.clipPath = 'inset(50%)';
    this.announcerEl.style.whiteSpace = 'nowrap';

    this.tooltipEl = doc.createElement('div');
    this.tooltipEl.className = 'sv-canvas-tooltip';
    this.tooltipEl.style.position = 'absolute';
    this.tooltipEl.style.pointerEvents = 'none';
    this.tooltipEl.style.display = 'none';
    this.tooltipEl.style.zIndex = '20';
    this.tooltipEl.style.padding = '6px 10px';
    this.tooltipEl.style.borderRadius = '8px';
    this.tooltipEl.style.fontSize = '12px';
    this.tooltipEl.style.fontFamily =
      '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
    this.tooltipEl.style.lineHeight = '1.35';
    this.tooltipEl.style.maxWidth = '240px';
    this.tooltipEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.32)';
    this.applyTooltipTheme();

    this.rootEl.appendChild(this.canvas);
    this.rootEl.appendChild(this.tooltipEl);
    this.rootEl.appendChild(this.announcerEl);
    this.container.appendChild(this.rootEl);

    const measured = readContainerSize(this.container, options.width, options.height);
    this.deferredPending = Boolean(options.deferInitialLayout && measured.isZero);

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

    const visualResolver =
      options.visualResolver ??
      (this.buildDefaultVisualResolver() as unknown as VisualResolver<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >);

    // Resolve initial timeline wrapping if configured
    let initialItems: readonly TItem[] = this.fullItems;
    let initialClustering = options.clusteringStrategy;
    let initialLayout = options.layoutStrategy;
    let initialEmptyBehavior = options.emptyClusterBehavior;

    if (options.timeline) {
      this.timelineConfig = options.timeline;
      const tl = createSimplexTimeline<TItem>(this.fullItems, options.timeline);
      this.timelineController = tl;
      initialItems = tl.getActiveItems();
      if (options.timeline.autoFinalSeed !== false) {
        initialClustering = createFinalSeededClusteringStrategy<TItem, TTagMeta>(
          initialClustering,
          { seedItems: this.fullItems },
        );
      }
      if (options.timeline.autoFinalSeedLayout) {
        initialLayout = createFinalSeededLayoutStrategy(initialLayout, {
          scaleMode: options.timeline.autoFinalSeedLayout,
        });
      }
      if (options.timeline.emptyClusterBehavior) {
        initialEmptyBehavior = options.timeline.emptyClusterBehavior;
      }
    }

    const engineConfig = {
      items: initialItems,
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
      layoutOptions: options.layoutOptions,
      meshStrategy: options.meshStrategy,
      clusteringStrategy: initialClustering,
      colorStrategy: options.colorStrategy,
      layoutStrategy: initialLayout,
      zoomStrategy: options.zoomStrategy,
      showHulls: options.showHulls,
      emptyClusterBehavior: initialEmptyBehavior,
      itemFilter: options.itemFilter,
      itemFilterMode: options.itemFilterMode,
      selectedIds: options.selectedIds,
      shiftClickSelects: options.shiftClickSelects,
      reducedMotion: this.resolveReducedMotionValue(options.reducedMotion ?? 'auto'),
      deferInitialSolve: this.deferredPending,
      interactions: this.buildWrappedInteractions(),
      onMetricsChange: options.onMetricsChange,
      onZoomStateChange: (zs: SimplexZoomState) => {
        this.keyboardTargets = [];
        this.keyboardFocusIndex = -1;
        this.adapter.setKeyboardFocusTarget(null);
        options.onZoomStateChange?.(zs);
      },
      onSelectionChange: options.onSelectionChange,
      onLegendChange: options.onLegendChange,
    };

    this.engine = new SimplexGraphEngine(
      engineConfig as unknown as ConstructorParameters<
        typeof SimplexGraphEngine<
          TItem,
          TContentVisual,
          TClusterVisual,
          TTagMeta,
          TClusterMeta
        >
      >[0],
    );

    if (options.timeline && this.timelineController) {
      this.engine.setCanonicalSeedItems(this.fullItems);
      this.wireTimelineSubscription(options.timeline);
    }

    if (options.highlightedIds !== undefined) {
      this.engine.setHighlightedItems(options.highlightedIds);
    }

    this.bindReducedMotionMediaQuery(options.reducedMotion ?? 'auto');
    this.bindDomEvents();
    this.bindResizeObserver();
    this.scheduleFrame();
  }

  private buildDefaultVisualResolver(): VisualResolver<
    TItem,
    CanvasDefaultContentVisual,
    CanvasDefaultClusterVisual,
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
    );
  }

  private applyTooltipTheme(): void {
    if (this.theme === 'dark') {
      this.tooltipEl.style.background = 'rgba(15, 23, 42, 0.94)';
      this.tooltipEl.style.color = '#f8fafc';
      this.tooltipEl.style.border = '1px solid rgba(148, 163, 184, 0.28)';
    } else {
      this.tooltipEl.style.background = 'rgba(255, 255, 255, 0.96)';
      this.tooltipEl.style.color = '#0f172a';
      this.tooltipEl.style.border = '1px solid rgba(15, 23, 42, 0.14)';
    }
  }

  private showTooltip(text: string, screenX: number, screenY: number): void {
    if (!text) {
      this.hideTooltip();
      return;
    }
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.display = 'block';
    const w = this.rootEl.clientWidth || 960;
    const h = this.rootEl.clientHeight || 600;
    const left = Math.min(Math.max(8, screenX + 14), Math.max(8, w - 220));
    const top = Math.min(Math.max(8, screenY - 34), Math.max(8, h - 44));
    this.tooltipEl.style.left = `${Math.round(left)}px`;
    this.tooltipEl.style.top = `${Math.round(top)}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private announce(message: string): void {
    if (!message) return;
    this.announcerEl.textContent = '';
    this.announcerEl.textContent = message;
  }

  private updateCursorForPoint(screenX: number, screenY: number): void {
    const zoomMode = this.engine.getZoomStrategy().mode;
    const hit = this.engine.hitTest(screenX, screenY);
    if (zoomMode === 'drill-down') {
      const zState = this.engine.getZoomState();
      if (hit.kind === 'triangle') {
        if (hit.triangle.neighborId) {
          this.canvas.style.cursor = 'pointer';
        } else if (
          zState.activeFrameKind === 'triangle-focus' &&
          zState.canDrillUp
        ) {
          this.canvas.style.cursor = 'zoom-out';
        } else {
          this.canvas.style.cursor =
            zState.drillableTriangleIndices.includes(hit.triangle.index) ||
            zState.focusableTriangleIndices.includes(hit.triangle.index)
              ? 'zoom-in'
              : 'default';
        }
      } else if (hit.kind === 'cluster') {
        if (hit.neighborId) {
          this.canvas.style.cursor = 'pointer';
        } else if (
          zState.activeFrameKind === 'cluster-star' &&
          hit.cluster.clusterIndex === 0 &&
          zState.canDrillUp
        ) {
          this.canvas.style.cursor = 'zoom-out';
        } else {
          this.canvas.style.cursor = zState.drillableClusterUids.includes(
            hit.cluster.clusterUid,
          )
            ? 'zoom-in'
            : 'default';
        }
      } else if (hit.kind === 'content') {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = zState.canDrillUp ? 'zoom-out' : 'default';
      }
    } else {
      this.canvas.style.cursor = hit.kind === 'background' ? 'grab' : 'pointer';
    }
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

  private buildWrappedInteractions(): InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return {
      onContentHover: (ev) => {
        const consumed = this.interactions.onContentHover?.(ev);
        if (consumed === true || !this.tooltipOption) {
          if (!ev) this.hideTooltip();
          return consumed;
        }
        if (!ev) {
          this.hideTooltip();
          return consumed;
        }
        const text =
          typeof this.tooltipOption === 'object' && this.tooltipOption.formatContent
            ? this.tooltipOption.formatContent(ev)
            : extractCanvasItemLabel(ev.item, ev.layoutContext.id, this.getLabel);
        this.showTooltip(text, ev.screenPosition.x, ev.screenPosition.y);
        return consumed;
      },
      onClusterHover: (ev) => {
        const consumed = this.interactions.onClusterHover?.(ev);
        if (consumed === true || !this.tooltipOption) {
          if (!ev) this.hideTooltip();
          return consumed;
        }
        if (!ev) {
          this.hideTooltip();
          return consumed;
        }
        const text =
          typeof this.tooltipOption === 'object' && this.tooltipOption.formatCluster
            ? this.tooltipOption.formatCluster(ev)
            : `${ev.cluster.subclusterLabel ?? ev.cluster.defaultLabel} (${ev.cluster.members.length})`;
        this.showTooltip(text, ev.screenPosition.x, ev.screenPosition.y);
        return consumed;
      },
      onTriangleHover: (ev) => {
        const consumed = this.interactions.onTriangleHover?.(ev);
        if (consumed === true || !this.tooltipOption) {
          if (!ev) this.hideTooltip();
          return consumed;
        }
        if (!ev) {
          this.hideTooltip();
          return consumed;
        }
        if (typeof this.tooltipOption === 'object' && this.tooltipOption.formatTriangle) {
          const text = this.tooltipOption.formatTriangle(ev);
          this.showTooltip(text, ev.screenPosition.x, ev.screenPosition.y);
        } else {
          this.hideTooltip();
        }
        return consumed;
      },
      onLeftClick: (target, rawEvent) => {
        if (target.kind === 'content' && !target.neighborId) {
          if (this.interactions.onContentClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'cluster') {
          if (this.interactions.onClusterClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'triangle') {
          if (this.interactions.onTriangleClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'background') {
          if (this.interactions.onBackgroundClick?.(rawEvent) === true) {
            return true;
          }
        }
        if (this.interactions.onLeftClick?.(target, rawEvent) === true) {
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
            if (this.engine.getZoomState().canDrillUp) {
              this.drillUp();
            } else if (!rawEvent.shiftKey && this.engine.getSelectedIds().size > 0) {
              this.clearSelection();
            }
          }
          return false;
        }

        // Free-camera mode: toggle focused cluster/triangle or clear focus/selection on background
        if (target.kind === 'cluster') {
          if (this.focusedTriangleIndexState !== null) {
            this.setFocusedTriangleIndex(null);
          }
          const next =
            this.focusedClusterUidState === target.cluster.clusterUid
              ? null
              : target.cluster.clusterUid;
          this.setFocusedClusterUid(next);
        } else if (target.kind === 'triangle') {
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
          if (this.engine.getFocusedItemId() !== null) {
            this.focusItem(null);
          }
          if (!rawEvent.shiftKey && this.engine.getSelectedIds().size > 0) {
            this.clearSelection();
          }
        }
        return false;
      },
      onRightClick: (target, raw) => this.interactions.onRightClick?.(target, raw),
      onWheel: this.interactions.onWheel ?? 'zoom-to-cursor',
    };
  }

  private resolveReducedMotionValue(pref: ReducedMotionPreference): ReducedMotionPreference {
    if (pref !== 'auto') return pref;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  }

  private bindReducedMotionMediaQuery(pref: ReducedMotionPreference): void {
    if (this.reducedMotionMql && this.reducedMotionListener) {
      this.reducedMotionMql.removeEventListener?.('change', this.reducedMotionListener);
      this.reducedMotionMql = null;
      this.reducedMotionListener = null;
    }
    if (pref !== 'auto') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      this.engine.setReducedMotion(mql.matches);
      this.rootEl.dataset.reducedMotion = String(mql.matches);
      this.scheduleFrame();
    };
    this.rootEl.dataset.reducedMotion = String(mql.matches);
    mql.addEventListener?.('change', onChange);
    this.reducedMotionMql = mql;
    this.reducedMotionListener = onChange;
  }

  private wireTimelineSubscription(config: CanvasTimelineConfig<TItem>): void {
    this.timelineUnsubscribe?.();
    this.timelineUnsubscribe = null;
    if (!this.timelineController) return;

    let lastStep = this.timelineController.getState().step;
    this.timelineUnsubscribe = this.timelineController.subscribe((state) => {
      if (state.step !== lastStep) {
        lastStep = state.step;
        this.engine.setItems(this.timelineController!.getActiveItems());
      }
      if (state.playing) {
        this.scheduleFrame();
      }
      config.onStateChange?.(state);
      for (const listener of this.timelineListeners) {
        listener(state);
      }
    });
  }

  private toCanvasLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private toNormalizedPointer(
    ev: PointerEvent | MouseEvent,
    localX: number,
    localY: number,
  ): NormalizedPointerEvent {
    const world = this.engine.camera.screenToWorld(localX, localY);
    return {
      screenX: localX,
      screenY: localY,
      worldX: world.x,
      worldY: world.y,
      button: ev.button,
      shiftKey: ev.shiftKey,
      ctrlKey: ev.ctrlKey,
      altKey: ev.altKey,
      metaKey: ev.metaKey,
    };
  }

  private bindDomEvents(): void {
    let activePointerId: number | null = null;
    let isDragging = false;
    let isMarquee = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let peakDisplacement = 0;
    let touchLockedAxis: 'none' | 'vertical' | 'canvas' = 'none';
    const activeTouches = new Map<number, { x: number; y: number }>();
    let lastPinchDist = 0;
    let pinchStartDist = 0;
    let pinchHandledInGesture = false;

    const onPointerDown = (ev: PointerEvent): void => {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      const local = this.toCanvasLocal(ev.clientX, ev.clientY);

      if (ev.pointerType === 'touch') {
        activeTouches.set(ev.pointerId, local);
        if (activeTouches.size === 2) {
          const pts = Array.from(activeTouches.values());
          const initialDist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
          lastPinchDist = initialDist;
          pinchStartDist = initialDist;
          pinchHandledInGesture = false;
          isDragging = false;
          return;
        }
      }

      activePointerId = ev.pointerId;
      startX = local.x;
      startY = local.y;
      lastX = local.x;
      lastY = local.y;
      peakDisplacement = 0;
      touchLockedAxis = 'none';
      isMarquee = Boolean(ev.shiftKey && this.marqueeSelection && ev.pointerType !== 'touch');
      isDragging = true;

      if (typeof this.canvas.setPointerCapture === 'function') {
        try {
          this.canvas.setPointerCapture(ev.pointerId);
        } catch {
          // Ignore synthetic pointer events in tests
        }
      }
    };

    const onPointerMove = (ev: PointerEvent): void => {
      const local = this.toCanvasLocal(ev.clientX, ev.clientY);

      if (ev.pointerType === 'touch' && activeTouches.has(ev.pointerId)) {
        activeTouches.set(ev.pointerId, local);
        if (activeTouches.size === 2) {
          const pts = Array.from(activeTouches.values());
          const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
          const midX = (pts[0]!.x + pts[1]!.x) * 0.5;
          const midY = (pts[0]!.y + pts[1]!.y) * 0.5;
          const zoomMode = this.engine.getZoomStrategy().mode;
          if (zoomMode === 'free-camera') {
            if (lastPinchDist > 4 && dist > 4) {
              this.engine.camera.zoomToCursor(midX, midY, dist / lastPinchDist);
              this.scheduleFrame();
            }
          } else if (zoomMode === 'drill-down' && !pinchHandledInGesture && pinchStartDist > 8) {
            const ratio = dist / pinchStartDist;
            if (ratio >= 1.24) {
              pinchHandledInGesture = true;
              this.triggerPinchDrillIn(midX, midY);
            } else if (ratio <= 0.78) {
              pinchHandledInGesture = true;
              this.drillUp();
            }
          }
          lastPinchDist = dist;
          return;
        }
      }

      if (isDragging && ev.pointerId === activePointerId) {
        const dxTotal = local.x - startX;
        const dyTotal = local.y - startY;
        const dist = Math.hypot(dxTotal, dyTotal);
        if (dist > peakDisplacement) peakDisplacement = dist;

        if (isMarquee) {
          if (dist > 4) {
            this.hideTooltip();
            this.canvas.style.cursor = 'crosshair';
          }
          const rect: CanvasMarqueeRect = {
            x: Math.min(startX, local.x),
            y: Math.min(startY, local.y),
            width: Math.abs(dxTotal),
            height: Math.abs(dyTotal),
          };
          this.adapter.setMarqueeRect(rect);
          return;
        }

        if (ev.pointerType === 'touch' && this.touchScrollLockPx > 0 && touchLockedAxis === 'none') {
          if (dist >= this.touchScrollLockPx) {
            touchLockedAxis = Math.abs(dyTotal) > Math.abs(dxTotal) ? 'vertical' : 'canvas';
          }
        }
        if (touchLockedAxis === 'vertical') return;

        if (this.engine.getZoomStrategy().mode === 'free-camera' && peakDisplacement > 3) {
          this.canvas.style.cursor = 'grabbing';
          this.hideTooltip();
          this.engine.camera.panBy(local.x - lastX, local.y - lastY);
          this.scheduleFrame();
        }
        lastX = local.x;
        lastY = local.y;
        return;
      }

      if (ev.pointerType === 'touch') {
        return;
      }

      // Hover hit-testing & cursor parity with SimplexSvgController
      this.engine.handlePointerMove(local.x, local.y);
      this.updateCursorForPoint(local.x, local.y);
      this.scheduleFrame();
    };

    const onPointerUp = (ev: PointerEvent): void => {
      const local = this.toCanvasLocal(ev.clientX, ev.clientY);
      activeTouches.delete(ev.pointerId);
      if (activeTouches.size < 2) {
        lastPinchDist = 0;
        pinchStartDist = 0;
        pinchHandledInGesture = false;
      }

      if (ev.pointerId !== activePointerId) return;
      const wasMarquee = isMarquee;
      const moved = peakDisplacement;
      isDragging = false;
      isMarquee = false;
      activePointerId = null;

      if (wasMarquee) {
        this.adapter.setMarqueeRect(null);
        if (moved > 4) {
          this.engine.selectItemsInScreenRect(
            Math.min(startX, local.x),
            Math.min(startY, local.y),
            Math.max(startX, local.x),
            Math.max(startY, local.y),
            { mode: ev.altKey ? 'toggle' : 'add' },
          );
          this.updateCursorForPoint(local.x, local.y);
          this.scheduleFrame();
          return;
        }
      }

      if (moved <= this.clickTolerancePx && touchLockedAxis !== 'vertical') {
        this.engine.handleLeftClick(this.toNormalizedPointer(ev, local.x, local.y));
        if (ev.pointerType !== 'touch') {
          this.updateCursorForPoint(local.x, local.y);
        }
        this.scheduleFrame();
      } else if (ev.pointerType !== 'touch') {
        this.updateCursorForPoint(local.x, local.y);
      }
    };

    const onPointerLeave = (): void => {
      this.engine.handlePointerLeave();
      this.hideTooltip();
      this.canvas.style.cursor =
        this.engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';
      this.scheduleFrame();
    };

    const onContextMenu = (ev: MouseEvent): void => {
      const local = this.toCanvasLocal(ev.clientX, ev.clientY);
      const consumed = this.engine.handleRightClick(
        this.toNormalizedPointer(ev, local.x, local.y),
      );
      if (consumed) ev.preventDefault();
      this.scheduleFrame();
    };

    const onWheel = (ev: WheelEvent): void => {
      const local = this.toCanvasLocal(ev.clientX, ev.clientY);
      // Support discrete trackpad pinch-in / pinch-out when in drill-down mode
      if (this.engine.getZoomStrategy().mode === 'drill-down' && ev.ctrlKey) {
        ev.preventDefault();
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now < this.wheelPinchCooldownUntil) return;
        this.wheelPinchAccum += ev.deltaY;
        if (this.wheelPinchAccum <= -22) {
          this.wheelPinchAccum = 0;
          this.wheelPinchCooldownUntil = now + 360;
          this.triggerPinchDrillIn(local.x, local.y);
        } else if (this.wheelPinchAccum >= 22) {
          this.wheelPinchAccum = 0;
          this.wheelPinchCooldownUntil = now + 360;
          this.drillUp();
        }
        return;
      }

      const wheelEv: NormalizedWheelEvent = {
        screenX: local.x,
        screenY: local.y,
        deltaX: ev.deltaX,
        deltaY: ev.deltaY,
        ctrlKey: ev.ctrlKey,
        shiftKey: ev.shiftKey,
      };
      const handled = this.engine.handleWheel(wheelEv);
      if (handled) {
        ev.preventDefault();
        this.scheduleFrame();
      }
    };

    const toFocusTarget = (
      target: SimplexInteractiveTarget<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ): SimplexKeyboardFocusTarget =>
      target.kind === 'triangle'
        ? { kind: 'triangle', index: target.index }
        : { kind: target.kind, id: target.id };

    const describeTarget = (
      target: SimplexInteractiveTarget<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ): string => {
      if (target.kind === 'cluster') {
        return `Topic ${target.cluster.subclusterLabel ?? target.cluster.defaultLabel}, ${target.cluster.members.length} items`;
      }
      if (target.kind === 'triangle') {
        return `Region triangle ${target.index + 1}, ${target.triangle.coveredItemCount} items`;
      }
      return extractCanvasItemLabel(target.item, target.id, this.getLabel);
    };

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (!this.keyboardNavigation) return;
      if (
        ev.key === 'ArrowRight' ||
        ev.key === 'ArrowDown' ||
        ev.key === 'ArrowLeft' ||
        ev.key === 'ArrowUp' ||
        ev.key === 'Home' ||
        ev.key === 'End'
      ) {
        ev.preventDefault();
        this.keyboardTargets = this.engine.getInteractiveTargets();
        if (this.keyboardTargets.length === 0) return;

        if (ev.key === 'Home') {
          this.keyboardFocusIndex = 0;
        } else if (ev.key === 'End') {
          this.keyboardFocusIndex = this.keyboardTargets.length - 1;
        } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
          this.keyboardFocusIndex =
            (this.keyboardFocusIndex + 1 + this.keyboardTargets.length) %
            this.keyboardTargets.length;
        } else {
          this.keyboardFocusIndex =
            this.keyboardFocusIndex <= 0
              ? this.keyboardTargets.length - 1
              : this.keyboardFocusIndex - 1;
        }

        const target = this.keyboardTargets[this.keyboardFocusIndex]!;
        const focusTarget = toFocusTarget(target);
        this.engine.hoverInteractiveTarget(focusTarget);
        this.adapter.setKeyboardFocusTarget(focusTarget);
        this.announce(describeTarget(target));
        this.scheduleFrame();
        return;
      }

      if (ev.key === 'Enter' || ev.key === ' ') {
        if (
          this.keyboardFocusIndex >= 0 &&
          this.keyboardFocusIndex < this.keyboardTargets.length
        ) {
          ev.preventDefault();
          const target = this.keyboardTargets[this.keyboardFocusIndex]!;
          if (ev.shiftKey && target.kind === 'item') {
            this.engine.toggleSelectedId(target.id);
          } else {
            this.engine.activateInteractiveTarget(toFocusTarget(target));
          }
          this.scheduleFrame();
        }
        return;
      }

      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.keyboardFocusIndex = -1;
        this.adapter.setKeyboardFocusTarget(null);
        this.engine.handlePointerLeave();
        if (this.engine.getSelectedIds().size > 0) {
          this.engine.clearSelection();
        } else if (this.engine.getZoomState().depth > 0) {
          this.engine.drillUp();
        } else {
          this.engine.setFocusedClusterUid(null);
          this.engine.setFocusedTriangleIndex(null);
        }
        this.scheduleFrame();
      }
    };

    const onBlur = (): void => {
      this.keyboardFocusIndex = -1;
      this.adapter.setKeyboardFocusTarget(null);
    };

    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', onPointerUp);
    this.canvas.addEventListener('pointercancel', onPointerUp);
    this.canvas.addEventListener('pointerleave', onPointerLeave);
    this.canvas.addEventListener('contextmenu', onContextMenu);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('keydown', onKeyDown);
    this.canvas.addEventListener('blur', onBlur);

    this.cleanupDomListeners = () => {
      this.canvas.removeEventListener('pointerdown', onPointerDown);
      this.canvas.removeEventListener('pointermove', onPointerMove);
      this.canvas.removeEventListener('pointerup', onPointerUp);
      this.canvas.removeEventListener('pointercancel', onPointerUp);
      this.canvas.removeEventListener('pointerleave', onPointerLeave);
      this.canvas.removeEventListener('contextmenu', onContextMenu);
      this.canvas.removeEventListener('wheel', onWheel);
      this.canvas.removeEventListener('keydown', onKeyDown);
      this.canvas.removeEventListener('blur', onBlur);
    };
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      if (this.destroyed) return;
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width <= 0 || height <= 0) return;

      if (this.deferredPending) {
        this.deferredPending = false;
        this.adapter.invalidateHullCaches();
        this.engine.reinitializeViewport(width, height);
      } else {
        this.engine.setViewport(width, height);
      }
      this.scheduleFrame();
    });
    this.resizeObserver.observe(this.container);
  }

  private scheduleFrame(): void {
    if (this.destroyed || this.rafId !== null) return;
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

      const wantsRepaint = this.repaintRequested;
      this.repaintRequested = false;

      let needsMore = false;
      if (this.timelineController?.getState().playing) {
        this.timelineController.tick(dt);
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
  // Public Controller API (Parity with SimplexSvgController)
  // ============================================================================

  get camera(): CameraController {
    return this.engine.camera;
  }

  get timeline(): SimplexTimelineController<TItem> | null {
    return this.timelineController;
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
    const timelineStep = this.timelineController?.getState().step ?? null;
    return {
      ...this.engine.getLegendModel(options),
      timelineStep,
    };
  }

  setOnLegendChange(
    cb?: (legend: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>) => void,
  ): void {
    this.engine.setOnLegendChange(cb);
  }

  getItems(): readonly TItem[] {
    return this.fullItems;
  }

  setItems(items: readonly TItem[]): void {
    this.fullItems = items.slice();
    if (this.timelineController) {
      this.engine.setCanonicalSeedItems(this.fullItems);
      this.timelineController.setItems(this.fullItems);
      this.engine.setItems(this.timelineController.getActiveItems());
    } else {
      this.engine.setItems(this.fullItems);
    }
    this.scheduleFrame();
  }

  addItems(items: TItem | readonly TItem[]): void {
    const arr: readonly TItem[] = Array.isArray(items)
      ? (items as readonly TItem[])
      : [items as TItem];
    this.fullItems = [...this.fullItems, ...arr];
    if (this.timelineController) {
      this.setItems(this.fullItems);
    } else {
      this.engine.addItems(arr);
      this.scheduleFrame();
    }
  }

  removeItems(ids: string | readonly string[]): void {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    this.engine.removeItems(Array.from(idSet));
    this.scheduleFrame();
  }

  setPreset(preset: CanvasVisualPreset, getLabel?: (item: TItem) => string): void {
    this.preset = preset;
    if (getLabel) this.getLabel = getLabel;
    this.customResolver = false;
    this.adapter.invalidateHullCaches();
    this.engine.setVisualResolver(
      this.buildDefaultVisualResolver() as unknown as VisualResolver<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    );
    this.scheduleFrame();
  }

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
    this.adapter.setTheme(theme);
    this.applyTooltipTheme();
    this.engine.setTheme(theme);
    if (!this.customResolver) {
      this.engine.setVisualResolver(
        this.buildDefaultVisualResolver() as unknown as VisualResolver<
          TItem,
          TContentVisual,
          TClusterVisual,
          TTagMeta,
          TClusterMeta
        >,
      );
    }
    this.scheduleFrame();
  }

  setBackgroundColor(color: string | undefined): void {
    this.adapter.setBackgroundColor(color);
    this.scheduleFrame();
  }

  setShapeOptions(shapeOptions?: CanvasShapeOptions): void {
    this.shapeOptions = shapeOptions;
    this.adapter.setShapeOptions(shapeOptions);
    if (!this.customResolver) {
      this.engine.setVisualResolver(
        this.buildDefaultVisualResolver() as unknown as VisualResolver<
          TItem,
          TContentVisual,
          TClusterVisual,
          TTagMeta,
          TClusterMeta
        >,
      );
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
    this.scheduleFrame();
  }

  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.engine.setMeshStrategy(strategy);
    this.scheduleFrame();
  }

  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    this.engine.setClusteringStrategy(strategy);
    this.scheduleFrame();
  }

  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.engine.setColorStrategy(strategy);
    this.scheduleFrame();
  }

  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    this.engine.setLayoutStrategy(strategy);
    this.scheduleFrame();
  }

  setZoomStrategy(
    strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>,
  ): void {
    this.engine.setZoomStrategy(strategy);
    this.scheduleFrame();
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

  setShowHulls(show: boolean): void {
    this.engine.setShowHulls(show);
    this.scheduleFrame();
  }

  getEmptyClusterBehavior(): EmptyClusterBehavior {
    return this.engine.getEmptyClusterBehavior();
  }

  setEmptyClusterBehavior(behavior: EmptyClusterBehavior): void {
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
    this.scheduleFrame();
  }

  setHighlightedItems(ids: Iterable<string> | null): void {
    this.engine.setHighlightedItems(ids);
    this.scheduleFrame();
  }

  getHighlightedItems(): ReadonlySet<string> {
    return this.engine.getHighlightedItems();
  }

  setSelectedIds(ids: Iterable<string> | null): void {
    this.engine.setSelectedIds(ids);
    this.scheduleFrame();
  }

  toggleSelectedId(id: string): boolean {
    const res = this.engine.toggleSelectedId(id);
    this.scheduleFrame();
    return res;
  }

  clearSelection(): void {
    this.engine.clearSelection();
    this.scheduleFrame();
  }

  getSelectedIds(): ReadonlySet<string> {
    return this.engine.getSelectedIds();
  }

  selectItemsInScreenRect(
    rect: CanvasMarqueeRect,
    options?: SelectInRectOptions,
  ): ReadonlySet<string> {
    const res = this.engine.selectItemsInScreenRect(
      rect.x,
      rect.y,
      rect.x + rect.width,
      rect.y + rect.height,
      options,
    );
    this.scheduleFrame();
    return res;
  }

  setFocusedClusterUid(clusterUid: string | null): void {
    this.focusedClusterUidState = clusterUid;
    this.engine.setFocusedClusterUid(clusterUid);
    this.scheduleFrame();
  }

  setFocusedTriangleIndex(triangleIndex: number | null): void {
    this.focusedTriangleIndexState = triangleIndex;
    this.engine.setFocusedTriangleIndex(triangleIndex);
    this.scheduleFrame();
  }

  focusItem(itemId: string | null, options?: FocusItemOptions): boolean {
    const ok = this.engine.focusItem(itemId, options);
    this.scheduleFrame();
    return ok;
  }

  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean {
    const ok = this.engine.zoomToItem(itemId, options);
    if (ok) this.scheduleFrame();
    return ok;
  }

  getViewState(): SimplexViewState {
    const base = this.engine.getViewState();
    const timelineStep = this.timelineController?.getState().step;
    return timelineStep !== undefined ? { ...base, timelineStep } : base;
  }

  restoreViewState(
    state: SimplexViewState,
    options?: RestoreViewStateOptions,
  ): void {
    if (this.timelineController && typeof state.timelineStep === 'number') {
      this.timelineController.seek(state.timelineStep);
    }
    this.engine.restoreViewState(state, options);
    this.scheduleFrame();
  }

  setReducedMotion(pref: ReducedMotionPreference): void {
    this.bindReducedMotionMediaQuery(pref);
    this.engine.setReducedMotion(this.resolveReducedMotionValue(pref));
    this.scheduleFrame();
  }

  getTimeline(): SimplexTimelineController<TItem> | null {
    return this.timelineController;
  }

  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void {
    this.timelineListeners.add(listener as SimplexTimelineListener<TItem>);
    listener(this.timelineController?.getState() ?? null);
    return () => {
      this.timelineListeners.delete(listener as SimplexTimelineListener<TItem>);
    };
  }

  batch(fn: () => void): void {
    this.engine.batch(fn);
    this.scheduleFrame();
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
    this.batch(() => {
      if (options.theme !== undefined) this.setTheme(options.theme);
      if (options.backgroundColor !== undefined) {
        this.setBackgroundColor(options.backgroundColor);
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
      if (options.visualResolver !== undefined) {
        this.setVisualResolver(options.visualResolver);
      } else if (options.preset !== undefined) {
        this.setPreset(options.preset, options.getLabel);
      }
      if (options.shapeOptions !== undefined) this.setShapeOptions(options.shapeOptions);
      if (options.meshOptions !== undefined) this.setMeshOptions(options.meshOptions);
      if (options.layoutOptions !== undefined) this.setLayoutOptions(options.layoutOptions);
      if (options.meshStrategy !== undefined) this.setMeshStrategy(options.meshStrategy);
      if (options.clusteringStrategy !== undefined) {
        this.setClusteringStrategy(options.clusteringStrategy);
      }
      if (options.colorStrategy !== undefined) this.setColorStrategy(options.colorStrategy);
      if (options.layoutStrategy !== undefined) this.setLayoutStrategy(options.layoutStrategy);
      if (options.zoomStrategy !== undefined) this.setZoomStrategy(options.zoomStrategy);
      if (options.showHulls !== undefined) this.setShowHulls(options.showHulls);
      if (options.emptyClusterBehavior !== undefined) {
        this.setEmptyClusterBehavior(options.emptyClusterBehavior);
      }
      if (options.itemFilter !== undefined) {
        this.setItemFilter(options.itemFilter, { mode: options.itemFilterMode });
      }
      if (options.highlightedIds !== undefined) {
        this.setHighlightedItems(options.highlightedIds);
      }
      if (options.selectedIds !== undefined) {
        this.setSelectedIds(options.selectedIds);
      }
      if (options.tooltip !== undefined) {
        this.tooltipOption = options.tooltip;
        if (!options.tooltip) this.hideTooltip();
      }
      if (options.interactions !== undefined) {
        this.interactions = options.interactions;
        this.engine.setInteractions(this.buildWrappedInteractions());
      }
      if (options.items !== undefined) {
        this.setItems(options.items);
      }
    });
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
    this.engine.relayout();
    this.scheduleFrame();
  }

  /**
   * Advances simulation & timeline deterministically by `dtMs` milliseconds (useful in tests & headless captures).
   */
  stepForTest(dtMs = 16.67): boolean {
    if (this.timelineController?.getState().playing) {
      this.timelineController.tick(dtMs);
    }
    return this.engine.step(dtMs);
  }

  exportPng(options: CanvasExportPngOptions & { readonly format: 'dataUrl' }): Promise<string>;
  exportPng(options?: CanvasExportPngOptions & { readonly format?: 'blob' }): Promise<Blob>;
  exportPng(options?: CanvasExportPngOptions): Promise<Blob | string> {
    return this.adapter.exportPng(options);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.timelineUnsubscribe?.();
    this.timelineUnsubscribe = null;
    this.timelineController?.pause();
    this.timelineListeners.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.reducedMotionMql && this.reducedMotionListener) {
      this.reducedMotionMql.removeEventListener?.('change', this.reducedMotionListener);
    }
    this.cleanupDomListeners?.();
    this.cleanupDomListeners = null;
    this.engine.destroy();
    this.rootEl.remove();
  }
}

/**
 * Ergonomic factory for mounting a high-capacity Canvas 2D SimplexViz graph.
 *
 * Accepts either a bare `items` array for zero-config mounting or a full options object.
 */
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
    return new SimplexCanvasController<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >(container, { items: itemsOrOptions });
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
