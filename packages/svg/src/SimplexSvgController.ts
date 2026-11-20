import {
  SimplexGraphEngine,
  SimplexTimelineController,
  createCollisionDrivenLayoutStrategy,
  createFinalSeededClusteringStrategy,
  createFinalSeededLayoutStrategy,
  createSimplexTimeline,
  createSoftSimplexTagClusteringStrategy,
  isPointInTriangle,
  type CameraController,
  type ClusterDerivationContext,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ClusterMetaConfig,
  type ContentHoverEvent,
  type DefaultTaggedItem,
  type EmptyClusterBehavior,
  type FinalSeededLayoutScaleMode,
  type FocusItemOptions,
  type InteractionHandlers,
  type ItemFilterMode,
  type ItemFilterOptions,
  type ItemFilterPredicate,
  type ItemFilterState,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type ReducedMotionPreference,
  type RestoreViewStateOptions,
  type SelectInRectOptions,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexInteractiveTarget,
  type SimplexKeyboardFocusTarget,
  type SimplexLayoutStrategy,
  type SimplexLegendEntry,
  type SimplexLegendModel,
  type SimplexLegendModelOptions,
  type SimplexMeshStrategy,
  type SimplexTimelineOptions,
  type SimplexTimelineState,
  type SimplexViewState,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type StrategyItemIdentityConfig,
  type TriangleHoverEvent,
  type VisualResolver,
  type ZoomToItemOptions,
} from '@simplex-viz/core';
import {
  exportSvgElementToPng,
  prepareStandaloneSvg,
  type ExportPngBlobOptions,
  type ExportPngDataUrlOptions,
  type ExportPngOptions,
  type ExportSvgOptions,
} from './export.js';
import { SVG_NS } from './hullMeasure.js';
import {
  createPresetViews,
  createPresetVisualResolver,
  extractDefaultItemLabel,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type PresetBadgeClusterOptions,
  type PresetContentShapeOption,
  type SimplexTheme,
  type SimplexVisualPreset,
} from './presets.js';
import {
  SvgRendererAdapter,
  type SvgAriaMetadataResolver,
  type SvgRendererOptions,
} from './SvgRendererAdapter.js';
import type { SvgEdgeView, SvgNodeView, SvgTriangleView } from './types.js';
import {
  GeometricShapeSvgView,
  type GeometricShapeSvgViewOptions,
} from './views/GeometricShapeSvgView.js';

let nextA11yInstanceSeq = 0;

const DEFAULT_ARIA_LABEL = 'Interactive simplex topic graph';

export type SimplexSvgTooltipTarget<
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

export type SimplexSvgTooltipOption<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | boolean
  | SimplexTooltipFormatter<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>
  | SimplexDomTooltipRenderer<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;

function isDomTooltipRenderer<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  option: SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): option is SimplexDomTooltipRenderer<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
> {
  return (
    typeof option === 'object' &&
    option !== null &&
    typeof option.render === 'function'
  );
}

/**
 * Configuration options for the built-in optional timeline / frame-stepping player
 * in `@simplex-viz/svg` and `@simplex-viz/react`.
 */
export interface TimelinePlayerOptions<TItem = DefaultTaggedItem>
  extends SimplexTimelineOptions<TItem> {
  /**
   * Renders the compact, theme-adaptive Play/Pause/Step/Scrubber HUD bar inside the graph container.
   * Set to `false` when binding an external host timeline bar via `controller.subscribeTimeline(...)`
   * and `controller.timeline` (`play()`, `pause()`, `stepBy()`, `seek()`, `resetToEnd()`).
   * Default: `true`.
   */
  readonly showControls?: boolean;
  /** Vertical placement of the built-in timeline player bar. Default: `'bottom'`. */
  readonly position?: 'bottom' | 'top';
  /**
   * Automatically wraps the active clustering strategy in `createFinalSeededClusteringStrategy`
   * seeded from the full corpus so cluster vertices, UIDs, labels, and colors stay pinned across
   * `0..N` playback frames with zero cluster hopping. Default: `true`.
   */
  readonly autoFinalSeed?: boolean;
  /**
   * Automatically wraps the active layout strategy in `createFinalSeededLayoutStrategy`
   * seeded from the full corpus so items appear at their exact final coordinates across `0..N`
   * playback frames with zero drift.
   * - `false` / `undefined` (default): active `layoutStrategy` runs normally on each step.
   * - `true` or `'pinned'`: freeze both coordinates and final scale.
   * - `'adaptive'`: freeze coordinates, allow sparse frames to render larger and smoothly scale down.
   */
  readonly autoFinalSeedLayout?: boolean | FinalSeededLayoutScaleMode;
  /**
   * Controls how empty / not-yet-populated future clusters are rendered while timeline playback
   * is active (`'normal'`, `'dim'`, or `'hide'`). Overrides top-level `emptyClusterBehavior`
   * during timeline playback when specified.
   */
  readonly emptyClusterBehavior?: EmptyClusterBehavior;
  /** Invoked whenever the timeline playback state changes (step, play/pause, speed, corpus). */
  readonly onStateChange?: (state: SimplexTimelineState<TItem>) => void;
}

/**
 * Options for deferring the initial triangulation, clustering, and layout solve
 * when the mount container initially measures `0×0` (for example inside hidden tabs,
 * modals, accordions, or before async CSS loads).
 */
export interface DeferInitialLayoutOptions {
  /**
   * Optional timeout in milliseconds after which the controller falls back to a
   * provisional `960×620` layout if `ResizeObserver` has not yet reported a non-zero
   * container size. Even after the timeout fires, the first subsequent non-zero
   * `ResizeObserver` entry still performs a clean `'initial'` re-initialization.
   */
  readonly fallbackTimeoutMs?: number;
}

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
  readonly highlightedItems?: Iterable<string> | null;
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

function resolveContainerElement(target: HTMLElement | string): HTMLElement {
  if (typeof target !== 'string') {
    return target;
  }
  if (typeof document === 'undefined') {
    throw new Error(
      `SimplexSvgController: cannot resolve selector "${target}" outside a DOM environment.`,
    );
  }
  const el = document.querySelector<HTMLElement>(target);
  if (!el) {
    throw new Error(
      `SimplexSvgController: no element matched container selector "${target}".`,
    );
  }
  return el;
}

/**
 * High-level framework-agnostic SVG graph controller for Vanilla TypeScript, Vue, Angular,
 * Svelte, Web Components, and `@simplex-viz/react`.
 *
 * Works zero-config with `{ items }` via built-in presets, default zoom/pan/focus interactions,
 * and optional tooltips, while remaining 100% customizable through `VisualResolver` and `SvgNodeView`.
 */
