import type {
  CameraState,
  ClusterDescriptor,
  SimplexViewState,
  SimplexViewZoomStep,
} from '../types.js';

export function captureEngineViewState(input: {
  readonly camera: CameraState;
  readonly zoomStepPath: readonly SimplexViewZoomStep[];
  readonly focusedClusterUid: string | null;
  readonly focusedTriangleIndex: number | null;
  readonly focusedItemId: string | null;
  readonly highlightedIds: ReadonlySet<string>;
  readonly selectedIds: ReadonlySet<string>;
  readonly pinnedIds: ReadonlySet<string>;
}): SimplexViewState {
  const zoomPath: SimplexViewZoomStep[] = input.zoomStepPath.map((step) =>
    step.kind === 'triangle'
      ? { kind: 'triangle', index: step.index }
      : {
          kind: 'cluster',
          clusterIndex: step.clusterIndex,
          ...(step.clusterUid !== undefined ? { clusterUid: step.clusterUid } : {}),
          ...(step.label !== undefined ? { label: step.label } : {}),
        },
  );
  return {
    version: 1,
    camera: {
      zoom: input.camera.zoom,
      panX: input.camera.panX,
      panY: input.camera.panY,
    },
    zoomPath,
    focusedClusterUid: input.focusedClusterUid,
    focusedTriangleIndex: input.focusedTriangleIndex,
    focusedItemId: input.focusedItemId,
    highlightedIds: Array.from(input.highlightedIds).sort(),
    selectedIds: Array.from(input.selectedIds).sort(),
    pinnedIds: Array.from(input.pinnedIds).sort(),
  };
}

export function resolveClusterForViewStep<TItem, TTagMeta, TClusterMeta>(
  currentClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
  step: Extract<SimplexViewZoomStep, { readonly kind: 'cluster' }>,
): ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | null {
  if (typeof step.clusterUid === 'string' && step.clusterUid.length > 0) {
    const byUid = currentClusters.find((c) => c.clusterUid === step.clusterUid);
    if (byUid) return byUid;
  }
  const hasIndex =
    typeof step.clusterIndex === 'number' &&
    Number.isInteger(step.clusterIndex) &&
    step.clusterIndex >= 0;
  const hasLabel = typeof step.label === 'string' && step.label.length > 0;
  if (hasIndex && hasLabel) {
    const byBoth = currentClusters.find(
      (c) => c.clusterIndex === step.clusterIndex && c.defaultLabel === step.label,
    );
    if (byBoth) return byBoth;
  }
  if (hasLabel) {
    const byLabel = currentClusters.find((c) => c.defaultLabel === step.label);
    if (byLabel) return byLabel;
  }
  if (hasIndex) {
    const byIndex = currentClusters.find((c) => c.clusterIndex === step.clusterIndex);
    if (byIndex) return byIndex;
  }
  return null;
}

export function filterValidStringIds(
  rawIds: readonly unknown[],
  knownIds: ReadonlySet<string>,
  secondaryIds?: ReadonlySet<string>,
): string[] {
  const valid: string[] = [];
  for (const id of rawIds) {
    if (
      typeof id === 'string' &&
      (knownIds.has(id) || (secondaryIds !== undefined && secondaryIds.has(id)))
    ) {
      valid.push(id);
    }
  }
  return valid;
}
