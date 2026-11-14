import {
  rectToConvexPolygon,
  type ClusterDescriptor,
  type ContentLayoutContext,
  type NodeRenderState,
  type VisualResolver,
} from '@simplex-viz/core';
import {
  BadgeClusterSvgView,
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
import type { TagTaxonomyInfo } from './data/knowledgeCatalog';
import type {
  BodyShapeItem,
  DemoClusterSummary,
  DemoEntity,
  VisualMediaItem,
} from './data/multimodalCatalog';

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
  contentRenderer: 'geometric',
  clusterRenderer: 'badge',
  contentShapeMode: 'by-type',
  contentBaseRadius: 9,
  contentStrokeWidth: 1.4,
  scaleByReadingTime: true,
  domainGlyphScale: 1.0,
  mediaShowAspectTag: true,
  mediaShowVideoBadge: true,
  voiceWaveformBars: 9,
  voiceShowPitchLabel: false,
  bodyShowCalibrationRing: true,
  bodyShowHeightLabel: false,
  donutInnerRatio: 0.44,
  donutAccentRing: false,
  contentCardMaxChars: 17,
  showContentCardMeta: true,
  anchorRadius: 23,
  clusterTitleMaxChars: 22,
  showClusterMetaLine: true,
  triangleFaceStyle: 'oklab-tint',
  triangleFaceOpacity: 0.09,
  meshEdgeStyle: 'dashed',
  meshEdgeWidth: 1.0,
};

/**
 * Unified discriminated union for independent content visuals across SVG and React JSX renderers,
 * preserving complete type safety without `any`.
 */
export type DemoContentVisual =
  | { readonly kind: 'geometric'; readonly shape: GeometricShapeVisual }
  | { readonly kind: 'multisector'; readonly glyph: MultiSectorGlyphVisual }
  | {
      readonly kind: 'domain-media';
      readonly theme: SimplexTheme;
      readonly width: number;
      readonly height: number;
      readonly aspectRatio: VisualMediaItem['aspectRatio'];
      readonly mediaKind: VisualMediaItem['mediaKind'];
      readonly motif: VisualMediaItem['motif'];
      readonly palette: readonly [string, string];
      readonly colorHex: string;
      readonly showPlayBadge: boolean;
      readonly showAspectTag: boolean;
    }
  | {
      readonly kind: 'domain-voice';
      readonly theme: SimplexTheme;
      readonly width: number;
      readonly height: number;
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
 * Unified discriminated union for independent cluster visuals across SVG and React JSX renderers.
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
    };

const geomBase = new GeometricShapeSvgView();
const sectorBase = new MultiSectorGlyphSvgView();
const anchorBase = new ClusterAnchorSvgView();
const badgeBase = new BadgeClusterSvgView();

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

function resolveStateStroke(
  state: NodeRenderState<DemoContentVisual>,
  isLight: boolean,
  fallbackHex: string,
): { stroke: string; strokeWidth: number; accentHalo: string | null } {
  const accent = isLight ? '#0891b2' : '#22d3ee';
  if (state.interaction.isPinned) {
    return { stroke: '#f59e0b', strokeWidth: 2.2, accentHalo: '#f59e0b' };
  }
  if (state.interaction.isHovered) {
    return {
      stroke: isLight ? '#0f172a' : '#f8fafc',
      strokeWidth: 2.1,
      accentHalo: accent,
    };
  }
  if (state.interaction.isHighlighted) {
    return { stroke: fallbackHex, strokeWidth: 1.8, accentHalo: accent };
  }
  return { stroke: fallbackHex, strokeWidth: 1.4, accentHalo: null };
}

