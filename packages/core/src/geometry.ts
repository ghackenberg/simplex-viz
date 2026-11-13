import type { BoundingBox2D, ConvexGeometry, Point2D } from './types';

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Computes the counter-clockwise convex hull of a 2D point cloud using Andrew's Monotone Chain.
 */
export function computeConvexHull(points: readonly Point2D[]): readonly Point2D[] {
  if (points.length <= 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const sorted = [...points].sort((a, b) =>
    a.x !== b.x ? a.x - b.x : a.y - b.y,
  );

  // Deduplicate exact points
  const unique: Point2D[] = [];
  for (const pt of sorted) {
    const last = unique[unique.length - 1];
    if (!last || Math.abs(last.x - pt.x) > 1e-7 || Math.abs(last.y - pt.y) > 1e-7) {
      unique.push({ x: pt.x, y: pt.y });
    }
  }
  if (unique.length <= 2) return unique;

  const lower: Point2D[] = [];
  for (const p of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-9
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-9
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Generates a counter-clockwise convex polygon approximating a rectangle (optionally rounded).
 */
export function rectToConvexPolygon(
  width: number,
  height: number,
  cornerRadius = 0,
): ConvexGeometry {
  const hw = Math.max(1, width / 2);
  const hh = Math.max(1, height / 2);
  const r = Math.min(Math.max(0, cornerRadius), hw, hh);
  if (r < 1) {
    return {
      kind: 'polygon',
      vertices: [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ],
    };
  }
  // 2-segment bevel per corner (CCW) — preserves rounded-corner envelope with minimal SAT axes
  const pts: Point2D[] = [];
  const corners = [
    { cx: hw - r, cy: hh - r, startAngle: 0 },
    { cx: -hw + r, cy: hh - r, startAngle: Math.PI / 2 },
    { cx: -hw + r, cy: -hh + r, startAngle: Math.PI },
    { cx: hw - r, cy: -hh + r, startAngle: (Math.PI * 3) / 2 },
  ];
  const steps = 2;
  for (const corner of corners) {
    for (let s = 0; s <= steps; s++) {
      const a = corner.startAngle + (s / steps) * (Math.PI / 2);
      pts.push({
        x: corner.cx + Math.cos(a) * r,
        y: corner.cy + Math.sin(a) * r,
      });
    }
  }
  return { kind: 'polygon', vertices: computeConvexHull(pts) };
}

/**
 * Generates a regular convex N-gon centered at `(0, 0)` in counter-clockwise order.
 */
export function regularPolygon(
  sides: number,
  radius: number,
  rotationRad = -Math.PI / 2,
): ConvexGeometry {
  const n = Math.max(3, Math.round(sides));
  const r = Math.max(1, radius);
  const vertices: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const angle = rotationRad + (i * Math.PI * 2) / n;
    vertices.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    });
  }
  return { kind: 'polygon', vertices: computeConvexHull(vertices) };
}

/**
 * Generates the convex hull of a star shape centered at `(0, 0)`.
 */
export function starConvexHull(points: number, outerRadius: number): ConvexGeometry {
  return regularPolygon(Math.max(5, points), outerRadius, -Math.PI / 2);
}

/**
 * Linearly scales a `ConvexGeometry` around `(0, 0)`.
 */
export function scaleConvexGeometry(hull: ConvexGeometry, scale: number): ConvexGeometry {
  const s = Math.max(0.001, scale);
  if (hull.kind === 'circle') {
    return { kind: 'circle', radius: hull.radius * s };
  }
  return {
    kind: 'polygon',
    vertices: hull.vertices.map((v) => ({ x: v.x * s, y: v.y * s })),
  };
}

/**
 * Converts any `ConvexGeometry` to an N-vertex polygon approximation for smooth hull interpolation.
 */
function toSampledPolygon(hull: ConvexGeometry, sampleCount = 24): readonly Point2D[] {
  if (hull.kind === 'circle') {
    const pts: Point2D[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const a = (i / sampleCount) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * hull.radius, y: Math.sin(a) * hull.radius });
    }
    return pts;
  }
  const verts = hull.vertices;
  if (verts.length === 0) return [{ x: 0, y: 0 }];
  // Sample rays from origin at equal angles and intersect with convex polygon boundary
  const pts: Point2D[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const a = (i / sampleCount) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let bestT = Infinity;
    for (let e = 0; e < verts.length; e++) {
      const p1 = verts[e]!;
      const p2 = verts[(e + 1) % verts.length]!;
      const ex = p2.x - p1.x;
      const ey = p2.y - p1.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-9) continue;
      const t = (p1.x * ey - p1.y * ex) / denom;
      const u = (p1.x * dy - p1.y * dx) / denom;
      if (t >= 0 && u >= -1e-5 && u <= 1 + 1e-5 && t < bestT) {
        bestT = t;
      }
    }
    const dist = Number.isFinite(bestT) ? bestT : getHullBoundingRadius(hull);
    pts.push({ x: dx * dist, y: dy * dist });
  }
  return pts;
}

