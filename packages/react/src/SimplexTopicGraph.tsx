import {
  createFreeCameraZoomStrategy,
  type ClusterClickEvent,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ClusterMetaConfig,
  type ContentClickEvent,
  type ContentHoverEvent,
  type ContentLayoutContext,
  type DefaultTaggedItem,
  type EmptyClusterBehavior,
  type HitTarget,
  type InteractionHandlers,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type NodeRenderState,
  type NormalizedPointerEvent,
  type SimplexColorStrategy,
  type SimplexLayoutStrategy,
  type SimplexMeshStrategy,
  type SimplexTimelineState,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type StrategyItemIdentityConfig,
  type TriangleClickEvent,
  type TriangleHoverEvent,
  type VisualResolver,
  type WheelBehavior,
} from '@simplex-viz/core';
import {
  SimplexSvgController,
  createPresetViews,
  createPresetVisualResolver,
  extractDefaultItemLabel,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type PresetBadgeClusterOptions,
  type PresetContentShapeOption,
  type SimplexTheme,
  type SimplexVisualPreset,
  type SvgEdgeView,
  type SvgNodeView,
  type SvgTriangleView,
  type TimelinePlayerOptions,
} from '@simplex-viz/svg';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  ReactJsxSvgView,
  type ContentDomainRecord,
} from './ReactJsxSvgView.js';

/**
 * Union payload passed to a custom React `tooltip` formatter on `<SimplexTopicGraph />`.
 */
export type SimplexReactTooltipTarget<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | ({ readonly kind: 'content' } & ContentHoverEvent<
      TItem,
      TContentVisual,
      TTagMeta,
      TClusterMeta
    >)
  | ({ readonly kind: 'cluster' } & ClusterHoverEvent<
      TItem,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >)
  | ({ readonly kind: 'triangle' } & TriangleHoverEvent<
      TItem,
      TTagMeta,
      TClusterMeta
    >);

/**
 * Payload passed to `onContentClick` when an active content node is clicked.
 */
export type SimplexContentClickEvent<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Extract<
  HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
  { readonly kind: 'content' }
>;

/**
 * Payload passed to `onClusterClick` when a topic cluster anchor is clicked.
 */
export type SimplexClusterClickEvent<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Extract<
  HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
  { readonly kind: 'cluster' }
>;

/**
 * Payload passed to `onTriangleClick` when a mesh triangle face is clicked.
 */
export type SimplexTriangleClickEvent<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = Extract<
  HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
  { readonly kind: 'triangle' }
>;

/**
 * Props for `<SimplexTopicGraph />`, preserving end-to-end generic inference across
 * `TItem`, `TContentVisual`, `TClusterVisual`, `TTagMeta`, and `TClusterMeta`.
 *
 * Works zero-config with `<SimplexTopicGraph items={items} />` via built-in presets,
 * or with keyless declarative JSX renderers (`renderContentNode` / `renderClusterNode`),
 * or with full `VisualResolver` + `SvgNodeView` customization.
 */