export const demoDomainContentView: SvgNodeView<DemoContentVisual> = {
  measureConvexHull: (v) => {
    if (v.kind === 'domain-media') {
      return rectToConvexPolygon(v.width + 3, v.height + 3);
    }
    if (v.kind === 'domain-voice') {
      return rectToConvexPolygon(v.width + 3, v.height + 3);
    }
    if (v.kind === 'domain-body') {
      return { kind: 'circle', radius: v.radius + 2.5 };
    }
    if (v.kind === 'geometric') {
      return geomBase.measureConvexHull(v.shape);
    }
    return { kind: 'circle', radius: 12 };
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
            x: -hw - 3.5,
            y: -hh - 3.5,
            width: v.width + 7,
            height: v.height + 7,
            rx: 5.5,
            fill: 'none',
            stroke: accentHalo,
            'stroke-width': 1.3,
            'stroke-opacity': 0.9,
          }),
        );
      }

      // Frame background + diagonal two-tone palette layer (defs-free for crossfade safety)
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: -hw,
          y: -hh,
          width: v.width,
          height: v.height,
          rx: 3.5,
          fill: v.palette[1],
        }),
      );
      groupEl.appendChild(
        createSvgEl(doc, 'polygon', {
          points: `${-hw},${-hh} ${hw},${-hh} ${-hw},${hh}`,
          fill: v.palette[0],
          'fill-opacity': 0.55,
        }),
      );

      // Motif vector artwork
      if (v.motif === 'horizon') {
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: -hw * 0.36,
            cy: -hh * 0.24,
            r: Math.min(hw, hh) * 0.24,
            fill: '#ffffff',
            'fill-opacity': 0.42,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'polygon', {
            points: `${-hw},${hh} ${-hw * 0.28},${hh * 0.05} ${hw * 0.16},${hh * 0.52} ${hw * 0.55},${-hh * 0.04} ${hw},${hh}`,
            fill: '#07090e',
            'fill-opacity': 0.48,
          }),
        );
      } else if (v.motif === 'architecture') {
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: -hw * 0.58,
            y: -hh * 0.45,
            width: v.width * 0.24,
            height: v.height * 0.9,
            fill: '#07090e',
            'fill-opacity': 0.38,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: -hw * 0.05,
            y: -hh * 0.18,
            width: v.width * 0.32,
            height: v.height * 0.72,
            fill: '#ffffff',
            'fill-opacity': 0.25,
          }),
        );
      } else if (v.motif === 'portrait') {
        const pr = Math.min(hw, hh) * 0.32;
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: -hh * 0.22,
            r: pr,
            fill: '#ffffff',
            'fill-opacity': 0.46,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'ellipse', {
            cx: 0,
            cy: hh * 0.68,
            rx: pr * 1.65,
            ry: hh * 0.52,
            fill: '#07090e',
            'fill-opacity': 0.48,
          }),
        );
      } else if (v.motif === 'macro') {
        const mr = Math.min(hw, hh) * 0.56;
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: 0,
            r: mr,
            fill: 'none',
            stroke: '#ffffff',
            'stroke-width': 1.2,
            'stroke-opacity': 0.45,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: -mr * 0.25,
            cy: -mr * 0.2,
            r: mr * 0.36,
            fill: '#ffffff',
            'fill-opacity': 0.35,
          }),
        );
      } else if (v.motif === 'kinetic') {
        groupEl.appendChild(
          createSvgEl(doc, 'line', {
            x1: -hw * 0.65,
            y1: hh * 0.25,
            x2: hw * 0.55,
            y2: -hh * 0.45,
            stroke: '#ffffff',
            'stroke-width': 1.6,
            'stroke-opacity': 0.55,
            'stroke-linecap': 'round',
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'line', {
            x1: -hw * 0.45,
            y1: hh * 0.55,
            x2: hw * 0.68,
            y2: -hh * 0.08,
            stroke: '#ffffff',
            'stroke-width': 1.2,
            'stroke-opacity': 0.4,
            'stroke-linecap': 'round',
          }),
        );
      } else {
        const ar = Math.min(hw, hh) * 0.45;
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: -ar * 0.45,
            cy: 0,
            r: ar,
            fill: '#ffffff',
            'fill-opacity': 0.26,
          }),
        );
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: ar * 0.45,
            cy: 0,
            r: ar,
            fill: '#07090e',
            'fill-opacity': 0.3,
          }),
        );
      }

      // Crisp border tinted by simplex mixedColorHex
      groupEl.appendChild(
        createSvgEl(doc, 'rect', {
          x: -hw,
          y: -hh,
          width: v.width,
          height: v.height,
          rx: 3.5,
          fill: 'none',
          stroke,
          'stroke-width': strokeWidth,
        }),
      );

      // Cluster-mix anchor dot in top-left corner
      groupEl.appendChild(
        createSvgEl(doc, 'circle', {
          cx: -hw + 4.2,
          cy: -hh + 4.2,
          r: 2.3,
          fill: v.colorHex,
          stroke: isLight ? '#ffffff' : '#07090e',
          'stroke-width': 0.75,
        }),
      );

      if (v.mediaKind === 'video' && v.showPlayBadge) {
        const pr = Math.max(4.5, Math.min(hw, hh) * 0.42);
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: 0,
            r: pr,
            fill: '#07090e',
            'fill-opacity': 0.64,
          }),
        );
        const tri = pr * 0.56;
        groupEl.appendChild(
          createSvgEl(doc, 'polygon', {
            points: `${(-tri * 0.55).toFixed(1)},${(-tri * 0.85).toFixed(1)} ${(tri * 0.95).toFixed(1)},0 ${(-tri * 0.55).toFixed(1)},${(tri * 0.85).toFixed(1)}`,
            fill: '#f8fafc',
          }),
        );
      }

      if (v.showAspectTag) {
        const badgeEl = createSvgEl(doc, 'text', {
          x: hw - 2.5,
          y: hh - 2.4,
          'text-anchor': 'end',
          fill: '#f8fafc',
          'font-size': 5.8,
          'font-weight': 600,
          'font-family': 'IBM Plex Mono, monospace',
          'paint-order': 'stroke',
          stroke: '#07090e',
          'stroke-width': 1.8,
          'stroke-linejoin': 'round',
        });
        badgeEl.textContent = v.aspectRatio;
        groupEl.appendChild(badgeEl);
      }
      return;
    }

    if (v.kind === 'domain-voice') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const rx = hh;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: -hw - 3.5,
            y: -hh - 3.5,
            width: v.width + 7,
            height: v.height + 7,
            rx: rx + 3.5,
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
          'fill-opacity': isLight ? 0.96 : 0.94,
          stroke,
          'stroke-width': strokeWidth,
        }),
      );

      const wavePadLeft = 6.5;
      const pitchReserve = v.showPitchLabel ? 24 : 6.5;
      const waveSpan = Math.max(14, v.width - wavePadLeft - pitchReserve);
      const startX = -hw + wavePadLeft;
      const count = Math.max(4, Math.min(v.waveform.length, v.barCount));
      const step = waveSpan / count;
      const barW = Math.max(1.6, Math.min(3.2, step * 0.62));
      const maxBarH = v.height - 6.5;

      groupEl.appendChild(
        createSvgEl(doc, 'line', {
          x1: startX,
          y1: 0,
          x2: startX + waveSpan,
          y2: 0,
          stroke: v.colorHex,
          'stroke-opacity': 0.28,
          'stroke-width': 0.8,
        }),
      );

      for (let i = 0; i < count; i++) {
        const sampleIdx = Math.min(
          v.waveform.length - 1,
          Math.floor((i * v.waveform.length) / count),
        );
        const amp = v.waveform[sampleIdx] ?? 0.4;
        const barH = Math.max(3, amp * maxBarH);
        const bx = startX + i * step + (step - barW) / 2;
        groupEl.appendChild(
          createSvgEl(doc, 'rect', {
            x: bx.toFixed(2),
            y: (-barH / 2).toFixed(2),
            width: barW.toFixed(2),
            height: barH.toFixed(2),
            rx: (barW / 2).toFixed(2),
            fill: v.colorHex,
            'fill-opacity': 0.92,
          }),
        );
      }

      if (v.showPitchLabel) {
        const pitchEl = createSvgEl(doc, 'text', {
          x: hw - 5.5,
          y: 2.3,
          'text-anchor': 'end',
          fill: isLight ? '#334155' : '#cbd5e1',
          'font-size': 6.6,
          'font-weight': 600,
          'font-family': 'IBM Plex Mono, monospace',
        });
        pitchEl.textContent = `${v.pitchHz}Hz`;
        groupEl.appendChild(pitchEl);
      }
      return;
    }

    if (v.kind === 'domain-body') {
      const isLight = v.theme === 'light';
      const r = v.radius;
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
            r: r + 4,
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
          fill: isLight ? '#ffffff' : '#0b101b',
          'fill-opacity': isLight ? 0.96 : 0.94,
          stroke,
          'stroke-width': strokeWidth,
        }),
      );

      if (v.showCalibrationRing) {
        groupEl.appendChild(
          createSvgEl(doc, 'circle', {
            cx: 0,
            cy: 0,
            r: Math.max(4, r - 2.6),
            fill: 'none',
            stroke: v.colorHex,
            'stroke-opacity': 0.34,
            'stroke-width': 0.8,
            'stroke-dasharray': '2.2 2',
          }),
        );
      }

      const scale = r / 15.5;
      const p = v.proportions;
      const sw = p.shoulderW * 6.4 * scale;
      const ww = p.waistW * 5.2 * scale;
      const hw = p.hipW * 5.9 * scale;
      const figShiftY = v.showHeightLabel ? -2.2 * scale : 0.2 * scale;

      const figGroup = createSvgEl(doc, 'g', {
        transform: `translate(0, ${figShiftY.toFixed(2)}) rotate(${(p.leanDeg * 0.5).toFixed(1)})`,
      });
      figGroup.appendChild(
        createSvgEl(doc, 'circle', {
          cx: 0,
          cy: (-7.6 * scale).toFixed(2),
          r: (2.0 * scale).toFixed(2),
          fill: v.colorHex,
        }),
      );
      figGroup.appendChild(
        createSvgEl(doc, 'polygon', {
          points: `${(-sw).toFixed(1)},${(-4.6 * scale).toFixed(1)} ${sw.toFixed(1)},${(-4.6 * scale).toFixed(1)} ${ww.toFixed(1)},${(0.4 * scale).toFixed(1)} ${hw.toFixed(1)},${(3.0 * scale).toFixed(1)} ${(-hw).toFixed(1)},${(3.0 * scale).toFixed(1)} ${(-ww).toFixed(1)},${(0.4 * scale).toFixed(1)}`,
          fill: v.colorHex,
          'fill-opacity': 0.88,
        }),
      );
      figGroup.appendChild(
        createSvgEl(doc, 'line', {
          x1: (-hw * 0.45).toFixed(1),
          y1: (3.0 * scale).toFixed(1),
          x2: (-hw * 0.52).toFixed(1),
          y2: (8.6 * scale).toFixed(1),
          stroke: v.colorHex,
          'stroke-width': Math.max(1.2, 1.8 * scale),
          'stroke-linecap': 'round',
        }),
      );
      figGroup.appendChild(
        createSvgEl(doc, 'line', {
          x1: (hw * 0.45).toFixed(1),
          y1: (3.0 * scale).toFixed(1),
          x2: (hw * 0.52).toFixed(1),
          y2: (8.6 * scale).toFixed(1),
          stroke: v.colorHex,
          'stroke-width': Math.max(1.2, 1.8 * scale),
          'stroke-linecap': 'round',
        }),
      );
      groupEl.appendChild(figGroup);

      if (v.showHeightLabel) {
        const hEl = createSvgEl(doc, 'text', {
          x: 0,
          y: (r - 3.0).toFixed(1),
          'text-anchor': 'middle',
          fill: isLight ? '#475569' : '#94a3b8',
          'font-size': 5.6,
          'font-weight': 600,
          'font-family': 'IBM Plex Mono, monospace',
        });
        hEl.textContent = `${v.heightCm}cm`;
        groupEl.appendChild(hEl);
      }
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

