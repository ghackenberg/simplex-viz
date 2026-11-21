import {
  SIMPLEX_PRESET_DEFAULTS,
  estimateSimplexTextWidth,
  extractSimplexItemLabel,
  getGeometricShapeVertices,
  hexWithAlpha,
  measureGeometricShapeHull,
  rectToConvexPolygon,
  resolveClusterBadgeTitle,
  resolveGeometricShapeSpec,
  resolveRankGeometricShape,
  truncateSimplexBadgeTitle,
  type ClusterDescriptor,
  type ContentLayoutContext,
  type ConvexGeometry,
  type DefaultTaggedItem,
  type MeshEdgeRenderState,
  type MeshTriangleRenderState,
  type NodeRenderState,
  type Point2D,
  type VisualResolver,
} from '@simplex-viz/core';
import type {
  CanvasBadgeOptions,
  CanvasClusterBadgeVisual,
  CanvasContentShapeOption,
  CanvasDefaultClusterVisual,
  CanvasDefaultContentVisual,
  CanvasGeometricVisual,
  CanvasShapeOptions,
  CanvasShapeSpec,
  CanvasTheme,
  CanvasVisualPreset,
} from './types.js';

const TAU = Math.PI * 2;
const DEFAULT_BADGE_FONT = '600 11.5px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
const DEFAULT_CODE_FONT = '700 9.5px "IBM Plex Mono", ui-monospace, monospace';
const DEFAULT_SUB_FONT = '500 9.5px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';

interface ResolvedPolygonSpec {
  readonly kind: 'circle' | 'polygon' | 'star';
  readonly sides: number;
  readonly rotationRad: number;
}

/**
 * Normalizes any `CanvasShapeSpec` into concrete polygon parameters.
 */
export function resolveCanvasShapeSpec(spec: CanvasShapeSpec): ResolvedPolygonSpec {
  const normalized = resolveGeometricShapeSpec(spec);
  if (normalized.shape === 'circle') {
    return { kind: 'circle', sides: 0, rotationRad: 0 };
  }
  if (normalized.shape === 'star') {
    return { kind: 'star', sides: 5, rotationRad: normalized.rotationRad ?? -Math.PI / 2 };
  }
  if (normalized.shape === 'diamond') {
    return { kind: 'polygon', sides: 4, rotationRad: normalized.rotationRad ?? -Math.PI / 2 };
  }
  if (normalized.shape === 'octagon') {
    return { kind: 'polygon', sides: 8, rotationRad: Math.PI / 8 };
  }
  if (normalized.shape === 'hexagon') {
    return { kind: 'polygon', sides: 6, rotationRad: -Math.PI / 6 };
  }
  return {
    kind: 'polygon',
    sides: Math.max(3, normalized.sides ?? 6),
    rotationRad: normalized.rotationRad ?? -Math.PI / 2,
  };
}

// Unit-vertex cache keyed by shape geometry so 10,000-node draws allocate 0 objects per frame
const unitPolygonCache = new Map<string, readonly Point2D[]>();

function getUnitVertices(spec: ResolvedPolygonSpec): readonly Point2D[] {
  const key = `${spec.kind}:${spec.sides}:${spec.rotationRad.toFixed(4)}`;
  const cached = unitPolygonCache.get(key);
  if (cached) return cached;

  const verts = getGeometricShapeVertices(
    {
      kind: spec.kind === 'circle' ? 'polygon' : spec.kind,
      sides: spec.sides,
      rotationRad: spec.rotationRad,
      radiusScale: 1,
    },
    1,
    {
      minRadius: 1,
      useRadiusScale: false,
      starOuterScale: 1,
      starInnerScale: 0.48,
    },
  );

  unitPolygonCache.set(key, verts);
  return verts;
}

/**
 * Analytical convex hull for any `CanvasGeometricVisual` (including stroke padding).
 */
