import {
  extractSimplexItemLabel,
  resolveClusterBadgeTitle,
  type ClusterDescriptor,
  type ContentLayoutContext,
  type DefaultTaggedItem,
  type VisualResolver,
} from '@simplex-viz/core';
import type { SvgNodeView } from './types.js';
import {
  BadgeClusterSvgView,
  type BadgeClusterVisual,
} from './views/BadgeClusterSvgView.js';
import {
  ClusterAnchorSvgView,
  type ClusterAnchorVisual,
} from './views/ClusterAnchorSvgView.js';
import {
  GeometricShapeSvgView,
  resolveGeometricShapeSpec,
  type GeometricShapeSpec,
  type GeometricShapeSvgViewOptions,
  type GeometricShapeVisual,
} from './views/GeometricShapeSvgView.js';
import {
  MultiSectorGlyphSvgView,
  type MultiSectorGlyphVisual,
} from './views/MultiSectorGlyphSvgView.js';

/**
 * Built-in visual presets for zero-config usage of `@simplex-viz/svg` and `@simplex-viz/react`.
 *
 * - `'geometric'`: OKLab-tinted shapes (`circle` / `diamond` / `star` by simplex rank, or custom `getShape`) + double-ring `ClusterAnchorSvgView`.
 * - `'glyphs'`: Proportional `MultiSectorGlyphSvgView` barycentric donuts + `ClusterAnchorSvgView`.
 * - `'badges'`: OKLab geometric shapes + adaptive `BadgeClusterSvgView` cards auto-measured via `getBBox()`.
 */
export type SimplexVisualPreset = 'geometric' | 'glyphs' | 'badges';

export type SimplexTheme = 'dark' | 'light';

/**
 * Union of built-in content visual descriptors used by presets.
 */
export type DefaultContentPresetVisual = GeometricShapeVisual | MultiSectorGlyphVisual;

/**
 * Union of built-in cluster visual descriptors used by presets.
 */
export type DefaultClusterPresetVisual = ClusterAnchorVisual | BadgeClusterVisual;

/**
 * First-class formatting and code-toggle options for `BadgeClusterSvgView` when using the `'badges'` preset.
 */
export interface PresetBadgeClusterOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /** Whether to render the cluster index prefix (`T1`–`TK`) on primary capsules. Default: `true`. When `false`, the code `<text>` element is omitted and the title is centered. */
  readonly showCode?: boolean;
  /** Optional maximum character length for displayed cluster titles (clean word-aware truncation with `…`). */
  readonly maxTitleChars?: number;
  /** Optional title formatter receiving the raw title plus `{ variant, cluster }` context before `maxTitleChars` truncation. */
  readonly formatTitle?: (
    title: string,
    context: {
      readonly variant: 'primary' | 'intermediate';
      readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
    },
  ) => string;
}

/**
 * Fixed or item-driven content shape selector for `GeometricShapeSvgView` presets (`'geometric'` / `'badges'`).
 */
export type PresetContentShapeOption<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | GeometricShapeSpec
  | ((
      item: TItem,
      ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
    ) => GeometricShapeSpec);

/**
 * Extra customization options for `createPresetVisualResolver()`.
 */
export interface PresetVisualResolverOptions<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly getLabel?: (item: TItem) => string;
  readonly theme?: SimplexTheme;
  /** Optional formatter converting canonical tag IDs into concise human-readable display labels. */
  readonly formatTagLabel?: (tag: string) => string;
  /** Formatting & code-toggle options for `BadgeClusterSvgView` (`preset: 'badges'`). */
  readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  /** Fixed shape or per-item shape resolver overriding topological rank shapes in `GeometricShapeSvgView`. */
  readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
}

/**
 * Safely extracts a human-readable label from an arbitrary domain item for presets and tooltips.
 */
export function extractDefaultItemLabel<TItem>(
  item: TItem,
  fallbackId: string,
  getLabel?: (item: TItem) => string,
): string {
  return extractSimplexItemLabel(item, fallbackId, getLabel);
}

/**
 * Optional view-level styling/configuration hooks forwarded by `createPresetViews()`.
 */
export interface PresetViewsOptions {
  /** Lightweight shape, hover, dimming, and stroke options forwarded to `GeometricShapeSvgView` (`'geometric'` / `'badges'` presets). */
  readonly shapeOptions?: GeometricShapeSvgViewOptions;
}

/**
 * Creates the matching `SvgNodeView` pair for a given built-in preset.
 */
