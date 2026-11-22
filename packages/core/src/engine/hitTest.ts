import type { ComputedItemPlacement } from '../clustering.js';
import { hitTestConvexGeometry, isPointInTriangle } from '../geometry.js';
import type {
  CameraController,
  ClusterDescriptor,
  EmptyClusterBehavior,
  HitTarget,
  ItemFilterMode,
  ItemFilterPredicate,
  Point2D,
  SimplexInteractiveTarget,
  SimplexKeyboardFocusTarget,
} from '../types.js';
import type {
  SimplexZoomState,
  SimplexZoomStrategy,
  ZoomFrameSpec,
} from '../zoom.js';
import {
  buildContextTriangleRenderStateFromRecord,
  buildTriangleRenderStateFromRecord,
  computeZoomRegionBoundary,
} from './snapshot.js';
import {
  resolveContextTriangleForContextItem,
  resolveDrillableTriangleForActiveItem,
  type AnimatedContextClusterRecord,
  type AnimatedContextItemRecord,
  type AnimatedContextTriangleRecord,
  type AnimatedNodeRecord,
  type AnimatedTriangleRecord,
} from './types.js';

export interface SceneHitTestContext<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly camera: CameraController;
  readonly zoomMode: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>['mode'];
  readonly zoomStack: readonly ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>[];
  readonly currentZoomState: SimplexZoomState;
  readonly currentClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
  readonly triangleStates: readonly AnimatedTriangleRecord[];
  readonly contextTriangleStates: readonly AnimatedContextTriangleRecord<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextClusterNodes: readonly AnimatedContextClusterRecord<
    TItem,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextItemNodes: readonly AnimatedContextItemRecord<
    TItem,
    TContentVisual,
    TTagMeta,
    TClusterMeta
  >[];
  readonly clusterNodes: ReadonlyMap<
    string,
    AnimatedNodeRecord<TClusterVisual, ClusterDescriptor<TItem, TTagMeta, TClusterMeta>>
  >;
  readonly itemNodes: ReadonlyMap<
    string,
    AnimatedNodeRecord<TContentVisual, ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>>
  >;
  readonly focusedClusterUid: string | null;
  readonly focusedTriangleIndex: number | null;
  readonly hoveredTriangleIndex: number | null;
  readonly neighborReturnHighlight:
    | { readonly kind: 'triangle'; readonly triangleIndex: number }
    | { readonly kind: 'cluster'; readonly clusterUid: string }
    | null;
  readonly emptyClusterBehavior: EmptyClusterBehavior;
  readonly itemFilterPredicate: ItemFilterPredicate<TItem> | null;
  readonly itemFilterMode: ItemFilterMode;
  readonly filteredOutItemIds: ReadonlySet<string>;
  readonly hasActiveFlight: boolean;
}

