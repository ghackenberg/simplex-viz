import { computeConvexHull, regularPolygon, starConvexHull } from './geometry.js';
import { hexToOklab, oklabToHex } from './oklab.js';
import type { FinalSeededLayoutScaleMode, SimplexColorTheme } from './strategies.js';
import type { SimplexTimelineState } from './timeline.js';
import type {
  ClusterDescriptor,
  ConvexGeometry,
  DefaultTaggedItem,
  EmptyClusterBehavior,
  LayoutSolverOptions,
  MeshOptions,
  Point2D,
} from './types.js';

// ============================================================================
// Item Label & Cluster Badge Title Helpers
// ============================================================================

/**
 * Safely extracts a human-readable display label from an arbitrary domain item
 * (`getLabel(item)` -> `.label` -> `.title` -> `.headline` -> `.name` -> `fallbackId`).
 */
export function extractSimplexItemLabel<TItem>(
  item: TItem,
  fallbackId: string,
  getLabel?: (item: TItem) => string,
): string {
  if (getLabel) {
    const custom = getLabel(item);
    if (custom.length > 0) return custom;
  }
  if (typeof item === 'object' && item !== null) {
    if ('label' in item && typeof item.label === 'string' && item.label.length > 0) {
      return item.label;
    }
    if ('title' in item && typeof item.title === 'string' && item.title.length > 0) {
      return item.title;
    }
    if ('headline' in item && typeof item.headline === 'string' && item.headline.length > 0) {
      return item.headline;
    }
    if ('name' in item && typeof item.name === 'string' && item.name.length > 0) {
      return item.name;
    }
  }
  return fallbackId;
}

/**
 * Cleanly truncates a cluster badge title to at most `maxChars` characters,
 * preferring word or separator boundaries (` `, `-`, `/`, `·`) before falling
 * back to a hard cut with `…`.
 */
export function truncateSimplexBadgeTitle(text: string, maxChars?: number): string {
  if (maxChars === undefined || !Number.isFinite(maxChars) || maxChars <= 0) {
    return text;
  }
  const clean = text.trim();
  const limit = Math.max(1, Math.floor(maxChars));
  if (clean.length <= limit) return clean;
  if (limit === 1) return '…';

  const slice = clean.slice(0, limit - 1);
  if (limit >= 6) {
    const minBoundaryIdx = Math.floor((limit - 1) * 0.55);
    let bestBoundary = -1;
    for (let i = slice.length - 1; i >= minBoundaryIdx; i--) {
      const ch = slice[i]!;
      if (ch === ' ' || ch === '-' || ch === '/' || ch === '·') {
        bestBoundary = i;
        break;
      }
    }
    if (bestBoundary > 0) {
      const trimmed = slice.slice(0, bestBoundary).replace(/[\s\-/·]+$/, '');
      if (trimmed.length > 0) {
        return `${trimmed}…`;
      }
    }
  }

  return `${slice.replace(/[\s\-/·]+$/, '').trimEnd() || slice}…`;
}

export interface SimplexBadgeTitleOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly maxTitleChars?: number;
  readonly formatTitle?: (
    title: string,
    context: {
      readonly variant: 'primary' | 'intermediate';
      readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
    },
  ) => string;
}

/**
 * Resolves the formatted and optionally truncated badge title for primary and
 * intermediate zoom clusters across SVG, SSR, and Canvas presets.
 */