export function measureGeometricContentHull(
  visual: CanvasGeometricVisual,
  defaultStrokeWidth: number = SIMPLEX_PRESET_DEFAULTS.canvasStrokeWidth,
): ConvexGeometry {
  const strokePad = Math.max(0, visual.strokeWidth ?? defaultStrokeWidth) * 0.5;
  const r = Math.max(2, visual.radius + strokePad);
  const spec = resolveCanvasShapeSpec(visual.shape);
  if (spec.kind === 'circle') {
    return { kind: 'circle', radius: r };
  }
  return measureGeometricShapeHull(
    {
      kind: spec.kind,
      sides: spec.sides,
      rotationRad: spec.rotationRad,
      radiusScale: 1,
    },
    r,
    { useRadiusScale: false, starOuterScale: 1 },
  );
}

/**
 * Deterministic text width measurement via Canvas 2D `measureText` with
 * proportional fallback for headless environments without font metrics.
 */
export function measureCanvasTextWidth(
  text: string,
  font: string,
  ctx: CanvasRenderingContext2D | null,
  fontSizePx = 11.5,
): number {
  if (!text) return 0;
  if (ctx && typeof ctx.measureText === 'function') {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    if (Number.isFinite(w) && w > 0) return w;
  }
  return estimateSimplexTextWidth({
    text,
    fontSize: fontSizePx,
    fontFamily: font,
  });
}

interface BadgeDimensions {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly codeWidth: number;
  readonly hasParentLine: boolean;
}

function computeBadgeDimensions(
  visual: CanvasClusterBadgeVisual,
  ctx: CanvasRenderingContext2D | null,
): BadgeDimensions {
  const isIntermediate = visual.variant === 'intermediate';
  const hasParentLine =
    !isIntermediate && Boolean(visual.parentContextLabel && visual.parentContextLabel.length > 0);
  const titleWidth = measureCanvasTextWidth(
    visual.title,
    DEFAULT_BADGE_FONT,
    ctx,
    isIntermediate ? 10.5 : 11.5,
  );
  const codeWidth =
    !isIntermediate && visual.showCode && visual.code.length > 0
      ? measureCanvasTextWidth(visual.code, DEFAULT_CODE_FONT, ctx, 9.5) + 12
      : 0;
  const parentWidth = hasParentLine
    ? measureCanvasTextWidth(visual.parentContextLabel!, DEFAULT_SUB_FONT, ctx, 9.5)
    : 0;

  const horizontalPad = isIntermediate ? 16 : 20;
  const contentWidth = Math.max(codeWidth + titleWidth, parentWidth);
  const width = Math.max(isIntermediate ? 48 : 64, Math.ceil(contentWidth + horizontalPad));
  const height = isIntermediate ? 22 : hasParentLine ? 36 : 26;
  const radius = isIntermediate ? 11 : 8;
  return { width, height, radius, codeWidth, hasParentLine };
}

/**
 * Analytical convex hull for built-in cluster visuals (`'anchor'` or `'badge'`).
 */
export function measureDefaultClusterHull(
  visual: CanvasDefaultClusterVisual,
  ctx: CanvasRenderingContext2D | null,
): ConvexGeometry {
  if (visual.kind === 'anchor') {
    return { kind: 'circle', radius: Math.max(6, visual.radius + 2) };
  }
  const dims = computeBadgeDimensions(visual, ctx);
  return rectToConvexPolygon(dims.width + 2, dims.height + 2, dims.radius);
}

/**
 * Truncates a cluster title on word boundaries when exceeding `maxChars`.
 */
export function truncateCanvasBadgeTitle(title: string, maxChars?: number): string {
  return truncateSimplexBadgeTitle(title, maxChars);
}

/**
 * Safely extracts a display label from an arbitrary domain item.
 */
export function extractCanvasItemLabel<TItem>(
  item: TItem,
  fallbackId: string,
  getLabel?: (item: TItem) => string,
): string {
  return extractSimplexItemLabel(item, fallbackId, getLabel);
}

export interface CanvasPresetResolverOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly getLabel?: (item: TItem) => string;
  readonly theme?: CanvasTheme;
  readonly formatTagLabel?: (tag: string) => string;
  readonly badgeOptions?: CanvasBadgeOptions<TItem, TTagMeta, TClusterMeta>;
  readonly getShape?: CanvasContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  readonly shapeOptions?: CanvasShapeOptions;
}

/**
 * Creates a built-in `VisualResolver` for `@simplex-viz/canvas` presets (`'geometric'`, `'glyphs'`, `'badges'`).
 */
