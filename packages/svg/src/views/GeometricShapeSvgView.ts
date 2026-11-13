import {
  computeConvexHull,
  regularPolygon,
  starConvexHull,
  type ConvexGeometry,
  type NodeRenderState,
  type Point2D,
} from '@simplex-viz/core';
import { SVG_NS } from '../hullMeasure';
import type { SvgNodeView } from '../types';

export type GeometricShapeKind = 'circle' | 'diamond' | 'star' | 'hexagon';

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
}

const MORPH_SAMPLES = 64;

function sampleShapePerimeter(
  shape: GeometricShapeKind,
  radius: number,
): readonly Point2D[] {
  const r = Math.max(3, radius);
  const pts: Point2D[] = [];

  if (shape === 'circle') {
    for (let i = 0; i < MORPH_SAMPLES; i++) {
      const a = (i / MORPH_SAMPLES) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }

  // Construct polygon vertices then resample evenly along edges
  const polyVerts: Point2D[] = [];
  if (shape === 'diamond') {
    const d = r * 1.12;
    polyVerts.push(
      { x: 0, y: -d },
      { x: d * 0.88, y: 0 },
      { x: 0, y: d },
      { x: -d * 0.88, y: 0 },
    );
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
      polyVerts.push({ x: Math.cos(a) * r * 1.05, y: Math.sin(a) * r * 1.05 });
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
 * Pluggable SVG node view rendering geometric shapes (`circle`, `diamond`, `star`, `hexagon`)
 * with analytical convex hulls and 64-point parametric SVG path morphing!
 */
export class GeometricShapeSvgView implements SvgNodeView<GeometricShapeVisual> {
  measureConvexHull(visual: GeometricShapeVisual): ConvexGeometry {
    const r = visual.radius + (visual.strokeWidth ?? 1.5);
    if (visual.shape === 'circle') {
      return { kind: 'circle', radius: r };
    }
    if (visual.shape === 'diamond') {
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
    if (visual.shape === 'hexagon') {
      return regularPolygon(6, r * 1.05);
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
    const pts = sampleShapePerimeter(visual.shape, visual.radius);
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
      const outerPts = sampleShapePerimeter(visual.shape, visual.radius + 4.5);
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
    const ptsA = sampleShapePerimeter(from.shape, from.radius);
    const ptsB = sampleShapePerimeter(to.shape, to.radius);
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
