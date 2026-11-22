import {
  computeConvexMtv,
  getHullBoundingBox,
  scaleConvexGeometry,
} from '../geometry.js';
import type { LayoutSolverOptions, SimplexMesh } from '../types.js';
import {
  buildItemCoveringTriangles,
  clampNodeInsideViewport,
  measureLayoutOverlaps,
} from './geometry.js';
import { createSpaceFillingPbdRelaxer } from './relaxers.js';
import {
  createCollisionLocalScaleController,
  createDensityPriorScaleController,
  createUniformScaleController,
} from './scales.js';
import { createMeshInwardFanSeeder } from './seeders.js';
import type {
  ComposedLayoutParams,
  LayoutClusterInput,
  LayoutItemInput,
  PlacedNode,
  ScaleControlContext,
  TwoPhaseLayoutResult,
} from './types.js';

function solveClusterPhase(params: {
  readonly scaledClusters: readonly LayoutClusterInput[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
  readonly clusterGapPx: number;
}): { readonly clusterScale: number; readonly placedClusters: PlacedNode[] } {
  const { scaledClusters, viewportWidth, viewportHeight, viewportMargin, clusterGapPx } =
    params;

  const tryClusterScale = (alpha: number): { ok: boolean; placed: PlacedNode[] } => {
    const placed: PlacedNode[] = scaledClusters.map((c) => {
      const clamped = clampNodeInsideViewport(
        c.targetX,
        c.targetY,
        c.hull,
        alpha,
        viewportWidth,
        viewportHeight,
        viewportMargin,
      );
      return {
        id: c.id,
        x: clamped.x,
        y: clamped.y,
        scale: alpha,
        hull: c.hull,
      };
    });

    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]!;
      const box = getHullBoundingBox(a.hull, a.x, a.y, a.scale);
      if (
        box.width > viewportWidth - 2 * viewportMargin + 0.5 ||
        box.height > viewportHeight - 2 * viewportMargin + 0.5
      ) {
        return { ok: false, placed };
      }
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]!;
        const mtv = computeConvexMtv(
          a.hull,
          a.x,
          a.y,
          a.scale,
          b.hull,
          b.x,
          b.y,
          b.scale,
          clusterGapPx,
        );
        if (mtv && mtv.depth > 1e-4) {
          return { ok: false, placed };
        }
      }
    }
    return { ok: true, placed };
  };

  let clusterScale = 1.0;
  let placedClusters: PlacedNode[];
  const fullClusterTest = tryClusterScale(1.0);
  if (fullClusterTest.ok) {
    placedClusters = fullClusterTest.placed;
  } else {
    let lo = 0.08;
    let hi = 1.0;
    let bestAlpha = lo;
    let bestPlaced = tryClusterScale(lo).placed;
    for (let step = 0; step < 10; step++) {
      const mid = (lo + hi) / 2;
      const attempt = tryClusterScale(mid);
      if (attempt.ok) {
        bestAlpha = mid;
        bestPlaced = attempt.placed;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    clusterScale = bestAlpha;
    placedClusters = bestPlaced;
  }

  return { clusterScale, placedClusters };
}

/**
 * Executes the two-phase cluster + content layout pipeline by composing any orthogonal
 * `LayoutSeeder` × `PositionRelaxer` × `ScaleController` trio in a geometric feedback loop.
 */
export function solveComposedLayout(params: ComposedLayoutParams): TwoPhaseLayoutResult {
  const {
    clusters,
    items,
    mesh,
    viewportWidth,
    viewportHeight,
    viewportMargin = 8,
    options = {},
    previousItemPositions,
    seeder = createMeshInwardFanSeeder({ warmStart: true }),
    relaxer = createSpaceFillingPbdRelaxer(),
    scaleController = createCollisionLocalScaleController(),
    defaultRelaxationIterations = 44,
  } = params;

  const clusterGapPx = options.clusterGapPx ?? 14;
  const itemGapPx = options.itemGapPx ?? 5;
  const minContentScale = options.minContentScale ?? 0.16;
  const relaxationIterations = options.relaxationIterations ?? defaultRelaxationIterations;
  const sizeMultiplier = Math.max(0.25, options.sizeMultiplier ?? 1.0);

  const scaledClusters = clusters.map((c) => ({
    ...c,
    hull: scaleConvexGeometry(c.hull, sizeMultiplier),
  }));
  const scaledItems = items.map((it) => ({
    ...it,
    hull: scaleConvexGeometry(it.hull, sizeMultiplier),
  }));

  const { clusterScale, placedClusters } = solveClusterPhase({
    scaledClusters,
    viewportWidth,
    viewportHeight,
    viewportMargin,
    clusterGapPx,
  });

  if (scaledItems.length === 0) {
    const check = measureLayoutOverlaps(
      placedClusters,
      [],
      viewportWidth,
      viewportHeight,
      viewportMargin,
    );
    return {
      clusters: placedClusters.map((c, idx) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        scale: clusterScale * sizeMultiplier,
        hull: clusters[idx]!.hull,
      })),
      items: [],
      clusterScale,
      contentScale: 1.0,
      overlapCount: check.overlapCount,
      maxPenetrationPx: check.maxPenetrationPx,
    };
  }

  const placedClusterBoxes = placedClusters.map((c) =>
    getHullBoundingBox(c.hull, c.x, c.y, c.scale),
  );
  const itemCoveringTriangles = buildItemCoveringTriangles(scaledItems, mesh);

  const initialStarts = seeder.seed({
    scaledItems,
    placedClusters,
    mesh,
    itemCoveringTriangles,
    previousItemPositions,
    viewportWidth,
    viewportHeight,
    viewportMargin,
  });

  const evaluate: ScaleControlContext['evaluate'] = (itemScales, evalOpts) =>
    relaxer.relax({
      scaledItems,
      initialStarts: evalOpts?.starts ?? initialStarts,
      itemScales,
      placedClusters,
      placedClusterBoxes,
      itemCoveringTriangles,
      mesh,
      viewportWidth,
      viewportHeight,
      viewportMargin,
      itemGapPx,
      relaxationIterations: evalOpts?.iterations ?? relaxationIterations,
      isRefinementPass: evalOpts?.isRefinementPass,
    });

  const solvedScale = scaleController.solveScales({
    scaledItems,
    initialStarts,
    placedClusters,
    placedClusterBoxes,
    itemCoveringTriangles,
    mesh,
    viewportWidth,
    viewportHeight,
    viewportMargin,
    itemGapPx,
    minContentScale,
    relaxationIterations,
    evaluate,
  });

  const finalClusters: PlacedNode[] = placedClusters.map((c, idx) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    scale: clusterScale * sizeMultiplier,
    hull: clusters[idx]!.hull,
  }));

  let scaleSum = 0;
  const finalItems: PlacedNode[] = scaledItems.map((it, idx) => {
    const s = solvedScale.scales[idx]!;
    scaleSum += s;
    return {
      id: it.id,
      x: solvedScale.relaxation.positions[idx]!.x,
      y: solvedScale.relaxation.positions[idx]!.y,
      scale: s * sizeMultiplier,
      hull: items[idx]!.hull,
    };
  });
  const contentScale = scaleSum / Math.max(1, finalItems.length);

  const finalCheck = measureLayoutOverlaps(
    finalClusters,
    finalItems,
    viewportWidth,
    viewportHeight,
    viewportMargin,
  );

  return {
    clusters: finalClusters,
    items: finalItems,
    clusterScale,
    contentScale,
    overlapCount: finalCheck.overlapCount,
    maxPenetrationPx: finalCheck.maxPenetrationPx,
  };
}

