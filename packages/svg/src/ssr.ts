import {
  computeConvexHull,
  estimateSimplexTextWidth,
  rectToConvexPolygon,
  regularPolygon,
  solveSimplexSnapshot,
  starConvexHull,
  type ClusterDescriptor,
  type ContentLayoutContext,
  type ConvexGeometry,
  type DefaultTaggedItem,
  type ItemFilterMode,
  type ItemFilterPredicate,
  type MeshEdgeRenderState,
  type MeshTriangleRenderState,
  type Point2D,
  type SimplexLayoutSnapshot,
  type SimplexSnapshotOptions,
  type SnapshotClusterNode,
  type SnapshotContentNode,
} from '@simplex-viz/core';
import {
  resolveClusterSurfaceColors,
  roundedRectSvgPath,
} from './colorContrast.js';
import type {
  PresetBadgeClusterOptions,
  PresetContentShapeOption,
  SimplexTheme,
  SimplexVisualPreset,
} from './presets.js';
import { truncateBadgeTitle } from './views/BadgeClusterSvgView.js';
import {
  resolveGeometricShapeSpec,
  type GeometricShapeKind,
  type GeometricShapeSvgViewOptions,
} from './views/GeometricShapeSvgView.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Input descriptor passed to `SsrMeasureTextFn` / `estimateSsrTextWidth()`.
 */
export interface SsrTextMetricsInput {
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight?: number | string;
  readonly letterSpacingEm?: number;
}

/**
 * Pluggable text-width measurer for deterministic SSR layout without DOM `getBBox()`.
 * Returns the estimated rendered text advance width in SVG pixels.
 */
export type SsrMeasureTextFn = (input: SsrTextMetricsInput) => number;

/**
 * Context passed to custom `renderTriangle` SVG string hook in `renderSimplexSvgString()`.
 */
export interface SsrRenderTriangleContext<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly theme: SimplexTheme;
  readonly defaultMarkup: string;
}

/**
 * Context passed to custom `renderEdge` SVG string hook in `renderSimplexSvgString()`.
 */
export interface SsrRenderEdgeContext<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>;
  readonly theme: SimplexTheme;
  readonly defaultMarkup: string;
}

/**
 * Context passed to custom `renderCluster` SVG string hook in `renderSimplexSvgString()`.
 * Returned SVG markup is placed inside a `<g transform="translate(x, y) scale(s)">` centered at `(0, 0)`.
 */
export interface SsrRenderClusterContext<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly node: SnapshotClusterNode<TItem, TTagMeta, TClusterMeta>;
  readonly theme: SimplexTheme;
  readonly preset: SimplexVisualPreset;
  readonly defaultMarkup: string;
}

/**
 * Context passed to custom `renderContent` SVG string hook in `renderSimplexSvgString()`.
 * Returned SVG markup is placed inside a `<g transform="translate(x, y) scale(s)">` centered at `(0, 0)`.
 */
export interface SsrRenderContentContext<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly node: SnapshotContentNode<TItem, TTagMeta, TClusterMeta>;
  readonly theme: SimplexTheme;
  readonly preset: SimplexVisualPreset;
  readonly isHighlighted: boolean;
  readonly isSelected: boolean;
  readonly isDimmed: boolean;
  readonly defaultMarkup: string;
}

/**
 * Extra rendering, styling, and SSR formatting options accepted by `renderSimplexSvgString()`.
 */
export interface RenderSimplexSvgStringExtraOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Built-in visual preset (`'geometric'`, `'glyphs'`, or `'badges'`). Default: `'geometric'`. */
  readonly preset?: SimplexVisualPreset;
  /** Visual color theme (`'dark'` or `'light'`). Default: `'dark'`. */
  readonly theme?: SimplexTheme;
  /** Optional item label extractor used for accessibility/titles and metadata. */
  readonly getLabel?: (item: TItem) => string;
  /** Formatting & code-toggle options for `'badges'` cluster capsules. */
  readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  /** Fixed or item-driven content shape override for `'geometric'` / `'badges'` presets. */
  readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  /** Stroke, ring, and dimming styling options for geometric shapes. */
  readonly shapeOptions?: GeometricShapeSvgViewOptions;
  /**
   * Whether to render an opaque background `<rect>` matching the active theme
   * (`#07090e` dark / `#ffffff` light) or `backgroundColor`. Default: `true`.
   */
  readonly includeBackground?: boolean;
  /** Explicit CSS color override for the background `<rect>`. */
  readonly backgroundColor?: string;
  /** Uniform margin (in SVG coordinate units) expanded around all four sides of `viewBox`. Default: `0`. */
  readonly padding?: number;
  /** Optional `<title>` element injected as the first child of the root `<svg>`. */
  readonly title?: string;
  /** Optional `aria-label` attribute on the root `<svg>`. */
  readonly ariaLabel?: string;
  /** Optional CSS class list added to the root `<svg>`. */
  readonly className?: string;
  /** Whether to embed a compact `<style>` block with default font stacks inside the `<svg>`. Default: `true`. */
  readonly includeEmbeddedStyles?: boolean;
  /** Whether to prepend `<?xml version="1.0" encoding="UTF-8"?>` for standalone SVG files. Default: `false`. */
  readonly xmlDeclaration?: boolean;
  /** Optional iterable of item IDs to highlight (dimming non-matches). */
  readonly highlightedIds?: Iterable<string> | null;
  /** Optional item IDs rendered with multi-selection rings (`data-selected="true"`). */
  readonly selectedIds?: Iterable<string> | null;
  /** Optional item filter predicate (`'dim'` or `'hide'`). */
  readonly itemFilter?: ItemFilterPredicate<TItem> | null;
  /** Visual mode for filtered-out items (`'dim'` or `'hide'`). Default: `'dim'`. */
  readonly itemFilterMode?: ItemFilterMode;
  /** Optional custom text-width estimator replacing built-in proportional/monospace font metrics. */
  readonly measureText?: SsrMeasureTextFn;
  /** Optional debug convex hull overlay rendering. Default: `false`. */
  readonly showHulls?: boolean;
  /** Optional custom SVG string hook for triangulation faces. */
  readonly renderTriangle?: (
    ctx: SsrRenderTriangleContext<TItem, TTagMeta, TClusterMeta>,
  ) => string;
  /** Optional custom SVG string hook for triangulation edges. */
  readonly renderEdge?: (
    ctx: SsrRenderEdgeContext<TItem, TTagMeta, TClusterMeta>,
  ) => string;
  /** Optional custom SVG string hook for cluster nodes (local origin `(0, 0)`). */
  readonly renderCluster?: (
    ctx: SsrRenderClusterContext<TItem, TTagMeta, TClusterMeta>,
  ) => string;
  /** Optional custom SVG string hook for content nodes (local origin `(0, 0)`). */
  readonly renderContent?: (
    ctx: SsrRenderContentContext<TItem, TTagMeta, TClusterMeta>,
  ) => string;
}

