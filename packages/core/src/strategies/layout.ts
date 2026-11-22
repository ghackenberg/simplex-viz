import { computeConvexMtv, getHullBoundingBox } from '../geometry.js';
import {
  createCollisionLocalScaleController,
  createDensityPriorScaleController,
  createMeshInwardFanSeeder,
  createSpaceFillingPbdRelaxer,
  createUniformScaleController,
  measureLayoutOverlaps,
  solveComposedLayout,
  withWarmStartSeeder,
  type LayoutSeeder,
  type PlacedNode,
  type PositionRelaxer,
  type ScaleController,
  type TwoPhaseLayoutResult,
} from '../layout.js';
import type { Point2D } from '../types.js';
import type {
  LayoutStrategyContext,
  PreviousNodeLayout,
  SimplexLayoutStrategy,
} from './types.js';

function toPositionMap(
  prev?: ReadonlyMap<string, PreviousNodeLayout>,
): ReadonlyMap<string, Point2D> | undefined {
  if (!prev || prev.size === 0) return undefined;
  const out = new Map<string, Point2D>();
  for (const [id, node] of prev) {
    out.set(id, { x: node.x, y: node.y });
  }
  return out;
}

export interface ComposedLayoutStrategyOptions {
  /** Optional custom strategy identifier. */
  readonly name?: string;
  /** Initial item coordinate generator (`phyllotaxis`, `mesh-inward-fan`, etc.). */
  readonly seeder?: LayoutSeeder;
  /** Inner position solver (`barycentric-pbd`, `space-filling-pbd`, etc.). */
  readonly relaxer?: PositionRelaxer;
  /** Outer scale adaptation controller (`uniform-scale`, `collision-local-scale`, `density-prior-scale`, `fixed-scale`, etc.). */
  readonly scaleController?: ScaleController;
  /**
   * When `true` (default: `true`), reuses settled item coordinates across non-initial updates
   * by wrapping `seeder` with `withWarmStartSeeder`. Set `false` for cold-start solves every frame.
   */
  readonly warmStart?: boolean;
  /** Default relaxation iteration budget if `ctx.layoutOptions.relaxationIterations` is omitted. */
  readonly defaultRelaxationIterations?: number;
}

/**
 * Composes an arbitrary `LayoutSeeder` × `PositionRelaxer` × `ScaleController` combination
 * into a `SimplexLayoutStrategy` coupled via an outer-scale / inner-position feedback loop.
 */
export function createComposedLayoutStrategy(
  options?: ComposedLayoutStrategyOptions,
): SimplexLayoutStrategy {
  const baseSeeder = options?.seeder ?? createMeshInwardFanSeeder();
  const warmStart = options?.warmStart ?? true;
  const effectiveSeeder = warmStart ? withWarmStartSeeder(baseSeeder) : baseSeeder;
  const relaxer = options?.relaxer ?? createSpaceFillingPbdRelaxer();
  const scaleController = options?.scaleController ?? createCollisionLocalScaleController();
  const defaultRelaxationIterations = options?.defaultRelaxationIterations ?? 44;
  const strategyName =
    options?.name ??
    `composed(${effectiveSeeder.name}+${relaxer.name}+${scaleController.name})`;

  return {
    name: strategyName,
    solve(ctx) {
      return solveComposedLayout({
        clusters: ctx.clusters,
        items: ctx.items,
        mesh: ctx.mesh,
        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,
        viewportMargin: ctx.viewportMargin,
        options: ctx.layoutOptions,
        previousItemPositions:
          warmStart && ctx.reason !== 'initial'
            ? toPositionMap(ctx.previousItemPositions)
            : undefined,
        seeder: effectiveSeeder,
        relaxer,
        scaleController,
        defaultRelaxationIterations,
      });
    },
  };
}

/**
 * Default space-filling uniform layout strategy: fans co-located items into open covering
 * mesh triangles, binary-searches a single global scale factor `\alpha` to preserve exact
 * relative size ratios across all nodes, and polishes with hard SAT separation (`0.0 px` overlap).
 */