/**
 * Uniform-scale two-phase overlap-free layout preset:
 * Mesh-Inward-Fan seeding + Space-Filling PBD relaxation + Global Uniform Scale search.
 */
export function solveTwoPhaseLayout(params: {
  readonly clusters: readonly LayoutClusterInput[];
  readonly items: readonly LayoutItemInput[];
  readonly mesh?: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin?: number;
  readonly options?: LayoutSolverOptions;
  readonly previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}): TwoPhaseLayoutResult {
  return solveComposedLayout({
    ...params,
    seeder: createMeshInwardFanSeeder({ warmStart: Boolean(params.previousItemPositions) }),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.72,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createUniformScaleController(),
    defaultRelaxationIterations: 42,
  });
}

/**
 * Local density-prior adaptive layout preset:
 * Mesh-Inward-Fan seeding + Space-Filling PBD relaxation + Post-Dispersion Density-Prior Scale controller.
 */
export function solveLocalAdaptiveLayout(params: {
  readonly clusters: readonly LayoutClusterInput[];
  readonly items: readonly LayoutItemInput[];
  readonly mesh?: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin?: number;
  readonly options?: LayoutSolverOptions;
  readonly crowdRadiusPx?: number;
  readonly minLocalScale?: number;
  readonly previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}): TwoPhaseLayoutResult {
  return solveComposedLayout({
    ...params,
    seeder: createMeshInwardFanSeeder({ warmStart: Boolean(params.previousItemPositions) }),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.7,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createDensityPriorScaleController({
      crowdRadiusPx: params.crowdRadiusPx,
      minLocalScale: params.minLocalScale,
    }),
    defaultRelaxationIterations: 44,
  });
}

/**
 * Collision-driven adaptive layout preset:
 * Mesh-Inward-Fan seeding + Space-Filling PBD relaxation + Collision-Local Scale controller.
 */
export function solveCollisionDrivenLayout(params: {
  readonly clusters: readonly LayoutClusterInput[];
  readonly items: readonly LayoutItemInput[];
  readonly mesh?: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin?: number;
  readonly options?: LayoutSolverOptions;
  readonly minLocalScale?: number;
  readonly shrinkFactor?: number;
  readonly maxRefinementRounds?: number;
  readonly previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}): TwoPhaseLayoutResult {
  return solveComposedLayout({
    ...params,
    seeder: createMeshInwardFanSeeder({ warmStart: Boolean(params.previousItemPositions) }),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.7,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createCollisionLocalScaleController({
      minLocalScale: params.minLocalScale,
      shrinkFactor: params.shrinkFactor,
      maxRefinementRounds: params.maxRefinementRounds,
    }),
    defaultRelaxationIterations: 46,
  });
}
