import {
  rectToConvexPolygon,
  type ClusterDescriptor,
  type ContentLayoutContext,
  type NodeRenderState,
  type VisualResolver,
} from '@simplex-viz/core';
import {
  BarycentricSectorTriangleSvgView,
  BlueprintInsetTriangleSvgView,
  ClusterAnchorSvgView,
  ClusterTintedEdgeSvgView,
  DashedMeshEdgeSvgView,
  DensityHeatmapTriangleSvgView,
  GeometricShapeSvgView,
  GradientTriangleSvgView,
  MinimalHighlightEdgeSvgView,
  MultiSectorGlyphSvgView,
  OklabTintTriangleSvgView,
  PrecisionRailEdgeSvgView,
  resolveClusterSurfaceColors,
  type BadgeClusterVisual,
  type ClusterAnchorVisual,
  type GeometricShapeKind,
  type GeometricShapeVisual,
  type MultiSectorGlyphVisual,
  type SimplexTheme,
  type SvgEdgeView,
  type SvgNodeView,
  type SvgTriangleView,
} from '@simplex-viz/svg';
import type { ReactNode } from 'react';
import type { CommonsThumbManifest } from './commonsThumbs';
import type { TagTaxonomyInfo } from './data/knowledgeCatalog';
import type {
  BodyShapeItem,
  DemoClusterSummary,
  DemoEntity,
  VisualMediaItem,
} from './data/multimodalCatalog';
import {
  ZOO_SYMBOL_PRIMITIVES,
  resolveZooSymbolKind,
  type ZooSymbolKind,
} from './zooSymbols';

export type ContentRendererKind = 'domain' | 'geometric' | 'multisector' | 'react-card';
export type ClusterRendererKind = 'anchor' | 'badge' | 'react-card';
export type ContentShapeMode = 'by-type' | GeometricShapeKind;
export type TriangleFaceStyle =
  | 'oklab-tint'
  | 'barycentric-gradient'
  | 'barycentric-sector'
  | 'blueprint-inset'
  | 'density-heatmap';
export type MeshEdgeStyle =
  | 'dashed'
  | 'cluster-tinted'
  | 'precision-rail'
  | 'minimal-highlight';

export interface DemoRenderConfig {
  readonly contentRenderer: ContentRendererKind;
  readonly clusterRenderer: ClusterRendererKind;
  readonly contentShapeMode: ContentShapeMode;
  readonly contentBaseRadius: number;
  readonly contentStrokeWidth: number;
  readonly scaleByReadingTime: boolean;
  readonly domainGlyphScale: number;
  readonly mediaShowAspectTag: boolean;
  readonly mediaShowVideoBadge: boolean;
  readonly voiceWaveformBars: number;
  readonly voiceShowPitchLabel: boolean;
  readonly bodyShowCalibrationRing: boolean;
  readonly bodyShowHeightLabel: boolean;
  readonly donutInnerRatio: number;
  readonly donutAccentRing: boolean;
  readonly contentCardMaxChars: number;
  readonly showContentCardMeta: boolean;
  readonly anchorRadius: number;
  readonly clusterTitleMaxChars: number;
  readonly showClusterMetaLine: boolean;
  readonly triangleFaceStyle: TriangleFaceStyle;
  readonly triangleFaceOpacity: number;
  readonly meshEdgeStyle: MeshEdgeStyle;
  readonly meshEdgeWidth: number;
}

export const DEFAULT_DEMO_RENDER_CONFIG: DemoRenderConfig = {
  contentRenderer: 'domain',
  clusterRenderer: 'badge',
  contentShapeMode: 'by-type',
  contentBaseRadius: 9,
  contentStrokeWidth: 1.4,
  scaleByReadingTime: true,
  domainGlyphScale: 1.0,
  mediaShowAspectTag: true,
  mediaShowVideoBadge: true,
  voiceWaveformBars: 7,
  voiceShowPitchLabel: false,
  bodyShowCalibrationRing: true,
  bodyShowHeightLabel: false,
  donutInnerRatio: 0.44,
  donutAccentRing: false,
  contentCardMaxChars: 16,
  showContentCardMeta: false,
  anchorRadius: 22,
  clusterTitleMaxChars: 18,
  showClusterMetaLine: false,
  triangleFaceStyle: 'oklab-tint',
  triangleFaceOpacity: 0.09,
  meshEdgeStyle: 'dashed',
  meshEdgeWidth: 1.0,
};

export type PaperFigureKind = 'geometry' | 'graphics' | 'vision' | 'hci' | 'ml' | 'theory';

/**
 * Unified discriminated union for domain-optimized content visuals across SVG and React JSX renderers.
 */
export type DemoContentVisual =
  | { readonly kind: 'geometric'; readonly shape: GeometricShapeVisual }
  | { readonly kind: 'multisector'; readonly glyph: MultiSectorGlyphVisual }
  | {
      readonly kind: 'domain-knowledge';
      readonly theme: SimplexTheme;
      readonly width: number;
      readonly height: number;
      readonly codeTag: string;
      readonly figureKind: PaperFigureKind;
      readonly sectors: ReadonlyArray<{ readonly colorHex: string; readonly weight: number }>;
      readonly colorHex: string;
    }
  | {
      readonly kind: 'domain-repo';
      readonly theme: SimplexTheme;
      readonly width: number;
      readonly height: number;
      readonly repoName: string;
      readonly starsLabel: string;
      readonly langColorHex: string;
      readonly colorHex: string;
    }
    | {
      readonly kind: 'domain-zoo';
      readonly theme: SimplexTheme;
      readonly radius: number;
      readonly symbolKind: ZooSymbolKind;
      readonly photoUrl?: string;
      readonly aquatic: boolean;
      readonly colorHex: string;
    }
    | {
      readonly kind: 'domain-media';
      readonly theme: SimplexTheme;
      readonly width: number;
      readonly height: number;
      readonly shortTitle: string;
      readonly thumbnailUrl?: string;
      readonly imdbRating: number;
      readonly aspectRatio: VisualMediaItem['aspectRatio'];
      readonly mediaKind: VisualMediaItem['mediaKind'];
      readonly motif: VisualMediaItem['motif'];
      readonly palette: readonly [string, string];
      readonly colorHex: string;
    }
  | {
      readonly kind: 'domain-voice';
      readonly theme: SimplexTheme;
      readonly width: number;
      readonly height: number;
      readonly ipaSymbol: string;
      readonly waveform: readonly number[];
      readonly barCount: number;
      readonly pitchHz: number;
      readonly colorHex: string;
      readonly showPitchLabel: boolean;
    }
  | {
      readonly kind: 'domain-body';
      readonly theme: SimplexTheme;
      readonly radius: number;
      readonly species: string;
      readonly billLengthMm: number;
      readonly billDepthMm: number;
      readonly flipperLengthMm: number;
      readonly bodyMassG: number;
      readonly proportions: BodyShapeItem['proportions'];
      readonly heightCm: number;
      readonly posture: BodyShapeItem['posture'];
      readonly colorHex: string;
      readonly showCalibrationRing: boolean;
      readonly showHeightLabel: boolean;
    }
  | {
      readonly kind: 'react-card';
      readonly theme: SimplexTheme;
      readonly key: string;
      readonly colorHex: string;
      readonly headline: string;
      readonly metaLine: string;
      readonly maxChars: number;
      readonly showMeta: boolean;
    };

/**
 * Unified discriminated union for cluster visuals across SVG and React JSX renderers.
 */
export type DemoClusterVisual =
  | { readonly kind: 'anchor'; readonly anchor: ClusterAnchorVisual }
  | { readonly kind: 'badge'; readonly badge: BadgeClusterVisual }
  | {
      readonly kind: 'react-card';
      readonly theme: SimplexTheme;
      readonly key: string;
      readonly colorHex: string;
      readonly code: string;
      readonly title: string;
      readonly memberCount: number;
      readonly subtitle: string;
      readonly maxChars: number;
      readonly showMeta: boolean;
      readonly isIntermediate?: boolean;
      readonly shortBridgeTag?: string;
      readonly parentContextLabel?: string;
      readonly accentColors?: readonly string[];
    };

const geomBase = new GeometricShapeSvgView();
const sectorBase = new MultiSectorGlyphSvgView();
const anchorBase = new ClusterAnchorSvgView();

export const demoGeometricContentView: SvgNodeView<DemoContentVisual> = {
  measureConvexHull: (v) =>
    v.kind === 'geometric'
      ? geomBase.measureConvexHull(v.shape)
      : { kind: 'circle', radius: 10 },
  mountOrUpdate: (g, v, state) => {
    if (v.kind === 'geometric') {
      geomBase.mountOrUpdate(g, v.shape, {
        ...state,
        visual: v.shape,
        transition: null,
      });
    }
  },
  morph: (g, from, to, progress, state) => {
    if (from.kind === 'geometric' && to.kind === 'geometric') {
      return geomBase.morph(g, from.shape, to.shape, progress, {
        ...state,
        visual: to.shape,
        transition: null,
      });
    }
    return false;
  },
};

export const demoMultiSectorContentView: SvgNodeView<DemoContentVisual> = {
  measureConvexHull: (v) =>
    v.kind === 'multisector'
      ? sectorBase.measureConvexHull(v.glyph)
      : { kind: 'circle', radius: 12 },
  mountOrUpdate: (g, v, state) => {
    if (v.kind === 'multisector') {
      sectorBase.mountOrUpdate(g, v.glyph, {
        ...state,
        visual: v.glyph,
        transition: null,
      });
    }
  },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgEl<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, val] of Object.entries(attrs)) {
    el.setAttribute(k, String(val));
  }
  return el;
}