export const demoBadgeClusterView: SvgNodeView<DemoClusterVisual> = {
  // Intentionally omits measureConvexHull so @simplex-viz/svg performs automatic getBBox() measurement
  mountOrUpdate: (g, v, state) => {
    if (v.kind === 'badge') {
      badgeBase.mountOrUpdate(g, v.badge, {
        ...state,
        visual: v.badge,
        transition: null,
      });
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
  // body-shape
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
    return Math.min(4, Math.floor(entity.entry.readingMinutes / 8));
  }
  if (entity.kind === 'media') {
    return entity.media.mediaKind === 'video' ? 2.5 : 1;
  }
  if (entity.kind === 'voice') {
    return Math.min(3.5, Math.floor(entity.voice.durationSec / 10));
  }
  return Math.max(0, Math.min(3.5, (entity.body.heightCm - 162) / 10));
}

function formatEntityCardMeta(entity: DemoEntity): string {
  if (entity.kind === 'knowledge') {
    const typeMark =
      entity.entry.contentType === 'article'
        ? 'ART'
        : entity.entry.contentType === 'video'
          ? 'VID'
          : 'PRJ';
    return `${typeMark} · ${entity.entry.readingMinutes} min`;
  }
  if (entity.kind === 'media') {
    return entity.media.mediaKind === 'video'
      ? `VID · ${entity.media.durationSec ?? 0}s · ${entity.media.aspectRatio}`
      : `IMG · ${entity.media.resolutionLabel}`;
  }
  if (entity.kind === 'voice') {
    return `${entity.voice.pitchHz} Hz · ${entity.voice.durationSec}s`;
  }
  return `${entity.body.posture} · ${entity.body.heightCm} cm`;
}

export function createDemoVisualResolver(
  config: DemoRenderConfig,
  theme: SimplexTheme = 'dark',
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

      if (config.contentRenderer === 'domain' && item.kind !== 'knowledge') {
        const s = config.domainGlyphScale;
        if (item.kind === 'media') {
          const aspectScale =
            item.media.aspectRatio === '16:9'
              ? { w: 34, h: 20 }
              : item.media.aspectRatio === '4:3'
                ? { w: 30, h: 23 }
                : { w: 24, h: 24 };
          const bonus = config.scaleByReadingTime && item.media.mediaKind === 'video' ? 1.12 : 1.0;
          return {
            kind: 'domain-media',
            theme,
            width: Math.round(aspectScale.w * s * bonus),
            height: Math.round(aspectScale.h * s * bonus),
            aspectRatio: item.media.aspectRatio,
            mediaKind: item.media.mediaKind,
            motif: item.media.motif,
            palette: item.media.palette,
            colorHex: ctx.mixedColorHex,
            showPlayBadge: config.mediaShowVideoBadge,
            showAspectTag: config.mediaShowAspectTag,
          };
        }

        if (item.kind === 'voice') {
          const durBonus = config.scaleByReadingTime
            ? Math.min(8, Math.round(item.voice.durationSec / 6))
            : 0;
          const baseW = (config.voiceShowPitchLabel ? 58 : 42) + durBonus;
          const baseH = config.voiceShowPitchLabel ? 22 : 24;
          return {
            kind: 'domain-voice',
            theme,
            width: Math.round(baseW * s),
            height: Math.round(baseH * s),
            waveform: item.voice.waveform,
            barCount: config.voiceWaveformBars,
            pitchHz: item.voice.pitchHz,
            colorHex: ctx.mixedColorHex,
            showPitchLabel: config.voiceShowPitchLabel,
          };
        }

        // body-shape
        const statureBonus = config.scaleByReadingTime
          ? Math.max(-1.5, Math.min(3.5, (item.body.heightCm - 172) / 6))
          : 0;
        return {
          kind: 'domain-body',
          theme,
          radius: Math.round((17.5 + statureBonus) * s),
          proportions: item.body.proportions,
          heightCm: item.body.heightCm,
          posture: item.body.posture,
          colorHex: ctx.mixedColorHex,
          showCalibrationRing: config.bodyShowCalibrationRing,
          showHeightLabel: config.bodyShowHeightLabel,
        };
      }

      if (config.contentRenderer === 'geometric' || (config.contentRenderer === 'domain' && item.kind === 'knowledge')) {
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

      const snippet = truncateLabel(item.title, config.contentCardMaxChars);
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
          },
        };
      }

      const shortTitle = truncateLabel(cluster.meta.title, config.clusterTitleMaxChars);
      if (config.clusterRenderer === 'badge') {
        const metaLine = config.showClusterMetaLine
          ? cluster.meta.subtitle
          : `${cluster.meta.memberCount} items`;
        return {
          kind: 'badge',
          badge: {
            code: cluster.code,
            title: shortTitle,
            metaLine,
            colorHex: cluster.colorHex,
            theme,
          },
        };
      }

      return {
        kind: 'react-card',
        theme,
        key: `rc:${theme}:${cluster.clusterUid}:${shortTitle}:${cluster.meta.memberCount}:${cluster.meta.subtitle}:${cluster.colorHex}:${config.clusterTitleMaxChars}:${config.showClusterMetaLine ? 1 : 0}`,
        colorHex: cluster.colorHex,
        code: cluster.code,
        title: shortTitle,
        memberCount: cluster.meta.memberCount,
        subtitle: cluster.meta.subtitle,
        maxChars: config.clusterTitleMaxChars,
        showMeta: config.showClusterMetaLine,
      };
    },

    getVisualCacheKey: (visual) => {
      if (visual.kind === 'domain-media') {
        return `dm:${visual.theme}:${visual.width}x${visual.height}:${visual.mediaKind}:${visual.motif}:${visual.palette.join(',')}:${visual.colorHex}:${visual.showPlayBadge ? 1 : 0}:${visual.showAspectTag ? 1 : 0}`;
      }
      if (visual.kind === 'domain-voice') {
        const waveKey = visual.waveform
          .slice(0, visual.barCount)
          .map((w) => w.toFixed(2))
          .join(',');
        return `dv:${visual.theme}:${visual.width}x${visual.height}:${visual.barCount}:${visual.pitchHz}:${visual.colorHex}:${visual.showPitchLabel ? 1 : 0}:${waveKey}`;
      }
      if (visual.kind === 'domain-body') {
        const p = visual.proportions;
        return `db:${visual.theme}:${visual.radius}:${visual.heightCm}:${visual.posture}:${visual.colorHex}:${visual.showCalibrationRing ? 1 : 0}:${visual.showHeightLabel ? 1 : 0}:${p.shoulderW.toFixed(2)}:${p.waistW.toFixed(2)}:${p.hipW.toFixed(2)}:${p.leanDeg}`;
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
        return `ga:${visual.anchor.theme ?? 'dark'}:${visual.anchor.code}:${visual.anchor.memberCount}:${visual.anchor.radius}:${visual.anchor.colorHex}`;
      }
      if (visual.kind === 'badge') {
        return `mb:${visual.badge.theme ?? 'dark'}:${visual.badge.code}:${visual.badge.title}:${visual.badge.metaLine}:${visual.badge.colorHex}`;
      }
      return visual.key;
    },
  };
}