export function createPbdUniformLayoutStrategy(): SimplexLayoutStrategy {
  return createComposedLayoutStrategy({
    name: 'pbd-uniform',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.72,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createUniformScaleController(),
    warmStart: false,
    defaultRelaxationIterations: 42,
  });
}

/**
 * Warm-started space-filling uniform PBD layout strategy: reuses existing items' settled
 * coordinates as initial positions during updates to minimize visual jumping when items are
 * added/removed or strategies change, while strictly guaranteeing `0.0 px` overlap.
 */
export function createWarmStartPbdLayoutStrategy(): SimplexLayoutStrategy {
  return createComposedLayoutStrategy({
    name: 'pbd-warm-start',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.72,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createUniformScaleController(),
    warmStart: true,
    defaultRelaxationIterations: 42,
  });
}

/**
 * Local density-adaptive scaling layout strategy: disperses items across open covering-triangle
 * interiors first, evaluates a smooth radial crowd kernel on the dispersed neighborhood so dense
 * hubs taper gradually while sparse regions keep full `1.0` scale, and polishes locally to
 * enforce `0.0 px` overlap across all hulls and viewport edges.
 */
export function createLocalAdaptiveLayoutStrategy(options?: {
  readonly crowdRadiusPx?: number;
  readonly minLocalScale?: number;
  readonly warmStart?: boolean;
}): SimplexLayoutStrategy {
  return createComposedLayoutStrategy({
    name: 'local-adaptive',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.7,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createDensityPriorScaleController({
      crowdRadiusPx: options?.crowdRadiusPx,
      minLocalScale: options?.minLocalScale,
    }),
    warmStart: options?.warmStart ?? true,
    defaultRelaxationIterations: 44,
  });
}

export interface CollisionDrivenLayoutOptions {
  /** Minimum scale permitted for locally crowded colliding items. Default: `0.32`. */
  readonly minLocalScale?: number;
  /** Per-round multiplicative shrink step applied only to colliding items. Default: `0.85`. */
  readonly shrinkFactor?: number;
  /** Warm-starts item positions across updates for smooth transitions. Default: `true`. */
  readonly warmStart?: boolean;
}

/**
 * Collision-driven adaptive layout strategy:
 *
 * Keeps every node at full `1.0` scale wherever possible, spreads congested anchors into open
 * adjacent mesh triangles, and progressively shrinks **only** the locally colliding pockets until
 * `0.0 px` overlap is guaranteed.
 */
export function createCollisionDrivenLayoutStrategy(
  options?: CollisionDrivenLayoutOptions,
): SimplexLayoutStrategy {
  return createComposedLayoutStrategy({
    name: 'collision-driven-adaptive',
    seeder: createMeshInwardFanSeeder(),
    relaxer: createSpaceFillingPbdRelaxer({
      springFactor: 0.7,
      springZeroTailRatio: 0.35,
      dispersionGapPx: 18,
      dispersionStrength: 0.35,
    }),
    scaleController: createCollisionLocalScaleController({
      minLocalScale: options?.minLocalScale,
      shrinkFactor: options?.shrinkFactor,
    }),
    warmStart: options?.warmStart ?? true,
    defaultRelaxationIterations: 46,
  });
}

/**
 * Scaling mode for `createFinalSeededLayoutStrategy` when projecting partial subsets
 * (such as early chronological timeline frames) onto the canonical full-corpus layout:
 * - `'pinned'` (default): Pins both final `(x, y)` coordinates and final scales from step `N`
 *   for 100% spatial & size invariance across forward/backward scrubbing.
 * - `'adaptive'`: Pins exact final `(x, y)` coordinates (zero spatial drift!), while allowing
 *   items on sparse early frames to expand symmetrically up to full `1.0x` scale whenever
 *   they remain strictly overlap-free (`0.0 px` overlap) against active neighbors and clusters.
 */
export type FinalSeededLayoutScaleMode = 'pinned' | 'adaptive';

/**
 * Configuration options for `createFinalSeededLayoutStrategy`.
 */
