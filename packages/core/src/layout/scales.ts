import { getHullBoundingRadius } from '../geometry.js';
import type {
  PositionRelaxationOutput,
  ScaleControlContext,
  ScaleController,
} from './types.js';

/**
 * Shared local-then-global binary-search safety fallback used when adaptive local
 * shrinking hits the floor scale in dense pockets without reaching 0 overlaps.
 */
function runEmergencyScaleFallback(
  ctx: ScaleControlContext,
  scales: number[],
  currentResult: PositionRelaxationOutput,
  colliding: ReadonlySet<number>,
): PositionRelaxationOutput {
  const n = ctx.scaledItems.length;
  const stuckSet = new Set<number>(colliding);
  for (let i = 0; i < n; i++) {
    if (scales[i]! < 0.999) stuckSet.add(i);
  }
  if (stuckSet.size === 0) {
    for (let i = 0; i < n; i++) stuckSet.add(i);
  }

  const fallbackStarts = currentResult.positions;
  const fallbackIters = Math.max(ctx.relaxationIterations, 56);
  const buildTrialScales = (factor: number, globalFallback: boolean) =>
    scales.map((s, idx) => (globalFallback || stuckSet.has(idx) ? s * factor : s));

  const tryFallbackMode = (globalFallback: boolean) => {
    let lo = Math.min(ctx.minContentScale, 0.08);
    let hi = 1.0;
    let bestFactor = lo;
    let bestRes = ctx.evaluate(buildTrialScales(lo, globalFallback), {
      starts: fallbackStarts,
      iterations: fallbackIters,
      isRefinementPass: true,
    });

    if (bestRes.overlapCount > 0 || bestRes.maxPenetration > 1e-4) {
      return { ok: false as const, bestFactor, bestRes };
    }

    for (let step = 0; step < 6; step++) {
      const mid = (lo + hi) / 2;
      const attempt = ctx.evaluate(buildTrialScales(mid, globalFallback), {
        starts: fallbackStarts,
        iterations: fallbackIters,
        isRefinementPass: true,
      });
      if (attempt.overlapCount === 0 && attempt.maxPenetration <= 1e-4) {
        bestFactor = mid;
        bestRes = attempt;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return { ok: true as const, bestFactor, bestRes };
  };

  const localAttempt = tryFallbackMode(false);
  if (localAttempt.ok) {
    const nextScales = buildTrialScales(localAttempt.bestFactor, false);
    for (let i = 0; i < n; i++) scales[i] = nextScales[i]!;
    return localAttempt.bestRes;
  }

  const globalAttempt = tryFallbackMode(true);
  const nextScales = buildTrialScales(globalAttempt.bestFactor, true);
  for (let i = 0; i < n; i++) scales[i] = nextScales[i]!;
  return globalAttempt.bestRes;
}

export interface UniformScaleControllerOptions {
  /** Number of binary-search steps when `1.0` scale overflows. Default: `7`. */
  readonly binarySearchSteps?: number;
}

/**
 * Global uniform scale controller: preserves exact relative size ratios across all content
 * nodes by binary-searching a single global factor `\alpha \in [\alpha_min, 1.0]`.
 */
export function createUniformScaleController(
  options?: UniformScaleControllerOptions,
): ScaleController {
  const binarySearchSteps = options?.binarySearchSteps ?? 7;
  return {
    name: 'uniform-scale',
    solveScales(ctx) {
      const n = ctx.scaledItems.length;
      const makeUniform = (alpha: number) => new Array<number>(n).fill(alpha);

      const fullAttempt = ctx.evaluate(makeUniform(1.0));
      if (fullAttempt.overlapCount === 0 && fullAttempt.maxPenetration <= 1e-4) {
        return { scales: makeUniform(1.0), relaxation: fullAttempt };
      }

      let lo = Math.min(ctx.minContentScale, 0.08);
      let hi = 1.0;
      let bestAlpha = lo;
      let bestRes = ctx.evaluate(makeUniform(lo));

      for (let step = 0; step < binarySearchSteps; step++) {
        const mid = (lo + hi) / 2;
        const attempt = ctx.evaluate(makeUniform(mid));
        if (attempt.overlapCount === 0 && attempt.maxPenetration <= 1e-4) {
          bestAlpha = mid;
          bestRes = attempt;
          lo = mid;
        } else {
          hi = mid;
        }
      }

      return { scales: makeUniform(bestAlpha), relaxation: bestRes };
    },
  };
}

export interface CollisionLocalScaleControllerOptions {
  /** Minimum scale permitted during local per-pocket shrinking. Default: `0.32`. */
  readonly minLocalScale?: number;
  /** Multiplicative shrink step applied only to colliding items per round. Default: `0.85`. */
  readonly shrinkFactor?: number;
  /** Maximum local refinement rounds before safety binary-search fallback. Default: `9`. */
  readonly maxRefinementRounds?: number;
}

/**
 * Collision-driven local scale controller: keeps all non-colliding items at `1.0` scale and
 * selectively shrinks **only** items involved in geometric collisions until `0.0 px` overlap
 * is reached, compatible with any `PositionRelaxer` and `LayoutSeeder`.
 */
export function createCollisionLocalScaleController(
  options?: CollisionLocalScaleControllerOptions,
): ScaleController {
  const minLocalScale = options?.minLocalScale ?? 0.32;
  const shrinkFactor = options?.shrinkFactor ?? 0.85;
  const maxRefinementRounds = options?.maxRefinementRounds ?? 9;

  return {
    name: 'collision-local-scale',
    solveScales(ctx) {
      const n = ctx.scaledItems.length;
      const scales = new Array<number>(n).fill(1.0);
      let currentResult = ctx.evaluate(scales);
      let colliding = new Set<number>(currentResult.collidingIndices);

      let round = 0;
      const refineIters = Math.max(24, Math.round(ctx.relaxationIterations * 0.65));

      while (colliding.size > 0 && round < maxRefinementRounds) {
        round += 1;
        let changed = false;
        for (const idx of colliding) {
          const next = Math.max(minLocalScale, scales[idx]! * shrinkFactor);
          if (next < scales[idx]! - 1e-5) {
            scales[idx] = next;
            changed = true;
          }
        }
        if (!changed) break;

        currentResult = ctx.evaluate(scales, {
          starts: currentResult.positions,
          iterations: refineIters,
          isRefinementPass: true,
        });
        colliding = new Set<number>(currentResult.collidingIndices);
      }

      // Emergency local-only refinement: if a very dense pocket reached `minLocalScale`
      // and still has residual overlaps, relax the floor strictly on the colliding items
      // from their unpacked positions so isolated sparse items remain untouched at `1.0`.
      const emergencyFloor = Math.min(ctx.minContentScale, 0.06);
      let emergencyRound = 0;
      const emergencyIters = Math.max(ctx.relaxationIterations, 48);
      while (
        (colliding.size > 0 || currentResult.overlapCount > 0) &&
        emergencyRound < 10
      ) {
        emergencyRound += 1;
        let changed = false;
        for (const idx of colliding) {
          const next = Math.max(emergencyFloor, scales[idx]! * 0.78);
          if (next < scales[idx]! - 1e-5) {
            scales[idx] = next;
            changed = true;
          }
        }
        if (!changed) break;

        currentResult = ctx.evaluate(scales, {
          starts: currentResult.positions,
          iterations: emergencyIters,
          isRefinementPass: true,
        });
        colliding = new Set<number>(currentResult.collidingIndices);
      }

      if (colliding.size > 0 || currentResult.overlapCount > 0) {
        currentResult = runEmergencyScaleFallback(ctx, scales, currentResult, colliding);
      }

      return { scales, relaxation: currentResult };
    },
  };
}

export interface DensityPriorScaleControllerOptions {
  /** Post-dispersion neighborhood crowding radius in px. Default: `76`. */
  readonly crowdRadiusPx?: number;
  /** Target minimum prior scale in crowded neighborhoods before local collision polish. Default: `0.35`. */
  readonly minLocalScale?: number;
}

/**
 * Neighborhood density-prior scale controller: first disperses items across open covering-triangle
 * space at `1.0x`, evaluates a smooth radial crowd kernel on the dispersed coordinates (accounting
 * for nearby items and cluster plaques), and resolves any residual overlaps locally with smooth
 * halo blending so sparse neighborhoods stay at `1.0x` without global shrink collateral.
 */
export function createDensityPriorScaleController(
  options?: DensityPriorScaleControllerOptions,
): ScaleController {
  const crowdRadiusPx = options?.crowdRadiusPx ?? 76;
  const minLocalScale = options?.minLocalScale ?? 0.35;

  return {
    name: 'density-prior-scale',
    solveScales(ctx) {
      const { scaledItems, placedClusters, itemGapPx } = ctx;
      const n = scaledItems.length;
      if (n === 0) {
        return { scales: [], relaxation: ctx.evaluate([]) };
      }

      // Stage 1: Space-filling dispersion pass at 1.0x so co-located anchors fan out into
      // open covering-triangle interiors before estimating neighborhood crowd pressure.
      const ones = new Array<number>(n).fill(1.0);
      const spreadAttempt = ctx.evaluate(ones);
      const spreadPositions = spreadAttempt.positions;

      // Stage 2: Smooth radial crowd kernel evaluated on post-dispersion coordinates.
      const itemRadii = scaledItems.map((it) => Math.max(4, getHullBoundingRadius(it.hull)));
      const clusterRadii = placedClusters.map(
        (c) => Math.max(4, getHullBoundingRadius(c.hull) * c.scale) + itemGapPx * 0.5,
      );
      const rSq = crowdRadiusPx * crowdRadiusPx;
      const availableArea = Math.PI * crowdRadiusPx * crowdRadiusPx * 0.36;

      let anyKernelShrunk = false;
      const scales = scaledItems.map((_, i) => {
        const pA = spreadPositions[i]!;
        let demandArea = Math.PI * itemRadii[i]! * itemRadii[i]!;

        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const pB = spreadPositions[j]!;
          const dx = pA.x - pB.x;
          const dy = pA.y - pB.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= rSq) {
            const weight = 1 - Math.sqrt(d2) / crowdRadiusPx;
            const rad = itemRadii[j]! + itemGapPx * 0.5;
            demandArea += Math.PI * rad * rad * (0.35 + 0.65 * weight);
          }
        }

        for (let cIdx = 0; cIdx < placedClusters.length; cIdx++) {
          const c = placedClusters[cIdx]!;
          const dx = pA.x - c.x;
          const dy = pA.y - c.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= rSq) {
            const weight = 1 - Math.sqrt(d2) / crowdRadiusPx;
            const cRad = clusterRadii[cIdx]!;
            demandArea += Math.PI * cRad * cRad * (0.28 + 0.52 * weight);
          }
        }

        if (demandArea <= availableArea) return 1.0;
        const ratio = Math.sqrt(availableArea / demandArea);
        const s = Math.max(minLocalScale, Math.min(1.0, ratio));
        if (s < 1.0 - 1e-5) anyKernelShrunk = true;
        return s;
      });

      if (
        !anyKernelShrunk &&
        spreadAttempt.overlapCount === 0 &&
        spreadAttempt.maxPenetration <= 1e-4
      ) {
        return { scales: ones, relaxation: spreadAttempt };
      }

      let currentResult = anyKernelShrunk
        ? ctx.evaluate(scales, { starts: spreadPositions })
        : spreadAttempt;
      if (currentResult.overlapCount === 0 && currentResult.maxPenetration <= 1e-4) {
        return { scales, relaxation: currentResult };
      }

      // Stage 3: Smooth local collision polish with gentle neighborhood halo blending
      // (replaces destructive global binary search so sparse regions remain at 1.0x).
      let colliding = new Set<number>(currentResult.collidingIndices);
      const refineIters = Math.max(26, Math.round(ctx.relaxationIterations * 0.7));
      const haloRadius = crowdRadiusPx * 0.65;
      const haloRadiusSq = haloRadius * haloRadius;

      const applySmoothLocalShrink = (
        floorScale: number,
        directFactor: number,
        haloStrength: number,
      ): boolean => {
        let changed = false;
        const curPos = currentResult.positions;
        const collidingList = Array.from(colliding);

        for (const idx of collidingList) {
          const next = Math.max(floorScale, scales[idx]! * directFactor);
          if (next < scales[idx]! - 1e-5) {
            scales[idx] = next;
            changed = true;
          }
        }

        if (haloStrength > 0 && collidingList.length > 0) {
          for (let j = 0; j < n; j++) {
            if (colliding.has(j)) continue;
            const pJ = curPos[j]!;
            let maxWeight = 0;
            for (let k = 0; k < collidingList.length; k++) {
              const pC = curPos[collidingList[k]!]!;
              const dx = pJ.x - pC.x;
              const dy = pJ.y - pC.y;
              const d2 = dx * dx + dy * dy;
              if (d2 <= haloRadiusSq) {
                const w = 1 - Math.sqrt(d2) / haloRadius;
                if (w > maxWeight) maxWeight = w;
              }
            }
            if (maxWeight > 0) {
              const haloFloor = Math.max(floorScale, minLocalScale);
              const next = Math.max(haloFloor, scales[j]! * (1 - haloStrength * maxWeight));
              if (next < scales[j]! - 1e-5) {
                scales[j] = next;
                changed = true;
              }
            }
          }
        }

        return changed;
      };

      let round = 0;
      while (colliding.size > 0 && round < 10) {
        round += 1;
        if (!applySmoothLocalShrink(minLocalScale, 0.84, 0.08)) break;
        currentResult = ctx.evaluate(scales, {
          starts: currentResult.positions,
          iterations: refineIters,
          isRefinementPass: true,
        });
        colliding = new Set<number>(currentResult.collidingIndices);
      }

      const emergencyFloor = Math.min(ctx.minContentScale, 0.06);
      const emergencyIters = Math.max(ctx.relaxationIterations, 48);
      let emergencyRound = 0;
      while (
        (colliding.size > 0 || currentResult.overlapCount > 0) &&
        emergencyRound < 10
      ) {
        emergencyRound += 1;
        if (!applySmoothLocalShrink(emergencyFloor, 0.78, 0)) break;
        currentResult = ctx.evaluate(scales, {
          starts: currentResult.positions,
          iterations: emergencyIters,
          isRefinementPass: true,
        });
        colliding = new Set<number>(currentResult.collidingIndices);
      }

      // Local-first safety binary search: scales only affected pockets first; touches
      // global items only if an extreme degenerate scene still overlaps at the local floor.
      if (colliding.size > 0 || currentResult.overlapCount > 0) {
        currentResult = runEmergencyScaleFallback(ctx, scales, currentResult, colliding);
      }

      return { scales, relaxation: currentResult };
    },
  };
}

export interface FixedScaleControllerOptions {
  /** Constant scale factor applied to all content items without auto-shrinking. Default: `1.0`. */
  readonly scale?: number;
}

/**
 * Fixed-scale controller: disables automatic node shrinking so all items keep their exact
 * requested `scale` (`1.0` by default) while the `PositionRelaxer` resolves collisions
 * purely through spatial movement. Useful for zoom-first workflows.
 */
export function createFixedScaleController(
  options?: FixedScaleControllerOptions,
): ScaleController {
  const fixedScale = Math.max(0.05, options?.scale ?? 1.0);
  return {
    name: 'fixed-scale',
    solveScales(ctx) {
      const scales = new Array<number>(ctx.scaledItems.length).fill(fixedScale);
      const relaxation = ctx.evaluate(scales);
      return { scales, relaxation };
    },
  };
}
