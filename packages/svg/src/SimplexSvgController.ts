import {
  SimplexGraphEngine,
  type CameraController,
  type ClusterDerivationContext,
  type ClusterDescriptor,
  type ClusterMetaConfig,
  type DefaultTaggedItem,
  type InteractionHandlers,
  type ItemIdentityConfig,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type VisualResolver,
} from '@simplex-viz/core';
import { SVG_NS } from './hullMeasure';
import { SvgRendererAdapter, type SvgRendererOptions } from './SvgRendererAdapter';

export interface SimplexSvgControllerResolvedOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items: readonly TItem[];
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly visualResolver: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly contentView: SvgRendererOptions<TContentVisual, TClusterVisual>['contentView'];
  readonly clusterView: SvgRendererOptions<TContentVisual, TClusterVisual>['clusterView'];
  readonly normalizeTag?: (rawTag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly showHulls?: boolean;
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
  TContentVisual = unknown,
  TClusterVisual = unknown,
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

/**
 * High-level framework-agnostic SVG graph controller for Vanilla TypeScript, Vue, Angular,
 * Svelte, Web Components, and `@simplex-viz/react`.
 *
 * Attaches centralized pointer, click, contextmenu, wheel, and drag-pan handlers solely on the
 * root `<svg>` element and delegates hit-testing to `@simplex-viz/core`'s convex geometry solver.
 */
export class SimplexSvgController<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
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
    containerEl: HTMLElement,
    options: SimplexSvgControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
  constructor(
    containerEl: HTMLElement,
    options: SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.containerEl = containerEl;
    this.onFpsUpdate = options.onFpsUpdate;

    const doc = containerEl.ownerDocument;
    this.svgEl = doc.createElementNS(SVG_NS, 'svg');
    this.svgEl.setAttribute('width', '100%');
    this.svgEl.setAttribute('height', '100%');
    this.svgEl.style.display = 'block';
    this.svgEl.style.touchAction = 'none';
    this.svgEl.style.userSelect = 'none';
    containerEl.appendChild(this.svgEl);

    const rect = containerEl.getBoundingClientRect();
    const initialW = rect.width > 40 ? rect.width : 960;
    const initialH = rect.height > 40 ? rect.height : 620;

    this.adapter = new SvgRendererAdapter(this.svgEl, {
      contentView: options.contentView,
      clusterView: options.clusterView,
    });

    this.engine = SimplexGraphEngine.createFromResolved({
      items: options.items,
      getId: options.getId,
      getTags: options.getTags,
      deriveClusterMeta: options.deriveClusterMeta,
      visualResolver: options.visualResolver,
      renderer: this.adapter,
      viewportWidth: initialW,
      viewportHeight: initialH,
      normalizeTag: options.normalizeTag,
      resolveTagMeta: options.resolveTagMeta,
      meshOptions: options.meshOptions,
      layoutOptions: options.layoutOptions,
      showHulls: options.showHulls,
      interactions: options.interactions,
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
      this.resizeObserver.observe(containerEl);
    }

    this.ensureLoopRunning();
  }

  static createFromResolved<
    TItem = DefaultTaggedItem,
    TContentVisual = unknown,
    TClusterVisual = unknown,
    TTagMeta = undefined,
    TClusterMeta = undefined,
  >(
    containerEl: HTMLElement,
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
      el: HTMLElement,
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
    this.engine.setInteractions(interactions);
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
    if (this.svgEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.svgEl);
    }
  }
}