export interface FinalSeededLayoutOptions {
  /** Base layout strategy used to solve the canonical full-corpus frame. Default: `createCollisionDrivenLayoutStrategy()`. */
  readonly baseStrategy?: SimplexLayoutStrategy;
  /** Scaling behavior for active subsets. Default: `'pinned'`. */
  readonly scaleMode?: FinalSeededLayoutScaleMode;
  /**
   * Policy when `solve()` encounters items absent from the cached canonical seed:
   * - `'fallback'` (default): Solves via `baseStrategy` with cached seed items as warm-start hints.
   * - `'reseed'`: Re-solves the new superset and caches it as the new canonical seed.
   */
  readonly unseenItemPolicy?: 'fallback' | 'reseed';
}

function isSimplexLayoutStrategy(value: unknown): value is SimplexLayoutStrategy {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as SimplexLayoutStrategy).name === 'string' &&
    'solve' in value &&
    typeof (value as SimplexLayoutStrategy).solve === 'function'
  );
}

function computeLayoutEnvironmentSignature(ctx: LayoutStrategyContext): string {
  const meshVertSig = ctx.mesh.vertices
    .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
    .join(';');
  const lo = ctx.layoutOptions;
  return [
    ctx.viewportWidth.toFixed(1),
    ctx.viewportHeight.toFixed(1),
    ctx.viewportMargin.toFixed(1),
    (lo.clusterGapPx ?? '').toString(),
    (lo.itemGapPx ?? '').toString(),
    (lo.minContentScale ?? '').toString(),
    (lo.relaxationIterations ?? '').toString(),
    (lo.sizeMultiplier ?? 1).toFixed(4),
    (lo.seed ?? '').toString(),
    meshVertSig,
  ].join('|');
}

function isInsideViewport(
  hull: PlacedNode['hull'],
  x: number,
  y: number,
  scale: number,
  viewportW: number,
  viewportH: number,
  margin: number,
): boolean {
  const box = getHullBoundingBox(hull, x, y, scale);
  return (
    box.minX >= margin - 1e-3 &&
    box.maxX <= viewportW - margin + 1e-3 &&
    box.minY >= margin - 1e-3 &&
    box.maxY <= viewportH - margin + 1e-3
  );
}

