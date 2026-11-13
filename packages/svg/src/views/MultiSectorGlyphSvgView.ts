import type { ConvexGeometry, NodeRenderState } from '@simplex-viz/core';
import { SVG_NS } from '../hullMeasure';
import type { SvgNodeView } from '../types';

export interface TopicSectorSlice {
  readonly colorHex: string;
  readonly weight: number;
}

/**
 * Pure visual descriptor for `MultiSectorGlyphSvgView`.
 */
export interface MultiSectorGlyphVisual {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly sectors: readonly TopicSectorSlice[];
  readonly centerColorHex: string;
  readonly accentRingHex?: string;
  readonly theme?: 'dark' | 'light';
}

function describeDonutSectorPath(
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 1e-4) {
    // Full ring via two half-arcs
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

/**
 * Pluggable SVG node view rendering multi-color topic-weight donut sectors
 * representing each item's exact barycentric weights `\tilde{w}_{ik}`.
 */
export class MultiSectorGlyphSvgView implements SvgNodeView<MultiSectorGlyphVisual> {
  measureConvexHull(visual: MultiSectorGlyphVisual): ConvexGeometry {
    return { kind: 'circle', radius: visual.outerRadius + 2 };
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    visual: MultiSectorGlyphVisual,
    state: NodeRenderState<MultiSectorGlyphVisual>,
  ): void {
    const doc = groupEl.ownerDocument;
    while (groupEl.firstChild) {
      groupEl.removeChild(groupEl.firstChild);
    }

    const isLight = visual.theme === 'light';
    const dividerStroke = isLight ? '#ffffff' : '#07090E';
    const hoverStroke = isLight ? '#0f172a' : '#f8fafc';
    const defaultAccent = isLight ? '#0891b2' : '#22d3ee';

    const totalWeight = visual.sectors.reduce((s, sec) => s + Math.max(0, sec.weight), 0) || 1;
    let angle = -Math.PI / 2;

    for (const sec of visual.sectors) {
      const frac = Math.max(0, sec.weight) / totalWeight;
      if (frac <= 0.005) continue;
      const nextAngle = angle + frac * Math.PI * 2;
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        describeDonutSectorPath(visual.innerRadius, visual.outerRadius, angle, nextAngle),
      );
      path.setAttribute('fill', sec.colorHex);
      path.setAttribute('stroke', dividerStroke);
      path.setAttribute('stroke-width', visual.sectors.length > 1 ? '1.1' : '0.8');
      groupEl.appendChild(path);
      angle = nextAngle;
    }

    const core = doc.createElementNS(SVG_NS, 'circle');
    core.setAttribute('cx', '0');
    core.setAttribute('cy', '0');
    core.setAttribute('r', String(Math.max(2, visual.innerRadius - 1)));
    core.setAttribute('fill', visual.centerColorHex);
    groupEl.appendChild(core);

    if (
      visual.accentRingHex ||
      state.interaction.isHovered ||
      state.interaction.isPinned ||
      state.interaction.isHighlighted
    ) {
      const ring = doc.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('cx', '0');
      ring.setAttribute('cy', '0');
      ring.setAttribute('r', String(visual.outerRadius + 3));
      ring.setAttribute('fill', 'none');
      ring.setAttribute(
        'stroke',
        state.interaction.isPinned
          ? '#f59e0b'
          : state.interaction.isHovered
            ? hoverStroke
            : (visual.accentRingHex ?? defaultAccent),
      );
      ring.setAttribute('stroke-width', state.interaction.isHovered ? '2' : '1.2');
      groupEl.appendChild(ring);
    }
  }
}