export function resolveClusterBadgeTitle<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  options?: {
    readonly formatTagLabel?: (tag: string) => string;
    readonly badgeOptions?: SimplexBadgeTitleOptions<TItem, TTagMeta, TClusterMeta>;
    readonly maxIntermediateLength?: number;
  },
): string {
  const isIntermediate = cluster.role === 'intermediate';
  const variant: 'primary' | 'intermediate' = isIntermediate ? 'intermediate' : 'primary';
  const maxIntLen = options?.maxIntermediateLength ?? 24;

  let rawTitle: string;
  if (isIntermediate) {
    if (cluster.subclusterLabel) {
      rawTitle = cluster.subclusterLabel.slice(0, maxIntLen);
    } else if (cluster.coreTags.length > 0) {
      const firstTag = cluster.coreTags[0]!;
      const formattedTag =
        firstTag.label ??
        (options?.formatTagLabel ? options.formatTagLabel(firstTag.tag).trim() : '');
      rawTitle = (
        formattedTag.length > 0 ? formattedTag : `#${firstTag.tag}`
      ).slice(0, Math.min(22, maxIntLen));
    } else {
      rawTitle = (cluster.defaultLabel || cluster.code).slice(0, Math.min(22, maxIntLen));
    }
  } else {
    rawTitle = cluster.defaultLabel;
  }

  const formatted = options?.badgeOptions?.formatTitle
    ? options.badgeOptions.formatTitle(rawTitle, { variant, cluster })
    : rawTitle;
  return truncateSimplexBadgeTitle(formatted, options?.badgeOptions?.maxTitleChars);
}

// ============================================================================
// Geometric Shape Spec Normalization
// ============================================================================

export type GeometricShapeKind =
  | 'circle'
  | 'triangle'
  | 'square'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  | 'star'
  | 'polygon';

/**
 * Concise shape specification accepted across SVG and Canvas presets.
 * Accepts a named `GeometricShapeKind`, a regular N-gon side count (`>= 3`),
 * or a structured descriptor with optional `sides`, `rotationRad`, and `radius`.
 */
export type GeometricShapeSpec =
  | GeometricShapeKind
  | number
  | {
      readonly shape?: GeometricShapeKind;
      /** Number of sides (`>= 3`) for a regular convex N-gon. */
      readonly sides?: number;
      /** Optional vertex rotation angle in radians. */
      readonly rotationRad?: number;
      /** Optional radius override in pixels. */
      readonly radius?: number;
    };

export const NAMED_POLYGON_SIDES: Readonly<Record<string, number>> = {
  triangle: 3,
  square: 4,
  pentagon: 5,
  hexagon: 6,
  heptagon: 7,
  octagon: 8,
};

/**
 * Normalizes a flexible `GeometricShapeSpec` (named kind, side count `N >= 3`, or descriptor object)
 * into explicit `shape`, `sides`, `rotationRad`, and optional `radius` fields.
 */
export function resolveGeometricShapeSpec(spec: GeometricShapeSpec): {
  readonly shape: GeometricShapeKind;
  readonly sides?: number;
  readonly rotationRad?: number;
  readonly radius?: number;
} {
  if (typeof spec === 'number') {
    const sides = Math.max(3, Math.round(spec));
    return {
      shape: 'polygon',
      sides,
      rotationRad: sides === 4 ? -Math.PI / 4 : -Math.PI / 2,
    };
  }
  if (typeof spec === 'string') {
    const namedSides = NAMED_POLYGON_SIDES[spec];
    if (namedSides !== undefined) {
      return {
        shape: spec,
        sides: namedSides,
        rotationRad: spec === 'square' ? -Math.PI / 4 : -Math.PI / 2,
      };
    }
    return { shape: spec };
  }
  if (spec.sides !== undefined && Number.isFinite(spec.sides)) {
    const sides = Math.max(3, Math.round(spec.sides));
    const defaultRot =
      spec.shape === 'square' || (spec.shape === undefined && sides === 4)
        ? -Math.PI / 4
        : -Math.PI / 2;
    return {
      shape: spec.shape ?? 'polygon',
      sides,
      rotationRad: spec.rotationRad ?? defaultRot,
      radius: spec.radius,
    };
  }
  const shape = spec.shape ?? 'circle';
  const namedSides = NAMED_POLYGON_SIDES[shape];
  return {
    shape,
    sides: namedSides,
    rotationRad:
      spec.rotationRad ??
      (shape === 'square' ? -Math.PI / 4 : namedSides !== undefined ? -Math.PI / 2 : undefined),
    radius: spec.radius,
  };
}