function solveSymmetricAdaptiveScales(
  clusters: readonly PlacedNode[],
  pinnedItems: readonly PlacedNode[],
  ctx: LayoutStrategyContext,
): readonly PlacedNode[] {
  const n = pinnedItems.length;
  if (n === 0) return pinnedItems;

  const sizeMult = Math.max(0.1, ctx.layoutOptions.sizeMultiplier ?? 1);
  const clusterGap = Math.max(0, ctx.layoutOptions.clusterGapPx ?? 14);
  const itemGap = Math.max(0, ctx.layoutOptions.itemGapPx ?? 5);
  const margin = ctx.viewportMargin;

  // Step 1: For each active item independently, find max scale in [pinnedScale, sizeMult]
  // that clears viewport margins and all active cluster obstacles.
  const minScales = new Float64Array(n);
  const capScales = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const it = pinnedItems[i]!;
    const lo = it.scale;
    const hi = Math.max(lo, sizeMult);
    minScales[i] = lo;

    const fitsObstacles = (s: number): boolean => {
      if (
        !isInsideViewport(
          it.hull,
          it.x,
          it.y,
          s,
          ctx.viewportWidth,
          ctx.viewportHeight,
          margin,
        )
      ) {
        return false;
      }
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c]!;
        const mtv = computeConvexMtv(
          it.hull,
          it.x,
          it.y,
          s,
          cl.hull,
          cl.x,
          cl.y,
          cl.scale,
          clusterGap,
        );
        if (mtv && mtv.depth > 1e-4) {
          return false;
        }
      }
      return true;
    };

    if (hi <= lo + 1e-4 || !fitsObstacles(lo)) {
      capScales[i] = lo;
    } else if (fitsObstacles(hi)) {
      capScales[i] = hi;
    } else {
      let a = lo;
      let b = hi;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (a + b) * 0.5;
        if (fitsObstacles(mid)) {
          a = mid;
        } else {
          b = mid;
        }
      }
      capScales[i] = a;
    }
  }

  // Step 2: Symmetric pairwise cap — every colliding pair (i, j) trims both scales
  // proportionally toward their guaranteed-safe pinnedScale so result is 100% order-independent
  // and guaranteed 0.0 px overlap across all pairs.
  const finalScales = new Float64Array(capScales);

  for (let i = 0; i < n; i++) {
    const itA = pinnedItems[i]!;
    const loA = minScales[i]!;
    for (let j = i + 1; j < n; j++) {
      const itB = pinnedItems[j]!;
      const loB = minScales[j]!;
      const hiA = finalScales[i]!;
      const hiB = finalScales[j]!;
      if (hiA <= loA + 1e-4 && hiB <= loB + 1e-4) continue;

      const initialMtv = computeConvexMtv(
        itA.hull,
        itA.x,
        itA.y,
        hiA,
        itB.hull,
        itB.x,
        itB.y,
        hiB,
        itemGap,
      );
      if (!initialMtv || initialMtv.depth <= 1e-4) continue;

      let tLo = 0;
      let tHi = 1;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (tLo + tHi) * 0.5;
        const sA = loA + mid * (hiA - loA);
        const sB = loB + mid * (hiB - loB);
        const mtv = computeConvexMtv(
          itA.hull,
          itA.x,
          itA.y,
          sA,
          itB.hull,
          itB.x,
          itB.y,
          sB,
          itemGap,
        );
        if (!mtv || mtv.depth <= 1e-4) {
          tLo = mid;
        } else {
          tHi = mid;
        }
      }
      finalScales[i] = loA + tLo * (hiA - loA);
      finalScales[j] = loB + tLo * (hiB - loB);
    }
  }

  return pinnedItems.map((it, idx) => ({
    ...it,
    scale: finalScales[idx]!,
  }));
}

/**
 * Final-seeded (frozen-coordinate) layout strategy wrapper for chronological timelines
 * and filtered subset exploration.
 *
 * Solves the canonical full-corpus layout once via `baseStrategy` (automatically re-seeding
 * on viewport, mesh, or `layoutOptions` changes), then projects any subset `0..N` directly
 * onto its exact final coordinates with **zero spatial drift** and **100% path-independent**
 * forward/backward scrubbing.
 *
 * - `scaleMode: 'pinned'` (default): Preserves both exact final coordinates and exact final scales.
 * - `scaleMode: 'adaptive'`: Preserves exact final coordinates while allowing sparse early frames
 *   to expand smoothly up to `1.0x` scale whenever strictly overlap-free (`0.0 px` overlap).
 */
