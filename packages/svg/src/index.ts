export * from './types';
export * from './hullMeasure';
export * from './presets';
export * from './SvgRendererAdapter';
export * from './SimplexSvgController';
export * from './views/GeometricShapeSvgView';
export * from './views/MultiSectorGlyphSvgView';
export * from './views/BadgeClusterSvgView';
export * from './views/ClusterAnchorSvgView';

// Convenient re-exports from @simplex-viz/core for single-import non-React apps
export {
  solveSimplexSnapshot,
  computeConvexHull,
  rectToConvexPolygon,
  regularPolygon,
  starConvexHull,
  type CameraController,
  type CameraState,
  type ClusterDescriptor,
  type ClusterHoverEvent,
  type ContentHoverEvent,
  type ContentLayoutContext,
  type ConvexGeometry,
  type DefaultTaggedItem,
  type HitTarget,
  type InteractionHandlers,
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type NodeRenderState,
  type SimplexLayoutSnapshot,
  type SimplexSnapshotOptions,
  type VisualResolver,
} from '@simplex-viz/core';