// ============================================================================
// OKLab Cluster Surface Palettes & Color Helpers
// ============================================================================

export interface ClusterSurfacePalette {
  /** Saturated OKLab-calibrated background hex guaranteed >= 4.85:1 WCAG AA contrast with `#ffffff` text. */
  readonly solidFillHex: string;
  /** Luminous (dark theme) or crisp (light theme) outer docking halo ring hex preserving cluster hue. */
  readonly haloHex: string;
  /** Soft ~20–24% hue-tinted background hex for intermediate `1:4` sub-cluster bridge plaques. */
  readonly intermediateFillHex: string;
  /** Calibrated border hex for intermediate `1:4` sub-cluster bridge plaques. */
  readonly intermediateStrokeHex: string;
}

const PALETTE_CACHE = new Map<string, ClusterSurfacePalette>();

function srgbChannelToLinear(byteVal: number): number {
  const c = Math.max(0, Math.min(255, byteVal)) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Computes WCAG 2.1 relative luminance Y in `[0, 1]` for a `#rrggbb` hex string.
 */
export function getHexRelativeLuminance(hex: string): number {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length < 6) return 0.12;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0.12;
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * Derives a perceptual OKLab surface palette for cluster landmarks with WCAG AA contrast.
 */
export function resolveClusterSurfaceColors(
  colorHex: string,
  theme: 'dark' | 'light' = 'dark',
): ClusterSurfacePalette {
  const cacheKey = `${theme}:${colorHex}`;
  const cached = PALETTE_CACHE.get(cacheKey);
  if (cached) return cached;

  const [L, a, b] = hexToOklab(colorHex);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);

  const solidChroma =
    chroma > 0.012 ? Math.min(0.175, Math.max(chroma * 1.05, 0.118)) : chroma;
  let curL = Math.max(0.43, Math.min(L, theme === 'light' ? 0.54 : 0.56));
  let solidFillHex = oklabToHex([
    curL,
    solidChroma * Math.cos(hue),
    solidChroma * Math.sin(hue),
  ]);

  // Step down OKLab lightness until relative luminance <= 0.165 (WCAG contrast >= 4.88:1 vs #ffffff)
  while (getHexRelativeLuminance(solidFillHex) > 0.165 && curL > 0.28) {
    curL -= 0.014;
    solidFillHex = oklabToHex([
      curL,
      solidChroma * Math.cos(hue),
      solidChroma * Math.sin(hue),
    ]);
  }

  const haloL =
    theme === 'light' ? Math.min(Math.max(L, 0.46), 0.58) : Math.max(L, 0.7);
  const haloChroma = chroma > 0.012 ? Math.max(chroma, 0.13) : chroma;
  const haloHex = oklabToHex([
    haloL,
    haloChroma * Math.cos(hue),
    haloChroma * Math.sin(hue),
  ]);

  const intL = theme === 'light' ? 0.945 : 0.245;
  const intChroma = chroma * (theme === 'light' ? 0.24 : 0.3);
  const intermediateFillHex = oklabToHex([
    intL,
    intChroma * Math.cos(hue),
    intChroma * Math.sin(hue),
  ]);

  const intStrokeL =
    theme === 'light' ? Math.min(L, 0.54) : Math.max(L, 0.66);
  const intermediateStrokeHex = oklabToHex([
    intStrokeL,
    haloChroma * Math.cos(hue),
    haloChroma * Math.sin(hue),
  ]);

  const result: ClusterSurfacePalette = {
    solidFillHex,
    haloHex,
    intermediateFillHex,
    intermediateStrokeHex,
  };

  if (PALETTE_CACHE.size >= 512) {
    PALETTE_CACHE.clear();
  }
  PALETTE_CACHE.set(cacheKey, result);
  return result;
}

