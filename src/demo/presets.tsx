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
  type GeometricShapeKind,
  type GeometricShapeVisual,
  type MultiSectorGlyphVisual,
  type SimplexTheme,
  type SvgNodeView,
} from '@simplex-viz/svg';
import type { ReactNode } from 'react';
import type {
  KnowledgeEntry,
  TagTaxonomyInfo,
  TopicClusterSummary,
} from './data/knowledgeCatalog';

export type ContentRendererKind = 'geometric' | 'multisector' | 'react-card';
export type ClusterRendererKind = 'anchor' | 'badge' | 'react-card';
export type ContentShapeMode = 'by-type' | GeometricShapeKind;

export interface DemoRenderConfig {
  readonly contentRenderer: ContentRendererKind;
  readonly clusterRenderer: ClusterRendererKind;
  readonly contentShapeMode: ContentShapeMode;
  readonly contentBaseRadius: number;
  readonly contentStrokeWidth: number;
  readonly scaleByReadingTime: boolean;
  readonly donutInnerRatio: number;
  readonly donutAccentRing: boolean;
  readonly contentCardMaxChars: number;
  readonly showContentCardMeta: boolean;
  readonly anchorRadius: number;
  readonly clusterTitleMaxChars: number;
  readonly showClusterMetaLine: boolean;
}

export const DEFAULT_DEMO_RENDER_CONFIG: DemoRenderConfig = {
  contentRenderer: 'geometric',
  clusterRenderer: 'badge',
  contentShapeMode: 'by-type',
  contentBaseRadius: 9,
  contentStrokeWidth: 1.4,
  scaleByReadingTime: true,
  donutInnerRatio: 0.44,
  donutAccentRing: false,
  contentCardMaxChars: 17,
  showContentCardMeta: true,
  anchorRadius: 23,
  clusterTitleMaxChars: 22,
  showClusterMetaLine: true,
};

/**
 * Unified discriminated union for independent content visuals across SVG and React JSX renderers,
 * preserving complete type safety without any `any` or `as unknown` casts.
 */
