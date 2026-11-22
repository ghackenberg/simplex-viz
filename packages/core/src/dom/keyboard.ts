import { extractSimplexItemLabel } from '../presetShared.js';
import type {
  ClusterDescriptor,
  SimplexInteractiveTarget,
  SimplexKeyboardFocusTarget,
} from '../types.js';
import type { SimplexZoomState } from '../zoom.js';
import {
  computeSimplexZoomAnnouncementSignature,
  formatSimplexInteractiveTargetAriaLabel,
  formatSimplexZoomLevelAnnouncement,
  type SimplexSrAnnouncerHandle,
} from './a11y.js';
import {
  isSameSimplexKeyboardTarget,
  resolveNextSimplexKeyboardFocusIndex,
  toSimplexKeyboardFocusTargetRef,
} from './interactions.js';
import type { SimplexDomKeyboardEventLike } from './types.js';

// ============================================================================
// Shared Keyboard Navigation & Zoom Accessibility Coordinator (SVG & Canvas)
// ============================================================================

export interface SimplexKeyboardNavigatorOptions<
  TItem = unknown,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  readonly engine: {
    getInteractiveTargets(): readonly SimplexInteractiveTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >[];
    getZoomState(): SimplexZoomState;
    getSelectedIds(): ReadonlySet<string>;
    getFocusedItemId(): string | null;
    getItems(): readonly TItem[];
    getClusterByUid(
      uid: string,
    ): ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined;
    hoverInteractiveTarget(target: SimplexKeyboardFocusTarget | null): void;
    activateInteractiveTarget(
      target: SimplexKeyboardFocusTarget,
      modifiers?: {
        readonly shiftKey?: boolean;
        readonly ctrlKey?: boolean;
        readonly altKey?: boolean;
        readonly metaKey?: boolean;
      },
    ): boolean;
    handlePointerLeave(): void;
  };
  readonly srAnnouncer: Pick<SimplexSrAnnouncerHandle, 'announce'>;
  readonly initialEnabled?: boolean;
  readonly initialZoomState?: SimplexZoomState;
  readonly getLabel?: (item: TItem) => string;
  readonly formatTagLabel?: (tag: string) => string;
  readonly getItemId: (item: TItem) => string;
  readonly getFocusedClusterUid: () => string | null;
  readonly getFocusedTriangleIndex: () => number | null;
  readonly onFocusTargetChange: (
    target: SimplexKeyboardFocusTarget | null,
    resolvedTarget: SimplexInteractiveTarget<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    > | null,
  ) => void;
  readonly onHideTooltip: () => void;
  readonly onRequestRender: (immediate: boolean) => void;
  readonly onDrillUp: () => boolean;
  readonly onClearFocusedCluster: () => void;
  readonly onClearFocusedTriangle: () => void;
  readonly onClearFocusedItem: () => void;
  readonly onClearSelection: () => void;
  readonly isSurfaceActiveElement?: () => boolean;
  readonly isDestroyed?: () => boolean;
}

export interface SimplexKeyboardNavigator {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  getFocusTarget(): SimplexKeyboardFocusTarget | null;
  clearFocus(options?: { readonly preserveHover?: boolean }): void;
  onPointerDownPre(): void;
  handleFocus(): void;
  handleBlur(): void;
  handleKeyDown(ev: SimplexDomKeyboardEventLike): void;
  handleZoomStateChange(state: SimplexZoomState): void;
  syncZoomAnnouncementSignature(state: SimplexZoomState): void;
}

/**
 * Shared WCAG 2.1 AA keyboard navigation & screen-reader live announcement
 * state machine used by both `@simplex-viz/svg` and `@simplex-viz/canvas`.
 */
