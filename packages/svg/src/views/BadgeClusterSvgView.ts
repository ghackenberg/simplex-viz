import type { NodeRenderState } from '@simplex-viz/core';
import { resolveClusterSurfaceColors, roundedRectSvgPath } from '../colorContrast.js';
import { SVG_NS } from '../hullMeasure.js';
import type { SvgNodeView } from '../types.js';

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
  /** Hierarchy tier (`'primary'` saturated capsule landmark vs `'intermediate'` compact chamfered plaque). Default: `'primary'`. */
  readonly variant?: 'primary' | 'intermediate';
  /** Optional parent cluster anchor context displayed as a compact eyebrow line on outer zoomed corners. */
  readonly parentContextLabel?: string;
  /** Optional contributing parent cluster colors for split bridge markers on intermediate nodes. */
  readonly accentColors?: readonly string[];
}

/**
 * Pluggable SVG cluster view rendering a saturated OKLab-calibrated capsule with outer halo ring
 * for primary topic clusters and a chamfered saturated plaque for intermediate zoom nodes
 * (two-line parent context + local facet on outer corners; compact single-line bridge/facet on midpoints),
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

    const theme = visual.theme === 'light' ? 'light' : 'dark';
    const isLight = theme === 'light';
    const isActive = state.interaction.isHovered || state.interaction.isHighlighted;
    const hoverStroke = isLight ? '#0f172a' : '#f8fafc';
    const palette = resolveClusterSurfaceColors(visual.colorHex, theme);

    if (visual.variant === 'intermediate') {
      const parentCtx = (visual.parentContextLabel ?? '').trim();
      const hasParentCtx = parentCtx.length > 0;
      const rawSuffix = visual.title.trim();
      const hasSuffix = rawSuffix.length > 0 && rawSuffix !== visual.code.trim();
      const suffix = hasSuffix ? rawSuffix : '';

      const chamferPath = (hw: number, hh: number, c: number, dy = 0): string =>
        [
          `M ${(-hw + c).toFixed(1)} ${(-hh + dy).toFixed(1)}`,
          `L ${(hw - c).toFixed(1)} ${(-hh + dy).toFixed(1)}`,
          `L ${hw.toFixed(1)} ${dy.toFixed(1)}`,
          `L ${(hw - c).toFixed(1)} ${(hh + dy).toFixed(1)}`,
          `L ${(-hw + c).toFixed(1)} ${(hh + dy).toFixed(1)}`,
          `L ${(-hw).toFixed(1)} ${dy.toFixed(1)}`,
          'Z',
        ].join(' ');

      const chamferPoints = (hw: number, hh: number, c: number): string =>
        [
          `${(-hw + c).toFixed(1)},${(-hh).toFixed(1)}`,
          `${(hw - c).toFixed(1)},${(-hh).toFixed(1)}`,
          `${hw.toFixed(1)},0`,
          `${(hw - c).toFixed(1)},${hh.toFixed(1)}`,
          `${(-hw + c).toFixed(1)},${hh.toFixed(1)}`,
          `${(-hw).toFixed(1)},0`,
        ].join(' ');

      if (hasParentCtx) {
        const upperParent = parentCtx.toUpperCase();
        const mainText = suffix || visual.code;
        const topW = upperParent.length * 5.2;
        const botW = mainText.length * 5.9;
        const estWidth = Math.max(66, Math.round(Math.max(topW, botW) + 26));
        const height = 32;
        const halfW = estWidth / 2;
        const halfH = height / 2;
        const cut = 6.4;
        const haloPad = 2.5;

        const shadow = doc.createElementNS(SVG_NS, 'path');
        shadow.setAttribute('d', chamferPath(halfW, halfH, cut, 1.6));
        shadow.setAttribute('fill', '#020617');
        shadow.setAttribute('fill-opacity', isLight ? '0.16' : '0.44');
        groupEl.appendChild(shadow);

        const halo = doc.createElementNS(SVG_NS, 'polygon');
        halo.setAttribute(
          'points',
          chamferPoints(halfW + haloPad, halfH + haloPad, cut + 1.1),
        );
        halo.setAttribute('fill', 'none');
        halo.setAttribute(
          'stroke',
          state.interaction.isPinned
            ? '#f59e0b'
            : isActive
              ? hoverStroke
              : palette.haloHex,
        );
        halo.setAttribute('stroke-width', isActive ? '1.85' : '1.25');
        halo.setAttribute(
          'stroke-opacity',
          isActive || state.interaction.isPinned ? '0.96' : isLight ? '0.56' : '0.7',
        );
        if (!isActive) {
          halo.setAttribute('stroke-dasharray', '3 2');
        }
        halo.setAttribute('stroke-linejoin', 'round');
        groupEl.appendChild(halo);

        const bg = doc.createElementNS(SVG_NS, 'polygon');
        bg.setAttribute('points', chamferPoints(halfW, halfH, cut));
        bg.setAttribute('fill', palette.solidFillHex);
        bg.setAttribute('stroke', state.interaction.isPinned ? '#fef08a' : '#ffffff');
        bg.setAttribute('stroke-width', isActive ? '1.55' : '1.0');
        bg.setAttribute('stroke-opacity', isActive ? '0.92' : '0.3');
        bg.setAttribute('stroke-linejoin', 'round');
        groupEl.appendChild(bg);

        const parentEl = doc.createElementNS(SVG_NS, 'text');
        parentEl.setAttribute('x', '0');
        parentEl.setAttribute('y', '-4.2');
        parentEl.setAttribute('text-anchor', 'middle');
        parentEl.setAttribute('fill', '#ffffff');
        parentEl.setAttribute('fill-opacity', '0.78');
        parentEl.setAttribute('font-size', '7.4');
        parentEl.setAttribute('font-weight', '700');
        parentEl.setAttribute('letter-spacing', '0.05em');
        parentEl.setAttribute('font-family', 'IBM Plex Mono, monospace');
        parentEl.textContent = upperParent;
        groupEl.appendChild(parentEl);

        const facetEl = doc.createElementNS(SVG_NS, 'text');
        facetEl.setAttribute('x', '0');
        facetEl.setAttribute('y', '7.6');
        facetEl.setAttribute('text-anchor', 'middle');
        facetEl.setAttribute('fill', '#ffffff');
        facetEl.setAttribute('font-size', '9.3');
        facetEl.setAttribute('font-weight', '700');
        facetEl.setAttribute('font-family', 'Plus Jakarta Sans, sans-serif');
        facetEl.textContent = mainText;
        groupEl.appendChild(facetEl);
        return;
      }

      const displayLine = suffix || visual.code;
      const contentW = displayLine.length * 5.8;
      const estWidth = Math.max(52, Math.round(contentW + 24));
      const height = 22;
      const halfW = estWidth / 2;
      const halfH = height / 2;
      const cut = 5.5;
      const haloPad = 2.4;

      // 1. Grounding shadow (<path> so first <polygon> remains the dashed outer halo)
      const shadow = doc.createElementNS(SVG_NS, 'path');
      shadow.setAttribute('d', chamferPath(halfW, halfH, cut, 1.5));
      shadow.setAttribute('fill', '#020617');
      shadow.setAttribute('fill-opacity', isLight ? '0.15' : '0.42');
      groupEl.appendChild(shadow);

      // 2. Outer chamfered docking halo (<polygon> #1: dashed at rest, measured by getBBox)
      const halo = doc.createElementNS(SVG_NS, 'polygon');
      halo.setAttribute(
        'points',
        chamferPoints(halfW + haloPad, halfH + haloPad, cut + 1.1),
      );
      halo.setAttribute('fill', 'none');
      halo.setAttribute(
        'stroke',
        state.interaction.isPinned
          ? '#f59e0b'
          : isActive
            ? hoverStroke
            : palette.haloHex,
      );
      halo.setAttribute('stroke-width', isActive ? '1.8' : '1.2');
      halo.setAttribute(
        'stroke-opacity',
        isActive || state.interaction.isPinned ? '0.96' : isLight ? '0.54' : '0.68',
      );
      if (!isActive) {
        halo.setAttribute('stroke-dasharray', '3 2');
      }
      halo.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(halo);

      // 3. Saturated OKLab-calibrated jewel-tone chamfered body (<polygon> #2)
      const bg = doc.createElementNS(SVG_NS, 'polygon');
      bg.setAttribute('points', chamferPoints(halfW, halfH, cut));
      bg.setAttribute('fill', palette.solidFillHex);
      bg.setAttribute('stroke', state.interaction.isPinned ? '#fef08a' : '#ffffff');
      bg.setAttribute('stroke-width', isActive ? '1.5' : '1.0');
      bg.setAttribute('stroke-opacity', isActive ? '0.92' : '0.28');
      bg.setAttribute('stroke-linejoin', 'round');
      groupEl.appendChild(bg);

      // 4. Centered crisp white typography
      const labelText = doc.createElementNS(SVG_NS, 'text');
      labelText.setAttribute('x', '0');
      labelText.setAttribute('y', '3.3');
      labelText.setAttribute('text-anchor', 'middle');
      labelText.setAttribute('fill', '#ffffff');
      labelText.setAttribute('font-size', '9.1');
      labelText.setAttribute('font-weight', '700');
      labelText.setAttribute('font-family', 'Plus Jakarta Sans, sans-serif');
      labelText.textContent = displayLine;
      groupEl.appendChild(labelText);
      return;
    }

    const codeSpan = Math.max(20, visual.code.length * 6.4 + 6);
    const headerContentW = codeSpan + visual.title.length * 6.9;
    const metaW = visual.metaLine.length * 5.9;
    const estWidth = Math.max(126, Math.round(Math.max(headerContentW + 34, metaW + 34)));
    const height = 42;
    const halfW = estWidth / 2;
    const halfH = height / 2;
    const rx = halfH;

    // Subtle elevation ground shadow (<path> so primary <rect> remains unambiguous first <rect>)
    const shadow = doc.createElementNS(SVG_NS, 'path');
    shadow.setAttribute(
      'd',
      roundedRectSvgPath(-halfW, -halfH + 1.8, estWidth, height, rx),
    );
    shadow.setAttribute('fill', '#020617');
    shadow.setAttribute('fill-opacity', isLight ? '0.16' : '0.45');
    groupEl.appendChild(shadow);

    // Outer docking halo ring (<path>)
    const haloPad = 2.8;
    const halo = doc.createElementNS(SVG_NS, 'path');
    halo.setAttribute(
      'd',
      roundedRectSvgPath(
        -halfW - haloPad,
        -halfH - haloPad,
        estWidth + haloPad * 2,
        height + haloPad * 2,
        rx + haloPad,
      ),
    );
    halo.setAttribute('fill', 'none');
    halo.setAttribute(
      'stroke',
      state.interaction.isPinned ? '#f59e0b' : palette.haloHex,
    );
    halo.setAttribute('stroke-width', isActive ? '1.9' : '1.25');
    halo.setAttribute(
      'stroke-opacity',
      isActive || state.interaction.isPinned ? '0.96' : isLight ? '0.48' : '0.64',
    );
    groupEl.appendChild(halo);

    // Saturated primary cluster capsule (<rect height="42">)
    const bg = doc.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(-halfW));
    bg.setAttribute('y', String(-halfH));
    bg.setAttribute('width', String(estWidth));
    bg.setAttribute('height', String(height));
    bg.setAttribute('rx', String(rx));
    bg.setAttribute('fill', palette.solidFillHex);
    bg.setAttribute(
      'stroke',
      state.interaction.isPinned ? '#fef08a' : '#ffffff',
    );
    bg.setAttribute('stroke-width', isActive ? '1.6' : '1.0');
    bg.setAttribute('stroke-opacity', isActive ? '0.92' : '0.28');
    groupEl.appendChild(bg);

    const startX = -headerContentW / 2;
    const codeText = doc.createElementNS(SVG_NS, 'text');
    codeText.setAttribute('x', String(Math.round(startX)));
    codeText.setAttribute('y', '-3');
    codeText.setAttribute('fill', '#ffffff');
    codeText.setAttribute('fill-opacity', '0.86');
    codeText.setAttribute('font-size', '9.8');
    codeText.setAttribute('font-weight', '600');
    codeText.setAttribute('font-family', 'IBM Plex Mono, monospace');
    codeText.textContent = visual.code;
    groupEl.appendChild(codeText);

    const titleText = doc.createElementNS(SVG_NS, 'text');
    titleText.setAttribute('x', String(Math.round(startX + codeSpan)));
    titleText.setAttribute('y', '-3');
    titleText.setAttribute('fill', '#ffffff');
    titleText.setAttribute('font-size', '11');
    titleText.setAttribute('font-weight', '700');
    titleText.setAttribute('letter-spacing', '0.01em');
    titleText.setAttribute('font-family', 'Plus Jakarta Sans, sans-serif');
    titleText.textContent = visual.title;
    groupEl.appendChild(titleText);

    const subText = doc.createElementNS(SVG_NS, 'text');
    subText.setAttribute('x', '0');
    subText.setAttribute('y', '12.5');
    subText.setAttribute('text-anchor', 'middle');
    subText.setAttribute('fill', '#ffffff');
    subText.setAttribute('fill-opacity', '0.84');
    subText.setAttribute('font-size', '9.3');
    subText.setAttribute('font-family', 'IBM Plex Mono, monospace');
    subText.textContent = visual.metaLine;
    groupEl.appendChild(subText);
  }
}
