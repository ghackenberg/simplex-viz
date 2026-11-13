import type {
  ClusterDescriptor,
  ContentLayoutContext,
  NodeRenderState,
  VisualResolver,
} from '@simplex-viz/core';
import {
  BadgeClusterSvgView,
  ClusterAnchorSvgView,
  GeometricShapeSvgView,
  MultiSectorGlyphSvgView,
  type BadgeClusterVisual,
  type ClusterAnchorVisual,
  type GeometricShapeVisual,
  type MultiSectorGlyphVisual,
  type SvgNodeView,
} from '@simplex-viz/svg';
import type { ReactNode } from 'react';
import type {
  KnowledgeEntry,
  TagTaxonomyInfo,
  TopicClusterSummary,
} from './data/knowledgeCatalog';

export type PresetId = 'geometric' | 'multisector' | 'react-cards';

/**
 * Unified discriminated union for content visuals across all three live-switchable presets,
 * preserving complete type safety without any `any` or `as unknown` casts.
 */
export type DemoContentVisual =
  | { readonly preset: 'geometric'; readonly shape: GeometricShapeVisual }
  | { readonly preset: 'multisector'; readonly glyph: MultiSectorGlyphVisual }
  | {
      readonly preset: 'react-cards';
      readonly key: string;
      readonly colorHex: string;
      readonly headline: string;
      readonly minutes: number;
      readonly contentType: KnowledgeEntry['contentType'];
    };

/**
 * Unified discriminated union for cluster visuals across all three presets.
 */
export type DemoClusterVisual =
  | { readonly preset: 'geometric'; readonly anchor: ClusterAnchorVisual }
  | { readonly preset: 'multisector'; readonly badge: BadgeClusterVisual }
  | {
      readonly preset: 'react-cards';
      readonly key: string;
      readonly colorHex: string;
      readonly code: string;
      readonly title: string;
      readonly memberCount: number;
      readonly avgMinutes: number;
      readonly dominantType: KnowledgeEntry['contentType'];
    };

const geomBase = new GeometricShapeSvgView();
const sectorBase = new MultiSectorGlyphSvgView();
const anchorBase = new ClusterAnchorSvgView();
const badgeBase = new BadgeClusterSvgView();

