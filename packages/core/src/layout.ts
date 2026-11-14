import {
  computeConvexMtv,
  getHullBoundingBox,
  getHullBoundingRadius,
  isPointInTriangle,
  scaleConvexGeometry,
  UniformSpatialHashGrid,
} from './geometry';
import type { ConvexGeometry, LayoutSolverOptions, Point2D, SimplexMesh } from './types';

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
  readonly unitVertexIndices?: readonly number[];
}

type TrianglePoints = readonly [Point2D, Point2D, Point2D];

function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Point2D {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-12) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return { x: ax + t * abx, y: ay + t * aby };
}

function closestPointInTriangle(
  px: number,
  py: number,
  a: Point2D,
  b: Point2D,
  c: Point2D,
): Point2D {
  if (isPointInTriangle(px, py, a, b, c, 0)) {
    return { x: px, y: py };
  }
  const pAB = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
  const pBC = closestPointOnSegment(px, py, b.x, b.y, c.x, c.y);
  const pCA = closestPointOnSegment(px, py, c.x, c.y, a.x, a.y);

  const dAB = (px - pAB.x) ** 2 + (py - pAB.y) ** 2;
  const dBC = (px - pBC.x) ** 2 + (py - pBC.y) ** 2;
  const dCA = (px - pCA.x) ** 2 + (py - pCA.y) ** 2;

  let best = pAB;
  let bestD = dAB;
  if (dBC < bestD) {
    best = pBC;
    bestD = dBC;
  }
  if (dCA < bestD) {
    best = pCA;
  }

  // Nudge microscopically toward the triangle centroid so boundary projections remain
  // strictly inside the closed triangle under floating-point precision checks.
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  return {
    x: best.x + (cx - best.x) * 1e-4,
    y: best.y + (cy - best.y) * 1e-4,
  };
}

function clampPointToTriangles(
  px: number,
  py: number,
  tris: readonly TrianglePoints[],
): Point2D {
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i]!;
    if (isPointInTriangle(px, py, a, b, c, 0)) {
      return { x: px, y: py };
    }
  }
  let best: Point2D = { x: px, y: py };
  let bestDistSq = Infinity;
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i]!;
    const candidate = closestPointInTriangle(px, py, a, b, c);
    const d2 = (px - candidate.x) ** 2 + (py - candidate.y) ** 2;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = candidate;
    }
  }
  return best;
}

