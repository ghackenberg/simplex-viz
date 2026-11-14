import { describe, expectTypeOf, it } from 'vitest';
import { solveSimplexSnapshot } from '../src/snapshot';
import {
  createEmbeddingClusteringStrategy,
  createSimilarityClusteringStrategy,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexLayoutStrategy,
  type SimplexMeshStrategy,
} from '../src/strategies';
import type {
  ClusterDescriptor,
  ContentHoverEvent,
  ContentLayoutContext,
  DefaultTaggedItem,
  HitTarget,
  ItemIdentityConfig,
  SimplexEngineConfig,
  StrategyItemIdentityConfig,
  VisualResolver,
} from '../src/types';

interface CustomArticle {
  readonly slug: string;
  readonly hashtags: readonly string[];
  readonly readingMinutes: number;
}

interface ImageEmbeddingSample {
  readonly id: string;
  readonly clipVector: readonly number[];
  readonly colorHistogram: readonly number[];
}

interface CustomTagMeta {
  readonly displayName: string;
}

interface CustomClusterMeta {
  readonly avgMinutes: number;
}

describe('End-to-end compile-time type safety', () => {
  it('enforces getId and getTags only when TItem lacks id or tags', () => {
    expectTypeOf<ItemIdentityConfig<DefaultTaggedItem>>().toMatchTypeOf<{
      readonly getId?: (item: DefaultTaggedItem) => string;
      readonly getTags?: (item: DefaultTaggedItem) => readonly string[];
    }>();

    expectTypeOf<ItemIdentityConfig<CustomArticle>>().toMatchTypeOf<{
      readonly getId: (item: CustomArticle) => string;
      readonly getTags: (item: CustomArticle) => readonly string[];
    }>();
  });

  it('allows omitting getTags when clusteringStrategy is explicitly provided, while requiring it otherwise', () => {
    // Without clusteringStrategy, untagged items require getTags
    expectTypeOf<StrategyItemIdentityConfig<ImageEmbeddingSample, unknown>>().toMatchTypeOf<{
      readonly getId?: (item: ImageEmbeddingSample) => string;
      readonly getTags: (item: ImageEmbeddingSample) => readonly string[];
    }>();

    // With clusteringStrategy, getTags becomes optional for untagged embedding/similarity models
    const embSnap = solveSimplexSnapshot([] as readonly ImageEmbeddingSample[], {
      clusteringStrategy: createEmbeddingClusteringStrategy<ImageEmbeddingSample>({
        getEmbedding: [
          { getVector: (s) => s.clipVector, weight: 0.7 },
          { getVector: (s) => s.colorHistogram, weight: 0.3 },
        ],
      }),
    });
    expectTypeOf(embSnap.items[0]!.item).toEqualTypeOf<ImageEmbeddingSample>();

    const simSnap = solveSimplexSnapshot([] as readonly ImageEmbeddingSample[], {
      clusteringStrategy: createSimilarityClusteringStrategy<ImageEmbeddingSample>({
        getSimilarity: () => 0.5,
      }),
    });
    expectTypeOf(simSnap.items[0]!.item).toEqualTypeOf<ImageEmbeddingSample>();
  });

  it('threads TItem, TTagMeta, TClusterMeta, TContentVisual, TClusterVisual through VisualResolver & events', () => {
    type ContentVis = { readonly r: number };
    type ClusterVis = { readonly title: string };

    type Resolver = VisualResolver<
      CustomArticle,
      ContentVis,
      ClusterVis,
      CustomTagMeta,
      CustomClusterMeta
    >;

    expectTypeOf<Parameters<Resolver['resolveContentVisual']>[0]>().toEqualTypeOf<CustomArticle>();
    expectTypeOf<Parameters<Resolver['resolveContentVisual']>[1]>().toEqualTypeOf<
      ContentLayoutContext<CustomArticle, CustomTagMeta, CustomClusterMeta>
    >();
    expectTypeOf<Parameters<Resolver['resolveClusterVisual']>[0]>().toEqualTypeOf<
      ClusterDescriptor<CustomArticle, CustomTagMeta, CustomClusterMeta>
    >();

    type HoverEv = ContentHoverEvent<
      CustomArticle,
      ContentVis,
      CustomTagMeta,
      CustomClusterMeta
    >;
    expectTypeOf<HoverEv['item']>().toEqualTypeOf<CustomArticle>();
    expectTypeOf<HoverEv['visual']>().toEqualTypeOf<ContentVis>();

    type Target = HitTarget<
      CustomArticle,
      ContentVis,
      ClusterVis,
      CustomTagMeta,
      CustomClusterMeta
    >;
    type ClusterBranch = Extract<Target, { kind: 'cluster' }>;
    expectTypeOf<ClusterBranch['cluster']['meta']>().toEqualTypeOf<CustomClusterMeta>();
    expectTypeOf<ClusterBranch['cluster']['members'][number]['item']>().toEqualTypeOf<CustomArticle>();

    // Ensure deriveClusterMeta is required when TClusterMeta is non-undefined
    type Cfg = SimplexEngineConfig<
      CustomArticle,
      ContentVis,
      ClusterVis,
      CustomTagMeta,
      CustomClusterMeta
    >;
    expectTypeOf<Cfg['deriveClusterMeta']>().not.toBeUndefined();
    expectTypeOf<Cfg['meshStrategy']>().toEqualTypeOf<
      SimplexMeshStrategy<CustomArticle> | undefined
    >();
    expectTypeOf<Cfg['clusteringStrategy']>().toEqualTypeOf<
      SimplexClusteringStrategy<CustomArticle, CustomTagMeta> | undefined
    >();
    expectTypeOf<Cfg['colorStrategy']>().toEqualTypeOf<
      SimplexColorStrategy<CustomArticle, CustomTagMeta> | undefined
    >();
    expectTypeOf<Cfg['layoutStrategy']>().toEqualTypeOf<
      SimplexLayoutStrategy | undefined
    >();
  });

  it('supports zero-config solveSimplexSnapshot on DefaultTaggedItem and preserves custom item types', () => {
    const quick = solveSimplexSnapshot([] as readonly DefaultTaggedItem[]);
    expectTypeOf(quick.items[0]!.item).toEqualTypeOf<DefaultTaggedItem>();

    const custom = solveSimplexSnapshot([] as readonly CustomArticle[], {
      getId: (a) => a.slug,
      getTags: (a) => a.hashtags,
      deriveClusterMeta: () => ({ avgMinutes: 5 }),
    });
    expectTypeOf(custom.items[0]!.item).toEqualTypeOf<CustomArticle>();
    expectTypeOf(custom.clusters[0]!.cluster.meta).toEqualTypeOf<CustomClusterMeta>();
  });
});