export function createFinalSeededLayoutStrategy(
  baseOrOptions?: SimplexLayoutStrategy | FinalSeededLayoutOptions,
  extraOptions?: Omit<FinalSeededLayoutOptions, 'baseStrategy'>,
): SimplexLayoutStrategy {
  const resolved: FinalSeededLayoutOptions = isSimplexLayoutStrategy(baseOrOptions)
    ? { ...extraOptions, baseStrategy: baseOrOptions }
    : { ...baseOrOptions, ...extraOptions };

  const baseStrategy: SimplexLayoutStrategy =
    resolved.baseStrategy ?? createCollisionDrivenLayoutStrategy();
  const scaleMode: FinalSeededLayoutScaleMode = resolved.scaleMode ?? 'pinned';
  const unseenItemPolicy = resolved.unseenItemPolicy ?? 'fallback';

  let cachedEnvSignature: string | null = null;
  let cachedExternalSeedSignature: string | null = null;
  let cachedClustersById = new Map<string, PlacedNode>();
  let cachedItemsById = new Map<string, PlacedNode>();
  let cachedResult: TwoPhaseLayoutResult | null = null;

  const storeCanonicalSeed = (
    ctx: LayoutStrategyContext,
    result: TwoPhaseLayoutResult,
    externalSignature?: string,
  ): TwoPhaseLayoutResult => {
    cachedEnvSignature = computeLayoutEnvironmentSignature(ctx);
    cachedExternalSeedSignature = externalSignature ?? null;
    cachedResult = result;
    cachedClustersById = new Map(result.clusters.map((c) => [c.id, c]));
    cachedItemsById = new Map(result.items.map((it) => [it.id, it]));
    return result;
  };

  return {
    name: `final-seeded(${baseStrategy.name}:${scaleMode})`,

    needsCanonicalSeed(signature: string): boolean {
      return cachedResult === null || cachedExternalSeedSignature !== signature;
    },

    seedCanonicalLayout(
      ctx: LayoutStrategyContext,
      signature?: string,
    ): TwoPhaseLayoutResult {
      const solved = baseStrategy.solve({
        ...ctx,
        previousClusterPositions: undefined,
        previousItemPositions: undefined,
        reason: 'initial',
      });
      return storeCanonicalSeed(ctx, solved, signature);
    },

    solve(ctx: LayoutStrategyContext): TwoPhaseLayoutResult {
      const envSig = computeLayoutEnvironmentSignature(ctx);

      if (!cachedResult || cachedEnvSignature !== envSig) {
        const solved = baseStrategy.solve(ctx);
        return storeCanonicalSeed(ctx, solved);
      }

      let allClustersMatched = true;
      for (const cl of ctx.clusters) {
        if (!cachedClustersById.has(cl.id)) {
          allClustersMatched = false;
          break;
        }
      }
      let allItemsMatched = true;
      for (const it of ctx.items) {
        if (!cachedItemsById.has(it.id)) {
          allItemsMatched = false;
          break;
        }
      }

      if (!allClustersMatched || !allItemsMatched) {
        if (unseenItemPolicy === 'reseed') {
          const solved = baseStrategy.solve({
            ...ctx,
            previousClusterPositions: undefined,
            previousItemPositions: undefined,
            reason: 'initial',
          });
          return storeCanonicalSeed(ctx, solved);
        }
        const seedPrevClusters = new Map<string, PreviousNodeLayout>();
        for (const [id, node] of cachedClustersById) {
          seedPrevClusters.set(id, { x: node.x, y: node.y, scale: node.scale });
        }
        const seedPrevItems = new Map<string, PreviousNodeLayout>();
        for (const [id, node] of cachedItemsById) {
          seedPrevItems.set(id, { x: node.x, y: node.y, scale: node.scale });
        }
        return baseStrategy.solve({
          ...ctx,
          previousClusterPositions: seedPrevClusters,
          previousItemPositions: seedPrevItems,
        });
      }

      const placedClusters: PlacedNode[] = ctx.clusters.map((cl) => {
        const seeded = cachedClustersById.get(cl.id)!;
        return {
          ...seeded,
          hull: cl.hull,
        };
      });

      const pinnedItems: PlacedNode[] = ctx.items.map((it) => {
        const seeded = cachedItemsById.get(it.id)!;
        return {
          ...seeded,
          hull: it.hull,
        };
      });

      const finalItems =
        scaleMode === 'adaptive'
          ? solveSymmetricAdaptiveScales(placedClusters, pinnedItems, ctx)
          : pinnedItems;

      const overlaps = measureLayoutOverlaps(
        placedClusters,
        finalItems,
        ctx.viewportWidth,
        ctx.viewportHeight,
        ctx.viewportMargin,
      );

      let minContentScale = cachedResult.contentScale;
      if (finalItems.length > 0) {
        minContentScale = Infinity;
        for (const it of finalItems) {
          if (it.scale < minContentScale) minContentScale = it.scale;
        }
      }

      return {
        clusters: placedClusters,
        items: finalItems,
        clusterScale: cachedResult.clusterScale,
        contentScale: minContentScale,
        overlapCount: overlaps.overlapCount,
        maxPenetrationPx: overlaps.maxPenetrationPx,
      };
    },
  };
}
