import type {
  CameraController,
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterHoverEvent,
  ContentHoverEvent,
  DefaultTaggedItem,
  EmptyClusterBehavior,
  FocusItemOptions,
  HitTarget,
  InteractionHandlers,
  ItemFilterMode,
  ItemFilterOptions,
  ItemFilterPredicate,
  ItemFilterState,
  LayoutMetrics,
  LayoutSolverOptions,
  MeshOptions,
  NormalizedPointerEvent,
  ReducedMotionPreference,
  RestoreViewStateOptions,
  SelectInRectOptions,
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexKeyboardFocusTarget,
  SimplexLayoutStrategy,
  SimplexLegendModel,
  SimplexLegendModelOptions,
  SimplexMeshStrategy,
  SimplexTimelineController,
  SimplexTimelineState,
  SimplexViewState,
  SimplexZoomState,
  SimplexZoomStrategy,
  TriangleHoverEvent,
  VisualResolver,
  ZoomToItemOptions,
} from '@simplex-viz/core';
import {
  SimplexSvgController,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type DeferInitialLayoutOptions,
  type ExportPngBlobOptions,
  type ExportPngDataUrlOptions,
  type ExportPngOptions,
  type ExportSvgOptions,
  type GeometricShapeSvgViewOptions,
  type PresetBadgeClusterOptions,
  type PresetContentShapeOption,
  type SimplexSvgControllerOptions,
  type SimplexSvgTooltipOption,
  type SimplexSvgUpdateOptions,
  type SimplexTheme,
  type SimplexVisualPreset,
  type SvgEdgeView,
  type SvgNodeView,
  type SvgTriangleView,
  type TimelinePlayerOptions,
} from '@simplex-viz/svg';

/**
 * Default Custom Element tag name registered by `defineSimplexTopicGraphElement()`
 * and `@simplex-viz/wc/define`.
 */
export const DEFAULT_SIMPLEX_TAG_NAME = 'simplex-topic-graph';

/**
 * Rendering backend identifier for `<simplex-topic-graph>`.
 * Currently supports `'svg'` (reserved for future `'canvas'` support).
 */
export type SimplexWcRenderer = 'svg';

/**
 * SSR-safe base constructor resolving to native `HTMLElement` in browsers and
 * an empty class stub in Node/SSR environments where `HTMLElement` is undefined.
 */
export const SsrSafeHTMLElement: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

/**
 * Detail payload emitted by the `simplex-click` CustomEvent.
 * Call `event.preventDefault()` inside a listener to consume the click and suppress
 * built-in drill-down or focus toggling.
 */
export interface SimplexClickEventDetail<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly kind: HitTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >['kind'];
  readonly target: HitTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly rawEvent: NormalizedPointerEvent;
}

/**
 * Detail payload emitted by the `simplex-hover` CustomEvent.
 * Call `event.preventDefault()` inside a listener to suppress the built-in DOM tooltip.
 */
export type SimplexHoverEventDetail<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> =
  | {
      readonly kind: 'content';
      readonly event: ContentHoverEvent<
        TItem,
        TContentVisual,
        TTagMeta,
        TClusterMeta
      >;
    }
  | {
      readonly kind: 'cluster';
      readonly event: ClusterHoverEvent<
        TItem,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >;
    }
  | {
      readonly kind: 'triangle';
      readonly event: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta>;
    }
  | {
      readonly kind: null;
      readonly event: null;
    };

/**
 * Detail payload emitted by the `simplex-selection-change` CustomEvent.
 */
export interface SimplexSelectionChangeDetail {
  /** Immutable snapshot of currently selected item IDs. */
  readonly selectedIds: ReadonlySet<string>;
  /** Deterministically sorted array copy of selected item IDs. */
  readonly ids: readonly string[];
}

const OBSERVED_ATTRIBUTES = [
  'preset',
  'theme',
  'renderer',
  'tooltip',
  'aria-label',
  'keyboard-navigation',
  'reduced-motion',
  'marquee-selection',
  'shift-click-selects',
  'show-zoom-breadcrumbs',
  'show-hulls',
  'empty-cluster-behavior',
  'defer-initial-layout',
  'item-filter-mode',
  'touch-scroll-lock-px',
  'click-tolerance-px',
  'focus-on-cluster-click',
  'focus-on-triangle-click',
  'relayout-on-font-load',
  'timeline',
  'items',
  'selected-ids',
  'highlighted-ids',
  'pinned-ids',
] as const;

type ObservedAttributeName = (typeof OBSERVED_ATTRIBUTES)[number];

const UPGRADEABLE_PROPERTIES = [
  'items',
  'getId',
  'getTags',
  'getLabel',
  'normalizeTag',
  'formatTagLabel',
  'resolveTagMeta',
  'deriveClusterMeta',
  'preset',
  'theme',
  'renderer',
  'visualResolver',
  'contentView',
  'clusterView',
  'triangleView',
  'edgeView',
  'badgeOptions',
  'getShape',
  'shapeOptions',
  'meshOptions',
  'layoutOptions',
  'meshStrategy',
  'clusteringStrategy',
  'colorStrategy',
  'layoutStrategy',
  'zoomStrategy',
  'showHulls',
  'emptyClusterBehavior',
  'itemFilter',
  'itemFilterMode',
  'showZoomBreadcrumbs',
  'timeline',
  'relayoutOnFontLoad',
  'deferInitialLayout',
  'touchScrollLockPx',
  'clickTolerancePx',
  'focusOnClusterClick',
  'focusOnTriangleClick',
  'tooltip',
  'ariaLabel',
  'keyboardNavigation',
  'reducedMotion',
  'selectedIds',
  'highlightedIds',
  'pinnedIds',
  'marqueeSelection',
  'shiftClickSelects',
  'focusedItemId',
  'focusedClusterUid',
  'focusedTriangleIndex',
  'interactions',
] as const;

function parseBooleanAttr(raw: string | null, defaultValue: boolean): boolean {
  if (raw === null) return defaultValue;
  const norm = raw.trim().toLowerCase();
  if (norm === '' || norm === 'true' || norm === '1' || norm === 'yes') return true;
  if (norm === 'false' || norm === '0' || norm === 'no') return false;
  return defaultValue;
}

function parseReducedMotionAttr(raw: string | null): ReducedMotionPreference {
  if (raw === null) return 'auto';
  const norm = raw.trim().toLowerCase();
  if (norm === '' || norm === 'true' || norm === '1' || norm === 'reduce') return true;
  if (norm === 'false' || norm === '0' || norm === 'no-preference') return false;
  return 'auto';
}

function parsePresetAttr(raw: string | null): SimplexVisualPreset | undefined {
  if (raw === 'geometric' || raw === 'badges' || raw === 'glyphs') return raw;
  return undefined;
}

function parseThemeAttr(raw: string | null): SimplexTheme | undefined {
  if (raw === 'dark' || raw === 'light') return raw;
  return undefined;
}