export function hitTestScene<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  ctx: SceneHitTestContext<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  screenX: number,
  screenY: number,
): HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> {
  const worldPosition = ctx.camera.screenToWorld(screenX, screenY);
  const screenPosition = { x: screenX, y: screenY };
  const hasTriangleFocus = ctx.focusedTriangleIndex !== null;
  const zoomBoundary = computeZoomRegionBoundary(
    ctx.zoomMode,
    ctx.zoomStack,
    ctx.triangleStates,
  );
  const triInput = {
    hoveredTriangleIndex: ctx.hoveredTriangleIndex,
    focusedTriangleIndex: ctx.focusedTriangleIndex,
    neighborReturnHighlight: ctx.neighborReturnHighlight,
    zoomMode: ctx.zoomMode,
    currentZoomState: ctx.currentZoomState,
    currentClusters: ctx.currentClusters,
    triangleCount: ctx.triangleStates.length,
  };

  const drillableTriSet =
    ctx.zoomMode === 'drill-down' &&
    ctx.currentZoomState.drillableTriangleIndices.length > 0
      ? new Set(ctx.currentZoomState.drillableTriangleIndices)
      : null;
  let deferredDrillableTri: AnimatedTriangleRecord | null = null;

  // Test content items in reverse insertion order (topmost rendered first)
  const itemList = [...ctx.itemNodes.values()];
  for (let i = itemList.length - 1; i >= 0; i--) {
    const node = itemList[i]!;
    if (
      node.status !== 'active' ||
      node.opacity.value < 0.15 ||
      (ctx.itemFilterPredicate !== null &&
        ctx.itemFilterMode === 'hide' &&
        ctx.filteredOutItemIds.has(node.id))
    ) {
      continue;
    }
    if (
      hitTestConvexGeometry(
        node.hull,
        node.x.value,
        node.y.value,
        node.scale.value,
        worldPosition.x,
        worldPosition.y,
        3 / Math.max(0.5, ctx.camera.getState().zoom),
      )
    ) {
      if (drillableTriSet !== null) {
        const owningDrillable = resolveDrillableTriangleForActiveItem(
          node,
          worldPosition,
          drillableTriSet,
          ctx.triangleStates,
        );
        if (owningDrillable !== null) {
          deferredDrillableTri ??= owningDrillable;
          continue;
        }
      }
      return {
        kind: 'content',
        item: node.domain.item,
        layoutContext: node.domain.layoutContext,
        visual: node.visual,
        worldPosition,
        screenPosition,
      };
    }
  }

  // Test topic clusters
  const clusterList = [...ctx.clusterNodes.values()];
  for (let i = clusterList.length - 1; i >= 0; i--) {
    const node = clusterList[i]!;
    if (
      node.status !== 'active' ||
      node.opacity.value < 0.15 ||
      (ctx.emptyClusterBehavior === 'hide' && node.domain.members.length === 0)
    ) {
      continue;
    }
    if (
      hitTestConvexGeometry(
        node.hull,
        node.x.value,
        node.y.value,
        node.scale.value,
        worldPosition.x,
        worldPosition.y,
        3 / Math.max(0.5, ctx.camera.getState().zoom),
      )
    ) {
      return {
        kind: 'cluster',
        cluster: node.domain,
        visual: node.visual,
        worldPosition,
        screenPosition,
      };
    }
  }

  // If an active item belonging to a drillable triangle passed through (including overhanging rims
  // or exterior single-cluster items), route directly to that drillable triangle before context/background.
  if (deferredDrillableTri !== null) {
    let targetTri = deferredDrillableTri;
    for (let i = ctx.triangleStates.length - 1; i >= 0; i--) {
      const tr = ctx.triangleStates[i]!;
      if (
        drillableTriSet?.has(tr.index) &&
        isPointInTriangle(
          worldPosition.x,
          worldPosition.y,
          tr.points[0],
          tr.points[1],
          tr.points[2],
        )
      ) {
        targetTri = tr;
        break;
      }
    }
    return {
      kind: 'triangle',
      triangle: buildTriangleRenderStateFromRecord(
        targetTri,
        triInput,
        hasTriangleFocus,
        zoomBoundary,
      ),
      worldPosition,
      screenPosition,
    };
  }

  // Test dimmed neighborhood clusters
  for (let i = ctx.contextClusterNodes.length - 1; i >= 0; i--) {
    const cc = ctx.contextClusterNodes[i]!;
    if (cc.opacity < 0.08) continue;
    if (
      hitTestConvexGeometry(
        cc.hull,
        cc.x,
        cc.y,
        cc.scale,
        worldPosition.x,
        worldPosition.y,
        3 / Math.max(0.5, ctx.camera.getState().zoom),
      )
    ) {
      return {
        kind: 'cluster',
        cluster: cc.cluster,
        visual: cc.visual,
        worldPosition,
        screenPosition,
        neighborId: cc.neighborId,
      };
    }
  }

  // Test mesh triangle faces
  for (let i = ctx.triangleStates.length - 1; i >= 0; i--) {
    const tr = ctx.triangleStates[i]!;
    if (
      isPointInTriangle(
        worldPosition.x,
        worldPosition.y,
        tr.points[0],
        tr.points[1],
        tr.points[2],
      )
    ) {
      return {
        kind: 'triangle',
        triangle: buildTriangleRenderStateFromRecord(
          tr,
          triInput,
          hasTriangleFocus,
          zoomBoundary,
        ),
        worldPosition,
        screenPosition,
      };
    }
  }

  // Test dimmed neighboring context triangle faces (dimmed context items inside them pass straight through)
  for (let i = ctx.contextTriangleStates.length - 1; i >= 0; i--) {
    const ct = ctx.contextTriangleStates[i]!;
    if (
      isPointInTriangle(
        worldPosition.x,
        worldPosition.y,
        ct.points[0],
        ct.points[1],
        ct.points[2],
      )
    ) {
      return {
        kind: 'triangle',
        triangle: buildContextTriangleRenderStateFromRecord(
          ct,
          ctx.hoveredTriangleIndex,
        ),
        worldPosition,
        screenPosition,
      };
    }
  }

  // Overhanging / exterior dimmed context item fallback: route directly to its owning neighbor triangle
  // (or neighbor cluster) without ever exposing individual content hover in unfocused triangles
  for (let i = ctx.contextItemNodes.length - 1; i >= 0; i--) {
    const ci = ctx.contextItemNodes[i]!;
    if (ci.opacity < 0.08) continue;
    if (
      hitTestConvexGeometry(
        ci.hull,
        ci.x,
        ci.y,
        ci.scale,
        worldPosition.x,
        worldPosition.y,
        3 / Math.max(0.5, ctx.camera.getState().zoom),
      )
    ) {
      const owningCtxTri = resolveContextTriangleForContextItem(
        ci,
        ctx.contextTriangleStates,
      );
      if (owningCtxTri) {
        return {
          kind: 'triangle',
          triangle: buildContextTriangleRenderStateFromRecord(
            owningCtxTri,
            ctx.hoveredTriangleIndex,
          ),
          worldPosition,
          screenPosition,
        };
      }
      if (ci.neighborId) {
        const owningCtxCluster = ctx.contextClusterNodes.find(
          (cc) => cc.neighborId === ci.neighborId,
        );
        if (owningCtxCluster) {
          return {
            kind: 'cluster',
            cluster: owningCtxCluster.cluster,
            visual: owningCtxCluster.visual,
            worldPosition,
            screenPosition,
            neighborId: owningCtxCluster.neighborId,
          };
        }
      }
      break;
    }
  }

  return {
    kind: 'background',
    worldPosition,
    screenPosition,
  };
}