/**
 * Full options accepted by `renderSimplexSvgString(items, options)`.
 */
export type RenderSimplexSvgStringOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = SimplexSnapshotOptions<TItem, TTagMeta, TClusterMeta> &
  RenderSimplexSvgStringExtraOptions<TItem, TTagMeta, TClusterMeta>;

/**
 * Options accepted by `renderSimplexSvgString(snapshot, options)` when passing a pre-solved
 * `SimplexLayoutSnapshot`.
 */
export type RenderSimplexSnapshotSvgOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = RenderSimplexSvgStringExtraOptions<TItem, TTagMeta, TClusterMeta> & {
  /** Optional output width override (in pixels) for the root `<svg>`. */
  readonly width?: number;
  /** Optional output height override (in pixels) for the root `<svg>`. */
  readonly height?: number;
  /** Optional tag formatter used when formatting `'badges'` intermediate cluster labels. */
  readonly formatTagLabel?: (tag: string) => string;
};

/**
 * Deterministic, DOM-free character-width estimator for SSR SVG text measurement.
 * Distinguishes monospace and proportional font stacks, bold weights, uppercase/wide glyphs,
 * CJK/fullwidth code points, and optional `letterSpacingEm`.
 */
export function estimateSsrTextWidth(input: SsrTextMetricsInput): number {
  return estimateSimplexTextWidth(input);
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(val: number, digits = 2): string {
  if (!Number.isFinite(val)) return '0';
  const factor = Math.pow(10, digits);
  const rounded = Math.round(val * factor) / factor;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function resolveSsrBackgroundColor(theme: SimplexTheme): string {
  return theme === 'light' ? '#ffffff' : '#07090e';
}

function isSnapshotInput<TItem, TTagMeta, TClusterMeta>(
  input:
    | readonly TItem[]
    | SimplexLayoutSnapshot<TItem, TTagMeta, TClusterMeta>,
): input is SimplexLayoutSnapshot<TItem, TTagMeta, TClusterMeta> {
  return (
    !Array.isArray(input) &&
    typeof input === 'object' &&
    input !== null &&
    'mesh' in input &&
    'clusters' in input &&
    'items' in input &&
    'triangles' in input &&
    'edges' in input
  );
}

const NAMED_POLYGON_SIDES: Readonly<Record<string, number>> = {
  triangle: 3,
  square: 4,
  pentagon: 5,
  hexagon: 6,
  heptagon: 7,
  octagon: 8,
};

function regularPolygonRadiusScale(sides: number): number {
  if (sides <= 3) return 1.18;
  if (sides === 4) return 1.1;
  if (sides === 5) return 1.08;
  if (sides === 6) return 1.05;
  if (sides === 7) return 1.04;
  return 1.03;
}

interface ResolvedGeometricSpec {
  readonly kind: 'circle' | 'diamond' | 'star' | 'polygon';
  readonly sides?: number;
  readonly rotationRad: number;
  readonly radiusScale: number;
  readonly radius: number;
}

function resolveSsrContentShape<TItem, TTagMeta, TClusterMeta>(
  item: TItem,
  ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
  getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>,
  shapeOptions?: GeometricShapeSvgViewOptions,
): ResolvedGeometricSpec {
  let shapeKind: GeometricShapeKind;
  let itemSides: number | undefined;
  let itemRot: number | undefined;
  let radius = 9.5;

  if (getShape !== undefined) {
    const rawSpec = typeof getShape === 'function' ? getShape(item, ctx) : getShape;
    const resolved = resolveGeometricShapeSpec(rawSpec);
    shapeKind = resolved.shape;
    itemSides = resolved.sides;
    itemRot = resolved.rotationRad;
    if (resolved.radius !== undefined) radius = resolved.radius;
  } else {
    const rank = ctx.unitClusters.length;
    shapeKind = rank >= 3 ? 'star' : rank === 2 ? 'diamond' : 'circle';
  }

  const effectiveSidesRaw = shapeOptions?.sides ?? itemSides;
  const effectiveShape =
    shapeOptions?.sides !== undefined
      ? (shapeOptions.shape ?? 'polygon')
      : (shapeOptions?.shape ?? shapeKind);

  if (
    effectiveShape === 'polygon' ||
    (effectiveSidesRaw !== undefined &&
      Number.isFinite(effectiveSidesRaw) &&
      effectiveShape !== 'circle' &&
      effectiveShape !== 'diamond' &&
      effectiveShape !== 'star')
  ) {
    const namedFallback = NAMED_POLYGON_SIDES[effectiveShape];
    const sides = Math.max(3, Math.round(effectiveSidesRaw ?? namedFallback ?? 6));
    const defaultRot =
      effectiveShape === 'square' ||
      (shapeOptions?.sides === 4 && shapeOptions.shape === undefined)
        ? -Math.PI / 4
        : -Math.PI / 2;
    return {
      kind: 'polygon',
      sides,
      rotationRad: shapeOptions?.rotationRad ?? itemRot ?? defaultRot,
      radiusScale: regularPolygonRadiusScale(sides),
      radius,
    };
  }

  const namedSides = NAMED_POLYGON_SIDES[effectiveShape];
  if (namedSides !== undefined) {
    const defaultRot = effectiveShape === 'square' ? -Math.PI / 4 : -Math.PI / 2;
    return {
      kind: 'polygon',
      sides: namedSides,
      rotationRad: shapeOptions?.rotationRad ?? itemRot ?? defaultRot,
      radiusScale: regularPolygonRadiusScale(namedSides),
      radius,
    };
  }

  if (effectiveShape === 'circle') {
    return { kind: 'circle', rotationRad: -Math.PI / 2, radiusScale: 1, radius };
  }
  if (effectiveShape === 'diamond') {
    return { kind: 'diamond', rotationRad: -Math.PI / 2, radiusScale: 1.12, radius };
  }
  return { kind: 'star', rotationRad: -Math.PI / 2, radiusScale: 1.24, radius };
}

function buildGeometricShapePath(resolved: ResolvedGeometricSpec, radius: number): string {
  const r = Math.max(3, radius);
  if (resolved.kind === 'circle') {
    const pts: Point2D[] = [];
    const samples = 48;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} Z`;
  }
  const verts: Point2D[] = [];
  if (resolved.kind === 'diamond') {
    const d = r * 1.12;
    verts.push(
      { x: 0, y: -d },
      { x: d * 0.88, y: 0 },
      { x: 0, y: d },
      { x: -d * 0.88, y: 0 },
    );
  } else if (resolved.kind === 'polygon') {
    const sides = Math.max(3, resolved.sides ?? 6);
    const polyR = r * resolved.radiusScale;
    for (let i = 0; i < sides; i++) {
      const a = resolved.rotationRad + (i * Math.PI * 2) / sides;
      verts.push({ x: Math.cos(a) * polyR, y: Math.sin(a) * polyR });
    }
  } else {
    const outer = r * 1.24;
    const inner = r * 0.56;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? outer : inner;
      verts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
    }
  }
  return `M ${verts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} Z`;
}

interface ResolvedBadgeGeometry {
  readonly variant: 'primary' | 'intermediate';
  readonly hasParentCtx: boolean;
  readonly showCode: boolean;
  readonly code: string;
  readonly upperParent: string;
  readonly title: string;
  readonly metaLine: string;
  readonly codeSpan: number;
  readonly headerContentW: number;
  readonly width: number;
  readonly height: number;
  readonly cut: number;
  readonly haloPad: number;
}

function resolveSsrBadgeGeometry<TItem, TTagMeta, TClusterMeta>(
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  options: {
    readonly formatTagLabel?: (tag: string) => string;
    readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
    readonly measureText: SsrMeasureTextFn;
  },
): ResolvedBadgeGeometry {
  const isIntermediate = cluster.role === 'intermediate';
  const variant: 'primary' | 'intermediate' = isIntermediate
    ? 'intermediate'
    : 'primary';
  const badgeOptions = options.badgeOptions;
  const measureText = options.measureText;

  let compactSuffix = '';
  if (isIntermediate) {
    if (cluster.subclusterLabel) {
      compactSuffix = cluster.subclusterLabel.slice(0, 24);
    } else if (cluster.coreTags.length > 0) {
      const firstTag = cluster.coreTags[0]!;
      const formattedTag =
        firstTag.label ??
        (options.formatTagLabel ? options.formatTagLabel(firstTag.tag).trim() : '');
      compactSuffix = (
        formattedTag.length > 0 ? formattedTag : `#${firstTag.tag}`
      ).slice(0, 22);
    } else {
      compactSuffix = (cluster.defaultLabel || cluster.code).slice(0, 22);
    }
  }

  let resolvedTitle = isIntermediate ? compactSuffix : cluster.defaultLabel;
  if (badgeOptions?.formatTitle) {
    resolvedTitle = badgeOptions.formatTitle(resolvedTitle, { variant, cluster });
  }
  if (
    badgeOptions?.maxTitleChars !== undefined &&
    Number.isFinite(badgeOptions.maxTitleChars) &&
    badgeOptions.maxTitleChars > 0
  ) {
    resolvedTitle = truncateBadgeTitle(resolvedTitle, badgeOptions.maxTitleChars);
  }
  resolvedTitle = resolvedTitle.trim();

  if (isIntermediate) {
    const parentCtx = (cluster.parentContextLabel ?? '').trim();
    const hasParentCtx = parentCtx.length > 0;
    const mainText = resolvedTitle || cluster.code;
    if (hasParentCtx) {
      const upperParent = parentCtx.toUpperCase();
      const topW = measureText({
        text: upperParent,
        fontSize: 7.4,
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: 700,
        letterSpacingEm: 0.05,
      });
      const botW = measureText({
        text: mainText,
        fontSize: 9.3,
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontWeight: 700,
      });
      const width = Math.max(66, Math.round(Math.max(topW, botW) + 28));
      return {
        variant: 'intermediate',
        hasParentCtx: true,
        showCode: false,
        code: cluster.code,
        upperParent,
        title: mainText,
        metaLine: '',
        codeSpan: 0,
        headerContentW: botW,
        width,
        height: 32,
        cut: 6.4,
        haloPad: 2.5,
      };
    }

    const contentW = measureText({
      text: mainText,
      fontSize: 9.1,
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      fontWeight: 700,
    });
    const width = Math.max(52, Math.round(contentW + 26));
    return {
      variant: 'intermediate',
      hasParentCtx: false,
      showCode: false,
      code: cluster.code,
      upperParent: '',
      title: mainText,
      metaLine: '',
      codeSpan: 0,
      headerContentW: contentW,
      width,
      height: 22,
      cut: 5.5,
      haloPad: 2.4,
    };
  }

  const count = cluster.members.length;
  const metaLine = `${count} ${count === 1 ? 'item' : 'items'}`;
  const showCode =
    (badgeOptions?.showCode ?? true) && cluster.code.trim().length > 0;
  const codeTextW = showCode
    ? measureText({
        text: cluster.code,
        fontSize: 9.8,
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: 600,
      })
    : 0;
  const codeSpan = showCode ? Math.max(20, codeTextW + 7) : 0;
  const titleTextW = measureText({
    text: resolvedTitle,
    fontSize: 11,
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontWeight: 700,
    letterSpacingEm: 0.01,
  });
  const headerContentW = codeSpan + titleTextW;
  const metaW = measureText({
    text: metaLine,
    fontSize: 9.3,
    fontFamily: 'IBM Plex Mono, monospace',
    fontWeight: 400,
  });
  const minPrimaryWidth = showCode ? 126 : 96;
  const padX = showCode ? 36 : 32;
  const width = Math.max(
    minPrimaryWidth,
    Math.round(Math.max(headerContentW + padX, metaW + padX)),
  );
  return {
    variant: 'primary',
    hasParentCtx: false,
    showCode,
    code: cluster.code,
    upperParent: '',
    title: resolvedTitle,
    metaLine,
    codeSpan,
    headerContentW,
    width,
    height: 42,
    cut: 0,
    haloPad: 2.8,
  };
}

