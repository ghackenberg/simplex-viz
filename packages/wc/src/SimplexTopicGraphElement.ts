import {
  createSimplexTimelineNotifier,
  type CameraController,
  type ClusterDerivationContext,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ContentHoverEvent,
  type DefaultTaggedItem,
  type EmptyClusterBehavior,
  type FocusItemOptions,
  type HitTarget,
  type InteractionHandlers,
  type ItemFilterMode,
  type ItemFilterOptions,
  type ItemFilterPredicate,
  type ItemFilterState,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type NormalizedPointerEvent,
  type ReducedMotionPreference,
  type RestoreViewStateOptions,
  type SelectInRectOptions,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexKeyboardFocusTarget,
  type SimplexLayoutStrategy,
  type SimplexLegendModel,
  type SimplexLegendModelOptions,
  type SimplexMeshStrategy,
  type SimplexTimelineController,
  type SimplexTimelineNotifier,
  type SimplexTimelineState,
  type SimplexViewState,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type TriangleHoverEvent,
  type VisualResolver,
  type ZoomToItemOptions,
} from '@simplex-viz/core';
import { zoomSimplexViewportByFactor } from '@simplex-viz/core/dom';
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

interface SimplexWcControllerConfig<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  items: readonly TItem[];
  getId?: (item: TItem) => string;
  getTags?: (item: TItem) => readonly string[];
  getLabel?: (item: TItem) => string;
  normalizeTag?: (rawTag: string) => string;
  formatTagLabel?: (tag: string) => string;
  resolveTagMeta?: (normalizedTag: string) => TTagMeta | undefined;
  deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
  preset: SimplexVisualPreset;
  theme: SimplexTheme;
  visualResolver?: VisualResolver<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  contentView?: SvgNodeView<TContentVisual>;
  clusterView?: SvgNodeView<TClusterVisual>;
  triangleView?: SvgTriangleView<TItem, TTagMeta, TClusterMeta>;
  edgeView?: SvgEdgeView<TItem, TTagMeta, TClusterMeta>;
  badgeOptions?: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>;
  getShape?: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>;
  shapeOptions?: GeometricShapeSvgViewOptions;
  meshOptions?: MeshOptions;
  layoutOptions?: LayoutSolverOptions;
  meshStrategy?: SimplexMeshStrategy<TItem>;
  clusteringStrategy?: SimplexClusteringStrategy<TItem, TTagMeta>;
  colorStrategy?: SimplexColorStrategy<TItem, TTagMeta>;
  layoutStrategy?: SimplexLayoutStrategy;
  zoomStrategy?: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  showHulls: boolean;
  emptyClusterBehavior: EmptyClusterBehavior;
  itemFilter: ItemFilterPredicate<TItem> | null;
  itemFilterMode: ItemFilterMode;
  showZoomBreadcrumbs: boolean;
  timeline: boolean | TimelinePlayerOptions<TItem>;
  relayoutOnFontLoad: boolean;
  deferInitialLayout: boolean | DeferInitialLayoutOptions;
  touchScrollLockPx?: number;
  clickTolerancePx?: number;
  focusOnClusterClick: boolean;
  focusOnTriangleClick: boolean;
  tooltip: SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  ariaLabel?: string;
  keyboardNavigation: boolean;
  reducedMotion: ReducedMotionPreference;
  selectedIds: Iterable<string> | null;
  marqueeSelection: boolean;
  shiftClickSelects: boolean;
}

function createInitialControllerConfig<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(): SimplexWcControllerConfig<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
> {
  return {
    items: [],
    preset: 'geometric',
    theme: 'dark',
    showHulls: false,
    emptyClusterBehavior: 'normal',
    itemFilter: null,
    itemFilterMode: 'dim',
    showZoomBreadcrumbs: true,
    timeline: false,
    relayoutOnFontLoad: true,
    deferInitialLayout: false,
    focusOnClusterClick: true,
    focusOnTriangleClick: true,
    tooltip: false,
    keyboardNavigation: true,
    reducedMotion: 'auto',
    selectedIds: null,
    marqueeSelection: true,
    shiftClickSelects: true,
  };
}