function parseEmptyClusterBehaviorAttr(
  raw: string | null,
): EmptyClusterBehavior | undefined {
  if (raw === 'normal' || raw === 'dim' || raw === 'hide') return raw;
  return undefined;
}

function parseItemFilterModeAttr(raw: string | null): ItemFilterMode | undefined {
  if (raw === 'dim' || raw === 'hide') return raw;
  return undefined;
}

function parseDeferInitialLayoutAttr(
  raw: string | null,
): boolean | DeferInitialLayoutOptions | undefined {
  if (raw === null) return undefined;
  const norm = raw.trim().toLowerCase();
  if (norm === '' || norm === 'true') return true;
  if (norm === 'false') return false;
  const ms = Number(norm);
  if (Number.isFinite(ms) && ms >= 0) {
    return { fallbackTimeoutMs: ms };
  }
  return undefined;
}

function parseFiniteNumberAttr(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseIdListAttr(raw: string | null): string[] | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {
      return null;
    }
  }
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseItemsJson<TItem>(raw: string | null): readonly TItem[] | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as readonly TItem[]) : null;
  } catch {
    return null;
  }
}

/**
 * Framework-agnostic Custom Element (`<simplex-topic-graph>`) wrapping `SimplexSvgController`
 * in Light DOM so SVG `getBBox()` measurement, webfonts, CSS inheritance, and SVG/PNG export
 * work seamlessly across plain HTML, Vue, Svelte, Angular, Astro, and static-site generators.
 */
