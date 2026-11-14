import type {
  DefaultTaggedItem,
  MeshEdgeRenderState,
  MeshTriangleRenderState,
  Point2D,
  SimplexColorTheme,
} from '@simplex-viz/core';
import { SVG_NS } from '../hullMeasure';
import type { SvgEdgeView, SvgTriangleView } from '../types';

function clearGroup(groupEl: SVGGElement): void {
  while (groupEl.firstChild) {
    groupEl.removeChild(groupEl.firstChild);
  }
}

function formatPoints(pts: readonly Point2D[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export interface OklabTintTriangleViewOptions {
  /** Base face opacity at rest. Default: `0.09`. */
  readonly baseOpacity?: number;
  /** Additional opacity boost when hovered or focused. Default: `0.15`. */
  readonly hoverOpacityBoost?: number;
  /** Draw a highlighted border stroke on hover/focus. Default: `true`. */
  readonly strokeOnHover?: boolean;
}

/**
 * Default pluggable SVG view for triangle faces: subtle perceptual OKLab tint fill
 * with crisp hover/focus border emphasis and vertex markers.
 */
export class OklabTintTriangleSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgTriangleView<TItem, TTagMeta, TClusterMeta>
{
  private readonly baseOpacity: number;
  private readonly hoverOpacityBoost: number;
  private readonly strokeOnHover: boolean;
  public readonly cacheKey: string;

  constructor(options: OklabTintTriangleViewOptions = {}) {
    this.baseOpacity = Math.max(0.01, Math.min(0.8, options.baseOpacity ?? 0.09));
    this.hoverOpacityBoost = Math.max(
      0,
      Math.min(0.6, options.hoverOpacityBoost ?? 0.15),
    );
    this.strokeOnHover = options.strokeOnHover ?? true;
    this.cacheKey = `oklab:${this.baseOpacity.toFixed(2)}:${this.hoverOpacityBoost.toFixed(2)}:${this.strokeOnHover ? 1 : 0}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const { isHovered, isFocused, isDimmed } = triangle.interaction;
    let fillOpacity = this.baseOpacity;
    if (isDimmed && !isHovered && !isFocused) {
      fillOpacity = this.baseOpacity * 0.3;
    } else if (isFocused) {
      fillOpacity = Math.min(0.65, this.baseOpacity + this.hoverOpacityBoost * 1.15);
    } else if (isHovered) {
      fillOpacity = Math.min(0.6, this.baseOpacity + this.hoverOpacityBoost);
    }

    const poly = doc.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', formatPoints(triangle.points));
    poly.setAttribute('fill', triangle.fillHex);
    poly.setAttribute('fill-opacity', fillOpacity.toFixed(3));

    if (this.strokeOnHover && (isHovered || isFocused)) {
      poly.setAttribute('stroke', triangle.fillHex);
      poly.setAttribute('stroke-width', isFocused ? '2.2' : '1.5');
      poly.setAttribute('stroke-opacity', isFocused ? '0.92' : '0.78');
      poly.setAttribute('stroke-linejoin', 'round');
    } else {
      poly.setAttribute('stroke', theme === 'light' ? '#0f172a' : '#e2e8f0');
      poly.setAttribute('stroke-width', '0.5');
      poly.setAttribute('stroke-opacity', isDimmed ? '0.02' : '0.06');
    }
    groupEl.appendChild(poly);

    if (isHovered || isFocused) {
      for (const pt of triangle.points) {
        const dot = doc.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', pt.x.toFixed(1));
        dot.setAttribute('cy', pt.y.toFixed(1));
        dot.setAttribute('r', isFocused ? '3.5' : '2.8');
        dot.setAttribute('fill', triangle.fillHex);
        dot.setAttribute('fill-opacity', '0.85');
        groupEl.appendChild(dot);
      }
    }
  }
}

export interface GradientTriangleViewOptions {
  /** Base gradient fill opacity at rest. Default: `0.18`. */
  readonly baseOpacity?: number;
  /** Additional opacity boost when hovered or focused. Default: `0.18`. */
  readonly hoverOpacityBoost?: number;
  /** Draw a highlighted border stroke and vertex dots on hover/focus. Default: `true`. */
  readonly strokeOnHover?: boolean;
  /** Optional fallback color for unoccupied vertices to guarantee edge continuity. */
  readonly unoccupiedColorHex?: string;
}

/**
 * Continuous barycentric gradient triangle shading across the entire mesh.
 *
 * Uses three orthogonal vertex-to-opposite-edge SVG `<linearGradient>` passes composited
 * via `mix-blend-mode: plus-lighter` inside an isolated `<g>` so every shared vertex and
 * shared edge transitions seamlessly (`C0`-continuous) without seams across adjacent triangles.
 */
export class GradientTriangleSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgTriangleView<TItem, TTagMeta, TClusterMeta>
{
  private static nextInstanceId = 1;

  private readonly instanceId: number;
  private readonly baseOpacity: number;
  private readonly hoverOpacityBoost: number;
  private readonly strokeOnHover: boolean;
  private readonly unoccupiedColorHex?: string;
  public readonly cacheKey: string;

  constructor(options: GradientTriangleViewOptions = {}) {
    this.instanceId = GradientTriangleSvgView.nextInstanceId++;
    this.baseOpacity = Math.max(0.01, Math.min(0.85, options.baseOpacity ?? 0.18));
    this.hoverOpacityBoost = Math.max(
      0,
      Math.min(0.6, options.hoverOpacityBoost ?? 0.18),
    );
    this.strokeOnHover = options.strokeOnHover ?? true;
    this.unoccupiedColorHex = options.unoccupiedColorHex;
    this.cacheKey = `grad:${this.baseOpacity.toFixed(2)}:${this.hoverOpacityBoost.toFixed(2)}:${this.strokeOnHover ? 1 : 0}:${this.unoccupiedColorHex ?? 'auto'}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const { isHovered, isFocused, isDimmed } = triangle.interaction;
    let fillOpacity = this.baseOpacity;
    if (isDimmed && !isHovered && !isFocused) {
      fillOpacity = this.baseOpacity * 0.28;
    } else if (isFocused) {
      fillOpacity = Math.min(0.75, this.baseOpacity + this.hoverOpacityBoost * 1.15);
    } else if (isHovered) {
      fillOpacity = Math.min(0.7, this.baseOpacity + this.hoverOpacityBoost);
    }

    const fallbackColor =
      this.unoccupiedColorHex ?? (theme === 'light' ? '#cbd5e1' : '#334155');
    const cornerColors: readonly [string, string, string] = [
      triangle.clusters[0]?.colorHex ?? fallbackColor,
      triangle.clusters[1]?.colorHex ?? fallbackColor,
      triangle.clusters[2]?.colorHex ?? fallbackColor,
    ];
    const ptsStr = formatPoints(triangle.points);

    const altitudes: Array<{
      readonly p: Point2D;
      readonly foot: Point2D;
      readonly color: string;
    }> = [];
    let validGeometry = true;

    for (let i = 0; i < 3; i++) {
      const p = triangle.points[i]!;
      const q1 = triangle.points[(i + 1) % 3]!;
      const q2 = triangle.points[(i + 2) % 3]!;
      const dx = q2.x - q1.x;
      const dy = q2.y - q1.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-4) {
        validGeometry = false;
        break;
      }
      const proj = ((p.x - q1.x) * dx + (p.y - q1.y) * dy) / lenSq;
      altitudes.push({
        p,
        foot: { x: q1.x + proj * dx, y: q1.y + proj * dy },
        color: cornerColors[i]!,
      });
    }

    if (validGeometry) {
      const defs = doc.createElementNS(SVG_NS, 'defs');
      const blendGroup = doc.createElementNS(SVG_NS, 'g');
      blendGroup.setAttribute('opacity', fillOpacity.toFixed(3));
      blendGroup.setAttribute('style', 'isolation: isolate');

      for (let i = 0; i < 3; i++) {
        const alt = altitudes[i]!;
        const gradId = `sv-tri-grad-${this.instanceId}-${triangle.index}-${i}`;
        const grad = doc.createElementNS(SVG_NS, 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        grad.setAttribute('x1', alt.p.x.toFixed(2));
        grad.setAttribute('y1', alt.p.y.toFixed(2));
        grad.setAttribute('x2', alt.foot.x.toFixed(2));
        grad.setAttribute('y2', alt.foot.y.toFixed(2));

        const stop0 = doc.createElementNS(SVG_NS, 'stop');
        stop0.setAttribute('offset', '0%');
        stop0.setAttribute('stop-color', alt.color);
        stop0.setAttribute('stop-opacity', '1');

        const stop1 = doc.createElementNS(SVG_NS, 'stop');
        stop1.setAttribute('offset', '100%');
        stop1.setAttribute('stop-color', alt.color);
        stop1.setAttribute('stop-opacity', '0');

        grad.appendChild(stop0);
        grad.appendChild(stop1);
        defs.appendChild(grad);

        const poly = doc.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', ptsStr);
        poly.setAttribute('fill', `url(#${gradId})`);
        poly.setAttribute('stroke', `url(#${gradId})`);
        poly.setAttribute('stroke-width', '0.6');
        poly.setAttribute('stroke-linejoin', 'round');
        poly.setAttribute('style', 'mix-blend-mode: plus-lighter');
        blendGroup.appendChild(poly);
      }

      groupEl.appendChild(defs);
      groupEl.appendChild(blendGroup);
    } else {
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', ptsStr);
      poly.setAttribute('fill', triangle.fillHex);
      poly.setAttribute('fill-opacity', fillOpacity.toFixed(3));
      groupEl.appendChild(poly);
    }

    if (this.strokeOnHover && (isHovered || isFocused)) {
      const outline = doc.createElementNS(SVG_NS, 'polygon');
      outline.setAttribute('points', ptsStr);
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', triangle.fillHex);
      outline.setAttribute('stroke-width', isFocused ? '2.2' : '1.5');
      outline.setAttribute('stroke-opacity', isFocused ? '0.92' : '0.8');
      outline.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(outline);

      for (let i = 0; i < 3; i++) {
        const pt = triangle.points[i]!;
        const dot = doc.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', pt.x.toFixed(1));
        dot.setAttribute('cy', pt.y.toFixed(1));
        dot.setAttribute('r', isFocused ? '3.8' : '3.0');
        dot.setAttribute('fill', cornerColors[i]!);
        dot.setAttribute('stroke', theme === 'light' ? '#ffffff' : '#07090e');
        dot.setAttribute('stroke-width', '1');
        groupEl.appendChild(dot);
      }
    }
  }
}

export interface BarycentricSectorTriangleViewOptions {
  /** Base sector fill opacity. Default: `0.13`. */
  readonly baseOpacity?: number;
  /** Draw dashed medians to centroid. Default: `true`. */
  readonly showMedians?: boolean;
}

/**
 * Splits each triangle face into 3 sub-sectors anchored at its barycentric centroid,
 * tinting each corner zone with its respective cluster color.
 */
export class BarycentricSectorTriangleSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgTriangleView<TItem, TTagMeta, TClusterMeta>
{
  private readonly baseOpacity: number;
  private readonly showMedians: boolean;
  public readonly cacheKey: string;

  constructor(options: BarycentricSectorTriangleViewOptions = {}) {
    this.baseOpacity = Math.max(0.02, Math.min(0.8, options.baseOpacity ?? 0.13));
    this.showMedians = options.showMedians ?? true;
    this.cacheKey = `bary:${this.baseOpacity.toFixed(2)}:${this.showMedians ? 1 : 0}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const { isHovered, isFocused, isDimmed } = triangle.interaction;
    const opacity = isDimmed
      ? this.baseOpacity * 0.25
      : isFocused
        ? Math.min(0.65, this.baseOpacity + 0.16)
        : isHovered
          ? Math.min(0.6, this.baseOpacity + 0.11)
          : this.baseOpacity;

    const [pA, pB, pC] = triangle.points;
    const mAB = lerpPoint(pA, pB, 0.5);
    const mBC = lerpPoint(pB, pC, 0.5);
    const mCA = lerpPoint(pC, pA, 0.5);
    const center = triangle.centroid;

    const cornerQuads: Array<readonly [Point2D, Point2D, Point2D, Point2D]> = [
      [pA, mAB, center, mCA],
      [pB, mBC, center, mAB],
      [pC, mCA, center, mBC],
    ];

    for (let i = 0; i < 3; i++) {
      const sectorPoly = doc.createElementNS(SVG_NS, 'polygon');
      sectorPoly.setAttribute('points', formatPoints(cornerQuads[i]!));
      sectorPoly.setAttribute(
        'fill',
        triangle.clusters[i]?.colorHex ?? triangle.fillHex,
      );
      sectorPoly.setAttribute('fill-opacity', opacity.toFixed(3));
      groupEl.appendChild(sectorPoly);
    }

    if (this.showMedians) {
      const stroke = theme === 'light' ? '#475569' : '#94a3b8';
      for (const pt of triangle.points) {
        const line = doc.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', pt.x.toFixed(1));
        line.setAttribute('y1', pt.y.toFixed(1));
        line.setAttribute('x2', center.x.toFixed(1));
        line.setAttribute('y2', center.y.toFixed(1));
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', isHovered || isFocused ? '1.1' : '0.75');
        line.setAttribute('stroke-dasharray', '2 3');
        line.setAttribute('stroke-opacity', isDimmed ? '0.08' : isHovered || isFocused ? '0.5' : '0.22');
        groupEl.appendChild(line);
      }
    }

    if (isHovered || isFocused) {
      const outline = doc.createElementNS(SVG_NS, 'polygon');
      outline.setAttribute('points', formatPoints(triangle.points));
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', triangle.fillHex);
      outline.setAttribute('stroke-width', isFocused ? '2.2' : '1.5');
      outline.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(outline);
    }
  }
}

export interface BlueprintInsetTriangleViewOptions {
  /** Scale factor of inner architectural frame towards centroid in (0.4, 0.95). Default: `0.82`. */
  readonly insetRatio?: number;
  /** Fill opacity of outer region. Default: `0.06`. */
  readonly baseOpacity?: number;
}

/**
 * Architectural blueprint-style triangle face with an inset frame and centroid reticle.
 */
export class BlueprintInsetTriangleSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgTriangleView<TItem, TTagMeta, TClusterMeta>
{
  private readonly insetRatio: number;
  private readonly baseOpacity: number;
  public readonly cacheKey: string;

  constructor(options: BlueprintInsetTriangleViewOptions = {}) {
    this.insetRatio = Math.max(0.45, Math.min(0.95, options.insetRatio ?? 0.82));
    this.baseOpacity = Math.max(0.01, Math.min(0.6, options.baseOpacity ?? 0.06));
    this.cacheKey = `blueprint:${this.insetRatio.toFixed(2)}:${this.baseOpacity.toFixed(2)}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const { isHovered, isFocused, isDimmed } = triangle.interaction;
    const outerOpacity = isDimmed
      ? this.baseOpacity * 0.25
      : isFocused
        ? this.baseOpacity + 0.14
        : isHovered
          ? this.baseOpacity + 0.09
          : this.baseOpacity;

    const outer = doc.createElementNS(SVG_NS, 'polygon');
    outer.setAttribute('points', formatPoints(triangle.points));
    outer.setAttribute('fill', triangle.fillHex);
    outer.setAttribute('fill-opacity', outerOpacity.toFixed(3));
    if (isHovered || isFocused) {
      outer.setAttribute('stroke', triangle.fillHex);
      outer.setAttribute('stroke-width', isFocused ? '2' : '1.4');
      outer.setAttribute('stroke-opacity', '0.85');
    }
    groupEl.appendChild(outer);

    const insetPoints = triangle.points.map((p) =>
      lerpPoint(triangle.centroid, p, this.insetRatio),
    );
    const inner = doc.createElementNS(SVG_NS, 'polygon');
    inner.setAttribute('points', formatPoints(insetPoints));
    inner.setAttribute('fill', 'none');
    inner.setAttribute(
      'stroke',
      isHovered || isFocused
        ? triangle.fillHex
        : theme === 'light'
          ? '#475569'
          : '#94a3b8',
    );
    inner.setAttribute('stroke-width', isHovered || isFocused ? '1.3' : '0.85');
    inner.setAttribute(
      'stroke-opacity',
      isDimmed ? '0.08' : isHovered || isFocused ? '0.78' : '0.28',
    );
    inner.setAttribute('stroke-linejoin', 'round');
    groupEl.appendChild(inner);

    if (isHovered || isFocused) {
      const c = triangle.centroid;
      const cross = doc.createElementNS(SVG_NS, 'path');
      cross.setAttribute(
        'd',
        `M ${(c.x - 5).toFixed(1)} ${c.y.toFixed(1)} H ${(c.x + 5).toFixed(1)} M ${c.x.toFixed(1)} ${(c.y - 5).toFixed(1)} V ${(c.y + 5).toFixed(1)}`,
      );
      cross.setAttribute('stroke', triangle.fillHex);
      cross.setAttribute('stroke-width', '1.4');
      cross.setAttribute('stroke-opacity', '0.9');
      groupEl.appendChild(cross);
    }
  }
}

export interface DensityHeatmapTriangleViewOptions {
  /** Base opacity for zero-item triangles. Default: `0.04`. */
  readonly baseOpacity?: number;
  /** Item count considered peak saturation. Default: `10`. */
  readonly peakItemCount?: number;
  /** Render compact item count pill at triangle centroid. Default: `true`. */
  readonly showCountBadge?: boolean;
}

/**
 * Scales face opacity dynamically by `triangle.coveredItemCount` and displays
 * a subtle density badge at the triangle centroid.
 */
export class DensityHeatmapTriangleSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgTriangleView<TItem, TTagMeta, TClusterMeta>
{
  private readonly baseOpacity: number;
  private readonly peakItemCount: number;
  private readonly showCountBadge: boolean;
  public readonly cacheKey: string;

  constructor(options: DensityHeatmapTriangleViewOptions = {}) {
    this.baseOpacity = Math.max(0.01, Math.min(0.5, options.baseOpacity ?? 0.04));
    this.peakItemCount = Math.max(1, options.peakItemCount ?? 10);
    this.showCountBadge = options.showCountBadge ?? true;
    this.cacheKey = `density:${this.baseOpacity.toFixed(2)}:${this.peakItemCount}:${this.showCountBadge ? 1 : 0}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const { isHovered, isFocused, isDimmed } = triangle.interaction;
    const ratio = Math.min(1, triangle.coveredItemCount / this.peakItemCount);
    let fillOpacity = this.baseOpacity + ratio * 0.28;
    if (isDimmed && !isHovered && !isFocused) {
      fillOpacity *= 0.28;
    } else if (isFocused) {
      fillOpacity = Math.min(0.65, fillOpacity + 0.16);
    } else if (isHovered) {
      fillOpacity = Math.min(0.6, fillOpacity + 0.11);
    }

    const poly = doc.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', formatPoints(triangle.points));
    poly.setAttribute('fill', triangle.fillHex);
    poly.setAttribute('fill-opacity', fillOpacity.toFixed(3));
    if (isHovered || isFocused) {
      poly.setAttribute('stroke', triangle.fillHex);
      poly.setAttribute('stroke-width', isFocused ? '2.2' : '1.5');
      poly.setAttribute('stroke-opacity', '0.88');
    }
    groupEl.appendChild(poly);

    if (this.showCountBadge && (triangle.coveredItemCount > 0 || isHovered || isFocused)) {
      const label = `${triangle.coveredItemCount}`;
      const w = Math.max(20, label.length * 7 + 12);
      const pill = doc.createElementNS(SVG_NS, 'rect');
      pill.setAttribute('x', (triangle.centroid.x - w / 2).toFixed(1));
      pill.setAttribute('y', (triangle.centroid.y - 9).toFixed(1));
      pill.setAttribute('width', String(w));
      pill.setAttribute('height', '18');
      pill.setAttribute('rx', '9');
      pill.setAttribute(
        'fill',
        theme === 'light' ? 'rgba(255,255,255,0.82)' : 'rgba(9,13,22,0.78)',
      );
      pill.setAttribute('stroke', triangle.fillHex);
      pill.setAttribute('stroke-width', isHovered || isFocused ? '1.2' : '0.8');
      pill.setAttribute('opacity', isDimmed ? '0.25' : '0.9');
      groupEl.appendChild(pill);

      const text = doc.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', triangle.centroid.x.toFixed(1));
      text.setAttribute('y', (triangle.centroid.y + 3.5).toFixed(1));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-weight', '600');
      text.setAttribute('font-family', 'JetBrains Mono, ui-monospace, monospace');
      text.setAttribute('fill', theme === 'light' ? '#0f172a' : '#f1f5f9');
      text.setAttribute('opacity', isDimmed ? '0.25' : '0.92');
      text.textContent = label;
      groupEl.appendChild(text);
    }
  }
}

export interface DashedMeshEdgeViewOptions {
  /** Base stroke width in px. Default: `1`. */
  readonly strokeWidth?: number;
  /** SVG stroke-dasharray string. Default: `'3 4'`. */
  readonly dasharray?: string;
  /** Base stroke opacity in [0.05, 1]. Default: `0.28`. */
  readonly opacity?: number;
}

/**
 * Default pluggable SVG edge renderer: crisp dashed architectural line with
 * solid OKLab-tinted glow when an adjacent triangle or cluster is highlighted.
 */
export class DashedMeshEdgeSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgEdgeView<TItem, TTagMeta, TClusterMeta>
{
  private readonly strokeWidth: number;
  private readonly dasharray: string;
  private readonly opacity: number;
  public readonly cacheKey: string;

  constructor(options: DashedMeshEdgeViewOptions = {}) {
    this.strokeWidth = Math.max(0.4, Math.min(6, options.strokeWidth ?? 1));
    this.dasharray = options.dasharray ?? '3 4';
    this.opacity = Math.max(0.05, Math.min(1, options.opacity ?? 0.28));
    this.cacheKey = `dashed:${this.strokeWidth.toFixed(2)}:${this.dasharray}:${this.opacity.toFixed(2)}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const line = doc.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', edge.a.x.toFixed(1));
    line.setAttribute('y1', edge.a.y.toFixed(1));
    line.setAttribute('x2', edge.b.x.toFixed(1));
    line.setAttribute('y2', edge.b.y.toFixed(1));
    if (edge.isHighlighted) {
      line.setAttribute('stroke', edge.mixedColorHex);
      line.setAttribute('stroke-width', (this.strokeWidth + 0.9).toFixed(2));
      line.setAttribute('stroke-opacity', '0.88');
    } else {
      line.setAttribute('stroke', theme === 'light' ? '#475569' : '#94a3b8');
      line.setAttribute('stroke-width', this.strokeWidth.toFixed(2));
      line.setAttribute('stroke-opacity', this.opacity.toFixed(2));
      line.setAttribute('stroke-dasharray', this.dasharray);
    }
    groupEl.appendChild(line);
  }
}

export interface ClusterTintedEdgeViewOptions {
  /** Base stroke width in px. Default: `1.3`. */
  readonly strokeWidth?: number;
  /** Base opacity in [0.05, 1]. Default: `0.45`. */
  readonly opacity?: number;
}

/**
 * Solid tri-segment OKLab edge colored by endpoint cluster hues and their midpoint mix.
 */
export class ClusterTintedEdgeSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgEdgeView<TItem, TTagMeta, TClusterMeta>
{
  private readonly strokeWidth: number;
  private readonly opacity: number;
  public readonly cacheKey: string;

  constructor(options: ClusterTintedEdgeViewOptions = {}) {
    this.strokeWidth = Math.max(0.5, Math.min(6, options.strokeWidth ?? 1.3));
    this.opacity = Math.max(0.05, Math.min(1, options.opacity ?? 0.45));
    this.cacheKey = `tinted:${this.strokeWidth.toFixed(2)}:${this.opacity.toFixed(2)}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
    _theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const p1 = lerpPoint(edge.a, edge.b, 0.34);
    const p2 = lerpPoint(edge.a, edge.b, 0.66);
    const colorA = edge.clusters[0]?.colorHex ?? edge.mixedColorHex;
    const colorB = edge.clusters[1]?.colorHex ?? edge.mixedColorHex;
    const width = edge.isHighlighted ? this.strokeWidth + 1.0 : this.strokeWidth;
    const op = edge.isHighlighted ? 0.92 : this.opacity;

    const segs: Array<readonly [Point2D, Point2D, string]> = [
      [edge.a, p1, colorA],
      [p1, p2, edge.mixedColorHex],
      [p2, edge.b, colorB],
    ];
    for (const [start, end, stroke] of segs) {
      const line = doc.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', start.x.toFixed(1));
      line.setAttribute('y1', start.y.toFixed(1));
      line.setAttribute('x2', end.x.toFixed(1));
      line.setAttribute('y2', end.y.toFixed(1));
      line.setAttribute('stroke', stroke);
      line.setAttribute('stroke-width', width.toFixed(2));
      line.setAttribute('stroke-opacity', op.toFixed(2));
      line.setAttribute('stroke-linecap', 'round');
      groupEl.appendChild(line);
    }
  }
}

export interface PrecisionRailEdgeViewOptions {
  /** Base stroke width in px. Default: `0.9`. */
  readonly strokeWidth?: number;
  /** Half-separation between parallel rail lines in px. Default: `1.8`. */
  readonly railOffset?: number;
}

/**
 * Technical double-rail edge with a subtle midpoint diamond marker.
 */
export class PrecisionRailEdgeSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgEdgeView<TItem, TTagMeta, TClusterMeta>
{
  private readonly strokeWidth: number;
  private readonly railOffset: number;
  public readonly cacheKey: string;

  constructor(options: PrecisionRailEdgeViewOptions = {}) {
    this.strokeWidth = Math.max(0.4, Math.min(5, options.strokeWidth ?? 0.9));
    this.railOffset = Math.max(0.8, Math.min(6, options.railOffset ?? 1.8));
    this.cacheKey = `rail:${this.strokeWidth.toFixed(2)}:${this.railOffset.toFixed(2)}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = (-dy / len) * this.railOffset;
    const ny = (dx / len) * this.railOffset;
    const stroke = edge.isHighlighted
      ? edge.mixedColorHex
      : theme === 'light'
        ? '#475569'
        : '#94a3b8';
    const op = edge.isHighlighted ? 0.85 : 0.28;
    const width = edge.isHighlighted ? this.strokeWidth + 0.5 : this.strokeWidth;

    for (const sign of [-1, 1] as const) {
      const line = doc.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (edge.a.x + nx * sign).toFixed(1));
      line.setAttribute('y1', (edge.a.y + ny * sign).toFixed(1));
      line.setAttribute('x2', (edge.b.x + nx * sign).toFixed(1));
      line.setAttribute('y2', (edge.b.y + ny * sign).toFixed(1));
      line.setAttribute('stroke', stroke);
      line.setAttribute('stroke-width', width.toFixed(2));
      line.setAttribute('stroke-opacity', op.toFixed(2));
      groupEl.appendChild(line);
    }

    const mid = lerpPoint(edge.a, edge.b, 0.5);
    const r = edge.isHighlighted ? 3.5 : 2.2;
    const diamond = doc.createElementNS(SVG_NS, 'polygon');
    diamond.setAttribute(
      'points',
      `${mid.x.toFixed(1)},${(mid.y - r).toFixed(1)} ${(mid.x + r).toFixed(1)},${mid.y.toFixed(1)} ${mid.x.toFixed(1)},${(mid.y + r).toFixed(1)} ${(mid.x - r).toFixed(1)},${mid.y.toFixed(1)}`,
    );
    diamond.setAttribute('fill', edge.mixedColorHex);
    diamond.setAttribute('fill-opacity', edge.isHighlighted ? '0.92' : '0.4');
    groupEl.appendChild(diamond);
  }
}

export interface MinimalHighlightEdgeViewOptions {
  /** Base stroke width when highlighted. Default: `1.5`. */
  readonly strokeWidth?: number;
  /** Subtle rest opacity. Default: `0.08`. */
  readonly restOpacity?: number;
}

/**
 * Ultra-minimal mesh edges that stay faint at rest and illuminate crisply on hover or focus.
 */
export class MinimalHighlightEdgeSvgView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements SvgEdgeView<TItem, TTagMeta, TClusterMeta>
{
  private readonly strokeWidth: number;
  private readonly restOpacity: number;
  public readonly cacheKey: string;

  constructor(options: MinimalHighlightEdgeViewOptions = {}) {
    this.strokeWidth = Math.max(0.5, Math.min(6, options.strokeWidth ?? 1.5));
    this.restOpacity = Math.max(0, Math.min(0.4, options.restOpacity ?? 0.08));
    this.cacheKey = `minimal:${this.strokeWidth.toFixed(2)}:${this.restOpacity.toFixed(2)}`;
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void {
    const doc = groupEl.ownerDocument;
    clearGroup(groupEl);

    const line = doc.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', edge.a.x.toFixed(1));
    line.setAttribute('y1', edge.a.y.toFixed(1));
    line.setAttribute('x2', edge.b.x.toFixed(1));
    line.setAttribute('y2', edge.b.y.toFixed(1));
    line.setAttribute(
      'stroke',
      edge.isHighlighted
        ? edge.mixedColorHex
        : theme === 'light'
          ? '#64748b'
          : '#94a3b8',
    );
    line.setAttribute(
      'stroke-width',
      (edge.isHighlighted ? this.strokeWidth + 0.6 : this.strokeWidth * 0.7).toFixed(2),
    );
    line.setAttribute(
      'stroke-opacity',
      (edge.isHighlighted ? 0.9 : this.restOpacity).toFixed(2),
    );
    line.setAttribute('stroke-linecap', 'round');
    groupEl.appendChild(line);
  }
}