function resolveStateStroke<V>(
  state: NodeRenderState<V>,
  isLight: boolean,
  fallbackHex: string,
): { stroke: string; strokeWidth: number; accentHalo: string | null } {
  const accent = isLight ? '#0891b2' : '#22d3ee';
  if (state.interaction.isPinned) {
    return { stroke: '#f59e0b', strokeWidth: 2.15, accentHalo: '#f59e0b' };
  }
  if (state.interaction.isHovered) {
    return {
      stroke: isLight ? '#0f172a' : '#f8fafc',
      strokeWidth: 2.0,
      accentHalo: accent,
    };
  }
  if (state.interaction.isHighlighted) {
    return { stroke: fallbackHex, strokeWidth: 1.85, accentHalo: accent };
  }
  return {
    stroke: isLight ? '#cbd5e1' : '#293548',
    strokeWidth: 1.05,
    accentHalo: null,
  };
}

const REPO_LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  TypeScript: '#3178c6',
  JavaScript: '#eab308',
  Rust: '#f97316',
  Python: '#38bdf8',
  Go: '#06b6d4',
  HTML: '#ef4444',
  CSS: '#8b5cf6',
  Clojure: '#10b981',
  'C++': '#f43f5e',
  C: '#64748b',
  Java: '#d97706',
  Shell: '#22c55e',
};

function resolvePaperFigureAndCode(hashtags: readonly string[]): {
  readonly codeTag: string;
  readonly figureKind: PaperFigureKind;
} {
  const primary = hashtags[0] ?? 'cs.CG';
  const shortSuffix = primary.includes('.')
    ? primary.split('.')[1]!.slice(0, 3).toUpperCase()
    : primary.slice(0, 3).toUpperCase();

  if (primary === 'cs.CG' || primary === 'math.MG' || primary === 'geometry' || primary === 'triangulation') {
    return { codeTag: shortSuffix, figureKind: 'geometry' };
  }
  if (primary === 'cs.GR' || primary === 'webgl' || primary === 'shaders') {
    return { codeTag: shortSuffix, figureKind: 'graphics' };
  }
  if (primary === 'cs.CV') {
    return { codeTag: shortSuffix, figureKind: 'vision' };
  }
  if (primary === 'cs.HC' || primary === 'cs.IR') {
    return { codeTag: shortSuffix, figureKind: 'hci' };
  }
  if (primary === 'cs.LG' || primary === 'stat.ML' || primary === 'cs.AI') {
    return { codeTag: shortSuffix, figureKind: 'ml' };
  }
  return { codeTag: shortSuffix, figureKind: 'theory' };
}

