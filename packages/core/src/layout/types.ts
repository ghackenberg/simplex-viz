import type {
  BoundingBox2D,
  ConvexGeometry,
  LayoutSolverOptions,
  Point2D,
  SimplexMesh,
} from '../types.js';

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