/**
 * Builds deterministic, DOM-free convex hull measurers matching the built-in
 * `@simplex-viz/svg` presets (`'geometric'`, `'glyphs'`, `'badges'`).
 *
 * Useful both internally by `renderSimplexSvgString()` and directly with
 * `solveSimplexSnapshot(items, { ...createSsrPresetHullMeasurers(...) })`.
 */
export function createSsrPresetHullMeasurers<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(options: {
  readonly preset?: SimplexVisualPreset;
  readonly formatTagLabel?: (tag: string) => string;
  readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  readonly shapeOptions?: GeometricShapeSvgViewOptions;
  readonly measureText?: SsrMeasureTextFn;
} = {}): {
  readonly measureClusterHull: (
    cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  ) => ConvexGeometry;
  readonly measureContentHull: (
    item: TItem,
    ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
  ) => ConvexGeometry;
} {
  const preset = options.preset ?? 'geometric';
  const measureText = options.measureText ?? estimateSsrTextWidth;

  const measureClusterHull = (
    cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  ): ConvexGeometry => {
    if (preset === 'badges') {
      const geom = resolveSsrBadgeGeometry(cluster, {
        formatTagLabel: options.formatTagLabel,
        badgeOptions: options.badgeOptions,
        measureText,
      });
      const halfW = geom.width / 2 + geom.haloPad + 1.5;
      const halfH = geom.height / 2 + geom.haloPad + 1.5;
      if (geom.variant === 'intermediate') {
        const c = geom.cut + 1.1;
        return {
          kind: 'polygon',
          vertices: computeConvexHull([
            { x: -halfW + c, y: -halfH },
            { x: halfW - c, y: -halfH },
            { x: halfW, y: 0 },
            { x: halfW - c, y: halfH },
            { x: -halfW + c, y: halfH },
            { x: -halfW, y: 0 },
          ]),
        };
      }
      return rectToConvexPolygon(halfW * 2, halfH * 2);
    }

    if (cluster.role === 'intermediate') {
      const hasParent = Boolean(cluster.parentContextLabel?.trim());
      const compactR = Math.max(
        hasParent ? 15 : 13,
        Math.round(22 * (hasParent ? 0.76 : 0.66)),
      );
      return { kind: 'circle', radius: compactR + 4.5 };
    }
    return { kind: 'circle', radius: 22 + 5 };
  };

  const measureContentHull = (
    item: TItem,
    ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
  ): ConvexGeometry => {
    if (preset === 'glyphs') {
      return { kind: 'circle', radius: 11.5 + 2 };
    }
    const baseStrokeWidth =
      options.shapeOptions?.strokeWidth !== undefined &&
      Number.isFinite(options.shapeOptions.strokeWidth)
        ? Math.max(0, options.shapeOptions.strokeWidth)
        : 1.4;
    const resolved = resolveSsrContentShape(
      item,
      ctx,
      options.getShape,
      options.shapeOptions,
    );
    const r = resolved.radius + baseStrokeWidth;
    if (resolved.kind === 'circle') {
      return { kind: 'circle', radius: r };
    }
    if (resolved.kind === 'diamond') {
      const d = r * 1.12;
      return {
        kind: 'polygon',
        vertices: computeConvexHull([
          { x: 0, y: -d },
          { x: d * 0.88, y: 0 },
          { x: 0, y: d },
          { x: -d * 0.88, y: 0 },
        ]),
      };
    }
    if (resolved.kind === 'polygon') {
      return regularPolygon(
        resolved.sides ?? 6,
        r * resolved.radiusScale,
        resolved.rotationRad,
      );
    }
    return starConvexHull(5, r * 1.24);
  };

  return { measureClusterHull, measureContentHull };
}

