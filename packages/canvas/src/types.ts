import type {
  ClusterDescriptor,
  ContentLayoutContext,
  ConvexGeometry,
  DefaultTaggedItem,
  MeshEdgeRenderState,
  MeshTriangleRenderState,
  NodeRenderState,
  SimplexColorTheme,
} from '@simplex-viz/core';

/**
 * Built-in visual presets for `@simplex-viz/canvas`, matching `@simplex-viz/svg`
 * semantics while optimized for high-capacity Canvas 2D rendering.
 *
 * - `'geometric'`: OKLab-tinted shapes (`circle` / `diamond` / `star` by simplex rank, or custom `getShape`) + double-ring cluster anchors.
 * - `'glyphs'`: Proportional multi-sector barycentric donuts + cluster anchors.
 * - `'badges'`: OKLab geometric shapes + adaptive rounded-pill cluster badges measured via Canvas `measureText()`.
 */
export type CanvasVisualPreset = 'geometric' | 'glyphs' | 'badges';

export type CanvasTheme = SimplexColorTheme;

export type CanvasNamedShape =
  | 'circle'
  | 'triangle'
  | 'square'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  | 'star';

export interface CanvasNgonShapeSpec {
  readonly sides: number;
  readonly rotationRad?: number;
}

/**
 * Shape specifier accepted by `getShape` on `@simplex-viz/canvas`.
 */
export type CanvasShapeSpec = CanvasNamedShape | number | CanvasNgonShapeSpec;

/**
 * Lightweight hover, dimming, and stroke customization for geometric content shapes.
 */
export interface CanvasShapeOptions {
  /** Multiplier applied when hovered without altering collision hulls. Default: `1.16`. */
  readonly hoverScale?: number;
  /** Optional halo ring stroke color on hover. */
  readonly hoverRingColor?: string;
  /** Opacity multiplier applied to dimmed nodes (`[0, 1]`). Default: `0.28`. */
  readonly dimmedOpacity?: number;
  /** Optional custom stroke color around each shape. */
  readonly strokeColor?: string;
  /** Stroke width in world pixels (`>= 0`). Factored into analytical convex hulls. Default: `1.2`. */
  readonly strokeWidth?: number;
}

/**
 * Formatting and code-toggle options for cluster badges (`preset: 'badges'`).
 */
export interface CanvasBadgeOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Whether to render the cluster index prefix (`T1`–`TK`) on primary badges. Default: `true`. */
  readonly showCode?: boolean;
  /** Optional maximum character length for displayed cluster titles. */
  readonly maxTitleChars?: number;
  /** Optional title formatter receiving the raw title plus `{ variant, cluster }` context. */
  readonly formatTitle?: (
    title: string,
    context: {
      readonly variant: 'primary' | 'intermediate';
      readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
    },
  ) => string;
}

/**
 * Fixed or per-item shape resolver for `'geometric'` and `'badges'` presets.
 */
export type CanvasContentShapeOption<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | CanvasShapeSpec
  | ((
      item: TItem,
      ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
    ) => CanvasShapeSpec);

/**
 * Built-in geometric shape descriptor for content nodes.
 */
export interface CanvasGeometricVisual {
  readonly kind: 'geometric';
  readonly shape: CanvasShapeSpec;
  readonly radius: number;
  readonly colorHex: string;
  readonly label: string;
  readonly theme: CanvasTheme;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
}

/**
 * Built-in multi-sector barycentric donut descriptor for content nodes.
 */
export interface CanvasGlyphVisual {
  readonly kind: 'glyph';
  readonly radius: number;
  readonly sectors: readonly {
    readonly colorHex: string;
    readonly weight: number;
  }[];
  readonly label: string;
  readonly theme: CanvasTheme;
}

export type CanvasDefaultContentVisual = CanvasGeometricVisual | CanvasGlyphVisual;

/**
 * Built-in circular cluster anchor descriptor (`preset: 'geometric' | 'glyphs'`).
 */
