import {
  rectToConvexPolygon,
  type ClusterDescriptor,
  type ContentLayoutContext,
  type ConvexGeometry,
  type NodeRenderState,
} from '@simplex-viz/core';
import { SVG_NS, type SvgNodeView } from '@simplex-viz/svg';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

export interface ContentDomainRecord<TItem, TTagMeta, TClusterMeta> {
  readonly item: TItem;
  readonly ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>;
}

/**
 * Bridges a declarative React JSX render function into an `@simplex-viz/svg` `SvgNodeView`
 * with automatic offscreen `getBBox()` convex hull measurement and cached DOM updates.
 */
export class ReactJsxSvgView<TVisual, TDomain> implements SvgNodeView<TVisual> {
  private readonly renderFn: (
    domain: TDomain,
    state: NodeRenderState<TVisual>,
  ) => ReactNode;
  private readonly getKey: (visual: TVisual) => string;
  private readonly domainByKey: ReadonlyMap<string, TDomain>;
  private readonly rootsByGroup = new WeakMap<SVGGElement, Root>();
  private readonly activeRoots = new Set<Root>();
  private measureGroup: SVGGElement | null = null;

  constructor(params: {
    readonly renderFn: (domain: TDomain, state: NodeRenderState<TVisual>) => ReactNode;
    readonly getKey: (visual: TVisual) => string;
    readonly domainByKey: ReadonlyMap<string, TDomain>;
  }) {
    this.renderFn = params.renderFn;
    this.getKey = params.getKey;
    this.domainByKey = params.domainByKey;
  }

  measureConvexHull(visual: TVisual, measureSvg: SVGSVGElement): ConvexGeometry {
    const key = this.getKey(visual);
    const domain = this.domainByKey.get(key);
    if (!domain) {
      return rectToConvexPolygon(48, 28, 6);
    }

    const doc = measureSvg.ownerDocument;
    let bin = measureSvg.querySelector<SVGGElement>('g.sv-measure-bin');
    if (!bin) {
      bin = doc.createElementNS(SVG_NS, 'g');
      bin.setAttribute('class', 'sv-measure-bin');
      bin.setAttribute('visibility', 'hidden');
      bin.setAttribute('pointer-events', 'none');
      bin.setAttribute('transform', 'translate(-99999, -99999)');
      measureSvg.appendChild(bin);
    }

    if (!this.measureGroup || this.measureGroup.parentNode !== bin) {
      this.measureGroup = doc.createElementNS(SVG_NS, 'g');
      bin.appendChild(this.measureGroup);
    }

    const dummyState: NodeRenderState<TVisual> = {
      id: '__measure__',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      visual,
      hull: { kind: 'circle', radius: 16 },
      cacheKey: key,
      interaction: {
        isHovered: false,
        isPinned: false,
        isDimmed: false,
        isHighlighted: false,
      },
      transition: null,
    };

    const jsx = this.renderFn(domain, dummyState);
    const markup = renderToStaticMarkup(jsx);
    // Parse JSX markup into SVG namespace inside the offscreen measurement group
    const wrapperSvg = doc.createElementNS(SVG_NS, 'svg');
    wrapperSvg.innerHTML = markup;
    while (this.measureGroup.firstChild) {
      this.measureGroup.removeChild(this.measureGroup.firstChild);
    }
    while (wrapperSvg.firstChild) {
      this.measureGroup.appendChild(wrapperSvg.firstChild);
    }

    let width = 0;
    let height = 0;
    try {
      if (typeof this.measureGroup.getBBox === 'function') {
        const bbox = this.measureGroup.getBBox();
        width = bbox.width;
        height = bbox.height;
      }
    } catch {
      // Headless DOM without layout engine
    }

    if (width <= 1 || height <= 1) {
      let maxHalfW = 0;
      let maxHalfH = 0;
      this.measureGroup.querySelectorAll('rect, circle, text').forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'rect') {
          const w = parseFloat(el.getAttribute('width') ?? '0');
          const h = parseFloat(el.getAttribute('height') ?? '0');
          maxHalfW = Math.max(maxHalfW, w / 2);
          maxHalfH = Math.max(maxHalfH, h / 2);
        } else if (tag === 'circle') {
          const r = parseFloat(el.getAttribute('r') ?? '0');
          maxHalfW = Math.max(maxHalfW, r);
          maxHalfH = Math.max(maxHalfH, r);
        } else if (tag === 'text') {
          const len = (el.textContent ?? '').length;
          const fs = parseFloat(el.getAttribute('font-size') ?? '11');
          maxHalfW = Math.max(maxHalfW, (len * fs * 0.56) / 2);
          maxHalfH = Math.max(maxHalfH, fs * 0.75);
        }
      });
      width = Math.max(24, maxHalfW * 2);
      height = Math.max(20, maxHalfH * 2);
    }

    return rectToConvexPolygon(width + 4, height + 4, 6);
  }

  mountOrUpdate(
    groupEl: SVGGElement,
    visual: TVisual,
    state: NodeRenderState<TVisual>,
  ): void {
    const key = this.getKey(visual);
    const domain = this.domainByKey.get(key);
    if (!domain) return;

    let root = this.rootsByGroup.get(groupEl);
    if (!root) {
      while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild);
      root = createRoot(groupEl);
      this.rootsByGroup.set(groupEl, root);
      this.activeRoots.add(root);
    }

    root.render(this.renderFn(domain, state));
  }

  dispose(): void {
    const roots = [...this.activeRoots];
    this.activeRoots.clear();
    this.measureGroup = null;
    queueMicrotask(() => {
      for (const r of roots) {
        r.unmount();
      }
    });
  }
}

export type ContentJsxRenderFn<TItem, TContentVisual, TTagMeta, TClusterMeta> = (
  item: TItem,
  ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
  state: NodeRenderState<TContentVisual>,
) => ReactNode;

export type ClusterJsxRenderFn<TItem, TClusterVisual, TTagMeta, TClusterMeta> = (
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  state: NodeRenderState<TClusterVisual>,
) => ReactNode;