const DIRECT_CONFIG_UPDATE_KEYS = [
  'preset',
  'theme',
  'getLabel',
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
  'tooltip',
  'ariaLabel',
  'keyboardNavigation',
  'reducedMotion',
  'touchScrollLockPx',
  'clickTolerancePx',
  'selectedIds',
  'marqueeSelection',
  'shiftClickSelects',
] as const;

const NULLABLE_CONFIG_UPDATE_KEYS = [
  'visualResolver',
  'contentView',
  'clusterView',
] as const;

function copyDefinedConfigKeys<
  TTarget extends object,
  K extends keyof TTarget,
>(
  target: TTarget,
  source: { readonly [P in K]?: TTarget[P] },
  keys: readonly K[],
): void {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

function copyNullableConfigKeys<
  TTarget extends object,
  K extends keyof TTarget,
>(
  target: TTarget,
  source: { readonly [P in K]?: TTarget[P] | null },
  keys: readonly K[],
): void {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = (value ?? undefined) as TTarget[K];
    }
  }
}

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

interface AttributeBindingContext<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly config: SimplexWcControllerConfig<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
  readonly live: SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null;
  setRenderer(renderer: SimplexWcRenderer): void;
  setItemsExplicitly(items: readonly TItem[]): void;
  setHighlightedIds(ids: Iterable<string> | null): void;
  setPinnedIds(ids: ReadonlySet<string> | readonly string[] | null): void;
  syncTimelineSubscription(): void;
}

type AttributeHandler = <
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  ctx: AttributeBindingContext<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  raw: string | null,
) => void;

