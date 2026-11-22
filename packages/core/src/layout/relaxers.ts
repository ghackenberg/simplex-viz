import {
  computeConvexMtv,
  getHullBoundingBox,
  getHullBoundingRadius,
  UniformSpatialHashGrid,
} from '../geometry.js';
import type { BoundingBox2D, Point2D } from '../types.js';
import {
  clampNodeInsideViewport,
  clampPointToTriangles,
  findCollidingItemIndices,
  measureLayoutOverlaps,
} from './geometry.js';
import type {
  LayoutItemInput,
  PlacedNode,
  PositionRelaxationOutput,
  PositionRelaxer,
  TrianglePoints,
} from './types.js';

function runPerItemPbdRelaxation(params: {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly initialStarts: readonly { readonly x: number; readonly y: number }[];
  readonly placedClusters: readonly PlacedNode[];
  readonly placedClusterBoxes: readonly BoundingBox2D[];
  readonly itemScales: readonly number[];
  readonly itemCoveringTriangles?: readonly (readonly TrianglePoints[] | null)[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
  readonly itemGapPx: number;
  readonly relaxationIterations: number;
  readonly springFactor?: number;
  readonly springZeroTailRatio?: number;
  readonly dispersionGapPx?: number;
  readonly dispersionStrength?: number;
}): PositionRelaxationOutput {
  const {
    scaledItems,
    initialStarts,
    placedClusters,
    placedClusterBoxes,
    itemScales,
    itemCoveringTriangles,
    viewportWidth,
    viewportHeight,
    viewportMargin,
    itemGapPx,
    relaxationIterations,
    springFactor = 1.0,
    springZeroTailRatio = 0.0,
    dispersionGapPx = 0.0,
    dispersionStrength = 0.0,
  } = params;

  const n = scaledItems.length;
  const pos: { x: number; y: number }[] = initialStarts.map((s, idx) => {
    const c = clampNodeInsideViewport(
      s.x,
      s.y,
      scaledItems[idx]!.hull,
      itemScales[idx]!,
      viewportWidth,
      viewportHeight,
      viewportMargin,
    );
    const triGroup = itemCoveringTriangles?.[idx];
    if (triGroup) {
      const clamped = clampPointToTriangles(c.x, c.y, triGroup);
      return { x: clamped.x, y: clamped.y };
    }
    return { x: c.x, y: c.y };
  });

  let maxRadius = 16;
  for (let i = 0; i < n; i++) {
    maxRadius = Math.max(
      maxRadius,
      getHullBoundingRadius(scaledItems[i]!.hull) * itemScales[i]!,
    );
  }
  const hasDispersion = dispersionGapPx > 1e-3 && dispersionStrength > 1e-3;
  const maxExtraGap = hasDispersion ? dispersionGapPx : 0;
  const cellSize = Math.max(24, maxRadius * 2.2 + itemGapPx + maxExtraGap);
  const grid = new UniformSpatialHashGrid(cellSize);
  const boxes = new Array<BoundingBox2D>(n);
  const queryBuf: number[] = [];

  const activeSpringIters = Math.max(
    1,
    Math.round(relaxationIterations * (1 - Math.max(0, Math.min(0.8, springZeroTailRatio)))),
  );
  const dispersionEndIter = hasDispersion
    ? Math.max(1, Math.round(relaxationIterations * 0.58))
    : 0;

  // Resolve effective spring targets: single-cluster items pull symmetrically toward
  // their placed host cluster center so 360° halos stay centered even on clamped edge clusters.
  const springTargets: Point2D[] = scaledItems.map((it, idx) => {
    if (!itemCoveringTriangles?.[idx] && it.unitVertexIndices?.length === 1) {
      const host = placedClusters[it.unitVertexIndices[0]!];
      if (host) return { x: host.x, y: host.y };
    }
    return { x: it.anchorX, y: it.anchorY };
  });

  for (let iter = 0; iter < relaxationIterations; iter++) {
    const springK =
      iter >= activeSpringIters
        ? 0
        : 0.18 * springFactor * (1 - (iter / activeSpringIters) * 0.85);
    if (springK > 0) {
      for (let i = 0; i < n; i++) {
        const target = springTargets[i]!;
        const p = pos[i]!;
        p.x += (target.x - p.x) * springK;
        p.y += (target.y - p.y) * springK;
      }
    }

    const extraComfortGap =
      hasDispersion && iter < dispersionEndIter
        ? dispersionGapPx * (1 - iter / dispersionEndIter)
        : 0;
    const effectiveGap = itemGapPx + extraComfortGap;

    grid.clear();
    for (let i = 0; i < n; i++) {
      const p = pos[i]!;
      const box = getHullBoundingBox(scaledItems[i]!.hull, p.x, p.y, itemScales[i]!);
      boxes[i] = box;
      grid.insert(i, box, effectiveGap + 2);
    }

    for (let i = 0; i < n; i++) {
      const pA = pos[i]!;
      const hA = scaledItems[i]!.hull;
      const sA = itemScales[i]!;
      const boxA = boxes[i]!;
      const candidates = grid.query(boxA, effectiveGap + 2, queryBuf);

      for (let k = 0; k < candidates.length; k++) {
        const j = candidates[k]!;
        if (j <= i) continue;
        const boxB = boxes[j]!;
        if (
          boxA.maxX + effectiveGap <= boxB.minX ||
          boxB.maxX + effectiveGap <= boxA.minX ||
          boxA.maxY + effectiveGap <= boxB.minY ||
          boxB.maxY + effectiveGap <= boxA.minY
        ) {
          continue;
        }
        const pB = pos[j]!;
        const hB = scaledItems[j]!.hull;
        const sB = itemScales[j]!;
        const mtv = computeConvexMtv(
          hA,
          pA.x,
          pA.y,
          sA,
          hB,
          pB.x,
          pB.y,
          sB,
          effectiveGap,
        );
        if (mtv && mtv.depth > 1e-5) {
          let pushHalf: number;
          if (extraComfortGap > 0) {
            const hardDepth = Math.max(0, mtv.depth - extraComfortGap);
            const softDepth = Math.min(mtv.depth, extraComfortGap);
            const softStep = Math.min(2.2, softDepth * 0.14 * dispersionStrength);
            pushHalf = hardDepth * 0.52 + softStep;
          } else {
            pushHalf = mtv.depth * 0.52;
          }
          pA.x += mtv.nx * pushHalf;
          pA.y += mtv.ny * pushHalf;
          pB.x -= mtv.nx * pushHalf;
          pB.y -= mtv.ny * pushHalf;
        }
      }
    }

    const clusterExtraGap = extraComfortGap * 0.3;
    const effectiveClusterGap = itemGapPx + clusterExtraGap;

    for (let i = 0; i < n; i++) {
      const pA = pos[i]!;
      const hA = scaledItems[i]!.hull;
      const sA = itemScales[i]!;
      const boxA = getHullBoundingBox(hA, pA.x, pA.y, sA);
      for (let cIdx = 0; cIdx < placedClusters.length; cIdx++) {
        const cb = placedClusterBoxes[cIdx]!;
        if (
          boxA.maxX + effectiveClusterGap <= cb.minX ||
          cb.maxX + effectiveClusterGap <= boxA.minX ||
          boxA.maxY + effectiveClusterGap <= cb.minY ||
          cb.maxY + effectiveClusterGap <= boxA.minY
        ) {
          continue;
        }
        const c = placedClusters[cIdx]!;
        const mtv = computeConvexMtv(
          hA,
          pA.x,
          pA.y,
          sA,
          c.hull,
          c.x,
          c.y,
          c.scale,
          effectiveClusterGap,
        );
        if (mtv && mtv.depth > 1e-5) {
          if (clusterExtraGap > 0) {
            const hardDepth = Math.max(0, mtv.depth - clusterExtraGap);
            const softDepth = Math.min(mtv.depth, clusterExtraGap);
            const push =
              (hardDepth > 0 ? hardDepth + 0.05 : 0) +
              Math.min(1.6, softDepth * 0.15 * dispersionStrength);
            pA.x += mtv.nx * push;
            pA.y += mtv.ny * push;
          } else {
            pA.x += mtv.nx * (mtv.depth + 0.05);
            pA.y += mtv.ny * (mtv.depth + 0.05);
          }
        }
      }
      const preClampX = pA.x;
      const preClampY = pA.y;
      const clamped = clampNodeInsideViewport(
        pA.x,
        pA.y,
        hA,
        sA,
        viewportWidth,
        viewportHeight,
        viewportMargin,
      );
      pA.x = clamped.x;
      pA.y = clamped.y;

      // If clamping pushed the item back against a corner/edge cluster, nudge inward toward viewport center
      if (Math.abs(clamped.x - preClampX) > 0.1 || Math.abs(clamped.y - preClampY) > 0.1) {
        const toCx = viewportWidth * 0.5 - pA.x;
        const toCy = viewportHeight * 0.5 - pA.y;
        const distC = Math.hypot(toCx, toCy) || 1;
        pA.x += (toCx / distC) * 1.5;
        pA.y += (toCy / distC) * 1.5;
      }

      const triGroup = itemCoveringTriangles?.[i];
      if (triGroup) {
        const triClamped = clampPointToTriangles(pA.x, pA.y, triGroup);
        pA.x = triClamped.x;
        pA.y = triClamped.y;
      }
    }
  }

  for (let polish = 0; polish < 28; polish++) {
    let stepMax = 0;
    grid.clear();
    for (let i = 0; i < n; i++) {
      const p = pos[i]!;
      const box = getHullBoundingBox(scaledItems[i]!.hull, p.x, p.y, itemScales[i]!);
      boxes[i] = box;
      grid.insert(i, box, itemGapPx + 2);
    }

    for (let i = 0; i < n; i++) {
      const pA = pos[i]!;
      const hA = scaledItems[i]!.hull;
      const sA = itemScales[i]!;
      const boxA = boxes[i]!;
      const candidates = grid.query(boxA, itemGapPx + 2, queryBuf);
      for (let k = 0; k < candidates.length; k++) {
        const j = candidates[k]!;
        if (j <= i) continue;
        const boxB = boxes[j]!;
        if (
          boxA.maxX + itemGapPx <= boxB.minX ||
          boxB.maxX + itemGapPx <= boxA.minX ||
          boxA.maxY + itemGapPx <= boxB.minY ||
          boxB.maxY + itemGapPx <= boxA.minY
        ) {
          continue;
        }
        const pB = pos[j]!;
        const hB = scaledItems[j]!.hull;
        const sB = itemScales[j]!;
        const mtv = computeConvexMtv(
          hA,
          pA.x,
          pA.y,
          sA,
          hB,
          pB.x,
          pB.y,
          sB,
          itemGapPx,
        );
        if (mtv && mtv.depth > 1e-5) {
          if (mtv.depth > stepMax) stepMax = mtv.depth;
          const half = mtv.depth * 0.51;
          pA.x += mtv.nx * half;
          pA.y += mtv.ny * half;
          pB.x -= mtv.nx * half;
          pB.y -= mtv.ny * half;
        }
      }

      for (let cIdx = 0; cIdx < placedClusters.length; cIdx++) {
        const cb = placedClusterBoxes[cIdx]!;
        if (
          boxA.maxX + itemGapPx <= cb.minX ||
          cb.maxX + itemGapPx <= boxA.minX ||
          boxA.maxY + itemGapPx <= cb.minY ||
          cb.maxY + itemGapPx <= boxA.minY
        ) {
          continue;
        }
        const c = placedClusters[cIdx]!;
        const mtv = computeConvexMtv(
          hA,
          pA.x,
          pA.y,
          sA,
          c.hull,
          c.x,
          c.y,
          c.scale,
          itemGapPx,
        );
        if (mtv && mtv.depth > 1e-5) {
          if (mtv.depth > stepMax) stepMax = mtv.depth;
          pA.x += mtv.nx * (mtv.depth + 0.02);
          pA.y += mtv.ny * (mtv.depth + 0.02);
        }
      }

      const preClampX = pA.x;
      const preClampY = pA.y;
      const clamped = clampNodeInsideViewport(
        pA.x,
        pA.y,
        hA,
        sA,
        viewportWidth,
        viewportHeight,
        viewportMargin,
      );
      pA.x = clamped.x;
      pA.y = clamped.y;

      if (Math.abs(clamped.x - preClampX) > 0.1 || Math.abs(clamped.y - preClampY) > 0.1) {
        const boxAfterClamp = getHullBoundingBox(hA, pA.x, pA.y, sA);
        for (let cIdx = 0; cIdx < placedClusters.length; cIdx++) {
          const cb = placedClusterBoxes[cIdx]!;
          if (
            boxAfterClamp.maxX + itemGapPx <= cb.minX ||
            cb.maxX + itemGapPx <= boxAfterClamp.minX ||
            boxAfterClamp.maxY + itemGapPx <= cb.minY ||
            cb.maxY + itemGapPx <= boxAfterClamp.minY
          ) {
            continue;
          }
          const c = placedClusters[cIdx]!;
          const mtv = computeConvexMtv(
            hA,
            pA.x,
            pA.y,
            sA,
            c.hull,
            c.x,
            c.y,
            c.scale,
            itemGapPx,
          );
          if (mtv && mtv.depth > 1e-4) {
            const vx = viewportWidth * 0.5 - c.x;
            const vy = viewportHeight * 0.5 - c.y;
            const len = Math.hypot(vx, vy) || 1;
            const push = mtv.depth + 0.5;
            const shifted = clampNodeInsideViewport(
              pA.x + (vx / len) * push,
              pA.y + (vy / len) * push,
              hA,
              sA,
              viewportWidth,
              viewportHeight,
              viewportMargin,
            );
            pA.x = shifted.x;
            pA.y = shifted.y;
          }
        }
      }

      const triGroup = itemCoveringTriangles?.[i];
      if (triGroup) {
        const triClamped = clampPointToTriangles(pA.x, pA.y, triGroup);
        const triMove = Math.hypot(triClamped.x - pA.x, triClamped.y - pA.y);
        if (triMove > stepMax) stepMax = triMove;
        pA.x = triClamped.x;
        pA.y = triClamped.y;
      }
    }

    if (stepMax <= 0.02) break;
  }

  const placedNodes: PlacedNode[] = scaledItems.map((it, idx) => ({
    id: it.id,
    x: pos[idx]!.x,
    y: pos[idx]!.y,
    scale: itemScales[idx]!,
    hull: it.hull,
  }));
  const actualCheck = measureLayoutOverlaps(
    placedClusters,
    placedNodes,
    viewportWidth,
    viewportHeight,
    viewportMargin,
  );
  const collidingIndices = findCollidingItemIndices({
    scaledItems,
    positions: pos,
    itemScales,
    itemCoveringTriangles,
    placedClusters,
    placedClusterBoxes,
    viewportWidth,
    viewportHeight,
    viewportMargin,
  });

  return {
    overlapCount: actualCheck.overlapCount,
    maxPenetration: actualCheck.maxPenetrationPx,
    positions: pos,
    collidingIndices,
  };
}

export interface BarycentricPbdRelaxerOptions {
  /** Barycentric anchor spring multiplier. Default: `1.0`. */
  readonly springFactor?: number;
  /** Fraction `[0, 0.8]` of final iterations where spring force drops to zero. Default: `0.0`. */
  readonly springZeroTailRatio?: number;
}

/**
 * Anchor-faithful Position-Based Dynamics relaxer: pulls items tightly toward their
 * exact barycentric coordinates while enforcing SAT convex separation and covering-triangle
 * containment.
 */
export function createBarycentricPbdRelaxer(
  options?: BarycentricPbdRelaxerOptions,
): PositionRelaxer {
  const baseSpring = options?.springFactor ?? 1.0;
  const baseTail = options?.springZeroTailRatio ?? 0.0;
  return {
    name: 'barycentric-pbd',
    relax(input) {
      return runPerItemPbdRelaxation({
        scaledItems: input.scaledItems,
        initialStarts: input.initialStarts,
        placedClusters: input.placedClusters,
        placedClusterBoxes: input.placedClusterBoxes,
        itemScales: input.itemScales,
        itemCoveringTriangles: input.itemCoveringTriangles,
        viewportWidth: input.viewportWidth,
        viewportHeight: input.viewportHeight,
        viewportMargin: input.viewportMargin,
        itemGapPx: input.itemGapPx,
        relaxationIterations: input.relaxationIterations,
        springFactor: input.isRefinementPass ? baseSpring * 0.6 : baseSpring,
        springZeroTailRatio: input.isRefinementPass
          ? Math.max(baseTail, 0.35)
          : baseTail,
      });
    },
  };
}

export interface SpaceFillingPbdRelaxerOptions {
  /** Barycentric anchor spring multiplier. Default: `0.68`. */
  readonly springFactor?: number;
  /** Fraction `[0, 0.8]` of final iterations where spring force drops to zero. Default: `0.38`. */
  readonly springZeroTailRatio?: number;
  /** Temporary personal-space cushion in px encouraging nodes to fill open triangle interiors. Default: `20`. */
  readonly dispersionGapPx?: number;
  /** Strength `[0, 1]` of early-phase interior dispersion push. Default: `0.38`. */
  readonly dispersionStrength?: number;
}

/**
 * Space-filling Position-Based Dynamics relaxer: combines a temporary decaying personal-space
 * dispersion cushion with a zero-spring tail so crowded pockets spread naturally across unused
 * regions of their covering mesh triangles before settling with `0.0 px` hard separation.
 */
export function createSpaceFillingPbdRelaxer(
  options?: SpaceFillingPbdRelaxerOptions,
): PositionRelaxer {
  const baseSpring = options?.springFactor ?? 0.68;
  const baseTail = options?.springZeroTailRatio ?? 0.38;
  const dispersionGapPx = options?.dispersionGapPx ?? 20;
  const dispersionStrength = options?.dispersionStrength ?? 0.38;

  return {
    name: 'space-filling-pbd',
    relax(input) {
      return runPerItemPbdRelaxation({
        scaledItems: input.scaledItems,
        initialStarts: input.initialStarts,
        placedClusters: input.placedClusters,
        placedClusterBoxes: input.placedClusterBoxes,
        itemScales: input.itemScales,
        itemCoveringTriangles: input.itemCoveringTriangles,
        viewportWidth: input.viewportWidth,
        viewportHeight: input.viewportHeight,
        viewportMargin: input.viewportMargin,
        itemGapPx: input.itemGapPx,
        relaxationIterations: input.relaxationIterations,
        springFactor: input.isRefinementPass ? baseSpring * 0.62 : baseSpring,
        springZeroTailRatio: input.isRefinementPass
          ? Math.max(baseTail, 0.45)
          : baseTail,
        dispersionGapPx: input.isRefinementPass ? 0 : dispersionGapPx,
        dispersionStrength: input.isRefinementPass ? 0 : dispersionStrength,
      });
    },
  };
}