export function getInteractiveTargetsFromScene<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  ctx: SceneHitTestContext<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
): readonly SimplexInteractiveTarget<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta
>[] {
  const targets: SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[] = [];
  const zState = ctx.currentZoomState;
  const isDrillDown = ctx.zoomMode === 'drill-down';
  const hasTriangleFocus = ctx.focusedTriangleIndex !== null;
  const zoomBoundary = computeZoomRegionBoundary(
    ctx.zoomMode,
    ctx.zoomStack,
    ctx.triangleStates,
  );
  const triInput = {
    hoveredTriangleIndex: ctx.hoveredTriangleIndex,
    focusedTriangleIndex: ctx.focusedTriangleIndex,
    neighborReturnHighlight: ctx.neighborReturnHighlight,
    zoomMode: ctx.zoomMode,
    currentZoomState: ctx.currentZoomState,
    currentClusters: ctx.currentClusters,
    triangleCount: ctx.triangleStates.length,
  };
  const drillableClusterSet = new Set(zState.drillableClusterUids);
  const drillableTriSet =
    isDrillDown && zState.drillableTriangleIndices.length > 0
      ? new Set(zState.drillableTriangleIndices)
      : null;
  const focusableTriSet =
    isDrillDown && zState.focusableTriangleIndices.length > 0
      ? new Set(zState.focusableTriangleIndices)
      : null;

  // 1. Active visible topic clusters (ordered deterministically by vertexIndex)
  const activeClusters = [...ctx.clusterNodes.values()]
    .filter(
      (node) =>
        node.status === 'active' &&
        !(ctx.emptyClusterBehavior === 'hide' && node.domain.members.length === 0) &&
        (node.opacity.target >= 0.05 || node.opacity.value >= 0.15),
    )
    .sort((a, b) => a.domain.clusterIndex - b.domain.clusterIndex);

  for (const node of activeClusters) {
    const worldPosition: Point2D = { x: node.x.value, y: node.y.value };
    const screenPosition = ctx.camera.worldToScreen(worldPosition.x, worldPosition.y);
    targets.push({
      kind: 'cluster',
      id: node.id,
      cluster: node.domain,
      visual: node.visual,
      worldPosition,
      screenPosition,
      scale: node.scale.value,
      hull: node.hull,
      isDrillable: isDrillDown && drillableClusterSet.has(node.domain.clusterUid),
      isFocused: ctx.focusedClusterUid === node.domain.clusterUid,
    });
  }

  // 2. Drillable / focusable mesh triangles in drill-down mode
  if (isDrillDown) {
    for (const tr of ctx.triangleStates) {
      const isDrillable = drillableTriSet?.has(tr.index) ?? false;
      const isFocusable = focusableTriSet?.has(tr.index) ?? false;
      if (!isDrillable && !isFocusable) continue;
      const worldPosition: Point2D = {
        x: (tr.points[0].x + tr.points[1].x + tr.points[2].x) / 3,
        y: (tr.points[0].y + tr.points[1].y + tr.points[2].y) / 3,
      };
      const screenPosition = ctx.camera.worldToScreen(worldPosition.x, worldPosition.y);
      targets.push({
        kind: 'triangle',
        index: tr.index,
        triangle: buildTriangleRenderStateFromRecord(
          tr,
          triInput,
          hasTriangleFocus,
          zoomBoundary,
        ),
        worldPosition,
        screenPosition,
        isDrillable,
        isFocusable,
        isFocused: ctx.focusedTriangleIndex === tr.index,
      });
    }
  }

  // 3. Active visible non-pass-through content items
  for (const node of ctx.itemNodes.values()) {
    if (
      node.status !== 'active' ||
      (node.opacity.target < 0.05 && node.opacity.value < 0.15) ||
      (ctx.itemFilterPredicate !== null &&
        ctx.itemFilterMode === 'hide' &&
        ctx.filteredOutItemIds.has(node.id))
    ) {
      continue;
    }
    const worldPosition: Point2D = { x: node.x.value, y: node.y.value };
    if (
      drillableTriSet !== null &&
      resolveDrillableTriangleForActiveItem(
        node,
        worldPosition,
        drillableTriSet,
        ctx.triangleStates,
      ) !== null
    ) {
      continue;
    }
    const screenPosition = ctx.camera.worldToScreen(worldPosition.x, worldPosition.y);
    targets.push({
      kind: 'item',
      id: node.id,
      item: node.domain.item,
      layoutContext: node.domain.layoutContext,
      visual: node.visual,
      worldPosition,
      screenPosition,
      scale: node.scale.value,
      hull: node.hull,
      isFilteredDimmed:
        ctx.itemFilterPredicate !== null &&
        ctx.itemFilterMode === 'dim' &&
        ctx.filteredOutItemIds.has(node.id),
    });
  }

  return targets;
}