export const demoDomainContentView: SvgNodeView<DemoContentVisual> = {
  measureConvexHull: (v) => {
    if (v.kind === 'domain-media' || v.kind === 'domain-voice' || v.kind === 'domain-repo' || v.kind === 'domain-knowledge') {
      return rectToConvexPolygon(v.width + 3.5, v.height + 3.5);
    }
    if (v.kind === 'domain-zoo' || v.kind === 'domain-body') {
      return { kind: 'circle', radius: v.radius + 2.5 };
    }
    if (v.kind === 'geometric') {
      return geomBase.measureConvexHull(v.shape);
    }
    return { kind: 'circle', radius: 13 };
  },
  mountOrUpdate: (groupEl, v, state) => {
    if (v.kind === 'geometric') {
      geomBase.mountOrUpdate(groupEl, v.shape, {
        ...state,
        visual: v.shape,
        transition: null,
      });
      return;
    }

    while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild);
    const doc = groupEl.ownerDocument;

    // 1. UCI ZOO: Wikimedia Commons Animal Photo Medallion (+ Zoological Silhouette Fallback)
    if (v.kind === 'domain-zoo') {
      const isLight = v.theme === 'light';
      const r = v.radius;
      const bgFill = isLight ? '#ffffff' : '#0b111e';
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: 0,
            r: r + 3.4,
            fill: 'none',
            stroke: accentHalo,
            'stroke-width': 1.4,
            'stroke-opacity': 0.92,
          }),
        );
      }

      // Base circular medallion
      groupEl.appendChild(
        createSvgEl(doc, 'circle', {
          cx: 0,
          cy: 0,
          r,
          fill: bgFill,
          'fill-opacity': isLight ? 0.98 : 0.96,
        }),
      );

      // Soft taxonomic color wash + vector silhouette fallback (visible immediately before image decode or if photo absent)
      groupEl.appendChild(
        createSvgEl(doc, 'circle', {
          cx: 0,
          cy: 0,
          r: Math.max(3, r - 1.5),
          fill: v.colorHex,
          'fill-opacity': isLight ? 0.12 : 0.16,
        }),
      );

      const iconScale = (r / 13.0).toFixed(3);
      const iconGroup = createSvgEl(doc, 'g', {
        transform: `scale(${iconScale})`,
      });
      const primitives = ZOO_SYMBOL_PRIMITIVES[v.symbolKind];
      for (const prim of primitives) {
        iconGroup.appendChild(
          createSvgEl(doc, prim.tag, {
            ...prim.attrs,
            fill: prim.cutout ? bgFill : v.colorHex,
            'fill-opacity': prim.cutout ? 0.96 : 0.92,
          }),
        );
      }
      groupEl.appendChild(iconGroup);

      // Self-hosted Wikimedia Commons animal photograph clipped cleanly to inner circle
      if (v.photoUrl) {
        const innerR = Math.max(4, r - 1.35);
        groupEl.appendChild(
          createSvgEl(doc, 'image', {
            href: v.photoUrl,
            x: (-innerR).toFixed(2),
            y: (-innerR).toFixed(2),
            width: (innerR * 2).toFixed(2),
            height: (innerR * 2).toFixed(2),
            preserveAspectRatio: 'xMidYMid slice',
            'clip-path': 'circle(50% at 50% 50%)',
          }),
        );
      }

      // Quiet specimen bezel ring (lights up on hover / highlight / pin)
      groupEl.appendChild(
        createSvgEl(doc, 'circle', {
          cx: 0,
          cy: 0,
          r,
          fill: 'none',
          stroke,
          'stroke-width': strokeWidth,
        }),
      );
      return;
    }

    // 2. VEGA CINEMA: 2:3 Vertical Public-Domain Theatrical Poster
    if (v.kind === 'domain-media') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: -hw - 3.0,
            y: -hh - 3.0,
            width: v.width + 6.0,
            height: v.height + 6.0,
            rx: 4.8,
            fill: 'none',
            stroke: accentHalo,
            'stroke-width': 1.4,
            'stroke-opacity': 0.92,
          }),
        );
      }

      // Instant fallback poster backdrop before image decode
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: -hw,
          y: -hh,
          width: v.width,
          height: v.height,
          rx: 3.0,
          fill: v.palette[1],
        }),
      );
      groupEl.appendChild(
        createSvgEl(doc, 'polygon', {
          points: `${-hw},${-hh} ${hw},${-hh} ${-hw},${hh}`,
          fill: v.palette[0],
          'fill-opacity': 0.35,
        }),
      );

      // Authentic Public-Domain theatrical poster (Astro-optimized 68×96 WebP)
      const inset = 0.65;
      if (v.thumbnailUrl) {
        groupEl.appendChild(
          createSvgEl(doc, 'image', {
            href: v.thumbnailUrl,
            x: (-hw + inset).toFixed(2),
            y: (-hh + inset).toFixed(2),
            width: (v.width - inset * 2).toFixed(2),
            height: (v.height - inset * 2).toFixed(2),
            preserveAspectRatio: 'xMidYMid slice',
            'clip-path': 'inset(0px round 2.5px)',
          }),
        );
      }

      // Dark bottom marquee scrim for crisp title legibility
      const scrimH = 10.4;
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: (-hw + inset).toFixed(2),
          y: (hh - scrimH).toFixed(2),
          width: (v.width - inset * 2).toFixed(2),
          height: (scrimH - inset).toFixed(2),
          fill: '#050811',
          'fill-opacity': 0.86,
          'clip-path': 'inset(0px round 0px 0px 2.5px 2.5px)',
        }),
      );

      // Centered concise poster title
      const posterTitle =
        v.shortTitle.length > 10 ? `${v.shortTitle.slice(0, 9).trim()}…` : v.shortTitle;
      const titleEl = createSvgEl(doc, 'text', {
        x: 0,
        y: (hh - 3.0).toFixed(1),
        'text-anchor': 'middle',
        fill: '#f8fafc',
        'font-size': 5.3,
        'font-weight': 700,
        'font-family': 'Plus Jakarta Sans, sans-serif',
        'letter-spacing': '-0.01em',
      });
      titleEl.textContent = posterTitle;
      groupEl.appendChild(titleEl);

      // Top-left square cluster swatch pip (distinct from circular cluster badges)
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: (-hw + 2.3).toFixed(1),
          y: (-hh + 2.3).toFixed(1),
          width: 3.5,
          height: 3.5,
          rx: 0.9,
          fill: v.colorHex,
          stroke: '#050811',
          'stroke-width': 0.7,
        }),
      );

      // Acclaimed rating micro-star for top-rated classics (IMDb >= 8.0)
      if (v.imdbRating >= 8.0) {
        const starEl = createSvgEl(doc, 'text', {
          x: (hw - 2.9).toFixed(1),
          y: (-hh + 6.2).toFixed(1),
          'text-anchor': 'end',
          fill: '#fbbf24',
          'font-size': 5.8,
          'font-weight': 700,
          'paint-order': 'stroke',
          stroke: '#050811',
          'stroke-width': 1.4,
        });
        starEl.textContent = '★';
        groupEl.appendChild(starEl);
      }

      // Quiet gallery frame border at rest (lights up on hover / highlight / pin)
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: -hw,
          y: -hh,
          width: v.width,
          height: v.height,
          rx: 3.0,
          fill: 'none',
          stroke,
          'stroke-width': strokeWidth,
        }),
      );
      return;
    }

    // 3. ARXIV KNOWLEDGE PAPERS: Scientific Manuscript Page Glyph
    if (v.kind === 'domain-knowledge') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const bgFill = isLight ? '#ffffff' : '#0c1220';
      const ruleColor = isLight ? '#94a3b8' : '#475569';
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: -hw - 3,
            y: -hh - 3,
            width: v.width + 6,
            height: v.height + 6,
            rx: 4.5,
            fill: 'none',
            stroke: accentHalo,
            'stroke-width': 1.3,
            'stroke-opacity': 0.9,
          }),
        );
      }

      // Manuscript page card with crisp sheet corners
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: -hw,
          y: -hh,
          width: v.width,
          height: v.height,
          rx: 2.5,
          fill: bgFill,
          'fill-opacity': isLight ? 0.98 : 0.96,
          stroke,
          'stroke-width': strokeWidth,
        }),
      );

      // Multi-category barycentric color header bar across top of manuscript
      const innerW = v.width - 2.4;
      let cursorX = -hw + 1.2;
      const totalWeight = v.sectors.reduce((acc, s) => acc + s.weight, 0) || 1;
      for (const sec of v.sectors) {
        const segW = (sec.weight / totalWeight) * innerW;
        if (segW > 0.4) {
          groupEl.appendChild(
            createSvgEl(doc, 'rect', {
              x: cursorX.toFixed(2),
              y: (-hh + 1.2).toFixed(2),
              width: segW.toFixed(2),
              height: 3.1,
              rx: 0.9,
              fill: sec.colorHex,
            }),
          );
          cursorX += segW;
        }
      }

      // Miniature scientific figure matching primary arXiv discipline
      const figY = -2.4;
      if (v.figureKind === 'geometry') {
        groupEl.appendChild(
          createSvgEl(doc, 'polygon', {
            points: `0,${figY - 5.2} ${6.2},${figY + 3.4} ${-6.2},${figY + 3.4}`,
            fill: v.colorHex,
            'fill-opacity': 0.18,
            stroke: v.colorHex,
            'stroke-width': 1.05,
            'stroke-linejoin': 'round',
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'line', {
            x1: 0,
            y1: figY - 5.2,
            x2: 1.2,
            y2: figY + 3.4,
            stroke: v.colorHex,
            'stroke-width': 0.85,
          }),
        );
      } else if (v.figureKind === 'graphics') {
        groupEl.appendChild(
          createSvgEl(doc, 'polygon', {
            points: `0,${figY - 5.4} 5.8,${figY - 2.2} 5.8,${figY + 2.6} 0,${figY + 5.2} -5.8,${figY + 2.6} -5.8,${figY - 2.2}`,
            fill: v.colorHex,
            'fill-opacity': 0.16,
            stroke: v.colorHex,
            'stroke-width': 1.0,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'path', {
            d: `M -5.8 ${figY - 2.2} L 0 ${figY + 0.8} L 5.8 ${figY - 2.2} M 0 ${figY + 0.8} L 0 ${figY + 5.2}`,
            fill: 'none',
            stroke: v.colorHex,
            'stroke-width': 0.85,
          }),
        );
      } else if (v.figureKind === 'vision') {
        groupEl.appendChild(
          createSvgEl(doc, 'path', {
            d: `M -6.4 ${figY} Q 0 ${figY - 5.4} 6.4 ${figY} Q 0 ${figY + 5.4} -6.4 ${figY} Z`,
            fill: v.colorHex,
            'fill-opacity': 0.16,
            stroke: v.colorHex,
            'stroke-width': 1.05,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: figY,
            r: 1.9,
            fill: v.colorHex,
          }),
        );
      } else if (v.figureKind === 'ml') {
        groupEl.appendChild(
          createSvgEl(doc, 'path', {
            d: `M -6.2 ${figY + 3.4} C -2.2 ${figY + 3.2}, -1.2 ${figY - 4.4}, 6.2 ${figY - 4.2}`,
            fill: 'none',
            stroke: v.colorHex,
            'stroke-width': 1.35,
            'stroke-linecap': 'round',
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', { cx: -3.6, cy: figY + 1.8, r: 1.2, fill: v.colorHex }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', { cx: 3.4, cy: figY - 3.6, r: 1.2, fill: v.colorHex }),
        );
      } else {
        groupEl.appendChild(
          createSvgEl(doc, 'line', {
            x1: 0,
            y1: figY - 4.2,
            x2: -4.4,
            y2: figY + 2.6,
            stroke: v.colorHex,
            'stroke-width': 1.05,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'line', {
            x1: 0,
            y1: figY - 4.2,
            x2: 4.4,
            y2: figY + 2.6,
            stroke: v.colorHex,
            'stroke-width': 1.05,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', { cx: 0, cy: figY - 4.2, r: 1.7, fill: v.colorHex }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', { cx: -4.4, cy: figY + 2.6, r: 1.5, fill: v.colorHex }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', { cx: 4.4, cy: figY + 2.6, r: 1.5, fill: v.colorHex }),
        );
      }

      // Abstract manuscript text lines
      groupEl.appendChild(
        createSvgEl(doc, 'line', {
          x1: -hw + 3.4,
          y1: 5.0,
          x2: hw - 3.4,
          y2: 5.0,
          stroke: ruleColor,
          'stroke-width': 1.0,
          'stroke-opacity': 0.55,
          'stroke-linecap': 'round',
        }),
      );
      groupEl.appendChild(
        createSvgEl(doc, 'line', {
          x1: -hw + 3.4,
          y1: 7.6,
          x2: hw - 6.8,
          y2: 7.6,
          stroke: ruleColor,
          'stroke-width': 1.0,
          'stroke-opacity': 0.45,
          'stroke-linecap': 'round',
        }),
      );

      // Discipline short code at bottom
      const codeEl = createSvgEl(doc, 'text', {
        x: 0,
        y: hh - 2.6,
        'text-anchor': 'middle',
        fill: isLight ? '#334155' : '#cbd5e1',
        'font-size': 5.8,
        'font-weight': 700,
        'font-family': 'IBM Plex Mono, monospace',
      });
      codeEl.textContent = v.codeTag;
      groupEl.appendChild(codeEl);
      return;
    }

    // 4. GITHUB REPOS: Crisp Rectangular Open-Source Code Tile (non-capsule)
    if (v.kind === 'domain-repo') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: -hw - 3,
            y: -hh - 3,
            width: v.width + 6,
            height: v.height + 6,
            rx: 5.0,
            fill: 'none',
            stroke: accentHalo,
            'stroke-width': 1.3,
            'stroke-opacity': 0.9,
          }),
        );
      }

      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: -hw,
          y: -hh,
          width: v.width,
          height: v.height,
          rx: 3.0,
          fill: isLight ? '#ffffff' : '#0c1220',
          'fill-opacity': isLight ? 0.98 : 0.96,
          stroke,
          'stroke-width': strokeWidth,
        }),
      );

      // Square programming-language swatch (distinct from circular dots)
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: (-hw + 5.0).toFixed(1),
          y: -2.4,
          width: 4.8,
          height: 4.8,
          rx: 1.1,
          fill: v.langColorHex,
        }),
      );

      // Short repository name (never owner/ prefix)
      const nameEl = createSvgEl(doc, 'text', {
        x: (-hw + 13.4).toFixed(1),
        y: 2.8,
        fill: isLight ? '#0f172a' : '#f1f5f9',
        'font-size': 8.0,
        'font-weight': 600,
        'font-family': 'IBM Plex Mono, monospace',
      });
      nameEl.textContent = v.repoName;
      groupEl.appendChild(nameEl);

      // Compact star readout on right
      const starsEl = createSvgEl(doc, 'text', {
        x: (hw - 5.2).toFixed(1),
        y: 2.5,
        'text-anchor': 'end',
        fill: isLight ? '#64748b' : '#94a3b8',
        'font-size': 6.7,
        'font-weight': 600,
        'font-family': 'IBM Plex Mono, monospace',
      });
      starsEl.textContent = `${v.starsLabel}★`;
      groupEl.appendChild(starsEl);
      return;
    }

    // 5. UCI VOWELS: Rectangular Acoustic Spectrogram Tile (non-capsule)
    if (v.kind === 'domain-voice') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const rx = 3.2;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: -hw - 3.0,
            y: -hh - 3.0,
            width: v.width + 6.0,
            height: v.height + 6.0,
            rx: rx + 2.4,
            fill: 'none',
            stroke: accentHalo,
            'stroke-width': 1.3,
            'stroke-opacity': 0.9,
          }),
        );
      }

      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: -hw,
          y: -hh,
          width: v.width,
          height: v.height,
          rx,
          fill: isLight ? '#ffffff' : '#0b101b',
          'fill-opacity': isLight ? 0.98 : 0.96,
          stroke,
          'stroke-width': strokeWidth,
        }),
      );

      // Subtle recessed oscilloscope well behind LPC formant bars
      const divX = -hw + 18.8;
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: (divX + 0.6).toFixed(2),
          y: (-hh + 1.8).toFixed(2),
          width: Math.max(8, hw - divX - 2.4).toFixed(2),
          height: (v.height - 3.6).toFixed(2),
          rx: 1.8,
          fill: isLight ? '#f1f5f9' : '#060a12',
        }),
      );

      // Left IPA phoneme symbol
      const cleanIpa = v.ipaSymbol.replace(/\//g, '');
      const ipaEl = createSvgEl(doc, 'text', {
        x: (-hw + 9.8).toFixed(1),
        y: 2.9,
        'text-anchor': 'middle',
        fill: isLight ? '#0f172a' : '#f8fafc',
        'font-size': 8.2,
        'font-weight': 700,
        'font-family': 'Plus Jakarta Sans, sans-serif',
      });
      ipaEl.textContent = cleanIpa;
      groupEl.appendChild(ipaEl);

      // Hairline divider between IPA symbol and LPC spectrum
      groupEl.appendChild(
        createSvgEl(doc, 'line', {
          x1: divX.toFixed(1),
          y1: (-hh + 2.5).toFixed(1),
          x2: divX.toFixed(1),
          y2: (hh - 2.5).toFixed(1),
          stroke: isLight ? '#e2e8f0' : '#1e293b',
          'stroke-width': 0.85,
        }),
      );

      const startX = divX + 2.8;
      const rightPad = v.showPitchLabel ? 22 : 4.5;
      const waveSpan = Math.max(14, hw - rightPad - startX);
      const count = Math.max(4, Math.min(v.waveform.length, v.barCount));
      const step = waveSpan / count;
      const barW = Math.max(1.5, Math.min(2.6, step * 0.62));
      const maxBarH = v.height - 6.6;

      for (let i = 0; i < count; i++) {
        const sampleIdx = Math.min(
          v.waveform.length - 1,
          Math.floor((i * v.waveform.length) / count),
        );
        const amp = v.waveform[sampleIdx] ?? 0.4;
        const barH = Math.max(2.6, amp * maxBarH);
        const bx = startX + i * step + (step - barW) / 2;
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: bx.toFixed(2),
            y: (-barH / 2).toFixed(2),
            width: barW.toFixed(2),
            height: barH.toFixed(2),
            rx: 0.7,
            fill: v.colorHex,
            'fill-opacity': 0.94,
          }),
        );
      }

      if (v.showPitchLabel) {
        const pitchEl = createSvgEl(doc, 'text', {
          x: hw - 4.8,
          y: 2.3,
          'text-anchor': 'end',
          fill: isLight ? '#334155' : '#cbd5e1',
          'font-size': 6.4,
          'font-weight': 600,
          'font-family': 'IBM Plex Mono, monospace',
        });
        pitchEl.textContent = `${v.pitchHz}Hz`;
        groupEl.appendChild(pitchEl);
      }
      return;
    }

    // 6. PALMER PENGUINS: Biometric Penguin Morphometric Medallion
    if (v.kind === 'domain-body') {
      const isLight = v.theme === 'light';
      const r = v.radius;
      const bgFill = isLight ? '#ffffff' : '#0b101b';
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: 0,
            r: r + 3.4,
            fill: 'none',
            stroke: accentHalo,
            'stroke-width': 1.35,
            'stroke-opacity': 0.9,
          }),
        );
      }

      groupEl.appendChild(
        createSvgEl(doc, 'circle', {
          cx: 0,
          cy: 0,
          r,
          fill: bgFill,
          'fill-opacity': isLight ? 0.98 : 0.96,
          stroke,
          'stroke-width': strokeWidth,
        }),
      );

      if (v.showCalibrationRing) {
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: 0,
            r: Math.max(4, r - 2.3),
            fill: 'none',
            stroke: v.colorHex,
            'stroke-opacity': 0.2,
            'stroke-width': 0.7,
            'stroke-dasharray': '2 2.4',
          }),
        );
      }

      // Parameterize penguin morphology from real specimen measurements
      const s = r / 15.5;
      const massFactor = Math.max(0.82, Math.min(1.22, v.bodyMassG / 4200));
      const flipperSpan = Math.max(0.85, Math.min(1.25, v.flipperLengthMm / 200));
      const billLen = Math.max(2.6, Math.min(5.2, ((v.billLengthMm - 32) / 26) * 2.6 + 2.6)) * s;
      const billHalfDepth = Math.max(0.85, Math.min(1.65, ((v.billDepthMm - 13) / 8.5) * 0.8 + 0.85)) * s;
      const bodyRx = 4.3 * massFactor * s;
      const bodyRy = 6.4 * s;
      const headR = 2.9 * s;
      const headY = -5.6 * s;
      const bodyY = 1.4 * s;

      const pgGroup = createSvgEl(doc, 'g', {
        transform: `translate(${(-0.5 * s).toFixed(2)}, ${(0.3 * s).toFixed(2)})`,
      });

      // Left & right flippers scaled by flipperLengthMm
      pgGroup.appendChild(
        createSvgEl(doc, 'path', {
          d: `M ${(-bodyRx * 0.75).toFixed(2)} ${(-2.0 * s).toFixed(2)} Q ${(-bodyRx - 2.8 * flipperSpan * s).toFixed(2)} ${(1.6 * s).toFixed(2)} ${(-bodyRx - 1.1 * flipperSpan * s).toFixed(2)} ${(5.6 * s).toFixed(2)} Q ${(-bodyRx * 0.5).toFixed(2)} ${(3.6 * s).toFixed(2)} ${(-bodyRx * 0.55).toFixed(2)} ${(0.4 * s).toFixed(2)} Z`,
          fill: v.colorHex,
          'fill-opacity': 0.92,
        }),
      );
      pgGroup.appendChild(
        createSvgEl(doc, 'path', {
          d: `M ${(bodyRx * 0.75).toFixed(2)} ${(-2.0 * s).toFixed(2)} Q ${(bodyRx + 2.4 * flipperSpan * s).toFixed(2)} ${(1.6 * s).toFixed(2)} ${(bodyRx + 0.9 * flipperSpan * s).toFixed(2)} ${(5.4 * s).toFixed(2)} Q ${(bodyRx * 0.5).toFixed(2)} ${(3.6 * s).toFixed(2)} ${(bodyRx * 0.55).toFixed(2)} ${(0.4 * s).toFixed(2)} Z`,
          fill: v.colorHex,
          'fill-opacity': 0.92,
        }),
      );

      // Dorsal body & head
      pgGroup.appendChild(
        createSvgEl(doc, 'ellipse', {
          cx: 0,
          cy: bodyY.toFixed(2),
          rx: bodyRx.toFixed(2),
          ry: bodyRy.toFixed(2),
          fill: v.colorHex,
        }),
      );
      pgGroup.appendChild(
        createSvgEl(doc, 'circle', {
          cx: 0,
          cy: headY.toFixed(2),
          r: headR.toFixed(2),
          fill: v.colorHex,
        }),
      );

      // Parameterized culmen (beak) projecting to right: length = billLengthMm, thickness = billDepthMm
      pgGroup.appendChild(
        createSvgEl(doc, 'polygon', {
          points: `${(headR * 0.65).toFixed(2)},${(headY - billHalfDepth).toFixed(2)} ${(headR * 0.65 + billLen).toFixed(2)},${(headY + 0.25 * s).toFixed(2)} ${(headR * 0.65).toFixed(2)},${(headY + billHalfDepth).toFixed(2)}`,
          fill: v.species === 'Gentoo' ? '#f97316' : v.colorHex,
        }),
      );

      // Countershaded white belly
      pgGroup.appendChild(
        createSvgEl(doc, 'ellipse', {
          cx: (0.45 * s).toFixed(2),
          cy: (bodyY + 0.9 * s).toFixed(2),
          rx: (bodyRx * 0.62).toFixed(2),
          ry: (bodyRy * 0.74).toFixed(2),
          fill: bgFill,
          'fill-opacity': 0.95,
        }),
      );

      // Species-distinctive cranial markings
      if (v.species === 'Gentoo') {
        // Gentoo white bonnet patch above eye
        pgGroup.appendChild(
          createSvgEl(doc, 'ellipse', {
            cx: (-0.2 * s).toFixed(2),
            cy: (headY - 0.8 * s).toFixed(2),
            rx: (1.5 * s).toFixed(2),
            ry: (0.85 * s).toFixed(2),
            fill: bgFill,
          }),
        );
      } else if (v.species === 'Chinstrap') {
        // Chinstrap white cheek + crisp chin band
        pgGroup.appendChild(
          createSvgEl(doc, 'circle', {
            cx: (0.55 * s).toFixed(2),
            cy: (headY + 0.2 * s).toFixed(2),
            r: (1.45 * s).toFixed(2),
            fill: bgFill,
          }),
        );
        pgGroup.appendChild(
          createSvgEl(doc, 'path', {
            d: `M ${(-0.5 * s).toFixed(2)} ${(headY + 1.1 * s).toFixed(2)} Q ${(0.6 * s).toFixed(2)} ${(headY + 2.1 * s).toFixed(2)} ${(1.7 * s).toFixed(2)} ${(headY + 0.6 * s).toFixed(2)}`,
            fill: 'none',
            stroke: v.colorHex,
            'stroke-width': Math.max(0.75, 0.85 * s),
          }),
        );
      } else {
        // Adélie crisp white eye-ring
        pgGroup.appendChild(
          createSvgEl(doc, 'circle', {
            cx: (0.75 * s).toFixed(2),
            cy: (headY - 0.25 * s).toFixed(2),
            r: (0.9 * s).toFixed(2),
            fill: bgFill,
          }),
        );
      }

      groupEl.appendChild(pgGroup);
    }
  },
};

