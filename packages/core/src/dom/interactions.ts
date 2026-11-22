import { isPointInTriangle } from '../geometry.js';
import type {
  CameraController,
  HitTarget,
  InteractionHandlers,
  NormalizedPointerEvent,
  SimplexInteractiveTarget,
  SimplexKeyboardFocusTarget,
  SimplexMesh,
} from '../types.js';
import type { SimplexZoomState, SimplexZoomStrategy } from '../zoom.js';
import { nowMs, type SimplexDomElementLike } from './types.js';

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
  element: Pick<
    SimplexDomElementLike,
    'getBoundingClientRect' | 'clientWidth' | 'clientHeight'
  >,
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
