import { isPointInTriangle } from './geometry.js';
import { extractSimplexItemLabel } from './presetShared.js';
import type { SimplexColorTheme } from './strategies.js';
import type {
  CameraController,
  ClusterHoverEvent,
  ContentHoverEvent,
  HitTarget,
  InteractionHandlers,
  NormalizedPointerEvent,
  NormalizedWheelEvent,
  ReducedMotionPreference,
  SimplexHoverTarget,
  SimplexInteractiveTarget,
  SimplexKeyboardFocusTarget,
  SimplexMesh,
  TriangleHoverEvent,
} from './types.js';
import type { SimplexZoomState, SimplexZoomStrategy } from './zoom.js';

// ============================================================================
// Minimal Structural DOM Interfaces (Zero dependency on TypeScript's DOM lib)
// ============================================================================

export interface SimplexDomRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SimplexDomStyleLike {
  position: string;
  width: string;
  height: string;
  padding: string;
  margin: string;
  overflow: string;
  clip: string;
  clipPath: string;
  whiteSpace: string;
  border: string;
  pointerEvents: string;
  display: string;
  left: string;
  top: string;
  background: string;
  color: string;
  boxShadow: string;
  cursor: string;
  touchAction: string;
  maxWidth?: string;
  borderRadius?: string;
  fontFamily?: string;
  fontSize?: string;
  lineHeight?: string;
  zIndex?: string;
}

export interface SimplexDomElementLike {
  readonly ownerDocument: SimplexDomDocumentLike | null;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly parentElement: SimplexDomElementLike | null;
  readonly style: SimplexDomStyleLike;
  textContent: string | null;
  getBoundingClientRect(): SimplexDomRectLike;
  setAttribute(name: string, value: string): void;
}

interface SimplexDomContainerOpsLike {
  appendChild(node: unknown): unknown;
  removeChild(child: unknown): unknown;
}

export interface SimplexDomDivLike extends SimplexDomElementLike {
  className: string;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly dataset?: Record<string, string | undefined>;
  remove?: () => void;
}

export interface SimplexDomFontSetLike {
  readonly status?: string;
  readonly ready?: Promise<unknown>;
  addEventListener?: (type: 'loadingdone', listener: () => void) => void;
  removeEventListener?: (type: 'loadingdone', listener: () => void) => void;
}