export const demoAnchorClusterView: SvgNodeView<DemoClusterVisual> = {
  measureConvexHull: (v) =>
    v.kind === 'anchor'
      ? anchorBase.measureConvexHull(v.anchor)
      : { kind: 'circle', radius: 24 },
  mountOrUpdate: (g, v, state) => {
    if (v.kind === 'anchor') {
      anchorBase.mountOrUpdate(g, v.anchor, {
        ...state,
        visual: v.anchor,
        transition: null,
      });
    }
  },
};

function computeMinimalBadgeDimensions(badge: BadgeClusterVisual): {
  readonly width: number;
  readonly height: number;
} {
  if (badge.variant === 'intermediate') {
    const label = (badge.title || badge.code).trim();
    const parentCtx = (badge.parentContextLabel ?? '').trim();
    if (parentCtx.length > 0) {
      const topW = Math.round(parentCtx.length * 5.25 + 24);
      const botW = Math.round(label.length * 5.9 + 22);
      return {
        width: Math.max(66, topW, botW),
        height: 32,
      };
    }
    return {
      width: Math.max(48, Math.round(label.length * 5.8 + 20)),
      height: 22,
    };
  }
  const hasMeta = badge.metaLine.trim().length > 0;
  const labelW = Math.round(badge.title.length * 6.35 + 26);
  if (!hasMeta) {
    return {
      width: Math.max(54, labelW),
      height: 25,
    };
  }
  const metaW = Math.round(badge.metaLine.length * 5.3 + 26);
  return {
    width: Math.max(96, labelW, metaW),
    height: 38,
  };
}