export function resolveHitTargetForInteractiveTargetFromScene<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  ctx: SceneHitTestContext<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  target: SimplexKeyboardFocusTarget,
): HitTarget<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta> | null {
  const hasTriangleFocus = ctx.focusedTriangleIndex !== null;
  if (target.kind === 'cluster') {
    const node = ctx.clusterNodes.get(target.id);
    if (
      !node ||
      node.status !== 'active' ||
      (ctx.emptyClusterBehavior === 'hide' && node.domain.members.length === 0)
    ) {
      return null;
    }
    const worldPosition: Point2D = { x: node.x.value, y: node.y.value };
    const screenPosition = ctx.camera.worldToScreen(worldPosition.x, worldPosition.y);
    return {
      kind: 'cluster',
      cluster: node.domain,
      visual: node.visual,
      worldPosition,
      screenPosition,
    };
  }

  if (target.kind === 'triangle') {
    const tr = ctx.triangleStates.find((t) => t.index === target.index);
    if (!tr) return null;
    const worldPosition: Point2D = {
      x: (tr.points[0].x + tr.points[1].x + tr.points[2].x) / 3,
      y: (tr.points[0].y + tr.points[1].y + tr.points[2].y) / 3,
    };
    const screenPosition = ctx.camera.worldToScreen(worldPosition.x, worldPosition.y);
    const zoomBoundary = computeZoomRegionBoundary(
      ctx.zoomMode,
      ctx.zoomStack,
      ctx.triangleStates,
    );
    return {
      kind: 'triangle',
      triangle: buildTriangleRenderStateFromRecord(
        tr,
        {
          hoveredTriangleIndex: ctx.hoveredTriangleIndex,
          focusedTriangleIndex: ctx.focusedTriangleIndex,
          neighborReturnHighlight: ctx.neighborReturnHighlight,
          zoomMode: ctx.zoomMode,
          currentZoomState: ctx.currentZoomState,
          currentClusters: ctx.currentClusters,
          triangleCount: ctx.triangleStates.length,
        },
        hasTriangleFocus,
        zoomBoundary,
      ),
      worldPosition,
      screenPosition,
    };
  }

  const node = ctx.itemNodes.get(target.id);
  if (
    !node ||
    node.status !== 'active' ||
    (ctx.itemFilterPredicate !== null &&
      ctx.itemFilterMode === 'hide' &&
      ctx.filteredOutItemIds.has(node.id))
  ) {
    return null;
  }
  const worldPosition: Point2D = ctx.hasActiveFlight
    ? { x: node.x.target, y: node.y.target }
    : { x: node.x.value, y: node.y.value };
  const screenPosition = ctx.camera.worldToScreen(worldPosition.x, worldPosition.y);
  return {
    kind: 'content',
    item: node.domain.item,
    layoutContext: node.domain.layoutContext,
    visual: node.visual,
    worldPosition,
    screenPosition,
  };
}