/**
 * Smoothly interpolates between two arbitrary `ConvexGeometry` shapes (circle or polygon)
 * so crossfading nodes remain collision-free throughout the entire transition.
 */
export function interpolateConvexGeometry(
  from: ConvexGeometry,
  to: ConvexGeometry,
  progress: number,
): ConvexGeometry {
  const t = Math.max(0, Math.min(1, progress));
  if (t <= 0) return from;
  if (t >= 1) return to;
  if (from.kind === 'circle' && to.kind === 'circle') {
    return {
      kind: 'circle',
      radius: from.radius + (to.radius - from.radius) * t,
    };
  }
  const sampleCount = 24;
  const polyA = toSampledPolygon(from, sampleCount);
  const polyB = toSampledPolygon(to, sampleCount);
  const blended: Point2D[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const a = polyA[i]!;
    const b = polyB[i]!;
    blended.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }
  return { kind: 'polygon', vertices: computeConvexHull(blended) };
}

const boundingRadiusCache = new WeakMap<ConvexGeometry, number>();
const localBBoxCache = new WeakMap<ConvexGeometry, BoundingBox2D>();

/**
 * Computes the bounding circle radius of an unscaled `ConvexGeometry` around `(0, 0)`.
 */
export function getHullBoundingRadius(hull: ConvexGeometry): number {
  if (hull.kind === 'circle') return hull.radius;
  const cached = boundingRadiusCache.get(hull);
  if (cached !== undefined) return cached;
  let maxR = 0;
  for (const v of hull.vertices) {
    const r = Math.hypot(v.x, v.y);
    if (r > maxR) maxR = r;
  }
  boundingRadiusCache.set(hull, maxR);
  return maxR;
}