function renderDomainMiniThumbnail(
  entity: DemoEntity,
  accentHex: string,
  isLight: boolean,
  boxX: number,
  boxY: number,
): ReactNode {
  if (entity.kind === 'voice') {
    const bars = entity.voice.waveform.slice(0, 7);
    return (
      <g transform={`translate(${boxX}, ${boxY})`}>
        {bars.map((amp, i) => {
          const h = Math.max(3, amp * 13);
          return (
            <rect
              key={i}
              x={i * 2.8}
              y={7 - h / 2}
              width={1.7}
              height={h}
              rx={0.7}
              fill={accentHex}
              fillOpacity={0.9}
            />
          );
        })}
      </g>
    );
  }

  if (entity.kind === 'body-shape') {
    const p = entity.body.proportions;
    const sw = p.shoulderW * 6;
    const ww = p.waistW * 5.2;
    const hw = p.hipW * 5.8;
    return (
      <g transform={`translate(${boxX + 9}, ${boxY + 7}) rotate(${p.leanDeg * 0.45})`}>
        <circle cx={0} cy={-5.6} r={1.9} fill={accentHex} />
        <polygon
          points={`${-sw},-3 ${sw},-3 ${ww},1.5 ${hw},4 ${-hw},4 ${-ww},1.5`}
          fill={accentHex}
          fillOpacity={0.85}
        />
        <line x1={-hw * 0.5} y1={4} x2={-hw * 0.55} y2={9.5} stroke={accentHex} strokeWidth={1.6} strokeLinecap="round" />
        <line x1={hw * 0.5} y1={4} x2={hw * 0.55} y2={9.5} stroke={accentHex} strokeWidth={1.6} strokeLinecap="round" />
      </g>
    );
  }

  if (entity.kind === 'media') {
    return (
      <g transform={`translate(${boxX}, ${boxY})`}>
        <rect
          x={0}
          y={0.5}
          width={18}
          height={13}
          rx={2.5}
          fill={entity.media.palette[1]}
          stroke={accentHex}
          strokeWidth={1.1}
        />
        <circle cx={5.5} cy={4.8} r={2.2} fill={entity.media.palette[0]} />
        <polygon points="1,12.5 7,7.5 11.5,10.5 14.5,8.2 17,12.5" fill={accentHex} fillOpacity={0.8} />
        {entity.media.mediaKind === 'video' && (
          <polygon points="7.5,4.2 12.2,7 7.5,9.8" fill={isLight ? '#ffffff' : '#f8fafc'} />
        )}
      </g>
    );
  }

  return null;
}