export class SimplexTopicGraphElement<
  TItem = DefaultTaggedItem,
  TContentVisual = DefaultContentPresetVisual,
  TClusterVisual = DefaultClusterPresetVisual,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> extends SsrSafeHTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  private _controller: SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null = null;
  private _stageEl: HTMLDivElement | null = null;
  private _timelineUnsubscribe: (() => void) | null = null;
  private _lastHoverWasActive = false;

  // Backed state (works pre-connect, pre-upgrade, and across reconnects)
  private _items: readonly TItem[] = [];
  private _itemsExplicitlySet = false;
  private _getId?: (item: TItem) => string;
  private _getTags?: (item: TItem) => readonly string[];
  private _getLabel?: (item: TItem) => string;
  private _normalizeTag?: (rawTag: string) => string;
  private _formatTagLabel?: (tag: string) => string;
  private _resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  private _deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;

  private _preset: SimplexVisualPreset = 'geometric';
  private _theme: SimplexTheme = 'dark';
  private _renderer: SimplexWcRenderer = 'svg';
  private _visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  private _contentView?: SvgNodeView<TContentVisual>;
  private _clusterView?: SvgNodeView<TClusterVisual>;
  private _triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
  private _edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
  private _badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  private _getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  private _shapeOptions?: GeometricShapeSvgViewOptions;

  private _meshOptions?: MeshOptions;
  private _layoutOptions?: LayoutSolverOptions;
  private _meshStrategy?: SimplexMeshStrategy<TItem>;
  private _clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  private _colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  private _layoutStrategy?: SimplexLayoutStrategy;
  private _zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;

  private _showHulls = false;
  private _emptyClusterBehavior: EmptyClusterBehavior = 'normal';
  private _itemFilter: ItemFilterPredicate<TItem> | null = null;
  private _itemFilterMode: ItemFilterMode = 'dim';
  private _showZoomBreadcrumbs = true;
  private _timeline: boolean | TimelinePlayerOptions<TItem> = false;
  private _relayoutOnFontLoad = true;
  private _deferInitialLayout: boolean | DeferInitialLayoutOptions = false;
  private _touchScrollLockPx?: number;
  private _clickTolerancePx?: number;
  private _focusOnClusterClick = true;
  private _focusOnTriangleClick = true;
  private _tooltip: SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > = false;
  private _ariaLabel?: string;
  private _keyboardNavigation = true;
  private _reducedMotion: ReducedMotionPreference = 'auto';
  private _marqueeSelection = true;
  private _shiftClickSelects = true;

  private _selectedIds: Iterable<string> | null = null;
  private _highlightedIds: Iterable<string> | null = null;
  private _pinnedIds: ReadonlySet<string> | readonly string[] | null = null;
  private _focusedItemId: string | null = null;
  private _focusedClusterUid: string | null = null;
  private _focusedTriangleIndex: number | null = null;

  private _userInteractions?: InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;

  connectedCallback(): void {
    this.upgradePreExistingProperties();
    this.syncAttributesBeforeMount();
    this.ensureMounted();
  }

  disconnectedCallback(): void {
    this.teardownController();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    this.applyAttribute(name as ObservedAttributeName, newValue);
  }

  // ---------------------------------------------------------------------------
  // Read-only live accessors
  // ---------------------------------------------------------------------------

  /** Active underlying `SimplexSvgController` instance while connected to the DOM. */
  get controller(): SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null {
    return this._controller;
  }

  /** Active affine 2D camera controller while connected to the DOM. */
  get camera(): CameraController | null {
    return this._controller?.camera ?? null;
  }

  /** Active timeline playback controller when `timeline` is enabled. */
  get timelineController(): SimplexTimelineController<TItem> | null {
    return this._controller?.timeline ?? null;
  }

  // ---------------------------------------------------------------------------
  // Typed JS Properties (synced cleanly to live controller when mounted)
  // ---------------------------------------------------------------------------

  get items(): readonly TItem[] {
    return this._controller ? this._controller.getItems() : this._items;
  }
  set items(value: readonly TItem[]) {
    this._items = Array.isArray(value) ? value : [];
    this._itemsExplicitlySet = true;
    this._controller?.setItems(this._items);
  }

  get getId(): ((item: TItem) => string) | undefined {
    return this._getId;
  }
  set getId(fn: ((item: TItem) => string) | undefined) {
    this._getId = fn;
    if (this._controller) this.remountController();
  }

  get getTags(): ((item: TItem) => readonly string[]) | undefined {
    return this._getTags;
  }
  set getTags(fn: ((item: TItem) => readonly string[]) | undefined) {
    this._getTags = fn;
    if (this._controller) this.remountController();
  }

  get getLabel(): ((item: TItem) => string) | undefined {
    return this._getLabel;
  }
  set getLabel(fn: ((item: TItem) => string) | undefined) {
    this._getLabel = fn;
    this._controller?.setOptions({ getLabel: fn });
  }

  get normalizeTag(): ((rawTag: string) => string) | undefined {
    return this._normalizeTag;
  }
  set normalizeTag(fn: ((rawTag: string) => string) | undefined) {
    this._normalizeTag = fn;
    if (this._controller) this.remountController();
  }

  get formatTagLabel(): ((tag: string) => string) | undefined {
    return this._formatTagLabel;
  }
  set formatTagLabel(fn: ((tag: string) => string) | undefined) {
    this._formatTagLabel = fn;
    if (this._controller) this.remountController();
  }

  get resolveTagMeta(): ((normalizedTag: string) => TTagMeta | undefined) | undefined {
    return this._resolveTagMeta;
  }
  set resolveTagMeta(fn: ((normalizedTag: string) => TTagMeta | undefined) | undefined) {
    this._resolveTagMeta = fn;
    if (this._controller) this.remountController();
  }

  get deriveClusterMeta():
    | ((ctx: ClusterDerivationContext<TItem, TTagMeta>) => TClusterMeta)
    | undefined {
    return this._deriveClusterMeta;
  }
  set deriveClusterMeta(
    fn: ((ctx: ClusterDerivationContext<TItem, TTagMeta>) => TClusterMeta) | undefined,
  ) {
    this._deriveClusterMeta = fn;
    if (this._controller) this.remountController();
  }

  get preset(): SimplexVisualPreset {
    return this._preset;
  }
  set preset(value: SimplexVisualPreset) {
    if (value !== 'geometric' && value !== 'badges' && value !== 'glyphs') return;
    this._preset = value;
    this._controller?.setOptions({ preset: value });
  }

  get theme(): SimplexTheme {
    return this._theme;
  }
  set theme(value: SimplexTheme) {
    if (value !== 'dark' && value !== 'light') return;
    this._theme = value;
    this._controller?.setOptions({ theme: value });
  }

  get renderer(): SimplexWcRenderer {
    return this._renderer;
  }
  set renderer(value: SimplexWcRenderer) {
    if (value === 'svg') {
      this._renderer = value;
    }
  }

  get visualResolver():
    | VisualResolver<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>
    | undefined {
    return this._visualResolver;
  }
  set visualResolver(
    value:
      | VisualResolver<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>
      | null
      | undefined,
  ) {
    this._visualResolver = value ?? undefined;
    this._controller?.setOptions({ visualResolver: value ?? null });
  }

  get contentView(): SvgNodeView<TContentVisual> | undefined {
    return this._contentView;
  }
  set contentView(value: SvgNodeView<TContentVisual> | null | undefined) {
    this._contentView = value ?? undefined;
    this._controller?.setOptions({ contentView: value ?? null });
  }

  get clusterView(): SvgNodeView<TClusterVisual> | undefined {
    return this._clusterView;
  }
  set clusterView(value: SvgNodeView<TClusterVisual> | null | undefined) {
    this._clusterView = value ?? undefined;
    this._controller?.setOptions({ clusterView: value ?? null });
  }

  get triangleView(): SvgTriangleView<TItem, TTagMeta, TClusterMeta> | undefined {
    return this._triangleView;
  }
  set triangleView(value: SvgTriangleView<TItem, TTagMeta, TClusterMeta> | undefined) {
    this._triangleView = value;
    if (value) this._controller?.setOptions({ triangleView: value });
  }

  get edgeView(): SvgEdgeView<TItem, TTagMeta, TClusterMeta> | undefined {
    return this._edgeView;
  }
  set edgeView(value: SvgEdgeView<TItem, TTagMeta, TClusterMeta> | undefined) {
    this._edgeView = value;
    if (value) this._controller?.setOptions({ edgeView: value });
  }

  get badgeOptions():
    | PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>
    | undefined {
    return this._badgeOptions;
  }
  set badgeOptions(
    value: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta> | undefined,
  ) {
    this._badgeOptions = value;
    this._controller?.setOptions({ badgeOptions: value });
  }

  get getShape():
    | PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>
    | undefined {
    return this._getShape;
  }
  set getShape(
    value: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta> | undefined,
  ) {
    this._getShape = value;
    this._controller?.setOptions({ getShape: value });
  }

  get shapeOptions(): GeometricShapeSvgViewOptions | undefined {
    return this._shapeOptions;
  }
  set shapeOptions(value: GeometricShapeSvgViewOptions | undefined) {
    this._shapeOptions = value;
    this._controller?.setOptions({ shapeOptions: value });
  }

  get meshOptions(): MeshOptions | undefined {
    return this._meshOptions;
  }
  set meshOptions(value: MeshOptions | undefined) {
    this._meshOptions = value;
    if (value) this._controller?.setOptions({ meshOptions: value });
  }

  get layoutOptions(): LayoutSolverOptions | undefined {
    return this._layoutOptions;
  }
  set layoutOptions(value: LayoutSolverOptions | undefined) {
    this._layoutOptions = value;
    if (value) this._controller?.setOptions({ layoutOptions: value });
  }

  get meshStrategy(): SimplexMeshStrategy<TItem> | undefined {
    return this._meshStrategy;
  }
  set meshStrategy(value: SimplexMeshStrategy<TItem> | undefined) {
    this._meshStrategy = value;
    if (value) this._controller?.setOptions({ meshStrategy: value });
  }

  get clusteringStrategy(): SimplexClusteringStrategy<TItem, TTagMeta> | undefined {
    return this._clusteringStrategy;
  }
  set clusteringStrategy(value: SimplexClusteringStrategy<TItem, TTagMeta> | undefined) {
    this._clusteringStrategy = value;
    if (value) this._controller?.setOptions({ clusteringStrategy: value });
  }

  get colorStrategy(): SimplexColorStrategy<TItem, TTagMeta> | undefined {
    return this._colorStrategy;
  }
  set colorStrategy(value: SimplexColorStrategy<TItem, TTagMeta> | undefined) {
    this._colorStrategy = value;
    if (value) this._controller?.setOptions({ colorStrategy: value });
  }

  get layoutStrategy(): SimplexLayoutStrategy | undefined {
    return this._layoutStrategy;
  }
  set layoutStrategy(value: SimplexLayoutStrategy | undefined) {
    this._layoutStrategy = value;
    if (value) this._controller?.setOptions({ layoutStrategy: value });
  }

  get zoomStrategy(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> | undefined {
    return this._zoomStrategy;
  }
  set zoomStrategy(
    value: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> | undefined,
  ) {
    this._zoomStrategy = value;
    if (value) this._controller?.setOptions({ zoomStrategy: value });
  }

  get showHulls(): boolean {
    return this._showHulls;
  }
  set showHulls(value: boolean) {
    this._showHulls = Boolean(value);
    this._controller?.setOptions({ showHulls: this._showHulls });
  }

  get emptyClusterBehavior(): EmptyClusterBehavior {
    return this._emptyClusterBehavior;
  }
  set emptyClusterBehavior(value: EmptyClusterBehavior) {
    if (value !== 'normal' && value !== 'dim' && value !== 'hide') return;
    this._emptyClusterBehavior = value;
    this._controller?.setOptions({ emptyClusterBehavior: value });
  }

  get itemFilter(): ItemFilterPredicate<TItem> | null {
    return this._itemFilter;
  }
  set itemFilter(value: ItemFilterPredicate<TItem> | null) {
    this._itemFilter = value ?? null;
    this._controller?.setItemFilter(this._itemFilter, { mode: this._itemFilterMode });
  }

  get itemFilterMode(): ItemFilterMode {
    return this._itemFilterMode;
  }
  set itemFilterMode(value: ItemFilterMode) {
    if (value !== 'dim' && value !== 'hide') return;
    this._itemFilterMode = value;
    this._controller?.setOptions({ itemFilterMode: value });
  }

  get showZoomBreadcrumbs(): boolean {
    return this._showZoomBreadcrumbs;
  }
  set showZoomBreadcrumbs(value: boolean) {
    this._showZoomBreadcrumbs = Boolean(value);
    this._controller?.setOptions({ showZoomBreadcrumbs: this._showZoomBreadcrumbs });
  }

  get timeline(): boolean | TimelinePlayerOptions<TItem> {
    return this._timeline;
  }
  set timeline(value: boolean | TimelinePlayerOptions<TItem>) {
    this._timeline = value;
    if (this._controller) {
      this._controller.setOptions({ timeline: this.wrapTimelineOption(value) });
      this.syncTimelineSubscription();
    }
  }

  get relayoutOnFontLoad(): boolean {
    return this._relayoutOnFontLoad;
  }
  set relayoutOnFontLoad(value: boolean) {
    this._relayoutOnFontLoad = Boolean(value);
  }

  get deferInitialLayout(): boolean | DeferInitialLayoutOptions {
    return this._deferInitialLayout;
  }
  set deferInitialLayout(value: boolean | DeferInitialLayoutOptions) {
    this._deferInitialLayout = value;
  }

  get touchScrollLockPx(): number | undefined {
    return this._touchScrollLockPx;
  }
  set touchScrollLockPx(value: number | undefined) {
    this._touchScrollLockPx = value;
    if (value !== undefined) this._controller?.setOptions({ touchScrollLockPx: value });
  }

  get clickTolerancePx(): number | undefined {
    return this._clickTolerancePx;
  }
  set clickTolerancePx(value: number | undefined) {
    this._clickTolerancePx = value;
    if (value !== undefined) this._controller?.setOptions({ clickTolerancePx: value });
  }

  get focusOnClusterClick(): boolean {
    return this._focusOnClusterClick;
  }
  set focusOnClusterClick(value: boolean) {
    this._focusOnClusterClick = Boolean(value);
  }

  get focusOnTriangleClick(): boolean {
    return this._focusOnTriangleClick;
  }
  set focusOnTriangleClick(value: boolean) {
    this._focusOnTriangleClick = Boolean(value);
  }

  get tooltip(): SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return this._tooltip;
  }
  set tooltip(
    value: SimplexSvgTooltipOption<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) {
    this._tooltip = value;
    this._controller?.setOptions({ tooltip: value });
  }

  override get ariaLabel(): string | null {
    return this._ariaLabel ?? null;
  }
  override set ariaLabel(value: string | null) {
    this._ariaLabel = value ?? undefined;
    if (this._ariaLabel !== undefined) {
      this._controller?.setOptions({ ariaLabel: this._ariaLabel });
    }
  }

  get keyboardNavigation(): boolean {
    return this._keyboardNavigation;
  }
  set keyboardNavigation(value: boolean) {
    this._keyboardNavigation = Boolean(value);
    this._controller?.setOptions({ keyboardNavigation: this._keyboardNavigation });
  }

  get reducedMotion(): ReducedMotionPreference {
    return this._controller
      ? this._controller.getReducedMotion()
      : this._reducedMotion;
  }
  set reducedMotion(value: ReducedMotionPreference) {
    this._reducedMotion = value;
    this._controller?.setReducedMotion(value);
  }

  get marqueeSelection(): boolean {
    return this._marqueeSelection;
  }
  set marqueeSelection(value: boolean) {
    this._marqueeSelection = Boolean(value);
    this._controller?.setOptions({ marqueeSelection: this._marqueeSelection });
  }

  get shiftClickSelects(): boolean {
    return this._shiftClickSelects;
  }
  set shiftClickSelects(value: boolean) {
    this._shiftClickSelects = Boolean(value);
    this._controller?.setOptions({ shiftClickSelects: this._shiftClickSelects });
  }

  get selectedIds(): ReadonlySet<string> {
    if (this._controller) return this._controller.getSelectedIds();
    return this._selectedIds ? new Set(this._selectedIds) : new Set();
  }
  set selectedIds(value: Iterable<string> | null) {
    this._selectedIds = value;
    this._controller?.setSelectedIds(value);
  }

  get highlightedIds(): ReadonlySet<string> {
    if (this._controller) return this._controller.getHighlightedIds();
    return this._highlightedIds ? new Set(this._highlightedIds) : new Set();
  }
  set highlightedIds(value: Iterable<string> | null) {
    this._highlightedIds = value;
    this._controller?.setHighlightedIds(value);
  }

  get pinnedIds(): ReadonlySet<string> {
    if (this._controller) return new Set(this._controller.getViewState().pinnedIds);
    return this._pinnedIds ? new Set(this._pinnedIds) : new Set();
  }
  set pinnedIds(value: ReadonlySet<string> | readonly string[] | null) {
    this._pinnedIds = value;
    this._controller?.setPinnedIds(value ?? []);
  }

  get focusedItemId(): string | null {
    return this._controller ? this._controller.getFocusedItemId() : this._focusedItemId;
  }
  set focusedItemId(value: string | null) {
    this._focusedItemId = value;
    this._controller?.focusItem(value);
  }

  get focusedClusterUid(): string | null {
    return this._controller
      ? this._controller.getViewState().focusedClusterUid
      : this._focusedClusterUid;
  }
  set focusedClusterUid(value: string | null) {
    this._focusedClusterUid = value;
    this._controller?.setFocusedClusterUid(value);
  }

  get focusedTriangleIndex(): number | null {
    return this._controller
      ? this._controller.getViewState().focusedTriangleIndex
      : this._focusedTriangleIndex;
  }
  set focusedTriangleIndex(value: number | null) {
    this._focusedTriangleIndex = value;
    this._controller?.setFocusedTriangleIndex(value);
  }

  get interactions():
    | InteractionHandlers<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >
    | undefined {
    return this._userInteractions;
  }
  set interactions(
    value:
      | InteractionHandlers<
          TItem,
          TContentVisual,
          TClusterVisual,
          TTagMeta,
          TClusterMeta
        >
      | undefined,
  ) {
    this._userInteractions = value;
    this._controller?.setOptions({ interactions: this.buildComposedInteractions() });
  }

  // ---------------------------------------------------------------------------
  // Delegated Imperative Methods
  // ---------------------------------------------------------------------------

  addItems(items: TItem | readonly TItem[]): void {
    const arr = Array.isArray(items) ? (items as readonly TItem[]) : [items as TItem];
    this._items = [...this._items, ...arr];
    this._itemsExplicitlySet = true;
    this._controller?.addItems(items);
  }

  removeItems(ids: string | readonly string[]): void {
    this._controller?.removeItems(ids);
    if (this._controller) {
      this._items = this._controller.getItems();
    }
  }

  setItems(items: readonly TItem[]): void {
    this.items = items;
  }

  setOptions(
    options: SimplexSvgUpdateOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void {
    if (options.items !== undefined) {
      this._items = options.items;
      this._itemsExplicitlySet = true;
    }
    if (options.preset !== undefined) this._preset = options.preset;
    if (options.theme !== undefined) this._theme = options.theme;
    if (options.getLabel !== undefined) this._getLabel = options.getLabel;
    if (options.visualResolver !== undefined) {
      this._visualResolver = options.visualResolver ?? undefined;
    }
    if (options.contentView !== undefined) {
      this._contentView = options.contentView ?? undefined;
    }
    if (options.clusterView !== undefined) {
      this._clusterView = options.clusterView ?? undefined;
    }
    if (options.triangleView !== undefined) this._triangleView = options.triangleView;
    if (options.edgeView !== undefined) this._edgeView = options.edgeView;
    if (options.badgeOptions !== undefined) this._badgeOptions = options.badgeOptions;
    if (options.getShape !== undefined) this._getShape = options.getShape;
    if (options.shapeOptions !== undefined) this._shapeOptions = options.shapeOptions;
    if (options.meshOptions !== undefined) this._meshOptions = options.meshOptions;
    if (options.layoutOptions !== undefined) this._layoutOptions = options.layoutOptions;
    if (options.meshStrategy !== undefined) this._meshStrategy = options.meshStrategy;
    if (options.clusteringStrategy !== undefined) {
      this._clusteringStrategy = options.clusteringStrategy;
    }
    if (options.colorStrategy !== undefined) this._colorStrategy = options.colorStrategy;
    if (options.layoutStrategy !== undefined) this._layoutStrategy = options.layoutStrategy;
    if (options.zoomStrategy !== undefined) this._zoomStrategy = options.zoomStrategy;
    if (options.showHulls !== undefined) this._showHulls = options.showHulls;
    if (options.emptyClusterBehavior !== undefined) {
      this._emptyClusterBehavior = options.emptyClusterBehavior;
    }
    if (options.itemFilter !== undefined) this._itemFilter = options.itemFilter;
    if (options.itemFilterMode !== undefined) {
      this._itemFilterMode = options.itemFilterMode;
    }
    if (options.showZoomBreadcrumbs !== undefined) {
      this._showZoomBreadcrumbs = options.showZoomBreadcrumbs;
    }
    if (options.timeline !== undefined) this._timeline = options.timeline;
    if (options.tooltip !== undefined) this._tooltip = options.tooltip;
    if (options.ariaLabel !== undefined) this._ariaLabel = options.ariaLabel;
    if (options.keyboardNavigation !== undefined) {
      this._keyboardNavigation = options.keyboardNavigation;
    }
    if (options.reducedMotion !== undefined) this._reducedMotion = options.reducedMotion;
    if (options.touchScrollLockPx !== undefined) {
      this._touchScrollLockPx = options.touchScrollLockPx;
    }
    if (options.clickTolerancePx !== undefined) {
      this._clickTolerancePx = options.clickTolerancePx;
    }
    if (options.pinnedIds !== undefined) this._pinnedIds = options.pinnedIds;
    if (options.highlightedIds !== undefined) {
      this._highlightedIds = options.highlightedIds;
    }
    if (options.highlightedItems !== undefined) {
      this._highlightedIds = options.highlightedItems;
    }
    if (options.selectedIds !== undefined) this._selectedIds = options.selectedIds;
    if (options.marqueeSelection !== undefined) {
      this._marqueeSelection = options.marqueeSelection;
    }
    if (options.shiftClickSelects !== undefined) {
      this._shiftClickSelects = options.shiftClickSelects;
    }
    if (options.focusedItemId !== undefined) this._focusedItemId = options.focusedItemId;
    if (options.focusedClusterUid !== undefined) {
      this._focusedClusterUid = options.focusedClusterUid;
    }
    if (options.focusedTriangleIndex !== undefined) {
      this._focusedTriangleIndex = options.focusedTriangleIndex;
    }
    if (options.interactions !== undefined) this._userInteractions = options.interactions;

    if (!this._controller) return;
    const forwarded: SimplexSvgUpdateOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    > = {
      ...options,
      ...(options.interactions !== undefined
        ? { interactions: this.buildComposedInteractions() }
        : {}),
      ...(options.timeline !== undefined
        ? { timeline: this.wrapTimelineOption(options.timeline) }
        : {}),
    };
    this._controller.setOptions(forwarded);
    if (options.timeline !== undefined) {
      this.syncTimelineSubscription();
    }
  }

  batch<TResult>(fn: () => TResult): TResult {
    if (!this._controller) return fn();
    return this._controller.batch(fn);
  }

  setItemFilter(
    predicate: ItemFilterPredicate<TItem> | null,
    options?: ItemFilterOptions,
  ): void {
    this._itemFilter = predicate;
    if (options?.mode) this._itemFilterMode = options.mode;
    this._controller?.setItemFilter(predicate, options);
  }

  getItemFilter(): ItemFilterState<TItem> | null {
    return this._controller?.getItemFilter() ?? null;
  }

  setHighlightedIds(ids: Iterable<string> | null): void {
    this._highlightedIds = ids;
    this._controller?.setHighlightedIds(ids);
  }

  setHighlightedItems(ids: Iterable<string> | null): void {
    this.setHighlightedIds(ids);
  }

  getHighlightedIds(): ReadonlySet<string> {
    return this.highlightedIds;
  }

  getHighlightedItems(): ReadonlySet<string> {
    return this.highlightedIds;
  }

  setSelectedIds(ids: Iterable<string> | null): void {
    this._selectedIds = ids;
    this._controller?.setSelectedIds(ids);
  }

  toggleSelectedId(id: string): boolean {
    return this._controller?.toggleSelectedId(id) ?? false;
  }

  clearSelection(): void {
    this._selectedIds = null;
    this._controller?.clearSelection();
  }

  getSelectedIds(): ReadonlySet<string> {
    return this.selectedIds;
  }

  selectItemsInScreenRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string> {
    return (
      this._controller?.selectItemsInScreenRect(x1, y1, x2, y2, options) ?? new Set()
    );
  }

  setPinnedIds(ids: ReadonlySet<string> | readonly string[]): void {
    this._pinnedIds = ids;
    this._controller?.setPinnedIds(ids);
  }

  getPinnedIds(): ReadonlySet<string> {
    return this.pinnedIds;
  }

  focusItem(
    itemId: string | null,
    options?: FocusItemOptions & { readonly announce?: boolean },
  ): boolean {
    this._focusedItemId = itemId;
    return this._controller?.focusItem(itemId, options) ?? false;
  }

  getFocusedItemId(): string | null {
    return this.focusedItemId;
  }

  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean {
    return this._controller?.zoomToItem(itemId, options) ?? false;
  }

  setFocusedClusterUid(clusterUid: string | null): void {
    this._focusedClusterUid = clusterUid;
    this._controller?.setFocusedClusterUid(clusterUid);
  }

  setFocusedTriangleIndex(triangleIndex: number | null): void {
    this._focusedTriangleIndex = triangleIndex;
    this._controller?.setFocusedTriangleIndex(triangleIndex);
  }

  drillDownTriangle(triangleIndex: number): boolean {
    return this._controller?.drillDownTriangle(triangleIndex) ?? false;
  }

  drillDownCluster(clusterUid: string): boolean {
    return this._controller?.drillDownCluster(clusterUid) ?? false;
  }

  drillToNeighbor(neighborId: string): boolean {
    return this._controller?.drillToNeighbor(neighborId) ?? false;
  }

  drillUp(): boolean {
    return this._controller?.drillUp() ?? false;
  }

  drillToDepth(depth: number): boolean {
    return this._controller?.drillToDepth(depth) ?? false;
  }

  drillToRoot(): boolean {
    return this._controller?.drillToRoot() ?? false;
  }

  getZoomState(): SimplexZoomState | null {
    return this._controller?.getZoomState() ?? null;
  }

  resetCamera(): void {
    this._controller?.camera.reset();
  }

  zoomBy(factor: number): void {
    const ctrl = this._controller;
    if (!ctrl) return;
    const svg = ctrl.getSvgElement();
    const rect = svg.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : svg.clientWidth || 960;
    const height = rect.height > 0 ? rect.height : svg.clientHeight || 620;
    ctrl.camera.zoomToCursor(width / 2, height / 2, factor);
  }

  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null {
    return this._controller?.getKeyboardFocusTarget() ?? null;
  }

  clearKeyboardFocus(): void {
    this._controller?.clearKeyboardFocus();
  }

  setReducedMotion(preference: ReducedMotionPreference): void {
    this._reducedMotion = preference;
    this._controller?.setReducedMotion(preference);
  }

  getReducedMotion(): ReducedMotionPreference {
    return this.reducedMotion;
  }

  isReducedMotionActive(): boolean {
    return this._controller?.isReducedMotionActive() ?? this._reducedMotion === true;
  }

  getViewState(): SimplexViewState | null {
    return this._controller?.getViewState() ?? null;
  }

  restoreViewState(
    state: Partial<SimplexViewState> | null | undefined,
    options?: RestoreViewStateOptions,
  ): boolean {
    return this._controller?.restoreViewState(state, options) ?? false;
  }

  exportSvg(options?: ExportSvgOptions): string | null {
    return this._controller?.exportSvg(options) ?? null;
  }

  exportPng(options: ExportPngDataUrlOptions): Promise<string | null>;
  exportPng(options?: ExportPngBlobOptions): Promise<Blob | null>;
  exportPng(options?: ExportPngOptions): Promise<Blob | string | null>;
  exportPng(options?: ExportPngOptions): Promise<Blob | string | null> {
    if (!this._controller) return Promise.resolve(null);
    return this._controller.exportPng(options);
  }

  relayout(): void {
    this._controller?.relayout();
  }

  getMetrics(): LayoutMetrics | null {
    return this._controller?.getMetrics() ?? null;
  }

  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] {
    return this._controller?.getClusters() ?? [];
  }

  getLegendModel(
    options?: SimplexLegendModelOptions,
  ): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> | null {
    return this._controller?.getLegendModel(options) ?? null;
  }

  getSvgElement(): SVGSVGElement | null {
    return this._controller?.getSvgElement() ?? null;
  }

  getTimeline(): SimplexTimelineController<TItem> | null {
    return this._controller?.getTimeline() ?? null;
  }

  /** Deterministic frame stepping helper for unit tests and headless animations. */
  stepForTest(dtMs = 16): boolean {
    return this._controller?.stepForTest(dtMs) ?? true;
  }

  // ---------------------------------------------------------------------------
  // Internal lifecycle, attribute sync & event dispatch
  // ---------------------------------------------------------------------------

  private upgradePreExistingProperties(): void {
    const selfRecord = this as unknown as Record<string, unknown>;
    for (const prop of UPGRADEABLE_PROPERTIES) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = selfRecord[prop];
        delete selfRecord[prop];
        selfRecord[prop] = value;
      }
    }
  }

  private syncAttributesBeforeMount(): void {
    for (const attr of OBSERVED_ATTRIBUTES) {
      if (this.hasAttribute(attr)) {
        this.applyAttribute(attr, this.getAttribute(attr), false);
      }
    }
    // Optional progressive enhancement: read inline <script type="application/json"> if items not set
    if (!this._itemsExplicitlySet) {
      const jsonScript = this.querySelector<HTMLScriptElement>(
        'script[type="application/json"]',
      );
      if (jsonScript?.textContent) {
        const parsed = parseItemsJson<TItem>(jsonScript.textContent);
        if (parsed !== null) {
          this._items = parsed;
        }
      }
    }
  }

  private applyAttribute(
    name: ObservedAttributeName,
    newValue: string | null,
    syncLive = true,
  ): void {
    const live = syncLive ? this._controller : null;
    switch (name) {
      case 'preset': {
        const parsed = parsePresetAttr(newValue) ?? 'geometric';
        this._preset = parsed;
        live?.setOptions({ preset: parsed });
        break;
      }
      case 'theme': {
        const parsed = parseThemeAttr(newValue) ?? 'dark';
        this._theme = parsed;
        live?.setOptions({ theme: parsed });
        break;
      }
      case 'renderer': {
        if (newValue === null || newValue === 'svg') {
          this._renderer = 'svg';
        }
        break;
      }
      case 'tooltip': {
        const enabled = parseBooleanAttr(newValue, false);
        this._tooltip = enabled;
        live?.setOptions({ tooltip: enabled });
        break;
      }
      case 'aria-label': {
        this._ariaLabel = newValue ?? undefined;
        if (newValue !== null) {
          live?.setOptions({ ariaLabel: newValue });
        }
        break;
      }
      case 'keyboard-navigation': {
        const enabled = parseBooleanAttr(newValue, true);
        this._keyboardNavigation = enabled;
        live?.setOptions({ keyboardNavigation: enabled });
        break;
      }
      case 'reduced-motion': {
        const pref = parseReducedMotionAttr(newValue);
        this._reducedMotion = pref;
        live?.setReducedMotion(pref);
        break;
      }
      case 'marquee-selection': {
        const enabled = parseBooleanAttr(newValue, true);
        this._marqueeSelection = enabled;
        live?.setOptions({ marqueeSelection: enabled });
        break;
      }
      case 'shift-click-selects': {
        const enabled = parseBooleanAttr(newValue, true);
        this._shiftClickSelects = enabled;
        live?.setOptions({ shiftClickSelects: enabled });
        break;
      }
      case 'show-zoom-breadcrumbs': {
        const enabled = parseBooleanAttr(newValue, true);
        this._showZoomBreadcrumbs = enabled;
        live?.setOptions({ showZoomBreadcrumbs: enabled });
        break;
      }
      case 'show-hulls': {
        const enabled = parseBooleanAttr(newValue, false);
        this._showHulls = enabled;
        live?.setOptions({ showHulls: enabled });
        break;
      }
      case 'empty-cluster-behavior': {
        const behavior = parseEmptyClusterBehaviorAttr(newValue) ?? 'normal';
        this._emptyClusterBehavior = behavior;
        live?.setOptions({ emptyClusterBehavior: behavior });
        break;
      }
      case 'defer-initial-layout': {
        const defer = parseDeferInitialLayoutAttr(newValue) ?? false;
        this._deferInitialLayout = defer;
        break;
      }
      case 'item-filter-mode': {
        const mode = parseItemFilterModeAttr(newValue) ?? 'dim';
        this._itemFilterMode = mode;
        live?.setOptions({ itemFilterMode: mode });
        break;
      }
      case 'touch-scroll-lock-px': {
        const px = parseFiniteNumberAttr(newValue);
        this._touchScrollLockPx = px;
        if (px !== undefined) live?.setOptions({ touchScrollLockPx: px });
        break;
      }
      case 'click-tolerance-px': {
        const px = parseFiniteNumberAttr(newValue);
        this._clickTolerancePx = px;
        if (px !== undefined) live?.setOptions({ clickTolerancePx: px });
        break;
      }
      case 'focus-on-cluster-click': {
        this._focusOnClusterClick = parseBooleanAttr(newValue, true);
        break;
      }
      case 'focus-on-triangle-click': {
        this._focusOnTriangleClick = parseBooleanAttr(newValue, true);
        break;
      }
      case 'relayout-on-font-load': {
        this._relayoutOnFontLoad = parseBooleanAttr(newValue, true);
        break;
      }
      case 'timeline': {
        const enabled = parseBooleanAttr(newValue, false);
        this._timeline = enabled;
        if (live) {
          live.setOptions({ timeline: this.wrapTimelineOption(enabled) });
          this.syncTimelineSubscription();
        }
        break;
      }
      case 'items': {
        const parsed = parseItemsJson<TItem>(newValue);
        if (parsed !== null) {
          this._items = parsed;
          this._itemsExplicitlySet = true;
          live?.setItems(parsed);
        }
        break;
      }
      case 'selected-ids': {
        const parsed = parseIdListAttr(newValue);
        this._selectedIds = parsed;
        live?.setSelectedIds(parsed);
        break;
      }
      case 'highlighted-ids': {
        const parsed = parseIdListAttr(newValue);
        this._highlightedIds = parsed;
        live?.setHighlightedIds(parsed);
        break;
      }
      case 'pinned-ids': {
        const parsed = parseIdListAttr(newValue);
        this._pinnedIds = parsed;
        live?.setPinnedIds(parsed ?? []);
        break;
      }
    }
  }

  private ensureMounted(): void {
    if (this._controller) return;
    if (typeof document === 'undefined') return;

    if (!this.style.display) {
      this.style.display = 'block';
    }

    const doc = this.ownerDocument ?? document;
    const stage = doc.createElement('div');
    stage.className = 'sv-wc-stage';
    stage.style.position = 'relative';
    stage.style.width = '100%';
    stage.style.height = '100%';
    this.appendChild(stage);
    this._stageEl = stage;

    const options = {
      items: this._items,
      getId: this._getId,
      getTags: this._getTags,
      getLabel: this._getLabel,
      normalizeTag: this._normalizeTag,
      formatTagLabel: this._formatTagLabel,
      resolveTagMeta: this._resolveTagMeta,
      deriveClusterMeta: this._deriveClusterMeta,
      preset: this._preset,
      theme: this._theme,
      visualResolver: this._visualResolver,
      contentView: this._contentView,
      clusterView: this._clusterView,
      triangleView: this._triangleView,
      edgeView: this._edgeView,
      badgeOptions: this._badgeOptions,
      getShape: this._getShape,
      shapeOptions: this._shapeOptions,
      meshOptions: this._meshOptions,
      layoutOptions: this._layoutOptions,
      meshStrategy: this._meshStrategy,
      clusteringStrategy: this._clusteringStrategy,
      colorStrategy: this._colorStrategy,
      layoutStrategy: this._layoutStrategy,
      zoomStrategy: this._zoomStrategy,
      showHulls: this._showHulls,
      emptyClusterBehavior: this._emptyClusterBehavior,
      itemFilter: this._itemFilter,
      itemFilterMode: this._itemFilterMode,
      showZoomBreadcrumbs: this._showZoomBreadcrumbs,
      timeline: this.wrapTimelineOption(this._timeline),
      relayoutOnFontLoad: this._relayoutOnFontLoad,
      deferInitialLayout: this._deferInitialLayout,
      touchScrollLockPx: this._touchScrollLockPx,
      clickTolerancePx: this._clickTolerancePx,
      focusOnClusterClick: this._focusOnClusterClick,
      focusOnTriangleClick: this._focusOnTriangleClick,
      tooltip: this._tooltip,
      ariaLabel: this._ariaLabel,
      keyboardNavigation: this._keyboardNavigation,
      reducedMotion: this._reducedMotion,
      selectedIds: this._selectedIds,
      marqueeSelection: this._marqueeSelection,
      shiftClickSelects: this._shiftClickSelects,
      interactions: this.buildComposedInteractions(),
      onMetricsChange: (metrics: LayoutMetrics) => {
        this.emitEvent('simplex-metrics', metrics);
      },
      onClustersChange: (
        clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
      ) => {
        this.emitEvent('simplex-clusters-change', clusters);
      },
      onZoomStateChange: (state: SimplexZoomState) => {
        this.emitEvent('simplex-zoom', state);
      },
      onSelectionChange: (selectedIds: ReadonlySet<string>) => {
        const snapshot = new Set(selectedIds);
        this._selectedIds = snapshot;
        this.emitEvent<SimplexSelectionChangeDetail>('simplex-selection-change', {
          selectedIds: snapshot,
          ids: Array.from(snapshot).sort(),
        });
      },
      onLegendChange: (
        model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
      ) => {
        this.emitEvent<SimplexLegendModel<TItem, TTagMeta, TClusterMeta>>(
          'simplex-legend-change',
          model,
        );
      },
    } as unknown as SimplexSvgControllerOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;

    const ctrl = new SimplexSvgController<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >(stage, options);
    this._controller = ctrl;

    // Apply initial post-construct highlight/pin/focus states if pre-configured
    if (this._highlightedIds !== null) {
      ctrl.setHighlightedIds(this._highlightedIds);
    }
    if (this._pinnedIds !== null) {
      ctrl.setPinnedIds(this._pinnedIds);
    }
    if (this._focusedClusterUid !== null) {
      ctrl.setFocusedClusterUid(this._focusedClusterUid);
    }
    if (this._focusedTriangleIndex !== null) {
      ctrl.setFocusedTriangleIndex(this._focusedTriangleIndex);
    }
    if (this._focusedItemId !== null) {
      ctrl.focusItem(this._focusedItemId, { hover: false });
    }

    this.syncTimelineSubscription();
  }

  private remountController(): void {
    const viewState = this._controller?.getViewState() ?? null;
    this.teardownController();
    if (this.isConnected) {
      this.ensureMounted();
      if (viewState) {
        this._controller?.restoreViewState(viewState, { animate: false });
      }
    }
  }

  private teardownController(): void {
    this._timelineUnsubscribe?.();
    this._timelineUnsubscribe = null;
    this._controller?.destroy();
    this._controller = null;
    if (this._stageEl && this._stageEl.parentNode === this) {
      this.removeChild(this._stageEl);
    }
    this._stageEl = null;
    this._lastHoverWasActive = false;
  }

  private syncTimelineSubscription(): void {
    this._timelineUnsubscribe?.();
    this._timelineUnsubscribe = null;
    if (!this._controller) return;
    if (this._controller.timeline) {
      this._timelineUnsubscribe = this._controller.subscribeTimeline((state) => {
        if (state) {
          this.emitEvent<SimplexTimelineState<TItem>>('simplex-timeline-change', state);
        }
      });
    }
  }

  private wrapTimelineOption(
    opt: boolean | TimelinePlayerOptions<TItem>,
  ): boolean | TimelinePlayerOptions<TItem> {
    return opt;
  }

  private buildComposedInteractions(): InteractionHandlers<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    const user = this._userInteractions;
    return {
      onContentHover: (ev) => {
        const userConsumed = user?.onContentHover?.(ev);
        if (ev) {
          this._lastHoverWasActive = true;
          const prevented = this.emitCancelableEvent<
            SimplexHoverEventDetail<
              TItem,
              TContentVisual,
              TClusterVisual,
              TTagMeta,
              TClusterMeta
            >
          >('simplex-hover', { kind: 'content', event: ev });
          return userConsumed === true || prevented;
        }
        if (this._lastHoverWasActive) {
          this._lastHoverWasActive = false;
          this.emitCancelableEvent('simplex-hover', { kind: null, event: null });
        }
        return userConsumed;
      },
      onClusterHover: (ev) => {
        const userConsumed = user?.onClusterHover?.(ev);
        if (ev) {
          this._lastHoverWasActive = true;
          const prevented = this.emitCancelableEvent<
            SimplexHoverEventDetail<
              TItem,
              TContentVisual,
              TClusterVisual,
              TTagMeta,
              TClusterMeta
            >
          >('simplex-hover', { kind: 'cluster', event: ev });
          return userConsumed === true || prevented;
        }
        if (this._lastHoverWasActive) {
          this._lastHoverWasActive = false;
          this.emitCancelableEvent('simplex-hover', { kind: null, event: null });
        }
        return userConsumed;
      },
      onTriangleHover: (ev) => {
        const userConsumed = user?.onTriangleHover?.(ev);
        if (ev) {
          this._lastHoverWasActive = true;
          const prevented = this.emitCancelableEvent<
            SimplexHoverEventDetail<
              TItem,
              TContentVisual,
              TClusterVisual,
              TTagMeta,
              TClusterMeta
            >
          >('simplex-hover', { kind: 'triangle', event: ev });
          return userConsumed === true || prevented;
        }
        if (this._lastHoverWasActive) {
          this._lastHoverWasActive = false;
          this.emitCancelableEvent('simplex-hover', { kind: null, event: null });
        }
        return userConsumed;
      },
      onContentClick: user?.onContentClick,
      onClusterClick: user?.onClusterClick,
      onTriangleClick: user?.onTriangleClick,
      onBackgroundClick: user?.onBackgroundClick,
      onLeftClick: (target, rawEvent) => {
        const userConsumed = user?.onLeftClick?.(target, rawEvent);
        const prevented = this.emitCancelableEvent<
          SimplexClickEventDetail<
            TItem,
            TContentVisual,
            TClusterVisual,
            TTagMeta,
            TClusterMeta
          >
        >('simplex-click', {
          kind: target.kind,
          target,
          rawEvent,
        });
        return userConsumed === true || prevented;
      },
      onRightClick: user?.onRightClick,
      onWheel: user?.onWheel,
    };
  }

  private emitEvent<TDetail>(type: string, detail: TDetail): void {
    if (typeof CustomEvent === 'undefined' || typeof this.dispatchEvent !== 'function') {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<TDetail>(type, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private emitCancelableEvent<TDetail>(type: string, detail: TDetail): boolean {
    if (typeof CustomEvent === 'undefined' || typeof this.dispatchEvent !== 'function') {
      return false;
    }
    const event = new CustomEvent<TDetail>(type, {
      detail,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    return !this.dispatchEvent(event);
  }
}

const boundRegistries = new WeakSet<CustomElementRegistry>();

/**
 * Registers `<simplex-topic-graph>` (or a custom tag name) in the browser's
 * `CustomElementRegistry`.
 *
 * - **SSR-safe**: returns `false` without throwing when `customElements` is unavailable.
 * - **Idempotent**: returns `false` without throwing if `tagName` is already registered.
 * - **Alias-safe**: registering additional custom tag names creates a lightweight subclass
 *   so `instanceof SimplexTopicGraphElement` remains `true` without violating the Custom
 *   Elements constructor uniqueness constraint.
 *
 * @returns `true` if the element was newly defined, `false` otherwise.
 */
export function defineSimplexTopicGraphElement(
  tagName: string = DEFAULT_SIMPLEX_TAG_NAME,
): boolean {
  if (typeof customElements === 'undefined') {
    return false;
  }
  if (customElements.get(tagName)) {
    return false;
  }
  const usePrimary = !boundRegistries.has(customElements);
  const ctor = usePrimary
    ? SimplexTopicGraphElement
    : class extends SimplexTopicGraphElement {};
  if (usePrimary) {
    boundRegistries.add(customElements);
  }
  customElements.define(
    tagName,
    ctor as unknown as CustomElementConstructor,
  );
  return true;
}

declare global {
  interface HTMLElementTagNameMap {
    'simplex-topic-graph': SimplexTopicGraphElement;
  }
}
