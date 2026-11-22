import type { ReducedMotionPreference } from '../types.js';
import {
  getGlobalEnv,
  type SimplexDomDocumentLike,
  type SimplexDomElementLike,
  type SimplexDomMediaQueryListLike,
  type SimplexDomWindowLike,
} from './types.js';

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