export function createSimplexKeyboardNavigator<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  options: SimplexKeyboardNavigatorOptions<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): SimplexKeyboardNavigator {
  let enabled = options.initialEnabled ?? true;
  let focusTarget: SimplexKeyboardFocusTarget | null = null;
  let lastInteractionWasPointer = false;
  let lastAnnouncedZoomSig: string | null = options.initialZoomState
    ? computeSimplexZoomAnnouncementSignature(options.initialZoomState)
    : null;

  const announce = (msg: string): void => {
    if (options.isDestroyed?.() || !msg) return;
    options.srAnnouncer.announce(msg);
  };

  const applyFocusTarget = (
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
  ): void => {
    const ref = toSimplexKeyboardFocusTargetRef(target);
    focusTarget = ref;
    options.onFocusTargetChange(ref, target);
    options.engine.hoverInteractiveTarget(ref);
    options.onRequestRender(true);
    if (shouldAnnounce) {
      const label = formatSimplexInteractiveTargetAriaLabel(
        target,
        options.engine.getZoomState(),
        {
          getLabel: options.getLabel,
          formatTagLabel: options.formatTagLabel,
        },
      );
      announce(`${label} (${index + 1} of ${total})`);
    }
  };

  const clearFocus = (opts?: { readonly preserveHover?: boolean }): void => {
    const hadFocus = focusTarget !== null;
    focusTarget = null;
    options.onFocusTargetChange(null, null);
    if (hadFocus) {
      if (!opts?.preserveHover) {
        options.onHideTooltip();
        options.engine.hoverInteractiveTarget(null);
      }
      options.onRequestRender(true);
    }
  };

  const moveFocusToIndex = (index: number, shouldAnnounce: boolean): boolean => {
    const targets = options.engine.getInteractiveTargets();
    if (targets.length === 0) {
      clearFocus();
      return false;
    }
    const resolvedIdx =
      index < 0
        ? targets.length - 1
        : Math.max(0, Math.min(targets.length - 1, index));
    applyFocusTarget(targets[resolvedIdx]!, resolvedIdx, targets.length, shouldAnnounce);
    return true;
  };

  const stepFocus = (
    key: 'ArrowRight' | 'ArrowDown' | 'ArrowLeft' | 'ArrowUp' | 'Home' | 'End',
  ): void => {
    const targets = options.engine.getInteractiveTargets();
    if (targets.length === 0) {
      clearFocus();
      return;
    }
    const currentIdx = targets.findIndex((t) =>
      isSameSimplexKeyboardTarget(focusTarget, t),
    );
    const nextIdx = resolveNextSimplexKeyboardFocusIndex(
      targets.length,
      currentIdx,
      key,
    );
    if (nextIdx === null) return;
    applyFocusTarget(targets[nextIdx]!, nextIdx, targets.length, true);
  };

  return {
    isEnabled: () => enabled,
    setEnabled(nextEnabled: boolean): void {
      if (enabled === nextEnabled) return;
      enabled = nextEnabled;
      if (!nextEnabled) {
        clearFocus();
      }
    },
    getFocusTarget: () => focusTarget,
    clearFocus,
    onPointerDownPre(): void {
      lastInteractionWasPointer = true;
      if (focusTarget !== null) {
        clearFocus({ preserveHover: true });
      }
    },
    handleFocus(): void {
      if (!enabled || options.isDestroyed?.()) return;
      if (lastInteractionWasPointer) {
        lastInteractionWasPointer = false;
        return;
      }
      if (focusTarget === null) {
        moveFocusToIndex(0, true);
      }
    },
    handleBlur(): void {
      lastInteractionWasPointer = false;
      clearFocus();
    },
    handleKeyDown(ev: SimplexDomKeyboardEventLike): void {
      if (!enabled || options.isDestroyed?.()) return;
      lastInteractionWasPointer = false;

      if (
        ev.key === 'ArrowRight' ||
        ev.key === 'ArrowDown' ||
        ev.key === 'ArrowLeft' ||
        ev.key === 'ArrowUp' ||
        ev.key === 'Home' ||
        ev.key === 'End'
      ) {
        ev.preventDefault();
        stepFocus(ev.key);
        return;
      }

      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (!focusTarget) {
          moveFocusToIndex(0, true);
          return;
        }
        const prevZoomSig = lastAnnouncedZoomSig;
        const prevFocusedCluster = options.getFocusedClusterUid();
        const prevFocusedTri = options.getFocusedTriangleIndex();
        const prevSelected = options.engine.getSelectedIds();
        const target = focusTarget;
        options.engine.activateInteractiveTarget(target, {
          shiftKey: ev.shiftKey,
          ctrlKey: ev.ctrlKey,
          altKey: ev.altKey,
          metaKey: ev.metaKey,
        });
        options.onRequestRender(true);
        const nextSelected = options.engine.getSelectedIds();
        if (target.kind === 'item' && nextSelected.size !== prevSelected.size) {
          const nowSelected = nextSelected.has(target.id);
          const item = options.engine
            .getItems()
            .find((it) => options.getItemId(it).trim() === target.id);
          const label = item
            ? extractSimplexItemLabel(item, target.id, options.getLabel)
            : target.id;
          announce(
            `${nowSelected ? 'Selected' : 'Deselected'} ${label} (${nextSelected.size} selected)`,
          );
        } else if (lastAnnouncedZoomSig === prevZoomSig) {
          const nextCluster = options.getFocusedClusterUid();
          const nextTri = options.getFocusedTriangleIndex();
          if (nextCluster !== prevFocusedCluster) {
            if (nextCluster !== null) {
              const cluster = options.engine.getClusterByUid(nextCluster);
              announce(
                `Focused cluster: ${cluster?.subclusterLabel || cluster?.defaultLabel || nextCluster}`,
              );
            } else {
              announce('Cleared cluster focus');
            }
          } else if (nextTri !== prevFocusedTri) {
            if (nextTri !== null) {
              announce(`Focused region ${nextTri + 1}`);
            } else {
              announce('Cleared region focus');
            }
          }
        }
        return;
      }

      if (ev.key === 'Escape') {
        if (options.engine.getZoomState().canDrillUp) {
          ev.preventDefault();
          options.onDrillUp();
          return;
        }
        const focusedCluster = options.getFocusedClusterUid();
        const focusedTri = options.getFocusedTriangleIndex();
        const focusedItem = options.engine.getFocusedItemId();
        if (
          focusedCluster !== null ||
          focusedTri !== null ||
          focusedItem !== null
        ) {
          ev.preventDefault();
          if (focusedCluster !== null) options.onClearFocusedCluster();
          if (focusedTri !== null) options.onClearFocusedTriangle();
          if (focusedItem !== null) options.onClearFocusedItem();
          announce('Cleared focus');
          return;
        }
        if (options.engine.getSelectedIds().size > 0) {
          ev.preventDefault();
          options.onClearSelection();
          announce('Cleared selection');
          return;
        }
        if (focusTarget !== null) {
          ev.preventDefault();
          clearFocus();
        }
      }
    },
    syncZoomAnnouncementSignature(state: SimplexZoomState): void {
      lastAnnouncedZoomSig = computeSimplexZoomAnnouncementSignature(state);
    },
    handleZoomStateChange(state: SimplexZoomState): void {
      const sig = computeSimplexZoomAnnouncementSignature(state);
      if (lastAnnouncedZoomSig === null) {
        lastAnnouncedZoomSig = sig;
        return;
      }
      if (sig === lastAnnouncedZoomSig) return;
      lastAnnouncedZoomSig = sig;

      const targets = options.engine.getInteractiveTargets();
      if (focusTarget !== null) {
        const stillValidIdx = targets.findIndex((t) =>
          isSameSimplexKeyboardTarget(focusTarget, t),
        );
        if (stillValidIdx === -1) {
          if (targets.length > 0 && options.isSurfaceActiveElement?.()) {
            applyFocusTarget(targets[0]!, 0, targets.length, false);
          } else {
            clearFocus();
          }
        }
      }

      announce(formatSimplexZoomLevelAnnouncement(state, targets));
    },
  };
}
