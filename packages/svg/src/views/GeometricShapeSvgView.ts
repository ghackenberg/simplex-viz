import {
  computeConvexHull,
  regularPolygon,
  starConvexHull,
  type ConvexGeometry,
  type NodeRenderState,
  type Point2D,
} from '@simplex-viz/core';
import { SVG_NS } from '../hullMeasure.js';
import type { SvgNodeView } from '../types.js';

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
 * Concise shape specification accepted by `getShape` and `GeometricShapeSvgView`.
 *
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
      /** Optional vertex rotation angle in radians (defaults to `-Math.PI / 2`, or `-Math.PI / 4` for `'square'`). */
      readonly rotationRad?: number;
      /** Optional radius override in pixels. */
      readonly radius?: number;
    };

/**
 * Optional view-level defaults / fixed shape overrides for `GeometricShapeSvgView`.
 */
export interface GeometricShapeSvgViewOptions {
  /** Fixed shape override applied to every node rendered by this view. */
  readonly shape?: GeometricShapeKind;
  /** Fixed regular N-gon side count (`>= 3`) overriding topological rank shapes. */
  readonly sides?: number;
  /** Optional default rotation angle in radians for regular N-gons. */
  readonly rotationRad?: number;
}

/**
 * Pure visual descriptor for `GeometricShapeSvgView`.
 */
export interface GeometricShapeVisual {
  readonly shape: GeometricShapeKind;
  readonly radius: number;
  readonly fillHex: string;
  readonly strokeHex?: string;
  readonly strokeWidth?: number;
  readonly label?: string;
  readonly theme?: 'dark' | 'light';
  /** Number of sides (`>= 3`) when rendering a regular convex N-gon (`shape: 'polygon'` or explicit override). */
  readonly sides?: number;
  /** Optional vertex rotation angle in radians for regular convex N-gons. */
  readonly rotationRad?: number;
}

const MORPH_SAMPLES = 64;

const NAMED_POLYGON_SIDES: Readonly<Record<string, number>> = {
  triangle: 3,
  square: 4,
  pentagon: 5,
  hexagon: 6,
  heptagon: 7,
  octagon: 8,
};

interface ResolvedPolygonSpec {
  readonly kind: 'circle' | 'diamond' | 'star' | 'polygon';
  readonly sides?: number;
  readonly rotationRad: number;
  readonly radiusScale: number;
}

function regularPolygonRadiusScale(sides: number): number {
  if (sides <= 3) return 1.18;
  if (sides === 4) return 1.1;
  if (sides === 5) return 1.08;
  if (sides === 6) return 1.05;
  if (sides === 7) return 1.04;
  return 1.03;
}

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

