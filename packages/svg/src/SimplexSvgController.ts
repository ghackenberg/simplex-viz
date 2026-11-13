import {
  SimplexGraphEngine,
  type CameraController,
  type ClusterDerivationContext,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ClusterMetaConfig,
  type ContentHoverEvent,
  type DefaultTaggedItem,
  type InteractionHandlers,
  type ItemIdentityConfig,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type VisualResolver,
} from '@simplex-viz/core';
import { SVG_NS } from './hullMeasure';
import {
  createPresetViews,
  createPresetVisualResolver,
  extractDefaultItemLabel,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type SimplexVisualPreset,
} from './presets';
import { SvgRendererAdapter, type SvgRendererOptions } from './SvgRendererAdapter';
import type { SvgNodeView } from './types';

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
  /** Optional custom visual resolver (defaults to the active `preset` resolver). */
  readonly visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  /** Optional custom content `SvgNodeView` (defaults to the active `preset` view). */
  readonly contentView?: SvgRendererOptions<TContentVisual, TClusterVisual>['contentView'];
  /** Optional custom cluster `SvgNodeView` (defaults to the active `preset` view). */
  readonly clusterView?: SvgRendererOptions<TContentVisual, TClusterVisual>['clusterView'];
  readonly normalizeTag?: (rawTag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly showHulls?: boolean;
  /**
   * Automatically toggles cluster focus when clicking a topic cluster (and clears on background click)
   * unless a custom `interactions.onLeftClick` handler is provided. Default: `true`.
   */
  readonly focusOnClusterClick?: boolean;
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
  readonly onFpsUpdate?: (fps: number) => void;
}