function renderDefaultTriangleMarkup<TItem, TTagMeta, TClusterMeta>(
  triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
  theme: SimplexTheme,
): string {
  const pts = triangle.points
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const fillOpacity = Math.max(0.01, Math.min(0.8, triangle.fillOpacity || 0.09));
  const stroke = theme === 'light' ? '#0f172a' : '#e2e8f0';
  return `<polygon points="${pts}" fill="${escapeXml(triangle.fillHex)}" fill-opacity="${fillOpacity.toFixed(3)}" stroke="${stroke}" stroke-width="0.5" stroke-opacity="0.06"/>`;
}

function renderDefaultEdgeMarkup<TItem, TTagMeta, TClusterMeta>(
  edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
  theme: SimplexTheme,
): string {
  const stroke = theme === 'light' ? '#475569' : '#94a3b8';
  return `<line x1="${edge.a.x.toFixed(2)}" y1="${edge.a.y.toFixed(2)}" x2="${edge.b.x.toFixed(2)}" y2="${edge.b.y.toFixed(2)}" stroke="${stroke}" stroke-width="1.00" stroke-opacity="0.28" stroke-dasharray="3 4"/>`;
}

function renderDefaultClusterMarkup<TItem, TTagMeta, TClusterMeta>(
  node: SnapshotClusterNode<TItem, TTagMeta, TClusterMeta>,
  preset: SimplexVisualPreset,
  theme: SimplexTheme,
  options: {
    readonly formatTagLabel?: (tag: string) => string;
    readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
    readonly measureText: SsrMeasureTextFn;
  },
): string {
  const cluster = node.cluster;
  const isLight = theme === 'light';
  const palette = resolveClusterSurfaceColors(cluster.colorHex, theme);

  if (preset === 'badges') {
    const geom = resolveSsrBadgeGeometry(cluster, options);
    const halfW = geom.width / 2;
    const halfH = geom.height / 2;

    if (geom.variant === 'intermediate') {
      const chamferPath = (hw: number, hh: number, c: number, dy = 0): string =>
        [
          `M ${(-hw + c).toFixed(1)} ${(-hh + dy).toFixed(1)}`,
          `L ${(hw - c).toFixed(1)} ${(-hh + dy).toFixed(1)}`,
          `L ${hw.toFixed(1)} ${dy.toFixed(1)}`,
          `L ${(hw - c).toFixed(1)} ${(hh + dy).toFixed(1)}`,
          `L ${(-hw + c).toFixed(1)} ${(hh + dy).toFixed(1)}`,
          `L ${(-hw).toFixed(1)} ${dy.toFixed(1)}`,
          'Z',
        ].join(' ');
      const chamferPoints = (hw: number, hh: number, c: number): string =>
        [
          `${(-hw + c).toFixed(1)},${(-hh).toFixed(1)}`,
          `${(hw - c).toFixed(1)},${(-hh).toFixed(1)}`,
          `${hw.toFixed(1)},0`,
          `${(hw - c).toFixed(1)},${hh.toFixed(1)}`,
          `${(-hw + c).toFixed(1)},${hh.toFixed(1)}`,
          `${(-hw).toFixed(1)},0`,
        ].join(' ');

      const shadowOp = isLight ? '0.16' : '0.44';
      const haloOp = isLight ? '0.56' : '0.7';
      const parts = [
        `<path d="${chamferPath(halfW, halfH, geom.cut, 1.5)}" fill="#020617" fill-opacity="${shadowOp}"/>`,
        `<polygon points="${chamferPoints(halfW + geom.haloPad, halfH + geom.haloPad, geom.cut + 1.1)}" fill="none" stroke="${palette.haloHex}" stroke-width="1.25" stroke-opacity="${haloOp}" stroke-dasharray="3 2" stroke-linejoin="round"/>`,
        `<polygon points="${chamferPoints(halfW, halfH, geom.cut)}" fill="${palette.solidFillHex}" stroke="#ffffff" stroke-width="1.0" stroke-opacity="0.3" stroke-linejoin="round"/>`,
      ];
      if (geom.hasParentCtx) {
        parts.push(
          `<text x="0" y="-4.2" text-anchor="middle" fill="#ffffff" fill-opacity="0.78" font-size="7.4" font-weight="700" letter-spacing="0.05em" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeXml(geom.upperParent)}</text>`,
          `<text x="0" y="7.6" text-anchor="middle" fill="#ffffff" font-size="9.3" font-weight="700" font-family="Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif">${escapeXml(geom.title)}</text>`,
        );
      } else {
        parts.push(
          `<text x="0" y="3.3" text-anchor="middle" fill="#ffffff" font-size="9.1" font-weight="700" font-family="Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif">${escapeXml(geom.title)}</text>`,
        );
      }
      return parts.join('');
    }

    const rx = halfH;
    const shadowPath = roundedRectSvgPath(-halfW, -halfH + 1.8, geom.width, geom.height, rx);
    const haloPath = roundedRectSvgPath(
      -halfW - geom.haloPad,
      -halfH - geom.haloPad,
      geom.width + geom.haloPad * 2,
      geom.height + geom.haloPad * 2,
      rx + geom.haloPad,
    );
    const parts = [
      `<path d="${shadowPath}" fill="#020617" fill-opacity="${isLight ? '0.16' : '0.45'}"/>`,
      `<path d="${haloPath}" fill="none" stroke="${palette.haloHex}" stroke-width="1.25" stroke-opacity="${isLight ? '0.48' : '0.64'}"/>`,
      `<rect x="${fmt(-halfW)}" y="${fmt(-halfH)}" width="${fmt(geom.width)}" height="${fmt(geom.height)}" rx="${fmt(rx)}" fill="${palette.solidFillHex}" stroke="#ffffff" stroke-width="1.0" stroke-opacity="0.28"/>`,
    ];
    if (geom.showCode) {
      const startX = -geom.headerContentW / 2;
      parts.push(
        `<text x="${Math.round(startX)}" y="-3" fill="#ffffff" fill-opacity="0.86" font-size="9.8" font-weight="600" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeXml(geom.code)}</text>`,
        `<text x="${Math.round(startX + geom.codeSpan)}" y="-3" fill="#ffffff" font-size="11" font-weight="700" letter-spacing="0.01em" font-family="Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif">${escapeXml(geom.title)}</text>`,
      );
    } else {
      parts.push(
        `<text x="0" y="-3" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="700" letter-spacing="0.01em" font-family="Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif">${escapeXml(geom.title)}</text>`,
      );
    }
    parts.push(
      `<text x="0" y="12.5" text-anchor="middle" fill="#ffffff" fill-opacity="0.84" font-size="9.3" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeXml(geom.metaLine)}</text>`,
    );
    return parts.join('');
  }

  // ClusterAnchorSvgView-equivalent ('geometric' and 'glyphs')
  const r = 22;
  if (cluster.role === 'intermediate') {
    const parentCtx = (cluster.parentContextLabel ?? '').trim();
    const hasParent = parentCtx.length > 0;
    const octR = Math.max(hasParent ? 15 : 13, Math.round(r * (hasParent ? 0.76 : 0.66)));
    const octagonPts = (rad: number, dy = 0): string => {
      const d = rad * 0.7071;
      return [
        `0,${(-rad + dy).toFixed(1)}`,
        `${d.toFixed(1)},${(-d + dy).toFixed(1)}`,
        `${rad.toFixed(1)},${dy.toFixed(1)}`,
        `${d.toFixed(1)},${(d + dy).toFixed(1)}`,
        `0,${(rad + dy).toFixed(1)}`,
        `${(-d).toFixed(1)},${(d + dy).toFixed(1)}`,
        `${(-rad).toFixed(1)},${dy.toFixed(1)}`,
        `${(-d).toFixed(1)},${(-d + dy).toFixed(1)}`,
      ].join(' ');
    };
    const parts = [
      `<polygon points="${octagonPts(octR + 2.8)}" fill="none" stroke="${palette.haloHex}" stroke-width="1.25" stroke-opacity="${isLight ? '0.56' : '0.7'}" stroke-dasharray="3 2" stroke-linejoin="round"/>`,
      `<polygon points="${octagonPts(octR, 1.4)}" fill="#020617" fill-opacity="${isLight ? '0.15' : '0.42'}"/>`,
      `<polygon points="${octagonPts(octR)}" fill="${palette.solidFillHex}" stroke="#ffffff" stroke-width="1.0" stroke-opacity="0.28" stroke-linejoin="round"/>`,
    ];
    if (hasParent) {
      parts.push(
        `<text x="0" y="-2.4" text-anchor="middle" fill="#ffffff" fill-opacity="0.8" font-size="6.6" font-weight="700" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeXml(parentCtx.slice(0, 6).toUpperCase())}</text>`,
        `<text x="0" y="6.8" text-anchor="middle" fill="#ffffff" font-size="7.8" font-weight="700" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeXml(cluster.code)}</text>`,
      );
    } else {
      parts.push(
        `<text x="0" y="2.9" text-anchor="middle" fill="#ffffff" font-size="${cluster.code.length > 5 ? '7.4' : '8.5'}" font-weight="700" letter-spacing="0.01em" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeXml(cluster.code)}</text>`,
      );
    }
    return parts.join('');
  }

  return [
    `<circle cx="0" cy="0" r="${(r + 3.2).toFixed(1)}" fill="none" stroke="${palette.haloHex}" stroke-width="1.45" stroke-opacity="${isLight ? '0.58' : '0.72'}" stroke-dasharray="4 2.5"/>`,
    `<circle cx="0" cy="1.6" r="${r - 1}" fill="#020617" fill-opacity="${isLight ? '0.16' : '0.45'}"/>`,
    `<circle cx="0" cy="0" r="${r - 1}" fill="${palette.solidFillHex}" stroke="#ffffff" stroke-width="1.0" stroke-opacity="0.28"/>`,
    `<text x="0" y="-2" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="700" letter-spacing="0.01em" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeXml(cluster.code)}</text>`,
    `<text x="0" y="10.5" text-anchor="middle" fill="#ffffff" fill-opacity="0.86" font-size="8.8" font-weight="600" font-family="IBM Plex Mono, ui-monospace, monospace">${cluster.members.length}n</text>`,
  ].join('');
}

