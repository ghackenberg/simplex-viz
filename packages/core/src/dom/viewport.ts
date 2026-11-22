import type {
  CameraController,
  NormalizedPointerEvent,
  NormalizedWheelEvent,
} from '../types.js';
import {
  normalizeSimplexMarqueeRect,
  resolveSimplexCursorForPoint,
  stepSimplexDrillDownWheelPinch,
  toSimplexNormalizedPointerEvent,
  type SimplexInteractiveEngineSlice,
  type SimplexWheelPinchState,
} from './interactions.js';
import {
  nowMs,
  type SimplexDomInteractiveSurfaceLike,
  type SimplexDomKeyboardEventLike,
  type SimplexDomMouseEventLike,
  type SimplexDomPointerEventLike,
  type SimplexDomTouchEventLike,
  type SimplexDomWheelEventLike,
} from './types.js';

// ============================================================================
// Shared Interactive Viewport Event Binder (SVG & Canvas)
// ============================================================================

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
