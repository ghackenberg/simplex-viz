import type {
  ClusterDescriptor,
  ContentLayoutContext,
  DefaultTaggedItem,
  VisualResolver,
} from '@simplex-viz/core';
import type { SvgNodeView } from './types';
import {
  BadgeClusterSvgView,
  type BadgeClusterVisual,
} from './views/BadgeClusterSvgView';
import {
  ClusterAnchorSvgView,
  type ClusterAnchorVisual,
} from './views/ClusterAnchorSvgView';
import {
  GeometricShapeSvgView,
  type GeometricShapeVisual,
} from './views/GeometricShapeSvgView';
import {
  MultiSectorGlyphSvgView,
  type MultiSectorGlyphVisual,
} from './views/MultiSectorGlyphSvgView';

/**
 * Built-in visual presets for zero-config usage of `@simplex-viz/svg` and `@simplex-viz/react`.
 *
 * - `'geometric'`: OKLab-tinted shapes (`circle` / `diamond` / `star` by simplex rank) + double-ring `ClusterAnchorSvgView`.
 * - `'glyphs'`: Proportional `MultiSectorGlyphSvgView` barycentric donuts + `ClusterAnchorSvgView`.
 * - `'badges'`: OKLab geometric shapes + adaptive `BadgeClusterSvgView` cards auto-measured via `getBBox()`.
 */
export type SimplexVisualPreset = 'geometric' | 'glyphs' | 'badges';

/**
 * Union of built-in content visual descriptors used by presets.
 */
export type DefaultContentPresetVisual = GeometricShapeVisual | MultiSectorGlyphVisual;

/**
 * Union of built-in cluster visual descriptors used by presets.
 */
export type DefaultClusterPresetVisual = ClusterAnchorVisual | BadgeClusterVisual;

/**
 * Safely extracts a human-readable label from an arbitrary domain item for presets and tooltips.
 */
export function extractDefaultItemLabel<TItem>(
  item: TItem,
  fallbackId: string,
  getLabel?: (item: TItem) => string,
): string {
  if (getLabel) {
    const custom = getLabel(item);
    if (custom.length > 0) return custom;
  }
  if (typeof item === 'object' && item !== null) {
    if ('label' in item && typeof item.label === 'string' && item.label.length > 0) {
      return item.label;
    }
    if ('title' in item && typeof item.title === 'string' && item.title.length > 0) {
      return item.title;
    }
    if ('headline' in item && typeof item.headline === 'string' && item.headline.length > 0) {
      return item.headline;
    }
    if ('name' in item && typeof item.name === 'string' && item.name.length > 0) {
      return item.name;
    }
  }
  return fallbackId;
}

/**
 * Creates the matching `SvgNodeView` pair for a given built-in preset.
 */
export function createPresetViews(preset: SimplexVisualPreset): {
  readonly contentView: SvgNodeView<DefaultContentPresetVisual>;
  readonly clusterView: SvgNodeView<DefaultClusterPresetVisual>;
} {
  const contentView = (
    preset === 'glyphs'
      ? new MultiSectorGlyphSvgView()
      : new GeometricShapeSvgView()
  ) as unknown as SvgNodeView<DefaultContentPresetVisual>;

  const clusterView = (
    preset === 'badges'
      ? new BadgeClusterSvgView()
      : new ClusterAnchorSvgView()
  ) as unknown as SvgNodeView<DefaultClusterPresetVisual>;

  return { contentView, clusterView };
}

/**
 * Creates a default `VisualResolver` matching the selected built-in preset.
 */
export function createPresetVisualResolver<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  preset: SimplexVisualPreset,
  getLabel?: (item: TItem) => string,
): VisualResolver<
  TItem,
  DefaultContentPresetVisual,
  DefaultClusterPresetVisual,
  TTagMeta,
  TClusterMeta
> {
  return {
    resolveContentVisual: (
      item: TItem,
      ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
    ): DefaultContentPresetVisual => {
      if (preset === 'glyphs') {
        return {
          outerRadius: 11.5,
          innerRadius: 4.5,
          sectors: ctx.unitClusters.map((uc) => ({
            colorHex: uc.cluster.colorHex,
            weight: uc.weight,
          })),
          centerColorHex: ctx.mixedColorHex,
        };
      }
      const rank = ctx.unitClusters.length;
      return {
        shape: rank >= 3 ? 'star' : rank === 2 ? 'diamond' : 'circle',
        radius: 9.5,
        fillHex: ctx.mixedColorHex,
        strokeHex: '#07090E',
        strokeWidth: 1.4,
        label: extractDefaultItemLabel(item, ctx.id, getLabel),
      };
    },
    resolveClusterVisual: (
      cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
    ): DefaultClusterPresetVisual => {
      if (preset === 'badges') {
        const count = cluster.members.length;
        return {
          code: cluster.code,
          title: cluster.defaultLabel,
          metaLine: `${count} ${count === 1 ? 'item' : 'items'}`,
          colorHex: cluster.colorHex,
        };
      }
      return {
        code: cluster.code,
        label: cluster.defaultLabel,
        memberCount: cluster.members.length,
        colorHex: cluster.colorHex,
        radius: 22,
      };
    },
    getVisualCacheKey: (
      visual: DefaultContentPresetVisual | DefaultClusterPresetVisual,
    ): string => {
      if ('sectors' in visual) {
        const secKey = visual.sectors.map((s) => `${s.colorHex}:${s.weight.toFixed(2)}`).join('|');
        return `glyph:${visual.outerRadius}:${visual.centerColorHex}:${secKey}`;
      }
      if ('shape' in visual) {
        return `geom:${visual.shape}:${visual.radius}:${visual.fillHex}`;
      }
      if ('metaLine' in visual) {
        return `badge:${visual.code}:${visual.title}:${visual.metaLine}:${visual.colorHex}`;
      }
      return `anchor:${visual.code}:${visual.memberCount}:${visual.colorHex}`;
    },
  };
}