function describeDonutSectorPath(
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 1e-4) {
    return [
      `M ${outerR} 0`,
      `A ${outerR} ${outerR} 0 1 0 ${-outerR} 0`,
      `A ${outerR} ${outerR} 0 1 0 ${outerR} 0`,
      `M ${innerR} 0`,
      `A ${innerR} ${innerR} 0 1 1 ${-innerR} 0`,
      `A ${innerR} ${innerR} 0 1 1 ${innerR} 0`,
      'Z',
    ].join(' ');
  }
  const largeArc = sweep > Math.PI ? 1 : 0;
  const x1o = Math.cos(startAngle) * outerR;
  const y1o = Math.sin(startAngle) * outerR;
  const x2o = Math.cos(endAngle) * outerR;
  const y2o = Math.sin(endAngle) * outerR;
  const x1i = Math.cos(endAngle) * innerR;
  const y1i = Math.sin(endAngle) * innerR;
  const x2i = Math.cos(startAngle) * innerR;
  const y2i = Math.sin(startAngle) * innerR;

  return [
    `M ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
    `A ${outerR.toFixed(2)} ${outerR.toFixed(2)} 0 ${largeArc} 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}`,
    `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
    `A ${innerR.toFixed(2)} ${innerR.toFixed(2)} 0 ${largeArc} 0 ${x2i.toFixed(2)} ${y2i.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function renderDefaultContentMarkup<TItem, TTagMeta, TClusterMeta>(
  node: SnapshotContentNode<TItem, TTagMeta, TClusterMeta>,
  preset: SimplexVisualPreset,
  theme: SimplexTheme,
  isHighlighted: boolean,
  isSelected: boolean,
  options: {
    readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
    readonly shapeOptions?: GeometricShapeSvgViewOptions;
  },
): string {
  const isLight = theme === 'light';
  const accentRing = options.shapeOptions?.hoverRingColor ?? (isLight ? '#0891b2' : '#22d3ee');
  const selectionRing =
    options.shapeOptions?.selectionRingColor ?? (isLight ? '#7c3aed' : '#a78bfa');

  if (preset === 'glyphs') {
    const outerR = 11.5;
    const innerR = 4.5;
    const dividerStroke = isLight ? '#ffffff' : '#07090E';
    const sectors = node.layoutContext.unitClusters.map((uc) => ({
      colorHex: uc.cluster.colorHex,
      weight: uc.weight,
    }));
    const totalWeight = sectors.reduce((s, sec) => s + Math.max(0, sec.weight), 0) || 1;
    let angle = -Math.PI / 2;
    const parts: string[] = [];

    for (const sec of sectors) {
      const frac = Math.max(0, sec.weight) / totalWeight;
      if (frac <= 0.005) continue;
      const nextAngle = angle + frac * Math.PI * 2;
      parts.push(
        `<path d="${describeDonutSectorPath(innerR, outerR, angle, nextAngle)}" fill="${escapeXml(sec.colorHex)}" stroke="${dividerStroke}" stroke-width="${sectors.length > 1 ? '1.1' : '0.8'}"/>`,
      );
      angle = nextAngle;
    }
    parts.push(
      `<circle cx="0" cy="0" r="${Math.max(2, innerR - 1)}" fill="${escapeXml(node.colorHex)}"/>`,
    );
    if (isHighlighted) {
      parts.push(
        `<circle cx="0" cy="0" r="${outerR + 3}" fill="none" stroke="${escapeXml(accentRing)}" stroke-width="1.4" stroke-opacity="0.9"/>`,
      );
    }
    if (isSelected) {
      parts.push(
        `<circle class="sv-glyph-selection-ring" cx="0" cy="0" r="${outerR + (isHighlighted ? 6 : 3.8)}" fill="none" stroke="${escapeXml(selectionRing)}" stroke-width="2.1" stroke-opacity="0.96"/>`,
      );
    }
    return parts.join('');
  }

  const resolved = resolveSsrContentShape(
    node.item,
    node.layoutContext,
    options.getShape,
    options.shapeOptions,
  );
  const restStroke =
    options.shapeOptions?.strokeColor ?? (isLight ? '#ffffff' : '#07090E');
  const strokeWidth =
    options.shapeOptions?.strokeWidth !== undefined &&
    Number.isFinite(options.shapeOptions.strokeWidth)
      ? Math.max(0, options.shapeOptions.strokeWidth)
      : 1.4;
  const parts: string[] = [];
  if (isSelected) {
    parts.push(
      `<path class="sv-geom-selection-ring" d="${buildGeometricShapePath(resolved, resolved.radius + (isHighlighted ? 7.2 : 4.6))}" fill="none" stroke="${escapeXml(selectionRing)}" stroke-width="2.1" stroke-opacity="0.96"/>`,
    );
  }
  if (isHighlighted) {
    parts.push(
      `<path class="sv-geom-ring" d="${buildGeometricShapePath(resolved, resolved.radius + 4.5)}" fill="none" stroke="${escapeXml(accentRing)}" stroke-width="1.4" stroke-opacity="0.9"/>`,
    );
  }
  parts.push(
    `<path class="sv-geom-shape" d="${buildGeometricShapePath(resolved, resolved.radius)}" fill="${escapeXml(node.colorHex)}" stroke="${escapeXml(isSelected ? selectionRing : restStroke)}" stroke-width="${fmt(isSelected ? Math.max(2.2, strokeWidth) : strokeWidth)}"/>`,
  );
  return parts.join('');
}

function renderHullMarkup(
  x: number,
  y: number,
  scale: number,
  hull: ConvexGeometry,
  strokeColor: string,
): string {
  if (hull.kind === 'circle') {
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(hull.radius * scale).toFixed(2)}" fill="${strokeColor}" fill-opacity="0.07" stroke="${strokeColor}" stroke-width="1" stroke-dasharray="3 2"/>`;
  }
  if (hull.vertices.length >= 3) {
    const pts = hull.vertices
      .map((v) => `${(x + v.x * scale).toFixed(2)},${(y + v.y * scale).toFixed(2)}`)
      .join(' ');
    return `<polygon points="${pts}" fill="${strokeColor}" fill-opacity="0.07" stroke="${strokeColor}" stroke-width="1" stroke-dasharray="3 2"/>`;
  }
  return '';
}