export type SimplexTopicGraphProps<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = StrategyItemIdentityConfig<TItem, TTagMeta> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> & {
    readonly items: readonly TItem[];
    /** Built-in visual preset used when custom views / `visualResolver` are omitted. Default: `'geometric'`. */
    readonly preset?: SimplexVisualPreset;
    /** Visual color theme (`'dark'` or `'light'`) for built-in presets and tooltips. Default: `'dark'`. */
    readonly theme?: SimplexTheme;
    /** Optional label extractor for built-in presets and default hover tooltips. */
    readonly getLabel?: (item: TItem) => string;
    /**
     * Optional `VisualResolver` mapping items and clusters to pure visual descriptors.
     * Optional in both zero-config preset mode and declarative JSX renderer mode.
     */
    readonly visualResolver?: VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;
    /** Optional cache key override when using `renderContentNode` without `visualResolver`. */
    readonly getContentCacheKey?: (
      item: TItem,
      ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
    ) => string;
    /** Optional cache key override when using `renderClusterNode` without `visualResolver`. */
    readonly getClusterCacheKey?: (
      cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
    ) => string;
    /** Portable `@simplex-viz/svg` view plugin for content items. */
    readonly contentView?: SvgNodeView<TContentVisual>;
    /** Portable `@simplex-viz/svg` view plugin for topic clusters. */
    readonly clusterView?: SvgNodeView<TClusterVisual>;
    /** Pluggable `@simplex-viz/svg` view plugin for triangulation triangle faces. */
    readonly triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
    /** Pluggable `@simplex-viz/svg` view plugin for triangulation mesh edges. */
    readonly edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
    /** Optional declarative React JSX renderer for content items (auto-measured via `getBBox()`). */
    readonly renderContentNode?: (
      item: TItem,
      ctx: ContentLayoutContext<TItem, TTagMeta, TClusterMeta>,
      state: NodeRenderState<TContentVisual>,
    ) => ReactNode;
    /** Optional declarative React JSX renderer for topic clusters (auto-measured via `getBBox()`). */
    readonly renderClusterNode?: (
      cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
      state: NodeRenderState<TClusterVisual>,
    ) => ReactNode;
    readonly normalizeTag?: (rawTag: string) => string;
    /** Optional formatter converting canonical tag IDs into concise human-readable display labels without altering clustering or equality checks. */
    readonly formatTagLabel?: (tag: string) => string;
    readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
    /** Formatting & code-toggle options for `BadgeClusterSvgView` when using `preset="badges"`. */
    readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
    /** Fixed shape or per-item shape resolver overriding topological rank shapes in `GeometricShapeSvgView` (`"geometric"` / `"badges"` presets). */
    readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
    readonly meshOptions?: MeshOptions;
    readonly layoutOptions?: LayoutSolverOptions;
    /** Optional custom mesh/triangulation strategy. */
    readonly meshStrategy?: SimplexMeshStrategy<TItem>;
    /** Optional custom cluster coloring & item color-mixing strategy. */
    readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
    /** Optional custom node positioning & scaling strategy. */
    readonly layoutStrategy?: SimplexLayoutStrategy;
    /** Optional custom zoom / drill-down strategy. Default: free camera. */
    readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
    /** Renders the built-in breadcrumb bar in drill-down mode. Default: `true`. */
    readonly showZoomBreadcrumbs?: boolean;
    /**
     * Opt-in chronological timeline / frame-stepping playback support.
     * Pass `true` for zero-config playback with built-in controls, or a `TimelinePlayerOptions`
     * object to customize timestamps, frame grouping, playback speed, or built-in HUD placement.
     */
    readonly timeline?: boolean | TimelinePlayerOptions<TItem>;
    readonly sizeMultiplier?: number;
    readonly showHulls?: boolean;
    /**
     * Controls how clusters with `0` active member items are rendered (`'normal'`, `'dim'`, or `'hide'`).
     * Especially useful during timeline playback with final-seeded clusters. Default: `'normal'`.
     */
    readonly emptyClusterBehavior?: EmptyClusterBehavior;
    readonly pinnedIds?: ReadonlySet<string> | readonly string[];
    readonly highlightedIds?: ReadonlySet<string> | readonly string[];
    readonly focusedClusterUid?: string | null;
    readonly focusedTriangleIndex?: number | null;
    /**
     * Automatically re-measures SVG hulls and re-solves layout once webfonts finish loading
     * (`document.fonts.ready` and `loadingdone`). Default: `true`.
     */
    readonly relayoutOnFontLoad?: boolean;
    /**
     * Enables built-in cluster focus toggle on click when `focusedClusterUid` is not controlled
     * externally and no click handler consumes the event (`return true`). Default: `true`.
     */
    readonly focusOnClusterClick?: boolean;
    /**
     * Enables built-in triangle face focus toggle on click when `focusedTriangleIndex` is not
     * controlled externally and no click handler consumes the event (`return true`). Default: `true`.
     */
    readonly focusOnTriangleClick?: boolean;
    /**
     * Enables a built-in floating hover tooltip, or accepts a custom `(target) => ReactNode` formatter.
     * Default: `false`.
     */
    readonly tooltip?:
      | boolean
      | ((
          target: SimplexReactTooltipTarget<
            TItem,
            TContentVisual,
            TClusterVisual,
            TTagMeta,
            TClusterMeta
          >,
        ) => ReactNode);
    /** Return `true` to suppress the built-in hover tooltip for this content node. */
    readonly onContentHover?: (
      event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta> | null,
    ) => boolean | void;
    /** Return `true` to suppress the built-in hover tooltip for this cluster node. */
    readonly onClusterHover?: (
      event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta> | null,
    ) => boolean | void;
    /** Return `true` to suppress the built-in hover tooltip for this triangle face. */
    readonly onTriangleHover?: (
      event: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta> | null,
    ) => boolean | void;
    /**
     * Invoked when an active (non-neighbor) content node is clicked, before `onLeftClick`.
     * Return `true` to consume the click and skip `onLeftClick` and built-in defaults.
     */
    readonly onContentClick?: (
      event: ContentClickEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
      rawEvent: NormalizedPointerEvent,
    ) => boolean | void;
    /**
     * Invoked when a topic cluster anchor is clicked, before `onLeftClick`.
     * Return `true` to consume the click and suppress built-in cluster drill-down or focus toggle.
     */
    readonly onClusterClick?: (
      event: ClusterClickEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
      rawEvent: NormalizedPointerEvent,
    ) => boolean | void;
    /**
     * Invoked when a mesh triangle face is clicked, before `onLeftClick`.
     * Return `true` to consume the click and suppress built-in triangle drill-down or focus toggle.
     */
    readonly onTriangleClick?: (
      event: TriangleClickEvent<TItem, TTagMeta, TClusterMeta>,
      rawEvent: NormalizedPointerEvent,
    ) => boolean | void;
    /**
     * Invoked when empty canvas background is clicked, before `onLeftClick`.
     * Return `true` to consume the click (e.g. to dismiss an open inspector card before triggering drill-up).
     */
    readonly onBackgroundClick?: (
      rawEvent: NormalizedPointerEvent,
    ) => boolean | void;
    /**
     * Invoked on any left-click not consumed by a target-specific click handler.
     * Return `true` to consume the click and suppress built-in drill-down / focus toggles;
     * return `void` or `false` to compose with built-in navigation and focus behavior.
     */
    readonly onLeftClick?: (
      target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
      rawEvent: NormalizedPointerEvent,
    ) => boolean | void;
    /**
     * Invoked on right-click (`contextmenu`). Return `true` to suppress the browser's context menu.
     */
    readonly onRightClick?: (
      target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
      rawEvent: NormalizedPointerEvent,
    ) => boolean | void;
    readonly onWheel?: WheelBehavior;
    readonly onMetricsChange?: (metrics: LayoutMetrics) => void;
    readonly onClustersChange?: (
      clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
    ) => void;
    readonly onZoomStateChange?: (state: SimplexZoomState) => void;
    /** Invoked whenever the timeline playback state changes (when `timeline` is enabled). */
    readonly onTimelineStateChange?: (state: SimplexTimelineState<TItem>) => void;
    readonly onFpsUpdate?: (fps: number) => void;
    readonly controllerRef?: MutableRefObject<SimplexSvgController<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    > | null>;
    readonly className?: string;
    readonly style?: CSSProperties;
  };

