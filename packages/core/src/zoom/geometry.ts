import type { Point2D, SimplexMesh } from '../types.js';
import type { ViewportAffineTransform } from './types.js';

export function scaleAndCenterPointsToViewport(
  points: readonly Point2D[],
  viewportWidth: number,
  viewportHeight: number,
  innerPadding: number,
): {
  readonly scaled: Point2D[];
  readonly scale: number;
  readonly transform: ViewportAffineTransform;
} {
  if (points.length === 0) {
    return {
      scaled: [],
      scale: 1,
      transform: {
        scale: 1,
        sourceCx: 0,
        sourceCy: 0,
        targetCx: viewportWidth * 0.5,
        targetCy: viewportHeight * 0.5,
        apply: (pt) => pt,
      },
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const usableW = Math.max(80, viewportWidth - innerPadding * 2);
  const usableH = Math.max(80, viewportHeight - innerPadding * 2);
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  const scale = Math.min(usableW / spanX, usableH / spanY);

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const targetCx = viewportWidth * 0.5;
  const targetCy = viewportHeight * 0.5;

  const apply = (pt: Point2D): Point2D => ({
    x: targetCx + (pt.x - cx) * scale,
    y: targetCy + (pt.y - cy) * scale,
  });

  const scaled = points.map(apply);
  return {
    scaled,
    scale,
    transform: {
      scale,
      sourceCx: cx,
      sourceCy: cy,
      targetCx,
      targetCy,
      apply,
    },
  };
}

export function computeContextAwarePadding(
  viewportWidth: number,
  viewportHeight: number,
  basePadding: number,
  hasSurroundingContext: boolean,
): number {
  if (!hasSurroundingContext) return basePadding;
  const minDim = Math.min(viewportWidth, viewportHeight);
  return Math.round(
    Math.min(Math.max(basePadding, minDim * 0.14), minDim * 0.24),
  );
}

export function buildSubdividedTriangleMeshWithTransform(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  viewportWidth: number,
  viewportHeight: number,
  innerPadding = 64,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): {
  readonly mesh: SimplexMesh;
  readonly transform: ViewportAffineTransform;
} {
  const m01 = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
  const m12 = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
  const m20 = { x: (p2.x + p0.x) * 0.5, y: (p2.y + p0.y) * 0.5 };

  const { scaled, transform } = scaleAndCenterPointsToViewport(
    [p0, p1, p2, m01, m12, m20],
    viewportWidth,
    viewportHeight,
    innerPadding,
  );

  const neighbors: readonly (readonly number[])[] = [
    [3, 5],
    [3, 4],
    [4, 5],
    [0, 1, 4, 5],
    [1, 2, 3, 5],
    [0, 2, 3, 4],
  ];

  const rows = [0, 1, 1, 0, 1, 0];
  const cols = [0, 0, 1, 1, 2, 2];

  const vertices = scaled.map((pt, idx) => ({
    index: idx,
    row: rows[idx]!,
    col: cols[idx]!,
    x: pt.x,
    y: pt.y,
    neighbors: neighbors[idx]!,
  }));

  const edges = [
    { a: 0, b: 3 },
    { a: 3, b: 1 },
    { a: 1, b: 4 },
    { a: 4, b: 2 },
    { a: 2, b: 5 },
    { a: 5, b: 0 },
    { a: 3, b: 4 },
    { a: 4, b: 5 },
    { a: 5, b: 3 },
  ];

  const triangles = [
    { index: 0, vertices: [0, 3, 5] as const },
    { index: 1, vertices: [3, 1, 4] as const },
    { index: 2, vertices: [5, 4, 2] as const },
    { index: 3, vertices: [4, 5, 3] as const },
  ];

  const sideLength = Math.hypot(
    scaled[3]!.x - scaled[0]!.x,
    scaled[3]!.y - scaled[0]!.y,
  );

  return {
    mesh: {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength,
      orientation,
      wideFirst: true,
      areaEfficiency: 0.72,
      vertices,
      edges,
      triangles,
    },
    transform,
  };
}

/**
 * Builds a zoomed, viewport-centered 6-vertex, 9-edge, 4-triangle `1:4` equilateral
 * subdivision mesh preserving exact parent ▲/▼/▶/◀ orientation.
 *
 * Vertex layout:
 * - `0, 1, 2`: parent corners `(p0, p1, p2)`
 * - `3`: midpoint `(p0 + p1) / 2`
 * - `4`: midpoint `(p1 + p2) / 2`
 * - `5`: midpoint `(p2 + p0) / 2`
 */
export function buildSubdividedTriangleMesh(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  viewportWidth: number,
  viewportHeight: number,
  innerPadding = 64,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): SimplexMesh {
  return buildSubdividedTriangleMeshWithTransform(
    p0,
    p1,
    p2,
    viewportWidth,
    viewportHeight,
    innerPadding,
    orientation,
  ).mesh;
}

/**
 * Extracts the 1-ring star sub-mesh of all triangles incident to `centerVertexIdx`,
 * scaled cleanly into the viewport while preserving exact 60-degree geometry.
 */
export function buildIncidentStarMesh(
  parentMesh: SimplexMesh,
  centerVertexIdx: number,
  viewportWidth: number,
  viewportHeight: number,
  innerPadding = 64,
): {
  readonly mesh: SimplexMesh;
  readonly newToOldVertex: readonly number[];
  readonly oldToNewVertex: ReadonlyMap<number, number>;
  readonly transform: ViewportAffineTransform;
} | null {
  const incidentTris = parentMesh.triangles.filter((t) =>
    t.vertices.includes(centerVertexIdx),
  );
  if (incidentTris.length === 0) return null;

  const newToOldVertex: number[] = [centerVertexIdx];
  const oldToNewVertex = new Map<number, number>([[centerVertexIdx, 0]]);
  for (const tri of incidentTris) {
    for (const v of tri.vertices) {
      if (!oldToNewVertex.has(v)) {
        oldToNewVertex.set(v, newToOldVertex.length);
        newToOldVertex.push(v);
      }
    }
  }

  const rawPoints = newToOldVertex.map((oldIdx) => {
    const pv = parentMesh.vertices[oldIdx]!;
    return { x: pv.x, y: pv.y };
  });

  const { scaled, scale, transform } = scaleAndCenterPointsToViewport(
    rawPoints,
    viewportWidth,
    viewportHeight,
    innerPadding,
  );

  const edgeSet = new Set<string>();
  const edges: { a: number; b: number }[] = [];
  const adj: Set<number>[] = newToOldVertex.map(() => new Set<number>());

  const triangles = incidentTris.map((tri, newTriIdx) => {
    const [a, b, c] = tri.vertices;
    const na = oldToNewVertex.get(a)!;
    const nb = oldToNewVertex.get(b)!;
    const nc = oldToNewVertex.get(c)!;
    const pairs: readonly [number, number][] = [
      [na, nb],
      [nb, nc],
      [nc, na],
    ];
    for (const [u, v] of pairs) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = `${lo}:${hi}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ a: lo, b: hi });
      }
      adj[u]!.add(v);
      adj[v]!.add(u);
    }
    return {
      index: newTriIdx,
      vertices: [na, nb, nc] as const,
    };
  });

  const vertices = scaled.map((pt, idx) => {
    const oldV = parentMesh.vertices[newToOldVertex[idx]!]!;
    return {
      index: idx,
      row: oldV.row,
      col: oldV.col,
      x: pt.x,
      y: pt.y,
      neighbors: [...adj[idx]!].sort((x, y) => x - y),
    };
  });

  return {
    mesh: {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength: parentMesh.sideLength * scale,
      orientation: parentMesh.orientation,
      wideFirst: parentMesh.wideFirst,
      areaEfficiency: parentMesh.areaEfficiency,
      vertices,
      edges,
      triangles,
    },
    newToOldVertex,
    oldToNewVertex,
    transform,
  };
}

export function buildOrientedSingleTriangleMeshWithTransform(params: {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly innerPadding?: number;
  readonly sourceTrianglePoints?: readonly [Point2D, Point2D, Point2D];
  readonly orientation?: 'horizontal' | 'vertical';
  readonly sourceCenter?: Point2D;
  readonly sourceSpan?: number;
}): {
  readonly mesh: SimplexMesh;
  readonly transform: ViewportAffineTransform;
} {
  const {
    viewportWidth,
    viewportHeight,
    innerPadding = 68,
    sourceTrianglePoints,
    orientation = 'horizontal',
    sourceCenter,
    sourceSpan,
  } = params;

  if (sourceTrianglePoints) {
    const [q0, q1, q2] = sourceTrianglePoints;
    const { scaled, transform } = scaleAndCenterPointsToViewport(
      [q0, q1, q2],
      viewportWidth,
      viewportHeight,
      innerPadding,
    );
    const s0 = scaled[0]!;
    const s1 = scaled[1]!;
    const s2 = scaled[2]!;
    const sideLength = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    return {
      mesh: {
        width: viewportWidth,
        height: viewportHeight,
        innerPadding,
        sideLength,
        orientation,
        wideFirst: true,
        areaEfficiency: 0.5,
        vertices: [
          { index: 0, row: 0, col: 0, x: s0.x, y: s0.y, neighbors: [1, 2] },
          { index: 1, row: 1, col: 0, x: s1.x, y: s1.y, neighbors: [0, 2] },
          { index: 2, row: 1, col: 1, x: s2.x, y: s2.y, neighbors: [0, 1] },
        ],
        edges: [
          { a: 0, b: 1 },
          { a: 1, b: 2 },
          { a: 2, b: 0 },
        ],
        triangles: [{ index: 0, vertices: [0, 1, 2] as const }],
      },
      transform,
    };
  }

  const usableW = Math.max(120, viewportWidth - innerPadding * 2);
  const usableH = Math.max(120, viewportHeight - innerPadding * 2);
  const s =
    orientation === 'vertical'
      ? Math.min(usableH, (usableW * 2) / Math.sqrt(3))
      : Math.min(usableW, (usableH * 2) / Math.sqrt(3));
  const h = (s * Math.sqrt(3)) / 2;
  const cx = viewportWidth * 0.5;
  const cy = viewportHeight * 0.5;

  const p0 =
    orientation === 'vertical'
      ? { x: cx - h * 0.5, y: cy - s * 0.5 }
      : { x: cx, y: cy - h * 0.5 };
  const p1 =
    orientation === 'vertical'
      ? { x: cx - h * 0.5, y: cy + s * 0.5 }
      : { x: cx - s * 0.5, y: cy + h * 0.5 };
  const p2 =
    orientation === 'vertical'
      ? { x: cx + h * 0.5, y: cy }
      : { x: cx + s * 0.5, y: cy + h * 0.5 };

  const scale =
    sourceSpan && sourceSpan > 1 ? Math.max(1.35, s / sourceSpan) : 2.0;
  const srcCx = sourceCenter?.x ?? cx;
  const srcCy = sourceCenter?.y ?? cy;

  return {
    mesh: {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength: s,
      orientation,
      wideFirst: true,
      areaEfficiency: 0.5,
      vertices: [
        { index: 0, row: 0, col: 0, x: p0.x, y: p0.y, neighbors: [1, 2] },
        { index: 1, row: 1, col: 0, x: p1.x, y: p1.y, neighbors: [0, 2] },
        { index: 2, row: 1, col: 1, x: p2.x, y: p2.y, neighbors: [0, 1] },
      ],
      edges: [
        { a: 0, b: 1 },
        { a: 1, b: 2 },
        { a: 2, b: 0 },
      ],
      triangles: [{ index: 0, vertices: [0, 1, 2] as const }],
    },
    transform: {
      scale,
      sourceCx: srcCx,
      sourceCy: srcCy,
      targetCx: cx,
      targetCy: cy,
      apply: (pt: Point2D) => ({
        x: cx + (pt.x - srcCx) * scale,
        y: cy + (pt.y - srcCy) * scale,
      }),
    },
  };
}

export function bboxOverlapsViewport(
  pts: readonly Point2D[],
  vw: number,
  vh: number,
  marginFactor = 0.55,
): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return (
    maxX >= -vw * marginFactor &&
    minX <= vw * (1 + marginFactor) &&
    maxY >= -vh * marginFactor &&
    minY <= vh * (1 + marginFactor)
  );
}

export function pointNearViewport(
  pt: Point2D,
  vw: number,
  vh: number,
  marginFactor = 0.95,
): boolean {
  return (
    pt.x >= -vw * marginFactor &&
    pt.x <= vw * (1 + marginFactor) &&
    pt.y >= -vh * marginFactor &&
    pt.y <= vh * (1 + marginFactor)
  );
}
