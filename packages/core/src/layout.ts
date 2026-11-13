import {
  computeConvexMtv,
  getHullBoundingBox,
  getHullBoundingRadius,
  scaleConvexGeometry,
  UniformSpatialHashGrid,
} from './geometry';
import type { ConvexGeometry, LayoutSolverOptions } from './types';

export interface LayoutClusterInput {
  readonly id: string;
  readonly targetX: number;
  readonly targetY: number;
  readonly hull: ConvexGeometry;
}

export interface LayoutItemInput {
  readonly id: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly hull: ConvexGeometry;
}

export interface PlacedNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly hull: ConvexGeometry;
}

export interface TwoPhaseLayoutResult {
  readonly clusters: readonly PlacedNode[];
  readonly items: readonly PlacedNode[];
  readonly clusterScale: number;
  readonly contentScale: number;
  readonly overlapCount: number;
  readonly maxPenetrationPx: number;
}

function clampNodeInsideViewport(
  x: number,
  y: number,
  hull: ConvexGeometry,
  scale: number,
  viewportW: number,
  viewportH: number,
  margin: number,
): { x: number; y: number } {
  const bbox = getHullBoundingBox(hull, x, y, scale);
  let nx = x;
  let ny = y;
  if (bbox.minX < margin) nx += margin - bbox.minX;
  else if (bbox.maxX > viewportW - margin) nx -= bbox.maxX - (viewportW - margin);
  if (bbox.minY < margin) ny += margin - bbox.minY;
  else if (bbox.maxY > viewportH - margin) ny -= bbox.maxY - (viewportH - margin);

  // Re-clamp in case hull exceeds viewport width/height
  const updated = getHullBoundingBox(hull, nx, ny, scale);
  if (updated.minX < margin) {
    nx = viewportW / 2 - (updated.minX + updated.maxX - 2 * nx) / 2;
  }
  if (updated.minY < margin) {
    ny = viewportHeightCenter(viewportH, updated, ny);
  }
  return { x: nx, y: ny };
}

function viewportHeightCenter(
  viewportH: number,
  bbox: { minY: number; maxY: number },
  y: number,
): number {
  return viewportH / 2 - (bbox.minY + bbox.maxY - 2 * y) / 2;
}

/**
 * Counts exact pair-wise overlaps and measures maximum penetration depth across all
 * clusters and content items (including viewport boundary violations).
 */