function parseHexRgbBytes(hex: string): readonly [number, number, number] | null {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    return Number.isNaN(r) ? null : [r, g, b];
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return Number.isNaN(r) ? null : [r, g, b];
  }
  return null;
}

/**
 * Converts a `#rgb` or `#rrggbb` hex color into an `rgba(r, g, b, alpha)` CSS string.
 */
export function hexWithAlpha(hex: string, alpha: number): string {
  const rgb = parseHexRgbBytes(hex);
  if (!rgb) return hex;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamped.toFixed(3)})`;
}

// ============================================================================
// Deterministic DOM-Free Text Width Estimator (Shared by SSR SVG & Canvas)
// ============================================================================

export interface SimplexTextMetricsInput {
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily?: string;
  readonly fontWeight?: number | string;
  readonly letterSpacingEm?: number;
}

const NARROW_CHARS = new Set([
  'i',
  'l',
  'I',
  'j',
  't',
  'f',
  'r',
  '1',
  '|',
  '.',
  ',',
  ';',
  ':',
  '!',
  "'",
  '`',
  ' ',
  '(',
  ')',
  '[',
  ']',
]);

const WIDE_CHARS = new Set(['W', 'M', 'w', 'm', '@', '%', '&', 'Q', 'O', 'G', 'D', 'H', 'N', 'U']);

function isFullWidthCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    code >= 0x1f300
  );
}

/**
 * Deterministic, DOM-free character-width estimator shared by SSR SVG layout and headless Canvas fallback.
 */
export function estimateSimplexTextWidth(input: SimplexTextMetricsInput): number {
  const { text, fontSize, fontFamily = '', fontWeight = 400, letterSpacingEm = 0 } = input;
  if (!text || fontSize <= 0) return 0;

  const isMono = /mono|courier|consolas|menlo|fira code|jetbrains/i.test(fontFamily);
  const numericWeight =
    typeof fontWeight === 'number'
      ? fontWeight
      : fontWeight === 'bold'
        ? 700
        : Number(fontWeight) || 400;
  const weightBoost = numericWeight >= 600 ? 1.04 : 1.0;

  let glyphUnits = 0;
  let count = 0;
  for (const ch of text) {
    count += 1;
    const code = ch.codePointAt(0) ?? 0;
    if (isFullWidthCodePoint(code)) {
      glyphUnits += 1.02;
    } else if (isMono) {
      glyphUnits += 0.61;
    } else if (NARROW_CHARS.has(ch)) {
      glyphUnits += 0.34;
    } else if (WIDE_CHARS.has(ch)) {
      glyphUnits += 0.78;
    } else if (ch >= 'A' && ch <= 'Z') {
      glyphUnits += 0.67;
    } else if (ch >= '0' && ch <= '9') {
      glyphUnits += 0.58;
    } else if (ch === '…') {
      glyphUnits += 0.78;
    } else {
      glyphUnits += 0.54;
    }
  }

  const spacingWidth =
    count > 1 && letterSpacingEm !== 0
      ? (count - 1) * letterSpacingEm * fontSize
      : 0;
  return glyphUnits * fontSize * weightBoost + spacingWidth;
}

// ============================================================================
// Timeline Listener Subscription Helper (Shared by SVG, Canvas & WC)
// ============================================================================

export interface SimplexTimelineNotifier<TItem = DefaultTaggedItem> {
  subscribe(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
    currentState: SimplexTimelineState<TItem> | null,
  ): () => void;
  notify(state: SimplexTimelineState<TItem> | null): void;
  clear(): void;
}

/**
 * Manages external `subscribeTimeline` listeners with immediate current-state
 * replay and safe unsubscribe cleanup across SVG, Canvas, and Web Component hosts.
 */
export function createSimplexTimelineNotifier<
  TItem = DefaultTaggedItem,