/**
 * Declarative React JSX renderer for content item mini-cards.
 * Automatically renders domain-specific vector thumbnails for Voice waveforms, Body Silhouettes,
 * and Visual Media frames, measured via `getBBox()` by `@simplex-viz/react`.
 */
export function renderDemoContentCard(
  entity: DemoEntity,
  ctx: ContentLayoutContext<DemoEntity, TagTaxonomyInfo, DemoClusterSummary>,
  state: NodeRenderState<DemoContentVisual>,
): ReactNode {
  const cardVisual = state.visual.kind === 'react-card' ? state.visual : null;
  const isLight = cardVisual?.theme === 'light';
  const maxChars = cardVisual?.maxChars ?? 17;
  const showMeta = cardVisual?.showMeta ?? true;
  const snippet = cardVisual?.headline ?? truncateLabel(entity.title, maxChars);
  const metaLine = cardVisual?.metaLine ?? formatEntityCardMeta(entity);
  const hasRichThumb = entity.kind !== 'knowledge';
  const thumbPad = hasRichThumb ? 23 : 17;

  const stroke = state.interaction.isPinned
    ? isLight
      ? '#d97706'
      : '#f59e0b'
    : state.interaction.isHovered
      ? isLight
        ? '#0f172a'
        : '#f8fafc'
      : ctx.mixedColorHex;

  const width = Math.max(
    90,
    Math.round(
      Math.max(snippet.length * 5.2 + thumbPad + 9, showMeta ? metaLine.length * 4.8 + thumbPad + 8 : 0),
    ),
  );
  const height = showMeta ? 31 : 22;
  const halfW = width / 2;
  const halfH = height / 2;

  return (
    <g>
      <rect
        x={-halfW}
        y={-halfH}
        width={width}
        height={height}
        rx={5}
        fill={isLight ? '#ffffff' : '#0d1320'}
        fillOpacity={isLight ? 0.97 : 0.95}
        stroke={stroke}
        strokeWidth={state.interaction.isHovered ? 1.8 : 1.15}
      />
      {hasRichThumb ? (
        renderDomainMiniThumbnail(entity, ctx.mixedColorHex, isLight, -halfW + 4, -7)
      ) : (
        <circle
          cx={-halfW + 10}
          cy={showMeta ? -4 : 0}
          r={3.2}
          fill={ctx.mixedColorHex}
        />
      )}
      <text
        x={-halfW + thumbPad}
        y={showMeta ? -2 : 3}
        fill={isLight ? '#0f172a' : '#f1f5f9'}
        fontSize={8.5}
        fontWeight={600}
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {snippet}
      </text>
      {showMeta && (
        <text
          x={-halfW + (hasRichThumb ? thumbPad : 7)}
          y={10}
          fill={isLight ? '#475569' : '#94a3b8'}
          fontSize={7.3}
          fontFamily="IBM Plex Mono, monospace"
        >
          {metaLine}
        </text>
      )}
    </g>
  );
}