export interface SimplexDomMediaQueryListLike {
  readonly matches: boolean;
  addEventListener?: (
    type: 'change',
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
  removeEventListener?: (
    type: 'change',
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
  addListener?: (
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
  removeListener?: (
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
}

export interface SimplexDomWindowLike {
  matchMedia?: (query: string) => SimplexDomMediaQueryListLike;
}

export interface SimplexDomDocumentLike {
  readonly defaultView?: SimplexDomWindowLike | null;
  readonly fonts?: SimplexDomFontSetLike;
  createElement(tagName: 'div'): SimplexDomDivLike;
  querySelector<TElement extends SimplexDomElementLike = SimplexDomElementLike>(
    selectors: string,
  ): TElement | null;
}

interface GlobalEnvLike {
  readonly document?: SimplexDomDocumentLike;
  readonly window?: SimplexDomWindowLike;
  readonly ResizeObserver?: new (
    callback: (
      entries: readonly {
        readonly contentRect: { readonly width: number; readonly height: number };
      }[],
    ) => void,
  ) => {
    observe(target: SimplexDomElementLike): void;
    disconnect(): void;
  };
  readonly getComputedStyle?: (el: SimplexDomElementLike) => {
    readonly position: string;
  };
  readonly performance?: { now(): number };
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

function getGlobalEnv(): GlobalEnvLike {
  return globalThis as unknown as GlobalEnvLike;
}

function nowMs(): number {
  const perf = getGlobalEnv().performance;
  return perf ? perf.now() : Date.now();
}

// ============================================================================
// Container Resolution, Sizing & Deferred ResizeObserver
// ============================================================================

/**
 * Resolves a DOM container from either an element reference or a CSS selector string.
 */
export function resolveSimplexContainer<T extends SimplexDomElementLike>(
  target: T | string,
  callerName: string,
): T {
  if (typeof target !== 'string') {
    return target;
  }
  const doc = getGlobalEnv().document;
  if (!doc) {
    throw new Error(
      `${callerName}: cannot resolve selector "${target}" outside a DOM environment.`,
    );
  }
  const el = doc.querySelector<T>(target);
  if (!el) {
    throw new Error(
      `${callerName}: no element matched container selector "${target}".`,
    );
  }
  return el;
}

export interface SimplexMeasuredContainerSize {
  readonly width: number;
  readonly height: number;
  readonly hasValidSize: boolean;
}

/**
 * Measures a container's current CSS pixel dimensions, falling back cleanly when unlaid-out (`0x0`).
 */
export function measureSimplexContainer(
  container: SimplexDomElementLike,
  fallbackWidth = 960,
  fallbackHeight = 620,
  minValidSize = 40,
): SimplexMeasuredContainerSize {
  const rect =
    typeof container.getBoundingClientRect === 'function'
      ? container.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
  const measuredW = rect.width > 0 ? rect.width : container.clientWidth || 0;
  const measuredH = rect.height > 0 ? rect.height : container.clientHeight || 0;
  const hasValidSize = measuredW > minValidSize && measuredH > minValidSize;
  return {
    width: hasValidSize ? measuredW : Math.max(160, fallbackWidth),
    height: hasValidSize ? measuredH : Math.max(160, fallbackHeight),
    hasValidSize,
  };
}

export function ensureSimplexContainerPositioned(
  container: SimplexDomElementLike,
): void {
  const env = getGlobalEnv();
  const computedPos =
    typeof env.getComputedStyle === 'function'
      ? env.getComputedStyle(container).position
      : container.style.position;
  if (!computedPos || computedPos === 'static') {
    container.style.position = 'relative';
  }
}

export interface ObserveSimplexContainerResizeOptions {
  readonly container: SimplexDomElementLike;
  readonly pendingInitialViewport: boolean;
  readonly shouldDeferSolve: boolean;
  readonly deferFallbackTimeoutMs: number | null;
  readonly fallbackWidth?: number;
  readonly fallbackHeight?: number;
  readonly minValidSize?: number;
  readonly isDestroyed: () => boolean;
  readonly onDeferredInit: (width: number, height: number) => void;
  readonly onResize: (width: number, height: number) => void;
}

export interface SimplexResizeObserverHandle {
  disconnect(): void;
}

/**
 * Attaches a `ResizeObserver` (with optional `deferInitialLayout` fallback timeout)
 * and coordinates initial deferred layout vs live viewport updates.
 */
export function observeSimplexContainerResize(
  options: ObserveSimplexContainerResizeOptions,
): SimplexResizeObserverHandle {
  const env = getGlobalEnv();
  const minSize = options.minValidSize ?? 40;
  const fallbackW = options.fallbackWidth ?? 960;
  const fallbackH = options.fallbackHeight ?? 620;
  let pending = options.pendingInitialViewport;
  let fallbackTimer: unknown = null;
  let observer: { observe(t: SimplexDomElementLike): void; disconnect(): void } | null =
    null;

  const clearTimer = (): void => {
    if (fallbackTimer !== null) {
      env.clearTimeout?.(fallbackTimer);
      fallbackTimer = null;
    }
  };

  if (typeof env.ResizeObserver === 'function') {
    observer = new env.ResizeObserver((entries) => {
      if (options.isDestroyed()) return;
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= minSize || height <= minSize) return;

      if (pending) {
        pending = false;
        clearTimer();
        options.onDeferredInit(width, height);
      } else {
        options.onResize(width, height);
      }
    });
    observer.observe(options.container);
  }

  if (
    options.shouldDeferSolve &&
    options.deferFallbackTimeoutMs !== null &&
    typeof env.setTimeout === 'function'
  ) {
    fallbackTimer = env.setTimeout(() => {
      fallbackTimer = null;
      if (options.isDestroyed() || !pending) return;
      const latest = measureSimplexContainer(
        options.container,
        fallbackW,
        fallbackH,
        minSize,
      );
      if (latest.hasValidSize) {
        pending = false;
        options.onDeferredInit(latest.width, latest.height);
      } else {
        // Keep `pending = true` so a real ResizeObserver measurement can re-initialize later
        options.onDeferredInit(fallbackW, fallbackH);
      }
    }, options.deferFallbackTimeoutMs);
  }

  return {
    disconnect(): void {
      clearTimer();
      observer?.disconnect();
      observer = null;
    },
  };
}

// ============================================================================
// Reduced Motion Resolution & Live Media Query Subscription
// ============================================================================

function getWindowForDoc(
  ownerDocument?: SimplexDomDocumentLike | null,
): SimplexDomWindowLike | null {
  if (ownerDocument?.defaultView) return ownerDocument.defaultView;
  return getGlobalEnv().window ?? null;
}

export function resolveSimplexReducedMotion(
  preference: ReducedMotionPreference,
  ownerDocument?: SimplexDomDocumentLike | null,
): boolean {
  if (preference === true) return true;
  if (preference === false) return false;
  const win = getWindowForDoc(ownerDocument);
  if (!win || typeof win.matchMedia !== 'function') return false;
  try {
    return Boolean(win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

export function subscribeSimplexReducedMotionMedia(
  preference: ReducedMotionPreference,
  ownerDocument: SimplexDomDocumentLike | null | undefined,
  onChange: (active: boolean) => void,
): () => void {
  if (preference !== 'auto') return () => {};
  const win = getWindowForDoc(ownerDocument);
  if (!win || typeof win.matchMedia !== 'function') return () => {};

  let mql: SimplexDomMediaQueryListLike;
  try {
    mql = win.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return () => {};
  }
  if (!mql) return () => {};

  const handler = (event?: { readonly matches?: boolean }): void => {
    const matches =
      typeof event?.matches === 'boolean' ? event.matches : Boolean(mql.matches);
    onChange(matches);
  };

  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => {
      mql.removeEventListener?.('change', handler);
    };
  }
  if (typeof mql.addListener === 'function') {
    mql.addListener(handler);
    return () => {
      mql.removeListener?.(handler);
    };
  }
  return () => {};
}

// ============================================================================
// Screen-Reader Live Region & Accessibility Labels
// ============================================================================

export interface SimplexSrAnnouncerHandle {
  readonly element: SimplexDomDivLike;
  announce(message: string): void;
  destroy(): void;
}

export function createSimplexSrAnnouncer(
  container: SimplexDomElementLike,
  doc?: SimplexDomDocumentLike | null,
): SimplexSrAnnouncerHandle {
  const resolvedDoc = doc ?? container.ownerDocument ?? getGlobalEnv().document;
  if (!resolvedDoc) {
    throw new Error('createSimplexSrAnnouncer(): no Document available.');
  }
  const el = resolvedDoc.createElement('div');
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
  const ops = container as unknown as SimplexDomContainerOpsLike;
  ops.appendChild(el);

  return {
    element: el,
    announce(message: string): void {
      if (!message) return;
      if (el.textContent === message) {
        el.textContent = '';
      }
      el.textContent = message;
    },
    destroy(): void {
      if (el.parentElement === container) {
        ops.removeChild(el);
      }
    },
  };
}

export function computeSimplexZoomAnnouncementSignature(
  state: SimplexZoomState,
): string {
  return `${state.mode}:${state.depth}:${state.activeFrameKind}:${state.breadcrumbs
    .map((b) => b.label)
    .join('>')}`;
}

export function formatSimplexInteractiveTargetAriaLabel<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  target: SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  zoomState: SimplexZoomState,
  options?: {
    readonly getLabel?: (item: TItem) => string;
    readonly formatTagLabel?: (tag: string) => string;
  },
): string {
  if (target.kind === 'cluster') {
    const c = target.cluster;
    const name = c.subclusterLabel || c.defaultLabel;
    const count = c.members.length;
    const actionHint =
      zoomState.mode === 'drill-down'
        ? zoomState.activeFrameKind === 'cluster-star' &&
          c.clusterIndex === 0 &&
          zoomState.canDrillUp
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
      .map((c, idx) =>
        c ? c.defaultLabel : `Vertex ${tr.vertexIndices[idx] ?? idx}`,
      )
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

  const title = extractSimplexItemLabel(
    target.item,
    target.layoutContext.id,
    options?.getLabel,
  );
  const tagSummary =
    target.layoutContext.tags.length > 0
      ? target.layoutContext.tags
          .slice(0, 3)
          .map((t) => {
            if (t.label) return t.label;
            if (options?.formatTagLabel) {
              const formatted = options.formatTagLabel(t.tag).trim();
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

export function formatSimplexZoomLevelAnnouncement<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  state: SimplexZoomState,
  targets: readonly SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[],
): string {
  const clusterCount = targets.filter((t) => t.kind === 'cluster').length;
  const itemCount = targets.filter((t) => t.kind === 'item').length;
  const triangleCount = targets.filter((t) => t.kind === 'triangle').length;
  const pathText = state.breadcrumbs.map((b) => b.label).join(' › ');
  const countsParts: string[] = [];
  if (clusterCount > 0) {
    countsParts.push(
      `${clusterCount} ${clusterCount === 1 ? 'cluster' : 'clusters'}`,
    );
  }
  if (triangleCount > 0) {
    countsParts.push(
      `${triangleCount} ${triangleCount === 1 ? 'region' : 'regions'}`,
    );
  }
  if (itemCount > 0) {
    countsParts.push(`${itemCount} ${itemCount === 1 ? 'item' : 'items'}`);
  }
  const countsText = countsParts.join(', ');

  if (state.depth === 0) {
    return `Zoom level 0: ${pathText || 'Overview'}${countsText ? `. ${countsText}` : ''}.`;
  }
  return `Zoom level ${state.depth}: ${pathText}${countsText ? `. ${countsText}` : ''}. Press Escape to zoom out.`;
}

// ============================================================================
// Tooltip Theme Styling & Edge-Flipping Positioning
// ============================================================================

export interface SimplexTooltipThemeTokens {
  readonly background: string;
  readonly border: string;
  readonly color: string;
  readonly mutedColor: string;
  readonly eyebrowColor: string;
  readonly boxShadow: string;
}

/**
 * Returns canonical dark/light floating tooltip theme tokens shared across
 * SVG, Canvas, and React overlays.
 */
export function getSimplexTooltipThemeTokens(
  theme: SimplexColorTheme,
): SimplexTooltipThemeTokens {
  const isLight = theme === 'light';
  return {
    background: isLight
      ? 'rgba(255, 255, 255, 0.96)'
      : 'rgba(9, 13, 22, 0.94)',
    border: isLight
      ? '1px solid rgba(203, 213, 225, 0.95)'
      : '1px solid rgba(51, 65, 85, 0.85)',
    color: isLight ? '#0f172a' : '#f1f5f9',
    mutedColor: isLight ? '#475569' : '#94a3b8',
    eyebrowColor: isLight ? '#64748b' : '#94a3b8',
    boxShadow: isLight
      ? '0 10px 24px rgba(15, 23, 42, 0.12)'
      : '0 10px 24px rgba(0, 0, 0, 0.45)',
  };
}

export function applySimplexTooltipTheme(
  el: SimplexDomDivLike,
  theme: SimplexColorTheme,
): void {
  const tokens = getSimplexTooltipThemeTokens(theme);
  el.style.background = tokens.background;
  el.style.border = tokens.border;
  el.style.color = tokens.color;
  el.style.boxShadow = tokens.boxShadow;
}

export interface ComputeSimplexTooltipCoordsInput {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly tipWidth: number;
  readonly tipHeight: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly margin?: number;
}

export interface SimplexTooltipCoords {
  readonly left: number;
  readonly top: number;
}

/**
 * Computes edge-flipped, margin-clamped `(left, top)` coordinates inside a
 * container for floating DOM and JSX tooltips.
 */
export function computeSimplexTooltipCoords(
  input: ComputeSimplexTooltipCoordsInput,
): SimplexTooltipCoords {
  const offsetX = input.offsetX ?? 14;
  const offsetY = input.offsetY ?? 14;
  const margin = Math.max(0, input.margin ?? 8);
  const containerW = input.containerWidth > 0 ? input.containerWidth : 960;
  const containerH = input.containerHeight > 0 ? input.containerHeight : 600;
  const tipW = input.tipWidth > 0 ? input.tipWidth : 240;
  const tipH = input.tipHeight > 0 ? input.tipHeight : 64;

  const maxLeft = Math.max(margin, containerW - margin - tipW);
  let left = input.screenX + offsetX;
  if (left + tipW > containerW - margin) {
    left = input.screenX - offsetX - tipW;
  }
  left = Math.min(Math.max(margin, Math.round(left)), Math.round(maxLeft));

  const maxTop = Math.max(margin, containerH - margin - tipH);
  let top = input.screenY + offsetY;
  if (top + tipH > containerH - margin) {
    top = input.screenY - offsetY - tipH;
  }
  top = Math.min(Math.max(margin, Math.round(top)), Math.round(maxTop));

  return { left, top };
}

export interface PositionSimplexTooltipOptions {
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly margin?: number;
  readonly measureUnconstrained?: boolean;
}

export function positionSimplexTooltipElement(
  containerEl: SimplexDomElementLike,
  tooltipEl: SimplexDomDivLike,
  screenX: number,
  screenY: number,
  options?: PositionSimplexTooltipOptions,
): void {
  if (options?.measureUnconstrained) {
    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';
  }

  const containerRect =
    typeof containerEl.getBoundingClientRect === 'function'
      ? containerEl.getBoundingClientRect()
      : null;
  const containerW =
    containerEl.clientWidth ||
    (containerRect ? Math.round(containerRect.width) : 0) ||
    960;
  const containerH =
    containerEl.clientHeight ||
    (containerRect ? Math.round(containerRect.height) : 0) ||
    600;

  const tipRect =
    typeof tooltipEl.getBoundingClientRect === 'function'
      ? tooltipEl.getBoundingClientRect()
      : null;
  const measuredW =
    tooltipEl.offsetWidth || (tipRect ? Math.ceil(tipRect.width) : 0);
  const measuredH =
    tooltipEl.offsetHeight || (tipRect ? Math.ceil(tipRect.height) : 0);

  const { left, top } = computeSimplexTooltipCoords({
    containerWidth: containerW,
    containerHeight: containerH,
    tipWidth: measuredW > 0 ? measuredW : 240,
    tipHeight: measuredH > 0 ? measuredH : 64,
    screenX,
    screenY,
    offsetX: options?.offsetX,
    offsetY: options?.offsetY,
    margin: options?.margin,
  });

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

export type SimplexTooltipTargetInput<
  TItem = unknown,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> = SimplexHoverTarget<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
>;

export type SimplexTooltipContentModel =
  | {
      readonly kind: 'content';
      readonly title: string;
      readonly subtitle: string | null;
      readonly hint: string | null;
    }
  | {
      readonly kind: 'cluster';
      readonly eyebrow: string | null;
      readonly code: string;
      readonly label: string;
      readonly title: string;
      readonly accentColorHex: string;
      readonly countText: string;
      readonly hint: string | null;
    }
  | {
      readonly kind: 'triangle';
      readonly isContext: boolean;
      readonly title: string;
      readonly cornersShort: string;
      readonly cornersDetailed: string;
      readonly countText: string;
      readonly interiorSummaryText: string;
      readonly hint: string | null;
    };

export interface BuildSimplexTooltipModelOptions<TItem> {
  readonly getLabel?: (item: TItem) => string;
  readonly formatTagLabel?: (tag: string) => string;
  readonly preferSubclusterLabel?: boolean;
  readonly zoomMode?: 'drill-down' | 'free-camera';
  readonly zoomState?: SimplexZoomState;
  readonly neighborHint?: string;
}

/**
 * Extracts structured tooltip display fields (labels, formatted tags, cluster
 * weights, member counts, and drill-down hints) shared by SVG, Canvas, and React.
 */
export function buildSimplexTooltipContentModel<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  target: SimplexTooltipTargetInput<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  options?: BuildSimplexTooltipModelOptions<TItem>,
): SimplexTooltipContentModel {
  const neighborHint = options?.neighborHint ?? 'Click to switch to neighbor';

  if (target.kind === 'content') {
    const title = extractSimplexItemLabel(
      target.item,
      target.layoutContext.id,
      options?.getLabel,
    );
    const tagList = target.layoutContext.tags
      .map((t) => {
        if (t.label) return t.label;
        if (options?.formatTagLabel) {
          const formatted = options.formatTagLabel(t.tag).trim();
          if (formatted.length > 0) return formatted;
        }
        return `#${t.tag}`;
      })
      .slice(0, 5)
      .join(' · ');
    const weightList =
      tagList || target.layoutContext.unitClusters.length === 0
        ? ''
        : target.layoutContext.unitClusters
            .map((uc) => `${uc.cluster.code} ${Math.round(uc.weight * 100)}%`)
            .join(' · ');
    return {
      kind: 'content',
      title,
      subtitle: tagList || weightList || null,
      hint: target.neighborId ? neighborHint : null,
    };
  }

  if (target.kind === 'cluster') {
    const label = options?.preferSubclusterLabel
      ? target.cluster.subclusterLabel || target.cluster.defaultLabel
      : target.cluster.defaultLabel;
    const count = target.cluster.members.length;
    return {
      kind: 'cluster',
      eyebrow: target.cluster.parentContextLabel ?? null,
      code: target.cluster.code,
      label,
      title: `${target.cluster.code} · ${label}`,
      accentColorHex: target.cluster.colorHex,
      countText: `${count} ${count === 1 ? 'item' : 'items'}`,
      hint: target.neighborId ? neighborHint : null,
    };
  }

  const tr = target.triangle;
  const cornersShort = tr.clusters
    .map((c, idx) => (c ? c.code : `V${tr.vertexIndices[idx] ?? idx}`))
    .join(' · ');
  const cornersDetailed = tr.clusters
    .map((c, idx) =>
      c ? `${c.code} (${c.defaultLabel})` : `V${tr.vertexIndices[idx] ?? idx}`,
    )
    .join(' · ');
  const count = tr.coveredItemCount;
  let hint: string | null = null;
  if (tr.isContext) {
    hint = tr.neighborId ? neighborHint : null;
  } else if (options?.zoomMode === 'drill-down' && options.zoomState) {
    const zState = options.zoomState;
    if (zState.activeFrameKind === 'triangle-focus' && zState.canDrillUp) {
      hint = 'Click to zoom out';
    } else if (zState.drillableTriangleIndices.includes(tr.index)) {
      hint = 'Click to zoom in';
    } else if (zState.focusableTriangleIndices.includes(tr.index)) {
      hint = 'Click to focus triangle';
    }
  }

  return {
    kind: 'triangle',
    isContext: Boolean(tr.isContext),
    title: tr.isContext ? 'Neighbor Triangle' : `Triangle #${tr.index + 1}`,
    cornersShort,
    cornersDetailed,
    countText: `${count} ${count === 1 ? 'item' : 'items'}`,
    interiorSummaryText: `${tr.coveredItemCount} items · ${tr.interiorItemCount} interior`,
    hint,
  };
}

/**
 * Formats a concise multi-line plain-text tooltip string from a hover target.
 */
export function formatSimplexTooltipText<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  target: SimplexTooltipTargetInput<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  options?: BuildSimplexTooltipModelOptions<TItem>,
): string {
  const model = buildSimplexTooltipContentModel(target, options);
  if (model.kind === 'content') {
    const base = model.subtitle ? `${model.title}\n${model.subtitle}` : model.title;
    return model.hint ? `${base}\n${model.hint}` : base;
  }
  if (model.kind === 'cluster') {
    const base = `${model.title}\n${model.countText}`;
    return model.hint ? `${base}\n${model.hint}` : base;
  }
  const header = model.isContext
    ? `Neighbor (${model.cornersShort})`
    : `${model.title} (${model.cornersShort})`;
  const base = `${header}\n${model.countText}`;
  return model.hint ? `${base}\n${model.hint}` : base;
}

// ============================================================================
// Webfont Load Relayout Subscription
// ============================================================================

export function subscribeSimplexFontLoadRelayout(
  doc: SimplexDomDocumentLike | null | undefined,
  onRelayout: () => void,
  timeoutMs = 2000,
): () => void {
  const fontSet = doc?.fonts;
  if (!fontSet) return () => {};

  const env = getGlobalEnv();
  let disposed = false;
  let readyTriggeredByEvent = false;
  let readyTimedOut = false;
  let timeoutId: unknown = null;

  const onLoadingDone = (): void => {
    if (disposed) return;
    readyTriggeredByEvent = true;
    onRelayout();
  };

  if (typeof fontSet.addEventListener === 'function') {
    fontSet.addEventListener('loadingdone', onLoadingDone);
  }

  if (
    fontSet.status !== 'loaded' &&
    fontSet.ready &&
    typeof fontSet.ready.then === 'function'
  ) {
    if (typeof env.setTimeout === 'function') {
      timeoutId = env.setTimeout(() => {
        readyTimedOut = true;
        timeoutId = null;
      }, timeoutMs);
    }
    fontSet.ready.then(
      () => {
        if (timeoutId !== null) {
          env.clearTimeout?.(timeoutId);
          timeoutId = null;
        }
        if (disposed || readyTimedOut || readyTriggeredByEvent) return;
        onRelayout();
      },
      () => {
        if (timeoutId !== null) {
          env.clearTimeout?.(timeoutId);
          timeoutId = null;
        }
      },
    );
  }

  return () => {
    disposed = true;
    if (timeoutId !== null) {
      env.clearTimeout?.(timeoutId);
      timeoutId = null;
    }
    if (typeof fontSet.removeEventListener === 'function') {
      fontSet.removeEventListener('loadingdone', onLoadingDone);
    }
  };
}

// ============================================================================
// Shared Gesture, Cursor, Pinch-Drill, Click & Keyboard Helpers
// ============================================================================

export interface SimplexInteractiveEngineSlice<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  getZoomState(): SimplexZoomState;
  getZoomStrategy(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>;
  getMesh(): SimplexMesh | null;
  hitTest(
    screenX: number,
    screenY: number,
  ): HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>;
  getSelectedIds(): ReadonlySet<string>;
  getFocusedItemId(): string | null;
}

export type SimplexPinchDrillTarget =
  | { readonly kind: 'neighbor'; readonly neighborId: string }
  | { readonly kind: 'triangle'; readonly index: number }
  | { readonly kind: 'cluster'; readonly clusterUid: string };

/**
 * Resolves which neighbor/triangle/cluster a pinch-in gesture at `(screenX, screenY)`
 * should drill into, matching hit targets and spatial triangle fallbacks identically
 * across SVG and Canvas controllers.
 */
export function resolveSimplexPinchDrillTarget<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  engine: SimplexInteractiveEngineSlice<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  screenX: number,
  screenY: number,
): SimplexPinchDrillTarget | null {
  const zState = engine.getZoomState();
  const hit = engine.hitTest(screenX, screenY);

  if (hit.kind === 'triangle') {
    if (hit.triangle.neighborId) {
      return { kind: 'neighbor', neighborId: hit.triangle.neighborId };
    }
    if (!hit.triangle.isContext && zState.activeFrameKind !== 'triangle-focus') {
      return { kind: 'triangle', index: hit.triangle.index };
    }
    return null;
  }

  if (hit.kind === 'cluster') {
    if (hit.neighborId) {
      return { kind: 'neighbor', neighborId: hit.neighborId };
    }
    return { kind: 'cluster', clusterUid: hit.cluster.clusterUid };
  }

  const candidateTriIndices =
    zState.drillableTriangleIndices.length > 0
      ? zState.drillableTriangleIndices
      : zState.focusableTriangleIndices;

  if (hit.kind === 'content') {
    const mesh = engine.getMesh();
    if (mesh) {
      for (const triIdx of candidateTriIndices) {
        const tri = mesh.triangles[triIdx];
        if (!tri) continue;
        const p0 = mesh.vertices[tri.vertices[0]];
        const p1 = mesh.vertices[tri.vertices[1]];
        const p2 = mesh.vertices[tri.vertices[2]];
        if (
          p0 &&
          p1 &&
          p2 &&
          isPointInTriangle(hit.worldPosition.x, hit.worldPosition.y, p0, p1, p2)
        ) {
          return { kind: 'triangle', index: triIdx };
        }
      }
    }
    const primaryCluster = hit.layoutContext.unitClusters[0]?.cluster;
    if (
      primaryCluster &&
      zState.drillableClusterUids.includes(primaryCluster.clusterUid)
    ) {
      return { kind: 'cluster', clusterUid: primaryCluster.clusterUid };
    }
  }

  if (candidateTriIndices.length > 0) {
    const mesh = engine.getMesh();
    if (mesh) {
      let bestIdx = candidateTriIndices[0]!;
      let bestDist = Infinity;
      for (const triIdx of candidateTriIndices) {
        const tri = mesh.triangles[triIdx];
        if (!tri) continue;
        const p0 = mesh.vertices[tri.vertices[0]];
        const p1 = mesh.vertices[tri.vertices[1]];
        const p2 = mesh.vertices[tri.vertices[2]];
        if (!p0 || !p1 || !p2) continue;
        const cx = (p0.x + p1.x + p2.x) / 3;
        const cy = (p0.y + p1.y + p2.y) / 3;
        const d = Math.hypot(cx - hit.worldPosition.x, cy - hit.worldPosition.y);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = triIdx;
        }
      }
      return { kind: 'triangle', index: bestIdx };
    }
  }

  return null;
}

export function applySimplexPinchDrillTarget(
  target: SimplexPinchDrillTarget | null,
  actions: {
    readonly drillToNeighbor: (neighborId: string) => boolean;
    readonly drillDownTriangle: (index: number) => boolean;
    readonly drillDownCluster: (clusterUid: string) => boolean;
  },
): boolean {
  if (!target) return false;
  if (target.kind === 'neighbor') {
    return actions.drillToNeighbor(target.neighborId);
  }
  if (target.kind === 'triangle') {
    return actions.drillDownTriangle(target.index);
  }
  return actions.drillDownCluster(target.clusterUid);
}

export type SimplexCursorKind =
  | 'pointer'
  | 'zoom-in'
  | 'zoom-out'
  | 'grab'
  | 'default';

/**
 * Computes the hover cursor state for `(screenX, screenY)` identically across SVG & Canvas.
 */
export function resolveSimplexCursorForPoint<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  engine: SimplexInteractiveEngineSlice<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  screenX: number,
  screenY: number,
): SimplexCursorKind {
  const zoomMode = engine.getZoomStrategy().mode;
  const hit = engine.hitTest(screenX, screenY);

  if (zoomMode === 'drill-down') {
    const zState = engine.getZoomState();
    if (hit.kind === 'triangle') {
      if (hit.triangle.neighborId) return 'pointer';
      if (zState.activeFrameKind === 'triangle-focus' && zState.canDrillUp) {
        return 'zoom-out';
      }
      return zState.drillableTriangleIndices.includes(hit.triangle.index) ||
        zState.focusableTriangleIndices.includes(hit.triangle.index)
        ? 'zoom-in'
        : 'default';
    }
    if (hit.kind === 'cluster') {
      if (hit.neighborId) return 'pointer';
      if (
        zState.activeFrameKind === 'cluster-star' &&
        hit.cluster.clusterIndex === 0 &&
        zState.canDrillUp
      ) {
        return 'zoom-out';
      }
      return zState.drillableClusterUids.includes(hit.cluster.clusterUid)
        ? 'zoom-in'
        : 'default';
    }
    if (hit.kind === 'content') {
      return 'pointer';
    }
    return zState.canDrillUp ? 'zoom-out' : 'default';
  }

  return hit.kind === 'background' ? 'grab' : 'pointer';
}

export interface SimplexWheelPinchState {
  accum: number;
  cooldownUntil: number;
}

/**
 * Tracks discrete trackpad pinch-in / pinch-out thresholds in drill-down mode.
 */
export function stepSimplexDrillDownWheelPinch(
  state: SimplexWheelPinchState,
  deltaY: number,
  now = nowMs(),
  threshold = 22,
  cooldownMs = 360,
): 'drill-in' | 'drill-up' | null {
  if (now < state.cooldownUntil) return null;
  state.accum += deltaY;
  if (state.accum <= -threshold) {
    state.accum = 0;
    state.cooldownUntil = now + cooldownMs;
    return 'drill-in';
  }
  if (state.accum >= threshold) {
    state.accum = 0;
    state.cooldownUntil = now + cooldownMs;
    return 'drill-up';
  }
  return null;
}

export function normalizeSimplexMarqueeRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * Shared default left-click dispatcher unifying drill-down and free-camera focus
 * behavior across SVG, Canvas, React, and Web Component wrappers.
 */
export function dispatchSimplexDefaultLeftClick<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  target: HitTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  rawEvent: NormalizedPointerEvent,
  context: {
    readonly userInteractions?: InteractionHandlers<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >;
    readonly zoomMode: 'drill-down' | 'free-camera';
    readonly canDrillUp: boolean;
    readonly selectedCount: number;
    readonly focusedItemId: string | null;
    readonly focusedClusterUid: string | null;
    readonly focusedTriangleIndex: number | null;
    readonly focusOnClusterClick?: boolean;
    readonly focusOnTriangleClick?: boolean;
    readonly drillToNeighbor: (neighborId: string) => boolean;
    readonly drillDownTriangle: (triangleIndex: number) => boolean;
    readonly drillDownCluster: (clusterUid: string) => boolean;
    readonly drillUp: () => boolean;
    readonly setFocusedClusterUid: (clusterUid: string | null) => void;
    readonly setFocusedTriangleIndex: (triangleIndex: number | null) => void;
    readonly clearFocusedItem: () => void;
    readonly clearSelection: () => void;
  },
): boolean {
  const ui = context.userInteractions;
  if (target.kind === 'content' && !target.neighborId) {
    if (ui?.onContentClick?.(target, rawEvent) === true) return true;
  } else if (target.kind === 'cluster') {
    if (ui?.onClusterClick?.(target, rawEvent) === true) return true;
  } else if (target.kind === 'triangle') {
    if (ui?.onTriangleClick?.(target, rawEvent) === true) return true;
  } else if (target.kind === 'background') {
    if (ui?.onBackgroundClick?.(rawEvent) === true) return true;
  }
  if (ui?.onLeftClick?.(target, rawEvent) === true) {
    return true;
  }

  if (context.zoomMode === 'drill-down') {
    if (target.kind === 'triangle') {
      if (target.triangle.neighborId) {
        context.drillToNeighbor(target.triangle.neighborId);
      } else if (!target.triangle.isContext) {
        context.drillDownTriangle(target.triangle.index);
      }
    } else if (target.kind === 'cluster') {
      if (target.neighborId) {
        context.drillToNeighbor(target.neighborId);
      } else {
        context.drillDownCluster(target.cluster.clusterUid);
      }
    } else if (target.kind === 'content' && target.neighborId) {
      context.drillToNeighbor(target.neighborId);
    } else if (target.kind === 'background') {
      if (context.canDrillUp) {
        context.drillUp();
      } else if (!rawEvent.shiftKey && context.selectedCount > 0) {
        context.clearSelection();
      }
    }
    return false;
  }

  // Free-camera mode defaults: toggle focus or clear focus/selection on background
  if (target.kind === 'cluster' && context.focusOnClusterClick !== false) {
    if (context.focusedTriangleIndex !== null) {
      context.setFocusedTriangleIndex(null);
    }
    const next =
      context.focusedClusterUid === target.cluster.clusterUid
        ? null
        : target.cluster.clusterUid;
    context.setFocusedClusterUid(next);
  } else if (
    target.kind === 'triangle' &&
    context.focusOnTriangleClick !== false
  ) {
    if (context.focusedClusterUid !== null) {
      context.setFocusedClusterUid(null);
    }
    const next =
      context.focusedTriangleIndex === target.triangle.index
        ? null
        : target.triangle.index;
    context.setFocusedTriangleIndex(next);
  } else if (target.kind === 'background') {
    if (context.focusedClusterUid !== null) {
      context.setFocusedClusterUid(null);
    }
    if (context.focusedTriangleIndex !== null) {
      context.setFocusedTriangleIndex(null);
    }
    if (context.focusedItemId !== null) {
      context.clearFocusedItem();
    }
    if (!rawEvent.shiftKey && context.selectedCount > 0) {
      context.clearSelection();
    }
  }
  return false;
}

// ============================================================================
// Keyboard Target Matching & Focus Stepping
// ============================================================================

export function isSameSimplexKeyboardTarget<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
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

export function toSimplexKeyboardFocusTargetRef<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
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

export function resolveNextSimplexKeyboardFocusIndex(
  targetCount: number,
  currentIndex: number,
  key: string,
): number | null {
  if (targetCount <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return targetCount - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return currentIndex < 0 ? 0 : (currentIndex + 1) % targetCount;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return currentIndex <= 0 ? targetCount - 1 : currentIndex - 1;
  }
  return null;
}

export function isSimplexHoverEventConsumed<TEvent>(
  userHandler: ((event: TEvent | null) => boolean | void) | undefined,
  event: TEvent | null,
): boolean {
  const consumed = userHandler?.(event);
  return consumed === true;
}

export function zoomSimplexViewportByFactor(
  element: Pick<SimplexDomElementLike, 'getBoundingClientRect' | 'clientWidth' | 'clientHeight'>,
  camera: Pick<CameraController, 'zoomToCursor'>,
  factor: number,
  fallbackWidth = 960,
  fallbackHeight = 620,
): void {
  const rect =
    typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
  const width = rect.width > 0 ? rect.width : element.clientWidth || fallbackWidth;
  const height = rect.height > 0 ? rect.height : element.clientHeight || fallbackHeight;
  camera.zoomToCursor(width / 2, height / 2, factor);
}

export function toSimplexNormalizedPointerEvent(
  ev: {
    readonly button: number;
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
  },
  localX: number,
  localY: number,
  screenToWorld: (x: number, y: number) => { readonly x: number; readonly y: number },
): NormalizedPointerEvent {
  const world = screenToWorld(localX, localY);
  return {
    screenX: localX,
    screenY: localY,
    worldX: world.x,
    worldY: world.y,
    button: ev.button,
    shiftKey: ev.shiftKey,
    ctrlKey: ev.ctrlKey,
    altKey: ev.altKey,
    metaKey: ev.metaKey,
  };
}

// ============================================================================
// Shared Tooltip Overlay & Interactive Viewport Controller
// ============================================================================

export interface SimplexDomTooltipRendererLike<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike = SimplexDomDivLike,
> {
  readonly render: (
    target: SimplexTooltipTargetInput<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
    containerEl: TElement,
  ) => void | boolean | null | (() => void);
  readonly unstyled?: boolean;
  readonly offset?: { readonly x?: number; readonly y?: number };
  readonly margin?: number;
  readonly className?: string;
  readonly onHide?: (containerEl: TElement) => void;
}

export interface SimplexStructuredTooltipFormatterLike<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly formatContent?: (
    ev: ContentHoverEvent<TItem, TContentVisual, TTagMeta, TClusterMeta>,
  ) => string | null | undefined | false;
  readonly formatCluster?: (
    ev: ClusterHoverEvent<TItem, TClusterVisual, TTagMeta, TClusterMeta>,
  ) => string | null | undefined | false;
  readonly formatTriangle?: (
    ev: TriangleHoverEvent<TItem, TTagMeta, TClusterMeta>,
  ) => string | null | undefined | false;
}

export type SimplexTooltipOverlayOptionLike<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike = SimplexDomDivLike,
> =
  | boolean
  | ((
      target: SimplexTooltipTargetInput<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ) => string | null | undefined | false)
  | SimplexStructuredTooltipFormatterLike<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >
  | SimplexDomTooltipRendererLike<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta,
      TElement
    >;

export interface CreateSimplexTooltipOverlayOptions<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike = SimplexDomDivLike,
> {
  readonly hostEl: SimplexDomElementLike & SimplexDomContainerOpsLike;
  readonly baseClassName?: string;
  readonly ensureHostPositioned?: boolean;
  readonly initialTheme: SimplexColorTheme;
  readonly initialOption: SimplexTooltipOverlayOptionLike<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta,
    TElement
  >;
  readonly getDefaultText: (
    target: SimplexTooltipTargetInput<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ) => string | null | undefined | false;
}

export interface SimplexTooltipOverlay<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike = SimplexDomDivLike,
> {
  showForTarget(
    target: SimplexTooltipTargetInput<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void;
  hide(): void;
  setTheme(theme: SimplexColorTheme): void;
  setOption(
    option: SimplexTooltipOverlayOptionLike<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta,
      TElement
    >,
  ): void;
  destroy(): void;
}

function isDomTooltipRendererOption<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike,
>(
  opt: SimplexTooltipOverlayOptionLike<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta,
    TElement
  >,
): opt is SimplexDomTooltipRendererLike<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement
> {
  return (
    typeof opt === 'object' &&
    opt !== null &&
    'render' in opt &&
    typeof opt.render === 'function'
  );
}

function getTooltipTargetKey<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  target: SimplexTooltipTargetInput<
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

/**
 * Shared floating tooltip DOM overlay controller handling lazy mounting,
 * theme styles, custom DOM renderers, target deduplication, cleanup callbacks,
 * and viewport edge-flipping across SVG and Canvas controllers.
 */
export function createSimplexTooltipOverlay<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike = SimplexDomDivLike,
>(
  options: CreateSimplexTooltipOverlayOptions<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta,
    TElement
  >,
): SimplexTooltipOverlay<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement
> {
  const baseClassName = options.baseClassName ?? 'sv-tooltip';
  let currentTheme = options.initialTheme;
  let currentOption = options.initialOption;
  let tooltipEl: TElement | null = null;
  let tooltipCleanup: (() => void) | null = null;
  let activeTargetKey: string | null = null;
  let activeSuppressed = false;
  let visible = false;

  const isUnstyled = (): boolean =>
    isDomTooltipRendererOption(currentOption) && currentOption.unstyled !== false;

  const applyThemeStyles = (el: TElement): void => {
    if (isUnstyled()) return;
    applySimplexTooltipTheme(el, currentTheme);
  };

  const applyPresentationStyles = (el: TElement): void => {
    const domRenderer = isDomTooltipRendererOption(currentOption)
      ? currentOption
      : null;
    const customClass = domRenderer?.className?.trim();
    el.className = customClass ? `${baseClassName} ${customClass}` : baseClassName;
    el.setAttribute('role', 'tooltip');
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '20';

    if (isUnstyled()) {
      if (el.dataset) el.dataset.tooltipMode = 'custom';
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

    if (el.dataset) el.dataset.tooltipMode = 'styled';
    el.style.maxWidth = '240px';
    el.style.padding = '7px 10px';
    el.style.borderRadius = '8px';
    el.style.fontFamily =
      'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
    el.style.fontSize = '12px';
    el.style.lineHeight = '1.4';
    el.style.whiteSpace = domRenderer ? '' : 'pre-line';
    applyThemeStyles(el);
  };

  const ensureElement = (): TElement | null => {
    if (!currentOption) return null;
    if (tooltipEl) return tooltipEl;

    const doc = options.hostEl.ownerDocument ?? getGlobalEnv().document;
    if (!doc) return null;
    if (options.ensureHostPositioned !== false) {
      ensureSimplexContainerPositioned(options.hostEl);
    }

    const el = doc.createElement('div') as TElement;
    el.style.display = 'none';
    applyPresentationStyles(el);
    options.hostEl.appendChild(el);
    tooltipEl = el;
    return el;
  };

  const runCleanup = (): void => {
    const cleanup = tooltipCleanup;
    tooltipCleanup = null;
    if (cleanup) {
      cleanup();
    }
  };

  const positionElement = (
    el: TElement,
    screenX: number,
    screenY: number,
    measureUnconstrained = false,
  ): void => {
    const domRenderer = isDomTooltipRendererOption(currentOption)
      ? currentOption
      : null;
    positionSimplexTooltipElement(options.hostEl, el, screenX, screenY, {
      offsetX: domRenderer?.offset?.x,
      offsetY: domRenderer?.offset?.y,
      margin: domRenderer?.margin,
      measureUnconstrained,
    });
  };

  const formatText = (
    target: SimplexTooltipTargetInput<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): string | null | undefined | false => {
    if (typeof currentOption === 'function') {
      return currentOption(target);
    }
    if (typeof currentOption === 'object' && currentOption !== null && !('render' in currentOption)) {
      const obj = currentOption as SimplexStructuredTooltipFormatterLike<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >;
      if (target.kind === 'content' && obj.formatContent) {
        return obj.formatContent(target);
      }
      if (target.kind === 'cluster' && obj.formatCluster) {
        return obj.formatCluster(target);
      }
      if (target.kind === 'triangle' && obj.formatTriangle) {
        return obj.formatTriangle(target);
      }
    }
    return options.getDefaultText(target);
  };

  const hide = (): void => {
    const domRenderer = isDomTooltipRendererOption(currentOption)
      ? currentOption
      : null;
    const wasVisible = visible;
    runCleanup();
    activeTargetKey = null;
    activeSuppressed = false;
    visible = false;
    if (tooltipEl) {
      tooltipEl.style.display = 'none';
      if (wasVisible && domRenderer?.onHide) {
        domRenderer.onHide(tooltipEl);
      }
    }
  };

  return {
    showForTarget(target) {
      const el = ensureElement();
      if (!el) return;

      const targetKey = getTooltipTargetKey(target);

      if (isDomTooltipRendererOption(currentOption)) {
        if (targetKey === activeTargetKey) {
          if (activeSuppressed) return;
          el.style.display = 'block';
          visible = true;
          positionElement(el, target.screenPosition.x, target.screenPosition.y);
          return;
        }

        runCleanup();
        el.textContent = '';
        activeTargetKey = targetKey;

        const result = currentOption.render(target, el);
        if (result === false || result === null) {
          activeSuppressed = true;
          if (visible) {
            el.style.display = 'none';
            visible = false;
            currentOption.onHide?.(el);
          }
          return;
        }

        if (typeof result === 'function') {
          tooltipCleanup = result;
        }
        activeSuppressed = false;
        el.style.display = 'block';
        visible = true;
        positionElement(
          el,
          target.screenPosition.x,
          target.screenPosition.y,
          true,
        );
        return;
      }

      const text = formatText(target);
      if (!text) {
        hide();
        return;
      }

      const targetChanged = targetKey !== activeTargetKey;
      activeTargetKey = targetKey;
      activeSuppressed = false;
      el.textContent = text;
      el.style.display = 'block';
      visible = true;
      positionElement(
        el,
        target.screenPosition.x,
        target.screenPosition.y,
        targetChanged,
      );
    },

    hide,

    setTheme(theme) {
      currentTheme = theme;
      if (tooltipEl) {
        applyThemeStyles(tooltipEl);
      }
    },

    setOption(option) {
      hide();
      currentOption = option;
      if (tooltipEl) {
        tooltipEl.textContent = '';
        applyPresentationStyles(tooltipEl);
      }
    },

    destroy() {
      hide();
      if (tooltipEl && tooltipEl.parentElement === options.hostEl) {
        options.hostEl.removeChild(tooltipEl);
        tooltipEl = null;
      }
    },
  };
}

export interface SimplexDomPointerEventLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface SimplexDomMouseEventLike {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  preventDefault(): void;
}

export interface SimplexDomWheelEventLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

export interface SimplexDomTouchEventLike {
  readonly touches: {
    readonly length: number;
    [index: number]: { readonly clientX: number; readonly clientY: number } | undefined;
  };
  preventDefault(): void;
}

export interface SimplexDomKeyboardEventLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  preventDefault(): void;
}

export interface SimplexDomInteractiveSurfaceLike {
  readonly ownerDocument: SimplexDomDocumentLike | null;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly style: {
    cursor: string;
    touchAction: string;
  };
  getBoundingClientRect(): SimplexDomRectLike;
  setPointerCapture?(pointerId: number): void;
  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean | { readonly passive?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean,
  ): void;
}

export interface BindSimplexInteractiveViewportOptions<
  TItem = unknown,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = unknown,
  TClusterMeta = unknown,
> {
  readonly surfaceEl: SimplexDomInteractiveSurfaceLike;
  readonly engine: SimplexInteractiveEngineSlice<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > & {
    readonly camera: Pick<
      CameraController,
      'panBy' | 'zoomToCursor' | 'screenToWorld'
    >;
    handlePointerMove(screenX: number, screenY: number): void;
    handlePointerLeave(): void;
    handleLeftClick(ev: NormalizedPointerEvent): void;
    handleRightClick(ev: NormalizedPointerEvent): boolean;
    handleWheel(ev: NormalizedWheelEvent): boolean;
  };
  /**
   * SVG dispatches left clicks from native `'click'` (with 400ms pointer drag suppression);
   * Canvas dispatches left clicks synchronously from `'pointerup'`.
   */
  readonly clickDispatch: 'click-event' | 'pointerup';
  /** Attaches passive/non-passive `touchstart`/`touchmove`/`touchend`/`touchcancel` listeners (used on SVG). */
  readonly bindTouchListeners?: boolean;
  /** Calls `setPointerCapture(pointerId)` on pointer down (used on Canvas). */
  readonly capturePointer?: boolean;
  readonly pinchDrillInRatio?: number;
  readonly getTouchScrollLockPx: () => number;
  readonly getClickTolerancePx: () => number;
  readonly isMarqueeEnabled: () => boolean;
  readonly isDestroyed?: () => boolean;
  readonly canStartFreeCameraPan?: (localX: number, localY: number) => boolean;
  readonly hideTooltip: () => void;
  readonly onMarqueeChange: (
    rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    } | null,
  ) => void;
  readonly onMarqueeCommit: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    altKey: boolean,
  ) => void;
  readonly onPinchDrillIn: (midX: number, midY: number) => boolean;
  readonly onDrillUp: () => boolean;
  readonly onAfterCameraTransform?: () => void;
  readonly onAfterLeftClick?: () => void;
  readonly onScheduleFrame: () => void;
  readonly onPointerDownPre?: () => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly onKeyDown: (ev: SimplexDomKeyboardEventLike) => void;
}

export interface SimplexInteractiveViewportHandle {
  syncTouchAction(): void;
  cancelMarquee(): void;
  destroy(): void;
}

/**
 * Shared pointer, multi-touch pinch, touch scroll-lock, marquee rubberband,
 * wheel zoom, hover cursor, click suppression, and keyboard event binder for
 * SVG and Canvas viewports.
 */
export function bindSimplexInteractiveViewport<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  options: BindSimplexInteractiveViewportOptions<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): SimplexInteractiveViewportHandle {
  const { surfaceEl, engine } = options;
  const pinchInRatio = options.pinchDrillInRatio ?? 1.28;

  const activePointers = new Map<number, { x: number; y: number }>();
  const wheelPinchState: SimplexWheelPinchState = { accum: 0, cooldownUntil: 0 };

  let isDraggingPan = false;
  let panStarted = false;
  let dragLastClientX = 0;
  let dragLastClientY = 0;
  let pointerOriginClientX = 0;
  let pointerOriginClientY = 0;
  let pointerMaxDisplacement = 0;
  let hasActiveGestureOrigin = false;
  let wasMultiTouchGesture = false;
  let touchScrollAxis: 'undecided' | 'vertical' | 'horizontal' | 'pinch' = 'undecided';
  let touchOriginClientX = 0;
  let touchOriginClientY = 0;
  let touchYieldedToScroll = false;

  let suppressNextClick = false;
  let suppressClickStartPos: { x: number; y: number } | null = null;
  let suppressClickEndPos: { x: number; y: number } | null = null;
  let suppressClickDeadline = 0;

  let lastPinchDist: number | null = null;
  let pinchStartDist: number | null = null;
  let pinchHandledInGesture = false;
  let lastPinchMid: { x: number; y: number } | null = null;

  let marqueeArmed = false;
  let isMarqueeSelecting = false;
  let marqueeStartX = 0;
  let marqueeStartY = 0;
  let marqueeCurrentX = 0;
  let marqueeCurrentY = 0;

  const toLocal = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = surfaceEl.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const resetTouchPinchState = (): void => {
    lastPinchDist = null;
    pinchStartDist = null;
    pinchHandledInGesture = false;
    lastPinchMid = null;
  };

  const cancelMarquee = (): void => {
    marqueeArmed = false;
    isMarqueeSelecting = false;
    options.onMarqueeChange(null);
  };

  const syncTouchAction = (): void => {
    surfaceEl.style.touchAction =
      options.getTouchScrollLockPx() > 0 ? 'pan-y' : 'none';
  };

  const idleCursor = (): string =>
    engine.getZoomStrategy().mode === 'drill-down' ? 'default' : 'grab';

  const onTouchStart = (e: SimplexDomTouchEventLike): void => {
    if (e.touches.length >= 2) {
      touchScrollAxis = 'pinch';
      wasMultiTouchGesture = true;
      isDraggingPan = false;
      panStarted = false;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0]!;
      touchOriginClientX = t.clientX;
      touchOriginClientY = t.clientY;
      touchScrollAxis = 'undecided';
      touchYieldedToScroll = false;
    }
  };