function getLocalHullBBox(hull: ConvexGeometry): BoundingBox2D {
  const cached = localBBoxCache.get(hull);
  if (cached !== undefined) return cached;
  if (hull.kind === 'circle') {
    const r = hull.radius;
    const box: BoundingBox2D = {
      minX: -r,
      minY: -r,
      maxX: r,
      maxY: r,
      width: r * 2,
      height: r * 2,
    };
    localBBoxCache.set(hull, box);
    return box;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < hull.vertices.length; i++) {
    const v = hull.vertices[i]!;
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  const box: BoundingBox2D = !Number.isFinite(minX)
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
    : { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  localBBoxCache.set(hull, box);
  return box;
}

/**
 * Computes the world-space axis-aligned bounding box of a placed, scaled `ConvexGeometry`.
 */
export function getHullBoundingBox(
  hull: ConvexGeometry,
  x: number,
  y: number,
  scale: number,
): BoundingBox2D {
  if (hull.kind === 'circle') {
    const r = hull.radius * scale;
    return {
      minX: x - r,
      minY: y - r,
      maxX: x + r,
      maxY: y + r,
      width: r * 2,
      height: r * 2,
    };
  }
  const lb = getLocalHullBBox(hull);
  const minX = x + lb.minX * scale;
  const maxX = x + lb.maxX * scale;
  const minY = y + lb.minY * scale;
  const maxY = y + lb.maxY * scale;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Mathematical point-in-convex-geometry hit test in world space (used by Core hit testing).
 */
export function hitTestConvexGeometry(
  hull: ConvexGeometry,
  cx: number,
  cy: number,
  scale: number,
  px: number,
  py: number,
  hitPadding = 2,
): boolean {
  const s = Math.max(0.001, scale);
  const lx = (px - cx) / s;
  const ly = (py - cy) / s;
  const pad = hitPadding / s;

  if (hull.kind === 'circle') {
    return Math.hypot(lx, ly) <= hull.radius + pad;
  }

  const verts = hull.vertices;
  const n = verts.length;
  if (n < 3) return Math.hypot(lx, ly) <= 4 + pad;

  // Test if point is inside (or within `pad` outside) every half-plane of the CCW convex polygon
  for (let i = 0; i < n; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % n]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    // Outward normal for CCW polygon is (ey / len, -ex / len)
    const signedDist = ((lx - a.x) * ey - (ly - a.y) * ex) / len;
    if (signedDist > pad) return false;
  }
  return true;
}

export interface MtvResult {
  /** Separation vector pushing shape A away from shape B. */
  readonly nx: number;
  readonly ny: number;
  /** Penetration depth (> 0 means overlapping). */
  readonly depth: number;
}

function projectPolygon(
  verts: readonly Point2D[],
  cx: number,
  cy: number,
  scale: number,
  ax: number,
  ay: number,
): readonly [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    const p = (cx + v.x * scale) * ax + (cy + v.y * scale) * ay;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

function satPolygonPolygon(
  vertsA: readonly Point2D[],
  ax: number,
  ay: number,
  scaleA: number,
  vertsB: readonly Point2D[],
  bx: number,
  by: number,
  scaleB: number,
  gap: number,
): MtvResult | null {
  let minOverlap = Infinity;
  let bestNx = 1;
  let bestNy = 0;
  const halfGap = gap * 0.5;

  const checkAxes = (verts: readonly Point2D[]) => {
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const p1 = verts[i]!;
      const p2 = verts[(i + 1) % n]!;
      const ex = p2.x - p1.x;
      const ey = p2.y - p1.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-9) continue;
      const nx = ey / len;
      const ny = -ex / len;

      let minA = Infinity;
      let maxA = -Infinity;
      for (let k = 0; k < vertsA.length; k++) {
        const v = vertsA[k]!;
        const p = (ax + v.x * scaleA) * nx + (ay + v.y * scaleA) * ny;
        if (p < minA) minA = p;
        if (p > maxA) maxA = p;
      }

      let minB = Infinity;
      let maxB = -Infinity;
      for (let k = 0; k < vertsB.length; k++) {
        const v = vertsB[k]!;
        const p = (bx + v.x * scaleB) * nx + (by + v.y * scaleB) * ny;
        if (p < minB) minB = p;
        if (p > maxB) maxB = p;
      }

      const overlap =
        Math.min(maxA + halfGap, maxB + halfGap) -
        Math.max(minA - halfGap, minB - halfGap);
      if (overlap <= 0) return false;
      if (overlap < minOverlap) {
        minOverlap = overlap;
        bestNx = nx;
        bestNy = ny;
      }
    }
    return true;
  };

  if (!checkAxes(vertsA)) return null;
  if (!checkAxes(vertsB)) return null;

  // Ensure normal points from B toward A (so adding mtv * depth pushes A away from B)
  const dirX = ax - bx;
  const dirY = ay - by;
  if (dirX * bestNx + dirY * bestNy < 0) {
    bestNx = -bestNx;
    bestNy = -bestNy;
  }

  return { nx: bestNx, ny: bestNy, depth: minOverlap };
}

function satCirclePolygon(
  cx: number,
  cy: number,
  radius: number,
  verts: readonly Point2D[],
  px: number,
  py: number,
  polyScale: number,
  gap: number,
): MtvResult | null {
  const effectiveR = radius + gap;
  let minOverlap = Infinity;
  let bestNx = 1;
  let bestNy = 0;

  // 1. Edge normals of the polygon
  const n = verts.length;
  let closestVertX = px;
  let closestVertY = py;
  let closestDistSq = Infinity;

  for (let i = 0; i < n; i++) {
    const v1 = verts[i]!;
    const v2 = verts[(i + 1) % n]!;
    const w1x = px + v1.x * polyScale;
    const w1y = py + v1.y * polyScale;
    const w2x = px + v2.x * polyScale;
    const w2y = py + v2.y * polyScale;

    const dSq = (cx - w1x) * (cx - w1x) + (cy - w1y) * (cy - w1y);
    if (dSq < closestDistSq) {
      closestDistSq = dSq;
      closestVertX = w1x;
      closestVertY = w1y;
    }

    const ex = w2x - w1x;
    const ey = w2y - w1y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const nx = ey / len;
    const ny = -ex / len;

    const projC = cx * nx + cy * ny;
    const [minP, maxP] = projectPolygon(verts, px, py, polyScale, nx, ny);
    const overlap = Math.min(projC + effectiveR, maxP) - Math.max(projC - effectiveR, minP);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestNx = nx;
      bestNy = ny;
    }
  }

  // 2. Voronoi vertex axis from closest polygon vertex to circle center
  const vx = cx - closestVertX;
  const vy = cy - closestVertY;
  const vLen = Math.hypot(vx, vy);
  if (vLen > 1e-9) {
    const nx = vx / vLen;
    const ny = vy / vLen;
    const projC = cx * nx + cy * ny;
    const [minP, maxP] = projectPolygon(verts, px, py, polyScale, nx, ny);
    const overlap = Math.min(projC + effectiveR, maxP) - Math.max(projC - effectiveR, minP);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestNx = nx;
      bestNy = ny;
    }
  }

  const dirX = cx - px;
  const dirY = cy - py;
  if (dirX * bestNx + dirY * bestNy < 0) {
    bestNx = -bestNx;
    bestNy = -bestNy;
  }

  return { nx: bestNx, ny: bestNy, depth: minOverlap };
}

