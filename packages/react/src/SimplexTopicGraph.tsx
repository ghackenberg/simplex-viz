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
  VisualResolver,
  WheelBehavior,
} from '@simplex-viz/core';
import {
  SimplexSvgController,
  type SvgNodeView,
} from '@simplex-viz/svg';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  ReactJsxSvgView,
  type ContentDomainRecord,
} from './ReactJsxSvgView';

/**
 * Props for `<SimplexTopicGraph />`, preserving end-to-end generic inference across
 * `TItem`, `TContentVisual`, `TClusterVisual`, `TTagMeta`, and `TClusterMeta`.
 */
export type SimplexTopicGraphProps<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = ItemIdentityConfig<TItem> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> & {
    readonly items: readonly TItem[];
    readonly visualResolver: VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;
    /** Portable `@simplex-viz/svg` view plugin for content items. */
    readonly contentView?: SvgNodeView<TContentVisual>;
    /** Portable `@simplex-viz/svg` view plugin for topic clusters. */
    readonly clusterView?: SvgNodeView<TClusterVisual>;
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
    readonly sizeMultiplier?: number;
    readonly showHulls?: boolean;
    readonly pinnedIds?: ReadonlySet<string> | readonly string[];
    readonly highlightedIds?: ReadonlySet<string> | readonly string[];
    readonly focusedClusterUid?: string | null;
    readonly onContentHover?: (
      event: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta> | null,
    ) => void;
    readonly onClusterHover?: (
      event: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta> | null,
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

/**
 * Type-safe React visualization component wrapping `@simplex-viz/core` and `@simplex-viz/svg`.
 */
export function SimplexTopicGraph<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
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

  const buildWrappedResolver = (
    base: VisualResolver<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>,
  ): VisualResolver<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> => ({
    resolveContentVisual: (item, ctx) => {
      const visual = base.resolveContentVisual(item, ctx);
      const key = base.getVisualCacheKey(visual);
      contentDomainByKeyRef.current.set(key, { item, ctx });
      return visual;
    },
    resolveClusterVisual: (cluster) => {
      const visual = base.resolveClusterVisual(cluster);
      const key = base.getVisualCacheKey(visual);
      clusterDomainByKeyRef.current.set(key, cluster);
      return visual;
    },
    getVisualCacheKey: (visual) => base.getVisualCacheKey(visual),
  });

  const resolveActiveViews = (): {
    contentView: SvgNodeView<TContentVisual>;
    clusterView: SvgNodeView<TClusterVisual>;
  } => {
    const p = latestPropsRef.current;

    let contentView: SvgNodeView<TContentVisual>;
    if (p.renderContentNode) {
      const renderFn = p.renderContentNode;
      jsxContentViewRef.current?.dispose();
      const jsxView = new ReactJsxSvgView<
        TContentVisual,
        ContentDomainRecord<TItem, TTagMeta, TClusterMeta>
      >({
        renderFn: (domain, state) => renderFn(domain.item, domain.ctx, state),
        getKey: (v) => p.visualResolver.getVisualCacheKey(v),
        domainByKey: contentDomainByKeyRef.current,
      });
      jsxContentViewRef.current = jsxView;
      contentView = jsxView;
    } else if (p.contentView) {
      jsxContentViewRef.current?.dispose();
      jsxContentViewRef.current = null;
      contentView = p.contentView;
    } else {
      contentView = {
        measureConvexHull: () => ({ kind: 'circle', radius: 10 }),
        mountOrUpdate: (groupEl, _visual, state) => {
          const doc = groupEl.ownerDocument;
          let circle = groupEl.querySelector('circle');
          if (!circle) {
            circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', '9');
            groupEl.appendChild(circle);
          }
          circle.setAttribute('fill', state.interaction.isHovered ? '#22d3ee' : '#64748b');
        },
      };
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
        getKey: (v) => p.visualResolver.getVisualCacheKey(v),
        domainByKey: clusterDomainByKeyRef.current,
      });
      jsxClusterViewRef.current = jsxView;
      clusterView = jsxView;
    } else if (p.clusterView) {
      jsxClusterViewRef.current?.dispose();
      jsxClusterViewRef.current = null;
      clusterView = p.clusterView;
    } else {
      clusterView = {
        measureConvexHull: () => ({ kind: 'circle', radius: 22 }),
        mountOrUpdate: (groupEl, _visual, state) => {
          const doc = groupEl.ownerDocument;
          let circle = groupEl.querySelector('circle');
          if (!circle) {
            circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', '20');
            circle.setAttribute('fill', '#0f172a');
            circle.setAttribute('stroke-width', '1.5');
            groupEl.appendChild(circle);
          }
          circle.setAttribute('stroke', state.interaction.isHovered ? '#f8fafc' : '#38bdf8');
        },
      };
    }

    return { contentView, clusterView };
  };

  // Mount controller once on container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const p = latestPropsRef.current;
    const { contentView, clusterView } = resolveActiveViews();

    const ctrl = SimplexSvgController.createFromResolved(el, {
      items: p.items,
      getId: p.getId,
      getTags: p.getTags,
      deriveClusterMeta: p.deriveClusterMeta,
      visualResolver: buildWrappedResolver(p.visualResolver),
      contentView,
      clusterView,
      normalizeTag: p.normalizeTag,
      resolveTagMeta: p.resolveTagMeta,
      meshOptions: p.meshOptions,
      layoutOptions: {
        ...p.layoutOptions,
        sizeMultiplier: p.sizeMultiplier ?? p.layoutOptions?.sizeMultiplier ?? 1,
      },
      showHulls: p.showHulls,
      interactions: {
        onContentHover: (ev) => latestPropsRef.current.onContentHover?.(ev),
        onClusterHover: (ev) => latestPropsRef.current.onClusterHover?.(ev),
        onLeftClick: (t, raw) => latestPropsRef.current.onLeftClick?.(t, raw),
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

  // Sync views & visual resolver (triggers smooth crossfade / morph!)
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const { contentView, clusterView } = resolveActiveViews();
    ctrl.setViews({ contentView, clusterView });
    ctrl.setVisualResolver(buildWrappedResolver(props.visualResolver));
  }, [
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

  // Sync pinned / highlighted / focused cluster
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
      ctrlRef.current?.setFocusedClusterUid(props.focusedClusterUid);
    }
  }, [props.focusedClusterUid]);

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
    />
  );
}
