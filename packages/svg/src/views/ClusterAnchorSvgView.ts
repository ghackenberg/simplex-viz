import type { ConvexGeometry, NodeRenderState } from '@simplex-viz/core';
import { SVG_NS } from '../hullMeasure';
import type { SvgNodeView } from '../types';

/**
 * Pure visual descriptor for `ClusterAnchorSvgView`.
 */
export interface ClusterAnchorVisual {
  readonly code: string;
  readonly label: string;
  readonly memberCount: number;
  readonly colorHex: string;
  readonly radius: number;
  readonly theme?: 'dark' | 'light';
}

/**
 * Pluggable SVG cluster view rendering a calibrated double-ring geometric vertex anchor
 * displaying the cluster code and member count.
 */
export class ClusterAnchorSvgView implements SvgNodeView<ClusterAnchorVisual> {
  measureConvexHull(visual: ClusterAnchorVisual): ConvexGeometry {
    return { kind: 'circle', radius: visual.radius + 5 };
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    visual: ClusterAnchorVisual,
    state: NodeRenderState<ClusterAnchorVisual>,
  ): void {
    const doc = groupEl.ownerDocument;
    while (groupEl.firstChild) {
      groupEl.removeChild(groupEl.firstChild);
    }

    const isLight = visual.theme === 'light';
    const outerFill = isLight ? '#ffffff' : '#07090E';
    const hoverStroke = isLight ? '#0f172a' : '#f8fafc';
    const codeFill = isLight ? '#0f172a' : '#f8fafc';

    const r = visual.radius;
    const outer = doc.createElementNS(SVG_NS, 'circle');
    outer.setAttribute('cx', '0');
    outer.setAttribute('cy', '0');
    outer.setAttribute('r', String(r + 3));
    outer.setAttribute('fill', outerFill);
    outer.setAttribute('fill-opacity', isLight ? '0.96' : '0.88');
    outer.setAttribute(
      'stroke',
      state.interaction.isHovered || state.interaction.isHighlighted
        ? hoverStroke
        : visual.colorHex,
    );
    outer.setAttribute('stroke-width', state.interaction.isHovered ? '2.4' : '1.6');
    outer.setAttribute('stroke-dasharray', '4 2.5');
    groupEl.appendChild(outer);

    const inner = doc.createElementNS(SVG_NS, 'circle');
    inner.setAttribute('cx', '0');
    inner.setAttribute('cy', '0');
    inner.setAttribute('r', String(r - 2));
    inner.setAttribute('fill', visual.colorHex);
    inner.setAttribute('fill-opacity', isLight ? '0.14' : '0.18');
    inner.setAttribute('stroke', visual.colorHex);
    inner.setAttribute('stroke-width', '1.4');
    groupEl.appendChild(inner);

    const codeEl = doc.createElementNS(SVG_NS, 'text');
    codeEl.setAttribute('x', '0');
    codeEl.setAttribute('y', '-2');
    codeEl.setAttribute('text-anchor', 'middle');
    codeEl.setAttribute('fill', codeFill);
    codeEl.setAttribute('font-size', '11');
    codeEl.setAttribute('font-weight', '600');
    codeEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
    codeEl.textContent = visual.code;
    groupEl.appendChild(codeEl);

    const countEl = doc.createElementNS(SVG_NS, 'text');
    countEl.setAttribute('x', '0');
    countEl.setAttribute('y', '11');
    countEl.setAttribute('text-anchor', 'middle');
    countEl.setAttribute('fill', isLight ? '#334155' : visual.colorHex);
    countEl.setAttribute('font-size', '9');
    countEl.setAttribute('font-weight', isLight ? '600' : '400');
    countEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
    countEl.textContent = `${visual.memberCount}n`;
    groupEl.appendChild(countEl);
  }
}
