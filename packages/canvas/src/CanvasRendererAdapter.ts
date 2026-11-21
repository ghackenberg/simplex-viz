import {
  SIMPLEX_PRESET_DEFAULTS,
  getHullBoundingBox,
  resolveSimplexThemeBackgroundColor,
  type ConvexGeometry,
  type DefaultTaggedItem,
  type NodeRenderState,
  type Point2D,
  type SceneFrameSnapshot,
  type SimplexKeyboardFocusTarget,
  type SimplexLayoutSnapshot,
  type SimplexRendererAdapter,
} from '@simplex-viz/core';
import {
  createCanvasPresetVisualResolver,
  drawDefaultCanvasEdge,
  drawDefaultCanvasTriangle,
  drawDefaultClusterNode,
  drawFastContentNode,
  measureDefaultClusterHull,
  measureGeometricContentHull,
} from './presets.js';
import type {
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
} from './types.js';

export interface CanvasRendererAdapterOptions<
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Target `<canvas>` element. */
  readonly canvas: HTMLCanvasElement;
  /** Initial visual theme (`'dark'` | `'light'`). Default: `'dark'`. */
  readonly theme?: CanvasTheme;
  /** Optional explicit background fill color (`'transparent'` skips background fill). */
  readonly backgroundColor?: string;
  /** Maximum devicePixelRatio cap to preserve 60 fps on high-DPI displays. Default: `2`. */
  readonly maxDevicePixelRatio?: number;
  /** Optional explicit devicePixelRatio override (useful for HiDPI export or offscreen rendering). */
  readonly devicePixelRatio?: number;
  /**
   * Screen-space node radius threshold (in CSS pixels) below which geometric shapes
   * automatically simplify to fast circles/dots without per-node stroke passes.
   * Set `0` to disable LOD simplification. Default: `3.5`.
   */
  readonly lodThresholdPx?: number;
  /** Margin (world px) around viewport bounds for frustum culling. Default: `48`. */
  readonly cullMarginPx?: number;
  /** Custom Canvas 2D content node renderer (overrides built-in fast path). */
  readonly contentRenderer?: CanvasNodeRenderer<TContentVisual>;
  /** Custom Canvas 2D cluster node renderer (overrides built-in anchor/badge renderers). */
  readonly clusterRenderer?: CanvasNodeRenderer<TClusterVisual>;
  /** Custom Canvas 2D triangle face renderer. */
  readonly triangleRenderer?: CanvasTriangleRenderer<TItem, TTagMeta, TClusterMeta>;
  /** Custom Canvas 2D mesh edge renderer. */
  readonly edgeRenderer?: CanvasEdgeRenderer<TItem, TTagMeta, TClusterMeta>;
  /** Shape hover/dimming/stroke options for built-in geometric presets. */
  readonly shapeOptions?: CanvasShapeOptions;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function resolveDpr(maxDpr: number): number {
  const raw =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  return Math.max(1, Math.min(maxDpr, raw || 1));
}

function hullRadiusEstimate(hull: ConvexGeometry): number {
  if (hull.kind === 'circle') return hull.radius;
  const bb = getHullBoundingBox(hull, 0, 0, 1);
  return Math.max(Math.abs(bb.minX), Math.abs(bb.maxX), Math.abs(bb.minY), Math.abs(bb.maxY));
}

function drawConvexHullOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  hull: ConvexGeometry,
  color: string,
  lineWidth: number,
): void {
  ctx.beginPath();
  if (hull.kind === 'circle') {
    ctx.arc(x, y, hull.radius * scale, 0, Math.PI * 2);
  } else if (hull.vertices.length > 0) {
    const first = hull.vertices[0]!;
    ctx.moveTo(x + first.x * scale, y + first.y * scale);
    for (let i = 1; i < hull.vertices.length; i++) {
      const v = hull.vertices[i]!;
      ctx.lineTo(x + v.x * scale, y + v.y * scale);
    }
    ctx.closePath();
  }
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * High-capacity HTML5 Canvas 2D `SimplexRendererAdapter` for `@simplex-viz/core`.
 *
 * Designed for 2,000–10,000+ items at 60 FPS with:
 * - Zero DOM node creation per item/cluster/triangle/edge
 * - HiDPI `devicePixelRatio` scaling with configurable cap
 * - World-space viewport frustum culling
 * - Automatic Level-of-Detail (LOD) shape simplification at dense zoom levels
 * - Built-in dual-layer crossfades, multi-selection rings, marquee overlay, and WCAG focus rings
 */
export class CanvasRendererAdapter<
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements
    SimplexRendererAdapter<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >
{
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private theme: CanvasTheme;
  private backgroundColor: string | undefined;
  private maxDevicePixelRatio: number;
  private fixedDevicePixelRatio: number | undefined;
  private lodThresholdPx: number;
  private cullMarginPx: number;
  private contentRenderer?: CanvasNodeRenderer<TContentVisual>;
  private clusterRenderer?: CanvasNodeRenderer<TClusterVisual>;
  private triangleRenderer?: CanvasTriangleRenderer<TItem, TTagMeta, TClusterMeta>;
  private edgeRenderer?: CanvasEdgeRenderer<TItem, TTagMeta, TClusterMeta>;
  private shapeOptions?: CanvasShapeOptions;

  private readonly contentHullCache = new Map<string, ConvexGeometry>();
  private readonly clusterHullCache = new Map<string, ConvexGeometry>();

  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private marqueeRect: CanvasMarqueeRect | null = null;
  private keyboardFocusTarget: SimplexKeyboardFocusTarget | null = null;
  private lastSnapshot: SceneFrameSnapshot<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  > | null = null;

  private stats: CanvasRenderStats = {
    lastFrameMs: 0,
    totalItems: 0,
    drawnItems: 0,
    culledItems: 0,
    lodSimplifiedItems: 0,
    drawnClusters: 0,
    drawnTriangles: 0,
    drawnEdges: 0,
    devicePixelRatio: 1,
  };

  constructor(
    options: CanvasRendererAdapterOptions<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.canvas = options.canvas;
    this.ctx =
      typeof this.canvas.getContext === 'function'
        ? this.canvas.getContext('2d')
        : null;
    this.theme = options.theme ?? 'dark';
    this.backgroundColor = options.backgroundColor;
    this.maxDevicePixelRatio = Math.max(1, options.maxDevicePixelRatio ?? 2);
    this.fixedDevicePixelRatio =
      options.devicePixelRatio !== undefined
        ? Math.max(1, options.devicePixelRatio)
        : undefined;
    this.lodThresholdPx = Math.max(0, options.lodThresholdPx ?? 3.5);
    this.cullMarginPx = Math.max(0, options.cullMarginPx ?? 48);
    this.contentRenderer = options.contentRenderer;
    this.clusterRenderer = options.clusterRenderer;
    this.triangleRenderer = options.triangleRenderer;
    this.edgeRenderer = options.edgeRenderer;
    this.shapeOptions = options.shapeOptions;
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  getRenderStats(): CanvasRenderStats {
    return this.stats;
  }

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
  }

  setBackgroundColor(backgroundColor: string | undefined): void {
    this.backgroundColor = backgroundColor;
  }

  setShapeOptions(shapeOptions?: CanvasShapeOptions): void {
    this.shapeOptions = shapeOptions;
    this.contentHullCache.clear();
  }

  setRenderers(renderers: {
    readonly contentRenderer?: CanvasNodeRenderer<TContentVisual>;
    readonly clusterRenderer?: CanvasNodeRenderer<TClusterVisual>;
    readonly triangleRenderer?: CanvasTriangleRenderer<TItem, TTagMeta, TClusterMeta>;
    readonly edgeRenderer?: CanvasEdgeRenderer<TItem, TTagMeta, TClusterMeta>;
  }): void {
    if ('contentRenderer' in renderers) {
      this.contentRenderer = renderers.contentRenderer;
      this.contentHullCache.clear();
    }
    if ('clusterRenderer' in renderers) {
      this.clusterRenderer = renderers.clusterRenderer;
      this.clusterHullCache.clear();
    }
    if ('triangleRenderer' in renderers) {
      this.triangleRenderer = renderers.triangleRenderer;
    }
    if ('edgeRenderer' in renderers) {
      this.edgeRenderer = renderers.edgeRenderer;
    }
  }

  setMarqueeRect(rect: CanvasMarqueeRect | null): void {
    this.marqueeRect = rect;
    if (this.lastSnapshot) {
      this.renderFrame(this.lastSnapshot);
    }
  }

  setKeyboardFocusTarget(target: SimplexKeyboardFocusTarget | null): void {
    this.keyboardFocusTarget = target;
    if (this.lastSnapshot) {
      this.renderFrame(this.lastSnapshot);
    }
  }

  invalidateHullCaches(): void {
    this.contentHullCache.clear();
    this.clusterHullCache.clear();
  }

  /** Re-paints the most recent scene frame snapshot without re-running layout (useful after async image decodes). */
  redraw(): void {
    if (this.lastSnapshot) {
      this.renderFrame(this.lastSnapshot);
    }
  }

  resize(width: number, height: number, dprOverride?: number): void {
    const safeW = Math.max(1, Math.round(width));
    const safeH = Math.max(1, Math.round(height));
    if (dprOverride !== undefined) {
      this.fixedDevicePixelRatio = Math.max(1, dprOverride);
    }
    const nextDpr =
      this.fixedDevicePixelRatio ?? resolveDpr(this.maxDevicePixelRatio);
    if (safeW === this.cssWidth && safeH === this.cssHeight && nextDpr === this.dpr) {
      return;
    }
    this.cssWidth = safeW;
    this.cssHeight = safeH;
    this.dpr = nextDpr;

    const pixelW = Math.max(1, Math.round(safeW * nextDpr));
    const pixelH = Math.max(1, Math.round(safeH * nextDpr));
    if (this.canvas.width !== pixelW) this.canvas.width = pixelW;
    if (this.canvas.height !== pixelH) this.canvas.height = pixelH;
    if (this.canvas.style) {
      this.canvas.style.width = `${safeW}px`;
      this.canvas.style.height = `${safeH}px`;
    }
  }

  measureContentHull(visual: TContentVisual, cacheKey: string): ConvexGeometry {
    const cached = this.contentHullCache.get(cacheKey);
    if (cached) return cached;

    let hull: ConvexGeometry;
    if (this.contentRenderer) {
      hull = this.contentRenderer.measureConvexHull(visual, this.ctx);
    } else {
      const def = visual as unknown as CanvasDefaultContentVisual;
      if (def && typeof def === 'object' && def.kind === 'geometric') {
        hull = measureGeometricContentHull(
          def,
          this.shapeOptions?.strokeWidth ?? SIMPLEX_PRESET_DEFAULTS.canvasStrokeWidth,
        );
      } else if (def && typeof def === 'object' && def.kind === 'glyph') {
        hull = { kind: 'circle', radius: Math.max(2, def.radius) };
      } else {
        hull = { kind: 'circle', radius: SIMPLEX_PRESET_DEFAULTS.canvasGlyphRadius };
      }
    }

    this.contentHullCache.set(cacheKey, hull);
    return hull;
  }

  measureClusterHull(visual: TClusterVisual, cacheKey: string): ConvexGeometry {
    const cached = this.clusterHullCache.get(cacheKey);
    if (cached) return cached;

    let hull: ConvexGeometry;
    if (this.clusterRenderer) {
      hull = this.clusterRenderer.measureConvexHull(visual, this.ctx);
    } else {
      const def = visual as unknown as CanvasDefaultClusterVisual;
      if (def && typeof def === 'object' && (def.kind === 'anchor' || def.kind === 'badge')) {
        hull = measureDefaultClusterHull(def, this.ctx);
      } else {
        hull = { kind: 'circle', radius: 22 };
      }
    }

    this.clusterHullCache.set(cacheKey, hull);
    return hull;
  }

  renderFrame(
    snapshot: SceneFrameSnapshot<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    const started = nowMs();
    this.lastSnapshot = snapshot;
    this.resize(snapshot.viewportWidth, snapshot.viewportHeight);

    const ctx = this.ctx;
    if (!ctx) {
      this.stats = {
        lastFrameMs: Math.max(0, nowMs() - started),
        totalItems: snapshot.items.length,
        drawnItems: 0,
        culledItems: 0,
        lodSimplifiedItems: 0,
        drawnClusters: 0,
        drawnTriangles: 0,
        drawnEdges: 0,
        devicePixelRatio: this.dpr,
      };
      return;
    }

    const { viewportWidth, viewportHeight, camera } = snapshot;
    const zoom = Math.max(0.05, camera.zoom);
    const invZoom = 1 / zoom;

    // Visible world-space frustum bounds with margin for fast culling
    const marginWorld = this.cullMarginPx * invZoom;
    const worldMinX = (0 - camera.panX) * invZoom - marginWorld;
    const worldMaxX = (viewportWidth - camera.panX) * invZoom + marginWorld;
    const worldMinY = (0 - camera.panY) * invZoom - marginWorld;
    const worldMaxY = (viewportHeight - camera.panY) * invZoom + marginWorld;

    // Reset transform to device pixels & clear / paint background
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    const bg =
      this.backgroundColor ?? resolveSimplexThemeBackgroundColor(this.theme, 'canvas');
    if (bg === 'transparent') {
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, viewportWidth, viewportHeight);
    }

    // Apply camera transform (world -> screen CSS pixels -> DPR pixels)
    ctx.save();
    ctx.translate(camera.panX, camera.panY);
    ctx.scale(zoom, zoom);

    // 1. Triangles
    let drawnTriangles = 0;
    for (let i = 0; i < snapshot.triangles.length; i++) {
      const tri = snapshot.triangles[i]!;
      const [p0, p1, p2] = tri.points;
      const minX = Math.min(p0.x, p1.x, p2.x);
      const maxX = Math.max(p0.x, p1.x, p2.x);
      const minY = Math.min(p0.y, p1.y, p2.y);
      const maxY = Math.max(p0.y, p1.y, p2.y);
      if (maxX < worldMinX || minX > worldMaxX || maxY < worldMinY || minY > worldMaxY) {
        continue;
      }
      drawnTriangles += 1;
      if (this.triangleRenderer) {
        this.triangleRenderer.draw(ctx, tri, this.theme, zoom);
      } else {
        drawDefaultCanvasTriangle(ctx, tri, this.theme, zoom);
      }
    }

    // 2. Mesh edges
    let drawnEdges = 0;
    for (let i = 0; i < snapshot.edges.length; i++) {
      const edge = snapshot.edges[i]!;
      const minX = Math.min(edge.a.x, edge.b.x);
      const maxX = Math.max(edge.a.x, edge.b.x);
      const minY = Math.min(edge.a.y, edge.b.y);
      const maxY = Math.max(edge.a.y, edge.b.y);
      if (maxX < worldMinX || minX > worldMaxX || maxY < worldMinY || minY > worldMaxY) {
        continue;
      }
      drawnEdges += 1;
      if (this.edgeRenderer) {
        this.edgeRenderer.draw(ctx, edge, this.theme, zoom);
      } else {
        drawDefaultCanvasEdge(ctx, edge, this.theme, zoom);
      }
    }

    // 3. Content items (high-capacity hot path with frustum culling + LOD)
    let drawnItems = 0;
    let culledItems = 0;
    let lodSimplifiedItems = 0;
    const dimmedOpacity =
      this.contentRenderer?.dimmedOpacity ??
      this.shapeOptions?.dimmedOpacity ??
      SIMPLEX_PRESET_DEFAULTS.canvasDimmedOpacity;
    const customHoverScale =
      this.contentRenderer?.hoverScale ??
      this.shapeOptions?.hoverScale ??
      SIMPLEX_PRESET_DEFAULTS.canvasHoverScale;

    // Draw non-hovered items first, then hovered/highlighted items on top for crisp overlap
    const emphasizedIndices: number[] = [];

    const renderContentIndex = (idx: number): void => {
      const node = snapshot.items[idx]!;
      if (node.opacity <= 0.005) {
        culledItems += 1;
        return;
      }

      const estR = hullRadiusEstimate(node.hull) * node.scale;
      if (
        node.x + estR < worldMinX ||
        node.x - estR > worldMaxX ||
        node.y + estR < worldMinY ||
        node.y - estR > worldMaxY
      ) {
        culledItems += 1;
        return;
      }

      const effectiveAlpha =
        node.opacity *
        (node.interaction.isDimmed && !node.interaction.isHovered ? dimmedOpacity : 1);
      if (effectiveAlpha <= 0.005) {
        culledItems += 1;
        return;
      }

      const screenRadiusPx = estR * zoom;
      const simplifiedLod = this.lodThresholdPx > 0 && screenRadiusPx <= this.lodThresholdPx;
      if (simplifiedLod) lodSimplifiedItems += 1;
      drawnItems += 1;

      if (this.contentRenderer) {
        const hoverScale = node.interaction.isHovered ? customHoverScale : 1;
        const drawCustom = (vis: TContentVisual, a: number): void => {
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(node.x, node.y);
          ctx.scale(node.scale * hoverScale, node.scale * hoverScale);
          this.contentRenderer!.draw(ctx, vis, node, {
            theme: this.theme,
            cameraZoom: zoom,
            effectiveScale: node.scale * zoom,
            simplifiedLod,
          });
          ctx.restore();
        };

        if (node.transition) {
          const p = Math.max(0, Math.min(1, node.transition.progress));
          if (p < 0.99) drawCustom(node.transition.from, effectiveAlpha * (1 - p));
          if (p > 0.01) drawCustom(node.transition.to, effectiveAlpha * p);
        } else {
          drawCustom(node.visual, effectiveAlpha);
        }
      } else {
        const defState = node as unknown as NodeRenderState<CanvasDefaultContentVisual>;
        if (defState.transition) {
          const p = Math.max(0, Math.min(1, defState.transition.progress));
          if (p < 0.99) {
            drawFastContentNode(
              ctx,
              defState.transition.from,
              defState,
              effectiveAlpha * (1 - p),
              zoom,
              simplifiedLod,
              this.shapeOptions,
            );
          }
          if (p > 0.01) {
            drawFastContentNode(
              ctx,
              defState.transition.to,
              defState,
              effectiveAlpha * p,
              zoom,
              simplifiedLod,
              this.shapeOptions,
            );
          }
        } else {
          drawFastContentNode(
            ctx,
            defState.visual,
            defState,
            effectiveAlpha,
            zoom,
            simplifiedLod,
            this.shapeOptions,
          );
        }
      }

      if (snapshot.showHulls) {
        ctx.globalAlpha = 0.55;
        drawConvexHullOutline(
          ctx,
          node.x,
          node.y,
          node.scale,
          node.hull,
          this.theme === 'dark' ? '#38bdf8' : '#0284c7',
          1 * invZoom,
        );
      }
    };

    for (let i = 0; i < snapshot.items.length; i++) {
      const inter = snapshot.items[i]!.interaction;
      if (inter.isHovered || inter.isHighlighted || inter.isSelected) {
        emphasizedIndices.push(i);
      } else {
        renderContentIndex(i);
      }
    }
    for (let i = 0; i < emphasizedIndices.length; i++) {
      renderContentIndex(emphasizedIndices[i]!);
    }
    ctx.globalAlpha = 1;

    // 4. Topic Clusters (drawn above content so badges remain legible)
    let drawnClusters = 0;
    const clusterDimmedOpacity = this.clusterRenderer?.dimmedOpacity ?? 0.34;
    for (let i = 0; i < snapshot.clusters.length; i++) {
      const node = snapshot.clusters[i]!;
      if (node.opacity <= 0.005) continue;

      const estR = hullRadiusEstimate(node.hull) * node.scale + 16;
      if (
        node.x + estR < worldMinX ||
        node.x - estR > worldMaxX ||
        node.y + estR < worldMinY ||
        node.y - estR > worldMaxY
      ) {
        continue;
      }

      const effectiveAlpha =
        node.opacity *
        (node.interaction.isDimmed && !node.interaction.isHovered
          ? clusterDimmedOpacity
          : 1);
      if (effectiveAlpha <= 0.005) continue;

      drawnClusters += 1;
      if (this.clusterRenderer) {
        const hoverScale = node.interaction.isHovered
          ? (this.clusterRenderer.hoverScale ?? 1.04)
          : 1;
        ctx.save();
        ctx.globalAlpha = effectiveAlpha;
        ctx.translate(node.x, node.y);
        ctx.scale(node.scale * hoverScale, node.scale * hoverScale);
        this.clusterRenderer.draw(ctx, node.visual, node, {
          theme: this.theme,
          cameraZoom: zoom,
          effectiveScale: node.scale * zoom,
          simplifiedLod: false,
        });
        ctx.restore();
      } else {
        const defState = node as unknown as NodeRenderState<CanvasDefaultClusterVisual>;
        drawDefaultClusterNode(ctx, defState.visual, defState, effectiveAlpha, zoom);
      }

      if (snapshot.showHulls) {
        ctx.globalAlpha = 0.65;
        drawConvexHullOutline(
          ctx,
          node.x,
          node.y,
          node.scale,
          node.hull,
          this.theme === 'dark' ? '#f59e0b' : '#d97706',
          1.25 * invZoom,
        );
      }
    }

    // 5. Keyboard WCAG 2.1 AA Double-Halo Focus Ring (world coordinates)
    if (this.keyboardFocusTarget) {
      this.drawKeyboardFocusRing(ctx, this.keyboardFocusTarget, snapshot, invZoom);
    }

    ctx.restore();

    // 6. Screen-space Marquee Selection Overlay (Shift+Drag)
    if (this.marqueeRect && this.marqueeRect.width > 1 && this.marqueeRect.height > 1) {
      const m = this.marqueeRect;
      ctx.save();
      ctx.fillStyle =
        this.theme === 'dark'
          ? 'rgba(192, 132, 252, 0.14)'
          : 'rgba(124, 58, 237, 0.12)';
      ctx.strokeStyle = this.theme === 'dark' ? '#c084fc' : '#7c3aed';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillRect(m.x, m.y, m.width, m.height);
      ctx.strokeRect(m.x, m.y, m.width, m.height);
      ctx.restore();
    }

    this.stats = {
      lastFrameMs: Math.max(0, nowMs() - started),
      totalItems: snapshot.items.length,
      drawnItems,
      culledItems,
      lodSimplifiedItems,
      drawnClusters,
      drawnTriangles,
      drawnEdges,
      devicePixelRatio: this.dpr,
    };
  }

  private drawKeyboardFocusRing(
    ctx: CanvasRenderingContext2D,
    target: SimplexKeyboardFocusTarget,
    snapshot: SceneFrameSnapshot<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
    invZoom: number,
  ): void {
    const outerColor = this.theme === 'dark' ? '#0f172a' : '#ffffff';
    const innerColor = this.theme === 'dark' ? '#38bdf8' : '#0284c7';

    let traceTarget: (() => void) | null = null;

    if (target.kind === 'triangle') {
      const tri = snapshot.triangles.find((t) => t.index === target.index);
      if (tri) {
        const [a, b, c] = tri.points;
        traceTarget = () => {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();
        };
      }
    } else if (target.kind === 'cluster') {
      const node = snapshot.clusters.find((c) => c.id === target.id);
      if (node) {
        const r = Math.max(12, hullRadiusEstimate(node.hull) * node.scale + 5 * invZoom);
        traceTarget = () => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        };
      }
    } else {
      const node = snapshot.items.find((it) => it.id === target.id);
      if (node) {
        const r = Math.max(10, hullRadiusEstimate(node.hull) * node.scale + 5 * invZoom);
        traceTarget = () => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        };
      }
    }

    if (!traceTarget) return;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    traceTarget();
    ctx.lineWidth = 5 * invZoom;
    ctx.strokeStyle = outerColor;
    ctx.stroke();

    traceTarget();
    ctx.lineWidth = 2.4 * invZoom;
    ctx.strokeStyle = innerColor;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Native Canvas PNG export (zero SVG serialization or foreignObject overhead).
   */
  async exportPng(options?: CanvasExportPngOptions): Promise<Blob | string> {
    const format = options?.format ?? 'blob';
    const scale = options?.scale;
    const bgOverride = options?.backgroundColor;

    let targetCanvas: HTMLCanvasElement = this.canvas;
    if (
      (scale !== undefined && scale !== this.dpr) ||
      (bgOverride !== undefined &&
        bgOverride !==
          (this.backgroundColor ?? resolveSimplexThemeBackgroundColor(this.theme, 'canvas')))
    ) {
      if (typeof document !== 'undefined' && this.lastSnapshot) {
        const temp = document.createElement('canvas');
        const tempAdapter = new CanvasRendererAdapter({
          canvas: temp,
          theme: this.theme,
          backgroundColor: bgOverride ?? this.backgroundColor,
          maxDevicePixelRatio: Math.max(1, scale ?? this.dpr),
          lodThresholdPx: this.lodThresholdPx,
          cullMarginPx: this.cullMarginPx,
          contentRenderer: this.contentRenderer,
          clusterRenderer: this.clusterRenderer,
          triangleRenderer: this.triangleRenderer,
          edgeRenderer: this.edgeRenderer,
          shapeOptions: this.shapeOptions,
        });
        tempAdapter.resize(
          this.lastSnapshot.viewportWidth,
          this.lastSnapshot.viewportHeight,
          Math.max(1, scale ?? this.dpr),
        );
        tempAdapter.renderFrame(this.lastSnapshot);
        targetCanvas = temp;
      }
    }

    if (format === 'dataUrl') {
      return typeof targetCanvas.toDataURL === 'function'
        ? targetCanvas.toDataURL('image/png')
        : 'data:image/png;base64,';
    }

    if (typeof targetCanvas.toBlob === 'function') {
      return new Promise<Blob>((resolve, reject) => {
        targetCanvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas PNG export failed: toBlob returned null.'));
        }, 'image/png');
      });
    }

    // Fallback for test environments without toBlob
    const dataUrl =
      typeof targetCanvas.toDataURL === 'function'
        ? targetCanvas.toDataURL('image/png')
        : 'data:image/png;base64,';
    return new Blob([dataUrl], { type: 'image/png' });
  }

  destroy(): void {
    this.contentHullCache.clear();
    this.clusterHullCache.clear();
    this.lastSnapshot = null;
    this.marqueeRect = null;
    this.keyboardFocusTarget = null;
  }
}

