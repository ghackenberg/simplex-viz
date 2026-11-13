import { interpolateConvexGeometry } from './geometry';
import type { ConvexGeometry } from './types';

/**
 * Scalar spring state preserving position and velocity for C1-continuous interruption.
 */
export interface SpringScalar {
  value: number;
  velocity: number;
  target: number;
}

/**
 * Critically damped spring integration step (exact analytical solution for natural frequency `omega`).
 * Preserves velocity seamlessly whenever `target` changes mid-flight.
 */
export function stepCriticallyDampedSpring(
  spring: SpringScalar,
  dtSec: number,
  omega = 14,
): boolean {
  const dt = Math.min(0.05, Math.max(0.0001, dtSec));
  const diff = spring.value - spring.target;
  if (Math.abs(diff) < 1e-4 && Math.abs(spring.velocity) < 1e-4) {
    spring.value = spring.target;
    spring.velocity = 0;
    return true;
  }

  const exp = Math.exp(-omega * dt);
  const temp = (spring.velocity + omega * diff) * dt;
  spring.velocity = (spring.velocity - omega * temp) * exp;
  spring.value = spring.target + (diff + temp) * exp;

  if (
    Math.abs(spring.value - spring.target) < 1e-3 &&
    Math.abs(spring.velocity) < 1e-3
  ) {
    spring.value = spring.target;
    spring.velocity = 0;
    return true;
  }
  return false;
}

/**
 * Interruptible dual-layer visual transition tracker per node.
 * Guarantees at most 2 active layers when re-targeted mid-transition and interpolates
 * convex hulls smoothly across heterogeneous node views.
 */
export interface VisualTransitionState<TVisual> {
  from: TVisual;
  fromHull: ConvexGeometry;
  fromCacheKey: string;
  to: TVisual;
  toHull: ConvexGeometry;
  toCacheKey: string;
  /** Linear normalized elapsed fraction in `[0, 1]`. */
  rawProgress: number;
  /** Eased smoothstep progress in `[0, 1]` exposed to renderers. */
  progress: number;
  durationSec: number;
}

/**
 * Starts or interrupts a node visual transition cleanly from the currently dominant visual.
 */
export function retargetVisualTransition<TVisual>(
  current: VisualTransitionState<TVisual> | null,
  activeVisual: TVisual,
  activeHull: ConvexGeometry,
  activeCacheKey: string,
  nextVisual: TVisual,
  nextHull: ConvexGeometry,
  nextCacheKey: string,
  durationSec = 0.32,
): VisualTransitionState<TVisual> | null {
  if (!current) {
    if (activeCacheKey === nextCacheKey) return null;
    return {
      from: activeVisual,
      fromHull: activeHull,
      fromCacheKey: activeCacheKey,
      to: nextVisual,
      toHull: nextHull,
      toCacheKey: nextCacheKey,
      rawProgress: 0,
      progress: 0,
      durationSec,
    };
  }

  if (current.toCacheKey === nextCacheKey) {
    return current;
  }

  // Interruption mid-crossfade (0 < p < 1): lock currently dominant visual as new `from`
  const dominantIsTo = current.progress >= 0.5;
  const fromVisual = dominantIsTo ? current.to : current.from;
  const fromCacheKey = dominantIsTo ? current.toCacheKey : current.fromCacheKey;
  const blendedHull = interpolateConvexGeometry(
    current.fromHull,
    current.toHull,
    current.progress,
  );

  if (fromCacheKey === nextCacheKey) {
    return null;
  }

  return {
    from: fromVisual,
    fromHull: blendedHull,
    fromCacheKey,
    to: nextVisual,
    toHull: nextHull,
    toCacheKey: nextCacheKey,
    rawProgress: 0,
    progress: 0,
    durationSec,
  };
}

/**
 * Advances a visual transition by `dtSec`. Returns `null` once complete (`rawProgress >= 1`).
 */
export function stepVisualTransition<TVisual>(
  transition: VisualTransitionState<TVisual> | null,
  dtSec: number,
): {
  readonly transition: VisualTransitionState<TVisual> | null;
  readonly activeHull: ConvexGeometry | null;
} {
  if (!transition) return { transition: null, activeHull: null };
  const nextRaw = Math.min(
    1,
    transition.rawProgress + Math.max(0.0001, dtSec) / Math.max(0.05, transition.durationSec),
  );
  if (nextRaw >= 1) {
    return { transition: null, activeHull: transition.toHull };
  }
  const eased = nextRaw * nextRaw * (3 - 2 * nextRaw);
  return {
    transition: {
      ...transition,
      rawProgress: nextRaw,
      progress: eased,
    },
    activeHull: interpolateConvexGeometry(transition.fromHull, transition.toHull, eased),
  };
}