>(): SimplexTimelineNotifier<TItem> {
  const listeners = new Set<(state: SimplexTimelineState<TItem> | null) => void>();

  return {
    subscribe(listener, currentState) {
      listeners.add(listener);
      listener(currentState);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(state) {
      for (const listener of listeners) {
        listener(state);
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

// ============================================================================
// Shallow Option Equality Helpers (Shared by React & Host Option Sync)
// ============================================================================

export function areSimplexMeshOptionsEqual(
  a: MeshOptions | undefined,
  b: MeshOptions | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.innerPadding === b.innerPadding &&
    a.sideLength === b.sideLength &&
    a.minSideLength === b.minSideLength &&
    a.maxSideLength === b.maxSideLength &&
    a.maxClusters === b.maxClusters
  );
}

export function areSimplexLayoutOptionsEqual(
  a: LayoutSolverOptions | undefined,
  b: LayoutSolverOptions | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.clusterGapPx === b.clusterGapPx &&
    a.itemGapPx === b.itemGapPx &&
    a.minContentScale === b.minContentScale &&
    a.relaxationIterations === b.relaxationIterations &&
    a.sizeMultiplier === b.sizeMultiplier &&
    a.seed === b.seed
  );
}

export interface SimplexTimelineOptionComparisonLike {
  readonly showControls?: boolean;
  readonly position?: 'bottom' | 'top';
  readonly autoFinalSeed?: boolean;
  readonly autoFinalSeedLayout?: boolean | FinalSeededLayoutScaleMode;
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  readonly stepIntervalMs?: number;
  readonly speed?: number;
  readonly loop?: boolean;
  readonly autoPlay?: boolean;
  readonly initialStep?: number | 'start' | 'end';
  readonly includeEmptyStart?: boolean;
  readonly baselineLabel?: string;
  readonly emptyStartLabel?: string;
  readonly getTimestamp?: unknown;
  readonly getFrameKey?: unknown;
  readonly formatFrameLabel?: unknown;
  readonly formatStepLabel?: unknown;
  readonly compareFrameKeys?: unknown;
}

export function areSimplexTimelineOptionsEqual(
  a: boolean | SimplexTimelineOptionComparisonLike | undefined,
  b: boolean | SimplexTimelineOptionComparisonLike | undefined,
): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  return (
    a.showControls === b.showControls &&
    a.position === b.position &&
    a.autoFinalSeed === b.autoFinalSeed &&
    a.autoFinalSeedLayout === b.autoFinalSeedLayout &&
    a.emptyClusterBehavior === b.emptyClusterBehavior &&
    a.stepIntervalMs === b.stepIntervalMs &&
    a.speed === b.speed &&
    a.loop === b.loop &&
    a.autoPlay === b.autoPlay &&
    a.initialStep === b.initialStep &&
    a.includeEmptyStart === b.includeEmptyStart &&
    a.baselineLabel === b.baselineLabel &&
    a.emptyStartLabel === b.emptyStartLabel &&
    Boolean(a.getTimestamp) === Boolean(b.getTimestamp) &&
    Boolean(a.getFrameKey) === Boolean(b.getFrameKey) &&
    Boolean(a.formatFrameLabel) === Boolean(b.formatFrameLabel) &&
    Boolean(a.formatStepLabel) === Boolean(b.formatStepLabel) &&
    Boolean(a.compareFrameKeys) === Boolean(b.compareFrameKeys)
  );
}

// ============================================================================
// Shared Preset Defaults, Geometric Polygon/Hull Builders & Background/DataURL
// ============================================================================

export const SIMPLEX_PRESET_DEFAULTS = {
  contentRadius: 9.5,
  svgStrokeWidth: 1.4,
  svgDefaultMeasureStrokeWidth: 1.5,
  canvasStrokeWidth: 1.2,
  svgDimmedOpacity: 0.34,
  canvasDimmedOpacity: 0.28,
  canvasHoverScale: 1.16,
  svgClusterAnchorRadius: 22,
  canvasClusterAnchorRadius: 21,
  svgGlyphOuterRadius: 11.5,
  svgGlyphInnerRadius: 4.5,
  canvasGlyphRadius: 10,
} as const;

export function resolveRankGeometricShape(
  rank: number,
): 'circle' | 'diamond' | 'star' {
  return rank >= 3 ? 'star' : rank === 2 ? 'diamond' : 'circle';
}

export interface ResolvedGeometricPolygon {
  readonly kind: 'circle' | 'diamond' | 'star' | 'polygon';
  readonly sides?: number;
  readonly rotationRad: number;
  readonly radiusScale: number;
}

export function getRegularPolygonRadiusScale(sides: number): number {
  if (sides <= 3) return 1.18;
  if (sides === 4) return 1.1;
  if (sides === 5) return 1.08;
  if (sides === 6) return 1.05;
  if (sides === 7) return 1.04;
  return 1.03;
}

/**
 * Resolves a base geometric shape visual plus optional view-level overrides
 * into canonical polygon kind, side count, rotation, and area-equalized scale.
 */
export function resolveEffectiveGeometricPolygon(
  base: {
    readonly shape: GeometricShapeKind;
    readonly sides?: number;
    readonly rotationRad?: number;
  },
  overrides?: {
    readonly shape?: GeometricShapeKind;
    readonly sides?: number;
    readonly rotationRad?: number;
  },
): ResolvedGeometricPolygon {
  const effectiveSidesRaw = overrides?.sides ?? base.sides;
  const effectiveShape =
    overrides?.sides !== undefined
      ? (overrides.shape ?? 'polygon')
      : (overrides?.shape ?? base.shape);

  if (
    effectiveShape === 'polygon' ||
    (effectiveSidesRaw !== undefined &&
      Number.isFinite(effectiveSidesRaw) &&
      effectiveShape !== 'circle' &&
      effectiveShape !== 'diamond' &&
      effectiveShape !== 'star')
  ) {
    const namedFallback = NAMED_POLYGON_SIDES[effectiveShape];
    const sides = Math.max(
      3,
      Math.round(effectiveSidesRaw ?? namedFallback ?? 6),
    );
    const defaultRot =
      effectiveShape === 'square' ||
      (overrides?.sides === 4 && overrides.shape === undefined)
        ? -Math.PI / 4
        : -Math.PI / 2;
    return {
      kind: 'polygon',
      sides,
      rotationRad: overrides?.rotationRad ?? base.rotationRad ?? defaultRot,
      radiusScale: getRegularPolygonRadiusScale(sides),
    };
  }

  const namedSides = NAMED_POLYGON_SIDES[effectiveShape];
  if (namedSides !== undefined) {
    const defaultRot = effectiveShape === 'square' ? -Math.PI / 4 : -Math.PI / 2;
    return {
      kind: 'polygon',
      sides: namedSides,
      rotationRad: overrides?.rotationRad ?? base.rotationRad ?? defaultRot,
      radiusScale: getRegularPolygonRadiusScale(namedSides),
    };
  }

  if (effectiveShape === 'circle') {
    return { kind: 'circle', rotationRad: -Math.PI / 2, radiusScale: 1 };
  }
  if (effectiveShape === 'diamond') {
    return { kind: 'diamond', rotationRad: -Math.PI / 2, radiusScale: 1.12 };
  }
  return { kind: 'star', rotationRad: -Math.PI / 2, radiusScale: 1.24 };
}

/**
 * Generates perimeter vertices in local coordinates for a resolved geometric shape.
 */
export function getGeometricShapeVertices(
  resolved: ResolvedGeometricPolygon,
  radius: number,
  options?: {
    readonly circleSamples?: number;
    readonly minRadius?: number;
    readonly starOuterScale?: number;
    readonly starInnerScale?: number;
    readonly useRadiusScale?: boolean;
  },
): readonly Point2D[] {
  const r = Math.max(options?.minRadius ?? 3, radius);
  const verts: Point2D[] = [];

  if (resolved.kind === 'circle') {
    const samples = Math.max(8, Math.round(options?.circleSamples ?? 48));
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2 - Math.PI / 2;
      verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return verts;
  }

  if (resolved.kind === 'diamond') {
    const d = r * 1.12;
    return [
      { x: 0, y: -d },
      { x: d * 0.88, y: 0 },
      { x: 0, y: d },
      { x: -d * 0.88, y: 0 },
    ];
  }

  if (resolved.kind === 'polygon') {
    const sides = Math.max(3, resolved.sides ?? 6);
    const polyR = options?.useRadiusScale === false ? r : r * resolved.radiusScale;
    for (let i = 0; i < sides; i++) {
      const a = resolved.rotationRad + (i * Math.PI * 2) / sides;
      verts.push({ x: Math.cos(a) * polyR, y: Math.sin(a) * polyR });
    }
    return verts;
  }

  const outer = r * (options?.starOuterScale ?? 1.24);
  const inner = r * (options?.starInnerScale ?? 0.56);
  for (let i = 0; i < 10; i++) {
    const a = resolved.rotationRad + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? outer : inner;
    verts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
  }
  return verts;
}

/**
 * Builds the exact analytical convex collision hull matching `getGeometricShapeVertices()`.
 */
export function measureGeometricShapeHull(
  resolved: ResolvedGeometricPolygon,
  radius: number,
  options?: { readonly useRadiusScale?: boolean; readonly starOuterScale?: number },
): ConvexGeometry {
  if (resolved.kind === 'circle') {
    return { kind: 'circle', radius };
  }
  if (resolved.kind === 'diamond') {
    return {
      kind: 'polygon',
      vertices: computeConvexHull(getGeometricShapeVertices(resolved, radius)),
    };
  }
  if (resolved.kind === 'polygon') {
    const scale = options?.useRadiusScale === false ? 1 : resolved.radiusScale;
    return regularPolygon(
      resolved.sides ?? 6,
      radius * scale,
      resolved.rotationRad,
    );
  }
  return starConvexHull(5, radius * (options?.starOuterScale ?? 1.24));
}

/**
 * Returns the canonical backdrop fill color for `'dark'` and `'light'` themes
 * on SVG or Canvas surfaces.
 */
export function resolveSimplexThemeBackgroundColor(
  theme: SimplexColorTheme,
  surface: 'svg' | 'canvas' = 'svg',
): string {
  if (surface === 'canvas') {
    return theme === 'light' ? '#f8fafc' : '#0b1120';
  }
  return theme === 'light' ? '#ffffff' : '#07090e';
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LUT = (() => {
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    lut[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return lut;
})();

function decodeBase64BytesPure(raw: string): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 61 /* '=' */) break;
    const val = code < 128 ? BASE64_LUT[code]! : -1;
    if (val < 0) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  bytes.set(out);
  return bytes;
}

function encodeUtf8BytesPure(text: string): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (cp > 0xffff) i += 1;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(
        0xe0 | (cp >> 12),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  bytes.set(out);
  return bytes;
}

/**
 * Pure-ES2022 decoder converting a `data:` URL (base64 or percent-encoded)
 * into raw bytes + resolved MIME type without `atob`, `Blob`, or DOM globals.
 */
export function decodeSimplexDataUrlToBytes(
  dataUrl: string,
  fallbackMime = 'application/octet-stream',
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly mimeType: string } {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    return {
      bytes: new Uint8Array(new ArrayBuffer(0)),
      mimeType: fallbackMime,
    };
  }
  const header = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /^data:([^;]+)/i.exec(header);
  const mimeType = mimeMatch?.[1] || fallbackMime;
  if (/;base64$/i.test(header)) {
    return {
      bytes: decodeBase64BytesPure(body),
      mimeType,
    };
  }
  return {
    bytes: encodeUtf8BytesPure(decodeURIComponent(body)),
    mimeType,
  };
}