export function createPresetViews(
  preset: SimplexVisualPreset,
  options?: PresetViewsOptions,
): {
  readonly contentView: SvgNodeView<DefaultContentPresetVisual>;
  readonly clusterView: SvgNodeView<DefaultClusterPresetVisual>;
} {
  const contentView = (
    preset === 'glyphs'
      ? new MultiSectorGlyphSvgView()
      : new GeometricShapeSvgView(options?.shapeOptions)
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
 *
 * Accepts either the classic positional signature `(preset, getLabel?, theme?, extraOptions?)`
 * or an options object `(preset, options)`.
 */
export function createPresetVisualResolver<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  preset: SimplexVisualPreset,
  getLabelOrOptions?:
    | ((item: TItem) => string)
    | PresetVisualResolverOptions<TItem, TTagMeta, TClusterMeta>,
  themeArg?: SimplexTheme,
  extraOptions?: Omit<
    PresetVisualResolverOptions<TItem, TTagMeta, TClusterMeta>,
    'getLabel' | 'theme'
  >,
): VisualResolver<
  TItem,
  DefaultContentPresetVisual,
  DefaultClusterPresetVisual,
  TTagMeta,
  TClusterMeta
> {
  const resolvedOpts: PresetVisualResolverOptions<TItem, TTagMeta, TClusterMeta> =
    typeof getLabelOrOptions === 'object' && getLabelOrOptions !== null
      ? getLabelOrOptions
      : {
          getLabel: getLabelOrOptions,
          theme: themeArg,
          ...extraOptions,
        };

  const getLabel = resolvedOpts.getLabel;
  const theme: SimplexTheme = resolvedOpts.theme ?? 'dark';
  const formatTagLabel = resolvedOpts.formatTagLabel;
  const badgeOptions = resolvedOpts.badgeOptions;
  const getShape = resolvedOpts.getShape;

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
          theme,
        };
      }
      if (getShape !== undefined) {
        const rawSpec = typeof getShape === 'function' ? getShape(item, ctx) : getShape;
        const resolvedShape = resolveGeometricShapeSpec(rawSpec);
        return {
          shape: resolvedShape.shape,
          ...(resolvedShape.sides !== undefined ? { sides: resolvedShape.sides } : {}),
          ...(resolvedShape.rotationRad !== undefined
            ? { rotationRad: resolvedShape.rotationRad }
            : {}),
          radius: resolvedShape.radius ?? 9.5,
          fillHex: ctx.mixedColorHex,
          strokeHex: theme === 'light' ? '#ffffff' : '#07090E',
          strokeWidth: 1.4,
          label: extractDefaultItemLabel(item, ctx.id, getLabel),
          theme,
        };
      }
      const rank = ctx.unitClusters.length;
      return {
        shape: rank >= 3 ? 'star' : rank === 2 ? 'diamond' : 'circle',
        radius: 9.5,
        fillHex: ctx.mixedColorHex,
        strokeHex: theme === 'light' ? '#ffffff' : '#07090E',
        strokeWidth: 1.4,
        label: extractDefaultItemLabel(item, ctx.id, getLabel),
        theme,
      };
    },
    resolveClusterVisual: (
      cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
    ): DefaultClusterPresetVisual => {
      const isIntermediate = cluster.role === 'intermediate';
      const variant: 'primary' | 'intermediate' = isIntermediate
        ? 'intermediate'
        : 'primary';
      const accentColors = cluster.mixWeights
        ?.slice(0, 2)
        .map((m) => m.colorHex);
      if (preset === 'badges') {
        const count = cluster.members.length;
        const resolvedTitle = resolveClusterBadgeTitle(cluster, {
          formatTagLabel,
          badgeOptions,
        });
        return {
          code: cluster.code,
          title: resolvedTitle,
          metaLine: isIntermediate
            ? ''
            : `${count} ${count === 1 ? 'item' : 'items'}`,
          colorHex: cluster.colorHex,
          theme,
          variant,
          parentContextLabel: isIntermediate ? cluster.parentContextLabel : undefined,
          accentColors,
          ...(badgeOptions?.showCode !== undefined
            ? { showCode: badgeOptions.showCode }
            : {}),
        };
      }
      return {
        code: cluster.code,
        label: cluster.defaultLabel,
        memberCount: cluster.members.length,
        colorHex: cluster.colorHex,
        radius: 22,
        theme,
        variant,
        parentContextLabel: isIntermediate ? cluster.parentContextLabel : undefined,
        accentColors,
      };
    },
    getVisualCacheKey: (
      visual: DefaultContentPresetVisual | DefaultClusterPresetVisual,
    ): string => {
      const t = visual.theme ?? 'dark';
      if ('sectors' in visual) {
        const secKey = visual.sectors.map((s) => `${s.colorHex}:${s.weight.toFixed(2)}`).join('|');
        return `glyph:${t}:${visual.outerRadius}:${visual.centerColorHex}:${secKey}`;
      }
      if ('shape' in visual) {
        return `geom:${t}:${visual.shape}:${visual.sides ?? ''}:${visual.rotationRad !== undefined ? visual.rotationRad.toFixed(3) : ''}:${visual.radius}:${visual.fillHex}`;
      }
      if ('metaLine' in visual) {
        return `badge:${t}:${visual.variant ?? 'primary'}:${visual.showCode ?? true}:${visual.parentContextLabel ?? ''}:${visual.code}:${visual.title}:${visual.metaLine}:${visual.colorHex}`;
      }
      return `anchor:${t}:${visual.variant ?? 'primary'}:${visual.parentContextLabel ?? ''}:${visual.code}:${visual.memberCount}:${visual.colorHex}`;
    },
  };
}
