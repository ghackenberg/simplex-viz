import type { ComputedItemPlacement } from '../clustering.js';
import type {
  ClusterDescriptor,
  EmptyClusterBehavior,
  ItemFilterMode,
  ItemFilterPredicate,
  SimplexLegendEntry,
  SimplexLegendModel,
  SimplexLegendModelOptions,
} from '../types.js';
import type {
  AnimatedContextClusterRecord,
  AnimatedNodeRecord,
} from './types.js';

export interface LegendBuildInput<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
> {
  readonly currentClusters: readonly ClusterDescriptor<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly currentPlacements: readonly ComputedItemPlacement<
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
  readonly itemNodes: ReadonlyMap<
    string,
    AnimatedNodeRecord<
      TContentVisual,
      ComputedItemPlacement<TItem, TTagMeta, TClusterMeta>
    >
  >;
  readonly filteredOutItemIds: ReadonlySet<string>;
  readonly itemFilterPredicate: ItemFilterPredicate<TItem> | null;
  readonly itemFilterMode: ItemFilterMode;
  readonly emptyClusterBehavior: EmptyClusterBehavior;
  readonly focusedClusterUid: string | null;
  readonly zoomDepth: number;
}

export function buildEngineLegendModel<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  input: LegendBuildInput<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  options?: SimplexLegendModelOptions,
): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> {
  const includeContext = options?.includeContext ?? false;
  const includeMidpoints = options?.includeMidpoints ?? true;
  const includeHidden = options?.includeHidden ?? true;
  const predicate = input.itemFilterPredicate;
  const hasActiveFilter = predicate !== null;

  const countVisibleMembers = (
    cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  ): number => {
    if (!predicate) return cluster.members.length;
    let count = 0;
    for (const m of cluster.members) {
      const isFilteredOut = input.itemNodes.has(m.itemId)
        ? input.filteredOutItemIds.has(m.itemId)
        : !predicate(m.item);
      if (!isFilteredOut) count += 1;
    }
    return count;
  };

  const entries: SimplexLegendEntry<TItem, TTagMeta, TClusterMeta>[] = [];

  for (const cluster of input.currentClusters) {
    const isMidpoint = cluster.role === 'intermediate';
    if (isMidpoint && !includeMidpoints) continue;
    const totalCount = cluster.members.length;
    const visibleCount = countVisibleMembers(cluster);
    const isHidden = totalCount === 0 && input.emptyClusterBehavior === 'hide';
    if (isHidden && !includeHidden) continue;

    entries.push({
      clusterUid: cluster.clusterUid,
      code: cluster.code,
      label: cluster.subclusterLabel || cluster.defaultLabel,
      ...(cluster.parentContextLabel !== undefined
        ? { parentContextLabel: cluster.parentContextLabel }
        : {}),
      colorHex: cluster.colorHex,
      totalCount,
      visibleCount,
      isEmpty: visibleCount === 0,
      isHidden,
      isFocused:
        input.focusedClusterUid !== null &&
        input.focusedClusterUid === cluster.clusterUid,
      isContext: false,
      isMidpoint,
      cluster,
    });
  }

  if (includeContext && input.contextClusterNodes.length > 0) {
    for (const cc of input.contextClusterNodes) {
      const cluster = cc.cluster;
      const isMidpoint = cluster.role === 'intermediate';
      if (isMidpoint && !includeMidpoints) continue;
      const totalCount = cluster.members.length;
      const visibleCount = countVisibleMembers(cluster);

      entries.push({
        clusterUid: cluster.clusterUid,
        code: cluster.code,
        label: cluster.subclusterLabel || cluster.defaultLabel,
        ...(cluster.parentContextLabel !== undefined
          ? { parentContextLabel: cluster.parentContextLabel }
          : {}),
        colorHex: cluster.colorHex,
        totalCount,
        visibleCount,
        isEmpty: visibleCount === 0,
        isHidden: false,
        isFocused: false,
        isContext: true,
        isMidpoint,
        cluster,
      });
    }
  }

  const totalItems = input.currentPlacements.length;
  let visibleItems = totalItems;
  if (predicate) {
    visibleItems = 0;
    for (const placement of input.currentPlacements) {
      const isFilteredOut = input.itemNodes.has(placement.id)
        ? input.filteredOutItemIds.has(placement.id)
        : !predicate(placement.item);
      if (!isFilteredOut) visibleItems += 1;
    }
  }

  return {
    entries,
    zoomDepth: input.zoomDepth,
    totalItems,
    visibleItems,
    hasActiveFilter,
    itemFilterMode: input.itemFilterMode,
    emptyClusterBehavior: input.emptyClusterBehavior,
    focusedClusterUid: input.focusedClusterUid,
    timelineStep: null,
  };
}

export function computeLegendSignature<TItem, TTagMeta, TClusterMeta>(
  model: SimplexLegendModel<TItem, TTagMeta, TClusterMeta>,
): string {
  const entrySig = model.entries
    .map(
      (e) =>
        `${e.clusterUid}|${e.code}|${e.label}|${e.parentContextLabel ?? ''}|${e.colorHex}|${e.totalCount}|${e.visibleCount}|${e.isEmpty ? 1 : 0}|${e.isHidden ? 1 : 0}|${e.isFocused ? 1 : 0}|${e.isContext ? 1 : 0}|${e.isMidpoint ? 1 : 0}`,
    )
    .join(';');
  return `${model.zoomDepth}|${model.totalItems}|${model.visibleItems}|${model.hasActiveFilter ? 1 : 0}|${model.itemFilterMode}|${model.emptyClusterBehavior}|${model.focusedClusterUid ?? ''}|${model.timelineStep ?? ''}|${entrySig}`;
}