export function createCanvasPresetVisualResolver<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  preset: CanvasVisualPreset,
  options: CanvasPresetResolverOptions<TItem, TTagMeta, TClusterMeta> = {},
): VisualResolver<
  TItem,
  CanvasDefaultContentVisual,
  CanvasDefaultClusterVisual,
  TTagMeta,
  TClusterMeta
> {
  const theme: CanvasTheme = options.theme ?? 'dark';
  const showCode = options.badgeOptions?.showCode ?? true;

  return {
    resolveContentVisual(
      item: TItem,
      ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
    ): CanvasDefaultContentVisual {
      const label = extractCanvasItemLabel(item, ctx.id, options.getLabel);
      if (preset === 'glyphs') {
        const sectors =
          ctx.unitClusters.length > 0
            ? ctx.unitClusters.map((uc) => ({
                colorHex: uc.cluster.colorHex,
                weight: uc.weight,
              }))
            : [{ colorHex: ctx.mixedColorHex, weight: 1 }];
        return {
          kind: 'glyph',
          radius: SIMPLEX_PRESET_DEFAULTS.canvasGlyphRadius,
          sectors,
          label,
          theme,
        };
      }

      let shape: CanvasShapeSpec;
      if (options.getShape !== undefined) {
        shape =
          typeof options.getShape === 'function'
            ? options.getShape(item, ctx)
            : options.getShape;
      } else {
        shape = resolveRankGeometricShape(ctx.unitClusters.length);
      }

      return {
        kind: 'geometric',
        shape,
        radius: SIMPLEX_PRESET_DEFAULTS.contentRadius,
        colorHex: ctx.mixedColorHex,
        label,
        theme,
        strokeColor: options.shapeOptions?.strokeColor,
        strokeWidth: options.shapeOptions?.strokeWidth,
      };
    },

    resolveClusterVisual(
      cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
    ): CanvasDefaultClusterVisual {
      const variant = cluster.role === 'intermediate' ? 'intermediate' : 'primary';
      const title = resolveClusterBadgeTitle(cluster, {
        formatTagLabel: options.formatTagLabel,
        badgeOptions: options.badgeOptions,
        maxIntermediateLength: 22,
      });

      if (preset === 'badges') {
        return {
          kind: 'badge',
          code: cluster.code,
          showCode,
          title,
          colorHex: cluster.colorHex,
          memberCount: cluster.members.length,
          variant,
          parentContextLabel: cluster.parentContextLabel,
          theme,
        };
      }

      return {
        kind: 'anchor',
        code: cluster.code,
        title,
        colorHex: cluster.colorHex,
        radius:
          variant === 'intermediate'
            ? 14
            : SIMPLEX_PRESET_DEFAULTS.canvasClusterAnchorRadius,
        memberCount: cluster.members.length,
        variant,
        parentContextLabel: cluster.parentContextLabel,
        theme,
      };
    },

    getVisualCacheKey(v: CanvasDefaultContentVisual | CanvasDefaultClusterVisual): string {
      if (v.kind === 'geometric') {
        const shapeKey =
          typeof v.shape === 'object'
            ? `${v.shape.sides}:${v.shape.rotationRad ?? ''}`
            : String(v.shape);
        return `geo:${shapeKey}:${v.radius}:${v.colorHex}:${v.strokeWidth ?? ''}:${v.theme}`;
      }
      if (v.kind === 'glyph') {
        const sec = v.sectors
          .map((s) => `${s.colorHex}:${s.weight.toFixed(2)}`)
          .join(',');
        return `glyph:${v.radius}:${sec}:${v.theme}`;
      }
      if (v.kind === 'anchor') {
        return `anchor:${v.variant}:${v.code}:${v.title}:${v.radius}:${v.colorHex}:${v.theme}`;
      }
      return `badge:${v.variant}:${v.showCode}:${v.code}:${v.title}:${v.parentContextLabel ?? ''}:${v.colorHex}:${v.theme}`;
    },
  };
}

// ============================================================================
// High-Throughput Canvas 2D Drawing Primitives (Zero save/restore on hot path)
// ============================================================================

export { hexWithAlpha };

function traceRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * Default Canvas 2D renderer for simplex triangle faces, including `1:4`
 * drillable internal subdivision lines and zoomed outer perimeter highlights.
 */
