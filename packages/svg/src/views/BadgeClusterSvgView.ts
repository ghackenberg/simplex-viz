import type { NodeRenderState } from '@simplex-viz/core';
import { SVG_NS } from '../hullMeasure';
import type { SvgNodeView } from '../types';

/**
 * Pure visual descriptor for `BadgeClusterSvgView`.
 * Intentionally omits analytical `measureConvexHull` so `@simplex-viz/svg`
 * exercises automatic offscreen `getBBox()` convex hull computation.
 */
export interface BadgeClusterVisual {
  readonly code: string;
  readonly title: string;
  readonly metaLine: string;
  readonly colorHex: string;
  readonly theme?: 'dark' | 'light';
}

/**
 * Pluggable SVG cluster view rendering a dynamic pill/rect badge whose width adapts
 * to its title and metadata, automatically measured via `getBBox()` for overlap-free layout.
 */
export class BadgeClusterSvgView implements SvgNodeView<BadgeClusterVisual> {
  mountOrUpdate(
    groupEl: SVGGElement,
    visual: BadgeClusterVisual,
    state: NodeRenderState<BadgeClusterVisual>,
  ): void {
    const doc = groupEl.ownerDocument;
    while (groupEl.firstChild) {
      groupEl.removeChild(groupEl.firstChild);
    }

    const isLight = visual.theme === 'light';
    const cardFill = isLight ? '#ffffff' : '#0d1320';
    const hoverStroke = isLight ? '#0f172a' : '#e2e8f0';
    const titleFill = isLight ? '#0f172a' : '#f1f5f9';
    const metaFill = isLight ? '#475569' : '#94a3b8';

    const titleLen = visual.title.length;
    const metaLen = visual.metaLine.length;
    const estWidth = Math.max(122, Math.max(titleLen * 6.8 + 44, metaLen * 5.9 + 24));
    const height = 42;
    const halfW = estWidth / 2;
    const halfH = height / 2;

    const bg = doc.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(-halfW));
    bg.setAttribute('y', String(-halfH));
    bg.setAttribute('width', String(estWidth));
    bg.setAttribute('height', String(height));
    bg.setAttribute('rx', '8');
    bg.setAttribute('fill', cardFill);
    bg.setAttribute('fill-opacity', isLight ? '0.97' : '0.94');
    bg.setAttribute(
      'stroke',
      state.interaction.isPinned
        ? '#f59e0b'
        : state.interaction.isHovered || state.interaction.isHighlighted
          ? hoverStroke
          : visual.colorHex,
    );
    bg.setAttribute(
      'stroke-width',
      state.interaction.isHovered || state.interaction.isHighlighted ? '2.2' : '1.4',
    );
    groupEl.appendChild(bg);

    // Subtle top accent dot inside badge
    const swatch = doc.createElementNS(SVG_NS, 'circle');
    swatch.setAttribute('cx', String(-halfW + 13));
    swatch.setAttribute('cy', String(-7));
    swatch.setAttribute('r', '4');
    swatch.setAttribute('fill', visual.colorHex);
    groupEl.appendChild(swatch);

    const codeText = doc.createElementNS(SVG_NS, 'text');
    codeText.setAttribute('x', String(-halfW + 22));
    codeText.setAttribute('y', String(-3));
    codeText.setAttribute('fill', isLight ? '#0f172a' : visual.colorHex);
    codeText.setAttribute('font-size', '10');
    codeText.setAttribute('font-weight', '600');
    codeText.setAttribute('font-family', 'IBM Plex Mono, monospace');
    codeText.textContent = visual.code;
    groupEl.appendChild(codeText);

    const titleText = doc.createElementNS(SVG_NS, 'text');
    titleText.setAttribute('x', String(-halfW + 44));
    titleText.setAttribute('y', String(-3));
    titleText.setAttribute('fill', titleFill);
    titleText.setAttribute('font-size', '11');
    titleText.setAttribute('font-weight', '600');
    titleText.setAttribute('font-family', 'Plus Jakarta Sans, sans-serif');
    titleText.textContent = visual.title;
    groupEl.appendChild(titleText);

    const subText = doc.createElementNS(SVG_NS, 'text');
    subText.setAttribute('x', '0');
    subText.setAttribute('y', '13');
    subText.setAttribute('text-anchor', 'middle');
    subText.setAttribute('fill', metaFill);
    subText.setAttribute('font-size', '9.5');
    subText.setAttribute('font-family', 'IBM Plex Mono, monospace');
    subText.textContent = visual.metaLine;
    groupEl.appendChild(subText);
  }
}
