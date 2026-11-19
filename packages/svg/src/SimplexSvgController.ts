import {
  SimplexGraphEngine,
  isPointInTriangle,
  type CameraController,
  type ClusterDerivationContext,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ClusterMetaConfig,
  type ContentHoverEvent,
  type DefaultTaggedItem,
  type InteractionHandlers,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexLayoutStrategy,
  type SimplexMeshStrategy,
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
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexMeshStrategy<TItem>;
  readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  readonly layoutStrategy?: SimplexLayoutStrategy;
  readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  readonly showHulls?: boolean;
  /** Renders the built-in breadcrumb bar when drilled into sub-levels. Default: `true`. */
  readonly showZoomBreadcrumbs?: boolean;
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
  private tooltipOption:
    | boolean
    | SimplexTooltipFormatter<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;
  private tooltipEl: HTMLDivElement | null = null;
  private breadcrumbOverlayEl: HTMLDivElement | null = null;
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
      createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
        this.currentPreset,
        this.getLabelExtractor,
        this.currentTheme,
      )) as VisualResolver<
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

    this.engine = SimplexGraphEngine.createFromResolved({
      items: options.items,
      getId: options.getId,
      getTags: options.getTags,
      deriveClusterMeta: options.deriveClusterMeta,
      visualResolver,
      renderer: this.adapter,
      viewportWidth: initialW,
      viewportHeight: initialH,
      normalizeTag: options.normalizeTag,
      resolveTagMeta: options.resolveTagMeta,
      meshOptions: options.meshOptions,
      layoutOptions: options.layoutOptions,
      meshStrategy: options.meshStrategy,
      clusteringStrategy: options.clusteringStrategy,
      colorStrategy: options.colorStrategy,
      layoutStrategy: options.layoutStrategy,
      zoomStrategy: options.zoomStrategy,
      theme: this.currentTheme,
      showHulls: options.showHulls,
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
    const tagList = ev.layoutContext.tags.map((t) => `#${t.tag}`).slice(0, 5).join(' · ');
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
    this.engine.addItems(items);
    this.ensureLoopRunning();
  }

  removeItems(ids: string | readonly string[]): void {
    this.engine.removeItems(ids);
    this.ensureLoopRunning();
  }

  setItems(items: readonly TItem[]): void {
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
    const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
      preset,
      this.getLabelExtractor,
      this.currentTheme,
    );
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
        this.getLabelExtractor,
        theme,
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
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.engine.setMeshStrategy(strategy);
    this.ensureLoopRunning();
  }

  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    this.engine.setClusteringStrategy(strategy);
    this.ensureLoopRunning();
  }

  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.engine.setColorStrategy(strategy);
    this.ensureLoopRunning();
  }

  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    this.engine.setLayoutStrategy(strategy);
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

  /** Deterministically advances simulation time in tests without waiting for rAF. */
  stepForTest(dtMs: number): boolean {
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

      const settled = this.engine.step(dtMs);
      if (!settled) {
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