  const onTouchMove = (e: SimplexDomTouchEventLike): void => {
    if (e.touches.length >= 2) {
      touchScrollAxis = 'pinch';
      wasMultiTouchGesture = true;
      e.preventDefault();
      return;
    }
    const lockPx = options.getTouchScrollLockPx();
    if (e.touches.length !== 1 || lockPx <= 0) {
      return;
    }
    const t = e.touches[0]!;
    if (touchScrollAxis === 'undecided') {
      const absDx = Math.abs(t.clientX - touchOriginClientX);
      const absDy = Math.abs(t.clientY - touchOriginClientY);
      if (absDx >= lockPx || absDy >= lockPx) {
        if (absDy > absDx) {
          touchScrollAxis = 'vertical';
          touchYieldedToScroll = true;
          isDraggingPan = false;
          panStarted = false;
        } else {
          touchScrollAxis = 'horizontal';
        }
      }
    }
    if (touchScrollAxis === 'horizontal') {
      e.preventDefault();
    }
  };

  const onTouchEnd = (e: SimplexDomTouchEventLike): void => {
    if (e.touches.length === 0) {
      touchScrollAxis = 'undecided';
    }
  };

  const onTouchCancel = (e: SimplexDomTouchEventLike): void => {
    if (e.touches.length === 0) {
      touchScrollAxis = 'undecided';
      touchYieldedToScroll = false;
    }
  };