export type SimplexSvgControllerOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = ItemIdentityConfig<TItem> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> &
  Omit<
    SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'getId' | 'getTags' | 'deriveClusterMeta'
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
  private readonly adapter: SvgRendererAdapter<TContentVisual, TClusterVisual>;
  private readonly engine: SimplexGraphEngine<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onFpsUpdate?: (fps: number) => void;
  private readonly focusOnClusterClick: boolean;
  private readonly getIdExtractor: (item: TItem) => string;
  private getLabelExtractor?: (item: TItem) => string;
  private tooltipOption:
    | boolean
    | SimplexTooltipFormatter<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;
  private tooltipEl: HTMLDivElement | null = null;
  private focusedClusterUidState: string | null = null;

  private rafId: number | null = null;
  private lastFrameTs = 0;
  private fpsSamples = 0;
  private fpsAccumMs = 0;
  private destroyed = false;

  // Centralized drag-to-pan state on root <svg>
  private isDraggingPan = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;

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
    this.focusOnClusterClick = options.focusOnClusterClick ?? true;
    this.getLabelExtractor = options.getLabel;
    this.tooltipOption = options.tooltip ?? false;
    this.getIdExtractor =
      options.getId ??
      ((item: TItem) =>
        typeof item === 'object' && item !== null && 'id' in item
          ? String((item as { readonly id: unknown }).id)
          : '');

    const activePreset: SimplexVisualPreset = options.preset ?? 'geometric';
    const presetViews = createPresetViews(activePreset);
    const contentView = (options.contentView ??
      presetViews.contentView) as SvgNodeView<TContentVisual>;
    const clusterView = (options.clusterView ??
      presetViews.clusterView) as SvgNodeView<TClusterVisual>;
    const visualResolver = (options.visualResolver ??
      createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
        activePreset,
        this.getLabelExtractor,
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

    this.adapter = new SvgRendererAdapter(this.svgEl, {
      contentView,
      clusterView,
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
      showHulls: options.showHulls,
      interactions: this.wrapInteractions(options.interactions),
      onMetricsChange: options.onMetricsChange,
      onClustersChange: options.onClustersChange,
    });

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
        userInteractions?.onContentHover?.(ev);
        if (ev) {
          this.showTooltip(
            ev.screenPosition.x,
            ev.screenPosition.y,
            this.formatContentTooltip(ev),
          );
        } else {
          this.hideTooltip();
        }
      },
      onClusterHover: (ev) => {
        userInteractions?.onClusterHover?.(ev);
        if (ev) {
          this.showTooltip(
            ev.screenPosition.x,
            ev.screenPosition.y,
            this.formatClusterTooltip(ev),
          );
        } else {
          this.hideTooltip();
        }
      },
      onLeftClick: (target, rawEvent) => {
        if (userInteractions?.onLeftClick) {
          userInteractions.onLeftClick(target, rawEvent);
          return;
        }
        if (!this.focusOnClusterClick) return;
        if (target.kind === 'cluster') {
          const next =
            this.focusedClusterUidState === target.cluster.clusterUid
              ? null
              : target.cluster.clusterUid;
          this.setFocusedClusterUid(next);
        } else if (target.kind === 'background' && this.focusedClusterUidState !== null) {
          this.setFocusedClusterUid(null);
        }
      },
      onRightClick: userInteractions?.onRightClick,
      onWheel: userInteractions?.onWheel ?? 'zoom-to-cursor',
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
    return tagList ? `${label}\n${tagList}` : label;
  }

  private formatClusterTooltip(
    ev: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
  ): string {
    if (typeof this.tooltipOption === 'function') {
      return this.tooltipOption({ kind: 'cluster', ...ev });
    }
    const count = ev.cluster.members.length;
    return `${ev.cluster.code} · ${ev.cluster.defaultLabel}\n${count} ${count === 1 ? 'item' : 'items'}`;
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
    el.style.background = 'rgba(9, 13, 22, 0.94)';
    el.style.border = '1px solid rgba(51, 65, 85, 0.85)';
    el.style.color = '#f1f5f9';
    el.style.fontFamily = 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
    el.style.fontSize = '12px';
    el.style.lineHeight = '1.4';
    el.style.whiteSpace = 'pre-line';
    el.style.boxShadow = '0 10px 24px rgba(0, 0, 0, 0.45)';
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
    return this.engine.camera;
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
    if (getLabel !== undefined) {
      this.getLabelExtractor = getLabel;
    }
    const views = createPresetViews(preset);
    const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
      preset,
      this.getLabelExtractor,
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
    views: Partial<SvgRendererOptions<TContentVisual, TClusterVisual>>,
  ): void {
    this.adapter.setViews(views);
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

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    const hit = this.engine.hitTest(x, y);
    if (hit.kind === 'background') {
      this.isDraggingPan = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragMoved = false;
      this.svgEl.style.cursor = 'grabbing';
    } else {
      this.isDraggingPan = false;
      this.dragMoved = false;
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    if (this.isDraggingPan) {
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (Math.hypot(dx, dy) > 3) {
        this.dragMoved = true;
      }
      if (this.dragMoved) {
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.engine.camera.panBy(dx, dy);
        this.hideTooltip();
        this.ensureLoopRunning();
      }
      return;
    }
    this.engine.handlePointerMove(x, y);
    const hit = this.engine.hitTest(x, y);
    this.svgEl.style.cursor = hit.kind === 'background' ? 'grab' : 'pointer';
    this.ensureLoopRunning();
  };

  private readonly onPointerUp = (): void => {
    if (this.isDraggingPan) {
      this.isDraggingPan = false;
      this.svgEl.style.cursor = 'grab';
    }
  };

  private readonly onPointerLeave = (): void => {
    this.isDraggingPan = false;
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
    this.svgEl.addEventListener('pointerleave', this.onPointerLeave);
    this.svgEl.addEventListener('click', this.onClick);
    this.svgEl.addEventListener('contextmenu', this.onContextMenu);
    this.svgEl.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private detachSvgListeners(): void {
    this.svgEl.removeEventListener('pointerdown', this.onPointerDown);
    this.svgEl.removeEventListener('pointermove', this.onPointerMove);
    this.svgEl.removeEventListener('pointerup', this.onPointerUp);
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
    this.detachSvgListeners();
    this.engine.destroy();
    if (this.tooltipEl && this.tooltipEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.tooltipEl);
      this.tooltipEl = null;
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
