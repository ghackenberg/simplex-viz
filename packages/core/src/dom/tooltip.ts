import { extractSimplexItemLabel } from '../presetShared.js';
import type { SimplexColorTheme } from '../strategies.js';
import type {
  ClusterHoverEvent,
  ContentHoverEvent,
  SimplexHoverTarget,
  TriangleHoverEvent,
} from '../types.js';
import type { SimplexZoomState } from '../zoom.js';
import { ensureSimplexContainerPositioned } from './environment.js';
import {
  getGlobalEnv,
  type SimplexDomContainerOpsLike,
  type SimplexDomDivLike,
  type SimplexDomElementLike,
} from './types.js';

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
// Shared Floating Tooltip DOM Overlay Controller
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
    if (
      typeof currentOption === 'object' &&
      currentOption !== null &&
      !('render' in currentOption)
    ) {
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