export const demoGeometricContentView: SvgNodeView<DemoContentVisual> = {
  measureConvexHull: (v) =>
    v.preset === 'geometric'
      ? geomBase.measureConvexHull(v.shape)
      : { kind: 'circle', radius: 10 },
  mountOrUpdate: (g, v, state) => {
    if (v.preset === 'geometric') {
      geomBase.mountOrUpdate(g, v.shape, {
        ...state,
        visual: v.shape,
        transition: null,
      });
    }
  },
  morph: (g, from, to, progress, state) => {
    if (from.preset === 'geometric' && to.preset === 'geometric') {
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
    v.preset === 'multisector'
      ? sectorBase.measureConvexHull(v.glyph)
      : { kind: 'circle', radius: 12 },
  mountOrUpdate: (g, v, state) => {
    if (v.preset === 'multisector') {
      sectorBase.mountOrUpdate(g, v.glyph, {
        ...state,
        visual: v.glyph,
        transition: null,
      });
    }
  },
};

export const demoAnchorClusterView: SvgNodeView<DemoClusterVisual> = {
  measureConvexHull: (v) =>
    v.preset === 'geometric'
      ? anchorBase.measureConvexHull(v.anchor)
      : { kind: 'circle', radius: 24 },
  mountOrUpdate: (g, v, state) => {
    if (v.preset === 'geometric') {
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
    if (v.preset === 'multisector') {
      badgeBase.mountOrUpdate(g, v.badge, {
        ...state,
        visual: v.badge,
        transition: null,
      });
    }
  },
};

export function createDemoVisualResolver(
  preset: PresetId,
): VisualResolver<
  KnowledgeEntry,
  DemoContentVisual,
  DemoClusterVisual,
  TagTaxonomyInfo,
  TopicClusterSummary
> {
  return {
    resolveContentVisual: (item, ctx) => {
      if (preset === 'geometric') {
        const shape =
          item.contentType === 'article'
            ? 'circle'
            : item.contentType === 'video'
              ? 'diamond'
              : 'star';
        return {
          preset: 'geometric',
          shape: {
            shape,
            radius: 9 + Math.min(4, Math.floor(item.readingMinutes / 8)),
            fillHex: ctx.mixedColorHex,
            strokeHex: '#07090E',
            strokeWidth: 1.4,
          },
        };
      }
      if (preset === 'multisector') {
        return {
          preset: 'multisector',
          glyph: {
            outerRadius: 11 + Math.min(3, Math.floor(item.readingMinutes / 9)),
            innerRadius: 4.8,
            sectors: ctx.unitClusters.map((uc) => ({
              colorHex: uc.cluster.colorHex,
              weight: uc.weight,
            })),
            centerColorHex: ctx.mixedColorHex,
          },
        };
      }
      const snippet =
        item.headline.length > 18 ? `${item.headline.slice(0, 17)}…` : item.headline;
      return {
        preset: 'react-cards',
        key: `card:${item.slug}:${ctx.mixedColorHex}:${item.readingMinutes}`,
        colorHex: ctx.mixedColorHex,
        headline: snippet,
        minutes: item.readingMinutes,
        contentType: item.contentType,
      };
    },

    resolveClusterVisual: (cluster) => {
      if (preset === 'geometric') {
        return {
          preset: 'geometric',
          anchor: {
            code: cluster.code,
            label: cluster.meta.title,
            memberCount: cluster.meta.memberCount,
            colorHex: cluster.colorHex,
            radius: 23,
          },
        };
      }
      if (preset === 'multisector') {
        const shortTitle =
          cluster.meta.title.length > 22
            ? `${cluster.meta.title.slice(0, 21)}…`
            : cluster.meta.title;
        return {
          preset: 'multisector',
          badge: {
            code: cluster.code,
            title: shortTitle,
            metaLine: `${cluster.meta.memberCount} items · ${cluster.coreTags.length} tags · avg ${cluster.meta.avgReadingMinutes.toFixed(0)}m`,
            colorHex: cluster.colorHex,
          },
        };
      }
      const shortTitle =
        cluster.meta.title.length > 22
          ? `${cluster.meta.title.slice(0, 21)}…`
          : cluster.meta.title;
      return {
        preset: 'react-cards',
        key: `rc:${cluster.clusterUid}:${shortTitle}:${cluster.meta.memberCount}:${cluster.meta.dominantType}`,
        colorHex: cluster.colorHex,
        code: cluster.code,
        title: shortTitle,
        memberCount: cluster.meta.memberCount,
        avgMinutes: cluster.meta.avgReadingMinutes,
        dominantType: cluster.meta.dominantType,
      };
    },

    getVisualCacheKey: (visual) => {
      if (visual.preset === 'geometric') {
        if ('shape' in visual) {
          return `g:${visual.shape.shape}:${visual.shape.radius}:${visual.shape.fillHex}`;
        }
        return `ga:${visual.anchor.code}:${visual.anchor.memberCount}:${visual.anchor.colorHex}`;
      }
      if (visual.preset === 'multisector') {
        if ('glyph' in visual) {
          const secKey = visual.glyph.sectors
            .map((s) => `${s.colorHex}:${s.weight.toFixed(2)}`)
            .join('|');
          return `m:${visual.glyph.outerRadius}:${secKey}`;
        }
        return `mb:${visual.badge.code}:${visual.badge.title}:${visual.badge.metaLine}:${visual.badge.colorHex}`;
      }
      return visual.key;
    },
  };
}

/**
 * Declarative React JSX renderer for content item mini-cards (Preset C).
 * Automatically measured via `getBBox()` by `@simplex-viz/react`.
 */
export function renderDemoContentCard(
  entry: KnowledgeEntry,
  ctx: ContentLayoutContext<KnowledgeEntry, TagTaxonomyInfo, TopicClusterSummary>,
  state: NodeRenderState<DemoContentVisual>,
): ReactNode {
  const snippet =
    entry.headline.length > 17 ? `${entry.headline.slice(0, 16)}…` : entry.headline;
  const typeMark =
    entry.contentType === 'article' ? 'ART' : entry.contentType === 'video' ? 'VID' : 'PRJ';
  const stroke = state.interaction.isPinned
    ? '#f59e0b'
    : state.interaction.isHovered
      ? '#f8fafc'
      : ctx.mixedColorHex;

  return (
    <g>
      <rect
        x={-52}
        y={-15}
        width={104}
        height={30}
        rx={5}
        fill="#0d1320"
        fillOpacity={0.95}
        stroke={stroke}
        strokeWidth={state.interaction.isHovered ? 1.8 : 1.1}
      />
      <circle cx={-42} cy={-4} r={3.2} fill={ctx.mixedColorHex} />
      <text
        x={-35}
        y={-1}
        fill="#f1f5f9"
        fontSize={8.5}
        fontWeight={600}
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {snippet}
      </text>
      <text
        x={-45}
        y={10}
        fill="#94a3b8"
        fontSize={7.5}
        fontFamily="IBM Plex Mono, monospace"
      >
        {`${typeMark} · ${entry.readingMinutes} min`}
      </text>
    </g>
  );
}

/**
 * Declarative React JSX renderer for rich cluster summary cards (Preset C).
 * Directly accesses `cluster.meta.title`, `cluster.meta.dominantType`, and `cluster.meta.avgReadingMinutes`
 * without any type casts.
 */
export function renderDemoClusterCard(
  cluster: ClusterDescriptor<KnowledgeEntry, TagTaxonomyInfo, TopicClusterSummary>,
  state: NodeRenderState<DemoClusterVisual>,
): ReactNode {
  const title =
    cluster.meta.title.length > 22
      ? `${cluster.meta.title.slice(0, 21)}…`
      : cluster.meta.title;
  const stroke =
    state.interaction.isHovered || state.interaction.isHighlighted
      ? '#f8fafc'
      : cluster.colorHex;

  return (
    <g>
      <rect
        x={-84}
        y={-24}
        width={168}
        height={48}
        rx={7}
        fill="#0a0f1a"
        fillOpacity={0.96}
        stroke={stroke}
        strokeWidth={state.interaction.isHovered ? 2.2 : 1.5}
      />
      <circle cx={-71} cy={-8} r={4.5} fill={cluster.colorHex} />
      <text
        x={-61}
        y={-5}
        fill={cluster.colorHex}
        fontSize={10}
        fontWeight={600}
        fontFamily="IBM Plex Mono, monospace"
      >
        {cluster.code}
      </text>
      <text
        x={-40}
        y={-5}
        fill="#f8fafc"
        fontSize={10.5}
        fontWeight={600}
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {title}
      </text>
      <text
        x={-75}
        y={13}
        fill="#94a3b8"
        fontSize={9}
        fontFamily="IBM Plex Mono, monospace"
      >
        {`${cluster.meta.memberCount} items · avg ${cluster.meta.avgReadingMinutes.toFixed(0)}m · ${cluster.meta.dominantType}`}
      </text>
    </g>
  );
}
