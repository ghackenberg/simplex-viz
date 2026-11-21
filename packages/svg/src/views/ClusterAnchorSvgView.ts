import type { ConvexGeometry, NodeRenderState } from '@simplex-viz/core';
import { octagonSvgPoints } from '../badgeLayout.js';
import { resolveClusterSurfaceColors } from '../colorContrast.js';
import { SVG_NS } from '../hullMeasure.js';
import type { SvgNodeView } from '../types.js';

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
  /** Hierarchy tier (`'primary'` saturated double-ring vertex anchor vs `'intermediate'` compact octagonal bridge anchor). Default: `'primary'`. */
  readonly variant?: 'primary' | 'intermediate';
  /** Optional parent cluster anchor context displayed on outer zoomed corners. */
  readonly parentContextLabel?: string;
  /** Optional contributing parent cluster colors for intermediate bridge anchors. */
  readonly accentColors?: readonly string[];
}

/**
 * Pluggable SVG cluster view rendering a saturated OKLab-calibrated double-ring vertex anchor
 * for primary clusters and a compact saturated octagonal bridge node for intermediate midpoints.
 */
export class ClusterAnchorSvgView implements SvgNodeView<ClusterAnchorVisual> {
  measureConvexHull(visual: ClusterAnchorVisual): ConvexGeometry {
    if (visual.variant === 'intermediate') {
      const hasParent = Boolean(visual.parentContextLabel?.trim());
      const compactR = Math.max(
        hasParent ? 15 : 13,
        Math.round(visual.radius * (hasParent ? 0.76 : 0.66)),
      );
      return { kind: 'circle', radius: compactR + 4.5 };
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

    const theme = visual.theme === 'light' ? 'light' : 'dark';
    const isLight = theme === 'light';
    const isActive = state.interaction.isHovered || state.interaction.isHighlighted;
    const hoverStroke = isLight ? '#0f172a' : '#f8fafc';
    const palette = resolveClusterSurfaceColors(visual.colorHex, theme);

    if (visual.variant === 'intermediate') {
      const parentCtx = (visual.parentContextLabel ?? '').trim();
      const hasParent = parentCtx.length > 0;
      const r = Math.max(
        hasParent ? 15 : 13,
        Math.round(visual.radius * (hasParent ? 0.76 : 0.66)),
      );

      // 1. Outer dashed octagonal docking halo
      const halo = doc.createElementNS(SVG_NS, 'polygon');
      halo.setAttribute('points', octagonSvgPoints(r + 2.8));
      halo.setAttribute('fill', 'none');
      halo.setAttribute(
        'stroke',
        state.interaction.isPinned
          ? '#f59e0b'
          : isActive
            ? hoverStroke
            : palette.haloHex,
      );
      halo.setAttribute('stroke-width', isActive ? '2.0' : '1.25');
      halo.setAttribute(
        'stroke-opacity',
        isActive || state.interaction.isPinned ? '0.96' : isLight ? '0.56' : '0.7',
      );
      if (!isActive) {
        halo.setAttribute('stroke-dasharray', '3 2');
      }
      halo.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(halo);

      // 2. Subtle elevation shadow
      const shadow = doc.createElementNS(SVG_NS, 'polygon');
      shadow.setAttribute('points', octagonSvgPoints(r, 1.4));
      shadow.setAttribute('fill', '#020617');
      shadow.setAttribute('fill-opacity', isLight ? '0.15' : '0.42');
      groupEl.appendChild(shadow);

      // 3. Saturated OKLab-calibrated octagonal core
      const body = doc.createElementNS(SVG_NS, 'polygon');
      body.setAttribute('points', octagonSvgPoints(r));
      body.setAttribute('fill', palette.solidFillHex);
      body.setAttribute('stroke', state.interaction.isPinned ? '#fef08a' : '#ffffff');
      body.setAttribute('stroke-width', isActive ? '1.5' : '1.0');
      body.setAttribute('stroke-opacity', isActive ? '0.92' : '0.28');
      body.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(body);

      if (hasParent) {
        const topEl = doc.createElementNS(SVG_NS, 'text');
        topEl.setAttribute('x', '0');
        topEl.setAttribute('y', '-2.4');
        topEl.setAttribute('text-anchor', 'middle');
        topEl.setAttribute('fill', '#ffffff');
        topEl.setAttribute('fill-opacity', '0.8');
        topEl.setAttribute('font-size', '6.6');
        topEl.setAttribute('font-weight', '700');
        topEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
        topEl.textContent = parentCtx.slice(0, 6).toUpperCase();
        groupEl.appendChild(topEl);

        const botEl = doc.createElementNS(SVG_NS, 'text');
        botEl.setAttribute('x', '0');
        botEl.setAttribute('y', '6.8');
        botEl.setAttribute('text-anchor', 'middle');
        botEl.setAttribute('fill', '#ffffff');
        botEl.setAttribute('font-size', '7.8');
        botEl.setAttribute('font-weight', '700');
        botEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
        botEl.textContent = visual.code;
        groupEl.appendChild(botEl);
      } else {
        const codeEl = doc.createElementNS(SVG_NS, 'text');
        codeEl.setAttribute('x', '0');
        codeEl.setAttribute('y', '2.9');
        codeEl.setAttribute('text-anchor', 'middle');
        codeEl.setAttribute('fill', '#ffffff');
        codeEl.setAttribute('font-size', visual.code.length > 5 ? '7.4' : '8.5');
        codeEl.setAttribute('font-weight', '700');
        codeEl.setAttribute('letter-spacing', '0.01em');
        codeEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
        codeEl.textContent = visual.code;
        groupEl.appendChild(codeEl);
      }
      return;
    }

    const r = visual.radius;

    // Outer docking halo ring
    const outer = doc.createElementNS(SVG_NS, 'circle');
    outer.setAttribute('cx', '0');
    outer.setAttribute('cy', '0');
    outer.setAttribute('r', String(r + 3.2));
    outer.setAttribute('fill', 'none');
    outer.setAttribute(
      'stroke',
      state.interaction.isPinned
        ? '#f59e0b'
        : isActive
          ? hoverStroke
          : palette.haloHex,
    );
    outer.setAttribute('stroke-width', isActive ? '2.2' : '1.45');
    outer.setAttribute('stroke-opacity', isActive ? '0.96' : isLight ? '0.58' : '0.72');
    outer.setAttribute('stroke-dasharray', '4 2.5');
    groupEl.appendChild(outer);

    // Subtle elevation shadow
    const shadow = doc.createElementNS(SVG_NS, 'circle');
    shadow.setAttribute('cx', '0');
    shadow.setAttribute('cy', '1.6');
    shadow.setAttribute('r', String(r - 1));
    shadow.setAttribute('fill', '#020617');
    shadow.setAttribute('fill-opacity', isLight ? '0.16' : '0.45');
    groupEl.appendChild(shadow);

    // Saturated jewel-tone cluster core
    const inner = doc.createElementNS(SVG_NS, 'circle');
    inner.setAttribute('cx', '0');
    inner.setAttribute('cy', '0');
    inner.setAttribute('r', String(r - 1));
    inner.setAttribute('fill', palette.solidFillHex);
    inner.setAttribute('stroke', '#ffffff');
    inner.setAttribute('stroke-width', isActive ? '1.6' : '1.0');
    inner.setAttribute('stroke-opacity', isActive ? '0.92' : '0.28');
    groupEl.appendChild(inner);

    const codeEl = doc.createElementNS(SVG_NS, 'text');
    codeEl.setAttribute('x', '0');
    codeEl.setAttribute('y', '-2');
    codeEl.setAttribute('text-anchor', 'middle');
    codeEl.setAttribute('fill', '#ffffff');
    codeEl.setAttribute('font-size', '11');
    codeEl.setAttribute('font-weight', '700');
    codeEl.setAttribute('letter-spacing', '0.01em');
    codeEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
    codeEl.textContent = visual.code;
    groupEl.appendChild(codeEl);

    const countEl = doc.createElementNS(SVG_NS, 'text');
    countEl.setAttribute('x', '0');
    countEl.setAttribute('y', '10.5');
    countEl.setAttribute('text-anchor', 'middle');
    countEl.setAttribute('fill', '#ffffff');
    countEl.setAttribute('fill-opacity', '0.86');
    countEl.setAttribute('font-size', '8.8');
    countEl.setAttribute('font-weight', '600');
    countEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
    countEl.textContent = `${visual.memberCount}n`;
    groupEl.appendChild(countEl);
  }
}
