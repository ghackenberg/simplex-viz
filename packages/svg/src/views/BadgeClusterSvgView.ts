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
  /** Hierarchy tier (`'primary'` two-line topic card vs `'intermediate'` compact single-line bridge tag). Default: `'primary'`. */
  readonly variant?: 'primary' | 'intermediate';
  /** Optional contributing parent cluster colors for split bridge markers on intermediate nodes. */
  readonly accentColors?: readonly string[];
}

/**
 * Pluggable SVG cluster view rendering a dynamic card for primary topic clusters
 * and a compact chamfered single-line bridge tag for intermediate zoom midpoints,
 * automatically measured via `getBBox()` for overlap-free layout.
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
    const hoverStroke = isLight ? '#0f172a' : '#e2e8f0';

    if (visual.variant === 'intermediate') {
      const cardFill = isLight ? '#f8fafc' : '#0b111d';
      const codeFill = isLight ? '#0f172a' : '#e2e8f0';
      const suffixFill = isLight ? '#475569' : '#94a3b8';
      const hasSuffix =
        visual.title.trim().length > 0 && visual.title.trim() !== visual.code.trim();
      const suffix = hasSuffix ? visual.title.trim() : '';

      const codeWidth = visual.code.length * 5.8;
      const suffixWidth = hasSuffix ? (suffix.length + 3) * 5.4 : 0;
      const estWidth = Math.max(50, Math.round(22 + codeWidth + suffixWidth + 10));
      const height = 22;
      const halfW = estWidth / 2;
      const halfH = height / 2;
      const cut = 5.5;

      const bg = doc.createElementNS(SVG_NS, 'polygon');
      bg.setAttribute(
        'points',
        [
          `${(-halfW + cut).toFixed(1)},${(-halfH).toFixed(1)}`,
          `${(halfW - cut).toFixed(1)},${(-halfH).toFixed(1)}`,
          `${halfW.toFixed(1)},0`,
          `${(halfW - cut).toFixed(1)},${halfH.toFixed(1)}`,
          `${(-halfW + cut).toFixed(1)},${halfH.toFixed(1)}`,
          `${(-halfW).toFixed(1)},0`,
        ].join(' '),
      );
      bg.setAttribute('fill', cardFill);
      bg.setAttribute('fill-opacity', isLight ? '0.94' : '0.88');
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
        state.interaction.isHovered || state.interaction.isHighlighted ? '1.8' : '1.15',
      );
      if (!state.interaction.isHovered && !state.interaction.isHighlighted) {
        bg.setAttribute('stroke-dasharray', '3 2');
      }
      bg.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(bg);

      // Rotated split/diamond bridge marker (distinct from primary circle swatch)
      const markerX = -halfW + 12;
      const dSize = 3.8;
      const colorA = visual.accentColors?.[0] ?? visual.colorHex;
      const colorB = visual.accentColors?.[1] ?? visual.colorHex;

      const leftHalf = doc.createElementNS(SVG_NS, 'polygon');
      leftHalf.setAttribute(
        'points',
        `${markerX.toFixed(1)},${(-dSize).toFixed(1)} ${markerX.toFixed(1)},${dSize.toFixed(1)} ${(markerX - dSize).toFixed(1)},0`,
      );
      leftHalf.setAttribute('fill', colorA);
      groupEl.appendChild(leftHalf);

      const rightHalf = doc.createElementNS(SVG_NS, 'polygon');
      rightHalf.setAttribute(
        'points',
        `${markerX.toFixed(1)},${(-dSize).toFixed(1)} ${(markerX + dSize).toFixed(1)},0 ${markerX.toFixed(1)},${dSize.toFixed(1)}`,
      );
      rightHalf.setAttribute('fill', colorB);
      groupEl.appendChild(rightHalf);

      const textStartX = -halfW + 20;
      const codeText = doc.createElementNS(SVG_NS, 'text');
      codeText.setAttribute('x', textStartX.toFixed(1));
      codeText.setAttribute('y', '3.2');
      codeText.setAttribute('fill', codeFill);
      codeText.setAttribute('font-size', '9.2');
      codeText.setAttribute('font-weight', '600');
      codeText.setAttribute('font-family', 'IBM Plex Mono, monospace');
      codeText.textContent = visual.code;
      groupEl.appendChild(codeText);

      if (hasSuffix) {
        const sufText = doc.createElementNS(SVG_NS, 'text');
        sufText.setAttribute('x', (textStartX + codeWidth + 3).toFixed(1));
        sufText.setAttribute('y', '3.2');
        sufText.setAttribute('fill', suffixFill);
        sufText.setAttribute('font-size', '8.6');
        sufText.setAttribute('font-weight', '500');
        sufText.setAttribute('font-family', 'IBM Plex Mono, monospace');
        sufText.textContent = `· ${suffix}`;
        groupEl.appendChild(sufText);
      }
      return;
    }

    const cardFill = isLight ? '#ffffff' : '#0d1320';
    const titleFill = isLight ? '#0f172a' : '#f1f5f9';
    const metaFill = isLight ? '#475569' : '#94a3b8';

    const codeSpan = Math.max(20, visual.code.length * 6.4 + 6);
    const titleOffset = 22 + codeSpan;
    const titleLen = visual.title.length;
    const metaLen = visual.metaLine.length;
    const estWidth = Math.max(
      122,
      Math.max(titleLen * 6.8 + titleOffset + 10, metaLen * 5.9 + 24),
    );
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
    titleText.setAttribute('x', String(Math.round(-halfW + titleOffset)));
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