/**
 * Pure Node.js / DOM-free headless SSR SVG string renderer.
 *
 * Accepts either a raw items array (solving a strictly overlap-free simplex layout via
 * `solveSimplexSnapshot()` with deterministic font-metrics hull estimation) or a pre-solved
 * `SimplexLayoutSnapshot`, and returns a self-contained `<svg>` string ready for Astro/Next.js SSR,
 * Markdown/PDF embedding, or direct rasterization via `@resvg/resvg-js` without Puppeteer.
 */
export function renderSimplexSvgString<
  TItem extends DefaultTaggedItem = DefaultTaggedItem,
>(
  items: readonly TItem[],
  options?: RenderSimplexSvgStringOptions<TItem, undefined, undefined>,
): string;
export function renderSimplexSvgString<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  items: readonly TItem[],
  options: RenderSimplexSvgStringOptions<TItem, TTagMeta, TClusterMeta>,
): string;
export function renderSimplexSvgString<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  snapshot: SimplexLayoutSnapshot<TItem, TTagMeta, TClusterMeta>,
  options?: RenderSimplexSnapshotSvgOptions<TItem, TTagMeta, TClusterMeta>,
): string;
export function renderSimplexSvgString<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  itemsOrSnapshot:
    | readonly TItem[]
    | SimplexLayoutSnapshot<TItem, TTagMeta, TClusterMeta>,
  options?:
    | Partial<RenderSimplexSvgStringOptions<TItem, TTagMeta, TClusterMeta>>
    | RenderSimplexSnapshotSvgOptions<TItem, TTagMeta, TClusterMeta>,
): string {
  const opts = (options ?? {}) as RenderSimplexSvgStringExtraOptions<
    TItem,
    TTagMeta,
    TClusterMeta
  > &
    Partial<SimplexSnapshotOptions<TItem, TTagMeta, TClusterMeta>>;

  const preset: SimplexVisualPreset = opts.preset ?? 'geometric';
  const theme: SimplexTheme = opts.theme ?? 'dark';
  const measureText: SsrMeasureTextFn = opts.measureText ?? estimateSsrTextWidth;

  let snapshot: SimplexLayoutSnapshot<TItem, TTagMeta, TClusterMeta>;
  if (isSnapshotInput(itemsOrSnapshot)) {
    snapshot = itemsOrSnapshot;
  } else {
    const presetMeasurers = createSsrPresetHullMeasurers<TItem, TTagMeta, TClusterMeta>({
      preset,
      formatTagLabel: opts.formatTagLabel,
      badgeOptions: opts.badgeOptions,
      getShape: opts.getShape,
      shapeOptions: opts.shapeOptions,
      measureText,
    });
    snapshot = solveSimplexSnapshot<TItem, TTagMeta, TClusterMeta>(
      itemsOrSnapshot,
      {
        ...(opts as SimplexSnapshotOptions<TItem, TTagMeta, TClusterMeta>),
        theme,
        measureClusterHull: opts.measureClusterHull ?? presetMeasurers.measureClusterHull,
        measureContentHull: opts.measureContentHull ?? presetMeasurers.measureContentHull,
      },
    );
  }

  const padding =
    opts.padding !== undefined && Number.isFinite(opts.padding) && opts.padding > 0
      ? opts.padding
      : 0;

  let vbX = -padding;
  let vbY = -padding;
  let vbW = snapshot.width + padding * 2;
  let vbH = snapshot.height + padding * 2;

  const hasExplicitW =
    isSnapshotInput(itemsOrSnapshot) &&
    opts.width !== undefined &&
    Number.isFinite(opts.width) &&
    opts.width > 0;
  const hasExplicitH =
    isSnapshotInput(itemsOrSnapshot) &&
    opts.height !== undefined &&
    Number.isFinite(opts.height) &&
    opts.height > 0;

  let outW: number;
  let outH: number;
  if (hasExplicitW && hasExplicitH) {
    outW = opts.width!;
    outH = opts.height!;
    const targetAspect = outW / outH;
    const srcAspect = vbW / vbH;
    if (Math.abs(targetAspect - srcAspect) > 1e-4) {
      if (targetAspect > srcAspect) {
        const expandedW = vbH * targetAspect;
        vbX -= (expandedW - vbW) / 2;
        vbW = expandedW;
      } else {
        const expandedH = vbW / targetAspect;
        vbY -= (expandedH - vbH) / 2;
        vbH = expandedH;
      }
    }
  } else if (hasExplicitW) {
    outW = opts.width!;
    outH = (outW * vbH) / vbW;
  } else if (hasExplicitH) {
    outH = opts.height!;
    outW = (outH * vbW) / vbH;
  } else {
    outW = vbW;
    outH = vbH;
  }

  const highlightedSet =
    opts.highlightedIds != null ? new Set(opts.highlightedIds) : null;
  const hasHighlights = highlightedSet !== null && highlightedSet.size > 0;
  const selectedSet =
    opts.selectedIds != null ? new Set(opts.selectedIds) : null;
  const itemFilter = opts.itemFilter ?? null;
  const itemFilterMode: ItemFilterMode = opts.itemFilterMode ?? 'dim';
  const dimmedFactor =
    opts.shapeOptions?.dimmedOpacity !== undefined &&
    Number.isFinite(opts.shapeOptions.dimmedOpacity)
      ? Math.max(0, Math.min(1, opts.shapeOptions.dimmedOpacity))
      : 0.34;

  // 1. Mesh triangles
  const trianglesSvg = snapshot.triangles
    .map((tr) => {
      const defaultMarkup = renderDefaultTriangleMarkup(tr, theme);
      const inner = opts.renderTriangle
        ? opts.renderTriangle({ triangle: tr, theme, defaultMarkup })
        : defaultMarkup;
      return `<g class="sv-mesh-triangle" data-triangle-index="${tr.index}" data-covered-items="${tr.coveredItemCount}">${inner}</g>`;
    })
    .join('');

  // 2. Mesh edges
  const edgesSvg = snapshot.edges
    .map((edge) => {
      const defaultMarkup = renderDefaultEdgeMarkup(edge, theme);
      const inner = opts.renderEdge
        ? opts.renderEdge({ edge, theme, defaultMarkup })
        : defaultMarkup;
      return `<g class="sv-mesh-edge" data-edge-index="${edge.index}">${inner}</g>`;
    })
    .join('');

  // 3. Clusters
  const clustersSvg = snapshot.clusters
    .map((node) => {
      const defaultMarkup = renderDefaultClusterMarkup(node, preset, theme, {
        formatTagLabel: opts.formatTagLabel,
        badgeOptions: opts.badgeOptions,
        measureText,
      });
      const inner = opts.renderCluster
        ? opts.renderCluster({ node, theme, preset, defaultMarkup })
        : defaultMarkup;
      return `<g class="sv-node sv-node-cluster" data-node-id="${escapeXml(node.id)}" transform="translate(${node.x.toFixed(2)}, ${node.y.toFixed(2)}) scale(${node.scale.toFixed(4)})">${inner}</g>`;
    })
    .join('');

  // 4. Content items
  const itemsParts: string[] = [];
  for (const node of snapshot.items) {
    const passesFilter =
      itemFilter === null ? true : Boolean(itemFilter(node.item));
    if (!passesFilter && itemFilterMode === 'hide') {
      continue;
    }
    const isHighlighted = hasHighlights && highlightedSet!.has(node.id);
    const isSelected = selectedSet !== null && selectedSet.has(node.id);
    const isDimmed =
      !passesFilter || (hasHighlights && !isHighlighted && !isSelected);
    const opacityAttr = isDimmed ? ` opacity="${dimmedFactor.toFixed(3)}"` : '';
    const filteredAttr = !passesFilter ? ' data-filtered-out="true"' : '';
    const selectedAttr = isSelected ? ' data-selected="true"' : '';
    const defaultMarkup = renderDefaultContentMarkup(
      node,
      preset,
      theme,
      isHighlighted,
      isSelected,
      {
        getShape: opts.getShape,
        shapeOptions: opts.shapeOptions,
      },
    );
    const inner = opts.renderContent
      ? opts.renderContent({
          node,
          theme,
          preset,
          isHighlighted,
          isSelected,
          isDimmed,
          defaultMarkup,
        })
      : defaultMarkup;
    itemsParts.push(
      `<g class="sv-node sv-node-item" data-node-id="${escapeXml(node.id)}"${filteredAttr}${selectedAttr} transform="translate(${node.x.toFixed(2)}, ${node.y.toFixed(2)}) scale(${node.scale.toFixed(4)})"${opacityAttr}>${inner}</g>`,
    );
  }
  const itemsSvg = itemsParts.join('');

  // 5. Optional debug hull overlay
  let hullsSvg = '';
  if (opts.showHulls === true) {
    const clusterStroke = theme === 'light' ? '#0284c7' : '#38bdf8';
    const itemStroke = theme === 'light' ? '#d97706' : '#fbbf24';
    const hullParts: string[] = [];
    for (const c of snapshot.clusters) {
      hullParts.push(renderHullMarkup(c.x, c.y, c.scale, c.hull, clusterStroke));
    }
    for (const it of snapshot.items) {
      hullParts.push(renderHullMarkup(it.x, it.y, it.scale, it.hull, itemStroke));
    }
    hullsSvg = `<g class="sv-hull-overlay" pointer-events="none">${hullParts.join('')}</g>`;
  }

  const rootAttrs: string[] = [
    `xmlns="${SVG_NS}"`,
    `viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}"`,
    `width="${fmt(outW)}"`,
    `height="${fmt(outH)}"`,
    `data-theme="${theme}"`,
    `data-preset="${preset}"`,
  ];
  const rootClass = opts.className?.trim()
    ? `sv-ssr-root ${opts.className.trim()}`
    : 'sv-ssr-root';
  rootAttrs.push(`class="${escapeXml(rootClass)}"`);
  if (opts.ariaLabel?.trim()) {
    rootAttrs.push(`role="img"`, `aria-label="${escapeXml(opts.ariaLabel.trim())}"`);
  }

  const sections: string[] = [];
  if (opts.title?.trim()) {
    sections.push(`<title>${escapeXml(opts.title.trim())}</title>`);
  }
  if (opts.includeEmbeddedStyles !== false) {
    sections.push(
      `<style>.sv-ssr-root{shape-rendering:geometricPrecision;text-rendering:geometricPrecision;}.sv-ssr-root text{user-select:none;}</style>`,
    );
  }
  if (opts.includeBackground !== false) {
    const bgFill = opts.backgroundColor?.trim() || resolveSsrBackgroundColor(theme);
    sections.push(
      `<rect class="sv-export-background" x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="${escapeXml(bgFill)}"/>`,
    );
  }
  sections.push(
    `<g class="sv-world">`,
    `<g class="sv-mesh-triangles">${trianglesSvg}</g>`,
    `<g class="sv-mesh-edges" aria-hidden="true">${edgesSvg}</g>`,
    `<g class="sv-clusters">${clustersSvg}</g>`,
    `<g class="sv-items">${itemsSvg}</g>`,
    hullsSvg,
    `</g>`,
  );

  const svg = `<svg ${rootAttrs.join(' ')}>${sections.join('')}</svg>`;
  return opts.xmlDeclaration === true
    ? `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`
    : svg;
}