  const onPointerDown = (e: SimplexDomPointerEventLike): void => {
    options.onPointerDownPre?.();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { x, y } = toLocal(e.clientX, e.clientY);
    activePointers.set(e.pointerId, { x, y });

    if (options.capturePointer && typeof surfaceEl.setPointerCapture === 'function') {
      try {
        surfaceEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer events in tests
      }
    }

    if (activePointers.size === 1) {
      pointerOriginClientX = e.clientX;
      pointerOriginClientY = e.clientY;
      pointerMaxDisplacement = 0;
      hasActiveGestureOrigin = true;
      wasMultiTouchGesture = false;
      panStarted = false;
      suppressNextClick = false;
      suppressClickStartPos = null;
      suppressClickEndPos = null;
      cancelMarquee();
      if (e.pointerType === 'touch') {
        touchOriginClientX = e.clientX;
        touchOriginClientY = e.clientY;
        touchScrollAxis = 'undecided';
        touchYieldedToScroll = false;
      }
    }

    if (activePointers.size >= 2) {
      cancelMarquee();
      isDraggingPan = false;
      panStarted = false;
      wasMultiTouchGesture = true;
      touchScrollAxis = 'pinch';
      const pts = [...activePointers.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      lastPinchDist = dist;
      pinchStartDist = dist;
      pinchHandledInGesture = false;
      lastPinchMid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
      options.hideTooltip();
      return;
    }

    if (
      activePointers.size === 1 &&
      e.pointerType !== 'touch' &&
      e.shiftKey &&
      options.isMarqueeEnabled()
    ) {
      marqueeArmed = true;
      isMarqueeSelecting = false;
      marqueeStartX = x;
      marqueeStartY = y;
      marqueeCurrentX = x;
      marqueeCurrentY = y;
      isDraggingPan = false;
      return;
    }

    if (engine.getZoomStrategy().mode === 'drill-down') {
      isDraggingPan = false;
      return;
    }

    const allowPan = options.canStartFreeCameraPan
      ? options.canStartFreeCameraPan(x, y)
      : true;
    if (allowPan) {
      isDraggingPan = true;
      dragLastClientX = e.clientX;
      dragLastClientY = e.clientY;
      if (options.canStartFreeCameraPan && engine.hitTest(x, y).kind === 'background') {
        surfaceEl.style.cursor = 'grabbing';
      }
    } else {
      isDraggingPan = false;
    }
  };

  const onPointerMove = (e: SimplexDomPointerEventLike): void => {
    const { x, y } = toLocal(e.clientX, e.clientY);
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x, y });
    }

    if (hasActiveGestureOrigin && activePointers.has(e.pointerId)) {
      const disp = Math.hypot(
        e.clientX - pointerOriginClientX,
        e.clientY - pointerOriginClientY,
      );
      if (disp > pointerMaxDisplacement) {
        pointerMaxDisplacement = disp;
      }
    }

    const zoomMode = engine.getZoomStrategy().mode;

    if (activePointers.size >= 2) {
      const pts = [...activePointers.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const mid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };

      if (zoomMode === 'drill-down') {
        if (
          !pinchHandledInGesture &&
          pinchStartDist !== null &&
          pinchStartDist > 8 &&
          dist > 4
        ) {
          const ratio = dist / pinchStartDist;
          if (ratio >= pinchInRatio) {
            pinchHandledInGesture = true;
            options.onPinchDrillIn(mid.x, mid.y);
          } else if (ratio <= 0.78) {
            pinchHandledInGesture = true;
            options.onDrillUp();
          }
        }
        wasMultiTouchGesture = true;
        lastPinchDist = dist;
        lastPinchMid = mid;
        options.hideTooltip();
        return;
      }

      if (
        lastPinchDist !== null &&
        lastPinchMid !== null &&
        lastPinchDist > 4 &&
        dist > 4
      ) {
        const dx = mid.x - lastPinchMid.x;
        const dy = mid.y - lastPinchMid.y;
        const zoomFactor = dist / lastPinchDist;
        engine.camera.panBy(dx, dy);
        engine.camera.zoomToCursor(mid.x, mid.y, zoomFactor);
        wasMultiTouchGesture = true;
        options.hideTooltip();
        options.onAfterCameraTransform?.();
      }
      lastPinchDist = dist;
      lastPinchMid = mid;
      return;
    }

    const lockPx = options.getTouchScrollLockPx();
    if (
      e.pointerType === 'touch' &&
      activePointers.size === 1 &&
      lockPx > 0 &&
      touchScrollAxis === 'undecided'
    ) {
      const absDx = Math.abs(e.clientX - pointerOriginClientX);
      const absDy = Math.abs(e.clientY - pointerOriginClientY);
      if (absDx >= lockPx || absDy >= lockPx) {
        if (absDy > absDx) {
          touchScrollAxis = 'vertical';
          touchYieldedToScroll = true;
          isDraggingPan = false;
          panStarted = false;
        } else {
          touchScrollAxis = 'horizontal';
        }
      }
    }

    if (marqueeArmed && activePointers.has(e.pointerId)) {
      marqueeCurrentX = x;
      marqueeCurrentY = y;
      if (
        !isMarqueeSelecting &&
        Math.hypot(x - marqueeStartX, y - marqueeStartY) > 4
      ) {
        isMarqueeSelecting = true;
        options.hideTooltip();
        surfaceEl.style.cursor = 'crosshair';
      }
      if (isMarqueeSelecting) {
        options.onMarqueeChange(
          normalizeSimplexMarqueeRect(marqueeStartX, marqueeStartY, x, y),
        );
        return;
      }
    }

    if (isDraggingPan && zoomMode === 'free-camera') {
      if (
        e.pointerType === 'touch' &&
        lockPx > 0 &&
        touchScrollAxis !== 'horizontal'
      ) {
        return;
      }
      const dx = e.clientX - dragLastClientX;
      const dy = e.clientY - dragLastClientY;
      const panThreshold =
        e.pointerType === 'touch' ? (lockPx > 0 ? 0 : 6) : 3;
      if (!panStarted && Math.hypot(dx, dy) > panThreshold) {
        panStarted = true;
      }
      if (panStarted) {
        surfaceEl.style.cursor = 'grabbing';
        dragLastClientX = e.clientX;
        dragLastClientY = e.clientY;
        engine.camera.panBy(dx, dy);
        options.hideTooltip();
        options.onAfterCameraTransform?.();
      }
      return;
    }

    if (e.pointerType === 'touch') {
      return;
    }

    engine.handlePointerMove(x, y);
    surfaceEl.style.cursor = resolveSimplexCursorForPoint(engine, x, y);
    options.onScheduleFrame();
  };

  const resetGestureState = (): void => {
    isDraggingPan = false;
    panStarted = false;
    hasActiveGestureOrigin = false;
    wasMultiTouchGesture = false;
    touchYieldedToScroll = false;
    touchScrollAxis = 'undecided';
  };

  const onPointerUp = (e: SimplexDomPointerEventLike): void => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      resetTouchPinchState();
    }
    if (activePointers.size === 0) {
      const completedMarquee = isMarqueeSelecting;
      const { x, y } = toLocal(e.clientX, e.clientY);
      if (completedMarquee) {
        options.onMarqueeCommit(
          marqueeStartX,
          marqueeStartY,
          marqueeCurrentX,
          marqueeCurrentY,
          e.altKey,
        );
        surfaceEl.style.cursor =
          e.pointerType !== 'touch'
            ? resolveSimplexCursorForPoint(engine, x, y)
            : idleCursor();
      }
      cancelMarquee();

      const clickTol = options.getClickTolerancePx();
      const shouldSuppress =
        completedMarquee ||
        pointerMaxDisplacement > clickTol ||
        touchYieldedToScroll ||
        wasMultiTouchGesture;

      if (options.clickDispatch === 'pointerup') {
        if (
          !shouldSuppress &&
          (e.pointerType !== 'mouse' || e.button === 0 || e.button === undefined)
        ) {
          engine.handleLeftClick(
            toSimplexNormalizedPointerEvent(
              {
                button: e.button,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                metaKey: e.metaKey,
              },
              x,
              y,
              (sx, sy) => engine.camera.screenToWorld(sx, sy),
            ),
          );
          if (e.pointerType !== 'touch') {
            surfaceEl.style.cursor = resolveSimplexCursorForPoint(engine, x, y);
          }
          options.onAfterLeftClick?.();
          options.onScheduleFrame();
        } else if (e.pointerType !== 'touch' && !completedMarquee) {
          surfaceEl.style.cursor = resolveSimplexCursorForPoint(engine, x, y);
        }
      } else {
        if (shouldSuppress) {
          suppressNextClick = true;
          suppressClickStartPos = wasMultiTouchGesture
            ? null
            : { x: pointerOriginClientX, y: pointerOriginClientY };
          suppressClickEndPos = { x: e.clientX, y: e.clientY };
          suppressClickDeadline = nowMs() + 400;
        } else {
          suppressNextClick = false;
          suppressClickStartPos = null;
          suppressClickEndPos = null;
        }
        if (isDraggingPan) {
          surfaceEl.style.cursor = idleCursor();
        }
      }

      resetGestureState();
    }
  };

  const onPointerCancel = (e: SimplexDomPointerEventLike): void => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      resetTouchPinchState();
    }
    if (activePointers.size === 0) {
      cancelMarquee();
      resetGestureState();
      suppressNextClick = false;
      suppressClickStartPos = null;
      suppressClickEndPos = null;
      surfaceEl.style.cursor = idleCursor();
    }
  };

  const onPointerLeave = (e: SimplexDomPointerEventLike): void => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      resetTouchPinchState();
    }
    if (activePointers.size === 0) {
      cancelMarquee();
      isDraggingPan = false;
      panStarted = false;
    }
    options.hideTooltip();
    engine.handlePointerLeave();
    if (options.clickDispatch === 'pointerup') {
      surfaceEl.style.cursor = idleCursor();
    }
    options.onScheduleFrame();
  };

  const onClick = (e: SimplexDomMouseEventLike): void => {
    if (suppressNextClick) {
      suppressNextClick = false;
      const matchTol = Math.max(24, options.getClickTolerancePx() * 2);
      const matchesEnd =
        suppressClickEndPos !== null &&
        Math.hypot(
          e.clientX - suppressClickEndPos.x,
          e.clientY - suppressClickEndPos.y,
        ) <= matchTol;
      const matchesStart =
        suppressClickStartPos !== null &&
        Math.hypot(
          e.clientX - suppressClickStartPos.x,
          e.clientY - suppressClickStartPos.y,
        ) <= matchTol;
      suppressClickStartPos = null;
      suppressClickEndPos = null;
      if (nowMs() <= suppressClickDeadline && (matchesEnd || matchesStart)) {
        return;
      }
    }
    const { x, y } = toLocal(e.clientX, e.clientY);
    engine.handleLeftClick(
      toSimplexNormalizedPointerEvent(e, x, y, (sx, sy) =>
        engine.camera.screenToWorld(sx, sy),
      ),
    );
    options.onAfterLeftClick?.();
    options.onScheduleFrame();
  };

  const onContextMenu = (e: SimplexDomMouseEventLike): void => {
    const { x, y } = toLocal(e.clientX, e.clientY);
    const suppress = engine.handleRightClick(
      toSimplexNormalizedPointerEvent(e, x, y, (sx, sy) =>
        engine.camera.screenToWorld(sx, sy),
      ),
    );
    if (suppress) {
      e.preventDefault();
    }
    options.onScheduleFrame();
  };

  const onWheel = (e: SimplexDomWheelEventLike): void => {
    const { x, y } = toLocal(e.clientX, e.clientY);
    if (engine.getZoomStrategy().mode === 'drill-down' && e.ctrlKey) {
      e.preventDefault();
      const action = stepSimplexDrillDownWheelPinch(wheelPinchState, e.deltaY);
      if (action === 'drill-in') {
        options.onPinchDrillIn(x, y);
      } else if (action === 'drill-up') {
        options.onDrillUp();
      }
      return;
    }
    const handled = engine.handleWheel({
      screenX: x,
      screenY: y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
    });
    if (handled) {
      e.preventDefault();
      options.onScheduleFrame();
    }
  };

  const onKeyDown = (e: SimplexDomKeyboardEventLike): void => {
    if (options.isDestroyed?.()) return;
    if (e.key === 'Escape' && (isMarqueeSelecting || marqueeArmed)) {
      e.preventDefault();
      cancelMarquee();
      surfaceEl.style.cursor = idleCursor();
      return;
    }
    options.onKeyDown(e);
  };

  const asListener = <TEvent>(
    fn: (event: TEvent) => void,
  ): ((event: unknown) => void) => fn as (event: unknown) => void;

  const hTouchStart = asListener(onTouchStart);
  const hTouchMove = asListener(onTouchMove);
  const hTouchEnd = asListener(onTouchEnd);
  const hTouchCancel = asListener(onTouchCancel);
  const hPointerDown = asListener(onPointerDown);
  const hPointerMove = asListener(onPointerMove);
  const hPointerUp = asListener(onPointerUp);
  const hPointerCancel = asListener(onPointerCancel);
  const hPointerLeave = asListener(onPointerLeave);
  const hClick = asListener(onClick);
  const hContextMenu = asListener(onContextMenu);
  const hWheel = asListener(onWheel);
  const hKeyDown = asListener(onKeyDown);
  const hFocus = options.onFocus ? asListener<unknown>(options.onFocus) : null;
  const hBlur = options.onBlur ? asListener<unknown>(options.onBlur) : null;

  syncTouchAction();

  if (options.bindTouchListeners) {
    surfaceEl.addEventListener('touchstart', hTouchStart, { passive: true });
    surfaceEl.addEventListener('touchmove', hTouchMove, { passive: false });
    surfaceEl.addEventListener('touchend', hTouchEnd, { passive: true });
    surfaceEl.addEventListener('touchcancel', hTouchCancel, { passive: true });
  }
  surfaceEl.addEventListener('pointerdown', hPointerDown);
  surfaceEl.addEventListener('pointermove', hPointerMove);
  surfaceEl.addEventListener('pointerup', hPointerUp);
  surfaceEl.addEventListener('pointercancel', hPointerCancel);
  surfaceEl.addEventListener('pointerleave', hPointerLeave);
  if (options.clickDispatch === 'click-event') {
    surfaceEl.addEventListener('click', hClick);
  }
  surfaceEl.addEventListener('contextmenu', hContextMenu);
  surfaceEl.addEventListener('wheel', hWheel, { passive: false });
  if (hFocus) surfaceEl.addEventListener('focus', hFocus);
  if (hBlur) surfaceEl.addEventListener('blur', hBlur);
  surfaceEl.addEventListener('keydown', hKeyDown);

  return {
    syncTouchAction,
    cancelMarquee,
    destroy() {
      cancelMarquee();
      activePointers.clear();
      if (options.bindTouchListeners) {
        surfaceEl.removeEventListener('touchstart', hTouchStart);
        surfaceEl.removeEventListener('touchmove', hTouchMove);
        surfaceEl.removeEventListener('touchend', hTouchEnd);
        surfaceEl.removeEventListener('touchcancel', hTouchCancel);
      }
      surfaceEl.removeEventListener('pointerdown', hPointerDown);
      surfaceEl.removeEventListener('pointermove', hPointerMove);
      surfaceEl.removeEventListener('pointerup', hPointerUp);
      surfaceEl.removeEventListener('pointercancel', hPointerCancel);
      surfaceEl.removeEventListener('pointerleave', hPointerLeave);
      if (options.clickDispatch === 'click-event') {
        surfaceEl.removeEventListener('click', hClick);
      }
      surfaceEl.removeEventListener('contextmenu', hContextMenu);
      surfaceEl.removeEventListener('wheel', hWheel);
      if (hFocus) surfaceEl.removeEventListener('focus', hFocus);
      if (hBlur) surfaceEl.removeEventListener('blur', hBlur);
      surfaceEl.removeEventListener('keydown', hKeyDown);
    },
  };
}