export function drawDefaultCanvasTriangle<TItem, TTagMeta, TClusterMeta>(
  ctx: CanvasRenderingContext2D,
  triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
  theme: CanvasTheme,
  cameraZoom: number,
): void {
  const [p0, p1, p2] = triangle.points;
  const { isHovered, isFocused, isDimmed, isHighlighted } = triangle.interaction;
  const activeHighlight = isHovered || isFocused || Boolean(isHighlighted);
  const baseOpacity = triangle.opacity ?? 1;
  if (baseOpacity <= 0.005) return;

  const tintAlpha = triangle.isContext
    ? (theme === 'dark' ? 0.045 : 0.055)
    : activeHighlight
      ? (theme === 'dark' ? 0.22 : 0.19)
      : isDimmed
        ? (theme === 'dark' ? 0.035 : 0.04)
        : Math.max(0.06, Math.min(0.18, triangle.fillOpacity || (theme === 'dark' ? 0.1 : 0.09)));

  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();

  ctx.fillStyle = hexWithAlpha(triangle.fillHex, tintAlpha * baseOpacity);
  ctx.fill();

  // Internal 1:4 subdivision preview edges for drillable triangles
  if (triangle.isDrillable && !triangle.isContext) {
    const m01x = (p0.x + p1.x) * 0.5;
    const m01y = (p0.y + p1.y) * 0.5;
    const m12x = (p1.x + p2.x) * 0.5;
    const m12y = (p1.y + p2.y) * 0.5;
    const m20x = (p2.x + p0.x) * 0.5;
    const m20y = (p2.y + p0.y) * 0.5;

    ctx.beginPath();
    ctx.moveTo(m01x, m01y);
    ctx.lineTo(m12x, m12y);
    ctx.lineTo(m20x, m20y);
    ctx.closePath();
    ctx.setLineDash([4 / Math.max(0.5, cameraZoom), 4 / Math.max(0.5, cameraZoom)]);
    ctx.lineWidth = 1 / Math.max(0.5, cameraZoom);
    ctx.strokeStyle =
      theme === 'dark'
        ? `rgba(148, 163, 184, ${(0.22 * baseOpacity).toFixed(3)})`
        : `rgba(71, 85, 105, ${(0.24 * baseOpacity).toFixed(3)})`;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Highlighted perimeter or outer boundary edges
  if (activeHighlight && !triangle.isContext) {
    const strokeColor =
      theme === 'dark'
        ? hexWithAlpha(triangle.fillHex, 0.72 * baseOpacity)
        : hexWithAlpha(triangle.fillHex, 0.8 * baseOpacity);
    ctx.lineWidth = 1.75 / Math.max(0.5, cameraZoom);
    ctx.strokeStyle = strokeColor;

    if (triangle.highlightBoundary) {
      const edges: readonly [Point2D, Point2D][] = [
        [p0, p1],
        [p1, p2],
        [p2, p0],
      ];
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        if (triangle.highlightBoundary.edges[i]) {
          const [a, b] = edges[i]!;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.stroke();
    }
  }
}

/**
 * Default Canvas 2D renderer for simplex lattice edges.
 */
export function drawDefaultCanvasEdge<TItem, TTagMeta, TClusterMeta>(
  ctx: CanvasRenderingContext2D,
  edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
  theme: CanvasTheme,
  cameraZoom: number,
): void {
  const baseOpacity = edge.opacity ?? 1;
  if (baseOpacity <= 0.005) return;

  const invZoom = 1 / Math.max(0.5, cameraZoom);
  ctx.beginPath();
  ctx.moveTo(edge.a.x, edge.a.y);
  ctx.lineTo(edge.b.x, edge.b.y);

  if (edge.isHighlighted) {
    ctx.setLineDash([]);
    ctx.lineWidth = 1.8 * invZoom;
    ctx.strokeStyle = hexWithAlpha(edge.mixedColorHex, 0.78 * baseOpacity);
  } else {
    ctx.setLineDash([4 * invZoom, 4 * invZoom]);
    ctx.lineWidth = 1.05 * invZoom;
    const alpha = edge.isDimmed ? 0.14 : theme === 'dark' ? 0.3 : 0.34;
    ctx.strokeStyle =
      theme === 'dark'
        ? `rgba(148, 163, 184, ${(alpha * baseOpacity).toFixed(3)})`
        : `rgba(100, 116, 139, ${(alpha * baseOpacity).toFixed(3)})`;
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Ultra-fast world-space content node renderer (zero `ctx.save/restore`, zero object allocation).
 */
export function drawFastContentNode(
  ctx: CanvasRenderingContext2D,
  visual: CanvasDefaultContentVisual,
  state: NodeRenderState<CanvasDefaultContentVisual>,
  alpha: number,
  cameraZoom: number,
  simplifiedLod: boolean,
  shapeOptions?: CanvasShapeOptions,
): void {
  const { isHovered, isSelected, isHighlighted, isPinned } = state.interaction;
  const hoverFactor = isHovered
    ? (shapeOptions?.hoverScale ?? SIMPLEX_PRESET_DEFAULTS.canvasHoverScale)
    : 1;
  const r = Math.max(1.25, visual.radius * state.scale * hoverFactor);
  const x = state.x;
  const y = state.y;
  const invZoom = 1 / Math.max(0.5, cameraZoom);

  ctx.globalAlpha = alpha;

  if (visual.kind === 'glyph' && !simplifiedLod) {
    let angle = -Math.PI / 2;
    const total = visual.sectors.reduce((acc, s) => acc + Math.max(0, s.weight), 0) || 1;
    const innerR = r * 0.44;
    for (let i = 0; i < visual.sectors.length; i++) {
      const sec = visual.sectors[i]!;
      const sweep = (Math.max(0, sec.weight) / total) * TAU;
      if (sweep <= 0.001) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, angle, angle + sweep);
      ctx.arc(x, y, innerR, angle + sweep, angle, true);
      ctx.closePath();
      ctx.fillStyle = sec.colorHex;
      ctx.fill();
      angle += sweep;
    }
    ctx.beginPath();
    ctx.arc(x, y, innerR, 0, TAU);
    ctx.fillStyle = visual.theme === 'dark' ? '#0f172a' : '#f8fafc';
    ctx.fill();
  } else {
    const fillHex =
      visual.kind === 'geometric'
        ? visual.colorHex
        : (visual.sectors[0]?.colorHex ?? '#64748b');

    if (simplifiedLod || (visual.kind === 'geometric' && visual.shape === 'circle')) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = fillHex;
      ctx.fill();
    } else if (visual.kind === 'geometric') {
      const spec = resolveCanvasShapeSpec(visual.shape);
      if (spec.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
      } else {
        const verts = getUnitVertices(spec);
        ctx.beginPath();
        const first = verts[0]!;
        ctx.moveTo(x + first.x * r, y + first.y * r);
        for (let i = 1; i < verts.length; i++) {
          const v = verts[i]!;
          ctx.lineTo(x + v.x * r, y + v.y * r);
        }
        ctx.closePath();
      }
      ctx.fillStyle = fillHex;
      ctx.fill();
    }

    // Stroke only when not simplified LOD (or when interactively emphasized)
    const strokeW =
      visual.kind === 'geometric'
        ? (visual.strokeWidth ?? shapeOptions?.strokeWidth ?? 1.15)
        : 1.1;
    if ((!simplifiedLod || isHovered || isSelected || isHighlighted) && strokeW > 0) {
      ctx.lineWidth = strokeW * Math.min(1, state.scale + 0.25);
      ctx.strokeStyle =
        (visual.kind === 'geometric' ? visual.strokeColor : undefined) ??
        shapeOptions?.strokeColor ??
        (visual.theme === 'dark' ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.92)');
      ctx.stroke();
    }
  }

  // Selection ring (high-contrast violet matching @simplex-viz/svg)
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 3.2 * invZoom, 0, TAU);
    ctx.lineWidth = 2 * invZoom;
    ctx.strokeStyle = visual.theme === 'dark' ? '#c084fc' : '#7c3aed';
    ctx.stroke();
  }

  // Hover / highlight / pin outer halo
  if (isHovered || isHighlighted || isPinned) {
    ctx.beginPath();
    ctx.arc(x, y, r + (isSelected ? 6 : 3.4) * invZoom, 0, TAU);
    ctx.lineWidth = 1.75 * invZoom;
    ctx.strokeStyle =
      (isHovered ? shapeOptions?.hoverRingColor : undefined) ??
      (visual.theme === 'dark' ? '#f8fafc' : '#0f172a');
    ctx.stroke();
  }
}

