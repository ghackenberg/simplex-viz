import {
  getHullBoundingRadius,
  hexToOklab,
  mixOklabColors,
  type ClusterDescriptor,
  type ConvexGeometry,
  type DefaultTaggedItem,
  type MeshEdgeRenderState,
  type MeshTriangleRenderState,
  type NodeRenderState,
  type Point2D,
  type SceneFrameSnapshot,
  type SimplexColorTheme,
  type SimplexKeyboardFocusTarget,
  type SimplexRendererAdapter,
} from '@simplex-viz/core';
import { measureVisualWithSvgView, SVG_NS } from './hullMeasure.js';
import type { SvgEdgeView, SvgNodeView, SvgTriangleView } from './types.js';
import {
  DashedMeshEdgeSvgView,
  OklabTintTriangleSvgView,
} from './views/MeshFaceEdgeViews.js';

/** Semantic ARIA attributes applied to an SVG cluster, item, or triangle group. */
export interface SvgAriaAttributes {
  readonly role?: string;
  readonly label?: string;
  readonly hidden?: boolean;
  readonly pressed?: boolean;
}

/** Optional callbacks resolving domain-aware ARIA metadata for rendered SVG scene elements. */
export interface SvgAriaMetadataResolver<
  TContentVisual,
  TClusterVisual,
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly getClusterAria?: (
    node: NodeRenderState<TClusterVisual>,
  ) => SvgAriaAttributes;
  readonly getItemAria?: (
    node: NodeRenderState<TContentVisual>,
  ) => SvgAriaAttributes;
  readonly getTriangleAria?: (
    triangle: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
  ) => SvgAriaAttributes;
}

export interface SvgRendererOptions<
  TContentVisual,
  TClusterVisual,
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly contentView: SvgNodeView<TContentVisual>;
  readonly clusterView: SvgNodeView<TClusterVisual>;
  readonly triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
  readonly edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
  readonly theme?: SimplexColorTheme;
  /** Optional unique ID prefix used to assign collision-free DOM `id` attributes for `aria-activedescendant`. */
  readonly ariaIdPrefix?: string;
  /** Optional callbacks resolving domain-aware `role` and `aria-label` attributes on SVG nodes and triangles. */
  readonly ariaMetadataResolver?: SvgAriaMetadataResolver<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
}

function sanitizeSvgIdToken(raw: string): string {
  return raw.replace(
    /[^a-zA-Z0-9-]/g,
    (ch) => `_${ch.charCodeAt(0).toString(16)}_`,
  );
}

function applyAriaAttributes(el: Element, attrs: SvgAriaAttributes): void {
  if (attrs.hidden) {
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.removeAttribute('aria-pressed');
    return;
  }
  el.removeAttribute('aria-hidden');
  if (attrs.role) {
    el.setAttribute('role', attrs.role);
  } else {
    el.removeAttribute('role');
  }
  if (attrs.label) {
    el.setAttribute('aria-label', attrs.label);
  } else {
    el.removeAttribute('aria-label');
  }
  if (attrs.pressed !== undefined) {
    el.setAttribute('aria-pressed', attrs.pressed ? 'true' : 'false');
  } else {
    el.removeAttribute('aria-pressed');
  }
}

interface TrackedNodeDom<TVisual> {
  readonly rootGroup: SVGGElement;
  mainLayer: SVGGElement | null;
  fromLayer: SVGGElement | null;
  toLayer: SVGGElement | null;
  lastMainKey: string | null;
  lastFromKey: string | null;
  lastToKey: string | null;
  lastInteractionSig: string | null;
  lastMorphUsed: boolean;
  /** Keep view reference per cacheKey so cross-preset transitions crossfade smoothly. */
  lastView?: SvgNodeView<TVisual>;
}

interface TrackedMeshPartDom {
  readonly group: SVGGElement;
  lastSig: string | null;
}

function interactionSignature<TVisual>(state: NodeRenderState<TVisual>): string {
  const { isHovered, isPinned, isDimmed, isHighlighted, isSelected } = state.interaction;
  return `${isHovered ? 1 : 0}${isPinned ? 1 : 0}${isDimmed ? 1 : 0}${isHighlighted ? 1 : 0}${isSelected ? 1 : 0}`;
}

function triangleSignature<TItem, TTagMeta, TClusterMeta>(
  tr: MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
  theme: SimplexColorTheme,
  viewSeq: number,
  viewKey: string,
): string {
  const pts = tr.points
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(';');
  const { isHovered, isFocused, isDimmed, isHighlighted } = tr.interaction;
  const hb = tr.highlightBoundary
    ? `${tr.highlightBoundary.edges.map((b) => (b ? 1 : 0)).join('')}${tr.highlightBoundary.corners.map((b) => (b ? 1 : 0)).join('')}`
    : '';
  const clusterColors = tr.clusters.map((c) => c?.colorHex ?? '').join(',');
  return `${viewSeq}:${viewKey}:${theme}:${pts}:${tr.fillHex}:${tr.fillOpacity.toFixed(3)}:${tr.coveredItemCount}:${tr.interiorItemCount}:${clusterColors}:${isHovered ? 1 : 0}${isFocused ? 1 : 0}${isDimmed ? 1 : 0}${isHighlighted ? 1 : 0}:${hb}:${tr.isDrillable ? 1 : 0}:${tr.isContext ? 1 : 0}:${tr.neighborId ?? ''}`;
}

function edgeSignature<TItem, TTagMeta, TClusterMeta>(
  edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>,
  theme: SimplexColorTheme,
  viewSeq: number,
  viewKey: string,
): string {
  const c0 = edge.clusters[0]?.colorHex ?? '';
  const c1 = edge.clusters[1]?.colorHex ?? '';
  return `${viewSeq}:${viewKey}:${theme}:${edge.a.x.toFixed(2)},${edge.a.y.toFixed(2)}-${edge.b.x.toFixed(2)},${edge.b.y.toFixed(2)}:${edge.mixedColorHex}:${c0},${c1}:${edge.isHighlighted ? 1 : 0}:${edge.isDimmed ? 1 : 0}`;
}

