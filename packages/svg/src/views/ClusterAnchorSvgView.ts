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
  /** Hierarchy tier (`'primary'` circular double-ring vs `'intermediate'` compact octagonal/diamond bridge anchor). Default: `'primary'`. */
  readonly variant?: 'primary' | 'intermediate';
  /** Optional contributing parent cluster colors for intermediate bridge anchors. */
  readonly accentColors?: readonly string[];
}

/**
 * Pluggable SVG cluster view rendering a calibrated double-ring geometric vertex anchor
 * for primary clusters and a compact octagonal/diamond bridge node for intermediate midpoints.
 */
export class ClusterAnchorSvgView implements SvgNodeView<ClusterAnchorVisual> {
  measureConvexHull(visual: ClusterAnchorVisual): ConvexGeometry {
    if (visual.variant === 'intermediate') {
      const compactR = Math.max(12, Math.round(visual.radius * 0.64));
      return { kind: 'circle', radius: compactR + 3 };
    }
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

    if (visual.variant === 'intermediate') {
      const r = Math.max(12, Math.round(visual.radius * 0.64));
      const diag = r * 0.74;
      const pts = [
        `0,${(-r - 1.5).toFixed(1)}`,
        `${diag.toFixed(1)},${(-diag).toFixed(1)}`,
        `${(r + 1.5).toFixed(1)},0`,
        `${diag.toFixed(1)},${diag.toFixed(1)}`,
        `0,${(r + 1.5).toFixed(1)}`,
        `${(-diag).toFixed(1)},${diag.toFixed(1)}`,
        `${(-r - 1.5).toFixed(1)},0`,
        `${(-diag).toFixed(1)},${(-diag).toFixed(1)}`,
      ].join(' ');

      const outer = doc.createElementNS(SVG_NS, 'polygon');
      outer.setAttribute('points', pts);
      outer.setAttribute('fill', outerFill);
      outer.setAttribute('fill-opacity', isLight ? '0.95' : '0.88');
      outer.setAttribute(
        'stroke',
        state.interaction.isHovered || state.interaction.isHighlighted
          ? hoverStroke
          : visual.colorHex,
      );
      outer.setAttribute(
        'stroke-width',
        state.interaction.isHovered || state.interaction.isHighlighted ? '2.0' : '1.25',
      );
      if (!state.interaction.isHovered && !state.interaction.isHighlighted) {
        outer.setAttribute('stroke-dasharray', '3 2');
      }
      outer.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(outer);

      const innerR = Math.max(8, r - 2.5);
      const innerDiag = innerR * 0.74;
      const innerPts = [
        `0,${(-innerR).toFixed(1)}`,
        `${innerDiag.toFixed(1)},${(-innerDiag).toFixed(1)}`,
        `${innerR.toFixed(1)},0`,
        `${innerDiag.toFixed(1)},${innerDiag.toFixed(1)}`,
        `0,${innerR.toFixed(1)}`,
        `${(-innerDiag).toFixed(1)},${innerDiag.toFixed(1)}`,
        `${(-innerR).toFixed(1)},0`,
        `${(-innerDiag).toFixed(1)},${(-innerDiag).toFixed(1)}`,
      ].join(' ');
      const inner = doc.createElementNS(SVG_NS, 'polygon');
      inner.setAttribute('points', innerPts);
      inner.setAttribute('fill', visual.colorHex);
      inner.setAttribute('fill-opacity', isLight ? '0.13' : '0.18');
      groupEl.appendChild(inner);

      const codeEl = doc.createElementNS(SVG_NS, 'text');
      codeEl.setAttribute('x', '0');
      codeEl.setAttribute('y', '2.8');
      codeEl.setAttribute('text-anchor', 'middle');
      codeEl.setAttribute('fill', codeFill);
      codeEl.setAttribute('font-size', visual.code.length > 5 ? '7.4' : '8.4');
      codeEl.setAttribute('font-weight', '600');
      codeEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
      codeEl.textContent = visual.code;
      groupEl.appendChild(codeEl);
      return;
    }

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
    outer.setAttribute(
      'stroke-width',
      state.interaction.isHovered || state.interaction.isHighlighted ? '2.4' : '1.6',
    );
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
