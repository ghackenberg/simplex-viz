import {
  areSimplexLayoutOptionsEqual,
  areSimplexMeshOptionsEqual,
  areSimplexTimelineOptionsEqual,
  createFreeCameraZoomStrategy,
  extractSimplexItemLabel,
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
  type ItemFilterMode,
  type ItemFilterPredicate,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type NodeRenderState,
  type NormalizedPointerEvent,
  type ReducedMotionPreference,
  type SimplexColorStrategy,
  type SimplexHoverTarget,
  type SimplexLayoutStrategy,
  type SimplexLegendModel,
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
  buildSimplexTooltipContentModel,
  computeSimplexTooltipCoords,
  dispatchSimplexDefaultLeftClick,
  getSimplexTooltipThemeTokens,
  isSimplexHoverEventConsumed,
} from '@simplex-viz/core/dom';
import {
  SimplexSvgController,
  createPresetVisualResolver,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type DeferInitialLayoutOptions,
  type GeometricShapeSvgViewOptions,
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
> = SimplexHoverTarget<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
>;

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
    /** Lightweight hover, dimming, and stroke styling hooks forwarded to `GeometricShapeSvgView` (`"geometric"` / `"badges"` presets). */
    readonly shapeOptions?: GeometricShapeSvgViewOptions;
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
    /**
     * Optional item filter predicate. Returning `false` dims or hides the item
     * (depending on `itemFilterMode`) without triggering a layout re-solve.
     */
    readonly itemFilter?: ItemFilterPredicate<TItem> | null;
    /**
     * Visual & hit-testing mode for items rejected by `itemFilter` (`'dim'` or `'hide'`).
     * Default: `'dim'`.
     */
    readonly itemFilterMode?: ItemFilterMode;
    readonly pinnedIds?: ReadonlySet<string> | readonly string[];
    readonly highlightedIds?: Iterable<string> | null;
    /**
     * Multi-selected item IDs. Tracked independently of `highlightedIds` and `pinnedIds`.
     * Supports both controlled usage (paired with `onSelectionChange`) and uncontrolled interactive selection.
     */
    readonly selectedIds?: Iterable<string> | null;
    /**
     * Enables `Shift+Drag` rubberband marquee box selection on pointer/mouse devices. Default: `true`.
     */
    readonly marqueeSelection?: boolean;
    /**
     * When `true` (default), `Shift+Click` (and keyboard `Shift+Enter` / `Shift+Space`) on active
     * content items toggles multi-selection before invoking `onContentClick`. Default: `true`.
     */
    readonly shiftClickSelects?: boolean;
    readonly focusedClusterUid?: string | null;
    readonly focusedTriangleIndex?: number | null;
    /**
     * Automatically re-measures SVG hulls and re-solves layout once webfonts finish loading
     * (`document.fonts.ready` and `loadingdone`). Default: `true`.
     */
    readonly relayoutOnFontLoad?: boolean;
    /**
     * Controls initial layout behavior when the container mounts at `0×0` (for example inside
     * hidden tabs, modals, or accordions). Pass `true` or `{ fallbackTimeoutMs }` to defer
     * solving until `ResizeObserver` reports a real non-zero container size.
     */
    readonly deferInitialLayout?: boolean | DeferInitialLayoutOptions;
    /**
     * Touch direction-locking threshold in CSS pixels (default: `8`). Yields vertical single-finger
     * swipes to native page scrolling (`touch-action: pan-y`) while locking horizontal canvas
     * gestures and two-finger pinch. Pass `0` to restore `touch-action: none`.
     */
    readonly touchScrollLockPx?: number;
    /**
     * Maximum pointer displacement in CSS pixels from `pointerdown` that still qualifies as a
     * click/tap (default: `12`). Suppresses accidental clicks after drag/pan/scroll gestures.
     */
    readonly clickTolerancePx?: number;
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
    /**
     * Accessible label applied to the root `<svg role="application">` element for screen readers.
     * Default: `'Interactive simplex topic graph'`.
     */
    readonly ariaLabel?: string;
    /**
     * Enables built-in WCAG 2.1 AA keyboard navigation (`Arrow` keys, `Home`/`End`, `Enter`/`Space`,
     * `Escape`), visible focus rings, and `aria-activedescendant` tracking. Default: `true`.
     */
    readonly keyboardNavigation?: boolean;
    /**
     * Motion reduction preference (`'auto' | boolean`). Default: `'auto'` (tracks OS
     * `prefers-reduced-motion: reduce` live and snaps spring/zoom/timeline motion when active).
     */
    readonly reducedMotion?: ReducedMotionPreference;
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
    /** Invoked whenever the active multi-selection set changes via user interaction or API calls. */
    readonly onSelectionChange?: (selectedIds: ReadonlySet<string>) => void;
    /**
     * Invoked whenever the structured legend model changes (clusters, zoom depth, item filter counts,
     * `emptyClusterBehavior`, focused cluster, or timeline step).
     */
    readonly onLegendChange?: (
      model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
    ) => void;
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

class ReactJsxAutoKeyToken {
  constructor(readonly key: string) {}
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

  const syncedItemsRef = useRef(props.items);
  const syncedThemeRef = useRef(props.theme ?? 'dark');
  const syncedVisualsInitializedRef = useRef(false);
  const syncedSizeMultiplierRef = useRef(props.sizeMultiplier);
  const syncedShowHullsRef = useRef(props.showHulls);
  const syncedEmptyClusterBehaviorRef = useRef(props.emptyClusterBehavior);
  const syncedItemFilterRef = useRef(props.itemFilter);
  const syncedItemFilterModeRef = useRef(props.itemFilterMode);
  const syncedShowZoomBreadcrumbsRef = useRef(props.showZoomBreadcrumbs);
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
  const syncedTouchScrollLockPxRef = useRef(props.touchScrollLockPx);
  const syncedClickTolerancePxRef = useRef(props.clickTolerancePx);
  const syncedAriaLabelRef = useRef(props.ariaLabel);
  const syncedKeyboardNavigationRef = useRef(props.keyboardNavigation);
  const syncedReducedMotionRef = useRef(props.reducedMotion);
  const syncedOnWheelRef = useRef(props.onWheel);
  const syncedPinnedIdsRef = useRef(props.pinnedIds);
  const syncedHighlightedIdsRef = useRef(props.highlightedIds);
  const syncedSelectedIdsRef = useRef(props.selectedIds);
  const syncedMarqueeSelectionRef = useRef(props.marqueeSelection);
  const syncedShiftClickSelectsRef = useRef(props.shiftClickSelects);
  const syncedFocusedClusterUidRef = useRef(props.focusedClusterUid);
  const syncedFocusedTriangleIndexRef = useRef(props.focusedTriangleIndex);
  const syncedVisualDepsRef = useRef<readonly unknown[] | null>(null);

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
      formatStepLabel: baseOpts.formatStepLabel
        ? (frame) => {
            const latest =
              getLatestTimelineOpts()?.formatStepLabel ?? baseOpts.formatStepLabel;
            return latest ? latest(frame) : frame.label;
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
        getLabel: (item) =>
          extractSimplexItemLabel(item, '', latestPropsRef.current.getLabel),
        theme,
        formatTagLabel: p.formatTagLabel,
        badgeOptions: p.badgeOptions,
        getShape: p.getShape,
      },
    );
    const base = p.visualResolver;

    const getKey = (
      visual:
        | TContentVisual
        | TClusterVisual
        | DefaultContentPresetVisual
        | DefaultClusterPresetVisual
        | ReactJsxAutoKeyToken,
    ): string => {
      if (visual instanceof ReactJsxAutoKeyToken) {
        return visual.key;
      }
      if (base) {
        return base.getVisualCacheKey(visual as TContentVisual | TClusterVisual);
      }
      return presetResolver.getVisualCacheKey(
        visual as DefaultContentPresetVisual | DefaultClusterPresetVisual,
      );
    };

    const bridged: VisualResolver<
      TItem,
      TContentVisual | DefaultContentPresetVisual | ReactJsxAutoKeyToken,
      TClusterVisual | DefaultClusterPresetVisual | ReactJsxAutoKeyToken,
      TTagMeta,
      TClusterMeta
    > = {
      resolveContentVisual: (item, ctx) => {
        const cur = latestPropsRef.current;
        const visual = base
          ? base.resolveContentVisual(item, ctx)
          : cur.renderContentNode
            ? new ReactJsxAutoKeyToken(
                cur.getContentCacheKey
                  ? cur.getContentCacheKey(item, ctx)
                  : `${ctx.id}:${ctx.mixedColorHex}:${ctx.tags.map((t) => t.tag).join(',')}:${ctx.unitClusters
                      .map((u) => `${u.cluster.clusterUid}:${u.weight.toFixed(2)}`)
                      .join(',')}`,
              )
            : presetResolver.resolveContentVisual(item, ctx);
        const key = getKey(visual);
        contentDomainByKeyRef.current.set(key, { item, ctx });
        return visual;
      },
      resolveClusterVisual: (cluster) => {
        const cur = latestPropsRef.current;
        const visual = base
          ? base.resolveClusterVisual(cluster)
          : cur.renderClusterNode
            ? new ReactJsxAutoKeyToken(
                cur.getClusterCacheKey
                  ? cur.getClusterCacheKey(cluster)
                  : `${cluster.clusterUid}:${cluster.defaultLabel}:${cluster.members.length}:${cluster.colorHex}`,
              )
            : presetResolver.resolveClusterVisual(cluster);
        const key = getKey(visual);
        clusterDomainByKeyRef.current.set(key, cluster);
        return visual;
      },
      getVisualCacheKey: getKey,
    };

    return bridged as VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;
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
    contentView: SvgNodeView<TContentVisual> | undefined;
    clusterView: SvgNodeView<TClusterVisual> | undefined;
  } => {
    const p = latestPropsRef.current;

    let contentView: SvgNodeView<TContentVisual> | undefined;
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
      contentView = undefined;
    }

    let clusterView: SvgNodeView<TClusterVisual> | undefined;
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
      clusterView = undefined;
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
      const consumed = isSimplexHoverEventConsumed(
        latestPropsRef.current.onContentHover,
        ev,
      );
      if (latestPropsRef.current.tooltip) {
        setHoveredTarget(ev && !consumed ? { kind: 'content', ...ev } : null);
      }
      // React renders its own JSX tooltip; suppress SimplexSvgController's built-in DOM tooltip.
      return true;
    },
    onClusterHover: (ev) => {
      const consumed = isSimplexHoverEventConsumed(
        latestPropsRef.current.onClusterHover,
        ev,
      );
      if (latestPropsRef.current.tooltip) {
        setHoveredTarget(ev && !consumed ? { kind: 'cluster', ...ev } : null);
      }
      return true;
    },
    onTriangleHover: (ev) => {
      const consumed = isSimplexHoverEventConsumed(
        latestPropsRef.current.onTriangleHover,
        ev,
      );
      if (latestPropsRef.current.tooltip) {
        setHoveredTarget(ev && !consumed ? { kind: 'triangle', ...ev } : null);
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
      const ctrl = ctrlRef.current;
      // In drill-down mode, let SimplexSvgController run built-in drill defaults unless cur.onLeftClick consumes.
      if (!ctrl || ctrl.getZoomStrategy().mode === 'drill-down') {
        return cur.onLeftClick?.(target, raw) === true;
      }
      dispatchSimplexDefaultLeftClick(target, raw, {
        userInteractions: { onLeftClick: cur.onLeftClick },
        zoomMode: 'free-camera',
        canDrillUp: false,
        selectedCount: ctrl.getSelectedIds().size,
        focusedItemId: ctrl.getFocusedItemId(),
        focusedClusterUid: internalFocusedUidRef.current,
        focusedTriangleIndex: internalFocusedTriangleRef.current,
        focusOnClusterClick:
          cur.focusedClusterUid === undefined && (cur.focusOnClusterClick ?? true),
        focusOnTriangleClick:
          cur.focusedTriangleIndex === undefined && (cur.focusOnTriangleClick ?? true),
        drillToNeighbor: (id) => ctrl.drillToNeighbor(id),
        drillDownTriangle: (idx) => ctrl.drillDownTriangle(idx),
        drillDownCluster: (uid) => ctrl.drillDownCluster(uid),
        drillUp: () => ctrl.drillUp(),
        setFocusedClusterUid: (uid) => {
          if (cur.focusedClusterUid === undefined) {
            internalFocusedUidRef.current = uid;
            ctrl.setFocusedClusterUid(uid);
          }
        },
        setFocusedTriangleIndex: (idx) => {
          if (cur.focusedTriangleIndex === undefined) {
            internalFocusedTriangleRef.current = idx;
            ctrl.setFocusedTriangleIndex(idx);
          }
        },
        clearFocusedItem: () => {
          ctrl.focusItem(null);
        },
        clearSelection: () => {
          ctrl.clearSelection();
        },
      });
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
    const needsCustomResolver = Boolean(
      p.visualResolver || p.renderContentNode || p.renderClusterNode,
    );
    const effectiveResolver = needsCustomResolver
      ? resolveEffectiveResolver()
      : undefined;
    const { contentView, clusterView } = resolveActiveViews(
      effectiveResolver ?? resolveEffectiveResolver(),
    );

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
      shapeOptions: p.shapeOptions,
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
      itemFilter: p.itemFilter,
      itemFilterMode: p.itemFilterMode,
      showZoomBreadcrumbs: p.showZoomBreadcrumbs,
      timeline: resolveTimelineOption(p.timeline),
      relayoutOnFontLoad: p.relayoutOnFontLoad,
      deferInitialLayout: p.deferInitialLayout,
      touchScrollLockPx: p.touchScrollLockPx,
      clickTolerancePx: p.clickTolerancePx,
      ariaLabel: p.ariaLabel,
      keyboardNavigation: p.keyboardNavigation,
      reducedMotion: p.reducedMotion,
      selectedIds: p.selectedIds,
      marqueeSelection: p.marqueeSelection,
      shiftClickSelects: p.shiftClickSelects,
      focusOnClusterClick: false,
      focusOnTriangleClick: false,
      interactions: buildReactInteractions(p.onWheel),
      onMetricsChange: (m) => latestPropsRef.current.onMetricsChange?.(m),
      onClustersChange: (c) => latestPropsRef.current.onClustersChange?.(c),
      onZoomStateChange: (z) => latestPropsRef.current.onZoomStateChange?.(z),
      onSelectionChange: (s) => latestPropsRef.current.onSelectionChange?.(s),
      onLegendChange: (l) => latestPropsRef.current.onLegendChange?.(l),
      onFpsUpdate: (fps) => latestPropsRef.current.onFpsUpdate?.(fps),
    });
    ctrlRef.current = ctrl;
    if (p.pinnedIds !== undefined) {
      ctrl.setPinnedIds(p.pinnedIds);
    }
    if (p.highlightedIds !== undefined) {
      ctrl.setHighlightedIds(p.highlightedIds);
    }
    if (p.focusedClusterUid !== undefined) {
      internalFocusedUidRef.current = p.focusedClusterUid;
      ctrl.setFocusedClusterUid(p.focusedClusterUid);
    }
    if (p.focusedTriangleIndex !== undefined) {
      internalFocusedTriangleRef.current = p.focusedTriangleIndex;
      ctrl.setFocusedTriangleIndex(p.focusedTriangleIndex);
    }
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

  // Unified atomic sync for items, theme, presets, views, strategies, options, and filters
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;

    const visualDeps: readonly unknown[] = [
      props.preset,
      props.theme,
      props.visualResolver,
      props.contentView,
      props.clusterView,
      props.renderContentNode,
      props.renderClusterNode,
      props.getLabel,
      props.badgeOptions?.showCode,
      props.badgeOptions?.maxTitleChars,
      props.badgeOptions?.formatTitle,
      props.getShape,
      props.shapeOptions?.shape,
      props.shapeOptions?.sides,
      props.shapeOptions?.rotationRad,
      props.shapeOptions?.hoverScale,
      props.shapeOptions?.hoverRingColor,
      props.shapeOptions?.dimmedOpacity,
      props.shapeOptions?.strokeColor,
      props.shapeOptions?.strokeWidth,
    ];

    if (!syncedVisualsInitializedRef.current) {
      syncedVisualsInitializedRef.current = true;
      syncedVisualDepsRef.current = visualDeps;
      return;
    }

    const prevVisualDeps = syncedVisualDepsRef.current;
    const visualsChanged =
      prevVisualDeps === null ||
      prevVisualDeps.length !== visualDeps.length ||
      visualDeps.some((val, i) => !Object.is(val, prevVisualDeps[i]));
    syncedVisualDepsRef.current = visualDeps;

    const nextTheme = props.theme ?? 'dark';
    const themeChanged = syncedThemeRef.current !== nextTheme;
    const itemsChanged = syncedItemsRef.current !== props.items;
    const sizeMultiplierChanged =
      syncedSizeMultiplierRef.current !== props.sizeMultiplier;
    const showHullsChanged = syncedShowHullsRef.current !== props.showHulls;
    const emptyClusterChanged =
      syncedEmptyClusterBehaviorRef.current !== props.emptyClusterBehavior;
    const itemFilterChanged =
      syncedItemFilterRef.current !== props.itemFilter ||
      syncedItemFilterModeRef.current !== props.itemFilterMode;
    const meshStrategyChanged =
      syncedMeshStrategyRef.current !== props.meshStrategy;
    const clusteringStrategyChanged =
      syncedClusteringStrategyRef.current !== props.clusteringStrategy;
    const colorStrategyChanged =
      syncedColorStrategyRef.current !== props.colorStrategy;
    const layoutStrategyChanged =
      syncedLayoutStrategyRef.current !== props.layoutStrategy;
    const zoomStrategyChanged =
      syncedZoomStrategyRef.current !== props.zoomStrategy;
    const showZoomBreadcrumbsChanged =
      syncedShowZoomBreadcrumbsRef.current !== props.showZoomBreadcrumbs;

    const prevMeshOpts = syncedMeshOptionsRef.current;
    const nextMeshOpts = props.meshOptions;
    const meshOptionsChanged = !areSimplexMeshOptionsEqual(
      prevMeshOpts,
      nextMeshOpts,
    );

    const prevLayoutOpts = syncedLayoutOptionsRef.current;
    const nextLayoutOpts = props.layoutOptions;
    const layoutOptionsChanged = !areSimplexLayoutOptionsEqual(
      prevLayoutOpts,
      nextLayoutOpts,
    );

    const triangleOrEdgeChanged =
      syncedTriangleViewRef.current !== props.triangleView ||
      syncedEdgeViewRef.current !== props.edgeView;

    const prevTimeline = syncedTimelineRef.current;
    const nextTimeline = props.timeline;
    const timelineChanged = !areSimplexTimelineOptionsEqual(
      prevTimeline,
      nextTimeline,
    );

    const touchScrollLockPxChanged =
      syncedTouchScrollLockPxRef.current !== props.touchScrollLockPx;
    const clickTolerancePxChanged =
      syncedClickTolerancePxRef.current !== props.clickTolerancePx;
    const ariaLabelChanged = syncedAriaLabelRef.current !== props.ariaLabel;
    const keyboardNavigationChanged =
      syncedKeyboardNavigationRef.current !== props.keyboardNavigation;
    const reducedMotionChanged =
      syncedReducedMotionRef.current !== props.reducedMotion;
    const onWheelChanged = syncedOnWheelRef.current !== props.onWheel;
    const pinnedIdsChanged = syncedPinnedIdsRef.current !== props.pinnedIds;
    const highlightedIdsChanged =
      syncedHighlightedIdsRef.current !== props.highlightedIds;
    const selectedIdsChanged = syncedSelectedIdsRef.current !== props.selectedIds;
    const marqueeSelectionChanged =
      syncedMarqueeSelectionRef.current !== props.marqueeSelection;
    const shiftClickSelectsChanged =
      syncedShiftClickSelectsRef.current !== props.shiftClickSelects;
    const focusedClusterUidChanged =
      syncedFocusedClusterUidRef.current !== props.focusedClusterUid;
    const focusedTriangleIndexChanged =
      syncedFocusedTriangleIndexRef.current !== props.focusedTriangleIndex;

    syncedMeshOptionsRef.current = nextMeshOpts;
    syncedLayoutOptionsRef.current = nextLayoutOpts;
    syncedTimelineRef.current = nextTimeline;

    if (
      !visualsChanged &&
      !themeChanged &&
      !itemsChanged &&
      !sizeMultiplierChanged &&
      !showHullsChanged &&
      !emptyClusterChanged &&
      !itemFilterChanged &&
      !meshStrategyChanged &&
      !clusteringStrategyChanged &&
      !colorStrategyChanged &&
      !layoutStrategyChanged &&
      !zoomStrategyChanged &&
      !showZoomBreadcrumbsChanged &&
      !meshOptionsChanged &&
      !layoutOptionsChanged &&
      !triangleOrEdgeChanged &&
      !timelineChanged &&
      !touchScrollLockPxChanged &&
      !clickTolerancePxChanged &&
      !ariaLabelChanged &&
      !keyboardNavigationChanged &&
      !reducedMotionChanged &&
      !onWheelChanged &&
      !pinnedIdsChanged &&
      !highlightedIdsChanged &&
      !selectedIdsChanged &&
      !marqueeSelectionChanged &&
      !shiftClickSelectsChanged &&
      !focusedClusterUidChanged &&
      !focusedTriangleIndexChanged
    ) {
      return;
    }

    ctrl.batch(() => {
      if (visualsChanged) {
        syncedThemeRef.current = nextTheme;
        const needsCustomResolver = Boolean(
          props.visualResolver || props.renderContentNode || props.renderClusterNode,
        );
        const effectiveResolver = needsCustomResolver
          ? resolveEffectiveResolver()
          : null;
        const { contentView, clusterView } = resolveActiveViews(
          effectiveResolver ?? resolveEffectiveResolver(),
        );
        ctrl.setOptions({
          preset: props.preset ?? 'geometric',
          theme: nextTheme,
          getLabel: props.getLabel,
          badgeOptions: props.badgeOptions,
          getShape: props.getShape,
          shapeOptions: props.shapeOptions,
          contentView: contentView ?? null,
          clusterView: clusterView ?? null,
          visualResolver: effectiveResolver,
        });
      } else if (themeChanged) {
        syncedThemeRef.current = nextTheme;
        ctrl.setTheme(nextTheme);
      }

      if (triangleOrEdgeChanged) {
        syncedTriangleViewRef.current = props.triangleView;
        syncedEdgeViewRef.current = props.edgeView;
        ctrl.setViews({
          triangleView: props.triangleView,
          edgeView: props.edgeView,
        });
      }

      if (meshOptionsChanged) {
        ctrl.setMeshOptions(nextMeshOpts ?? {});
      }

      if (layoutOptionsChanged) {
        syncedSizeMultiplierRef.current = props.sizeMultiplier;
        ctrl.setLayoutOptions(
          props.sizeMultiplier !== undefined
            ? { ...nextLayoutOpts, sizeMultiplier: props.sizeMultiplier }
            : (nextLayoutOpts ?? {}),
        );
      } else if (sizeMultiplierChanged) {
        syncedSizeMultiplierRef.current = props.sizeMultiplier;
        if (props.sizeMultiplier !== undefined) {
          ctrl.setSizeMultiplier(props.sizeMultiplier);
        }
      }

      if (meshStrategyChanged) {
        syncedMeshStrategyRef.current = props.meshStrategy;
        if (props.meshStrategy) {
          ctrl.setMeshStrategy(props.meshStrategy);
        }
      }

      if (clusteringStrategyChanged) {
        syncedClusteringStrategyRef.current = props.clusteringStrategy;
        if (props.clusteringStrategy) {
          ctrl.setClusteringStrategy(props.clusteringStrategy);
        }
      }

      if (colorStrategyChanged) {
        syncedColorStrategyRef.current = props.colorStrategy;
        if (props.colorStrategy) {
          ctrl.setColorStrategy(props.colorStrategy);
        }
      }

      if (layoutStrategyChanged) {
        syncedLayoutStrategyRef.current = props.layoutStrategy;
        if (props.layoutStrategy) {
          ctrl.setLayoutStrategy(props.layoutStrategy);
        }
      }

      if (zoomStrategyChanged) {
        syncedZoomStrategyRef.current = props.zoomStrategy;
        ctrl.setZoomStrategy(
          props.zoomStrategy ??
            createFreeCameraZoomStrategy<TItem, TTagMeta, TClusterMeta>(),
        );
      }

      if (showZoomBreadcrumbsChanged) {
        syncedShowZoomBreadcrumbsRef.current = props.showZoomBreadcrumbs;
        ctrl.setZoomUiOptions({
          showZoomBreadcrumbs: props.showZoomBreadcrumbs,
        });
      }

      if (showHullsChanged) {
        syncedShowHullsRef.current = props.showHulls;
        if (props.showHulls !== undefined) {
          ctrl.setShowHulls(props.showHulls);
        }
      }

      if (emptyClusterChanged) {
        syncedEmptyClusterBehaviorRef.current = props.emptyClusterBehavior;
        if (props.emptyClusterBehavior !== undefined) {
          ctrl.setEmptyClusterBehavior(props.emptyClusterBehavior);
        }
      }

      if (itemFilterChanged) {
        syncedItemFilterRef.current = props.itemFilter;
        syncedItemFilterModeRef.current = props.itemFilterMode;
        ctrl.setItemFilter(props.itemFilter ?? null, {
          mode: props.itemFilterMode ?? 'dim',
        });
      }

      if (timelineChanged) {
        ctrl.setTimelineOptions(resolveTimelineOption(nextTimeline));
      }

      if (touchScrollLockPxChanged) {
        syncedTouchScrollLockPxRef.current = props.touchScrollLockPx;
        if (props.touchScrollLockPx !== undefined) {
          ctrl.setTouchScrollLockPx(props.touchScrollLockPx);
        }
      }

      if (clickTolerancePxChanged) {
        syncedClickTolerancePxRef.current = props.clickTolerancePx;
        if (props.clickTolerancePx !== undefined) {
          ctrl.setClickTolerancePx(props.clickTolerancePx);
        }
      }

      if (ariaLabelChanged) {
        syncedAriaLabelRef.current = props.ariaLabel;
        ctrl.setAriaLabel(props.ariaLabel ?? '');
      }

      if (keyboardNavigationChanged) {
        syncedKeyboardNavigationRef.current = props.keyboardNavigation;
        if (props.keyboardNavigation !== undefined) {
          ctrl.setKeyboardNavigation(props.keyboardNavigation);
        }
      }

      if (reducedMotionChanged) {
        syncedReducedMotionRef.current = props.reducedMotion;
        if (props.reducedMotion !== undefined) {
          ctrl.setReducedMotion(props.reducedMotion);
        }
      }

      if (onWheelChanged) {
        syncedOnWheelRef.current = props.onWheel;
        ctrl.setInteractions(buildReactInteractions(props.onWheel));
      }

      if (pinnedIdsChanged) {
        syncedPinnedIdsRef.current = props.pinnedIds;
        if (props.pinnedIds !== undefined) {
          ctrl.setPinnedIds(props.pinnedIds);
        }
      }

      if (highlightedIdsChanged) {
        syncedHighlightedIdsRef.current = props.highlightedIds;
        if (props.highlightedIds !== undefined) {
          ctrl.setHighlightedIds(props.highlightedIds);
        }
      }

      if (selectedIdsChanged) {
        syncedSelectedIdsRef.current = props.selectedIds;
        if (props.selectedIds !== undefined) {
          ctrl.setSelectedIds(props.selectedIds);
        }
      }

      if (marqueeSelectionChanged) {
        syncedMarqueeSelectionRef.current = props.marqueeSelection;
        if (props.marqueeSelection !== undefined) {
          ctrl.setMarqueeSelection(props.marqueeSelection);
        }
      }

      if (shiftClickSelectsChanged) {
        syncedShiftClickSelectsRef.current = props.shiftClickSelects;
        if (props.shiftClickSelects !== undefined) {
          ctrl.setShiftClickSelects(props.shiftClickSelects);
        }
      }

      if (focusedClusterUidChanged) {
        syncedFocusedClusterUidRef.current = props.focusedClusterUid;
        if (props.focusedClusterUid !== undefined) {
          internalFocusedUidRef.current = props.focusedClusterUid;
          ctrl.setFocusedClusterUid(props.focusedClusterUid);
        }
      }

      if (focusedTriangleIndexChanged) {
        syncedFocusedTriangleIndexRef.current = props.focusedTriangleIndex;
        if (props.focusedTriangleIndex !== undefined) {
          internalFocusedTriangleRef.current = props.focusedTriangleIndex;
          ctrl.setFocusedTriangleIndex(props.focusedTriangleIndex);
        }
      }

      if (itemsChanged) {
        syncedItemsRef.current = props.items;
        ctrl.setItems(props.items);
      }
    });
  }, [
    props.items,
    props.preset,
    props.theme,
    props.visualResolver,
    props.contentView,
    props.clusterView,
    props.renderContentNode,
    props.renderClusterNode,
    props.getLabel,
    props.badgeOptions?.showCode,
    props.badgeOptions?.maxTitleChars,
    props.badgeOptions?.formatTitle,
    props.getShape,
    props.shapeOptions?.shape,
    props.shapeOptions?.sides,
    props.shapeOptions?.rotationRad,
    props.shapeOptions?.hoverScale,
    props.shapeOptions?.hoverRingColor,
    props.shapeOptions?.dimmedOpacity,
    props.shapeOptions?.strokeColor,
    props.shapeOptions?.strokeWidth,
    props.sizeMultiplier,
    props.showHulls,
    props.emptyClusterBehavior,
    props.itemFilter,
    props.itemFilterMode,
    props.meshStrategy,
    props.clusteringStrategy,
    props.colorStrategy,
    props.layoutStrategy,
    props.zoomStrategy,
    props.showZoomBreadcrumbs,
    props.meshOptions,
    props.layoutOptions,
    props.triangleView,
    props.edgeView,
    props.timeline,
    props.touchScrollLockPx,
    props.clickTolerancePx,
    props.ariaLabel,
    props.keyboardNavigation,
    props.reducedMotion,
    props.onWheel,
    props.pinnedIds,
    props.highlightedIds,
    props.selectedIds,
    props.marqueeSelection,
    props.shiftClickSelects,
    props.focusedClusterUid,
    props.focusedTriangleIndex,
  ]);

  // Clear built-in tooltip if prop toggled off
  useEffect(() => {
    if (!props.tooltip) {
      setHoveredTarget(null);
    }
  }, [props.tooltip]);

  const renderBuiltInTooltip = () => {
    if (!props.tooltip || !hoveredTarget) return null;

    const { left, top } = computeSimplexTooltipCoords({
      containerWidth: containerRef.current?.clientWidth || 960,
      containerHeight: containerRef.current?.clientHeight || 600,
      tipWidth: 244,
      tipHeight: 80,
      screenX: hoveredTarget.screenPosition.x,
      screenY: hoveredTarget.screenPosition.y,
    });

    const tooltipTokens = getSimplexTooltipThemeTokens(props.theme ?? 'dark');
    const ctrl = ctrlRef.current;

    let content: ReactNode;
    if (typeof props.tooltip === 'function') {
      content = props.tooltip(hoveredTarget);
      if (content === null || content === undefined || content === '') {
        return null;
      }
    } else {
      const model = buildSimplexTooltipContentModel(hoveredTarget, {
        getLabel: props.getLabel,
        formatTagLabel: props.formatTagLabel,
        preferSubclusterLabel: true,
        zoomMode: ctrl?.getZoomStrategy().mode,
        zoomState: ctrl?.getZoomState(),
        neighborHint: 'Click to switch',
      });
      if (model.kind === 'content') {
        content = (
          <div>
            <div style={{ fontWeight: 600, color: tooltipTokens.color }}>
              {model.title}
            </div>
            {model.subtitle ? (
              <div style={{ marginTop: 3, fontSize: 11, color: tooltipTokens.mutedColor }}>
                {model.subtitle}
              </div>
            ) : null}
          </div>
        );
      } else if (model.kind === 'cluster') {
        content = (
          <div>
            {model.eyebrow && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: tooltipTokens.eyebrowColor,
                  marginBottom: 1,
                }}
              >
                {model.eyebrow}
              </div>
            )}
            <div style={{ fontWeight: 600, color: model.accentColorHex }}>
              {model.title}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: tooltipTokens.mutedColor }}>
              {model.hint ? `${model.countText} · ${model.hint}` : model.countText}
            </div>
          </div>
        );
      } else {
        content = (
          <div>
            <div style={{ fontWeight: 600, color: tooltipTokens.color }}>
              {model.title}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: tooltipTokens.mutedColor }}>
              {model.cornersDetailed}
            </div>
            <div style={{ marginTop: 2, fontSize: 11, color: tooltipTokens.eyebrowColor }}>
              {model.hint
                ? `${model.interiorSummaryText} · ${model.hint}`
                : model.interiorSummaryText}
            </div>
          </div>
        );
      }
    }

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
          background: tooltipTokens.background,
          border: tooltipTokens.border,
          color: tooltipTokens.color,
          fontSize: 12,
          lineHeight: 1.4,
          pointerEvents: 'none',
          boxShadow: tooltipTokens.boxShadow,
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
