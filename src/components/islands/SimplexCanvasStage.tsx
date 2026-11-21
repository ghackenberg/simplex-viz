import {
  createSimplexCanvas,
  type CanvasDefaultClusterVisual,
  type CanvasDefaultContentVisual,
  type CanvasNodeRenderer,
  type CanvasTheme,
  type CanvasTimelineConfig,
  type CanvasTooltipOption,
  type CanvasVisualPreset,
  type SimplexCanvasController,
  type SimplexCanvasUpdateOptions,
} from '@simplex-viz/canvas';
import type {
  ClusterDerivationContext,
  ContentClickEvent,
  EmptyClusterBehavior,
  LayoutSolverOptions,
  MeshOptions,
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexLayoutStrategy,
  SimplexMeshStrategy,
  SimplexTimelineState,
  SimplexZoomState,
  SimplexZoomStrategy,
  VisualResolver,
} from '@simplex-viz/core';
import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

export type ShowcaseRendererKind = 'svg' | 'canvas';

export interface RendererToggleProps {
  readonly renderer: ShowcaseRendererKind;
  readonly onChange: (next: ShowcaseRendererKind) => void;
  readonly compactMobile?: boolean;
}

/**
 * Precision split-button segmented control for switching live between
 * `@simplex-viz/svg` and `@simplex-viz/canvas`, aligned pixel-for-pixel with
 * `DatasetInfoButton` and `CssFullscreenButton`.
 */
