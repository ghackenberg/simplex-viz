import type { MeshEdge, MeshOptions, MeshTriangle, MeshVertex, SimplexMesh } from './types.js';

const SQRT3_OVER_2 = Math.sqrt(3) / 2;

interface MeshCandidate {
  readonly cols: number;
  readonly rows: number;
  readonly orientation: 'horizontal' | 'vertical';
  readonly wideFirst: boolean;
  readonly sideLength: number;
  readonly vertexCount: number;
  readonly areaEfficiency: number;
  readonly aspectAlignment: number;
  readonly minSidePenalty: number;
}

/**
 * Computes an adaptive outer margin (`32 px` on compact mobile viewports up to `48 px` on desktop)
 * so small screens retain maximum usable triangle area without clipping outer cluster badges.
 */
export function resolveDefaultInnerPadding(
  viewportWidth: number,
  viewportHeight: number,
): number {
  const minDim = Math.max(0, Math.min(viewportWidth, viewportHeight));
  return Math.round(Math.max(32, Math.min(48, minDim * 0.09)));
}

function countLatticeVertices(cols: number, rows: number, wideFirst: boolean): number {
  let count = 0;
  for (let r = 0; r < rows; r++) {
    const isWide = wideFirst ? r % 2 === 0 : r % 2 === 1;
    count += isWide ? cols : cols - 1;
  }
  return count;
}