/**
 * Saturated Cartographic Cluster Capsule & Subcluster Plaque SVG View:
 * - Primary clusters render as full-round jewel-tone capsules (`rx = halfH`) with guaranteed
 *   WCAG-AA `#ffffff` white typography and a solid outer docking halo ring.
 * - Intermediate `1:4` sub-clusters consistently use the same saturated jewel-tone fill + `#ffffff`
 *   white typography inside a chamfered hexagonal silhouette with a dashed outer halo ring:
 *   outer corners preserve `parentContextLabel` on an eyebrow line above the local facet, while
 *   edge midpoints display a single-line local facet or parent bridge relation (`A ↔ B`).
 */
export const demoBadgeClusterView: SvgNodeView<DemoClusterVisual> = {
  measureConvexHull: (v) => {
    if (v.kind !== 'badge') return { kind: 'circle', radius: 20 };
    const { width, height } = computeMinimalBadgeDimensions(v.badge);
    const pad = v.badge.variant === 'intermediate' ? 8 : 9;
    return rectToConvexPolygon(width + pad, height + pad);
  },
  mountOrUpdate: (groupEl, v, state) => {
    if (v.kind !== 'badge') return;
    while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild);
    const doc = groupEl.ownerDocument;
    const badge = v.badge;
    const theme = badge.theme === 'light' ? 'light' : 'dark';
    const isLight = theme === 'light';
    const { width, height } = computeMinimalBadgeDimensions(badge);
    const halfW = width / 2;
    const halfH = height / 2;
    const isActive = state.interaction.isHovered || state.interaction.isHighlighted;
    const palette = resolveClusterSurfaceColors(badge.colorHex, theme);

    if (badge.variant === 'intermediate') {
      const label = (badge.title || badge.code).trim();
      const parentCtx = (badge.parentContextLabel ?? '').trim();
      const hasParentCtx = parentCtx.length > 0;
      const cut = hasParentCtx ? 6.4 : 5.4;
      const haloPad = hasParentCtx ? 2.5 : 2.3;
      const chamferPts = (hw: number, hh: number, c: number, dy = 0): string =>
        `${(-hw + c).toFixed(1)},${(-hh + dy).toFixed(1)} ${(hw - c).toFixed(1)},${(-hh + dy).toFixed(1)} ${hw.toFixed(1)},${dy.toFixed(1)} ${(hw - c).toFixed(1)},${(hh + dy).toFixed(1)} ${(-hw + c).toFixed(1)},${(hh + dy).toFixed(1)} ${(-hw).toFixed(1)},${dy.toFixed(1)}`;

      // 1. Subtle grounding shadow
      groupEl.appendChild(
        createSvgEl(doc, 'polygon', {
          points: chamferPts(halfW, halfH, cut, 1.4),
          fill: '#020617',
          'fill-opacity': isLight ? 0.15 : 0.42,
        }),
      );

      // 2. Dashed outer chamfered docking halo ring
      groupEl.appendChild(
        createSvgEl(doc, 'polygon', {
          points: chamferPts(halfW + haloPad, halfH + haloPad, cut + 1.0),
          fill: 'none',
          stroke: state.interaction.isPinned ? '#f59e0b' : palette.haloHex,
          'stroke-width': isActive ? 1.75 : 1.15,
          'stroke-opacity':
            isActive || state.interaction.isPinned ? 0.96 : isLight ? 0.54 : 0.68,
          ...(isActive ? {} : { 'stroke-dasharray': '3 2' }),
          'stroke-linejoin': 'round',
        }),
      );

      // 3. Saturated OKLab-calibrated jewel-tone chamfered body
      groupEl.appendChild(
        createSvgEl(doc, 'polygon', {
          points: chamferPts(halfW, halfH, cut),
          fill: palette.solidFillHex,
          stroke: state.interaction.isPinned ? '#fef08a' : '#ffffff',
          'stroke-width': isActive ? 1.5 : 0.95,
          'stroke-opacity': isActive ? 0.92 : 0.28,
          'stroke-linejoin': 'round',
        }),
      );

      if (hasParentCtx) {
        const parentEl = createSvgEl(doc, 'text', {
          x: 0,
          y: -4.2,
          'text-anchor': 'middle',
          fill: '#ffffff',
          'fill-opacity': 0.78,
          'font-size': 7.3,
          'font-weight': 700,
          'letter-spacing': '0.05em',
          'font-family': 'IBM Plex Mono, monospace',
        });
        parentEl.textContent = parentCtx.toUpperCase();
        groupEl.appendChild(parentEl);

        const facetEl = createSvgEl(doc, 'text', {
          x: 0,
          y: 7.5,
          'text-anchor': 'middle',
          fill: '#ffffff',
          'font-size': 9.2,
          'font-weight': 700,
          'letter-spacing': '0.01em',
          'font-family': 'Plus Jakarta Sans, sans-serif',
        });
        facetEl.textContent = label;
        groupEl.appendChild(facetEl);
      } else {
        const textEl = createSvgEl(doc, 'text', {
          x: 0,
          y: 3.2,
          'text-anchor': 'middle',
          fill: '#ffffff',
          'font-size': 9.1,
          'font-weight': 700,
          'letter-spacing': '0.01em',
          'font-family': 'Plus Jakarta Sans, sans-serif',
        });
        textEl.textContent = label;
        groupEl.appendChild(textEl);
      }
      return;
    }

    const hasMeta = badge.metaLine.trim().length > 0;
    const rx = halfH;
    const haloPad = 2.6;

    // 1. Subtle grounding shadow lifting primary cluster anchor above canvas
    groupEl.appendChild(
      createSvgEl(doc, 'rect', {
        x: -halfW,
        y: -halfH + 1.6,
        width,
        height,
        rx,
        fill: '#020617',
        'fill-opacity': isLight ? 0.16 : 0.45,
      }),
    );

    // 2. Outer docking halo ring in calibrated cluster hue
    groupEl.appendChild(
      createSvgEl(doc, 'rect', {
        x: (-halfW - haloPad).toFixed(2),
        y: (-halfH - haloPad).toFixed(2),
        width: (width + haloPad * 2).toFixed(2),
        height: (height + haloPad * 2).toFixed(2),
        rx: (rx + haloPad).toFixed(2),
        fill: 'none',
        stroke: state.interaction.isPinned ? '#f59e0b' : palette.haloHex,
        'stroke-width': isActive ? 1.85 : 1.2,
        'stroke-opacity':
          isActive || state.interaction.isPinned ? 0.96 : isLight ? 0.48 : 0.64,
      }),
    );

    // 3. Saturated OKLab-calibrated jewel-tone capsule body
    groupEl.appendChild(
      createSvgEl(doc, 'rect', {
        x: -halfW,
        y: -halfH,
        width,
        height,
        rx,
        fill: palette.solidFillHex,
        stroke: state.interaction.isPinned ? '#fef08a' : '#ffffff',
        'stroke-width': isActive ? 1.6 : 1.0,
        'stroke-opacity': isActive ? 0.92 : 0.28,
      }),
    );

    // 4. High-contrast centered white typography (guaranteed >= 4.85:1 WCAG AA)
    const titleEl = createSvgEl(doc, 'text', {
      x: 0,
      y: hasMeta ? -2.2 : 3.7,
      'text-anchor': 'middle',
      fill: '#ffffff',
      'font-size': 10.5,
      'font-weight': 700,
      'letter-spacing': '0.01em',
      'font-family': 'Plus Jakarta Sans, sans-serif',
    });
    titleEl.textContent = badge.title;
    groupEl.appendChild(titleEl);

    if (hasMeta) {
      const metaEl = createSvgEl(doc, 'text', {
        x: 0,
        y: 10.6,
        'text-anchor': 'middle',
        fill: '#ffffff',
        'fill-opacity': 0.85,
        'font-size': 8.3,
        'font-family': 'IBM Plex Mono, monospace',
      });
      metaEl.textContent = badge.metaLine;
      groupEl.appendChild(metaEl);
    }
  },
};

