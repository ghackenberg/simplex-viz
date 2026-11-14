import { describe, expectTypeOf, it } from 'vitest';
import { solveSimplexSnapshot } from '../src/snapshot';
import type {
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexLayoutStrategy,
  SimplexMeshStrategy,
} from '../src/strategies';
import type {
  ClusterDescriptor,
  ContentHoverEvent,
  ContentLayoutContext,
  DefaultTaggedItem,
  HitTarget,
  ItemIdentityConfig,
  SimplexEngineConfig,
  VisualResolver,
} from '../src/types';

interface CustomArticle {
  readonly slug: string;
  readonly hashtags: readonly string[];
  readonly readingMinutes: number;
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