interface DrillSubdivisionEdgeEntry<TItem, TTagMeta, TClusterMeta> {
  readonly triangleIndex: number;
  readonly subIndex: 0 | 1 | 2;
  readonly edge: MeshEdgeRenderState<TItem, TTagMeta, TClusterMeta>;
}

function buildDrillSubdivisionEdges<TItem, TTagMeta, TClusterMeta>(
  triangles: readonly MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>[],
): DrillSubdivisionEdgeEntry<TItem, TTagMeta, TClusterMeta>[] {
  const result: DrillSubdivisionEdgeEntry<TItem, TTagMeta, TClusterMeta>[] = [];
  let seq = 0;

  for (const tr of triangles) {
    if (!tr.isDrillable || tr.isContext || tr.index <= -10000) continue;

    const [p0, p1, p2] = tr.points;
    const l0 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const l1 = Math.hypot(p0.x - p2.x, p0.y - p2.y);
    const l2 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const perim = l0 + l1 + l2;
    if (perim < 24) continue;

    const twiceArea = Math.abs(
      (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x),
    );
    if (twiceArea / perim < 10) continue;

    const m01: Point2D = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
    const m12: Point2D = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
    const m20: Point2D = { x: (p2.x + p0.x) * 0.5, y: (p2.y + p0.y) * 0.5 };

    const fallbackLab = hexToOklab(tr.fillHex);
    const [c0, c1, c2] = tr.clusters;
    const mix01 = mixOklabColors([
      { oklab: c0?.oklab ?? fallbackLab, weight: 1 },
      { oklab: c1?.oklab ?? fallbackLab, weight: 1 },
    ]);
    const mix12 = mixOklabColors([
      { oklab: c1?.oklab ?? fallbackLab, weight: 1 },
      { oklab: c2?.oklab ?? fallbackLab, weight: 1 },
    ]);
    const mix20 = mixOklabColors([
      { oklab: c2?.oklab ?? fallbackLab, weight: 1 },
      { oklab: c0?.oklab ?? fallbackLab, weight: 1 },
    ]);

    const synthCluster = (
      protoA: ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
      protoB: ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
      mix: { readonly hex: string; readonly oklab: readonly [number, number, number] },
    ): ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined => {
      const proto = protoA ?? protoB;
      return proto ? { ...proto, colorHex: mix.hex, oklab: mix.oklab } : undefined;
    };

    const c01 = synthCluster(c0, c1, mix01);
    const c12 = synthCluster(c1, c2, mix12);
    const c20 = synthCluster(c2, c0, mix20);

    const isDimmed = Boolean(
      tr.interaction.isDimmed && !tr.interaction.isHovered && !tr.interaction.isFocused,
    );
    const [v0, v1, v2] = tr.vertexIndices;

    const segments: ReadonlyArray<{
      readonly subIndex: 0 | 1 | 2;
      readonly a: Point2D;
      readonly b: Point2D;
      readonly verts: readonly [number, number];
      readonly mixedColorHex: string;
      readonly clusters: readonly [
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
      ];
    }> = [
      {
        subIndex: 0,
        a: m01,
        b: m12,
        verts: [v0, v1],
        mixedColorHex: mixOklabColors([
          { oklab: mix01.oklab, weight: 1 },
          { oklab: mix12.oklab, weight: 1 },
        ]).hex,
        clusters: [c01, c12],
      },
      {
        subIndex: 1,
        a: m12,
        b: m20,
        verts: [v1, v2],
        mixedColorHex: mixOklabColors([
          { oklab: mix12.oklab, weight: 1 },
          { oklab: mix20.oklab, weight: 1 },
        ]).hex,
        clusters: [c12, c20],
      },
      {
        subIndex: 2,
        a: m20,
        b: m01,
        verts: [v2, v0],
        mixedColorHex: mixOklabColors([
          { oklab: mix20.oklab, weight: 1 },
          { oklab: mix01.oklab, weight: 1 },
        ]).hex,
        clusters: [c20, c01],
      },
    ];

    for (const seg of segments) {
      result.push({
        triangleIndex: tr.index,
        subIndex: seg.subIndex,
        edge: {
          index: seq++,
          vertexIndices: seg.verts,
          a: seg.a,
          b: seg.b,
          mixedColorHex: seg.mixedColorHex,
          clusters: seg.clusters,
          isHighlighted: false,
          isDimmed: isDimmed || undefined,
          opacity: tr.opacity,
        },
      });
    }
  }

  return result;
}

/**
 * Framework-agnostic SVG scene-graph renderer implementing `SimplexRendererAdapter`.
 *
 * Performs keyed `<g>` reconciliation, direct 60fps `transform`/`opacity` attribute updates,
 * pluggable triangle face & edge views, automatic offscreen `getBBox()` convex hull measurement,
 * and universal Dual-Layer Crossfade (or optional parametric `morph()`).
 */