interface AutoKeyVisual {
  readonly __svAutoKey: string;
}

function isAutoKeyVisual(v: unknown): v is AutoKeyVisual {
  return (
    typeof v === 'object' &&
    v !== null &&
    '__svAutoKey' in v &&
    typeof (v as AutoKeyVisual).__svAutoKey === 'string'
  );
}

/**
 * Type-safe React visualization component wrapping `@simplex-viz/core` and `@simplex-viz/svg`.
 */
export function SimplexTopicGraph<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  props: SimplexTopicGraphProps<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctrlRef = useRef<SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null>(null);

  const [hoveredTarget, setHoveredTarget] = useState<SimplexReactTooltipTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null>(null);

  const internalFocusedUidRef = useRef<string | null>(null);
  const internalFocusedTriangleRef = useRef<number | null>(null);

  const contentDomainByKeyRef = useRef(
    new Map<string, ContentDomainRecord<TItem, TTagMeta, TClusterMeta>>(),
  );
  const clusterDomainByKeyRef = useRef(
    new Map<string, ClusterDescriptor<TItem, TTagMeta, TClusterMeta>>(),
  );
  const jsxContentViewRef = useRef<ReactJsxSvgView<
    TContentVisual,
    ContentDomainRecord<TItem, TTagMeta, TClusterMeta>
  > | null>(null);
  const jsxClusterViewRef = useRef<ReactJsxSvgView<
    TClusterVisual,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
  > | null>(null);

  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;

  const syncedMeshStrategyRef = useRef(props.meshStrategy);
  const syncedClusteringStrategyRef = useRef(props.clusteringStrategy);
  const syncedColorStrategyRef = useRef(props.colorStrategy);
  const syncedLayoutStrategyRef = useRef(props.layoutStrategy);
  const syncedZoomStrategyRef = useRef(props.zoomStrategy);
  const syncedMeshOptionsRef = useRef(props.meshOptions);
  const syncedLayoutOptionsRef = useRef(props.layoutOptions);
  const syncedTriangleViewRef = useRef(props.triangleView);
  const syncedEdgeViewRef = useRef(props.edgeView);
  const syncedTimelineRef = useRef(props.timeline);

  const resolveTimelineOption = (
    timeline: boolean | TimelinePlayerOptions<TItem> | undefined,
  ): boolean | TimelinePlayerOptions<TItem> | undefined => {
    if (!timeline) return undefined;
    const baseOpts: TimelinePlayerOptions<TItem> =
      timeline === true ? {} : timeline;
    const getLatestTimelineOpts = (): TimelinePlayerOptions<TItem> | null => {
      const cur = latestPropsRef.current.timeline;
      return typeof cur === 'object' && cur !== null ? cur : null;
    };
    return {
      ...baseOpts,
      getTimestamp: baseOpts.getTimestamp
        ? (item) => {
            const latest = getLatestTimelineOpts()?.getTimestamp ?? baseOpts.getTimestamp;
            return latest ? latest(item) : undefined;
          }
        : undefined,
      getFrameKey: baseOpts.getFrameKey
        ? (item) => {
            const latest = getLatestTimelineOpts()?.getFrameKey ?? baseOpts.getFrameKey;
            return latest ? latest(item) : undefined;
          }
        : undefined,
      formatFrameLabel: baseOpts.formatFrameLabel
        ? (ctx) => {
            const latest =
              getLatestTimelineOpts()?.formatFrameLabel ?? baseOpts.formatFrameLabel;
            return latest ? latest(ctx) : ctx.key;
          }
        : undefined,
      compareFrameKeys: baseOpts.compareFrameKeys
        ? (a, b) => {
            const latest =
              getLatestTimelineOpts()?.compareFrameKeys ?? baseOpts.compareFrameKeys;
            return latest ? latest(a, b) : 0;
          }
        : undefined,
      onItemsChange: baseOpts.onItemsChange
        ? (items, state) => {
            const latest =
              getLatestTimelineOpts()?.onItemsChange ?? baseOpts.onItemsChange;
            latest?.(items, state);
          }
        : undefined,
      onStateChange: (state) => {
        getLatestTimelineOpts()?.onStateChange?.(state);
        latestPropsRef.current.onTimelineStateChange?.(state);
      },
    };
  };

  const resolveEffectiveResolver = (): VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > => {
    const p = latestPropsRef.current;
    const preset: SimplexVisualPreset = p.preset ?? 'geometric';
    const theme: SimplexTheme = p.theme ?? 'dark';
    const presetResolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
      preset,
      {
        getLabel: (item) => {
          const curGetLabel = latestPropsRef.current.getLabel;
          if (curGetLabel) return curGetLabel(item);
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
          return '';
        },
        theme,
        formatTagLabel: p.formatTagLabel,
        badgeOptions: p.badgeOptions,
        getShape: p.getShape,
      },
    );
    const base = p.visualResolver;

    const getKey = (visual: TContentVisual | TClusterVisual): string => {
      if (isAutoKeyVisual(visual)) {
        return visual.__svAutoKey;
      }
      if (base) {
        return base.getVisualCacheKey(visual);
      }
      return presetResolver.getVisualCacheKey(
        visual as unknown as DefaultContentPresetVisual | DefaultClusterPresetVisual,
      );
    };

    return {
      resolveContentVisual: (item, ctx) => {
        const cur = latestPropsRef.current;
        let visual: TContentVisual;
        if (base) {
          visual = base.resolveContentVisual(item, ctx);
        } else if (cur.renderContentNode) {
          const autoKey = cur.getContentCacheKey
            ? cur.getContentCacheKey(item, ctx)
            : `${ctx.id}:${ctx.mixedColorHex}:${ctx.tags.map((t) => t.tag).join(',')}:${ctx.unitClusters
                .map((u) => `${u.cluster.clusterUid}:${u.weight.toFixed(2)}`)
                .join(',')}`;
          visual = { __svAutoKey: autoKey } as unknown as TContentVisual;
        } else {
          visual = presetResolver.resolveContentVisual(item, ctx) as unknown as TContentVisual;
        }
        const key = getKey(visual);
        contentDomainByKeyRef.current.set(key, { item, ctx });
        return visual;
      },
      resolveClusterVisual: (cluster) => {
        const cur = latestPropsRef.current;
        let visual: TClusterVisual;
        if (base) {
          visual = base.resolveClusterVisual(cluster);
        } else if (cur.renderClusterNode) {
          const autoKey = cur.getClusterCacheKey
            ? cur.getClusterCacheKey(cluster)
            : `${cluster.clusterUid}:${cluster.defaultLabel}:${cluster.members.length}:${cluster.colorHex}`;
          visual = { __svAutoKey: autoKey } as unknown as TClusterVisual;
        } else {
          visual = presetResolver.resolveClusterVisual(cluster) as unknown as TClusterVisual;
        }
        const key = getKey(visual);
        clusterDomainByKeyRef.current.set(key, cluster);
        return visual;
      },
      getVisualCacheKey: getKey,
    };
  };

  const resolveActiveViews = (
    activeResolver: VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): {
    contentView: SvgNodeView<TContentVisual>;
    clusterView: SvgNodeView<TClusterVisual>;
  } => {
    const p = latestPropsRef.current;
    const presetViews = createPresetViews(p.preset ?? 'geometric');

    let contentView: SvgNodeView<TContentVisual>;
    if (p.renderContentNode) {
      const renderFn = p.renderContentNode;
      jsxContentViewRef.current?.dispose();
      const jsxView = new ReactJsxSvgView<
        TContentVisual,
        ContentDomainRecord<TItem, TTagMeta, TClusterMeta>
      >({
        renderFn: (domain, state) => renderFn(domain.item, domain.ctx, state),
        getKey: (v) => activeResolver.getVisualCacheKey(v),
        domainByKey: contentDomainByKeyRef.current,
      });
      jsxContentViewRef.current = jsxView;
      contentView = jsxView;
    } else if (p.contentView) {
      jsxContentViewRef.current?.dispose();
      jsxContentViewRef.current = null;
      contentView = p.contentView;
    } else {
      jsxContentViewRef.current?.dispose();
      jsxContentViewRef.current = null;
      contentView = presetViews.contentView as unknown as SvgNodeView<TContentVisual>;
    }

    let clusterView: SvgNodeView<TClusterVisual>;
    if (p.renderClusterNode) {
      const renderFn = p.renderClusterNode;
      jsxClusterViewRef.current?.dispose();
      const jsxView = new ReactJsxSvgView<
        TClusterVisual,
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
      >({
        renderFn: (cluster, state) => renderFn(cluster, state),
        getKey: (v) => activeResolver.getVisualCacheKey(v),
        domainByKey: clusterDomainByKeyRef.current,
      });
      jsxClusterViewRef.current = jsxView;
      clusterView = jsxView;
    } else if (p.clusterView) {
      jsxClusterViewRef.current?.dispose();
      jsxClusterViewRef.current = null;
      clusterView = p.clusterView;
    } else {
      jsxClusterViewRef.current?.dispose();
      jsxClusterViewRef.current = null;
      clusterView = presetViews.clusterView as unknown as SvgNodeView<TClusterVisual>;
    }

    return { contentView, clusterView };
  };

  const buildReactInteractions = (
    wheelPolicy?: WheelBehavior,
  ): InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > => ({
    onContentHover: (ev) => {
      const consumed = latestPropsRef.current.onContentHover?.(ev);
      if (latestPropsRef.current.tooltip) {
        setHoveredTarget(ev && consumed !== true ? { kind: 'content', ...ev } : null);
      }
      // React renders its own JSX tooltip; suppress SimplexSvgController's built-in DOM tooltip.
      return true;
    },
    onClusterHover: (ev) => {
      const consumed = latestPropsRef.current.onClusterHover?.(ev);
      if (latestPropsRef.current.tooltip) {
        setHoveredTarget(ev && consumed !== true ? { kind: 'cluster', ...ev } : null);
      }
      return true;
    },
    onTriangleHover: (ev) => {
      const consumed = latestPropsRef.current.onTriangleHover?.(ev);
      if (latestPropsRef.current.tooltip) {
        setHoveredTarget(ev && consumed !== true ? { kind: 'triangle', ...ev } : null);
      }
      return true;
    },
    onContentClick: (target, raw) =>
      latestPropsRef.current.onContentClick?.(target, raw),
    onClusterClick: (target, raw) =>
      latestPropsRef.current.onClusterClick?.(target, raw),
    onTriangleClick: (target, raw) =>
      latestPropsRef.current.onTriangleClick?.(target, raw),
    onBackgroundClick: (raw) =>
      latestPropsRef.current.onBackgroundClick?.(raw),
    onLeftClick: (target, raw) => {
      const cur = latestPropsRef.current;
      if (cur.onLeftClick?.(target, raw) === true) {
        return true;
      }
      // In drill-down mode, return false so SimplexSvgController runs built-in drill/neighbor/up defaults.
      if (ctrlRef.current?.getZoomStrategy().mode === 'drill-down') {
        return false;
      }
      // In free-camera mode, handle React-aware controlled/uncontrolled focus toggle and consume
      // so SimplexSvgController does not double-toggle uncontrolled focus state.
      if (
        target.kind === 'cluster' &&
        cur.focusedClusterUid === undefined &&
        (cur.focusOnClusterClick ?? true)
      ) {
        if (
          cur.focusedTriangleIndex === undefined &&
          internalFocusedTriangleRef.current !== null
        ) {
          internalFocusedTriangleRef.current = null;
          ctrlRef.current?.setFocusedTriangleIndex(null);
        }
        const next =
          internalFocusedUidRef.current === target.cluster.clusterUid
            ? null
            : target.cluster.clusterUid;
        internalFocusedUidRef.current = next;
        ctrlRef.current?.setFocusedClusterUid(next);
      } else if (
        target.kind === 'triangle' &&
        cur.focusedTriangleIndex === undefined &&
        (cur.focusOnTriangleClick ?? true)
      ) {
        if (
          cur.focusedClusterUid === undefined &&
          internalFocusedUidRef.current !== null
        ) {
          internalFocusedUidRef.current = null;
          ctrlRef.current?.setFocusedClusterUid(null);
        }
        const next =
          internalFocusedTriangleRef.current === target.triangle.index
            ? null
            : target.triangle.index;
        internalFocusedTriangleRef.current = next;
        ctrlRef.current?.setFocusedTriangleIndex(next);
      } else if (target.kind === 'background') {
        if (
          cur.focusedClusterUid === undefined &&
          internalFocusedUidRef.current !== null
        ) {
          internalFocusedUidRef.current = null;
          ctrlRef.current?.setFocusedClusterUid(null);
        }
        if (
          cur.focusedTriangleIndex === undefined &&
          internalFocusedTriangleRef.current !== null
        ) {
          internalFocusedTriangleRef.current = null;
          ctrlRef.current?.setFocusedTriangleIndex(null);
        }
      }
      return true;
    },
    onRightClick: (t, raw) => latestPropsRef.current.onRightClick?.(t, raw),
    onWheel: wheelPolicy,
  });

  // Mount controller once on container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const p = latestPropsRef.current;
    const effectiveResolver = resolveEffectiveResolver();
    const { contentView, clusterView } = resolveActiveViews(effectiveResolver);

    const ctrl = SimplexSvgController.createFromResolved(el, {
      items: p.items,
      getId: p.getId,
      getTags: p.getTags,
      getLabel: p.getLabel,
      deriveClusterMeta: p.deriveClusterMeta,
      preset: p.preset,
      theme: p.theme,
      visualResolver: effectiveResolver,
      contentView,
      clusterView,
      triangleView: p.triangleView,
      edgeView: p.edgeView,
      normalizeTag: p.normalizeTag,
      formatTagLabel: p.formatTagLabel,
      resolveTagMeta: p.resolveTagMeta,
      badgeOptions: p.badgeOptions,
      getShape: p.getShape,
      meshOptions: p.meshOptions,
      layoutOptions: {
        ...p.layoutOptions,
        sizeMultiplier: p.sizeMultiplier ?? p.layoutOptions?.sizeMultiplier ?? 1,
      },
      meshStrategy: p.meshStrategy,
      clusteringStrategy: p.clusteringStrategy,
      colorStrategy: p.colorStrategy,
      layoutStrategy: p.layoutStrategy,
      zoomStrategy: p.zoomStrategy,
      showHulls: p.showHulls,
      emptyClusterBehavior: p.emptyClusterBehavior,
      showZoomBreadcrumbs: p.showZoomBreadcrumbs,
      timeline: resolveTimelineOption(p.timeline),
      relayoutOnFontLoad: p.relayoutOnFontLoad,
      focusOnClusterClick: false,
      focusOnTriangleClick: false,
      interactions: buildReactInteractions(p.onWheel),
      onMetricsChange: (m) => latestPropsRef.current.onMetricsChange?.(m),
      onClustersChange: (c) => latestPropsRef.current.onClustersChange?.(c),
      onZoomStateChange: (z) => latestPropsRef.current.onZoomStateChange?.(z),
      onFpsUpdate: (fps) => latestPropsRef.current.onFpsUpdate?.(fps),
    });
    ctrlRef.current = ctrl;
    if (p.controllerRef) {
      p.controllerRef.current = ctrl;
    }

    return () => {
      ctrl.destroy();
      ctrlRef.current = null;
      if (latestPropsRef.current.controllerRef) {
        latestPropsRef.current.controllerRef.current = null;
      }
      jsxContentViewRef.current?.dispose();
      jsxClusterViewRef.current?.dispose();
      jsxContentViewRef.current = null;
      jsxClusterViewRef.current = null;
    };
  }, []);

  // Sync items
  useEffect(() => {
    ctrlRef.current?.setItems(props.items);
  }, [props.items]);

  // Sync views, presets, theme & visual resolver (triggers smooth crossfade / morph!)
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    ctrl.setTheme(props.theme ?? 'dark');
    const effectiveResolver = resolveEffectiveResolver();
    const { contentView, clusterView } = resolveActiveViews(effectiveResolver);
    ctrl.setViews({ contentView, clusterView });
    ctrl.setVisualResolver(effectiveResolver);
  }, [
    props.preset,
    props.theme,
    props.visualResolver,
    props.contentView,
    props.clusterView,
    props.renderContentNode,
    props.renderClusterNode,
    props.badgeOptions?.showCode,
    props.badgeOptions?.maxTitleChars,
    props.badgeOptions?.formatTitle,
    props.getShape,
  ]);

  // Sync sizeMultiplier
  useEffect(() => {
    if (props.sizeMultiplier !== undefined) {
      ctrlRef.current?.setSizeMultiplier(props.sizeMultiplier);
    }
  }, [props.sizeMultiplier]);

  // Sync showHulls
  useEffect(() => {
    if (props.showHulls !== undefined) {
      ctrlRef.current?.setShowHulls(props.showHulls);
    }
  }, [props.showHulls]);

  // Sync emptyClusterBehavior
  useEffect(() => {
    if (props.emptyClusterBehavior !== undefined) {
      ctrlRef.current?.setEmptyClusterBehavior(props.emptyClusterBehavior);
    }
  }, [props.emptyClusterBehavior]);

  // Sync pluggable core algorithm strategies when props change after mount
  useEffect(() => {
    if (syncedMeshStrategyRef.current === props.meshStrategy) return;
    syncedMeshStrategyRef.current = props.meshStrategy;
    if (props.meshStrategy) {
      ctrlRef.current?.setMeshStrategy(props.meshStrategy);
    }
  }, [props.meshStrategy]);

  useEffect(() => {
    if (syncedClusteringStrategyRef.current === props.clusteringStrategy) return;
    syncedClusteringStrategyRef.current = props.clusteringStrategy;
    if (props.clusteringStrategy) {
      ctrlRef.current?.setClusteringStrategy(props.clusteringStrategy);
    }
  }, [props.clusteringStrategy]);

  useEffect(() => {
    if (syncedColorStrategyRef.current === props.colorStrategy) return;
    syncedColorStrategyRef.current = props.colorStrategy;
    if (props.colorStrategy) {
      ctrlRef.current?.setColorStrategy(props.colorStrategy);
    }
  }, [props.colorStrategy]);

  useEffect(() => {
    if (syncedLayoutStrategyRef.current === props.layoutStrategy) return;
    syncedLayoutStrategyRef.current = props.layoutStrategy;
    if (props.layoutStrategy) {
      ctrlRef.current?.setLayoutStrategy(props.layoutStrategy);
    }
  }, [props.layoutStrategy]);

  useEffect(() => {
    if (syncedZoomStrategyRef.current === props.zoomStrategy) return;
    syncedZoomStrategyRef.current = props.zoomStrategy;
    ctrlRef.current?.setZoomStrategy(
      props.zoomStrategy ??
        createFreeCameraZoomStrategy<TItem, TTagMeta, TClusterMeta>(),
    );
  }, [props.zoomStrategy]);

  useEffect(() => {
    ctrlRef.current?.setZoomUiOptions({
      showZoomBreadcrumbs: props.showZoomBreadcrumbs,
    });
  }, [props.showZoomBreadcrumbs]);

  // Sync timeline option changes after mount
  useEffect(() => {
    const prev = syncedTimelineRef.current;
    const next = props.timeline;
    if (prev === next) return;
    if (
      typeof prev === 'object' &&
      prev !== null &&
      typeof next === 'object' &&
      next !== null &&
      prev.showControls === next.showControls &&
      prev.position === next.position &&
      prev.autoFinalSeed === next.autoFinalSeed &&
      prev.autoFinalSeedLayout === next.autoFinalSeedLayout &&
      prev.emptyClusterBehavior === next.emptyClusterBehavior &&
      prev.stepIntervalMs === next.stepIntervalMs &&
      prev.speed === next.speed &&
      prev.loop === next.loop &&
      prev.autoPlay === next.autoPlay &&
      prev.initialStep === next.initialStep &&
      prev.includeEmptyStart === next.includeEmptyStart &&
      prev.baselineLabel === next.baselineLabel &&
      prev.emptyStartLabel === next.emptyStartLabel &&
      Boolean(prev.getTimestamp) === Boolean(next.getTimestamp) &&
      Boolean(prev.getFrameKey) === Boolean(next.getFrameKey) &&
      Boolean(prev.formatFrameLabel) === Boolean(next.formatFrameLabel) &&
      Boolean(prev.compareFrameKeys) === Boolean(next.compareFrameKeys)
    ) {
      syncedTimelineRef.current = next;
      return;
    }
    syncedTimelineRef.current = next;
    ctrlRef.current?.setTimelineOptions(resolveTimelineOption(next));
  }, [props.timeline]);

  // Sync wheel policy so `'none'`, `'pan-vertical'`, `'zoom-to-cursor'`, and custom callbacks stay live
  useEffect(() => {
    ctrlRef.current?.setInteractions(buildReactInteractions(props.onWheel));
  }, [props.onWheel]);

  // Sync meshOptions & layoutOptions when values change after mount
  useEffect(() => {
    const prev = syncedMeshOptionsRef.current;
    const next = props.meshOptions;
    if (prev === next) return;
    if (
      prev &&
      next &&
      prev.innerPadding === next.innerPadding &&
      prev.sideLength === next.sideLength &&
      prev.minSideLength === next.minSideLength &&
      prev.maxSideLength === next.maxSideLength &&
      prev.maxClusters === next.maxClusters
    ) {
      syncedMeshOptionsRef.current = next;
      return;
    }
    syncedMeshOptionsRef.current = next;
    ctrlRef.current?.setMeshOptions(next ?? {});
  }, [props.meshOptions]);

  useEffect(() => {
    const prev = syncedLayoutOptionsRef.current;
    const next = props.layoutOptions;
    if (prev === next) return;
    if (
      prev &&
      next &&
      prev.clusterGapPx === next.clusterGapPx &&
      prev.itemGapPx === next.itemGapPx &&
      prev.minContentScale === next.minContentScale &&
      prev.relaxationIterations === next.relaxationIterations &&
      prev.sizeMultiplier === next.sizeMultiplier &&
      prev.seed === next.seed
    ) {
      syncedLayoutOptionsRef.current = next;
      return;
    }
    syncedLayoutOptionsRef.current = next;
    ctrlRef.current?.setLayoutOptions(
      props.sizeMultiplier !== undefined
        ? { ...next, sizeMultiplier: props.sizeMultiplier }
        : (next ?? {}),
    );
  }, [props.layoutOptions, props.sizeMultiplier]);

  // Sync pluggable triangle face & edge views independently (instant re-render, no layout recompute)
  useEffect(() => {
    if (
      syncedTriangleViewRef.current === props.triangleView &&
      syncedEdgeViewRef.current === props.edgeView
    ) {
      return;
    }
    syncedTriangleViewRef.current = props.triangleView;
    syncedEdgeViewRef.current = props.edgeView;
    ctrlRef.current?.setViews({
      triangleView: props.triangleView,
      edgeView: props.edgeView,
    });
  }, [props.triangleView, props.edgeView]);

  // Sync pinned / highlighted / focused cluster / focused triangle
  useEffect(() => {
    if (props.pinnedIds !== undefined) {
      ctrlRef.current?.setPinnedIds(props.pinnedIds);
    }
  }, [props.pinnedIds]);

  useEffect(() => {
    if (props.highlightedIds !== undefined) {
      ctrlRef.current?.setHighlightedIds(props.highlightedIds);
    }
  }, [props.highlightedIds]);

  useEffect(() => {
    if (props.focusedClusterUid !== undefined) {
      internalFocusedUidRef.current = props.focusedClusterUid;
      ctrlRef.current?.setFocusedClusterUid(props.focusedClusterUid);
    }
  }, [props.focusedClusterUid]);

  useEffect(() => {
    if (props.focusedTriangleIndex !== undefined) {
      internalFocusedTriangleRef.current = props.focusedTriangleIndex;
      ctrlRef.current?.setFocusedTriangleIndex(props.focusedTriangleIndex);
    }
  }, [props.focusedTriangleIndex]);

  // Clear built-in tooltip if prop toggled off
  useEffect(() => {
    if (!props.tooltip) {
      setHoveredTarget(null);
    }
  }, [props.tooltip]);

  const renderBuiltInTooltip = () => {
    if (!props.tooltip || !hoveredTarget) return null;

    const containerW = containerRef.current?.clientWidth || 960;
    const containerH = containerRef.current?.clientHeight || 600;
    const left = Math.min(
      Math.max(8, Math.round(hoveredTarget.screenPosition.x + 14)),
      Math.max(8, containerW - 256),
    );
    const top = Math.min(
      Math.max(8, Math.round(hoveredTarget.screenPosition.y + 14)),
      Math.max(8, containerH - 80),
    );

    const isLight = props.theme === 'light';
    const content =
      typeof props.tooltip === 'function' ? (
        props.tooltip(hoveredTarget)
      ) : hoveredTarget.kind === 'content' ? (
        <div>
          <div style={{ fontWeight: 600, color: isLight ? '#0f172a' : '#f8fafc' }}>
            {extractDefaultItemLabel(
              hoveredTarget.item,
              hoveredTarget.layoutContext.id,
              props.getLabel,
            )}
          </div>
          {hoveredTarget.layoutContext.tags.length > 0 ? (
            <div style={{ marginTop: 3, fontSize: 11, color: isLight ? '#475569' : '#94a3b8' }}>
              {hoveredTarget.layoutContext.tags
                .map((t) => {
                  if (t.label) return t.label;
                  if (props.formatTagLabel) {
                    const formatted = props.formatTagLabel(t.tag).trim();
                    if (formatted.length > 0) return formatted;
                  }
                  return `#${t.tag}`;
                })
                .slice(0, 5)
                .join(' · ')}
            </div>
          ) : hoveredTarget.layoutContext.unitClusters.length > 0 ? (
            <div style={{ marginTop: 3, fontSize: 11, color: isLight ? '#475569' : '#94a3b8' }}>
              {hoveredTarget.layoutContext.unitClusters
                .map((uc) => `${uc.cluster.code} ${Math.round(uc.weight * 100)}%`)
                .join(' · ')}
            </div>
          ) : null}
        </div>
      ) : hoveredTarget.kind === 'cluster' ? (
        <div>
          {hoveredTarget.cluster.parentContextLabel && (
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: isLight ? '#64748b' : '#94a3b8',
                marginBottom: 1,
              }}
            >
              {hoveredTarget.cluster.parentContextLabel}
            </div>
          )}
          <div style={{ fontWeight: 600, color: hoveredTarget.cluster.colorHex }}>
            {`${hoveredTarget.cluster.code} · ${
              hoveredTarget.cluster.subclusterLabel || hoveredTarget.cluster.defaultLabel
            }`}
          </div>
          <div style={{ marginTop: 3, fontSize: 11, color: isLight ? '#475569' : '#94a3b8' }}>
            {`${hoveredTarget.cluster.members.length} ${
              hoveredTarget.cluster.members.length === 1 ? 'item' : 'items'
            }${hoveredTarget.neighborId ? ' · Click to switch' : ''}`}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontWeight: 600, color: isLight ? '#0f172a' : '#f8fafc' }}>
            {hoveredTarget.triangle.isContext
              ? 'Neighbor Triangle'
              : `Triangle #${hoveredTarget.triangle.index + 1}`}
          </div>
          <div style={{ marginTop: 3, fontSize: 11, color: isLight ? '#475569' : '#94a3b8' }}>
            {hoveredTarget.triangle.clusters
              .map((c, idx) =>
                c
                  ? `${c.code} (${c.defaultLabel})`
                  : `V${hoveredTarget.triangle.vertexIndices[idx] ?? idx}`,
              )
              .join(' · ')}
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: isLight ? '#64748b' : '#94a3b8' }}>
            {(() => {
              const ctrl = ctrlRef.current;
              const zMode = ctrl?.getZoomStrategy().mode;
              const zState = ctrl?.getZoomState();
              const hint = hoveredTarget.triangle.neighborId
                ? ' · Click to switch'
                : zMode === 'drill-down' && zState
                  ? zState.activeFrameKind === 'triangle-focus' && zState.canDrillUp
                    ? ' · Click to zoom out'
                    : zState.drillableTriangleIndices.includes(hoveredTarget.triangle.index)
                      ? ' · Click to zoom in'
                      : zState.focusableTriangleIndices.includes(hoveredTarget.triangle.index)
                        ? ' · Click to focus triangle'
                        : ''
                  : '';
              return `${hoveredTarget.triangle.coveredItemCount} items · ${hoveredTarget.triangle.interiorItemCount} interior${hint}`;
            })()}
          </div>
        </div>
      );

    return (
      <div
        role="tooltip"
        style={{
          position: 'absolute',
          left,
          top,
          zIndex: 20,
          maxWidth: 244,
          padding: '7px 10px',
          borderRadius: 8,
          background: isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9, 13, 22, 0.94)',
          border: isLight
            ? '1px solid rgba(203, 213, 225, 0.95)'
            : '1px solid rgba(51, 65, 85, 0.85)',
          color: isLight ? '#0f172a' : '#f1f5f9',
          fontSize: 12,
          lineHeight: 1.4,
          pointerEvents: 'none',
          boxShadow: isLight
            ? '0 10px 24px rgba(15, 23, 42, 0.12)'
            : '0 10px 24px rgba(0, 0, 0, 0.45)',
        }}
      >
        {content}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...props.style,
      }}
    >
      {renderBuiltInTooltip()}
    </div>
  );
}