export type DemoContentVisual =
  | { readonly kind: 'geometric'; readonly shape: GeometricShapeVisual }
  | { readonly kind: 'multisector'; readonly glyph: MultiSectorGlyphVisual }
  | {
      readonly kind: 'react-card';
      readonly theme: SimplexTheme;
      readonly key: string;
      readonly colorHex: string;
      readonly headline: string;
      readonly minutes: number;
      readonly contentType: KnowledgeEntry['contentType'];
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
      readonly avgMinutes: number;
      readonly dominantType: KnowledgeEntry['contentType'];
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

function truncateLabel(text: string, maxChars: number): string {
  const limit = Math.max(6, maxChars);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function createDemoVisualResolver(
  config: DemoRenderConfig,
  theme: SimplexTheme = 'dark',
): VisualResolver<
  KnowledgeEntry,
  DemoContentVisual,
  DemoClusterVisual,
  TagTaxonomyInfo,
  TopicClusterSummary
> {
  return {
    resolveContentVisual: (item, ctx) => {
      const readingBonus = config.scaleByReadingTime
        ? Math.min(4, Math.floor(item.readingMinutes / 8))
        : 0;

      if (config.contentRenderer === 'geometric') {
        const shape: GeometricShapeKind =
          config.contentShapeMode === 'by-type'
            ? item.contentType === 'article'
              ? 'circle'
              : item.contentType === 'video'
                ? 'diamond'
                : 'star'
            : config.contentShapeMode;

        return {
          kind: 'geometric',
          shape: {
            shape,
            radius: config.contentBaseRadius + readingBonus,
            fillHex: ctx.mixedColorHex,
            strokeHex: theme === 'light' ? '#FFFFFF' : '#07090E',
            strokeWidth: config.contentStrokeWidth,
            theme,
          },
        };
      }

      if (config.contentRenderer === 'multisector') {
        const outerRadius = config.contentBaseRadius + 2 + readingBonus * 0.75;
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

      const snippet = truncateLabel(item.headline, config.contentCardMaxChars);
      return {
        kind: 'react-card',
        theme,
        key: `card:${theme}:${item.slug}:${ctx.mixedColorHex}:${item.readingMinutes}:${config.contentCardMaxChars}:${config.showContentCardMeta ? 1 : 0}`,
        colorHex: ctx.mixedColorHex,
        headline: snippet,
        minutes: item.readingMinutes,
        contentType: item.contentType,
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
          ? `${cluster.meta.memberCount} items · ${cluster.coreTags.length} tags · avg ${cluster.meta.avgReadingMinutes.toFixed(0)}m`
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
        key: `rc:${theme}:${cluster.clusterUid}:${shortTitle}:${cluster.meta.memberCount}:${cluster.meta.dominantType}:${cluster.colorHex}:${config.clusterTitleMaxChars}:${config.showClusterMetaLine ? 1 : 0}`,
        colorHex: cluster.colorHex,
        code: cluster.code,
        title: shortTitle,
        memberCount: cluster.meta.memberCount,
        avgMinutes: cluster.meta.avgReadingMinutes,
        dominantType: cluster.meta.dominantType,
        maxChars: config.clusterTitleMaxChars,
        showMeta: config.showClusterMetaLine,
      };
    },

    getVisualCacheKey: (visual) => {
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

/**
 * Declarative React JSX renderer for content item mini-cards.
 * Automatically measured via `getBBox()` by `@simplex-viz/react`.
 */
export function renderDemoContentCard(
  entry: KnowledgeEntry,
  ctx: ContentLayoutContext<KnowledgeEntry, TagTaxonomyInfo, TopicClusterSummary>,
  state: NodeRenderState<DemoContentVisual>,
): ReactNode {
  const cardVisual = state.visual.kind === 'react-card' ? state.visual : null;
  const isLight = cardVisual?.theme === 'light';
  const maxChars = cardVisual?.maxChars ?? 17;
  const showMeta = cardVisual?.showMeta ?? true;
  const snippet = cardVisual?.headline ?? truncateLabel(entry.headline, maxChars);
  const typeMark =
    entry.contentType === 'article' ? 'ART' : entry.contentType === 'video' ? 'VID' : 'PRJ';
  const stroke = state.interaction.isPinned
    ? isLight
      ? '#d97706'
      : '#f59e0b'
    : state.interaction.isHovered
      ? isLight
        ? '#0f172a'
        : '#f8fafc'
      : ctx.mixedColorHex;

  const width = Math.max(82, Math.round(Math.max(snippet.length, showMeta ? 13 : 8) * 5.2 + 24));
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
        rx={5}
        fill={isLight ? '#ffffff' : '#0d1320'}
        fillOpacity={isLight ? 0.97 : 0.95}
        stroke={stroke}
        strokeWidth={state.interaction.isHovered ? 1.8 : 1.15}
      />
      <circle
        cx={-halfW + 10}
        cy={showMeta ? -4 : 0}
        r={3.2}
        fill={ctx.mixedColorHex}
      />
      <text
        x={-halfW + 17}
        y={showMeta ? -1 : 3}
        fill={isLight ? '#0f172a' : '#f1f5f9'}
        fontSize={8.5}
        fontWeight={600}
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {snippet}
      </text>
      {showMeta && (
        <text
          x={-halfW + 7}
          y={10}
          fill={isLight ? '#475569' : '#94a3b8'}
          fontSize={7.5}
          fontFamily="IBM Plex Mono, monospace"
        >
          {`${typeMark} · ${entry.readingMinutes} min`}
        </text>
      )}
    </g>
  );
}

/**
 * Declarative React JSX renderer for rich cluster summary cards.
 * Directly accesses `cluster.meta.title`, `cluster.meta.dominantType`, and `cluster.meta.avgReadingMinutes`
 * without any type casts.
 */
export function renderDemoClusterCard(
  cluster: ClusterDescriptor<KnowledgeEntry, TagTaxonomyInfo, TopicClusterSummary>,
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

  const metaLine = `${cluster.meta.memberCount} items · avg ${cluster.meta.avgReadingMinutes.toFixed(0)}m · ${cluster.meta.dominantType}`;
  const width = Math.max(
    132,
    Math.round(Math.max(title.length * 6.4 + 48, showMeta ? metaLine.length * 5.6 + 22 : 0)),
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