export function measureLayoutOverlaps(
  clusters: readonly PlacedNode[],
  items: readonly PlacedNode[],
  viewportW: number,
  viewportH: number,
  viewportMargin = 4,
): { readonly overlapCount: number; readonly maxPenetrationPx: number } {
  let overlapCount = 0;
  let maxPen = 0;

  const checkPair = (a: PlacedNode, b: PlacedNode) => {
    const mtv = computeConvexMtv(a.hull, a.x, a.y, a.scale, b.hull, b.x, b.y, b.scale, 0);
    if (mtv && mtv.depth > 1e-4) {
      overlapCount++;
      if (mtv.depth > maxPen) maxPen = mtv.depth;
    }
  };

  const clusterBoxes = new Array<ReturnType<typeof getHullBoundingBox>>(clusters.length);
  for (let i = 0; i < clusters.length; i++) {
    const ci = clusters[i]!;
    const box = getHullBoundingBox(ci.hull, ci.x, ci.y, ci.scale);
    clusterBoxes[i] = box;
    if (box.minX < viewportMargin - 0.5) {
      maxPen = Math.max(maxPen, viewportMargin - box.minX);
    }
    if (box.maxX > viewportW - viewportMargin + 0.5) {
      maxPen = Math.max(maxPen, box.maxX - (viewportW - viewportMargin));
    }
    if (box.minY < viewportMargin - 0.5) {
      maxPen = Math.max(maxPen, viewportMargin - box.minY);
    }
    if (box.maxY > viewportH - viewportMargin + 0.5) {
      maxPen = Math.max(maxPen, box.maxY - (viewportH - viewportMargin));
    }
    for (let j = i + 1; j < clusters.length; j++) {
      checkPair(ci, clusters[j]!);
    }
  }

  // Broad-phase grid for items
  let maxR = 24;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    maxR = Math.max(maxR, getHullBoundingRadius(c.hull) * c.scale);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    maxR = Math.max(maxR, getHullBoundingRadius(it.hull) * it.scale);
  }
  const grid = new UniformSpatialHashGrid(Math.max(32, maxR * 2));
  const itemBoxes = new Array<ReturnType<typeof getHullBoundingBox>>(items.length);

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const box = getHullBoundingBox(it.hull, it.x, it.y, it.scale);
    itemBoxes[i] = box;
    grid.insert(i, box, 2);
  }

  const queryBuf: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const box = itemBoxes[i]!;
    if (box.minX < viewportMargin - 0.5) {
      overlapCount++;
      maxPen = Math.max(maxPen, viewportMargin - box.minX);
    }
    if (box.maxX > viewportW - viewportMargin + 0.5) {
      overlapCount++;
      maxPen = Math.max(maxPen, box.maxX - (viewportW - viewportMargin));
    }
    if (box.minY < viewportMargin - 0.5) {
      overlapCount++;
      maxPen = Math.max(maxPen, viewportMargin - box.minY);
    }
    if (box.maxY > viewportH - viewportMargin + 0.5) {
      overlapCount++;
      maxPen = Math.max(maxPen, box.maxY - (viewportH - viewportMargin));
    }

    for (let k = 0; k < clusters.length; k++) {
      const cb = clusterBoxes[k]!;
      if (box.maxX <= cb.minX || cb.maxX <= box.minX || box.maxY <= cb.minY || cb.maxY <= box.minY) {
        continue;
      }
      checkPair(it, clusters[k]!);
    }
    const candidates = grid.query(box, 2, queryBuf);
    for (let c = 0; c < candidates.length; c++) {
      const j = candidates[c]!;
      if (j > i) {
        const bj = itemBoxes[j]!;
        if (box.maxX <= bj.minX || bj.maxX <= box.minX || box.maxY <= bj.minY || bj.maxY <= box.minY) {
          continue;
        }
        checkPair(it, items[j]!);
      }
    }
  }

  return { overlapCount, maxPenetrationPx: maxPen };
}

/**
 * Hierarchical two-phase overlap-free convex layout solver:
 *
 * - **Phase 1 (Priority 1 — Clusters):** Computes maximum `\alpha_cluster \in (0, 1]` and gently clamps
 *   edge clusters inside viewport boundaries so all cluster hulls + `clusterGapPx` are strictly disjoint.
 *   Clusters are then locked as immovable convex obstacles.
 * - **Phase 2 (Priority 2 — Content Items):** Binary searches `\alpha_content \in [\alpha_min, 1]`
 *   with damped PBD relaxation (barycentric spring restoring force + hard MTV separation against items,
 *   locked clusters, and viewport edges), followed by a pure hard-separation polishing pass ensuring
 *   `0.0 px` overlap.
 */