export function buildSimplexLattice(
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
 * (`wideFirst = true | false`) to maximize usable canvas area and aspect-ratio alignment across
 * widescreen, square, and mobile portrait viewports while respecting `minSideLength` and optional `maxSideLength`.
 */
export function buildSimplexMesh(
  viewportWidth: number,
  viewportHeight: number,
  tagCount: number,
  options: MeshOptions = {},
): SimplexMesh {
  const innerPadding =
    options.innerPadding ?? resolveDefaultInnerPadding(viewportWidth, viewportHeight);
  const minSide = options.minSideLength ?? 130;
  const maxSide =
    options.maxSideLength !== undefined && Number.isFinite(options.maxSideLength)
      ? Math.max(40, options.maxSideLength)
      : Number.POSITIVE_INFINITY;
  const maxClusters = options.maxClusters ?? 14;
  const explicitSide =
    options.sideLength !== undefined && Number.isFinite(options.sideLength)
      ? Math.max(40, options.sideLength)
      : undefined;

  const usableW = Math.max(80, viewportWidth - 2 * innerPadding);
  const usableH = Math.max(80, viewportHeight - 2 * innerPadding);
  const viewAspect = usableW / usableH;
  const targetMaxK = Math.max(3, Math.min(maxClusters, Math.max(3, tagCount)));

  const orientations: readonly ('horizontal' | 'vertical')[] = ['horizontal', 'vertical'];
  const parities: readonly boolean[] = [true, false];

  if (explicitSide !== undefined) {
    interface ExplicitCandidate {
      readonly cols: number;
      readonly rows: number;
      readonly orientation: 'horizontal' | 'vertical';
      readonly wideFirst: boolean;
      readonly vertexCount: number;
      readonly spanW: number;
      readonly spanH: number;
      readonly areaEfficiency: number;
      readonly aspectAlignment: number;
    }

    const fitting: ExplicitCandidate[] = [];
    for (const orientation of orientations) {
      for (const wideFirst of parities) {
        for (let cols = 2; cols <= 10; cols++) {
          for (let rows = 2; rows <= 10; rows++) {
            const k = countLatticeVertices(cols, rows, wideFirst);
            if (k < 3 || k > targetMaxK) continue;

            const spanAlongCols = Math.max(0.5, cols - 1);
            const spanAlongRows = Math.max(0.5, (rows - 1) * SQRT3_OVER_2);
            const rawW = orientation === 'horizontal' ? spanAlongCols : spanAlongRows;
            const rawH = orientation === 'horizontal' ? spanAlongRows : spanAlongCols;
            const spanW = rawW * explicitSide;
            const spanH = rawH * explicitSide;
            const gridAspect = rawW / rawH;
            const aspectAlignment =
              Math.min(gridAspect, viewAspect) / Math.max(gridAspect, viewAspect);

            if (spanW <= usableW + 1e-6 && spanH <= usableH + 1e-6) {
              fitting.push({
                cols,
                rows,
                orientation,
                wideFirst,
                vertexCount: k,
                spanW,
                spanH,
                areaEfficiency: (spanW * spanH) / (usableW * usableH),
                aspectAlignment,
              });
            }
          }
        }
      }
    }

    if (fitting.length > 0) {
      const maxFittingK = fitting.reduce(
        (acc, c) => Math.max(acc, c.vertexCount),
        3,
      );
      fitting.sort((a, b) => {
        const scoreA =
          a.areaEfficiency +
          a.aspectAlignment * 0.12 +
          (a.vertexCount / maxFittingK) * 0.18;
        const scoreB =
          b.areaEfficiency +
          b.aspectAlignment * 0.12 +
          (b.vertexCount / maxFittingK) * 0.18;
        return scoreB - scoreA;
      });
      const pick = fitting[0]!;
      const { vertices, edges, triangles } = buildSimplexLattice(
        pick.cols,
        pick.rows,
        explicitSide,
        pick.orientation,
        pick.wideFirst,
        viewportWidth,
        viewportHeight,
      );
      return {
        width: viewportWidth,
        height: viewportHeight,
        innerPadding,
        sideLength: explicitSide,
        orientation: pick.orientation,
        wideFirst: pick.wideFirst,
        areaEfficiency: pick.areaEfficiency,
        vertices,
        edges,
        triangles,
      };
    }

    // Requested explicitSide is larger than even a single K=3 triangle inside viewport:
    // keep exact equilateral sideLength and expand world bounds cleanly for camera pan/zoom.
    const fallbackOrientation: 'horizontal' | 'vertical' =
      usableW >= usableH ? 'horizontal' : 'vertical';
    const rawW = fallbackOrientation === 'horizontal' ? 1 : SQRT3_OVER_2;
    const rawH = fallbackOrientation === 'horizontal' ? SQRT3_OVER_2 : 1;
    const spanW = rawW * explicitSide;
    const spanH = rawH * explicitSide;
    const worldW = Math.max(viewportWidth, Math.ceil(spanW + 2 * innerPadding));
    const worldH = Math.max(viewportHeight, Math.ceil(spanH + 2 * innerPadding));
    const effUsableW = Math.max(80, worldW - 2 * innerPadding);
    const effUsableH = Math.max(80, worldH - 2 * innerPadding);
    const { vertices, edges, triangles } = buildSimplexLattice(
      2,
      2,
      explicitSide,
      fallbackOrientation,
      true,
      worldW,
      worldH,
    );
    return {
      width: worldW,
      height: worldH,
      innerPadding,
      sideLength: explicitSide,
      orientation: fallbackOrientation,
      wideFirst: true,
      areaEfficiency: Math.min(1, (spanW * spanH) / (effUsableW * effUsableH)),
      vertices,
      edges,
      triangles,
    };
  }

  const candidates: MeshCandidate[] = [];

  for (const orientation of orientations) {
    for (const wideFirst of parities) {
      for (let cols = 2; cols <= 10; cols++) {
        for (let rows = 2; rows <= 10; rows++) {
          const k = countLatticeVertices(cols, rows, wideFirst);
          if (k < 3 || k > targetMaxK) continue;

          // Physical span in unscaled sideLength = 1 units:
          // Primary axis span: (cols - 1), perpendicular axis span: (rows - 1) * sqrt(3)/2
          const spanAlongCols = Math.max(0.5, cols - 1);
          const spanAlongRows = Math.max(0.5, (rows - 1) * SQRT3_OVER_2);

          const rawW = orientation === 'horizontal' ? spanAlongCols : spanAlongRows;
          const rawH = orientation === 'horizontal' ? spanAlongRows : spanAlongCols;

          const sFit = Math.min(usableW / rawW, usableH / rawH);
          const effectiveS = Math.max(40, Math.min(sFit, maxSide));
          const meshArea = rawW * effectiveS * (rawH * effectiveS);
          const areaEfficiency = Math.min(1, meshArea / (usableW * usableH));
          const gridAspect = rawW / rawH;
          const aspectAlignment =
            Math.min(gridAspect, viewAspect) / Math.max(gridAspect, viewAspect);

          // Only penalize candidates whose triangles would shrink below minSideLength;
          // an optional maxSideLength acts purely as a side-length cap, never a penalty.
          const minSidePenalty = sFit < minSide ? minSide - sFit : 0;

          candidates.push({
            cols,
            rows,
            orientation,
            wideFirst,
            sideLength: effectiveS,
            vertexCount: k,
            areaEfficiency,
            aspectAlignment,
            minSidePenalty,
          });
        }
      }
    }
  }

  // Fallback minimal 3-vertex equilateral triangle if no candidate matched
  if (candidates.length === 0) {
    const fallbackOrientation: 'horizontal' | 'vertical' =
      usableW >= usableH ? 'horizontal' : 'vertical';
    const rawW = fallbackOrientation === 'horizontal' ? 1 : SQRT3_OVER_2;
    const rawH = fallbackOrientation === 'horizontal' ? SQRT3_OVER_2 : 1;
    const s = Math.max(40, Math.min(usableW / rawW, usableH / rawH, maxSide));
    const { vertices, edges, triangles } = buildSimplexLattice(
      2,
      2,
      s,
      fallbackOrientation,
      true,
      viewportWidth,
      viewportHeight,
    );
    return {
      width: viewportWidth,
      height: viewportHeight,
      innerPadding,
      sideLength: s,
      orientation: fallbackOrientation,
      wideFirst: true,
      areaEfficiency: Math.min(1, (rawW * s * (rawH * s)) / (usableW * usableH)),
      vertices,
      edges,
      triangles,
    };
  }

  // Prefer candidates satisfying sFit >= minSide that retain healthy cluster richness
  // and maximize viewport area & aspect-ratio alignment; on tiny screens, gracefully step down K.
  const viable = candidates.filter((c) => c.minSidePenalty === 0);
  let chosen: MeshCandidate;
  if (viable.length > 0) {
    const maxViableK = viable.reduce((acc, c) => Math.max(acc, c.vertexCount), 3);
    const minRichK = Math.max(3, Math.ceil(maxViableK * 0.75));
    const pool = viable.filter((c) => c.vertexCount >= minRichK);
    const activePool = pool.length > 0 ? pool : viable;

    activePool.sort((a, b) => {
      const scoreA =
        a.areaEfficiency +
        a.aspectAlignment * 0.12 +
        (a.vertexCount / maxViableK) * 0.18;
      const scoreB =
        b.areaEfficiency +
        b.aspectAlignment * 0.12 +
        (b.vertexCount / maxViableK) * 0.18;
      return scoreB - scoreA;
    });
    chosen = activePool[0]!;
  } else {
    candidates.sort((a, b) => {
      if (Math.abs(a.minSidePenalty - b.minSidePenalty) > 1e-6) {
        return a.minSidePenalty - b.minSidePenalty;
      }
      const scoreA = a.areaEfficiency + a.aspectAlignment * 0.12;
      const scoreB = b.areaEfficiency + b.aspectAlignment * 0.12;
      return scoreB - scoreA;
    });
    chosen = candidates[0]!;
  }

  const effectiveS = chosen.sideLength;

  const { vertices, edges, triangles } = buildSimplexLattice(
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
