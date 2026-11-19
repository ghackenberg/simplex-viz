import type {
  ConvexGeometry,
  DefaultTaggedItem,
  MeshEdgeRenderState,
  MeshTriangleRenderState,
  NodeRenderState,
  SimplexColorTheme,
} from '@simplex-viz/core';

/**
 * Pluggable, framework-agnostic SVG node renderer for `@simplex-viz/svg`.
 *
 * Works identically in Vanilla TypeScript, Vue, Angular, Svelte, Web Components, and React.
 */
export interface SvgNodeView<TVisual> {
  /**
   * Optional hover scale multiplier applied on the outer node `<g>` when hovered
   * (without altering collision hulls or triggering layout reflow). Defaults to `1`.
   */
  readonly hoverScale?: number;

  /**
   * Optional opacity multiplier in `[0, 1]` applied on the outer node `<g>` when dimmed
   * (and not hovered). Defaults to `0.34`.
   */
  readonly dimmedOpacity?: number;

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

/**
 * Pluggable, framework-agnostic SVG renderer for triangulation triangle faces.
 */
export interface SvgTriangleView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Optional version/option signature appended to adapter dirty-check cache keys. */
  readonly cacheKey?: string;

  /**
   * Creates or updates the interior SVG elements of `groupEl` for a single simplex triangle face.
   */
  mountOrUpdate(
    groupEl: SVGGElement,
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void;
}

/**
 * Pluggable, framework-agnostic SVG renderer for triangulation mesh edges.
 */
export interface SvgEdgeView<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Optional version/option signature appended to adapter dirty-check cache keys. */
  readonly cacheKey?: string;

  /**
   * Creates or updates the interior SVG elements of `groupEl` for a single mesh edge.
   */
  mountOrUpdate(
    groupEl: SVGGElement,
    edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
    theme: SimplexColorTheme,
  ): void;
}