export function createDemoTriangleView(
  config: Pick<DemoRenderConfig, 'triangleFaceStyle' | 'triangleFaceOpacity'>,
): SvgTriangleView<DemoEntity, TagTaxonomyInfo, DemoClusterSummary> {
  const baseOpacity = config.triangleFaceOpacity;
  switch (config.triangleFaceStyle) {
    case 'barycentric-gradient':
      return new GradientTriangleSvgView({
        baseOpacity: Math.min(0.7, baseOpacity * 1.65),
        hoverOpacityBoost: 0.18,
        strokeOnHover: true,
      });
    case 'barycentric-sector':
      return new BarycentricSectorTriangleSvgView({
        baseOpacity: Math.min(0.6, baseOpacity * 1.35),
        showMedians: true,
      });
    case 'blueprint-inset':
      return new BlueprintInsetTriangleSvgView({
        baseOpacity,
        insetRatio: 0.82,
      });
    case 'density-heatmap':
      return new DensityHeatmapTriangleSvgView({
        baseOpacity: Math.max(0.03, baseOpacity * 0.55),
        peakItemCount: 10,
        showCountBadge: true,
      });
    case 'oklab-tint':
    default:
      return new OklabTintTriangleSvgView({
        baseOpacity,
        hoverOpacityBoost: 0.16,
        strokeOnHover: true,
      });
  }
}

export function createDemoEdgeView(
  config: Pick<DemoRenderConfig, 'meshEdgeStyle' | 'meshEdgeWidth'>,
): SvgEdgeView<DemoEntity, TagTaxonomyInfo, DemoClusterSummary> {
  const strokeWidth = config.meshEdgeWidth;
  switch (config.meshEdgeStyle) {
    case 'cluster-tinted':
      return new ClusterTintedEdgeSvgView({
        strokeWidth: Math.max(0.8, strokeWidth * 1.25),
        opacity: 0.52,
      });
    case 'precision-rail':
      return new PrecisionRailEdgeSvgView({
        strokeWidth,
        railOffset: 1.8,
      });
    case 'minimal-highlight':
      return new MinimalHighlightEdgeSvgView({
        strokeWidth: Math.max(1.0, strokeWidth * 1.3),
        restOpacity: 0.08,
      });
    case 'dashed':
    default:
      return new DashedMeshEdgeSvgView({
        strokeWidth,
        dasharray: '3 4',
        opacity: 0.3,
      });
  }
}

