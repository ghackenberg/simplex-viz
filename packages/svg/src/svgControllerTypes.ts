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
  DefaultClusterPresetVisual,
  DefaultContentPresetVisual,
  PresetBadgeClusterOptions,
  PresetContentShapeOption,
  SimplexTheme,
  SimplexVisualPreset,
} from './presets.js';
import type { SvgRendererOptions } from './SvgRendererAdapter.js';
import type { SvgEdgeView, SvgNodeView, SvgTriangleView } from './types.js';
import type { GeometricShapeSvgViewOptions } from './views/GeometricShapeSvgView.js';

export type { DeferInitialLayoutOptions };

export type SimplexSvgTooltipTarget<
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

export type SimplexTooltipFormatter<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = (
  target: SimplexSvgTooltipTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
) => string | null | undefined | false;

/**
 * Return value of `SimplexDomTooltipRenderer.render(target, containerEl)`:
 * - `false` or `null`: suppresses the tooltip for the current hovered target.
 * - `() => void`: optional teardown callback invoked before the next target render, on hide,
 *   on `setTooltip()`, and on `destroy()` (useful for Preact/Vue/Svelte mounts or listeners).
 * - `void` / `undefined` / `true`: shows the tooltip using the DOM rendered inside `containerEl`.
 */
export type SimplexDomTooltipRenderResult = void | boolean | null | (() => void);

/**
 * Custom DOM/HTML tooltip renderer that reuses `SimplexSvgController`'s built-in overlay
 * container, pointer-following, dynamic viewport edge-flipping, and hover lifecycle.
 */
export interface SimplexDomTooltipRenderer<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  /**
   * Populates `containerEl` with custom DOM/HTML for the hovered target.
   * Only invoked when the hovered target changes (not on every pointermove pixel within the
   * same target), while positioning continues to follow the pointer smoothly.
   * Return `false` or `null` to suppress the tooltip for this target, or return a cleanup
   * callback `() => void` to unmount components or detach listeners.
   */
  readonly render: (
    target: SimplexSvgTooltipTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    containerEl: HTMLDivElement,
  ) => SimplexDomTooltipRenderResult;
  /**
   * When `true` (default for custom DOM renderers), suppresses the built-in card chrome
   * (background, border, padding, max-width, typography) so the host controls full styling
   * while retaining overlay positioning (`position: absolute; pointer-events: none; z-index: 20`).
   * Set to `false` to inherit the built-in theme-adaptive tooltip card styles.
   */
  readonly unstyled?: boolean;
  /** Cursor offset in CSS pixels. Default: `{ x: 14, y: 14 }`. */
  readonly offset?: { readonly x?: number; readonly y?: number };
  /** Minimum clearance from container edges in CSS pixels. Default: `8`. */
  readonly margin?: number;
  /** Optional CSS class name(s) appended to the floating `.sv-tooltip` container element. */
  readonly className?: string;
  /** Optional callback invoked whenever the tooltip transitions from visible to hidden. */
  readonly onHide?: (containerEl: HTMLDivElement) => void;
}

export interface SimplexStructuredTooltipOption<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
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

export type SimplexSvgTooltipOption<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | boolean
  | SimplexTooltipFormatter<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>
  | SimplexStructuredTooltipOption<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >
  | SimplexDomTooltipRenderer<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;

/**
 * Configuration options for the built-in optional timeline / frame-stepping player
 * in `@simplex-viz/svg` and `@simplex-viz/react`.
 */
export type TimelinePlayerOptions<TItem = DefaultTaggedItem> =
  SimplexTimelinePlayerOptions<TItem>;

export interface SimplexSvgControllerResolvedOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items: readonly TItem[];
  readonly getId?: (item: TItem) => string;
  readonly getTags?: (item: TItem) => readonly string[];
  readonly getLabel?: (item: TItem) => string;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  /** Built-in visual preset used when `visualResolver` / views are omitted. Default: `'geometric'`. */
  readonly preset?: SimplexVisualPreset;
  /** Visual color theme (`'dark'` or `'light'`) for built-in presets and tooltips. Default: `'dark'`. */
  readonly theme?: SimplexTheme;
  /** Optional custom visual resolver (defaults to the active `preset` resolver). */
  readonly visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  /** Optional custom content `SvgNodeView` (defaults to the active `preset` view). */
  readonly contentView?: SvgRendererOptions<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >['contentView'];
  /** Optional custom cluster `SvgNodeView` (defaults to the active `preset` view). */
  readonly clusterView?: SvgRendererOptions<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >['clusterView'];
  /** Optional pluggable `SvgTriangleView` for triangulation faces. */
  readonly triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
  /** Optional pluggable `SvgEdgeView` for triangulation edges. */
  readonly edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
  readonly normalizeTag?: (rawTag: string) => string;
  /** Optional formatter converting canonical tag IDs into concise human-readable display labels without altering clustering or equality checks. */
  readonly formatTagLabel?: (tag: string) => string;
  readonly resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  /** Formatting & code-toggle options for `BadgeClusterSvgView` when using `preset: 'badges'`. */
  readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  /** Fixed shape or per-item shape resolver overriding topological rank shapes in `GeometricShapeSvgView` (`'geometric'` / `'badges'` presets). */
  readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  /** Lightweight hover, dimming, and stroke styling hooks forwarded to `GeometricShapeSvgView` (`'geometric'` / `'badges'` presets). */
  readonly shapeOptions?: GeometricShapeSvgViewOptions;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexMeshStrategy<TItem>;
  readonly clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  readonly colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  readonly layoutStrategy?: SimplexLayoutStrategy;
  readonly zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  readonly showHulls?: boolean;
  /**
   * Controls how clusters with `0` active member items are rendered (`'normal'`, `'dim'`, or `'hide'`).
   * Especially useful during chronological timeline playback with final-seeded clusters. Default: `'normal'`.
   */
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  /**
   * Optional initial item filter predicate. Returning `false` dims or hides the item
   * (depending on `itemFilterMode`) without re-running clustering or layout.
   */
  readonly itemFilter?: ItemFilterPredicate<TItem> | null;
  /**
   * Visual & hit-testing mode for items rejected by `itemFilter` (`'dim'` or `'hide'`).
   * Default: `'dim'`.
   */
  readonly itemFilterMode?: ItemFilterMode;
  /** Renders the built-in breadcrumb bar when drilled into sub-levels. Default: `true`. */
  readonly showZoomBreadcrumbs?: boolean;
  /**
   * Opt-in chronological timeline / frame-stepping playback support.
   * Pass `true` for zero-config playback with auto-detected timestamps and built-in HUD controls,
   * or a `TimelinePlayerOptions` object for custom frame extractors, speed, and UI controls.
   */
  readonly timeline?: boolean | TimelinePlayerOptions<TItem>;
  /**
   * Automatically re-measures SVG hulls and re-solves layout once webfonts finish loading
   * (`document.fonts.ready` and `loadingdone`). Prevents stale fallback-font text measurements
   * in production deployments. Default: `true`.
   */
  readonly relayoutOnFontLoad?: boolean;
  /**
   * Controls initial layout behavior when the container mounts at `0×0` (for example inside
   * a hidden tab, modal, accordion, or before async CSS loads):
   * - `false` / `undefined` (default): initializes synchronously at a provisional `960×620`
   *   fallback size for backwards compatibility, and automatically invalidates cached hulls
   *   and performs a fresh `'initial'` re-initialization (with zero spring jump) on the first
   *   non-zero `ResizeObserver` entry.
   * - `true` or `{ fallbackTimeoutMs }`: skips the provisional `960×620` solve entirely until
   *   `ResizeObserver` reports a real non-zero container size (or until `fallbackTimeoutMs` elapses).
   */
  readonly deferInitialLayout?: boolean | DeferInitialLayoutOptions;
  /**
   * Touch direction-locking threshold in CSS pixels for embedded mobile/touch canvases.
   * When `> 0` (default: `8`), sets `touch-action: pan-y` on the SVG and inspects single-finger
   * touch movement once it reaches `touchScrollLockPx`:
   * - Vertical swipes (`|dy| > |dx|`) yield cleanly to native page scrolling and suppress clicks.
   * - Horizontal swipes (`|dx| >= |dy|`) lock onto the canvas (`preventDefault()` on `touchmove`)
   *   so horizontal panning does not fight browser gestures.
   * - Two-finger pinch gestures always lock onto the canvas.
   * Set to `0` to disable scroll-yielding and restore `touch-action: none` (full 2D touch panning).
   */
  readonly touchScrollLockPx?: number;
  /**
   * Maximum pointer displacement in CSS pixels (measured from `pointerdown` origin across the
   * entire gesture) that still qualifies as a click/tap. Any gesture whose peak displacement
   * exceeds `clickTolerancePx` suppresses the trailing `click` callback in both `free-camera`
   * and `drill-down` modes. Default: `12`.
   */
  readonly clickTolerancePx?: number;
  /**
   * Automatically toggles cluster focus when clicking a topic cluster (and clears on background click)
   * unless consumed (`return true`) by a click interaction handler. Default: `true`.
   */
  readonly focusOnClusterClick?: boolean;
  /**
   * Automatically toggles triangle face focus when clicking a triangle face (and clears on background click)
   * unless consumed (`return true`) by a click interaction handler. Default: `true`.
   */
  readonly focusOnTriangleClick?: boolean;
  /**
   * Enables a built-in floating DOM hover tooltip, a custom text formatter, or a custom
   * DOM/HTML renderer object (`SimplexDomTooltipRenderer`) reusing built-in positioning and
   * viewport edge-clamping. Default: `false`.
   */
  readonly tooltip?: SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  /**
   * Accessible label applied to the root `<svg role="application">` element for screen readers.
   * Default: `'Interactive simplex topic graph'`.
   */
  readonly ariaLabel?: string;
  /**
   * Enables built-in WCAG 2.1 AA keyboard navigation (`Arrow` keys, `Home`/`End`, `Enter`/`Space`,
   * `Escape`), visible focus rings, and `aria-activedescendant` tracking on the root `<svg>`.
   * Default: `true`.
   */
  readonly keyboardNavigation?: boolean;
  /**
   * Motion reduction preference for spring, zoom-flight, and timeline layout transitions:
   * - `'auto'` (default): Follows `window.matchMedia('(prefers-reduced-motion: reduce)')`
   *   and reacts live to OS accessibility changes.
   * - `true`: Always snaps layout, zoom, and timeline transitions immediately without spatial motion.
   * - `false`: Always runs full animations regardless of OS preference.
   */
  readonly reducedMotion?: ReducedMotionPreference;
  /**
   * Optional initial multi-selected item IDs. Tracked independently of `highlightedIds` and `pinnedIds`.
   */
  readonly selectedIds?: Iterable<string> | null;
  /**
   * Enables `Shift+Drag` rubberband marquee box selection on pointer/mouse devices.
   * Does not conflict with single-button drag-to-pan or touch scrolling. Default: `true`.
   */
  readonly marqueeSelection?: boolean;
  /**
   * When `true` (default), `Shift+Click` (and keyboard `Shift+Enter` / `Shift+Space`) on active
   * content items toggles multi-selection before invoking `onContentClick` / `onLeftClick`.
   * Set to `false` to receive `Shift+Click` in `onContentClick` / `onLeftClick` instead.
   */
  readonly shiftClickSelects?: boolean;
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
  readonly onZoomStateChange?: (state: SimplexZoomState) => void;
  /** Invoked whenever the active multi-selection set changes via user interaction or API calls. */
  readonly onSelectionChange?: (selectedIds: ReadonlySet<string>) => void;
  /**
   * Invoked whenever the structured legend model changes (clusters, zoom depth, item filter counts,
   * `emptyClusterBehavior`, focused cluster, or timeline step). Deduplicated against no-op updates.
   */
  readonly onLegendChange?: (
    model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ) => void;
  readonly onFpsUpdate?: (fps: number) => void;
}