/**
 * Draws built-in cluster nodes (`'anchor'` double-ring or `'badge'` rounded pill).
 */
export function drawDefaultClusterNode(
  ctx: CanvasRenderingContext2D,
  visual: CanvasDefaultClusterVisual,
  state: NodeRenderState<CanvasDefaultClusterVisual>,
  alpha: number,
  cameraZoom: number,
): void {
  const x = state.x;
  const y = state.y;
  const s = state.scale;
  const { isHovered, isHighlighted } = state.interaction;
  const invZoom = 1 / Math.max(0.5, cameraZoom);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(s, s);

  if (visual.kind === 'anchor') {
    const r = visual.radius;
    // Outer ring
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = visual.theme === 'dark' ? '#0f172a' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = isHovered || isHighlighted ? 2.6 : 2;
    ctx.strokeStyle = visual.colorHex;
    ctx.stroke();

    // Inner tinted core
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, TAU);
    ctx.fillStyle = hexWithAlpha(visual.colorHex, visual.theme === 'dark' ? 0.28 : 0.2);
    ctx.fill();

    // Code text
    ctx.font = DEFAULT_CODE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = visual.theme === 'dark' ? '#f8fafc' : '#0f172a';
    ctx.fillText(visual.code, 0, 0.5);
  } else {
    const dims = computeBadgeDimensions(visual, ctx);
    const left = -dims.width * 0.5;
    const top = -dims.height * 0.5;

    traceRoundedRectPath(ctx, left, top, dims.width, dims.height, dims.radius);
    ctx.fillStyle =
      visual.theme === 'dark'
        ? 'rgba(15, 23, 42, 0.92)'
        : 'rgba(255, 255, 255, 0.95)';
    ctx.fill();
    ctx.lineWidth = isHovered || isHighlighted ? 2.2 : 1.45;
    ctx.strokeStyle = visual.colorHex;
    ctx.stroke();

    // Left color accent dot or code pill
    const textColor = visual.theme === 'dark' ? '#f8fafc' : '#0f172a';
    const subColor = visual.theme === 'dark' ? '#94a3b8' : '#475569';
    ctx.textBaseline = 'middle';

    if (visual.variant === 'intermediate') {
      ctx.font = '600 10.5px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = textColor;
      ctx.fillText(visual.title, 0, 0.5);
    } else if (dims.hasParentLine) {
      ctx.font = DEFAULT_SUB_FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = subColor;
      ctx.fillText(visual.parentContextLabel!, 0, -7);

      ctx.font = DEFAULT_BADGE_FONT;
      ctx.fillStyle = textColor;
      ctx.fillText(visual.title, 0, 7);
    } else if (visual.showCode && visual.code.length > 0) {
      const codeX = left + 10;
      ctx.font = DEFAULT_CODE_FONT;
      ctx.textAlign = 'left';
      ctx.fillStyle = visual.colorHex;
      ctx.fillText(visual.code, codeX, 0.5);

      ctx.font = DEFAULT_BADGE_FONT;
      ctx.fillStyle = textColor;
      ctx.fillText(visual.title, codeX + dims.codeWidth - 4, 0.5);
    } else {
      ctx.font = DEFAULT_BADGE_FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = textColor;
      ctx.fillText(visual.title, 0, 0.5);
    }
  }

  if (isHovered || isHighlighted) {
    ctx.lineWidth = 1.6 * invZoom;
    ctx.strokeStyle = visual.theme === 'dark' ? 'rgba(248,250,252,0.65)' : 'rgba(15,23,42,0.55)';
    if (visual.kind === 'anchor') {
      ctx.beginPath();
      ctx.arc(0, 0, visual.radius + 3.5, 0, TAU);
      ctx.stroke();
    } else {
      const dims = computeBadgeDimensions(visual, ctx);
      traceRoundedRectPath(
        ctx,
        -dims.width * 0.5 - 3,
        -dims.height * 0.5 - 3,
        dims.width + 6,
        dims.height + 6,
        dims.radius + 2,
      );
      ctx.stroke();
    }
  }

  ctx.restore();
}
