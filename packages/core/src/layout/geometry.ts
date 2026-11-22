import {
  computeConvexMtv,
  getHullBoundingBox,
  getHullBoundingRadius,
  isPointInTriangle,
  UniformSpatialHashGrid,
} from '../geometry.js';
import type {
  BoundingBox2D,
  ConvexGeometry,
  Point2D,
  SimplexMesh,
} from '../types.js';
import type {
  LayoutItemInput,
  PlacedNode,
  TrianglePoints,
} from './types.js';

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

export function clampPointToTriangles(
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

export function buildItemCoveringTriangles(
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

function viewportHeightCenter(
  viewportH: number,
  bbox: { minY: number; maxY: number },
  y: number,
): number {
  return viewportH / 2 - (bbox.minY + bbox.maxY - 2 * y) / 2;
}

export function clampNodeInsideViewport(
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

  const clusterBoxes = new Array<BoundingBox2D>(clusters.length);
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
  const itemBoxes = new Array<BoundingBox2D>(items.length);

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

export function findCollidingItemIndices(params: {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly positions: readonly { readonly x: number; readonly y: number }[];
  readonly itemScales: readonly number[];
  readonly itemCoveringTriangles?: readonly (readonly TrianglePoints[] | null)[];
  readonly placedClusters: readonly PlacedNode[];
  readonly placedClusterBoxes: readonly BoundingBox2D[];
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
  const boxes = new Array<BoundingBox2D>(n);

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