const ATTRIBUTE_HANDLERS: Record<ObservedAttributeName, AttributeHandler> = {
  preset: ({ config, live }, raw) => {
    const parsed = parsePresetAttr(raw) ?? 'geometric';
    config.preset = parsed;
    live?.setOptions({ preset: parsed });
  },
  theme: ({ config, live }, raw) => {
    const parsed = parseThemeAttr(raw) ?? 'dark';
    config.theme = parsed;
    live?.setOptions({ theme: parsed });
  },
  renderer: (ctx, raw) => {
    if (raw === null || raw === 'svg') ctx.setRenderer('svg');
  },
  tooltip: ({ config, live }, raw) => {
    const enabled = parseBooleanAttr(raw, false);
    config.tooltip = enabled;
    live?.setOptions({ tooltip: enabled });
  },
  'aria-label': ({ config, live }, raw) => {
    config.ariaLabel = raw ?? undefined;
    if (raw !== null) live?.setOptions({ ariaLabel: raw });
  },
  'keyboard-navigation': ({ config, live }, raw) => {
    const enabled = parseBooleanAttr(raw, true);
    config.keyboardNavigation = enabled;
    live?.setOptions({ keyboardNavigation: enabled });
  },
  'reduced-motion': ({ config, live }, raw) => {
    const pref = parseReducedMotionAttr(raw);
    config.reducedMotion = pref;
    live?.setReducedMotion(pref);
  },
  'marquee-selection': ({ config, live }, raw) => {
    const enabled = parseBooleanAttr(raw, true);
    config.marqueeSelection = enabled;
    live?.setOptions({ marqueeSelection: enabled });
  },
  'shift-click-selects': ({ config, live }, raw) => {
    const enabled = parseBooleanAttr(raw, true);
    config.shiftClickSelects = enabled;
    live?.setOptions({ shiftClickSelects: enabled });
  },
  'show-zoom-breadcrumbs': ({ config, live }, raw) => {
    const enabled = parseBooleanAttr(raw, true);
    config.showZoomBreadcrumbs = enabled;
    live?.setOptions({ showZoomBreadcrumbs: enabled });
  },
  'show-hulls': ({ config, live }, raw) => {
    const enabled = parseBooleanAttr(raw, false);
    config.showHulls = enabled;
    live?.setOptions({ showHulls: enabled });
  },
  'empty-cluster-behavior': ({ config, live }, raw) => {
    const behavior = parseEmptyClusterBehaviorAttr(raw) ?? 'normal';
    config.emptyClusterBehavior = behavior;
    live?.setOptions({ emptyClusterBehavior: behavior });
  },
  'defer-initial-layout': ({ config }, raw) => {
    config.deferInitialLayout = parseDeferInitialLayoutAttr(raw) ?? false;
  },
  'item-filter-mode': ({ config, live }, raw) => {
    const mode = parseItemFilterModeAttr(raw) ?? 'dim';
    config.itemFilterMode = mode;
    live?.setOptions({ itemFilterMode: mode });
  },
  'touch-scroll-lock-px': ({ config, live }, raw) => {
    const px = parseFiniteNumberAttr(raw);
    config.touchScrollLockPx = px;
    if (px !== undefined) live?.setOptions({ touchScrollLockPx: px });
  },
  'click-tolerance-px': ({ config, live }, raw) => {
    const px = parseFiniteNumberAttr(raw);
    config.clickTolerancePx = px;
    if (px !== undefined) live?.setOptions({ clickTolerancePx: px });
  },
  'focus-on-cluster-click': ({ config }, raw) => {
    config.focusOnClusterClick = parseBooleanAttr(raw, true);
  },
  'focus-on-triangle-click': ({ config }, raw) => {
    config.focusOnTriangleClick = parseBooleanAttr(raw, true);
  },
  'relayout-on-font-load': ({ config }, raw) => {
    config.relayoutOnFontLoad = parseBooleanAttr(raw, true);
  },
  timeline: (ctx, raw) => {
    const enabled = parseBooleanAttr(raw, false);
    ctx.config.timeline = enabled;
    if (ctx.live) {
      ctx.live.setOptions({ timeline: enabled });
      ctx.syncTimelineSubscription();
    }
  },
  items: (ctx, raw) => {
    const parsed = parseItemsJson(raw);
    if (parsed !== null) {
      ctx.setItemsExplicitly(parsed as never);
    }
  },
  'selected-ids': ({ config, live }, raw) => {
    const parsed = parseIdListAttr(raw);
    config.selectedIds = parsed;
    live?.setSelectedIds(parsed);
  },
  'highlighted-ids': (ctx, raw) => {
    ctx.setHighlightedIds(parseIdListAttr(raw));
  },
  'pinned-ids': (ctx, raw) => {
    ctx.setPinnedIds(parseIdListAttr(raw));
  },
};

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
  private readonly _timelineNotifier: SimplexTimelineNotifier<TItem> =
    createSimplexTimelineNotifier<TItem>();
  private _lastHoverWasActive = false;
  private _itemsExplicitlySet = false;

  // Backed state (works pre-connect, pre-upgrade, and across reconnects)
  private readonly _config: SimplexWcControllerConfig<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > = createInitialControllerConfig();
  private _renderer: SimplexWcRenderer = 'svg';
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
    return this._controller ? this._controller.getItems() : this._config.items;
  }
  set items(value: readonly TItem[]) {
    this._config.items = Array.isArray(value) ? value : [];
    this._itemsExplicitlySet = true;
    this._controller?.setItems(this._config.items);
  }

  get getId(): ((item: TItem) => string) | undefined {
    return this._config.getId;
  }
  set getId(fn: ((item: TItem) => string) | undefined) {
    this.setRemountConfig('getId', fn);
  }

  get getTags(): ((item: TItem) => readonly string[]) | undefined {
    return this._config.getTags;
  }
  set getTags(fn: ((item: TItem) => readonly string[]) | undefined) {
    this.setRemountConfig('getTags', fn);
  }

  get getLabel(): ((item: TItem) => string) | undefined {
    return this._config.getLabel;
  }
  set getLabel(fn: ((item: TItem) => string) | undefined) {
    this._config.getLabel = fn;
    this._controller?.setOptions({ getLabel: fn });
  }

  get normalizeTag(): ((rawTag: string) => string) | undefined {
    return this._config.normalizeTag;
  }
  set normalizeTag(fn: ((rawTag: string) => string) | undefined) {
    this.setRemountConfig('normalizeTag', fn);
  }

  get formatTagLabel(): ((tag: string) => string) | undefined {
    return this._config.formatTagLabel;
  }
  set formatTagLabel(fn: ((tag: string) => string) | undefined) {
    this.setRemountConfig('formatTagLabel', fn);
  }

  get resolveTagMeta(): ((normalizedTag: string) => TTagMeta | undefined) | undefined {
    return this._config.resolveTagMeta;
  }
  set resolveTagMeta(fn: ((normalizedTag: string) => TTagMeta | undefined) | undefined) {
    this.setRemountConfig('resolveTagMeta', fn);
  }

  get deriveClusterMeta():
    | ((ctx: ClusterDerivationContext<TItem, TTagMeta>) => TClusterMeta)
    | undefined {
    return this._config.deriveClusterMeta;
  }
  set deriveClusterMeta(
    fn: ((ctx: ClusterDerivationContext<TItem, TTagMeta>) => TClusterMeta) | undefined,
  ) {
    this.setRemountConfig('deriveClusterMeta', fn);
  }

  get preset(): SimplexVisualPreset {
    return this._config.preset;
  }
  set preset(value: SimplexVisualPreset) {
    if (value !== 'geometric' && value !== 'badges' && value !== 'glyphs') return;
    this._config.preset = value;
    this._controller?.setOptions({ preset: value });
  }

  get theme(): SimplexTheme {
    return this._config.theme;
  }
  set theme(value: SimplexTheme) {
    if (value !== 'dark' && value !== 'light') return;
    this._config.theme = value;
    this._controller?.setOptions({ theme: value });
  }

  get renderer(): SimplexWcRenderer {
    return this._renderer;
  }
  set renderer(value: SimplexWcRenderer) {
    if (value === 'svg') this._renderer = value;
  }

  get visualResolver():
    | VisualResolver<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>
    | undefined {
    return this._config.visualResolver;
  }
  set visualResolver(
    value:
      | VisualResolver<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>
      | null
      | undefined,
  ) {
    this._config.visualResolver = value ?? undefined;
    this._controller?.setOptions({ visualResolver: value ?? null });
  }

  get contentView(): SvgNodeView<TContentVisual> | undefined {
    return this._config.contentView;
  }
  set contentView(value: SvgNodeView<TContentVisual> | null | undefined) {
    this._config.contentView = value ?? undefined;
    this._controller?.setOptions({ contentView: value ?? null });
  }

  get clusterView(): SvgNodeView<TClusterVisual> | undefined {
    return this._config.clusterView;
  }
  set clusterView(value: SvgNodeView<TClusterVisual> | null | undefined) {
    this._config.clusterView = value ?? undefined;
    this._controller?.setOptions({ clusterView: value ?? null });
  }

  get triangleView(): SvgTriangleView<TItem, TTagMeta, TClusterMeta> | undefined {
    return this._config.triangleView;
  }
  set triangleView(value: SvgTriangleView<TItem, TTagMeta, TClusterMeta> | undefined) {
    this._config.triangleView = value;
    if (value) this._controller?.setOptions({ triangleView: value });
  }

  get edgeView(): SvgEdgeView<TItem, TTagMeta, TClusterMeta> | undefined {
    return this._config.edgeView;
  }
  set edgeView(value: SvgEdgeView<TItem, TTagMeta, TClusterMeta> | undefined) {
    this._config.edgeView = value;
    if (value) this._controller?.setOptions({ edgeView: value });
  }

  get badgeOptions():
    | PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta>
    | undefined {
    return this._config.badgeOptions;
  }
  set badgeOptions(
    value: PresetBadgeClusterOptions<TItem, TTagMeta, TClusterMeta> | undefined,
  ) {
    this._config.badgeOptions = value;
    this._controller?.setOptions({ badgeOptions: value });
  }

  get getShape():
    | PresetContentShapeOption<TItem, TTagMeta, TClusterMeta>
    | undefined {
    return this._config.getShape;
  }
  set getShape(
    value: PresetContentShapeOption<TItem, TTagMeta, TClusterMeta> | undefined,
  ) {
    this._config.getShape = value;
    this._controller?.setOptions({ getShape: value });
  }

  get shapeOptions(): GeometricShapeSvgViewOptions | undefined {
    return this._config.shapeOptions;
  }
  set shapeOptions(value: GeometricShapeSvgViewOptions | undefined) {
    this._config.shapeOptions = value;
    this._controller?.setOptions({ shapeOptions: value });
  }

  get meshOptions(): MeshOptions | undefined {
    return this._config.meshOptions;
  }
  set meshOptions(value: MeshOptions | undefined) {
    this._config.meshOptions = value;
    if (value) this._controller?.setOptions({ meshOptions: value });
  }

  get layoutOptions(): LayoutSolverOptions | undefined {
    return this._config.layoutOptions;
  }
  set layoutOptions(value: LayoutSolverOptions | undefined) {
    this._config.layoutOptions = value;
    if (value) this._controller?.setOptions({ layoutOptions: value });
  }

  get meshStrategy(): SimplexMeshStrategy<TItem> | undefined {
    return this._config.meshStrategy;
  }
  set meshStrategy(value: SimplexMeshStrategy<TItem> | undefined) {
    this._config.meshStrategy = value;
    if (value) this._controller?.setOptions({ meshStrategy: value });
  }

  get clusteringStrategy(): SimplexClusteringStrategy<TItem, TTagMeta> | undefined {
    return this._config.clusteringStrategy;
  }
  set clusteringStrategy(value: SimplexClusteringStrategy<TItem, TTagMeta> | undefined) {
    this._config.clusteringStrategy = value;
    if (value) this._controller?.setOptions({ clusteringStrategy: value });
  }

  get colorStrategy(): SimplexColorStrategy<TItem, TTagMeta> | undefined {
    return this._config.colorStrategy;
  }
  set colorStrategy(value: SimplexColorStrategy<TItem, TTagMeta> | undefined) {
    this._config.colorStrategy = value;
    if (value) this._controller?.setOptions({ colorStrategy: value });
  }

  get layoutStrategy(): SimplexLayoutStrategy | undefined {
    return this._config.layoutStrategy;
  }
  set layoutStrategy(value: SimplexLayoutStrategy | undefined) {
    this._config.layoutStrategy = value;
    if (value) this._controller?.setOptions({ layoutStrategy: value });
  }

  get zoomStrategy(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> | undefined {
    return this._config.zoomStrategy;
  }
  set zoomStrategy(
    value: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> | undefined,
  ) {
    this._config.zoomStrategy = value;
    if (value) this._controller?.setOptions({ zoomStrategy: value });
  }

  get showHulls(): boolean {
    return this._config.showHulls;
  }
  set showHulls(value: boolean) {
    const enabled = Boolean(value);
    this._config.showHulls = enabled;
    this._controller?.setOptions({ showHulls: enabled });
  }

  get emptyClusterBehavior(): EmptyClusterBehavior {
    return this._config.emptyClusterBehavior;
  }
  set emptyClusterBehavior(value: EmptyClusterBehavior) {
    if (value !== 'normal' && value !== 'dim' && value !== 'hide') return;
    this._config.emptyClusterBehavior = value;
    this._controller?.setOptions({ emptyClusterBehavior: value });
  }

  get itemFilter(): ItemFilterPredicate<TItem> | null {
    return this._config.itemFilter;
  }
  set itemFilter(value: ItemFilterPredicate<TItem> | null) {
    this._config.itemFilter = value ?? null;
    this._controller?.setItemFilter(this._config.itemFilter, {
      mode: this._config.itemFilterMode,
    });
  }

  get itemFilterMode(): ItemFilterMode {
    return this._config.itemFilterMode;
  }
  set itemFilterMode(value: ItemFilterMode) {
    if (value !== 'dim' && value !== 'hide') return;
    this._config.itemFilterMode = value;
    this._controller?.setOptions({ itemFilterMode: value });
  }

  get showZoomBreadcrumbs(): boolean {
    return this._config.showZoomBreadcrumbs;
  }
  set showZoomBreadcrumbs(value: boolean) {
    const enabled = Boolean(value);
    this._config.showZoomBreadcrumbs = enabled;
    this._controller?.setOptions({ showZoomBreadcrumbs: enabled });
  }

  get timeline(): boolean | TimelinePlayerOptions<TItem> {
    return this._config.timeline;
  }
  set timeline(value: boolean | TimelinePlayerOptions<TItem>) {
    this._config.timeline = value;
    if (this._controller) {
      this._controller.setOptions({ timeline: value });
      this.syncTimelineSubscription();
    }
  }

  get relayoutOnFontLoad(): boolean {
    return this._config.relayoutOnFontLoad;
  }
  set relayoutOnFontLoad(value: boolean) {
    this._config.relayoutOnFontLoad = Boolean(value);
  }

  get deferInitialLayout(): boolean | DeferInitialLayoutOptions {
    return this._config.deferInitialLayout;
  }
  set deferInitialLayout(value: boolean | DeferInitialLayoutOptions) {
    this._config.deferInitialLayout = value;
  }

  get touchScrollLockPx(): number | undefined {
    return this._config.touchScrollLockPx;
  }
  set touchScrollLockPx(value: number | undefined) {
    this._config.touchScrollLockPx = value;
    if (value !== undefined) this._controller?.setOptions({ touchScrollLockPx: value });
  }

  get clickTolerancePx(): number | undefined {
    return this._config.clickTolerancePx;
  }
  set clickTolerancePx(value: number | undefined) {
    this._config.clickTolerancePx = value;
    if (value !== undefined) this._controller?.setOptions({ clickTolerancePx: value });
  }

  get focusOnClusterClick(): boolean {
    return this._config.focusOnClusterClick;
  }
  set focusOnClusterClick(value: boolean) {
    this._config.focusOnClusterClick = Boolean(value);
  }

  get focusOnTriangleClick(): boolean {
    return this._config.focusOnTriangleClick;
  }
  set focusOnTriangleClick(value: boolean) {
    this._config.focusOnTriangleClick = Boolean(value);
  }

  get tooltip(): SimplexSvgTooltipOption<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > {
    return this._config.tooltip;
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
    this._config.tooltip = value;
    this._controller?.setOptions({ tooltip: value });
  }

  override get ariaLabel(): string | null {
    return this._config.ariaLabel ?? null;
  }
  override set ariaLabel(value: string | null) {
    this._config.ariaLabel = value ?? undefined;
    if (this._config.ariaLabel !== undefined) {
      this._controller?.setOptions({ ariaLabel: this._config.ariaLabel });
    }
  }

  get keyboardNavigation(): boolean {
    return this._config.keyboardNavigation;
  }
  set keyboardNavigation(value: boolean) {
    const enabled = Boolean(value);
    this._config.keyboardNavigation = enabled;
    this._controller?.setOptions({ keyboardNavigation: enabled });
  }

  get reducedMotion(): ReducedMotionPreference {
    return this._controller
      ? this._controller.getReducedMotion()
      : this._config.reducedMotion;
  }
  set reducedMotion(value: ReducedMotionPreference) {
    this._config.reducedMotion = value;
    this._controller?.setReducedMotion(value);
  }

  get marqueeSelection(): boolean {
    return this._config.marqueeSelection;
  }
  set marqueeSelection(value: boolean) {
    const enabled = Boolean(value);
    this._config.marqueeSelection = enabled;
    this._controller?.setOptions({ marqueeSelection: enabled });
  }

  get shiftClickSelects(): boolean {
    return this._config.shiftClickSelects;
  }
  set shiftClickSelects(value: boolean) {
    const enabled = Boolean(value);
    this._config.shiftClickSelects = enabled;
    this._controller?.setOptions({ shiftClickSelects: enabled });
  }

  get selectedIds(): ReadonlySet<string> {
    if (this._controller) return this._controller.getSelectedIds();
    return this._config.selectedIds ? new Set(this._config.selectedIds) : new Set();
  }
  set selectedIds(value: Iterable<string> | null) {
    this._config.selectedIds = value;
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
    this._config.items = [...this._config.items, ...arr];
    this._itemsExplicitlySet = true;
    this._controller?.addItems(items);
  }

  removeItems(ids: string | readonly string[]): void {
    this._controller?.removeItems(ids);
    if (this._controller) {
      this._config.items = this._controller.getItems();
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
      this._config.items = options.items;
      this._itemsExplicitlySet = true;
    }

    copyDefinedConfigKeys(this._config, options, DIRECT_CONFIG_UPDATE_KEYS);
    copyNullableConfigKeys(this._config, options, NULLABLE_CONFIG_UPDATE_KEYS);

    if (options.pinnedIds !== undefined) this._pinnedIds = options.pinnedIds;
    if (options.highlightedIds !== undefined) {
      this._highlightedIds = options.highlightedIds;
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
    this._config.itemFilter = predicate;
    if (options?.mode) this._config.itemFilterMode = options.mode;
    this._controller?.setItemFilter(predicate, options);
  }

  getItemFilter(): ItemFilterState<TItem> | null {
    return this._controller?.getItemFilter() ?? null;
  }

  setHighlightedIds(ids: Iterable<string> | null): void {
    this._highlightedIds = ids;
    this._controller?.setHighlightedIds(ids);
  }

  getHighlightedIds(): ReadonlySet<string> {
    return this.highlightedIds;
  }

  setSelectedIds(ids: Iterable<string> | null): void {
    this._config.selectedIds = ids;
    this._controller?.setSelectedIds(ids);
  }

  toggleSelectedId(id: string): boolean {
    return this._controller?.toggleSelectedId(id) ?? false;
  }

  clearSelection(): void {
    this._config.selectedIds = null;
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
    zoomSimplexViewportByFactor(ctrl.getSvgElement(), ctrl.camera, factor, 960, 620);
  }

  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null {
    return this._controller?.getKeyboardFocusTarget() ?? null;
  }

  clearKeyboardFocus(): void {
    this._controller?.clearKeyboardFocus();
  }

  setReducedMotion(preference: ReducedMotionPreference): void {
    this._config.reducedMotion = preference;
    this._controller?.setReducedMotion(preference);
  }

  getReducedMotion(): ReducedMotionPreference {
    return this.reducedMotion;
  }

  isReducedMotionActive(): boolean {
    return this._controller?.isReducedMotionActive() ?? this._config.reducedMotion === true;
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

  /**
   * Subscribes an external host timeline UI directly to timeline state changes
   * (including dynamic enable/disable via `el.timeline`). Invokes `listener`
   * immediately with the current state (or `null`) and returns an unsubscribe handle.
   */
  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void {
    return this._timelineNotifier.subscribe(
      listener,
      this._controller?.getTimeline()?.getState() ?? null,
    );
  }

  /** Deterministic frame stepping helper for unit tests and headless animations. */
  stepForTest(dtMs = 16): boolean {
    return this._controller?.stepForTest(dtMs) ?? true;
  }

  // ---------------------------------------------------------------------------
  // Internal lifecycle, attribute sync & event dispatch
  // ---------------------------------------------------------------------------

  private setRemountConfig<
    K extends
      | 'getId'
      | 'getTags'
      | 'normalizeTag'
      | 'formatTagLabel'
      | 'resolveTagMeta'
      | 'deriveClusterMeta',
  >(
    key: K,
    value: SimplexWcControllerConfig<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >[K],
  ): void {
    this._config[key] = value;
    if (this._controller) this.remountController();
  }

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
          this._config.items = parsed;
        }
      }
    }
  }

  private applyAttribute(
    name: ObservedAttributeName,
    newValue: string | null,
    syncLive = true,
  ): void {
    const handler = ATTRIBUTE_HANDLERS[name];
    if (!handler) return;
    const live = syncLive ? this._controller : null;
    handler(
      {
        config: this._config,
        live,
        setRenderer: (renderer) => {
          this._renderer = renderer;
        },
        setItemsExplicitly: (items) => {
          this._config.items = items;
          this._itemsExplicitlySet = true;
          live?.setItems(items);
        },
        setHighlightedIds: (ids) => {
          this._highlightedIds = ids;
          live?.setHighlightedIds(ids);
        },
        setPinnedIds: (ids) => {
          this._pinnedIds = ids;
          live?.setPinnedIds(ids ?? []);
        },
        syncTimelineSubscription: () => {
          this.syncTimelineSubscription();
        },
      },
      newValue,
    );
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

    const ctrl = SimplexSvgController.createFromResolved<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >(stage, {
      ...this._config,
      interactions: this.buildComposedInteractions(),
      onMetricsChange: (metrics) => {
        this.emitEvent('simplex-metrics', metrics);
      },
      onClustersChange: (clusters) => {
        this.emitEvent('simplex-clusters-change', clusters);
      },
      onZoomStateChange: (state) => {
        this.emitEvent('simplex-zoom', state);
      },
      onSelectionChange: (selectedIds) => {
        const snapshot = new Set(selectedIds);
        this._config.selectedIds = snapshot;
        this.emitEvent<SimplexSelectionChangeDetail>('simplex-selection-change', {
          selectedIds: snapshot,
          ids: Array.from(snapshot).sort(),
        });
      },
      onLegendChange: (model) => {
        this.emitEvent<SimplexLegendModel<TItem, TTagMeta, TClusterMeta>>(
          'simplex-legend-change',
          model,
        );
      },
    });
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
    let isFirst = true;
    this._timelineUnsubscribe = this._controller.subscribeTimeline((state) => {
      if (state) {
        this.emitEvent<SimplexTimelineState<TItem>>('simplex-timeline-change', state);
      }
      // Avoid duplicate synchronous callback when no timeline is active on initial mount
      if (!isFirst || state !== null) {
        this._timelineNotifier.notify(state);
      }
      isFirst = false;
    });
  }

  private dispatchHover(
    userConsumed: boolean | void,
    detail: SimplexHoverEventDetail<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    > | null,
  ): boolean | void {
    if (detail) {
      this._lastHoverWasActive = true;
      const prevented = this.emitCancelableEvent('simplex-hover', detail);
      return userConsumed === true || prevented;
    }
    if (this._lastHoverWasActive) {
      this._lastHoverWasActive = false;
      this.emitCancelableEvent('simplex-hover', { kind: null, event: null });
    }
    return userConsumed;
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
      onContentHover: (ev) =>
        this.dispatchHover(
          user?.onContentHover?.(ev),
          ev ? { kind: 'content', event: ev } : null,
        ),
      onClusterHover: (ev) =>
        this.dispatchHover(
          user?.onClusterHover?.(ev),
          ev ? { kind: 'cluster', event: ev } : null,
        ),
      onTriangleHover: (ev) =>
        this.dispatchHover(
          user?.onTriangleHover?.(ev),
          ev ? { kind: 'triangle', event: ev } : null,
        ),
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