function buildItemCoveringTriangles(
  items: readonly LayoutItemInput[],
  mesh?: SimplexMesh,
): (readonly TrianglePoints[] | null)[] {
  if (!mesh || mesh.triangles.length === 0) {
    return items.map(() => null);
  }
  return items.map((it) => {
    const rawIndices = it.unitVertexIndices;
    if (!rawIndices || rawIndices.length < 2) return null;
    const uniqueIndices: number[] = [];
    for (let i = 0; i < rawIndices.length; i++) {
      const idx = rawIndices[i]!;
      if (!uniqueIndices.includes(idx)) uniqueIndices.push(idx);
    }
    if (uniqueIndices.length < 2) return null;

    const matched: TrianglePoints[] = [];
    for (let t = 0; t < mesh.triangles.length; t++) {
      const tv = mesh.triangles[t]!.vertices;
      let coversAll = true;
      for (let k = 0; k < uniqueIndices.length; k++) {
        const req = uniqueIndices[k]!;
        if (tv[0] !== req && tv[1] !== req && tv[2] !== req) {
          coversAll = false;
          break;
        }
      }
      if (coversAll) {
        const va = mesh.vertices[tv[0]];
        const vb = mesh.vertices[tv[1]];
        const vc = mesh.vertices[tv[2]];
        if (va && vb && vc) {
          matched.push([va, vb, vc]);
        }
      }
    }
    return matched.length > 0 ? matched : null;
  });
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

function buildPhyllotaxisStarts(
  scaledItems: readonly LayoutItemInput[],
  previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): { x: number; y: number }[] {
  const anchorBuckets = new Map<string, number>();
  return scaledItems.map((it) => {
    const prev = previousItemPositions?.get(it.id);
    if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
      return { x: prev.x, y: prev.y };
    }
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
}

function runPerItemPbdRelaxation(params: {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly initialStarts: readonly { readonly x: number; readonly y: number }[];
  readonly placedClusters: readonly PlacedNode[];
  readonly placedClusterBoxes: readonly ReturnType<typeof getHullBoundingBox>[];
  readonly itemScales: readonly number[];
  readonly itemCoveringTriangles?: readonly (readonly TrianglePoints[] | null)[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
  readonly itemGapPx: number;
  readonly relaxationIterations: number;
  readonly springFactor?: number;
  readonly springZeroTailRatio?: number;
}): {
  readonly overlapCount: number;
  readonly maxPenetration: number;
  readonly positions: { x: number; y: number }[];
} {
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
  const cellSize = Math.max(24, maxRadius * 2.2 + itemGapPx);
  const grid = new UniformSpatialHashGrid(cellSize);
  const boxes = new Array<ReturnType<typeof getHullBoundingBox>>(n);
  const queryBuf: number[] = [];

  const activeSpringIters = Math.max(
    1,
    Math.round(relaxationIterations * (1 - Math.max(0, Math.min(0.8, springZeroTailRatio)))),
  );

  for (let iter = 0; iter < relaxationIterations; iter++) {
    const springK =
      iter >= activeSpringIters
        ? 0
        : 0.18 * springFactor * (1 - (iter / activeSpringIters) * 0.85);
    if (springK > 0) {
      for (let i = 0; i < n; i++) {
        const it = scaledItems[i]!;
        const p = pos[i]!;
        p.x += (it.anchorX - p.x) * springK;
        p.y += (it.anchorY - p.y) * springK;
      }
    }

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
          const half = mtv.depth * 0.52;
          pA.x += mtv.nx * half;
          pA.y += mtv.ny * half;
          pB.x -= mtv.nx * half;
          pB.y -= mtv.ny * half;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const pA = pos[i]!;
      const hA = scaledItems[i]!.hull;
      const sA = itemScales[i]!;
      const boxA = getHullBoundingBox(hA, pA.x, pA.y, sA);
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
          pA.x += mtv.nx * (mtv.depth + 0.05);
          pA.y += mtv.ny * (mtv.depth + 0.05);
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
            // Slide along cluster perimeter toward viewport center instead of oscillating into the wall
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
  return {
    overlapCount: actualCheck.overlapCount,
    maxPenetration: actualCheck.maxPenetrationPx,
    positions: pos,
  };
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
  readonly mesh?: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin?: number;
  readonly options?: LayoutSolverOptions;
  readonly previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}): TwoPhaseLayoutResult {
  const {
    clusters,
    items,
    mesh,
    viewportWidth,
    viewportHeight,
    viewportMargin = 8,
    options = {},
    previousItemPositions,
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
      clusters: placedClusters,
      items: [],
      clusterScale,
      contentScale: 1.0,
      overlapCount: check.overlapCount,
      maxPenetrationPx: check.maxPenetrationPx,
    };
  }

  const initialStarts = buildPhyllotaxisStarts(scaledItems, previousItemPositions);
  const placedClusterBoxes = placedClusters.map((c) =>
    getHullBoundingBox(c.hull, c.x, c.y, c.scale),
  );
  const itemCoveringTriangles = buildItemCoveringTriangles(scaledItems, mesh);

  const runUniform = (alpha: number) =>
    runPerItemPbdRelaxation({
      scaledItems,
      initialStarts,
      placedClusters,
      placedClusterBoxes,
      itemScales: new Array<number>(scaledItems.length).fill(alpha),
      itemCoveringTriangles,
      viewportWidth,
      viewportHeight,
      viewportMargin,
      itemGapPx,
      relaxationIterations,
    });

  let contentScale = 1.0;
  let chosenResult = runUniform(1.0);

  if (chosenResult.overlapCount > 0 || chosenResult.maxPenetration > 1e-4) {
    let lo = Math.min(minContentScale, 0.08);
    let hi = 1.0;
    let bestAlpha = lo;
    let bestRes = runUniform(lo);

    for (let step = 0; step < 7; step++) {
      const mid = (lo + hi) / 2;
      const attempt = runUniform(mid);
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

/**
 * Local density-adaptive overlap-free convex layout solver:
 *
 * Unlike `solveTwoPhaseLayout` (which shrinks all content items uniformly whenever one hotspot
 * overflows), this solver scales down only items in locally crowded anchor neighborhoods so
 * sparse items retain full `1.0 * sizeMultiplier` readability while guaranteeing `0.0 px` overlap.
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
  const {
    clusters,
    items,
    mesh,
    viewportWidth,
    viewportHeight,
    viewportMargin = 8,
    options = {},
    crowdRadiusPx = 76,
    minLocalScale = 0.42,
    previousItemPositions,
  } = params;

  const clusterGapPx = options.clusterGapPx ?? 14;
  const itemGapPx = options.itemGapPx ?? 5;
  const minContentScale = options.minContentScale ?? 0.16;
  const relaxationIterations = options.relaxationIterations ?? 42;
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
      clusters: placedClusters,
      items: [],
      clusterScale,
      contentScale: 1.0,
      overlapCount: check.overlapCount,
      maxPenetrationPx: check.maxPenetrationPx,
    };
  }

  // Estimate local anchor crowding relative to neighborhood capacity
  const itemRadii = scaledItems.map((it) => Math.max(4, getHullBoundingRadius(it.hull)));
  const rSq = crowdRadiusPx * crowdRadiusPx;
  const localBaseScales = scaledItems.map((it, i) => {
    let demandArea = Math.PI * itemRadii[i]! * itemRadii[i]!;
    for (let j = 0; j < scaledItems.length; j++) {
      if (i === j) continue;
      const other = scaledItems[j]!;
      const dx = it.anchorX - other.anchorX;
      const dy = it.anchorY - other.anchorY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= rSq) {
        const weight = 1 - Math.sqrt(d2) / crowdRadiusPx;
        const rad = itemRadii[j]! + itemGapPx * 0.5;
        demandArea += Math.PI * rad * rad * (0.35 + 0.65 * weight);
      }
    }
    const availableArea = Math.PI * crowdRadiusPx * crowdRadiusPx * 0.42;
    if (demandArea <= availableArea) return 1.0;
    const ratio = Math.sqrt(availableArea / demandArea);
    return Math.max(minLocalScale, Math.min(1.0, ratio));
  });

  const initialStarts = buildPhyllotaxisStarts(scaledItems, previousItemPositions);
  const placedClusterBoxes = placedClusters.map((c) =>
    getHullBoundingBox(c.hull, c.x, c.y, c.scale),
  );
  const itemCoveringTriangles = buildItemCoveringTriangles(scaledItems, mesh);

  const runScaled = (globalFactor: number) => {
    const scales = localBaseScales.map((ls) => ls * globalFactor);
    return runPerItemPbdRelaxation({
      scaledItems,
      initialStarts,
      placedClusters,
      placedClusterBoxes,
      itemScales: scales,
      itemCoveringTriangles,
      viewportWidth,
      viewportHeight,
      viewportMargin,
      itemGapPx,
      relaxationIterations,
    });
  };

  let globalFactor = 1.0;
  let chosenResult = runScaled(1.0);
  if (chosenResult.overlapCount > 0 || chosenResult.maxPenetration > 1e-4) {
    let lo = Math.min(minContentScale, 0.08);
    let hi = 1.0;
    let bestFactor = lo;
    let bestRes = runScaled(lo);
    for (let step = 0; step < 7; step++) {
      const mid = (lo + hi) / 2;
      const attempt = runScaled(mid);
      if (attempt.overlapCount === 0 && attempt.maxPenetration <= 1e-4) {
        bestFactor = mid;
        bestRes = attempt;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    globalFactor = bestFactor;
    chosenResult = bestRes;
  }

  const finalClusters: PlacedNode[] = placedClusters.map((c, idx) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    scale: clusterScale * sizeMultiplier,
    hull: clusters[idx]!.hull,
  }));

  let avgItemScale = 0;
  const finalItems: PlacedNode[] = scaledItems.map((it, idx) => {
    const s = localBaseScales[idx]! * globalFactor;
    avgItemScale += s;
    return {
      id: it.id,
      x: chosenResult.positions[idx]!.x,
      y: chosenResult.positions[idx]!.y,
      scale: s * sizeMultiplier,
      hull: items[idx]!.hull,
    };
  });
  avgItemScale /= Math.max(1, finalItems.length);

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
    contentScale: avgItemScale,
    overlapCount: finalCheck.overlapCount,
    maxPenetrationPx: finalCheck.maxPenetrationPx,
  };
}

function findCollidingItemIndices(params: {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly positions: readonly { readonly x: number; readonly y: number }[];
  readonly itemScales: readonly number[];
  readonly itemCoveringTriangles?: readonly (readonly TrianglePoints[] | null)[];
  readonly placedClusters: readonly PlacedNode[];
  readonly placedClusterBoxes: readonly ReturnType<typeof getHullBoundingBox>[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
}): Set<number> {
  const {
    scaledItems,
    positions,
    itemScales,
    itemCoveringTriangles,
    placedClusters,
    placedClusterBoxes,
    viewportWidth,
    viewportHeight,
    viewportMargin,
  } = params;
  const colliding = new Set<number>();
  const n = scaledItems.length;
  let maxR = 16;
  const boxes = new Array<ReturnType<typeof getHullBoundingBox>>(n);

  for (let i = 0; i < n; i++) {
    const s = itemScales[i]!;
    maxR = Math.max(maxR, getHullBoundingRadius(scaledItems[i]!.hull) * s);
    boxes[i] = getHullBoundingBox(
      scaledItems[i]!.hull,
      positions[i]!.x,
      positions[i]!.y,
      s,
    );
  }

  const grid = new UniformSpatialHashGrid(Math.max(24, maxR * 2.1));
  for (let i = 0; i < n; i++) {
    grid.insert(i, boxes[i]!, 1);
  }
  const queryBuf: number[] = [];

  for (let i = 0; i < n; i++) {
    const box = boxes[i]!;
    const pA = positions[i]!;
    const hA = scaledItems[i]!.hull;
    const sA = itemScales[i]!;

    if (
      box.minX < viewportMargin - 0.5 ||
      box.maxX > viewportWidth - viewportMargin + 0.5 ||
      box.minY < viewportMargin - 0.5 ||
      box.maxY > viewportHeight - viewportMargin + 0.5
    ) {
      colliding.add(i);
    }

    const triGroup = itemCoveringTriangles?.[i];
    if (triGroup) {
      let inside = false;
      for (let t = 0; t < triGroup.length; t++) {
        const [a, b, c] = triGroup[t]!;
        if (isPointInTriangle(pA.x, pA.y, a, b, c, 1e-4)) {
          inside = true;
          break;
        }
      }
      if (!inside) {
        colliding.add(i);
      }
    }

    for (let cIdx = 0; cIdx < placedClusters.length; cIdx++) {
      const cb = placedClusterBoxes[cIdx]!;
      if (
        box.maxX <= cb.minX ||
        cb.maxX <= box.minX ||
        box.maxY <= cb.minY ||
        cb.maxY <= box.minY
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
        0,
      );
      if (mtv && mtv.depth > 1e-4) {
        colliding.add(i);
      }
    }

    const candidates = grid.query(box, 1, queryBuf);
    for (let k = 0; k < candidates.length; k++) {
      const j = candidates[k]!;
      if (j <= i) continue;
      const boxB = boxes[j]!;
      if (
        box.maxX <= boxB.minX ||
        boxB.maxX <= box.minX ||
        box.maxY <= boxB.minY ||
        boxB.maxY <= box.minY
      ) {
        continue;
      }
      const pB = positions[j]!;
      const mtv = computeConvexMtv(
        hA,
        pA.x,
        pA.y,
        sA,
        scaledItems[j]!.hull,
        pB.x,
        pB.y,
        itemScales[j]!,
        0,
      );
      if (mtv && mtv.depth > 1e-4) {
        colliding.add(i);
        colliding.add(j);
      }
    }
  }

  return colliding;
}

function buildMeshAwareStarts(params: {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly mesh?: SimplexMesh;
  readonly itemCoveringTriangles?: readonly (readonly TrianglePoints[] | null)[];
  readonly previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}): { x: number; y: number }[] {
  const { scaledItems, mesh, itemCoveringTriangles, previousItemPositions } = params;
  const anchorBuckets = new Map<string, number>();

  // Compute centroid of covering or incident triangles for directional inward spreading
  const resolveInwardDir = (
    ax: number,
    ay: number,
    triGroup: readonly TrianglePoints[] | null | undefined,
  ): { dx: number; dy: number } => {
    if (triGroup && triGroup.length > 0) {
      let sumCx = 0;
      let sumCy = 0;
      for (let t = 0; t < triGroup.length; t++) {
        const [va, vb, vc] = triGroup[t]!;
        sumCx += (va.x + vb.x + vc.x) / 3;
        sumCy += (va.y + vb.y + vc.y) / 3;
      }
      const tx = sumCx / triGroup.length - ax;
      const ty = sumCy / triGroup.length - ay;
      const len = Math.hypot(tx, ty);
      if (len > 1e-6) return { dx: tx / len, dy: ty / len };
    }
    if (!mesh || mesh.triangles.length === 0) {
      return { dx: 1, dy: 0 };
    }
    let nearestV = 0;
    let bestD2 = Infinity;
    for (let v = 0; v < mesh.vertices.length; v++) {
      const pt = mesh.vertices[v]!;
      const d2 = (pt.x - ax) ** 2 + (pt.y - ay) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        nearestV = v;
      }
    }
    let sumCx = 0;
    let sumCy = 0;
    let count = 0;
    for (const tr of mesh.triangles) {
      if (tr.vertices[0] === nearestV || tr.vertices[1] === nearestV || tr.vertices[2] === nearestV) {
        const va = mesh.vertices[tr.vertices[0]]!;
        const vb = mesh.vertices[tr.vertices[1]]!;
        const vc = mesh.vertices[tr.vertices[2]]!;
        sumCx += (va.x + vb.x + vc.x) / 3;
        sumCy += (va.y + vb.y + vc.y) / 3;
        count++;
      }
    }
    if (count === 0) {
      sumCx = mesh.width * 0.5;
      sumCy = mesh.height * 0.5;
      count = 1;
    }
    const tx = sumCx / count - ax;
    const ty = sumCy / count - ay;
    const len = Math.hypot(tx, ty);
    if (len <= 1e-6) return { dx: 1, dy: 0 };
    return { dx: tx / len, dy: ty / len };
  };

  return scaledItems.map((it, itemIdx) => {
    const triGroup = itemCoveringTriangles?.[itemIdx];
    const prev = previousItemPositions?.get(it.id);
    if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
      return triGroup ? clampPointToTriangles(prev.x, prev.y, triGroup) : { x: prev.x, y: prev.y };
    }
    const key = `${Math.round(it.anchorX * 0.5)}:${Math.round(it.anchorY * 0.5)}`;
    const idx = anchorBuckets.get(key) ?? 0;
    anchorBuckets.set(key, idx + 1);
    if (idx === 0) {
      return triGroup
        ? clampPointToTriangles(it.anchorX, it.anchorY, triGroup)
        : { x: it.anchorX, y: it.anchorY };
    }

    const inward = resolveInwardDir(it.anchorX, it.anchorY, triGroup);
    const baseAngle = Math.atan2(inward.dy, inward.dx);
    // Fan across an inward cone into covering/incident triangles using golden-angle dithering
    const offsetAngle = (((idx * 0.61803398875) % 1) - 0.5) * Math.PI * 1.15;
    const angle = baseAngle + offsetAngle;
    const radius = 5.5 * Math.sqrt(idx);
    const fx = it.anchorX + Math.cos(angle) * radius;
    const fy = it.anchorY + Math.sin(angle) * radius;
    return triGroup ? clampPointToTriangles(fx, fy, triGroup) : { x: fx, y: fy };
  });
}

/**
 * Collision-driven adaptive layout solver:
 *
 * Keeps every content node at `1.0` scale wherever possible, relaxes tightly packed anchors
 * into open adjacent triangle space, and selectively scales down **only** the locally colliding
 * pockets until `0.0 px` overlap is reached.
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
  const {
    clusters,
    items,
    mesh,
    viewportWidth,
    viewportHeight,
    viewportMargin = 8,
    options = {},
    minLocalScale = 0.32,
    shrinkFactor = 0.85,
    maxRefinementRounds = 9,
    previousItemPositions,
  } = params;

  const clusterGapPx = options.clusterGapPx ?? 14;
  const itemGapPx = options.itemGapPx ?? 5;
  const minContentScale = options.minContentScale ?? 0.16;
  const relaxationIterations = options.relaxationIterations ?? 46;
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
      clusters: placedClusters,
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
  const scales = new Array<number>(scaledItems.length).fill(1.0);
  const starts = buildMeshAwareStarts({
    scaledItems,
    mesh,
    itemCoveringTriangles,
    previousItemPositions,
  });

  let currentResult = runPerItemPbdRelaxation({
    scaledItems,
    initialStarts: starts,
    placedClusters,
    placedClusterBoxes,
    itemScales: scales,
    itemCoveringTriangles,
    viewportWidth,
    viewportHeight,
    viewportMargin,
    itemGapPx,
    relaxationIterations,
    springFactor: 0.7,
    springZeroTailRatio: 0.35,
  });

  let colliding = findCollidingItemIndices({
    scaledItems,
    positions: currentResult.positions,
    itemScales: scales,
    itemCoveringTriangles,
    placedClusters,
    placedClusterBoxes,
    viewportWidth,
    viewportHeight,
    viewportMargin,
  });

  let round = 0;
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

    currentResult = runPerItemPbdRelaxation({
      scaledItems,
      initialStarts: currentResult.positions,
      placedClusters,
      placedClusterBoxes,
      itemScales: scales,
      itemCoveringTriangles,
      viewportWidth,
      viewportHeight,
      viewportMargin,
      itemGapPx,
      relaxationIterations: Math.max(24, Math.round(relaxationIterations * 0.65)),
      springFactor: 0.42,
      springZeroTailRatio: 0.45,
    });

    colliding = findCollidingItemIndices({
      scaledItems,
      positions: currentResult.positions,
      itemScales: scales,
      itemCoveringTriangles,
      placedClusters,
      placedClusterBoxes,
      viewportWidth,
      viewportHeight,
      viewportMargin,
    });
  }

  // Safety fallback: first shrink only items in colliding pockets; only scale globally if viewport is saturated
  if (colliding.size > 0 || currentResult.overlapCount > 0) {
    const stuckSet = new Set<number>(colliding);
    if (stuckSet.size === 0) {
      // Mark any item near another item or cluster boundary if measureLayoutOverlaps flagged a sub-pixel border issue
      for (let i = 0; i < scaledItems.length; i++) {
        if (scales[i]! < 0.999) stuckSet.add(i);
      }
      if (stuckSet.size === 0) {
        for (let i = 0; i < scaledItems.length; i++) stuckSet.add(i);
      }
    }

    const fallbackIters = Math.max(relaxationIterations, 56);
    const buildTrialScales = (factor: number, globalFallback: boolean) =>
      scales.map((s, idx) => (globalFallback || stuckSet.has(idx) ? s * factor : s));

    const tryFallbackMode = (globalFallback: boolean) => {
      let lo = Math.min(minContentScale, 0.08);
      let hi = 1.0;
      let bestFactor = lo;
      let bestRes = runPerItemPbdRelaxation({
        scaledItems,
        initialStarts: starts,
        placedClusters,
        placedClusterBoxes,
        itemScales: buildTrialScales(lo, globalFallback),
        itemCoveringTriangles,
        viewportWidth,
        viewportHeight,
        viewportMargin,
        itemGapPx,
        relaxationIterations: fallbackIters,
        springFactor: 0.45,
        springZeroTailRatio: 0.4,
      });

      if (bestRes.overlapCount > 0 || bestRes.maxPenetration > 1e-4) {
        return { ok: false as const, bestFactor, bestRes };
      }

      for (let step = 0; step < 6; step++) {
        const mid = (lo + hi) / 2;
        const attempt = runPerItemPbdRelaxation({
          scaledItems,
          initialStarts: starts,
          placedClusters,
          placedClusterBoxes,
          itemScales: buildTrialScales(mid, globalFallback),
          itemCoveringTriangles,
          viewportWidth,
          viewportHeight,
          viewportMargin,
          itemGapPx,
          relaxationIterations: fallbackIters,
          springFactor: 0.45,
          springZeroTailRatio: 0.4,
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
      for (let i = 0; i < scales.length; i++) scales[i] = nextScales[i]!;
      currentResult = localAttempt.bestRes;
    } else {
      const globalAttempt = tryFallbackMode(true);
      const nextScales = buildTrialScales(globalAttempt.bestFactor, true);
      for (let i = 0; i < scales.length; i++) scales[i] = nextScales[i]!;
      currentResult = globalAttempt.bestRes;
    }
  }

  const finalClusters: PlacedNode[] = placedClusters.map((c, idx) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    scale: clusterScale * sizeMultiplier,
    hull: clusters[idx]!.hull,
  }));

  let avgItemScale = 0;
  const finalItems: PlacedNode[] = scaledItems.map((it, idx) => {
    const s = scales[idx]!;
    avgItemScale += s;
    return {
      id: it.id,
      x: currentResult.positions[idx]!.x,
      y: currentResult.positions[idx]!.y,
      scale: s * sizeMultiplier,
      hull: items[idx]!.hull,
    };
  });
  avgItemScale /= Math.max(1, finalItems.length);

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
    contentScale: avgItemScale,
    overlapCount: finalCheck.overlapCount,
    maxPenetrationPx: finalCheck.maxPenetrationPx,
  };
}
