import type {
  ComputedItemPlacement,
  PreviousClusterSnapshot,
} from '../clustering.js';
import { hexToOklab, mixOklabColors } from '../oklab.js';
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  PeerClusterContext,
  SimplexMesh,
} from '../types.js';
import type {
  AssignedColor,
  ClusteringStrategyOutput,
  PipelineUpdateReason,
  SimplexColorStrategy,
  SimplexColorTheme,
} from './types.js';

/**
 * Applies `SimplexColorStrategy` and `deriveClusterMeta` to the topological output
 * of a `SimplexClusteringStrategy`, producing final `ClusterDescriptor`s and
 * `ComputedItemPlacement`s shared by both `SimplexGraphEngine` and `solveSimplexSnapshot`.
 */
export function finalizeClusteringWithColors<TItem, TTagMeta, TClusterMeta>(params: {
  readonly clusteringOutput: ClusteringStrategyOutput<TItem, TTagMeta>;
  readonly mesh: SimplexMesh;
  readonly colorStrategy: SimplexColorStrategy<TItem, TTagMeta>;
  readonly theme: SimplexColorTheme;
  readonly previousTheme?: SimplexColorTheme;
  readonly previousClusters: readonly PreviousClusterSnapshot[];
  readonly reason: PipelineUpdateReason;
  readonly seed: number;
  readonly deriveClusterMeta?: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
}): {
  readonly clusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta | undefined>[];
  readonly items: readonly ComputedItemPlacement<TItem, TTagMeta, TClusterMeta | undefined>[];
  readonly uniqueTags: readonly string[];
} {
  const {
    clusteringOutput,
    mesh,
    colorStrategy,
    theme,
    previousTheme,
    previousClusters,
    reason,
    seed,
    deriveClusterMeta,
  } = params;

  if (clusteringOutput.clusters.length === 0) {
    return {
      clusters: [],
      items: [],
      uniqueTags: clusteringOutput.uniqueTags,
    };
  }

  const assignedColors = colorStrategy.assignClusterColors({
    clusters: clusteringOutput.clusters,
    mesh,
    theme,
    previousTheme,
    preservedColors: clusteringOutput.preservedColors,
    previousClusters,
    reason,
    seed,
  });

  const fallbackColor: AssignedColor = {
    hex: '#38bdf8',
    oklab: hexToOklab('#38bdf8'),
  };

  const allItems: readonly TItem[] = clusteringOutput.items.map((it) => it.item);
  const peerClusters: readonly PeerClusterContext<TItem, TTagMeta>[] =
    clusteringOutput.clusters.map((base) => ({
      clusterIndex: base.clusterIndex,
      clusterUid: base.clusterUid,
      code: base.code,
      defaultLabel: base.defaultLabel,
      coreTags: base.coreTags,
      members: base.members,
      representativeItems: base.representativeItems,
    }));

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta | undefined>[] =
    clusteringOutput.clusters.map((base, idx) => {
      const color = assignedColors[idx] ?? fallbackColor;
      const derivationCtx: ClusterDerivationContext<TItem, TTagMeta> = {
        ...base,
        colorHex: color.hex,
        oklab: color.oklab,
        allItems,
        peerClusters,
      };
      const meta = deriveClusterMeta ? deriveClusterMeta(derivationCtx) : undefined;
      return {
        ...derivationCtx,
        meta,
      };
    });

  const items: ComputedItemPlacement<TItem, TTagMeta, TClusterMeta | undefined>[] =
    clusteringOutput.items.map((anchor) => {
      const unitClusters = anchor.unitWeights.map((uw) => ({
        cluster: clusters[uw.clusterIndex]!,
        weight: uw.weight,
        coverage: uw.coverage,
      }));
      const unitColors = anchor.unitWeights.map((uw) => ({
        clusterIndex: uw.clusterIndex,
        color: assignedColors[uw.clusterIndex] ?? fallbackColor,
        weight: uw.weight,
        coverage: uw.coverage,
      }));
      const mixedColor = colorStrategy.mixItemColor
        ? colorStrategy.mixItemColor({
            id: anchor.id,
            item: anchor.item,
            tags: anchor.tags,
            theme,
            unitColors,
          })
        : mixOklabColors(
            unitColors.map((uc) => ({ oklab: uc.color.oklab, weight: uc.weight })),
          );

      return {
        id: anchor.id,
        item: anchor.item,
        anchorX: anchor.anchorX,
        anchorY: anchor.anchorY,
        unitVertexIndices: anchor.unitVertexIndices,
        layoutContext: {
          id: anchor.id,
          tags: anchor.tags,
          mixedColorHex: mixedColor.hex,
          mixedOklab: mixedColor.oklab,
          unitClusters,
          residualDistance: anchor.residualDistance,
          featureSummary: anchor.featureSummary,
        },
      };
    });

  return {
    clusters,
    items,
    uniqueTags: clusteringOutput.uniqueTags,
  };
}
