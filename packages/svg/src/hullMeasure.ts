import {
  rectToConvexPolygon,
  type ConvexGeometry,
  type NodeRenderState,
} from '@simplex-viz/core';
import type { SvgNodeView } from './types';

export const SVG_NS = 'http://www.w3.org/2000/svg';

function estimateSvgFallbackBBox(group: SVGGElement): { width: number; height: number } {
  // Fallback for headless test environments where SVGElement.getBBox() returns 0x0
  let maxHalfW = 0;
  let maxHalfH = 0;
  const children = group.querySelectorAll('rect, circle, ellipse, text');
  children.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
      const w = parseFloat(el.getAttribute('width') ?? '0');
      const h = parseFloat(el.getAttribute('height') ?? '0');
      const x = parseFloat(el.getAttribute('x') ?? String(-w / 2));
      const y = parseFloat(el.getAttribute('y') ?? String(-h / 2));
      maxHalfW = Math.max(maxHalfW, Math.abs(x), Math.abs(x + w), w / 2);
      maxHalfH = Math.max(maxHalfH, Math.abs(y), Math.abs(y + h), h / 2);
    } else if (tag === 'circle') {
      const r = parseFloat(el.getAttribute('r') ?? '0');
      const cx = parseFloat(el.getAttribute('cx') ?? '0');
      const cy = parseFloat(el.getAttribute('cy') ?? '0');
      maxHalfW = Math.max(maxHalfW, Math.abs(cx) + r);
      maxHalfH = Math.max(maxHalfH, Math.abs(cy) + r);
    } else if (tag === 'text') {
      const len = (el.textContent ?? '').length;
      const fs = parseFloat(el.getAttribute('font-size') ?? '11');
      const estW = Math.max(16, len * fs * 0.58);
      const estH = fs * 1.4;
      maxHalfW = Math.max(maxHalfW, estW / 2);
      maxHalfH = Math.max(maxHalfH, estH / 2);
    }
  });
  return {
    width: Math.max(20, maxHalfW * 2),
    height: Math.max(20, maxHalfH * 2),
  };
}

/**
 * Measures the unscaled convex collision hull for a visual descriptor using either
 * the view's analytical `measureConvexHull` or automatic offscreen `getBBox()` inspection.
 */
export function measureVisualWithSvgView<TVisual>(
  view: SvgNodeView<TVisual>,
  visual: TVisual,
  cacheKey: string,
  rootSvg: SVGSVGElement,
  measureBin: SVGGElement,
  cache: Map<string, ConvexGeometry>,
): ConvexGeometry {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let hull: ConvexGeometry;
  if (view.measureConvexHull) {
    hull = view.measureConvexHull(visual, rootSvg);
  } else {
    while (measureBin.firstChild) {
      measureBin.removeChild(measureBin.firstChild);
    }
    const probeGroup = rootSvg.ownerDocument.createElementNS(SVG_NS, 'g');
    measureBin.appendChild(probeGroup);

    const dummyHull: ConvexGeometry = { kind: 'circle', radius: 16 };
    const dummyState: NodeRenderState<TVisual> = {
      id: '__measure__',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      visual,
      hull: dummyHull,
      cacheKey,
      interaction: {
        isHovered: false,
        isPinned: false,
        isDimmed: false,
        isHighlighted: false,
      },
      transition: null,
    };

    view.mountOrUpdate(probeGroup, visual, dummyState);

    let width = 0;
    let height = 0;
    try {
      if (typeof probeGroup.getBBox === 'function') {
        const bbox = probeGroup.getBBox();
        width = bbox.width;
        height = bbox.height;
      }
    } catch {
      // Ignore getBBox exceptions in detached DOM environments
    }

    if (width <= 1 || height <= 1) {
      const fallback = estimateSvgFallbackBBox(probeGroup);
      width = Math.max(width, fallback.width);
      height = Math.max(height, fallback.height);
    }

    hull = rectToConvexPolygon(width + 2, height + 2, 6);
    while (measureBin.firstChild) {
      measureBin.removeChild(measureBin.firstChild);
    }
  }

  cache.set(cacheKey, hull);
  return hull;
}
