export {
  DEFAULT_FULL_SCALE_THRESHOLD,
  IDENTITY_ZOOM_AFFINE,
  applyZoomAffine,
  composeZoomAffine,
  invertZoomAffine,
  type BarycentricClusterZoomMode,
  type BarycentricZoomStrategyOptions,
  type SemanticZoomStrategyOptions,
  type SimplexZoomState,
  type SimplexZoomStrategy,
  type SubspaceZoomContext,
  type SubspaceZoomFeature,
  type SubspaceZoomStrategyOptions,
  type ZoomAffineTransform,
  type ZoomBreadcrumb,
  type ZoomBreadcrumbSegment,
  type ZoomClusterDrillContext,
  type ZoomContextCluster,
  type ZoomContextEdge,
  type ZoomContextItem,
  type ZoomContextTriangle,
  type ZoomDrillOutcome,
  type ZoomFrameKind,
  type ZoomFrameSpec,
  type ZoomItemAnchorInput,
  type ZoomNeighborDrillContext,
  type ZoomNeighborTarget,
  type ZoomSharedHelpers,
  type ZoomStrategyMode,
  type ZoomTargetEvaluationContext,
  type ZoomTargetEvaluationResult,
  type ZoomTriangleDrillContext,
} from './zoom/types.js';

export {
  buildIncidentStarMesh,
  buildSubdividedTriangleMesh,
} from './zoom/geometry.js';

export {
  formatScopedNeighborId,
  parseScopedNeighborId,
} from './zoom/shared.js';

export { createBarycentricZoomStrategy } from './zoom/barycentric.js';
export { createSemanticZoomStrategy } from './zoom/semantic.js';
export { createSubspaceZoomStrategy } from './zoom/subspace.js';
export { createFreeCameraZoomStrategy } from './zoom/freeCamera.js';
