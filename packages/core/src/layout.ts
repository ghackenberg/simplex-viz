import {
  computeConvexMtv,
  getHullBoundingBox,
  getHullBoundingRadius,
  isPointInTriangle,
  scaleConvexGeometry,
  UniformSpatialHashGrid,
} from './geometry';
import type {
  BoundingBox2D,
  ConvexGeometry,
  LayoutSolverOptions,
  Point2D,
  SimplexMesh,
} from './types';

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

export type TrianglePoints = readonly [Point2D, Point2D, Point2D];

// ============================================================================
// Orthogonal Layout Building-Block Interfaces (Seeder × Relaxer × ScaleController)
// ============================================================================

export interface LayoutSeedContext {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly placedClusters: readonly PlacedNode[];
  readonly mesh?: SimplexMesh;
  readonly itemCoveringTriangles: readonly (readonly TrianglePoints[] | null)[];
  readonly previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
}

/**
 * Computes deterministic initial `(x, y)` coordinates for content items prior to relaxation.
 */
export interface LayoutSeeder {
  readonly name: string;
  seed(ctx: LayoutSeedContext): Point2D[];
}

export interface PositionRelaxationInput {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly initialStarts: readonly Point2D[];
  readonly itemScales: readonly number[];
  readonly placedClusters: readonly PlacedNode[];
  readonly placedClusterBoxes: readonly BoundingBox2D[];
  readonly itemCoveringTriangles: readonly (readonly TrianglePoints[] | null)[];
  readonly mesh?: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
  readonly itemGapPx: number;
  readonly relaxationIterations: number;
  /** True when invoked from an iterative scale-refinement warm pass. */
  readonly isRefinementPass?: boolean;
}

export interface PositionRelaxationOutput {
  readonly positions: Point2D[];
  readonly overlapCount: number;
  readonly maxPenetration: number;
  readonly collidingIndices: ReadonlySet<number>;
}

/**
 * Resolves content item positions `(x, y)` for a given per-item scale vector `itemScales`,
 * enforcing cluster obstacles, viewport boundaries, and covering-triangle containment.
 */
export interface PositionRelaxer {
  readonly name: string;
  relax(input: PositionRelaxationInput): PositionRelaxationOutput;
}

export interface ScaleControlContext {
  readonly scaledItems: readonly LayoutItemInput[];
  readonly initialStarts: readonly Point2D[];
  readonly placedClusters: readonly PlacedNode[];
  readonly placedClusterBoxes: readonly BoundingBox2D[];
  readonly itemCoveringTriangles: readonly (readonly TrianglePoints[] | null)[];
  readonly mesh?: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin: number;
  readonly itemGapPx: number;
  readonly minContentScale: number;
  readonly relaxationIterations: number;
  /**
   * Runs the active `PositionRelaxer` for a candidate per-item scale vector and returns
   * settled positions plus exact collision diagnostics.
   */
  readonly evaluate: (
    itemScales: readonly number[],
    options?: {
      readonly starts?: readonly Point2D[];
      readonly iterations?: number;
      readonly isRefinementPass?: boolean;
    },
  ) => PositionRelaxationOutput;
}

export interface ScaleControlResult {
  readonly scales: readonly number[];
  readonly relaxation: PositionRelaxationOutput;
}

/**
 * Outer-loop scale adaptation controller coupled via geometric feedback (`ctx.evaluate`)
 * to any `PositionRelaxer`.
 */
export interface ScaleController {
  readonly name: string;
  solveScales(ctx: ScaleControlContext): ScaleControlResult;
}

// ============================================================================
// Geometry & Containment Helpers
// ============================================================================

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

