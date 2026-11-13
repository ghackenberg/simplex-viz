import type { MeshEdge, MeshOptions, MeshTriangle, MeshVertex, SimplexMesh } from './types';

const SQRT3_OVER_2 = Math.sqrt(3) / 2;

interface MeshCandidate {
  readonly cols: number;
  readonly rows: number;
  readonly orientation: 'horizontal' | 'vertical';
  readonly wideFirst: boolean;
  readonly sideLength: number;
  readonly vertexCount: number;
  readonly areaEfficiency: number;
  readonly intervalPenalty: number;
}

function countLatticeVertices(cols: number, rows: number, wideFirst: boolean): number {
  let count = 0;
  for (let r = 0; r < rows; r++) {
    const isWide = wideFirst ? r % 2 === 0 : r % 2 === 1;
    count += isWide ? cols : cols - 1;
  }
  return count;
}

function buildLatticeNodes(
  cols: number,
  rows: number,
  sideLength: number,
  orientation: 'horizontal' | 'vertical',
  wideFirst: boolean,
  viewportWidth: number,
  viewportHeight: number,
): {
  readonly vertices: MeshVertex[];
  readonly edges: MeshEdge[];
  readonly triangles: MeshTriangle[];
} {
  const rowStep = sideLength * SQRT3_OVER_2;
  const rawNodes: { row: number; col: number; x: number; y: number }[] = [];
  const indexByRowCol = new Map<string, number>();

  for (let r = 0; r < rows; r++) {
    const isWide = wideFirst ? r % 2 === 0 : r % 2 === 1;
    const countInRow = isWide ? cols : cols - 1;
    const xOffset = isWide ? 0 : sideLength * 0.5;
    for (let c = 0; c < countInRow; c++) {
      const px = xOffset + c * sideLength;
      const py = r * rowStep;
      const x = orientation === 'horizontal' ? px : py;
      const y = orientation === 'horizontal' ? py : px;
      const idx = rawNodes.length;
      rawNodes.push({ row: r, col: c, x, y });
      indexByRowCol.set(`${r}:${c}`, idx);
    }
  }

  // Center symmetrically in viewport
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of rawNodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const shiftX = viewportWidth / 2 - (minX + maxX) / 2;
  const shiftY = viewportHeight / 2 - (minY + maxY) / 2;

  const centeredNodes = rawNodes.map((n) => ({
    row: n.row,
    col: n.col,
    x: n.x + shiftX,
    y: n.y + shiftY,
  }));

  // Direct lattice triangulation over adjacent rows (every triangle is strictly equilateral 60°)
  const triangles: MeshTriangle[] = [];
  const edgeSet = new Set<string>();
  const edges: MeshEdge[] = [];
  const neighborSets: Set<number>[] = Array.from(
    { length: centeredNodes.length },
    () => new Set<number>(),
  );

  const addEdge = (u: number, v: number) => {
    const a = Math.min(u, v);
    const b = Math.max(u, v);
    const key = `${a}:${b}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ a, b });
      neighborSets[a]?.add(b);
      neighborSets[b]?.add(a);
    }
  };

  const addTriangle = (a: number, b: number, c: number) => {
    triangles.push({ index: triangles.length, vertices: [a, b, c] });
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  };

  for (let r = 0; r < rows - 1; r++) {
    const topWide = wideFirst ? r % 2 === 0 : r % 2 === 1;
    const topCount = topWide ? cols : cols - 1;
    const botCount = topWide ? cols - 1 : cols;

    if (topWide) {
      // Top row has `cols` points, bottom row has `cols - 1` points shifted +0.5*s
      for (let c = 0; c < botCount; c++) {
        const tl = indexByRowCol.get(`${r}:${c}`);
        const tr = indexByRowCol.get(`${r}:${c + 1}`);
        const bm = indexByRowCol.get(`${r + 1}:${c}`);
        if (tl !== undefined && tr !== undefined && bm !== undefined) {
          addTriangle(tl, tr, bm);
        }
        if (c + 1 < botCount) {
          const bmNext = indexByRowCol.get(`${r + 1}:${c + 1}`);
          if (tr !== undefined && bm !== undefined && bmNext !== undefined) {
            addTriangle(tr, bmNext, bm);
          }
        }
      }
    } else {
      // Top row has `cols - 1` points shifted +0.5*s, bottom row has `cols` points
      for (let c = 0; c < topCount; c++) {
        const tm = indexByRowCol.get(`${r}:${c}`);
        const bl = indexByRowCol.get(`${r + 1}:${c}`);
        const br = indexByRowCol.get(`${r + 1}:${c + 1}`);
        if (tm !== undefined && bl !== undefined && br !== undefined) {
          addTriangle(tm, br, bl);
        }
        if (c + 1 < topCount) {
          const tmNext = indexByRowCol.get(`${r}:${c + 1}`);
          if (tm !== undefined && tmNext !== undefined && br !== undefined) {
            addTriangle(tm, tmNext, br);
          }
        }
      }
    }
  }

  // Fallback edge linking if degenerate 1-row grid
  if (edges.length === 0 && centeredNodes.length >= 2) {
    for (let i = 0; i < centeredNodes.length - 1; i++) {
      addEdge(i, i + 1);
    }
  }

  const vertices: MeshVertex[] = centeredNodes.map((n, index) => ({
    index,
    row: n.row,
    col: n.col,
    x: n.x,
    y: n.y,
    neighbors: [...(neighborSets[index] ?? [])].sort((a, b) => a - b),
  }));

  return { vertices, edges, triangles };
}

/**
 * Generates an optimal toothed 60-degree equilateral triangle simplex mesh inside `(width, height)`.
 *
 * Evaluates both `0°` (horizontal) and `90°` (vertical) orientations as well as both row parities
 * (`wideFirst = true | false`) to maximize usable area efficiency within `[minSideLength, maxSideLength]`.
 */
export function buildSimplexMesh(
  viewportWidth: number,
  viewportHeight: number,
  tagCount: number,
  options: MeshOptions = {},
): SimplexMesh {
  const innerPadding = options.innerPadding ?? 48;
  const minSide = options.minSideLength ?? 130;
  const maxSide = options.maxSideLength ?? 290;
  const maxClusters = options.maxClusters ?? 12;

  const usableW = Math.max(80, viewportWidth - 2 * innerPadding);
  const usableH = Math.max(80, viewportHeight - 2 * innerPadding);
  const targetMaxK = Math.max(3, Math.min(maxClusters, Math.max(3, tagCount)));

  const candidates: MeshCandidate[] = [];
  const orientations: readonly ('horizontal' | 'vertical')[] = ['horizontal', 'vertical'];
  const parities: readonly boolean[] = [true, false];

  for (const orientation of orientations) {
    for (const wideFirst of parities) {
      for (let cols = 2; cols <= 8; cols++) {
        for (let rows = 2; rows <= 8; rows++) {
          const k = countLatticeVertices(cols, rows, wideFirst);
          if (k < 3 || k > targetMaxK) continue;

          // Physical span in unscaled sideLength = 1 units:
          // Horizontal span: (cols - 1), vertical span: (rows - 1) * sqrt(3)/2
          const spanAlongCols = Math.max(0.5, cols - 1);
          const spanAlongRows = Math.max(0.5, (rows - 1) * SQRT3_OVER_2);

          const rawW = orientation === 'horizontal' ? spanAlongCols : spanAlongRows;
          const rawH = orientation === 'horizontal' ? spanAlongRows : spanAlongCols;

          const sFit = Math.min(usableW / rawW, usableH / rawH);
          const clampedS = Math.min(sFit, maxSide);
          const meshArea = rawW * clampedS * (rawH * clampedS);
          const areaEfficiency = meshArea / (usableW * usableH);

          let intervalPenalty = 0;
          if (sFit < minSide) {
            intervalPenalty = minSide - sFit;
          } else if (sFit > maxSide) {
            intervalPenalty = sFit - maxSide;
          }

          candidates.push({
            cols,
            rows,
            orientation,
            wideFirst,
            sideLength: Math.max(40, sFit),
            vertexCount: k,
            areaEfficiency,
            intervalPenalty,
          });
        }
      }
    }
  }

  // Fallback minimal 3-vertex equilateral triangle if no candidate matched
  if (candidates.length === 0) {
    const s = Math.min(usableW, usableH / SQRT3_OVER_2, maxSide);
    const { vertices, edges, triangles } = buildLatticeNodes(
      2,
      2,
      s,
      'horizontal',
      true,
      viewportWidth,
      viewportHeight,
    );
    return {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength: s,
      orientation: 'horizontal',
      wideFirst: true,
      areaEfficiency: (s * s * SQRT3_OVER_2) / (usableW * usableH),
      vertices,
      edges,
      triangles,
    };
  }

  // Prefer candidates strictly inside [minSide, maxSide] with highest area utilization (and rich K);
  // fallback to smallest interval penalty if viewport is extreme.
  const inInterval = candidates.filter((c) => c.intervalPenalty === 0);
  let chosen: MeshCandidate;
  if (inInterval.length > 0) {
    inInterval.sort((a, b) => {
      const scoreA = a.areaEfficiency + a.vertexCount * 0.018;
      const scoreB = b.areaEfficiency + b.vertexCount * 0.018;
      return scoreB - scoreA;
    });
    chosen = inInterval[0]!;
  } else {
    candidates.sort((a, b) => {
      if (Math.abs(a.intervalPenalty - b.intervalPenalty) > 1e-6) {
        return a.intervalPenalty - b.intervalPenalty;
      }
      return b.areaEfficiency - a.areaEfficiency;
    });
    chosen = candidates[0]!;
  }

  const effectiveS =
    chosen.intervalPenalty === 0
      ? chosen.sideLength
      : Math.max(40, Math.min(chosen.sideLength, maxSide));

  const { vertices, edges, triangles } = buildLatticeNodes(
    chosen.cols,
    chosen.rows,
    effectiveS,
    chosen.orientation,
    chosen.wideFirst,
    viewportWidth,
    viewportHeight,
  );

  return {
    width: viewportWidth,
    height: viewportHeight,
    innerPadding,
    sideLength: effectiveS,
    orientation: chosen.orientation,
    wideFirst: chosen.wideFirst,
    areaEfficiency: chosen.areaEfficiency,
    vertices,
    edges,
    triangles,
  };
}