export class SvgRendererAdapter<
  TContentVisual,
  TClusterVisual,
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> implements
    SimplexRendererAdapter<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >
{
  private readonly svgEl: SVGSVGElement;
  private readonly doc: Document;
  private readonly worldGroup: SVGGElement;
  private readonly trianglesGroup: SVGGElement;
  private readonly drillEdgesGroup: SVGGElement;
  private readonly edgesGroup: SVGGElement;
  private readonly clustersGroup: SVGGElement;
  private readonly itemsGroup: SVGGElement;
  private readonly focusRingGroup: SVGGElement;
  private readonly hullsGroup: SVGGElement;
  private readonly measureBin: SVGGElement;

  private contentView: SvgNodeView<TContentVisual>;
  private clusterView: SvgNodeView<TClusterVisual>;
  private triangleView: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
  private edgeView: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
  private theme: SimplexColorTheme;
  private readonly ariaIdPrefix: string | null;
  private ariaMetadataResolver?: SvgAriaMetadataResolver<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  private keyboardFocusTarget: SimplexKeyboardFocusTarget | null = null;
  private triangleViewSeq = 0;
  private edgeViewSeq = 0;

  private readonly contentHullCache = new Map<string, ConvexGeometry>();
  private readonly clusterHullCache = new Map<string, ConvexGeometry>();
  private readonly contentViewByKey = new Map<string, SvgNodeView<TContentVisual>>();
  private readonly clusterViewByKey = new Map<string, SvgNodeView<TClusterVisual>>();

  private readonly clusterDomMap = new Map<string, TrackedNodeDom<TClusterVisual>>();
  private readonly itemDomMap = new Map<string, TrackedNodeDom<TContentVisual>>();
  private readonly triangleDom: TrackedMeshPartDom[] = [];
  private readonly drillEdgeDom: TrackedMeshPartDom[] = [];
  private readonly edgeDom: TrackedMeshPartDom[] = [];

  constructor(
    svgEl: SVGSVGElement,
    options: SvgRendererOptions<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.svgEl = svgEl;
    this.doc = svgEl.ownerDocument;
    this.contentView = options.contentView;
    this.clusterView = options.clusterView;
    this.triangleView =
      options.triangleView ??
      new OklabTintTriangleSvgView<TItem, TTagMeta, TClusterMeta>();
    this.edgeView =
      options.edgeView ??
      new DashedMeshEdgeSvgView<TItem, TTagMeta, TClusterMeta>();
    this.theme = options.theme ?? 'dark';
    this.ariaIdPrefix = options.ariaIdPrefix ?? null;
    this.ariaMetadataResolver = options.ariaMetadataResolver;

    while (this.svgEl.firstChild) {
      this.svgEl.removeChild(this.svgEl.firstChild);
    }

    this.worldGroup = this.createGroup('sv-world');
    this.trianglesGroup = this.createGroup('sv-mesh-triangles');
    this.drillEdgesGroup = this.createGroup('sv-drill-edges');
    this.drillEdgesGroup.setAttribute('pointer-events', 'none');
    this.drillEdgesGroup.setAttribute('aria-hidden', 'true');
    this.edgesGroup = this.createGroup('sv-mesh-edges');
    this.edgesGroup.setAttribute('aria-hidden', 'true');
    this.clustersGroup = this.createGroup('sv-clusters');
    this.itemsGroup = this.createGroup('sv-items');
    this.focusRingGroup = this.createGroup('sv-a11y-focus-ring');
    this.focusRingGroup.setAttribute('pointer-events', 'none');
    this.focusRingGroup.setAttribute('aria-hidden', 'true');
    this.hullsGroup = this.createGroup('sv-hull-overlay');
    this.hullsGroup.setAttribute('pointer-events', 'none');
    this.hullsGroup.setAttribute('aria-hidden', 'true');

    this.worldGroup.appendChild(this.trianglesGroup);
    this.worldGroup.appendChild(this.drillEdgesGroup);
    this.worldGroup.appendChild(this.edgesGroup);
    this.worldGroup.appendChild(this.clustersGroup);
    this.worldGroup.appendChild(this.itemsGroup);
    this.worldGroup.appendChild(this.focusRingGroup);
    this.worldGroup.appendChild(this.hullsGroup);

    this.measureBin = this.createGroup('sv-measure-bin');
    this.measureBin.setAttribute('visibility', 'hidden');
    this.measureBin.setAttribute('pointer-events', 'none');
    this.measureBin.setAttribute('aria-hidden', 'true');
    this.measureBin.setAttribute('transform', 'translate(-99999, -99999)');

    this.svgEl.appendChild(this.worldGroup);
    this.svgEl.appendChild(this.measureBin);
  }

  private createGroup(className: string): SVGGElement {
    const g = this.doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', className);
    return g;
  }

  /**
   * Computes the deterministic DOM `id` assigned to a rendered cluster, item, or triangle
   * for `aria-activedescendant` linkage, or `null` when `ariaIdPrefix` is not configured.
   */
  getDomIdForTarget(target: SimplexKeyboardFocusTarget): string | null {
    if (!this.ariaIdPrefix) return null;
    if (target.kind === 'cluster') {
      return `${this.ariaIdPrefix}-cluster-${sanitizeSvgIdToken(target.id)}`;
    }
    if (target.kind === 'item') {
      return `${this.ariaIdPrefix}-item-${sanitizeSvgIdToken(target.id)}`;
    }
    return `${this.ariaIdPrefix}-tri-${target.index}`;
  }

  /** Updates the currently keyboard-focused target so the high-contrast focus ring tracks it. */
  setKeyboardFocusTarget(target: SimplexKeyboardFocusTarget | null): void {
    this.keyboardFocusTarget = target;
  }

  /** Returns the currently keyboard-focused target tracked by the renderer. */
  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null {
    return this.keyboardFocusTarget;
  }

  /** Updates optional domain-aware ARIA metadata callbacks. */
  setAriaMetadataResolver(
    resolver?: SvgAriaMetadataResolver<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.ariaMetadataResolver = resolver;
  }

  /**
   * Updates the active color theme forwarded to `SvgTriangleView` and `SvgEdgeView`.
   */
  setTheme(theme: SimplexColorTheme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    for (const d of this.triangleDom) d.lastSig = null;
    for (const d of this.drillEdgeDom) d.lastSig = null;
    for (const d of this.edgeDom) d.lastSig = null;
  }

  /**
   * Swaps active content, cluster, triangle face, and/or edge SVG view plugins at runtime
   * and invalidates caches so the engine re-measures and renders smoothly.
   */
  setViews(
    views: Partial<
      Omit<
        SvgRendererOptions<
          TContentVisual,
          TClusterVisual,
          TItem,
          TTagMeta,
          TClusterMeta
        >,
        'theme'
      >
    >,
  ): void {
    if (views.contentView && views.contentView !== this.contentView) {
      this.contentView = views.contentView;
      this.contentHullCache.clear();
    }
    if (views.clusterView && views.clusterView !== this.clusterView) {
      this.clusterView = views.clusterView;
      this.clusterHullCache.clear();
    }
    if (views.triangleView && views.triangleView !== this.triangleView) {
      this.triangleView = views.triangleView;
      this.triangleViewSeq += 1;
      for (const d of this.triangleDom) d.lastSig = null;
    }
    if (views.edgeView && views.edgeView !== this.edgeView) {
      this.edgeView = views.edgeView;
      this.edgeViewSeq += 1;
      for (const d of this.drillEdgeDom) d.lastSig = null;
      for (const d of this.edgeDom) d.lastSig = null;
    }
  }

  /**
   * Clears cached convex-hull measurements and forces mounted node views to re-sync on
   * the next frame (for example after late webfont loading updates text `getBBox()` metrics).
   */
  invalidateHulls(): void {
    this.contentHullCache.clear();
    this.clusterHullCache.clear();
    for (const tracked of this.clusterDomMap.values()) {
      tracked.lastMainKey = null;
    }
    for (const tracked of this.itemDomMap.values()) {
      tracked.lastMainKey = null;
    }
  }

  measureContentHull(visual: TContentVisual, cacheKey: string): ConvexGeometry {
    this.contentViewByKey.set(cacheKey, this.contentView);
    return measureVisualWithSvgView(
      this.contentView,
      visual,
      cacheKey,
      this.svgEl,
      this.measureBin,
      this.contentHullCache,
    );
  }

  measureClusterHull(visual: TClusterVisual, cacheKey: string): ConvexGeometry {
    this.clusterViewByKey.set(cacheKey, this.clusterView);
    return measureVisualWithSvgView(
      this.clusterView,
      visual,
      cacheKey,
      this.svgEl,
      this.measureBin,
      this.clusterHullCache,
    );
  }

  renderFrame(
    snapshot: SceneFrameSnapshot<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.svgEl.setAttribute(
      'viewBox',
      `0 0 ${snapshot.viewportWidth} ${snapshot.viewportHeight}`,
    );
    this.worldGroup.setAttribute(
      'transform',
      `translate(${snapshot.camera.panX.toFixed(2)}, ${snapshot.camera.panY.toFixed(2)}) scale(${snapshot.camera.zoom.toFixed(4)})`,
    );

    // 1. Pluggable Mesh Triangles
    while (this.triangleDom.length < snapshot.triangles.length) {
      const group = this.createGroup('sv-mesh-triangle');
      group.setAttribute('data-triangle-index', String(this.triangleDom.length));
      this.trianglesGroup.appendChild(group);
      this.triangleDom.push({ group, lastSig: null });
    }
    while (this.triangleDom.length > snapshot.triangles.length) {
      const entry = this.triangleDom.pop();
      entry?.group.remove();
    }
    const triViewKey = this.triangleView.cacheKey ?? '';
    for (let i = 0; i < snapshot.triangles.length; i++) {
      const tr = snapshot.triangles[i]!;
      const entry = this.triangleDom[i]!;
      entry.group.setAttribute('data-triangle-index', String(tr.index));
      entry.group.setAttribute('data-covered-items', String(tr.coveredItemCount));
      const isGhost = tr.index <= -10000;
      if (isGhost) {
        entry.group.setAttribute('data-ghost', 'true');
        entry.group.setAttribute('pointer-events', 'none');
      } else {
        entry.group.removeAttribute('data-ghost');
        entry.group.removeAttribute('pointer-events');
      }
      if (tr.isContext && !isGhost) {
        entry.group.setAttribute('data-context', 'true');
      } else {
        entry.group.removeAttribute('data-context');
      }
      if (tr.isDrillable && !isGhost) {
        entry.group.setAttribute('data-drillable', 'true');
      } else {
        entry.group.removeAttribute('data-drillable');
      }
      if (tr.neighborId && !isGhost) {
        entry.group.setAttribute('data-neighbor-id', tr.neighborId);
      } else {
        entry.group.removeAttribute('data-neighbor-id');
      }
      if (tr.opacity !== undefined && tr.opacity < 0.999) {
        entry.group.setAttribute(
          'opacity',
          Math.max(0, Math.min(1, tr.opacity)).toFixed(3),
        );
      } else {
        entry.group.removeAttribute('opacity');
      }
      if (!isGhost && !tr.isContext && this.ariaIdPrefix) {
        entry.group.setAttribute(
          'id',
          this.getDomIdForTarget({ kind: 'triangle', index: tr.index })!,
        );
      } else {
        entry.group.removeAttribute('id');
      }
      const isTriKeyboardFocused =
        !isGhost &&
        !tr.isContext &&
        this.keyboardFocusTarget?.kind === 'triangle' &&
        this.keyboardFocusTarget.index === tr.index;
      if (isTriKeyboardFocused) {
        entry.group.setAttribute('data-keyboard-focused', 'true');
      } else {
        entry.group.removeAttribute('data-keyboard-focused');
      }
      const triAria: SvgAriaAttributes =
        isGhost || tr.isContext
          ? { hidden: true }
          : (this.ariaMetadataResolver?.getTriangleAria?.(tr) ?? {
              role: tr.isDrillable || tr.coveredItemCount > 0 ? 'button' : undefined,
              label:
                tr.isDrillable || tr.coveredItemCount > 0
                  ? `Region ${tr.index + 1}, ${tr.coveredItemCount} ${
                      tr.coveredItemCount === 1 ? 'item' : 'items'
                    }`
                  : undefined,
              hidden: !(tr.isDrillable || tr.coveredItemCount > 0),
              pressed: tr.interaction.isFocused ? true : undefined,
            });
      applyAriaAttributes(entry.group, triAria);
      const sig = triangleSignature(tr, this.theme, this.triangleViewSeq, triViewKey);
      if (entry.lastSig !== sig) {
        this.triangleView.mountOrUpdate(entry.group, tr, this.theme);
        entry.lastSig = sig;
      }
    }

    // 2a. Internal 1:4 Subdivision Edges on Drillable Triangles (rendered with active edgeView)
    const edgeViewKey = this.edgeView.cacheKey ?? '';
    const drillEdges = buildDrillSubdivisionEdges(snapshot.triangles);
    while (this.drillEdgeDom.length < drillEdges.length) {
      const group = this.createGroup('sv-drill-edge');
      this.drillEdgesGroup.appendChild(group);
      this.drillEdgeDom.push({ group, lastSig: null });
    }
    while (this.drillEdgeDom.length > drillEdges.length) {
      const entry = this.drillEdgeDom.pop();
      entry?.group.remove();
    }
    for (let i = 0; i < drillEdges.length; i++) {
      const subItem = drillEdges[i]!;
      const entry = this.drillEdgeDom[i]!;
      entry.group.setAttribute('data-triangle-index', String(subItem.triangleIndex));
      entry.group.setAttribute('data-sub-edge', String(subItem.subIndex));
      if (subItem.edge.opacity !== undefined && subItem.edge.opacity < 0.999) {
        entry.group.setAttribute(
          'opacity',
          Math.max(0, Math.min(1, subItem.edge.opacity)).toFixed(3),
        );
      } else {
        entry.group.removeAttribute('opacity');
      }
      const sig = edgeSignature(
        subItem.edge,
        this.theme,
        this.edgeViewSeq,
        edgeViewKey,
      );
      if (entry.lastSig !== sig) {
        this.edgeView.mountOrUpdate(entry.group, subItem.edge, this.theme);
        entry.lastSig = sig;
      }
    }

    // 2b. Pluggable Outer Mesh Edges
    while (this.edgeDom.length < snapshot.edges.length) {
      const group = this.createGroup('sv-mesh-edge');
      group.setAttribute('data-edge-index', String(this.edgeDom.length));
      this.edgesGroup.appendChild(group);
      this.edgeDom.push({ group, lastSig: null });
    }
    while (this.edgeDom.length > snapshot.edges.length) {
      const entry = this.edgeDom.pop();
      entry?.group.remove();
    }
    for (let i = 0; i < snapshot.edges.length; i++) {
      const edge = snapshot.edges[i]!;
      const entry = this.edgeDom[i]!;
      entry.group.setAttribute('data-edge-index', String(edge.index));
      if (edge.index <= -10000) {
        entry.group.setAttribute('data-ghost', 'true');
        entry.group.setAttribute('pointer-events', 'none');
      } else {
        entry.group.removeAttribute('data-ghost');
        entry.group.removeAttribute('pointer-events');
      }
      if (edge.opacity !== undefined && edge.opacity < 0.999) {
        entry.group.setAttribute(
          'opacity',
          Math.max(0, Math.min(1, edge.opacity)).toFixed(3),
        );
      } else {
        entry.group.removeAttribute('opacity');
      }
      const sig = edgeSignature(edge, this.theme, this.edgeViewSeq, edgeViewKey);
      if (entry.lastSig !== sig) {
        this.edgeView.mountOrUpdate(entry.group, edge, this.theme);
        entry.lastSig = sig;
      }
    }

    // 3. Reconcile Clusters & Content Items
    this.reconcileNodes(
      snapshot.clusters,
      this.clustersGroup,
      this.clusterDomMap,
      this.clusterView,
      this.clusterViewByKey,
      'cluster',
    );
    this.reconcileNodes(
      snapshot.items,
      this.itemsGroup,
      this.itemDomMap,
      this.contentView,
      this.contentViewByKey,
      'item',
    );

    // 4. High-Contrast Keyboard Focus Ring
    this.renderKeyboardFocusRing(snapshot);

    // 5. Optional Convex Hull Debug Overlay
    this.renderHullOverlay(snapshot);
  }

  private reconcileNodes<TVisual>(
    nodes: readonly NodeRenderState<TVisual>[],
    parentGroup: SVGGElement,
    domMap: Map<string, TrackedNodeDom<TVisual>>,
    activeView: SvgNodeView<TVisual>,
    viewByKey: Map<string, SvgNodeView<TVisual>>,
    kind: 'cluster' | 'item',
  ): void {
    const aliveIds = new Set<string>();

    for (const node of nodes) {
      aliveIds.add(node.id);
      let tracked = domMap.get(node.id);
      if (!tracked) {
        const rootGroup = this.doc.createElementNS(SVG_NS, 'g');
        rootGroup.setAttribute('class', `sv-node sv-node-${kind}`);
        rootGroup.setAttribute('data-node-id', node.id);
        parentGroup.appendChild(rootGroup);
        tracked = {
          rootGroup,
          mainLayer: null,
          fromLayer: null,
          toLayer: null,
          lastMainKey: null,
          lastFromKey: null,
          lastToKey: null,
          lastInteractionSig: null,
          lastMorphUsed: false,
        };
        domMap.set(node.id, tracked);
      }

      const isGhostNode = node.id.startsWith('ghost-');
      if (isGhostNode || node.isPassThrough) {
        tracked.rootGroup.setAttribute('pointer-events', 'none');
      } else {
        tracked.rootGroup.removeAttribute('pointer-events');
      }
      if (node.isPassThrough && !isGhostNode) {
        tracked.rootGroup.setAttribute('data-pass-through', 'true');
      } else {
        tracked.rootGroup.removeAttribute('data-pass-through');
      }
      if (node.isFilteredOut && !isGhostNode) {
        tracked.rootGroup.setAttribute('data-filtered-out', 'true');
      } else {
        tracked.rootGroup.removeAttribute('data-filtered-out');
      }
      if (node.isContext && !isGhostNode) {
        tracked.rootGroup.setAttribute('data-context', 'true');
      } else {
        tracked.rootGroup.removeAttribute('data-context');
      }
      if (node.neighborId && !isGhostNode) {
        tracked.rootGroup.setAttribute('data-neighbor-id', node.neighborId);
      } else {
        tracked.rootGroup.removeAttribute('data-neighbor-id');
      }
      if (!isGhostNode && !node.isContext && this.ariaIdPrefix) {
        tracked.rootGroup.setAttribute(
          'id',
          this.getDomIdForTarget(
            kind === 'cluster'
              ? { kind: 'cluster', id: node.id }
              : { kind: 'item', id: node.id },
          )!,
        );
      } else {
        tracked.rootGroup.removeAttribute('id');
      }
      const isKeyboardFocused =
        !isGhostNode &&
        !node.isContext &&
        this.keyboardFocusTarget !== null &&
        this.keyboardFocusTarget.kind === kind &&
        this.keyboardFocusTarget.id === node.id;
      if (isKeyboardFocused) {
        tracked.rootGroup.setAttribute('data-keyboard-focused', 'true');
      } else {
        tracked.rootGroup.removeAttribute('data-keyboard-focused');
      }
      const isHiddenFromA11y =
        isGhostNode ||
        Boolean(node.isContext) ||
        Boolean(node.isPassThrough) ||
        node.opacity < 0.05;
      const nodeAria: SvgAriaAttributes = isHiddenFromA11y
        ? { hidden: true }
        : kind === 'cluster'
          ? (this.ariaMetadataResolver?.getClusterAria?.(
              node as unknown as NodeRenderState<TClusterVisual>,
            ) ?? {
              role: 'button',
              label: `Topic cluster ${node.id}`,
            })
          : (this.ariaMetadataResolver?.getItemAria?.(
              node as unknown as NodeRenderState<TContentVisual>,
            ) ?? {
              role: 'button',
              label: `Item ${node.id}`,
            });
      applyAriaAttributes(tracked.rootGroup, nodeAria);
      if (kind === 'item') {
        if (node.interaction.isSelected) {
          tracked.rootGroup.setAttribute('data-selected', 'true');
          if (!isHiddenFromA11y) {
            tracked.rootGroup.setAttribute('aria-selected', 'true');
          } else {
            tracked.rootGroup.removeAttribute('aria-selected');
          }
        } else {
          tracked.rootGroup.removeAttribute('data-selected');
          tracked.rootGroup.removeAttribute('aria-selected');
        }
      }

      const styleView = node.transition
        ? (viewByKey.get(node.transition.toCacheKey) ?? activeView)
        : (viewByKey.get(node.cacheKey) ?? activeView);
      const dimmedFactor =
        styleView.dimmedOpacity !== undefined && Number.isFinite(styleView.dimmedOpacity)
          ? Math.max(0, Math.min(1, styleView.dimmedOpacity))
          : 0.34;
      const hoverScaleFactor =
        !node.isContext &&
        !node.isPassThrough &&
        node.interaction.isHovered &&
        styleView.hoverScale !== undefined &&
        Number.isFinite(styleView.hoverScale) &&
        styleView.hoverScale > 0
          ? styleView.hoverScale
          : 1;
      const effectiveScale = node.scale * hoverScaleFactor;
      const effectiveOpacity = node.isContext
        ? node.interaction.isHovered
          ? Math.max(node.opacity, 0.72)
          : node.opacity
        : node.interaction.isDimmed
          ? node.opacity *
            (node.interaction.isHovered ? Math.max(dimmedFactor, 0.72) : dimmedFactor)
          : node.opacity;
      tracked.rootGroup.setAttribute(
        'transform',
        `translate(${node.x.toFixed(2)}, ${node.y.toFixed(2)}) scale(${effectiveScale.toFixed(4)})`,
      );
      tracked.rootGroup.setAttribute('opacity', effectiveOpacity.toFixed(3));

      const interSig = interactionSignature(node);
      const interactionChanged = tracked.lastInteractionSig !== interSig;

      if (node.transition) {
        const tr = node.transition;
        const fromView = viewByKey.get(tr.fromCacheKey) ?? tracked.lastView ?? activeView;
        const toView = viewByKey.get(tr.toCacheKey) ?? activeView;

        // Specialized parametric morph if both endpoints belong to the same morph-capable view
        if (fromView === toView && toView.morph) {
          if (!tracked.mainLayer) {
            tracked.mainLayer = this.createGroup('sv-layer-main');
            tracked.rootGroup.appendChild(tracked.mainLayer);
          }
          if (tracked.fromLayer) {
            tracked.fromLayer.remove();
            tracked.fromLayer = null;
          }
          if (tracked.toLayer) {
            tracked.toLayer.remove();
            tracked.toLayer = null;
          }
          const handled = toView.morph(
            tracked.mainLayer,
            tr.from,
            tr.to,
            tr.progress,
            node,
          );
          if (handled) {
            tracked.lastMorphUsed = true;
            tracked.lastMainKey = null;
            tracked.lastInteractionSig = interSig;
            tracked.lastView = toView;
            continue;
          }
        }

        // Universal Dual-Layer Crossfade (max 2 child layers: layer-from + layer-to)
        tracked.lastMorphUsed = false;
        if (tracked.mainLayer) {
          tracked.mainLayer.remove();
          tracked.mainLayer = null;
          tracked.lastMainKey = null;
        }

        if (!tracked.fromLayer) {
          tracked.fromLayer = this.createGroup('sv-layer-from');
          tracked.rootGroup.appendChild(tracked.fromLayer);
        }
        if (!tracked.toLayer) {
          tracked.toLayer = this.createGroup('sv-layer-to');
          tracked.rootGroup.appendChild(tracked.toLayer);
        }

        if (tracked.lastFromKey !== tr.fromCacheKey || interactionChanged) {
          fromView.mountOrUpdate(tracked.fromLayer, tr.from, {
            ...node,
            visual: tr.from,
            hull: tr.fromHull,
            cacheKey: tr.fromCacheKey,
          });
          tracked.lastFromKey = tr.fromCacheKey;
        }

        if (tracked.lastToKey !== tr.toCacheKey || interactionChanged) {
          toView.mountOrUpdate(tracked.toLayer, tr.to, {
            ...node,
            visual: tr.to,
            hull: tr.toHull,
            cacheKey: tr.toCacheKey,
          });
          tracked.lastToKey = tr.toCacheKey;
        }

        // Proportional radius alignment during crossfade between disparate hull sizes
        const rFrom = Math.max(1, getHullBoundingRadius(tr.fromHull));
        const rTo = Math.max(1, getHullBoundingRadius(tr.toHull));
        const currentR = rFrom + (rTo - rFrom) * tr.progress;
        const fromSubScale = Math.max(0.4, Math.min(1.6, currentR / rFrom));
        const toSubScale = Math.max(0.4, Math.min(1.6, currentR / rTo));

        tracked.fromLayer.setAttribute('opacity', (1 - tr.progress).toFixed(3));
        tracked.fromLayer.setAttribute('transform', `scale(${fromSubScale.toFixed(4)})`);
        tracked.toLayer.setAttribute('opacity', tr.progress.toFixed(3));
        tracked.toLayer.setAttribute('transform', `scale(${toSubScale.toFixed(4)})`);

        tracked.lastInteractionSig = interSig;
        tracked.lastView = toView;
      } else {
        // Steady state (no active transition)
        if (tracked.fromLayer) {
          tracked.fromLayer.remove();
          tracked.fromLayer = null;
          tracked.lastFromKey = null;
        }
        if (tracked.toLayer) {
          // Promote toLayer directly into mainLayer without recreating DOM nodes
          if (tracked.mainLayer) tracked.mainLayer.remove();
          tracked.mainLayer = tracked.toLayer;
          tracked.mainLayer.setAttribute('class', 'sv-layer-main');
          tracked.mainLayer.removeAttribute('opacity');
          tracked.mainLayer.removeAttribute('transform');
          tracked.toLayer = null;
          tracked.lastMainKey = tracked.lastToKey;
          tracked.lastToKey = null;
        }
        if (!tracked.mainLayer) {
          tracked.mainLayer = this.createGroup('sv-layer-main');
          tracked.rootGroup.appendChild(tracked.mainLayer);
        }

        const viewToUse = viewByKey.get(node.cacheKey) ?? activeView;
        if (
          tracked.lastMainKey !== node.cacheKey ||
          interactionChanged ||
          tracked.lastMorphUsed ||
          tracked.lastView !== viewToUse
        ) {
          viewToUse.mountOrUpdate(tracked.mainLayer, node.visual, node);
          tracked.lastMainKey = node.cacheKey;
          tracked.lastInteractionSig = interSig;
          tracked.lastMorphUsed = false;
          tracked.lastView = viewToUse;
        }
      }
    }

    // Remove exited nodes
    for (const [id, tracked] of domMap) {
      if (!aliveIds.has(id)) {
        tracked.rootGroup.remove();
        domMap.delete(id);
      }
    }
  }

  private renderKeyboardFocusRing(
    snapshot: SceneFrameSnapshot<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    while (this.focusRingGroup.firstChild) {
      this.focusRingGroup.removeChild(this.focusRingGroup.firstChild);
    }
    const target = this.keyboardFocusTarget;
    if (!target) return;

    const invZoom = 1 / Math.max(0.35, snapshot.camera.zoom);
    const pad = 5 * invZoom;
    const haloWidth = 6 * invZoom;
    const ringWidth = 2.6 * invZoom;
    const isLight = this.theme === 'light';
    const haloColor = isLight ? '#ffffff' : '#020617';
    const haloOpacity = isLight ? '0.96' : '0.92';
    const ringColor = isLight ? '#0369a1' : '#38bdf8';

    const drawNodeRing = <TVisual>(
      node: NodeRenderState<TVisual> | undefined,
      activeView: SvgNodeView<TVisual>,
      viewByKey: Map<string, SvgNodeView<TVisual>>,
    ): void => {
      if (!node || node.opacity < 0.05) return;
      const styleView = node.transition
        ? (viewByKey.get(node.transition.toCacheKey) ?? activeView)
        : (viewByKey.get(node.cacheKey) ?? activeView);
      const hoverScaleFactor =
        !node.isContext &&
        !node.isPassThrough &&
        node.interaction.isHovered &&
        styleView.hoverScale !== undefined &&
        Number.isFinite(styleView.hoverScale) &&
        styleView.hoverScale > 0
          ? styleView.hoverScale
          : 1;
      const effectiveScale = node.scale * hoverScaleFactor;
      const hull = node.hull;

      if (hull.kind === 'circle') {
        const radius = hull.radius * effectiveScale + pad;
        for (const [stroke, strokeWidth, strokeOpacity, cls] of [
          [haloColor, haloWidth, haloOpacity, 'sv-focus-ring-halo'],
          [ringColor, ringWidth, '1', 'sv-focus-ring-stroke'],
        ] as const) {
          const circle = this.doc.createElementNS(SVG_NS, 'circle');
          circle.setAttribute('class', cls);
          circle.setAttribute('cx', node.x.toFixed(2));
          circle.setAttribute('cy', node.y.toFixed(2));
          circle.setAttribute('r', radius.toFixed(2));
          circle.setAttribute('fill', 'none');
          circle.setAttribute('stroke', stroke);
          circle.setAttribute('stroke-width', strokeWidth.toFixed(2));
          circle.setAttribute('stroke-opacity', strokeOpacity);
          this.focusRingGroup.appendChild(circle);
        }
      } else if (hull.vertices.length >= 3) {
        const pointsStr = hull.vertices
          .map((v) => {
            const vx = v.x * effectiveScale;
            const vy = v.y * effectiveScale;
            const len = Math.hypot(vx, vy);
            const scaleOut = len > 1e-4 ? (len + pad) / len : 1;
            return `${(node.x + vx * scaleOut).toFixed(2)},${(node.y + vy * scaleOut).toFixed(2)}`;
          })
          .join(' ');
        for (const [stroke, strokeWidth, strokeOpacity, cls] of [
          [haloColor, haloWidth, haloOpacity, 'sv-focus-ring-halo'],
          [ringColor, ringWidth, '1', 'sv-focus-ring-stroke'],
        ] as const) {
          const poly = this.doc.createElementNS(SVG_NS, 'polygon');
          poly.setAttribute('class', cls);
          poly.setAttribute('points', pointsStr);
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke', stroke);
          poly.setAttribute('stroke-width', strokeWidth.toFixed(2));
          poly.setAttribute('stroke-opacity', strokeOpacity);
          poly.setAttribute('stroke-linejoin', 'round');
          this.focusRingGroup.appendChild(poly);
        }
      }
    };

    if (target.kind === 'cluster') {
      const node = snapshot.clusters.find(
        (c) => c.id === target.id && !c.isContext && !c.id.startsWith('ghost-'),
      );
      drawNodeRing(node, this.clusterView, this.clusterViewByKey);
      return;
    }

    if (target.kind === 'item') {
      const node = snapshot.items.find(
        (it) => it.id === target.id && !it.isContext && !it.id.startsWith('ghost-'),
      );
      drawNodeRing(node, this.contentView, this.contentViewByKey);
      return;
    }

    const tri = snapshot.triangles.find(
      (t) => t.index === target.index && !t.isContext && t.index > -10000,
    );
    if (!tri) return;
    const pointsStr = tri.points
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ');
    for (const [stroke, strokeWidth, strokeOpacity, cls] of [
      [haloColor, haloWidth, haloOpacity, 'sv-focus-ring-halo'],
      [ringColor, ringWidth, '1', 'sv-focus-ring-stroke'],
    ] as const) {
      const poly = this.doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('class', cls);
      poly.setAttribute('points', pointsStr);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', stroke);
      poly.setAttribute('stroke-width', strokeWidth.toFixed(2));
      poly.setAttribute('stroke-opacity', strokeOpacity);
      poly.setAttribute('stroke-linejoin', 'round');
      this.focusRingGroup.appendChild(poly);
    }
  }

  private renderHullOverlay(
    snapshot: SceneFrameSnapshot<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    while (this.hullsGroup.firstChild) {
      this.hullsGroup.removeChild(this.hullsGroup.firstChild);
    }
    if (!snapshot.showHulls) return;

    const drawHull = <TVisual>(
      node: NodeRenderState<TVisual>,
      strokeColor: string,
    ) => {
      if (node.opacity < 0.05) return;
      const hull = node.hull;
      if (hull.kind === 'circle') {
        const circle = this.doc.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', node.x.toFixed(2));
        circle.setAttribute('cy', node.y.toFixed(2));
        circle.setAttribute('r', (hull.radius * node.scale).toFixed(2));
        circle.setAttribute('fill', strokeColor);
        circle.setAttribute('fill-opacity', '0.07');
        circle.setAttribute('stroke', strokeColor);
        circle.setAttribute('stroke-width', '1');
        circle.setAttribute('stroke-dasharray', '3 2');
        if (node.isContext) {
          circle.setAttribute('opacity', '0.28');
        }
        this.hullsGroup.appendChild(circle);
      } else if (hull.vertices.length >= 3) {
        const poly = this.doc.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute(
          'points',
          hull.vertices
            .map(
              (v) =>
                `${(node.x + v.x * node.scale).toFixed(2)},${(node.y + v.y * node.scale).toFixed(2)}`,
            )
            .join(' '),
        );
        poly.setAttribute('fill', strokeColor);
        poly.setAttribute('fill-opacity', '0.07');
        poly.setAttribute('stroke', strokeColor);
        poly.setAttribute('stroke-width', '1');
        poly.setAttribute('stroke-dasharray', '3 2');
        if (node.isContext) {
          poly.setAttribute('opacity', '0.28');
        }
        this.hullsGroup.appendChild(poly);
      }
    };

    for (const c of snapshot.clusters) {
      drawHull(c, '#f59e0b');
    }
    for (const it of snapshot.items) {
      drawHull(it, '#22d3ee');
    }
  }

  destroy(): void {
    this.clusterDomMap.clear();
    this.itemDomMap.clear();
    this.triangleDom.length = 0;
    this.drillEdgeDom.length = 0;
    this.edgeDom.length = 0;
    this.contentHullCache.clear();
    this.clusterHullCache.clear();
    this.contentViewByKey.clear();
    this.clusterViewByKey.clear();
    while (this.svgEl.firstChild) {
      this.svgEl.removeChild(this.svgEl.firstChild);
    }
  }
}
