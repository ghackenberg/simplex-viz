import type {
  ClusterDescriptor,
  ClusterHoverEvent,
  ClusterMetaConfig,
  ContentHoverEvent,
  ContentLayoutContext,
  DefaultTaggedItem,
  HitTarget,
  ItemIdentityConfig,
  LayoutMetrics,
  LayoutSolverOptions,
  MeshOptions,
  NodeRenderState,
  NormalizedPointerEvent,
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexLayoutStrategy,
  SimplexMeshStrategy,
  TriangleHoverEvent,
  VisualResolver,
  WheelBehavior,
} from '@simplex-viz/core';
import {
  SimplexSvgController,
  createPresetViews,
  createPresetVisualResolver,
  extractDefaultItemLabel,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type SimplexTheme,
  type SimplexVisualPreset,
  type SvgEdgeView,
  type SvgNodeView,
  type SvgTriangleView,
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
} from './ReactJsxSvgView';

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
> = ItemIdentityConfig<TItem> &
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
    readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
    readonly meshOptions?: MeshOptions;
    readonly layoutOptions?: LayoutSolverOptions;
    /** Optional custom mesh/triangulation strategy. */
    readonly meshStrategy?: SimplexMeshStrategy<TItem>;
    /** Optional custom topic clustering & vertex assignment strategy. */
    readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
    /** Optional custom cluster coloring & item color-mixing strategy. */
    readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
    /** Optional custom node positioning & scaling strategy. */
    readonly layoutStrategy?: SimplexLayoutStrategy;
    readonly sizeMultiplier?: number;
    readonly showHulls?: boolean;
    readonly pinnedIds?: ReadonlySet<string> | readonly string[];
    readonly highlightedIds?: ReadonlySet<string> | readonly string[];
    readonly focusedClusterUid?: string | null;
    readonly focusedTriangleIndex?: number | null;
    /**
     * Enables built-in cluster focus toggle on click when `focusedClusterUid` and `onLeftClick`
     * are not controlled externally. Default: `true`.
     */
    readonly focusOnClusterClick?: boolean;
    /**
     * Enables built-in triangle face focus toggle on click when `focusedTriangleIndex` and `onLeftClick`
     * are not controlled externally. Default: `true`.
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
    readonly onContentHover?: (
      event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta> | null,
    ) => void;
    readonly onClusterHover?: (
      event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta> | null,
    ) => void;
    readonly onTriangleHover?: (
      event: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta> | null,
    ) => void;
    readonly onLeftClick?: (
      target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
      rawEvent: NormalizedPointerEvent,
    ) => void;
    readonly onRightClick?: (
      target: HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
      rawEvent: NormalizedPointerEvent,
    ) => boolean | void;
    readonly onWheel?: WheelBehavior;
    readonly onMetricsChange?: (metrics: LayoutMetrics) => void;
    readonly onClustersChange?: (
      clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
    ) => void;
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
  const syncedTriangleViewRef = useRef(props.triangleView);
  const syncedEdgeViewRef = useRef(props.edgeView);

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
      (item) => {
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
            : `${ctx.id}:${ctx.mixedColorHex}:${ctx.tags.map((t) => t.tag).join(',')}`;
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
      resolveTagMeta: p.resolveTagMeta,
      meshOptions: p.meshOptions,
      layoutOptions: {
        ...p.layoutOptions,
        sizeMultiplier: p.sizeMultiplier ?? p.layoutOptions?.sizeMultiplier ?? 1,
      },
      meshStrategy: p.meshStrategy,
      clusteringStrategy: p.clusteringStrategy,
      colorStrategy: p.colorStrategy,
      layoutStrategy: p.layoutStrategy,
      showHulls: p.showHulls,
      focusOnClusterClick: false,
      focusOnTriangleClick: false,
      interactions: {
        onContentHover: (ev) => {
          latestPropsRef.current.onContentHover?.(ev);
          if (latestPropsRef.current.tooltip) {
            setHoveredTarget(ev ? { kind: 'content', ...ev } : null);
          }
        },
        onClusterHover: (ev) => {
          latestPropsRef.current.onClusterHover?.(ev);
          if (latestPropsRef.current.tooltip) {
            setHoveredTarget(ev ? { kind: 'cluster', ...ev } : null);
          }
        },
        onTriangleHover: (ev) => {
          latestPropsRef.current.onTriangleHover?.(ev);
          if (latestPropsRef.current.tooltip) {
            setHoveredTarget(ev ? { kind: 'triangle', ...ev } : null);
          }
        },
        onLeftClick: (target, raw) => {
          const cur = latestPropsRef.current;
          if (cur.onLeftClick) {
            cur.onLeftClick(target, raw);
            return;
          }
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
        },
        onRightClick: (t, raw) => latestPropsRef.current.onRightClick?.(t, raw),
        onWheel: (ev, cam) => {
          const policy = latestPropsRef.current.onWheel ?? 'zoom-to-cursor';
          if (policy === 'none') return;
          if (typeof policy === 'function') {
            policy(ev, cam);
            return;
          }
          if (policy === 'pan-vertical') {
            cam.panBy(-ev.deltaX, -ev.deltaY);
            return;
          }
          const factor = Math.exp(-ev.deltaY * 0.0014);
          cam.zoomToCursor(ev.screenX, ev.screenY, factor);
        },
      },
      onMetricsChange: (m) => latestPropsRef.current.onMetricsChange?.(m),
      onClustersChange: (c) => latestPropsRef.current.onClustersChange?.(c),
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
          {hoveredTarget.layoutContext.tags.length > 0 && (
            <div style={{ marginTop: 3, fontSize: 11, color: isLight ? '#475569' : '#94a3b8' }}>
              {hoveredTarget.layoutContext.tags
                .map((t) => `#${t.tag}`)
                .slice(0, 5)
                .join(' · ')}
            </div>
          )}
        </div>
      ) : hoveredTarget.kind === 'cluster' ? (
        <div>
          <div style={{ fontWeight: 600, color: hoveredTarget.cluster.colorHex }}>
            {`${hoveredTarget.cluster.code} · ${hoveredTarget.cluster.defaultLabel}`}
          </div>
          <div style={{ marginTop: 3, fontSize: 11, color: isLight ? '#475569' : '#94a3b8' }}>
            {`${hoveredTarget.cluster.members.length} ${
              hoveredTarget.cluster.members.length === 1 ? 'item' : 'items'
            }`}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontWeight: 600, color: isLight ? '#0f172a' : '#f8fafc' }}>
            {`Triangle #${hoveredTarget.triangle.index + 1}`}
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
            {`${hoveredTarget.triangle.coveredItemCount} items · ${hoveredTarget.triangle.interiorItemCount} interior`}
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