export type SimplexSvgControllerOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = StrategyItemIdentityConfig<TItem, TTagMeta> &
  ClusterMetaConfig<TItem, TTagMeta, TClusterMeta> &
  Omit<
    SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    'getId' | 'getTags' | 'deriveClusterMeta' | 'clusteringStrategy'
  >;

/**
 * Partial runtime configuration accepted by `controller.setOptions(options)` so simultaneous
 * updates to theme, preset, styling options, views, filters, or core strategies execute in
 * a single atomic layout and render pass.
 */
export interface SimplexSvgUpdateOptions<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly items?: readonly TItem[];
  readonly preset?: SimplexVisualPreset;
  readonly getLabel?: (item: TItem) => string;
  readonly theme?: SimplexTheme;
  /** Pass a custom `VisualResolver`, or `null` to restore the active built-in preset resolver. */
  readonly visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null;
  /** Pass a custom content node view, or `null` to restore the active built-in preset view. */
  readonly contentView?: SvgNodeView<TContentVisual> | null;
  /** Pass a custom cluster node view, or `null` to restore the active built-in preset view. */
  readonly clusterView?: SvgNodeView<TClusterVisual> | null;
  readonly triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
  readonly edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
  readonly badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  readonly getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  readonly shapeOptions?: GeometricShapeSvgViewOptions;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly sizeMultiplier?: number;
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
  readonly timeline?: boolean | TimelinePlayerOptions<TItem>;
  readonly tooltip?: SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly ariaLabel?: string;
  readonly keyboardNavigation?: boolean;
  readonly reducedMotion?: ReducedMotionPreference;
  readonly touchScrollLockPx?: number;
  readonly clickTolerancePx?: number;
  readonly interactions?: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly pinnedIds?: ReadonlySet<string> | readonly string[];
  readonly highlightedIds?: Iterable<string> | null;
  readonly selectedIds?: Iterable<string> | null;
  readonly marqueeSelection?: boolean;
  readonly shiftClickSelects?: boolean;
  readonly onSelectionChange?: (selectedIds: ReadonlySet<string>) => void;
  readonly onLegendChange?: (
    model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ) => void;
  readonly focusedItemId?: string | null;
  readonly focusedClusterUid?: string | null;
  readonly focusedTriangleIndex?: number | null;
}
