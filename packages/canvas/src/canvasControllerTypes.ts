import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterHoverEvent,
  ClusterMetaConfig,
  ContentHoverEvent,
  DefaultTaggedItem,
  EmptyClusterBehavior,
  InteractionHandlers,
  ItemFilterMode,
  ItemFilterPredicate,
  LayoutMetrics,
  LayoutSolverOptions,
  MeshOptions,
  ReducedMotionPreference,
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexHoverTarget,
  SimplexLayoutStrategy,
  SimplexLegendModel,
  SimplexMeshStrategy,
  SimplexTimelinePlayerOptions,
  SimplexZoomState,
  SimplexZoomStrategy,
  StrategyItemIdentityConfig,
  TriangleHoverEvent,
  VisualResolver,
} from '@simplex-viz/core';
import type { DeferInitialLayoutOptions } from '@simplex-viz/core/dom';
import type {
  CanvasBadgeOptions,
  CanvasContentShapeOption,
  CanvasDefaultClusterVisual,
  CanvasDefaultContentVisual,
  CanvasEdgeRenderer,
  CanvasNodeRenderer,
  CanvasShapeOptions,
  CanvasTheme,
  CanvasTriangleRenderer,
  CanvasVisualPreset,
} from './types.js';

export type { DeferInitialLayoutOptions };

export type CanvasTimelineConfig<TItem = DefaultTaggedItem> =
  SimplexTimelinePlayerOptions<TItem>;

export type SimplexCanvasTooltipTarget<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = SimplexHoverTarget<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
>;

export type CanvasTooltipFormatter<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = (
  target: SimplexCanvasTooltipTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
) => string | null | undefined | false;

export type CanvasDomTooltipRenderResult = void | boolean | null | (() => void);

/**
 * Custom DOM/HTML tooltip renderer reusing `SimplexCanvasController`'s built-in
 * floating overlay host, pointer-following, edge-flipping, and hover lifecycle.
 */
export interface CanvasDomTooltipRenderer<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly render: (
    target: SimplexCanvasTooltipTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    containerEl: HTMLDivElement,
  ) => CanvasDomTooltipRenderResult;
  readonly unstyled?: boolean;
  readonly offset?: { readonly x?: number; readonly y?: number };
  readonly margin?: number;
  readonly className?: string;
  readonly onHide?: (containerEl: HTMLDivElement) => void;
}

export interface CanvasStructuredTooltipOption<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly formatContent?: (
    event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
  ) => string | null | undefined | false;
  readonly formatCluster?: (
    event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
  ) => string | null | undefined | false;
  readonly formatTriangle?: (
    event: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta>,
  ) => string | null | undefined | false;
}

export type CanvasTooltipOption<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | boolean
  | CanvasTooltipFormatter<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >
  | CanvasStructuredTooltipOption<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >
  | CanvasDomTooltipRenderer<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;

export interface SimplexCanvasControllerResolvedOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items: readonly TItem[];
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly getLabel?: (item: TItem) => string;
  readonly normalizeTag?: (rawTag: string) => string;
  readonly formatTagLabel?: (tag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;

  /** Built-in visual preset (`'geometric'` | `'glyphs'` | `'badges'`). Default: `'badges'`. */
  readonly preset?: CanvasVisualPreset;
  /** Theme (`'dark'` | `'light'`). Default: `'dark'`. */
  readonly theme?: CanvasTheme;
  /** Explicit canvas background fill (`'transparent'` for alpha canvas). */
  readonly backgroundColor?: string;
  /** Maximum devicePixelRatio cap (default `2`). */
  readonly maxDevicePixelRatio?: number;
  /** Screen-space radius threshold (CSS px) below which shapes simplify for 60 FPS LOD. Default: `3.5`. */
  readonly lodThresholdPx?: number;
  /** World-space viewport culling margin (px). Default: `48`. */
  readonly cullMarginPx?: number;

  readonly badgeOptions?: CanvasBadgeOptions<TItem, TTagMeta, TClusterMeta>;
  readonly getShape?: CanvasContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  readonly shapeOptions?: CanvasShapeOptions;

  readonly visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly contentRenderer?: CanvasNodeRenderer<TContentVisual>;
  readonly clusterRenderer?: CanvasNodeRenderer<TClusterVisual>;
  readonly triangleRenderer?: CanvasTriangleRenderer<TItem, TTagMeta, TClusterMeta>;
  readonly edgeRenderer?: CanvasEdgeRenderer<TItem, TTagMeta, TClusterMeta>;

  readonly width?: number;
  readonly height?: number;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexMeshStrategy<TItem>;
  readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  readonly layoutStrategy?: SimplexLayoutStrategy;
  readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;

  readonly showHulls?: boolean;
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  readonly itemFilter?: ItemFilterPredicate<TItem> | null;
  readonly itemFilterMode?: ItemFilterMode;
  readonly showZoomBreadcrumbs?: boolean;
  readonly focusOnClusterClick?: boolean;
  readonly focusOnTriangleClick?: boolean;
  readonly sizeMultiplier?: number;
  readonly highlightedIds?: Iterable<string> | null;
  readonly selectedIds?: Iterable<string> | null;
  readonly shiftClickSelects?: boolean;
  readonly marqueeSelection?: boolean;
  readonly reducedMotion?: ReducedMotionPreference;
  /**
   * Automatically re-validates text/hull caches and re-solves layout once webfonts
   * finish loading (`document.fonts.ready` and `loadingdone`). Default: `true`.
   */
  readonly relayoutOnFontLoad?: boolean;
  readonly deferInitialLayout?: boolean | DeferInitialLayoutOptions;
  readonly touchScrollLockPx?: number;
  readonly clickTolerancePx?: number;
  readonly keyboardNavigation?: boolean;
  readonly ariaLabel?: string;
  readonly tooltip?: CanvasTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly timeline?: boolean | CanvasTimelineConfig<TItem> | null;

  readonly interactions?: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly onMetricsChange?: (metrics: LayoutMetrics) => void;
  readonly onClustersChange?: (
    clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
  ) => void;
  readonly onZoomStateChange?: (zoomState: SimplexZoomState) => void;
  readonly onSelectionChange?: (selectedIds: ReadonlySet<string>) => void;
  readonly onLegendChange?: (
    legend: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ) => void;
  readonly onFpsUpdate?: (fps: number) => void;
}

export type SimplexCanvasControllerOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = StrategyItemIdentityConfig<TItem, TTagMeta> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> &
  Omit<
    SimplexCanvasControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'getId' | 'getTags' | 'deriveClusterMeta' | 'clusteringStrategy'
  >;

export type SimplexCanvasUpdateOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Partial<
  Omit<
    SimplexCanvasControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'items' | 'visualResolver' | 'getId' | 'getTags' | 'deriveClusterMeta'
  >
> & {
  readonly items?: readonly TItem[];
  readonly visualResolver?:
    | VisualResolver<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >
    | null;
  readonly pinnedIds?: ReadonlySet<string> | readonly string[];
  readonly focusedItemId?: string | null;
  readonly focusedClusterUid?: string | null;
  readonly focusedTriangleIndex?: number | null;
};