export class SimplexSvgController<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  private readonly containerEl: HTMLElement;
  private readonly svgEl: SVGSVGElement;
  private readonly adapter: SvgRendererAdapter<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  >;
  private readonly engine: SimplexGraphEngine<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onFpsUpdate?: (fps: number) => void;
  private onZoomStateChangeCallback?: (state: SimplexZoomState) => void;
  private onLegendChangeCallback?: (
    model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ) => void;
  private lastEmittedLegendSig: string | null = null;
  private readonly focusOnClusterClick: boolean;
  private readonly focusOnTriangleClick: boolean;
  private showZoomBreadcrumbs: boolean;
  private readonly getIdExtractor: (item: TItem) => string;
  private getLabelExtractor?: (item: TItem) => string;
  private readonly formatTagLabelFn?: (tag: string) => string;
  private badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  private getShapeOption?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  private shapeOptions?: GeometricShapeSvgViewOptions;
  private usesCustomContentView: boolean;
  private usesCustomClusterView: boolean;
  private tooltipOption: SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private tooltipEl: HTMLDivElement | null = null;
  private tooltipCleanup: (() => void) | null = null;
  private activeTooltipTargetKey: string | null = null;
  private activeTooltipSuppressed = false;
  private tooltipVisible = false;
  private breadcrumbOverlayEl: HTMLDivElement | null = null;
  private srAnnouncerEl: HTMLDivElement | null = null;
  private ariaLabel: string;
  private keyboardNavigationEnabled: boolean;
  private keyboardFocusTarget: SimplexKeyboardFocusTarget | null = null;
  private lastInteractionWasPointer = false;
  private lastAnnouncedZoomSig: string | null = null;
  private timelineController: SimplexTimelineController<TItem> | null = null;
  private timelineUnsubscribe: (() => void) | null = null;
  private readonly timelineStateListeners = new Set<
    (state: SimplexTimelineState<TItem> | null) => void
  >();
  private timelineOverlayEl: HTMLDivElement | null = null;
  private timelineUiRefs: {
    playBtn: HTMLButtonElement;
    prevBtn: HTMLButtonElement;
    nextBtn: HTMLButtonElement;
    scrubber: HTMLInputElement;
    labelEl: HTMLSpanElement;
    countEl: HTMLSpanElement;
  } | null = null;
  private timelineShowControls = true;
  private timelinePosition: 'bottom' | 'top' = 'bottom';
  private timelineAutoFinalSeed = true;
  private timelineAutoFinalSeedLayout: FinalSeededLayoutScaleMode | false = false;
  private baseEmptyClusterBehavior: EmptyClusterBehavior = 'normal';
  private timelineEmptyClusterBehavior: EmptyClusterBehavior | undefined = undefined;
  private timelineOnStateChange?: (state: SimplexTimelineState<TItem>) => void;
  private rawClusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  private rawLayoutStrategy?: SimplexLayoutStrategy;
  private lastTimelineActiveItems: readonly TItem[] | null = null;
  private lastExternalItemsRef: readonly TItem[];
  private fullCorpusItems: readonly TItem[];
  private focusedClusterUidState: string | null = null;
  private focusedTriangleIndexState: number | null = null;
  private currentPreset: SimplexVisualPreset;
  private currentTheme: SimplexTheme;
  private usesCustomVisualResolver: boolean;
  private readonly cameraProxy: CameraController;

  private rafId: number | null = null;
  private lastFrameTs = 0;
  private fpsSamples = 0;
  private fpsAccumMs = 0;
  private controllerBatchDepth = 0;
  private destroyed = false;

  // Centralized drag-to-pan, touch direction-locking, and multi-touch pinch-zoom state on root <svg>
  private touchScrollLockPx: number;
  private clickTolerancePx: number;
  private isDraggingPan = false;
  private panStarted = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private pointerOriginX = 0;
  private pointerOriginY = 0;
  private pointerMaxDisplacement = 0;
  private hasActiveGestureOrigin = false;
  private wasMultiTouchGesture = false;
  private touchScrollAxis: 'undecided' | 'vertical' | 'horizontal' | 'pinch' = 'undecided';
  private touchOriginX = 0;
  private touchOriginY = 0;
  private touchYieldedToScroll = false;
  private suppressNextClick = false;
  private suppressClickStartPos: { x: number; y: number } | null = null;
  private suppressClickEndPos: { x: number; y: number } | null = null;
  private suppressClickDeadline = 0;
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist: number | null = null;
  private pinchStartDist: number | null = null;
  private pinchHandledInGesture = false;
  private lastPinchMid: { x: number; y: number } | null = null;
  private wheelPinchAccum = 0;
  private wheelPinchCooldownUntil = 0;
  private fontLoadCleanup: (() => void) | null = null;
  private reducedMotionPreference: ReducedMotionPreference = 'auto';
  private reducedMotionActive = false;
  private reducedMotionMediaCleanup: (() => void) | null = null;
  private marqueeSelectionEnabled = true;
  private marqueeArmed = false;
  private isMarqueeSelecting = false;
  private marqueeStartX = 0;
  private marqueeStartY = 0;
  private marqueeCurrentX = 0;
  private marqueeCurrentY = 0;
  private marqueeOverlayGroup: SVGGElement | null = null;
  private marqueeRectEl: SVGRectElement | null = null;
  private pendingInitialViewport = false;
  private deferFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    containerEl: HTMLElement | string,
    options: SimplexSvgControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
  constructor(
    containerEl: HTMLElement | string,
    options: SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this.containerEl = resolveContainerElement(containerEl);
    this.onFpsUpdate = options.onFpsUpdate;
    this.onZoomStateChangeCallback = options.onZoomStateChange;
    this.onLegendChangeCallback = options.onLegendChange;
    this.focusOnClusterClick = options.focusOnClusterClick ?? true;
    this.focusOnTriangleClick = options.focusOnTriangleClick ?? true;
    this.showZoomBreadcrumbs = options.showZoomBreadcrumbs ?? true;
    this.getLabelExtractor = options.getLabel;
    this.formatTagLabelFn = options.formatTagLabel;
    this.badgeOptions = options.badgeOptions;
    this.getShapeOption = options.getShape;
    this.shapeOptions = options.shapeOptions;
    this.usesCustomContentView = options.contentView !== undefined;
    this.usesCustomClusterView = options.clusterView !== undefined;
    this.tooltipOption = options.tooltip ?? false;
    this.ariaLabel = options.ariaLabel?.trim() || DEFAULT_ARIA_LABEL;
    this.keyboardNavigationEnabled = options.keyboardNavigation ?? true;
    this.marqueeSelectionEnabled = options.marqueeSelection ?? true;
    this.reducedMotionPreference = options.reducedMotion ?? 'auto';
    this.reducedMotionActive = this.computeReducedMotionActive();
    this.getIdExtractor =
      options.getId ??
      ((item: TItem) =>
        typeof item === 'object' && item !== null && 'id' in item
          ? String((item as { readonly id: unknown }).id)
          : '');

    this.currentPreset = options.preset ?? 'geometric';
    this.currentTheme = options.theme ?? 'dark';
    this.usesCustomVisualResolver = options.visualResolver !== undefined;
    const presetViews = createPresetViews(this.currentPreset, {
      shapeOptions: this.shapeOptions,
    });
    const contentView = (options.contentView ??
      presetViews.contentView) as SvgNodeView<TContentVisual>;
    const clusterView = (options.clusterView ??
      presetViews.clusterView) as SvgNodeView<TClusterVisual>;
    const visualResolver = (options.visualResolver ??
      createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(this.currentPreset, {
        getLabel: this.getLabelExtractor,
        theme: this.currentTheme,
        formatTagLabel: this.formatTagLabelFn,
        badgeOptions: this.badgeOptions,
        getShape: this.getShapeOption,
      })) as VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;

    this.touchScrollLockPx =
      typeof options.touchScrollLockPx === 'number' &&
      Number.isFinite(options.touchScrollLockPx)
        ? Math.max(0, options.touchScrollLockPx)
        : 8;
    this.clickTolerancePx =
      typeof options.clickTolerancePx === 'number' &&
      Number.isFinite(options.clickTolerancePx)
        ? Math.max(0, options.clickTolerancePx)
        : 12;

    const doc = this.containerEl.ownerDocument;
    this.svgEl = doc.createElementNS(SVG_NS, 'svg');
    this.svgEl.setAttribute('width', '100%');
    this.svgEl.setAttribute('height', '100%');
    this.svgEl.style.display = 'block';
    this.syncSvgTouchAction();
    this.svgEl.style.userSelect = 'none';
    this.syncSvgAccessibilityAttributes();
    this.syncReducedMotionAttribute();
    this.containerEl.appendChild(this.svgEl);
    this.ensureSrAnnouncerElement();

    const measureContainerSize = (): { width: number; height: number } => {
      const rect = this.containerEl.getBoundingClientRect();
      const width = rect.width > 0 ? rect.width : this.containerEl.clientWidth;
      const height = rect.height > 0 ? rect.height : this.containerEl.clientHeight;
      return { width, height };
    };
    const measured = measureContainerSize();
    const hasInitialSize = measured.width > 40 && measured.height > 40;
    const initialW = hasInitialSize ? measured.width : 960;
    const initialH = hasInitialSize ? measured.height : 620;
    this.pendingInitialViewport = !hasInitialSize;
    const canObserveResize = typeof ResizeObserver !== 'undefined';
    const deferConfig = options.deferInitialLayout;
    const shouldDeferSolve =
      !hasInitialSize && Boolean(deferConfig) && canObserveResize;
    const deferFallbackTimeoutMs =
      typeof deferConfig === 'object' &&
      deferConfig !== null &&
      typeof deferConfig.fallbackTimeoutMs === 'number' &&
      Number.isFinite(deferConfig.fallbackTimeoutMs) &&
      deferConfig.fallbackTimeoutMs > 0
        ? deferConfig.fallbackTimeoutMs
        : null;

    const ariaIdPrefix = `sv-a11y-${++nextA11yInstanceSeq}`;
    this.adapter = new SvgRendererAdapter<
      TContentVisual,
      TClusterVisual,
      TItem,
      TTagMeta,
      TClusterMeta
    >(this.svgEl, {
      contentView,
      clusterView,
      triangleView: options.triangleView,
      edgeView: options.edgeView,
      theme: this.currentTheme,
      ariaIdPrefix,
      ariaMetadataResolver: this.buildAriaMetadataResolver(),
    });

    this.rawClusteringStrategy = options.clusteringStrategy;
    this.rawLayoutStrategy = options.layoutStrategy;
    this.baseEmptyClusterBehavior = options.emptyClusterBehavior ?? 'normal';
    this.lastExternalItemsRef = options.items;
    this.fullCorpusItems = options.items.slice();

    if (options.timeline) {
      const timelineOpts: TimelinePlayerOptions<TItem> =
        options.timeline === true ? {} : options.timeline;
      this.timelineShowControls = timelineOpts.showControls ?? true;
      this.timelinePosition = timelineOpts.position ?? 'bottom';
      this.timelineAutoFinalSeed = timelineOpts.autoFinalSeed ?? true;
      this.timelineAutoFinalSeedLayout = this.normalizeAutoFinalSeedLayout(
        timelineOpts.autoFinalSeedLayout,
      );
      this.timelineEmptyClusterBehavior = timelineOpts.emptyClusterBehavior;
      this.timelineOnStateChange = timelineOpts.onStateChange;
      this.timelineController = createSimplexTimeline(
        this.fullCorpusItems,
        timelineOpts,
      );
      this.lastTimelineActiveItems = this.timelineController.getActiveItems();
    }

    const initialItems = this.timelineController
      ? this.timelineController.getActiveItems()
      : options.items;
    const initialClusteringStrategy = this.resolveEffectiveClusteringStrategy(
      this.rawClusteringStrategy,
      this.fullCorpusItems,
    );
    const initialLayoutStrategy = this.resolveEffectiveLayoutStrategy(
      this.rawLayoutStrategy,
    );
    const effectiveEmptyClusterBehavior =
      this.timelineController && this.timelineEmptyClusterBehavior !== undefined
        ? this.timelineEmptyClusterBehavior
        : this.baseEmptyClusterBehavior;

    this.engine = SimplexGraphEngine.createFromResolved({
      items: initialItems,
      getId: options.getId,
      getTags: options.getTags,
      deriveClusterMeta: options.deriveClusterMeta,
      visualResolver,
      renderer: this.adapter,
      viewportWidth: initialW,
      viewportHeight: initialH,
      normalizeTag: options.normalizeTag,
      formatTagLabel: options.formatTagLabel,
      resolveTagMeta: options.resolveTagMeta,
      meshOptions: options.meshOptions,
      layoutOptions: options.layoutOptions,
      meshStrategy: options.meshStrategy,
      clusteringStrategy: initialClusteringStrategy,
      colorStrategy: options.colorStrategy,
      layoutStrategy: initialLayoutStrategy,
      zoomStrategy: options.zoomStrategy,
      theme: this.currentTheme,
      showHulls: options.showHulls,
      emptyClusterBehavior: effectiveEmptyClusterBehavior,
      itemFilter: options.itemFilter,
      itemFilterMode: options.itemFilterMode,
      canonicalSeedItems: this.timelineController ? this.fullCorpusItems : undefined,
      deferInitialSolve: shouldDeferSolve,
      reducedMotion: this.reducedMotionActive,
      selectedIds: options.selectedIds,
      shiftClickSelects: options.shiftClickSelects,
      interactions: this.wrapInteractions(options.interactions),
      onMetricsChange: options.onMetricsChange,
      onClustersChange: options.onClustersChange,
      onSelectionChange: options.onSelectionChange,
      onLegendChange: (model) => {
        this.emitControllerLegendChange(model);
      },
      onZoomStateChange: (state) => {
        this.syncZoomOverlays(state);
        this.handleZoomStateAccessibility(state);
        this.onZoomStateChangeCallback?.(state);
      },
    });
    if (!shouldDeferSolve) {
      // Refresh first rendered frame with live engine-backed ARIA labels on clusters/items/triangles
      this.engine.renderNow();
    }
    const initialZoomState = this.engine.getZoomState();
    this.lastAnnouncedZoomSig = this.computeZoomAnnouncementSig(initialZoomState);
    this.syncZoomOverlays(initialZoomState);
    this.onZoomStateChangeCallback?.(initialZoomState);
    if (this.timelineController) {
      this.attachTimelineController(this.timelineController);
    }

    const baseCamera = this.engine.camera;
    const syncCameraRender = (): void => {
      if (this.destroyed) return;
      this.engine.renderNow();
    };
    this.cameraProxy = {
      getState: () => baseCamera.getState(),
      setState: (next) => {
        baseCamera.setState(next);
        syncCameraRender();
      },
      zoomToCursor: (screenX, screenY, zoomFactor) => {
        baseCamera.zoomToCursor(screenX, screenY, zoomFactor);
        syncCameraRender();
      },
      panBy: (dx, dy) => {
        baseCamera.panBy(dx, dy);
        syncCameraRender();
      },
      reset: () => {
        baseCamera.reset();
        syncCameraRender();
      },
      screenToWorld: (screenX, screenY) => baseCamera.screenToWorld(screenX, screenY),
      worldToScreen: (worldX, worldY) => baseCamera.worldToScreen(worldX, worldY),
    };

    this.attachSvgListeners();
    this.syncReducedMotionMediaSubscription();

    if (canObserveResize) {
      this.resizeObserver = new ResizeObserver((entries) => {
        if (this.destroyed) return;
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 40 && height > 40) {
            if (this.pendingInitialViewport) {
              this.pendingInitialViewport = false;
              this.clearDeferFallbackTimer();
              this.adapter.invalidateHulls();
              this.engine.reinitializeViewport(width, height);
              this.ensureLoopRunning();
            } else {
              this.engine.setViewport(width, height);
              this.ensureLoopRunning();
            }
          }
        }
      });
      this.resizeObserver.observe(this.containerEl);
    }

    if (shouldDeferSolve && deferFallbackTimeoutMs !== null) {
      this.deferFallbackTimer = setTimeout(() => {
        this.deferFallbackTimer = null;
        if (this.destroyed || !this.pendingInitialViewport) return;
        const latest = measureContainerSize();
        this.adapter.invalidateHulls();
        if (latest.width > 40 && latest.height > 40) {
          this.pendingInitialViewport = false;
          this.engine.reinitializeViewport(latest.width, latest.height);
        } else {
          // Run provisional fallback solve while keeping `pendingInitialViewport = true`
          // so a subsequent real `ResizeObserver` size still cleanly re-initializes.
          this.engine.reinitializeViewport(960, 620);
        }
        this.ensureLoopRunning();
      }, deferFallbackTimeoutMs);
    }

    if (options.relayoutOnFontLoad !== false) {
      this.attachFontLoadListener();
    }

    if (!shouldDeferSolve) {
      this.ensureLoopRunning();
    }
  }

  static createFromResolved<
    TItem = DefaultTaggedItem,
    TContentVisual = DefaultContentPresetVisual,
    TClusterVisual = DefaultClusterPresetVisual,
    TTagMeta = undefined,
    TClusterMeta = undefined,
  >(
    containerEl: HTMLElement | string,
    options: SimplexSvgControllerResolvedOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return new (SimplexSvgController as unknown as new (
      el: HTMLElement | string,
      opts: SimplexSvgControllerResolvedOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ) => SimplexSvgController<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >)(containerEl, options);
  }

  private wrapInteractions(
    userInteractions?: InteractionHandlers<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return {
      onContentHover: (ev) => {
        const consumed = userInteractions?.onContentHover?.(ev);
        if (ev && consumed !== true) {
          this.showTooltipForTarget({ kind: 'content', ...ev });
        } else {
          this.hideTooltip();
        }
        return consumed;
      },
      onClusterHover: (ev) => {
        const consumed = userInteractions?.onClusterHover?.(ev);
        if (ev && consumed !== true) {
          this.showTooltipForTarget({ kind: 'cluster', ...ev });
        } else {
          this.hideTooltip();
        }
        return consumed;
      },
      onTriangleHover: (ev) => {
        const consumed = userInteractions?.onTriangleHover?.(ev);
        if (ev && consumed !== true) {
          this.showTooltipForTarget({ kind: 'triangle', ...ev });
        } else {
          this.hideTooltip();
        }
        return consumed;
      },
      onLeftClick: (target, rawEvent) => {
        if (target.kind === 'content' && !target.neighborId) {
          if (userInteractions?.onContentClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'cluster') {
          if (userInteractions?.onClusterClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'triangle') {
          if (userInteractions?.onTriangleClick?.(target, rawEvent) === true) {
            return true;
          }
        } else if (target.kind === 'background') {
          if (userInteractions?.onBackgroundClick?.(rawEvent) === true) {
            return true;
          }
        }
        if (userInteractions?.onLeftClick?.(target, rawEvent) === true) {
          return true;
        }
        if (this.engine.getZoomStrategy().mode === 'drill-down') {
          if (target.kind === 'triangle') {
            if (target.triangle.neighborId) {
              this.drillToNeighbor(target.triangle.neighborId);
            } else if (!target.triangle.isContext) {
              this.drillDownTriangle(target.triangle.index);
            }
          } else if (target.kind === 'cluster') {
            if (target.neighborId) {
              this.drillToNeighbor(target.neighborId);
            } else {
              this.drillDownCluster(target.cluster.clusterUid);
            }
          } else if (target.kind === 'content' && target.neighborId) {
            this.drillToNeighbor(target.neighborId);
          } else if (target.kind === 'background') {
            if (this.engine.getZoomState().canDrillUp) {
              this.drillUp();
            } else if (!rawEvent.shiftKey && this.engine.getSelectedIds().size > 0) {
              this.clearSelection();
            }
          }
          return false;
        }
        if (target.kind === 'cluster' && this.focusOnClusterClick) {
          if (this.focusedTriangleIndexState !== null) {
            this.setFocusedTriangleIndex(null);
          }
          const next =
            this.focusedClusterUidState === target.cluster.clusterUid
              ? null
              : target.cluster.clusterUid;
          this.setFocusedClusterUid(next);
        } else if (target.kind === 'triangle' && this.focusOnTriangleClick) {
          if (this.focusedClusterUidState !== null) {
            this.setFocusedClusterUid(null);
          }
          const next =
            this.focusedTriangleIndexState === target.triangle.index
              ? null
              : target.triangle.index;
          this.setFocusedTriangleIndex(next);
        } else if (target.kind === 'background') {
          if (this.focusedClusterUidState !== null) {
            this.setFocusedClusterUid(null);
          }
          if (this.focusedTriangleIndexState !== null) {
            this.setFocusedTriangleIndex(null);
          }
          if (this.engine.getFocusedItemId() !== null) {
            this.focusItem(null);
          }
          if (!rawEvent.shiftKey && this.engine.getSelectedIds().size > 0) {
            this.clearSelection();
          }
        }
        return false;
      },
      onRightClick: userInteractions?.onRightClick,
      onWheel: userInteractions?.onWheel ?? 'zoom-to-cursor',
    };
  }

  private attachFontLoadListener(): void {
    const doc = this.containerEl.ownerDocument;
    const fontSet = doc?.fonts;
    if (!fontSet) return;

    let readyTriggeredByEvent = false;
    let readyTimedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const onLoadingDone = (): void => {
      if (this.destroyed) return;
      readyTriggeredByEvent = true;
      this.relayout();
    };

    if (typeof fontSet.addEventListener === 'function') {
      fontSet.addEventListener('loadingdone', onLoadingDone);
    }

    if (fontSet.status !== 'loaded' && fontSet.ready && typeof fontSet.ready.then === 'function') {
      timeoutId = setTimeout(() => {
        readyTimedOut = true;
        timeoutId = null;
      }, 2000);
      fontSet.ready.then(
        () => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (this.destroyed || readyTimedOut || readyTriggeredByEvent) return;
          this.relayout();
        },
        () => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        },
      );
    }

    this.fontLoadCleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (typeof fontSet.removeEventListener === 'function') {
        fontSet.removeEventListener('loadingdone', onLoadingDone);
      }
    };
  }

  private formatContentTooltip(
    ev: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
  ): string | null | undefined | false {
    if (typeof this.tooltipOption === 'function') {
      return this.tooltipOption({ kind: 'content', ...ev });
    }
    const label = extractDefaultItemLabel(
      ev.item,
      ev.layoutContext.id,
      this.getLabelExtractor,
    );
    const tagList = ev.layoutContext.tags
      .map((t) => {
        if (t.label) return t.label;
        if (this.formatTagLabelFn) {
          const formatted = this.formatTagLabelFn(t.tag).trim();
          if (formatted.length > 0) return formatted;
        }
        return `#${t.tag}`;
      })
      .slice(0, 5)
      .join(' · ');
    const neighborHint = ev.neighborId ? '\nClick to switch to neighbor' : '';
    if (tagList) {
      return `${label}\n${tagList}${neighborHint}`;
    }
    const weightList = ev.layoutContext.unitClusters
      .map((uc) => `${uc.cluster.code} ${Math.round(uc.weight * 100)}%`)
      .join(' · ');
    return `${weightList ? `${label}\n${weightList}` : label}${neighborHint}`;
  }

  private formatClusterTooltip(
    ev: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
  ): string | null | undefined | false {
    if (typeof this.tooltipOption === 'function') {
      return this.tooltipOption({ kind: 'cluster', ...ev });
    }
    const count = ev.cluster.members.length;
    const base = `${ev.cluster.code} · ${ev.cluster.defaultLabel}\n${count} ${count === 1 ? 'item' : 'items'}`;
    return ev.neighborId ? `${base}\nClick to switch to neighbor` : base;
  }

  private formatTriangleTooltip(
    ev: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta>,
  ): string | null | undefined | false {
    if (typeof this.tooltipOption === 'function') {
      return this.tooltipOption({ kind: 'triangle', ...ev });
    }
    const corners = ev.triangle.clusters
      .map((c, idx) =>
        c ? c.code : `V${ev.triangle.vertexIndices[idx] ?? idx}`,
      )
      .join(' · ');
    const count = ev.triangle.coveredItemCount;
    if (ev.triangle.isContext) {
      return `Neighbor (${corners})\n${count} ${count === 1 ? 'item' : 'items'}${ev.triangle.neighborId ? '\nClick to switch to neighbor' : ''}`;
    }
    const zMode = this.engine.getZoomStrategy().mode;
    const zState = this.engine.getZoomState();
    const actionHint =
      zMode === 'drill-down'
        ? zState.activeFrameKind === 'triangle-focus' && zState.canDrillUp
          ? '\nClick to zoom out'
          : zState.drillableTriangleIndices.includes(ev.triangle.index)
            ? '\nClick to zoom in'
            : zState.focusableTriangleIndices.includes(ev.triangle.index)
              ? '\nClick to focus triangle'
              : ''
        : '';
    return `Triangle #${ev.triangle.index + 1} (${corners})\n${count} ${count === 1 ? 'item' : 'items'}${actionHint}`;
  }

  private isTooltipUnstyled(): boolean {
    return isDomTooltipRenderer(this.tooltipOption) && this.tooltipOption.unstyled !== false;
  }

  private applyTooltipThemeStyles(el: HTMLDivElement): void {
    if (this.isTooltipUnstyled()) return;
    const isLight = this.currentTheme === 'light';
    el.style.background = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9, 13, 22, 0.94)';
    el.style.border = isLight
      ? '1px solid rgba(203, 213, 225, 0.95)'
      : '1px solid rgba(51, 65, 85, 0.85)';
    el.style.color = isLight ? '#0f172a' : '#f1f5f9';
    el.style.boxShadow = isLight
      ? '0 10px 24px rgba(15, 23, 42, 0.12)'
      : '0 10px 24px rgba(0, 0, 0, 0.45)';
  }

  private applyTooltipPresentationStyles(el: HTMLDivElement): void {
    const domRenderer = isDomTooltipRenderer(this.tooltipOption)
      ? this.tooltipOption
      : null;
    const customClass = domRenderer?.className?.trim();
    el.className = customClass ? `sv-tooltip ${customClass}` : 'sv-tooltip';
    el.setAttribute('role', 'tooltip');
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '20';

    if (this.isTooltipUnstyled()) {
      el.dataset.tooltipMode = 'custom';
      el.style.maxWidth = '';
      el.style.padding = '';
      el.style.borderRadius = '';
      el.style.fontFamily = '';
      el.style.fontSize = '';
      el.style.lineHeight = '';
      el.style.whiteSpace = '';
      el.style.background = '';
      el.style.border = '';
      el.style.color = '';
      el.style.boxShadow = '';
      return;
    }

    el.dataset.tooltipMode = 'styled';
    el.style.maxWidth = '240px';
    el.style.padding = '7px 10px';
    el.style.borderRadius = '8px';
    el.style.fontFamily = 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
    el.style.fontSize = '12px';
    el.style.lineHeight = '1.4';
    el.style.whiteSpace = domRenderer ? '' : 'pre-line';
    this.applyTooltipThemeStyles(el);
  }

  private ensureTooltipElement(): HTMLDivElement | null {
    if (!this.tooltipOption) return null;
    if (this.tooltipEl) return this.tooltipEl;

    const doc = this.containerEl.ownerDocument;
    const computedPos =
      typeof getComputedStyle !== 'undefined'
        ? getComputedStyle(this.containerEl).position
        : this.containerEl.style.position;
    if (!computedPos || computedPos === 'static') {
      this.containerEl.style.position = 'relative';
    }

    const el = doc.createElement('div');
    el.style.display = 'none';
    this.applyTooltipPresentationStyles(el);
    this.containerEl.appendChild(el);
    this.tooltipEl = el;
    return el;
  }

  private getTooltipTargetKey(
    target: SimplexSvgTooltipTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): string {
    if (target.kind === 'content') {
      return `content:${target.layoutContext.id}:${target.neighborId ?? ''}`;
    }
    if (target.kind === 'cluster') {
      return `cluster:${target.cluster.clusterUid}:${target.neighborId ?? ''}`;
    }
    return `triangle:${target.triangle.index}:${target.triangle.neighborId ?? ''}:${target.triangle.isContext ? 1 : 0}`;
  }

  private runTooltipCleanup(): void {
    const cleanup = this.tooltipCleanup;
    this.tooltipCleanup = null;
    if (cleanup) {
      cleanup();
    }
  }

  private positionTooltipElement(
    el: HTMLDivElement,
    screenX: number,
    screenY: number,
    measureUnconstrained = false,
  ): void {
    const domRenderer = isDomTooltipRenderer(this.tooltipOption)
      ? this.tooltipOption
      : null;
    const offsetX = domRenderer?.offset?.x ?? 14;
    const offsetY = domRenderer?.offset?.y ?? 14;
    const margin = Math.max(0, domRenderer?.margin ?? 8);

    if (measureUnconstrained) {
      el.style.left = '0px';
      el.style.top = '0px';
    }

    const containerRect =
      typeof this.containerEl.getBoundingClientRect === 'function'
        ? this.containerEl.getBoundingClientRect()
        : null;
    const containerW =
      this.containerEl.clientWidth || (containerRect ? Math.round(containerRect.width) : 0) || 960;
    const containerH =
      this.containerEl.clientHeight || (containerRect ? Math.round(containerRect.height) : 0) || 600;

    const tipRect =
      typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    const measuredW = el.offsetWidth || (tipRect ? Math.ceil(tipRect.width) : 0);
    const measuredH = el.offsetHeight || (tipRect ? Math.ceil(tipRect.height) : 0);
    const tipW = measuredW > 0 ? measuredW : 240;
    const tipH = measuredH > 0 ? measuredH : 64;

    const maxLeft = Math.max(margin, containerW - margin - tipW);
    let left = screenX + offsetX;
    if (left + tipW > containerW - margin) {
      left = screenX - offsetX - tipW;
    }
    left = Math.min(Math.max(margin, Math.round(left)), Math.round(maxLeft));

    const maxTop = Math.max(margin, containerH - margin - tipH);
    let top = screenY + offsetY;
    if (top + tipH > containerH - margin) {
      top = screenY - offsetY - tipH;
    }
    top = Math.min(Math.max(margin, Math.round(top)), Math.round(maxTop));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  private showTooltipForTarget(
    target: SimplexSvgTooltipTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    const el = this.ensureTooltipElement();
    if (!el) return;

    const targetKey = this.getTooltipTargetKey(target);

    if (isDomTooltipRenderer(this.tooltipOption)) {
      if (targetKey === this.activeTooltipTargetKey) {
        if (this.activeTooltipSuppressed) return;
        el.style.display = 'block';
        this.tooltipVisible = true;
        this.positionTooltipElement(el, target.screenPosition.x, target.screenPosition.y);
        return;
      }

      this.runTooltipCleanup();
      el.textContent = '';
      this.activeTooltipTargetKey = targetKey;

      const result = this.tooltipOption.render(target, el);
      if (result === false || result === null) {
        this.activeTooltipSuppressed = true;
        if (this.tooltipVisible) {
          el.style.display = 'none';
          this.tooltipVisible = false;
          this.tooltipOption.onHide?.(el);
        }
        return;
      }

      if (typeof result === 'function') {
        this.tooltipCleanup = result;
      }
      this.activeTooltipSuppressed = false;
      el.style.display = 'block';
      this.tooltipVisible = true;
      this.positionTooltipElement(
        el,
        target.screenPosition.x,
        target.screenPosition.y,
        true,
      );
      return;
    }

    const text =
      target.kind === 'content'
        ? this.formatContentTooltip(target)
        : target.kind === 'cluster'
          ? this.formatClusterTooltip(target)
          : this.formatTriangleTooltip(target);

    if (!text) {
      this.hideTooltip();
      return;
    }

    const targetChanged = targetKey !== this.activeTooltipTargetKey;
    this.activeTooltipTargetKey = targetKey;
    this.activeTooltipSuppressed = false;
    el.textContent = text;
    el.style.display = 'block';
    this.tooltipVisible = true;
    this.positionTooltipElement(
      el,
      target.screenPosition.x,
      target.screenPosition.y,
      targetChanged,
    );
  }

  private hideTooltip(): void {
    const domRenderer = isDomTooltipRenderer(this.tooltipOption)
      ? this.tooltipOption
      : null;
    const wasVisible = this.tooltipVisible;
    this.runTooltipCleanup();
    this.activeTooltipTargetKey = null;
    this.activeTooltipSuppressed = false;
    this.tooltipVisible = false;
    if (this.tooltipEl) {
      this.tooltipEl.style.display = 'none';
      if (wasVisible && domRenderer?.onHide) {
        domRenderer.onHide(this.tooltipEl);
      }
    }
  }

  get camera(): CameraController {
    return this.cameraProxy;
  }

  /** Active headless timeline controller when `timeline` is enabled, or `null` otherwise. */
  get timeline(): SimplexTimelineController<TItem> | null {
    return this.timelineController;
  }

  /** Returns the active headless timeline controller, or `null` when timeline mode is disabled. */
  getTimeline(): SimplexTimelineController<TItem> | null {
    return this.timelineController;
  }

  /**
   * Subscribes to timeline state changes (including enabling/disabling timeline mode at runtime).
   * Invokes `listener` immediately with the current state (or `null`) and returns an unsubscribe handle.
   */
  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void {
    this.timelineStateListeners.add(listener);
    listener(this.timelineController?.getState() ?? null);
    return () => {
      this.timelineStateListeners.delete(listener);
    };
  }

  /**
   * Dynamically enables, updates, or disables timeline playback at runtime.
   */
  setTimelineOptions(
    timeline: boolean | TimelinePlayerOptions<TItem> | undefined,
  ): void {
    if (this.destroyed) return;
    if (!timeline) {
      if (!this.timelineController) return;
      const hadAutoFinalSeed = this.timelineAutoFinalSeed;
      const hadAutoFinalSeedLayout = this.timelineAutoFinalSeedLayout !== false;
      this.batch(() => {
        this.detachTimelineController();
        this.timelineAutoFinalSeed = true;
        this.timelineAutoFinalSeedLayout = false;
        this.timelineEmptyClusterBehavior = undefined;
        this.lastTimelineActiveItems = null;
        this.syncTimelineOverlay(null);
        this.engine.setCanonicalSeedItems(null);
        if (this.rawClusteringStrategy) {
          this.engine.setClusteringStrategy(this.rawClusteringStrategy);
        } else if (hadAutoFinalSeed) {
          this.engine.setClusteringStrategy(
            createSoftSimplexTagClusteringStrategy<TItem, TTagMeta>(),
          );
        }
        if (hadAutoFinalSeedLayout) {
          this.engine.setLayoutStrategy(
            this.rawLayoutStrategy ?? createCollisionDrivenLayoutStrategy(),
          );
        }
        this.engine.setEmptyClusterBehavior(this.baseEmptyClusterBehavior);
        this.engine.setItems(this.fullCorpusItems);
      });
      this.notifyTimelineListeners(null);
      return;
    }

    const opts: TimelinePlayerOptions<TItem> = timeline === true ? {} : timeline;
    const prevAutoFinalSeed = this.timelineAutoFinalSeed;
    const prevAutoFinalSeedLayout = this.timelineAutoFinalSeedLayout;
    this.timelineShowControls = opts.showControls ?? true;
    this.timelinePosition = opts.position ?? 'bottom';
    this.timelineAutoFinalSeed = opts.autoFinalSeed ?? true;
    this.timelineAutoFinalSeedLayout = this.normalizeAutoFinalSeedLayout(
      opts.autoFinalSeedLayout,
    );
    this.timelineEmptyClusterBehavior = opts.emptyClusterBehavior;
    this.timelineOnStateChange = opts.onStateChange;

    this.batch(() => {
      this.detachTimelineController();
      this.timelineController = createSimplexTimeline(this.fullCorpusItems, opts);
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      const effectiveClustering = this.resolveEffectiveClusteringStrategy(
        this.rawClusteringStrategy,
        this.fullCorpusItems,
      );
      if (effectiveClustering) {
        this.engine.setClusteringStrategy(effectiveClustering);
      } else if (prevAutoFinalSeed) {
        this.engine.setClusteringStrategy(
          createSoftSimplexTagClusteringStrategy<TItem, TTagMeta>(),
        );
      }
      const effectiveLayout = this.resolveEffectiveLayoutStrategy(this.rawLayoutStrategy);
      if (effectiveLayout) {
        this.engine.setLayoutStrategy(effectiveLayout);
      } else if (prevAutoFinalSeedLayout !== false) {
        this.engine.setLayoutStrategy(
          this.rawLayoutStrategy ?? createCollisionDrivenLayoutStrategy(),
        );
      }
      this.engine.setEmptyClusterBehavior(
        this.timelineEmptyClusterBehavior ?? this.baseEmptyClusterBehavior,
      );
      const activeItems = this.timelineController.getActiveItems();
      this.lastTimelineActiveItems = activeItems;
      this.engine.setItems(activeItems);
      this.attachTimelineController(this.timelineController);
    });
    this.emitControllerLegendChange();
  }

  getSvgElement(): SVGSVGElement {
    return this.svgEl;
  }

  getMetrics(): LayoutMetrics {
    return this.engine.getMetrics();
  }

  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] {
    return this.engine.getClusters();
  }

  /**
   * Returns a structured legend model synchronized with the active zoom/drill-down frame,
   * item filter counts, `emptyClusterBehavior`, focused cluster, and active timeline step.
   */
  getLegendModel(
    options?: SimplexLegendModelOptions,
  ): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> {
    const base = this.engine.getLegendModel(options);
    const timelineStep = this.timelineController
      ? this.timelineController.getState().step
      : null;
    return timelineStep === base.timelineStep
      ? base
      : { ...base, timelineStep };
  }

  /** Updates the structured legend model change listener at runtime. */
  setOnLegendChange(
    cb?: (model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>) => void,
  ): void {
    this.onLegendChangeCallback = cb;
    this.lastEmittedLegendSig = null;
  }

  private computeLegendSignature(
    model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ): string {
    const entrySig = model.entries
      .map(
        (e: SimplexLegendEntry<TItem, TTagMeta, TClusterMeta>) =>
          `${e.clusterUid}|${e.code}|${e.label}|${e.parentContextLabel ?? ''}|${e.colorHex}|${e.totalCount}|${e.visibleCount}|${e.isEmpty ? 1 : 0}|${e.isHidden ? 1 : 0}|${e.isFocused ? 1 : 0}|${e.isContext ? 1 : 0}|${e.isMidpoint ? 1 : 0}`,
      )
      .join(';');
    return `${model.zoomDepth}|${model.totalItems}|${model.visibleItems}|${model.hasActiveFilter ? 1 : 0}|${model.itemFilterMode}|${model.emptyClusterBehavior}|${model.focusedClusterUid ?? ''}|${model.timelineStep ?? ''}|${entrySig}`;
  }

  private emitControllerLegendChange(
    engineModel?: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ): void {
    if (this.destroyed || !this.onLegendChangeCallback) return;
    const base = engineModel ?? this.engine?.getLegendModel();
    if (!base) return;
    const timelineStep = this.timelineController
      ? this.timelineController.getState().step
      : null;
    const model =
      timelineStep === base.timelineStep ? base : { ...base, timelineStep };
    const sig = this.computeLegendSignature(model);
    if (sig === this.lastEmittedLegendSig) return;
    this.lastEmittedLegendSig = sig;
    this.onLegendChangeCallback(model);
  }

  getItems(): readonly TItem[] {
    return this.engine.getItems();
  }

  addItems(items: TItem | readonly TItem[]): void {
    const incoming = Array.isArray(items) ? (items as readonly TItem[]) : [items as TItem];
    if (incoming.length === 0) return;

    const byId = new Map<string, number>();
    const merged = this.fullCorpusItems.slice();
    merged.forEach((item, idx) => {
      const id = this.getIdExtractor(item);
      if (id) byId.set(id, idx);
    });
    for (const item of incoming) {
      const id = this.getIdExtractor(item);
      if (id && byId.has(id)) {
        merged[byId.get(id)!] = item;
      } else {
        if (id) byId.set(id, merged.length);
        merged.push(item);
      }
    }
    this.fullCorpusItems = merged;
    this.lastExternalItemsRef = merged;

    if (this.timelineController) {
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.syncFinalSeededClusteringForCorpus(this.fullCorpusItems);
      this.timelineController.setItems(this.fullCorpusItems);
      this.ensureLoopRunning();
      return;
    }

    this.engine.addItems(items);
    this.ensureLoopRunning();
  }

  removeItems(ids: string | readonly string[]): void {
    const idList = Array.isArray(ids) ? (ids as readonly string[]) : [ids as string];
    const removeSet = new Set(idList);
    if (removeSet.size === 0) return;

    const filtered = this.fullCorpusItems.filter(
      (item) => !removeSet.has(this.getIdExtractor(item)),
    );
    this.fullCorpusItems = filtered;
    this.lastExternalItemsRef = filtered;

    if (this.timelineController) {
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.syncFinalSeededClusteringForCorpus(this.fullCorpusItems);
      this.timelineController.setItems(this.fullCorpusItems);
      this.ensureLoopRunning();
      return;
    }

    this.engine.removeItems(ids);
    this.ensureLoopRunning();
  }

  setItems(items: readonly TItem[]): void {
    if (this.timelineController) {
      if (items === this.lastExternalItemsRef) {
        return;
      }
      this.lastExternalItemsRef = items;
      this.fullCorpusItems = items.slice();
      this.engine.setCanonicalSeedItems(this.fullCorpusItems);
      this.syncFinalSeededClusteringForCorpus(this.fullCorpusItems);
      this.timelineController.setItems(this.fullCorpusItems);
      this.ensureLoopRunning();
      return;
    }
    this.lastExternalItemsRef = items;
    this.fullCorpusItems = items.slice();
    this.engine.setItems(items);
    this.ensureLoopRunning();
  }

  /**
   * Switches between built-in presets (`'geometric'`, `'glyphs'`, `'badges'`) with smooth
   * morph/crossfade transitions.
   */
  setPreset(preset: SimplexVisualPreset, getLabel?: (item: TItem) => string): void {
    this.currentPreset = preset;
    if (getLabel !== undefined) {
      this.getLabelExtractor = getLabel;
    }
    const views = createPresetViews(preset, { shapeOptions: this.shapeOptions });
    const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(preset, {
      getLabel: this.getLabelExtractor,
      theme: this.currentTheme,
      formatTagLabel: this.formatTagLabelFn,
      badgeOptions: this.badgeOptions,
      getShape: this.getShapeOption,
    });
    this.adapter.setViews({
      contentView: views.contentView as unknown as SvgNodeView<TContentVisual>,
      clusterView: views.clusterView as unknown as SvgNodeView<TClusterVisual>,
    });
    this.engine.setVisualResolver(
      resolver as unknown as VisualResolver<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    );
    this.ensureLoopRunning();
  }

  /**
   * Updates lightweight hover, dimming, and stroke styling options on the built-in
   * `GeometricShapeSvgView` (applies to `'geometric'` and `'badges'` presets when no
   * custom `contentView` is provided).
   */
  setShapeOptions(shapeOptions?: GeometricShapeSvgViewOptions): void {
    this.shapeOptions = shapeOptions;
    if (!this.usesCustomContentView && this.currentPreset !== 'glyphs') {
      const contentView = new GeometricShapeSvgView(
        this.shapeOptions,
      ) as unknown as SvgNodeView<TContentVisual>;
      this.adapter.setViews({ contentView });
      this.adapter.invalidateHulls();
      this.engine.relayout();
      this.ensureLoopRunning();
    }
  }

  /**
   * Executes `fn` inside a re-entrant batch transaction so multiple sequential controller
   * setter calls coalesce into at most one pipeline/layout solve and one SVG render pass.
   */
  batch<TResult>(fn: () => TResult): TResult {
    this.controllerBatchDepth += 1;
    try {
      return this.engine.batch(fn);
    } finally {
      this.controllerBatchDepth -= 1;
      if (this.controllerBatchDepth === 0) {
        this.ensureLoopRunning();
      }
    }
  }

  /**
   * Atomically applies any combination of theme, preset, styling options, views,
   * filters, strategies, or interaction settings in a single coalesced layout and render pass.
   */
  setOptions(
    options: SimplexSvgUpdateOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    if (this.destroyed) return;
    let shouldSyncZoomOverlays = false;
    let shouldSyncTimelineOverlay = false;

    this.batch(() => {
      let needsRenderNow = false;
      let needsHullInvalidation = false;
      let presetChanged = false;
      let themeChanged = false;
      let resolverInputsChanged = false;
      let shapeOptionsChanged = false;

      if (options.preset !== undefined && options.preset !== this.currentPreset) {
        this.currentPreset = options.preset;
        presetChanged = true;
        resolverInputsChanged = true;
      }
      if ('getLabel' in options && options.getLabel !== this.getLabelExtractor) {
        this.getLabelExtractor = options.getLabel;
        resolverInputsChanged = true;
      }
      if ('badgeOptions' in options && options.badgeOptions !== this.badgeOptions) {
        this.badgeOptions = options.badgeOptions;
        resolverInputsChanged = true;
        needsHullInvalidation = true;
      }
      if ('getShape' in options && options.getShape !== this.getShapeOption) {
        this.getShapeOption = options.getShape;
        resolverInputsChanged = true;
        needsHullInvalidation = true;
      }
      if ('shapeOptions' in options && options.shapeOptions !== this.shapeOptions) {
        this.shapeOptions = options.shapeOptions;
        shapeOptionsChanged = true;
      }
      if (options.theme !== undefined && options.theme !== this.currentTheme) {
        this.currentTheme = options.theme;
        themeChanged = true;
        resolverInputsChanged = true;
        shouldSyncZoomOverlays = true;
        shouldSyncTimelineOverlay = true;
        if (this.tooltipEl) {
          this.applyTooltipThemeStyles(this.tooltipEl);
        }
        this.adapter.setTheme(options.theme);
        this.engine.setTheme(options.theme);
        needsRenderNow = true;
      }

      // Views: rebuild preset views at most once and merge explicit view overrides
      const viewPatch: Partial<
        Omit<
          SvgRendererOptions<
            TContentVisual,
            TClusterVisual,
            TItem,
            TTagMeta,
            TClusterMeta
          >,
          'theme'
        >
      > = {};
      let hasViewPatch = false;

      if ('contentView' in options) {
        if (options.contentView === null) {
          this.usesCustomContentView = false;
        } else if (options.contentView !== undefined) {
          this.usesCustomContentView = true;
          (viewPatch as { contentView?: SvgNodeView<TContentVisual> }).contentView =
            options.contentView;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
      }
      if ('clusterView' in options) {
        if (options.clusterView === null) {
          this.usesCustomClusterView = false;
        } else if (options.clusterView !== undefined) {
          this.usesCustomClusterView = true;
          (viewPatch as { clusterView?: SvgNodeView<TClusterVisual> }).clusterView =
            options.clusterView;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
      }

      const needPresetContentView =
        !this.usesCustomContentView &&
        (presetChanged ||
          options.contentView === null ||
          (shapeOptionsChanged && this.currentPreset !== 'glyphs'));
      const needPresetClusterView =
        !this.usesCustomClusterView &&
        (presetChanged || options.clusterView === null);

      if (needPresetContentView || needPresetClusterView) {
        const presetViews = createPresetViews(this.currentPreset, {
          shapeOptions: this.shapeOptions,
        });
        if (needPresetContentView) {
          (viewPatch as { contentView?: SvgNodeView<TContentVisual> }).contentView =
            presetViews.contentView as unknown as SvgNodeView<TContentVisual>;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
        if (needPresetClusterView) {
          (viewPatch as { clusterView?: SvgNodeView<TClusterVisual> }).clusterView =
            presetViews.clusterView as unknown as SvgNodeView<TClusterVisual>;
          hasViewPatch = true;
          needsHullInvalidation = true;
        }
      }

      if (options.triangleView !== undefined) {
        (
          viewPatch as {
            triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
          }
        ).triangleView = options.triangleView;
        hasViewPatch = true;
        needsRenderNow = true;
      }
      if (options.edgeView !== undefined) {
        (
          viewPatch as {
            edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
          }
        ).edgeView = options.edgeView;
        hasViewPatch = true;
        needsRenderNow = true;
      }

      if (hasViewPatch) {
        this.adapter.setViews(viewPatch);
        needsRenderNow = true;
      }
      if (needsHullInvalidation) {
        this.adapter.invalidateHulls();
      }

      // Visual resolver: rebuild at most once
      let didUpdateResolver = false;
      if ('visualResolver' in options) {
        if (options.visualResolver === null) {
          this.usesCustomVisualResolver = false;
          const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
            this.currentPreset,
            {
              getLabel: this.getLabelExtractor,
              theme: this.currentTheme,
              formatTagLabel: this.formatTagLabelFn,
              badgeOptions: this.badgeOptions,
              getShape: this.getShapeOption,
            },
          );
          this.engine.setVisualResolver(
            resolver as unknown as VisualResolver<
              TItem,
              TContentVisual,
              TClusterVisual,
              TTagMeta,
              TClusterMeta
            >,
          );
          didUpdateResolver = true;
          needsRenderNow = true;
        } else if (options.visualResolver !== undefined) {
          this.usesCustomVisualResolver = true;
          this.engine.setVisualResolver(options.visualResolver);
          didUpdateResolver = true;
          needsRenderNow = true;
        }
      } else if (!this.usesCustomVisualResolver && resolverInputsChanged) {
        const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
          this.currentPreset,
          {
            getLabel: this.getLabelExtractor,
            theme: this.currentTheme,
            formatTagLabel: this.formatTagLabelFn,
            badgeOptions: this.badgeOptions,
            getShape: this.getShapeOption,
          },
        );
        this.engine.setVisualResolver(
          resolver as unknown as VisualResolver<
            TItem,
            TContentVisual,
            TClusterVisual,
            TTagMeta,
            TClusterMeta
          >,
        );
        didUpdateResolver = true;
        needsRenderNow = true;
      }

      if (needsHullInvalidation && !didUpdateResolver) {
        this.engine.relayout();
        needsRenderNow = true;
      }

      // Core solver & strategy options
      if (options.meshOptions !== undefined) {
        this.engine.setMeshOptions(options.meshOptions);
      }
      if (options.layoutOptions !== undefined) {
        const mergedLayout =
          options.sizeMultiplier !== undefined
            ? { ...options.layoutOptions, sizeMultiplier: options.sizeMultiplier }
            : options.layoutOptions;
        this.engine.setLayoutOptions(mergedLayout);
      } else if (options.sizeMultiplier !== undefined) {
        this.engine.setSizeMultiplier(options.sizeMultiplier);
      }
      if (options.meshStrategy !== undefined) {
        this.engine.setMeshStrategy(options.meshStrategy);
      }
      if (options.clusteringStrategy !== undefined) {
        this.setClusteringStrategy(options.clusteringStrategy);
      }
      if (options.colorStrategy !== undefined) {
        this.engine.setColorStrategy(options.colorStrategy);
        needsRenderNow = true;
      }
      if (options.layoutStrategy !== undefined) {
        this.setLayoutStrategy(options.layoutStrategy);
      }
      if (options.zoomStrategy !== undefined) {
        this.engine.setZoomStrategy(options.zoomStrategy);
        shouldSyncZoomOverlays = true;
      }

      // Presentation, filter, timeline, items & interaction options
      if (options.showHulls !== undefined) {
        this.engine.setShowHulls(options.showHulls);
        needsRenderNow = true;
      }
      if (options.emptyClusterBehavior !== undefined) {
        this.setEmptyClusterBehavior(options.emptyClusterBehavior);
      }
      if ('itemFilter' in options || 'itemFilterMode' in options) {
        const currentFilter = this.engine.getItemFilter();
        const nextPredicate =
          'itemFilter' in options
            ? (options.itemFilter ?? null)
            : currentFilter.predicate;
        const nextMode = options.itemFilterMode ?? currentFilter.mode;
        this.engine.setItemFilter(nextPredicate, { mode: nextMode });
      }
      if (options.pinnedIds !== undefined) {
        this.engine.setPinnedIds(options.pinnedIds);
        needsRenderNow = true;
      }
      if ('highlightedIds' in options) {
        this.engine.setHighlightedIds(options.highlightedIds ?? null);
        needsRenderNow = true;
      }
      if ('highlightedItems' in options) {
        this.engine.setHighlightedItems(options.highlightedItems ?? null);
        needsRenderNow = true;
      }
      if ('onSelectionChange' in options) {
        this.engine.setOnSelectionChange(options.onSelectionChange);
      }
      if ('onLegendChange' in options) {
        this.setOnLegendChange(options.onLegendChange);
      }
      if ('selectedIds' in options) {
        this.engine.setSelectedIds(options.selectedIds ?? null);
        needsRenderNow = true;
      }
      if (options.marqueeSelection !== undefined) {
        this.setMarqueeSelection(options.marqueeSelection);
      }
      if (options.shiftClickSelects !== undefined) {
        this.setShiftClickSelects(options.shiftClickSelects);
      }
      if ('focusedItemId' in options) {
        this.engine.focusItem(options.focusedItemId ?? null);
        needsRenderNow = true;
      }
      if ('focusedClusterUid' in options) {
        this.setFocusedClusterUid(options.focusedClusterUid ?? null);
        needsRenderNow = true;
      }
      if ('focusedTriangleIndex' in options) {
        this.setFocusedTriangleIndex(options.focusedTriangleIndex ?? null);
        needsRenderNow = true;
      }
      if (options.tooltip !== undefined) {
        this.setTooltip(options.tooltip);
      }
      if (options.ariaLabel !== undefined) {
        this.setAriaLabel(options.ariaLabel);
      }
      if (options.keyboardNavigation !== undefined) {
        this.setKeyboardNavigation(options.keyboardNavigation);
      }
      if (options.reducedMotion !== undefined) {
        this.setReducedMotion(options.reducedMotion);
      }
      if (options.touchScrollLockPx !== undefined) {
        this.setTouchScrollLockPx(options.touchScrollLockPx);
      }
      if (options.clickTolerancePx !== undefined) {
        this.setClickTolerancePx(options.clickTolerancePx);
      }
      if (options.interactions !== undefined) {
        this.setInteractions(options.interactions);
      }
      if (options.showZoomBreadcrumbs !== undefined) {
        this.showZoomBreadcrumbs = options.showZoomBreadcrumbs;
        shouldSyncZoomOverlays = true;
      }
      if (options.timeline !== undefined) {
        this.setTimelineOptions(options.timeline);
      }
      if (options.items !== undefined) {
        this.setItems(options.items);
      }

      if (needsRenderNow || themeChanged) {
        this.engine.renderNow();
      }
    });

    if (shouldSyncZoomOverlays) {
      this.syncZoomOverlays(this.engine.getZoomState());
    }
    if (shouldSyncTimelineOverlay && this.timelineController) {
      this.syncTimelineOverlay(this.timelineController.getState());
    }
  }

  /**
   * Switches built-in preset & tooltip theme between `'dark'` and `'light'`.
   */
  setTheme(theme: SimplexTheme): void {
    if (this.currentTheme === theme) return;
    this.batch(() => {
      this.currentTheme = theme;
      if (this.tooltipEl) {
        this.applyTooltipThemeStyles(this.tooltipEl);
      }
      this.adapter.setTheme(theme);
      this.engine.setTheme(theme);
      if (!this.usesCustomVisualResolver) {
        const resolver = createPresetVisualResolver<TItem, TTagMeta, TClusterMeta>(
          this.currentPreset,
          {
            getLabel: this.getLabelExtractor,
            theme,
            formatTagLabel: this.formatTagLabelFn,
            badgeOptions: this.badgeOptions,
            getShape: this.getShapeOption,
          },
        );
        this.engine.setVisualResolver(
          resolver as unknown as VisualResolver<
            TItem,
            TContentVisual,
            TClusterVisual,
            TTagMeta,
            TClusterMeta
          >,
        );
      }
      this.engine.renderNow();
    });
    this.syncZoomOverlays(this.engine.getZoomState());
    if (this.timelineController) {
      this.syncTimelineOverlay(this.timelineController.getState());
    }
  }

  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void {
    this.engine.setMeshStrategy(strategy);
    this.ensureLoopRunning();
  }

  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void {
    this.rawClusteringStrategy = strategy;
    const effective =
      this.resolveEffectiveClusteringStrategy(strategy, this.fullCorpusItems) ??
      strategy;
    this.engine.setClusteringStrategy(effective);
    this.ensureLoopRunning();
  }

  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void {
    this.engine.setColorStrategy(strategy);
    this.ensureLoopRunning();
  }

  setLayoutStrategy(strategy: SimplexLayoutStrategy): void {
    this.rawLayoutStrategy = strategy;
    const effective = this.resolveEffectiveLayoutStrategy(strategy) ?? strategy;
    this.engine.setLayoutStrategy(effective);
    this.ensureLoopRunning();
  }

  setZoomStrategy(
    strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>,
  ): void {
    this.engine.setZoomStrategy(strategy);
    this.ensureLoopRunning();
  }

  setZoomUiOptions(options: {
    readonly showZoomBreadcrumbs?: boolean;
  }): void {
    if (options.showZoomBreadcrumbs !== undefined) {
      this.showZoomBreadcrumbs = options.showZoomBreadcrumbs;
    }
    this.syncZoomOverlays(this.engine.getZoomState());
  }

  getMeshStrategy(): SimplexMeshStrategy<TItem> {
    return this.engine.getMeshStrategy();
  }

  getClusteringStrategy(): SimplexClusteringStrategy<TItem, TTagMeta> {
    return this.engine.getClusteringStrategy();
  }

  getColorStrategy(): SimplexColorStrategy<TItem, TTagMeta> {
    return this.engine.getColorStrategy();
  }

  getLayoutStrategy(): SimplexLayoutStrategy {
    return this.engine.getLayoutStrategy();
  }

  getZoomStrategy(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
    return this.engine.getZoomStrategy();
  }

  getZoomState(): SimplexZoomState {
    return this.engine.getZoomState();
  }

  drillDownTriangle(triangleIndex: number): boolean {
    const ok = this.engine.drillDownTriangle(triangleIndex);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillDownCluster(clusterUid: string): boolean {
    const ok = this.engine.drillDownCluster(clusterUid);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillToNeighbor(neighborId: string): boolean {
    const ok = this.engine.drillToNeighbor(neighborId);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillUp(): boolean {
    const ok = this.engine.drillUp();
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillToDepth(depth: number): boolean {
    const ok = this.engine.drillToDepth(depth);
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  drillToRoot(): boolean {
    const ok = this.engine.drillToRoot();
    if (ok) this.ensureLoopRunning();
    return ok;
  }

  setMeshOptions(options: MeshOptions): void {
    this.engine.setMeshOptions(options);
    this.ensureLoopRunning();
  }

  setLayoutOptions(options: LayoutSolverOptions): void {
    this.engine.setLayoutOptions(options);
    this.ensureLoopRunning();
  }

  setTooltip(
    tooltip: SimplexSvgTooltipOption<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.hideTooltip();
    this.tooltipOption = tooltip;
    if (this.tooltipEl) {
      this.tooltipEl.textContent = '';
      this.applyTooltipPresentationStyles(this.tooltipEl);
    }
  }

  setVisualResolver(
    resolver: VisualResolver<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.engine.setVisualResolver(resolver);
    this.ensureLoopRunning();
  }

  setViews(
    views: Partial<
      Omit<
        SvgRendererOptions<
          TContentVisual,
          TClusterVisual,
          TItem,
          TTagMeta,
          TClusterMeta
        >,
        'theme'
      >
    >,
  ): void {
    this.adapter.setViews(views);
    if (views.triangleView !== undefined || views.edgeView !== undefined) {
      this.engine.renderNow();
    }
    this.ensureLoopRunning();
  }

  /** Swaps the triangulation face view plugin (`SvgTriangleView`) at runtime. */
  setTriangleView(view: SvgTriangleView<TItem, TTagMeta, TClusterMeta>): void {
    this.adapter.setViews({ triangleView: view });
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Swaps the triangulation edge view plugin (`SvgEdgeView`) at runtime. */
  setEdgeView(view: SvgEdgeView<TItem, TTagMeta, TClusterMeta>): void {
    this.adapter.setViews({ edgeView: view });
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  setSizeMultiplier(multiplier: number): void {
    this.engine.setSizeMultiplier(multiplier);
    this.ensureLoopRunning();
  }

  setShowHulls(show: boolean): void {
    this.engine.setShowHulls(show);
    this.ensureLoopRunning();
  }

  /** Returns the active empty-cluster rendering behavior (`'normal' | 'dim' | 'hide'`). */
  getEmptyClusterBehavior(): EmptyClusterBehavior {
    return this.engine.getEmptyClusterBehavior();
  }

  /** Configures how clusters with `0` active member items are rendered (`'normal' | 'dim' | 'hide'`). */
  setEmptyClusterBehavior(behavior: EmptyClusterBehavior): void {
    this.baseEmptyClusterBehavior = behavior;
    this.engine.setEmptyClusterBehavior(behavior);
    this.ensureLoopRunning();
  }

  /** Returns the currently active item filter predicate and mode (`'dim' | 'hide'`). */
  getItemFilter(): ItemFilterState<TItem> {
    return this.engine.getItemFilter();
  }

  /**
   * Filters content items visually and interactively without triggering a layout re-solve.
   * All anchors, clusters, and item positions remain frozen across rapid filter changes.
   *
   * - `mode: 'dim'` (default): Softly dims non-matching items cleanly.
   * - `mode: 'hide'`: Hides non-matching items (`opacity: 0`, `pointer-events: none`, excluded from `hitTest()`).
   * - Pass `null` to clear the filter and restore all items.
   */
  setItemFilter(
    predicate: ItemFilterPredicate<TItem> | null,
    options?: ItemFilterOptions,
  ): void {
    this.engine.setItemFilter(predicate, options);
    if (this.keyboardFocusTarget !== null) {
      const stillVisible = this.engine
        .getInteractiveTargets()
        .some((t) => this.targetMatches(this.keyboardFocusTarget, t));
      if (!stillVisible) {
        this.clearKeyboardFocus();
      }
    }
    this.ensureLoopRunning();
  }

  setInteractions(
    interactions: InteractionHandlers<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    this.engine.setInteractions(this.wrapInteractions(interactions));
  }

  setPinnedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this.engine.setPinnedIds(ids);
    this.ensureLoopRunning();
  }

  /** Sets highlighted item IDs (dimming non-matches), or pass `null` to clear. */
  setHighlightedIds(ids: Iterable<string> | null): void {
    this.engine.setHighlightedIds(ids);
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Alias for `setHighlightedIds(ids)` for linked search bars and sidebars (`null` clears). */
  setHighlightedItems(ids: Iterable<string> | null): void {
    this.setHighlightedIds(ids);
  }

  /** Returns the currently highlighted item IDs. */
  getHighlightedIds(): ReadonlySet<string> {
    return this.engine.getHighlightedIds();
  }

  /** Alias for `getHighlightedIds()`. */
  getHighlightedItems(): ReadonlySet<string> {
    return this.engine.getHighlightedItems();
  }

  /**
   * Replaces the active multi-selection set (`null` clears selection).
   * Tracked independently of `highlightedIds` and `pinnedIds`.
   */
  setSelectedIds(ids: Iterable<string> | null): void {
    this.engine.setSelectedIds(ids);
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Toggles a single item ID in the multi-selection set and returns its new selected state. */
  toggleSelectedId(id: string): boolean {
    const next = this.engine.toggleSelectedId(id);
    this.engine.renderNow();
    this.ensureLoopRunning();
    return next;
  }

  /** Clears all currently selected item IDs. */
  clearSelection(): void {
    this.engine.clearSelection();
    this.engine.renderNow();
    this.ensureLoopRunning();
  }

  /** Returns a snapshot of the currently multi-selected item IDs. */
  getSelectedIds(): ReadonlySet<string> {
    return this.engine.getSelectedIds();
  }

  /**
   * Selects active content items intersecting the given SVG-local screen rectangle.
   */
  selectItemsInScreenRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string> {
    const next = this.engine.selectItemsInScreenRect(x1, y1, x2, y2, options);
    this.engine.renderNow();
    this.ensureLoopRunning();
    return next;
  }

  /** Enables or disables `Shift+Drag` marquee box selection at runtime. */
  setMarqueeSelection(enabled: boolean): void {
    this.marqueeSelectionEnabled = enabled;
    if (!enabled) {
      this.hideMarqueeRect();
    }
  }

  /** Returns whether `Shift+Drag` marquee box selection is currently enabled. */
  isMarqueeSelectionEnabled(): boolean {
    return this.marqueeSelectionEnabled;
  }

  /** Enables or disables built-in `Shift+Click` multi-selection before `onContentClick` / `onLeftClick`. */
  setShiftClickSelects(enabled: boolean): void {
    this.engine.setShiftClickSelects(enabled);
  }

  /** Returns whether built-in `Shift+Click` multi-selection is currently enabled. */
  getShiftClickSelects(): boolean {
    return this.engine.getShiftClickSelects();
  }

  /** Updates the multi-selection change listener at runtime. */
  setOnSelectionChange(cb?: (selectedIds: ReadonlySet<string>) => void): void {
    this.engine.setOnSelectionChange(cb);
  }

  /** Returns the currently programmatically focused item ID, or `null`. */
  getFocusedItemId(): string | null {
    return this.engine.getFocusedItemId();
  }

  /**
   * Programmatically focuses a specific content item (highlighting it and dispatching hover/tooltip
   * callbacks), or clears item focus when passed `null`.
   */
  focusItem(
    itemId: string | null,
    options?: FocusItemOptions & { readonly announce?: boolean },
  ): boolean {
    if (itemId === null) {
      this.engine.focusItem(null, options);
      if (options?.hover !== false) {
        this.hideTooltip();
      }
      this.engine.renderNow();
      this.ensureLoopRunning();
      return false;
    }
    const ok = this.engine.focusItem(itemId, options);
    if (!ok) return false;
    if (options?.announce) {
      const rec = this.engine.getItemLayoutById(itemId);
      const label = rec
        ? extractDefaultItemLabel(rec.item, itemId, this.getLabelExtractor)
        : itemId;
      this.announce(`Focused item: ${label}`);
    }
    this.engine.renderNow();
    this.ensureLoopRunning();
    return true;
  }

  /**
   * Programmatically zooms or drills down to a specific content item:
   * - In `free-camera` mode: pans and zooms the camera onto the item.
   * - In `drill-down` mode: navigates to the item's ancestor frame (if needed) and drills down
   *   into its covering triangle or cluster up to `options.maxDrillSteps` (default `4`).
   *
   * Optionally focuses the item afterwards (`options.focus !== false`).
   */
  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean {
    const ok = this.engine.zoomToItem(itemId, options);
    if (!ok) return false;
    this.syncZoomOverlays(this.engine.getZoomState());
    this.engine.renderNow();
    this.ensureLoopRunning();
    return true;
  }

  setFocusedClusterUid(clusterUid: string | null): void {
    this.focusedClusterUidState = clusterUid;
    this.engine.setFocusedClusterUid(clusterUid);
    this.ensureLoopRunning();
  }

  /** Focuses a specific mesh triangle face by index (dimming unrelated faces and nodes) or clears with `null`. */
  setFocusedTriangleIndex(triangleIndex: number | null): void {
    this.focusedTriangleIndexState = triangleIndex;
    this.engine.setFocusedTriangleIndex(triangleIndex);
    this.ensureLoopRunning();
  }

  /**
   * Captures a plain JSON-serializable snapshot of the graph's interactive view state
   * (camera pan/zoom, drill-down path, focus, highlights, multi-selection, pins, and
   * active `timelineStep` when a timeline is configured).
   */
  getViewState(): SimplexViewState {
    const base = this.engine.getViewState();
    if (!this.timelineController) {
      return base;
    }
    return {
      ...base,
      timelineStep: this.timelineController.getState().step,
    };
  }

  /**
   * Restores a previously serialized `SimplexViewState` snapshot (for deep-linking,
   * browser history navigation, or session persistence).
   *
   * When a timeline controller is attached and `state.timelineStep` is provided,
   * pauses playback and seeks to the target step before restoring drill-down, camera,
   * focus, highlights, pins, and multi-selection.
   */
  restoreViewState(
    state: Partial<SimplexViewState> | null | undefined,
    options?: RestoreViewStateOptions,
  ): boolean {
    if (this.destroyed || !state || typeof state !== 'object') return false;
    if (state.version !== undefined && state.version !== 1) return false;

    if (
      this.timelineController &&
      typeof state.timelineStep === 'number' &&
      Number.isFinite(state.timelineStep)
    ) {
      this.timelineController.pause();
      this.timelineController.seek(Math.round(state.timelineStep));
      this.syncTimelineOverlay(this.timelineController.getState());
    }

    const ok = this.engine.restoreViewState(state, options);
    if (!ok) return false;

    this.focusedClusterUidState = this.engine.getFocusedClusterUid();
    this.focusedTriangleIndexState = this.engine.getFocusedTriangleIndex();
    this.hideTooltip();
    this.syncZoomOverlays(this.engine.getZoomState());
    this.ensureLoopRunning();
    return true;
  }

  /** Updates the touch direction-locking threshold in CSS pixels (`0` disables scroll-yielding). */
  setTouchScrollLockPx(px: number): void {
    this.touchScrollLockPx = Number.isFinite(px) ? Math.max(0, px) : 8;
    this.syncSvgTouchAction();
  }

  /** Updates the maximum drag-vs-click pointer displacement tolerance in CSS pixels. */
  setClickTolerancePx(px: number): void {
    this.clickTolerancePx = Number.isFinite(px) ? Math.max(0, px) : 12;
  }

  /**
   * Updates the reduced-motion preference (`'auto' | boolean`).
   * Under `'auto'`, tracks `window.matchMedia('(prefers-reduced-motion: reduce)')` live.
   */
  setReducedMotion(preference: ReducedMotionPreference): void {
    if (this.destroyed) return;
    this.reducedMotionPreference = preference;
    this.syncReducedMotionMediaSubscription();
    this.applyReducedMotionState(this.computeReducedMotionActive());
  }

  /** Returns the configured `reducedMotion` preference (`'auto' | boolean`). */
  getReducedMotion(): ReducedMotionPreference {
    return this.reducedMotionPreference;
  }

  /** Returns `true` when motion reduction is currently active (explicit `true` or OS `reduce` under `'auto'`). */
  isReducedMotionActive(): boolean {
    return this.reducedMotionActive;
  }

  private computeReducedMotionActive(): boolean {
    if (this.reducedMotionPreference === true) return true;
    if (this.reducedMotionPreference === false) return false;
    const win = this.containerEl.ownerDocument?.defaultView ??
      (typeof window !== 'undefined' ? window : null);
    if (!win || typeof win.matchMedia !== 'function') return false;
    try {
      return Boolean(win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  private syncReducedMotionAttribute(): void {
    if (this.reducedMotionActive) {
      this.svgEl.setAttribute('data-reduced-motion', 'true');
    } else {
      this.svgEl.removeAttribute('data-reduced-motion');
    }
  }

  private applyReducedMotionState(active: boolean): void {
    this.reducedMotionActive = active;
    this.syncReducedMotionAttribute();
    this.engine.setReducedMotion(active);
  }

  private detachReducedMotionMediaSubscription(): void {
    this.reducedMotionMediaCleanup?.();
    this.reducedMotionMediaCleanup = null;
  }

  private syncReducedMotionMediaSubscription(): void {
    this.detachReducedMotionMediaSubscription();
    if (this.destroyed || this.reducedMotionPreference !== 'auto') return;
    const win = this.containerEl.ownerDocument?.defaultView ??
      (typeof window !== 'undefined' ? window : null);
    if (!win || typeof win.matchMedia !== 'function') return;

    let mql: MediaQueryList;
    try {
      mql = win.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    if (!mql) return;

    const handleChange = (event?: { readonly matches?: boolean }) => {
      if (this.destroyed || this.reducedMotionPreference !== 'auto') return;
      const matches =
        typeof event?.matches === 'boolean' ? event.matches : Boolean(mql.matches);
      this.applyReducedMotionState(matches);
    };

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      this.reducedMotionMediaCleanup = () => {
        mql.removeEventListener('change', handleChange);
      };
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(handleChange);
      this.reducedMotionMediaCleanup = () => {
        mql.removeListener(handleChange);
      };
    }
  }

  /**
   * Clears cached SVG hull measurements, re-measures all active nodes, and re-solves
   * the current layout frame cleanly (for example after late webfont loading).
   */
  relayout(): void {
    if (this.destroyed) return;
    this.adapter.invalidateHulls();
    this.engine.relayout();
    this.ensureLoopRunning();
  }

  /**
   * Serializes the current simplex view (including zoomed sub-levels, camera framing,
   * filters, highlights, and timeline frames) as a standalone, publication-ready `<svg>` string
   * with resolved inline styles and active theme background.
   */
  exportSvg(options?: ExportSvgOptions): string {
    if (this.destroyed) {
      throw new Error('SimplexSvgController.exportSvg: cannot export after destroy().');
    }
    this.engine.renderNow();
    return prepareStandaloneSvg(
      this.svgEl,
      { theme: this.currentTheme },
      options,
    ).svgString;
  }

  /**
   * Rasterizes the current simplex view onto an offscreen HiDPI `<canvas>` and returns
   * a PNG `Blob` (default) or base64 `data:` URL string (`{ format: 'dataUrl' }`).
   */
  exportPng(options: ExportPngDataUrlOptions): Promise<string>;
  exportPng(options?: ExportPngBlobOptions): Promise<Blob>;
  exportPng(options?: ExportPngOptions): Promise<Blob | string>;
  exportPng(options?: ExportPngOptions): Promise<Blob | string> {
    if (this.destroyed) {
      return Promise.reject(
        new Error('SimplexSvgController.exportPng: cannot export after destroy().'),
      );
    }
    this.engine.renderNow();
    return exportSvgElementToPng(
      this.svgEl,
      { theme: this.currentTheme },
      options,
    );
  }

  /** Deterministically advances simulation & timeline clocks in tests without waiting for rAF. */
  stepForTest(dtMs: number): boolean {
    this.timelineController?.tick(dtMs);
    return this.engine.step(dtMs);
  }

  private toLocalCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.svgEl.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private resetTouchPinchState(): void {
    this.lastPinchDist = null;
    this.pinchStartDist = null;
    this.pinchHandledInGesture = false;
    this.lastPinchMid = null;
  }

  private triggerPinchDrillIn(screenX: number, screenY: number): boolean {
    const zState = this.engine.getZoomState();
    const hit = this.engine.hitTest(screenX, screenY);
    if (hit.kind === 'triangle') {
      if (hit.triangle.neighborId) {
        return this.drillToNeighbor(hit.triangle.neighborId);
      }
      if (!hit.triangle.isContext && zState.activeFrameKind !== 'triangle-focus') {
        return this.drillDownTriangle(hit.triangle.index);
      }
      return false;
    }
    if (hit.kind === 'cluster') {
      if (hit.neighborId) {
        return this.drillToNeighbor(hit.neighborId);
      }
      return this.drillDownCluster(hit.cluster.clusterUid);
    }
    const candidateTriIndices =
      zState.drillableTriangleIndices.length > 0
        ? zState.drillableTriangleIndices
        : zState.focusableTriangleIndices;
    if (hit.kind === 'content') {
      const mesh = this.engine.getMesh();
      if (mesh) {
        for (const triIdx of candidateTriIndices) {
          const tri = mesh.triangles[triIdx];
          if (!tri) continue;
          const p0 = mesh.vertices[tri.vertices[0]]!;
          const p1 = mesh.vertices[tri.vertices[1]]!;
          const p2 = mesh.vertices[tri.vertices[2]]!;
          if (isPointInTriangle(hit.worldPosition.x, hit.worldPosition.y, p0, p1, p2)) {
            return this.drillDownTriangle(triIdx);
          }
        }
      }
      const primaryCluster = hit.layoutContext.unitClusters[0]?.cluster;
      if (primaryCluster && zState.drillableClusterUids.includes(primaryCluster.clusterUid)) {
        return this.drillDownCluster(primaryCluster.clusterUid);
      }
    }
    // Background fallback: drill into the closest drillable or focusable triangle
    if (candidateTriIndices.length > 0) {
      const mesh = this.engine.getMesh();
      if (mesh) {
        let bestIdx = candidateTriIndices[0]!;
        let bestDist = Infinity;
        for (const triIdx of candidateTriIndices) {
          const tri = mesh.triangles[triIdx];
          if (!tri) continue;
          const p0 = mesh.vertices[tri.vertices[0]]!;
          const p1 = mesh.vertices[tri.vertices[1]]!;
          const p2 = mesh.vertices[tri.vertices[2]]!;
          const cx = (p0.x + p1.x + p2.x) / 3;
          const cy = (p0.y + p1.y + p2.y) / 3;
          const d = Math.hypot(cx - hit.worldPosition.x, cy - hit.worldPosition.y);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = triIdx;
          }
        }
        return this.drillDownTriangle(bestIdx);
      }
    }
    return false;
  }

  private ensureContainerPositioned(): void {
    const computedPos =
      typeof getComputedStyle !== 'undefined'
        ? getComputedStyle(this.containerEl).position
        : this.containerEl.style.position;
    if (!computedPos || computedPos === 'static') {
      this.containerEl.style.position = 'relative';
    }
  }

  private syncZoomOverlays(state: SimplexZoomState): void {
    if (this.destroyed) return;
    const isLight = this.currentTheme === 'light';

    // Built-in Drill Breadcrumb Strip (unless disabled by host wrapper)
    if (
      this.showZoomBreadcrumbs &&
      state.mode === 'drill-down' &&
      state.depth > 0
    ) {
      this.ensureContainerPositioned();
      const doc = this.containerEl.ownerDocument;
      if (!this.breadcrumbOverlayEl) {
        const el = doc.createElement('div');
        el.className = 'sv-zoom-breadcrumbs';
        el.setAttribute('role', 'navigation');
        el.setAttribute('aria-label', 'Zoom breadcrumbs');
        el.style.position = 'absolute';
        el.style.top = '12px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '16';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '3px';
        el.style.maxWidth = 'calc(100% - 24px)';
        el.style.overflowX = 'auto';
        el.style.whiteSpace = 'nowrap';
        el.style.padding = '4px 9px';
        el.style.borderRadius = '8px';
        el.style.backdropFilter = 'blur(8px)';
        el.style.fontFamily =
          'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
        el.style.fontSize = '11px';
        this.containerEl.appendChild(el);
        this.breadcrumbOverlayEl = el;
      }
      this.breadcrumbOverlayEl.style.display = 'flex';
      this.breadcrumbOverlayEl.style.background = isLight
        ? 'rgba(255, 255, 255, 0.95)'
        : 'rgba(11, 15, 23, 0.93)';
      this.breadcrumbOverlayEl.style.border = isLight
        ? '1px solid rgba(203, 213, 225, 0.95)'
        : '1px solid rgba(51, 65, 85, 0.92)';
      this.breadcrumbOverlayEl.style.boxShadow = isLight
        ? '0 4px 14px rgba(15, 23, 42, 0.08)'
        : '0 4px 16px rgba(0, 0, 0, 0.36)';
      this.breadcrumbOverlayEl.style.color = isLight ? '#0f172a' : '#e2e8f0';

      while (this.breadcrumbOverlayEl.firstChild) {
        this.breadcrumbOverlayEl.removeChild(this.breadcrumbOverlayEl.firstChild);
      }

      state.breadcrumbs.forEach((crumb, idx) => {
        if (idx > 0) {
          const sep = doc.createElement('span');
          sep.textContent = '›';
          sep.setAttribute('aria-hidden', 'true');
          sep.style.opacity = '0.48';
          sep.style.fontSize = '12px';
          sep.style.padding = '0 1px';
          this.breadcrumbOverlayEl!.appendChild(sep);
        }
        const isCurrent = idx === state.depth;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.title = crumb.label;
        if (isCurrent) {
          btn.setAttribute('aria-current', 'location');
        } else {
          btn.setAttribute('aria-label', `Zoom out to ${crumb.label}`);
        }
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '4px';
        btn.style.cursor = isCurrent ? 'default' : 'pointer';
        btn.style.fontWeight = isCurrent ? '700' : '500';
        btn.style.color = isCurrent
          ? isLight
            ? '#0f172a'
            : '#f8fafc'
          : isLight
            ? '#475569'
            : '#94a3b8';
        btn.style.background = isCurrent
          ? isLight
            ? 'rgba(241, 245, 249, 0.95)'
            : 'rgba(30, 41, 59, 0.72)'
          : 'transparent';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.style.padding = '2px 6px';

        const segs = crumb.segments;
        if (idx > 0 && segs && segs.length > 0) {
          segs.forEach((seg, sIdx) => {
            if (sIdx > 0) {
              const dotSep = doc.createElement('span');
              dotSep.textContent = '·';
              dotSep.setAttribute('aria-hidden', 'true');
              dotSep.style.opacity = '0.5';
              btn.appendChild(dotSep);
            }
            if (seg.colorHex) {
              const pip = doc.createElement('span');
              pip.setAttribute('aria-hidden', 'true');
              pip.style.display = 'inline-block';
              pip.style.width = '6px';
              pip.style.height = '6px';
              pip.style.borderRadius = '9999px';
              pip.style.background = seg.colorHex;
              pip.style.boxShadow = isLight
                ? '0 0 0 1px rgba(15, 23, 42, 0.16)'
                : '0 0 0 1px rgba(255, 255, 255, 0.35)';
              pip.style.flexShrink = '0';
              btn.appendChild(pip);
            }
            const lbl = doc.createElement('span');
            lbl.textContent = seg.label;
            btn.appendChild(lbl);
          });
        } else {
          btn.textContent = crumb.shortLabel;
        }

        if (!isCurrent) {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.drillToDepth(crumb.depth);
          });
        }
        this.breadcrumbOverlayEl!.appendChild(btn);
      });
    } else if (this.breadcrumbOverlayEl) {
      this.breadcrumbOverlayEl.style.display = 'none';
    }
  }

  private normalizeAutoFinalSeedLayout(
    option: boolean | FinalSeededLayoutScaleMode | undefined,
  ): FinalSeededLayoutScaleMode | false {
    if (option === true) return 'pinned';
    if (option === 'pinned' || option === 'adaptive') return option;
    return false;
  }

  private resolveEffectiveLayoutStrategy(
    baseStrategy: SimplexLayoutStrategy | undefined,
  ): SimplexLayoutStrategy | undefined {
    if (!this.timelineController || !this.timelineAutoFinalSeedLayout) {
      return baseStrategy;
    }
    if (baseStrategy && baseStrategy.name.startsWith('final-seeded(')) {
      return baseStrategy;
    }
    return createFinalSeededLayoutStrategy(baseStrategy, {
      scaleMode: this.timelineAutoFinalSeedLayout,
    });
  }

  private resolveEffectiveClusteringStrategy(
    baseStrategy: SimplexClusteringStrategy<TItem, TTagMeta> | undefined,
    seedItems: readonly TItem[],
  ): SimplexClusteringStrategy<TItem, TTagMeta> | undefined {
    if (
      !this.timelineController ||
      !this.timelineAutoFinalSeed ||
      seedItems.length === 0
    ) {
      return baseStrategy;
    }
    if (baseStrategy && baseStrategy.name.startsWith('final-seeded(')) {
      return baseStrategy;
    }
    return createFinalSeededClusteringStrategy<TItem, TTagMeta>(baseStrategy, {
      seedItems,
    });
  }

  private syncFinalSeededClusteringForCorpus(seedItems: readonly TItem[]): void {
    if (!this.timelineController || !this.timelineAutoFinalSeed) return;
    if (
      this.rawClusteringStrategy &&
      this.rawClusteringStrategy.name.startsWith('final-seeded(')
    ) {
      return;
    }
    const nextStrategy = this.resolveEffectiveClusteringStrategy(
      this.rawClusteringStrategy,
      seedItems,
    );
    if (nextStrategy) {
      this.engine.setClusteringStrategy(nextStrategy);
    }
  }

  private notifyTimelineListeners(
    state: SimplexTimelineState<TItem> | null,
  ): void {
    if (state) {
      this.timelineOnStateChange?.(state);
    }
    for (const listener of this.timelineStateListeners) {
      listener(state);
    }
  }

  private detachTimelineController(): void {
    this.timelineUnsubscribe?.();
    this.timelineUnsubscribe = null;
    this.timelineController?.destroy();
    this.timelineController = null;
  }

  private attachTimelineController(
    controller: SimplexTimelineController<TItem>,
  ): void {
    this.timelineUnsubscribe = controller.subscribe((state) => {
      if (this.destroyed) return;
      if (state.activeItems !== this.lastTimelineActiveItems) {
        this.lastTimelineActiveItems = state.activeItems;
        this.engine.setItems(state.activeItems);
      }
      this.syncTimelineOverlay(state);
      this.notifyTimelineListeners(state);
      this.emitControllerLegendChange();
      this.ensureLoopRunning();
    });
    const initialState = controller.getState();
    this.syncTimelineOverlay(initialState);
    this.notifyTimelineListeners(initialState);
    this.emitControllerLegendChange();
    if (initialState.playing) {
      this.ensureLoopRunning();
    }
  }

  private createTimelineIconSvg(
    doc: Document,
    kind: 'play' | 'pause' | 'prev' | 'next',
  ): SVGSVGElement {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    if (kind === 'play') {
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '3,1.8 10.2,6 3,10.2');
      svg.appendChild(poly);
    } else if (kind === 'pause') {
      const r1 = doc.createElementNS(SVG_NS, 'rect');
      r1.setAttribute('x', '2.5');
      r1.setAttribute('y', '2');
      r1.setAttribute('width', '2.5');
      r1.setAttribute('height', '8');
      r1.setAttribute('rx', '0.6');
      const r2 = doc.createElementNS(SVG_NS, 'rect');
      r2.setAttribute('x', '7');
      r2.setAttribute('y', '2');
      r2.setAttribute('width', '2.5');
      r2.setAttribute('height', '8');
      r2.setAttribute('rx', '0.6');
      svg.appendChild(r1);
      svg.appendChild(r2);
    } else if (kind === 'prev') {
      const bar = doc.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', '2');
      bar.setAttribute('y', '2.2');
      bar.setAttribute('width', '1.6');
      bar.setAttribute('height', '7.6');
      bar.setAttribute('rx', '0.5');
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '9.8,2.2 4.2,6 9.8,9.8');
      svg.appendChild(bar);
      svg.appendChild(poly);
    } else {
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '2.2,2.2 7.8,6 2.2,9.8');
      const bar = doc.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', '8.4');
      bar.setAttribute('y', '2.2');
      bar.setAttribute('width', '1.6');
      bar.setAttribute('height', '7.6');
      bar.setAttribute('rx', '0.5');
      svg.appendChild(poly);
      svg.appendChild(bar);
    }
    return svg;
  }

  private styleTimelineButton(
    btn: HTMLButtonElement,
    isLight: boolean,
    disabled: boolean,
    accent = false,
  ): void {
    btn.disabled = disabled;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.width = '24px';
    btn.style.height = '24px';
    btn.style.padding = '0';
    btn.style.borderRadius = '6px';
    btn.style.border = 'none';
    btn.style.flexShrink = '0';
    btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    btn.style.opacity = disabled ? '0.38' : '1';
    if (accent) {
      btn.style.background = isLight
        ? 'rgba(15, 23, 42, 0.92)'
        : 'rgba(226, 232, 240, 0.94)';
      btn.style.color = isLight ? '#f8fafc' : '#0f172a';
    } else {
      btn.style.background = isLight
        ? 'rgba(241, 245, 249, 0.9)'
        : 'rgba(30, 41, 59, 0.72)';
      btn.style.color = isLight ? '#334155' : '#cbd5e1';
    }
  }

  private syncTimelineOverlay(
    state: SimplexTimelineState<TItem> | null,
  ): void {
    if (this.destroyed) return;
    if (!state || !this.timelineShowControls || state.frames.length === 0) {
      if (this.timelineOverlayEl) {
        this.timelineOverlayEl.style.display = 'none';
      }
      return;
    }

    const isLight = this.currentTheme === 'light';
    const doc = this.containerEl.ownerDocument;
    this.ensureContainerPositioned();

    if (!this.timelineOverlayEl || !this.timelineUiRefs) {
      const el = doc.createElement('div');
      el.className = 'sv-timeline-bar';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Timeline playback controls');
      el.style.position = 'absolute';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
      el.style.zIndex = '17';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '6px';
      el.style.maxWidth = 'calc(100% - 24px)';
      el.style.padding = '5px 10px';
      el.style.borderRadius = '8px';
      el.style.backdropFilter = 'blur(8px)';
      el.style.fontFamily =
        'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
      el.style.fontSize = '11px';

      const stopEvt = (ev: Event) => {
        ev.stopPropagation();
      };
      el.addEventListener('pointerdown', stopEvt);
      el.addEventListener('click', stopEvt);
      el.addEventListener('wheel', stopEvt);

      const playBtn = doc.createElement('button');
      playBtn.type = 'button';
      playBtn.setAttribute('data-sv-timeline-action', 'toggle');
      playBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.timelineController?.toggle();
      });

      const prevBtn = doc.createElement('button');
      prevBtn.type = 'button';
      prevBtn.setAttribute('data-sv-timeline-action', 'prev');
      prevBtn.setAttribute('aria-label', 'Previous step');
      prevBtn.title = 'Previous step';
      prevBtn.appendChild(this.createTimelineIconSvg(doc, 'prev'));
      prevBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.timelineController?.pause();
        this.timelineController?.stepBy(-1);
      });

      const scrubber = doc.createElement('input');
      scrubber.type = 'range';
      scrubber.min = '0';
      scrubber.step = '1';
      scrubber.setAttribute('data-sv-timeline-action', 'scrubber');
      scrubber.setAttribute('aria-label', 'Timeline step');
      scrubber.style.width = '128px';
      scrubber.style.minWidth = '64px';
      scrubber.style.margin = '0 2px';
      scrubber.style.cursor = 'pointer';
      scrubber.addEventListener('input', (ev) => {
        ev.stopPropagation();
        const nextVal = Number((ev.target as HTMLInputElement).value);
        this.timelineController?.pause();
        this.timelineController?.seek(nextVal);
      });

      const nextBtn = doc.createElement('button');
      nextBtn.type = 'button';
      nextBtn.setAttribute('data-sv-timeline-action', 'next');
      nextBtn.setAttribute('aria-label', 'Next step');
      nextBtn.title = 'Next step';
      nextBtn.appendChild(this.createTimelineIconSvg(doc, 'next'));
      nextBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.timelineController?.pause();
        this.timelineController?.stepBy(1);
      });

      const labelEl = doc.createElement('span');
      labelEl.setAttribute('data-sv-timeline-label', '');
      labelEl.style.fontWeight = '600';
      labelEl.style.whiteSpace = 'nowrap';
      labelEl.style.paddingLeft = '2px';

      const countEl = doc.createElement('span');
      countEl.setAttribute('data-sv-timeline-count', '');
      countEl.style.fontVariantNumeric = 'tabular-nums';
      countEl.style.whiteSpace = 'nowrap';
      countEl.style.fontSize = '10px';

      el.appendChild(playBtn);
      el.appendChild(prevBtn);
      el.appendChild(scrubber);
      el.appendChild(nextBtn);
      el.appendChild(labelEl);
      el.appendChild(countEl);

      this.containerEl.appendChild(el);
      this.timelineOverlayEl = el;
      this.timelineUiRefs = {
        playBtn,
        prevBtn,
        nextBtn,
        scrubber,
        labelEl,
        countEl,
      };
    }

    const el = this.timelineOverlayEl;
    const refs = this.timelineUiRefs;

    el.style.display = 'flex';
    if (this.timelinePosition === 'top') {
      el.style.top = '12px';
      el.style.bottom = '';
    } else {
      el.style.bottom = '12px';
      el.style.top = '';
    }
    el.style.background = isLight
      ? 'rgba(255, 255, 255, 0.95)'
      : 'rgba(11, 15, 23, 0.93)';
    el.style.border = isLight
      ? '1px solid rgba(203, 213, 225, 0.95)'
      : '1px solid rgba(51, 65, 85, 0.92)';
    el.style.boxShadow = isLight
      ? '0 4px 14px rgba(15, 23, 42, 0.08)'
      : '0 4px 16px rgba(0, 0, 0, 0.36)';
    el.style.color = isLight ? '#0f172a' : '#e2e8f0';

    while (refs.playBtn.firstChild) {
      refs.playBtn.removeChild(refs.playBtn.firstChild);
    }
    refs.playBtn.appendChild(
      this.createTimelineIconSvg(doc, state.playing ? 'pause' : 'play'),
    );
    refs.playBtn.setAttribute(
      'aria-label',
      state.playing ? 'Pause timeline' : 'Play timeline',
    );
    refs.playBtn.title = state.playing ? 'Pause' : 'Play';
    this.styleTimelineButton(
      refs.playBtn,
      isLight,
      state.totalSteps <= 0,
      true,
    );
    this.styleTimelineButton(refs.prevBtn, isLight, state.atStart);
    this.styleTimelineButton(refs.nextBtn, isLight, state.atEnd);

    refs.scrubber.max = String(state.totalSteps);
    refs.scrubber.value = String(state.step);
    refs.scrubber.disabled = state.totalSteps <= 0;
    refs.scrubber.style.accentColor = isLight ? '#0f172a' : '#e2e8f0';

    refs.labelEl.textContent = state.activeLabel;
    refs.labelEl.style.color = isLight ? '#0f172a' : '#f8fafc';
    refs.countEl.textContent = `${state.activeItemCount}/${state.totalItemCount}`;
    refs.countEl.style.color = isLight ? '#64748b' : '#94a3b8';
  }

  private syncSvgTouchAction(): void {
    this.svgEl.style.touchAction = this.touchScrollLockPx > 0 ? 'pan-y' : 'none';
  }

  private readonly onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length >= 2) {
      this.touchScrollAxis = 'pinch';
      this.wasMultiTouchGesture = true;
      this.isDraggingPan = false;
      this.panStarted = false;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0]!;
      this.touchOriginX = t.clientX;
      this.touchOriginY = t.clientY;
      this.touchScrollAxis = 'undecided';
      this.touchYieldedToScroll = false;
    }
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length >= 2) {
      this.touchScrollAxis = 'pinch';
      this.wasMultiTouchGesture = true;
      e.preventDefault();
      return;
    }
    if (e.touches.length !== 1 || this.touchScrollLockPx <= 0) {
      return;
    }
    const t = e.touches[0]!;
    if (this.touchScrollAxis === 'undecided') {
      const absDx = Math.abs(t.clientX - this.touchOriginX);
      const absDy = Math.abs(t.clientY - this.touchOriginY);
      if (absDx >= this.touchScrollLockPx || absDy >= this.touchScrollLockPx) {
        if (absDy > absDx) {
          this.touchScrollAxis = 'vertical';
          this.touchYieldedToScroll = true;
          this.isDraggingPan = false;
          this.panStarted = false;
        } else {
          this.touchScrollAxis = 'horizontal';
        }
      }
    }
    if (this.touchScrollAxis === 'horizontal') {
      e.preventDefault();
    }
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 0) {
      this.touchScrollAxis = 'undecided';
    }
  };

  private readonly onTouchCancel = (e: TouchEvent): void => {
    if (e.touches.length === 0) {
      this.touchScrollAxis = 'undecided';
      this.touchYieldedToScroll = false;
    }
  };

  private syncSvgAccessibilityAttributes(): void {
    this.svgEl.setAttribute('role', 'application');
    this.svgEl.setAttribute('aria-roledescription', 'interactive topic graph');
    this.svgEl.setAttribute('aria-label', this.ariaLabel);
    if (this.keyboardNavigationEnabled) {
      this.svgEl.setAttribute('tabindex', '0');
      this.svgEl.setAttribute(
        'aria-keyshortcuts',
        'ArrowRight ArrowLeft ArrowDown ArrowUp Home End Enter Space Escape',
      );
    } else {
      this.svgEl.removeAttribute('tabindex');
      this.svgEl.removeAttribute('aria-keyshortcuts');
      this.svgEl.removeAttribute('aria-activedescendant');
    }
  }

  private ensureSrAnnouncerElement(): HTMLDivElement {
    if (this.srAnnouncerEl) return this.srAnnouncerEl;
    const doc = this.containerEl.ownerDocument;
    const el = doc.createElement('div');
    el.className = 'sv-sr-announcer';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.style.position = 'absolute';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.padding = '0';
    el.style.margin = '-1px';
    el.style.overflow = 'hidden';
    el.style.clip = 'rect(0, 0, 0, 0)';
    el.style.clipPath = 'inset(50%)';
    el.style.whiteSpace = 'nowrap';
    el.style.border = '0';
    el.style.pointerEvents = 'none';
    this.containerEl.appendChild(el);
    this.srAnnouncerEl = el;
    return el;
  }

  private announce(message: string): void {
    if (this.destroyed || !message) return;
    const el = this.ensureSrAnnouncerElement();
    if (el.textContent === message) {
      el.textContent = '';
    }
    el.textContent = message;
  }

  private computeZoomAnnouncementSig(state: SimplexZoomState): string {
    return `${state.mode}:${state.depth}:${state.activeFrameKind}:${state.breadcrumbs
      .map((b) => b.label)
      .join('>')}`;
  }

  private formatTargetAriaLabel(
    target: SimplexInteractiveTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): string {
    if (target.kind === 'cluster') {
      const c = target.cluster;
      const name = c.subclusterLabel || c.defaultLabel;
      const count = c.members.length;
      const zState = this.engine.getZoomState();
      const actionHint =
        zState.mode === 'drill-down'
          ? zState.activeFrameKind === 'cluster-star' &&
            c.clusterIndex === 0 &&
            zState.canDrillUp
            ? ', press Enter to zoom out'
            : target.isDrillable
              ? ', press Enter to zoom in'
              : ''
          : target.isFocused
            ? ', focused'
            : '';
      return `Topic cluster: ${name}, ${count} ${count === 1 ? 'item' : 'items'}${actionHint}`;
    }

    if (target.kind === 'triangle') {
      const tr = target.triangle;
      const corners = tr.clusters
        .map((c, idx) => (c ? c.defaultLabel : `Vertex ${tr.vertexIndices[idx] ?? idx}`))
        .join(', ');
      const count = tr.coveredItemCount;
      const actionHint = target.isDrillable
        ? ', press Enter to zoom in'
        : target.isFocusable
          ? ', press Enter to focus'
          : target.isFocused
            ? ', focused'
            : '';
      return `Region: ${corners}, ${count} ${count === 1 ? 'item' : 'items'}${actionHint}`;
    }

    const title = extractDefaultItemLabel(
      target.item,
      target.layoutContext.id,
      this.getLabelExtractor,
    );
    const tagSummary =
      target.layoutContext.tags.length > 0
        ? target.layoutContext.tags
            .slice(0, 3)
            .map((t) => {
              if (t.label) return t.label;
              if (this.formatTagLabelFn) {
                const formatted = this.formatTagLabelFn(t.tag).trim();
                if (formatted.length > 0) return formatted;
              }
              return t.tag;
            })
            .join(', ')
        : target.layoutContext.unitClusters
            .slice(0, 3)
            .map((uc) => uc.cluster.defaultLabel)
            .join(', ');
    const filterNote = target.isFilteredDimmed ? ', dimmed by filter' : '';
    return `Item: ${title}${tagSummary ? `, ${tagSummary}` : ''}${filterNote}`;
  }

  private buildAriaMetadataResolver(): SvgAriaMetadataResolver<
    TContentVisual,
    TClusterVisual,
    TItem,
    TTagMeta,
    TClusterMeta
  > {
    return {
      getClusterAria: (node) => {
        if (!this.engine) {
          return { role: 'button', label: `Topic cluster ${node.id}` };
        }
        const cluster = this.engine.getClusterByUid(node.id);
        if (!cluster) {
          return { role: 'button', label: `Topic cluster ${node.id}` };
        }
        const zState = this.engine.getZoomState();
        const name = cluster.subclusterLabel || cluster.defaultLabel;
        const count = cluster.members.length;
        const isDrillable =
          zState.mode === 'drill-down' &&
          zState.drillableClusterUids.includes(cluster.clusterUid);
        const isClusterStarCenter =
          zState.mode === 'drill-down' &&
          zState.activeFrameKind === 'cluster-star' &&
          cluster.clusterIndex === 0 &&
          zState.canDrillUp;
        const isFocused = this.focusedClusterUidState === cluster.clusterUid;
        const hint = isClusterStarCenter
          ? ', press Enter to zoom out'
          : isDrillable
            ? ', press Enter to zoom in'
            : '';
        return {
          role: 'button',
          label: `Topic cluster: ${name}, ${count} ${count === 1 ? 'item' : 'items'}${hint}`,
          pressed: isFocused ? true : undefined,
        };
      },
      getItemAria: (node) => {
        if (!this.engine) {
          return { role: 'button', label: `Item ${node.id}` };
        }
        const rec = this.engine.getItemLayoutById(node.id);
        if (!rec) {
          return { role: 'button', label: `Item ${node.id}` };
        }
        const title = extractDefaultItemLabel(
          rec.item,
          rec.layoutContext.id,
          this.getLabelExtractor,
        );
        const tagSummary =
          rec.layoutContext.tags.length > 0
            ? rec.layoutContext.tags
                .slice(0, 3)
                .map((t) => {
                  if (t.label) return t.label;
                  if (this.formatTagLabelFn) {
                    const formatted = this.formatTagLabelFn(t.tag).trim();
                    if (formatted.length > 0) return formatted;
                  }
                  return t.tag;
                })
                .join(', ')
            : rec.layoutContext.unitClusters
                .slice(0, 3)
                .map((uc) => uc.cluster.defaultLabel)
                .join(', ');
        const filterNote = node.isFilteredOut ? ', dimmed by filter' : '';
        return {
          role: 'button',
          label: `Item: ${title}${tagSummary ? `, ${tagSummary}` : ''}${filterNote}`,
        };
      },
      getTriangleAria: (tr) => {
        if (!this.engine) {
          return { hidden: true };
        }
        const zState = this.engine.getZoomState();
        const isDrillable =
          zState.mode === 'drill-down' &&
          zState.drillableTriangleIndices.includes(tr.index);
        const isFocusable =
          zState.mode === 'drill-down' &&
          zState.focusableTriangleIndices.includes(tr.index);
        if (!isDrillable && !isFocusable && tr.coveredItemCount === 0) {
          return { hidden: true };
        }
        const corners = tr.clusters
          .map((c, idx) => (c ? c.defaultLabel : `Vertex ${tr.vertexIndices[idx] ?? idx}`))
          .join(', ');
        const count = tr.coveredItemCount;
        const hint = isDrillable
          ? ', press Enter to zoom in'
          : isFocusable
            ? ', press Enter to focus'
            : '';
        return {
          role: 'button',
          label: `Region: ${corners}, ${count} ${count === 1 ? 'item' : 'items'}${hint}`,
          pressed: tr.interaction.isFocused ? true : undefined,
        };
      },
    };
  }

  private targetMatches(
    a: SimplexKeyboardFocusTarget | null,
    b: SimplexInteractiveTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): boolean {
    if (!a || a.kind !== b.kind) return false;
    if (a.kind === 'triangle' && b.kind === 'triangle') {
      return a.index === b.index;
    }
    if (a.kind !== 'triangle' && b.kind !== 'triangle') {
      return a.id === b.id;
    }
    return false;
  }

  private toKeyboardTargetRef(
    target: SimplexInteractiveTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): SimplexKeyboardFocusTarget {
    if (target.kind === 'triangle') {
      return { kind: 'triangle', index: target.index };
    }
    return { kind: target.kind, id: target.id };
  }

  private applyKeyboardFocus(
    target: SimplexInteractiveTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    index: number,
    total: number,
    shouldAnnounce: boolean,
  ): void {
    const ref = this.toKeyboardTargetRef(target);
    this.keyboardFocusTarget = ref;
    this.adapter.setKeyboardFocusTarget(ref);
    const domId = this.adapter.getDomIdForTarget(ref);
    if (domId) {
      this.svgEl.setAttribute('aria-activedescendant', domId);
    } else {
      this.svgEl.removeAttribute('aria-activedescendant');
    }
    this.engine.hoverInteractiveTarget(ref);
    this.engine.renderNow();
    this.ensureLoopRunning();
    if (shouldAnnounce) {
      this.announce(`${this.formatTargetAriaLabel(target)} (${index + 1} of ${total})`);
    }
  }

  private moveKeyboardFocusToIndex(index: number, shouldAnnounce: boolean): boolean {
    const targets = this.engine.getInteractiveTargets();
    if (targets.length === 0) {
      this.clearKeyboardFocus();
      return false;
    }
    const resolvedIdx =
      index < 0
        ? targets.length - 1
        : Math.max(0, Math.min(targets.length - 1, index));
    this.applyKeyboardFocus(targets[resolvedIdx]!, resolvedIdx, targets.length, shouldAnnounce);
    return true;
  }

  private stepKeyboardFocus(delta: 1 | -1): void {
    const targets = this.engine.getInteractiveTargets();
    if (targets.length === 0) {
      this.clearKeyboardFocus();
      return;
    }
    const currentIdx = targets.findIndex((t) =>
      this.targetMatches(this.keyboardFocusTarget, t),
    );
    const nextIdx =
      currentIdx === -1
        ? delta > 0
          ? 0
          : targets.length - 1
        : (currentIdx + delta + targets.length) % targets.length;
    this.applyKeyboardFocus(targets[nextIdx]!, nextIdx, targets.length, true);
  }

  private handleZoomStateAccessibility(state: SimplexZoomState): void {
    const sig = this.computeZoomAnnouncementSig(state);
    if (this.lastAnnouncedZoomSig === null) {
      this.lastAnnouncedZoomSig = sig;
      return;
    }
    if (sig === this.lastAnnouncedZoomSig) return;
    this.lastAnnouncedZoomSig = sig;

    const targets = this.engine.getInteractiveTargets();
    const clusterCount = targets.filter((t) => t.kind === 'cluster').length;
    const itemCount = targets.filter((t) => t.kind === 'item').length;
    const triangleCount = targets.filter((t) => t.kind === 'triangle').length;
    const pathText = state.breadcrumbs.map((b) => b.label).join(' › ');
    const countsParts: string[] = [];
    if (clusterCount > 0) {
      countsParts.push(`${clusterCount} ${clusterCount === 1 ? 'cluster' : 'clusters'}`);
    }
    if (triangleCount > 0) {
      countsParts.push(`${triangleCount} ${triangleCount === 1 ? 'region' : 'regions'}`);
    }
    if (itemCount > 0) {
      countsParts.push(`${itemCount} ${itemCount === 1 ? 'item' : 'items'}`);
    }
    const countsText = countsParts.join(', ');

    if (this.keyboardFocusTarget !== null) {
      const stillValidIdx = targets.findIndex((t) =>
        this.targetMatches(this.keyboardFocusTarget, t),
      );
      if (stillValidIdx === -1) {
        if (targets.length > 0 && this.svgEl.ownerDocument.activeElement === this.svgEl) {
          this.applyKeyboardFocus(targets[0]!, 0, targets.length, false);
        } else {
          this.clearKeyboardFocus();
        }
      }
    }

    if (state.depth === 0) {
      this.announce(
        `Zoom level 0: ${pathText || 'Overview'}${countsText ? `. ${countsText}` : ''}.`,
      );
    } else {
      this.announce(
        `Zoom level ${state.depth}: ${pathText}${countsText ? `. ${countsText}` : ''}. Press Escape to zoom out.`,
      );
    }
  }

  /** Updates the `aria-label` on the root `<svg>` element at runtime. */
  setAriaLabel(label: string): void {
    this.ariaLabel = label.trim() || DEFAULT_ARIA_LABEL;
    this.syncSvgAccessibilityAttributes();
  }

  /** Enables or disables built-in keyboard navigation and focus ring tracking at runtime. */
  setKeyboardNavigation(enabled: boolean): void {
    if (this.keyboardNavigationEnabled === enabled) return;
    this.keyboardNavigationEnabled = enabled;
    if (!enabled) {
      this.clearKeyboardFocus();
    }
    this.syncSvgAccessibilityAttributes();
  }

  /** Returns the currently keyboard-focused cluster, item, or triangle target, or `null`. */
  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null {
    return this.keyboardFocusTarget;
  }

  /** Clears the active keyboard focus ring, `aria-activedescendant`, and synthetic hover tooltip. */
  clearKeyboardFocus(options?: { readonly preserveHover?: boolean }): void {
    const hadFocus = this.keyboardFocusTarget !== null;
    this.keyboardFocusTarget = null;
    this.adapter.setKeyboardFocusTarget(null);
    this.svgEl.removeAttribute('aria-activedescendant');
    if (hadFocus) {
      if (!options?.preserveHover) {
        this.hideTooltip();
        this.engine.hoverInteractiveTarget(null);
      }
      this.engine.renderNow();
      this.ensureLoopRunning();
    }
  }

  /** Returns the ordered list of currently visible, keyboard-navigable scene targets. */
  getInteractiveTargets(): readonly SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] {
    return this.engine.getInteractiveTargets();
  }

  private readonly onSvgFocus = (): void => {
    if (!this.keyboardNavigationEnabled || this.destroyed) return;
    if (this.lastInteractionWasPointer) {
      this.lastInteractionWasPointer = false;
      return;
    }
    if (this.keyboardFocusTarget === null) {
      this.moveKeyboardFocusToIndex(0, true);
    }
  };

  private readonly onSvgBlur = (): void => {
    this.lastInteractionWasPointer = false;
    this.clearKeyboardFocus();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.keyboardNavigationEnabled || this.destroyed) return;
    this.lastInteractionWasPointer = false;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.stepKeyboardFocus(1);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.stepKeyboardFocus(-1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      this.moveKeyboardFocusToIndex(0, true);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      this.moveKeyboardFocusToIndex(-1, true);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!this.keyboardFocusTarget) {
        this.moveKeyboardFocusToIndex(0, true);
        return;
      }
      const prevZoomSig = this.lastAnnouncedZoomSig;
      const prevFocusedCluster = this.focusedClusterUidState;
      const prevFocusedTri = this.focusedTriangleIndexState;
      const prevSelected = this.engine.getSelectedIds();
      const target = this.keyboardFocusTarget;
      this.engine.activateInteractiveTarget(target, {
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      });
      this.engine.renderNow();
      this.ensureLoopRunning();
      const nextSelected = this.engine.getSelectedIds();
      if (target.kind === 'item' && nextSelected.size !== prevSelected.size) {
        const nowSelected = nextSelected.has(target.id);
        const item = this.engine
          .getItems()
          .find((it) => this.getIdExtractor(it).trim() === target.id);
        const label = item
          ? extractDefaultItemLabel(item, target.id, this.getLabelExtractor)
          : target.id;
        this.announce(
          `${nowSelected ? 'Selected' : 'Deselected'} ${label} (${nextSelected.size} selected)`,
        );
      } else if (this.lastAnnouncedZoomSig === prevZoomSig) {
        if (this.focusedClusterUidState !== prevFocusedCluster) {
          if (this.focusedClusterUidState !== null) {
            const cluster = this.engine.getClusterByUid(this.focusedClusterUidState);
            this.announce(
              `Focused cluster: ${cluster?.subclusterLabel || cluster?.defaultLabel || this.focusedClusterUidState}`,
            );
          } else {
            this.announce('Cleared cluster focus');
          }
        } else if (this.focusedTriangleIndexState !== prevFocusedTri) {
          if (this.focusedTriangleIndexState !== null) {
            this.announce(`Focused region ${this.focusedTriangleIndexState + 1}`);
          } else {
            this.announce('Cleared region focus');
          }
        }
      }
      return;
    }
    if (e.key === 'Escape') {
      if (this.isMarqueeSelecting || this.marqueeArmed) {
        e.preventDefault();
        this.hideMarqueeRect();
        this.svgEl.style.cursor =
          this.engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';
        return;
      }
      if (this.engine.getZoomState().canDrillUp) {
        e.preventDefault();
        this.drillUp();
        return;
      }
      if (
        this.focusedClusterUidState !== null ||
        this.focusedTriangleIndexState !== null ||
        this.engine.getFocusedItemId() !== null
      ) {
        e.preventDefault();
        if (this.focusedClusterUidState !== null) {
          this.setFocusedClusterUid(null);
        }
        if (this.focusedTriangleIndexState !== null) {
          this.setFocusedTriangleIndex(null);
        }
        if (this.engine.getFocusedItemId() !== null) {
          this.focusItem(null);
        }
        this.announce('Cleared focus');
        return;
      }
      if (this.engine.getSelectedIds().size > 0) {
        e.preventDefault();
        this.clearSelection();
        this.announce('Cleared selection');
        return;
      }
      if (this.keyboardFocusTarget !== null) {
        e.preventDefault();
        this.clearKeyboardFocus();
      }
    }
  };

  private ensureMarqueeRect(): SVGRectElement {
    if (!this.marqueeOverlayGroup || !this.marqueeRectEl) {
      const doc = this.svgEl.ownerDocument;
      const group = doc.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'sv-marquee-overlay');
      group.setAttribute('pointer-events', 'none');
      group.setAttribute('display', 'none');

      const rect = doc.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'sv-marquee-rect');
      rect.setAttribute('rx', '3');
      rect.setAttribute('ry', '3');
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('stroke-dasharray', '4 3');
      group.appendChild(rect);
      this.svgEl.appendChild(group);

      this.marqueeOverlayGroup = group;
      this.marqueeRectEl = rect;
    }
    const isLight = this.currentTheme === 'light';
    this.marqueeRectEl.setAttribute(
      'fill',
      isLight ? 'rgba(124, 58, 237, 0.12)' : 'rgba(139, 92, 246, 0.16)',
    );
    this.marqueeRectEl.setAttribute('stroke', isLight ? '#7c3aed' : '#a78bfa');
    return this.marqueeRectEl;
  }

  private updateMarqueeRect(x1: number, y1: number, x2: number, y2: number): void {
    const rect = this.ensureMarqueeRect();
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    rect.setAttribute('x', minX.toFixed(1));
    rect.setAttribute('y', minY.toFixed(1));
    rect.setAttribute('width', width.toFixed(1));
    rect.setAttribute('height', height.toFixed(1));
    this.marqueeOverlayGroup?.removeAttribute('display');
  }

  private hideMarqueeRect(): void {
    this.marqueeArmed = false;
    this.isMarqueeSelecting = false;
    if (this.marqueeOverlayGroup) {
      this.marqueeOverlayGroup.setAttribute('display', 'none');
    }
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.lastInteractionWasPointer = true;
    if (this.keyboardFocusTarget !== null) {
      this.clearKeyboardFocus({ preserveHover: true });
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    this.activePointers.set(e.pointerId, { x, y });

    if (this.activePointers.size === 1) {
      this.pointerOriginX = e.clientX;
      this.pointerOriginY = e.clientY;
      this.pointerMaxDisplacement = 0;
      this.hasActiveGestureOrigin = true;
      this.wasMultiTouchGesture = false;
      this.panStarted = false;
      this.suppressNextClick = false;
      this.suppressClickStartPos = null;
      this.suppressClickEndPos = null;
      this.hideMarqueeRect();
      if (e.pointerType === 'touch') {
        this.touchOriginX = e.clientX;
        this.touchOriginY = e.clientY;
        this.touchScrollAxis = 'undecided';
        this.touchYieldedToScroll = false;
      }
    }

    if (this.activePointers.size >= 2) {
      this.hideMarqueeRect();
      this.isDraggingPan = false;
      this.panStarted = false;
      this.wasMultiTouchGesture = true;
      this.touchScrollAxis = 'pinch';
      const pts = [...this.activePointers.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      this.lastPinchDist = dist;
      this.pinchStartDist = dist;
      this.pinchHandledInGesture = false;
      this.lastPinchMid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
      this.hideTooltip();
      return;
    }

    if (
      this.activePointers.size === 1 &&
      e.pointerType !== 'touch' &&
      e.shiftKey &&
      this.marqueeSelectionEnabled
    ) {
      this.marqueeArmed = true;
      this.isMarqueeSelecting = false;
      this.marqueeStartX = x;
      this.marqueeStartY = y;
      this.marqueeCurrentX = x;
      this.marqueeCurrentY = y;
      this.isDraggingPan = false;
      return;
    }

    if (this.engine.getZoomStrategy().mode === 'drill-down') {
      this.isDraggingPan = false;
      return;
    }

    const hit = this.engine.hitTest(x, y);
    if (hit.kind === 'background' || hit.kind === 'triangle') {
      this.isDraggingPan = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      if (hit.kind === 'background') {
        this.svgEl.style.cursor = 'grabbing';
      }
    } else {
      this.isDraggingPan = false;
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x, y });
    }

    if (this.hasActiveGestureOrigin && this.activePointers.has(e.pointerId)) {
      const disp = Math.hypot(
        e.clientX - this.pointerOriginX,
        e.clientY - this.pointerOriginY,
      );
      if (disp > this.pointerMaxDisplacement) {
        this.pointerMaxDisplacement = disp;
      }
    }

    const zoomMode = this.engine.getZoomStrategy().mode;

    if (this.activePointers.size >= 2) {
      const pts = [...this.activePointers.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const mid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };

      if (zoomMode === 'drill-down') {
        if (
          !this.pinchHandledInGesture &&
          this.pinchStartDist !== null &&
          this.pinchStartDist > 10 &&
          dist > 8
        ) {
          const ratio = dist / this.pinchStartDist;
          if (ratio >= 1.28) {
            this.pinchHandledInGesture = true;
            this.triggerPinchDrillIn(mid.x, mid.y);
          } else if (ratio <= 0.78) {
            this.pinchHandledInGesture = true;
            this.drillUp();
          }
        }
        this.wasMultiTouchGesture = true;
        this.lastPinchDist = dist;
        this.lastPinchMid = mid;
        this.hideTooltip();
        return;
      }

      if (this.lastPinchDist !== null && this.lastPinchMid !== null && this.lastPinchDist > 8 && dist > 8) {
        const dx = mid.x - this.lastPinchMid.x;
        const dy = mid.y - this.lastPinchMid.y;
        const zoomFactor = dist / this.lastPinchDist;
        this.engine.camera.panBy(dx, dy);
        this.engine.camera.zoomToCursor(mid.x, mid.y, zoomFactor);
        this.wasMultiTouchGesture = true;
        this.hideTooltip();
        this.engine.renderNow();
      }
      this.lastPinchDist = dist;
      this.lastPinchMid = mid;
      return;
    }

    if (
      e.pointerType === 'touch' &&
      this.activePointers.size === 1 &&
      this.touchScrollLockPx > 0 &&
      this.touchScrollAxis === 'undecided'
    ) {
      const absDx = Math.abs(e.clientX - this.pointerOriginX);
      const absDy = Math.abs(e.clientY - this.pointerOriginY);
      if (absDx >= this.touchScrollLockPx || absDy >= this.touchScrollLockPx) {
        if (absDy > absDx) {
          this.touchScrollAxis = 'vertical';
          this.touchYieldedToScroll = true;
          this.isDraggingPan = false;
          this.panStarted = false;
        } else {
          this.touchScrollAxis = 'horizontal';
        }
      }
    }

    if (this.marqueeArmed && this.activePointers.has(e.pointerId)) {
      this.marqueeCurrentX = x;
      this.marqueeCurrentY = y;
      if (
        !this.isMarqueeSelecting &&
        Math.hypot(x - this.marqueeStartX, y - this.marqueeStartY) > 4
      ) {
        this.isMarqueeSelecting = true;
        this.hideTooltip();
        this.svgEl.style.cursor = 'crosshair';
      }
      if (this.isMarqueeSelecting) {
        this.updateMarqueeRect(this.marqueeStartX, this.marqueeStartY, x, y);
        return;
      }
    }

    if (this.isDraggingPan && zoomMode === 'free-camera') {
      if (
        e.pointerType === 'touch' &&
        this.touchScrollLockPx > 0 &&
        this.touchScrollAxis !== 'horizontal'
      ) {
        return;
      }
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      const panThreshold =
        e.pointerType === 'touch' ? (this.touchScrollLockPx > 0 ? 0 : 6) : 3;
      if (!this.panStarted && Math.hypot(dx, dy) > panThreshold) {
        this.panStarted = true;
      }
      if (this.panStarted) {
        this.svgEl.style.cursor = 'grabbing';
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.engine.camera.panBy(dx, dy);
        this.hideTooltip();
        this.engine.renderNow();
      }
      return;
    }

    if (e.pointerType === 'touch') {
      return;
    }
    this.engine.handlePointerMove(x, y);
    const hit = this.engine.hitTest(x, y);
    if (zoomMode === 'drill-down') {
      const zState = this.engine.getZoomState();
      if (hit.kind === 'triangle') {
        if (hit.triangle.neighborId) {
          this.svgEl.style.cursor = 'pointer';
        } else if (
          zState.activeFrameKind === 'triangle-focus' &&
          zState.canDrillUp
        ) {
          this.svgEl.style.cursor = 'zoom-out';
        } else {
          this.svgEl.style.cursor =
            zState.drillableTriangleIndices.includes(hit.triangle.index) ||
            zState.focusableTriangleIndices.includes(hit.triangle.index)
              ? 'zoom-in'
              : 'default';
        }
      } else if (hit.kind === 'cluster') {
        if (hit.neighborId) {
          this.svgEl.style.cursor = 'pointer';
        } else if (
          zState.activeFrameKind === 'cluster-star' &&
          hit.cluster.clusterIndex === 0 &&
          zState.canDrillUp
        ) {
          this.svgEl.style.cursor = 'zoom-out';
        } else {
          this.svgEl.style.cursor = zState.drillableClusterUids.includes(
            hit.cluster.clusterUid,
          )
            ? 'zoom-in'
            : 'default';
        }
      } else if (hit.kind === 'content') {
        this.svgEl.style.cursor = 'pointer';
      } else {
        this.svgEl.style.cursor = zState.canDrillUp ? 'zoom-out' : 'default';
      }
    } else {
      this.svgEl.style.cursor = hit.kind === 'background' ? 'grab' : 'pointer';
    }
    this.ensureLoopRunning();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.resetTouchPinchState();
    }
    if (this.activePointers.size === 0) {
      const completedMarquee = this.isMarqueeSelecting;
      if (completedMarquee) {
        const prevSize = this.engine.getSelectedIds().size;
        const nextSelected = this.engine.selectItemsInScreenRect(
          this.marqueeStartX,
          this.marqueeStartY,
          this.marqueeCurrentX,
          this.marqueeCurrentY,
          { mode: e.altKey ? 'toggle' : 'add' },
        );
        this.engine.renderNow();
        this.ensureLoopRunning();
        if (nextSelected.size !== prevSize) {
          this.announce(
            `Selected ${nextSelected.size} item${nextSelected.size === 1 ? '' : 's'}`,
          );
        }
        this.svgEl.style.cursor =
          this.engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';
      }
      this.hideMarqueeRect();

      const shouldSuppress =
        completedMarquee ||
        this.pointerMaxDisplacement > this.clickTolerancePx ||
        this.touchYieldedToScroll ||
        this.wasMultiTouchGesture;
      if (shouldSuppress) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.suppressNextClick = true;
        this.suppressClickStartPos = this.wasMultiTouchGesture
          ? null
          : { x: this.pointerOriginX, y: this.pointerOriginY };
        this.suppressClickEndPos = { x: e.clientX, y: e.clientY };
        this.suppressClickDeadline = now + 400;
      } else {
        this.suppressNextClick = false;
        this.suppressClickStartPos = null;
        this.suppressClickEndPos = null;
      }
      if (this.isDraggingPan) {
        this.isDraggingPan = false;
        this.svgEl.style.cursor =
          this.engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';
      }
      this.panStarted = false;
      this.hasActiveGestureOrigin = false;
      this.wasMultiTouchGesture = false;
      this.touchYieldedToScroll = false;
      this.touchScrollAxis = 'undecided';
    }
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.resetTouchPinchState();
    }
    if (this.activePointers.size === 0) {
      this.hideMarqueeRect();
      this.isDraggingPan = false;
      this.panStarted = false;
      this.hasActiveGestureOrigin = false;
      this.wasMultiTouchGesture = false;
      this.touchYieldedToScroll = false;
      this.touchScrollAxis = 'undecided';
      this.suppressNextClick = false;
      this.suppressClickStartPos = null;
      this.suppressClickEndPos = null;
      this.svgEl.style.cursor =
        this.engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';
    }
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.resetTouchPinchState();
    }
    if (this.activePointers.size === 0) {
      this.hideMarqueeRect();
      this.isDraggingPan = false;
      this.panStarted = false;
    }
    this.hideTooltip();
    this.engine.handlePointerLeave();
    this.ensureLoopRunning();
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const matchTol = Math.max(24, this.clickTolerancePx * 2);
      const matchesEnd =
        this.suppressClickEndPos !== null &&
        Math.hypot(
          e.clientX - this.suppressClickEndPos.x,
          e.clientY - this.suppressClickEndPos.y,
        ) <= matchTol;
      const matchesStart =
        this.suppressClickStartPos !== null &&
        Math.hypot(
          e.clientX - this.suppressClickStartPos.x,
          e.clientY - this.suppressClickStartPos.y,
        ) <= matchTol;
      this.suppressClickStartPos = null;
      this.suppressClickEndPos = null;
      if (now <= this.suppressClickDeadline && (matchesEnd || matchesStart)) {
        return;
      }
    }
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    this.engine.handleLeftClick({
      screenX: x,
      screenY: y,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    this.engine.renderNow();
    this.ensureLoopRunning();
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    const suppress = this.engine.handleRightClick({
      screenX: x,
      screenY: y,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    if (suppress) {
      e.preventDefault();
    }
    this.ensureLoopRunning();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    const { x, y } = this.toLocalCoords(e.clientX, e.clientY);
    // Support discrete trackpad pinch-in / pinch-out when in drill-down mode
    if (this.engine.getZoomStrategy().mode === 'drill-down' && e.ctrlKey) {
      e.preventDefault();
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now < this.wheelPinchCooldownUntil) return;
      this.wheelPinchAccum += e.deltaY;
      if (this.wheelPinchAccum <= -22) {
        this.wheelPinchAccum = 0;
        this.wheelPinchCooldownUntil = now + 360;
        this.triggerPinchDrillIn(x, y);
      } else if (this.wheelPinchAccum >= 22) {
        this.wheelPinchAccum = 0;
        this.wheelPinchCooldownUntil = now + 360;
        this.drillUp();
      }
      return;
    }
    const handled = this.engine.handleWheel({
      screenX: x,
      screenY: y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
    });
    if (handled) {
      e.preventDefault();
      this.ensureLoopRunning();
    }
  };

  private attachSvgListeners(): void {
    this.svgEl.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.svgEl.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.svgEl.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.svgEl.addEventListener('touchcancel', this.onTouchCancel, { passive: true });
    this.svgEl.addEventListener('pointerdown', this.onPointerDown);
    this.svgEl.addEventListener('pointermove', this.onPointerMove);
    this.svgEl.addEventListener('pointerup', this.onPointerUp);
    this.svgEl.addEventListener('pointercancel', this.onPointerCancel);
    this.svgEl.addEventListener('pointerleave', this.onPointerLeave);
    this.svgEl.addEventListener('click', this.onClick);
    this.svgEl.addEventListener('contextmenu', this.onContextMenu);
    this.svgEl.addEventListener('wheel', this.onWheel, { passive: false });
    this.svgEl.addEventListener('focus', this.onSvgFocus);
    this.svgEl.addEventListener('blur', this.onSvgBlur);
    this.svgEl.addEventListener('keydown', this.onKeyDown);
  }

  private detachSvgListeners(): void {
    this.svgEl.removeEventListener('touchstart', this.onTouchStart);
    this.svgEl.removeEventListener('touchmove', this.onTouchMove);
    this.svgEl.removeEventListener('touchend', this.onTouchEnd);
    this.svgEl.removeEventListener('touchcancel', this.onTouchCancel);
    this.svgEl.removeEventListener('pointerdown', this.onPointerDown);
    this.svgEl.removeEventListener('pointermove', this.onPointerMove);
    this.svgEl.removeEventListener('pointerup', this.onPointerUp);
    this.svgEl.removeEventListener('pointercancel', this.onPointerCancel);
    this.svgEl.removeEventListener('pointerleave', this.onPointerLeave);
    this.svgEl.removeEventListener('click', this.onClick);
    this.svgEl.removeEventListener('contextmenu', this.onContextMenu);
    this.svgEl.removeEventListener('wheel', this.onWheel);
    this.svgEl.removeEventListener('focus', this.onSvgFocus);
    this.svgEl.removeEventListener('blur', this.onSvgBlur);
    this.svgEl.removeEventListener('keydown', this.onKeyDown);
  }

  private ensureLoopRunning(): void {
    if (this.destroyed || this.rafId !== null || this.controllerBatchDepth > 0) return;
    if (typeof requestAnimationFrame === 'undefined') {
      this.engine.renderNow();
      return;
    }
    this.lastFrameTs = performance.now();
    const tick = (now: number) => {
      if (this.destroyed) return;
      const dtMs = Math.max(1, Math.min(50, now - this.lastFrameTs));
      this.lastFrameTs = now;

      this.fpsSamples += 1;
      this.fpsAccumMs += dtMs;
      if (this.fpsAccumMs >= 320) {
        const fps = Math.round((this.fpsSamples * 1000) / this.fpsAccumMs);
        this.onFpsUpdate?.(fps);
        this.fpsSamples = 0;
        this.fpsAccumMs = 0;
      }

      this.timelineController?.tick(dtMs);
      const settled = this.engine.step(dtMs);
      const timelinePlaying = this.timelineController?.getState().playing ?? false;
      if (!settled || timelinePlaying) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Helper accessor matching `getId` when external callers inspect items. */
  getItemId(item: TItem): string {
    return this.getIdExtractor(item);
  }

  private clearDeferFallbackTimer(): void {
    if (this.deferFallbackTimer !== null) {
      clearTimeout(this.deferFallbackTimer);
      this.deferFallbackTimer = null;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearDeferFallbackTimer();
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.detachTimelineController();
    this.timelineStateListeners.clear();
    this.resizeObserver?.disconnect();
    this.fontLoadCleanup?.();
    this.fontLoadCleanup = null;
    this.detachReducedMotionMediaSubscription();
    this.hideMarqueeRect();
    this.marqueeOverlayGroup = null;
    this.marqueeRectEl = null;
    this.detachSvgListeners();
    this.engine.destroy();
    this.hideTooltip();
    if (this.tooltipEl && this.tooltipEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.tooltipEl);
      this.tooltipEl = null;
    }
    if (this.breadcrumbOverlayEl && this.breadcrumbOverlayEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.breadcrumbOverlayEl);
      this.breadcrumbOverlayEl = null;
    }
    if (this.srAnnouncerEl && this.srAnnouncerEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.srAnnouncerEl);
      this.srAnnouncerEl = null;
    }
    if (this.timelineOverlayEl && this.timelineOverlayEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.timelineOverlayEl);
      this.timelineOverlayEl = null;
      this.timelineUiRefs = null;
    }
    if (this.svgEl.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.svgEl);
    }
  }
}

/**
 * Convenience one-liner factory for mounting `@simplex-viz/svg` in Vanilla TypeScript,
 * Vue, Angular, Svelte, or Web Components.
 *
 * Accepts either an array of `{ id, tags }` items directly (with built-in presets,
 * cursor zoom, and cluster click-focus enabled) or a full options object.
 */
export function createSimplexSvg<TItem extends DefaultTaggedItem = DefaultTaggedItem>(
  target: HTMLElement | string,
  items: readonly TItem[],
): SimplexSvgController<TItem, DefaultContentPresetVisual, DefaultClusterPresetVisual>;
export function createSimplexSvg<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  target: HTMLElement | string,
  options: SimplexSvgControllerOptions<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): SimplexSvgController<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;
export function createSimplexSvg<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  target: HTMLElement | string,
  itemsOrOptions:
    | readonly TItem[]
    | SimplexSvgControllerOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
): SimplexSvgController<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> {
  if (Array.isArray(itemsOrOptions)) {
    return SimplexSvgController.createFromResolved(target, {
      items: itemsOrOptions,
      tooltip: true,
    });
  }
  return new SimplexSvgController(
    target,
    itemsOrOptions as SimplexSvgControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  );
}