function findCollidingItemIndices(params: {
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

// ============================================================================
// Built-In Layout Seeders (Initial Placement)
// ============================================================================

export interface PhyllotaxisSeederOptions {
  /** Reuse `previousItemPositions` when provided. Default: `false`. */
  readonly warmStart?: boolean;
  /** Radial spacing factor in px for co-located anchors. Default: `2.5`. */
  readonly stepRadiusPx?: number;
}

/**
 * Deterministic golden-angle phyllotaxis spiral around each item's barycentric anchor,
 * clamped inside covering mesh triangles when present.
 */
export function createPhyllotaxisSeeder(
  options?: PhyllotaxisSeederOptions,
): LayoutSeeder {
  const warmStart = options?.warmStart ?? false;
  const stepRadiusPx = options?.stepRadiusPx ?? 2.5;
  return {
    name: warmStart ? 'phyllotaxis-warm' : 'phyllotaxis',
    seed(ctx) {
      const { scaledItems, placedClusters, itemCoveringTriangles, previousItemPositions } = ctx;
      const anchorBuckets = new Map<string, number>();
      return scaledItems.map((it, itemIdx) => {
        const triGroup = itemCoveringTriangles[itemIdx];
        if (warmStart && previousItemPositions) {
          const prev = previousItemPositions.get(it.id);
          if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
            return triGroup
              ? clampPointToTriangles(prev.x, prev.y, triGroup)
              : { x: prev.x, y: prev.y };
          }
        }
        const singleV =
          !triGroup && it.unitVertexIndices?.length === 1
            ? it.unitVertexIndices[0]
            : undefined;
        const hostCluster =
          singleV !== undefined ? placedClusters[singleV] : undefined;
        const baseX = hostCluster ? hostCluster.x : it.anchorX;
        const baseY = hostCluster ? hostCluster.y : it.anchorY;

        const key = `${Math.round(baseX * 2)}:${Math.round(baseY * 2)}`;
        const idx = anchorBuckets.get(key) ?? 0;
        anchorBuckets.set(key, idx + 1);
        if (idx === 0 && !hostCluster) {
          return triGroup
            ? clampPointToTriangles(baseX, baseY, triGroup)
            : { x: baseX, y: baseY };
        }
        const angle = (idx + 0.5) * 2.399963229728653;
        const orbitBase = hostCluster
          ? getHullBoundingRadius(hostCluster.hull) * hostCluster.scale * 0.45 + 4
          : 0;
        const radius = orbitBase + stepRadiusPx * Math.sqrt(idx);
        const px = baseX + Math.cos(angle) * radius;
        const py = baseY + Math.sin(angle) * radius;
        return triGroup ? clampPointToTriangles(px, py, triGroup) : { x: px, y: py };
      });
    },
  };
}

export interface MeshInwardFanSeederOptions {
  /** Reuse `previousItemPositions` when provided. Default: `false`. */
  readonly warmStart?: boolean;
  /** Radial fan step in px. Default: `5.5`. */
  readonly stepRadiusPx?: number;
  /** Angular cone width in radians for multi-cluster triangle items. Default: `Math.PI * 1.15`. */
  readonly coneRadians?: number;
}

/**
 * Mesh-aware seeder:
 * - Multi-cluster items (`triGroup !== null`) fan inward toward the centroid of their covering
 *   mesh triangle(s).
 * - Single-cluster items (`triGroup === null`) are exempt from triangle cones and arrange in a
 *   full `360°` golden-angle halo all around their topic cluster (even at boundary/corner
 *   triangulation vertices that only border a single triangle).
 */
export function createMeshInwardFanSeeder(
  options?: MeshInwardFanSeederOptions,
): LayoutSeeder {
  const warmStart = options?.warmStart ?? false;
  const stepRadiusPx = options?.stepRadiusPx ?? 5.5;
  const coneRadians = options?.coneRadians ?? Math.PI * 1.15;

  return {
    name: warmStart ? 'mesh-inward-fan-warm' : 'mesh-inward-fan',
    seed(ctx) {
      const { scaledItems, placedClusters, itemCoveringTriangles, previousItemPositions } = ctx;
      const anchorBuckets = new Map<string, number>();

      const resolveTriangleDir = (
        ax: number,
        ay: number,
        triGroup: readonly TrianglePoints[],
      ): { dx: number; dy: number } => {
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
        return { dx: 1, dy: 0 };
      };

      return scaledItems.map((it, itemIdx) => {
        const triGroup = itemCoveringTriangles[itemIdx];
        if (warmStart && previousItemPositions) {
          const prev = previousItemPositions.get(it.id);
          if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
            return triGroup
              ? clampPointToTriangles(prev.x, prev.y, triGroup)
              : { x: prev.x, y: prev.y };
          }
        }

        // Single-cluster / unconstrained items: 360° isotropic golden-angle halo around their cluster
        if (!triGroup || triGroup.length === 0) {
          const singleV =
            it.unitVertexIndices?.length === 1 ? it.unitVertexIndices[0] : undefined;
          let hostCluster =
            singleV !== undefined ? placedClusters[singleV] : undefined;
          if (!hostCluster && !it.unitVertexIndices) {
            for (let cIdx = 0; cIdx < placedClusters.length; cIdx++) {
              const cand = placedClusters[cIdx]!;
              if (Math.hypot(cand.x - it.anchorX, cand.y - it.anchorY) <= 4) {
                hostCluster = cand;
                break;
              }
            }
          }
          const cx = hostCluster ? hostCluster.x : it.anchorX;
          const cy = hostCluster ? hostCluster.y : it.anchorY;
          const key = `halo:${Math.round(cx * 0.5)}:${Math.round(cy * 0.5)}`;
          const idx = anchorBuckets.get(key) ?? 0;
          anchorBuckets.set(key, idx + 1);

          if (!hostCluster && idx === 0) {
            return { x: cx, y: cy };
          }
          const angle = (idx + 0.5) * 2.399963229728653;
          const orbitBase = hostCluster
            ? getHullBoundingRadius(hostCluster.hull) * hostCluster.scale * 0.55 +
              getHullBoundingRadius(it.hull) * 0.75 +
              4
            : 0;
          const radius = orbitBase + stepRadiusPx * Math.sqrt(idx);
          return {
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
          };
        }

        // Multi-cluster items (2 or 3 clusters): inward cone into covering mesh triangle(s)
        const key = `tri:${Math.round(it.anchorX * 0.5)}:${Math.round(it.anchorY * 0.5)}`;
        const idx = anchorBuckets.get(key) ?? 0;
        anchorBuckets.set(key, idx + 1);
        if (idx === 0) {
          return clampPointToTriangles(it.anchorX, it.anchorY, triGroup);
        }

        const inward = resolveTriangleDir(it.anchorX, it.anchorY, triGroup);
        const baseAngle = Math.atan2(inward.dy, inward.dx);
        const offsetAngle = (((idx * 0.61803398875) % 1) - 0.5) * coneRadians;
        const angle = baseAngle + offsetAngle;
        const radius = stepRadiusPx * Math.sqrt(idx);
        const fx = it.anchorX + Math.cos(angle) * radius;
        const fy = it.anchorY + Math.sin(angle) * radius;
        return clampPointToTriangles(fx, fy, triGroup);
      });
    },
  };
}

