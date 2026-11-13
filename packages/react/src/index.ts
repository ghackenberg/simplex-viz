export * from './ReactJsxSvgView';
export * from './useSimplexGraphController';
export * from './SimplexTopicGraph';

// Convenient re-exports from @simplex-viz/svg and @simplex-viz/core for single-import React usage
export {
  BadgeClusterSvgView,
  ClusterAnchorSvgView,
  GeometricShapeSvgView,
  MultiSectorGlyphSvgView,
  SimplexSvgController,
  createSimplexSvg,
  type BadgeClusterVisual,
  type ClusterAnchorVisual,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type GeometricShapeVisual,
  type MultiSectorGlyphVisual,
  type SimplexTheme,
  type SimplexVisualPreset,
  type SvgNodeView,
} from '@simplex-viz/svg';

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
  type LayoutMetrics,
  type LayoutSolverOptions,
  type MeshOptions,
  type NodeRenderState,
  type SimplexLayoutSnapshot,
  type SimplexSnapshotOptions,
  type VisualResolver,
} from '@simplex-viz/core';
