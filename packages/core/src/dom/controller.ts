import type {
  SimplexTimelineController,
  SimplexTimelineState,
} from '../timeline.js';
import type {
  InteractionHandlers,
  RestoreViewStateOptions,
  SimplexLegendEntry,
  SimplexLegendModel,
  SimplexViewState,
} from '../types.js';
import {
  dispatchSimplexDefaultLeftClick,
  isSimplexHoverEventConsumed,
} from './interactions.js';
import type { SimplexTooltipOverlay } from './tooltip.js';
import type { SimplexDomDivLike } from './types.js';

// ============================================================================
// Shared Controller Legend, Interaction, ViewState & FPS Helpers
// ============================================================================

export function computeSimplexLegendSignature<TItem, TTagMeta, TClusterMeta>(
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

export function syncSimplexLegendTimelineStep<TItem, TTagMeta, TClusterMeta>(
  base: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  timelineController: Pick<SimplexTimelineController<TItem>, 'getState'> | null | undefined,
): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> {
  const timelineStep = timelineController ? timelineController.getState().step : null;
  return timelineStep === base.timelineStep ? base : { ...base, timelineStep };
}

export interface CreateSimplexLegendChangeEmitterOptions<
  TItem,
  TTagMeta,
  TClusterMeta,
> {
  readonly initialCallback?: (
    model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ) => void;
  readonly isDestroyed: () => boolean;
  readonly getEngineLegendModel: () =>
    | SimplexLegendModel<TItem, TTagMeta, TClusterMeta>
    | undefined;
  readonly getTimelineController: () =>
    | Pick<SimplexTimelineController<TItem>, 'getState'>
    | null
    | undefined;
}

export interface SimplexLegendChangeEmitter<TItem, TTagMeta, TClusterMeta> {
  emit(
    engineModel?: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
  ): void;
  setCallback(
    cb?: (model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>) => void,
  ): void;
}

export function createSimplexLegendChangeEmitter<
  TItem,
  TTagMeta,
  TClusterMeta,
>(
  options: CreateSimplexLegendChangeEmitterOptions<
    TItem,
    TTagMeta,
    TClusterMeta
  >,
): SimplexLegendChangeEmitter<TItem, TTagMeta, TClusterMeta> {
  let callback = options.initialCallback;
  let lastSig: string | null = null;

  return {
    emit(engineModel) {
      if (options.isDestroyed() || !callback) return;
      const base = engineModel ?? options.getEngineLegendModel();
      if (!base) return;
      const model = syncSimplexLegendTimelineStep(
        base,
        options.getTimelineController(),
      );
      const sig = computeSimplexLegendSignature(model);
      if (sig === lastSig) return;
      lastSig = sig;
      callback(model);
    },
    setCallback(cb) {
      callback = cb;
      lastSig = null;
    },
  };
}

export interface WrapSimplexControllerInteractionsOptions<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike = SimplexDomDivLike,
> {
  readonly getUserInteractions: () =>
    | InteractionHandlers<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >
    | undefined;
  readonly tooltipOverlay: Pick<
    SimplexTooltipOverlay<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta,
      TElement
    >,
    'showForTarget' | 'hide'
  >;
  readonly getLeftClickContext: () => Omit<
    Parameters<
      typeof dispatchSimplexDefaultLeftClick<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >
    >[2],
    'userInteractions'
  >;
}

/**
 * Wraps user `InteractionHandlers` with shared tooltip management, default
 * drill-down / free-camera click dispatch, right-click passthrough, and wheel fallback.
 */
export function wrapSimplexControllerInteractions<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
  TElement extends SimplexDomDivLike = SimplexDomDivLike,
>(
  options: WrapSimplexControllerInteractionsOptions<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta,
    TElement
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
      const consumed = isSimplexHoverEventConsumed(
        options.getUserInteractions()?.onContentHover,
        ev,
      );
      if (ev && !consumed) {
        options.tooltipOverlay.showForTarget({ kind: 'content', ...ev });
      } else {
        options.tooltipOverlay.hide();
      }
      return consumed;
    },
    onClusterHover: (ev) => {
      const consumed = isSimplexHoverEventConsumed(
        options.getUserInteractions()?.onClusterHover,
        ev,
      );
      if (ev && !consumed) {
        options.tooltipOverlay.showForTarget({ kind: 'cluster', ...ev });
      } else {
        options.tooltipOverlay.hide();
      }
      return consumed;
    },
    onTriangleHover: (ev) => {
      const consumed = isSimplexHoverEventConsumed(
        options.getUserInteractions()?.onTriangleHover,
        ev,
      );
      if (ev && !consumed) {
        options.tooltipOverlay.showForTarget({ kind: 'triangle', ...ev });
      } else {
        options.tooltipOverlay.hide();
      }
      return consumed;
    },
    onLeftClick: (target, rawEvent) =>
      dispatchSimplexDefaultLeftClick(target, rawEvent, {
        userInteractions: options.getUserInteractions(),
        ...options.getLeftClickContext(),
      }),
    onRightClick: (target, rawEvent) =>
      options.getUserInteractions()?.onRightClick?.(target, rawEvent),
    onWheel: options.getUserInteractions()?.onWheel ?? 'zoom-to-cursor',
  };
}

export function restoreSimplexControllerViewState<TItem>(
  state: Partial<SimplexViewState> | null | undefined,
  options: RestoreViewStateOptions | undefined,
  context: {
    readonly isDestroyed: () => boolean;
    readonly getTimelineController: () => SimplexTimelineController<TItem> | null;
    readonly syncTimelineOverlay: (state: SimplexTimelineState<TItem> | null) => void;
    readonly restoreEngineViewState: (
      state: Partial<SimplexViewState>,
      options?: RestoreViewStateOptions,
    ) => boolean;
    readonly syncAfterRestore: () => void;
  },
): boolean {
  if (context.isDestroyed() || !state || typeof state !== 'object') return false;
  if (state.version !== undefined && state.version !== 1) return false;

  const timelineCtrl = context.getTimelineController();
  if (
    timelineCtrl &&
    typeof state.timelineStep === 'number' &&
    Number.isFinite(state.timelineStep)
  ) {
    timelineCtrl.pause();
    timelineCtrl.seek(Math.round(state.timelineStep));
    context.syncTimelineOverlay(timelineCtrl.getState());
  }

  const ok = context.restoreEngineViewState(state, options);
  if (!ok) return false;

  context.syncAfterRestore();
  return true;
}

export interface SimplexFpsTracker {
  recordFrame(dtMs: number): void;
  reset(): void;
}

export function createSimplexFpsTracker(
  onFpsUpdate?: (fps: number) => void,
  sampleWindowMs = 320,
): SimplexFpsTracker {
  let samples = 0;
  let accumMs = 0;
  return {
    recordFrame(dtMs: number): void {
      if (!onFpsUpdate || dtMs <= 0) return;
      samples += 1;
      accumMs += dtMs;
      if (accumMs >= sampleWindowMs) {
        const fps = Math.round((samples * 1000) / accumMs);
        onFpsUpdate(fps);
        samples = 0;
        accumMs = 0;
      }
    },
    reset(): void {
      samples = 0;
      accumMs = 0;
    },
  };
}