export function RendererToggle({
  renderer,
  onChange,
  compactMobile = false,
}: RendererToggleProps) {
  const isSvg = renderer === 'svg';
  const isCanvas = renderer === 'canvas';

  return (
    <div
      role="group"
      aria-label="Renderer backend"
      className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-slate-200 bg-white divide-x divide-slate-200 dark:border-slate-700 dark:bg-[#0B0F17] dark:divide-slate-700"
    >
      <button
        type="button"
        aria-pressed={isSvg}
        title="Render with @simplex-viz/svg (SVG DOM)"
        onClick={() => onChange('svg')}
        className={`inline-flex cursor-pointer items-center gap-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500/70 whitespace-nowrap shrink-0 ${
          compactMobile ? 'px-2 sm:gap-1.5 sm:px-2.5' : 'gap-1.5 px-2.5'
        } ${
          isSvg
            ? 'bg-cyan-50/90 font-semibold text-cyan-950 dark:bg-cyan-950/60 dark:text-cyan-200'
            : 'bg-transparent font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
        }`}
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 ${
            compactMobile ? 'hidden sm:block' : ''
          } ${
            isSvg
              ? 'text-cyan-600 dark:text-cyan-400'
              : 'text-slate-400 dark:text-slate-500'
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="12 4 20 19 4 19" />
          <circle cx="12" cy="4" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="20" cy="19" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="4" cy="19" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        <span>SVG</span>
      </button>

      <button
        type="button"
        aria-pressed={isCanvas}
        title="Render with @simplex-viz/canvas (HTML5 Canvas 2D)"
        onClick={() => onChange('canvas')}
        className={`inline-flex cursor-pointer items-center gap-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/70 whitespace-nowrap shrink-0 ${
          compactMobile ? 'px-2 sm:gap-1.5 sm:px-2.5' : 'gap-1.5 px-2.5'
        } ${
          isCanvas
            ? 'bg-indigo-50/90 font-semibold text-indigo-950 dark:bg-indigo-950/60 dark:text-indigo-200'
            : 'bg-transparent font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
        }`}
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 ${
            compactMobile ? 'hidden sm:block' : ''
          } ${
            isCanvas
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-400 dark:text-slate-500'
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>Canvas</span>
      </button>
    </div>
  );
}

export interface SimplexCanvasStageProps<
  TItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items: readonly TItem[];
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly getLabel?: (item: TItem) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  readonly preset?: CanvasVisualPreset;
  readonly visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly contentRenderer?: CanvasNodeRenderer<TContentVisual>;
  readonly clusterRenderer?: CanvasNodeRenderer<TClusterVisual>;
  /** Optional subscription invoked to repaint the canvas when external async textures/images decode. */
  readonly subscribeRepaint?: (onRepaint: () => void) => () => void;
  readonly theme?: CanvasTheme;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexMeshStrategy<TItem>;
  readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  readonly layoutStrategy?: SimplexLayoutStrategy;
  readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  readonly showHulls?: boolean;
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  readonly highlightedIds?: Iterable<string> | null;
  readonly selectedIds?: Iterable<string> | null;
  readonly showZoomBreadcrumbs?: boolean;
  /** Renders the built-in floating timeline scrubber overlay when timeline is enabled. Default: `true`. */
  readonly showTimelineControls?: boolean;
  readonly timeline?: CanvasTimelineConfig<TItem> | null;
  readonly tooltip?: CanvasTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly onContentClick?: (
    event: ContentClickEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
  ) => boolean | void;
  readonly onBackgroundClick?: () => boolean | void;
  readonly onZoomStateChange?: (zoomState: SimplexZoomState) => void;
  readonly onTimelineStateChange?: (
    state: SimplexTimelineState<TItem> | null,
  ) => void;
  readonly controllerRef?: MutableRefObject<SimplexCanvasController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null>;
  /** Change to force a clean controller re-init (e.g. switching dataset or toggling timeline). */
  readonly resetKey?: string;
}

/**
 * Thin React host around `@simplex-viz/canvas` (`createSimplexCanvas`) with
 * live option syncing, custom domain Canvas 2D renderers, interactive drill-down
 * breadcrumbs, and a compact timeline HUD driven by `controller.subscribeTimeline()`.
 */
export function SimplexCanvasStage<
  TItem,
  TContentVisual = CanvasDefaultContentVisual,
  TClusterVisual = CanvasDefaultClusterVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  props: SimplexCanvasStageProps<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const localControllerRef = useRef<SimplexCanvasController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null>(null);

  const [zoomState, setZoomState] = useState<SimplexZoomState | null>(null);
  const [timelineState, setTimelineState] =
    useState<SimplexTimelineState<TItem> | null>(null);

  // Stable callback refs so handler identity never tears down the canvas.
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;

  const hasTimeline = Boolean(props.timeline);
  const resetKey = props.resetKey ?? '';

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const initial = latestPropsRef.current;
    const controller = createSimplexCanvas<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >(host, {
      items: initial.items,
      getId: initial.getId,
      getTags: initial.getTags,
      getLabel: initial.getLabel,
      resolveTagMeta: initial.resolveTagMeta,
      deriveClusterMeta: initial.deriveClusterMeta,
      preset: initial.preset ?? 'badges',
      visualResolver: initial.visualResolver,
      contentRenderer: initial.contentRenderer,
      clusterRenderer: initial.clusterRenderer,
      theme: initial.theme ?? 'dark',
      backgroundColor: 'transparent',
      meshOptions: initial.meshOptions,
      layoutOptions: initial.layoutOptions,
      meshStrategy: initial.meshStrategy,
      clusteringStrategy: initial.clusteringStrategy,
      colorStrategy: initial.colorStrategy,
      layoutStrategy: initial.layoutStrategy,
      zoomStrategy: initial.zoomStrategy,
      showHulls: initial.showHulls,
      emptyClusterBehavior: initial.emptyClusterBehavior,
      highlightedIds: initial.highlightedIds,
      selectedIds: initial.selectedIds,
      tooltip: initial.tooltip
        ? typeof initial.tooltip === 'object'
          ? {
              formatContent: (ev) => {
                const t = latestPropsRef.current.tooltip;
                return typeof t === 'object' && t.formatContent
                  ? t.formatContent(ev)
                  : '';
              },
              formatCluster: (ev) => {
                const t = latestPropsRef.current.tooltip;
                return typeof t === 'object' && t.formatCluster
                  ? t.formatCluster(ev)
                  : '';
              },
              formatTriangle: (ev) => {
                const t = latestPropsRef.current.tooltip;
                return typeof t === 'object' && t.formatTriangle
                  ? t.formatTriangle(ev)
                  : '';
              },
            }
          : true
        : false,
      timeline: initial.timeline ?? null,
      interactions: {
        onContentClick: (ev) => latestPropsRef.current.onContentClick?.(ev),
        onBackgroundClick: () => latestPropsRef.current.onBackgroundClick?.(),
      },
      onZoomStateChange: (nextZoom) => {
        setZoomState(nextZoom);
        latestPropsRef.current.onZoomStateChange?.(nextZoom);
      },
    });

    localControllerRef.current = controller;
    prevSyncedRef.current = initial;
    if (initial.controllerRef) {
      initial.controllerRef.current = controller;
    }

    setZoomState(controller.getZoomState());

    const unsubscribeTimeline = controller.subscribeTimeline((state) => {
      setTimelineState(state);
      latestPropsRef.current.onTimelineStateChange?.(state);
    });

    const unsubscribeRepaint = initial.subscribeRepaint?.(() => {
      controller.requestRender();
    });

    return () => {
      unsubscribeRepaint?.();
      unsubscribeTimeline();
      controller.destroy();
      localControllerRef.current = null;
      prevSyncedRef.current = null;
      if (latestPropsRef.current.controllerRef) {
        latestPropsRef.current.controllerRef.current = null;
      }
      setZoomState(null);
      setTimelineState(null);
    };
  }, [hasTimeline, resetKey]);

  // Sync only changed dynamic props into the live controller without resetting zoom or remounting.
  const prevSyncedRef = useRef<SimplexCanvasStageProps<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null>(null);

  useEffect(() => {
    const controller = localControllerRef.current;
    const prev = prevSyncedRef.current;
    if (!controller || !prev) return;

    const patch: {
      -readonly [K in keyof SimplexCanvasUpdateOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >]: SimplexCanvasUpdateOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >[K];
    } = {};
    let hasChanges = false;

    if (props.items !== prev.items) {
      patch.items = props.items;
      hasChanges = true;
    }
    if (props.visualResolver !== prev.visualResolver) {
      if (props.visualResolver) {
        patch.visualResolver = props.visualResolver;
      } else {
        patch.preset = props.preset ?? 'badges';
      }
      hasChanges = true;
    } else if (!props.visualResolver && props.preset !== prev.preset) {
      patch.preset = props.preset ?? 'badges';
      hasChanges = true;
    }
    if (props.contentRenderer !== prev.contentRenderer) {
      patch.contentRenderer = props.contentRenderer;
      hasChanges = true;
    }
    if (props.clusterRenderer !== prev.clusterRenderer) {
      patch.clusterRenderer = props.clusterRenderer;
      hasChanges = true;
    }
    if (props.theme !== prev.theme) {
      patch.theme = props.theme ?? 'dark';
      hasChanges = true;
    }
    if (props.meshOptions !== prev.meshOptions) {
      patch.meshOptions = props.meshOptions;
      hasChanges = true;
    }
    if (props.layoutOptions !== prev.layoutOptions) {
      patch.layoutOptions = props.layoutOptions;
      hasChanges = true;
    }
    if (props.meshStrategy !== prev.meshStrategy) {
      patch.meshStrategy = props.meshStrategy;
      hasChanges = true;
    }
    if (props.clusteringStrategy !== prev.clusteringStrategy) {
      patch.clusteringStrategy = props.clusteringStrategy;
      hasChanges = true;
    }
    if (props.colorStrategy !== prev.colorStrategy) {
      patch.colorStrategy = props.colorStrategy;
      hasChanges = true;
    }
    if (props.layoutStrategy !== prev.layoutStrategy) {
      patch.layoutStrategy = props.layoutStrategy;
      hasChanges = true;
    }
    if (props.zoomStrategy !== prev.zoomStrategy) {
      patch.zoomStrategy = props.zoomStrategy;
      hasChanges = true;
    }
    if (props.showHulls !== prev.showHulls) {
      patch.showHulls = props.showHulls;
      hasChanges = true;
    }
    if (props.emptyClusterBehavior !== prev.emptyClusterBehavior) {
      patch.emptyClusterBehavior = props.emptyClusterBehavior;
      hasChanges = true;
    }
    if (props.highlightedIds !== prev.highlightedIds) {
      patch.highlightedIds = props.highlightedIds ?? null;
      hasChanges = true;
    }
    if (props.selectedIds !== prev.selectedIds) {
      patch.selectedIds = props.selectedIds ?? null;
      hasChanges = true;
    }

    prevSyncedRef.current = props;
    if (hasChanges) {
      controller.setOptions(patch);
    }
  }, [
    props,
    props.items,
    props.preset,
    props.visualResolver,
    props.contentRenderer,
    props.clusterRenderer,
    props.theme,
    props.meshOptions,
    props.layoutOptions,
    props.meshStrategy,
    props.clusteringStrategy,
    props.colorStrategy,
    props.layoutStrategy,
    props.zoomStrategy,
    props.showHulls,
    props.emptyClusterBehavior,
    props.highlightedIds,
    props.selectedIds,
  ]);

  const showBreadcrumbs =
    (props.showZoomBreadcrumbs ?? true) &&
    zoomState !== null &&
    zoomState.depth > 0 &&
    zoomState.breadcrumbs.length > 0;
  const showTimelineOverlay =
    (props.showTimelineControls ?? true) &&
    timelineState !== null &&
    timelineState.totalSteps > 0;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {showBreadcrumbs && (
        <nav
          aria-label="Zoom drill-down breadcrumbs"
          className="absolute top-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-nowrap items-center gap-1 overflow-x-auto rounded-md border border-slate-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow-xs dark:border-slate-700 dark:bg-[#0B0F17]"
        >
          {zoomState.breadcrumbs.map((crumb, idx) => {
            const isLast = idx === zoomState.breadcrumbs.length - 1;
            return (
              <span
                key={`${crumb.depth}-${crumb.label}`}
                className="inline-flex shrink-0 items-center gap-1"
              >
                {idx > 0 && (
                  <span
                    aria-hidden="true"
                    className="text-slate-400 dark:text-slate-500"
                  >
                    ›
                  </span>
                )}
                <button
                  type="button"
                  disabled={isLast}
                  title={crumb.label}
                  onClick={() =>
                    localControllerRef.current?.drillToDepth(crumb.depth)
                  }
                  className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] transition-colors ${
                    isLast
                      ? 'font-semibold text-slate-950 dark:text-white'
                      : 'cursor-pointer font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  }`}
                >
                  {crumb.accentHex && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: crumb.accentHex }}
                    />
                  )}
                  <span className="max-w-[140px] truncate">{crumb.shortLabel}</span>
                </button>
              </span>
            );
          })}
        </nav>
      )}

      {showTimelineOverlay && (
        <div
          aria-label="Timeline playback controls"
          className="absolute bottom-3 left-1/2 z-20 flex w-[min(92%,460px)] -translate-x-1/2 items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-xs dark:border-slate-700 dark:bg-[#0B0F17]/95"
        >
          <button
            type="button"
            onClick={() => localControllerRef.current?.getTimeline()?.toggle()}
            className="cursor-pointer rounded-md border border-indigo-600/30 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-900 transition-colors hover:bg-indigo-100 dark:border-indigo-400/40 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-950 shrink-0"
          >
            {timelineState.playing ? 'Pause' : 'Play'}
          </button>

          <input
            type="range"
            aria-label="Timeline step"
            min={0}
            max={timelineState.totalSteps}
            value={timelineState.step}
            onChange={(e) => {
              const tl = localControllerRef.current?.getTimeline();
              tl?.pause();
              tl?.seek(Number(e.target.value));
            }}
            className="min-w-0 flex-1 accent-indigo-600 dark:accent-indigo-400"
          />

          <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 tabular-nums shrink-0">
            {timelineState.activeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