export function solveTwoPhaseLayout(params: {
  readonly clusters: readonly LayoutClusterInput[];
  readonly items: readonly LayoutItemInput[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin?: number;
  readonly options?: LayoutSolverOptions;
}): TwoPhaseLayoutResult {
  const {
    clusters,
    items,
    viewportWidth,
    viewportHeight,
    viewportMargin = 8,
    options = {},
  } = params;

  const clusterGapPx = options.clusterGapPx ?? 14;
  const itemGapPx = options.itemGapPx ?? 5;
  const minContentScale = options.minContentScale ?? 0.16;
  const relaxationIterations = options.relaxationIterations ?? 38;
  const sizeMultiplier = Math.max(0.25, options.sizeMultiplier ?? 1.0);

  const scaledClusters = clusters.map((c) => ({
    ...c,
    hull: scaleConvexGeometry(c.hull, sizeMultiplier),
  }));
  const scaledItems = items.map((it) => ({
    ...it,
    hull: scaleConvexGeometry(it.hull, sizeMultiplier),
  }));

  // --- Phase 1: Clusters (Priority 1) ---
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
  let placedClusters: PlacedNode[] = [];
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

  if (scaledItems.length === 0) {
    const check = measureLayoutOverlaps(
      placedClusters,
      [],
      viewportWidth,
      viewportHeight,
      viewportMargin,
    );
    return {
      clusters: placedClusters,
      items: [],
      clusterScale,
      contentScale: 1.0,
      overlapCount: check.overlapCount,
      maxPenetrationPx: check.maxPenetrationPx,
    };
  }

  // Deterministic phyllotaxis jitter for identical barycentric anchor coordinates
  const anchorBuckets = new Map<string, number>();
  const initialStarts = scaledItems.map((it) => {
    const key = `${Math.round(it.anchorX * 2)}:${Math.round(it.anchorY * 2)}`;
    const idx = anchorBuckets.get(key) ?? 0;
    anchorBuckets.set(key, idx + 1);
    if (idx === 0) return { x: it.anchorX, y: it.anchorY };
    const angle = idx * 2.399963229728653;
    const radius = 2.5 * Math.sqrt(idx);
    return {
      x: it.anchorX + Math.cos(angle) * radius,
      y: it.anchorY + Math.sin(angle) * radius,
    };
  });

  const placedClusterBoxes = placedClusters.map((c) =>
    getHullBoundingBox(c.hull, c.x, c.y, c.scale),
  );

  // --- Phase 2: Content Items (Priority 2) ---
  const queryBuf: number[] = [];

  const runContentRelaxation = (
    alpha: number,
  ): {
    readonly overlapCount: number;
    readonly maxPenetration: number;
    readonly positions: { x: number; y: number }[];
  } => {
    const n = scaledItems.length;
    const pos = initialStarts.map((s, idx) => {
      const c = clampNodeInsideViewport(
        s.x,
        s.y,
        scaledItems[idx]!.hull,
        alpha,
        viewportWidth,
        viewportHeight,
        viewportMargin,
      );
      return { x: c.x, y: c.y };
    });

    let maxRadius = 16;
    for (let i = 0; i < n; i++) {
      maxRadius = Math.max(maxRadius, getHullBoundingRadius(scaledItems[i]!.hull) * alpha);
    }
    const cellSize = Math.max(24, maxRadius * 2.2 + itemGapPx);
    const grid = new UniformSpatialHashGrid(cellSize);
    const boxes = new Array<ReturnType<typeof getHullBoundingBox>>(n);

    // PBD relaxation with spring attraction to ideal barycentric anchor
    for (let iter = 0; iter < relaxationIterations; iter++) {
      const springK = 0.18 * (1 - (iter / relaxationIterations) * 0.85);
      for (let i = 0; i < n; i++) {
        const it = scaledItems[i]!;
        const p = pos[i]!;
        p.x += (it.anchorX - p.x) * springK;
        p.y += (it.anchorY - p.y) * springK;
      }

      grid.clear();
      for (let i = 0; i < n; i++) {
        const p = pos[i]!;
        const box = getHullBoundingBox(scaledItems[i]!.hull, p.x, p.y, alpha);
        boxes[i] = box;
        grid.insert(i, box, itemGapPx + 2);
      }

      // Item-item separation
      for (let i = 0; i < n; i++) {
        const pA = pos[i]!;
        const hA = scaledItems[i]!.hull;
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
          const mtv = computeConvexMtv(
            hA,
            pA.x,
            pA.y,
            alpha,
            hB,
            pB.x,
            pB.y,
            alpha,
            itemGapPx,
          );
          if (mtv && mtv.depth > 1e-5) {
            const half = mtv.depth * 0.52;
            pA.x += mtv.nx * half;
            pA.y += mtv.ny * half;
            pB.x -= mtv.nx * half;
            pB.y -= mtv.ny * half;
          }
        }
      }

      // Item-cluster hard obstacle separation + viewport clamping
      for (let i = 0; i < n; i++) {
        const pA = pos[i]!;
        const hA = scaledItems[i]!.hull;
        const boxA = getHullBoundingBox(hA, pA.x, pA.y, alpha);
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
            alpha,
            c.hull,
            c.x,
            c.y,
            c.scale,
            itemGapPx,
          );
          if (mtv && mtv.depth > 1e-5) {
            pA.x += mtv.nx * (mtv.depth + 0.05);
            pA.y += mtv.ny * (mtv.depth + 0.05);
          }
        }
        const clamped = clampNodeInsideViewport(
          pA.x,
          pA.y,
          hA,
          alpha,
          viewportWidth,
          viewportHeight,
          viewportMargin,
        );
        pA.x = clamped.x;
        pA.y = clamped.y;
      }
    }

    // Pure Hard-Separation Polishing Pass (no spring restoring force!)
    for (let polish = 0; polish < 14; polish++) {
      let stepMax = 0;
      grid.clear();
      for (let i = 0; i < n; i++) {
        const p = pos[i]!;
        const box = getHullBoundingBox(scaledItems[i]!.hull, p.x, p.y, alpha);
        boxes[i] = box;
        grid.insert(i, box, itemGapPx + 2);
      }

      for (let i = 0; i < n; i++) {
        const pA = pos[i]!;
        const hA = scaledItems[i]!.hull;
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
          const mtv = computeConvexMtv(
            hA,
            pA.x,
            pA.y,
            alpha,
            hB,
            pB.x,
            pB.y,
            alpha,
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
            alpha,
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

        const clamped = clampNodeInsideViewport(
          pA.x,
          pA.y,
          hA,
          alpha,
          viewportWidth,
          viewportHeight,
          viewportMargin,
        );
        pA.x = clamped.x;
        pA.y = clamped.y;
      }

      if (stepMax <= 0.02) break;
    }

    // Measure actual geometric penetration (without gap) to verify true 0.0px overlap
    const placedNodes: PlacedNode[] = scaledItems.map((it, idx) => ({
      id: it.id,
      x: pos[idx]!.x,
      y: pos[idx]!.y,
      scale: alpha,
      hull: it.hull,
    }));
    const actualCheck = measureLayoutOverlaps(
      placedClusters,
      placedNodes,
      viewportWidth,
      viewportHeight,
      viewportMargin,
    );
    return {
      overlapCount: actualCheck.overlapCount,
      maxPenetration: actualCheck.maxPenetrationPx,
      positions: pos,
    };
  };

  let contentScale = 1.0;
  let chosenResult = runContentRelaxation(1.0);

  if (chosenResult.overlapCount > 0 || chosenResult.maxPenetration > 1e-4) {
    let lo = Math.min(minContentScale, 0.08);
    let hi = 1.0;
    let bestAlpha = lo;
    let bestRes = runContentRelaxation(lo);

    for (let step = 0; step < 7; step++) {
      const mid = (lo + hi) / 2;
      const attempt = runContentRelaxation(mid);
      if (attempt.overlapCount === 0 && attempt.maxPenetration <= 1e-4) {
        bestAlpha = mid;
        bestRes = attempt;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    contentScale = bestAlpha;
    chosenResult = bestRes;
  }

  // Note: returned `scale` already folds in `sizeMultiplier` so renderer draws `hull` at unscaled size * placed.scale,
  // OR we return original unscaled hull + effective scale = alpha * sizeMultiplier.
  // Keeping unscaled `hull` + effective scale `alpha * sizeMultiplier` keeps NodeRenderState.hull unscaled!
  const finalClusters: PlacedNode[] = placedClusters.map((c, idx) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    scale: clusterScale * sizeMultiplier,
    hull: clusters[idx]!.hull,
  }));

  const finalItems: PlacedNode[] = scaledItems.map((it, idx) => ({
    id: it.id,
    x: chosenResult.positions[idx]!.x,
    y: chosenResult.positions[idx]!.y,
    scale: contentScale * sizeMultiplier,
    hull: items[idx]!.hull,
  }));

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