function resolveEffectiveGeometry(
  visual: GeometricShapeVisual,
  viewOptions?: GeometricShapeSvgViewOptions,
): ResolvedPolygonSpec {
  const effectiveSidesRaw = viewOptions?.sides ?? visual.sides;
  const effectiveShape =
    viewOptions?.sides !== undefined
      ? (viewOptions.shape ?? 'polygon')
      : (viewOptions?.shape ?? visual.shape);

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
      (viewOptions?.sides === 4 && viewOptions.shape === undefined)
        ? -Math.PI / 4
        : -Math.PI / 2;
    return {
      kind: 'polygon',
      sides,
      rotationRad: viewOptions?.rotationRad ?? visual.rotationRad ?? defaultRot,
      radiusScale: regularPolygonRadiusScale(sides),
    };
  }

  const namedSides = NAMED_POLYGON_SIDES[effectiveShape];
  if (namedSides !== undefined) {
    const defaultRot = effectiveShape === 'square' ? -Math.PI / 4 : -Math.PI / 2;
    return {
      kind: 'polygon',
      sides: namedSides,
      rotationRad: viewOptions?.rotationRad ?? visual.rotationRad ?? defaultRot,
      radiusScale: regularPolygonRadiusScale(namedSides),
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

function sampleShapePerimeter(
  resolved: ResolvedPolygonSpec,
  radius: number,
): readonly Point2D[] {
  const r = Math.max(3, radius);
  const pts: Point2D[] = [];

  if (resolved.kind === 'circle') {
    for (let i = 0; i < MORPH_SAMPLES; i++) {
      const a = (i / MORPH_SAMPLES) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }

  // Construct polygon vertices then resample evenly along edges
  const polyVerts: Point2D[] = [];
  if (resolved.kind === 'diamond') {
    const d = r * 1.12;
    polyVerts.push(
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
      polyVerts.push({ x: Math.cos(a) * polyR, y: Math.sin(a) * polyR });
    }
  } else {
    // 5-point star (10 vertices alternating outer & inner)
    const outer = r * 1.24;
    const inner = r * 0.56;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? outer : inner;
      polyVerts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
    }
  }

  // Compute cumulative perimeter lengths
  const edgeLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < polyVerts.length; i++) {
    const a = polyVerts[i]!;
    const b = polyVerts[(i + 1) % polyVerts.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    edgeLens.push(len);
    totalLen += len;
  }

  for (let s = 0; s < MORPH_SAMPLES; s++) {
    const targetDist = (s / MORPH_SAMPLES) * totalLen;
    let accum = 0;
    for (let i = 0; i < polyVerts.length; i++) {
      const len = edgeLens[i]!;
      if (accum + len >= targetDist || i === polyVerts.length - 1) {
        const localT = len > 1e-6 ? (targetDist - accum) / len : 0;
        const a = polyVerts[i]!;
        const b = polyVerts[(i + 1) % polyVerts.length]!;
        pts.push({
          x: a.x + (b.x - a.x) * localT,
          y: a.y + (b.y - a.y) * localT,
        });
        break;
      }
      accum += len;
    }
  }

  return pts;
}

function pointsToSvgPath(pts: readonly Point2D[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return `${d} Z`;
}

function parseHexRgb(hex: string): readonly [number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length < 6) return [148, 163, 184];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function lerpHex(fromHex: string, toHex: string, t: number): string {
  const a = parseHexRgb(fromHex);
  const b = parseHexRgb(toHex);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * Pluggable SVG node view rendering geometric shapes (`circle`, `triangle`, `square`,
 * `diamond`, `pentagon`, `hexagon`, `heptagon`, `octagon`, `star`, or arbitrary regular N-gon
 * via `sides`) with exact analytical convex SAT hulls and 64-point parametric SVG path morphing.
 */
export class GeometricShapeSvgView implements SvgNodeView<GeometricShapeVisual> {
  private readonly options: GeometricShapeSvgViewOptions;

  constructor(options: GeometricShapeSvgViewOptions = {}) {
    this.options = options;
  }

  measureConvexHull(visual: GeometricShapeVisual): ConvexGeometry {
    const r = visual.radius + (visual.strokeWidth ?? 1.5);
    const resolved = resolveEffectiveGeometry(visual, this.options);
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
  }

  private ensureElements(groupEl: SVGGElement): {
    pathEl: SVGPathElement;
    ringEl: SVGPathElement;
  } {
    let pathEl = groupEl.querySelector<SVGPathElement>('path.sv-geom-shape');
    let ringEl = groupEl.querySelector<SVGPathElement>('path.sv-geom-ring');
    if (!pathEl || !ringEl) {
      while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild);
      const doc = groupEl.ownerDocument;
      ringEl = doc.createElementNS(SVG_NS, 'path');
      ringEl.setAttribute('class', 'sv-geom-ring');
      ringEl.setAttribute('fill', 'none');
      pathEl = doc.createElementNS(SVG_NS, 'path');
      pathEl.setAttribute('class', 'sv-geom-shape');
      groupEl.appendChild(ringEl);
      groupEl.appendChild(pathEl);
    }
    return { pathEl, ringEl };
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    visual: GeometricShapeVisual,
    state: NodeRenderState<GeometricShapeVisual>,
  ): void {
    const { pathEl, ringEl } = this.ensureElements(groupEl);
    const resolved = resolveEffectiveGeometry(visual, this.options);
    const pts = sampleShapePerimeter(resolved, visual.radius);
    const d = pointsToSvgPath(pts);
    const isLight = visual.theme === 'light';
    const defaultStroke = isLight ? 'rgba(15, 23, 42, 0.25)' : 'rgba(15, 23, 42, 0.8)';
    const hoverStroke = isLight ? '#0f172a' : '#f8fafc';
    const accentRing = isLight ? '#0891b2' : '#22d3ee';

    pathEl.setAttribute('d', d);
    pathEl.setAttribute('fill', visual.fillHex);
    pathEl.setAttribute(
      'stroke',
      state.interaction.isPinned
        ? '#f59e0b'
        : state.interaction.isHovered
          ? hoverStroke
          : (visual.strokeHex ?? defaultStroke),
    );
    pathEl.setAttribute(
      'stroke-width',
      String(state.interaction.isHovered || state.interaction.isPinned ? 2.2 : (visual.strokeWidth ?? 1.4)),
    );

    if (state.interaction.isHovered || state.interaction.isPinned || state.interaction.isHighlighted) {
      const outerPts = sampleShapePerimeter(resolved, visual.radius + 4.5);
      ringEl.setAttribute('d', pointsToSvgPath(outerPts));
      ringEl.setAttribute('stroke', state.interaction.isPinned ? '#f59e0b' : accentRing);
      ringEl.setAttribute('stroke-width', '1.4');
      ringEl.setAttribute('stroke-opacity', '0.9');
    } else {
      ringEl.setAttribute('d', '');
    }
  }

  morph(
    groupEl: SVGGElement,
    from: GeometricShapeVisual,
    to: GeometricShapeVisual,
    progress: number,
    state: NodeRenderState<GeometricShapeVisual>,
  ): boolean {
    const { pathEl, ringEl } = this.ensureElements(groupEl);
    const ptsA = sampleShapePerimeter(
      resolveEffectiveGeometry(from, this.options),
      from.radius,
    );
    const ptsB = sampleShapePerimeter(
      resolveEffectiveGeometry(to, this.options),
      to.radius,
    );
    const morphed: Point2D[] = [];
    for (let i = 0; i < MORPH_SAMPLES; i++) {
      const a = ptsA[i]!;
      const b = ptsB[i]!;
      morphed.push({
        x: a.x + (b.x - a.x) * progress,
        y: a.y + (b.y - a.y) * progress,
      });
    }
    const isLight = to.theme === 'light';
    pathEl.setAttribute('d', pointsToSvgPath(morphed));
    pathEl.setAttribute('fill', lerpHex(from.fillHex, to.fillHex, progress));
    pathEl.setAttribute(
      'stroke',
      state.interaction.isHovered
        ? (isLight ? '#0f172a' : '#f8fafc')
        : (to.strokeHex ?? (isLight ? 'rgba(15, 23, 42, 0.25)' : 'rgba(15, 23, 42, 0.8)')),
    );
    pathEl.setAttribute('stroke-width', String(to.strokeWidth ?? 1.4));
    ringEl.setAttribute('d', '');
    return true;
  }
}