function truncateLabel(text: string, maxChars: number): string {
  const limit = Math.max(6, maxChars);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function resolveEntityShape(entity: DemoEntity): GeometricShapeKind {
  if (entity.kind === 'knowledge') {
    return entity.entry.contentType === 'article'
      ? 'circle'
      : entity.entry.contentType === 'video'
        ? 'diamond'
        : 'star';
  }
  if (entity.kind === 'media') {
    return entity.media.mediaKind === 'image' ? 'hexagon' : 'diamond';
  }
  if (entity.kind === 'voice') {
    return entity.voice.pitchHz > 180 ? 'star' : 'circle';
  }
  if (entity.kind === 'zoo-species') {
    switch (entity.zoo.taxonomicGroup) {
      case 'Mammal':
        return 'circle';
      case 'Bird':
        return 'diamond';
      case 'Fish':
      case 'Amphibian':
        return 'hexagon';
      default:
        return 'star';
    }
  }
  switch (entity.body.posture) {
    case 'athletic':
      return 'hexagon';
    case 'dynamic':
      return 'diamond';
    case 'compact':
      return 'star';
    default:
      return 'circle';
  }
}

function resolveEntitySizeBonus(entity: DemoEntity): number {
  if (entity.kind === 'knowledge') {
    return Math.min(3.5, Math.floor(entity.entry.readingMinutes / 8));
  }
  if (entity.kind === 'media') {
    return entity.media.mediaKind === 'video' ? 2.0 : 1;
  }
  if (entity.kind === 'voice') {
    return Math.min(3.0, Math.floor(entity.voice.durationSec / 10));
  }
  if (entity.kind === 'zoo-species') {
    return entity.zoo.predator ? 1.2 : 0;
  }
  return Math.max(0, Math.min(3.0, (entity.body.heightCm - 18) / 3));
}

function formatEntityCardMeta(entity: DemoEntity): string {
  if (entity.kind === 'knowledge') {
    return entity.entry.primaryAuthor ?? `${entity.entry.publishedYear}`;
  }
  if (entity.kind === 'media') {
    return `IMDb ${entity.media.imdbRating.toFixed(1)} · RT ${entity.media.rottenTomatoes}%`;
  }
  if (entity.kind === 'voice') {
    return `${entity.voice.language} · ${entity.voice.speakerProfile}`;
  }
  if (entity.kind === 'zoo-species') {
    return `${entity.zoo.taxonomicGroup} · ${entity.zoo.legs} legs`;
  }
  return `${entity.body.species} · ${entity.body.bodyMassG}g`;
}

export function createDemoVisualResolver(
  config: DemoRenderConfig,
  theme: SimplexTheme = 'dark',
  thumbManifest?: CommonsThumbManifest,
): VisualResolver<
  DemoEntity,
  DemoContentVisual,
  DemoClusterVisual,
  TagTaxonomyInfo,
  DemoClusterSummary
> {
  return {
    resolveContentVisual: (item, ctx) => {
      const sizeBonus = config.scaleByReadingTime ? resolveEntitySizeBonus(item) : 0;

      if (config.contentRenderer === 'domain') {
        const s = config.domainGlyphScale;

        // GitHub Open-Source Repositories
        if (item.kind === 'knowledge' && item.entry.repoName) {
          const shortRepo = truncateLabel(item.entry.repoName, 11);
          const starsLabel = item.entry.repoStarsLabel ?? '';
          const langHex =
            (item.entry.repoLanguage && REPO_LANGUAGE_COLORS[item.entry.repoLanguage]) ||
            ctx.mixedColorHex;
          const computedW = Math.max(
            62,
            Math.round(18 + shortRepo.length * 4.9 + (starsLabel.length + 1) * 4.4 + 8),
          );
          return {
            kind: 'domain-repo',
            theme,
            width: Math.round(computedW * s),
            height: Math.round(21 * s),
            repoName: shortRepo,
            starsLabel,
            langColorHex: langHex,
            colorHex: ctx.mixedColorHex,
          };
        }

        // arXiv Scientific Papers
        if (item.kind === 'knowledge') {
          const { codeTag, figureKind } = resolvePaperFigureAndCode(item.entry.hashtags);
          return {
            kind: 'domain-knowledge',
            theme,
            width: Math.round(25 * s),
            height: Math.round(31 * s),
            codeTag,
            figureKind,
            sectors: ctx.unitClusters.map((uc) => ({
              colorHex: uc.cluster.colorHex,
              weight: uc.weight,
            })),
            colorHex: ctx.mixedColorHex,
          };
        }

        // UCI Zoo Species
        if (item.kind === 'zoo-species') {
          const symbolKind = resolveZooSymbolKind(
            item.zoo.speciesName,
            item.zoo.taxonomicGroup,
          );
          const predBonus = config.scaleByReadingTime && item.zoo.predator ? 1.1 : 0;
          const localPath = item.zoo.mediaCredit?.localPath;
          const photoUrl = localPath ? thumbManifest?.[localPath]?.canvasSrc : undefined;
          return {
            kind: 'domain-zoo',
            theme,
            radius: Number(((14.4 + predBonus) * s).toFixed(1)),
            symbolKind,
            photoUrl,
            aquatic: item.zoo.aquatic,
            colorHex: ctx.mixedColorHex,
          };
        }

        // Vega Cinema Movies (2:3 vertical Public-Domain posters)
        if (item.kind === 'media') {
          const thumbnailUrl = thumbManifest?.[item.media.mediaCredit.localPath]?.canvasSrc;
          const bonus =
            config.scaleByReadingTime && item.media.mediaKind === 'video' ? 1.06 : 1.0;
          return {
            kind: 'domain-media',
            theme,
            width: Math.round(33 * s * bonus),
            height: Math.round(47 * s * bonus),
            shortTitle: item.media.shortTitle,
            thumbnailUrl,
            imdbRating: item.media.imdbRating,
            aspectRatio: item.media.aspectRatio,
            mediaKind: item.media.mediaKind,
            motif: item.media.motif,
            palette: item.media.palette,
            colorHex: ctx.mixedColorHex,
          };
        }

        // UCI Spoken Vowels
        if (item.kind === 'voice') {
          const baseW = config.voiceShowPitchLabel ? 68 : 50;
          return {
            kind: 'domain-voice',
            theme,
            width: Math.round(baseW * s),
            height: Math.round(22 * s),
            ipaSymbol: item.voice.language,
            waveform: item.voice.waveform,
            barCount: config.voiceWaveformBars,
            pitchHz: item.voice.pitchHz,
            colorHex: ctx.mixedColorHex,
            showPitchLabel: config.voiceShowPitchLabel,
          };
        }

        // Palmer Penguins Biometrics
        const statureBonus = config.scaleByReadingTime
          ? Math.max(-1.4, Math.min(2.8, (item.body.bodyMassG - 3800) / 600))
          : 0;
        return {
          kind: 'domain-body',
          theme,
          radius: Number(((16.2 + statureBonus) * s).toFixed(1)),
          species: item.body.species,
          billLengthMm: item.body.billLengthMm,
          billDepthMm: item.body.billDepthMm,
          flipperLengthMm: item.body.flipperLengthMm,
          bodyMassG: item.body.bodyMassG,
          proportions: item.body.proportions,
          heightCm: item.body.heightCm,
          posture: item.body.posture,
          colorHex: ctx.mixedColorHex,
          showCalibrationRing: config.bodyShowCalibrationRing,
          showHeightLabel: config.bodyShowHeightLabel,
        };
      }

      if (config.contentRenderer === 'geometric') {
        const shape: GeometricShapeKind =
          config.contentShapeMode === 'by-type'
            ? resolveEntityShape(item)
            : config.contentShapeMode;

        return {
          kind: 'geometric',
          shape: {
            shape,
            radius: config.contentBaseRadius + sizeBonus,
            fillHex: ctx.mixedColorHex,
            strokeHex: theme === 'light' ? '#FFFFFF' : '#07090E',
            strokeWidth: config.contentStrokeWidth,
            theme,
          },
        };
      }

      if (config.contentRenderer === 'multisector') {
        const outerRadius = config.contentBaseRadius + 2 + sizeBonus * 0.75;
        const innerRadius = Math.max(2.5, outerRadius * config.donutInnerRatio);
        return {
          kind: 'multisector',
          glyph: {
            outerRadius,
            innerRadius,
            sectors: ctx.unitClusters.map((uc) => ({
              colorHex: uc.cluster.colorHex,
              weight: uc.weight,
            })),
            centerColorHex: ctx.mixedColorHex,
            accentRingHex: config.donutAccentRing
              ? theme === 'light'
                ? '#0891b2'
                : '#22d3ee'
              : undefined,
            theme,
          },
        };
      }

      const displayHeadline =
        item.kind === 'knowledge' && item.entry.repoName
          ? item.entry.repoName
          : item.title;
      const snippet = truncateLabel(displayHeadline, config.contentCardMaxChars);
      const metaLine = formatEntityCardMeta(item);
      return {
        kind: 'react-card',
        theme,
        key: `card:${theme}:${item.kind}:${item.id}:${ctx.mixedColorHex}:${metaLine}:${config.contentCardMaxChars}:${config.showContentCardMeta ? 1 : 0}`,
        colorHex: ctx.mixedColorHex,
        headline: snippet,
        metaLine,
        maxChars: config.contentCardMaxChars,
        showMeta: config.showContentCardMeta,
      };
    },

    resolveClusterVisual: (cluster) => {
      const isIntermediate =
        cluster.role === 'intermediate' || Boolean(cluster.meta.isIntermediate);
      const accentColors = cluster.mixWeights
        ?.slice(0, 2)
        .map((m) => m.colorHex);
      const bridgeSuffix =
        cluster.meta.shortBridgeTag ||
        cluster.subclusterLabel ||
        cluster.defaultLabel ||
        cluster.code;
      const parentContextLabel = isIntermediate
        ? (cluster.meta.parentContextLabel ?? cluster.parentContextLabel)
        : undefined;

      if (config.clusterRenderer === 'anchor') {
        return {
          kind: 'anchor',
          anchor: {
            code: cluster.code,
            label: cluster.meta.title,
            memberCount: cluster.meta.memberCount,
            colorHex: cluster.colorHex,
            radius: config.anchorRadius,
            theme,
            variant: isIntermediate ? 'intermediate' : 'primary',
            parentContextLabel,
            accentColors,
          },
        };
      }

      const shortTitle = truncateLabel(cluster.meta.title, config.clusterTitleMaxChars);
      const shortBridge = truncateLabel(
        bridgeSuffix,
        Math.max(22, config.clusterTitleMaxChars + 4),
      );
      if (config.clusterRenderer === 'badge') {
        const metaLine = isIntermediate
          ? ''
          : config.showClusterMetaLine
            ? cluster.meta.subtitle
            : '';
        return {
          kind: 'badge',
          badge: {
            code: cluster.code,
            title: isIntermediate ? shortBridge : shortTitle,
            metaLine,
            colorHex: cluster.colorHex,
            theme,
            variant: isIntermediate ? 'intermediate' : 'primary',
            parentContextLabel,
            accentColors,
          },
        };
      }

      return {
        kind: 'react-card',
        theme,
        key: `rc:${theme}:${isIntermediate ? 'int' : 'pri'}:${cluster.clusterUid}:${parentContextLabel ?? ''}:${isIntermediate ? shortBridge : shortTitle}:${cluster.colorHex}:${config.clusterTitleMaxChars}:${config.showClusterMetaLine ? 1 : 0}`,
        colorHex: cluster.colorHex,
        code: cluster.code,
        title: shortTitle,
        memberCount: cluster.meta.memberCount,
        subtitle: cluster.meta.subtitle,
        maxChars: config.clusterTitleMaxChars,
        showMeta: config.showClusterMetaLine,
        isIntermediate,
        shortBridgeTag: shortBridge,
        parentContextLabel,
        accentColors,
      };
    },

    getVisualCacheKey: (visual) => {
      if (visual.kind === 'domain-knowledge') {
        const secKey = visual.sectors
          .map((s) => `${s.colorHex}:${s.weight.toFixed(2)}`)
          .join('|');
        return `dk:${visual.theme}:${visual.width}x${visual.height}:${visual.codeTag}:${visual.figureKind}:${visual.colorHex}:${secKey}`;
      }
      if (visual.kind === 'domain-repo') {
        return `dr:${visual.theme}:${visual.width}x${visual.height}:${visual.repoName}:${visual.starsLabel}:${visual.langColorHex}:${visual.colorHex}`;
      }
      if (visual.kind === 'domain-zoo') {
        return `dz:${visual.theme}:${visual.radius}:${visual.symbolKind}:${visual.photoUrl ?? 'sym'}:${visual.colorHex}`;
      }
      if (visual.kind === 'domain-media') {
        return `dm:${visual.theme}:${visual.width}x${visual.height}:${visual.shortTitle}:${visual.thumbnailUrl ?? 'fallback'}:${visual.imdbRating}:${visual.colorHex}`;
      }
      if (visual.kind === 'domain-voice') {
        const waveKey = visual.waveform
          .slice(0, visual.barCount)
          .map((w) => w.toFixed(2))
          .join(',');
        return `dv:${visual.theme}:${visual.width}x${visual.height}:${visual.ipaSymbol}:${visual.barCount}:${visual.pitchHz}:${visual.colorHex}:${visual.showPitchLabel ? 1 : 0}:${waveKey}`;
      }
      if (visual.kind === 'domain-body') {
        return `db:${visual.theme}:${visual.radius}:${visual.species}:${visual.billLengthMm}:${visual.billDepthMm}:${visual.flipperLengthMm}:${visual.bodyMassG}:${visual.colorHex}:${visual.showCalibrationRing ? 1 : 0}`;
      }
      if (visual.kind === 'geometric') {
        return `g:${visual.shape.theme ?? 'dark'}:${visual.shape.shape}:${visual.shape.radius}:${visual.shape.strokeWidth ?? 1.4}:${visual.shape.fillHex}`;
      }
      if (visual.kind === 'multisector') {
        const secKey = visual.glyph.sectors
          .map((s) => `${s.colorHex}:${s.weight.toFixed(2)}`)
          .join('|');
        return `m:${visual.glyph.theme ?? 'dark'}:${visual.glyph.outerRadius.toFixed(1)}:${visual.glyph.innerRadius.toFixed(1)}:${visual.glyph.accentRingHex ?? 'none'}:${secKey}`;
      }
      if (visual.kind === 'anchor') {
        return `ga:${visual.anchor.theme ?? 'dark'}:${visual.anchor.variant ?? 'primary'}:${visual.anchor.parentContextLabel ?? ''}:${visual.anchor.code}:${visual.anchor.memberCount}:${visual.anchor.radius}:${visual.anchor.colorHex}`;
      }
      if (visual.kind === 'badge') {
        return `mb:${visual.badge.theme ?? 'dark'}:${visual.badge.variant ?? 'primary'}:${visual.badge.parentContextLabel ?? ''}:${visual.badge.title}:${visual.badge.metaLine}:${visual.badge.colorHex}`;
      }
      return visual.key;
    },
  };
}

/**
 * Declarative React JSX renderer for content item mini-cards.
 */
export function renderDemoContentCard(
  entity: DemoEntity,
  ctx: ContentLayoutContext<DemoEntity, TagTaxonomyInfo, DemoClusterSummary>,
  state: NodeRenderState<DemoContentVisual>,
): ReactNode {
  const cardVisual = state.visual.kind === 'react-card' ? state.visual : null;
  const isLight = cardVisual?.theme === 'light';
  const maxChars = cardVisual?.maxChars ?? 16;
  const showMeta = cardVisual?.showMeta ?? false;
  const rawHeadline =
    entity.kind === 'knowledge' && entity.entry.repoName
      ? entity.entry.repoName
      : entity.title;
  const snippet = cardVisual?.headline ?? truncateLabel(rawHeadline, maxChars);
  const metaLine = cardVisual?.metaLine ?? formatEntityCardMeta(entity);

  const isHighlightedOrHovered =
    state.interaction.isHovered || state.interaction.isHighlighted;
  const stroke = state.interaction.isPinned
    ? isLight
      ? '#d97706'
      : '#f59e0b'
    : state.interaction.isHovered
      ? isLight
        ? '#0f172a'
        : '#f8fafc'
      : state.interaction.isHighlighted
        ? ctx.mixedColorHex
        : isLight
          ? '#cbd5e1'
          : '#293548';

  const width = Math.max(
    64,
    Math.round(
      Math.max(
        snippet.length * 5.2 + 24,
        showMeta ? metaLine.length * 4.8 + 24 : 0,
      ),
    ),
  );
  const height = showMeta ? 30 : 21;
  const halfW = width / 2;
  const halfH = height / 2;

  return (
    <g>
      <rect
        x={-halfW}
        y={-halfH}
        width={width}
        height={height}
        rx={3.0}
        fill={isLight ? '#ffffff' : '#0d1320'}
        fillOpacity={isLight ? 0.98 : 0.96}
        stroke={stroke}
        strokeWidth={isHighlightedOrHovered || state.interaction.isPinned ? 1.85 : 1.05}
      />
      <rect
        x={-halfW + 6.2}
        y={showMeta ? -6.3 : -2.3}
        width={4.6}
        height={4.6}
        rx={1.1}
        fill={ctx.mixedColorHex}
      />
      <text
        x={-halfW + 15.2}
        y={showMeta ? -2 : 2.8}
        fill={isLight ? '#0f172a' : '#f1f5f9'}
        fontSize={8.3}
        fontWeight={600}
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {snippet}
      </text>
      {showMeta && (
        <text
          x={-halfW + 15.2}
          y={9.5}
          fill={isLight ? '#475569' : '#94a3b8'}
          fontSize={7.2}
          fontFamily="IBM Plex Mono, monospace"
        >
          {metaLine}
        </text>
      )}
    </g>
  );
}

/**
 * Declarative React JSX renderer for saturated cartographic cluster capsules
 * and saturated chamfered sub-cluster plaques.
 */
export function renderDemoClusterCard(
  cluster: ClusterDescriptor<DemoEntity, TagTaxonomyInfo, DemoClusterSummary>,
  state: NodeRenderState<DemoClusterVisual>,
): ReactNode {
  const cardVisual = state.visual.kind === 'react-card' ? state.visual : null;
  const theme = cardVisual?.theme === 'light' ? 'light' : 'dark';
  const isLight = theme === 'light';
  const isActive = state.interaction.isHovered || state.interaction.isHighlighted;
  const isIntermediate =
    cardVisual?.isIntermediate ??
    (cluster.role === 'intermediate' || Boolean(cluster.meta.isIntermediate));
  const palette = resolveClusterSurfaceColors(cluster.colorHex, theme);

  if (isIntermediate) {
    const suffix = (
      cardVisual?.shortBridgeTag ||
      cluster.meta.shortBridgeTag ||
      cluster.subclusterLabel ||
      cluster.defaultLabel ||
      cluster.code
    ).trim();
    const parentCtx = (
      cardVisual?.parentContextLabel ??
      cluster.meta.parentContextLabel ??
      cluster.parentContextLabel ??
      ''
    ).trim();
    const hasParentCtx = parentCtx.length > 0;
    const width = hasParentCtx
      ? Math.max(
          66,
          Math.round(parentCtx.length * 5.25 + 24),
          Math.round(suffix.length * 5.9 + 22),
        )
      : Math.max(48, Math.round(suffix.length * 5.8 + 20));
    const height = hasParentCtx ? 32 : 22;
    const halfW = width / 2;
    const halfH = height / 2;
    const cut = hasParentCtx ? 6.4 : 5.4;
    const haloPad = hasParentCtx ? 2.5 : 2.3;
    const chamferPts = (hw: number, hh: number, c: number, dy = 0): string =>
      `${(-hw + c).toFixed(1)},${(-hh + dy).toFixed(1)} ${(hw - c).toFixed(1)},${(-hh + dy).toFixed(1)} ${hw.toFixed(1)},${dy.toFixed(1)} ${(hw - c).toFixed(1)},${(hh + dy).toFixed(1)} ${(-hw + c).toFixed(1)},${(hh + dy).toFixed(1)} ${(-hw).toFixed(1)},${dy.toFixed(1)}`;

    return (
      <g>
        <polygon
          points={chamferPts(halfW, halfH, cut, 1.4)}
          fill="#020617"
          fillOpacity={isLight ? 0.15 : 0.42}
        />
        <polygon
          points={chamferPts(halfW + haloPad, halfH + haloPad, cut + 1.0)}
          fill="none"
          stroke={state.interaction.isPinned ? '#f59e0b' : palette.haloHex}
          strokeWidth={isActive ? 1.75 : 1.15}
          strokeOpacity={
            isActive || state.interaction.isPinned ? 0.96 : isLight ? 0.54 : 0.68
          }
          strokeDasharray={isActive ? undefined : '3 2'}
          strokeLinejoin="round"
        />
        <polygon
          points={chamferPts(halfW, halfH, cut)}
          fill={palette.solidFillHex}
          stroke={state.interaction.isPinned ? '#fef08a' : '#ffffff'}
          strokeWidth={isActive ? 1.5 : 0.95}
          strokeOpacity={isActive ? 0.92 : 0.28}
          strokeLinejoin="round"
        />
        {hasParentCtx ? (
          <>
            <text
              x={0}
              y={-4.2}
              textAnchor="middle"
              fill="#ffffff"
              fillOpacity={0.78}
              fontSize={7.3}
              fontWeight={700}
              letterSpacing="0.05em"
              fontFamily="IBM Plex Mono, monospace"
            >
              {parentCtx.toUpperCase()}
            </text>
            <text
              x={0}
              y={7.5}
              textAnchor="middle"
              fill="#ffffff"
              fontSize={9.2}
              fontWeight={700}
              letterSpacing="0.01em"
              fontFamily="Plus Jakarta Sans, sans-serif"
            >
              {suffix}
            </text>
          </>
        ) : (
          <text
            x={0}
            y={3.2}
            textAnchor="middle"
            fill="#ffffff"
            fontSize={9.1}
            fontWeight={700}
            letterSpacing="0.01em"
            fontFamily="Plus Jakarta Sans, sans-serif"
          >
            {suffix}
          </text>
        )}
      </g>
    );
  }

  const maxChars = cardVisual?.maxChars ?? 18;
  const showMeta = cardVisual?.showMeta ?? false;
  const title = cardVisual?.title ?? truncateLabel(cluster.meta.title, maxChars);
  const metaLine = cluster.meta.subtitle;
  const width = Math.max(
    54,
    Math.round(
      Math.max(title.length * 6.35 + 26, showMeta ? metaLine.length * 5.3 + 26 : 0),
    ),
  );
  const height = showMeta ? 38 : 25;
  const halfW = width / 2;
  const halfH = height / 2;
  const rx = halfH;
  const haloPad = 2.6;

  return (
    <g>
      <rect
        x={-halfW}
        y={-halfH + 1.6}
        width={width}
        height={height}
        rx={rx}
        fill="#020617"
        fillOpacity={isLight ? 0.16 : 0.45}
      />
      <rect
        x={-halfW - haloPad}
        y={-halfH - haloPad}
        width={width + haloPad * 2}
        height={height + haloPad * 2}
        rx={rx + haloPad}
        fill="none"
        stroke={state.interaction.isPinned ? '#f59e0b' : palette.haloHex}
        strokeWidth={isActive ? 1.85 : 1.2}
        strokeOpacity={
          isActive || state.interaction.isPinned ? 0.96 : isLight ? 0.48 : 0.64
        }
      />
      <rect
        x={-halfW}
        y={-halfH}
        width={width}
        height={height}
        rx={rx}
        fill={palette.solidFillHex}
        stroke={state.interaction.isPinned ? '#fef08a' : '#ffffff'}
        strokeWidth={isActive ? 1.6 : 1.0}
        strokeOpacity={isActive ? 0.92 : 0.28}
      />
      <text
        x={0}
        y={showMeta ? -2.2 : 3.7}
        textAnchor="middle"
        fill="#ffffff"
        fontSize={10.5}
        fontWeight={700}
        letterSpacing="0.01em"
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {title}
      </text>
      {showMeta && (
        <text
          x={0}
          y={10.6}
          textAnchor="middle"
          fill="#ffffff"
          fillOpacity={0.85}
          fontSize={8.3}
          fontFamily="IBM Plex Mono, monospace"
        >
          {metaLine}
        </text>
      )}
    </g>
  );
}