export interface RenderSimplexSnapshotToCanvasOptions {
  readonly theme?: CanvasTheme;
  readonly backgroundColor?: string;
  readonly devicePixelRatio?: number;
  readonly lodThresholdPx?: number;
  readonly showHulls?: boolean;
  readonly shapeOptions?: CanvasShapeOptions;
  readonly showClusterBadges?: boolean;
  readonly showClusterCodes?: boolean;
}

/**
 * One-shot stateless renderer painting a pre-solved `SimplexLayoutSnapshot<TItem>`
 * (from `solveSimplexSnapshot()` or `@simplex-viz/core/worker`) directly onto a
 * `<canvas>` element without creating a `SimplexGraphEngine`.
 */
export function renderSimplexSnapshotToCanvas<TItem>(
  canvas: HTMLCanvasElement,
  snapshot: SimplexLayoutSnapshot<TItem>,
  options: RenderSimplexSnapshotToCanvasOptions = {},
): CanvasRenderStats {
  const theme: CanvasTheme = options.theme ?? 'dark';
  const useBadges = options.showClusterBadges ?? true;
  const showCode = options.showClusterCodes ?? true;

  const adapter = new CanvasRendererAdapter<
    CanvasDefaultContentVisual,
    CanvasDefaultClusterVisual,
    TItem
  >({
    canvas,
    theme,
    backgroundColor: options.backgroundColor,
    maxDevicePixelRatio: options.devicePixelRatio ?? 2,
    lodThresholdPx: options.lodThresholdPx ?? 3.5,
    shapeOptions: options.shapeOptions,
  });

  const visualResolver = createCanvasPresetVisualResolver<TItem>(
    useBadges ? 'badges' : 'geometric',
    {
      theme,
      badgeOptions: { showCode },
      shapeOptions: options.shapeOptions,
    },
  );

  const frame: SceneFrameSnapshot<
    CanvasDefaultContentVisual,
    CanvasDefaultClusterVisual,
    TItem
  > = {
    viewportWidth: snapshot.width,
    viewportHeight: snapshot.height,
    camera: { zoom: 1, panX: 0, panY: 0 },
    triangles: snapshot.triangles,
    edges: snapshot.edges,
    clusters: snapshot.clusters.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      scale: c.scale,
      opacity: 1,
      visual: visualResolver.resolveClusterVisual(c.cluster),
      hull: c.hull,
      cacheKey: c.id,
      interaction: {
        isHovered: false,
        isPinned: false,
        isDimmed: false,
        isHighlighted: false,
      },
      transition: null,
    })),
    items: snapshot.items.map((it) => {
      const resolved = visualResolver.resolveContentVisual(it.item, it.layoutContext);
      const radius =
        it.hull.kind === 'circle'
          ? it.hull.radius
          : SIMPLEX_PRESET_DEFAULTS.contentRadius;
      const visual: CanvasDefaultContentVisual =
        resolved.kind === 'geometric'
          ? { ...resolved, radius, label: it.id }
          : { ...resolved, label: it.id };
      return {
        id: it.id,
        x: it.x,
        y: it.y,
        scale: it.scale,
        opacity: 1,
        visual,
        hull: it.hull,
        cacheKey: it.id,
        interaction: {
          isHovered: false,
          isPinned: false,
          isDimmed: false,
          isHighlighted: false,
        },
        transition: null,
      };
    }),
    showHulls: options.showHulls ?? false,
  };

  adapter.resize(
    snapshot.width,
    snapshot.height,
    options.devicePixelRatio ?? resolveDpr(2),
  );
  adapter.renderFrame(frame);
  const stats = adapter.getRenderStats();
  adapter.destroy();
  return stats;
}

export type { Point2D };