/**
 * Declarative React JSX renderer for rich cluster summary cards across all datasets.
 */
export function renderDemoClusterCard(
  cluster: ClusterDescriptor<DemoEntity, TagTaxonomyInfo, DemoClusterSummary>,
  state: NodeRenderState<DemoClusterVisual>,
): ReactNode {
  const cardVisual = state.visual.kind === 'react-card' ? state.visual : null;
  const isLight = cardVisual?.theme === 'light';
  const maxChars = cardVisual?.maxChars ?? 22;
  const showMeta = cardVisual?.showMeta ?? true;
  const title = cardVisual?.title ?? truncateLabel(cluster.meta.title, maxChars);
  const stroke =
    state.interaction.isHovered || state.interaction.isHighlighted
      ? isLight
        ? '#0f172a'
        : '#f8fafc'
      : cluster.colorHex;

  const metaLine = cluster.meta.subtitle;
  const width = Math.max(
    136,
    Math.round(Math.max(title.length * 6.4 + 48, showMeta ? metaLine.length * 5.5 + 22 : 0)),
  );
  const height = showMeta ? 48 : 30;
  const halfW = width / 2;
  const halfH = height / 2;

  return (
    <g>
      <rect
        x={-halfW}
        y={-halfH}
        width={width}
        height={height}
        rx={7}
        fill={isLight ? '#ffffff' : '#0a0f1a'}
        fillOpacity={isLight ? 0.97 : 0.96}
        stroke={stroke}
        strokeWidth={state.interaction.isHovered ? 2.2 : 1.5}
      />
      <circle cx={-halfW + 13} cy={showMeta ? -8 : 0} r={4.5} fill={cluster.colorHex} />
      <text
        x={-halfW + 23}
        y={showMeta ? -5 : 3.5}
        fill={isLight ? '#0f172a' : cluster.colorHex}
        fontSize={10}
        fontWeight={600}
        fontFamily="IBM Plex Mono, monospace"
      >
        {cluster.code}
      </text>
      <text
        x={-halfW + 44}
        y={showMeta ? -5 : 3.5}
        fill={isLight ? '#0f172a' : '#f8fafc'}
        fontSize={10.5}
        fontWeight={600}
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {title}
      </text>
      {showMeta && (
        <text
          x={-halfW + 9}
          y={13}
          fill={isLight ? '#475569' : '#94a3b8'}
          fontSize={9}
          fontFamily="IBM Plex Mono, monospace"
        >
          {metaLine}
        </text>
      )}
    </g>
  );
}
