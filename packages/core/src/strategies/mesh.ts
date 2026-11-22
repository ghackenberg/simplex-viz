import {
  buildSimplexLattice,
  buildSimplexMesh,
  resolveDefaultInnerPadding,
} from '../mesh.js';
import type { DefaultTaggedItem, MeshOptions } from '../types.js';
import type { SimplexMeshStrategy } from './types.js';

/**
 * Default area-maximizing 60° toothed equilateral simplex mesh strategy.
 */
export function createAdaptiveHexMeshStrategy<TItem = DefaultTaggedItem>(
  defaults?: MeshOptions,
): SimplexMeshStrategy<TItem> {
  return {
    name: 'adaptive-hex-mesh',
    buildMesh(ctx) {
      const mergedOptions: MeshOptions = { ...defaults, ...ctx.meshOptions };
      const maxClusters = mergedOptions.maxClusters ?? 14;
      const requestedK =
        ctx.targetClusterCount ??
        (ctx.uniqueTagCount > 0
          ? ctx.uniqueTagCount
          : Math.min(
              maxClusters,
              Math.max(3, Math.round(Math.sqrt(Math.max(1, ctx.itemCount)))),
            ));
      return buildSimplexMesh(
        ctx.viewportWidth,
        ctx.viewportHeight,
        Math.max(3, requestedK),
        mergedOptions,
      );
    },
  };
}

/**
 * Fixed-dimension `(cols × rows)` 60° equilateral lattice strategy scaled symmetrically
 * to fit the viewport. When `orientation` is omitted or `'auto'`, automatically aligns
 * the lattice major axis with the viewport aspect ratio to maximize usable area.
 */
export function createFixedLatticeMeshStrategy<TItem = DefaultTaggedItem>(config: {
  readonly cols: number;
  readonly rows: number;
  readonly orientation?: 'horizontal' | 'vertical' | 'auto';
  readonly wideFirst?: boolean;
  readonly innerPadding?: number;
  readonly sideLength?: number;
}): SimplexMeshStrategy<TItem> {
  const cols = Math.max(2, Math.round(config.cols));
  const rows = Math.max(2, Math.round(config.rows));
  const configuredOrientation = config.orientation ?? 'auto';
  const wideFirst = config.wideFirst ?? true;

  return {
    name: `fixed-lattice-${cols}x${rows}`,
    buildMesh(ctx) {
      const innerPadding =
        config.innerPadding ??
        ctx.meshOptions.innerPadding ??
        resolveDefaultInnerPadding(ctx.viewportWidth, ctx.viewportHeight);
      const usableW = Math.max(80, ctx.viewportWidth - 2 * innerPadding);
      const usableH = Math.max(80, ctx.viewportHeight - 2 * innerPadding);
      const sqrt3Over2 = Math.sqrt(3) / 2;
      const spanAlongCols = Math.max(0.5, cols - 1);
      const spanAlongRows = Math.max(0.5, (rows - 1) * sqrt3Over2);
      const orientation: 'horizontal' | 'vertical' =
        configuredOrientation === 'horizontal' || configuredOrientation === 'vertical'
          ? configuredOrientation
          : (() => {
              const viewAspect = usableW / usableH;
              const aspectH = spanAlongCols / spanAlongRows;
              const aspectV = spanAlongRows / spanAlongCols;
              const matchH =
                Math.min(aspectH, viewAspect) / Math.max(aspectH, viewAspect);
              const matchV =
                Math.min(aspectV, viewAspect) / Math.max(aspectV, viewAspect);
              return matchH >= matchV ? 'horizontal' : 'vertical';
            })();
      const rawW = orientation === 'horizontal' ? spanAlongCols : spanAlongRows;
      const rawH = orientation === 'horizontal' ? spanAlongRows : spanAlongCols;
      const explicitSide = config.sideLength ?? ctx.meshOptions.sideLength;
      const maxSide =
        ctx.meshOptions.maxSideLength !== undefined &&
        Number.isFinite(ctx.meshOptions.maxSideLength)
          ? Math.max(40, ctx.meshOptions.maxSideLength)
          : Number.POSITIVE_INFINITY;
      const sideLength =
        explicitSide !== undefined && Number.isFinite(explicitSide)
          ? Math.max(40, explicitSide)
          : Math.max(40, Math.min(usableW / rawW, usableH / rawH, maxSide));
      const worldWidth = Math.max(
        ctx.viewportWidth,
        Math.ceil(rawW * sideLength + 2 * innerPadding),
      );
      const worldHeight = Math.max(
        ctx.viewportHeight,
        Math.ceil(rawH * sideLength + 2 * innerPadding),
      );
      const effUsableW = Math.max(80, worldWidth - 2 * innerPadding);
      const effUsableH = Math.max(80, worldHeight - 2 * innerPadding);
      const areaEfficiency = Math.min(
        1,
        (rawW * sideLength * (rawH * sideLength)) / (effUsableW * effUsableH),
      );

      const { vertices, edges, triangles } = buildSimplexLattice(
        cols,
        rows,
        sideLength,
        orientation,
        wideFirst,
        worldWidth,
        worldHeight,
      );

      return {
        width: worldWidth,
        height: worldHeight,
        innerPadding,
        sideLength,
        orientation,
        wideFirst,
        areaEfficiency,
        vertices,
        edges,
        triangles,
      };
    },
  };
}
