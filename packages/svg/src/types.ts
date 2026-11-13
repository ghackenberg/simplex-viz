import type { ConvexGeometry, NodeRenderState } from '@simplex-viz/core';

/**
 * Pluggable, framework-agnostic SVG node renderer for `@simplex-viz/svg`.
 *
 * Works identically in Vanilla TypeScript, Vue, Angular, Svelte, Web Components, and React.
 */
export interface SvgNodeView<TVisual> {
  /**
   * Optional analytical convex hull at scale `1.0` centered around `(0, 0)`.
   *
   * When omitted, `@simplex-viz/svg` automatically mounts the visual inside a hidden
   * measurement group and derives a convex polygon via `getBBox()`.
   */
  measureConvexHull?(visual: TVisual, measureSvg: SVGSVGElement): ConvexGeometry;

  /**
   * Creates or updates the interior SVG elements of `groupEl` around local origin `(0, 0)`.
   * Outer position `(x, y)`, solver scale `alpha`, and opacity are managed at 60 fps
   * by `SvgRendererAdapter` on the parent `<g>`.
   */
  mountOrUpdate(
    groupEl: SVGGElement,
    visual: TVisual,
    state: NodeRenderState<TVisual>,
  ): void;

  /**
   * Optional specialized parametric morphing between `from` and `to` at `progress \in [0, 1]`.
   * Return `true` if handled; return `false` (or omit) to use the universal Dual-Layer Crossfade.
   */
  morph?(
    groupEl: SVGGElement,
    from: TVisual,
    to: TVisual,
    progress: number,
    state: NodeRenderState<TVisual>,
  ): boolean;
}