/**
 * Wraps any `LayoutSeeder` so existing items reuse their settled coordinates from the
 * previous layout frame (clamped to their current covering triangles), while newly added
 * items fall back to `baseSeeder`.
 */
export function withWarmStartSeeder(baseSeeder: LayoutSeeder): LayoutSeeder {
  return {
    name: `${baseSeeder.name}:warm-start`,
    seed(ctx) {
      const seeded = baseSeeder.seed(ctx);
      if (!ctx.previousItemPositions || ctx.previousItemPositions.size === 0) {
        return seeded;
      }
      return ctx.scaledItems.map((it, idx) => {
        const prev = ctx.previousItemPositions?.get(it.id);
        if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
          const triGroup = ctx.itemCoveringTriangles[idx];
          return triGroup
            ? clampPointToTriangles(prev.x, prev.y, triGroup)
            : { x: prev.x, y: prev.y };
        }
        return seeded[idx]!;
      });
    },
  };
}

// ============================================================================
// Built-In Position Relaxers (Inner Position Solver at Fixed Scales)
// ============================================================================

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

// ============================================================================
// Built-In Scale Controllers (Outer Scale Loop)
// ============================================================================

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
          currentResult = localAttempt.bestRes;
        } else {
          const globalAttempt = tryFallbackMode(true);
          const nextScales = buildTrialScales(globalAttempt.bestFactor, true);
          for (let i = 0; i < n; i++) scales[i] = nextScales[i]!;
          currentResult = globalAttempt.bestRes;
        }
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
          currentResult = localAttempt.bestRes;
        } else {
          const globalAttempt = tryFallbackMode(true);
          const nextScales = buildTrialScales(globalAttempt.bestFactor, true);
          for (let i = 0; i < n; i++) scales[i] = nextScales[i]!;
          currentResult = globalAttempt.bestRes;
        }
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

// ============================================================================
// Composed Solver Orchestrator & Backwards-Compatible Presets
// ============================================================================

export interface ComposedLayoutParams {
  readonly clusters: readonly LayoutClusterInput[];
  readonly items: readonly LayoutItemInput[];
  readonly mesh?: SimplexMesh;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportMargin?: number;
  readonly options?: LayoutSolverOptions;
  readonly previousItemPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly seeder?: LayoutSeeder;
  readonly relaxer?: PositionRelaxer;
  readonly scaleController?: ScaleController;
  readonly defaultRelaxationIterations?: number;
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