export interface CanvasClusterAnchorVisual {
  readonly kind: 'anchor';
  readonly code: string;
  readonly title: string;
  readonly colorHex: string;
  readonly radius: number;
  readonly memberCount: number;
  readonly variant: 'primary' | 'intermediate';
  readonly parentContextLabel?: string;
  readonly theme: CanvasTheme;
}

/**
 * Built-in rounded-pill cluster badge descriptor (`preset: 'badges'`).
 */
export interface CanvasClusterBadgeVisual {
  readonly kind: 'badge';
  readonly code: string;
  readonly showCode: boolean;
  readonly title: string;
  readonly colorHex: string;
  readonly memberCount: number;
  readonly variant: 'primary' | 'intermediate';
  readonly parentContextLabel?: string;
  readonly theme: CanvasTheme;
}

export type CanvasDefaultClusterVisual =
  | CanvasClusterAnchorVisual
  | CanvasClusterBadgeVisual;

/**
 * Context passed to custom `CanvasNodeRenderer.draw()` callbacks.
 */
export interface CanvasNodeDrawContext {
  readonly theme: CanvasTheme;
  readonly cameraZoom: number;
  /** Effective screen-space radius/scale indicator for LOD decisions. */
  readonly effectiveScale: number;
  /** `true` when the node falls below `lodThresholdPx` and should prefer simplified drawing. */
  readonly simplifiedLod: boolean;
}

/**
 * Pluggable, framework-agnostic Canvas 2D node renderer for `@simplex-viz/canvas`.
 */
export interface CanvasNodeRenderer<TVisual> {
  /** Optional hover scale multiplier applied without altering collision hulls. */
  readonly hoverScale?: number;
  /** Optional opacity multiplier in `[0, 1]` applied when dimmed. */
  readonly dimmedOpacity?: number;
  /** Computes the unscaled (`scale = 1.0`) convex hull centered at `(0, 0)`. */
  measureConvexHull(
    visual: TVisual,
    ctx: CanvasRenderingContext2D | null,
  ): ConvexGeometry;
  /**
   * Draws a single node in local node coordinates centered around `(0, 0)` (already
   * translated to `(state.x, state.y)` and scaled by `state.scale * hoverFactor`).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    visual: TVisual,
    state: NodeRenderState<TVisual>,
    renderCtx: CanvasNodeDrawContext,
  ): void;
}

/**
 * Pluggable Canvas 2D renderer for simplex triangle faces.
 */
export interface CanvasTriangleRenderer<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  draw(
    ctx: CanvasRenderingContext2D,
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: CanvasTheme,
    cameraZoom: number,
  ): void;
}

/**
 * Pluggable Canvas 2D renderer for simplex lattice edges.
 */
export interface CanvasEdgeRenderer<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  draw(
    ctx: CanvasRenderingContext2D,
    edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: CanvasTheme,
    cameraZoom: number,
  ): void;
}

/**
 * Lightweight per-frame telemetry returned by `getRenderStats()` for profiling & benchmarks.
 */
export interface CanvasRenderStats {
  readonly lastFrameMs: number;
  readonly totalItems: number;
  readonly drawnItems: number;
  readonly culledItems: number;
  readonly lodSimplifiedItems: number;
  readonly drawnClusters: number;
  readonly drawnTriangles: number;
  readonly drawnEdges: number;
  readonly devicePixelRatio: number;
}

/**
 * Screen-space marquee selection rectangle rendered by `CanvasRendererAdapter`.
 */
export interface CanvasMarqueeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Options for native Canvas PNG export (`exportPng()`).
 */
export interface CanvasExportPngOptions {
  /** Override background color (`'transparent'` for alpha PNG, or CSS color). Defaults to active theme background. */
  readonly backgroundColor?: string;
  /** Pixel scale multiplier for rasterization (defaults to current canvas DPR, min 1). */
  readonly scale?: number;
  /** Output format (`'blob'` default or `'dataUrl'`). */
  readonly format?: 'blob' | 'dataUrl';
}