/**
 * Exact 2D Minimum Translation Vector (MTV) computation for any pair of `ConvexGeometry` hulls
 * using circle-circle analytics or Separating Axis Theorem (SAT) with optional minimum `gap` separation.
 *
 * Returns `null` when the two geometries are disjoint (separated by at least `gap`), or an MTV
 * pushing geometry `A` away from geometry `B`.
 */
export function computeConvexMtv(
  hullA: ConvexGeometry,
  ax: number,
  ay: number,
  scaleA: number,
  hullB: ConvexGeometry,
  bx: number,
  by: number,
  scaleB: number,
  gap = 0,
): MtvResult | null {
  const dx = ax - bx;
  const dy = ay - by;

  if (hullA.kind === 'circle' && hullB.kind === 'circle') {
    const minDist = hullA.radius * scaleA + hullB.radius * scaleB + gap;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) return null;
    const dist = Math.sqrt(distSq);
    if (dist < 1e-9) {
      return { nx: 1, ny: 0, depth: minDist };
    }
    return { nx: dx / dist, ny: dy / dist, depth: minDist - dist };
  }

  // Exact bounding-radius broad-phase reject via triangle inequality around (0, 0)
  const maxSep =
    getHullBoundingRadius(hullA) * scaleA +
    getHullBoundingRadius(hullB) * scaleB +
    gap;
  if (dx * dx + dy * dy >= maxSep * maxSep) {
    return null;
  }

  if (hullA.kind === 'circle' && hullB.kind === 'polygon') {
    return satCirclePolygon(
      ax,
      ay,
      hullA.radius * scaleA,
      hullB.vertices,
      bx,
      by,
      scaleB,
      gap,
    );
  }

  if (hullA.kind === 'polygon' && hullB.kind === 'circle') {
    const res = satCirclePolygon(
      bx,
      by,
      hullB.radius * scaleB,
      hullA.vertices,
      ax,
      ay,
      scaleA,
      gap,
    );
    if (!res) return null;
    // Flip direction because satCirclePolygon returned normal pushing B away from A
    return { nx: -res.nx, ny: -res.ny, depth: res.depth };
  }

  if (hullA.kind === 'polygon' && hullB.kind === 'polygon') {
    return satPolygonPolygon(
      hullA.vertices,
      ax,
      ay,
      scaleA,
      hullB.vertices,
      bx,
      by,
      scaleB,
      gap,
    );
  }

  return null;
}

/**
 * Uniform spatial hash grid accelerating 2D broad-phase collision queries.
 */
export class UniformSpatialHashGrid {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cells = new Map<number, number[]>();
  private seenStamp = new Int32Array(256);
  private epoch = 0;

  constructor(cellSize: number) {
    this.cellSize = Math.max(16, cellSize);
    this.invCellSize = 1 / this.cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  private hashKey(gx: number, gy: number): number {
    // Shift coordinates to avoid negative collisions in 32-bit packing
    const sx = (gx + 16384) & 0xffff;
    const sy = (gy + 16384) & 0xffff;
    return (sx << 16) | sy;
  }

  insert(id: number, bbox: BoundingBox2D, padding = 0): void {
    const minCx = Math.floor((bbox.minX - padding) * this.invCellSize);
    const maxCx = Math.floor((bbox.maxX + padding) * this.invCellSize);
    const minCy = Math.floor((bbox.minY - padding) * this.invCellSize);
    const maxCy = Math.floor((bbox.maxY + padding) * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.hashKey(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(id);
      }
    }
  }

  query(bbox: BoundingBox2D, padding = 0, out?: number[]): number[] {
    const minCx = Math.floor((bbox.minX - padding) * this.invCellSize);
    const maxCx = Math.floor((bbox.maxX + padding) * this.invCellSize);
    const minCy = Math.floor((bbox.minY - padding) * this.invCellSize);
    const maxCy = Math.floor((bbox.maxY + padding) * this.invCellSize);

    this.epoch++;
    if (this.epoch >= 0x7fffffff) {
      this.seenStamp.fill(0);
      this.epoch = 1;
    }
    const stamp = this.epoch;
    const results = out ?? [];
    results.length = 0;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.hashKey(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i]!;
          if (id >= this.seenStamp.length) {
            const next = new Int32Array(Math.max(id + 64, this.seenStamp.length * 2));
            next.set(this.seenStamp);
            this.seenStamp = next;
          }
          if (this.seenStamp[id] !== stamp) {
            this.seenStamp[id] = stamp;
            results.push(id);
          }
        }
      }
    }
    return results;
  }
}
